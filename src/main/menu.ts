import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, Menu, screen } from 'electron'
import { MENU_CHANNELS, type ApplicationMenuAction } from '../shared/menu-api.js'
import type { WindowMenuPosition } from '../shared/window-api.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const MENU_WIDTH = 220
const MENU_ITEM_HEIGHT = 34
const MENU_SEPARATOR_HEIGHT = 9
const MENU_BODY_HEIGHT = 14

interface MenuLayoutEntry {
  kind: 'item' | 'separator'
  remoteOnly?: boolean
  autostartOnly?: boolean
}

// 与 menu.html 的可见项保持一致；高度按实际可见项计算，保证最后一项完整可见。
const MENU_LAYOUT: readonly MenuLayoutEntry[] = [
  { kind: 'item', remoteOnly: true }, // 切换服务器
  { kind: 'item', remoteOnly: true }, // 重新加载
  { kind: 'separator', remoteOnly: true },
  { kind: 'item' }, // 检查更新
  { kind: 'item' }, // 自动检查更新
  { kind: 'item', autostartOnly: true }, // 随系统启动
  { kind: 'separator' },
  { kind: 'item' }, // 关于
  { kind: 'separator' },
  { kind: 'item' }, // 退出
]

let activeMenu: BrowserWindow | null = null
let menuChecks: Partial<Record<ApplicationMenuAction, boolean>> = {}
let menuStartupEntryVisible = false

export interface MenuActions {
  switchServer(): void
  reload(): void
  checkUpdate(): void
  toggleAutoCheck(): void
  toggleAutostart(): void
}

export interface ApplicationMenuOptions {
  remoteMode: boolean
  autoCheckUpdate: boolean
  startupEntryVisible: boolean
  startupEntryEnabled: boolean
}

export function applicationMenuHeight(remoteMode: boolean, startupEntryVisible: boolean): number {
  return MENU_LAYOUT.reduce((height, entry) => {
    if (entry.remoteOnly && !remoteMode) return height
    if (entry.autostartOnly && !startupEntryVisible) return height
    return height + (entry.kind === 'item' ? MENU_ITEM_HEIGHT : MENU_SEPARATOR_HEIGHT)
  }, MENU_BODY_HEIGHT)
}

export function disableApplicationMenu(): void {
  Menu.setApplicationMenu(null)
}

export function registerApplicationMenuIpc(actions: MenuActions): void {
  ipcMain.handle(MENU_CHANNELS.getState, (event) => {
    assertMenuSender(event.sender)
    return { checks: menuChecks }
  })

  ipcMain.handle(MENU_CHANNELS.execute, (event, input: unknown) => {
    const menu = assertMenuSender(event.sender)
    const parent = menu.getParentWindow()
    const action = normalizeMenuAction(input)
    closeActiveMenu()

    if (action === 'switch-server') actions.switchServer()
    else if (action === 'reload') actions.reload()
    else if (action === 'check-update') actions.checkUpdate()
    else if (action === 'toggle-auto-check') actions.toggleAutoCheck()
    else if (action === 'toggle-autostart') {
      // 主进程是权威：菜单未暴露该项时（开发模式或非 Windows），伪造的动作不产生任何系统写入。
      if (menuStartupEntryVisible) actions.toggleAutostart()
    } else if (action === 'quit') app.quit()
    else if (parent && !parent.isDestroyed()) {
      void dialog.showMessageBox(parent, {
        type: 'info',
        title: 'Celery Web Speak',
        message: 'Celery Web Speak',
        detail: `桌面客户端 ${app.getVersion()}`,
      })
    }
  })

  ipcMain.handle(MENU_CHANNELS.dismiss, (event) => {
    assertMenuSender(event.sender)
    closeActiveMenu()
  })
}

export function showApplicationMenu(
  window: BrowserWindow,
  position: WindowMenuPosition,
  options: ApplicationMenuOptions,
): void {
  closeActiveMenu()
  menuChecks = {
    'toggle-auto-check': options.autoCheckUpdate,
    'toggle-autostart': options.startupEntryVisible && options.startupEntryEnabled,
  }
  menuStartupEntryVisible = options.startupEntryVisible
  const height = applicationMenuHeight(options.remoteMode, options.startupEntryVisible)
  const parentBounds = window.getBounds()
  const workArea = screen.getDisplayMatching(parentBounds).workArea
  const preferredX = parentBounds.x + position.x - MENU_WIDTH
  const preferredY = parentBounds.y + position.y + 2
  const x = clamp(preferredX, workArea.x, workArea.x + workArea.width - MENU_WIDTH)
  const y = clamp(preferredY, workArea.y, workArea.y + workArea.height - height)

  const menu = new BrowserWindow({
    parent: window,
    x,
    y,
    width: MENU_WIDTH,
    height,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    backgroundColor: '#111214',
    webPreferences: {
      preload: path.join(currentDirectory, '..', 'preload', 'menu.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  // 非可调整窗口在 Windows 上会按非客户区再调整高度；锁定内容尺寸，保证按可见项算出的高度就是页面高度。
  menu.setContentSize(MENU_WIDTH, height)
  activeMenu = menu
  menu.once('ready-to-show', () => {
    if (menu.isDestroyed()) return
    menu.show()
    menu.focus()
    setTimeout(() => {
      if (!menu.isDestroyed()) {
        menu.on('blur', () => {
          if (activeMenu === menu) closeActiveMenu()
        })
      }
    }, 100)
  })
  menu.on('closed', () => {
    if (activeMenu === menu) activeMenu = null
  })
  void menu.loadFile(path.join(currentDirectory, '..', 'renderer', 'menu.html'), {
    query: {
      mode: options.remoteMode ? 'remote' : 'setup',
      autostart: options.startupEntryVisible ? '1' : '0',
    },
  })
}

function assertMenuSender(sender: Electron.WebContents): BrowserWindow {
  if (!activeMenu || activeMenu.isDestroyed() || sender !== activeMenu.webContents) {
    throw new Error('Menu commands are only available to the active application menu')
  }
  return activeMenu
}

function normalizeMenuAction(input: unknown): ApplicationMenuAction {
  if (
    input === 'switch-server' ||
    input === 'reload' ||
    input === 'check-update' ||
    input === 'toggle-auto-check' ||
    input === 'toggle-autostart' ||
    input === 'about' ||
    input === 'quit'
  ) {
    return input
  }
  throw new Error('Unknown application menu action')
}

function closeActiveMenu(): void {
  const menu = activeMenu
  activeMenu = null
  if (menu && !menu.isDestroyed()) menu.destroy()
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)))
}
