import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  RUN_KEY,
  STARTUP_APPROVED_KEY,
  isStartupApprovedEnabled,
  parseCommandLine,
  parseRegBinary,
  parseRegValueText,
  readStartupEntry,
} from './startup-entry-registry.js'

describe('parseRegValueText', () => {
  it('unescapes the quoted command line of a spaced executable path', () => {
    const line = '"Celery Web Speak"="\\"D:\\\\Program Files\\\\Celery Web Speak\\\\Celery Web Speak.exe\\" --autostart"'
    expect(parseRegValueText(line, 'Celery Web Speak'))
      .toBe('"D:\\Program Files\\Celery Web Speak\\Celery Web Speak.exe" --autostart')
  })

  it('keeps non-ASCII names and paths', () => {
    const line = '"CWS 中文路径"="\\"C:\\\\测试 目录\\\\应用.exe\\" --autostart"'
    expect(parseRegValueText(line, 'CWS 中文路径')).toBe('"C:\\测试 目录\\应用.exe" --autostart')
  })

  it('ignores other values and missing entries', () => {
    expect(parseRegValueText('"Other"="x"', 'Celery Web Speak')).toBeNull()
    expect(parseRegValueText('', 'Celery Web Speak')).toBeNull()
  })

  it('decodes REG_EXPAND_SZ hex data', () => {
    const value = 'C:\\Test\\app.exe'
    const hex = [...Buffer.from(value, 'utf16le')]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join(',')
    expect(parseRegValueText('"Celery Web Speak"=hex(2):' + hex, 'Celery Web Speak')).toBe(value)
  })
})

describe('parseCommandLine', () => {
  it('splits a quoted executable path with spaces from its arguments', () => {
    expect(parseCommandLine('"D:\\Program Files\\Celery Web Speak\\Celery Web Speak.exe" --autostart'))
      .toEqual({
        path: 'D:\\Program Files\\Celery Web Speak\\Celery Web Speak.exe',
        args: ['--autostart'],
      })
  })

  it('handles unquoted command lines and empty input', () => {
    expect(parseCommandLine('C:\\Tools\\app.exe --minimized'))
      .toEqual({ path: 'C:\\Tools\\app.exe', args: ['--minimized'] })
    expect(parseCommandLine('C:\\Tools\\app.exe')).toEqual({ path: 'C:\\Tools\\app.exe', args: [] })
    expect(parseCommandLine('')).toEqual({ path: '', args: [] })
  })

  it('keeps quoted arguments together', () => {
    expect(parseCommandLine('"C:\\app.exe" --name "a b"'))
      .toEqual({ path: 'C:\\app.exe', args: ['--name', 'a b'] })
  })
})

describe('parseRegBinary and isStartupApprovedEnabled', () => {
  it('treats a missing StartupApproved value as enabled', () => {
    const bytes = parseRegBinary('"Other"=hex:03,00,00,00', 'Celery Web Speak')
    expect(bytes).toBeNull()
    expect(isStartupApprovedEnabled(bytes)).toBe(true)
  })

  it('treats state 0 and 2 as enabled and everything else as disabled', () => {
    const enabled = parseRegBinary(
      '"Celery Web Speak"=hex:02,00,00,00,01,02,03,04,05,06,07,08',
      'Celery Web Speak',
    )
    expect(enabled).toEqual([2, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(isStartupApprovedEnabled(enabled)).toBe(true)
    expect(isStartupApprovedEnabled([0, 0, 0, 0])).toBe(true)
    expect(isStartupApprovedEnabled([3, 0, 0, 0])).toBe(false)
    expect(isStartupApprovedEnabled([1, 0, 0, 0])).toBe(false)
  })
})

describe.skipIf(process.platform !== 'win32')('readStartupEntry on Windows', () => {
  const name = 'Celery Web Speak Unit Test'
  const executable = 'C:\\Program Files\\Celery Web Speak\\Celery Web Speak.exe'

  function cleanUp(): void {
    try {
      execFileSync('reg', ['delete', RUN_KEY, '/v', name, '/f'], { stdio: 'ignore' })
    } catch {
      // 值不存在时无需清理。
    }
    try {
      execFileSync('reg', ['delete', STARTUP_APPROVED_KEY, '/v', name, '/f'], { stdio: 'ignore' })
    } catch {
      // StartupApproved 记录不存在时无需清理。
    }
  }

  it('reads a quoted spaced path with its arguments and the StartupApproved state', async () => {
    cleanUp()
    try {
      execFileSync(
        'reg',
        ['add', RUN_KEY, '/v', name, '/t', 'REG_SZ', '/d', '"' + executable + '" --autostart', '/f'],
        { stdio: 'ignore' },
      )
      await expect(readStartupEntry(name)).resolves.toEqual({
        path: executable,
        args: ['--autostart'],
        enabled: true,
      })

      execFileSync(
        'reg',
        ['add', STARTUP_APPROVED_KEY, '/v', name, '/t', 'REG_BINARY', '/d', '030000000000000000000000', '/f'],
        { stdio: 'ignore' },
      )
      await expect(readStartupEntry(name)).resolves.toMatchObject({ enabled: false })
    } finally {
      cleanUp()
    }
  })

  it('returns null after the entry is removed', async () => {
    cleanUp()
    await expect(readStartupEntry(name)).resolves.toBeNull()
  })
})
