/**
 * 版式引擎（0.11.0）：content 内容 → 确定性元素清单。
 *
 * 动机：native 路线的 ppt_page_write 要求模型为每个元素手写 x/y/w/h（英寸、
 * 0.01 精度）并遵守 layouts.md 的 17 种页型坐标——这对弱模型（量化 8B 级）
 * 是最大失败源（越界/互压/文字溢出全是 error 级拒绝）。layouts.md 的坐标
 * 本来就是确定性知识，应该由代码执行而不是靠模型阅读后照抄。
 *
 * 用法：模型只提供语义内容（标题 + 条目 + 图表数据），composeSceneFromContent
 * 按页型模板 + 锁定令牌展开成完整元素清单；产物是普通 PageScene（elements 形态），
 * 走与手写页完全相同的 zod + validatePage 管线——引擎输出必须天然通过全部
 * 确定性校验（单测逐页型断言 errorCount === 0），这是本模块的核心不变量。
 *
 * 自适应：文字容量按 validate.ts 同一估算公式自缩字号（下限受控），
 * 图表系列长度对齐 labels，表格补齐列数——可判定的修复全部在引擎内完成。
 */
import { z } from 'zod'
import { CANVAS_W_IN } from './units.js'
import { estimateTextCapacity } from './validate.js'
import type { ChartType, DesignTokens, PageScene, PageType, SceneElement, TextElement } from './schema.js'
import { CHART_TYPES, PAGE_TYPES } from './schema.js'

// ---------------------------------------------------------------- 内容输入

/**
 * 弱模型友好的扁平内容 schema：字段全部可选（按页型取用），title 缺省回落大纲标题。
 * 刻意不做 discriminatedUnion——扁平结构对 8B 级模型的输出约束最小。
 */
export const contentInputSchema = z.object({
  type: z.enum(PAGE_TYPES).optional(),
  title: z.string().min(1).max(80).optional(),
  subtitle: z.string().max(160).optional(),
  items: z.array(z.string().min(1).max(160)).min(1).max(8).optional(),
  columns: z
    .array(z.object({
      title: z.string().max(60).optional(),
      items: z.array(z.string().min(1).max(160)).max(6).optional(),
    }))
    .length(2)
    .optional(),
  steps: z.array(z.object({ name: z.string().min(1).max(40), desc: z.string().max(160).optional() })).min(2).max(6).optional(),
  events: z.array(z.object({ label: z.string().min(1).max(24), desc: z.string().min(1).max(160) })).min(2).max(6).optional(),
  cards: z.array(z.object({ title: z.string().min(1).max(60), desc: z.string().max(200).optional() })).min(2).max(4).optional(),
  bigNumber: z.object({
    value: z.string().min(1).max(12),
    unit: z.string().max(8).optional(),
    desc: z.string().min(1).max(120),
    source: z.string().max(120).optional(),
  }).optional(),
  chart: z.object({
    chartType: z.enum(CHART_TYPES),
    title: z.string().max(60).optional(),
    labels: z.array(z.string().min(1).max(30)).min(1).max(24),
    series: z.array(z.object({ name: z.string().min(1).max(40), values: z.array(z.number()).min(1).max(24) })).min(1).max(6),
    conclusion: z.string().max(300).optional(),
  }).optional(),
  table: z.object({
    header: z.array(z.string().max(30)).min(1).max(6).optional(),
    rows: z.array(z.array(z.string().max(60))).min(1).max(7),
    note: z.string().max(120).optional(),
  }).optional(),
  quote: z.object({ text: z.string().min(1).max(300), source: z.string().max(120).optional() }).optional(),
  image: z.object({
    assetId: z.string().max(40).optional(),
    prompt: z.string().max(120).optional(),
    heading: z.string().max(60).optional(),
    items: z.array(z.string().max(120)).max(5).optional(),
  }).optional(),
  layers: z.array(z.string().min(1).max(40)).min(2).max(4).optional(),
  entries: z.array(z.string().min(1).max(60)).min(2).max(8).optional(),
  notes: z.string().max(2000).optional(),
})
export type PageContentInput = z.infer<typeof contentInputSchema>

