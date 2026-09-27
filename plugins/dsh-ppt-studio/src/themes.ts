/**
 * 内置视觉主题（12 套）。
 *
 * 主题只携带「颜色 / 字体 / 图表色板 / 封面渐变」四类确定性信息，
 * 版式规则（每种页型的区块划分）见 skills/dsh-ppt-studio/reference/layouts.md。
 * 颜色统一 '#RRGGBB'；深浅色主题均可在浅色背景上直接使用。
 */
import { CANVAS_H_IN, CANVAS_W_IN } from './units.js'
import type { DeckDensity, DesignTokens, PaletteOverrides, TextureConfig, TintScale } from './schema.js'

export interface ThemeColors {
  /** 页面底色 */
  bg: string
  /** 卡片 / 面板底色 */
  surface: string
  /** 主色：标题条、强调块、图表第一色 */
  primary: string
  /** 辅助色：次级强调、图表第二色 */
  secondary: string
  /** 点缀色：少量高亮、数字标注 */
  accent: string
  /** 正文文字色 */
  text: string
  /** 弱化文字色：副标题、注释 */
  textMuted: string
  /** 主色之上的文字色（用于主色块内） */
  onPrimary: string
}

/** 主题类型分类（智能推荐：ppt_themes 按 topicType 把同类排前并标推荐）。 */
export const THEME_CATEGORIES = ['tech', 'business', 'education', 'gov', 'culture', 'event'] as const
export type ThemeCategory = (typeof THEME_CATEGORIES)[number]

export const THEME_CATEGORY_LABELS: Record<ThemeCategory, string> = {
  tech: '科技',
  business: '商业',
  education: '教育',
  gov: '政务',
  culture: '文化',
  event: '活动',
}

export interface Theme {
  id: string
  name: string
  mood: string
  bestFor: string
  /** 主题类型分类：模型从简报判断主题类型后，ppt_themes(topicType) 据此推荐 */
  category: ThemeCategory
  dark: boolean
  colors: ThemeColors
  chartColors: string[]
  /** 封面 / 章节页背景渐变（HTML 渐变渲染；PPTX 端回退为 from 色并记录日志） */
  heroGradient: { from: string; to: string; angle: number }
  /**
   * 结构页渐变端点（0.19.0，可选——深色锚封面主题定义）。
   * 未定义时结构页渐变 = primary→secondary 派生（10 套浅色主题即此模式）。
   * tech-dark / navy-gold 用：内容页 primary 是亮色（霓虹青/香槟金），封面若同色满幅
   * 会刺眼（视觉评估：tech-dark 亮蓝紫封面"像默认模板"、navy-gold 满幅金"土豪金"），
   * 封面改深色锚双色渐变 + 浅色文字，亮色退回内容页点缀。
   */
  structuralGradient?: { from: string; to: string; angle: number }
  fonts: { title: string; body: string }
}

