# 主题色板（与 src/themes.ts 同步）

12 套内置主题。选色时**只用该主题的色板**，禁止混搭其他主题颜色，禁止自造色值（paletteOverrides 除外）。
颜色键：bg 页底 / surface 卡片底 / primary 主色 / secondary 辅助 / accent 点缀 / text 正文 / textMuted 弱化 / onPrimary 主色上文字。
每套主题另有 heroGradient（封面/章节页渐变）与 chartColors（图表循环色）。
注意：锁定设计（ppt_design_lock）后，写页只能用 design/tokens.json 里的最终色板。

## business-blue 商务蓝（浅色）— 工作汇报 / 项目总结 / 评审答辩
bg #F5F7FA｜surface #FFFFFF｜primary #1E4B8F｜secondary #2E6FC9｜accent #E8A33D｜text #1F2937｜textMuted #6B7280｜onPrimary #FFFFFF
渐变 #1E4B8F→#2E6FC9(135°)｜图表 [#1E4B8F, #2E6FC9, #6FA8E0, #E8A33D, #94A3B8, #B85C38]

## tech-dark 科技深色（深色）— 技术方案 / 产品发布 / 架构宣讲
bg #0F172A｜surface #1E293B｜primary #38BDF8｜secondary #818CF8｜accent #34D399｜text #F1F5F9｜textMuted #94A3B8｜onPrimary #0F172A
渐变 #0EA5E9→#6366F1(135°)｜图表 [#38BDF8, #818CF8, #34D399, #FBBF24, #F472B6, #60A5FA]
注意：深色主题下正文用 text 色，卡片用 surface，主色块上文字用 onPrimary（深色）。

## gov-red 政务红（浅色）— 党政汇报 / 主题教育 / 宣传
bg #FAF6F0｜surface #FFFFFF｜primary #B02A30｜secondary #D4544F｜accent #C9A227｜text #2D2A26｜textMuted #7A736B｜onPrimary #FFFFFF
渐变 #B02A30→#7A1E22(135°)｜图表 [#B02A30, #C9A227, #D4544F, #8C6D46, #94A3B8, #5F7470]

## academic-plain 学术素雅（浅色）— 学术报告 / 课程 / 答辩
bg #FDFDFB｜surface #FFFFFF｜primary #33658A｜secondary #86BBD8｜accent #F6AE2D｜text #2F3542｜textMuted #707788｜onPrimary #FFFFFF
渐变 #33658A→#2F4858(135°)｜图表 [#33658A, #86BBD8, #F6AE2D, #2F4858, #A5C9E1, #8D99AE]

## fresh-teal 清新青绿（浅色）— 培训宣讲 / 团建 / 科普
bg #F2FAF7｜surface #FFFFFF｜primary #0E8A6D｜secondary #34B392｜accent #F4A259｜text #1E3A34｜textMuted #5F7A72｜onPrimary #FFFFFF
渐变 #0E8A6D→#34B392(135°)｜图表 [#0E8A6D, #34B392, #F4A259, #3D7EA6, #9CBF6E, #776871]

## warm-sunset 暖阳渐变（浅色）— 品牌故事 / 年度回顾 / 致谢
bg #FFF9F2｜surface #FFFFFF｜primary #D96C47｜secondary #F2A65A｜accent #7D6B91｜text #3B2F2A｜textMuted #8A7A6D｜onPrimary #FFFFFF
渐变 #D96C47→#F2A65A(135°)｜图表 [#D96C47, #F2A65A, #7D6B91, #5B8C5A, #98B4D4, #C15B5B]

## mono-editorial 极简杂志（浅色）— 设计提案 / 发布会开场 / 作品集
bg #FAFAFA｜surface #FFFFFF｜primary #111111｜secondary #4B4B4B｜accent #E63946｜text #1A1A1A｜textMuted #8A8A8A｜onPrimary #FFFFFF
渐变 #1A1A1A→#3D3D3D(135°)｜图表 [#111111, #E63946, #8C8C8C, #525252, #BFBFBF, #D9D9D9]
注意：accent 红只做小面积点睛（数字/下划线），大面积保持黑白灰。

## indigo-gradient 靛蓝渐变（浅色）— 产品发布 / 技术布道 / AI 主题
bg #F5F6FF｜surface #FFFFFF｜primary #4F46E5｜secondary #7C3AED｜accent #06B6D4｜text #1E1B4B｜textMuted #6D6A8A｜onPrimary #FFFFFF
渐变 #4F46E5→#7C3AED(135°)｜图表 [#4F46E5, #7C3AED, #06B6D4, #F59E0B, #EC4899, #6366F1]

## cream-notes 奶油手账（浅色）— 教学讲义 / 读书分享 / 轻科普
bg #FDF8EF｜surface #FFFDF7｜primary #9C6B3F｜secondary #C79A62｜accent #6E8B5E｜text #3E3428｜textMuted #8C7F6E｜onPrimary #FFFDF7
渐变 #C79A62→#9C6B3F(135°)｜图表 [#9C6B3F, #C79A62, #6E8B5E, #B0563F, #D9B67E, #8A8F6C]
注意：onPrimary 为奶油白（非纯白），浅色卡上文字一律用 text 色。

## forest-ink 墨绿学术（浅色）— 学术答辩 / 研究汇报 / 环保主题
bg #F6F8F4｜surface #FFFFFF｜primary #1F4D3A｜secondary #3E7C5B｜accent #C9A227｜text #22302A｜textMuted #6B7A70｜onPrimary #FFFFFF
渐变 #1F4D3A→#2F4858(135°)｜图表 [#1F4D3A, #3E7C5B, #C9A227, #2F4858, #8FAF9B, #5F7470]

## navy-gold 藏蓝鎏金（深色）— 年度盛典 / 对外答谢 / 高端汇报
bg #0E1A2B｜surface #16263C｜primary #C9A24B｜secondary #5B8BBE｜accent #E0BC6D｜text #F2F0E9｜textMuted #9AA5B1｜onPrimary #14243A
渐变 #12233B→#2C4A6E(135°)｜图表 [#C9A24B, #5B8BBE, #7BA7C9, #E0BC6D, #94A3B8, #3E5F7E]
注意：primary 是金色，主色块上文字用 onPrimary 深藏蓝；金色不做大面积底色。

## slate-orange 工业灰橙（浅色）— 制造工程 / 安全生产 / 运营看板
bg #F3F4F5｜surface #FFFFFF｜primary #37474F｜secondary #546E7A｜accent #F4511E｜text #263238｜textMuted #78909C｜onPrimary #FFFFFF
渐变 #37474F→#546E7A(135°)｜图表 [#F4511E, #37474F, #546E7A, #FF8A65, #90A4AE, #6D4C41]
注意：accent 橙承担警示语义（风险/告警/重点指标），不要当装饰色滥用。

## 用色纪律

- 一页上的颜色 ≤4 种（bg/surface 不计）：primary + secondary + accent + text 系。
- accent 只用于小面积：数字、图标、下划线，不超过版面 5%。
- 大面积对比：浅色主题正文区永远浅底深字；不要在浅色页放深色卡片（surface 除外）。
- 渐变只用于封面/章节页背景与 hero 区块，内容页保持素底。
- 用户要自定义时，在 ppt_brief_create 的 paletteOverrides 覆盖并保持上述键名，锁定后进入 tokens。
