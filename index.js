// @dsh-plugin-balance-panel —— DeepSeek Harness cordis 插件：多 provider 余额/用量 + Coding Plan。
//
//   /balance [KEY_ENV]   汇总所有已配置凭证的余额 provider（或按指定 env 用 DeepSeek 格式查询）
//   /plan                汇总所有已配置的 Coding Plan 用量 provider
//
// 另为右侧 GUI 面板提供数据路由：GET /plugins/balance/state（exact 优先于
// client-modules 的 /plugins prefix），client half 的面板轮询它显示余额、用量与
// 每日花费/Token 统计。凭证通过 DSH 的 credentials 服务解析，绝不在任何响应里
// 回显密钥本身；未配置凭证的 provider 自动隐藏（describe 探测，不暴露值）。
//
// 生命周期：所有注册（命令 ×2、路由 ×1、事件监听 ×1）都包在 ctx.effect 里，
// 插件停止/HMR 重载时自动注销 —— 路由是 exact 且重名即抛，不留 disposer 会
// 直接让重载失败。
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const name = 'balance';
const inject = ['commands', 'credentials', 'webServer'];

const FETCH_TIMEOUT_MS = 10000;
// GUI 路由的 5s TTL 内存缓存：面板每 30s 轮询、多个视图可能同时请求，
// 避免每次请求都打到上游接口；缓存冷时并发请求共享同一轮查询（single-flight）。
const STATE_CACHE_TTL_MS = 5000;

// —— 每日金额花费（本地余额差分估算）——
// 每次成功拉到余额时记录采样点 { t, total, topped }（取第一个币种）：1 小时节流
// （同一小时内就地更新）、只保留最近 60 天。每日花费按「相邻采样对」归属到
// 后一个采样所在日：spend = Δtopped − Δtotal（充值会使 total 上升，用 Δtopped
// 剔除充值影响），钳制 ≥ 0。无需平台 token，纯本地估算。
const SPEND_SAMPLE_GAP_MS = 60 * 60 * 1000;
const SPEND_KEEP_MS = 60 * 24 * 60 * 60 * 1000;
const SPEND_CHART_DAYS = 14;
// —— 每日 Token 统计 ——
// 监听 session/event 的 assistant/message 事件，取 provider 报告的 usage 聚合
// 到自然日；只保留最近 60 天。持久化同 spend 文件。
const TOKEN_KEEP_DAYS = 60;
const TOKEN_CHART_DAYS = 14;

// ================= 适配器表（通用化的核心） =================
//
// 每个适配器声明：id（payload 中 providers[].id）、label（面板分区标题）、
// kind（'balance' | 'plan'）、keyEnv（凭证环境变量名）、path（API 路径）、
// defaultBase（默认 baseUrl）与 parse（响应 → 统一结构）。
// baseUrl 可用环境变量 `<ID>_API_BASE` 覆盖（id 大写、连字符转下划线），
// 例如 DEEPSEEK_API_BASE / MOONSHOT_API_BASE / OPENCODE_GO_API_BASE。
//
// balance 适配器的 parse 统一返回：
//   { ok, isAvailable?, balances: [{ currency, total_balance, granted_balance?, topped_up_balance? }] }
// plan 适配器的 parse 统一返回：
//   { ok, provider, windows: [{ key, label, status, percent, resetsAt }] }
// 解析失败返回 { ok: false, error }。

/** DeepSeek 余额：GET /user/balance → { is_available, balance_infos[] }（官方文档）。 */
const DEEPSEEK = {
  id: 'deepseek',
  label: 'DeepSeek API',
  kind: 'balance',
  keyEnv: 'DEEPSEEK_API_KEY',
  path: '/user/balance',
  defaultBase: 'https://api.deepseek.com',
  parse(data) {
    return {
      ok: true,
      isAvailable: data.is_available === true,
      balances: Array.isArray(data.balance_infos) ? data.balance_infos : [],
    };
  },
};

