import { randomUUID } from 'node:crypto'
import {
  ipcMain,
  MessageChannelMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron'
import {
  APPLICATION_AUDIO_CAPABILITIES,
  APPLICATION_AUDIO_CHANNELS,
  APPLICATION_AUDIO_PROTOCOL,
  isValidApplicationAudioSessionId,
  normalizeProtocolRange,
  type ApplicationAudioError,
  type ApplicationAudioErrorCode,
  type ApplicationAudioSnapshot,
} from '../shared/application-audio-api.js'
import type { ApplicationAudioWorkerEvent, NativeProbeResult } from '../shared/application-audio-worker.js'
import { ApplicationAudioPicker } from './application-audio-picker.js'
import { isTrustedRemoteRequest } from './remote-request-policy.js'
import type { RemoteBinding } from './windows.js'
import { ApplicationAudioWorkerProcess } from './application-audio-worker.js'
import type { Logger } from './logger.js'

const ERROR_MESSAGES: Record<ApplicationAudioErrorCode, string> = {
  unsupported_platform: '当前平台不支持应用音频共享',
  unsupported_windows_version: '当前 Windows 版本不支持应用音频共享',
  process_loopback_unavailable: '系统应用音频采集能力不可用',
  source_picker_cancelled: '已取消选择应用窗口',
  source_unavailable: '所选应用窗口已不可用',
  source_process_exited: '所选应用已退出',
  capture_start_failed: '无法开始采集应用音频',
  capture_stream_failed: '应用音频采集已中断',
  bridge_incompatible: '桌面应用音频协议不兼容',
  voice_not_connected: '尚未加入语音频道',
  voice_publish_forbidden: '当前无法发布应用音频',
  livekit_publish_failed: '无法发布应用音频',
  capture_worker_exited: '应用音频采集进程已退出',
}

export class ApplicationAudioCoordinator {
  private readonly picker = new ApplicationAudioPicker()
  private remote: RemoteBinding | null = null
  private snapshot: ApplicationAudioSnapshot = {
    sessionId: null,
    revision: 0,
    state: 'idle',
    supported: false,
    error: null,
  }
  private probePromise: Promise<NativeProbeResult> | null = null
  private probeApplied = false
  private worker: ApplicationAudioWorkerProcess | null = null
  private operations: Promise<unknown> = Promise.resolve()
  private lifecycleRevision = 0

  constructor(private readonly logger: Logger) {
    ipcMain.handle(APPLICATION_AUDIO_CHANNELS.hello, (event, input: unknown) => (
      this.enqueue(() => this.hello(event, input))
    ))
    ipcMain.handle(APPLICATION_AUDIO_CHANNELS.getSnapshot, (event) => (
      this.enqueue(() => this.getSnapshot(event))
    ))
    ipcMain.handle(APPLICATION_AUDIO_CHANNELS.start, (event) => (
      this.enqueue(() => this.start(event))
    ))
    ipcMain.handle(APPLICATION_AUDIO_CHANNELS.pause, (event, sessionId: unknown) => (
      this.enqueue(() => this.pause(event, sessionId))
    ))
    ipcMain.handle(APPLICATION_AUDIO_CHANNELS.resume, (event, sessionId: unknown) => (
      this.enqueue(() => this.resume(event, sessionId))
    ))
    ipcMain.handle(APPLICATION_AUDIO_CHANNELS.stop, (event, sessionId: unknown) => {
      this.assertTrusted(event)
      if (['selecting', 'starting'].includes(this.snapshot.state) &&
          sessionId === this.snapshot.sessionId) {
        this.invalidateActiveCapture()
      }
      return this.enqueue(() => this.stop(event, sessionId))
    })
  }

  bindRemote(window: BrowserWindow, webContents: WebContents, serverUrl: string): void {
    this.unbindRemote()
    const binding: RemoteBinding = {
      window,
      webContents,
      serverUrl,
    }
    this.remote = binding
    webContents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
      if (isMainFrame && this.remote === binding && this.snapshot.sessionId) {
        this.invalidateActiveCapture()
        void this.enqueue(() => this.stopInternal(null))
      }
    })
    webContents.on('render-process-gone', () => {
      if (this.remote === binding) this.unbindRemote()
    })
    webContents.on('destroyed', () => {
      if (this.remote === binding) this.unbindRemote()
    })
  }

  unbindRemote(): void {
    if (!this.remote && !this.snapshot.sessionId && !this.worker) return
    this.remote = null
    this.invalidateActiveCapture()
    void this.enqueue(() => this.stopInternal(null))
  }

  shutdown(): void {
    this.remote = null
    this.invalidateActiveCapture()
  }

  private async hello(event: IpcMainInvokeEvent, input: unknown) {
    this.assertTrusted(event)
    const range = normalizeProtocolRange(input)
    if (!range) throw new Error('Invalid application audio protocol range')
    const probe = await this.ensureProbe()
    const compatible = range.minProtocol <= APPLICATION_AUDIO_PROTOCOL &&
      range.maxProtocol >= APPLICATION_AUDIO_PROTOCOL
    return {
      protocol: APPLICATION_AUDIO_PROTOCOL,
      capabilities: probe.supported && compatible ? [...APPLICATION_AUDIO_CAPABILITIES] : [],
    }
  }

  private async getSnapshot(event: IpcMainInvokeEvent): Promise<ApplicationAudioSnapshot> {
    this.assertTrusted(event)
    await this.ensureProbe()
    return this.copySnapshot()
  }

  private async start(event: IpcMainInvokeEvent): Promise<ApplicationAudioSnapshot> {
    const binding = this.assertTrusted(event)
    const probe = await this.ensureProbe()
    if (!probe.supported) return this.copySnapshot()
    if (this.snapshot.sessionId || this.snapshot.state !== 'idle') return this.copySnapshot()

    const sessionId = randomUUID()
    const lifecycleRevision = this.lifecycleRevision
    this.transition({ sessionId, state: 'selecting', supported: true, error: null })
    const selection = await this.picker.open(binding.window)
    if (!selection || this.remote !== binding || lifecycleRevision !== this.lifecycleRevision) {
      this.transition({ sessionId: null, state: 'idle', supported: true, error: null })
      return this.copySnapshot()
    }

    this.transition({ sessionId, state: 'starting', supported: true, error: null })
    const channel = new MessageChannelMain()
    try {
      const worker = await ApplicationAudioWorkerProcess.create({
        onEvent: (workerEvent) => this.handleWorkerEvent(workerEvent),
        onExit: () => this.handleWorkerExit(),
      })
      if (this.remote !== binding || this.snapshot.sessionId !== sessionId ||
          lifecycleRevision !== this.lifecycleRevision) {
        worker.terminate()
        channel.port1.close()
        channel.port2.close()
        return this.copySnapshot()
      }
      this.worker = worker
      await worker.start(sessionId, selection.hwndDecimal, channel.port1)
      if (this.remote !== binding || this.snapshot.sessionId !== sessionId ||
          lifecycleRevision !== this.lifecycleRevision) {
        worker.terminate()
        channel.port2.close()
        return this.copySnapshot()
      }
      this.transition({ sessionId, state: 'playing', supported: true, error: null })
      binding.webContents.postMessage(
        APPLICATION_AUDIO_CHANNELS.pcmPort,
        { sessionId },
        [channel.port2],
      )
      this.logger.info('application_audio_started')
    } catch {
      channel.port1.close()
      channel.port2.close()
      await this.stopInternal(lifecycleRevision === this.lifecycleRevision
        ? applicationAudioError('capture_start_failed')
        : null)
    }
    return this.copySnapshot()
  }

  private async pause(event: IpcMainInvokeEvent, input: unknown): Promise<ApplicationAudioSnapshot> {
    this.assertTrusted(event)
    const sessionId = this.assertCurrentSession(input)
    if (this.snapshot.state === 'paused') return this.copySnapshot()
    if (this.snapshot.state !== 'playing' || !this.worker) throw new Error('Capture is not playing')
    try {
      await this.worker.pause(sessionId)
      this.transition({ sessionId, state: 'paused', supported: true, error: null })
      this.logger.info('application_audio_paused')
    } catch {
      await this.stopInternal(applicationAudioError('capture_stream_failed'))
    }
    return this.copySnapshot()
  }

  private async resume(event: IpcMainInvokeEvent, input: unknown): Promise<ApplicationAudioSnapshot> {
    this.assertTrusted(event)
    const sessionId = this.assertCurrentSession(input)
    if (this.snapshot.state === 'playing') return this.copySnapshot()
    if (this.snapshot.state !== 'paused' || !this.worker) throw new Error('Capture is not paused')
    try {
      await this.worker.resume(sessionId)
      this.transition({ sessionId, state: 'playing', supported: true, error: null })
      this.logger.info('application_audio_resumed')
    } catch {
      await this.stopInternal(applicationAudioError('capture_stream_failed'))
    }
    return this.copySnapshot()
  }

  private async stop(event: IpcMainInvokeEvent, input: unknown): Promise<ApplicationAudioSnapshot> {
    this.assertTrusted(event)
    if (!this.snapshot.sessionId) return this.copySnapshot()
    this.assertCurrentSession(input)
    await this.stopInternal(null)
    return this.copySnapshot()
  }

  private async stopInternal(error: ApplicationAudioError | null): Promise<void> {
    const sessionId = this.snapshot.sessionId
    const worker = this.worker
    this.worker = null
    if (sessionId && this.snapshot.state !== 'stopping') {
      this.transition({ sessionId, state: 'stopping', supported: this.snapshot.supported, error: null })
    }
    if (worker) {
      try {
        if (sessionId) await worker.stop(sessionId)
        else worker.terminate()
      } catch {
        worker.terminate()
        if (!error) error = applicationAudioError('capture_worker_exited')
      }
    }

    if (error && sessionId) {
      this.transition({
        sessionId,
        state: 'error',
        supported: this.snapshot.supported,
        error,
      })
      this.logger.warn('application_audio_failed', { code: error.code })
    } else if (sessionId) {
      this.logger.info('application_audio_stopped')
    }
    this.transition({
      sessionId: null,
      state: 'idle',
      supported: this.snapshot.supported,
      error: null,
    })
  }

  private handleWorkerEvent(event: ApplicationAudioWorkerEvent): void {
    if ('sessionId' in event && event.sessionId !== this.snapshot.sessionId) return
    switch (event.type) {
      case 'source_destroyed':
        void this.enqueue(() => this.stopInternal(applicationAudioError('source_unavailable')))
        break
      case 'source_process_exited':
        void this.enqueue(() => this.stopInternal(applicationAudioError('source_process_exited')))
        break
      case 'capture_error':
        void this.enqueue(() => this.stopInternal(applicationAudioError(
          event.stage === 'start' ? 'capture_start_failed' : 'capture_stream_failed',
        )))
        break
      case 'statistics':
        this.logger.info('application_audio_statistics', {
          droppedBlocks: event.droppedBlocks,
          deliveredBlocks: event.deliveredBlocks,
          bufferedFrames: event.bufferedFrames,
        })
        break
    }
  }

  private handleWorkerExit(): void {
    if (!this.worker || !this.snapshot.sessionId) return
    this.worker = null
    void this.enqueue(() => this.stopInternal(applicationAudioError('capture_worker_exited')))
  }

  private invalidateActiveCapture(): void {
    ++this.lifecycleRevision
    this.picker.close()
    this.worker?.terminate()
    this.worker = null
  }

  private async ensureProbe(): Promise<NativeProbeResult> {
    this.probePromise ??= ApplicationAudioWorkerProcess.probe()
    const result = await this.probePromise
    if (!this.probeApplied && !this.snapshot.sessionId) {
      this.probeApplied = true
      this.logger.info('application_audio_probe', {
        supported: result.supported,
        reason: result.reason,
        windowsBuild: result.windowsBuild,
        failureStage: result.failureStage ?? null,
        workerFailure: result.workerFailure ?? null,
        workerExitCode: result.workerExitCode ?? null,
      })
      this.snapshot = {
        ...this.snapshot,
        revision: this.snapshot.revision + 1,
        supported: result.supported,
        error: result.supported ? null : applicationAudioError(result.reason ?? 'process_loopback_unavailable'),
      }
    }
    return result
  }

  private assertTrusted(event: IpcMainInvokeEvent): RemoteBinding {
    const remote = this.remote
    const senderFrame = event.senderFrame
    const topFrame = Boolean(senderFrame &&
      senderFrame.parent === null &&
      senderFrame.frameTreeNodeId === event.sender.mainFrame.frameTreeNodeId)
    if (!remote || !isTrustedRemoteRequest({
      activeRemote: true,
      senderMatches: event.sender === remote.webContents,
      topFrame,
      senderUrl: event.sender.getURL(),
      serverUrl: remote.serverUrl,
    })) {
      throw new Error('Application audio IPC is only available to the active remote page')
    }
    return remote
  }

  private assertCurrentSession(input: unknown): string {
    if (!isValidApplicationAudioSessionId(input) || input !== this.snapshot.sessionId) {
      throw new Error('Application audio session does not match')
    }
    return input
  }

  private transition(next: Omit<ApplicationAudioSnapshot, 'revision'>): void {
    this.snapshot = { ...next, revision: this.snapshot.revision + 1 }
    const remote = this.remote
    if (remote && !remote.webContents.isDestroyed()) {
      remote.webContents.send(APPLICATION_AUDIO_CHANNELS.snapshot, this.copySnapshot())
    }
  }

  private copySnapshot(): ApplicationAudioSnapshot {
    return {
      sessionId: this.snapshot.sessionId,
      revision: this.snapshot.revision,
      state: this.snapshot.state,
      supported: this.snapshot.supported,
      error: this.snapshot.error ? { ...this.snapshot.error } : null,
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(operation, operation)
    this.operations = result.catch(() => undefined)
    return result
  }
}

function applicationAudioError(code: ApplicationAudioErrorCode): ApplicationAudioError {
  return { code, message: ERROR_MESSAGES[code] }
}
