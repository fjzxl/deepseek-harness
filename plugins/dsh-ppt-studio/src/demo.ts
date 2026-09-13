/**
 * 端到端 demo：不经 DSH 宿主，用本地 Node 把完整流程真实跑一遍。
 *
 *   npm run demo        （= build + node lib/demo.js）
 *
 * 流程与 SKILL.md 一致（阶段 0–8，precise 模式 + business 证据等级）：
 *   ppt_brief_create → ppt_outline_draft → ppt_pageplan_confirm →
 *   ppt_section_draft(s0/s1/s2/s3，页条目带 transition 叙事衔接) →
 *   ppt_design_propose/lock（含 prototypePages 代表页）→
 *   阶段 4.5 Prototype：先写 3 个代表页看真实效果（p008 演示证据警告与修复）→
 *   ppt_page_write ×11 → ppt_scene_check（storyline 自审 + 时长估算）→ ppt_deck_render
 * 示例主题：给中学生介绍大模型（timeline/comparison/process/cards/icon-list 等新页型）。
 * 另外演示：本地图片登记（程序生成的 PNG）、生图接口未配置时的降级、日志查询。
 * 产物：ppt-studio/<deckId>/{deck.pptx, preview/index.html, report.json, design/, logs/}
 */
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { resolve } from 'node:path'
import { resolvePptStudioConfig } from './config.js'
import { buildPptStudioTools, type ToolDefinition } from './tools/index.js'
import { THEMES } from './themes.js'

// ---------------------------------------------------------------- PNG 生成（自绘测试图）

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([length, typeBuf, data, crc])
}

/** 生成一张渐变 PNG（用于测试图片资产管线，不依赖外部文件）。测试复用。 */
export function makeGradientPng(width: number, height: number, from: [number, number, number], to: [number, number, number]): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1)
    raw[rowStart] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2
      const offset = rowStart + 1 + x * 4
      raw[offset] = Math.round(from[0] + (to[0] - from[0]) * t)
      raw[offset + 1] = Math.round(from[1] + (to[1] - from[1]) * t)
      raw[offset + 2] = Math.round(from[2] + (to[2] - from[2]) * t)
      raw[offset + 3] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------------------------------------------------------------- 工具调用封装

const config = resolvePptStudioConfig({ outputDir: 'ppt-studio' })
const toolMap = new Map<string, ToolDefinition>(buildPptStudioTools(config).map(t => [t.name, t]))
const theme = THEMES.find(t => t.id === 'indigo-gradient')!
const C = theme.colors

async function call<T>(name: string, args: unknown): Promise<T> {
  const tool = toolMap.get(name)
  if (tool === undefined) throw new Error(`demo: 未知工具 ${name}`)
  const value = (await tool.execute(args, { signal: AbortSignal.timeout(120_000) })) as T
  for (const block of tool.output.render(args, value)) console.log(block.text)
  return value
}

function print(step: string): void {
  console.log(`\n========== ${step} ==========`)
}

// ---------------------------------------------------------------- 11 页场景（indigo-gradient）

interface BriefResult { deckId: string }
interface CheckResult { ok: boolean; sceneHash: string }
interface RenderResult { pptxPath: string; previewUrl: string; reportPath: string }

