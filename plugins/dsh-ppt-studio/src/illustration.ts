/**
 * 图示 JSON → 确定性 SVG 渲染（0.17.0，content.image.illustration）。
 *
 * 动机（真实事故 d20260922-225312 seq156）：模型手写 image.svg 源码出现
 * `</svg viewBox=…>` 类标签笔误，JSON 解析失败连带三次重试。把"画图"升级为
 * "描述图"——模型只给节点与类型，代码用锁定令牌渲染：标签错误整类消失、
 * 颜色天然守锁、一册插图风格强制统一。
 *
 * 词表（0.22.x 起 8 种）：flow（顺序/接力流程）| layers（层级/堆叠架构）|
 * venn（2-3 集合交集）| matrix（2×2 四象限，4 节点）| tree（根 + 单层子树）|
 * pyramid（金字塔，nodes[0]=顶层）| funnel（漏斗，上宽下窄）| cycle（循环，节点环形接力）。
 * 产物是普通 SVG 字符串，走既有 image.svg 嵌入链路（HTML 内联 + PPTX 矢量嵌入 + viewBox 比例适配）。
 */
import type { DesignTokens } from './schema.js'

export const ILLUSTRATION_KINDS = ['flow', 'layers', 'venn', 'matrix', 'tree', 'pyramid', 'funnel', 'cycle'] as const
export type IllustrationKind = (typeof ILLUSTRATION_KINDS)[number]

export interface IllustrationNode {
  label: string
  sub?: string
}

export interface IllustrationInput {
  kind: IllustrationKind
  title?: string
  nodes: IllustrationNode[]
}

const esc = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

const FONT = 'Microsoft YaHei'

function box(x: number, y: number, w: number, h: number, fill: string, stroke: string): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`
}

function label(x: number, y: number, w: number, text: string, fill: string, size: number, weight = 600): string {
  return `<text x="${x + w / 2}" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(text)}</text>`
}

function arrowRight(x1: number, y: number, x2: number, color: string): string {
  return `<line x1="${x1}" y1="${y}" x2="${x2 - 8}" y2="${y}" stroke="${color}" stroke-width="3"/>` +
    `<polygon points="${x2},${y} ${x2 - 10},${y - 5} ${x2 - 10},${y + 5}" fill="${color}"/>`
}

function arrowDown(x: number, y1: number, y2: number, color: string): string {
  return `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2 - 8}" stroke="${color}" stroke-width="3"/>` +
    `<polygon points="${x},${y2} ${x - 5},${y2 - 10} ${x + 5},${y2 - 10}" fill="${color}"/>`
}

/** flow：横向接力流程（>4 节点自动换行，行间向下箭头）。 */
function renderFlow(ill: IllustrationInput, tokens: DesignTokens): string {
  const c = tokens.colors
  const parts: string[] = []
  let top = 24
  if (ill.title !== undefined && ill.title !== '') {
    parts.push(label(20, 36, 520, ill.title, c.text, 20, 700))
    top = 60
  }
  const nodes = ill.nodes.slice(0, 6)
  const n = nodes.length
  const cols = n <= 4 ? n : 3
  const rows = Math.ceil(n / cols)
  const gapX = 28
  const gapY = 56
  const boxW = (520 - (cols - 1) * gapX) / cols
  const boxH = 86
  const rowH = boxH + gapY
  const svgH = Math.max(200, top + rows * rowH + 20)
  nodes.forEach((node, i) => {
    const row = Math.floor(i / cols)
    const col = i % cols
    const x = 20 + col * (boxW + gapX)
    const y = top + row * rowH + Math.max(0, (Math.max(rows - 1, 0) * 0))
    const isRowEnd = col === cols - 1 || i === n - 1
    const fill = i === 0 ? c.primary : c.surface
    const stroke = i === 0 ? c.primary : c.secondary
    parts.push(box(x, y, boxW, boxH, fill, stroke))
    const textColor = i === 0 ? c.onPrimary : c.text
    parts.push(label(x, y + 36, boxW, node.label.slice(0, 24), textColor, 17))
    if (node.sub !== undefined && node.sub !== '') {
      parts.push(label(x, y + 60, boxW, node.sub.slice(0, 40), i === 0 ? c.onPrimary : c.textMuted, 12, 400))
    }
    if (!isRowEnd) {
      parts.push(arrowRight(x + boxW, y + boxH / 2, x + boxW + gapX, c.secondary))
    } else if (row < rows - 1 && i < n - 1) {
      parts.push(arrowDown(x + boxW / 2, y + boxH, y + boxH + gapY, c.secondary))
    }
  })
  return `<svg viewBox="0 0 560 ${svgH}" xmlns="http://www.w3.org/2000/svg"><rect width="560" height="${svgH}" fill="${c.bg}"/>${parts.join('')}</svg>`
}

