# dsh-ppt-studio：AiPPT-main 借鉴 TODO（决策记录）

> 来源：工作区 `D:\proj\zcode\dshProj\AiPPT-main`（文多多 AiPPT 开源版，github veasion/aippt）。
> 2026-09-22 完成调研，本文记录可借鉴项与优先级，作为后续版本的功能候选清单。
> 本文只是 backlog，**不含任何已实施变更**；采纳某项时再更新 generation-flow.md / SKILL.md / README 并 bump 版本。

## 〇、先泼冷水：这个项目开源了什么

- 只开源了**前端渲染引擎**。`server/README.md` 明说"服务端代码暂未开放"（闭源服务为 Java/Spring Boot）。
- **拿不到的**：AI prompt、大纲→分页内容→版式匹配算法、模板库（仓库内 0 套模板）、JSON→pptx 导出、pptx→JSON 解析（`/ppt2json` 也在服务端）。
- **拿得到的**：中间 JSON 格式（pptxObj）的完整 schema、双端渲染引擎（SVG+Canvas）、无框架编辑器、187 形状几何引擎、动画预设目录、若干前端工程细节。
- 全部在 `AiPPT-main/static/` 下：`element.js`(692 行) / `ppt2svg.js`(2264) / `ppt2canvas.js`(1327) / `geometry.js`(499+14.5 万字符常量) / `chart.js`(833) / `animation.js`(2903) / `cover.js`(94) / `sse.js`(234)。

## 一、许可证红线（先读这个再决定搬不搬代码）

AiPPT-main 是 **GPL-3.0**：

- 本插件/harness 当前为内部使用，**无任何义务**。
- 若将来对外分发（哪怕只分发插件），逐行拷贝其代码会触发 copyleft 传染。
- **借鉴架构思想（占位符继承、局部重绘、双字段颜色等）不受影响**；逐行搬运 `ppt2svg.js` / `geometry.js` 前必须先定分发口径。重写实现（读思想、自己写）是最稳妥路径。

## 二、TODO 候选（按价值排序）

### P1 预览就地编辑 / 手动微调模式 — ☑ 0.21.0 已落地(MVP)

- **补的短板**：预览只读；用户微调一个元素位置目前只能让模型改 scene JSON 再重渲（修改循环成本高）。
- **AiPPT 参考实现**（`ppt2svg.js`，约 900 行零框架）：
  - 拾取：预计算全部元素包围盒，按"面积小者优先、有文字者优先"排序后做命中测试（1290-1314, 2164-2219），解决元素互相遮挡时的选取；文字被遮挡时逐 run `getBoundingClientRect` 判断点击落点（1339-1371）。
  - 拖拽/缩放期间只改 SVG `transform`，mouseup 才回写 JSON 并**局部重绘** `redrawElementWithId`（410-459），不整页重渲。
  - 文字就地编辑：在 tspan 位置盖透明 textarea，同步字体/颜色/旋转，blur 回写 run.text（2009-2147）。
- **dsh 落地思路**：预览播放器（render-html.ts）加可选编辑层 → 用户拖动/改字 → 坐标与文本回写工作区 page JSON → 重算 pageHash/sceneHash → 提示需重跑 `ppt_scene_check` 后再 render。与"scene JSON 是唯一事实源、preview-server 按请求读盘"的现有架构天然契合（参考 ppt-decks 离线重排的既有回写路径）。
- **注意**：content 模式页回写的是 elements（绕过版式引擎）还是改 content 再重排，需要设计决策——建议回写 elements 并在 layoutNotes 标记"经手动微调"。
- **量级**：编辑层本身可控（参考实现 ~900 行思想可压缩）；回写链路与哈希联动是主要工作量。

### P2 外部 PPTX 模板导入（格式参考）— ☑ 0.21.0 已落地(轻量:主题抽取)

- **补的短板**：generation-flow.md 第十节"无外部 PPTX 模板导入"；品牌复用目前只靠 `copyFromDeckId` 令牌克隆。
- **AiPPT 的核心思想**（`element.js` + `ppt2svg.js:196-224, 345-351`）：
  - pptxObj 与 OOXML（p:sld/p:spTree）**同构**：元素→段落→run 统一树形节点，`point` 与 `property.anchor`（EMU）双坐标。
  - 页面→版式→母版**三段继承**：版式里带占位符的元素不绘制，其属性逐字段回填页内空值——**AI 只生成页面内容元素，装饰与默认样式由模板兜底**（生成瘦身 + 模板兜底）。
  - 颜色双字段：`scheme` 引用 + `realColor` 已解析 ARGB 并存，渲染端不依赖主题表也能出正确色。
  - 图表双数据：Excel 公式引用（`Sheet1!$B$2:$B$5`）+ `data` 数组并存。
- **dsh 落地思路**：若做，先定义"导入模板 → 抽取母版/版式/主题色/字体 → 生成 tokens.json + 版式锚点集"的转换器；解析器需自研（AiPPT 的解析闭源，python-pptx 或 JS 侧 unzip+XML 解析）。维持"等真实需求再评估"的口径合理，做之前先确认需求。
- **量级**：大。翻译器体量且有损（文档既有判断仍成立），pptxObj schema 只是降低设计成本。

