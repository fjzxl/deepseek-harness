# 校验规则分级原则（为什么是这个级别）

> 配套 `docs/generation-flow.md` 第六节规则全集。每条规则一句话说明"为什么定在这个级别"。

## 三条元原则（0.9.0：规则还在长，原则不再长）

1. **确定性优先**：能纯代码判定的绝不靠模型自觉（几何/数据形状/引用存在性 = error）。
2. **任何降级必须显式知情**：绕过预算/闸门/来源纪律的每条通道都要落痕迹（reason、allowDrop 确认、strictness 档位），issue 里展示给用户——没有静默豁免。
3. **关系看双边，内容看单边**：页内容变更重检该页（pageHash）；页间关系（transition/页序）变更必须放大到叙事链自审（outlineChanged 信号）。

## 知情放行通道对照（统一协议，各管一个维度）

| 通道 | 维度 | 形态 | 落痕迹方式 |
|---|---|---|---|
| densityOverride | 认知负荷 | 页级 `{reason}` | DENSITY/BULLET 降 info，理由随 issue 展示 |
| allowDrop / remove | 数据安全 | 写页参数 | remove=显式删除名单；allowDrop=true 才放丢元素，issue 记录 |
| strictness | 质量分级 | deck 级三档 | strict 升 error / relaxed 降 info，级别浮动可解释 |
| evidenceLevel + referenceMaterials | 可信度 | deck 级三档 + 材料清单 | 提供清单后来源必须引用条目，违规 error |

## 分级原则

| 级别 | 判定标准 | 处置 |
|---|---|---|
| **error** | 渲染必然失败或产生结构性错误：几何越界、文本互压、引用不存在的资产、数据形状非法——继续走只会产出废页 | 拒绝落盘 / 拒绝渲染 |
| **warning** | 影响质量但可继续：可读性、美观、越出锁定令牌、认知超载——需要知情并取舍 | 允许继续，必须向用户说明 |
| **info** | 建议性：估算类（时长）、节奏类（视觉节奏）、叙事缺口提示——供参考与自审 | 展示即可 |

三条浮动规则（不改变规则本身，只调级别）：
- `strictness: "strict"`：TOKEN_COLOR / TOKEN_FONT / EVIDENCE_SOURCE_MISSING 升 error（品牌一致性/学术场景"越锁即错"）。
- `strictness: "relaxed"`：认知负荷类 8 条降 info（草稿快速产出不刷屏）。
- 简报提供 `referenceMaterials` 清单时：EVIDENCE_SOURCE_MISSING 升 error（来源必须引用用户材料）。

## 单页规则

