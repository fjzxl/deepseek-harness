# 页型版式规范（写页前必读）

画布 13.3333 × 7.5 英寸（16:9），坐标原点左上，单位英寸，精度 0.01。
所有非背景元素必须留在安全区内：`x ≥ 0.15, y ≥ 0.15, x+w ≤ 13.18, y+h ≤ 7.35`。
装饰衬底（整页色块、卡片底、时间轴线）给形状加 `background:true`。
共 17 种页型；标题位置与字号阶梯以 `design/tokens.json` 锁定值为准（下文数值为常规参考）。

## 通用栅格与字号体系

- 左右边距 0.6in（正文区宽 12.13in）；标题带 y 0.45–1.35in；内容区 y 1.6–7.0in。
- 字号阶梯：封面主标 36–44pt；章节页标题 30–34pt；内容页标题 24–28pt；正文 14–18pt；注释/来源 11–12pt。
- 标题条：内容页标题下加一条主色短横条（shape: rect, 0.6×0.06in, 主色），是最省事的视觉锚点。
- 卡片：roundRect + surface 底色 + 无边框，内边距留 0.2in 以上；卡片上的文字是与卡片重叠的独立 text 元素，卡片本身标 background:true。

## 各页型区块划分（坐标速查）

### cover 封面
- 背景：整页渐变（background:true 的 rect，或 page.background.gradient）
- 主标题：text，x 1.0, y 2.6, w 11.3, h 1.2，36–44pt，居中，onPrimary 或 text 色
- 副标题/汇报人/日期：x 1.0, y 4.0, w 11.3, h 0.5，16–18pt，居中，textMuted
- 装饰：底部主色条 rect x 0, y 7.1, w 13.3333, h 0.4（background:true）

### toc 目录
- 标题"目录"：x 0.6, y 0.45, w 4, h 0.7，28pt
- 条目：每章一行 text，x 1.0 起，y 从 1.8 开始每行间隔 0.75–0.9in；章名 18pt + 页码（textMuted）
- 可选：左侧窄主色竖条 rect x 0.6, y 1.8, w 0.08, h 4.8（background:true）

### section 章节过渡页
- 背景：主题渐变或主色（浅色主题用大面积 surface+主色块）
- 章序号（01/02…）：text 60pt accent 色，x 0.9, y 2.2
- 章标题：30–34pt，x 0.9, y 3.3, w 11.5, h 0.9
- 本章一句话导语：16pt textMuted，y 4.4

### bullets 要点页
- 标题：x 0.6, y 0.45, w 12.1, h 0.7，24–28pt + 主色短横条 y 1.25
- 要点列表：单一 text 元素多段落（bullet:true），x 0.9, y 1.7, w 11.5, h 5.0，16–18pt，行距 1.3–1.4，要点间 spaceAfter 6–10pt
- 超过 5 条要点改用两栏或拆页

### two-col 两栏页
- 标题带同 bullets
- 左右两张卡片（roundRect, surface, background:true）：各 x 0.6 / 6.87, y 1.7, w 5.86, h 5.0
- 卡片标题 text 18pt bold y 1.95；卡片内容 text 15–16pt；两栏宽度差保持 ≤0.1in
- 中缝 0.41in

### image-text 图文页
- 图（image，实图或 placeholder）：x 0.6, y 1.7, w 5.6, h 4.6，fit:cover
- 文字区：x 6.6, y 1.8, w 6.1, h 4.4，标题 20pt + 要点 15–16pt
- 图在上文在下：图 y 1.7, h 3.6；文字 y 5.5
- 图片说明/来源：11pt textMuted 紧贴图下

### chart 数据页
- 标题带同 bullets；数据来源注在页底 11pt
- 图表（chart 元素）：x 0.6, y 1.7, w 7.8, h 4.9
- 右侧结论栏：text x 8.8, y 1.9, w 3.9, h 4.5，"结论先行"18pt bold + 论据 14–15pt
- 全宽图表：w 12.1, h 5.0，结论放标题右侧或图下
- 系列数 >3 时改用分面/拆页；饼图类目 ≤6

### table 表格页
- 标题带同 bullets
- 表格（table 元素）：x 0.6, y 1.7, w 12.1，fontSize 12–14，headerRow:true
- 列数 ≤6；行数 ≤8（更多拆页或改图表）；单元格文字 ≤16 字

### quote 金句页
- 引文：text 24–28pt italic，x 1.5, y 2.6, w 10.3, h 1.8，居中
- 出处：14pt textMuted，y 4.7，居中
- 大引号装饰：text 90pt 主色 opacity 0.25，x 0.7, y 1.9（background:true）

### closing 结尾页
- 同封面风格：渐变背景 + "谢谢聆听 / Q&A" 36pt 居中 y 3.0
- 联系方式/下一步行动：16pt textMuted y 4.3

### timeline 时间轴页（发展历程 / 阶段演进）
- 标题带同 bullets
- 中轴竖线：rect x 5.0, y 1.7, w 0.05, h 5.0（background:true，secondary 或 primary 30% 透明；宽度不低于 0.05——schema 最小值）。轴偏左留出右侧宽事件区，整版视觉居中
- 节点 3-5 个，自上而下均分：每节点 = 圆点（ellipse 0.22×0.22，x 4.92，主色）+ 年代标签（text x 2.5, w 2.3, 右对齐，16pt bold 主色）+ 事件说明（text x 5.45, w 7.15, 15pt text 色）
- 节点起始 y 1.9，间隔 (5.0-0.4)/节点数；单节点说明 ≤2 行
- 可选：左侧 0.6-2.3 放窄条导语/大号装饰序号（低透明度）
- 横向变体：轴线 y 4.3 横贯（x 0.9, w 11.5），节点左右交错上下放文字