export const THEMES: Theme[] = [
  {
    // 0.19.0 重制（roadmap T3-1，2026 趋势：冷调纸底 + 深墨蓝锚色 + 波斯橘点缀，60-30-10）：
    // primary 加深为墨蓝、secondary 收敛为天青，二者构成封面双色渐变；accent 由黄橙改波斯橘（更克制）
    id: 'business-blue',
    category: 'business',
    name: '墨蓝商务',
    mood: '墨蓝沉稳、天青透气、专业可信',
    bestFor: '工作汇报、项目总结、对上汇报、评审答辩',
    dark: false,
    colors: {
      bg: '#F2F5F9',
      surface: '#FFFFFF',
      primary: '#173A66',
      secondary: '#3E7CB1',
      accent: '#E07A3F',
      text: '#1C2836',
      textMuted: '#5D6B7C',
      onPrimary: '#FFFFFF',
    },
    chartColors: ['#173A66', '#3E7CB1', '#7FA9D9', '#E07A3F', '#94A3B8', '#2C6E63'],
    heroGradient: { from: '#173A66', to: '#3E7CB1', angle: 135 },
    fonts: { title: 'Microsoft YaHei', body: 'Microsoft YaHei' },
  },
  {
    // 0.19.0 重制：内容页霓虹青→堇紫（底维持 0.17.1 中暗蓝灰）；封面深空锚渐变+浅字
    // （满幅亮青紫在视觉评估被判"像默认模板"）——structuralGradient 承载
    id: 'tech-dark',
    category: 'tech',
    name: '深空霓虹',
    mood: '霓虹双色、现代锐利、技术感强',
    bestFor: '技术方案、产品发布、架构宣讲、开发者分享',
    dark: true,
    colors: {
      bg: '#182236',
      surface: '#243248',
      primary: '#1FB4E6',
      secondary: '#8B7CF6',
      accent: '#5EEAD4',
      text: '#EDF2FA',
      textMuted: '#8FA0B8',
      onPrimary: '#08131F',
    },
    chartColors: ['#1FB4E6', '#8B7CF6', '#5EEAD4', '#FBBF24', '#F472B6', '#60A5FA'],
    heroGradient: { from: '#0D1B33', to: '#2E2766', angle: 135 },
    structuralGradient: { from: '#0D1B33', to: '#2E2766', angle: 135 },
    fonts: { title: 'Microsoft YaHei', body: 'Microsoft YaHei' },
  },
  {
    // 0.19.0 重制：朱砂→绛红封面渐变（旧版平涂红），金点缀保留
    id: 'gov-red',
    category: 'gov',
    name: '朱砂映金',
    mood: '朱砂庄重、绛红压场、金色点睛',
    bestFor: '党政机关汇报、主题教育、精神文明宣传',
    dark: false,
    colors: {
      bg: '#FBF6ED',
      surface: '#FFFFFF',
      primary: '#A62B2B',
      secondary: '#7E1F24',
      accent: '#C9A227',
      text: '#2E2924',
      textMuted: '#7C7368',
      onPrimary: '#FFFFFF',
    },
    chartColors: ['#A62B2B', '#C9A227', '#BC5A34', '#8C6D46', '#94A3B8', '#5F7470'],
    heroGradient: { from: '#A62B2B', to: '#7E1F24', angle: 135 },
    // 0.20.0（T3-2）文化类主题标题衬线：政务风标题宋体（目标机器缺失时 HTML/PPT 均回退雅黑，无害）
    fonts: { title: 'SimSun', body: 'Microsoft YaHei' },
  },
  {
    // 0.19.0 重制：石板蓝→暗青渐变，纸感底更暖
    id: 'academic-plain',
    category: 'education',
    name: '霁青纸本',
    mood: '霁青内敛、纸本质感、论证优先',
    bestFor: '学术报告、课程讲义、研究综述、毕业答辩',
    dark: false,
    colors: {
      bg: '#FAFAF6',
      surface: '#FFFFFF',
      primary: '#2E5D7D',
      secondary: '#46748F',
      accent: '#D9A441',
      text: '#2B3440',
      textMuted: '#6E7B8A',
      onPrimary: '#FFFFFF',
    },
    chartColors: ['#2E5D7D', '#46748F', '#D9A441', '#40566B', '#A5C9E1', '#8D99AE'],
    heroGradient: { from: '#2E5D7D', to: '#46748F', angle: 135 },
    fonts: { title: 'Microsoft YaHei', body: 'Microsoft YaHei' },
  },
  {
    // 0.19.0 重制：碧玉（jade，2026 趋势色）→深祖母绿渐变，底色更粉感
    id: 'fresh-teal',
    category: 'education',
    name: '碧玉青',
    mood: '碧玉清新、薄荷透气、有生气',
    bestFor: '培训宣讲、团队建设、公益科普、活动介绍',
    dark: false,
    colors: {
      bg: '#EFF7F2',
      surface: '#FFFFFF',
      primary: '#0D7A68',
      secondary: '#1E8F7E',
      accent: '#EFA94A',
      text: '#1C3830',
      textMuted: '#5F7A72',
      onPrimary: '#FFFFFF',
    },
    chartColors: ['#0D7A68', '#1E8F7E', '#EFA94A', '#3D7EA6', '#9CBF6E', '#776871'],
    heroGradient: { from: '#0D7A68', to: '#1E8F7E', angle: 135 },
    fonts: { title: 'Microsoft YaHei', body: 'Microsoft YaHei' },
  },
  {
    // 0.19.0 重制：珊瑚陶土→暮浆果双色渐变（sunset duotone），点缀堇紫
    id: 'warm-sunset',
    category: 'culture',
    name: '珊瑚暮色',
    mood: '珊瑚温暖、浆果深沉、有人情味',
    bestFor: '文化宣传、品牌故事、年度回顾、致谢场合',
    dark: false,
    colors: {
      bg: '#FDF6EF',
      surface: '#FFFFFF',
      primary: '#C75B39',
      secondary: '#8A4A63',
      accent: '#E89A5B',
      text: '#3A2E28',
      textMuted: '#8A7A6D',
      onPrimary: '#FFFFFF',
    },
    chartColors: ['#C75B39', '#8A4A63', '#E89A5B', '#5B8C5A', '#98B4D4', '#C15B5B'],
    heroGradient: { from: '#C75B39', to: '#8A4A63', angle: 135 },
    // 0.20.0（T3-2）文化类主题标题衬线：文化叙事标题宋体
    fonts: { title: 'SimSun', body: 'Microsoft YaHei' },
  },
  {
    // 0.19.0 微调：近黑锚色稍偏蓝调，红点缀保持
    id: 'mono-editorial',
    category: 'business',
    name: '黑白画册',
    mood: '黑白灰克制、编辑排版感',
    bestFor: '设计提案、发布会开场、作品集展示、观点陈述',
    dark: false,
    colors: {
      bg: '#FAFAFA',
      surface: '#FFFFFF',
      primary: '#14161A',
      secondary: '#3F444C',
      accent: '#E63946',
      text: '#1A1A1A',
      textMuted: '#8A8A8A',
      onPrimary: '#FFFFFF',
    },
    chartColors: ['#14161A', '#E63946', '#8C8C8C', '#525252', '#BFBFBF', '#D9D9D9'],
    heroGradient: { from: '#14161A', to: '#3F444C', angle: 135 },
    fonts: { title: 'Microsoft YaHei', body: 'Microsoft YaHei' },
  },
  {
    // 0.19.0 重制：靛→堇紫极光双色（Linear/Stripe 气质），primary 压深一档
    id: 'indigo-gradient',
    category: 'tech',
    name: '靛紫极光',
    mood: '靛堇双色、极光流动、科技不压抑',
    bestFor: '产品发布、技术布道、创新提案、AI 主题分享',
    dark: false,
    colors: {
      bg: '#F4F5FD',
      surface: '#FFFFFF',
      primary: '#4438D6',
      secondary: '#7C3AED',
      accent: '#F59E0B',
      text: '#201B4D',
      textMuted: '#6D6A8A',
      onPrimary: '#FFFFFF',
    },
    chartColors: ['#4438D6', '#7C3AED', '#06B6D4', '#F59E0B', '#EC4899', '#6366F1'],
    heroGradient: { from: '#4438D6', to: '#7C3AED', angle: 135 },
    fonts: { title: 'Microsoft YaHei', body: 'Microsoft YaHei' },
  },
  {
    // 0.19.0 重制：可可→焦糖双色渐变，奶油底更黄感
    id: 'cream-notes',
    category: 'education',
    name: '奶油手账',
    mood: '奶油底暖棕、亲和手作感',
    bestFor: '教学讲义、读书分享、轻量科普、社群活动',
    dark: false,
    colors: {
      bg: '#FBF5E9',
      surface: '#FFFCF4',
      primary: '#8F6136',
      secondary: '#B0824E',
      accent: '#6E8B5E',
      text: '#3A3022',
      textMuted: '#8C7F6E',
      onPrimary: '#FFFCF4',
    },
    chartColors: ['#8F6136', '#B0824E', '#6E8B5E', '#B0563F', '#D9B67E', '#8A8F6C'],
    heroGradient: { from: '#8F6136', to: '#B0824E', angle: 135 },
    // 0.20.0（T3-2）文化类主题标题衬线：手账主题标题楷体（family 名必须用 KaiTi——
    // SimKai 是 WinXP 时代别名，Win7+ 的 CSS/PPT 字体匹配不认，视觉评估实测静默回退雅黑）
    fonts: { title: 'KaiTi', body: 'Microsoft YaHei' },
  },
  {
    // 0.19.0 重制：深林绿→冷杉渐变，底色更纸感
    id: 'forest-ink',
    category: 'education',
    name: '深林墨绿',
    mood: '深林沉稳、书卷气',
    bestFor: '学术答辩、研究汇报、环保与生命科学主题',
    dark: false,
    colors: {
      bg: '#F3F7F4',
      surface: '#FFFFFF',
      primary: '#1B4A38',
      secondary: '#2F6B4F',
      accent: '#C9A227',
      text: '#202D27',
      textMuted: '#67766E',
      onPrimary: '#FFFFFF',
    },
    chartColors: ['#1B4A38', '#2F6B4F', '#C9A227', '#2F4858', '#8FAF9B', '#5F7470'],
    heroGradient: { from: '#1B4A38', to: '#2F6B4F', angle: 135 },
    fonts: { title: 'Microsoft YaHei', body: 'Microsoft YaHei' },
  },
  {
    // 0.19.0 重制：内容页香槟金主色；封面午夜藏蓝锚渐变+浅字（满幅金视觉评估被判"土豪金"），
    // 金退为点缀（章序号/图表/封面右上圆）——structuralGradient 承载
    id: 'navy-gold',
    category: 'event',
    name: '午夜鎏金',
    mood: '藏蓝压场、香槟流金、高端',
    bestFor: '年度盛典、对外答谢、高层战略汇报、颁奖典礼',
    dark: true,
    colors: {
      bg: '#152540',
      surface: '#1F3350',
      primary: '#D9B56A',
      secondary: '#5B8BBE',
      accent: '#E5CD8F',
      text: '#F2F0E9',
      textMuted: '#9AA5B1',
      onPrimary: '#14243A',
    },
    chartColors: ['#D9B56A', '#5B8BBE', '#E5CD8F', '#7BA7C9', '#94A3B8', '#3E5F7E'],
    heroGradient: { from: '#101F38', to: '#2B4066', angle: 135 },
    structuralGradient: { from: '#101F38', to: '#2B4066', angle: 135 },
    fonts: { title: 'Microsoft YaHei', body: 'Microsoft YaHei' },
  },
  {
    // 0.19.0 重制：石墨→青灰渐变，信号橙压深一档
    id: 'slate-orange',
    category: 'business',
    name: '石墨信号橙',
    mood: '石墨冷静、橙色警示感强',
    bestFor: '制造与工程汇报、安全生产、生产运营看板',
    dark: false,
    colors: {
      bg: '#F2F3F4',
      surface: '#FFFFFF',
      primary: '#333F48',
      secondary: '#56656E',
      accent: '#E8590C',
      text: '#232D33',
      textMuted: '#78909C',
      onPrimary: '#FFFFFF',
    },
    chartColors: ['#E8590C', '#333F48', '#56656E', '#FF8A65', '#90A4AE', '#6D4C41'],
    heroGradient: { from: '#2B353D', to: '#4C5B64', angle: 135 },
    fonts: { title: 'Microsoft YaHei', body: 'Microsoft YaHei' },
  },
]

