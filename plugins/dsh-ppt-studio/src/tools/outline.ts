/**
 * ppt_outline_draft —— 第 b 步：Deck Architecture（叙事架构）。
 * ppt_section_draft —— 第 d 步：单部分 Page Blueprint（每页 purpose/keyMessage/structure/density/visual）。
 *
 * 架构层回答「这套 PPT 讲一个什么故事」：核心主张 + 各部分的关键问题与答案，
 * 形成叙事链条（如 历史 → 原理 → 突破 → 扩展 → 未来）。
 * Blueprint 层回答「这一页为什么存在、怎么讲」：先定义意图，再定义内容。
 *
 * 页 ID 采用全册规范化重编号：封面 p001 / 目录 p002 → 各部分按架构顺序 →
 * 结尾最后一页。每次 section_draft 后重算全部页 ID，保证任意调用顺序下
 * 页序稳定（page_write 只认 outline.json 中的最终 ID）。
 */
import { z } from 'zod'
import { existsSync } from 'node:fs'
import { readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { DeckOutline, OutlinePage } from '../schema.js'
import {
  deckOutlineSchema,
  INFO_STRUCTURES,
  outlinePageSchema,
  PAGE_TYPES,
  sectionDraftSchema,
  visualPlanEnum,
} from '../schema.js'
import { createDeckLogger } from '../logger.js'
import { requireDeckState } from '../deck-store.js'
import type { ResolvedPptStudioConfig } from '../config.js'
import { asRecord, oneText, resolveToolContext, type ToolDefinition } from './registry.js'

const STRUCTURAL_TYPES = ['cover', 'toc', 'closing'] as const

const outlineArgsSchema = z.object({
  deckId: z.string().min(1),
  coreMessage: z.string().min(1).max(200),
  parts: z
    .array(
      z.object({
        id: z.string().regex(/^s\d{1,2}$/).optional(),
        title: z.string().min(1).max(60),
        question: z.string().min(1).max(120),
        message: z.string().min(1).max(200),
        suggestedPages: z.number().int().min(1).max(20).optional(),
      }),
    )
    .min(2)
    .max(12),
  /** 架构修订（0.8.0）：确认后允许在原 deck 上改故事——清除蓝图/已写页/页数计划，保留简报与设计令牌 */
  revise: z.boolean().optional(),
})

const sectionArgsSchema = z.object({
  deckId: z.string().min(1),
  sectionId: z.string().regex(/^s\d{1,2}$/),
  pages: z
    .array(
      z.object({
        id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,39}$/).optional(),
        type: z.enum(PAGE_TYPES),
        title: z.string().min(1).max(80),
        contentBrief: z.string().min(1).max(500),
        purpose: z.string().max(200).optional(),
        keyMessage: z.string().max(200).optional(),
        structure: z.enum(INFO_STRUCTURES).optional(),
        density: z.enum(['low', 'medium', 'high']).optional(),
        visual: visualPlanEnum.optional(),
        transition: z
          .object({ fromPrevious: z.string().max(160).optional(), nextHook: z.string().max(160).optional() })
          .optional(),
        evidence: z
          .array(
            z.object({
              claim: z.string().min(1).max(200),
              type: z.enum(['fact', 'data', 'example', 'quote']),
              source: z.string().max(200).optional(),
              materialId: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,39}$/).optional(),
              locator: z.string().max(120).optional(),
            }),
          )
          .max(8)
          .optional(),
        densityOverride: z.object({ reason: z.string().min(1).max(120) }).optional(),
      }),
    )
    .min(1)
    .max(20),
})

function renderPages(pages: OutlinePage[]): string {
  return pages
    .map(p => {
      const meta: string[] = [p.type]
      if (p.structure !== 'plain') meta.push(`结构 ${p.structure}`)
      if (p.visual !== 'none') meta.push(`配${p.visual === 'image' ? '图' : '图表'}`)
      return `  [${p.id}] ${meta.join('｜')}｜${p.title} —— ${p.contentBrief}` +
        (p.keyMessage !== undefined ? `\n        核心信息：${p.keyMessage}` : '') +
        (p.transition?.fromPrevious !== undefined ? `\n        承接上页：${p.transition.fromPrevious}` : '')
    })
    .join('\n')
}

