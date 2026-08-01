export const VOICE_OVERLAY_PROTOCOL = 1

export const VOICE_OVERLAY_CAPABILITIES = [
  'voice_overlay',
] as const

export const VOICE_OVERLAY_CHANNELS = {
  hello: 'voice-overlay:hello',
  setEnabled: 'voice-overlay:set-enabled',
  state: 'voice-overlay:state',
  getState: 'voice-overlay:get-state',
} as const

export const VOICE_OVERLAY_RENDER_CHANNEL = 'voice-overlay:render'

export interface VoiceOverlayParticipant {
  identity: string
  name: string
  avatarUrl: string | null
  isLocal: boolean
  speaking: boolean
  microphoneMuted: boolean
  deafened: boolean
}

export interface VoiceOverlayState {
  channel: { name: string } | null
  participants: VoiceOverlayParticipant[]
}

export interface VoiceOverlayHello {
  protocol: number
  capabilities: string[]
}

export function normalizeVoiceOverlayEnabledRequest(input: unknown): boolean | null {
  if (!input || typeof input !== 'object') return null
  const enabled = (input as { enabled?: unknown }).enabled
  return typeof enabled === 'boolean' ? enabled : null
}

export function normalizeVoiceOverlayState(input: unknown): VoiceOverlayState | null {
  if (!input || typeof input !== 'object') return null
  const candidate = input as { channel?: unknown; participants?: unknown }

  let channel: VoiceOverlayState['channel'] = null
  if (candidate.channel !== null) {
    if (typeof candidate.channel !== 'object') return null
    const channelCandidate = candidate.channel as { name?: unknown }
    if (typeof channelCandidate.name !== 'string' || channelCandidate.name.length === 0) return null
    channel = { name: channelCandidate.name }
  }

  if (!Array.isArray(candidate.participants)) return null
  const participants: VoiceOverlayParticipant[] = []
  for (const item of candidate.participants) {
    const participant = normalizeParticipant(item)
    if (!participant) return null
    participants.push(participant)
  }

  return { channel, participants }
}

function normalizeParticipant(input: unknown): VoiceOverlayParticipant | null {
  if (!input || typeof input !== 'object') return null
  const candidate = input as Record<string, unknown>
  if (typeof candidate.identity !== 'string' || candidate.identity.length === 0) return null
  if (typeof candidate.name !== 'string') return null
  if (candidate.avatarUrl !== null && typeof candidate.avatarUrl !== 'string') return null
  if (typeof candidate.isLocal !== 'boolean') return null
  if (typeof candidate.speaking !== 'boolean') return null
  if (typeof candidate.microphoneMuted !== 'boolean') return null
  if (typeof candidate.deafened !== 'boolean') return null
  return {
    identity: candidate.identity,
    name: candidate.name,
    avatarUrl: candidate.avatarUrl,
    isLocal: candidate.isLocal,
    speaking: candidate.speaking,
    microphoneMuted: candidate.microphoneMuted,
    deafened: candidate.deafened,
  }
}
