/**
 * 页面视觉自审（0.22.0，roadmap-visual-quality T3-4）：headless 浏览器对每页 1:1 截图 +
 * 确定性像素启发式，补结构校验判不了的视觉问题（左右失衡 / 垂直重心偏移 / 整页近乎空白）。
 *
 * 定位是 **warning 级提醒**（不拦截落盘/渲染，不进 scene_check 的 issues 闸门）——
 * 结构校验管"坐标合法"，这里管"看上去不对"，是弱模型盲写循环的最后一块反馈。
 * 截图落 deck 的 preview/audit/<pageId>.png（预览服务可直接访问，供模型/用户肉眼复核）。
 *
 * 环境约定（与 workspace-registry 的 PPT_STUDIO_WORKSPACE_REGISTRY 同风格，直读不走行配置）：
 *   PPT_STUDIO_AUDIT_BROWSER   指定浏览器可执行文件（缺省自动探测 Edge/Chrome 常见安装位）
 * 浏览器找不到 / 截图失败一律静默降级为 skipped 说明，绝不报错阻断主流程。
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { decodePng } from './color-extract.js'
import { readAssetBuffer } from './assets.js'
import { renderPageAuditHtml } from './render-html.js'
import type { PageScene, SceneElement } from './schema.js'
import type { ResolvedTheme } from './themes.js'
import type { DeckStore } from './deck-store.js'
import { CANVAS_H_IN, CANVAS_W_IN, inToPx } from './units.js'

type DecodedPng = NonNullable<ReturnType<typeof decodePng>>

// ---------------------------------------------------------------- 阈值（校准自 0.19/0.20 视觉门案例）

/**
 * 与背景色的 RGB 距离达到该值才算"内容像素"（墨水）：正文/标题/强装饰 ≥120，
 * 卡片浅底 tint50 ≈30、背景纹理 ≈50——阈值取 90 只计文字与强元素，
 * 纹理与浅色卡底天然被排除，失衡/空白判定不被它们稀释。
 */
const INK_RGB_DISTANCE = 90
/** 四角+边中点采样最大色距超过该值视为非均一背景（渐变结构页）——失衡规则对其跳过。 */
const BG_UNIFORM_SPREAD = 60
/** 内容像素占比低于该值判"整页近乎空白"（画框忘字/文字不可见类）。 */
const COVERAGE_EMPTY = 0.015
/** 列带密度超出底噪地板 ≥2 个百分点视为该带"有内容"（占据带）。 */
const OCCUPIED_ABOVE_FLOOR = 0.02
/** 失衡判定：少数半幅占据带 ≤1（近乎全空）且多数半幅 ≥2（确有内容）。 */
const OCCUPIED_MIN_FOR_CONTENT = 2
/** 内容质心 y 越出该区间判垂直失衡（存量回放校准：密排满版页受底部装饰条拉低，cy 实测 0.71–0.72 属正常——带放宽到 0.26–0.74；真挤压页实测 ≤0.28 或偏下悬空，仍被抓）。 */
const CENTER_Y_BAND: readonly [number, number] = [0.26, 0.74]
/** 水平列带数（底噪地板 = 列带密度的中位数）。 */
const H_BANDS = 24

// ---------------------------------------------------------------- 像素启发式（纯函数，单测覆盖）

export interface PageVisualMetrics {
  width: number
  height: number
  /** 内容像素（距背景色 ≥ INK_RGB_DISTANCE）占采样像素比例（含底噪） */
  coverage: number
  /** 均匀底噪地板（列带密度中位数——背景纹理/整宽装饰条等水平均匀元素） */
  inkFloor: number
  /** 最强列带超出地板的密度（≈0 说明全页没有任何带凸显——空白/纹理铺底的判据） */
  effectivePeak: number
  /** 背景是否均一（渐变结构页 false——失衡规则跳过） */
  backgroundUniform: boolean
  /** 左半幅内容像素占左半幅采样比例（右半幅同理；含底噪的原始值） */
  leftInk: number
  rightInk: number
  /** 左/右半幅的"占据带"数（0–12；占据 = 密度超出地板 ≥2pp）——失衡判定口径 */
  leftOccupiedBands: number
  rightOccupiedBands: number
  /** 内容质心 y（0–1；无内容时 undefined） */
  centerY: number | undefined
}

