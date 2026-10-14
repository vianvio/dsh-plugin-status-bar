#!/usr/bin/env node
/**
 * scripts/smoke_status_bar.mjs — 状态条容器离线渲染体检
 *
 * 在 Node 中加载 client.js（捕获 __ModuleLoader__ 注册的 factory），用 react-dom/server
 * 渲染真实组件树，断言：容器几何、注册面契约、段外壳、面板交互、以及扩展性。
 *
 * 依赖解析：默认从 DSH_REACT_ROOT / 本包 / 当前目录及其上溯目录寻找 react 与 react-dom；
 * 找不到时自动跳过（退出码 0）。
 *
 * 用法：
 *   node scripts/smoke_status_bar.mjs [--json] [--dump]
 *   DSH_REACT_ROOT=/path/to/node_modules-owner node scripts/smoke_status_bar.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_PATH = join(ROOT, "client.js");

const passes = [];
const failures = [];
function check(ok, label, detail) {
  if (ok) passes.push(label);
  else failures.push(detail === undefined ? label : `${label} — ${detail}`);
}

function ancestorRoots(from) {
  const roots = [];
  let current = resolve(from);
  for (let i = 0; i < 6; i += 1) {
    roots.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return roots;
}

function resolveRuntime() {
  const candidates = [
    process.env.DSH_REACT_ROOT,
    ROOT,
    process.cwd(),
    ...ancestorRoots(process.cwd()),
  ].filter((value) => typeof value === "string" && value.length > 0);
  for (const root of candidates) {
    try {
      const req = createRequire(join(root, "package.json"));
      return { react: req("react"), server: req("react-dom/server") };
    } catch {
      /* 换下一个候选根 */
    }
  }
  return null;
}

const runtime = resolveRuntime();
if (runtime === null) {
  console.log("smoke_status_bar: 未找到 react / react-dom，跳过（设置 DSH_REACT_ROOT 可强制体检）");
  process.exit(0);
}
const { react, server } = runtime;
const { renderToStaticMarkup } = server;

check(existsSync(CLIENT_PATH), "client.js 存在");
const clientSrc = readFileSync(CLIENT_PATH, "utf8");

/* ── 几何与设计令牌 ───────────────────────────────────────────────────────── */
check(clientSrc.includes("--dsh-status-bar-host-inset:calc(var(--dsh-composer-side-clearance,16px) + 2 * var(--dsh-composer-dock-inset,8px))"), "内缩量由宿主 composer 令牌推出");
check(clientSrc.includes("var(--dsh-status-bar-inset,var(--dsh-status-bar-host-inset))"), "内缩量仍可被 --dsh-status-bar-inset 覆盖");
check(clientSrc.includes("width:calc(100% - 2 * var(--dsh-status-bar-inset,var(--dsh-status-bar-host-inset)))"), "容器宽度 = composer 栈宽 − 两侧内缩");
check(clientSrc.includes("margin:0 auto calc(0px - var(--dsh-composer-stack-gap,6px))"), "容器与输入卡片上沿贴合");
check(clientSrc.includes("--dsh-composer-card-max-width"), "容器宽度受输入卡片上限约束");
check(clientSrc.includes("border-radius:var(--dsw-radius-lg,12px) var(--dsw-radius-lg,12px) 0 0"), "仅顶部圆角（底部与卡片齐平）且走宿主圆角令牌");
check(clientSrc.includes("border-bottom:0"), "与卡片接缝处不描边");
check(clientSrc.includes("background:var(--dsw-specific-menu"), "容器表面走宿主 dock 面板材质（深浅主题都对）");
check(!clientSrc.includes("#000"), "不写死深色（浅色主题下会变成灰带）");
check(clientSrc.includes("bottom:calc(100% + 10px)"), "面板向上展开，不遮挡输入卡片");
check(!clientSrc.includes("无限四代") && !clientSrc.includes("armor"), "容器不含任何业务逻辑（无业务文案残留）");

function loadBundle() {
  let captured = null;
  globalThis.window = {
    __ModuleLoader__: { load: (entry) => { captured = entry; } },
  };
  new Function(clientSrc)();
  return captured;
}

const captured = loadBundle();
check(captured !== null, "bundle 完成 __ModuleLoader__.load 注册");
check(captured?.id === "dsh-plugin-status-bar", "模块 id = 包名 dsh-plugin-status-bar");

const modules = captured.factory((id) => {
  if (id === "react") return react;
  throw new Error(`unexpected require: ${id}`);
});
check(modules.name === "dsh-plugin-status-bar", "exports.name 与模块 id 一致");
check(modules.serviceName === "inputStatusBar", "服务名 = inputStatusBar");
check(Array.isArray(modules.inject) && modules.inject.includes("slots"), "exports.inject 含 slots");
check(typeof modules.apply === "function", "exports.apply 可调用");
check(typeof modules.createStatusBar === "function", "导出 createStatusBar");
check(typeof modules.segment === "function", "导出 Segment 段外壳原语");