/** layers：自上而下层级堆叠（节点顺序 = 上→下；宽度逐层放大，配色按层循环）。 */
function renderLayers(ill: IllustrationInput, tokens: DesignTokens): string {
  const c = tokens.colors
  const parts: string[] = []
  let top = 24
  if (ill.title !== undefined && ill.title !== '') {
    parts.push(label(20, 36, 520, ill.title, c.text, 20, 700))
    top = 60
  }
  const nodes = ill.nodes.slice(0, 6)
  const n = nodes.length
  const barH = 62
  const gapY = 16
  const layerColors = [c.primary, c.secondary]
  nodes.forEach((node, i) => {
    const w = 240 + (i * 280) / Math.max(n - 1, 1)
    const x = (560 - w) / 2
    const y = top + i * (barH + gapY)
    const fill = layerColors[i % layerColors.length]
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${barH}" rx="8" fill="${fill}"/>`)
    parts.push(label(x, y + 28, w, node.label.slice(0, 24), c.onPrimary, 17))
    if (node.sub !== undefined && node.sub !== '') {
      parts.push(label(x, y + 48, w, node.sub.slice(0, 40), c.onPrimary, 11, 400))
    }
  })
  const svgH = top + n * (barH + gapY) + 16
  return `<svg viewBox="0 0 560 ${svgH}" xmlns="http://www.w3.org/2000/svg"><rect width="560" height="${svgH}" fill="${c.bg}"/>${parts.join('')}</svg>`
}

/**
 * venn（0.20.0）：2-3 个集合的交集图。圆片半透明叠加（重叠区天然可辨），
 * 集合名放在各自圆的外侧象限（避开重叠区），sub 作该集合的一行说明。
 * 语义：交集含义写在页面正文/heading 里，图只承担"集合与重叠"的形状。
 */
function renderVenn(ill: IllustrationInput, tokens: DesignTokens): string {
  const c = tokens.colors
  const parts: string[] = []
  let top = 24
  if (ill.title !== undefined && ill.title !== '') {
    parts.push(label(20, 36, 520, ill.title, c.text, 20, 700))
    top = 56
  }
  const nodes = ill.nodes.slice(0, 3)
  const n = nodes.length
  const r = 104
  const palette = [c.primary, c.secondary, c.accent]
  // 双圆：水平排布；三圆：经典三叶草（下圆压底）
  const centers = n === 3
    ? [{ x: 196, y: top + 128 }, { x: 316, y: top + 128 }, { x: 256, y: top + 226 }]
    : [{ x: 186, y: top + 150 }, { x: 326, y: top + 150 }]
  const svgH = top + 226 + r + 44
  nodes.forEach((node, i) => {
    const { x, y } = centers[i]
    parts.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${palette[i]}" fill-opacity="0.30" stroke="${palette[i]}" stroke-width="2.5"/>`)
  })
  // 集合名置圆外上方（视觉评估修正：初版左右名落进圆内压到圆周描边）——
  // 名字/说明的基线必须高于圆顶（双圆 y=top+150-104、三圆 y=top+128-104），
  // 且锚点到圆心距离 > r（贴边但不入圆）
  const namePos = n === 3
    ? [{ x: 96, y: top + 12 }, { x: 464, y: top + 12 }, { x: 280, y: svgH - 30 }]
    : [{ x: 150, y: top + 16 }, { x: 410, y: top + 16 }]
  nodes.forEach((node, i) => {
    const p = namePos[i]
    parts.push(label(p.x - 80, p.y, 160, node.label.slice(0, 16), palette[i], 16))
    if (node.sub !== undefined && node.sub !== '') {
      parts.push(label(p.x - 60, p.y + 18, 120, node.sub.slice(0, 10), c.textMuted, 11, 400))
    }
  })
  return `<svg viewBox="0 0 560 ${svgH}" xmlns="http://www.w3.org/2000/svg"><rect width="560" height="${svgH}" fill="${c.bg}"/>${parts.join('')}</svg>`
}

