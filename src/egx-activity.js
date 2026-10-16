/* Same-time EGX share-volume comparison. Pure calculation; no requests or signals. */
(function installEgxActivity(root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.__THNDR_EGX_ACTIVITY__ = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildEgxActivity() {
  "use strict";

  var TIME_ZONE = "Africa/Cairo";
  var SESSION_START_MINUTES = 600;
  // Regular EGX equity session, including the closing auction. A shortened or
  // sparse prior session is excluded whenever it cannot cover the same cutoff.
  var SESSION_END_MINUTES = 870;
  var SUPPORTED_INTERVALS = Object.freeze([1, 5, 10, 15, 30, 60]);
  var formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  });

  function seconds(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
    var time = value >= 1e11 ? value / 1000 : value;
    return Number.isFinite(new Date(time * 1000).getTime()) ? time : null;
  }

  function cairoParts(value) {
    var time = seconds(value);
    if (time === null) return null;
    var parts = {};
    formatter.formatToParts(new Date(time * 1000)).forEach(function (part) {
      if (part.type !== "literal") parts[part.type] = part.value;
    });
    return {
      date: parts.year + "-" + parts.month + "-" + parts.day,
      minutes: Number(parts.hour) * 60 + Number(parts.minute),
      second: Number(parts.second), time: time
    };
  }

  function activityLevel(ratio) {
    if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0) return null;
    if (ratio >= 2) return "high";
    if (ratio >= 1.5) return "above";
    if (ratio >= 0.75) return "normal";
    return "low";
  }

  function validVolume(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
  }

  // A complete 10:00 -> cutoff grid proves the beginning is present, including
  // on the first loaded date. Missing candles are unknown, never assumed zero.
  function sessionVolume(records, cutoff, interval) {
    var byMinute = new Map();
    for (var i = 0; i < records.length; i += 1) {
      var record = records[i];
      if (record.minutes < SESSION_START_MINUTES || record.minutes >= cutoff) continue;
      if (record.second !== 0 || record.time % 60 !== 0 ||
          (record.minutes - SESSION_START_MINUTES) % interval !== 0) {
        return { complete: false, reason: "unaligned_bars", volume: null };
      }
      byMinute.set(record.minutes, record);
    }
    var total = 0, count = 0;
    for (var minute = SESSION_START_MINUTES; minute < cutoff; minute += interval) {
      var bar = byMinute.get(minute);
      if (!bar) return { complete: false, reason: "missing_bars", volume: null };
      if (!bar.closed) return { complete: false, reason: "unclosed_bars", volume: null };
      if (!validVolume(bar.volume)) return { complete: false, reason: "missing_volume", volume: null };
      total += bar.volume;
      if (!Number.isFinite(total)) return { complete: false, reason: "invalid_volume_total", volume: null };
      count += 1;
    }
    return { complete: true, reason: null, volume: total, barCount: count };
  }

  function computeActivity(bars, options) {
    options = options || {};
    var lookback = options.lookback === undefined ? 20 : options.lookback;
    var minSessions = options.minSessions === undefined ? 5 : options.minSessions;
    var interval = typeof options.interval === "number" ? options.interval :
      (typeof options.interval === "string" && /^\d+$/.test(options.interval) ? Number(options.interval) : NaN);
    var result = {
      status: "insufficient", reason: null, ticker: options.ticker || null,
      unit: "shares", timeZone: TIME_ZONE, ratio: null, activityLevel: null,
      currentVolume: null, averageVolume: null, sessionCount: 0,
      lookback: lookback, minSessions: minSessions, intervalMinutes: Number.isFinite(interval) ? interval : null,
      sessionStartMinutes: SESSION_START_MINUTES, sessionEndMinutes: SESSION_END_MINUTES,
      cutoffMinutes: null, date: null, asOf: null, baselineDates: [],
      baselines: [], candidateSessionCount: 0, excludedSessionCount: 0,
      excludedSessions: [], ignoredOpenBars: 0, duplicateBars: 0, currentBarCount: 0
    };
    function finish(status, reason) {
      result.status = status;
      result.reason = reason;
      return result;
    }
    if (typeof options.ticker !== "string" || !/^EGX:[A-Z0-9][A-Z0-9._-]*$/i.test(options.ticker)) {
      return finish("unsupported", "egx_only");
    }
    result.ticker = options.ticker.toUpperCase();
    if (SUPPORTED_INTERVALS.indexOf(interval) === -1) return finish("unsupported", "unsupported_interval");
    if (!Number.isInteger(lookback) || lookback < 5 || lookback > 60 ||
        !Number.isInteger(minSessions) || minSessions < 1 || minSessions > lookback) {
      return finish("invalid", "invalid_options");
    }
    if (!Array.isArray(bars)) return finish("invalid", "invalid_bars");
    if (!bars.length) return finish("insufficient", "no_bars");

    // Last occurrence wins, including a correction that clears a volume or
    // reopens a candle. Never retain a stale valid copy over a new invalid copy.
    var byTime = new Map();
    for (var i = 0; i < bars.length; i += 1) {
      var bar = bars[i];
      if (!bar || typeof bar !== "object") return finish("invalid", "invalid_bars");
      var time = seconds(bar.time);
      if (time === null) return finish("invalid", "invalid_time");
      if (byTime.has(time)) result.duplicateBars += 1;
      byTime.set(time, bar);
    }
    var sessions = new Map();
    Array.from(byTime.keys()).sort(function (a, b) { return a - b; }).forEach(function (time) {
      var bar = byTime.get(time), record = cairoParts(time);
      record.volume = bar.volume;
      record.closed = bar.isBarClosed === true;
      if (!record.closed) result.ignoredOpenBars += 1;
      if (!sessions.has(record.date)) sessions.set(record.date, []);
      sessions.get(record.date).push(record);
    });
    var dates = Array.from(sessions.keys()).sort();
    // Use the newest observed session, not the newest closed session. An open
    // first candle on a new date must not show yesterday's result as today's.
    result.date = dates[dates.length - 1];
    var current = sessions.get(result.date);
    var closed = current.filter(function (bar) {
      return bar.closed && bar.minutes >= SESSION_START_MINUTES && bar.minutes < SESSION_END_MINUTES;
    });
    if (!closed.length) return finish("insufficient", "no_closed_bars");
    var lastClosed = closed[closed.length - 1];
    result.cutoffMinutes = Math.min(lastClosed.minutes + interval, SESSION_END_MINUTES);
    result.asOf = lastClosed.time + (result.cutoffMinutes - lastClosed.minutes) * 60;
    var currentSummary = sessionVolume(current, result.cutoffMinutes, interval);
    if (!currentSummary.complete) return finish("insufficient", "current_" + currentSummary.reason);
    result.currentVolume = currentSummary.volume;
    result.currentBarCount = currentSummary.barCount;

    var candidates = dates.slice(0, -1).slice(-lookback);
    result.candidateSessionCount = candidates.length;
    candidates.forEach(function (date) {
      var summary = sessionVolume(sessions.get(date), result.cutoffMinutes, interval);
      if (!summary.complete) {
        result.excludedSessions.push({ date: date, reason: summary.reason });
      } else {
        result.baselineDates.push(date);
        result.baselines.push({ date: date, volume: summary.volume });
      }
    });
    result.excludedSessionCount = result.excludedSessions.length;
    result.sessionCount = result.baselineDates.length;
    if (result.sessionCount < minSessions) return finish("insufficient", "insufficient_sessions");
    // Divide each term first to avoid overflowing an otherwise representable mean.
    result.averageVolume = result.baselines.reduce(function (total, session) {
      return total + session.volume / result.sessionCount;
    }, 0);
    if (!Number.isFinite(result.averageVolume)) return finish("invalid", "invalid_volume_total");
    if (result.averageVolume === 0) return finish("insufficient", "zero_baseline");
    var ratio = result.currentVolume / result.averageVolume;
    if (!Number.isFinite(ratio)) return finish("invalid", "invalid_ratio");
    result.ratio = ratio;
    result.activityLevel = activityLevel(ratio);
    return finish("ready", null);
  }

  return Object.freeze({
    computeActivity: computeActivity, cairoParts: cairoParts, activityLevel: activityLevel,
    TIME_ZONE: TIME_ZONE, SESSION_START_MINUTES: SESSION_START_MINUTES,
    SESSION_END_MINUTES: SESSION_END_MINUTES, SUPPORTED_INTERVALS: SUPPORTED_INTERVALS
  });
});
