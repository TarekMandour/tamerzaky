(function installTamerIndicatorPanel() {
  "use strict";

  var api = globalThis.__THNDR_TAMER_STUDIES__;
  if (!api || !Array.isArray(api.SPECS)) return;
  var marker = "__thndrTamerIndicatorPanelV1";
  var dialogSelector = '[data-name="indicators-dialog"]';

  function install(doc) {
    if (!doc || doc[marker]) return;
    var win = doc.defaultView;
    var panels = new Map();
    var frames = new WeakSet();
    var queued = false;
    var style = doc.createElement("style");
    style.textContent = [
      '[data-tz-native-hidden] { display: none !important; }',
      '.tz-indicator-section { display:flex; flex-direction:column; flex:1; min-height:0; color:inherit; font:inherit; }',
      '.tz-indicator-section [hidden] { display:none !important; }',
      '.tz-indicator-nav { display:flex; gap:6px; padding:12px 16px; flex-shrink:0; border-bottom:1px solid rgba(128,128,128,.25); }',
      '.tz-indicator-section button { font:inherit; color:inherit; cursor:pointer; }',
      '.tz-indicator-nav button { background:transparent; border:1px solid transparent; border-radius:6px; padding:8px 10px; font-size:13px; }',
      '.tz-indicator-nav button[aria-pressed="true"] { background:rgba(127,156,245,.16); border-color:rgba(127,156,245,.5); }',
      '.tz-indicator-section button:hover { background:rgba(128,128,128,.15); }',
      '.tz-indicator-section button:focus-visible { outline:2px solid #7f9cf5; outline-offset:-2px; }',
      '.tz-indicator-list { padding:8px 12px; overflow:auto; min-height:0; }',
      '.tz-indicator-add { display:flex; align-items:center; justify-content:space-between; gap:16px; width:100%; border:0; border-radius:5px; background:transparent; text-align:start; padding:13px 12px; }',
      '.tz-indicator-add bdi { font-size:14px; }',
      '.tz-indicator-add span { opacity:.65; font-size:20px; }',
      '.tz-indicator-empty { margin:20px 12px; font-size:13px; opacity:.7; text-align:center; }',
      '.tz-indicator-section[data-mode="all"] { flex:0 0 auto; }'
    ].join("\n");

    function make(tag, className, text) {
      var node = doc.createElement(tag);
      if (className) node.className = className;
      if (text) node.textContent = text;
      return node;
    }

    function mount(dialog) {
      var nativeList = dialog.querySelector('[role="listbox"]');
      var search = dialog.querySelector('input[data-role="search"]');
      if (!nativeList || !search) return;
      var nativeWrapper = nativeList;
      while (nativeWrapper.parentElement && nativeWrapper.parentElement !== dialog) {
        nativeWrapper = nativeWrapper.parentElement;
      }
      if (nativeWrapper.parentElement !== dialog) return;
      function rowFor(spec) {
        var row = doc.getElementById("indicators_dialog_item_" + spec.id.replace(/-\d+$/, ""));
        return row && dialog.contains(row) ? row : null;
      }
      // Only enhance a catalog that actually registered our studies. Leave any
      // unsupported/new host dialog intact instead of showing broken actions.
      if (!api.SPECS.some(rowFor)) return;

      var arabic = doc.documentElement.lang.indexOf("ar") === 0 || win.getComputedStyle(dialog).direction === "rtl";
      var title = arabic ? "مؤشرات م.تامر زكي" : "Tamer Zaky Indicators";
      var allTitle = arabic ? "كل المؤشرات" : "All indicators";
      var section = make("section", "tz-indicator-section");
      section.setAttribute("aria-label", title);
      var nav = make("div", "tz-indicator-nav");
      var ownTab = make("button", "", title);
      var allTab = make("button", "", allTitle);
      ownTab.type = allTab.type = "button";
      nav.append(ownTab, allTab);
      var list = make("div", "tz-indicator-list");
      list.id = "tz-studies-" + nativeList.id;
      list.setAttribute("role", "group");
      list.setAttribute("aria-label", title);
      var empty = make("p", "tz-indicator-empty", arabic ? "لا توجد نتائج في مؤشرات تامر زكي" : "No matching Tamer Zaky indicators");
      var mode = "custom";
      var searchAttributes = {};
      ["aria-controls", "aria-owns", "aria-haspopup"].forEach(function save(name) {
        searchAttributes[name] = search.getAttribute(name);
      });
      var buttons = api.SPECS.map(function add(spec) {
        var button = make("button", "tz-indicator-add");
        button.type = "button";
        button.setAttribute("aria-label", spec.name);
        var label = make("bdi", "", spec.name.replace(" - [Tamer Zaky]", ""));
        var plus = make("span", "", "+");
        plus.setAttribute("aria-hidden", "true");
        button.append(label, plus);
        button.addEventListener("click", function addStudy() {
          var row = rowFor(spec);
          // Forward to the current native row, retaining the host's settings,
          // study limits and error handling; never move React-owned DOM nodes.
          if (row && row.getAttribute("data-disabled") !== "true") row.click();
        });
        list.appendChild(button);
        return { spec: spec, button: button };
      });
      list.appendChild(empty);
      section.append(nav, list);
      if (!style.isConnected) (doc.head || doc.documentElement).appendChild(style);
      dialog.insertBefore(section, nativeWrapper);

      function restoreSearch() {
        Object.keys(searchAttributes).forEach(function restore(name) {
          if (searchAttributes[name] === null) search.removeAttribute(name);
          else search.setAttribute(name, searchAttributes[name]);
        });
      }
      function refresh() {
        var visible = 0;
        buttons.forEach(function update(entry) {
          var row = rowFor(entry.spec);
          entry.button.hidden = !row;
          entry.button.disabled = !!row && row.getAttribute("data-disabled") === "true";
          if (row) visible += 1;
        });
        empty.hidden = visible !== 0;
      }
      function select(next) {
        mode = next;
        section.dataset.mode = mode;
        ownTab.setAttribute("aria-pressed", String(mode === "custom"));
        allTab.setAttribute("aria-pressed", String(mode === "all"));
        list.hidden = mode !== "custom";
        if (mode === "custom") {
          nativeWrapper.setAttribute("data-tz-native-hidden", "");
          search.setAttribute("aria-controls", list.id);
          search.removeAttribute("aria-owns");
          search.removeAttribute("aria-haspopup");
          search.removeAttribute("aria-activedescendant");
        } else {
          nativeWrapper.removeAttribute("data-tz-native-hidden");
          restoreSearch();
        }
        refresh();
      }
      function keyboard(event) {
        if (mode !== "custom" || !dialog.contains(event.target)) return;
        var available = buttons.filter(function available(entry) { return !entry.button.hidden && !entry.button.disabled; })
          .map(function node(entry) { return entry.button; });
        var current = available.indexOf(event.target);
        if (event.target !== search && current === -1) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (available.length) {
            var index = current === -1 ? (event.key === "ArrowDown" ? 0 : available.length - 1)
              : (current + (event.key === "ArrowDown" ? 1 : -1) + available.length) % available.length;
            available[index].focus();
          }
        } else if (event.key === "Enter" || (current !== -1 && event.key === " ")) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (available.length) available[Math.max(0, current)].click();
        }
      }
      ownTab.addEventListener("click", function custom() { select("custom"); });
      allTab.addEventListener("click", function all() { select("all"); });
      doc.addEventListener("keydown", keyboard, true);
      select("custom");
      panels.set(dialog, {
        refresh: refresh,
        remove: function remove() {
          doc.removeEventListener("keydown", keyboard, true);
          nativeWrapper.removeAttribute("data-tz-native-hidden");
          restoreSearch();
          section.remove();
        }
      });
    }

    function scan() {
      queued = false;
      panels.forEach(function refresh(panel, dialog) {
        if (!dialog.isConnected) { panel.remove(); panels.delete(dialog); }
        else panel.refresh();
      });
      doc.querySelectorAll(dialogSelector).forEach(function inspect(dialog) {
        if (!panels.has(dialog)) mount(dialog);
      });
      doc.querySelectorAll('iframe[id^="tradingview_"], iframe[name^="tradingview_"]').forEach(function frame(frame) {
        function attach() {
          try { install(frame.contentDocument); } catch (_error) { /* Cross-origin host: leave native UI intact. */ }
        }
        if (!frames.has(frame)) { frames.add(frame); frame.addEventListener("load", attach); }
        attach();
      });
    }
    var observer = new win.MutationObserver(function changed() {
      if (queued) return;
      queued = true;
      win.queueMicrotask(scan);
    });
    doc[marker] = { version: "0.11.6" };
    // The chart rewrites its iframe document after our early installation.
    // Observing the initial <html> leaves the observer on a detached tree while
    // the document marker still prevents reinstallation. Follow the Document
    // itself so replacing its root triggers cleanup and a fresh dialog scan.
    observer.observe(doc, { childList: true, subtree: true });
    scan();
  }
  install(document);
})();
