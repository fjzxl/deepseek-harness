# 主题色板（与 src/themes.ts 同步）

12 套内置主题（0.19.0 重制：深锚色 + 双色结构页渐变 + 克制点缀；0.20.0 文化类标题衬线）。选色时**只用该主题的色板**，禁止混搭其他主题颜色，禁止自造色值（paletteOverrides 除外）。
颜色键：bg 页底 / surface 卡片底 / primary 主色 / secondary 辅助 / accent 点缀 / text 正文 / textMuted 弱化 / onPrimary 主色上文字。
每套主题另有 chartColors（图表循环色）与 fonts（标题/正文字体——文化类主题 0.20.0 起标题用衬线：宋体/楷体，缺字体回退雅黑）。0.19.0 起封面/章节/结尾页由渲染器铺**结构页渐变**（structuralGradient 端点，缺省=primary→secondary 派生；tech-dark/navy-gold 为深色锚）+ 结构页文字色按渐变亮度确定性派生；设计锁定后 tokens.json 的 colors+tints 是唯一合法用色集。
注意：锁定设计（ppt_design_lock）后，写页只能用 design/tokens.json 里的最终色板。

## business-blue 墨蓝商务（浅色·商业）— 工作汇报 / 项目总结 / 对上汇报 / 评审答辩
bg #F2F5F9｜surface #FFFFFF｜primary #173A66｜secondary #3E7CB1｜accent #E07A3F｜text #1C2836｜textMuted #5D6B7C｜onPrimary #FFFFFF
结构页渐变 #173A66→#3E7CB1(135°)｜图表 [#173A66, #3E7CB1, #7FA9D9, #E07A3F, #94A3B8, #2C6E63]｜字体 标题 Microsoft YaHei / 正文 Microsoft YaHei

## tech-dark 深空霓虹（深色·科技）— 技术方案 / 产品发布 / 架构宣讲 / 开发者分享
bg #182236｜surface #243248｜primary #1FB4E6｜secondary #8B7CF6｜accent #5EEAD4｜text #EDF2FA｜textMuted #8FA0B8｜onPrimary #08131F
结构页渐变 #0D1B33→#2E2766(135°)｜图表 [#1FB4E6, #8B7CF6, #5EEAD4, #FBBF24, #F472B6, #60A5FA]｜字体 标题 Microsoft YaHei / 正文 Microsoft YaHei
注意：深色主题下正文用 text 色，卡片用 surface，主色块上文字用 onPrimary（深色）。

## gov-red 朱砂映金（浅色·政务）— 党政机关汇报 / 主题教育 / 精神文明宣传
bg #FBF6ED｜surface #FFFFFF｜primary #A62B2B｜secondary #7E1F24｜accent #C9A227｜text #2E2924｜textMuted #7C7368｜onPrimary #FFFFFF
结构页渐变 #A62B2B→#7E1F24(135°)｜图表 [#A62B2B, #C9A227, #BC5A34, #8C6D46, #94A3B8, #5F7470]｜字体 标题 SimSun / 正文 Microsoft YaHei

## academic-plain 霁青纸本（浅色·教育）— 学术报告 / 课程讲义 / 研究综述 / 毕业答辩
bg #FAFAF6｜surface #FFFFFF｜primary #2E5D7D｜secondary #46748F｜accent #D9A441｜text #2B3440｜textMuted #6E7B8A｜onPrimary #FFFFFF
结构页渐变 #2E5D7D→#46748F(135°)｜图表 [#2E5D7D, #46748F, #D9A441, #40566B, #A5C9E1, #8D99AE]｜字体 标题 Microsoft YaHei / 正文 Microsoft YaHei

## fresh-teal 碧玉青（浅色·教育）— 培训宣讲 / 团队建设 / 公益科普 / 活动介绍
bg #EFF7F2｜surface #FFFFFF｜primary #0D7A68｜secondary #1E8F7E｜accent #EFA94A｜text #1C3830｜textMuted #5F7A72｜onPrimary #FFFFFF
结构页渐变 #0D7A68→#1E8F7E(135°)｜图表 [#0D7A68, #1E8F7E, #EFA94A, #3D7EA6, #9CBF6E, #776871]｜字体 标题 Microsoft YaHei / 正文 Microsoft YaHei

