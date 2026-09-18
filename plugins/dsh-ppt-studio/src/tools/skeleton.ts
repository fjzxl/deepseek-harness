/**
 * ppt_page_skeleton —— 从蓝图一键生成合法骨架页（0.11.0）。
 *
 * 弱模型的第二条生成路径（与 content 内容模式互补）：不要求模型产出任何坐标，
 * 工具读蓝图页（type/title/keyMessage/contentBrief）用版式引擎生成占位场景——
 * schema 与全部确定性校验天然通过、立即可预览；模型随后用 ppt_page_write
 * {append:true}（同 id 原位替换）小步把占位文字换成正式内容。
 * 「先给一个必然合法的脚手架，再让模型做小编辑」替代「从零生成大 JSON」。
 *
 * 骨架是 deck 内的普通页面文件：sceneHash/预览/渲染/修改循环全部照常。
 */
import { z } from 'zod'
import { validatePage } from '../validate.js'
import { requireDeckState } from '../deck-store.js'
import { createDeckLogger } from '../logger.js'
import { composeSceneFromContent, splitSentences, type PageContentInput } from '../autolayout.js'
import type { OutlinePage, PageScene } from '../schema.js'
import type { ResolvedPptStudioConfig } from '../config.js'
import { asRecord, oneText, resolveToolContext, type ToolDefinition } from './registry.js'

/** 蓝图页 → 骨架内容（确定性：只做切分与截断，不做语义生成——那是模型的事）。 */
function skeletonContent(page: OutlinePage, sectionTitles: string[]): PageContentInput {
  const sentences = splitSentences(page.contentBrief, 5)
  const key = page.keyMessage ?? sentences[0] ?? page.title
  switch (page.type) {
    case 'cover':
      return { title: page.title, subtitle: page.keyMessage ?? '副标题（待补充）' }
    case 'toc':
      return { title: '目录', entries: sectionTitles.length >= 2 ? sectionTitles.slice(0, 8) : ['第一部分（待补充）', '第二部分（待补充）'] }
    case 'closing':
      return { title: '谢谢聆听', subtitle: page.keyMessage ?? '联系方式（待补充）' }
    case 'section':
      return { title: page.title, items: [page.keyMessage ?? sentences[0] ?? '本章导语（待补充）'] }
    case 'two-col':
    case 'comparison': {
      const half = Math.ceil(sentences.length / 2)
      const left = sentences.slice(0, half)
      const right = sentences.slice(half)
      return {
        title: page.title,
        columns: [
          { title: page.type === 'comparison' ? '现状' : '方面一', items: left.length > 0 ? left : [key] },
          { title: page.type === 'comparison' ? '方案' : '方面二', items: right.length > 0 ? right : ['（待补充）'] },
        ],
      }
    }
    case 'process':
      return {
        title: page.title,
        steps: (sentences.length >= 2 ? sentences : [key, '（待补充）']).slice(0, 5).map((s, i) => ({ name: `步骤 ${i + 1}`, desc: s })),
      }
    case 'timeline':
      return {
        title: page.title,
        events: (sentences.length >= 2 ? sentences : [key, '（待补充）']).slice(0, 6).map((s, i) => ({ label: `阶段 ${i + 1}`, desc: s })),
      }
    case 'cards':
      return {
        title: page.title,
        cards: (sentences.length >= 2 ? sentences : [key, '（待补充）']).slice(0, 4).map((s, i) => ({ title: s.slice(0, 14) || `要点 ${i + 1}`, desc: s })),
      }
    case 'hierarchy':
      return { title: page.title, layers: (sentences.length >= 2 ? sentences.slice(0, 4) : [key, '（待补充）']).map(s => s.slice(0, 12)) }
    case 'big-number':
      return { title: page.title, bigNumber: { value: '00', unit: '', desc: key, source: '数据待补充' } }
    case 'chart':
      return {
        title: page.title,
        chart: {
          chartType: 'column',
          labels: ['示例 A', '示例 B', '示例 C', '示例 D'],
          series: [{ name: '示意数据', values: [10, 20, 15, 25] }],
          conclusion: key,
        },
      }
    case 'table':
      return {
        title: page.title,
        table: {
          header: ['项目', '说明', '备注'],
          rows: (sentences.length >= 1 ? sentences.slice(0, 3) : [key]).map(s => [s.slice(0, 10), s.slice(0, 24), '待补充']),
          note: '示意表格（数据待补充）',
        },
      }
    case 'quote':
      return { title: page.title, quote: { text: key, source: '出处（待补充）' } }
    case 'image-text':
      return {
        title: page.title,
        image: { prompt: `建议配图：${page.contentBrief.slice(0, 60)}`, heading: key.slice(0, 40), items: sentences.slice(1, 4).length > 0 ? sentences.slice(1, 4) : [key] },
      }
    case 'icon-list':
    case 'bullets':
    default:
      return { title: page.title, items: sentences.length >= 2 ? sentences : [key, '（待补充要点）'] }
  }
}

