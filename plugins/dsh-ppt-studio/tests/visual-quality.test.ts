/**
 * 视觉质量三层改造（0.15.0）单测：
 * 1. 色阶系统：确定性生成、明暗方向随底色、paletteOverrides 传导、旧 tokens 回落；
 * 2. 装饰有效性 DECORATION_CONTRAST：真实案例拦截 + 引擎产物零误报 + 三类豁免；
 * 3. 层次三件套：卡片描边/阴影、结构页纯色主底 + 色阶大圆装饰。
 */
import { describe, expect, it } from 'vitest'
import { composeSceneFromContent } from '../src/autolayout.js'
import { buildDesignTokens, buildTintScale, getTheme, relativeLuminance, THEMES } from '../src/themes.js'
import { validatePage } from '../src/validate.js'
import type { PageScene, PageType } from '../src/schema.js'

const tokens = buildDesignTokens(getTheme('business-blue')!, { density: 'normal' })
const govTokens = buildDesignTokens(getTheme('gov-red')!, { density: 'normal' })

function composePage(type: PageType, content: Record<string, unknown>, tk = tokens): PageScene {
  const composed = composeSceneFromContent(
    content as never,
    { type, title: (content.title as string) ?? '测试页', contentBrief: '概要句一。概要句二。' },
    tk,
  )
  return {
    id: 'p001',
    sectionId: 's1',
    type,
    title: '测试页',
    ...(composed.background !== undefined ? { background: composed.background } : {}),
    elements: composed.elements,
  }
}

