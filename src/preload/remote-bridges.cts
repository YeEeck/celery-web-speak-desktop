const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')

// 远程服务器页面可用的全部桥。preload 只接受单文件，沙箱内无法 require 本地
// 文件，因此各桥集中在此文件；暴露给页面的 API 名是契约，不得改名。

const channels = {
  hello: 'application-audio:hello',
  getSnapshot: 'application-audio:get-snapshot',
  start: 'application-audio:start',
  pause: 'application-audio:pause',
  resume: 'application-audio:resume',
  stop: 'application-audio:stop',
  snapshot: 'application-audio:snapshot',
  pcmPort: 'application-audio:pcm-port',
} as const

const applicationAudioProtocol = 1
const pcmPortEvent = 'celery:application-audio:pcm-port'
const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const listeners = new Set<(snapshot: unknown) => void>()
const deliveredPorts = new Set<string>()
const pendingPcmPorts = new Map<string, MessagePort>()
let currentSessionId: string | null = null
let currentRevision = -1

ipcRenderer.on(channels.snapshot, (_event, snapshot: unknown) => applySnapshot(snapshot, true))
ipcRenderer.on(channels.pcmPort, (event, input: unknown) => {
  const sessionId = readSessionId(input)
  const port = event.ports[0]
  if (!sessionId || deliveredPorts.has(sessionId) || !port) {
    for (const ignored of event.ports) ignored.close()
    return
  }
  if (sessionId === currentSessionId) {
    deliverPcmPort(sessionId, port)
    return
  }
  pendingPcmPorts.get(sessionId)?.close()
  pendingPcmPorts.set(sessionId, port)
})

const bridge = Object.freeze({
  hello: (input: unknown) => {
    if (!input || typeof input !== 'object') return Promise.reject(new TypeError('Invalid protocol range'))
    const candidate = input as { minProtocol?: unknown; maxProtocol?: unknown }
    return ipcRenderer.invoke(channels.hello, {
      minProtocol: candidate.minProtocol,
      maxProtocol: candidate.maxProtocol,
    })
  },
  getSnapshot: () => invokeSnapshot(channels.getSnapshot),
  start: () => invokeSnapshot(channels.start),
  pause: (sessionId: unknown) => invokeSessionCommand(channels.pause, sessionId),
  resume: (sessionId: unknown) => invokeSessionCommand(channels.resume, sessionId),
  stop: (sessionId: unknown) => invokeSessionCommand(channels.stop, sessionId),
  onSnapshot: (listener: unknown) => {
    if (typeof listener !== 'function') throw new TypeError('Snapshot listener must be a function')
    const safeListener = listener as (snapshot: unknown) => void
    listeners.add(safeListener)
    return () => listeners.delete(safeListener)
  },
})

contextBridge.exposeInMainWorld('desktopApplicationAudio', bridge)

async function invokeSnapshot(channel: string): Promise<unknown> {
  const snapshot = await ipcRenderer.invoke(channel)
  applySnapshot(snapshot, false)
  return snapshot
}

function invokeSessionCommand(channel: string, sessionId: unknown): Promise<unknown> {
  if (typeof sessionId !== 'string' || !sessionIdPattern.test(sessionId)) {
    return Promise.reject(new TypeError('Invalid application audio session ID'))
  }
  return invokeSnapshotWithInput(channel, sessionId)
}

async function invokeSnapshotWithInput(channel: string, input: unknown): Promise<unknown> {
  const snapshot = await ipcRenderer.invoke(channel, input)
  applySnapshot(snapshot, false)
  return snapshot
}

function applySnapshot(input: unknown, notify: boolean): void {
  if (!input || typeof input !== 'object') return
  const snapshot = input as { sessionId?: unknown; revision?: unknown }
  if (!Number.isSafeInteger(snapshot.revision) || (snapshot.revision as number) < currentRevision) return
  if (snapshot.sessionId !== null &&
      (typeof snapshot.sessionId !== 'string' || !sessionIdPattern.test(snapshot.sessionId))) return
  currentRevision = snapshot.revision as number
  currentSessionId = snapshot.sessionId as string | null
  flushPendingPcmPorts()
  if (!notify) return
  for (const listener of listeners) listener(input)
}

function flushPendingPcmPorts(): void {
  for (const [sessionId, port] of pendingPcmPorts) {
    pendingPcmPorts.delete(sessionId)
    if (sessionId === currentSessionId) deliverPcmPort(sessionId, port)
    else port.close()
  }
}

function deliverPcmPort(sessionId: string, port: MessagePort): void {
  if (deliveredPorts.has(sessionId)) {
    port.close()
    return
  }
  deliveredPorts.add(sessionId)
  window.postMessage(Object.freeze({
    type: pcmPortEvent,
    protocol: applicationAudioProtocol,
    sessionId,
  }), window.location.origin, [port])
}

function readSessionId(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const sessionId = (input as { sessionId?: unknown }).sessionId
  return typeof sessionId === 'string' && sessionIdPattern.test(sessionId) ? sessionId : null
}

// ---- 语音浮层桥 ----

const voiceOverlayChannels = {
  hello: 'voice-overlay:hello',
  setEnabled: 'voice-overlay:set-enabled',
  state: 'voice-overlay:state',
} as const

const voiceOverlayBridge = Object.freeze({
  hello: (input: unknown) => ipcRenderer.invoke(voiceOverlayChannels.hello, input),
  setEnabled: (enabled: unknown) => (
    ipcRenderer.invoke(voiceOverlayChannels.setEnabled, { enabled })
  ),
  pushState: (state: unknown) => {
    ipcRenderer.send(voiceOverlayChannels.state, state)
  },
})

contextBridge.exposeInMainWorld('desktopVoiceOverlay', voiceOverlayBridge)
