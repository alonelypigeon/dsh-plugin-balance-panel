# dsh-plugin-balance-panel

DeepSeek Harness cordis 插件：**通用型多 provider 余额/用量面板** —— 查询各主流 API 账户余额与 Coding Plan 用量，并统计每日金额花费与 Token 消耗，右下角挂一枚**液态玻璃气泡**（点击展开明细面板）。

- `/balance [KEY_ENV]` — 汇总所有已配置余额 provider 的余额（指定 KEY_ENV 时按 DeepSeek 格式查询单个凭证）
- `/plan` — 汇总所有已配置的 Coding Plan 用量（5h 滚动 / 每周 / 每月）
- 右下角气泡 + 点击展开的明细面板（按 provider 分区）
- **每日花费统计图**（近 14 天，金额）与**每日 Token 消耗图**（近 14 天，tokens）

## 支持的 provider

只需在 `$DSH_HOME/.credentials.yaml` 或进程环境变量里配置对应凭证，插件自动探测并显示已配置的 provider（未配置的自动隐藏，无需任何插件配置）：

| provider | 类型 | 凭证环境变量 | 余额/用量端点（默认） | baseUrl 覆盖 |
|---|---|---|---|---|
| DeepSeek API | 余额 | `DEEPSEEK_API_KEY` | `GET /user/balance` | `DEEPSEEK_API_BASE` |
| Moonshot (Kimi) | 余额 | `MOONSHOT_API_KEY` | `GET /v1/users/me/balance` | `MOONSHOT_API_BASE` |
| 智谱 GLM | 余额 | `ZHIPU_API_KEY` | `GET /api/paas/v4/balance` | `ZHIPU_API_BASE` |
| OpenRouter | 余额 | `OPENROUTER_API_KEY` | `GET /api/v1/credits` | `OPENROUTER_API_BASE` |
| OpenCode Go | Coding Plan 用量 | `OPENCODE_GO_API_KEY` | `GET /v1/usage` | `OPENCODE_GO_API_BASE` |

> OpenAI / Anthropic / Gemini 等按量后付费服务没有公开的余额查询端点，无法内置；
> 如需展示，可先用任一余额 provider 的网关/中转（如 OpenRouter、Kimi、智谱）。

## GUI

- **气泡（折叠态）**：液态玻璃质感（毛玻璃 + 高光），内装水；水位 = Coding Plan 剩余用量（100 − 月用量），未配置 plan 时显示第一个余额 provider 的余额；水色按剩余量渐变（充足蓝 → 告警黄 → 耗尽红）；DSH 推理/流式输出期间水面波动；可拖动（位置记忆），点击打开面板（Enter/Space 键盘亦可）。
- **面板（展开态）**：按 provider 分区排列 —— 每个余额 provider 一张卡片（账户可用状态 + 各币种总额/赠送/充值 + 该 provider 的每日花费图），每个 Coding Plan provider 一组用量窗口（进度条 + 重置倒计时）；面板底部是**每日 Token 消耗图**；头部可拖动，位置独立记忆（默认右下角锚定，不超出屏幕；记忆位置超出视口时自动钳回）；Esc 或 × 收起。
- 每 30s 自动刷新（失败时 10s 快速重试，恢复后回到 30s；已有数据时后台刷新不闪烁「加载中」），可手动刷新；**页面隐藏时暂停轮询，恢复可见立即刷新**。
- **陈旧回退**：某 provider 上游查询失败但上次有成功数据时，面板继续显示上次数据并提示「数据可能已过期」，而不是整块报错；从未成功过才显示错误。
- **每日花费统计**：每次成功拉到余额时记录一个采样点（1 小时节流、保留 60 天），按「余额差分」估算每日花费（自动剔除充值影响），每个余额 provider 各自统计。
- **每日 Token 统计**：监听 DSH 会话事件里 provider 报告的真实 token 用量（`assistant/message` 的 `usage`），按自然日聚合。
- 统计数据持久化在 `$DSH_HOME/plugins/dsh-plugin-balance-panel/spend-history.json`（v2：按 provider 分桶 + tokens 字段，旧版自动迁移；可用 `DSH_BALANCE_SPEND_FILE` 覆盖），纯本地、不上传、无需平台 token。

数据来自插件注册的 `GET /plugins/balance/state`（exact 路由，优先于 client-modules 的 `/plugins` 前缀）：每个 provider 独立容错（一个查询失败不影响另一个分区），结果带 5s TTL 内存缓存 + 并发 single-flight（多视图轮询不会重复打上游），响应带 `cache-control: no-store`，非 GET 请求返回 405。

## 凭证

