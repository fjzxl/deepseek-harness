/**
 * ppt_deck_branch —— 草稿分支：快照复制当前 deck，试错互不影响。
 *
 * 场景："试试另一个叙事方向，不满意再回来"——架构确认后不可回退（推进保护），
 * 但可以快照当前进度开一个分支：新 deckId + 复制当前全部中间产物
 * （brief/outline/plan/sections/design/pages/assets），state 记 parentDeckId。
 * 源 deck 保持原样，两个分支后续互不影响；sceneHash/pageHashes 随内容原样复制仍然有效。
 * 不复制：logs/（历史留在源 deck）、report.json/deck.pptx/preview/（产物重渲染即得）。
 */
import { z } from 'zod'
import { cp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { requireDeckState } from '../deck-store.js'
import { createDeckLogger } from '../logger.js'
import type { ResolvedPptStudioConfig } from '../config.js'
import { asRecord, oneText, resolveToolContext, type ToolDefinition } from './registry.js'

export function createBranchTools(config: ResolvedPptStudioConfig): ToolDefinition[] {
  return [
    {
      name: 'ppt_deck_branch',
      description:
        '草稿分支：快照复制 deck 当前进度到新 deck（试另一个叙事方向/页数方案，不满意回源 deck 继续）。' +
        '复制全部中间产物（简报/架构/页数/蓝图/设计/已写页面/资产），state 记录 parentDeckId；' +
        '不复制日志与渲染产物（新分支重新渲染即得）。源 deck 完全不受影响。中文：复制 deck 建分支。',
      parameters: {
        type: 'object',
        properties: {
          deckId: { type: 'string', description: '源 deck' },
          title: { type: 'string', description: '可选：分支标题（缺省沿用源标题）' },
        },
        required: ['deckId'],
      },
      output: {
        schema: { type: 'object', properties: { deckId: { type: 'string' }, parentDeckId: { type: 'string' } }, additionalProperties: true },
        render: (_args, value) => {
          const v = asRecord(value)
          return oneText(
            `🌿 分支已创建：${String(v.deckId)}（复制自 ${String(v.parentDeckId)}，阶段 ${String(v.stage)}，带 ${String(v.pagesCopied)} 个已写页面）。` +
              '在新分支上继续调整；源 deck 不受影响，随时可用原 deckId 回去。',
          )
        },
      },
      execute: async (rawArgs, exec) => {
        exec?.signal?.throwIfAborted()
        const args = z.object({ deckId: z.string().min(1), title: z.string().min(1).max(120).optional() }).parse(asRecord(rawArgs))
        const { store } = resolveToolContext(config, exec)
        const source = await requireDeckState(store, args.deckId)
        const sourcePaths = store.paths(args.deckId)

        const created = await store.create(args.title ?? source.title)
        const targetPaths = created.paths
        // 复制中间产物（目录整拷 + 根级 JSON；排除 state/logs/report/pptx/preview——state 单独重建）
        for (const dir of [sourcePaths.sectionsDir, sourcePaths.pagesDir, sourcePaths.designDir, sourcePaths.assetsDir]) {
          if (existsSync(dir)) await cp(dir, join(targetPaths.root, dir.split(/[\\/]/).pop()!), { recursive: true })
        }
        for (const file of [sourcePaths.brief, sourcePaths.plan, sourcePaths.outline]) {
          if (existsSync(file)) await cp(file, join(targetPaths.root, file.split(/[\\/]/).pop()!), { force: false })
        }

        const branched: typeof source = {
          ...source,
          deckId: created.deckId,
          title: args.title ?? source.title,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          parentDeckId: args.deckId,
          paused: undefined,
        }
        await store.saveJson(targetPaths.state, branched)

        const pagesCopied = existsSync(sourcePaths.pagesDir) ? branched.pagesWritten.length : 0
        for (const deckId of [args.deckId, created.deckId]) {
          const logger = createDeckLogger(store.paths(deckId).root, deckId)
          logger.info('branch', deckId === args.deckId ? `已分支出 ${created.deckId}（快照复制）` : `分支自 ${args.deckId}`, { parentDeckId: args.deckId, branchDeckId: created.deckId, stage: branched.stage })
        }
        return { deckId: created.deckId, parentDeckId: args.deckId, stage: branched.stage, pagesCopied }
      },
    },
  ]
}
