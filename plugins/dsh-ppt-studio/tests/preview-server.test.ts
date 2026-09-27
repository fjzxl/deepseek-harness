/**
 * 0.22.0 预览服务懒注册：服务运行期间新登记的工作区根，请求未命中时重查注册表即可预览
 * （此前是启动时一次性读入，新工作目录首场 PPT 后必须重启预览服务）。
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startPreviewServer, type RunningPreviewServer } from '../src/preview-server.js'
import { registerWorkspace } from '../src/workspace-registry.js'

const tempDirs: string[] = []
let server: RunningPreviewServer | undefined
const previousRegistry = process.env.PPT_STUDIO_WORKSPACE_REGISTRY

afterEach(async () => {
  if (server !== undefined) {
    await server.close()
    server = undefined
  }
})

afterAll(async () => {
  if (previousRegistry === undefined) delete process.env.PPT_STUDIO_WORKSPACE_REGISTRY
  else process.env.PPT_STUDIO_WORKSPACE_REGISTRY = previousRegistry
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })))
})

/** 造一个最小可预览 deck：state.json + preview/index.html（服务只 stat + 流式读）。 */
async function createFakeDeck(rootDir: string, deckId: string, title: string): Promise<void> {
  const deckDir = join(rootDir, deckId)
  await mkdir(join(deckDir, 'preview'), { recursive: true })
  await writeFile(join(deckDir, 'state.json'), JSON.stringify({ deckId, title, updatedAt: new Date().toISOString() }), 'utf8')
  await writeFile(join(deckDir, 'preview', 'index.html'), `<html><body>${title}</body></html>`, 'utf8')
}

describe('0.22.0 预览服务懒注册', () => {
  it('启动后新登记的工作区：请求未命中 → 重查注册表 → 200（免重启）', async () => {
    const base = await mkdtemp(join(tmpdir(), 'ppt-lazy-a-'))
    const added = await mkdtemp(join(tmpdir(), 'ppt-lazy-b-'))
    const registry = join(await mkdtemp(join(tmpdir(), 'ppt-lazy-reg-')), 'registry.json')
    tempDirs.push(base, added, join(registry, '..'))
    process.env.PPT_STUDIO_WORKSPACE_REGISTRY = registry

    await createFakeDeck(base, 'd0000001', '启动前就有的 deck')
    server = await startPreviewServer({ rootDirs: [base], port: 0 })

    // 新会话在另一个工作目录生成了 deck 并登记注册表（工具侧 registerWorkspace）
    await createFakeDeck(added, 'd0000002', '运行期间新出现的 deck')
    await registerWorkspace(added)

    // 未重启服务：懒注册重查注册表后命中
    const fresh = await fetch(`${server.url}/ppt-studio/d0000002/preview/`)
    expect(fresh.status).toBe(200)
    expect(await fresh.text()).toContain('运行期间新出现的 deck')

    // 列表页同样反映新根（每次列表请求刷新）
    const list = await fetch(`${server.url}/`)
    const listHtml = await list.text()
    expect(listHtml).toContain('d0000002')

    // 既不在任何根也未登记的 deck 仍是 404
    const missing = await fetch(`${server.url}/ppt-studio/dnope/preview/`)
    expect(missing.status).toBe(404)
  })

  it('POST 编辑端点同样吃到懒注册（新根下 deck 的 edit 请求不再 404）', async () => {
    const base = await mkdtemp(join(tmpdir(), 'ppt-lazy-c-'))
    const registry = join(await mkdtemp(join(tmpdir(), 'ppt-lazy-reg2-')), 'registry.json')
    tempDirs.push(base, join(registry, '..'))
    process.env.PPT_STUDIO_WORKSPACE_REGISTRY = registry
    await registerWorkspace(base)
    await createFakeDeck(base, 'd0000003', '编辑端点懒注册')
    server = await startPreviewServer({ rootDirs: [], port: 0 }) // 启动时零根——全靠懒注册

    // deck 不在内存根：edit 请求走 findRoot → 重查注册表命中（后续 422 是业务校验，不是 404 找不到）
    const response = await fetch(`${server.url}/ppt-studio/d0000003/edit`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pageId: 'p001', edits: [] }),
    })
    expect(response.status).toBe(422)
    expect(((await response.json()) as { error: string }).error).not.toContain('不存在')
  })
})
