#!/usr/bin/env node
/**
 * scripts/verify_status_bar.mjs — 状态条容器静态契约校验（无需浏览器 / react）
 *
 * 校验：包元数据与导出映射 / 客户端半体契约 / 几何与主题令牌 / 样式原语 /
 *       零业务逻辑边界 / 注册面 API 文本契约 / 插件装载协议。
 *
 * 用法：node scripts/verify_status_bar.mjs [--json]
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const passes = [];
const failures = [];

function check(ok, label, detail = "") {
  (ok ? passes : failures).push(`${label}${!ok && detail ? " — " + detail : ""}`);
}
function mustContain(text, needle, label) {
  check(text.includes(needle), label, `缺少 "${needle.slice(0, 60)}"`);
}
function mustAbsent(text, needle, label) {
  check(!text.includes(needle), label, `不应包含 "${needle.slice(0, 60)}"`);
}

function read(rel) {
  const path = join(ROOT, rel);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/* ---- 1. 包元数据 ---- */
const pkgPath = join(ROOT, "package.json");
check(existsSync(pkgPath), "package.json 存在");
const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, "utf8")) : {};
check(pkg.name === "dsh-plugin-status-bar", "package.json name = dsh-plugin-status-bar");
check(pkg.type === "module", "type = module");
check(pkg.main === "./index.js", "main = ./index.js");
check(pkg.exports?.["./client"] === "./client.js", "导出 ./client → ./client.js");
check(pkg.dsh?.id === "dsh-status-bar", "dsh.id = dsh-status-bar");
check(pkg.dsh?.client?.platform === "web", "dsh.client.platform = web");
check(pkg.dsh?.bundle?.patch === "./cordis.patch.yml", "dsh.bundle.patch 指向 cordis.patch.yml");
check(typeof pkg.scripts?.verify === "string", "提供 verify 脚本");
check(typeof pkg.scripts?.["smoke:client"] === "string", "提供 smoke:client 脚本");
check(JSON.stringify(pkg.dependencies ?? {}) === "{}", "无外部运行时依赖");

/* ---- 2. 宿主半体：纯占位、无行为 ---- */
const indexSrc = read("index.js");
check(indexSrc.length > 0, "index.js 存在");
mustContain(indexSrc, 'export const name = "dsh-status-bar"', "宿主半体导出稳定 name");
mustContain(indexSrc, "export function apply()", "宿主半体导出空 apply");
mustAbsent(indexSrc, "systemPrompt", "宿主半体不注入系统提示词");
mustAbsent(indexSrc, "tools.register", "宿主半体不注册工具");

const patch = read("cordis.patch.yml");
mustContain(patch, "dsh-plugin-status-bar", "cordis.patch.yml 指向本包");

/* ---- 3. 客户端半体装载契约 ---- */
const clientSrc = read("client.js");
check(clientSrc.length > 0, "client.js 存在");
mustContain(clientSrc, 'id: "dsh-plugin-status-bar"', "bundle id = 包名");
mustContain(clientSrc, 'window.__ModuleLoader__.load', "经 __ModuleLoader__ 注册");
mustContain(clientSrc, 'var SERVICE = "inputStatusBar"', "服务名 = inputStatusBar");
mustContain(clientSrc, "ctx.provide(SERVICE, bar)", "经 cordis 提供注册面");
mustContain(clientSrc, "window[BRIDGE] = bar", "非 cordis 集成面：window 桥接");
mustContain(clientSrc, '"conversation.input.dock"', "挂载槽位 = conversation.input.dock");
mustContain(clientSrc, "exports.createStatusBar = createStatusBar", "导出注册面工厂");
mustContain(clientSrc, "exports.segment = Segment", "导出段外壳原语");
mustContain(clientSrc, "exports.serviceName = SERVICE", "导出服务名常量");
mustContain(clientSrc, 'exports.name = "dsh-plugin-status-bar"', "exports.name 与模块 id 一致");
mustContain(clientSrc, "exports.stylesheet = CSS", "导出样式表文本");
mustContain(clientSrc, "exports.installStyles = installStyles", "导出样式安装器");
mustContain(clientSrc, "removeStyles = installStyles()", "样式在装载时注入（不等组件挂载，避免第一帧裸标记）");
mustContain(clientSrc, 'ctx.effect(function () { return removeStyles; })', "样式随插件卸载回收");

/* ---- 4. 零业务逻辑边界 ---- */
mustAbsent(clientSrc, "无限四代", "不含业务文案（无限四代）");
mustAbsent(clientSrc, "armor", "不含业务标识（armor）");
mustAbsent(clientSrc, "systemPrompt", "不含提示词注入");
mustAbsent(clientSrc, "bar.register(", "容器自身不注册任何段（apply 内无自注册调用）");

/* ---- 5. 几何与主题令牌 ----
 * 尺寸不再写死：宽度按宿主 composer 的令牌推出来（见 scripts/compat_status_bar.mjs
 * 对着本机安装的 DSH 做的令牌漂移检查，以及 scripts/render_status_bar.mjs 在真浏览器里的量测）。 */
