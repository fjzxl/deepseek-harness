/**
 * 场景数据模型（zod schema + TypeScript 类型）。
 *
 * 一个 deck 的全部状态由若干 JSON 文件描述（对应流水线阶段 0–8）：
 *   brief.json         0 简报（听众/场景/目标/时长/选定主题）
 *   outline.json       1 叙事架构（核心主张+问题链）→ 3 合成页级蓝图
 *   plan.json          2 页数计划（内容页数 + 分配 + 自动附加的结构页）
 *   sections/          3 各部分 Page Blueprint 快照
 *   design/spec.json   4 完整设计规范（页数分配/密度策略）
 *   design/tokens.json 4 全 deck 锁定的配色/字体/字号阶梯/锚点/栅格
 *   pages/             5 每页场景（本文件定义的 PageScene）
 *
 * 场景坐标单位英寸；颜色统一 '#RRGGBB'；
 * PPTX（pptxgenjs）与 HTML 预览消费同一份 PageScene，保证所见即所得。
 */
import { z } from 'zod'
import { CANVAS_H_IN, CANVAS_W_IN } from './units.js'

// ---------------------------------------------------------------- 基础

export const colorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, '颜色必须是 #RRGGBB 格式')

export const idSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]{0,39}$/, 'ID 必须以字母开头，仅含字母/数字/下划线/连字符，长度 ≤40')

export const boxSchema = z.object({
  // 硬边界只拦明显荒谬的值（±3in 出血余量给背景装饰的出血式画法）；
  // 内容元素必须落在安全区内由 validate.ts 的 OUT_OF_BOUNDS 精确把关。
  x: z.number().min(-3).max(CANVAS_W_IN + 3),
  y: z.number().min(-3).max(CANVAS_H_IN + 3),
  w: z.number().min(0.05).max(CANVAS_W_IN + 3),
  h: z.number().min(0.05).max(CANVAS_H_IN + 3),
})

export const gradientSchema = z.object({
  from: colorSchema,
  to: colorSchema,
  angle: z.number().min(0).max(360).default(135),
})

export const alignSchema = z.enum(['left', 'center', 'right'])
export const valignSchema = z.enum(['top', 'mid', 'bottom'])
export const fitSchema = z.enum(['cover', 'contain', 'fill'])

/** 页型。版式规范见 reference/layouts.md。 */
export const PAGE_TYPES = [
  'cover',
  'toc',
  'section',
  'bullets',
  'two-col',
  'image-text',
  'chart',
  'table',
  'quote',
  'closing',
  'timeline',
  'comparison',
  'big-number',
  'process',
  'cards',
  'hierarchy',
  'icon-list',
] as const
export const pageTypeSchema = z.enum(PAGE_TYPES)
export type PageType = z.infer<typeof pageTypeSchema>

// ---------------------------------------------------------------- 元素

const elementBase = {
  id: idSchema,
  name: z.string().max(60).optional(),
  /** 层级，大的在上；省略时按数组顺序 */
  z: z.number().int().min(0).max(99).optional(),
  /** 背景装饰元素：豁免越界/重叠校验（整页铺底形状、装饰色块） */
  background: z.boolean().optional(),
}

const runSchema = z.object({
  text: z.string().min(1),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  color: colorSchema.optional(),
  /** 上限 300 与元素级一致：允许装饰性大数字 */
  fontSize: z.number().min(8).max(300).optional(),
  /** 上标（公式指数/转置：QK^T 的 T、d^-0.5 的 -0.5）——不要用 Unicode ᵀ（字体缺字形）或字面 ^ 记法 */
  superscript: z.boolean().optional(),
  /** 下标（公式变量下标：d_k 的 k、x_1 的 1）——不要用字面下划线记法 */
  subscript: z.boolean().optional(),
})

const paragraphSchema = z
  .object({
    /** 富文本段落（多 run）；与 text 二选一，同时给出时 runs 优先 */
    runs: z.array(runSchema).max(12).optional(),
    text: z.string().optional(),
    align: alignSchema.optional(),
    /** 段落级样式：作用于整段（run 未指定时生效）。sessionlog 回归：缺失会导致模型写的段落样式被静默剥离 */
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    color: colorSchema.optional(),
    fontSize: z.number().min(8).max(300).optional(),
    bullet: z
      .union([z.boolean(), z.object({ marker: z.string().max(4).optional() })])
      .optional(),
    /** 行距倍数（相对字号），默认 1.25 */
    lineSpacing: z.number().min(0.8).max(3).optional(),
    spaceBefore: z.number().min(0).max(72).optional(),
    spaceAfter: z.number().min(0).max(72).optional(),
  })
  .refine(p => p.runs !== undefined || p.text !== undefined, '段落必须提供 runs 或 text')

