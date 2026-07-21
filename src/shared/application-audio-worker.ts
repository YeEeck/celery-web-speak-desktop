export type NativeProbeReason =
  | 'unsupported_platform'
  | 'unsupported_windows_version'
  | 'process_loopback_unavailable'

export interface NativeProbeResult {
  supported: boolean
  reason: NativeProbeReason | null
  windowsBuild: number | null
  failureStage?: 'worker_process' | 'native_module_load' | 'native_probe'
}

export type ApplicationAudioWorkerCommand =
  | { type: 'probe' }
  | { type: 'start'; sessionId: string; hwndDecimal: string }
  | { type: 'pause'; sessionId: string }
  | { type: 'resume'; sessionId: string }
  | { type: 'stop'; sessionId: string }
  | { type: 'shutdown' }

export type ApplicationAudioWorkerEvent =
  | { type: 'ready' }
  | { type: 'probe_result'; result: NativeProbeResult }
  | { type: 'started'; sessionId: string }
  | { type: 'paused'; sessionId: string }
  | { type: 'resumed'; sessionId: string }
  | { type: 'stopped'; sessionId: string }
  | { type: 'source_destroyed'; sessionId: string }
  | { type: 'source_process_exited'; sessionId: string }
  | { type: 'capture_error'; sessionId: string; stage: 'start' | 'stream' }
  | {
    type: 'statistics'
    sessionId: string
    droppedBlocks: number
    deliveredBlocks: number
    bufferedFrames: number
  }
