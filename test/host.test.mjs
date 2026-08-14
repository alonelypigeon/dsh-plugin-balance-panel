// dsh-plugin-balance-panel host half 测试。
//
// 直接 import 本插件的 index.js（@deepseek-ai/dsh-credentials、dsh-home-paths
// 解析自 devDependencies / node_modules），用 mock cordis ctx + mock global fetch
// 实测：命令 /balance /plan、数据路由 /plugins/balance/state（含 405 守卫、
// TTL 缓存、single-flight、provider 独立容错与陈旧回退）、每日花费统计（采样
// 记录 + 差分估算 + 文件持久化）、以及 ctx.effect 生命周期（停止后注销、重载
// 不因重复路由而抛错）。全程无真实网络与密钥。
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { existsSync, readFileSync, rmSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const pluginIndex = pathToFileURL(join(here, '..', 'index.js'));

/** 模拟 cordis ctx：commands/credentials/webServer + effect 生命周期。 */
function makeCtx({ creds = {} } = {}) {
  const commands = [];
  const routes = [];
  const disposers = [];
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
    },
    effect(callback) {
      const gen = callback();
      let step = gen.next();
      while (!step.done) {
        disposers.push(step.value);
        step = gen.next();
      }
    },
  };
  return { ctx, commands, routes, stop: () => [...disposers].reverse().forEach((d) => d && d()) };
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

test('apply 经 ctx.effect 注册两命令 + 一路由，stop 后全部注销', async () => {
  const { ctx, commands, routes, stop } = makeCtx();
  mod.apply(ctx);
  assert.equal(commands.length, 2);
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
  assert.match(result.text, /Coding Plan（OpenCode Go）：每月 97%（5h 16% \/ 每周 12%）/);
  assert.equal(calls.length, 2);
});

test('/balance 失败：凭证缺失给出可操作提示', async () => {
  mockFetch([]);
  const { ctx, commands, routes } = makeCtx();
  mod.apply(ctx);
  const cmd = commands.find((c) => c.name === 'balance');
  const result = await cmd.handler({ rawInput: '', signal: new AbortController().signal });
  assert.equal(result.kind, 'error');
  assert.match(result.text, /未找到凭证 DEEPSEEK_API_KEY/);
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
  assert.equal(result.text, '操作已取消');
});

test('/plan 未配置时给出指引', async () => {
  const { ctx, commands, routes } = makeCtx();
  mod.apply(ctx);
  const cmd = commands.find((c) => c.name === 'plan');
  const result = await cmd.handler({ rawInput: '', signal: new AbortController().signal });
  assert.equal(result.kind, 'error');
  assert.match(result.text, /未配置 OPENCODE_GO_API_KEY/);
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

test('花费统计：每日花费差分估算（剔除充值、钳制 ≥ 0、按采样归属日）', () => {
  const { computeDailySpend } = mod.internals;
  const now = new Date(2026, 7, 15, 12, 0, 0).getTime(); // 2026-08-15（本地时区）
  const samples = [
    { t: new Date(2026, 7, 13, 9, 0, 0).getTime(), total: 100, topped: 50 }, // 8/13 花 10
    { t: new Date(2026, 7, 13, 23, 0, 0).getTime(), total: 90, topped: 50 },
    { t: new Date(2026, 7, 14, 9, 0, 0).getTime(), total: 85, topped: 50 }, // 8/14 花 5，然后充值 65
    { t: new Date(2026, 7, 14, 23, 0, 0).getTime(), total: 150, topped: 115 }, // Δtopped−Δtotal = 65−65 = 0
    { t: new Date(2026, 7, 15, 10, 0, 0).getTime(), total: 148, topped: 115 }, // 8/15 花 2
  ];
  const days = computeDailySpend(samples, now, 14);
  assert.equal(days.length, 14);
  const byDate = new Map(days.map((d) => [d.date, d.amount]));
  assert.equal(byDate.get('8-13'), 10, '8/13 花费 10');
  assert.equal(byDate.get('8-14'), 5, '8/14 的花费 5（8/13 夜到 8/14 早的差分归属 8/14）；充值对贡献 0');
  assert.equal(byDate.get('8-15'), 2, '8/15 花费 2');
  assert.equal(days[days.length - 1].date, '8-15', '序列从旧到新，今天在末尾');
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
  // 历史已持久化到临时文件（两条采样）
  assert.ok(existsSync(spendFile), '花费历史文件应已写入');
  const saved = JSON.parse(readFileSync(spendFile, 'utf8'));
  assert.equal(saved.length, 2);
  assert.equal(saved[0].total, 110);
  assert.equal(saved[1].total, 100);
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
