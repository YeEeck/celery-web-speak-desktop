import { describe, expect, it } from 'vitest'
import {
  APPLICATION_AUDIO_PCM_PORT_EVENT,
  isValidApplicationAudioSessionId,
  normalizeProtocolRange,
} from './application-audio-api.js'

describe('application audio API validation', () => {
  it('uses the cross-repository PCM port event name', () => {
    expect(APPLICATION_AUDIO_PCM_PORT_EVENT).toBe('celery:application-audio:pcm-port')
  })

  it('normalizes a valid protocol range', () => {
    expect(normalizeProtocolRange({ minProtocol: 1, maxProtocol: 2 })).toEqual({
      minProtocol: 1,
      maxProtocol: 2,
    })
  })

  it.each([
    null,
    {},
    { minProtocol: 0, maxProtocol: 1 },
    { minProtocol: 2, maxProtocol: 1 },
    { minProtocol: 1.5, maxProtocol: 2 },
    { minProtocol: 1, maxProtocol: Number.MAX_VALUE },
  ])('rejects an invalid protocol range %#', (input) => {
    expect(normalizeProtocolRange(input)).toBeNull()
  })

  it('only accepts random UUID v4 session IDs', () => {
    expect(isValidApplicationAudioSessionId('40c18d5a-17d4-4dbb-9142-d08b96b7c99f')).toBe(true)
    expect(isValidApplicationAudioSessionId('not-a-session')).toBe(false)
    expect(isValidApplicationAudioSessionId('40c18d5a-17d4-1dbb-9142-d08b96b7c99f')).toBe(false)
  })
})