## warm-sunset 珊瑚暮色（浅色·文化）— 文化宣传 / 品牌故事 / 年度回顾 / 致谢场合
bg #FDF6EF｜surface #FFFFFF｜primary #C75B39｜secondary #8A4A63｜accent #E89A5B｜text #3A2E28｜textMuted #8A7A6D｜onPrimary #FFFFFF
结构页渐变 #C75B39→#8A4A63(135°)｜图表 [#C75B39, #8A4A63, #E89A5B, #5B8C5A, #98B4D4, #C15B5B]｜字体 标题 SimSun / 正文 Microsoft YaHei

## mono-editorial 黑白画册（浅色·商业）— 设计提案 / 发布会开场 / 作品集展示 / 观点陈述
bg #FAFAFA｜surface #FFFFFF｜primary #14161A｜secondary #3F444C｜accent #E63946｜text #1A1A1A｜textMuted #8A8A8A｜onPrimary #FFFFFF
结构页渐变 #14161A→#3F444C(135°)｜图表 [#14161A, #E63946, #8C8C8C, #525252, #BFBFBF, #D9D9D9]｜字体 标题 Microsoft YaHei / 正文 Microsoft YaHei
注意：accent 红只做小面积点睛（数字/下划线），大面积保持黑白灰。

## indigo-gradient 靛紫极光（浅色·科技）— 产品发布 / 技术布道 / 创新提案 / AI 主题分享
bg #F4F5FD｜surface #FFFFFF｜primary #4438D6｜secondary #7C3AED｜accent #F59E0B｜text #201B4D｜textMuted #6D6A8A｜onPrimary #FFFFFF
结构页渐变 #4438D6→#7C3AED(135°)｜图表 [#4438D6, #7C3AED, #06B6D4, #F59E0B, #EC4899, #6366F1]｜字体 标题 Microsoft YaHei / 正文 Microsoft YaHei

## cream-notes 奶油手账（浅色·教育）— 教学讲义 / 读书分享 / 轻量科普 / 社群活动
bg #FBF5E9｜surface #FFFCF4｜primary #8F6136｜secondary #B0824E｜accent #6E8B5E｜text #3A3022｜textMuted #8C7F6E｜onPrimary #FFFCF4
结构页渐变 #8F6136→#B0824E(135°)｜图表 [#8F6136, #B0824E, #6E8B5E, #B0563F, #D9B67E, #8A8F6C]｜字体 标题 SimKai / 正文 Microsoft YaHei
注意：onPrimary 为奶油白（非纯白），浅色卡上文字一律用 text 色。

## forest-ink 深林墨绿（浅色·教育）— 学术答辩 / 研究汇报 / 环保与生命科学主题
bg #F3F7F4｜surface #FFFFFF｜primary #1B4A38｜secondary #2F6B4F｜accent #C9A227｜text #202D27｜textMuted #67766E｜onPrimary #FFFFFF
结构页渐变 #1B4A38→#2F6B4F(135°)｜图表 [#1B4A38, #2F6B4F, #C9A227, #2F4858, #8FAF9B, #5F7470]｜字体 标题 Microsoft YaHei / 正文 Microsoft YaHei

## navy-gold 午夜鎏金（深色·活动）— 年度盛典 / 对外答谢 / 高层战略汇报 / 颁奖典礼
bg #152540｜surface #1F3350｜primary #D9B56A｜secondary #5B8BBE｜accent #E5CD8F｜text #F2F0E9｜textMuted #9AA5B1｜onPrimary #14243A
结构页渐变 #101F38→#2B4066(135°)｜图表 [#D9B56A, #5B8BBE, #E5CD8F, #7BA7C9, #94A3B8, #3E5F7E]｜字体 标题 Microsoft YaHei / 正文 Microsoft YaHei
注意：深色主题下正文用 text 色，卡片用 surface，主色块上文字用 onPrimary（深色）。
注意：primary 是香槟金，主色块上文字用 onPrimary 深藏蓝；金色不做大面积底色（封面为午夜藏蓝锚渐变）。

## slate-orange 石墨信号橙（浅色·商业）— 制造与工程汇报 / 安全生产 / 生产运营看板
bg #F2F3F4｜surface #FFFFFF｜primary #333F48｜secondary #56656E｜accent #E8590C｜text #232D33｜textMuted #78909C｜onPrimary #FFFFFF
结构页渐变 #333F48→#56656E(135°)｜图表 [#E8590C, #333F48, #56656E, #FF8A65, #90A4AE, #6D4C41]｜字体 标题 Microsoft YaHei / 正文 Microsoft YaHei
注意：accent 橙承担警示语义（风险/告警/重点指标），不要当装饰色滥用。
