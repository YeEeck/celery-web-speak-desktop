import type { Rectangle } from 'electron'
import type { WindowState } from './config.js'

export function visibleWindowBounds(state: WindowState, displays: readonly Rectangle[]): Rectangle {
  const fallback = { x: 0, y: 0, width: state.width, height: state.height }
  if (state.x === null || state.y === null) return fallback

  const candidate = { x: state.x, y: state.y, width: state.width, height: state.height }
  const visible = displays.some((display) => intersectionArea(candidate, display) >= 80 * 80)
  return visible ? candidate : fallback
}

function intersectionArea(a: Rectangle, b: Rectangle): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return width * height
}
