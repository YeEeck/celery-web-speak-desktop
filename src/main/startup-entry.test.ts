import { describe, expect, it, vi } from 'vitest'
import {
  STARTUP_ENTRY_ARGS,
  StartupEntryManager,
  createWindowsStartupEntryBackend,
  isStartupEntrySupported,
  reconcileStartupEntry,
  type StartupEntry,
  type StartupEntryBackend,
} from './startup-entry.js'
import type { RegistryStartupEntry } from './startup-entry-registry.js'
import { STARTUP_ENTRY_NAME } from '../shared/startup-entry-api.js'

const EXECUTABLE = 'C:\\Program Files\\Celery Web Speak\\Celery Web Speak.exe'

class FakeBackend implements StartupEntryBackend {
  entry: StartupEntry = { enabled: false, path: null, args: [] }
  writes: { path: string; args: string[] }[] = []
  removals = 0
  writeError: Error | null = null
  removeError: Error | null = null
  readError: Error | null = null
  ignoreWrites = false

  async read(): Promise<StartupEntry> {
    if (this.readError) throw this.readError
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
  it('reports disabled and registers the current executable when the entry does not exist', async () => {
    const backend = new FakeBackend()
    const { startup, logger } = createManager(backend)

    await expect(startup.isEnabled()).resolves.toBe(false)
    expect(backend.writes).toEqual([])
    expect(backend.removals).toBe(0)

    await expect(startup.setEnabled(true)).resolves.toBe(true)
    expect(backend.writes).toEqual([{ path: EXECUTABLE, args: ['--autostart'] }])
    expect(backend.entry).toEqual({ enabled: true, path: EXECUTABLE, args: ['--autostart'] })
    expect(logger.info).toHaveBeenCalledWith('startup_entry_enabled', { path: EXECUTABLE })
  })

  it('reports enabled when the system entry is enabled and points at the current executable', async () => {
    const backend = new FakeBackend()
    backend.entry = { enabled: true, path: EXECUTABLE, args: ['--autostart'] }
    const { startup } = createManager(backend)

    await expect(startup.isEnabled()).resolves.toBe(true)
    expect(backend.writes).toEqual([])
    expect(backend.removals).toBe(0)
  })

  it('compares executable paths with Windows semantics and case-insensitively', async () => {
    const backend = new FakeBackend()
    backend.entry = {
      enabled: true,
      path: '"c:/program files/CELERY WEB SPEAK/celery web speak.exe"',
      args: [],
    }
    const { startup } = createManager(backend)

    await expect(startup.isEnabled()).resolves.toBe(true)
  })

  it('reports disabled when the entry exists but was disabled outside the application', async () => {
    const backend = new FakeBackend()
    backend.entry = { enabled: false, path: EXECUTABLE, args: ['--autostart'] }
    const { startup } = createManager(backend)

    await expect(startup.isEnabled()).resolves.toBe(false)
    await expect(startup.setEnabled(true)).resolves.toBe(true)
    expect(backend.writes).toEqual([{ path: EXECUTABLE, args: ['--autostart'] }])
  })

  it('reports disabled when the entry path drifted and repairs it without touching the arguments', async () => {
    const backend = new FakeBackend()
    backend.entry = {
      enabled: true,
      path: 'D:\\Portable\\Celery Web Speak.exe',
      args: ['--autostart', '--portable'],
    }
    const { startup, logger } = createManager(backend)

    await expect(startup.isEnabled()).resolves.toBe(false)

    await startup.reconcilePath()
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

  it('does not write during path reconciliation unless the entry is enabled and drifted', async () => {
    const cases: StartupEntry[] = [
      { enabled: false, path: null, args: [] },
      { enabled: false, path: EXECUTABLE, args: ['--autostart'] },
      { enabled: true, path: EXECUTABLE, args: ['--autostart'] },
    ]
    for (const entry of cases) {
      const backend = new FakeBackend()
      backend.entry = entry
      const { startup } = createManager(backend)

      await startup.reconcilePath()
      expect(backend.writes).toEqual([])
      expect(backend.removals).toBe(0)
    }
  })

  it('keeps the startup argument when a legacy entry has none', async () => {
    const backend = new FakeBackend()
    backend.entry = { enabled: true, path: 'D:\\Old Location\\Celery Web Speak.exe', args: [] }
    const { startup, logger } = createManager(backend)

    await startup.reconcilePath()

    expect(backend.writes).toEqual([{ path: EXECUTABLE, args: ['--autostart'] }])
    expect(logger.info).toHaveBeenCalledWith('startup_entry_reconciled', {
      from: 'D:\\Old Location\\Celery Web Speak.exe',
      to: EXECUTABLE,
    })
  })

  it('does not throw when writing throws and reports the entry as not enabled', async () => {
    const backend = new FakeBackend()
    backend.writeError = new Error('access denied')
    const { startup, logger } = createManager(backend)

    await expect(startup.setEnabled(true)).resolves.toBe(false)
    expect(backend.writes).toEqual([])
    expect(logger.info).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith('startup_entry_write_failed', {
      enabled: true,
      message: 'access denied',
    })
  })

  it('trusts the re-read state when a write did not take effect', async () => {
    const backend = new FakeBackend()
    backend.ignoreWrites = true
    const { startup, logger } = createManager(backend)

    await expect(startup.setEnabled(true)).resolves.toBe(false)
    expect(backend.writes).toEqual([{ path: EXECUTABLE, args: ['--autostart'] }])
    expect(logger.info).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith('startup_entry_write_failed', {
      enabled: true,
      effective: false,
    })
  })

  it('removes the entry when disabling and reports the re-read state', async () => {
    const backend = new FakeBackend()
    backend.entry = { enabled: true, path: EXECUTABLE, args: ['--autostart'] }
    const { startup, logger } = createManager(backend)

    await expect(startup.setEnabled(false)).resolves.toBe(false)
    expect(backend.removals).toBe(1)
    expect(backend.entry).toEqual({ enabled: false, path: null, args: [] })
    expect(logger.info).toHaveBeenCalledWith('startup_entry_disabled', { path: EXECUTABLE })
  })

  it('does not claim the entry was disabled when removal fails', async () => {
    const backend = new FakeBackend()
    backend.entry = { enabled: true, path: EXECUTABLE, args: ['--autostart'] }
    backend.removeError = new Error('registry denied')
    const { startup, logger } = createManager(backend)

    await expect(startup.setEnabled(false)).resolves.toBe(true)
    expect(logger.info).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith('startup_entry_write_failed', {
      enabled: false,
      message: 'registry denied',
    })
  })

  it('reports disabled and logs when reading the operating system state fails', async () => {
    const backend = new FakeBackend()
    backend.readError = new Error('reg.exe missing')
    const { startup, logger } = createManager(backend)

    await expect(startup.isEnabled()).resolves.toBe(false)
    expect(logger.warn).toHaveBeenCalledWith('startup_entry_read_failed', {
      message: 'reg.exe missing',
    })
  })

  it('does not throw when path reconciliation fails', async () => {
    const backend = new FakeBackend()
    backend.entry = { enabled: true, path: 'D:\\Old\\Celery.exe', args: ['--autostart'] }
    backend.writeError = new Error('denied')
    const { startup, logger } = createManager(backend)

    await expect(startup.reconcilePath()).resolves.toBeUndefined()
    expect(backend.writes).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith('startup_entry_write_failed', {
      operation: 'reconcile',
      message: 'denied',
    })
  })
})

describe('reconcileStartupEntry', () => {
  it('repairs a drifted entry at startup, keeps its arguments and logs the self-heal', async () => {
    const backend = new FakeBackend()
    backend.entry = {
      enabled: true,
      path: 'D:\\Old Location\\Celery Web Speak.exe',
      args: ['--autostart', '--portable'],
    }
    const { startup, logger } = createManager(backend)

    await reconcileStartupEntry(startup, logger)

    expect(backend.writes).toEqual([{ path: EXECUTABLE, args: ['--autostart', '--portable'] }])
    expect(backend.removals).toBe(0)
    expect(logger.info).toHaveBeenCalledWith('startup_entry_reconciled', {
      from: 'D:\\Old Location\\Celery Web Speak.exe',
      to: EXECUTABLE,
    })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('does nothing at startup when the entry manager is unavailable', async () => {
    const logger = { warn: vi.fn() }

    await expect(reconcileStartupEntry(null, logger)).resolves.toBeUndefined()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('keeps startup running and logs when reconciliation throws unexpectedly', async () => {
    const logger = { warn: vi.fn() }
    const startup = {
      async reconcilePath(): Promise<void> {
        throw new Error('registry unavailable')
      },
    }

    await expect(reconcileStartupEntry(startup, logger)).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith('startup_entry_write_failed', {
      operation: 'reconcile',
      message: 'registry unavailable',
    })
  })
})

describe('createWindowsStartupEntryBackend', () => {
  it('uses the fixed entry name and startup argument', () => {
    expect(STARTUP_ENTRY_NAME).toBe('Celery Web Speak')
    expect(STARTUP_ENTRY_ARGS).toEqual(['--autostart'])
  })

  it('maps the registry entry read for the fixed name', async () => {
    const names: string[] = []
    const backend = createWindowsStartupEntryBackend(
      { setLoginItemSettings: () => undefined },
      async (name) => {
        names.push(name)
        return { path: EXECUTABLE, args: ['--autostart'], enabled: false }
      },
    )

    await expect(backend.read()).resolves.toEqual({
      enabled: false,
      path: EXECUTABLE,
      args: ['--autostart'],
    })
    expect(names).toEqual([STARTUP_ENTRY_NAME])
  })

  it('reports an absent registry entry as disabled', async () => {
    const backend = createWindowsStartupEntryBackend(
      { setLoginItemSettings: () => undefined },
      async (): Promise<RegistryStartupEntry | null> => null,
    )

    await expect(backend.read()).resolves.toEqual({ enabled: false, path: null, args: [] })
  })

  it('writes and removes the entry under the fixed registry name', () => {
    const settings: unknown[] = []
    const backend = createWindowsStartupEntryBackend({
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
