/* Confirmed retest candidates for existing Liquidity and Order Block zones.
 * Pure calculation only: alert delivery and per-bar deduplication live elsewhere. */
(function registerZoneAlerts(root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.__THNDR_ZONE_ALERTS__ = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildZoneAlerts() {
  "use strict";

  var DIRECTIONS = {
    liquidityBullRetest: "buy", liquidityBearRetest: "sell",
    obBullRetest: "buy", obBearRetest: "sell"
  };

  function zoneMap(zones) {
    var result = new Map(), ambiguous = new Set();
    zones.forEach(function copy(zone) {
      if (!zone || typeof zone.id !== "string" || !zone.id ||
          typeof zone.condition !== "string" ||
          !Object.prototype.hasOwnProperty.call(DIRECTIONS, zone.condition) ||
          DIRECTIONS[zone.condition] !== zone.direction ||
          !Number.isFinite(zone.lower) || !Number.isFinite(zone.upper) || zone.lower > zone.upper) return;
      if (result.has(zone.id) || ambiguous.has(zone.id)) {
        result.delete(zone.id); ambiguous.add(zone.id); return;
      }
      var snapshot = { id: zone.id, direction: zone.direction, condition: zone.condition,
        lower: zone.lower, upper: zone.upper };
      if (typeof zone.label === "string") snapshot.label = zone.label;
      result.set(zone.id, snapshot);
    });
    return result;
  }

  function createTracker() {
    var signature, time, observedOpenLast = false, previous = new Map(), current = new Map();
    function reset() {
      signature = undefined; time = undefined; observedOpenLast = false; previous.clear(); current.clear();
    }
    return {
      update: function update(bar) {
        // Historical core calls have no computed snapshot. The one non-last
        // exception is the close of this same bar after observing it live/open;
        // its caller must still supply a fresh current zone snapshot.
        var knownClosingBar = bar && bar.time === time && observedOpenLast && bar.isBarClosed === true;
        if (!bar || (bar.isLastBar !== true && !knownClosingBar) || !Number.isFinite(bar.time) || !Array.isArray(bar.zones)) {
          reset(); return [];
        }
        var nextSignature = String(bar.signature == null ? "" : bar.signature);
        var next = zoneMap(bar.zones);
        if (nextSignature !== signature || time === undefined || bar.time < time) {
          signature = nextSignature; time = bar.time; previous = new Map(); current = next;
          observedOpenLast = bar.isLastBar === true && bar.isBarClosed === false;
          return [];
        }
        if (bar.time > time) { previous = current; time = bar.time; observedOpenLast = false; }
        if (bar.isLastBar === true && bar.isBarClosed === false) observedOpenLast = true;
        current = next;
        // Keep previous immutable across all ticks of the same candle, including
        // rollback: an intrabar-born zone only becomes eligible on the next bar.
        if (bar.isBarClosed !== true || !Number.isFinite(bar.previousClose) ||
            !Number.isFinite(bar.high) || !Number.isFinite(bar.low) || !Number.isFinite(bar.close) ||
            bar.high < bar.low || bar.close < bar.low || bar.close > bar.high) return [];
        var candidates = [];
        current.forEach(function retest(zone, id) {
          var prior = previous.get(id);
          if (!prior || prior.lower !== zone.lower || prior.upper !== zone.upper ||
              prior.direction !== zone.direction || prior.condition !== zone.condition) return;
          if (bar.low > zone.upper || bar.high < zone.lower) return;
          if (zone.direction === "buy"
            ? bar.previousClose > zone.upper && bar.close > zone.upper
            : bar.previousClose < zone.lower && bar.close < zone.lower) {
            candidates.push(Object.assign({}, zone));
          }
        });
        return candidates;
      }
    };
  }

  return Object.freeze({ createTracker: createTracker });
});
