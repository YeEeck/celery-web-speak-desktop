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
  VOICE_OVERLAY_CAPABILITIES,
  VOICE_OVERLAY_CHANNELS,
  VOICE_OVERLAY_PROTOCOL,
  VOICE_OVERLAY_RENDER_CHANNEL,
  normalizeVoiceOverlayEnabledRequest,
  normalizeVoiceOverlayState,
  type VoiceOverlayHello,
  type VoiceOverlayState,
} from '../shared/voice-overlay-api.js'
import { normalizeProtocolRange } from '../shared/application-audio-api.js'
import { isTrustedRemoteRequest } from './remote-request-policy.js'
import type { Logger } from './logger.js'
import { REMOTE_PARTITION } from './windows.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const OVERLAY_WIDTH = 280
const OVERLAY_HEIGHT = 420
const OVERLAY_EDGE_MARGIN = 32

interface RemoteBinding {
  window: BrowserWindow
  webContents: WebContents
  serverUrl: string
}

const EMPTY_STATE: VoiceOverlayState = { channel: null, participants: [] }

export class VoiceOverlayCoordinator {
  private remote: RemoteBinding | null = null
  private overlayWindow: BrowserWindow | null = null
  private state: VoiceOverlayState = EMPTY_STATE

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
    ipcMain.handle(VOICE_OVERLAY_CHANNELS.getState, (event) => {
      if (event.sender !== this.overlayWindow?.webContents) {
        throw new Error('Voice overlay state is only available to the overlay window')
      }
      return this.state
    })
  }

  bindRemote(window: BrowserWindow, webContents: WebContents, serverUrl: string): void {
    this.unbindRemote()
    const binding: RemoteBinding = { window, webContents, serverUrl }
    this.remote = binding
    webContents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
      if (isMainFrame && this.remote === binding) this.clearState()
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
    const compatible = range.minProtocol <= VOICE_OVERLAY_PROTOCOL &&
      range.maxProtocol >= VOICE_OVERLAY_PROTOCOL
    return {
      protocol: VOICE_OVERLAY_PROTOCOL,
      capabilities: compatible ? [...VOICE_OVERLAY_CAPABILITIES] : [],
    }
  }

  private setEnabled(event: IpcMainInvokeEvent, input: unknown): void {
    this.assertTrusted(event)
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
  }

  private clearState(): void {
    this.state = EMPTY_STATE
    this.sendStateToOverlay()
  }

  private sendStateToOverlay(): void {
    const overlay = this.overlayWindow
    if (!overlay || overlay.isDestroyed() || overlay.webContents.isDestroyed()) return
    overlay.webContents.send(VOICE_OVERLAY_RENDER_CHANNEL, this.state)
  }

  private ensureOverlayWindow(): BrowserWindow {
    const existing = this.overlayWindow
    if (existing && !existing.isDestroyed()) return existing
    const window = this.createOverlayWindow()
    this.overlayWindow = window
    window.on('closed', () => {
      if (this.overlayWindow === window) this.overlayWindow = null
    })
    void window.loadFile(path.join(currentDirectory, '..', 'renderer', 'overlay.html'))
    return window
  }

  private createOverlayWindow(): BrowserWindow {
    const workArea = screen.getPrimaryDisplay().workArea
    const window = new BrowserWindow({
      width: OVERLAY_WIDTH,
      height: OVERLAY_HEIGHT,
      x: workArea.x + OVERLAY_EDGE_MARGIN,
      y: workArea.y + Math.round((workArea.height - OVERLAY_HEIGHT) / 2),
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
