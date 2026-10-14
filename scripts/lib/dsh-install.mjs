/**
 * scripts/lib/dsh-install.mjs — 读取「本机安装的 DSH」里的真实宿主产物。
 *
 * 兼容性断言必须对着**真的装在这台机器上的那一份 DSH**做，而不是对着本仓库里
 * 抄下来的一份 CSS 快照做——快照会过期，抄错了还会把错误固化成"契约"。
 *
 * macOS 桌面版的宿主代码在 `DeepSeek Harness.app/Contents/Resources/app.asar`
 * 里的 `dsh/` 下。asar 是个简单容器（8 字节前缀 + JSON 索引 + 拼接的文件体），
 * 这里用手写的 reader 直接读里面的文件，不依赖 Electron、也不需要解包到磁盘。
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** 桌面版默认安装位置（可用 DSH_ASAR 覆盖）。 */
export const DEFAULT_ASAR = "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar";

/**
 * 定位本机安装的 DSH asar。
 * @returns 存在的 asar 绝对路径。
 * @throws 当找不到安装（避免"跳过所以通过"的假绿）。
 */
export function locateAsar(env = process.env) {
  const candidates = [env.DSH_ASAR, DEFAULT_ASAR].filter(
    (value) => typeof value === "string" && value.length > 0
  );
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(
    `找不到本机安装的 DSH：试过 ${candidates.join(" / ")}。` +
      `装好后重跑，或用 DSH_ASAR=<path/to/app.asar> 指定。`
  );
}

/** 单个 asar 的打开句柄：索引解析一次，后续按路径取字节。 */
export class Asar {
  /**
   * @param path - app.asar 绝对路径。
   */
  constructor(path) {
    this.path = path;
    const buffer = readFileSync(path);
    this.buffer = buffer;
    const headerSize = buffer.readUInt32LE(4);
    const headerStringLength = buffer.readUInt32LE(12);
    const headerJson = buffer.subarray(16, 16 + headerStringLength).toString("utf8");
    this.header = JSON.parse(headerJson);
    /** 文件体起始偏移：8 字节 pickle 头 + 头部块长度。 */
    this.baseOffset = 8 + headerSize;
  }

  /**
   * 取 asar 内某个条目的元数据。
   * @param asarPath - 形如 "dsh/package.json" 的路径（不以 / 开头）。
   * @returns 条目，或 undefined。
   */
  entry(asarPath) {
    let node = this.header;
    for (const segment of asarPath.split("/")) {
      if (node === undefined || node.files === undefined) return undefined;
      node = node.files[segment];
    }
    return this.nodeAt(asarPath);
  }

  /**
   * 取 asar 内某个条目（文件**或目录**）的原始节点。
   * @param asarPath - 形如 "dsh/package.json" 的路径。
   * @returns 节点，或 undefined。
   */
  nodeAt(asarPath) {
    let node = this.header;
    for (const segment of asarPath.split("/")) {
      if (node === undefined || node.files === undefined) return undefined;
      node = node.files[segment];
    }
    return node;
  }

  /**
   * 读 asar 内一个文件的 UTF-8 文本。
   * @param asarPath - 形如 "dsh/package.json" 的路径。
   * @returns 文件内容。
   * @throws 当路径不存在、是目录，或内容被放在 app.asar.unpacked。
   */
  read(asarPath) {
    const node = this.nodeAt(asarPath);
    if (node === undefined) throw new Error(`asar 内没有这个文件：${asarPath}（${this.path}）`);
    if (node.files !== undefined) throw new Error(`asar 内这是个目录，不是文件：${asarPath}`);
    if (node.unpacked === true) throw new Error(`文件在 app.asar.unpacked 里，asar 内没有内容：${asarPath}`);
    const start = this.baseOffset + Number(node.offset);
    return this.buffer.subarray(start, start + node.size).toString("utf8");
  }

  /**
   * 读 asar 内一个文件的原始字节。
   * @param asarPath - 形如 "dsh/package.json" 的路径。
   * @returns 字节。
   */
  readBytes(asarPath) {
    const node = this.nodeAt(asarPath);
    if (node === undefined) throw new Error(`asar 内没有这个文件：${asarPath}（${this.path}）`);
    if (node.files !== undefined) throw new Error(`asar 内这是个目录，不是文件：${asarPath}`);
    if (node.unpacked === true) throw new Error(`文件在 app.asar.unpacked 里，asar 内没有内容：${asarPath}`);
    const start = this.baseOffset + Number(node.offset);
    return this.buffer.subarray(start, start + node.size);
  }