async function main(): Promise<void> {
  print('阶段 0 简报（听众/场景/目标/时长 + 选定靛蓝渐变主题 + precise 模式 + business 证据等级）')
  const brief = await call<BriefResult>('ppt_brief_create', {
    title: '走近大模型：AI 是怎么变聪明的',
    topic: '面向中学生的 AI 科普：从人工智能发展历程讲到 Transformer、多模态与具身智能，用类比和生活例子讲解',
    audience: '中学生（初一至高一，无编程基础）',
    scenario: '科技节科普讲座，配投影放映，需要生动直观',
    objective: '让中学生建立对大模型的正确直觉：AI 不是魔法，是从规则到数据一步步学出来的；并能举出身边的多模态/具身例子',
    durationMin: 40,
    themeId: 'indigo-gradient',
    tone: '科普体',
    density: 'normal',
    mode: 'precise',
    evidenceLevel: 'business',
  })

  print('阶段 1 叙事架构（核心主张 + 问题链）')
  await call('ppt_outline_draft', {
    deckId: brief.deckId,
    coreMessage: '大模型不是魔法：机器从"背人写的规则"走到"从数据自己学"，量变引发质变，现在它开始看、听、动手',
    parts: [
      { title: '人工智能发展历程', question: 'AI 是从哪里来的？', message: 'AI 经历了规则驱动 → 数据驱动 → 大模型的演进，每一代解决上一代搞不定的问题', suggestedPages: 4 },
      { title: 'Transformer 是什么', question: '为什么今天的大模型突然出现？', message: '注意力机制 + 超大规模参数，让"读懂上下文"的能力随规模跃升', suggestedPages: 2 },
      { title: '多模态与具身智能', question: 'AI 下一步会去哪里？', message: '从只会说话到能看能听能动手，智能正在走进现实世界', suggestedPages: 2 },
    ],
  })

  print('阶段 2 页数与分配（8 个内容页，+3 结构页 = 11 页；分配 4/2/2）')
  await call('ppt_pageplan_confirm', {
    deckId: brief.deckId,
    contentPages: 8,
    allocation: [{ sectionId: 's1', pages: 4 }, { sectionId: 's2', pages: 2 }, { sectionId: 's3', pages: 2 }],
  })

  print('阶段 3 页面蓝图（每页 purpose/keyMessage/structure/density/visual）')
  await call('ppt_section_draft', {
    deckId: brief.deckId,
    sectionId: 's0',
    pages: [
      { type: 'cover', title: '封面', contentBrief: '主标题 + 副标题 + 日期' },
      { type: 'toc', title: '目录', contentBrief: '三部分导览' },
      { type: 'closing', title: '结尾', contentBrief: '谢谢 + 鼓励提问' },
    ],
  })
  await call('ppt_section_draft', {
    deckId: brief.deckId,
    sectionId: 's1',
    pages: [
      { type: 'timeline', title: '发展历程总览', contentBrief: '时间轴：符号主义→专家系统→深度学习→具身智能', purpose: '先给全景框架，后面每页展开一代', keyMessage: '每一代 AI 都在解决上一代搞不定的问题', structure: 'timeline', density: 'medium', transition: { nextHook: '第一代"规则驱动"是怎么来的？' } },
      { type: 'bullets', title: '符号主义：教机器背规则', contentBrief: '人写规则机器执行；讲清思想与局限', purpose: '解释最早的 AI 思路与天花板', keyMessage: '规则是人教的，机器不会举一反三', structure: 'concept-example', density: 'medium', transition: { fromPrevious: '回答上一页的钩子：从最早"人教规则"讲起' } },
      { type: 'bullets', title: '专家系统：知识就是力量', contentBrief: '把专家经验写成规则库；医学诊断例子', purpose: '展示规则路线的巅峰与困境', keyMessage: '知识很值钱，但靠人搬知识太慢', structure: 'concept-example', density: 'medium', transition: { fromPrevious: '规则路线走到巅峰：把专家经验也变成规则' } },
      { type: 'comparison', title: '深度学习：让机器自己学', contentBrief: '符号主义 vs 深度学习左右对比', purpose: '点出范式切换：数据代替规则', keyMessage: '从"人教规则"到"数据里自己找规律"', structure: 'before-after', density: 'medium', transition: { fromPrevious: '规则路线碰到天花板，范式开始切换' } },
    ],
  })
  await call('ppt_section_draft', {
    deckId: brief.deckId,
    sectionId: 's2',
    pages: [
      { type: 'process', title: '模型怎么读懂一句话', contentBrief: '四步流程：文字→分词→注意力→输出', purpose: '用读句子的类比讲注意力机制', keyMessage: '注意力机制让每个词看全局，这是 Transformer 的核心', structure: 'process', density: 'medium', transition: { fromPrevious: '数据路线胜出后，看看模型内部怎么"读句子"' } },
      { type: 'chart', title: '参数量级的跨越', contentBrief: 'GPT-2/3/4 参数量柱图 + 右侧结论', purpose: '用数字感受"为什么是现在"', keyMessage: '参数规模三年涨了千倍，量变引发质变', structure: 'data-insight', density: 'low', visual: 'chart', transition: { fromPrevious: '有了会读句子的机制，规模成为下一个变量' } },
    ],
  })
  await call('ppt_section_draft', {
    deckId: brief.deckId,
    sectionId: 's3',
    pages: [
      { type: 'cards', title: '一个模型多种才艺（多模态）', contentBrief: '文/图/音/视四卡片', purpose: '展示大模型正在扩展感官', keyMessage: '同一个大脑，学会看、听、说', structure: 'concept-example', density: 'medium', transition: { fromPrevious: '规模到位之后，能力开始向感官扩展' } },
      { type: 'icon-list', title: '具身智能：有身体的 AI', contentBrief: '扫地机器人/自动驾驶/机械臂/人形机器人', purpose: '落到身边例子收尾，呼应"下一步"', keyMessage: '大模型给了大脑，身体让智能走进现实', structure: 'concept-example', density: 'medium', transition: { fromPrevious: '会看会听之后，最后一步是动手' } },
    ],
  })

  print('登记本地图片（程序生成的渐变 PNG 作为徽标）')
  const logoPath = resolve(process.cwd(), '.demo-logo.png')
  writeFileSync(logoPath, makeGradientPng(96, 96, [79, 70, 229], [124, 58, 237]))
  const asset = await call<{ assetId: string }>('ppt_asset_register', { deckId: brief.deckId, path: '.demo-logo.png' })
  if (existsSync(logoPath)) unlinkSync(logoPath)

  print('生图接口演示（未配置 → 应返回降级建议而非报错）')
  await call('ppt_image_generate', { deckId: brief.deckId, prompt: '卡通风格的中学生与机器人一起看星空' })

  print('阶段 4 设计规范确认（propose 2-3 套预设 → 模拟用户选定方案 A → 锁定）')
  const proposal = await call<{ schemes: Array<{ id: string; themeId: string; density: 'sparse' | 'normal' | 'dense'; themeName: string }> }>('ppt_design_propose', { deckId: brief.deckId })
  const chosen = proposal.schemes[0] // 模拟用户选定方案 A（简报原定）
  console.log(`用户选定：方案 ${chosen.id}（${chosen.themeName}，密度 ${chosen.density}）`)
  const lockResult = await call<{ spec: { prototypePages?: string[] } }>('ppt_design_lock', { deckId: brief.deckId, themeId: chosen.themeId, density: chosen.density })

  print('阶段 5 逐页生成（11 页，一气写完）')
  const logo = (id: string) => ({ id, kind: 'image' as const, assetId: asset.assetId, x: 11.9, y: 0.45, w: 0.95, h: 0.95, fit: 'cover' as const, name: 'logo' })
  const pageTitle = (id: string, text: string) => ({ id, kind: 'text' as const, x: 0.6, y: 0.45, w: 12.1, h: 0.75, fontSize: 26, color: C.text, align: 'left' as const, valign: 'top' as const, paragraphs: [{ text }] })
  const titleBar = (id: string) => ({ id, kind: 'shape' as const, shape: 'rect' as const, background: true, x: 0.62, y: 1.32, w: 0.9, h: 0.06, fill: C.primary })
  const card = (id: string, x: number, w: number) => ({ id, kind: 'shape' as const, shape: 'roundRect' as const, background: true, x, y: 1.8, w, h: 4.4, fill: C.surface, radius: 8 })

  const pages: Array<Record<string, unknown>> = [
    { // p001 封面
      background: { gradient: theme.heroGradient },
      notes: '开场：问同学们"你们用过 AI 吗"，从聊天机器人引入。',
      elements: [
        { id: 'cover-title', kind: 'text', x: 1.0, y: 2.5, w: 11.33, h: 1.3, fontSize: 40, color: C.onPrimary, align: 'center', valign: 'mid', paragraphs: [{ text: '走近大模型：AI 是怎么变聪明的' }] },
        { id: 'cover-sub', kind: 'text', x: 1.0, y: 4.0, w: 11.33, h: 0.5, fontSize: 18, color: C.onPrimary, align: 'center', paragraphs: [{ text: '中学生 AI 科普 · 科技节讲座 · 2026 年 9 月' }] },
        logo('cover-logo'),
        { id: 'cover-bar', kind: 'shape', shape: 'rect', background: true, x: 0, y: 7.15, w: 13.3333, h: 0.35, fill: C.accent },
      ],
    },
    { // p002 目录
      elements: [
        pageTitle('toc-title', '今天聊什么'),
        titleBar('toc-bar'),
        {
          id: 'toc-list', kind: 'text', x: 1.0, y: 1.8, w: 11.0, h: 4.6, fontSize: 18, color: C.text, paragraphs: [
            { text: '01  人工智能发展历程 —— 从背规则到自己学', spaceAfter: 16, bullet: { marker: '▸' } },
            { text: '02  Transformer 是什么 —— AI 的"阅读法"与规模', spaceAfter: 16, bullet: { marker: '▸' } },
            { text: '03  多模态与具身智能 —— 会看会听还会动手', bullet: { marker: '▸' } },
          ],
        },
      ],
    },
    { // p003 timeline 发展历程总览
      notes: '沿时间轴讲四代，每代一句话；强调"每一代都在解决上一代搞不定的问题"。',
      elements: [
        pageTitle('p3-title', '发展历程总览：AI 的四代演进'),
        titleBar('p3-bar'),
        { id: 'p3-axis', kind: 'shape', shape: 'rect', background: true, x: 5.0, y: 1.75, w: 0.05, h: 5.0, fill: C.secondary, opacity: 0.35 },
        ...[
          { year: '1950s', event: '符号主义：人写规则，机器照做', y: 1.9 },
          { year: '1980s', event: '专家系统：把专家经验装进电脑', y: 3.1 },
          { year: '2010s', event: '深度学习：从数据里自己学规律', y: 4.3 },
          { year: '今天', event: '具身智能：有身体、能动手的 AI', y: 5.5 },
        ].flatMap((node, i) => [
          { id: `p3-dot-${i}`, kind: 'shape' as const, shape: 'ellipse' as const, background: true, x: 4.92, y: node.y, w: 0.22, h: 0.22, fill: C.primary },
          { id: `p3-year-${i}`, kind: 'text' as const, x: 2.5, y: node.y - 0.08, w: 2.3, h: 0.4, fontSize: 16, bold: true, color: C.primary, align: 'right' as const, paragraphs: [{ text: node.year }] },
          { id: `p3-event-${i}`, kind: 'text' as const, x: 5.45, y: node.y - 0.08, w: 7.15, h: 0.4, fontSize: 15, color: C.text, paragraphs: [{ text: node.event }] },
        ]),
      ],
    },
    { // p004 bullets 符号主义
      notes: '类比：像背九九乘法表，规则是人教的，机器不会举一反三。',
      elements: [
        pageTitle('p4-title', '符号主义：教机器背规则'),
        titleBar('p4-bar'),
        {
          id: 'p4-list', kind: 'text', x: 0.9, y: 1.7, w: 11.5, h: 4.7, fontSize: 16, color: C.text, paragraphs: [
            { text: '核心思想：把知识写成一条条规则，机器负责执行', lineSpacing: 1.35, spaceAfter: 14, bullet: true },
            { text: '好比背乘法口诀：会算 7×8，但不懂为什么', lineSpacing: 1.35, spaceAfter: 14, bullet: true },
            { text: '局限：规则写不完，世界太复杂——识别一只猫要多少条规则？', lineSpacing: 1.35, bullet: true },
          ],
        },
        { id: 'p4-note', kind: 'text', x: 0.6, y: 6.75, w: 12.0, h: 0.3, fontSize: 11, color: C.textMuted, paragraphs: [{ text: '小结：聪明靠人教，天花板也在人。' }] },
      ],
    },
    { // p005 bullets 专家系统
      notes: 'MYCIN 例子：输入症状，系统按 600 条规则给出诊断建议。',
      elements: [
        pageTitle('p5-title', '专家系统：知识就是力量'),
        titleBar('p5-bar'),
        {
          id: 'p5-list', kind: 'text', x: 0.9, y: 1.7, w: 11.5, h: 4.7, fontSize: 16, color: C.text, paragraphs: [
            { text: '做法：把名医、老工程师的经验写成几百上千条规则', lineSpacing: 1.35, spaceAfter: 14, bullet: true },
            { text: '经典案例：医学系统 MYCIN，按规则链一步步推理诊断', lineSpacing: 1.35, spaceAfter: 14, bullet: true },
            { text: '辉煌与困境：能解题但维护成本高，换个领域就要重写', lineSpacing: 1.35, bullet: true },
          ],
        },
        { id: 'p5-note', kind: 'text', x: 0.6, y: 6.75, w: 12.0, h: 0.3, fontSize: 11, color: C.textMuted, paragraphs: [{ text: '小结：知识很值钱，但靠人搬知识太慢。' }] },
      ],
    },
    { // p006 comparison 深度学习 vs 符号主义
      notes: '左右对比讲解；强调"数据代替了规则"。',
      elements: [
        pageTitle('p6-title', '深度学习：让机器自己学'),
        titleBar('p6-bar'),
        card('p6-card-l', 0.6, 5.86),
        { id: 'p6-lt', kind: 'text', x: 0.95, y: 2.05, w: 5.16, h: 0.5, fontSize: 18, color: C.textMuted, bold: true, paragraphs: [{ text: '符号主义（旧）' }] },
        {
          id: 'p6-lb', kind: 'text', x: 0.95, y: 2.7, w: 5.16, h: 3.3, fontSize: 15, color: C.text, paragraphs: [
            { text: '人写规则，机器执行', spaceAfter: 10, bullet: true },
            { text: '换任务要重写规则', spaceAfter: 10, bullet: true },
            { text: '解释性强，但天花板低', bullet: true },
          ],
        },
        card('p6-card-r', 6.87, 5.86),
        { id: 'p6-rt', kind: 'text', x: 7.22, y: 2.05, w: 5.16, h: 0.5, fontSize: 18, color: C.primary, bold: true, paragraphs: [{ text: '深度学习（新）' }] },
        {
          id: 'p6-rb', kind: 'text', x: 7.22, y: 2.7, w: 5.16, h: 3.3, fontSize: 15, color: C.text, paragraphs: [
            { text: '喂大量数据，自己找规律', spaceAfter: 10, bullet: true },
            { text: '看图、听音、读文都适用', spaceAfter: 10, bullet: true },
            { text: '能力强，但像"黑盒子"', bullet: true },
          ],
        },
        { id: 'p6-vs-shape', kind: 'shape', shape: 'ellipse', background: true, x: 6.32, y: 3.6, w: 0.7, h: 0.7, fill: C.primary },
        { id: 'p6-vs-text', kind: 'text', x: 6.32, y: 3.6, w: 0.7, h: 0.7, fontSize: 14, bold: true, color: C.onPrimary, align: 'center', valign: 'mid', paragraphs: [{ text: 'VS' }] },
      ],
    },
    { // p007 process Transformer 读句子
      notes: '用"全班读课文划重点"类比注意力：每个词都在决定该关注谁。',
      elements: [
        pageTitle('p7-title', '模型怎么读懂一句话'),
        titleBar('p7-bar'),
        ...[
          { name: '读文字', desc: '一句话进来，先认识每个字词', x: 0.6, fill: C.primary },
          { name: '切词块', desc: '把句子切成小段（token）', x: 3.6, fill: C.secondary },
          { name: '注意力', desc: '每个词看全局，找最相关的词', x: 6.6, fill: C.secondary },
          { name: '出答案', desc: '综合理解，预测下个词', x: 9.6, fill: C.primary },
        ].flatMap((step, i) => [
          { id: `p7-ch-${i}`, kind: 'shape' as const, shape: 'chevron' as const, background: true, x: step.x, y: 2.4, w: 2.85, h: 1.1, fill: step.fill },
          { id: `p7-cht-${i}`, kind: 'text' as const, x: step.x + 0.25, y: 2.4, w: 2.45, h: 1.1, fontSize: 16, bold: true, color: C.onPrimary, align: 'center' as const, valign: 'mid' as const, paragraphs: [{ text: step.name }] },
          { id: `p7-desc-${i}`, kind: 'text' as const, x: step.x, y: 3.7, w: 2.85, h: 1.6, fontSize: 13, color: C.textMuted, paragraphs: [{ text: step.desc }] },
        ]),
        { id: 'p7-note', kind: 'text', x: 0.6, y: 5.8, w: 12.1, h: 0.5, fontSize: 15, color: C.text, paragraphs: [{ text: '这套"注意力"机制就是 Transformer——今天所有大模型的地基。' }] },
      ],
    },
    { // p008 chart 参数量级
      notes: '量级感知：GPT-3 的参数如果每人记一条，要全中国人口记 100 多条。',
      elements: [
        pageTitle('p8-title', '参数量级的跨越'),
        titleBar('p8-bar'),
        { id: 'p8-chart', kind: 'chart', x: 0.6, y: 1.7, w: 7.8, h: 4.7, chartType: 'column', title: '三代模型参数量（亿）', labels: ['GPT-2', 'GPT-3', 'GPT-4*'], series: [{ name: '参数量', values: [15, 1750, 18000] }], showValues: true, showLegend: false },
        {
          id: 'p8-note', kind: 'text', x: 8.8, y: 1.9, w: 3.9, h: 4.2, fontSize: 15, color: C.text, paragraphs: [
            { runs: [{ text: '三年涨了 1200 倍', bold: true, fontSize: 20, color: C.primary }], spaceAfter: 14 },
            { text: '参数像"脑内连接"', spaceAfter: 10, bullet: true },
            { text: '越多越能记住规律', spaceAfter: 10, bullet: true },
            { text: '但也要更多算力', bullet: true },
          ],
        },
        { id: 'p8-src', kind: 'text', x: 0.6, y: 6.75, w: 12.0, h: 0.3, fontSize: 11, color: C.textMuted, paragraphs: [{ text: '* GPT-4 为业界估计值；GPT-2/3 为公开论文数据。' }] },
      ],
    },
    { // p009 cards 多模态
      notes: '让同学举例自己见过的多模态应用（拍照搜题、语音助手）。',
      elements: [
        pageTitle('p9-title', '一个模型多种才艺（多模态）'),
        titleBar('p9-bar'),
        ...[
          { no: '01', title: '读文字', desc: '写作、翻译、答题，样样能干', x: 0.6 },
          { no: '02', title: '看图片', desc: '识图、修照片、看片断诊', x: 3.78 },
          { no: '03', title: '听声音', desc: '语音转文字、模仿人声', x: 6.96 },
          { no: '04', title: '看视频', desc: '理解剧情、生成短片', x: 10.13 },
        ].flatMap((item, i) => [
          card(`p9-card-${i}`, item.x, 2.9),
          { id: `p9-no-${i}`, kind: 'text' as const, x: item.x + 0.25, y: 2.05, w: 2.4, h: 0.5, fontSize: 24, bold: true, color: C.accent, paragraphs: [{ text: item.no }] },
          { id: `p9-t-${i}`, kind: 'text' as const, x: item.x + 0.25, y: 2.7, w: 2.4, h: 0.5, fontSize: 17, bold: true, color: C.text, paragraphs: [{ text: item.title }] },
          { id: `p9-d-${i}`, kind: 'text' as const, x: item.x + 0.25, y: 3.3, w: 2.4, h: 2.6, fontSize: 14, color: C.textMuted, paragraphs: [{ text: item.desc }] },
        ]),
      ],
    },
    { // p010 icon-list 具身智能
      notes: '收尾呼应：AI 正在从"会说"走向"会做"。',
      elements: [
        pageTitle('p10-title', '具身智能：有身体的 AI'),
        titleBar('p10-bar'),
        ...[
          { icon: '扫', text: '扫地机器人：自己认路、自己回充', y: 1.8 },
          { icon: '驶', text: '自动驾驶：看路况、做决策', y: 2.75 },
          { icon: '臂', text: '工厂机械臂：分拣、焊接、装配', y: 3.7 },
          { icon: '人', text: '人形机器人：还早期，但进步飞快', y: 4.65 },
        ].flatMap((row, i) => [
          { id: `p10-ic-${i}`, kind: 'shape' as const, shape: 'ellipse' as const, background: true, x: 0.9, y: row.y, w: 0.5, h: 0.5, fill: C.primary },
          { id: `p10-ict-${i}`, kind: 'text' as const, x: 0.9, y: row.y, w: 0.5, h: 0.5, fontSize: 15, bold: true, color: C.onPrimary, align: 'center' as const, valign: 'mid' as const, paragraphs: [{ text: row.icon }] },
          { id: `p10-t-${i}`, kind: 'text' as const, x: 1.7, y: row.y + 0.05, w: 10.9, h: 0.5, fontSize: 16, color: C.text, paragraphs: [{ text: row.text }] },
        ]),
        { id: 'p10-note', kind: 'text', x: 0.6, y: 6.1, w: 12.1, h: 0.5, fontSize: 15, color: C.textMuted, paragraphs: [{ text: '大模型给了它们"大脑"，身体让智能走进现实。' }] },
      ],
    },
    { // p011 closing
      background: { gradient: theme.heroGradient },
      notes: '收尾：鼓励提问；留一个思考题——"你觉得 AI 下一步学会什么"。',
      elements: [
        { id: 'end-title', kind: 'text', x: 1.0, y: 3.0, w: 11.33, h: 1.0, fontSize: 40, color: C.onPrimary, align: 'center', paragraphs: [{ text: '谢谢聆听' }] },
        { id: 'end-sub', kind: 'text', x: 1.0, y: 4.3, w: 11.33, h: 0.5, fontSize: 16, color: C.onPrimary, align: 'center', paragraphs: [{ text: '思考题：你觉得 AI 下一步会学会什么？ · 欢迎提问' }] },
        { id: 'end-bar', kind: 'shape', shape: 'rect', background: true, x: 0, y: 7.15, w: 13.3333, h: 0.35, fill: C.accent },
      ],
    },
  ]

  const pageById = new Map<string, Record<string, unknown>>(pages.map((scene, i) => [`p${String(i + 1).padStart(3, '0')}`, scene]))
  const writePage = async (pageId: string): Promise<{ ok: boolean }> => {
    console.log(`--- 写入 ${pageId}`)
    return await call<{ ok: boolean }>('ppt_page_write', { deckId: brief.deckId, pageId, scene: pageById.get(pageId) })
  }

  print('阶段 4.5 Prototype（precise 模式：先写 3 个代表页，让用户看真实渲染效果再批量）')
  const prototypePages = lockResult.spec.prototypePages ?? []
  for (const pageId of prototypePages) await writePage(pageId)
  await call('ppt_preview_update', { deckId: brief.deckId })

  print('证据层演示（business 级）：p008 数字页先无来源写入 → EVIDENCE_SOURCE_MISSING → 补 evidence 条目重写后消失')
  await writePage('p008') // 上方应出现 EVIDENCE_SOURCE_MISSING（数字论断 + 图表数据，无带来源的证据条目）
  await call('ppt_section_draft', {
    deckId: brief.deckId,
    sectionId: 's2',
    pages: [
      { type: 'process', title: '模型怎么读懂一句话', contentBrief: '四步流程：文字→分词→注意力→输出', purpose: '用读句子的类比讲注意力机制', keyMessage: '注意力机制让每个词看全局，这是 Transformer 的核心', structure: 'process', density: 'medium', transition: { fromPrevious: '数据路线胜出后，看看模型内部怎么"读句子"' } },
      {
        type: 'chart', title: '参数量级的跨越', contentBrief: 'GPT-2/3/4 参数量柱图 + 右侧结论', purpose: '用数字感受"为什么是现在"', keyMessage: '参数规模三年涨了千倍，量变引发质变', structure: 'data-insight', density: 'low', visual: 'chart', transition: { fromPrevious: '有了会读句子的机制，规模成为下一个变量' },
        evidence: [
          { claim: 'GPT-2 参数 15 亿、GPT-3 参数 1750 亿（公开论文数据）', type: 'data', source: '用户提供课件材料：模型论文公开数据' },
          { claim: 'GPT-4 参数量为业界估计值', type: 'fact', source: '用户提供课件材料：业界估计（页脚已标注 *）' },
        ],
      },
    ],
  })
  await writePage('p008') // 蓝图补上证据后重写，警告消失
  console.log('（模拟用户确认 Prototype 真实效果后，继续批量写其余页）')

  print('阶段 5 逐页生成（其余页，一气写完）')
  const written = new Set([...prototypePages, 'p008'])
  const remaining = [...pageById.keys()].filter(id => !written.has(id))
  for (let i = 0; i < remaining.length; i++) {
    const pageId = remaining[i]
    const result = await writePage(pageId)
    if (!result.ok) process.exitCode = 1
    if (pageId === 'p005') {
      // 第一部分（p003-p006）写完：演示即时预览（用户可边看边提修改，不阻塞后续部分）
      print('阶段 5 即时预览（第一部分完成）')
      await call('ppt_preview_update', { deckId: brief.deckId })
    }
  }

  print('阶段 6 全册集成校验（依赖感知：首次全部为变更页）')
  const check = await call<CheckResult>('ppt_scene_check', { deckId: brief.deckId })
  if (!check.ok) {
    console.error('校验未通过，终止渲染。请检查上方问题清单。')
    process.exitCode = 1
    return
  }

  print('阶段 7 渲染 PPTX + HTML 预览')
  const render = await call<RenderResult>('ppt_deck_render', { deckId: brief.deckId })

  print('日志与状态')
  await call('ppt_log_query', { deckId: brief.deckId, tail: 8 })
  await call('ppt_deck_status', { deckId: brief.deckId })

  print('阶段 8 修改循环演示：改 p004 一行文字 → 增量校验只报变更页')
  const revised = structuredClone(pages[3]) as { elements: Array<Record<string, unknown>> }
  const noteList = revised.elements.find(el => el.id === 'p4-note') as { paragraphs: Array<{ text: string }> }
  noteList.paragraphs[0].text = '小结：聪明靠人教，天花板也在人。（用户反馈后修订）'
  await call('ppt_page_write', { deckId: brief.deckId, pageId: 'p004', scene: revised })
  const recheck = await call<CheckResult & { revalidated: string[]; unchangedCount: number }>('ppt_scene_check', { deckId: brief.deckId })
  console.log(`增量校验：变更页 ${recheck.revalidated.join('、') ?? '（无）'}，未变 ${String(recheck.unchangedCount)} 页沿用结论。`)
  const rerender = await call<RenderResult>('ppt_deck_render', { deckId: brief.deckId })
  console.log(`重渲染完成：${rerender.pptxPath}`)

  console.log('\n================ demo 完成 ================')
  console.log(`deckId:    ${brief.deckId}`)
  console.log(`PPTX:     ${render.pptxPath}`)
  console.log(`预览:      ${render.previewUrl}`)
  console.log(`报告:      ${render.reportPath}`)
  console.log('启动预览服务：npm run preview  （然后打开上面的预览链接）')
  console.log('说明：封面/结尾渐变在 PPTX 端回退为纯色（渲染备注已记录）；图表为原生可编辑图表。')

  // 顺带自检：PPTX 确实存在且为 ZIP
  const pptxBytes = readFileSync(render.pptxPath)
  if (pptxBytes[0] !== 0x50 || pptxBytes[1] !== 0x4b) throw new Error('PPTX 文件头不是 PK，渲染异常')
  console.log(`自检通过：deck.pptx ${Math.round(pptxBytes.byteLength / 1024)} KB，ZIP 头正确`)
}

if (process.argv[1] !== undefined && process.argv[1].replace(/\\/g, '/').endsWith('demo.js')) {
  void main().catch(error => {
    console.error('demo 失败：', error)
    process.exitCode = 1
  })
}
