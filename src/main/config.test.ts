import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ConfigStore,
  DEFAULT_WINDOW_STATE,
  ServerUrlError,
  normalizeServerUrl,
  readStartupServerUrl,
} from './config.js'

describe('normalizeServerUrl', () => {
  it.each([
    ['https://voice.example.com/', 'https://voice.example.com'],
    [' http://192.0.2.10:8080 ', 'http://192.0.2.10:8080'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeServerUrl(input)).toBe(expected)
  })

  it.each([
    '',
    'voice.example.com',
    'ftp://voice.example.com',
    'https://user:password@voice.example.com',
    'https://voice.example.com/cws',
    'https://voice.example.com/?a=1',
    'https://voice.example.com/#channel',
  ])('rejects %s', (input) => {
    expect(() => normalizeServerUrl(input)).toThrow(ServerUrlError)
  })
})

describe('ConfigStore', () => {
  it('writes and reads a normalized configuration', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'cws-desktop-'))
    const store = new ConfigStore(directory)

    await store.save('https://voice.example.com/')

    await expect(store.load()).resolves.toEqual({
      version: 1,
      serverUrl: 'https://voice.example.com',
      window: DEFAULT_WINDOW_STATE,
    })
    expect(readStartupServerUrl(directory)).toBe('https://voice.example.com')
    expect(JSON.parse(await readFile(store.filePath, 'utf8'))).toMatchObject({ version: 1 })
  })

  it('returns null for corrupted configuration', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'cws-desktop-'))
    const store = new ConfigStore(directory)
    await writeFile(store.filePath, '{not json')

    await expect(store.load()).resolves.toBeNull()
    expect(readStartupServerUrl(directory)).toBeNull()
  })

  it('clamps invalid window dimensions when loading', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'cws-desktop-'))
    const store = new ConfigStore(directory)
    await writeFile(store.filePath, JSON.stringify({
      version: 1,
      serverUrl: 'https://voice.example.com',
      window: { width: 100, height: 50, x: 8, y: 9, maximized: true },
    }))

    const config = await store.load()
    expect(config?.window).toEqual({ width: 960, height: 640, x: 8, y: 9, maximized: true })
  })
})
