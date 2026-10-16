/*
 * Alpha by Tamer Zaky - drawing model and renderer helpers.
 *
 * The calculations in this file are derived from the user-supplied Pine v6
 * source (MPL-2.0, original copyright TZack88).  The model is deliberately
 * independent from the DOM and TradingView so it can be replayed and tested.
 */
(function installAlphaRenderer(root, factory) {
  const api = factory(root);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.__THNDR_ALPHA_RENDERER__ = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createAlphaRenderer(root) {
  "use strict";

  const OWNER = "alpha";
  const INSTANCE_INPUT = "__tz_instance";
  const COORDINATOR = "__thndrTamerDrawingCoordinatorV1";
  const delegatedRenderers = new Map();
  const INSTANCE_STUDIES = new Set(["Liquidity - [Tamer Zaky]", "Order Blocks - [Tamer Zaky]",
    "AI Support & Resistance - [Tamer Zaky]", "EGX Activity - [Tamer Zaky]", "ATR Fibonacci Trend"]);
  const instanceBindings = new WeakMap();
  const bindingWrites = new WeakSet();
  const instancePrefix = Date.now().toString(36) + ":" + Math.random().toString(36).slice(2);
  let instanceSequence = 0;
  const MODEL_VERSION = 1;
  const ALPHA_ID = /^alpha:/;

  const DEFAULT_SETTINGS = Object.freeze({
    liquidity: Object.freeze({
      enabled: false,
      period: 10,
      max: 5,
      right: 5,
    }),
    trendLines: Object.freeze({
      enabled: false,
      preset: "Medium",
      color: "#b2b5be80",
      last: 2,
      history: false,
    }),
    orderBlocks: Object.freeze({
      enabled: false,
      preset: "Macro",
      breaker: false,
      amount: 10,
      minTick: 0.01,
    }),
    capitalRisk: Object.freeze({
      enabled: false,
      capital: 100000,
      riskPercent: 2,
      stopLossPercent: 3,
      rr: 2,
      currency: "EGP",
    }),
  });

  const PRESET_PERIODS = Object.freeze({
    Small: 10,
    Medium: 15,
    Big: 20,
    Macro: 30,
  });

  const ORDER_BLOCK_DEPTHS = Object.freeze({
    Small: 5,
    Medium: 10,
    Big: 25,
    Macro: 50,
  });

  const widgetRegistrations = new Set();
  // Widgets can initially expose the same chart and later select different
  // charts. Track each widget, but share native drawing ownership by chart.
  const sharedChartStates = new WeakMap();
  const retiredSources = new Set();
  const publishedSnapshots = new Map();
  const chartIndicatorVisibility = new WeakMap();
  // Deletion outlives the display registry: replacing a model or losing an
  // owner must not discard an entity whose native removal failed.
  const deletionLedger = new WeakMap();
  const pendingDeletions = new Set();
  let deletionTimer = null;
  const legacyMigrationStatus = { removed: 0, error: null };
  const LEGACY_BACKUP_KEY = "__thndr_tamer_legacy_drawings_backup_v1__";

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clampInteger(value, minimum, maximum, fallback) {
    const parsed = Math.trunc(finite(value, fallback));
    return Math.min(maximum, Math.max(minimum, parsed));
  }

  function firstDefined() {
    for (let index = 0; index < arguments.length; index += 1) {
      if (arguments[index] !== undefined && arguments[index] !== null) {
        return arguments[index];
      }
    }
    return undefined;
  }

  function moduleSetting(settings, key, aliases, defaults) {
    const nested = settings && typeof settings[key] === "object" ? settings[key] : {};
    const enabled = firstDefined(
      nested.enabled,
      settings && settings.modules && settings.modules[key],
      ...aliases.map((alias) => settings && settings[alias]),
      defaults.enabled,
    );
    return { nested, enabled: Boolean(enabled) };
  }

  function normalizeSettings(rawSettings) {
    const settings = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
    const liq = moduleSetting(settings, "liquidity", ["ShowLiquidity", "showLiquidity"], DEFAULT_SETTINGS.liquidity);
    const trends = moduleSetting(settings, "trendLines", ["Trendline", "trendline"], DEFAULT_SETTINGS.trendLines);
    const blocks = moduleSetting(settings, "orderBlocks", ["ModOB", "showOrderBlocks"], DEFAULT_SETTINGS.orderBlocks);
    const risk = moduleSetting(settings, "capitalRisk", ["ModRisk", "showCapitalRisk"], DEFAULT_SETTINGS.capitalRisk);

    const trendPreset = String(firstDefined(trends.nested.preset, settings.TLPreset, DEFAULT_SETTINGS.trendLines.preset));
    const blockPreset = String(firstDefined(blocks.nested.preset, settings.ob_preset, settings.obPreset, DEFAULT_SETTINGS.orderBlocks.preset));

    return {
      liquidity: {
        enabled: liq.enabled,
        period: clampInteger(firstDefined(liq.nested.period, settings.LiquidityPeriod), 3, Infinity, DEFAULT_SETTINGS.liquidity.period),
        max: clampInteger(firstDefined(liq.nested.max, settings.MaxLiq), 0, Infinity, DEFAULT_SETTINGS.liquidity.max),
        right: clampInteger(firstDefined(liq.nested.right, settings.Rigt), 0, Infinity, DEFAULT_SETTINGS.liquidity.right),
      },
      trendLines: {
        enabled: trends.enabled,
        preset: PRESET_PERIODS[trendPreset] ? trendPreset : DEFAULT_SETTINGS.trendLines.preset,
        color: String(firstDefined(trends.nested.color, settings.LineCol1, DEFAULT_SETTINGS.trendLines.color)),
        last: clampInteger(firstDefined(trends.nested.last, settings.LastNum), 1, 2, DEFAULT_SETTINGS.trendLines.last),
        history: Boolean(firstDefined(trends.nested.history, settings.showHistory, DEFAULT_SETTINGS.trendLines.history)),
      },
      orderBlocks: {
        enabled: blocks.enabled,
        preset: ORDER_BLOCK_DEPTHS[blockPreset] ? blockPreset : DEFAULT_SETTINGS.orderBlocks.preset,
        breaker: Boolean(firstDefined(blocks.nested.breaker, blocks.nested.breakerBlock, settings.breaker, DEFAULT_SETTINGS.orderBlocks.breaker)),
        amount: clampInteger(firstDefined(blocks.nested.amount, settings.amountOfBoxes), 1, 100, DEFAULT_SETTINGS.orderBlocks.amount),
        minTick: Math.max(Number.EPSILON, finite(firstDefined(blocks.nested.minTick, settings.minTick), DEFAULT_SETTINGS.orderBlocks.minTick)),
      },
      capitalRisk: {
        enabled: risk.enabled,
        capital: finite(firstDefined(risk.nested.capital, settings.Capital), DEFAULT_SETTINGS.capitalRisk.capital),
        riskPercent: finite(firstDefined(risk.nested.riskPercent, risk.nested.accountRiskPercent, settings.RiskPercent, settings.Risk), DEFAULT_SETTINGS.capitalRisk.riskPercent),
        stopLossPercent: finite(firstDefined(risk.nested.stopLossPercent, settings.StopLossPercent, settings.SL), DEFAULT_SETTINGS.capitalRisk.stopLossPercent),
        rr: finite(firstDefined(risk.nested.rr, risk.nested.rrRatio, settings.RR), DEFAULT_SETTINGS.capitalRisk.rr),
        currency: String(firstDefined(risk.nested.currency, settings.currency, DEFAULT_SETTINGS.capitalRisk.currency)),
      },
    };
  }

  function normalizeBars(rawBars) {
    if (!Array.isArray(rawBars)) return [];

    const normalized = rawBars
      .map((raw, sourceIndex) => {
        const bar = raw || {};
        const number = value => value === null || value === undefined || value === "" ? NaN : finite(value, NaN);
        const rawTime = number(firstDefined(bar.time, bar.timestamp));
        const time = rawTime > 100000000000 ? Math.floor(rawTime / 1000) : rawTime;
        const open = number(bar.open);
        const high = number(bar.high);
        const low = number(bar.low);
        const close = number(bar.close);
        const volume = Math.max(0, finite(bar.volume, 0));

        if (![time, open, high, low, close].every(Number.isFinite)) return null;
        return {
          time,
          open,
          high: Math.max(high, low),
          low: Math.min(high, low),
          close,
          volume,
          volumeAvailable: bar.volumeAvailable !== false && bar.volume !== null && bar.volume !== undefined && Number.isFinite(Number(bar.volume)),
          isBarClosed: bar.isBarClosed !== false,
          sourceIndex,
        };
      })
      .filter(Boolean);
    // A live candle can be revised many times. It is still one candle.
    const byTime = new Map(normalized.map(bar => [bar.time, bar]));
    return Array.from(byTime.values())
      .sort((a, b) => a.time - b.time)
      .map((bar, index) => ({ ...bar, index }));
  }

  function medianStep(bars) {
    const steps = [];
    for (let index = 1; index < bars.length; index += 1) {
      const step = bars[index].time - bars[index - 1].time;
      if (step > 0 && Number.isFinite(step)) steps.push(step);
    }
    if (!steps.length) return 1;
    steps.sort((a, b) => a - b);
    return steps[Math.floor(steps.length / 2)];
  }

  function latestStep(bars, index) {
    const end = index === undefined ? bars.length - 1 : index;
    if (end > 0) {
      const step = bars[end].time - bars[end - 1].time;
      if (step > 0 && Number.isFinite(step)) return step;
    }
    return medianStep(bars);
  }

  function trueRanges(bars) {
    return bars.map((bar, index) => {
      if (index === 0) return bar.high - bar.low;
      const previous = bars[index - 1].close;
      return Math.max(bar.high - bar.low, Math.abs(bar.high - previous), Math.abs(bar.low - previous));
    });
  }

  function rmaSeries(values, length) {
    const result = new Array(values.length).fill(null);
    if (length <= 0 || values.length < length) return result;

    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += values[index];
    result[length - 1] = sum / length;

    for (let index = length; index < values.length; index += 1) {
      result[index] = (result[index - 1] * (length - 1) + values[index]) / length;
    }
    return result;
  }

  function atrSeries(bars, length) {
    return rmaSeries(trueRanges(bars), length);
  }

  function simpleAverage(values, start, end) {
    if (end < start) return null;
    let total = 0;
    for (let index = start; index <= end; index += 1) total += values[index];
    return total / (end - start + 1);
  }

  function standardDeviation(values, start, end) {
    const average = simpleAverage(values, start, end);
    if (average === null) return null;
    let sum = 0;
    for (let index = start; index <= end; index += 1) {
      const delta = values[index] - average;
      sum += delta * delta;
    }
    return Math.sqrt(sum / (end - start + 1));
  }

  function isPivotHigh(bars, pivotIndex, left, right) {
    if (pivotIndex - left < 0 || pivotIndex + right >= bars.length) return false;
    const value = bars[pivotIndex].high;
    for (let index = pivotIndex - left; index <= pivotIndex + right; index += 1) {
      if (index === pivotIndex) continue;
      // Pine selects the most recent extreme: older ties are allowed, newer
      // ties postpone confirmation to the newer candle (and its volume).
      if (index < pivotIndex ? bars[index].high > value : bars[index].high >= value) return false;
    }
    return true;
  }

  function isPivotLow(bars, pivotIndex, left, right) {
    if (pivotIndex - left < 0 || pivotIndex + right >= bars.length) return false;
    const value = bars[pivotIndex].low;
    for (let index = pivotIndex - left; index <= pivotIndex + right; index += 1) {
      if (index === pivotIndex) continue;
      if (index < pivotIndex ? bars[index].low < value : bars[index].low <= value) return false;
    }
    return true;
  }

  function roundedVolumeParts(bar) {
    const range = bar.high - bar.low;
    if (!(range > 0) || !bar.volumeAvailable) {
      return { buy: NaN, sell: NaN };
    }
    return {
      buy: Math.round(bar.volume * (bar.close - bar.low) / range),
      sell: Math.round(bar.volume * (bar.high - bar.close) / range),
    };
  }

  function overlapsLikePine(zone, other) {
    return (
      (zone.top < other.bottom && zone.bottom > other.top) ||
      (zone.bottom < other.top && zone.top > other.bottom) ||
      (zone.top === other.top && zone.bottom === other.bottom)
    );
  }

  function trimBeforeDraw(zones, maximum) {
    // Pine's LiqRemove() removes at most one oldest object per bar.
    if (zones.length > maximum) zones.shift();
  }

  function removeOverlappingNewest(zones) {
    let removalIndex = -1;
    for (let index = 1; index < zones.length; index += 1) {
      for (let older = index - 1; older >= 0; older -= 1) {
        if (overlapsLikePine(zones[index], zones[older])) {
          // Pine's remove() keeps scanning and returns one final index. Its
          // caller removes only that single zone on this bar.
          removalIndex = index;
        }
      }
    }
    if (removalIndex !== -1) zones.splice(removalIndex, 1);
  }

  function liquidityZoneSnapshots(zone, current, step) {
    const id = `alpha:liquidity:${zone.kind}:${zone.pivot.time}`;
    // Run() calls Extend() before Draw(). A new pivot keeps box.new's blank
    // constructor state on its confirmation bar, including realtime replays.
    const newborn = zone.createdIndex === current.index;
    const right = newborn ? zone.previousTime : current.time + step * 20;
    const markerTime = current.time + step * 2;
    const mid = (zone.top + zone.bottom) / 2;
    const total = zone.buy + zone.sell;
    const bullPercent = total > 0 ? zone.buy / total * 100 : NaN;
    const bearPercent = 100 - bullPercent;
    const delta = zone.buy - zone.sell;
    const halfDistance = Math.abs(right - zone.pivot.time) / 2;
    const bullRight = newborn ? zone.previousTime : Math.trunc((zone.pivot.time + halfDistance * bullPercent / 100) * 1000) / 1000;
    const bearRight = newborn ? zone.pivot.time + 0.001 : Math.trunc((zone.pivot.time + halfDistance * bearPercent / 100) * 1000) / 1000;
    const dominant = newborn ? "rgba(209,203,203,0.55)" : bullPercent > 50 ? "#00e676" : "#ff0000";
    // Pine size.small is 10 for box text. Resolve chart.fg_color at delivery,
    // so the same calculated model remains usable on light and dark charts.
    const labelStyle = { textColorSource: "chart-foreground", fontSize: 10 };
    const zoneColor = zone.kind === "resistance" ? "rgba(243,56,56,0.20)" : "rgba(47,245,106,0.20)";
    // Pine's support box is constructed from low upward, so its volume halves
    // occupy the opposite vertical positions from a resistance box.
    const bullTop = zone.kind === "support" ? mid : zone.top;
    const bullBottom = zone.kind === "support" ? zone.bottom : mid;
    const bearTop = zone.kind === "support" ? zone.top : mid;
    const bearBottom = zone.kind === "support" ? mid : zone.bottom;

    return {
      boxes: [
        {
          id: `${id}:zone`,
          module: "liquidity",
          role: `${zone.kind}-zone`,
          left: zone.pivot.time,
          right,
          top: zone.top,
          bottom: zone.bottom,
          points: [{ time: zone.pivot.time, price: zone.top }, { time: right, price: zone.bottom }],
          style: { ...labelStyle, background: zoneColor, border: "rgba(255,255,255,0)", borderWidth: 2 },
        },
        {
          id: `${id}:bull-volume`,
          module: "liquidity",
          role: "bull-volume",
          left: zone.pivot.time,
          right: bullRight,
          top: bullTop,
          bottom: bullBottom,
          points: [{ time: zone.pivot.time, price: bullTop }, { time: bullRight, price: bullBottom }],
          text: newborn ? "" : `Bull % : ${Number(bullPercent.toFixed(2))}`,
          textAlign: "right",
          style: { ...labelStyle, background: newborn ? "rgba(242,54,69,0.30)" : "rgba(45,205,42,0.40)", border: "rgba(255,255,255,0)" },
        },
        {
          id: `${id}:bear-volume`,
          module: "liquidity",
          role: "bear-volume",
          left: zone.pivot.time,
          right: bearRight,
          top: bearTop,
          bottom: bearBottom,
          points: [{ time: zone.pivot.time, price: bearTop }, { time: bearRight, price: bearBottom }],
          text: newborn ? "" : `Bear % : ${Number(bearPercent.toFixed(2))}`,
          textAlign: "right",
          style: { ...labelStyle, background: newborn ? "rgba(76,175,80,0.30)" : "rgba(190,18,21,0.40)", border: "rgba(255,255,255,0)" },
        },
        {
          id: `${id}:delta`,
          module: "liquidity",
          role: "delta",
          left: markerTime,
          right: newborn ? zone.previousMarkerTime : right,
          top: zone.top,
          bottom: zone.bottom,
          points: [{ time: markerTime, price: zone.top }, { time: newborn ? zone.previousMarkerTime : right, price: zone.bottom }],
          text: newborn ? "" : `Delta: ${delta}`,
          textAlign: "center",
          style: {
            ...labelStyle,
            background: newborn ? "rgba(242,54,69,0.30)" : delta > 0 ? "rgba(0,230,118,0.25)" : "rgba(253,5,5,0.25)",
            border: "rgba(255,255,255,0)",
          },
        },
      ].filter((box) => box.points.every((point) => Number.isFinite(point.time))),
      lines: [
        {
          id: `${id}:mid`,
          module: "liquidity",
          role: "midline",
          points: [{ time: zone.pivot.time, price: mid }, { time: newborn ? zone.previousTime : markerTime, price: mid }],
          style: { color: dominant, lineStyle: "dashed", width: 1 },
        },
        {
          id: `${id}:edge`,
          module: "liquidity",
          role: "edge-line",
          points: [{ time: markerTime, price: zone.top }, { time: markerTime, price: zone.bottom }],
          style: { color: dominant, lineStyle: "dashed", width: 1 },
        },
      ],
    };
  }

  function computeLiquidity(rawBars, rawSettings) {
    const bars = normalizeBars(rawBars);
    const settings = normalizeSettings(rawSettings).liquidity;
    const empty = { boxes: [], lines: [], polylines: [], events: [] };
    if (!settings.enabled || bars.length === 0) return empty;

    const atr300 = atrSeries(bars, 300);
    const resistance = [];
    const support = [];
    const events = [];

    for (let currentIndex = 0; currentIndex < bars.length; currentIndex += 1) {
      const current = bars[currentIndex];

      for (let index = resistance.length - 1; index >= 0; index -= 1) {
        if (current.high > resistance[index].top) {
          events.push({ type: "resistance-broken", time: current.time, zoneId: resistance[index].id });
          resistance.splice(index, 1);
        }
      }
      for (let index = support.length - 1; index >= 0; index -= 1) {
        // Pine creates support with top=low and bottom=low+ATR. get_top()
        // reads that original low, not the normalized visual upper boundary.
        if (current.low < support[index].breakLevel) {
          events.push({ type: "support-broken", time: current.time, zoneId: support[index].id });
          support.splice(index, 1);
        }
      }

      trimBeforeDraw(resistance, settings.max);
      trimBeforeDraw(support, settings.max);

      const pivotIndex = currentIndex - settings.right;
      const thickness = atr300[currentIndex] === null ? null : atr300[currentIndex] * (2.5 / 3);
      if (pivotIndex >= 0 && thickness !== null) {
        const pivot = bars[pivotIndex];
        const volume = roundedVolumeParts(pivot);

        if (isPivotHigh(bars, pivotIndex, settings.period, settings.right)) {
          const zone = {
            id: `alpha:liquidity:resistance:${pivot.time}`,
            kind: "resistance",
            pivot,
            createdIndex: currentIndex,
            previousTime: bars[currentIndex - 1].time,
            previousMarkerTime: bars[currentIndex - 1].time + latestStep(bars, currentIndex - 1) * 2,
            top: pivot.high,
            bottom: pivot.high - thickness,
            breakLevel: pivot.high,
            buy: volume.buy,
            sell: volume.sell,
          };
          resistance.push(zone);
          events.push({ type: "resistance-created", time: current.time, zoneId: zone.id });
          removeOverlappingNewest(resistance);
        }

        if (isPivotLow(bars, pivotIndex, settings.period, settings.right)) {
          const zone = {
            id: `alpha:liquidity:support:${pivot.time}`,
            kind: "support",
            pivot,
            createdIndex: currentIndex,
            previousTime: bars[currentIndex - 1].time,
            previousMarkerTime: bars[currentIndex - 1].time + latestStep(bars, currentIndex - 1) * 2,
            top: pivot.low + thickness,
            bottom: pivot.low,
            breakLevel: pivot.low,
            buy: volume.buy,
            sell: volume.sell,
          };
          support.push(zone);
          events.push({ type: "support-created", time: current.time, zoneId: zone.id });
          removeOverlappingNewest(support);
        }
      }
    }

    const current = bars[bars.length - 1];
    const step = latestStep(bars);
    const snapshots = [...resistance, ...support].map((zone) => liquidityZoneSnapshots(zone, current, step));
    return {
      boxes: snapshots.flatMap((snapshot) => snapshot.boxes),
      lines: snapshots.flatMap((snapshot) => snapshot.lines),
      polylines: [],
      events,
    };
  }

  function collectPivots(bars, left, right, direction) {
    const pivots = [];
    for (let confirmation = left + right; confirmation < bars.length; confirmation += 1) {
      const pivotIndex = confirmation - right;
      const isPivot = direction === "high"
        ? isPivotHigh(bars, pivotIndex, left, right)
        : isPivotLow(bars, pivotIndex, left, right);
      if (isPivot) {
        pivots.push({
          confirmation,
          index: pivotIndex,
          time: bars[pivotIndex].time,
          value: direction === "high" ? bars[pivotIndex].high : bars[pivotIndex].low,
        });
      }
    }
    return pivots;
  }

  function computeTrendLines(rawBars, rawSettings) {
    const bars = normalizeBars(rawBars);
    const settings = normalizeSettings(rawSettings).trendLines;
    const empty = { boxes: [], lines: [], polylines: [], events: [] };
    if (!settings.enabled || bars.length < 3) return empty;

    const period = PRESET_PERIODS[settings.preset];
    const right = Math.floor(period / 2);
    const polylines = [];

    for (const direction of ["high", "low"]) {
      const pivots = collectPivots(bars, period, right, direction);
      for (let index = 1; index < pivots.length; index += 1) {
        const start = pivots[index - 1];
        const current = pivots[index];
        const elapsed = current.time - start.time;
        if (!(elapsed > 0)) continue;
        const slope = (current.value - start.value) / elapsed;
        const valid = direction === "high" ? slope < 0 : slope >= 0;
        if (!valid) continue;

        const step = latestStep(bars, current.confirmation);
        const extension = step * 75;
        const endTime = current.time + extension;
        const endValue = current.value + extension * slope;
        polylines.push({
          id: `alpha:trendline:${direction}:${start.time}:${current.time}`,
          module: "trendLines",
          role: `${direction}-trendline`,
          direction,
          creationTime: bars[current.confirmation].time,
          points: [
            { time: start.time, price: start.value },
            // Pine adds one raw slope unit here instead of slope * time.  Keep
            // that visual quirk for source parity.
            { time: start.time + step * 2, price: start.value + slope },
            { time: endTime, price: endValue },
          ],
          style: {
            color: "rgba(72,71,73,0.20)",
            fill: direction === "high" ? settings.color : "rgba(245,58,204,0.50)",
            width: 1,
          },
        });
      }
    }

    polylines.sort((a, b) => a.creationTime - b.creationTime || (a.direction === "high" ? -1 : 1));
    const visible = settings.history ? polylines : polylines.slice(-settings.last);
    return { boxes: [], lines: [], polylines: visible, events: [] };
  }

  function volumeScore(volume, rank) {
    if (volume <= rank.a && volume > rank.b) return 3;
    if (volume <= rank.b && volume > rank.c) return 2;
    if (volume <= rank.c && volume > rank.d) return 1;
    return 0;
  }

  function scoreText(score) {
    return ["Very Low: ", "Low: ", "Medium: ", "High: ", "Very High: "][score] || "Very High: ";
  }

  function formatVolume(value) {
    const absolute = Math.abs(value);
    if (absolute >= 1e12) return `${(value / 1e12).toFixed(2).replace(/\.00$/, "")}T`;
    if (absolute >= 1e9) return `${(value / 1e9).toFixed(2).replace(/\.00$/, "")}B`;
    if (absolute >= 1e6) return `${(value / 1e6).toFixed(2).replace(/\.00$/, "")}M`;
    if (absolute >= 1e3) return `${(value / 1e3).toFixed(2).replace(/\.00$/, "")}K`;
    return String(Math.round(value));
  }

  function intersectFraction(a, b, x, y) {
    if (y < a || x > b) return 0;
    if (x >= a && y <= b) return (y - x) / (b - a || 1);
    if (x <= a && y >= b) return (b - a) / (y - x || 1);
    if (x < a && y <= b) return (y - a) / (y - x || 1);
    if (x >= a && y > b) return (b - x) / (y - x || 1);
    return 1;
  }

  function trailingOffset(bars, index, depth, field, mode) {
    const start = Math.max(0, index - depth + 1);
    let selected = index;
    for (let candidate = index - 1; candidate >= start; candidate -= 1) {
      const better = mode === "low"
        ? bars[candidate][field] < bars[selected][field]
        : bars[candidate][field] > bars[selected][field];
      if (better) selected = candidate;
    }
    return index - selected;
  }

  function barsSince(condition, previous) {
    if (condition === true) return 0;
    return Number.isFinite(previous) ? previous + 1 : null;
  }

  // Literal replay of calculate_zigzag() from the supplied Pine.  The odd
  // counters and two-bar bars-since state are intentionally preserved.
  function initialZigzagState() {
    return { lastHigh: 1, lastLow: 1, lowOffset: 1, highOffset: 1,
      // Pine v6 history before bar zero is false for bool values, not na.
      previousLowing: false, previousHighing: false, previousDown: false,
      highSince: null, lowSince: null, downSince: null };
  }

  function advanceOrderBlockZigzag(bars, index, depth, minTick, state) {
    let { lastHigh, lastLow, lowOffset, highOffset, previousLowing,
      previousHighing, previousDown, highSince, lowSince, downSince } = state;
    let change = null;
    lastHigh += 1;
    lastLow += 1;
    lowOffset += 1;
    highOffset += 1;

    const pivotLowOffset = trailingOffset(bars, index, depth, "low", "low");
    const pivotHighOffset = trailingOffset(bars, index, depth, "high", "high");
    const lowAtOffset = bars[index - lowOffset];
    const lowAtPivot = bars[index - pivotLowOffset];
    const highAtOffset = bars[index - highOffset];
    const highAtPivot = bars[index - pivotHighOffset];
    const lowing = lowOffset === pivotLowOffset || Boolean(
      lowAtPivot && bars[index].low - lowAtPivot.low > 5 * minTick
    );
    const highing = highOffset === pivotHighOffset || Boolean(
      highAtPivot && highAtPivot.high - bars[index].high > 5 * minTick
    );

    highSince = barsSince(previousHighing === false, highSince);
    lowSince = barsSince(previousLowing === false, lowSince);
    const comparison = Number.isFinite(highSince) && Number.isFinite(lowSince)
      ? highSince > lowSince
      : null;
    downSince = barsSince(comparison === null ? null : !comparison, downSince);
    const down = Number.isFinite(downSince) && downSince >= 2;
    const lower = Boolean(lowAtOffset && lowAtPivot && lowAtOffset.low > lowAtPivot.low);
    const higher = Boolean(highAtOffset && highAtPivot && highAtOffset.high < highAtPivot.high);

    if (lowOffset !== pivotLowOffset && (previousDown === false || lower)) {
      lowOffset = pivotLowOffset < highOffset ? pivotLowOffset : 0;
    }
    if (highOffset !== pivotHighOffset && (previousDown === true || higher)) {
      highOffset = pivotHighOffset < lowOffset ? pivotHighOffset : 0;
    }

    const changed = previousDown !== null && down !== previousDown && bars[index].isBarClosed;
    if (changed && down) lastHigh = highOffset;
    if (changed && !down) lastLow = lowOffset;
    const pivotIndex = down ? index - lastHigh : index - lastLow;
    if (changed && pivotIndex >= 0 && pivotIndex < bars.length) {
      change = { confirmation: index, pivotIndex, polarity: !down };
    }

    previousLowing = lowing;
    previousHighing = highing;
    previousDown = down;
    Object.assign(state, { lastHigh, lastLow, lowOffset, highOffset, previousLowing,
      previousHighing, previousDown, highSince, lowSince, downSince });
    return change;
  }

  function orderBlockChanges(bars, depth, minTick) {
    const state = initialZigzagState(), changes = [];
    for (let index = 0; index < bars.length; index++) {
      const change = advanceOrderBlockZigzag(bars, index, depth, minTick, state);
      if (change) changes.push(change);
    }
    return changes;
  }

  function orderBlockColor(score, polarity, level) {
    const bullish = ["#0980ff", "#00c3e5", "#00eaa4", "#05ff3f"];
    const bearish = ["#8215ff", "#cd31f3", "#ff19ba", "#ff1515"];
    const visible = level === 0 || score >= level;
    if (!visible) return "rgba(0,0,0,0)";
    const color = (polarity ? bullish : bearish)[level];
    // The Drawing API rejects 8-digit hex, even though the source color uses
    // 0x52 alpha. Keep that opacity with its accepted rgba representation.
    return `rgba(${parseInt(color.slice(1, 3), 16)},${parseInt(color.slice(3, 5), 16)},${parseInt(color.slice(5, 7), 16)},${82 / 255})`;
  }

  function makeOrderBlock(bars, change, localAtrSeries, volumeThresholds, rank) {
    const pivotIndex = change.pivotIndex;
    const bar = bars[pivotIndex];
    const localAtr = localAtrSeries[pivotIndex];
    if (!(localAtr > 0)) return null;

    const polarity = change.polarity;
    const topValue = polarity ? Math.min(bar.close, bar.open) : bar.high;
    const bottomValue = polarity ? bar.low : Math.max(bar.close, bar.open);
    const delta = topValue - bottomValue;
    const positionFlag = delta < localAtr * 3 && delta > localAtr;
    const top = polarity ? (positionFlag ? topValue : bottomValue + localAtr * 2) : topValue;
    const bottom = polarity ? bottomValue : (positionFlag ? bottomValue : topValue - localAtr * 2);

    const threshold = volumeThresholds[pivotIndex];
    if (!(bar.volume >= threshold)) return null;

    return {
      id: `alpha:order-block:${polarity ? "bullish" : "bearish"}:${bar.time}:${bars[change.confirmation].time}`,
      polarity,
      leftIndex: pivotIndex,
      createdAt: change.confirmation,
      top,
      bottom,
      originalVolume: bar.volume,
      volume: bar.volume,
      age: 0,
      breaker: false,
      score: volumeScore(bar.volume, rank),
    };
  }

  function orderBlockSnapshots(block, bars) {
    const current = bars[bars.length - 1];
    const left = bars[block.leftIndex].time;
    const span = current.index - block.leftIndex;
    const delta = Math.trunc(span / 4);
    const boundary = (part) => {
      const index = Math.min(current.index, block.leftIndex + delta * part);
      return bars[Math.max(0, index)].time;
    };
    const score = block.score;
    const bodyColor = block.breaker ? "rgba(120,123,134,0.40)" : "rgba(90,93,119,0.20)";
    const bodyText = block.breaker ? "Breaker Block" : `${scoreText(score)}${formatVolume(block.volume)}`;
    const boxes = [{
      id: `${block.id}:body`,
      module: "orderBlocks",
      role: "order-block-body",
      polarity: block.polarity ? "bullish" : "bearish",
      left,
      right: current.time,
      top: block.top,
      bottom: block.bottom,
      extendRight: true,
      points: [{ time: left, price: block.top }, { time: current.time, price: block.bottom }],
      text: bodyText,
      textAlign: "right",
      style: { background: bodyColor, border: bodyColor, textColor: "#787B86" },
    }];

    for (let level = 0; level < 4; level += 1) {
      const levelLeft = level === 0 ? left : boundary(level);
      const levelRight = level === 3 ? current.time : boundary(level + 1);
      boxes.push({
        id: `${block.id}:level-${level + 1}`,
        module: "orderBlocks",
        role: `volume-level-${level + 1}`,
        polarity: block.polarity ? "bullish" : "bearish",
        left: levelLeft,
        right: levelRight,
        top: block.top,
        bottom: block.bottom,
        points: [{ time: levelLeft, price: block.top }, { time: levelRight, price: block.bottom }],
        style: {
          background: block.breaker ? "rgba(0,0,0,0)" : orderBlockColor(score, block.polarity, level),
          border: "rgba(0,0,0,0)",
        },
      });
    }
    return boxes;
  }

  function lowerBound(values, value) {
    let low = 0, high = values.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (values[middle] < value) low = middle + 1; else high = middle;
    }
    return low;
  }

  function advanceVolumeRank(state, volume, index) {
    const sorted = state.sortedVolumes;
    if (index >= 500) sorted.splice(lowerBound(sorted, state.volumes[index - 500]), 1);
    sorted.splice(lowerBound(sorted, volume), 0, volume);
    const at = percentile => sorted[Math.max(0, Math.ceil(percentile * sorted.length / 100) - 1)];
    return { a: at(100), b: at(90), c: at(60), d: at(30) };
  }

  function initialOrderBlockState() {
    return { bars: [], volumes: [], localAtrSeries: [], thresholds: [],
      rangeSum: 0, trSum: 0, atr: null, sortedVolumes: [],
      zigzag: initialZigzagState(), active: [], events: [] };
  }

  function advanceOrderBlock(state, bar, settings) {
    const { bars, volumes, localAtrSeries, thresholds, active, events } = state;
    const index = bars.length, previous = bars[index - 1];
    bars.push(bar); volumes.push(bar.volume);
    const range = bar.high - bar.low;
    const tr = previous ? Math.max(range, Math.abs(bar.high - previous.close), Math.abs(bar.low - previous.close)) : range;
    state.rangeSum += range;
    if (index < 10) state.trSum += tr;
    if (index === 9) state.atr = state.trSum / 10;
    else if (index > 9) state.atr = (state.atr * 9 + tr) / 10;
    localAtrSeries.push(state.atr === null ? null : (state.rangeSum / (index + 1) + state.atr) / 6);
    thresholds.push(simpleAverage(volumes, Math.max(0, index - 99), index) +
      standardDeviation(volumes, Math.max(0, index - 49), index));
    const rank = advanceVolumeRank(state, bar.volume, index);
    const change = advanceOrderBlockZigzag(bars, index, ORDER_BLOCK_DEPTHS[settings.preset], settings.minTick, state.zigzag);
    if (active.length > settings.amount) active.shift();
    if (change) {
      const block = makeOrderBlock(bars, change, localAtrSeries, thresholds, rank);
      if (block) {
        active.push(block);
        events.push({ type: "order-block-created", time: bar.time, blockId: block.id });
      }
    }
    for (let position = active.length - 1; position >= 0; position--) {
      const block = active[position];
      block.age += 1;
      if (settings.breaker && !block.breaker && (block.polarity ? bar.close < block.bottom : bar.close > block.top)) {
        block.age += 10;
        block.breaker = true;
        events.push({ type: "breaker-block", time: bar.time, blockId: block.id });
        continue;
      }
      const overlap = intersectFraction(block.bottom, block.top, bar.low, bar.high);
      if (overlap > 0 && block.volume > 0 && !block.breaker) {
        block.age -= 1;
        block.volume = Math.max(0, block.volume - bar.volume * overlap);
        block.score = volumeScore(block.volume, rank);
        continue;
      }
      if (block.volume <= 0 || block.age >= 300) {
        events.push({ type: "order-block-removed", time: bar.time, blockId: block.id });
        active.splice(position, 1);
      }
    }
  }

  function orderBlockResult(state) {
    const { active, bars } = state;
    return { boxes: active.flatMap((block) => orderBlockSnapshots(block, bars)),
      lines: [], polylines: [], events: state.events.slice() };
  }

  function sameReplayBar(a, b) {
    return a && b && ["time", "open", "high", "low", "close", "volume", "isBarClosed"]
      .every(key => a[key] === b[key]);
  }

  // Keep only the completed prefix committed. The latest candle is evaluated
  // transactionally, so repeated ticks cannot consume volume or age a block twice.
  // Any historical revision, rewind or settings change rebuilds the prefix.
  function createOrderBlockReplay() {
    let state = initialOrderBlockState(), settingsKey = "";
    const stats = { rebuilds: 0, processedBars: 0 };
    function compute(rawBars, rawSettings, normalized) {
      const settings = normalizeSettings(rawSettings).orderBlocks;
      const bars = normalized ? rawBars : normalizeBars(rawBars);
      const key = JSON.stringify(settings);
      let valid = key === settingsKey && state.bars.length <= Math.max(0, bars.length - 1);
      for (let index = 0; valid && index < state.bars.length; index++) valid = sameReplayBar(state.bars[index], bars[index]);
      if (!valid) { state = initialOrderBlockState(); settingsKey = key; stats.rebuilds++; }
      if (!settings.enabled || !bars.length) return { boxes: [], lines: [], polylines: [], events: [] };
      while (state.bars.length < bars.length - 1) {
        advanceOrderBlock(state, bars[state.bars.length], settings); stats.processedBars++;
      }
      const checkpoint = { rangeSum: state.rangeSum, trSum: state.trSum, atr: state.atr,
        zigzag: { ...state.zigzag }, sortedVolumes: state.sortedVolumes.slice(),
        active: state.active.map(block => ({ ...block })) };
      const length = state.bars.length, eventCount = state.events.length;
      try {
        advanceOrderBlock(state, bars[length], settings); stats.processedBars++;
        return orderBlockResult(state);
      } finally {
        for (const key of ["bars", "volumes", "localAtrSeries", "thresholds"]) state[key].length = length;
        state.events.length = eventCount;
        Object.assign(state, checkpoint);
      }
    }
    return { compute, stats };
  }

  function computeOrderBlocks(rawBars, rawSettings) {
    return createOrderBlockReplay().compute(rawBars, rawSettings);
  }

  function pineNumber(value) {
    if (!Number.isFinite(value)) return "NaN";
    return Number(value.toFixed(8)).toString();
  }

  function computeCapitalRisk(rawSettings) {
    const settings = normalizeSettings(rawSettings).capitalRisk;
    if (!settings.enabled) return null;
    const riskAmount = settings.capital * settings.riskPercent / 100;
    const stopFraction = settings.stopLossPercent / 100;
    const tradeCapital = stopFraction !== 0 ? Math.round(riskAmount / stopFraction) : Infinity;
    const rows = [
      { key: "capital", label: "Total Capital", value: settings.capital },
      { key: "risk", label: "Risk Per Trade", value: riskAmount },
      { key: "profit", label: "Profit Per Trade", value: riskAmount * settings.rr },
      { key: "trade-capital", label: "Trade Capital", value: tradeCapital },
    ].map((row, index) => ({
      ...row,
      row: index + 1,
      displayValue: `${pineNumber(row.value)} ${settings.currency}`,
    }));

    return {
      id: "alpha:capital-risk:table",
      module: "capitalRisk",
      position: "middle-right",
      columns: 2,
      rows,
      style: {
        background: "#c0c0c0",
        frame: "#464646",
        frameWidth: 2,
        borderWidth: 2,
        labelBackground: "rgba(120,123,134,0.38)",
        labelColor: "#000000",
        valueBackground: "var(--alpha-chart-fg, #f0f0f0)",
        valueColor: "#000000",
      },
    };
  }

  function computeSnapshots(rawBars, rawSettings, options) {
    const bars = normalizeBars(rawBars);
    const settings = normalizeSettings(rawSettings);
    const liquidity = computeLiquidity(bars, settings);
    const trendLines = computeTrendLines(bars, settings);
    const orderBlocks = options && options.orderBlockReplay
      ? options.orderBlockReplay.compute(bars, settings, true) : computeOrderBlocks(bars, settings);
    const table = computeCapitalRisk(settings);

    return {
      owner: OWNER,
      version: MODEL_VERSION,
      ...(options && options.sourceId ? { sourceId: options.sourceId } : {}),
      ...(options && options.studyName ? { studyName: options.studyName } : {}),
      ...(options && options.instanceToken !== undefined ? { instanceToken: options.instanceToken } : {}),
      ...(options && options.context ? { context: { ...options.context } } : {}),
      nativeLiquidity: Boolean(options && options.nativeLiquidity),
      barCount: bars.length,
      lastBarTime: bars.length ? bars[bars.length - 1].time : null,
      boxes: [...liquidity.boxes, ...orderBlocks.boxes],
      lines: [...liquidity.lines],
      polylines: [...trendLines.polylines],
      table,
      events: [...liquidity.events, ...trendLines.events, ...orderBlocks.events],
      modules: { liquidity, trendLines, orderBlocks, capitalRisk: table },
      fidelity: {
        liquidity: "historical-replay",
        trendLines: "historical-replay",
        orderBlocks: "confirmed-zigzag-equivalent",
        capitalRisk: "exact",
      },
    };
  }

  function isAlphaOwnedId(value) {
    return typeof value === "string" && ALPHA_ID.test(value);
  }

  function drawingSnapshots(model) {
    if (!model || typeof model !== "object") return [];
    return [
      ...(Array.isArray(model.boxes) ? model.boxes : []),
      ...(Array.isArray(model.lines) ? model.lines : []),
      ...(Array.isArray(model.polylines) ? model.polylines : []),
    ].filter((snapshot) => snapshot && isAlphaOwnedId(snapshot.id) &&
      !(model.nativeLiquidity && snapshot.module === "liquidity"));
  }

  function chartForegroundColor(chart) {
    function foreground(theme) {
      theme = String(theme).toLowerCase();
      return theme === "light" ? "#0f0f0f" : theme === "dark" ? "#dbdbdb" : null;
    }
    // The injector can bind this reader to the document that owns an inner
    // chart adapter, which may not expose the full widget's public getTheme().
    for (const source of ["options", "widget"]) {
      for (const registration of widgetRegistrations) {
        const provider = registration[source];
        if (registration.chart !== chart || typeof provider.getTheme !== "function") continue;
        try {
          const color = foreground(provider.getTheme());
          if (color) return color;
        } catch (_) { /* Theme may be unavailable until widget readiness. */ }
      }
    }
    try {
      const element = root.document && root.document.documentElement;
      if (element) {
        const color = foreground(element.dataset && element.dataset.theme);
        if (color) return color;
        if (element.classList && element.classList.contains("theme-light")) return "#0f0f0f";
        if (element.classList && element.classList.contains("theme-dark")) return "#dbdbdb";
      }
    } catch (_) { /* No document exists in calculation-only environments. */ }
    // Standard theme markers do not expose custom canvas backgrounds.
    return "#dbdbdb";
  }

  function entityOptions(snapshot, ownerStudyId, visible, chart) {
    const isHorizontalLine = snapshot.shape === "horizontal_line";
    const isText = snapshot.shape === "text";
    const isBox = Number.isFinite(snapshot.top) && Number.isFinite(snapshot.bottom);
    const isPolyline = snapshot.points && snapshot.points.length > 2;
    const shape = isText ? "text" : isHorizontalLine ? "horizontal_line" : isBox ? "rectangle" : isPolyline ? "polyline" : "trend_line";
    const style = snapshot.style || {};
    const lineStyle = style.lineStyle === "dashed" ? 2 : style.lineStyle === "dotted" ? 1 : 0;
    let overrides;
    if (isText) {
      overrides = { color: style.color || "#b2b5be", fontsize: finite(style.fontSize, 12),
        bold: false, italic: false, fillBackground: false, drawBorder: false,
        fixedSize: true, wordWrap: false };
    } else if (isHorizontalLine) {
      overrides = {
        linecolor: style.color || "#b2b5be",
        linewidth: finite(style.width, 1),
        linestyle: lineStyle,
        showPrice: snapshot.hideInObjectsTree === true ? false : true,
        textcolor: style.textColor || style.color || "#b2b5be",
        horzLabelsAlign: snapshot.textAlign || "center",
        vertLabelsAlign: "middle",
      };
    } else if (isBox) {
      overrides = {
        backgroundColor: style.background || "rgba(0,0,0,0)",
        color: style.border || "rgba(0,0,0,0)",
        linewidth: finite(style.borderWidth, 1),
        fillBackground: true,
        extendRight: Boolean(snapshot.extendRight),
        showLabel: Boolean(snapshot.text),
        textColor: style.textColorSource === "chart-foreground" ? chartForegroundColor(chart) : style.textColor || "#f0f0f0",
        horzLabelsAlign: snapshot.textAlign || "center",
        vertLabelsAlign: "middle",
      };
      if (Number.isFinite(style.fontSize)) overrides.fontSize = style.fontSize;
    } else if (isPolyline) {
      overrides = {
        linecolor: style.color || "#484749",
        linewidth: finite(style.width, 1),
        linestyle: lineStyle,
        filled: Boolean(style.fill),
        fillBackground: Boolean(style.fill),
        backgroundColor: style.fill || "rgba(0,0,0,0)",
      };
    } else {
      overrides = {
        linecolor: style.color || "#b2b5be",
        linewidth: finite(style.width, 1),
        linestyle: lineStyle,
        extendLeft: false,
        extendRight: false,
      };
    }
    if (typeof visible === "boolean") overrides.visible = visible;
    const options = {
      shape,
      lock: true,
      disableSelection: true,
      disableSave: true,
      disableUndo: true,
      showInObjectsTree: snapshot.hideInObjectsTree === true ? false : undefined,
      text: snapshot.text,
      overrides,
    };
    if (ownerStudyId !== undefined && ownerStudyId !== null) {
      options.ownerStudyId = ownerStudyId;
    }
    return options;
  }

  function registryEntries(registry) {
    if (registry instanceof Map) return Array.from(registry.entries());
    if (registry && typeof registry === "object") return Object.entries(registry);
    return [];
  }

  function registryGet(registry, key) {
    return registry instanceof Map ? registry.get(key) : registry && registry[key];
  }

  function registrySet(registry, key, value) {
    if (registry instanceof Map) registry.set(key, value);
    else registry[key] = value;
  }

  function registryDelete(registry, key) {
    if (registry instanceof Map) registry.delete(key);
    else delete registry[key];
  }

  function removeDrawing(chart, adapter, entityId) {
    if (adapter && typeof adapter.removeEntity === "function") return adapter.removeEntity(entityId, chart);
    if (chart && typeof chart.removeEntity === "function") return chart.removeEntity(entityId, { disableUndo: true });
    throw new Error("Drawing removal API is unavailable");
  }

  function shapePresent(chart, entityId) {
    try {
      if (chart && typeof chart.getAllShapes === "function") {
        return chart.getAllShapes().some(shape => shape.id === entityId);
      }
    } catch (_) { /* Unknown is not proof of absence. */ }
    return null;
  }

  function scheduleDeletionRetry() {
    if (deletionTimer !== null || typeof root.setTimeout !== "function" ||
        !Array.from(pendingDeletions).some(item => item.attempts < 5)) return;
    deletionTimer = root.setTimeout(() => {
      deletionTimer = null;
      for (const item of Array.from(pendingDeletions)) {
        if (item.attempts < 5) attemptDeletion(item);
      }
    }, 250);
    if (deletionTimer && typeof deletionTimer.unref === "function") deletionTimer.unref();
  }

  function attemptDeletion(item, errors) {
    if (item.inFlight) return;
    item.attempts++;
    const complete = error => {
      item.inFlight = false;
      const present = item.adapter ? null : shapePresent(item.chart, item.entityId);
      const canVerify = !item.adapter && typeof item.chart.getAllShapes === "function";
      if (present === false || !error && !canVerify) {
        pendingDeletions.delete(item);
      } else {
        pendingDeletions.add(item);
        if (errors) errors.push({ phase: "remove", logicalId: item.logicalId,
          message: error ? String(error.message || error) : "Drawing still exists after removal" });
        scheduleDeletionRetry();
      }
    };
    try {
      const result = removeDrawing(item.chart, item.adapter, item.entityId);
      if (isThenable(result)) {
        item.inFlight = true;
        Promise.resolve(result).then(() => complete(), complete);
      } else complete();
    } catch (error) { complete(error); }
  }

  function requestDeletion(chart, adapter, entityId, logicalId, errors, ownerStudyId = null) {
    if (!chart || entityId == null) return;
    if (!deletionLedger.has(chart)) deletionLedger.set(chart, new Map());
    const ledger = deletionLedger.get(chart);
    let item = ledger.get(entityId);
    if (!item) {
      item = { chart, adapter, entityId, logicalId, ownerStudyId, attempts: 0, inFlight: false };
      ledger.set(entityId, item);
    }
    pendingDeletions.add(item);
    attemptDeletion(item, errors);
  }

  function retryDeletions(chart, errors) {
    for (const item of Array.from(pendingDeletions)) {
      if (!chart || item.chart === chart) attemptDeletion(item, errors);
    }
  }

  function cleanupRestoredDrawings(chart) {
    retryDeletions(chart);
    const ledger = chart && deletionLedger.get(chart);
    if (!ledger || typeof chart.getAllShapes !== "function") return;
    try {
      // Tombstones cover replacement, context changes, late promises and
      // unregister as well as explicit study deletion. Undo may restore any.
      for (const shape of chart.getAllShapes()) {
        const item = ledger.get(shape.id);
        if (item && !pendingDeletions.has(item)) {
          pendingDeletions.add(item);
          attemptDeletion(item);
        }
      }
    } catch (_) { /* A load event or the lifecycle watcher retries. */ }
  }

  function enforceDrawingOwnership(chart, record, adapter, errors) {
    if (!record || record.entityId == null || adapter && typeof adapter.createEntity === "function" ||
        !chart || typeof chart.getShapeById !== "function") return true;
    try {
      const shape = chart.getShapeById(record.entityId);
      if (!shape) return false;
      // Check the resulting native entity, not only creation options. Restored
      // drawings can carry flags different from those originally requested.
      for (const [getter, setter] of [["isSavingEnabled", "setSavingEnabled"],
        ["isSelectionEnabled", "setSelectionEnabled"], ["isUserEditEnabled", "setUserEditEnabled"]]) {
        if (typeof shape[setter] === "function" &&
            (typeof shape[getter] !== "function" || shape[getter]())) shape[setter](false);
      }
      const owned = !(typeof shape.isSavingEnabled === "function" && shape.isSavingEnabled()) &&
        !(typeof shape.ownerSourceId === "function" && shape.ownerSourceId() !== record.ownerStudyId);
      if (owned) {
        syncDrawingVisibility(chart, record, adapter, errors);
        syncDrawingTextStyle(chart, record, adapter, errors);
      }
      return owned;
    } catch (error) {
      if (errors) errors.push({ phase: "ownership", logicalId: record.snapshot.id, message: String(error.message || error) });
      return false;
    }
  }

  function ownerVisibility(chart, ownerStudyId) {
    try {
      if (!chart || ownerStudyId == null || typeof chart.getStudyById !== "function") return null;
      const allIndicators = chartIndicatorVisibility.get(chart);
      if (allIndicators && allIndicators.value() === true) return false;
      const study = chart.getStudyById(ownerStudyId);
      const visible = study && typeof study.isVisible === "function" ? study.isVisible() : null;
      return typeof visible === "boolean" ? visible : null;
    } catch (_) { return null; }
  }

  function syncDrawingVisibility(chart, record, adapter, errors) {
    if (!record || record.cancelled || record.entityId == null ||
        adapter && typeof adapter.createEntity === "function" ||
        !chart || typeof chart.getShapeById !== "function") return;
    const visible = ownerVisibility(chart, record.ownerStudyId);
    if (visible === null) return; // Unavailable metadata must not reveal a hidden entity.
    try {
      const shape = chart.getShapeById(record.entityId);
      if (!shape || typeof shape.setProperties !== "function") return;
      const properties = typeof shape.getProperties === "function" ? shape.getProperties() : null;
      const current = properties && typeof properties.visible === "boolean" ? properties.visible : record.visible;
      if (current === visible) return;
      // Change only this drawing's own visibility, not global Hide Drawings.
      // Direct properties do not add one Undo action per generated object or
      // change defaults for the user's future manual drawings.
      shape.setProperties({ visible }, false);
      record.visible = visible;
    } catch (error) {
      if (errors) errors.push({ phase: "visibility", logicalId: record.snapshot.id, message: String(error.message || error) });
      // Retain the record: the next property event/load/audit retries it.
    }
  }

  function syncDrawingTextStyle(chart, record, adapter, errors) {
    const style = record && record.snapshot && record.snapshot.style;
    if (!style || style.textColorSource !== "chart-foreground" || record.cancelled || record.entityId == null ||
        adapter && typeof adapter.createEntity === "function" || !chart || typeof chart.getShapeById !== "function") return;
    try {
      const shape = chart.getShapeById(record.entityId);
      if (!shape || typeof shape.setProperties !== "function") return;
      const expected = { textColor: chartForegroundColor(chart), fontSize: style.fontSize };
      const current = typeof shape.getProperties === "function" ? shape.getProperties() : record.textProperties;
      if (current && current.textColor === expected.textColor && current.fontSize === expected.fontSize) return;
      // Update only this owned label; never change drawing defaults or recreate
      // the zone when a theme changes during a closed market.
      shape.setProperties(expected, false);
      record.textProperties = expected;
    } catch (error) {
      if (errors) errors.push({ phase: "text-style", logicalId: record.snapshot.id, message: String(error.message || error) });
    }
  }

  function migrateLegacyDrawings(chart) {
    const legacy = root.__THNDR_LEGACY_DRAWINGS__;
    if (!legacy || !chart || typeof chart.getAllShapes !== "function" || typeof chart.getShapeById !== "function") return;
    try {
      const shapes = chart.getAllShapes().map(info => {
        const shape = chart.getShapeById(info.id);
        return { id: info.id, name: info.name, points: shape.getPoints(), properties: shape.getProperties(),
          ownerSourceId: shape.ownerSourceId(), saving: shape.isSavingEnabled(),
          selectable: shape.isSelectionEnabled(), editable: shape.isUserEditEnabled() };
      });
      const groups = legacy.findLegacyLiquidityGroups(shapes);
      if (!groups.length) return;
      const ids = new Set(groups.flatMap(group => group.ids));
      const backup = { context: chartContext(chart), shapes: shapes.filter(shape => ids.has(shape.id)) };
      const storage = root.localStorage;
      if (!storage) throw new Error("Legacy cleanup requires an available local backup store");
      const previous = storage.getItem(LEGACY_BACKUP_KEY);
      const backups = previous ? JSON.parse(previous) : [];
      if (!Array.isArray(backups)) throw new Error("Invalid legacy backup store; cleanup skipped");
      const signature = JSON.stringify(backup);
      if (!backups.some(item => JSON.stringify(item) === signature)) backups.push(backup);
      const serialized = JSON.stringify(backups);
      storage.setItem(LEGACY_BACKUP_KEY, serialized);
      if (storage.getItem(LEGACY_BACKUP_KEY) !== serialized) throw new Error("Legacy backup readback failed; cleanup skipped");
      // The recognizer requires all six related shapes and disabled selection
      // AND editing. Ambiguous/incomplete/manual families never reach here.
      for (const id of ids) {
        requestDeletion(chart, null, id, "alpha:legacy-liquidity");
        if (shapePresent(chart, id) === false) legacyMigrationStatus.removed++;
      }
      legacyMigrationStatus.error = null;
    } catch (error) {
      legacyMigrationStatus.error = String(error.message || error);
    }
  }

  function drawingLifecycleStatus() {
    return { pendingDeletions: pendingDeletions.size, legacyRemoved: legacyMigrationStatus.removed,
      legacyBackupKey: LEGACY_BACKUP_KEY, legacyError: legacyMigrationStatus.error };
  }

  function createDrawing(chart, adapter, snapshot, ownerStudyId) {
    if (adapter && typeof adapter.createEntity === "function") return adapter.createEntity(snapshot, chart);
    if (snapshot.shape === "horizontal_line" || snapshot.shape === "text") {
      if (!Array.isArray(snapshot.points) || snapshot.points.length !== 1 ||
          !Number.isFinite(snapshot.points[0].time) || !Number.isFinite(snapshot.points[0].price)) {
        throw new Error("A single-point drawing requires exactly one finite time/price point");
      }
      if (!chart || typeof chart.createShape !== "function") {
        throw new Error("Single-point drawings require the createShape Drawing API");
      }
      return chart.createShape(snapshot.points[0], entityOptions(snapshot, ownerStudyId, ownerVisibility(chart, ownerStudyId), chart));
    }
    if (chart && typeof chart.createMultipointShape === "function") {
      return chart.createMultipointShape(snapshot.points, entityOptions(snapshot, ownerStudyId, ownerVisibility(chart, ownerStudyId), chart));
    }
    throw new Error("A Drawing API chart or createEntity adapter is required");
  }

  function retireInstanceBinding(chart, ownerStudyId, token) {
    const sources = [];
    for (const registration of widgetRegistrations) {
      if (resolveChart(registration.widget) !== chart) continue;
      const owned = registration.sourcesByOwner.get(ownerStudyId);
      if (owned) { sources.push(...owned); registration.sourcesByOwner.delete(ownerStudyId); }
      for (const { registry, logicalId, record } of registeredDrawings(registration)) {
        if (record.ownerStudyId !== ownerStudyId || record.instanceToken !== token) continue;
        removeRecordDrawing(chart, registration.options.adapter, registry, logicalId, record);
        registry.delete(logicalId);
      }
    }
    retireUnusedSources(sources);
  }

  function newInstanceBinding(chart, id, inputsKey) {
    const bindings = instanceBindings.get(chart), previous = bindings.get(id);
    const binding = { token: instancePrefix + ":" + (++instanceSequence), inputsKey };
    bindings.set(id, binding);
    if (previous) retireInstanceBinding(chart, id, previous.token);
    return binding;
  }

  function renewCopiedToken(token, chart, id) {
    if (!token) return;
    // Native duplicate/paste can copy a hidden input. Invalidate the original
    // lease too, so the copied producer can never keep drawing on its donor.
    const inspected = new Set();
    for (const registration of widgetRegistrations) {
      const otherChart = resolveChart(registration.widget);
      if (!otherChart || inspected.has(otherChart)) continue;
      inspected.add(otherChart);
      const bindings = instanceBindings.get(otherChart);
      if (!bindings) continue;
      for (const [otherId, binding] of bindings) {
        if (binding.token !== token || otherChart === chart && otherId === id) continue;
        const replacement = newInstanceBinding(otherChart, otherId, binding.inputsKey);
        try { otherChart.getStudyById(otherId).setInputValues([{ id: INSTANCE_INPUT, value: replacement.token }]); }
        catch (_) { /* This token is invalid already; a later audit retries the write. */ }
      }
    }
  }

  function claimChartCoordinator(chart) {
    if (!chart) return false;
    try {
      if (!chart[COORDINATOR]) Object.defineProperty(chart, COORDINATOR, { value: api, configurable: true });
      return chart[COORDINATOR] === api;
    } catch (_) { return false; }
  }

  function syncInstanceBindings(chart) {
    if (!claimChartCoordinator(chart)) return;
    if (!chart || bindingWrites.has(chart) || typeof chart.getAllStudies !== "function" ||
        typeof chart.getStudyById !== "function") return;
    bindingWrites.add(chart);
    try {
      const studies = chart.getAllStudies();
      if (!Array.isArray(studies)) return;
      let bindings = instanceBindings.get(chart);
      if (!bindings) instanceBindings.set(chart, bindings = new Map());
      const live = new Set(studies.map(study => study.id));
      for (const id of bindings.keys()) if (!live.has(id)) bindings.delete(id);
      for (const info of studies) {
        if (!INSTANCE_STUDIES.has(info.name) || info.id == null) continue;
        try {
          const study = chart.getStudyById(info.id);
          if (!study || typeof study.getInputValues !== "function" || typeof study.setInputValues !== "function") continue;
          const values = study.getInputValues();
          // Old metadata or an unsupported host is not permission to guess an owner.
          if (!Array.isArray(values) || !values.some(value => value.id === INSTANCE_INPUT)) continue;
          const inputsKey = JSON.stringify(values.filter(value => value.id !== INSTANCE_INPUT)
            .map(value => [value.id, value.value]).sort((a, b) => a[0].localeCompare(b[0])));
          const value = values.find(value => value.id === INSTANCE_INPUT).value;
          renewCopiedToken(value, chart, info.id);
          let binding = bindings.get(info.id);
          if (!binding || binding.inputsKey !== inputsKey) binding = newInstanceBinding(chart, info.id, inputsKey);
          if (value !== binding.token) study.setInputValues([{ id: INSTANCE_INPUT, value: binding.token }]);
        } catch (_) { /* The lifecycle audit retries after native study initialization. */ }
      }
    } catch (_) { /* Chart loading may temporarily hide its study APIs. */ }
    finally { bindingWrites.delete(chart); }
  }

  function resolveOwnerStudyId(chart, studyName, instanceToken) {
    if (!chart || typeof chart.getAllStudies !== "function") return null;
    try {
      const studies = chart.getAllStudies();
      if (!Array.isArray(studies)) return null;
      const matches = studies.filter(study => {
        const name = study && typeof study.name === "string" ? study.name : "";
        return studyName ? name === studyName : name === "Liquidity - [Tamer Zaky]" || name === "Alpha by Tamer Zaky";
      });
      if (instanceToken !== undefined) {
        if (typeof instanceToken !== "string" || !instanceToken) return null;
        const bindings = instanceBindings.get(chart);
        const matched = matches.filter(study => {
          if (!bindings || !bindings.get(study.id) || bindings.get(study.id).token !== instanceToken) return false;
          const api = chart.getStudyById(study.id);
          return api.getInputValues().some(value => value.id === INSTANCE_INPUT && value.value === instanceToken);
        });
        return matched.length === 1 ? matched[0].id : null;
      }
      // Compatibility for pure model consumers and old fixtures only. New study
      // publishers always include instanceToken, including the unbound empty value.
      return matches.length === 1 && matches[0].id !== undefined ? matches[0].id : null;
    } catch (_) { return null; }
  }

  function resolveInstance(instanceToken, studyName, visited = new Set()) {
    if (visited.has(api)) return null;
    visited.add(api);
    for (const registration of widgetRegistrations) {
      const chart = resolveChart(registration.widget);
      const coordinator = chart && chart[COORDINATOR];
      if (coordinator && coordinator !== api) {
        const instance = coordinator.resolveInstance(instanceToken, studyName, visited);
        if (instance) return instance;
        continue;
      }
      const ownerStudyId = resolveOwnerStudyId(chart, studyName, instanceToken);
      if (ownerStudyId !== null) return { chart, ownerStudyId };
    }
    for (const renderer of delegatedRenderers.keys()) {
      const instance = renderer.resolveInstance(instanceToken, studyName, visited);
      if (instance) return instance;
    }
    return null;
  }

  function isThenable(value) {
    return value && typeof value.then === "function";
  }

  function repairHistoricalAnchor(chart, record, adapter, errors, force) {
    if (!record || record.cancelled || record.entityId == null ||
        adapter && typeof adapter.createEntity === "function" ||
        !chart || typeof chart.getShapeById !== "function") return false;
    const snapshot = record.snapshot;
    if (!snapshot || !snapshot.points || !snapshot.points.length) return false;
    try {
      const shape = chart.getShapeById(record.entityId);
      if (!shape || typeof shape.getPoints !== "function" || typeof shape.setPoints !== "function") return false;
      const before = JSON.stringify(shape.getPoints());
      // Native creation converts time to an index before awaiting the line-tool
      // module. History can move that index in EITHER direction while it waits.
      // Reproject the original timestamps after creation and each history load.
      // Remember the library's normalized result (session/between-bar snapping)
      // so unchanged publications do not fight legitimate time normalization.
      if (!force && record.resolvedPoints === before) return false;
      shape.setPoints(snapshot.points);
      record.resolvedPoints = JSON.stringify(shape.getPoints());
      return record.resolvedPoints !== before;
    } catch (error) {
      if (errors) errors.push({ phase: "reanchor", logicalId: snapshot.id, message: String(error && error.message || error) });
      return false;
    }
  }

  function removeRecordDrawing(chart, adapter, store, logicalId, record, errors) {
    if (!record || typeof record !== "object") {
      if (record !== undefined && record !== null) requestDeletion(chart, adapter, record, logicalId, errors);
      return;
    }
    record.cancelled = true;
    if (record.entityId !== undefined && record.entityId !== null) {
      requestDeletion(record.chart || chart, adapter, record.entityId, logicalId, errors, record.ownerStudyId);
      return;
    }
    // The creation continuation owns late cleanup. Adding another continuation
    // here would remove the same async entity twice.
  }

  function reconcileDrawings(chart, model, registry, adapter) {
    const store = registry && typeof registry === "object" ? registry : new Map();
    const ownerStudyId = resolveOwnerStudyId(chart, model && model.studyName, model && model.instanceToken);
    const usesAdapter = Boolean(adapter && typeof adapter.createEntity === "function");
    // Never turn a stale snapshot into independently saved chart drawings.
    // Native entities must be attached to an existing custom study.
    const snapshots = usesAdapter || ownerStudyId !== null ? drawingSnapshots(model) : [];
    const desired = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
    const created = [];
    const removed = [];
    const unchanged = [];
    const reanchored = [];
    const errors = [];
    retryDeletions(chart, errors);

    for (const [logicalId, record] of registryEntries(store)) {
      if (!isAlphaOwnedId(logicalId)) continue;
      const snapshot = desired.get(logicalId);
      const fingerprint = snapshot ? JSON.stringify([ownerStudyId, snapshot]) : null;
      const savedFingerprint = record && typeof record === "object" ? record.fingerprint : null;
      if (!snapshot || savedFingerprint !== fingerprint || record.cancelled || record.chart && record.chart !== chart ||
          !enforceDrawingOwnership(chart, record, adapter, errors)) {
        try {
          removeRecordDrawing(chart, adapter, store, logicalId, record, errors);
          removed.push(logicalId);
        } catch (error) {
          errors.push({ phase: "remove", logicalId, message: String(error && error.message || error) });
        }
        registryDelete(store, logicalId);
      } else {
        if (repairHistoricalAnchor(chart, record, adapter, errors)) reanchored.push(logicalId);
        unchanged.push(logicalId);
        desired.delete(logicalId);
      }
    }

    for (const [logicalId, snapshot] of desired) {
      if (Array.from(pendingDeletions).some(item => item.chart === chart && item.logicalId === logicalId && item.ownerStudyId === ownerStudyId)) continue;
      try {
        const createdEntity = createDrawing(chart, adapter, snapshot, ownerStudyId);
        const record = {
          entityId: null,
          chart,
          ownerStudyId,
          studyName: model && model.studyName,
          instanceToken: model && model.instanceToken,
          context: model && model.context,
          snapshot,
          fingerprint: JSON.stringify([ownerStudyId, snapshot]),
          pending: null,
          cancelled: false,
        };
        registrySet(store, logicalId, record);
        if (isThenable(createdEntity)) {
          record.pending = Promise.resolve(createdEntity).then(function storeEntityId(entityId) {
            record.entityId = entityId;
            record.pending = null;
            const current = registryGet(store, logicalId);
            const ownerExists = usesAdapter || resolveOwnerStudyId(chart, model && model.studyName, model && model.instanceToken) === ownerStudyId && matchesChartContext(chart, model.context);
            if (current === record && !record.cancelled && ownerExists && enforceDrawingOwnership(chart, record, adapter, errors)) {
              if (repairHistoricalAnchor(chart, record, adapter, errors, true)) reanchored.push(logicalId);
            } else {
              removeRecordDrawing(chart, adapter, store, logicalId, record, errors);
              if (current === record) registryDelete(store, logicalId);
            }
            return entityId;
          }).catch(function recordCreationError(error) {
            errors.push({ phase: "create", logicalId, message: String(error && error.message || error) });
            if (registryGet(store, logicalId) === record) registryDelete(store, logicalId);
          });
        } else {
          record.entityId = createdEntity;
          const ownerExists = usesAdapter || resolveOwnerStudyId(chart, model && model.studyName, model && model.instanceToken) === ownerStudyId && matchesChartContext(chart, model.context);
          if (!ownerExists || !enforceDrawingOwnership(chart, record, adapter, errors)) {
            removeRecordDrawing(chart, adapter, store, logicalId, record, errors);
            registryDelete(store, logicalId);
          } else if (repairHistoricalAnchor(chart, record, adapter, errors)) reanchored.push(logicalId);
        }
        created.push(logicalId);
      } catch (error) {
        errors.push({ phase: "create", logicalId, message: String(error && error.message || error) });
      }
    }

    return { registry: store, created, removed, unchanged, reanchored, errors };
  }

  function clearAlphaDrawings(chart, registry, adapter) {
    const store = registry && typeof registry === "object" ? registry : new Map();
    const removed = [];
    const errors = [];
    retryDeletions(chart, errors);
    for (const [logicalId, record] of registryEntries(store)) {
      if (!isAlphaOwnedId(logicalId)) continue;
      try {
        removeRecordDrawing(chart, adapter, store, logicalId, record, errors);
        removed.push(logicalId);
      } catch (error) {
        errors.push({ logicalId, message: String(error && error.message || error) });
      }
      registryDelete(store, logicalId);
    }
    return { registry: store, removed, errors };
  }

  function renderRiskPanel(container, tableSnapshot, options) {
    if (!container || typeof container.appendChild !== "function") return null;
    const documentRef = container.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!documentRef || typeof documentRef.createElement !== "function") return null;

    const selector = '[data-alpha-owned="capital-risk"]';
    const existing = typeof container.querySelector === "function" ? container.querySelector(selector) : null;
    const duplicates = typeof container.querySelectorAll === "function"
      ? Array.from(container.querySelectorAll(selector)).filter((panel) => panel !== existing) : [];
    for (const duplicate of duplicates) {
      if (typeof duplicate.remove === "function") duplicate.remove();
    }
    if (!tableSnapshot) {
      if (existing && typeof existing.remove === "function") existing.remove();
      return null;
    }

    const panel = existing || documentRef.createElement("section");
    panel.setAttribute("data-alpha-owned", "capital-risk");
    panel.setAttribute("aria-label", "Alpha Capital Risk");
    panel.style.position = "absolute";
    panel.style.right = `${finite(options && options.right, 12)}px`;
    panel.style.top = `${finite(options && options.top, 50)}%`;
    panel.style.transform = "translateY(-50%)";
    panel.style.zIndex = "20";
    panel.style.background = tableSnapshot.style.background;
    panel.style.border = `${tableSnapshot.style.frameWidth}px solid ${tableSnapshot.style.frame}`;
    panel.style.font = "12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    panel.style.pointerEvents = "none";

    while (panel.firstChild) panel.removeChild(panel.firstChild);
    for (const row of tableSnapshot.rows) {
      const line = documentRef.createElement("div");
      line.style.display = "grid";
      line.style.gridTemplateColumns = "max-content max-content";

      const label = documentRef.createElement("span");
      label.textContent = row.label;
      label.style.padding = "5px 8px";
      label.style.background = tableSnapshot.style.labelBackground;
      label.style.color = tableSnapshot.style.labelColor;

      const value = documentRef.createElement("span");
      value.textContent = row.displayValue;
      value.style.padding = "5px 8px";
      value.style.background = tableSnapshot.style.valueBackground;
      value.style.color = tableSnapshot.style.valueColor;

      line.appendChild(label);
      line.appendChild(value);
      panel.appendChild(line);
    }

    if (!existing) container.appendChild(panel);
    return panel;
  }

  function resolveChart(widget) {
    if (!widget) return null;
    try {
      if (typeof widget.activeChart === "function") return widget.activeChart();
      if (typeof widget.chart === "function") return widget.chart();
      if (typeof widget.createMultipointShape === "function" || typeof widget.createShape === "function") return widget;
    } catch (_) {
      return null;
    }
    return null;
  }

  function isChartFrame() {
    if (!root || !root.parent || root.parent === root) return false;
    try {
      const frame = root.frameElement;
      const frameName = frame && (frame.id || frame.name || "");
      if (typeof frameName === "string" && frameName.indexOf("tradingview_") === 0) return true;
      const path = root.location && root.location.pathname;
      return typeof path === "string" && path.indexOf("/trading_platform/charting_library/") !== -1;
    } catch (_) {
      return false;
    }
  }

  function localRiskContainer(registration) {
    if (registration.options && registration.options.riskContainer) {
      return registration.options.riskContainer;
    }
    if (isChartFrame() && root.document && root.document.body) {
      return root.document.body;
    }
    return null;
  }

  function studyScope(snapshot) {
    const name = snapshot && typeof snapshot.studyName === "string" ? snapshot.studyName : "";
    return snapshot && snapshot.instanceToken !== undefined ? JSON.stringify([name, snapshot.instanceToken]) : name;
  }

  function sourceKey(snapshot) {
    return snapshot && snapshot.sourceId ? JSON.stringify([studyScope(snapshot), snapshot.sourceId]) : snapshot;
  }

  function cacheSnapshot(snapshot) {
    const context = snapshot.context || {};
    const ticker = String(context.tickerid || context.ticker || "").toLowerCase();
    const key = JSON.stringify([studyScope(snapshot), ticker, normalizeResolution(context.resolution)]);
    // Late metadata can enrich the identity without creating another dataset.
    for (const [previousKey, previous] of publishedSnapshots) {
      if (sourceKey(previous) === sourceKey(snapshot)) publishedSnapshots.delete(previousKey);
    }
    publishedSnapshots.set(key, snapshot);
  }

  function registryFor(registration, snapshot) {
    const scope = studyScope(snapshot);
    if (!registration.registries.has(scope)) registration.registries.set(scope, new Map());
    return registration.registries.get(scope);
  }

  function* registeredDrawings(registration) {
    for (const registry of registration.registries.values()) {
      for (const [logicalId, record] of registry) yield { registry, logicalId, record };
    }
  }

  function clearRegisteredDrawings(registration) {
    for (const registry of registration.registries.values()) {
      clearAlphaDrawings(registration.chart, registry, registration.options.adapter);
    }
    registration.registries.clear();
  }

  function clearChartState(registration) {
    if (root.__THNDR_ACTIVITY_PANEL__) root.__THNDR_ACTIVITY_PANEL__.clearChart(registration.chart);
    if (root.__THNDR_ATR_FIBONACCI_PANEL__) root.__THNDR_ATR_FIBONACCI_PANEL__.clearChart(registration.chart);
    clearRegisteredDrawings(registration);
    const sources = Array.from(registration.sourcesByOwner.values()).flatMap(owned => Array.from(owned));
    registration.sourcesByOwner.clear();
    retireUnusedSources(sources);
  }

  function releaseChartState(registration) {
    const state = registration.drawingState;
    if (!state) return;
    state.members.delete(registration);
    if (state.members.size === 0) {
      clearChartState(registration);
      sharedChartStates.delete(state.chart);
      instanceBindings.delete(state.chart);
      try { if (state.chart[COORDINATOR] === api) delete state.chart[COORDINATOR]; } catch (_) {}
    }
    registration.drawingState = null;
    registration.registries = new Map();
    registration.sourcesByOwner = new Map();
  }

  function attachChartState(registration, chart, key) {
    if (!chart) return;
    let state = sharedChartStates.get(chart);
    if (!state) {
      state = { chart, key, registries: new Map(), sourcesByOwner: new Map(), members: new Set() };
      sharedChartStates.set(chart, state);
    }
    state.members.add(registration);
    registration.drawingState = state;
    registration.registries = state.registries;
    registration.sourcesByOwner = state.sourcesByOwner;
    // A context transition clears shared state once, even when several widget
    // callbacks observe it. A second widget must not erase the new publication.
    if (state.key !== key) {
      clearChartState(registration);
      state.key = key;
    }
  }

  function retireUnusedSources(sources) {
    for (const source of sources) {
      const stillOwned = Array.from(widgetRegistrations).some(other =>
        Array.from(other.sourcesByOwner.values()).some(owned => owned.has(source)));
      if (!stillOwned) retiredSources.add(source);
    }
    for (const [key, snapshot] of publishedSnapshots) {
      if (retiredSources.has(sourceKey(snapshot))) publishedSnapshots.delete(key);
    }
  }

  function chartContext(chart) {
    try {
      const extended = typeof chart.symbolExt === "function" ? chart.symbolExt() : {};
      const ids = [typeof chart.symbol === "function" ? chart.symbol() : null,
        extended && extended.ticker, extended && extended.pro_name, extended && extended.name]
        .filter(value => typeof value === "string" && value).map(value => value.toLowerCase());
      const resolution = typeof chart.resolution === "function" ? chart.resolution() : null;
      return { ids, resolution: normalizeResolution(resolution) };
    } catch (_) { return { ids: [], resolution: null }; }
  }

  function normalizeResolution(value) {
    if (value === null || value === undefined || value === "") return null;
    const resolution = String(value).toUpperCase();
    return /^[DWM]$/.test(resolution) ? `1${resolution}` : resolution;
  }

  function matchesChartContext(chart, context) {
    if (!context) return true; // Compatibility for model-only/custom adapters.
    if (!chart) return false;
    const actual = chartContext(chart);
    const expected = [context.tickerid, context.ticker]
      .filter(value => typeof value === "string" && value).map(value => value.toLowerCase());
    return (!expected.length || expected.some(value => actual.ids.includes(value))) &&
      (!context.resolution || normalizeResolution(context.resolution) === actual.resolution);
  }

  function renderRegistration(registration, snapshot) {
    const chart = resolveChart(registration.widget);
    if (registration.syncChart) registration.syncChart(chart);
    const coordinator = chart && chart[COORDINATOR];
    if (coordinator && coordinator !== api) {
      const result = coordinator.publishSnapshot(snapshot, { relayed: true });
      return result.reports.find(report => report.chartAvailable) ||
        { widget: registration.widget, chartAvailable: false, drawingReport: null };
    }
    if (registration.cleanupRestored) registration.cleanupRestored(chart);
    syncInstanceBindings(chart);
    let drawingReport = null;
    const contextMatched = matchesChartContext(chart, snapshot && snapshot.context);
    if (chart && contextMatched && !retiredSources.has(sourceKey(snapshot))) {
      const ownerStudyId = resolveOwnerStudyId(chart, snapshot && snapshot.studyName, snapshot && snapshot.instanceToken);
      if (snapshot.instanceToken !== undefined && ownerStudyId === null) {
        return { widget: registration.widget, chartAvailable: false, drawingReport: null };
      }
      if (ownerStudyId !== null) {
        if (!registration.sourcesByOwner.has(ownerStudyId)) registration.sourcesByOwner.set(ownerStudyId, new Set());
        registration.sourcesByOwner.get(ownerStudyId).add(sourceKey(snapshot));
      }
      drawingReport = reconcileDrawings(chart, snapshot, registryFor(registration, snapshot), registration.options.adapter);
    }
    const container = localRiskContainer(registration);
    if (container && contextMatched) renderRiskPanel(container, snapshot && snapshot.table, registration.options.riskPanel);
    return { widget: registration.widget, chartAvailable: Boolean(chart) && contextMatched, drawingReport };
  }

  function publishLocal(snapshot) {
    const reports = [];
    for (const registration of widgetRegistrations) {
      reports.push(renderRegistration(registration, snapshot));
    }

    // A custom-study instance may publish from inside the same-origin chart
    // iframe before the outer widget has been intercepted.  The capital-risk
    // panel can still be rendered locally without touching the host page.
    if (widgetRegistrations.size === 0 && isChartFrame() && root.document && root.document.body) {
      renderRiskPanel(root.document.body, snapshot && snapshot.table);
    } else if (root && root.parent === root && root.document && root.document.body) {
      // Earlier builds also rendered a second panel in the outer page. Remove
      // only our owned panel so a hot-reloaded extension cannot leave it there.
      renderRiskPanel(root.document.body, null);
    }
    return reports;
  }

  function relayToChildFrames(snapshot) {
    if (!root || !root.frames || !Number.isFinite(root.frames.length)) return [];
    const childResults = [];
    for (let index = 0; index < root.frames.length; index += 1) {
      try {
        const childApi = root.frames[index].__THNDR_ALPHA_RENDERER__;
        if (childApi && childApi !== apiPlaceholder && typeof childApi.publishSnapshot === "function") {
          childResults.push(childApi.publishSnapshot(snapshot, { relayed: true }));
        }
      } catch (_) {
        // Cross-origin frames are intentionally ignored.
      }
    }
    return childResults;
  }

  function publishSnapshot(snapshot, internal) {
    if (!snapshot || snapshot.owner !== OWNER || retiredSources.has(sourceKey(snapshot))) {
      return { accepted: false, relayed: false, reports: [] };
    }

    if (!(internal && internal.relayed)) {
      for (const renderer of delegatedRenderers.keys()) renderer.publishSnapshot(snapshot, { relayed: true });
    }
    cacheSnapshot(snapshot);
    const reports = publishLocal(snapshot);
    let relayed = false;
    let childResults = [];

    if (!(internal && internal.relayed) && root && root.parent === root) {
      childResults = relayToChildFrames(snapshot);
      relayed = childResults.length > 0;
    }

    if (!(internal && internal.relayed) && root && root.parent && root.parent !== root) {
      try {
        const parentApi = root.parent.__THNDR_ALPHA_RENDERER__;
        if (parentApi && parentApi !== apiPlaceholder && typeof parentApi.publishSnapshot === "function") {
          parentApi.publishSnapshot(snapshot, { relayed: true });
          relayed = true;
        }
      } catch (_) {
        // Cross-origin parent access is expected to fail; local rendering still
        // succeeds and no host permissions are widened.
      }
    }

    const chartTargets = reports.filter((report) => report.chartAvailable).length;
    const childReports = childResults.flatMap((result) => result && Array.isArray(result.reports) ? result.reports : []);
    const childChartTargets = childReports.filter((report) => report.chartAvailable).length;
    const drawingCount = drawingSnapshots(snapshot).length;
    const drawingReports = [...reports, ...childReports]
      .filter((report) => report.drawingReport)
      .map((report) => ({
        attempted: report.drawingReport.created.length,
        removed: report.drawingReport.removed.length,
        reanchored: report.drawingReport.reanchored.length,
        // The Drawing API can reject asynchronously. Keep the live array so a
        // later inspection shows those errors, not only synchronous failures.
        errors: report.drawingReport.errors,
      }));
    const diagnostics = {
      widgetTargets: widgetRegistrations.size,
      localChartTargets: chartTargets,
      childChartTargets,
      computedBarCount: snapshot.barCount || 0,
      boxes: Array.isArray(snapshot.boxes) ? snapshot.boxes.length : 0,
      lines: Array.isArray(snapshot.lines) ? snapshot.lines.length : 0,
      polylines: Array.isArray(snapshot.polylines) ? snapshot.polylines.length : 0,
      hasCapitalRisk: Boolean(snapshot.table),
      moduleDrawings: {
        liquidity: snapshot.modules && snapshot.modules.liquidity
          ? snapshot.modules.liquidity.boxes.length + snapshot.modules.liquidity.lines.length : 0,
        trendLines: snapshot.modules && snapshot.modules.trendLines
          ? snapshot.modules.trendLines.polylines.length : 0,
        orderBlocks: snapshot.modules && snapshot.modules.orderBlocks
          ? snapshot.modules.orderBlocks.boxes.length : 0,
      },
      liquidityDelivery: snapshot.nativeLiquidity ? "native-study-plots" : "drawing-api",
      deliveryStatus: drawingCount === 0 ?
        snapshot.nativeLiquidity && snapshot.modules && snapshot.modules.liquidity &&
        (snapshot.modules.liquidity.boxes.length + snapshot.modules.liquidity.lines.length) > 0
          ? "native-study-plots" : "no-calculated-drawings" :
        chartTargets + childChartTargets === 0 ? "no-chart-api-target" : "drawing-api-attempted",
      drawingReports,
    };
    if (root) root.__THNDR_ALPHA_DIAGNOSTICS__ = diagnostics;
    return { accepted: true, relayed, reports, diagnostics };
  }

  function retainRegistration(registration) {
    registration.references++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--registration.references === 0) registration.dispose();
    };
  }

  function registerWidget(widget, options) {
    if (!widget) return function noopUnregister() {};
    const initialChart = resolveChart(widget);
    const coordinator = initialChart && initialChart[COORDINATOR];
    if (coordinator && coordinator !== api && typeof coordinator.registerWidget === "function") {
      delegatedRenderers.set(coordinator, (delegatedRenderers.get(coordinator) || 0) + 1);
      const stop = coordinator.registerWidget(widget, options);
      let released = false;
      return () => {
        if (released) return;
        released = true; stop();
        const remaining = delegatedRenderers.get(coordinator) - 1;
        if (remaining) delegatedRenderers.set(coordinator, remaining); else delegatedRenderers.delete(coordinator);
      };
    }
    for (const existing of widgetRegistrations) {
      if (existing.widget === widget) return retainRegistration(existing);
    }
    if (initialChart && !coordinator) {
      try { Object.defineProperty(initialChart, COORDINATOR, { value: api, configurable: true }); }
      catch (_) {
        // A non-extensible host API cannot be given competing token authorities.
        // Prefer the existing same-origin parent coordinator when available.
        try {
          const parent = root.parent && root.parent !== root && root.parent.__THNDR_ALPHA_RENDERER__;
          if (parent && parent !== api) return parent.registerWidget(widget, options);
        } catch (_) {}
      }
    }
    const registration = {
      references: 0,
      dispose: null,
      widget,
      options: options && typeof options === "object" ? options : {},
      drawingState: null,
      registries: new Map(),
      sourcesByOwner: new Map(),
      active: true,
      subscribed: false,
      propertiesSubscribed: false,
      visibilitySource: null,
      chart: null,
      chartKey: null,
      contextSubscriptions: [],
      lifecycleTimer: null,
      repairFrame: null,
      dataSubscription: null,
    };
    widgetRegistrations.add(registration);

    const auditActivity = () => {
      const chart = registration.chart;
      if (!chart) return;
      for (const [panel, name] of [[root.__THNDR_ACTIVITY_PANEL__, "EGX Activity - [Tamer Zaky]"],
        [root.__THNDR_ATR_FIBONACCI_PANEL__, "ATR Fibonacci Trend"]]) {
        if (!panel) continue;
        try {
          const doc = typeof registration.options.getDocument === "function" ? registration.options.getDocument() :
            isChartFrame() ? root.document : null;
          panel.auditChart(chart, { document: doc,
            visible: id => ownerVisibility(chart, id),
            owns: (id, token) => resolveOwnerStudyId(chart, name, token) === id });
        } catch (_) { /* Study UI must never interrupt drawings or the host chart. */ }
      }
    };

    const maintainDrawingOwners = () => {
      if (!registration.active) return;
      const chart = resolveChart(widget);
      registration.syncChart(chart);
      if (!claimChartCoordinator(chart)) return;
      retryDeletions();
      registration.cleanupRestored(chart);
      let studies;
      try { studies = chart && chart.getAllStudies(); } catch (_) { return; }
      if (!Array.isArray(studies)) return;
      syncInstanceBindings(chart);
      const owners = new Set(studies.map(study => study.id));
      for (const [owner, sources] of registration.sourcesByOwner) {
        if (owners.has(owner)) continue;
        registration.sourcesByOwner.delete(owner);
        retireUnusedSources(sources);
      }
      for (const { registry, logicalId, record } of registeredDrawings(registration)) {
        if (!isAlphaOwnedId(logicalId)) continue;
        if (!owners.has(record.ownerStudyId) || !matchesChartContext(chart, record.context) ||
            record.instanceToken !== undefined && resolveOwnerStudyId(chart, record.studyName, record.instanceToken) !== record.ownerStudyId ||
            !enforceDrawingOwnership(record.chart || chart, record, registration.options.adapter)) {
          removeRecordDrawing(chart, registration.options.adapter, registry, logicalId, record);
          registry.delete(logicalId);
        }
      }
      auditActivity();
    };

    const repairLoadedDrawings = () => {
      if (!registration.active) return;
      maintainDrawingOwners();
      const chart = resolveChart(widget);
      registration.syncChart(chart);
      if (!claimChartCoordinator(chart)) return;
      registration.cleanupRestored(chart);
      migrateLegacyDrawings(chart);
      // A new dataset can publish before the chart switches its time scale.
      // Only retry a scoped, non-retired model once its matching owner is ready.
      for (const snapshot of publishedSnapshots.values()) {
        if (snapshot.context && registryFor(registration, snapshot).size === 0 &&
            resolveOwnerStudyId(chart, snapshot.studyName, snapshot.instanceToken) !== null &&
            !retiredSources.has(sourceKey(snapshot)) && matchesChartContext(chart, snapshot.context)) {
          renderRegistration(registration, snapshot);
        }
      }
      // Repair only tracked records attached to the current owner.
      for (const { logicalId, record } of registeredDrawings(registration)) {
        if (isAlphaOwnedId(logicalId) && record.ownerStudyId !== null &&
            record.ownerStudyId === resolveOwnerStudyId(chart, record.studyName, record.instanceToken) &&
            matchesChartContext(chart, record.context)) {
          repairHistoricalAnchor(chart, record, registration.options.adapter, null, true);
        }
      }
    };

    const onDataLoaded = () => {
      repairLoadedDrawings();
      // Some library builds finish updating the time scale after notifying
      // listeners. Run once more before the next paint, coalescing load events.
      if (!registration.active || registration.repairFrame !== null || typeof root.requestAnimationFrame !== "function") return;
      registration.repairFrame = root.requestAnimationFrame(() => {
        registration.repairFrame = null;
        repairLoadedDrawings();
      });
    };

    const onContextChanged = () => {
      if (registration.active) registration.syncChart(resolveChart(widget));
    };
    registration.syncChart = chart => {
      if (chart && registration.visibilitySource) chartIndicatorVisibility.set(chart, registration.visibilitySource);
      const context = chart && chartContext(chart);
      // symbolExt aliases may arrive later without changing the instrument.
      const key = context ? JSON.stringify([context.ids[0] || null, context.resolution]) : null;
      if (registration.chart === chart && registration.chartKey === key) return;
      const container = localRiskContainer(registration);
      if (container) renderRiskPanel(container, null);
      if (registration.chart !== chart) {
        releaseChartState(registration);
        if (registration.dataSubscription) {
          try { registration.dataSubscription.unsubscribe(null, onDataLoaded); } catch (_) {}
          registration.dataSubscription = null;
        }
        for (const subscription of registration.contextSubscriptions) {
          try { subscription.unsubscribe(null, onContextChanged); } catch (_) {}
        }
        registration.contextSubscriptions = [];
        if (chart && typeof chart.onDataLoaded === "function") {
          const subscription = chart.onDataLoaded();
          subscription.subscribe(null, onDataLoaded);
          registration.dataSubscription = subscription;
        }
        for (const method of ["onSymbolChanged", "onIntervalChanged"]) {
          if (!chart || typeof chart[method] !== "function") continue;
          const subscription = chart[method]();
          subscription.subscribe(null, onContextChanged);
          registration.contextSubscriptions.push(subscription);
        }
      }
      registration.chart = chart;
      registration.chartKey = key;
      attachChartState(registration, chart, key);
    };

    registration.cleanupRestored = cleanupRestoredDrawings;

    const onStudyPropertiesChanged = entityId => {
      if (!registration.active) return;
      const chart = resolveChart(widget);
      registration.syncChart(chart);
      syncInstanceBindings(chart);
      for (const { record } of registeredDrawings(registration)) {
        if (record.ownerStudyId === entityId) syncDrawingVisibility(record.chart || chart, record, registration.options.adapter);
      }
      auditActivity();
    };

    const onAllIndicatorsVisibilityChanged = () => {
      if (registration.active) maintainDrawingOwners();
    };

    const onStudyEvent = (entityId, event) => {
      if (!registration.active) return;
      const chart = resolveChart(widget);
      if (event === "create" || event === "paste_study") {
        syncInstanceBindings(chart);
        registration.cleanupRestored(chart);
        // Initial calculation can precede study registration on a closed
        // market. Retry once the owner exists, without waiting for a new tick.
        for (const snapshot of publishedSnapshots.values()) {
          if (resolveOwnerStudyId(chart, snapshot.studyName, snapshot.instanceToken) === entityId) renderRegistration(registration, snapshot);
        }
        // Undo may append the restored children after its study event fires.
        onDataLoaded();
        auditActivity();
        return;
      }
      if (event !== "remove") return;
      const bindings = instanceBindings.get(chart);
      if (bindings) bindings.delete(entityId);
      const errors = [];
      const sources = registration.sourcesByOwner.get(entityId);
      if (sources) {
        registration.sourcesByOwner.delete(entityId);
        retireUnusedSources(sources);
      }
      for (const { registry, logicalId, record } of registeredDrawings(registration)) {
        if (!isAlphaOwnedId(logicalId) || record.ownerStudyId !== entityId) continue;
        try {
          removeRecordDrawing(chart, registration.options.adapter, registry, logicalId, record, errors);
        } catch (_) {
          // The library may already have removed the study's attached entities.
        }
        registry.delete(logicalId);
      }
      auditActivity();
    };

    const replay = () => {
      if (!registration.active) return;
      if (!registration.visibilitySource && typeof widget.hideAllIndicators === "function") {
        try {
          const source = widget.hideAllIndicators();
          if (source && typeof source.value === "function" && typeof source.subscribe === "function") {
            source.subscribe(onAllIndicatorsVisibilityChanged);
            registration.visibilitySource = source;
          }
        } catch (_) { /* Individual study visibility remains available. */ }
      }
      if (!registration.subscribed && typeof widget.subscribe === "function") {
        widget.subscribe("study_event", onStudyEvent);
        registration.subscribed = true;
      }
      if (!registration.propertiesSubscribed && typeof widget.subscribe === "function") {
        try {
          widget.subscribe("study_properties_changed", onStudyPropertiesChanged);
          registration.propertiesSubscribed = true;
        } catch (_) { /* Older hosts still synchronize during the lifecycle audit. */ }
      }
      const chart = resolveChart(widget);
      registration.syncChart(chart);
      if (chart) {
        syncInstanceBindings(chart);
        migrateLegacyDrawings(chart);
        for (const snapshot of publishedSnapshots.values()) renderRegistration(registration, snapshot);
        auditActivity();
      }
    };
    try {
      if (typeof widget.onChartReady === "function") widget.onChartReady(replay);
      else replay();
    } catch (_) {
      // Widget readiness is best effort. A later publish will try again.
    }
    // Deletion/events can be missed even when no new bar arrives. This light
    // audit only reads owned entities and keeps no timer after unregister.
    if (typeof root.setInterval === "function") {
      registration.lifecycleTimer = root.setInterval(maintainDrawingOwners, 1000);
      if (registration.lifecycleTimer && typeof registration.lifecycleTimer.unref === "function") registration.lifecycleTimer.unref();
    }

    registration.dispose = function unregisterWidget() {
      if (!registration.active) return;
      registration.active = false;
      if (registration.lifecycleTimer !== null && typeof root.clearInterval === "function") {
        root.clearInterval(registration.lifecycleTimer);
      }
      if (registration.repairFrame !== null && typeof root.cancelAnimationFrame === "function") {
        root.cancelAnimationFrame(registration.repairFrame);
      }
      if (registration.dataSubscription) {
        try { registration.dataSubscription.unsubscribe(null, onDataLoaded); } catch (_) { /* Chart may be destroyed. */ }
      }
      for (const subscription of registration.contextSubscriptions) {
        try { subscription.unsubscribe(null, onContextChanged); } catch (_) {}
      }
      if (registration.subscribed && typeof widget.unsubscribe === "function") {
        try { widget.unsubscribe("study_event", onStudyEvent); } catch (_) { /* Widget may be destroyed. */ }
      }
      if (registration.propertiesSubscribed && typeof widget.unsubscribe === "function") {
        try { widget.unsubscribe("study_properties_changed", onStudyPropertiesChanged); } catch (_) {}
      }
      if (registration.visibilitySource && typeof registration.visibilitySource.unsubscribe === "function") {
        try { registration.visibilitySource.unsubscribe(onAllIndicatorsVisibilityChanged); } catch (_) {}
      }
      registration.cleanupRestored(registration.chart);
      widgetRegistrations.delete(registration);
      releaseChartState(registration);
      const container = localRiskContainer(registration);
      if (container) renderRiskPanel(container, null);
    };
    return retainRegistration(registration);
  }

  // The factory return value is not assigned until the end of execution.  A
  // unique marker lets child-frame relay avoid calling back into itself.
  const apiPlaceholder = {};

  const api = Object.freeze({
    OWNER,
    INSTANCE_INPUT,
    resolveInstance,
    MODEL_VERSION,
    DEFAULT_SETTINGS,
    normalizeSettings,
    normalizeBars,
    computeLiquidity,
    computeTrendLines,
    orderBlockChanges,
    computeOrderBlocks,
    createOrderBlockReplay,
    computeCapitalRisk,
    computeSnapshots,
    isAlphaOwnedId,
    drawingSnapshots,
    reconcileDrawings,
    clearAlphaDrawings,
    drawingLifecycleStatus,
    renderRiskPanel,
    registerWidget,
    publishSnapshot,
  });
  return api;
});
