import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BrowserWindow,
  net,
  screen,
  session,
  WebContentsView,
  type Rectangle,
  type WebContents,
} from 'electron'
import type { AppConfig, ConfigStore, WindowState } from './config.js'
import { configureNavigationPolicy, configureSessionPolicy } from './session-policy.js'
import { visibleWindowBounds } from './window-state.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const REMOTE_PARTITION = 'persist:celery-web-speak'
const TITLE_BAR_HEIGHT = 32

export interface WindowCallbacks {
  onRemoteClosed(): void
  onRemoteLoadFailed(message: string): void
}

export interface RemoteWindow {
  window: BrowserWindow
  webContents: WebContents
}

export function createSetupWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: 'Celery Web Speak',
    width: 560,
    height: 420,
    minWidth: 520,
    minHeight: 400,
    show: false,
    frame: false,
    backgroundColor: '#313338',
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
): RemoteWindow {
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
    frame: false,
    backgroundColor: '#17191f',
    webPreferences: {
      preload: path.join(currentDirectory, '..', 'preload', 'shell.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })

  const remoteView = new WebContentsView({
    webPreferences: {
      partition: REMOTE_PARTITION,
      preload: path.join(currentDirectory, '..', 'preload', 'application-audio.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  remoteView.setBackgroundColor('#17191f')
  window.contentView.addChildView(remoteView)

  const layoutRemoteView = () => {
    const size = window.getContentSize()
    const width = size[0] ?? 0
    const height = size[1] ?? 0
    remoteView.setBounds({
      x: 0,
      y: TITLE_BAR_HEIGHT,
      width,
      height: Math.max(0, height - TITLE_BAR_HEIGHT),
    })
  }
  layoutRemoteView()
  window.on('resize', layoutRemoteView)

  configureNavigationPolicy(remoteView.webContents, config.serverUrl, packaged)
  if (config.window.maximized) window.maximize()
  window.once('ready-to-show', () => window.show())

  let closing = false
  window.on('close', (event) => {
    if (closing) return
    event.preventDefault()
    closing = true
    void Promise.allSettled([
      persistWindowState(window, store),
      notifyServerOfVoiceLeave(config.serverUrl),
    ]).finally(() => {
      callbacks.onRemoteClosed()
      window.destroy()
    })
  })

  remoteView.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || closing) return
    callbacks.onRemoteLoadFailed(`无法加载服务器：${errorDescription}`)
  })

  window.on('closed', () => {
    if (!remoteView.webContents.isDestroyed()) remoteView.webContents.close()
  })

  void window.loadFile(path.join(currentDirectory, '..', 'renderer', 'shell.html'))
  void remoteView.webContents.loadURL(config.serverUrl)
  return { window, webContents: remoteView.webContents }
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
  await session.fromPartition(REMOTE_PARTITION).flushStorageData()
}

// 窗口关闭时 window.destroy() 不会触发渲染进程的 pagehide，web 端的 sendBeacon
// 无法发出。这里由主进程直接使用远程会话的登录 cookie 通知后端离开语音频道，
// 避免成员列表出现幽灵状态。通知为尽力而为，失败时由服务端周期对账机制兜底。
async function notifyServerOfVoiceLeave(serverUrl: string): Promise<void> {
  try {
    const remoteSession = session.fromPartition(REMOTE_PARTITION)
    const cookies = await remoteSession.cookies.get({ url: serverUrl })
    if (cookies.length === 0) return
    const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
    await net.fetch(new URL('/api/voice/leave', serverUrl).toString(), {
      method: 'POST',
      headers: { cookie: cookieHeader },
      signal: AbortSignal.timeout(2000),
    })
  } catch {
    // 通知失败不应阻塞窗口关闭。
  }
}
