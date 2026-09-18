/**
 * ppt_page_write —— 逐页场景写入（带容错归一 + 确定性校验）。
 *
 * 场景 schema 见 src/schema.ts；版式规范见 skills/dsh-ppt-studio/reference/layouts.md。
 * 流程：normalizeSceneInput 容错归一 → zod 校验（失败时报错附出错元素原文与正确示例）
 * → validatePage 确定性校验（error 拒绝落盘；含锁定令牌/密度检查）→ 保存。
 */
import { z } from 'zod'
import { join } from 'node:path'
import { pageSceneSchema, PAGE_TYPES } from '../schema.js'
import type { DeckState, PageScene, SceneElement } from '../schema.js'
import { validatePage } from '../validate.js'
import { DeckStore, requireDeckState } from '../deck-store.js'
import { createDeckLogger } from '../logger.js'
import { normalizeSceneInput, previewJson } from '../normalize.js'
import { composeSceneFromContent, contentInputSchema, TYPE_REQUIREMENTS } from '../autolayout.js'
import { createToolLogger, failureStreak } from '../toollog.js'
import type { ResolvedPptStudioConfig } from '../config.js'
import { asRecord, oneText, resolveToolContext, type ToolDefinition } from './registry.js'

// ---------------------------------------------------------------- 元素 JSON Schema
// 模型在调用时要能看到元素结构（真实会话中因 schema 过简导致 49 次写页失败）。

const colorProp = { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$', description: '#RRGGBB' }
const baseProps: Record<string, unknown> = {
  id: { type: 'string', description: '元素 ID，字母开头，如 t-title / card-l' },
  name: { type: 'string', description: '可选，元素名（报错定位用）' },
  x: { type: 'number', description: '左上角 X（英寸），≥0.15' },
  y: { type: 'number', description: '左上角 Y（英寸），≥0.15' },
  w: { type: 'number', description: '宽（英寸）' },
  h: { type: 'number', description: '高（英寸）' },
  z: { type: 'integer', description: '可选，层级，大的在上' },
  background: { type: 'boolean', description: 'true = 装饰衬底，豁免越界/重叠校验' },
}

const textElementSchema = {
  type: 'object',
  description: '文本元素。注意：文字必须放在 paragraphs 数组里（不支持扁平 text 字段）。',
  properties: {
    ...baseProps,
    kind: { type: 'string', enum: ['text'] },
    fontSize: { type: 'number', description: '基准字号（磅），正文 ≥14' },
    color: colorProp,
    font: { type: 'string', description: '可选，字体名' },
    bold: { type: 'boolean' },
    italic: { type: 'boolean' },
    align: { type: 'string', enum: ['left', 'center', 'right'] },
    valign: { type: 'string', enum: ['top', 'mid', 'bottom'] },
    fill: { ...colorProp, description: '可选，文本框底色' },
    paragraphs: {
      type: 'array',
      minItems: 1,
      maxItems: 15,
      description: '段落数组。每段 {text:"…"} 或富文本 {runs:[{text, bold, fontSize, color, superscript, subscript}]}，可加 align/bullet/lineSpacing/spaceAfter。公式排版用 runs：上标 QK^T → "QK"+{"text":"T","superscript":true}，下标 d_k → "d"+{"text":"k","subscript":true}（勿用 Unicode ᵀ 或字面 ^/_ 记法，中文字体缺字形且显示错乱）',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '纯文本段落（与 runs 二选一）' },
          runs: {
            type: 'array',
            description: '富文本 run 数组（与 text 二选一）',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                bold: { type: 'boolean' },
                italic: { type: 'boolean' },
                color: colorProp,
                fontSize: { type: 'number' },
                superscript: { type: 'boolean', description: '上标：公式指数/转置（QK 的 T、d 的 -0.5）' },
                subscript: { type: 'boolean', description: '下标：变量下标（d 的 k、x 的 1）' },
              },
              required: ['text'],
            },
          },
          align: { type: 'string', enum: ['left', 'center', 'right'] },
          bullet: { description: 'true 用圆点；或 {marker:"▸"} 自定义符号', oneOf: [{ type: 'boolean' }, { type: 'object' }] },
          lineSpacing: { type: 'number', description: '行距倍数，默认 1.25' },
          spaceBefore: { type: 'number' },
          spaceAfter: { type: 'number' },
        },
      },
    },
  },
  required: ['kind', 'id', 'x', 'y', 'w', 'h', 'fontSize', 'color', 'paragraphs'],
}