/** 引擎无法从 content 推断时的回落信息（来自整册大纲的蓝图页）。 */
export interface ComposeFallback {
  type: PageType
  title: string
  contentBrief?: string
  /** 已登记资产 id 集合：image.assetId 不在其中时降级为占位框（ASSET_MISSING 是 error，引擎内消化） */
  knownAssetIds?: ReadonlySet<string>
}

export interface ComposeResult {
  background: PageScene['background']
  elements: SceneElement[]
  /** 版式自适应说明（缩字号/系列对齐/占位降级等），随工具返回给模型知情 */
  layoutNotes: string[]
}

/** 把概要文本切成句子条目（骨架页/缺省条目用，确定性切分）。 */
export function splitSentences(text: string, max: number): string[] {
  const parts = text
    .split(/(?<=[。；;!！？?\n])/)
    .map(s => s.trim())
    .filter(s => s !== '')
  if (parts.length === 0) return text.trim() !== '' ? [text.trim().slice(0, 120)] : []
  return parts.slice(0, max).map(s => s.slice(0, 120))
}

// ---------------------------------------------------------------- 内部工具

const r2 = (v: number): number => Math.round(v * 100) / 100

class IdGen {
  private used = new Set<string>()
  next(prefix: string): string {
    let n = 1
    let id = `${prefix}1`
    while (this.used.has(id)) id = `${prefix}${++n}`
    this.used.add(id)
    return id
  }
}

/** 每页型需要的内容字段（缺失时报错用——错误信息给模型可直接补参）。 */
const TYPE_REQUIREMENTS: Record<PageType, string> = {
  cover: 'subtitle（副标题/汇报人，可选）',
  toc: 'entries: ["章节一","章节二"]（目录条目）',
  section: 'items: [导语]（可选）或 subtitle: "01"（章序号）',
  closing: 'subtitle（联系方式/下一步，可选）',
  bullets: 'items: ["要点一","要点二"]',
  'two-col': 'columns: [{title:"左栏题",items:["…"]},{title:"右栏题",items:["…"]}]',
  'image-text': 'image: {prompt:"配图描述"（或 assetId）, heading:"小标题", items:["要点"]}——都不给也行，会按蓝图概要生成占位',
  chart: 'chart: {chartType:"column",labels:["A","B"],series:[{name:"系列",values:[1,2]}],conclusion:"结论"}',
  table: 'table: {header:["列1","列2"],rows:[["a","b"]],note:"来源（可选）"}',
  quote: 'quote: {text:"引文",source:"出处（可选）"}',
  timeline: 'events: [{label:"2019",desc:"事件"},…]',
  comparison: 'columns: [{title:"旧",items:["…"]},{title:"新",items:["…"]}]',
  'big-number': 'bigNumber: {value:"5",unit:"倍",desc:"一句话含义",source:"来源（可选）"}',
  process: 'steps: [{name:"步骤名",desc:"说明"},…]',
  cards: 'cards: [{title:"卡题",desc:"说明"},…]',
  hierarchy: 'layers: ["顶层","中层","底层"]',
  'icon-list': 'items: ["要点短句一","要点短句二"]',
}

class Composer {
  private ids = new IdGen()
  readonly elements: SceneElement[] = []
  readonly notes: string[] = []

  constructor(private readonly tokens: DesignTokens) {}

  private get L() { return this.tokens.fontSizeLadder }
  private get C() { return this.tokens.colors }
  private get F() { return this.tokens.fonts }
  private get A() { return this.tokens.anchors }

  /** 引擎正文下限：12pt（FONT_TOO_SMALL error 线是 10pt，留缓冲；注释类 11pt）。 */
  private get bodyFont(): number { return Math.max(14, Math.min(this.L.body, 18)) }
  private get noteFont(): number { return Math.max(11, this.L.note) }

  push(el: SceneElement): void { this.elements.push(el) }

