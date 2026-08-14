// dsh-plugin-balance-panel host half 测试。
//
// 直接 import 本插件的 index.js（@deepseek-ai/dsh-credentials、dsh-home-paths
// 解析自 devDependencies / node_modules），用 mock cordis ctx + mock global fetch
// 实测：命令 /balance /plan（多 provider 汇总）、数据路由 /plugins/balance/state
// （凭证探测、多 provider 独立容错、405 守卫、TTL 缓存、single-flight、陈旧回退）、
// 每日金额花费（采样 + 差分估算 + v2 文件持久化与迁移）、每日 Token 统计
// （session/event 监听聚合）、以及 ctx.effect 生命周期。全程无真实网络与密钥。
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const pluginIndex = pathToFileURL(join(here, '..', 'index.js'));

/** 模拟 cordis ctx：commands/credentials/webServer + effect 生命周期 + 事件注册。 */
function makeCtx({ creds = {} } = {}) {
  const commands = [];
  const routes = [];
  const disposers = [];
  const handlers = [];
  const ctx = {
    commands: {
      register(def) {
        commands.push(def);
        return () => {
          const i = commands.indexOf(def);
          if (i >= 0) commands.splice(i, 1);
        };
      },
    },
    webServer: {
      register(route) {
        // 与真实实现一致：重复 (kind, path) 抛错
        if (routes.some((r) => r.kind === route.kind && r.path === route.path)) {
          throw new Error(`duplicate route ${route.path}`);
        }
        routes.push(route);
        return () => {
          const i = routes.indexOf(route);
          if (i >= 0) routes.splice(i, 1);
        };
      },
    },
    credentials: {
      resolve: async (ref) => (creds[ref] ? { value: creds[ref], source: 'test' } : undefined),
      describe: async (ref) => (creds[ref] ? { configured: true } : { configured: false }),
    },
    effect(callback) {
      const gen = callback();
      let step = gen.next();
      while (!step.done) {
        disposers.push(step.value);
        step = gen.next();
      }
    },
    on(type, fn) {
      handlers.push({ type, fn });
      return () => {
        const i = handlers.findIndex((h) => h.type === type && h.fn === fn);
        if (i >= 0) handlers.splice(i, 1);
      };
    },
  };
  return { ctx, commands, routes, handlers, stop: () => [...disposers].reverse().forEach((d) => d && d()) };
}

/** 可编程的 fetch mock：按 URL 命中场景表，记录调用次数。 */
function mockFetch(scenarios) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    if (opts.signal && opts.signal.aborted) {
      throw new DOMException('aborted', 'AbortError');
    }
    const s = scenarios.find((x) => String(url).includes(x.match));
    if (!s) return new Response('not found', { status: 404 });
    if (s.error) return new Response(s.error, { status: s.status || 500 });
    if (s.delay) await s.delay;
    return Response.json(s.body);
  };
  return calls;
}

const BALANCE_OK = {
  is_available: true,
  balance_infos: [
    { currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' },
  ],
};

const PLAN_OK = {
  usage: {
    rolling: { status: 'ok', percent: 16, resetsAt: '2026-08-14T03:54:00.000Z' },
    weekly: { status: 'ok', percent: 12, resetsAt: '2026-08-17T00:00:00.000Z' },
    monthly: { status: 'ok', percent: 97, resetsAt: '2026-08-21T11:08:00.000Z' },
  },
};

let mod;
let spendFile;
beforeEach(() => {
  delete process.env.DEEPSEEK_API_BASE;
  delete process.env.OPENCODE_GO_API_BASE;
  // 花费历史落到临时文件，避免测试写进真实 $DSH_HOME
  spendFile = join(tmpdir(), `dsh-plugin-balance-panel-test-${process.pid}-${Date.now()}.json`);
  process.env.DSH_BALANCE_SPEND_FILE = spendFile;
});
afterEach(() => {
  try {
    rmSync(spendFile, { force: true });
  } catch {
    /* ignore */
  }
});

test('模块导出契约：name/inject/apply + internals', async () => {
  mod ??= await import(pluginIndex);
  assert.equal(mod.name, 'balance');
  assert.deepEqual([...mod.inject], ['commands', 'credentials', 'webServer']);
  assert.equal(typeof mod.apply, 'function');
  assert.equal(typeof mod.internals.computeDailySpend, 'function');
  assert.equal(typeof mod.internals.recordBalanceSample, 'function');
});

test('apply 经 ctx.effect 注册三命令 + 一路由，stop 后全部注销', async () => {
  const { ctx, commands, routes, stop } = makeCtx();
  mod.apply(ctx);
  assert.equal(commands.length, 3);
  assert.deepEqual(commands.map((c) => c.name), ['balance', 'plan', 'stats']);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].kind, 'exact');
  assert.equal(routes[0].path, '/plugins/balance/state');
  stop();
  assert.equal(commands.length, 0);
  assert.equal(routes.length, 0);
});

