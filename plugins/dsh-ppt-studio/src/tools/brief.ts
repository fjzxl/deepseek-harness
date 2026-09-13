/**
 * ppt_brief_create —— 第 a 步：简报（创建 deck）。
 *
 * 用户选定主题、确认听众与场景后调用：落盘 brief.json 并创建工作区。
 * 与旧 ppt_draft_create 的区别：不再携带章节要点（那是 b 步大纲目录的事），
 * 主题/听众/场景前置到这里确认。
 */
import { z } from 'zod'
import type { DeckBrief } from '../schema.js'
import { deckBriefSchema, paletteOverridesSchema, renderRouteEnum } from '../schema.js'
import { getTheme, THEMES } from '../themes.js'
import { createDeckLogger } from '../logger.js'
import type { ResolvedPptStudioConfig } from '../config.js'
import { suggestPageCounts } from './plan.js'
import { asRecord, oneText, resolveToolContext, type ToolDefinition } from './registry.js'

/** mode → 确认点预设（0.9.0：mode 是 confirmStages 的捷径，不再是独立机制）。 */
export function confirmStagesPreset(mode: 'quick' | 'standard' | 'precise'): Array<'brief' | 'outline' | 'pageplan' | 'blueprint' | 'design' | 'prototype'> {
  if (mode === 'quick') return []
  const base = ['brief', 'outline', 'pageplan', 'blueprint', 'design'] as const
  return mode === 'precise' ? [...base, 'prototype'] : [...base]
}

/**
 * 展开后的确认点（0.9.1：下游工具一律读这份展开值，禁止再按 mode 分支——
 * "confirmStages 是唯一开关"由此在运行时成立，quick+显式 prototype 之类组合不再被 mode 预设吞掉）。
 */
export function resolvedConfirmStages(brief: Pick<DeckBrief, 'mode' | 'confirmStages'>): Set<string> {
  return new Set(brief.confirmStages ?? confirmStagesPreset(brief.mode))
}

const argsSchema = z.object({
  title: z.string().min(1).max(120),
  topic: z.string().min(1).max(600),
  audience: z.string().min(1).max(120),
  scenario: z.string().min(1).max(200),
  objective: z.string().min(1).max(300),
  durationMin: z.number().int().min(1).max(480).optional(),
  themeId: z.string().min(1).max(40),
  tone: z.string().max(80).optional(),
  density: z.enum(['sparse', 'normal', 'dense']).optional(),
  mode: z.enum(['quick', 'standard', 'precise']).optional(),
  renderRoute: renderRouteEnum.optional(),
  evidenceLevel: z.enum(['none', 'business', 'academic']).optional(),
  strictness: z.enum(['relaxed', 'normal', 'strict']).optional(),
  confirmStages: z.array(z.enum(['brief', 'outline', 'pageplan', 'blueprint', 'design', 'prototype'])).max(6).optional(),
  referenceMaterials: z.array(z.object({
    id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,39}$/),
    title: z.string().min(1).max(120),
    note: z.string().max(200).optional(),
  })).max(20).optional(),
  paletteOverrides: paletteOverridesSchema.optional(),
})

