const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')

const channels = {
  getSources: 'application-audio-picker:get-sources',
  choose: 'application-audio-picker:choose',
  cancel: 'application-audio-picker:cancel',
} as const

contextBridge.exposeInMainWorld('applicationAudioPicker', Object.freeze({
  getSources: () => ipcRenderer.invoke(channels.getSources),
  choose: (token: string) => ipcRenderer.invoke(channels.choose, token),
  cancel: () => ipcRenderer.invoke(channels.cancel),
}))

