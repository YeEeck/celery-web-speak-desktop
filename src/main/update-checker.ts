import { createRequire } from 'node:module'
import { app, net, shell } from 'electron'
import type { ConfigStore } from './config.js'
import type { Logger } from './logger.js'
import type { UpdateCheckResult, UpdateInfo } from '../shared/update-api.js'

const require = createRequire(import.meta.url)

interface UpdateResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export interface UpdateCheckerDependencies {
  fetch(url: string, init: RequestInit): Promise<UpdateResponse>
  getCurrentVersion(): string
  openExternal(url: string): Promise<unknown>
}

export interface UpdateState {
  available: boolean
  info: UpdateInfo | null
}

export class UpdateChecker {
  private state: UpdateState = { available: false, info: null }
  private readonly repoOwner: string
  private readonly repoName: string
  private readonly dependencies: UpdateCheckerDependencies

  constructor(
    private readonly store: Pick<ConfigStore, 'load' | 'updatePreferences'>,
    private readonly logger: Pick<Logger, 'info' | 'warn'>,
    private readonly notify: (state: UpdateState) => void,
    dependencies?: UpdateCheckerDependencies,
  ) {
    const pkg = require('../../package.json') as { repository?: { url?: string } }
    const parsed = parseGitHubRepo(pkg.repository?.url ?? '')
    this.repoOwner = parsed.owner
    this.repoName = parsed.repo
    this.dependencies = dependencies ?? {
      fetch: (url, init) => net.fetch(url, init),
      getCurrentVersion: () => app.getVersion(),
      openExternal: (url) => shell.openExternal(url),
    }
  }

  getState(): UpdateState {
    return this.state
  }

  /**
   * 检查更新。manual=true 时无视跳过记录并反馈错误。
   */
  async check(manual: boolean): Promise<UpdateCheckResult> {
    try {
      const url = `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/releases/latest`
      const response = await this.dependencies.fetch(url, {
        headers: { accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) {
        throw new Error(`GitHub API responded ${response.status}`)
      }
      const data = (await response.json()) as { tag_name?: string; html_url?: string }
      const latestVersion = normalizeTag(data.tag_name ?? '')
      const releaseUrl = data.html_url ?? ''
      if (!latestVersion || !releaseUrl) {
        throw new Error('GitHub release 缺少 tag_name 或 html_url')
      }

      const currentVersion = this.dependencies.getCurrentVersion()
      if (compareVersions(latestVersion, currentVersion) <= 0) {
        this.setState({ available: false, info: null })
        return { ok: true }
      }

      const info: UpdateInfo = { version: latestVersion, releaseUrl }
      this.setState({ available: true, info })
      this.logger.info('update_available', { current: currentVersion, latest: latestVersion })

      if (!manual) {
        const config = await this.store.load()
        if (config?.skippedVersion === latestVersion) {
          // 已跳过的版本：只更新状态（显示按钮），不弹窗
          return { ok: true }
        }
      }
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error'
      this.logger.warn('update_check_failed', { message, manual })
      if (manual) return { ok: false, error: '检查更新失败，请稍后重试' }
      return { ok: true }
    }
  }

  async skipVersion(version: string): Promise<void> {
    await this.store.updatePreferences({ skippedVersion: version })
    this.logger.info('update_skipped', { version })
  }

  openReleasePage(): void {
    if (this.state.info?.releaseUrl) {
      void this.dependencies.openExternal(this.state.info.releaseUrl)
    }
  }

  /**
   * 判断启动时是否应自动弹出更新对话框。
   */
  async shouldShowDialogOnStartup(): Promise<boolean> {
    if (!this.state.available || !this.state.info) return false
    const config = await this.store.load()
    return config?.skippedVersion !== this.state.info.version
  }

  private setState(state: UpdateState): void {
    this.state = state
    this.notify(state)
  }
}

export function parseGitHubRepo(url: string): { owner: string; repo: string } {
  // 支持 https://github.com/owner/repo.git 和 git@github.com:owner/repo.git
  const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/)
  if (!match) return { owner: '', repo: '' }
  return { owner: match[1] ?? '', repo: match[2] ?? '' }
}

export function normalizeTag(tag: string): string {
  return tag.startsWith('v') ? tag.slice(1) : tag
}

export function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number)
  const partsB = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}
