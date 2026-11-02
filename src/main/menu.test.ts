import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MENU_LAYOUT, applicationMenuHeight } from './menu.js'

const menuHtmlPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'renderer',
  'menu.html',
)

describe('applicationMenuHeight', () => {
  it('sizes the remote menu so every item fits without extra space', () => {
    expect(applicationMenuHeight(true, false)).toBe(245)
    expect(applicationMenuHeight(true, true)).toBe(279)
  })

  it('sizes the setup menu so every item fits without extra space', () => {
    expect(applicationMenuHeight(false, false)).toBe(168)
    expect(applicationMenuHeight(false, true)).toBe(202)
  })

  it('adds exactly one menu item height when the autostart entry is visible', () => {
    expect(applicationMenuHeight(true, true) - applicationMenuHeight(true, false)).toBe(34)
    expect(applicationMenuHeight(false, true) - applicationMenuHeight(false, false)).toBe(34)
  })
})

describe('MENU_LAYOUT', () => {
  it('matches the structure rendered from menu.html', async () => {
    const html = await readFile(menuHtmlPath, 'utf8')
    const rendered = [...html.matchAll(/<(?:button|div) class="([^"]*)"[^>]*>/g)]
      .map((match) => match[1] ?? '')
      .filter((classes) => classes.includes('menu-item') || classes.includes('menu-separator'))
      .map((classes) => ({
        kind: classes.includes('menu-item') ? 'item' : 'separator',
        remoteOnly: classes.includes('remote-only'),
        autostartOnly: classes.includes('autostart-only'),
      }))

    expect(rendered).toEqual(MENU_LAYOUT.map((entry) => ({
      kind: entry.kind,
      remoteOnly: entry.remoteOnly === true,
      autostartOnly: entry.autostartOnly === true,
    })))
  })
})
