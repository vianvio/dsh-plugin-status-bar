#!/usr/bin/env node
/**
 * scripts/compat_status_bar.mjs — 对着**本机安装的 DSH** 做的兼容性闸门。
 *
 * 这个脚本回答一个问题：插件声明的东西，装在这台机器上的那份 DSH 现在还认不认？
 * 具体查四类漂移：
 *   1. 槽位契约：conversation.input.dock 还在不在？kind/scope 有没有变？
 *   2. 位次契约：宿主的 dock 条目 order 是否都还在本插件之下（状态条要贴着输入卡片）。
 *   3. 令牌漂移：插件样式表引用的每一个 --dsw-* / --dsh-composer-* 是否仍有定义。
 *      （宿主改令牌名是最容易让插件"看着没坏、实际错位/失色"的一类改动。）
 *   4. 清单契约：插件 package.json 的 dsh.client 字段，安装版的校验器是否还接受。
 *
 * 只读、不联网、秒级。几何对不对由 scripts/render_status_bar.mjs 在真浏览器里量。
 *
 * 用法：
 *   node scripts/compat_status_bar.mjs [--json]
 * 环境：
 *   DSH_ASAR  指定 app.asar（默认 macOS 桌面版安装位置）
 */
import { readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DshInstall, functionBody, materializePackage } from "./lib/dsh-install.mjs";
import { readHostFrame } from "./lib/host-frame.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_PATH = process.env.DSH_STATUS_BAR_CLIENT ?? join(ROOT, "client.js");
const asJson = process.argv.includes("--json");

const passes = [];
const failures = [];
function check(ok, label, detail) {
  if (ok) passes.push(label);
  else failures.push(detail === undefined ? label : `${label} — ${detail}`);
}

/* ── 被测插件 ─────────────────────────────────────────────────────────────── */
const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const clientSrc = readFileSync(CLIENT_PATH, "utf8");

let captured = null;
globalThis.window = { __ModuleLoader__: { load: (entry) => { captured = entry; } } };
new Function(clientSrc)();
const mod = captured.factory((id) => {
  if (id === "react") return { createElement: () => null, Children: { toArray: (value) => value } };
  throw new Error(`unexpected require: ${id}`);
});
const stylesheet = mod.stylesheet;

/* ── 安装版 DSH ───────────────────────────────────────────────────────────── */
const dsh = new DshInstall();
const frame = readHostFrame(dsh);

/* 1. 槽位契约 */
const contract = dsh.inputDockContract();
check(contract.kind === "list", "宿主的 conversation.input.dock 仍是 list 槽位", `kind=${contract.kind}`);
check(contract.scope === "session", "槽位作用域仍是 session", `scope=${contract.scope}`);
check(
  captured.id === packageJson.name,
  "客户端模块 id == 包名（__ModuleLoader__.load 的 id 必须与 Loader 行一致）",
  `${captured.id} vs ${packageJson.name}`
);

/* 2. 位次契约 */
const occupants = dsh.inputDockOccupants();
const pluginOrder = 30;
check(occupants.length > 0, "读到宿主自己注册进该槽位的条目", `occupants=${JSON.stringify(occupants)}`);
for (const occupant of occupants) {
  check(
    occupant.order < pluginOrder,
    `宿主条目 ${occupant.id}（order=${occupant.order}）排在本插件（order=${pluginOrder}）之前`,
    "位次反了 → 状态条不会贴着输入卡片上沿"
  );
}

/* 3. 令牌漂移 */
const themeCss = dsh.themeCss;
const definedTokens = new Set([...themeCss.matchAll(/(--dsw-[a-z0-9-]+)\s*:/g)].map((match) => match[1]));

