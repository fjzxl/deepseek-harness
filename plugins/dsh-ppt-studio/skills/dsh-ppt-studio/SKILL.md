---
name: dsh-ppt-studio
description: 制作结构化演示文稿（PPT）的完整工作室：简报（听众/场景/目标/时长/生成模式 quick-standard-precise）→ 叙事架构（核心主张+问题链）→ 页数与分配（时长档位推荐）→ 页面蓝图（每页意图/信息结构/叙事衔接/证据条目）→ 锁定设计（配色/字体/锚点令牌 + Prototype 代表页）→ 逐页生成（native 元素版式或 svg 自由绘制，renderRoute 用户可选）→ 全册集成校验（含叙事链自审与时长估算）→ HTML 所见即所得预览 + 可编辑 PPTX；修改循环按依赖关系局部重校验。当用户要求"做 PPT / 写演示文稿 / 生成幻灯片 / 改某一页"时使用。
---

# dsh-ppt-studio：PPT 制作 SOP

把一次 PPT 制作拆成 0–8 九个阶段。**standard / precise 模式下每个用户确认点都必须停下来等用户答复，不得连跑；quick 模式只做一次打包确认（见下）**。
**确认的发起方式是硬规则：凡 [用户确认]/[用户确认/修改]/[用户选定] 点，必须调 `ask_user_question` 工具**——把可选项写成 `options`（label + 一句 description，推荐项放第一个并在 label 标注「推荐」），相关问题一次合并提问（一次调用最多 4 个 question），拿到用户点选结果再调下一阶段工具。**禁止用纯文本罗列 A/B/C/D 选项让用户打字回复**（用户要点选，不是要抄写选项字母）；只有纯开放性问题（无候选可选，如"这场分享的具体场合？"）才用文本提问。

核心思想：**先锁定故事，再锁定页预算，再锁定每页意图，再锁定设计系统，最后才生成视觉；修改沿依赖关系局部处理，不推倒重来。**

```
0. Brief（听众/场景/目标/时长 + 选定风格 + 生成模式）→ [用户确认]
1. Deck Architecture（核心主张 + 各部分问题链）→ [用户确认/修改]
2. Page Budget（内容页数 + 各部分分配）→ [用户确认]
3. Content Blueprint（先做第一部分样例 → [用户确认样例质量] → 批量其余部分；每页 purpose/keyMessage/structure/density/visual/transition/evidence）→ [用户确认整体蓝图]
4. Design System（propose 2-3 套预设 → [用户选定] → spec + tokens 锁定 + Prototype 代表页；或 copyFromDeckId 复用既有 deck 设计）
   4.5 [precise] Prototype：先写 3 个代表页 → ppt_preview_update → [用户确认真实视觉效果] → 再批量写其余页
5. Section Production（按部分一气写完，每部分后刷新即时预览，用户可边看边提修改）
6. Deck Integration（全册集成校验：版式单调/多样性/视觉节奏/叙事链/标题结论感 + storyline 自审 + 时长估算）
7. Render + QA（渲染 PPTX + 预览）
8. Revision Loop（依赖感知修改循环）
```

## 生成模式（开工前先问用户要哪种）

`ppt_brief_create` 的确认闸门由 **`confirmStages`（唯一开关）**决定——`mode` 只是它的预设捷径（brief 落盘时自动展开），**未问过用户时默认 standard**：

| 前置确认点 | quick | standard（默认） | precise |
|---|---|---|---|
| G1 内容方向打包（简报+大纲+页数+设计方向一条消息） | ✔ 仅此一次 | — | — |
| 简报 / 大纲 / 页数分配 / 设计方案逐项确认 | 自动采纳建议值 | ✔ | ✔ |
| Prototype 3 页真实效果确认 | ✖ | 可选 | ✔ |
| 交付后修改循环 | ✔ | ✔ | ✔ |

