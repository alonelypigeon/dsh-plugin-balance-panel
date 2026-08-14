// dsh-balance client bundle 契约测试。
//
// 不依赖 jsdom：在 vm 沙箱里执行 lib/client.js，验证
//   1. 以 window.__ModuleLoader__.load({ id, factory }) 注册（dsh-client-modules 契约）；
//   2. factory 在注入 react 之后导出 { apply, inject }；
//   3. inject = ['slots', 'locale']（服务声明，guard 门面按此放行 ctx.slots / ctx.locale）；
//   4. apply(ctx) 注册 'balance' locale namespace（zh 键集源，en 键集一致），
//      并在 shell.overlay（list/root）槽位声明 locale: 'balance'，id/order 正确；
//   5. 未打包前的 src 与打包产物中的关键行为一致（标记字符串抽样）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const pluginDir = join(here, '..');
const bundlePath = join(pluginDir, 'lib', 'client.js');
const sourcePath = join(pluginDir, 'src', 'client.jsx');

/** 在沙箱里执行 bundle，返回模块导出（apply/inject）。 */
function loadBundle() {
  const code = readFileSync(bundlePath, 'utf8');
  let handoff = null;
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load: (h) => {
          handoff = h;
        },
      },
    },
    document: undefined,
    console,
  };
  vm.runInNewContext(code, sandbox, { filename: 'lib/client.js' });
  assert.ok(handoff, 'bundle 必须调用 window.__ModuleLoader__.load()');
  assert.equal(handoff.id, 'dsh-plugin-balance-panel');
  assert.equal(typeof handoff.factory, 'function');

  const seen = [];
  const requireStub = (spec) => {
    seen.push(spec);
    return { default: {} };
  };
  const module = { exports: {} };
  const exports = handoff.factory(requireStub);
  return { exports, seen };
}

test('bundle 以 __ModuleLoader__ 契约注册且导出 apply/inject', () => {
  const code = readFileSync(bundlePath, 'utf8');
  assert.ok(code.startsWith('window.__ModuleLoader__.load({'), '必须以 load({ 开头');
  const { exports, seen } = loadBundle();
  assert.ok(Array.isArray(exports.inject), 'inject 必须是数组');
  assert.deepEqual([...exports.inject], ['slots', 'locale'], '需声明 slots 与 locale 服务');
  assert.equal(typeof exports.apply, 'function', 'apply 必须是函数');
  // react 是平台 seed 词表：factory 只应 require 平台词（不允许跨插件值导入）
  for (const spec of seen) {
    assert.ok(
      ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'].includes(spec),
      `不允许 require 平台 seed 之外的模块: ${spec}`,
    );
  }
});

test('apply 注册 balance 字典并声明 shell.overlay 槽位 locale（id=balance-panel, order=110）', () => {
  const { exports } = loadBundle();
  let injected = null;
  let registeredNs = null;
  const fakeCtx = {
    slots: {
      inject: (name, callback) => {
        injected = { name, callback };
      },
      register: (options, component) => {
        injected.register = { options, component };
        return () => {};
      },
    },
    locale: {
      register: (ns, dicts) => {
        registeredNs = { ns, dicts };
        return () => {};
      },
    },
    effect: (callback, label) => {
      // 模拟 cordis effect：立即执行回调并持有其返回的 disposer
      fakeCtx.effect.calls = [...(fakeCtx.effect.calls || []), { label, disposer: callback() }];
    },
  };
  exports.apply(fakeCtx);
  // 字典注册：namespace 为 balance，zh/en 键集完全一致
  assert.ok(registeredNs, 'apply 必须调用 ctx.locale.register');
  assert.equal(registeredNs.ns, 'balance');
  const zhKeys = Object.keys(registeredNs.dicts.zh).sort();
  const enKeys = Object.keys(registeredNs.dicts.en).sort();
  assert.ok(zhKeys.length > 10, 'zh 字典应有完整键集');
  assert.deepEqual(enKeys, zhKeys, 'en 字典键集必须与 zh 一致（缺键会暴露为未翻译键）');
  // 槽位注册：shell.overlay + locale 声明
  assert.ok(injected, 'apply 必须调用 ctx.slots.inject');
  assert.equal(injected.name, 'shell.overlay', '必须注册进 shell.overlay');
  injected.callback();
  assert.ok(injected.register, 'inject 回调必须调用 ctx.slots.register');
  assert.equal(injected.register.options.name, 'shell.overlay');
  assert.equal(injected.register.options.id, 'balance-panel');
  assert.equal(injected.register.options.order, 110);
  assert.equal(injected.register.options.locale, 'balance', '槽位必须声明 locale namespace');
  assert.equal(typeof injected.register.component, 'function');
  // 字典注册走 effect 生命周期（卸载时可注销，重载不重复注册）
  assert.equal(fakeCtx.effect.calls.length, 1);
  assert.equal(typeof fakeCtx.effect.calls[0].disposer, 'function');
});

test('apply 在缺少 locale 服务时回退：不声明 locale、不注册字典，apply 不抛', () => {
  const { exports } = loadBundle();
  let injected = null;
  const fakeCtx = {
    slots: {
      inject: (name, callback) => {
        injected = { name, callback };
      },
      register: (options, component) => {
        injected.register = { options, component };
        return () => {};
      },
    },
    // 无 locale / 无 effect：模拟旧版 DSH 或注入缺失
  };
  assert.doesNotThrow(() => exports.apply(fakeCtx));
  injected.callback();
  assert.equal(injected.register.options.locale, undefined, '无 locale 服务时不应声明 locale');
  assert.equal(typeof injected.register.component, 'function');
});

test('打包产物与 src 保持同步（关键行为标记抽样）', () => {
  const bundle = readFileSync(bundlePath, 'utf8');
  const src = readFileSync(sourcePath, 'utf8');
  for (const needle of [
    '/plugins/balance/state',
    'dsh-plugin-balance-panel:bubble-pos',
    'dsh-plugin-balance-panel:panel-pos',
    // 旧包名位置键保留为迁移回退源
    'dsh-balance:bubble-pos',
    'dsh-balance:panel-pos',
    'shell.overlay',
    'balance-panel',
    'data-balance-ui',
    'prefers-reduced-motion',
    'locale.register',
    'window.monthly',
    'bubble.aria',
    'stale.hint',
    'visibilitychange',
    'spend.title',
    'spend.empty',
    'bl-spend-bars',
    'fallbackT',
  ]) {
    assert.ok(bundle.includes(needle), `bundle 应包含 ${needle}`);
    assert.ok(src.includes(needle), `src 应包含 ${needle}`);
  }
});