  /** 文本元素 + 容量自适应缩字号（与 validate.estimateTextCapacity 同一公式）。 */
  text(props: {
    x: number; y: number; w: number; h: number
    fontSize: number
    color: string
    font?: string
    bold?: boolean
    italic?: boolean
    align?: 'left' | 'center' | 'right'
    valign?: 'top' | 'mid' | 'bottom'
    paragraphs: TextElement['paragraphs']
    idPrefix: string
    /** 自适应字号下限（默认 12） */
    floor?: number
    fit?: boolean
  }): TextElement {
    const el: TextElement = {
      kind: 'text',
      id: this.ids.next(props.idPrefix),
      x: r2(props.x), y: r2(props.y), w: r2(props.w), h: r2(props.h),
      fontSize: Math.round(props.fontSize),
      color: props.color,
      font: props.font,
      bold: props.bold,
      italic: props.italic,
      align: props.align ?? 'left',
      valign: props.valign ?? 'top',
      paragraphs: props.paragraphs,
    }
    if (props.fit !== false) this.fit(el, props.floor ?? 12)
    this.elements.push(el)
    return el
  }

  shape(props: {
    x: number; y: number; w: number; h: number
    shape: SceneElement extends infer _ ? (Extract<SceneElement, { kind: 'shape' }>['shape']) : never
    fill: SceneElement extends infer _ ? (Extract<SceneElement, { kind: 'shape' }>['fill']) : never
    background?: boolean
    opacity?: number
    border?: Extract<SceneElement, { kind: 'shape' }>['border']
    radius?: number
    idPrefix: string
  }): void {
    this.elements.push({
      kind: 'shape',
      id: this.ids.next(props.idPrefix),
      x: r2(props.x), y: r2(props.y), w: r2(props.w), h: r2(props.h),
      shape: props.shape,
      fill: props.fill,
      opacity: props.opacity,
      border: props.border,
      radius: props.radius,
      background: props.background,
    })
  }

  private fit(el: TextElement, floor: number): void {
    let guard = 0
    while (el.fontSize > floor && estimateTextCapacity(el).ratio > 1.12 && guard++ < 8) {
      el.fontSize = Math.max(floor, Math.floor(el.fontSize * 0.9))
    }
    if (estimateTextCapacity(el).ratio > 1.12) {
      this.notes.push(`元素 ${el.id} 文字较多（已自适应到 ${el.fontSize}pt 仍偏满，可能提示 TEXT_OVERFLOW_RISK）——建议精简文字或减少条目`)
    }
  }

  /** 内容页标准标题带：标题 + 主色短横条（锚点取锁定令牌）。 */
  titleBand(title: string): void {
    this.text({
      x: this.A.titleX, y: this.A.titleY, w: this.A.titleW, h: 0.7,
      fontSize: this.L.pageTitle, color: this.C.text, font: this.F.title, bold: true, valign: 'mid',
      paragraphs: [{ text: title }],
      idPrefix: 't-title', fit: false,
    })
    this.shape({
      x: this.A.titleX, y: r2(this.A.titleY + 0.8), w: this.A.titleBarW, h: this.A.titleBarH,
      shape: 'rect', fill: this.C.primary, background: true, idPrefix: 'bar-title',
    })
  }

  bullets(items: string[]): void {
    this.text({
      x: 0.9, y: 1.7, w: 11.5, h: 5.0,
      fontSize: this.bodyFont, color: this.C.text, font: this.F.body,
      paragraphs: items.map(t => ({ text: t, bullet: true, spaceAfter: 10, lineSpacing: 1.35 })),
      idPrefix: 't-body',
    })
  }

  iconList(items: string[]): void {
    const n = items.length
    const step = Math.min(0.85, 4.8 / n)
    items.forEach((item, i) => {
      const y = 1.8 + i * step
      this.shape({
        x: 0.9, y: r2(y + 0.05), w: 0.5, h: 0.5,
        shape: 'ellipse', fill: this.C.primary, opacity: 0.15, background: true, idPrefix: 'ic',
      })
      this.text({
        x: 0.9, y: r2(y + 0.1), w: 0.5, h: 0.4,
        fontSize: 14, color: this.C.accent, bold: true, align: 'center', valign: 'mid',
        paragraphs: [{ text: String(i + 1).padStart(2, '0') }],
        idPrefix: 'icn', fit: false,
      })
      this.text({
        x: 1.7, y: r2(y), w: 10.9, h: 0.6,
        fontSize: this.bodyFont, color: this.C.text,
        paragraphs: [{ text: item }],
        idPrefix: 'li',
      })
    })
  }

