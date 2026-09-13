/**
 * ppt_themes —— 列出内置主题（对话中先调，供用户在第 0 步选定）。
 * ppt_design_propose —— 第 4 步 A：生成 2-3 套设计规范预设供用户确认。
 * ppt_design_lock —— 第 4 步 B：按选定方案产出两份计划文件并锁定。
 *   design/spec.json   完整设计规范（页数分配/密度策略/设计纪律）
 *   design/tokens.json 全 deck 锁定的配色/字体/字号阶梯/标题锚点/栅格
 */
import { z } from 'zod'
import type { DeckDensity, DeckOutline, DesignSpec, DesignTokens, InfoStructure } from '../schema.js'
import { designSpecSchema, paletteOverridesSchema } from '../schema.js'
import { THEME_CATEGORIES, THEME_CATEGORY_LABELS, buildDesignTokens, getTheme, THEMES, themeSummaries } from '../themes.js'
import type { ThemeCategory } from '../themes.js'
import { createDeckLogger } from '../logger.js'
import { requireDeckState } from '../deck-store.js'
import { DeckStore } from '../deck-store.js'
import { listWorkspaces } from '../workspace-registry.js'
import { resolvedConfirmStages } from './brief.js'
import type { ResolvedPptStudioConfig } from '../config.js'
import { asRecord, oneText, resolveToolContext, type ToolDefinition } from './registry.js'

/** 密度 → 文字预算（全角字符单位）。有主视觉页收紧，无图页放宽。 */
const DENSITY_POLICY: Record<DesignSpec['density'], DesignSpec['densityPolicy']> = {
  sparse: { withVisualCharBudget: 140, plainCharBudget: 400, bulletsMax: 4 },
  normal: { withVisualCharBudget: 220, plainCharBudget: 700, bulletsMax: 6 },
  dense: { withVisualCharBudget: 320, plainCharBudget: 1000, bulletsMax: 6 },
}

function defaultSpecNotes(policy: DesignSpec['densityPolicy']): string[] {
  return [
    '有主视觉（图/图表）的页面文字精炼：全页文字量不超过 withVisualCharBudget；无图页可放宽到 plainCharBudget。',
    `每页要点 ≤${policy.bulletsMax} 条；正文字号用锁定阶梯的 body 值。`,
    '颜色只用 tokens.colors 与 tokens.chartColors；标题位置用 tokens.anchors，内容区用 tokens.grid。',
  ]
}

/**
 * 信息结构 → 结构类（与 generation-flow.md 阶段 3 的四分类口径一致）。
 * Prototype 挑代表页时按结构类去重：每类挑第一个出现的，保证 3 页尽量"长得不一样"。
 */
const STRUCTURE_CLUSTER: Record<InfoStructure, 'narrative' | 'contrast' | 'data' | 'concept'> = {
  timeline: 'narrative',
  process: 'narrative',
  'cause-effect': 'narrative',
  'problem-solution': 'narrative',
  comparison: 'contrast',
  'before-after': 'contrast',
  'data-insight': 'data',
  'concept-example': 'concept',
  hierarchy: 'concept',
  plain: 'concept',
}

/**
 * 挑 Prototype 代表页（≤3 个）：**结构类 × 页型 × 风险**三维（0.9.1 加风险加权）——
 * 第一轮每个结构类取**风险分最高**的页（叙事/对比/数据/概念各一，同类里优先挑最难的：
 * 图表 +2 / 配图 +1 / 概要长（信息密集）+1 / 页级 high 密度 +1，同分取先出现）；
 * 第二轮补页型未见过的页（同一结构类里 timeline 与 process 长得并不一样）；
 * 不足按册序补齐。Prototype 的目的是用最少的页暴露最多的真实渲染风险。
 */
