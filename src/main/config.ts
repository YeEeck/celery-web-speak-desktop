import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'

export interface WindowState {
  width: number
  height: number
  x: number | null
  y: number | null
  maximized: boolean
}

export interface AppConfig {
  version: 1
  serverUrl: string
  window: WindowState
}

export const DEFAULT_WINDOW_STATE: WindowState = {
  width: 1280,
  height: 800,
  x: null,
  y: null,
  maximized: false,
}

export class ServerUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServerUrlError'
  }
}

export function normalizeServerUrl(input: string): string {
  const value = input.trim()
  if (!value) throw new ServerUrlError('请输入服务器地址')

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ServerUrlError('服务器地址格式无效')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ServerUrlError('服务器地址必须使用 http:// 或 https://')
  }
  if (url.username || url.password) throw new ServerUrlError('服务器地址不能包含用户名或密码')
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new ServerUrlError('服务器必须部署在 Origin 根路径，地址不能包含路径、参数或锚点')
  }

  return url.origin
}

export function configPath(userDataPath: string): string {
  return path.join(userDataPath, 'config.json')
}

export function readStartupServerUrl(userDataPath: string): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath(userDataPath), 'utf8'))
    return parseConfig(parsed)?.serverUrl ?? null
  } catch {
    return null
  }
}

export class ConfigStore {
  readonly filePath: string

  constructor(private readonly userDataPath: string) {
    this.filePath = configPath(userDataPath)
  }

  async load(): Promise<AppConfig | null> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
      return parseConfig(parsed)
    } catch {
      return null
    }
  }

  async save(serverUrl: string, windowState: WindowState = DEFAULT_WINDOW_STATE): Promise<AppConfig> {
    const config: AppConfig = {
      version: 1,
      serverUrl: normalizeServerUrl(serverUrl),
      window: normalizeWindowState(windowState),
    }
    await this.write(config)
    return config
  }

  async updateWindow(windowState: WindowState): Promise<void> {
    const current = await this.load()
    if (!current) return
    await this.write({ ...current, window: normalizeWindowState(windowState) })
  }

  private async write(config: AppConfig): Promise<void> {
    await mkdir(this.userDataPath, { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
    await rename(temporaryPath, this.filePath)
  }
}

function parseConfig(value: unknown): AppConfig | null {
  if (!isRecord(value) || value.version !== 1 || typeof value.serverUrl !== 'string') return null
  try {
    return {
      version: 1,
      serverUrl: normalizeServerUrl(value.serverUrl),
      window: normalizeWindowState(value.window),
    }
  } catch {
    return null
  }
}

function normalizeWindowState(value: unknown): WindowState {
  if (!isRecord(value)) return { ...DEFAULT_WINDOW_STATE }
  return {
    width: clampInteger(value.width, 960, 7680, DEFAULT_WINDOW_STATE.width),
    height: clampInteger(value.height, 640, 4320, DEFAULT_WINDOW_STATE.height),
    x: nullableInteger(value.x),
    y: nullableInteger(value.y),
    maximized: value.maximized === true,
  }
}

function clampInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback
  return Math.min(maximum, Math.max(minimum, value))
}

function nullableInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