const shapeElementSchema = {
  type: 'object',
  description: '形状元素（卡片衬底请加 background:true）',
  properties: {
    ...baseProps,
    kind: { type: 'string', enum: ['shape'] },
    shape: { type: 'string', enum: ['rect', 'roundRect', 'ellipse', 'triangle', 'diamond', 'chevron', 'rightArrow', 'pentagon', 'line'] },
    fill: { description: '#RRGGBB 或渐变 {from,to,angle}', oneOf: [colorProp, { type: 'object', properties: { from: colorProp, to: colorProp, angle: { type: 'number' } }, required: ['from', 'to'] }] },
    opacity: { type: 'number', description: '0-1' },
    border: { type: 'object', properties: { color: colorProp, width: { type: 'number' }, style: { type: 'string', enum: ['solid', 'dashed'] } }, required: ['color', 'width'] },
    radius: { type: 'number', description: 'roundRect 圆角（短边百分比 0-50），默认 12' },
  },
  required: ['kind', 'id', 'shape', 'x', 'y', 'w', 'h'],
}

const imageElementSchema = {
  type: 'object',
  description: '图片元素：assetId（已登记资产）或 placeholder（占位框）二选一',
  properties: {
    ...baseProps,
    kind: { type: 'string', enum: ['image'] },
    assetId: { type: 'string', description: 'ppt_asset_register / ppt_image_generate 返回的 ID' },
    placeholder: { type: 'object', properties: { prompt: { type: 'string', description: '建议配图说明' }, hint: { type: 'string' } }, required: ['prompt'] },
    fit: { type: 'string', enum: ['cover', 'contain', 'fill'], description: '默认 cover；fill 会拉伸慎用' },
    radius: { type: 'number', description: '圆角（短边百分比 0-50）' },
  },
  required: ['kind', 'id', 'x', 'y', 'w', 'h'],
}

const chartElementSchema = {
  type: 'object',
  description: '原生图表（PPTX 中可编辑数据）。饼图/环图只允许一个系列',
  properties: {
    ...baseProps,
    kind: { type: 'string', enum: ['chart'] },
    chartType: { type: 'string', enum: ['column', 'bar', 'line', 'area', 'pie', 'doughnut'] },
    title: { type: 'string' },
    labels: { type: 'array', items: { type: 'string' }, description: '类目标签' },
    series: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, values: { type: 'array', items: { type: 'number' }, description: '长度必须等于 labels' } },
        required: ['name', 'values'],
      },
    },
    showLegend: { type: 'boolean' },
    showValues: { type: 'boolean' },
    colors: { type: 'array', items: colorProp, description: '可选，覆盖主题图表色板' },
  },
  required: ['kind', 'id', 'chartType', 'x', 'y', 'w', 'h', 'labels', 'series'],
}

const tableElementSchema = {
  type: 'object',
  description: '表格（≤8 行 × ≤6 列，单元格 ≤16 字）',
  properties: {
    ...baseProps,
    kind: { type: 'string', enum: ['table'] },
    rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: '二维字符串数组，首行为表头' },
    headerRow: { type: 'boolean', description: '默认 true' },
    fontSize: { type: 'number', description: '默认 12，建议 ≥12' },
    colWidths: { type: 'array', items: { type: 'number' }, description: '可选，列宽比例' },
    zebra: { type: 'boolean', description: '斑马纹，默认 true' },
  },
  required: ['kind', 'id', 'x', 'y', 'w', 'h', 'rows'],
}

const elementSchemaAnyOf = [textElementSchema, shapeElementSchema, imageElementSchema, chartElementSchema, tableElementSchema]

// ---------------------------------------------------------------- 弱模型辅助闩锁

/** 写页连败达到此次数后切换弱模型 SOP（0.11.0；与熔断 5/逐页降级 3 同数量级、同一 plugin.log 数据源）。 */
const WEAK_ASSIST_AFTER = 3

const WEAK_ASSIST_GUIDE =
  '改用以下两种写法之一：\n' +
  '  ① scene.content 内容模式（推荐）：只传标题/条目/图表数据，版式由插件自动计算——' +
  '示例 {"deckId":"…","pageId":"p003","scene":{"content":{"title":"页标题","items":["要点一","要点二"]}}}；' +
  '图表页 {"content":{"chart":{"chartType":"column","labels":["Q1","Q2"],"series":[{"name":"营收","values":[10,20]}],"conclusion":"结论"}}}；\n' +
  '  ② ppt_page_skeleton {"deckId":"…","pageId":"p003"} 先从蓝图生成合法骨架页，再用 ppt_page_write {"append":true,"scene":{"elements":[…]}} 小步替换文字（append 增量修改不受本模式限制）。\n' +
  '（用户明确要求恢复完整手写元素模式时，可在调用参数带 "overrideAssist": true。）'

