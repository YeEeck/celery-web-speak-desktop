import { describe, expect, it } from 'vitest'
import { isTrustedRemoteRequest } from './remote-request-policy.js'

describe('remote request policy', () => {
  const trusted = {
    activeRemote: true,
    senderMatches: true,
    topFrame: true,
    senderUrl: 'https://voice.example.com/channel?id=1',
    serverUrl: 'https://voice.example.com',
  }

  it('accepts the active top-level remote frame on the configured origin', () => {
    expect(isTrustedRemoteRequest(trusted)).toBe(true)
  })

  it.each([
    { activeRemote: false },
    { senderMatches: false },
    { topFrame: false },
    { senderUrl: 'https://evil.example.com' },
    { senderUrl: 'not a url' },
  ])('rejects untrusted request context %#', (change) => {
    expect(isTrustedRemoteRequest({ ...trusted, ...change })).toBe(false)
  })
})
