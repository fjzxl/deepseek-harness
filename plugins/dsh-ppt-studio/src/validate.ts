/**
 * 确定性版式校验器。
 *
 * 纯代码、不依赖模型：ppt_page_write 写页时同步执行，
 * ppt_scene_check 全册复查。规则分三级：
 *   error   阻断保存/渲染（越界、文本互压、ID 重复、图片未登记等）
 *   warning 允许继续但必须知情（文字溢出风险、可读性、越出锁定令牌、密度超预算等）
 *   info    提示（形状互叠等有意的分层）
 *
 * 「文字与图的位置」由四类规则保障：边界、重叠、文字容量、纵横比；
 * 「全 deck 锁定」由 TOKEN_COLOR / TOKEN_FONT 保障（令牌见 design/tokens.json）；
 * 「有图文字精炼」由 DENSITY_WITH_VISUAL 保障（有主视觉页收紧文字预算）；
 * 「认知负荷」由 BULLET_BUDGET_EXCEEDED 保障（要点条数受密度预算强制）；
 * 「可信」由 EVIDENCE_SOURCE_MISSING 保障（数字论断需来源，内网来源=用户材料）；
 * 「连贯/结论感」由 NARRATIVE_CHAIN_MISSING / TITLE_TAKEAWAY 保障（叙事链与结论式标题）。
 */
import type { AssetManifest, DesignTokens, EvidenceItem, EvidenceLevel, InfoStructure, OutlinePage, OutlinePart, PageDensity, PageScene, ReferenceMaterial, SceneElement, Strictness, TextElement, ValidationIssue, PageValidationResult, VisualPlan } from './schema.js'
import { CANVAS_H_IN, CANVAS_W_IN, SAFE_MARGIN_IN } from './units.js'

const TOL = 0.02

/** strict 档升级为 error 的规则（品牌一致性/学术证据场景：越锁即错）。 */
const STRICT_ERROR_RULES = new Set(['TOKEN_COLOR', 'TOKEN_FONT', 'EVIDENCE_SOURCE_MISSING'])

/** relaxed 档降为 info 的规则（认知负荷/观感类：草稿快速产出时不刷屏）。 */
const RELAXED_INFO_RULES = new Set([
  'DENSITY_WITH_VISUAL', 'BULLET_BUDGET_EXCEEDED', 'ELEMENT_COUNT', 'READABILITY',
  'TEXT_OVERFLOW_RISK', 'VISUAL_RHYTHM', 'LAYOUT_MONOTONY', 'TYPE_DIVERSITY',
])

/** 按校验强度调整规则分级（幂等：error 不再降、info 不再动）。 */
function applyStrictness(issues: ValidationIssue[], strictness: Strictness | undefined): ValidationIssue[] {
  if (strictness === 'strict') {
    return issues.map(i => (i.level === 'warning' && STRICT_ERROR_RULES.has(i.rule) ? { ...i, level: 'error' as const } : i))
  }
  if (strictness === 'relaxed') {
    return issues.map(i => (i.level === 'warning' && RELAXED_INFO_RULES.has(i.rule) ? { ...i, level: 'info' as const } : i))
  }
  return issues
}

/** 有主视觉页的默认文字预算（全角字符单位），可由 spec.densityPolicy 覆盖。 */
const DEFAULT_VISUAL_CHAR_BUDGET = 220

/** 结构化页型（逐节点/逐卡片成组出元素），元素数上限放宽到 schema 顶格。 */
const MULTI_PART_TYPES: ReadonlySet<string> = new Set(['timeline', 'comparison', 'process', 'cards', 'hierarchy', 'icon-list'])

/** Blueprint 信息结构 → 适配页型（null = 任意页型皆可）。错配报 warning，不阻断。 */
const STRUCTURE_TYPE_COMPAT: Record<InfoStructure, readonly string[] | null> = {
  plain: null,
  timeline: ['timeline'],
  comparison: ['comparison', 'two-col', 'table'],
  process: ['process', 'image-text'],
  hierarchy: ['hierarchy', 'bullets'],
  'cause-effect': ['two-col', 'process', 'comparison', 'image-text'],
  'problem-solution': ['two-col', 'process', 'comparison', 'image-text'],
  'before-after': ['comparison', 'two-col'],
  'concept-example': ['image-text', 'cards', 'icon-list', 'big-number'],
  'data-insight': ['chart', 'big-number', 'table'],
}

/** 单页校验的可选上下文。 */
export interface PageValidateOptions {
  manifest?: AssetManifest
  /** 锁定的设计令牌：启用 TOKEN_COLOR / TOKEN_FONT 检查 */
  tokens?: DesignTokens
  /** 大纲中该页的配图计划：image/chart 时校验页面确有对应元素 */
  visualPlan?: VisualPlan
  /** Blueprint 声明的信息结构：与页型错配时提醒 */
  structure?: InfoStructure
  /** 有主视觉页的全页文字预算（全角字符单位） */
  withVisualCharBudget?: number
  /** 信息点预算：单页要点（bullet 段落）条数上限（spec.densityPolicy.bulletsMax） */
  bulletsMax?: number
  /** 证据等级：启用 EVIDENCE_SOURCE_MISSING 检查 */
  evidenceLevel?: EvidenceLevel
  /** 大纲中该页的证据条目（claim/type/source） */
  evidence?: EvidenceItem[]
  /** 校验强度：strict 把令牌/证据类 warning 升 error；relaxed 把认知负荷类降 info */
  strictness?: Strictness
  /** 页级密度意图（blueprint 层 low/medium/high）：按系数覆盖全册文字预算（字号阶梯仍按全册令牌） */
  pageDensity?: PageDensity
  /** 参考材料清单：提供后 evidence.source 必须引用其中条目（id/标题子串匹配），违规升 error */
  referenceMaterials?: ReferenceMaterial[]
  /** 页级预算豁免（蓝图 densityOverride）：密度/要点超限降为 info 知情放行 */
  densityOverride?: { reason: string }
}

