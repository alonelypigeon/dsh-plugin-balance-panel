// 冒烟：用 mock cordis ctx 加载 ~/.dsh/profiles 里的 dsh-plugin-balance-panel，
// 实测 /balance、/plan 命令与 /plugins/balance/state 路由（真实网络，不回显密钥）。
// 用法：npm run smoke（需 DSH profile 已安装本插件且存在 ~/.dsh/.credentials.yaml）
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';

const credFile = join(os.homedir(), '.dsh', '.credentials.yaml');
const creds = {};
for (const line of readFileSync(credFile, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*['"]?([^'"\s#]+)/);
  if (m) creds[m[1]] = m[2];
}

const commands = [];
const routes = [];
const ctx = {
  commands: { register: (c) => commands.push(c) },
  webServer: { register: (c) => routes.push(c) },
  credentials: { resolve: async (ref) => (creds[ref] ? { value: creds[ref] } : null) },
};

const mod = await import(
  pathToFileURL(join(os.homedir(), '.dsh', 'profiles', 'node_modules', 'dsh-plugin-balance-panel', 'index.js')),
);
mod.apply(ctx);

const balanceCmd = commands.find((c) => c.name === 'balance');
const planCmd = commands.find((c) => c.name === 'plan');
const route = routes.find((r) => r.path === '/plugins/balance/state');
if (!balanceCmd || !planCmd || !route) {
  console.error('register 缺失:', { balanceCmd: !!balanceCmd, planCmd: !!planCmd, route: !!route });
  process.exit(1);
}

console.log('[balance]\n' + JSON.stringify(await balanceCmd.handler({ rawInput: '' }), null, 1));
console.log('[plan]\n' + JSON.stringify(await planCmd.handler({ rawInput: '' }), null, 1));

let out = null;
const res = {
  writeHead: (code, h) => console.log('[route] HTTP', code, h['content-type']),
  end: (s) => {
    out = JSON.parse(s);
  },
};
await route.handler({}, res);
console.log('[route state] ' + JSON.stringify({ ok: out.ok, providers: out.providers }, null, 1));
