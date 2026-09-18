/**
 * 组装全部 PPT 工具。
 *
 * 共 20 个工具，按流程顺序（阶段 0–8）：
 *   ppt_brief_create →（对话中 ppt_themes）→ ppt_outline_draft → ppt_pageplan_confirm →
 *   ppt_section_draft → ppt_design_propose → ppt_design_lock → ppt_page_write →
 *   （写页弱模型辅助：ppt_page_write content 内容模式 / ppt_page_skeleton 骨架 + append）→
 *   （每部分后可 ppt_preview_update；用户喊停 ppt_deck_pause）→ ppt_scene_check → ppt_deck_render →
 *   （横切）ppt_asset_register / ppt_image_generate / ppt_log_query / ppt_deck_status /
 *   ppt_doctor / ppt_deck_find_replace（批量改词）/ ppt_deck_branch（试错分支）
 *
 * 每个工具的 execute 统一过 withDiagnostics：
 *   1. 返回值 lossless() 清洗（DSH 宿主拒绝含 undefined 键的返回值）
 *   2. 插件级调用日志 <outputRoot>/logs/plugin.log：形态标注（argsForm/frozen）、
 *      耗时、结果；失败调用另存完整入参快照到 logs/failed/ 并在日志中引用。
 *      建 deck 之前的失败（入参问题/schema 拒绝/崩溃）由此留下第一手证据。
 */
import type { ResolvedPptStudioConfig } from '../config.js'
import { lossless, previewJson } from '../normalize.js'
import { createToolLogger, describeArgsForm, failureStreak } from '../toollog.js'
import { resolveToolContext } from './registry.js'
import { createBriefTools } from './brief.js'
import { createThemeTools, createDesignTools } from './design.js'
import { createOutlineTools } from './outline.js'
import { createPlanTools } from './plan.js'
import { createPageTools } from './page.js'
import { createSkeletonTools } from './skeleton.js'
import { createCheckTools } from './check.js'
import { createRenderTools } from './render.js'
import { createPreviewTools } from './preview.js'
import { createPauseTools } from './pause.js'
import { createFindReplaceTools } from './find-replace.js'
import { createBranchTools } from './branch.js'
import { createImageTools } from './image.js'
import { createLogTools } from './log.js'
import type { ToolDefinition } from './registry.js'

const ARGS_PREVIEW_MAX = 600

/** 熔断阈值（0.10.1）：同一工具连续失败达到此次数后拦截后续调用，防止原样重试死循环空烧 token。ppt_section_draft 另有更低的降级阈值（0.10.3，tools/outline.ts DEGRADE_AFTER=3）：连败先转逐页累积模式，正常到不了本阈值。 */
const BREAKER_OPEN_AFTER = 5
/** 熔断期间每拦截 N 次放行一次试探调用（half-open）：前置状态被其它工具修好后试探成功即自动恢复。 */
const BREAKER_PROBE_EVERY = 5

