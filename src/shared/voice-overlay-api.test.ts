import { describe, expect, it } from 'vitest'
import {
  VOICE_OVERLAY_CAPABILITIES,
  VOICE_OVERLAY_CHANNELS,
  VOICE_OVERLAY_PROTOCOL,
  normalizeVoiceOverlayEnabledRequest,
  normalizeVoiceOverlayState,
} from './voice-overlay-api.js'

describe('voice overlay API', () => {
  it('uses the cross-repository protocol number and capability', () => {
    expect(VOICE_OVERLAY_PROTOCOL).toBe(1)
    expect(VOICE_OVERLAY_CAPABILITIES).toEqual(['voice_overlay'])
  })

  it('uses the agreed IPC channel names', () => {
    expect(VOICE_OVERLAY_CHANNELS).toEqual({
      hello: 'voice-overlay:hello',
      setEnabled: 'voice-overlay:set-enabled',
      state: 'voice-overlay:state',
      getState: 'voice-overlay:get-state',
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
