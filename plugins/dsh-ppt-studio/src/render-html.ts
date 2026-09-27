/**
 * 场景 → 自包含 HTML 预览播放器（所见即所得）。
 *
 * 与 render-pptx.ts 消费同一份 PageScene：英寸 × 96 = 像素、磅 × 4/3 = 像素，
 * 元素坐标一一对应。播放器单文件自包含（CSS/JS 内联、图片 base64 内嵌），
 * 无任何外链——内网 / 离线环境双击即可放映。
 *
 * 已知近似：图表为 SVG 矢量重绘（PPTX 端是原生图表，风格一致但像素不完全相同）；
 * 少数艺术形状（三角/箭头等）用 clip-path 逼近 OOXML 预设形状。
 */
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChartElement, ImageElement, PageScene, SceneElement, ShapeElement, TableElement, TextElement } from './schema.js'
import type { ResolvedTheme } from './themes.js'
import { structuralGradient } from './themes.js'
import type { DeckStore } from './deck-store.js'
import { CANVAS_H_IN, CANVAS_W_IN, inToPx, ptToPx } from './units.js'
import { readAssetBuffer } from './assets.js'
import { renderTextureSvg } from './texture.js'

export interface RenderHtmlInput {
  store: DeckStore
  deckId: string
  deckTitle: string
  theme: ResolvedTheme
  pages: PageScene[]
  /** 生成进度（即时预览时提供；written < total 时播放器顶部显示进度条） */
  progress?: DeckProgress
}

/** 生成进度信息（进度可视化：总进度 + 各部分进度）。 */
export interface DeckProgress {
  written: number
  total: number
  parts: Array<{ title: string; written: number; pages: number }>
}

export interface RenderHtmlResult {
  htmlPath: string
  bytes: number
}

// ---------------------------------------------------------------- 工具

function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function fontStack(name: string): string {
  return `'${name}', 'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', SimHei, sans-serif`
}

const CLIP_PATHS: Record<string, string> = {
  triangle: 'polygon(50% 0%, 100% 100%, 0% 100%)',
  diamond: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
  chevron: 'polygon(0% 0%, 75% 0%, 100% 50%, 75% 100%, 0% 100%, 25% 50%)',
  rightArrow: 'polygon(0% 25%, 70% 25%, 70% 0%, 100% 50%, 70% 100%, 70% 75%, 0% 75%)',
  pentagon: 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)',
  // 0.14.0 强模型表达面扩充（与 OOXML 预设几何近似的多边形，双端视觉一致）
  hexagon: 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)',
  parallelogram: 'polygon(25% 0%, 100% 0%, 75% 100%, 0% 100%)',
  trapezoid: 'polygon(20% 0%, 80% 0%, 100% 100%, 0% 100%)',
  leftArrow: 'polygon(100% 25%, 30% 25%, 30% 0%, 0% 50%, 30% 100%, 30% 75%, 100% 75%)',
  upArrow: 'polygon(50% 0%, 100% 30%, 75% 30%, 75% 100%, 25% 100%, 25% 30%, 0% 30%)',
  downArrow: 'polygon(25% 0%, 75% 0%, 75% 70%, 100% 70%, 50% 100%, 0% 70%, 25% 70%)',
  star5: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
  // 0.21.0 P3：直线多边形新形状（CSS clip-path polygon 直接表达）
  octagon: 'polygon(29% 0%, 71% 0%, 100% 29%, 100% 71%, 71% 100%, 29% 100%, 0% 71%, 0% 29%)',
  plus: 'polygon(36% 0%, 64% 0%, 64% 36%, 100% 36%, 100% 64%, 64% 64%, 64% 100%, 36% 100%, 36% 64%, 0% 64%, 0% 36%, 36% 36%)',
  lightningBolt: 'polygon(62% 0%, 28% 56%, 47% 56%, 34% 100%, 76% 42%, 54% 42%, 72% 0%)',
  // 0.21.0 P3：曲线/空心形状引用 SHAPE_CLIP_DEFS 的 objectBoundingBox SVG clipPath
  donut: 'url(#pptx-shape-donut)',
  frame: 'url(#pptx-shape-frame)',
  can: 'url(#pptx-shape-can)',
  teardrop: 'url(#pptx-shape-teardrop)',
  pie: 'url(#pptx-shape-pie)',
  cloud: 'url(#pptx-shape-cloud)',
  heart: 'url(#pptx-shape-heart)',
}

/**
 * 曲线/空心形状的 SVG clipPath 定义（0.21.0 P3）：clipPathUnits=objectBoundingBox
 * （坐标 0-1 相对各元素自身包围盒），注入播放器一次、全页元素引用。
 * 路径按 OOXML 预设几何自写（近似），不搬 GPL 库的 geometryMap 数据表。
 */
const SHAPE_CLIP_DEFS = `<svg id="pptx-shape-defs" width="0" height="0" aria-hidden="true"><defs>` +
  '<clipPath id="pptx-shape-donut" clipPathUnits="objectBoundingBox"><path clip-rule="evenodd" d="M0 0.5 A0.5 0.5 0 1 1 1 0.5 A0.5 0.5 0 1 1 0 0.5 Z M0.25 0.5 A0.25 0.25 0 1 0 0.75 0.5 A0.25 0.25 0 1 0 0.25 0.5 Z"/></clipPath>' +
  '<clipPath id="pptx-shape-frame" clipPathUnits="objectBoundingBox"><path clip-rule="evenodd" d="M0 0 H1 V1 H0 Z M0.22 0.22 H0.78 V0.78 H0.22 Z"/></clipPath>' +
  '<clipPath id="pptx-shape-can" clipPathUnits="objectBoundingBox"><path d="M0 0.18 A0.5 0.18 0 0 1 1 0.18 L1 0.82 A0.5 0.18 0 0 1 0 0.82 Z"/></clipPath>' +
  '<clipPath id="pptx-shape-teardrop" clipPathUnits="objectBoundingBox"><path d="M0.5 0 C0.52 0.05 1 0.38 1 0.62 A0.5 0.38 0 1 1 0 0.62 C0 0.38 0.48 0.05 0.5 0 Z"/></clipPath>' +
  '<clipPath id="pptx-shape-pie" clipPathUnits="objectBoundingBox"><path d="M0.5 0.5 L0.5 0 A0.5 0.5 0 1 1 0 0.5 Z"/></clipPath>' +
  '<clipPath id="pptx-shape-cloud" clipPathUnits="objectBoundingBox"><path d="M0.07 0.66 A0.15 0.15 0 0 1 0.22 0.51 A0.24 0.24 0 0 1 0.5 0.26 A0.25 0.25 0 0 1 0.92 0.5 A0.17 0.17 0 0 1 0.8 0.8 L0.14 0.8 A0.15 0.15 0 0 1 0.07 0.66 Z"/></clipPath>' +
  '<clipPath id="pptx-shape-heart" clipPathUnits="objectBoundingBox"><path d="M0.5 0.96 C0.12 0.68 0.02 0.46 0.1 0.28 C0.18 0.1 0.4 0.12 0.5 0.32 C0.6 0.12 0.82 0.1 0.9 0.28 C0.98 0.46 0.88 0.68 0.5 0.96 Z"/></clipPath>' +
  '</defs></svg>'