/**
 * matrix（0.20.0）：2×2 四象限（nodes 恰好 4 个：左上→右上→左下→右下）。
 * 卡片统一 surface 底 + secondary 描边（编辑式克制），象限题用三色 + 正文色区分，
 * sub 为一行说明。轴维度含义模型写在各象限 label/sub 里（词表不引入轴字段）。
 */
function renderMatrix(ill: IllustrationInput, tokens: DesignTokens): string {
  const c = tokens.colors
  const parts: string[] = []
  let top = 24
  if (ill.title !== undefined && ill.title !== '') {
    parts.push(label(20, 36, 520, ill.title, c.text, 20, 700))
    top = 56
  }
  const nodes = ill.nodes.slice(0, 4).map((node, i) => ({ label: node.label, sub: node.sub, quadrant: i }))
  const gap = 14
  const boxW = (520 - gap) / 2
  const boxH = 138
  const titleColors = [c.primary, c.secondary, c.accent, c.text]
  nodes.forEach((node, i) => {
    const x = 20 + (i % 2) * (boxW + gap)
    const y = top + Math.floor(i / 2) * (boxH + gap)
    parts.push(box(x, y, boxW, boxH, c.surface, c.secondary))
    parts.push(label(x, y + 34, boxW, node.label.slice(0, 20), titleColors[i], 16))
    if (node.sub !== undefined && node.sub !== '') {
      parts.push(label(x, y + 66, boxW, node.sub.slice(0, 34), c.textMuted, 12, 400))
    }
  })
  const svgH = top + 2 * boxH + gap + 16
  return `<svg viewBox="0 0 560 ${svgH}" xmlns="http://www.w3.org/2000/svg"><rect width="560" height="${svgH}" fill="${c.bg}"/>${parts.join('')}</svg>`
}

/**
 * tree（0.20.0）：根 + 子树单层（nodes[0] 为根，其余为子节点，≤5）。
 * 连接线为"竖线 → 横母线 → 竖线"肘形（确定性几何，不依赖节点文本长度）。
 */
function renderTree(ill: IllustrationInput, tokens: DesignTokens): string {
  const c = tokens.colors
  const parts: string[] = []
  let top = 24
  if (ill.title !== undefined && ill.title !== '') {
    parts.push(label(20, 36, 520, ill.title, c.text, 20, 700))
    top = 56
  }
  const nodes = ill.nodes.slice(0, 6)
  const root = nodes[0]
  const children = nodes.slice(1, 6)
  const rootW = 300
  const rootH = root.sub !== undefined && root.sub !== '' ? 74 : 58
  const rootX = (560 - rootW) / 2
  parts.push(box(rootX, top, rootW, rootH, c.primary, c.primary))
  parts.push(label(rootX, top + (rootH - 12) / 2 + 4, rootW, root.label.slice(0, 20), c.onPrimary, 17))
  if (root.sub !== undefined && root.sub !== '') {
    parts.push(label(rootX, top + rootH - 14, rootW, root.sub.slice(0, 36), c.onPrimary, 11, 400))
  }
  const busY = top + rootH + 26
  const childTop = busY + 26
  const childH = 64
  const gapX = 14
  const childW = children.length > 0 ? (520 - (children.length - 1) * gapX) / children.length : 0
  const centers = children.map((_, i) => 20 + i * (childW + gapX) + childW / 2)
  if (children.length > 0) {
    // 竖线（根底 → 母线）+ 母线（首子中心 → 末子中心）+ 各子竖线（母线 → 子顶）
    const rootCx = 280
    const first = centers[0]
    const last = centers[centers.length - 1]
    parts.push(`<line x1="${rootCx}" y1="${top + rootH}" x2="${rootCx}" y2="${busY}" stroke="${c.secondary}" stroke-width="2.5"/>`)
    parts.push(`<line x1="${first}" y1="${busY}" x2="${last}" y2="${busY}" stroke="${c.secondary}" stroke-width="2.5"/>`)
    if (centers.length === 1) {
      parts.push(`<line x1="${rootCx}" y1="${busY}" x2="${rootCx}" y2="${childTop}" stroke="${c.secondary}" stroke-width="2.5"/>`)
    }
    centers.forEach((cx) => {
      parts.push(`<line x1="${cx}" y1="${busY}" x2="${cx}" y2="${childTop}" stroke="${c.secondary}" stroke-width="2.5"/>`)
    })
  }
  children.forEach((node, i) => {
    const x = 20 + i * (childW + gapX)
    parts.push(box(x, childTop, childW, childH, c.surface, c.secondary))
    const textW = childW - 8
    parts.push(label(x + 4, childTop + childH / 2 - (node.sub !== undefined && node.sub !== '' ? 4 : -6), textW, node.label.slice(0, 12), c.text, children.length > 4 ? 13 : 15))
    if (node.sub !== undefined && node.sub !== '') {
      parts.push(label(x + 4, childTop + childH / 2 + 18, textW, node.sub.slice(0, 16), c.textMuted, 10, 400))
    }
  })
  const svgH = childTop + childH + 16
  return `<svg viewBox="0 0 560 ${svgH}" xmlns="http://www.w3.org/2000/svg"><rect width="560" height="${svgH}" fill="${c.bg}"/>${parts.join('')}</svg>`
}

