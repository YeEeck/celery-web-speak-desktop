const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')

const renderChannel = 'voice-overlay:render'
const getStateChannel = 'voice-overlay:get-state'
const listeners = new Set<(state: unknown) => void>()

ipcRenderer.on(renderChannel, (_event, state: unknown) => {
  for (const listener of listeners) listener(state)
})

contextBridge.exposeInMainWorld('overlayHost', {
  getState: () => ipcRenderer.invoke(getStateChannel),
  onState: (listener: unknown) => {
    if (typeof listener !== 'function') throw new TypeError('Overlay state listener must be a function')
    const safeListener = listener as (state: unknown) => void
    listeners.add(safeListener)
    return () => listeners.delete(safeListener)
  },
})
