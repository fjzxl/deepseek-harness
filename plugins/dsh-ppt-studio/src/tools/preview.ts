/**
 * ppt_preview_update —— 阶段 5/8 的即时预览：用已写页面刷新 HTML 预览。
 *
 * 与 ppt_deck_render 的区别：只重绘自包含预览播放器（毫秒级）、不生成 PPTX、
 * 不要求 sceneHash 最新——它是"边生成边看"的观察窗口，不是终检。
 * 逐部分生成时每完成一个部分调一次；修改循环里改完页也可先预览再全册校验渲染。
 */
import { z } from 'zod'
import { renderDeckHtml } from '../render-html.js'
import type { DeckProgress } from '../render-html.js'
import { requireDeckState } from '../deck-store.js'
import { createDeckLogger } from '../logger.js'
import { openPreviewOncePerDeck } from '../open-browser.js'
import type { ResolvedPptStudioConfig } from '../config.js'
import { asRecord, oneText, resolveToolContext, type ToolDefinition } from './registry.js'

export function createPreviewTools(config: ResolvedPptStudioConfig): ToolDefinition[] {
  return [
    {
      name: 'ppt_preview_update',
      description:
        '即时预览：把目前已写入的页面刷新到自包含 HTML 预览播放器（不生成 PPTX、不要求全册校验通过）。' +
        '逐部分生成时每完成一个部分调一次，用户可在浏览器实时看到进度并随时提出修改（局部修改走改页流程，不阻塞其余部分生成）；' +
        '修改循环中改完页也可先调本工具快速过目，再 ppt_scene_check + ppt_deck_render 出正式产物。' +
        '前置条件：设计已锁定（预览使用锁定令牌）。中文：刷新即时预览。',
      parameters: {
        type: 'object',
        properties: { deckId: { type: 'string' } },
        required: ['deckId'],
      },
      output: {
        schema: { type: 'object', properties: { deckId: { type: 'string' }, previewUrl: { type: 'string' } }, additionalProperties: true },
        render: (_args, value) => {
          const v = asRecord(value)
          const lines = [`👁️ 即时预览已更新（${String(v.pageCount)}/${String(v.total)} 页）：${String(v.previewUrl)}`]
          if (v.progressText !== undefined && String(v.progressText) !== '') lines.push(`进度：${String(v.progressText)}`)
          if (v.autoOpened === true) lines.push('已自动打开浏览器（本 deck 只自动打开这一次；完全关闭设 PPT_STUDIO_PREVIEW_AUTO_OPEN=0）。')
          lines.push('请让用户在浏览器打开/刷新查看（生成中顶部有进度条）；继续生成其余部分，或按用户反馈改页后再刷新。')
          return oneText(lines.join('\n'))
        },
      },
      execute: async (rawArgs, exec) => {
        exec?.signal?.throwIfAborted()
        const args = z.object({ deckId: z.string().min(1) }).parse(asRecord(rawArgs))
        const { store, config: resolved } = resolveToolContext(config, exec)
        const state = await requireDeckState(store, args.deckId)
        const outline = await store.loadOutline(args.deckId)
        const tokens = await store.loadTokens(args.deckId)
        if (outline === undefined || tokens === undefined) throw new Error('大纲或设计令牌缺失：需先完成阶段 0–4（含 ppt_design_lock）')

        const pages = (await store.loadPages(args.deckId))
          .filter(p => outline.pages.some(o => o.id === p.id))
          .sort((a, b) => a.id.localeCompare(b.id))
        if (pages.length === 0) throw new Error('还没有已写入的页面：先 ppt_page_write 至少一页再预览')

        // 生成进度（总进度 + 各部分进度），播放器顶部进度条展示
        const written = new Set(pages.map(p => p.id))
        const progress: DeckProgress = {
          written: pages.length,
          total: outline.pages.length,
          parts: outline.parts.map(part => {
            const partPages = outline.pages.filter(p => p.sectionId === part.id)
            return { title: part.title, pages: partPages.length, written: partPages.filter(p => written.has(p.id)).length }
          }),
        }

        const logger = createDeckLogger(store.paths(args.deckId).root, args.deckId)
        const theme = { colors: tokens.colors, chartColors: tokens.chartColors, fonts: tokens.fonts }
        const htmlResult = await logger.timed('preview', '即时预览刷新', () =>
          renderDeckHtml({ store, deckId: args.deckId, deckTitle: state.title, theme, pages, progress }),
        )
        const previewUrl = `${resolved.previewBaseUrl.replace(/\/+$/, '')}/ppt-studio/${args.deckId}/preview/`
        // 自动打开浏览器：默认每 deck 只弹第一次（生成期间反复刷新预览不再重复弹窗）
        const autoOpened = await openPreviewOncePerDeck(store, args.deckId, previewUrl, resolved.previewAutoOpen)
        const progressText = progress.parts
          .filter(part => part.pages > 0)
          .map(part => `${part.title} ${part.written}/${part.pages}`)
          .join('，')
        return { deckId: args.deckId, previewUrl, pageCount: pages.length, total: progress.total, progressText, htmlBytes: htmlResult.bytes, autoOpened }
      },
    },
  ]
}
