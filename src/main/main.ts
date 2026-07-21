import path from 'node:path'
import { app, ipcMain, net, type BrowserWindow, type WebContents } from 'electron'
import {
  ConfigStore,
  normalizeServerUrl,
  readStartupServerUrl,
  ServerUrlError,
} from './config.js'
import { Logger } from './logger.js'
import { disableApplicationMenu, registerApplicationMenuIpc, showApplicationMenu } from './menu.js'
import { validateServer } from './server-validator.js'
import { createRemoteWindow, createSetupWindow } from './windows.js'
import { ApplicationAudioCoordinator } from './application-audio.js'
import { SETUP_CHANNELS, type SetupSaveRequest, type SetupState } from '../shared/setup-api.js'
import { WINDOW_CHANNELS, type WindowMenuPosition } from '../shared/window-api.js'

app.setName('Celery Web Speak')
if (!app.isPackaged && process.env.CWS_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.CWS_USER_DATA_DIR))
}
app.commandLine.appendSwitch('ignore-certificate-errors')
if (!app.isPackaged && process.env.CWS_E2E_FAKE_MEDIA === '1') {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream')
}

const startupUserDataPath = app.getPath('userData')
const startupServerUrl = readStartupServerUrl(startupUserDataPath)
if (startupServerUrl?.startsWith('http://')) {
  app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', startupServerUrl)
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

let currentWindow: BrowserWindow | null = null
let currentRemoteContents: WebContents | null = null
let setupMode = false
let setupCanCancel = false
let setupStartupError = ''
let quitting = false
let store: ConfigStore
let logger: Logger
let applicationAudio: ApplicationAudioCoordinator | null = null

app.on('certificate-error', (event, _webContents, _url, _error, _certificate, callback) => {
  event.preventDefault()
  callback(true)
})

app.on('second-instance', () => focusCurrentWindow())

app.on('before-quit', () => {
  quitting = true
  applicationAudio?.shutdown()
})

app.on('window-all-closed', () => {
  app.quit()
})

if (hasSingleInstanceLock) {
  void app.whenReady().then(initialize).catch((error: unknown) => {
    logger?.error('initialization_failed', { message: safeErrorMessage(error) })
    app.quit()
  })
}

async function initialize(): Promise<void> {
  store = new ConfigStore(app.getPath('userData'))
  logger = new Logger(app.getPath('userData'))
  applicationAudio = new ApplicationAudioCoordinator(logger)
  logger.info('application_started', { version: app.getVersion() })
  registerSetupIpc()
  registerWindowIpc()
  registerApplicationMenuIpc({
    switchServer: () => showSetup(true),
    reload: () => {
      if (currentRemoteContents && !currentRemoteContents.isDestroyed()) currentRemoteContents.reload()
    },
  })
  disableApplicationMenu()

  const config = await store.load()
  if (config) showRemote(config)
  else showSetup(false)
}

function registerWindowIpc(): void {
  ipcMain.handle(WINDOW_CHANNELS.getState, (event) => {
    const window = assertWindowSender(event.sender)
    return { maximized: window.isMaximized() }
  })

  ipcMain.handle(WINDOW_CHANNELS.minimize, (event) => {
    assertWindowSender(event.sender).minimize()
  })

  ipcMain.handle(WINDOW_CHANNELS.toggleMaximize, (event) => {
    const window = assertWindowSender(event.sender)
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    return { maximized: window.isMaximized() }
  })

  ipcMain.handle(WINDOW_CHANNELS.close, (event) => {
    assertWindowSender(event.sender).close()
  })

  ipcMain.handle(WINDOW_CHANNELS.showMenu, (event, input: unknown) => {
    const window = assertWindowSender(event.sender)
    const position = normalizeMenuPosition(input, window)
    showApplicationMenu(window, position, !setupMode)
  })
}

function registerSetupIpc(): void {
  ipcMain.handle(SETUP_CHANNELS.getState, (event): SetupState => {
    assertSetupSender(event.sender)
    return {
      serverUrl: startupServerUrl ?? '',
      canCancel: setupCanCancel,
      startupError: setupStartupError,
      version: app.getVersion(),
    }
  })

  ipcMain.handle(SETUP_CHANNELS.validate, async (event, input: unknown) => {
    assertSetupSender(event.sender)
    try {
      const serverUrl = normalizeServerUrl(typeof input === 'string' ? input : '')
      return await validateServer(serverUrl, net.fetch)
    } catch (error) {
      return setupError(error)
    }
  })

  ipcMain.handle(SETUP_CHANNELS.save, async (event, input: SetupSaveRequest) => {
    assertSetupSender(event.sender)
    try {
      const serverUrl = normalizeServerUrl(input?.serverUrl ?? '')
      if (!input?.force) {
        const validation = await validateServer(serverUrl, net.fetch)
        if (!validation.ok) return validation
      }
      const current = await store.load()
      await store.save(serverUrl, current?.window)
      logger.info('server_saved', { origin: serverUrl, forced: input.force === true })
      setTimeout(relaunchApplication, 180)
      return { ok: true, serverUrl }
    } catch (error) {
      return setupError(error)
    }
  })

  ipcMain.handle(SETUP_CHANNELS.cancel, (event) => {
    assertSetupSender(event.sender)
    if (!setupCanCancel) return
    void store.load().then((config) => {
      if (config) showRemote(config)
    })
  })
}

function showSetup(canCancel: boolean, startupError = ''): void {
  setupMode = true
  setupCanCancel = canCancel
  setupStartupError = startupError
  const previous = currentWindow
  applicationAudio?.unbindRemote()
  currentRemoteContents = null
  currentWindow = createSetupWindow()
  attachWindowChrome(currentWindow)
  previous?.destroy()
}

function showRemote(config: NonNullable<Awaited<ReturnType<ConfigStore['load']>>>): void {
  setupMode = false
  const previous = currentWindow
  const remote = createRemoteWindow(config, store, app.isPackaged, {
    onRemoteClosed: () => {
      if (!quitting && !setupMode) app.quit()
    },
    onRemoteLoadFailed: (message) => {
      logger.warn('remote_load_failed', { origin: config.serverUrl, message })
      if (!setupMode) showSetup(false, message)
    },
  })
  currentWindow = remote.window
  currentRemoteContents = remote.webContents
  applicationAudio?.bindRemote(remote.window, remote.webContents, config.serverUrl)
  attachWindowChrome(currentWindow)
  previous?.destroy()
}

function assertSetupSender(sender: Electron.WebContents): void {
  if (!currentWindow || sender !== currentWindow.webContents || !setupMode) {
    throw new Error('Setup IPC is only available to the active setup window')
  }
}

function assertWindowSender(sender: Electron.WebContents): BrowserWindow {
  if (!currentWindow || sender !== currentWindow.webContents) {
    throw new Error('Window controls are only available to the active local window')
  }
  return currentWindow
}

function attachWindowChrome(window: BrowserWindow): void {
  const notify = () => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(WINDOW_CHANNELS.maximizedChanged, window.isMaximized())
    }
  }
  window.on('maximize', notify)
  window.on('unmaximize', notify)
}

function normalizeMenuPosition(input: unknown, window: BrowserWindow): WindowMenuPosition {
  const candidate = input && typeof input === 'object' ? input as Partial<WindowMenuPosition> : {}
  const size = window.getContentSize()
  const width = size[0] ?? 1
  const height = size[1] ?? 1
  const x = Number.isFinite(candidate.x) ? Math.round(candidate.x as number) : 0
  const y = Number.isFinite(candidate.y) ? Math.round(candidate.y as number) : 0
  return {
    x: Math.max(0, Math.min(width - 1, x)),
    y: Math.max(0, Math.min(height - 1, y)),
  }
}

function relaunchApplication(): void {
  app.relaunch()
  app.exit(0)
}

function focusCurrentWindow(): void {
  if (!currentWindow || currentWindow.isDestroyed()) return
  if (currentWindow.isMinimized()) currentWindow.restore()
  currentWindow.show()
  currentWindow.focus()
}

function setupError(error: unknown) {
  if (error instanceof ServerUrlError) return { ok: false, code: 'invalid_url', message: error.message }
  return { ok: false, code: 'internal_error', message: '无法保存服务器配置' }
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error'
}
