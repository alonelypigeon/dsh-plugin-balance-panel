// @dsh-plugin-balance-panel —— DeepSeek Harness cordis 插件：账户余额 + Coding Plan 套餐用量。
//
//   /balance [KEY_ENV]   DeepSeek API 账户余额（默认凭证 DEEPSEEK_API_KEY）
//   /plan                OpenCode Go 订阅套餐用量（5h 滚动 / 每周 / 每月）
//
// 另为右侧 GUI 面板提供一个数据路由：GET /plugins/balance/state（exact 优先于
// client-modules 的 /plugins prefix），client half 的面板轮询它显示额度、余额与
// Coding Plan 用量。凭证通过 DSH 的 credentials 服务解析，绝不在任何响应里回显
// 密钥本身。
//
// 生命周期：所有注册（命令 ×2、路由 ×1）都包在 ctx.effect 里，插件停止/HMR
// 重载时自动注销 —— 路由是 exact 且重名即抛，不留 disposer 会直接让重载失败。
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const name = 'balance';
const inject = ['commands', 'credentials', 'webServer'];

const DEFAULT_KEY_ENV = 'DEEPSEEK_API_KEY';
const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const ZEN_GO_KEY_ENV = 'OPENCODE_GO_API_KEY';
const ZEN_GO_BASE_URL = 'https://opencode.ai/zen/go';
const FETCH_TIMEOUT_MS = 10000;
// GUI 路由的 5s TTL 内存缓存：面板每 30s 轮询、多个视图可能同时请求，
// 避免每次请求都打到上游接口；缓存冷时并发请求共享同一轮查询（single-flight）。
const STATE_CACHE_TTL_MS = 5000;

// —— 每日花费统计（本地余额差分估算）——
// 每次成功拉到余额时记录采样点 { t, total, topped }（取第一个币种）：1 小时节流
// （同一小时内就地更新）、只保留最近 60 天。每日花费按「相邻采样对」归属到
// 后一个采样所在日：spend = Δtopped − Δtotal（充值会使 total 上升，用 Δtopped
// 剔除充值影响），钳制 ≥ 0。无需平台 token，纯本地估算；持久化在
// $DSH_HOME/plugins/dsh-plugin-balance-panel/spend-history.json（可用
// DSH_BALANCE_SPEND_FILE 覆盖，测试用）。
const SPEND_SAMPLE_GAP_MS = 60 * 60 * 1000;
const SPEND_KEEP_MS = 60 * 24 * 60 * 60 * 1000;
const SPEND_CHART_DAYS = 14;

/** 花费历史文件路径（DSH_BALANCE_SPEND_FILE > 默认路径），含 0.2.0 改名迁移。 */
function resolveSpendFile() {
  const explicit = process.env.DSH_BALANCE_SPEND_FILE;
  if (explicit) return explicit;
  const base = join(dshHomePath(), 'plugins');
  const legacy = join(base, 'dsh-balance-panel', 'spend-history.json');
  const current = join(base, 'dsh-plugin-balance-panel', 'spend-history.json');
  // 一次性迁移：改名前（dsh-balance-panel）的历史文件带到新路径，避免花费图表清零。
  if (!existsSync(current) && existsSync(legacy)) {
    try {
      mkdirSync(dirname(current), { recursive: true });
      renameSync(legacy, current);
    } catch {
      /* 迁移失败按无历史处理 */
    }
  }
  return current;
}