test('停止后重新 apply 不会因重复路由抛错（HMR 重载场景）', async () => {
  const { ctx, stop } = makeCtx();
  mod.apply(ctx);
  stop();
  assert.doesNotThrow(() => mod.apply(ctx)); // 第二次注册必须不撞 exact 路由
});

test('/balance 成功：余额明细 + 未配置 plan 时不带套餐行', async () => {
  const calls = mockFetch([{ match: '/user/balance', body: BALANCE_OK }]);
  const { ctx, commands } = makeCtx({ creds: { DEEPSEEK_API_KEY: 'sk-test' } });
  mod.apply(ctx);
  const cmd = commands.find((c) => c.name === 'balance');
  const result = await cmd.handler({ rawInput: '', signal: new AbortController().signal });
  assert.equal(result.kind, 'success');
  assert.match(result.text, /账户可用：是/);
  assert.match(result.text, /CNY：总额 110\.00（赠送 10\.00 \+ 充值 100\.00）/);
  assert.doesNotMatch(result.text, /Coding Plan/);
  assert.equal(calls.length, 1);
});

test('/balance 成功：配置 plan 时附带套餐摘要', async () => {
  const calls = mockFetch([
    { match: '/user/balance', body: BALANCE_OK },
    { match: '/v1/usage', body: PLAN_OK },
  ]);
  const { ctx, commands, routes } = makeCtx({ creds: { DEEPSEEK_API_KEY: 'sk-test', OPENCODE_GO_API_KEY: 'og-test' } });
  mod.apply(ctx);
  const cmd = commands.find((c) => c.name === 'balance');
  const result = await cmd.handler({ rawInput: '', signal: new AbortController().signal });
  assert.equal(result.kind, 'success');
  assert.match(result.text, /OpenCode Go：每月 97%（5h 16% \/ 每周 12%）/);
  assert.equal(calls.length, 2);
});

test('/balance 成功：汇总多个已配置的余额 provider，未配置的跳过', async () => {
  const calls = mockFetch([
    { match: '/user/balance', body: BALANCE_OK },
    { match: '/v1/users/me/balance', body: { data: { available_balance: 55.5, voucher_balance: 5, cash_balance: 50.5, currency: 'CNY' } } },
  ]);
  const { ctx, commands } = makeCtx({ creds: { DEEPSEEK_API_KEY: 'sk-test', MOONSHOT_API_KEY: 'ms-test' } });
  mod.apply(ctx);
  const cmd = commands.find((c) => c.name === 'balance');
  const result = await cmd.handler({ rawInput: '', signal: new AbortController().signal });
  assert.equal(result.kind, 'success');
  assert.match(result.text, /DeepSeek API：账户可用：是/);
  assert.match(result.text, /Moonshot \(Kimi\)：账户可用：是/);
  assert.match(result.text, /CNY：总额 55\.5（赠送 5 \+ 充值 50\.5）/);
  assert.doesNotMatch(result.text, /智谱/);
  assert.equal(calls.length, 2);
});

test('/balance 失败：凭证缺失给出可操作提示', async () => {
  mockFetch([]);
  const { ctx, commands, routes } = makeCtx();
  mod.apply(ctx);
  const cmd = commands.find((c) => c.name === 'balance');
  const result = await cmd.handler({ rawInput: '', signal: new AbortController().signal });
  assert.equal(result.kind, 'error');
  assert.match(result.text, /未配置任何余额 provider 的凭证/);
  assert.match(result.text, /DEEPSEEK_API_KEY/);
});

test('/balance 失败：非法环境变量名被拒绝', async () => {
  const { ctx, commands, routes } = makeCtx();
  mod.apply(ctx);
  const cmd = commands.find((c) => c.name === 'balance');
  const result = await cmd.handler({ rawInput: 'my key', signal: new AbortController().signal });
  assert.equal(result.kind, 'error');
  assert.match(result.text, /凭证环境变量名无效/);
});

test('/balance 失败：上游 500 时给出 HTTP 状态', async () => {
  mockFetch([{ match: '/user/balance', error: 'internal error', status: 500 }]);
  const { ctx, commands } = makeCtx({ creds: { DEEPSEEK_API_KEY: 'sk-test' } });
  mod.apply(ctx);
  const cmd = commands.find((c) => c.name === 'balance');
  const result = await cmd.handler({ rawInput: '', signal: new AbortController().signal });
  assert.equal(result.kind, 'error');
  assert.match(result.text, /HTTP 500/);
});

