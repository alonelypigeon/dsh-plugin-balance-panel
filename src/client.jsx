// @dsh-plugin-balance-panel client half —— 右下角「液态玻璃气泡」+ 右侧「账户余额 / Coding Plan」面板。
//
// 数据来源：host half 注册的 GET /plugins/balance/state（同源 fetch，key 永不出现在响应里）。
// 响应按 provider 分组：{ providers: [ {kind:'balance', …}, {kind:'plan', …} ] }，
// 面板按 provider 分区排列，每个 provider 独立容错。
//
// i18n：注册 'balance' locale namespace（zh 为键集源、en 逐键对照，与上游
// dsh-client-locale 约定一致）；槽位注册带 locale: 'balance'，框架把绑定到该
// namespace 的 t() 注入组件 props，界面文案随 DSH 语言设置即时切换。
//
// 气泡（pill）：
//   - 液态玻璃质感（半透明 + backdrop-filter 毛玻璃 + 高光），内装水；
//   - 水位 = Coding Plan 剩余用量（100 - 月用量 percent），随用量增长逐渐下降；
//   - 水色按剩余量渐变：充足 → 蓝，告警 → 黄，耗尽 → 红；
//   - DSH 推理/流式输出期间（页面 DOM 持续变化）水面波动；
//   - 可拖动（位置持久化），点击打开明细面板。
//
// 气泡与面板各自记住位置：面板默认锚定右下角（right/bottom），不会因
// 气泡被拖到角落而超出屏幕。
import React, { useEffect, useRef, useState } from 'react';

const inject = ['slots', 'locale'];

/** 本插件持有的 locale namespace：槽位注册带 locale 后，组件收到绑定该 namespace 的 t()。 */
const NS = 'balance';

/** zh 字典 —— 键集源（dsh-client-locale 的 Chinese-first 约定）。 */
const zh = {
  'bubble.title': '账户余额 / Coding Plan —— 拖动可移动，点击打开明细',
  'bubble.aria': '账户余额与 Coding Plan 用量',
  'bubble.balance': '余额',
  'bubble.remaining': '{label}剩余',
  'bubble.failed': '查询失败',
  'panel.title': '账户余额',
  'panel.drag': '拖动可移动面板',
  'action.refresh': '刷新',
  'action.collapse': '收起',
  'loading': '加载中…',
  'error.refresh': '刷新失败：{error}',
  'no.providers': '（无 provider 数据）',
  'balance.available': '账户可用',
  'balance.unavailable': '账户不可用',
  'balance.no.details': '（无余额明细）',
  'balance.granted': '赠送 {granted} · 充值 {topped}',
  'plan.title': 'Coding Plan · {label}',
  'plan.error': '用量查询失败：{error}',
  'window.rolling': '5h 滚动',
  'window.weekly': '每周',
  'window.monthly': '每月',
  'stale.hint': '数据可能已过期（最后一次刷新失败）',
  'stale.hint.error': '数据可能已过期（刷新失败：{error}）',
  'spend.title': '每日花费（近 {days} 天）',
  'spend.empty': '（暂无花费数据，页面打开期间自动记录）',
  'token.title': '每日 Token 消耗（近 {days} 天）',
  'token.empty': '（暂无 Token 统计，对话后自动记录）',
  'reset.reached': '已到重置时间',
  'reset.imminent': '即将重置',
  'reset.minutes': '{m} 分钟后重置',
  'reset.hours.minutes': '{h} 小时 {mm} 分后重置',
  'reset.hours': '{h} 小时后重置',
  'reset.at': '{date} 重置',
  'alert.banner': '⚠ 今日花费已超过每日告警阈值 {amount}',
  'alert.off.hint': '用 /balance alert 设置或关闭',
};

