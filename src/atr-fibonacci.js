// Adapted from ATR Fibonacci Trend Envelopes [BigBeluga].
// This work is licensed under Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International.
// https://creativecommons.org/licenses/by-nc-sa/4.0/
// © BigBeluga
(function installAtrFibonacci(root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.__THNDR_ATR_FIBONACCI__ = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildAtrFibonacci() {
  "use strict";

  var DEFAULTS = Object.freeze({ maType: "RMA", maLength: 100, atrLength: 100, atrMult: 3 });
  var MA_TYPES = Object.freeze(["SMA", "EMA", "WMA", "HMA", "RMA"]);

  function finite(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function normalizeSettings(options) {
    options = options || {};
    var settings = {};
    Object.keys(DEFAULTS).forEach(function (name) {
      settings[name] = options[name] === undefined ? DEFAULTS[name] : options[name];
    });
    // The source's get_ma() default switch arm is SMA.
    if (MA_TYPES.indexOf(settings.maType) < 0) settings.maType = "SMA";
    ["maLength", "atrLength"].forEach(function (name) {
      if (!Number.isSafeInteger(settings[name]) || settings[name] < 1) {
        throw new RangeError(name + " must be a positive integer");
      }
    });
    if (!finite(settings.atrMult)) throw new RangeError("atrMult must be finite");
    return Object.freeze(settings);
  }

  // Every average keeps scalar checkpoints and, for finite-window averages,
  // the observed finite values. A new bar/tick is O(1); rewind never reseeds a
  // recursive average from a sliding history window.
  function average(type, length) {
    if (type === "HMA") {
      var half = average("WMA", Math.max(1, Math.floor(length / 2)));
      var full = average("WMA", length);
      var root = average("WMA", Math.max(1, Math.round(Math.sqrt(length))));
      return {
        append: function (value) {
          return root.append(2 * half.append(value) - full.append(value));
        },
        rewind: function (count) {
          half.rewind(count);
          full.rewind(count);
          root.rewind(count);
        }
      };
    }
    var history = [], observations = [];
    var empty = { count: 0, sum: 0, weighted: 0, value: NaN };
    var alpha = type === "EMA" ? 2 / (length + 1) : 1 / length;
    var denominator = length * (length + 1) / 2;
    return {
      append: function (value) {
        var previous = history.length ? history[history.length - 1] : empty;
        var state = { count: previous.count, sum: previous.sum, weighted: previous.weighted, value: previous.value };
        if (finite(value)) {
          state.count += 1;
          if (type === "EMA" || type === "RMA") {
            if (finite(previous.value)) {
              state.value = alpha * value + (1 - alpha) * previous.value;
            } else if (type === "EMA") {
              state.value = value;
            } else {
              state.sum += value;
              if (state.count >= length) state.value = state.sum / length;
            }
          } else {
            observations.push(value);
            if (state.count <= length) {
              state.sum += value;
              state.weighted += state.count * value;
            } else {
              state.weighted = previous.weighted - previous.sum + length * value;
              state.sum = previous.sum + value - observations[state.count - length - 1];
            }
            state.value = state.count < length ? NaN :
              type === "WMA" ? state.weighted / denominator : state.sum / length;
          }
        }
        history.push(state);
        return state.value;
      },
      rewind: function (count) {
        history.length = count;
        if (type !== "EMA" && type !== "RMA") {
          observations.length = count ? history[count - 1].count : 0;
        }
      }
    };
  }

  function createEngine(options) {
    var settings = normalizeSettings(options);
    var baseline = average(settings.maType, settings.maLength);
    var trueRangeAverage = average("RMA", settings.atrLength);
    var outputs = [];

    function rewind(count) {
      outputs.length = count;
      baseline.rewind(count);
      trueRangeAverage.rewind(count);
    }

    function update(bar) {
      if (!bar || !finite(bar.time)) throw new TypeError("bar.time must be finite");
      var count = outputs.length;
      if (count && bar.time <= outputs[count - 1].time) {
        // Pine rolls all var/series state back before each update of the open
        // bar. A replay of an older timestamp also discards its stale suffix.
        var low = 0, high = count;
        while (low < high) {
          var middle = Math.floor((low + high) / 2);
          if (outputs[middle].time < bar.time) low = middle + 1;
          else high = middle;
        }
        rewind(low);
        count = low;
      }
      var previous = count ? outputs[count - 1] : null;
      var close = finite(bar.close) ? bar.close : NaN;
      var previousClose = previous ? previous.close : NaN;
      var trueRange = finite(bar.high) && finite(bar.low) ? bar.high - bar.low : NaN;
      if (finite(trueRange) && finite(previousClose)) {
        trueRange = Math.max(trueRange, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
      }
      var basis = baseline.append(close);
      var atr = trueRangeAverage.append(trueRange);
      var upperBand = basis + atr * settings.atrMult;
      var lowerBand = basis - atr * settings.atrMult;
      var trend = previous ? previous.trend : 0;
      if (previous && close > upperBand && previousClose <= previous.upperBand) trend = 1;
      else if (previous && close < lowerBand && previousClose >= previous.lowerBand) trend = -1;

      var span = upperBand - lowerBand;
      var level100 = trend === 1 ? lowerBand : upperBand;
      var fib50 = trend === 1 ? lowerBand + span * (1 - 0.5) : upperBand - span * (1 - 0.5);
      var fib618 = trend === 1 ? lowerBand + span * (1 - 0.618) : upperBand - span * (1 - 0.618);
      var fib786 = trend === 1 ? lowerBand + span * (1 - 0.786) : upperBand - span * (1 - 0.786);
      var maxDist = span * 0.5;
      // Pine division by zero is na, including nonzero / 0; do not turn it
      // into an opaque or arbitrarily capped pocket on zero-ATR bars.
      var rawTransparency = maxDist === 0 ? NaN : 65 + Math.abs(close - (fib618 + fib786) / 2) / maxDist * 30 * 0.6;
      var fourAgo = count >= 4 ? outputs[count - 4] : null;
      var slopes = Object.freeze({
        level100: fourAgo ? (level100 - fourAgo.level100) / 4 : NaN,
        fib50: fourAgo ? (fib50 - fourAgo.fib50) / 4 : NaN,
        fib618: fourAgo ? (fib618 - fourAgo.fib618) / 4 : NaN,
        fib786: fourAgo ? (fib786 - fourAgo.fib786) / 4 : NaN
      });
      var output = Object.freeze({
        time: bar.time, close: close, basis: basis, atr: atr,
        upperBand: upperBand, lowerBand: lowerBand, trend: trend,
        inPocket: close <= Math.max(fib618, fib786) && close >= Math.min(fib618, fib786),
        trendChange: !!previous && trend !== previous.trend,
        level100: level100, fib50: fib50, fib618: fib618, fib786: fib786,
        transparency: Math.max(0, Math.min(90, rawTransparency)), slopes: slopes
      });
      outputs.push(output);
      return output;
    }

    return Object.freeze({ settings: settings, update: update, reset: function () { rewind(0); } });
  }

  return Object.freeze({ DEFAULTS: DEFAULTS, MA_TYPES: MA_TYPES, normalizeSettings: normalizeSettings, createEngine: createEngine });
});
