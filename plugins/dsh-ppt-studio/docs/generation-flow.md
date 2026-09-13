# dsh-ppt-studio：PPT 生成流程逻辑

> 本文是生成流水线的**权威逻辑文档**（对应插件版本 0.10.0）：每个阶段做什么、产出什么、
> 卡哪些确认关卡、校验哪些规则、修改如何传播。工具参数级细节见各工具的 JSON Schema
> 与 `src/tools/*.ts`；面向模型的操作手册见 `skills/dsh-ppt-studio/SKILL.md`。

## 目录

1. [设计理念](#一设计理念)
2. [流水线总览](#二流水线总览阶段-08)
3. [各阶段逻辑](#三各阶段逻辑)
4. [数据模型与工作区](#四数据模型与工作区)
5. [状态机](#五状态机)
6. [校验规则全集](#六校验规则全集)
7. [主题 / 页型 / 信息结构体系](#七主题--页型--信息结构体系)
8. [设计令牌与密度策略](#八设计令牌与密度策略)
9. [修改循环与依赖传播](#九修改循环与依赖传播)
10. [有意取舍](#十有意取舍)
11. [版本演进](#十一版本演进)

---

## 一、设计理念

整套流水线围绕一句话构建：

> **先锁定故事，再锁定页预算，再锁定每页意图，再锁定设计系统，最后才生成视觉；
> 修改沿依赖关系局部处理，而不是整个 Deck 推倒重来。**

四条落地原则：

| 原则 | 落地方式 |
|---|---|
| 内容与视觉解耦 | 阶段 0–3 只处理"讲什么、讲多少、每页为什么存在"；颜色字体版式全部推迟到阶段 4 的令牌锁定 |
| 每一步可确认、可回溯 | 每阶段产物是工作区里独立 JSON 文件；确认关卡数量由**生成模式**（quick/standard/precise）决定；断点续跑天然支持 |
| 质量靠确定性规则而非自觉 | 40 条校验规则（见第六节）纯代码执行，error 拒绝落盘/渲染，warning 必须知情 |
| 修改影响范围可控 | 页级指纹 + 全册指纹双闸门；改一页只有该页进 revalidated 重点清单（校验每次全量执行、毫秒级），改设计令牌/大纲才触发全册重检重渲染 |

**确认点（0.9.0 收敛，0.9.1 运行时全面解耦：唯一开关是 `confirmStages`）**：brief 落盘时把 mode 展开为确认点数组——
**quick** = `[]`（不逐阶段确认：简报+大纲+页数+设计方向打包成一条消息做唯一前置确认，其余采纳建议值）；
**standard** = `[brief, outline, pageplan, blueprint, design]`（默认逐阶段确认）；
**precise** = 前五项 + `prototype`（加 Prototype 真实效果确认）。
用户显式传 `confirmStages` 时优先于 mode 预设——**mode 只是预设捷径**，0.9.1 起 design_lock 的 Prototype 生成、校验分级、返回指引全部读展开后的确认点数组（`resolvedConfirmStages`），代码中不再有任何按 mode 分支的行为——quick + 显式 `confirmStages:['prototype']` 之类组合不再被预设吞掉。
`evidenceLevel`（none/business/academic，可信度维度）与 `strictness`（relaxed/normal/strict，质量分级维度）是两个正交旋钮，不参与确认点组合。
**quick 打包确认的语义边界**：它是 SOP 层的**方向授权**（对话确认），不是状态闸门——不落盘、无工具拦截。生成偏离已确认方向的兜底不靠它，而靠：阶段 6 全量校验 + storyline 叙事自审 + 渲染前 sceneHash 闸门（内容与最近校验不一致拒绝渲染）。

**渲染路线（0.10.0，brief.renderRoute，用户在阶段 0 选择）**：

| 路线 | 页面形态 | PPTX 产物 | 校验保护 |
|---|---|---|---|
| `native`（默认） | elements 绝对坐标清单（17 页型） | 原生文本/形状/图表/表格，逐元素可编辑 | 全部 40 条规则（越界/互压/容量/密度/图表…） |
| `svg` | 整页 SVG 源码（viewBox 固定 `0 0 1280 720`，自由路径/渐变/构图） | **整页矢量图嵌入**（PowerPoint 2016+ 显示；可右键"转换为形状"恢复部分可编辑性） | 安全面与品牌：SVG_VIEWSIZE / SVG_UNSAFE / TOKEN_COLOR（6 位 hex 尽力识别）+ 证据扫描；**版式确定性规则不适用** |

svg 路线的取舍必须在选择时向用户明示：视觉自由度换掉了版式保护与元素级可编辑性——写页后务必 `ppt_preview_update` 肉眼把关。两条路线共享同一套流水线（简报/大纲/页数/蓝图/设计锁定/校验指纹/修改循环/预览），tokens 锁定色板对两者都生效；路线是 deck 级选择，中途不改（页面 schema 保证 elements/svg 二选一）。

**渲染路线实现方式对比（0.10.0 抉择记录，供后续修改抉择参考）**：SVG 进 PPTX 存在两条实现路径——**逐元素转换**（ppt-master 的 Python 工具链路线：rect/circle/path 映射为 DrawingML 原生形状，text 转原生文本框，图表转原生可编辑图表）与**整页矢量图嵌入**（本插件 0.10.0 采用的 Node 路线：SVG 作为矢量图写进 PPTX，pptxgenjs 原生支持）。本质区别是**转换深度**，全部优缺点由此衍生：

| 维度 | Python 逐元素转换 | Node 整页矢量图嵌入（本插件） |
|---|---|---|
| PPTX 可编辑性 | 逐元素可编辑，交付后人工深度修改友好 | 整页一张图；右键"转换为形状"只能部分恢复 |
| 视觉保真 | **有损**：滤镜/混合模式/复杂路径需近似或栅格化兜底 | **无损**：预览与 PPTX 所见完全一致 |
| 文本行为 | 原生文本框由 PowerPoint 重新排版——换行/字距有漂移风险（ppt-master 需 plot-area 标记与 verify-charts 校准阶段兜底） | 按 SVG 定位渲染零漂移；依赖观映机器字体（缺字体则回退） |
| 图表 | 可转原生图表（数据进 Excel 可改） | PPTX 端不可编辑（HTML 预览为矢量重绘） |
| 部署 | Python 运行时 + pip 依赖——**内网 DSH 宿主不保证** | 插件同进程零依赖（cordis 宿主即 Node） |
| 实现复杂度 | 持续工程：形状映射表 / custGeom 生成 / 文本度量 / 坐标校准（SVG 设计稿与 PPTX 近似物是"双真相"，对齐是长期成本） | 约 50 行代码，维护成本近零 |
| 错误模式 | 转换错误 = **静默走样**（画出来了但不对），靠事后校准发现 | 无转换 = 无转换错误；SVG 自身错误由校验器 + 预览拦截 |
| 能力上限 | 高：母版/版式/动画时间线/音频旁白/模板逆向提取（python-pptx 对 OOXML 的封装深度远超 pptxgenjs） | 受 pptxgenjs API 面限制：无动画、无 custGeom、无图表 XML 深度访问 |
| 性能 | 每页跑转换脚本，秒级 | 同进程毫秒级 |
| 修改循环形态 | 鼓励"生成后在 PowerPoint 里手改" | 强制"改需求 → 重新生成整页"（与本插件依赖感知修改循环天然一致） |

**何时值得引入/切换到逐元素转换**：①交付物需在 PowerPoint 中被人工深度编辑（改数据/逐元素调整）；②需要原生动画、音频旁白；③要建模板逆向生态（pptx_to_svg 提取）；④运行环境可控（能保证 Python 与依赖）。四条占其一二才值得启动这条工程线。

**本插件选 Node 的三条理由**：① **部署现实**——DSH 宿主是 Node 进程，不保证 Python 存在，引入子进程等于部署面翻倍；② **哲学一致**——本体系建立在"单一真相源 + 确定性校验"上，逐元素转换引入第二真相（SVG 设计稿 vs PPTX 近似物），需要整套校准基建来对齐，与确定性校验互斥；③ **价值错位**——逐元素可编辑的受益场景是"交付后人工编辑"，而本插件的修改循环是依赖感知的重新生成，转换器的高成本换不来对等收益。

**中间路线（未来评估档）**：若既想保 Node 又需要逐元素可编辑，可自写 SVG→custGeom 的 OOXML 生成（custGeom 本质是一段 XML，Node 可生成并后处理注入 pptxgenjs 产物），工程量与能力都介于两者之间——即取舍表"SVG→PPTX 逐元素转换"条目中"等真实需求再评估"的那一档。

## 二、流水线总览（阶段 0–8）

```
┌──────────────────────────────────────────┐
│ 0. BRIEF          主题/听众/场景/目标/时长 + 选定风格 │ → [用户确认]
│                   + mode（quick/standard/precise） │   （quick 打包确认一次）
│                   + evidenceLevel（证据等级）        │
└────────────────────┬─────────────────────┘
                     ↓
┌──────────────────────────────────────────┐
│ 1. DECK ARCHITECTURE  核心主张 + 各部分问题链      │ → [用户确认/修改]
└────────────────────┬─────────────────────┘
                     ↓
┌──────────────────────────────────────────┐
│ 2. PAGE BUDGET    内容页数 + 各部分分配（可先出建议）│ → [用户确认]
│                   时长档位推荐（紧凑/推荐/舒展）      │
└────────────────────┬─────────────────────┘
                     ↓
┌──────────────────────────────────────────┐
│ 3. CONTENT BLUEPRINT                     │
│    先做第一部分样例 → [用户确认样例质量]           │
│    再批量生成其余部分（每页 purpose/keyMessage/   │
│    structure/density/visual/transition/    │
│    evidence）                        │ → [用户确认整体蓝图]
└────────────────────┬─────────────────────┘
                     ↓
┌──────────────────────────────────────────┐
│ 4. DESIGN SYSTEM   propose 2-3 套预设 → [用户选定] │
│                    → 锁定 spec + tokens 两份文件  │
│                    + prototypePages 代表页建议     │
└────────────────────┬─────────────────────┘
                     ↓
┌──────────────────────────────────────────┐
│ 4.5 PROTOTYPE（confirmStages 含 prototype 必选；   │
│    其余有确认关卡的会话可选建议）               │
│    先写 ≤3 个代表页 → preview → [用户确认真实效果]   │
│    → 认可后批量写其余页（不认可换设计重锁，成本 3 页）│
└────────────────────┬─────────────────────┘
                     ↓
┌──────────────────────────────────────────┐
│ 5. SECTION PRODUCTION 逐页生成（一气写完）        │
│    每部分完成后 ppt_preview_update 即时预览，      │
│    用户边生成边看边提修改（不阻塞）               │
└────────────────────┬─────────────────────┘
                     ↓
┌──────────────────────────────────────────┐
│ 6. DECK INTEGRATION  全册集成校验（依赖感知增量）  │
│    + storyline 叙事链自审 + 时长估算              │
└────────────────────┬─────────────────────┘
                     ↓
┌──────────────────────────────────────────┐
│ 7. RENDER + QA      渲染 PPTX + 预览 + 报告      │
└────────────────────┬─────────────────────┘
                     ↓
┌──────────────────────────────────────────┐
│ 8. REVISION LOOP    依赖感知修改循环             │
│    （Slide / Section / Deck 三级影响范围）       │
└──────────────────────────────────────────┘
```

工具共 **19 个**，与阶段的对应见第三节。

## 三、各阶段逻辑

### 阶段 0：Brief——先确定 PPT 的"任务"

| 项 | 内容 |
|---|---|
| 工具 | `ppt_themes`（对话中列 12 套主题，可选 topicType 推荐）、`ppt_brief_create` |
| 入参 | title / topic / audience / **scenario** / **objective** / **durationMin** / themeId / tone / density / **mode** / **evidenceLevel** / paletteOverrides |
| 产物 | `brief.json`；创建 deck 工作区；stage=briefed |
| 确认关卡 | standard/precise：简报全文必须原样展示给用户确认；quick：不逐项确认（后续打包一次） |

关键逻辑：

- **objective（演讲目标）是必填**："让中学生理解 AI" ≠ "让 CTO 理解技术路线" ≠ "让投资人理解产业机会"——目标不同，后续叙事架构、页数分配、密度全部不同。
- **durationMin 与页数共同决定密度**：10 分钟路演和 60 分钟课堂即使页数相同，密度也应不同（也会影响阶段 4 的密度变体建议）。
- themeId 是**初始偏好**，阶段 4 仍可通过设计预设更换。
- **智能推荐**：每套主题带 category 标签（tech/business/education/gov/culture/event）；模型从简报判断类型后带 `topicType` 调 `ppt_themes`，同类主题排前并标 ⭐推荐（纯确定性，无模糊判断）。
- **mode（生成模式，0.7.0；0.9.1 完成解耦）**：quick=1 个打包确认（内容方向一条消息），其余采纳建议值；standard=默认逐阶段确认；precise=standard + Prototype 关卡。mode 只是 confirmStages 的预设捷径，**不影响任何校验与行为分支**——brief/design_lock/校验器统一读展开后的确认点数组；叙事链严格度归 strictness、证据严格度归 evidenceLevel。
- **renderRoute（渲染路线，0.10.0）**：native=pptxgenjs 原生元素（默认，逐元素可编辑 + 全部版式规则保护）；svg=自由 SVG 绘制（视觉自由度最高，PPTX 端整页矢量图嵌入 PowerPoint 2016+ 显示，版式确定性规则不适用——详见第一节渲染路线表）。**必须向用户说明取舍后再选**；默认 native。
- **evidenceLevel（证据等级，0.7.0）**：none=不要求来源；business=数字论断需来源；academic=fact/data 论断全部需来源。**内网适配**：来源只能来自用户提供的材料，无法核实的数据改定性表述或标「数据待补充」，禁止联网取数与编造引用。
- **referenceMaterials（参考材料清单，0.8.1；0.9.1 精确引用）**：`[{id, title, note?}]`——提供后 evidence 必须引用其中条目（`materialId` 按 id **精确匹配**优先；source 的 id/标题子串匹配保留兼容），EVIDENCE_SOURCE_MISSING 从 warning 升级为 error 拒绝保存；未提供清单时维持 warning（宽容模式）。"内网来源=用户材料"由此从纪律变成可执行约束。
- **confirmStages（自定义确认点，0.8.1）**：`[brief/outline/pageplan/blueprint/design/prototype]` 子集——覆盖三档模式的默认闸门，只列出的阶段停下确认，其余采纳建议值推进；空数组=打包模式（返回文案同时提示"建议值不满意可重调覆盖"）。
- **页数档位建议（0.7.0）**：brief 带 durationMin 时返回 `suggestedCounts`（紧凑/推荐/舒展三档，按时长 ÷1.7 分钟/页推导，附分钟/页），打包模式直接采纳推荐档。
- **页数口径（0.9.1 SOP 明确）**：用户口述"要 N 页"默认理解为**最终总页数**——换算内容页数 = N − 3（结构页），并在页数确认时明示"内容页 X + 封面/目录/结尾 3 = 总 Y"；用户明确说"内容页"时才直接采用。

### 阶段 1：Deck Architecture——这套 PPT 讲一个什么故事

| 项 | 内容 |
|---|---|
| 工具 | `ppt_outline_draft` |
| 入参 | **coreMessage**（全 deck 核心主张）+ parts[]（2–12 个，每个 = title + **question** + **message** + suggestedPages） |
| 产物 | `outline.json`（parts 层，pages 为空）；stage=outlined |
| 确认关卡 | 叙事链展示给用户确认/修改（重调覆盖） |

关键逻辑：

- 不做名词目录，做**叙事链**：每部分用"关键问题 → 一句话答案"表达（如"AI 从哪里来？→ 规则驱动→数据驱动→大模型"），问题串起来形成 历史→原理→突破→扩展→未来 的推进关系。
- 架构确认后不可回退（阶段推进保护）；要改故事两条路：新 deck 重走，或**架构修订**（0.8.0）——用户明确确认后 `ppt_outline_draft` 带 `revise:true` 原地重调：清除蓝图/已写页/页数计划（保留简报与设计令牌），state 记 `architectureRevisedAt`，回退 outlined 重走 2–5；写页阶段闸门会拦住"旧令牌还在就跳过重新 lock"。

### 阶段 2：Page Budget——页数与分配

| 项 | 内容 |
|---|---|
| 工具 | `ppt_pageplan_confirm` |
| 入参 | contentPages（2–60）+ allocation[]（可选：各部分页数） |
| 产物 | `plan.json`（contentPages / structuralPages=3 / totalPages / allocation）；stage=planned |
| 确认关卡 | 总页数与分配表展示给用户确认 |

关键逻辑：

- **页数口径**：用户确认的是**内容页数**；封面/目录/结尾 3 页自动附加，返回值明示 `最终总页数 = 内容页数 + 3`，杜绝"用户说 20 页最后出 26 页"。
- contentPages ≥ 部分数（每部分至少 1 页）。
- **分配建议**：未带 allocation 时按各部分 suggestedPages 加权自动生成建议（每部分 ≥1 页、余数补给小数部分最大的），同时返回**页数档位建议 suggestedCounts**（时长驱动：紧凑/推荐/舒展三档，附分钟/页），展示给用户调整后带 allocation 重新调用确认。
- **分配硬校验**：Σ分配 = contentPages 且覆盖全部部分，多/少/未知 sectionId 均拒绝。
- **分配理由**：allocation 每项可带 reason（如"历史概览，4 个关键节点"），展示给用户便于接受或调整。
- **改页数的两条路径（0.9.1 明确）**：①页数计划**可重复确认**——总页数/分配要变时直接重调 `ppt_pageplan_confirm`（覆盖 plan.json，stage 回 planned），再重草拟受影响部分（其他部分蓝图不动，页 ID 重排自动迁移已写页）；②增删部分/改故事结构走 `revise:true` 全部重来（阶段 1）。section_draft 的页数硬校验始终以**最新** plan 为准。

### 阶段 3：Content Blueprint——先定义"这页为什么存在"，再定义"这页放什么"

| 项 | 内容 |
|---|---|
| 工具 | `ppt_section_draft`（逐部分调用；sectionId="s0" 专放结构页） |
| 入参 | 每页：type / title / contentBrief / **purpose** / **keyMessage** / **structure** / **density** / **visual** / **transition**（叙事衔接，strict=strict 时缺失升 warning）/ **evidence**（证据条目）/ **densityOverride**（页级预算豁免，0.8.2） |
| 产物 | `sections/<sid>.json` + 合并进 `outline.json` 的 pages；全部完成时 stage=drafted |
| 确认关卡 | ①**样例质量关卡**：先出样例再批量（结构相近只出第一部分；差异大按结构类×页型抽样）；②**叙事试读**（0.9.0）：整体蓝图以"问题→答案 + 每页标题/核心信息/承接语"纯叙事视角通读后确认——故事错误在投入视觉生产前拦截 |

关键逻辑：

- **样例质量关卡**：重做一部分比重做一整册便宜。各部分信息结构相近时只为第一部分出样例；差异大时按**结构类 × 页型双维度**抽样（0.8.1：叙事类 timeline/process/cause-effect/problem-solution、对比类 comparison/before-after、数据类 data-insight、概念类 concept-example/hierarchy/plain——每类挑第一个；同类内页型差异大再按页型补），并告知用户"样例代表结构类的节奏与深度，视觉按各页页型批量适配"。
- **transition（叙事衔接，0.7.0）**：`fromPrevious`（这页如何承接上一页/回答上一页留下的钩子）+ `nextHook`（给下一页埋的钩子）。PPT 是连续叙事——"页页单独看都不错、连起来跳跃"是常见失败模式；strictness=strict 时缺失升 warning（NARRATIVE_CHAIN_MISSING），其余档可选（链部分建立时缺口提示 info）。**"必填"的准确口径**：warning 是必须知情的软约束而非硬拒绝——真硬约束在 schema/预检层（如 allocation 总和），文档措辞不把 warning 说成"强制禁止"。
- **evidence（证据条目，0.7.0；0.9.1 论断级精确引用）**：`[{claim 论断原文, type fact/data/example/quote, source 来源, materialId?, locator?}]`。evidenceLevel=business 时页面数字论断需有带来源的条目；academic 时 fact/data 型条目全部需 source 或 materialId（EVIDENCE_SOURCE_MISSING 强制）。提供材料清单时优先 `materialId`（id 精确匹配）+ `locator`（如「第 12 页，表 2」）——引用完整性可由代码判定；**引用支持性**（材料内容是否真支撑论断）与**来源真实性**（材料本身可信度）不归代码：前者是模型自审/用户抽查职责，后者以"用户提供材料"为前提。内网来源=用户材料。
- **densityOverride（页级预算豁免，0.8.2）**：`{reason}`——单页确需突破全册密度/要点预算时（如总结页罗列全部要点）写明理由，DENSITY_WITH_VISUAL / BULLET_BUDGET_EXCEEDED 对该页降为 info 知情放行（不是静默绕过，理由随 issue 展示给用户）。
- **页 ID 全册规范化重编号 + 已写页迁移（0.8.0，0.8.1 硬化，0.9.1 引用对齐）**：封面 p001 → 目录 p002 → 各部分（按架构顺序）→ 结尾最后。每次调用后重算全部页 ID；已在写作中时同步迁移 `pages/*.json` 文件名、`state.pageHashes` 键与 `pagesWritten`（两阶段改名防覆盖），**并重映射 `design/spec.json` 的 `prototypePages`**（重排后代表页引用不同步会指错页/悬空；蓝图消失的页从清单移除），其他部分的已写页内容不变只换编号；重草拟部分中蓝图内容变化的页被清除并在返回值 `migration.invalidated` 中提示重写；sceneHash 随大纲变更失效。**迁移先于大纲落盘**（预检失败磁盘不被半途修改）；预检两道闸：源文件缺失（手动删除）与目标文件被占用（手动创建；**即将被清除的旧页文件不算占用**——0.9.1 修复删页后其余页位移被误判冲突而中止迁移的 bug）都清晰报错列出并拒绝迁移；迁移明细记入 `state.lastMigration` 供排查。
- **页数硬校验**：Σ内容页 = contentPages（超出立即拒）；有确认分配时各部分精确匹配。
- 结构页约束：s0 只允许 cover/toc/closing 各恰好一页；内容部分不得使用 cover/toc 页型。
- structure（信息结构，十种）驱动页型选择，错配由校验器 STRUCTURE_TYPE_MISMATCH 提醒（见第七节映射表）。

### 阶段 4：Design System——设计规范确认 + 两份计划文件锁定

| 项 | 内容 |
|---|---|
| 工具 | `ppt_design_propose`（4A 预设）→ `ppt_design_lock`（4B 锁定） |
| 产物 | `design/spec.json` + `design/tokens.json`；stage=locked |
| 确认关卡 | 2–3 套预设展示给用户**选定** |

预设生成逻辑（确定性）：

- **方案 A**：简报原定主题 + 密度。
- **方案 B**：同主题密度变体（0.9.1 修正密度-时长方向：时间越紧越要少放信息，不是塞更多）——normal 且时长 ≥30 分钟 → 建议 sparse（更大气）；normal 且时长 <15 分钟 → 建议 sparse（少字大图讲得完，紧凑页赶时间反而讲不透）；normal 且 15–29 分钟 → 建议 dense（承载更多信息，附观感权衡提示）；非 normal → 建议 normal。
- **方案 C**：气质相邻主题（12 主题亲和表，如靛蓝渐变 ↔ 科技深色 / 藏蓝鎏金）。
- **方案 D（命中时）**：场景驱动——按简报关键词确定性匹配（青少年教育→奶油手账稀疏版、≤20 分钟路演/发布→靛蓝渐变、政务对上→政务红、工程安全→工业灰橙紧凑）；无命中或与原定主题相同时不出现。

锁定逻辑：

- **两种设计来源二选一**：①带 themeId/density（propose 选定值或简报原定）按主题生成；②带 `copyFromDeckId` 从已锁定的源 deck **复用设计**（周报系列/系列课程复用品牌；本地工作区优先，找不到时经工作区注册表**跨工作区**解析——品牌设计库可在任意目录）——令牌原样克隆（自包含机器事实），密度策略与设计纪律沿用源 deck，spec 的页数分配归属目标 deck 自己；与 themeId/density/paletteOverrides 互斥。
- 锁定终检：结构页 3 页齐备、每部分有蓝图、Σ内容页 = 确认值，不满足拒绝。
- **Prototype 代表页（0.7.0，0.8.1 双维度，0.8.2 用户指定，0.9.1 风险加权+确认点驱动）**：确认点非空（有逐阶段确认关卡的会话）时锁定即确定 ≤3 个代表页写入 `spec.prototypePages`，确认点为空（打包模式）不生成——用户在蓝图阶段标记"最关心这几页"时以 `prototypePageIds` 指定清单优先（未知/非内容页 id 拒绝）；未指定则第一轮按结构类（叙事/对比/数据/概念）去重、**簇内挑风险分最高的页**（图表 +2 / 配图 +1 / 概要 ≥200 字 +1 / 页级 high 密度 +1，同分取先出现——用最少的页暴露最多的真实渲染风险），第二轮按页型补多样（同结构类的 timeline 与 process 长得并不一样）。**确认点含 prototype 时是强制关卡**：先只写这几页 → `ppt_preview_update` 展示真实渲染效果（不是 token 说明，用户直接看最终长相）→ 认可后批量写其余页；不认可重调 propose/lock 换方案（令牌变 → sceneHash 失效 → 已写页重写，试错成本只有 3 页）。其余有确认关卡的会话作为可选建议（返回文案明示可跳过）。重排迁移时 prototypePages 随页 ID 重映射对齐。
- **锁定即真锁**：此后写页校验 TOKEN_COLOR/TOKEN_FONT 强制不越锁；渲染只认 tokens；换设计 = 重新 lock → 令牌变 → sceneHash 失效 → 全册重校验。

### 阶段 5：Section Production——逐页生成（一气写完，边生成边看）

| 项 | 内容 |
|---|---|
| 工具 | `ppt_page_write`（逐页）、`ppt_preview_update`（每部分后刷新预览）、`ppt_asset_register` / `ppt_image_generate`（配图） |
| 产物 | `pages/p00N.json`；stage=writing |
| 节奏 | **不逐部分停下来等确认**；每完成一个部分调 `ppt_preview_update`，用户在浏览器边看边提修改（局部修改走改页流程，不阻塞后续部分） |

`ppt_page_write` 内部四段式管线（每页同步执行）：

```
容错归一（normalizeSceneInput：扁平 text 展开/对象包数组/数字转字符串/"key=#hex"（含带引号形态）损坏键拆分/
  chart.labels 与 table.rows 数字自动转字符串——真实会话 8 次被拒的数字刻度/表格数字形态）
→ 元素合并（append:true 时与既有页元素合并：保留既有、同 id 原位替换；替换模式则检测丢失的既有元素 id）
→ zod schema 校验（失败报错附出错元素原文 + 修复提示 + 正确示例；run 级 superscript/subscript 支持公式上下标）
→ validatePage 确定性校验（对最终页面整体执行；有 error 拒绝落盘；含令牌/密度/结构匹配/配图计划/证据来源检查）
→ 丢元素闸门（0.7.1：整页替换遗漏既有元素默认拒绝保存，allowDrop:true 显式确认才放行——两起真实数据丢失事故后从 warning 升级）
```

**写页语义（0.5.1 显式化，0.7.1 升级为拒绝）**：默认**整页替换**——scene.elements 必须是该页的完整元素清单；遗漏既有元素会被**拒绝保存**（报错列出丢失元素与三条出路：补齐 / `allowDrop:true` 确认删除 / `append:true` 增量修改）。0.5.1 的 p014 事故与 0.7.1 前的 p004/p005 事故（梯度可视化与配图被整页替换静默丢掉、模型忽略 warning 继续走）证明 warning 不够，必须显式确认。

**公式排版（0.7.1）**：run 级 `superscript` / `subscript`（双渲染器对应 PowerPoint 原生基线偏移与 HTML `<sup>`/`<sub>`）；禁止 Unicode `ᵀ`（中文字体缺字形）与字面 `^`/`_` 记法。

- 写页前置条件：设计已锁定（tokens 存在），页 ID 在 outline 中；deck 未暂停（state.paused 时写页被拒，`ppt_deck_pause` 恢复）。
- **svg 路线写页（0.10.0）**：renderRoute=svg 的 deck，page_write 的 scene 提供 `svg`（整页源码，viewBox "0 0 1280 720"，≤300K 字符）而非 elements——整页替换语义，无 append/remove/allowDrop；native 路线收到 svg 一律拒绝（路线是 deck 级选择）。写入时校验 SVG_VIEWSIZE / SVG_UNSAFE（脚本/事件属性/foreignObject/外链全禁——内网红线：SVG 必须自包含，图片以 data URI 内嵌）与锁定色板（TOKEN_COLOR 按 6 位 hex 尽力识别）。**写完每页都应 ppt_preview_update 肉眼把关**（版式确定性规则不适用，预览就是 QA 主通道）。
- **进度可视化**：即时预览播放器顶部有进度条（已生成 N/M 页 + 各部分 n/m，写完自动消失）；`ppt_preview_update` 返回进度文本。
- **配图先于写页**：蓝图 visual:image 的页先按 contentBrief 生成图片描述调 ppt_image_generate 拿 assetId 再写页（已配置生图时），减少占位割裂；未配置再走 placeholder。
- **生图提示词与令牌协调（0.9.2，借鉴 ppt-master 的"同 deck 全部图共用色彩锚"纪律）**：prompt 是一段连贯散文——风格家族（同 deck 统一一种）+ 主体视觉名词 + 构图 + 色彩行为（写明占比并与锁定色板协调）+ 图内不写字（图内一个词 = 一次重生成的成本）。ppt_image_generate 在设计锁定后返回 deckPalette（bg/primary/accent）摘要，色彩协调靠返回提醒与 SOP 纪律达成，不静默改写用户 prompt。
- 即时预览：`ppt_preview_update` 毫秒级把已写页面刷新到自包含 HTML 播放器，不出 PPTX、不要求 sceneHash——它是观察窗口不是终检。成功后自动打开浏览器（**默认每阶段各弹第一次**：即时预览首开一次、正式渲染完成再开一次，各自跨调用/重启不重复；`PPT_STUDIO_PREVIEW_AUTO_OPEN=0` 完全关闭、`=always` 恢复每次打开），URL 始终同时以文字给出。

### 阶段 6：Deck Integration——全册校验（依赖感知增量标注）

| 项 | 内容 |
|---|---|
| 工具 | `ppt_scene_check` |
| 产物 | `state.sceneHash`（全册指纹，含插件版本盐）+ `state.pageHashes`（页级指纹）+ storyline 叙事链摘要 + duration 时长估算 |
| 检查 | 页集完整性（PAGE_MISSING/PAGE_ORPHAN）+ 全部单页规则 + 跨页集成规则（单调/多样性/节奏/叙事链/标题结论感） |

**校验口径（0.9.1 澄清）：全量校验、增量标注**——每次调用对全部页执行全部规则（毫秒级，**无缓存**：规则演进、strictness/材料清单变化对存量 deck 即时生效），没有"未变页免检"：

- `revalidated[]`：本次内容变更/新增的页（重点细看）；
- `unchangedCount`：内容未变页数（聚焦提示，不是免检承诺）；
- `outlineChanged`（0.9.0，对称性修复）：大纲指纹（parts+pages 含 transition/页序）与上次校验不同——transition 是**页间关系**，页级指纹覆盖不到（改了承接语，两页内容都没变、revalidated 为空，叙事链却已断裂）；此时提示重读全量 storyline 自审邻接衔接，而非只看变更页。
- **svg 页校验分派（0.10.0）**：validatePage 对 svg 形态页自动走 validateSvgPage（安全面/画布/色板/证据扫描），元素级规则天然跳过；时长估算提取 `<text>/<tspan>` 文字计入（与 native 同一公式）；VISUAL_RHYTHM 把 svg 页视为"有主视觉"（自由绘制几乎必然带视觉，保守不误报）。

**storyline 叙事链自审（0.7.0）**：返回逐页 `{pageId, title, keyMessage, bridge}` 摘要——模型在阶段 6 逐页自问"这页是否回答上一页留下的问题？有无突然跳跃？"，发现断裂就地补 transition 或改写承接（语义判断靠模型，确定性侧只提供链结构与缺口检测）。

**时长估算（0.7.0；0.9.1 计入备注）**：`duration = {estimatedMin, targetMin, ratio}`——估算 = Σ（页面全角字 + 演讲者备注全角字）÷220 字/分钟 + 每页 0.3 分钟翻页停顿，再乘页型系数（图表/表格 ×1.3，结构页 ×0.5）；备注是照着讲的底稿，只算页面文字会低估写了详细备注的 deck。与简报时长偏差 >±35% 给 DECK_DURATION_MISMATCH（info）：讲不完就精简文字/把展开内容移进备注，或与用户重对页数。

### 阶段 7：Render + QA——渲染

| 项 | 内容 |
|---|---|
| 工具 | `ppt_deck_render` |
| 产物 | `deck.pptx`（可编辑）+ `preview/index.html`（自包含）+ `report.json`；stage=rendered |

渲染逻辑：

- **sceneHash 闸门**：当前内容哈希 ≠ state.sceneHash 即拒绝渲染——改过内容必须先重新 `ppt_scene_check`，防止渲染过期场景。指纹含**插件版本盐**（0.9.1）：校验规则/渲染器随版本演进，插件升级后旧 sceneHash 不再匹配，存量 deck 渲染前自动强制重检——新规则对旧 deck 也生效，而不是沿用升级前的结论。
- **渲染前复检与 check 同路**（0.9.1 对称性修复）：render 内嵌的最后一道 validateDeckPages 传入与 ppt_scene_check 完全相同的选项（strictness/evidenceLevel/referenceMaterials/parts/bulletsMax），闸门强度不因最后一道复检放松。
- error 级问题存在即拒绝渲染。
- **渲染 QA 能力边界（0.9.1 明示）**：本流程验证的是场景数据、文件结构与全部校验规则；办公软件实际渲染效果（字体回退/换行/图表标签细节）不在确定性验证范围内——以 HTML 预览（与 PPTX 同源场景+令牌的所见即所得）与打开 PPTX 的肉眼复核为准，render 返回文案明示这一边界。
- **svg 页双端渲染（0.10.0）**：HTML 预览整页 SVG 原生内联（预览即真实渲染）；PPTX 端以整页矢量图嵌入（media/*.svg，PowerPoint 2016+ 显示，旧版本可能显示占位；可右键"转换为形状"恢复部分可编辑性）——renderNotes 每页记录这一取舍。
- 双渲染器消费同一份 PageScene + 同一份锁定令牌：PPTX（pptxgenjs，原生文本/形状/表格/图表，ZIP 结构自检）与 HTML（几何一一对应：英寸×96=px、磅×4/3=px，图表 SVG 矢量重绘）。**两个产物都是原子写**（tmp + rename）：生成期间浏览器/PowerPoint 读到的要么是旧文件要么是完整新文件，不会出现写了一半的乱码残页（0.8.3，HTML 端补齐）。
- 返回 pptxPath + previewUrl；渲染成功后自动打开浏览器预览（**默认每阶段各弹第一次**：即时预览首开一次、正式渲染完成再开一次，各自跨调用/重启不重复；`PPT_STUDIO_PREVIEW_AUTO_OPEN=0` 完全关闭、`=always` 恢复每次打开）。
- **预览服务多根托管**：deck 按 DSH 会话工作目录生成，工具调用时自动把工作区登记到全局注册表（`~/.dsh/ppt-studio-workspaces.json`）；`node lib/preview-server.js` 合并"启动目录 + 注册表全部根"托管（列表页标注各 deck 所属工作区，未知 deck 的 404 附工作区清单；读取侧过滤失效根，登记时顺手剔除已删除工作区的残留条目（0.8.2），注册表文件不膨胀；**全部错误路径（404/403/405/500）返回样式化错误页**（0.8.4：与列表页同风格的完整 HTML——状态码大字 + 原因 + 处理指引 + 返回列表链接；自带 meta charset，中文永不乱码））——预览服务在任何目录启动都能看到任何会话生成的 deck。

### 阶段 8：Revision Loop——依赖感知修改循环

先判断影响层级，再决定动作（完整影响范围表见第九节）：

```
用户反馈
   ↓ 判断影响层级（Slide / Section / Deck / 重新规划）
   ↓
Slide 级：重写该页（小改动优先 append:true 原位替换，整页重构则整页重写）→ ppt_scene_check（revalidated 只含该页）→ ppt_deck_render
Section 级：重调该部分 ppt_section_draft → 页 ID 自动重排 → 补写新页 → check + render
Deck 级：重新 ppt_design_lock → 令牌变 → sceneHash 失效 → 全册重新 check → render
重新规划：改听众/目标 → 新 deck 重走 0–3
```

### 横切与排查工具

不属于单一阶段、全程可用的工具：`ppt_asset_register` / `ppt_image_generate`（阶段 5 配图：登记本地图片 / 生图接口）、`ppt_preview_update`（阶段 5/8 即时预览与进度条）、`ppt_deck_pause`（阶段 5 暂停/恢复生成）、`ppt_deck_find_replace` / `ppt_deck_branch`（阶段 8 批量改词 / 试错分支）、`ppt_log_query`（日志查询，按 stage/pageId/level 过滤，`source:"plugin"` 查插件级调用日志与失败入参快照——快照存 `<rootDir>/logs/failed/`，全局 FIFO 保留最近 100 份，0.8.1 起不会无限堆积）、`ppt_deck_status`（进度查看，不传 deckId 列全部 deck）、`ppt_doctor`（环境体检：pptxgenjs 解析路径与互操作形态、依赖可用性、输出目录可写性、预览端口探活、生图配置、失败快照数量——工具报错原因不明时先调它）。

## 四、数据模型与工作区

```
<ppt-studio>/<deckId>/
├── brief.json        0 简报（听众/场景/目标/时长/选定主题/mode/evidenceLevel）
├── outline.json      1 叙事架构（coreMessage + parts）→ 3 合成页级蓝图 pages（页 ID 规范化重编号；页条目含 transition/evidence）
├── plan.json         2 页数计划（contentPages + allocation + 3 结构页 = totalPages）
├── sections/         3 各部分蓝图快照（含 s0 结构页）
├── design/
│   ├── spec.json     4 完整设计规范（页数分配/密度策略/设计纪律/prototypePages 代表页，给模型读）
│   └── tokens.json   4 全 deck 锁定令牌（机器消费：写页校验 + 双渲染器）
├── pages/p00N.json   5 单页场景（PageScene：type/background/elements[≤24]/notes）
├── assets/images/    冻结图片 + manifest.json（sha256/来源/尺寸）
├── deck.pptx         7 最终产物（可编辑）
├── preview/index.html 5/7 自包含预览播放器（即时预览与正式渲染共用）
├── report.json       7 渲染与校验报告
├── state.json        状态机（stage/pagesWritten/sceneHash/pageHashes/renderedAt）
└── logs/generation.log  JSONL 全流程日志（stage/pageId/level 可过滤）
```

所有 JSON 写入均为原子写（tmp + rename）；步骤衔接全部通过这些文件（不内存直传），天然支持断点续跑。

## 五、状态机

```
briefed → outlined → planned → drafted → locked → writing → rendered
   0         1         2      3(d)      4        5        7
```

| stage | 进入条件 | 说明 |
|---|---|---|
| briefed | `ppt_brief_create` | 建 deck，brief.json 落盘 |
| outlined | `ppt_outline_draft` | 叙事架构确认（架构确认后不可回退） |
| planned | `ppt_pageplan_confirm`；蓝图部分完成时停留在此 | 页数与分配确认 |
| drafted | 全部部分蓝图 + 结构页齐备且 Σ=contentPages | 整体蓝图就绪 |
| locked | `ppt_design_lock` | spec + tokens 双文件锁定 |
| writing | 首次 `ppt_page_write` 及此后任何改页 | 与 sceneHash 闸门配合 |
| rendered | `ppt_deck_render` | 产物就绪；改页后回到 writing |

进度随时 `ppt_deck_status` 查看（不传 deckId 列全部 deck）。特殊标记按性质分三类（0.9.0 明确纪律：**新增标记先问是否可推导**，可推导的不落盘）：

| 类别 | 字段 | 说明 |
|---|---|---|
| 属性（谁/何处） | `paused`、`parentDeckId` | 暂停状态与分支来源，deck_status 展示 |
| 一次性标记（持久） | `previewOpenedAt`/`renderOpenedAt`（预览每阶段首开）、`architectureRevisedAt`（架构修订）、`lastMigration`（迁移排查）、`outlineHash`（关系型变更基线） | 事件事实，必须持久化 |
| 派生展示态（写时置位 O(1)，避免 status 全量重算） | `contentOutdated`、`renderOutdated` | 理论上可从 stage+sceneHash 推导；置位是性能优化，sceneHash 闸门是最终双保险（三处状态流转中断也不会放过期内容渲染） |

流转：page_write 置 contentOutdated（曾渲染则 renderOutdated）→ check 清 contentOutdated、置 renderOutdated 并更新 outlineHash → render 清 renderOutdated（contentOutdated 已被 check 清除——sceneHash 闸门保证 render 前必经 check；render 后再改页由 page_write 重新置位）。deck_status 把过期类标记直接提示为"需重新校验 / 需重新渲染 / 需重走 2–5"。

**断点续跑（中断恢复）**：全部产物落盘、无内存状态——会话/进程中断后，新会话调 `ppt_deck_status` 即可找到每个 deck 的阶段与页面进度，从断点继续（各工具校验前置产物并提示缺什么）。跨会话/跨机器恢复的前提是同一工作区根目录（`PPT_STUDIO_OUTPUT_DIR` 一致）。预览侧无此约束：预览服务经全局工作区注册表多根托管，任意会话工作目录生成的 deck 都能预览。

## 六、校验规则全集

级别语义：**error** = 拒绝落盘/拒绝渲染；**warning** = 允许继续但必须知情；模型须把 warning 向用户说明。

**问题分级与修复建议（0.8.1）**：高频可修复问题（文字溢出/越锁颜色字体/要点超限/证据缺源/有图页超密度）附 `fixable: true` 与 `suggestedFix`（如"扩高文本框到 X 英寸或精简文字 N%"），模型按建议直接改页重写，不再自行猜测修法。

**证据升级条件（0.8.1，0.9.1 精确引用）**：简报提供 `referenceMaterials` 清单时，EVIDENCE_SOURCE_MISSING 升级为 error（evidence 优先以 `materialId` 按 id 精确引用清单条目，source 的 id/标题子串匹配保留兼容兜底）；未提供清单维持 warning。

**页级密度系数（0.8.1）**：蓝图页级 density（low/medium/high）以 ×0.7/×1.0/×1.3 系数作用于有图页文字预算（字号阶梯与要点上限仍按全册——视觉一致性与认知上限不随页级放宽）。**densityOverride（0.8.2）**：页级 `{reason}` 豁免把 DENSITY_WITH_VISUAL / BULLET_BUDGET_EXCEEDED 降为 info（理由随 issue 展示，知情放行而非静默绕过）。规则分级依据见 `reference/validation-rules.md`（每条规则一句话说明为什么是这个级别）。

**校验强度（0.8.0，brief.strictness）**：`normal` 按上表默认分级；`strict`（品牌一致性/学术场景）把 TOKEN_COLOR / TOKEN_FONT / EVIDENCE_SOURCE_MISSING 升级为 error（越锁即错）；`relaxed`（草稿快速产出）把 DENSITY_WITH_VISUAL / BULLET_BUDGET_EXCEEDED / ELEMENT_COUNT / READABILITY / TEXT_OVERFLOW_RISK / VISUAL_RHYTHM / LAYOUT_MONOTONY / TYPE_DIVERSITY 降为 info。写页与全册校验都按强度分级。

### 单页规则（validatePage，写页时同步 + 全册校验复查）

| 规则 | 级别 | 逻辑 |
|---|---|---|
| ID_DUPLICATE | error | 元素 ID 重复 |
| ELEMENT_COUNT | warning | 元素数超上限（常规 12；timeline/comparison/process/cards/hierarchy/icon-list 结构化页型放宽到 24） |
| OUT_OF_BOUNDS | error | 内容元素越出安全区（画布 13.3333×7.5in，边距 0.15in） |
| BG_OUT_OF_CANVAS | warning | 背景装饰元素超出画布 ±0.3in |
| TEXT_OVER_TEXT | error | 两个文本框互压 |
| ELEMENT_OVERLAP | warning | 普通元素叠放（卡片衬底应加 background:true） |
| FONT_TOO_SMALL | error | 字号 <10pt |
| READABILITY | warning | 正文字号 <14pt 且文字较多（11–12pt 来源注释属正常知情提醒） |
| TEXT_SEVERE_OVERFLOW | error | 文字容量估算 ratio >1.5（严重溢出） |
| TEXT_OVERFLOW_RISK | warning | 文字容量估算 ratio >1.15（CJK 全角按 1em 逐字符估宽） |
| IMAGE_SOURCE_INVALID | error | image 元素未提供/同时提供 assetId 与 placeholder |
| ASSET_MISSING | error | 引用未登记资产（必须先 ppt_asset_register） |
| IMAGE_DISTORTION | warning | fit=fill 且宽高比 >2.8（拉伸风险） |
| TABLE_FONT_SMALL / TABLE_READABILITY | error / warning | 表格字号 <9pt / <11pt |
| TABLE_RAGGED | error | 表格各行列数不一致 |
| CHART_SHAPE_MISMATCH | error | 图表系列长度 ≠ labels 长度 |
| CHART_PIE_MULTI_SERIES | error | 饼图/环图多系列 |
| CHART_ALL_ZERO | warning | 全零系列 |
| CHART_CATEGORY_CROWD | warning | 饼/环图类别 >6：扇区过窄标注不下、占比难比较——改条形图或合并长尾（0.9.2，借鉴感知可读性纪律的可判定部分） |
| CHART_LEGEND_REDUNDANT | info | 非饼/环的单系列图开着图例：图例只重复系列名，建议 showLegend:false 并在标题点名（饼/环除外——其图例承载类别名） |
| TOKEN_COLOR | warning | 元素/页面背景用了令牌外颜色（只能用 tokens.colors / tokens.chartColors） |
| TOKEN_FONT | warning | 字体不在锁定字体内（fonts.title / fonts.body） |
| DENSITY_WITH_VISUAL | warning | 有主视觉页全页文字量超预算（"有图文字精炼"的量化） |
| VISUAL_PLAN_UNMET | warning | 蓝图 visual:image/chart 但页面没有对应元素 |
| PAGE_ELEMENTS_DROPPED | error | 整页替换遗漏既有元素：**默认拒绝保存**，`allowDrop:true` 显式确认删除后放行并降为 warning（0.7.1 从 warning 升级——两起真实数据丢失事故） |
| BULLET_BUDGET_EXCEEDED | warning | 要点（bullet 段落）条数超密度预算（spec.densityPolicy.bulletsMax：sparse 4 / normal 6 / dense 6——0.7.0 起从文案建议升级为强制规则，控制认知负荷） |
| EVIDENCE_SOURCE_MISSING | warning | 证据层：business 级页面有数字论断（含图表数据）但无带 source 的 evidence 条目；academic 级 fact/data 条目缺 source。来源只能来自用户材料，无法核实改定性表述或标「数据待补充」 |
| SVG_VIEWSIZE | error | svg 路线页 viewBox ≠ "0 0 1280 720"（与画布 13.3333×7.5in 同比例；随意宽高会拉伸错位）（0.10.0） |
| SVG_UNSAFE | error | svg 页包含脚本 / on* 事件 / foreignObject / 外部引用——安全面与内网红线（SVG 必须自包含）（0.10.0） |
| PAGE_SCENE_INVALID | error | 页面既无 elements 也无 svg（文件损坏或被手改——读盘不过 zod 的兜底）（0.10.0） |

### 全册规则

| 规则 | 级别 | 逻辑 | 阶段 |
|---|---|---|---|
| PAGE_MISSING | error | 大纲页未写入 | 6 |
| PAGE_ORPHAN | warning | 页面不在大纲中（不参与渲染） | 6 |
| STRUCTURE_TYPE_MISMATCH | warning | 蓝图信息结构与页型错配（映射表见第七节） | 5/6 |
| LAYOUT_MONOTONY | warning | 连续 3 页同页型（模板化过度） | 6 |
| TYPE_DIVERSITY | warning | >10 页内容只用 <3 种页型 | 6 |
| VISUAL_RHYTHM | warning | 连续 4 页无任何图/图表（视觉节奏单调） | 6 |
| NARRATIVE_CHAIN_MISSING | warning（strictness=strict）/ info（链已建立时） | 内容页缺 transition.fromPrevious（未说明如何承接上一页）。strict 档升 warning；其余档链完全未建立时静默、部分建立时缺口提示 info（避免对存量 deck 刷屏）。0.9.1 起分级只认 strictness——mode 只决定确认点，precise 用户要叙事链 warning 请同时设 strictness=strict | 6 |
| TITLE_TAKEAWAY | warning | 标题即结论：页标题与章节标题完全相同，或过短（<5 字符）且有 keyMessage——只给话题不给结论（章节隔页豁免） | 6 |
| DECK_DURATION_MISMATCH | info | 估算讲述时长（Σ(页面+备注)全角字 ÷220/分钟 + 每页 0.3 分钟，再乘页型系数——完整公式见阶段 6）与简报时长偏差 >±35%（info 级，供精简/重对页数参考） | 6 |

### 双闸门

- **sceneHash**（sha256 前 16 位，覆盖 插件版本 + tokens + outline + 全部页面——版本盐见阶段 7）：渲染闸门，改过必须重检。
- **pageHashes**（每页 sha256 前 12 位，仅页面内容）：依赖感知，识别修改循环中的变更页。

## 七、主题 / 页型 / 信息结构体系

### 12 套主题（`src/themes.ts`）

business-blue 商务蓝 / tech-dark 科技深色 / gov-red 政务红 / academic-plain 学术素雅 /
fresh-teal 清新青绿 / warm-sunset 暖阳渐变 / mono-editorial 极简杂志 / indigo-gradient 靛蓝渐变 /
cream-notes 奶油手账 / forest-ink 墨绿学术 / navy-gold 藏蓝鎏金（深色）/ slate-orange 工业灰橙。

每套含 8 色板（bg/surface/primary/secondary/accent/text/textMuted/onPrimary）+ chartColors（6）+ heroGradient + 字体。

### 17 种页型（`PAGE_TYPES`，版式坐标速查见 `reference/layouts.md`）

cover / toc / section / bullets / two-col / image-text / chart / table / quote / closing /
**timeline / comparison / big-number / process / cards / hierarchy / icon-list**（后七种为 0.2.0 新增）。

### 10 种信息结构（Blueprint 层 `structure`）→ 适配页型映射

| structure | 适配页型 |
|---|---|
| plain | 任意 |
| timeline | timeline |
| comparison | comparison / two-col / table |
| process | process / image-text |
| hierarchy | hierarchy / bullets |
| cause-effect | two-col / process / comparison / image-text |
| problem-solution | two-col / process / comparison / image-text |
| before-after | comparison / two-col |
| concept-example | image-text / cards / icon-list / big-number |
| data-insight | chart / big-number / table |

## 八、设计令牌与密度策略

### design/tokens.json（锁定令牌，`buildDesignTokens` 生成）

```
colors        8 色板（主题 + paletteOverrides 解析后的最终形态）
chartColors   图表循环色（≤6）
fonts         title / body
fontSizeLadder 封面/章节/内容页标题/正文/注释 五级字号（随密度）
anchors       内容页标题锚点（titleX 0.6 / titleY 0.45 / titleW 12.13 / 标题条 0.9×0.06）
grid          marginX 0.6 / contentTop 1.6 / contentBottom 7.0 / 画布 13.3333×7.5
```

### 密度 → 字号阶梯与文字预算

| 密度 | coverTitle/sectionTitle/pageTitle/body/note (pt) | 有图页文字预算 | 无图页 | 要点上限 |
|---|---|---|---|---|
| sparse | 44/34/28/17/12 | 140 全角字 | 400 | 4 |
| normal | 40/32/26/16/11 | 220 | 700 | 6 |
| dense | 38/30/24/14/10 | 320 | 1000 | 6 |

- "有图文字精炼、无图文字可以多"由此量化为 DENSITY_WITH_VISUAL 规则。
- "要点上限控制认知负荷"由 BULLET_BUDGET_EXCEEDED 强制（0.7.0 起 bulletsMax 从 spec 文案建议升级为校验规则）。
- 页级 density（low/medium/high）是蓝图层的意图声明，与全册 density 独立。

## 九、修改循环与依赖传播

### 影响范围表（SKILL.md 同款，判断改动的第一依据）

| 用户反馈 | 影响层级 | 动作 |
|---|---|---|
| 改一个字 / 换一张图 / 调一页版式 | Slide | 带 append:true 原位替换该元素 → check（revalidated 只含该页）→ render |
| 修改一页的内容逻辑 | Slide | 对照蓝图 purpose/keyMessage 整页重写（完整元素清单）→ 同上 |
| 增删一页 | Section + Deck | 重调该部分 section_draft（页 ID 自动重排）→ 补写新页 → check + render |
| 增删章节 / 改章节页数 | Section + Deck | 页数层面：pageplan_confirm 重确认 + 重草拟受影响部分（其余已写页自动迁移编号）；故事层面 → outline_draft revise:true 原地修订（清除下游，保留简报/令牌）或新 deck |
| 换字体 / 换整体配色 | Deck | 重新 design_lock → 令牌变 → sceneHash 失效 → 全册重检 → render |
| 改听众 / 改演讲目标 | 重新规划 | 目标变则故事变：新 deck 重走 0–3（或 ppt_deck_branch 快照后在新分支上重走 1–3，源不受影响） |
| 全册批量改词（如"人工智能"→"AI"） | 多页 | ppt_deck_find_replace：dryRun 预览影响面（命中按 正文/表格 分组）→ 用户确认 → 执行（skipTables 可跳过表格单元格防误伤结构化数据；**执行后自动复查受影响页**并点名替换引发的新问题（文字变长溢出等），同时置 contentOutdated）→ 增量 check → render。**svg 路线页不参与 content 替换**（文字嵌在整页源码中，全局替换有破坏标记结构的风险——返回值 skippedSvgPages 点名，需要改请重写该页 SVG；titles/notes 作用域不受影响） |
| 想试另一个叙事方向/页数方案 | 分支 | ppt_deck_branch 快照当前进度开分支，两边互不影响 |

### 传播机制

- 改页：只影响该页的 pageHash → 下次 check 只把该页列入 revalidated。
- 改令牌：sceneHash 输入含 tokens → 必然失效 → 强制全册重检（已有页面可能新触发 TOKEN_* 违规）。
- 快速过目：改完页可先 `ppt_preview_update`（免闸门、每阶段首开各只自动弹一次），确认后再正式 check + render。

## 十、有意取舍

| 不做的事 | 理由与替代 |
|---|---|
| 结构页计入用户确认页数 | 维持"内容页数口径 + 自动附加 3 页并明示总数"，避免口径混乱（0.2.0 与用户确认的口径） |
| PPTX 单页局部渲染 | PPTX 是单文件包、全量渲染毫秒级；"局部"落在校验与排查（revalidated）而非渲染文件 |
| 逐部分"停下来等确认" | 打断节奏且与"一气写完"口径冲突；即时预览已提供边生成边调整的观察窗口 |
| 架构确认后回退修改 | 状态机推进保护：改故事=新 deck 重走（防止下游全部作废却无感知） |
| 外网图片搜索 | 内网红线：图片只走资产登记 / 生图接口 / 占位框 |
| Evidence 联网核实/自动引用 | 内网红线：来源只能来自用户材料；无法核实的数据改定性表述或标「数据待补充」，禁止编造引用（0.7.0 记录） |
| Feedback Queue（生成中反馈排队、完成后统一执行） | 本系统是同步对话式 agent，无后台 worker；等价能力已有——批量改词 ppt_deck_find_replace + 修改循环 SOP 要求生成完成后统一收集反馈逐批处理（0.7.0 记录） |
| 语义级 Page Dependency Graph | pageHashes/sceneHash + 第九节影响范围表已覆盖确定性传播；语义依赖推断维持缓做 |
| 语义级 Audience QA（术语难度 vs 听众） | 确定性不可判；靠 SOP（听众决定措辞）+ storyline 摘要辅助模型自审 |
| 元素级校验指纹 | 页级指纹+校验已是毫秒级，非瓶颈不动（0.6.0 记录） |
| LLM 语义连贯性检查（MESSAGE_DRIFT 等） | 违背确定性校验哲学且慢/易误报；0.7.0 已落"半自动"形态：transition 叙事链字段 + storyline 摘要供模型自审，纯 LLM 评分维持缓做 |
| 预览差异高亮（旧 vs 新 diff 视图） | revalidated 已指明变更页；完整 diff 按需再做 |
| 日志回放（Markdown 时间线） | ppt_log_query 已可按 stage/level 过滤，价值/成本比暂不做 |
| 材料库（文档/表格/引用登记 + claim→source 候选映射） | 0.8.0 评审记录缓做：evidence 条目先由模型从用户材料手工摘录；量大后再做登记与自动映射 |
| 分支合并/对比（把 B 分支某部分挪进 A） | 0.8.0 评审记录缓做：branch 已可试错二选一；选择性合并需页级冲突策略，按需再做 |
| 配图异步化（先占位后回填 pendingAssetId） | 0.8.0 评审记录缓做：现行"配图先于写页"+placeholder 降级已够用；生图慢成为实际瓶颈再做 |
| 双渲染器视觉回归（像素/几何 diff） | 0.8.0 评审记录缓做：两渲染器共享 PageScene+tokens 几何换算已有单测；像素级回归需截图基建 |
| 自定义确认点数组（brief.confirmations） | 0.8.1 已采纳为 confirmStages（覆盖三档闸门组合） |
| 预览服务 token 权限 / 工作区属主隔离 | 0.8.1 评审记录缓做：默认单用户 localhost 场景无越权面；对外共享部署前再设计（token 与 deckId 映射、有效期、属主隔离需整体方案） |
| 页级指纹拆分（content/visual/notes 三份哈希按规则选用） | 0.8.1 评审记录缓做：全册校验已是毫秒级，收益集中在"改备注不触发重检"这类低频场景，且哈希结构变更牵动 pageHashes 兼容 |
| 失效页占位渲染（.invalid.json + 大字提示） | 0.8.2 评审记录缓做：check 的 PAGE_MISSING error 已强制处理（不重写无法渲染），migration 返回与 render 文案已点名；占位渲染收益边际 |
| ppt_evidence_materials 材料解析/索引工具 | 0.8.2 评审记录缓做：referenceMaterials 清单 + 引用强制已落约束；PDF/Word 解析与检索是独立体量，等真实频度 |
| doctor 历史对比（环境变动检测） | 0.8.2 评审记录缓做：plugin.log 记录每次调用成败与堆栈，已可人工回溯；自动 diff 待需求 |
| 大 deck 校验缓存（pageValidations 按 pageHash） | 0.8.2 评审记录缓做：60 页全册校验毫秒级、revalidated 已指明变更页；缓存引入 state 膨胀与一致性成本 |
| 多语言预算系数（brief.language） | 0.8.2 评审记录缓做：charUnits 已按字符宽度折算（西文 0.5–0.62em），预算天然多语言近似；显式系数等真实需求 |
| quickInteractive 子模式 | 已被 confirmStages 覆盖（0.8.1）；0.9.0 进一步把 mode 收敛为 confirmStages 预设——组合维度从 4 降到 2（确认点数组 + 证据/严格度两个正交旋钮） |
| TOKEN_COLOR/TOKEN_FONT 默认升 error | 0.9.0 评审结论不采纳：渲染器对锁外颜色是**原样渲染**而非报错（评审前提不成立）——warning 语义自洽（品牌提醒），strict 档已可升级；validation-rules.md 已澄清 |
| ELEMENT_COUNT 上限（12/24）收进 spec/tokens | 0.9.0 评审结论缓做：页型上限是校验器口径而非设计决策，进 spec 属过度配置；口径已在 validation-rules.md 集中说明 |
| 状态标记归并为 state.flags 对象 | 0.9.0 评审结论不采纳：破坏存量 state.json 兼容且收益是纯结构美观；改为"标记分类纪律"（上表）——新标记先问是否可推导 |
| 语速 220 字/分钟做成可配置项 | 0.9.0 评审结论缓做：常量已命名集中（SPEAKING_CHARS_PER_MIN）；课堂等停顿多的场景由 DECK_DURATION_MISMATCH 的 info 提示兜底 |
| page_write→check→render 三处状态写合并为一次收敛 | 不采纳：三处中断窗口由 sceneHash 渲染闸门兜底（过期内容不可能渲染），标记只是展示优化 |
| **稳定页 ID 重构**（pg_xxx 永久身份 + order 字段 + p00N 降为展示别名） | 0.9.1 评审不采纳：收益是"插页免迁移"，但需重写全链路 ID 语义、迁移存量 deck 文件、牺牲 p 编号的人读性（SOP/demo/日志大量依赖）；现有迁移机制已带预检+原子性+lastMigration，真实缺口（prototypePages 引用错位）已用重映射补上。若未来页级评论/跨页引用成为功能再评估 |
| **跨文件事务**（revision 指针 + 暂存版本 + expectedRevision 乐观锁 + operationId 幂等 + deck 级提交锁） | 0.9.1 评审不采纳：单用户同步对话式 agent 无并发提交面（工具顺序调用，DSH 宿主串行分发）；单文件原子写 + 先迁移后落盘 + sceneHash 闸门已覆盖崩溃窗口（半途状态最多导致"要求重新 check"，不会渲染错内容）。并发多会话写同一 deck 成为真实场景再做 |
| **确认绑定产物哈希对象**（approval:{approvedHash, approvedAt} 持久化每次确认） | 0.9.1 评审不采纳：确认是对话行为（用户说"可以"），无工具调用时刻可挂钩，持久化批准时刻需要新增 approve 工具且打断 SOP；"改了产物旧确认失效"的运行时兜底已由哈希闸门承担——outlineHash/sceneHash/pageHashes 变化强制重走 check，blueprint 漂移由 STRUCTURE_TYPE_MISMATCH 点名。改为文档明确 quick 打包确认=方向授权非状态闸门（第一节） |
| **PPTX 实际渲染成图 QA**（渲染为页面图片检查裁切/遮挡/字体回退/对比度） | 0.9.1 评审不采纳：内网 DSH 环境无法假定 LibreOffice/PowerPoint COM 可用，截图基建是独立体量；采纳其"能力边界披露"部分——render 返回与本文档明示"已验证场景与文件结构，办公软件实际渲染以预览与肉眼复核为准"；HTML 预览（与 PPTX 同源场景+令牌）承担所见即所得通道 |
| **claimId 关联到正文 run/图表系列**（论断级定位到页面具体元素） | 0.9.1 评审不采纳：正文是自由文本，claim→run 的关联是语义判断（确定性不可判）；已采纳其确定性部分——evidence.materialId/locator 让"材料里的哪一处"可精确追溯，引用完整性可判定；引用支持性维持模型自审（阶段 3 叙事试读 + 阶段 6 storyline） |
| **暂停拦截扩展到全部生成工具**（section_draft/design_lock/render 一并拒绝） | 0.9.1 评审不采纳：单对话 agent 里"暂停"首先是 SOP 语义（模型收到指令自然停手），工具级拦截写页已覆盖"后台自动续写"的主要风险；拦更多工具增加恢复成本与误伤（暂停期间查看/诊断仍可用） |
| **warning 问题指纹去重**（同一问题未变化不重复向用户展示） | 0.9.1 评审部分采纳为 SOP：check 返回全量 issues 供模型核对，SKILL 要求向用户只转述 error + 未确认过的 warning；工具层做指纹状态会引入"哪些 warning 已知情"的持久化复杂度，收益靠话术纪律即可达成 |
| **多画布格式**（4:3 / 小红书 3:4 / 故事 9:16 / A4，借鉴自 ppt-master canvas-formats） | 0.9.2 评审不采纳：那是"多格式视觉内容工作台"定位；本插件是演示文稿插件，全链路坐标体系（units/layouts.md/双渲染器/预览/校验阈值）按 13.3333×7.5in 建设，换画布是全量改造而非参数化；演示场景真需要 4:3 时再评估 |
| **PPTX 动画 / TTS 旁白**（借鉴自 ppt-master animations/audio-narration） | 0.9.2 评审不采纳：pptxgenjs 不支持动画 OOXML 注入（其动画栈是 python-pptx 路线）；内网环境不保证 TTS 服务可用；两者都是独立体量，与确定性版式校验正交 |
| **外部 PPTX 模板导入**（借鉴自 ppt-master template_import） | 0.9.2 评审不采纳：已有 copyFromDeckId 跨 deck 克隆锁定令牌（周报系列复用品牌）；导入外部 PPTX 需解析母版/版式/主题 OOXML 并映射到本插件令牌模型，是"翻译器"体量且映射必然有损 |
| **构图目录编号体系**（ppt-master image-layout-patterns 的 90 条 P/M/A/C 编号词汇） | 0.9.2 评审不采纳：编号体系服务于其 SVG 自由绘制路线；本插件版式由 17 页型 + layouts.md 坐标速查承担（确定性更强），构图词汇已提炼进 copywriting 生图纪律（主体特写/场景环境/留白呼吸） |
| **SVG→PPTX 逐元素转换**（ppt-master svg_to_pptx 全量工具链：187 种 Office 形状映射/plot-area 校准/ChartEx） | 0.10.0 采纳了轻量替代而非全量移植：其转换器是 Python 脚本栈（DSH 宿主不保证 Python），且与我们的确定性校验体系互斥；本插件 svg 路线 PPTX 端用**整页矢量图嵌入**（pptxgenjs 原生支持、PowerPoint 2016+ 可"转换为形状"）——保真零损耗、实现零依赖，代价是无元素级可编辑性（已在路线选择时明示）。逐元素转换等真实需求再评估——完整实现方式对比（Python vs Node 逐维度优缺点）见第一节「渲染路线实现方式对比」 |

## 十一、版本演进

| 版本 | 流程变化 |
|---|---|
| 0.1.x | 五阶段：草稿框架 → 设计确认 → 整册大纲 → 逐章 → 逐页；防御性容错体系（冻结入参/互操作/损坏形态修复） |
| 0.2.0 | 七阶段重构（a–g）：主题/听众/场景前置，页数口径确立，两份设计文件锁定，主题 6→12、页型 10→17 |
| 0.3.0 | 九阶段（0–8）：Brief 增 objective/duration；大纲升级叙事架构；页数升级分配表；草稿升级页面蓝图（purpose/keyMessage/structure/density）；跨页集成检查；依赖感知增量校验 |
| 0.4.0 | 设计规范确认（propose 2–3 套预设）；样例质量关卡；即时预览（ppt_preview_update，边生成边调整） |
| 0.5.0 | 智能推荐（主题 category 分类 + ppt_themes topicType 排前标推荐）；设计模板复用（ppt_design_lock copyFromDeckId 原样克隆源 deck 令牌）；中断恢复写入 SOP（deck_status 找断点续跑） |
| 0.5.1 | 真实会话四问题修复：预览多根托管（工作区注册表）、渲染/预览自动打开浏览器（可配置）、page_write 整页替换语义显式化 + append 追加模式 + PAGE_ELEMENTS_DROPPED 警告（p014 增量写丢数据事故）、诊断版本漂移修正 |
| 0.6.0 | 场景驱动预设（方案 D）；进度可视化（播放器进度条）+ ppt_deck_pause；批量修改 ppt_deck_find_replace；试错分支 ppt_deck_branch；分配理由 + 跨工作区模板复用；样例关卡结构聚类与"先图后页"SOP |
| 0.7.0 | 生成模式三档（quick 打包确认 / standard / precise + Prototype）；Prototype 代表页（design_lock 按结构聚类挑 ≤3 页，先看真实效果再批量）；transition 叙事衔接 + storyline 自审摘要；evidenceLevel 证据层（内网来源=用户材料）；页数档位推荐（时长驱动）；TITLE_TAKEAWAY / BULLET_BUDGET_EXCEEDED / DECK_DURATION_MISMATCH 等规则，校验 30→35 条 |
| 0.7.1 | 真实会话（Transformer deck，29 页）修复：**PAGE_ELEMENTS_DROPPED 升级 error**（整页替换丢元素默认拒绝，`allowDrop` 确认删除——p004 梯度图/p005 配图被静默丢弃事故）；**公式排版**（run 级 superscript/subscript，双渲染器支持；禁止 Unicode ᵀ 与字面 ^/_ 记法）；容错归一吸收 chart.labels/table.rows 数字形态（此前 8 次被拒）；section_draft 报错中文化 + contentBrief 300→500（此前 7 次被拒） |
| 0.7.2 | 预览自动打开三态（用户反馈：生成期间每次预览/渲染都弹新窗口）：默认 once=每 deck 只弹第一次（state.previewOpenedAt 持久化），always=旧行为，0=关闭；环境变量/行配置同步扩展 |
| 0.8.4 | 预览错误页样式化（用户反馈"访问不存在应显示 404 页面"）：全部错误路径（deck 不存在/预览未生成/路径不合法/越权/内部错误）返回完整 HTML 错误页——状态码大字 + 原因 + 处理指引（含托管工作区清单）+ 返回列表链接，自带 meta charset |
| 0.8.3 | 预览乱码修复（用户反馈）：**preview-server 全响应补 charset=utf-8**（404/403/405/500 的中文错误页此前无 Content-Type，浏览器按本地编码解码显示乱码——"有时乱码不是 PPT"的直接原因）；**preview/index.html 原子写**（tmp+rename，生成期间不再可能读到半截 HTML）；注册表被调试脚本污染的垃圾根清理（0.8.2 的登记时清理对此已有长效防护） |
| 0.8.2 | 13 点工程评审落地 7 项：**densityOverride 页级预算豁免**（reason 知情降 info）；**prototypePageIds 用户指定代表页**（蓝图阶段标记"最关心这几页"）；**find_replace 执行后自动复查**（点名替换引发的新问题 + contentOutdated）；蓝图漂移指引（STRUCTURE_TYPE_MISMATCH 提示先更新蓝图）；注册表登记时清理失效条目；**reference/validation-rules.md**（每条规则一句话分级依据）；layouts.md 页型→结构反向索引。已覆盖 2 项（quickInteractive=confirmStages、迁移丢失检测=PAGE_MISSING 强制）；缓做 5 项见取舍表 |
| 0.8.1 | 12 点评审落地 10 项：**referenceMaterials 参考材料清单**（evidence.source 必须引用清单条目否则 error——"内网来源=用户材料"可执行）；**迁移硬化**（源缺失/目标占用预检 + 先迁移后落盘的原子性 + state.lastMigration）；**confirmStages 自定义确认点** + quick 返回"可重调覆盖"提示；**prototype 双维度抽样**（结构类×页型）+ 样例关卡同口径；**预览每阶段首开**（previewOpenedAt/renderOpenedAt 分开记）；**页级密度系数**（low ×0.7/high ×1.3 作用于文字预算，字号与要点上限仍按全册）；**fixable/suggestedFix** 修复建议；**find_replace skipTables** + dryRun 命中分组；storylineGaps 疑似断裂清单；失败快照 FIFO 保留 100 份。缓做：预览 token 权限、指纹拆分 |
| 0.8.0 | 修改循环与状态一致性（16 点流程评审落地 6 项）：**页 ID 重排迁移**（section_draft 重编号后自动迁移已写页文件/pageHashes/pagesWritten，蓝图变化页清除并提示重写）；**架构修订 revise**（outline_draft 带 revise:true 原地改故事：清除蓝图/已写页/页数计划，保留简报与令牌，state.architectureRevisedAt）；**写页合并语义**（append + remove:[id] 显式删除，不触发丢元素闸门）+ 写页阶段闸门；**strictness 校验强度三态**（strict 升令牌/证据类为 error，relaxed 降认知负荷类为 info）；**contentOutdated/renderOutdated 过期标记**（deck_status 直观提示需重校验/重渲染）；时长估算页型系数（数据页 ×1.3 / 结构页 ×0.5） |
| 0.9.0 | **减法与收敛版本**（13+6 点架构评审）：**mode 收敛为 confirmStages 预设**（唯一开关是确认点数组，brief 落盘时展开；组合维度 4→2）；**叙事试读**（阶段 3 蓝图确认以"问题→答案+每页标题/核心信息/承接语"纯叙事视角通读，故事错误在投入视觉前拦截）；**outlineChanged 关系型变更信号**（大纲指纹进 state，改 transition/页序后提示重读全量叙事链——补上页级指纹覆盖不到的页间关系盲区）；**连续失败主动提示**（同工具连续失败 ≥2 次的报错自带 doctor/log_query 指引）；语速常量命名集中；状态标记分类纪律 + validation-rules 元原则与知情放行对照表。不采纳（含理由）：TOKEN 默认 error、上限进 spec、flags 重构、语速配置化 |
| 0.9.1 | **对称性补全版本**（架构评审"版本化确认/稳定身份/事务/真实渲染验收"逐条评估）：**mode 解耦完成**（design_lock 的 Prototype 生成、NARRATIVE_CHAIN_MISSING 分级、brief 返回指引全部读 `resolvedConfirmStages` 展开值，代码零 mode 行为分支——quick+显式 prototype 组合不再被吞）；**prototypePages 迁移对齐**（重排时随页 ID 重映射，蓝图消失页移除；顺带修复删页后位移被"目标占用"预检误拦的真 bug）；**sceneHash 版本盐**（插件升级后存量 deck 渲染前强制重检——规则演进不漏检）；**渲染复检与 check 同路**（补传 strictness/evidenceLevel/referenceMaterials，闸门强度对称）；**时长估算计入演讲者备注**；**Prototype 风险加权**（簇内挑图表/信息密集页，用最少页暴露最多渲染风险）；**evidence materialId/locator 精确引用**（id 精确匹配优先于子串）；方案 B 密度-时长方向修正（时间极紧建议稀疏而非紧凑）；渲染 QA 能力边界明示。不采纳（含理由见取舍表）：稳定页 ID 重构、跨文件事务、确认哈希对象、PPTX 渲染成图 QA、claimId 正文关联、暂停全工具拦截 |
| 0.9.2 | **图表与配图纪律版本**（借鉴 ppt-master 的感知可读性与生图提示词工程）：**+2 图表可读性规则**——CHART_CATEGORY_CROWD（饼/环 >6 类改条形或合并长尾）、CHART_LEGEND_REDUNDANT（非饼/环单系列图例冗余，info 建议标题点名），校验 35→37 条；**生图与锁定令牌协调**（ppt_image_generate 设计锁定后返回 deckPalette 摘要，"同 deck 全部配图共用色彩锚"由返回提醒+SOP 达成，不静默改写 prompt）；**散文提示词纪律**（风格家族同 deck 统一+主体视觉名词+构图+色彩占比+图内不写字——图内文字改一词=整图重生成）；copywriting.md 新增图表与表格数据呈现纪律（零基线/单色深浅/直接标签/同域可比/列宽按语义权重）；文档↔代码一致性审计修正 8 处残留口径。不采纳（含理由见取舍表）：多画布格式、PPTX 动画/TTS、外部模板导入、构图目录编号体系 |
| 0.10.0 | **SVG 渲染路线（用户可选的第二条生成路线，借鉴 ppt-master 的 SVG 自由绘制理念）**：brief 新增 `renderRoute`（native 默认 / svg），阶段 0 向用户说明取舍后选择——native=原生元素逐个可编辑+全部版式规则保护；svg=整页 SVG 自由绘制（viewBox 0 0 1280 720），视觉自由度最高，PPTX 端整页矢量图嵌入（PowerPoint 2016+，可"转换为形状"），版式确定性规则不适用。共享全部流水线（蓝图/页数/设计锁定/指纹闸门/修改循环/预览）；PageScene 双形态（elements/svg 二选一，schema refine 强制）；新增规则 SVG_VIEWSIZE / SVG_UNSAFE（脚本/外链/foreignObject 全禁——内网红线）/ PAGE_SCENE_INVALID（损坏兜底），校验 37→40 条；TOKEN_COLOR 对 svg 页按 6 位 hex 尽力识别；时长估算与证据扫描覆盖 SVG 文字；find_replace content 作用域跳过 SVG 页并点名；HTML 预览原生内联（预览即真实渲染）。不采纳（含理由见取舍表）：ppt-master 的 SVG→PPTX 逐元素转换工具链（Python 栈+与确定性校验互斥，用整页矢量图嵌入替代） |

当前：**19 个工具、12 套主题（6 类分类）、17 种页型、10 种信息结构、40 条校验规则、168 项单测**。
回归入口：`npm run build && npm test && npm run demo`（demo 端到端走完阶段 0–8，含设计预设、即时预览、修改循环演示）。
