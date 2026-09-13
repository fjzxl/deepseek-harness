/**
 * 工具定义注册表。
 *
 * ToolDefinition 与 DSH defineTool 的入参形态一致（dsh-ppt-master 同款），
 * 因此同一份定义既能被 cordis 入口注册进宿主 ctx.tools，
 * 也能被本地 CLI / 测试直接调用（不依赖任何 @deepseek-ai 包）。
 */
import type { ResolvedPptStudioConfig } from '../config.js'
import { DeckStore } from '../deck-store.js'
import { registerWorkspace } from '../workspace-registry.js'
import { resolve } from 'node:path'

/** DSH Harness 执行上下文（直接调用时可省略）。 */
export interface ToolExecution {
  readonly signal?: AbortSignal
  readonly agent?: { readonly session: { readonly header: { readonly cwd?: string } } }
}

export interface ToolDefinition {
  name: string
  description: string
  /** JSON Schema，作为 defineTool 的 parameters 原样下发 */
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render: (args: unknown, value: unknown) => Array<{ type: 'text'; text: string }>
  }
  execute: (rawArgs: unknown, exec?: ToolExecution) => Promise<unknown>
}

/** 每次工具调用解析出的运行环境。 */
export interface ToolContext {
  /** 会话工作目录（或 process.cwd()） */
  workspaceRoot: string
  store: DeckStore
  config: ResolvedPptStudioConfig
}

export function resolveToolContext(config: ResolvedPptStudioConfig, exec?: ToolExecution): ToolContext {
  const workspaceRoot = exec?.agent?.session.header.cwd ?? process.cwd()
  const rootDir = resolve(workspaceRoot, config.outputDir !== '' ? config.outputDir : 'ppt-studio')
  // 登记工作区（预览服务多根托管用）；尽力而为，失败不影响业务
  void registerWorkspace(rootDir).catch(() => {})
  return { workspaceRoot, store: new DeckStore(rootDir), config }
}

/** 安全读取对象参数字段。 */
export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function requireString(args: Record<string, unknown>, key: string, toolName: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${toolName}：参数 ${key} 必须是非空字符串`)
  }
  return value.trim()
}

type TextBlock = { type: 'text'; text: string }
export function oneText(text: string): TextBlock[] {
  return [{ type: 'text', text }]
}
