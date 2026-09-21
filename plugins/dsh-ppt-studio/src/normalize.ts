/**
 * 输入归一化与输出清洗。
 *
 * normalizeSceneInput：在 zod 校验前对模型发来的场景做容错归一。
 * 真实会话（sessionlog/2026-09-10，主会话 + 3 个子代理）中 96 次写页失败的形态：
 *   1. text 元素写成扁平 text:"..." 而非 paragraphs:[{text:"..."}]（最高频）
 *   2. paragraphs / elements 写成对象而非数组
 *   3. runs[].text / paragraphs[].text 用了数字
 *   4. 传输损坏：键名变成 "color=#F1F5F9":"" 形态（疑似模型输出未加引号的 #hex 被上游修复器并键）
 *   5. 子代理通道：标量全部字符串化——x:"0.6"、background:"true"、z:"1"
 *   6. 子代理通道：重复元素被包成 {item:...} 对象——paragraphs:{item:{...}}、runs:{item:{...}}
 *      （重复 XML 标签 → JSON 的转换痕迹；"结构与范例一致仍报错"的元凶）
 *   7. 标量字段被包成 {"$text": X}（XML 文本节点风格）：bullet:{"$text":"true"}、
 *      lineSpacing:{"$text":"1.4"}（sessionlog 2026-09-20，elements 路径）
 *
 * lossless：DSH 宿主要求工具返回值可无损 JSON 化（键值不得为 undefined），
 * 所有工具返回值统一过一遍清洗。
 */

/** 值为数字的键（字符串数字自动转回 number）。 */
const NUMERIC_KEYS = new Set(['x', 'y', 'w', 'h', 'z', 'fontSize', 'opacity', 'radius', 'lineSpacing', 'spaceBefore', 'spaceAfter', 'angle', 'width'])

/** 值为数组中数字的键。 */
const NUMERIC_ARRAY_KEYS = new Set(['values', 'colWidths'])

/**
 * 值为数组中数字、但语义应为字符串数组的键。
 * 真实会话（session.v3，Transformer deck）：模型把数字轴刻度写成 chart.labels:[32,64,128]、
 * 表格数字单元格写成 rows:[[...,"0.98"]]——zod 只收 string，8 次写页被拒后模型才手工加引号。
 */
const TEXT_ARRAY_KEYS = new Set(['labels'])

/** 二维字符串矩阵键（表格行；内层单元格数字 → 字符串，同上真实会话教训）。 */
const TEXT_MATRIX_KEYS = new Set(['rows'])

/** 值为布尔的键（"true"/"false" 或 {"$text":"true"} 自动转回 boolean；bullet 合法形态含 {marker} 对象，仅在值已是字符串时才转换）。 */
const BOOLEAN_KEYS = new Set(['background', 'bold', 'italic', 'headerRow', 'zebra', 'showLegend', 'showValues', 'bullet'])

/**
 * 语义上应为数组、但可能被包成对象（{item:...} 或单对象）的键。
 * 后两组是 content 内容模式（autolayout）与蓝图/页数工具的字段——弱模型常把
 * 语义数组序列化为 {"item":[...]}（XML 风格包装）；deepRepair 递归整个入参，
 * 各嵌套层级（如 columns[].items）里的这些键同样会被还原为纯数组。
 */
const ARRAY_KEYS = new Set([
  'elements', 'paragraphs', 'runs', 'series', 'labels', 'rows', 'values', 'colors', 'colWidths', 'keyPoints', 'sections', 'openQuestions',
  'items', 'columns', 'events', 'steps', 'cards', 'layers', 'entries',
  'parts', 'pages', 'allocation',
])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 反复剥离 {item: X} 包装，直到不再是该形态。 */
function unwrapItem(value: unknown): unknown {
  while (isPlainObject(value) && Object.keys(value).length === 1 && 'item' in value) {
    value = value.item
  }
  return value
}

/** 修复 "key=#RRGGBB":"" / "key=\"#RRGGBB\"":"" 形态的损坏键：拆回 { key: "#RRGGBB" }。 */
function isMangledKey(key: string, value: unknown): key is `${string}=${string}` {
  if (value !== '' && value !== null) return false
  if (!key.includes('=')) return false
  const raw = key.split('=').slice(1).join('=')
  const unquoted = raw.replace(/^"+|"+$/g, '')
  return /^#[0-9A-Za-z()[\]{}.,%\s-]+$/.test(unquoted)
}

