import type { ProtocolHello, ProtocolRange } from './protocol-api.js'

export const APPLICATION_AUDIO_PROTOCOL = 1
export const APPLICATION_AUDIO_PCM_PORT_EVENT = 'celery:application-audio:pcm-port'

export const APPLICATION_AUDIO_CAPABILITIES = [
  'application_audio_capture',
  'application_audio_source_picker',
  'application_audio_pcm_port',
] as const

export const APPLICATION_AUDIO_CHANNELS = {
  hello: 'application-audio:hello',
  getSnapshot: 'application-audio:get-snapshot',
  start: 'application-audio:start',
  pause: 'application-audio:pause',
  resume: 'application-audio:resume',
  stop: 'application-audio:stop',
  snapshot: 'application-audio:snapshot',
  pcmPort: 'application-audio:pcm-port',
} as const

export const APPLICATION_AUDIO_PICKER_CHANNELS = {
  getSources: 'application-audio-picker:get-sources',
  choose: 'application-audio-picker:choose',
  cancel: 'application-audio-picker:cancel',
} as const

export type ApplicationAudioState =
  | 'idle'
  | 'selecting'
  | 'starting'
  | 'playing'
  | 'paused'
  | 'stopping'
  | 'error'

export type ApplicationAudioErrorCode =
  | 'unsupported_platform'
  | 'unsupported_windows_version'
  | 'process_loopback_unavailable'
  | 'source_picker_cancelled'
  | 'source_unavailable'
  | 'source_process_exited'
  | 'capture_start_failed'
  | 'capture_stream_failed'
  | 'bridge_incompatible'
  | 'voice_not_connected'
  | 'voice_publish_forbidden'
  | 'livekit_publish_failed'
  | 'capture_worker_exited'

export interface ApplicationAudioError {
  code: ApplicationAudioErrorCode
  message: string
}

export interface ApplicationAudioSnapshot {
  sessionId: string | null
  revision: number
  state: ApplicationAudioState
  supported: boolean
  error: ApplicationAudioError | null
}

export interface ApplicationAudioPcmPortMessage {
  sessionId: string
}

export interface ApplicationAudioPcmBlock {
  sessionId: string
  sequence: number
  frames: number
  channels: 2
  sampleRate: 48000
  data: ArrayBuffer
}

export interface ApplicationAudioPickerSource {
  token: string
  title: string
  thumbnailDataUrl: string
  appIconDataUrl: string | null
}

export interface DesktopApplicationAudio {
  hello(input: ProtocolRange): Promise<ProtocolHello>
  getSnapshot(): Promise<ApplicationAudioSnapshot>
  start(): Promise<ApplicationAudioSnapshot>
  pause(sessionId: string): Promise<ApplicationAudioSnapshot>
  resume(sessionId: string): Promise<ApplicationAudioSnapshot>
  stop(sessionId: string): Promise<ApplicationAudioSnapshot>
  onSnapshot(listener: (snapshot: ApplicationAudioSnapshot) => void): () => void
}

export function isValidApplicationAudioSessionId(input: unknown): input is string {
  return typeof input === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input)
}

export type { ProtocolRange, ProtocolHello } from './protocol-api.js'
export { normalizeProtocolRange } from './protocol-api.js'