/** 读取历史采样（文件缺失/损坏时回退空数组）。 */
function loadSpendSamples(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** 原子写入（tmp + rename）。失败只告警：花费统计是尽力而为的附加功能。 */
function saveSpendSamples(file, samples) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(samples), 'utf8');
    renameSync(tmp, file);
  } catch (e) {
    console.warn(`[dsh-plugin-balance-panel] 花费历史写入失败：${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 追加或节流更新一个采样点，并裁剪超出保留窗口的旧采样。 */
function recordBalanceSample(samples, now, total, topped) {
  const last = samples[samples.length - 1];
  if (last && now - last.t < SPEND_SAMPLE_GAP_MS) {
    last.t = now;
    last.total = total;
    last.topped = topped;
    return samples;
  }
  samples.push({ t: now, total, topped });
  const cutoff = now - SPEND_KEEP_MS;
  while (samples.length > 1 && samples[0].t < cutoff) samples.shift();
  return samples;
}

/** 近 N 天每日花费序列（从旧到新）：{ date: 'M-D', amount }。 */
function computeDailySpend(samples, now, days = SPEND_CHART_DAYS) {
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now - i * 86400000);
    out.push({ date: `${d.getMonth() + 1}-${d.getDate()}`, amount: 0 });
  }
  // 14 天窗口内 MM-DD 不会重复，可直接按日期字符串归并
  const index = new Map(out.map((r) => [r.date, r]));
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1];
    const b = samples[i];
    const spend = Math.max(0, (b.topped - a.topped) - (b.total - a.total));
    if (spend <= 0) continue;
    const d = new Date(b.t);
    const row = index.get(`${d.getMonth() + 1}-${d.getDate()}`);
    if (row) row.amount += spend;
  }
  for (const row of out) row.amount = Math.round(row.amount * 100) / 100;
  return out;
}

function ok(text) {
  return { kind: 'success', text };
}
function err(text) {
  return { kind: 'error', text };
}

// 校验 POSIX shell 标识符（credentialRef 的要求）
function isShellIdent(s) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
}

async function resolveCredential(ctx, keyEnv) {
  const ref = credentialRef(keyEnv);
  const hit = await ctx.credentials.resolve(ref);
  if (!hit) {
    throw new Error(`未找到凭证 ${keyEnv}。请在 .credentials.yaml 或进程环境变量中配置。`);
  }
  return hit.value;
}

// signal 为调用方的取消信号（命令面板的 AbortSignal）；取消与超时合并，
// 上游超时或用户取消都走同一错误路径，调用方按需区分。
// AbortSignal.any 需要 Node 20.3+，旧 Node（18/20.0）退回手动合并。
function mergeSignals(signal, timeoutMs) {
  if (!signal) return AbortSignal.timeout(timeoutMs);
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  }
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  timer.unref?.();
  return ctrl.signal;
}

async function httpJson(url, key, signal, timeoutMs = FETCH_TIMEOUT_MS) {
  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: mergeSignals(signal, timeoutMs),
    });
  } catch (e) {
    if (signal && signal.aborted) throw new Error('操作已取消');
    throw new Error(`请求失败：${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status !== 200) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      /* ignore */
    }
    throw new Error(`接口返回 HTTP ${res.status}${detail ? `：${detail}` : ''}`);
  }
  return res.json();
}

// —— DeepSeek 余额 ——

// 结构化查询：命令与 GUI 路由共用。
async function fetchBalanceData(ctx, keyEnv, signal) {
  const key = await resolveCredential(ctx, keyEnv);
  const base = (process.env.DEEPSEEK_API_BASE || DEFAULT_BASE_URL).replace(/\/+$/, '');
  return httpJson(`${base}/user/balance`, key, signal);
}

// —— OpenCode Go（Coding Plan 订阅套餐）用量 ——
//
// 端点：GET {base}/v1/usage（Bearer OPENCODE_GO_API_KEY），返回
// { usage: { rolling|weekly|monthly: { status, percent, resetsAt } } }。
// 未配置凭证时返回 { configured: false }，调用方静默跳过。