- **quick**：适合草稿、内部快速产出。模型自动选主题（ppt_themes 推荐）/采纳页数档位/选场景驱动或方案 A，只在一条打包消息里让用户确认内容方向，然后一口气生成完统一交付、统一收集修改。**打包确认的语义边界**：它是对话层的方向授权，不是状态闸门——生成偏离已确认方向不靠它兜底，靠阶段 6 全量校验 + storyline 自审 + sceneHash 闸门。
- **standard**：现行完整流程，逐阶段确认。
- **precise**：在 standard 上加 Prototype 真实效果关——锁定设计后先写 `spec.prototypePages` 的代表页请用户看**真实渲染效果**再批量（避免"18 页写完才发现不喜欢这个风格"）。叙事衔接的严格度不随模式：要"缺承接语升 warning"请设 `strictness: strict`（0.9.1 起 mode 只决定确认点）；证据等级也建议用户选（business/academic）。
- 另有 `evidenceLevel`（none/business/academic）：business=数字论断需来源；academic=fact/data 论断全部需来源。**内网红线：来源只能来自用户提供的材料，无法核实的数据改定性表述或标「数据待补充」，禁止编造引用**。
- **参考材料清单**（`referenceMaterials: [{id, title}]`，0.8.1）：证据等级≥business 时建议让用户提供材料清单——提供后蓝图 evidence 优先用 `materialId`（id 精确引用）+ `locator`（出处定位，如"第 12 页，表 2"），或 source 引用条目标题；引用不上升级为 error 拒绝保存（"来源=用户材料"从口号变成可执行约束）。
- **自定义确认点**（`confirmStages`，0.8.1）：用户只想确认某几个阶段时（如只要 outline+design），传数组覆盖三档默认闸门；未列出的阶段采纳建议值直接推进。0.9.1 起工具行为全部读展开后的确认点——quick+显式 `confirmStages:['prototype']` 也会出代表页。
- **重确认只列差异**（0.9.1 话术纪律）：用户改过某项后重新确认时，只展示变更项与影响（"页数 12→14，s2 多 2 页"），不要每次全文重发——确认疲劳会让用户跳读。



**渲染路线（0.10.0，阶段 0 与模式一起问，说明取舍后让用户选）**：`renderRoute`

- **native（默认）**：pptxgenjs 原生元素——文本/形状/图表/表格逐元素可编辑，全部确定性版式规则保护（越界/互压/文字容量/密度）。适合：汇报、教学、需要后续人工编辑的正式交付。
- **svg**：自由 SVG 绘制（每页一段 `<svg viewBox="0 0 1280 720">` 源码）——任意路径/渐变/构图，视觉自由度最高；HTML 预览原生内联（预览即真实渲染）；**PPTX 端是整页矢量图**（PowerPoint 2016+ 显示，可右键"转换为形状"恢复部分可编辑性），且版式确定性规则不适用（只有安全面/色板/画布校验）——写完每页必须 ppt_preview_update 肉眼把关。适合：海报感强、视觉驱动、追求造型自由的 deck。
- 选择话术要点：可编辑性与版式保护（native）vs 视觉自由度（svg）；路线是 deck 级选择，中途不改。
**恢复中断的制作**：所有产物都落盘在工作区，会话中断后随时可续——用户回来说"继续上次的 PPT"时，先 `ppt_deck_status`（不传 deckId 列出全部 deck 与阶段进度），找到 deckId 后从当前阶段继续即可（各工具会校验前置产物并提示缺什么）。跨会话/跨机器恢复需保证同一工作区根目录（`PPT_STUDIO_OUTPUT_DIR`）。

## 阶段 0：Brief——先确定 PPT 的"任务"

1. 理解主题、用途、已知材料；信息不足先问，不要猜。
2. **主动询问五要素**：听众是谁、什么场景、**演讲目标（objective：听众听完应该获得/相信/做到什么）**、预计时长、风格。不要替用户默认。
   - 同一主题不同目标是完全不同的 PPT：「让中学生理解 AI」≠「让 CTO 理解技术路线」≠「让投资人理解产业机会」。
   - 时长影响密度：10 分钟路演与 60 分钟课堂即使页数相同，密度也应不同。
3. 风格推荐：判断主题类型（tech 科技 / business 商业 / education 教育 / gov 政务 / culture 文化 / event 活动）后带 `topicType` 调 `ppt_themes`——同类主题排前并标 ⭐推荐；用户也可浏览全部 12 套或提出定制色板。
4. **问生成模式**（用户没主动说时）：要"快速出稿少确认"（quick）、"逐阶段确认"（standard，默认）还是"精细控制+样例页确认"（precise）；商务/学术类 deck 顺带问证据等级（evidenceLevel）。
5. **问渲染路线**（用户没主动说时，说明取舍）：native 原生可编辑（默认）还是 svg 自由绘制（视觉自由、PPTX 端整页矢量图、版式校验不适用）——按上文"渲染路线"话术选择。
6. 五要素确认后调 `ppt_brief_create`（含 renderRoute）（title/topic/audience/scenario/objective/durationMin?/themeId/tone?/density?/mode?/evidenceLevel?）。
7. **按模式确认**：quick 不逐项等确认（后续把简报+大纲+页数+设计方向打包成一条消息做唯一前置确认）；standard/precise 把返回的简报原样展示给用户确认。确认后进入阶段 1。

## 阶段 1：Deck Architecture——这套 PPT 讲一个什么故事

1. `ppt_outline_draft`：不要只列名词目录，要构建叙事链条——
   - `coreMessage`：全 deck 核心主张（一句话）。
   - 每部分 = 标题 + **关键问题（question，叙事钩子）** + **核心信息（message，一句话答案）** + 建议页数。
   - 例："为中学生介绍大模型"：AI 从哪里来？→ 机器为什么能学习？→ 为什么今天大模型突然出现？→ AI 为什么会看会听？→ 下一步去哪里？（历史→原理→突破→扩展→未来）