/**
 * 写页失败出口调用：ppt_page_write 连续失败 ≥WEAK_ASSIST_AFTER 次时落闩锁（deck 级持久）
 * 并返回 🔔 用户通知文本。与 0.10.3 逐页降级同模式：症状是原样重试死循环，治法是
 * 确定性地换一条对弱模型更友好的生成路径（内容模式/骨架+增量），不再指望模型自己改对坐标。
 */
async function bumpWeakModelAssist(store: DeckStore, state: DeckState): Promise<string | undefined> {
  if (state.weakModelAssist !== undefined) return undefined
  let streakErrors = 0
  try {
    streakErrors = failureStreak(await createToolLogger(store.rootDir).readTail(64), 'ppt_page_write').errors
  } catch { /* 统计失败不阻断业务 */ }
  const fails = streakErrors + 1 // 本次失败尚未记入 plugin.log（withDiagnostics 在 execute 返回后才记）
  if (fails < WEAK_ASSIST_AFTER) return undefined
  state.weakModelAssist = {
    enteredAt: new Date().toISOString(),
    reason: `ppt_page_write 连续失败 ${String(fails)} 次（多为坐标/容量/参数类校验拒绝——弱模型手写元素清单的典型失败面）`,
    fails,
  }
  await store.saveState(state)
  return `🔔 弱模型辅助模式已开启（检测到写页连续失败 ${String(fails)} 次）：此后裸 elements 整页替换将被拒绝，${WEAK_ASSIST_GUIDE}请把本段说明原样转述给用户。`
}

// ---------------------------------------------------------------- 工具

