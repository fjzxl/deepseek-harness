# dsh-ppt-studio

DSH（DeepSeek Harness）PPT 工作室插件：**简报（听众/场景/目标/时长/生成模式）→ 叙事架构（核心主张+问题链）→ 页数与分配（时长档位推荐）→ 页面蓝图（样例关卡 → 批量；叙事衔接/证据条目）→ 设计预设确认 → 锁定设计（配色/字体/锚点令牌 + Prototype 代表页）→ 逐页生成（确定性校验 + 即时预览）→ 全册集成校验（依赖感知增量 + 叙事链自审 + 时长估算）→ HTML 所见即所得预览 + 可编辑 PPTX**。

- 同一份场景 JSON 同时渲染两份产物：`deck.pptx`（pptxgenjs，原生可编辑文本/形状/表格/图表）与自包含 HTML 预览播放器（无外链，内网可用）
- **双渲染路线**（0.10.0）：`brief.renderRoute` = **native**（默认，pptxgenjs 原生元素逐个可编辑 + 全部版式规则保护）/ **svg**（自由 SVG 绘制，viewBox 0 0 1280 720——HTML 预览原生内联、PPTX 端整页矢量图嵌入 PowerPoint 2016+，版式校验不适用、写页后预览肉眼把关）；两条路线共享蓝图/设计锁定/指纹闸门/修改循环全部流水线
- **生成模式三档**（0.7.0）：`brief.mode` = **quick**（1 个打包确认，其余采纳建议值，快速出稿）/ **standard**（默认，逐阶段确认）/ **precise**（+Prototype 3 页真实效果确认 + 叙事链/证据严检）；配套 `evidenceLevel` 证据等级（none/business/academic）
- 19 个独立工具 + SKILL.md SOP（阶段 0–8），standard/precise 模式强制「简报确认 → 叙事架构确认 → 页数分配确认 → 样例质量确认 → 整体蓝图确认 → 设计预设选定并锁定 → 一气写完（边生成边预览）」的交互节奏（quick 打包确认一次）；用户确认的是内容页数（封面/目录/结尾 3 页自动附加）
  完整流程逻辑见 **[docs/generation-flow.md](docs/generation-flow.md)**（权威文档：各阶段输入输出/确认关卡/校验规则全集/状态机/修改传播）
- **Prototype 真实效果确认**（0.7.0）：锁定设计时按结构聚类自动挑 ≤3 个代表页（spec.prototypePages）；precise 模式先写这 3 页刷新预览让用户看**最终长相**再批量——避免"18 页写完才发现不喜欢这个风格"，试错成本只有 3 页
- **叙事链与证据层**（0.7.0）：蓝图页页可带 `transition`（承接上一页/埋钩子下一页）与 `evidence`（claim/type/source）；`ppt_scene_check` 返回 storyline 叙事链摘要 + 疑似断裂页清单（storylineGaps）供逐页自审，business/academic 级数字论断缺来源会被 EVIDENCE_SOURCE_MISSING 拦下
- **参考材料清单（0.8.1）**：`brief.referenceMaterials: [{id,title}]` 提供后 evidence.source 必须引用清单条目（id/标题），违规升级 error——"内网来源=用户材料"可执行；高频校验问题附 `fixable`+`suggestedFix` 修复建议；页级密度系数（low ×0.7 / high ×1.3）真正参与文字预算校验；find_replace 支持 skipTables 防误伤表格；失败快照 FIFO 保留 100 份
- **弹性与规范（0.8.2）**：`densityOverride` 页级预算豁免（reason 知情降 info）；`prototypePageIds` 用户指定 Prototype 代表页；find_replace 执行后自动复查受影响页；注册表登记时清理失效工作区；`reference/validation-rules.md` 每条规则的分级依据 + layouts.md 页型→结构反向索引
- **设计规范确认**：锁定前 `ppt_design_propose` 给出 2-4 套预设（原定 / 密度变体 / 气质相邻 / **场景驱动**：按听众/场景/时长确定性匹配），用户选定后生效
- **设计模板复用**：`ppt_design_lock` 带 `copyFromDeckId` 克隆设计令牌（本地优先，经工作区注册表**跨工作区**可用——品牌设计库在别的目录也行）
- **智能推荐**：12 套主题带 6 类分类标签，`ppt_themes(topicType)` 按主题类型（科技/商业/教育/政务/文化/活动）排前标推荐；**页数档位推荐**（时长驱动 紧凑/推荐/舒展三档，附分钟/页）
- **样例质量关卡**：先做第一部分蓝图给用户校准，确认后批量生成其余部分
- **即时预览与进度**：`ppt_preview_update` 毫秒级刷新已写页面的 HTML 预览（**默认每阶段各弹一次**：即时预览首开 + 渲染完成再开，生成期间不反复弹窗），播放器顶部**进度条**显示 N/M 与各部分进度；用户喊停 `ppt_deck_pause` 暂停/恢复生成
- **批量修改与试错分支**：`ppt_deck_find_replace` 全册查找替换（dryRun/scope/正则）；`ppt_deck_branch` 快照当前进度开分支，试另一叙事方向互不影响
- **预览多根托管**：deck 按会话工作目录生成，预览服务自动合并启动目录与全局工作区注册表——任何会话的 deck 都能预览
- **写页语义显式化**：ppt_page_write 默认整页替换，**遗漏既有元素直接拒绝保存**（报错列出丢失元素；`allowDrop:true` 确认删除、`append:true` 增量修改——0.7.1 起从警告升级，堵住两起真实数据丢失事故）
- **修改循环状态一致性（0.8.0）**：页 ID 重排自动迁移已写页文件/校验指纹（增删页不再错位）；架构修订 `revise:true` 原地改故事（无需重建 deck）；`append`+`remove` 合并语义；`contentOutdated`/`renderOutdated` 过期标记（status 直接提示）；`strictness` 校验强度三态（strict 越锁即错 / relaxed 不刷屏）
- **公式排版**（0.7.1）：run 级 `superscript`/`subscript`，PPTX 原生基线偏移 + HTML `<sup>`/`<sub>` 双端一致；禁止 Unicode ᵀ 与字面 ^/_ 记法
- **中断恢复**：全产物落盘 + 状态机，`ppt_deck_status` 找断点随时续作（跨会话需同一工作区根目录）
- **Deck Architecture 层**：大纲升级为叙事架构——全 deck 核心主张 + 每部分的关键问题/核心信息，形成叙事链而不是名词目录
- **Page Blueprint 层**：每页先定义 purpose/keyMessage（为什么存在、讲什么核心信息），再定义 structure（timeline/comparison/process/…十种信息结构，驱动页型选择并校验匹配）
- **页数分配表**：各部分页数分配由用户确认（Σ硬校验精确匹配），未确认时按建议页数加权自动给出建议
- 全 deck 锁定的设计令牌（`design/tokens.json`：色板/字体/字号阶梯/标题锚点/栅格）：写页校验 TOKEN_COLOR/TOKEN_FONT 强制不越锁，渲染只认令牌
- 信息密度量化：有主视觉（图/图表）页收紧文字预算（DENSITY_WITH_VISUAL），无图页放宽；要点条数受 BULLET_BUDGET_EXCEEDED 强制（认知负荷）；配图计划（visual）未落实会被提醒
- **Deck Integration 跨页检查**：LAYOUT_MONOTONY（连续 3 页同页型）、TYPE_DIVERSITY（>10 页 <3 种页型）、VISUAL_RHYTHM（连续 4 页无图/图表）、NARRATIVE_CHAIN_MISSING（叙事链缺口）、TITLE_TAKEAWAY（标题即结论）、DECK_DURATION_MISMATCH（时长估算偏差）
- **依赖感知修改循环**：`ppt_scene_check` 按页级指纹比对，只把变更页列入 revalidated（未变页沿用结论）；SKILL.md 提供改动影响范围表（Slide/Section/Deck 三级）
- 12 套内置主题、17 种页型（含时间轴/对比/大数字/流程/多卡片/层级/图标要点）
- 确定性校验器保障文字与图的位置：越界 / 文本互压 / 文字容量估算 / 图片登记 / 图表数据
- 全程 JSONL 结构化日志 + report.json，`ppt_log_query` 可按阶段/页号/级别过滤排查
- 生图接口预留（OpenAI 兼容协议，环境变量配置即启用；未配置自动降级为形状/占位框）
- 本仓库不依赖任何 `@deepseek-ai/*` 包即可运行与测试（纯 Node），cordis 入口薄封装供 DSH 宿主加载

## 快速开始（本地 Node，无需 DSH 宿主）

```bash
npm install
npm run build        # tsc → lib/
npm test             # vitest 168 个单测
npm run demo         # 端到端：走完阶段 0–8 生成 11 页示例 deck（含设计预设确认、即时预览、修改循环演示）
npm run preview      # 启动预览服务 http://127.0.0.1:3170/
```