2. **展示叙事链给用户确认/修改**；用户改后重新调用覆盖。确认后进入阶段 2。

## 阶段 2：Page Budget——页数与分配

1. 询问用户需要多少页**内容页**（给建议值；封面/目录/结尾 3 页自动附加，不算在内，最终总页数会明示）。
   - **页数口径**：用户口述"要 N 页"默认理解为**最终总页数**——内容页数 = N − 3，确认时明示"内容页 X + 结构页 3 = 总 Y"；用户明确说"内容页"时才直接采用。
   - **页数档位推荐**：简报带时长时工具返回 suggestedCounts（紧凑/推荐/舒展三档，按时长 ÷1.7 分钟/页推导，附分钟/页）——给用户选档位比问"你要几页"更省认知；quick 模式直接采纳推荐档。
2. 调 `ppt_pageplan_confirm`（deckId/contentPages/allocation?）：
   - 未带 allocation 时工具按各部分 suggestedPages 加权返回**建议分配**；展示给用户调整，用户确认后带 allocation 重新调用（Σ必须等于 contentPages 且覆盖全部部分）。
   - allocation 每项可带 **reason（分配理由）**，如"历史概览，4 个关键节点"——用户看到理由更容易接受或调整。
   - 分配确认后各部分页数将被硬校验精确匹配；`ppt_section_draft` 报"部分 sN 需要 X 页（当前传入 Y 页）"时，**按报错为该部分传足 X 个 page 对象**，或先重调本工具把分配改为 Y 页——**不得原样重发**（确定性拒绝，重发必然再败，详见文末「排查」第 2 条）。**后续要改总页数/分配**：直接重调 `ppt_pageplan_confirm` 覆盖（其他部分蓝图不动，页 ID 重排自动迁移已写页），改故事结构才走 revise。

## 阶段 3：Content Blueprint——先定义"这页为什么存在"，再定义"这页放什么"

1. **样例质量关卡**：先出样例再批量——展示给用户确认页型选择、信息密度、文案深度，这是全册的校准基准（重做一部分比重做一整册便宜）。
   - 信息结构差异大时按**结构类 × 页型双维度**抽样（0.8.1）：叙事类（timeline/process/cause-effect/problem-solution）、对比类（comparison/before-after）、数据类（data-insight）、概念类（concept-example/hierarchy）——每类挑第一个出现的部分先出样例；同类内页型差异大时（如 timeline 与 process 都是叙事类）再按页型补样例。
   - 向用户说明："样例代表该结构类的讲解节奏与文案深度，视觉版式在批量生成时按各页页型自动适配，不是所有同类页都长一样。"
2. 逐部分调 `ppt_section_draft`，每页蓝图包含：
   - `type` 页型 + `title` 标题 + `contentBrief` 内容概要
   - `purpose` 这页存在的理由（一页回答一个具体问题）
   - `keyMessage` 一句话核心信息（写页时的内容锚点）
   - `structure` 信息结构：timeline / comparison / process / hierarchy / cause-effect / problem-solution / before-after / concept-example / data-insight / plain（决定选哪种页型，错配会被校验器提醒）
   - `density` 页级密度意图（low/medium/high）；`visual` 配图计划（image/chart/none）
   - **视觉优先（0.12.0）**：概念/机制/关系/数据类内容优先选**图示型页型**——process（流程）、timeline（演进）、comparison（对比）、hierarchy（层次）、image-text（图文）、chart（数据）、big-number（数字冲击）——比 bullets 纯文字页更有助理解；纯 bullets/icon-list 页控制在全册约 1/3 以内（全册校验的 TYPE_DIVERSITY/VISUAL_RHYTHM 会盯，但蓝图阶段就该选对）。
   - **SVG 矢量插图（0.13.0，无生图接口时的配图路径）**：image-text 页直接给 `image.svg` 画矢量示意——模型自己就是"生图接口"。纪律：**简洁示意风格**（几何形状/图标/流程块/少量短标注，向整页 svg 路线看齐），`viewBox` 比例接近 5.6:4.6（如 `0 0 560 460`），颜色用锁定色板 hex，文字用 `<text>`，**禁止** script/事件属性/foreignObject/外部引用/位图风格渐变堆砌；引擎自动清洗并按 viewBox 比例适配图区（HTML 内联渲染、PPTX 矢量嵌入，PowerPoint 2016+ 显示）。一册里 svg 插图风格要统一（同一套形语言），不要页页异画风。
   - `transition` 叙事衔接（strictness=strict 时缺失升 warning，其余可选、链部分建立时缺口提示 info）：`fromPrevious` 承接上一页（回答上一页留下的钩子）+ `nextHook` 给下一页埋的钩子——PPT 是连续叙事，避免"页页都不错、连起来跳跃"
   - `evidence` 证据条目（evidenceLevel≥business 时被校验）：`[{claim 论断原文, type fact/data/example/quote, source 来源, materialId? 材料id, locator? 出处定位}]`；来源只能来自用户材料——有材料清单时优先 materialId 精确引用 + locator（如"第 12 页，表 2"），引用支持性（材料是否真支撑论断）自审把关
   - `densityOverride` 页级预算豁免（0.8.2，少用）：`{reason}` 允许单页突破全册密度/要点预算（如总结页需罗列全部要点）——校验降为 info 知情放行，不是静默绕过
   - 例（AI 发展历程 4 页）：总览 timeline｜符号主义 concept-example｜专家系统 concept-example｜深度学习 before-after。