export function pickPrototypePages(outline: DeckOutline): string[] {
  const content = outline.pages.filter(p => p.sectionId !== 's0')
  const riskScore = (page: (typeof content)[number]): number =>
    (page.visual === 'chart' ? 2 : page.visual === 'image' ? 1 : 0) +
    ([...page.contentBrief].length >= 200 ? 1 : 0) +
    (page.density === 'high' ? 1 : 0)
  const seenClusters = new Set<string>()
  const seenTypes = new Set<string>()
  const picked: string[] = []
  for (const page of content) {
    seenTypes.add(page.type)
    const cluster = STRUCTURE_CLUSTER[page.structure] ?? 'concept'
    if (seenClusters.has(cluster)) continue
    // 簇内挑风险分最高的（同分取先出现，保持与旧版确定性一致）
    const best = content
      .filter(p => (STRUCTURE_CLUSTER[p.structure] ?? 'concept') === cluster)
      .reduce((acc, p) => (riskScore(p) > riskScore(acc) ? p : acc), page)
    seenClusters.add(cluster)
    picked.push(best.id)
    if (picked.length >= 3) return picked
  }
  // 第二轮：页型多样性（同结构类内的视觉差异）
  for (const page of content) {
    if (picked.length >= 3) break
    if (!picked.includes(page.id) && !picked.some(id => content.find(p => p.id === id)?.type === page.type)) {
      picked.push(page.id)
    }
  }
  for (const page of content) {
    if (picked.length >= 3) break
    if (!picked.includes(page.id)) picked.push(page.id)
  }
  return picked
}

/** 跨工作区找源 deck：经全局注册表遍历其他工作区，返回包含该 deck 的 store（找不到返回 undefined）。 */
async function findWorkspaceStoreWithDeck(
  config: ResolvedPptStudioConfig,
  exec: Parameters<ToolDefinition['execute']>[1],
  deckId: string,
  localStore: DeckStore,
): Promise<DeckStore | undefined> {
  const { resolve } = await import('node:path')
  const localRoot = resolve(localStore.rootDir)
  for (const root of listWorkspaces()) {
    if (resolve(root) === localRoot) continue
    const candidate = new DeckStore(root)
    if (await candidate.loadState(deckId) !== undefined) return candidate
  }
  return undefined
}

/** 主题气质亲和表：为"换气质"方案确定性推荐相邻主题。 */
const THEME_AFFINITY: Record<string, readonly string[]> = {
  'business-blue': ['academic-plain', 'navy-gold'],
  'tech-dark': ['indigo-gradient', 'mono-editorial'],
  'gov-red': ['navy-gold', 'warm-sunset'],
  'academic-plain': ['business-blue', 'forest-ink'],
  'fresh-teal': ['forest-ink', 'cream-notes'],
  'warm-sunset': ['cream-notes', 'gov-red'],
  'mono-editorial': ['tech-dark', 'slate-orange'],
  'indigo-gradient': ['tech-dark', 'navy-gold'],
  'cream-notes': ['warm-sunset', 'fresh-teal'],
  'forest-ink': ['fresh-teal', 'academic-plain'],
  'navy-gold': ['business-blue', 'gov-red'],
  'slate-orange': ['mono-editorial', 'tech-dark'],
}

/**
 * 场景驱动推荐（方案 D）：按简报的听众/场景/目标/时长关键词确定性命中。
 * 返回 null 表示无命中（方案 D 不出现）。
 */