  twoCards(columns: Array<{ title?: string; items?: string[] }>, opts: { vs?: boolean; height?: number } = {}): void {
    const h = opts.height ?? 5.0
    const xs = [0.6, 6.87]
    columns.forEach((col, i) => {
      const x = xs[i]
      this.shape({
        x, y: 1.7, w: 5.86, h,
        shape: 'roundRect', fill: this.C.surface, background: true, radius: 8, idPrefix: `card${i}`,
      })
      this.text({
        x: x + 0.25, y: 1.95, w: 5.36, h: 0.5,
        fontSize: 18, color: opts.vs ? (i === 0 ? this.C.textMuted : this.C.primary) : this.C.text, bold: true,
        paragraphs: [{ text: col.title ?? (i === 0 ? '方面一' : '方面二') }],
        idPrefix: `cth${i}`, fit: false,
      })
      this.text({
        x: x + 0.25, y: 2.55, w: 5.36, h: r2(h - 1.15),
        fontSize: this.bodyFont, color: this.C.text,
        paragraphs: (col.items ?? []).map(t => ({ text: t, bullet: true, spaceAfter: 8, lineSpacing: 1.3 })),
        idPrefix: `cti${i}`,
      })
    })
    if (opts.vs) {
      this.shape({
        x: 6.32, y: r2(1.7 + (h - 0.7) / 2), w: 0.7, h: 0.7,
        shape: 'ellipse', fill: this.C.primary, background: true, idPrefix: 'vs',
      })
      this.text({
        x: 6.32, y: r2(1.7 + (h - 0.7) / 2 + 0.18), w: 0.7, h: 0.34,
        fontSize: 14, color: this.C.onPrimary, bold: true, align: 'center', valign: 'mid',
        paragraphs: [{ text: 'VS' }],
        idPrefix: 'vst', fit: false,
      })
    }
  }

  process(steps: Array<{ name: string; desc?: string }>): void {
    const n = steps.length
    const gap = 0.25
    const stepW = Math.min(2.7, (12.13 - (n - 1) * gap) / n)
    steps.forEach((step, i) => {
      const x = 0.6 + i * (stepW + gap)
      const fill = i === 0 || i === n - 1 ? this.C.primary : this.C.secondary
      this.shape({
        x, y: 2.6, w: stepW, h: 1.1,
        shape: 'chevron', fill, background: true, idPrefix: 'st',
      })
      this.text({
        x, y: 2.85, w: stepW, h: 0.6,
        fontSize: 16, color: this.C.onPrimary, bold: true, align: 'center', valign: 'mid',
        paragraphs: [{ text: step.name }],
        idPrefix: 'stn', fit: false,
      })
      if (step.desc !== undefined && step.desc !== '') {
        this.text({
          x, y: 3.95, w: stepW, h: 1.8,
          fontSize: 14, color: this.C.text,
          paragraphs: [{ text: step.desc, lineSpacing: 1.25 }],
          idPrefix: 'std', floor: 11,
        })
      }
    })
  }

  timeline(events: Array<{ label: string; desc: string }>): void {
    const n = events.length
    this.shape({
      x: 5.0, y: 1.7, w: 0.06, h: 5.0,
      shape: 'rect', fill: this.C.secondary, background: true, idPrefix: 'axis',
    })
    events.forEach((event, i) => {
      const y = 1.9 + (i + 0.5) * (4.8 / n)
      this.shape({
        x: 4.9, y: r2(y - 0.12), w: 0.24, h: 0.24,
        shape: 'ellipse', fill: this.C.primary, idPrefix: 'nd',
      })
      this.text({
        x: 2.5, y: r2(y - 0.2), w: 2.3, h: 0.4,
        fontSize: 16, color: this.C.primary, bold: true, align: 'right', valign: 'mid',
        paragraphs: [{ text: event.label }],
        idPrefix: 'ndl', fit: false,
      })
      this.text({
        x: 5.45, y: r2(y - 0.32), w: 7.15, h: 0.72,
        fontSize: 15, color: this.C.text,
        paragraphs: [{ text: event.desc, lineSpacing: 1.25 }],
        idPrefix: 'ndd', floor: 12,
      })
    })
  }