export const textElementSchema = z.object({
  ...elementBase,
  kind: z.literal('text'),
  ...boxSchema.shape,
  /** 上限 300：允许装饰性大数字（如章节页 240pt 半透明序号） */
  fontSize: z.number().min(8).max(300),
  color: colorSchema,
  font: z.string().max(60).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  align: alignSchema.default('left'),
  valign: valignSchema.default('top'),
  /** 文本框底色（省略为透明） */
  fill: colorSchema.optional(),
  paragraphs: z.array(paragraphSchema).min(1).max(15),
})

export const SHAPE_TYPES = [
  'rect',
  'roundRect',
  'ellipse',
  'triangle',
  'diamond',
  'chevron',
  'rightArrow',
  'pentagon',
  'line',
] as const
export const shapeTypeSchema = z.enum(SHAPE_TYPES)

export const shapeElementSchema = z.object({
  ...elementBase,
  kind: z.literal('shape'),
  ...boxSchema.shape,
  shape: shapeTypeSchema,
  fill: z.union([colorSchema, gradientSchema]).optional(),
  opacity: z.number().min(0).max(1).optional(),
  border: z
    .object({
      color: colorSchema,
      /** 磅 */
      width: z.number().min(0.25).max(12),
      style: z.enum(['solid', 'dashed']).default('solid'),
    })
    .optional(),
  /** roundRect 圆角半径（短边百分比 0-50），默认 12 */
  radius: z.number().min(0).max(50).optional(),
})

/** 图片来源约束（assetId/placeholder 二选一）与图表数据约束在 validate.ts 中做确定性校验。 */
export const imageElementSchema = z.object({
  ...elementBase,
  kind: z.literal('image'),
  ...boxSchema.shape,
  /** 已登记的资产 ID（ppt_asset_register / ppt_image_generate 返回） */
  assetId: idSchema.optional(),
  /** 占位框：无图可放时给用户的替换提示 */
  placeholder: z
    .object({ prompt: z.string().min(1).max(120), hint: z.string().max(120).optional() })
    .optional(),
  fit: fitSchema.default('cover'),
  /** 圆角（短边百分比 0-50） */
  radius: z.number().min(0).max(50).optional(),
})

export const CHART_TYPES = ['column', 'bar', 'line', 'area', 'pie', 'doughnut'] as const
export const chartTypeSchema = z.enum(CHART_TYPES)
export type ChartType = z.infer<typeof chartTypeSchema>

export const chartElementSchema = z.object({
  ...elementBase,
  kind: z.literal('chart'),
  ...boxSchema.shape,
  chartType: chartTypeSchema,
  title: z.string().max(60).optional(),
  labels: z.array(z.string().max(30)).min(1).max(24),
  series: z
    .array(z.object({ name: z.string().max(40), values: z.array(z.number()).min(1).max(24) }))
    .min(1)
    .max(6),
  showLegend: z.boolean().default(true),
  showValues: z.boolean().default(false),
  /** 覆盖主题图表色板 */
  colors: z.array(colorSchema).max(6).optional(),
})

export const tableElementSchema = z.object({
  ...elementBase,
  kind: z.literal('table'),
  ...boxSchema.shape,
  rows: z.array(z.array(z.string().max(200))).min(1).max(15),
  headerRow: z.boolean().default(true),
  fontSize: z.number().min(8).max(24).default(12),
  /** 列宽比例（和不必为 1，按比例分配） */
  colWidths: z.array(z.number().min(0.1)).max(12).optional(),
  zebra: z.boolean().default(true),
})

export const elementSchema = z.discriminatedUnion('kind', [
  textElementSchema,
  shapeElementSchema,
  imageElementSchema,
  chartElementSchema,
  tableElementSchema,
])
export type SceneElement = z.infer<typeof elementSchema>
export type TextElement = Extract<SceneElement, { kind: 'text' }>
export type ShapeElement = Extract<SceneElement, { kind: 'shape' }>
export type ImageElement = Extract<SceneElement, { kind: 'image' }>
export type ChartElement = Extract<SceneElement, { kind: 'chart' }>
export type TableElement = Extract<SceneElement, { kind: 'table' }>