3. `sectionId:"s0"` 专门放结构页：封面/目录/结尾**必须在同一次调用一次交齐**（缺页直接拒绝——本工具是整段覆盖语义，分次提交会互相覆盖、缺口永远补不齐，`ppt_design_lock` 必然报"缺少结构页"）。重复调用同一部分会整段覆盖旧蓝图，要保留的旧页必须一并放进本次 `pages`。页 ID 由工具按全册顺序自动编号。
   - **逐页蓝图模式（0.10.3 自动降级）**：同一部分连续 3 次因页数与确认分配不一致被拒绝后，该部分自动降级为逐页累积模式——接受分次提交（每次 1 页也可），追加而非覆盖，s0 按 type 去重累积；**只改提交粒度，不改计划语义**：累积总量仍必须精确等于确认分配，超出剩余槽位照样拒绝（报错会写明剩余几个槽位）。累积满额自动解除、恢复整段覆盖语义；重调 `ppt_pageplan_confirm` 或架构 revise 也会解除。**回执出现 🔔 降级通知时，必须把降级说明原样转述给用户再继续**（用户有权知道生成方式变了；总页数与质量校验不变）。
4. 全部部分完成后，**以"叙事试读"格式展示整体蓝图请用户确认**：每部分先列 问题→答案，再逐页 标题 + 核心信息 + 承接语——让用户以纯叙事视角最后通读一遍（此刻发现故事不对，改的只是文字；投入视觉生产后发现，改的是整个 deck）；用户改某部分就重调该部分。

## 阶段 4：Design System——设计规范确认 + 两份计划文件锁定

1. `ppt_design_propose`：生成 2-4 套设计规范预设——方案 A 简报原定；方案 B 同主题密度变体（按时长给理由）；方案 C 气质相邻主题；**方案 D（命中时）场景驱动**：按听众/场景/目标/时长确定性匹配（青少年教育→奶油手账稀疏版、短时路演→靛蓝渐变、政务对上汇报→政务红、工程安全→工业灰橙紧凑）。**展示给用户选定**。
2. 用户选定后调 `ppt_design_lock`（带选定方案的 themeId/density，缺省回落简报原定）：
   - `design/spec.json` 完整设计规范（各部分页数分配、密度策略：有图页/无图页文字预算、要点上限、**prototypePages 代表页**）
   - `design/tokens.json` 全 deck 锁定令牌（8 色板/chartColors/字体/字号阶梯/标题锚点/栅格）
   - **Prototype 代表页**（确认点非空时生成，0.9.1 风险加权）：用户在蓝图阶段标记"最关心这几页"时，`ppt_design_lock` 带 `prototypePageIds`（≤3 个内容页 id）用这份清单；未指定则按结构聚类去重、**簇内挑风险分最高的页**（图表 > 配图 > 信息密集 > 高密度——用最少的页暴露最多的真实渲染风险）写入 spec.prototypePages；确认点含 prototype 时是强制关卡（先写代表页请用户确认再批量），其余可选建议，打包模式（无确认点）不生成。
   - **模板复用**：周报系列/系列课程等同一场景复用品牌时，可跳过预设直接带 `copyFromDeckId` 指向同工作区已锁定的源 deck（如上周的汇报），令牌原样克隆、密度策略沿用源（与 themeId/density 互斥）。
3. 此后写页只能用令牌内的颜色与字体（TOKEN_COLOR / TOKEN_FONT 强制）。
4. **precise 模式的 Prototype 关卡**：先只写 spec.prototypePages 那 2-3 页 → `ppt_preview_update` 展示**真实渲染效果**（不是 token 说明，用户直接看最终长相）→ 用户认可再批量写其余页；不认可则重调 ppt_design_propose/lock 换方案（令牌变 → sceneHash 失效 → 已写页重写，成本只有 3 页）。standard 可选跳过。

## 阶段 5：Section Production——逐页生成（边生成边看）

