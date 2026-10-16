// Adapted from ATR Fibonacci Trend Envelopes [BigBeluga].
// This work is licensed under Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International.
// https://creativecommons.org/licenses/by-nc-sa/4.0/
// © BigBeluga
(function installAtrFibonacciPanel(root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.__THNDR_ATR_FIBONACCI_PANEL__ = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildAtrFibonacciPanel(root) {
  "use strict";
  var NAME = "ATR Fibonacci Trend";
  var INPUT_IDS = Object.freeze(["maType", "maLength", "atrLength", "atrMult", "showProj", "projLen",
    "colorUp", "colorDown", "colorMid", "baseFill", "showDash", "dashLoc", "dashSize", "tf1", "tf2", "tf3", "tf4"]);
  var COLORS = { colorUp: "#24c0d4", colorDown: "#eb3333", colorMid: "#787b86", baseFill: "#ff7b00" };
  var LOCATIONS = ["top_right", "bottom_right", "top_left", "bottom_left", "middle_right"];
  var SIZES = ["tiny", "small", "normal", "large"];
  var published = new Map(), charts = new Map();

  function colorParts(value) {
    if (typeof value !== "string") return null;
    var color = value.trim().toLowerCase(), match;
    if ((match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(color))) {
      var hex = match[1];
      if (hex.length <= 4) hex = hex.split("").map(function (x) { return x + x; }).join("");
      return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16),
        hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1];
    }
    if ((match = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(color))) {
      var channels = [+match[1], +match[2], +match[3], match[4] === undefined ? 1 : +match[4]];
      if (channels.slice(0, 3).every(function (x) { return x >= 0 && x <= 255; }) && channels[3] >= 0 && channels[3] <= 1) return channels;
    }
    return null;
  }

  function withOpacity(value, alpha, fallback) {
    var channels = colorParts(value) || colorParts(fallback) || [120, 123, 134, 1];
    // color.new replaces the source alpha; it does not multiply it.
    return "rgba(" + channels.slice(0, 3).join(",") + "," + alpha + ")";
  }

  function formatTimeframe(tf) {
    var value = String(tf === undefined ? "" : tf);
    var minutes = value.trim() ? Number(value) : NaN;
    if (!Number.isFinite(minutes)) return value;
    return minutes >= 1440 ? Math.round(minutes / 1440) + "D" :
      minutes >= 60 ? Math.round(minutes / 60) + "H" : value + "m";
  }

  function viewModel(snapshot) {
    var settings = snapshot && snapshot.settings || {};
    var rows = snapshot && Array.isArray(snapshot.rows) ? snapshot.rows : [];
    return {
      location: LOCATIONS.indexOf(settings.dashLoc) >= 0 ? settings.dashLoc : "bottom_right",
      size: SIZES.indexOf(settings.dashSize) >= 0 ? settings.dashSize : "small",
      rows: [0, 1, 2, 3].map(function (index) {
        var row = rows[index] || {}, tf = row.tf === undefined ? settings["tf" + (index + 1)] : row.tf;
        var ready = row.ready === true && (row.trend === 1 || row.trend === 0 || row.trend === -1) && typeof row.inPocket === "boolean";
        return {
          tf: formatTimeframe(tf), ready: ready,
          trend: ready ? row.trend === 1 ? "BULL" : "BEAR" : "—",
          pocket: ready ? row.inPocket ? "INSIDE" : "OUT" : "—",
          trendBackground: ready ? withOpacity(row.trend === 1 ? settings.colorUp : settings.colorDown, 0.7,
            row.trend === 1 ? COLORS.colorUp : COLORS.colorDown) : "transparent",
          pocketBackground: ready ? row.inPocket ? withOpacity(settings.baseFill, 0.7, COLORS.baseFill) :
            "rgba(120,123,134,0.2)" : "transparent"
        };
      })
    };
  }

  function publish(snapshot, relayed) {
    if (!snapshot || typeof snapshot.token !== "string" || !snapshot.token) return;
    published.set(snapshot.token, snapshot);
    if (published.size > 100) published.delete(published.keys().next().value);
    if (relayed) return;
    var hosts = [];
    try { if (root.parent && root.parent !== root) hosts.push(root.parent); } catch (_) {}
    try { if (root.frames) for (var i = 0; i < root.frames.length; i++) hosts.push(root.frames[i]); } catch (_) {}
    hosts.forEach(function (host) {
      try {
        var other = host.__THNDR_ATR_FIBONACCI_PANEL__;
        if (other && other !== api) other.publish(snapshot, true);
      } catch (_) { /* Unrelated/cross-origin frames are not recipients. */ }
    });
  }

  function element(doc, tag, className, text) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function ensureStyle(doc) {
    if (doc.getElementById("tz-atr-fib-style")) return;
    var style = element(doc, "style");
    style.id = "tz-atr-fib-style";
    style.textContent = ".tz-atr-fib-stack{position:fixed;z-index:18;display:grid;gap:6px;pointer-events:none;max-width:calc(100vw - 80px)}" +
      ".tz-atr-fib-stack[data-location=top_right]{top:16px;right:64px}.tz-atr-fib-stack[data-location=bottom_right]{bottom:38px;right:64px}" +
      ".tz-atr-fib-stack[data-location=top_left]{top:16px;left:16px}.tz-atr-fib-stack[data-location=bottom_left]{bottom:38px;left:16px}" +
      ".tz-atr-fib-stack[data-location=middle_right]{top:50%;right:64px;transform:translateY(-50%)}" +
      ".tz-atr-fib-table{direction:ltr;text-align:center;border-collapse:collapse;table-layout:auto;color:#fff;background:rgba(0,0,0,.6);border:1px solid rgba(120,123,134,.3);font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;line-height:1.35;font-weight:400}" +
      ".tz-atr-fib-table th,.tz-atr-fib-table td{font-weight:400;padding:.3em .55em;border:1px solid rgba(120,123,134,.3);white-space:nowrap}" +
      ".tz-atr-fib-table[data-size=tiny]{font-size:8px}.tz-atr-fib-table[data-size=small]{font-size:10px}.tz-atr-fib-table[data-size=normal]{font-size:14px}.tz-atr-fib-table[data-size=large]{font-size:20px}";
    (doc.head || doc.documentElement).appendChild(style);
  }

  function renderTable(doc, existing, snapshot) {
    var view = viewModel(snapshot), table = existing || element(doc, "table", "tz-atr-fib-table");
    var key = JSON.stringify(view);
    if (table.__atrFibonacciKey === key) return table;
    table.__atrFibonacciKey = key;
    table.setAttribute("aria-label", "ATR Fibonacci Trend — MTF dashboard");
    table.setAttribute("dir", "ltr");
    table.setAttribute("data-size", view.size);
    table.setAttribute("data-location", view.location);
    while (table.firstChild) table.removeChild(table.firstChild);
    var thead = element(doc, "thead"), header = element(doc, "tr"), body = element(doc, "tbody");
    ["TF", "Trend", "Pocket"].forEach(function (text) {
      var cell = element(doc, "th", "", text);
      cell.setAttribute("scope", "col"); header.appendChild(cell);
    });
    thead.appendChild(header);
    view.rows.forEach(function (row) {
      var tr = element(doc, "tr");
      var trend = element(doc, "td", "", row.trend), pocket = element(doc, "td", "", row.pocket);
      trend.style.backgroundColor = row.trendBackground;
      pocket.style.backgroundColor = row.pocketBackground;
      tr.append(element(doc, "td", "", row.tf), trend, pocket); body.appendChild(tr);
    });
    table.append(thead, body);
    return table;
  }

  function clearChart(chart) {
    var state = charts.get(chart);
    if (!state) return;
    state.container.remove(); charts.delete(chart);
  }

  function matchesSettings(current, settings) {
    if (!settings) return false;
    return INPUT_IDS.every(function (id) {
      if (!Object.prototype.hasOwnProperty.call(current, id) || !Object.prototype.hasOwnProperty.call(settings, id)) return false;
      if (Object.prototype.hasOwnProperty.call(COLORS, id)) {
        var a = colorParts(current[id]), b = colorParts(settings[id]);
        return a && b ? a.every(function (value, index) { return Math.abs(value - b[index]) < 1e-8; }) : current[id] === settings[id];
      }
      return current[id] === settings[id];
    });
  }

  function auditChart(chart, options) {
    options = options || {};
    var doc = options.document;
    if (!chart || !doc || !doc.body) { if (chart) clearChart(chart); return; }
    var symbol, resolution, studies;
    try {
      symbol = String(chart.symbol()).toLowerCase(); resolution = String(chart.resolution());
      studies = chart.getAllStudies().filter(function (study) { return study.name === NAME; });
    } catch (_) { clearChart(chart); return; }
    if (!studies.length || !symbol || symbol === "undefined" || !resolution) { clearChart(chart); return; }
    var state = charts.get(chart);
    if (state && (state.doc !== doc || !state.container.isConnected)) { clearChart(chart); state = null; }
    var active = new Set();
    studies.forEach(function (info) {
      try {
        var study = chart.getStudyById(info.id), inputs = study.getInputValues(), current = {};
        inputs.forEach(function (input) { current[input.id] = input.value; });
        var token = current.__tz_instance;
        if (typeof options.visible !== "function" || options.visible(info.id) === false ||
            typeof options.owns !== "function" || !options.owns(info.id, token)) return;
        var snapshot = published.get(token), context = snapshot && snapshot.context;
        if (!context || String(context.tickerid || context.ticker || "").toLowerCase() !== symbol ||
            String(context.resolution) !== resolution || !matchesSettings(current, snapshot.settings)) return;
        var producer = root.__THNDR_ATR_FIBONACCI_STUDY__;
        if (producer && typeof producer.renderSnapshot === "function") {
          producer.renderSnapshot(snapshot, chart);
        }
        if (current.showDash !== true) return;
        if (!state) {
          ensureStyle(doc);
          var container = element(doc, "div", "tz-atr-fib-panels"); doc.body.appendChild(container);
          state = { doc: doc, container: container, entries: new Map(), stacks: new Map() }; charts.set(chart, state);
        }
        var view = viewModel(snapshot), stack = state.stacks.get(view.location);
        if (!stack) {
          stack = element(doc, "div", "tz-atr-fib-stack"); stack.setAttribute("data-location", view.location);
          state.container.appendChild(stack); state.stacks.set(view.location, stack);
        }
        var table = renderTable(doc, state.entries.get(info.id), snapshot);
        table.setAttribute("data-owner", String(info.id));
        state.entries.set(info.id, table);
        if (table.parentNode !== stack) stack.appendChild(table);
        active.add(info.id);
      } catch (_) { /* Loading/removing an owner must not retain a stale table. */ }
    });
    if (!state) return;
    state.entries.forEach(function (table, id) {
      if (!active.has(id)) { table.remove(); state.entries.delete(id); }
    });
    state.stacks.forEach(function (stack, location) {
      if (!stack.children.length) { stack.remove(); state.stacks.delete(location); }
    });
    if (!state.entries.size) clearChart(chart);
  }

  var api = Object.freeze({ publish: publish, auditChart: auditChart, clearChart: clearChart,
    viewModel: viewModel, renderTable: renderTable, ensureStyle: ensureStyle, formatTimeframe: formatTimeframe,
    getSnapshot: function (token) { return published.get(token); } });
  return api;
});