- 通过 DSH 的 credentials 服务解析（`ctx.credentials.resolve`），支持 `$DSH_HOME/.credentials.yaml` 与进程环境变量；密钥绝不出现在对话、日志或任何 HTTP 响应中。
- **自动探测**：插件用 `ctx.credentials.describe`（只返回是否已配置，不暴露值）判断每个 provider 是否启用 —— 配置了凭证的 provider 才会被查询与展示。
- 各 provider 的端点 baseUrl 可用上表的环境变量覆盖（如 `MOONSHOT_API_BASE`），无需改代码。

## 输出示例

```
DeepSeek API：账户可用：是
  CNY：总额 110.00（赠送 10.00 + 充值 100.00）
Moonshot (Kimi)：账户可用：是
  CNY：总额 55.50（赠送 5.00 + 充值 50.50）
OpenCode Go：每月 97%（5h 16% / 每周 12%）
```

```
OpenCode Go 套餐用量：
5h 滚动：16%，2026-08-14 11:54 重置
每周：12%，2026-08-17 08:00 重置
每月：97%，2026-08-21 19:08 重置
```

## 实现机制

- **host half**：`/balance`、`/plan` 命令（dsh-commands 契约，`{ kind, text }` 结果）+ 数据路由（dsh-host-webserver 的 exact 路由）。所有注册（命令、路由、`session/event` 监听）包在 `ctx.effect` 生命周期里 —— 插件停止 / HMR 重载时自动注销，重载不会因 exact 路由重名而失败。
- **适配器表**：每个 provider 一个适配器（id/label/kind/keyEnv/path/defaultBase/parse），baseUrl 支持 `<ID>_API_BASE` 覆盖；响应解析统一为 `balances[]` / `windows[]` 两种结构，解析失败只影响该 provider。
- **client half**：注册进 `shell.overlay`（list/root，`order: 110`）；样式用 DSH 设计 token（`--dsw-alias-*`）自动适配深浅主题，`<style>` 注入带 `data-plugin` 去重守卫；插件自身 DOM 的 mutation 被过滤，不干扰推理中检测。
- **取消语义**：命令调用方的 `AbortSignal` 与 10s 上游超时合并（`AbortSignal.any`），取消时返回「操作已取消」。

## 与同品类插件的差异（调研结论）

对 DSH / cordis / 相邻生态（Koishi、OpenCode、Pi）的同类余额插件调研后，本插件的定位与取舍：

| 能力 | 本插件 | 说明 |
|---|---|---|
| **多 provider 余额（DeepSeek/Kimi/智谱/OpenRouter）** | ✅ | 凭证自动探测，未配置即隐藏 |
| **Coding Plan（OpenCode Go）用量窗口** | ✅ 独有 | 5h 滚动 / 每周 / 每月 + 重置倒计时 |
| 气泡 + 可拖拽面板形态 | ✅ 独有 | 其他插件走统计条/侧边栏/文字命令 |
| provider 独立容错 + 陈旧回退 | ✅ | 失败时回退上次成功数据并标记 stale，不把面板打成错误态 |
| 每日金额花费图（近 14 天） | ✅ 本地估算 | 余额差分 + 充值剔除，无需平台 token |
| **每日 Token 消耗图（近 14 天）** | ✅ 真实数据 | 来自 DSH 会话事件中 provider 报告的 usage |
| i18n（zh/en 随 DSH 语言切换） | ✅ | 见「国际化」一节 |
| 页面隐藏时暂停轮询 | ✅ | 恢复可见立即刷新 |

调研对象（同品类）：npm `dsh-balance`（统计条余额 + 会话估算）、`dsh-balance-meter`、`koishi-plugin-deepseek-usage`（花费图表）、`opencode-provider-balance`（TUI 侧边栏）。**注意 npm 上的 `dsh-balance` 已被同名插件占用**，本插件按 DSH 生态惯例命名为 `dsh-plugin-balance-panel`（`dsh-plugin-*` 前缀）。

## 国际化（i18n）

- **GUI 全量中英双语**：气泡与面板的所有文案走 DSH 的 locale namespace（`balance`，zh 为键集源、en 逐键对照，与上游 `dsh-client-locale` 约定一致）；槽位注册声明 `locale: 'balance'`，框架把绑定该 namespace 的 `t()` 注入组件 props，随 DSH「设置 → 语言」即时切换，无需重启。
- 用量窗口标签按 `key`（`rolling` / `weekly` / `monthly`）翻译，不直接展示 host 下发的 label。
- **host 命令输出保持中文**：上游 DSH 没有 host 侧运行时 i18n 服务（官方插件同样硬编码），按仓库 Chinese-first 约定以中文为命令输出语言；命令 `description` 为英文（命令注册表发现 UI 的惯例）。

## 兼容性

