#!/usr/bin/env node
/**
 * scripts/render_status_bar.mjs — 真浏览器里的几何体检。
 *
 * 做法：把**本机安装的 DSH** 里那份真的 composer CSS + 真的设计令牌抽出来，
 * 按宿主的真实 DOM 顺序搭一个 composer 栈（goal dock / queue dock / 输入卡片），
 * 把**本插件真渲染出来的**状态条塞进 `conversation.input.dock` 的位置，
 * 用无头 Chrome 排版后量真实盒模型并断言。
 *
 * 断言的是插件自己写在 README 里的设计意图：
 *   - 比输入卡片**略窄**（两侧一定在卡片边缘之内，不许外溢）；
 *   - 居中；
 *   - 与卡片上沿贴合（底边 == 卡片顶边）；
 *   - 与宿主自己那些 dock 面板**左右对齐**（同一列，不突出来）。
 *
 * 用法：
 *   node scripts/render_status_bar.mjs               # 量 + 截图
 *   node scripts/render_status_bar.mjs --json        # 附机器可读结果
 *   node scripts/render_status_bar.mjs --no-shot     # 只量不截图
 * 环境：
 *   DSH_ASAR        指定 app.asar
 *   DSH_REACT_ROOT  指定 react / react-dom 所在目录
 *   CHROME_BIN      指定 Chrome
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { DshInstall } from "./lib/dsh-install.mjs";
import { buildPage, composerStackMarkup, px, readHostFrame } from "./lib/host-frame.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_PATH = process.env.DSH_STATUS_BAR_CLIENT ?? join(ROOT, "client.js");
const ARTIFACTS = process.env.DSH_STATUS_BAR_ARTIFACTS ?? join(ROOT, "artifacts");
const CHROME = process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const argv = new Set(process.argv.slice(2));
const asJson = argv.has("--json");
const shoot = !argv.has("--no-shot");

const passes = [];
const failures = [];
function check(ok, label, detail) {
  if (ok) passes.push(label);
  else failures.push(detail === undefined ? label : `${label} — ${detail}`);
}
const round = (value) => Math.round(value * 100) / 100;

/* ── 依赖 ─────────────────────────────────────────────────────────────────── */
function resolveRuntime() {
  const candidates = [process.env.DSH_REACT_ROOT, ROOT, process.cwd()].filter(
    (value) => typeof value === "string" && value.length > 0
  );
  for (const root of candidates) {
    try {
      const require = createRequire(join(root, "package.json"));
      return { react: require("react"), server: require("react-dom/server") };
    } catch {
      /* 换下一个候选根 */
    }
  }
  return null;
}

const runtime = resolveRuntime();
if (runtime === null) {
  console.error("render_status_bar: 找不到 react / react-dom（用 DSH_REACT_ROOT 指定）");
  process.exit(1);
}
const { react, server } = runtime;
const { renderToStaticMarkup } = server;

if (!existsSync(CHROME)) {
  console.error(`render_status_bar: 找不到浏览器 ${CHROME}（用 CHROME_BIN 指定）`);
  process.exit(1);
}

/* ── 载入插件（走真的 __ModuleLoader__ 契约） ─────────────────────────────── */
const clientSrc = readFileSync(CLIENT_PATH, "utf8");

function loadBundle() {
  let captured = null;
  globalThis.window = { __ModuleLoader__: { load: (entry) => { captured = entry; } } };
  new Function(clientSrc)();
  return captured;
}

const captured = loadBundle();
check(captured !== null, "bundle 完成 __ModuleLoader__.load 注册");
check(captured?.id === "dsh-plugin-status-bar", "模块 id = 包名");

const mod = captured.factory((id) => {
  if (id === "react") return react;
  throw new Error(`unexpected require: ${id}`);
});
check(typeof mod.stylesheet === "string" && mod.stylesheet.length > 0, "导出容器样式表文本（供真渲染体检注入）");

/* ── 装载插件，拿到注册进 dock 的那个组件 ─────────────────────────────────── */
function mountPlugin(reactImpl = react, useState) {
  const entry = loadBundle();
  const plugin = entry.factory((id) => {
    if (id === "react") return reactImpl;
    throw new Error(`unexpected require: ${id}`);
  });
  let Component = null;
  let bar = null;
  const specs = [];
  plugin.apply({
    provide: (name, value) => { if (name === "inputStatusBar") bar = value; },
    effect: (fn) => { fn(); return () => {}; },
    slots: {
      inject: (key, callback) => { callback(); return () => {}; },
      register: (spec, Comp) => {
        specs.push(spec);
        if (spec.name === "conversation.input.dock") Component = Comp;
        return () => {};
      }
    }
  });
  return { plugin, Component, bar, specs };
}

