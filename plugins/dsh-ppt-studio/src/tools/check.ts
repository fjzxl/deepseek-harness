/**
 * ppt_scene_check —— 全册确定性校验 + 校验指纹（依赖感知增量标注）。
 *
 * 校验口径（0.9.1 澄清）：**全量校验、增量标注**——每次调用对全部页执行全部规则
 * （毫秒级，无缓存，规则演进/strictness 变化即时生效）；revalidated/unchangedCount
 * 只是"哪些页内容变了"的展示信号，帮修改循环聚焦，不是"未变页免检"。
 * sceneHash 校验指纹（含插件版本盐）是渲染闸门；pageHashes 是页级内容指纹。
 */
import { z } from 'zod'
import type { ValidationIssue } from '../schema.js'
import { countTextUnits, pageTextUnits, validateDeckPages } from '../validate.js'
import { computePageHash, computeSceneHash, requireDeckState } from '../deck-store.js'
import { createDeckLogger } from '../logger.js'
import type { ResolvedPptStudioConfig } from '../config.js'
import { asRecord, oneText, resolveToolContext, type ToolDefinition } from './registry.js'

/**
 * 讲述时长估算：每页贡献 =（页面文字 + 演讲者备注 ÷ 语速 + 0.3 分钟翻页/停顿）× 页型系数。
 * 备注是照着讲的底稿，0.9.1 起计入（此前只算页面文字会低估写了详细备注的 deck）。
 * 语速取 220 全角字/分钟（CJK 演讲常见 180–240 的中位；课堂停顿多的场景由
 * DECK_DURATION_MISMATCH 的 info 提示兜底，不做配置项——0.9.0 评审结论）。
 * 页型系数（0.8.0）：数据页（chart/table）讲解更久 ×1.3；结构页（封面/目录/章节/结尾）一带而过 ×0.5。
 */
const SPEAKING_CHARS_PER_MIN = 220
const SPEAKING_FACTOR: Record<string, number> = { chart: 1.3, table: 1.3, cover: 0.5, toc: 0.5, section: 0.5, closing: 0.5 }

function estimateSpeakingMinutes(pages: Parameters<typeof pageTextUnits>[0][]): number {
  const total = pages.reduce((sum, page) => {
    const factor = SPEAKING_FACTOR[page.type] ?? 1
    const spokenUnits = pageTextUnits(page) + (page.notes !== undefined ? countTextUnits(page.notes) : 0)
    return sum + (spokenUnits / SPEAKING_CHARS_PER_MIN + 0.3) * factor
  }, 0)
  return Math.round(total * 10) / 10
}

/** 大纲指纹（关系型变更检测）：覆盖 parts + pages（含 transition/页序），不含页面内容。 */
async function computeOutlineHash(outline: NonNullable<Awaited<ReturnType<import('../deck-store.js').DeckStore['loadOutline']>>>): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(JSON.stringify({ parts: outline.parts, pages: outline.pages })).digest('hex').slice(0, 16)
}