/** 全册规范化页序：封面 → 目录 → 各部分（按架构顺序）→ 结尾。未草拟的部分自然缺席。 */
function canonicalOrder(outline: DeckOutline): OutlinePage[] {
  const structural = outline.pages.filter(p => p.sectionId === 's0')
  const ordered: OutlinePage[] = []
  const cover = structural.find(p => p.type === 'cover')
  const toc = structural.find(p => p.type === 'toc')
  if (cover !== undefined) ordered.push(cover)
  if (toc !== undefined) ordered.push(toc)
  for (const part of outline.parts) {
    ordered.push(...outline.pages.filter(p => p.sectionId === part.id))
  }
  const closing = structural.find(p => p.type === 'closing')
  if (closing !== undefined) ordered.push(closing)
  return ordered.map((page, index) => ({ ...page, id: `p${String(index + 1).padStart(3, '0')}` }))
}

/** 蓝图内容等价（忽略 id）：等价 → 已写页可在重排中保留，仅换编号。 */
function blueprintEqual(a: OutlinePage, b: OutlinePage): boolean {
  const { id: _a, sectionId: _sa, ...restA } = a
  const { id: _b, sectionId: _sb, ...restB } = b
  return JSON.stringify(restA) === JSON.stringify(restB)
}

export interface PageMigration {
  /** 已写页文件按旧 id → 新 id 迁移（其他部分因增删页而整体位移） */
  renumbered: Array<{ from: string; to: string }>
  /** 蓝图内容变化（或被移除）而清除的已写页：需要重写 */
  invalidated: string[]
  /** 蓝图中等价保留、仅换编号的页数 */
  keptCount: number
}

/**
 * 页 ID 重排迁移（0.8.0，正确性修复）：重编号后把已写页文件、pageHashes、pagesWritten
 * 一并对齐到新编号——否则增删一页后文件名/哈希键/大纲全部错位。
 * 策略：未重草拟的部分按位置迁移（蓝图原样）；重草拟的部分内容等价的页保留，
 * 内容变化的页清除（蓝图已变，页面必须重写）；蓝图里消失的旧页删除。
 */
