/**
 * SVG 内联矢量插图（0.13.0）：清洗、viewBox 归一、比例适配、渲染端内联/嵌入。
 */
import { describe, expect, it } from 'vitest'
import { normalizeSvgRoot, sanitizeSvg } from '../src/normalize.js'
import { composeSceneFromContent } from '../src/autolayout.js'
import { validatePage } from '../src/validate.js'
import { buildDesignTokens, getTheme } from '../src/themes.js'
import type { PageScene } from '../src/schema.js'

const tokens = buildDesignTokens(getTheme('business-blue')!, { density: 'normal' })

const SAMPLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 460"><rect x="20" y="20" width="520" height="420" rx="12" fill="#38BDF8" opacity="0.15"/><text x="280" y="240" text-anchor="middle" font-size="28" fill="#0F172A">注意力示意</text></svg>'

describe('sanitizeSvg', () => {
  it('剥掉 script 块、on* 事件属性、foreignObject 与 javascript: 链接', () => {
    const dirty = '<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script><foreignObject><div>x</div></foreignObject><a href="javascript:alert(3)"><rect width="5" height="5" onclick="x()"/></a></svg>'
    const clean = sanitizeSvg(dirty)
    expect(clean).not.toContain('script')
    expect(clean).not.toContain('onload')
    expect(clean).not.toContain('onclick')
    expect(clean).not.toContain('foreignObject')
    expect(clean).not.toContain('javascript:')
    expect(clean).toContain('<rect width="5" height="5"')
  })
})

describe('normalizeSvgRoot', () => {
  it('保留 viewBox、剥根标签固定 width/height', () => {
    const r = normalizeSvgRoot('<svg width="800" height="600" viewBox="0 0 400 300"><rect width="10" height="10"/></svg>')!
    expect(r).not.toBeNull()
    expect(r.width).toBe(400)
    expect(r.height).toBe(300)
    expect(r.svg).toContain('viewBox="0 0 400 300"')
    expect(r.svg).not.toMatch(/<svg[^>]*\swidth=/)
    expect(r.svg).toContain('<rect width="10" height="10"/>') // 非根标签的 width/height 不动
  })

  it('无 viewBox 时从 width/height 推导并注入', () => {
    const r = normalizeSvgRoot('<svg width="560" height="460"><rect width="10" height="10"/></svg>')!
    expect(r.width).toBe(560)
    expect(r.height).toBe(460)
    expect(r.svg).toContain('viewBox="0 0 560 460"')
  })

  it('无 <svg> 根标签返回 null（引擎降级占位框）', () => {
    expect(normalizeSvgRoot('<div>not svg</div>')).toBeNull()
  })
})

describe('image-text svg 分支（composeSceneFromContent）', () => {
  const composed = composeSceneFromContent(
    { title: '注意力机制', image: { svg: SAMPLE_SVG, heading: '加权聚合', items: ['并行计算', '全局视野'] } },
    { type: 'image-text', title: '注意力机制', contentBrief: '概要。' },
    tokens,
  )
  const image = composed.elements.find(e => e.kind === 'image') as { svg?: string; x: number; y: number; w: number; h: number; fit?: string; placeholder?: unknown }

  it('svg 落到 image 元素且不产生 placeholder/assetId', () => {
    expect(image.svg).toContain('<svg')
    expect(image.placeholder).toBeUndefined()
  })

  it('按 viewBox 比例适配图区：5.6×4.6 区域内不拉伸、居中', () => {
    // viewBox 560/460 ≈ 1.217 与区域 5.6/4.6 ≈ 1.217 同比 → 基本占满
    expect(Math.abs(image.w / image.h - 560 / 460)).toBeLessThan(0.02)
    expect(image.w).toBeLessThanOrEqual(5.61)
    expect(image.h).toBeLessThanOrEqual(4.61)
  })

  it('产物通过全部 error 级校验（IMAGE_SOURCE_INVALID 三选一不再误伤 svg）', () => {
    const page: PageScene = {
      id: 'p001', sectionId: 's1', type: 'image-text', title: 'T',
      elements: composed.elements,
    }
    const result = validatePage(page, { tokens, manifest: { assets: [] } })
    expect(result.issues.filter(i => i.level === 'error')).toEqual([])
  })

  it('宽扁 svg（viewBox 1120×460）适配为宽图且不越界', () => {
    const wide = composeSceneFromContent(
      { image: { svg: SAMPLE_SVG.replace('0 0 560 460', '0 0 1120 460') } },
      { type: 'image-text', title: 'T', contentBrief: '概要。' },
      tokens,
    )
    const img = wide.elements.find(e => e.kind === 'image') as { w: number; h: number }
    expect(img.w).toBeCloseTo(5.6, 1) // 宽受限
    expect(img.h).toBeCloseTo(5.6 / (1120 / 460), 1)
    expect(img.w / img.h).toBeCloseTo(1120 / 460, 1)
  })

  it('非法 svg（无根标签）降级为占位框并留 layoutNote', () => {
    const bad = composeSceneFromContent(
      { image: { svg: 'not an svg at all.........' } },
      { type: 'image-text', title: 'T', contentBrief: '概要。' },
      tokens,
    )
    const img = bad.elements.find(e => e.kind === 'image') as { placeholder?: unknown; svg?: string }
    expect(img.placeholder).toBeDefined()
    expect(img.svg).toBeUndefined()
    expect(bad.layoutNotes.some(n => n.includes('占位框'))).toBe(true)
  })
})
