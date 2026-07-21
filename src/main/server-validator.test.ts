import { describe, expect, it, vi } from 'vitest'
import { validateServer, type FetchLike } from './server-validator.js'

describe('validateServer', () => {
  it('accepts the expected health payload', async () => {
    const fetcher = vi.fn(async () => response(true, 200, { status: 'ok' }))

    await expect(validateServer('https://voice.example.com', fetcher)).resolves.toEqual({
      ok: true,
      serverUrl: 'https://voice.example.com',
    })
    expect(fetcher).toHaveBeenCalledWith('https://voice.example.com/api/health', expect.objectContaining({
      method: 'GET',
      redirect: 'error',
    }))
  })

  it('rejects non-success status', async () => {
    const fetcher = async () => response(false, 502, null)
    await expect(validateServer('https://voice.example.com', fetcher)).resolves.toMatchObject({
      ok: false,
      code: 'unexpected_status',
    })
  })

  it('rejects unexpected JSON', async () => {
    const fetcher = async () => response(true, 200, { status: 'warning' })
    await expect(validateServer('https://voice.example.com', fetcher)).resolves.toMatchObject({
      ok: false,
      code: 'invalid_response',
    })
  })

  it('reports network errors', async () => {
    const fetcher: FetchLike = async () => { throw new Error('offline') }
    await expect(validateServer('https://voice.example.com', fetcher)).resolves.toMatchObject({
      ok: false,
      code: 'network_error',
    })
  })
})

function response(ok: boolean, status: number, payload: unknown) {
  return {
    ok,
    status,
    json: async () => payload,
  }
}