/** Moonshot (Kimi) 余额：GET /v1/users/me/balance → { data: { available_balance, voucher_balance, cash_balance, currency } }（官方帮助中心）。 */
const MOONSHOT = {
  id: 'moonshot',
  label: 'Moonshot (Kimi)',
  kind: 'balance',
  keyEnv: 'MOONSHOT_API_KEY',
  path: '/v1/users/me/balance',
  defaultBase: 'https://api.moonshot.cn',
  parse(data) {
    const d = data && data.data;
    if (!d || typeof d.available_balance === 'undefined') return { ok: false, error: '余额接口返回格式异常' };
    return {
      ok: true,
      isAvailable: true,
      balances: [
        {
          currency: typeof d.currency === 'string' ? d.currency : 'CNY',
          total_balance: d.available_balance,
          granted_balance: d.voucher_balance,
          topped_up_balance: d.cash_balance,
        },
      ],
    };
  },
};

/** 智谱 GLM 余额：GET /api/paas/v4/balance → { balance: [{ total, used, available, currency }] }。 */
const ZHIPU = {
  id: 'zhipu',
  label: '智谱 GLM',
  kind: 'balance',
  keyEnv: 'ZHIPU_API_KEY',
  path: '/api/paas/v4/balance',
  defaultBase: 'https://open.bigmodel.cn',
  parse(data) {
    const list = data && Array.isArray(data.balance) ? data.balance : null;
    if (!list || list.length === 0) return { ok: false, error: '余额接口返回格式异常' };
    return {
      ok: true,
      isAvailable: true,
      balances: list.map((b) => ({
        currency: typeof b.currency === 'string' ? b.currency : 'CNY',
        total_balance: b.available ?? b.total ?? null,
        granted_balance: null,
        topped_up_balance: null,
      })),
    };
  },
};

/** OpenRouter 余额：GET /api/v1/credits → { credits: { total, used, remaining } }（官方文档）。 */
const OPENROUTER = {
  id: 'openrouter',
  label: 'OpenRouter',
  kind: 'balance',
  keyEnv: 'OPENROUTER_API_KEY',
  path: '/api/v1/credits',
  defaultBase: 'https://openrouter.ai',
  parse(data) {
    const c = data && data.credits;
    if (!c || typeof c.remaining === 'undefined') return { ok: false, error: '余额接口返回格式异常' };
    return {
      ok: true,
      isAvailable: true,
      balances: [{ currency: 'USD', total_balance: c.remaining, granted_balance: null, topped_up_balance: null }],
    };
  },
};

/** OpenCode Go（Coding Plan）用量：GET /v1/usage → { usage: { rolling|weekly|monthly: { status, percent, resetsAt } } }。 */
const OPENCODE_GO = {
  id: 'opencode-go',
  label: 'OpenCode Go',
  kind: 'plan',
  keyEnv: 'OPENCODE_GO_API_KEY',
  path: '/v1/usage',
  defaultBase: 'https://opencode.ai/zen/go',
  parse(data) {
    const u = data && data.usage;
    if (!u || typeof u !== 'object') return { ok: false, error: '用量接口返回格式异常' };
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
    return { ok: true, provider: 'OpenCode Go', windows };
  },
};

/** 内置适配器（顺序即面板分区顺序）。 */
const ADAPTERS = [DEEPSEEK, MOONSHOT, ZHIPU, OPENROUTER, OPENCODE_GO];
const BALANCE_ADAPTERS = ADAPTERS.filter((a) => a.kind === 'balance');

/** 适配器 baseUrl：环境变量 <ID>_API_BASE 覆盖默认值。 */
function adapterBase(a) {
  const env = `${a.id.toUpperCase().replace(/-/g, '_')}_API_BASE`;
  return (process.env[env] || a.defaultBase).replace(/\/+$/, '');
}

// ================= 花费/Token 统计存储 =================

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

/** 空存储：{ version: 2, providers: {}, tokens: [] }。 */
function emptySpendStore() {
  return { version: 2, providers: {}, tokens: [] };
}

/**
 * 读取花费/Token 存储。旧格式（纯采样数组，v1）自动迁移：
 * 数组 → { version: 2, providers: { deepseek: 数组 }, tokens: [] }。
 */
