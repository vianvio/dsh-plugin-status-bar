# 实现细节与踩过的坑

README 里只留"怎么用"；这一页留给改这个插件的人——机制、坑、以及怎么验证。

## 它其实只有三件事

1. **它是"容器"，不是"功能"。**
   插件自己**一个段都不注册**：只提供 `inputStatusBar` 注册面，再把一条空横条挂到
   `conversation.input.dock` 上。段全部由使用方插件给（`dsh-plugin-agent-mesh` 就是拿它显示
   节点/席位状态的）。这条边界是刻意的——容器一旦开始自己塞内容，就会和业务插件抢位次、抢样式。

2. **几何不写死，全部由宿主 composer 的令牌推出来。**
   宿主把输入卡片的宽度、留白、dock 内缩都做成了自定义属性，
   见 [`packages/client/ui-conversation` 的 `ConversationRoot.module.css`]：

   | 令牌 | 0.2.0-rc.2 | 含义 |
   | --- | --- | --- |
   | `--dsh-composer-card-max-width` | `chat-content-width + 32px` | 输入卡片宽度上限 |
   | `--dsh-composer-side-clearance` | `16px` | 卡片距 composer 栈边缘的留白 |
   | `--dsh-composer-dock-inset` | `8px` | dock 面板相对卡片边缘的内缩单位 |
   | `--dsh-composer-stack-gap` | `6px` | 栈内间距（被负 margin 吃掉，让条体贴住卡片） |

   本插件内缩 = `side-clearance + 2 × dock-inset`，也就是**相对卡片边缘内缩 `2 × dock-inset`**。
   这不是凑出来的数：宿主自己的 `GoalBar`（`width: 100% - 2×side-clearance - 4×dock-inset`）和
   `QueueDock`（`100% - 2×side-clearance - 2×dock-inset` 再加 `padding: 0 dock-inset`）
   落位都是这个值。对齐它们的意义是——状态条和上面那些面板在同一列里，不会突出来一截。

3. **注册面走两条通道。**
   cordis 侧 `ctx.provide("inputStatusBar", bar)`（其它插件 `inject: ["inputStatusBar"]` 就能拿到），
   外加 `window.__DSH_INPUT_STATUS_BAR__` 兜底（拿不到 `ctx` 的集成方也能注册）。
   两条指向**同一个**注册面对象，所以从哪边注册看到的段列表都一致。

## 0.2.0 修掉的四处漂移

都是"能跑、但明显不对"的那一类——最麻烦的一类，因为不会报错。

| # | 0.1.0 的写法 | 在 0.2.0-rc.2 上的真实后果 | 怎么发现的 |
| --- | --- | --- | --- |
| 1 | 内缩写死 `14px` | 卡片两侧各有 16px 留白 → **状态条比输入卡片宽 2px/侧**（窄屏 640：`row=612` vs `card=608`），比同槽位的 goal/queue 面板宽 18px/侧 | `render_status_bar.mjs` 量出来的盒模型 |
| 2 | 表面 `color-mix(卡片表面 78%, #000)` | **浅色主题下渲染成一条灰带**：计算色 `color(srgb .78 .78 .78)` vs 卡片 `rgb(255,255,255)` | 同一脚本读 `getComputedStyle` 的背景色 |
| 3 | 圆角写死 `12px` | 宿主 dock 面板用 `--dsw-radius-lg`（16px），两者圆角对不上 | `compat_status_bar.mjs` 查令牌 |
| 4 | 样式在组件的 `useEffect` 里注入 | 第一帧先渲染没有样式的裸标记（宿主自己的客户端 bundle 是"工厂执行时"注入 CSS 的） | 读宿主 `dsh-client-modules` 的契约注释 |

顺手把 `exports.name` 从 `inputStatusBar` 改成 `dsh-plugin-status-bar`：模块 id 和 Loader 行名都是后者，
日志与 effect 树里原来认不出这是哪个插件。**服务名没有改**——使用方 `inject` 的是服务名，
改了会静默失效。

### 为什么样式只注入一次、还要能刷新

