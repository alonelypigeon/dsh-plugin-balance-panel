// 把构建产物原子化同步到运行中的 DSH profile（~/.dsh/profiles/node_modules/<plugin>）。
//
// 为什么原子化：直接逐文件覆盖时，web 服务器可能在文件半更新状态被请求
// （index.js 新 / lib/client.js 旧，或反之），客户端 HMR 会立刻热载一个不一致的
// bundle。本脚本保证：
//   1. 所有文件先写入 <name>.tmp 临时文件（同目录，同卷，rename 原子）；
//   2. 按「先元数据、后 bundle」的顺序逐个 rename 替换（bundle 最后落盘）；
//   3. 替换完成后请求 index.html 打印新旧 boot rev，提示刷新页面。
//
// 用法（插件目录内）：npm run sync
import { copyFileSync, renameSync, readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginDir = join(__dirname, '..');

const pkg = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'));
const name = pkg.name;

// 陈旧 bundle 守卫：源码比产物新时拒绝同步（防止部署未构建的半成品）
const bundlePath = join(pluginDir, 'lib', 'client.js');
if (existsSync(bundlePath)) {
  const bundleMtime = statSync(bundlePath).mtimeMs;
  for (const rel of ['src/client.jsx', 'scripts/bundle.mjs']) {
    const p = join(pluginDir, rel);
    if (existsSync(p) && statSync(p).mtimeMs > bundleMtime + 1000) {
      console.error(`[sync] ${rel} 比 lib/client.js 新 —— 先运行 npm run bundle 再同步`);
      process.exit(1);
    }
  }
} else {
  console.error('[sync] lib/client.js 不存在 —— 先运行 npm run bundle');
  process.exit(1);
}

const profileRoot = process.env.DSH_PROFILE_NODE_MODULES || join(homedir(), '.dsh', 'profiles', 'node_modules');
const destDir = join(profileRoot, name);

// 发布内容（与 package.json files 字段一致）
const FILES = ['index.js', 'package.json', 'README.md', 'LICENSE', 'lib/client.js'];

if (!existsSync(destDir)) {
  console.error(`[sync] 目标目录不存在: ${destDir}`);
  console.error('[sync] 可用 DSH_PROFILE_NODE_MODULES 环境变量覆盖 profile 路径');
  process.exit(1);
}

// 1) 全部写入临时文件
for (const rel of FILES) {
  const src = join(pluginDir, rel);
  const dst = join(destDir, rel);
  if (!existsSync(src)) {
    console.error(`[sync] 源文件缺失: ${src}`);
    process.exit(1);
  }
  mkdirSync(dirname(dst), { recursive: true });
  const tmp = `${dst}.tmp`;
  copyFileSync(src, tmp);
}

// 2) 按顺序原子替换：元数据先，bundle 最后
const order = ['package.json', 'index.js', 'README.md', 'LICENSE', 'lib/client.js'];
for (const rel of order) {
  const dst = join(destDir, rel);
  renameSync(`${dst}.tmp`, dst);
  console.log(`[sync] ${rel} -> ${dst}`);
}

// 3) 打印新旧 boot rev（若有 web 地址）
const webUrl = process.env.DSH_WEB_URL || process.argv[2];
if (webUrl) {
  try {
    const res = await fetch(webUrl);
    const html = await res.text();
    // boot manifest 是嵌套 JSON：用深度扫描取 `__DSH_BOOT__ = { ... };` 完整区间
    const marker = '__DSH_BOOT__ = ';
    const s = html.indexOf(marker);
    if (s >= 0) {
      const open = html.indexOf('{', s);
      let depth = 0;
      let close = -1;
      for (let i = open; i < html.length; i += 1) {
        if (html[i] === '{') depth += 1;
        else if (html[i] === '}') {
          depth -= 1;
          if (depth === 0) {
            close = i;
            break;
          }
        }
      }
      if (close > open) {
        const boot = JSON.parse(html.slice(open, close + 1));
        const row = (boot.entries || []).find((e) => e.id === name);
        if (row) console.log(`[sync] boot rev: ${row.rev} (${row.url})`);
        else console.warn(`[sync] 未在 boot graph 中找到 ${name}`);
      } else {
        console.warn('[sync] 页面中未找到完整的 __DSH_BOOT__ JSON');
      }
    } else {
      console.warn('[sync] 页面中没有 __DSH_BOOT__（不是 DSH web？）');
    }
  } catch (err) {
    console.warn(`[sync] 无法读取 ${webUrl} 的 boot manifest: ${err.message}`);
  }
}

const n = FILES.length;
console.log(`[sync] 完成：${n} 个文件已同步到 ${destDir}`);
console.log('[sync] 刷新浏览器页面加载新 bundle（boot rev 变化即生效）');
