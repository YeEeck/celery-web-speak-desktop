import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, Menu, screen } from 'electron'
import { MENU_CHANNELS, type ApplicationMenuAction } from '../shared/menu-api.js'
import type { WindowMenuPosition } from '../shared/window-api.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const MENU_WIDTH = 220
const REMOTE_MENU_HEIGHT = 166
const SETUP_MENU_HEIGHT = 89

let activeMenu: BrowserWindow | null = null

export interface MenuActions {
  switchServer(): void
  reload(): void
}

export function disableApplicationMenu(): void {
  Menu.setApplicationMenu(null)
}

export function registerApplicationMenuIpc(actions: MenuActions): void {
  ipcMain.handle(MENU_CHANNELS.execute, (event, input: unknown) => {
    const menu = assertMenuSender(event.sender)
    const parent = menu.getParentWindow()
    const action = normalizeMenuAction(input)
    closeActiveMenu()

    if (action === 'switch-server') actions.switchServer()
    else if (action === 'reload') actions.reload()
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
  remoteMode: boolean,
): void {
  closeActiveMenu()
  const height = remoteMode ? REMOTE_MENU_HEIGHT : SETUP_MENU_HEIGHT
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
    query: { mode: remoteMode ? 'remote' : 'setup' },
  })
}

function assertMenuSender(sender: Electron.WebContents): BrowserWindow {
  if (!activeMenu || activeMenu.isDestroyed() || sender !== activeMenu.webContents) {
    throw new Error('Menu commands are only available to the active application menu')
  }
  return activeMenu
}

function normalizeMenuAction(input: unknown): ApplicationMenuAction {
  if (input === 'switch-server' || input === 'reload' || input === 'about' || input === 'quit') {
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