demo 结束会打印 deckId、PPTX 路径与预览链接；浏览器打开预览链接即可放映（←/→ 翻页、F 全屏、G 缩略图、N 备注）。

任意工具可经 CLI 单独调用（模拟模型行为，便于调试）：

```bash
node lib/cli.js                                    # 列出全部工具
node lib/cli.js ppt_themes '{}'
node lib/cli.js ppt_deck_status '{}'
node lib/cli.js ppt_log_query '{"deckId":"<id>","tail":20}'
```

## 工具清单（src/tools/）

| 工具 | 阶段 | 职责 |
|---|---|---|
| `ppt_brief_create` | 0 | 简报（标题/主题/听众/场景/**目标 objective**/时长/主题风格/**mode 生成模式**/**evidenceLevel 证据等级**）落盘并创建 deck，附页数档位建议，按模式给出确认指引 |
| `ppt_themes` | 对话 | 列出 12 套内置主题供用户在第 0 步选定 |
| `ppt_outline_draft` | 1 | **Deck Architecture 叙事架构**：核心主张 + 各部分（标题/关键问题/核心信息/建议页数），用户确认/修改后重调覆盖；`revise:true` 架构修订（清除下游原地改故事） |
| `ppt_pageplan_confirm` | 2 | 确认内容页数与**各部分页数分配**（封面/目录/结尾 3 页自动附加；未带分配时返回建议分配 + **页数档位建议**） |
| `ppt_section_draft` | 3 | 单部分 **Page Blueprint**：每页 页型/标题/概要/purpose/keyMessage/structure/density/visual/**transition 叙事衔接**/**evidence 证据条目**；s0 专放结构页；Σ内容页=确认值、有分配时精确匹配 |
| `ppt_design_propose` | 4A | 生成 2-3 套设计预设（原定/密度变体/气质相邻主题），展示给用户选定 |
| `ppt_design_lock` | 4B | 按选定方案（可选 themeId/density/paletteOverrides）产出并锁定两份计划文件：`design/spec.json`（含 **prototypePages 代表页**）+ `design/tokens.json` |
| `ppt_page_write` | 5 | 写/改单页场景（默认整页替换、丢元素拒绝保存；`append:true`+`remove:[id]` 合并语义、`allowDrop:true` 确认删除）；error 级问题拒绝落盘；TOKEN/密度/结构匹配/配图计划/证据来源/要点预算校验（按 strictness 分级）；run 级上下标支持公式排版 |
| `ppt_preview_update` | 5/8 | 即时预览：毫秒级刷新已写页面的 HTML 预览（不出 PPTX、免 sceneHash），每阶段首开各只自动弹一次浏览器，边生成边看；确认点含 prototype 的 Prototype 关卡也走它 |
| `ppt_scene_check` | 6 | 全册校验 + 跨页集成检查（版式单调/多样性/视觉节奏/叙事链/标题结论感）+ sceneHash 指纹；**依赖感知**：返回变更页清单 revalidated + **storyline 叙事链摘要** + **duration 时长估算** |
| `ppt_deck_render` | 7 | 渲染 PPTX + 预览 HTML + report.json（只认锁定令牌） |
| `ppt_asset_register` | 横切 | 登记本地图片（格式/尺寸/sha256 校验，冻结进 deck） |
| `ppt_image_generate` | 横切 | 内网生图接口（未配置返回降级建议不报错） |
| `ppt_deck_find_replace` | 横切 | 批量查找替换（dryRun 预览影响面 / scope 范围 / 正则），改完增量 check |
| `ppt_deck_branch` | 横切 | 试错分支：快照当前进度复制新 deck（state 记 parentDeckId），源不受影响 |
| `ppt_deck_pause` | 横切 | 暂停/恢复生成（暂停时写页被拒，查看不受影响） |
| `ppt_log_query` / `ppt_deck_status` / `ppt_doctor` | 横切 | 日志查询 / 进度查看（7 阶段状态机）/ 环境体检 |

修改循环（阶段 8）按影响范围分级：改字/换图/调版式 = Slide（重写该页 → check 标出变更页 → render）；增删页 = Section+Deck（重调蓝图，页 ID 自动重排）；换字体/配色 = Deck（重新 design_lock，令牌变 → 全册重校验）；改听众/目标 = 重新规划。SKILL.md 内有完整影响范围表。

## 源码结构

```
src/
├── index.ts          cordis 入口（inject tools+skills；宿主内加载）
├── skill.ts          SKILL.md 注册进 DSH 技能注册表
├── cli.ts            本地 CLI：node lib/cli.js <tool> '<json>'
├── demo.ts           端到端演示（阶段 0–8，含程序生成 PNG 测试图与修改循环）
├── preview-server.ts 预览静态服务（node:http，零依赖）
├── config.ts         行配置 + 环境变量解析
├── schema.ts         场景数据模型（zod：brief/plan/outline/section/tokens/spec/page/element）
├── themes.ts         12 套主题（色板/渐变/图表色/字体）+ buildDesignTokens
├── validate.ts       确定性校验器（越界/重叠/文字容量/资产/图表/令牌/密度/配图计划）
├── deck-store.ts     deck 工作区与状态机（原子写、sceneHash）
├── logger.ts         JSONL 日志 + report.json
├── assets.ts         图片登记（尺寸解析/sha256/冻结）
├── image-provider.ts 生图接口适配（OpenAI 兼容，默认关闭）
├── render-pptx.ts    场景 → pptxgenjs → deck.pptx（含 ZIP 结构自检）
├── render-html.ts    场景 → 自包含 HTML 播放器（含 SVG 图表渲染）
└── tools/            13 个工具，按文件分组（brief/outline/plan/design/page/check/render/image/log）
skills/dsh-ppt-studio/
├── SKILL.md          SOP 提示词（a–g 七步流程与质量红线）
└── reference/        layouts.md 17 种页型坐标速查 / themes.md 12 套色板 / copywriting.md 文案纪律
```

## deck 工作区布局

```
<ppt-studio>/<deckId>/
├── brief.json        0 简报（听众/场景/目标/时长/选定主题/mode/evidenceLevel）
├── outline.json      1 叙事架构（核心主张+问题链）→ 3 合成页级蓝图（页 ID 规范化重编号；含 transition/evidence）
├── plan.json         2 页数计划（内容页 + 分配 + 3 结构页）
├── design/
│   ├── spec.json     4 完整设计规范（页数分配/密度策略/设计纪律/prototypePages 代表页）
│   └── tokens.json   4 全 deck 锁定令牌（色板/字体/字号阶梯/标题锚点/栅格）
├── sections/         3 各部分蓝图快照（含 s0 结构页）
├── pages/p00N.json   5 单页场景
├── assets/images/    冻结图片 + manifest.json（sha256/来源/尺寸）
├── deck.pptx         最终产物（可编辑）
├── preview/index.html 自包含预览播放器
├── report.json       渲染与校验报告
└── logs/generation.log  JSONL 全流程日志
```

## 配置

行配置（cordis.patch.yml）与环境变量二选一，环境变量优先级低于行配置：

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `PPT_STUDIO_OUTPUT_DIR` | `<会话cwd>/ppt-studio` | deck 工作区根目录 |
| `PPT_STUDIO_PREVIEW_PORT` | `3170` | 预览服务端口 |
| `PPT_STUDIO_PREVIEW_BASE_URL` | `http://127.0.0.1:<port>` | 生成预览链接的前缀 |
| `PPT_STUDIO_PREVIEW_AUTO_OPEN` | `once` | 预览自动打开浏览器：`once`=每阶段各弹第一次（默认：即时预览首开一次、正式渲染完成再开一次）；`always`=每次渲染/预览都弹（旧行为）；`0`/`false`/`off`/`no`=完全不弹。行配置 `previewAutoOpen: once/always/true/false` 等价（优先级更高） |
| `PPT_STUDIO_IMAGE_API_BASE/_KEY/_MODEL` | 未设置 | 内网生图接口（OpenAI 兼容 `/images/generations`）；三项齐备才启用 |

## 接入 DSH 宿主（源码运行，已验证路径）

插件本体已具备 DSH bundle 声明（`package.json` 的 `dsh.bundle.patch` + `cordis.patch.yml` 的 insert 条目），按以下步骤接入：

1. **准备 pnpm**（`dsh plugin` 命令内部转发给 pnpm，必须有）：

   ```bash
   npm i -g pnpm        # 或 corepack enable
   ```

2. **编译并运行 harness**（deepseek-harness 检出目录内）：

   ```bash
   pnpm install
   pnpm run build
   pnpm dsh web         # 使用构建产物启动 Web UI（127.0.0.1:3080）
   ```

