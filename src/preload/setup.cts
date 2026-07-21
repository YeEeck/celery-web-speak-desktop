const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')

const channels = {
  getState: 'setup:get-state',
  validate: 'setup:validate',
  save: 'setup:save',
  cancel: 'setup:cancel',
} as const

contextBridge.exposeInMainWorld('desktopSetup', {
  getState: () => ipcRenderer.invoke(channels.getState),
  validate: (serverUrl: string) => ipcRenderer.invoke(channels.validate, serverUrl),
  save: (request: { serverUrl: string; force: boolean }) => ipcRenderer.invoke(channels.save, request),
  cancel: () => ipcRenderer.invoke(channels.cancel),
})

const windowChannels = {
  getState: 'window:get-state',
  minimize: 'window:minimize',
  toggleMaximize: 'window:toggle-maximize',
  close: 'window:close',
  showMenu: 'window:show-menu',
  maximizedChanged: 'window:maximized-changed',
} as const

contextBridge.exposeInMainWorld('desktopWindow', {
  getState: () => ipcRenderer.invoke(windowChannels.getState),
  minimize: () => ipcRenderer.invoke(windowChannels.minimize),
  toggleMaximize: () => ipcRenderer.invoke(windowChannels.toggleMaximize),
  close: () => ipcRenderer.invoke(windowChannels.close),
  showMenu: (position: { x: number; y: number }) => ipcRenderer.invoke(windowChannels.showMenu, position),
  onMaximizedChange: (listener: (maximized: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => listener(maximized)
    ipcRenderer.on(windowChannels.maximizedChanged, handler)
    return () => ipcRenderer.removeListener(windowChannels.maximizedChanged, handler)
  },
})
