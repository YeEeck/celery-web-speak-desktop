import { app, dialog, Menu, type BrowserWindow } from 'electron'
import type { WindowMenuPosition } from '../shared/window-api.js'

export interface MenuActions {
  switchServer(): void
  reload(): void
}

export function disableApplicationMenu(): void {
  Menu.setApplicationMenu(null)
}

export function showApplicationMenu(
  window: BrowserWindow,
  position: WindowMenuPosition,
  remoteMode: boolean,
  actions: MenuActions,
): void {
  const template: Electron.MenuItemConstructorOptions[] = []

  if (remoteMode) {
    template.push(
      { label: '切换服务器', click: () => actions.switchServer() },
      { label: '重新加载', accelerator: 'CmdOrCtrl+R', click: () => actions.reload() },
      { type: 'separator' },
    )
  }

  template.push(
    {
      label: '关于 Celery Web Speak',
      click: () => {
        void dialog.showMessageBox(window, {
          type: 'info',
          title: 'Celery Web Speak',
          message: 'Celery Web Speak',
          detail: `桌面客户端 ${app.getVersion()}`,
        })
      },
    },
    { type: 'separator' },
    { role: 'quit', label: '退出' },
  )

  Menu.buildFromTemplate(template).popup({
    window,
    x: position.x,
    y: position.y,
  })
}
