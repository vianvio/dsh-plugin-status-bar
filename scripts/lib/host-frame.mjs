/**
 * scripts/lib/host-frame.mjs — 用**本机安装的 DSH** 的真实 CSS 与真实类名，
 * 在无头 Chrome 里搭出 composer 栈。
 *
 * 目的：让「状态条相对于输入卡片几何是否正确」这件事可以被量出来、看出来，
 * 而不是靠读代码猜。宿主 CSS 不在这里抄写——全部从 app.asar 现读。
 */
import { customProperty } from "./dsh-install.mjs";

/** 需要从宿主抠出来的 CSS module：marker 必须只属于那一个模块。 */
const MODULES = [
  { key: "conversationRoot", pkg: "dsh-client-ui-conversation", marker: "composerStack", rules: ["composerStack", "body"] },
  { key: "inputBar", pkg: "dsh-client-ui-conversation", marker: "placeholder", rules: ["root", "card"] },
  { key: "queueDock", pkg: "dsh-client-ui-conversation", marker: "pendingRow", rules: ["dock", "panel"] },
  { key: "goalDock", pkg: "dsh-client-ui-goal", marker: "objectiveInput", rules: ["dock", "bar"] }
];

/**
 * 从安装好的 DSH 里取宿主 CSS 与令牌。
 * @param dsh - DshInstall。
 * @returns `{ css, prefixes, classes, tokens }`。
 */
export function readHostFrame(dsh) {
  const prefixes = {};
  const classes = {};
  const chunks = [];

  for (const spec of MODULES) {
    const { prefix, css } = dsh.cssModule(spec.pkg, spec.marker);
    prefixes[spec.key] = prefix;
    classes[spec.key] = {};
    for (const rule of spec.rules) classes[spec.key][rule] = `${prefix}_${rule}`;
    chunks.push(css);
  }

  const bodyVars = ruleOf(dsh, prefixes.conversationRoot, "conversationRoot", "body");
  const tokens = {
    sideClearance: requiredVar(bodyVars, "--dsh-composer-side-clearance"),
    dockInset: requiredVar(bodyVars, "--dsh-composer-dock-inset"),
    cardMaxWidth: requiredVar(bodyVars, "--dsh-composer-card-max-width"),
    stackGap: requiredVar(ruleOf(dsh, prefixes.conversationRoot, "conversationRoot", "composerStack"), "--dsh-composer-stack-gap"),
    radiusPanel: dsh.themeToken("--dsw-radius-panel"),
    radiusLarge: dsh.themeToken("--dsw-radius-lg"),
    inputSurface: dsh.themeToken("--dsw-specific-input-major"),
    menuSurface: dsh.themeToken("--dsw-specific-menu")
  };

  return { css: chunks.join("\n"), prefixes, classes, tokens };
}

