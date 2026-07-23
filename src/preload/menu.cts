const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')

const channels = {
  execute: 'menu:execute',
  dismiss: 'menu:dismiss',
  getState: 'menu:get-state',
} as const

contextBridge.exposeInMainWorld('desktopMenu', {
  execute: (action: string) => ipcRenderer.invoke(channels.execute, action),
  dismiss: () => ipcRenderer.invoke(channels.dismiss),
  getState: () => ipcRenderer.invoke(channels.getState),
})
