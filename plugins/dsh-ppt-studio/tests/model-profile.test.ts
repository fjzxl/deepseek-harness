/**
 * 0.14.0 模型档位（modelProfile weak/strong）与 elements 表达面扩充：
 *   - 简报默认值（strong 档未指定 mode 时默认 quick；显式 mode 优先）
 *   - 弱模型辅助闩锁在 strong 档不自动开启（失败 3 次仍不落闩锁）
 *   - 新形状（hexagon/star5 等）+ rotation 通过 schema 与确定性校验
 *   - 双渲染器（HTML/PPTX）消费新形状与 rotation 不报错，HTML 端输出 rotate 变换
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { resolvePptStudioConfig } from '../src/config.js'
import { DeckStore } from '../src/deck-store.js'
import { createBriefTools } from '../src/tools/brief.js'
import { createPageTools } from '../src/tools/page.js'
import { createToolLogger } from '../src/toollog.js'
import { buildDesignTokens, getTheme, resolveDesignTheme } from '../src/themes.js'
import { renderDeckHtml } from '../src/render-html.js'
import { renderDeckPptx } from '../src/render-pptx.js'
import { PLUGIN_VERSION } from '../src/version.js'

const tempRoots: string[] = []
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

interface Fixture {
  rootDir: string
  deckId: string
  pageWrite: (args: unknown) => Promise<unknown>
  store: DeckStore
}

async function createFixture(options: { modelProfile?: 'weak' | 'strong' } = {}): Promise<Fixture> {
  const workspace = await mkdtemp(join(tmpdir(), 'ppt-studio-profile-'))
  tempRoots.push(workspace)
  const exec = { agent: { session: { header: { cwd: workspace } } } }
  const config = resolvePptStudioConfig({})
  const store = new DeckStore(join(workspace, 'ppt-studio'))
  const { deckId } = await store.create('档位测试 deck')
  const theme = getTheme('business-blue')!
  await store.saveJson(store.paths(deckId).tokens, buildDesignTokens(theme, { density: 'normal' }))
  await store.saveJson(store.paths(deckId).brief, {
    deckId,
    title: '档位测试 deck',
    topic: '测试',
    audience: '工程师',
    scenario: '单测',
    objective: '验证',
    themeId: 'business-blue',
    renderRoute: 'native',
    evidenceLevel: 'none',
    strictness: 'normal',
    ...(options.modelProfile !== undefined ? { modelProfile: options.modelProfile } : {}),
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
    ],
  })
  const pageWrite = createPageTools(config)[0]!.execute
  const briefCreate = createBriefTools(config)[0]!.execute
  return {
    rootDir: store.rootDir,
    deckId,
    pageWrite: (args: unknown) => pageWrite(args, exec),
    store,
    // brief 测试在用例内单独调用（需要自己的工作区断言）
    briefCreate: (args: unknown) => briefCreate(args, exec),
  } as Fixture & { briefCreate: (args: unknown) => Promise<unknown> }
}

describe('模型档位（0.14.0）', () => {
  it('brief：未指定 modelProfile 时默认 weak；strong 档未指定 mode 时默认 quick', async () => {
    const f = (await createFixture()) as Fixture & { briefCreate: (args: unknown) => Promise<unknown> }
    // 在同一工作区另建一个 deck 走 brief 工具（briefCreate 会创建新 deck）
    const created = (await f.briefCreate({
      title: '强模型 deck', topic: '测试', audience: '工程师', scenario: '单测', objective: '验证',
      themeId: 'business-blue', modelProfile: 'strong',
    })) as { deckId: string; brief: { mode: string; modelProfile: string; confirmStages: string[] } }
    expect(created.brief.modelProfile).toBe('strong')
    expect(created.brief.mode).toBe('quick')
    expect(created.brief.confirmStages).toEqual([])
  })

  it('brief：显式 mode 优先于 strong 档的 quick 默认', async () => {
    const f = (await createFixture()) as Fixture & { briefCreate: (args: unknown) => Promise<unknown> }
    const created = (await f.briefCreate({
      title: '强模型精细 deck', topic: '测试', audience: '工程师', scenario: '单测', objective: '验证',
      themeId: 'business-blue', modelProfile: 'strong', mode: 'precise',
    })) as { brief: { mode: string; confirmStages: string[] } }
    expect(created.brief.mode).toBe('precise')
    expect(created.brief.confirmStages).toContain('prototype')
  })

  it('brief：默认（weak）维持 mode=standard', async () => {
    const f = (await createFixture()) as Fixture & { briefCreate: (args: unknown) => Promise<unknown> }
    const created = (await f.briefCreate({
      title: '弱模型 deck', topic: '测试', audience: '工程师', scenario: '单测', objective: '验证',
      themeId: 'business-blue',
    })) as { brief: { mode: string; modelProfile: string } }
    expect(created.brief.modelProfile).toBe('weak')
    expect(created.brief.mode).toBe('standard')
  })

  it('弱模型辅助闩锁：strong 档连败 3 次不自动开启', async () => {
    const f = await createFixture({ modelProfile: 'strong' })
    const toolLogger = createToolLogger(f.rootDir)
    toolLogger.record({ tool: 'ppt_page_write', argsForm: 'object', frozen: false, outcome: 'error', durationMs: 1 })
    toolLogger.record({ tool: 'ppt_page_write', argsForm: 'object', frozen: false, outcome: 'error', durationMs: 1 })
    await toolLogger.flush()
    // 第 3 次失败（zod 拒绝）——weak 档会在此落闩锁，strong 档只报 schema 错
    await expect(f.pageWrite({ deckId: f.deckId, pageId: 'p004', scene: { elements: [{ kind: 'text', id: 'bad' }] } }))
      .rejects.toThrow(/schema/)
    const state = await f.store.loadState(f.deckId)
    expect(state?.weakModelAssist).toBeUndefined()
    // 后续合法 elements 整页替换不受闩锁限制
    const ok = (await f.pageWrite({
      deckId: f.deckId, pageId: 'p004',
      scene: { elements: [{ kind: 'text', id: 't1', x: 0.6, y: 1.7, w: 11.5, h: 4, fontSize: 16, color: '#1F2937', paragraphs: [{ text: '手写元素' }] }] },
    })) as Record<string, unknown>
    expect(ok.ok).toBe(true)
  })
})

describe('elements 表达面扩充（0.14.0）', () => {
  it('新形状（hexagon/star5）+ rotation：通过 schema 与确定性校验并落盘', async () => {
    const f = await createFixture()
    const result = (await f.pageWrite({
      deckId: f.deckId, pageId: 'p004',
      scene: {
        elements: [
          { kind: 'shape', id: 'deco-hex', shape: 'hexagon', x: 10.5, y: 0.3, w: 2.2, h: 1.9, fill: '#1E4B8F', opacity: 0.18, rotation: 15, background: true },
          { kind: 'shape', id: 'deco-star', shape: 'star5', x: 11.2, y: 5.4, w: 1.6, h: 1.6, fill: '#C9A227', opacity: 0.25, rotation: -10, background: true },
          { kind: 'text', id: 't1', x: 0.6, y: 1.7, w: 9.5, h: 4, fontSize: 16, color: '#1F2937', paragraphs: [{ text: '带旋转装饰的要点页' }] },
        ],
      },
    })) as Record<string, unknown>
    expect(result.ok).toBe(true)
    const page = JSON.parse(readFileSync(join(f.store.paths(f.deckId).pagesDir, 'p004.json'), 'utf8'))
    const hex = page.elements.find((e: { id: string }) => e.id === 'deco-hex')
    expect(hex.shape).toBe('hexagon')
    expect(hex.rotation).toBe(15)
  })

  it('双渲染器：HTML 端输出 clip-path 与 rotate 变换，PPTX 端无错误', async () => {
    const f = await createFixture()
    const ok = (await f.pageWrite({
      deckId: f.deckId, pageId: 'p004',
      scene: {
        elements: [
          { kind: 'shape', id: 'deco-hex', shape: 'hexagon', x: 10.5, y: 0.3, w: 2.2, h: 1.9, fill: '#1E4B8F', opacity: 0.18, rotation: 15, background: true },
          { kind: 'text', id: 't1', x: 0.6, y: 1.7, w: 9.5, h: 4, fontSize: 16, color: '#1F2937', paragraphs: [{ text: '渲染测试' }] },
        ],
      },
    })) as Record<string, unknown>
    expect(ok.ok).toBe(true)
    const pagePath = join(f.store.paths(f.deckId).pagesDir, 'p004.json')
    const page = JSON.parse(readFileSync(pagePath, 'utf8'))
    const theme = getTheme('business-blue')!
    const resolved = resolveDesignTheme(theme)
    // HTML：新形状 clip-path + rotate 变换
    const html = await renderDeckHtml({ store: f.store, deckId: f.deckId, deckTitle: '测试', theme: resolved, pages: [page] })
    const htmlText = readFileSync(html.htmlPath, 'utf8')
    expect(htmlText).toContain('polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)')
    expect(htmlText).toContain('transform:rotate(15deg)')
    // PPTX：渲染与 ZIP 结构自检通过（新形状名映射 + rotate 选项合法）
    const pptx = await renderDeckPptx({ store: f.store, deckId: f.deckId, deckTitle: '测试', theme: resolved, pages: [page] })
    expect(pptx.pageCount).toBe(1)
    expect(pptx.pptxPath.endsWith('.pptx')).toBe(true)
  })

  it('rotation 超界（|rotation|>180）被 schema 拒绝', async () => {
    const f = await createFixture()
    await expect(f.pageWrite({
      deckId: f.deckId, pageId: 'p004',
      scene: { elements: [{ kind: 'shape', id: 'bad-rot', shape: 'hexagon', x: 1, y: 1, w: 1, h: 1, rotation: 270 }] },
    })).rejects.toThrow(/schema/)
  })
})

describe('形状库扩充（0.21.0 P3：+10 种 OOXML 预设）', () => {
  const NEW_SHAPES = ['octagon', 'plus', 'donut', 'frame', 'can', 'teardrop', 'pie', 'lightningBolt', 'cloud', 'heart'] as const

  it('新形状通过 schema 校验落盘', async () => {
    const f = await createFixture()
    const elements = [
      // 全部 background:true 装饰——不参与越界/互压内容校验，聚焦形状词表本身
      ...NEW_SHAPES.map((shape, i) => ({
        kind: 'shape' as const, id: `new-${shape}`, shape,
        x: 0.6 + (i % 5) * 2.4, y: i < 5 ? 1.8 : 4.2, w: 1.6, h: 1.4,
        fill: '#1E4B8F', background: true,
      })),
      { kind: 'text' as const, id: 't1', x: 0.6, y: 6.4, w: 11.5, h: 0.5, fontSize: 14, color: '#1F2937', paragraphs: [{ text: '形状词表测试' }] },
    ]
    const ok = (await f.pageWrite({ deckId: f.deckId, pageId: 'p004', scene: { elements } })) as Record<string, unknown>
    expect(ok.ok).toBe(true)
    const page = JSON.parse(readFileSync(join(f.store.paths(f.deckId).pagesDir, 'p004.json'), 'utf8'))
    for (const shape of NEW_SHAPES) {
      expect(page.elements.some((e: { shape: string }) => e.shape === shape)).toBe(true)
    }
  })

  it('HTML：多边形 clip-path + SVG defs 引用都在；PPTX：prstGeom 写入 OOXML 预设名', async () => {
    const f = await createFixture()
    const elements = [
      ...NEW_SHAPES.map((shape, i) => ({
        kind: 'shape' as const, id: `new-${shape}`, shape,
        x: 0.6 + (i % 5) * 2.4, y: i < 5 ? 1.8 : 4.2, w: 1.6, h: 1.4,
        fill: '#1E4B8F', background: true,
      })),
      { kind: 'text' as const, id: 't1', x: 0.6, y: 6.4, w: 11.5, h: 0.5, fontSize: 14, color: '#1F2937', paragraphs: [{ text: '渲染' }] },
    ]
    await f.pageWrite({ deckId: f.deckId, pageId: 'p004', scene: { elements } })
    const page = JSON.parse(readFileSync(join(f.store.paths(f.deckId).pagesDir, 'p004.json'), 'utf8'))
    const resolved = resolveDesignTheme(getTheme('business-blue')!)
    const html = await renderDeckHtml({ store: f.store, deckId: f.deckId, deckTitle: '形状', theme: resolved, pages: [page] })
    const htmlText = readFileSync(html.htmlPath, 'utf8')
    // 直线多边形：CSS polygon
    expect(htmlText).toContain('polygon(29% 0%')
    expect(htmlText).toContain('polygon(36% 0%, 64% 0%, 64% 36%')
    expect(htmlText).toContain('polygon(62% 0%, 28% 56%')
    // 曲线/空心：SVG defs 注入 + clip-path url 引用
    expect(htmlText).toContain('id="pptx-shape-donut"')
    expect(htmlText).toContain('clip-rule="evenodd"')
    for (const shape of ['donut', 'frame', 'can', 'teardrop', 'pie', 'cloud', 'heart']) {
      expect(htmlText).toContain(`clip-path:url(#pptx-shape-${shape})`)
    }
    // PPTX：slide XML 里 prstGeom 用 OOXML 预设名
    const pptx = await renderDeckPptx({ store: f.store, deckId: f.deckId, deckTitle: '形状', theme: resolved, pages: [page] })
    const { unzipSync } = await import('fflate')
    const files = unzipSync(new Uint8Array(readFileSync(pptx.pptxPath)))
    const slideXml = Buffer.from(files['ppt/slides/slide1.xml']!).toString('utf8')
    for (const shape of NEW_SHAPES) {
      expect(slideXml).toContain(`prst="${shape}"`)
    }
  })
})

describe('版本一致性', () => {
  it('PLUGIN_VERSION 与 package.json 版本一致（0.22.0）', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    expect(PLUGIN_VERSION).toBe(pkg.version)
    expect(PLUGIN_VERSION).toBe('0.23.0')
  })
})
