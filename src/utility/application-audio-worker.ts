import { createRequire } from 'node:module'
import { parentPort, type MessagePortMain } from 'electron'
import type {
  ApplicationAudioWorkerCommand,
  ApplicationAudioWorkerEvent,
  NativeProbeResult,
} from '../shared/application-audio-worker.js'
import { isValidApplicationAudioSessionId } from '../shared/application-audio-api.js'

interface NativeCaptureEvent {
  type: 'started' | 'pcm' | 'source_destroyed' | 'source_process_exited' | 'capture_error'
  frames?: number
  data?: ArrayBuffer
}

interface NativeCaptureSnapshot {
  deliveredBlocks: number
  droppedBlocks: number
  bufferedFrames: number
}

interface NativeCapture {
  start(options: { hwndDecimal: string }, listener: (event: NativeCaptureEvent) => void): void
  pause(): void
  resume(): void
  stop(): void
  snapshot(): NativeCaptureSnapshot
}

interface NativeModule {
  probe(): NativeProbeResult
  ApplicationAudioCapture: new () => NativeCapture
}

const require = createRequire(import.meta.url)
let nativeModule: NativeModule | null = null
let capture: NativeCapture | null = null
let sessionId: string | null = null
let pcmPort: MessagePortMain | null = null
let sequence = 0
let started = false
let statisticsTimer: NodeJS.Timeout | null = null

parentPort.on('message', (event) => {
  void handleMessage(event.data, event.ports).catch(() => {
    if (sessionId) send({ type: 'capture_error', sessionId, stage: started ? 'stream' : 'start' })
    cleanupCapture()
  })
})

send({ type: 'ready' })

async function handleMessage(input: unknown, ports: MessagePortMain[]): Promise<void> {
  if (!input || typeof input !== 'object') throw new Error('Invalid worker command')
  const command = input as Partial<ApplicationAudioWorkerCommand>
  switch (command.type) {
    case 'probe':
      send({ type: 'probe_result', result: probe() })
      return
    case 'start':
      if (!isValidApplicationAudioSessionId(command.sessionId) ||
          typeof command.hwndDecimal !== 'string' || !/^[1-9][0-9]*$/.test(command.hwndDecimal) ||
          ports.length !== 1 || capture) {
        throw new Error('Invalid capture start command')
      }
      start(command.sessionId, command.hwndDecimal, ports[0] as MessagePortMain)
      return
    case 'pause':
      assertCurrentSession(command.sessionId)
      capture?.pause()
      send({ type: 'paused', sessionId: command.sessionId })
      return
    case 'resume':
      assertCurrentSession(command.sessionId)
      capture?.resume()
      send({ type: 'resumed', sessionId: command.sessionId })
      return
    case 'stop': {
      assertCurrentSession(command.sessionId)
      const stoppedSessionId = command.sessionId
      cleanupCapture()
      send({ type: 'stopped', sessionId: stoppedSessionId })
      return
    }
    case 'shutdown':
      cleanupCapture()
      setImmediate(() => process.exit(0))
      return
    default:
      throw new Error('Unknown worker command')
  }
}

function probe(): NativeProbeResult {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    return { supported: false, reason: 'unsupported_platform', windowsBuild: null }
  }
  try {
    return loadNativeModule().probe()
  } catch {
    return { supported: false, reason: 'process_loopback_unavailable', windowsBuild: null }
  }
}

function start(nextSessionId: string, hwndDecimal: string, port: MessagePortMain): void {
  const NativeCapture = loadNativeModule().ApplicationAudioCapture
  capture = new NativeCapture()
  sessionId = nextSessionId
  pcmPort = port
  sequence = 0
  started = false
  port.start()
  capture.start({ hwndDecimal }, handleNativeEvent)
  statisticsTimer = setInterval(sendStatistics, 5_000)
  statisticsTimer.unref()
}

function handleNativeEvent(event: NativeCaptureEvent): void {
  const currentSessionId = sessionId
  if (!currentSessionId || !capture) return
  switch (event.type) {
    case 'started':
      started = true
      send({ type: 'started', sessionId: currentSessionId })
      break
    case 'pcm': {
      if (!started || !pcmPort || !(event.data instanceof ArrayBuffer) ||
          !Number.isSafeInteger(event.frames) || (event.frames as number) <= 0) return
      pcmPort.postMessage({
        sessionId: currentSessionId,
        sequence: sequence++,
        frames: event.frames,
        channels: 2,
        sampleRate: 48_000,
        data: event.data,
      })
      break
    }
    case 'source_destroyed':
      send({ type: 'source_destroyed', sessionId: currentSessionId })
      cleanupCapture()
      break
    case 'source_process_exited':
      send({ type: 'source_process_exited', sessionId: currentSessionId })
      cleanupCapture()
      break
    case 'capture_error':
      send({ type: 'capture_error', sessionId: currentSessionId, stage: started ? 'stream' : 'start' })
      cleanupCapture()
      break
  }
}

function sendStatistics(): void {
  if (!capture || !sessionId) return
  const statistics = capture.snapshot()
  send({
    type: 'statistics',
    sessionId,
    droppedBlocks: statistics.droppedBlocks,
    deliveredBlocks: statistics.deliveredBlocks,
    bufferedFrames: statistics.bufferedFrames,
  })
}

function cleanupCapture(): void {
  if (statisticsTimer) clearInterval(statisticsTimer)
  statisticsTimer = null
  try {
    capture?.stop()
  } catch {
    // The utility process is disposable; cleanup remains idempotent after native failure.
  }
  capture = null
  sessionId = null
  started = false
  sequence = 0
  try {
    pcmPort?.close()
  } catch {
    // The remote end may already be gone.
  }
  pcmPort = null
}

function loadNativeModule(): NativeModule {
  if (nativeModule) return nativeModule
  const nativePath = process.env.CWS_APPLICATION_AUDIO_NATIVE
  if (!nativePath) throw new Error('Application audio native module path is missing')
  nativeModule = require(nativePath) as NativeModule
  return nativeModule
}

function assertCurrentSession(candidate: unknown): asserts candidate is string {
  if (!isValidApplicationAudioSessionId(candidate) || candidate !== sessionId || !capture) {
    throw new Error('Application audio session is not active')
  }
}

function send(event: ApplicationAudioWorkerEvent): void {
  parentPort.postMessage(event)
}

process.on('exit', cleanupCapture)
process.on('SIGTERM', () => {
  cleanupCapture()
  process.exit(0)
})

