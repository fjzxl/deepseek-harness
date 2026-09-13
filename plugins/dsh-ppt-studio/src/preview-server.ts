/**
 * 预览静态服务（node:http，零额外依赖）。
 *
 * 多根托管 deck 工作区：deck 按 DSH 会话工作目录生成（每个会话可能不同），本服务
 * 合并三类根目录——①启动目录（或 PPT_STUDIO_OUTPUT_DIR）②全局工作区注册表
 * （~/.dsh/ppt-studio-workspaces.json，工具运行时自动登记）——任一根下的 deck 都能预览：
 *   GET /                              deck 列表页（跨全部工作区）
 *   GET /ppt-studio/<deckId>/preview/  该 deck 的自包含 HTML 播放器
 *
 * 预览 HTML 无外链，本服务只是薄静态层——本地测试、Docker 内常驻均可。
 * 端口默认 3170（PPT_STUDIO_PREVIEW_PORT / 行配置 previewPort）。
 */
import { createServer, type Server } from 'node:http'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { resolvePptStudioConfig } from './config.js'
import { listWorkspaces } from './workspace-registry.js'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

export interface PreviewServerOptions {
  /** 全部工作区根目录（本地根 + 注册表根），任一根下的 deck 都可预览 */
  rootDirs: string[]
  port: number
  host?: string
}

export interface RunningPreviewServer {
  server: Server
  port: number
  url: string
  close(): Promise<void>
}