/** 主入口：图示 JSON → SVG 源码（viewBox 宽 560，高按内容自适应）。 */
export function renderIllustration(ill: IllustrationInput, tokens: DesignTokens): string {
  if (ill.kind === 'layers') return renderLayers(ill, tokens)
  if (ill.kind === 'venn') return renderVenn(ill, tokens)
  if (ill.kind === 'matrix') return renderMatrix(ill, tokens)
  if (ill.kind === 'tree') return renderTree(ill, tokens)
  if (ill.kind === 'pyramid') return renderPyramid(ill, tokens)
  if (ill.kind === 'funnel') return renderFunnel(ill, tokens)
  if (ill.kind === 'cycle') return renderCycle(ill, tokens)
  return renderFlow(ill, tokens)
}

// ---------------------------------------------------------------- 0.22.x 扩充：pyramid / funnel / cycle

/** 主题色阶深→浅梯度（tints 缺失时回落 primary/secondary 交替）。 */
function tintLadder(tokens: DesignTokens, depth: number): string[] {
  const tints = tokens.tints?.primary
  if (tints !== undefined) {
    const keys = ['700', '600', '400', '300', '200', '100'] as const
    return Array.from({ length: depth }, (_, i) => tints[keys[i % keys.length]])
  }
  return Array.from({ length: depth }, (_, i) => (i % 2 === 0 ? tokens.colors.primary : tokens.colors.secondary))
}

/** tint 400 及更浅上用深色文字，600 及更深上用 onPrimary（确定性，不做逐色亮度计算）。 */
function inkOn(fill: string, tokens: DesignTokens): string {
  const tints = tokens.tints?.primary
  if (tints === undefined) return tokens.colors.onPrimary
  return fill === tints['700'] || fill === tints['600'] ? tokens.colors.onPrimary : tokens.colors.text
}

/**
 * pyramid（0.22.x）：金字塔（nodes[0]=顶层，3-5 层）。塔身居左（只放层号，窄顶层也放得下），
 * 标签列居右随层对齐 + 引导线——顶层宽度不足以容纳文字，文入塔内必溢出（venn 同款教训的预防）。
 * 层色自顶向下 primary 色阶由深到浅。
 */
