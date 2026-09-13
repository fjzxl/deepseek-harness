/**
 * dsh-ppt-studio —— DSH PPT 工作室插件（cordis 入口）。
 *
 * 注册：
 *   1. 技能 dsh-ppt-studio（a–g 七步 SOP：简报 → 大纲目录 → 页数 → 逐部分草稿 →
 *      锁定设计 → 逐页生成 → 校验渲染预览）
 *   2. 工具 16 个（确定性生成与校验；描述见 src/tools/*.ts）
 *
 * 预览服务：本插件不常驻端口；HTML 预览是自包含文件，由
 * preview-server.ts（node lib/preview-server.js 或部署层同款进程）静态托管，
 * 亦可由宿主/反向代理直接挂 preview/ 目录。
 */
import { resolvePptStudioConfig, type PptStudioConfig, type ResolvedPptStudioConfig } from './config.js'
import { registerPptStudioSkill, type SkillsService } from './skill.js'
import { buildPptStudioTools, type ToolDefinition } from './tools/index.js'

/** cordis 服务注入：apply 里要使用 ctx.tools 与 ctx.skills。 */
export const inject = ['tools', 'skills']
export const name = 'dsh-ppt-studio'
export type Config = PptStudioConfig

export interface PptStudioPluginContext {
  tools: { register(definition: ToolDefinition): () => void }
  skills: SkillsService
  logger?: { warn?(message: string): void }
  on?(event: string, listener: () => void): () => void
}

export function apply(ctx: PptStudioPluginContext, config: Config = {}): void {
  const resolved = resolvePptStudioConfig(config)
  const warn = (message: string): void => {
    ctx.logger?.warn?.(message)
  }
  const disposers: Array<() => void> = []

  // 技能注册：单个技能文件缺失只告警，不弄崩宿主启动。
  try {
    disposers.push(registerPptStudioSkill(ctx))
  } catch (error) {
    warn('[dsh-ppt-studio] 技能加载失败：' + (error instanceof Error ? error.message : String(error)))
  }

  for (const definition of buildPptStudioTools(resolved)) {
    disposers.push(ctx.tools.register(definition))
  }

  if (typeof ctx.on === 'function') {
    ctx.on('dispose', () => {
      for (const dispose of disposers) dispose()
    })
  }
}

export { resolvePptStudioConfig } from './config.js'
export { buildPptStudioTools } from './tools/index.js'
export { startPreviewServer } from './preview-server.js'
export type { ResolvedPptStudioConfig }
