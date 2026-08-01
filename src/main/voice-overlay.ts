import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BrowserWindow,
  ipcMain,
  screen,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron'
import {
  DEFAULT_VOICE_OVERLAY_CONFIG,
  OVERLAY_WINDOW_CHANNELS,
  VOICE_OVERLAY_CAPABILITIES,
  VOICE_OVERLAY_CHANNELS,
  VOICE_OVERLAY_PROTOCOL,
  negotiateOverlayProtocol,
  normalizeVoiceOverlayConfig,
  normalizeVoiceOverlayEnabledRequest,
  normalizeVoiceOverlayState,
  type VoiceOverlayConfig,
  type VoiceOverlayHello,
  type VoiceOverlayState,
} from '../shared/voice-overlay-api.js'
import { normalizeProtocolRange } from '../shared/protocol-api.js'
import { isTrustedRemoteRequest } from './remote-request-policy.js'
import { computeOverlayBounds } from './overlay-geometry.js'
import type { Logger } from './logger.js'
import { REMOTE_PARTITION, type RemoteBinding } from './windows.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

const EMPTY_STATE: VoiceOverlayState = { channel: null, participants: [] }

export class VoiceOverlayCoordinator {
  private remote: RemoteBinding | null = null
  private overlayWindow: BrowserWindow | null = null
  private state: VoiceOverlayState = EMPTY_STATE
  private config: VoiceOverlayConfig = DEFAULT_VOICE_OVERLAY_CONFIG
  private negotiatedProtocol = 0

  constructor(private readonly logger: Logger) {
    ipcMain.handle(VOICE_OVERLAY_CHANNELS.hello, (event, input: unknown) => (
      this.hello(event, input)
    ))
    ipcMain.handle(VOICE_OVERLAY_CHANNELS.setEnabled, (event, input: unknown) => {
      this.setEnabled(event, input)
    })
    ipcMain.on(VOICE_OVERLAY_CHANNELS.state, (event, input: unknown) => {
      this.receiveState(event, input)
    })
    ipcMain.on(VOICE_OVERLAY_CHANNELS.setConfig, (event, input: unknown) => {
      this.receiveConfig(event, input)
    })
    ipcMain.handle(OVERLAY_WINDOW_CHANNELS.getState, (event) => {
      if (event.sender !== this.overlayWindow?.webContents) {
        throw new Error('Voice overlay state is only available to the overlay window')
      }
      return { state: this.state, config: this.config }
    })
  }

