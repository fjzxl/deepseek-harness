/**
 * 插件配置解析（行配置 + 环境变量，环境变量优先级低于行配置）。
 *
 * 环境变量：
 *   PPT_STUDIO_OUTPUT_DIR           deck 工作区根目录
 *   PPT_STUDIO_PREVIEW_PORT         预览服务端口（默认 3170）
 *   PPT_STUDIO_PREVIEW_BASE_URL     生成预览链接前缀
 *   PPT_STUDIO_PREVIEW_AUTO_OPEN    渲染/预览后自动打开浏览器：
 *                                   默认 once=每个 deck 只自动打开第一次（生成期间不再反复弹窗）；
 *                                   always=每次都打开；0/false/off/no=完全不打开
 *   PPT_STUDIO_IMAGE_API_BASE       内网生图接口 baseURL（OpenAI 兼容）
 *   PPT_STUDIO_IMAGE_API_KEY        生图接口密钥
 *   PPT_STUDIO_IMAGE_API_MODEL      生图模型名
 */

/**
 * 自动打开浏览器的模式：
 *   'once'   每个 deck 只在第一次成功的渲染/预览时打开（默认）
 *   'always' 每次成功的渲染/预览都打开（0.7.2 之前的旧行为）
 *   false    完全不打开
 */
export type PreviewAutoOpenMode = 'once' | 'always' | false

export interface PptStudioConfig {
  outputDir?: string
  previewPort?: number
  previewBaseUrl?: string
  previewAutoOpen?: boolean | 'once' | 'always'
  imageApi?: { baseUrl?: string; apiKeyEnv?: string; model?: string }
}

export interface ResolvedImageApi {
  baseUrl: string
  apiKey: string
  model: string
}

export interface ResolvedPptStudioConfig {
  outputDir: string
  previewPort: number
  previewBaseUrl: string
  previewAutoOpen: PreviewAutoOpenMode
  imageApi: ResolvedImageApi | undefined
}

export const OUTPUT_DIR_ENV = 'PPT_STUDIO_OUTPUT_DIR'
export const PREVIEW_PORT_ENV = 'PPT_STUDIO_PREVIEW_PORT'
export const PREVIEW_BASE_URL_ENV = 'PPT_STUDIO_PREVIEW_BASE_URL'
export const PREVIEW_AUTO_OPEN_ENV = 'PPT_STUDIO_PREVIEW_AUTO_OPEN'
export const IMAGE_API_BASE_ENV = 'PPT_STUDIO_IMAGE_API_BASE'
export const IMAGE_API_KEY_ENV = 'PPT_STUDIO_IMAGE_API_KEY'
export const IMAGE_API_MODEL_ENV = 'PPT_STUDIO_IMAGE_API_MODEL'

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 解析并校验插件行配置。空配置永远可用。 */
export function resolvePptStudioConfig(config?: PptStudioConfig | null): ResolvedPptStudioConfig {
  const raw = config ?? {}
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('dsh-ppt-studio 配置必须是对象')

  const outputDir = str(raw.outputDir) || str(process.env[OUTPUT_DIR_ENV])
  if (raw.outputDir !== undefined && typeof raw.outputDir !== 'string') throw new Error('outputDir 必须是字符串')

  let previewPort = 3170
  const envPort = str(process.env[PREVIEW_PORT_ENV])
  const portRaw = raw.previewPort ?? (envPort !== '' ? Number(envPort) : undefined)
  if (portRaw !== undefined && (!Number.isInteger(portRaw) || portRaw < 1 || portRaw > 65535)) {
    throw new Error('previewPort 必须是 1–65535 的整数')
  }
  if (portRaw !== undefined) previewPort = Number(portRaw)

  const previewBaseUrl = str(raw.previewBaseUrl) || str(process.env[PREVIEW_BASE_URL_ENV]) || `http://127.0.0.1:${previewPort}`

  // 自动打开浏览器：默认 once（每 deck 一次）；行配置 > 环境变量。
  // 旧布尔配置兼容：true=always（显式开启保持旧行为）、false=关。
  const autoOpenEnv = str(process.env[PREVIEW_AUTO_OPEN_ENV]).toLowerCase()
  const previewAutoOpen: PreviewAutoOpenMode = (() => {
    if (raw.previewAutoOpen !== undefined) {
      if (raw.previewAutoOpen === true) return 'always'
      if (raw.previewAutoOpen === false) return false
      if (raw.previewAutoOpen === 'once' || raw.previewAutoOpen === 'always') return raw.previewAutoOpen
      throw new Error('previewAutoOpen 必须是 true/false 或 "once"/"always"')
    }
    if (autoOpenEnv === '') return 'once'
    if (['0', 'false', 'off', 'no'].includes(autoOpenEnv)) return false
    if (autoOpenEnv === 'once') return 'once'
    return 'always' // always / true / 1 / on / yes 等显式开启值
  })()

  const apiBase = str(raw.imageApi?.baseUrl) || str(process.env[IMAGE_API_BASE_ENV])
  const apiKeyEnv = str(raw.imageApi?.apiKeyEnv) || IMAGE_API_KEY_ENV
  const apiKey = str(process.env[apiKeyEnv])
  const model = str(raw.imageApi?.model) || str(process.env[IMAGE_API_MODEL_ENV])
  const imageApi = apiBase !== '' && apiKey !== '' && model !== '' ? { baseUrl: apiBase, apiKey, model } : undefined

  return { outputDir, previewPort, previewBaseUrl, previewAutoOpen, imageApi }
}