/**
 * 深度容错修复：损坏键拆分、字符串标量转回数字/布尔、{item:} 包装还原为数组。
 * repairs 为可选计数器（记录修复发生次数，用于生成给模型的提示）。
 */
export function deepRepair(value: unknown, repairCount?: { n: number }): unknown {
  if (Array.isArray(value)) return value.map(item => deepRepair(item, repairCount))
  if (!isPlainObject(value)) return value

  const result: Record<string, unknown> = {}
  for (const [rawKey, rawValue] of Object.entries(value)) {
    let key = rawKey
    let itemValue = deepRepair(rawValue, repairCount)

    // "color=#F1F5F9":"" / "color=\"#F1F5F9\"":"" → color:"#F1F5F9"
    if (isMangledKey(key, itemValue)) {
      const [realKey, ...rest] = key.split('=')
      key = realKey
      itemValue = rest.join('=').replace(/^"+|"+$/g, '').trim()
      if (repairCount !== undefined) repairCount.n++
    }

    // 标量字段的 {"$text": X} 包装（XML 文本节点风格）→ 剥回标量，交给下方布尔/数字转换。
    // 仅当 $text 是唯一键且内值为标量时剥离——不碰 {marker:…} 这类合法对象。
    if (isPlainObject(itemValue) && Object.keys(itemValue).length === 1 && '$text' in itemValue) {
      const inner = (itemValue as Record<string, unknown>)['$text']
      if (inner !== null && (typeof inner === 'string' || typeof inner === 'number' || typeof inner === 'boolean')) {
        itemValue = inner
        if (repairCount !== undefined) repairCount.n++
      }
    }

    // 语义数组：{item:} 包装 / 单对象 → 数组（先还原，再按数组做数字转换）
    if (ARRAY_KEYS.has(key) && isPlainObject(itemValue)) {
      const unwrapped = unwrapItem(itemValue)
      itemValue = Array.isArray(unwrapped) ? unwrapped : [unwrapped]
      if (repairCount !== undefined) repairCount.n++
    }
    // rows 的二维结构：内层每行的 {item:[...]} 单元格包装也要剥离
    if (key === 'rows' && Array.isArray(itemValue)) {
      itemValue = itemValue.map(row => (isPlainObject(row) && Object.keys(row).length === 1 && 'item' in row ? unwrapItem(row) : row))
    }

    // 字符串化的布尔 / 数字
    if (BOOLEAN_KEYS.has(key) && (itemValue === 'true' || itemValue === 'false')) {
      itemValue = itemValue === 'true'
      if (repairCount !== undefined) repairCount.n++
    } else if (NUMERIC_KEYS.has(key) && typeof itemValue === 'string' && itemValue.trim() !== '' && Number.isFinite(Number(itemValue))) {
      itemValue = Number(itemValue)
      if (repairCount !== undefined) repairCount.n++
    } else if (NUMERIC_ARRAY_KEYS.has(key) && Array.isArray(itemValue)) {
      itemValue = itemValue.map(entry => {
        if (typeof entry === 'string' && Number.isFinite(Number(entry))) {
          if (repairCount !== undefined) repairCount.n++
          return Number(entry)
        }
        return entry
      })
    } else if (TEXT_ARRAY_KEYS.has(key) && Array.isArray(itemValue)) {
      // chart.labels 数字刻度 → 字符串（数字轴标签是自然写法，不该拒绝）
      itemValue = itemValue.map(entry => {
        if (typeof entry === 'number' && Number.isFinite(entry)) {
          if (repairCount !== undefined) repairCount.n++
          return String(entry)
        }
        return entry
      })
    } else if (TEXT_MATRIX_KEYS.has(key) && Array.isArray(itemValue)) {
      // table.rows 单元格数字 → 字符串
      itemValue = itemValue.map(row =>
        Array.isArray(row)
          ? row.map(cell => {
              if (typeof cell === 'number' && Number.isFinite(cell)) {
                if (repairCount !== undefined) repairCount.n++
                return String(cell)
              }
              return cell
            })
          : row,
      )
    }

    result[key] = itemValue
  }
  return result
}

/** 数字 → 字符串（仅当整体可读作文本）。 */
function coerceText(value: unknown): unknown {
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  return value
}