// ---------------------------------------------------------------- 页面

export const pageSceneSchema = z
  .object({
    id: idSchema,
    sectionId: z.string().min(1).max(40),
    type: pageTypeSchema,
    /** 供大纲/日志阅读的页标题（不影响渲染） */
    title: z.string().max(80).optional(),
    background: z
      .object({
        color: colorSchema.optional(),
        gradient: gradientSchema.optional(),
      })
      .optional(),
    /**
     * 元素清单（native 路线）：绝对坐标的确定性版式，受全部 39 条规则保护。
     * 与 svg 二选一。
     */
    elements: z.array(elementSchema).min(1).max(24).optional(),
    /**
     * 整页 SVG 源码（svg 路线，0.10.0）：自由绘制（viewBox 固定 0 0 1280 720）。
     * HTML 预览内联原生渲染；PPTX 端以整页矢量图嵌入（PowerPoint 2016+ 显示，
     * 可右键"转换为形状"恢复部分可编辑性）。确定性版式规则（越界/互压/容量/密度）
     * 不适用于此形态——只做 SVG 安全面与色板校验。与 elements 二选一。
     */
    svg: z.string().min(20).max(300_000).optional(),
    /** 演讲者备注（两种路线都支持） */
    notes: z.string().max(2000).optional(),
  })
  .refine(p => (p.elements !== undefined) !== (p.svg !== undefined), '页面必须且只能提供 elements（native 路线）或 svg（svg 路线）之一')
export type PageScene = z.infer<typeof pageSceneSchema>

// ---------------------------------------------------------------- deck 状态文件

export const stageEnum = z.enum(['briefed', 'outlined', 'planned', 'drafted', 'locked', 'writing', 'rendered'])
export type DeckStage = z.infer<typeof stageEnum>

export const densityEnum = z.enum(['sparse', 'normal', 'dense'])
export type DeckDensity = z.infer<typeof densityEnum>

/**
 * 生成模式（0.9.1 完成解耦：只决定 confirmStages 预设，不再影响任何校验/分支）：
 * quick=无逐阶段确认（SOP 层打包一次方向确认）；standard=五阶段逐项（默认）；
 * precise=standard+Prototype 真实页关卡。证据严格度归 evidenceLevel，校验强度归 strictness。
 */
export const generationModeEnum = z.enum(['quick', 'standard', 'precise'])
export type GenerationMode = z.infer<typeof generationModeEnum>

/**
 * 证据等级：none=不要求来源；business=数字论断需有来源；
 * academic=fact/data 型论断全部需来源。内网环境来源只能来自用户提供的材料。
 */
export const evidenceLevelEnum = z.enum(['none', 'business', 'academic'])
export type EvidenceLevel = z.infer<typeof evidenceLevelEnum>

/**
 * 校验强度：strict=锁定令牌/证据类 warning 升级为 error（品牌/学术场景）；
 * normal=默认分级；relaxed=认知负荷类 warning 降为 info（草稿快速产出）。
 */
export const strictnessEnum = z.enum(['relaxed', 'normal', 'strict'])
export type Strictness = z.infer<typeof strictnessEnum>

/** 参考材料条目（0.8.1）：evidence.source 必须引用清单中的 id 或标题——让"内网来源=用户材料"可执行。 */
export const referenceMaterialSchema = z.object({
  id: idSchema,
  title: z.string().min(1).max(120),
  note: z.string().max(200).optional(),
})
export type ReferenceMaterial = z.infer<typeof referenceMaterialSchema>

/**
 * 渲染路线（0.10.0，用户在阶段 0 选择）：
 * native = pptxgenjs 原生元素（默认）——文本/形状/图表/表格逐元素可编辑，
 *          受全部确定性版式规则保护（越界/互压/容量/密度）；
 * svg = 自由 SVG 绘制——视觉自由度最高（任意路径/渐变/构图），HTML 预览原生内联，
 *          PPTX 端整页矢量图嵌入（PowerPoint 2016+，可"转换为形状"部分恢复可编辑），
 *          确定性版式规则不适用（只有 SVG 安全面与色板校验）。
 */
