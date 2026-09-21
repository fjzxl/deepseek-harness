/**
 * 环境与模块诊断。
 *
 * 排查三类高频故障的一手信息：
 *   1. 模块互操作（"PptxGenJS is not a constructor"）：pptxgenjs 是双构建包，
 *      宿主加载管线给出的互操作形态与原生 Node ESM 不同——诊断要能回答
 *      「从哪个路径解析的、命中了哪种形态」。
 *   2. 工作区（输出目录不可写 / 预览端口被占）。
 *   3. 可选能力（生图接口是否配置）。
 *
 * ppt_doctor 工具消费 collectEnvReport；renderDeckPptx 渲染前记录
 * describePptxModule，互操作问题在 deck 日志里即可见。
 */
import { accessSync, constants, existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { connect } from 'node:net'
import { join } from 'node:path'
import * as pptxNamespace from 'pptxgenjs'
import type PptxGenJS from 'pptxgenjs'
import { PLUGIN_VERSION } from './version.js'

type PptxCtor = new () => InstanceType<typeof PptxGenJS>

export type PptxInteropShape =
  | 'module-exports-ctor'
  | 'esm-default'
  | 'named-PptxGenJS'
  | 'nested-default-default'
  | 'nested-default-PptxGenJS'

export interface PickedPptx {
  ctor: PptxCtor
  /** 命中的互操作形态（写进诊断日志，一眼看出宿主管线行为） */
  shape: PptxInteropShape
}

/**
 * 纯扫描：从任一互操作形态的模块对象里找出可实例化的构造器。
 * pptxgenjs 双构建包在不同加载管线下的形态：原生 ESM default、CJS exports 整体、
 * `__esModule` 双包（`{default:{default:…}}`，jiti/babel 互操作的典型产物）、命名导出。
 */
export function pickPptxConstructor(mod: unknown): PickedPptx | undefined {
  if (typeof mod === 'function') return { ctor: mod as PptxCtor, shape: 'module-exports-ctor' } // module.exports = ctor
  if (mod === null || typeof mod !== 'object') return undefined
  const ns = mod as Record<string, unknown>
  const inner = ns.default !== null && typeof ns.default === 'object' ? ns.default as Record<string, unknown> : undefined
  const candidates: Array<[unknown, PptxInteropShape]> = [
    [ns.default, 'esm-default'],
    [ns.PptxGenJS, 'named-PptxGenJS'],
    [inner?.default, 'nested-default-default'],
    [inner?.PptxGenJS, 'nested-default-PptxGenJS'],
  ]
  for (const [candidate, shape] of candidates) {
    if (typeof candidate === 'function') return { ctor: candidate as PptxCtor, shape }
  }
  return undefined
}

/** 模块解析诊断：解析路径 + 命中形态 + 构造器名。 */
export interface PptxModuleDiag {
  ok: boolean
  /** createRequire 解析到的 pptxgenjs 入口路径 */
  resolvedPath?: string
  /** 命中的互操作形态 */
  shape?: PptxInteropShape
  ctorName?: string
  note?: string
}

export function describePptxModule(): PptxModuleDiag {
  let resolvedPath: string | undefined
  try {
    resolvedPath = createRequire(import.meta.url).resolve('pptxgenjs')
  } catch (error) {
    return { ok: false, note: 'require.resolve 失败：' + (error instanceof Error ? error.message : String(error)) }
  }
  const picked = pickPptxConstructor(pptxNamespace)
  if (picked === undefined) {
    return { ok: false, resolvedPath, note: '命名空间扫描未命中任何已知互操作形态（含 require 兜底前的视图）' }
  }
  return { ok: true, resolvedPath, shape: picked.shape, ctorName: picked.ctor.name }
}

/** TCP 探活：预览端口上是否有服务在听。 */
export function isPortListening(port: number, host = '127.0.0.1', timeoutMs = 600): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect({ port, host })
    const settle = (result: boolean) => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => settle(true))
    socket.once('timeout', () => settle(false))
    socket.once('error', () => settle(false))
  })
}

function dirWritable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/** 插件环境体检报告（ppt_doctor 返回值）。 */
export interface EnvReport {
  nodeVersion: string
  pluginVersion: string
  outputRoot: string
  outputRootWritable: boolean
  outputRootExists: boolean
  pptx: PptxModuleDiag
  fflate: boolean
  zod: boolean
  previewPort: number
  previewListening: boolean
  imageApiConfigured: boolean
  imageApiModel?: string
  pluginLogExists: boolean
  pluginLogPath?: string
  failedSnapshotCount: number
  failedDir?: string
}

export async function collectEnvReport(rootDir: string, config: { previewPort: number; previewBaseUrl: string; imageApi?: { model: string } }): Promise<EnvReport> {
  const { access } = await import('node:fs/promises')
  const fflateOk = await (async () => { try { await import('fflate'); return true } catch { return false } })()
  const zodOk = await (async () => { try { await import('zod'); return true } catch { return false } })()
  const failedDir = join(rootDir, 'logs', 'failed')
  const failedSnapshotCount = existsSync(failedDir) ? readdirSync(failedDir).filter(f => f.endsWith('.json')).length : 0
  let outputRootWritable = false
  let outputRootExists = existsSync(rootDir)
  if (outputRootExists) {
    outputRootWritable = dirWritable(rootDir)
  } else {
    try {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(rootDir, { recursive: true })
      outputRootExists = true
      outputRootWritable = dirWritable(rootDir)
    } catch { /* 不可创建即不可写 */ }
  }
  void access // 保留 import 供未来细粒度检查
  return {
    nodeVersion: process.version,
    pluginVersion: PLUGIN_VERSION,
    outputRoot: rootDir,
    outputRootExists,
    outputRootWritable,
    pptx: describePptxModule(),
    fflate: fflateOk,
    zod: zodOk,
    previewPort: config.previewPort,
    previewListening: await isPortListening(config.previewPort),
    imageApiConfigured: config.imageApi !== undefined,
    imageApiModel: config.imageApi?.model,
    pluginLogExists: existsSync(join(rootDir, 'logs', 'plugin.log')),
    pluginLogPath: join(rootDir, 'logs', 'plugin.log'),
    failedSnapshotCount,
    failedDir: existsSync(failedDir) ? failedDir : undefined,
  }
}
