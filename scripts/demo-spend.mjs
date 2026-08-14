// 金额变化演示：用 mock 上游驱动完整路由链路，模拟一周的余额变化
// （消费扣充值金 / 充值 / 消费扣赠送金 / 断档均摊），打印路由 payload 实算的
// 每日花费序列并与期望对照。不改动任何真实数据（花费历史写到临时文件）。
//
// 用法：node scripts/demo-spend.mjs
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const pluginIndex = pathToFileURL(join(here, '..', 'index.js'));
const mod = await import(pluginIndex);

// —— mock cordis ctx（简版：commands/webServer/credentials/effect/on）——
function makeCtx(creds) {
  const commands = [];
  const routes = [];
  const disposers = [];
  const ctx = {
    commands: { register: (d) => (commands.push(d), () => {}) },
    webServer: {
      register: (r) => {
        routes.push(r);
        return () => {};
      },
    },
    credentials: {
      resolve: async (ref) => (creds[ref] ? { value: creds[ref], source: 'demo' } : undefined),
      describe: async (ref) => ({ configured: !!creds[ref] }),
    },
    effect(cb) {
      const gen = cb();
      let step = gen.next();
      while (!step.done) {
        disposers.push(step.value);
        step = gen.next();
      }
    },
    on: () => () => {},
  };
  return { ctx, routes };
}

// —— mock 上游：可变余额状态，每次 /user/balance 返回当前值 ——
// 字段名与 DeepSeek 官方响应一致：total_balance / granted_balance / topped_up_balance
let live = { total_balance: '100.00', granted_balance: '0.00', topped_up_balance: '100.00' };
globalThis.fetch = async (url) => {
  if (String(url).includes('/user/balance')) {
    return Response.json({
      is_available: true,
      balance_infos: [{ currency: 'CNY', ...live }],
    });
  }
  return new Response('not found', { status: 404 });
};

const spendFile = join(tmpdir(), `dsh-balance-demo-${process.pid}.json`);
process.env.DSH_BALANCE_SPEND_FILE = spendFile;
rmSync(spendFile, { force: true });

const { ctx, routes } = makeCtx({ DEEPSEEK_API_KEY: 'sk-demo' });
mod.apply(ctx);
const route = routes.find((r) => r.path === '/plugins/balance/state');

// —— 时间轴：8-10 ~ 8-14（本地时区），消费/充值/断档 ——
// 期望值按既定口径计算：同日对全记当天；跨午夜对（如 8-10 15:00 → 8-11 11:00）
// 均摊两天；跨天断档（8-13 无采样）按覆盖天数均摊。
const D0 = new Date(2026, 7, 10, 9, 0, 0).getTime(); // 2026-08-10 09:00
const timeline = [
  { t: D0, label: '首次采样', total_balance: '100.00', granted_balance: '0.00', topped_up_balance: '100.00', expect: null },
  { t: D0 + 6 * 3600000, label: '消费 3.50（扣充值金，同日对）', total_balance: '96.50', granted_balance: '0.00', topped_up_balance: '100.00', expect: 3.5 },
  { t: D0 + 26 * 3600000, label: '消费 2.00（跨夜对，均摊 8-10/8-11 各 1.00）', total_balance: '94.50', granted_balance: '0.00', topped_up_balance: '100.00', expect: 1.0 },
  { t: D0 + 34 * 3600000, label: '充值 50.00（不计花费）', total_balance: '144.50', granted_balance: '0.00', topped_up_balance: '150.00', expect: 0 },
  { t: D0 + 51 * 3600000, label: '消费 1.20（扣赠送金，跨夜对均摊 8-11/8-12 各 0.60）', total_balance: '143.30', granted_balance: '-1.20', topped_up_balance: '150.00', expect: 0.6 },
  // 8-13 无采样（页面未开）
  { t: D0 + 99 * 3600000, label: '消费 4.30（断档 3 天，均摊 8-12/13/14 各 1.43）', total_balance: '139.00', granted_balance: '-1.20', topped_up_balance: '150.00', expect: 4.3 / 3 },
];

const realNow = Date.now;
let payload;
try {
  for (const step of timeline) {
    live = { total_balance: step.total_balance, granted_balance: step.granted_balance, topped_up_balance: step.topped_up_balance };
    Date.now = () => step.t;
    let out;
    const res = {
      writeHead: () => {},
      end: (s) => {
        out = JSON.parse(s);
      },
    };
    await route.handler({ method: 'GET' }, res);
    payload = out;
  }
} finally {
  Date.now = realNow;
}

// —— 输出 ——
const ds = payload.providers.find((p) => p.id === 'deepseek');
const byDate = new Map(ds.spend.days.map((d) => [d.date, d.amount]));
console.log('=== 金额变化演示（mock 上游 · 完整路由链路 · 临时文件）===');
console.log('时间线：');
for (const step of timeline) {
  const d = new Date(step.t);
  const day = `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:00`;
  console.log(`  ${day}  余额 ${step.total_balance}  → ${step.label}`);
}
// 期望值（既定口径）：同日对全记当天；跨午夜对均摊两天；断档（8-13 无采样）按覆盖天数均摊
const expected = {
  '8-10': 4.5, // 3.5（同日对）+ 2.0 跨夜对的一半 1.0
  '8-11': 1.6, // 2.0 跨夜对的一半 1.0 + 1.2 跨夜对的一半 0.6
  '8-12': 2.03, // 1.2 跨夜对的一半 0.6 + 4.3 断档均摊 1.43
  '8-13': 1.43, // 4.3 断档均摊（页面未开）
  '8-14': 1.43, // 4.3 断档均摊
};
console.log('\n路由 payload 实算的每日花费（近 14 天序列，仅显示演示覆盖的日）：');
let allOk = true;
for (const [date, amount] of byDate) {
  if (!(date in expected)) continue;
  const exp = expected[date];
  const ok = Math.abs(amount - exp) < 0.01;
  if (!ok) allOk = false;
  console.log(`  ${date}   ¥${amount.toFixed(2)}   期望 ¥${exp.toFixed(2)}   ${ok ? '✓' : '✗'}`);
}
console.log('----------------------------------------');
console.log(allOk ? '[demo] 金额变化全部符合期望 ✓（消费记入、充值不计、断档均摊）' : '[demo] 存在偏差 ✗');
process.exit(allOk ? 0 : 1);