`installStyles()` 在 `apply` 时执行，返回的回收函数挂到 `ctx.effect` 上（随插件卸载回收）。
如果页面里**已经有**同 id 的 `<style>`（上一实例没来得及收回、或 HMR），就把内容刷成当前这一份、
但**不接管**它的生命周期——否则会把别人的元素拆掉。三种情况都有单测钉着
（`scripts/smoke_status_bar.mjs`）。

## `peerDependencies` 是闸门，不是装饰

宿主的 profile preflight（`@deepseek-ai/dsh-app-boot` 的 `evaluatePluginCompatibility`）会读
插件 `peerDependencies` 里 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 的区间，**不满足就把整行禁用**，
只留一句提示和 `dsh plugin allow-version` 的豁免办法。所以：

- 区间写太窄 → 宿主小版本一升，插件就从界面上"消失"（不是崩，是静默缺席，更难查）；
- 区间写成永远为真 → 起了反作用，真正的破坏性变更会被放过去。

本包写的是 `>=0.2.0-rc.2 <0.3.0-0`。`compat_status_bar.mjs` 用**宿主自己那份 semver**
（从 `app.asar` 里落盘出来）断言两件事：本机版本被接受、下一个次版本被挡住。
顺带确认宿主的判定函数还是那个形状——别让"抄来的规则"悄悄过期。

## 怎么验证（三层，都不抄宿主的 CSS）

宿主产物是从 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar` **现读**的
（手写的 asar reader，`scripts/lib/dsh-install.mjs`）。asar 就是"8 字节前缀 + JSON 索引 + 拼接的文件体"，
直接按 offset 取字节即可，不需要 Electron、也不用解包到磁盘。

| 命令 | 查什么 | 需要什么 |
| --- | --- | --- |
| `npm run verify` | 导出面、几何推导式、样式原语、无障碍、注册面 API | 无 |
| `npm run compat` | 槽位/位次/令牌/清单/版本契约，**对着安装版 DSH** | 本机装了 DSH |
| `npm run smoke:client` | `react-dom/server` 离线渲染（容器/段/面板/样式注入） | react（可跳过） |
| `npm run render` | 真浏览器里排版，量真实盒模型 + 出截图 | 本机装了 DSH + Chrome |

两个坑：

1. **抠 CSS 不能 `indexOf('";')`。** 内联的 CSS 里到处是 `content:\"\";`，那个引号是转义过的，
   按子串找会**提前截断**，然后你会拿着一份半截规则当"读到宿主的真产物"。要按转义规则扫字面量。
2. **`color-mix()` 的计算结果是 `color(srgb …)`，不是 `rgb()`。** 只会解析 `rgb()` 的话，
   "读不到颜色"会被当成"没问题"——这个检查就白写了。

`render` 的判别力是验证过的：把它指回 0.1.0 的产物（`DSH_STATUS_BAR_CLIENT=/path/to/old.js`），
42 条断言变红；指回 0.2.0，0 条失败。一个不会红的检查等于没有检查。

## 一条会被误当成 bug 的警告

`publint` 会对 `exports["./client"]` 报一条警告（"CJS 却被当成 ESM"），**这条不用修**：
包是 `"type": "module"`（宿主半 `index.js` 是 ESM），而 `client.js` 是页面按 `<script src>`
加载的**经典脚本**——DSH 是把 `exports["./client"]` 当**路径**读出来、把文件字节发给浏览器，
从来没有人会 `import()` 它。同生态的 `dsh-plugin-drop-path` 是同一个形状。

## 发版

```bash
npm version patch|minor|major      # 改版本号并打 tag
npm run compat && npm run render   # 发布前对着本机 DSH 过一遍
npm publish                        # prepublishOnly 会先跑 harness:check + npm test + verify
git push --follow-tags
```

`publishConfig` 固定了 `registry: https://registry.npmjs.org/` 与 `access: public`——
本机默认 registry 是 npmmirror，不固定的话会把"发到哪"交给环境（镜像站通常不接受发布，报错还很难读）。

npm 不允许同名同版本重发：**改了东西必须先 `npm version`**，否则 `publish` 会被拒（`EPUBLISHCONFLICT`）。