function renderPyramid(ill: IllustrationInput, tokens: DesignTokens): string {
  const c = tokens.colors
  const parts: string[] = []
  let top = 24
  if (ill.title !== undefined && ill.title !== '') {
    parts.push(label(20, 36, 520, ill.title, c.text, 20, 700))
    top = 56
  }
  const nodes = ill.nodes.slice(0, 5)
  const n = nodes.length
  const bandH = 62
  const gapY = 8
  const cx = 168
  const wTop = 56
  const wBottom = 296
  const ladder = tintLadder(tokens, n)
  nodes.forEach((node, i) => {
    const topW = wTop + ((wBottom - wTop) * i) / n
    const botW = wTop + ((wBottom - wTop) * (i + 1)) / n
    const y = top + i * (bandH + gapY)
    const y2 = y + bandH
    const fill = ladder[i]!
    const half = (topW + botW) / 4
    parts.push(`<polygon points="${cx - topW / 2},${y} ${cx + topW / 2},${y} ${cx + botW / 2},${y2} ${cx - botW / 2},${y2}" fill="${fill}"/>`)
    parts.push(`<text x="${cx}" y="${y + bandH / 2 + 6}" text-anchor="middle" font-family="${FONT}" font-size="17" font-weight="700" fill="${inkOn(fill, tokens)}">${String(i + 1)}</text>`)
    // 右侧标签列：引导线（层右缘中点 → 标签列）+ 层名 + 可选说明
    const midY = y + bandH / 2
    const leadX = cx + half
    parts.push(`<line x1="${leadX}" y1="${midY}" x2="352" y2="${midY}" stroke="${c.textMuted}" stroke-width="1.5" stroke-dasharray="3 3"/>`)
    parts.push(`<circle cx="356" cy="${midY}" r="3" fill="${fill}"/>`)
    parts.push(label(364, midY + 1, 180, node.label.slice(0, 12), c.text, 15))
    if (node.sub !== undefined && node.sub !== '') {
      parts.push(label(364, midY + 19, 180, node.sub.slice(0, 16), c.textMuted, 11, 400))
    }
  })
  const svgH = top + n * (bandH + gapY) + 12
  return `<svg viewBox="0 0 560 ${svgH}" xmlns="http://www.w3.org/2000/svg"><rect width="560" height="${svgH}" fill="${c.bg}"/>${parts.join('')}</svg>`
}

/**
 * funnel（0.22.x）：漏斗（3-6 段，上宽下窄）。横向条带足够容纳文字，label/sub 入带内居中；
 * 段色自顶向下 primary 色阶由深到浅（转化漏斗的量级递减语义）。
 */
function renderFunnel(ill: IllustrationInput, tokens: DesignTokens): string {
  const c = tokens.colors
  const parts: string[] = []
  let top = 24
  if (ill.title !== undefined && ill.title !== '') {
    parts.push(label(20, 36, 520, ill.title, c.text, 20, 700))
    top = 56
  }
  const nodes = ill.nodes.slice(0, 6)
  const n = nodes.length
  const bandH = 60
  const gapY = 8
  const wFirst = 480
  const wLast = 224
  const ladder = tintLadder(tokens, n)
  nodes.forEach((node, i) => {
    const topW = n === 1 ? wFirst : wFirst + ((wLast - wFirst) * i) / (n - 1)
    const botW = n === 1 ? wFirst : wFirst + ((wLast - wFirst) * (i + 1)) / n
    const w = (topW + botW) / 2
    const y = top + i * (bandH + gapY)
    const y2 = y + bandH
    const x = (560 - w) / 2
    const fill = ladder[i]!
    const ink = inkOn(fill, tokens)
    parts.push(`<polygon points="${x},${y} ${x + w},${y} ${x + w - (botW - topW) / 2},${y2} ${x + (botW - topW) / 2},${y2}" fill="${fill}"/>`)
    const hasSub = node.sub !== undefined && node.sub !== ''
    parts.push(label(x, y + (hasSub ? bandH / 2 - 2 : bandH / 2 + 6), w, node.label.slice(0, 14), ink, 16))
    if (node.sub !== undefined && node.sub !== '') {
      parts.push(label(x, y + bandH / 2 + 18, w, node.sub.slice(0, 18), ink, 11, 400))
    }
  })
  const svgH = top + n * (bandH + gapY) + 12
  return `<svg viewBox="0 0 560 ${svgH}" xmlns="http://www.w3.org/2000/svg"><rect width="560" height="${svgH}" fill="${c.bg}"/>${parts.join('')}</svg>`
}

/**
 * cycle（0.22.x）：循环（2-6 节点环形接力）。节点为环上圆徽章（内放序号），
 * 标签沿径向放在环外（右起点/左终点/上下居中四种锚定——venn 教训：文字不压形状）；
 * 节点间沿环画顺时针弧线箭头。标签上限 8 字（环外径向空间有限，SKILL 已注明）。
 */
