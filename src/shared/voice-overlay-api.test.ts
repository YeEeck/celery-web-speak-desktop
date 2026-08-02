import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VOICE_OVERLAY_CONFIG,
  OVERLAY_WINDOW_CHANNELS,
  VOICE_OVERLAY_CAPABILITIES,
  VOICE_OVERLAY_CHANNELS,
  VOICE_OVERLAY_PROTOCOL,
  negotiateOverlayProtocol,
  normalizeContentSize,
  normalizeVoiceOverlayConfig,
  normalizeVoiceOverlayEnabledRequest,
  normalizeVoiceOverlayState,
} from './voice-overlay-api.js'

describe('voice overlay API', () => {
  it('uses the cross-repository protocol number and capability', () => {
    expect(VOICE_OVERLAY_PROTOCOL).toBe(3)
    expect(VOICE_OVERLAY_CAPABILITIES).toEqual(['voice_overlay'])
  })

  it('uses the agreed bridge channel names', () => {
    expect(VOICE_OVERLAY_CHANNELS).toEqual({
      hello: 'voice-overlay:hello',
      setEnabled: 'voice-overlay:set-enabled',
      state: 'voice-overlay:state',
      setConfig: 'voice-overlay:set-config',
    })
  })

  it('uses the local overlay window channel names', () => {
    expect(OVERLAY_WINDOW_CHANNELS).toEqual({
      render: 'voice-overlay:render',
      getState: 'voice-overlay:get-state',
      pushConfig: 'voice-overlay:push-config',
      reportContentSize: 'voice-overlay:report-content-size',
    })
  })

  describe('negotiateOverlayProtocol', () => {
    it.each([
      [{ minProtocol: 1, maxProtocol: 3 }, 3],
      [{ minProtocol: 3, maxProtocol: 3 }, 3],
      [{ minProtocol: 2, maxProtocol: 3 }, 3],
      [{ minProtocol: 1, maxProtocol: 2 }, 2],
      [{ minProtocol: 2, maxProtocol: 2 }, 2],
      [{ minProtocol: 1, maxProtocol: 1 }, 1],
    ])('negotiates %o to protocol %i', (range, expected) => {
      expect(negotiateOverlayProtocol(range)).toBe(expected)
    })

    it('rejects ranges above the shell protocol', () => {
      expect(negotiateOverlayProtocol({ minProtocol: 4, maxProtocol: 4 })).toBe(0)
    })
  })

  describe('normalizeVoiceOverlayConfig', () => {
    it('accepts a full config', () => {
      expect(normalizeVoiceOverlayConfig({
        scalePercent: 120,
        positionXPercent: 25,
        positionYPercent: 60,
        speakingOpacityPercent: 90,
        silentOpacityPercent: 30,
      })).toEqual({
        scalePercent: 120,
        positionXPercent: 25,
        positionYPercent: 60,
        speakingOpacityPercent: 90,
        silentOpacityPercent: 30,
      })
    })

    it('clamps out-of-range values to the configured bounds', () => {
      expect(normalizeVoiceOverlayConfig({
        scalePercent: 200,
        positionXPercent: -5,
        positionYPercent: 105,
        speakingOpacityPercent: 0,
        silentOpacityPercent: 200,
      })).toEqual({
        scalePercent: 150,
        positionXPercent: 0,
        positionYPercent: 100,
        speakingOpacityPercent: 10,
        silentOpacityPercent: 100,
      })
    })

    it.each([
      ['not an object', null],
      ['missing scale', { positionXPercent: 50, positionYPercent: 50, speakingOpacityPercent: 80, silentOpacityPercent: 40 }],
      ['non-numeric scale', { scalePercent: '100', positionXPercent: 50, positionYPercent: 50, speakingOpacityPercent: 80, silentOpacityPercent: 40 }],
      ['NaN position', { scalePercent: 100, positionXPercent: NaN, positionYPercent: 50, speakingOpacityPercent: 80, silentOpacityPercent: 40 }],
      ['non-numeric opacity', { scalePercent: 100, positionXPercent: 50, positionYPercent: 50, speakingOpacityPercent: '80', silentOpacityPercent: 40 }],
    ])('rejects %s', (_label, input) => {
      expect(normalizeVoiceOverlayConfig(input)).toBeNull()
    })
  })

  describe('default config', () => {
    it('matches the agreed defaults', () => {
      expect(DEFAULT_VOICE_OVERLAY_CONFIG).toEqual({
        scalePercent: 100,
        positionXPercent: 9,
        positionYPercent: 50,
        speakingOpacityPercent: 80,
        silentOpacityPercent: 40,
      })
    })
  })

  describe('normalizeVoiceOverlayEnabledRequest', () => {
    it('accepts an enabled request', () => {
      expect(normalizeVoiceOverlayEnabledRequest({ enabled: true })).toBe(true)
      expect(normalizeVoiceOverlayEnabledRequest({ enabled: false })).toBe(false)
    })

    it.each([
      null,
      undefined,
      {},
      { enabled: 1 },
      { enabled: 'true' },
      { enabled: null },
      1,
      'true',
    ])('rejects %#', (input) => {
      expect(normalizeVoiceOverlayEnabledRequest(input)).toBeNull()
    })
  })

  describe('normalizeContentSize', () => {
    it('accepts a reported content size', () => {
      expect(normalizeContentSize({ width: 280, height: 204 })).toEqual({ width: 280, height: 204 })
    })

    it('clamps fractional and below-minimum values', () => {
      expect(normalizeContentSize({ width: 280.4, height: 0 })).toEqual({ width: 280, height: 1 })
    })

    it.each([
      null,
      undefined,
      {},
      { width: 280 },
      { width: '280', height: 36 },
      { width: NaN, height: 36 },
      { width: 280, height: Infinity },
    ])('rejects %#', (input) => {
      expect(normalizeContentSize(input)).toBeNull()
    })
  })

  describe('normalizeVoiceOverlayState', () => {
    const participant = {
      identity: 'u1',
      name: '张三',
      avatarUrl: 'https://voice.example.com/avatar.png',
      isLocal: true,
      speaking: true,
      microphoneMuted: false,
      deafened: false,
    }

    it('accepts a full state', () => {
      expect(normalizeVoiceOverlayState({
        channel: { name: '大厅' },
        participants: [participant],
      })).toEqual({
        channel: { name: '大厅' },
        participants: [participant],
      })
    })

    it('accepts the empty state (no voice connection)', () => {
      expect(normalizeVoiceOverlayState({
        channel: null,
        participants: [],
      })).toEqual({ channel: null, participants: [] })
    })

    it('accepts null avatar and absent optional fields per participant contract', () => {
      const state = normalizeVoiceOverlayState({
        channel: null,
        participants: [{ ...participant, avatarUrl: null }],
      })
      expect(state?.participants[0]?.avatarUrl).toBeNull()
    })

    it.each([
      ['not an object', null],
      ['channel as string', { channel: '大厅', participants: [] }],
      ['channel as array', { channel: [], participants: [] }],
      ['channel with empty name', { channel: { name: '' }, participants: [] }],
      ['channel with non-string name', { channel: { name: 5 }, participants: [] }],
      ['participants not an array', { channel: null, participants: {} }],
      ['participant not an object', { channel: null, participants: [1] }],
      ['participant without identity', { channel: null, participants: [{ ...participant, identity: undefined }] }],
      ['participant with empty identity', { channel: null, participants: [{ ...participant, identity: '' }] }],
      ['participant with non-string name', { channel: null, participants: [{ ...participant, name: 5 }] }],
      ['participant with numeric avatar', { channel: null, participants: [{ ...participant, avatarUrl: 5 }] }],
      ['participant with non-boolean speaking', { channel: null, participants: [{ ...participant, speaking: 1 }] }],
      ['participant without isLocal', { channel: null, participants: [{ ...participant, isLocal: undefined }] }],
      ['participant with non-boolean microphoneMuted', { channel: null, participants: [{ ...participant, microphoneMuted: 'yes' }] }],
      ['participant with non-boolean deafened', { channel: null, participants: [{ ...participant, deafened: null }] }],
    ])('rejects %s', (_label, input) => {
      expect(normalizeVoiceOverlayState(input)).toBeNull()
    })
  })
})