export const renderRouteEnum = z.enum(['native', 'svg'])
export type RenderRoute = z.infer<typeof renderRouteEnum>

/** 自定义确认点（0.8.1）：覆盖三档模式的默认闸门，SOP 按此生成分支。 */
export const confirmStageEnum = z.enum(['brief', 'outline', 'pageplan', 'blueprint', 'design', 'prototype'])
export type ConfirmStage = z.infer<typeof confirmStageEnum>

export const paletteOverridesSchema = z.object({
  bg: colorSchema.optional(),
  surface: colorSchema.optional(),
  primary: colorSchema.optional(),
  secondary: colorSchema.optional(),
  accent: colorSchema.optional(),
  text: colorSchema.optional(),
  textMuted: colorSchema.optional(),
  onPrimary: colorSchema.optional(),
})
export type PaletteOverrides = z.infer<typeof paletteOverridesSchema>

/** a 步：简报——主题 / 听众 / 场景 / 目标 / 时长 / 选定主题（创建 deck 时落盘）。 */
export const deckBriefSchema = z.object({
  deckId: idSchema,
  title: z.string().min(1).max(120),
  topic: z.string().min(1).max(600),
  /** 听众是谁（决定措辞与详略） */
  audience: z.string().min(1).max(120),
  /** 使用场景：场合 / 时长 / 目的（如"给中学生的 40 分钟科普课"） */
  scenario: z.string().min(1).max(200),
  /** 演讲目标：听众听完应该获得什么（同主题不同目标会导致完全不同的 deck） */
  objective: z.string().min(1).max(300),
  /** 预计时长（分钟）；同页数下时长越短密度越低 */
  durationMin: z.number().int().min(1).max(480).optional(),
  themeId: z.string().min(1).max(40),
  tone: z.string().max(80).optional(),
  density: densityEnum.default('normal'),
  /** 生成模式（quick/standard/precise，见 generationModeEnum；驱动 SOP 闸门数量） */
  mode: generationModeEnum.default('standard'),
  /** 渲染路线（0.10.0）：native=pptxgenjs 原生元素（默认）；svg=自由 SVG 绘制（PPTX 端整页矢量图嵌入） */
  renderRoute: renderRouteEnum.default('native'),
  /** 证据等级（none/business/academic；驱动 EVIDENCE_SOURCE_MISSING 校验严格度） */
  evidenceLevel: evidenceLevelEnum.default('none'),
  /** 校验强度（relaxed/normal/strict；strict 把令牌/证据类 warning 升为 error，relaxed 把认知负荷类降为 info） */
  strictness: strictnessEnum.default('normal'),
  /** 参考材料清单（可选）：提供后 evidence.source 必须引用其中条目（id 或标题），违规升级为 error */
  referenceMaterials: z.array(referenceMaterialSchema).max(20).optional(),
  /** 自定义确认点（可选）：覆盖三档模式的默认闸门组合 */
  confirmStages: z.array(confirmStageEnum).max(6).optional(),
  paletteOverrides: paletteOverridesSchema.optional(),
  confirmedAt: z.string(),
})
export type DeckBrief = z.infer<typeof deckBriefSchema>

/** b 步：Deck Architecture 的部分条目——叙事驱动（问题 → 回答），不只是目录。 */
export const outlinePartSchema = z.object({
  id: z.string().regex(/^s\d{1,2}$/),
  title: z.string().min(1).max(60),
  /** 本部分回答的关键问题（叙事钩子，如「机器为什么能够学习？」） */
  question: z.string().min(1).max(120),
  /** 本部分要传达的核心信息（一句话答案） */
  message: z.string().min(1).max(200),
  /** 建议页数（仅提示，不强制） */
  suggestedPages: z.number().int().min(1).max(20).optional(),
})
export type OutlinePart = z.infer<typeof outlinePartSchema>

export const visualPlanEnum = z.enum(['image', 'chart', 'none'])
export type VisualPlan = z.infer<typeof visualPlanEnum>

/** 页面信息结构：这一页的逻辑关系类型（Blueprint 层，驱动页型选择）。 */
export const INFO_STRUCTURES = [
  'plain',
  'timeline',
  'comparison',
  'process',
  'hierarchy',
  'cause-effect',
  'problem-solution',
  'before-after',
  'concept-example',
  'data-insight',
] as const
export const infoStructureEnum = z.enum(INFO_STRUCTURES)
export type InfoStructure = z.infer<typeof infoStructureEnum>