3. **安装本插件到 web profile**（任意目录执行，路径用绝对路径）：

   ```bash
   pnpm dsh plugin --profile web add D:\proj\zcode\dshProj\dsh-ppt-studio
   ```

   该命令会在 `%USERPROFILE%\.dsh\profiles\web\`（`DSH_HOME` 可改）内执行 `pnpm add <路径>` 并把 `dsh-ppt-studio` 自动追加进 `dsh.profile.bundles` 层列表。普通目录路径 = pnpm link 语义（junction 链接），改插件代码后 `npm run build` 再重启 `pnpm dsh web` 即生效；用 `file:<绝对路径>` 则是拷贝安装，需重新 add 才更新。

4. **验证加载**：
   - 打开 `%USERPROFILE%\.dsh\profiles\web\package.json`，`dsh.profile.bundles` 应含 `"dsh-ppt-studio"`
   - `pnpm dsh web` 启动日志出现 `dsh-ppt-studio` 层；会话里模型可见 19 个 `ppt_*` 工具与 dsh-ppt-studio 技能

5. **预览服务**（deck 产物静态托管）：

   ```bash
   node D:\proj\zcode\dshProj\dsh-ppt-studio\lib\preview-server.js
   ```

   ⚠️ 保持 deck 目录一致：`dsh web` 与预览服务是两个进程，务必给**两者**设置同一个绝对路径环境变量 `PPT_STUDIO_OUTPUT_DIR`（例如 `D:\ppt-decks`），否则预览服务找不到会话生成的 deck。对外部署时再把 `PPT_STUDIO_PREVIEW_BASE_URL` 设为外部可达地址。

6. **可选配置**：行配置写进 profile 的用户补丁层 `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`：

   ```yaml
   - id: dsh-ppt-studio
     config:
       outputDir: D:\ppt-decks
       previewPort: 3170
   ```

7. **内网 LLM**：harness 侧配置（`DEEPSEEK_BASE_URL`/`DEEPSEEK_API_KEY` 环境变量或 settings.yaml 指向内网网关），与本插件无关。

8. **更新 / 移除**：

   ```bash
   pnpm dsh plugin --profile web update dsh-ppt-studio    # 更新（拷贝安装时）
   pnpm dsh plugin --profile web remove dsh-ppt-studio    # 移除（自动从 bundles 摘除）
   ```

## 部署（内网 / 单一入口）

当前按用户要求先完成本地 Node 测试，Docker 化后续补充。要点备忘：

- 容器内跑 `dsh web`（127.0.0.1:3080）+ 本插件 + `node lib/preview-server.js`（3170）
- 外层 nginx 做 TLS 终结并反代：`https://<host>:31688/ → 3080`，`/ppt-studio/ → 3170`（同一前缀即可）
- 全部依赖构建期打入镜像，运行期零外联；预览 HTML 自包含无外链

## 已知取舍

- 渐变背景/渐变填充在 PPTX 端回退为 from 纯色（渲染备注会记录，report.json 可查）；HTML 预览为真渐变
- 预览中的图表为 SVG 矢量重绘（与 PPTX 原生图表风格一致、数据相同，像素不逐像素相同）
- pptxgenjs 对页面尺寸有 ±几十 EMU 的取整（13.3333in ≈ 12192000 EMU，PowerPoint 打开显示一致）

## 修复记录

### 0.10.0（2026-09-13）：SVG 渲染路线（用户可选的第二条生成路线）

1. **`brief.renderRoute`：native（默认）/ svg，阶段 0 说明取舍后由用户选择**。native = pptxgenjs 原生元素，逐元素可编辑，全部版式规则保护；svg = 自由 SVG 绘制（整页源码，viewBox 固定 0 0 1280 720），任意路径/渐变/构图，视觉自由度最高——HTML 预览原生内联（预览即真实渲染），PPTX 端**整页矢量图嵌入**（PowerPoint 2016+ 显示，可右键"转换为形状"恢复部分可编辑性），版式确定性规则不适用（写完每页 ppt_preview_update 肉眼把关）。两条路线共享全部流水线：蓝图/页数/设计锁定/指纹闸门/修改循环/预览。
2. **PageScene 双形态**：elements（native）与 svg（svg 路线）二选一，schema refine 强制；page_write 按路线分派（svg 整页替换语义、无 append；路线是 deck 级选择，中途不可混用）。
3. **SVG 校验（+3 规则，37→40 条）**：SVG_VIEWSIZE（画布 1280×720 强制）、SVG_UNSAFE（脚本/on* 事件/foreignObject/外链全禁——内网红线：SVG 必须自包含，图片 data URI 内嵌）、PAGE_SCENE_INVALID（读盘损坏兜底）；TOKEN_COLOR 对 svg 页按 6 位 hex 尽力识别（strict 升 error 同名复用）；时长估算提取 `<text>/<tspan>` 文字、证据扫描覆盖 SVG 文字（与 native 同一规则）；find_replace 的 content 作用域跳过 SVG 页并点名（titles/notes 不受影响）。
4. **实现方式**：不移植 ppt-master 的 SVG→PPTX 逐元素转换工具链（Python 脚本栈，DSH 宿主不保证 Python，且与确定性校验体系互斥）——用 pptxgenjs 原生 SVG 图片嵌入（整页矢量图，PowerPoint 2016+）实现零依赖闭环；取舍已在路线选择时向用户明示。两条实现路径的完整逐维度优缺点对比（可编辑性/保真/部署/成本/错误模式等 10 维）已写入 generation-flow.md 第一节「渲染路线实现方式对比」，作为后续改造抉择依据。

### 0.9.2（2026-09-13）：图表与配图纪律（借鉴 ppt-master：感知可读性 / 生图提示词工程）

1. **+2 图表可读性规则（校验 35→37 条）**：CHART_CATEGORY_CROWD——饼/环图类别 >6 时扇区过窄标注不下、占比难比较，warning 建议改条形图按值排序或合并长尾「其他」；CHART_LEGEND_REDUNDANT——非饼/环的单系列图开着图例只重复系列名，info 建议 showLegend:false 并在标题点名（饼/环除外：其图例承载类别名）。均附 fixable/suggestedFix。
2. **生图与锁定令牌协调**：ppt_image_generate 在设计锁定后返回 deckPalette（bg/primary/accent）摘要并在输出中提醒——"同 deck 全部配图共用色彩锚"（此前生图完全绕过锁定色板，每张图各说各话）；协调靠返回提醒 + SOP 纪律达成，不静默改写用户 prompt。
3. **散文提示词纪律**：prompt 参数描述重写为五要素——风格家族（同一 deck 统一一种）+ 主体具体视觉名词 + 构图 + 色彩行为写明占比 + 图内不写字（图内文字改一个词 = 整图重生成，页面文字一次按键可改）；SKILL 阶段 5 与 copywriting.md 同步增补图表/表格数据呈现纪律（零基线、单色深浅优于彩虹、直接标签优于图例、同域可比、列宽按语义权重不默认等宽）。
4. **不采纳（含理由，见取舍表）**：多画布格式（4:3/小红书/故事——定位差异+全链路坐标改造）、PPTX 动画与 TTS 旁白（pptxgenjs 栈不支持/内网不保证 TTS）、外部 PPTX 模板导入（copyFromDeckId 已覆盖品牌复用，OOXML 翻译器体量且有损）、构图目录编号体系（17 页型+layouts.md 已承担版式约束）。

### 0.9.1（2026-09-13）：对称性补全（架构评审：版本化确认 / 稳定身份 / 事务 / 真实渲染验收 逐条评估）

1. **mode 解耦完成**：`resolvedConfirmStages` 统一展开确认点——design_lock 的 Prototype 生成、NARRATIVE_CHAIN_MISSING 分级、brief 返回指引全部读展开值，代码零 mode 行为分支；quick + 显式 `confirmStages:['prototype']` 组合不再被预设吞掉。叙事链分级改由 strictness 驱动（precise 用户要 warning 请设 strictness=strict）。
2. **prototypePages 迁移对齐（引用缺口修复）**：页 ID 重排时 spec.prototypePages 随之重映射（蓝图消失的页移除）——此前重排后代表页清单会指错页/悬空；顺带修复"删页后其余页位移被目标占用预检误拦"的真 bug（新测试暴露）。
3. **sceneHash 版本盐**：指纹含插件版本——升级后存量 deck 渲染前强制重新 check，校验规则/渲染器演进对旧 deck 也生效，不沿用升级前结论。
4. **渲染复检与 check 同路**：render 内嵌最后一道校验补传 strictness/evidenceLevel/referenceMaterials/parts（此前闸门强度不对称）；返回文案明示渲染 QA 能力边界（已验证场景与文件结构，办公软件实际渲染以预览与肉眼复核为准）。
5. **时长估算计入演讲者备注**（备注是照着讲的底稿，此前只算页面文字会低估）；**Prototype 风险加权**（簇内挑图表/信息密集页，用最少页暴露最多渲染风险）；**evidence materialId/locator 精确引用**（id 精确匹配优先于标题子串，出处可追溯）；方案 B 密度-时长方向修正（时间极紧建议稀疏而非紧凑）。
6. **文档口径修正**：增量校验澄清为"全量校验、增量标注"（无缓存，规则演进即时生效）；"必填"措辞对齐实际级别（warning=软约束）；改页数两条路径明确（重跑 pageplan_confirm / revise）；quick 打包确认=方向授权非状态闸门；用户口述页数默认最终总页数；一致性审计再修 6 处残留口径（设计理念增量措辞、状态机"render 双清"→只清 renderOutdated、证据升级缺 materialId、时长公式缺备注/页型系数、双闸门缺版本盐、传播机制"每 deck 首开"→每阶段首开）。不采纳（含理由，见 generation-flow.md 取舍表）：稳定页 ID 重构、跨文件事务/revision、确认哈希对象、PPTX 渲染成图 QA、claimId 正文关联、暂停全工具拦截。

