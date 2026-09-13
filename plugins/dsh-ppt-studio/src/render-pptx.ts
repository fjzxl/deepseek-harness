/**
 * 场景 → 可编辑 PPTX（pptxgenjs）。
 *
 * 消费与 HTML 预览完全相同的 PageScene 与 ResolvedTheme，
 * 坐标单位英寸直通 pptxgenjs，字号磅直通。
 * 已知取舍：渐变填充在 PPTX 端回退为 from 纯色（记录到渲染备注），
 * 圆角百分比取默认值（roundRect adj 12%~50% 线性映射）。
 */
import { readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import * as pptxNamespace from 'pptxgenjs'
import type PptxGenJS from 'pptxgenjs'
import type { ChartElement, ImageElement, PageScene, SceneElement, ShapeElement, TableElement, TextElement } from './schema.js'
import type { ResolvedTheme } from './themes.js'
import type { DeckStore } from './deck-store.js'
import { toPptxColor } from './units.js'
import { readAssetBuffer } from './assets.js'
import { CANVAS_H_IN, CANVAS_W_IN } from './units.js'
import { describePptxModule, pickPptxConstructor, type PickedPptx } from './diag.js'

/** pptxgenjs 实例与 slide 的类型（类型层 default 导入运行时擦除，不受互操作影响）。 */
type PptxInstance = InstanceType<typeof PptxGenJS>
type PptxCtor = new () => PptxInstance
type PptxSlide = ReturnType<PptxInstance['addSlide']>

/**
 * 从模块命名空间解析出可实例化的 PptxGenJS 构造器（扫描逻辑见 diag.ts，
 * 带互操作形态标注）。缓存解析结果；CJS require 兜底；全落空报可诊断错误。
 */
let pptxPicked: PickedPptx | undefined

function resolvePptxConstructor(): PptxCtor {
  if (pptxPicked !== undefined) return pptxPicked.ctor
  const found = pickPptxConstructor(pptxNamespace)
  if (found !== undefined) return (pptxPicked = found).ctor
  try {
    const require = createRequire(import.meta.url)
    const required = pickPptxConstructor(require('pptxgenjs'))
    if (required !== undefined) return (pptxPicked = required).ctor
  } catch { /* 无 CJS 权限时忽略，走下方统一报错 */ }
  throw new Error(
    'pptxgenjs 模块形态无法解析出构造器（宿主加载管线互操作异常）。' +
      `模块诊断：${JSON.stringify(describePptxModule())}。` +
      '排查：确认宿主以 ESM 加载本插件，且 node_modules/pptxgenjs/dist/ 下存在 pptxgen.es.js / pptxgen.cjs.js。',
  )
}

export interface RenderPptxInput {
  store: DeckStore
  deckId: string
  deckTitle: string
  theme: ResolvedTheme
  pages: PageScene[]
}

export interface RenderPptxResult {
  pptxPath: string
  pageCount: number
  elementCount: number
  bytes: number
  /** 需要告知用户的渲染取舍 */
  notes: string[]
}

/** 场景形状名 → pptxgenjs ShapeType 值（与 OOXML 预设名一致，调用点做枚举断言）。 */
const SHAPE_NAME: Record<string, string> = {
  rect: 'rect',
  roundRect: 'roundRect',
  ellipse: 'ellipse',
  triangle: 'triangle',
  diamond: 'diamond',
  chevron: 'chevron',
  rightArrow: 'rightArrow',
  pentagon: 'pentagon',
  line: 'line',
}

function asShape(name: string): PptxGenJS.ShapeType {
  return (SHAPE_NAME[name] ?? SHAPE_NAME.rect) as PptxGenJS.ShapeType
}

function gradientColor(fill: string | { from: string; to: string; angle: number }): { hex: string; gradient: boolean } {
  if (typeof fill === 'string') return { hex: toPptxColor(fill), gradient: false }
  return { hex: toPptxColor(fill.from), gradient: true }
}

function baseOpts(el: SceneElement): { x: number; y: number; w: number; h: number; objectName: string } {
  return { x: el.x, y: el.y, w: el.w, h: el.h, objectName: el.id }
}

function orderedElements(page: PageScene): SceneElement[] {
  return [...page.elements ?? []]
    .map((el, index) => ({ el, key: el.z ?? index }))
    .sort((a, b) => a.key - b.key)
    .map(item => item.el)
}

function addTextElement(slide: PptxSlide, el: TextElement, theme: ResolvedTheme): void {
  const runs: Array<{ text: string; options: Record<string, unknown> }> = []
  el.paragraphs.forEach(para => {
    const paraText = para.runs !== undefined ? para.runs.map(r => r.text).join('') : (para.text ?? '')
    const bullet = para.bullet === true ? { code: '2022' } : para.bullet !== undefined && para.bullet !== false ? { code: '25AA' } : undefined
    const pieces = para.runs ?? [{ text: paraText }]
    pieces.forEach((piece, pieceIndex) => {
      const run = piece as { text: string; bold?: boolean; italic?: boolean; color?: string; fontSize?: number; superscript?: boolean; subscript?: boolean }
      runs.push({
        text: run.text,
        options: {
          fontFace: el.font ?? theme.fonts.body,
          // 样式优先级：run > 段落 > 元素
          fontSize: run.fontSize ?? para.fontSize ?? el.fontSize,
          color: toPptxColor(run.color ?? para.color ?? el.color),
          bold: run.bold ?? para.bold ?? el.bold ?? false,
          italic: run.italic ?? para.italic ?? el.italic ?? false,
          // 公式上下标（PowerPoint 原生基线偏移；勿用 Unicode ᵀ——中文字体普遍缺字形）
          ...(run.superscript === true ? { superscript: true } : {}),
          ...(run.subscript === true ? { subscript: true } : {}),
          align: para.align ?? el.align,
          lineSpacingMultiple: para.lineSpacing ?? 1.25,
          spaceBefore: para.spaceBefore ?? (runs.length === 0 ? 0 : undefined),
          spaceAfter: para.spaceAfter,
          ...(bullet !== undefined ? { bullet } : {}),
          breakLine: pieceIndex === pieces.length - 1,
        },
      })
    })
  })
  slide.addText(runs as never, {
    ...baseOpts(el),
    valign: el.valign,
    margin: 2,
    isTextBox: true,
    ...(el.fill !== undefined ? { fill: { color: toPptxColor(el.fill) } } : {}),
  } as never)
}

function addShapeElement(slide: PptxSlide, el: ShapeElement): string | null {
  const notes: string[] = []
  let fillOption: Record<string, unknown> | undefined
  if (el.fill !== undefined) {
    const { hex, gradient } = gradientColor(el.fill)
    fillOption = el.opacity !== undefined
      ? { color: hex, transparency: Math.round((1 - el.opacity) * 100) }
      : { color: hex }
    if (gradient) notes.push(`形状 ${el.id} 的渐变填充在 PPTX 端回退为纯色 ${hex}`)
  } else {
    fillOption = { type: 'none' }
  }
  const lineOption =
    el.border !== undefined
      ? { color: toPptxColor(el.border.color), width: el.border.width, dashType: el.border.style === 'dashed' ? 'dash' : 'solid' }
      : { type: 'none' }
  const options: Record<string, unknown> = { ...baseOpts(el), fill: fillOption, line: lineOption }
  if (el.shape === 'line') {
    slide.addShape(asShape('line'), options as never)
    return null
  }
  if (el.shape === 'roundRect' && el.radius !== undefined) {
    // 圆角百分比 → pptxgenjs rectRadius（0-0.5 线性映射 0-50%）
    options.rectRadius = Math.min(0.5, Math.max(0, el.radius / 100))
  }
  slide.addShape(asShape(el.shape), options as never)
  return notes[0] ?? null
}

async function addImageElement(slide: PptxSlide, el: ImageElement, input: RenderPptxInput): Promise<void> {
  if (el.placeholder !== undefined) {
    // 占位框：虚线圆角矩形 + 居中提示文字
    slide.addShape(asShape('roundRect'), {
      ...baseOpts(el),
      fill: { color: 'F3F4F6' },
      line: { color: '9CA3AF', width: 1, dashType: 'dash' },
      rectRadius: 0.06,
    } as never)
    slide.addText(
      [
        { text: '[ 此处放图 ]', options: { fontSize: 16, bold: true, color: '6B7280', breakLine: true, align: 'center' } },
        { text: el.placeholder.prompt, options: { fontSize: 12, color: '9CA3AF', align: 'center', breakLine: true } },
        ...(el.placeholder.hint !== undefined
          ? [{ text: el.placeholder.hint, options: { fontSize: 10, color: '9CA3AF', align: 'center' } }]
          : []),
      ] as never,
      { ...baseOpts(el), valign: 'mid', margin: 4 } as never,
    )
    return
  }
  const asset = el.assetId !== undefined ? await readAssetBuffer(input.store, input.deckId, el.assetId) : undefined
  if (asset === undefined) {
    throw new Error(`图片元素 ${el.id} 引用的资产 ${el.assetId} 不存在（登记清单里找不到）`)
  }
  const data = `data:${asset.entry.mime};base64,${asset.buffer.toString('base64')}`
  slide.addImage({
    data,
    ...baseOpts(el),
    ...(el.fit === 'fill' ? {} : { sizing: { type: el.fit, w: el.w, h: el.h } }),
  } as never)
}

function addChartElement(slide: PptxSlide, el: ChartElement, pptx: PptxInstance, theme: ResolvedTheme): void {
  const data = el.series.map(s => ({ name: s.name, labels: el.labels, values: s.values }))
  const chartColors = (el.colors ?? theme.chartColors).map(toPptxColor)
  const base: Record<string, unknown> = {
    ...baseOpts(el),
    showLegend: el.showLegend,
    legendPos: 'b',
    legendFontSize: 11,
    legendColor: toPptxColor(theme.colors.text),
    chartColors,
    showTitle: el.title !== undefined,
    title: el.title ?? '',
    titleFontSize: 14,
    titleColor: toPptxColor(theme.colors.text),
    fontFace: theme.fonts.body,
    catAxisLabelColor: toPptxColor(theme.colors.textMuted),
    catAxisLabelFontSize: 11,
    valAxisLabelColor: toPptxColor(theme.colors.textMuted),
    valAxisLabelFontSize: 10,
    dataLabelColor: toPptxColor(theme.colors.text),
    dataLabelFontSize: 10,
    border: { pt: 0, color: toPptxColor(theme.colors.surface) },
  }
  if (el.chartType === 'column') {
    slide.addChart(pptx.ChartType.bar, data as never, { ...base, barDir: 'col', barGapWidthPct: 60, showValue: el.showValues } as never)
  } else if (el.chartType === 'bar') {
    slide.addChart(pptx.ChartType.bar, data as never, { ...base, barDir: 'bar', barGapWidthPct: 60, showValue: el.showValues } as never)
  } else if (el.chartType === 'line') {
    slide.addChart(pptx.ChartType.line, data as never, { ...base, showValue: el.showValues, lineSmooth: false } as never)
  } else if (el.chartType === 'area') {
    slide.addChart(pptx.ChartType.area, data as never, { ...base, chartColorsOpacity: 60 } as never)
  } else if (el.chartType === 'pie') {
    slide.addChart(pptx.ChartType.pie, data as never, { ...base, showPercent: true, showValue: false, dataLabelColor: 'FFFFFF' } as never)
  } else {
    slide.addChart(pptx.ChartType.doughnut, data as never, { ...base, holeSize: 55, showPercent: true, showValue: false, dataLabelColor: 'FFFFFF' } as never)
  }
}

function addTableElement(slide: PptxSlide, el: TableElement, theme: ResolvedTheme): void {
  const rows = el.rows.map((cells, rowIndex) =>
    cells.map(cell => {
      const isHeader = el.headerRow && rowIndex === 0
      const zebraOn = el.zebra && !isHeader && rowIndex % 2 === 0
      return {
        text: cell,
        options: {
          fontFace: theme.fonts.body,
          fontSize: el.fontSize,
          bold: isHeader,
          color: isHeader ? toPptxColor(theme.colors.onPrimary) : toPptxColor(theme.colors.text),
          fill: { color: isHeader ? toPptxColor(theme.colors.primary) : zebraOn ? toPptxColor(theme.colors.surface) : toPptxColor(theme.colors.bg) },
          align: 'left',
          valign: 'mid',
          margin: 4,
        },
      }
    }),
  )
  const colW =
    el.colWidths !== undefined && el.colWidths.length === (el.rows[0]?.length ?? 0)
      ? el.colWidths.map(ratio => (el.w * ratio) / el.colWidths!.reduce((a, b) => a + b, 0))
      : undefined
  slide.addTable(rows as never, {
    ...baseOpts(el),
    colW,
    border: { type: 'solid', color: toPptxColor(theme.colors.textMuted), pt: 0.5 },
    autoPage: false,
  } as never)
}

/** PPTX 包结构自检：合法 ZIP、slide 数与顺序正确、尺寸正确。 */
export function inspectPptx(bytes: Uint8Array, expectedPages: number): { pageCount: number; entries: string[] } {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch (error) {
    throw new Error(`PPTX 不是可读的 ZIP 包：${error instanceof Error ? error.message : String(error)}`)
  }
  for (const required of ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml']) {
    if (files[required] === undefined) throw new Error(`PPTX 缺少必需条目：${required}`)
  }
  const slideNames = Object.keys(files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]))
  if (slideNames.length !== expectedPages) {
    throw new Error(`PPTX slide 数 ${slideNames.length} 与场景页数 ${expectedPages} 不一致`)
  }
  const presentation = strFromU8(files['ppt/presentation.xml']!)
  const size = /<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/.exec(presentation)
  if (size === null) throw new Error('PPTX presentation.xml 缺少页面尺寸')
  if (Math.abs(Number(size[1]) - CANVAS_W_IN * 914400) > 20000 || Math.abs(Number(size[2]) - CANVAS_H_IN * 914400) > 20000) {
    throw new Error(`PPTX 页面尺寸异常：${size[1]}×${size[2]} EMU`)
  }
  return { pageCount: slideNames.length, entries: Object.keys(files) }
}

