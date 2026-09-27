/**
 * 0.22.0 T3-4 像素自审：analyzePagePixels 纯启发式单测（合成像素网格，无浏览器依赖）。
 * 阈值语义见 src/visual-audit.ts 常量注释。
 */
import { describe, expect, it } from 'vitest'
import { analyzePagePixels, findHeadlessBrowser, hasFullWidthContainer } from '../src/visual-audit.js'

interface Rect { x0: number; y0: number; x1: number; y1: number; color: [number, number, number] }

/** 合成 16:9 像素页：bg 底色 + 若干实心矩形（模拟文字块/强装饰）。 */
function grid(w: number, h: number, bg: [number, number, number], rects: Rect[]): { width: number; height: number; rgb: Uint8Array } {
  const rgb = new Uint8Array(w * h * 3)
  for (let i = 0; i < w * h; i++) {
    rgb[i * 3] = bg[0]!
    rgb[i * 3 + 1] = bg[1]!
    rgb[i * 3 + 2] = bg[2]!
  }
  for (const r of rects) {
    for (let y = r.y0; y < Math.min(r.y1, h); y++) {
      for (let x = r.x0; x < Math.min(r.x1, w); x++) {
        const i = (y * w + x) * 3
        rgb[i] = r.color[0]!
        rgb[i + 1] = r.color[1]!
        rgb[i + 2] = r.color[2]!
      }
    }
  }
  return { width: w, height: h, rgb }
}

const W = 384 // 24 列带 × 16px 对齐（底噪条纹按 8px 周期铺，保证逐带密度完全一致）
const H = 225

/** 文本块：每 4px 一条 1px 横线（局部密度 25%，模拟文字笔画——真实页面是"浅底+稀疏笔画"，不能用实心大色块，否则色块反成多数色被当背景）。 */
function textRows(x0: number, y0: number, x1: number, y1: number, color: [number, number, number] = INK): Rect[] {
  const rows: Rect[] = []
  for (let y = y0; y < y1; y += 4) rows.push({ x0, y0: y, x1, y1: y + 1, color })
  return rows
}
const INK: [number, number, number] = [30, 41, 59] // 深灰文字色（距白底 ~215）
const rules = (result: { issues: Array<{ rule: string }> }): string[] => result.issues.map(i => i.rule)

describe('analyzePagePixels 确定性启发式', () => {
  it('均衡满宽内容：零提醒', () => {
    const page = grid(W, H, [255, 255, 255], [
      ...textRows(30, 20, 370, 34), // 顶部标题条（整宽文本）
      ...textRows(30, 60, 370, 200), // 内容区（整宽文本）
    ])
    const result = analyzePagePixels(page)
    expect(rules(result)).toEqual([])
    expect(result.metrics.backgroundUniform).toBe(true)
    expect(result.metrics.coverage).toBeGreaterThan(0.1)
    expect(result.metrics.centerY).toBeGreaterThan(0.3)
    expect(result.metrics.centerY).toBeLessThan(0.7)
  })

  it('内容只占左半幅（0.19 icon-list 旧版形态）：VISUAL_BALANCE_H', () => {
    const page = grid(W, H, [255, 255, 255], [
      ...textRows(20, 20, 170, 34),
      ...textRows(20, 60, 170, 200),
    ])
    const result = analyzePagePixels(page)
    expect(rules(result)).toContain('VISUAL_BALANCE_H')
    expect(result.metrics.rightInk).toBeLessThan(result.metrics.leftInk)
  })

  it('内容挤压在顶部：VISUAL_BALANCE_V', () => {
    const page = grid(W, H, [255, 255, 255], textRows(30, 10, 370, 60))
    const result = analyzePagePixels(page)
    expect(rules(result)).toContain('VISUAL_BALANCE_V')
    expect(result.metrics.centerY).toBeLessThan(0.3)
  })

  it('整页近乎空白：VISUAL_EMPTY', () => {
    const page = grid(W, H, [255, 255, 255], [{ x0: 190, y0: 110, x1: 210, y1: 118, color: INK }])
    const result = analyzePagePixels(page)
    expect(rules(result)).toContain('VISUAL_EMPTY')
    expect(result.metrics.coverage).toBeLessThan(0.015)
  })

  it('渐变背景（结构页）：backgroundUniform=false，失衡规则跳过', () => {
    // 左深右浅的双色"渐变"（边框采样点色距 > 60）
    const rects: Rect[] = [{ x0: 0, y0: 0, x1: W / 2, y1: H, color: [11, 30, 59] }]
    const page = grid(W, H, [76, 29, 149], rects)
    // 再加只占左 1/4 的内容——均一背景下会判失衡，渐变下应跳过
    rects.push(...textRows(10, 80, 100, 150, [255, 255, 255]))
    const page2 = grid(W, H, [76, 29, 149], rects)
    const result = analyzePagePixels(page2)
    expect(analyzePagePixels(page).metrics.backgroundUniform).toBe(false)
    expect(result.metrics.backgroundUniform).toBe(false)
    expect(rules(result)).not.toContain('VISUAL_BALANCE_H')
  })

  it('浅色卡底/纹理幅面不计入墨水（INK_RGB_DISTANCE 阈值）', () => {
    // 大面积 tint50 浅色卡底（距白底 ~15）+ 文本行：coverage 只算文本
    const page = grid(W, H, [255, 255, 255], [
      { x0: 20, y0: 40, x1: 380, y1: 210, color: [240, 244, 250] },
      ...textRows(40, 60, 360, 80),
      ...textRows(40, 100, 360, 120),
    ])
    const result = analyzePagePixels(page)
    expect(result.metrics.coverage).toBeLessThan(0.1) // 卡底未稀释墨水占比
    expect(rules(result)).toEqual([])
  })

  it('skipBalance（位图照片页）跳过失衡判定', () => {
    const page = grid(W, H, [255, 255, 255], [
      ...textRows(20, 20, 170, 210), // 只有左半幅
    ])
    expect(rules(analyzePagePixels(page))).toContain('VISUAL_BALANCE_H')
    expect(rules(analyzePagePixels(page, { skipBalance: true }))).not.toContain('VISUAL_BALANCE_H')
  })

  it('均匀底噪（背景纹理/整宽装饰）不稀释失衡判定——0.22.0 冒烟校准的回归', () => {
    // 全页均匀竖条纹底噪（每 8px 中 2px 墨 ≈25% 密度、逐列带均匀，模拟 0.18.0 背景纹理），
    // 内容只占左半幅——底噪会垫高空置半幅（旧口径 raw ratio 0.51 漏判），占据带口径应抓住
    const speckles: Rect[] = []
    for (let x = 6; x < W; x += 8) speckles.push({ x0: x, y0: 0, x1: x + 2, y1: H, color: INK }) // 偏移避开均匀性采样点 x∈{2,192,381}
    const page = grid(W, H, [255, 255, 255], [
      ...speckles,
      ...textRows(20, 40, 170, 70, [180, 28, 28]),
      ...textRows(20, 100, 170, 130, [180, 28, 28]),
      ...textRows(20, 160, 170, 190, [180, 28, 28]),
    ])
    const result = analyzePagePixels(page)
    expect(result.metrics.inkFloor).toBeGreaterThan(0.15) // 底噪确实存在
    expect(rules(result)).toContain('VISUAL_BALANCE_H')
    // 只有底噪（无任何内容）→ 空白：最强列带不比地板凸多少
    const textureOnly = grid(W, H, [255, 255, 255], speckles)
    expect(rules(analyzePagePixels(textureOnly))).toContain('VISUAL_EMPTY')
  })
})