test('/balance 取消：调用方 signal 中止时返回取消提示', async () => {
  mockFetch([]);
  const { ctx, commands } = makeCtx({ creds: { DEEPSEEK_API_KEY: 'sk-test' } });
  mod.apply(ctx);
  const cmd = commands.find((c) => c.name === 'balance');
  const aborted = new AbortController();
  aborted.abort();
  const result = await cmd.handler({ rawInput: '', signal: aborted.signal });
  assert.equal(result.kind, 'error');
  assert.match(result.text, /操作已取消/);
});

test('/plan 未配置时给出指引', async () => {
  const { ctx, commands, routes } = makeCtx();
  mod.apply(ctx);
  const cmd = commands.find((c) => c.name === 'plan');
  const result = await cmd.handler({ rawInput: '', signal: new AbortController().signal });
  assert.equal(result.kind, 'error');
  assert.match(result.text, /未配置任何 Coding Plan 凭证/);
  assert.match(result.text, /OPENCODE_GO_API_KEY/);
});

test('/plan 成功：三个用量窗口与重置时间', async () => {
  mockFetch([{ match: '/v1/usage', body: PLAN_OK }]);
  const { ctx, commands } = makeCtx({ creds: { OPENCODE_GO_API_KEY: 'og-test' } });
  mod.apply(ctx);
  const cmd = commands.find((c) => c.name === 'plan');
  const result = await cmd.handler({ rawInput: '', signal: new AbortController().signal });
  assert.equal(result.kind, 'success');
  assert.match(result.text, /5h 滚动：16%/);
  assert.match(result.text, /每周：12%/);
  assert.match(result.text, /每月：97%/);
  assert.match(result.text, /重置/);
});

test('路由 GET：按 provider 分区返回，两者独立成功', async () => {
  const calls = mockFetch([
    { match: '/user/balance', body: BALANCE_OK },
    { match: '/v1/usage', body: PLAN_OK },
  ]);
  const { ctx, routes } = makeCtx({ creds: { DEEPSEEK_API_KEY: 'sk-test', OPENCODE_GO_API_KEY: 'og-test' } });
  mod.apply(ctx);
  const payload = await callRoute(ctx, routes, 'GET');
  assert.equal(payload.ok, true);
  assert.equal(payload.providers.length, 2);
  const ds = payload.providers.find((p) => p.id === 'deepseek');
  assert.equal(ds.kind, 'balance');
  assert.equal(ds.ok, true);
  assert.equal(ds.isAvailable, true);
  assert.equal(ds.balances[0].currency, 'CNY');
  const og = payload.providers.find((p) => p.id === 'opencode-go');
  assert.equal(og.kind, 'plan');
  assert.equal(og.configured, true);
  assert.equal(og.ok, true);
  assert.equal(og.windows.length, 3);
  assert.equal(calls.length, 2);
});

test('路由容错：balance 失败不影响 plan 分区', async () => {
  mockFetch([
    { match: '/user/balance', error: 'upstream down', status: 502 },
    { match: '/v1/usage', body: PLAN_OK },
  ]);
  const { ctx, routes } = makeCtx({ creds: { DEEPSEEK_API_KEY: 'sk-test', OPENCODE_GO_API_KEY: 'og-test' } });
  mod.apply(ctx);
  const payload = await callRoute(ctx, routes, 'GET');
  const ds = payload.providers.find((p) => p.id === 'deepseek');
  const og = payload.providers.find((p) => p.id === 'opencode-go');
  assert.equal(ds.ok, false);
  assert.match(ds.error, /HTTP 502/);
  assert.equal(og.ok, true);
});

