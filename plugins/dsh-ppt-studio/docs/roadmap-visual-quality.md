# dsh-ppt-studio:视觉质量优化 TODO

> 2026-09-22 基于实际产出诊断建立(d20260922-000110-1300,11 页:80 文本 / 49 形状 / 1 图 / 1 图表,
> 8 平色无色阶,正文 14–15pt dense 档,装饰为同色调平面形状)。
> 与 [roadmap-aippt-borrowing.md](./roadmap-aippt-borrowing.md) 互补:那份记外部借鉴,这份记视觉质量自身演进。
> 状态标记:☐ 待做 / ◐ 进行中 / ☑ 已做(注明版本) / ✗ 不做(注明裁决)。

## 诊断结论(三个架构层根因)

1. **配图供给断供** → "基本是文字":生图默认关闭、外网搜图是内网红线、SVG 插图覆盖面窄。
2. **装饰无效** → "有装饰但不显":程序画的平面矩形无阴影/描边/纹理,同色调叠同色调(暗红圆叠红底,ΔL≈0)。
3. **色彩无色阶** → "颜色一般":8 个平色,卡片底/描边/标签只能用原色或灰。

## 第一梯队:tokens / 校验 / 层次(纯代码零依赖)— ☑ 0.15.0 已落地

| # | 项 | 状态 | 设计口径 |
|---|---|---|---|
| T1-1 | **色阶系统**:buildDesignTokens 为 primary/secondary/accent 生成 50–900 梯度;卡片底用 -50、描边 -200、强调 -700 | ☑ 0.15.0 | 色阶由代码从基色算(混色锚点=页面底色,深浅主题同语义),向后兼容:colors 8 色保持不变,新增 `tints` 字段;旧 deck tokens 无 tints 时版式回落基色 |
| T1-2 | **装饰有效性校验规则**:装饰形状与页面背景亮度差 ΔL 低于阈值 → 拦截 | ☑ 0.15.0 | 落地为 DECORATION_CONTRAST(warning):WCAG 对比 <2.0 且 RGB 色距 <75 双指标(避免色相盲区误报);豁免低透明度/描边/渐变填充;渐变背景取两端点+中点,任一处不可见即报;12 主题×8 页型引擎产物零误报有单测 |
| T1-3 | **层次三件套**:卡片细描边(色阶色)+ 轻阴影(双渲染器一致)+ 留白规范;封面垂直重心修正;**渐变降依赖**(PPTX 端回退纯色的已知取舍 → 设计上改纯色+色阶分层) | ☑ 0.15.0 | shape 新增 `shadow` 字段(PPTX outer shadow / HTML box-shadow,angle 0=右/90=正下);结构页弃整页渐变改纯色主底+右上色阶大圆+onPrimary 底条+标题居中点缀条;icon-list 圆片明暗感知色阶实色 |

## 第二梯队:视觉素材零网络供给

| # | 项 | 状态 | 说明 |
|---|---|---|---|
| T2-1 | 内置内联 SVG 图标包(60–80 个统一线宽) | ☑ 0.18.0 | 83 个自绘线稿(24×24/stroke 2.4/round,无 GPL 逐行搬运):icon-list 序号数字升级为图标徽章、cards/timeline 节点全用上;content 可显式给名(icon-list.icons / cards[].icon / events[].icon),缺省按条目文本关键词确定性自动选+哈希落中性池;徽章配色自适应(浅底 tint200-400 圆+tint700 字形,深底 tint600 圆+bg 字形,warm-sunset 类低饱和主色自动加深圆片过装饰可见线) |
| T2-2 | 主题化 SVG 背景纹理(点阵/斜线/窗棂纹样,低透明度挂 tokens) | ☑ 0.18.0 | tokens.texture{kind,color,opacity} 由色阶确定性计算(浅底 primary-300/0.42、深底 primary-600/0.38),12 主题气质分野映射(dots=商务学术/diagonal=科技/lattice=文气庄重);**渲染器注入而非页面元素**——sceneHash 不受影响、手写页同享、旧 deck 重渲染即得;HTML 整页内联 SVG、PPTX 整册光栅化一次(100PPI,~20KB/页)复用;design_lock 的 texture 参数可覆盖/关闭 |
| T2-3 | 生图端点配置(OpenAI 兼容) | ✗ 不做 | 2026-09-25 用户裁决:不做。内网红线下无可用端点,配图供给由 T2-1 词表图示 + 0.17.0 illustration 图示 JSON + ppt_asset_register 用户图(含品牌取色派生主题,见 aippt 借鉴 P5)覆盖 |
| — | **visualStyle 视觉风格开关(0.16.0 已做)** | ☑ 0.16.0 | brief.visualStyle 三档:visual=配比硬指标 VISUAL_RATIO_LOW + image-text 必须给 svg/资产;text=节奏降级;真实事故 29 页零图驱动 |
| — | **content 2.0:layout 词表 + illustration 图示 JSON(0.17.0 已做)** | ☑ 0.17.0 | 模型做构图选择题(split/variant/divider/card)、代码执行坐标;图示 flow/layers 代码渲染守锁——补齐 T2-1 的路径(词表图示替代手写 SVG);venn/matrix/tree 待扩 |