describe('findHeadlessBrowser 探测', () => {
  it('PPT_STUDIO_AUDIT_BROWSER 指定存在路径 → 原样返回；不存在 → undefined', () => {
    const previous = process.env.PPT_STUDIO_AUDIT_BROWSER
    try {
      process.env.PPT_STUDIO_AUDIT_BROWSER = process.execPath
      expect(findHeadlessBrowser()).toBe(process.execPath)
      process.env.PPT_STUDIO_AUDIT_BROWSER = 'Z:\\definitely\\not\\a\\browser.exe'
      expect(findHeadlessBrowser()).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.PPT_STUDIO_AUDIT_BROWSER
      else process.env.PPT_STUDIO_AUDIT_BROWSER = previous
    }
  })
})

describe('hasFullWidthContainer 场景谓词（整宽容器卡免判横向失衡）', () => {
  const pageWith = (elements: Array<Record<string, unknown>>): { elements: Array<Record<string, unknown>> } => ({ elements })
  it('icon-list 行卡（w≥10in h≥0.4in 的 roundRect，background 衬底不排除）→ true', () => {
    expect(hasFullWidthContainer(pageWith([
      { kind: 'shape', w: 12.13, h: 1, shape: 'roundRect', background: true },
    ]) as never)).toBe(true)
  })
  it('窄装饰条/小徽章/纯文本元素 → false', () => {
    expect(hasFullWidthContainer(pageWith([
      { kind: 'shape', w: 0.08, h: 4.8, shape: 'rect', background: true },
      { kind: 'shape', w: 0.5, h: 0.5, shape: 'ellipse' },
      { kind: 'text', w: 12.5, h: 0.8 },
    ]) as never)).toBe(false)
  })
})

describe('skipHBalance（整宽容器页只免横向）', () => {
  it('左重内容 + skipHBalance:true → 无 H 提醒；V 规则不受影响', () => {
    const page = grid(W, H, [255, 255, 255], [
      ...textRows(20, 20, 170, 210), // 左半幅内容
    ])
    const withoutSkip = analyzePagePixels(page)
    expect(withoutSkip.issues.map(i => i.rule)).toContain('VISUAL_BALANCE_H')
    const withSkip = analyzePagePixels(page, { skipHBalance: true })
    expect(withSkip.issues.map(i => i.rule)).not.toContain('VISUAL_BALANCE_H')
    // 顶部挤压页 + skipHBalance：V 仍要报（容器只解决横向盲区）
    const topOnly = grid(W, H, [255, 255, 255], textRows(30, 10, 370, 60))
    expect(analyzePagePixels(topOnly, { skipHBalance: true }).issues.map(i => i.rule)).toContain('VISUAL_BALANCE_V')
  })
})
