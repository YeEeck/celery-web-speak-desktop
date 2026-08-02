import { describe, expect, it } from 'vitest'
import { computeOverlayBounds } from './overlay-geometry.js'
import type { VoiceOverlayConfig } from '../shared/voice-overlay-api.js'

const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1080 }

const baseConfig: VoiceOverlayConfig = {
  scalePercent: 100,
  positionXPercent: 50,
  positionYPercent: 50,
  speakingOpacityPercent: 80,
  silentOpacityPercent: 40,
}

describe('computeOverlayBounds', () => {
  it('centers a window with the reported size on the percentage coordinates', () => {
    expect(computeOverlayBounds(baseConfig, WORK_AREA, { width: 280, height: 108 })).toEqual({
      x: 820,
      y: 486,
      width: 280,
      height: 108,
    })
  })

  it('keeps the center point on the percentage coordinates', () => {
    expect(computeOverlayBounds(
      { ...baseConfig, positionXPercent: 25, positionYPercent: 75 },
      WORK_AREA,
      { width: 280, height: 36 },
    )).toEqual({
      x: 340,
      y: 792,
      width: 280,
      height: 36,
    })
  })

  it('uses the reported size verbatim without row prediction', () => {
    expect(computeOverlayBounds({ ...baseConfig, positionXPercent: 50, positionYPercent: 50 }, WORK_AREA, { width: 420, height: 54 })).toEqual({
      x: 750,
      y: 513,
      width: 420,
      height: 54,
    })
  })

  it('offsets the center by the work area origin (multi-monitor)', () => {
    expect(computeOverlayBounds(baseConfig, { x: 1920, y: 0, width: 1920, height: 1080 }, { width: 280, height: 36 })).toEqual({
      x: 2740,
      y: 522,
      width: 280,
      height: 36,
    })
  })
})
