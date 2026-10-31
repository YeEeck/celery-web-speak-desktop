import { describe, expect, it } from 'vitest'
import { applicationMenuHeight } from './menu.js'

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
