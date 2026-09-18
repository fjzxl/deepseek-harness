/**
 * 版式引擎核心不变量单测：17 种页型的 content 输入 → composeSceneFromContent 产物
 * 必须通过 validatePage 全部 error 级校验（越界/互压/容量/字号/令牌/图表形态）。
 * 这是「弱模型只传语义内容就不会踩版式错误」的保证——任何页型模板改动都必须维持本不变量。
 */
import { describe, expect, it } from 'vitest'
import { composeSceneFromContent, splitSentences, type PageContentInput } from '../src/autolayout.js'
import { buildDesignTokens, getTheme } from '../src/themes.js'
import { validatePage } from '../src/validate.js'
import type { PageScene, PageType } from '../src/schema.js'

const tokens = buildDesignTokens(getTheme('business-blue')!, { density: 'normal' })

/** 每页型的代表性内容（覆盖该页型取用的全部字段）。 */
const SAMPLES: Record<PageType, { content: PageContentInput; fallbackBrief: string }> = {
  cover: { content: { title: '大模型入门', subtitle: '张三 · 2026 年 9 月' }, fallbackBrief: '封面' },
  toc: { content: { title: '目录', entries: ['历史脉络', '核心原理', '突破与未来'] }, fallbackBrief: '目录' },
  section: { content: { title: '核心原理', subtitle: '02', items: ['回答机器为什么能学习'] }, fallbackBrief: '章节过渡' },
  closing: { content: { title: '谢谢聆听', subtitle: 'zhang@example.com' }, fallbackBrief: '结尾' },
  bullets: { content: { title: '三波浪潮', items: ['符号主义：规则驱动', '连接主义：数据驱动', '大模型：规模驱动'] }, fallbackBrief: '要点页' },
  'two-col': {
    content: {
      title: '规则 vs 数据',
      columns: [
        { title: '符号主义', items: ['人工编写规则', '可解释性强'] },
        { title: '连接主义', items: ['从数据中学习', '规模效应显著'] },
      ],
    },
    fallbackBrief: '两栏',
  },
  comparison: {
    content: {
      title: '改造前后',
      columns: [
        { title: '改造前', items: ['人工审核', '平均 3 天'] },
        { title: '改造后', items: ['自动审核', '平均 10 分钟'] },
      ],
    },
    fallbackBrief: '对比',
  },
  'image-text': {
    content: { title: '注意力机制', image: { prompt: '由书堆成的塔，矢量扁平风格', heading: '核心思想', items: ['加权聚合', '并行计算'] } },
    fallbackBrief: '图文页：注意力机制让模型加权聚合信息。这是第二句概要。这是第三句概要。',
  },
  chart: {
    content: {
      title: '市场规模',
      chart: { chartType: 'column', labels: ['2022', '2023', '2024', '2025'], series: [{ name: '规模（亿元）', values: [120, 180, 260, 390] }], conclusion: '四年复合增速约 48%，增长主要由企业侧 adoption 驱动' },
    },
    fallbackBrief: '数据页',
  },
  table: {
    content: { title: '方案对照', table: { header: ['方案', '成本', '效果'], rows: [['A', '低', '一般'], ['B', '中', '良好'], ['C', '高', '优秀']], note: '数据来源：内部测评（示意）' } },
    fallbackBrief: '表格页',
  },
  quote: { content: { title: '金句', quote: { text: '规模是一种暴力美学，但暴力之外还需要方向。', source: '某研究员' } }, fallbackBrief: '金句页' },
  timeline: {
    content: { title: '四代演进', events: [{ label: '2012', desc: '深度学习起步' }, { label: '2017', desc: 'Transformer 提出' }, { label: '2020', desc: '规模定律验证' }, { label: '2023', desc: '多模态爆发' }] },
    fallbackBrief: '时间轴',
  },
  'big-number': { content: { title: '关键数据', bigNumber: { value: '48', unit: '%', desc: '四年复合增速', source: '内部测算' } }, fallbackBrief: '大数字' },
  process: {
    content: { title: '推理流水线', steps: [{ name: '分词', desc: '文本切分为 token' }, { name: '编码', desc: '映射为向量' }, { name: '解码', desc: '自回归生成' }] },
    fallbackBrief: '流程页',
  },
  cards: {
    content: { title: '三大能力', cards: [{ title: '理解', desc: '阅读与摘要' }, { title: '生成', desc: '写作与绘图' }, { title: '推理', desc: '多步规划' }] },
    fallbackBrief: '卡片页',
  },
  hierarchy: { content: { title: '技术栈分层', layers: ['模型层', '编排层', '应用层'] }, fallbackBrief: '层级页' },
  'icon-list': { content: { title: '采用理由', items: ['成本下降一个数量级', '能力覆盖办公场景', '私有化部署可控'] }, fallbackBrief: '图标要点页' },
}

function composeFor(type: PageType, override?: Partial<PageContentInput>) {
  const sample = SAMPLES[type]
  return composeSceneFromContent(
    { ...sample.content, ...override },
    { type, title: (override?.title ?? sample.content.title) as string, contentBrief: sample.fallbackBrief },
    tokens,
  )
}