/** 页级密度意图（Blueprint 层；与全册 density 独立）。 */
export const pageDensityEnum = z.enum(['low', 'medium', 'high'])
export type PageDensity = z.infer<typeof pageDensityEnum>

/**
 * 叙事衔接（Blueprint 层）：PPT 是连续叙事，不是孤立页集合。
 * fromPrevious=承接上一页（回答上一页留下的钩子）；nextHook=给下一页埋的钩子。
 */
export const transitionSchema = z.object({
  fromPrevious: z.string().max(160).optional(),
  nextHook: z.string().max(160).optional(),
})
export type PageTransition = z.infer<typeof transitionSchema>

/** 页级证据条目（Evidence 层）：claim 的来源在内网环境只能来自用户提供的材料。 */
export const evidenceItemSchema = z.object({
  /** 论断原文（如「全球 AI 市场规模 1.8 万亿美元」） */
  claim: z.string().min(1).max(200),
  type: z.enum(['fact', 'data', 'example', 'quote']),
  /** 来源（用户材料/内部报告；无法核实时应改定性表述或标「数据待补充」） */
  source: z.string().max(200).optional(),
  /** 精确引用（0.9.1）：简报 referenceMaterials 清单条目的 id——校验按 id 精确匹配，优先于 source 的子串匹配 */
  materialId: idSchema.optional(),
  /** 定位（如「第 12 页，表 2」）：让"材料里的哪一处"可追溯，属引用完整性的一部分 */
  locator: z.string().max(120).optional(),
})
export type EvidenceItem = z.infer<typeof evidenceItemSchema>

/** 页级条目：d 步由各部分 Page Blueprint 合成进 outline.json 的 pages。 */
export const outlinePageSchema = z.object({
  id: idSchema,
  /** s0 = 结构页（封面/目录/结尾）；s1..sn = 对应部分 */
  sectionId: z.string().regex(/^s\d{1,2}$/),
  type: pageTypeSchema,
  title: z.string().min(1).max(80),
  /** 内容概要（真实会话教训：300 上限让长概要反复被拒，放宽到 500） */
  contentBrief: z.string().min(1).max(500),
  /** 这页为什么存在（一页回答一个具体问题） */
  purpose: z.string().max(200).optional(),
  /** 这页的一句话核心信息 */
  keyMessage: z.string().max(200).optional(),
  /** 信息结构（逻辑关系类型，与页型的匹配由校验器提醒） */
  structure: infoStructureEnum.default('plain'),
  /** 页级密度意图 */
  density: pageDensityEnum.default('medium'),
  /** 配图计划：image=实图/占位，chart=图表，none=纯文字（写页时校验落实） */
  visual: visualPlanEnum.default('none'),
  /** 叙事衔接：承接上一页 + 埋给下一页的钩子（strictness=strict 时缺失升 warning；其余档链部分建立时缺口提示 info——warning 不是硬约束） */
  transition: transitionSchema.optional(),
  /** 证据条目：本页的关键论断与来源（evidenceLevel≥business 时被校验） */
  evidence: z.array(evidenceItemSchema).max(8).optional(),
  /**
   * 页级预算豁免（0.8.2）：写明 reason 允许该页突破全册密度/要点预算
   * （如"总结页需罗列全部要点"）——校验降为 info 知情放行，不是静默绕过。
   */
  densityOverride: z.object({ reason: z.string().min(1).max(120) }).optional(),
})
export type OutlinePage = z.infer<typeof outlinePageSchema>

/**
 * b 步写入 parts + coreMessage（pages 为空）；d 步逐部分把 Page Blueprint 合并进 pages。
 * 同一文件两阶段填充，避免了第二份"部分级大纲"中间产物。
 */
export const deckOutlineSchema = z.object({
  parts: z.array(outlinePartSchema).min(2).max(12),
  /** 全 deck 核心主张：一句话讲清这套 PPT 的故事 */
  coreMessage: z.string().min(1).max(200),
  pages: z.array(outlinePageSchema).max(63).default([]),
  confirmedAt: z.string().optional(),
})
export type DeckOutline = z.infer<typeof deckOutlineSchema>