## 第三梯队:体系性调整

| # | 项 | 状态 | 说明 |
|---|---|---|---|
| T3-1 | 12 套主题按 60-30-10 重调(中性留白 60%) | ☑ 0.19.0 | 12 套配色整体重制(2026 趋势深锚色+克制点缀)+结构页双色渐变(渲染器注入,HTML=CSS/PPTX=光栅化 PNG);深色锚封面令牌 structuralGradient(tech-dark/navy-gold);内容页标题条改 accent;onPrimary 对渐变两端 ≥3.3:1 全数达标;视觉门四轮 24 张样张全 pass |
| T3-2 | 标题字体配对(文化类主题衬线) | ☑ 0.20.0 | gov-red/warm-sunset 标题=SimSun、cream-notes 标题=KaiTi(正文保持雅黑);只动 fonts.title,tokens 锁定链路天然携带;缺字体 HTML/PPT 双端回退雅黑无害。坑:楷体 family 名必须用 KaiTi,SimKai 是 XP 别名 Win7+ 不认(视觉评估实测静默回退) |
| T3-3 | 密度默认档与页型配比(默认 normal 16pt;visual 页占比 ≥1/3 建议) | ☑ 归档 | 0.20.0 核实:brief 密度默认已 normal(FONT_LADDERS normal body=16pt),visual 配比已被 0.16.0 visualStyle 三档+0.17.1 蓝图期闸门(visual<1/3 拒锁 error/balanced<1/5 警告)+VISUAL_RATIO_LOW 全册校验覆盖,比"建议"更强,无需另做 |
| T3-4 | 页渲染截图自审(headless Edge 已验证可行)+ 确定性视觉启发式(文字覆盖率/装饰对比度/用色分布)挂 ppt_scene_check | ☑ 0.22.0 | 落地为 src/visual-audit.ts：单页 HTML（与播放器共用 DECK_CSS）→ headless Edge/Chrome 截图（preview/audit/ 留档）→ 三条 warning 启发式（VISUAL_EMPTY 近乎空白 / VISUAL_BALANCE_H 左右失衡 / VISUAL_BALANCE_V 垂直重心）。校准三课：背景纹理与整宽装饰对列带贡献均匀 → 底噪地板取 24 列带密度第 10 百分位、失衡按"占据带数"判（半幅 ≤1 带且对侧 ≥2 带）；地板不可用中位数（整宽标题带会被整条吞掉）；tint50 卡底与纹理像素同档（距底色都 ≈17）→ scene 声明整宽容器卡的页免判横向（hasFullWidthContainer）、位图照片页双向免判。挂接：render 后自动全册 + scene_check visualAudit:true 只审变更页；不进 issues 闸门；浏览器缺失静默降级。装饰对比度/用色分布维持既有 DECORATION_CONTRAST 结构规则（0.15.0），未做像素版 |
| T3-5 | icon-list/bullets 等单列页型重心偏左(内容列仅占左 ~45%,右半幅全空) | ☑ 0.20.0 | icon-list 重做为整宽行卡(每条目全宽圆角卡:徽章+居中文字,稀疏垂直居中,layout.card 可选 tint/solid/plain)——3 主题×4 变体×视觉门 15/15 pass,"结构性改进";bullets 保持旧版(全宽文本框+稀疏自适应+左侧竖条,视觉门判定可接受) |

## 验证方式

- 每项落地后:用固定 content 样例 compose → renderDeckHtml → headless Edge 截图对比前后。
- 单测:色阶生成确定性、对比度规则拦截用例、版式引擎产物 errorCount===0 不回归。