/** 给状态条注册两个有代表性的段，并渲染成静态标记。 */
function renderStatusBar(options = {}) {
  const open = options.open ?? null;
  const { Component, bar } = mountPlugin();
  bar.register({
    id: "agent-mesh-node",
    order: 100,
    label: "Agent Mesh",
    status: "3 台在线",
    tone: "pass",
    title: "Agent Mesh 节点"
  });
  bar.register({
    id: "status-bar-selftest",
    order: 200,
    align: "end",
    label: "状态条",
    status: "0.2.0",
    tone: "idle"
  });

  /* 用一个可预测的 useState 固定 open 态：静态渲染不会跑 effect / 交互。 */
  const queue = [undefined, open];
  let index = 0;
  const controlled = typeof options.useState === "function"
    ? options.useState
    : (initial) => {
        const value = index < queue.length ? queue[index] : undefined;
        index += 1;
        if (value === undefined) return [typeof initial === "function" ? initial() : initial, () => {}];
        return [value, () => {}];
      };
  const applied = mountPlugin(Object.assign({}, react, { useState: controlled }));
  bar.list().forEach((item) => applied.bar.register(item));
  const markup = renderToStaticMarkup(react.createElement(applied.Component, {}));
  return { markup, bar: applied.bar, component: applied.Component };
}

/* ── 本机 DSH 的真实帧 ────────────────────────────────────────────────────── */
const dsh = new DshInstall();
const frame = readHostFrame(dsh);
const sideClearance = px(frame.tokens.sideClearance);
const dockInset = px(frame.tokens.dockInset);

/* ── 布局矩阵：宽/窄 × 深/浅 ─────────────────────────────────────────────── */
const LAYOUTS = [
  { key: "wide-dark", width: 1100, theme: "dark", label: "宽 1100 / 深色" },
  { key: "narrow-dark", width: 640, theme: "dark", label: "窄 640 / 深色" },
  { key: "wide-light", width: 1100, theme: "light", label: "宽 1100 / 浅色" },
  { key: "narrow-light", width: 640, theme: "light", label: "窄 640 / 浅色" }
];

const rendered = renderStatusBar({});
check(rendered.markup.includes("dshStatusBar"), "状态条真的渲染出了容器");
check(rendered.markup.includes("agent-mesh-node"), "数据段渲染出触发器");

if (shoot) mkdirSync(ARTIFACTS, { recursive: true });

const workDir = join(tmpdir(), `dsh-status-bar-frame-${process.pid}`);
mkdirSync(workDir, { recursive: true });

const results = [];