test('路由陈旧回退：上游失败时返回上次成功数据并标记 stale', async () => {
  const { ctx, routes } = makeCtx({ creds: { DEEPSEEK_API_KEY: 'sk-test', OPENCODE_GO_API_KEY: 'og-test' } });
  mod.apply(ctx);
  // 第一轮：全部成功，写入 last-good 与 TTL 缓存
  mockFetch([
    { match: '/user/balance', body: BALANCE_OK },
    { match: '/v1/usage', body: PLAN_OK },
  ]);
  const r1 = await callRoute(ctx, routes, 'GET');
  const ds1 = r1.providers.find((p) => p.id === 'deepseek');
  assert.equal(ds1.ok, true);
  assert.equal(ds1.stale, false);
  // 越过 5s TTL，第二轮 balance 上游失败：应回退上次成功数据 + stale + 新错误
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 6000;
    mockFetch([
      { match: '/user/balance', error: 'down', status: 502 },
      { match: '/v1/usage', body: PLAN_OK },
    ]);
    const r2 = await callRoute(ctx, routes, 'GET');
    const ds2 = r2.providers.find((p) => p.id === 'deepseek');
    assert.equal(ds2.ok, true, '失败时应回退上次成功数据而非错误态');
    assert.equal(ds2.stale, true, '回退数据必须带 stale 标记');
    assert.match(ds2.error, /HTTP 502/, 'stale 数据应附上最新错误供提示');
    assert.equal(ds2.balances[0].currency, 'CNY', '回退的应是上次成功的数据');
    const og2 = r2.providers.find((p) => p.id === 'opencode-go');
    assert.equal(og2.stale, false, '成功的 provider 不受影响');
    // 再越过一轮 TTL：上游恢复成功后 stale 标记应清除
    Date.now = () => realNow() + 12000;
    mockFetch([
      { match: '/user/balance', body: BALANCE_OK },
      { match: '/v1/usage', body: PLAN_OK },
    ]);
    const r3 = await callRoute(ctx, routes, 'GET');
    const ds3 = r3.providers.find((p) => p.id === 'deepseek');
    assert.equal(ds3.stale, false, '恢复成功后 stale 标记清除');
  } finally {
    Date.now = realNow;
  }
});

test('路由缓存：TTL 内第二次请求不再打上游', async () => {
  const calls = mockFetch([
    { match: '/user/balance', body: BALANCE_OK },
    { match: '/v1/usage', body: PLAN_OK },
  ]);
  const { ctx, routes } = makeCtx({ creds: { DEEPSEEK_API_KEY: 'sk-test', OPENCODE_GO_API_KEY: 'og-test' } });
  mod.apply(ctx);
  await callRoute(ctx, routes, 'GET');
  await callRoute(ctx, routes, 'GET');
  assert.equal(calls.length, 2, '两轮上游各只请求一次');
});

test('路由 single-flight：并发冷请求共享同一轮上游查询', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const calls = mockFetch([
    { match: '/user/balance', body: BALANCE_OK, delay: gate },
    { match: '/v1/usage', body: PLAN_OK },
  ]);
  const { ctx, routes } = makeCtx({ creds: { DEEPSEEK_API_KEY: 'sk-test', OPENCODE_GO_API_KEY: 'og-test' } });
  mod.apply(ctx);
  const p1 = callRoute(ctx, routes, 'GET');
  const p2 = callRoute(ctx, routes, 'GET');
  const p3 = callRoute(ctx, routes, 'GET');
  release();
  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
  assert.equal(r1.ok && r2.ok && r3.ok, true);
  assert.equal(calls.length, 2, '三路并发只打一轮上游');
});

test('路由守卫：非 GET 返回 405 且带 allow 头', async () => {
  mockFetch([]);
  const { ctx, commands, routes } = makeCtx();
  mod.apply(ctx);
  const out = await callRoute(ctx, routes, 'POST', true);
  assert.equal(out.status, 405);
  assert.equal(out.headers.allow, 'GET');
  assert.match(out.body, /method not allowed/);
});

test('花费统计：采样节流（1 小时内更新，之后追加）与窗口裁剪', () => {
  const { recordBalanceSample } = mod.internals;
  const t0 = new Date(2026, 7, 10, 8, 0, 0).getTime();
  let samples = [];
  samples = recordBalanceSample(samples, t0, 100, 50);
  assert.equal(samples.length, 1);
  // 30 分钟后：同一小时窗口 → 就地更新
  samples = recordBalanceSample(samples, t0 + 30 * 60000, 99, 50);
  assert.equal(samples.length, 1);
  assert.equal(samples[0].total, 99);
  assert.equal(samples[0].t, t0 + 30 * 60000);
  // 2 小时后：追加
  samples = recordBalanceSample(samples, t0 + 2 * 3600000, 95, 50);
  assert.equal(samples.length, 2);
  // 61 天前的旧采样被裁剪（保留至少 1 条）
  const veryOld = new Date(2026, 5, 1, 0, 0, 0).getTime();
  samples = [ { t: veryOld, total: 200, topped: 0 }, ...samples ];
  samples = recordBalanceSample(samples, t0 + 3 * 3600000, 94, 50);
  assert.equal(samples.length, 3, '窗口内采样保留');
  const cutoff = t0 + 3 * 3600000 - 60 * 24 * 3600000;
  assert.ok(samples.every((s) => s.t >= cutoff || samples.indexOf(s) === 0), '60 天窗口外的旧采样被裁剪');
});

