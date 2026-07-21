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