/** 旋转元素 → CSS transform（度，顺时针；transform-origin 默认 50% 50% 与 pptxgenjs rotate 一致）。 */
function rotateStyle(el: SceneElement): string {
  const rotation = (el as { rotation?: number }).rotation
  return rotation !== undefined && rotation !== 0 ? `transform:rotate(${rotation}deg);` : ''
}

function baseStyle(el: SceneElement): string {
  const z = el.z ?? 0
  return `left:${inToPx(el.x)}px;top:${inToPx(el.y)}px;width:${inToPx(el.w)}px;height:${inToPx(el.h)}px;z-index:${z};`
}

// ---------------------------------------------------------------- SVG 图表

function niceMax(value: number): number {
  if (value <= 0) return 1
  const exp = Math.pow(10, Math.floor(Math.log10(value)))
  const fraction = value / exp
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10
  return nice * exp
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function legendSvg(chart: ChartElement, colors: string[], x0: number, y: number, textColor: string, font: string): { svg: string; height: number } {
  if (!chart.showLegend || chart.series.length === 0) return { svg: '', height: 0 }
  const items = chart.series.map(s => s.name)
  let x = x0
  const parts: string[] = []
  for (let i = 0; i < items.length; i++) {
    const color = colors[i % colors.length]
    parts.push(`<rect x="${x}" y="${y}" width="10" height="10" rx="2" fill="${color}"/>`)
    parts.push(`<text x="${x + 14}" y="${y + 9}" font-size="11" fill="${textColor}" font-family="${font}">${esc(items[i])}</text>`)
    x += 14 + items[i].length * 11 + 18
  }
  return { svg: parts.join(''), height: 20 }
}

function cartesianChartSvg(chart: ChartElement, theme: ResolvedTheme): string {
  const w = inToPx(chart.w)
  const h = inToPx(chart.h)
  const colors = chart.colors ?? theme.chartColors
  const font = fontStack(theme.fonts.body)
  const text = theme.colors.text
  const muted = theme.colors.textMuted
  const titleH = chart.title !== undefined ? 26 : 0
  const legend = legendSvg(chart, colors, 8, h - 16, text, font)
  const legendH = legend.height > 0 ? 24 : 0
  const horizontal = chart.chartType === 'bar'
  const pad = horizontal ? { left: 64, right: 12, top: titleH + 8, bottom: legendH + 6 } : { left: 46, right: 12, top: titleH + 8, bottom: legendH + 24 }
  const x0 = pad.left
  const y0 = pad.top
  const x1 = w - pad.right
  const y1 = h - pad.bottom
  const plotW = x1 - x0
  const plotH = y1 - y0
  const maxV = niceMax(Math.max(0, ...chart.series.flatMap(s => s.values)))
  const parts: string[] = []

  if (chart.title !== undefined) {
    parts.push(`<text x="${w / 2}" y="18" text-anchor="middle" font-size="14" font-weight="600" fill="${text}" font-family="${font}">${esc(chart.title)}</text>`)
  }

  // 网格与数值轴
  for (let g = 0; g <= 4; g++) {
    const value = (maxV / 4) * g
    if (horizontal) {
      const gx = x0 + (plotW / 4) * g
      parts.push(`<line x1="${gx}" y1="${y0}" x2="${gx}" y2="${y1}" stroke="${muted}" stroke-opacity="0.25" stroke-width="1"/>`)
      parts.push(`<text x="${gx}" y="${y1 + 13}" text-anchor="middle" font-size="10" fill="${muted}" font-family="${font}">${formatValue(value)}</text>`)
    } else {
      const gy = y1 - (plotH / 4) * g
      parts.push(`<line x1="${x0}" y1="${gy}" x2="${x1}" y2="${gy}" stroke="${muted}" stroke-opacity="0.25" stroke-width="1"/>`)
      parts.push(`<text x="${x0 - 6}" y="${gy + 3}" text-anchor="end" font-size="10" fill="${muted}" font-family="${font}">${formatValue(value)}</text>`)
    }
  }

  const groupCount = chart.labels.length
  if (horizontal) {
    const groupH = plotH / groupCount
    const barH = Math.min(22, (groupH * 0.65) / chart.series.length)
    chart.labels.forEach((label, gi) => {
      const cy = y0 + groupH * gi + groupH / 2
      parts.push(`<text x="${x0 - 6}" y="${cy + 4}" text-anchor="end" font-size="11" fill="${text}" font-family="${font}">${esc(label)}</text>`)
      chart.series.forEach((series, si) => {
        const v = series.values[gi] ?? 0
        const bw = (v / maxV) * plotW
        const by = cy - (barH * chart.series.length) / 2 + barH * si
        parts.push(`<rect x="${x0}" y="${by}" width="${Math.max(0, bw)}" height="${barH - 2}" rx="2" fill="${colors[si % colors.length]}"/>`)
        if (chart.showValues && v > 0) {
          parts.push(`<text x="${x0 + bw + 4}" y="${by + barH - 7}" font-size="10" fill="${text}" font-family="${font}">${formatValue(v)}</text>`)
        }
      })
    })
  } else {
    const groupW = plotW / groupCount
    const barW = Math.min(40, (groupW * 0.65) / chart.series.length)
    chart.labels.forEach((label, gi) => {
      const cx = x0 + groupW * gi + groupW / 2
      const skip = chart.labels.length > 8 && gi % 2 === 1
      if (!skip) {
        parts.push(`<text x="${cx}" y="${y1 + 15}" text-anchor="middle" font-size="11" fill="${text}" font-family="${font}">${esc(label)}</text>`)
      }
      chart.series.forEach((series, si) => {
        const v = series.values[gi] ?? 0
        const bh = (v / maxV) * plotH
        const bx = cx - (barW * chart.series.length) / 2 + barW * si
        const by = y1 - bh
        parts.push(`<rect x="${bx}" y="${by}" width="${barW - 3}" height="${Math.max(0, bh)}" rx="2" fill="${colors[si % colors.length]}"/>`)
        if (chart.showValues && v > 0) {
          parts.push(`<text x="${bx + (barW - 3) / 2}" y="${by - 4}" text-anchor="middle" font-size="10" fill="${text}" font-family="${font}">${formatValue(v)}</text>`)
        }
      })
    })
  }
  parts.push(legend.svg)
  return parts.join('')
}

function lineAreaChartSvg(chart: ChartElement, theme: ResolvedTheme): string {
  const w = inToPx(chart.w)
  const h = inToPx(chart.h)
  const colors = chart.colors ?? theme.chartColors
  const font = fontStack(theme.fonts.body)
  const text = theme.colors.text
  const muted = theme.colors.textMuted
  const titleH = chart.title !== undefined ? 26 : 0
  const legend = legendSvg(chart, colors, 8, h - 16, text, font)
  const legendH = legend.height > 0 ? 24 : 0
  const x0 = 46
  const y0 = titleH + 8
  const x1 = w - 12
  const y1 = h - legendH - 24
  const plotW = x1 - x0
  const plotH = y1 - y0
  const maxV = niceMax(Math.max(0, ...chart.series.flatMap(s => s.values)))
  const parts: string[] = []

  if (chart.title !== undefined) {
    parts.push(`<text x="${w / 2}" y="18" text-anchor="middle" font-size="14" font-weight="600" fill="${text}" font-family="${font}">${esc(chart.title)}</text>`)
  }
  for (let g = 0; g <= 4; g++) {
    const gy = y1 - (plotH / 4) * g
    parts.push(`<line x1="${x0}" y1="${gy}" x2="${x1}" y2="${gy}" stroke="${muted}" stroke-opacity="0.25" stroke-width="1"/>`)
    parts.push(`<text x="${x0 - 6}" y="${gy + 3}" text-anchor="end" font-size="10" fill="${muted}" font-family="${font}">${formatValue((maxV / 4) * g)}</text>`)
  }
  const stepX = chart.labels.length > 1 ? plotW / (chart.labels.length - 1) : 0
  chart.labels.forEach((label, gi) => {
    if (chart.labels.length > 8 && gi % 2 === 1) return
    const cx = x0 + stepX * gi
    parts.push(`<text x="${cx}" y="${y1 + 15}" text-anchor="middle" font-size="11" fill="${text}" font-family="${font}">${esc(label)}</text>`)
  })
  chart.series.forEach((series, si) => {
    const color = colors[si % colors.length]
    const points = series.values.map((v, gi) => `${(x0 + stepX * gi).toFixed(1)},${(y1 - (v / maxV) * plotH).toFixed(1)}`)
    if (chart.chartType === 'area') {
      parts.push(`<polygon points="${x0},${y1} ${points.join(' ')} ${x1},${y1}" fill="${color}" fill-opacity="0.22"/>`)
    }
    parts.push(`<polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`)
    series.values.forEach((v, gi) => {
      parts.push(`<circle cx="${(x0 + stepX * gi).toFixed(1)}" cy="${(y1 - (v / maxV) * plotH).toFixed(1)}" r="3" fill="${color}"/>`)
      if (chart.showValues) {
        parts.push(`<text x="${x0 + stepX * gi}" y="${y1 - (v / maxV) * plotH - 7}" text-anchor="middle" font-size="10" fill="${text}" font-family="${font}">${formatValue(v)}</text>`)
      }
    })
  })
  parts.push(legend.svg)
  return parts.join('')
}

function pieChartSvg(chart: ChartElement, theme: ResolvedTheme): string {
  const w = inToPx(chart.w)
  const h = inToPx(chart.h)
  const colors = chart.colors ?? theme.chartColors
  const font = fontStack(theme.fonts.body)
  const text = theme.colors.text
  const values = chart.series[0]?.values ?? []
  const labels = chart.labels
  const total = values.reduce((a, b) => a + Math.max(0, b), 0) || 1
  const legendW = chart.showLegend && w > 420 ? 130 : 0
  const titleH = chart.title !== undefined ? 26 : 0
  const cx = (w - legendW) / 2
  const cy = titleH + (h - titleH) / 2
  const r = Math.max(24, Math.min(w - legendW, h - titleH) / 2 - 10)
  const parts: string[] = []

  if (chart.title !== undefined) {
    parts.push(`<text x="${cx}" y="18" text-anchor="middle" font-size="14" font-weight="600" fill="${text}" font-family="${font}">${esc(chart.title)}</text>`)
  }

  let angle = -Math.PI / 2
  values.forEach((v, i) => {
    const frac = Math.max(0, v) / total
    const sweep = frac * Math.PI * 2
    const color = colors[i % colors.length]
    if (chart.chartType === 'doughnut') {
      const rInner = r * 0.58
      const large = sweep > Math.PI ? 1 : 0
      const x1 = cx + r * Math.cos(angle)
      const y1 = cy + r * Math.sin(angle)
      const x2 = cx + r * Math.cos(angle + sweep)
      const y2 = cy + r * Math.sin(angle + sweep)
      const x3 = cx + rInner * Math.cos(angle + sweep)
      const y3 = cy + rInner * Math.sin(angle + sweep)
      const x4 = cx + rInner * Math.cos(angle)
      const y4 = cy + rInner * Math.sin(angle)
      if (sweep > 0.001) {
        parts.push(
          `<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} ` +
          `L ${x3.toFixed(1)} ${y3.toFixed(1)} A ${rInner} ${rInner} 0 ${large} 0 ${x4.toFixed(1)} ${y4.toFixed(1)} Z" ` +
          `fill="${color}" stroke="${theme.colors.bg}" stroke-width="2"/>`,
        )
      }
    } else if (sweep > 0.001) {
      const large = sweep > Math.PI ? 1 : 0
      const x2 = cx + r * Math.cos(angle + sweep)
      const y2 = cy + r * Math.sin(angle + sweep)
      parts.push(
        `<path d="M ${cx} ${cy} L ${cx + r * Math.cos(angle)} ${cy + r * Math.sin(angle)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" ` +
        `fill="${color}" stroke="${theme.colors.bg}" stroke-width="2"/>`,
      )
    }
    if (frac >= 0.045) {
      const mid = angle + sweep / 2
      const lr = (chart.chartType === 'doughnut' ? r * 0.79 : r * 0.62)
      parts.push(
        `<text x="${(cx + lr * Math.cos(mid)).toFixed(1)}" y="${(cy + lr * Math.sin(mid) + 4).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="600" fill="#FFFFFF" font-family="${font}">${Math.round(frac * 100)}%</text>`,
      )
    }
    angle += sweep
  })

  if (chart.showLegend) {
    const lx = w - legendW + 6
    const startY = cy - (values.length * 18) / 2 + 9
    values.forEach((_v, i) => {
      const ly = startY + i * 18
      parts.push(`<rect x="${lx}" y="${ly - 8}" width="10" height="10" rx="2" fill="${colors[i % colors.length]}"/>`)
      parts.push(`<text x="${lx + 14}" y="${ly + 1}" font-size="11" fill="${text}" font-family="${font}">${esc(labels[i] ?? '')}</text>`)
    })
  }
  return parts.join('')
}

function chartSvg(chart: ChartElement, theme: ResolvedTheme): string {
  const w = inToPx(chart.w)
  const h = inToPx(chart.h)
  const inner =
    chart.chartType === 'column' || chart.chartType === 'bar'
      ? cartesianChartSvg(chart, theme)
      : chart.chartType === 'line' || chart.chartType === 'area'
        ? lineAreaChartSvg(chart, theme)
        : pieChartSvg(chart, theme)
  return `<svg class="el" data-el="${esc(chart.id)}" style="${baseStyle(chart)}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`
}

// ---------------------------------------------------------------- 元素 → HTML

function textHtml(el: TextElement, theme: ResolvedTheme): string {
  const font = el.font ?? theme.fonts.body
  const justify = el.valign === 'mid' ? 'center' : el.valign === 'bottom' ? 'flex-end' : 'flex-start'
  const paragraphs = el.paragraphs
    .map(para => {
      const align = para.align ?? el.align
      const lineSpacing = para.lineSpacing ?? 1.25
      const marginStyle = `margin:${ptToPx(para.spaceBefore ?? 0)}px 0 ${ptToPx(para.spaceAfter ?? 0)}px 0;`
      const runSpan = (run: { text: string; bold?: boolean; italic?: boolean; color?: string; fontSize?: number; superscript?: boolean; subscript?: boolean }): string => {
        const style = `${(run.bold ?? para.bold ?? el.bold) ? 'font-weight:700;' : ''}${(run.italic ?? para.italic ?? el.italic) ? 'font-style:italic;' : ''}${(run.color ?? para.color ?? el.color) !== undefined ? `color:${run.color ?? para.color ?? el.color};` : ''}font-size:${ptToPx(run.fontSize ?? para.fontSize ?? el.fontSize)}px;`
        // 公式上下标：浏览器原生 sup/sub（自动缩字号 + 提/降基线），与 PPTX 端 superscript/subscript 对应
        if (run.superscript === true) return `<sup style="${style}">${esc(run.text)}</sup>`
        if (run.subscript === true) return `<sub style="${style}">${esc(run.text)}</sub>`
        return `<span style="${style}">${esc(run.text)}</span>`
      }
      const runs =
        para.runs !== undefined
          ? para.runs.map(runSpan).join('')
          : runSpan({ text: para.text ?? '' })
      if (para.bullet === undefined || para.bullet === false) {
        return `<p style="${marginStyle}text-align:${align};line-height:${lineSpacing};">${runs}</p>`
      }
      const marker = typeof para.bullet === 'object' ? (para.bullet.marker ?? '•') : '•'
      return `<p class="ppt-bullet" style="${marginStyle}text-align:${align};line-height:${lineSpacing};"><span class="ppt-marker">${esc(marker)}</span>${runs}</p>`
    })
    .join('')
  const fillStyle = el.fill !== undefined ? `background:${el.fill};` : ''
  return `<div class="el" data-el="${esc(el.id)}" style="${baseStyle(el)}${fillStyle}color:${el.color};font-family:${fontStack(font)};font-size:${ptToPx(el.fontSize)}px;${el.bold ? 'font-weight:700;' : ''}${el.italic ? 'font-style:italic;' : ''}display:flex;flex-direction:column;justify-content:${justify};overflow:visible;">${paragraphs}</div>`
}

/** 形状轻阴影（0.15.0）→ CSS box-shadow。角度约定与 OOXML/pptxgenjs 一致：0=右、90=正下。 */
function shadowStyle(el: ShapeElement): string {
  if (el.shadow === undefined) return ''
  const sh = el.shadow
  const angle = ((sh.angle ?? 90) * Math.PI) / 180
  const offset = ptToPx(sh.offset ?? 2)
  const dx = Math.round(offset * Math.cos(angle) * 10) / 10
  const dy = Math.round(offset * Math.sin(angle) * 10) / 10
  const hex = sh.color ?? '#000000'
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `box-shadow:${dx}px ${dy}px ${ptToPx(sh.blur ?? 7)}px rgba(${r},${g},${b},${sh.opacity ?? 0.16});`
}

function shapeHtml(el: ShapeElement, theme: ResolvedTheme): string {
  let background = ''
  if (typeof el.fill === 'string') background = `background:${el.fill};`
  else if (el.fill !== undefined) background = `background:linear-gradient(${el.fill.angle}deg, ${el.fill.from}, ${el.fill.to});`
  let borderRadius = ''
  if (el.shape === 'ellipse') borderRadius = 'border-radius:50%;'
  else if (el.shape === 'roundRect') borderRadius = `border-radius:${Math.round(Math.min(inToPx(el.w), inToPx(el.h)) * ((el.radius ?? 12) / 100))}px;`
  const clip = CLIP_PATHS[el.shape] !== undefined ? `clip-path:${CLIP_PATHS[el.shape]};` : ''
  const border =
    el.border !== undefined
      ? `border:${ptToPx(el.border.width)}px ${el.border.style} ${el.border.color};`
      : el.shape === 'line'
        ? `border-top:${ptToPx(1.5)}px solid ${theme.colors.textMuted};height:0;`
        : ''
  const opacity = el.opacity !== undefined && el.opacity < 1 ? `opacity:${el.opacity};` : ''
  return `<div class="el" data-el="${esc(el.id)}" style="${baseStyle(el)}${background}${borderRadius}${clip}${border}${shadowStyle(el)}${opacity}${rotateStyle(el)}"></div>`
}

function imageHtml(el: ImageElement, assetData: Map<string, { mime: string; base64: string }>): string {
  const radius = el.radius !== undefined ? `border-radius:${Math.round(Math.min(inToPx(el.w), inToPx(el.h)) * (el.radius / 100))}px;` : ''
  if (el.placeholder !== undefined) {
    return `<div class="el ppt-placeholder" style="${baseStyle(el)}${radius}"><div class="ppt-ph-icon">🖼️</div><div class="ppt-ph-title">此处放图</div><div class="ppt-ph-prompt">${esc(el.placeholder.prompt)}</div>${el.placeholder.hint !== undefined ? `<div class="ppt-ph-hint">${esc(el.placeholder.hint)}</div>` : ''}</div>`
  }
  // 内联矢量图（0.13.0）：落盘前已 sanitizeSvg + normalizeSvgRoot（根标签无固定宽高、带 viewBox），此处直接内联
  if (el.svg !== undefined) {
    return `<div class="el" data-el="${esc(el.id)}" style="${baseStyle(el)}${radius}overflow:hidden;">${el.svg}</div>`
  }
  const asset = el.assetId !== undefined ? assetData.get(el.assetId) : undefined
  if (asset === undefined) {
    return `<div class="el ppt-placeholder" style="${baseStyle(el)}"><div class="ppt-ph-title">资产缺失：${esc(el.assetId ?? '?')}</div></div>`
  }
  return `<img class="el" data-el="${esc(el.id)}" style="${baseStyle(el)}${radius}object-fit:${el.fit};${rotateStyle(el)}" src="data:${asset.mime};base64,${asset.base64}" alt="${esc(el.name ?? el.id)}">`
}

function tableHtml(el: TableElement, theme: ResolvedTheme): string {
  const head = el.rows[0] ?? []
  const headerCells = el.headerRow
    ? `<thead><tr>${head.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>`
    : ''
  const bodyRows = (el.headerRow ? el.rows.slice(1) : el.rows)
    .map(row => `<tr>${row.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`)
    .join('')
  const colStyle =
    el.colWidths !== undefined && el.colWidths.length === head.length
      ? `<colgroup>${el.colWidths.map(rw => `<col style="width:${Math.round((rw / el.colWidths!.reduce((a, b) => a + b, 0)) * 100)}%">`).join('')}</colgroup>`
      : ''
  return `<table class="el ppt-table${el.zebra ? ' zebra' : ''}" style="${baseStyle(el)}font-family:${fontStack(theme.fonts.body)};font-size:${ptToPx(el.fontSize)}px;color:${theme.colors.text};">${colStyle}${headerCells}<tbody>${bodyRows}</tbody></table>`
}

function elementHtml(el: SceneElement, theme: ResolvedTheme, assetData: Map<string, { mime: string; base64: string }>): string {
  if (el.kind === 'text') return textHtml(el, theme)
  if (el.kind === 'shape') return shapeHtml(el, theme)
  if (el.kind === 'image') return imageHtml(el, assetData)
  if (el.kind === 'chart') return chartSvg(el, theme)
  return tableHtml(el, theme)
}

function pageBackgroundStyle(page: PageScene, theme: ResolvedTheme): string {
  if (page.background?.gradient !== undefined) {
    return `background:linear-gradient(${page.background.gradient.angle}deg, ${page.background.gradient.from}, ${page.background.gradient.to});`
  }
  // 0.19.0：结构页（带主色底的封面/章节/结尾）平涂升级为双色渐变——
  // 与 PPTX 端光栅化 PNG 垫底同一令牌来源（structuralGradient），双端一致。
  // 深色锚主题（tech-dark/navy-gold）带 structuralGradient 端点，其余回退 primary→secondary
  if (page.background?.color !== undefined) {
    const g = structuralGradient(theme)
    return `background:linear-gradient(${g.angle}deg, ${g.from}, ${g.to});`
  }
  return `background:${theme.colors.bg};`
}

/**
 * 背景纹理层（0.18.0 T2-2）：内容页（无显式页面背景=铺主题底色的页）注入低透明度
 * SVG 纹样，置于元素流首位（同级后者覆盖前者，天然垫底）。结构页有主色底+装饰，不注入。
 */
function textureLayer(theme: ResolvedTheme, page: PageScene): string {
  if (theme.texture === undefined || page.background !== undefined) return ''
  return `<div class="el" style="left:0;top:0;width:${inToPx(CANVAS_W_IN)}px;height:${inToPx(CANVAS_H_IN)}px;">${renderTextureSvg(theme.texture)}</div>`
}

function pageHtml(page: PageScene, index: number, theme: ResolvedTheme, assetData: Map<string, { mime: string; base64: string }>): string {
  const notes = page.notes !== undefined ? esc(page.notes) : ''
  // svg 路线页（0.10.0）：整页 SVG 原生内联——预览即真实渲染（viewBox 1280×720 已由校验保证）
  if (page.svg !== undefined) {
    const svg = page.svg.replace(/^<\?xml[^>]*\?>/, '').trim()
    return `<section class="slide" data-page="${esc(page.id)}" data-title="${esc(page.title ?? page.type)}" data-notes="${notes}" style="${pageBackgroundStyle(page, theme)}"><div class="svg-page">${svg}</div></section>`
  }
  const ordered = [...page.elements ?? []]
    .map((el, i) => ({ el, key: el.z ?? i }))
    .sort((a, b) => a.key - b.key)
    .map(item => item.el)
  const elements = textureLayer(theme, page) + ordered.map(el => elementHtml(el, theme, assetData)).join('\n')
  return `<section class="slide" data-page="${esc(page.id)}" data-title="${esc(page.title ?? page.type)}" data-notes="${notes}" style="${pageBackgroundStyle(page, theme)}">${elements}</section>`
}

// ---------------------------------------------------------------- 播放器模板

function progressBarHtml(progress: DeckProgress): string {
  if (progress.written >= progress.total) return ''
  const percent = progress.total > 0 ? Math.round((progress.written / progress.total) * 100) : 0
  const parts = progress.parts
    .filter(part => part.pages > 0)
    .map(part => `${esc(part.title)} ${part.written}/${part.pages}`)
    .join(' · ')
  return `<div id="genbar"><div id="genbar-track"><div id="genbar-fill" style="width:${percent}%"></div></div><span id="genbar-text">生成中 ${progress.written}/${progress.total} 页（${percent}%）${parts !== '' ? ' · ' + parts : ''}</span></div>`
}

/**
 * 页面本体渲染 CSS（0.22.0 抽出）：播放器与视觉自审单页（renderPageAuditHtml）共用——
 * 同一份规则保证 headless 截图与预览像素一致。
 */
const DECK_CSS = `* { box-sizing: border-box; margin: 0; padding: 0; }
#deck { width: ${inToPx(CANVAS_W_IN)}px; height: ${inToPx(CANVAS_H_IN)}px; position: relative; overflow: hidden; }
.slide { position: absolute; inset: 0; display: none; }
.slide.active { display: block; }
.svg-page { position: absolute; inset: 0; }
.svg-page svg { width: 100%; height: 100%; display: block; }
.el { position: absolute; }
.slide p { margin: 0; }
.ppt-bullet { position: relative; padding-left: 1.3em; }
.ppt-marker { position: absolute; left: 0; top: 0; color: inherit; }
.ppt-placeholder { border: 2px dashed #9CA3AF; background: rgba(243,244,246,.9); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: #6B7280; text-align: center; padding: 12px; }
.ppt-ph-icon { font-size: 34px; }
.ppt-ph-title { font-size: 17px; font-weight: 700; }
.ppt-ph-prompt { font-size: 13px; color: #374151; }
.ppt-ph-hint { font-size: 11px; color: #9CA3AF; }
.ppt-table { border-collapse: collapse; table-layout: fixed; }
.ppt-table th { background: var(--ppt-primary, #1E4B8F); color: #fff; font-weight: 700; padding: 6px 9px; text-align: left; }
.ppt-table td { padding: 6px 9px; border-bottom: 1px solid rgba(107,114,128,.35); overflow: hidden; word-break: break-all; }
.ppt-table.zebra tbody tr:nth-child(even) { background: rgba(148,163,184,.14); }`

/** 播放器壳专属 CSS（自审单页不注入）：暗色外壳/缩放舞台/HUD/缩略图/备注/进度条/编辑层。 */
const PLAYER_CHROME_CSS = `html, body { width: 100%; height: 100%; overflow: hidden; background: #0d1117; }
#app { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; }
#stage { flex: 1; display: flex; align-items: center; justify-content: center; width: 100%; min-height: 0; }
#deck { transform-origin: center center; box-shadow: 0 12px 48px rgba(0,0,0,.55); border-radius: 4px; }`

function playerShell(deckTitle: string, slidesHtml: string, thumbItems: string, pageCount: number, progress?: DeckProgress): string {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(deckTitle)} · PPT 预览</title>
<style>
${DECK_CSS}
${PLAYER_CHROME_CSS}
#hud { height: 52px; display: flex; align-items: center; gap: 14px; color: #cbd5e1; font: 14px/1 'Microsoft YaHei', sans-serif; user-select: none; }
#hud button { background: #1f2937; color: #e2e8f0; border: 1px solid #374151; border-radius: 6px; padding: 6px 14px; font-size: 15px; cursor: pointer; }
#hud button:hover { background: #374151; }
#hint { color: #64748b; font-size: 12px; }
#thumbs { position: fixed; left: 0; right: 0; bottom: 56px; display: none; gap: 10px; padding: 12px 16px; overflow-x: auto; background: rgba(13,17,23,.92); z-index: 30; }
#thumbs.open { display: flex; }
.thumb { flex: 0 0 auto; width: 176px; border: 2px solid #334155; border-radius: 6px; background: #0f172a; color: #cbd5e1; padding: 8px 10px; font: 12px/1.4 'Microsoft YaHei', sans-serif; cursor: pointer; }
.thumb:hover { border-color: #64748b; }
.thumb.current { border-color: #38bdf8; color: #38bdf8; }
.thumb .no { font-weight: 700; margin-right: 6px; }
#notes { position: fixed; left: 16px; right: 16px; top: 12px; display: none; max-height: 30%; overflow: auto; background: rgba(15,23,42,.94); color: #e2e8f0; border: 1px solid #334155; border-radius: 8px; padding: 10px 14px; font: 13px/1.6 'Microsoft YaHei', sans-serif; white-space: pre-wrap; z-index: 40; }
#notes.open { display: block; }
#genbar { position: fixed; left: 0; right: 0; top: 0; z-index: 50; display: flex; align-items: center; gap: 12px; padding: 6px 14px; background: rgba(13,17,23,.94); color: #cbd5e1; font: 12px/1.4 'Microsoft YaHei', sans-serif; border-bottom: 1px solid #1f2937; }
#genbar-track { flex: 0 0 160px; height: 8px; border-radius: 4px; background: #1f2937; overflow: hidden; }
#genbar-fill { height: 100%; background: linear-gradient(90deg, #38bdf8, #818cf8); transition: width .3s; }
#genbar-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* 就地编辑层（0.21.0 P1）：E 或按钮开启——选中虚线框、拖动/方向键移动、双击改文字、保存回写 */
#hud button.on { background: #2563eb; color: #fff; }
body.editing #hint::after { content: ' · 编辑中：点选元素，拖动/方向键移动，双击文本改字，保存后需回会话 ppt_scene_check'; }
.ppt-sel { outline: 2px dashed #2563eb !important; outline-offset: 2px; cursor: move !important; }
.ppt-edit-ta { position: absolute; z-index: 60; background: rgba(255,255,255,.92); border: 2px solid #2563eb; border-radius: 4px; padding: 4px 6px; font: 14px/1.5 'Microsoft YaHei', sans-serif; color: #1f2937; resize: none; }
#editsave { background: #059669; color: #fff; }
</style>
</head>
<body>
${SHAPE_CLIP_DEFS}
${progress !== undefined ? progressBarHtml(progress) : ''}
<div id="app">
  <div id="stage"><div id="deck">
${slidesHtml}
  </div></div>
  <div id="hud">
    <button id="prev" title="上一页 (←)">‹</button>
    <span id="counter">1 / ${pageCount}</span>
    <button id="next" title="下一页 (→)">›</button>
    <button id="editbtn" title="就地编辑 (E)：拖动元素/双击改字，保存后回会话校验渲染">编辑</button>
    <button id="editsave" style="display:none">保存 (0)</button>
    <span id="hint">←/→ 翻页 · F 全屏 · G 缩略图 · N 备注</span>
  </div>
</div>
<div id="thumbs">
${thumbItems}
</div>
<div id="notes"></div>
<script>
(function () {
  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'))
  var thumbs = Array.prototype.slice.call(document.querySelectorAll('.thumb'))
  var deck = document.getElementById('deck')
  var counter = document.getElementById('counter')
  var thumbsBar = document.getElementById('thumbs')
  var notes = document.getElementById('notes')
  var current = 0
  function show(n) {
    current = Math.max(0, Math.min(slides.length - 1, n))
    slides.forEach(function (s, i) { s.classList.toggle('active', i === current) })
    thumbs.forEach(function (t, i) { t.classList.toggle('current', i === current) })
    counter.textContent = (current + 1) + ' / ' + slides.length
    window.__pptCur = current
    notes.textContent = slides[current].getAttribute('data-notes') || '（本页无备注）'
  }
  function fit() {
    var stage = document.getElementById('stage')
    var scale = Math.min((stage.clientWidth - 24) / ${inToPx(CANVAS_W_IN)}, (stage.clientHeight - 16) / ${inToPx(CANVAS_H_IN)})
    deck.style.transform = 'scale(' + Math.max(0.1, scale) + ')'
  }
  document.getElementById('prev').onclick = function () { show(current - 1) }
  document.getElementById('next').onclick = function () { show(current + 1) }
  thumbs.forEach(function (t, i) { t.onclick = function () { show(i) } })
  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { show(current + 1); e.preventDefault() }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { show(current - 1); e.preventDefault() }
    else if (e.key === 'Home') show(0)
    else if (e.key === 'End') show(slides.length - 1)
    else if (e.key === 'f' || e.key === 'F') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen() }
    else if (e.key === 'g' || e.key === 'G') thumbsBar.classList.toggle('open')
    else if (e.key === 'n' || e.key === 'N') notes.classList.toggle('open')
  })
  window.addEventListener('resize', fit)
  fit()
  show(0)
  window.__pptScale = function () { var m = /scale\\(([\\d.]+)\\)/.exec(deck.style.transform); return m ? parseFloat(m[1]) : 1 }
  window.__pptShow = show
  window.__pptSlides = slides
})()
/* ---------------- 就地编辑层（0.21.0 P1） ---------------- */
;(function () {
  var deck = document.getElementById('deck')
  var editBtn = document.getElementById('editbtn')
  var saveBtn = document.getElementById('editsave')
  var editMode = false
  var pending = {}   // pageId -> { elId -> patch }
  var selected = null
  var drag = null
  var ta = null
  function slidesArr() { return window.__pptSlides || [] }
  function curSlide() { return slidesArr()[window.__pptCur !== undefined ? window.__pptCur : 0] }
  function countEdits() { var n = 0; Object.keys(pending).forEach(function (p) { n += Object.keys(pending[p]).length }); return n }
  function refreshSave() {
    var n = countEdits()
    saveBtn.style.display = editMode && n > 0 ? '' : 'none'
    saveBtn.textContent = '保存 (' + n + ')'
  }
  function record(pageId, elId, patch) {
    var page = pending[pageId] || (pending[pageId] = {})
    var edit = page[elId] || (page[elId] = {})
    Object.keys(patch).forEach(function (k) { edit[k] = patch[k] })
    refreshSave()
  }
  function setSel(el) {
    if (selected) selected.classList.remove('ppt-sel')
    selected = el
    if (el) el.classList.add('ppt-sel')
  }
  function toIn(px) { return Math.round(px / 96 * 100) / 100 }
  function activeSlideEl(el) {
    var slide = el.closest('.slide')
    return slide !== null && slide.classList.contains('active') ? slide : null
  }
  deck.addEventListener('click', function (e) {
    if (!editMode) return
    if (ta !== null) return
    var el = e.target.closest('.el')
    if (el !== null && activeSlideEl(el) !== null && el.getAttribute('data-el')) { setSel(el); e.stopPropagation() }
    else setSel(null)
  }, true)
  deck.addEventListener('pointerdown', function (e) {
    if (!editMode || selected === null || ta !== null) return
    if (e.target.closest('.el') !== selected) return
    drag = { x: e.clientX, y: e.clientY, left: selected.offsetLeft, top: selected.offsetTop, moved: false }
    try { selected.setPointerCapture(e.pointerId) } catch (err) { /* 老浏览器忽略 */ }
    e.preventDefault()
  })
  deck.addEventListener('pointermove', function (e) {
    if (drag === null) return
    var sc = window.__pptScale()
    drag.moved = true
    selected.style.left = (drag.left + (e.clientX - drag.x) / sc) + 'px'
    selected.style.top = (drag.top + (e.clientY - drag.y) / sc) + 'px'
  })
  deck.addEventListener('pointerup', function () {
    if (drag === null) return
    if (drag.moved) record(selected.closest('.slide').getAttribute('data-page'), selected.getAttribute('data-el'), { x: toIn(selected.offsetLeft), y: toIn(selected.offsetTop) })
    drag = null
  })
  deck.addEventListener('dblclick', function (e) {
    if (!editMode || ta !== null) return
    var el = e.target.closest('.el')
    if (el === null || el.getAttribute('data-el') === null || activeSlideEl(el) === null) return
    setSel(el)
    ta = document.createElement('textarea')
    ta.className = 'ppt-edit-ta'
    ta.style.left = el.offsetLeft + 'px'
    ta.style.top = el.offsetTop + 'px'
    ta.style.width = Math.max(el.offsetWidth, 120) + 'px'
    ta.style.height = Math.max(el.offsetHeight, 32) + 'px'
    ta.value = el.innerText.replace(/\\s+$/, '')
    el.closest('.slide').appendChild(ta)
    ta.focus()
    ta.select()
    function commit() {
      var texts = ta.value.split('\\n')
      el.textContent = ta.value
      record(el.closest('.slide').getAttribute('data-page'), el.getAttribute('data-el'), { texts: texts })
      ta.remove()
      ta = null
    }
    ta.addEventListener('blur', commit)
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { ta.removeEventListener('blur', commit); ta.remove(); ta = null }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit()
      e.stopPropagation()
    })
  })
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'e' || e.key === 'E') && !e.ctrlKey && !e.metaKey && ta === null && !e.target.closest('textarea,input')) { toggleEdit(); e.preventDefault(); return }
    if (!editMode || selected === null) return
    var step = e.shiftKey ? 0.1 : 0.02
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      var dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      var dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
      selected.style.left = (selected.offsetLeft + dx * 96) + 'px'
      selected.style.top = (selected.offsetTop + dy * 96) + 'px'
      record(selected.closest('.slide').getAttribute('data-page'), selected.getAttribute('data-el'), { x: toIn(selected.offsetLeft), y: toIn(selected.offsetTop) })
      e.preventDefault(); e.stopPropagation()
    } else if (e.key === 'Escape') { setSel(null) }
  }, true)
  function toggleEdit() {
    editMode = !editMode
    document.body.classList.toggle('editing', editMode)
    editBtn.classList.toggle('on', editMode)
    if (!editMode) setSel(null)
    refreshSave()
  }
  editBtn.onclick = toggleEdit
  saveBtn.onclick = function () {
    if (countEdits() === 0) return
    var m = /\\/ppt-studio\\/([^/]+)\\/preview/.exec(location.pathname)
    if (m === null) { alert('就地编辑需要经预览服务打开本页（http://…:3170/ppt-studio/<deckId>/preview/）；直接双击打开的文件没有回写通道。'); return }
    var url = '/ppt-studio/' + m[1] + '/edit'
    var jobs = Object.keys(pending).map(function (pageId) {
      var edits = Object.keys(pending[pageId]).map(function (elId) {
        var patch = { id: elId }
        Object.keys(pending[pageId][elId]).forEach(function (k) { patch[k] = pending[pageId][elId][k] })
        return patch
      })
      return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId: pageId, edits: edits }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j } }) })
        .then(function (out) {
          if (!out.ok) throw new Error(out.j && out.j.error ? out.j.error : '保存失败')
          return out.j
        })
    })
    Promise.all(jobs).then(function (results) {
      var warnings = []
      results.forEach(function (r) { (r.warnings || []).forEach(function (w) { warnings.push(w) }) })
      pending = {}
      refreshSave()
      alert('已保存 ' + results.length + ' 页修改，预览已刷新。' + (warnings.length > 0 ? '\\n校验提醒：' + warnings.slice(0, 3).join('；') : '') + '\\n注意：改动已落盘但 sceneHash 已过期——回会话调 ppt_scene_check + ppt_deck_render 出正式 PPTX。')
      location.reload()
    }).catch(function (err) { alert('保存被拒绝：' + err.message + '\\n（改动未落盘，可调整后重试）') })
  }
})()
</script>
</body>
</html>
`
}

// ---------------------------------------------------------------- 主入口

export async function renderDeckHtml(input: RenderHtmlInput): Promise<RenderHtmlResult> {
  const { store, deckId, deckTitle, theme, pages } = input

  // 预加载全部图片资产为 base64
  const manifest = await store.loadManifest(deckId)
  const assetData = new Map<string, { mime: string; base64: string }>()
  for (const entry of manifest.assets) {
    const asset = await readAssetBuffer(store, deckId, entry.assetId)
    if (asset !== undefined) assetData.set(entry.assetId, { mime: asset.entry.mime, base64: asset.buffer.toString('base64') })
  }

  const slidesHtml = pages.map((page, index) => pageHtml(page, index, theme, assetData)).join('\n')
  const thumbItems = pages
    .map(
      (page, index) =>
        `<div class="thumb"><span class="no">${index + 1}</span>${esc(page.title ?? page.type)}</div>`,
    )
    .join('\n')
  const html = playerShell(deckTitle, slidesHtml, thumbItems, pages.length, input.progress)

  const paths = store.paths(deckId)
  await mkdir(paths.previewDir, { recursive: true })
  const htmlPath = join(paths.previewDir, 'index.html')
  // 原子写（0.8.3，用户事故：生成期间浏览器可能读到写了一半的 HTML 显示乱码/残页）：
  // tmp 写完再 rename，读方要么看到旧文件要么看到完整新文件
  const tmp = `${htmlPath}.tmp-${process.pid}-${Math.random().toString(16).slice(2, 8)}`
  await writeFile(tmp, html, 'utf8')
  await rename(tmp, htmlPath)
  return { htmlPath, bytes: Buffer.byteLength(html, 'utf8') }
}

// ---------------------------------------------------------------- 视觉自审单页（0.22.0 T3-4）

export interface PageAuditHtmlInput {
  page: PageScene
  theme: ResolvedTheme
  /** 与 renderDeckHtml 同路预加载的图片资产（缺省空——无图页可直接省） */
  assetData?: Map<string, { mime: string; base64: string }>
}

/**
 * 视觉自审单页 HTML：与播放器共用 DECK_CSS 的独立页面——无播放器壳/缩放 JS/进度条，
 * deck 钉在 (0,0) 整尺寸（1280×720 CSS px），headless 浏览器按该窗口截图即 1:1 页面像素。
 */
export function renderPageAuditHtml(input: PageAuditHtmlInput): string {
  const slide = pageHtml(input.page, 0, input.theme, input.assetData ?? new Map<string, { mime: string; base64: string }>())
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<style>
${DECK_CSS}
html, body { width: ${inToPx(CANVAS_W_IN)}px; height: ${inToPx(CANVAS_H_IN)}px; overflow: hidden; }
.slide { display: block; }
</style>
</head>
<body>
${SHAPE_CLIP_DEFS}
<div id="deck">
${slide}
</div>
</body>
</html>`
}