describe('0.15.0 色阶系统（T1-1）', () => {
  it('buildTintScale：确定性输出 #RRGGBB 大写、各档互不相同', () => {
    const a = buildTintScale('#1E4B8F', '#F5F7FA')
    const b = buildTintScale('#1E4B8F', '#F5F7FA')
    expect(a).toEqual(b)
    const steps = Object.values(a)
    for (const hex of steps) expect(hex).toMatch(/^#[0-9A-F]{6}$/)
    expect(new Set(steps).size).toBe(steps.length)
  })

  it('浅色底：50 最接近底色、900 比基色更深（亮度单调）', () => {
    const scale = buildTintScale('#1E4B8F', '#F5F7FA')
    expect(relativeLuminance(scale['50'])).toBeGreaterThan(relativeLuminance(scale['200']))
    expect(relativeLuminance(scale['200'])).toBeGreaterThan(relativeLuminance(scale['400']))
    expect(relativeLuminance(scale['900'])).toBeLessThan(relativeLuminance(scale['600']))
    expect(relativeLuminance(scale['600'])).toBeLessThan(relativeLuminance('#1E4B8F'))
  })

  it('深色底：方向自动反转（900 向白锚靠拢，50 贴近深底）', () => {
    const scale = buildTintScale('#38BDF8', '#0F172A')
    expect(relativeLuminance(scale['900'])).toBeGreaterThan(relativeLuminance('#38BDF8'))
    expect(relativeLuminance(scale['50'])).toBeLessThan(relativeLuminance('#38BDF8'))
  })

  it('tokens 携带 tints 且 paletteOverrides 传导进色阶', () => {
    expect(tokens.tints?.primary['200']).toBeDefined()
    const overridden = buildDesignTokens(getTheme('business-blue')!, { paletteOverrides: { primary: '#B02A30' } })
    expect(overridden.colors.primary).toBe('#B02A30')
    expect(overridden.tints?.primary['200']).not.toBe(tokens.tints?.primary['200'])
  })

  it('旧 deck tokens（无 tints）：引擎回落基色不崩溃，结构页跳过色阶大圆', () => {
    const legacy = { ...tokens, tints: undefined }
    const cover = composePage('cover', { title: '旧令牌封面' }, legacy)
    expect(cover.elements.some(e => e.id.startsWith('deco') && e.kind === 'shape' && e.shape === 'ellipse')).toBe(false)
    expect(cover.elements.some(e => e.id.startsWith('decobar'))).toBe(true)
    const cards = composePage('cards', { title: '卡', cards: [{ title: 'A' }, { title: 'B' }] }, legacy)
    const card = cards.elements.find(e => e.kind === 'shape' && e.id.startsWith('card'))
    expect(card && card.kind === 'shape' && card.border?.color).toBe(legacy.colors.primary)
  })

  it('引擎用色阶的颜色不触发 TOKEN_COLOR（色阶同属锁定色）', () => {
    const page = composePage('cards', { title: '三大能力', cards: [{ title: '理解' }, { title: '生成' }, { title: '推理' }] })
    const result = validatePage(page, { tokens })
    expect(result.issues.filter(i => i.rule === 'TOKEN_COLOR')).toEqual([])
  })
})

describe('0.15.0 装饰有效性 DECORATION_CONTRAST（T1-2）', () => {
  it('真实案例：暗红圆叠大红渐变底（gov-red 封面旧版）被拦截', () => {
    const page: PageScene = {
      id: 'p001',
      sectionId: 's1',
      type: 'cover',
      background: { gradient: { from: '#B02A30', to: '#D4544F', angle: 135 } },
      elements: [
        { kind: 'shape', id: 'badCircle', x: 9.5, y: 0.8, w: 2.4, h: 2.4, shape: 'ellipse', fill: '#7A1E22', background: true },
        { kind: 'text', id: 't1', x: 1, y: 2.6, w: 10, h: 1, fontSize: 40, color: '#FFFFFF', align: 'center', valign: 'mid', paragraphs: [{ text: '标题' }] },
      ],
    }
    const result = validatePage(page, { tokens: govTokens })
    expect(result.issues.some(i => i.rule === 'DECORATION_CONTRAST' && i.elementId === 'badCircle')).toBe(true)
  })

  it('同色调装饰（纯色底）同样被拦截', () => {
    const page: PageScene = {
      id: 'p001',
      sectionId: 's1',
      type: 'cover',
      background: { color: '#B02A30' },
      elements: [
        { kind: 'shape', id: 'badCircle', x: 9.5, y: 0.8, w: 2.4, h: 2.4, shape: 'ellipse', fill: '#A03236', background: true },
      ],
    }
    const result = validatePage(page, { tokens: govTokens })
    expect(result.issues.some(i => i.rule === 'DECORATION_CONTRAST')).toBe(true)
  })

  it('豁免：低透明度水印 / 带描边 / 高对比装饰不报', () => {
    const mk = (el: Partial<never> | Record<string, unknown>): PageScene => ({
      id: 'p001', sectionId: 's1', type: 'cover',
      background: { color: '#B02A30' },
      elements: [
        { kind: 'shape', id: 'x1', x: 1, y: 1, w: 1, h: 1, shape: 'ellipse', fill: '#B02A30', opacity: 0.15, background: true },
        { kind: 'shape', id: 'x2', x: 3, y: 1, w: 1, h: 1, shape: 'ellipse', fill: '#A03236', border: { color: '#C9A227', width: 1, style: 'solid' }, background: true },
        { kind: 'shape', id: 'x3', x: 5, y: 1, w: 1, h: 1, shape: 'ellipse', fill: '#C9A227', background: true },
      ],
      ...(el as object),
    })
    const result = validatePage(mk({}), { tokens: govTokens })
    expect(result.issues.filter(i => i.rule === 'DECORATION_CONTRAST')).toEqual([])
  })

  it('12 套主题全部页型引擎产物零 DECORATION_CONTRAST 误报', () => {
    const cases: Array<[PageType, Record<string, unknown>]> = [
      ['cover', { title: '标题', subtitle: '副标题' }],
      ['section', { title: '章节', subtitle: '01' }],
      ['closing', { title: '谢谢', subtitle: 'mail@example.com' }],
      ['toc', { entries: ['一', '二', '三'] }],
      ['cards', { title: '卡', cards: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] }],
      ['icon-list', { items: ['要点一', '要点二', '要点三'] }],
      ['two-col', { columns: [{ title: '左', items: ['a'] }, { title: '右', items: ['b'] }] }],
      ['hierarchy', { layers: ['顶', '中', '底'] }],
    ]
    for (const theme of THEMES) {
      const tk = buildDesignTokens(theme, { density: 'normal' })
      for (const [type, content] of cases) {
        const result = validatePage(composePage(type, content, tk), { tokens: tk })
        const hits = result.issues.filter(i => i.rule === 'DECORATION_CONTRAST')
        expect(hits, `${theme.id}/${type}: ${hits.map(h => h.message).join('；')}`).toEqual([])
      }
    }
  })
})