/**
 * 结构页（封面/章节/结尾）双色渐变（0.19.0，roadmap T3-1）：由渲染器注入
 * （HTML=CSS 渐变，PPTX=光栅化 PNG 垫底）——与纹理同一管线思路，sceneHash 不受影响、
 * 旧 deck 重渲染即得、paletteOverrides 自动跟随。取代 0.15.0 的"弃用渐变改纯色"取舍：
 * 当时纯色是 PPTX 端唯一能双端一致的选择，0.17.2 光栅化落地后渐变也能双端一致了。
 * 深色锚主题（tokens/主题带 structuralGradient）用它；其余回退 primary→secondary 派生。
 */
export function structuralGradient(source: { colors: ThemeColors; structuralGradient?: { from: string; to: string; angle: number } }): { from: string; to: string; angle: number } {
  return source.structuralGradient ?? { from: source.colors.primary, to: source.colors.secondary, angle: 135 }
}

/**
 * 结构页文字/点缀色：渐变两端较亮端仍深于阈值 → 白字，否则沿用 onPrimary。
 * 以"较亮端"判定保证白字对两端都 ≥3:1（封面标题 40pt 粗体的大文本标准）；
 * 浅色主题两端皆深、onPrimary 本就是白，派生结果与主题定义一致——不引入新自由度。
 */
