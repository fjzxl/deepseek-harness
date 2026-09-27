/**
 * 品牌图取色（0.18.0，roadmap-aippt-borrowing P5）：登记资产时提取主色，
 * 派生一组 paletteOverrides 候选供 design_lock 选择。
 *
 * 思想来自 AiPPT calcSubjectColor（图片出现频率最高的 3 个非黑白颜色），
 * 实现为纯本地零依赖：PNG（含调色板/灰度/带 alpha）与 BMP 解码采样 +
 * SVG 源码 hex 收集；JPEG/WebP/GIF 暂不支持（返回说明，不阻断登记）。
 * 确定性：同一图片永远得到同一组颜色（无随机、无顺序依赖）。
 */
import { inflateSync } from 'node:zlib'

export interface ExtractResult {
  /** 出现频率最高的 ≤3 个品牌色（#RRGGBB 大写；无有效颜色时为空数组） */
  colors: string[]
  /** 采样说明（不支持的格式/无有效像素等原因） */
  note?: string
}

// ---------------------------------------------------------------- 像素解码

interface Pixels {
  width: number
  height: number
  /** 每像素 3 字节 RGB */
  rgb: Uint8Array
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** 导出供离线验收脚本做像素断言（0.19.0 PPTX 渐变验收）。 */
export function decodePng(buffer: Buffer): Pixels | undefined {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIG)) return undefined
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = -1
  let interlace = 0
  const idat: Buffer[] = []
  let palette: Buffer | undefined
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]!
      colorType = data[9]!
      interlace = data[12]!
    } else if (type === 'PLTE') {
      palette = Buffer.from(data)
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data))
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  if (width <= 0 || height <= 0 || bitDepth !== 8 || interlace !== 0) return undefined
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0
  if (channels === 0 || width * height > 40_000_000) return undefined

  let raw: Buffer
  try {
    raw = inflateSync(Buffer.concat(idat))
  } catch {
    return undefined
  }
  const bpl = Math.ceil((width * channels * bitDepth) / 8)
  if (raw.length < (bpl + 1) * height) return undefined

  const rgb = new Uint8Array(width * height * 3)
  const prev = new Uint8Array(bpl)
  const line = new Uint8Array(bpl)
  const bpp = Math.max(1, channels)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (bpl + 1)]
    line.set(raw.subarray(y * (bpl + 1) + 1, y * (bpl + 1) + 1 + bpl))
    if (filter !== 0) unfilterLine(filter, line, prev, bpp)
    for (let x = 0; x < width; x++) {
      const i3 = (y * width + x) * 3
      if (colorType === 3) {
        const idx = line[x]! * 3
        if (palette === undefined || idx + 2 >= palette.length) return undefined
        rgb[i3] = palette[idx]!
        rgb[i3 + 1] = palette[idx + 1]!
        rgb[i3 + 2] = palette[idx + 2]!
      } else {
        const c0 = line[x * channels]!
        rgb[i3] = c0
        rgb[i3 + 1] = colorType === 0 || colorType === 4 ? c0 : line[x * channels + 1]!
        rgb[i3 + 2] = colorType === 0 || colorType === 4 ? c0 : line[x * channels + 2]!
      }
    }
    prev.set(line)
  }
  return { width, height, rgb }
}

function unfilterLine(filter: number, line: Uint8Array, prev: Uint8Array, bpp: number): void {
  if (filter === 1) {
    for (let i = bpp; i < line.length; i++) line[i] = (line[i]! + line[i - bpp]!) & 0xff
  } else if (filter === 2) {
    for (let i = 0; i < line.length; i++) line[i] = (line[i]! + prev[i]!) & 0xff
  } else if (filter === 3) {
    for (let i = 0; i < line.length; i++) line[i] = (line[i]! + ((i >= bpp ? line[i - bpp]! : 0) + prev[i]!) >> 1) & 0xff
  } else if (filter === 4) {
    for (let i = 0; i < line.length; i++) {
      const a = i >= bpp ? line[i - bpp]! : 0
      const b = prev[i]!
      const c = i >= bpp ? prev[i - bpp]! : 0
      const p = a + b - c
      const pa = Math.abs(p - a)
      const pb = Math.abs(p - b)
      const pc = Math.abs(p - c)
      const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      line[i] = (line[i]! + pred) & 0xff
    }
  }
}