async function migrateWrittenPages(
  store: import('../deck-store.js').DeckStore,
  deckId: string,
  state: import('../schema.js').DeckState,
  oldOutline: DeckOutline,
  newOutline: DeckOutline,
  redraftedSection: string,
): Promise<PageMigration | undefined> {
  if (state.pagesWritten.length === 0) return undefined
  const oldOrdered = canonicalOrder(oldOutline)
  const newOrdered = newOutline.pages
  const sectionIds = ['s0', ...oldOutline.parts.map(p => p.id)]
  const map = new Map<string, string>()
  for (const sid of sectionIds) {
    const olds = oldOrdered.filter(p => p.sectionId === sid)
    const news = newOrdered.filter(p => p.sectionId === sid)
    const sameSection = sid === redraftedSection
    for (let j = 0; j < Math.min(olds.length, news.length); j++) {
      // 其他部分蓝图未动按位置迁移；重草拟部分只有内容等价才保留
      if (!sameSection || blueprintEqual(olds[j], news[j])) map.set(olds[j].id, news[j].id)
    }
  }
  const written = new Set(state.pagesWritten)
  const pagesDir = store.paths(deckId).pagesDir
  const file = (id: string) => join(pagesDir, `${id}.json`)
  const migration: PageMigration = { renumbered: [], invalidated: [], keptCount: 0 }
  // 两阶段改名避免 p005→p006 与 p006→p007 相互覆盖
  const moves = [...map].filter(([from, to]) => from !== to && written.has(from))
  // 原子性预检（0.8.1）：源文件缺失（可能被手动删除）或目标被非迁移文件占据（手动创建）→ 拒绝迁移并给出处理指引
  const missing = moves.filter(([from]) => !existsSync(file(from))).map(([from]) => from)
  if (missing.length > 0) {
    throw new Error(`页 ID 迁移中止：已写页文件缺失（可能被手动删除）：${missing.join('、')}。请先恢复这些文件（git/备份）或重写对应页面后再重草拟。`)
  }
  const moveSources = new Set(moves.map(([from]) => from))
  // 即将被清除的已写页（蓝图移除/内容变化）不算“目标被占用”——它们的文件在 rename 前已被删除
  // （0.9.1 修复：删页后其余页位移时，目标文件名正是被删页的旧文件，此前会被误判为冲突而中止迁移）
  const doomed = new Set(state.pagesWritten.filter(id => !map.has(id)))
  const conflicts = moves.filter(([, to]) => existsSync(file(to)) && !moveSources.has(to) && !doomed.has(to)).map(([, to]) => to)
  if (conflicts.length > 0) {
    throw new Error(`页 ID 迁移中止：目标文件名已被占用（疑似手动创建）：${conflicts.map(to => `${to}.json`).join('、')}。请先备份/清理这些文件（它们不在大纲中）再重草拟。`)
  }
  // 旧已写页不在映射里 → 蓝图移除或内容变化 → 删除文件
  for (const oldId of state.pagesWritten) {
    if (!map.has(oldId)) {
      if (existsSync(file(oldId))) await rm(file(oldId), { force: true })
      migration.invalidated.push(oldId)
    }
  }
  for (const [from] of moves) await rename(file(from), `${file(from)}.migr`)
  for (const [from, to] of moves) await rename(`${file(from)}.migr`, file(to))
  // 状态对齐：pagesWritten / pageHashes 换键，sceneHash 失效（大纲变了必须重检）
  const oldHashes = state.pageHashes ?? {}
  const newWritten: string[] = []
  const newHashes: Record<string, string> = {}
  for (const oldId of state.pagesWritten) {
    const to = map.get(oldId)
    if (to === undefined) continue
    newWritten.push(to)
    if (oldHashes[oldId] !== undefined) newHashes[to] = oldHashes[oldId]
    if (to !== oldId) migration.renumbered.push({ from: oldId, to })
    else migration.keptCount++
  }
  state.pagesWritten = newWritten.sort()
  state.pageHashes = newHashes
  state.sceneHash = undefined
  state.contentOutdated = true
  if (state.renderedAt !== undefined) state.renderOutdated = true
  if (migration.renumbered.length > 0 || migration.invalidated.length > 0) {
    state.lastMigration = { renumbered: migration.renumbered, invalidated: migration.invalidated, at: new Date().toISOString() }
  }
  // 引用对齐（0.9.1）：design/spec.json 的 prototypePages 引用页 ID——重排后不同步重映射会指错页/悬空
  const spec = await store.readJson<import('../schema.js').DesignSpec>(store.paths(deckId).spec)
  if (spec?.prototypePages !== undefined && spec.prototypePages.length > 0) {
    const remapped = spec.prototypePages
      .map(id => map.get(id))
      .filter((id): id is string => id !== undefined) // 蓝图消失的页从代表页清单移除
    if (remapped.length !== spec.prototypePages.length || remapped.some((id, i) => id !== spec.prototypePages![i])) {
      await store.saveJson(store.paths(deckId).spec, { ...spec, prototypePages: remapped })
    }
  }
  return migration
}

