import { describe, expect, it } from 'vitest'
import { canGrantPermission, isTrustedOrigin } from './origin-policy.js'

describe('origin policy', () => {
  const server = 'https://voice.example.com'

  it('accepts URLs from the configured origin', () => {
    expect(isTrustedOrigin('https://voice.example.com/channel?id=1', server)).toBe(true)
    expect(canGrantPermission('https://voice.example.com/app', server, server)).toBe(true)
  })

  it('rejects different and invalid origins', () => {
    expect(isTrustedOrigin('https://evil.example.com', server)).toBe(false)
    expect(isTrustedOrigin('not a url', server)).toBe(false)
    expect(canGrantPermission('https://voice.example.com', 'https://evil.example.com', server)).toBe(false)
    expect(canGrantPermission(undefined, server, server)).toBe(false)
  })
})
