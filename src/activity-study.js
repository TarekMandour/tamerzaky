/* EGX session activity. Local chart volume only; no trade or account access. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.__THNDR_ACTIVITY_STUDY__ = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";
  var engine = root && root.__THNDR_EGX_ACTIVITY__;
  if (!engine && typeof require === "function") engine = require("./egx-activity.js");
  var SPEC = Object.freeze({ key: "activity", name: "EGX Activity - [Tamer Zaky]",
    id: "EGX Activity - [Tamer Zaky]@tv-basicstudies-1", outputs: [0] });
  var MAX_BARS = 18000;

  function buildMetainfo() {
    return { _metainfoVersion: 53, id: SPEC.id, name: SPEC.name, description: SPEC.name,
      shortDescription: SPEC.name, isCustomIndicator: true, is_price_study: true, linkedToSeries: true,
      format: { type: "price", precision: 2 }, plots: [{ id: "activity_anchor", type: "line" }],
      styles: { activity_anchor: { title: "Activity", histogramBase: 0, joinPoints: false } },
      palettes: {}, filledAreas: [], inputs: [
        { id: "enabled", name: "رادار نشاط التداول", type: "bool", defval: true },
        { id: "lookback", name: "جلسات المقارنة السابقة", type: "integer", defval: 20, min: 5, max: 60 },
        { id: "__tz_instance", name: "Instance", type: "text", defval: "", isHidden: true, isAlwaysShownInLegend: false }
      ], defaults: { inputs: { enabled: true, lookback: 20, __tz_instance: "" }, palettes: {}, filledAreasStyle: {},
        styles: { activity_anchor: { color: "#38bdf8", linestyle: 0, linewidth: 1, plottype: 0,
          trackPrice: false, transparency: 100, visible: false } } } };
  }

  function normalizeTicker(value) {
    var text = typeof value === "string" ? value.trim().toUpperCase().replace(/^EGX_DLY:/, "EGX:") : "";
    return /^EGX:[A-Z0-9._-]+$/.test(text) ? text : "";
  }

  function chartIdentity(chart) {
    try {
      var ext = chart.symbolExt ? chart.symbolExt() : {};
      var raw = String(chart.symbol() || "");
      var ticker = normalizeTicker(raw) || normalizeTicker(ext.pro_name) ||
        normalizeTicker(String(ext.exchange || ext.listed_exchange || "") + ":" + String(ext.name || ""));
      return { raw: raw, ticker: ticker, interval: String(chart.resolution()), type: ext.type || "" };
    } catch (_) { return null; }
  }

  function binding(token) {
    var hosts = [root];
    try { if (root.parent && root.parent !== root) hosts.push(root.parent); } catch (_) {}
    for (var host of hosts) {
      try {
        var renderer = host.__THNDR_ALPHA_RENDERER__;
        var found = renderer && renderer.resolveInstance(token, SPEC.name);
        if (found) return found;
      } catch (_) {}
    }
    return null;
  }

  function createStudy(PineJS) {
    var Std = PineJS.Std;
    return { name: SPEC.name, metainfo: buildMetainfo(), constructor: function ActivityStudy() {
      var bars = [], signature = "", revision = 0, computedKey = "";
      this.main = function (context, input) {
        var symbol = context.symbol || {};
        var raw = symbol.tickerid || symbol.ticker || (Std.tickerid ? Std.tickerid(context) : "");
        var interval = String(symbol.period || symbol.resolution || (Std.period ? Std.period(context) : ""));
        var lookback = input(1);
        lookback = typeof lookback === "number" && Number.isFinite(lookback) ? Math.max(5, Math.min(60, Math.round(lookback))) : 20;
        var token = typeof input(2) === "string" ? input(2) : "";
        var owner = token && binding(token), identity = owner && chartIdentity(owner.chart);
        // Reject late callbacks before they can discard the active history.
        if (identity && (identity.interval !== interval ||
            ![identity.raw.toLowerCase(), identity.ticker.toLowerCase()].includes(String(raw).toLowerCase()))) return [NaN];
        var key = JSON.stringify([raw, interval, lookback, token, input(0)]);
        if (signature !== key) { bars = []; signature = key; revision++; computedKey = ""; }
        var minutes = /^(1|5|10|15|30|60)$/.test(interval) ? Number(interval) : 0;
        if (minutes && typeof context.setMinimumAdditionalDepth === "function") {
          context.setMinimumAdditionalDepth(Math.min(MAX_BARS, Math.ceil(270 / minutes) * (lookback + 2) + 10));
        }
        var time = symbol.time;
        time = typeof time === "number" && Number.isFinite(time) ? (Math.abs(time) >= 1e11 ? time / 1000 : time) : NaN;
        if (Number.isFinite(time)) {
          var bar = { time: time, volume: Std.volume(context),
            isBarClosed: symbol.isBarClosed === true || symbol.isLastBar === false };
          var last = bars[bars.length - 1];
          if (last && time < last.time) {
            var index = bars.findIndex(function (b) { return b.time >= time; });
            bars.splice(index < 0 ? 0 : index); revision++; last = bars[bars.length - 1];
          }
          if (last && last.time === time) {
            // Open-candle ticks cannot change a closed-candle comparison.
            if (last.isBarClosed !== bar.isBarClosed || bar.isBarClosed && last.volume !== bar.volume) revision++;
            bars[bars.length - 1] = bar;
          } else {
            // Some feeds confirm the prior bar only by delivering its successor.
            if (last && !last.isBarClosed && time > last.time) last.isBarClosed = true;
            bars.push(bar); revision++;
          }
          if (bars.length > MAX_BARS) bars.splice(0, bars.length - MAX_BARS);
        }
        if (symbol.isLastBar !== true || !token) return [NaN];
        // A previous symbol's last callback must never publish into the new chart.
        if (!identity || identity.interval !== interval ||
            ![identity.raw.toLowerCase(), identity.ticker.toLowerCase()].includes(String(raw).toLowerCase())) return [NaN];
        var calculateKey = JSON.stringify([revision, identity.ticker, identity.type]);
        if (computedKey === calculateKey) return [NaN];
        computedKey = calculateKey;
        var result = identity.type && identity.type !== "stock"
          ? { status: "unsupported", reason: "stock_only", ratio: null }
          : engine.computeActivity(bars, { ticker: identity.ticker, interval: interval, lookback: lookback, minSessions: 5 });
        this.lastAnalysis = result;
        var panel = root && root.__THNDR_ACTIVITY_PANEL__;
        if (panel) panel.publish({ token: token, raw: identity.raw, ticker: identity.ticker, interval: interval,
          lookback: lookback, enabled: input(0) !== false, result: result });
        return [NaN];
      };
    } };
  }
  return Object.freeze({ SPEC: SPEC, buildMetainfo: buildMetainfo, createStudy: createStudy,
    chartIdentity: chartIdentity, normalizeTicker: normalizeTicker });
});
