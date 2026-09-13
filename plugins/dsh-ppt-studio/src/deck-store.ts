/**
 * deck 工作区存储与状态机。
 *
 * 目录布局（rootDir 默认 <会话工作目录>/ppt-studio）：
 *   <rootDir>/<deckId>/
 *     brief.json  plan.json  outline.json  state.json  report.json
 *     design/（spec.json + tokens.json）  sections/  pages/
 *     assets/images/   preview/   logs/
 *
 * 所有 JSON 写入均为原子写（tmp + rename），读到一半的文件不会出现。
 */
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AssetManifest, DeckBrief, DeckOutline, DeckPlan, DeckState, DesignSpec, DesignTokens, PageScene } from './schema.js'

export interface DeckPaths {
  root: string
  brief: string
  plan: string
  outline: string
  state: string
  report: string
  manifest: string
  designDir: string
  spec: string
  tokens: string
  sectionsDir: string
  pagesDir: string
  assetsDir: string
  imagesDir: string
  previewDir: string
  logsDir: string
  pptx: string
}

export class DeckStore {
  constructor(readonly rootDir: string) {}

  /** 生成形如 d20260910-153012-7f3a 的 deckId。 */
  private newDeckId(): string {
    const now = new Date()
    const pad = (n: number, w = 2) => String(n).padStart(w, '0')
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    const rand = Math.random().toString(16).slice(2, 6)
    return `d${stamp}-${rand}`
  }

  paths(deckId: string): DeckPaths {
    const root = join(this.rootDir, deckId)
    return {
      root,
      brief: join(root, 'brief.json'),
      plan: join(root, 'plan.json'),
      outline: join(root, 'outline.json'),
      state: join(root, 'state.json'),
      report: join(root, 'report.json'),
      manifest: join(root, 'assets', 'manifest.json'),
      designDir: join(root, 'design'),
      spec: join(root, 'design', 'spec.json'),
      tokens: join(root, 'design', 'tokens.json'),
      sectionsDir: join(root, 'sections'),
      pagesDir: join(root, 'pages'),
      assetsDir: join(root, 'assets'),
      imagesDir: join(root, 'assets', 'images'),
      previewDir: join(root, 'preview'),
      logsDir: join(root, 'logs'),
      pptx: join(root, 'deck.pptx'),
    }
  }

  exists(deckId: string): boolean {
    return existsSync(join(this.rootDir, deckId, 'state.json'))
  }

  /** 创建新 deck（目录 + 初始 state）。 */
  async create(title: string): Promise<{ deckId: string; state: DeckState; paths: DeckPaths }> {
    let deckId = this.newDeckId()
    while (this.exists(deckId)) deckId = this.newDeckId()
    const paths = this.paths(deckId)
    for (const dir of [paths.root, paths.designDir, paths.sectionsDir, paths.pagesDir, paths.imagesDir, paths.previewDir, paths.logsDir]) {
      await mkdir(dir, { recursive: true })
    }
    const now = new Date().toISOString()
    const state: DeckState = { deckId, title, stage: 'briefed', createdAt: now, updatedAt: now, pagesWritten: [], pageHashes: {} }
    await this.saveJson(paths.state, state)
    return { deckId, state, paths }
  }

