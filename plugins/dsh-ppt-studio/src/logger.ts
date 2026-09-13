/**
 * 结构化生成日志。
 *
 * 每个 deck 一份 JSONL：logs/generation.log，每次工具调用、校验、渲染
 * 必写一条；配套 report.json 汇总（ppt_deck_render 产出）。
 * 宿主控制台同步输出（前缀 ppt-studio:），便于实时观察。
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  /** ISO 时间戳 */
  ts: string
  /** 流程阶段：draft / design / outline / section / page / check / render / asset / image */
  stage: string
  tool?: string
  deckId?: string
  pageId?: string
  level: LogLevel
  msg: string
  /** 附加上下文（自动截断，避免日志爆炸） */
  data?: unknown
  durationMs?: number
  error?: string
}

export interface LogFilter {
  stage?: string
  level?: LogLevel
  pageId?: string
  /** 最多返回条数（从尾部截取） */
  tail?: number
}

const MAX_DATA_JSON = 2000

function summarizeData(data: unknown): unknown {
  if (data === undefined) return undefined
  try {
    const json = JSON.stringify(data)
    if (json.length <= MAX_DATA_JSON) return data
    return { truncated: true, preview: json.slice(0, MAX_DATA_JSON) }
  } catch {
    return { note: 'unserializable' }
  }
}

export interface DeckLogger {
  log(entry: Omit<LogEntry, 'ts'> & { ts?: string }): void
  info(stage: string, msg: string, data?: unknown): void
  warn(stage: string, msg: string, data?: unknown): void
  error(stage: string, msg: string, error?: unknown, data?: unknown): void
  /** 记录一次异步操作耗时 */
  timed<T>(stage: string, msg: string, fn: () => Promise<T>): Promise<T>
  /** 等待已排队的日志全部落盘（测试/收尾用） */
  flush(): Promise<void>
  filePath: string
}

export function createDeckLogger(deckDir: string, deckId: string, consoleEcho = true): DeckLogger {
  const logsDir = join(deckDir, 'logs')
  const filePath = join(logsDir, 'generation.log')
  let queue: Promise<void> = Promise.resolve()
  let ensured = false

  function persist(entry: LogEntry): Promise<void> {
    const write = () => appendFile(filePath, JSON.stringify(entry) + '\n', 'utf8')
    if (ensured) return write()
    ensured = true
    return mkdir(logsDir, { recursive: true }).then(write)
  }

  function emit(entry: Omit<LogEntry, 'ts'> & { ts?: string }): void {
    const full: LogEntry = { ts: entry.ts ?? new Date().toISOString(), ...entry, data: summarizeData(entry.data) } as LogEntry
    if (consoleEcho) {
      const tag = `ppt-studio[${deckId}] ${full.stage}${full.pageId ? '/' + full.pageId : ''}: ${full.msg}`
      if (full.level === 'error') console.error(tag, full.error ?? '')
      else if (full.level === 'warn') console.warn(tag)
      else console.log(tag)
    }
    // 串行化追加，避免并发写交错；回写 queue 供 flush 等待
    queue = queue
      .then(() => persist(full))
      .catch(() => {
        /* 日志失败不阻断业务 */
      })
  }

  return {
    filePath,
    log: emit,
    info: (stage, msg, data) => emit({ stage, deckId, level: 'info', msg, data }),
    warn: (stage, msg, data) => emit({ stage, deckId, level: 'warn', msg, data }),
    error: (stage, msg, error, data) =>
      emit({ stage, deckId, level: 'error', msg, data, error: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error ?? '') }),
    flush: () => queue,
    async timed<T>(stage: string, msg: string, fn: () => Promise<T>): Promise<T> {
      const start = Date.now()
      try {
        const result = await fn()
        emit({ stage, deckId, level: 'info', msg, durationMs: Date.now() - start })
        return result
      } catch (error) {
        emit({
          stage, deckId, level: 'error', msg: msg + '（失败）', durationMs: Date.now() - start,
          error: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error),
        })
        throw error
      }
    },
  }
}

/** 读取并过滤 JSONL 日志。 */
export async function readDeckLog(deckDir: string, filter: LogFilter = {}): Promise<LogEntry[]> {
  const filePath = join(deckDir, 'logs', 'generation.log')
  if (!existsSync(filePath)) return []
  const text = await readFile(filePath, 'utf8')
  const entries: LogEntry[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      entries.push(JSON.parse(trimmed) as LogEntry)
    } catch {
      /* 跳过损坏行 */
    }
  }
  const levelOrder: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }
  const filtered = entries.filter(e => {
    if (filter.stage !== undefined && e.stage !== filter.stage) return false
    if (filter.pageId !== undefined && e.pageId !== filter.pageId) return false
    if (filter.level !== undefined && levelOrder[e.level] < levelOrder[filter.level]) return false
    return true
  })
  return filter.tail !== undefined ? filtered.slice(-filter.tail) : filtered
}

export interface DeckReport {
  deckId: string
  title: string
  generatedAt: string
  themeId: string
  pageCount: number
  validation: { ok: boolean; errorCount: number; warningCount: number; issues: unknown[] }
  render: { pptxPath?: string; previewPath?: string; durationMs?: number; pptxBytes?: number; notes: string[] }
  pages: Array<{ pageId: string; type: string; title?: string; errors: number; warnings: number }>
}

/** 原子写入 report.json。 */
export async function writeDeckReport(deckDir: string, report: DeckReport): Promise<string> {
  const path = join(deckDir, 'report.json')
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, JSON.stringify(report, null, 2), 'utf8')
  const { rename } = await import('node:fs/promises')
  await rename(tmp, path)
  return path
}