/** d 步：单部分草稿快照（sections/<sid>.json）。 */
export const sectionDraftSchema = z.object({
  sectionId: z.string().regex(/^s\d{1,2}$/),
  pages: z.array(outlinePageSchema).min(1).max(20),
  confirmedAt: z.string().optional(),
})
export type SectionDraft = z.infer<typeof sectionDraftSchema>

/** c 步：页数计划。用户确认的是内容页数，结构页（封面/目录/结尾）自动附加。 */
export const deckPlanSchema = z.object({
  contentPages: z.number().int().min(2).max(60),
  structuralPages: z.number().int().min(3).max(3),
  totalPages: z.number().int(),
  /** 用户确认的各部分页数分配（Σ必须等于 contentPages 且覆盖全部部分；空=未确认分配） */
  allocation: z
    .array(
      z.object({
        sectionId: z.string().regex(/^s\d{1,2}$/),
        pages: z.number().int().min(1),
        /** 分配理由（模型给出，展示给用户，便于接受或调整） */
        reason: z.string().max(120).optional(),
      }),
    )
    .default([]),
  confirmedAt: z.string(),
})
export type DeckPlan = z.infer<typeof deckPlanSchema>

/** 8 色板（主题 + paletteOverrides 解析后的最终形态）。 */
export const themeColorsSchema = z.object({
  bg: colorSchema,
  surface: colorSchema,
  primary: colorSchema,
  secondary: colorSchema,
  accent: colorSchema,
  text: colorSchema,
  textMuted: colorSchema,
  onPrimary: colorSchema,
})
export type ThemeColors = z.infer<typeof themeColorsSchema>

/**
 * e-1 步产出的「全 deck 锁定」令牌（design/tokens.json）。
 * 渲染器与写页校验器共同消费：改页只能用这里的颜色/字体，锚点与栅格从这里读。
 */
export const designTokensSchema = z.object({
  themeId: z.string().min(1).max(40),
  colors: themeColorsSchema,
  chartColors: z.array(colorSchema).min(4).max(6),
  fonts: z.object({ title: z.string().min(1).max(60), body: z.string().min(1).max(60) }),
  /** 字号阶梯（磅） */
  fontSizeLadder: z.object({
    coverTitle: z.number().min(24).max(60),
    sectionTitle: z.number().min(22).max(48),
    pageTitle: z.number().min(20).max(40),
    body: z.number().min(12).max(24),
    note: z.number().min(9).max(14),
  }),
  /** 内容页标题锚点（英寸）：标题框位置与标题下主色短横条 */
  anchors: z.object({
    titleX: z.number().min(0).max(2),
    titleY: z.number().min(0).max(2),
    titleW: z.number().min(4).max(13),
    titleBarW: z.number().min(0.3).max(3),
    titleBarH: z.number().min(0.02).max(0.2),
  }),
  /** 栅格（英寸） */
  grid: z.object({
    marginX: z.number().min(0.3).max(1.5),
    contentTop: z.number().min(1).max(3),
    contentBottom: z.number().min(5).max(7.4),
    canvasW: z.number(),
    canvasH: z.number(),
  }),
  lockedAt: z.string(),
})
export type DesignTokens = z.infer<typeof designTokensSchema>

/** e-1 步产出的「完整设计规范」（design/spec.json，主要给模型读）。 */
export const designSpecSchema = z.object({
  deckId: idSchema,
  density: densityEnum,
  /** 各部分页数分配（来自已确认的草稿） */
  pageAllocation: z
    .array(
      z.object({
        sectionId: z.string().regex(/^s\d{1,2}$/),
        title: z.string().min(1).max(60),
        pages: z.number().int().min(1),
      }),
    )
    .min(2),
  /** 密度策略：有主视觉页收紧文字预算，无图页放宽 */
  densityPolicy: z.object({
    withVisualCharBudget: z.number().int().min(60).max(600),
    plainCharBudget: z.number().int().min(60).max(1200),
    bulletsMax: z.number().int().min(3).max(8),
  }),
  /** 设计说明（给模型读的用色/密度纪律摘要） */
  notes: z.array(z.string().max(300)).max(12).default([]),
  /**
   * Prototype 页建议（页 ID，≤3 个）：锁定设计时按结构聚类 + 风险加权挑的代表页。
   * confirmStages 含 prototype 时：先写完这些页 → ppt_preview_update 让用户确认真实视觉效果 → 再继续（强制关卡）；
   * 其余有确认关卡的会话：建议先写这些页看真实效果（可跳过）；
   * confirmStages 为空（quick 语义：无逐阶段确认）跳过（无此字段）。
   * 重排迁移时随页 ID 重映射对齐（0.9.1）。
   */
  prototypePages: z.array(z.string()).max(3).optional(),
  lockedAt: z.string(),
})
export type DesignSpec = z.infer<typeof designSpecSchema>