export function createBriefTools(config: ResolvedPptStudioConfig): ToolDefinition[] {
  return [
    {
      name: 'ppt_brief_create',
      description:
        'PPT 制作第 a 步：用户选定主题、确认听众/场景/目标/时长后调用。落盘简报（标题/主题背景/听众/场景/演讲目标/时长/主题风格/生成模式/证据等级）并创建 deck 工作区。' +
        'objective（演讲目标）决定整套 deck 的取舍——同主题给中学生科普与给 CTO 讲技术路线是完全不同的 PPT，必须与用户确认。' +
        'mode（quick/standard/precise）决定后续确认闸门数量，未问过用户时默认 standard。' +
        '返回 deckId 与简报全文，必须按 mode 对应的确认方式展示给用户；确认后进入第 b 步 ppt_outline_draft 生成叙事架构。' +
        '中文：创建 PPT 简报（听众/场景/目标/时长/风格/模式），等待用户确认。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '演示文稿标题' },
          topic: { type: 'string', description: '主题与背景说明（一段话，含受众已知信息、材料来源）' },
          audience: { type: 'string', description: '听众是谁（用户已确认，决定措辞与详略）' },
          scenario: { type: 'string', description: '使用场景：场合/目的，如「科技节科普讲座」' },
          objective: { type: 'string', description: '演讲目标：听众听完应该获得/相信/做到什么（一句话以上）' },
          durationMin: { type: 'integer', description: '预计时长（分钟）；同页数下时长越短密度越低' },
          themeId: { type: 'string', description: `用户选定的主题 id，可选：${THEMES.map(t => t.id).join(' / ')}` },
          tone: { type: 'string', description: '语气，如 汇报体/教学体/宣讲体' },
          density: { type: 'string', enum: ['sparse', 'normal', 'dense'], description: '版面密度，默认 normal' },
          mode: {
            type: 'string',
            enum: ['quick', 'standard', 'precise'],
            description:
              '生成模式（用户已选定，只是确认点预设的捷径）：quick=无逐阶段确认（打包一次方向确认），其余采纳建议值快速产出；standard=默认，逐阶段确认（大纲/页数/设计）；precise=standard 基础上加 Prototype 真实预览确认关卡。叙事/证据严格度用 strictness/evidenceLevel 另行设置',
          },
          renderRoute: {
            type: 'string',
            enum: ['native', 'svg'],
            description:
              '渲染路线（0.10.0，用户已选定，必须向用户说明取舍后再选）：native=pptxgenjs 原生元素（默认）——文本/形状/图表/表格逐元素可编辑，受全部确定性版式规则保护（越界/互压/文字容量/密度）；svg=自由 SVG 绘制——视觉自由度最高（任意路径/渐变/构图，viewBox 0 0 1280 720），HTML 预览原生内联，但 PPTX 端是整页矢量图（PowerPoint 2016+ 显示，可右键"转换为形状"部分恢复编辑）且确定性版式规则不适用（只有安全面/色板/画布校验）——版式质量靠预览肉眼把关',
          },
          evidenceLevel: {
            type: 'string',
            enum: ['none', 'business', 'academic'],
            description:
              '证据等级：none=不要求来源；business=数字论断需来源；academic=fact/data 论断全部需来源。内网环境来源只能来自用户提供的材料，禁止编造',
          },
          strictness: {
            type: 'string',
            enum: ['relaxed', 'normal', 'strict'],
            description:
              '校验强度：normal=默认分级；strict=锁定令牌/证据类 warning 升级为 error（品牌一致性/学术场景，越锁即错）；relaxed=认知负荷类 warning 降为 info（草稿快速产出）',
          },
          referenceMaterials: {
            type: 'array',
            description: '参考材料清单（可选，证据等级≥business 强烈建议提供）：[{id, title, note?}]——提供后蓝图 evidence 的 source 必须引用其中条目的 id 或标题，否则升级为 error 拒绝（让"内网来源=用户材料"可执行）',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '材料 ID（字母开头，如 mat1）' },
                title: { type: 'string', description: '材料标题（如「2026 行业研究报告」）' },
                note: { type: 'string', description: '可选说明（哪部分数据出自它）' },
              },
              required: ['id', 'title'],
            },
          },
          confirmStages: {
            type: 'array',
            enum: ['brief', 'outline', 'pageplan', 'blueprint', 'design', 'prototype'],
            description: '确认点（唯一开关，0.9.0）：只列出的阶段停下来等用户确认，其余采纳建议值直接推进；缺省由 mode 预设展开（quick=[]、standard=前五项、precise=前五项+prototype）——显式传入优先于 mode',
          },
          paletteOverrides: { type: 'object', description: '可选色板覆盖（#RRGGBB）：bg/surface/primary/secondary/accent/text/textMuted/onPrimary' },
        },
        required: ['title', 'topic', 'audience', 'scenario', 'objective', 'themeId'],
      },
      output: {
        schema: { type: 'object', properties: { deckId: { type: 'string' }, brief: { type: 'object' } }, additionalProperties: true },
        render: (_args, value) => {
          const v = asRecord(value)
          const brief = asRecord(v.brief) as unknown as DeckBrief
          const lines: string[] = []
          lines.push(`✅ 简报已创建（deckId: ${String(v.deckId)}）`)
          lines.push(`标题：${brief.title}`)
          lines.push(`听众：${brief.audience}`)
          lines.push(`场景：${brief.scenario}`)
          lines.push(`目标：${brief.objective}`)
          if (brief.durationMin !== undefined) {
            const counts = Array.isArray(v.suggestedCounts) ? v.suggestedCounts : []
            const countText = counts.map((raw) => {
              const entry = asRecord(raw)
              return `${String(entry.contentPages)} 页（${String(entry.label)}）`
            }).join(' / ')
            lines.push(`时长：约 ${String(brief.durationMin)} 分钟${countText !== '' ? `｜页数档位：${countText}` : ''}`)
          }
          lines.push(`主题风格：${brief.themeId}${brief.tone !== undefined ? `（${brief.tone}）` : ''}`)
          lines.push(`生成模式：${brief.mode}${brief.evidenceLevel !== 'none' ? `（证据等级 ${brief.evidenceLevel}）` : ''}${brief.strictness !== 'normal' ? `｜校验强度 ${brief.strictness}` : ''}`)
          if (brief.renderRoute === 'svg') {
            lines.push('渲染路线：SVG 自由绘制（视觉自由度最高；PPTX 端为整页矢量图、PowerPoint 2016+ 显示，版式确定性校验不适用——写页后务必 ppt_preview_update 肉眼把关）')
          }
          const materials = Array.isArray(v.referenceMaterials) ? v.referenceMaterials : []
          if (materials.length > 0) {
            lines.push(`参考材料（${String(materials.length)} 份，evidence 来源必须引用）：` + materials.map((raw) => { const m = asRecord(raw); return `${String(m.id)}=${String(m.title)}` }).join('；'))
          }
          const stages = Array.isArray(brief.confirmStages) ? brief.confirmStages.map(String) : []
          const argsRecord = asRecord(_args)
          if (Array.isArray(argsRecord.confirmStages)) {
            lines.push(`自定义确认点（覆盖模式默认闸门）：${stages.join(' → ')}；未列出的阶段采纳建议值直接推进。`)
          }
          lines.push('')
          // 指引按展开后的确认点分支（0.9.1：mode 不再驱动任何行为分支）
          if (stages.length === 0) {
            lines.push(
              '当前无逐阶段确认点（打包模式）：不要在此处逐项等用户确认。直接继续 ppt_outline_draft → ppt_pageplan_confirm（采纳建议档位）→ ppt_design_propose/lock（采纳场景驱动方案或方案 A），' +
                '然后把【简报+章节大纲+页数分配+设计方案】打包成一条消息向用户做唯一前置确认；认可后一口气完成生成，最后统一交付与收集修改意见。',
            )
            lines.push('（打包确认消息中注明：各建议值不满意可当场指出，生成后也可随时重调对应工具覆盖——不是一锤子买卖。打包确认是对话层的方向授权，不是状态闸门；生成中的偏离由阶段 6 全量校验与叙事链自审兜底。）')
          } else if (stages.includes('prototype')) {
            lines.push(
              '请向用户展示以上简报并确认；确认后 ppt_outline_draft（页条目带 transition 叙事衔接）→ ppt_pageplan_confirm → ppt_design_propose/lock。' +
                '锁定设计后先写 spec.prototypePages 指定的代表页并调 ppt_preview_update 让用户确认真实视觉效果，认可后再继续写其余页。',
            )
          } else {
            lines.push('请向用户展示以上简报并确认；确认后调 ppt_outline_draft 生成叙事架构（这套 PPT 讲一个什么故事、分几幕、每幕回答什么问题）。')
          }
          return oneText(lines.join('\n'))
        },
      },
      execute: async (rawArgs, exec) => {
        exec?.signal?.throwIfAborted()
        const raw = asRecord(rawArgs)
        // 报错走可读路径（真实会话教训：英文 zod 数组模型读不懂）
        const args = (() => {
          const parsed = argsSchema.safeParse(raw)
          if (parsed.success) return parsed.data
          const issues = parsed.error.issues.map(i => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')
          const hints: string[] = []
          if (parsed.error.issues.some(i => i.code === 'invalid_type' && i.received === 'undefined')) {
            hints.push('缺少必填字段：title（标题）、topic（主题背景）、audience（听众）、scenario（场景）、objective（演讲目标）、themeId（主题风格）缺一不可。')
          }
          if (parsed.error.issues.some(i => i.path[0] === 'themeId')) {
            hints.push(`themeId 必须是内置主题之一：${THEMES.map(t => t.id).join(' / ')}（先调 ppt_themes 列给用户选）。`)
          }
          throw new Error(
            'ppt_brief_create 参数不符合要求：\n' + issues +
            (hints.length > 0 ? '\n\n修复提示：\n' + hints.map(h => `  - ${h}`).join('\n') : '') +
            '\n\n正确示例：{"title":"标题","topic":"主题与背景一段话","audience":"中学生","scenario":"科技节讲座","objective":"让听众理解X并记住Y","themeId":"indigo-gradient"}',
          )
        })()
        const theme = getTheme(args.themeId)
        if (theme === undefined) throw new Error(`未知主题 ${args.themeId}，可选：${THEMES.map(t => t.id).join(' / ')}`)

        const { store } = resolveToolContext(config, exec)
        const created = await store.create(args.title)
        const brief: DeckBrief = deckBriefSchema.parse({
          deckId: created.deckId,
          title: args.title,
          topic: args.topic,
          audience: args.audience,
          scenario: args.scenario,
          objective: args.objective,
          durationMin: args.durationMin,
          themeId: args.themeId,
          tone: args.tone,
          density: args.density ?? 'normal',
          mode: args.mode ?? 'standard',
          renderRoute: args.renderRoute ?? 'native',
          evidenceLevel: args.evidenceLevel ?? 'none',
          strictness: args.strictness ?? 'normal',
          ...(args.referenceMaterials !== undefined ? { referenceMaterials: args.referenceMaterials } : {}),
          // 0.9.0 收敛：mode 只是确认点的预设——唯一开关是 confirmStages。
          // quick=不逐阶段确认（打包一次）；standard=五阶段逐项；precise=standard+Prototype。
          // 用户显式给 confirmStages 时优先于 mode 预设。
          confirmStages: args.confirmStages ?? confirmStagesPreset(args.mode ?? 'standard'),
          paletteOverrides: args.paletteOverrides,
          confirmedAt: new Date().toISOString(),
        })
        await store.saveJson(created.paths.brief, brief)
        const logger = createDeckLogger(created.paths.root, created.deckId)
        logger.info('brief', '简报已创建', { themeId: brief.themeId, audience: brief.audience, objective: brief.objective, mode: brief.mode, evidenceLevel: brief.evidenceLevel })
        return {
          deckId: created.deckId,
          brief,
          theme: { id: theme.id, name: theme.name, dark: theme.dark },
          suggestedCounts: suggestPageCounts(args.durationMin),
        }
      },
    },
  ]
}