function scenarioScheme(brief: {
  audience: string
  scenario: string
  objective: string
  topic: string
  durationMin?: number
  themeId: string
  density: DeckDensity
}): { themeId: string; density: DeckDensity; rationale: string } | null {
  const haystack = `${brief.audience} ${brief.scenario} ${brief.objective} ${brief.topic}`
  const duration = brief.durationMin ?? 20
  if (/中学|小学|儿童|少年|青少年|孩子/.test(brief.audience) && /教育|课堂|科普|教学|讲座|课程/.test(brief.scenario + brief.objective)) {
    return {
      themeId: 'cream-notes',
      density: 'sparse',
      rationale: `场景驱动：面向青少年（${brief.audience.slice(0, 12)}…）的教育/科普——奶油手账低饱和活泼 + 稀疏版（字大留白多，后排也看得清）`,
    }
  }
  if (/路演|融资|投资|招商|发布|发布会|大促/.test(haystack) && duration <= 20) {
    return {
      themeId: 'indigo-gradient',
      density: 'sparse',
      rationale: `场景驱动：短时长（约 ${duration} 分钟）路演/发布——靛蓝渐变高对比大气 + 稀疏版（大字少字，情绪优先）`,
    }
  }
  if (/政府|政务|机关|公共|党政|上级|评审|答辩/.test(haystack)) {
    return {
      themeId: 'gov-red',
      density: 'normal',
      rationale: '场景驱动：政务/对上汇报场合——政务红庄重规范，常规密度承载论证',
    }
  }
  if (/安全|生产|制造|工程|运维|质量|事故/.test(haystack)) {
    return {
      themeId: 'slate-orange',
      density: 'dense',
      rationale: '场景驱动：工程/安全/运营场景——工业灰橙的警示语义 + 紧凑版承载指标看板',
    }
  }
  return null
}

export function createThemeTools(_config: ResolvedPptStudioConfig): ToolDefinition[] {
  return [
    {
      name: 'ppt_themes',
      description:
        '列出 dsh-ppt-studio 内置视觉主题（id/名称/情绪/适用场景/分类/明暗），展示给用户在第 0 步选定，选定后作为 ppt_brief_create 的 themeId。' +
        '可选 topicType：从简报的主题/听众/场景判断类型（tech 科技 / business 商业 / education 教育 / gov 政务 / culture 文化 / event 活动）传入，' +
        '同类主题排前并标「推荐」。中文：列出内置 PPT 主题（可按主题类型推荐）。',
      parameters: {
        type: 'object',
        properties: {
          topicType: {
            type: 'string',
            enum: [...THEME_CATEGORIES],
            description: '可选：主题类型（从简报判断），传入后同类主题排前并标推荐',
          },
        },
      },
      output: {
        schema: { type: 'object', properties: { themes: { type: 'array', items: { type: 'object' } } }, additionalProperties: true },
        render: (_args, value) => {
          const v = asRecord(value)
          const themes = Array.isArray(v.themes) ? v.themes : []
          const args = asRecord(_args)
          const topicType = typeof args.topicType === 'string' ? args.topicType : undefined
          const label = topicType !== undefined ? (THEME_CATEGORY_LABELS as Record<string, string>)[topicType] ?? topicType : undefined
          const lines = themes.map(t => {
            const theme = asRecord(t)
            const mark = theme.recommended === true ? '⭐推荐 ' : ''
            return `- ${mark}${String(theme.id)}｜${String(theme.name)}（${String(theme.mood)}）适合：${String(theme.bestFor)}｜${String(theme.category)}｜${theme.dark === true ? '深色' : '浅色'}`
          })
          const header = topicType !== undefined
            ? `dsh-ppt-studio 内置主题（按「${label}」类推荐排序）：`
            : 'dsh-ppt-studio 内置主题：'
          const tail = topicType !== undefined
            ? '\n\n⭐ 为该类型推荐主题，请用户选择其一（或提出定制色板）。'
            : '\n\n请用户选择其一（或提出定制色板）。判断主题类型后可带 topicType 重调获得推荐排序。'
          return oneText(header + '\n\n' + lines.join('\n') + tail)
        },
      },
      execute: async (rawArgs, exec) => {
        exec?.signal?.throwIfAborted()
        const args = z
          .object({ topicType: z.enum(THEME_CATEGORIES).optional() })
          .parse(asRecord(rawArgs))
        const summaries = themeSummaries()
        if (args.topicType === undefined) return { themes: summaries.map(t => ({ ...t, recommended: false })) }
        const recommended = summaries
          .filter(t => t.category === args.topicType)
          .map(t => ({ ...t, recommended: true }))
        const rest = summaries
          .filter(t => t.category !== args.topicType)
          .map(t => ({ ...t, recommended: false }))
        return { themes: [...recommended, ...rest], topicType: args.topicType }
      },
    },
  ]
}