export function createSkeletonTools(config: ResolvedPptStudioConfig): ToolDefinition[] {
  return [
    {
      name: 'ppt_page_skeleton',
      description:
        'PPT 写页辅助（0.11.0，弱模型友好）：按整册大纲的蓝图页（页型/标题/概要/核心信息）自动生成一页**通过全部校验的骨架页**（版式引擎排版，占位文字来自蓝图概要的确定性切分），立即落盘可预览。' +
        '随后用 ppt_page_write {"append":true,"scene":{"elements":[…]}} 同 id 原位替换把占位文字换成正式内容（小步编辑），或直接用 scene.content 内容模式整页重写。' +
        '适用：写页连续失败后的重建、想先看到页面框架再填内容。svg 路线 deck 不适用（SVG 需整页手写）。中文：按蓝图生成单页骨架占位场景。',
      parameters: {
        type: 'object',
        properties: {
          deckId: { type: 'string' },
          pageId: { type: 'string', description: '整册大纲中的页 ID，如 p003' },
        },
        required: ['deckId', 'pageId'],
      },
      output: {
        schema: { type: 'object', properties: { pageId: { type: 'string' }, ok: { type: 'boolean' } }, additionalProperties: true },
        render: (_args, value) => {
          const v = asRecord(value)
          const lines: string[] = []
          if (v.ok === true) {
            lines.push(`✅ 骨架页 ${String(v.pageId)} 已生成并保存（页型 ${String(v.type)}，${String(v.elementCount)} 个元素，错误 0，警告 ${String(v.warningCount)}）。`)
            lines.push('下一步二选一：① ppt_page_write {"append":true,"scene":{"elements":[{"kind":"text","id":"（要改的元素 id）",…}]}} 同 id 原位替换占位文字；② ppt_page_write {"scene":{"content":{…}}} 内容模式整页重写。')
          } else {
            lines.push(`❌ 骨架页 ${String(v.pageId)} 未生成：${String(v.error ?? '未知错误')}`)
          }
          return oneText(lines.join('\n'))
        },
      },
      execute: async (rawArgs, exec) => {
        exec?.signal?.throwIfAborted()
        const args = z.object({ deckId: z.string().min(1), pageId: z.string().min(1) }).parse(asRecord(rawArgs))
        const { store } = resolveToolContext(config, exec)
        const state = await requireDeckState(store, args.deckId)
        if (state.paused === true) {
          throw new Error('deck 已暂停生成（用户要求暂停）：写页类操作被拒绝。恢复生成调 ppt_deck_pause {"deckId":"…","paused":false}')
        }
        const outline = await store.loadOutline(args.deckId)
        if (outline === undefined) throw new Error('必须先完成整册大纲（蓝图页是骨架的内容来源）')
        const outlinePage = outline.pages.find(p => p.id === args.pageId)
        if (outlinePage === undefined) throw new Error(`页 ${args.pageId} 不在整册大纲中`)
        const tokens = await store.loadTokens(args.deckId)
        if (tokens === undefined) throw new Error('必须先 ppt_design_lock 锁定设计（骨架排版需要锁定令牌）')
        const brief = await store.loadBrief(args.deckId)
        const route = brief?.renderRoute ?? 'native'
        if (route === 'svg') {
          throw new Error('本 deck 是 svg 渲染路线：骨架工具只服务 native 路线（SVG 页需整页手写源码）。')
        }
        const spec = await store.loadSpec(args.deckId)
        const content = skeletonContent(outlinePage, outline.parts.map(p => p.title))
        const composed = composeSceneFromContent(content, {
          type: outlinePage.type,
          title: outlinePage.title,
          contentBrief: outlinePage.contentBrief,
          knownAssetIds: new Set((await store.loadManifest(args.deckId)).assets.map(a => a.assetId)),
        }, tokens)
        const page: PageScene = {
          id: args.pageId,
          sectionId: outlinePage.sectionId,
          type: outlinePage.type,
          title: outlinePage.title,
          ...(composed.background !== undefined ? { background: composed.background } : {}),
          elements: composed.elements,
          notes: `【骨架页】占位内容来自蓝图概要，请用 ppt_page_write append:true 或 content 模式替换为正式内容。蓝图要点：${outlinePage.keyMessage ?? outlinePage.contentBrief.slice(0, 120)}`,
        }
        const result = validatePage(page, {
          manifest: await store.loadManifest(args.deckId),
          tokens,
          visualPlan: outlinePage.visual,
          structure: outlinePage.structure,
          withVisualCharBudget: spec?.densityPolicy.withVisualCharBudget,
          bulletsMax: spec?.densityPolicy.bulletsMax,
          evidenceLevel: brief?.evidenceLevel,
          evidence: outlinePage.evidence,
          strictness: brief?.strictness,
          pageDensity: outlinePage.density,
          referenceMaterials: brief?.referenceMaterials,
          densityOverride: outlinePage.densityOverride,
        })
        const logger = createDeckLogger(store.paths(args.deckId).root, args.deckId)
        if (!result.ok) {
          // 引擎输出的核心不变量是「天然通过校验」——到达这里说明模板或令牌异常，如实上抛供排查
          logger.warn('page', `骨架页 ${args.pageId} 校验未通过（${result.errorCount} 错误）`, { issues: result.issues })
          return { pageId: args.pageId, ok: false, error: `版式引擎产物未通过校验（不应发生）：${result.issues.map(i => `${i.rule}:${i.message}`).join('；')}`, issues: result.issues }
        }
        const elements = page.elements!
        await store.savePage(args.deckId, page)
        const state2 = await store.loadState(args.deckId)
        if (state2 !== undefined) {
          if (!state2.pagesWritten.includes(page.id)) state2.pagesWritten.push(page.id)
          state2.stage = 'writing'
          state2.contentOutdated = true
          if (state2.renderedAt !== undefined) state2.renderOutdated = true
          await store.saveState(state2)
        }
        logger.info('page', `骨架页 ${args.pageId} 已生成（页型 ${page.type}，${elements.length} 个元素）`, { skeleton: true, warnings: result.warningCount })
        return {
          pageId: args.pageId,
          ok: true,
          skeleton: true,
          type: page.type,
          elementCount: elements.length,
          errorCount: 0,
          warningCount: result.warningCount,
          issues: result.issues,
          elementIds: elements.map(e => e.id),
          note: '占位文字来自蓝图概要切分；用 append:true 同 id 原位替换，或 content 内容模式整页重写',
        }
      },
    },
  ]
}
