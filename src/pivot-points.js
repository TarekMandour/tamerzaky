/* API-backed AI Support & Resistance for EGX. Chart OHLC never sets prices. */
(function installPivotPoints(root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.__THNDR_TAMER_PIVOTS__ = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildPivotPoints(root) {
  "use strict";

  var Scanner = root && root.__THNDR_PIVOT_SCANNER__;
  if (!Scanner && typeof module === "object" && module.exports) Scanner = require("./pivot-scanner.js");
  if (!Scanner) throw new Error("Pivot API client must load before AI Support & Resistance.");

  var SPEC = Object.freeze({
    key: "pivots",
    // Retain the original study ID so saved Thndr layouts load the replacement.
    id: "Support & Resistance - [Tamer Zaky]@tv-basicstudies-1",
    name: "AI Support & Resistance - [Tamer Zaky]",
    outputs: [0]
  });
  var sourcePrefix = "pivots:" + Date.now() + ":" + Math.random().toString(36).slice(2);
  var sourceSequence = 0;
  var SUPPORT_COLORS = ["#22c55e", "#16a34a", "#86efac"];
  var RESISTANCE_COLORS = ["#ef4444", "#f97316", "#fca5a5"];
  var ALERT_MODES = ["Off", "Once per bar close"];
  var ALERT_DIRECTIONS = ["Both", "Bullish", "Bearish"];

  function option(value, choices) {
    if (typeof value === "number" && Number.isInteger(value)) return choices[value] || choices[0];
    if (typeof value === "string" && /^\d+$/.test(value)) return choices[Number(value)] || choices[0];
    return choices.indexOf(value) !== -1 ? value : choices[0];
  }

  function seconds(value) {
    return typeof value === "number" && Number.isFinite(value)
      ? (Math.abs(value) >= 1e11 ? value / 1000 : value) : NaN;
  }

  function buildMetainfo() {
    return {
      _metainfoVersion: 53, id: SPEC.id, name: SPEC.name,
      description: SPEC.name, shortDescription: SPEC.name,
      isCustomIndicator: true, is_price_study: true, linkedToSeries: true,
      format: { type: "price", precision: 2 },
      plots: [{ id: "pivots_anchor", type: "line" }],
      styles: { pivots_anchor: { title: "Levels", histogramBase: 0, joinPoints: false } },
      palettes: {}, filledAreas: [],
      inputs: [{ id: "enabled", name: "AI Support & Resistance", type: "bool", defval: true },
        { id: "__tz_instance", name: "Instance", type: "text", defval: "", isHidden: true, isAlwaysShownInLegend: false },
        { id: "chart_alerts", name: "Alerts (while chart is open)", type: "text", defval: "Off", options: ALERT_MODES.slice() },
        { id: "alert_direction", name: "Alert direction", type: "text", defval: "Both", options: ALERT_DIRECTIONS.slice() }],
      defaults: {
        inputs: { enabled: true, __tz_instance: "", chart_alerts: "Off", alert_direction: "Both" }, palettes: {}, filledAreasStyle: {},
        styles: { pivots_anchor: { color: "#22c55e", linestyle: 0, linewidth: 1,
          plottype: 0, trackPrice: false, transparency: 100, visible: false } }
      }
    };
  }

  function chartContext(context, Std) {
    var symbol = context.symbol || {};
    function read(field, standard) {
      var value = symbol[field];
      if (!value && typeof Std[standard] === "function") {
        try { value = Std[standard](context); } catch (_) { value = ""; }
      }
      return typeof value === "string" ? value.trim() : "";
    }
    return {
      tickerid: read("tickerid", "tickerid"), ticker: read("ticker", "ticker"),
      resolution: Scanner.normalizeInterval(read("period", "period") || read("resolution", "period"))
    };
  }

  function chartApis(host) {
    var charts = [];
    function add(win) {
      try {
        var api = win && (win.tradingViewApi || win.TradingViewApi);
        var chart = api && (typeof api.activeChart === "function" ? api.activeChart() :
          typeof api.chart === "function" ? api.chart() : null);
        if (chart && charts.indexOf(chart) === -1) charts.push(chart);
      } catch (_) { /* The frame may still be loading. */ }
    }
    add(host);
    try {
      if (host && host.frames) for (var index = 0; index < host.frames.length; index += 1) add(host.frames[index]);
    } catch (_) { /* Ignore cross-origin frames. */ }
    return charts;
  }

  function boundInstance(host, token) {
    try {
      var renderer = host && host.__THNDR_ALPHA_RENDERER__;
      var result = renderer && renderer.resolveInstance && renderer.resolveInstance(token, SPEC.name);
      if (!result && host && host.parent && host.parent !== host) {
        renderer = host.parent.__THNDR_ALPHA_RENDERER__;
        result = renderer && renderer.resolveInstance && renderer.resolveInstance(token, SPEC.name);
      }
      return result || null;
    } catch (_) { return null; }
  }

  function resolveTicker(source, host, instanceToken) {
    var direct = Scanner.normalizeTicker(source && source.ticker);
    if (direct) return direct;
    var binding = instanceToken && boundInstance(host, instanceToken);
    for (var chart of binding ? [binding.chart] : chartApis(host)) {
      try {
        var chartSymbol = typeof chart.symbol === "function" ? String(chart.symbol()) : "";
        var sourceSymbol = source && source.ticker || "";
        if (sourceSymbol && chartSymbol && sourceSymbol.toUpperCase() !== chartSymbol.toUpperCase()) continue;
        if (source && source.resolution && typeof chart.resolution === "function" &&
            Scanner.normalizeInterval(chart.resolution()) !== source.resolution) continue;
        var ext = typeof chart.symbolExt === "function" ? chart.symbolExt() : null;
        if (!ext) continue;
        var full = Scanner.normalizeTicker(ext.pro_name);
        if (full) return full;
        var name = ext.name || Array.isArray(ext.base_name) && ext.base_name[0];
        var exchange = ext.exchange || ext.listed_exchange;
        full = Scanner.normalizeTicker(String(exchange || "") + ":" + String(name || ""));
        if (full) return full;
      } catch (_) { /* Search the other chart frames. */ }
    }
    return "";
  }

  function studyPresent(host, instanceToken) {
    if (instanceToken && host && host.__THNDR_ALPHA_RENDERER__ && host.__THNDR_ALPHA_RENDERER__.resolveInstance) {
      return !!boundInstance(host, instanceToken);
    }
    var inspected = false;
    for (var chart of chartApis(host)) {
      try {
        if (typeof chart.getAllStudies !== "function") continue;
        inspected = true;
        if (chart.getAllStudies().some(function matches(study) {
          return study && (study.name === SPEC.name || study.name === "Support & Resistance - [Tamer Zaky]");
        })) return true;
      } catch (_) { /* The chart may be between datasets. */ }
    }
    return !inspected;
  }

  function lineSnapshots(result, time) {
    var lines = [];
    [[result.supports, SUPPORT_COLORS], [result.resistances, RESISTANCE_COLORS]].forEach(function side(pair) {
      pair[0].forEach(function line(level, index) {
        var color = pair[1][index % pair[1].length];
        lines.push({
          id: "alpha:pivots:" + level.id, module: "pivots", shape: "horizontal_line",
          points: [{ time: time, price: level.price }], text: "", hideInObjectsTree: true,
          style: { color: color, textColor: color, width: 1, lineStyle: "dashed" }
        });
      });
    });
    return lines;
  }

  function createStudy(PineJS) {
    if (!PineJS || !PineJS.Std) throw new Error("PineJS.Std is required for AI Support & Resistance.");
    var Std = PineJS.Std;
    var meta = buildMetainfo();
    return {
      name: SPEC.name, metainfo: meta,
      constructor: function PivotPointsStudy() {
        var instanceToken = "";
        var sourceId = sourcePrefix + ":" + (++sourceSequence);
        var active = null, requestSerial = 0, timer = null, barTimer = null;
        var lookupTimer = null, lookupKey = "", lookupAttempts = 0;
        var lastResult = null, lastTime = NaN, expiryTimer = null, authUnsubscribe = null, authBlocked = false;
        var alertChannel = null, alertFrame = null;

        function resetAlerts() {
          alertChannel = null;
          alertFrame = null;
        }

        function evaluateAlerts(context, close, previousClose, previousTime, enabled, mode, direction) {
          var symbol = context.symbol || {}, time = seconds(symbol.time);
          var source = chartContext(context, Std);
          var binding = instanceToken && boundInstance(root, instanceToken);
          var boundTicker = "", boundInterval = "";
          try {
            var boundChart = binding && binding.chart;
            if (boundChart && typeof boundChart.symbol === "function" && typeof boundChart.resolution === "function") {
              boundInterval = Scanner.normalizeInterval(boundChart.resolution());
              boundTicker = resolveTicker({ ticker: String(boundChart.symbol()), resolution: boundInterval }, root, instanceToken);
            }
          } catch (_) { /* A detached or switching chart is not an alert source. */ }
          var api = root && root.__THNDR_TAMER_ALERTS__;
          if (!enabled || mode === "Off" || authBlocked || !active || !lastResult ||
              !Number.isFinite(lastResult.expiresAt) || lastResult.expiresAt <= Date.now() ||
              lastResult.ticker !== active.ticker || lastResult.interval !== active.interval ||
              !binding || boundTicker !== active.ticker || boundInterval !== active.interval ||
              !api || typeof api.createChannel !== "function" ||
              !Number.isFinite(time) || !Number.isFinite(close) ||
              (source.tickerid || source.ticker) !== (active.chart.tickerid || active.chart.ticker) ||
              source.resolution !== active.interval) {
            resetAlerts();
            return;
          }
          var signature = JSON.stringify([active.key, instanceToken, mode, direction]);
          if (!alertFrame || alertFrame.signature !== signature || time < alertFrame.time) {
            resetAlerts();
            alertFrame = { signature: signature, time: time, closed: false, levels: new Map(), previous: new Map() };
          } else if (time !== alertFrame.time) {
            var prior = alertFrame.time === previousTime ? alertFrame.levels : new Map();
            alertFrame = { signature: signature, time: time, closed: false, levels: new Map(), previous: prior };
          }
          if (!alertChannel) alertChannel = api.createChannel(function deliver(event) {
            if (typeof api.show === "function") api.show(event);
          });
          var current = new Map(), grouped = new Map();
          [[lastResult.resistances, "resistance", "srBullBreak"],
            [lastResult.supports, "support", "srBearBreak"]].forEach(function side(pair) {
            (pair[0] || []).forEach(function level(item) {
              if (!item || typeof item.id !== "string" || !Number.isFinite(item.price)) return;
              var identity = pair[1] + ":" + item.id;
              current.set(identity, item.price);
              if (symbol.isBarClosed !== true || !Number.isFinite(previousClose) ||
                  alertFrame.previous.get(identity) !== item.price) return;
              var crossed = pair[1] === "resistance"
                ? previousClose <= item.price && close > item.price
                : previousClose >= item.price && close < item.price;
              if (!crossed) return;
              var eventId = pair[1] + ":" + item.price;
              var label = String(item.method || "") + " " + (pair[1] === "resistance" ? "R" : "S") + String(item.level || "");
              if (grouped.has(eventId)) grouped.get(eventId).labels.push(label.trim());
              else grouped.set(eventId, { condition: pair[2], id: eventId, level: item.price, labels: [label.trim()] });
            });
          });
          alertFrame.levels = current;
          var events = Array.from(grouped.values()).map(function event(item) {
            return { condition: item.condition, id: item.id, level: item.level, label: item.labels.join(" / ") };
          });
          alertChannel.update({ signature: signature, time: time, isLastBar: !!symbol.isLastBar,
            isBarClosed: symbol.isBarClosed === true, mode: mode, direction: direction,
            conditions: {},
            events: events, symbol: active.ticker, resolution: active.interval, price: close });
          alertFrame.closed = symbol.isBarClosed === true;
        }

        function clearExpiry() {
          if (expiryTimer !== null) root.clearTimeout(expiryTimer);
          expiryTimer = null;
        }

        function stop() {
          ++requestSerial;
          clearTimer(); clearBarTimer(); clearExpiry(); clearLookup();
          if (authUnsubscribe) authUnsubscribe();
          authUnsubscribe = null;
          lastResult = null;
          active = null;
          resetAlerts();
        }

        function authenticationFailed() {
          authBlocked = true;
          ++requestSerial;
          clearTimer(); clearBarTimer(); clearExpiry();
          lastResult = null;
          if (studyPresent(root, instanceToken)) publish(null, "authentication-required");
          stop();
        }

        function expire() {
          clearExpiry();
          if (!lastResult) return;
          var result = lastResult, identity = active && active.key;
          expiryTimer = root.setTimeout(function expired() {
            expiryTimer = null;
            if (!active || active.key !== identity || lastResult !== result) return;
            if (!studyPresent(root, instanceToken) || resolveTicker(active.chart, root, instanceToken) !== active.ticker) { stop(); return; }
            lastResult = null;
            resetAlerts();
            publish(null, "expired");
          }, Math.max(0, result.expiresAt - Date.now()));
        }

        function clearTimer() {
          if (timer !== null && root && typeof root.clearTimeout === "function") root.clearTimeout(timer);
          timer = null;
        }

        function clearBarTimer() {
          if (barTimer !== null && root && typeof root.clearTimeout === "function") root.clearTimeout(barTimer);
          barTimer = null;
        }

        function clearLookup() {
          if (lookupTimer !== null && root && typeof root.clearTimeout === "function") root.clearTimeout(lookupTimer);
          lookupTimer = null;
          lookupKey = "";
          lookupAttempts = 0;
        }

        function publish(result, status) {
          if (!active || !root) return;
          var lines = result ? lineSnapshots(result, lastTime) : [];
          var snapshot = {
            owner: "alpha", studyName: SPEC.name, sourceId: sourceId, instanceToken: instanceToken,
            context: Object.assign({}, active.chart), boxes: [], lines: lines,
            polylines: [], table: null, modules: { pivots: { lines: lines } }
          };
          var renderer = root.__THNDR_ALPHA_RENDERER__;
          if (renderer && typeof renderer.publishSnapshot === "function") renderer.publishSnapshot(snapshot);
          root.__THNDR_PIVOTS_LAST_BAR__ = {
            context: active.chart, scannerTicker: active.ticker, chartInterval: active.interval,
            status: status, source: result && {
              scannerInterval: result.scannerInterval, fallback: result.fallback,
              fromCache: result.fromCache, fetchedAt: result.fetchedAt, expiresAt: result.expiresAt
            }, levels: result && { supports: result.supports, resistances: result.resistances },
            snapshot: snapshot
          };
        }

        function refresh() {
          if (!active || authBlocked) return;
          var token = ++requestSerial, identity = active.key;
          Scanner.fetchLevels(active.ticker, active.interval)
            .then(function received(result) {
              if (!active || active.key !== identity || requestSerial !== token) return;
              if (!studyPresent(root, instanceToken) || resolveTicker(active.chart, root, instanceToken) !== active.ticker) { stop(); return; }
              if (!result) {
                if (!lastResult && root && root.__THNDR_PIVOTS_LAST_BAR__)
                  root.__THNDR_PIVOTS_LAST_BAR__.status = "api-unavailable";
                return; // Existing data remains usable only until its explicit expiry.
              }
              if (result.expiresAt <= Date.now()) return;
              lastResult = result;
              publish(result, result.fromCache ? "cached" : "api");
              expire();
            }).catch(function failed(error) {
              if (!active || active.key !== identity || requestSerial !== token) return;
              if (error && (error.code === "authentication_required" || error.code === "not_authorized")) {
                authenticationFailed(); return;
              }
              if (active && active.key === identity && requestSerial === token && !lastResult && root &&
                  root.__THNDR_PIVOTS_LAST_BAR__) root.__THNDR_PIVOTS_LAST_BAR__.status = "api-unavailable";
            });
        }

        function schedule() {
          clearTimer();
          if (!active || authBlocked || !root || typeof root.setTimeout !== "function") return;
          var delay = Scanner.boundaryDelay(active.interval, Date.now());
          if (delay === null) return;
          delay = Math.min(delay, 60000);
          var due = Date.now() + delay;
          function nextBoundary() {
            timer = null;
            if (!active || !studyPresent(root, instanceToken)) { stop(); return; }
            if (resolveTicker(active.chart, root, instanceToken) !== active.ticker) { stop(); return; }
            var remaining = due - Date.now();
            if (remaining > 1000) {
              timer = root.setTimeout(nextBoundary, Math.min(remaining, 86400000));
              return;
            }
            if (barTimer === null) refresh();
            schedule();
          }
          timer = root.setTimeout(nextBoundary, Math.min(delay, 86400000));
        }

        this.main = function main(context, input, lookupRetry) {
          var symbol = context.symbol || {};
          var close = context.symbol ? (typeof Std.close === "function" ? Std.close(context) : symbol.close) : NaN;
          var previousClose = NaN, previousTime = NaN;
          // All historical calls must advance the actual candle series, without
          // requesting levels. Metadata timer retries are not chart executions.
          if (!lookupRetry && typeof context.new_var === "function") {
            previousClose = context.new_var(close).get(1);
            previousTime = context.new_var(seconds(symbol.time)).get(1);
          }
          var enabled = input(0) !== false;
          var mode = option(input(2), ALERT_MODES);
          var direction = option(input(3), ALERT_DIRECTIONS);
          if (authBlocked || !context.symbol) { resetAlerts(); return [NaN]; }
          if (!symbol.isLastBar) {
            if (!lookupRetry && alertFrame && alertFrame.time === seconds(symbol.time) &&
                !alertFrame.closed && symbol.isBarClosed === true && input(1) === instanceToken) {
              evaluateAlerts(context, close, previousClose, previousTime, enabled, mode, direction);
            } else resetAlerts();
            return [NaN];
          }
          var nextToken = input(1);
          nextToken = typeof nextToken === "string" ? nextToken : "";
          if (nextToken !== instanceToken) { stop(); instanceToken = nextToken; }
          if (!instanceToken) { resetAlerts(); return [NaN]; }
          if (root && root.__THNDR_ALPHA_RENDERER__ && root.__THNDR_ALPHA_RENDERER__.resolveInstance &&
              !boundInstance(root, instanceToken)) { resetAlerts(); return [NaN]; }
          var source = chartContext(context, Std);
          var ticker = source.resolution ? resolveTicker(source, root, instanceToken) : "";
          var time = seconds(context.symbol.time);
          var key = enabled && ticker && source.resolution && Number.isFinite(time)
            ? JSON.stringify([source.tickerid || source.ticker, source.resolution, ticker]) : "";
          if (!key) {
            resetAlerts();
            if (active) {
              ++requestSerial;
              clearTimer();
              clearBarTimer();
              clearExpiry();
              lastResult = null;
              publish(null, enabled ? "symbol-unresolved" : "disabled");
              stop();
            }
            if (enabled && source.resolution && Number.isFinite(time) && source.ticker && root &&
                typeof root.setTimeout === "function") {
              var unresolved = JSON.stringify([source.tickerid || source.ticker, source.resolution]);
              if (lookupKey !== unresolved) { clearLookup(); lookupKey = unresolved; }
              if (lookupTimer === null && lookupAttempts < 20) {
                lookupAttempts += 1;
                lookupTimer = root.setTimeout(function retryTicker() {
                  lookupTimer = null;
                  if (studyPresent(root, instanceToken)) main(context, input, true);
                }, 500);
              }
            } else clearLookup();
            return [NaN];
          }
          clearLookup();
          var newBar = active && active.key === key && Number.isFinite(lastTime) && time !== lastTime;
          lastTime = time;
          if (!active || active.key !== key) {
            ++requestSerial;
            clearTimer();
            clearBarTimer();
            clearExpiry();
            sourceId = sourcePrefix + ":" + (++sourceSequence);
            active = { key: key, chart: source, ticker: ticker, interval: source.resolution };
            lastResult = null;
            resetAlerts();
            if (!authUnsubscribe && typeof Scanner.onAuthInvalidated === "function")
              authUnsubscribe = Scanner.onAuthInvalidated(authenticationFailed);
            publish(null, "loading"); // Clear old chart lines before the new result.
            refresh();
            schedule();
          } else if (newBar && root && typeof root.setTimeout === "function") {
            clearTimer();
            clearBarTimer();
            barTimer = root.setTimeout(function refreshNewCandle() {
              barTimer = null;
              if (active && active.key === key && studyPresent(root, instanceToken) &&
                  resolveTicker(active.chart, root, instanceToken) === active.ticker) refresh();
            }, 1500);
            schedule();
          }
          if (!lookupRetry) evaluateAlerts(context, close, previousClose, previousTime, enabled, mode, direction);
          return [NaN];
        };
      }
    };
  }

  return Object.freeze({ SPEC: SPEC, buildMetainfo: buildMetainfo,
    chartContext: chartContext, resolveTicker: resolveTicker,
    lineSnapshots: lineSnapshots, createStudy: createStudy });
});