export function structuralTextColor(source: { colors: ThemeColors; structuralGradient?: { from: string; to: string; angle: number } }): string {
  const g = structuralGradient(source)
  const brighterEnd = Math.max(relativeLuminance(g.from), relativeLuminance(g.to))
  return brighterEnd < 0.22 ? '#FFFFFF' : source.colors.onPrimary
}

export function getTheme(id: string): Theme | undefined {
  return THEMES.find(theme => theme.id === id)
}

/**
 * 主题 → 背景纹样（0.18.0 T2-2）：确定性分配——同为"零素材增加质感"，但气质分野：
 * 点阵=克制理性（商务/学术）、斜线=动势科技、窗棂=文气/庄重（政务/文化/手账）。
 * design_lock 的 texture 参数可覆盖（none 关闭）。
 */
const THEME_TEXTURE: Record<string, 'dots' | 'diagonal' | 'lattice' | 'none'> = {
  'business-blue': 'dots',
  'tech-dark': 'diagonal',
  'gov-red': 'lattice',
  'academic-plain': 'dots',
  'fresh-teal': 'diagonal',
  'warm-sunset': 'dots',
  'mono-editorial': 'diagonal',
  'indigo-gradient': 'diagonal',
  'cream-notes': 'lattice',
  'forest-ink': 'lattice',
  'navy-gold': 'lattice',
  'slate-orange': 'diagonal',
}