test('花费统计：每日花费差分估算（剔除充值、跨午夜对均摊、按采样归属日）', () => {
  const { computeDailySpend } = mod.internals;
  const now = new Date(2026, 7, 15, 12, 0, 0).getTime(); // 2026-08-15（本地时区）
  const samples = [
    { t: new Date(2026, 7, 13, 9, 0, 0).getTime(), total: 100, topped: 50, granted: 40 }, // 8/13 花 10（同日对）
    { t: new Date(2026, 7, 13, 23, 0, 0).getTime(), total: 90, topped: 50, granted: 40 },
    { t: new Date(2026, 7, 14, 9, 0, 0).getTime(), total: 85, topped: 50, granted: 40 }, // 8/13 夜→8/14 早 花 5（跨夜对，均摊两天）
    { t: new Date(2026, 7, 14, 23, 0, 0).getTime(), total: 150, topped: 115, granted: 40 }, // 充值 65 无花费
    { t: new Date(2026, 7, 15, 10, 0, 0).getTime(), total: 148, topped: 115, granted: 40 }, // 8/14 夜→8/15 早 花 2（跨夜对）
  ];
  const days = computeDailySpend(samples, now, 14);
  assert.equal(days.length, 14);
  const byDate = new Map(days.map((d) => [d.date, d.amount]));
  assert.equal(byDate.get('8-13'), 12.5, '8/13：同日对 10 + 跨夜对一半 2.5');
  assert.equal(byDate.get('8-14'), 3.5, '8/14：跨夜对一半 2.5 + 跨夜对一半 1（充值对贡献 0）');
  assert.equal(byDate.get('8-15'), 1, '8/15：跨夜对一半 1');
  assert.equal(days[days.length - 1].date, '8-15', '序列从旧到新，今天在末尾');
});

test('花费统计：消费从充值金扣减时正确计入（Δtopped 为负）', () => {
  const { computeDailySpend } = mod.internals;
  const now = new Date(2026, 7, 15, 12, 0, 0).getTime();
  const samples = [
    { t: new Date(2026, 7, 13, 9, 0, 0).getTime(), total: 90, topped: 50, granted: 40 },
    { t: new Date(2026, 7, 13, 20, 0, 0).getTime(), total: 85, topped: 45, granted: 40 }, // 消费 5 扣 topped
  ];
  const days = computeDailySpend(samples, now, 14);
  assert.equal(new Map(days.map((d) => [d.date, d.amount])).get('8-13'), 5, '消费扣 topped 必须计为花费');
});

test('花费统计：消费从赠送金扣减时正确计入（Δgranted 为负）', () => {
  const { computeDailySpend } = mod.internals;
  const now = new Date(2026, 7, 15, 12, 0, 0).getTime();
  const samples = [
    { t: new Date(2026, 7, 13, 9, 0, 0).getTime(), total: 90, topped: 50, granted: 40 },
    { t: new Date(2026, 7, 13, 20, 0, 0).getTime(), total: 85, topped: 50, granted: 35 }, // 消费 5 扣 granted
  ];
  const days = computeDailySpend(samples, now, 14);
  assert.equal(new Map(days.map((d) => [d.date, d.amount])).get('8-13'), 5, '消费扣 granted 必须计为花费');
});

test('花费统计：纯充值/纯发放不产生花费（正向注入被总额变化抵消）', () => {
  const { computeDailySpend } = mod.internals;
  const now = new Date(2026, 7, 15, 12, 0, 0).getTime();
  const mk = (total, topped, granted) => ({ t: now - 2 * 3600000, total, topped, granted });
  const a1 = mk(90, 50, 40);
  const b1 = { ...mk(155, 115, 40), t: now }; // 充值 65
  const days1 = computeDailySpend([a1, b1], now, 14);
  assert.equal(new Map(days1.map((d) => [d.date, d.amount])).get('8-15'), 0, '充值不应算作花费');
  const a2 = mk(90, 50, 40);
  const b2 = { ...mk(100, 50, 50), t: now }; // 发放 10
  const days2 = computeDailySpend([a2, b2], now, 14);
  assert.equal(new Map(days2.map((d) => [d.date, d.amount])).get('8-15'), 0, '发放不应算作花费');
});

