/**
 * 内网生图接口适配层（预留）。
 *
 * 协议：OpenAI 兼容 POST {baseUrl}/images/generations
 *   请求 { model, prompt, n: 1, size, response_format: 'b64_json' }
 *   响应 { data: [{ b64_json }] }（或 { data: [{ url }] }，此时再抓取一次）
 *
 * 未配置（PPT_STUDIO_IMAGE_API_BASE/KEY/MODEL 任一缺失）时 ppt_image_generate
 * 返回 available:false 与降级指引，不报错——内网无生图服务是常态。
 */
import type { ResolvedImageApi } from './config.js'

export interface GeneratedImage {
  buffer: Buffer
  mime: string
  model: string
  /** 接口返回的原始 url（如有） */
  url?: string
}

export class ImageApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'ImageApiError'
  }
}

export function imageApiReady(api: ResolvedImageApi | undefined | null): boolean {
  // null/undefined 一律视为未配置（降级建议而非抛错——工具承诺"未配置时返回 available:false 不报错"）
  return api != null && api.baseUrl !== '' && api.apiKey !== '' && api.model !== ''
}

export async function generateImage(
  api: ResolvedImageApi,
  prompt: string,
  opts: { size?: string; timeoutMs?: number } = {},
): Promise<GeneratedImage> {
  const size = opts.size ?? '1024x1024'
  const timeoutMs = opts.timeoutMs ?? 120_000
  const url = `${api.baseUrl.replace(/\/+$/, '')}/images/generations`
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${api.apiKey}` },
      body: JSON.stringify({ model: api.model, prompt, n: 1, size, response_format: 'b64_json' }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw new ImageApiError(`生图接口无法连接（${url}）：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new ImageApiError(`生图接口返回 ${response.status}：${body.slice(0, 300)}`, response.status)
  }
  const payload = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> }
  const item = payload.data?.[0]
  if (item?.b64_json !== undefined) {
    return { buffer: Buffer.from(item.b64_json, 'base64'), mime: 'image/png', model: api.model }
  }
  if (item?.url !== undefined) {
    const imageResponse = await fetch(item.url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!imageResponse.ok) throw new ImageApiError(`下载生成图片失败：HTTP ${imageResponse.status}`)
    const mime = imageResponse.headers.get('content-type') ?? 'image/png'
    return { buffer: Buffer.from(await imageResponse.arrayBuffer()), mime: mime.split(';')[0], model: api.model, url: item.url }
  }
  throw new ImageApiError('生图接口响应中没有 b64_json 或 url')
}
