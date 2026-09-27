/**
 * 主题化背景纹理（0.18.0，roadmap T2-2）：SVG pattern → 双端一致的页面底纹。
 *
 * 动机：纯色底页面（浅灰/米白）在大面积留白时显得"平"。零素材成本增加质感的
 * 路径是低透明度的确定性纹样：点阵 dots / 斜线 diagonal / 窗棂 lattice，
 * 颜色取锁定色阶（浅色底用 primary-300、深色底用 primary-600），透明度低于
 * 水印阈值——只提供"材质感"，绝不与内容争视觉。
 *
 * 消费方式：纹理由**渲染器**在渲染时注入（不是 PageScene 元素）——手写页与
 * content 页自动同享、sceneHash 不受影响、旧 deck 重新渲染即可获得。
 * HTML 端整页内联 SVG；PPTX 端整册光栅化一次（resvg pattern 支持）复用。
 */
import { CANVAS_H_IN, CANVAS_W_IN } from './units.js'
import type { TextureConfig } from './schema.js'

export const TEXTURE_KINDS = ['dots', 'diagonal', 'lattice'] as const
export type TextureKind = (typeof TEXTURE_KINDS)[number]

/** 纹理画布坐标系：120 单位/英寸（16:9 与画布一致，1600×900，取整避免 viewBox 浮点）。 */
export const TEXTURE_W = Math.round(CANVAS_W_IN * 120)
export const TEXTURE_H = Math.round(CANVAS_H_IN * 120)

/**
 * 纹样定义（tile 内容；fill/stroke 由外部注入 fill-opacity/opacity）。
 * 尺寸经视觉验证：点 9.5 半径 / 斜带 17 宽 / 窗棂格 56——16:9 全幅下密度适中。
 */
function tile(kind: TextureKind, color: string, opacity: number): { size: number; markup: string } {
  if (kind === 'dots') {
    return {
      size: 52,
      markup: `<circle cx="13" cy="13" r="4.6" fill="${color}" fill-opacity="${opacity}"/>` +
        `<circle cx="39" cy="39" r="4.6" fill="${color}" fill-opacity="${opacity}"/>`,
    }
  }
  if (kind === 'diagonal') {
    return {
      size: 46,
      markup: `<rect x="0" y="0" width="17" height="46" fill="${color}" fill-opacity="${opacity}" transform="translate(-8.5,0)"/>`,
    }
  }
  return {
    size: 62,
    markup: `<rect x="8" y="8" width="46" height="46" rx="3" fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="2.6"/>`,
  }
}

/**
 * 生成整页纹理 SVG（宽高属性 100%——HTML 容器填满；PPTX 光栅化按 viewBox 比例）。
 * diagonal 用 patternTransform=rotate(45) 把竖带转成斜带。
 */
export function renderTextureSvg(config: TextureConfig): string {
  const { kind, color, opacity } = config
  const t = tile(kind, color, opacity)
  const rotate = kind === 'diagonal' ? ' patternTransform="rotate(45)"' : ''
  return (
    `<svg viewBox="0 0 ${TEXTURE_W} ${TEXTURE_H}" width="100%" height="100%" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><pattern id="pptx-tex" width="${t.size}" height="${t.size}" patternUnits="userSpaceOnUse"${rotate}>${t.markup}</pattern></defs>` +
    `<rect width="${TEXTURE_W}" height="${TEXTURE_H}" fill="url(#pptx-tex)"/></svg>`
  )
}

/**
 * 结构页双色渐变 SVG（0.19.0，roadmap T3-1）：PPTX 端光栅化为整页 PNG 垫底
 * （HTML 端直接用 CSS linear-gradient，不经此函数）。
 * 角度语义与 CSS 一致（0deg=向上、顺时针）；渐变线过 bounding box 中心，
 * 端点取与边界的交点——135deg 恰为 (0,0)→(1,1) 对角。
 */
export function renderGradientSvg(from: string, to: string, angle: number): string {
  const rad = (angle * Math.PI) / 180
  const dx = Math.sin(rad)
  const dy = -Math.cos(rad)
  const tx = Math.abs(dx) < 1e-6 ? Number.POSITIVE_INFINITY : 0.5 / Math.abs(dx)
  const ty = Math.abs(dy) < 1e-6 ? Number.POSITIVE_INFINITY : 0.5 / Math.abs(dy)
  const t = Math.min(tx, ty)
  const pt = (v: number): string => (Math.round(v * 10000) / 10000).toString()
  return (
    `<svg viewBox="0 0 ${TEXTURE_W} ${TEXTURE_H}" width="100%" height="100%" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">` +
    '<defs><linearGradient id="pptx-grad" gradientUnits="objectBoundingBox" ' +
    `x1="${pt(0.5 - t * dx)}" y1="${pt(0.5 - t * dy)}" x2="${pt(0.5 + t * dx)}" y2="${pt(0.5 + t * dy)}">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
    `<rect width="${TEXTURE_W}" height="${TEXTURE_H}" fill="url(#pptx-grad)"/></svg>`
  )
}