function decodeBmp(buffer: Buffer): Pixels | undefined {
  if (buffer.length < 54 || buffer.toString('ascii', 0, 2) !== 'BM') return undefined
  const dataOffset = buffer.readUInt32LE(10)
  const headerSize = buffer.readUInt32LE(14)
  if (headerSize < 40) return undefined
  const width = buffer.readInt32LE(18)
  const rawHeight = buffer.readInt32LE(22)
  const height = Math.abs(rawHeight)
  const bpp = buffer.readUInt16LE(28)
  const compression = buffer.readUInt32LE(30)
  if (width <= 0 || height === 0 || (bpp !== 24 && bpp !== 32) || compression !== 0) return undefined
  const bytesPerPixel = bpp / 8
  const bpl = Math.floor((width * bpp + 31) / 32) * 4
  if (dataOffset + bpl * height > buffer.length) return undefined
  const rgb = new Uint8Array(width * height * 3)
  const bottomUp = rawHeight > 0
  for (let y = 0; y < height; y++) {
    const srcY = bottomUp ? height - 1 - y : y
    for (let x = 0; x < width; x++) {
      const si = dataOffset + srcY * bpl + x * bytesPerPixel
      const di = (y * width + x) * 3
      rgb[di] = buffer[si + 2]!
      rgb[di + 1] = buffer[si + 1]!
      rgb[di + 2] = buffer[si]!
    }
  }
  return { width, height, rgb }
}

function decodeSvgColors(source: string): string[] | undefined {
  const colors: string[] = []
  for (const match of source.matchAll(/(?:fill|stroke|color|stop-color)\s*=\s*"(#[0-9A-Fa-f]{6})"/g)) {
    colors.push(match[1]!.toUpperCase())
  }
  return colors
}

// ---------------------------------------------------------------- 主色聚类

const hex = (r: number, g: number, b: number): string =>
  `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`

export function luminanceOf(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/** RGB 欧氏距离（0-441）。 */
export function rgbDistance(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)
}

interface Bucket {
  count: number
  sumR: number
  sumG: number
  sumB: number
}

function pickDominant(samples: Array<readonly [number, number, number]>, maxColors: number): string[] {
  const buckets = new Map<number, Bucket>()
  for (const [r, g, b] of samples) {
    // 剔除近黑/近白/低饱和灰：品牌色信号之外的大面积底色
    if (Math.max(r, g, b) - Math.min(r, g, b) < 18) continue
    if (luminanceOf(r, g, b) > 0.94 || luminanceOf(r, g, b) < 0.06) continue
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const bucket = buckets.get(key) ?? { count: 0, sumR: 0, sumG: 0, sumB: 0 }
    bucket.count++
    bucket.sumR += r
    bucket.sumG += g
    bucket.sumB += b
    buckets.set(key, bucket)
  }
  const ranked = [...buckets.values()].sort((a, b) => b.count - a.count)
  const picked: Array<[number, number, number]> = []
  for (const bucket of ranked) {
    if (picked.length >= maxColors) break
    const avg: [number, number, number] = [bucket.sumR / bucket.count, bucket.sumG / bucket.count, bucket.sumB / bucket.count]
    // 与已选主色距离 <70 视为同色系，不重复占位
    if (picked.some(p => rgbDistance(p, avg) < 70)) continue
    picked.push(avg)
  }
  return picked.map(([r, g, b]) => hex(r, g, b))
}

