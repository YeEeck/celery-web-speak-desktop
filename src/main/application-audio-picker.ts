import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, desktopCapturer, ipcMain, type WebContents } from 'electron'
import {
  APPLICATION_AUDIO_PICKER_CHANNELS,
  type ApplicationAudioPickerSource,
} from '../shared/application-audio-api.js'
import { isSelectableWindowSource, parseWindowSourceId } from './application-audio-source.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

export interface ApplicationAudioSelection {
  hwndDecimal: string
}

interface ActivePicker {
  window: BrowserWindow
  sourceIds: Map<string, string>
  refreshGeneration: number
  resolve(selection: ApplicationAudioSelection | null): void
}

export class ApplicationAudioPicker {
  private active: ActivePicker | null = null

  constructor() {
    ipcMain.handle(APPLICATION_AUDIO_PICKER_CHANNELS.getSources, (event) => this.getSources(event.sender))
    ipcMain.handle(APPLICATION_AUDIO_PICKER_CHANNELS.choose, (event, token: unknown) => (
      this.choose(event.sender, token)
    ))
    ipcMain.handle(APPLICATION_AUDIO_PICKER_CHANNELS.cancel, (event) => {
      this.assertSender(event.sender)
      this.complete(null)
    })
  }

  open(parent: BrowserWindow): Promise<ApplicationAudioSelection | null> {
    if (this.active) {
      this.active.window.show()
      this.active.window.focus()
      throw new Error('Application audio picker is already open')
    }

    const window = new BrowserWindow({
      parent,
      modal: true,
      title: '选择应用音频',
      width: 820,
      height: 600,
      minWidth: 640,
      minHeight: 480,
      show: false,
      frame: false,
      backgroundColor: '#17191f',
      webPreferences: {
        preload: path.join(currentDirectory, '..', 'preload', 'application-audio-picker.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    })

    const result = new Promise<ApplicationAudioSelection | null>((resolve) => {
      this.active = { window, sourceIds: new Map(), refreshGeneration: 0, resolve }
    })
    window.once('ready-to-show', () => window.show())
    window.on('closed', () => this.complete(null, false))
    void window.loadFile(path.join(currentDirectory, '..', 'renderer', 'application-audio-picker.html'))
    return result
  }

  close(): void {
    this.complete(null)
  }

  private async getSources(sender: WebContents): Promise<ApplicationAudioPickerSource[]> {
    const active = this.assertSender(sender)
    const generation = ++active.refreshGeneration
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      fetchWindowIcons: true,
      thumbnailSize: { width: 320, height: 180 },
    })
    if (this.active !== active || generation !== active.refreshGeneration) return []

    const localWindowSourceIds = new Set<string>()
    for (const localWindow of BrowserWindow.getAllWindows()) {
      if (localWindow.isDestroyed()) continue
      try {
        localWindowSourceIds.add(localWindow.getMediaSourceId())
      } catch {
        // A window can disappear between enumeration and source ID lookup.
      }
    }

    const sourceIds = new Map<string, string>()
    const candidates: ApplicationAudioPickerSource[] = []
    for (const source of sources) {
      if (!isSelectableWindowSource({
        id: source.id,
        title: source.name,
        thumbnailEmpty: source.thumbnail.isEmpty(),
      }, localWindowSourceIds)) continue

      const token = randomUUID()
      sourceIds.set(token, source.id)
      candidates.push({
        token,
        title: source.name.trim() || '未命名窗口',
        thumbnailDataUrl: source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL(),
        appIconDataUrl: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
      })
    }
    active.sourceIds = sourceIds
    return candidates
  }

  private choose(sender: WebContents, token: unknown): void {
    const active = this.assertSender(sender)
    if (typeof token !== 'string') throw new Error('Invalid application audio source token')
    const sourceId = active.sourceIds.get(token)
    const hwndDecimal = sourceId ? parseWindowSourceId(sourceId) : null
    if (!hwndDecimal) throw new Error('Application audio source is no longer available')
    this.complete({ hwndDecimal })
  }

  private assertSender(sender: WebContents): ActivePicker {
    if (!this.active || this.active.window.isDestroyed() || sender !== this.active.window.webContents) {
      throw new Error('Application audio picker IPC is only available to the active picker')
    }
    return this.active
  }

  private complete(selection: ApplicationAudioSelection | null, destroy = true): void {
    const active = this.active
    if (!active) return
    this.active = null
    active.sourceIds.clear()
    active.resolve(selection)
    if (destroy && !active.window.isDestroyed()) active.window.destroy()
  }
}

