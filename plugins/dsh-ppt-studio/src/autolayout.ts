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
import { normalizeSvgRoot, sanitizeSvg } from './normalize.js'
import { relativeLuminance, structuralGradient, structuralTextColor } from './themes.js'
import { renderIllustration } from './illustration.js'
import { isIconName, pickIconForText, renderIconSvg } from './icons.js'
import type { ChartType, DesignTokens, PageScene, PageType, SceneElement, TextElement } from './schema.js'
import { CHART_TYPES, PAGE_TYPES } from './schema.js'

// ---------------------------------------------------------------- 内容输入

/**
 * 版式意图声明（0.17.0，content 2.0）：模型做构图选择题，代码执行坐标。
 * 受限词表（非自由文本）——未知 variant 回落默认并记 layoutNote；split 越界由 zod 拦。
 * 适用页型：image-text(variant/split) | two-col/comparison(split/divider/card) |
 * process(variant) | cards(variant/card) | timeline(variant)。
 */
export const layoutInputSchema = z.object({
  /** 页型变体：image-text=image-left|image-right|image-top；process=flow|steps；cards=grid|row；timeline=vertical|horizontal */
  variant: z.string().min(1).max(30).optional(),
  /** 图区/左栏宽度占比（30-70，百分比）。image-text 默认 45，two-col/comparison 默认 50 */
  split: z.number().min(30).max(70).optional(),
  /** 两栏分隔：none | vs（comparison 默认）| line（细线） */
  divider: z.enum(['none', 'vs', 'line']).optional(),
  /** 卡片底色：tint（色阶浅底）| solid（表面色，默认）| plain（无底色纯排版） */
  card: z.enum(['tint', 'solid', 'plain']).optional(),
})
export type LayoutInput = z.infer<typeof layoutInputSchema>

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
  events: z.array(z.object({ label: z.string().min(1).max(24), desc: z.string().min(1).max(160), icon: z.string().max(30).optional() })).min(2).max(6).optional(),
  cards: z.array(z.object({ title: z.string().min(1).max(60), desc: z.string().max(200).optional(), icon: z.string().max(30).optional() })).min(2).max(4).optional(),
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
    /** 模型生成的矢量插图（0.13.0）：无生图接口时的配图路径，引擎清洗 + 按 viewBox 比例适配区域 */
    svg: z.string().min(20).max(300_000).optional(),
    /**
     * 图示 JSON（0.17.0，优先于 svg；0.20.0 扩 venn/matrix/tree；0.22.x 扩 pyramid/funnel/cycle）：
     * 只描述"什么图、哪些节点"，代码用锁定令牌渲染——消灭手写 SVG 标签笔误
     * （真实事故：`</svg viewBox=…>` 解析失败），颜色天然守锁、风格统一。
     * kind 语义：flow 顺序流程（2-6 节点）| layers 层级堆叠（2-6）| venn 集合交集（2-3）|
     * matrix 2×2 四象限（恰好 4，左上→右下）| tree 根+单层子树（2-6，nodes[0] 为根）|
     * pyramid 金字塔（3-5，nodes[0]=顶层）| funnel 漏斗（3-6，上宽下窄）| cycle 循环（2-6，标签 ≤8 字）。
     */
    illustration: z.object({
      kind: z.enum(['flow', 'layers', 'venn', 'matrix', 'tree', 'pyramid', 'funnel', 'cycle']),
      title: z.string().max(60).optional(),
      nodes: z.array(z.object({
        label: z.string().min(1).max(24),
        sub: z.string().max(40).optional(),
      })).min(2).max(6),
    }).optional(),
    heading: z.string().max(60).optional(),
    items: z.array(z.string().max(120)).max(5).optional(),
  }).optional(),
  layers: z.array(z.string().min(1).max(40)).min(2).max(4).optional(),
  entries: z.array(z.string().min(1).max(60)).min(2).max(8).optional(),
  /** icon-list 显式图标名（0.18.0；与 items 平行，缺省按条目文本关键词自动选） */
  icons: z.array(z.string().min(1).max(30)).max(8).optional(),
  /** 版式意图（0.17.0）：受限词表，代码执行坐标——见 layoutInputSchema */
  layout: layoutInputSchema.optional(),
  notes: z.string().max(2000).optional(),
})
export type PageContentInput = z.infer<typeof contentInputSchema>

/** 引擎无法从 content 推断时的回落信息（来自整册大纲的蓝图页）。 */
/** 两个 hex 的 RGB 欧氏距离（0-441；DECORATION_CONTRAST 的色距判据同口径）。 */
function hexDistance(a: string, b: string): number {
  const ch = (h: string, i: number): number => parseInt(h.slice(i, i + 2), 16)
  return Math.sqrt((ch(a, 1) - ch(b, 1)) ** 2 + (ch(a, 3) - ch(b, 3)) ** 2 + (ch(a, 5) - ch(b, 5)) ** 2)
}

/** 徽章圆片色（浅色底自适应）：优先 tint200（字形对比最佳），低饱和暖色主题可能
 *  低于装饰可见线（warm-sunset 实测 73<75）——逐档加深至色距 ≥75，全落空回退基色。 */