逐页 `ppt_page_write`（**按部分顺序一气写完，不逐部分停下来等确认**）。写页有两条路，**优先内容模式**：
- **content 内容模式（0.11.0，推荐写法）**：`scene.content` 只传语义内容（标题/条目/图表数据/表格行……），版式引擎按页型模板自动展开元素清单——坐标、字号阶梯、锁定令牌色、标题条、卡片衬底全部自动套用，不会触发越界/互压/溢出类拒绝。`type` 缺省取蓝图页型、`title` 缺省取蓝图标题。各页型字段：bullets/icon-list → `items[]`；two-col/comparison → `columns:[{title,items[]}]`（两项）；process → `steps:[{name,desc}]`；timeline → `events:[{label,desc}]`；cards → `cards:[{title,desc}]`（2-4 张）；hierarchy → `layers[]`；big-number → `bigNumber:{value,unit,desc,source}`；chart → `chart:{chartType,labels[],series:[{name,values[]}],conclusion}`；table → `table:{header[],rows[][],note}`；quote → `quote:{text,source}`；image-text → `image:{svg:"<svg…>…</svg>"（0.13.0 推荐）或 assetId|prompt, heading, items[]}`；toc → `entries[]`；cover/closing → `subtitle`；`notes` 演讲者备注。示例：`{"scene":{"content":{"title":"三波浪潮","items":["符号主义","连接主义","大模型"]}}}`。文字过多时引擎自动缩字号并在回执 `[版式引擎]` 说明——仍建议精简。
- **手写元素模式**（精细控制版式时）：`scene.elements` 逐元素给坐标（先读 `reference/layouts.md`），要求见下。
- **ppt_page_skeleton 骨架**（0.11.0 写页辅助）：`ppt_page_skeleton {deckId,pageId}` 按蓝图一键生成**通过全部校验的占位页**（版式引擎 + 蓝图概要切分），立即落盘可预览；随后用 `append:true` 同 id 原位替换把占位文字换成正式内容。适合：先看页面框架再填内容、写页反复失败后的重建。
- **写页语义（重要）**：`ppt_page_write` 默认**整页替换**——scene.elements 必须是这一页的**完整**元素清单（含标题、装饰、全部节点）。遗漏既有元素会被**拒绝保存**（报错列出丢失元素）。**增量修改优先合并语义**：`append:true` + `remove:["元素id"]`——未提及元素保留、同 id 原位替换、新 id 追加、remove 中的显式删除（不触发丢元素闸门）；整页确要删元素时也可用 `allowDrop:true`。content 内容模式是按蓝图的有意整页重写，不受丢元素闸门限制。
- **svg 路线写页（0.10.0，renderRoute=svg 的 deck）**：scene 给 `svg`（整页源码）而非 elements——整页替换语义、无 append/remove。纪律：viewBox 固定 "0 0 1280 720"；颜色只用锁定色板 hex；文字用 `<text>/<tspan>`（能被时长估算与论断扫描识别，勿转路径轮廓）；**禁止任何外部引用与脚本**（校验 SVG_UNSAFE 强制；图片以 data URI 内嵌或改走原生 image）；**每写一页 ppt_preview_update 肉眼把关**——版式确定性规则不适用，预览就是这条路线的 QA 主通道。
- **公式排版（重要）**：数学公式的上标/下标必须用 runs 的 `superscript` / `subscript`——`QK^T` 写成 `"QK"` + `{"text":"T","superscript":true}`，`d_k` 写成 `"d"` + `{"text":"k","subscript":true}`。**禁止**用 Unicode `ᵀ`（中文字体普遍缺字形，渲染成方框）和字面 `^`/`_` 记法（显示成代码不像数学）。`²`（U+00B2）等常见上标数字可用。公式行用居中 text 元素 + 大一号字。
- **图表/表格数据**：`chart.labels` 与 `table.rows` 一律写字符串（数字刻度写 `"32"`，不要写数字）。
- **即时预览与进度**：每完成一个部分调一次 `ppt_preview_update`，把已写页面刷新到浏览器预览（**默认每阶段各弹第一次**：即时预览首开一次、正式渲染完成再开一次；`PPT_STUDIO_PREVIEW_AUTO_OPEN=0` 完全关闭、`=always` 恢复每次打开）——播放器顶部有**进度条**（已生成 N/M 页 + 各部分进度），用户可以边看边提修改（局部修改走改页流程，不影响其余部分继续生成）。
- **暂停/恢复**：用户喊停时调 `ppt_deck_pause {paused:true}`（写页将被拒绝）；用户说继续后 `{paused:false}` 恢复。
- **配图先于写页**：蓝图 visual:image 的页面，先按 contentBrief 写图片描述调 `ppt_image_generate` 拿 assetId 再写页（已配置生图时），避免"先占位后补图"的割裂；未配置生图再走 placeholder。
- **生图提示词纪律（0.9.2）**：prompt 写一段连贯散文，不是标签堆砌——① 风格家族（**同一 deck 全部配图保持同一种**：矢量扁平/素描手账/等距 3D/水彩/照片感，设计锁定后定一次）② 主体用具体视觉名词（"由书堆成的塔"，不是"知识"）③ 构图（主体特写/场景环境/留白呼吸）④ 色彩行为与**锁定色板协调**并写明占比（主体色约 30%、点缀只给焦点、≥60% 呼吸留白；生图工具返回值带 deckPalette 色板摘要）⑤ 结尾注明"画面中不出现任何文字"——图内文字改一个词就要整图重生成，页面文字一次按键可改。
- 画布 13.333×7.5 英寸，元素统一 `id + x,y,w,h + z`，坐标英寸、精度 0.01。
- **内容对齐蓝图**：页面的实际内容要落实 purpose/keyMessage；structure 决定页型（校验器查 STRUCTURE_TYPE_MISMATCH）。
- **信息密度**：有图/图表页文字精炼（DENSITY_WITH_VISUAL 按 spec 预算 × **页级密度系数**提醒：蓝图 density low=×0.7 收紧 / high=×1.3 放宽，0.8.1 起页级 density 真正参与校验）；无图页可放宽；字号阶梯与要点上限仍按全册（视觉一致性与认知上限不随页级放宽）。
- 标题/色板/字号用 tokens 锁定值；visual:image 的页要有 image 元素，visual:chart 要有 chart 元素。
- 有 error 时工具拒绝保存，按问题清单修正后重写；warning 要向用户说明。
- 装饰衬底（整页色块、卡片底）给形状加 `background:true` 豁免越界/重叠校验。
- 图表用原生 chart 元素；图片优先 `ppt_image_generate`（未配置会返回降级建议）或 `ppt_asset_register`，实在没有用 `placeholder` 占位框。

