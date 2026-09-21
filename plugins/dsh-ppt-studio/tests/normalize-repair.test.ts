/**
 * deepRepair 归一回归：载荷全部取自真实会话失败入参（sessionlog 2026-09-20，
 * MiniMax-M3 的 XML 风格序列化），修复前分别被 zod 以
 * "Expected array, received object" / bullet 形态拒绝。
 */
import { describe, expect, it } from 'vitest'
import { deepRepair, normalizeSceneInput } from '../src/normalize.js'
import { contentInputSchema } from '../src/autolayout.js'
import { textElementSchema } from '../src/schema.js'

/** session 真实载荷：bullets 页 items 被包成 {"item":[…]}（0.11.1 修复路径回归） */
const contentItemsWrapped = {
  deckId: 'd20260920-234200-0442',
  pageId: 'p003',
  scene: {
    content: {
      title: '大模型本质上是一台『接话机器』',
      items: { item: ['问 GPT 一个问题 = 让它『接下一个最像答案的字』', '它见过上千亿个词，能接出极多种上下文', '见过足够多之后，接话会『看起来像懂』', '它的强项是『看起来合理』，不是『保证正确』'] },
      notes: '开口说：『你们以为它什么都懂，其实它只做一件事：接下一个字。』',
    },
  },
}

/** session 真实载荷：two-col 页 columns 与嵌套 items 双层包装（0.11.1 修复路径回归） */
const contentColumnsWrapped = {
  scene: {
    content: {
      title: '它和手机自动补全是同一种东西，只是『见得多得多』',
      columns: {
        item: [
          { title: '手机输入法自动补全', items: { item: ['几十 MB 词表 + 简单统计', '1 步接话', '中文纠错、选词'] } },
          { title: '大模型（GPT 类）', items: { item: ['上千亿字训练数据 + 1750 亿参数', '几百步连贯生成', '写作 / 总结 / 翻译 / 推理 / 编程 / 绘图'] } },
        ],
      },
    },
  },
}

/** session 真实载荷：timeline 页 events 包装（0.11.1 修复路径回归） */
const contentEventsWrapped = {
  scene: {
    content: {
      title: 'AI 走过的三波浪潮',
      events: {
        item: [
          { label: '1950s–1980s · 规则系统', desc: '专家系统、知识工程；瓶颈：世界知识写不完。' },
          { label: '1990s–2010s · 统计学习', desc: '让机器从『按规则』走向『按数据』；瓶颈：特征要人工设计。' },
          { label: '2010s 至今 · 深度学习 + 大模型', desc: 'Transformer + 算力 + 数据三量级同时扩张。' },
        ],
      },
    },
  },
}

/** session 真实载荷：elements 路径 bullet/lineSpacing 被包成 {"$text":…}（0.11.2 修复路径） */
const elementsTextWrapped = {
  scene: {
    elements: [
      {
        id: 't-body1', kind: 'text', x: 0.9, y: 1.7, w: 11.5, h: 5, fontSize: 16, color: '#1E3A34',
        font: 'Microsoft YaHei', align: 'left', valign: 'top',
        paragraphs: [
          { text: '问 GPT 一个问题 = 让它『接下一个最像答案的字』', bullet: { $text: 'true' }, lineSpacing: { $text: '1.4' }, spaceAfter: 14 },
          { text: '它见过上千亿个词，能接出极多种上下文', bullet: { $text: 'true' }, lineSpacing: { $text: '1.4' }, spaceAfter: 14 },
        ],
      },
    ],
  },
}

describe('deepRepair：session 2026-09-20 真实失败载荷', () => {
  it('bullets 页 items {"item":[…]} → 还原为数组并通过 content schema', () => {
    const { scene } = normalizeSceneInput(contentItemsWrapped.scene)
    const parsed = contentInputSchema.safeParse(scene?.content)
    expect(parsed.success).toBe(true)
    expect((scene as { content: { items: unknown[] } }).content.items).toHaveLength(4)
  })

  it('two-col 页 columns + 嵌套 items 双层包装 → 递归还原并通过 content schema', () => {
    const { scene } = normalizeSceneInput(contentColumnsWrapped.scene)
    const parsed = contentInputSchema.safeParse(scene?.content)
    expect(parsed.success).toBe(true)
    const columns = (scene as { content: { columns: Array<{ items: unknown[] }> } }).content.columns
    expect(columns).toHaveLength(2)
    expect(columns[0]!.items).toHaveLength(3)
  })

  it('timeline 页 events 包装 → 还原并通过 content schema', () => {
    const { scene } = normalizeSceneInput(contentEventsWrapped.scene)
    const parsed = contentInputSchema.safeParse(scene?.content)
    expect(parsed.success).toBe(true)
  })

  it('elements 路径 bullet/lineSpacing {"$text":…} → 剥回标量并通过 text 元素 schema', () => {
    const { scene } = normalizeSceneInput(elementsTextWrapped.scene)
    const element = (scene as { elements: unknown[] }).elements[0]!
    const parsed = textElementSchema.safeParse(element)
    expect(parsed.success).toBe(true)
    const paragraphs = (element as { paragraphs: Array<{ bullet: unknown; lineSpacing: unknown }> }).paragraphs
    expect(paragraphs[0]!.bullet).toBe(true)
    expect(paragraphs[0]!.lineSpacing).toBe(1.4)
  })

  it('{$text} 剥离不碰合法对象：bullet:{marker} 与非标量内值保持原样', () => {
    const repaired = deepRepair({
      bullet: { marker: '•' },
      outer: { $text: { nested: true } },
      plain: { $text: 'true' },
    }) as Record<string, unknown>
    expect(repaired.bullet).toEqual({ marker: '•' })
    expect(repaired.outer).toEqual({ $text: { nested: true } })
    expect(repaired.plain).toBe('true')
  })
})
