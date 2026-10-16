/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Derived from "All In one [Tamer Zaky]" by TZack88, supplied by the user.
 * This conversion targets TradingView Charting Library Custom Studies.
 */

(function registerAlphaStudy(root, factory) {
  "use strict";

  var api = factory(root);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.__THNDR_TAMER_CORE__ = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function buildApi(root) {
  "use strict";

  var STUDY_ID = "Alpha by Tamer Zaky@tv-basicstudies-1";
  var STUDY_NAME = "Alpha by Tamer Zaky";
  var MAX_HISTORY = 5000;
  var drawingSourcePrefix = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  var drawingSourceSequence = 0;
  var NATIVE_LIQUIDITY_SLOTS = 5;
  var NATIVE_LIQUIDITY_VALUES_PER_SLOT = 4;
  var NATIVE_LIQUIDITY_PLOTS = NATIVE_LIQUIDITY_SLOTS * 2 * NATIVE_LIQUIDITY_VALUES_PER_SLOT;

  var INPUT = Object.freeze({
    TREND_SIGNALS: 0,
    LIQUIDITY: 1,
    ORB: 2,
    TREND_LINES: 3,
    CAPITAL_RISK: 4,
    RMI_TREND: 5,
    ORDER_BLOCKS: 6,
    SENSITIVITY: 7,
    SHOW_TARGETS: 8,
    TREND_CANDLES: 9,
    TRAILING_TP: 10,
    TRAILING_MULTIPLIER: 11,
    LIQUIDITY_PERIOD: 12,
    MAX_LIQUIDITY: 13,
    LIQUIDITY_RIGHT: 14,
    UTC_OFFSET: 15,
    SESSION_START_HOUR: 16,
    SESSION_START_MINUTE: 17,
    SESSION_END_HOUR: 18,
    SESSION_END_MINUTE: 19,
    ORB_SIGNALS: 20,
    TRENDLINE_PRESET: 21,
    TRENDLINE_COLOR: 22,
    TRENDLINE_LAST: 23,
    TRENDLINE_HISTORY: 24,
    ORDER_BLOCK_PRESET: 25,
    BREAKER_BLOCK: 26,
    RMI_LENGTH: 27,
    RMI_POSITIVE: 28,
    RMI_NEGATIVE: 29,
    RMI_SHOW_MA: 30,
    RMI_BULL_COLOR: 31,
    RMI_BEAR_COLOR: 32,
    CAPITAL: 33,
    ACCOUNT_RISK: 34,
    STOP_LOSS: 35,
    RR_RATIO: 36
  });

  var OUTPUT = Object.freeze({
    TRAILING: 0,
    NORMAL_BUY: 1,
    STRONG_BUY: 2,
    NORMAL_SELL: 3,
    STRONG_SELL: 4,
    LONG_TP1: 5,
    LONG_TP2: 6,
    SHORT_TP1: 7,
    SHORT_TP2: 8,
    ORB_HIGH: 9,
    ORB_LOW: 10,
    ORB_MID: 11,
    ORB_BUY: 12,
    ORB_SELL: 13,
    RMI_CENTER: 14,
    RMI_CENTER_COLOR: 15,
    RMI_GLOW_1: 16,
    RMI_GLOW_1_COLOR: 17,
    RMI_GLOW_2: 18,
    RMI_GLOW_2_COLOR: 19,
    RMI_GLOW_3: 20,
    RMI_GLOW_3_COLOR: 21,
    RMI_TOP: 22,
    RMI_BOTTOM: 23,
    RMI_POSITIVE_FLIP: 24,
    RMI_NEGATIVE_FLIP: 25,
    BAR_COLOR: 26,
    SESSION_BACKGROUND: 27,
    ORB_MID_COLOR: 28,
    LIQUIDITY_START: 29,
    ORB_UPPER_TOP: 29 + NATIVE_LIQUIDITY_PLOTS,
    ORB_UPPER_BOTTOM: 30 + NATIVE_LIQUIDITY_PLOTS,
    ORB_LOWER_TOP: 31 + NATIVE_LIQUIDITY_PLOTS,
    ORB_LOWER_BOTTOM: 32 + NATIVE_LIQUIDITY_PLOTS,
    ORDER_BLOCKS_ANCHOR: 33 + NATIVE_LIQUIDITY_PLOTS
  });

  function finite(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function numberInput(input, index, fallback) {
    var value = Number(input(index));
    return Number.isFinite(value) ? value : fallback;
  }

  function boolInput(input, index, fallback) {
    var value = input(index);
    return typeof value === "boolean" ? value : fallback;
  }

  function textInput(input, index, fallback) {
    var value = input(index);
    return typeof value === "string" && value.length > 0 ? value : fallback;
  }

  function optionInput(input, index, options, fallback) {
    var value = input(index);
    if (typeof value === "number" && Number.isInteger(value)) {
      return options[value] || fallback;
    }
    if (typeof value === "string") {
      var trimmed = value.trim();
      if (/^\d+$/.test(trimmed)) {
        return options[Number(trimmed)] || fallback;
      }
      if (options.indexOf(trimmed) !== -1) {
        return trimmed;
      }
    }
    return fallback;
  }

  function previousNumber(series, fallback) {
    var value = series.get(1);
    return finite(value) ? value : fallback;
  }

  function previousFlag(series, fallback) {
    var value = series.get(1);
    return finite(value) ? value === 1 : fallback;
  }

  function pineWma(series, length) {
    // The Pine reference uses exactly length weighted bars. Thndr's Std.wma
    // also reads the preceding zero-weight bar, so 0 * NaN delays startup.
    var weighted = 0;
    for (var offset = 0; offset < length; offset += 1) {
      var value = series.get(offset);
      if (!finite(value)) return NaN;
      weighted += value * (length - offset);
    }
    return weighted / (length * (length + 1) / 2);
  }

  function pineEma(value, length, context) {
    // Pine seeds its EMA with the first source value, not an initial SMA.
    // Read the prior candle on every call so realtime updates roll back.
    var state = context.new_var(NaN);
    var previous = state.get(1);
    var alpha = 2 / (length + 1);
    var current = !finite(value) ? previous : finite(previous)
      ? alpha * value + (1 - alpha) * previous
      : value;
    state.set(current);
    return current;
  }

  function pineExtreme(series, length, highest) {
    // Pine highest/lowest ignore unavailable history. The shipped host helpers
    // require the full window, which otherwise removes early marker offsets.
    var extreme = NaN;
    for (var offset = 0; offset < length; offset += 1) {
      var value = series.get(offset);
      if (!finite(value)) continue;
      extreme = !finite(extreme) ? value : highest ? Math.max(extreme, value) : Math.min(extreme, value);
    }
    return extreme;
  }

  function lineStyle(color, width, visible) {
    return {
      linestyle: 0,
      linewidth: width,
      plottype: 7,
      trackPrice: false,
      transparency: 0,
      visible: visible,
      color: color
    };
  }

  function shapeStyle(shape, location, color, text, textColor, transparency, size) {
    return {
      plottype: shape,
      location: location,
      color: color,
      text: text || "",
      textColor: textColor || "#FFFFFF",
      transparency: finite(transparency) ? transparency : 0,
      visible: true,
      size: size || "tiny"
    };
  }

  function palette(names) {
    var colors = {};
    names.forEach(function addName(name, index) {
      colors[index] = { name: name };
    });
    return { colors: colors };
  }

  function paletteDefaults(colors) {
    var result = {};
    colors.forEach(function addColor(color, index) {
      result[index] = { color: color, width: 1, style: 0 };
    });
    return { colors: result };
  }

  function addInput(id, name, defval, type, group, extra) {
    var value = {
      id: id,
      name: name,
      defval: defval,
      type: type,
      group: group
    };
    if (extra) {
      Object.keys(extra).forEach(function copy(key) {
        value[key] = extra[key];
      });
    }
    return value;
  }

  function buildMetainfo() {
    var inputs = [
      addInput("trend_signals", "Trend Signals", true, "bool", "Modules"),
      addInput("liquidity", "Liquidity", false, "bool", "Modules"),
      addInput("orb", "ORB", false, "bool", "Modules"),
      addInput("trend_lines", "TrendLines", false, "bool", "Modules"),
      addInput("capital_risk", "Capital Risk", false, "bool", "Modules"),
      addInput("rmi_trend", "RMI Trend", false, "bool", "Modules"),
      addInput("order_blocks", "Order Blocks", false, "bool", "Modules"),
      addInput("sensitivity", "Sensitivity", 1.7, "float", "Trend Signal Settings", {
        min: 0.5,
        max: 5,
        step: 0.1
      }),
      addInput("show_targets", "TP", true, "bool", "Trend Signal Settings"),
      addInput("trend_candles", "Trend Candles", true, "bool", "Trend Signal Settings"),
      addInput("trailing_tp", "Trailing TP", true, "bool", "Trend Signal Settings"),
      addInput("trailing_multiplier", "Trailing Multiplier", 2.1, "float", "Trend Signal Settings", {
        step: 0.1
      }),
      addInput("liquidity_period", "Period", 10, "integer", "Liquidity Settings", {
        min: 3
      }),
      addInput("max_liquidity", "Max", 5, "integer", "Liquidity Settings", {
        min: 0
      }),
      addInput("liquidity_right", "Right", 5, "integer", "Liquidity Settings", {
        min: 0
      }),
      addInput("utc_offset", "UTC +/-", "+3", "text", "ORB Settings"),
      addInput("session_start_hour", "Session Start Hour", 9, "integer", "ORB Settings", {
        min: 0,
        max: 23
      }),
      addInput("session_start_minute", "Session Start Minute", 45, "integer", "ORB Settings", {
        min: 0,
        max: 59
      }),
      addInput("session_end_hour", "Session End Hour", 10, "integer", "ORB Settings", {
        min: 0,
        max: 23
      }),
      addInput("session_end_minute", "Session End Minute", 15, "integer", "ORB Settings", {
        min: 0,
        max: 59
      }),
      addInput("orb_signals", "Signals", true, "bool", "ORB Settings"),
      addInput("trendline_preset", "Preset", "Medium", "text", "TrendLines Settings", {
        options: ["Small", "Medium", "Big", "Macro"]
      }),
      addInput("trendline_color", "Line Color", "#B2B5BE", "color", "TrendLines Settings"),
      addInput("trendline_last", "Last", 2, "integer", "TrendLines Settings", {
        min: 1,
        max: 2
      }),
      addInput("trendline_history", "History", false, "bool", "TrendLines Settings"),
      addInput("order_block_preset", "Preset", "Macro", "text", "OrderBlock Settings", {
        options: ["Macro", "Big", "Medium", "Small"]
      }),
      addInput("breaker_block", "Breaker Block", false, "bool", "OrderBlock Settings"),
      addInput("rmi_length", "RMI Length", 14, "integer", "RMI Settings", {
        min: 1
      }),
      addInput("rmi_positive", "Positive above", 66, "integer", "RMI Settings"),
      addInput("rmi_negative", "Negative below", 30, "integer", "RMI Settings"),
      addInput("rmi_show_ma", "Show MA", true, "bool", "RMI Settings"),
      addInput("rmi_bull_color", "Bull Color", "#00BCD4", "color", "RMI Settings"),
      addInput("rmi_bear_color", "Bear Color", "#FF5252", "color", "RMI Settings"),
      addInput("capital", "Capital", 100000, "float", "Capital Risk Settings", { step: 10 }),
      addInput("account_risk", "Account Risk %", 2, "float", "Capital Risk Settings", {
        max: 5,
        step: 0.1
      }),
      addInput("stop_loss", "Stop Loss %", 3, "float", "Capital Risk Settings", {
        step: 0.1
      }),
      addInput("rr_ratio", "RR Ratio", 2, "float", "Capital Risk Settings", { step: 0.1 })
    ];

    var defaultInputs = {};
    inputs.forEach(function addDefault(item) {
      defaultInputs[item.id] = item.defval;
    });

    var metainfo = {
      _metainfoVersion: 53,
      id: STUDY_ID,
      name: STUDY_NAME,
      description: STUDY_NAME,
      shortDescription: STUDY_NAME,
      isCustomIndicator: true,
      is_price_study: true,
      linkedToSeries: true,
      format: { type: "price", precision: 2 },
      plots: [
        { id: "trailing", type: "line" },
        { id: "normal_buy", type: "shapes" },
        { id: "strong_buy", type: "shapes" },
        { id: "normal_sell", type: "shapes" },
        { id: "strong_sell", type: "shapes" },
        { id: "long_tp1", type: "shapes" },
        { id: "long_tp2", type: "shapes" },
        { id: "short_tp1", type: "shapes" },
        { id: "short_tp2", type: "shapes" },
        { id: "orb_high", type: "line" },
        { id: "orb_low", type: "line" },
        { id: "orb_mid", type: "line" },
        { id: "orb_buy", type: "shapes" },
        { id: "orb_sell", type: "shapes" },
        { id: "rmi_center", type: "line" },
        { id: "rmi_center_color", type: "colorer", target: "rmi_center", palette: "rmi" },
        { id: "rmi_glow_1", type: "line" },
        { id: "rmi_glow_1_color", type: "colorer", target: "rmi_glow_1", palette: "rmi" },
        { id: "rmi_glow_2", type: "line" },
        { id: "rmi_glow_2_color", type: "colorer", target: "rmi_glow_2", palette: "rmi" },
        { id: "rmi_glow_3", type: "line" },
        { id: "rmi_glow_3_color", type: "colorer", target: "rmi_glow_3", palette: "rmi" },
        { id: "rmi_top", type: "line" },
        { id: "rmi_bottom", type: "line" },
        { id: "rmi_positive_flip", type: "shapes" },
        { id: "rmi_negative_flip", type: "shapes" },
        { id: "bar_color", type: "bar_colorer", palette: "bars" },
        { id: "session_background", type: "bg_colorer", palette: "background" },
        { id: "orb_mid_color", type: "colorer", target: "orb_mid", palette: "orb_mid" }
      ],
      styles: {
        trailing: { title: "Up Trend", histogramBase: 0, joinPoints: false },
        normal_buy: { title: "Buy Label" },
        strong_buy: { title: "Strong Buy Label" },
        normal_sell: { title: "Sell Label" },
        strong_sell: { title: "Strong Sell Label" },
        long_tp1: { title: "Long TP1" },
        long_tp2: { title: "Long TP2" },
        short_tp1: { title: "Short TP1" },
        short_tp2: { title: "Short TP2" },
        orb_high: { title: "ORB High", histogramBase: 0, joinPoints: false },
        orb_low: { title: "ORB Low", histogramBase: 0, joinPoints: false },
        orb_mid: { title: "ORB Mid", histogramBase: 0, joinPoints: false },
        orb_buy: { title: "ORB Buy Signal" },
        orb_sell: { title: "ORB Sell Signal" },
        rmi_center: { title: "RRTH", histogramBase: 0, joinPoints: false },
        rmi_glow_1: { title: "RRTH Glow 1", histogramBase: 0, joinPoints: false },
        rmi_glow_2: { title: "RRTH Glow 2", histogramBase: 0, joinPoints: false },
        rmi_glow_3: { title: "RRTH Glow 3", histogramBase: 0, joinPoints: false },
        rmi_top: { title: "RRTH Top", histogramBase: 0, joinPoints: false },
        rmi_bottom: { title: "RRTH Bottom", histogramBase: 0, joinPoints: false },
        rmi_positive_flip: { title: "RMI Positive" },
        rmi_negative_flip: { title: "RMI Negative" }
      },
      palettes: {
        rmi: palette(["Bull", "Bear"]),
        bars: palette(["Trend Bull", "Trend Bear", "RMI Bull", "RMI Bear"]),
        background: palette(["Active Session"]),
        orb_mid: { colors: { 0: { name: "Stable Mid" } }, addDefaultColor: false },
        liquidity_dominance: palette(["Bull volume", "Bear volume"])
      },
      filledAreas: [
        {
          id: "orb_upper_fill",
          objAId: "orb_high",
          objBId: "orb_mid",
          type: "plot_plot",
          title: "ORB Upper Fill"
        },
        {
          id: "orb_lower_fill",
          objAId: "orb_mid",
          objBId: "orb_low",
          type: "plot_plot",
          title: "ORB Lower Fill"
        }
      ],
      defaults: {
        styles: {
          trailing: lineStyle("#4CAF50", 2, true),
          normal_buy: shapeStyle("shape_label_up", "Absolute", "#33CFBB", "▲"),
          strong_buy: shapeStyle("shape_label_up", "Absolute", "#33CFBB", "▲+"),
          normal_sell: shapeStyle("shape_label_down", "Absolute", "#DD3024", "▼"),
          strong_sell: shapeStyle("shape_label_down", "Absolute", "#DD3024", "▼+"),
          long_tp1: shapeStyle("shape_label_down", "Absolute", "#000000", "✓", "#60E264", 100, "normal"),
          long_tp2: shapeStyle("shape_label_down", "Absolute", "#000000", "✓", "#60E264", 100, "normal"),
          short_tp1: shapeStyle("shape_label_up", "Absolute", "#000000", "✓", "#60E264", 100, "normal"),
          short_tp2: shapeStyle("shape_label_up", "Absolute", "#000000", "✓", "#60E264", 100, "normal"),
          orb_high: lineStyle("#707070", 1, true),
          orb_low: lineStyle("#707070", 1, true),
          orb_mid: lineStyle("rgba(137, 137, 137, 0)", 1, true),
          orb_buy: shapeStyle("shape_label_up", "BelowBar", "#57B4BA", ""),
          orb_sell: shapeStyle("shape_label_down", "AboveBar", "#FE4F2D", ""),
          rmi_center: lineStyle("#00BCD4", 1, true),
          rmi_glow_1: lineStyle("#00BCD4", 2, false),
          rmi_glow_2: lineStyle("#00BCD4", 3, false),
          rmi_glow_3: lineStyle("#00BCD4", 4, false),
          rmi_top: lineStyle("#000000", 1, false),
          rmi_bottom: lineStyle("#000000", 1, false),
          rmi_positive_flip: shapeStyle("shape_label_up", "Absolute", "#4CAF50", "", "#FFFFFF", 0, "small"),
          rmi_negative_flip: shapeStyle("shape_label_down", "Absolute", "#F23645", "", "#FFFFFF", 0, "small")
        },
        palettes: {
          rmi: paletteDefaults(["#00BCD4", "#FF5252"]),
          bars: paletteDefaults(["#33CFBB", "#DD3024", "#4CAF50", "#F23645"]),
          background: paletteDefaults(["rgba(0, 188, 212, 0.1)"]),
          orb_mid: paletteDefaults(["#898989"]),
          liquidity_dominance: paletteDefaults(["#00FF00", "#FF0000"])
        },
        filledAreasStyle: {
          orb_upper_fill: {
            fillType: "gradient",
            color: "rgba(87, 180, 186, 0.15)",
            topColor: "rgba(87, 180, 186, 0.15)",
            bottomColor: "rgba(41, 98, 255, 0)",
            transparency: 0,
            visible: true
          },
          orb_lower_fill: {
            fillType: "gradient",
            color: "rgba(254, 79, 45, 0.15)",
            topColor: "rgba(255, 235, 59, 0)",
            bottomColor: "rgba(254, 79, 45, 0.15)",
            transparency: 0,
            visible: true
          }
        },
        inputs: defaultInputs
      },
      inputs: inputs
    };

    ["resistance", "support"].forEach(function addLiquidityKind(kind) {
      var color = kind === "resistance" ? "#F33838" : "#2FF56A";
      for (var slot = 0; slot < NATIVE_LIQUIDITY_SLOTS; slot += 1) {
        var topId = "liquidity_" + kind + "_" + (slot + 1) + "_top";
        var bottomId = "liquidity_" + kind + "_" + (slot + 1) + "_bottom";
        var midId = "liquidity_" + kind + "_" + (slot + 1) + "_mid";
        var midColorId = midId + "_color";
        var fillId = "liquidity_" + kind + "_" + (slot + 1) + "_fill";
        metainfo.plots.push(
          { id: topId, type: "line" },
          { id: bottomId, type: "line" },
          { id: midId, type: "line" },
          { id: midColorId, type: "colorer", target: midId, palette: "liquidity_dominance" }
        );
        metainfo.styles[topId] = { title: "Liquidity " + kind + " " + (slot + 1) + " top", joinPoints: false };
        metainfo.styles[bottomId] = { title: "Liquidity " + kind + " " + (slot + 1) + " bottom", joinPoints: false };
        metainfo.styles[midId] = { title: "Liquidity " + kind + " " + (slot + 1) + " mid", joinPoints: false };
        metainfo.defaults.styles[topId] = lineStyle("rgba(0, 0, 0, 0)", 1, true);
        metainfo.defaults.styles[bottomId] = lineStyle("rgba(0, 0, 0, 0)", 1, true);
        metainfo.defaults.styles[midId] = lineStyle("#00FF00", 1, true);
        metainfo.defaults.styles[midId].linestyle = 2;
        metainfo.filledAreas.push({
          id: fillId,
          objAId: topId,
          objBId: bottomId,
          type: "plot_plot",
          title: "Liquidity " + kind + " " + (slot + 1)
        });
        metainfo.defaults.filledAreasStyle[fillId] = { color: color, transparency: 80, visible: true };
      }
    });

    // A gradient needs per-bar price coordinates; colors alone do not render it.
    metainfo.plots.push(
      { id: "orb_upper_top", type: "data", target: "orb_upper_fill", targetField: "topValue" },
      { id: "orb_upper_bottom", type: "data", target: "orb_upper_fill", targetField: "bottomValue" },
      { id: "orb_lower_top", type: "data", target: "orb_lower_fill", targetField: "topValue" },
      { id: "orb_lower_bottom", type: "data", target: "orb_lower_fill", targetField: "bottomValue" }
    );
    metainfo.plots.push({ id: "order_blocks_anchor", type: "line" });
    metainfo.styles.order_blocks_anchor = { title: "Order Blocks", joinPoints: false };
    metainfo.defaults.styles.order_blocks_anchor = lineStyle("rgba(0, 0, 0, 0)", 1, true);

    return metainfo;
  }

  function parseUtcOffset(value) {
    var match = String(value || "+3").trim().match(/^([+-])?(\d{1,2})(?::?(\d{2}))?$/);
    if (!match) {
      return 180;
    }
    var sign = match[1] === "-" ? -1 : 1;
    var hours = Math.min(23, Number(match[2]));
    var minutes = Math.min(59, Number(match[3] || 0));
    return sign * (hours * 60 + minutes);
  }

  function utcMinuteOfDay(time, offsetMinutes) {
    if (!finite(time)) {
      return NaN;
    }
    var milliseconds = Math.abs(time) < 100000000000 ? time * 1000 : time;
    var shifted = new Date(milliseconds + offsetMinutes * 60000);
    return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  }

  function inMinuteSession(minuteOfDay, start, end) {
    if (!finite(minuteOfDay)) {
      return false;
    }
    // Pine treats equal endpoints as a continuous 24-hour session.
    return start < end
      ? minuteOfDay >= start && minuteOfDay < end
      : minuteOfDay >= start || minuteOfDay < end;
  }

  function resolveBarColorIndex(trendCandles, longTrend, rmiEnabled, positive) {
    if (trendCandles) {
      return longTrend ? 0 : 1;
    }
    if (rmiEnabled) {
      return positive ? 2 : 3;
    }
    return NaN;
  }

  function normalizeBar(context, open, high, low, close, volume) {
    var symbol = context.symbol || {};
    if (![symbol.time, open, high, low, close].every(finite)) return null;
    return {
      index: finite(symbol.index) ? symbol.index : null,
      time: finite(symbol.time) ? symbol.time : null,
      open: finite(open) ? open : null,
      high: finite(high) ? high : null,
      low: finite(low) ? low : null,
      close: finite(close) ? close : null,
      volume: finite(volume) ? volume : null,
      isBarClosed: symbol.isBarClosed !== false
    };
  }

  function rememberBar(instance, bar, retainDrawingHistory) {
    if (!instance._alphaHistory) {
      instance._alphaHistory = [];
    }
    var history = instance._alphaHistory;
    if (!bar) return history;
    var last = history[history.length - 1];
    if (last && bar.time < last.time) {
      // The library can replay a study instance after a history correction.
      // Drop the replayed suffix instead of mixing old and corrected candles.
      var rewindIndex = history.findIndex(function replayedBar(previous) {
        return previous.time >= bar.time;
      });
      history.splice(rewindIndex === -1 ? 0 : rewindIndex);
      instance._alphaLiquiditySlots = null;
      last = history[history.length - 1];
    }
    // Library indices can be rebased when history loads; time identifies the candle.
    if (last && last.time === bar.time) {
      history[history.length - 1] = bar;
    } else {
      history.push(bar);
      // Drawing snapshots replay once on the last bar. Retain their delivered
      // history so an old active zone and its ATR seed survive later candles.
      if (!retainDrawingHistory && history.length > MAX_HISTORY) {
        history.splice(0, history.length - MAX_HISTORY);
      }
    }
    return history;
  }

  function drawingContext(context, Std) {
    var symbol = context.symbol || {};
    function text(value) {
      return typeof value === "string" ? value.trim() : "";
    }
    function fromStd(name) {
      if (typeof Std[name] !== "function") return "";
      try { return text(Std[name](context)); } catch (_) { return ""; }
    }
    var tickerid = text(symbol.tickerid) || fromStd("tickerid");
    var ticker = text(symbol.ticker) || fromStd("ticker");
    var resolution = text(symbol.period) || text(symbol.resolution) || fromStd("period");
    if (!tickerid && !ticker && !resolution) return undefined;
    var result = {};
    if (tickerid) result.tickerid = tickerid;
    if (ticker) result.ticker = ticker;
    if (resolution) {
      resolution = resolution.toUpperCase();
      result.resolution = /^[DWM]$/.test(resolution) ? "1" + resolution : resolution;
    }
    return result;
  }

  function drawingContextChanged(previous, current) {
    if (!previous || !current) return false;
    if (previous.resolution && current.resolution && previous.resolution !== current.resolution) return true;
    if (previous.tickerid && current.tickerid) {
      return previous.tickerid.toUpperCase() !== current.tickerid.toUpperCase();
    }
    var previousTicker = previous.ticker || previous.tickerid;
    var currentTicker = current.ticker || current.tickerid;
    // A short ticker and its exchange-qualified ID can describe the same
    // dataset when the host fills in symbol metadata during initialization.
    return Boolean(previousTicker && currentTicker &&
      previousTicker.split(":").pop().toUpperCase() !== currentTicker.split(":").pop().toUpperCase());
  }

  function nativeLiquidityOutput(instance, history, settings) {
    var result = new Array(NATIVE_LIQUIDITY_PLOTS).fill(NaN);
    if (!settings.modules.liquidity) {
      instance._alphaLiquiditySlots = null;
      return result;
    }

    var renderer = root && root.__THNDR_ALPHA_RENDERER__;
    if (!renderer || typeof renderer.computeLiquidity !== "function") return result;

    var model = renderer.computeLiquidity(history, settings);
    var slots = instance._alphaLiquiditySlots || {
      resistance: new Array(NATIVE_LIQUIDITY_SLOTS).fill(null),
      support: new Array(NATIVE_LIQUIDITY_SLOTS).fill(null)
    };

    ["resistance", "support"].forEach(function populateKind(kind, kindIndex) {
      var zones = model.boxes.filter(function isZone(box) {
        return box.role === kind + "-zone";
      }).slice(-NATIVE_LIQUIDITY_SLOTS);
      var byId = new Map(zones.map(function pair(zone) { return [zone.id, zone]; }));
      var kindSlots = slots[kind];
      var previous = kindSlots.slice();

      for (var slot = 0; slot < NATIVE_LIQUIDITY_SLOTS; slot += 1) {
        if (!byId.has(kindSlots[slot])) kindSlots[slot] = null;
      }
      zones.forEach(function assignZone(zone) {
        if (kindSlots.indexOf(zone.id) !== -1) return;
        var free = kindSlots.indexOf(null);
        if (free !== -1) kindSlots[free] = zone.id;
      });

      for (var index = 0; index < NATIVE_LIQUIDITY_SLOTS; index += 1) {
        var current = byId.get(kindSlots[index]);
        if (!current || (previous[index] && previous[index] !== current.id)) continue;
        var offset = (kindIndex * NATIVE_LIQUIDITY_SLOTS + index) * NATIVE_LIQUIDITY_VALUES_PER_SLOT;
        var midline = model.lines.find(function matchingMidline(line) {
          return line.id === current.id.replace(/:zone$/, ":mid");
        });
        result[offset] = current.top;
        result[offset + 1] = current.bottom;
        result[offset + 2] = (current.top + current.bottom) / 2;
        result[offset + 3] = midline && midline.style && midline.style.color === "#00e676" ? 0 : 1;
      }
    });

    instance._alphaLiquiditySlots = slots;
    return result;
  }

  function publishSnapshot(context, history, settings, native, sourceId, sourceContext, studyName, orderBlockReplay, instanceToken, computeOnly) {
    var symbol = context.symbol || {};
    if ((!symbol.isLastBar && !computeOnly) || !root) {
      return;
    }

    var renderer = root.__THNDR_ALPHA_RENDERER__;
    var rendererResult = null;
    if (renderer && typeof renderer.computeSnapshots === "function") {
      try {
        var renderOptions = {
          nativeLiquidity: Boolean(native && native.nativeLiquidity),
          sourceId: sourceId
        };
        if (sourceContext) renderOptions.context = sourceContext;
        if (studyName) renderOptions.studyName = studyName;
        if (instanceToken !== undefined) renderOptions.instanceToken = instanceToken;
        if (orderBlockReplay) renderOptions.orderBlockReplay = orderBlockReplay;
        rendererResult = renderer.computeSnapshots(history.slice(), settings, renderOptions);
        if (!computeOnly && typeof renderer.publishSnapshot === "function") {
          renderer.publishSnapshot(rendererResult, settings);
        }
        if (!computeOnly && typeof renderer.reconcile === "function") {
          renderer.reconcile(rendererResult, settings);
        } else if (!computeOnly && typeof renderer.reconcileSnapshot === "function") {
          renderer.reconcileSnapshot(rendererResult, settings);
        }
      } catch (error) {
        rendererResult = { error: error && error.message ? error.message : "renderer failed" };
      }
    }

    if (computeOnly) return rendererResult;
    var snapshot = {
      study: studyName || STUDY_NAME,
      version: 1,
      settings: settings,
      native: native,
      renderer: rendererResult,
      barCount: history.length,
      lastBar: history.length ? history[history.length - 1] : null
    };
    root.__THNDR_ALPHA_LAST_BAR__ = snapshot;

    if (typeof root.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
      root.dispatchEvent(new root.CustomEvent("thndr:alpha:last-bar", { detail: snapshot }));
    }
    return rendererResult;
  }

  function createAlphaStudy(PineJS, options) {
    if (!PineJS || !PineJS.Std) {
      throw new Error("PineJS.Std is required to create Alpha by Tamer Zaky.");
    }

    var Std = PineJS.Std;
    var headless = Boolean(options && options.headless);
    var nativeLiquidity = Boolean(options && options.nativeLiquidity);
    var drawingLiquidity = Boolean(options && options.drawingLiquidity);
    var drawingOrderBlocks = Boolean(options && options.drawingOrderBlocks);
    var drawingObjects = drawingLiquidity || drawingOrderBlocks;
    var studyName = options && options.studyName;

    return {
      name: STUDY_NAME,
      metainfo: buildMetainfo(),
      constructor: function AlphaStudyConstructor() {
        var drawingSourceId = drawingSourcePrefix + ":" + (++drawingSourceSequence);
        var sourceContext;
        var orderBlockReplay = null;
        var drawingInstanceToken;
        var lastDrawingBarTime;
        this.main = function main(context, input, instanceToken) {
          if (drawingInstanceToken !== instanceToken) {
            drawingSourceId = drawingSourcePrefix + ":" + (++drawingSourceSequence);
            drawingInstanceToken = instanceToken;
          }
          this._context = context;
          this._input = input;

          if (!headless || nativeLiquidity || drawingObjects) {
            var currentContext = drawingContext(context, Std);
            if (drawingContextChanged(sourceContext, currentContext)) {
              lastDrawingBarTime = undefined;
              this._alphaHistory = [];
              this._alphaLiquiditySlots = null;
              drawingSourceId = drawingSourcePrefix + ":" + (++drawingSourceSequence);
              sourceContext = currentContext;
            } else if (currentContext) {
              sourceContext = Object.assign({}, sourceContext, currentContext);
            }
          }

          if (typeof context.setMinimumAdditionalDepth === "function") {
            context.setMinimumAdditionalDepth(MAX_HISTORY);
          }

          var showTrendSignals = boolInput(input, INPUT.TREND_SIGNALS, true);
          var showLiquidity = boolInput(input, INPUT.LIQUIDITY, false);
          var enableOrb = boolInput(input, INPUT.ORB, false);
          var showTrendLines = boolInput(input, INPUT.TREND_LINES, false);
          var showCapitalRisk = boolInput(input, INPUT.CAPITAL_RISK, false);
          var enableRmi = boolInput(input, INPUT.RMI_TREND, false);
          var showOrderBlocks = boolInput(input, INPUT.ORDER_BLOCKS, false);
          var sensitivity = Math.max(0.5, Math.min(5, numberInput(input, INPUT.SENSITIVITY, 1.7)));
          var showTargets = boolInput(input, INPUT.SHOW_TARGETS, true);
          var trendCandles = boolInput(input, INPUT.TREND_CANDLES, true);
          var trailingOn = boolInput(input, INPUT.TRAILING_TP, true);
          var trailingMultiplier = numberInput(input, INPUT.TRAILING_MULTIPLIER, 2.1);
          var liquidityPeriod = Math.max(3, Math.round(numberInput(input, INPUT.LIQUIDITY_PERIOD, 10)));
          var maxLiquidity = Math.max(0, Math.round(numberInput(input, INPUT.MAX_LIQUIDITY, 5)));
          var liquidityRight = Math.max(0, Math.round(numberInput(input, INPUT.LIQUIDITY_RIGHT, 5)));
          var utcOffset = textInput(input, INPUT.UTC_OFFSET, "+3");
          var sessionStart =
            Math.round(numberInput(input, INPUT.SESSION_START_HOUR, 9)) * 60 +
            Math.round(numberInput(input, INPUT.SESSION_START_MINUTE, 45));
          var sessionEnd =
            Math.round(numberInput(input, INPUT.SESSION_END_HOUR, 10)) * 60 +
            Math.round(numberInput(input, INPUT.SESSION_END_MINUTE, 15));
          var showOrbSignals = boolInput(input, INPUT.ORB_SIGNALS, true);
          var trendlinePreset = optionInput(input, INPUT.TRENDLINE_PRESET, ["Small", "Medium", "Big", "Macro"], "Medium");
          var trendlineColor = textInput(input, INPUT.TRENDLINE_COLOR, "#B2B5BE");
          var trendlineLast = Math.max(1, Math.min(2, Math.round(numberInput(input, INPUT.TRENDLINE_LAST, 2))));
          var trendlineHistory = boolInput(input, INPUT.TRENDLINE_HISTORY, false);
          var orderBlockPreset = optionInput(input, INPUT.ORDER_BLOCK_PRESET, ["Macro", "Big", "Medium", "Small"], "Macro");
          var breakerBlock = boolInput(input, INPUT.BREAKER_BLOCK, false);
          var rmiLength = Math.max(1, Math.round(numberInput(input, INPUT.RMI_LENGTH, 14)));
          var positiveThreshold = numberInput(input, INPUT.RMI_POSITIVE, 66);
          var negativeThreshold = numberInput(input, INPUT.RMI_NEGATIVE, 30);
          var showRmiMa = boolInput(input, INPUT.RMI_SHOW_MA, true);
          var rmiBullColor = textInput(input, INPUT.RMI_BULL_COLOR, "#00BCD4");
          var rmiBearColor = textInput(input, INPUT.RMI_BEAR_COLOR, "#FF5252");
          var capital = numberInput(input, INPUT.CAPITAL, 100000);
          var accountRisk = Math.min(5, numberInput(input, INPUT.ACCOUNT_RISK, 2));
          var stopLoss = numberInput(input, INPUT.STOP_LOSS, 3);
          var rrRatio = numberInput(input, INPUT.RR_RATIO, 2);

          var open = Std.open(context);
          var high = Std.high(context);
          var low = Std.low(context);
          var close = Std.close(context);
          var volume = Std.volume(context);
          var hl2 = (high + low) / 2;
          var hlc3 = (high + low + close) / 3;
          var symbol = context.symbol || {};
          var barClosed = symbol.isBarClosed !== false;

          var openSeries = context.new_var(open);
          var highSeries = context.new_var(high);
          var lowSeries = context.new_var(low);
          var closeSeries = context.new_var(close);
          var previousClose = closeSeries.get(1);
          var volumeSeries = context.new_var(volume);
          var hl2Series = context.new_var(hl2);

          /* Trend signal engine. */
          var sourceChange = finite(previousNumber(hl2Series, NaN))
            ? Math.abs(hl2 - hl2Series.get(1))
            : NaN;
          var sourceChangeSeries = context.new_var(sourceChange);
          // Pine ta.atr uses ta.tr(true): the first available candle contributes
          // high-low. Thndr's shipped Std.atr calls tr(undefined), losing it.
          var trueRangeSeries = context.new_var(finite(previousClose)
            ? Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose))
            : high - low);
          var averageRange27 = Std.sma(sourceChangeSeries, 27, context);
          var averageRange27Series = context.new_var(averageRange27);
          var averageRange55 = Std.sma(sourceChangeSeries, 55, context);
          var averageRange55Series = context.new_var(averageRange55);
          var atr20 = Std.rma(trueRangeSeries, 20, context);
          var smoothRange1 = Std.sma(averageRange27Series, 53, context) * 2.5 + atr20;
          var smoothRange2 = Std.sma(averageRange55Series, 109, context) * 1.5 + atr20;
          var smoothRange = (smoothRange1 + smoothRange2) / 2;

          var filterState = context.new_var(NaN);
          var previousFilter = filterState.get(1);
          var filter = NaN;
          if (finite(smoothRange)) {
            var priorFilter = finite(previousFilter) ? previousFilter : 0;
            if (hl2 > priorFilter) {
              filter = hl2 - smoothRange < priorFilter ? priorFilter : hl2 - smoothRange;
            } else {
              filter = hl2 + smoothRange > priorFilter ? priorFilter : hl2 + smoothRange;
            }
          }
          filterState.set(filter);
          var filterPrevious = filterState.get(1);
          var filterTwoBarsAgo = filterState.get(2);
          var filterRising = finite(filter) && finite(filterPrevious) && finite(filterTwoBarsAgo) &&
            filter > filterPrevious && filterPrevious > filterTwoBarsAgo;
          var filterFalling = finite(filter) && finite(filterPrevious) && finite(filterTwoBarsAgo) &&
            filter < filterPrevious && filterPrevious < filterTwoBarsAgo;
          var bullCondition = finite(filter) && finite(previousClose) &&
            hl2 > filter && hl2 > previousNumber(hl2Series, hl2) && filterRising;
          var bearCondition = finite(filter) && finite(previousClose) &&
            hl2 < filter && hl2 < previousNumber(hl2Series, hl2) && filterFalling;

          var lastConditionState = context.new_var(NaN);
          var lastCondition = previousNumber(lastConditionState, 0);
          if (bullCondition) {
            lastCondition = 1;
          } else if (bearCondition) {
            lastCondition = -1;
          }
          lastConditionState.set(lastCondition);

          var atr10 = Std.rma(trueRangeSeries, 10, context);
          var trendSensitivity = 0.5 + ((sensitivity * 10) - 1) * (4.5 / 33);
          var upRaw = finite(filter) && finite(atr10) ? filter - trendSensitivity * atr10 : NaN;
          var downRaw = finite(filter) && finite(atr10) ? filter + trendSensitivity * atr10 : NaN;
          var upFinalState = context.new_var(NaN);
          var downFinalState = context.new_var(NaN);
          var previousUpFinal = upFinalState.get(1);
          var previousDownFinal = downFinalState.get(1);
          // Pine's nz(previous, current) also applies on the first valid filter bar.
          var upThreshold = finite(previousUpFinal) ? previousUpFinal : upRaw;
          var downThreshold = finite(previousDownFinal) ? previousDownFinal : downRaw;
          var upFinal = upRaw;
          var downFinal = downRaw;
          if (finite(upRaw) && finite(previousUpFinal) && finite(previousClose) && previousClose > previousUpFinal) {
            upFinal = Math.max(upRaw, previousUpFinal);
          }
          if (finite(downRaw) && finite(previousDownFinal) && finite(previousClose) && previousClose < previousDownFinal) {
            downFinal = Math.min(downRaw, previousDownFinal);
          }
          upFinalState.set(upFinal);
          downFinalState.set(downFinal);

          var trendValueState = context.new_var(NaN);
          var previousTrendValue = Math.round(previousNumber(trendValueState, 1));
          var trendValue = previousTrendValue;
          if (previousTrendValue === -1 && finite(downThreshold) && close > downThreshold) {
            trendValue = 1;
          } else if (previousTrendValue === 1 && finite(upThreshold) && close < upThreshold) {
            trendValue = -1;
          }
          trendValueState.set(trendValue);

          var wma188 = pineWma(closeSeries, 188);
          var wma188Series = context.new_var(wma188);
          var wma188Half = pineWma(wma188Series, 2);
          var wma188Full = pineWma(wma188Series, 5);
          var hmaSource = finite(wma188Half) && finite(wma188Full)
            ? 2 * wma188Half - wma188Full
            : NaN;
          var hmaSourceSeries = context.new_var(hmaSource);
          var hma = pineWma(hmaSourceSeries, 2);
          var wmaState = finite(hma) && close > hma;
          var trendScore = trendValue === 1
            ? (wmaState ? 2 : 1)
            : (wmaState ? -1 : -2);
          var trendScoreSeries = context.new_var(trendScore);
          var previousTrendScore = trendScoreSeries.get(1);
          var buySignal = barClosed && finite(previousTrendScore) && trendScore > 0 && previousTrendScore <= 0;
          var sellSignal = barClosed && finite(previousTrendScore) && trendScore < 0 && previousTrendScore >= 0;
          var strongBuy = buySignal && trendScore === 2;
          var normalBuy = buySignal && trendScore === 1;
          var strongSell = sellSignal && trendScore === -2;
          var normalSell = sellSignal && trendScore === -1;

          var longTrendState = context.new_var(NaN);
          var shortTrendState = context.new_var(NaN);
          var longTrend = previousFlag(longTrendState, false);
          var shortTrend = previousFlag(shortTrendState, false);
          // Pine paints candles before it updates LongTrend for this bar's signal.
          var candleLongTrend = longTrend;
          if (buySignal) {
            longTrend = true;
            shortTrend = false;
          }
          if (sellSignal) {
            longTrend = false;
            shortTrend = true;
          }
          longTrendState.set(longTrend ? 1 : 0);
          shortTrendState.set(shortTrend ? 1 : 0);

          var atr30 = Std.rma(trueRangeSeries, 30, context);
          var targetAtrRaw = finite(atr30) ? Math.min(atr30 * 0.4, close * 0.004) : NaN;
          var targetAtrRawSeries = context.new_var(targetAtrRaw);
          var targetAtrLag = targetAtrRawSeries.get(20);
          var targetAtr = finite(targetAtrLag) ? targetAtrLag / 2 : NaN;
          var highest300 = pineExtreme(highSeries, 300, true);
          var lowest300 = pineExtreme(lowSeries, 300, false);
          var range300 = finite(highest300) && finite(lowest300) ? highest300 - lowest300 : NaN;
          var markerOffset = finite(range300) ? range300 * 0.18 : 0;
          var shortTargetOffset = finite(range300) ? range300 * 0.07 : 0;

          var entryState = context.new_var(NaN);
          var tp1State = context.new_var(NaN);
          var tp2State = context.new_var(NaN);
          var activeTp1State = context.new_var(NaN);
          var activeTp2State = context.new_var(NaN);
          var entry = previousNumber(entryState, NaN);
          var tp1 = previousNumber(tp1State, NaN);
          var tp2 = previousNumber(tp2State, NaN);
          var activeTp1 = previousFlag(activeTp1State, false);
          var activeTp2 = previousFlag(activeTp2State, false);
          var newLongTrend = longTrend && !previousFlag(longTrendState, false);
          var newShortTrend = shortTrend && !previousFlag(shortTrendState, false);
          if (newLongTrend) {
            entry = close;
            activeTp1 = true;
            activeTp2 = true;
            tp1 = finite(targetAtr) ? entry + targetAtr * 20 : NaN;
            tp2 = finite(targetAtr) ? entry + targetAtr * 50 : NaN;
          }
          if (newShortTrend) {
            entry = close;
            activeTp1 = true;
            activeTp2 = true;
            tp1 = finite(targetAtr) ? entry - targetAtr * 20 : NaN;
            tp2 = finite(targetAtr) ? entry - targetAtr * 50 : NaN;
          }

          var longTp1Marker = NaN;
          var longTp2Marker = NaN;
          var shortTp1Marker = NaN;
          var shortTp2Marker = NaN;
          if (longTrend && activeTp1 && showTargets && showTrendSignals && finite(tp1) && high > tp1) {
            longTp1Marker = high + (finite(targetAtr) ? targetAtr * 1.5 : 0);
            activeTp1 = false;
          }
          if (longTrend && activeTp2 && showTargets && showTrendSignals && finite(tp2) && high > tp2) {
            longTp2Marker = high + (finite(targetAtr) ? targetAtr * 1.5 : 0);
            activeTp2 = false;
          }
          if (shortTrend && activeTp1 && showTargets && showTrendSignals && finite(tp1) && low <= tp1) {
            shortTp1Marker = low - shortTargetOffset;
            activeTp1 = false;
          }
          if (shortTrend && activeTp2 && showTargets && showTrendSignals && finite(tp2) && low <= tp2) {
            shortTp2Marker = low - shortTargetOffset;
            activeTp2 = false;
          }
          entryState.set(entry);
          tp1State.set(tp1);
          tp2State.set(tp2);
          activeTp1State.set(activeTp1 ? 1 : 0);
          activeTp2State.set(activeTp2 ? 1 : 0);

          var atrSupertrend = atr10;
          var supertrendUpRaw = finite(atrSupertrend) ? hl2 - trailingMultiplier * atrSupertrend : NaN;
          var supertrendDownRaw = finite(atrSupertrend) ? hl2 + trailingMultiplier * atrSupertrend : NaN;
          var supertrendUpState = context.new_var(NaN);
          var supertrendDownState = context.new_var(NaN);
          var previousSupertrendUp = supertrendUpState.get(1);
          var previousSupertrendDown = supertrendDownState.get(1);
          var supertrendUp = supertrendUpRaw;
          var supertrendDown = supertrendDownRaw;
          if (finite(supertrendUpRaw) && finite(previousSupertrendUp) && finite(previousClose) && previousClose > previousSupertrendUp) {
            supertrendUp = Math.max(supertrendUpRaw, previousSupertrendUp);
          }
          if (finite(supertrendDownRaw) && finite(previousSupertrendDown) && finite(previousClose) && previousClose < previousSupertrendDown) {
            supertrendDown = Math.min(supertrendDownRaw, previousSupertrendDown);
          }
          supertrendUpState.set(supertrendUp);
          supertrendDownState.set(supertrendDown);
          var trailingTrendState = context.new_var(NaN);
          var trailingTrend = Math.round(previousNumber(trailingTrendState, 1));
          if (trailingOn) {
            if (trailingTrend === -1 && buySignal) {
              trailingTrend = 1;
            } else if (trailingTrend === 1 && finite(previousSupertrendUp) && close < previousSupertrendUp) {
              trailingTrend = -1;
            }
          } else {
            trailingTrend = NaN;
          }
          trailingTrendState.set(trailingTrend);

          /* Opening range breakout. */
          var minuteOfDay = utcMinuteOfDay(symbol.time, parseUtcOffset(utcOffset));
          var inSession = enableOrb && inMinuteSession(minuteOfDay, sessionStart, sessionEnd);
          var inSessionState = context.new_var(inSession ? 1 : 0);
          var wasInSession = previousFlag(inSessionState, false);
          var firstSessionBar = inSession && !wasInSession;
          var orbHighState = context.new_var(NaN);
          var orbLowState = context.new_var(NaN);
          var previousOrbHigh = orbHighState.get(1);
          var previousOrbLow = orbLowState.get(1);
          var orbHigh = previousOrbHigh;
          var orbLow = previousOrbLow;
          if (firstSessionBar) {
            orbHigh = high;
            orbLow = low;
          } else if (inSession) {
            orbHigh = finite(previousOrbHigh) ? Math.max(previousOrbHigh, high) : high;
            orbLow = finite(previousOrbLow) ? Math.min(previousOrbLow, low) : low;
          }
          orbHighState.set(orbHigh);
          orbLowState.set(orbLow);
          var orbMid = finite(orbHigh) && finite(orbLow) ? (orbHigh + orbLow) / 2 : NaN;
          var orbHighStable = finite(previousOrbHigh) && finite(orbHigh) && previousOrbHigh === orbHigh;
          var orbLowStable = finite(previousOrbLow) && finite(orbLow) && previousOrbLow === orbLow;
          var sameUpState = context.new_var(NaN);
          var sameDownState = context.new_var(NaN);
          var sameUp = previousFlag(sameUpState, false) && orbHighStable;
          var sameDown = previousFlag(sameDownState, false) && orbLowStable;
          var orbUp = barClosed && enableOrb && !sameUp && finite(previousClose) &&
            finite(previousOrbHigh) && finite(orbHigh) && close > orbHigh && previousClose <= previousOrbHigh;
          var orbDown = barClosed && enableOrb && !sameDown && finite(previousClose) &&
            finite(previousOrbLow) && finite(orbLow) && close < orbLow && previousClose >= previousOrbLow;
          if (orbUp) {
            sameUp = true;
          }
          if (orbDown) {
            sameDown = true;
          }
          sameUpState.set(sameUp && orbHighStable ? 1 : 0);
          sameDownState.set(sameDown && orbLowStable ? 1 : 0);

          /* RMI trend. */
          var priceChange = finite(previousClose) ? close - previousClose : NaN;
          var upwardSeries = context.new_var(finite(priceChange) ? Math.max(priceChange, 0) : NaN);
          var downwardSeries = context.new_var(finite(priceChange) ? Math.max(-priceChange, 0) : NaN);
          var upwardRma = Std.rma(upwardSeries, rmiLength, context);
          var downwardRma = Std.rma(downwardSeries, rmiLength, context);
          var rsi = downwardRma === 0
            ? 100
            : upwardRma === 0
              ? 0
              : 100 - 100 / (1 + upwardRma / downwardRma);
          var typicalSeries = context.new_var(hlc3);
          var previousTypical = typicalSeries.get(1);
          var moneyFlow = finite(volume) ? hlc3 * volume : NaN;
          var positiveFlowSeries = context.new_var(finite(previousTypical) && hlc3 > previousTypical ? moneyFlow : 0);
          var negativeFlowSeries = context.new_var(finite(previousTypical) && hlc3 < previousTypical ? moneyFlow : 0);
          var positiveFlow = Std.sum(positiveFlowSeries, rmiLength, context);
          var negativeFlow = Std.sum(negativeFlowSeries, rmiLength, context);
          var mfi = positiveFlow === 0 && negativeFlow === 0
            ? NaN
            : negativeFlow === 0
              ? 100
              : positiveFlow === 0
                ? 0
                : 100 - 100 / (1 + positiveFlow / negativeFlow);
          var rmi = finite(rsi) && finite(mfi) ? (rsi + mfi) / 2 : NaN;
          var rmiSeries = context.new_var(rmi);
          var previousRmi = rmiSeries.get(1);
          var ema5 = pineEma(close, 5, context);
          var ema5Series = context.new_var(ema5);
          var previousEma5 = ema5Series.get(1);
          var positiveMomentum = finite(previousRmi) && finite(rmi) && previousRmi < positiveThreshold &&
            rmi > positiveThreshold && rmi > negativeThreshold && finite(previousEma5) && ema5 > previousEma5;
          var negativeMomentum = finite(rmi) && rmi < negativeThreshold &&
            finite(previousEma5) && ema5 < previousEma5;
          var positiveState = context.new_var(NaN);
          var negativeState = context.new_var(NaN);
          var previousPositive = previousFlag(positiveState, false);
          var previousNegative = previousFlag(negativeState, false);
          var positive = previousPositive;
          var negative = previousNegative;
          if (positiveMomentum && enableRmi) {
            positive = true;
            negative = false;
          }
          if (negativeMomentum && enableRmi) {
            positive = false;
            negative = true;
          }
          positiveState.set(positive ? 1 : 0);
          negativeState.set(negative ? 1 : 0);

          var barRangeSeries = context.new_var(high - low);
          var rangeSum = Std.sum(barRangeSeries, 20, context);
          var weight = finite(rangeSum) && rangeSum !== 0 ? (high - low) / rangeSum : NaN;
          var weightedCloseSeries = context.new_var(finite(weight) ? close * weight : NaN);
          var weightSeries = context.new_var(weight);
          var weightedCloseSum = Std.sum(weightedCloseSeries, 20, context);
          var weightSum = Std.sum(weightSeries, 20, context);
          var rwma = finite(weightedCloseSum) && finite(weightSum) && weightSum !== 0
            ? weightedCloseSum / weightSum
            : NaN;
          var bandRaw = finite(atr30) ? Math.min(atr30 * 0.3, close * 0.003) : NaN;
          var bandRawSeries = context.new_var(bandRaw);
          var bandLag = bandRawSeries.get(20);
          var band = finite(bandLag) ? bandLag * 4 : NaN;
          var rmiCenter = positive
            ? (finite(rwma) && finite(band) ? rwma - band : NaN)
            : negative
              ? (finite(rwma) && finite(band) ? rwma + band : NaN)
              : NaN;
          var rmiTop = finite(rmiCenter) && finite(band) ? rmiCenter + band : NaN;
          var rmiBottom = finite(rmiCenter) && finite(band) ? rmiCenter - band : NaN;
          var rmiColorIndex = positive ? 0 : 1;
          var positiveFlip = positive && !previousPositive;
          var negativeFlip = negative && !previousNegative;

          var settings = {
            modules: {
              trendSignals: showTrendSignals,
              liquidity: showLiquidity,
              orb: enableOrb,
              trendLines: showTrendLines,
              capitalRisk: showCapitalRisk,
              rmiTrend: enableRmi,
              orderBlocks: showOrderBlocks
            },
            trendSignals: {
              sensitivity: sensitivity,
              showTargets: showTargets,
              trendCandles: trendCandles,
              trailingTp: trailingOn,
              trailingMultiplier: trailingMultiplier
            },
            liquidity: { period: liquidityPeriod, max: maxLiquidity, right: liquidityRight },
            orb: {
              utcOffset: utcOffset,
              startHour: Math.floor(sessionStart / 60),
              startMinute: sessionStart % 60,
              endHour: Math.floor(sessionEnd / 60),
              endMinute: sessionEnd % 60,
              showSignals: showOrbSignals
            },
            trendLines: {
              preset: trendlinePreset,
              color: trendlineColor,
              last: trendlineLast,
              history: trendlineHistory
            },
            capitalRisk: {
              capital: capital,
              accountRiskPercent: accountRisk,
              stopLossPercent: stopLoss,
              rrRatio: rrRatio,
              riskPerTrade: capital * (accountRisk / 100),
              profitPerTrade: capital * (accountRisk / 100) * rrRatio,
              tradeCapital: capital * (accountRisk / 100) / (stopLoss / 100)
            },
            rmi: {
              length: rmiLength,
              positiveAbove: positiveThreshold,
              negativeBelow: negativeThreshold,
              showMa: showRmiMa,
              bullColor: rmiBullColor,
              bearColor: rmiBearColor
            },
            orderBlocks: {
              preset: orderBlockPreset,
              breakerBlock: breakerBlock,
              minTick: finite(symbol.minTick)
                ? symbol.minTick
                : finite(symbol.minmov) && finite(symbol.pricescale) && symbol.pricescale !== 0
                  ? symbol.minmov / symbol.pricescale
                  : 0.01
            }
          };

          var liquidityOutput = new Array(NATIVE_LIQUIDITY_PLOTS).fill(NaN);
          if (!headless || nativeLiquidity || drawingObjects) {
            var history = rememberBar(this, normalizeBar(context, open, high, low, close, volume),
              drawingObjects && !nativeLiquidity);
            if (nativeLiquidity) liquidityOutput = nativeLiquidityOutput(this, history, settings);
          }
          this.alertSnapshot = null;
          this.alertPreviousClose = previousClose;
          if (!headless || drawingObjects) {
            var renderer = root && root.__THNDR_ALPHA_RENDERER__;
            if (drawingOrderBlocks && !orderBlockReplay && renderer && renderer.createOrderBlockReplay) {
              orderBlockReplay = renderer.createOrderBlockReplay();
            }
            var closingObservedBar = !symbol.isLastBar && barClosed && finite(symbol.time) && symbol.time === lastDrawingBarTime;
            if (symbol.isLastBar) lastDrawingBarTime = symbol.time;
            else if (!closingObservedBar) lastDrawingBarTime = undefined;
            this.alertSnapshot = publishSnapshot(context, history, settings, {
              nativeLiquidity: nativeLiquidity,
              longTrend: longTrend,
              shortTrend: shortTrend,
              trendScore: trendScore,
              orbHigh: finite(orbHigh) ? orbHigh : null,
              orbLow: finite(orbLow) ? orbLow : null,
              rmiPositive: positive,
              rmiNegative: negative
            }, drawingSourceId, sourceContext, studyName, orderBlockReplay, drawingInstanceToken, closingObservedBar);
          }

          var output = new Array(OUTPUT.ORDER_BLOCKS_ANCHOR + 1).fill(NaN);
          output[OUTPUT.TRAILING] = trailingOn && trailingTrend === 1 ? supertrendUp : NaN;
          output[OUTPUT.NORMAL_BUY] = showTrendSignals && normalBuy ? low - markerOffset : NaN;
          output[OUTPUT.STRONG_BUY] = showTrendSignals && strongBuy ? low - markerOffset : NaN;
          output[OUTPUT.NORMAL_SELL] = showTrendSignals && normalSell ? high + markerOffset : NaN;
          output[OUTPUT.STRONG_SELL] = showTrendSignals && strongSell ? high + markerOffset : NaN;
          output[OUTPUT.LONG_TP1] = longTp1Marker;
          output[OUTPUT.LONG_TP2] = longTp2Marker;
          output[OUTPUT.SHORT_TP1] = shortTp1Marker;
          output[OUTPUT.SHORT_TP2] = shortTp2Marker;
          output[OUTPUT.ORB_HIGH] = enableOrb && orbHighStable ? orbHigh : NaN;
          output[OUTPUT.ORB_LOW] = enableOrb && orbLowStable ? orbLow : NaN;
          output[OUTPUT.ORB_MID] = enableOrb ? orbMid : NaN;
          output[OUTPUT.ORB_BUY] = showOrbSignals && orbUp ? 1 : NaN;
          output[OUTPUT.ORB_SELL] = showOrbSignals && orbDown ? 1 : NaN;
          output[OUTPUT.RMI_CENTER] = enableRmi && showRmiMa ? rmiCenter : NaN;
          output[OUTPUT.RMI_CENTER_COLOR] = rmiColorIndex;
          output[OUTPUT.RMI_GLOW_1] = NaN;
          output[OUTPUT.RMI_GLOW_1_COLOR] = rmiColorIndex;
          output[OUTPUT.RMI_GLOW_2] = NaN;
          output[OUTPUT.RMI_GLOW_2_COLOR] = rmiColorIndex;
          output[OUTPUT.RMI_GLOW_3] = NaN;
          output[OUTPUT.RMI_GLOW_3_COLOR] = rmiColorIndex;
          output[OUTPUT.RMI_TOP] = NaN;
          output[OUTPUT.RMI_BOTTOM] = NaN;
          output[OUTPUT.RMI_POSITIVE_FLIP] = enableRmi && positiveFlip ? rmiBottom - (finite(band) ? band / 2 : 0) : NaN;
          output[OUTPUT.RMI_NEGATIVE_FLIP] = enableRmi && negativeFlip ? rmiTop + (finite(band) ? band / 2 : 0) : NaN;
          output[OUTPUT.BAR_COLOR] = resolveBarColorIndex(trendCandles, candleLongTrend, enableRmi, positive);
          output[OUTPUT.SESSION_BACKGROUND] = inSession ? 0 : NaN;
          output[OUTPUT.ORB_MID_COLOR] = enableOrb && finite(orbMid) &&
            orbMid === (previousOrbHigh + previousOrbLow) / 2 ? 0 : NaN;
          output[OUTPUT.ORB_UPPER_TOP] = enableOrb ? orbHigh : NaN;
          output[OUTPUT.ORB_UPPER_BOTTOM] = enableOrb ? orbMid : NaN;
          output[OUTPUT.ORB_LOWER_TOP] = enableOrb ? orbMid : NaN;
          output[OUTPUT.ORB_LOWER_BOTTOM] = enableOrb ? orbLow : NaN;

          for (var liquidityIndex = 0; liquidityIndex < liquidityOutput.length; liquidityIndex += 1) {
            output[OUTPUT.LIQUIDITY_START + liquidityIndex] = liquidityOutput[liquidityIndex];
          }

          // Pine alertcondition is independent of its plot visibility controls.
          // The standalone wrapper handles opt-in delivery, frequency and UI.
          this.alertConditions = {
            trendBuy: showTrendSignals && normalBuy,
            trendStrongBuy: showTrendSignals && strongBuy,
            trendSell: showTrendSignals && normalSell,
            trendStrongSell: showTrendSignals && strongSell,
            orbBuy: enableOrb && orbUp,
            orbSell: enableOrb && orbDown,
            rmiBuy: enableRmi && positiveFlip,
            rmiSell: enableRmi && negativeFlip
          };
          return output;
        };
      }
    };
  }

  return Object.freeze({
    STUDY_ID: STUDY_ID,
    STUDY_NAME: STUDY_NAME,
    INPUT: INPUT,
    OUTPUT: OUTPUT,
    MAX_HISTORY: MAX_HISTORY,
    NATIVE_LIQUIDITY_SLOTS: NATIVE_LIQUIDITY_SLOTS,
    NATIVE_LIQUIDITY_PLOTS: NATIVE_LIQUIDITY_PLOTS,
    buildMetainfo: buildMetainfo,
    createAlphaStudy: createAlphaStudy,
    parseUtcOffset: parseUtcOffset,
    utcMinuteOfDay: utcMinuteOfDay,
    inMinuteSession: inMinuteSession,
    optionInput: optionInput,
    resolveBarColorIndex: resolveBarColorIndex
  });
});
