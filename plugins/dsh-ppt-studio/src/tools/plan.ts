/**
 * ppt_pageplan_confirm —— 第 c 步：确认页数与各部分分配。
 *
 * 用户确认的是内容页数；封面/目录/结尾 3 页由工具自动附加。
 * allocation 为用户确认的各部分页数分配（Σ必须等于 contentPages 且覆盖全部部分）；
 * 未提供时工具按 suggestedPages 加权生成建议分配（不落盘），展示给用户调整后重新调用确认。
 */
import { z } from 'zod'
import type { DeckPlan } from '../schema.js'
import { deckPlanSchema } from '../schema.js'
import { createDeckLogger } from '../logger.js'
import { requireDeckState } from '../deck-store.js'
import type { ResolvedPptStudioConfig } from '../config.js'
import { asRecord, oneText, resolveToolContext, type ToolDefinition } from './registry.js'

const STRUCTURAL_PAGES = 3 // 封面 / 目录 / 结尾，自动附加

const allocationSchema = z.array(
  z.object({
    sectionId: z.string().regex(/^s\d{1,2}$/),
    pages: z.number().int().min(1),
    reason: z.string().max(120).optional(),
  }),
)

/** 按 suggestedPages 加权把 contentPages 分配到各部分（每部分至少 1 页，余数给建议页数最多的部分）。 */
function suggestAllocation(partIds: string[], suggested: Map<string, number | undefined>, contentPages: number): Array<{ sectionId: string; pages: number }> {
  const weights = partIds.map(id => suggested.get(id) ?? 1)
  const total = weights.reduce((a, b) => a + b, 0)
  const raw = weights.map(w => (contentPages * w) / total)
  const pages = raw.map(Math.floor)
  let remainder = contentPages - pages.reduce((a, b) => a + b, 0)
  const order = partIds
    .map((id, i) => ({ id, deficit: raw[i] - pages[i] }))
    .sort((a, b) => b.deficit - a.deficit)
  for (const item of order) {
    if (remainder <= 0) break
    pages[partIds.indexOf(item.id)] += 1
    remainder -= 1
  }
  // 兜底：仍不足（部分数 > contentPages 已在上游拒绝）则全部给最后一部分
  if (remainder > 0) pages[pages.length - 1] += remainder
  return partIds.map((id, i) => ({ sectionId: id, pages: pages[i] }))
}

/**
 * 页数档位推荐：由简报时长推导（约 1.7 分钟/内容页），生成 紧凑/推荐/舒展 三档。
 * 用户先选档位再谈微调，认知负担比"你要多少页"更低。
 */
export function suggestPageCounts(
  durationMin: number | undefined,
): Array<{ contentPages: number; label: string; minutesPerPage: string }> {
  const base = durationMin !== undefined
    ? Math.min(26, Math.max(8, Math.round(durationMin / 1.7)))
    : 12
  const unique = [...new Set([base - 4, base, base + 4].map(n => Math.min(30, Math.max(6, n))))].sort((a, b) => a - b)
  return unique.map(n => ({
    contentPages: n,
    label: n === base ? '推荐' : n < base ? '紧凑' : '舒展',
    minutesPerPage: durationMin !== undefined ? `约 ${(durationMin / n).toFixed(1)} 分钟/页` : '—',
  }))
}

