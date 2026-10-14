/**
 * dsh-plugin-status-bar — 输入框上方「状态条容器」（客户端半体 / 通用基础设施）
 *
 * 这个包只做一件事：在 composer 上方（conversation.input.dock）维护一条
 * 比输入卡片略窄、居中、与卡片上沿贴合的横条，并把「段」注册面暴露给其它插件。
 * 它自身不包含任何业务逻辑，也不注册任何段——段落由使用方插件注册。
 *
 *   ctx.inputStatusBar.register({ id, order, label, status, tone, menu })  // 数据段
 *   ctx.inputStatusBar.register({ id, order, component: MySegment })       // 自定义段
 *
 * 公开样式原语见 README.md「样式契约」。 */
window.__ModuleLoader__.load({
  id: "dsh-plugin-status-bar",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var react = require("react");

    var inject = ["slots"];

    var SERVICE = "inputStatusBar";
    var BRIDGE = "__DSH_INPUT_STATUS_BAR__";
    var DEFAULT_ORDER = 100;
    var PANEL_PREFIX = "dsh-status-panel-";
    var STYLE_ID = "dsh-status-bar-css";
    var MAX_ITEMS = 16;

    var CSS = [
      "@keyframes dshStatusPulse{0%,100%{box-shadow:0 0 0 0 rgba(16,185,129,.55);opacity:1}50%{box-shadow:0 0 0 4px rgba(16,185,129,0);opacity:.55}}",
      "@keyframes dshStatusRise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}",
      /* ── 挂载行 ────────────────────────────────────────────────────────────
       * 宽度不写死，按宿主 composer 的令牌推出来，一次满足三件事：
       *   ① 一定比输入卡片窄——卡片两侧各有 --dsh-composer-side-clearance 的留白；
       *   ② 与宿主自己那些 dock 面板左右对齐——它们在卡片边缘之内 2×--dsh-composer-dock-inset；
       *   ③ 与卡片上沿贴合——吃掉 composer 栈的 gap。
       * 内缩量可以自己定：给 --dsh-status-bar-inset（相对 composer 栈边缘，单位 px 的 calc），
       * 下面那套推导只作兜底；max-width 项里的 + side-clearance 是把「栈内缩」换成「卡片内缩」。 */
      ".dshStatusDockRow{--dsh-status-bar-host-inset:calc(var(--dsh-composer-side-clearance,16px) + 2 * var(--dsh-composer-dock-inset,8px));--dsh-status-bar-height:32px;box-sizing:border-box;display:flex;align-items:center;width:calc(100% - 2 * var(--dsh-status-bar-inset,var(--dsh-status-bar-host-inset)));max-width:calc(var(--dsh-composer-card-max-width,800px) - 2 * var(--dsh-status-bar-inset,var(--dsh-status-bar-host-inset)) + 2 * var(--dsh-composer-side-clearance,16px));margin:0 auto calc(0px - var(--dsh-composer-stack-gap,6px));min-width:0}",
      /* ── 容器：整条状态条 ──────────────────────────────────────────────────
       * 外观照抄宿主自己的 dock 面板（QueueDock / TodoPanel / GoalBar）那一套材质：
       * 菜单表面 + 菜单背板滤镜 + 顶部圆角 --dsw-radius-lg + 只有上/左/右的 .5px 发丝描边。
       * 不再写死 12px 圆角与「把卡片表面往纯黑混」的表面——后者在浅色主题下会变成一条灰带。 */
      ".dshStatusBar{position:relative;isolation:isolate;box-sizing:border-box;display:flex;align-items:center;gap:2px;width:100%;min-width:0;height:var(--dsh-status-bar-height);padding:0 6px;border-radius:var(--dsw-radius-lg,12px) var(--dsw-radius-lg,12px) 0 0;color:var(--dsw-alias-label-primary,inherit);font-size:13px;line-height:20px}",
      ".dshStatusBar:before{content:\"\";position:absolute;z-index:-1;inset:0;border-radius:inherit;background:var(--dsw-specific-menu,var(--dsw-specific-input-major,#2a2a2a));backdrop-filter:var(--dsw-menu-backdrop-filter,none);pointer-events:none}",
      ".dshStatusBar:after{content:\"\";position:absolute;inset:0;border:.5px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));border-bottom:0;border-radius:inherit;pointer-events:none}",
      /* ── 段：任意数量状态组件并排，空间不足时收缩省略 ── */
      ".dshStatusSeg{position:relative;display:flex;align-items:center;flex:0 1 auto;min-width:0}",
      ".dshStatusSegEnd{margin-left:auto}",
      ".dshStatusSeg+.dshStatusSeg::before{content:\"\";flex:none;width:1px;height:14px;margin:0 4px;background:var(--dsw-alias-border-l1,rgba(255,255,255,.12))}",
      ".dshStatusSegButton{display:flex;align-items:center;gap:6px;height:24px;min-width:0;max-width:100%;padding:0 8px;border:0;border-radius:8px;background:0 0;color:inherit;font:inherit;font-size:13px;font-weight:500;line-height:20px;white-space:nowrap;cursor:pointer;outline:none}",
      ".dshStatusSegBody{display:flex;align-items:center;gap:6px;min-width:0}",
      "button.dshStatusSegButton:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07))}",
      "button.dshStatusSegButton:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3,rgba(255,255,255,.22))}",
      ".dshStatusSegStatic{cursor:default}",
      ".dshStatusChevron{flex:none;color:var(--dsw-alias-label-caption,rgba(255,255,255,.5));transition:transform .12s}",
      ".dshStatusChevronOpen{transform:rotate(180deg)}",
      /* ── 面板：向上展开，不遮挡输入卡片 ── */
      ".dshStatusPanel{position:absolute;left:0;bottom:calc(100% + 10px);z-index:20;display:flex;flex-direction:column;gap:2px;width:max-content;min-width:min(272px,100vw - 32px);max-width:min(344px,100vw - 32px);padding:6px;border-radius:var(--dsw-radius-xl,20px);background:var(--dsw-specific-menu,#232326);box-shadow:var(--dsw-elevation-prominent,0 16px 40px rgba(0,0,0,.5));color:var(--dsw-alias-label-primary,inherit);animation:dshStatusRise .12s ease}",
      /* ── 样式原语：段内容与面板内容的公开积木（见 README「样式契约」） ── */
      ".dshStatusDot{flex:none;width:6px;height:6px;border-radius:50%;background:#10b981}",
      ".dshStatusDotPulse{animation:dshStatusPulse 1.4s ease-in-out infinite}",
      ".dshStatusLabel{min-width:0;overflow:hidden;text-overflow:ellipsis}",
      ".dshStatusText{flex:none;font-weight:400;color:var(--dsw-alias-label-caption,rgba(255,255,255,.5))}",
      ".dshStatusHead{display:flex;align-items:center;gap:8px;padding:6px 10px 8px;font-size:13px;font-weight:600}",
      ".dshStatusBadge{margin-left:auto;padding:1px 7px;border:1px solid rgba(16,185,129,.35);border-radius:999px;background:rgba(16,185,129,.14);color:#10b981;font-size:11px;font-weight:500;line-height:16px}",
      ".dshStatusRow{display:flex;align-items:center;gap:8px;padding:4px 10px;font-size:12px;line-height:18px}",
      ".dshStatusRowLabel{flex:none;color:var(--dsw-alias-label-tertiary,rgba(255,255,255,.45))}",
      ".dshStatusRowValue{margin-left:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;color:var(--dsw-alias-label-secondary,rgba(255,255,255,.75));font-variant-numeric:tabular-nums}",
      ".dshStatusSep{height:1px;margin:5px 8px;background:var(--dsw-alias-border-l1,rgba(255,255,255,.1))}",
      ".dshStatusCell{display:flex;align-items:center;gap:8px;width:100%;height:34px;padding:0 10px;border:0;border-radius:10px;background:0 0;color:inherit;font:inherit;font-size:13px;text-align:left;cursor:pointer;outline:none}",
      ".dshStatusCell:hover:not(:disabled),.dshStatusCell:focus-visible{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07))}",
      ".dshStatusCell:disabled{color:var(--dsw-alias-label-dimmed,rgba(255,255,255,.35));cursor:default}",
      ".dshStatusCellValue{margin-left:auto;color:var(--dsw-alias-label-tertiary,rgba(255,255,255,.45))}",
      ".dshStatusCellValueOk{color:#10b981}",
      ".dshStatusHint{padding:2px 10px 6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,rgba(255,255,255,.4))}"
    ].join("");

    var DOT_COLORS = {
      idle: "#10b981",
      running: "#10b981",
      pass: "#10b981",
      warn: "#f59e0b",
      fail: "#ef4444"
    };

    /* ══ 注册面 ═══════════════════════════════════════════════════════════
     * 段契约（两种形态二选一）：
     *
     *   register({
     *     id: "market",              // 必填，唯一
     *     order: 100,                // 升序排列，默认 100
     *     align: "start" | "end",    // 默认 start（end 组右对齐）
     *     title: "…",                // tooltip / 无障碍名
     *
     *     // A. 数据段：容器渲染标准触发器（状态点 + 主文案 + 次文案 + 箭头）
     *     label, status, tone: "idle|running|pass|warn|fail", dot: true,
     *     menu: MenuComponent,       // 可选：点击展开标准面板 { item, bar, host, close, toggle }
     *     onSelect: (api) => {},     // 可选：无 menu 时的点击行为
     *
     *     // B. 自定义段：用传入的 Segment 原语复用标准外壳
     *     component: MySegment       // { item, bar, host, open, toggle, close, Segment }
     *   })
     *
     * 另有 unregister(id) / update(id, patch) / list() / subscribe(fn) / revision()。 */
    function createStatusBar() {
      var items = [];
      var listeners = [];
      var revision = 0;

      function orderOf(item) {
        return typeof item.order === "number" ? item.order : DEFAULT_ORDER;
      }

      function sortItems() {
        items.sort(function (left, right) {
          var diff = orderOf(left) - orderOf(right);
          if (diff !== 0) return diff;
          return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
        });
      }

      function emit() {
        revision += 1;
        var snapshot = items.slice();
        for (var i = 0; i < listeners.length; i += 1) {
          try {
            listeners[i](snapshot);
          } catch (error) {
            /* 单个订阅者异常不影响其它订阅者 */
          }
        }
      }

      var bar = {
        version: 1,
        register: function (item) {
          if (!item || typeof item.id !== "string" || item.id === "") {
            throw new Error("inputStatusBar.register: item.id 必须是非空字符串");
          }
          if (typeof item.component !== "function" && typeof item.label !== "string" && typeof item.render !== "function") {
            throw new Error("inputStatusBar.register: 段需要 component 或 label");
          }
          if (!items.some(function (entry) { return entry.id === item.id; }) && items.length >= MAX_ITEMS) {
            throw new Error("inputStatusBar.register: 段数量已达上限 " + MAX_ITEMS);
          }
          items = items.filter(function (entry) { return entry.id !== item.id; });
          items.push(item);
          sortItems();
          emit();
          return function () { bar.unregister(item.id); };
        },
        unregister: function (id) {
          var before = items.length;
          items = items.filter(function (entry) { return entry.id !== id; });
          if (items.length !== before) emit();
        },
        update: function (id, patch) {
          var changed = false;
          items = items.map(function (entry) {
            if (entry.id !== id) return entry;
            changed = true;
            return Object.assign({}, entry, patch);
          });
          if (!changed) return false;
          sortItems();
          emit();
          return true;
        },
        list: function () { return items.slice(); },
        subscribe: function (listener) {
          listeners.push(listener);
          return function () {
            var at = listeners.indexOf(listener);
            if (at >= 0) listeners.splice(at, 1);
          };
        },
        revision: function () { return revision; }
      };
      return bar;
    }

    /* ── 位置式建元素：数组子节点不再触发 key 警告（注册方不必写 key） ─────── */
    function element(type, config, children) {
      var args = [type, config];
      for (var i = 0; i < children.length; i += 1) {
        if (children[i] === null || children[i] === undefined) continue;
        args.push(children[i]);
      }
      return react.createElement.apply(react, args);
    }

    function chevronNode(open) {
      return react.createElement(
        "svg",
        {
          viewBox: "0 0 14 14",
          width: 14,
          height: 14,
          "aria-hidden": true,
          className: "dshStatusChevron" + (open ? " dshStatusChevronOpen" : "")
        },
        react.createElement("path", {
          d: "M3.5 5.25 7 8.75l3.5-3.5",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.5,
          strokeLinecap: "round",
          strokeLinejoin: "round"
        })
      );
    }

    /* ── 段外壳原语：所有段共用同一套外观与交互 ─────────────────────────── */
    function Segment(props) {
      var open = !!props.open;
      var menu = props.menu === undefined ? null : props.menu;
      var hasMenu = props.menuAvailable === true || menu !== null;
      var clickable = typeof props.onToggle === "function";
      var panelId = props.id ? PANEL_PREFIX + props.id : undefined;
      var buttonClass = "dshStatusSegButton" +
        (clickable ? "" : " dshStatusSegStatic") +
        (props.className ? " " + props.className : "");

      var body = element("span", { className: "dshStatusSegBody" }, react.Children.toArray(props.children));

      var common = {
        className: buttonClass,
        title: props.title,
        "aria-label": props.ariaLabel || props.title,
        "data-status-seg": props.id,
        "data-status-tone": props.tone
      };
      if (hasMenu) {
        common["aria-haspopup"] = "menu";
        common["aria-expanded"] = open ? "true" : "false";
        common["aria-controls"] = open ? panelId : undefined;
      }

      var trigger = clickable
        ? element("button", Object.assign({ type: "button", onClick: props.onToggle }, common), [body, hasMenu ? chevronNode(open) : null])
        : element("div", common, [body, hasMenu ? chevronNode(open) : null]);

      var panel = null;
      if (open && menu !== null) {
        panel = element(
          "div",
          {
            id: panelId,
            className: "dshStatusPanel",
            role: "menu",
            "aria-label": props.panelLabel || props.title
          },
          react.Children.toArray(menu)
        );
      }

      return element(
        "div",
        { className: "dshStatusSeg" + (props.align === "end" ? " dshStatusSegEnd" : "") },
        [trigger, panel]
      );
    }

    /* ── 容器：订阅注册面 → 渲染整条状态条 ─────────────────────────────── */
    function StatusBar(props) {
      var bar = props.bar;
      var itemsPair = react.useState(function () { return bar.list(); });
      var items = itemsPair[0];
      var setItems = itemsPair[1];

      var openPair = react.useState(null);
      var openId = openPair[0];
      var setOpenId = openPair[1];

      var rootRef = react.useRef(null);

      react.useEffect(function () {
        setItems(bar.list());
        return bar.subscribe(function (snapshot) { setItems(snapshot); });
      }, [bar]);

      react.useEffect(function () {
        if (openId === null) return undefined;
        var onPointerDown = function (event) {
          var root = rootRef.current;
          if (root && event.target instanceof Node && root.contains(event.target)) return;
          setOpenId(null);
        };
        var onKeyDown = function (event) {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          setOpenId(null);
          var root = rootRef.current;
          var trigger = root ? root.querySelector("button.dshStatusSegButton") : null;
          if (trigger && trigger.focus) trigger.focus();
        };
        document.addEventListener("mousedown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown, true);
        return function () {
          document.removeEventListener("mousedown", onPointerDown, true);
          document.removeEventListener("keydown", onKeyDown, true);
        };
      }, [openId]);

      function onKeyDown(event) {
        var key = event.key;
        if (key !== "ArrowDown" && key !== "ArrowUp") return;
        var root = rootRef.current;
        if (!root) return;
        var focusable = Array.prototype.filter.call(
          root.querySelectorAll('[role="menuitem"]'),
          function (node) { return !node.disabled; }
        );
        if (focusable.length === 0) return;
        event.preventDefault();
        var step = key === "ArrowDown" ? 1 : -1;
        var index = focusable.indexOf(document.activeElement);
        var next = index === -1
          ? (step > 0 ? 0 : focusable.length - 1)
          : (index + step + focusable.length) % focusable.length;
        focusable[next].focus();
      }

      if (items.length === 0) return null;

      var segments = items.map(function (item) {
        var open = openId === item.id;
        var shared = {
          key: item.id,
          item: item,
          bar: bar,
          host: props,
          open: open,
          toggle: function () { setOpenId(open ? null : item.id); },
          close: function () { setOpenId(null); },
          Segment: Segment
        };

        /* B. 自定义段 */
        if (typeof item.component === "function") {
          return react.createElement(item.component, shared);
        }

        /* A. 数据段 */
        var hasMenu = typeof item.menu === "function";
        var panel = open && hasMenu
          ? react.createElement(item.menu, {
              item: item,
              bar: bar,
              host: props,
              close: shared.close,
              toggle: shared.toggle
            })
          : null;

        var children = [];
        if (item.dot !== false) {
          children.push(react.createElement("span", {
            className: "dshStatusDot" + (item.tone === "running" ? " dshStatusDotPulse" : ""),
            style: { background: DOT_COLORS[item.tone] || DOT_COLORS.idle }
          }));
        }
        children.push(react.createElement("span", { className: "dshStatusLabel" }, typeof item.label === "string" ? item.label : item.id));
        if (item.status) {
          children.push(react.createElement("span", { className: "dshStatusText" }, item.status));
        }

        return element(Segment, {
          id: item.id,
          align: item.align,
          tone: item.tone,
          title: item.title || item.label || item.id,
          panelLabel: item.panelLabel || item.title || item.label,
          open: open,
          menu: panel,
          menuAvailable: hasMenu,
          onToggle: hasMenu || typeof item.onSelect === "function"
            ? function () {
                if (hasMenu) shared.toggle();
                else item.onSelect(shared);
              }
            : undefined
        }, children);
      });

      return element(
        "div",
        { className: "dshStatusDockRow" },
        [element(
          "div",
          {
            ref: rootRef,
            className: "dshStatusBar",
            role: "toolbar",
            "aria-label": props.barLabel || "状态条",
            "data-status-bar": "on",
            onKeyDown: onKeyDown
          },
          segments
        )]
      );
    }

    /* ── 样式表 ────────────────────────────────────────────────────────────
     * 在装载时（apply）就把样式注入 document，而不是等某个组件挂载后再用
     * useEffect 注入：后者会让第一帧先渲染出没有样式的裸标记（宿主自己的
     * 客户端 bundle 也是"工厂执行时"注入 CSS 的）。拆掉时一并回收。 */
    function installStyles() {
      if (typeof document === "undefined" || document.head === null) return null;
      var existing = document.getElementById(STYLE_ID);
      if (existing !== null) {
        /* 已经有一份（例如上一实例还没收回）：把内容刷新成当前这一份，但不接管它的生命周期，
         * 免得把别人的 style 元素拆了。 */
        if (existing.textContent !== CSS) existing.textContent = CSS;
        return null;
      }
      var styleEl = document.createElement("style");
      styleEl.id = STYLE_ID;
      styleEl.textContent = CSS;
      document.head.appendChild(styleEl);
      return function () { styleEl.remove(); };
    }

    /* ── 装载：提供注册面 + 挂载容器（本包不注册任何段） ───────────────── */
    var lastBar = null;

    function apply(ctx) {
      var bar = createStatusBar();
      lastBar = bar;

      var removeStyles = null;
      try {
        removeStyles = installStyles();
      } catch (error) {
        /* 非浏览器环境（离线渲染体检）忽略 */
      }
      if (removeStyles !== null && typeof ctx.effect === "function") {
        ctx.effect(function () { return removeStyles; });
      }

      try {
        ctx.provide(SERVICE, bar);
      } catch (error) {
        /* 宿主已占用同名服务：仍保留 window 桥接面 */
      }
      try {
        window[BRIDGE] = bar;
      } catch (error) {
        /* 非浏览器环境（离线渲染体检）忽略 */
      }

      ctx.slots.inject("conversation.input.dock", function () {
        return ctx.slots.register({
          name: "conversation.input.dock",
          id: "status-bar",
          order: 30
        }, function (slotProps) {
          return react.createElement(StatusBar, Object.assign({}, slotProps, { bar: bar }));
        });
      });
    }

    /* 名字与 `__ModuleLoader__.load({ id })` / Loader 行名保持一致；
     * 服务名仍然是 SERVICE（"inputStatusBar"），使用方 inject 的是服务名。 */
    exports.name = "dsh-plugin-status-bar";
    exports.inject = inject;
    exports.apply = apply;
    exports.serviceName = SERVICE;
    exports.createStatusBar = createStatusBar;
    exports.segment = Segment;
    exports.stylesheet = CSS;
    exports.styleId = STYLE_ID;
    exports.installStyles = installStyles;
    exports.getStatusBar = function () { return lastBar; };
    return module.exports;
  }
});