/** 归一单个段落：修键、数字转文本、缺内容的段落删除。返回 null 表示段落为空可丢弃。 */
function normalizeParagraph(raw: unknown): { paragraph: Record<string, unknown> | null; repaired: boolean } {
  const para = deepRepair(raw)
  if (para === null || typeof para !== 'object' || Array.isArray(para)) return { paragraph: null, repaired: false }
  const record = para as Record<string, unknown>

  // text 数字转字符串
  if (record.text !== undefined) record.text = coerceText(record.text)

  // runs 对象 → 数组；run.text 数字转字符串；纯字符串 run 包装为对象
  if (record.runs !== undefined) {
    if (isPlainObject(record.runs)) record.runs = [record.runs]
    if (Array.isArray(record.runs)) {
      record.runs = record.runs.map((run: unknown) => {
        if (typeof run === 'string' || typeof run === 'number') return { text: String(run) }
        if (isPlainObject(run)) {
          const r = { ...run }
          if (r.text !== undefined) r.text = coerceText(r.text)
          return r
        }
        return run
      })
    }
  }

  const hasRuns = Array.isArray(record.runs) && (record.runs as unknown[]).length > 0 &&
    (record.runs as Array<{ text?: unknown }>).some(r => typeof r.text === 'string' && r.text !== '')
  const hasText = typeof record.text === 'string' && record.text !== ''
  if (!hasRuns && !hasText) return { paragraph: null, repaired: false }
  return { paragraph: record, repaired: true }
}

/** 元素可识别标记：出现任一即视为真实元素（否则视为传输噪声）。 */
const ELEMENT_MARKERS = ['kind', 'id', 'text', 'paragraphs', 'shape', 'rows', 'chartType', 'assetId', 'placeholder', 'x', 'y', 'w', 'h'] as const

/** 归一单个元素：修键、text 扁平写法展开、段落归一。 */
function normalizeElement(raw: unknown): { element: Record<string, unknown> | null; repaired: boolean; noise: boolean } {
  const element = deepRepair(raw)
  if (element === null || typeof element !== 'object' || Array.isArray(element)) return { element: null, repaired: false, noise: false }
  const record = element as Record<string, unknown>
  let repaired = false

  // 无 kind 且没有任何可识别标记 → 传输噪声（如修复后仅剩 {color:"#38BDF8"}），丢弃
  if (record.kind === undefined && !ELEMENT_MARKERS.some(key => record[key] !== undefined)) {
    return { element: null, repaired: true, noise: true }
  }

  if (record.kind === 'text') {
    // 扁平 text（无 paragraphs）→ 单段
    if (record.paragraphs === undefined && (typeof record.text === 'string' || typeof record.text === 'number')) {
      record.paragraphs = [{ text: coerceText(record.text) }]
      delete record.text
      repaired = true
    }
    // 缺省样式兜底：字号 16 / 中性深灰（浅色主题可读；repairs 会提示模型确认）
    if (record.fontSize === undefined) {
      record.fontSize = 16
      repaired = true
    }
    if (record.color === undefined) {
      record.color = '#334155'
      repaired = true
    }
    if (record.paragraphs !== undefined) {
      if (isPlainObject(record.paragraphs)) record.paragraphs = [record.paragraphs]
      if (Array.isArray(record.paragraphs)) {
        const normalized: Array<Record<string, unknown>> = []
        for (const para of record.paragraphs) {
          const result = normalizeParagraph(para)
          if (result.paragraph !== null) normalized.push(result.paragraph)
          else repaired = true
        }
        record.paragraphs = normalized
      }
    }
  }
  return { element: record, repaired, noise: false }
}

export interface NormalizeResult {
  scene: unknown
  /** 归一时做的修复说明（给模型看，便于自纠） */
  repairs: string[]
  /** 修复后仍无法识别的元素（附原文，报错用） */
  invalidElements: Array<{ index: number; raw: unknown }>
}

/**
 * 场景容错归一：只做形态修复，不做语义判断；语义校验仍归 zod / validate.ts。
 */
