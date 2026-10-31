import path from 'node:path'
import { app } from 'electron'
import type { Logger } from './logger.js'
import { AUTOSTART_FLAG } from './startup-args.js'
import { STARTUP_ENTRY_NAME } from '../shared/startup-entry-api.js'

export const STARTUP_ENTRY_ARGS: readonly string[] = [AUTOSTART_FLAG]

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
      this.backend.write(this.currentExecutable, withStartupArgs(entry.args))
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
  scope: 'user' | 'machine'
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
 * 只看当前用户（HKCU）的条目：机器级（HKLM）同名声明的条目不属于本应用。
 * 注意 launchItems 的 args 不含开关型参数（--autostart 会被 Chromium 当作 switch），
 * 写入方始终用 STARTUP_ENTRY_ARGS，读取方不能把它当成条目参数的完整快照。
 */
export function createElectronStartupEntryBackend(api: LoginItemSettingsApi = app): StartupEntryBackend {
  return {
    read() {
      const item = api
        .getLoginItemSettings()
        .launchItems
        .find((candidate) => candidate.name === STARTUP_ENTRY_NAME && candidate.scope === 'user')
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

/**
 * 启动时的一次性路径核对，在应用初始化完成后、窗口创建前调用。
 * 管理器在开发模式与非 Windows 下为 null，此时不读不写；
 * 核对自身意外抛错也只留一条日志，绝不能让应用启动失败。
 */
export function reconcileStartupEntry(
  startupEntry: Pick<StartupEntryManager, 'reconcilePath'> | null,
  logger: Pick<Logger, 'warn'>,
): void {
  if (startupEntry === null) return
  try {
    startupEntry.reconcilePath()
  } catch (error) {
    logger.warn('startup_entry_write_failed', {
      operation: 'reconcile',
      message: errorMessage(error),
    })
  }
}

/**
 * 启动条目由本应用拥有，固定启动参数必须留在条目里。Electron 的 launchItems
 * 不回传开关型参数（Chromium 把 --autostart 当作 switch），读回值可能为空；
 * 改写路径时补回，避免自愈把“登录拉起”的标记丢掉。
 */
function withStartupArgs(reported: readonly string[]): string[] {
  const args = [...reported]
  for (const argument of STARTUP_ENTRY_ARGS) {
    if (!args.includes(argument)) args.push(argument)
  }
  return args
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