### 0.9.0（2026-09-13）：减法与收敛（架构评审：组合爆炸 / 叙事试读 / 依赖传播对称性）

1. **mode 收敛为 confirmStages 预设**：确认闸门的唯一开关是 `confirmStages` 数组，brief 落盘时按 mode 展开（quick=[]、standard=五阶段、precise=+prototype），显式传入优先——组合维度从 mode×confirmStages×… 降为"确认点数组 + evidenceLevel/strictness 两个正交旋钮"。
2. **叙事试读**：阶段 3 蓝图确认改为"问题→答案 + 每页标题/核心信息/承接语"的纯叙事视角通读——故事错误在投入视觉生产前拦截（比重写视觉便宜一个量级）；section_draft 返回展示同步带承接语。
3. **outlineChanged 信号（依赖传播对称性修复）**：transition 是页间关系，页级指纹覆盖不到（改承接语后 revalidated 为空、叙事链却断了）。state 新增 outlineHash，check 检测大纲变更即提示"重读全量 storyline，不要只看变更页"。
4. **连续失败主动提示**：同一工具连续失败 ≥2 次，报错自动附带"ppt_doctor 体检 + ppt_log_query 查失败入参 + 换写法"指引。
5. **收敛与澄清**：语速常量命名集中；状态标记按"属性/一次性标记/派生展示态"分类并立下"新标记先问是否可推导"纪律；validation-rules.md 增加三条元原则与"知情放行"统一对照表（densityOverride/allowDrop/remove/strictness/evidenceLevel 各管一个维度，共享"显式知情"协议）。
6. **不采纳（含理由，见取舍表）**：TOKEN_COLOR/FONT 默认升 error（渲染器对锁外色原样渲染，warning 语义自洽）、元素上限进 spec（过度配置）、状态标记归并 flags 对象（破坏存量兼容）、语速配置化（info 提示兜底）。

测试 150→153 项（mode 展开、outlineChanged 三态、连续失败提示）；0.9.1 增至 158 项（解耦/迁移对齐/materialId/备注时长/风险加权）；0.9.2 增至 161 项（图表可读性两规则、生图色板协调）；0.10.0 增至 168 项（SVG 路线：schema 双形态/安全面校验/写页分派/端到端渲染/替换跳过）。

### 0.8.4（2026-09-13）：预览错误页样式化——访问不存在的 deck 显示 404 页面

用户反馈"访问不存在应该显示 404 页面，而不是乱码页"。0.8.3 已修 charset，本次把全部错误路径从单行文本升级为**与列表页同风格的完整 404/403/405/500 页面**：状态码大字 + 具体原因（deck id、预览未生成的下一步指引、托管工作区清单）+ 返回列表链接；HTML 自带 `<meta charset="utf-8">`，任何浏览器任何编码环境下都不会再出现乱码。测试 149→150 项。

### 0.8.3（2026-09-13）：预览乱码修复——错误响应 charset + 预览 HTML 原子写

用户反馈"预览有时出现乱码、不是 PPT"。定位出三个叠加因素并全部修复：

1. **直接原因：错误响应缺 charset**。preview-server 的 404（deck 不存在 / 预览尚未生成）、403、405、500 全部不带 Content-Type——浏览器对无类型声明的中文文本按本地编码（GBK）猜测解码，显示为乱码。当 deck 已被删除/未渲染时用户看到的正是这些页面。现在全部响应（含错误路径）统一 `text/html; charset=utf-8`。
2. **撕裂读防护：preview/index.html 改原子写**（tmp + rename，与 PPTX/JSON 同款）。此前生成期间每次 preview_update 直接覆写 index.html，浏览器恰好在写入中途刷新就会读到半截 HTML——乱码/残页的另一个来源。
3. **注册表污染清理**：`~/.dsh/ppt-studio-workspaces.json` 里残留了调试产生的临时根与一条路径损坏条目（读取侧本就过滤、0.8.2 起登记时自动清理，本次手工清掉存量）。

测试 147→149 项（404 带 charset 的 HTTP 实测、原子写完整性与无 tmp 残留）。

### 0.8.2（2026-09-13）：13 点工程评审落地 7 项（弹性预算 / 用户指定代表页 / 替换自动复查 / 规范透明化）

1. **densityOverride 页级预算豁免**：蓝图页条目 `{reason}` 允许单页突破全册密度/要点预算（如总结页罗列全部要点）——DENSITY_WITH_VISUAL / BULLET_BUDGET_EXCEEDED 降为 info，理由随 issue 展示（知情放行而非静默绕过）。
2. **prototypePageIds 用户指定**：design_lock 可带 ≤3 个内容页 id——用户在蓝图阶段标记"最关心这几页"时 Prototype 用这份清单，不再只靠结构聚类自动挑；未知/非内容页 id 拒绝。
3. **find_replace 执行后自动复查**：替换立即对受影响页跑校验器并点名新问题（替换让文字变长触发溢出等），同时置 contentOutdated——不必等用户想起调 check。
4. **蓝图漂移指引**：STRUCTURE_TYPE_MISMATCH 的写页输出附"若定位已实质改变，先重调 ppt_section_draft 更新蓝图再写页"。
5. **注册表垃圾回收**：登记新工作区时顺手剔除已删除目录的残留条目（读取侧本就过滤，现在落盘文件也不膨胀）。
6. **reference/validation-rules.md**：每条规则一句话说明"为什么是这个级别"+ 三条级别浮动规则（strictness/材料清单）——分级不再基于不透明的经验。
7. **layouts.md 反向索引**：页型 → 适合的信息结构表，写页时反查。

已覆盖：quickInteractive（=0.8.1 confirmStages 组合）、迁移丢失检测（check 的 PAGE_MISSING error 已强制处理）。缓做（见取舍表）：失效页占位渲染、材料解析工具、doctor 历史对比、大 deck 校验缓存、多语言系数。测试 143→147 项。

### 0.8.1（2026-09-13）：12 点流程评审落地 10 项（材料清单 / 迁移硬化 / 弹性确认 / 密度落地）

采纳：参考材料清单、迁移原子性、confirmStages、prototype 双维度、预览每阶段首开、页级密度系数、fixable 修复建议、skipTables、storylineGaps、快照保留；缓做：预览 token 权限（单用户 localhost 无越权面）、页级指纹拆分（毫秒级校验收益小）。

1. **参考材料清单**：`ppt_brief_create` 新增 `referenceMaterials: [{id,title,note?}]`——提供后蓝图 evidence 的 source 必须引用清单条目（id/标题子串匹配），EVIDENCE_SOURCE_MISSING 从 warning 升级 error 拒绝保存；消息与 suggestedFix 直接点名可用材料。未提供清单维持宽容 warning。
2. **迁移硬化**：重排迁移预检两道闸——源文件缺失（手动删除）与目标被占用（手动创建）清晰报错拒绝；迁移先于大纲落盘（失败时磁盘不被半途修改）；`state.lastMigration` 记录明细与时间。
3. **confirmStages + quick 提示**：自定义确认点数组覆盖三档闸门；quick 模式返回文案提示"建议值不满意可重调覆盖"。
4. **prototype 双维度抽样**：结构类 × 页型两轮去重（同结构类的 timeline 与 process 都能入选）；阶段 3 样例关卡同口径并向用户说明"样例代表结构类，视觉按页型适配"。
5. **预览每阶段首开**：即时预览与正式渲染分开记 `previewOpenedAt`/`renderOpenedAt`——生成期弹一次、渲染完再弹一次，其余不弹。
6. **页级密度系数**：蓝图 density（low/medium/high）以 ×0.7/×1.0/×1.3 作用于有图页文字预算（此前页级 density 无任何消费方）；字号阶梯与要点上限仍按全册。
7. **fixable/suggestedFix**：文字溢出（附具体扩高/精简百分比）、越锁颜色/字体（附替换指引）、要点超限、证据缺源、有图页超密度等高频问题附确定性修复建议。
8. **find_replace skipTables + dryRun 分组**：跳过表格单元格防误伤结构化数据；dryRun 命中按 正文文本/表格单元格 分组展示。
9. **storylineGaps**：check 返回缺承接语的页清单，render 文案要求 precise 模式提交用户确认。
10. **失败快照保留**：全局 FIFO 保留最近 100 份，不再无限堆积。

