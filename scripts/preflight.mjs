// 发布/部署前预检（npm publish 时由 prepublishOnly 自动触发，也可手动 npm run preflight）。
//
// 检查项：
//   1. files 字段列出的发布文件全部存在；
//   2. exports["./client"] 指向的 bundle 存在且是 __ModuleLoader__ 契约格式；
//   3. dsh.client 声明完整（platform: web）；
//   4. 【陈旧 bundle 守卫】lib/client.js 不比 src/client.jsx / scripts/bundle.mjs 新 →
//      拒绝继续，提示先 npm run bundle（防止「改了源码忘了重建」直接发布/部署）；
//   5. bundle 语法校验（vm.Script 编译，零子进程）；
//   6. i18n 字典键集一致性：zh/en 键集完全一致（缺键会暴露为未翻译键）。
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginDir = join(__dirname, '..');
const pkgPath = join(pluginDir, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`[preflight] FAIL: ${msg}`);
};
const ok = (msg) => console.log(`[preflight] ok: ${msg}`);

// 1) files 字段完整性
for (const rel of pkg.files ?? []) {
  const p = join(pluginDir, rel);
  if (!existsSync(p)) fail(`files 字段中的 ${rel} 不存在`);
  else ok(`files/${rel}`);
}

// 2) exports["./client"] 契约
const clientRel = pkg.exports?.['./client'];
if (typeof clientRel !== 'string' || !existsSync(join(pluginDir, clientRel))) {
  fail(`exports["./client"] 未指向存在的 bundle（当前: ${String(clientRel)}）`);
} else {
  ok(`exports["./client"] -> ${clientRel}`);
  const code = readFileSync(join(pluginDir, clientRel), 'utf8');
  if (!code.startsWith('window.__ModuleLoader__.load({')) {
    fail('bundle 不是 __ModuleLoader__ 契约格式（应以 load({ 开头）');
  } else {
    ok('bundle 为 __ModuleLoader__ 契约格式');
  }
  if (!/apply:\s*\(\)\s*=>\s*apply/.test(code)) fail('bundle 缺少 exports.apply');
  if (!/inject:\s*\(\)\s*=>\s*inject/.test(code)) fail('bundle 缺少 exports.inject');
}

// 3) dsh.client 声明
const decl = pkg.dsh?.client;
if (!decl || decl.platform !== 'web') fail('dsh.client 声明缺失或 platform 不是 web');
else ok(`dsh.client.platform = ${decl.platform}`);
if (decl && !Array.isArray(decl.inject)) fail('dsh.client.inject 应为字符串数组');
else ok(`dsh.client.inject = ${JSON.stringify(decl?.inject ?? [])}`);

// 4) 陈旧 bundle 守卫
const bundlePath = join(pluginDir, 'lib', 'client.js');
const sources = ['src/client.jsx', 'scripts/bundle.mjs'];
if (existsSync(bundlePath)) {
  const bundleMtime = statSync(bundlePath).mtimeMs;
  let stale = false;
  for (const rel of sources) {
    const p = join(pluginDir, rel);
    if (existsSync(p) && statSync(p).mtimeMs > bundleMtime + 1000) {
      stale = true;
      fail(`${rel} 比 lib/client.js 新 —— 先运行 npm run bundle 再继续`);
    }
  }
  if (!stale) ok('bundle 与源码同步（无陈旧产物）');
} else {
  fail('lib/client.js 不存在 —— 先运行 npm run bundle');
}

// 5) bundle 语法校验（vm 编译，零子进程）
if (existsSync(bundlePath)) {
  try {
    new vm.Script(readFileSync(bundlePath, 'utf8'), { filename: 'lib/client.js' });
    ok('bundle 语法校验通过');
  } catch (err) {
    fail(`bundle 语法错误: ${err.message}`);
  }
}

// 6) i18n 字典键集一致性（zh 为键集源）
const srcPath = join(pluginDir, 'src', 'client.jsx');
if (existsSync(srcPath)) {
  const src = readFileSync(srcPath, 'utf8');
  const zhMatch = src.match(/const zh = (\{[\s\S]*?\n\});/);
  const enMatch = src.match(/const en = (\{[\s\S]*?\n\});/);
  if (!zhMatch || !enMatch) {
    fail('src/client.jsx 中未找到 zh/en 字典（i18n 键集一致性无法校验）');
  } else {
    const zhKeys = Object.keys(Function(`return (${zhMatch[1]})`)()).sort();
    const enKeys = Object.keys(Function(`return (${enMatch[1]})`)()).sort();
    if (zhKeys.length === 0) fail('zh 字典为空');
    else if (JSON.stringify(enKeys) !== JSON.stringify(zhKeys)) {
      fail(`zh/en 键集不一致：zh ${zhKeys.length} 键 / en ${enKeys.length} 键`);
    } else ok(`i18n 字典键集一致（${zhKeys.length} 键）`);
  }
}

console.log('----------------------------------------');
if (failures > 0) {
  console.error(`[preflight] ${failures} 项未通过，请修复后重试。`);
  process.exit(1);
}
console.log(`[preflight] ${pkg.name}@${pkg.version} 预检通过，可以发布/部署。`);