describe('0.15.0 层次三件套（T1-3）', () => {
  it('cards / two-col 卡片带细描边与轻阴影', () => {
    const cards = composePage('cards', { title: '卡', cards: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] })
    const card = cards.elements.find(e => e.kind === 'shape' && e.id.startsWith('card'))
    expect(card && card.kind === 'shape' && card.border).toBeDefined()
    expect(card && card.kind === 'shape' && card.shadow).toBeDefined()
    const two = composePage('two-col', { columns: [{ title: '左', items: ['a'] }, { title: '右', items: ['b'] }] })
    const cardL = two.elements.find(e => e.kind === 'shape' && e.id.startsWith('card0'))
    expect(cardL && cardL.kind === 'shape' && cardL.border?.color).toBe(tokens.tints?.primary['200'])
    expect(cardL && cardL.kind === 'shape' && cardL.shadow?.blur).toBe(7)
  })

  it('结构页：纯色主底 + 色阶大圆（右上出血）+ onPrimary 底条', () => {
    const cover = composePage('cover', { title: '标题', subtitle: '副标题' })
    expect(cover.background?.color).toBe(tokens.colors.primary)
    const circle = cover.elements.find(e => e.id.startsWith('deco') && e.kind === 'shape')
    expect(circle).toBeDefined()
    expect(circle && (circle as { fill?: string }).fill).toBe(tokens.tints?.primary['200'])
    expect(circle && (circle as { x: number; w: number }).x + (circle as { w: number }).w).toBeLessThanOrEqual(13.64)
    const bar = cover.elements.find(e => e.id.startsWith('decobar'))
    expect(bar && (bar as { fill?: string }).fill).toBe(tokens.colors.onPrimary)
    const rule = cover.elements.find(e => e.id.startsWith('covrule'))
    expect(rule && (rule as { fill?: string }).fill).toBe(tokens.colors.onPrimary)
  })

  it('icon-list 圆片用明暗感知色阶实色（0.18.0 起：浅色页取能过装饰可见线的最浅色阶 + tint700 字形）', () => {
    const page = composePage('icon-list', { items: ['一', '二', '三'] })
    const chip = page.elements.find(e => e.id.startsWith('icbg'))
    // business-blue 的 tint200 对底色 RGB 距 ~95 ≥75 → 取 200（字形对比最佳档）
    expect(chip && (chip as { fill?: string }).fill).toBe(tokens.tints?.primary['200'])
    expect(chip && (chip as { opacity?: number }).opacity).toBeUndefined()
    const glyph = page.elements.find(e => e.id.startsWith('icgl'))
    expect(glyph?.kind).toBe('image')
  })

  it('核心不变量不回归：全部页型 error 级校验为零', () => {
    const cases: Array<[PageType, Record<string, unknown>]> = [
      ['cover', { title: '标题', subtitle: '副标题' }],
      ['section', { title: '章节', subtitle: '01', items: ['导语'] }],
      ['closing', { title: '谢谢', subtitle: 'b@e.com' }],
      ['cards', { title: '卡', cards: [{ title: 'A', desc: '描述' }, { title: 'B', desc: '描述' }] }],
      ['icon-list', { items: ['一', '二'] }],
      ['hierarchy', { layers: ['顶', '中', '底'] }],
    ]
    for (const [type, content] of cases) {
      const result = validatePage(composePage(type, content), { tokens })
      expect(result.ok, `${type}: ${result.issues.filter(i => i.level === 'error').map(i => i.message).join('；')}`).toBe(true)
    }
  })
})