function loadSpendStore(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (Array.isArray(data)) return { version: 2, providers: { deepseek: data }, tokens: [] };
    if (data && typeof data === 'object' && data.version === 2) {
      return {
        version: 2,
        providers: data.providers && typeof data.providers === 'object' ? data.providers : {},
        tokens: Array.isArray(data.tokens) ? data.tokens : [],
      };
    }
    return emptySpendStore();
  } catch {
    return emptySpendStore();
  }
}

/** 原子写入（tmp + rename）。失败只告警：统计是尽力而为的附加功能。 */
function saveSpendStore(file, store) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(store), 'utf8');
    renameSync(tmp, file);
  } catch (e) {
    console.warn(`[dsh-plugin-balance-panel] 统计写入失败：${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 追加或节流更新一个余额采样点，并裁剪超出保留窗口的旧采样。
 *  采样含 granted（赠送金）与 currency（币种）：花费差分公式需要 Δgranted
 *  才能剔除赠送金发放/回收；/stats 命令需要币种显示。旧采样缺字段时回退。 */
function recordBalanceSample(samples, now, total, topped, granted = 0, currency = '') {
  const last = samples[samples.length - 1];
  if (last && now - last.t < SPEND_SAMPLE_GAP_MS) {
    last.t = now;
    last.total = total;
    last.topped = topped;
    last.granted = granted;
    if (currency) last.currency = currency;
    return samples;
  }
  samples.push({ t: now, total, topped, granted, currency });
  const cutoff = now - SPEND_KEEP_MS;
  while (samples.length > 1 && samples[0].t < cutoff) samples.shift();
  return samples;
}

/** 本地日序号（用于跨日差计算，不受 DST 影响）。 */
function localDayNumber(t) {
  const d = new Date(t);
  return Math.floor((t - d.getTimezoneOffset() * 60000) / 86400000);
}

/** 某本地日的 'M-D' 键。 */
function dateKey(t) {
  const d = new Date(t);
  return `${d.getMonth() + 1}-${d.getDate()}`;
}

/** 本地日序号 → 该日的 'M-D' 键（反向还原本地时刻，补偿时区偏移）。 */
function dateKeyOfDay(day) {
  const d = new Date(day * 86400000 + new Date().getTimezoneOffset() * 60000);
  return `${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * 近 N 天每日花费序列（从旧到新）：{ date: 'M-D', amount }。
 *
 * 口径（信息论意义上的最优差分法）：消费会从 topped（充值金）或 granted
 * （赠送金）中扣减，所以 Δtopped / Δgranted 同时混有「外部注入」与「消费扣减」，
 * 二者不可精确分离。取「注入」= 两者的正向变化（充值/发放只会增加），
 * 消费通过总额净变化体现：
 *   花费 = max(0, max(0, Δtopped) + max(0, Δgranted) − Δtotal)，Δ 均为 b − a
 * 日常纯消费（无论扣 topped 还是 granted）全部正确；充值/发放与消费同日
 * 发生时低估（净额被记入注入）；赠送金回收（Δgranted < 0 且非消费）会虚增
 * —— 均为观测极限，README 已注明。旧采样缺少 granted 字段时视为 0。
 *
 * 归属：花费发生在 t_a 与 t_b 之间；同日采样对记到当天；跨天断档
 * （某天页面未打开而没有采样）时按覆盖天数均摊，避免整段花费
 * 堆到后一个采样日造成虚假尖峰。
 */
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
    // 注入 = 充值/发放的正向变化；消费 = 注入 − 总额净变化（钳制 ≥ 0）
    const inject =
      Math.max(0, b.topped - a.topped) + Math.max(0, (b.granted ?? a.granted ?? 0) - (a.granted ?? 0));
    const spend = Math.max(0, inject - (b.total - a.total));
    if (spend <= 0) continue;
    // 覆盖日数：同日 = 1；跨天 = 本地日差 + 1（断档均摊）
    const span = localDayNumber(b.t) - localDayNumber(a.t) + 1;
    if (span <= 1) {
      const row = index.get(dateKey(b.t));
      if (row) row.amount += spend;
      continue;
    }
    const share = spend / span;
    let day = localDayNumber(a.t);
    for (let k = 0; k < span; k += 1, day += 1) {
      const row = index.get(dateKeyOfDay(day));
      if (row) row.amount += share;
    }
  }
  for (const row of out) row.amount = Math.round(row.amount * 100) / 100;
  return out;
}

/** 'M-D' → 年内日序号（0 起，非闰年基准；仅用于同一年内的先后比较）。 */
function dayKeyToDayOfYear(key) {
  const [m, d] = key.split('-').map((n) => parseInt(n, 10));
  return Math.round((Date.UTC(2001, m - 1, d) - Date.UTC(2001, 0, 1)) / 86400000);
}

/** 按自然日累加 token（当天已存在则累加，否则新建），并裁剪超出保留窗口的旧日。
 *  裁剪用「年内日序号」比较，修复 M-D 字符串在跨月时错序
 *  （如 '10-1' 字典序小于 '9-30'）导致错误裁剪的缺陷。 */
function recordTokenDay(tokenDays, now, tokens) {
  const d = new Date(now);
  const date = `${d.getMonth() + 1}-${d.getDate()}`;
  const row = tokenDays.find((r) => r.date === date);
  if (row) row.tokens += tokens;
  else tokenDays.push({ date, tokens });
  const yearStart = new Date(d.getFullYear(), 0, 1).getTime();
  const cutoff = Math.floor((now - (TOKEN_KEEP_DAYS - 1) * 86400000 - yearStart) / 86400000);
  // 数组按追加顺序即时间顺序：头部整日早于 cutoff 的移除（保留至少一条）
  while (tokenDays.length > 1 && dayKeyToDayOfYear(tokenDays[0].date) < cutoff) tokenDays.shift();
  return tokenDays;
}

/** 近 N 天每日 token 序列（从旧到新）：{ date: 'M-D', tokens }。 */
function computeDailyTokens(tokenDays, now, days = TOKEN_CHART_DAYS) {
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now - i * 86400000);
    out.push({ date: `${d.getMonth() + 1}-${d.getDate()}`, tokens: 0 });
  }
  const index = new Map(out.map((r) => [r.date, r]));
  for (const r of tokenDays) {
    const row = index.get(r.date);
    if (row) row.tokens += r.tokens;
  }
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

