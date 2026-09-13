/**
 * ppt_deck_find_replace —— 阶段 8 批量修改：全册查找替换。
 *
 * 典型场景："把所有'人工智能'改成'AI'"——不必逐页 page_write。
 * scope 限定范围（content 正文/表格、titles 页标题、notes 演讲备注、all）；
 * dryRun=true 只返回影响面（页清单 + 替换样例）不落盘；确认后去掉 dryRun 执行。
 * 改动按页落盘后走增量校验：ppt_scene_check（revalidated=受影响页）→ ppt_deck_render。
 */
import { z } from 'zod'
import type { PageScene, TableElement, TextElement } from '../schema.js'
import { requireDeckState } from '../deck-store.js'
import { validateDeckPages } from '../validate.js'
import { createDeckLogger } from '../logger.js'
import type { ResolvedPptStudioConfig } from '../config.js'
import { asRecord, oneText, resolveToolContext, type ToolDefinition } from './registry.js'

type Scope = 'content' | 'titles' | 'notes' | 'all'

interface ReplaceOutcome {
  page: PageScene
  changed: boolean
  matches: number
  samples: Array<{ before: string; after: string }>
  /** 表格单元格命中数（dryRun 分组展示用） */
  tableMatches: number
  /** 被 skipTables 跳过的表格元素数 */
  skippedTables: number
  /** SVG 路线页：content 作用域跳过（源码替换有破坏标记结构的风险，0.10.0） */
  skippedSvg?: boolean
}

/** 对单个字符串执行替换（plain 模式 split/join 避免 $ 语义；regex 模式用 String.replace）。 */
function replaceIn(text: string, find: string, replace: string, regex: boolean, re: RegExp | undefined): { text: string; count: number } {
  if (regex && re !== undefined) {
    const matches = text.match(re)
    if (matches === null) return { text, count: 0 }
    return { text: text.replace(re, replace), count: matches.length }
  }
  if (!text.includes(find)) return { text, count: 0 }
  const count = text.split(find).length - 1
  return { text: text.split(find).join(replace), count }
}

function applyToPage(page: PageScene, find: string, replace: string, scope: Scope, regex: boolean, re: RegExp | undefined, skipTables = false): ReplaceOutcome {
  const next = structuredClone(page) as PageScene
  let matches = 0
  let tableMatches = 0
  let skippedTables = 0
  const samples: Array<{ before: string; after: string }> = []
  const hit = (before: string, after: string, count: number) => {
    if (count > 0 && samples.length < 3) samples.push({ before: before.slice(0, 60), after: after.slice(0, 60) })
    matches += count
  }

  if (scope === 'titles' || scope === 'all') {
    if (next.title !== undefined) {
      const r = replaceIn(next.title, find, replace, regex, re)
      hit(next.title, r.text, r.count)
      next.title = r.text
    }
  }
  if (scope === 'notes' || scope === 'all') {
    if (next.notes !== undefined) {
      const r = replaceIn(next.notes, find, replace, regex, re)
      hit(next.notes, r.text, r.count)
      next.notes = r.text
    }
  }
  if (scope === 'content' || scope === 'all') {
    // SVG 路线页（0.10.0）：文字嵌在整页源码里，与标记结构混排——全局替换可能破坏
    // <text>…</text> 边界外的标记，明确跳过并点名（titles/notes 作用域不受影响，那是独立字段）
    if (next.svg !== undefined) {
      return { page: next, changed: matches > 0, matches, samples, tableMatches, skippedTables, skippedSvg: true }
    }
    for (const element of next.elements ?? []) {
      if (element.kind === 'text') {
        const textElement = element as TextElement
        for (const para of textElement.paragraphs) {
          if (para.text !== undefined) {
            const r = replaceIn(para.text, find, replace, regex, re)
            hit(para.text, r.text, r.count)
            para.text = r.text
          }
          for (const run of para.runs ?? []) {
            const r = replaceIn(run.text, find, replace, regex, re)
            hit(run.text, r.text, r.count)
            run.text = r.text
          }
        }
      } else if (element.kind === 'table' && !skipTables) {
        const table = element as TableElement
        table.rows = table.rows.map(row => row.map(cell => {
          const r = replaceIn(cell, find, replace, regex, re)
          hit(cell, r.text, r.count)
          tableMatches += r.count
          return r.text
        }))
      } else if (element.kind === 'table' && skipTables) {
        skippedTables += 1
      }
    }
  }
  return { page: next, changed: matches > 0, matches, samples, tableMatches, skippedTables }
}