async function fetchCodingPlanData(ctx, signal) {
  let key;
  try {
    key = await resolveCredential(ctx, ZEN_GO_KEY_ENV);
  } catch {
    return { configured: false };
  }
  const base = (process.env.OPENCODE_GO_API_BASE || ZEN_GO_BASE_URL).replace(/\/+$/, '');
  let data;
  try {
    data = await httpJson(`${base}/v1/usage`, key, signal);
  } catch (e) {
    return { configured: true, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const u = data && data.usage;
  if (!u || typeof u !== 'object') {
    return { configured: true, ok: false, error: '用量接口返回格式异常' };
  }
  const windows = [];
  for (const [key, label] of [['rolling', '5h 滚动'], ['weekly', '每周'], ['monthly', '每月']]) {
    const w = u[key];
    windows.push({
      key,
      label,
      status: w && typeof w.status === 'string' ? w.status : 'unknown',
      percent: typeof w === 'object' && typeof w.percent === 'number' ? w.percent : null,
      resetsAt: w && typeof w.resetsAt === 'string' ? w.resetsAt : null,
    });
  }
  return { configured: true, ok: true, provider: 'OpenCode Go', windows };
}

function fmtWindow(w) {
  const pct = w.percent === null ? '—' : `${w.percent}%`;
  const reset = w.resetsAt ? new Date(w.resetsAt).toLocaleString() : '重置时间未知';
  const status = w.status === 'ok' ? '' : `（${w.status}）`;
  return `${w.label}：${pct}${status}，${reset} 重置`;
}

async function queryBalance(ctx, keyEnv, signal) {
  try {
    const data = await fetchBalanceData(ctx, keyEnv, signal);
    const lines = [];
    lines.push(`账户可用：${data.is_available ? '是' : '否'}`);
    if (!Array.isArray(data.balance_infos) || data.balance_infos.length === 0) {
      lines.push('（接口未返回余额明细）');
    } else {
      for (const b of data.balance_infos) {
        lines.push(
          `${b.currency}：总额 ${b.total_balance ?? '-'}` +
            `（赠送 ${b.granted_balance ?? '-'} + 充值 ${b.topped_up_balance ?? '-'}）`,
        );
      }
    }
    // 配置了 OpenCode Go 时顺带附上套餐用量摘要
    const plan = await fetchCodingPlanData(ctx, signal);
    if (plan.configured) {
      if (plan.ok) {
        const monthly = plan.windows.find((w) => w.key === 'monthly');
        const rolling = plan.windows.find((w) => w.key === 'rolling');
        const weekly = plan.windows.find((w) => w.key === 'weekly');
        lines.push(
          `Coding Plan（${plan.provider}）：每月 ${monthly?.percent ?? '—'}%` +
            `（5h ${rolling?.percent ?? '—'}% / 每周 ${weekly?.percent ?? '—'}%）`,
        );
      } else {
        lines.push(`Coding Plan 用量查询失败：${plan.error}`);
      }
    }
    return ok(lines.join('\n'));
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

async function queryPlan(ctx, signal) {
  const plan = await fetchCodingPlanData(ctx, signal);
  if (!plan.configured) {
    return err(`未配置 ${ZEN_GO_KEY_ENV}。请在 .credentials.yaml 或进程环境变量中配置后重试。`);
  }
  if (!plan.ok) {
    return err(plan.error);
  }
  const lines = [`${plan.provider} 套餐用量：`, ...plan.windows.map(fmtWindow)];
  return ok(lines.join('\n'));
}

// GUI 数据路由：GET /plugins/balance/state →
//   { ok: true, providers: [
//     { id:'deepseek', label, kind:'balance', ok, stale, isAvailable?, balances? | error? },
//     { id:'opencode-go', label, kind:'plan', configured, ok, stale, windows? | error? },
//   ] }
// 每个 provider 独立容错：一个查询失败不影响另一个；面板按 provider 分区排列。
// 两个查询并行发出；结果带 5s TTL 缓存 + single-flight，面板轮询不重复打上游。
// 陈旧回退（同品类最佳实践）：某 provider 新鲜查询失败但上次有成功数据时，
// 返回上次数据并标记 stale:true（附上新错误），面板提示“数据可能已过期”，
// 而不是把面板打成一片错误 —— 仅当从未成功过才返回错误态。
function collectState(ctx) {
  // DeepSeek API 余额（独立容错）
  const deepseekTask = (async () => {
    try {
      const data = await fetchBalanceData(ctx, DEFAULT_KEY_ENV, null);
      return {
        ok: true,
        isAvailable: data.is_available === true,
        balances: Array.isArray(data.balance_infos) ? data.balance_infos : [],
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  })();

  // OpenCode Go 订阅套餐用量（并行）
  const planTask = fetchCodingPlanData(ctx, null);

  return Promise.all([deepseekTask, planTask]).then(([deepseek, plan]) => ({ deepseek, plan }));
}

/** 新鲜成功 → 直接使用；新鲜失败且有上次成功数据 → 回退上次数据 + stale 标记；否则原样错误。 */
function mergeProvider(fresh, last) {
  if (fresh.ok) return { ...fresh, stale: false };
  if (last && last.ok) return { ...last, stale: true, error: fresh.error };
  return { ...fresh, stale: false };
}

/** 组装响应 payload：provider 固定元数据 + 合并后的数据（含 stale 标记）。 */
function assemble(fresh, lastDeepseek, lastPlan) {
  const deepseek = {
    id: 'deepseek',
    label: 'DeepSeek API',
    kind: 'balance',
    ...mergeProvider(fresh.deepseek, lastDeepseek),
  };
  const planRaw = mergeProvider(fresh.plan, lastPlan);
  const plan = {
    id: 'opencode-go',
    label: planRaw.provider || lastPlan?.label || 'OpenCode Go',
    kind: 'plan',
    configured: planRaw.configured ?? lastPlan?.configured ?? false,
    ok: !!planRaw.ok,
    stale: !!planRaw.stale,
    error: planRaw.error,
    windows: planRaw.windows || [],
  };
  return { ok: true, providers: [deepseek, plan] };
}

function registerStateRoute(ctx) {
  // 缓存与 in-flight 状态属于本次 apply 的闭包：插件重载后旧状态随旧 context 一起废弃，
  // 不会跨实例泄漏。
  let stateCache = null; // { t: number, payload: object }
  let inflight = null; // Promise<object> | null（single-flight）
  let lastDeepseek = null; // 上次成功的 deepseek provider（陈旧回退源）
  let lastPlan = null; // 上次成功的 plan provider（陈旧回退源）
  // 花费历史（per-apply 内存态 + 文件持久化）
  const spendFile = resolveSpendFile();
  let spendSamples = loadSpendSamples(spendFile);

  const route = {
    kind: 'exact',
    path: '/plugins/balance/state',
    handler: async (req, res) => {
      // 只服务 GET；其他方法明确拒绝，避免面板之外的无意调用被当成功应答。
      if (req.method && req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET', 'content-type': 'text/plain; charset=utf-8' });
        res.end('method not allowed');
        return;
      }
      const send = (payload) => {
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          // 账户数据不经代理缓存：面板侧已带 cache: 'no-store'，这里双保险。
          'cache-control': 'no-store',
        });
        res.end(JSON.stringify(payload));
      };

      const now = Date.now();
      if (stateCache && now - stateCache.t < STATE_CACHE_TTL_MS) {
        send(stateCache.payload);
        return;
      }
      if (!inflight) {
        inflight = collectState(ctx)
          .then((fresh) => {
            // 新鲜成功才记录采样（陈旧回退不重复记录）
            const b0 = fresh.deepseek.ok && fresh.deepseek.balances ? fresh.deepseek.balances[0] : null;
            if (b0) {
              const total = Number(b0.total_balance);
              const topped = Number(b0.topped_up_balance);
              if (Number.isFinite(total)) {
                recordBalanceSample(spendSamples, Date.now(), total, Number.isFinite(topped) ? topped : 0);
                saveSpendSamples(spendFile, spendSamples);
              }
            }
            const payload = assemble(fresh, lastDeepseek, lastPlan);
            // 只把成功的 provider 记为陈旧回退源
            if (payload.providers[0].ok) {
              lastDeepseek = payload.providers[0];
              // 附加每日花费序列（本地估算）
              const b = lastDeepseek.balances ? lastDeepseek.balances[0] : null;
              lastDeepseek.spend = {
                currency: b && typeof b.currency === 'string' ? b.currency : '',
                days: computeDailySpend(spendSamples, Date.now()),
              };
            }
            if (payload.providers[1].ok) lastPlan = payload.providers[1];
            stateCache = { t: Date.now(), payload };
            return payload;
          })
          .finally(() => {
            inflight = null;
          });
      }
      send(await inflight);
    },
  };
  return ctx.webServer.register(route);
}

function apply(ctx) {
  ctx.effect(
    function* () {
      yield ctx.commands.register({
        name: 'balance',
        description: 'query the DeepSeek API account balance (and Coding Plan usage when configured)',
        input: { hint: '[<API_KEY_ENV>]' },
        handler: (invocation) => {
          const raw = invocation.rawInput.trim();
          if (raw.length === 0) {
            return queryBalance(ctx, DEFAULT_KEY_ENV, invocation.signal);
          }
          if (!isShellIdent(raw)) {
            return err(`凭证环境变量名无效：${raw}（须为 POSIX shell 标识符，如 DEEPSEEK_API_KEY）`);
          }
          return queryBalance(ctx, raw, invocation.signal);
        },
      });

      yield ctx.commands.register({
        name: 'plan',
        description: 'query the OpenCode Go Coding Plan subscription usage (5h rolling / weekly / monthly)',
        handler: (invocation) => queryPlan(ctx, invocation.signal),
      });

      yield registerStateRoute(ctx);
    },
    'dsh-balance registrations',
  );
}

// internals：纯函数测试入口（官方惯例，见 dsh-web-app）；不影响插件契约。
const internals = { computeDailySpend, loadSpendSamples, recordBalanceSample, saveSpendSamples };

export { apply, inject, name, internals };