  cards(items: Array<{ title?: string; desc?: string }>): void {
    const n = items.length
    const width = n <= 2 ? 5.86 : n === 3 ? 3.9 : 2.9
    const xs = n === 1 ? [0.6]
      : n === 2 ? [0.6, 6.87]
        : n === 3 ? [0.6, 4.72, 8.83]
          : [0.6, 3.78, 6.96, 10.13]
    items.forEach((card, i) => {
      const x = xs[Math.min(i, xs.length - 1)]
      this.shape({
        x, y: 1.8, w: width, h: 4.4,
        shape: 'roundRect', fill: this.C.surface, background: true, radius: 8, idPrefix: 'card',
      })
      this.text({
        x: x + 0.2, y: 2.0, w: width - 0.4, h: 0.5,
        fontSize: 24, color: this.C.accent, bold: true,
        paragraphs: [{ text: String(i + 1).padStart(2, '0') }],
        idPrefix: 'cno', fit: false,
      })
      this.text({
        x: x + 0.2, y: 2.65, w: width - 0.4, h: 0.6,
        fontSize: 17, color: this.C.text, bold: true,
        paragraphs: [{ text: card.title ?? `卡片 ${i + 1}` }],
        idPrefix: 'ctt', floor: 14,
      })
      if (card.desc !== undefined && card.desc !== '') {
        this.text({
          x: x + 0.2, y: 3.35, w: width - 0.4, h: 2.65,
          fontSize: 14, color: this.C.textMuted,
          paragraphs: [{ text: card.desc, lineSpacing: 1.3 }],
          idPrefix: 'ctd', floor: 11,
        })
      }
    })
  }

  hierarchy(layers: string[]): void {
    layers.forEach((layer, i) => {
      const w = 4.0 + i * 2.2
      const x = (CANVAS_W_IN - w) / 2
      const y = 1.8 + i * 1.05
      const isPlain = i >= 2
      this.shape({
        x, y, w, h: 0.9,
        shape: 'rect',
        fill: isPlain ? this.C.surface : i === 0 ? this.C.primary : this.C.secondary,
        border: isPlain ? { color: this.C.primary, width: 1, style: 'solid' } : undefined,
        background: true, idPrefix: 'lay',
      })
      this.text({
        x, y, w, h: 0.9,
        fontSize: 16, color: isPlain ? this.C.text : this.C.onPrimary, bold: true, align: 'center', valign: 'mid',
        paragraphs: [{ text: layer }],
        idPrefix: 'layn', fit: false,
      })
    })
  }

  bigNumber(data: { value: string; unit?: string; desc: string; source?: string }): void {
    const len = data.value.length
    const bigSize = len <= 2 ? 140 : len <= 4 ? 100 : 72
    const runs: TextElement['paragraphs'][number]['runs'] = [
      { text: data.value, fontSize: bigSize },
      ...(data.unit !== undefined && data.unit !== '' ? [{ text: data.unit, fontSize: Math.max(28, Math.round(bigSize * 0.3)) }] : []),
    ]
    this.text({
      x: 0.6, y: 2.0, w: 12.1, h: 2.7,
      fontSize: bigSize, color: this.C.primary, font: this.F.title, bold: true, align: 'center', valign: 'mid',
      paragraphs: [{ runs }],
      idPrefix: 'bignum', fit: false,
    })
    this.text({
      x: 1.5, y: 5.0, w: 10.3, h: 0.6,
      fontSize: 18, color: this.C.text, align: 'center',
      paragraphs: [{ text: data.desc }],
      idPrefix: 'bigd', floor: 14,
    })
    if (data.source !== undefined && data.source !== '') {
      this.text({
        x: 1.5, y: 6.7, w: 10.3, h: 0.4,
        fontSize: this.noteFont, color: this.C.textMuted, align: 'center',
        paragraphs: [{ text: data.source }],
        idPrefix: 'bigsrc', fit: false,
      })
    }
  }

