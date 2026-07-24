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
      autoCheckUpdate: true,
      skippedVersion: null,
      recentServers: [],
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

  it('defaults recentServers to empty array for legacy config', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'cws-desktop-'))
    const store = new ConfigStore(directory)
    await writeFile(store.filePath, JSON.stringify({
      version: 1,
      serverUrl: 'https://voice.example.com',
    }))

    const config = await store.load()
    expect(config?.recentServers).toEqual([])
  })
})

describe('ConfigStore recentServers', () => {
  it('adds a server to recent list', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'cws-desktop-'))
    const store = new ConfigStore(directory)
    await store.save('https://voice.example.com')

    const list = await store.addRecentServer('https://a.example.com')
    expect(list).toEqual(['https://a.example.com'])
  })

  it('moves duplicate to front and caps at 5', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'cws-desktop-'))
    const store = new ConfigStore(directory)
    await store.save('https://voice.example.com')

    await store.addRecentServer('https://a.example.com')
    await store.addRecentServer('https://b.example.com')
    await store.addRecentServer('https://c.example.com')
    await store.addRecentServer('https://d.example.com')
    await store.addRecentServer('https://e.example.com')
    const list = await store.addRecentServer('https://a.example.com')

    expect(list).toEqual([
      'https://a.example.com',
      'https://e.example.com',
      'https://d.example.com',
      'https://c.example.com',
      'https://b.example.com',
    ])
  })

  it('removes a server from recent list', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'cws-desktop-'))
    const store = new ConfigStore(directory)
    await store.save('https://voice.example.com')

    await store.addRecentServer('https://a.example.com')
    await store.addRecentServer('https://b.example.com')
    const list = await store.removeRecentServer('https://a.example.com')

    expect(list).toEqual(['https://b.example.com'])
  })

  it('getRecentServers returns empty when no config', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'cws-desktop-'))
    const store = new ConfigStore(directory)

    await expect(store.getRecentServers()).resolves.toEqual([])
  })
})
