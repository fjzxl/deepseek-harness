# 动画预设目录（做动画的前置知识，0.21.0 P4）

> 现状：pptxgenjs 栈**不支持**动画（无法写 `<p:timing>`），本插件当前产物无动画。
> 本文把"真要做动画"需要的 OOXML 参数蓝图落成文档，避免将来重新调研。
> 数值事实 2026-09-25 从本地参考实现（AiPPT-main/static/animation.js，GPL——**只核对
> presetId/subtype 等数据事实，未拷贝任何代码**）与 ECMA-376 规范交叉核对。

## 一、落地路径（若将来做）

1. 渲染后 post-zip 注入：`renderDeckPptx` 产出 zip → `fflate`（已是依赖）解包 →
   按页把 `<p:timing>` 插入 `ppt/slides/slideN.xml`（位置：`<p:clrMapOvr>` 之后、
   `</p:sld>` 之前）→ 重新打包。与 0.17.2 光栅化同属"出 zip 后再加工"管线。
2. 数据面：PageScene 加可选 `animation` 字段（元素级 `{preset, subtype?, start?, durationMs?}`），
   sceneHash 照常覆盖；HTML 预览端可选 CSS animation 近似（或预览不放动画，PPTX 独有）。

## 二、`<p:timing>` XML 骨架（单元素单击入场，标准结构）

```xml
<p:timing>
  <p:tnLst>
    <p:par>
      <p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot">
        <p:childTnLst>
          <p:seq concurrent="1" nextAc="seek">
            <p:cTn id="2" dur="indefinite" nodeType="mainSeq">
              <p:childTnLst>
                <!-- 每个动画一个 <p:par>（nodeType=clickEffect），内部三层 par 嵌套：
                     clickPar(clickEffect) → withGroup(withEffect) → 对应 cTn 动画节点 -->
              </p:childTnLst>
            </p:cTn>
            <p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>
            <p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>
          </p:seq>
        </p:childTnLst>
      </p:cTn>
    </p:par>
  </p:tnLst>
</p:timing>
```

元素动画节点（在 clickEffect 的 childTnLst 里）两种核心形态：

- 入场 fade（presetId 10）：`<p:animEffect transition="in" filter="fade">` + `<p:set>`（入场前 visibility hidden）
- 入场 flyIn（presetId 2，自底部 subtype 4）：`<p:anim calcmode="lin" valueType="num">` 对 ppt_x/ppt_y 从屏外到原位插值 + `<p:set>` visibility

## 三、presetClass / presetId 事实表

三类同编号、语义相反：`entr`（入场）/ `emph`（强调）/ `exit`（退场）。

| presetId | 名称（entr 语义） | emph 语义 | exit 语义 |
|---|---|---|---|
| 1 | 出现（appear） | （无 emph） | 消失 |
| 2 | 飞入 flyIn | （无 emph） | 飞出 flyOut |
| 3 | 百叶窗 blinds | 百叶窗 | 百叶窗 |
| 4 | 盒状 box | 盒状 | 盒状 |
| 5 | 棋盘 checkerboard | 棋盘 | 棋盘 |
| 6 | 圆形扩展 circle | 圆形扩展/更改填充颜色族 | 圆形扩展 |
| 7 | 缓慢进入 | （emph 族） | 缓慢移除 |
| 8 | 菱形 diamond | （emph: 变化字体颜色族等） | 菱形 |
| 9 | 向内溶解 dissolve | （emph） | 向外溶解 |
| 10 | 渐变/淡入 fade | 透明度 | 渐变/淡出 |
| 11 | 闪烁一次 | （emph） | 闪烁一次 |
| 12 | 切入 peek | （emph） | 切出 |
| 13 | 十字形扩展 plus | （emph） | 十字形扩展 |
| 14 | 随机线条 random bars | （emph） | 随机线条 |
| 16 | 劈裂 split | （emph） | 劈裂 |
| 17 | 层叠 strips | （emph） | 层叠 |
| 18 | 阶梯状 stair | （emph） | 阶梯状 |
| 19 | 轮 rotate | （emph） | 旋转 |
| 21 | 轮子 wheel | （emph） | 轮子 |
| 22 | 擦除 wipe | （emph） | 擦除 |
| 23 | 缩放 zoom | 放大/缩小 grow&shrink | 缩放 |
| 26 | 弹跳 bounce | （emph） | 弹跳 |
| 42 | （entr） | （emph: 跷跷板等） | — |
| 47 | 浮动 float | （emph） | 浮动 |

（表按参考实现全量 75 项抽取整理为常用 24 项；空白处为该编号在该类无预设。
**实施前以真实 PowerPoint 生成样本反向核对为准**——编号跨版本有个别漂移。）

## 四、presetSubtype（方向编码，1-8 罗盘序）

| 值 | 方向 | 值 | 方向 |
|---|---|---|---|
| 1 | 自顶部 Top | 5 | 自右下 BottomRight |
| 2 | 自右侧 Right | 6 | 自左侧 Left |
| 3 | 自右上 TopRight | 7 | 自左上 TopLeft |
| 4 | 自底部 Bottom | 8 | 自左下 BottomLeft |

另有非方向子类型：wipe/百叶窗的 水平/垂直、劈裂的四向展开等（值域 10-32 区段，实施时核对）。

## 五、startType / 时序参数

| startType | 语义 | OOXML 对应 |
|---|---|---|
| 1 | 单击时 onClick | nodeType="clickEffect" |
| 2 | 与上一动画同时 withPrevious | nodeType="withEffect" |
| 3 | 上一动画之后 afterPrevious | nodeType="afterEffect" |

- duration：毫秒（参考库默认 1000；快 500 / 慢 2000）
- delay：毫秒，`<p:cond delay="N"/>`
- 同页多元素按 mainSeq 子节点顺序播放

## 六、切场（transition，页面级）

`<p:transition>`（`<p:clrMapOvr>` 前）：`split/cut/wedge/pull/push/zoom/fade/...`，
如 `<p:transition spd="med"><p:push dir="l"/></p:transition>`；参数=方向 dir + 速度 spd(slow|med|fast)。

## 七、纪律建议（若做）

- 默认**无动画**交付；用户明确要才加（汇报场景动画常减分）
- 只开白名单：fade(10)/flyIn(2)/wipe(22)/zoom(23)/appear(1)，startType=afterPrev 串场
- 同页 ≤3 个动画、全册统一一种入场——与"版式词表纪律"同思路，词表越长弱模型越乱
