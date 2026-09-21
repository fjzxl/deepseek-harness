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
import type { DeckStore } from './deck-store.js'
import { CANVAS_H_IN, CANVAS_W_IN, inToPx, ptToPx } from './units.js'
import { readAssetBuffer } from './assets.js'

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
  return `<svg class="el" style="${baseStyle(chart)}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`
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
  return `<div class="el" style="${baseStyle(el)}${fillStyle}color:${el.color};font-family:${fontStack(font)};font-size:${ptToPx(el.fontSize)}px;${el.bold ? 'font-weight:700;' : ''}${el.italic ? 'font-style:italic;' : ''}display:flex;flex-direction:column;justify-content:${justify};overflow:visible;">${paragraphs}</div>`
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
  return `<div class="el" style="${baseStyle(el)}${background}${borderRadius}${clip}${border}${opacity}"></div>`
}

function imageHtml(el: ImageElement, assetData: Map<string, { mime: string; base64: string }>): string {
  const radius = el.radius !== undefined ? `border-radius:${Math.round(Math.min(inToPx(el.w), inToPx(el.h)) * (el.radius / 100))}px;` : ''
  if (el.placeholder !== undefined) {
    return `<div class="el ppt-placeholder" style="${baseStyle(el)}${radius}"><div class="ppt-ph-icon">🖼️</div><div class="ppt-ph-title">此处放图</div><div class="ppt-ph-prompt">${esc(el.placeholder.prompt)}</div>${el.placeholder.hint !== undefined ? `<div class="ppt-ph-hint">${esc(el.placeholder.hint)}</div>` : ''}</div>`
  }
  // 内联矢量图（0.13.0）：落盘前已 sanitizeSvg + normalizeSvgRoot（根标签无固定宽高、带 viewBox），此处直接内联
  if (el.svg !== undefined) {
    return `<div class="el" style="${baseStyle(el)}${radius}overflow:hidden;">${el.svg}</div>`
  }
  const asset = el.assetId !== undefined ? assetData.get(el.assetId) : undefined
  if (asset === undefined) {
    return `<div class="el ppt-placeholder" style="${baseStyle(el)}"><div class="ppt-ph-title">资产缺失：${esc(el.assetId ?? '?')}</div></div>`
  }
  return `<img class="el" style="${baseStyle(el)}${radius}object-fit:${el.fit};" src="data:${asset.mime};base64,${asset.base64}" alt="${esc(el.name ?? el.id)}">`
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
  if (page.background?.color !== undefined) return `background:${page.background.color};`
  return `background:${theme.colors.bg};`
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
  const elements = ordered.map(el => elementHtml(el, theme, assetData)).join('\n')
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

function playerShell(deckTitle: string, slidesHtml: string, thumbItems: string, pageCount: number, progress?: DeckProgress): string {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(deckTitle)} · PPT 预览</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; background: #0d1117; }
#app { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; }
#stage { flex: 1; display: flex; align-items: center; justify-content: center; width: 100%; min-height: 0; }
#deck { width: ${inToPx(CANVAS_W_IN)}px; height: ${inToPx(CANVAS_H_IN)}px; position: relative; transform-origin: center center; box-shadow: 0 12px 48px rgba(0,0,0,.55); border-radius: 4px; overflow: hidden; }
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
.ppt-table.zebra tbody tr:nth-child(even) { background: rgba(148,163,184,.14); }
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
</style>
</head>
<body>
${progress !== undefined ? progressBarHtml(progress) : ''}
<div id="app">
  <div id="stage"><div id="deck">
${slidesHtml}
  </div></div>
  <div id="hud">
    <button id="prev" title="上一页 (←)">‹</button>
    <span id="counter">1 / ${pageCount}</span>
    <button id="next" title="下一页 (→)">›</button>
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
