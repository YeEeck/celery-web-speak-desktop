import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  utilityProcess,
  type MessagePortMain,
  type UtilityProcess,
} from 'electron'
import type {
  ApplicationAudioWorkerCommand,
  ApplicationAudioWorkerEvent,
  NativeProbeResult,
} from '../shared/application-audio-worker.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_TIMEOUT_MS = 5_000
const START_TIMEOUT_MS = 10_000

interface Waiter {
  matches(event: ApplicationAudioWorkerEvent): boolean
  resolve(event: ApplicationAudioWorkerEvent): void
  reject(error: Error): void
  timer: NodeJS.Timeout
}

type WorkerFailure = NonNullable<NativeProbeResult['workerFailure']>

class ApplicationAudioWorkerError extends Error {
  constructor(
    readonly failure: WorkerFailure,
    readonly exitCode: number | null = null,
  ) {
    super(`Application audio worker failed: ${failure}`)
  }
}

export interface ApplicationAudioWorkerCallbacks {
  onEvent(event: ApplicationAudioWorkerEvent): void
  onExit(): void
}

export class ApplicationAudioWorkerProcess {
  private readonly child: UtilityProcess
  private readonly waiters = new Set<Waiter>()
  private intentionalExit = false
  private exited = false

  private constructor(callbacks: ApplicationAudioWorkerCallbacks) {
    this.child = utilityProcess.fork(
      path.join(currentDirectory, '..', 'utility', 'application-audio-worker.js'),
      [],
      {
        env: utilityEnvironment(),
        serviceName: 'Application Audio Capture',
        stdio: 'ignore',
      },
    )
    this.child.on('message', (input: unknown) => {
      if (!isWorkerEvent(input)) return
      for (const waiter of this.waiters) {
        if (!waiter.matches(input)) continue
        clearTimeout(waiter.timer)
        this.waiters.delete(waiter)
        waiter.resolve(input)
        break
      }
      callbacks.onEvent(input)
    })
    this.child.on('exit', (code) => {
      this.exited = true
      this.rejectWaiters(new ApplicationAudioWorkerError('exit_before_response', code))
      if (!this.intentionalExit) callbacks.onExit()
    })
    this.child.on('error', () => {
      this.rejectWaiters(new ApplicationAudioWorkerError('spawn_error'))
    })
  }

  static async create(callbacks: ApplicationAudioWorkerCallbacks): Promise<ApplicationAudioWorkerProcess> {
    const worker = new ApplicationAudioWorkerProcess(callbacks)
    await worker.waitFor((event) => event.type === 'ready', DEFAULT_TIMEOUT_MS, 'ready_timeout')
    return worker
  }

  static async probe(): Promise<NativeProbeResult> {
    if (process.platform !== 'win32' || process.arch !== 'x64') {
      return { supported: false, reason: 'unsupported_platform', windowsBuild: null }
    }
    let worker: ApplicationAudioWorkerProcess | null = null
    try {
      worker = await ApplicationAudioWorkerProcess.create({ onEvent: () => undefined, onExit: () => undefined })
      const response = await worker.request(
        { type: 'probe' },
        (event): event is Extract<ApplicationAudioWorkerEvent, { type: 'probe_result' }> => (
          event.type === 'probe_result'
        ),
      )
      return response.result
    } catch (error) {
      const workerError = error instanceof ApplicationAudioWorkerError ? error : null
      return {
        supported: false,
        reason: 'process_loopback_unavailable',
        windowsBuild: null,
        failureStage: 'worker_process',
        workerFailure: workerError?.failure ?? 'exit_before_response',
        workerExitCode: workerError?.exitCode ?? null,
      }
    } finally {
      worker?.shutdown()
    }
  }

  async start(sessionId: string, hwndDecimal: string, pcmPort: MessagePortMain): Promise<void> {
    const waiting = this.waitFor(
      (event) => 'sessionId' in event && event.sessionId === sessionId && [
        'started',
        'capture_error',
        'source_destroyed',
        'source_process_exited',
      ].includes(event.type),
      START_TIMEOUT_MS,
    )
    this.post({ type: 'start', sessionId, hwndDecimal }, [pcmPort])
    const result = await waiting
    if (result.type !== 'started') throw new Error('Application audio capture failed to start')
  }

  async pause(sessionId: string): Promise<void> {
    await this.request<Extract<ApplicationAudioWorkerEvent, { type: 'paused' }>>(
      { type: 'pause', sessionId },
      (event): event is Extract<ApplicationAudioWorkerEvent, { type: 'paused' }> => (
        event.type === 'paused' && event.sessionId === sessionId
      ),
    )
  }

  async resume(sessionId: string): Promise<void> {
    await this.request<Extract<ApplicationAudioWorkerEvent, { type: 'resumed' }>>(
      { type: 'resume', sessionId },
      (event): event is Extract<ApplicationAudioWorkerEvent, { type: 'resumed' }> => (
        event.type === 'resumed' && event.sessionId === sessionId
      ),
    )
  }

  async stop(sessionId: string): Promise<void> {
    await this.request<Extract<ApplicationAudioWorkerEvent, { type: 'stopped' }>>(
      { type: 'stop', sessionId },
      (event): event is Extract<ApplicationAudioWorkerEvent, { type: 'stopped' }> => (
        event.type === 'stopped' && event.sessionId === sessionId
      ),
    )
    this.shutdown()
  }

  terminate(): void {
    this.intentionalExit = true
    this.rejectWaiters(new Error('Application audio worker terminated'))
    if (!this.exited) this.child.kill()
  }

  private async request<T extends ApplicationAudioWorkerEvent>(
    command: ApplicationAudioWorkerCommand,
    matches: (event: ApplicationAudioWorkerEvent) => event is T,
  ): Promise<T> {
    const waiting = this.waitFor(matches)
    this.post(command)
    return await waiting as T
  }

  private post(command: ApplicationAudioWorkerCommand, ports: MessagePortMain[] = []): void {
    if (this.exited) throw new Error('Application audio worker is not running')
    this.child.postMessage(command, ports)
  }

  private waitFor(
    matches: (event: ApplicationAudioWorkerEvent) => boolean,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    timeoutFailure: WorkerFailure = 'response_timeout',
  ): Promise<ApplicationAudioWorkerEvent> {
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        matches,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter)
          this.terminate()
          reject(new ApplicationAudioWorkerError(timeoutFailure))
        }, timeoutMs),
      }
      this.waiters.add(waiter)
    })
  }

  private shutdown(): void {
    if (this.exited || this.intentionalExit) return
    this.intentionalExit = true
    try {
      this.post({ type: 'shutdown' })
    } catch {
      this.child.kill()
    }
  }

  private rejectWaiters(error: Error): void {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    this.waiters.clear()
  }
}

function utilityEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    CWS_APPLICATION_AUDIO_NATIVE: path.join(
      currentDirectory,
      '..',
      'native',
      'win32-x64',
      'application_audio.node',
    ),
  }
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']) {
    if (process.env[name]) environment[name] = process.env[name]
  }
  return environment
}

function isWorkerEvent(input: unknown): input is ApplicationAudioWorkerEvent {
  if (!input || typeof input !== 'object' || typeof (input as { type?: unknown }).type !== 'string') {
    return false
  }
  const type = (input as { type: string }).type
  return [
    'ready',
    'probe_result',
    'started',
    'paused',
    'resumed',
    'stopped',
    'source_destroyed',
    'source_process_exited',
    'capture_error',
    'statistics',
  ].includes(type)
}
