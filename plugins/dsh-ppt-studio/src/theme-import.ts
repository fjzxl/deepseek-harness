/**
 * 外部 PPTX 主题导入（0.21.0 P2，roadmap-aippt-borrowing）：解包 ppt/theme/themeN.xml，
 * 抽取 clrScheme（12 语义色）与 fontScheme（major/minor）→ 派生 paletteOverrides 建议。
 *
 * 与 0.18.0 品牌取色互补：那是"从品牌图提色"，这是"从既有 PPT 模板提整套主题"
 * （吃掉存量模板的路）。只建议不代用——用户在 ppt_design_lock 表态。
 * 零依赖自研解析（AiPPT 的 ppt2json 闭源；本文件只做 clrScheme/fontScheme 的正则抽取）。
 */
import { unzipSync } from 'fflate'
import { rgbDistance, hexToRgb, shiftTone, rotateHue, luminanceOf } from './color-extract.js'

export interface PptxThemeExtract {
  /** 实际读取的主题文件（theme1.xml/2/…，取第一个存在的） */
  themeFile: string
  /** clrScheme 语义色 → #RRGGBB（dk1/lt1/dk2/lt2/accent1-6/hlink/folHlink 中存在的） */
  clrScheme: Record<string, string>
  fonts: { majorLatin?: string; majorEa?: string; minorLatin?: string; minorEa?: string }
}

const THEME_KEYS = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'] as const

const norm = (hex: string): string => '#' + hex.toUpperCase()

/**
 * 解包并抽取 PPTX 主题。非 PPTX（缺 [Content_Types].xml 或无 theme 文件）返回 undefined。
 */
export function extractPptxTheme(buffer: Buffer): PptxThemeExtract | undefined {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(new Uint8Array(buffer))
  } catch {
    return undefined
  }
  if (files['[Content_Types].xml'] === undefined) return undefined
  const themeNames = Object.keys(files)
    .filter(name => /^ppt\/theme\/theme\d+\.xml$/.test(name))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]))
  if (themeNames.length === 0) return undefined
  const xml = Buffer.from(files[themeNames[0]]!).toString('utf8')

  const clrScheme: Record<string, string> = {}
  for (const key of THEME_KEYS) {
    const block = new RegExp(`<a:${key}>([\\s\\S]*?)</a:${key}>`).exec(xml)
    if (block === null) continue
    const srgb = /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(block[1])
    const sys = /<a:sysClr[^>]*lastClr="([0-9A-Fa-f]{6})"/.exec(block[1])
    if (srgb !== null) clrScheme[key] = norm(srgb[1]!)
    else if (sys !== null) clrScheme[key] = norm(sys[1]!)
  }
  if (Object.keys(clrScheme).length < 3) return undefined

  const typeface = (fontBlock: string, kind: 'latin' | 'ea'): string | undefined => {
    const m = new RegExp(`<a:${kind}[^>]*typeface="([^"]+)"`).exec(fontBlock)
    if (m === null) return undefined
    const name = m[1]!.trim()
    // "+mn-lt" 等主题占位名不是真实字体
    return name === '' || name.startsWith('+') ? undefined : name
  }
  const major = /<a:majorFont>([\s\S]*?)<\/a:majorFont>/.exec(xml)
  const minor = /<a:minorFont>([\s\S]*?)<\/a:minorFont>/.exec(xml)
  const fonts = {
    ...(major !== null ? { majorLatin: typeface(major[1], 'latin'), majorEa: typeface(major[1], 'ea') } : {}),
    ...(minor !== null ? { minorLatin: typeface(minor[1], 'latin'), minorEa: typeface(minor[1], 'ea') } : {}),
  }

  return { themeFile: themeNames[0]!, clrScheme, fonts }
}

export interface ImportedThemeSuggestion {
  paletteOverrides: { primary: string; secondary: string; accent: string; bg: string; surface: string; text: string; textMuted: string; onPrimary: string }
  fonts?: { title: string; body: string }
  dark: boolean
  notes: string[]
}

function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  const ch = (x: number, y: number): string => Math.round(x + (y - x) * t).toString(16).padStart(2, '0').toUpperCase()
  return `#${ch(ar, br)}${ch(ag, bg)}${ch(ab, bb)}`
}

/**
 * 抽取结果 → 完整 8 色板 + 字体建议（确定性）。
 * primary=accent1（过亮/过黑时回退 dk2→accent2）；secondary=accent2（与主色过近时明暗派生）；
 * accent=accent3-6 中与主/辅色距最大且 ≥70 者，否则色相旋转 165°。
 */
export function suggestImportedTheme(ex: PptxThemeExtract): ImportedThemeSuggestion {
  const c = ex.clrScheme
  const notes: string[] = []
  const lum = (hex: string | undefined): number => (hex !== undefined ? luminanceOf(...hexToRgb(hex)) : 1)

  const bg = c.lt1 ?? '#FFFFFF'
  const text = c.dk1 ?? (lum(bg) > 0.4 ? '#111111' : '#F5F5F5')
  const dark = lum(bg) < 0.4

  let primary = c.accent1
  if (primary === undefined || lum(primary) > 0.7 || lum(primary) < 0.05) {
    primary = c.dk2 !== undefined && !(lum(c.dk2) > 0.7 || lum(c.dk2) < 0.05) ? c.dk2 : c.accent2
    notes.push(`accent1 过${lum(c.accent1) > 0.7 ? '亮' : '黑'}，primary 回退 ${primary !== undefined ? 'dk2/accent2' : '默认'}`)
  }
  if (primary === undefined) primary = dark ? '#D9B56A' : '#173A66'

  const primaryLight = lum(primary) > 0.5
  let secondary = c.accent2
  if (secondary === undefined || secondary === primary || rgbDistance(hexToRgb(primary), hexToRgb(secondary)) < 70) {
    secondary = shiftTone(primary, primaryLight ? false : true, 0.28)
    notes.push('accent2 缺失或与 accent1 过近，secondary 由主色明暗派生')
  }

  let accent: string | undefined
  let accentDist = 0
  for (const key of ['accent3', 'accent4', 'accent5', 'accent6'] as const) {
    const candidate = c[key]
    if (candidate === undefined) continue
    const dist = Math.min(rgbDistance(hexToRgb(primary), hexToRgb(candidate)), rgbDistance(hexToRgb(secondary), hexToRgb(candidate)))
    if (dist > accentDist) { accentDist = dist; accent = candidate }
  }
  if (accent === undefined || accentDist < 70) {
    accent = rotateHue(primary, 165)
    notes.push('accent3-6 无与主/辅色拉开距离的色，accent 由主色色相旋转派生')
  }

  const onPrimary = lum(primary) > 0.4 ? '#14161A' : '#FFFFFF'
  const surface = dark ? mixHex(bg, '#FFFFFF', 0.08) : '#FFFFFF'
  const textMuted = mixHex(text, bg, 0.45)

  const titleFont = ex.fonts.majorEa ?? ex.fonts.majorLatin
  const bodyFont = ex.fonts.minorEa ?? ex.fonts.minorLatin
  const fonts = titleFont !== undefined && bodyFont !== undefined ? { title: titleFont, body: bodyFont } : undefined

  return {
    paletteOverrides: {
      primary, secondary, accent,
      bg, surface, text, textMuted, onPrimary,
    },
    ...(fonts !== undefined ? { fonts } : {}),
    dark,
    notes,
  }
}