for (const layout of LAYOUTS) {
  const markup = composerStackMarkup(frame.classes);
  const page = buildPage({
    themeCss: dsh.themeCss,
    hostCss: frame.css,
    pluginCss: mod.stylesheet,
    markup: markup.replace(
      '<div id="status-bar-mount" data-probe="mount"></div>',
      `<div id="status-bar-mount" data-probe="mount">${rendered.markup}</div>`
    ),
    classes: frame.classes,
    stackWidth: layout.width,
    theme: layout.theme
  });
  const htmlPath = join(workDir, `${layout.key}.html`);
  writeFileSync(htmlPath, page);

  const dom = execFileSync(
    CHROME,
    ["--headless", "--disable-gpu", "--hide-scrollbars", "--virtual-time-budget=1500", "--dump-dom", `file://${htmlPath}`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }
  );
  const probeMatch = /<pre id="probe"[^>]*>([\s\S]*?)<\/pre>/.exec(dom);
  if (probeMatch === null) {
    failures.push(`${layout.label}：页面没有产出 probe 结果`);
    continue;
  }
  const probe = JSON.parse(decodeEntities(probeMatch[1]));
  results.push({ layout, probe });

  let shotPath = null;
  if (shoot) {
    shotPath = join(ARTIFACTS, `${layout.key}.png`);
    execFileSync(
      CHROME,
      ["--headless", "--disable-gpu", "--hide-scrollbars", "--virtual-time-budget=1500", `--screenshot=${shotPath}`, `--window-size=${layout.width + 120},286`, `file://${htmlPath}`],
      { stdio: "ignore" }
    );
  }

  /* ── 断言 ─────────────────────────────────────────────────────────────── */
  const { stack, card, row, bar, queuePanel, goalBar } = probe;
  const where = layout.label;

  if (row === null || bar === null) {
    check(false, `${where}：状态条渲染出可测量的容器`);
    continue;
  }

  check(row.width < card.width - 0.5, `${where}：状态条比输入卡片窄`, `row=${round(row.width)} card=${round(card.width)}`);
  check(row.left > card.left + 0.5, `${where}：左侧在卡片边缘之内（不外溢）`, `row.left=${round(row.left)} card.left=${round(card.left)}`);
  check(row.right < card.right - 0.5, `${where}：右侧在卡片边缘之内（不外溢）`, `row.right=${round(row.right)} card.right=${round(card.right)}`);

  const leftGap = row.left - card.left;
  const rightGap = card.right - row.right;
  check(Math.abs(leftGap - rightGap) < 0.6, `${where}：相对卡片居中`, `left=${round(leftGap)} right=${round(rightGap)}`);

  const stackLeftGap = row.left - stack.left;
  const stackRightGap = stack.right - row.right;
  check(Math.abs(stackLeftGap - stackRightGap) < 0.6, `${where}：在 composer 栈里居中`, `left=${round(stackLeftGap)} right=${round(stackRightGap)}`);

  check(Math.abs(row.bottom - card.top) < 1.0, `${where}：底边与卡片顶边贴合`, `row.bottom=${round(row.bottom)} card.top=${round(card.top)}`);

  /* 两条宽度路径都要覆盖：窄屏由 `100%` 决定、宽屏由 `--dsh-composer-card-max-width` 决定。
   * 两条路径上「相对卡片边缘内缩」都必须是 2×dock-inset，条宽都必须是 card − 2×dock-inset。 */
  const cardInset = row.left - card.left;
  check(Math.abs(cardInset - 2 * dockInset) < 0.6, `${where}：相对卡片边缘内缩 == 2×dock-inset`,
    `实际=${round(cardInset)} 期望=${2 * dockInset}`);
  check(Math.abs(row.width - (card.width - 4 * dockInset)) < 0.6, `${where}：条宽 == 卡片宽 − 4×dock-inset`,
    `row=${round(row.width)} card=${round(card.width)}`);
  if (Math.abs(card.left - stack.left - sideClearance) < 0.6) {
    check(Math.abs(stackLeftGap - (sideClearance + 2 * dockInset)) < 0.6,
      `${where}：宽度路径下内缩 == side-clearance + 2×dock-inset`,
      `实际=${round(stackLeftGap)} 期望=${sideClearance + 2 * dockInset}`);
  }

  for (const [name, panel] of [["goal", goalBar], ["queue", queuePanel]]) {
    if (panel === null) continue;
    check(row.left >= panel.left - 0.6, `${where}：不超出宿主 ${name} 面板左缘`, `row=${round(row.left)} ${name}=${round(panel.left)}`);
    check(row.right <= panel.right + 0.6, `${where}：不超出宿主 ${name} 面板右缘`, `row=${round(row.right)} ${name}=${round(panel.right)}`);
  }

  check(Math.abs(bar.left - row.left) < 0.6 && Math.abs(bar.width - row.width) < 0.6, `${where}：条体铺满挂载行`);
  check(probe.segments.includes("agent-mesh-node"), `${where}：段渲染进容器`);
  check(probe.styleTags.includes("dsh-status-bar-css"), `${where}：容器样式表已注入页面`);

  /* 表面材质：旧实现把表面写成 `color-mix(in srgb, 卡片表面 78%, #000)`，在浅色主题下
   * 会渲染成一条明显更暗的灰带。这里量真的计算色，淡色主题下必须与卡片同色阶。 */
  const barLuma = relativeLuminance(probe.barSurface);
  const cardLuma = relativeLuminance(probe.cardSurface);
  if (barLuma !== null && cardLuma !== null) {
    check(Math.abs(barLuma - cardLuma) < (layout.theme === "light" ? 0.12 : 0.2),
      `${where}：表面与卡片同色阶（不出现异色带）`,
      `bar=${round(barLuma)} card=${round(cardLuma)} (${probe.barSurface} / ${probe.cardSurface})`);
  } else {
    check(false, `${where}：能读到条体与卡片的计算背景色`);
  }
  if (layout.theme === "light") {
    check(barLuma !== null && barLuma > 0.85, `${where}：浅色主题下条体不是深色带`, `luma=${barLuma === null ? "n/a" : round(barLuma)}`);
  }
  check(Math.abs(dimension(probe.barRadius) - px(frame.tokens.radiusLarge)) < 0.6,
    `${where}：顶圆角 == 宿主 --dsw-radius-lg`,
    `bar=${probe.barRadius} 期望=${frame.tokens.radiusLarge}`);

  if (shotPath !== null) check(existsSync(shotPath), `${where}：截图产出`, shotPath);
}