### comparison 对比页（左右 VS）
- 标题带同 bullets
- 左右卡片：roundRect surface 各 x 0.6 / 6.87, y 1.7, w 5.86, h 4.6（background:true）
- 左卡标题（旧/方案A）：18pt bold textMuted，y 1.95；右卡标题（新/方案B）：18pt bold primary
- 卡内要点 3-5 条，15pt；两卡条数尽量对齐
- 中缝徽标：ellipse 0.7×0.7 x 6.32, y 3.6，主色底 + onPrimary "VS" 14pt bold 居中

### big-number 大数字页（关键数据强调）
- 标题带同 bullets
- 大数字：text x 0.6, y 2.1, w 12.1, h 2.6，120–160pt bold 主色，居中（可用 runs 混排单位，如 "5" 160pt + "倍" 40pt）
- 数字说明：text x 1.5, y 5.0, w 10.3, h 0.6，18pt text 色，居中（一句话讲数字含义）
- 佐证/来源：11pt textMuted y 6.7；可加 2-3 个小注数字（24pt bold accent）横排在 y 5.9
- 本页文字量极小：一行结论 + 来源即可

### process 流程步骤页（步骤 / 链路）
- 标题带同 bullets
- 步骤 3-5 个横排：每步 = chevron 形状（w 2.7, h 1.1, y 2.6，相邻间隔 0.25，从 x 0.6 起）主色/辅色交替；步骤名 16pt bold onPrimary 叠在 chevron 上
- 步骤说明：每步下方 text（w 2.7 与 chevron 对齐），14pt，≤3 行
- 首尾强调：第一步与最后一步用 primary，中间步骤用 secondary
- 竖排变体：右箭头改下箭头（chevron 旋转或用三角形），步骤 y 间隔 1.2

### cards 多卡片页（并列概念 / 分类盘点）
- 标题带同 bullets
- 3 卡：roundRect surface 各 w 3.9, h 4.4, y 1.8，x 0.6 / 4.72 / 8.83（间隔 0.22）
- 4 卡：w 2.9, h 4.4，x 0.6 / 3.78 / 6.96 / 10.13
- 卡内结构：序号或图标（text 24pt bold accent，y +0.25）→ 卡标题（17pt bold text，y +0.9）→ 说明（14pt textMuted，2-4 行）
- 卡片本身 background:true；卡片间严禁文字溢出卡外

### hierarchy 层级页（金字塔 / 分层结构）
- 标题带同 bullets
- 3-4 层横条自上而下变宽：顶层 rect w 4.0 居中（x 4.67），每层加宽 2.2、y 间隔 0.75，层高 0.9，起始 y 1.8
- 每层 = rect（主色到辅色渐次：primary → secondary → surface+边框）+ 层名 16pt bold 叠放居中；onPrimary 字色（浅色层用 text 色）
- 右侧或底部注释：每层一句说明 12-14pt textMuted（金字塔左侧 x 0.6, w 3.8 对齐各层 y）

### icon-list 图标要点页（图标 + 短句清单）
- 标题带同 bullets
- 要点 3-6 行，每行 = 图标（ellipse 0.5×0.5 x 0.9，主色 10-15% 透明底 + 内部符号或序号）+ 要点短句（text x 1.7, w 10.9, 16pt，单行 ≤28 字）
- 行起始 y 1.8，间隔 0.85；行内可加第二行弱化说明 13pt textMuted
- 无图标素材时用「序号圆点 + accent 数字」实现，禁止外链图标

## 图表元素速查

chart 元素：`chartType: column|bar|line|area|pie|doughnut` + `labels[]` + `series[{name, values[]}]`（长度一致；饼图单系列）。
颜色默认走主题 chartColors；showValues 适合数据点少的柱图；线图不加数值标签。

## 图片元素速查

- 实图：先 `ppt_asset_register` 拿 assetId → `{kind:'image', assetId, fit:'cover'}`
- 占位：`{kind:'image', placeholder:{prompt:'建议配图描述', hint:'替换说明?')}}` → 渲染为虚线框提示用户手动放图
- 禁止拉伸：fit:'fill' 只用于明确抽象底图

## 页型 → 适合的信息结构（反向索引）

写页时反查"这个页型适合讲什么"（正向表见 generation-flow.md 第七节；错配由 STRUCTURE_TYPE_MISMATCH 提醒）：

| 页型 | 适合的信息结构 | 一句话 |
|---|---|---|
| timeline | timeline（专用） | 有先后顺序的演进就上时间轴 |
| comparison | comparison / before-after | 左右对打、新旧对照 |
| two-col | comparison / cause-effect / problem-solution / before-after | 双栏并列讲两类东西的关系 |
| process | process / cause-effect / problem-solution | 有步骤就画箭头链 |
| hierarchy | hierarchy | 上下层级/包含关系 |
| chart | data-insight | 数据说话 |
| big-number | data-insight / concept-example | 一个数字或一个概念砸重点 |
| table | comparison / data-insight | 多维对照或多行数据 |
| image-text | process / cause-effect / problem-solution / concept-example | 图配文讲机制或例子 |
| cards | concept-example | 3-4 个并列卡片 |
| icon-list | concept-example | 图标 + 短句清单 |
| bullets | hierarchy / 任意（兜底） | 简单罗列；hierarchy 结构时可分层缩进 |
| quote | 任意（金句页） | 引用与口号，少即是多 |
| section / cover / toc / closing | 结构页（s0 专用） | 不承载内容结构 |
