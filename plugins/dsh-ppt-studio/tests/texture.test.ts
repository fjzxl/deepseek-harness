/**
 * 主题化背景纹理（0.18.0 T2-2）单测：
 * 1. 令牌：12 主题全部产出 texture（kind 合法、色阶色、透明度低）、明暗分档、paletteOverrides 传导；
 * 2. SVG 生成：pattern 形态、三种纹样互异、无外链；
 * 3. 光栅化烟测：resvg 能把 pattern SVG 渲染为真 PNG（PPTX 链路前置）。
 */
import { describe, expect, it } from 'vitest'
import { buildDesignTokens, getTheme, THEMES, textureFromTints } from '../src/themes.js'
import { renderTextureSvg, TEXTURE_KINDS } from '../src/texture.js'
import { svgToPngDataUri } from '../src/rasterize.js'
import type { TextureConfig } from '../src/schema.js'

describe('纹理令牌', () => {
  it('12 主题全部产出 texture，kind 在词表内且颜色取色阶', () => {
    for (const theme of THEMES) {
      const tokens = buildDesignTokens(theme, { density: 'normal' })
      const texture = tokens.texture
      expect(texture, theme.id).toBeDefined()
      expect(TEXTURE_KINDS).toContain(texture!.kind)
      expect(texture!.color).toMatch(/^#[0-9A-F]{6}$/)
      expect(texture!.opacity).toBeLessThanOrEqual(0.6)
      // 颜色必须来自锁定色阶（令牌色校验同源）
      const tintValues = new Set(Object.values(tokens.tints!).flatMap(scale => Object.values(scale)))
      expect(tintValues.has(texture!.color), `${theme.id} ${texture!.color}`).toBe(true)
    }
  })

  it('明暗分档：浅色底 300/0.42、深色底 600/0.38', () => {
    const light = buildDesignTokens(getTheme('business-blue')!)
    const dark = buildDesignTokens(getTheme('tech-dark')!)
    expect(light.texture).toEqual({ kind: 'dots', color: light.tints!.primary['300'], opacity: 0.42 })
    expect(dark.texture).toEqual({ kind: 'diagonal', color: dark.tints!.primary['600'], opacity: 0.38 })
  })

  it('主题→纹样映射有分野（不是 12 套全同款）', () => {
    const kinds = new Set(THEMES.map(t => buildDesignTokens(t).texture!.kind))
    expect(kinds.size).toBeGreaterThanOrEqual(2)
  })

  it('paletteOverrides 换主色后纹理色随色阶重算', () => {
    const base = buildDesignTokens(getTheme('business-blue')!)
    const overridden = buildDesignTokens(getTheme('business-blue')!, { paletteOverrides: { primary: '#B02A30' } })
    expect(overridden.texture!.color).not.toBe(base.texture!.color)
  })

  it('textureFromTints 对无色阶的旧 tokens 返回 undefined', () => {
    expect(textureFromTints(undefined, '#FFFFFF')).toBeUndefined()
  })
})

describe('纹理 SVG 生成', () => {
  const config: TextureConfig = { kind: 'dots', color: '#1E4B8F', opacity: 0.42 }

  it('pattern 形态：defs/pattern/rect 引用、无外链、viewBox 比例与画布一致', () => {
    const svg = renderTextureSvg(config)
    expect(svg).toContain('<pattern')
    expect(svg).toContain('patternUnits="userSpaceOnUse"')
    expect(svg).toContain('fill-opacity="0.42"')
    expect(svg).toMatch(/viewBox="0 0 1600 900"/)
    expect(svg).not.toMatch(/href|<image|<text/)
  })

  it('三种纹样互异（diagonal 带 rotate45、lattice 是描边方格、dots 是圆点）', () => {
    const dots = renderTextureSvg({ kind: 'dots', color: '#1E4B8F', opacity: 0.4 })
    const diagonal = renderTextureSvg({ kind: 'diagonal', color: '#1E4B8F', opacity: 0.4 })
    const lattice = renderTextureSvg({ kind: 'lattice', color: '#1E4B8F', opacity: 0.4 })
    expect(dots).toContain('<circle')
    expect(diagonal).toContain('patternTransform="rotate(45)"')
    expect(lattice).toContain('stroke-opacity="0.4"')
    expect(new Set([dots, diagonal, lattice]).size).toBe(3)
  })

  it('resvg 光栅化烟测：pattern SVG → 真 PNG 魔数（PPTX 嵌入链路）', () => {
    const png = svgToPngDataUri(renderTextureSvg(config), 1600, 900)
    expect(png).toBeDefined()
    expect(png!.startsWith('image/png;base64,')).toBe(true)
    const bytes = Buffer.from(png!.slice('image/png;base64,'.length), 'base64')
    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  })
})