/** 包一层 execute：lossless 清洗 + 插件级调用日志 + 失败入参快照 + 连续失败熔断。 */
function withDiagnostics(config: ResolvedPptStudioConfig, definition: ToolDefinition): ToolDefinition {
  const execute = definition.execute
  return {
    ...definition,
    async execute(rawArgs: unknown, exec?: Parameters<ToolDefinition['execute']>[1]) {
      const start = Date.now()
      const argsForm = describeArgsForm(rawArgs)
      // frozen 只反映顶层；宿主深冻结时顶层必然也是 frozen，足够作为信号
      const frozen = rawArgs !== null && (typeof rawArgs === 'object' || typeof rawArgs === 'function') && Object.isFrozen(rawArgs)
      let toolLogger: ReturnType<typeof createToolLogger> | undefined
      try {
        const { store } = resolveToolContext(config, exec)
        toolLogger = createToolLogger(store.rootDir)
      } catch { /* 解析不出工作区（异常形态的 exec）则跳过日志与熔断 */ }

      // 连续失败熔断（0.10.1）：真实会话里小模型对 ppt_design_lock 换汤不换药地重试 91 次、
      // 空烧约 19 分钟 token。熔断只拦截不执行，每 BREAKER_PROBE_EVERY 次拦截放行一次试探。
      if (toolLogger !== undefined) {
        let streak: { errors: number; blocked: number } | undefined
        try {
          streak = failureStreak(await toolLogger.readTail(64), definition.name)
        } catch { /* 统计失败不阻断业务 */ }
        if (streak !== undefined && streak.errors >= BREAKER_OPEN_AFTER && (streak.blocked + 1) % BREAKER_PROBE_EVERY !== 0) {
          toolLogger.record({
            tool: definition.name,
            argsForm,
            frozen,
            outcome: 'blocked',
            durationMs: Date.now() - start,
            argsPreview: previewJson(rawArgs, ARGS_PREVIEW_MAX),
          })
          await toolLogger.flush()
          throw new Error(
            `🚫 熔断保护：${definition.name} 已连续失败 ${String(streak.errors)} 次且从未成功，本次调用未执行（拦截原样重试死循环）。\n` +
              '请停止重试，按顺序排查：\n' +
              '  ① 调 ppt_doctor 体检环境；\n' +
              '  ② 调 ppt_log_query {"source":"plugin"} 查看最近失败的入参与堆栈；\n' +
              '  ③ 按最近一次的失败提示真正改变前置条件（补齐缺失内容/修正参数），而不是换种写法提交等效的内容；\n' +
              '  ④ 仍无法推进时向用户说明卡点。\n' +
              `熔断期间每 ${String(BREAKER_PROBE_EVERY)} 次调用放行一次试探，前置条件被其它工具修好后重试会自动恢复。`,
          )
        }
      }

      try {
        const value = lossless(await execute(rawArgs, exec))
        // 日志尽力而为（toolLogger 未解析出来时跳过）。
        // await 落盘：工具返回时日志必已在盘上，进程随后崩溃也不丢这次调用的痕迹。
        try {
          toolLogger?.record({
            tool: definition.name,
            argsForm,
            frozen,
            outcome: 'ok',
            durationMs: Date.now() - start,
            argsPreview: previewJson(rawArgs, ARGS_PREVIEW_MAX),
            deckId: value !== null && typeof value === 'object' && 'deckId' in (value as Record<string, unknown>)
              ? String((value as Record<string, unknown>).deckId)
              : undefined,
          })
          await toolLogger?.flush()
        } catch { /* 日志失败不阻断业务 */ }
        return value
      } catch (error) {
        try {
          const logger = toolLogger ?? createToolLogger(resolveToolContext(config, exec).store.rootDir)
          // 连续失败主动提示（0.9.0）：把排查从"用户想起调 doctor"变成报错自带指引
          try {
            const streak = failureStreak(await logger.readTail(64), definition.name)
            if (streak.errors >= 1 && error instanceof Error) {
              error.message += `
（该工具已连续失败 ${String(streak.errors + 1)} 次：建议 ①调 ppt_doctor 体检环境；②ppt_log_query {"source":"plugin"} 查失败入参与堆栈；③连续同因失败请换写法，不要原样重试。连续失败 ${String(BREAKER_OPEN_AFTER)} 次将触发熔断，后续调用会被拦截。）`
            }
          } catch { /* 统计失败不阻断抛错 */ }
          const snapshot = await logger.snapshotFailed(definition.name, rawArgs)
          logger.record({
            tool: definition.name,
            argsForm,
            frozen,
            outcome: 'error',
            durationMs: Date.now() - start,
            argsPreview: previewJson(rawArgs, ARGS_PREVIEW_MAX),
            error: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined,
            snapshot,
          })
          await logger.flush()
        } catch { /* 日志失败不阻断业务 */ }
        throw error
      }
    },
  }
}

export function buildPptStudioTools(config: ResolvedPptStudioConfig): ToolDefinition[] {
  return [
    ...createBriefTools(config),
    ...createThemeTools(config),
    ...createOutlineTools(config),
    ...createPlanTools(config),
    ...createDesignTools(config),
    ...createPageTools(config),
    ...createSkeletonTools(config),
    ...createCheckTools(config),
    ...createRenderTools(config),
    ...createPreviewTools(config),
    ...createPauseTools(config),
    ...createFindReplaceTools(config),
    ...createBranchTools(config),
    ...createImageTools(config),
    ...createLogTools(config),
  ].map(definition => withDiagnostics(config, definition))
}

export type { ToolDefinition, ToolExecution } from './registry.js'