export const deckStateSchema = z.object({
  deckId: idSchema,
  title: z.string().min(1).max(120),
  stage: stageEnum.default('briefed'),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** 已写好的页面（pages/*.json 存在且通过 error 级校验） */
  pagesWritten: z.array(idSchema).default([]),
  /** 最近一次全册校验指纹（ppt_scene_check 产出，渲染前必须匹配） */
  sceneHash: z.string().optional(),
  /** 各页内容指纹（依赖感知修改循环：未变化的页免于重复细检，只重查变更页） */
  pageHashes: z.record(z.string()).default({}),
  renderedAt: z.string().optional(),
  /** 预览自动打开标记（previewAutoOpen=once 模式：每个 deck 只自动弹第一次浏览器） */
  /** 预览自动打开标记（once 模式，按阶段分别记一次）：previewOpenedAt=即时预览首开、renderOpenedAt=正式渲染首开 */
  previewOpenedAt: z.string().optional(),
  renderOpenedAt: z.string().optional(),
  /** 最近一次全册校验时的大纲指纹（0.9.0：transition/页序等关系型变更检测——改大纲后 check 返回 outlineChanged，提示重读全量叙事链而非只看变更页） */
  outlineHash: z.string().optional(),
  /** 最近一次页 ID 重排迁移（0.8.1：排查用——迁移了哪些文件、清除了哪些页、何时） */
  lastMigration: z
    .object({
      renumbered: z.array(z.object({ from: z.string(), to: z.string() })),
      invalidated: z.array(z.string()),
      at: z.string(),
    })
    .optional(),
  /** 内容过期：有页变更但尚未 ppt_scene_check（deck_status 直观提示"需重新校验"） */
  contentOutdated: z.boolean().optional(),
  /** 渲染过期：已校验（或已渲染后内容又变更）但尚未 ppt_deck_render（提示"需重新渲染"） */
  renderOutdated: z.boolean().optional(),
  /** 架构修订标记（outline_draft revise:true 原地改故事的时间；修订后必须重走 2-5） */
  architectureRevisedAt: z.string().optional(),
  /** 生成暂停标记（ppt_deck_pause 设置；暂停期间 ppt_page_write 拒绝写入） */
  paused: z.boolean().optional(),
  /** 分支来源（ppt_deck_branch 快照复制自哪个 deck） */
  parentDeckId: idSchema.optional(),
})
export type DeckState = z.infer<typeof deckStateSchema>

// ---------------------------------------------------------------- 资产

export const assetManifestSchema = z.object({
  assets: z
    .array(
      z.object({
        assetId: idSchema,
        file: z.string().min(1).max(200),
        originalPath: z.string().max(600).optional(),
        source: z.enum(['local', 'generated', 'generated-api']).default('local'),
        mime: z.string().min(3).max(60),
        sha256: z.string().length(64),
        bytes: z.number().int().min(1),
        width: z.number().int().min(1).optional(),
        height: z.number().int().min(1).optional(),
        registeredAt: z.string(),
      }),
    )
    .default([]),
})
export type AssetManifest = z.infer<typeof assetManifestSchema>
export type AssetEntry = AssetManifest['assets'][number]

// ---------------------------------------------------------------- 校验结果

export const ISSUE_LEVELS = ['error', 'warning', 'info'] as const
export const issueLevelSchema = z.enum(ISSUE_LEVELS)
export type IssueLevel = z.infer<typeof issueLevelSchema>

export interface ValidationIssue {
  level: IssueLevel
  rule: string
  message: string
  pageId?: string
  elementId?: string
  /** 0.8.1：该问题是否可由模型确定性修复（改坐标/字号/颜色/删减文字类） */
  fixable?: boolean
  /** 0.8.1：修复建议（给模型的直接指引，如"扩高文本框或精简文字 20%"） */
  suggestedFix?: string
}

export interface PageValidationResult {
  pageId: string
  ok: boolean
  errorCount: number
  warningCount: number
  issues: ValidationIssue[]
}