测试 135→143 项（材料引用三级、密度系数三档、迁移预检两闸+lastMigration、prototype 双维度、skipTables、快照 FIFO、每阶段首开）。

### 0.8.0（2026-09-13）：修改循环与状态一致性（16 点流程评审落地 6 项）

采纳：页 ID 重排迁移 / 架构修订 / 合并语义 / strictness / 过期标记 / 时长页型系数 / 版本表排序笔误；其余（材料库、分支合并、配图异步、视觉回归、自定义确认点等）记录缓做，见 generation-flow.md 第十节。

1. **页 ID 重排迁移（正确性修复）**：此前进入写作后重草拟某部分，其余部分的已写页文件名/pageHashes 键/大纲会全部错位。现在 section_draft 重编号时自动两阶段改名迁移文件、重挂哈希与 pagesWritten；其他部分蓝图未动内容不变只换编号，重草拟部分蓝图变化的页被清除并在返回值 `migration.invalidated` 提示重写；sceneHash 随大纲变更失效。
2. **架构修订模式**：`ppt_outline_draft` 带 `revise:true` 允许在原 deck 改故事——清除蓝图/已写页/页数计划（保留简报与设计令牌），state 记 `architectureRevisedAt`，回退 outlined 重走 2–5；新增写页阶段闸门拦住"旧令牌还在盘上就跳过重新 lock"。改一句话不再需要重建工作区。
3. **写页合并语义**：`append:true` + `remove:["元素id"]`——未提及元素保留、同 id 原位替换、新 id 追加、显式删除不触发丢元素闸门；整页替换时 remove 名单同样视为确认删除。减少 allowDrop 滥用。
4. **strictness 校验强度**：brief 新增 `strictness`（relaxed/normal/strict）——strict 把 TOKEN_COLOR/TOKEN_FONT/EVIDENCE_SOURCE_MISSING 升 error（品牌/学术场景越锁即错），relaxed 把认知负荷类 8 条规则降 info（草稿不刷屏）；写页与全册校验统一分级。
5. **内容/渲染过期标记**：state 新增 `contentOutdated`/`renderOutdated`，随写页→check→render 流转；`ppt_deck_status` 直接提示"需重新校验 / 需重新渲染 / 架构已修订需重走 2–5"。
6. **时长估算页型系数**：数据页（chart/table）×1.3、结构页（封面/目录/章节/结尾）×0.5，估算更贴近真实讲述节奏。

### 0.7.2（2026-09-13）：预览自动打开改为每 deck 一次（用户反馈：生成期间不断弹窗）

用户反馈：生成 PPT 过程中每次 `ppt_preview_update`（每部分完成刷新一次）和 `ppt_deck_render` 都会自动打开一个 `http://127.0.0.1:3170/…` 的新浏览器窗口，一次生成弹七八个。修复：

1. **previewAutoOpen 三态**：`once`（新默认）= 每个 deck 只在第一次成功的渲染/预览时自动弹出，标记持久化在 `state.previewOpenedAt`（跨 preview_update / deck_render 调用、跨进程重启都不再重复弹）；`always` = 旧行为每次都弹；`false` = 完全不弹。环境变量 `PPT_STUDIO_PREVIEW_AUTO_OPEN` 支持 `once/always/0/false/off/no`，行配置 `previewAutoOpen` 兼容旧布尔（true=always）。
2. 打开失败不落标记（下次仍会尝试）；`ppt_deck_render` 内自动打开移到 state 保存之后，避免渲染落盘覆盖标记。
3. 测试 125→126 项（三态配置解析、once 持久化与二次不弹、always/false 行为、失败不落标）。

### 0.7.1（2026-09-13）：真实会话修复（Transformer deck，29 页）——数据丢失堵漏 / 公式排版 / 数字数据容错

来源：用户实际 DSH 会话（deck `D:\proj\dsh\ppt-studio\d20260913-122450-0b1a`，"制作 Transformer 的 PPT"）。会话 97 次工具调用中 25 次失败；最终交付 29 页但存在内容缺失与公式显示问题。

1. **PAGE_ELEMENTS_DROPPED 从 warning 升级为 error（数据丢失堵漏）**：模型修 DENSITY 警告时整页重写 p004 忘带 6 个手绘梯度衰减元素（事后只塞了占位框）、p005 丢了 cnn-illust 配图——两次"⚠️数据丢失"警告均被忽略继续走。现在整页替换遗漏既有元素**默认拒绝保存**，报错列出丢失元素与三条出路（补齐 / `allowDrop:true` 确认删除 / `append:true` 增量修改）；显式确认后放行并保留 warning。这是继 0.5.1 p014 之后的第二起同类事故，证明警告级不够。
2. **公式排版能力（run 级 superscript/subscript）**：此前模型只能用 Unicode `ᵀ`（中文字体缺字形→方框）和字面 `QK^T`/`d_k` 记法（显示成代码不像数学）拼公式。现在 runs 支持 `superscript`/`subscript`，PPTX 用原生基线偏移、HTML 用 `<sup>`/`<sub>` 双端一致；工具 schema 与 SKILL/copywriting 写明公式写法纪律。
3. **数字数据容错（8 次写页被拒的根因）**：模型把数字轴刻度写成 `chart.labels:[32,64,128]`、表格数字单元格写成 number——zod 只收 string，p004/p013/p016 共 8 次被拒后模型才手工加引号。现在 normalize 自动转字符串（`values` 保持数字）。
4. **section_draft 报错中文化 + contentBrief 300→500（7 次被拒的根因）**：contentBrief 超长与缺 pages 报的是英文 zod 数组，模型重试多次；现在中文摘要 + 修复提示 + 正确示例（与 brief/page 同款格式），概要上限放宽。
5. **用户 deck 数据修复**：p004 占位框换成原生折线图（梯度幅值 vs 传播距离：RNN BPTT 指数衰减 / LSTM 门控缓慢衰减）；p005 重绘卷积感受野示意（token 行 + k=3 窗口高亮）；p003-p027 公式记法全部 runs 化（QKᵀ/QK^T→sup T、d_k/d_model/W_O→sub、10000^(2i/d)→sup）；p026 代码卡的 `qk^T` 伪码改为真实 PyTorch 写法；p007/p009 的 `⋮`（字形不稳）换 `…`；s1 蓝图 p004/p005 的 visual 计划对齐实际（chart/none）。

### 0.7.0（2026-09-13）：生成模式三档 + Prototype + 叙事链 + 证据层（流程评审 P0/P1 全量落地）

按 12+ 点流程评审建议逐条评估后落地（未采纳项见 generation-flow.md 第十节取舍表）：

1. **生成模式三档（用户可选生成方式）**：`ppt_brief_create` 新增 `mode`（quick/standard/precise，默认 standard 保持老体验）——quick 只做 1 个前置确认（简报+大纲+页数+设计方向打包一条消息，其余采纳建议值）；standard 现行逐阶段确认；precise 加 Prototype 关卡与叙事/证据严检。brief 返回值按模式给出不同的后续指引；无新工具，纯 schema+SOP 驱动。
2. **Prototype 真实效果确认**：`ppt_design_lock`（mode≠quick）按结构聚类（叙事/对比/数据/概念，与阶段 3 抽样同口径）挑 ≤3 个代表页写入 `spec.prototypePages`。precise 流程：先写这 3 页 → `ppt_preview_update` 让用户看真实渲染效果 → 认可再批量；不认可换设计重锁（sceneHash 失效重写，试错成本 3 页）。
3. **叙事链 transition + storyline 自审**：蓝图页条目新增 `transition`（fromPrevious 承接上一页 / nextHook 埋钩子）；校验规则 NARRATIVE_CHAIN_MISSING（precise=warning，链已建立时其余档缺口提示 info，完全未建立静默防刷屏）；`ppt_scene_check` 返回 storyline 摘要（逐页 标题/keyMessage/承接语）供模型自审连贯性。
4. **Evidence 证据层（内网适配）**：brief 新增 `evidenceLevel`（none/business/academic）；蓝图页条目新增 `evidence`（claim/type/source）。EVIDENCE_SOURCE_MISSING：business 级页面数字论断（正则识别量级/比例，含图表数据）无带来源的证据条目即警告；academic 级 fact/data 条目全部需来源。**红线**：来源只能来自用户材料，无法核实改定性表述或标「数据待补充」，禁止联网取数与编造。
5. **P1 四项**：页数档位推荐（brief/pageplan 返回 suggestedCounts，时长 ÷1.7 分钟/页推导 紧凑/推荐/舒展三档）；TITLE_TAKEAWAY（标题与章节同名或过短且有 keyMessage → 建议结论式标题，章节隔页豁免）；BULLET_BUDGET_EXCEEDED（要点条数从 spec 文案建议升级为强制规则）；DECK_DURATION_MISMATCH（全册文字量估算讲述时长 vs 简报时长，偏差 >±35% 提示）。
6. **兼容性**：新字段全部可选——旧 deck 的 outline/brief 不重写则行为与哈希不变（zod 可选解析通过），无需迁移。
7. **明确不采纳（记录取舍）**：Feedback Queue（同步对话式 agent 无后台 worker，等价能力=find_replace+修改循环统一收集反馈）；Evidence 联网核实（内网红线）；语义级依赖图与语义级 Audience QA（确定性不可判，靠 storyline 摘要辅助模型自审）。

