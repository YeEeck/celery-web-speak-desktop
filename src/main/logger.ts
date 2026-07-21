import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import path from 'node:path'

const MAX_LOG_SIZE = 512 * 1024

export class Logger {
  private readonly logPath: string
  private readonly previousPath: string
  private queue: Promise<void> = Promise.resolve()

  constructor(userDataPath: string) {
    const directory = path.join(userDataPath, 'logs')
    this.logPath = path.join(directory, 'desktop.log')
    this.previousPath = path.join(directory, 'desktop.previous.log')
  }

  info(event: string, details: Record<string, unknown> = {}): void {
    this.write('info', event, details)
  }

  warn(event: string, details: Record<string, unknown> = {}): void {
    this.write('warn', event, details)
  }

  error(event: string, details: Record<string, unknown> = {}): void {
    this.write('error', event, details)
  }

  flush(): Promise<void> {
    return this.queue
  }

  private write(level: string, event: string, details: Record<string, unknown>): void {
    const entry = `${JSON.stringify({ time: new Date().toISOString(), level, event, ...details })}\n`
    this.queue = this.queue.then(async () => {
      await mkdir(path.dirname(this.logPath), { recursive: true })
      await this.rotateIfNeeded()
      await appendFile(this.logPath, entry, { encoding: 'utf8', mode: 0o600 })
    }).catch(() => undefined)
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      const current = await stat(this.logPath)
      if (current.size < MAX_LOG_SIZE) return
      await rename(this.logPath, this.previousPath)
    } catch {
      // A missing or locked log file is handled by the following append.
    }
  }
}