  chartElement(data: {
    chartType: ChartType
    title?: string
    labels: string[]
    series: Array<{ name: string; values: number[] }>
    conclusion?: string
  }): void {
    const labels = data.labels.slice(0, 24)
    let series = data.series.map(s => ({ name: s.name, values: s.values.slice(0, labels.length) }))
    for (const s of series) {
      while (s.values.length < labels.length) s.values.push(0)
    }
    if ((data.chartType === 'pie' || data.chartType === 'doughnut') && series.length > 1) {
      this.notes.push(`饼图/环图只支持单系列，已只保留第一系列「${series[0].name}」（其余忽略）`)
      series = series.slice(0, 1)
    }
    const hasConclusion = data.conclusion !== undefined && data.conclusion !== ''
    const w = hasConclusion ? 7.8 : 12.1
    this.elements.push({
      kind: 'chart',
      id: this.ids.next('chart'),
      x: 0.6, y: 1.7, w, h: 4.9,
      chartType: data.chartType,
      title: data.title,
      labels,
      series,
      showLegend: data.chartType === 'pie' || data.chartType === 'doughnut' ? true : series.length > 1,
      showValues: (data.chartType === 'column' || data.chartType === 'bar') && labels.length <= 8,
    })
    if (hasConclusion) {
      this.text({
        x: 8.8, y: 1.9, w: 3.9, h: 4.5,
        fontSize: this.bodyFont, color: this.C.text,
        paragraphs: [
          { text: '结论', bold: true, fontSize: 18, spaceAfter: 8 },
          { text: data.conclusion, lineSpacing: 1.3 },
        ],
        idPrefix: 'concl',
      })
    }
  }

  tableElement(data: { header?: string[]; rows: string[][]; note?: string }): void {
    const colCount = Math.max(data.header?.length ?? 0, ...data.rows.map(r => r.length), 1)
    const pad = (cells: string[]): string[] => {
      const out = cells.slice(0, colCount).map(c => c.slice(0, 60))
      while (out.length < colCount) out.push('')
      return out
    }
    const rows = [
      ...(data.header !== undefined && data.header.length > 0 ? [pad(data.header)] : []),
      ...data.rows.slice(0, 7).map(pad),
    ]
    this.elements.push({
      kind: 'table',
      id: this.ids.next('tbl'),
      x: 0.6, y: 1.7, w: 12.1, h: r2(Math.min(5.2, Math.max(1.5, 0.5 * rows.length))),
      rows,
      headerRow: data.header !== undefined && data.header.length > 0,
      fontSize: 12,
      zebra: true,
    })
    if (data.note !== undefined && data.note !== '') {
      this.text({
        x: 0.6, y: 6.9, w: 12.1, h: 0.4,
        fontSize: this.noteFont, color: this.C.textMuted,
        paragraphs: [{ text: data.note }],
        idPrefix: 'tnote', fit: false,
      })
    }
  }

  quoteBlock(data: { text: string; source?: string }): void {
    this.text({
      x: 0.7, y: 1.9, w: 1.6, h: 1.6,
      fontSize: 90, color: this.C.primary, bold: true,
      paragraphs: [{ text: '“' }],
      idPrefix: 'qmark', fit: false,
    })
    this.elements[this.elements.length - 1].background = true
    this.text({
      x: 1.5, y: 2.6, w: 10.3, h: 2.2,
      fontSize: Math.max(22, Math.min(26, this.L.pageTitle)), color: this.C.text, italic: true, align: 'center',
      paragraphs: [{ text: data.text, lineSpacing: 1.35 }],
      idPrefix: 'qtext', floor: 16,
    })
    if (data.source !== undefined && data.source !== '') {
      this.text({
        x: 1.5, y: 4.95, w: 10.3, h: 0.4,
        fontSize: 14, color: this.C.textMuted, align: 'center',
        paragraphs: [{ text: `—— ${data.source}` }],
        idPrefix: 'qsrc', fit: false,
      })
    }
  }

  imageText(data: { assetId?: string; prompt?: string; heading?: string; items?: string[] }, fallback: ComposeFallback): void {
    const useAsset = data.assetId !== undefined && (fallback.knownAssetIds?.has(data.assetId) ?? false)
    if (data.assetId !== undefined && !useAsset) {
      this.notes.push(`assetId ${data.assetId} 未登记（ASSET_MISSING 是 error），已降级为占位框——先 ppt_asset_register / ppt_image_generate 再写页可上实图`)
    }
    this.elements.push({
      kind: 'image',
      id: this.ids.next('img'),
      x: 0.6, y: 1.7, w: 5.6, h: 4.6,
      ...(useAsset
        ? { assetId: data.assetId }
        : { placeholder: { prompt: (data.prompt ?? fallback.contentBrief ?? '建议配图').slice(0, 120) } }),
      fit: 'cover',
    })
    const heading = data.heading ?? fallback.title
    this.text({
      x: 6.6, y: 1.8, w: 6.1, h: 0.6,
      fontSize: 20, color: this.C.text, bold: true,
      paragraphs: [{ text: heading }],
      idPrefix: 'ith', floor: 16,
    })
    const items = data.items ?? splitSentences(fallback.contentBrief ?? '', 4)
    if (items.length > 0) {
      this.text({
        x: 6.6, y: 2.55, w: 6.1, h: 3.7,
        fontSize: this.bodyFont, color: this.C.text,
        paragraphs: items.map(t => ({ text: t, bullet: true, spaceAfter: 8, lineSpacing: 1.3 })),
        idPrefix: 'iti',
      })
    }
  }
}

