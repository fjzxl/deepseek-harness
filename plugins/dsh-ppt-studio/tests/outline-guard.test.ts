/**
 * 0.16.0 写页防线单测（真实事故 d20260922-220212 驱动）：
 * 1. OUTLINE_PAGE_MISMATCH：写页槽位与大纲页型不一致 → error（事故：内容页从 p002 起写跳过目录槽位，
 *    全册错位两格、目录被写到 p028、封面重复）；
 * 2. EMPTY_CONTAINER：roundRect 卡片内无任何内容元素 → error（事故：p011"两个核心权衡"/p012 右侧
 *    画了框没放字，通过全部旧规则落盘）；
 * 3. VISUAL_RATIO_LOW / visualStyle 分档（事故：29 页零图）。
 */
import { describe, expect, it } from 'vitest'
import { composeSceneFromContent } from '../src/autolayout.js'
import { buildDesignTokens, getTheme } from '../src/themes.js'
import { validateDeckPages, validatePage } from '../src/validate.js'
import { deckBriefSchema } from '../src/schema.js'
import type { PageScene, PageType } from '../src/schema.js'

const tokens = buildDesignTokens(getTheme('business-blue')!, { density: 'normal' })

function barePage(overrides: Partial<PageScene> & { elements: PageScene['elements'] }): PageScene {
  return { id: 'p001', sectionId: 's1', type: 'bullets', ...overrides }
}

describe('0.16.0 OUTLINE_PAGE_MISMATCH（写页槽位契约）', () => {
  const page = barePage({
    type: 'process',
    elements: [
      { kind: 'text', id: 't1', x: 0.6, y: 0.45, w: 12, h: 0.6, fontSize: 26, color: '#1F2937', align: 'left', valign: 'top', paragraphs: [{ text: '标题' }] },
    ],
  })

  it('大纲槽位是 toc、写入 process → error（事故复现：目录槽位被内容页占用）', () => {
    const result = validatePage(page, { tokens, outlineType: 'toc' })
    expect(result.issues.some(i => i.rule === 'OUTLINE_PAGE_MISMATCH' && i.level === 'error')).toBe(true)
    expect(result.ok).toBe(false)
  })

  it('槽位一致 → 通过；未提供大纲上下文（旧调用路径）→ 不查', () => {
    expect(validatePage(page, { tokens, outlineType: 'process' }).issues.some(i => i.rule === 'OUTLINE_PAGE_MISMATCH')).toBe(false)
    expect(validatePage(page, { tokens }).issues.some(i => i.rule === 'OUTLINE_PAGE_MISMATCH')).toBe(false)
  })

  it('版式引擎 content 模式按蓝图页型展开 → 与大纲天然一致', () => {
    const composed = composeSceneFromContent(
      { title: '要点', items: ['一', '二'] },
      { type: 'bullets', title: '要点', contentBrief: '概要。' },
      tokens,
    )
    const scene = barePage({ type: 'bullets', elements: composed.elements })
    expect(validatePage(scene, { tokens, outlineType: 'bullets' }).issues.some(i => i.rule === 'OUTLINE_PAGE_MISMATCH')).toBe(false)
  })
})

describe('0.16.0 EMPTY_CONTAINER（卡片画了框忘了内容）', () => {
  const emptyBox = { kind: 'shape', id: 'card-x', x: 7.75, y: 2.2, w: 5, h: 2, shape: 'roundRect', fill: '#EBEBFD', background: true } as const
  const heading = { kind: 'text', id: 'h1', x: 7.75, y: 1.7, w: 5, h: 0.4, fontSize: 18, color: '#1F2937', align: 'left', valign: 'top', paragraphs: [{ text: '两个核心权衡' }] } as const

  it('事故复现：标题在框外、框内无内容 → error', () => {
    const page = barePage({ type: 'image-text', elements: [heading, emptyBox] })
    const result = validatePage(page, { tokens })
    expect(result.issues.some(i => i.rule === 'EMPTY_CONTAINER' && i.level === 'error' && i.elementId === 'card-x')).toBe(true)
    expect(result.ok).toBe(false)
  })

  it('框内有文字（主体落在框内）→ 通过', () => {
    const inner = { kind: 'text', id: 'c1', x: 8, y: 2.5, w: 4.5, h: 1.4, fontSize: 15, color: '#1F2937', align: 'left', valign: 'top', paragraphs: [{ text: '权衡一：吞吐 vs 延迟' }] }
    const page = barePage({ type: 'image-text', elements: [heading, emptyBox, inner] })
    expect(validatePage(page, { tokens }).issues.some(i => i.rule === 'EMPTY_CONTAINER')).toBe(false)
  })

  it('小圆片/徽章（<1.5in²）豁免；纯装饰请用 rect/ellipse 不受本规则约束', () => {
    const chip = { kind: 'shape', id: 'chip', x: 0.9, y: 1.8, w: 0.5, h: 0.5, shape: 'roundRect', fill: '#DEE7F5', background: true }
    const panel = { kind: 'shape', id: 'panel', x: 0, y: 0, w: 3, h: 7.5, shape: 'rect', fill: '#F5F7FA', background: true }
    const page = barePage({ type: 'bullets', elements: [chip, panel, heading] })
    expect(validatePage(page, { tokens }).issues.some(i => i.rule === 'EMPTY_CONTAINER')).toBe(false)
  })

  it('版式引擎卡片页（two-col/comparison/cards）零误报', () => {
    for (const [type, content] of [
      ['two-col', { columns: [{ title: '左', items: ['a'] }, { title: '右', items: ['b'] }] }],
      ['comparison', { columns: [{ title: '前', items: ['a'] }, { title: '后', items: ['b'] }] }],
      ['cards', { cards: [{ title: 'A', desc: '描述一' }, { title: 'B', desc: '描述二' }, { title: 'C', desc: '描述三' }] }],
    ] as Array<[PageType, Record<string, unknown>]>) {
      const composed = composeSceneFromContent(content as never, { type, title: 'T', contentBrief: '概要。' }, tokens)
      const page = barePage({ type, elements: composed.elements })
      const hits = validatePage(page, { tokens }).issues.filter(i => i.rule === 'EMPTY_CONTAINER')
      expect(hits, `${type}: ${hits.map(h => h.message).join('；')}`).toEqual([])
    }
  })
})