  bindRemote(window: BrowserWindow, webContents: WebContents, serverUrl: string): void {
    this.unbindRemote()
    const binding: RemoteBinding = { window, webContents, serverUrl }
    this.remote = binding
    webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace && this.remote === binding) this.clearState()
    })
    webContents.on('render-process-gone', () => {
      if (this.remote === binding) this.unbindRemote()
    })
    webContents.on('destroyed', () => {
      if (this.remote === binding) this.unbindRemote()
    })
  }

  unbindRemote(): void {
    if (!this.remote) return
    this.remote = null
    this.clearState()
  }

  shutdown(): void {
    this.unbindRemote()
    this.destroyOverlayWindow()
  }

  private hello(event: IpcMainInvokeEvent, input: unknown): VoiceOverlayHello {
    this.assertTrusted(event)
    const range = normalizeProtocolRange(input)
    if (!range) throw new Error('Invalid voice overlay protocol range')
    this.clearState()
    this.negotiatedProtocol = negotiateOverlayProtocol(range)
    const compatible = this.negotiatedProtocol > 0
    return {
      protocol: this.negotiatedProtocol,
      capabilities: compatible ? [...VOICE_OVERLAY_CAPABILITIES] : [],
    }
  }

  private setEnabled(event: IpcMainInvokeEvent, input: unknown): void {
    this.assertTrusted(event)
    if (this.negotiatedProtocol < VOICE_OVERLAY_PROTOCOL) {
      this.logger.info('voice_overlay_protocol_1_disabled')
      this.destroyOverlayWindow()
      return
    }
    const enabled = normalizeVoiceOverlayEnabledRequest(input)
    if (enabled === null) throw new Error('Invalid voice overlay enabled request')
    if (enabled) {
      this.ensureOverlayWindow()
      this.logger.info('voice_overlay_enabled')
    } else {
      this.destroyOverlayWindow()
      this.logger.info('voice_overlay_disabled')
    }
  }

  private receiveState(event: IpcMainEvent, input: unknown): void {
    if (!this.isTrusted(event)) {
      this.logger.warn('voice_overlay_untrusted_state_dropped')
      return
    }
    const state = normalizeVoiceOverlayState(input)
    if (!state) {
      this.logger.warn('voice_overlay_invalid_state_dropped')
      return
    }
    this.state = state
    this.sendStateToOverlay()
    this.updateOverlayGeometry()
  }

  private receiveConfig(event: IpcMainEvent, input: unknown): void {
    if (!this.isTrusted(event)) {
      this.logger.warn('voice_overlay_untrusted_config_dropped')
      return
    }
    const config = normalizeVoiceOverlayConfig(input)
    if (!config) {
      this.logger.warn('voice_overlay_invalid_config_dropped')
      return
    }
    this.config = config
    this.updateOverlayGeometry()
    this.sendConfigToOverlay()
  }

  private clearState(): void {
    this.state = EMPTY_STATE
    this.sendStateToOverlay()
    this.updateOverlayGeometry()
  }

  private sendStateToOverlay(): void {
    const overlay = this.overlayWindow
    if (!overlay || overlay.isDestroyed() || overlay.webContents.isDestroyed()) return
    overlay.webContents.send(OVERLAY_WINDOW_CHANNELS.render, this.state)
  }

  private sendConfigToOverlay(): void {
    const overlay = this.overlayWindow
    if (!overlay || overlay.isDestroyed() || overlay.webContents.isDestroyed()) return
    overlay.webContents.send(OVERLAY_WINDOW_CHANNELS.pushConfig, this.config)
  }

  private updateOverlayGeometry(): void {
    const overlay = this.overlayWindow
    if (!overlay || overlay.isDestroyed()) return
    overlay.setBounds(computeOverlayBounds(this.config, screen.getPrimaryDisplay().workArea, this.state.participants.length))
  }

  private ensureOverlayWindow(): BrowserWindow {
    const existing = this.overlayWindow
    if (existing && !existing.isDestroyed()) return existing
    const remote = this.remote
    if (!remote) throw new Error('Voice overlay requires an active remote page')
    const window = this.createOverlayWindow()
    this.overlayWindow = window
    window.on('closed', () => {
      if (this.overlayWindow === window) this.overlayWindow = null
    })
    const overlayUrl = new URL('/overlay.html', remote.serverUrl).toString()
    window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (isMainFrame && errorCode !== -3 && !window.isDestroyed()) {
        this.logger.warn(`voice_overlay_page_load_failed: ${errorCode} ${errorDescription}`)
        this.destroyOverlayWindow()
      }
    })
    void window.loadURL(overlayUrl)
    return window
  }

  private createOverlayWindow(): BrowserWindow {
    const window = new BrowserWindow({
      ...computeOverlayBounds(this.config, screen.getPrimaryDisplay().workArea, this.state.participants.length),
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      transparent: true,
      hasShadow: false,
      alwaysOnTop: true,
      webPreferences: {
        partition: REMOTE_PARTITION,
        preload: path.join(currentDirectory, '..', 'preload', 'overlay.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    })
    window.setAlwaysOnTop(true, 'screen-saver')
    window.setIgnoreMouseEvents(true)
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.show()
    })
    return window
  }

  private destroyOverlayWindow(): void {
    const overlay = this.overlayWindow
    this.overlayWindow = null
    if (overlay && !overlay.isDestroyed()) overlay.destroy()
  }

  private assertTrusted(event: IpcMainEvent | IpcMainInvokeEvent): void {
    if (!this.isTrusted(event)) {
      throw new Error('Voice overlay IPC is only available to the active remote page')
    }
  }

  private isTrusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    const remote = this.remote
    const senderFrame = event.senderFrame
    const topFrame = Boolean(senderFrame &&
      senderFrame.parent === null &&
      senderFrame.frameTreeNodeId === event.sender.mainFrame.frameTreeNodeId)
    return Boolean(remote && isTrustedRemoteRequest({
      activeRemote: true,
      senderMatches: event.sender === remote.webContents,
      topFrame,
      senderUrl: event.sender.getURL(),
      serverUrl: remote.serverUrl,
    }))
  }
}
