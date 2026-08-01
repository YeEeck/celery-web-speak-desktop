const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')

const renderChannel = 'voice-overlay:render'
const getStateChannel = 'voice-overlay:get-state'
const pushConfigChannel = 'voice-overlay:push-config'
const stateListeners = new Set<(state: unknown) => void>()
const configListeners = new Set<(config: unknown) => void>()

ipcRenderer.on(renderChannel, (_event, state: unknown) => {
  for (const listener of stateListeners) listener(state)
})

ipcRenderer.on(pushConfigChannel, (_event, config: unknown) => {
  for (const listener of configListeners) listener(config)
})

function subscribe(listeners: Set<(value: unknown) => void>, listener: unknown): () => void {
  if (typeof listener !== 'function') throw new TypeError('Overlay listener must be a function')
  const safeListener = listener as (value: unknown) => void
  listeners.add(safeListener)
  return () => listeners.delete(safeListener)
}

contextBridge.exposeInMainWorld('overlayHost', {
  getState: () => ipcRenderer.invoke(getStateChannel),
  onState: (listener: unknown) => subscribe(stateListeners, listener),
  onConfig: (listener: unknown) => subscribe(configListeners, listener),
})
