/**
 * 内置视觉主题（12 套）。
 *
 * 主题只携带「颜色 / 字体 / 图表色板 / 封面渐变」四类确定性信息，
 * 版式规则（每种页型的区块划分）见 skills/dsh-ppt-studio/reference/layouts.md。
 * 颜色统一 '#RRGGBB'；深浅色主题均可在浅色背景上直接使用。
 */
import { CANVAS_H_IN, CANVAS_W_IN } from './units.js'
import type { DeckDensity, DesignTokens, PaletteOverrides } from './schema.js'

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
  fonts: { title: string; body: string }
}

export const THEMES: Theme[] = [
  {
    id: 'business-blue',
    category: 'business',
    name: '商务蓝',
    mood: '专业稳重、值得信赖',
    bestFor: '工作汇报、项目总结、对上汇报、评审答辩',
    dark: false,
    colors: {
      bg: '#F5F7FA',
      surface: '#FFFFFF',
      primary: '#1E4B8F',
      secondary: '#2E6FC9',
      accent: '#E8A33D',
      text: '#1F2937',
      textMuted: '#6B7280',
      onPrimary: '#FFFFFF',
    },
    chartColors: ['#1E4B8F', '#2E6FC9', '#6FA8E0', '#E8A33D', '#94A3B8', '#B85C38'],
    heroGradient: { from: '#1E4B8F', to: '#2E6FC9', angle: 135 },
    fonts: { title: 'Microsoft YaHei', body: 'Microsoft YaHei' },
  },
  {
    id: 'tech-dark',
    category: 'tech',
    name: '科技深色',
    mood: '现代锐利、技术感强',
    bestFor: '技术方案、产品发布、架构宣讲、开发者分享',
    dark: true,
    colors: {
      bg: '#0F172A',
      surface: '#1E293B',
      primary: '#38BDF8',
      secondary: '#818CF8',
      accent: '#34D399',
      text: '#F1F5F9',
      textMuted: '#94A3B8',
      onPrimary: '#0F172A',
    },
    chartColors: ['#38BDF8', '#818CF8', '#34D399', '#FBBF24', '#F472B6', '#60A5FA'],
    heroGradient: { from: '#0EA5E9', to: '#6366F1', angle: 135 },
    fonts: { title: 'Microsoft YaHei', body: 'Microsoft YaHei' },
  },
  {
    id: 'gov-red',
    category: 'gov',
    name: '政务红',
    mood: '庄重大气、旗帜鲜明',
    bestFor: '党政机关汇报、主题教育、精神文明宣传',
    dark: false,
    colors: {
      bg: '#FAF6F0',
      surface: '#FFFFFF',
      primary: '#B02A30',
      secondary: '#D4544F',
      accent: '#C9A227',
      text: '#2D2A26',
      textMuted: '#7A736B',
      onPrimary: '#FFFFFF',
    },
    chartColors: ['#B02A30', '#C9A227', '#D4544F', '#8C6D46', '#94A3B8', '#5F7470'],
    heroGradient: { from: '#B02A30', to: '#7A1E22', angle: 135 },
    fonts: { title: 'Microsoft YaHei', body: 'Microsoft YaHei' },
  },
  {
    id: 'academic-plain',
    category: 'education',
    name: '学术素雅',
    mood: '克制干净、论证优先',
    bestFor: '学术报告、课程讲义、研究综述、毕业答辩',
    dark: false,
    colors: {
      bg: '#FDFDFB',
      surface: '#FFFFFF',
      primary: '#33658A',
      secondary: '#86BBD8',
      accent: '#F6AE2D',
      text: '#2F3542',
      textMuted: '#707788',
      onPrimary: '#FFFFFF',
    },
    chartColors: ['#33658A', '#86BBD8', '#F6AE2D', '#2F4858', '#A5C9E1', '#8D99AE'],
    heroGradient: { from: '#33658A', to: '#2F4858', angle: 135 },
    fonts: { title: 'Microsoft YaHei', body: 'Microsoft YaHei' },
  },
  {
    id: 'fresh-teal',
    category: 'education',
    name: '清新青绿',
    mood: '明快亲和、有生气',
    bestFor: '培训宣讲、团队建设、公益科普、活动介绍',
    dark: false,
    colors: {
      bg: '#F2FAF7',
      surface: '#FFFFFF',
      primary: '#0E8A6D',
      secondary: '#34B392',
      accent: '#F4A259',
      text: '#1E3A34',
      textMuted: '#5F7A72',
      onPrimary: '#FFFFFF',
    },
    chartColors: ['#0E8A6D', '#34B392', '#F4A259', '#3D7EA6', '#9CBF6E', '#776871'],
    heroGradient: { from: '#0E8A6D', to: '#34B392', angle: 135 },
    fonts: { title: 'Microsoft YaHei', body: 'Microsoft YaHei' },
  },
  {
    id: 'warm-sunset',
    category: 'culture',
    name: '暖阳渐变',
    mood: '温暖柔和、有人情味',
    bestFor: '文化宣传、品牌故事、年度回顾、致谢场合',
    dark: false,
    colors: {
      bg: '#FFF9F2',
      surface: '#FFFFFF',
      primary: '#D96C47',
      secondary: '#F2A65A',
      accent: '#7D6B91',
      text: '#3B2F2A',
      textMuted: '#8A7A6D',
      onPrimary: '#FFFFFF',
    },
    chartColors: ['#D96C47', '#F2A65A', '#7D6B91', '#5B8C5A', '#98B4D4', '#C15B5B'],
    heroGradient: { from: '#D96C47', to: '#F2A65A', angle: 135 },
    fonts: { title: 'Microsoft YaHei', body: 'Microsoft YaHei' },
  },
  {
    id: 'mono-editorial',
    category: 'business',
    name: '极简杂志',
    mood: '黑白灰克制、编辑排版感',
    bestFor: '设计提案、发布会开场、作品集展示、观点陈述',
    dark: false,
    colors: {
      bg: '#FAFAFA',
      surface: '#FFFFFF',
      primary: '#111111',
      secondary: '#4B4B4B',
      accent: '#E63946',
      text: '#1A1A1A',
      textMuted: '#8A8A8A',
      onPrimary: '#FFFFFF',
    },
    chartColors: ['#111111', '#E63946', '#8C8C8C', '#525252', '#BFBFBF', '#D9D9D9'],
    heroGradient: { from: '#1A1A1A', to: '#3D3D3D', angle: 135 },
    fonts: { title: 'Microsoft YaHei', body: 'Microsoft YaHei' },
  },
  {
    id: 'indigo-gradient',
    category: 'tech',
    name: '靛蓝渐变',
    mood: '靛蓝紫渐变、科技而不压抑',
    bestFor: '产品发布、技术布道、创新提案、AI 主题分享',
    dark: false,
    colors: {
      bg: '#F5F6FF',
      surface: '#FFFFFF',
      primary: '#4F46E5',
      secondary: '#7C3AED',
      accent: '#06B6D4',
      text: '#1E1B4B',
      textMuted: '#6D6A8A',
      onPrimary: '#FFFFFF',
    },
    chartColors: ['#4F46E5', '#7C3AED', '#06B6D4', '#F59E0B', '#EC4899', '#6366F1'],
    heroGradient: { from: '#4F46E5', to: '#7C3AED', angle: 135 },
    fonts: { title: 'Microsoft YaHei', body: 'Microsoft YaHei' },
  },
  {
    id: 'cream-notes',
    category: 'education',
    name: '奶油手账',
    mood: '奶油底暖棕、亲和手作感',
    bestFor: '教学讲义、读书分享、轻量科普、社群活动',
    dark: false,
    colors: {
      bg: '#FDF8EF',
      surface: '#FFFDF7',
      primary: '#9C6B3F',
      secondary: '#C79A62',
      accent: '#6E8B5E',
      text: '#3E3428',
      textMuted: '#8C7F6E',
      onPrimary: '#FFFDF7',
    },
    chartColors: ['#9C6B3F', '#C79A62', '#6E8B5E', '#B0563F', '#D9B67E', '#8A8F6C'],
    heroGradient: { from: '#C79A62', to: '#9C6B3F', angle: 135 },
    fonts: { title: 'Microsoft YaHei', body: 'Microsoft YaHei' },
  },
  {
    id: 'forest-ink',
    category: 'education',
    name: '墨绿学术',
    mood: '墨绿沉稳、书卷气',
    bestFor: '学术答辩、研究汇报、环保与生命科学主题',
    dark: false,
    colors: {
      bg: '#F6F8F4',
      surface: '#FFFFFF',
      primary: '#1F4D3A',
      secondary: '#3E7C5B',
      accent: '#C9A227',
      text: '#22302A',
      textMuted: '#6B7A70',
      onPrimary: '#FFFFFF',
    },
    chartColors: ['#1F4D3A', '#3E7C5B', '#C9A227', '#2F4858', '#8FAF9B', '#5F7470'],
    heroGradient: { from: '#1F4D3A', to: '#2F4858', angle: 135 },
    fonts: { title: 'Microsoft YaHei', body: 'Microsoft YaHei' },
  },
  {
    id: 'navy-gold',
    category: 'event',
    name: '藏蓝鎏金',
    mood: '深蓝压场、金色点睛、高端',
    bestFor: '年度盛典、对外答谢、高层战略汇报、颁奖典礼',
    dark: true,
    colors: {
      bg: '#0E1A2B',
      surface: '#16263C',
      primary: '#C9A24B',
      secondary: '#5B8BBE',
      accent: '#E0BC6D',
      text: '#F2F0E9',
      textMuted: '#9AA5B1',
      onPrimary: '#14243A',
    },
    chartColors: ['#C9A24B', '#5B8BBE', '#7BA7C9', '#E0BC6D', '#94A3B8', '#3E5F7E'],
    heroGradient: { from: '#12233B', to: '#2C4A6E', angle: 135 },
    fonts: { title: 'Microsoft YaHei', body: 'Microsoft YaHei' },
  },
  {
    id: 'slate-orange',
    category: 'business',
    name: '工业灰橙',
    mood: '冷静灰调、橙色警示感强',
    bestFor: '制造与工程汇报、安全生产、生产运营看板',
    dark: false,
    colors: {
      bg: '#F3F4F5',
      surface: '#FFFFFF',
      primary: '#37474F',
      secondary: '#546E7A',
      accent: '#F4511E',
      text: '#263238',
      textMuted: '#78909C',
      onPrimary: '#FFFFFF',
    },
    chartColors: ['#F4511E', '#37474F', '#546E7A', '#FF8A65', '#90A4AE', '#6D4C41'],
    heroGradient: { from: '#37474F', to: '#546E7A', angle: 135 },
    fonts: { title: 'Microsoft YaHei', body: 'Microsoft YaHei' },
  },
]

export function getTheme(id: string): Theme | undefined {
  return THEMES.find(theme => theme.id === id)
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
}

export function resolveDesignTheme(theme: Theme, paletteOverrides?: Partial<ThemeColors>): ResolvedTheme {
  const colors = resolveThemeColors(theme, paletteOverrides)
  const chartColors = [colors.primary, colors.secondary, ...theme.chartColors.filter(c => c !== colors.primary && c !== colors.secondary)]
  return { colors, chartColors: [...new Set(chartColors)].slice(0, 6), fonts: theme.fonts }
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
  return {
    themeId: theme.id,
    colors: resolved.colors,
    chartColors: resolved.chartColors,
    fonts: resolved.fonts,
    fontSizeLadder: FONT_LADDERS[options.density ?? 'normal'],
    anchors: { ...TITLE_ANCHOR },
    grid: { ...PAGE_GRID, canvasW: CANVAS_W_IN, canvasH: CANVAS_H_IN },
    lockedAt: new Date().toISOString(),
  }
}
