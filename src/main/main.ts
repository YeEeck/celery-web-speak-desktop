import path from 'node:path'
import { app, ipcMain, net, type BrowserWindow } from 'electron'
import {
  ConfigStore,
  normalizeServerUrl,
  readStartupServerUrl,
  ServerUrlError,
} from './config.js'
import { Logger } from './logger.js'
import { installApplicationMenu } from './menu.js'
import { validateServer } from './server-validator.js'
import { createRemoteWindow, createSetupWindow } from './windows.js'
import { SETUP_CHANNELS, type SetupSaveRequest, type SetupState } from '../shared/setup-api.js'

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
let setupMode = false
let setupCanCancel = false
let setupStartupError = ''
let quitting = false
let store: ConfigStore
let logger: Logger

app.on('certificate-error', (event, _webContents, _url, _error, _certificate, callback) => {
  event.preventDefault()
  callback(true)
})

app.on('second-instance', () => focusCurrentWindow())

app.on('before-quit', () => {
  quitting = true
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
  logger.info('application_started', { version: app.getVersion() })
  registerSetupIpc()
  installApplicationMenu({
    currentWindow: () => currentWindow,
    switchServer: () => showSetup(true),
  })

  const config = await store.load()
  if (config) showRemote(config)
  else showSetup(false)
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
  currentWindow = createSetupWindow()
  previous?.destroy()
}

function showRemote(config: NonNullable<Awaited<ReturnType<ConfigStore['load']>>>): void {
  setupMode = false
  const previous = currentWindow
  currentWindow = createRemoteWindow(config, store, app.isPackaged, {
    onRemoteClosed: () => {
      if (!quitting && !setupMode) app.quit()
    },
    onRemoteLoadFailed: (message) => {
      logger.warn('remote_load_failed', { origin: config.serverUrl, message })
      if (!setupMode) showSetup(false, message)
    },
  })
  previous?.destroy()
}

function assertSetupSender(sender: Electron.WebContents): void {
  if (!currentWindow || sender !== currentWindow.webContents || !setupMode) {
    throw new Error('Setup IPC is only available to the active setup window')
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