export function themeTextureKind(themeId: string): 'dots' | 'diagonal' | 'lattice' | 'none' {
  return THEME_TEXTURE[themeId] ?? 'dots'
}

/**
 * 从已解析的色阶计算纹理令牌：浅色底用 primary-300（混入 48% 基色）、深色底用
 * primary-600（向白锚靠拢）。深底上浅纹样的"存在感衰减"更快（视觉评估：0.32 的
 * 斜纹在深底几乎不可感知），透明度按明暗分档补偿。
 */
export function textureFromTints(tints: DesignTokens['tints'], bg: string): TextureConfig | undefined {
  if (tints === undefined) return undefined
  const light = relativeLuminance(bg) > 0.4
  return {
    kind: 'dots',
    color: light ? tints.primary['300'] : tints.primary['600'],
    opacity: light ? 0.42 : 0.38,
  }
}

export function themeSummaries(): Array<Pick<Theme, 'id' | 'name' | 'mood' | 'bestFor' | 'category' | 'dark'>> {
  return THEMES.map(({ id, name, mood, bestFor, category, dark }) => ({ id, name, mood, bestFor, category, dark }))
}

/** 应用 paletteOverrides 后返回实际生效的色板（未覆盖字段沿用主题默认）。 */
export function resolveThemeColors(theme: Theme, overrides?: Partial<ThemeColors>): ThemeColors {
  return { ...theme.colors, ...(overrides ?? {}) }
}

/** 渲染器实际消费的主题（已合并 paletteOverrides）。 */
export interface ResolvedTheme {
  colors: ThemeColors
  chartColors: string[]
  fonts: { title: string; body: string }
  /** 背景纹理（0.18.0，可选——来自 tokens.texture；渲染器注入整页底纹） */
  texture?: TextureConfig
  /** 结构页渐变端点（0.19.0，可选——来自 tokens.structuralGradient；渲染器注入封面/章节/结尾底色） */
  structuralGradient?: { from: string; to: string; angle: number }
}

export function resolveDesignTheme(theme: Theme, paletteOverrides?: Partial<ThemeColors>): ResolvedTheme {
  const colors = resolveThemeColors(theme, paletteOverrides)
  const chartColors = [colors.primary, colors.secondary, ...theme.chartColors.filter(c => c !== colors.primary && c !== colors.secondary)]
  return {
    colors,
    chartColors: [...new Set(chartColors)].slice(0, 6),
    fonts: theme.fonts,
    ...(theme.structuralGradient !== undefined ? { structuralGradient: theme.structuralGradient } : {}),
  }
}

// ---------------------------------------------------------------- 色阶（0.15.0）

/** RGB 线性混色：t=0 返回 base，t=1 返回 other（t 可为小数；输出大写 #RRGGBB）。 */
function mixHex(base: string, other: string, t: number): string {
  const ch = (i: number): number => parseInt(base.slice(i, i + 2), 16)
  const oh = (i: number): number => parseInt(other.slice(i, i + 2), 16)
  const mix = (i: number): string =>
    Math.round(ch(i) + (oh(i) - ch(i)) * t)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase()
  return `#${mix(1)}${mix(3)}${mix(5)}`
}

