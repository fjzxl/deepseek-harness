/**
 * 画布与单位换算常量。
 *
 * 场景（scene）坐标一律使用英寸（inch），精度 0.01；
 * PPTX 侧直接消费英寸（pptxgenjs），HTML 预览侧按 96dpi 换算为像素，
 * 保证两套渲染器看到完全相同的几何。
 */

/** 幻灯片画布宽度（英寸）。16:9 宽屏，与 PowerPoint 官方一致：13.3333in = 12192000 EMU。 */
export const CANVAS_W_IN = 13.3333

/** 幻灯片画布高度（英寸）。 */
export const CANVAS_H_IN = 7.5

/** HTML 预览的每英寸像素数（CSS px）。13.333in × 96 = 1280px。 */
export const PX_PER_IN = 96

/** 每英寸磅数（1pt = 1/72in）。 */
export const PT_PER_IN = 72

/** 默认安全边距（英寸）：非背景元素不得越出画布减去该边距。 */
export const SAFE_MARGIN_IN = 0.15

export function inToPx(inches: number): number {
  return Math.round(inches * PX_PER_IN * 100) / 100
}

export function ptToPx(points: number): number {
  return Math.round((points * PX_PER_IN) / PT_PER_IN * 100) / 100
}

/** '#RRGGBB' → 'RRGGBB'（pptxgenjs 使用无 # 大写形式）。 */
export function toPptxColor(color: string): string {
  return color.replace('#', '').toUpperCase()
}