### P3 形状库扩充（16 → 更多 OOXML 预设）— ☑ 0.21.0 已落地(16→26)

- **补的短板**：目前 16 种 OOXML 预设形状 + rotation。
- **AiPPT 参考实现**：`geometry.js` 内 `geometryMap` 常量含 **187 个 OOXML 预设形状**（guides 公式链 / adjusts 默认值 / M-L-Q-C-A-Z 路径 + fill mode + windingRule），配 `fmlaEvaluate`（293-342，完整 ECMA-376 公式集：`pin/at2/cat2/sat2/mod/sqrt/?:`）与 `arcToBezierCurve`。
- **dsh 落地思路**：两处受益——HTML 预览/SVG 路线的任意形状保真渲染；`render-pptx.ts` 直接写 preset name 即可（pptxgenjs 本身支持更多形状名）。16 种是排版纪律，不必全上，按页型需要增量放开。
- **许可证注意**：geometryMap 是数据表，逐字节拷贝同样受 GPL 约束；建议按需重写或核对 OOXML 规范自行生成。

### P4 动画预设目录（做动画的前置知识）— ☑ 0.21.0 已落地(目录文档)

- **补的短板**：无动画（pptxgenjs 栈不支持 `<p:timing>` 注入）。
- **AiPPT 参考**：`animation.js` 是切场 `transitionList` + 元素动画 `animationList` 的预设全集（presetId/presetSubtype/presetClass[entrance/exit/emph]/duration/startType），即写 pptx timing XML 的参数蓝图。
- **dsh 落地思路**：真要做需 post-zip XML 注入（fflate 已在依赖里，技术上可行）。仍属"等需求"，此条主要是**把参数蓝图的出处记下来**，避免将来重新调研。

### P5 品牌图取色派生主题（轻量品牌化）— ☑ 0.18.0 已落地

- **补的短板**：字体之外，用户品牌色进主题的路径只有 copyFromDeckId；生图默认关闭导致配图少。
- **AiPPT 参考**：`calcSubjectColor`（index.html:587-648）统计图片出现频率最高的 3 个非黑白颜色。
- **dsh 落地**`ppt_asset_register` 登记品牌 logo/参考图时顺带提取主色 → 建议一组 tokens.colors 变体供 design_lock 选择。纯本地计算，无红线。量级小。
- **0.18.0 实现记录**：`src/color-extract.ts` 零依赖实现——PNG（含调色板/灰度/alpha）与 BMP 解码采样 + SVG 源码 hex 收集（JPEG/WebP/GIF 暂不支持并说明原因）；近黑/近白/低饱和灰剔除、4bit 桶聚类、同色系（RGB 距 <70）合并、≤3 色频率序输出。`suggestPaletteOverrides`：primary=最高频色，secondary=次高频或主色明暗派生（同族伴色，与内置主题主/辅关系同构），accent=第三色或主色色相旋转 165°（保证与两者色距 ≥60）。登记回执带 brandColors + paletteSuggestion，**只建议不代用**——用户在 design_lock 表态。

### 附：程序化封面合成（顺带记下）

`cover.js:drawCover` 把 pages[1..8] 缩略拼 3×3 九宫格 + 首页放大，程序化生成模板封面图。若将来做"工作区/主题画廊"页可用；当前无场景，仅记录。

## 三、明确不借鉴（避免将来重新调研）

| 项 | 不借鉴原因 |
|---|---|
| SSE over XHR + gzip 增量分页协议（sse.js / index.html） | dsh 是本地 agent 插件，`ppt_preview_update` 已覆盖"边生成边看"；无网络服务形态 |
| 手写 Canvas 图表（chart.js，含 nice-number 刻度） | HTML 预览已是 SVG 矢量重绘，PPTX 端走 pptxgenjs 原生图表，双端均已覆盖 |
| 双引擎平行渲染（SVG 主画布 + Canvas 缩略图） | dsh 预览单文件播放器无编辑缩略图需求（若做 P1 编辑器则重新评估） |
| Java 服务端 / docmee.cn 开放 API | 闭源且方向不符（内网红线，不出网） |
| 大纲 markdown 层 + 模板选择 UI（三步向导） | dsh 的阶段化确认（confirmStages）+ 12 主题推荐已覆盖，且交互形态不同（对话 vs 表单） |

## 四、调研事实备查

> 视觉质量自身的优化清单(色阶/图标/纹理/主题重调等,与本文 P3/P5 有交集)另见
> [roadmap-visual-quality.md](./roadmap-visual-quality.md)(2026-09-22 建立)。

- AiPPT 生成侧流程（前端可见）：主题 → SSE 流式 markdown 大纲（可编辑）→ 选模板（28 封面随机）→ `generateContent` 异步分页生成，每帧 `{pptId,current,total}` 拉增量 gzip JSON 边生成边画。
- 中间产物传输：pptxObj JSON gzip + base64（pako 解压）。
- ppt2json 与生成方向**同构**（同一 element.js 工厂、同一渲染器、同一导出端点）——"单一中间格式双向打通"是其最核心的架构决策，也是 P2 想抄的思想。
- 服务端端点（闭源）：`/generateOutline`、`/randomTemplates`、`/generateContent`、`/asyncPptInfo`、`/ppt2json`、`/json2ppt`（base：docmee.cn/api/public/ppt）。
