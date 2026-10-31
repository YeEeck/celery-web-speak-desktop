import path from 'node:path'
import { app } from 'electron'
import type { Logger } from './logger.js'

export const STARTUP_ENTRY_NAME = 'Celery Web Speak'
export const STARTUP_ENTRY_ARGS: readonly string[] = ['--autostart']

export interface StartupEntry {
  enabled: boolean
  path: string | null
  args: string[]
}

export interface StartupEntryBackend {
  read(): StartupEntry
  write(path: string, args: string[]): void
  remove(): void
}

export interface StartupEntryDependencies {
  backend: StartupEntryBackend
  currentExecutable: string
  logger: Pick<Logger, 'info' | 'warn'>
}

/**
 * 启动条目的唯一读写入口。状态真相是操作系统：每次读取都重新询问后端，
 * 不缓存应用自己的记忆。
 */
export class StartupEntryManager {
  private readonly backend: StartupEntryBackend
  private readonly currentExecutable: string
  private readonly logger: Pick<Logger, 'info' | 'warn'>

  constructor(dependencies: StartupEntryDependencies) {
    this.backend = dependencies.backend
    this.currentExecutable = dependencies.currentExecutable
    this.logger = dependencies.logger
  }

  /**
   * 条目存在、系统启用且记录的可执行文件就是当前程序，才算启用。
   * 路径漂移的条目不算启用，交由路径核对能力修复。
   */
  isEnabled(): boolean {
    const entry = this.readEntry()
    return entry !== null && entry.enabled && entry.path !== null && sameWindowsPath(entry.path, this.currentExecutable)
  }

  /**
   * 写入没有错误通道：写后重新读取，并以操作系统报告的最终状态为准。
   * 失败只记录日志，不向调用方抛错，也不伪造成功。
   */
  setEnabled(enabled: boolean): boolean {
    let writeError: unknown = null
    try {
      if (enabled) this.backend.write(this.currentExecutable, [...STARTUP_ENTRY_ARGS])
      else this.backend.remove()
    } catch (error) {
      writeError = error
    }

    const effective = this.isEnabled()
    if (writeError !== null) {
      this.logger.warn('startup_entry_write_failed', {
        enabled,
        message: errorMessage(writeError),
      })
    } else if (effective === enabled) {
      this.logger.info(enabled ? 'startup_entry_enabled' : 'startup_entry_disabled', {
        path: this.currentExecutable,
      })
    } else {
      this.logger.warn('startup_entry_write_failed', { enabled, effective })
    }
    return effective
  }

  /**
   * 仅当条目存在且启用、记录路径与当前可执行文件不一致时改写路径，参数保持不变。
   * 失败只记录日志，不抛错。
   */
  reconcilePath(): void {
    const entry = this.readEntry()
    if (entry === null || !entry.enabled || entry.path === null) return
    if (sameWindowsPath(entry.path, this.currentExecutable)) return

    try {
      this.backend.write(this.currentExecutable, [...entry.args])
    } catch (error) {
      this.logger.warn('startup_entry_write_failed', {
        operation: 'reconcile',
        message: errorMessage(error),
      })
      return
    }

    if (this.isEnabled()) {
      this.logger.info('startup_entry_reconciled', { from: entry.path, to: this.currentExecutable })
    } else {
      this.logger.warn('startup_entry_write_failed', { operation: 'reconcile' })
    }
  }

  private readEntry(): StartupEntry | null {
    try {
      return this.backend.read()
    } catch (error) {
      this.logger.warn('startup_entry_read_failed', { message: errorMessage(error) })
      return null
    }
  }
}

interface StartupLoginItem {
  name: string
  path: string
  args: string[]
  enabled: boolean
}

export interface LoginItemSettingsApi {
  getLoginItemSettings(): { launchItems: readonly StartupLoginItem[] }
  setLoginItemSettings(settings: {
    openAtLogin?: boolean
    name?: string
    path?: string
    args?: string[]
    enabled?: boolean
  }): void
}

/**
 * 生产后端：按固定条目名读取登录项列表，写入时同时恢复 StartupApproved 启用状态。
 */
export function createElectronStartupEntryBackend(api: LoginItemSettingsApi = app): StartupEntryBackend {
  return {
    read() {
      const item = api.getLoginItemSettings().launchItems.find((candidate) => candidate.name === STARTUP_ENTRY_NAME)
      if (!item) return { enabled: false, path: null, args: [] }
      return { enabled: item.enabled, path: item.path, args: [...item.args] }
    },
    write(executablePath, args) {
      api.setLoginItemSettings({
        openAtLogin: true,
        name: STARTUP_ENTRY_NAME,
        path: executablePath,
        args,
        enabled: true,
      })
    },
    remove() {
      api.setLoginItemSettings({ openAtLogin: false, name: STARTUP_ENTRY_NAME })
    },
  }
}

export function isStartupEntrySupported(packaged: boolean, platform: NodeJS.Platform): boolean {
  return packaged && platform === 'win32'
}

/**
 * 平台与打包门控收在模块内部；不支持的构建返回 null，调用方无需判断平台。
 */
export function createStartupEntry(logger: Pick<Logger, 'info' | 'warn'>): StartupEntryManager | null {
  if (!isStartupEntrySupported(app.isPackaged, process.platform)) return null
  return new StartupEntryManager({
    backend: createElectronStartupEntryBackend(),
    currentExecutable: app.getPath('exe'),
    logger,
  })
}

function sameWindowsPath(left: string, right: string): boolean {
  return normalizeWindowsPath(left) === normalizeWindowsPath(right)
}

function normalizeWindowsPath(value: string): string {
  let candidate = value.trim()
  if (candidate.length >= 2 && candidate.startsWith('"') && candidate.endsWith('"')) {
    candidate = candidate.slice(1, -1)
  }
  return path.win32.normalize(candidate).toLowerCase()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error'
}
