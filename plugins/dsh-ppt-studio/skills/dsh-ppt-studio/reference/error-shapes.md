# ppt_page_write 常见错误写法对照表

> 0.22.x 从 SKILL.md 下放（与工具 auto-fix/repairs 回执及写页语义段重复的预防性对照表）；手写 elements 前通读一遍，被拒时按行对照改。content 内容模式不受此表影响。

| ❌ 错误写法 | ✅ 正确写法 |
|---|---|
| `{"kind":"text","text":"标题",...}` 扁平 text 字段 | 文字必须放 `paragraphs` 数组：`{"kind":"text","paragraphs":[{"text":"标题"}],...}` |
| `"paragraphs": {"text":"…"}` 单对象 | `"paragraphs": [{"text":"…"}]` 数组 |
| `"runs":[{"text":2024}]` 数字 | `"runs":[{"text":"2024"}]` 字符串 |
| 颜色写成 `color: #1E4B8F`（未加引号） | `"color": "#1E4B8F"` 必须带引号，`#RRGGBB` 六位 |
| 元素缺 `kind` / `id` / `x,y,w,h` 任一 | 五类元素统一要求 `kind+id+x,y,w,h`，缺一拒绝 |
| 想补几个元素却只传新增部分（其余被整页替换丢掉） | 默认整页替换且**丢元素会被拒绝保存**：要么传完整元素清单，要么带 `"append":true` 只追加/替换改动元素，要么确认删除带 `"allowDrop":true` |