校验规则 30→35 条；测试 99→118 项全过（模式落盘与默认值、页数档位、Prototype 聚类挑选与 quick 跳过、transition/evidence 透传、证据/预算写页即时警告、storyline/时长/叙事链分级、标题规则正反例）。工具数不变（19 个）。

### 0.6.0（2026-09-13）：流程评审五项增强——场景预设 / 进度可视化 / 批量修改 / 分支 / 跨工作区复用

1. **场景驱动预设（方案 D）**：`ppt_design_propose` 在 A（原定）/B（密度变体）/C（气质相邻）之外，按简报关键词确定性命中第四套——青少年教育→奶油手账稀疏版、短时路演/发布→靛蓝渐变、政务对上→政务红、工程安全→工业灰橙紧凑。无命中不出现，与原定主题相同不重复。
2. **进度可视化 + 暂停**：即时预览播放器顶部新增进度条（已生成 N/M 页 + 各部分 n/m）；`ppt_preview_update` 返回进度文本；新工具 `ppt_deck_pause`（state.paused，暂停期间写页被拒，查看类不受影响）。
3. **批量修改**：新工具 `ppt_deck_find_replace`——全册查找替换（scope: content/titles/notes/all；正则可选；dryRun 先预览影响面与替换样例），执行后走增量校验。典型："把所有'人工智能'改成'AI'"不再逐页重写。
4. **试错分支**：新工具 `ppt_deck_branch`——快照复制当前进度（简报/架构/页数/蓝图/设计/已写页/资产，sceneHash 随内容复制仍有效），state 记 parentDeckId；试另一叙事方向，源 deck 不受影响。比 forkFrom 阶段分叉更通用（任意时点可分）。
5. **分配理由 + 跨工作区模板复用**：allocation 每项可带 reason 展示给用户；`copyFromDeckId` 本地找不到时经工作区注册表跨工作区解析（品牌设计库可在任意目录）。
6. **SOP 吸收（文档级）**：样例质量关卡按信息结构聚类抽样（叙事/对比/数据/概念四类，差异大时每类先出一个样例）；"配图先于写页"（visual:image 先生图拿 assetId 再写页，减少占位割裂）。
7. **明确缓做（记录取舍）**：元素级指纹（页级已毫秒级，非瓶颈不动）；LLM 语义连贯性检查（违背确定性校验哲学且慢，未来可作为可选 deepCheck）；预览差异高亮（revalidated 已指明变更页，完整 diff 视图后续按需做）。

回归：测试 90→99 项全过（方案 D 命中/不命中、find/replace 的 dryRun/执行/scope/正则、暂停拒绝与恢复、分支隔离性、跨工作区令牌相等、分配理由落盘、进度条注入播放器）。

### 0.5.1（2026-09-13）：真实会话四问题修复——预览多根 / 自动打开 / p014 数据丢失防护 / 诊断版本漂移

来源：用户实际 DSH 会话（deck `D:\proj\dsh\ppt-studio\d20260913-101405-f21f`，16 页）。

1. **预览目录不一致（多根托管）**：deck 按 DSH 会话工作目录生成，预览服务此前只托管自己进程 cwd 的目录——两者不一致即 404。现引入**全局工作区注册表**（`~/.dsh/ppt-studio-workspaces.json`，工具每次调用自动登记会话工作区），预览服务合并"启动目录 + 注册表全部根"多根托管，列表页标注各 deck 所属工作区；未知 deck 的 404 附正在托管的工作区清单。
2. **预览自动打开浏览器**：`ppt_deck_render` / `ppt_preview_update` 成功后默认自动唤起系统浏览器打开预览（跨平台 start/open/xdg-open）；配置 `previewAutoOpen` 或 `PPT_STUDIO_PREVIEW_AUTO_OPEN=0` 关闭，URL 始终同时以文字给出。
3. **p014 数据丢失事故的根因防护（page_write 写页语义显式化）**：模型把整页替换当成"追加"使用，分 5 次只传新增节点，前 4 个节点被静默丢弃，成片只剩最后一组元素。修复：①工具描述与 SKILL 显式声明"默认整页替换，elements 必须是完整清单"；②新增 `append: true` 追加模式（既有元素保留、同 id 原位替换、合并后整页校验）；③替换模式丢失既有元素时返回 **PAGE_ELEMENTS_DROPPED** 警告点名丢失元素并提示 append。另将用户 deck 的 p014 重写修复并重渲染（变更页仅 p014）。
4. **诊断修正**：PLUGIN_VERSION 常量停留在 0.1.5（渲染诊断/doctor 长期误报版本），修正为与 package.json 同步并新增漂移测试；损坏键自动修复支持带引号形态（真实会话出现的 `color="#hex": ""` 键，拆分后不再依赖模型重试）。

其他：测试 84→90 项（版本漂移/auto-open 配置/注册表去重过滤/预览多根 HTTP 实测/丢元素警告与 append 原位替换）；vitest 增加全局 setup（注册表指向临时文件、关闭自动打开，测试不再污染真实 ~/.dsh 或弹窗）；CLI 预览服务启动横幅显示托管的工作区数量与清单。

### 0.5.0（2026-09-13）：智能推荐 / 设计模板复用 / 中断恢复指引

三项流程评审结论的落地（①中断恢复已内建无需开发，只补文档；②③为新功能）：

1. **智能推荐**：12 套主题增加 `category` 分类标签（tech 科技 / business 商业 / education 教育 / gov 政务 / culture 文化 / event 活动）；`ppt_themes` 新增可选 `topicType` 参数——模型从简报的主题/听众/场景判断类型传入，同类主题排前并标 ⭐推荐（纯确定性映射，无模糊判断）。
2. **设计模板复用**：`ppt_design_lock` 新增可选 `copyFromDeckId`——从同工作区已锁定设计的源 deck（如上周的汇报）原样克隆令牌（色板/字体/字号阶梯/锚点/栅格），密度策略与设计纪律沿用源，spec 页数分配归属目标 deck 自己；与 themeId/density/paletteOverrides 互斥。覆盖周报系列、系列课程等复用品牌的场景。
3. **中断恢复**：机制早已内建（全产物落盘 + 状态机 + deck_status 找断点 + 各工具前置校验提示），本次把"用户回来说继续上次的 PPT → 先 ppt_deck_status 再按阶段继续"写入 SKILL.md 与流程文档，并注明跨会话恢复需同一工作区根目录。

回归：测试 78→84 项全过（六类分类齐全、topicType 推荐排序与展示标记、克隆令牌逐字段相等、spec 归属与密度沿用、互斥/未锁定源/自造源 deckId 三个拒绝路径）；demo 无回归（不带新参数走原路径）。

### 0.4.0（2026-09-12）：设计预设确认 / 样例质量关卡 / 即时预览

按流程评审吸收三项经验（其余与 0.3.0 已有能力重合）：

1. **设计规范确认阶段（新增 `ppt_design_propose`）**：锁定前生成 2-3 套设计预设——方案 A 简报原定；方案 B 同主题密度变体（按时长确定性给理由，如"40 分钟较充裕，稀疏版字更大更大气"）；方案 C 气质相邻主题（12 主题亲和表确定性推荐）。用户选定后 `ppt_design_lock` 新增可选 themeId/density/paletteOverrides 参数使选择生效（缺省回落简报原定）。
2. **样例质量关卡（SOP）**：阶段 3 先只为第一个部分生成蓝图，用户确认样例质量（页型/密度/文案深度）后再批量生成其余部分——重做一部分比重做一整册便宜。
3. **即时预览（新增 `ppt_preview_update`，第 15 个工具）**：用已写页面毫秒级刷新自包含 HTML 预览，不生成 PPTX、不要求 sceneHash 最新。逐部分生成时每完成一个部分刷新一次，用户可边看边提修改（局部修改走改页流程，不阻塞其余部分生成——保留"不逐部分暂停"的口径）；修改循环中也可先预览过目再正式校验渲染。
4. 不采纳（有意取舍）：逐部分"停下来等确认"会打断生成节奏且与既有口径冲突——即时预览已提供"边生成边调整"的观察窗口而无需阻塞。

