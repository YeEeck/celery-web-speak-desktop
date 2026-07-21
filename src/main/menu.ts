import { app, dialog, Menu, type BrowserWindow } from 'electron'

export interface MenuActions {
  currentWindow(): BrowserWindow | null
  switchServer(): void
}

export function installApplicationMenu(actions: MenuActions): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '服务器',
      submenu: [
        { label: '切换服务器', click: () => actions.switchServer() },
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', click: () => actions.currentWindow()?.webContents.reload() },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { role: 'close', label: '关闭' },
      ],
    },
  ]

  if (!app.isPackaged) {
    template.push({
      label: '开发',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    })
  }

  template.push({
    label: '帮助',
    submenu: [
      {
        label: '关于 Celery Web Speak',
        click: () => {
          void dialog.showMessageBox({
            type: 'info',
            title: 'Celery Web Speak',
            message: 'Celery Web Speak',
            detail: `桌面客户端 ${app.getVersion()}`,
          })
        },
      },
    ],
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
