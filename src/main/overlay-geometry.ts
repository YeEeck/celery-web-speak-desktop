import type { VoiceOverlayConfig } from '../shared/voice-overlay-api.js'
import type { ContentSize } from '../shared/voice-overlay-api.js'

// 浮层窗口几何计算：窗口尺寸由浮层页面测量上报（report-content-size），
// 壳层只按浮层配置计算窗口位置（中心点按屏幕百分比定位）。与设计文档「浮层配置语义」一致。

export interface WorkArea {
  x: number
  y: number
  width: number
  height: number
}

export interface OverlayBounds {
  x: number
  y: number
  width: number
  height: number
}

export function computeOverlayBounds(
  config: VoiceOverlayConfig,
  workArea: WorkArea,
  size: ContentSize,
): OverlayBounds {
  return {
    x: workArea.x + Math.round(workArea.width * config.positionXPercent / 100) - Math.round(size.width / 2),
    y: workArea.y + Math.round(workArea.height * config.positionYPercent / 100) - Math.round(size.height / 2),
    width: size.width,
    height: size.height,
  }
}
