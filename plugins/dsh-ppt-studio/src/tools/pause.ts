/**
 * ppt_deck_pause —— 阶段 5 的生成暂停/恢复（进度可视化的配套控制）。
 *
 * 用户在"边生成边看"时喊停：模型调本工具设置 state.paused=true，
 * 此后 ppt_page_write 拒绝写入（提示如何恢复）；用户想继续时恢复。
 * 查看类操作（preview/status/log）不受暂停影响。
 */
import { z } from 'zod'
import { requireDeckState } from '../deck-store.js'
import { createDeckLogger } from '../logger.js'
import type { ResolvedPptStudioConfig } from '../config.js'
import { asRecord, oneText, resolveToolContext, type ToolDefinition } from './registry.js'

export function createPauseTools(config: ResolvedPptStudioConfig): ToolDefinition[] {
  return [
    {
      name: 'ppt_deck_pause',
      description:
        '暂停/恢复 deck 生成（阶段 5 边生成边看时用户喊停用）。paused=true 后 ppt_page_write 拒绝写入并提示恢复方式；' +
        '查看类操作（ppt_preview_update / ppt_deck_status / ppt_log_query）不受影响。中文：暂停或恢复 PPT 生成。',
      parameters: {
        type: 'object',
        properties: {
          deckId: { type: 'string' },
          paused: { type: 'boolean', description: 'true=暂停（拒绝写页）；false=恢复生成' },
        },
        required: ['deckId', 'paused'],
      },
      output: {
        schema: { type: 'object', properties: { deckId: { type: 'string' }, paused: { type: 'boolean' } }, additionalProperties: true },
        render: (_args, value) => {
          const v = asRecord(value)
          return oneText(
            v.paused === true
              ? `⏸️ deck ${String(v.deckId)} 已暂停生成（已写 ${String(v.pagesWrittenCount)} 页）：写页将被拒绝。等用户说继续后调 ppt_deck_pause {"deckId":"…","paused":false} 恢复。`
              : `▶️ deck ${String(v.deckId)} 已恢复生成，可以继续 ppt_page_write。`,
          )
        },
      },
      execute: async (rawArgs, exec) => {
        exec?.signal?.throwIfAborted()
        const args = z.object({ deckId: z.string().min(1), paused: z.boolean() }).parse(asRecord(rawArgs))
        const { store } = resolveToolContext(config, exec)
        const state = await requireDeckState(store, args.deckId)
        state.paused = args.paused
        await store.saveState(state)
        const logger = createDeckLogger(store.paths(args.deckId).root, args.deckId)
        logger.info('pause', args.paused ? '生成已暂停' : '生成已恢复')
        return { deckId: args.deckId, paused: state.paused, stage: state.stage, pagesWrittenCount: state.pagesWritten.length }
      },
    },
  ]
}