test('花费统计：跨天断档按覆盖天数均摊（不堆到恢复日）', () => {
  const { computeDailySpend } = mod.internals;
  const now = new Date(2026, 7, 15, 12, 0, 0).getTime();
  const samples = [
    { t: new Date(2026, 7, 13, 9, 0, 0).getTime(), total: 100, topped: 50, granted: 40 }, // 8/13 采样
    { t: new Date(2026, 7, 15, 9, 0, 0).getTime(), total: 90, topped: 50, granted: 40 }, // 8/15 恢复（8/14 无采样）
  ];
  const days = computeDailySpend(samples, now, 14);
  const byDate = new Map(days.map((d) => [d.date, d.amount]));
  const share = Math.round((10 / 3) * 100) / 100;
  assert.equal(byDate.get('8-13'), share, '断档区间首日均摊 10/3');
  assert.equal(byDate.get('8-14'), share, '断档日均摊 10/3');
  assert.equal(byDate.get('8-15'), share, '恢复日均摊 10/3');
});

test('花费统计：旧采样无 granted 字段时回退旧口径（Δgranted=0）', () => {
  const { computeDailySpend } = mod.internals;
  const now = new Date(2026, 7, 15, 12, 0, 0).getTime();
  const samples = [
    { t: new Date(2026, 7, 13, 9, 0, 0).getTime(), total: 100, topped: 50 }, // 无 granted（v2 前的旧数据）
    { t: new Date(2026, 7, 13, 20, 0, 0).getTime(), total: 90, topped: 50 },
  ];
  const days = computeDailySpend(samples, now, 14);
  assert.equal(new Map(days.map((d) => [d.date, d.amount])).get('8-13'), 10, '旧数据按 Δtopped−Δtotal 计算');
});

test('路由：成功采样写入花费历史并附每日花费序列到 deepseek provider', async () => {
  const { ctx, routes } = makeCtx({ creds: { DEEPSEEK_API_KEY: 'sk-test' } });
  mod.apply(ctx);
  const realNow = Date.now;
  const t0 = realNow();
  try {
    mockFetch([{ match: '/user/balance', body: BALANCE_OK }]);
    const r1 = await callRoute(ctx, routes, 'GET');
    const ds1 = r1.providers.find((p) => p.id === 'deepseek');
    assert.equal(ds1.ok, true);
    assert.equal(ds1.spend.currency, 'CNY');
    assert.equal(ds1.spend.days.length, 14);
    // 越过 TTL 且超过 1 小时采样节流：第二条采样（余额下降 10，无充值）
    Date.now = () => t0 + 2 * 3600000 + 6000;
    mockFetch([
      {
        match: '/user/balance',
        body: {
          is_available: true,
          balance_infos: [
            { currency: 'CNY', total_balance: '100.00', granted_balance: '10.00', topped_up_balance: '100.00' },
          ],
        },
      },
    ]);
    const r2 = await callRoute(ctx, routes, 'GET');
    const ds2 = r2.providers.find((p) => p.id === 'deepseek');
    const today = ds2.spend.days[ds2.spend.days.length - 1];
    assert.equal(today.amount, 10, '当日花费 = 100 − 90');
    assert.equal(ds2.spend.currency, 'CNY');
  } finally {
    Date.now = realNow;
  }
  // 历史已持久化到临时文件（v2 格式：按 provider 分桶，两条采样）
  assert.ok(existsSync(spendFile), '花费历史文件应已写入');
  const saved = JSON.parse(readFileSync(spendFile, 'utf8'));
  assert.equal(saved.version, 2);
  assert.deepEqual(Object.keys(saved.providers), ['deepseek']);
  assert.equal(saved.providers.deepseek.length, 2);
  assert.equal(saved.providers.deepseek[0].total, 110);
  assert.equal(saved.providers.deepseek[1].total, 100);
});

test('花费存储：旧版纯数组格式自动迁移到 v2 providers.deepseek', () => {
  const { loadSpendStore } = mod.internals;
  const legacy = [{ t: 1, total: 100, topped: 50 }];
  writeFileSync(spendFile, JSON.stringify(legacy), 'utf8');
  const store = loadSpendStore(spendFile);
  assert.equal(store.version, 2);
  assert.equal(store.providers.deepseek.length, 1);
  assert.deepEqual(store.tokens, []);
});

test('适配器解析：Moonshot / 智谱 / OpenRouter 响应 → 统一余额结构', () => {
  const { ADAPTERS } = mod.internals;
  const byId = new Map(ADAPTERS.map((a) => [a.id, a]));
  const moonshot = byId.get('moonshot').parse({
    data: { available_balance: 55.5, voucher_balance: 5, cash_balance: 50.5, currency: 'CNY' },
  });
  assert.equal(moonshot.ok, true);
  assert.deepEqual(moonshot.balances[0], {
    currency: 'CNY',
    total_balance: 55.5,
    granted_balance: 5,
    topped_up_balance: 50.5,
  });
  const zhipu = byId.get('zhipu').parse({
    balance: [{ total: 200, used: 30, available: 170, currency: 'CNY' }],
  });
  assert.equal(zhipu.ok, true);
  assert.equal(zhipu.balances[0].total_balance, 170);
  const openrouter = byId.get('openrouter').parse({ credits: { total: 10, used: 4, remaining: 6 } });
  assert.equal(openrouter.ok, true);
  assert.equal(openrouter.balances[0].total_balance, 6);
  assert.equal(openrouter.balances[0].currency, 'USD');
  // 格式异常 → 错误而非崩溃
  const bad = byId.get('moonshot').parse({ nope: true });
  assert.equal(bad.ok, false);
});

