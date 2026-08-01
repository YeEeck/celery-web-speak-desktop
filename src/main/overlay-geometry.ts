import type { VoiceOverlayConfig } from '../shared/voice-overlay-api.js'

// 浮层窗口几何计算：基准 280×300 等比缩放，窗口中心点按屏幕百分比定位，
// 窗口高度随参与者行数自适应（空态保持一行高度）。与设计文档「浮层配置语义」一致。
const OVERLAY_BASE_WIDTH = 280
const PARTICIPANT_ROW_HEIGHT = 36

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
  participantCount: number,
): OverlayBounds {
  const scale = config.scalePercent / 100
  const width = Math.round(OVERLAY_BASE_WIDTH * scale)
  const rowHeight = Math.round(PARTICIPANT_ROW_HEIGHT * scale)
  const rows = Math.max(1, participantCount)
  const height = rows * rowHeight
  return {
    x: workArea.x + Math.round(workArea.width * config.positionXPercent / 100) - Math.round(width / 2),
    y: workArea.y + Math.round(workArea.height * config.positionYPercent / 100) - Math.round(height / 2),
    width,
    height,
  }
}