const referenced = (source) => [...new Set([...String(source).matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((match) => match[1]))];
const pluginTokens = referenced(stylesheet);
const dswTokens = pluginTokens.filter((token) => token.startsWith("--dsw-"));
const composerTokens = pluginTokens.filter((token) => token.startsWith("--dsh-composer-"));

check(dswTokens.length > 0, "插件样式表引用了宿主设计令牌", `count=${dswTokens.length}`);
for (const token of dswTokens) {
  check(definedTokens.has(token), `安装版主题仍有令牌 ${token}`, "宿主改名或删除了这个令牌，插件会静默退化到回退值");
}

/* 插件依赖的 composer 几何令牌：从宿主 composer CSS 里现查 */
const hostComposerCss = [
  readRule(dsh, "dsh-client-ui-conversation", "composerStack", "conversationRoot", "composerStack"),
  readRule(dsh, "dsh-client-ui-conversation", "composerStack", "conversationRoot", "body"),
  readRule(dsh, "dsh-client-ui-conversation", "placeholder", "inputBar", "root")
].join(";");
const composerDefined = new Set([...hostComposerCss.matchAll(/(--dsh-composer-[a-z0-9-]+)\s*:/g)].map((match) => match[1]));
check(composerTokens.length > 0, "插件样式表引用了宿主 composer 几何令牌", `count=${composerTokens.length}`);
for (const token of composerTokens) {
  check(composerDefined.has(token), `宿主的 composer 仍定义 ${token}`, "几何令牌没了，宽度/贴边推导会落到回退值");
}

/* 几何推导必须写的是宿主自己的 dock 约定，而不是写死的像素 */
const derivation = /--dsh-status-bar-host-inset:\s*calc\(\s*var\(--dsh-composer-side-clearance,\s*16px\)\s*\+\s*2\s*\*\s*var\(--dsh-composer-dock-inset,\s*8px\)\s*\)/.exec(stylesheet);
check(derivation !== null, "状态条内缩量由宿主 composer 令牌推出（不写死像素）");
check(/var\(--dsh-status-bar-inset,/.test(stylesheet), "--dsh-status-bar-inset 仍是可覆盖的对外旋钮");
check(
  /margin:0 auto calc\(0px - var\(--dsh-composer-stack-gap,6px\)\)/.test(stylesheet),
  "用负 margin 吃掉 composer 栈间距（与卡片上沿贴合）"
);
check(/border-radius:var\(--dsw-radius-lg,12px\)/.test(stylesheet), "顶圆角走宿主圆角令牌 --dsw-radius-lg");
check(/background:var\(--dsw-specific-menu/.test(stylesheet), "表面走宿主 dock 面板材质 --dsw-specific-menu");
check(!/#000/.test(stylesheet), "样式表里没有写死的 #000（浅色主题会变成灰带）");

/* 宿主自己也把"卡片边缘之内 2×dock-inset"当作 dock 面板的落位 */
const queueDock = readRule(dsh, "dsh-client-ui-conversation", "pendingRow", "queueDock", "dock");
const queueTracks = (queueDock.match(/--dsh-composer-dock-inset/g) ?? []).length;
check(queueTracks >= 2, "宿主 QueueDock 仍按 --dsh-composer-dock-inset 落位", `tracked=${queueTracks}`);

/* 4. 清单契约 */
const accepted = new Set(dsh.clientDeclarationFields());
const declaration = packageJson.dsh?.client ?? {};
check(Object.keys(declaration).length > 0, "package.json 声明了 dsh.client（客户端半体）");
for (const field of Object.keys(declaration)) {
  check(accepted.has(field), `安装版的 dsh.client 校验器接受字段 ${field}`, `接受的是：${[...accepted].join(",")}`);
}
check(declaration.platform === "web", "dsh.client.platform == web", `platform=${declaration.platform}`);
check(
  typeof packageJson.exports?.["./client"] === "string",
  "声明了 dsh.client 就必须导出 ./client（否则宿主直接抛错）"
);
const moduleId = captured.id;
const loaderRow = readFileSync(join(ROOT, "cordis.patch.yml"), "utf8");
check(loaderRow.includes(moduleId), "cordis.patch.yml 的 Loader 行名与客户端模块 id 一致", `expected ${moduleId}`);
check(mod.name === moduleId, "exports.name 与模块 id 一致（日志/effect 树里认得出是哪个插件）", `name=${mod.name}`);
check(mod.serviceName === "inputStatusBar", "对外服务名仍是 inputStatusBar（使用方 inject 的就是它）", `serviceName=${mod.serviceName}`);

/* 5. 版本契约：宿主 preflight 只认 peerDependencies 里的 @deepseek-ai/dsh*，
 * 且不满足时是把整行**禁用**（不是警告）。所以要用宿主自己那份 semver 来判定，
 * 并且确认这个区间真的挡得住下一个次版本，而不是写成永远为真。 */
const declaredPeers = Object.entries(packageJson.peerDependencies ?? {});
const gatePeers = declaredPeers.filter(
  ([name]) => name === "@deepseek-ai/dsh" || name.startsWith("@deepseek-ai/dsh-")
);
check(
  gatePeers.length > 0,
  "声明了 @deepseek-ai/dsh* 的 peerDependencies（宿主 preflight 才会读）",
  `声明了：${declaredPeers.map(([name]) => name).join(", ") || "（无）"}`
);

const semverRoot = join(tmpdir(), `dsh-status-bar-semver-${process.pid}`);
materializePackage(dsh.asar, "semver", semverRoot);
/* createRequire 只拿这个路径当解析基准（文件本身不必存在），所以落在 semverRoot 下就能解析到 semver/ */
const semver = createRequire(join(semverRoot, "resolve-baseline.cjs"))("semver");
const semverOptions = { includePrerelease: true };
const runtimeVersion = dsh.version;

for (const [name, range] of gatePeers) {
  check(
    semver.satisfies(runtimeVersion, range, semverOptions),
    `peer ${name} 区间 "${range}" 接受本机 dsh ${runtimeVersion}`,
    "不满足 → 宿主 preflight 会直接禁用这一行"
  );
}
const [major, minor] = runtimeVersion.split(".").map((part) => Number.parseInt(part, 10));
const nextMinorFloor = `${major}.${minor + 1}.0-0`;
for (const [name, range] of gatePeers) {
  check(
    !semver.satisfies(nextMinorFloor, range, semverOptions),
    `peer ${name} 区间挡住下一个次版本 ${nextMinorFloor}`,
    `"${range}" 连 ${nextMinorFloor} 都接受 → 起不到闸门作用`
  );
}
rmSync(semverRoot, { recursive: true, force: true });

/* 上面那条判定是照 dsh-app-boot 的 evaluatePluginCompatibility 抄的。宿主哪天换了判定方式，
 * 这里必须跟着变——所以顺带确认那段实现还是这个样子，别让"抄来的规则"悄悄过期。 */
{
  const appBoot = dsh.clientFile("dsh-app-boot", "lib/index.js");
  const at = appBoot.indexOf("function evaluatePluginCompatibility(");
  check(at !== -1, "宿主里仍有 evaluatePluginCompatibility（preflight 的判定函数）");
  const body = at === -1 ? "" : functionBody(appBoot, "evaluatePluginCompatibility");
  check(
    body.includes('"@deepseek-ai/dsh"') && body.includes('"@deepseek-ai/dsh-"'),
    "preflight 仍只看 @deepseek-ai/dsh / @deepseek-ai/dsh-* 的 peerDependencies",
    "规则变了：本脚本的 semver 判定依据需要同步"
  );
  check(body.includes("includePrerelease: true"), "preflight 判预发布版本时仍带 includePrerelease");
  check(body.includes("peerDependencies"), "preflight 仍从 peerDependencies 取区间");

  /* 本包把 @deepseek-ai/dsh* 的 peer 标成了 optional——理由是 npm 会**自动装**非 optional 的
   * peer，而这三个包由 DSH 运行时提供（`npm install` 会把整个 DSH 依赖树拉进仓库：实测 512MB、
   * 含 koffi/node-pty 这类原生模块）。这道闸门之所以还能用，正因为宿主 preflight 只看
   * `peerDependencies` 区间、**不看** `peerDependenciesMeta.optional`。
   * 宿主哪天开始尊重 optional，这里会红——那时要么去掉 peerDependenciesMeta，要么换声明位置。 */
  check(
    !body.includes("peerDependenciesMeta") && !body.includes("optional"),
    "preflight 不看 peerDependenciesMeta.optional（所以标成 optional 不会关掉这道闸门）",
    "宿主的判定开始尊重 optional 了：本包的 @deepseek-ai/dsh* 就不能再标 optional"
  );
}

/* ── 结果 ─────────────────────────────────────────────────────────────────── */
const summary = {
  dsh: dsh.info,
  asar: dsh.asar.path,
  slot: contract,
  hostOccupants: occupants,
  pluginOrder,
  tokens: { referenced: dswTokens.length + composerTokens.length },
  passes: passes.length,
  failures
};

if (asJson) {
  console.log(JSON.stringify({ summary, passes, failures }, null, 2));
} else {
  console.log(`宿主 DSH ${dsh.info.version}（${dsh.info.platform}/${dsh.info.arch}）`);
  console.log(`槽位：${contract.summary}`);
  console.log(`宿主位次：${occupants.map((item) => `${item.id}@${item.order}`).join("  ")}   本插件：status-bar@${pluginOrder}\n`);
  for (const label of passes) console.log(`  ✅ ${label}`);
  for (const label of failures) console.log(`  ❌ ${label}`);
  console.log(`\n结果: ${passes.length} 通过, ${failures.length} 失败`);
}

process.exit(failures.length === 0 ? 0 : 1);

/** 取宿主某个 CSS module 的一条规则声明体。 */
function readRule(install, pkg, marker, _key, rule) {
  const { prefix, css } = install.cssModule(pkg, marker);
  return new RegExp(`\\.${prefix}_${rule}(?:\\s*,[^{]*)?\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
}
