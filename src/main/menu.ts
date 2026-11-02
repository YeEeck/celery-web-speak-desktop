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

// 与 menu.html 的可见项保持一致（menu.test.ts 会校验两者结构相同）；
// 高度按实际可见项计算，保证最后一项完整可见。
export const MENU_LAYOUT: readonly MenuLayoutEntry[] = [
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
  toggleAutostart(): void | Promise<void>
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

  ipcMain.handle(MENU_CHANNELS.execute, async (event, input: unknown) => {
    const menu = assertMenuSender(event.sender)
    const parent = menu.getParentWindow()
    const action = normalizeMenuAction(input)
    closeActiveMenu()

    if (action === 'switch-server') actions.switchServer()
    else if (action === 'reload') actions.reload()
    else if (action === 'check-update') actions.checkUpdate()
    else if (action === 'toggle-auto-check') actions.toggleAutoCheck()
    else if (action === 'toggle-autostart') await actions.toggleAutostart()
    else if (action === 'quit') app.quit()
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
  if (input === 'toggle-autostart') {
    // 开发模式与非 Windows 下菜单不暴露该项，动作白名单直接拒绝；
    // 即使渲染层伪造该动作，主进程也不会产生任何系统写入。
    if (!menuStartupEntryVisible) throw new Error('Unknown application menu action')
    return input
  }
  if (
    input === 'switch-server' ||
    input === 'reload' ||
    input === 'check-update' ||
    input === 'toggle-auto-check' ||
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
