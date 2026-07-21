import { describe, expect, it } from 'vitest'
import { isTrustedApplicationAudioRequest } from './application-audio-policy.js'

describe('application audio request policy', () => {
  const trusted = {
    activeRemote: true,
    senderMatches: true,
    topFrame: true,
    senderUrl: 'https://voice.example.com/channel?id=1',
    serverUrl: 'https://voice.example.com',
  }

  it('accepts the active top-level remote frame on the configured origin', () => {
    expect(isTrustedApplicationAudioRequest(trusted)).toBe(true)
  })

  it.each([
    { activeRemote: false },
    { senderMatches: false },
    { topFrame: false },
    { senderUrl: 'https://evil.example.com' },
    { senderUrl: 'not a url' },
  ])('rejects untrusted request context %#', (change) => {
    expect(isTrustedApplicationAudioRequest({ ...trusted, ...change })).toBe(false)
  })
})