  /**
   * 一个目录下所有文件的 asar 路径（递归）。
   * @param asarDir - 形如 "dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation"。
   * @returns 文件路径数组；目录不存在时为空。
   */
  list(asarDir) {
    const root = this.nodeAt(asarDir);
    const out = [];
    if (root === undefined || root.files === undefined) return out;
    const walk = (node, prefix) => {
      for (const [name, child] of Object.entries(node.files)) {
        const next = `${prefix}/${name}`;
        if (child.files !== undefined) walk(child, next);
        else out.push(next);
      }
    };
    walk(root, asarDir);
    return out;
  }
}

/** 桌面版运行时清单（版本号的权威来源）。 */
export const RUNTIME_MANIFEST = "dsh/desktop-runtime.json";

/** 已安装客户端的包根。 */
export const CLIENT_PACKAGES = "dsh/node_modules/@deepseek-ai";

/**
 * 读取安装版本与关键包的位置。
 * @param asar - 已打开的 asar。
 * @returns 版本与路径信息。
 */
export function describeInstall(asar) {
  const manifest = JSON.parse(asar.read(RUNTIME_MANIFEST));
  return {
    version: manifest.release?.version ?? "unknown",
    hostProtocolVersion: manifest.release?.hostProtocolVersion,
    nodeVersion: manifest.release?.nodeVersion,
    platform: manifest.platform,
    arch: manifest.arch
  };
}

/**
 * 从客户端 bundle 里抠出一段被压缩进 `const css = "<...>"` 的 CSS。
 *
 * 宿主把每个 CSS module 内联成 bundle 里的一个字符串常量，选择器带哈希前缀
 * （例如 `.ST7X_W_composerStack`）。这里按"某个独一无二的类名后缀"定位那个常量，
 * 拿到**真的**规则文本，而不是本仓库抄的一份。
 *
 * @param source - bundle 源码。
 * @param marker - 只在该 CSS 常量里出现的类名后缀，例如 "composerStack"。
 * @returns `{ prefix, css }`：哈希前缀与完整 CSS 文本。
 * @throws 当定位不到（宿主改了打包方式时应当响亮地失败，而不是静默跳过）。
 */
export function extractCssModule(source, marker) {
  const selector = new RegExp(`\\.([A-Za-z0-9_-]{4,12})_${marker}\\b`);
  const match = selector.exec(source);
  if (match === null) throw new Error(`bundle 里找不到 CSS module 标记：_${marker}`);
  const prefix = match[1];
  /* 打包器给同一个 bundle 里的常量编号：css / css$1 / css$4 … */
  for (const constant of jsStringConstants(source, "css(?:\\$\\d+)?")) {
    if (constant.literal.includes(`.${prefix}_${marker}`)) {
      return { prefix, css: unescapeJsString(constant.literal) };
    }
  }
  throw new Error(`bundle 里找不到包含 .${prefix}_${marker} 的 css 常量`);
}

/**
 * 从 `"` 之后开始扫描一个 JS 字符串字面量，返回原始文本与结束位置。
 *
 * 必须按转义规则扫，不能 `indexOf('";')`：内联的 CSS 里到处都是
 * `content:\"\";`，那里的 `"` 是转义过的，按子串找会**提前截断** CSS，
 * 于是拿到半截规则还算"读到宿主的真产物"。
 *
 * @param source - 完整源码。
 * @param from - 起始引号之后的下标。
 * @returns `{ literal, end }`；`literal` 不含首尾引号，`end` 是结束引号的下标。
 * @throws 当字面量没有结束。
 */
export function readJsStringLiteral(source, from) {
  for (let at = from; at < source.length; at += 1) {
    const char = source[at];
    if (char === "\\") {
      at += 1;
      continue;
    }
    if (char === '"') return { literal: source.slice(from, at), end: at };
  }
  throw new Error("字符串字面量没有结束的引号");
}

/**
 * 抠出源码里所有 `<const|var|let> <name> = "…"` 字面量。
 * @param source - 完整源码。
 * @param namePattern - 变量名正则片段，例如 `css(?:\\$\\d+)?`。
 * @returns 每个字面量：`{ name, at, literal }`。
 */