| 规则 | 级别 | 为什么 |
|---|---|---|
| ID_DUPLICATE | error | 同页元素 ID 冲突使后续 append/替换定位失效，结构性错误 |
| ELEMENT_COUNT | warning | 元素过多只是"版面可能过碎"，不是必然失败；结构化页型已放宽到 24 |
| OUT_OF_BOUNDS | error | 内容元素越出安全区必然被裁切/贴边，渲染结果确定错误 |
| BG_OUT_OF_CANVAS | warning | 背景装饰有意出血是合法画法，只拦"出得太多" |
| TEXT_OVER_TEXT | error | 文本互压意味着两段字都读不了，必然废页 |
| ELEMENT_OVERLAP | warning | 叠放可能是卡片衬底忘标 background:true，也可能是有意分层——需知情判断 |
| FONT_TOO_SMALL | error | <10pt 在投影场景物理不可读，等于没写 |
| READABILITY | warning | 11–13pt 是"勉强能读"，来源注释等场景合法，知情即可 |
| TEXT_SEVERE_OVERFLOW | error | 估算容量超 50% 必然截断丢字，产出确定残缺 |
| TEXT_OVERFLOW_RISK | warning | 超 15% 是"可能溢出"（估宽有误差），给修正机会 |
| IMAGE_SOURCE_INVALID | error | assetId/placeholder 二选一是数据形状约束，违反即渲染无法处理 |
| ASSET_MISSING | error | 引用未登记资产必然渲染失败 |
| IMAGE_DISTORTION | warning | fit=fill 拉伸是"画面难看"不是失败 |
| TABLE_FONT_SMALL | error | <9pt 表格在投影上不可读 |
| TABLE_READABILITY | warning | 9–10pt 建议放大，知情即可 |
| TABLE_RAGGED | error | 各行列数不齐是数据形状非法 |
| CHART_SHAPE_MISMATCH | error | 系列长度≠labels 是数据形状非法，图表必然画错 |
| CHART_PIE_MULTI_SERIES | error | 饼图多系列语义不成立 |
| CHART_ALL_ZERO | warning | 全零系列画得出来但无信息量，提示数据可能填错 |
| CHART_CATEGORY_CROWD | warning | 饼/环 >6 类扇区过窄标注不下、占比难比较——可读性问题（改条形或合并长尾即可修复） |
| CHART_LEGEND_REDUNDANT | info | 单系列图例只重复系列名，冗余不碍事——提示性建议，标题点名更省版面（饼/环图例承载类别名，不适用） |
| TOKEN_COLOR | warning | 越出锁定色板破坏品牌一致性，但页面本身能渲染（strict 下升 error） |
| TOKEN_FONT | warning | 同上——字体越锁是品牌问题不是渲染失败（strict 下升 error） |
| DENSITY_WITH_VISUAL | warning | 有图页文字超预算是"观感与认知负荷"问题；页级 density 系数与 densityOverride 可知情放宽 |
| BULLET_BUDGET_EXCEEDED | warning | 要点超限是认知负荷上限；densityOverride 可知情豁免 |
| EVIDENCE_SOURCE_MISSING | warning | 数字论断缺来源是可信度问题不是渲染问题；提供材料清单或 strict 时升 error。清单下优先 materialId 精确匹配（id 命中才算引用，标题子串仅兼容兜底） |
| VISUAL_PLAN_UNMET | warning | 蓝图承诺配图但页面没落实——计划与实现不一致，需知情 |
| STRUCTURE_TYPE_MISMATCH | warning | 信息结构与页型错配是"讲法不对"不是画不出来；提示同步蓝图或换页型 |
| SVG_VIEWSIZE | error | svg 路线页画布与 deck 画布不同比例会整体拉伸错位——形状非法（0.10.0） |
| SVG_UNSAFE | error | 脚本/事件属性/foreignObject/外链是安全面与内网红线问题，无商量余地（0.10.0） |
| PAGE_SCENE_INVALID | error | 页面文件既无 elements 也无 svg = 数据损坏兜底，重新写页即可修复（0.10.0） |

## 全册规则

| 规则 | 级别 | 为什么 |
|---|---|---|
| PAGE_MISSING | error | 大纲页未写入——deck 不完整，渲染即缺页 |
| PAGE_ORPHAN | warning | 页面不在大纲中只是不参与渲染，可能是手动实验残留 |
| LAYOUT_MONOTONY | warning | 连续 3 页同页型是观感问题 |
| TYPE_DIVERSITY | warning | 页型单一同上 |
| VISUAL_RHYTHM | warning | 连续 4 页无图是节奏问题 |
| NARRATIVE_CHAIN_MISSING | warning(info) | strictness=strict 时叙事链必填（缺承接=断链风险，warning）；其余档链已建立时缺口只提示 info。0.9.1 起分级只认 strictness——mode 只决定确认点 |
| TITLE_TAKEAWAY | warning | 标题不是结论影响"只读标题拼故事"的体验，不阻断 |
| DECK_DURATION_MISMATCH | info | 时长是估算值（文字量近似），偏差提示供精简参考 |
| PAGE_ELEMENTS_DROPPED | error | 整页替换丢元素=数据丢失（两起真实事故后从 warning 升级）；allowDrop 显式确认或 remove 显式删除后放行 |
