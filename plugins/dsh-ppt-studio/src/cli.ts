/**
 * 本地 CLI：不经 DSH 宿主直接调用任意 PPT 工具（本地 Node 测试用）。
 *
 *   node lib/cli.js                        # 列出全部工具
 *   node lib/cli.js <toolName> '<json>'    # 调用工具
 *   node lib/cli.js ppt_draft_create '{"title":"..","topic":"..","sections":[..]}'
 *
 * 工作区 = <cwd>/ppt-studio（或 PPT_STUDIO_OUTPUT_DIR）。
 */
import { resolvePptStudioConfig } from './config.js'
import { buildPptStudioTools } from './tools/index.js'

async function main(argv: string[]): Promise<void> {
  const config = resolvePptStudioConfig(null)
  const tools = buildPptStudioTools(config)

  if (argv.length === 0) {
    console.log('可用工具：')
    for (const tool of tools) console.log(`  ${tool.name}`)
    return
  }
  const [toolName, jsonArgs] = argv
  const tool = tools.find(t => t.name === toolName)
  if (tool === undefined) {
    console.error(`未知工具 ${toolName}；可用：${tools.map(t => t.name).join(', ')}`)
    process.exitCode = 1
    return
  }
  let args: unknown = {}
  if (jsonArgs !== undefined && jsonArgs.trim() !== '') {
    try {
      args = JSON.parse(jsonArgs)
    } catch (error) {
      console.error(`参数不是合法 JSON：${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
      return
    }
  }
  try {
    const value = await tool.execute(args, { signal: AbortSignal.timeout(300_000) })
    console.log('---- result ----')
    console.log(JSON.stringify(value, null, 2))
    console.log('---- display ----')
    for (const block of tool.output.render(args, value)) console.log(block.text)
  } catch (error) {
    console.error(`工具执行失败：${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

void main(process.argv.slice(2))
