import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BrowserWindow,
  screen,
  session,
  type Rectangle,
} from 'electron'
import type { AppConfig, ConfigStore, WindowState } from './config.js'
import { configureNavigationPolicy, configureSessionPolicy } from './session-policy.js'
import { visibleWindowBounds } from './window-state.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const REMOTE_PARTITION = 'persist:celery-web-speak'

export interface WindowCallbacks {
  onRemoteClosed(): void
  onRemoteLoadFailed(message: string): void
}

export function createSetupWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: 'Celery Web Speak',
    width: 560,
    height: 540,
    minWidth: 520,
    minHeight: 500,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f4f6f8',
    webPreferences: {
      preload: path.join(currentDirectory, '..', 'preload', 'setup.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  window.once('ready-to-show', () => window.show())
  void window.loadFile(path.join(currentDirectory, '..', 'renderer', 'setup.html'))
  return window
}

export function createRemoteWindow(
  config: AppConfig,
  store: ConfigStore,
  packaged: boolean,
  callbacks: WindowCallbacks,
): BrowserWindow {
  const displays: Rectangle[] = screen.getAllDisplays().map((display) => display.bounds)
  const bounds = visibleWindowBounds(config.window, displays)
  const remoteSession = session.fromPartition(REMOTE_PARTITION)
  configureSessionPolicy(remoteSession, config.serverUrl)

  const window = new BrowserWindow({
    title: 'Celery Web Speak',
    ...bounds,
    center: config.window.x === null || config.window.y === null,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#17191f',
    webPreferences: {
      partition: REMOTE_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })

  configureNavigationPolicy(window, config.serverUrl, packaged)
  if (config.window.maximized) window.maximize()
  window.once('ready-to-show', () => window.show())

  let closing = false
  window.on('close', (event) => {
    if (closing) return
    event.preventDefault()
    closing = true
    void persistWindowState(window, store).finally(() => {
      callbacks.onRemoteClosed()
      window.destroy()
    })
  })

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || closing) return
    callbacks.onRemoteLoadFailed(`无法加载服务器：${errorDescription}`)
  })

  void window.loadURL(config.serverUrl)
  return window
}

async function persistWindowState(window: BrowserWindow, store: ConfigStore): Promise<void> {
  if (window.isDestroyed()) return
  const bounds = window.getNormalBounds()
  const state: WindowState = {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    maximized: window.isMaximized(),
  }
  await store.updateWindow(state)
  await window.webContents.session.flushStorageData()
}