export function normalizeSceneInput(scene: unknown): NormalizeResult {
  const repairs: string[] = []
  const invalidElements: Array<{ index: number; raw: unknown }> = []
  if (scene === null || typeof scene !== 'object' || Array.isArray(scene)) return { scene, repairs, invalidElements }

  const repairCount = { n: 0 }
  const normalized = deepRepair(scene, repairCount) as Record<string, unknown>
  if (repairCount.n > 0) {
    repairs.push(`已自动修复 ${repairCount.n} 处传输形态问题（字符串数字/布尔转回原类型、{item:} 包装还原为数组）`)
  }

  // elements 语义数组（{item:} 包装 / 单对象已由 deepRepair 还原，这里兜底）
  if (normalized.elements !== undefined && isPlainObject(normalized.elements)) {
    normalized.elements = [normalized.elements]
    repairs.push('elements 原本是对象，已包装为单元素数组')
  }

  if (Array.isArray(normalized.elements)) {
    const elements: unknown[] = []
    normalized.elements.forEach((raw, index) => {
      const { element, repaired, noise } = normalizeElement(raw)
      if (element === null) {
        if (noise) {
          // 传输噪声（修复后无任何有效属性）：丢弃并记录
          repairs.push(`elements[${index}] 是传输噪声（无 kind 与内容，如 {"color=#xxx":""}），已丢弃`)
          return
        }
        invalidElements.push({ index, raw })
        elements.push(raw) // 保留原样，交给 zod 报错（报错信息会附原文）
        return
      }
      if (repaired) repairs.push(`elements[${index}]（${String(element.id ?? '?')}）存在写法问题，已自动修复`)
      elements.push(element)
    })
    normalized.elements = elements
  }
  return { scene: normalized, repairs, invalidElements }
}

/**
 * 深度清洗返回值：删除值为 undefined 的键（DSH 宿主要求工具输出可无损 JSON 化）。
 * 返回处理后的值（原对象不被修改）。
 */
export function lossless<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => (item === undefined ? null : lossless(item))) as unknown as T
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue
      result[key] = lossless(item)
    }
    return result as unknown as T
  }
  return value
}

/** 把出错元素的原文截断成可读 JSON 文本。 */
export function previewJson(value: unknown, max = 300): string {
  try {
    const text = JSON.stringify(value)
    return text.length <= max ? text : text.slice(0, max) + '…'
  } catch {
    return String(value).slice(0, max)
  }
}

/**
 * 清洗模型生成的 SVG（0.13.0，无生图接口时的配图路径）：内联进 HTML 预览前必须剥掉
 * 可执行内容——script 块、事件属性（onload=…）、foreignObject/iframe/embed、javascript: 链接。
 */
export function sanitizeSvg(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<\/?(?:foreignObject|iframe|embed|object|use)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/((?:xlink:)?href)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1=$2#$2')
}

/**
 * SVG 根标签归一（供 svg 图片元素使用）：保证有 viewBox（缺省时从 width/height 属性推，
 * 再缺省用 560×460 图区比例），并剥掉根标签的 width/height——渲染端用容器尺寸控制显示，
 * 避免固定宽高的 svg 在框内溢出。返回 { svg, width, height }；无 <svg 根标签返回 null。
 */
export function normalizeSvgRoot(text: string): { svg: string; width: number; height: number } | null {
  const open = /<svg\b([^>]*)>/i.exec(text)
  if (open === null) return null
  const attrs = open[1]!
  const num = (name: string): number | undefined => {
    const m = new RegExp(`${name}\\s*=\\s*["']\\s*([\\d.]+)\\s*["']`, 'i').exec(attrs)
    return m !== null ? Number(m[1]) : undefined
  }
  let width = num('width')
  let height = num('height')
  const viewBox = /viewBox\s*=\s*["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)\s*["']/i.exec(attrs)
  if (viewBox !== null) {
    width = Number(viewBox[3])
    height = Number(viewBox[4])
  }
  if (width === undefined || height === undefined || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    width = 560
    height = 460
  }
  // 重写根标签：只留原属性里除 width/height 外的部分，补 viewBox（已有则保留原值）
  const keptAttrs = attrs
    .replace(/\s(?:width|height)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s*$/, '')
  const viewBoxAttr = viewBox !== null ? ` viewBox="${viewBox[0].replace(/^viewBox\s*=\s*["']|["']$/g, '')}"` : ` viewBox="0 0 ${width} ${height}"`
  const root = `<svg${keptAttrs}${viewBoxAttr}>`
  return { svg: text.replace(open[0], root), width, height }
}
