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
  outcome: 'ok' | 'error'
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

/** 失败快照清单（供 ppt_doctor / ppt_log_query 展示）。 */
export async function listFailedSnapshots(failedDir: string): Promise<string[]> {
  if (!existsSync(failedDir)) return []
  try {
    return (await readdir(failedDir)).filter(f => f.endsWith('.json')).sort().reverse()
  } catch {
    return []
  }
}