function esc(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

interface DeckEntry {
  id: string
  title: string
  updatedAt: string
  rootDir: string
}

/** 汇总多个工作区根目录下的 deck（按 deckId 去重，保留最新）。 */
async function listDecks(rootDirs: string[]): Promise<DeckEntry[]> {
  const byId = new Map<string, DeckEntry>()
  for (const rootDir of rootDirs) {
    if (!existsSync(rootDir)) continue
    const entries = await readdir(rootDir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const statePath = join(rootDir, entry.name, 'state.json')
      if (!existsSync(statePath)) continue
      try {
        const state = JSON.parse(readFileSync(statePath, 'utf8')) as { title?: string; updatedAt?: string }
        const deck: DeckEntry = { id: entry.name, title: state.title ?? entry.name, updatedAt: state.updatedAt ?? '', rootDir }
        const previous = byId.get(deck.id)
        if (previous === undefined || deck.updatedAt > previous.updatedAt) byId.set(deck.id, deck)
      } catch {
        /* 忽略损坏的 state */
      }
    }
  }
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** 样式化错误页（0.8.4，用户反馈"访问不存在应显示 404 页面"）：与列表页同风格，中文不再依赖响应头解码。 */
function errorPage(status: number, title: string, detail: string): string {
  return `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>${status} · dsh-ppt-studio 预览</title>
<style>body{font:15px/1.8 'Microsoft YaHei',sans-serif;max-width:640px;margin:80px auto;padding:0 20px;color:#1F2937}
.code{font-size:64px;font-weight:700;color:#1E4B8F;line-height:1}h1{font-size:20px;margin:18px 0 10px}
p{color:#4B5563;margin:8px 0}code{background:#F3F4F6;padding:2px 6px;border-radius:4px;font-size:13px;color:#374151;word-break:break-all}
a{color:#1E4B8F}a:hover{text-decoration:underline}
ol{color:#6B7280;font-size:13px}</style></head><body>
<div class="code">${String(status)}</div>
<h1>${title}</h1>
<p>${detail}</p>
<p><a href="/">← 返回 deck 列表</a></p>
</body></html>`
}

async function listPage(rootDirs: string[]): Promise<string> {
  const decks = await listDecks(rootDirs)
  const multiRoot = rootDirs.length > 1
  const items = decks
    .map(d => `<li><a href="/ppt-studio/${encodeURIComponent(d.id)}/preview/">${esc(d.title)}</a><span class="id">${esc(d.id)}</span>${multiRoot ? `<span class="root" title="${esc(d.rootDir)}">${esc(d.rootDir)}</span>` : ''}<span class="time">${esc(d.updatedAt.slice(0, 19).replace('T', ' '))}</span></li>`)
    .join('\n')
  return `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>dsh-ppt-studio 预览</title>
<style>body{font:15px/1.7 'Microsoft YaHei',sans-serif;max-width:860px;margin:48px auto;padding:0 20px;color:#1F2937}
h1{font-size:22px}ul{list-style:none;padding:0}li{display:flex;gap:14px;align-items:baseline;padding:10px 6px;border-bottom:1px solid #E5E7EB}
a{color:#1E4B8F;text-decoration:none;font-weight:600}a:hover{text-decoration:underline}.id{color:#9CA3AF;font-size:12px}
.root{color:#9CA3AF;font-size:12px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.time{color:#6B7280;font-size:12px;margin-left:auto}
p.empty{color:#6B7280}p.hint{color:#9CA3AF;font-size:13px}</style></head><body>
<h1>dsh-ppt-studio · deck 预览</h1>
${items !== '' ? `<ul>${items}</ul>` : '<p class="empty">还没有 deck。生成后用 ppt_deck_render 渲染即可在此预览。</p>'}
${multiRoot ? `<p class="hint">正在托管 ${rootDirs.length} 个工作区（deck 按会话工作目录生成，服务启动目录 + 全局注册表自动合并）。</p>` : ''}
</body></html>`
}

/** 找到 deckId 所在的工作区根目录。 */
function findDeckRoot(rootDirs: string[], deckId: string): string | undefined {
  return rootDirs.find(root => existsSync(join(root, deckId, 'state.json')))
}

export function startPreviewServer(options: PreviewServerOptions): Promise<RunningPreviewServer> {
  const rootDirs = [...new Set(options.rootDirs.map(root => resolve(root)))]
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const pathname = decodeURIComponent(url.pathname)
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { 'content-type': 'text/html; charset=utf-8' }).end(errorPage(405, '不支持的请求方法', '本服务只响应 GET / HEAD 请求。'))
          return
        }
        if (pathname === '/' || pathname === '/ppt-studio' || pathname === '/ppt-studio/') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          res.end(await listPage(rootDirs))
          return
        }
        const match = /^\/ppt-studio\/([^/]+)\/preview\/?(.*)$/.exec(pathname)
        if (match === null) {
          res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }).end(errorPage(404, '页面不存在', '请求的路径不在预览服务范围内（预览地址形如 <code>/ppt-studio/&lt;deckId&gt;/preview/</code>）。'))
          return
        }
        const deckId = match[1]
        if (!/^[A-Za-z0-9_-]+$/.test(deckId)) {
          res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }).end(errorPage(404, 'deckId 不合法', 'deckId 只能包含字母/数字/下划线/连字符。'))
          return
        }
        const deckRoot = findDeckRoot(rootDirs, deckId)
        if (deckRoot === undefined) {
          res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }).end(errorPage(404, `deck <code>${esc(deckId)}</code> 不存在`, `它可能已被删除，或生成它的工作区尚未登记。正在托管 ${String(rootDirs.length)} 个工作区：<ol>${rootDirs.map(r => `<li><code>${esc(r)}</code></li>`).join('') || '（无）'}</ol>deck 按会话工作目录生成——在该工作目录下完成一次任意 ppt_* 工具调用会自动登记，之后刷新本页。`))
          return
        }
        const relative = match[2] === '' ? 'index.html' : match[2]
        const target = normalize(join(deckRoot, deckId, 'preview', relative))
        if (!target.startsWith(join(deckRoot, deckId, 'preview'))) {
          res.writeHead(403, { 'content-type': 'text/html; charset=utf-8' }).end(errorPage(403, '禁止访问', '请求的路径越出了该 deck 的 preview 目录。'))
          return
        }
        const info = await stat(target).catch(() => undefined)
        if (info === undefined || !info.isFile()) {
          res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }).end(errorPage(404, '预览尚未生成', `deck <code>${esc(deckId)}</code> 存在，但还没有渲染产物——在会话里调 <code>ppt_deck_render</code>（或先 <code>ppt_preview_update</code> 看已写页面）后刷新本页。`))
          return
        }
        res.writeHead(200, { 'content-type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream', 'content-length': info.size })
        if (req.method === 'HEAD') {
          res.end()
          return
        }
        createReadStream(target).pipe(res)
      } catch (error) {
        res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' }).end(errorPage(500, '预览服务内部错误', `<code>${esc(error instanceof Error ? error.message : String(error))}</code>（详情见服务进程输出；排查可调 ppt_doctor）`))
      }
    })()
  })
  const host = options.host ?? '127.0.0.1'
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(options.port, host, () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : options.port
      resolvePromise({
        server,
        port,
        url: `http://${host}:${port}`,
        close: () => new Promise<void>(done => server.close(() => done())),
      })
    })
  })
}

/** CLI 直跑：node lib/preview-server.js */
export async function main(): Promise<void> {
  const config = resolvePptStudioConfig(null)
  const localRoot = resolve(process.cwd(), config.outputDir !== '' ? config.outputDir : 'ppt-studio')
  // 多根托管：启动目录 + 全局工作区注册表（deck 按会话工作目录生成，注册表让预览服务都能看到）
  const rootDirs = [...new Set([localRoot, ...listWorkspaces()].map(root => resolve(root)))].filter(root => existsSync(root))
  try {
    const running = await startPreviewServer({ rootDirs, port: config.previewPort })
    console.log(`ppt-studio 预览服务已启动：${running.url}/  （托管 ${rootDirs.length} 个工作区：${rootDirs.join('；')}，Ctrl+C 退出）`)
  } catch (error) {
    console.error(`预览服务启动失败（端口 ${config.previewPort} 可能被占用）：${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

if (process.argv[1] !== undefined && process.argv[1].replace(/\\/g, '/').endsWith('preview-server.js')) {
  void main()
}