export function createCheckTools(config: ResolvedPptStudioConfig): ToolDefinition[] {
  return [
    {
      name: 'ppt_scene_check',
      description:
        '全册校验：所有大纲页面是否已写入、每页确定性校验（越界/重叠/文字容量/图片登记/图表数据/锁定令牌/信息密度/结构匹配/证据来源/要点预算），' +
        '跨页集成检查（版式单调/页型多样性/视觉节奏/叙事链完整/标题即结论），并产出 sceneHash 校验指纹——ppt_deck_render 只渲染最新指纹对应的场景。' +
        '依赖感知：与上次校验比对页级指纹，返回 revalidated（本次变更/新增的页）与 unchangedCount——修改循环中只有变更页需要细看。' +
        '另返回 storyline 叙事链摘要（逐页标题/keyMessage/承接语，供自审连贯性）、duration 时长估算（vs 简报时长）与 outlineChanged（大纲关系型变更信号：改过 transition/页序后提示重读全量叙事链）。' +
        '中文：全册场景校验，返回校验指纹、变更页清单、叙事链摘要与时长估算。',
      parameters: {
        type: 'object',
        properties: { deckId: { type: 'string' } },
        required: ['deckId'],
      },
      output: {
        schema: { type: 'object', properties: { deckId: { type: 'string' }, ok: { type: 'boolean' }, sceneHash: { type: 'string' } }, additionalProperties: true },
        render: (_args, value) => {
          const v = asRecord(value)
          const lines: string[] = []
          const revalidated = Array.isArray(v.revalidated) ? v.revalidated.map(String) : []
          const unchanged = Number(v.unchangedCount ?? 0)
          lines.push(
            v.ok === true
              ? `✅ 全册校验通过（sceneHash ${String(v.sceneHash)}），可调 ppt_deck_render 渲染。`
              : `❌ 全册校验未通过（${String(v.errorCount)} 个错误）：`,
          )
          if (revalidated.length > 0) lines.push(`本次变更页（重点细看）：${revalidated.join('、')}`)
          if (unchanged > 0) lines.push(`${unchanged} 页内容未变（校验仍全量执行，此处只是聚焦提示）。`)
          const duration = asRecord(v.duration)
          if (duration.estimatedMin !== undefined) {
            lines.push(`时长估算：约 ${String(duration.estimatedMin)} 分钟（简报目标 ${String(duration.targetMin)} 分钟）。`)
          }
          const issues = Array.isArray(v.issues) ? v.issues : []
          for (const raw of issues.slice(0, 40)) {
            const issue = asRecord(raw)
            lines.push(`  [${String(issue.level)}] ${String(issue.rule)}：${String(issue.message)}`)
          }
          if (v.outlineChanged === true) {
            lines.push('⚠️ 大纲有变更（页序/叙事衔接/蓝图）：transition 是页间关系，页级指纹覆盖不到——请重读上方全量 storyline 自审邻接页衔接，不要只看 revalidated 变更页。')
          }
          const gaps = Array.isArray(v.storylineGaps) ? v.storylineGaps.map(String) : []
          if (gaps.length > 0) {
            lines.push(`⚠️ 疑似叙事断裂（缺承接语）：${gaps.join('、')}——叙事要求高的场景（strictness=strict）应把这几处衔接提交用户确认，不 OK 就补 transition 或改写承接。`)
          }
          const storyline = Array.isArray(v.storyline) ? v.storyline : []
          if (storyline.length > 0) {
            lines.push('')
            lines.push('叙事链自审（逐页问：这页是否回答上一页留下的问题？有无突然跳跃？）：')
            for (const raw of storyline.slice(0, 20)) {
              const s = asRecord(raw)
              const bridge = typeof s.bridge === 'string' && s.bridge.trim() !== ''
              lines.push(`  [${String(s.pageId)}] ${String(s.title).slice(0, 26)}${s.keyMessage != null ? ` —— ${String(s.keyMessage).slice(0, 30)}` : ''} ${bridge ? '🔗承接✓' : '（无承接语）'}`)
            }
          }
          return oneText(lines.join('\n'))
        },
      },
      execute: async (rawArgs, exec) => {
        exec?.signal?.throwIfAborted()
        const args = z.object({ deckId: z.string().min(1) }).parse(asRecord(rawArgs))
        const { store } = resolveToolContext(config, exec)
        const state = await requireDeckState(store, args.deckId)
        const outline = await store.loadOutline(args.deckId)
        if (outline === undefined) throw new Error('必须先完成叙事架构与页级蓝图')
        const tokens = await store.loadTokens(args.deckId)
        if (tokens === undefined) throw new Error('必须先 ppt_design_lock 锁定设计')
        const spec = await store.loadSpec(args.deckId)
        const brief = await store.loadBrief(args.deckId)
        const pages = await store.loadPages(args.deckId)
        const manifest = await store.loadManifest(args.deckId)

        const issues: ValidationIssue[] = []
        const written = new Set(pages.map(p => p.id))
        for (const outlinePage of outline.pages) {
          if (!written.has(outlinePage.id)) {
            issues.push({ level: 'error', rule: 'PAGE_MISSING', message: `大纲页 ${outlinePage.id}（${outlinePage.title}）尚未写入` })
          }
        }
        for (const page of pages) {
          if (!outline.pages.some(p => p.id === page.id)) {
            issues.push({ level: 'warning', rule: 'PAGE_ORPHAN', message: `页面 ${page.id} 不在大纲中，将不参与渲染` })
          }
        }
        const deckPages = pages.filter(p => outline.pages.some(o => o.id === p.id)).sort((a, b) => a.id.localeCompare(b.id))
        const deckResult = validateDeckPages(deckPages, {
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
        issues.push(...deckResult.issues)

        // 全册时长预算：文字量估算讲述分钟 vs 简报时长（info 级提示，供删页/精简参考）
        let duration: { estimatedMin: number; targetMin?: number; ratio?: number } | undefined
        if (brief?.durationMin !== undefined) {
          const estimatedMin = estimateSpeakingMinutes(deckPages)
          const ratio = Math.round((estimatedMin / brief.durationMin) * 100) / 100
          duration = { estimatedMin, targetMin: brief.durationMin, ratio }
          if (ratio > 1.35 || ratio < 0.65) {
            issues.push({
              level: 'info',
              rule: 'DECK_DURATION_MISMATCH',
              message: `估算讲述时长约 ${estimatedMin} 分钟，与简报时长 ${brief.durationMin} 分钟偏差 ${(ratio > 1 ? '+' : '')}${Math.round((ratio - 1) * 100)}%（文字过多会讲不完，过少则冷场）——建议精简文字或与用户重对页数`,
            })
          }
        }

        // 依赖感知：页级指纹与上次比对，识别变更页
        const previousHashes = state.pageHashes ?? {}
        const pageHashes: Record<string, string> = {}
        const revalidated: string[] = []
        for (const page of deckPages) {
          const hash = await computePageHash(page)
          pageHashes[page.id] = hash
          if (previousHashes[page.id] !== hash) revalidated.push(page.id)
        }
        const unchangedCount = deckPages.length - revalidated.length

        const sceneHash = await computeSceneHash(tokens, outline, deckPages)
        // 关系型变更检测（0.9.0，依赖传播对称性修复）：transition/页序属于页间关系，
        // 页级指纹覆盖不到——大纲指纹变了就提示重读全量叙事链，而非只看 revalidated 变更页
        const outlineHash = await computeOutlineHash(outline)
        const outlineChanged = state.outlineHash !== undefined && state.outlineHash !== outlineHash
        state.sceneHash = sceneHash
        state.outlineHash = outlineHash
        state.pageHashes = pageHashes
        state.contentOutdated = false // 内容已重新校验；渲染产物（若曾渲染）此刻起过期
        state.renderOutdated = true
        await store.saveState(state)

        // 叙事链摘要（storyline）：供模型在阶段 6 自审"每页是否回答上一页的问题、有无跳跃"
        const outlineById = new Map(outline.pages.map(p => [p.id, p]))
        const storyline = deckPages
          .filter(p => p.type !== 'cover' && p.type !== 'toc')
          .map(p => {
            const blueprint = outlineById.get(p.id)
            return {
              pageId: p.id,
              title: blueprint?.title ?? p.title ?? p.type,
              keyMessage: blueprint?.keyMessage ?? null,
              bridge: blueprint?.transition?.fromPrevious ?? null,
            }
          })
        // 疑似断裂（0.8.1）：内容页（非章节隔页）缺承接语的页对——precise 模式应提交用户确认
        const storylineGaps = deckPages
          .filter((p, i, arr) => i > 0 && p.type !== 'cover' && p.type !== 'toc' && p.type !== 'section'
            && arr[i - 1].type !== 'cover' && arr[i - 1].type !== 'toc'
            && (outlineById.get(p.id)?.transition?.fromPrevious ?? '').trim() === '')
          .map(p => p.id)

        const errorCount = issues.filter(i => i.level === 'error').length
        const warningCount = issues.filter(i => i.level === 'warning').length
        const logger = createDeckLogger(store.paths(args.deckId).root, args.deckId)
        logger.info('check', '全册校验完成', { sceneHash, errorCount, warningCount, pageCount: deckPages.length, revalidated })
        return {
          deckId: args.deckId,
          ok: errorCount === 0,
          sceneHash,
          pageCount: deckPages.length,
          errorCount,
          warningCount,
          issues,
          revalidated,
          unchangedCount,
          storyline,
          storylineGaps,
          outlineChanged,
          ...(duration !== undefined ? { duration } : {}),
        }
      },
    },
  ]
}
