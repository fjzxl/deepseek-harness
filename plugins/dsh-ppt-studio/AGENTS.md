# AGENTS.md — dsh-ppt-studio 贡献规则

## 硬规则：改生成逻辑必须同步文档

每次修改 PPT 生成逻辑（新增/改名/删除工具、改阶段行为、改校验规则、改状态机、改配置项），必须在**同一次改动**里同步四层文档：

| 文档 | 受众 | 必须同步的内容 |
|---|---|---|
| `skills/dsh-ppt-studio/SKILL.md` | 模型（操作手册） | 阶段流程、工具用法、常见错误表 |
| `docs/generation-flow.md` | 人（权威流程文档） | 对应阶段小节正文、规则全集、状态机、规模数字、版本演进表 |
| `README.md` | 仓库访客 | 特性列表、工具表、版本史 |
| `package.json` + `src/version.ts` | 版本 | 版本号一起升（`test/resilience.test.ts` 校验两者一致，漏改会挂） |

**漂移会被测试拦住**：`test/docs-sync.test.ts` 断言每个注册工具名都出现在 SKILL.md、README、generation-flow.md 中，且文档标注的工具数与 `buildPptStudioTools` 实际数量一致。改了逻辑没改文档 → `npm test` 红。

## 其他约定

- 校验器只写确定性规则（纯代码、无 LLM 调用）；需要语义判断的检查一律进 SKILL.md 当模型指引，不进 validate.ts。
- 流水线阶段编号 0–8；新增阶段先在 generation-flow.md 画进总览图再动代码。
- 每个版本在 README「修复记录」与 generation-flow.md「版本演进」各加一行（做什么、为什么、回归结果）。
- 测试全局 setup（`test/setup.ts`）已隔离工作区注册表与浏览器自动打开，新测试不要绕过。
- 回归入口：`npm run build && npm test && npm run demo`。