test('路由：凭证探测 —— 只查询并返回已配置凭证的 provider', async () => {
  const calls = mockFetch([
    { match: '/v1/users/me/balance', body: { data: { available_balance: 55.5, currency: 'CNY' } } },
  ]);
  const { ctx, routes } = makeCtx({ creds: { MOONSHOT_API_KEY: 'ms-test' } });
  mod.apply(ctx);
  const payload = await callRoute(ctx, routes, 'GET');
  assert.equal(payload.providers.length, 1, '未配置凭证的 provider 不应出现');
  assert.equal(payload.providers[0].id, 'moonshot');
  assert.equal(calls.length, 1, '只查询已配置的 provider');
});

test('路由：多 provider 独立容错 —— 一个失败不影响其他分区', async () => {
  mockFetch([
    { match: '/user/balance', body: BALANCE_OK },
    { match: '/v1/users/me/balance', error: 'down', status: 502 },
    { match: '/v1/usage', body: PLAN_OK },
  ]);
  const { ctx, routes } = makeCtx({
    creds: { DEEPSEEK_API_KEY: 'sk-test', MOONSHOT_API_KEY: 'ms-test', OPENCODE_GO_API_KEY: 'og-test' },
  });
  mod.apply(ctx);
  const payload = await callRoute(ctx, routes, 'GET');
  const ids = payload.providers.map((p) => p.id);
  assert.deepEqual(ids, ['deepseek', 'moonshot', 'opencode-go']);
  const ds = payload.providers.find((p) => p.id === 'deepseek');
  const ms = payload.providers.find((p) => p.id === 'moonshot');
  const og = payload.providers.find((p) => p.id === 'opencode-go');
  assert.equal(ds.ok, true);
  assert.equal(ms.ok, false);
  assert.match(ms.error, /HTTP 502/);
  assert.equal(og.ok, true);
});

test('Token 统计：按自然日聚合 + 近 N 天序列', () => {
  const { recordTokenDay, computeDailyTokens } = mod.internals;
  const now = new Date(2026, 7, 15, 12, 0, 0).getTime(); // 2026-08-15（本地时区）
  let days = [];
  days = recordTokenDay(days, new Date(2026, 7, 15, 9, 0, 0).getTime(), 1000);
  days = recordTokenDay(days, new Date(2026, 7, 15, 10, 0, 0).getTime(), 2500); // 同日累加
  days = recordTokenDay(days, new Date(2026, 7, 14, 20, 0, 0).getTime(), 500);
  assert.equal(days.length, 2);
  const today = days.find((d) => d.date === '8-15');
  assert.equal(today.tokens, 3500);
  const series = computeDailyTokens(days, now, 14);
  assert.equal(series.length, 14);
  const byDate = new Map(series.map((d) => [d.date, d.tokens]));
  assert.equal(byDate.get('8-15'), 3500);
  assert.equal(byDate.get('8-14'), 500);
  assert.equal(series[series.length - 1].date, '8-15');
});

test('Token 统计：session/event 监听聚合 assistant/message 的 usage 并随路由输出', async () => {
  const { ctx, routes, handlers } = makeCtx({ creds: { DEEPSEEK_API_KEY: 'sk-test' } });
  mod.apply(ctx);
  const evt = handlers.find((h) => h.type === 'session/event');
  assert.ok(evt, 'apply 必须注册 session/event 监听');
  // 真实 DSH 信封：usage 在 event.data.usage（SessionEvent = { type, seq, time, data }）
  const now = Date.now();
  evt.fn(
    {},
    { type: 'assistant/message', seq: 1, time: now, data: { turn: 0, step: 0, message: {}, usage: { inputTokens: 800, outputTokens: 200 } } },
  );
  evt.fn(
    {},
    { type: 'assistant/message', seq: 2, time: now, data: { turn: 0, step: 1, message: {}, usage: { inputTokens: 300, cacheReadTokens: 700 } } },
  );
  evt.fn({}, { type: 'user/message', seq: 3, time: now, data: { message: {} } }); // 非 assistant/message 忽略
  evt.fn({}, { type: 'assistant/message', seq: 4, time: now, data: { turn: 0, step: 2, message: {} } }); // 无 usage 忽略
  mockFetch([{ match: '/user/balance', body: BALANCE_OK }]);
  const payload = await callRoute(ctx, routes, 'GET');
  const today = payload.tokenSpend.days[payload.tokenSpend.days.length - 1];
  assert.equal(today.tokens, 2000, '800+200 + 300+700 聚合到当天');
  // 事件已持久化（v2 文件 tokens 字段）
  const saved = JSON.parse(readFileSync(spendFile, 'utf8'));
  assert.equal(saved.version, 2);
  assert.equal(saved.tokens[0].tokens, 2000);
});

