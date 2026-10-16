/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Separate chart studies derived from "All In one [Tamer Zaky]" by TZack88.
 */

(function registerTamerStudies(root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.__THNDR_TAMER_STUDIES__ = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildApi(root) {
  "use strict";

  var CORE = root && root.__THNDR_TAMER_CORE__;
  if (!CORE && typeof module === "object" && module.exports) {
    CORE = require("./alpha-study.js");
  }
  if (!CORE) throw new Error("Tamer study core must load before the separate studies.");
  var PIVOTS = root && root.__THNDR_TAMER_PIVOTS__;
  if (!PIVOTS && typeof module === "object" && module.exports) PIVOTS = require("./pivot-points.js");
  if (!PIVOTS) throw new Error("Pivot Points must load before the separate studies.");
  var ALERTS = root && root.__THNDR_TAMER_ALERTS__;
  if (!ALERTS && typeof module === "object" && module.exports) ALERTS = require("./indicator-alerts.js");
  var ZONE_ALERTS = root && root.__THNDR_ZONE_ALERTS__;
  if (!ZONE_ALERTS && typeof module === "object" && module.exports) ZONE_ALERTS = require("./zone-alerts.js");
  var ACTIVITY = root && root.__THNDR_ACTIVITY_STUDY__;
  if (!ACTIVITY && typeof module === "object" && module.exports) ACTIVITY = require("./activity-study.js");
  var ATR_FIBONACCI = root && root.__THNDR_ATR_FIBONACCI_STUDY__;
  if (!ATR_FIBONACCI && typeof module === "object" && module.exports) ATR_FIBONACCI = require("./atr-fibonacci-study.js");

  var INPUT = CORE.INPUT;
  var OUTPUT = CORE.OUTPUT;
  var SOURCE_META = CORE.buildMetainfo();

  var SPECS = Object.freeze([
    {
      key: "trend",
      id: "Trend Signals - [Tamer Zaky]@tv-basicstudies-1",
      name: "Trend Signals - [Tamer Zaky]",
      inputs: [
        INPUT.TREND_SIGNALS, INPUT.SENSITIVITY, INPUT.SHOW_TARGETS,
        INPUT.TREND_CANDLES, INPUT.TRAILING_TP, INPUT.TRAILING_MULTIPLIER
      ],
      outputs: [
        OUTPUT.TRAILING, OUTPUT.NORMAL_BUY, OUTPUT.STRONG_BUY,
        OUTPUT.NORMAL_SELL, OUTPUT.STRONG_SELL, OUTPUT.LONG_TP1,
        OUTPUT.LONG_TP2, OUTPUT.SHORT_TP1, OUTPUT.SHORT_TP2,
        OUTPUT.BAR_COLOR
      ]
    },
    {
      key: "orb",
      id: "ORB - [Tamer Zaky]@tv-basicstudies-1",
      name: "ORB - [Tamer Zaky]",
      inputs: [
        INPUT.ORB, INPUT.UTC_OFFSET, INPUT.SESSION_START_HOUR,
        INPUT.SESSION_START_MINUTE, INPUT.SESSION_END_HOUR,
        INPUT.SESSION_END_MINUTE, INPUT.ORB_SIGNALS
      ],
      outputs: [
        OUTPUT.ORB_HIGH, OUTPUT.ORB_LOW, OUTPUT.ORB_MID, OUTPUT.ORB_MID_COLOR,
        OUTPUT.ORB_BUY, OUTPUT.ORB_SELL, OUTPUT.SESSION_BACKGROUND,
        OUTPUT.ORB_UPPER_TOP, OUTPUT.ORB_UPPER_BOTTOM,
        OUTPUT.ORB_LOWER_TOP, OUTPUT.ORB_LOWER_BOTTOM
      ]
    },
    {
      key: "rmi",
      id: "RMI Trend - [Tamer Zaky]@tv-basicstudies-1",
      name: "RMI Trend - [Tamer Zaky]",
      inputs: [
        INPUT.RMI_TREND, INPUT.RMI_LENGTH, INPUT.RMI_POSITIVE,
        INPUT.RMI_NEGATIVE, INPUT.RMI_SHOW_MA
      ],
      outputs: [
        OUTPUT.RMI_CENTER, OUTPUT.RMI_CENTER_COLOR,
        OUTPUT.RMI_POSITIVE_FLIP, OUTPUT.RMI_NEGATIVE_FLIP,
        OUTPUT.BAR_COLOR
      ]
    },
    {
      key: "liquidity",
      id: "Liquidity - [Tamer Zaky]@tv-basicstudies-1",
      name: "Liquidity - [Tamer Zaky]",
      inputs: [
        INPUT.LIQUIDITY, INPUT.LIQUIDITY_PERIOD,
        INPUT.MAX_LIQUIDITY, INPUT.LIQUIDITY_RIGHT
      ],
      // A single transparent anchor keeps the custom study selectable. The
      // Pine boxes are chart drawings, not historical filled-area plots.
      outputs: [OUTPUT.LIQUIDITY_START]
    },
    {
      key: "orderBlocks",
      id: "Order Blocks - [Tamer Zaky]@tv-basicstudies-1",
      name: "Order Blocks - [Tamer Zaky]",
      inputs: [INPUT.ORDER_BLOCKS, INPUT.ORDER_BLOCK_PRESET, INPUT.BREAKER_BLOCK],
      outputs: [OUTPUT.ORDER_BLOCKS_ANCHOR]
    },
    PIVOTS.SPEC,
    ACTIVITY.SPEC,
    ATR_FIBONACCI.SPEC
  ]);

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function pick(source, keys) {
    var selected = {};
    keys.forEach(function add(key) {
      if (Object.prototype.hasOwnProperty.call(source, key)) selected[key] = clone(source[key]);
    });
    return selected;
  }

  function buildMetainfo(spec) {
    if (spec.key === "pivots") return PIVOTS.buildMetainfo();
    if (spec.key === "activity") return ACTIVITY.buildMetainfo();
    if (spec.key === "atrFibonacci") return ATR_FIBONACCI.buildMetainfo();
    var sourcePlots = spec.outputs.map(function plotAt(index) { return SOURCE_META.plots[index]; });
    var plotIds = sourcePlots.map(function plotId(plot) { return plot.id; });
    var filledAreas = SOURCE_META.filledAreas.filter(function belongsToStudy(area) {
      return plotIds.indexOf(area.objAId) !== -1 && plotIds.indexOf(area.objBId) !== -1;
    });
    var fillIds = filledAreas.map(function fillId(area) { return area.id; });
    var paletteIds = sourcePlots.reduce(function collect(acc, plot) {
      if (plot.palette && acc.indexOf(plot.palette) === -1) acc.push(plot.palette);
      return acc;
    }, []);

    var inputs = spec.inputs.map(function originalInput(index) {
      var item = clone(SOURCE_META.inputs[index]);
      if (
        index === INPUT.TREND_SIGNALS || index === INPUT.ORB ||
        index === INPUT.RMI_TREND || index === INPUT.LIQUIDITY || index === INPUT.ORDER_BLOCKS
      ) {
        // An explicitly added standalone study should be visible immediately.
        item.defval = true;
      }
      return item;
    });
    if (spec.key === "liquidity" || spec.key === "orderBlocks") {
      inputs.push({ id: "__tz_instance", name: "Instance", type: "text", defval: "", isHidden: true, isAlwaysShownInLegend: false });
    }
    inputs.push({ id: "chart_alerts", name: "Alerts (while chart is open)", type: "text", defval: "Off",
      options: spec.key === "liquidity" || spec.key === "orderBlocks"
        ? ["Off", "Once per bar close"] : ["Off", "Once per bar", "Once per bar close"] });
    inputs.push({ id: "alert_direction", name: "Alert direction", type: "text", defval: "Both",
      options: ["Both", "Bullish", "Bearish"] });
    var defaults = {};
    inputs.forEach(function defaultInput(item) { defaults[item.id] = item.defval; });

    return {
      _metainfoVersion: SOURCE_META._metainfoVersion,
      id: spec.id,
      name: spec.name,
      description: spec.name,
      shortDescription: spec.name,
      isCustomIndicator: true,
      is_price_study: true,
      linkedToSeries: true,
      format: clone(SOURCE_META.format),
      plots: clone(sourcePlots),
      styles: pick(SOURCE_META.styles, plotIds),
      palettes: pick(SOURCE_META.palettes, paletteIds),
      filledAreas: clone(filledAreas),
      defaults: {
        styles: pick(SOURCE_META.defaults.styles, plotIds),
        palettes: pick(SOURCE_META.defaults.palettes, paletteIds),
        filledAreasStyle: pick(SOURCE_META.defaults.filledAreasStyle, fillIds),
        inputs: defaults
      },
      inputs: inputs
    };
  }

  function retestZones(snapshot, key) {
    if (!snapshot || snapshot.error || !Array.isArray(snapshot.boxes)) return undefined;
    var events = snapshot.modules && snapshot.modules.orderBlocks && snapshot.modules.orderBlocks.events || [];
    var breakers = new Set(events.filter(function breaker(event) { return event.type === "breaker-block"; })
      .map(function body(event) { return event.blockId + ":body"; }));
    return snapshot.boxes.filter(function zone(box) {
      return key === "liquidity" ? box.role === "support-zone" || box.role === "resistance-zone" :
        box.role === "order-block-body" && !breakers.has(box.id);
    }).map(function normalize(box) {
      var bullish = key === "liquidity" ? box.role === "support-zone" : box.polarity === "bullish";
      return { id: box.id, direction: bullish ? "buy" : "sell", lower: Math.min(box.top, box.bottom),
        upper: Math.max(box.top, box.bottom), condition: key === "liquidity"
          ? bullish ? "liquidityBullRetest" : "liquidityBearRetest" : bullish ? "obBullRetest" : "obBearRetest" };
    });
  }

  function createStudy(spec, PineJS) {
    if (spec.key === "pivots") return PIVOTS.createStudy(PineJS);
    if (spec.key === "activity") return ACTIVITY.createStudy(PineJS);
    if (spec.key === "atrFibonacci") return ATR_FIBONACCI.createStudy(PineJS);
    var coreDefinition = CORE.createAlphaStudy(PineJS, {
      headless: true,
      drawingLiquidity: spec.key === "liquidity",
      drawingOrderBlocks: spec.key === "orderBlocks",
      studyName: spec.name
    });
    var coreDefaults = SOURCE_META.inputs.map(function defaultValue(item) { return item.defval; });

    return {
      name: spec.name,
      metainfo: buildMetainfo(spec),
      constructor: function TamerStudyConstructor() {
        var core = new coreDefinition.constructor();
        var alerts = ALERTS ? ALERTS.createChannel(ALERTS.show) : null;
        var drawsZones = spec.key === "liquidity" || spec.key === "orderBlocks";
        var zoneTracker = drawsZones && ZONE_ALERTS ? ZONE_ALERTS.createTracker() : null;
        var alertIndex = spec.inputs.length + (drawsZones ? 1 : 0);

        this.main = function main(context, input) {
          var values = coreDefaults.slice();
          // Instances are independent. Only this study's source module
          // is active; the remaining Alpha-era modules cannot draw or publish.
          values[INPUT.TREND_SIGNALS] = false;
          values[INPUT.LIQUIDITY] = false;
          values[INPUT.ORB] = false;
          values[INPUT.TREND_LINES] = false;
          values[INPUT.CAPITAL_RISK] = false;
          values[INPUT.RMI_TREND] = false;
          values[INPUT.ORDER_BLOCKS] = false;
          values[INPUT.TREND_CANDLES] = false;
          spec.inputs.forEach(function selectedInput(sourceIndex, localIndex) {
            var value = input(localIndex);
            values[sourceIndex] = value === undefined ? coreDefaults[sourceIndex] : value;
          });

          var token = spec.key === "liquidity" || spec.key === "orderBlocks" ? input(spec.inputs.length) : undefined;
          if (token !== undefined || spec.key === "liquidity" || spec.key === "orderBlocks") token = typeof token === "string" ? token : "";
          var allOutputs = core.main(context, function coreInput(index) { return values[index]; }, token);
          if (alerts) {
            var symbol = context.symbol || {};
            var ticker = symbol.tickerid || symbol.ticker || "";
            var period = symbol.period || symbol.resolution || "";
            try {
              if (!ticker && typeof PineJS.Std.tickerid === "function") ticker = PineJS.Std.tickerid(context);
              if (!period && typeof PineJS.Std.period === "function") period = PineJS.Std.period(context);
              var mode = input(alertIndex), direction = input(alertIndex + 1);
              if (drawsZones && mode !== "Off" && mode !== undefined) mode = "Once per bar close";
              var signature = JSON.stringify([ticker, period, values, token, mode, direction]);
              var zoneEvents = zoneTracker ? zoneTracker.update({ signature: signature, time: symbol.time,
                isLastBar: symbol.isLastBar === true, isBarClosed: symbol.isBarClosed !== false,
                previousClose: core.alertPreviousClose, high: PineJS.Std.high(context), low: PineJS.Std.low(context),
                close: PineJS.Std.close(context), zones: retestZones(core.alertSnapshot, spec.key) }) : [];
              var displayTicker = ticker;
              if (mode && mode !== "Off" && symbol.isLastBar && typeof PIVOTS.resolveTicker === "function") {
                displayTicker = PIVOTS.resolveTicker({ ticker: ticker, resolution: period }, root, token) || ticker;
              }
              alerts.update({ signature: signature,
                time: symbol.time, isLastBar: symbol.isLastBar === true, isBarClosed: symbol.isBarClosed !== false,
                mode: mode, direction: direction, conditions: core.alertConditions, events: zoneEvents,
                symbol: displayTicker, resolution: period, price: PineJS.Std.close(context) });
            } catch (_error) { /* A notification failure must never interrupt indicator calculation. */ }
          }
          return spec.outputs.map(function selectedOutput(index) { return allOutputs[index]; });
        };
      }
    };
  }

  function createStudies(PineJS) {
    return SPECS.map(function create(spec) { return createStudy(spec, PineJS); });
  }

  return Object.freeze({ SPECS: SPECS, createStudies: createStudies, buildMetainfo: buildMetainfo });
});