/* ── 装载 ─────────────────────────────────────────────────────────────────── */
function applyPlugin(reactImpl) {
  const entry = loadBundle();
  const mod = entry.factory((id) => {
    if (id === "react") return reactImpl;
    throw new Error(`unexpected require: ${id}`);
  });
  const registered = [];
  const injected = [];
  let Component = null;
  let bar = null;
  mod.apply({
    provide: (name, value) => { if (name === "inputStatusBar") bar = value; },
    effect: (fn) => { fn(); return () => {}; },
    slots: {
      inject: (key, callback) => { injected.push(key); callback(); return () => {}; },
      register: (spec, Comp) => {
        registered.push(spec);
        if (spec.name === "conversation.input.dock") Component = Comp;
        return () => {};
      },
    },
  });
  return { mod, registered, injected, Component, bar };
}

const boot = applyPlugin(react);
check(true, "apply 在最小 ctx 下不抛错");
check(boot.bar !== null, "apply 提供 inputStatusBar 服务");
check(globalThis.window.__DSH_INPUT_STATUS_BAR__ === boot.bar, "window 桥接面指向同一注册面");
check(boot.injected.includes("conversation.input.dock"), "挂载到输入框上方槽位");
check(boot.registered.length === 1 && boot.registered[0].id === "status-bar", "只为容器注册一个槽位条目");
check(boot.registered[0].order === 30, "容器 order = 30");
check(boot.bar.list().length === 0, "容器自身不注册任何段（零业务逻辑）");

/* ── 注册面契约 ───────────────────────────────────────────────────────────── */
{
  const bar = modules.createStatusBar();
  const seen = [];
  bar.subscribe(() => seen.push(1));

  const disposeB = bar.register({ id: "b", order: 200, label: "B" });
  bar.register({ id: "a", order: 100, label: "A" });
  bar.register({ id: "c", label: "C" });
  check(bar.list().map((item) => item.id).join(",") === "a,c,b", "按 order 升序排列（缺省 100，同序按 id）");

  check(bar.update("c", { status: "3 条更新" }) === true, "update 命中返回 true");
  check(bar.list().find((item) => item.id === "c").status === "3 条更新", "update 生效");
  check(bar.update("missing", {}) === false, "update 未命中返回 false");

  disposeB();
  check(!bar.list().some((item) => item.id === "b"), "注册返回值可直接注销");
  bar.unregister("a");
  check(bar.list().map((item) => item.id).join(",") === "c", "unregister 生效");
  check(seen.length === 6 && bar.revision() === 6, "订阅者收到每次变更", `seen=${seen.length} rev=${bar.revision()}`);

  let missingId = false;
  try { bar.register({ label: "缺 id" }); } catch (error) { missingId = true; }
  check(missingId, "缺 id 的注册被拒绝");

  let missingBody = false;
  try { bar.register({ id: "empty" }); } catch (error) { missingBody = true; }
  check(missingBody, "既无 component 也无 label 的注册被拒绝");

  const cap = modules.createStatusBar();
  let overflow = false;
  for (let i = 0; i < 16; i += 1) cap.register({ id: `s${i}`, label: `S${i}` });
  try { cap.register({ id: "s17", label: "S17" }); } catch (error) { overflow = true; }
  check(overflow, "段数量上限 16 生效");
  check(cap.list().length === 16, "上限内仍可正常注册");
}

/* ── 渲染工具 ─────────────────────────────────────────────────────────────── */
function renderBar(options = {}) {
  const { open = null, items = [] } = options;
  const queue = [undefined, open];
  let index = 0;
  const useState = (initial) => {
    const value = index < queue.length ? queue[index] : undefined;
    index += 1;
    if (value === undefined) return [typeof initial === "function" ? initial() : initial, () => {}];
    return [value, () => {}];
  };

  const applied = applyPlugin(Object.assign({}, react, { useState }));
  items.forEach((item) => applied.bar.register(item));
  const markup = renderToStaticMarkup(react.createElement(applied.Component, {}));
  return { markup, bar: applied.bar };
}

/* ── 空容器 ───────────────────────────────────────────────────────────────── */
const empty = renderBar();
check(empty.markup === "", "无段时整条容器不渲染（不留空壳）");

/* ── 数据段 ───────────────────────────────────────────────────────────────── */
const data = renderBar({
  items: [
    { id: "market", order: 200, label: "插件市场", status: "3 条更新", tone: "pass", title: "插件市场" },
    { id: "voice", order: 300, label: "语音", tone: "running" },
    { id: "warn", order: 350, label: "限流", tone: "warn" },
    { id: "clock", order: 400, align: "end", dot: false, label: "12:04" },
  ],
});
check(data.markup.includes("dshStatusDockRow"), "渲染挂载行");
check(data.markup.includes("dshStatusBar"), "渲染整条容器");
check(data.markup.includes('role="toolbar"'), "容器语义为 toolbar");
check(data.markup.includes('data-status-bar="on"'), "容器带 data-status-bar 标记");
check(data.markup.includes("插件市场") && data.markup.includes("3 条更新"), "数据段渲染主文案与次文案");
check(data.markup.includes('data-status-seg="market"'), "数据段带 data-status-seg");
check(data.markup.includes("dshStatusSegEnd"), "align:end 段右对齐");
check((data.markup.match(/dshStatusSegButton/g) || []).length >= 4, "每段各自拥有独立触发器");
check(data.markup.includes("dshStatusDotPulse"), "tone:running 段状态点脉冲");
check(data.markup.includes("#f59e0b"), "tone 映射状态点颜色");
check(!data.markup.includes('role="menu"'), "未展开时不渲染面板");

