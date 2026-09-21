/**
 * ppt_page_write content 内容模式 + 弱模型辅助闩锁 + ppt_page_skeleton 集成单测。
 * 直接调用 ToolDefinition.execute（不经 withDiagnostics 包装），用临时工作区驱动完整落盘路径。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { resolvePptStudioConfig } from '../src/config.js'
import { DeckStore } from '../src/deck-store.js'
import { createPageTools } from '../src/tools/page.js'
import { createSkeletonTools } from '../src/tools/skeleton.js'
import { createToolLogger } from '../src/toollog.js'
import { buildDesignTokens, getTheme } from '../src/themes.js'
import { PLUGIN_VERSION } from '../src/version.js'

const tempRoots: string[] = []
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

interface Fixture {
  rootDir: string
  deckId: string
  pageWrite: (args: unknown) => Promise<unknown>
  skeleton: (args: unknown) => Promise<unknown>
  store: DeckStore
}

async function createFixture(options: { renderRoute?: 'native' | 'svg' } = {}): Promise<Fixture> {
  const workspace = await mkdtemp(join(tmpdir(), 'ppt-studio-test-'))
  tempRoots.push(workspace)
  const exec = { agent: { session: { header: { cwd: workspace } } } }
  const config = resolvePptStudioConfig({})
  const store = new DeckStore(join(workspace, 'ppt-studio'))
  const { deckId } = await store.create('测试 deck')
  const tokens = buildDesignTokens(getTheme('business-blue')!, { density: 'normal' })
  await store.saveJson(store.paths(deckId).tokens, tokens)
  await store.saveJson(store.paths(deckId).brief, {
    deckId,
    title: '测试 deck',
    topic: '测试',
    audience: '工程师',
    scenario: '单测',
    objective: '验证',
    themeId: 'business-blue',
    renderRoute: options.renderRoute ?? 'native',
    evidenceLevel: 'none',
    strictness: 'normal',
    confirmedAt: new Date().toISOString(),
  })
  await store.saveJson(store.paths(deckId).outline, {
    parts: [
      { id: 's1', title: '第一部分', question: 'Q1？', message: 'A1', suggestedPages: 2 },
      { id: 's2', title: '第二部分', question: 'Q2？', message: 'A2', suggestedPages: 1 },
    ],
    coreMessage: '核心主张',
    pages: [
      { id: 'p001', sectionId: 's0', type: 'cover', title: '封面', contentBrief: '封面页', structure: 'plain', density: 'medium', visual: 'none' },
      { id: 'p002', sectionId: 's0', type: 'toc', title: '目录', contentBrief: '目录页', structure: 'plain', density: 'medium', visual: 'none' },
      { id: 'p003', sectionId: 's0', type: 'closing', title: '结尾', contentBrief: '结尾页', structure: 'plain', density: 'medium', visual: 'none' },
      { id: 'p004', sectionId: 's1', type: 'bullets', title: '要点页', contentBrief: '第一句概要。第二句概要。', structure: 'plain', density: 'medium', visual: 'none' },
      { id: 'p005', sectionId: 's1', type: 'chart', title: '数据页', contentBrief: '增长数据示意。', structure: 'data-insight', density: 'medium', visual: 'chart' },
      { id: 'p006', sectionId: 's2', type: 'image-text', title: '图文页', contentBrief: '图文页概要。补充说明一句。', structure: 'concept-example', density: 'medium', visual: 'image' },
    ],
  })
  const pageWrite = createPageTools(config)[0]!.execute
  const skeleton = createSkeletonTools(config)[0]!.execute
  return {
    rootDir: store.rootDir,
    deckId,
    pageWrite: (args: unknown) => pageWrite(args, exec),
    skeleton: (args: unknown) => skeleton(args, exec),
    store,
  }
}

describe('ppt_page_write content 内容模式', () => {
  it('bullets 内容模式：只传 items 即落盘，产物通过校验', async () => {
    const f = await createFixture()
    const result = (await f.pageWrite({ deckId: f.deckId, pageId: 'p004', scene: { content: { items: ['要点一', '要点二', '要点三'] } } })) as Record<string, unknown>
    expect(result.ok).toBe(true)
    expect(result.source).toBe('content')
    const page = JSON.parse(readFileSync(join(f.store.paths(f.deckId).pagesDir, 'p004.json'), 'utf8'))
    expect(page.type).toBe('bullets')
    expect(page.title).toBe('要点页') // title 缺省取蓝图
    expect(page.elements.length).toBeGreaterThan(0)
    expect(page.content).toBeUndefined() // 落盘是展开后的普通场景
  })

  it('chart 内容模式：图表 + 结论栏落盘', async () => {
    const f = await createFixture()
    const result = (await f.pageWrite({
      deckId: f.deckId,
      pageId: 'p005',
      scene: { content: { chart: { chartType: 'column', labels: ['Q1', 'Q2'], series: [{ name: '营收', values: [10, 20] }], conclusion: '稳步增长' } } },
    })) as Record<string, unknown>
    expect(result.ok).toBe(true)
    const page = JSON.parse(readFileSync(join(f.store.paths(f.deckId).pagesDir, 'p005.json'), 'utf8'))
    expect(page.elements.some((e: { kind: string }) => e.kind === 'chart')).toBe(true)
  })

  it('content 模式整页重写既有页：不触发丢元素闸门', async () => {
    const f = await createFixture()
    await f.pageWrite({ deckId: f.deckId, pageId: 'p004', scene: { content: { items: ['初版'] } } })
    const result = (await f.pageWrite({ deckId: f.deckId, pageId: 'p004', scene: { content: { items: ['重写后的要点'] } } })) as Record<string, unknown>
    expect(result.ok).toBe(true)
  })

  it('content 模式产物上 append 微调（elements 小步替换）可用', async () => {
    const f = await createFixture()
    await f.pageWrite({ deckId: f.deckId, pageId: 'p004', scene: { content: { items: ['占位一', '占位二'] } } })
    const page = JSON.parse(readFileSync(join(f.store.paths(f.deckId).pagesDir, 'p004.json'), 'utf8'))
    const bodyId = page.elements.find((e: { kind: string }) => e.kind === 'text' && e.id.startsWith('t-body')).id
    const result = (await f.pageWrite({
      deckId: f.deckId,
      pageId: 'p004',
      append: true,
      scene: { elements: [{ kind: 'text', id: bodyId, x: 0.9, y: 1.7, w: 11.5, h: 5.0, fontSize: 16, color: '#1F2937', paragraphs: [{ text: '正式要点', bullet: true }] }] },
    })) as Record<string, unknown>
    expect(result.ok).toBe(true)
    expect(result.source).toBe('append')
  })

  it('svg 路线 deck 拒绝 content 模式', async () => {
    const f = await createFixture({ renderRoute: 'svg' })
    await expect(f.pageWrite({ deckId: f.deckId, pageId: 'p004', scene: { content: { items: ['a'] } } })).rejects.toThrow(/svg 渲染路线/)
  })

  it('content 字段形态错误：报错含各页型字段对照与示例', async () => {
    const f = await createFixture()
    await expect(f.pageWrite({ deckId: f.deckId, pageId: 'p004', scene: { content: { items: [] } } })).rejects.toThrow(/bullets.*items|items.*bullets|content\./s)
  })
})

describe('content 内容模式的 {item:} 包装容错', () => {
  // 真实会话（2026-09-20 d20260920-234200-0442）：模型把语义数组序列化为 {"item":[...]}
  // （XML 风格包装），三页连败触发熔断。deepRepair 应在 content 路径同样还原为纯数组。
  it('bullets：content.items 为 {item:[...]} 时自动还原并落盘', async () => {
    const f = await createFixture()
    const result = (await f.pageWrite({
      deckId: f.deckId,
      pageId: 'p004',
      scene: { content: { title: '大模型本质上是一台『接话机器』', items: { item: ['问 GPT 一个问题 = 让它接下一个最像答案的字', '它见过上千亿个词，能接出极多种上下文', '它的强项是看起来合理，不是保证正确'] } } },
    })) as Record<string, unknown>
    expect(result.ok).toBe(true)
    expect(result.source).toBe('content')
    const page = JSON.parse(readFileSync(join(f.store.paths(f.deckId).pagesDir, 'p004.json'), 'utf8'))
    expect(page.type).toBe('bullets')
    expect(page.elements.length).toBeGreaterThan(0)
  })

  it('two-col：content.columns 与嵌套 columns[].items 均为 {item:} 包装时还原', async () => {
    const f = await createFixture()
    const result = (await f.pageWrite({
      deckId: f.deckId,
      pageId: 'p004',
      scene: { content: { type: 'two-col', title: '对比', columns: { item: [
        { title: '手机输入法自动补全', items: { item: ['几十 MB 词表', '1 步接话', '中文纠错'] } },
        { title: '大模型', items: { item: ['上千亿词', '多步接话', '上下文理解'] } },
      ] } } },
    })) as Record<string, unknown>
    expect(result.ok).toBe(true)
    const page = JSON.parse(readFileSync(join(f.store.paths(f.deckId).pagesDir, 'p004.json'), 'utf8'))
    expect(page.type).toBe('two-col')
  })

  it('timeline：content.events 为 {item:} 包装时还原', async () => {
    const f = await createFixture()
    const result = (await f.pageWrite({
      deckId: f.deckId,
      pageId: 'p004',
      scene: { content: { type: 'timeline', title: 'AI 三波浪潮', events: { item: [
        { label: '1950s–1980s', desc: '规则系统：世界知识写不完' },
        { label: '1990s–2010s', desc: '统计学习：从规则走向数据' },
        { label: '2010s 至今', desc: '深度学习：规模取胜' },
      ] } } },
    })) as Record<string, unknown>
    expect(result.ok).toBe(true)
    const page = JSON.parse(readFileSync(join(f.store.paths(f.deckId).pagesDir, 'p004.json'), 'utf8'))
    expect(page.type).toBe('timeline')
  })
})

describe('弱模型辅助闩锁', () => {
  it('连续失败 ≥3 次后开启：裸 elements 整页替换被拒，content 与 append 不受限', async () => {
    const f = await createFixture()
    // 预置 2 条历史失败（plugin.log），第 3 次失败发生在本次调用内 → 闩锁开启
    const toolLogger = createToolLogger(f.rootDir)
    toolLogger.record({ tool: 'ppt_page_write', argsForm: 'object', frozen: false, outcome: 'error', durationMs: 1 })
    toolLogger.record({ tool: 'ppt_page_write', argsForm: 'object', frozen: false, outcome: 'error', durationMs: 1 })
    await toolLogger.flush()

    // 第 3 次失败：缺坐标的元素 → zod 拒绝，报错附带 🔔 开启通知
    await expect(f.pageWrite({ deckId: f.deckId, pageId: 'p004', scene: { elements: [{ kind: 'text', id: 'bad' }] } }))
      .rejects.toThrow(/弱模型辅助模式已开启/)
    const state = await f.store.loadState(f.deckId)
    expect(state?.weakModelAssist?.reason).toMatch(/连续失败 3 次/)

    // 裸 elements 整页替换（合法内容）也被拒
    await expect(f.pageWrite({
      deckId: f.deckId, pageId: 'p004',
      scene: { elements: [{ kind: 'text', id: 't1', x: 0.6, y: 1.7, w: 11.5, h: 4, fontSize: 16, color: '#1F2937', paragraphs: [{ text: 'a' }] }] },
    })).rejects.toThrow(/弱模型辅助模式已开启/)

    // content 模式不受限，正常落盘
    const okResult = (await f.pageWrite({ deckId: f.deckId, pageId: 'p004', scene: { content: { items: ['要点'] } } })) as Record<string, unknown>
    expect(okResult.ok).toBe(true)

    // append 增量不受限
    const appendResult = (await f.pageWrite({
      deckId: f.deckId, pageId: 'p004', append: true,
      scene: { elements: [{ kind: 'text', id: 'extra', x: 0.9, y: 6.9, w: 11.5, h: 0.4, fontSize: 11, color: '#64748B', paragraphs: [{ text: '注' }] }] },
    })) as Record<string, unknown>
    expect(appendResult.ok).toBe(true)

    // 用户明确要求可 overrideAssist 恢复完整元素模式（既有页重写需 allowDrop 确认丢弃）
    const overrideResult = (await f.pageWrite({
      deckId: f.deckId, pageId: 'p004', overrideAssist: true, allowDrop: true,
      scene: { elements: [{ kind: 'text', id: 't1', x: 0.6, y: 1.7, w: 11.5, h: 4, fontSize: 16, color: '#1F2937', paragraphs: [{ text: '手写模式' }] }] },
    })) as Record<string, unknown>
    expect(overrideResult.ok).toBe(true)
  })

  it('失败不足 3 次不开启闩锁', async () => {
    const f = await createFixture()
    const toolLogger = createToolLogger(f.rootDir)
    toolLogger.record({ tool: 'ppt_page_write', argsForm: 'object', frozen: false, outcome: 'error', durationMs: 1 })
    await toolLogger.flush()
    await expect(f.pageWrite({ deckId: f.deckId, pageId: 'p004', scene: { elements: [{ kind: 'text', id: 'bad' }] } })).rejects.toThrow(/schema/)
    const state = await f.store.loadState(f.deckId)
    expect(state?.weakModelAssist).toBeUndefined()
  })
})

describe('ppt_page_skeleton 骨架工具', () => {
  it('按蓝图生成合法骨架页并落盘，返回元素 id 清单', async () => {
    const f = await createFixture()
    const result = (await f.skeleton({ deckId: f.deckId, pageId: 'p004' })) as Record<string, unknown>
    expect(result.ok).toBe(true)
    expect(result.skeleton).toBe(true)
    expect(Array.isArray(result.elementIds) && result.elementIds.length).toBeGreaterThan(0)
    const page = JSON.parse(readFileSync(join(f.store.paths(f.deckId).pagesDir, 'p004.json'), 'utf8'))
    expect(page.elements.length).toBeGreaterThan(0)
    expect(page.notes).toMatch(/骨架页/)
  })

  it('toc 骨架用真实章节标题；chart 骨架带示意数据', async () => {
    const f = await createFixture()
    await f.skeleton({ deckId: f.deckId, pageId: 'p002' })
    const toc = JSON.parse(readFileSync(join(f.store.paths(f.deckId).pagesDir, 'p002.json'), 'utf8'))
    const tocText = toc.elements.filter((e: { kind: string }) => e.kind === 'text').map((e: { paragraphs: { text?: string }[] }) => e.paragraphs.map(p => p.text ?? '').join('')).join('|')
    expect(tocText).toContain('第一部分')

    await f.skeleton({ deckId: f.deckId, pageId: 'p005' })
    const chart = JSON.parse(readFileSync(join(f.store.paths(f.deckId).pagesDir, 'p005.json'), 'utf8'))
    expect(chart.elements.some((e: { kind: string }) => e.kind === 'chart')).toBe(true)
  })

  it('svg 路线 deck 拒绝骨架工具', async () => {
    const f = await createFixture({ renderRoute: 'svg' })
    await expect(f.skeleton({ deckId: f.deckId, pageId: 'p004' })).rejects.toThrow(/svg 渲染路线/)
  })

  it('骨架后 content 模式整页重写（弱模型主路径串联）', async () => {
    const f = await createFixture()
    await f.skeleton({ deckId: f.deckId, pageId: 'p006' })
    const result = (await f.pageWrite({ deckId: f.deckId, pageId: 'p006', scene: { content: { image: { prompt: '建议配图' }, heading: '标题', items: ['一', '二'] } } })) as Record<string, unknown>
    expect(result.ok).toBe(true)
  })
})

describe('版本一致性', () => {
  it('PLUGIN_VERSION 与 package.json 版本一致', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    expect(PLUGIN_VERSION).toBe(pkg.version)
  })
})