export function createFindReplaceTools(config: ResolvedPptStudioConfig): ToolDefinition[] {
  return [
    {
      name: 'ppt_deck_find_replace',
      description:
        '批量修改：全册查找替换文字（典型："把所有\'人工智能\'改成\'AI\'"，不必逐页 page_write）。' +
        '范围 scope：content=正文段落/富文本/表格单元格（默认）、titles=页标题、notes=演讲备注、all=全部；skipTables=true 可跳过表格单元格（防误伤结构化数据）。' +
        '支持正则（regex:true，find 为 JS 正则源串，replace 可用 $1 分组）。' +
        '先 dryRun:true 预览影响面（受影响页清单 + 替换样例，不落盘），用户确认后去掉 dryRun 执行；' +
        '执行后走增量校验：ppt_scene_check（revalidated=受影响页）→ ppt_deck_render。中文：全册查找替换。',
      parameters: {
        type: 'object',
        properties: {
          deckId: { type: 'string' },
          find: { type: 'string', description: '要查找的文字（regex:true 时为正则源串）' },
          replace: { type: 'string', description: '替换为（regex 模式可用 $1 等分组引用）' },
          scope: { type: 'string', enum: ['content', 'titles', 'notes', 'all'], description: '替换范围，默认 content' },
          regex: { type: 'boolean', description: 'true=按正则查找（全局匹配），默认 false 纯文本' },
          dryRun: { type: 'boolean', description: 'true=只返回影响面不落盘（推荐先跑一次）' },
          skipTables: { type: 'boolean', description: 'true=跳过表格单元格（结构化数据防误伤，如指标名/代号不该被全局改词替换）；正文文本框照常替换' },
        },
        required: ['deckId', 'find', 'replace'],
      },
      output: {
        schema: { type: 'object', properties: { deckId: { type: 'string' }, totalMatches: { type: 'number' }, affectedPages: { type: 'array' } }, additionalProperties: true },
        render: (_args, value) => {
          const v = asRecord(value)
          const affected = Array.isArray(v.affectedPages) ? v.affectedPages.map(String) : []
          const samples = Array.isArray(v.samples) ? v.samples : []
          const lines = [
            v.dryRun === true
              ? `🔍 试运行（未修改）：共 ${String(v.totalMatches)} 处匹配，涉及 ${affected.length} 页（${affected.join('、') || '无'}）。`
              : `✅ 已替换 ${String(v.totalMatches)} 处，涉及 ${affected.length} 页（${affected.join('、') || '无'}）并已落盘。`,
          ]
          for (const raw of samples) {
            const s = asRecord(raw)
            lines.push(`  例：${String(s.before)} → ${String(s.after)}`)
          }
          const tbl = Number(v.tableMatches ?? 0)
          const skipped = Number(v.skippedTableElements ?? 0)
          lines.push(`命中分布：正文文本 ${String(v.textMatches ?? 0)} 处` + (tbl > 0 ? `、表格单元格 ${String(tbl)} 处` : '') + (skipped > 0 ? `（已按 skipTables 跳过 ${String(skipped)} 个表格元素）` : '') + '。')
          const svgSkipped = Array.isArray(v.skippedSvgPages) ? v.skippedSvgPages.map(String) : []
          if (svgSkipped.length > 0) {
            lines.push(`⚠️ SVG 页不参与正文替换（文字嵌在整页源码中，全局替换有破坏标记结构的风险）：${svgSkipped.join('、')}——需要改这些页请重写整页 SVG（titles/notes 作用域不受影响）。`)
          }
          const postWarnings = Array.isArray(v.postReplaceWarnings) ? v.postReplaceWarnings : []
          if (v.dryRun !== true && postWarnings.length > 0) {
            lines.push(`⚠️ 替换后复查：受影响页新增 ${String(postWarnings.length)} 条版式提醒（替换可能让文字变长/标题超限）：`)
            for (const raw of postWarnings.slice(0, 5)) {
              const w = asRecord(raw)
              lines.push(`  [${String(w.level)}] ${String(w.pageId)} ${String(w.rule)}：${String(w.message).slice(0, 60)}`)
            }
            if (postWarnings.length > 5) lines.push(`  …共 ${String(postWarnings.length)} 条`)
            lines.push('按需修正后统一 ppt_scene_check（替换已把内容标记为待重校验）。')
          }
          lines.push(v.dryRun === true
            ? '请把影响面展示给用户确认；确认后去掉 dryRun 执行，再 ppt_scene_check + ppt_deck_render。'
            : '下一步：ppt_scene_check（revalidated 只含受影响页）→ ppt_deck_render。')
          return oneText(lines.join('\n'))
        },
      },
      execute: async (rawArgs, exec) => {
        exec?.signal?.throwIfAborted()
        const args = z
          .object({
            deckId: z.string().min(1),
            find: z.string().min(1).max(200),
            replace: z.string().max(200),
            scope: z.enum(['content', 'titles', 'notes', 'all']).optional(),
            regex: z.boolean().optional(),
            dryRun: z.boolean().optional(),
            skipTables: z.boolean().optional(),
          })
          .parse(asRecord(rawArgs))
        const { store } = resolveToolContext(config, exec)
        await requireDeckState(store, args.deckId)
        const outline = await store.loadOutline(args.deckId)
        if (outline === undefined) throw new Error('大纲缺失，无法批量替换')
        const scope: Scope = args.scope ?? 'content'
        let re: RegExp | undefined
        if (args.regex === true) {
          try {
            re = new RegExp(args.find, 'g')
          } catch (error) {
            throw new Error(`正则无效：${error instanceof Error ? error.message : String(error)}`)
          }
        }

        const pages = (await store.loadPages(args.deckId))
          .filter(p => outline.pages.some(o => o.id === p.id))
          .sort((a, b) => a.id.localeCompare(b.id))
        const outcomes = pages.map(page => applyToPage(page, args.find, args.replace, scope, args.regex === true, re, args.skipTables === true))
        const affected = outcomes.filter(o => o.changed)
        const totalMatches = outcomes.reduce((sum, o) => sum + o.matches, 0)
        const samples = affected.flatMap(o => o.samples.map(s => ({ pageId: o.page.id, ...s }))).slice(0, 5)

        let postReplaceWarnings: Array<{ pageId: string; rule: string; level: string; message: string }> = []
        if (args.dryRun !== true) {
          for (const outcome of affected) {
            await store.savePage(args.deckId, outcome.page)
          }
          if (affected.length > 0) {
            const state = await requireDeckState(store, args.deckId)
            if (state.stage === 'rendered') state.stage = 'writing' // 改过内容回到 writing，配合 sceneHash 闸门
            state.contentOutdated = true // 替换即内容变更：渲染前必须重新 ppt_scene_check
            if (state.renderedAt !== undefined) state.renderOutdated = true
            await store.saveState(state)
          }
          // 自动复查（0.8.2）：替换可能让文字变长触发溢出/可读性问题——立即按校验器复查受影响页并点名，
          // 不必等用户想起调 check（语义级一致性仍靠 check 的 storyline 自审）
          if (affected.length > 0) {
            const outline2 = await store.loadOutline(args.deckId)
            const tokens = await store.loadTokens(args.deckId)
            const spec = await store.loadSpec(args.deckId)
            if (outline2 !== undefined && tokens !== undefined) {
              const reloaded = await store.loadPages(args.deckId)
              const affectedIds = new Set(affected.map(o => o.page.id))
              const subset = reloaded.filter(p => affectedIds.has(p.id))
              const result = validateDeckPages(subset, {
                tokens,
                outlinePages: outline2.pages,
                parts: outline2.parts,
                withVisualCharBudget: spec?.densityPolicy.withVisualCharBudget,
                bulletsMax: spec?.densityPolicy.bulletsMax,
              })
              postReplaceWarnings = result.issues
                .filter(i => i.pageId !== undefined)
                .map(i => ({ pageId: i.pageId as string, rule: i.rule, level: i.level, message: i.message }))
            }
          }
        }
        const logger = createDeckLogger(store.paths(args.deckId).root, args.deckId)
        const skippedSvgPages = outcomes.filter(o => o.skippedSvg === true).map(o => o.page.id)
        logger.info('replace', args.dryRun === true ? '批量替换试运行' : '批量替换完成', {
          find: args.find, scope, totalMatches, affectedPages: affected.map(o => o.page.id), dryRun: args.dryRun === true,
          textMatches: totalMatches - outcomes.reduce((acc, o) => acc + o.tableMatches, 0),
          tableMatches: outcomes.reduce((acc, o) => acc + o.tableMatches, 0),
          skippedTableElements: outcomes.reduce((acc, o) => acc + o.skippedTables, 0),
          skippedSvgPages,
          postReplaceWarnings,
        })
        return {
          deckId: args.deckId,
          dryRun: args.dryRun === true,
          scope,
          totalMatches,
          affectedPages: affected.map(o => o.page.id),
          samples,
          textMatches: totalMatches - outcomes.reduce((acc, o) => acc + o.tableMatches, 0),
          tableMatches: outcomes.reduce((acc, o) => acc + o.tableMatches, 0),
          skippedTableElements: outcomes.reduce((acc, o) => acc + o.skippedTables, 0),
          ...(skippedSvgPages.length > 0 ? { skippedSvgPages } : {}),
          postReplaceWarnings,
        }
      },
    },
  ]
}
