const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')

const channels = {
  getState: 'window:get-state',
  minimize: 'window:minimize',
  toggleMaximize: 'window:toggle-maximize',
  close: 'window:close',
  showMenu: 'window:show-menu',
  maximizedChanged: 'window:maximized-changed',
} as const

contextBridge.exposeInMainWorld('desktopWindow', {
  getState: () => ipcRenderer.invoke(channels.getState),
  minimize: () => ipcRenderer.invoke(channels.minimize),
  toggleMaximize: () => ipcRenderer.invoke(channels.toggleMaximize),
  close: () => ipcRenderer.invoke(channels.close),
  showMenu: (position: { x: number; y: number }) => ipcRenderer.invoke(channels.showMenu, position),
  onMaximizedChange: (listener: (maximized: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => listener(maximized)
    ipcRenderer.on(channels.maximizedChanged, handler)
    return () => ipcRenderer.removeListener(channels.maximizedChanged, handler)
  },
})