工具数 14→16（新增 `ppt_design_propose` / `ppt_preview_update`）。回归：测试 77→78 项全过（propose 三方案断言、lock 预设覆盖生效、锁定后单页即可预览）；demo 阶段 4 改为 propose→选定→lock，第一部分（p003–p006）写完后演示即时预览。

### 0.3.0（2026-09-12）：叙事架构 / 页面蓝图 / 依赖感知修改循环

按架构评审吸收五项改进（另有二项明确不采纳，见末尾）：

1. **Brief 增加 objective / durationMin**：演讲目标（听众听完应获得/相信/做到什么）成为必填——同主题给中学生科普与给 CTO 讲技术路线是不同的 deck；时长与页数共同决定密度。
2. **大纲升级为 Deck Architecture（叙事架构）**：`ppt_outline_draft` 新增全 deck `coreMessage`（核心主张），每部分由 title + `question`（关键问题，叙事钩子）+ `message`（一句话答案）构成，形成「历史→原理→突破→扩展→未来」式叙事链，替代原 intent 一句话意图。
3. **页数升级为 Page Budget（页数+分配）**：`ppt_pageplan_confirm` 支持 `allocation`（各部分页数分配，Σ=contentPages 且覆盖全部部分，硬校验）；未提供时按 suggestedPages 加权返回建议分配供用户调整确认。分配确认后 `ppt_section_draft` 各部分页数精确匹配。
4. **草稿升级为 Page Blueprint（页面蓝图）**：每页新增 `purpose`（这页为什么存在）、`keyMessage`（一句话核心信息）、`structure`（十种信息结构：timeline/comparison/process/hierarchy/cause-effect/problem-solution/before-after/concept-example/data-insight/plain）、`density`（页级密度意图）。校验器新增 STRUCTURE_TYPE_MISMATCH：信息结构与页型错配报 warning。
5. **Deck Integration 跨页集成检查 + 依赖感知修改循环**：全册校验新增 LAYOUT_MONOTONY（连续 3 页同页型）/ TYPE_DIVERSITY（>10 页 <3 种页型）/ VISUAL_RHYTHM（连续 4 页无图/图表）；state 新增 pageHashes 页级指纹，`ppt_scene_check` 返回 revalidated（本次变更页）与 unchangedCount——修改循环只细看变更页，未变页沿用结论。SKILL.md 提供改动影响范围表（Slide/Section/Deck 三级）。
6. **不采纳（有意取舍）**：(a) 结构页计入用户确认页数——维持"内容页数口径 + 自动附加 3 页并明示总数"（0.2.0 已与用户确认的口径）；(b) PPTX 单页局部渲染——PPTX 是单文件包且全量渲染为毫秒级，"局部"落在校验与排查（revalidated）而非渲染文件。

回归：测试 70→77 项全过（新增分配校验/建议分配加权/精确匹配拒绝/结构错配/三项跨页规则）；demo 端到端含阶段 8 修改循环演示（改 1 页 → 增量校验只报该页 → 重渲染）。

### 0.2.0（2026-09-12）：流水线重构（a–g 七步）+ 主题/页型扩充 + 设计令牌锁定

按新确认的产品流程重做生成管线：**用户先选主题/听众/场景 → 确认大纲目录（分几部分）→ 确认内容页数 → 逐部分页级草稿 → 锁定两份计划文件 → 一气写完全册 → 校验渲染 → 改页循环**。

1. **工具重组（12→13 个）**：新增 `ppt_brief_create`（a：简报+建 deck，主题/听众/场景前置确认）、`ppt_pageplan_confirm`（c：内容页数，封面/目录/结尾 3 页自动附加并明示总页数）、`ppt_section_draft`（d：逐部分页级草稿，s0 专放结构页，Σ内容页硬校验，页 ID 按全册顺序规范化重编号）、`ppt_design_lock`（e-1：产出两份计划文件）；移除 `ppt_draft_create` / `ppt_design_confirm` / `ppt_section_outline` / `ppt_outline_build`（职责被合并）。状态机改为 7 阶段 `briefed→outlined→planned→drafted→locked→writing→rendered`。
2. **两份计划文件（d→e 的关键落点）**：`design/spec.json` 完整设计规范（各部分页数分配、密度策略、设计纪律）+ `design/tokens.json` 全 deck 锁定令牌（8 色板/chartColors/字体/字号阶梯/标题锚点/栅格）。渲染器只认令牌（不再运行时解析主题+覆盖色板）；`sceneHash` 指纹覆盖 tokens+outline+pages——改令牌同样触发重校验。
3. **「锁定」与「密度」量化为确定性规则**（validate.ts）：TOKEN_COLOR/TOKEN_FONT——元素或页面背景用了令牌外的颜色/字体报 warning；DENSITY_WITH_VISUAL——有主视觉页全页文字量超预算报 warning（预算随密度：sparse 140 / normal 220 / dense 320 全角字，无图页放宽到 400/700/1000）；VISUAL_PLAN_UNMET——草稿 visual:image/chart 但页面没有对应元素报 warning。结构化页型（timeline/comparison/process/cards/hierarchy/icon-list）元素上限放宽到 24。
4. **主题 6→12 套**：mono-editorial 极简杂志 / indigo-gradient 靛蓝渐变 / cream-notes 奶油手账 / forest-ink 墨绿学术 / navy-gold 藏蓝鎏金（深色）/ slate-orange 工业灰橙。
5. **页型 10→17 种**：timeline 时间轴 / comparison 对比 / big-number 大数字 / process 流程步骤 / cards 多卡片 / hierarchy 层级 / icon-list 图标要点；layouts.md 补齐七种新页型的坐标速查。
6. **文档与 demo**：SKILL.md SOP 重写为 a–g 七步（含页数口径与密度口诀）；demo 换成"给中学生介绍大模型"（8 内容页 + 3 结构页，覆盖 6 个新页型）。
7. **兼容性**：0.1.x 旧 deck 不迁移——新工具对旧 deck 报缺文件（brief.json 等），需从新 deck 重新开始；这是有意的行为。

回归：测试 62→70 项全过（frozen-args 重写为新链路冻结回归、schema/validate 新增令牌/密度/新页型断言、toollog 失败路径换 ppt_brief_create）；demo e2e 跑通 11 页渲染（PPTX 189KB ZIP 自检通过，warning 仅 1 条 11pt 来源注释的知情提醒）。

### 0.1.5（2026-09-11）：日志体系完善——失败调用留痕、环境诊断、失败入参快照

三轮真实会话排障都依赖回扒宿主 sessionlog 才能拿到失败入参。本次把排查所需的一手信息全部落到插件自己的日志里：

1. **插件级调用日志** `<outputDir>/ppt-studio/logs/plugin.log`（JSONL）：每次工具调用（成功与失败）一条，记录 `tool / argsForm（宿主传参形态）/ frozen（入参是否被宿主冻结）/ durationMs / argsPreview / deckId / error / errorStack（完整堆栈）/ snapshot`。建 deck 之前的失败（入参形态问题、schema 拒绝、崩溃）此前不留任何插件侧痕迹，现在第一条就是证据。写入串行化且 await 落盘——工具返回时日志必已在盘上。
2. **失败入参快照**：失败调用的完整入参自动存到 `logs/failed/<tool>-<时间戳>.json`，日志条目引用路径。排查不再需要 sessionlog 考古。
3. **形态标注**：`argsForm` 识别宿主把参数序列化成 JSON 字符串的传输（真实会话出现过）；`frozen` 标记冻结入参（"Cannot assign to read only property" 事故的一手信号）。
4. **`ppt_doctor` 工具**（第 12 个）：环境体检一键汇报——Node/插件版本、pptxgenjs 解析路径与互操作形态（`shape`：esm-default / module-exports-ctor / nested-default-* 等）、fflate/zod 可用性、输出目录可写性、预览端口探活、生图接口配置、失败快照数量，并给出针对性建议。
5. **渲染环境诊断**：`ppt_deck_render` 每次渲染前向 deck 日志写入模块解析路径 + 互操作形态 + 版本（"渲染环境诊断"条目），模块级故障在 deck 日志即可定位；构造器解析全部落空时报错内联模块诊断 JSON。
6. **`ppt_log_query` 增强**：新增 `source:"plugin"` 读插件级调用日志（列出失败快照索引）；deck 日志的 error 级条目现含完整堆栈（logger.timed 同步补齐）。
7. **SKILL.md 新增"排查"节**：报错全文 → ppt_doctor → plugin 日志 → deck 日志的顺序化排查路径，明确"同因失败不原样重试第 3 次"。

