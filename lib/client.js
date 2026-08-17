window.__ModuleLoader__.load({
	id: "dsh-plugin-balance-panel",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __export = (target, all) => {
		  for (var name in all)
		    __defProp(target, name, { get: all[name], enumerable: true });
		};
		var __copyProps = (to, from, except, desc) => {
		  if (from && typeof from === "object" || typeof from === "function") {
		    for (let key of __getOwnPropNames(from))
		      if (!__hasOwnProp.call(to, key) && key !== except)
		        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
		  }
		  return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
		  // If the importer is in node compatibility mode or this is not an ESM
		  // file that has been converted to a CommonJS file using a Babel-
		  // compatible transform (i.e. "__esModule" has not been set), then set
		  // "default" to the CommonJS "module.exports" for node compatibility.
		  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
		  mod
		));
		var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

		// src/client.jsx
		var client_exports = {};
		__export(client_exports, {
		  apply: () => apply,
		  inject: () => inject
		});
		module.exports = __toCommonJS(client_exports);
		var import_react = __toESM(require("react"), 1);
		var import_jsx_runtime = require("react/jsx-runtime");
		var inject = ["slots", "locale"];
		var NS = "balance";
		var zh = {
		  "bubble.title": "\u8D26\u6237\u4F59\u989D / Coding Plan \u2014\u2014 \u62D6\u52A8\u53EF\u79FB\u52A8\uFF0C\u70B9\u51FB\u6253\u5F00\u660E\u7EC6",
		  "bubble.aria": "\u8D26\u6237\u4F59\u989D\u4E0E Coding Plan \u7528\u91CF",
		  "bubble.balance": "\u4F59\u989D",
		  "bubble.remaining": "{label}\u5269\u4F59",
		  "bubble.failed": "\u67E5\u8BE2\u5931\u8D25",
		  "panel.title": "\u8D26\u6237\u4F59\u989D",
		  "panel.drag": "\u62D6\u52A8\u53EF\u79FB\u52A8\u9762\u677F",
		  "action.refresh": "\u5237\u65B0",
		  "action.collapse": "\u6536\u8D77",
		  "loading": "\u52A0\u8F7D\u4E2D\u2026",
		  "error.refresh": "\u5237\u65B0\u5931\u8D25\uFF1A{error}",
		  "no.providers": "\uFF08\u65E0 provider \u6570\u636E\uFF09",
		  "balance.available": "\u8D26\u6237\u53EF\u7528",
		  "balance.unavailable": "\u8D26\u6237\u4E0D\u53EF\u7528",
		  "balance.no.details": "\uFF08\u65E0\u4F59\u989D\u660E\u7EC6\uFF09",
		  "balance.granted": "\u8D60\u9001 {granted} \xB7 \u5145\u503C {topped}",
		  "plan.title": "Coding Plan \xB7 {label}",
		  "plan.error": "\u7528\u91CF\u67E5\u8BE2\u5931\u8D25\uFF1A{error}",
		  "window.rolling": "5h \u6EDA\u52A8",
		  "window.weekly": "\u6BCF\u5468",
		  "window.monthly": "\u6BCF\u6708",
		  "stale.hint": "\u6570\u636E\u53EF\u80FD\u5DF2\u8FC7\u671F\uFF08\u6700\u540E\u4E00\u6B21\u5237\u65B0\u5931\u8D25\uFF09",
		  "stale.hint.error": "\u6570\u636E\u53EF\u80FD\u5DF2\u8FC7\u671F\uFF08\u5237\u65B0\u5931\u8D25\uFF1A{error}\uFF09",
		  "spend.title": "\u6BCF\u65E5\u82B1\u8D39\uFF08\u8FD1 {days} \u5929\uFF09",
		  "spend.empty": "\uFF08\u6682\u65E0\u82B1\u8D39\u6570\u636E\uFF0C\u9875\u9762\u6253\u5F00\u671F\u95F4\u81EA\u52A8\u8BB0\u5F55\uFF09",
		  "token.title": "\u6BCF\u65E5 Token \u6D88\u8017\uFF08\u8FD1 {days} \u5929\uFF09",
		  "token.empty": "\uFF08\u6682\u65E0 Token \u7EDF\u8BA1\uFF0C\u5BF9\u8BDD\u540E\u81EA\u52A8\u8BB0\u5F55\uFF09",
		  "reset.reached": "\u5DF2\u5230\u91CD\u7F6E\u65F6\u95F4",
		  "reset.imminent": "\u5373\u5C06\u91CD\u7F6E",
		  "reset.minutes": "{m} \u5206\u949F\u540E\u91CD\u7F6E",
		  "reset.hours.minutes": "{h} \u5C0F\u65F6 {mm} \u5206\u540E\u91CD\u7F6E",
		  "reset.hours": "{h} \u5C0F\u65F6\u540E\u91CD\u7F6E",
		  "reset.at": "{date} \u91CD\u7F6E",
		  "alert.banner": "\u26A0 \u4ECA\u65E5\u82B1\u8D39\u5DF2\u8D85\u8FC7\u6BCF\u65E5\u544A\u8B66\u9608\u503C {amount}",
		  "alert.off.hint": "\u7528 /balance alert \u8BBE\u7F6E\u6216\u5173\u95ED"
		};
		var en = {
		  "bubble.title": "Account balance / Coding Plan \u2014 drag to move, click for details",
		  "bubble.aria": "Account balance and Coding Plan usage",
		  "bubble.balance": "Balance",
		  "bubble.remaining": "{label} left",
		  "bubble.failed": "Query failed",
		  "panel.title": "Account Balance",
		  "panel.drag": "Drag to move",
		  "action.refresh": "Refresh",
		  "action.collapse": "Collapse",
		  "loading": "Loading\u2026",
		  "error.refresh": "Refresh failed: {error}",
		  "no.providers": "(No provider data)",
		  "balance.available": "Account available",
		  "balance.unavailable": "Account unavailable",
		  "balance.no.details": "(No balance details)",
		  "balance.granted": "Granted {granted} \xB7 Top-up {topped}",
		  "plan.title": "Coding Plan \xB7 {label}",
		  "plan.error": "Usage query failed: {error}",
		  "window.rolling": "5h rolling",
		  "window.weekly": "Weekly",
		  "window.monthly": "Monthly",
		  "stale.hint": "Data may be stale (last refresh failed)",
		  "stale.hint.error": "Data may be stale (refresh failed: {error})",
		  "spend.title": "Daily spend (last {days} days)",
		  "spend.empty": "(No spend data yet \u2014 recorded automatically while the page is open)",
		  "token.title": "Daily token usage (last {days} days)",
		  "token.empty": "(No token stats yet \u2014 recorded automatically as you chat)",
		  "reset.reached": "Reset time reached",
		  "reset.imminent": "Resetting soon",
		  "reset.minutes": "{m} min until reset",
		  "reset.hours.minutes": "{h} h {mm} min until reset",
		  "reset.hours": "{h} h until reset",
		  "reset.at": "Resets {date}",
		  "alert.banner": "\u26A0 Today's spend exceeded the daily alert threshold of {amount}",
		  "alert.off.hint": "Set or disable it with /balance alert"
		};
		var BUBBLE_POS_KEY = "dsh-plugin-balance-panel:bubble-pos";
		var PANEL_POS_KEY = "dsh-plugin-balance-panel:panel-pos";
		var LEGACY_BUBBLE_POS_KEY = "dsh-balance:bubble-pos";
		var LEGACY_PANEL_POS_KEY = "dsh-balance:panel-pos";
		var LEGACY_POS_KEY = "dsh-balance:pos";
		var BUBBLE_SIZE = 64;
		var CSS = `
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
		  /* \u5F84\u5411\u6697\u5316\u906E\u7F69\uFF1A\u65E0\u8BBA\u6C34\u4F4D\u662F\u84DD/\u9EC4/\u7EA2\uFF0C\u6587\u5B57\u4E0B\u65B9\u59CB\u7EC8\u6709\u7A33\u5B9A\u5BF9\u6BD4\u5EA6 */
		  background: radial-gradient(ellipse 72% 58% at 50% 52%, rgba(0, 0, 0, 0.32), rgba(0, 0, 0, 0) 72%);
		}
		.bl-bubble-pct {
		  font-size: 15px;
		  font-weight: 700;
		  line-height: 1;
		  color: #fff;
		  font-variant-numeric: tabular-nums;
		  /* \u91D1\u989D+\u5E01\u79CD\u957F\u6587\u672C\uFF08\u5982 110.00 CNY\uFF09\u9650\u5236\u5728\u6C14\u6CE1\u5BBD\u5EA6\u5185\uFF0C\u6EA2\u51FA\u7701\u7565\u53F7\uFF0C\u4FDD\u6301\u5C45\u4E2D */
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
		if (typeof document !== "undefined") {
		  if (!document.head.querySelector('style[data-plugin="dsh-plugin-balance-panel"]')) {
		    const tag = document.createElement("style");
		    tag.dataset.plugin = "dsh-plugin-balance-panel";
		    tag.textContent = CSS;
		    document.head.appendChild(tag);
		  }
		}
		var lastPageActivity = 0;
		if (typeof document !== "undefined") {
		  const startObserve = () => {
		    if (!document.body) {
		      setTimeout(startObserve, 100);
		      return;
		    }
		    const mo = new MutationObserver((muts) => {
		      for (const m of muts) {
		        const t = m.target instanceof Element ? m.target : m.target.parentElement;
		        if (t && t.closest && t.closest("[data-balance-ui]")) continue;
		        lastPageActivity = Date.now();
		        return;
		      }
		    });
		    mo.observe(document.body, { subtree: true, childList: true, characterData: true });
		  };
		  startObserve();
		}
		async function fetchState() {
		  const res = await fetch("/plugins/balance/state", {
		    cache: "no-store",
		    signal: AbortSignal.timeout(15e3)
		  });
		  if (!res.ok) throw new Error(`HTTP ${res.status}`);
		  return res.json();
		}
		function loadPos(key) {
		  try {
		    const raw = localStorage.getItem(key);
		    if (!raw) return null;
		    const p = JSON.parse(raw);
		    if (typeof p === "object" && p && typeof p.x === "number" && typeof p.y === "number") {
		      return { x: p.x, y: p.y };
		    }
		  } catch {
		  }
		  return null;
		}
		function clampPosToViewport(p, w, h) {
		  return {
		    x: clampNum(p.x, 4, Math.max(4, window.innerWidth - w - 4)),
		    y: clampNum(p.y, 4, Math.max(4, window.innerHeight - h - 4))
		  };
		}
		function savePos(key, p) {
		  try {
		    if (p) localStorage.setItem(key, JSON.stringify(p));
		    else localStorage.removeItem(key);
		  } catch {
		  }
		}
		var clampNum = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
		var lerp = (a, b, t) => a + (b - a) * t;
		function usageColor(rem) {
		  const r = clampNum(rem ?? 100, 0, 100);
		  let h, s, l;
		  if (r >= 50) {
		    h = 224;
		    s = 76;
		    l = 57;
		  } else if (r >= 20) {
		    const t = (50 - r) / 30;
		    h = lerp(224, 43, t);
		    s = lerp(76, 92, t);
		    l = lerp(57, 50, t);
		  } else {
		    const t = clampNum((20 - r) / 20, 0, 1);
		    h = lerp(43, 2, t);
		    s = lerp(92, 72, t);
		    l = lerp(50, 52, t);
		  }
		  return `hsla(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%, 0.92)`;
		}
		function fallbackT(key, params) {
		  let s = zh[key] ?? key;
		  if (params) s = s.replace(/\{(\w+)\}/g, (m, n) => n in params ? String(params[n]) : m);
		  return s;
		}
		function fmtReset(iso, t) {
		  if (!iso) return "";
		  const ts = new Date(iso).getTime();
		  if (Number.isNaN(ts)) return "";
		  const diff = ts - Date.now();
		  if (diff <= 0) return t("reset.reached");
		  const m = Math.round(diff / 6e4);
		  if (m < 1) return t("reset.imminent");
		  if (m < 60) return t("reset.minutes", { m });
		  const h = Math.floor(m / 60);
		  const mm = m % 60;
		  if (h < 24) return mm > 0 ? t("reset.hours.minutes", { h, mm }) : t("reset.hours", { h });
		  return t("reset.at", { date: new Date(iso).toLocaleString() });
		}
		function PlanWindow({ w, t }) {
		  const pct = w.percent === null || w.percent === void 0 ? null : Math.max(0, w.percent);
		  const cls = pct === null ? "" : w.status !== "ok" ? " exhausted" : pct >= 80 ? " hot" : "";
		  const label = pct === null ? "\u2014" : `${pct}%`;
		  const reset = fmtReset(w.resetsAt, t);
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bl-window", children: [
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bl-window-row", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "bl-window-label", children: t("window." + w.key) }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "bl-window-pct" + cls, children: label })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bl-bar", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		      "div",
		      {
		        className: "bl-bar-fill" + cls,
		        style: { width: pct === null ? "0%" : `${Math.min(pct, 100)}%` }
		      }
		    ) }),
		    reset && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bl-window-reset", children: reset })
		  ] });
		}
		function SpendChart({ t, spend }) {
		  const days = spend && spend.days || [];
		  if (days.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bl-sub", children: t("spend.empty") });
		  const max = Math.max(...days.map((d) => d.amount), 0);
		  const scale = max > 0 ? max : 1;
		  const cur = spend && spend.currency || "";
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bl-spend", children: [
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bl-spend-title", children: t("spend.title", { days: days.length }) }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bl-spend-bars", children: days.map((d) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bl-spend-col", title: `${d.date} \xB7 ${d.amount} ${cur}`.trim(), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		      "div",
		      {
		        className: "bl-spend-bar" + (d.amount <= 0 ? " zero" : ""),
		        style: { height: `${Math.max(2, d.amount / scale * 100)}%` }
		      }
		    ) }, d.date)) }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bl-spend-axis", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "0" }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: `${max} ${cur}`.trim() })
		    ] })
		  ] });
		}
		function fmtTokens(n) {
		  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
		  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
		  return String(n);
		}
		function TokenChart({ t, tokenSpend }) {
		  const days = tokenSpend && tokenSpend.days || [];
		  if (days.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bl-sub", children: t("token.empty") });
		  const max = Math.max(...days.map((d) => d.tokens), 0);
		  const scale = max > 0 ? max : 1;
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bl-spend", children: [
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bl-spend-title", children: t("token.title", { days: days.length }) }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bl-spend-bars", children: days.map((d) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bl-spend-col", title: `${d.date} \xB7 ${d.tokens} tokens`, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		      "div",
		      {
		        className: "bl-spend-bar" + (d.tokens <= 0 ? " zero" : ""),
		        style: { height: `${Math.max(2, d.tokens / scale * 100)}%` }
		      }
		    ) }, d.date)) }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bl-spend-axis", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "0" }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: fmtTokens(max) })
		    ] })
		  ] });
		}
		function BalancePanel({ t = fallbackT }) {
		  const [open, setOpen] = (0, import_react.useState)(false);
		  const [data, setData] = (0, import_react.useState)(null);
		  const [error, setError] = (0, import_react.useState)(null);
		  const [loading, setLoading] = (0, import_react.useState)(false);
		  const [bubblePos, setBubblePos] = (0, import_react.useState)(() => {
		    const p = loadPos(BUBBLE_POS_KEY) || loadPos(LEGACY_BUBBLE_POS_KEY) || loadPos(LEGACY_POS_KEY);
		    return p && typeof window !== "undefined" ? clampPosToViewport(p, BUBBLE_SIZE, BUBBLE_SIZE) : p;
		  });
		  const [panelPos, setPanelPos] = (0, import_react.useState)(() => {
		    const p = loadPos(PANEL_POS_KEY) || loadPos(LEGACY_PANEL_POS_KEY);
		    return p && typeof window !== "undefined" ? clampPosToViewport(p, 288, 480) : p;
		  });
		  const [thinking, setThinking] = (0, import_react.useState)(false);
		  const panelRef = (0, import_react.useRef)(null);
		  const drag = (0, import_react.useRef)(null);
		  const bubbleDrag = (0, import_react.useRef)(null);
		  const autoMsRef = (0, import_react.useRef)(3e4);
		  const aliveRef = (0, import_react.useRef)(true);
		  const pollTimerRef = (0, import_react.useRef)(null);
		  const scheduleNext = () => {
		    if (!aliveRef.current) return;
		    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
		    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
		    pollTimerRef.current = setTimeout(refresh, autoMsRef.current);
		  };
		  const refresh = () => {
		    if (!aliveRef.current) return;
		    setLoading(true);
		    fetchState().then((d) => {
		      setData(d);
		      setError(null);
		      setLoading(false);
		      autoMsRef.current = 3e4;
		    }).catch((e) => {
		      setError(e instanceof Error ? e.message : String(e));
		      setLoading(false);
		      autoMsRef.current = 1e4;
		    }).finally(scheduleNext);
		  };
		  (0, import_react.useEffect)(() => {
		    aliveRef.current = true;
		    refresh();
		    const actTimer = setInterval(() => {
		      const v = Date.now() - lastPageActivity < 1500;
		      setThinking((prev) => prev !== v ? v : prev);
		    }, 700);
		    return () => {
		      aliveRef.current = false;
		      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
		      clearInterval(actTimer);
		    };
		  }, []);
		  (0, import_react.useEffect)(() => {
		    if (!open) return;
		    const onKey = (e) => {
		      if (e.key === "Escape") setOpen(false);
		    };
		    window.addEventListener("keydown", onKey);
		    return () => window.removeEventListener("keydown", onKey);
		  }, [open]);
		  (0, import_react.useEffect)(() => {
		    const onVis = () => {
		      if (document.visibilityState === "hidden") {
		        if (pollTimerRef.current) {
		          clearTimeout(pollTimerRef.current);
		          pollTimerRef.current = null;
		        }
		      } else {
		        refresh();
		      }
		    };
		    document.addEventListener("visibilitychange", onVis);
		    return () => document.removeEventListener("visibilitychange", onVis);
		  }, []);
		  const bubbleStyle = bubblePos ? { left: bubblePos.x, top: bubblePos.y, right: "auto", bottom: "auto" } : void 0;
		  const panelStyle = panelPos ? { left: panelPos.x, top: panelPos.y, right: "auto", bottom: "auto" } : void 0;
		  const onHeaderPointerDown = (e) => {
		    if (e.button !== 0) return;
		    if (e.target instanceof Element && e.target.closest("button")) return;
		    const el = panelRef.current;
		    if (!el) return;
		    const rect = el.getBoundingClientRect();
		    drag.current = {
		      startX: e.clientX,
		      startY: e.clientY,
		      baseX: rect.left,
		      baseY: rect.top,
		      pos: { x: rect.left, y: rect.top }
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
		      pos: { x: rect.left, y: rect.top }
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
		  const onBubbleKeyDown = (e) => {
		    if (e.key === "Enter" || e.key === " ") {
		      e.preventDefault();
		      setOpen(true);
		    }
		  };
		  const providers = data && data.providers || [];
		  const balProv = providers.find((p) => p.kind === "balance");
		  const planProv = providers.find((p) => p.kind === "plan");
		  const hasPlan = !!planProv && planProv.configured;
		  if (!open) {
		    let rem = null;
		    let winLabel = "";
		    if (hasPlan && planProv.ok) {
		      const win = (planProv.windows || []).find((w) => w.key === "monthly") || planProv.windows[0];
		      if (win && win.percent !== null && win.percent !== void 0) {
		        rem = clampNum(100 - win.percent, 0, 100);
		        winLabel = t("window." + win.key);
		      }
		    }
		    const color = usageColor(rem);
		    const bal = balProv && balProv.ok && balProv.balances && balProv.balances.length > 0 ? `${balProv.balances[0].total_balance} ${balProv.balances[0].currency}` : null;
		    const pctText = rem === null ? bal ?? "\u2014" : `${Math.round(rem)}%`;
		    const subText = rem === null ? t("bubble.balance") : t("bubble.remaining", { label: winLabel });
		    const waterH = rem === null ? 100 : rem;
		    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
		      "div",
		      {
		        className: "bl-bubble" + (thinking ? " thinking" : ""),
		        style: bubbleStyle,
		        "data-balance-ui": true,
		        role: "button",
		        tabIndex: 0,
		        "aria-label": t("bubble.aria"),
		        title: t("bubble.title"),
		        onPointerDown: onBubblePointerDown,
		        onPointerMove: onBubblePointerMove,
		        onPointerUp: onBubblePointerUp,
		        onPointerCancel: onBubblePointerUp,
		        onKeyDown: onBubbleKeyDown,
		        children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bl-water", style: { height: `${waterH}%`, color } }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bl-waves", style: { bottom: `calc(${waterH}% - 6px)`, color }, children: [
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { className: "bl-wave", viewBox: "0 0 120 20", preserveAspectRatio: "none", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { fill: "currentColor", d: "M0,8 C14,0 26,16 40,9 C54,2 66,14 80,8 C94,2 108,12 120,6 L120,20 L0,20 Z" }) }),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { className: "bl-wave bl-wave-2", viewBox: "0 0 120 20", preserveAspectRatio: "none", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { fill: "currentColor", d: "M0,10 C16,2 30,14 44,8 C58,2 72,16 86,9 C100,3 112,12 120,8 L120,20 L0,20 Z" }) })
		          ] }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bl-shine" }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bl-bubble-text", children: [
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "bl-bubble-pct", children: error ? "!" : pctText }),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "bl-bubble-bal", children: error ? t("bubble.failed") : subText })
		          ] })
		        ]
		      }
		    );
		  }
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bl-panel", style: panelStyle, ref: panelRef, "data-balance-ui": true, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
		      "div",
		      {
		        className: "bl-head",
		        title: t("panel.drag"),
		        onPointerDown: onHeaderPointerDown,
		        onPointerMove: onHeaderPointerMove,
		        onPointerUp: onHeaderPointerUp,
		        onPointerCancel: onHeaderPointerUp,
		        children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("panel.title") }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bl-head-actions", children: [
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", title: t("action.refresh"), "aria-label": t("action.refresh"), onClick: refresh, children: "\u21BB" }),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", title: t("action.collapse"), "aria-label": t("action.collapse"), onClick: () => setOpen(false), children: "\xD7" })
		          ] })
		        ]
		      }
		    ),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bl-body", children: [
		      loading && !data && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bl-loading", children: t("loading") }),
		      !loading && !data && error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bl-err", children: error }),
		      !data && !loading && !error && providers.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: t("no.providers") }),
		      data && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		        error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bl-err", children: t("error.refresh", { error }) }),
		        data.alert && data.alert.triggered && data.alert.triggered.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bl-alert", role: "alert", children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: t("alert.banner", { amount: data.alert.threshold }) }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { children: data.alert.triggered.map((tr) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
		            tr.label,
		            "\uFF1A",
		            tr.amount.toFixed(2),
		            " ",
		            tr.currency
		          ] }, tr.id)) }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "off-hint", children: t("alert.off.hint") })
		        ] }),
		        providers.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: t("no.providers") }),
		        providers.map(
		          (p) => p.kind === "balance" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bl-provider", children: [
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bl-provider-title", children: p.label }),
		            p.ok && p.stale && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bl-stale", children: p.error ? t("stale.hint.error", { error: p.error }) : t("stale.hint") }),
		            p.ok ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bl-state", children: [
		                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "bl-dot" + (p.isAvailable ? "" : " off") }),
		                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: p.isAvailable ? t("balance.available") : t("balance.unavailable") })
		              ] }),
		              p.balances && p.balances.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: t("balance.no.details") }),
		              (p.balances || []).map((b) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bl-currency", children: [
		                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bl-currency-row", children: [
		                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: b.currency }),
		                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "bl-currency-total", children: b.total_balance ?? "-" })
		                ] }),
		                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bl-sub", children: t("balance.granted", { granted: b.granted_balance ?? "-", topped: b.topped_up_balance ?? "-" }) })
		              ] }, b.currency)),
		              p.spend && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SpendChart, { t, spend: p.spend })
		            ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bl-err", children: p.error })
		          ] }, p.id) : p.kind === "plan" && p.configured ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bl-provider", children: [
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bl-provider-title", children: t("plan.title", { label: p.label }) }),
		            p.ok && p.stale && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bl-stale", children: p.error ? t("stale.hint.error", { error: p.error }) : t("stale.hint") }),
		            p.ok ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bl-plan", children: (p.windows || []).map((w) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PlanWindow, { w, t }, w.key)) }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bl-err", children: t("plan.error", { error: p.error }) })
		          ] }, p.id) : null
		        ),
		        data.tokenSpend && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TokenChart, { t, tokenSpend: data.tokenSpend })
		      ] })
		    ] })
		  ] });
		}
		function apply(ctx) {
		  const hasLocale = !!(ctx && ctx.locale && typeof ctx.locale.register === "function");
		  if (hasLocale) {
		    ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-plugin-balance-panel: dictionaries");
		  }
		  ctx.slots.inject(
		    "shell.overlay",
		    () => ctx.slots.register(
		      {
		        name: "shell.overlay",
		        id: "balance-panel",
		        order: 110,
		        // 声明 locale namespace：框架把绑定 balance 字典的 t() 注入组件 props
		        ...hasLocale ? { locale: NS } : {}
		      },
		      BalancePanel
		    )
		  );
		}

		return module.exports;
	}
});