export function createDesignTools(config: ResolvedPptStudioConfig): ToolDefinition[] {
  return [
    {
      name: 'ppt_design_propose',
      description:
        'PPT 制作第 4 步 A（页数/蓝图阶段后、锁定前）：生成 2-4 套设计规范预设供用户确认——' +
        '方案 A 按简报原定主题与密度；方案 B 同主题的密度变体（按时长/页数给理由）；方案 C 换一个气质相邻的主题；' +
        '方案 D（命中时出现）场景驱动推荐：按听众/场景/目标/时长关键词确定性匹配（如青少年教育→奶油手账稀疏版、短时路演→靛蓝渐变、政务汇报→政务红、工程安全→工业灰橙紧凑）。' +
        '每套含主题/密度/主色点缀色/字体/适用理由。返回后必须展示给用户选择，选定后把方案的 themeId/density（及 paletteOverrides）带入 ppt_design_lock。' +
        '本工具只读不落盘（选择结果经 design_lock 生效）。中文：生成设计规范预设方案。',
      parameters: {
        type: 'object',
        properties: { deckId: { type: 'string' } },
        required: ['deckId'],
      },
      output: {
        schema: { type: 'object', properties: { deckId: { type: 'string' }, schemes: { type: 'array' } }, additionalProperties: true },
        render: (_args, value) => {
          const v = asRecord(value)
          const schemes = Array.isArray(v.schemes) ? v.schemes : []
          const lines = [`🎨 设计规范预设（${schemes.length} 套，请用户选定其一）：`]
          for (const raw of schemes) {
            const s = asRecord(raw)
            const colors = asRecord(s.colors)
            lines.push(`  方案 ${String(s.id)}｜${String(s.themeName)} · 密度 ${String(s.density)}`)
            lines.push(`      主色 ${String(colors.primary)} / 点缀 ${String(colors.accent)}｜${String(s.rationale)}`)
          }
          lines.push('')
          lines.push('用户选定后调 ppt_design_lock（带选定方案的 themeId/density）。')
          return oneText(lines.join('\n'))
        },
      },
      execute: async (rawArgs, exec) => {
        exec?.signal?.throwIfAborted()
        const args = z.object({ deckId: z.string().min(1) }).parse(asRecord(rawArgs))
        const { store } = resolveToolContext(config, exec)
        await requireDeckState(store, args.deckId)
        const brief = await store.loadBrief(args.deckId)
        const outline = await store.loadOutline(args.deckId)
        if (brief === undefined || outline === undefined) throw new Error('必须先完成简报与叙事架构（阶段 0–1）')

        const baseTheme = getTheme(brief.themeId)
        if (baseTheme === undefined) throw new Error(`简报主题 ${brief.themeId} 不存在`)

        // 方案 B：同主题密度变体（0.9.1 修正密度-时长方向：时间越紧越要少放信息，不是塞更多——
        // ≥30 分钟充裕 → 稀疏观感大气；<15 分钟极紧 → 稀疏少字大图讲得完；中间档 → 紧凑承载信息但附权衡提示）
        const duration = brief.durationMin ?? 20
        const flippedDensity: DeckDensity =
          brief.density === 'normal' ? (duration >= 30 || duration < 15 ? 'sparse' : 'dense') : 'normal'
        const densityRationale =
          brief.density === 'normal'
            ? duration >= 30
              ? `时长约 ${duration} 分钟较充裕，稀疏版字更大留白更多，观感更大气`
              : duration < 15
                ? `时长仅约 ${duration} 分钟：稀疏版少字大图，每页讲透一句——紧凑页在赶时间时反而讲不完`
                : `时长约 ${duration} 分钟页均偏紧：紧凑版可承载更多信息（若更重观感选方案 A，或减页数用稀疏版）`
            : '回到常规密度，信息量与观感平衡'

        // 方案 C：气质相邻主题
        const affinityId = (THEME_AFFINITY[brief.themeId] ?? []).find(id => id !== brief.themeId)
        const affinityTheme = affinityId !== undefined ? getTheme(affinityId) : undefined

        // 方案 D：场景驱动（按听众/场景/目标/时长关键词确定性命中；与原定主题相同时不重复出现）
        const scenario = scenarioScheme(brief)
        const scenarioTheme = scenario !== null && scenario.themeId !== brief.themeId ? getTheme(scenario.themeId) : undefined

        const schemes = [
          {
            id: 'A',
            themeId: baseTheme.id,
            themeName: baseTheme.name,
            density: brief.density,
            colors: { primary: baseTheme.colors.primary, accent: baseTheme.colors.accent },
            fonts: baseTheme.fonts,
            rationale: `简报原定：${baseTheme.mood}，适合${baseTheme.bestFor}`,
          },
          {
            id: 'B',
            themeId: baseTheme.id,
            themeName: `${baseTheme.name}（${flippedDensity === 'sparse' ? '稀疏版' : flippedDensity === 'dense' ? '紧凑版' : '常规版'}）`,
            density: flippedDensity,
            colors: { primary: baseTheme.colors.primary, accent: baseTheme.colors.accent },
            fonts: baseTheme.fonts,
            rationale: densityRationale,
          },
          ...(affinityTheme !== undefined
            ? [{
                id: 'C',
                themeId: affinityTheme.id,
                themeName: affinityTheme.name,
                density: brief.density,
                colors: { primary: affinityTheme.colors.primary, accent: affinityTheme.colors.accent },
                fonts: affinityTheme.fonts,
                rationale: `换个气质：${affinityTheme.mood}，适合${affinityTheme.bestFor}`,
              }]
            : []),
          ...(scenarioTheme !== undefined && scenario !== null
            ? [{
                id: 'D',
                themeId: scenarioTheme.id,
                themeName: `${scenarioTheme.name}（场景推荐）`,
                density: scenario.density,
                colors: { primary: scenarioTheme.colors.primary, accent: scenarioTheme.colors.accent },
                fonts: scenarioTheme.fonts,
                rationale: scenario.rationale,
              }]
            : []),
        ]

        const logger = createDeckLogger(store.paths(args.deckId).root, args.deckId)
        logger.info('design', '设计预设已生成', { schemes: schemes.map(s => `${s.id}:${s.themeId}/${s.density}`) })
        return { deckId: args.deckId, schemes }
      },
    },
    {
      name: 'ppt_design_lock',
      description:
        'PPT 制作第 4 步（整体蓝图经用户确认后）：产出并锁定两份计划文件——' +
        'design/spec.json（完整设计规范：各部分页数分配、密度策略、字号阶梯引用）与 ' +
        'design/tokens.json（全 deck 锁定的配色/字体/字号阶梯/标题锚点/栅格）。' +
        '此后写页只能使用令牌内的颜色与字体（校验器强制），渲染也只认这份令牌。' +
        '确认点含 prototype 时（precise 预设或显式指定），会按结构聚类 × 风险加权挑出 ≤3 个 Prototype 代表页（spec.prototypePages）：先写这些页并 ppt_preview_update 请用户确认真实视觉效果，再继续写其余页；' +
        '有其他确认关卡但不含 prototype 时同样生成代表页（作为可选建议）；打包模式（无逐阶段确认）不生成。' +
        '两种方式二选一：①带 themeId/density（ppt_design_propose 预设选定值或简报原定）按主题生成；' +
        '②带 copyFromDeckId 从同工作区另一 deck 复用设计（周报系列/系列课程等复用品牌），令牌原样克隆、密度策略沿用源 deck。' +
        '前置条件：全部部分蓝图完成且内容页数与确认值一致、封面/目录/结尾齐备。中文：锁定设计规范与视觉令牌（可复用模板）。',
      parameters: {
        type: 'object',
        properties: {
          deckId: { type: 'string' },
          themeId: { type: 'string', description: '可选：用户在 ppt_design_propose 预设中选定的主题（缺省用简报原定主题）；与 copyFromDeckId 互斥' },
          density: { type: 'string', enum: ['sparse', 'normal', 'dense'], description: '可选：选定方案的密度（缺省用简报原定密度）；与 copyFromDeckId 互斥' },
          paletteOverrides: { type: 'object', description: '可选：色板覆盖（#RRGGBB）：bg/surface/primary/secondary/accent/text/textMuted/onPrimary；与 copyFromDeckId 互斥' },
          copyFromDeckId: { type: 'string', description: '可选：复用源 deck 的设计令牌（同工作区已锁定设计的 deck，如上周的汇报）；与 themeId/density/paletteOverrides 互斥' },
          prototypePageIds: { type: 'array', items: { type: 'string' }, description: '可选（≤3 个内容页 id）：用户在蓝图阶段标记"最关心这几页"——指定后 Prototype 代表页用这份清单（而非结构聚类自动挑选）；打包模式（无逐阶段确认）不适用', maxItems: 3 },
        },
        required: ['deckId'],
      },
      output: {
        schema: { type: 'object', properties: { deckId: { type: 'string' }, tokens: { type: 'object' }, spec: { type: 'object' } }, additionalProperties: true },
        render: (_args, value) => {
          const v = asRecord(value)
          const tokens = asRecord(v.tokens)
          const colors = asRecord(tokens.colors)
          const fonts = asRecord(tokens.fonts)
          const spec = asRecord(v.spec)
          const policy = asRecord(spec.densityPolicy)
          const copiedFrom = typeof v.copiedFrom === 'string' ? v.copiedFrom : undefined
          const proto = Array.isArray(spec.prototypePages) ? spec.prototypePages.map(p => String(p)) : []
          const protoRequired = v.prototypeRequired === true
          const lines = [
            copiedFrom !== undefined
              ? `✅ 设计已锁定（复用自 ${copiedFrom}，主题 ${String(tokens.themeId)}）：`
              : `✅ 设计已锁定（主题 ${String(tokens.themeId)}）：`,
            `  色板：primary ${String(colors.primary)} / secondary ${String(colors.secondary)} / accent ${String(colors.accent)}（改页只能用锁定色）`,
            `  字体：标题 ${String(fonts.title)} / 正文 ${String(fonts.body)}`,
            `  密度策略：有图页文字 ≤${String(policy.withVisualCharBudget)} 字，无图页 ≤${String(policy.plainCharBudget)} 字`,
          ]
          if (proto.length > 0) {
            lines.push(`  Prototype 代表页：${proto.join(' / ')}（结构聚类 × 风险加权挑选，覆盖不同页型长相）`)
          }
          lines.push('')
          if (proto.length > 0) {
            lines.push(
              protoRequired
                ? `确认点含 prototype：先写 ${proto.join('、')} 这 ${proto.length} 页（整页 ppt_page_write）→ ppt_preview_update 展示真实视觉效果请用户确认；` +
                    '认可后再继续写其余页；不认可则重调 ppt_design_propose/lock 换方案（令牌变 → sceneHash 失效 → 已写页重写）。'
                : `建议先写 ${proto.join('、')} 这 ${proto.length} 页并 ppt_preview_update 看真实视觉效果（本会话未设 prototype 确认关卡，可跳过直接顺序写页）。`,
            )
          } else {
            lines.push('下一步：逐页 ppt_page_write（先读 reference/layouts.md 的页型坐标速查），全部写完 → ppt_scene_check → ppt_deck_render。')
          }
          return oneText(lines.join('\n'))
        },
      },
      execute: async (rawArgs, exec) => {
        exec?.signal?.throwIfAborted()
        const args = z
          .object({
            deckId: z.string().min(1),
            themeId: z.string().min(1).max(40).optional(),
            density: z.enum(['sparse', 'normal', 'dense']).optional(),
            paletteOverrides: paletteOverridesSchema.optional(),
            copyFromDeckId: z.string().min(1).optional(),
            prototypePageIds: z.array(z.string().min(1)).max(3).optional(),
          })
          .parse(asRecord(rawArgs))
        if (args.copyFromDeckId !== undefined && (args.themeId !== undefined || args.density !== undefined || args.paletteOverrides !== undefined)) {
          throw new Error('copyFromDeckId 与 themeId/density/paletteOverrides 互斥：复用模板时设计取自源 deck（改设计请直接改源 deck 后重新复制，或不用 copyFrom 走主题生成）')
        }
        const { store } = resolveToolContext(config, exec)
        const state = await requireDeckState(store, args.deckId)
        const brief = await store.loadBrief(args.deckId)
        const outline = await store.loadOutline(args.deckId)
        const plan = await store.loadPlan(args.deckId)
        if (brief === undefined || outline === undefined || plan === undefined) {
          throw new Error('简报/叙事架构/页数计划缺失，无法锁定设计（按阶段 0–3 顺序完成后再来）')
        }

        // 两种设计来源：模板复用（copyFrom）或按主题生成（propose 选定值/简报原定）
        let tokens: DesignTokens
        let specDensity: DeckDensity
        let specPolicy: DesignSpec['densityPolicy']
        let specNotes: string[]
        let copiedFrom: string | undefined
        if (args.copyFromDeckId !== undefined) {
          // 源 deck 解析：本地工作区优先，找不到则经全局注册表跨工作区查找（品牌设计库可能在别的目录）
          let sourceStore = store
          if (await store.loadState(args.copyFromDeckId) === undefined) {
            const remote = await findWorkspaceStoreWithDeck(config, exec, args.copyFromDeckId, store)
            if (remote === undefined) {
              await requireDeckState(store, args.copyFromDeckId) // 抛标准错误：附本地现有 deck 清单
            } else {
              sourceStore = remote
            }
          }
          const sourceTokens = await sourceStore.loadTokens(args.copyFromDeckId)
          if (sourceTokens === undefined) {
            throw new Error(`源 deck ${args.copyFromDeckId} 尚未锁定设计（design/tokens.json 不存在），无法复用：可先对其调 ppt_design_lock，或不带 copyFromDeckId 按主题生成`)
          }
          const sourceSpec = await sourceStore.loadSpec(args.copyFromDeckId)
          // 令牌原样克隆（自包含机器事实：色板/字体/字号阶梯/锚点/栅格）；锁定时间为本次应用时间
          tokens = { ...sourceTokens, lockedAt: new Date().toISOString() }
          specDensity = sourceSpec?.density ?? brief.density
          specPolicy = sourceSpec?.densityPolicy ?? DENSITY_POLICY[specDensity]
          specNotes = sourceSpec?.notes ?? defaultSpecNotes(specPolicy)
          copiedFrom = args.copyFromDeckId
        } else {
          // 预设选定值优先（ppt_design_propose → 用户选定 → 此处生效），缺省回落简报原定
          const resolvedThemeId = args.themeId ?? brief.themeId
          const resolvedDensity = args.density ?? brief.density
          const resolvedOverrides = args.paletteOverrides ?? brief.paletteOverrides
          const theme = getTheme(resolvedThemeId)
          if (theme === undefined) throw new Error(`主题 ${resolvedThemeId} 不存在`)
          tokens = buildDesignTokens(theme, { density: resolvedDensity, paletteOverrides: resolvedOverrides })
          specDensity = resolvedDensity
          specPolicy = DENSITY_POLICY[resolvedDensity]
          specNotes = defaultSpecNotes(specPolicy)
        }

        // 蓝图完整性终检
        const problems: string[] = []
        const structuralTypes = ['cover', 'toc', 'closing']
        for (const t of structuralTypes) {
          if (!outline.pages.some(p => p.sectionId === 's0' && p.type === t)) problems.push(`缺少结构页：${t}`)
        }
        for (const part of outline.parts) {
          if (!outline.pages.some(p => p.sectionId === part.id)) problems.push(`部分 ${part.id}（${part.title}）还没有蓝图`)
        }
        const contentCount = outline.pages.filter(p => p.sectionId !== 's0').length
        if (contentCount !== plan.contentPages) {
          problems.push(`内容页 ${contentCount} 页与确认的 ${plan.contentPages} 页不一致`)
        }
        if (problems.length > 0) {
          throw new Error('蓝图不完整，无法锁定设计：\n' + problems.map(p => `  - ${p}`).join('\n'))
        }

        // Prototype 代表页（0.9.1 完成解耦：读展开后的确认点，不再按 mode 分支）：
        // 完全没有确认关卡（打包模式）→ 跳过（无处停顿确认，代表页没有意义）；
        // 其余会话生成建议——confirmStages 含 prototype 时是强制关卡，否则是可选建议。
        // 用户指定的 prototypePageIds 优先（0.8.2：蓝图阶段用户标记"最关心这几页"）。
        const stages = resolvedConfirmStages(brief)
        let prototypePages: string[] = []
        if (stages.size > 0) {
          if (args.prototypePageIds !== undefined && args.prototypePageIds.length > 0) {
            const contentIds = new Set(outline.pages.filter(p => p.sectionId !== 's0').map(p => p.id))
            const unknown = args.prototypePageIds.filter(id => !contentIds.has(id))
            if (unknown.length > 0) {
              throw new Error(`prototypePageIds 含未知或非内容页：${unknown.join('、')}（必须是 outline 中的内容页 id；结构页不参与 Prototype）`)
            }
            prototypePages = args.prototypePageIds
          } else {
            prototypePages = pickPrototypePages(outline)
          }
        }
        const prototypeRequired = stages.has('prototype')

        const spec: DesignSpec = designSpecSchema.parse({
          deckId: args.deckId,
          density: specDensity,
          pageAllocation: outline.parts.map(part => ({
            sectionId: part.id,
            title: part.title,
            pages: outline.pages.filter(p => p.sectionId === part.id).length,
          })),
          densityPolicy: specPolicy,
          notes: specNotes,
          ...(prototypePages.length > 0 ? { prototypePages } : {}),
          lockedAt: new Date().toISOString(),
        })
        const paths = store.paths(args.deckId)
        await store.saveJson(paths.tokens, tokens)
        await store.saveJson(paths.spec, spec)
        state.stage = 'locked'
        if (state.architectureRevisedAt !== undefined) state.architectureRevisedAt = undefined // 重新锁定 = 设计重新确立，修订标记解除
        await store.saveState(state)
        const logger = createDeckLogger(paths.root, args.deckId)
        logger.info('design', copiedFrom !== undefined ? `设计已锁定（复用自 ${copiedFrom}）` : '设计已锁定', {
          themeId: tokens.themeId,
          density: spec.density,
          contentPages: contentCount,
          ...(copiedFrom !== undefined ? { copiedFrom } : {}),
        })
        return { deckId: args.deckId, tokens, spec, ...(copiedFrom !== undefined ? { copiedFrom } : {}), ...(prototypeRequired ? { prototypeRequired: true } : {}) }
      },
    },
  ]
}
