import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { STARTUP_ENTRY_NAME } from '../../src/shared/startup-entry-api.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const installerPath = path.join(root, 'build', 'installer.iss')
const STARTUP_RUN_KEY = 'Software\\Microsoft\\Windows\\CurrentVersion\\Run'

async function readInstaller(): Promise<string> {
  return readFile(installerPath, 'utf8')
}

function sectionContent(script: string, name: string): string | null {
  const lines = script.split(/\r?\n/)
  const header = `[${name.toLowerCase()}]`
  const start = lines.findIndex((line) => line.trim().toLowerCase() === header)
  if (start === -1) return null

  const content: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^\s*\[[^\]]+\]\s*$/.test(line)) break
    content.push(line)
  }
  return content.join('\n')
}

function procedureBody(script: string, name: string): string {
  const code = sectionContent(script, 'Code')
  if (code === null) throw new Error('installer.iss has no [Code] section')

  const declaration = new RegExp(`\\bprocedure\\s+${name}\\b`, 'i').exec(code)
  if (declaration === null) throw new Error(`installer.iss has no ${name} procedure`)

  const rest = code.slice(declaration.index)
  const next = /\bprocedure\s+\w+/i.exec(rest.slice(declaration[0].length))
  return next === null ? rest : rest.slice(0, declaration[0].length + next.index)
}

function stripPascalComments(value: string): string {
  return value.replace(/\/\/[^\n]*/g, '').replace(/\{[^}]*\}/g, '')
}

describe('Inno Setup installer', () => {
  it('keeps local message files in the repository', async () => {
    const script = await readFile(installerPath, 'utf8')
    const messageFiles = [...script.matchAll(/MessagesFile:\s*"([^"]+)"/g)]
      .map((match) => match[1])
      .filter((file): file is string => file !== undefined && !file.startsWith('compiler:'))

    expect(messageFiles).toContain('languages\\ChineseSimplified.isl')

    for (const file of messageFiles) {
      const localPath = file.replaceAll('\\', path.sep)
      await expect(access(path.resolve(path.dirname(installerPath), localPath))).resolves.toBeUndefined()
    }
  })

  it('removes the same startup value name the runtime module writes', async () => {
    const script = await readInstaller()
    const declaredName = /\bStartupEntryName\s*=\s*'([^']+)'/.exec(script)?.[1]

    expect(declaredName).toBe(STARTUP_ENTRY_NAME)
  })

  it('deletes the startup value only when it exists, without prompting', async () => {
    const script = await readInstaller()
    const removal = procedureBody(script, 'RemoveStartupEntry')
    const code = stripPascalComments(sectionContent(script, 'Code') ?? '')

    expect(removal).toMatch(
      /if\s+RegValueExists\(HKEY_CURRENT_USER,\s*StartupRunKey,\s*StartupEntryName\)\s+then\s+RegDeleteValue\(HKEY_CURRENT_USER,\s*StartupRunKey,\s*StartupEntryName\);/,
    )
    expect(removal).not.toMatch(/MsgBox|TaskDialog|RaiseException/i)
    expect(code).toContain(`StartupRunKey = '${STARTUP_RUN_KEY}'`)
  })

  it('removes the startup value regardless of the user data choice', async () => {
    const script = await readInstaller()
    const handler = stripPascalComments(procedureBody(script, 'CurUninstallStepChanged'))

    expect(handler).toMatch(/if\s+CurUninstallStep\s*=\s*usUninstall\s+then\s+begin\s+RemoveStartupEntry;/i)
    expect(handler.indexOf('RemoveStartupEntry;')).toBeLessThan(handler.indexOf('MsgBox('))
    expect(handler.match(/\bMsgBox\s*\(/g) ?? []).toHaveLength(1)
  })

  it('does not create the startup entry from the installer', async () => {
    const script = await readInstaller()
    const registry = sectionContent(script, 'Registry') ?? ''
    const tasks = sectionContent(script, 'Tasks') ?? ''

    expect(registry).not.toMatch(/CurrentVersion\\+Run/i)
    expect(registry).not.toContain(STARTUP_ENTRY_NAME)
    expect(tasks).not.toMatch(/autostart|startup|随系统启动/i)
  })

  it('keeps the existing user data prompt and deletion behavior unchanged', async () => {
    const script = await readInstaller()
    const handler = procedureBody(script, 'CurUninstallStepChanged')

    expect(handler).toContain(
      "MsgBox('是否同时删除服务器地址、登录状态和本地设置？', mbConfirmation, MB_YESNO) = IDYES",
    )
    expect(handler).toContain(
      "DelTree(ExpandConstant('{userappdata}\\Celery Web Speak'), True, True, True)",
    )
  })
})
