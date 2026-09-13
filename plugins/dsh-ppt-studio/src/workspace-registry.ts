/**
 * 工作区注册表：让预览服务找到"任意会话工作目录"里生成的 deck。
 *
 * 背景：deck 工作区按 DSH 会话 cwd 解析（每个会话可能不同），而预览服务是独立进程、
 * 只知道自己的 cwd——两者不一致时预览 404。解决：工具每次解析工作区时把绝对路径
 * 登记到全局注册表（~/.dsh/ppt-studio-workspaces.json），预览服务合并本地根目录与
 * 注册表全部根目录进行多根托管。注册尽力而为，失败不影响业务。
 *
 * 路径惰性解析：环境变量 PPT_STUDIO_WORKSPACE_REGISTRY 可覆盖（测试隔离用）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** 注册表文件路径（每次调用时解析，环境变量可覆盖）。 */
export function registryPath(): string {
  const override = process.env.PPT_STUDIO_WORKSPACE_REGISTRY
  return override !== undefined && override !== '' ? resolve(override) : join(homedir(), '.dsh', 'ppt-studio-workspaces.json')
}

function readRegistry(): string[] {
  try {
    const raw = JSON.parse(readFileSync(registryPath(), 'utf8')) as unknown
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

/** 登记工作区根目录（绝对化 + 去重 + 原子写）。已登记时零写入。 */
export async function registerWorkspace(rootDir: string): Promise<void> {
  const abs = resolve(rootDir)
  // 登记时顺手清理失效条目（0.8.2：工作区目录被删除后注册表不再无限残留；
  // 读取侧 listWorkspaces 本就过滤，这里保证落盘文件也不膨胀）
  const existing = readRegistry().filter(root => existsSync(root))
  if (existing.includes(abs)) {
    if (existing.length !== readRegistry().length) await rewriteRegistry(existing)
    return
  }
  const next = [...existing, abs].sort()
  await rewriteRegistry(next)
}

/** 原子重写注册表（登记/清理共用）。 */
async function rewriteRegistry(roots: string[]): Promise<void> {
  const path = registryPath()
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(16).slice(2, 8)}`
  await writeFile(tmp, JSON.stringify(roots, null, 2), 'utf8')
  await rename(tmp, path)
}

/** 列出全部已登记且仍存在的工作区根目录。 */
export function listWorkspaces(): string[] {
  return readRegistry().filter(root => existsSync(root))
}
