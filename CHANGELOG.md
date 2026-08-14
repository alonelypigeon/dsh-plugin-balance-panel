# Changelog

独立仓库：DeepSeek Harness cordis 插件（多 provider 余额/用量 + 每日花费与 Token 统计面板）。

## [0.3.1] - 2026-08-14

- **每日 Token 统计覆盖所有 session 的所有调用**：
  - 新增 token 聚合器（按 session × turn × step 去重）——同一次调用先到的
    `assistant/chunk` usage（流式尾部样本）与后到的 `assistant/message` usage
    （最终样本）只计一次（message 优先）；**失败/中断的调用**（无 message）
    在 `step/end` 时用 chunk 样本兜底提交，不再漏计。
  - 子 session（subagent）与主 session 独立累计、互不干扰；`turn/end` 释放去重状态。
- 修复 `recordTokenDay` 跨月裁剪错序缺陷：M-D 字符串比较在跨月时错乱
  （`'10-1'` 字典序小于 `'9-30'`），改为年内日序号比较。
- Token 归日改用事件自身 `time` 字段（贴近真实消耗时刻）。

## [0.3.0] - 2026-08-14

- **通用化**：适配器表支持多种主流 API 余额与 Coding Plan 用量——
  DeepSeek / Moonshot (Kimi) / 智谱 GLM / OpenRouter（余额）+ OpenCode Go（用量）；
  凭证自动探测（`describe` 不暴露值），未配置的 provider 自动隐藏；
  baseUrl 可用 `<ID>_API_BASE` 环境变量覆盖。
- **每日 Token 统计**：监听 `session/event` 的 `assistant/message` usage，
  按自然日聚合 provider 报告的 token 消耗，面板新增 Token 柱状图。
- **每日金额花费（注入口径）**：`花费 = max(0, max(0,Δ充值) + max(0,Δ赠送) − Δ总额)` ——
  消费无论从充值金还是赠送金扣减均正确计入，充值/发放本身不计费；
  跨天断档（页面未开）按覆盖天数均摊，避免花费堆到恢复日；
  历史采样自动按新口径重算。
- **`/stats [days]` 命令**：读取本地历史统计（每日 Token 消耗 + 各 provider 金额花费，
  支持 1-60 天窗口），与面板共用同一份持久化存储，无需联网。
- 花费历史文件 v2（按 provider 分桶 + tokens + currency 字段），旧版纯数组自动迁移。
- `/balance`、`/plan` 汇总所有已配置 provider（部分失败行内提示，全部失败才报错）。
- 新增 `scripts/demo-spend.mjs`（`npm run demo`）：mock 上游驱动完整路由链路，
  验证金额差分口径（消费扣充值金/赠送金、充值不计费、断档均摊）。

## [0.2.0] - 早期迭代（未发布）

- 按 DSH 生态惯例改名：`dsh-balance-panel` → `dsh-plugin-balance-panel`
  （client bundle id、localStorage 键、花费历史路径同步更新；
  旧花费历史文件自动迁移到新路径）。
- 标记 `"private": true`：走 git 依赖分发，不推公共 npm。

## [0.1.0] - 早期迭代（未发布）

- `/balance`、`/plan` 命令 + 右下角可拖拽悬浮面板（余额明细 + Coding Plan 用量）。
- 早期版本无变更记录。
