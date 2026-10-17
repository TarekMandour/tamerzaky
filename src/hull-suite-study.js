/*
 * Hull Suite Strategy custom study for Thndr's TradingView chart.
 * Implements the user-provided Pine v4 HMA formula and long-only behavior.
 */
(function registerHullSuiteStudy(root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.__THNDR_HULL_SUITE_STUDY__ = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildHullSuiteStudy() {
  "use strict";

  var STUDY_ID = "Hull Suite Strategy@tv-basicstudies-1";
  var STUDY_NAME = "Hull Suite Strategy";

  function finite(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  // Matches Pine's WMA weighting: newest value gets the largest weight.
  function wma(series, length) {
    var weighted = 0;
    for (var offset = 0; offset < length; offset += 1) {
      var value = series.get(offset);
      if (!finite(value)) return NaN;
      weighted += value * (length - offset);
    }
    return weighted / (length * (length + 1) / 2);
  }

  function buildMetainfo() {
    return {
      _metainfoVersion: 53,
      id: STUDY_ID,
      name: STUDY_NAME,
      description: "Hull Suite Strategy — HMA 55, long only",
      shortDescription: "Hull Suite Strategy",
      isCustomIndicator: true,
      is_price_study: true,
      linkedToSeries: true,
      format: { type: "inherit" },
      plots: [
        { id: "hull", type: "line" },
        { id: "hullLag", type: "line" },
        { id: "hullColor", type: "colorer", target: "hull", palette: "hullTrend" },
        { id: "hullLagColor", type: "colorer", target: "hullLag", palette: "hullTrend" },
        { id: "buySignal", type: "shapes" },
        { id: "exitSignal", type: "shapes" },
        { id: "barColor", type: "bar_colorer", palette: "hullTrend" }
      ],
      styles: {
        hull: { title: "MHULL", histogramBase: 0, joinPoints: false },
        hullLag: { title: "SHULL (HULL[2])", histogramBase: 0, joinPoints: false },
        hullColor: { title: "Hull Trend Color" },
        hullLagColor: { title: "Hull Band Trend Color" },
        buySignal: { title: "BUY" },
        exitSignal: { title: "EXIT LONG" },
        barColor: { title: "Hull Trend Candles" }
      },
      palettes: {
        hullTrend: {
          colors: {
            0: { name: "Rising", color: "#00FF00" },
            1: { name: "Falling", color: "#FF0000" },
            2: { name: "Neutral", color: "#FF9800" }
          }
        }
      },
      filledAreas: [
        { id: "hullBand", objAId: "hull", objBId: "hullLag", type: "plot_plot", title: "Hull Band" }
      ],
      defaults: {
        styles: {
          hull: { color: "#00FF00", linestyle: 0, linewidth: 1, plottype: 7, trackPrice: false, transparency: 0, visible: true },
          hullLag: { color: "#00FF00", linestyle: 0, linewidth: 1, plottype: 7, trackPrice: false, transparency: 0, visible: true },
          hullColor: { visible: false },
          hullLagColor: { visible: false },
          buySignal: { plottype: "shape_label_up", location: "BelowBar", color: "#00C853", text: "BUY", textColor: "#FFFFFF", transparency: 0, visible: true, size: "normal" },
          exitSignal: { plottype: "shape_label_down", location: "AboveBar", color: "#FF1744", text: "EXIT", textColor: "#FFFFFF", transparency: 0, visible: true, size: "normal" },
          barColor: { visible: true }
        },
        palettes: {
          hullTrend: {
            colors: {
              0: { color: "#00FF00", width: 1, style: 0 },
              1: { color: "#FF0000", width: 1, style: 0 },
              2: { color: "#FF9800", width: 1, style: 0 }
            }
          }
        },
        filledAreasStyle: {
          hullBand: {
            fillType: "solid",
            color: "#00FF00",
            transparency: 40,
            visible: true
          }
        },
        inputs: {
          length: 55,
          colorHull: true,
          colorCandles: false,
          showBand: true,
        }
      },
      inputs: [
        { id: "length", name: "Length", type: "integer", defval: 55, min: 1, max: 500 },
        { id: "colorHull", name: "Color Hull according to trend", type: "bool", defval: true },
        { id: "colorCandles", name: "Color candles based on Hull trend", type: "bool", defval: false },
        { id: "showBand", name: "Show as a Band", type: "bool", defval: true },
      ]
    };
  }

  function createStudy(PineJS) {
    return {
      name: STUDY_NAME,
      metainfo: buildMetainfo(),
      constructor: function HullSuiteStrategyConstructor() {
        this.main = function main(context, input) {
          var close = Number(PineJS.Std.close(context));
          if (!Number.isFinite(close)) return [NaN, NaN, NaN, NaN, NaN, NaN, NaN];

          var length = Math.max(1, Math.min(500, Math.floor(Number(input(0)) || 55)));
          var colorHull = input(1) !== false;
          var colorCandles = input(2) === true;
          var showBand = input(3) !== false;
          var lineThickness = Math.max(1, Math.min(4, Math.floor(Number(input(4)) || 1)));
          var bandTransparency = Math.max(0, Math.min(100, Math.floor(Number(input(5)) || 0)));

          // These context variables are replay-safe and keep each study instance independent.
          var source = context.new_var(NaN);
          var rawHull = context.new_var(NaN);
          var hullSeries = context.new_var(NaN);
          var position = context.new_var(0);

          source.set(close);
          var halfLength = Math.max(1, Math.floor(length / 2));
          var rootLength = Math.max(1, Math.round(Math.sqrt(length)));
          var halfWma = wma(source, halfLength);
          var fullWma = wma(source, length);
          var raw = finite(halfWma) && finite(fullWma) ? 2 * halfWma - fullWma : NaN;
          rawHull.set(raw);
          var hull = wma(rawHull, rootLength);

          // Read history before writing this bar, so [2] means exactly two bars ago.
          var hullTwoBarsAgo = hullSeries.get(2);
          var priorPosition = position.get(1);
          if (!finite(priorPosition)) priorPosition = 0;

          var symbol = context.symbol || {};
          var isLastBar = symbol.isLastBar === true;
          var barClosed = !isLastBar || symbol.isBarClosed === true;
          var rising = finite(hull) && finite(hullTwoBarsAgo) && hull > hullTwoBarsAgo;
          var falling = finite(hull) && finite(hullTwoBarsAgo) && hull < hullTwoBarsAgo;
          var buy = NaN;
          var exit = NaN;
          var nextPosition = priorPosition;

          // The source strategy uses allow_entry_in(long). A short entry therefore
          // closes an existing long but cannot establish a short position.
          // Signals are only committed when the bar is confirmed closed.
          if (barClosed) {
            var timeValue = NaN;
            try {
              if (PineJS.Std && typeof PineJS.Std.time === "function") timeValue = Number(PineJS.Std.time(context));
            } catch (_) {}
            if (!finite(timeValue)) timeValue = Number(symbol.time);
            if (timeValue > 1e12) timeValue /= 1000;

            // Source script's default test window: 2016-01-01 through 2030-12-30.
            var inTestWindow = !finite(timeValue) ||
              (timeValue >= Date.UTC(2016, 0, 1) / 1000 && timeValue <= Date.UTC(2030, 11, 30, 23, 59, 59) / 1000);

            if (inTestWindow && rising && priorPosition !== 1) {
              buy = close;
              nextPosition = 1;
            } else if (inTestWindow && falling && priorPosition === 1) {
              exit = close;
              nextPosition = 0;
            }
          }

          var trendColor = !colorHull ? 2 : rising ? 0 : falling ? 1 : 2;
          hullSeries.set(hull);
          position.set(nextPosition);

          // These values control the native study presentation; line width and
          // transparency are fixed by defaults in the current chart renderer.
          var mainLine = hull;
          var shiftedLine = showBand ? hullTwoBarsAgo : NaN;
          var candleTrend = colorCandles ? trendColor : NaN;

          return [mainLine, shiftedLine, trendColor, trendColor,
            buy, exit, candleTrend];
        };
      }
    };
  }

  return Object.freeze({
    STUDY_ID: STUDY_ID,
    STUDY_NAME: STUDY_NAME,
    buildMetainfo: buildMetainfo,
    createStudy: createStudy
  });
});