function ruleOf(dsh, prefix, key, rule) {
  const { css } = dsh.cssModule(MODULES.find((spec) => spec.key === key).pkg, MODULES.find((spec) => spec.key === key).marker);
  return new RegExp(`\\.${prefix}_${rule}(?:\\s*,[^{]*)?\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
}

function requiredVar(declarations, name) {
  const value = customProperty(declarations, name);
  if (value === undefined) throw new Error(`宿主 composer 令牌 ${name} 没有定义`);
  return value;
}

/**
 * 数值化一个宿主令牌（例如 "16px" → 16）。
 * @param value - 令牌值文本。
 * @returns 像素数。
 * @throws 当不是纯 px 字面量（宿主改成别的单位时应当响亮失败）。
 */
export function px(value) {
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(String(value).trim());
  if (match === null) throw new Error(`令牌值不是 px 字面量：${value}`);
  return Number.parseFloat(match[1]);
}

/**
 * composer 栈的 DOM：宿主 goal / queue 两个 dock + 输入卡片，中间留出状态条挂载点。
 *
 * 结构按宿主的真实渲染顺序：`conversationStrip > composerStack > [dock 条目…, inputBar]`。
 * @param classes - readHostFrame 的 classes。
 * @param options - `{ mountId }`。
 * @returns HTML 片段。
 */
export function composerStackMarkup(classes, options = {}) {
  const mountId = options.mountId ?? "status-bar-mount";
  const goalBar = `
      <div class="${classes.goalDock.dock}" data-probe="goal">
        <div class="${classes.goalDock.bar}">
          <span class="${classes.goalDock.label}" data-probe="goal-label">Goal</span>
          <span class="${classes.goalDock.objective}">ship the status bar on 0.2.0-rc.2</span>
        </div>
      </div>`;
  const queueDock = `
      <div class="${classes.queueDock.dock}" data-probe="queue">
        <div class="${classes.queueDock.panel}"></div>
      </div>`;
  return `${goalBar}${queueDock}
      <div id="${mountId}" data-probe="mount"></div>
      <div class="${classes.inputBar.root}" data-probe="input-root">
        <div class="${classes.inputBar.card}" data-probe="card" style="min-height:96px"></div>
      </div>`;
}

/**
 * 组装整页 HTML。
 * @param options - 帧内容与探针参数。
 * @returns HTML 文本。
 */
export function buildPage(options) {
  const {
    themeCss,
    hostCss,
    markup,
    pluginCss,
    stackWidth = 1100,
    theme = "dark",
    annotate = false,
    classes
  } = options;

  const annotation = annotate
    ? `<style>
  [data-probe=card]{outline:1px solid #ff00d4;outline-offset:0}
  [data-probe=mount]>.dshStatusDockRow{outline:1px dashed #00e5ff;outline-offset:0}
  [data-probe=queue],[data-probe=goal]{outline:1px solid #ffd400;outline-offset:0}
</style>`
    : "";

  return `<!doctype html>
<html data-platform="darwin" lang="zh">
<head>
<meta charset="utf-8">
<title>status-bar host frame</title>
<style>
/* ── 设计令牌（本机 DSH 的原样） ─────────────────────────────────────── */
${themeCss}
html,body{margin:0;padding:0}
body#frame{font-family:-apple-system,system-ui,sans-serif}
/* ── 宿主 composer 的真实 CSS（本机 DSH 的原样） ─────────────────────── */
${hostCss}
/* ── 体检脚手架：只补真实链路里由外层组件提供的那两层 ───────────────── */
#stage{width:${stackWidth}px;margin:0 auto;padding:56px 0 40px}
#body{width:100%}
#scroller{display:flex;flex-direction:column;flex:1;min-height:0}
</style>
<style id="${options.pluginStyleId ?? "dsh-status-bar-css"}">${pluginCss}</style>
${annotation}
</head>
<body id="frame"${theme === "dark" ? ' data-ds-dark-theme' : ""}>
<div id="stage">
  <div class="${classes.conversationRoot.body}" id="body">
    <div id="scroller">
      <div class="${classes.conversationRoot.composerStack}" id="strip" data-probe="stack">
${markup}
      </div>
    </div>
  </div>
</div>
<script>
window.addEventListener("load", function () {
  var box = function (selector) {
    var node = document.querySelector(selector);
    if (node === null) return null;
    var rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
  };
  /* 表面材质：条体的实际底色（优先取 .dshStatusBar:before 那层材质，没有就退回元素自身的背景）
   * 与输入卡片的背景色——用来抓"浅色主题下渲染成一条灰带"。 */
  var surfaceOf = function (node) {
    if (node === null) return null;
    var layer = window.getComputedStyle(node, ':before').backgroundColor;
    var own = window.getComputedStyle(node).backgroundColor;
    return /^(?:rgba\\([^)]*,\\s*0\\)|color\\([^)]*\\/\\s*0\\))$/.test(layer) ? own : layer;
  };
  var barNode = document.querySelector('.dshStatusBar');
  var cardNode = document.querySelector('[data-probe="card"]');
  var probe = {
    stack: box('[data-probe="stack"]'),
    card: box('[data-probe="card"]'),
    mount: box('[data-probe="mount"]'),
    row: box('.dshStatusDockRow'),
    bar: box('.dshStatusBar'),
    goal: box('[data-probe="goal"]'),
    goalBar: box('[data-probe="goal"] .${classes.goalDock.bar}'),
    queue: box('[data-probe="queue"]'),
    queuePanel: box('[data-probe="queue"] .${classes.queueDock.panel}'),
    barSurface: surfaceOf(barNode),
    barRadius: barNode === null ? null : window.getComputedStyle(barNode).borderTopLeftRadius,
    cardSurface: surfaceOf(cardNode),
    cardRadius: cardNode === null ? null : window.getComputedStyle(cardNode).borderTopLeftRadius,
    segments: Array.prototype.map.call(document.querySelectorAll('[data-status-seg]'), function (node) { return node.getAttribute('data-status-seg'); }),
    styleTags: Array.prototype.map.call(document.querySelectorAll('style[id]'), function (node) { return node.id; })
  };
  var out = document.createElement('pre');
  out.id = 'probe';
  /* 结果只给 --dump-dom 读，不进画面（截图要能直接进 README）。 */
  out.style.display = 'none';
  out.textContent = JSON.stringify(probe);
  document.body.appendChild(out);
});
</script>
</body>
</html>`;
}