test('/stats：无统计数据时给出提示', async () => {
  const { ctx, commands } = makeCtx();
  mod.apply(ctx);
  const cmd = commands.find((c) => c.name === 'stats');
  const result = await cmd.handler({ rawInput: '', signal: new AbortController().signal });
  assert.equal(result.kind, 'error');
  assert.match(result.text, /暂无统计数据/);
});

test('/stats：读取历史 Token 消耗与金额花费（与路由/事件写入共用存储）', async () => {
  const { ctx, commands, routes, handlers } = makeCtx({ creds: { DEEPSEEK_API_KEY: 'sk-test' } });
  mod.apply(ctx);
  // 1) 路由轮询写入余额采样（两次，跨 >1h，模拟消费）
  const realNow = Date.now;
  const t0 = realNow();
  try {
    mockFetch([
      { match: '/user/balance', body: BALANCE_OK }, // total 110
    ]);
    await callRoute(ctx, routes, 'GET');
    Date.now = () => t0 + 2 * 3600000 + 6000;
    mockFetch([
      {
        match: '/user/balance',
        body: {
          is_available: true,
          balance_infos: [
            { currency: 'CNY', total_balance: '100.00', granted_balance: '10.00', topped_up_balance: '100.00' },
          ],
        },
      },
    ]);
    await callRoute(ctx, routes, 'GET');
    // 2) 会话事件写入 token 统计
    const evt = handlers.find((h) => h.type === 'session/event');
    evt.fn({}, { type: 'assistant/message', seq: 1, time: t0, data: { turn: 0, step: 0, message: {}, usage: { inputTokens: 800, outputTokens: 200 } } });
  } finally {
    Date.now = realNow;
  }
  // 3) /stats 读取
  const cmd = commands.find((c) => c.name === 'stats');
  const result = await cmd.handler({ rawInput: '', signal: new AbortController().signal });
  assert.equal(result.kind, 'success');
  assert.match(result.text, /== Token 消耗（近 7 天）==/);
  assert.match(result.text, /合计\s+1,000 tokens/);
  assert.match(result.text, /== DeepSeek API 金额花费（近 7 天）==/);
  // 花费 110 → 100 = 10.00（跨午夜时按日均摊，但合计恒定）
  assert.match(result.text, /合计\s+10\.00 CNY/);
  // 4) 指定天数
  const r30 = await cmd.handler({ rawInput: '30', signal: new AbortController().signal });
  assert.equal(r30.kind, 'success');
  assert.match(r30.text, /近 30 天/);
});

test('/stats：非法天数参数被拒绝，超界天数被钳制', async () => {
  const { ctx, commands } = makeCtx();
  mod.apply(ctx);
  const cmd = commands.find((c) => c.name === 'stats');
  const bad = await cmd.handler({ rawInput: 'abc', signal: new AbortController().signal });
  assert.equal(bad.kind, 'error');
  assert.match(bad.text, /天数无效/);
  // 超界 999 → 钳到 60：不报“天数无效”，走无数据分支
  const over = await cmd.handler({ rawInput: '999', signal: new AbortController().signal });
  assert.equal(over.kind, 'error');
  assert.doesNotMatch(over.text, /天数无效/);
  assert.match(over.text, /暂无统计数据/);
});

/** 调用路由 handler，返回解析后的 payload（或原始响应记录）。 */async function callRoute(ctx, routes, method, raw = false) {
  const route = routes.find((r) => r.path === '/plugins/balance/state');
  assert.ok(route, '路由应已注册');
  let captured;
  const res = {
    writeHead: (code, headers) => {
      captured = { status: code, headers: headers || {} };
    },
    end: (s) => {
      captured = captured || { status: 200, headers: {} };
      if (!raw) captured.body = JSON.parse(s);
      else captured.body = s;
    },
  };
  await route.handler({ method }, res);
  return raw ? captured : captured.body;
}