export function createOutlineTools(config: ResolvedPptStudioConfig): ToolDefinition[] {
  return [
    {
      name: 'ppt_outline_draft',
      description:
        'PPT 制作第 b 步（简报确认后）：生成 Deck Architecture（叙事架构）——这套 PPT 讲一个什么故事。' +
        '输出：全 deck 核心主张（coreMessage）+ 各部分（标题 + 关键问题 question + 核心信息 message + 建议页数），' +
        '各部分的问题串起来应形成叙事链条（历史 → 原理 → 突破 → 扩展 → 未来 这类推进关系），而不是并列的名词目录。' +
        '架构确认后不可回退——要改故事有两条路：新 deck 重走，或用户明确确认修订后带 revise:true 原地重调（清除蓝图/已写页/页数计划，保留简报与设计令牌，需重走 2–5）。' +
        '返回架构全文，必须原样展示给用户确认/修改（用户改后重新调用覆盖）；确认后进入第 c 步询问内容页数并调 ppt_pageplan_confirm。' +
        '中文：生成 PPT 叙事架构（核心主张 + 各部分问题链）。',
      parameters: {
        type: 'object',
        properties: {
          deckId: { type: 'string' },
          revise: { type: 'boolean', description: '架构修订模式：用户明确确认要改故事时才传 true——清除蓝图/已写页/页数计划（保留简报与设计令牌），回退 outlined 重走 2–5' },
          coreMessage: { type: 'string', description: '全 deck 核心主张：一句话讲清这套 PPT 的故事' },
          parts: {
            type: 'array',
            description: '叙事架构的部分，2-12 个',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '部分 ID，形如 s1/s2（省略则自动编号）' },
                title: { type: 'string', description: '部分标题（内容的名字）' },
                question: { type: 'string', description: '本部分回答的关键问题（叙事钩子），如「机器为什么能够学习？」' },
                message: { type: 'string', description: '本部分要传达的核心信息（一句话答案）' },
                suggestedPages: { type: 'integer', description: '建议页数（仅提示）' },
              },
              required: ['title', 'question', 'message'],
            },
          },
        },
        required: ['deckId', 'coreMessage', 'parts'],
        revise: { type: 'boolean', description: '架构修订模式：用户明确确认要改故事时才传 true——清除该 deck 的蓝图/已写页/页数计划（保留简报与设计令牌），回退到 outlined 阶段重走 2–5' },
      },
      output: {
        schema: { type: 'object', properties: { deckId: { type: 'string' }, coreMessage: { type: 'string' }, parts: { type: 'array' } }, additionalProperties: true },
        render: (_args, value) => {
          const v = asRecord(value)
          const parts = Array.isArray(v.parts) ? v.parts : []
          const revised = asRecord(v.revised)
          const lines = [`✅ 叙事架构${revised.previousStage !== undefined ? '已修订（revise）' : '已生成'}（${parts.length} 个部分）`]
          if (revised.previousStage !== undefined) {
            lines.push(`⚠️ 架构修订：原阶段 ${String(revised.previousStage)} 的 ${String(revised.discardedPages)} 个已写页与全部蓝图/页数计划已清除（简报与设计令牌保留）。必须重走阶段 2（页数）→ 3（蓝图）→ 4（如换视觉风格重新 lock）→ 5（写页）。`)
          }
          lines.push(`核心主张：${String(v.coreMessage)}`)
          lines.push('叙事链：')
          for (const raw of parts) {
            const p = asRecord(raw)
            lines.push(`  ${String(p.id)}｜${String(p.title)}`)
            lines.push(`      问：${String(p.question)}`)
            lines.push(`      答：${String(p.message)}${p.suggestedPages !== undefined ? `（建议 ${String(p.suggestedPages)} 页）` : ''}`)
          }
          lines.push('')
          lines.push('请展示给用户确认叙事逻辑；用户修改后重新调用本工具。确认后询问用户需要多少页内容页，再调 ppt_pageplan_confirm。')
          return oneText(lines.join('\n'))
        },
      },
      execute: async (rawArgs, exec) => {
        exec?.signal?.throwIfAborted()
        const args = outlineArgsSchema.parse(asRecord(rawArgs))
        const { store } = resolveToolContext(config, exec)
        const state = await requireDeckState(store, args.deckId)
        const brief = await store.loadBrief(args.deckId)
        if (brief === undefined) throw new Error('必须先 ppt_brief_create 完成简报')
        const revising = args.revise === true && state.stage !== 'briefed' && state.stage !== 'outlined'
        if (!revising && state.stage !== 'briefed' && state.stage !== 'outlined') {
          throw new Error(
            `当前阶段为 ${state.stage}，叙事架构已确认过；要改故事有两条路：` +
            '①新 deck 重走 0–3；②用户明确确认修订后带 "revise": true 重新调用（原地改故事：清除蓝图/已写页/页数计划，保留简报与设计令牌，需重走阶段 2–5）',
          )
        }

        let revised: { previousStage: string; discardedPages: number } | undefined
        if (revising) {
          // 架构修订（0.8.0）：outline 是唯一事实源——蓝图、已写页、页数计划全部作废清除
          const paths = store.paths(args.deckId)
          if (existsSync(paths.sectionsDir)) await rm(paths.sectionsDir, { recursive: true, force: true })
          if (existsSync(paths.pagesDir)) await rm(paths.pagesDir, { recursive: true, force: true })
          if (existsSync(paths.plan)) await rm(paths.plan, { force: true })
          revised = { previousStage: state.stage, discardedPages: state.pagesWritten.length }
          state.pagesWritten = []
          state.pageHashes = {}
          state.sceneHash = undefined
          state.renderedAt = undefined
          state.contentOutdated = false
          state.renderOutdated = false
          state.architectureRevisedAt = new Date().toISOString()
        }

        const parts = args.parts.map((part, index) => ({ ...part, id: part.id ?? `s${index + 1}` }))
        if (new Set(parts.map(p => p.id)).size !== parts.length) throw new Error('部分 ID 重复')
        const outline: DeckOutline = deckOutlineSchema.parse({ parts, coreMessage: args.coreMessage, pages: [] })
        await store.saveJson(store.paths(args.deckId).outline, outline)
        state.stage = 'outlined'
        await store.saveState(state)
        const logger = createDeckLogger(store.paths(args.deckId).root, args.deckId)
        logger.info('outline', revising ? '叙事架构已修订（revise，下游全部作废）' : '叙事架构已生成', { partCount: parts.length, coreMessage: args.coreMessage, ...(revised !== undefined ? { revised } : {}) })
        return { deckId: args.deckId, coreMessage: args.coreMessage, parts, ...(revised !== undefined ? { revised } : {}) }
      },
    },
    {
      name: 'ppt_section_draft',
      description:
        'PPT 制作第 d 步（页数与分配确认后）：为一个部分生成 Page Blueprint——先定义"这页为什么存在"再定义"这页放什么"。' +
        '每页含：页型 type、标题、内容概要、purpose（这页存在的理由）、keyMessage（一句话核心信息）、' +
        'structure（信息结构：timeline/comparison/process/hierarchy/cause-effect/problem-solution/before-after/concept-example/data-insight/plain）、' +
        'density（low/medium/high 页级密度意图）、visual（配图计划 image/chart/none）、' +
        'transition（叙事衔接：fromPrevious 承接上一页/nextHook 埋给下一页的钩子，strictness=strict 时缺失升 warning）、' +
        'evidence（证据条目 claim/type/source/materialId/locator，内网环境来源只能来自用户材料，无法核实的数据改定性表述或标「数据待补充」）。' +
        '落盘 sections/<sid>.json 并合并进 outline.json 的页级清单。' +
        'sectionId=s0 专门放结构页（封面/目录/结尾，各恰好一页）；若 plan 有确认的分配则各部分页数必须精确匹配，否则只需 Σ=确认页数。' +
        '页 ID 由工具按全册顺序自动编号（封面→目录→各部分→结尾），无需手填；已在写作中重草拟时，其他部分的已写页会随重排自动迁移文件与校验指纹，蓝图变化页会被清除并提示重写。' +
        '全部部分完成后把整体 Blueprint 展示给用户确认，再调 ppt_design_lock。中文：生成单部分页面蓝图。',
      parameters: {
        type: 'object',
        properties: {
          deckId: { type: 'string' },
          sectionId: { type: 'string', description: '部分 id（s1..sn），或 s0 表示结构页（封面/目录/结尾）' },
          pages: {
            type: 'array',
            description: '该部分的页面蓝图',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: [...PAGE_TYPES], description: '页型（由信息结构选择，见 layouts.md）' },
                title: { type: 'string', description: '页标题' },
                contentBrief: { type: 'string', description: '这页讲什么（内容概要，≤500 字，逐页生成的依据）' },
                purpose: { type: 'string', description: '这页为什么存在（一页回答一个具体问题）' },
                keyMessage: { type: 'string', description: '这页的一句话核心信息（写页时的内容锚点）' },
                structure: { type: 'string', enum: [...INFO_STRUCTURES], description: '信息结构（逻辑关系类型）' },
                density: { type: 'string', enum: ['low', 'medium', 'high'], description: '页级密度意图，默认 medium' },
                visual: { type: 'string', enum: ['image', 'chart', 'none'], description: '配图计划：image=实图/占位，chart=图表，none=纯文字' },
                transition: {
                  type: 'object',
                  description: '叙事衔接（strictness=strict 时缺失升 warning；其余档可选，链部分建立时缺口提示 info）：fromPrevious=承接上一页（回答上一页的钩子），nextHook=给下一页埋的钩子',
                  properties: {
                    fromPrevious: { type: 'string', description: '这页如何承接上一页（≤160 字）' },
                    nextHook: { type: 'string', description: '这页给下一页埋的钩子（≤160 字）' },
                  },
                },
                evidence: {
                  type: 'array',
                  description: '证据条目（evidenceLevel≥business 时校验来源）：本页关键论断与来源；内网环境来源只能来自用户材料，禁止编造',
                  items: {
                    type: 'object',
                    properties: {
                      claim: { type: 'string', description: '论断原文（如「全球 AI 市场规模 1.8 万亿美元」）' },
                      type: { type: 'string', enum: ['fact', 'data', 'example', 'quote'], description: '论断类型' },
                      source: { type: 'string', description: '来源（用户材料/内部报告）；无法核实时改定性表述或标「数据待补充」' },
                      materialId: { type: 'string', description: '精确引用：简报 referenceMaterials 条目的 id（校验按 id 精确匹配，优先于 source 子串匹配）' },
                      locator: { type: 'string', description: '出处定位（如「第 12 页，表 2」），让材料里的哪一处可追溯' },
                    },
                    required: ['claim', 'type'],
                  },
                },
                densityOverride: {
                  type: 'object',
                  description: '页级预算豁免（少用）：写明 reason 允许该页突破全册密度/要点预算（如"总结页需罗列全部要点"），校验降为 info 知情放行',
                  properties: { reason: { type: 'string', description: '豁免理由（≤120 字，展示给用户）' } },
                  required: ['reason'],
                },
              },
              required: ['type', 'title', 'contentBrief'],
            },
          },
        },
        required: ['deckId', 'sectionId', 'pages'],
      },
      output: {
        schema: { type: 'object', properties: { deckId: { type: 'string' }, sectionId: { type: 'string' }, pages: { type: 'array' } }, additionalProperties: true },
        render: (_args, value) => {
          const v = asRecord(value)
          const pages = Array.isArray(v.pages) ? (v.pages as OutlinePage[]) : []
          const progress = asRecord(v.progress)
          const lines = [`✅ 部分 ${String(v.sectionId)} 蓝图已生成（${pages.length} 页）：`, renderPages(pages)]
          lines.push('')
          lines.push(
            `进度：内容页 ${String(progress.contentPages) ?? '?'}/${String(progress.contentTarget) ?? '?'}，` +
              `结构页（封面/目录/结尾）：${String(progress.structuralDone ?? '?')}/3。`,
          )
          const migration = asRecord(v.migration)
          if (migration.renumbered !== undefined || migration.invalidated !== undefined) {
            const renumbered = Array.isArray(migration.renumbered) ? migration.renumbered : []
            const invalidated = Array.isArray(migration.invalidated) ? migration.invalidated : []
            if (renumbered.length > 0) {
              lines.push(`已写页重排迁移：${renumbered.map((raw) => { const m = asRecord(raw); return `${String(m.from)}→${String(m.to)}` }).join('、')}（文件与校验指纹已对齐新编号，内容不变）。`)
            }
            if (invalidated.length > 0) {
              lines.push(`⚠️ 以下已写页因蓝图变化被清除，需要重写：${invalidated.map(String).join('、')}。`)
            }
            lines.push('大纲已变更：渲染前必须重新 ppt_scene_check（sceneHash 已失效）。')
          }
          lines.push('继续下一个部分 ppt_section_draft；全部完成后把整体蓝图展示给用户确认，再调 ppt_design_lock 锁定设计。')
          return oneText(lines.join('\n'))
        },
      },
      execute: async (rawArgs, exec) => {
        exec?.signal?.throwIfAborted()
        // 报错走可读路径（真实会话教训：contentBrief 超 300 / 缺 pages 被拒时只给英文 zod 数组，模型多次重试）
        const args = (() => {
          const parsed = sectionArgsSchema.safeParse(asRecord(rawArgs))
          if (parsed.success) return parsed.data
          const issues = parsed.error.issues.map(i => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')
          const hints: string[] = []
          if (parsed.error.issues.some(i => i.code === 'invalid_type' && i.received === 'undefined' && i.path[0] === 'pages')) {
            hints.push('缺少 pages：必须带该部分的页面蓝图数组（每页 type/title/contentBrief 等）。')
          }
          if (parsed.error.issues.some(i => i.code === 'too_big' && i.path.includes('contentBrief'))) {
            hints.push('contentBrief 超过 500 字上限：概要写"这页讲什么"即可，长内容留给写页阶段。')
          }
          if (parsed.error.issues.some(i => i.path[0] === 'pages' && /type|structure|visual/.test(i.path.join('.')))) {
            hints.push('页条目字段取值不对：type 必须是 17 种页型之一，structure 是十种信息结构，visual 是 image/chart/none。')
          }
          throw new Error(
            'ppt_section_draft 参数不符合要求：\n' + issues +
            (hints.length > 0 ? '\n\n修复提示：\n' + hints.map(h => `  - ${h}`).join('\n') : '') +
            '\n\n正确示例：{"deckId":"…","sectionId":"s1","pages":[{"type":"bullets","title":"页标题","contentBrief":"这页讲什么","purpose":"…","keyMessage":"…","structure":"plain","density":"medium","visual":"none"}]}',
          )
        })()
        const { store } = resolveToolContext(config, exec)
        const state = await requireDeckState(store, args.deckId)
        const outline = await store.loadOutline(args.deckId)
        if (outline === undefined) throw new Error('必须先 ppt_outline_draft 完成叙事架构')
        const plan = await store.loadPlan(args.deckId)
        if (plan === undefined) throw new Error('必须先 ppt_pageplan_confirm 确认内容页数')

        const isStructural = args.sectionId === 's0'
        if (!isStructural && !outline.parts.some(p => p.id === args.sectionId)) {
          throw new Error(`部分 ${args.sectionId} 不在叙事架构中（可用：${outline.parts.map(p => p.id).join(' / ')}，结构页用 s0）`)
        }
        if (isStructural) {
          for (const page of args.pages) {
            if (!(STRUCTURAL_TYPES as readonly string[]).includes(page.type)) {
              throw new Error(`结构页（s0）只允许页型 ${STRUCTURAL_TYPES.join(' / ')}，收到 ${page.type}`)
            }
          }
          const types = args.pages.map(p => p.type)
          if (new Set(types).size !== types.length) throw new Error('结构页每种类型（封面/目录/结尾）恰好一页，不得重复')
        } else {
          for (const page of args.pages) {
            if ((STRUCTURAL_TYPES as readonly string[]).includes(page.type) && page.type !== 'closing') {
              throw new Error(`部分 ${args.sectionId} 的页面不能用结构页型 ${page.type}（封面/目录属于 s0）`)
            }
          }
        }

        // 分配硬校验：plan 有确认分配时各部分页数必须精确匹配
        if (!isStructural) {
          const allocated = plan.allocation.find(a => a.sectionId === args.sectionId)
          if (allocated !== undefined && allocated.pages !== args.pages.length) {
            throw new Error(
              `部分 ${args.sectionId} 的页数 ${args.pages.length} 与确认的分配 ${allocated.pages} 页不一致；` +
                '调整该部分页数，或与用户重新确认分配后重调 ppt_pageplan_confirm',
            )
          }
        }

        // 替换该部分的页面，其余部分保留
        const kept = outline.pages.filter(p => p.sectionId !== args.sectionId)
        const incoming: OutlinePage[] = args.pages.map(page => outlinePageSchema.parse({
          ...page,
          id: 'pXXX',
          sectionId: args.sectionId,
          structure: page.structure ?? 'plain',
          density: page.density ?? 'medium',
          visual: page.visual ?? 'none',
        }))
        const merged: DeckOutline = { ...outline, pages: [...kept, ...incoming] }

        const contentCount = merged.pages.filter(p => p.sectionId !== 's0').length
        if (contentCount > plan.contentPages) {
          throw new Error(`内容页超出预算：已草拟 ${contentCount} 页 > 确认的 ${plan.contentPages} 页。请减少页数或与用户重新确认 ppt_pageplan_confirm`)
        }

        // 全册规范化重编号（封面→目录→各部分→结尾）+ 已写页迁移（0.8.0：
        // 重排后文件名/哈希键/已写清单必须对齐新编号，否则全部错位）。
        // 迁移先于大纲落盘：预检失败（文件缺失/目标占用）时磁盘不被半途修改（0.8.1 原子性）
        const ordered = canonicalOrder(merged)
        const renumbered: DeckOutline = { ...merged, pages: ordered }
        const migration = await migrateWrittenPages(store, args.deckId, state, outline, renumbered, args.sectionId)
        await store.saveJson(store.paths(args.deckId).outline, renumbered)

        // 同步重写所有已存在的部分蓝图快照，保持与 outline.json 的页 ID 一致
        const sectionsDir = store.paths(args.deckId).sectionsDir
        if (existsSync(sectionsDir)) {
          for (const file of (await readdir(sectionsDir)).filter(f => f.endsWith('.json'))) {
            const sid = file.replace(/\.json$/, '')
            const existing = await store.readJson<{ confirmedAt?: string }>(join(sectionsDir, file))
            const snapshot = sectionDraftSchema.parse({
              sectionId: sid,
              pages: renumbered.pages.filter(p => p.sectionId === sid),
              confirmedAt: existing?.confirmedAt ?? new Date().toISOString(),
            })
            await store.saveJson(join(sectionsDir, file), snapshot)
          }
        }
        // 本次部分单独落盘（带确认时间）
        await store.saveJson(join(sectionsDir, `${args.sectionId}.json`), sectionDraftSchema.parse({
          sectionId: args.sectionId,
          pages: renumbered.pages.filter(p => p.sectionId === args.sectionId),
          confirmedAt: new Date().toISOString(),
        }))

        const structuralDone = ['cover', 'toc', 'closing'].filter(t => renumbered.pages.some(p => p.sectionId === 's0' && p.type === t)).length
        const partsDone = outline.parts.filter(p => renumbered.pages.some(page => page.sectionId === p.id)).length
        const complete = structuralDone === 3 && partsDone === outline.parts.length && contentCount === plan.contentPages
        state.stage = complete ? 'drafted' : 'planned'
        await store.saveState(state)

        const logger = createDeckLogger(store.paths(args.deckId).root, args.deckId)
        logger.info('section', `部分 ${args.sectionId} 蓝图已生成`, {
          pages: renumbered.pages.filter(p => p.sectionId === args.sectionId).map(p => `${p.id}:${p.type}:${p.structure}`),
          contentPages: contentCount,
          contentTarget: plan.contentPages,
          ...(migration !== undefined ? { migration } : {}),
        })
        return {
          deckId: args.deckId,
          sectionId: args.sectionId,
          pages: renumbered.pages.filter(p => p.sectionId === args.sectionId),
          progress: { contentPages: contentCount, contentTarget: plan.contentPages, structuralDone, partsDone, partsTotal: outline.parts.length },
          ...(migration !== undefined ? { migration } : {}),
        }
      },
    },
  ]
}
