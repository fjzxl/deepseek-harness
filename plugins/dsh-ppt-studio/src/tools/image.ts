/**
 * ppt_asset_register —— 登记本地图片；ppt_image_generate —— 内网生图接口（预留）。
 */
import { z } from 'zod'
import { registerAsset } from '../assets.js'
import { generateImage, imageApiReady } from '../image-provider.js'
import { requireDeckState } from '../deck-store.js'
import { createDeckLogger } from '../logger.js'
import type { ResolvedPptStudioConfig } from '../config.js'
import { asRecord, oneText, resolveToolContext, type ToolDefinition } from './registry.js'

export function createImageTools(config: ResolvedPptStudioConfig): ToolDefinition[] {
  return [
    {
      name: 'ppt_asset_register',
      description:
        '登记一张本地图片供页面引用：校验格式（png/jpg/gif/webp/svg/bmp，≤15MB）、解析尺寸、计算 sha256、' +
        '冻结到 deck 的 assets/images/ 并写入 manifest。页面 image 元素的 assetId 必须来自本工具或 ppt_image_generate。' +
        '中文：登记本地图片资产。',
      parameters: {
        type: 'object',
        properties: {
          deckId: { type: 'string' },
          path: { type: 'string', description: '图片路径（相对会话工作目录或绝对路径）' },
        },
        required: ['deckId', 'path'],
      },
      output: {
        schema: { type: 'object', properties: { assetId: { type: 'string' }, width: { type: 'integer' }, height: { type: 'integer' } }, additionalProperties: true },
        render: (_args, value) => {
          const v = asRecord(value)
          return oneText(`✅ 图片已登记：assetId=${String(v.assetId)}（${String(v.width ?? '?')}×${String(v.height ?? '?')}px，${String(v.mime)}）。页面 image 元素引用该 assetId 即可。`)
        },
      },
      execute: async (rawArgs, exec) => {
        exec?.signal?.throwIfAborted()
        const args = z.object({ deckId: z.string().min(1), path: z.string().min(1) }).parse(asRecord(rawArgs))
        const { store, workspaceRoot } = resolveToolContext(config, exec)
        await requireDeckState(store, args.deckId)
        const { assetId, entry } = await registerAsset(store, args.deckId, args.path, workspaceRoot)
        const logger = createDeckLogger(store.paths(args.deckId).root, args.deckId)
        logger.info('asset', `图片已登记 ${assetId}`, { file: entry.file, sha256: entry.sha256.slice(0, 12), bytes: entry.bytes })
        return { assetId, mime: entry.mime, width: entry.width, height: entry.height, bytes: entry.bytes, sha256: entry.sha256.slice(0, 16) }
      },
    },
    {
      name: 'ppt_image_generate',
      description:
        '调用内网生图接口生成配图并自动登记为资产（OpenAI 兼容 /images/generations，需配置 ' +
        'PPT_STUDIO_IMAGE_API_BASE / _KEY / _MODEL 或插件行配置 imageApi）。未配置时返回 available:false 与降级建议，不报错。' +
        '提示词纪律（0.9.2）：一段连贯散文而非标签堆砌——风格家族（矢量扁平/素描手账/等距3D/水彩/照片感，同一 deck 保持同一种）+ 主体视觉名词 + 构图 + 色彩行为（与锁定色板协调，写明各色占比）；图内不写字（图内一个词 = 一次重生成的成本，页面文字一次按键可改）。' +
        '中文：AI 生成配图（内网接口，未配置则降级）。',
      parameters: {
        type: 'object',
        properties: {
          deckId: { type: 'string' },
          prompt: {
            type: 'string',
            description:
              '一段连贯的散文提示词（不是逗号标签堆）：① 风格家族（同一 deck 全部配图保持同一种，如「扁平矢量插画」）② 主体（具体视觉名词，如「一座由书堆成的塔」而非「知识」）③ 构图（主体特写/场景环境/留白呼吸）④ 色彩行为（写明主色与点缀的占比，如「主色约占 30% 画面、点缀色只出现在焦点上、其余为呼吸留白」）⑤ 结尾注明「画面中不出现任何文字」——图内文字无法编辑，改一个词就要整图重生成',
          },
          size: { type: 'string', description: '尺寸，如 1024x1024 / 1792x1024，默认 1024x1024' },
        },
        required: ['deckId', 'prompt'],
      },
      output: {
        schema: { type: 'object', properties: { available: { type: 'boolean' }, assetId: { type: 'string' } }, additionalProperties: true },
        render: (_args, value) => {
          const v = asRecord(value)
          const lines: string[] = []
          if (v.available !== true) {
            lines.push(`ℹ️ 生图接口未配置（${String(v.reason ?? '')}）。`)
            lines.push('降级方案：1) 用主题色形状/矢量装饰与原生图表丰富版面；2) image 元素使用 placeholder 占位框（prompt 写明建议配图，用户后续手动替换）；3) 用户提供图片后 ppt_asset_register 登记。')
            lines.push('接入内网生图：设置 PPT_STUDIO_IMAGE_API_BASE / PPT_STUDIO_IMAGE_API_KEY / PPT_STUDIO_IMAGE_API_MODEL。')
          } else {
            lines.push(`✅ 已生成并登记：assetId=${String(v.assetId)}（${String(v.model ?? '')}）。`)
          }
          const palette = asRecord(v.deckPalette)
          if (palette.primary !== undefined) {
            lines.push(
              `🎨 本 deck 锁定色板：bg ${String(palette.bg)} / 主色 ${String(palette.primary)} / 点缀 ${String(palette.accent)}——生图 prompt 与占位框建议配图的色彩描述应与之协调（同 deck 全部配图保持同一风格家族），避免每张图各说各话。`,
            )
          } else {
            lines.push('（设计尚未锁定：建议先 ppt_design_lock，配图色彩才能与锁定色板协调。）')
          }
          return oneText(lines.join('\n'))
        },
      },
      execute: async (rawArgs, exec) => {
        exec?.signal?.throwIfAborted()
        const args = z.object({ deckId: z.string().min(1), prompt: z.string().min(1).max(1000), size: z.string().max(20).optional() }).parse(asRecord(rawArgs))
        const { store } = resolveToolContext(config, exec)
        await requireDeckState(store, args.deckId)
        const logger = createDeckLogger(store.paths(args.deckId).root, args.deckId)

        // 生图与锁定令牌的协调（0.9.2，借鉴"同 deck 全部图共用色彩锚"纪律）：设计已锁定时
        // 把色板摘要随结果返回（生成与降级两条路径都带——占位框 prompt 同样需要色彩锚）。
        // prompt 是模型写的，色彩协调靠返回提醒与 SOP 纪律达成（不静默改写 prompt）
        const tokens = await store.loadTokens(args.deckId)
        const deckPalette = tokens !== undefined
          ? { bg: tokens.colors.bg, primary: tokens.colors.primary, accent: tokens.colors.accent }
          : undefined

        if (!imageApiReady(config.imageApi)) {
          logger.warn('image', '生图接口未配置，返回降级建议')
          return {
            available: false,
            reason: '未配置 PPT_STUDIO_IMAGE_API_BASE/_KEY/_MODEL（或插件 imageApi 行配置）',
            fallback: ['shape/vector/chart', 'placeholder', 'asset_register'],
            ...(deckPalette !== undefined ? { deckPalette } : {}),
          }
        }
        const image = await logger.timed('image', `生图：${args.prompt.slice(0, 40)}`, () =>
          generateImage(config.imageApi!, args.prompt, { size: args.size }),
        )
        const ext = image.mime.includes('jpeg') ? '.jpg' : image.mime.includes('webp') ? '.webp' : image.mime.includes('gif') ? '.gif' : '.png'
        const { assetId, entry } = await registerAsset(store, args.deckId, `generated-${Date.now()}${ext}`, process.cwd(), 'generated-api', image.buffer)
        logger.info('image', `生成图已登记 ${assetId}`, { model: image.model, bytes: entry.bytes })
        return { available: true, assetId, model: image.model, width: entry.width, height: entry.height, mime: entry.mime, ...(deckPalette !== undefined ? { deckPalette } : {}) }
      },
    },
  ]
}