## 阶段 6+7：Deck Integration 与渲染

1. `ppt_scene_check`：全册校验 + 跨页集成检查——
   - 单页规则：越界/重叠/文字容量/图片登记/图表数据/令牌/密度/结构匹配/证据来源（EVIDENCE_SOURCE_MISSING）/要点预算（BULLET_BUDGET_EXCEEDED）。
   - 跨页规则：LAYOUT_MONOTONY（连续 3 页同页型）、TYPE_DIVERSITY（>10 页只用 <3 种页型）、VISUAL_RHYTHM（连续 4 页无图/图表）、NARRATIVE_CHAIN_MISSING（叙事链缺口；precise=warning）、TITLE_TAKEAWAY（标题与章节同名/过短，只给话题不给结论）。
   - **依赖感知**：返回 revalidated（本次变更页，重点细看）与 unchangedCount（未变页沿用结论）。
   - **storyline 叙事链自审**：返回逐页 标题/keyMessage/承接语 摘要——逐页问"这页是否回答上一页留下的问题？有无突然跳跃？"发现断裂就地补 transition 或改写承接。
   - **时长估算**：duration.estimatedMin（页面文字 + 演讲者备注 ÷220 字/分钟 + 每页 0.3 分钟，再乘页型系数——备注是照着讲的底稿也计入）vs 简报时长，偏差 >±35% 给 DECK_DURATION_MISMATCH（info）——讲不完就精简文字/把展开内容移进备注，或与用户重对页数。
2. `ppt_deck_render`：生成 deck.pptx（可编辑）+ 预览 HTML + report.json（只认锁定令牌；渲染后自动打开浏览器预览（**默认每阶段各弹第一次**：即时预览首开一次、正式渲染完成再开一次，各自跨调用/重启不重复；`PPT_STUDIO_PREVIEW_AUTO_OPEN=0` 完全关闭、`=always` 恢复每次打开）。
3. **把预览 URL 和 PPTX 路径都给用户**；预览服务未启动时提示运行 `node lib/preview-server.js`（多根托管：自动合并启动目录与全局工作区注册表，任何会话工作目录生成的 deck 都能预览，无需与生成方同目录）。**交付话术附 QA 边界**：已验证场景数据、文件结构与全部校验规则；办公软件实际渲染效果（字体回退/换行/图表标签细节）请用户以预览与打开 PPTX 肉眼复核为准。

## 阶段 8：Revision Loop——依赖感知的修改循环

先按影响范围表判断改动层级，再决定动作：

