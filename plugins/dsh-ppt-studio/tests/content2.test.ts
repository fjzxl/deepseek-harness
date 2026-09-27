/**
 * content 2.0（0.17.0）单测：版式意图词表（layout）+ 图示 JSON（illustration）+ 扉页扩容判定。
 * 设计契约：模型做构图选择题、代码执行坐标——全部变体产物必须通过全部 error 级校验，
 * 且几何与默认版式确有差异（变体不是摆设）；图示 JSON 渲染的 SVG 颜色全部来自锁定令牌。
 */
import { describe, expect, it } from 'vitest'
import { composeSceneFromContent, type PageContentInput } from '../src/autolayout.js'
import { buildDesignTokens, getTheme } from '../src/themes.js'
import { validatePage } from '../src/validate.js'
import { isSectionOverflow } from '../src/tools/outline.js'
import type { PageScene } from '../src/schema.js'

const tokens = buildDesignTokens(getTheme('business-blue')!, { density: 'normal' })

function compose(type: PageContentInput['type'] & string, content: PageContentInput): { page: PageScene; notes: string[] } {
  const composed = composeSceneFromContent(content, { type, title: (content.title as string) ?? 'T', contentBrief: '概要句一。概要句二。' }, tokens)
  const page: PageScene = {
    id: 'p001', sectionId: 's1', type,
    ...(composed.background !== undefined ? { background: composed.background } : {}),
    elements: composed.elements,
  }
  return { page, notes: composed.layoutNotes }
}

function expectClean(page: PageScene, label: string): void {
  const result = validatePage(page, { tokens })
  expect(result.ok, `${label}: ${result.issues.filter(i => i.level === 'error').map(i => `${i.rule}:${i.message}`).join('；')}`).toBe(true)
}

describe('0.17.0 版式意图词表（layout）', () => {
  const flowContent = (layout?: PageContentInput['layout']): PageContentInput => ({
    type: 'process',
    title: '推理流水线',
    steps: [{ name: '分词', desc: '切分为 token' }, { name: '编码', desc: '映射为向量' }, { name: '解码', desc: '自回归生成' }],
    layout,
  })

  it('全部变体通过 error 级校验（核心不变量延伸）', () => {
    const cases: Array<[string, PageContentInput]> = [
      ['image-right', { type: 'image-text', title: 'T', image: { illustration: { kind: 'flow', nodes: [{ label: 'A' }, { label: 'B' }] } }, layout: { variant: 'image-right', split: 35 } }],
      ['image-top', { type: 'image-text', title: 'T', image: { illustration: { kind: 'flow', nodes: [{ label: 'A' }, { label: 'B' }] } }, layout: { variant: 'image-top' } }],
      ['two-col split60+line+tint', { type: 'two-col', title: 'T', columns: [{ title: '左', items: ['a'] }, { title: '右', items: ['b'] }], layout: { split: 60, divider: 'line', card: 'tint' } }],
      ['comparison split40 plain', { type: 'comparison', title: 'T', columns: [{ title: '前', items: ['a'] }, { title: '后', items: ['b'] }], layout: { split: 40, card: 'plain' } }],
      ['process steps', flowContent({ variant: 'steps' })],
      ['cards row+tint', { type: 'cards', title: 'T', cards: [{ title: 'A', desc: '描述一' }, { title: 'B', desc: '描述二' }], layout: { variant: 'row', card: 'tint' } }],
      ['timeline horizontal', { type: 'timeline', title: 'T', events: [{ label: '2019', desc: '事件一' }, { label: '2021', desc: '事件二' }, { label: '2023', desc: '事件三' }], layout: { variant: 'horizontal' } }],
    ]
    for (const [label, content] of cases) expectClean(compose(content.type, content).page, label)
  })

  it('image-right：图区在右侧、文字在左侧（几何确有差异）', () => {
    const { page } = compose('image-text', { type: 'image-text', title: 'T', image: { illustration: { kind: 'flow', nodes: [{ label: 'A' }, { label: 'B' }] } }, layout: { variant: 'image-right' } })
    const img = page.elements.find(e => e.kind === 'image') as { x: number }
    const heading = page.elements.find(e => e.id.startsWith('ith')) as { x: number }
    expect(img.x).toBeGreaterThan(6)
    expect(heading.x).toBeLessThan(2)
  })

  it('two-col split=60：左栏宽于右栏', () => {
    const { page } = compose('two-col', { type: 'two-col', title: 'T', columns: [{ title: 'L', items: ['a'] }, { title: 'R', items: ['b'] }], layout: { split: 60 } })
    const cards = page.elements.filter(e => e.kind === 'shape' && e.id.startsWith('card')) as Array<{ w: number }>
    expect(cards[0]!.w).toBeGreaterThan(cards[1]!.w + 1)
  })

  it('未知 variant 回落默认并记 layoutNote（不拒绝）', () => {
    const { notes } = compose('process', flowContent({ variant: 'diagonal' }))
    expect(notes.some(n => n.includes('diagonal') && n.includes('回落'))).toBe(true)
  })

  it('plain 卡片不产生 roundRect（EMPTY_CONTAINER 天然免疫）', () => {
    const { page } = compose('cards', { type: 'cards', title: 'T', cards: [{ title: 'A', desc: 'd' }, { title: 'B', desc: 'd' }], layout: { card: 'plain' } })
    expect(page.elements.some(e => e.kind === 'shape' && e.shape === 'roundRect')).toBe(false)
  })
})

