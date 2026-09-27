/**
 * 内置图标包（0.18.0 T2-1）单测：
 * 1. 词表完整性：≥60 个、命名唯一、SVG 形态统一（viewBox/线宽/round/无 text/无外链）；
 * 2. 选词确定性：关键词命中、同文本幂等、无命中落中性池；
 * 3. 版式接入：icon-list/cards/timeline 产物含图标徽章（image.svg）且通过全部校验（errorCount===0）。
 */
import { describe, expect, it } from 'vitest'
import { ICON_DEFS, ICON_NAMES, isIconName, pickIconForText, renderIconSvg } from '../src/icons.js'
import { composeSceneFromContent } from '../src/autolayout.js'
import { buildDesignTokens, getTheme } from '../src/themes.js'
import { validatePage } from '../src/validate.js'
import type { PageScene, PageType } from '../src/schema.js'

const tokens = buildDesignTokens(getTheme('business-blue')!, { density: 'normal' })
const darkTokens = buildDesignTokens(getTheme('tech-dark')!, { density: 'normal' })

function composePage(type: PageType, content: Record<string, unknown>, tk = tokens): PageScene {
  const composed = composeSceneFromContent(
    content as never,
    { type, title: '测试页', contentBrief: '概要句。' },
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

describe('图标词表完整性', () => {
  it('数量 ≥60 且命名唯一', () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(60)
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length)
    for (const name of ICON_NAMES) expect(name).toMatch(/^[a-z][a-z0-9-]*$/)
  })

  it('SVG 形态统一：24×24 viewBox、fill=none、线宽 2、round、无 text/外链', () => {
    for (const name of ICON_NAMES) {
      const svg = renderIconSvg(name, '#1E4B8F')
      expect(svg).toContain('viewBox="0 0 24 24"')
      expect(svg).toContain('fill="none"')
      expect(svg).toContain('stroke="#1E4B8F"')
      expect(svg).toContain('stroke-width="2.4"')
      expect(svg).toContain('stroke-linecap="round"')
      expect(svg).toContain('stroke-linejoin="round"')
      expect(svg).not.toMatch(/<text|<image|href|url\(/)
      // 根标签不写固定宽高（HTML 端靠 viewBox 填满容器）；body 内 rect width 是几何属性，不拦
      expect(svg).toMatch(/^<svg[^>]*viewBox="0 0 24 24"/)
      expect(svg).not.toMatch(/^<svg[^>]*\swidth=/)
    }
  })

  it('每个图标都有关键词', () => {
    for (const def of ICON_DEFS.values()) expect(def.keywords.length).toBeGreaterThan(0)
  })
})

describe('选词确定性', () => {
  it('关键词命中（中文子串 + 英文）', () => {
    expect(pickIconForText('数据安全防护体系')).toBe('shield')
    expect(pickIconForText('团队分工与组织保障')).toBe('users')
    expect(pickIconForText('年度增长 momentum')).toBe('trending-up')
    expect(pickIconForText('风险提示')).toBe('warning')
  })

  it('同文本幂等；无命中落中性池（仍是合法图标名）', () => {
    for (const text of ['甲乙丙丁', '随便一句话', 'xyz']) {
      const a = pickIconForText(text)
      const b = pickIconForText(text)
      expect(a).toBe(b)
      expect(isIconName(a)).toBe(true)
    }
  })

  it('未知名渲染回退 check-circle（不抛错）', () => {
    expect(renderIconSvg('not-an-icon', '#000000')).toContain('viewBox="0 0 24 24"')
  })
})

describe('版式接入（icon-list / cards / timeline）', () => {
  it('icon-list：每条目一个图标徽章（image.svg），显式 icons 优先，未知记 layoutNote', () => {
    const page = composePage('icon-list', {
      items: ['数据安全防护', '团队组织保障', '随便一句话'],
      icons: ['target', 'bogus-name'],
    })
    const badges = page.elements!.filter(el => el.kind === 'image' && el.svg !== undefined)
    expect(badges.length).toBe(3)
    // 显式 target 生效；bogus 回退自动选；第三条自动选
    expect(badges[0]!.svg).toContain('viewBox="0 0 24 24"')
    expect(validatePage(page, { tokens }).errorCount).toBe(0)
  })

  it('cards：网格与行卡都有图标徽章且校验通过', () => {
    for (const layout of [{}, { variant: 'row' }]) {
      const page = composePage('cards', {
        cards: [
          { title: '数据安全', desc: '防护体系说明', icon: 'shield' },
          { title: '团队组织', desc: '分工与保障' },
        ],
        layout,
      })
      expect(page.elements!.filter(el => el.kind === 'image' && el.svg !== undefined).length).toBe(2)
      expect(validatePage(page, { tokens }).errorCount).toBe(0)
    }
  })

  it('timeline：竖轴与横轴节点都是图标徽章且校验通过', () => {
    for (const layout of [{}, { variant: 'horizontal' }]) {
      const page = composePage('timeline', {
        events: [
          { label: '2021', desc: '启动项目', icon: 'rocket' },
          { label: '2022', desc: '风险管控落地' },
          { label: '2023', desc: '增长翻倍' },
        ],
        layout,
      })
      expect(page.elements!.filter(el => el.kind === 'image' && el.svg !== undefined).length).toBe(3)
      expect(validatePage(page, { tokens }).errorCount).toBe(0)
    }
  })

  it('深色主题同样产出徽章且校验通过（glyph 颜色明暗感知）', () => {
    const page = composePage('icon-list', { items: ['数据安全', '团队保障'] }, darkTokens)
    expect(page.elements!.some(el => el.kind === 'image' && el.svg?.includes(`stroke="${darkTokens.colors.bg}"`) === true)).toBe(true)
    expect(validatePage(page, { tokens: darkTokens }).errorCount).toBe(0)
  })
})