export function jsStringConstants(source, namePattern) {
  const declaration = new RegExp(`(?:const|var|let)\\s+(${namePattern})\\s*=\\s*"`, "g");
  const out = [];
  let match;
  while ((match = declaration.exec(source)) !== null) {
    const from = match.index + match[0].length;
    const { literal, end } = readJsStringLiteral(source, from);
    out.push({ name: match[1], at: from, literal });
    declaration.lastIndex = end;
  }
  return out;
}

/**
 * 还原被写进 JS 字符串字面量里的 CSS（主要是 \" 与 \\）。
 * @param literal - 字符串字面量内部文本。
 * @returns 还原后的文本。
 */
export function unescapeJsString(literal) {
  return literal.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_all, escape) => {
    if (escape === "n") return "\n";
    if (escape === "t") return "\t";
    if (escape === "r") return "\r";
    if (escape[0] === "u") return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
    if (escape[0] === "x") return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
    return escape;
  });
}

/**
 * 取某个 CSS module 里一条规则的声明体。
 * @param css - CSS 文本（选择器带哈希前缀）。
 * @param prefix - 哈希前缀。
 * @param className - 不含前缀的类名，例如 "root"。
 * @returns 声明体文本，或 undefined。
 */
export function ruleBody(css, prefix, className) {
  const match = new RegExp(`\\.${prefix}_${className}(?:\\s*,[^{]*)?\\{([^}]*)\\}`).exec(css);
  return match === null ? undefined : match[1];
}

/**
 * 取主题 CSS 里某个自定义属性的定义值。
 * @param css - design-platform.css 文本。
 * @param name - 含 `--` 的属性名。
 * @returns 值文本，或 undefined。
 */
export function customProperty(css, name) {
  const match = new RegExp(`${name}\\s*:\\s*([^;}]+)`).exec(css);
  return match === null ? undefined : match[1].trim();
}

/**
 * 「本机 DSH 客户端」的只读门面：把本插件依赖的宿主产物集中到一处。
 */
export class DshInstall {
  /**
   * @param options - 可选的 asar 路径覆盖。
   */
  constructor(options = {}) {
    this.asar = new Asar(options.asarPath ?? locateAsar(options.env ?? process.env));
    this.info = describeInstall(this.asar);
  }

  /** 已安装版本号。 */
  get version() {
    return this.info.version;
  }

  /**
   * 读一个客户端包里的文件。
   * @param pkg - 包名（不含 @deepseek-ai/ 前缀）。
   * @param relative - 包内相对路径。
   * @returns 文本。
   */
  clientFile(pkg, relative) {
    return this.asar.read(`${CLIENT_PACKAGES}/${pkg}/${relative}`);
  }

  /**
   * 读客户端包的 package.json。
   * @param pkg - 包名（不含 @deepseek-ai/ 前缀）。
   * @returns 解析后的清单。
   */
  clientManifest(pkg) {
    return JSON.parse(this.clientFile(pkg, "package.json"));
  }

  /**
   * 客户端 bundle 里内联的全部设计令牌 CSS。
   *
   * 令牌被拆进多个常量：`base_css_default` 有 radius，`design_platform_css_default`
   * 有颜色别名，`gradient_shadow_text_css_default` 有 elevation 与 backdrop-filter。
   * 只取其中一个会漏掉一半，所以这里把全部 `*_css_default` 都收进来。
   * @returns 拼接后的 CSS 文本。
   */
  get themeCss() {
    const source = this.clientFile("dsh-client-ui-theme", "lib/client.js");
    const constants = jsStringConstants(source, "[a-zA-Z_$][\\w$]*");
    const parts = constants
      .filter((entry) => /_css_default$/.test(entry.name))
      .map((entry) => unescapeJsString(entry.literal));
    if (parts.length === 0) throw new Error("dsh-client-ui-theme: 没有找到设计令牌 CSS 常量");
    return parts.join("\n");
  }

  /**
   * 取一个设计令牌的值（对 `:root`/`body` 的默认态，即浅色）。
   * @param name - 含 `--` 的令牌名。
   * @returns 值文本。
   * @throws 当令牌不存在（宿主改名时应当响亮失败）。
   */
  themeToken(name) {
    const value = customProperty(this.themeCss, name);
    if (value === undefined) throw new Error(`主题里没有令牌 ${name}`);
    return value;
  }

  /**
   * 抠出某个客户端 bundle 里的一段 CSS module。
   * @param pkg - 包名（不含 @deepseek-ai/ 前缀）。
   * @param marker - 类名后缀。
   * @param relative - bundle 相对路径，默认 lib/client.js。
   * @returns `{ prefix, css, source }`。
   */
  cssModule(pkg, marker, relative = "lib/client.js") {
    const source = this.clientFile(pkg, relative);
    return { ...extractCssModule(source, marker), source };
  }

