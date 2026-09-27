/**
 * SVG → PNG 光栅化（出 PPTX 前置）。
 *
 * 背景（0.17.2 修复）：pptxgenjs 对 image/svg+xml data URI 落盘为
 * "主 blip 伪 PNG + svgBlip 扩展"双 media——fallback 的 .png 只是原样复制
 * SVG 字节，PowerPoint 2016+ 走 svgBlip 能显示，但 WPS / 旧版 Office /
 * 第三方预览器只读主 blip 的伪 PNG，解码失败即"图示整块消失"。
 * 因此嵌入前先把 SVG 光栅化为真 PNG，主 blip 全查看器可显示；
 * 矢量清晰度以 200 PPI 的高分辨率位图补偿。
 *
 * @resvg/resvg-js 缺失或渲染异常时返回 undefined，调用方回退旧的
 * svg data URI 嵌入（PowerPoint 2016+ 仍可见），不阻断出片。
 */
import { createRequire } from 'node:module'

/** 光栅化分辨率（像素/英寸）：元素英寸尺寸 × PPI = 输出像素。 */
export const PPTX_RASTER_PPI = 200

interface RenderedPng {
  render(): { asPng(): Uint8Array }
}
type ResvgCtor = new (svg: string, opts: Record<string, unknown>) => RenderedPng

let resvgCtor: ResvgCtor | null | undefined

function loadResvg(): ResvgCtor | null {
  if (resvgCtor !== undefined) return resvgCtor
  const require = createRequire(import.meta.url)
  try {
    const mod = require('@resvg/resvg-js') as { Resvg?: ResvgCtor }
    resvgCtor = typeof mod.Resvg === 'function' ? mod.Resvg : null
  } catch {
    resvgCtor = null
  }
  return resvgCtor
}

/** 根标签重复 viewBox 去重：历史 deck 落盘的 svg 可能带两个 viewBox（0.17.2 前
 *  normalizeSvgRoot 重写根标签时未剥原 viewBox），浏览器容忍、resvg 严格拒绝。 */
function dedupeRootViewBox(svg: string): string {
  return svg.replace(/<svg\b[^>]*>/gi, open => {
    let seen = 0
    return open.replace(/\sviewBox\s*=\s*("[^"]*"|'[^']*')/gi, match => ((seen += 1) === 1 ? match : ''))
  })
}

/** 光栅化 SVG 为 pptxgenjs 可用的 PNG data URI；失败返回 undefined（调用方回退矢量嵌入）。 */
export function svgToPngDataUri(svg: string, widthPx: number, heightPx: number): string | undefined {
  const Resvg = loadResvg()
  if (Resvg === null) return undefined
  try {
    const png = new Resvg(dedupeRootViewBox(svg), {
      // resvg-js 的 fitTo 只有 width/height/zoom 单值模式（无 wh），按宽缩放保持比例；
      // 元素框比例与 viewBox 比例由版式适配保证一致，高度自然落在目标附近
      fitTo: { mode: 'width', value: Math.max(1, Math.round(widthPx)) },
      font: { loadSystemFonts: true, defaultFontFamily: 'Microsoft YaHei' },
    }).render().asPng()
    if (png.byteLength === 0) return undefined
    return `image/png;base64,${Buffer.from(png).toString('base64')}`
  } catch {
    return undefined
  }
}
