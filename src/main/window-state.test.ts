import { describe, expect, it } from 'vitest'
import type { WindowState } from './config.js'
import { visibleWindowBounds } from './window-state.js'

const display = { x: 0, y: 0, width: 1920, height: 1080 }

describe('visibleWindowBounds', () => {
  it('restores bounds that remain visible', () => {
    expect(visibleWindowBounds(state({ x: 120, y: 80 }), [display])).toEqual({
      x: 120,
      y: 80,
      width: 1280,
      height: 800,
    })
  })

  it('drops a position outside all displays', () => {
    expect(visibleWindowBounds(state({ x: 4000, y: 3000 }), [display])).toEqual({
      x: 0,
      y: 0,
      width: 1280,
      height: 800,
    })
  })

  it('uses automatic positioning when no position was saved', () => {
    expect(visibleWindowBounds(state({ x: null, y: null }), [display])).toMatchObject({ x: 0, y: 0 })
  })
})

function state(overrides: Partial<WindowState>): WindowState {
  return { width: 1280, height: 800, x: null, y: null, maximized: false, ...overrides }
}