| 用户反馈 | 影响层级 | 动作 |
|---|---|---|
| 改一个字 / 换一张图 / 调一页版式 | Slide | 重写该页 → `ppt_scene_check`（会标出变更页）→ `ppt_deck_render` |
| 修改一页的内容逻辑 | Slide | 重写该页（对照蓝图 purpose/keyMessage）→ 同上 |
| 增删一页 | Section + Deck | （需增减页数先重调 `ppt_pageplan_confirm`）重调该部分 `ppt_section_draft` → 页 ID 自动重排**且其余已写页文件/指纹自动迁移**（蓝图变化页会被清除需重写，返回值 migration 有明细）→ 补写 → check + render |
| 增删章节 / 改章节页数 | Section + Deck | 页数层面：pageplan_confirm 重确认 + 重草拟受影响部分；故事层面：用户确认后 `ppt_outline_draft` 带 `revise:true` **原地修订**（清除蓝图/已写页/页数计划，保留简报与设计令牌，重走 2–5），或新 deck |
| 换字体 / 换整体配色 | Deck | 重新 `ppt_design_lock`（令牌变化 → sceneHash 失效 → 全册必须重新 check）→ render |
| 改听众 / 改演讲目标 | 重新规划 | 目标变了故事就变了：建议新 deck 重走 0–3 |

- sceneHash 闸门是设计行为：改过内容必须重新 `ppt_scene_check` 才能渲染。
- **批量改词**（如"把所有'人工智能'改成'AI'"）：调 `ppt_deck_find_replace`——先 dryRun:true 预览影响面给用户确认（命中按 正文文本/表格单元格 分组展示），去掉 dryRun 执行，再增量 check（revalidated=受影响页）+ render。支持 scope（content/titles/notes/all）、正则与 skipTables（跳过表格单元格，防误伤指标名等结构化数据）。svg 路线页不参与 content 替换（返回值会点名 skippedSvgPages——需要改这些页请重写整页 SVG；titles/notes 作用域不受影响）。
- **试错分支**：用户想试另一个叙事方向/页数方案时调 `ppt_deck_branch` 快照当前进度开分支（源 deck 不受影响，不满意回源 deckId 继续）。
- 想快速过目可先 `ppt_preview_update`（只刷预览不出 PPTX），确认无误再 check + render。
- 渲染是全量的（PPTX 单文件、毫秒级），"局部"体现在校验与排查：只细看 revalidated 列出的变更页。
- 排查历史用 `ppt_log_query`（按 stage/pageId/level 过滤）。
- **过期标记**：`ppt_deck_status` 会直接提示"内容已变更需重新 check / 已校验未渲染"——渲染前按提示补 `ppt_scene_check` / `ppt_deck_render`。
- **校验强度**：品牌一致性/学术场景可在简报带 `strictness:"strict"`（锁外颜色/字体、证据缺来源直接 error 拒绝）；草稿快速产出用 `"relaxed"`（认知负荷类降为 info 不刷屏）。

## 排查（工具报错时按此顺序，不要盲试）

1. **先看报错全文**：本插件的拒绝都带定位信息（元素原文/重叠尺寸/修复提示），照提示改即可，不要原样重试。
2. **参数校验类错误必须改参，不得原样重发**：页数不一致（"部分 s1 需要 2 页，当前传入 1 页"）、分配总和不符、缺必填字段这类报错是**确定性拒绝**——参数不变，重发一万次也是同一个错，只会空烧 token 直至熔断。正确动作：
   - 按报错文本改参再重试——错误会直接写明**需要几个 page 对象、当前给了几个、差几页**（如"请为 s1 提供 2 个 page 对象后重试"）；
   - 连续同类失败时不要提交等效内容，改前置条件（页数、分配、必填字段），或回退到上一个用户确认点重新对齐（如重调 `ppt_pageplan_confirm` 改分配/总页数，或重调 `ppt_outline_draft`）；
   - 若无法确定该传什么，停下来向用户说明卡点并请求确认，不要用重试试探。
   - **连败兜底（0.10.3）**：`ppt_section_draft` 连续 3 次被拒后会自动降级为逐页累积模式（回执带 🔔 通知与进度"已收 X/N 页"）——此时按回执逐页提交即可，集满自动恢复；**🔔 降级说明必须原样转述给用户**。
   - **写页连败兜底（0.11.0 弱模型辅助）**：`ppt_page_write` 连续失败 3 次后自动开启**弱模型辅助模式**（deck 级持久）——裸 elements 整页替换被拒绝，只能：① 改用 `scene.content` 内容模式（版式引擎自动排版，不再手写坐标）；② `ppt_page_skeleton` 生成骨架页后 `append:true` 小步替换文字（append 增量不受限）。**🔔 开启通知必须原样转述给用户**；用户明确要求恢复手写元素模式时带 `overrideAssist:true`。
3. **原因不明或疑似环境问题**（渲染失败、模块报错、链路整体异常）：调 `ppt_doctor`——
   它汇报 pptxgenjs 解析路径与互操作形态、输出目录可写性、预览端口、失败快照数量。