/** 页级密度 → 文字预算系数（0.8.1）：low 收紧 / high 放宽，只作用于文字预算；要点上限与字号阶梯不随页级放宽。 */
const PAGE_DENSITY_FACTOR: Record<PageDensity, number> = { low: 0.7, medium: 1, high: 1.3 }

/** 单个字符的宽度估算（以 em 为单位）。CJK 全角 1.0，西文按窄字符比例。 */
function charUnits(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
  if (code >= 0x2e80) return 1
  if (ch === ' ') return 0.5
  if (/[0-9A-Z@#%&*+=]/.test(ch)) return 0.62
  if (/[iljt.,'"|!()[\]{}:;]/.test(ch)) return 0.34
  return 0.52
}

interface TextCapacityEstimate {
  neededPt: number
  availablePt: number
  ratio: number
}

/** 估算文本元素所需高度（磅）与可用高度的比值。>1 表示可能溢出。 */
export function estimateTextCapacity(element: TextElement): TextCapacityEstimate {
  const availablePt = element.h * 72
  const boxWidthPt = element.w * 72 - 8 // 左右各 4pt 内边距
  let neededPt = 0
  for (const para of element.paragraphs) {
    const text = para.runs !== undefined ? para.runs.map(r => r.text).join('') : (para.text ?? '')
    const runSizes = [
      element.fontSize,
      para.fontSize,
      ...(para.runs ?? []).map(r => r.fontSize),
    ].filter((size): size is number => typeof size === 'number')
    const fontSize = Math.max(...runSizes)
    const units = [...text].reduce((sum, ch) => sum + charUnits(ch), 0)
    const indentPt = para.bullet ? fontSize * 1.25 : 0
    const usablePt = Math.max(24, boxWidthPt - indentPt)
    const lines = Math.max(1, Math.ceil((units * fontSize) / usablePt))
    const spacing = para.lineSpacing ?? 1.25
    neededPt += lines * fontSize * spacing + (para.spaceBefore ?? 0) + (para.spaceAfter ?? 0)
  }
  return { neededPt: Math.round(neededPt), availablePt: Math.round(availablePt), ratio: availablePt > 0 ? neededPt / availablePt : Infinity }
}

interface Box { x: number; y: number; w: number; h: number }

function intersection(a: Box, b: Box): { w: number; h: number; area: number } | null {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  if (w <= TOL || h <= TOL) return null
  return { w, h, area: w * h }
}

function isText(el: SceneElement): el is TextElement {
  return el.kind === 'text'
}

/** 元素用到的全部颜色（含边框与图表覆盖色；渐变按 from/to 两个端点计）。 */
function collectElementColors(el: SceneElement): string[] {
  const colors: string[] = []
  if (el.kind === 'text') {
    colors.push(el.color)
    if (el.fill !== undefined) colors.push(el.fill)
    for (const para of el.paragraphs) {
      if (para.color !== undefined) colors.push(para.color)
      for (const run of para.runs ?? []) if (run.color !== undefined) colors.push(run.color)
    }
  } else if (el.kind === 'shape') {
    if (typeof el.fill === 'string') colors.push(el.fill)
    else if (el.fill !== undefined) colors.push(el.fill.from, el.fill.to)
    if (el.border !== undefined) colors.push(el.border.color)
  } else if (el.kind === 'chart') {
    for (const color of el.colors ?? []) colors.push(color)
  }
  return colors
}

/** 全页文字量（全角字符单位）。导出供时长估算等消费。 */
export function pageTextUnits(page: PageScene): number {
  if (page.svg !== undefined) return svgTextUnits(page.svg)
  let total = 0
  for (const el of page.elements ?? []) {
    if (!isText(el)) continue
    for (const para of el.paragraphs) {
      const text = para.runs !== undefined ? para.runs.map(r => r.text).join('') : (para.text ?? '')
      total += [...text].reduce((sum, ch) => sum + charUnits(ch), 0)
    }
  }
  return total
}

/** 任意文本的全角字符量（时长估算统计演讲者备注用——备注是照着讲的底稿，同样占讲述时间）。 */
export function countTextUnits(text: string): number {
  return [...text].reduce((sum, ch) => sum + charUnits(ch), 0)
}

/** SVG 页可见文字（<text>/<tspan> 内容），供数字论断扫描与时长估算。 */
export function svgTextUnits(svg: string): number {
  let total = 0
  for (const match of svg.matchAll(/<t(?:ext|span)\b[^>]*>([\s\S]*?)<\/t(?:ext|span)>/g)) {
    const inner = match[1].replace(/<[^>]+>/g, '')
    total += countTextUnits(inner)
  }
  return total
}

/** SVG 页的全部可见文字原文（论断扫描用）。 */
function svgVisibleText(svg: string): string {
  const parts: string[] = []
  for (const match of svg.matchAll(/<t(?:ext|span)\b[^>]*>([\s\S]*?)<\/t(?:ext|span)>/g)) {
    parts.push(match[1].replace(/<[^>]+>/g, ''))
  }
  return parts.join(' ')
}

/** 全页可见文字原文（文本段落 + 表格单元格 + SVG 文字节点），供数字论断扫描。 */
function pageVisibleText(page: PageScene): string {
  if (page.svg !== undefined) return svgVisibleText(page.svg)
  const parts: string[] = []
  for (const el of page.elements ?? []) {
    if (el.background === true) continue
    if (isText(el)) {
      for (const para of el.paragraphs) {
        parts.push(para.runs !== undefined ? para.runs.map(r => r.text).join('') : (para.text ?? ''))
      }
    } else if (el.kind === 'table') {
      parts.push(...el.rows.flat())
    }
  }
  return parts.filter(Boolean).join(' ')
}

/** 数字论断（量级/比例类，非年份）：如「1.8 万亿」「增长 30%」。 */
const NUMERIC_CLAIM_PATTERN = /(\d+(?:\.\d+)?)\s*(?:%|％|万亿|亿|万|美元|元|个百分点|人次|人|次|倍|美元亿)/g

/** 命中是否算数据论断：零填充整数（01/02…列表序号写法）排除，小数不排除（0.5 倍仍是论断）。 */
function isNumericClaim(number: string): boolean {
  return !/^0\d/.test(number)
}

function elementLabel(el: SceneElement): string {
  return el.name ?? `${el.kind}(${el.id})`
}

/**
 * 校验 SVG 页（0.10.0 svg 路线）：自由绘制不适用元素级版式规则——
 * 只守安全面（外链红线/脚本/foreignObject）、画布尺寸与锁定色板。
 * 取舍向用户明示：越界/互压/容量/密度保护不适用，QA 依赖预览肉眼复核。
 */
export function validateSvgPage(page: PageScene, options: PageValidateOptions = {}): PageValidationResult {
  const issues: ValidationIssue[] = []
  const svg = page.svg ?? ''
  // ---- 画布尺寸：与 native 路线同一画布（13.3333×7.5in ≈ 1280×720px @96dpi）
  if (!/viewBox\s*=\s*["']\s*0\s+0\s+1280\s+720\s*["']/.test(svg)) {
    issues.push({
      level: 'error',
      rule: 'SVG_VIEWSIZE',
      message: 'SVG 页的 viewBox 必须是 "0 0 1280 720"（与画布 13.3333×7.5in 同一比例；宽高随意会导致预览/PPTX 拉伸错位）',
      pageId: page.id,
      fixable: true,
      suggestedFix: '在 <svg> 根元素上写 viewBox="0 0 1280 720"，图形坐标按 1280×720 设计',
    })
  }
  // ---- 安全面：脚本 / 事件处理器 / foreignObject / 外链引用（内网红线）
  const unsafe: string[] = []
  if (/<script\b/i.test(svg)) unsafe.push('包含 <script>')
  if (/\son[a-z]+\s*=/i.test(svg)) unsafe.push('包含 on* 事件属性')
  if (/<foreignobject\b/i.test(svg)) unsafe.push('包含 <foreignObject>（跨渲染器不可移植）')
  if (/(?:href|xlink:href|src)\s*=\s*["'][^"']*(?:https?:)?\/\/[^"']*["']/i.test(svg)) {
    unsafe.push('引用外部资源（http(s)/// 协议相对——内网红线：SVG 必须自包含，图片走资产登记后内嵌）')
  }
  if (unsafe.length > 0) {
    issues.push({
      level: 'error',
      rule: 'SVG_UNSAFE',
      message: `SVG 页包含不安全或越红线内容：${unsafe.join('；')}`,
      pageId: page.id,
      fixable: true,
      suggestedFix: '删除脚本/事件属性/foreignObject；外部图片先 ppt_asset_register 后以 data URI 内嵌，或改用原生 image 元素',
    })
  }
  // ---- 锁定色板（best-effort：只识别 6 位 hex；3 位缩写与命名色不查——文档已注明）
  if (options.tokens !== undefined) {
    const allowed = new Set<string>([...Object.values(options.tokens.colors), ...options.tokens.chartColors].map(c => c.toLowerCase()))
    const used = [...new Set((svg.match(/#[0-9a-fA-F]{6}\b/g) ?? []).map(c => c.toLowerCase()))]
    const offending = used.filter(c => !allowed.has(c))
    if (offending.length > 0) {
      issues.push({
        level: 'warning',
        rule: 'TOKEN_COLOR',
        message: `SVG 页用了锁定色板之外的颜色 ${offending.join('、')}（只能用 tokens.colors / tokens.chartColors；SVG 路线按 6 位 hex 尽力识别）`,
        pageId: page.id,
        fixable: true,
        suggestedFix: '把颜色改为 tokens.colors / tokens.chartColors 中语义最接近的锁定色',
      })
    }
  }
  // ---- 证据层：SVG 文字同样做数字论断扫描
  if (options.evidenceLevel !== undefined && options.evidenceLevel !== 'none') {
    const materials = options.referenceMaterials ?? []
    const materialIds = new Set(materials.map(m => m.id))
    const citesMaterial = (item: EvidenceItem): boolean => {
      if (materialIds.size > 0 && item.materialId !== undefined) return materialIds.has(item.materialId)
      const source = item.source
      if (source === undefined || source.trim() === '') return false
      const lower = source.toLowerCase()
      return materials.some(m => lower.includes(m.id.toLowerCase()) || lower.includes(m.title.toLowerCase()))
    }
    const evidence = options.evidence ?? []
    const sourced = materials.length > 0
      ? evidence.some(e => citesMaterial(e))
      : evidence.some(e => e.materialId !== undefined || (e.source !== undefined && e.source.trim() !== ''))
    if (!sourced) {
      const claims: string[] = []
      for (const match of svgVisibleText(svg).matchAll(NUMERIC_CLAIM_PATTERN)) {
        if (isNumericClaim(match[1])) claims.push(match[0])
      }
      if (claims.length > 0) {
        issues.push({
          level: materials.length > 0 ? 'error' as const : 'warning' as const,
          rule: 'EVIDENCE_SOURCE_MISSING',
          message: `SVG 页文字有数字论断（${claims.slice(0, 3).join('、')}…）但没有带来源的证据条目（evidence 登记在蓝图，与渲染路线无关）`,
          pageId: page.id,
          fixable: true,
          suggestedFix: materials.length > 0 ? `把论断登记进蓝图 evidence 且 materialId 引用参考材料 id（如 ${materials[0].id}）` : '登记 evidence 条目并注明来源，或改定性表述/标「数据待补充」',
        })
      }
    }
  }
  const graded = applyStrictness(issues, options.strictness)
  const errorCount = graded.filter(i => i.level === 'error').length
  const warningCount = graded.filter(i => i.level === 'warning').length
  return { pageId: page.id, ok: errorCount === 0, errorCount, warningCount, issues: graded }
}

/**
 * 校验单页。svg 路线页（page.svg 存在）走 validateSvgPage；
 * options 提供 manifest（图片资产）、tokens（锁定令牌）、
 * visualPlan（大纲配图计划）与文字预算。
 */
export function validatePage(page: PageScene, options: PageValidateOptions = {}): PageValidationResult {
  if (page.svg !== undefined) return validateSvgPage(page, options)
  if (page.elements === undefined) {
    // schema refine 保证 elements/svg 二选一；到达这里说明绕过了 schema（loadPages 读盘不过 zod）——数据损坏兜底
    return {
      pageId: page.id,
      ok: false,
      errorCount: 1,
      warningCount: 0,
      issues: [{ level: 'error', rule: 'PAGE_SCENE_INVALID', message: '页面既无 elements 也无 svg（页面文件损坏或被手改）——请重新 ppt_page_write 该页', pageId: page.id }],
    }
  }
  const elements = page.elements
  const { manifest, tokens } = options
  const issues: ValidationIssue[] = []

  // ---- ID 唯一性
  const seen = new Set<string>()
  for (const el of elements) {
    if (seen.has(el.id)) {
      issues.push({ level: 'error', rule: 'ID_DUPLICATE', message: `元素 ID 重复：${el.id}`, pageId: page.id, elementId: el.id })
    }
    seen.add(el.id)
  }

  // ---- 元素数量（结构化页型逐节点出元素，上限放宽）
  const maxElements = MULTI_PART_TYPES.has(page.type) ? 24 : 12
  if (elements.length > maxElements) {
    issues.push({
      level: 'warning',
      rule: 'ELEMENT_COUNT',
      message: `本页元素 ${elements.length} 个，超过 ${maxElements} 个建议上限，版面可能过碎`,
      pageId: page.id,
    })
  }

  // ---- 边界
  for (const el of elements) {
    if (el.background === true) {
      // 背景装饰：允许出血，但仍需大致在画布上
      if (el.x < -0.3 || el.y < -0.3 || el.x + el.w > CANVAS_W_IN + 0.3 || el.y + el.h > CANVAS_H_IN + 0.3) {
        issues.push({ level: 'warning', rule: 'BG_OUT_OF_CANVAS', message: `背景元素 ${elementLabel(el)} 超出画布过多`, pageId: page.id, elementId: el.id })
      }
      continue
    }
    const m = SAFE_MARGIN_IN - TOL
    if (el.x < m || el.y < m || el.x + el.w > CANVAS_W_IN - m || el.y + el.h > CANVAS_H_IN - m) {
      issues.push({
        level: 'error',
        rule: 'OUT_OF_BOUNDS',
        message: `元素 ${elementLabel(el)} 越出安全区（画布 ${CANVAS_W_IN}×${CANVAS_H_IN}in，边距 ${SAFE_MARGIN_IN}in）：` +
          `x=${el.x}, y=${el.y}, w=${el.w}, h=${el.h}`,
        pageId: page.id,
        elementId: el.id,
      })
    }
  }

  // ---- 重叠（背景装饰豁免）
  const foreground = elements.filter(el => el.background !== true)
  for (let i = 0; i < foreground.length; i++) {
    for (let j = i + 1; j < foreground.length; j++) {
      const a = foreground[i]
      const b = foreground[j]
      const inter = intersection(a, b)
      if (inter === null) continue
      const smallerArea = Math.min(a.w * a.h, b.w * b.h)
      if (inter.area < smallerArea * 0.02) continue // 轻微搭边忽略
      const both = isText(a) && isText(b)
      issues.push({
        level: both ? 'error' : 'warning',
        rule: both ? 'TEXT_OVER_TEXT' : 'ELEMENT_OVERLAP',
        message: both
          ? `文本互压：${elementLabel(a)} 与 ${elementLabel(b)} 重叠 ${inter.w.toFixed(2)}×${inter.h.toFixed(2)}in`
          : `元素叠放：${elementLabel(a)} 与 ${elementLabel(b)} 重叠（若为卡片衬底请给形状加 background:true）`,
        pageId: page.id,
        elementId: a.id,
      })
    }
  }

  // ---- 文本容量与可读性
  for (const el of elements) {
    if (!isText(el)) continue
    if (el.fontSize < 10) {
      issues.push({ level: 'error', rule: 'FONT_TOO_SMALL', message: `文本 ${elementLabel(el)} 字号 ${el.fontSize}pt 低于 10pt 下限`, pageId: page.id, elementId: el.id })
    }
    const totalChars = el.paragraphs
      .map(p => (p.runs !== undefined ? p.runs.map(r => r.text).join('') : (p.text ?? '')))
      .join('').length
    if (el.fontSize < 14 && totalChars > 20) {
      issues.push({ level: 'warning', rule: 'READABILITY', message: `正文文本 ${elementLabel(el)} 字号 ${el.fontSize}pt 建议不小于 14pt`, pageId: page.id, elementId: el.id })
    }
    const cap = estimateTextCapacity(el)
    if (cap.ratio > 1.5) {
      issues.push({
        level: 'error',
        rule: 'TEXT_SEVERE_OVERFLOW',
        message: `文本 ${elementLabel(el)} 严重溢出：估算需要 ${cap.neededPt}pt 高，可用 ${cap.availablePt}pt（${Math.round(cap.ratio * 100)}%），请扩高、缩字号或删减文字`,
        pageId: page.id,
        elementId: el.id,
      })
    } else if (cap.ratio > 1.15) {
      issues.push({
        level: 'warning',
        rule: 'TEXT_OVERFLOW_RISK',
        message: `文本 ${elementLabel(el)} 可能溢出：估算需要 ${cap.neededPt}pt 高，可用 ${cap.availablePt}pt（${Math.round(cap.ratio * 100)}%）`,
        pageId: page.id,
        elementId: el.id,
        fixable: true,
        suggestedFix: `扩高文本框到约 ${Math.ceil((cap.neededPt / 72) * 100) / 100}in、缩小字号，或精简文字约 ${Math.max(5, Math.round((1 - 1 / cap.ratio) * 100))}%`,
      })
    }
  }

  // ---- 图片资产与比例
  const assetIds = new Set((manifest?.assets ?? []).map(a => a.assetId))
  for (const el of elements) {
    if (el.kind !== 'image') continue
    if ((el.assetId !== undefined) === (el.placeholder !== undefined)) {
      issues.push({
        level: 'error',
        rule: 'IMAGE_SOURCE_INVALID',
        message: `图片 ${elementLabel(el)} 必须且只能提供 assetId / placeholder 之一`,
        pageId: page.id,
        elementId: el.id,
      })
      continue
    }
    if (el.assetId !== undefined && !assetIds.has(el.assetId)) {
      issues.push({
        level: 'error',
        rule: 'ASSET_MISSING',
        message: `图片 ${elementLabel(el)} 引用未登记资产 ${el.assetId}，请先 ppt_asset_register 或改用 placeholder`,
        pageId: page.id,
        elementId: el.id,
      })
    }
    const ratio = el.w / el.h
    if (el.fit === 'fill' && ratio > 2.8) {
      issues.push({ level: 'warning', rule: 'IMAGE_DISTORTION', message: `图片 ${elementLabel(el)} fit=fill 且宽高比 ${ratio.toFixed(1)} 失常，画面会被拉伸`, pageId: page.id, elementId: el.id })
    }
  }

  // ---- 表格可读性
  for (const el of elements) {
    if (el.kind !== 'table') continue
    if (el.fontSize < 9) {
      issues.push({ level: 'error', rule: 'TABLE_FONT_SMALL', message: `表格 ${elementLabel(el)} 字号 ${el.fontSize}pt 低于 9pt`, pageId: page.id, elementId: el.id })
    } else if (el.fontSize < 11) {
      issues.push({ level: 'warning', rule: 'TABLE_READABILITY', message: `表格 ${elementLabel(el)} 字号 ${el.fontSize}pt 建议不小于 11pt`, pageId: page.id, elementId: el.id })
    }
    const cols = el.rows[0]?.length ?? 0
    if (el.rows.some(row => row.length !== cols)) {
      issues.push({ level: 'error', rule: 'TABLE_RAGGED', message: `表格 ${elementLabel(el)} 各行列数不一致`, pageId: page.id, elementId: el.id })
    }
  }

  // ---- 图表数据
  for (const el of elements) {
    if (el.kind !== 'chart') continue
    if (el.series.some(s => s.values.length !== el.labels.length)) {
      issues.push({ level: 'error', rule: 'CHART_SHAPE_MISMATCH', message: `图表 ${elementLabel(el)} 每个系列的取值数量必须与 labels 一致`, pageId: page.id, elementId: el.id })
    }
    if ((el.chartType === 'pie' || el.chartType === 'doughnut') && el.series.length !== 1) {
      issues.push({ level: 'error', rule: 'CHART_PIE_MULTI_SERIES', message: `饼图 / 环图只允许一个系列，${elementLabel(el)} 有 ${el.series.length} 个`, pageId: page.id, elementId: el.id })
    }
    if (el.series.some(s => s.values.every(v => v === 0))) {
      issues.push({ level: 'warning', rule: 'CHART_ALL_ZERO', message: `图表 ${elementLabel(el)} 存在全零系列`, pageId: page.id, elementId: el.id })
    }
    // 类别过挤（0.9.2，借鉴感知可读性纪律）：饼/环的扇区随类别数平方级变窄，>6 类小扇区既标不下也认不出
    if ((el.chartType === 'pie' || el.chartType === 'doughnut') && el.labels.length > 6) {
      issues.push({
        level: 'warning',
        rule: 'CHART_CATEGORY_CROWD',
        message: `饼/环图 ${elementLabel(el)} 有 ${el.labels.length} 个类别：扇区过窄标注不下、占比难比较——改为条形图（bar 按大小排序），或把 <5% 的长尾合并为「其他」`,
        pageId: page.id,
        elementId: el.id,
        fixable: true,
        suggestedFix: '改 chartType:bar 按 value 降序排列，或合并长尾类别到 ≤6 个',
      })
    }
    // 单系列图例冗余（0.9.2）：非饼/环的单系列图，图例只重复系列名——标题已能点名，关掉省版面
    // （饼/环除外：其图例承载的是类别名不是系列名，有意义）
    if (el.chartType !== 'pie' && el.chartType !== 'doughnut' && el.series.length === 1 && el.showLegend === true) {
      issues.push({
        level: 'info',
        rule: 'CHART_LEGEND_REDUNDANT',
        message: `单系列图表 ${elementLabel(el)} 开着图例：图例只重复系列名，建议 showLegend:false 并在图表标题或页标题里点名（如「2024 营收趋势」比底部图例「营收」更省版面）`,
        pageId: page.id,
        elementId: el.id,
        fixable: true,
        suggestedFix: 'showLegend:false，系列含义写进 chart.title 或页标题',
      })
    }
  }

  // ---- 锁定令牌：颜色 / 字体（design/tokens.json 之外的一律提醒）
  if (tokens !== undefined) {
    const allowed = new Set<string>([...Object.values(tokens.colors), ...tokens.chartColors])
    const bgColors: string[] = []
    if (page.background?.color !== undefined) bgColors.push(page.background.color)
    if (page.background?.gradient !== undefined) bgColors.push(page.background.gradient.from, page.background.gradient.to)
    const bgOffending = [...new Set(bgColors.filter(c => !allowed.has(c)))]
    if (bgOffending.length > 0) {
      issues.push({
        level: 'warning',
        rule: 'TOKEN_COLOR',
        message: `页面背景用了锁定色板之外的颜色 ${bgOffending.join('、')}（只能用 tokens.colors / tokens.chartColors）`,
        pageId: page.id,
      })
    }
    for (const el of elements) {
      const offending = [...new Set(collectElementColors(el).filter(c => !allowed.has(c)))]
      if (offending.length > 0) {
        issues.push({
          level: 'warning',
          rule: 'TOKEN_COLOR',
          message: `元素 ${elementLabel(el)} 用了锁定色板之外的颜色 ${offending.join('、')}（只能用 tokens.colors / tokens.chartColors）`,
          pageId: page.id,
          elementId: el.id,
          fixable: true,
          suggestedFix: '把颜色改为 tokens.colors / tokens.chartColors 中语义最接近的锁定色',
        })
      }
      if (el.kind === 'text' && el.font !== undefined && el.font !== tokens.fonts.title && el.font !== tokens.fonts.body) {
        issues.push({
          level: 'warning',
          rule: 'TOKEN_FONT',
          message: `文本 ${elementLabel(el)} 字体 ${el.font} 不在锁定字体内（${tokens.fonts.title} / ${tokens.fonts.body}）`,
          pageId: page.id,
          elementId: el.id,
          fixable: true,
          suggestedFix: `字体改为 ${tokens.fonts.title} 或 ${tokens.fonts.body}（或删掉 font 字段继承默认）`,
        })
      }
    }
  }

  // ---- 信息密度：有主视觉的页面文字收紧；草稿配图计划落实
  const hasVisual = elements.some(el => (el.kind === 'image' || el.kind === 'chart') && el.background !== true)
  if (hasVisual) {
    const base = options.withVisualCharBudget ?? DEFAULT_VISUAL_CHAR_BUDGET
    const factor = PAGE_DENSITY_FACTOR[options.pageDensity ?? 'medium']
    const budget = Math.round(base * factor)
    const units = pageTextUnits(page)
    if (units > budget) {
      issues.push({
        level: options.densityOverride !== undefined ? 'info' : 'warning',
        rule: 'DENSITY_WITH_VISUAL',
        message: `有图页文字过多：约 ${Math.round(units)} 字 > 预算 ${budget} 字（全册 ${base}${factor !== 1 ? ` × 页级密度系数 ${factor}` : ''}；有图文字精炼，无图才可多放文字）${options.densityOverride !== undefined ? `——densityOverride 知情豁免：${options.densityOverride.reason}` : ''}`,
        pageId: page.id,
        fixable: true,
        suggestedFix: '精简文字到预算内，或把该页改成无图版式（无图页预算更宽）',
      })
    }
  }
  if (options.visualPlan === 'image' && !elements.some(el => el.kind === 'image')) {
    issues.push({ level: 'warning', rule: 'VISUAL_PLAN_UNMET', message: '草稿计划配图（visual:image），但页面没有 image 元素（实图或 placeholder）', pageId: page.id })
  }
  if (options.visualPlan === 'chart' && !elements.some(el => el.kind === 'chart')) {
    issues.push({ level: 'warning', rule: 'VISUAL_PLAN_UNMET', message: '草稿计划配图表（visual:chart），但页面没有 chart 元素', pageId: page.id })
  }

  // ---- Blueprint 信息结构与页型的匹配（错配提醒，不阻断）
  if (options.structure !== undefined && options.structure !== 'plain') {
    const compat = STRUCTURE_TYPE_COMPAT[options.structure]
    if (compat !== null && !compat.includes(page.type)) {
      issues.push({
        level: 'warning',
        rule: 'STRUCTURE_TYPE_MISMATCH',
        message: `Blueprint 声明信息结构 ${options.structure}，但页型是 ${page.type}（适配页型：${compat.join(' / ')}）`,
        pageId: page.id,
      })
    }
  }

  // ---- 信息点预算：要点条数受密度策略强制（不只是 spec 文案里的建议）
  if (options.bulletsMax !== undefined) {
    const bulletCount = elements
      .filter(isText)
      .reduce((acc, el) => acc + el.paragraphs.filter(p => p.bullet === true || (typeof p.bullet === 'object')).length, 0)
    if (bulletCount > options.bulletsMax) {
      issues.push({
        level: options.densityOverride !== undefined ? 'info' : 'warning',
        rule: 'BULLET_BUDGET_EXCEEDED',
        message: `本页要点 ${bulletCount} 条，超过密度预算 ${options.bulletsMax} 条（控制认知负荷：删并要点，或拆成两页）${options.densityOverride !== undefined ? `——densityOverride 知情豁免：${options.densityOverride.reason}` : ''}`,
        pageId: page.id,
        fixable: true,
        suggestedFix: `删并要点到 ≤${options.bulletsMax} 条（认知上限不随页级密度放宽），或把内容拆成两页`,
      })
    }
  }

  // ---- 证据层：数字论断需有来源（内网环境来源只能来自用户材料）。
  // 提供参考材料清单时（0.8.1）：source 必须引用清单条目（id/标题子串），违规升 error——"来源=用户材料"可执行。
  // 0.9.1：evidence.materialId 优先按 id 精确匹配（子串匹配保留兼容，标题雷同/误关联由精确引用消除）。
  if (options.evidenceLevel !== undefined && options.evidenceLevel !== 'none') {
    const materials = options.referenceMaterials ?? []
    const materialIds = new Set(materials.map(m => m.id))
    const citesMaterial = (item: EvidenceItem): boolean => {
      if (materialIds.size > 0 && item.materialId !== undefined) return materialIds.has(item.materialId)
      const source = item.source
      if (source === undefined || source.trim() === '') return false
      const lower = source.toLowerCase()
      return materials.some(m => lower.includes(m.id.toLowerCase()) || lower.includes(m.title.toLowerCase()))
    }
    const hasReference = (item: EvidenceItem): boolean =>
      item.materialId !== undefined || (item.source !== undefined && item.source.trim() !== '')
    const evidence = options.evidence ?? []
    const sourced = materials.length > 0
      ? evidence.some(e => citesMaterial(e))
      : evidence.some(e => hasReference(e))
    if (options.evidenceLevel === 'academic') {
      const unsourced = evidence.filter(e => (e.type === 'fact' || e.type === 'data') && !hasReference(e))
      const evidenceLevel2 = materials.length > 0 ? 'error' as const : 'warning' as const
      for (const item of unsourced) {
        issues.push({
          level: evidenceLevel2,
          rule: 'EVIDENCE_SOURCE_MISSING',
          message: `学术级证据要求：论断「${item.claim.slice(0, 60)}」（${item.type}）缺来源${materials.length > 0 ? '（简报已提供参考材料清单，materialId/source 必须引用其中条目）' : '；来源只能来自用户提供的材料，无法核实请改定性表述或标「数据待补充」'}`,
          pageId: page.id,
          fixable: true,
          suggestedFix: materials.length > 0 ? `把 materialId 设为参考材料 id（如 ${materials[0].id}），或 source 引用其标题（如「${materials[0].title}」）；locator 注明出处位置` : '补 evidence 条目并注明来源，或改定性表述/标「数据待补充」',
        })
      }
    }
    if (!sourced) {
      const claims: string[] = []
      if (elements.some(el => el.kind === 'chart' && el.background !== true)) claims.push('（图表数据）')
      const text = pageVisibleText(page)
      for (const match of text.matchAll(NUMERIC_CLAIM_PATTERN)) {
        if (isNumericClaim(match[1])) claims.push(match[0])
      }
      if (claims.length > 0) {
        issues.push({
          level: materials.length > 0 ? 'error' as const : 'warning' as const,
          rule: 'EVIDENCE_SOURCE_MISSING',
          message: `页面上有数字论断（${claims.slice(0, 3).join('、')}…）但没有带来源的证据条目${materials.length > 0 ? '（简报已提供参考材料清单，materialId/source 必须引用其中条目）' : '；请把论断补进大纲 evidence 并给出来源（用户材料/内部报告），无法核实的数据改定性表述或标「数据待补充」，禁止编造'}`,
          pageId: page.id,
          fixable: true,
          suggestedFix: materials.length > 0 ? `把论断登记进蓝图 evidence 且 materialId 引用参考材料 id（如 ${materials[0].id}）` : '登记 evidence 条目并注明来源，或改定性表述/标「数据待补充」',
        })
      }
    }
  }

  const graded = applyStrictness(issues, options.strictness)
  const errorCount = graded.filter(i => i.level === 'error').length
  const warningCount = graded.filter(i => i.level === 'warning').length
  return { pageId: page.id, ok: errorCount === 0, errorCount, warningCount, issues: graded }
}

export interface DeckValidationResult {
  ok: boolean
  errorCount: number
  warningCount: number
  pageResults: PageValidationResult[]
  issues: ValidationIssue[]
}

export interface DeckValidateOptions extends PageValidateOptions {
  /** 大纲页级清单：提供时按页落实配图计划（visual）/信息结构（structure）/证据条目（evidence） */
  outlinePages?: OutlinePage[]
  /** 叙事架构的部分清单：启用 TITLE_TAKEAWAY（页标题与章节标题雷同检测） */
  parts?: OutlinePart[]
}

/** 全册校验：页面集合 + 大纲一致性 + 配图计划/信息结构落实 + 跨页集成检查。 */
export function validateDeckPages(pages: PageScene[], options: DeckValidateOptions = {}): DeckValidationResult {
  const outlineByPage = new Map((options.outlinePages ?? []).map(p => [p.id, p]))
  const pageResults = pages.map(page => {
    const outlinePage = outlineByPage.get(page.id)
    return validatePage(page, {
      manifest: options.manifest,
      tokens: options.tokens,
      visualPlan: outlinePage?.visual,
      structure: outlinePage?.structure,
      withVisualCharBudget: options.withVisualCharBudget,
      bulletsMax: options.bulletsMax,
      evidenceLevel: options.evidenceLevel,
      evidence: outlinePage?.evidence,
      strictness: options.strictness,
      pageDensity: outlinePage?.density,
      referenceMaterials: options.referenceMaterials,
      densityOverride: outlinePage?.densityOverride,
    })
  })
  const issues = pageResults.flatMap(r => r.issues)

  // ---- Deck Integration：跨页一致性（版式单调 / 版式多样性 / 视觉节奏）
  const contentPages = pages.filter(p => p.type !== 'cover' && p.type !== 'toc' && p.type !== 'closing')
  let typeRun = 1
  for (let i = 1; i < contentPages.length; i++) {
    if (contentPages[i].type === contentPages[i - 1].type) {
      typeRun += 1
      if (typeRun === 3) {
        issues.push({
          level: 'warning',
          rule: 'LAYOUT_MONOTONY',
          message: `连续 3 页使用同一页型 ${contentPages[i].type}（${contentPages[i - 2].id}–${contentPages[i].id}），模板化过度，建议换页型或合并`,
          pageId: contentPages[i].id,
        })
      }
    } else {
      typeRun = 1
    }
  }
  if (contentPages.length > 10 && new Set(contentPages.map(p => p.type)).size < 3) {
    issues.push({
      level: 'warning',
      rule: 'TYPE_DIVERSITY',
      message: `${contentPages.length} 页内容只用了 ${new Set(contentPages.map(p => p.type)).size} 种页型，全册观感单调（建议 ≥3 种）`,
    })
  }
  let visualRun = 0
  for (const page of contentPages) {
    // SVG 页视为"有主视觉"（自由绘制几乎必然带视觉；保守不误报节奏单调）
    const hasVisual = page.svg !== undefined || (page.elements?.some(el => (el.kind === 'image' || el.kind === 'chart') && el.background !== true) ?? false)
    visualRun = hasVisual ? 0 : visualRun + 1
    if (visualRun === 4) {
      issues.push({
        level: 'warning',
        rule: 'VISUAL_RHYTHM',
        message: `连续 4 页没有任何图/图表（至 ${page.id}），视觉节奏单调，建议间隔安排配图或图表页`,
        pageId: page.id,
      })
    }
  }

  // ---- 叙事链：PPT 是连续叙事，每页应说明如何承接上一页。
  // 分级（0.9.1 完成 mode 解耦：质量旋钮只认 strictness，mode 只决定确认点）：
  //   strictness=strict → 缺失升 warning（越严越要求叙事完整）；
  //   其余档 → 链已部分建立时缺口提示 info，完全未建立时静默（避免对存量 deck 刷屏）。
  const chainPages = contentPages.filter(p => p.type !== 'section')
  const anyTransition = chainPages.some(p => outlineByPage.get(p.id)?.transition !== undefined)
  if (options.strictness === 'strict' || anyTransition) {
    for (let i = 1; i < chainPages.length; i++) {
      const page = chainPages[i]
      const bridge = outlineByPage.get(page.id)?.transition?.fromPrevious
      if (bridge === undefined || bridge.trim() === '') {
        issues.push({
          level: options.strictness === 'strict' ? 'warning' : 'info',
          rule: 'NARRATIVE_CHAIN_MISSING',
          message: `页 ${page.id}（${(page.title ?? page.type).slice(0, 30)}）缺少 transition.fromPrevious：未说明如何承接上一页。请在蓝图为该页补一句承接语，避免"页页都不错、连起来跳跃"`,
          pageId: page.id,
        })
      }
    }
  }

  // ---- 标题即结论：页标题应是这页的 takeaway，不只是话题或章节名的回声
  const partTitles = new Map((options.parts ?? []).map(p => [p.id, p.title]))
  for (const page of contentPages) {
    if (page.type === 'section') continue // 章节隔页本就以章节名为题
    const outlinePage = outlineByPage.get(page.id)
    const title = (page.title ?? outlinePage?.title ?? '').trim()
    if (title === '') continue
    const partTitle = partTitles.get(page.sectionId)
    if (partTitle !== undefined && title === partTitle.trim()) {
      issues.push({
        level: 'warning',
        rule: 'TITLE_TAKEAWAY',
        message: `页 ${page.id} 标题「${title}」与章节标题相同：标题应是这页的结论（如「X 让 Y 提升了 3 倍」），而不是复述章节名`,
        pageId: page.id,
      })
    } else if ([...title].length < 5 && (outlinePage?.keyMessage ?? '').trim() !== '') {
      issues.push({
        level: 'warning',
        rule: 'TITLE_TAKEAWAY',
        message: `页 ${page.id} 标题「${title}」过短：只给了话题没给结论，建议改写为 takeaway 式标题（把 keyMessage 浓缩进标题）`,
        pageId: page.id,
      })
    }
  }

  const graded = applyStrictness(issues, options.strictness)
  const errorCount = graded.filter(i => i.level === 'error').length
  const warningCount = graded.filter(i => i.level === 'warning').length
  return { ok: errorCount === 0, errorCount, warningCount, pageResults, issues: graded }
}
