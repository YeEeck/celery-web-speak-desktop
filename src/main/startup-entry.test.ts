import { describe, expect, it, vi } from 'vitest'
import {
  STARTUP_ENTRY_ARGS,
  STARTUP_ENTRY_NAME,
  StartupEntryManager,
  createElectronStartupEntryBackend,
  isStartupEntrySupported,
  type StartupEntry,
  type StartupEntryBackend,
} from './startup-entry.js'

const EXECUTABLE = 'C:\\Program Files\\Celery Web Speak\\Celery Web Speak.exe'

class FakeBackend implements StartupEntryBackend {
  entry: StartupEntry = { enabled: false, path: null, args: [] }
  writes: { path: string; args: string[] }[] = []
  removals = 0
  writeError: Error | null = null
  removeError: Error | null = null
  ignoreWrites = false

  read(): StartupEntry {
    return { ...this.entry, args: [...this.entry.args] }
  }

  write(path: string, args: string[]): void {
    if (this.writeError) throw this.writeError
    this.writes.push({ path, args: [...args] })
    if (!this.ignoreWrites) this.entry = { enabled: true, path, args: [...args] }
  }

  remove(): void {
    if (this.removeError) throw this.removeError
    this.removals += 1
    if (!this.ignoreWrites) this.entry = { enabled: false, path: null, args: [] }
  }
}

function createManager(backend: FakeBackend) {
  const logger = { info: vi.fn(), warn: vi.fn() }
  const startup = new StartupEntryManager({
    backend,
    currentExecutable: EXECUTABLE,
    logger,
  })
  return { startup, logger }
}

describe('StartupEntryManager', () => {
  it('reports disabled and registers the current executable when the entry does not exist', () => {
    const backend = new FakeBackend()
    const { startup, logger } = createManager(backend)

    expect(startup.isEnabled()).toBe(false)
    expect(backend.writes).toEqual([])
    expect(backend.removals).toBe(0)

    expect(startup.setEnabled(true)).toBe(true)
    expect(backend.writes).toEqual([{ path: EXECUTABLE, args: ['--autostart'] }])
    expect(backend.entry).toEqual({ enabled: true, path: EXECUTABLE, args: ['--autostart'] })
    expect(logger.info).toHaveBeenCalledWith('startup_entry_enabled', { path: EXECUTABLE })
  })

  it('reports enabled when the system entry is enabled and points at the current executable', () => {
    const backend = new FakeBackend()
    backend.entry = { enabled: true, path: EXECUTABLE, args: ['--autostart'] }
    const { startup } = createManager(backend)

    expect(startup.isEnabled()).toBe(true)
    expect(backend.writes).toEqual([])
    expect(backend.removals).toBe(0)
  })

  it('compares executable paths with Windows semantics and case-insensitively', () => {
    const backend = new FakeBackend()
    backend.entry = {
      enabled: true,
      path: '"c:/program files/CELERY WEB SPEAK/celery web speak.exe"',
      args: [],
    }
    const { startup } = createManager(backend)

    expect(startup.isEnabled()).toBe(true)
  })

  it('reports disabled when the entry exists but was disabled outside the application', () => {
    const backend = new FakeBackend()
    backend.entry = { enabled: false, path: EXECUTABLE, args: ['--autostart'] }
    const { startup } = createManager(backend)

    expect(startup.isEnabled()).toBe(false)
    expect(startup.setEnabled(true)).toBe(true)
    expect(backend.writes).toEqual([{ path: EXECUTABLE, args: ['--autostart'] }])
  })

  it('reports disabled when the entry path drifted and repairs it without touching the arguments', () => {
    const backend = new FakeBackend()
    backend.entry = {
      enabled: true,
      path: 'D:\\Portable\\Celery Web Speak.exe',
      args: ['--autostart', '--portable'],
    }
    const { startup, logger } = createManager(backend)

    expect(startup.isEnabled()).toBe(false)

    startup.reconcilePath()
    expect(backend.writes).toEqual([{ path: EXECUTABLE, args: ['--autostart', '--portable'] }])
    expect(backend.entry).toEqual({
      enabled: true,
      path: EXECUTABLE,
      args: ['--autostart', '--portable'],
    })
    expect(logger.info).toHaveBeenCalledWith('startup_entry_reconciled', {
      from: 'D:\\Portable\\Celery Web Speak.exe',
      to: EXECUTABLE,
    })
  })

  it('does not write during path reconciliation unless the entry is enabled and drifted', () => {
    const cases: StartupEntry[] = [
      { enabled: false, path: null, args: [] },
      { enabled: false, path: EXECUTABLE, args: ['--autostart'] },
      { enabled: true, path: EXECUTABLE, args: ['--autostart'] },
    ]
    for (const entry of cases) {
      const backend = new FakeBackend()
      backend.entry = entry
      const { startup } = createManager(backend)

      startup.reconcilePath()
      expect(backend.writes).toEqual([])
      expect(backend.removals).toBe(0)
    }
  })

  it('does not throw when writing throws and reports the entry as not enabled', () => {
    const backend = new FakeBackend()
    backend.writeError = new Error('access denied')
    const { startup, logger } = createManager(backend)

    expect(startup.setEnabled(true)).toBe(false)
    expect(backend.writes).toEqual([])
    expect(logger.info).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith('startup_entry_write_failed', {
      enabled: true,
      message: 'access denied',
    })
  })

  it('trusts the re-read state when a write did not take effect', () => {
    const backend = new FakeBackend()
    backend.ignoreWrites = true
    const { startup, logger } = createManager(backend)

    expect(startup.setEnabled(true)).toBe(false)
    expect(backend.writes).toEqual([{ path: EXECUTABLE, args: ['--autostart'] }])
    expect(logger.info).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith('startup_entry_write_failed', {
      enabled: true,
      effective: false,
    })
  })

  it('removes the entry when disabling and reports the re-read state', () => {
    const backend = new FakeBackend()
    backend.entry = { enabled: true, path: EXECUTABLE, args: ['--autostart'] }
    const { startup, logger } = createManager(backend)

    expect(startup.setEnabled(false)).toBe(false)
    expect(backend.removals).toBe(1)
    expect(backend.entry).toEqual({ enabled: false, path: null, args: [] })
    expect(logger.info).toHaveBeenCalledWith('startup_entry_disabled', { path: EXECUTABLE })
  })

  it('does not claim the entry was disabled when removal fails', () => {
    const backend = new FakeBackend()
    backend.entry = { enabled: true, path: EXECUTABLE, args: ['--autostart'] }
    backend.removeError = new Error('registry denied')
    const { startup, logger } = createManager(backend)

    expect(startup.setEnabled(false)).toBe(true)
    expect(logger.info).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith('startup_entry_write_failed', {
      enabled: false,
      message: 'registry denied',
    })
  })

  it('does not throw when path reconciliation fails', () => {
    const backend = new FakeBackend()
    backend.entry = { enabled: true, path: 'D:\\Old\\Celery.exe', args: ['--autostart'] }
    backend.writeError = new Error('denied')
    const { startup, logger } = createManager(backend)

    expect(() => startup.reconcilePath()).not.toThrow()
    expect(backend.writes).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith('startup_entry_write_failed', {
      operation: 'reconcile',
      message: 'denied',
    })
  })
})

