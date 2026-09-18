/**
 * ppt_log_query —— 查询生成日志；ppt_deck_status —— 查看进度状态；
 * ppt_doctor —— 环境体检（模块解析/工作区/端口/失败快照）。
 */
import { z } from 'zod'
import { readDeckLog } from '../logger.js'
import { requireDeckState } from '../deck-store.js'
import { collectEnvReport } from '../diag.js'
import { createToolLogger, listFailedSnapshots } from '../toollog.js'
import type { ResolvedPptStudioConfig } from '../config.js'
import { asRecord, oneText, resolveToolContext, type ToolDefinition } from './registry.js'

const STAGE_ORDER = ['briefed', 'outlined', 'planned', 'drafted', 'locked', 'writing', 'rendered'] as const

export function createLogTools(config: ResolvedPptStudioConfig): ToolDefinition[] {
  return [
    {
      name: 'ppt_log_query',
      description:
        '查询生成日志。source=deck（默认）读指定 deck 的生成日志（JSONL，含每次调用/校验/渲染的时间、阶段、页号、耗时、错误堆栈）' +
        '与 report.json 摘要；source=plugin 读插件级调用日志（含建 deck 之前的失败入参快照索引）。' +
        '排查「哪页什么时候改过、渲染为什么失败、工具为什么报错」用本工具。中文：查询 PPT 生成日志。',
      parameters: {
        type: 'object',
        properties: {
          deckId: { type: 'string', description: 'deck 日志必填；source=plugin 时可省略' },
          source: { type: 'string', enum: ['deck', 'plugin'], description: '日志源：deck（默认，单 deck 生成日志）/ plugin（插件级全部工具调用）' },
          stage: { type: 'string', description: 'draft/design/outline/section/page/check/render/asset/image（仅 source=deck）' },
          level: { type: 'string', enum: ['debug', 'info', 'warn', 'error'], description: '最低级别' },
          tail: { type: 'integer', description: '返回最后 N 条，默认 50' },
        },
      },
      output: {
        schema: { type: 'object', properties: { deckId: { type: 'string' }, entries: { type: 'array' } }, additionalProperties: true },
        render: (_args, value) => {
          const v = asRecord(value)
          if (v.source === 'plugin') {
            const entries = Array.isArray(v.entries) ? v.entries : []
            const lines = [`🩺 插件级调用日志（最近 ${entries.length} 条，${String(v.pluginLogPath)}）：`]
            for (const raw of entries) {
              const e = asRecord(raw)
              const mark = e.outcome === 'error' ? '❌' : e.outcome === 'blocked' ? '🚫' : '✅'
              lines.push(
                `  ${mark} ${String(e.ts).slice(11, 19)} ${String(e.tool)} (${String(e.durationMs ?? '?')}ms)` +
                ` 形态=${String(e.argsForm)}${e.frozen === true ? ' 冻结' : ''}` +
                (e.error !== undefined ? ` ！！${String(e.error).slice(0, 120)}` : '') +
                (e.snapshot !== undefined ? ` 快照:${String(e.snapshot)}` : ''),
              )
            }
            const failed = Array.isArray(v.failedSnapshots) ? v.failedSnapshots : []
            if (failed.length > 0) lines.push(`失败入参快照共 ${failed.length} 份（完整内容在 ${String(v.pluginLogPath).replace(/plugin\.log$/, '')}failed/）：最近 ${failed.slice(0, 5).join('，')}`)
            return oneText(lines.join('\n'))
          }
          const entries = Array.isArray(v.entries) ? v.entries : []
          const lines = [`📜 deck ${String(v.deckId)} 日志（最近 ${entries.length} 条）：`]
          for (const raw of entries) {
            const e = asRecord(raw)
            lines.push(
              `  ${String(e.ts).slice(11, 19)} [${String(e.level)}] ${String(e.stage)}${e.pageId !== undefined ? '/' + String(e.pageId) : ''} ${String(e.msg)}` +
              (e.error !== undefined ? ` ！！${String(e.error).slice(0, 160)}` : '') +
              (e.durationMs !== undefined ? ` (${String(e.durationMs)}ms)` : ''),
            )
          }
          const report = asRecord(v.report)
          if (report.generatedAt !== undefined) {
            lines.push(`报告：${String(report.pageCount)} 页，warning ${String(asRecord(report.validation).warningCount)} 条，生成于 ${String(report.generatedAt)}`)
          }
          return oneText(lines.join('\n'))
        },
      },
      execute: async (rawArgs, exec) => {
        exec?.signal?.throwIfAborted()
        const args = z
          .object({
            deckId: z.string().min(1).optional(),
            source: z.enum(['deck', 'plugin']).optional(),
            stage: z.string().max(20).optional(),
            level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
            tail: z.number().int().min(1).max(1000).optional(),
          })
          .parse(asRecord(rawArgs))
        const { store } = resolveToolContext(config, exec)
        if (args.source === 'plugin') {
          // 插件级调用日志：跨 deck、含建 deck 之前的失败（入参快照索引）
          const toolLogger = createToolLogger(store.rootDir)
          const entries = await toolLogger.readTail(args.tail ?? 50)
          const failed = await listFailedSnapshots(toolLogger.failedDir)
          return { source: 'plugin', entries, failedSnapshots: failed.slice(0, 20), pluginLogPath: toolLogger.pluginLogPath }
        }
        if (args.deckId === undefined) {
          throw new Error('查询 deck 日志必须提供 deckId（或用 source:"plugin" 查插件级日志）')
        }
        await requireDeckState(store, args.deckId)
        const paths = store.paths(args.deckId)
        const entries = await readDeckLog(paths.root, { stage: args.stage, level: args.level, tail: args.tail ?? 50 })
        const report = await store.readJson<Record<string, unknown>>(paths.report)
        return { deckId: args.deckId, entries, report: report ?? null }
      },
    },
    {
      name: 'ppt_deck_status',
      description: '查看 deck 进度（阶段、已写页面/总页面、sceneHash、渲染产物路径）；不传 deckId 时列出全部 deck。中文：查看 PPT 制作进度。',
      parameters: {
        type: 'object',
        properties: { deckId: { type: 'string', description: '省略则列出全部 deck' } },
      },
      output: {
        schema: { type: 'object', properties: { decks: { type: 'array' } }, additionalProperties: true },
        render: (_args, value) => {
          const v = asRecord(value)
          const decks = Array.isArray(v.decks) ? v.decks : []
          const lines = decks.map(raw => {
            const d = asRecord(raw)
            const stage = String(d.stage)
            const progress = `${String(d.pagesWrittenCount ?? (Array.isArray(d.pagesWritten) ? d.pagesWritten.length : 0))}/${String(d.pageCountTotal ?? '?')}`
            const flags: string[] = []
            if (d.contentOutdated === true) flags.push('⚠️ 内容已变更，需重新 ppt_scene_check')
            if (d.renderOutdated === true) flags.push('⚠️ 已校验未渲染，需 ppt_deck_render')
            if (d.architectureRevisedAt != null) flags.push('架构已修订，需重走 2–5')
            if (d.paused === true) flags.push('已暂停')
            const pagewise = asRecord(d.draftPagewise)
            const pagewiseProgress = asRecord(d.pagewiseProgress)
            for (const [sid, raw] of Object.entries(pagewise)) {
              const pw = asRecord(raw)
              const received = pagewiseProgress[sid]
              flags.push(`🔔 逐页蓝图模式：${sid} 已收 ${received !== undefined ? String(received) : '?'}/${String(pw.quota ?? '?')} 页（累积满额自动恢复）`)
            }
            const flagText = flags.length > 0 ? `｜${flags.join('；')}` : ''
            return `- ${String(d.deckId)}｜${String(d.title)}｜阶段 ${stage}（${STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]) + 1}/7）｜页面 ${progress}${flagText}`
          })
          return oneText(lines.length > 0 ? lines.join('\n') : '没有 deck。从 ppt_brief_create 开始。')
        },
      },
      execute: async (rawArgs, exec) => {
        exec?.signal?.throwIfAborted()
        const args = z.object({ deckId: z.string().min(1).optional() }).parse(asRecord(rawArgs))
        const { store } = resolveToolContext(config, exec)
        if (args.deckId !== undefined) {
          const state = await requireDeckState(store, args.deckId)
          const outline = await store.loadOutline(args.deckId)
          // 逐页蓝图降级进度（0.10.3）：从 outline 现有页数算各闩锁部分的已收页数
          const pagewiseProgress: Record<string, number> = {}
          if (state.draftPagewise !== undefined && outline !== undefined) {
            for (const sid of Object.keys(state.draftPagewise)) {
              pagewiseProgress[sid] = sid === 's0'
                ? ['cover', 'toc', 'closing'].filter(t => outline.pages.some(p => p.sectionId === 's0' && p.type === t)).length
                : outline.pages.filter(p => p.sectionId === sid).length
            }
          }
          return {
            decks: [{
              ...state,
              pageCountTotal: outline?.pages.length,
              pagesWrittenCount: state.pagesWritten.length,
              pagewiseProgress,
            }],
          }
        }
        const states = await store.list()
        return { decks: states.map(s => ({ ...s, pagesWrittenCount: s.pagesWritten.length })) }
      },
    },
    {
      name: 'ppt_doctor',
      description:
        '环境体检：一键汇报 Node/插件版本、pptxgenjs 解析路径与互操作形态、fflate/zod 可用性、输出目录可写性、' +
        '预览端口是否在听、生图接口配置、插件级调用日志与失败入参快照。工具报错原因不明、渲染失败、' +
        '链路整体异常时先调本工具。中文：PPT 插件环境体检。',
      parameters: { type: 'object', properties: {} },
      output: {
        schema: { type: 'object', properties: { report: { type: 'object' } }, additionalProperties: true },
        render: (_args, value) => {
          const r = asRecord(asRecord(value).report)
          const pptx = asRecord(r.pptx)
          const lines = [
            `🩺 dsh-ppt-studio 环境体检（v${String(r.pluginVersion)}，Node ${String(r.nodeVersion)}）：`,
            `  - pptxgenjs：${pptx.ok === true ? `✅ 形态 ${String(pptx.shape)}（${String(pptx.ctorName)}）` : '❌ 不可用'}，解析自 ${String(pptx.resolvedPath ?? '?')}`,
            `  - 依赖：fflate ${r.fflate === true ? '✅' : '❌'}，zod ${r.zod === true ? '✅' : '❌'}`,
            `  - 工作区：${String(r.outputRoot)}（${r.outputRootWritable === true ? '可写' : '❌ 不可写'}）`,
            `  - 预览端口 ${String(r.previewPort)}：${r.previewListening === true ? '有服务在听 ✅' : '无服务（预览链接需先启动 preview-server：npm run preview）'}`,
            `  - 生图接口：${r.imageApiConfigured === true ? `已配置（${String(r.imageApiModel)}）` : '未配置（image 元素请用 placeholder 或形状替代）'}`,
            `  - 插件调用日志：${r.pluginLogExists === true ? `有（${String(r.pluginLogPath)}）` : '暂无'}` +
              `，失败入参快照 ${String(r.failedSnapshotCount)} 份`,
          ]
          const suggestions: string[] = []
          if (pptx.ok !== true) suggestions.push('pptxgenjs 不可用：检查插件 node_modules 是否完整（npm install），确认 dist/ 下有 pptxgen.es.js')
          if (r.outputRootWritable !== true) suggestions.push(`输出目录不可写：检查 ${String(r.outputRoot)} 权限或设置 PPT_STUDIO_OUTPUT_DIR`)
          if (typeof r.failedSnapshotCount === 'number' && r.failedSnapshotCount > 0) suggestions.push(`有 ${r.failedSnapshotCount} 份失败入参快照：用 ppt_log_query source=plugin 查看最近失败与快照路径`)
          if (suggestions.length > 0) lines.push('建议：', ...suggestions.map(s => `  → ${s}`))
          return oneText(lines.join('\n'))
        },
      },
      execute: async (rawArgs, exec) => {
        exec?.signal?.throwIfAborted()
        const { store, config: resolved } = resolveToolContext(config, exec)
        const report = await collectEnvReport(store.rootDir, resolved)
        return { report }
      },
    },
  ]
}