/** en 字典 —— 与 zh 键集一一对应（缺键/多键都会在 UI 上暴露为未翻译键）。 */
const en = {
  'bubble.title': 'Account balance / Coding Plan — drag to move, click for details',
  'bubble.aria': 'Account balance and Coding Plan usage',
  'bubble.balance': 'Balance',
  'bubble.remaining': '{label} left',
  'bubble.failed': 'Query failed',
  'panel.title': 'Account Balance',
  'panel.drag': 'Drag to move',
  'action.refresh': 'Refresh',
  'action.collapse': 'Collapse',
  'loading': 'Loading…',
  'error.refresh': 'Refresh failed: {error}',
  'no.providers': '(No provider data)',
  'balance.available': 'Account available',
  'balance.unavailable': 'Account unavailable',
  'balance.no.details': '(No balance details)',
  'balance.granted': 'Granted {granted} · Top-up {topped}',
  'plan.title': 'Coding Plan · {label}',
  'plan.error': 'Usage query failed: {error}',
  'window.rolling': '5h rolling',
  'window.weekly': 'Weekly',
  'window.monthly': 'Monthly',
  'stale.hint': 'Data may be stale (last refresh failed)',
  'stale.hint.error': 'Data may be stale (refresh failed: {error})',
  'spend.title': 'Daily spend (last {days} days)',
  'spend.empty': '(No spend data yet — recorded automatically while the page is open)',
  'token.title': 'Daily token usage (last {days} days)',
  'token.empty': '(No token stats yet — recorded automatically as you chat)',
  'reset.reached': 'Reset time reached',
  'reset.imminent': 'Resetting soon',
  'reset.minutes': '{m} min until reset',
  'reset.hours.minutes': '{h} h {mm} min until reset',
  'reset.hours': '{h} h until reset',
  'reset.at': 'Resets {date}',
  'alert.banner': '⚠ Today\'s spend exceeded the daily alert threshold of {amount}',
  'alert.off.hint': 'Set or disable it with /balance alert',
};

const BUBBLE_POS_KEY = 'dsh-plugin-balance-panel:bubble-pos';
const PANEL_POS_KEY = 'dsh-plugin-balance-panel:panel-pos';
// 旧包名 dsh-balance 的位置键：升级迁移来源（仅气泡/面板各一次回退读取）
const LEGACY_BUBBLE_POS_KEY = 'dsh-balance:bubble-pos';
const LEGACY_PANEL_POS_KEY = 'dsh-balance:panel-pos';
const LEGACY_POS_KEY = 'dsh-balance:pos'; // 更早的共享位置键（仅气泡）
const BUBBLE_SIZE = 64;