export async function renderDeckPptx(input: RenderPptxInput): Promise<RenderPptxResult> {
  const { store, deckId, deckTitle, theme, pages } = input
  const pptx = new (resolvePptxConstructor())()
  pptx.defineLayout({ name: 'PPT_STUDIO_WIDE', width: CANVAS_W_IN, height: CANVAS_H_IN })
  pptx.layout = 'PPT_STUDIO_WIDE'
  pptx.author = 'dsh-ppt-studio'
  pptx.company = 'dsh-ppt-studio'
  pptx.subject = 'Structured scene → editable PPTX'
  pptx.title = deckTitle

  const notes: string[] = []
  let elementCount = 0
  for (const page of pages) {
    const slide = pptx.addSlide()
    if (page.background?.color !== undefined) {
      slide.background = { color: toPptxColor(page.background.color) }
    } else if (page.background?.gradient !== undefined) {
      slide.background = { color: toPptxColor(page.background.gradient.from) }
      notes.push(`第 ${page.id} 页渐变背景在 PPTX 端回退为纯色`)
    } else {
      slide.background = { color: toPptxColor(theme.colors.bg) }
    }
    // svg 路线页（0.10.0）：整页矢量图嵌入——与 HTML 预览逐像素一致；
    // PowerPoint 2016+ 原生显示 SVG，旧版本可能显示占位
    if (page.svg !== undefined) {
      slide.addImage({
        data: `image/svg+xml;base64,${Buffer.from(page.svg, 'utf8').toString('base64')}`,
        x: 0, y: 0, w: CANVAS_W_IN, h: CANVAS_H_IN,
      })
      notes.push(`第 ${page.id} 页为 SVG 自由绘制：PPTX 端以整页矢量图嵌入（PowerPoint 2016+ 显示；可右键"转换为形状"恢复部分可编辑性）`)
      elementCount += 1
      if (page.notes !== undefined && page.notes !== '') slide.addNotes(page.notes)
      continue
    }
    for (const el of orderedElements(page)) {
      if (el.kind === 'text') addTextElement(slide, el, theme)
      else if (el.kind === 'shape') {
        const note = addShapeElement(slide, el)
        if (note !== null) notes.push(note)
      } else if (el.kind === 'image') await addImageElement(slide, el, input)
      else if (el.kind === 'chart') addChartElement(slide, el, pptx, theme)
      else if (el.kind === 'table') addTableElement(slide, el, theme)
      elementCount += 1
    }
    if (page.notes !== undefined && page.notes !== '') slide.addNotes(page.notes)
  }

  const paths = store.paths(deckId)
  const temporary = join(paths.root, `.deck.${process.pid}.${Date.now()}.pptx`)
  try {
    await pptx.writeFile({ fileName: temporary })
    const bytes = new Uint8Array(await readFile(temporary))
    inspectPptx(bytes, pages.length)
    const { rename } = await import('node:fs/promises')
    await rename(temporary, paths.pptx)
    return { pptxPath: paths.pptx, pageCount: pages.length, elementCount, bytes: bytes.byteLength, notes }
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}