function badgeCircleFill(tokens: DesignTokens): string {
  const tints = tokens.tints
  if (tints === undefined) return tokens.colors.primary
  if (relativeLuminance(tokens.colors.bg) <= 0.4) return tints.primary['600']
  for (const step of ['200', '300', '400'] as const) {
    if (hexDistance(tints.primary[step], tokens.colors.bg) >= 75) return tints.primary[step]
  }
  return tokens.colors.primary
}

/** 徽章字形色：与圆片色配对保证可见（浅=tint700 深字压浅圆，深=bg 深字压亮圆，无色阶=onPrimary）。 */
function badgeGlyphColor(tokens: DesignTokens, circleFill: string): string {
  if (tokens.tints === undefined) return tokens.colors.onPrimary
  return circleFill === tokens.colors.primary
    ? tokens.colors.onPrimary
    : relativeLuminance(tokens.colors.bg) > 0.4 ? tokens.tints.primary['700'] : tokens.colors.bg
}

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
  'image-text': 'image: {svg:"<svg viewBox=…>矢量插图</svg>"（推荐，无生图接口时）或 prompt:"配图描述"/assetId, heading:"小标题", items:["要点"]}——都不给也行，会按蓝图概要生成占位',
  chart: 'chart: {chartType:"column",labels:["A","B"],series:[{name:"系列",values:[1,2]}],conclusion:"结论"}',
  table: 'table: {header:["列1","列2"],rows:[["a","b"]],note:"来源（可选）"}',
  quote: 'quote: {text:"引文",source:"出处（可选）"}',
  timeline: 'events: [{label:"2019",desc:"事件",icon?:"rocket"}]（icon 可选：图标词表见 SKILL.md；缺省按文本自动选）',
  comparison: 'columns: [{title:"旧",items:["…"]},{title:"新",items:["…"]}]',
  'big-number': 'bigNumber: {value:"5",unit:"倍",desc:"一句话含义",source:"来源（可选）"}',
  process: 'steps: [{name:"步骤名",desc:"说明"},…]',
  cards: 'cards: [{title:"卡题",desc:"说明",icon?:"target"}]（icon 可选：图标词表见 SKILL.md）',
  hierarchy: 'layers: ["顶层","中层","底层"]',
  'icon-list': 'items: ["要点短句一","要点短句二"]，可选 icons: ["rocket","shield"]（与 items 平行；缺省按条目文本自动选图标）',
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

  /**
   * 色阶取色（0.15.0）：卡片底/描边/浅强调用 tint，避免只能用基色或灰。
   * 旧 deck 的 tokens.json 无 tints 时回落基色（不产生新 warning，只是少了层次）。
   */
  private tint(role: 'primary' | 'secondary' | 'accent', step: '50' | '100' | '200' | '300' | '400' | '600' | '700' | '800' | '900'): string {
    return this.tokens.tints?.[role][step] ?? this.C[role]
  }

  /**
   * 明暗感知的「可见色阶」（放在页面底色上的小装饰用）：浅色页取浅档（300，
   * 混入 52% 基色，12 套主题对底色色距均 ≥75）、深色页取深档（600，向白锚靠拢）。
   * 单一档位无法同时服务深浅主题（浅档在深底上更不可见），按底色亮度分流。
   */
  private tintVisible(role: 'primary' | 'secondary' | 'accent'): string {
    return relativeLuminance(this.C.bg) > 0.4 ? this.tint(role, '300') : this.tint(role, '600')
  }

  /** 卡片统一细描边（0.15.0 层次三件套：surface 卡在近底色页面上靠描边+阴影立住）。 */
  private cardBorder(): { color: string; width: number; style: 'solid' } {
    return { color: this.tint('primary', '200'), width: 1, style: 'solid' }
  }

  /** 卡片统一轻阴影（双渲染器一致：PPTX outer shadow / HTML box-shadow）。 */
  private cardShadow(): { opacity: number; blur: number; angle: number; offset: number } {
    return { opacity: 0.16, blur: 7, angle: 90, offset: 2 }
  }

  /** 图标名解析：显式给且在词表 → 用之；否则按文本关键词确定性自动选（未知名记 note）。 */
  private resolveIcon(explicit: string | undefined, text: string): string {
    if (explicit !== undefined && explicit !== '') {
      if (isIconName(explicit)) return explicit
      this.notes.push(`图标名 "${explicit}" 不在图标词表（完整词表见 SKILL.md），已按条目文本自动选择图标`)
    }
    return pickIconForText(text)
  }

  /**
   * 图标徽章（0.18.0 T2-1）：色阶圆片 + 内联 SVG 线稿图标。
   * 配色自适应（视觉评估两轮结论）：浅色底圆片取"能过装饰可见线的最浅色阶"
   * （tint200 起逐档加深，warm-sunset 这类低饱和主色会落到 300）+ tint700 深字形；
   * 深色底 tint600 亮圆 + bg 深字形；旧 deck 无色阶回退 primary 圆 + onPrimary。
   * 图标走 image.svg 既有链路（HTML 内联 + PPTX 光栅化 PNG）。
   */
  iconBadge(cx: number, cy: number, size: number, icon: string): void {
    const circleFill = badgeCircleFill(this.tokens)
    const glyphColor = badgeGlyphColor(this.tokens, circleFill)
    this.shape({
      x: r2(cx - size / 2), y: r2(cy - size / 2), w: r2(size), h: r2(size),
      shape: 'ellipse', fill: circleFill, background: true, idPrefix: 'icbg',
    })
    const inner = r2(size * 0.62)
    this.push({
      kind: 'image',
      id: this.ids.next('icgl'),
      x: r2(cx - inner / 2), y: r2(cy - inner / 2), w: inner, h: inner,
      svg: renderIconSvg(icon, glyphColor),
      fit: 'contain',
    })
  }

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
    shadow?: Extract<SceneElement, { kind: 'shape' }>['shadow']
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
      shadow: props.shadow,
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

  /** 内容页标准标题带：标题 + 点缀色短横条（锚点取锁定令牌）。
   * 0.19.0 短横条由 primary 改 accent：accent 原本只在图表/章序号露出，工业灰橙类主题
   * （primary=石墨灰）整个内容页无主题点缀色，被判"像未套色的默认灰主题"；
   * 12 主题 accent 对各自 bg 均过装饰可见性双指标（DECORATION_CONTRAST 零误报单测覆盖）。 */
  titleBand(title: string): void {
    this.text({
      x: this.A.titleX, y: this.A.titleY, w: this.A.titleW, h: 0.7,
      fontSize: this.L.pageTitle, color: this.C.text, font: this.F.title, bold: true, valign: 'mid',
      paragraphs: [{ text: title }],
      idPrefix: 't-title', fit: false,
    })
    this.shape({
      x: this.A.titleX, y: r2(this.A.titleY + 0.8), w: this.A.titleBarW, h: this.A.titleBarH,
      shape: 'rect', fill: this.C.accent, background: true, idPrefix: 'bar-title',
    })
  }

  bullets(items: string[]): void {
    const boxX = 0.9, boxY = 1.7, boxW = 11.5, boxH = 5.0
    // 左侧主色装饰竖条：纯文字页也有一点图形骨架（真实反馈：全册图形偏少）
    this.shape({
      x: 0.6, y: 1.8, w: 0.08, h: 4.8,
      shape: 'rect', fill: this.C.primary, opacity: 0.5, background: true, idPrefix: 'bar-body',
    })
    // 稀疏自适应（0.12.0）：3 条短要点占 5 格高文本框的顶部三成、下半页全空（真实 deck p008/p013）。
    // 确定性地三步走：字号上调（占不满时）→ 段距拉开 → 垂直居中；文字多时行为与旧版一致。
    const draft = items.map(t => ({ text: t, bullet: true as const, spaceAfter: 10, lineSpacing: 1.35 }))
    const measure = (fontSize: number, spaceAfter: number): number =>
      estimateTextCapacity({
        kind: 'text', id: 'probe', x: boxX, y: boxY, w: boxW, h: boxH,
        fontSize, color: this.C.text, align: 'left', valign: 'top',
        paragraphs: draft.map(p => ({ ...p, spaceAfter })),
      } as TextElement).ratio
    let fontSize = this.bodyFont
    while (fontSize < 24 && measure(fontSize + 2, 10) <= 0.8) fontSize += 2
    let spaceAfter = 10
    let y = boxY
    let h = boxH
    const baseRatio = measure(fontSize, 10)
    if (baseRatio < 0.85) {
      const gaps = Math.max(items.length - 1, 1)
      spaceAfter = r2(Math.min(36, 10 + (boxH * 72 * (1 - baseRatio)) / gaps))
      const spreadRatio = measure(fontSize, spaceAfter)
      y = r2(boxY + (boxH * Math.max(0, 1 - Math.min(spreadRatio, 1))) / 2)
      h = r2(6.7 - y) // 框底钉在内容区下缘：居中下移后收缩高度，不越安全区
      this.notes.push(`要点较少：字号 ${this.bodyFont}→${String(fontSize)}pt、段距 ${String(spaceAfter)}pt 并垂直居中（稀疏页不再上半页堆顶、下半页留白）`)
    }
    this.text({
      x: boxX, y, w: boxW, h,
      fontSize, color: this.C.text, font: this.F.body,
      paragraphs: draft.map(p => ({ ...p, spaceAfter })),
      idPrefix: 't-body',
    })
  }

  iconList(items: string[], icons?: string[], layout: LayoutInput = {}): void {
    const n = items.length
    const cardKind = layout.card ?? 'solid'
    // 0.20.0（T3-5）：整宽行卡取代"徽章 + 左置单列文本"——旧版右半幅 ~55% 空置、
    // 视觉重心偏左（0.19.0 视觉门对 12 主题样张的共同判决）。行卡铺满内容宽，
    // 条目少时整块垂直居中（沿用 0.12.0 稀疏自适应思想）。plain 变体保持纯排版。
    const top = 1.7
    const bottom = 6.7
    const gap = n > 6 ? 0.12 : 0.18
    const rowH = r2(Math.min(1.0, (bottom - top - (n - 1) * gap) / n))
    const total = r2(n * rowH + (n - 1) * gap)
    const y0 = r2(top + Math.max(0, (bottom - top - total) / 2))
    if (total < 4.6) this.notes.push(`条目较少：${String(n)} 行卡垂直居中（不再堆顶）`)
    const badge = Math.min(0.5, r2(rowH - 0.14))
    const style = cardKind === 'plain' ? undefined : this.cardStyle(cardKind)
    items.forEach((item, i) => {
      const y = r2(y0 + i * (rowH + gap))
      if (style !== undefined) {
        this.shape({
          x: 0.6, y, w: 12.13, h: rowH,
          shape: 'roundRect', fill: style.fill, background: true, radius: 8, idPrefix: 'rowcard',
          border: style.border, shadow: style.shadow,
        })
      }
      // 0.18.0 T2-1：内置 SVG 图标取代纯序号数字（icon-list 页型名不副实的根治）
      this.iconBadge(r2(0.6 + 0.24 + badge / 2), r2(y + rowH / 2), badge, this.resolveIcon(icons?.[i], item))
      this.text({
        x: r2(0.6 + 0.24 + badge + 0.22), y, w: r2(12.13 - 0.24 - badge - 0.22 - 0.25), h: rowH,
        fontSize: this.bodyFont, color: this.C.text, valign: 'mid',
        paragraphs: [{ text: item }],
        idPrefix: 'li',
      })
    })
  }

  /** 卡片底色风格（0.17.0 layout.card）：solid=表面色+描边+阴影（默认）；tint=色阶浅底；plain=无底纯排版。 */
  private cardStyle(kind: 'solid' | 'tint' | 'plain' = 'solid'): { fill: string; border: { color: string; width: number; style: 'solid' } | undefined; shadow: { opacity: number; blur: number; angle: number; offset: number } | undefined } {
    if (kind === 'plain') return { fill: '', border: undefined, shadow: undefined }
    if (kind === 'tint') return { fill: this.tint('primary', '50'), border: { color: this.tint('primary', '200'), width: 1, style: 'solid' }, shadow: this.cardShadow() }
    return { fill: this.C.surface, border: this.cardBorder(), shadow: this.cardShadow() }
  }

  twoCards(columns: Array<{ title?: string; items?: string[] }>, opts: { vs?: boolean; height?: number; layout?: LayoutInput } = {}): void {
    const layout = opts.layout ?? {}
    if (layout.variant !== undefined && layout.variant !== '' && !['equal', 'split'].includes(layout.variant)) {
      this.notes.push(`layout.variant="${layout.variant}" 不在 two-col/comparison 词表（equal|split），已回落默认等宽`)
    }
    const h = opts.height ?? 5.0
    // split（0.17.0）：左栏占比 30-70，默认 50；总宽 = 12.13 - 间隙 0.75
    const leftPct = (layout.split ?? 50) / 100
    const totalW = 12.13 - 0.75
    const wL = r2(totalW * leftPct)
    const wR = r2(totalW - wL)
    const xL = 0.6
    const xR = r2(xL + wL + 0.75)
    const cardKind = layout.card ?? 'solid'
    columns.forEach((col, i) => {
      const x = i === 0 ? xL : xR
      const w = i === 0 ? wL : wR
      if (cardKind !== 'plain') {
        const style = this.cardStyle(cardKind)
        this.shape({
          x, y: 1.7, w, h,
          shape: 'roundRect', fill: style.fill, background: true, radius: 8, idPrefix: `card${i}`,
          border: style.border, shadow: style.shadow,
        })
      }
      this.text({
        x: x + 0.25, y: 1.95, w: w - 0.5, h: 0.5,
        fontSize: 18, color: opts.vs ? (i === 0 ? this.C.textMuted : this.C.primary) : this.C.text, bold: true,
        paragraphs: [{ text: col.title ?? (i === 0 ? '方面一' : '方面二') }],
        idPrefix: `cth${i}`, fit: false,
      })
      this.text({
        x: x + 0.25, y: 2.55, w: w - 0.5, h: r2(h - 1.15),
        fontSize: this.bodyFont, color: this.C.text,
        paragraphs: (col.items ?? []).map(t => ({ text: t, bullet: true, spaceAfter: 8, lineSpacing: 1.3 })),
        idPrefix: `cti${i}`,
      })
    })
    // divider（0.17.0）：vs 徽章（comparison 默认）| line 细线 | none
    const divider = layout.divider ?? (opts.vs ? 'vs' : 'none')
    if (divider === 'vs') {
      const dx = r2(xL + wL + 0.75 / 2 - 0.35)
      this.shape({
        x: dx, y: r2(1.7 + (h - 0.7) / 2), w: 0.7, h: 0.7,
        shape: 'ellipse', fill: this.C.primary, background: true, idPrefix: 'vs',
      })
      this.text({
        x: dx, y: r2(1.7 + (h - 0.7) / 2 + 0.18), w: 0.7, h: 0.34,
        fontSize: 14, color: this.C.onPrimary, bold: true, align: 'center', valign: 'mid',
        paragraphs: [{ text: 'VS' }],
        idPrefix: 'vst', fit: false,
      })
    } else if (divider === 'line') {
      this.shape({
        x: r2(xL + wL + 0.375 - 0.01), y: 2.0, w: 0.02, h: r2(h - 0.6),
        shape: 'rect', fill: this.tint('primary', '200'), background: true, idPrefix: 'divline',
      })
    }
  }

  process(steps: Array<{ name: string; desc?: string }>, layout: LayoutInput = {}): void {
    const n = steps.length
    // steps 变体（0.17.0）：竖排编号行——步骤多/名称长时比横向 chevron 容量大
    if (layout.variant === 'steps') {
      const step = Math.min(1.15, 4.8 / n)
      steps.forEach((stepItem, i) => {
        const y = r2(1.75 + i * step)
        this.shape({
          x: 0.9, y: r2(y + 0.03), w: 0.5, h: 0.5,
          shape: 'ellipse', fill: this.tintVisible('primary'), background: true, idPrefix: 'stc',
        })
        this.text({
          x: 0.9, y: r2(y + 0.08), w: 0.5, h: 0.4,
          fontSize: 14, color: this.C.primary, bold: true, align: 'center', valign: 'mid',
          paragraphs: [{ text: String(i + 1) }],
          idPrefix: 'stcn', fit: false,
        })
        this.text({
          x: 1.65, y, w: 3.4, h: 0.56,
          fontSize: 16, color: this.C.text, bold: true, valign: 'mid',
          paragraphs: [{ text: stepItem.name }],
          idPrefix: 'stn', floor: 13,
        })
        if (stepItem.desc !== undefined && stepItem.desc !== '') {
          this.text({
            x: 5.25, y, w: 7.35, h: r2(Math.max(0.56, step - 0.1)),
            fontSize: 14, color: this.C.textMuted,
            paragraphs: [{ text: stepItem.desc, lineSpacing: 1.25 }],
            idPrefix: 'std', floor: 11,
          })
        }
      })
      return
    }
    if (layout.variant !== undefined && layout.variant !== '' && layout.variant !== 'flow') {
      this.notes.push(`layout.variant="${layout.variant}" 不在 process 词表（flow|steps），已回落默认横向流程`)
    }
    const gap = 0.25
    // 0.12.0：满宽排布（旧实现钳了 2.7 上限，3 步只铺 8.6/12.13，右侧空三成——真实 deck d20260921-182914 p018）
    const stepW = r2((12.13 - (n - 1) * gap) / n)
    // 0.17.3：chevron 燕尾凹口/箭头尖各占约高的一半——文字框必须内缩，否则首尾字
    // 落在形状外的底色上"看不见"（真实 deck d20260923-001312 p019 四卡首字全被凹口切入）；
    // 卡同步加高一档给两行标题留空间，说明文字下移避开
    const cardH = 1.3
    const inset = r2(Math.min(0.6, cardH / 2))
    steps.forEach((step, i) => {
      const x = r2(0.6 + i * (stepW + gap))
      const fill = i === 0 || i === n - 1 ? this.C.primary : this.C.secondary
      this.shape({
        x, y: 2.6, w: stepW, h: cardH,
        shape: 'chevron', fill, background: true, idPrefix: 'st',
      })
      this.text({
        x: r2(x + inset), y: 2.75, w: r2(stepW - inset * 2), h: 1.0,
        fontSize: 16, color: this.C.onPrimary, bold: true, align: 'center', valign: 'mid',
        paragraphs: [{ text: step.name }],
        idPrefix: 'stn', floor: 12,
      })
      if (step.desc !== undefined && step.desc !== '') {
        this.text({
          x, y: 4.15, w: stepW, h: 1.8,
          fontSize: 14, color: this.C.text,
          paragraphs: [{ text: step.desc, lineSpacing: 1.25 }],
          idPrefix: 'std', floor: 11,
        })
      }
    })
  }

  timeline(events: Array<{ label: string; desc: string; icon?: string }>, layout: LayoutInput = {}): void {
    const n = events.length
    // horizontal 变体（0.17.0）：横轴时间线——事件按时间从左到右，标签在上/说明在下
    if (layout.variant === 'horizontal') {
      const slotW = 11.5 / n
      const axisY = 3.15
      this.shape({
        x: 0.9, y: axisY, w: 11.5, h: 0.05,
        shape: 'rect', fill: this.C.secondary, background: true, idPrefix: 'axis',
      })
      events.forEach((event, i) => {
        const cx = r2(0.9 + slotW * i + slotW / 2)
        // 0.18.0 T2-1：轴点升级为图标徽章（事件题旨可辨，不再只是抽象圆点）
        this.iconBadge(cx, r2(axisY + 0.025), 0.46, this.resolveIcon(event.icon, `${event.label} ${event.desc}`))
        this.text({
          x: r2(cx - slotW / 2 + 0.1), y: 2.15, w: r2(slotW - 0.2), h: 0.6,
          fontSize: 16, color: this.C.primary, bold: true, align: 'center', valign: 'bottom',
          paragraphs: [{ text: event.label }],
          idPrefix: 'ndl', floor: 12,
        })
        this.text({
          x: r2(cx - slotW / 2 + 0.1), y: r2(axisY + 0.4), w: r2(slotW - 0.2), h: 2.6,
          fontSize: 14, color: this.C.text, align: 'center',
          paragraphs: [{ text: event.desc, lineSpacing: 1.25 }],
          idPrefix: 'ndd', floor: 11,
        })
      })
      return
    }
    if (layout.variant !== undefined && layout.variant !== '' && layout.variant !== 'vertical') {
      this.notes.push(`layout.variant="${layout.variant}" 不在 timeline 词表（vertical|horizontal），已回落默认竖轴`)
    }
    this.shape({
      x: 5.0, y: 1.7, w: 0.06, h: 5.0,
      shape: 'rect', fill: this.C.secondary, background: true, idPrefix: 'axis',
    })
    events.forEach((event, i) => {
      const y = 1.9 + (i + 0.5) * (4.8 / n)
      this.iconBadge(5.03, r2(y), 0.46, this.resolveIcon(event.icon, `${event.label} ${event.desc}`))
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

  cards(items: Array<{ title?: string; desc?: string; icon?: string }>, layout: LayoutInput = {}): void {
    const n = items.length
    const cardKind = layout.card ?? 'solid'
    // row 变体（0.17.0）：整宽横条卡片堆叠——desc 长时比多列网格每卡更宽
    if (layout.variant === 'row') {
      const step = Math.min(1.55, 4.7 / n)
      items.forEach((card, i) => {
        const y = r2(1.75 + i * step)
        if (cardKind !== 'plain') {
          const style = this.cardStyle(cardKind)
          this.shape({
            x: 0.6, y, w: 12.13, h: r2(step - 0.15),
            shape: 'roundRect', fill: style.fill, background: true, radius: 8, idPrefix: 'card',
            border: style.border, shadow: style.shadow,
          })
        }
        // 0.18.0：行卡图标徽章（标题左侧）
        this.iconBadge(1.06, r2(y + (step - 0.15) / 2), 0.38, this.resolveIcon(card.icon, `${card.title ?? ''} ${card.desc ?? ''}`))
        this.text({
          x: 1.42, y: r2(y + 0.08), w: 2.7, h: r2(step - 0.31),
          fontSize: 17, color: this.C.text, bold: true, valign: 'mid',
          paragraphs: [{ text: card.title ?? `卡片 ${i + 1}` }],
          idPrefix: 'ctt', floor: 14,
        })
        if (card.desc !== undefined && card.desc !== '') {
          this.text({
            x: 4.15, y: r2(y + 0.08), w: 8.3, h: r2(step - 0.31),
            fontSize: 14, color: this.C.textMuted, valign: 'mid',
            paragraphs: [{ text: card.desc, lineSpacing: 1.25 }],
            idPrefix: 'ctd', floor: 11,
          })
        }
      })
      return
    }
    if (layout.variant !== undefined && layout.variant !== '' && layout.variant !== 'grid') {
      this.notes.push(`layout.variant="${layout.variant}" 不在 cards 词表（grid|row），已回落默认网格`)
    }
    const width = n <= 2 ? 5.86 : n === 3 ? 3.9 : 2.9
    const xs = n === 1 ? [0.6]
      : n === 2 ? [0.6, 6.87]
        : n === 3 ? [0.6, 4.72, 8.83]
          : [0.6, 3.78, 6.96, 10.13]
    items.forEach((card, i) => {
      const x = xs[Math.min(i, xs.length - 1)]
      if (cardKind !== 'plain') {
        const style = this.cardStyle(cardKind)
        this.shape({
          x, y: 1.8, w: width, h: 4.4,
          shape: 'roundRect', fill: style.fill, background: true, radius: 8, idPrefix: 'card',
          border: style.border, shadow: style.shadow,
        })
      }
      // 0.18.0 T2-1：图标徽章取代纯序号数字（题旨一眼可辨）
      this.iconBadge(r2(x + 0.42), 2.26, 0.44, this.resolveIcon(card.icon, `${card.title ?? ''} ${card.desc ?? ''}`))
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
        border: isPlain ? { color: this.tint('primary', '300'), width: 1, style: 'solid' } : undefined,
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

  /**
  /**
   * 结构页装饰（0.15.0）：右上浅色阶大圆 + 底部点缀条——渐变主底上的确定性分层。
   * 条色用结构页文字色（0.19.0：深色锚封面派生白色，其余主题=onPrimary，
   * 全主题天然过 DECORATION_CONTRAST；accent 在部分主题与主色撞色）。
   * 旧 deck 无色阶时跳过大圆（回落基色会与主底同色不可见），只保留底条。
   */
  structuralDecor(): void {
    // 深底主题 tint200 向 bg 混色会把金色相混成灰褐（navy-gold 视觉评估实测 #54534D 脏圆），
    // 深底改取向白锚的 tint600（亮金/亮青），浅底维持 tint200
    const dark = relativeLuminance(this.tokens.colors.bg) <= 0.4
    const circle = this.tokens.tints?.primary[dark ? '600' : '200']
    if (circle !== undefined) {
      this.shape({
        x: 10.43, y: -0.3, w: 3.2, h: 3.2,
        shape: 'ellipse', fill: circle, background: true, idPrefix: 'deco',
      })
    }
    this.shape({
      x: 0, y: 7.1, w: CANVAS_W_IN, h: 0.4,
      shape: 'rect', fill: structuralTextColor(this.tokens), background: true, idPrefix: 'decobar',
    })
  }

  imageText(data: { assetId?: string; prompt?: string; svg?: string; illustration?: { kind: 'flow' | 'layers' | 'venn' | 'matrix' | 'tree' | 'pyramid' | 'funnel' | 'cycle'; title?: string; nodes: Array<{ label: string; sub?: string }> }; heading?: string; items?: string[] }, fallback: ComposeFallback, layout: LayoutInput = {}): void {
    // 图区几何（0.17.0 layout）：variant=image-left（默认）|image-right|image-top；split=图区宽占比（默认 45）
    const variant = layout.variant ?? 'image-left'
    if (!['image-left', 'image-right', 'image-top'].includes(variant)) {
      this.notes.push(`layout.variant="${variant}" 不在 image-text 词表（image-left|image-right|image-top），已回落 image-left`)
    }
    const splitPct = layout.split ?? 45
    let region: { x: number; y: number; w: number; h: number }
    let textX: number; let textW: number
    if (variant === 'image-top') {
      region = { x: 0.6, y: 1.6, w: 12.13, h: 2.9 }
      textX = 0.6
      textW = 12.13
    } else {
      const imgW = r2(12.13 * (splitPct / 100))
      const txtW = r2(12.13 - imgW - 0.4)
      if (variant === 'image-right') {
        region = { x: r2(0.6 + txtW + 0.4), y: 1.7, w: imgW, h: 4.6 }
        textX = 0.6
        textW = txtW
      } else {
        region = { x: 0.6, y: 1.7, w: imgW, h: 4.6 }
        textX = r2(0.6 + imgW + 0.4)
        textW = txtW
      }
    }
    // 图示 JSON（0.17.0）优先：代码用锁定令牌渲染 SVG，消灭手写标签笔误
    const svgSource = data.illustration !== undefined
      ? renderIllustration(data.illustration, this.tokens)
      : data.svg
    // svg 内联矢量图（0.13.0）：无生图接口时的配图路径——清洗 + 根标签归一 + 按 viewBox 比例适配区域（不拉伸）
    if (svgSource !== undefined && svgSource !== '') {
      const normalized = normalizeSvgRoot(sanitizeSvg(svgSource))
      if (normalized !== null) {
        const ratio = normalized.width / normalized.height
        let { x, y, w, h } = region
        if (ratio > region.w / region.h) {
          h = r2(region.w / ratio)
          y = r2(region.y + (region.h - h) / 2)
        } else {
          w = r2(region.h * ratio)
          x = r2(region.x + (region.w - w) / 2)
        }
        this.push({
          kind: 'image',
          id: this.ids.next('img'),
          x, y, w, h,
          svg: normalized.svg,
          fit: 'contain',
        })
        this.notes.push(data.illustration !== undefined
          ? `图区使用 illustration 图示 JSON（${data.illustration.kind}，代码按锁定令牌渲染矢量图并按比例适配区域）`
          : '图区使用模型生成的 SVG 矢量插图（已清洗并按 viewBox 比例适配，PPTX 以矢量嵌入、PowerPoint 2016+ 显示）')
      } else {
        this.notes.push('image.svg 不是合法的 <svg> 源码（未找到根标签），已降级为占位框——请提供完整 <svg viewBox="…">…</svg>，或改传 image.illustration 图示 JSON')
        this.push({ kind: 'image', id: this.ids.next('img'), ...region, placeholder: { prompt: (data.prompt ?? fallback.contentBrief ?? '建议配图').slice(0, 120) }, fit: 'cover' })
      }
    } else {
      const useAsset = data.assetId !== undefined && (fallback.knownAssetIds?.has(data.assetId) ?? false)
      if (data.assetId !== undefined && !useAsset) {
        this.notes.push(`assetId ${data.assetId} 未登记（ASSET_MISSING 是 error），已降级为占位框——先 ppt_asset_register / ppt_image_generate，或直接给 image.illustration 图示 JSON / image.svg 内联矢量图`)
      }
      this.push({
        kind: 'image',
        id: this.ids.next('img'),
        x: region.x, y: region.y, w: region.w, h: region.h,
        ...(useAsset
          ? { assetId: data.assetId }
          : { placeholder: { prompt: (data.prompt ?? fallback.contentBrief ?? '建议配图').slice(0, 120) } }),
        fit: 'cover',
      })
    }
    const heading = data.heading ?? fallback.title
    if (variant === 'image-top') {
      this.text({
        x: textX, y: 4.65, w: textW, h: 0.55,
        fontSize: 20, color: this.C.text, bold: true,
        paragraphs: [{ text: heading }],
        idPrefix: 'ith', floor: 16,
      })
      const itemsTop = data.items ?? splitSentences(fallback.contentBrief ?? '', 4)
      if (itemsTop.length > 0) {
        this.text({
          x: textX, y: 5.3, w: textW, h: 1.6,
          fontSize: this.bodyFont, color: this.C.text,
          paragraphs: itemsTop.map(t => ({ text: t, bullet: true, spaceAfter: 6, lineSpacing: 1.25 })),
          idPrefix: 'iti',
        })
      }
      return
    }
    this.text({
      x: textX, y: 1.8, w: textW, h: 0.6,
      fontSize: 20, color: this.C.text, bold: true,
      paragraphs: [{ text: heading }],
      idPrefix: 'ith', floor: 16,
    })
    const items = data.items ?? splitSentences(fallback.contentBrief ?? '', 4)
    if (items.length > 0) {
      this.text({
        x: textX, y: 2.55, w: textW, h: 3.7,
        fontSize: this.bodyFont, color: this.C.text,
        paragraphs: items.map(t => ({ text: t, bullet: true, spaceAfter: 8, lineSpacing: 1.3 })),
        idPrefix: 'iti',
      })
    }
  }
}

// ---------------------------------------------------------------- 页型分派

/**
 * 结构页（cover/toc/section/closing）的整页背景。
 * 0.15.0 改纯色主底（当时 PPTX 端渐变回退纯色，双端不一致）；0.19.0 渲染器把该底色
 * 升级为双色渐变（HTML=CSS、PPTX=光栅化 PNG），scene.background.color 保留渐变起点
 * 作为回退底 + 装饰对比校验的基准色。深色锚主题端点来自 tokens.structuralGradient。
 */
function structuralBackground(tokens: DesignTokens): PageScene['background'] {
  return { color: structuralGradient(tokens).from }
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
      c.structuralDecor()
      const sc = structuralTextColor(tokens)
      // 0.15.0 构图修正：标题组垂直重心居中（旧版偏下、下方留白失衡），标题与副标题间加居中点缀条
      c.text({ x: 1.0, y: 2.35, w: 11.3, h: 1.2, fontSize: tokens.fontSizeLadder.coverTitle, color: sc, font: tokens.fonts.title, bold: true, align: 'center', valign: 'mid', paragraphs: [{ text: title }], idPrefix: 'covt', fit: false })
      c.shape({ x: 6.22, y: 3.72, w: 0.9, h: 0.05, shape: 'rect', fill: sc, background: true, idPrefix: 'covrule' })
      if (rawContent.subtitle !== undefined && rawContent.subtitle !== '') {
        c.text({ x: 1.0, y: 4.05, w: 11.3, h: 0.5, fontSize: 17, color: sc, align: 'center', paragraphs: [{ text: rawContent.subtitle }], idPrefix: 'covs', floor: 14 })
      }
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
      c.structuralDecor()
      const sc = structuralTextColor(tokens)
      const seq = rawContent.subtitle !== undefined && /^\d{1,2}$/.test(rawContent.subtitle.trim()) ? rawContent.subtitle.trim() : undefined
      if (seq !== undefined) {
        c.text({ x: 0.9, y: 2.2, w: 3.0, h: 1.0, fontSize: 60, color: tokens.colors.accent, bold: true, paragraphs: [{ text: seq.padStart(2, '0') }], idPrefix: 'seq', fit: false })
      }
      c.text({ x: 0.9, y: 3.3, w: 11.5, h: 0.9, fontSize: tokens.fontSizeLadder.sectionTitle, color: sc, font: tokens.fonts.title, bold: true, valign: 'mid', paragraphs: [{ text: title }], idPrefix: 'sect', floor: 20 })
      c.shape({ x: 0.9, y: 4.35, w: 0.9, h: 0.05, shape: 'rect', fill: sc, background: true, idPrefix: 'secrule' })
      const lead = rawContent.items?.[0] ?? (seq !== undefined ? undefined : rawContent.subtitle)
      if (lead !== undefined && !/^\d{1,2}$/.test(lead.trim())) {
        c.text({ x: 0.9, y: 4.6, w: 11.5, h: 0.6, fontSize: 16, color: sc, paragraphs: [{ text: lead }], idPrefix: 'secl', floor: 13 })
      }
      break
    }
    case 'closing': {
      background = structuralBackground(tokens)
      c.structuralDecor()
      const sc = structuralTextColor(tokens)
      c.text({ x: 1.0, y: 3.0, w: 11.3, h: 1.0, fontSize: Math.max(30, tokens.fontSizeLadder.sectionTitle), color: sc, font: tokens.fonts.title, bold: true, align: 'center', valign: 'mid', paragraphs: [{ text: title === '' ? '谢谢聆听' : title }], idPrefix: 'clot', fit: false })
      if (rawContent.subtitle !== undefined && rawContent.subtitle !== '') {
        c.shape({ x: 6.22, y: 4.12, w: 0.9, h: 0.05, shape: 'rect', fill: sc, background: true, idPrefix: 'clorule' })
        c.text({ x: 1.0, y: 4.35, w: 11.3, h: 0.5, fontSize: 16, color: sc, align: 'center', paragraphs: [{ text: rawContent.subtitle }], idPrefix: 'clos', floor: 13 })
      }
      break
    }
    case 'bullets': {
      c.titleBand(title)
      c.bullets(briefItems())
      break
    }
    case 'icon-list': {
      c.titleBand(title)
      c.iconList(rawContent.items ?? need('items: ["要点短句一","要点短句二"]'), rawContent.icons, rawContent.layout)
      break
    }
    case 'two-col': {
      c.titleBand(title)
      c.twoCards(rawContent.columns ?? need(TYPE_REQUIREMENTS['two-col']), { layout: rawContent.layout })
      break
    }
    case 'comparison': {
      c.titleBand(title)
      c.twoCards(rawContent.columns ?? need(TYPE_REQUIREMENTS['comparison']), { vs: true, height: 4.6, layout: rawContent.layout })
      break
    }
    case 'process': {
      c.titleBand(title)
      c.process(rawContent.steps ?? need('steps: [{name:"步骤名",desc:"说明"},…]'), rawContent.layout)
      break
    }
    case 'timeline': {
      c.titleBand(title)
      c.timeline(rawContent.events ?? need('events: [{label:"2019",desc:"事件"},…]'), rawContent.layout)
      break
    }
    case 'cards': {
      c.titleBand(title)
      c.cards(rawContent.cards ?? need('cards: [{title:"卡题",desc:"说明"},…]'), rawContent.layout)
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
      c.imageText(rawContent.image ?? {}, fallback, rawContent.layout)
      break
    }
  }

  return { background, elements: c.elements, layoutNotes: c.notes }
}

export { TYPE_REQUIREMENTS }