const CSS = `
.bl-bubble {
  position: fixed;
  right: 14px;
  bottom: 24px;
  z-index: 60;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: 1px solid var(--dsw-alias-border-l2);
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-3) 45%, transparent);
  backdrop-filter: blur(12px) saturate(1.4);
  -webkit-backdrop-filter: blur(12px) saturate(1.4);
  box-shadow:
    0 8px 28px var(--dsw-alias-bg-mask-2),
    inset 0 1px 0 rgba(255, 255, 255, 0.4),
    inset 0 -8px 14px rgba(0, 0, 0, 0.10);
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.bl-bubble:active { cursor: grabbing; }
.bl-water {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  overflow: hidden;
  transform-origin: bottom;
  transition:
    height 0.9s var(--ds-ease, cubic-bezier(0.4, 0, 0.2, 1)),
    background-color 0.9s var(--ds-ease, cubic-bezier(0.4, 0, 0.2, 1));
}
.bl-water::after {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  height: 3px;
  background: rgba(255, 255, 255, 0.45);
  filter: blur(0.5px);
}
.bl-waves {
  position: absolute;
  left: 0;
  right: 0;
  height: 12px;
  pointer-events: none;
  transition: bottom 0.9s var(--ds-ease, cubic-bezier(0.4, 0, 0.2, 1));
}
.bl-wave {
  position: absolute;
  top: 0;
  left: 0;
  width: 200%;
  height: 100%;
  animation: bl-wave-move 3.2s linear infinite;
}
.bl-wave-2 {
  top: 3px;
  opacity: 0.5;
  animation-duration: 4.6s;
  animation-direction: reverse;
}
@keyframes bl-wave-move {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
.bl-bubble.thinking .bl-water { animation: bl-swell 1.4s ease-in-out infinite; }
.bl-bubble.thinking .bl-waves { animation: bl-waves-bob 1.4s ease-in-out infinite; }
@keyframes bl-swell {
  0%, 100% { transform: scaleY(1); }
  50% { transform: scaleY(1.12); }
}
@keyframes bl-waves-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2px); }
}
.bl-shine {
  position: absolute;
  left: 12%;
  top: 9%;
  width: 34%;
  height: 22%;
  border-radius: 50%;
  background: radial-gradient(ellipse at center, rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0));
  pointer-events: none;
}
.bl-bubble-text {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  pointer-events: none;
  /* 径向暗化遮罩：无论水位是蓝/黄/红，文字下方始终有稳定对比度 */
  background: radial-gradient(ellipse 72% 58% at 50% 52%, rgba(0, 0, 0, 0.32), rgba(0, 0, 0, 0) 72%);
}
.bl-bubble-pct {
  font-size: 15px;
  font-weight: 700;
  line-height: 1;
  color: #fff;
  font-variant-numeric: tabular-nums;
  /* 金额+币种长文本（如 110.00 CNY）限制在气泡宽度内，溢出省略号，保持居中 */
  max-width: 54px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-shadow:
    0 1px 2px rgba(0, 0, 0, 0.65),
    0 0 6px rgba(0, 0, 0, 0.35);
}
.bl-bubble-bal {
  font-size: 10px;
  font-weight: 600;
  line-height: 1.1;
  color: #fff;
  max-width: 54px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-shadow:
    0 1px 2px rgba(0, 0, 0, 0.65),
    0 0 5px rgba(0, 0, 0, 0.35);
}
.bl-panel {
  position: fixed;
  right: 14px;
  bottom: 24px;
  z-index: 60;
  width: 288px;
  max-height: min(72vh, 640px);
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-bg-layer-3);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  box-shadow: 0 12px 40px var(--dsw-alias-bg-mask-2);
  overflow: hidden;
}
.bl-head {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  font-size: 13px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.bl-head:active { cursor: grabbing; }
.bl-head-actions { display: flex; gap: 2px; }
.bl-head button {
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-caption);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 3px 7px;
  border-radius: 6px;
}
.bl-head button:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.bl-body { padding: 12px; font-size: 12.5px; line-height: 20px; color: var(--dsw-alias-label-secondary); overflow-y: auto; }
.bl-provider { margin-top: 10px; }
.bl-provider:first-child { margin-top: 0; }
.bl-provider-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  margin-bottom: 6px;
}
.bl-state { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.bl-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); flex: none; }
.bl-dot.off { background: var(--dsw-alias-state-error-primary); }
.bl-currency {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  padding: 8px 10px;
  margin-top: 6px;
}
.bl-currency-row { display: flex; justify-content: space-between; }
.bl-currency-total { font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.bl-sub { color: var(--dsw-alias-label-caption); font-size: 11.5px; margin-top: 2px; }
.bl-err { color: var(--dsw-alias-state-error-primary); }
.bl-stale { color: var(--dsw-alias-state-warning-primary, #d97706); font-size: 11px; line-height: 16px; margin-bottom: 6px; }
.bl-alert {
  margin-bottom: 10px;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-state-error-primary);
  border-radius: 8px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 18px;
}
.bl-alert ul { margin: 4px 0 0; padding-left: 16px; }
.bl-alert .off-hint { opacity: 0.75; font-size: 11px; }
.bl-loading { color: var(--dsw-alias-label-caption); }
.bl-spend { margin-top: 10px; }
.bl-spend-title { font-size: 11.5px; color: var(--dsw-alias-label-caption); margin-bottom: 4px; }
.bl-spend-bars { display: flex; align-items: flex-end; gap: 2px; height: 44px; }
.bl-spend-col { flex: 1; min-width: 0; height: 100%; display: flex; align-items: flex-end; }
.bl-spend-bar {
  width: 100%;
  min-height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--dsw-alias-state-business-primary, #4176e6);
  transition: height 0.3s var(--ds-ease, cubic-bezier(0.4, 0, 0.2, 1));
}
.bl-spend-bar.zero { background: var(--dsw-alias-interactive-bg-hover); }
.bl-spend-axis {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--dsw-alias-label-caption);
  margin-top: 2px;
  font-variant-numeric: tabular-nums;
}
.bl-plan { margin-top: 8px; }
.bl-window { margin-bottom: 8px; }
.bl-window-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 3px; }
.bl-window-label { color: var(--dsw-alias-label-secondary); }
.bl-window-pct { font-weight: 600; color: var(--dsw-alias-label-primary); }
.bl-window-pct.hot { color: var(--dsw-alias-state-warning-primary, #d97706); }
.bl-window-pct.exhausted { color: var(--dsw-alias-state-error-primary); }
.bl-bar {
  height: 5px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover);
  overflow: hidden;
}
.bl-bar-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--dsw-alias-state-business-primary, #4176e6);
  transition: width 0.3s var(--ds-ease, cubic-bezier(0.4, 0, 0.2, 1));
}
.bl-bar-fill.hot { background: var(--dsw-alias-state-warning-primary, #d97706); }
.bl-bar-fill.exhausted { background: var(--dsw-alias-state-error-primary); }
.bl-window-reset { color: var(--dsw-alias-label-caption); font-size: 11px; margin-top: 1px; }
@media (prefers-reduced-motion: reduce) {
  .bl-wave, .bl-bubble.thinking .bl-water, .bl-bubble.thinking .bl-waves {
    animation: none;
  }
  .bl-water, .bl-waves { transition: none; }
}
`;

