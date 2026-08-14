// 构建 dsh-plugin-balance-panel 的 client bundle：
// esbuild 打包 JSX → CJS，再包装成 dsh-client-modules 要求的
// window.__ModuleLoader__.load({ id, factory }) 工厂格式（与官方 tsdown 产物同构）。
// react / react/jsx-runtime 是平台 seed 词表，标记为 external。
//
// 用法（插件目录内）：npm run bundle
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginDir = join(__dirname, '..');
const entry = join(pluginDir, 'src', 'client.jsx');
const outFile = join(pluginDir, 'lib', 'client.js');

const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom'],
  write: false,
  minify: false,
  logLevel: 'info',
});

const body = result.outputFiles[0].text;

const wrapped = `window.__ModuleLoader__.load({
\tid: "dsh-plugin-balance-panel",
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
${body
  .split('\n')
  .map((line) => (line.length > 0 ? '\t\t' + line : line))
  .join('\n')}
\t\treturn module.exports;
\t}
});
`;

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, wrapped, 'utf8');

// 快速自检：确认导出与格式（esbuild cjs 输出用 __export/__toCommonJS 模式）
const check = readFileSync(outFile, 'utf8');
const hasLoad = check.startsWith('window.__ModuleLoader__.load(');
const hasApply = /apply:\s*\(\)\s*=>\s*apply/.test(check);
const hasInject = /inject:\s*\(\)\s*=>\s*inject/.test(check);
console.log(`[bundle] ${outFile}`);
console.log(`[bundle] __ModuleLoader__ 包装: ${hasLoad ? 'OK' : 'FAIL'}`);
console.log(`[bundle] exports.apply: ${hasApply ? 'OK' : 'FAIL'}`);
console.log(`[bundle] exports.inject: ${hasInject ? 'OK' : 'FAIL'}`);
if (!hasLoad || !hasApply || !hasInject) process.exit(1);