- 平台：DSH web（`dsh web`），`dsh.client.platform = "web"`。
- peerDependencies：
  - `@deepseek-ai/cordis` `^4.0.1`
  - `@deepseek-ai/dsh-commands` `^0.1.0-rc.6`（`/balance`、`/plan` 注册契约）
  - `@deepseek-ai/dsh-credentials` `^0.1.0-rc.6`（凭证解析）
  - `@deepseek-ai/dsh-host-webserver` `^0.1.0-rc.6`（数据路由）
  - `@deepseek-ai/dsh-client-locale` `^0.1.0-rc.6`（locale namespace / `t()` 注入）
  - `@deepseek-ai/dsh-client-ui-slots` `^0.1.0-rc.6`（槽位契约）
- client 声明：`inject: ['slots', 'locale']`（服务级依赖），包级 `dsh.client.inject` 指向 `@deepseek-ai/dsh-client-locale` 与 `@deepseek-ai/dsh-client-ui-slots`（模块表静态词）。
- 对上游的依赖仅限上述公开契约与各家官方余额/用量接口（见「支持的 provider」表）；接口端点或格式变化时，该 provider 独立报错并可用 baseUrl 环境变量覆盖。

## 安装

### 方式一：DSH CLI 安装（推荐）

```sh
dsh plugin add dsh-plugin-balance-panel
```

（使用特定 profile 时加 `--profile <name>`；该命令依赖 pnpm，环境里没有时改用方式二。）

### 方式二：从 npm 安装

```sh
npm install -g dsh-plugin-balance-panel   # 或装进 profile 的 node_modules
```

### 方式三：手动拷贝

构建后把整个插件目录复制到 profile node_modules：

```sh
cp -r dsh-plugin-balance-panel ~/.dsh/profiles/node_modules/
```

然后在 `cordis.patch.yml` 追加：

```yaml
- insert:
    - id: balance
      name: dsh-plugin-balance-panel
```

重启 DSH 后输 `/balance`、`/plan` 验证；右下角气泡与面板共用同一数据路由。

## 开发与构建

client half 必须打包成 `window.__ModuleLoader__.load({ id, factory })` 形式才能被
web 前端加载（`dsh-client-modules` 的 Node half 会扫描 loader 树里 enabled 插件，
resolve `exports["./client"]` 并 serve 进 `/plugins` boot graph）。

```sh
npm install            # devDependencies: esbuild（+ host 测试所需的 dsh-credentials/cordis）
npm run bundle         # scripts/bundle.mjs：esbuild 打包 → lib/client.js
npm test               # node --test：host 命令/路由契约测试 + client bundle 契约测试
npm run check          # node --check index.js + lib/client.js 语法校验
npm run preflight      # 发布/部署前预检（files 完整性 / bundle 契约 / 陈旧产物守卫 / i18n 键集）
npm run smoke          # 冒烟：mock ctx 实测已安装到 ~/.dsh/profiles 的实例（真实网络，需凭证文件）
```

> host 测试不依赖真实网络：用 mock cordis ctx + mock `fetch` 实测命令、路由缓存、
> single-flight、provider 独立容错与陈旧回退；client 测试在 vm 沙箱里验证
> `__ModuleLoader__` 契约。

### 本地验证（改完即见）

把构建产物**原子化**同步到运行中的 DSH profile 并刷新页面（`npm run sync`：
先写临时文件再按「元数据先、bundle 后」顺序 rename，避免热载不一致的半成品；
可用 `DSH_PROFILE_NODE_MODULES` 覆盖 profile 路径）：

```sh
npm run sync
```

刷新浏览器后 boot manifest 的 rev 变化即说明新 bundle 已被 serve（同步时可传
web 地址作为参数，脚本会打印新旧 boot rev）。

## 发布

> **当前状态：测试期私密发布。** `package.json` 标记了 `"private": true`，
> 不会（也不应）发布到公共 npm。测试期请用本地路径或 git 依赖安装：

```sh
dsh plugin --profile web add file:<本仓库路径>          # 本地路径安装
# 或作为 git 依赖（私有仓库需 npm 凭证）：
npm install git+https://<私有仓库地址>.git
```

插件转入稳定后：移除 `"private": true`，再执行 `npm publish`
（`prepublishOnly` 自动执行 preflight + 全量测试，未通过会中止发布）。

发布内容由 `files` 字段控制：`index.js`、`lib/client.js`、`README.md`、`LICENSE`
（源码与构建脚本、测试不随包发布）。

## 文件

```
index.js                 host half（命令 + 数据路由 + 凭证解析 + 缓存/陈旧回退/并发控制）
src/client.jsx           client 源码（气泡 + 面板 + zh/en 字典）
lib/client.js            client bundle（构建产物，勿手改）
scripts/bundle.mjs       本地构建脚本（esbuild）
scripts/preflight.mjs    发布/部署预检（含陈旧 bundle 守卫与 i18n 键集一致性）
scripts/sync-profile.mjs 原子化同步到 DSH profile
test/host.test.mjs       host 契约测试（mock ctx + mock fetch）
test/client.contract.test.mjs  client bundle 契约测试（vm 沙箱）
LICENSE                  MIT
```