if (typeof document !== 'undefined') {
  // 去重守卫：HMR/重载不重复挂样式（与 session-outline 的 data-plugin 约定一致）
  if (!document.head.querySelector('style[data-plugin="dsh-plugin-balance-panel"]')) {
    const tag = document.createElement('style');
    tag.dataset.plugin = 'dsh-plugin-balance-panel';
    tag.textContent = CSS;
    document.head.appendChild(tag);
  }
}

// —— 推理中检测：DSH 流式输出时对话区 DOM 持续变化。
let lastPageActivity = 0;
if (typeof document !== 'undefined') {
  const startObserve = () => {
    if (!document.body) {
      setTimeout(startObserve, 100);
      return;
    }
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        const t = m.target instanceof Element ? m.target : m.target.parentElement;
        if (t && t.closest && t.closest('[data-balance-ui]')) continue;
        lastPageActivity = Date.now();
        return;
      }
    });
    mo.observe(document.body, { subtree: true, childList: true, characterData: true });
  };
  startObserve();
}

async function fetchState() {
  // 15s 客户端超时：即使 host 路由挂起，轮询链也不会断
  const res = await fetch('/plugins/balance/state', {
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function loadPos(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p === 'object' && p && typeof p.x === 'number' && typeof p.y === 'number') {
      return { x: p.x, y: p.y };
    }
  } catch {
    /* ignore */
  }
  return null;
}

// 记忆位置若已落在视口外（窗口缩放/分辨率变化），载入时钳回可见区域
function clampPosToViewport(p, w, h) {
  return {
    x: clampNum(p.x, 4, Math.max(4, window.innerWidth - w - 4)),
    y: clampNum(p.y, 4, Math.max(4, window.innerHeight - h - 4)),
  };
}

function savePos(key, p) {
  try {
    if (p) localStorage.setItem(key, JSON.stringify(p));
    else localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

const clampNum = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const lerp = (a, b, t) => a + (b - a) * t;

// 剩余用量 → 水色：≥50% 蓝 → 20%~50% 蓝渐变到黄 → <20% 黄渐变到红
function usageColor(rem) {
  const r = clampNum(rem ?? 100, 0, 100);
  let h, s, l;
  if (r >= 50) {
    h = 224; s = 76; l = 57;
  } else if (r >= 20) {
    const t = (50 - r) / 30;
    h = lerp(224, 43, t); s = lerp(76, 92, t); l = lerp(57, 50, t);
  } else {
    const t = clampNum((20 - r) / 20, 0, 1);
    h = lerp(43, 2, t); s = lerp(92, 72, t); l = lerp(50, 52, t);
  }
  return `hsla(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%, 0.92)`;
}

// 防御性回退：万一框架未注入 t（例如 DSH 缺 locale 服务或注入时序异常），
// 直读 zh 字典渲染 —— 气泡/面板任何情况下都不能因为翻译缺失而崩掉。
function fallbackT(key, params) {
  let s = zh[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, n) => (n in params ? String(params[n]) : m));
  return s;
}

// 重置时间的人性化显示（文案走 t，随 DSH 语言切换）
function fmtReset(iso, t) {
  if (!iso) return '';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '';
  const diff = ts - Date.now();
  if (diff <= 0) return t('reset.reached');
  const m = Math.round(diff / 60000);
  if (m < 1) return t('reset.imminent');
  if (m < 60) return t('reset.minutes', { m });
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h < 24) return mm > 0 ? t('reset.hours.minutes', { h, mm }) : t('reset.hours', { h });
  return t('reset.at', { date: new Date(iso).toLocaleString() });
}

function PlanWindow({ w, t }) {
  const pct = w.percent === null || w.percent === undefined ? null : Math.max(0, w.percent);
  const cls = pct === null ? '' : w.status !== 'ok' ? ' exhausted' : pct >= 80 ? ' hot' : '';
  const label = pct === null ? '—' : `${pct}%`;
  const reset = fmtReset(w.resetsAt, t);
  return (
    <div className="bl-window">
      <div className="bl-window-row">
        {/* 窗口标签按 key 翻译（rolling/weekly/monthly），不直接展示 host 的 label */}
        <span className="bl-window-label">{t('window.' + w.key)}</span>
        <span className={'bl-window-pct' + cls}>{label}</span>
      </div>
      <div className="bl-bar">
        <div
          className={'bl-bar-fill' + cls}
          style={{ width: pct === null ? '0%' : `${Math.min(pct, 100)}%` }}
        />
      </div>
      {reset && <div className="bl-window-reset">{reset}</div>}
    </div>
  );
}

// 每日花费柱状图（host 本地余额差分估算，近 14 天）
function SpendChart({ t, spend }) {
  const days = (spend && spend.days) || [];
  if (days.length === 0) return <div className="bl-sub">{t('spend.empty')}</div>;
  const max = Math.max(...days.map((d) => d.amount), 0);
  const scale = max > 0 ? max : 1;
  const cur = (spend && spend.currency) || '';
  return (
    <div className="bl-spend">
      <div className="bl-spend-title">{t('spend.title', { days: days.length })}</div>
      <div className="bl-spend-bars">
        {days.map((d) => (
          <div key={d.date} className="bl-spend-col" title={`${d.date} · ${d.amount} ${cur}`.trim()}>
            <div
              className={'bl-spend-bar' + (d.amount <= 0 ? ' zero' : '')}
              style={{ height: `${Math.max(2, (d.amount / scale) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="bl-spend-axis">
        <span>0</span>
        <span>{`${max} ${cur}`.trim()}</span>
      </div>
    </div>
  );
}

// token 数的人性化显示：1.2k / 3.4M
function fmtTokens(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

// 每日 Token 消耗柱状图（DSH session 事件里 provider 报告的 usage 聚合）
function TokenChart({ t, tokenSpend }) {
  const days = (tokenSpend && tokenSpend.days) || [];
  if (days.length === 0) return <div className="bl-sub">{t('token.empty')}</div>;
  const max = Math.max(...days.map((d) => d.tokens), 0);
  const scale = max > 0 ? max : 1;
  return (
    <div className="bl-spend">
      <div className="bl-spend-title">{t('token.title', { days: days.length })}</div>
      <div className="bl-spend-bars">
        {days.map((d) => (
          <div key={d.date} className="bl-spend-col" title={`${d.date} · ${d.tokens} tokens`}>
            <div
              className={'bl-spend-bar' + (d.tokens <= 0 ? ' zero' : '')}
              style={{ height: `${Math.max(2, (d.tokens / scale) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="bl-spend-axis">
        <span>0</span>
        <span>{fmtTokens(max)}</span>
      </div>
    </div>
  );
}

function BalancePanel({ t = fallbackT }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [bubblePos, setBubblePos] = useState(() => {
    // 新键优先，旧包名（dsh-balance）位置键迁移回退
    const p = loadPos(BUBBLE_POS_KEY) || loadPos(LEGACY_BUBBLE_POS_KEY) || loadPos(LEGACY_POS_KEY);
    return p && typeof window !== 'undefined' ? clampPosToViewport(p, BUBBLE_SIZE, BUBBLE_SIZE) : p;
  });
  const [panelPos, setPanelPos] = useState(() => {
    const p = loadPos(PANEL_POS_KEY) || loadPos(LEGACY_PANEL_POS_KEY);
    return p && typeof window !== 'undefined' ? clampPosToViewport(p, 288, 480) : p;
  });
  const [thinking, setThinking] = useState(false);
  const panelRef = useRef(null);
  const drag = useRef(null);
  const bubbleDrag = useRef(null);
  // 轮询退避：成功 30s 一次；失败 10s 快速重试，恢复后回到 30s
  const autoMsRef = useRef(30000);
  const aliveRef = useRef(true);
  const pollTimerRef = useRef(null);

  const scheduleNext = () => {
    if (!aliveRef.current) return;
    // 页面隐藏时不调度：恢复可见时由 visibilitychange 立即刷新（省电/省请求）
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = setTimeout(refresh, autoMsRef.current);
  };

  const refresh = () => {
    if (!aliveRef.current) return;
    setLoading(true);
    fetchState()
      .then((d) => {
        setData(d);
        setError(null);
        setLoading(false);
        autoMsRef.current = 30000;
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
        autoMsRef.current = 10000;
      })
      .finally(scheduleNext);
  };

  useEffect(() => {
    aliveRef.current = true;
    refresh();
    const actTimer = setInterval(() => {
      const v = Date.now() - lastPageActivity < 1500;
      setThinking((prev) => (prev !== v ? v : prev));
    }, 700);
    return () => {
      aliveRef.current = false;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      clearInterval(actTimer);
    };
  }, []);

  // Esc 收起面板
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // 页面隐藏时暂停轮询；恢复可见立即刷新并恢复调度
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        if (pollTimerRef.current) {
          clearTimeout(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      } else {
        refresh();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const bubbleStyle = bubblePos
    ? { left: bubblePos.x, top: bubblePos.y, right: 'auto', bottom: 'auto' }
    : undefined;
  // 面板位置独立：未拖动过时保持默认右下锚定（不会超出屏幕）
  const panelStyle = panelPos
    ? { left: panelPos.x, top: panelPos.y, right: 'auto', bottom: 'auto' }
    : undefined;

  // —— 面板拖拽（按住头部空白处；按钮不参与）——
  const onHeaderPointerDown = (e) => {
    if (e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest('button')) return;
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: rect.left,
      baseY: rect.top,
      pos: { x: rect.left, y: rect.top },
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHeaderPointerMove = (e) => {
    const d = drag.current;
    const el = panelRef.current;
    if (!d || !el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const x = clampNum(d.baseX + e.clientX - d.startX, 4, window.innerWidth - w - 4);
    const y = clampNum(d.baseY + e.clientY - d.startY, 4, window.innerHeight - h - 4);
    d.pos = { x, y };
    setPanelPos(d.pos);
  };
  const onHeaderPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d) savePos(PANEL_POS_KEY, d.pos);
  };

  // —— 气泡拖拽（移动超过阈值才算拖动；否则视为点击打开面板）——
  const onBubblePointerDown = (e) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    bubbleDrag.current = {
      sx: e.clientX,
      sy: e.clientY,
      bx: rect.left,
      by: rect.top,
      moved: false,
      pos: { x: rect.left, y: rect.top },
    };
    el.setPointerCapture(e.pointerId);
  };
  const onBubblePointerMove = (e) => {
    const d = bubbleDrag.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) < 6) return;
    d.moved = true;
    const x = clampNum(d.bx + e.clientX - d.sx, 4, window.innerWidth - BUBBLE_SIZE - 4);
    const y = clampNum(d.by + e.clientY - d.sy, 4, window.innerHeight - BUBBLE_SIZE - 4);
    d.pos = { x, y };
    setBubblePos(d.pos);
  };
  const onBubblePointerUp = () => {
    const d = bubbleDrag.current;
    bubbleDrag.current = null;
    if (!d) return;
    if (d.moved) savePos(BUBBLE_POS_KEY, d.pos);
    else setOpen(true);
  };
  // 键盘可达：Enter / Space 打开面板
  const onBubbleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
    }
  };

  // 按 provider 取数据（面板按 provider 分区排列）
  const providers = (data && data.providers) || [];
  const balProv = providers.find((p) => p.kind === 'balance');
  const planProv = providers.find((p) => p.kind === 'plan');
  const hasPlan = !!planProv && planProv.configured;

  // —— 折叠态：液态玻璃气泡 ——
  if (!open) {
    let rem = null;
    let winLabel = '';
    if (hasPlan && planProv.ok) {
      const win = (planProv.windows || []).find((w) => w.key === 'monthly') || planProv.windows[0];
      if (win && win.percent !== null && win.percent !== undefined) {
        rem = clampNum(100 - win.percent, 0, 100);
        winLabel = t('window.' + win.key);
      }
    }
    const color = usageColor(rem);
    const bal = balProv && balProv.ok && balProv.balances && balProv.balances.length > 0
      ? `${balProv.balances[0].total_balance} ${balProv.balances[0].currency}`
      : null;
    // 余额直接按接口原样显示（金额 + 币种代码），不臆造货币符号
    const pctText = rem === null ? (bal ?? '—') : `${Math.round(rem)}%`;
    const subText = rem === null ? t('bubble.balance') : t('bubble.remaining', { label: winLabel });
    const waterH = rem === null ? 100 : rem;
    return (
      <div
        className={'bl-bubble' + (thinking ? ' thinking' : '')}
        style={bubbleStyle}
        data-balance-ui
        role="button"
        tabIndex={0}
        aria-label={t('bubble.aria')}
        title={t('bubble.title')}
        onPointerDown={onBubblePointerDown}
        onPointerMove={onBubblePointerMove}
        onPointerUp={onBubblePointerUp}
        onPointerCancel={onBubblePointerUp}
        onKeyDown={onBubbleKeyDown}
      >
        <div className="bl-water" style={{ height: `${waterH}%`, color }} />
        <div className="bl-waves" style={{ bottom: `calc(${waterH}% - 6px)`, color }}>
          <svg className="bl-wave" viewBox="0 0 120 20" preserveAspectRatio="none">
            <path fill="currentColor" d="M0,8 C14,0 26,16 40,9 C54,2 66,14 80,8 C94,2 108,12 120,6 L120,20 L0,20 Z" />
          </svg>
          <svg className="bl-wave bl-wave-2" viewBox="0 0 120 20" preserveAspectRatio="none">
            <path fill="currentColor" d="M0,10 C16,2 30,14 44,8 C58,2 72,16 86,9 C100,3 112,12 120,8 L120,20 L0,20 Z" />
          </svg>
        </div>
        <div className="bl-shine" />
        <div className="bl-bubble-text">
          <span className="bl-bubble-pct">{error ? '!' : pctText}</span>
          <span className="bl-bubble-bal">{error ? t('bubble.failed') : subText}</span>
        </div>
      </div>
    );
  }

  // —— 展开态：明细面板（按 provider 分区）——
  return (
    <div className="bl-panel" style={panelStyle} ref={panelRef} data-balance-ui>
      <div
        className="bl-head"
        title={t('panel.drag')}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
      >
        <span>{t('panel.title')}</span>
        <div className="bl-head-actions">
          <button type="button" title={t('action.refresh')} aria-label={t('action.refresh')} onClick={refresh}>
            ↻
          </button>
          <button type="button" title={t('action.collapse')} aria-label={t('action.collapse')} onClick={() => setOpen(false)}>
            ×
          </button>
        </div>
      </div>
      <div className="bl-body">
        {/* 已有数据时后台刷新不再闪烁“加载中”，只覆盖式更新 */}
        {loading && !data && <div className="bl-loading">{t('loading')}</div>}
        {!loading && !data && error && <div className="bl-err">{error}</div>}
        {!data && !loading && !error && providers.length === 0 && <div>{t('no.providers')}</div>}
        {data && (
          <>
            {error && <div className="bl-err">{t('error.refresh', { error })}</div>}
            {data.alert && data.alert.triggered && data.alert.triggered.length > 0 && (
              <div className="bl-alert" role="alert">
                <div>{t('alert.banner', { amount: data.alert.threshold })}</div>
                <ul>
                  {data.alert.triggered.map((tr) => (
                    <li key={tr.id}>
                      {tr.label}：{tr.amount.toFixed(2)} {tr.currency}
                    </li>
                  ))}
                </ul>
                <div className="off-hint">{t('alert.off.hint')}</div>
              </div>
            )}
            {providers.length === 0 && <div>{t('no.providers')}</div>}
            {providers.map((p) =>
              p.kind === 'balance' ? (
            <div className="bl-provider" key={p.id}>
              <div className="bl-provider-title">{p.label}</div>
              {p.ok && p.stale && (
                <div className="bl-stale">{p.error ? t('stale.hint.error', { error: p.error }) : t('stale.hint')}</div>
              )}
              {p.ok ? (
                <>
                  <div className="bl-state">
                    <span className={'bl-dot' + (p.isAvailable ? '' : ' off')} />
                    <span>{p.isAvailable ? t('balance.available') : t('balance.unavailable')}</span>
                  </div>
                  {p.balances && p.balances.length === 0 && <div>{t('balance.no.details')}</div>}
                  {(p.balances || []).map((b) => (
                    <div className="bl-currency" key={b.currency}>
                      <div className="bl-currency-row">
                        <span>{b.currency}</span>
                        <span className="bl-currency-total">{b.total_balance ?? '-'}</span>
                      </div>
                      <div className="bl-sub">
                        {t('balance.granted', { granted: b.granted_balance ?? '-', topped: b.topped_up_balance ?? '-' })}
                      </div>
                    </div>
                  ))}
                  {p.spend && <SpendChart t={t} spend={p.spend} />}
                </>
              ) : (
                <div className="bl-err">{p.error}</div>
              )}
            </div>
          ) : p.kind === 'plan' && p.configured ? (
            <div className="bl-provider" key={p.id}>
              <div className="bl-provider-title">{t('plan.title', { label: p.label })}</div>
              {p.ok && p.stale && (
                <div className="bl-stale">{p.error ? t('stale.hint.error', { error: p.error }) : t('stale.hint')}</div>
              )}
              {p.ok ? (
                <div className="bl-plan">
                  {(p.windows || []).map((w) => <PlanWindow key={w.key} w={w} t={t} />)}
                </div>
              ) : (
                <div className="bl-err">{t('plan.error', { error: p.error })}</div>
              )}
            </div>
          ) : null,
        )}
        {data.tokenSpend && <TokenChart t={t} tokenSpend={data.tokenSpend} />}
          </>
        )}
      </div>
    </div>
  );
}

function apply(ctx) {
  // locale 服务存在才注册字典并声明 namespace；缺失时回退 zh 直读（fallbackT），
  // 面板照常工作 —— 老版本 DSH 或注入时序异常都不能让气泡消失。
  const hasLocale = !!(ctx && ctx.locale && typeof ctx.locale.register === 'function');
  if (hasLocale) {
    // 注册字典 namespace（disposer 挂进 effect：插件卸载时注销，避免重载重复注册抛错）
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-plugin-balance-panel: dictionaries');
  }
  ctx.slots.inject(
    'shell.overlay',
    () =>
      ctx.slots.register(
        {
          name: 'shell.overlay',
          id: 'balance-panel',
          order: 110,
          // 声明 locale namespace：框架把绑定 balance 字典的 t() 注入组件 props
          ...(hasLocale ? { locale: NS } : {}),
        },
        BalancePanel,
      ),
  );
}

export { apply, inject };