  async saveJson(path: string, data: unknown): Promise<void> {
    const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(16).slice(2, 8)}`
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
    await rename(tmp, path)
  }

  async readJson<T>(path: string): Promise<T | undefined> {
    if (!existsSync(path)) return undefined
    return JSON.parse(await readFile(path, 'utf8')) as T
  }

  async loadState(deckId: string): Promise<DeckState | undefined> {
    return this.readJson<DeckState>(this.paths(deckId).state)
  }

  async saveState(state: DeckState): Promise<void> {
    state.updatedAt = new Date().toISOString()
    await this.saveJson(this.paths(state.deckId).state, state)
  }

  async loadBrief(deckId: string): Promise<DeckBrief | undefined> {
    return this.readJson<DeckBrief>(this.paths(deckId).brief)
  }

  async loadPlan(deckId: string): Promise<DeckPlan | undefined> {
    return this.readJson<DeckPlan>(this.paths(deckId).plan)
  }

  async loadOutline(deckId: string): Promise<DeckOutline | undefined> {
    return this.readJson<DeckOutline>(this.paths(deckId).outline)
  }

  async loadTokens(deckId: string): Promise<DesignTokens | undefined> {
    return this.readJson<DesignTokens>(this.paths(deckId).tokens)
  }

  async loadSpec(deckId: string): Promise<DesignSpec | undefined> {
    return this.readJson<DesignSpec>(this.paths(deckId).spec)
  }

  async loadManifest(deckId: string): Promise<AssetManifest> {
    return (await this.readJson<AssetManifest>(this.paths(deckId).manifest)) ?? { assets: [] }
  }

  /** 按文件名顺序（p001 < p002 …）读取全部页面。 */
  async loadPages(deckId: string): Promise<PageScene[]> {
    const pagesDir = this.paths(deckId).pagesDir
    if (!existsSync(pagesDir)) return []
    const files = (await readdir(pagesDir)).filter(f => f.endsWith('.json')).sort()
    const pages: PageScene[] = []
    for (const file of files) {
      const page = await this.readJson<PageScene>(join(pagesDir, file))
      if (page !== undefined) pages.push(page)
    }
    return pages
  }

  async savePage(deckId: string, page: PageScene): Promise<void> {
    const paths = this.paths(deckId)
    await mkdir(paths.pagesDir, { recursive: true })
    await this.saveJson(join(paths.pagesDir, `${page.id}.json`), page)
  }

  /** 列出全部 deck（按更新时间倒序）。 */
  async list(): Promise<Array<DeckState>> {
    if (!existsSync(this.rootDir)) return []
    const entries = await readdir(this.rootDir, { withFileTypes: true })
    const states: DeckState[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const state = await this.loadState(entry.name)
      if (state !== undefined) states.push(state)
    }
    return states.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
}

/**
 * 计算全册校验指纹：插件版本 + 锁定令牌 + 大纲（含页级蓝图）+ 全部页面场景的规范化哈希。
 * 版本进盐（0.9.1）：校验规则/渲染器随版本演进——插件升级后旧 sceneHash 不再匹配，
 * 渲染前必须重新 ppt_scene_check（新规则对存量 deck 也会生效，而不是沿用升级前的结论）。
 */
export async function computeSceneHash(tokens: DesignTokens, outline: DeckOutline, pages: PageScene[]): Promise<string> {
  const { createHash } = await import('node:crypto')
  const { PLUGIN_VERSION } = await import('./version.js')
  const canonical = JSON.stringify({
    v: PLUGIN_VERSION,
    tokens,
    outline,
    pages: [...pages].sort((a, b) => a.id.localeCompare(b.id)),
  })
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16)
}

/** 单页内容指纹（依赖感知修改循环：与上次全册校验比对，识别哪些页变了）。 */
export async function computePageHash(page: PageScene): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(JSON.stringify(page), 'utf8').digest('hex').slice(0, 12)
}

/**
 * 加载 deck 状态，不存在时抛出可自纠的报错：附上现有 deck 清单。
 * 真实会话中模型会自行编造 deckId（如 draft_llm_popularize_2024），
 * 报错列出候选后无需再调工具即可改正。
 */
export async function requireDeckState(store: DeckStore, deckId: string): Promise<DeckState> {
  const state = await store.loadState(deckId)
  if (state !== undefined) return state
  const decks = await store.list()
  const known = decks.map(deck => `${deck.deckId}（${deck.title}，阶段 ${deck.stage}）`).join('；')
  throw new Error(
    `deck ${deckId} 不存在。deckId 必须是 ppt_brief_create 返回的原值，不能自行编造。` +
      (known !== '' ? `当前已有的 deck：${known}` : '当前还没有任何 deck，请先调 ppt_brief_create 创建。'),
  )
}
