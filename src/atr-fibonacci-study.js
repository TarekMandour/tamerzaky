// Adapted from ATR Fibonacci Trend Envelopes [BigBeluga], © BigBeluga.
// CC BY-NC-SA 4.0: https://creativecommons.org/licenses/by-nc-sa/4.0/
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.__THNDR_ATR_FIBONACCI_STUDY__ = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";
  var ENGINE = root.__THNDR_ATR_FIBONACCI__;
  if (!ENGINE && typeof require === "function") ENGINE = require("./atr-fibonacci.js");
  var SPEC = Object.freeze({ key: "atrFibonacci", name: "ATR Fibonacci Trend",
    id: "ATR Fibonacci Trend@tv-basicstudies-1", outputs: [0, 1, 2, 3, 4, 5, 6, 7, 8] });
  var INPUTS = [
    { id: "maType", name: "MA Type", type: "text", defval: "RMA", options: ["SMA", "EMA", "WMA", "HMA", "RMA"], group: "Calculation Settings" },
    { id: "maLength", name: "MA Length", type: "integer", defval: 100, min: 1, group: "Calculation Settings" },
    { id: "atrLength", name: "ATR Length", type: "integer", defval: 100, min: 1, group: "Calculation Settings" },
    { id: "atrMult", name: "ATR Multiplier", type: "float", defval: 3, group: "Calculation Settings" },
    { id: "showProj", name: "Show Projections", type: "bool", defval: true, group: "Projection Settings" },
    { id: "projLen", name: "Projection Length (Bars)", type: "integer", defval: 50, min: 1, max: 500, group: "Projection Settings" },
    { id: "colorUp", name: "Uptrend Color", type: "color", defval: "#24c0d4", group: "Color & Visual Settings" },
    { id: "colorDown", name: "Downtrend Color", type: "color", defval: "#eb3333", group: "Color & Visual Settings" },
    { id: "colorMid", name: "0.5 Fib Color", type: "color", defval: "#787b86", group: "Color & Visual Settings" },
    { id: "baseFill", name: "Pocket Base Color", type: "color", defval: "#ff7b00", group: "Color & Visual Settings" },
    { id: "showDash", name: "Show MTF Dashboard", type: "bool", defval: true, group: "Dashboard Settings" },
    { id: "dashLoc", name: "Location", type: "text", defval: "bottom_right", options: ["top_right", "bottom_right", "top_left", "bottom_left", "middle_right"], group: "Dashboard Settings" },
    { id: "dashSize", name: "Size", type: "text", defval: "small", options: ["tiny", "small", "normal", "large"], group: "Dashboard Settings" },
    { id: "tf1", name: "Timeframe 1", type: "resolution", defval: "5", group: "Dashboard Settings" },
    { id: "tf2", name: "Timeframe 2", type: "resolution", defval: "15", group: "Dashboard Settings" },
    { id: "tf3", name: "Timeframe 3", type: "resolution", defval: "60", group: "Dashboard Settings" },
    { id: "tf4", name: "Timeframe 4", type: "resolution", defval: "240", group: "Dashboard Settings" },
    { id: "__tz_instance", name: "Instance", type: "text", defval: "", isHidden: true, isAlwaysShownInLegend: false }
  ];
  var sequence = 0, rendered = new WeakMap();
  function finite(n) { return typeof n === "number" && Number.isFinite(n); }
  function seconds(n) { return finite(n) ? Math.abs(n) >= 1e11 ? n / 1000 : n : NaN; }
  function period(value) { return String(value || "").replace(/^1([DWM])$/, "$1"); }
  function symbolName(value) {
    var name = String(value || "");
    if (name[0] === "=") { try { var decoded = JSON.parse(name.slice(1)); if (typeof decoded.symbol === "string") return decoded.symbol; } catch (_) {} }
    return name;
  }
  function readSettings(input) {
    var settings = {};
    INPUTS.forEach(function (field, i) { var value = input(i); settings[field.id] = value === undefined ? field.defval : value; });
    return settings;
  }
  function rgba(value) {
    var s = String(value).trim(), match;
    if ((match = /^#([a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.exec(s))) {
      s = match[1]; if (s.length < 5) s = s.split("").map(function (c) { return c + c; }).join("");
      return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16), s.length === 8 ? parseInt(s.slice(6), 16) / 255 : 1];
    }
    if ((match = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(s))) {
      return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])];
    }
    if (s === "transparent") return [0, 0, 0, 0];
    return [0, 0, 0, 0];
  }
  // StudyRgbaColorerPlotInfo uses unsigned ABGR numbers, not a palette index.
  // color.new replaces (rather than multiplies) the base color's transparency.
  function packedColor(value, transparency) {
    var c = rgba(value), alpha = transparency === undefined ? c[3] : finite(transparency) ? 1 - transparency / 100 : 0;
    return Math.round(c[0]) + 256 * Math.round(c[1]) + 65536 * Math.round(c[2]) + 16777216 * Math.round(255 * Math.max(0, Math.min(1, alpha)) + 1e-9);
  }
  function cssColor(value, transparency) {
    var c = rgba(value), alpha = transparency === undefined ? c[3] : finite(transparency) ? 1 - transparency / 100 : 0;
    return "rgba(" + c.slice(0, 3).join(",") + "," + Math.max(0, Math.min(1, alpha)) + ")";
  }
  function buildMetainfo() {
    var ids = ["trend_ma", "fib618", "fib786", "fib50"], titles = ["Trend MA", "Fib 0.618", "Fib 0.786", "Fib 0.5"];
    var colors = ["#eb3333", "#ff7b00", "#ff7b00", "#787b86"], plots = [], styles = {}, defaults = {};
    ids.forEach(function (id, i) {
      plots.push({ id: id, type: "line" }, { id: id + "_color", type: "colorer", target: id });
      styles[id] = { title: titles[i], histogramBase: 0, joinPoints: false, isHidden: false };
      defaults[id] = { color: colors[i], linewidth: i === 0 ? 3 : 1, linestyle: 0, plottype: 7, trackPrice: false, transparency: 0, visible: true };
    });
    plots.push({ id: "pocket_color", type: "colorer", target: "pocket" });
    return { _metainfoVersion: 53, id: SPEC.id, name: SPEC.name, description: SPEC.name, shortDescription: SPEC.name,
      isCustomIndicator: true, is_price_study: true, linkedToSeries: true, isRGB: true, format: { type: "inherit" },
      plots: plots, styles: styles, palettes: {}, inputs: INPUTS.map(function (x) { return Object.assign({}, x); }),
      filledAreas: [{ id: "pocket", objAId: "fib618", objBId: "fib786", type: "plot_plot", title: "Dynamic Golden Pocket" }],
      defaults: { styles: defaults, palettes: {}, inputs: Object.fromEntries(INPUTS.map(function (x) { return [x.id, x.defval]; })),
        filledAreasStyle: { pocket: { color: "#ff7b00", transparency: 0, visible: true } } } };
  }
  function plotValues(result, settings) {
    var trendColor = packedColor(result.trend === 1 ? settings.colorUp : settings.colorDown);
    var pocketColor = packedColor(settings.baseFill, result.transparency);
    var drawFib = result.trend !== 0 && !result.trendChange;
    return [result.trendChange ? NaN : result.level100, trendColor,
      drawFib ? result.fib618 : NaN, pocketColor, drawFib ? result.fib786 : NaN, pocketColor,
      result.trend !== 0 ? result.fib50 : NaN, packedColor(settings.colorMid), pocketColor];
  }
  function futureTime(chart, lastTime, length) {
    // Ask the host's session-aware scale. Never invent weekend/holiday bars by
    // multiplying seconds by resolution. Guard the last-bar anchor first.
    try {
      var scale = chart.getTimeScale(), spacing = scale.barSpacing(), width = scale.width(), right = scale.rightOffset();
      if (!(spacing > 0) || !finite(width) || !finite(right)) return NaN;
      var anchor = width - (right + .5) * spacing;
      for (var delta of [0, -1, 1, -.5 * spacing, .5 * spacing]) {
        var x = anchor + delta;
        var anchorTime = seconds(scale.coordinateToTime(x));
        if (!finite(anchorTime) || Math.abs(anchorTime - lastTime) > .001) continue;
        var end = seconds(scale.coordinateToTime(x + length * spacing));
        if (finite(end) && end > lastTime) return end;
      }
      // Some library versions expose only real bars through coordinateToTime.
      // Feature-detected compatibility adapter: the SAME session/holiday model
      // used by createMultipointShape. Validate both anchor and bar distance;
      // never fall back to guessed wall-clock times when this API changes.
      var internal = scale._timeScale;
      if (internal && typeof internal.baseIndex === "function" && typeof internal.indexToTimePoint === "function" &&
          seconds(internal.indexToTimePoint(internal.baseIndex())) === lastTime) {
        var series = internal._model && internal._model.mainSeries();
        var sync = series && typeof series.syncModel === "function" && series.syncModel();
        if (sync && typeof sync.isValid === "function" && sync.isValid() && typeof sync.projectTime === "function" && typeof sync.distance === "function") {
          var projected = sync.projectTime(lastTime, length), distance = sync.distance(lastTime, projected);
          if (finite(projected) && projected > lastTime && distance && distance.success && distance.result === length) return projected;
        }
      }
    } catch (_) { /* Not every embedded library exposes projected times. */ }
    return NaN;
  }
  function priceText(value, tick) {
    if (!finite(tick) || tick <= 0) return String(value);
    var decimals = 0;
    while (decimals < 10 && Math.abs(tick * Math.pow(10, decimals) - Math.round(tick * Math.pow(10, decimals))) > 1e-7) decimals++;
    return (Math.round(value / tick) * tick).toFixed(decimals);
  }
  function offsetLabelPrice(chart, price, pixels) {
    try {
      var scale = chart.getTimeScale()._timeScale, series = scale._model.mainSeries();
      var prices = series.priceScale(), first = series.firstValue(), y = prices.priceToCoordinate(price, first);
      if (!finite(y)) return NaN;
      return prices.coordinateToPrice(y + pixels, first);
    } catch (_) { return NaN; }
  }
  function drawings(snapshot, endTime, offsetPrice) {
    var s = snapshot.settings, r = snapshot.result, lines = [], polylines = [];
    var size = { tiny: 10, small: 12, normal: 14, large: 20 }[s.dashSize] || 12;
    var prefix = "alpha:atr-fib:", projected = s.showProj && r.trend !== 0 && finite(endTime);
    function label(id, time, price, text, color) {
      lines.push({ id: prefix + id, module: "atrFibonacci", shape: "text", hideInObjectsTree: true,
        points: [{ time: time, price: price }], text: text, style: { color: color, fontSize: size } });
    }
    // Pine's 500-label limit includes the four current projection labels.
    var flips = (snapshot.flips || []).slice(-(projected ? 248 : 250));
    flips.forEach(function (flip) {
      var color = flip.trend === 1 ? s.colorUp : s.colorDown;
      label("flip:" + flip.time + ":symbol", flip.time, flip.level100, "⦿", color);
      // A text drawing has no Pine label_down anchor. Use the native price
      // scale's pixel transform (also correct for log scales) so its price
      // caption sits above the marker instead of overlapping it.
      var captionPrice = flip.trend === -1 && offsetPrice ? offsetPrice(flip.level100, -size * 1.5) : NaN;
      label("flip:" + flip.time + ":price", flip.time, finite(captionPrice) ? captionPrice : flip.level100,
        (finite(captionPrice) ? "" : "\n") + priceText(flip.close, snapshot.tick), color);
    });
    if (projected) {
      var defs = [["level100", "1.0", r.trend === 1 ? s.colorUp : s.colorDown], ["fib50", "0.5", s.colorMid],
        ["fib618", "0.618", s.baseFill], ["fib786", "0.786", s.baseFill]], ends = {};
      defs.forEach(function (d, i) {
        var key = d[0], end = r[key] + r.slopes[key] * s.projLen;
        if (!finite(r[key]) || !finite(end)) return;
        ends[key] = end;
        lines.push({ id: prefix + "projection:" + key, module: "atrFibonacci", hideInObjectsTree: true,
          points: [{ time: r.time, price: r[key] }, { time: endTime, price: end }],
          style: { color: d[2], width: i === 0 ? 3 : 1, lineStyle: i === 0 ? "solid" : "dotted" } });
        label("projection:" + key + ":label", endTime, end, d[1], d[2]);
      });
      if (finite(ends.fib618) && finite(ends.fib786) && finite(r.transparency)) {
        polylines.push({ id: prefix + "projection:pocket", module: "atrFibonacci", hideInObjectsTree: true,
          points: [{ time: r.time, price: r.fib618 }, { time: endTime, price: ends.fib618 },
            { time: endTime, price: ends.fib786 }, { time: r.time, price: r.fib786 }, { time: r.time, price: r.fib618 }],
          style: { color: "rgba(0,0,0,0)", width: 1, fill: cssColor(s.baseFill, r.transparency) } });
      }
    }
    return { owner: "alpha", studyName: SPEC.name, sourceId: snapshot.sourceId, instanceToken: snapshot.token,
      context: snapshot.context, boxes: [], lines: lines, polylines: polylines, table: null,
      projectionStatus: !s.showProj || r.trend === 0 ? "off" : projected ? "mapped" : "waiting-for-chart-time-scale" };
  }
  function renderSnapshot(snapshot, chart) {
    var renderer = root.__THNDR_ALPHA_RENDERER__;
    if (!renderer || !snapshot || !snapshot.token) return;
    var time = snapshot.settings.showProj ? futureTime(chart, snapshot.result.time, snapshot.settings.projLen) : NaN;
    var model = drawings(snapshot, time, function (price, pixels) { return offsetLabelPrice(chart, price, pixels); });
    var key = JSON.stringify(model), cache = rendered.get(chart);
    if (!cache) { cache = new Map(); rendered.set(chart, cache); }
    if (cache.get(snapshot.token) === key) return;
    if (cache.size > 50) cache.clear();
    cache.set(snapshot.token, key);
    renderer.publishSnapshot(model);
  }
  function createStudy(PineJS) {
    var Std = PineJS.Std || {};
    return { name: SPEC.name, metainfo: buildMetainfo(), constructor: function AtrFibonacciStudy() {
      var settings, mainSymbol, mainPeriod, rawPeriod, raw, streams, flips, lastMain, sourceId, initError;
      function instrumentPeriod(symbol, context) { return period(symbol.period || symbol.resolution || (Std.period ? Std.period(context) : "")); }
      function initialize(context, input) {
        settings = readSettings(input); mainSymbol = context.symbol || {}; mainPeriod = instrumentPeriod(mainSymbol, context);
        rawPeriod = String(mainSymbol.period || mainSymbol.resolution || mainPeriod);
        raw = mainSymbol.tickerid || mainSymbol.ticker || (Std.tickerid ? Std.tickerid(context) : "");
        streams = new Map(); flips = []; lastMain = null; initError = null;
        sourceId = "atr-fibonacci:" + settings.__tz_instance + ":" + (++sequence);
        function add(tf, symbol) { streams.set(tf, { engine: ENGINE.createEngine(settings), symbol: symbol, index: streams.size, latest: null, barKey: "" }); }
        add(mainPeriod, mainSymbol);
        if (typeof context.setMinimumAdditionalDepth === "function") {
          context.setMinimumAdditionalDepth(Math.max(settings.maLength + Math.ceil(Math.sqrt(settings.maLength)), settings.atrLength) + 5);
        }
        if (settings.showDash) [settings.tf1, settings.tf2, settings.tf3, settings.tf4].forEach(function (requested) {
          var tf = period(requested || mainPeriod);
          if (streams.has(tf)) return;
          try {
            if (typeof context.new_sym !== "function") throw new Error("Secondary series API unavailable");
            add(tf, context.new_sym(raw, tf));
          } catch (error) { initError = String(error.message || error); }
        });
      }
      this.init = initialize;
      function publish() {
        if (!lastMain || !settings.__tz_instance || !root.__THNDR_ATR_FIBONACCI_PANEL__) return;
        var info = mainSymbol.info || {}, tick = mainSymbol.minTick;
        if (!finite(tick) && finite(info.pricescale) && info.pricescale > 0) tick = (info.minmov || 1) / info.pricescale;
        root.__THNDR_ATR_FIBONACCI_PANEL__.publish({ token: settings.__tz_instance, sourceId: sourceId,
          context: { ticker: symbolName(raw), tickerid: symbolName(raw), resolution: rawPeriod }, settings: settings, result: lastMain,
          flips: flips.slice(-250), tick: tick, mtfError: initError,
          rows: [settings.tf1, settings.tf2, settings.tf3, settings.tf4].map(function (requested) {
            var stream = streams.get(period(requested || mainPeriod)), r = stream && stream.latest;
            return { tf: requested || mainPeriod, trend: r ? r.trend : 0, inPocket: r ? r.inPocket : false,
              ready: !!r && finite(r.basis) && finite(r.atr) };
          }) });
      }
      this.main = function (context, input) {
        if (!streams) initialize(context, input);
        // The library invokes main for secondary updates but leaves symbol 0
        // selected. Select each real instrument explicitly, then restore 0.
        // This is not resampling the primary chart's candles.
        function updateStream(stream) {
          var symbol = context.symbol || {}, time = seconds(symbol.time);
          var name = symbol.tickerid || symbol.ticker || (Std.tickerid ? Std.tickerid(context) : "");
          if (!finite(time) || symbolName(name).toLowerCase() !== symbolName(raw).toLowerCase()) return null;
          var bar = { time: time, close: Std.close(context), high: Std.high(context), low: Std.low(context) };
          var key = JSON.stringify(bar);
          if (stream.barKey !== key) { stream.latest = stream.engine.update(bar); stream.barKey = key; }
          return stream.latest;
        }
        if (typeof context.select_sym === "function") {
          streams.forEach(function (stream) { if (stream.index) { context.select_sym(stream.index); updateStream(stream); } });
          context.select_sym(0);
        }
        var symbol = context.symbol || {}, tf = instrumentPeriod(symbol, context), stream = streams.get(tf);
        var result = stream && updateStream(stream);
        if (!result) return Array(9).fill(NaN);
        if (tf !== mainPeriod) { if (symbol.isLastBar) publish(); return Array(9).fill(NaN); }
        var time = result.time;
        while (flips.length && flips[flips.length - 1].time >= time) flips.pop();
        if (result.trendChange) flips.push(result);
        if (symbol.isLastBar === true) { lastMain = result; publish(); }
        return plotValues(result, settings);
      };
    } };
  }
  return Object.freeze({ SPEC: SPEC, INPUTS: INPUTS, buildMetainfo: buildMetainfo, createStudy: createStudy,
    plotValues: plotValues, packedColor: packedColor, cssColor: cssColor, futureTime: futureTime,
    drawings: drawings, renderSnapshot: renderSnapshot, priceText: priceText });
});
