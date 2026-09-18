/**
 * 插件级工具调用日志（deck 无关）。
 *
 * 排查痛点：deck 日志挂在 <deckId>/logs/ 下，而工具在「建 deck 之前」的失败
 * （入参形态问题、schema 拒绝、冻结入参崩溃）不留任何插件侧痕迹——三轮真实
 * 会话排障都要回扒宿主 sessionlog 才能拿到失败入参。
 *
 * 本模块为每次工具调用写一条 JSONL 到 <rootDir>/logs/plugin.log：
 *   ts / tool / argsForm（宿主传输形态）/ frozen（入参是否被宿主冻结）/
 *   outcome / durationMs / argsPreview / deckId / error / errorStack / snapshot
 * 失败调用另存完整入参快照到 <rootDir>/logs/failed/<tool>-<ts>.json，
 * 日志条目引用路径——排查不再依赖 sessionlog。
 *
 * 所有写入串行化且绝不抛出（日志失败不阻断业务）。
 */
import { appendFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface ToolCallRecord {
  ts: string
  tool: string
  /** 宿主传参形态：object / json-string（宿主把参数序列化成字符串）/ array / 其他 typeof */
  argsForm: string
  /** 入参是否被宿主冻结（只读对象上原地赋值会 TypeError——真实事故源） */
  frozen: boolean
  /** ok=成功；error=执行失败；blocked=熔断拦截（未执行，见 tools/index.ts withDiagnostics） */
  outcome: 'ok' | 'error' | 'blocked'
  durationMs: number
  /** 入参截断预览（完整内容看 snapshot） */
  argsPreview?: string
  deckId?: string
  pageId?: string
  error?: string
  errorStack?: string
  /** 失败入参快照文件路径（logs/failed/ 下） */
  snapshot?: string
}

export interface ToolLogger {
  record(entry: Omit<ToolCallRecord, 'ts'>): void
  /** 保存失败调用的完整入参，返回快照绝对路径 */
  snapshotFailed(tool: string, rawArgs: unknown): Promise<string>
  /** 读取最近 N 条（新在后） */
  readTail(tail: number): Promise<ToolCallRecord[]>
  pluginLogPath: string
  failedDir: string
  flush(): Promise<void>
}

export function createToolLogger(rootDir: string): ToolLogger {
  const logsDir = join(rootDir, 'logs')
  const failedDir = join(logsDir, 'failed')
  const pluginLogPath = join(logsDir, 'plugin.log')
  let queue: Promise<void> = Promise.resolve()

  function persist(entry: ToolCallRecord): void {
    queue = queue
      .then(async () => {
        await mkdir(logsDir, { recursive: true })
        await appendFile(pluginLogPath, JSON.stringify(entry) + '\n', 'utf8')
      })
      .catch(() => { /* 日志失败不阻断业务 */ })
  }

  return {
    pluginLogPath,
    failedDir,
    flush: () => queue,
    record(entry) {
      persist({ ts: new Date().toISOString(), ...entry })
    },
    async snapshotFailed(tool, rawArgs) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const path = join(failedDir, `${tool}-${stamp}.json`)
      try {
        await mkdir(failedDir, { recursive: true })
        const body = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs, null, 2)
        await writeFile(path, typeof body === 'string' ? body : String(body), 'utf8')
        // 保留策略（0.8.1）：全局最多保留最近 100 份（按文件名时间戳 FIFO），防止无限堆积
        try {
          const files = (await readdir(failedDir)).filter(f => f.endsWith('.json')).sort()
          if (files.length > 100) {
            for (const victim of files.slice(0, files.length - 100)) await rm(join(failedDir, victim), { force: true })
          }
        } catch { /* 清理失败不影响业务 */ }
        return path
      } catch {
        return `（快照写入失败：${path}）`
      }
    },
    async readTail(tail) {
      if (!existsSync(pluginLogPath)) return []
      const { readFile } = await import('node:fs/promises')
      const text = await readFile(pluginLogPath, 'utf8')
      const lines = text.split('\n').filter(l => l.trim() !== '')
      const entries: ToolCallRecord[] = []
      for (const line of lines.slice(-tail)) {
        try { entries.push(JSON.parse(line) as ToolCallRecord) } catch { /* 跳过损坏行 */ }
      }
      return entries
    },
  }
}

/** 宿主传参形态标注：字符串化传输（真实会话出现过）与冻结入参都会在这里现形。 */
export function describeArgsForm(rawArgs: unknown): string {
  if (typeof rawArgs === 'string') {
    const trimmed = rawArgs.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json-string（宿主传了字符串而非对象）'
    return 'string'
  }
  if (Array.isArray(rawArgs)) return 'array（应为对象）'
  if (rawArgs === null) return 'null'
  return typeof rawArgs
}

/**
 * 该工具当前未恢复的失败 streak：从日志尾部向前数，遇到 ok 为止；
 * blocked 只计最近一次真实失败之后的尾部连续拦截（试探失败即清零重计）。
 * 熔断（tools/index.ts withDiagnostics）与逐页蓝图降级（tools/outline.ts）共用本函数，同一数据源。
 */
export function failureStreak(tail: ToolCallRecord[], tool: string): { errors: number; blocked: number } {
  let errors = 0
  let blocked = 0
  for (let i = tail.length - 1; i >= 0; i--) {
    const entry = tail[i]
    if (entry.tool !== tool) continue
    if (entry.outcome === 'ok') break
    if (entry.outcome === 'blocked') {
      if (errors === 0) blocked++
      continue
    }
    errors++
  }
  return { errors, blocked }
}

/** 失败快照清单（供 ppt_doctor / ppt_log_query 展示）。 */
export async function listFailedSnapshots(failedDir: string): Promise<string[]> {
  if (!existsSync(failedDir)) return []
  try {
    return (await readdir(failedDir)).filter(f => f.endsWith('.json')).sort().reverse()
  } catch {
    return []
  }
}
