/**
 * SVG 光栅化与 PPTX 媒体兼容性（0.17.2 回归）：
 * pptxgenjs 的 image/svg+xml data URI 落盘为"伪 PNG 主 blip + svgBlip"双 media，
 * WPS/旧版 Office 读主 blip 解码失败即图消失——修复后嵌入前光栅化为真 PNG，
 * 包内 media 必须全部为有效 PNG、不再出现 .svg 条目。
 */
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { svgToPngDataUri } from '../src/rasterize.js'
import { renderDeckPptx } from '../src/render-pptx.js'
import { DeckStore } from '../src/deck-store.js'
import { getTheme, resolveDesignTheme } from '../src/themes.js'
import type { PageScene } from '../src/schema.js'

const SAMPLE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 222"><rect width="560" height="222" fill="#1E293B"/><text x="280" y="36" text-anchor="middle" font-family="Microsoft YaHei" font-size="20" fill="#F1F5F9">影响面</text></svg>'

describe('svgToPngDataUri', () => {
  it('光栅化为真 PNG data URI', () => {
    const uri = svgToPngDataUri(SAMPLE_SVG, 1120, 444)
    expect(uri).toMatch(/^image\/png;base64,/)
    const bytes = Buffer.from(uri!.split(',')[1], 'base64')
    expect(bytes.subarray(1, 4).toString()).toBe('PNG')
  })

  it('非法 SVG 返回 undefined（调用方回退矢量嵌入）', () => {
    expect(svgToPngDataUri('not an svg at all.........', 100, 100)).toBeUndefined()
  })

  it('根标签重复 viewBox（0.17.2 前落盘形态）去重后仍可光栅化', () => {
    const dupViewBox = SAMPLE_SVG.replace('<svg ', '<svg viewBox="0 0 560 222" ')
    expect((dupViewBox.match(/viewBox/g) ?? []).length).toBe(2)
    const uri = svgToPngDataUri(dupViewBox, 1120, 444)
    expect(uri).toMatch(/^image\/png;base64,/)
  })
})

describe('renderDeckPptx 媒体兼容性', () => {
  it('内联 svg 元素与整页 svg 页都不再产生伪 PNG / svg media', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ppt-raster-'))
    try {
      await mkdir(join(root, 'd1'), { recursive: true })
      const pages: PageScene[] = [
        {
          id: 'p001', sectionId: 's1', type: 'image-text', title: 'T',
          elements: [{ id: 'img1', kind: 'image', svg: SAMPLE_SVG, x: 1, y: 1, w: 5, h: 2 }],
        },
        { id: 'p002', sectionId: 's1', type: 'cards', title: 'S', svg: SAMPLE_SVG },
      ]
      const result = await renderDeckPptx({
        store: new DeckStore(root), deckId: 'd1', deckTitle: '光栅化回归',
        theme: resolveDesignTheme(getTheme('business-blue')!), pages,
      })
      const zip = unzipSync(new Uint8Array(await readFile(result.pptxPath)))
      const media = Object.keys(zip).filter(k => k.startsWith('ppt/media/') && !k.endsWith('/'))
      expect(media.length).toBeGreaterThan(0)
      expect(media.every(k => k.endsWith('.png'))).toBe(true)
      for (const key of media) {
        expect(Array.from(zip[key].subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]) // \x89PNG
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