mustContain(clientSrc, "--dsh-status-bar-host-inset:calc(var(--dsh-composer-side-clearance,16px) + 2 * var(--dsh-composer-dock-inset,8px))", "内缩量由宿主 composer 令牌推出");
mustContain(clientSrc, "var(--dsh-status-bar-inset,var(--dsh-status-bar-host-inset))", "--dsh-status-bar-inset 是可覆盖的对外旋钮");
mustContain(clientSrc, "--dsh-status-bar-height:32px", "条高可调变量（32px）");
mustContain(clientSrc, "width:calc(100% - 2 * var(--dsh-status-bar-inset,var(--dsh-status-bar-host-inset)))", "容器宽度 = composer 栈宽 − 两侧内缩");
mustContain(clientSrc, "max-width:calc(var(--dsh-composer-card-max-width,800px) - 2 * var(--dsh-status-bar-inset,var(--dsh-status-bar-host-inset)) + 2 * var(--dsh-composer-side-clearance,16px))", "容器宽度受卡片上限约束（并把栈内缩换算成卡片内缩）");
mustContain(clientSrc, "margin:0 auto calc(0px - var(--dsh-composer-stack-gap,6px))", "与输入卡片上沿贴合");
mustContain(clientSrc, "border-radius:var(--dsw-radius-lg,12px) var(--dsw-radius-lg,12px) 0 0", "仅顶部圆角，且走宿主圆角令牌");
mustContain(clientSrc, "border-bottom:0", "接缝不描边");
mustContain(clientSrc, "background:var(--dsw-specific-menu", "表面走宿主 dock 面板材质（深浅两套主题都对）");
mustAbsent(clientSrc, "#000", "不写死深色（浅色主题下会变成灰带）");
mustContain(clientSrc, "backdrop-filter:var(--dsw-menu-backdrop-filter,none)", "背板滤镜与宿主 dock 面板一致");
mustContain(clientSrc, "bottom:calc(100% + 10px)", "面板向上展开");
mustContain(clientSrc, "--dsw-specific-menu", "面板底色用宿主令牌");
mustContain(clientSrc, "--dsw-alias-interactive-bg-hover", "hover 用宿主令牌");
mustContain(clientSrc, "--dsw-alias-border-l3", "焦点环用宿主令牌");
mustContain(clientSrc, "dshStatusSeg+.dshStatusSeg::before", "段间自动分隔线");
mustContain(clientSrc, "dshStatusSegEnd", "支持右对齐段");

/* ---- 6. 样式原语（公开契约，README 必须同步） ---- */
const primitives = [
  "dshStatusDockRow", "dshStatusBar", "dshStatusSeg", "dshStatusSegButton", "dshStatusSegBody",
  "dshStatusChevron", "dshStatusPanel", "dshStatusDot", "dshStatusDotPulse", "dshStatusLabel",
  "dshStatusText", "dshStatusHead", "dshStatusBadge", "dshStatusRow", "dshStatusRowLabel",
  "dshStatusRowValue", "dshStatusSep", "dshStatusCell", "dshStatusCellValue", "dshStatusHint",
];
const readme = read("README.md");
check(readme.length > 0, "README.md 存在");
for (const name of primitives) {
  mustContain(clientSrc, "." + name, `样式原语 ${name} 已定义`);
  mustContain(readme, name, `样式契约文档包含 ${name}`);
}

/* ---- 7. 交互契约 ---- */
mustContain(clientSrc, '"aria-haspopup"', "段 ARIA：aria-haspopup");
mustContain(clientSrc, '"aria-expanded"', "段 ARIA：aria-expanded");
mustContain(clientSrc, 'role: "menu"', "面板 ARIA：role=menu");
mustContain(readme, 'role="menuitem"', "面板项 ARIA 契约写入文档（内容由段提供）");
mustContain(clientSrc, '"toolbar"', "容器语义 role=toolbar");
mustContain(clientSrc, "Escape", "Esc 关闭面板");
mustContain(clientSrc, "ArrowDown", "↑↓ 焦点导航");
mustContain(clientSrc, "mousedown", "点击外部关闭");
mustContain(clientSrc, "menuAvailable", "具备面板能力的段收起态保留箭头");

/* ---- 8. 注册面 API ---- */
for (const api of [
  "register: function (item)",
  "unregister: function (id)",
  "update: function (id, patch)",
  "list: function ()",
  "subscribe: function (listener)",
  "revision: function ()",
]) {
  mustContain(clientSrc, api, `注册面提供 ${api.split(":")[0]}`);
}
mustContain(clientSrc, "item.id 必须是非空字符串", "注册面校验 id");
mustContain(clientSrc, "段数量已达上限", "注册面提供段数量上限保护");

/* ---- 汇总 ---- */
const json = process.argv.includes("--json");
if (json) {
  console.log(JSON.stringify({ pass: passes.length, fail: failures.length, failures }, null, 2));
} else {
  for (const line of passes) console.log(`  ✅ ${line}`);
  for (const line of failures) console.log(`  ❌ ${line}`);
  console.log(`\n结果: ${passes.length} 通过, ${failures.length} 失败`);
}
process.exit(failures.length === 0 ? 0 : 1);