export function createPlanTools(config: ResolvedPptStudioConfig): ToolDefinition[] {
  return [
    {
      name: 'ppt_pageplan_confirm',
      description:
        'PPT 制作第 c 步（叙事架构经用户确认后）：记录用户确认的内容页数与各部分页数分配。' +
        '封面、目录、结尾 3 页自动附加，不占内容页数；工具会返回最终总页数 = 内容页数 + 3。' +
        'contentPages 不得少于架构的部分数（每部分至少 1 页）。' +
        'allocation（可选）为各部分页数分配：Σ必须等于 contentPages 且覆盖全部部分；未提供时工具返回建议分配（按各部分 suggestedPages 加权）与页数档位建议（按时长推导 紧凑/推荐/舒展 三档），展示给用户调整后带 allocation 重新调用确认。' +
        '中文：确认 PPT 内容页数与各部分分配。',
      parameters: {
        type: 'object',
        properties: {
          deckId: { type: 'string', description: 'ppt_brief_create 返回的 deckId' },
          contentPages: { type: 'integer', description: '内容页数 2-60（不含封面/目录/结尾，由用户确认）' },
          allocation: {
            type: 'array',
            description: '各部分页数分配（用户确认后传入）：[{sectionId, pages, reason?}]，Σ=contentPages；reason 为分配理由（如"历史概览 4 个关键节点"），展示给用户便于接受或调整',
            items: {
              type: 'object',
              properties: { sectionId: { type: 'string', description: '部分 id，如 s1' }, pages: { type: 'integer', description: '该部分页数' }, reason: { type: 'string', description: '分配理由（一句话）' } },
              required: ['sectionId', 'pages'],
            },
          },
        },
        required: ['deckId', 'contentPages'],
      },
      output: {
        schema: { type: 'object', properties: { deckId: { type: 'string' }, plan: { type: 'object' } }, additionalProperties: true },
        render: (_args, value) => {
          const v = asRecord(value)
          const plan = asRecord(v.plan)
          const lines = [`✅ 页数已确认：内容页 ${String(plan.contentPages)} 页 + 封面/目录/结尾 3 页 = 最终 ${String(plan.totalPages)} 页。`]
          const allocation = Array.isArray(plan.allocation) ? plan.allocation : []
          if (allocation.length > 0) {
            lines.push('分配：' + allocation.map((raw) => {
              const entry = asRecord(raw)
              return `${String(entry.sectionId)}=${String(entry.pages)} 页${entry.reason !== undefined ? `（${String(entry.reason)}）` : ''}`
            }).join('，'))
          }
          const suggested = Array.isArray(v.suggestedAllocation) ? v.suggestedAllocation : []
          if (suggested.length > 0) {
            lines.push('建议分配（未确认，请用户调整后带 allocation 重新调用）：' + suggested.map((raw) => {
              const entry = asRecord(raw)
              return `${String(entry.sectionId)}=${String(entry.pages)} 页`
            }).join('，'))
          }
          const counts = Array.isArray(v.suggestedCounts) ? v.suggestedCounts : []
          if (counts.length > 0) {
            lines.push('页数档位（时长驱动，供用户横向对比）：' + counts.map((raw) => {
              const entry = asRecord(raw)
              return `${String(entry.contentPages)} 页（${String(entry.label)}，${String(entry.minutesPerPage)}）`
            }).join(' / '))
          }
          lines.push('下一步：逐部分调 ppt_section_draft 生成 Page Blueprint（每页 purpose/keyMessage/structure/density/visual），全部完成后展示给用户确认。')
          return oneText(lines.join('\n'))
        },
      },
      execute: async (rawArgs, exec) => {
        exec?.signal?.throwIfAborted()
        const args = z
          .object({
            deckId: z.string().min(1),
            contentPages: z.number().int().min(2).max(60),
            allocation: allocationSchema.optional(),
          })
          .parse(asRecord(rawArgs))
        const { store } = resolveToolContext(config, exec)
        const state = await requireDeckState(store, args.deckId)
        const outline = await store.loadOutline(args.deckId)
        if (outline === undefined) throw new Error('必须先 ppt_outline_draft 完成叙事架构（且经用户确认）')
        if (args.contentPages < outline.parts.length) {
          throw new Error(`内容页数 ${args.contentPages} 少于架构部分数 ${outline.parts.length}（每部分至少 1 页）`)
        }

        const partIds = outline.parts.map(p => p.id)
        let allocation: Array<{ sectionId: string; pages: number }> = []
        let suggestedAllocation: Array<{ sectionId: string; pages: number }> | undefined
        if (args.allocation !== undefined) {
          const provided = args.allocation
          const given = new Map(provided.map(a => [a.sectionId, a.pages]))
          for (const id of partIds) {
            if (!given.has(id)) throw new Error(`分配缺少部分 ${id}（必须覆盖全部部分：${partIds.join(' / ')}）`)
          }
          for (const id of given.keys()) {
            if (!partIds.includes(id)) throw new Error(`分配含未知部分 ${id}（可用：${partIds.join(' / ')}）`)
          }
          const sum = provided.reduce((acc, a) => acc + a.pages, 0)
          if (sum !== args.contentPages) {
            throw new Error(`分配总和 ${sum} 与内容页数 ${args.contentPages} 不一致（请先与用户对齐再传入）`)
          }
          allocation = partIds.map(id => provided.find(a => a.sectionId === id)!)
        } else {
          // 未确认分配：按 suggestedPages 加权生成建议（不落盘，等用户调整后重新调用）
          const suggested = new Map(outline.parts.map(p => [p.id, p.suggestedPages]))
          suggestedAllocation = suggestAllocation(partIds, suggested, args.contentPages)
        }

        // 页数档位建议：时长驱动（紧凑/推荐/舒展三档），供用户横向对比微调
        const brief = await store.loadBrief(args.deckId)
        const suggestedCounts = suggestPageCounts(brief?.durationMin)

        const plan: DeckPlan = deckPlanSchema.parse({
          contentPages: args.contentPages,
          structuralPages: STRUCTURAL_PAGES,
          totalPages: args.contentPages + STRUCTURAL_PAGES,
          allocation,
          confirmedAt: new Date().toISOString(),
        })
        await store.saveJson(store.paths(args.deckId).plan, plan)
        state.stage = 'planned'
        await store.saveState(state)
        const logger = createDeckLogger(store.paths(args.deckId).root, args.deckId)
        logger.info('plan', '页数已确认', { contentPages: plan.contentPages, totalPages: plan.totalPages, allocationConfirmed: allocation.length > 0 })
        return { deckId: args.deckId, plan, suggestedCounts, ...(suggestedAllocation !== undefined ? { suggestedAllocation } : {}) }
      },
    },
  ]
}