4. **查调用痕迹**：`ppt_log_query {source:"plugin"}` 看插件级调用日志（每次调用的形态标注、
   耗时、错误堆栈）；失败调用的完整入参已自动存到 `ppt-studio/logs/failed/*.json`，可直接引用。
5. **查单 deck 历史**：`ppt_log_query {deckId, stage, level}` 看该 deck 的生成日志
   （渲染条目含"渲染环境诊断"，记录模块解析路径与互操作形态）。
6. `ppt_page_write` 被拒后**修正后重写**；连续 2 次同因失败就换写法（参照下方错误写法表），不要第 3 次原样重试——同一工具连续失败 ≥2 次时报错会自动附带 doctor/log_query 排查指引。

## 质量红线

- 每页有明确的读者任务：没有"总结页套话"，每页回答一个具体问题（对照蓝图 purpose）。
- **标题即结论（takeaway）**：标题应是这页的结论（如「X 让 Y 提升了 3 倍」），不是话题名词、更不是章节名的复述（TITLE_TAKEAWAY 会拦）。
- **数据必须真实且注明来源**：evidenceLevel≥business 时数字论断要有 evidence 来源（EVIDENCE_SOURCE_MISSING 会拦）；没有的数据宁可不放，不得编造；无法核实改定性表述或标「数据待补充」。内网环境禁止联网取数。
- 版面禁止：文字贴边（安全边距 0.15in）、两个文本框互压、图片拉伸变形、一页超过 6 个要点（BULLET_BUDGET_EXCEEDED 按 spec 密度预算强制）。
- 颜色/字体禁止越出锁定令牌（design/tokens.json）。
- 内网环境：禁止引用任何外链资源（图片/字体/CDN）。图片全部走资产登记或占位框。

## ppt_page_write 常见错误写法（务必对照；用 content 内容模式可整表绕开——版式引擎产出的元素天然合规）

| ❌ 错误写法 | ✅ 正确写法 |
|---|---|
| `{"kind":"text","text":"标题",...}` 扁平 text 字段 | 文字必须放 `paragraphs` 数组：`{"kind":"text","paragraphs":[{"text":"标题"}],...}` |
| `"paragraphs": {"text":"…"}` 单对象 | `"paragraphs": [{"text":"…"}]` 数组 |
| `"runs":[{"text":2024}]` 数字 | `"runs":[{"text":"2024"}]` 字符串 |
| 颜色写成 `color: #1E4B8F`（未加引号） | `"color": "#1E4B8F"` 必须带引号，`#RRGGBB` 六位 |
| 元素缺 `kind` / `id` / `x,y,w,h` 任一 | 五类元素统一要求 `kind+id+x,y,w,h`，缺一拒绝 |
| 想补几个元素却只传新增部分（其余被整页替换丢掉） | 默认整页替换且**丢元素会被拒绝保存**：要么传完整元素清单，要么带 `"append":true` 只追加/替换改动元素，要么确认删除带 `"allowDrop":true` |
| 公式写成 `QK^T`、`d_k` 字面记法或 Unicode `ᵀ` | 用 runs：`"QK"+{"text":"T","superscript":true}`、`"d"+{"text":"k","subscript":true}`（ᵀ 中文字体缺字形） |
| chart.labels / table.rows 写数字（`labels:[32,64]`） | 写字符串：`labels:["32","64"]`（数字会被自动转，但别依赖） |
| 用主题外的自造颜色/字体 | 只用 `design/tokens.json` 锁定的色板与字体 |

- 工具会自动修复：扁平 text 展开、对象包数组、数字文本转字符串、`"color=#xxx"` 损坏键拆分、`{"item":[…]}`/`{"$text":X}` XML 风格包装还原；修复项会在返回的 `repairs` 里列出——**看到 auto-fix 说明写法不规范，下一页请改正**。
- 报错会附"出错元素原文"，照着改那一处即可，不要整体重写其他元素。
- **熔断保护（0.10.1 起拦截 / 0.11.2 起按入参结构分型）**：同一工具**同结构**入参连续失败 5 次后会被拦截不执行（报错变为 🚫 熔断指引）——此时原样重试已无意义：先 `ppt_doctor` 体检、`ppt_log_query {"source":"plugin"}` 看失败入参与堆栈，按失败提示真正改变前置条件再重试。**换调用方式（结构不同，如 content 模式 ↔ elements+append）不会被熔断拦截**，可放心换路；熔断期间每 5 次同构调用放行一次试探，修好后自动恢复。

## 按需参考文档

- `reference/layouts.md` —— 17 种页型的区块划分、坐标速查、字号体系（写页前必读）
- `reference/themes.md` —— 12 套主题色板与渐变（选色/配色时读）
- `reference/copywriting.md` —— 文案纪律（写文字前读）
- `reference/validation-rules.md` —— 校验规则分级原则（每条规则为什么是 error/warning/info；用户问"为什么这条是警告"时引用）
