# DSH 插件目录（plugins/）

本目录放置 **DSH（DeepSeek Harness）宿主的 cordis 插件**。每个插件一个独立子目录，
自带 `package.json` 与依赖清单，独立安装构建（DSH 根的 pnpm workspace 不包含
`plugins/*`——插件不并入宿主依赖树，避免相互污染）。

## 目录形态约定

本目录只保留**功能代码与文档**（`src/`、`skills/`、`docs/`、配置与说明文件）。
以下内容**不入库、不同步**：

- `node_modules/` —— 依赖在本目录内 `npm install` 现场安装；
- `test/` 与 `vitest.config.ts` —— 测试代码留在开发源仓库；
- `lib/` —— TypeScript 构建产物（`npm run build` 现场生成）；
- `ppt-studio/` 等运行时生成的用户数据目录。

## 插件清单

### dsh-ppt-studio（v0.10.0）

结构化演示文稿（PPT）生成工作室，cordis 插件形态（`ctx.tools.register`，19 个 `ppt_*` 工具）。
把一次 PPT 制作拆成 0–8 九个阶段：简报（听众/场景/目标/时长/生成模式/渲染路线）→
叙事架构（核心主张+问题链）→ 页数与分配 → 页面蓝图（每页意图/信息结构/叙事衔接/证据条目）→
锁定设计（配色/字体/锚点令牌 + Prototype 代表页）→ 逐页生成（确定性版式校验）→
全册集成校验（叙事链自审 + 时长估算）→ HTML 所见即所得预览 + 可编辑 PPTX → 依赖感知修改循环。

- **生成模式**：quick（打包一次确认）/ standard（逐阶段，默认）/ precise（+Prototype 真实页确认）；
  确认点唯一开关是 `confirmStages`，mode 只是预设捷径。
- **渲染路线**（0.10.0）：`native`（默认，pptxgenjs 原生元素逐个可编辑 + 全部版式规则保护）/
  `svg`（自由 SVG 绘制，PPTX 端整页矢量图嵌入 PowerPoint 2016+，版式确定性规则不适用）。
- **内网红线**：全部产物自包含无外链（图片只走资产登记/生图接口/占位框）；
  证据来源只能来自用户提供的材料，禁止联网取数与编造引用。
- 当前规模：19 个工具、12 套主题、17 种页型、40 条确定性校验规则、168 项单测（开发源）。

| 入口 | 位置 |
|---|---|
| 模型操作手册（SOP） | `dsh-ppt-studio/skills/dsh-ppt-studio/SKILL.md` |
| 权威流程文档 | `dsh-ppt-studio/docs/generation-flow.md` |
| 插件说明（特性/配置/修复记录） | `dsh-ppt-studio/README.md` |

### 安装与构建

```bash
cd plugins/dsh-ppt-studio
npm install        # 安装依赖（pptxgenjs / zod / fflate 等）
npm run build      # TypeScript 编译到 lib/（DSH 宿主加载 lib/ 入口）
npm run preview    # 可选：启动预览服务（node lib/preview-server.js）
```

### dsh-passwords（v2.7.1）

服务器级认证网关插件（GPL-3.0，**入库与再发布必须保留其 `LICENSE`**）：登录页 +
主/子用户多租户 + 权限配额 + 审计加密 + 可选自动 HTTPS。解决 DSH 0.1.5-rc.2 浏览器
会话认证（browser-auth）导致的远程访问 401：插件在 dsh 进程内加载，启动时自动用
launch token 换取 authority 绑定 Cookie，网关注入后反代全部 HTTP/WS 路径。

- 来源：<https://github.com/slywalker2006/dsh-passwords>（v2.7.1 发布形态副本，剔除 `test/`）
- 集成方式：`docker/Dockerfile` 构建 `dist/`，`docker/entrypoint.sh` 在启动时
  `docker-init` → `scripts/register-plugin.mjs` 精确注册 → `cli.js patch` 打补丁，
  网关随 `dsh web` 自启动，监听 0.0.0.0:8080 反代到回环 nginx。
- 状态目录 `/data/dsh-passwords`（`.env`/SQLite/证书），挂卷持久化。

```bash
cd plugins/dsh-passwords
npm ci             # 按 npm-shrinkwrap.json 复现安装
npm run build      # tsc + 客户端打包到 dist/
```

## 与开发源仓库的同步

本目录内容是开发源仓库的**发布形态副本**（按上述约定剔除依赖/测试/产物）。
开发、改码、跑测试都在源仓库进行：

- 开发源：`D:\proj\zcode\dshProj\dsh-ppt-studio`（含完整 `test/`，168 项单测）
- 修改源仓库后，重新同步到本目录：

```bash
cd /d/proj/zcode/dshProj/dsh-ppt-studio
tar cf - --exclude='./node_modules' --exclude='./test' --exclude='./lib' \
  --exclude='./ppt-studio' --exclude='./vitest.config.ts' . \
  | (cd /d/proj/zcode/dshProj/deepseek-harness/plugins/dsh-ppt-studio && tar xf -)
```

同步后用 `diff -r`（带同样排除项）可验证两边功能代码与文档完全一致。