if (shoot) writeFileSync(join(ARTIFACTS, "probe.json"), `${JSON.stringify(results.map((entry) => ({ layout: entry.layout.key, ...entry.probe })), null, 2)}\n`);

rmSync(workDir, { recursive: true, force: true });

/* ── 结果 ─────────────────────────────────────────────────────────────────── */
const summary = {
  dsh: dsh.info,
  hostTokens: frame.tokens,
  derived: { "expected inset from stack edge (px)": sideClearance + 2 * dockInset },
  passes: passes.length,
  failures
};

if (asJson) {
  console.log(JSON.stringify({ summary, details: results.map((entry) => ({ layout: entry.layout.key, ...entry.probe })) }, null, 2));
} else {
  console.log(`宿主 DSH ${dsh.info.version}（${dsh.info.platform}/${dsh.info.arch}）`);
  console.log(`宿主令牌：side-clearance=${frame.tokens.sideClearance} dock-inset=${frame.tokens.dockInset} card-max=${frame.tokens.cardMaxWidth}`);
  console.log(`期望内缩（相对 composer 栈）：${sideClearance + 2 * dockInset}px\n`);
  for (const label of passes) console.log(`  ✅ ${label}`);
  for (const label of failures) console.log(`  ❌ ${label}`);
  console.log(`\n结果: ${passes.length} 通过, ${failures.length} 失败`);
  if (shoot) console.log(`截图: ${ARTIFACTS}`);
}

process.exit(failures.length === 0 ? 0 : 1);

/** 还原 Chrome --dump-dom 对文本节点的转义。 */
function decodeEntities(text) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * 把计算色算成相对亮度（0..1）。
 *
 * Chrome 对 `color-mix()` 的结果给的是 `color(srgb r g b / a)` 而不是 `rgb()`，
 * 两种都要认——只认 `rgb()` 会让"读不到颜色"被当成"没问题"。
 * @param color - getComputedStyle 的颜色字符串。
 * @returns 相对亮度；读不到或全透明时返回 null。
 */
function relativeLuminance(color) {
  if (typeof color !== "string") return null;
  let channels = null;
  let alpha = 1;

  const rgb = /rgba?\(([^)]+)\)/.exec(color);
  if (rgb !== null) {
    const parts = rgb[1].split(",").map((value) => Number.parseFloat(value));
    channels = [parts[0] / 255, parts[1] / 255, parts[2] / 255];
    if (parts.length > 3) alpha = parts[3];
  } else {
    const srgb = /color\(srgb\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)(?:\s*\/\s*([\d.eE+-]+))?\)/.exec(color);
    if (srgb === null) return null;
    channels = [Number.parseFloat(srgb[1]), Number.parseFloat(srgb[2]), Number.parseFloat(srgb[3])];
    if (srgb[4] !== undefined) alpha = Number.parseFloat(srgb[4]);
  }

  if (alpha === 0) return null;
  const toLinear = (value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luma =
    0.2126 * toLinear(channels[0]) + 0.7152 * toLinear(channels[1]) + 0.0722 * toLinear(channels[2]);
  /* 半透明表面按白底合成：浅色主题的页面底色就是白，这是最坏情况的保守估计。 */
  return luma * alpha + (1 - alpha);
}

/** 从 `16px` 这样的计算值里取数字。 */
function dimension(value) {
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(String(value ?? "").trim());
  return match === null ? Number.NaN : Number.parseFloat(match[1]);
}