function pageOf(type: PageType, override?: Partial<PageContentInput>): PageScene {
  const composed = composeFor(type, override)
  return {
    id: 'p001',
    sectionId: 's1',
    type,
    title: '测试页',
    ...(composed.background !== undefined ? { background: composed.background } : {}),
    elements: composed.elements,
  }
}

describe('composeSceneFromContent 核心不变量', () => {
  const allTypes = Object.keys(SAMPLES) as PageType[]

  it.each(allTypes)('页型 %s 的产物通过全部 error 级校验', (type) => {
    const result = validatePage(pageOf(type), { tokens, manifest: { assets: [] } })
    const errors = result.issues.filter(i => i.level === 'error')
    expect(errors, `${type}: ${errors.map(e => `${e.rule}:${e.message}`).join('；')}`).toEqual([])
    expect(result.ok).toBe(true)
  })

  it.each(allTypes)('页型 %s 元素 id 唯一且 ≤24 个', (type) => {
    const page = pageOf(type)
    const ids = page.elements!.map(e => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeLessThanOrEqual(24)
    expect(ids.length).toBeGreaterThan(0)
  })

  it('极端长文本（8 条 × 160 字）也不触发严重溢出 error（自缩字号兜底）', () => {
    const long = '字'.repeat(160)
    const result = validatePage(pageOf('bullets', { items: Array.from({ length: 8 }, () => long) }), { tokens })
    const severe = result.issues.filter(i => i.rule === 'TEXT_SEVERE_OVERFLOW')
    expect(severe).toEqual([])
  })

  it('4 卡片 + 200 字说明：无 error（可 warning）', () => {
    const result = validatePage(pageOf('cards', { cards: Array.from({ length: 4 }, (_, i) => ({ title: `卡片${i}`, desc: '述'.repeat(200) })) }), { tokens })
    expect(result.ok).toBe(true)
  })

  it('饼图多系列只保留第一系列并记录说明', () => {
    const composed = composeFor('chart', { chart: { chartType: 'pie', labels: ['A', 'B'], series: [{ name: '一', values: [1, 2] }, { name: '二', values: [3, 4] }] } })
    const chart = composed.elements.find(e => e.kind === 'chart')
    expect(chart && chart.kind === 'chart' && chart.series.length).toBe(1)
    expect(composed.layoutNotes.some(n => n.includes('饼图'))).toBe(true)
  })

  it('图表系列长度自动对齐 labels（短系列补零）', () => {
    const composed = composeFor('chart', { chart: { chartType: 'column', labels: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ name: '营收', values: [1] }] } })
    const chart = composed.elements.find(e => e.kind === 'chart')
    expect(chart && chart.kind === 'chart' && chart.series[0].values).toEqual([1, 0, 0, 0])
  })

  it('表格列数不齐时自动补齐（TABLE_RAGGED 是 error）', () => {
    const result = validatePage(pageOf('table', { table: { header: ['A', 'B', 'C'], rows: [['只有一列']] } }), { tokens })
    expect(result.issues.filter(i => i.rule === 'TABLE_RAGGED')).toEqual([])
  })

  it('image-text 未登记的 assetId 降级为占位框并说明（ASSET_MISSING 是 error，必须消化）', () => {
    const composed = composeSceneFromContent(
      { title: '图', image: { assetId: 'nonexistent', heading: 'h', items: ['a'] } },
      { type: 'image-text', title: '图', contentBrief: '概要' },
      tokens,
    )
    const image = composed.elements.find(e => e.kind === 'image')
    expect(image && image.kind === 'image' && image.placeholder).toBeDefined()
    expect(composed.layoutNotes.some(n => n.includes('未登记'))).toBe(true)
  })

  it('缺页型必需字段时给出各页型字段对照的报错', () => {
    expect(() => composeFor('timeline', { events: undefined })).toThrow(/timeline/)
    expect(() => composeFor('cards', { cards: undefined })).toThrow(/cards/)
    // bullets 缺 items 时按设计回落到蓝图概要切分（不报错）
    expect(() => composeFor('bullets', { items: undefined })).not.toThrow()
  })

  it('items 缺省时从蓝图概要切分兜底', () => {
    const composed = composeSceneFromContent(
      { title: 'T' },
      { type: 'bullets', title: 'T', contentBrief: '第一句概要。第二句概要。第三句概要。' },
      tokens,
    )
    const body = composed.elements.find(e => e.id.startsWith('t-body'))
    expect(body && body.kind === 'text' && body.paragraphs.length).toBe(3)
  })

  it('封面背景为令牌渐变、底部装饰条存在', () => {
    const page = pageOf('cover')
    expect(page.background?.gradient?.from).toBe(tokens.colors.primary)
    expect(page.elements!.some(e => e.kind === 'shape' && e.background === true && e.y >= 7.0)).toBe(true)
  })

  it('splitSentences 按句切分并限量', () => {
    expect(splitSentences('一句。两句。三句。', 2)).toEqual(['一句。', '两句。'])
    expect(splitSentences('', 3)).toEqual([])
  })
})
