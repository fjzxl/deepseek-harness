/**
 * 0.21.0 P1 就地编辑链路：播放器编辑层标记 + preview-server POST /edit 端点
 * （写前校验 error 拒写 / handTunedPages 标记 / 预览即时重渲）。
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { DeckStore } from '../src/deck-store.js'
import { buildDesignTokens, getTheme } from '../src/themes.js'
import { composeSceneFromContent } from '../src/autolayout.js'
import { renderDeckHtml } from '../src/render-html.js'
import { startPreviewServer, type RunningPreviewServer } from '../src/preview-server.js'

const tempRoots: string[] = []
afterAll(async () => {
  await Promise.all(tempRoots.map(root => rm(root, { recursive: true, force: true })))
  if (server !== undefined) await server.close()
})

let server: RunningPreviewServer | undefined

async function createDeck(): Promise<{ store: DeckStore; deckId: string; rootDir: string; page: Record<string, unknown>; elId: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'ppt-edit-layer-'))
  tempRoots.push(dir)
  const store = new DeckStore(join(dir, 'ppt-studio'))
  const { deckId } = await store.create('编辑链路测试')
  const theme = getTheme('business-blue')!
  const tokens = buildDesignTokens(theme, { density: 'normal' })
  await store.saveJson(store.paths(deckId).tokens, tokens)
  await store.saveJson(store.paths(deckId).outline, {
    parts: [{ id: 's1', title: '第一部分', question: 'Q1？', message: 'A1', suggestedPages: 1 }],
    coreMessage: '核心主张',
    pages: [
      { id: 'p001', sectionId: 's0', type: 'cover', title: '封面', contentBrief: '封面', structure: 'plain', density: 'medium', visual: 'none' },
      { id: 'p002', sectionId: 's0', type: 'closing', title: '结尾', contentBrief: '结尾', structure: 'plain', density: 'medium', visual: 'none' },
      { id: 'p003', sectionId: 's1', type: 'bullets', title: '要点', contentBrief: '要点页', structure: 'plain', density: 'medium', visual: 'none' },
    ],
  })
  const composed = composeSceneFromContent({ type: 'bullets', title: '要点', items: ['第一条要点', '第二条要点'] }, { type: 'bullets', title: '要点' }, tokens)
  const page = { id: 'p003', type: 'bullets', title: '要点', elements: composed.elements, background: composed.background }
  await store.saveJson(join(store.paths(deckId).pagesDir, 'p003.json'), page)
  const state = await store.loadState(deckId)
  await store.saveState({ ...state!, pagesWritten: ['p001', 'p002', 'p003'] })
  await renderDeckHtml({
    store, deckId, deckTitle: '编辑链路测试',
    theme: { colors: tokens.colors, chartColors: tokens.chartColors, fonts: tokens.fonts },
    pages: [page as never],
  })
  const textEl = (composed.elements.find(el => el.kind === 'text' && (el as { idPrefix?: string }).id.startsWith('t-body')) ?? composed.elements[0]!) as { id: string }
  return { store, deckId, rootDir: store.rootDir, page: page as unknown as Record<string, unknown>, elId: textEl.id }
}

describe('0.21.0 P1：播放器编辑层标记', () => {
  it('渲染产物含编辑按钮/保存按钮/元素 data-el 拾取属性', async () => {
    const { store, deckId } = await createDeck()
    const html = readFileSync(join(store.paths(deckId).previewDir, 'index.html'), 'utf8')
    expect(html).toContain('id="editbtn"')
    expect(html).toContain('id="editsave"')
    expect(html).toContain('data-el=')
    expect(html).toContain('ppt-studio/\' + m[1] + \'/edit')
  })
})

describe('0.21.0 P1：POST /ppt-studio/<deckId>/edit', () => {
  it('合法编辑：落盘+handTunedPages+预览重渲；非法编辑被拒', async () => {
    const { store, deckId, rootDir, elId } = await createDeck()
    server = await startPreviewServer({ rootDirs: [rootDir], port: 0 })
    const base = `${server.url}/ppt-studio/${deckId}/edit`

    // 1) 合法移动 + 改字
    const before = JSON.parse(await readFile(join(store.paths(deckId).pagesDir, 'p003.json'), 'utf8'))
    const elBefore = (before.elements as Array<{ id: string; x: number }>).find(e => e.id === elId)!
    const ok = await fetch(base, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pageId: 'p003', edits: [{ id: elId, x: elBefore.x + 0.3, texts: ['手改后的要点'] }] }),
    })
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { ok: boolean; handTunedPages: string[] }
    expect(body.ok).toBe(true)
    expect(body.handTunedPages).toContain('p003')
    const after = JSON.parse(await readFile(join(store.paths(deckId).pagesDir, 'p003.json'), 'utf8'))
    const elAfter = (after.elements as Array<{ id: string; x: number }>).find(e => e.id === elId)!
    expect(elAfter.x).toBeCloseTo(elBefore.x + 0.3, 2)
    const state = JSON.parse(await readFile(join(store.paths(deckId).state), 'utf8')) as { handTunedPages?: string[]; contentOutdated?: boolean; renderOutdated?: boolean }
    expect(state.handTunedPages).toContain('p003')
    expect(state.contentOutdated).toBe(true)
    expect(state.renderOutdated).toBe(true)
    // 预览已重渲并带新文本
    const html = readFileSync(join(store.paths(deckId).previewDir, 'index.html'), 'utf8')
    expect(html).toContain('手改后的要点')

    // 2) 不存在的元素 → 422 可读报错，页面未变
    const bad = await fetch(base, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pageId: 'p003', edits: [{ id: 'nope', x: 1 }] }),
    })
    expect(bad.status).toBe(422)
    expect(((await bad.json()) as { error: string }).error).toContain('nope')

    // 3) 越界移动 → 校验拒绝（改动不落盘）
    const overflow = await fetch(base, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pageId: 'p003', edits: [{ id: elId, x: 12.9, y: 6.9 }] }),
    })
    expect(overflow.status).toBe(422)
    expect(((await overflow.json()) as { error: string }).error).toContain('校验拒绝')
    const final = JSON.parse(await readFile(join(store.paths(deckId).pagesDir, 'p003.json'), 'utf8'))
    const elFinal = (final.elements as Array<{ id: string; x: number }>).find(e => e.id === elId)!
    expect(elFinal.x).toBeCloseTo(elBefore.x + 0.3, 2)

    // 4) 请求体不合法
    const malformed = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ foo: 1 }) })
    expect(malformed.status).toBe(422)
  })

  it('svg 自由绘制页拒编：422 并指引回会话改（文字嵌在整页源码里）', async () => {
    const { store, deckId, rootDir } = await createDeck()
    await store.saveJson(join(store.paths(deckId).pagesDir, 'p004.json'), {
      id: 'p004', type: 'bullets', title: 'svg 页',
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><text x="100" y="100">内嵌文字</text></svg>',
    })
    if (server !== undefined) {
      await server.close()
      server = undefined
    }
    server = await startPreviewServer({ rootDirs: [rootDir], port: 0 })
    const response = await fetch(`${server.url}/ppt-studio/${deckId}/edit`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pageId: 'p004', edits: [{ id: 'any', x: 1 }] }),
    })
    expect(response.status).toBe(422)
    expect(((await response.json()) as { error: string }).error).toContain('svg')
  })
})