export function createPageTools(config: ResolvedPptStudioConfig): ToolDefinition[] {
  return [
    {
      name: 'ppt_page_write',
      description:
        'PPT 制作第 5 步：写入（或修改）单页场景，**按简报的渲染路线二选一**（0.10.0）——' +
        'native 路线（默认）有两种写法：**scene.content 内容模式（0.11.0，推荐，弱模型必用）**——只传标题/条目/图表数据等语义内容，版式引擎按页型模板自动展开元素清单（坐标/字号/锁定令牌/标题条全部自动），不会触发越界/互压/溢出类拒绝；' +
        '或 scene.elements 手写元素清单（**默认整页替换**，遗漏既有元素会被**拒绝保存**；增量优先 `append:true` + `remove:[id]` 合并语义——每元素 kind + id + x,y,w/h 英寸坐标，坐标与版式规则务必先读 layouts.md）。' +
        'svg 路线（brief.renderRoute="svg"）：scene.svg 提供整页 SVG 源码（`<svg viewBox="0 0 1280 720">`，整页替换语义、无 append），HTML 预览原生内联、PPTX 端整页矢量图嵌入（PowerPoint 2016+），只校验安全面（SVG_UNSAFE：脚本/外链/foreignObject 禁止）、画布（SVG_VIEWSIZE）与锁定色板——版式确定性规则不适用，写完务必 ppt_preview_update 肉眼把关。' +
        '**公式排版**（手写元素时）：用 runs 的 superscript/subscript（QK^T → "QK"+sup(T)；d_k → "d"+sub(k)），不要写 Unicode ᵀ（中文字体缺字形显示为方框）或字面 ^/_ 记法。' +
        'chart.labels 与 table.rows 写字符串（数字刻度/单元格也写 "32" 这样的字符串）。' +
        '写入时先做容错归一（扁平 text 自动展开、对象自动包数组、数字文本自动转字符串、labels/rows 数字自动转字符串、"key=#hex" 损坏键自动拆分），' +
        '再执行确定性校验（越界/文本互压/文字容量/图片登记/锁定令牌/信息密度/证据来源），有 error 时拒绝保存并返回问题清单与出错元素原文。' +
        '颜色与字体只能用 design/tokens.json 锁定的令牌；有主视觉（图/图表）的页面文字要精炼（DENSITY_WITH_VISUAL 会按 spec 预算提醒）。' +
        '**弱模型辅助模式**：写页连续失败 3 次后自动开启——裸 elements 整页替换被拒绝，只能用 content 内容模式或 ppt_page_skeleton 骨架 + append 小步增量（🔔 通知需转述用户）。中文：写入/更新单页 PPT 场景（内容模式 / native 元素 / 整页 SVG）。',
      parameters: {
        type: 'object',
        properties: {
          deckId: { type: 'string' },
          pageId: { type: 'string', description: '整册大纲中的页 ID，如 p003' },
          append: { type: 'boolean', description: 'true = 在现有页面基础上追加/替换元素（同 id 原位替换）；缺省 false = 整页替换（scene 必须是完整元素清单）' },
          allowDrop: { type: 'boolean', description: 'true = 确认丢弃整页替换中未包含的既有元素（有意删除时才用；缺省时丢元素会被拒绝保存）' },
          remove: { type: 'array', items: { type: 'string' }, description: '显式删除的元素 id 列表（合并语义）：与 append 搭配 = 保留未提及元素 + 同 id 原位替换 + 新 id 追加 + 删除指定元素；不触发丢元素闸门', maxItems: 24 },
          overrideAssist: { type: 'boolean', description: '仅弱模型辅助模式开启时相关：用户明确要求恢复完整手写元素模式时置 true（一般不用）' },
          scene: {
            type: 'object',
            description: '页面场景。native 路线：content 内容模式（推荐）或 elements 元素清单，二选一；svg 路线：svg 整页源码。sectionId/type/title 可省略（自动取整册大纲值）',
            properties: {
              type: { type: 'string', enum: [...PAGE_TYPES] },
              sectionId: { type: 'string' },
              title: { type: 'string' },
              content: {
                type: 'object',
                description:
                  '内容模式（0.11.0 版式引擎）：只传语义内容，插件按页型模板自动排版，产物走与手写页相同的全部校验。' +
                  'title 可省略（取蓝图标题）。各页型取用字段：bullets/icon-list → items:["要点一","要点二"]；two-col/comparison → columns:[{title,items:[…]}]（两项）；' +
                  'process → steps:[{name,desc}]；timeline → events:[{label,desc}]；cards → cards:[{title,desc}]（2-4 张）；hierarchy → layers:["顶层","中层","底层"]；' +
                  'big-number → bigNumber:{value:"5",unit:"倍",desc:"含义",source?}；chart → chart:{chartType:"column",labels:[…],series:[{name,values:[…]}],conclusion?}；' +
                  'table → table:{header:[…],rows:[[…]],note?}；quote → quote:{text,source?}；image-text → image:{assetId 或 prompt,heading?,items?}；' +
                  'toc → entries:["章节一","章节二"]；cover/closing → subtitle；notes 为演讲者备注（可选）',
                additionalProperties: true,
              },
              svg: {
                type: 'string',
                description: 'svg 路线专用：整页 SVG 源码（与 elements 二选一）。根元素必须 <svg viewBox="0 0 1280 720">；禁止 <script>/on* 事件/foreignObject/任何外部引用（内网红线：自包含，图片以 data URI 内嵌）；颜色用锁定色板的 hex；文字用 <text>/<tspan>（可被时长估算与论断扫描识别）；≤300K 字符',
              },
              background: {
                type: 'object',
                description: '{color:"#RRGGBB"} 或 {gradient:{from,to,angle}}',
                properties: {
                  color: colorProp,
                  gradient: { type: 'object', properties: { from: colorProp, to: colorProp, angle: { type: 'number' } }, required: ['from', 'to'] },
                },
              },
              notes: { type: 'string', description: '演讲者备注' },
              elements: {
                type: 'array',
                minItems: 1,
                maxItems: 24,
                description: '1-24 个元素；每个元素 kind 必须是 text/shape/image/chart/table 之一（手写坐标模式——优先考虑 content 内容模式）',
                items: { oneOf: elementSchemaAnyOf },
              },
            },
            required: [],
          },
        },
        required: ['deckId', 'pageId', 'scene'],
      },
      output: {
        schema: { type: 'object', properties: { pageId: { type: 'string' }, ok: { type: 'boolean' }, issues: { type: 'array' } }, additionalProperties: true },
        render: (_args, value) => {
          const v = asRecord(value)
          const issues = Array.isArray(v.issues) ? v.issues : []
          const lines: string[] = []
          if (v.ok === true) {
            if (v.appended !== undefined) {
              lines.push(`✅ 页面 ${String(v.pageId)} 已保存（追加 ${String(v.appended)} 个元素，现共 ${String(v.elementCount)} 个；错误 0，警告 ${String(v.warningCount)}）。`)
            } else {
              lines.push(`✅ 页面 ${String(v.pageId)} 已保存（错误 0，警告 ${String(v.warningCount)}）。`)
            }
          } else {
            lines.push(`❌ 页面 ${String(v.pageId)} 未通过校验，未保存：`)
          }
          for (const raw of issues) {
            const issue = asRecord(raw)
            const prefix = issue.rule === 'PAGE_ELEMENTS_DROPPED' ? '  [⚠️数据丢失] ' : `  [${String(issue.level)}] ${String(issue.rule)}：`
            const driftHint = issue.rule === 'STRUCTURE_TYPE_MISMATCH' ? '（若这页定位已实质改变，先重调 ppt_section_draft 更新该页蓝图的 structure/页型再写页——蓝图与实页保持一致）' : ''
            lines.push(`${prefix}${String(issue.message)}${driftHint}`)
          }
          const repairs = Array.isArray(v.repairs) ? v.repairs : []
          for (const repair of repairs) lines.push(`  [auto-fix] ${String(repair)}`)
          if (v.weakAssistNotice !== undefined && v.weakAssistNotice !== '') lines.push(`\n${String(v.weakAssistNotice)}`)
          lines.push(v.ok === true ? '继续下一页 ppt_page_write；全部页面完成后调 ppt_scene_check。' : '请按上述问题修正后重新调用 ppt_page_write。')
          return oneText(lines.join('\n'))
        },
      },
      execute: async (rawArgs, exec) => {
        exec?.signal?.throwIfAborted()
        const args = z
          .object({ deckId: z.string().min(1), pageId: z.string().min(1), append: z.boolean().optional(), allowDrop: z.boolean().optional(), remove: z.array(z.string().min(1).max(40)).max(24).optional(), overrideAssist: z.boolean().optional(), scene: z.record(z.unknown()) })
          .parse(asRecord(rawArgs))
        const { store } = resolveToolContext(config, exec)
        const state0 = await requireDeckState(store, args.deckId)
        if (state0.paused === true) {
          throw new Error('deck 已暂停生成（用户要求暂停）：写页被拒绝。恢复生成调 ppt_deck_pause {"deckId":"…","paused":false}')
        }
        // 架构修订闸门：revise 后旧设计令牌仍在盘上，必须重走 2（页数）→3（蓝图）→4（重新 lock）才能写页。
        // 注意不拦"写作中重草拟某部分"的合法修改循环（那只是阶段回落到 drafted，令牌仍有效）。
        if (state0.architectureRevisedAt !== undefined && state0.stage !== 'locked' && state0.stage !== 'writing' && state0.stage !== 'rendered') {
          throw new Error(
            `当前阶段为 ${state0.stage} 且检测到架构修订（revise）：需重走阶段 2 页数 → 3 蓝图 → 4 ppt_design_lock 重新锁定后才能写页`,
          )
        }
        const outline = await store.loadOutline(args.deckId)
        if (outline === undefined) throw new Error('必须先 ppt_outline_build 完成整册大纲')
        const outlinePage = outline.pages.find(p => p.id === args.pageId)
        if (outlinePage === undefined) throw new Error(`页 ${args.pageId} 不在整册大纲中`)
        const tokens = await store.loadTokens(args.deckId)
        if (tokens === undefined) throw new Error('必须先 ppt_design_lock 锁定设计（令牌缺失，写页会失去颜色/字体约束）')
        const spec = await store.loadSpec(args.deckId)
        const brief = await store.loadBrief(args.deckId)

        // 既有页面（append 合并与"替换丢元素"警告的基准；真实事故：模型分 5 次只传增量节点，
        // 整页替换语义把前 4 个节点静默丢掉——p014 只剩最后一个节点）
        const existing = await store.readJson<PageScene>(join(store.paths(args.deckId).pagesDir, `${args.pageId}.json`))

        // ---- 容错归一（真实会话中 49 次失败的形态在此修复）
        const { scene: normalized, repairs, invalidElements } = normalizeSceneInput(args.scene)

        const sceneInput = { ...(normalized as Record<string, unknown>), id: args.pageId, sectionId: outlinePage.sectionId } as Record<string, unknown>
        if (sceneInput.type === undefined) sceneInput.type = outlinePage.type
        if (sceneInput.title === undefined) sceneInput.title = outlinePage.title

        // ---- 渲染路线分派（0.10.0）：svg 路线的页面是整页 SVG 源码，无元素级语义
        const route = brief?.renderRoute ?? 'native'
        const isSvgPage = typeof sceneInput.svg === 'string' && sceneInput.svg !== ''
        if (isSvgPage && route !== 'svg') {
          throw new Error('本 deck 是 native 渲染路线（brief.renderRoute），不接受 scene.svg——SVG 自由绘制要在创建简报时选 renderRoute:"svg"。')
        }
        if (route === 'svg' && !isSvgPage) {
          throw new Error('本 deck 是 svg 渲染路线：scene 必须提供整页 svg 源码（<svg viewBox="0 0 1280 720">…</svg>），不使用 elements 元素清单。')
        }
        if (isSvgPage && (args.append === true || (args.remove?.length ?? 0) > 0)) {
          throw new Error('SVG 页是整页替换语义，不支持 append/remove（要改就重写整页 SVG 源码）。')
        }

        // ---- content 内容模式（0.11.0 版式引擎）：语义内容 → 确定性元素清单
        const rawContent = sceneInput.content
        const contentMode = rawContent !== undefined && rawContent !== null && typeof rawContent === 'object' && !Array.isArray(rawContent) && Object.keys(rawContent as Record<string, unknown>).length > 0
        if (contentMode && route === 'svg') {
          throw new Error('本 deck 是 svg 渲染路线：scene 必须提供整页 svg 源码，不支持 content 内容模式（版式引擎只服务 native 路线）。')
        }
        if (contentMode && (args.append === true || (args.remove?.length ?? 0) > 0)) {
          throw new Error('content 内容模式是整页生成（版式引擎自动排版），不支持 append/remove——微调请先用 content 生成整页，再用 elements + append:true 小步替换个别元素。')
        }

        // ---- 弱模型辅助闩锁（0.11.0）：连败切换 SOP 后，裸 elements 整页替换被拒绝
        // （append 增量、content 模式、svg 路线不受限；用户明确要求可 overrideAssist 恢复）
        const assist = state0.weakModelAssist
        if (assist !== undefined && !contentMode && !isSvgPage && args.append !== true && args.overrideAssist !== true && Array.isArray(sceneInput.elements)) {
          throw new Error(
            `🔔 弱模型辅助模式已开启（${assist.reason}）。裸 elements 整页替换被拒绝，${WEAK_ASSIST_GUIDE}`,
          )
        }

        if (contentMode) {
          const parsedContent = contentInputSchema.safeParse(rawContent)
          if (!parsedContent.success) {
            const weakNotice = await bumpWeakModelAssist(store, state0)
            const details = parsedContent.error.issues.map(i => `  content.${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')
            throw new Error(
              'scene.content 不符合内容 schema（扁平字段，按页型取用，title/type 可省略）：\n' + details +
              '\n\n各页型需要的内容字段：\n' + Object.entries(TYPE_REQUIREMENTS).map(([t, req]) => `  ${t}: ${req}`).join('\n') +
              '\n\n示例（要点页）：{"scene":{"content":{"items":["要点一","要点二"]}}}' +
              '\n示例（图表页）：{"scene":{"content":{"chart":{"chartType":"column","labels":["Q1","Q2"],"series":[{"name":"营收","values":[10,20]}],"conclusion":"结论"}}}}' +
              (weakNotice !== undefined ? `\n\n${weakNotice}` : ''),
            )
          }
          const composed = composeSceneFromContent(parsedContent.data, {
            type: outlinePage.type,
            title: outlinePage.title,
            contentBrief: outlinePage.contentBrief,
            knownAssetIds: new Set((await store.loadManifest(args.deckId)).assets.map(a => a.assetId)),
          }, tokens)
          sceneInput.elements = composed.elements as unknown[]
          if (composed.background !== undefined) sceneInput.background = composed.background
          if (parsedContent.data.notes !== undefined) sceneInput.notes = parsedContent.data.notes
          sceneInput.type = parsedContent.data.type ?? outlinePage.type
          sceneInput.title = parsedContent.data.title ?? outlinePage.title
          repairs.push(`版式引擎已按页型 ${String(sceneInput.type)} 自动排版为 ${String(composed.elements.length)} 个元素（坐标/字号/锁定令牌/标题条自动套用，type/title 缺省取蓝图值）`)
          for (const note of composed.layoutNotes) repairs.push(`[版式引擎] ${note}`)
          delete sceneInput.content // 落盘的是展开后的普通 elements 场景（渲染/校验/迁移零改动）
        }

        // ---- append：既有元素保留，同 id 原位替换；替换模式则计算丢失的元素 id
        // content 内容模式是「按蓝图整页重写」的有意替换，不走丢元素闸门（弱模型改页的主路径）
        const incomingElements = Array.isArray(sceneInput.elements) ? (sceneInput.elements as Array<Record<string, unknown>>) : []
        let droppedIds: string[] = []
        if (existing !== undefined && incomingElements.length > 0 && !contentMode) {
          if (args.append === true) {
            const merged = [...existing.elements ?? []]
            const indexById = new Map(merged.map((el, index) => [el.id, index]))
            for (const element of incomingElements) {
              const id = typeof element.id === 'string' ? element.id : undefined
              const at = id !== undefined ? indexById.get(id) : undefined
              if (at !== undefined) merged[at] = element as SceneElement
              else {
                indexById.set(id ?? `#${merged.length}`, merged.length)
                merged.push(element as SceneElement)
              }
            }
            sceneInput.elements = merged
            if (sceneInput.background === undefined && existing.background !== undefined) sceneInput.background = existing.background
            if (sceneInput.notes === undefined && existing.notes !== undefined) sceneInput.notes = existing.notes
          } else {
            const removeSet = new Set(args.remove ?? [])
            const newIds = new Set(incomingElements.map(el => el.id).filter((v): v is string => typeof v === 'string'))
            // remove 列表 = 显式确认删除：不计入"丢元素"闸门
            droppedIds = (existing.elements ?? []).map(el => el.id).filter(id => !newIds.has(id) && !removeSet.has(id))
          }
        }
        // merge 语义（0.8.0）：append 保留未提及元素 + 同 id 原位替换 + 新 id 追加 + remove 显式删除
        if (args.remove !== undefined && args.remove.length > 0) {
          const removeSet = new Set(args.remove)
          sceneInput.elements = (sceneInput.elements as unknown[]).filter(el => {
            const id = (el as Record<string, unknown>).id
            return typeof id !== 'string' || !removeSet.has(id)
          })
        }
        const parsed = pageSceneSchema.safeParse(sceneInput)
        if (!parsed.success) {
          // 报错附出错元素原文 + 正确示例，让模型能定位（此前只给 zod 路径导致模型误判"序列化吞字段"）
          const details = parsed.error.issues.map(i => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')
          const hints: string[] = []
          if (/x: Required|y: Required|w: Required|h: Required|\.x: |\.y: |\.w: |\.h: /.test(details)) {
            hints.push('元素缺少坐标/尺寸 x,y,w,h（英寸）。这是绝对定位系统：请参照同页其他元素的坐标补齐，缺一个都会拒绝。')
          }
          if (details.includes('at most 24')) {
            hints.push('元素数量超过 24 上限：合并或拆分页面，装饰尽量复用。')
          }
          if (/^elements: Array must contain at least 1/m.test(details)) {
            hints.push('所有元素都因内容为空被丢弃：请重新提供至少 1 个带完整文字内容的元素。')
          }
          if (/\.paragraphs: Array must contain at least 1/m.test(details)) {
            hints.push('paragraphs 是空数组：请给出至少一段文字，如 "paragraphs":[{"text":"要写的内容"}]。')
          }
          if (/\.h: Number must be greater than or equal to 0\.05|\.w: Number must be greater than or equal to 0\.05/.test(details)) {
            hints.push('元素宽/高不能为 0 或负数（最小 0.05 英寸）。')
          }
          const elementPaths = new Set(
            parsed.error.issues.map(i => /^elements\.(\d+)/.exec(i.path.join('.'))?.[1]).filter((v): v is string => v !== undefined),
          )
          const offenders = [...elementPaths]
            .map(index => {
              const elements = Array.isArray(sceneInput.elements) ? sceneInput.elements : []
              const raw = elements[Number(index)] ?? invalidElements.find(e => String(e.index) === index)?.raw
              return raw === undefined ? null : `elements[${index}] = ${previewJson(raw)}`
            })
            .filter((v): v is string => v !== null)
          const weakNotice = await bumpWeakModelAssist(store, state0)
          throw new Error(
            '页面场景不符合 schema（元素定义见工具参数 schema 的 elements.items）：\n' + details +
            (hints.length > 0 ? '\n\n修复提示：\n' + hints.map(h => `  - ${h}`).join('\n') : '') +
            (offenders.length > 0 ? '\n\n出错元素原文：\n' + offenders.join('\n') : '') +
            '\n\n正确示例（text 元素，文字必须在 paragraphs 数组里）：\n' +
            '  {"kind":"text","id":"t1","x":0.6,"y":1.7,"w":11.5,"h":4,"fontSize":16,"color":"#1F2937","paragraphs":[{"text":"要点一","bullet":true,"spaceAfter":10}]}' +
            '\n\n不想手写坐标/元素清单时可改用 content 内容模式（版式引擎自动排版）：{"scene":{"content":{"items":["要点一","要点二"]}}}' +
            (weakNotice !== undefined ? `\n\n${weakNotice}` : ''),
          )
        }
        const page = parsed.data

        const manifest = await store.loadManifest(args.deckId)
        const result = validatePage(page, {
          manifest,
          tokens,
          visualPlan: outlinePage.visual,
          structure: outlinePage.structure,
          withVisualCharBudget: spec?.densityPolicy.withVisualCharBudget,
          bulletsMax: spec?.densityPolicy.bulletsMax,
          evidenceLevel: brief?.evidenceLevel,
          evidence: outlinePage.evidence,
          strictness: brief?.strictness,
          pageDensity: outlinePage.density,
          referenceMaterials: brief?.referenceMaterials,
          densityOverride: outlinePage.densityOverride,
        })
        const logger = createDeckLogger(store.paths(args.deckId).root, args.deckId)
        if (!result.ok) {
          logger.warn('page', `页面 ${args.pageId} 校验未通过（${result.errorCount} 错误）`, { issues: result.issues })
          const weakNotice = await bumpWeakModelAssist(store, state0)
          return { pageId: args.pageId, ok: false, errorCount: result.errorCount, warningCount: result.warningCount, issues: result.issues, repairs, ...(weakNotice !== undefined ? { weakAssistNotice: weakNotice } : {}) }
        }

        // 替换模式丢失既有元素：默认拒绝保存（0.7.1 起从 warning 升级为 error）。
        // 两起真实数据丢失事故（0.5.1 p014、0.7.1 前的 p004/p005 梯度图与配图被整页替换静默丢掉）
        // 证明模型会忽略 warning 继续走；丢元素必须显式确认（allowDrop:true）才放行。
        if (droppedIds.length > 0 && args.allowDrop !== true) {
          logger.warn('page', `页面 ${args.pageId} 整页替换将丢弃 ${droppedIds.length} 个既有元素，已拒绝`, { droppedIds })
          const weakNotice = await bumpWeakModelAssist(store, state0)
          throw new Error(
            `整页替换会丢弃 ${droppedIds.length} 个既有元素（${droppedIds.slice(0, 8).join('、')}${droppedIds.length > 8 ? '…' : ''}），已拒绝保存。三选一：\n` +
              '  1. 补齐：把这些元素（含内容）一起放进 scene.elements 重新提交（整页替换要求完整清单）；\n' +
              '  2. 确认删除：这些元素确实不要了，带 "allowDrop": true 重新提交；\n' +
              '  3. 增量修改：只想改/加个别元素时带 "append": true（既有元素保留，同 id 原位替换）。' +
              (weakNotice !== undefined ? `\n\n${weakNotice}` : ''),
          )
        }
        const issues = [...result.issues]
        let warningCount = result.warningCount
        if (droppedIds.length > 0) {
          issues.push({
            level: 'warning',
            rule: 'PAGE_ELEMENTS_DROPPED',
            message: `整页替换丢弃了 ${droppedIds.length} 个既有元素（${droppedIds.slice(0, 8).join('、')}${droppedIds.length > 8 ? '…' : ''}，本次经 allowDrop 确认）`,
            pageId: args.pageId,
          })
          warningCount += 1
        }

        await store.savePage(args.deckId, page)
        const state = await store.loadState(args.deckId)
        if (state !== undefined) {
          if (!state.pagesWritten.includes(page.id)) state.pagesWritten.push(page.id)
          state.stage = 'writing' // 首次写页与修改循环都回到 writing，配合 sceneHash 闸门
          state.contentOutdated = true // 内容已变更：渲染前必须重新 ppt_scene_check
          if (state.renderedAt !== undefined) state.renderOutdated = true // 渲染产物已过期
          await store.saveState(state)
        }
        logger.info('page', `页面 ${args.pageId} 已保存`, {
          type: page.type,
          route: page.svg !== undefined ? 'svg' : 'native',
          source: contentMode ? 'content（版式引擎）' : args.append === true ? 'append' : 'elements',
          elements: page.svg !== undefined ? [`svg(${page.svg.length} chars)`] : page.elements!.map(e => `${e.kind}:${e.id}`),
          warnings: warningCount,
          autoFixes: repairs,
          ...(contentMode && existing !== undefined ? { rewroteExisting: true } : {}),
          ...(args.append === true && existing !== undefined ? { appended: incomingElements.length } : {}),
          ...(droppedIds.length > 0 ? { droppedIds } : {}),
        })
        return {
          pageId: args.pageId,
          ok: true,
          errorCount: 0,
          warningCount,
          issues,
          repairs,
          type: page.type,
          route: page.svg !== undefined ? 'svg' : 'native',
          source: contentMode ? 'content' : args.append === true ? 'append' : 'elements',
          elementCount: page.svg !== undefined ? undefined : page.elements!.length,
          ...(contentMode && existing !== undefined ? { rewroteExisting: true } : {}),
          ...(args.append === true && existing !== undefined ? { appended: incomingElements.length } : {}),
          ...(droppedIds.length > 0 ? { droppedIds } : {}),
        }
      },
    },
  ]
}
