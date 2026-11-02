import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
export const STARTUP_APPROVED_KEY =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'

export interface RegistryStartupEntry {
  path: string
  args: string[]
  enabled: boolean
}

/**
 * 直接读注册表得到启动条目的真实状态。
 *
 * 不能用 Electron 的 `getLoginItemSettings().launchItems`：它只列出“路径与传入路径匹配”
 * 的条目，路径含空格时连自己写入的条目都读不回来，也无法发现指向旧位置的条目。
 * 这里读当前用户的 Run 值（UTF-16 导出的 .reg 文件，避免控制台代码页问题），
 * 再用 StartupApproved 的二进制值判断任务管理器里的启用状态。
 */
export async function readStartupEntry(name: string): Promise<RegistryStartupEntry | null> {
  const commandLine = parseRegValueText(await exportRegistryKey(RUN_KEY), name)
  if (commandLine === null) return null

  const command = parseCommandLine(commandLine)
  const approved = await exportRegistryKey(STARTUP_APPROVED_KEY).catch(() => '')
  return {
    path: command.path,
    args: command.args,
    enabled: isStartupApprovedEnabled(parseRegBinary(approved, name)),
  }
}

async function exportRegistryKey(key: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'cws-reg-'))
  const file = path.join(directory, 'key.reg')
  try {
    await execFileAsync(registryExecutable(), ['export', key, file, '/y'], { windowsHide: true })
    const contents = await readFile(file)
    return contents.toString('utf16le').replace(/^\uFEFF/, '')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function registryExecutable(): string {
  const root = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows'
  return path.join(root, 'System32', 'reg.exe')
}

/**
 * 从 `.reg` 导出文本里取指定值的数据（REG_SZ / REG_EXPAND_SZ）。
 * 名称或数据不存在时返回 null。
 */
export function parseRegValueText(exportText: string, name: string): string | null {
  const prefix = `"${escapeRegString(name)}"=`
  for (const line of exportText.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith(prefix)) continue
    const raw = trimmed.slice(prefix.length)
    if (raw.startsWith('"')) {
      const end = raw.lastIndexOf('"')
      return end > 0 ? unescapeRegString(raw.slice(1, end)) : null
    }
    const hex = /^hex(?:\([0-9a-f]+\))?:(.*)$/i.exec(raw)
    return hex ? decodeUtf16(parseHexBytes(hex[1] ?? '')) : null
  }
  return null
}

/**
 * 从 `.reg` 导出文本里取指定值的二进制数据（StartupApproved 使用 REG_BINARY）。
 */
export function parseRegBinary(exportText: string, name: string): number[] | null {
  const prefix = `"${escapeRegString(name)}"=hex:`
  for (const line of exportText.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith(prefix)) continue
    return parseHexBytes(trimmed.slice(prefix.length))
  }
  return null
}

/**
 * 与 Electron / 任务管理器一致：没有 StartupApproved 记录视为启用；
 * 记录的首个 DWORD 为 0 或 2 才是启用，其余（如 3 = 任务管理器禁用）都是停用。
 */
export function isStartupApprovedEnabled(bytes: readonly number[] | null): boolean {
  if (bytes === null || bytes.length < 4) return true
  const state = (
    (bytes[0] ?? 0)
    | ((bytes[1] ?? 0) << 8)
    | ((bytes[2] ?? 0) << 16)
    | ((bytes[3] ?? 0) << 24)
  ) >>> 0
  return state === 0 || state === 2
}

/**
 * 拆出命令行里的可执行文件与参数：优先处理引号包裹的路径（路径可能含空格）。
 */
export function parseCommandLine(commandLine: string): { path: string; args: string[] } {
  const value = commandLine.trim()
  if (value.length === 0) return { path: '', args: [] }
  if (value.startsWith('"')) {
    const end = value.indexOf('"', 1)
    if (end === -1) return { path: value.slice(1), args: [] }
    return { path: value.slice(1, end), args: splitArguments(value.slice(end + 1)) }
  }
  const separator = value.search(/\s/)
  if (separator === -1) return { path: value, args: [] }
  return { path: value.slice(0, separator), args: splitArguments(value.slice(separator + 1)) }
}

function splitArguments(value: string): string[] {
  const args: string[] = []
  let current = ''
  let quoted = false
  for (const character of value.trim()) {
    if (character === '"') {
      quoted = !quoted
      continue
    }
    if (!quoted && /\s/.test(character)) {
      if (current.length > 0) {
        args.push(current)
        current = ''
      }
      continue
    }
    current += character
  }
  if (current.length > 0) args.push(current)
  return args
}

function escapeRegString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function unescapeRegString(value: string): string {
  let result = ''
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === '\\' && index + 1 < value.length) {
      result += value[index + 1]
      index += 1
    } else {
      result += character
    }
  }
  return result
}

function parseHexBytes(value: string): number[] {
  return value
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 16))
    .filter((byte) => Number.isFinite(byte))
}

function decodeUtf16(bytes: readonly number[]): string {
  return Buffer.from(bytes).toString('utf16le').replace(/\u0000+$/, '')
}