function renderCycle(ill: IllustrationInput, tokens: DesignTokens): string {
  const c = tokens.colors
  const parts: string[] = []
  let top = 24
  if (ill.title !== undefined && ill.title !== '') {
    parts.push(label(20, 36, 520, ill.title, c.text, 20, 700))
    top = 52
  }
  const nodes = ill.nodes.slice(0, 6)
  const n = nodes.length
  const cx = 280
  const R = 112
  const nodeR = 28
  const labelDist = 44
  const cy = top + R + nodeR + 24
  const palette = [c.primary, c.secondary, c.accent]
  const angleOf = (i: number): number => (-90 + (360 * i) / n) * (Math.PI / 180)
  // 节点间弧线箭头（避开两端节点各 ~20°）
  const pad = (20 * Math.PI) / 180
  const arcStep = (2 * Math.PI) / n
  for (let i = 0; i < n; i++) {
    const a1 = angleOf(i) + pad
    const a2 = angleOf((i + 1) % n) - pad + (i === n - 1 ? 2 * Math.PI : 0)
    const x1 = cx + R * Math.cos(a1)
    const y1 = cy + R * Math.sin(a1)
    const x2 = cx + R * Math.cos(a2)
    const y2 = cy + R * Math.sin(a2)
    parts.push(`<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${R} ${R} 0 ${(a2 - a1 > Math.PI ? 1 : 0).toString()} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="${c.secondary}" stroke-width="3"/>`)
    // 箭头：终点切线方向（顺时针 = 角度增大方向）的三角形
    const tangent = a2 + Math.PI / 2
    const tipX = cx + R * Math.cos(a2)
    const tipY = cy + R * Math.sin(a2)
    const back = 11
    const wing = 5.5
    parts.push(`<polygon points="${tipX},${tipY} ${tipX - back * Math.cos(tangent) + wing * Math.sin(tangent)},${tipY - back * Math.sin(tangent) - wing * Math.cos(tangent)} ${tipX - back * Math.cos(tangent) - wing * Math.sin(tangent)},${tipY - back * Math.sin(tangent) + wing * Math.cos(tangent)}" fill="${c.secondary}"/>`)
  }
  nodes.forEach((node, i) => {
    const a = angleOf(i)
    const nx = cx + R * Math.cos(a)
    const ny = cy + R * Math.sin(a)
    const fill = palette[i % palette.length]
    parts.push(`<circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="${nodeR}" fill="${fill}" stroke="${c.bg}" stroke-width="3"/>`)
    parts.push(`<text x="${nx.toFixed(1)}" y="${(ny + 6).toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="700" fill="${c.onPrimary}">${String(i + 1)}</text>`)
    // 标签：径向环外；按象限选锚定方式，防相邻标签互压与出画布
    const lx = cx + (R + labelDist) * Math.cos(a)
    const ly = cy + (R + labelDist) * Math.sin(a)
    const cosA = Math.cos(a)
    const sinA = Math.sin(a)
    const anchor = cosA > 0.35 ? 'start' : cosA < -0.35 ? 'end' : 'middle'
    const text = node.label.slice(0, 8)
    const dy = sinA > 0.35 ? 14 : sinA < -0.35 ? -8 : -2
    parts.push(`<text x="${lx.toFixed(1)}" y="${(ly + dy).toFixed(1)}" text-anchor="${anchor}" font-family="${FONT}" font-size="14" font-weight="600" fill="${c.text}">${esc(text)}</text>`)
    if (node.sub !== undefined && node.sub !== '') {
      parts.push(`<text x="${lx.toFixed(1)}" y="${(ly + dy + 16).toFixed(1)}" text-anchor="${anchor}" font-family="${FONT}" font-size="11" font-weight="400" fill="${c.textMuted}">${esc(node.sub.slice(0, 10))}</text>`)
    }
  })
  const svgH = cy + R + nodeR + 44
  return `<svg viewBox="0 0 560 ${svgH}" xmlns="http://www.w3.org/2000/svg"><rect width="560" height="${svgH}" fill="${c.bg}"/>${parts.join('')}</svg>`
}
