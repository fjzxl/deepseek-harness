/**
 * 熔断分型回归（0.11.2）：session 2026-09-20 中模型按熔断指引换路
 * （content 模式 → elements+append）仍被"只看工具名"的熔断连拦 7 次。
 * 现在熔断按 (tool, 入参结构指纹) 独立计数：同构重试照拦，结构性换路放行。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolvePptStudioConfig } from '../src/config.js'
import { DeckStore } from '../src/deck-store.js'
import { buildPptStudioTools } from '../src/tools/index.js'
import { createToolLogger, failureStreak, shapeFingerprint, type ToolCallRecord } from '../src/toollog.js'

const tempRoots: string[] = []
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** 构造一条 plugin.log 记录（outcome/shape 由调用方定） */
function entry(tool: string, outcome: ToolCallRecord['outcome'], shape?: string): Omit<ToolCallRecord, 'ts'> {
  return { tool, outcome, shape, argsForm: 'object', frozen: false, durationMs: 1 }
}

describe('shapeFingerprint', () => {
  it('值不参与指纹：同结构不同文案 → 同指纹（换汤不换药会被识别）', () => {
    const a = shapeFingerprint({ deckId: 'x', pageId: 'p1', scene: { content: { items: ['一', '二'] } } })
    const b = shapeFingerprint({ pageId: 'p2', deckId: 'y', scene: { content: { items: ['完全不同的文案', '另一些字'] } } })
    expect(a).toBe(b)
  })

  it('结构性换路 → 不同指纹（content ↔ elements+append）', () => {
    const content = shapeFingerprint({ deckId: 'x', pageId: 'p', scene: { content: { items: ['a'] } } })
    const elements = shapeFingerprint({ deckId: 'x', pageId: 'p', append: true, remove: ['t-1'], scene: { elements: [{ id: 't-1', kind: 'text' }] } })
    expect(content).not.toBe(elements)
  })

  it('数组折叠为 []：元素个数不同视为同构', () => {
    const a = shapeFingerprint({ scene: { elements: [{ kind: 'text' }, { kind: 'shape' }] } })
    const b = shapeFingerprint({ scene: { elements: [{ kind: 'text' }] } })
    expect(a).toBe(b)
  })
})

describe('failureStreak 分型统计', () => {
  const tool = 'ppt_page_write'
  const shapeA = shapeFingerprint({ scene: { content: { items: ['a'] } } })
  const shapeB = shapeFingerprint({ append: true, scene: { elements: [] } })

  it('同 shape 连败计数；异 shape 调用不受旧失败连坐（session 卡点回归）', () => {
    const tail = [
      entry(tool, 'error', shapeA),
      entry(tool, 'error', shapeA),
      entry(tool, 'error', shapeA),
      entry(tool, 'error', shapeA),
      entry(tool, 'error', shapeA),
    ]
    expect(failureStreak(tail, tool, shapeA)).toEqual({ errors: 5, blocked: 0 })
    // 修复前：模型换路后仍被拦（同名即连坐）；修复后：shapeB 无失败记录，放行
    expect(failureStreak(tail, tool, shapeB)).toEqual({ errors: 0, blocked: 0 })
  })

  it('异 shape 的拦截与失败不计数、不重置同 shape streak；异 shape 成功也不重置', () => {
    const tail = [
      entry(tool, 'error', shapeA),
      entry(tool, 'error', shapeA),
      entry(tool, 'ok', shapeB),
      entry(tool, 'error', shapeB),
      entry(tool, 'blocked', shapeA),
    ]
    expect(failureStreak(tail, tool, shapeA)).toEqual({ errors: 2, blocked: 1 })
    expect(failureStreak(tail, tool, shapeB)).toEqual({ errors: 1, blocked: 0 })
  })

  it('无 shape 字段的旧日志条目：分型查询时跳过（升级后一次性复位），聚合查询照旧计入', () => {
    const tail = [
      entry(tool, 'error'),
      entry(tool, 'error'),
      entry(tool, 'error'),
      entry(tool, 'error'),
      entry(tool, 'error'),
    ]
    expect(failureStreak(tail, tool, shapeA)).toEqual({ errors: 0, blocked: 0 })
    expect(failureStreak(tail, tool)).toEqual({ errors: 5, blocked: 0 })
  })

  it('省略 shape 保持旧聚合语义（降级/闩锁判定不受影响）', () => {
    const tail = [
      entry(tool, 'error', shapeA),
      entry(tool, 'error', shapeB),
      entry(tool, 'ok', shapeA),
      entry(tool, 'error', shapeB),
      entry(tool, 'error', shapeA),
    ]
    expect(failureStreak(tail, tool)).toEqual({ errors: 2, blocked: 0 })
  })
})

describe('withDiagnostics 熔断集成（0.11.2 分型）', () => {
  it('同构连败 5 次后拦截；结构性换路的调用放行并真实执行', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ppt-studio-breaker-'))
    tempRoots.push(workspace)
    const exec = { agent: { session: { header: { cwd: workspace } } } }
    const config = resolvePptStudioConfig({})
    const store = new DeckStore(join(workspace, 'ppt-studio'))
    const { deckId } = await store.create('熔断测试 deck')
    const pageWrite = buildPptStudioTools(config).find(t => t.name === 'ppt_page_write')!

    // 同构失败载荷（session 真实形态：content 模式 + {"item":[…]} 包装）
    const sameShapeArgs = { deckId, pageId: 'p003', scene: { content: { items: { item: ['要点一', '要点二'] } } } }
    const logger = createToolLogger(join(workspace, 'ppt-studio'))
    for (let i = 0; i < 5; i++) logger.record(entry('ppt_page_write', 'error', shapeFingerprint(sameShapeArgs)))
    await logger.flush()

    // 同构重试 → 🚫 熔断拦截（未执行）
    const blocked = await pageWrite.execute(sameShapeArgs, exec as never).then(() => null, (e: Error) => e)
    expect(blocked).toBeInstanceOf(Error)
    expect(blocked!.message).toContain('熔断保护')

    // 结构性换路（session 中模型的正确动作：elements + append）→ 不被连坐，真实执行到业务校验
    const switchedArgs = { deckId, pageId: 'p003', append: true, remove: ['t-body1'], scene: { elements: [{ id: 't-body1', kind: 'text', fontSize: 16, color: '#334155', paragraphs: [{ text: '要点' }] }] } }
    const executed = await pageWrite.execute(switchedArgs, exec as never).then(() => 'ok', (e: Error) => e.message)
    expect(executed).not.toContain('熔断')
    // 无大纲 → 走到业务校验才报错（证明真正执行了，而非被拦截）
    expect(executed).toContain('大纲')
  })
})
