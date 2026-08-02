import { normalizeProtocolRange } from './protocol-api.js'
import type { ProtocolHello, ProtocolRange } from './protocol-api.js'

// 协议 3：浮层窗口尺寸由页面测量上报（report-content-size），壳层不再预测行高。
// 协议 2 及以下为旧协议：协商回退时浮层整体禁用。
export const VOICE_OVERLAY_PROTOCOL = 3

export const VOICE_OVERLAY_CAPABILITIES = [
  'voice_overlay',
] as const

// Web 页面与桌面壳之间的桥通道，与设计文档「语音浮层桥协议」的通道表一致。
export const VOICE_OVERLAY_CHANNELS = {
  hello: 'voice-overlay:hello',
  setEnabled: 'voice-overlay:set-enabled',
  state: 'voice-overlay:state',
  setConfig: 'voice-overlay:set-config',
} as const

// 本地浮层窗口的渲染通道，不属于 Web 桥契约。
export const OVERLAY_WINDOW_CHANNELS = {
  render: 'voice-overlay:render',
  getState: 'voice-overlay:get-state',
  pushConfig: 'voice-overlay:push-config',
  reportContentSize: 'voice-overlay:report-content-size',
} as const

export type VoiceOverlayHello = ProtocolHello

// 按 Web 声明的范围协商本壳协议：返回相交的最高协议号，不兼容时返回 0。
export function negotiateOverlayProtocol(range: ProtocolRange): number {
  if (range.minProtocol > VOICE_OVERLAY_PROTOCOL) return 0
  return Math.min(range.maxProtocol, VOICE_OVERLAY_PROTOCOL)
}

export const DEFAULT_VOICE_OVERLAY_CONFIG: VoiceOverlayConfig = {
  scalePercent: 100,
  positionXPercent: 9,
  positionYPercent: 50,
  speakingOpacityPercent: 80,
  silentOpacityPercent: 40,
}

export const VOICE_OVERLAY_CONFIG_LIMITS = {
  scalePercent: { min: 50, max: 150 },
  positionPercent: { min: 0, max: 100 },
  opacityPercent: { min: 10, max: 100 },
} as const

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

export interface VoiceOverlayConfig {
  scalePercent: number          // 显示大小，相对基准 280×300 等比缩放；50~150，默认 100
  positionXPercent: number      // 窗口中心点的屏幕 X 百分比；0~100
  positionYPercent: number      // 窗口中心点的屏幕 Y 百分比；0~100
  speakingOpacityPercent: number    // 说话时整行不透明度；10~100，默认 80
  silentOpacityPercent: number      // 未说话时整行不透明度；10~100，默认 40
}

// 浮层页面上报的内容尺寸（CSS 像素，含 zoom 缩放）；壳层据此设置窗口大小。
export interface ContentSize {
  width: number
  height: number
}

function clampPercent(value: number, limit: { min: number; max: number }): number {
  return Math.min(limit.max, Math.max(limit.min, value))
}

export function normalizeVoiceOverlayConfig(input: unknown): VoiceOverlayConfig | null {
  if (!input || typeof input !== 'object') return null
  const candidate = input as Record<string, unknown>
  if (!Number.isFinite(candidate.scalePercent) || !Number.isFinite(candidate.positionXPercent) ||
      !Number.isFinite(candidate.positionYPercent) || !Number.isFinite(candidate.speakingOpacityPercent) ||
      !Number.isFinite(candidate.silentOpacityPercent)) {
    return null
  }
  return {
    scalePercent: clampPercent(candidate.scalePercent as number, VOICE_OVERLAY_CONFIG_LIMITS.scalePercent),
    positionXPercent: clampPercent(candidate.positionXPercent as number, VOICE_OVERLAY_CONFIG_LIMITS.positionPercent),
    positionYPercent: clampPercent(candidate.positionYPercent as number, VOICE_OVERLAY_CONFIG_LIMITS.positionPercent),
    speakingOpacityPercent: clampPercent(candidate.speakingOpacityPercent as number, VOICE_OVERLAY_CONFIG_LIMITS.opacityPercent),
    silentOpacityPercent: clampPercent(candidate.silentOpacityPercent as number, VOICE_OVERLAY_CONFIG_LIMITS.opacityPercent),
  }
}

export function normalizeVoiceOverlayEnabledRequest(input: unknown): boolean | null {
  if (!input || typeof input !== 'object') return null
  const enabled = (input as { enabled?: unknown }).enabled
  return typeof enabled === 'boolean' ? enabled : null
}

// 内容尺寸钳制到 ≥ 1；上限（工作区大小）由壳层在应用时校验。
export function normalizeContentSize(input: unknown): ContentSize | null {
  if (!input || typeof input !== 'object') return null
  const candidate = input as Record<string, unknown>
  if (!Number.isFinite(candidate.width) || !Number.isFinite(candidate.height)) return null
  return {
    width: Math.max(1, Math.round(candidate.width as number)),
    height: Math.max(1, Math.round(candidate.height as number)),
  }
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