describe('0.17.0 图示 JSON（illustration → 代码渲染 SVG）', () => {
  it('flow：产出 image.svg，颜色全部来自锁定令牌（TOKEN_COLOR 零违规）', () => {
    const { page, notes } = compose('image-text', {
      type: 'image-text', title: '事件驱动',
      image: { illustration: { kind: 'flow', title: '下单事件流', nodes: [{ label: '订单服务', sub: '发布事件' }, { label: 'Event Bus' }, { label: '订阅者', sub: '各自消费' }] } },
    })
    const img = page.elements.find(e => e.kind === 'image') as { svg?: string }
    expect(img.svg).toBeDefined()
    expect(img.svg).toContain('viewBox')
    expect(img.svg).toContain('订单服务')
    expect(notes.some(n => n.includes('illustration'))).toBe(true)
    expectClean(page, 'illustration-flow')
  })

  it('layers：层级条自上而下且宽度递增', () => {
    const { page } = compose('image-text', {
      type: 'image-text', title: 'T',
      image: { illustration: { kind: 'layers', nodes: [{ label: '应用层' }, { label: '编排层' }, { label: '模型层' }] } },
    })
    const img = page.elements.find(e => e.kind === 'image') as { svg?: string }
    expect(img.svg).toContain('应用层')
    const widths = [...(img.svg ?? '').matchAll(/width="(\d+(?:\.\d+)?)" height="6\d"/g)].map(m => Number(m[1]))
    expect(widths.length).toBeGreaterThanOrEqual(3)
    expect(widths[widths.length - 1]!).toBeGreaterThan(widths[0]!)
    expectClean(page, 'illustration-layers')
  })

  it('0.20.0 venn：2/3 集合出圆片半透明叠加，颜色守锁', () => {
    for (const n of [2, 3]) {
      const sets = [{ label: '需求方' }, { label: '供给方' }, { label: '平台' }].slice(0, n)
      const { page } = compose('image-text', {
        type: 'image-text', title: 'T',
        image: { illustration: { kind: 'venn', title: '三方匹配', nodes: sets } },
      })
      const img = page.elements.find(e => e.kind === 'image') as { svg?: string }
      expect((img.svg ?? '').match(/<circle /g)?.length).toBe(n)
      expect(img.svg).toContain('fill-opacity="0.30"')
      expect(img.svg).toContain('需求方')
      expectClean(page, `illustration-venn-${String(n)}`)
    }
  })

  it('0.20.0 matrix：恰好 4 象限卡，超量截断到 4', () => {
    const nodes = [
      { label: '明星', sub: '高增长高份额' },
      { label: '金牛', sub: '低增长高份额' },
      { label: '问题', sub: '高增长低份额' },
      { label: '瘦狗', sub: '低增长低份额' },
      { label: '多余', sub: '应被截断' },
    ]
    const { page } = compose('image-text', { type: 'image-text', title: 'T', image: { illustration: { kind: 'matrix', nodes } } })
    const img = page.elements.find(e => e.kind === 'image') as { svg?: string }
    expect((img.svg ?? '').match(/<rect /g)?.length).toBe(5) // 4 象限卡 + 1 底色
    expect(img.svg).toContain('明星')
    expect(img.svg).not.toContain('多余')
    expectClean(page, 'illustration-matrix')
  })

  it('0.20.0 tree：根盒 + 肘形母线 + ≤5 子盒', () => {
    const nodes = [{ label: '设计模式', sub: 'GoF 23' }, { label: '创建型' }, { label: '结构型' }, { label: '行为型' }]
    const { page } = compose('image-text', { type: 'image-text', title: 'T', image: { illustration: { kind: 'tree', nodes } } })
    const img = page.elements.find(e => e.kind === 'image') as { svg?: string }
    expect(img.svg).toContain('设计模式')
    expect((img.svg ?? '').match(/<line /g)?.length).toBeGreaterThanOrEqual(5) // 根竖线+母线+3 子竖线
    expect(img.svg).toContain('创建型')
    expectClean(page, 'illustration-tree')
  })

  it('0.22.x pyramid：梯形层 ≤5 + 右侧标签列 + 虚线引导', () => {
    const nodes = [
      { label: '顶层战略', sub: '定方向' }, { label: '业务架构' }, { label: '平台能力' }, { label: '基础设施' },
      { label: '第五层超量' }, { label: '第六层超量' },
    ]
    const { page } = compose('image-text', { type: 'image-text', title: 'T', image: { illustration: { kind: 'pyramid', title: '能力分层', nodes } } })
    const img = page.elements.find(e => e.kind === 'image') as { svg?: string }
    expect((img.svg ?? '').match(/<polygon /g)?.length).toBe(5) // 5 层截断
    expect(img.svg).toContain('顶层战略')
    expect(img.svg).toContain('stroke-dasharray') // 右侧标签引导线
    expect(img.svg).not.toContain('第六层超量')
    expectClean(page, 'illustration-pyramid')
  })

  it('0.22.x funnel：上宽下窄条带，label/sub 入带内', () => {
    const nodes = [
      { label: '曝光 100%', sub: '首页推荐' }, { label: '点击 30%' }, { label: '加购 12%' },
      { label: '下单 6%', sub: '支付完成' },
    ]
    const { page } = compose('image-text', { type: 'image-text', title: 'T', image: { illustration: { kind: 'funnel', nodes } } })
    const img = page.elements.find(e => e.kind === 'image') as { svg?: string }
    const polygons = [...(img.svg ?? '').matchAll(/<polygon points="([\d., ]+)"/g)].map(m => m[1]!)
    expect(polygons.length).toBe(4)
    const span = (points: string): number => {
      const xs = points.split(' ').map(pair => Number(pair.split(',')[0]))
      return Math.max(...xs) - Math.min(...xs)
    }
    expect(span(polygons[0]!)).toBeGreaterThan(span(polygons[3]!)!) // 首段宽于末段
    expect(img.svg).toContain('首页推荐')
    expectClean(page, 'illustration-funnel')
  })

  it('0.22.x cycle：环形节点徽章 + 顺时针弧箭头，≤6 节点', () => {
    for (const n of [3, 6]) {
      const labels = ['获取', '激活', '留存', '变现', '推荐', '多余六']
      const { page } = compose('image-text', {
        type: 'image-text', title: 'T',
        image: { illustration: { kind: 'cycle', title: '增长飞轮', nodes: labels.slice(0, n).map(label => ({ label })) } },
      })
      const img = page.elements.find(e => e.kind === 'image') as { svg?: string }
      expect((img.svg ?? '').match(/<circle /g)?.length).toBe(n) // 节点徽章（弧箭头是 path 不是 circle）
      expect((img.svg ?? '').match(/<path d="M [^"]* A /g)?.length).toBe(n) // 每段一条弧
      expect(img.svg).toContain('增长飞轮')
      if (n === 3) expect(img.svg).not.toContain('多余六')
      expectClean(page, `illustration-cycle-${String(n)}`)
    }
  })
})

describe('0.17.0 扉页扩容判定（isSectionOverflow）', () => {
  const p = (type: string): { type: string } => ({ type })

  it('多 1 页且含 section 型 → 扩容（真实事故形态：7 分配传 8 页含扉页）', () => {
    expect(isSectionOverflow(7, [p('section'), p('bullets'), p('bullets'), p('bullets'), p('bullets'), p('bullets'), p('bullets'), p('bullets')])).toBe(true)
  })
  it('恰好等于分配 / 多 2 页 / 多出但无 section 型 / 无分配 → 不扩', () => {
    expect(isSectionOverflow(7, Array.from({ length: 7 }, () => p('bullets')))).toBe(false)
    expect(isSectionOverflow(7, Array.from({ length: 9 }, () => p('bullets')))).toBe(false)
    expect(isSectionOverflow(7, Array.from({ length: 8 }, () => p('cards')))).toBe(false)
    expect(isSectionOverflow(undefined, [p('section'), p('bullets')])).toBe(false)
  })
})