/** WCAG 相对亮度（0-1）：深浅主题共用同一判定。 */
export function relativeLuminance(hex: string): number {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const lin = (v: number): number => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
}

/** 浅档（向 bg 方向渐浅）与深档（向 bg 反方向加深）的混合系数。 */
const TINT_FACTORS: Record<'50' | '100' | '200' | '300' | '400', number> = { '50': 0.94, '100': 0.86, '200': 0.68, '300': 0.48, '400': 0.25 }
const SHADE_FACTORS: Record<'600' | '700' | '800' | '900', number> = { '600': 0.2, '700': 0.4, '800': 0.6, '900': 0.78 }

/**
 * 从基色 + 页面底色计算色阶（确定性、无人工调色）：
 * 浅色主题向白/深色主题向黑的方向由 bg 亮度决定——深浅主题同一套语义
 * （50=接近底色的柔和底、900=比基色更深的强调），版式引擎可按档位取用而无需感知明暗。
 */
export function buildTintScale(base: string, bg: string): TintScale {
  const shadeAnchor = relativeLuminance(bg) > 0.4 ? '#000000' : '#FFFFFF'
  const out = {} as Record<keyof TintScale, string>
  for (const [step, factor] of Object.entries(TINT_FACTORS)) {
    out[step as keyof TintScale] = mixHex(base, bg, factor)
  }
  for (const [step, factor] of Object.entries(SHADE_FACTORS)) {
    out[step as keyof TintScale] = mixHex(base, shadeAnchor, factor)
  }
  return out as TintScale
}

// ---------------------------------------------------------------- 设计令牌（e-1 步锁定）

/** 密度 → 字号阶梯（磅）。与 reference/layouts.md 的字号体系一致。 */
const FONT_LADDERS: Record<DeckDensity, DesignTokens['fontSizeLadder']> = {
  sparse: { coverTitle: 44, sectionTitle: 34, pageTitle: 28, body: 17, note: 12 },
  normal: { coverTitle: 40, sectionTitle: 32, pageTitle: 26, body: 16, note: 11 },
  dense: { coverTitle: 38, sectionTitle: 30, pageTitle: 24, body: 14, note: 10 },
}

/** 内容页标题锚点与栅格（英寸）。写页与校验共用同一坐标基准。 */
export const TITLE_ANCHOR = { titleX: 0.6, titleY: 0.45, titleW: 12.13, titleBarW: 0.9, titleBarH: 0.06 } as const
export const PAGE_GRID = { marginX: 0.6, contentTop: 1.6, contentBottom: 7.0 } as const

/**
 * 把「主题 + paletteOverrides + 密度」固化为全 deck 锁定的设计令牌。
 * ppt_design_lock 落盘；渲染器与写页校验器只认这份令牌，不再运行时解析。
 */
export function buildDesignTokens(
  theme: Theme,
  options: { density?: DeckDensity; paletteOverrides?: PaletteOverrides } = {},
): DesignTokens {
  const resolved = resolveDesignTheme(theme, options.paletteOverrides)
  const tints = {
    primary: buildTintScale(resolved.colors.primary, resolved.colors.bg),
    secondary: buildTintScale(resolved.colors.secondary, resolved.colors.bg),
    accent: buildTintScale(resolved.colors.accent, resolved.colors.bg),
  }
  // 纹理令牌（0.18.0）：色阶色 + 明暗分档透明度；kind 来自主题映射
  const kind = themeTextureKind(theme.id)
  const base = textureFromTints(tints, resolved.colors.bg)
  const texture = kind === 'none' || base === undefined ? undefined : { ...base, kind }
  return {
    themeId: theme.id,
    colors: resolved.colors,
    tints,
    texture,
    ...(resolved.structuralGradient !== undefined ? { structuralGradient: resolved.structuralGradient } : {}),
    chartColors: resolved.chartColors,
    fonts: resolved.fonts,
    fontSizeLadder: FONT_LADDERS[options.density ?? 'normal'],
    anchors: { ...TITLE_ANCHOR },
    grid: { ...PAGE_GRID, canvasW: CANVAS_W_IN, canvasH: CANVAS_H_IN },
    lockedAt: new Date().toISOString(),
  }
}