  /**
   * 宿主自己注册进 `conversation.input.dock` 的条目（id 与 order）。
   * 用于确认本插件的 order 仍然排在最后（贴着输入卡片）。
   * @returns `{ id, order, owner }[]`。
   */
  inputDockOccupants() {
    const out = [];
    const packages = [
      ["dsh-client-ui-conversation", "lib/client.js"],
      ["dsh-client-ui-goal", "lib/client.js"],
      ["dsh-client-ui-chat", "lib/client.js"]
    ];
    for (const [pkg, relative] of packages) {
      let source;
      try {
        source = this.clientFile(pkg, relative);
      } catch {
        continue;
      }
      const pattern = /slots\.inject\(\s*"conversation\.input\.dock"[\s\S]{0,400}?id:\s*"([^"]+)"[\s\S]{0,200}?order:\s*(-?\d+)/g;
      let match;
      while ((match = pattern.exec(source)) !== null) {
        out.push({ id: match[1], order: Number(match[2]), owner: pkg.replace(/^dsh-client-ui-/, "") });
      }
    }
    return out.sort((left, right) => left.order - right.order);
  }

  /**
   * 宿主的 `conversation.input.dock` 契约（来自宿主自己的槽位目录）。
   * @returns `{ kind, scope, summary, occupants }`。
   */
  inputDockContract() {
    const source = this.clientFile("dsh-cordis-client-runner", "lib/client.js");
    const at = source.indexOf('key: "conversation.input.dock"');
    if (at === -1) throw new Error("宿主槽位目录里没有 conversation.input.dock");
    const slice = source.slice(at, at + 4000);
    const kind = /kind:\s*"([^"]+)"/.exec(slice)?.[1];
    const scope = /scope:\s*"([^"]+)"/.exec(slice)?.[1];
    const summary = /summary:\s*"([^"]+)"/.exec(slice)?.[1];
    const declaredBy = /declaredBy:\s*"([^"]+)"/.exec(slice)?.[1];
    return { kind, scope, summary, declaredBy };
  }

  /**
   * `dsh-client-modules` 的 manifest 校验器接受哪些 `dsh.client` 字段。
   * @returns 字段名数组。
   */
  clientDeclarationFields() {
    const source = this.clientFile("dsh-client-modules", "lib/index.js");
    const at = source.indexOf("function parseDshClient(");
    if (at === -1) throw new Error("找不到 parseDshClient");
    const body = source.slice(at, at + 1600);
    return [...body.matchAll(/decl\.([A-Za-z]+)/g)].map((match) => match[1]).filter((value, index, all) => all.indexOf(value) === index);
  }
}

/**
 * 把 asar 里的一个包落到临时目录的 `node_modules/` 下，好让 Node 能真的 `require` 它。
 *
 * 用途：兼容性断言要用**宿主自己的**规则与库（例如宿主 preflight 用的那个 semver），
 * 而不是本仓库另写一套近似实现——近似实现会把"我以为是这个规则"当成契约。
 *
 * 落成 `destDir/node_modules/<pkg>` 而不是 `destDir/<pkg>`：裸模块名是按
 * `node_modules` 目录链解析的，直接放在 destDir 下 Node 是找不到的。
 *
 * @param asar - 已打开的 asar。
 * @param pkgName - 包目录名，例如 "semver"（作用域包写 "@scope/name"）。
 * @param destDir - 落盘根目录（会被创建）。
 * @returns 落盘后的包目录绝对路径。
 * @throws 当 asar 里没有这个包，或它有文件放在 app.asar.unpacked。
 */
export function materializePackage(asar, pkgName, destDir) {
  const prefix = `dsh/node_modules/${pkgName}/`;
  const files = asar.list(`dsh/node_modules/${pkgName}`);
  if (files.length === 0) throw new Error(`asar 里没有包 ${pkgName}`);
  const root = join(destDir, "node_modules", pkgName);
  for (const file of files) {
    const node = asar.nodeAt(file);
    if (node.unpacked === true) throw new Error(`${pkgName} 有文件在 app.asar.unpacked，无法整体落盘：${file}`);
    const target = join(root, file.slice(prefix.length));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, asar.readBytes(file));
  }
  return root;
}

export { join };