/** 凭证是否已配置（describe 不暴露值）。 */
async function isCredentialConfigured(ctx, keyEnv) {
  try {
    const info = await ctx.credentials.describe(credentialRef(keyEnv));
    return !!(info && info.configured);
  } catch {
    return false;
  }
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

/** 按适配器查询上游并解析为统一结构（凭证解析失败/网络失败 → { ok:false, error } 之外的异常向上抛）。 */
async function fetchAdapter(ctx, a, signal) {
  const key = await resolveCredential(ctx, a.keyEnv);
  const data = await httpJson(`${adapterBase(a)}${a.path}`, key, signal);
  const parsed = a.parse(data);
  if (parsed && parsed.ok === false) return parsed;
  return parsed;
}

// —— 命令 ——

function fmtBalanceAdapter(a, fresh) {
  const lines = [];
  lines.push(`${a.label}：账户可用：${fresh.isAvailable ? '是' : '否'}`);
  if (!Array.isArray(fresh.balances) || fresh.balances.length === 0) {
    lines.push('  （接口未返回余额明细）');
  } else {
    for (const b of fresh.balances) {
      const parts = [];
      if (b.granted_balance !== null && b.granted_balance !== undefined) parts.push(`赠送 ${b.granted_balance}`);
      if (b.topped_up_balance !== null && b.topped_up_balance !== undefined) parts.push(`充值 ${b.topped_up_balance}`);
      lines.push(`  ${b.currency}：总额 ${b.total_balance ?? '-'}${parts.length > 0 ? `（${parts.join(' + ')}）` : ''}`);
    }
  }
  return lines.join('\n');
}

/** /balance：汇总所有已配置的 balance provider（或按指定 env 用 DeepSeek 格式查询）。 */
async function queryBalance(ctx, keyEnv, signal) {
  const lines = [];
  try {
    if (keyEnv) {
      // 指定 env：沿用 DeepSeek 余额格式（向后兼容 /balance MY_KEY_ENV）
      const a = { ...DEEPSEEK, keyEnv };
      const fresh = await fetchAdapter(ctx, a, signal);
      if (!fresh.ok) throw new Error(fresh.error || '查询失败');
      lines.push(fmtBalanceAdapter(a, fresh));
    } else {
      let any = false;
      let anyOk = false;
      for (const a of BALANCE_ADAPTERS) {
        if (!(await isCredentialConfigured(ctx, a.keyEnv))) continue;
        any = true;
        try {
          const fresh = await fetchAdapter(ctx, a, signal);
          if (!fresh.ok) throw new Error(fresh.error || '查询失败');
          anyOk = true;
          lines.push(fmtBalanceAdapter(a, fresh));
        } catch (e) {
          lines.push(`${a.label}：查询失败：${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (!any) return err('未配置任何余额 provider 的凭证（如 DEEPSEEK_API_KEY / MOONSHOT_API_KEY / ZHIPU_API_KEY / OPENROUTER_API_KEY）。请在 .credentials.yaml 或进程环境变量中配置。');
      // 全部失败 → 整体错误态；部分失败 → 行内提示（汇总语义）
      if (!anyOk) return err(lines.join('\n'));
    }
    // 配置了 Coding Plan 时顺带附上用量摘要
    for (const a of ADAPTERS) {
      if (a.kind !== 'plan') continue;
      if (!(await isCredentialConfigured(ctx, a.keyEnv))) continue;
      try {
        const plan = await fetchAdapter(ctx, a, signal);
        if (!plan.ok) throw new Error(plan.error || '查询失败');
        const monthly = plan.windows.find((w) => w.key === 'monthly');
        const rolling = plan.windows.find((w) => w.key === 'rolling');
        const weekly = plan.windows.find((w) => w.key === 'weekly');
        lines.push(
          `${plan.provider}：每月 ${monthly?.percent ?? '—'}%` +
            `（5h ${rolling?.percent ?? '—'}% / 每周 ${weekly?.percent ?? '—'}%）`,
        );
      } catch (e) {
        lines.push(`Coding Plan 用量查询失败：${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return ok(lines.join('\n'));
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

/** /plan：汇总所有已配置的 Coding Plan provider。 */
async function queryPlan(ctx, signal) {
  const plans = [];
  for (const a of ADAPTERS) {
    if (a.kind !== 'plan') continue;
    if (!(await isCredentialConfigured(ctx, a.keyEnv))) continue;
    try {
      const plan = await fetchAdapter(ctx, a, signal);
      if (!plan.ok) throw new Error(plan.error || '查询失败');
      plans.push(`${plan.provider} 套餐用量：\n${plan.windows.map(fmtWindow).join('\n')}`);
    } catch (e) {
      plans.push(`${a.label} 用量查询失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (plans.length === 0) {
    return err('未配置任何 Coding Plan 凭证（如 OPENCODE_GO_API_KEY）。请在 .credentials.yaml 或进程环境变量中配置后重试。');
  }
  return ok(plans.join('\n\n'));
}

function fmtWindow(w) {
  const pct = w.percent === null ? '—' : `${w.percent}%`;
  const reset = w.resetsAt ? new Date(w.resetsAt).toLocaleString() : '重置时间未知';
  const status = w.status === 'ok' ? '' : `（${w.status}）`;
  return `${w.label}：${pct}${status}，${reset} 重置`;
}

// —— GUI 数据路由 ——
//
// GET /plugins/balance/state →
//   { ok: true, providers: [ { id, label, kind, ok, stale, ... } ], tokenSpend: { days } }
// 每个 provider 独立容错：一个查询失败不影响另一个；面板按 provider 分区排列。
// 已配置凭证的 provider 并行查询；结果带 5s TTL 缓存 + single-flight，面板轮询
// 不重复打上游。陈旧回退（同品类最佳实践）：某 provider 新鲜查询失败但上次有
// 成功数据时，返回上次数据并标记 stale:true（附上新错误），面板提示“数据可能
// 已过期”——仅当从未成功过才返回错误态。

/** 探测 + 并行查询所有适配器：{ adapter, configured, fresh? }[]。 */
async function collectState(ctx, signal) {
  return Promise.all(
    ADAPTERS.map(async (a) => {
      if (!(await isCredentialConfigured(ctx, a.keyEnv))) return { adapter: a, configured: false };
      try {
        return { adapter: a, configured: true, fresh: await fetchAdapter(ctx, a, signal) };
      } catch (e) {
        return {
          adapter: a,
          configured: true,
          fresh: { ok: false, error: e instanceof Error ? e.message : String(e) },
        };
      }
    }),
  );
}

/** 新鲜成功 → 直接使用；新鲜失败且有上次成功数据 → 回退上次数据 + stale 标记；否则原样错误。 */
function mergeProvider(fresh, last) {
  if (fresh.ok) return { ...fresh, stale: false };
  if (last && last.ok) return { ...last, stale: true, error: fresh.error };
  return { ...fresh, stale: false };
}

/** 组装响应 payload：provider 固定元数据 + 合并后的数据（含 stale 标记）。未配置的不出现。 */
function assemble(results, lastGood) {
  const providers = [];
  for (const r of results) {
    const a = r.adapter;
    if (!r.configured) continue;
    const merged = mergeProvider(r.fresh, lastGood[a.id]);
    const provider = { id: a.id, label: a.label, kind: a.kind, ...merged };
    if (a.kind === 'plan') {
      provider.label = r.fresh.provider || lastGood[a.id]?.label || a.label;
      provider.configured = true;
    }
    providers.push(provider);
  }
  return { ok: true, providers };
}

function registerStateRoute(ctx, store, stats, persist) {
  // 缓存与 in-flight 状态属于本次 apply 的闭包：插件重载后旧状态随旧 context 一起废弃，
  // 不会跨实例泄漏。
  let stateCache = null; // { t: number, payload: object }
  let inflight = null; // Promise<object> | null（single-flight）
  const lastGood = {}; // { [adapterId]: 上次成功的 provider }（陈旧回退源）
  // 统计存储由 apply 创建并共享（路由写入，/stats 命令读取）

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
        inflight = collectState(ctx, null)
          .then((results) => {
            // 新鲜成功的 balance provider 记录采样（陈旧回退不重复记录）
            for (const r of results) {
              if (!r.configured || !r.fresh.ok || r.adapter.kind !== 'balance') continue;
              const b0 = Array.isArray(r.fresh.balances) ? r.fresh.balances[0] : null;
              if (!b0) continue;
              const total = Number(b0.total_balance);
              if (!Number.isFinite(total)) continue;
              const topped = Number(b0.topped_up_balance);
              const granted = Number(b0.granted_balance);
              const samples = store.providers[r.adapter.id] || (store.providers[r.adapter.id] = []);
              recordBalanceSample(
                samples,
                Date.now(),
                total,
                Number.isFinite(topped) ? topped : 0,
                Number.isFinite(granted) ? granted : 0,
                typeof b0.currency === 'string' ? b0.currency : '',
              );
              stats.dirty = true;
            }
            persist();
            const payload = assemble(results, lastGood);
            // 只把成功的 provider 记为陈旧回退源，并给 balance provider 附每日花费序列
            for (const p of payload.providers) {
              if (!p.ok) continue;
              lastGood[p.id] = p;
              if (p.kind !== 'balance') continue;
              const b = Array.isArray(p.balances) ? p.balances[0] : null;
              p.spend = {
                currency: b && typeof b.currency === 'string' ? b.currency : '',
                days: computeDailySpend(store.providers[p.id] || [], Date.now()),
              };
            }
            payload.tokenSpend = { days: computeDailyTokens(store.tokens, Date.now()) };
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
  return { route };
}

// —— 每日 Token 统计：监听 session/event，聚合所有 session 每次 LLM 调用的 usage ——
// 返回 ctx.on 的 disposer（cordis 惯例），由调用方挂进 effect 生命周期。
// DSH 事件信封：{ type, seq, time, data }（assistant/message 的 data.usage、
// assistant/chunk 的 data.chunk.type==='usage' 都来自 dsh-llm 的 TokenUsage）。
//
// 覆盖「所有 session 的所有调用」：同一个 (session, turn, step) 的调用会先发
// usage chunk（流式尾部样本）、成功后发 assistant/message（最终样本）——两者
// 值相同，不能重复累计；失败/中断的调用只有 chunk 样本，必须在 step 结束时兜底
// 提交。聚合器保证同一调用只计入一次，message 优先、chunk 兜底。
function sumTokenUsage(u) {
  return (
    (u.inputTokens ?? 0) +
    (u.outputTokens ?? 0) +
    (u.cacheReadTokens ?? 0) +
    (u.cacheWriteTokens ?? 0) +
    (u.reasoningTokens ?? 0)
  );
}

/** 每次调用（session × turn × step）的 token 只累计一次；message 优先、chunk 兜底。 */
function createTokenAggregator() {
  const done = new Map(); // sessionId -> Set<'turn:step'>（已累计的调用）
  const pending = new Map(); // sessionId -> Map<'turn:step' -> chunk 样本 total>
  const keyOf = (turn, step) => `${turn}:${step}`;
  return {
    /**
     * 喂入一个 session/event，返回本次应累计的 token 数（0 = 忽略或已累计）。
     * @param sessionId - 事件所属 session（不同 session 互不干扰）
     * @param event - 会话事件（信封 { type, time, data }）
     */
    feed(sessionId, event) {
      const data = event && event.data;
      if (!data) return 0;
      const turn = data.turn;
      const step = data.step;
      const key = keyOf(turn, step);
      const ds = done.get(sessionId) || (done.set(sessionId, new Set()), done.get(sessionId));
      const ps = pending.get(sessionId) || (pending.set(sessionId, new Map()), pending.get(sessionId));

      if (event.type === 'assistant/chunk') {
        // 流式尾部的 usage 样本：先缓存，等 message（最终样本）或 step 结束（失败兜底）
        if (data.chunk && data.chunk.type === 'usage' && data.chunk.usage) {
          ps.set(key, sumTokenUsage(data.chunk.usage));
        }
        return 0;
      }
      if (event.type === 'assistant/message') {
        if (ds.has(key)) {
          ps.delete(key);
          return 0; // 同一调用已累计（HMR 重放/重复事件）
        }
        ds.add(key);
        const u = data.usage;
        if (u) {
          ps.delete(key);
          return sumTokenUsage(u); // 最终样本
        }
        const fallback = ps.get(key);
        if (fallback !== undefined) {
          ps.delete(key);
          return fallback; // 成功但 adapter 未报 usage：用流式样本兜底
        }
        return 0;
      }
      if (event.type === 'step/end') {
        // 调用失败/中断：没有 message，把流式样本兜底提交（provider 可能已计费）
        const fallback = ps.get(key);
        ps.delete(key);
        if (fallback !== undefined && !ds.has(key)) {
          ds.add(key);
          return fallback;
        }
        return 0;
      }
      if (event.type === 'turn/end') {
        // turn 结束：防御性提交残留样本并释放该 session 的去重状态
        let total = 0;
        for (const [k, v] of ps) {
          if (!ds.has(k)) {
            ds.add(k);
            total += v;
          }
        }
        done.delete(sessionId);
        pending.delete(sessionId);
        return total;
      }
      return 0;
    },
  };
}

function registerTokenListener(ctx, store, onPersist) {
  const aggregator = createTokenAggregator();
  return ctx.on('session/event', (session, event) => {
    const sessionId = session && typeof session.id === 'string' ? session.id : '?';
    const tokens = aggregator.feed(sessionId, event);
    if (tokens <= 0) return;
    // 用事件自身时间归日（比处理时刻更贴近真实消耗时刻）
    recordTokenDay(store.tokens, typeof event.time === 'number' ? event.time : Date.now(), tokens);
    onPersist();
  });
}

// —— /stats：读取历史统计（每日 Token 消耗 + 各 provider 金额花费）——
// 数据来自本地持久化的统计存储（与面板同一份），无需联网。
const STATS_DEFAULT_DAYS = 7;
const STATS_MAX_DAYS = 60; // 与采样/Token 保留窗口一致

function queryStats(store, rawDays, signal) {
  const raw = (rawDays || '').trim();
  let days = STATS_DEFAULT_DAYS;
  if (raw.length > 0) {
    if (!/^\d+$/.test(raw)) return err(`天数无效：${raw}（须为 1-${STATS_MAX_DAYS} 的整数）`);
    days = Math.min(Math.max(parseInt(raw, 10), 1), STATS_MAX_DAYS);
  }
  const now = Date.now();
  const lines = [];

  // Token 消耗（真实 usage 聚合）
  const tokenDays = computeDailyTokens(store.tokens, now, days);
  const tokenTotal = tokenDays.reduce((sum, d) => sum + d.tokens, 0);
  if (tokenTotal > 0) {
    lines.push(`== Token 消耗（近 ${days} 天）==`);
    for (const d of tokenDays) {
      if (d.tokens > 0) lines.push(`  ${d.date}  ${d.tokens.toLocaleString()}`);
    }
    lines.push(`  合计  ${tokenTotal.toLocaleString()} tokens`);
  }

  // 金额花费（余额差分估算，按 provider 分区）
  for (const a of BALANCE_ADAPTERS) {
    const samples = store.providers[a.id];
    if (!samples || samples.length === 0) continue;
    const spendDays = computeDailySpend(samples, now, days);
    const total = spendDays.reduce((sum, d) => sum + d.amount, 0);
    if (total <= 0) continue;
    const currency = (samples[samples.length - 1]?.currency || 'CNY').toUpperCase();
    lines.push(`== ${a.label} 金额花费（近 ${days} 天）==`);
    for (const d of spendDays) {
      if (d.amount > 0) lines.push(`  ${d.date}  ${d.amount.toFixed(2)} ${currency}`);
    }
    lines.push(`  合计  ${total.toFixed(2)} ${currency}`);
  }

  if (lines.length === 0) {
    return err('（暂无统计数据：需要面板轮询过余额、或 DSH 中有过对话后自动记录）');
  }
  return ok(lines.join('\n'));
}

function registerStatsCommand(ctx, store) {
  return ctx.commands.register({
    name: 'stats',
    description: 'show historical daily token usage and per-provider spend from local stats',
    input: { hint: '[days=7]' },
    handler: (invocation) => queryStats(store, invocation.rawInput, invocation.signal),
  });
}

function apply(ctx) {
  ctx.effect(
    function* () {
      yield ctx.commands.register({
        name: 'balance',
        description: 'query account balances of all configured providers (or a specific API key env with DeepSeek format)',
        input: { hint: '[<API_KEY_ENV>]' },
        handler: (invocation) => {
          const raw = invocation.rawInput.trim();
          if (raw.length === 0) {
            return queryBalance(ctx, null, invocation.signal);
          }
          if (!isShellIdent(raw)) {
            return err(`凭证环境变量名无效：${raw}（须为 POSIX shell 标识符，如 DEEPSEEK_API_KEY）`);
          }
          return queryBalance(ctx, raw, invocation.signal);
        },
      });

      yield ctx.commands.register({
        name: 'plan',
        description: 'query Coding Plan subscription usage of all configured providers',
        handler: (invocation) => queryPlan(ctx, invocation.signal),
      });

      // 统计存储：路由（采样/token 写入）与 /stats 命令（读取）共享同一份内存态 + 文件持久化
      const storeFile = resolveSpendFile();
      const store = loadSpendStore(storeFile);
      const stats = { dirty: false };
      const persist = () => {
        if (!stats.dirty) return;
        stats.dirty = false;
        saveSpendStore(storeFile, store);
      };

      yield registerStatsCommand(ctx, store);
      const state = registerStateRoute(ctx, store, stats, persist);
      yield ctx.webServer.register(state.route);
      yield registerTokenListener(ctx, store, persist);
    },
    'dsh-plugin-balance-panel registrations',
  );
}

// internals：纯函数测试入口（官方惯例，见 dsh-web-app）；不影响插件契约。
const internals = {
  ADAPTERS,
  assemble,
  computeDailySpend,
  computeDailyTokens,
  createTokenAggregator,
  fetchAdapter,
  loadSpendStore,
  recordBalanceSample,
  recordTokenDay,
  saveSpendStore,
  sumTokenUsage,
};

export { apply, inject, name, internals };