describe('0.16.0 visualStyle 图文配比（事故：29 页零图）', () => {
  const mkOutlinePages = (pages: PageScene[]) => pages.map(p => ({
    id: p.id, sectionId: 's1', type: p.type, title: p.title ?? 'T', contentBrief: '概要',
  }))
  const textPages: PageScene[] = Array.from({ length: 8 }, (_v, i) => barePage({
    id: `p${String(i + 1).padStart(3, '0')}`,
    elements: [
      { kind: 'text', id: 't1', x: 0.6, y: 0.45, w: 12, h: 0.6, fontSize: 26, color: '#1F2937', align: 'left', valign: 'top', paragraphs: [{ text: `页${i + 1}` }] },
      { kind: 'text', id: 't2', x: 0.9, y: 1.7, w: 11, h: 3, fontSize: 16, color: '#1F2937', align: 'left', valign: 'top', paragraphs: [{ text: '要点文字'.repeat(10) }] },
    ],
  }))

  it('visual 档 8 页零图 → VISUAL_RATIO_LOW warning', () => {
    const result = validateDeckPages(textPages, { tokens, outlinePages: mkOutlinePages(textPages), visualStyle: 'visual' })
    expect(result.issues.some(i => i.rule === 'VISUAL_RATIO_LOW' && i.level === 'warning')).toBe(true)
  })

  it('balanced 档零图同样提醒（默认档不是零图豁免）', () => {
    const result = validateDeckPages(textPages, { tokens, outlinePages: mkOutlinePages(textPages) })
    expect(result.issues.some(i => i.rule === 'VISUAL_RATIO_LOW')).toBe(true)
  })

  it('text 档：不查配比，且 VISUAL_RHYTHM 降为 info', () => {
    const result = validateDeckPages(textPages, { tokens, outlinePages: mkOutlinePages(textPages), visualStyle: 'text' })
    expect(result.issues.some(i => i.rule === 'VISUAL_RATIO_LOW')).toBe(false)
    const rhythm = result.issues.filter(i => i.rule === 'VISUAL_RHYTHM')
    expect(rhythm.length).toBeGreaterThan(0)
    expect(rhythm.every(i => i.level === 'info')).toBe(true)
  })

  it('brief 默认 visualStyle=balanced', () => {
    const brief = deckBriefSchema.parse({
      deckId: 'd1', title: 'T', topic: 'x', audience: 'a', scenario: 's', objective: 'o',
      themeId: 'business-blue', confirmedAt: '2026-09-22T00:00:00Z',
    })
    expect(brief.visualStyle).toBe('balanced')
  })
})

describe('0.17.1 VISUAL_PLAN_UNMET 升级为 error（蓝图配图契约）', () => {
  const baseElements = [
    { kind: 'text', id: 't1', x: 0.6, y: 0.45, w: 12, h: 0.6, fontSize: 26, color: '#1F2937', align: 'left', valign: 'top', paragraphs: [{ text: '标题' }] },
    { kind: 'text', id: 't2', x: 0.9, y: 1.7, w: 11, h: 3, fontSize: 16, color: '#1F2937', align: 'left', valign: 'top', paragraphs: [{ text: '正文要点'.repeat(8) }] },
  ]
  it('visualPlan=image 但页面无 image 元素 → error（真实事故：全册仅 1 占位图）', () => {
    const page = barePage({ type: 'bullets', elements: baseElements })
    const result = validatePage(page, { tokens, visualPlan: 'image' })
    expect(result.issues.some(i => i.rule === 'VISUAL_PLAN_UNMET' && i.level === 'error')).toBe(true)
    expect(result.ok).toBe(false)
  })
  it('visualPlan=chart 但无 chart 元素 → error；visualPlan=none 不查', () => {
    const page = barePage({ type: 'bullets', elements: baseElements })
    expect(validatePage(page, { tokens, visualPlan: 'chart' }).ok).toBe(false)
    expect(validatePage(page, { tokens, visualPlan: 'none' }).ok).toBe(true)
  })
  it('image-text 占位框即满足 visual:image（content 模式弱档主路径不受罚）', () => {
    const composed = composeSceneFromContent(
      { image: { prompt: '架构示意' } },
      { type: 'image-text', title: '图文', contentBrief: '概要。' },
      tokens,
    )
    const page = barePage({ type: 'image-text', elements: composed.elements })
    expect(validatePage(page, { tokens, visualPlan: 'image' }).issues.some(i => i.rule === 'VISUAL_PLAN_UNMET')).toBe(false)
  })
})