/** 提取图片主色（≤3 个）。PNG/BMP 像素采样；SVG 收集源码色；其余格式返回说明。 */
export function extractDominantColors(buffer: Buffer, mime: string): ExtractResult {
  if (mime === 'image/svg+xml') {
    const colors = decodeSvgColors(buffer.toString('utf8'))
    if (colors === undefined || colors.length === 0) return { colors: [], note: 'SVG 源码中未找到 hex 颜色' }
    const counted = new Map<string, number>()
    for (const c of colors) counted.set(c, (counted.get(c) ?? 0) + 1)
    const samples = [...counted.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([c]) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)] as const)
    return { colors: pickDominant(samples, 3) }
  }
  const pixels = mime === 'image/png' ? decodePng(buffer) : mime === 'image/bmp' ? decodeBmp(buffer) : undefined
  if (pixels === undefined) {
    return { colors: [], note: mime === 'image/jpeg' || mime === 'image/webp' || mime === 'image/gif'
      ? `${mime} 暂不支持取色（当前支持 png / svg / bmp）`
      : '图片解码失败，未提取颜色' }
  }
  const { width, height, rgb } = pixels
  const total = width * height
  const step = Math.max(1, Math.floor(Math.sqrt(total / 40000)))
  const samples: Array<readonly [number, number, number]> = []
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 3
      samples.push([rgb[i]!, rgb[i + 1]!, rgb[i + 2]!])
    }
  }
  return { colors: pickDominant(samples, 3) }
}

// ---------------------------------------------------------------- 派生色板建议

export function hexToRgb(hexColor: string): [number, number, number] {
  return [parseInt(hexColor.slice(1, 3), 16), parseInt(hexColor.slice(3, 5), 16), parseInt(hexColor.slice(5, 7), 16)]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x]
  const m = l - c / 2
  return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255]
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === rn ? ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60 : max === gn ? ((bn - rn) / d + 2) * 60 : ((rn - gn) / d + 4) * 60
  return [h, s, l]
}

export function shiftTone(hexColor: string, towardLight: boolean, amount: number): string {
  const [r, g, b] = hexToRgb(hexColor)
  const anchor = towardLight ? 255 : 0
  return hex(r + (anchor - r) * amount, g + (anchor - g) * amount, b + (anchor - b) * amount)
}

export function rotateHue(hexColor: string, degrees: number, sMin = 0.35, lClamp: [number, number] = [0.3, 0.62]): string {
  const [r, g, b] = hexToRgb(hexColor)
  const [h, s, l] = rgbToHsl(r, g, b)
  const sat = Math.max(sMin, Math.min(0.85, s))
  const lig = Math.max(lClamp[0], Math.min(lClamp[1], l))
  const [r2, g2, b2] = hslToRgb(h + degrees, sat, lig)
  return hex(r2, g2, b2)
}

export interface PaletteSuggestion {
  primary: string
  secondary: string
  accent: string
  /** 派生说明（给模型/用户的一句话解释） */
  note: string
}

/**
 * 从品牌主色派生一组 paletteOverrides（primary/secondary/accent 三色；
 * 其余 8 色板字段沿用所选主题由渲染端保证可读）。
 * 确定性：颜色按频率排序输入时输出稳定。
 */
export function suggestPaletteOverrides(dominant: string[]): PaletteSuggestion | undefined {
  if (dominant.length === 0) return undefined
  const primary = dominant[0]!
  const [pr, pg, pb] = hexToRgb(primary)
  const primaryLight = luminanceOf(pr, pg, pb) > 0.5

  let secondary = dominant[1]
  if (secondary === undefined || rgbDistance(hexToRgb(primary), hexToRgb(secondary)) < 70) {
    secondary = shiftTone(primary, primaryLight, 0.28)
  }
  let accent = dominant[2]
  if (accent === undefined || rgbDistance(hexToRgb(primary), hexToRgb(accent)) < 70 || rgbDistance(hexToRgb(secondary), hexToRgb(accent)) < 70) {
    accent = rotateHue(primary, 165)
  }
  return {
    primary,
    secondary,
    accent,
    note: `primary 取品牌图最高频色，secondary ${dominant[1] !== undefined && rgbDistance(hexToRgb(primary), hexToRgb(dominant[1])) >= 70 ? '取次高频色' : '由主色明暗派生'}，accent ${dominant[2] !== undefined && rgbDistance(hexToRgb(primary), hexToRgb(dominant[2])) >= 70 ? '取第三色' : '由主色色相旋转派生'}；其余色板字段沿用所选主题`,
  }
}