// ---------------------------------------------------------------- 页型分派

/** 结构页（cover/toc/section/closing）的整页背景。 */
function structuralBackground(tokens: DesignTokens): PageScene['background'] {
  return { gradient: { from: tokens.colors.primary, to: tokens.colors.secondary, angle: 135 } }
}

export function composeSceneFromContent(rawContent: PageContentInput, fallback: ComposeFallback, tokens: DesignTokens): ComposeResult {
  const c = new Composer(tokens)
  const title = rawContent.title ?? fallback.title
  const briefItems = (): string[] => {
    const items = rawContent.items ?? splitSentences(fallback.contentBrief ?? title, 5)
    if (items.length === 0) return [title]
    return items
  }
  const type = rawContent.type ?? fallback.type

  const need = (field: string): never => {
    throw new Error(`页型 ${type} 需要 ${field}（content 模式按页型取内容字段）。完整对应关系：${Object.entries(TYPE_REQUIREMENTS).map(([t, req]) => `${t}=${req}`).join('；')}`)
  }

  let background: PageScene['background']

  switch (type) {
    case 'cover': {
      background = structuralBackground(tokens)
      c.text({ x: 1.0, y: 2.6, w: 11.3, h: 1.2, fontSize: tokens.fontSizeLadder.coverTitle, color: tokens.colors.onPrimary, font: tokens.fonts.title, bold: true, align: 'center', valign: 'mid', paragraphs: [{ text: title }], idPrefix: 'covt', fit: false })
      if (rawContent.subtitle !== undefined && rawContent.subtitle !== '') {
        c.text({ x: 1.0, y: 4.0, w: 11.3, h: 0.5, fontSize: 17, color: tokens.colors.onPrimary, align: 'center', paragraphs: [{ text: rawContent.subtitle }], idPrefix: 'covs', floor: 14 })
      }
      c.shape({ x: 0, y: 7.1, w: CANVAS_W_IN, h: 0.4, shape: 'rect', fill: tokens.colors.accent, background: true, idPrefix: 'covbar' })
      break
    }
    case 'toc': {
      background = undefined
      const entries = rawContent.entries ?? need('entries: ["章节一","章节二"]')
      c.text({ x: 0.6, y: 0.45, w: 4, h: 0.7, fontSize: Math.max(24, tokens.fontSizeLadder.pageTitle), color: tokens.colors.text, font: tokens.fonts.title, bold: true, valign: 'mid', paragraphs: [{ text: title === '' ? '目录' : title }], idPrefix: 'toct', fit: false })
      c.shape({ x: 0.6, y: 1.8, w: 0.08, h: 4.8, shape: 'rect', fill: tokens.colors.primary, background: true, idPrefix: 'tocbar' })
      const step = Math.min(0.85, 4.8 / entries.length)
      entries.forEach((entry, i) => {
        const y = 1.8 + i * step
        c.text({ x: 1.0, y: r2(y), w: 0.75, h: 0.5, fontSize: 18, color: tokens.colors.primary, bold: true, paragraphs: [{ text: String(i + 1).padStart(2, '0') }], idPrefix: 'tocn', fit: false })
        c.text({ x: 1.95, y: r2(y), w: 10.4, h: 0.5, fontSize: 18, color: tokens.colors.text, paragraphs: [{ text: entry }], idPrefix: 'toce', floor: 14 })
      })
      break
    }
    case 'section': {
      background = structuralBackground(tokens)
      const seq = rawContent.subtitle !== undefined && /^\d{1,2}$/.test(rawContent.subtitle.trim()) ? rawContent.subtitle.trim() : undefined
      if (seq !== undefined) {
        c.text({ x: 0.9, y: 2.2, w: 3.0, h: 1.0, fontSize: 60, color: tokens.colors.accent, bold: true, paragraphs: [{ text: seq.padStart(2, '0') }], idPrefix: 'seq', fit: false })
      }
      c.text({ x: 0.9, y: 3.3, w: 11.5, h: 0.9, fontSize: tokens.fontSizeLadder.sectionTitle, color: tokens.colors.onPrimary, font: tokens.fonts.title, bold: true, valign: 'mid', paragraphs: [{ text: title }], idPrefix: 'sect', floor: 20 })
      const lead = rawContent.items?.[0] ?? rawContent.subtitle
      if (lead !== undefined && !/^\d{1,2}$/.test(lead.trim())) {
        c.text({ x: 0.9, y: 4.4, w: 11.5, h: 0.6, fontSize: 16, color: tokens.colors.onPrimary, paragraphs: [{ text: lead }], idPrefix: 'secl', floor: 13 })
      }
      break
    }
    case 'closing': {
      background = structuralBackground(tokens)
      c.text({ x: 1.0, y: 3.0, w: 11.3, h: 1.0, fontSize: Math.max(30, tokens.fontSizeLadder.sectionTitle), color: tokens.colors.onPrimary, font: tokens.fonts.title, bold: true, align: 'center', valign: 'mid', paragraphs: [{ text: title === '' ? '谢谢聆听' : title }], idPrefix: 'clot', fit: false })
      if (rawContent.subtitle !== undefined && rawContent.subtitle !== '') {
        c.text({ x: 1.0, y: 4.3, w: 11.3, h: 0.5, fontSize: 16, color: tokens.colors.onPrimary, align: 'center', paragraphs: [{ text: rawContent.subtitle }], idPrefix: 'clos', floor: 13 })
      }
      c.shape({ x: 0, y: 7.1, w: CANVAS_W_IN, h: 0.4, shape: 'rect', fill: tokens.colors.accent, background: true, idPrefix: 'clobar' })
      break
    }
    case 'bullets': {
      c.titleBand(title)
      c.bullets(briefItems())
      break
    }
    case 'icon-list': {
      c.titleBand(title)
      c.iconList(rawContent.items ?? need('items: ["要点短句一","要点短句二"]'))
      break
    }
    case 'two-col': {
      c.titleBand(title)
      c.twoCards(rawContent.columns ?? need(TYPE_REQUIREMENTS['two-col']))
      break
    }
    case 'comparison': {
      c.titleBand(title)
      c.twoCards(rawContent.columns ?? need(TYPE_REQUIREMENTS['comparison']), { vs: true, height: 4.6 })
      break
    }
    case 'process': {
      c.titleBand(title)
      c.process(rawContent.steps ?? need('steps: [{name:"步骤名",desc:"说明"},…]'))
      break
    }
    case 'timeline': {
      c.titleBand(title)
      c.timeline(rawContent.events ?? need('events: [{label:"2019",desc:"事件"},…]'))
      break
    }
    case 'cards': {
      c.titleBand(title)
      c.cards(rawContent.cards ?? need('cards: [{title:"卡题",desc:"说明"},…]'))
      break
    }
    case 'hierarchy': {
      c.titleBand(title)
      c.hierarchy(rawContent.layers ?? need('layers: ["顶层","中层","底层"]'))
      break
    }
    case 'big-number': {
      c.titleBand(title)
      c.bigNumber(rawContent.bigNumber ?? need(TYPE_REQUIREMENTS['big-number']))
      break
    }
    case 'chart': {
      c.titleBand(title)
      c.chartElement(rawContent.chart ?? need(TYPE_REQUIREMENTS['chart']))
      break
    }
    case 'table': {
      c.titleBand(title)
      c.tableElement(rawContent.table ?? need(TYPE_REQUIREMENTS['table']))
      break
    }
    case 'quote': {
      c.quoteBlock(rawContent.quote ?? need(TYPE_REQUIREMENTS['quote']))
      break
    }
    case 'image-text': {
      c.titleBand(title)
      c.imageText(rawContent.image ?? {}, fallback)
      break
    }
  }

  return { background, elements: c.elements, layoutNotes: c.notes }
}

export { TYPE_REQUIREMENTS }