/* ── 段外壳静态段 / 点击行为 ───────────────────────────────────────────────── */
const staticSeg = renderBar({ items: [{ id: "plain", label: "静态" }] });
check(staticSeg.markup.includes("dshStatusSegStatic"), "无 menu/onSelect 的段渲染为静态段");
check(!staticSeg.markup.includes("dshStatusChevron"), "静态段不带箭头");

const chevron = renderBar({ items: [{ id: "hasmenu", label: "有面板", menu: () => null }] });
check(chevron.markup.includes("dshStatusChevron"), "具备面板能力的段收起态即带箭头");
check(chevron.markup.includes('aria-haspopup="menu"') && chevron.markup.includes('aria-expanded="false"'), "段 ARIA 契约（收起态）");

/* ── 面板 ─────────────────────────────────────────────────────────────────── */
const opened = renderBar({
  open: "market",
  items: [
    {
      id: "market",
      order: 200,
      label: "插件市场",
      menu: () => react.createElement(
        "button",
        { type: "button", role: "menuitem", className: "dshStatusCell" },
        "打开市场"
      ),
    },
    { id: "clock", order: 400, align: "end", dot: false, label: "12:04" },
  ],
});
check(opened.markup.includes('role="menu"'), "展开态渲染 role=menu 面板");
check(opened.markup.includes("dsh-status-panel-market"), "面板 id 由段 id 派生（多段互不冲突）");
check(opened.markup.includes('aria-expanded="true"'), "展开态 aria-expanded=true");
check(opened.markup.includes("dshStatusChevronOpen"), "展开态箭头旋转 180°");
check(opened.markup.includes("打开市场"), "面板内容由注册方提供");
check((opened.markup.match(/role="menu"/g) || []).length === 1, "同一时刻只展开一个面板");

/* ── 自定义段 ─────────────────────────────────────────────────────────────── */
const custom = renderBar({
  items: [
    {
      id: "custom",
      component: (props) => react.createElement(
        props.Segment,
        { id: "custom", title: "自定义段", menuAvailable: false },
        react.createElement("span", { className: "dshStatusLabel" }, "自定义 " + (props.open ? "开" : "关"))
      ),
    },
  ],
});
check(custom.markup.includes("自定义 关"), "自定义段组件接管内容");
check(custom.markup.includes("dshStatusLabel"), "自定义段复用公开样式积木");

/* ── 样式表装载 ─────────────────────────────────────────────────────────────
 * 0.1.0 把注入放在组件的 useEffect 里，第一帧会先渲染无样式裸标记；
 * 现在改成装载时注入，并且要能对被上一实例留下的同名 style 元素做内容刷新。 */
{
  const head = {
    children: [],
    appendChild(child) { this.children.push(child); return child; },
  };
  globalThis.document = {
    head,
    getElementById: (id) => head.children.find((node) => node.id === id) ?? null,
    createElement: () => ({
      id: "",
      textContent: "",
      remove() {
        const at = head.children.indexOf(this);
        if (at >= 0) head.children.splice(at, 1);
      },
    }),
  };

  const dispose = modules.installStyles();
  check(head.children.length === 1 && head.children[0].id === "dsh-status-bar-css", "装载时注入样式表（不依赖组件挂载）");
  check(head.children[0].textContent === modules.stylesheet, "注入的是导出的那一份样式表");

  check(modules.installStyles() === null && head.children.length === 1, "已有同名样式表时不重复注入、也不接管它");

  head.children[0].textContent = "/* 上一实例留下的旧样式 */";
  modules.installStyles();
  check(head.children[0].textContent === modules.stylesheet, "同名样式表内容过期时刷新为当前版本");

  dispose();
  check(head.children.length === 0, "卸载回收自己注入的样式表");
  delete globalThis.document;
}

/* ── 汇总 ─────────────────────────────────────────────────────────────────── */
if (process.argv.includes("--dump")) {
  console.log("--- 空容器 ---\n" + JSON.stringify(empty.markup));
  console.log("\n--- 数据段 ---\n" + data.markup.replace(/></g, ">\n<"));
  console.log("\n--- 展开态 ---\n" + opened.markup.replace(/></g, ">\n<"));
}

const json = process.argv.includes("--json");
if (json) {
  console.log(JSON.stringify({ pass: passes.length, fail: failures.length, failures }, null, 2));
} else {
  for (const line of passes) console.log(`  ✅ ${line}`);
  for (const line of failures) console.log(`  ❌ ${line}`);
  console.log(`\n结果: ${passes.length} 通过, ${failures.length} 失败`);
}
process.exit(failures.length === 0 ? 0 : 1);