回归：新增 `test/toollog.test.ts` 5 项（成功/失败留痕、快照内容、形态标注、doctor 报告）+ interop 形态标注断言，**62/62 通过**；demo e2e 无回归；CLI 实测——单章节拒绝调用的 plugin.log 条目含完整堆栈与快照路径，doctor 正确报告 `esm-default` 形态与解析路径。

### 0.1.4（2026-09-11）：ppt_deck_render 宿主端崩溃 + 背景出血被误拒（session.v3.jsonl 01:16 更新版）

冻结入参修复生效后流程大幅推进：草稿/设计/大纲/逐章大纲全部打通，10 页场景落盘且全册校验通过，但 `ppt_deck_render` 3 次全部失败（`PptxGenJS is not a constructor`），另 3 次 `ppt_page_write` 被拒。逐条定位：

1. **`PptxGenJS is not a constructor`（渲染全阻）**：pptxgenjs 是双构建包（exports: `import`→es.js / `require`→cjs.js），本地 `node lib/demo.js` 原生 ESM 一切正常，但宿主加载管线给出的互操作形态不同（典型如 `__esModule` 双包被二次解包成 `{default:{default:…}}`），default 导入拿到的不是构造器。修复：`render-pptx.ts` 不再依赖 default 导入的形态——`pickPptxConstructor()` 按全部已知互操作形态（原生 default / CJS exports 整体 / `__esModule` 双包 / 双重互操作 / 命名导出 `{PptxGenJS}` / `module.exports=ctor`）逐一探测并缓存，CJS `require` 兜底，全部落空时报可诊断错误。类型引用改用运行时擦除的 `import type`，不受互操作影响。
2. **背景装饰出血被 schema 误拒**：模型用 `background:true` 的椭圆做角落出血（`x:-1.2`，合法设计手法），zod 硬边界 `x≥-1` 把它挡在解析层——而校验器本就允许背景元素出血（仅 warning）。两层规则不一致。修复：schema 坐标硬边界放宽到 ±3in（只拦明显荒谬值），策略仍由 validate.ts 把关——内容元素越出安全区照样 `OUT_OF_BOUNDS` 拒绝（有回归测试锁定）。
3. **报错提示更准**：`paragraphs:[]`（空段落数组）此前误触发"所有元素都因内容为空被丢弃"的提示；现按报错路径区分——空段落数组、宽高为 0、全部元素为空各给对应提示。

回归：新增 `test/interop.test.ts` 7 项（互操作形态全扫描）+ 出血/越界联动 2 项，**56/56 通过**；demo e2e 无回归（PPTX 自检通过）。注意 seq=142（p007 文字互压）与 seq=152（空段落/零高度）均为校验器按设计拒绝、模型凭精确定位报错自愈——这正是质检闸门的工作方式，无需修改。

### 0.1.3（2026-09-11）：宿主冻结入参导致 ppt_draft_create 全链瘫痪（session.v3.jsonl 更新版）

新一轮真实会话（"制作大模型科普ppt"）在第一步就卡死：`ppt_draft_create` 连续 9 次报
`Error: Cannot assign to read only property 'sections' of object '#<Object>'`，模型反复重试 7 次（含 "测试"/"x" 单章节探针）全部同样崩溃，整条工具链未产出任何成果。逐条回放定位并修复：

1. **根因——原地修改宿主冻结的入参**：DSH 宿主把工具入参以只读（冻结）对象交给 execute；`ppt_draft_create` 此前在 execute 里对 `raw.sections` 做容错包装时直接原地赋值 → TypeError。已改为先浅拷贝到局部 `normalizedSections` 再交给 zod（`tools/draft.ts`）。全源码扫描确认其余工具均无入参原地修改（normalize/deepRepair 本就构建新对象）。
2. **自造 deckId 可自纠**：草稿从未建成，模型自行编造 `deckId: draft_llm_popularize_2024` 调 `ppt_design_confirm` →"deck 不存在"。现报错附**现有 deck 清单**（id/标题/阶段），新增共享辅助 `requireDeckState()` 并统一接入 design/outline/page/check/render/log/image 全部 8 处入口——deckId 错误时模型无需再调工具即可改正。
3. **单章节探针的可读拒绝**：崩溃循环中模型用 `"测试"`/`"x"` 单章节最小载荷探测工具是否存活，原先只收到英文 zod 数组。现 `ppt_draft_create` 报错改为中文摘要 + 针对性提示（"sections 至少需要 2 个章节（当前 1 个）"）+ 正确示例（与 ppt_page_write 同款格式）。

验证：新增 `test/frozen-args.test.ts` 5 项（真实载荷深冻结跑通 / 入参未被改写断言 / 单章节可读拒绝 / 自造 deckId 报错附清单 / 全链 draft→design→outline），47/47 通过；重放 `sessionlog/replay-v3.mjs`——9 次历史失败载荷深冻结重放，6 次有效载荷全部成功、3 次单章节探针被正确拒绝、design_confirm 报错带候选清单、正常链路全通，11/11；demo e2e 无回归（12 页 PPTX 自检通过）。

### 0.1.2（2026-09-11）：子代理通道损坏形态（sessionlog/subagents）

补充分析三个子代理会话日志后，新增两类传输损坏的容错（`deepRepair`）：

1. **标量全部字符串化**：`x:"0.6"`、`background:"true"`、`z:"1"`——已知数值键（x/y/w/h/z/fontSize/...）的字符串数字自动转回 number，已知布尔键（background/bold/...）的 `"true"/"false"` 转回 boolean，chart `values`/`colWidths` 数组同理。
2. **重复元素被包成 `{item:...}` 对象**：`paragraphs:{item:{...}}`、`runs:{item:{...}}`、`rows:{item:[{item:[...]}]}`——重复 XML 标签→JSON 的转换痕迹（"结构与范例一致仍报错"的元凶）。`elements/paragraphs/runs/series/labels/rows/values/colors/keyPoints/sections` 等语义数组键一律自动还原为真数组。
3. 修复计数计入返回值 `repairs`（"已自动修复 N 处传输形态问题"），模型可感知。

回归：新增测试 ⑦⑧⑨⑩（42/42 通过）；重放验证——子代理通道 6 次历史失败全部自动修复；全量 94 次历史失败中 63 次自动通过，其余 31 次为真实模型错误（元素缺坐标/空壳无文字/超元素上限），报错已可精确定位到元素原文。

**线索（harness 层）**：`{item:}` 包装与标量字符串化只出现在子代理通道，说明 dsh 的子代理任务下发/回传链路（或 MiniMax 子代理协议）对工具参数做了一次有损转换。插件侧已容错；若要在源头修复，可排查 harness 子代理工具调用的参数序列化环节。

### 0.1.1（2026-09-11）：基于真实会话失败回放（sessionlog/session.v3.jsonl）

真实 dsh 会话中 `ppt_page_write` 49 次失败 / 仅 10 次成功、deck 渲染失败。逐条回放定位并修复：

1. **工具参数 schema 过简**（主因）：`elements.items` 原来只有一句描述，模型看不到元素结构、凭直觉写扁平 `text:` 字段。现补全 text/shape/image/chart/table 五类元素的完整 JSON Schema（含 paragraphs/runs 结构与必填项），模型调用时即可见。
2. **容错归一层 `normalize.ts`**（新增）：扁平 `text` 自动展开为 `paragraphs`；`paragraphs`/`elements` 对象自动包数组；数字文本转字符串；`"color=#F1F5F9":""` 形态的传输损坏键自动拆分修复；无内容纯噪声元素丢弃（repairs 列出全部自动修复项）；text 缺 fontSize/color 兜底默认值。
3. **段落级样式被静默剥离**：模型写的 `paragraphs:[{bold,color,fontSize,...}]` 原 schema 不含这些字段、zod 默默丢弃（10 个"成功"页实际丢了样式）。已补段落级 bold/italic/color/fontSize，双渲染器按 run > 段落 > 元素 优先级生效。
4. **工具返回值含 undefined 被 DSH 拒收**（`ppt_log_query` 全部失败的根因）：所有工具返回值统一过 `lossless()` 深度清洗。
5. **报错可定位**：schema 报错现附出错元素原文（截断 JSON）+ 针对性提示（缺坐标/超上限等）+ 正确写法示例——此前只给 zod 路径，模型误判为"序列化层吞字段"并陷入重试循环。
6. **上限调整**：元素数 20→24；文本/段落/run 级 fontSize 上限 96→300（装饰性大数字，如章节页 240pt 半透明序号是合法设计）。
7. **SKILL.md** 增加"常见错误写法对照表"；`test/normalize.test.ts` 用会话中的真实失败形态做回归（38/38 通过）；重放验证：48 次历史失败中 33 次现可自动通过，其余 15 次为真实错误（缺坐标/空内容）且报错可精确定位。

回归重放脚本：`sessionlog/replay.mjs`（node 运行，需先 `npm run build`）。