export type VisualAuditRule = 'VISUAL_EMPTY' | 'VISUAL_BALANCE_H' | 'VISUAL_BALANCE_V'

export interface VisualAuditIssue {
  pageId: string
  rule: VisualAuditRule
  level: 'warning'
  message: string
}

export interface PageVisualReport {
  pageId: string
  metrics: PageVisualMetrics
  issues: VisualAuditIssue[]
}

export interface AnalyzeOptions {
  /** 页面含位图照片（assetId 图）时失衡判定不可靠（照片本身即大面积"墨水"）——跳过失衡规则 */
  skipBalance?: boolean
  /**
   * 只跳过横向失衡：页面有整宽容器卡（icon-list 行卡/process 卡等）时，卡底 tint50 与
   * 背景纹理在像素上同档（实测距底色都 ≈17，无阈值窗口），审计对"结构已铺满整宽"失明——
   * 场景里声明了整宽容器就信结构，不再按像素报左右失衡（纵向重心仍判）。
   */
  skipHBalance?: boolean
}

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`

/**
 * 对一页解码后的像素执行确定性启发式。采样步长 2（足够稳定，~23 万样本/页）。
 * 背景色 = 全页量化直方图众数；渐变页由边框采样点色距识别并跳过失衡规则。
 *
 * 底噪地板（0.22.0 校准）：背景纹理（0.18.0 渲染器注入）与整宽装饰条对每条竖列带
 * 的贡献均匀（实测 ~2–3%），会垫高空置半幅稀释失衡判定——取 24 条列带密度的中位数
 * 为地板。失衡用"占据带"数（密度超出地板 ≥2pp 的列带）：半幅近乎全空 = 占据带 ≤1；
 * 空白用双口径：整体占比过低，或最强列带也不比地板凸多少（纹理铺底无内容）。
 */
export function analyzePagePixels(pixels: DecodedPng, options: AnalyzeOptions = {}): { metrics: PageVisualMetrics; issues: Array<Omit<VisualAuditIssue, 'pageId'>> } {
  const { width: w, height: h, rgb } = pixels
  const stride = 2
  const bg = dominantBackground(rgb, w, h, stride)
  const backgroundUniform = backgroundIsUniform(rgb, w, h)

  let sampled = 0
  let ink = 0
  let sumY = 0
  const bandInk = new Array<number>(H_BANDS).fill(0)
  const bandSampled = new Array<number>(H_BANDS).fill(0)
  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      const i = (y * w + x) * 3
      const band = Math.min(H_BANDS - 1, Math.floor((x / w) * H_BANDS))
      sampled += 1
      bandSampled[band]! += 1
      const d = Math.max(Math.abs(rgb[i]! - bg[0]), Math.abs(rgb[i + 1]! - bg[1]), Math.abs(rgb[i + 2]! - bg[2]))
      if (d < INK_RGB_DISTANCE) continue
      ink += 1
      bandInk[band]! += 1
      sumY += y
    }
  }
  const coverage = sampled > 0 ? ink / sampled : 0
  const bandDensity = bandInk.map((count, b) => (bandSampled[b]! > 0 ? count / bandSampled[b]! : 0))
  // 地板取第 10 百分位列带密度：只吸收"全列均匀"的纹理/整宽装饰基线，
  // 不吞整宽内容条（中位数会把"仅一条整宽标题带"的页面整条当地板——单测抓出）
  const floor = [...bandDensity].sort((a, b) => a - b)[Math.floor(H_BANDS / 10)]!
  const effective = bandDensity.map(d => d - floor)
  const effectivePeak = Math.max(...effective, 0)
  const halfBands = H_BANDS / 2
  const occupied = effective.map(d => d >= OCCUPIED_ABOVE_FLOOR)
  const leftOccupiedBands = occupied.slice(0, halfBands).filter(Boolean).length
  const rightOccupiedBands = occupied.slice(halfBands).filter(Boolean).length
  const halfSampled = Math.max(1, Math.floor(sampled / 2))
  const leftRaw = bandInk.slice(0, halfBands).reduce((s, v) => s + v, 0) / halfSampled
  const rightRaw = bandInk.slice(halfBands).reduce((s, v) => s + v, 0) / halfSampled
  const metrics: PageVisualMetrics = {
    width: w,
    height: h,
    coverage,
    inkFloor: floor,
    effectivePeak,
    backgroundUniform,
    leftInk: leftRaw,
    rightInk: rightRaw,
    leftOccupiedBands,
    rightOccupiedBands,
    centerY: ink > 0 ? sumY / ink / h : undefined,
  }

  const issues: Array<Omit<VisualAuditIssue, 'pageId'>> = []
  if (coverage < COVERAGE_EMPTY || effectivePeak < COVERAGE_EMPTY) {
    issues.push({ rule: 'VISUAL_EMPTY', level: 'warning', message: `整页近乎空白（内容像素 ${pct(coverage)}，最强列带仅高出底噪 ${pct(effectivePeak)}）——疑似漏写内容、只有装饰/纹理铺底、或文字与背景同色不可见，逐元素核对` })
    return { metrics, issues }
  }
  if (options.skipBalance === true || !backgroundUniform) return { metrics, issues }

  const minOccupied = Math.min(leftOccupiedBands, rightOccupiedBands)
  const maxOccupied = Math.max(leftOccupiedBands, rightOccupiedBands)
  if (options.skipHBalance !== true && minOccupied <= 1 && maxOccupied >= OCCUPIED_MIN_FOR_CONTENT) {
    const emptySide = rightOccupiedBands < leftOccupiedBands ? '右' : '左'
    issues.push({
      rule: 'VISUAL_BALANCE_H',
      level: 'warning',
      message: `左右失衡：${emptySide}半幅近乎空置（占据列带 ${String(minOccupied)}/12，另一侧 ${String(maxOccupied)}/12）——单列内容应整宽行卡排版或内容居中，参考 0.20.0 icon-list 行卡改法`,
    })
  }
  const centerY = metrics.centerY ?? 0.5
  if (centerY < CENTER_Y_BAND[0] || centerY > CENTER_Y_BAND[1]) {
    issues.push({
      rule: 'VISUAL_BALANCE_V',
      level: 'warning',
      message: `垂直重心偏${centerY < 0.5 ? '上' : '下'}（质心 y=${centerY.toFixed(2)}，合理区间 0.26–0.74）——内容集中页面一角，稀疏页应垂直居中（0.12.0 稀疏自适应同思路）`,
    })
  }
  return { metrics, issues }
}

/** 背景色估计：RGB 各通道 5bit 量化直方图众数（同一物理页确定性一致）。 */
function dominantBackground(rgb: Uint8Array, w: number, h: number, stride: number): [number, number, number] {
  const histogram = new Map<number, number>()
  let bestKey = -1
  let bestCount = 0
  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      const i = (y * w + x) * 3
      const key = ((rgb[i]! >> 3) << 10) | ((rgb[i + 1]! >> 3) << 5) | (rgb[i + 2]! >> 3)
      const count = (histogram.get(key) ?? 0) + 1
      histogram.set(key, count)
      if (count > bestCount) {
        bestCount = count
        bestKey = key
      }
    }
  }
  if (bestKey < 0) return [255, 255, 255]
  return [((bestKey >> 10) & 31) << 3, ((bestKey >> 5) & 31) << 3, (bestKey & 31) << 3]
}

/** 均一背景判定：四角+四边中点采样，最大两两色距 ≤ BG_UNIFORM_SPREAD。 */
function backgroundIsUniform(rgb: Uint8Array, w: number, h: number): boolean {
  const inset = 2
  const points: Array<[number, number]> = [
    [inset, inset], [w - inset - 1, inset], [inset, h - inset - 1], [w - inset - 1, h - inset - 1],
    [Math.floor(w / 2), inset], [Math.floor(w / 2), h - inset - 1], [inset, Math.floor(h / 2)], [w - inset - 1, Math.floor(h / 2)],
  ]
  const samples = points.map(([x, y]) => {
    const i = (y * w + x) * 3
    return [rgb[i]!, rgb[i + 1]!, rgb[i + 2]!] as const
  })
  for (let a = 0; a < samples.length; a++) {
    for (let b = a + 1; b < samples.length; b++) {
      const [p, q] = [samples[a]!, samples[b]!]
      const distance = Math.sqrt((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2)
      if (distance > BG_UNIFORM_SPREAD) return false
    }
  }
  return true
}

// ---------------------------------------------------------------- headless 浏览器

const SHOT_W = Math.round(inToPx(CANVAS_W_IN))
const SHOT_H = Math.round(inToPx(CANVAS_H_IN))

/** 探测可用 headless 浏览器（Edge 优先——Windows 内网机最普遍；可用 PPT_STUDIO_AUDIT_BROWSER 覆盖）。 */
export function findHeadlessBrowser(): string | undefined {
  const override = process.env.PPT_STUDIO_AUDIT_BROWSER
  if (override !== undefined && override !== '') return existsSync(override) ? override : undefined
  const localApp = process.env.LOCALAPPDATA
  const candidates = process.platform === 'win32'
    ? [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      ...(localApp !== undefined ? [join(localApp, 'Microsoft', 'Edge', 'Application', 'msedge.exe')] : []),
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ...(localApp !== undefined ? [join(localApp, 'Google', 'Chrome', 'Application', 'chrome.exe')] : []),
    ]
    : process.platform === 'darwin'
      ? ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  return candidates.find(candidate => existsSync(candidate))
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47])

/** 单页截图（每页独立 user-data-dir——连拍共用 profile 会静默不截，sessionlog 实测）。 */
async function capturePagePng(browserPath: string, htmlPath: string, outPng: string, profileDir: string, timeoutMs = 20000): Promise<boolean> {
  return await new Promise(resolve => {
    let settled = false
    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(ok)
    }
    const child = spawn(browserPath, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', `--user-data-dir=${profileDir}`,
      `--screenshot=${outPng}`, `--window-size=${SHOT_W},${SHOT_H}`, '--virtual-time-budget=5000',
      pathToFileURL(htmlPath).href,
    ], { stdio: 'ignore' })
    const timer = setTimeout(() => {
      child.kill()
      finish(false)
    }, timeoutMs)
    child.once('error', () => finish(false))
    child.once('exit', () => {
      finish(existsSync(outPng) && readFileSync(outPng).subarray(0, 4).equals(PNG_SIGNATURE))
    })
  })
}

// ---------------------------------------------------------------- deck 级编排

/** 整宽容器判定：shape 元素宽 ≥75% 画布且高 ≥0.4in（icon-list 行卡/process 卡；背景标记不排除——行卡本身是 background 衬底，窄装饰条被宽度条件天然过滤）。 */
export function hasFullWidthContainer(page: PageScene): boolean {
  return (page.elements ?? []).some(el => {
    if (el.kind !== 'shape') return false
    const box = el as { w: number; h: number }
    return box.w >= CANVAS_W_IN * 0.75 && box.h >= 0.4
  })
}

export interface DeckVisualAuditOptions {
  store: DeckStore
  deckId: string
  theme: ResolvedTheme
  pages: PageScene[]
  /** 显式指定浏览器（测试/覆盖）；null 表示明确禁用（跳过探测，直接返回 skipped 说明） */
  browserPath?: string | null
  /** 只审这些页（缺省全部）——修改循环聚焦变更页，省逐页截图开销 */
  pageIds?: string[]
}

export interface DeckVisualAuditResult {
  browser: string
  pagesAudited: string[]
  skippedPages: string[]
  issues: VisualAuditIssue[]
  reports: PageVisualReport[]
  durationMs: number
  note?: string
}

/**
 * 逐页：renderPageAuditHtml → headless 截图（落 preview/audit/<pageId>.png）→ decodePng → 启发式。
 * 任一页截图失败视为环境问题，余下页不再逐个等超时（note 说明）；全程不抛错。
 */
export async function auditDeckPages(options: DeckVisualAuditOptions): Promise<DeckVisualAuditResult> {
  const started = Date.now()
  const browserPath = options.browserPath === null
    ? undefined
    : options.browserPath !== undefined && options.browserPath !== ''
      ? options.browserPath
      : findHeadlessBrowser()
  if (browserPath === undefined) {
    return {
      browser: '(未找到)',
      pagesAudited: [],
      skippedPages: options.pages.map(p => p.id),
      issues: [],
      reports: [],
      durationMs: 0,
      note: '未找到可用的 headless 浏览器（Edge/Chrome），像素自审跳过——可设 PPT_STUDIO_AUDIT_BROWSER 指定路径',
    }
  }

  const manifest = await options.store.loadManifest(options.deckId)
  const assetData = new Map<string, { mime: string; base64: string }>()
  for (const entry of manifest.assets) {
    const asset = await readAssetBuffer(options.store, options.deckId, entry.assetId)
    if (asset !== undefined) assetData.set(entry.assetId, { mime: asset.entry.mime, base64: asset.buffer.toString('base64') })
  }
  const targets = options.pageIds !== undefined
    ? options.pages.filter(p => options.pageIds!.includes(p.id))
    : options.pages

  const workDir = await mkdtemp(join(tmpdir(), 'ppt-visual-audit-'))
  // 截图目录：清掉上一次审计的旧图再全量写入（避免删页后残留误导肉眼复核）
  const shotDir = join(options.store.paths(options.deckId).previewDir, 'audit')
  await rm(shotDir, { recursive: true, force: true }).catch(() => {})
  await mkdir(shotDir, { recursive: true })

  const pagesAudited: string[] = []
  const skippedPages: string[] = []
  const reports: PageVisualReport[] = []
  const issues: VisualAuditIssue[] = []
  let aborted = false
  let note: string | undefined
  for (const [index, page] of targets.entries()) {
    if (aborted) {
      skippedPages.push(page.id)
      continue
    }
    const htmlPath = join(workDir, `${page.id}.html`)
    await writeFile(htmlPath, renderPageAuditHtml({ page, theme: options.theme, assetData }), 'utf8')
    const outPng = join(shotDir, `${page.id}.png`)
    const captured = await capturePagePng(browserPath, htmlPath, outPng, join(workDir, `profile-${page.id}`))
    const pixels = captured ? decodePng(readFileSync(outPng)) : undefined
    if (pixels === undefined) {
      skippedPages.push(page.id)
      note = pagesAudited.length === 0
        ? `headless 截图失败（浏览器 ${browserPath}）——像素自审整体跳过，不影响渲染产物`
        : `第 ${index + 1} 页起 headless 截图失败，余下页跳过（已审 ${pagesAudited.length} 页）`
      aborted = true
      continue
    }
    // 结构页（cover/toc/section/closing）是引擎规范版式——左竖条目录/上置标题属设计性不对称，
    // 像素层判失衡只会出系统性误报（存量回放：5 册的 toc 页全部误报 H）；位图照片页照片即
    // 大面积墨水，失衡判定同样不可靠。两者双向免判；整宽容器卡页只免横向（卡底与纹理像素同档）。
    const isStructural = page.type === 'cover' || page.type === 'toc' || page.type === 'section' || page.type === 'closing'
    const hasPhoto = (page.elements ?? []).some((el: SceneElement) =>
      el.kind === 'image' && (el as { assetId?: string }).assetId !== undefined)
    const { metrics, issues: pageIssues } = analyzePagePixels(pixels, {
      skipBalance: hasPhoto || isStructural,
      skipHBalance: hasFullWidthContainer(page),
    })
    pagesAudited.push(page.id)
    const pageIssuesWithId = pageIssues.map(issue => ({ ...issue, pageId: page.id }))
    reports.push({ pageId: page.id, metrics, issues: pageIssuesWithId })
    issues.push(...pageIssuesWithId)
  }
  if (reports.length === 0) await rm(shotDir, { recursive: true, force: true }).catch(() => {})
  await rm(workDir, { recursive: true, force: true }).catch(() => {})
  return {
    browser: browserPath,
    pagesAudited,
    skippedPages,
    issues,
    reports,
    durationMs: Date.now() - started,
    ...(note !== undefined ? { note } : {}),
  }
}

/** 预览 URL 相对路径（供工具回执提示用户/模型看图复核）。 */
export function auditShotRelPath(pageId: string): string {
  return `audit/${pageId}.png`
}

/** 目录下全部审计截图文件名（测试断言用）。 */
export async function listAuditShots(previewDir: string): Promise<string[]> {
  return await readdir(join(previewDir, 'audit')).catch(() => [])
}
