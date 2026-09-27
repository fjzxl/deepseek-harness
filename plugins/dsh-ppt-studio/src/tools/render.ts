/**
 * ppt_deck_render —— 渲染整册：场景 → PPTX + HTML 预览 + report.json。
 */
import { z } from 'zod'
import { renderDeckPptx } from '../render-pptx.js'
import { renderDeckHtml } from '../render-html.js'
import { auditDeckPages, type DeckVisualAuditResult } from '../visual-audit.js'
import { computeSceneHash, requireDeckState } from '../deck-store.js'
import { describePptxModule } from '../diag.js'
import { openPreviewOncePerDeck } from '../open-browser.js'
import { PLUGIN_VERSION } from '../version.js'
import { createDeckLogger, writeDeckReport, type DeckReport } from '../logger.js'
import { validateDeckPages } from '../validate.js'
import type { ResolvedPptStudioConfig } from '../config.js'
import { asRecord, oneText, resolveToolContext, type ToolDefinition } from './registry.js'

export function createRenderTools(config: ResolvedPptStudioConfig): ToolDefinition[] {
  return [
    {
      name: 'ppt_deck_render',
      description:
        '渲染整册：同一份场景同时产出可编辑 deck.pptx（pptxgenjs，原生文本/形状/表格/图表）与自包含 HTML 预览播放器（所见即所得），' +
        '并写 report.json 汇总报告。前置条件：ppt_scene_check 通过且 sceneHash 为最新（内容有变会拒绝渲染）。' +
        '返回 PPTX 路径、预览 URL（需预览服务运行：本地 node lib/preview-server.js）。中文：渲染 PPTX 与预览。',
      parameters: {
        type: 'object',
        properties: { deckId: { type: 'string' } },
        required: ['deckId'],
      },
      output: {
        schema: { type: 'object', properties: { deckId: { type: 'string' }, pptxPath: { type: 'string' }, previewUrl: { type: 'string' } }, additionalProperties: true },
        render: (_args, value) => {
          const v = asRecord(value)
          const lines = [
            `🎬 渲染完成（${String(v.pageCount)} 页）：`,
            `PPTX（可编辑）：${String(v.pptxPath)}`,
            `预览（所见即所得）：${String(v.previewUrl)}`,
            `报告：${String(v.reportPath)}`,
          ]
          const notes = Array.isArray(v.renderNotes) ? v.renderNotes : []
          if (notes.length > 0) lines.push(`渲染取舍：${notes.join('；')}`)
          if (v.warningCount !== undefined && Number(v.warningCount) > 0) lines.push(`注意：仍有 ${String(v.warningCount)} 条 warning 级版式提醒（详见 report.json）。`)
          const audit = asRecord(v.visualAudit)
          if (audit !== undefined) {
            const auditIssues = Array.isArray(audit.issues) ? audit.issues.map(asRecord) : []
            const audited = Array.isArray(audit.pagesAudited) ? audit.pagesAudited.length : 0
            const note = typeof audit.note === 'string' ? audit.note : undefined
            if (auditIssues.length > 0) {
              lines.push(`像素自审（headless 截图 ${audited} 页，warning 级、不拦渲染）：`)
              for (const issue of auditIssues.slice(0, 12)) {
                lines.push(`  [${String(issue.pageId)}] ${String(issue.message)}（截图：preview/audit/${String(issue.pageId)}.png，预览 URL 拼该相对路径可看）`)
              }
              lines.push('以上是像素层提醒，与结构校验相互独立——建议逐条看截图确认；确需修的页改完后重新 ppt_scene_check + ppt_deck_render。')
            } else if (note !== undefined) {
              lines.push(`像素自审跳过：${note}`)
            } else {
              lines.push(`像素自审：${audited} 页截图分析通过（无失衡/空白提醒），截图在 preview/audit/ 下可肉眼复核。`)
            }
          }
          if (v.autoOpened === true) lines.push('已自动打开浏览器预览（本 deck 只自动打开这一次；完全关闭设 PPT_STUDIO_PREVIEW_AUTO_OPEN=0，每次都打开设 =always）。')
          lines.push('请把预览链接给用户查看；用户提出修改时改完页面后重新 ppt_scene_check + ppt_deck_render。')
          lines.push('（QA 边界：本流程已验证场景数据、文件结构与校验规则；办公软件实际渲染效果（字体回退/换行/图表标签）请以 HTML 预览与打开 PPTX 的肉眼复核为准。）')
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
        const spec = await store.loadSpec(args.deckId)
        if (outline === undefined || tokens === undefined) throw new Error('大纲或设计令牌缺失（需完成 d/e-1 步），无法渲染')
        const pages = (await store.loadPages(args.deckId))
          .filter(p => outline.pages.some(o => o.id === p.id))
          .sort((a, b) => a.id.localeCompare(b.id))
        if (pages.length !== outline.pages.length) {
          throw new Error(`页面不全：大纲 ${outline.pages.length} 页，已写入 ${pages.length} 页`)
        }

        // 指纹闸门：渲染的必须是最近一次校验通过的场景
        const currentHash = await computeSceneHash(tokens, outline, pages)
        if (state.sceneHash !== currentHash) {
          throw new Error('场景内容与最近一次 ppt_scene_check 不一致（sceneHash 过期），请先重新 ppt_scene_check')
        }
        const manifest = await store.loadManifest(args.deckId)
        const brief = await store.loadBrief(args.deckId)
        // 渲染前复检与 ppt_scene_check 同路（0.9.1 对称性修复：此前漏传 strictness/evidenceLevel/
        // referenceMaterials/parts——闸门强度应与正式校验一致，不因最后一道复检放松）
        const validation = validateDeckPages(pages, {
          manifest,
          tokens,
          outlinePages: outline.pages,
          parts: outline.parts,
          evidenceLevel: brief?.evidenceLevel,
          strictness: brief?.strictness,
          referenceMaterials: brief?.referenceMaterials,
          withVisualCharBudget: spec?.densityPolicy.withVisualCharBudget,
          bulletsMax: spec?.densityPolicy.bulletsMax,
        })
        if (!validation.ok) {
          throw new Error(`存在 ${validation.errorCount} 个 error 级问题，渲染拒绝：${validation.issues.filter(i => i.level === 'error').slice(0, 5).map(i => i.message).join('；')}`)
        }

        const logger = createDeckLogger(store.paths(args.deckId).root, args.deckId)
        // 渲染主题 = 锁定令牌（不再运行时解析主题/覆盖色板，所见即锁定；texture 为 0.18.0 背景纹理；
        // structuralGradient 为 0.19.0 结构页渐变端点，旧 deck 缺省时渲染器回退 primary→secondary 派生）
        const theme = {
          colors: tokens.colors,
          chartColors: tokens.chartColors,
          fonts: tokens.fonts,
          ...(tokens.texture !== undefined ? { texture: tokens.texture } : {}),
          ...(tokens.structuralGradient !== undefined ? { structuralGradient: tokens.structuralGradient } : {}),
        }
        const started = Date.now()
        // 渲染前诊断：模块解析路径 + 互操作形态（"PptxGenJS is not a constructor" 类故障的一手证据）
        logger.info('render', '渲染环境诊断', {
          pptx: describePptxModule(),
          node: process.version,
          pluginVersion: PLUGIN_VERSION,
        })
        const pptxResult = await logger.timed('render', '渲染 PPTX', () =>
          renderDeckPptx({ store, deckId: args.deckId, deckTitle: state.title, theme, pages }),
        )
        const htmlResult = await logger.timed('render', '渲染 HTML 预览', () =>
          renderDeckHtml({ store, deckId: args.deckId, deckTitle: state.title, theme, pages }),
        )
        // 视觉自审（0.22.0 T3-4）：逐页 headless 截图 + 像素启发式，warning 级提醒——
        // 不进校验闸门、不影响产物；浏览器缺失/失败静默降级。PPT_STUDIO_VISUAL_AUDIT=0 可关。
        const visualAudit: DeckVisualAuditResult =
          process.env.PPT_STUDIO_VISUAL_AUDIT === '0'
            ? { browser: '(已关闭)', pagesAudited: [], skippedPages: pages.map(p => p.id), issues: [], reports: [], durationMs: 0, note: '像素自审已通过 PPT_STUDIO_VISUAL_AUDIT=0 关闭' }
            : await logger.timed('render', '视觉自审（headless 截图）', () =>
              auditDeckPages({ store, deckId: args.deckId, theme, pages }),
            )
        const durationMs = Date.now() - started
        const previewUrl = `${resolved.previewBaseUrl.replace(/\/+$/, '')}/ppt-studio/${args.deckId}/preview/`

        const report: DeckReport = {
          deckId: args.deckId,
          title: state.title,
          generatedAt: new Date().toISOString(),
          themeId: tokens.themeId,
          pageCount: pages.length,
          validation: { ok: validation.ok, errorCount: validation.errorCount, warningCount: validation.warningCount, issues: validation.issues },
          render: {
            pptxPath: pptxResult.pptxPath,
            previewPath: htmlResult.htmlPath,
            durationMs,
            pptxBytes: pptxResult.bytes,
            notes: pptxResult.notes,
          },
          pages: pages.map(p => {
            const result = validation.pageResults.find(r => r.pageId === p.id)
            return { pageId: p.id, type: p.type, title: p.title, errors: result?.errorCount ?? 0, warnings: result?.warningCount ?? 0 }
          }),
          visualAudit: {
            browser: visualAudit.browser,
            pagesAudited: visualAudit.pagesAudited,
            skippedPages: visualAudit.skippedPages,
            issues: visualAudit.issues,
            ...(visualAudit.note !== undefined ? { note: visualAudit.note } : {}),
          },
        }
        const reportPath = await writeDeckReport(store.paths(args.deckId).root, report)

        state.stage = 'rendered'
        state.renderedAt = report.generatedAt
        state.renderOutdated = false // 产物已与最新校验对齐
        await store.saveState(state)
        // 自动打开浏览器：默认每 deck 只弹第一次（previewOpenedAt 标记在 helper 内落盘，
        // 必须放在上面的 saveState 之后，否则旧 state 会覆盖标记）
        const autoOpened = await openPreviewOncePerDeck(store, args.deckId, previewUrl, resolved.previewAutoOpen, 'render')
        logger.info('render', '整册渲染完成', { pptxBytes: pptxResult.bytes, htmlBytes: htmlResult.bytes, durationMs, autoOpened, visualAuditIssues: visualAudit.issues.length, visualAuditedPages: visualAudit.pagesAudited.length })

        return {
          deckId: args.deckId,
          pageCount: pages.length,
          pptxPath: pptxResult.pptxPath,
          previewPath: htmlResult.htmlPath,
          previewUrl,
          autoOpened,
          reportPath,
          warningCount: validation.warningCount,
          renderNotes: pptxResult.notes,
          visualAudit: {
            browser: visualAudit.browser,
            pagesAudited: visualAudit.pagesAudited,
            skippedPages: visualAudit.skippedPages,
            issues: visualAudit.issues,
            ...(visualAudit.note !== undefined ? { note: visualAudit.note } : {}),
          },
        }
      },
    },
  ]
}
