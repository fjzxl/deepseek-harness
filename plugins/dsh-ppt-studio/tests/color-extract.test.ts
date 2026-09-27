/**
 * 品牌图取色（0.18.0 P5）单测：
 * 1. PNG 解码：手绘合成 PNG（纯色块）→ 主色提取正确（近黑/近白/低饱和灰被剔除、同色系合并）；
 * 2. SVG 取色：源码 hex 频率统计；
 * 3. 不支持格式：返回 note 不抛错；
 * 4. 色板建议：primary 取最高频、secondary/accent 差异约束、确定性。
 */
import { describe, expect, it } from 'vitest'
import { deflateSync } from 'node:zlib'
import { extractDominantColors, suggestPaletteOverrides } from '../src/color-extract.js'

/** 合成一张 PNG（8-bit RGB，无压缩参数、filter 0），draw 返回每像素 [r,g,b]。 */
function makePng(width: number, height: number, draw: (x: number, y: number) => readonly [number, number, number]): Buffer {
  const bpl = width * 3
  const raw = Buffer.alloc((bpl + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (bpl + 1)] = 0 // filter type none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = draw(x, y)
      const i = y * (bpl + 1) + 1 + x * 3
      raw[i] = r
      raw[i + 1] = g
      raw[i + 2] = b
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const out = Buffer.alloc(12 + data.length)
    out.writeUInt32BE(data.length, 0)
    out.write(type, 4, 'ascii')
    data.copy(out, 8)
    return out
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

describe('PNG 主色提取', () => {
  it('大面积品牌色 + 白底 → 提取该品牌色', () => {
    // 100×100：60% 品牌红 #C0392B，其余纯白（应被剔除）
    const png = makePng(100, 100, (x, y) => (y < 60 ? [0xc0, 0x39, 0x2b] : [0xff, 0xff, 0xff]))
    const result = extractDominantColors(png, 'image/png')
    expect(result.colors.length).toBe(1)
    expect(result.colors[0]).toBe('#C0392B')
  })

  it('两个品牌色都占足够面积 → 按频率排序输出两个', () => {
    const png = makePng(100, 100, (x, _y) => (x < 50 ? [0x1e, 0x4b, 0x8f] : [0xe8, 0xa3, 0x3d]))
    const result = extractDominantColors(png, 'image/png')
    expect(result.colors).toEqual(['#1E4B8F', '#E8A33D'])
  })

  it('近黑/近白/低饱和灰被剔除（品牌 logo 白底黑字不出黑白）', () => {
    const png = makePng(90, 90, (x, y) => {
      if (y < 30) return [0x11, 0x11, 0x11] // 近黑
      if (y < 60) return [0xfa, 0xfa, 0xfa] // 近白
      return [0x88, 0x88, 0x88] // 灰
    })
    const result = extractDominantColors(png, 'image/png')
    expect(result.colors).toEqual([])
  })

  it('同色系合并：邻近色不占满 3 个坑位', () => {
    const png = makePng(90, 90, (x, _y) => {
      if (x < 30) return [0x1e, 0x4b, 0x8f]
      if (x < 60) return [0x22, 0x4e, 0x92] // 距上 <70
      return [0xe8, 0xa3, 0x3d]
    })
    const result = extractDominantColors(png, 'image/png')
    expect(result.colors).toEqual(['#1E4B8F', '#E8A33D'])
  })

  it('确定性：同图两次提取结果一致', () => {
    const png = makePng(64, 64, (x, y) => ((x + y) % 2 === 0 ? [0xc0, 0x39, 0x2b] : [0x2e, 0x6f, 0xc9]))
    expect(extractDominantColors(png, 'image/png')).toEqual(extractDominantColors(png, 'image/png'))
  })
})

describe('SVG 源码取色', () => {
  it('fill/stroke hex 频率统计（白底品牌双色 logo）', () => {
    const svg = Buffer.from(
      '<svg viewBox="0 0 24 24"><rect fill="#C0392B"/><rect fill="#C0392B"/><rect fill="#FFFFFF"/><path stroke="#E8A33D"/></svg>',
    )
    const result = extractDominantColors(svg, 'image/svg+xml')
    expect(result.colors[0]).toBe('#C0392B')
    expect(result.colors).toContain('#E8A33D')
    expect(result.colors).not.toContain('#FFFFFF')
  })
})

describe('不支持格式', () => {
  it('JPEG/WebP/GIF 返回 note 不抛错', () => {
    for (const mime of ['image/jpeg', 'image/webp', 'image/gif']) {
      const result = extractDominantColors(Buffer.from('whatever'), mime)
      expect(result.colors).toEqual([])
      expect(result.note).toBeTruthy()
    }
  })
})

describe('派生色板建议', () => {
  it('单主色：primary 原色、secondary 同族深浅、accent 与两者差异 ≥60（对比角色）', () => {
    const s = suggestPaletteOverrides(['#1E4B8F'])!
    expect(s.primary).toBe('#1E4B8F')
    const dist = (a: string, b: string): number => {
      const p = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
      const [r1, g1, b1] = p(a)
      const [r2, g2, b2] = p(b)
      return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
    }
    // secondary 是同族深浅伴色（内置主题主/辅色距也在此量级，如 business-blue ≈54）
    expect(dist(s.primary, s.secondary)).toBeGreaterThanOrEqual(25)
    expect(s.secondary).not.toBe(s.primary)
    expect(dist(s.primary, s.accent)).toBeGreaterThanOrEqual(60)
    expect(dist(s.secondary, s.accent)).toBeGreaterThanOrEqual(60)
    expect(s.note).toContain('primary')
  })

  it('三主色：直接采用图中的三个色（频率序）', () => {
    const s = suggestPaletteOverrides(['#C0392B', '#2E6FC9', '#E8A33D'])!
    expect(s).toMatchObject({ primary: '#C0392B', secondary: '#2E6FC9', accent: '#E8A33D' })
  })

  it('无色返回 undefined', () => {
    expect(suggestPaletteOverrides([])).toBeUndefined()
  })
})