describe('createElectronStartupEntryBackend', () => {
  it('uses the fixed entry name and startup argument', () => {
    expect(STARTUP_ENTRY_NAME).toBe('Celery Web Speak')
    expect(STARTUP_ENTRY_ARGS).toEqual(['--autostart'])
  })

  it('reads the fixed-named entry and exposes its operating-system state', () => {
    const backend = createElectronStartupEntryBackend({
      getLoginItemSettings: () => ({
        launchItems: [
          { name: 'Another Application', path: 'D:\\Other.exe', args: [], enabled: true },
          {
            name: STARTUP_ENTRY_NAME,
            path: EXECUTABLE,
            args: ['--autostart'],
            enabled: false,
          },
        ],
      }),
      setLoginItemSettings: () => undefined,
    })

    expect(backend.read()).toEqual({ enabled: false, path: EXECUTABLE, args: ['--autostart'] })
  })

  it('returns an absent entry as disabled', () => {
    const backend = createElectronStartupEntryBackend({
      getLoginItemSettings: () => ({ launchItems: [] }),
      setLoginItemSettings: () => undefined,
    })

    expect(backend.read()).toEqual({ enabled: false, path: null, args: [] })
  })

  it('writes and removes the entry under the fixed registry name', () => {
    const settings: unknown[] = []
    const backend = createElectronStartupEntryBackend({
      getLoginItemSettings: () => ({ launchItems: [] }),
      setLoginItemSettings: (value) => settings.push(value),
    })

    backend.write(EXECUTABLE, ['--autostart'])
    backend.remove()

    expect(settings).toEqual([
      {
        openAtLogin: true,
        name: STARTUP_ENTRY_NAME,
        path: EXECUTABLE,
        args: ['--autostart'],
        enabled: true,
      },
      { openAtLogin: false, name: STARTUP_ENTRY_NAME },
    ])
  })
})

describe('isStartupEntrySupported', () => {
  it('only supports packaged Windows builds', () => {
    expect(isStartupEntrySupported(true, 'win32')).toBe(true)
    expect(isStartupEntrySupported(false, 'win32')).toBe(false)
    expect(isStartupEntrySupported(true, 'linux')).toBe(false)
    expect(isStartupEntrySupported(true, 'darwin')).toBe(false)
  })
})
