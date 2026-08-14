# Changelog

独立仓库：DeepSeek Harness cordis 插件（多 provider 余额/用量 + 每日花费与 Token 统计面板）。

## [0.3.0] - 测试中

- **通用化**：适配器表支持多种主流 API 余额与 Coding Plan 用量——
  DeepSeek / Moonshot (Kimi) / 智谱 GLM / OpenRouter（余额）+ OpenCode Go（用量）；
  凭证自动探测（`describe` 不暴露值），未配置的 provider 自动隐藏；
  baseUrl 可用 `<ID>_API_BASE` 环境变量覆盖。
- **每日 Token 统计**：监听 `session/event` 的 `assistant/message` usage，
  按自然日聚合 provider 报告的 token 消耗，面板新增 Token 柱状图；
  与每日金额花费一同持久化。
- 花费历史文件升级为 v2（按 provider 分桶 + tokens 字段），旧版纯数组自动迁移。
- `/balance`、`/plan` 汇总所有已配置 provider（部分失败行内提示，全部失败才报错）。

## [0.2.0] - 测试中

- 按 DSH 生态惯例改名：`dsh-balance-panel` → `dsh-plugin-balance-panel`
  （client bundle id、localStorage 键、花费历史路径同步更新；
  旧花费历史文件自动迁移到新路径）。
- 标记 `"private": true`：测试期私密发布，不推公共 npm。

## [0.1.0] - 早期迭代

- `/balance`、`/plan` 命令 + 右下角可拖拽悬浮面板（余额明细 + Coding Plan 用量）。
- 早期版本无变更记录。
