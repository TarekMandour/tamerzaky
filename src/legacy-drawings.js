/* Pure recognition of the complete historical Liquidity drawing family.
 * This identifies candidates, never deletes them or proves their provenance.
 * Missing flags, partial families, mismatched signature fields, alternate
 * native style serialization, and ambiguous matches stay untouched. Time proportions
 * cannot be reconstructed: the host snaps future/session-gap points to bars.
 */
(function installLegacyDrawings(root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.__THNDR_LEGACY_DRAWINGS__ = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildLegacyDrawings() {
  "use strict";

  const COLORS = Object.freeze({
    resistance: "rgba(243,56,56,0.20)", support: "rgba(47,245,106,0.20)",
    bull: "rgba(45,205,42,0.40)", bear: "rgba(190,18,21,0.40)",
    positiveDelta: "rgba(0,255,0,0.25)", negativeDelta: "rgba(253,5,5,0.25)",
  });

  function samePrice(a, b) {
    // Allow floating-point arithmetic noise, never a price/tick-size margin.
    return Math.abs(a - b) <= Number.EPSILON * 16 * Math.max(1, Math.abs(a), Math.abs(b));
  }

  function eligible(shape, counts) {
    return shape && typeof shape.id === "string" && shape.id.length > 0 && counts.get(shape.id) === 1 &&
      shape.ownerSourceId === "_seriesId" && shape.saving === true &&
      shape.selectable === false && shape.editable === false &&
      shape.properties && typeof shape.properties === "object" &&
      Array.isArray(shape.points) && shape.points.length === 2 &&
      shape.points.every(point => point && Number.isFinite(point.time) && Number.isFinite(point.price));
  }

  function rectangle(shape, color, width, align) {
    const p = shape.properties;
    return shape.name === "rectangle" && p.backgroundColor === color &&
      p.color === "rgba(255,255,255,0)" && p.linewidth === width &&
      p.fillBackground === true && p.horzLabelsAlign === align &&
      p.vertLabelsAlign === "middle" && p.textColor === "#f0f0f0" &&
      p.extendLeft === false && p.extendRight === false && p.linestyle === 0;
  }

  function line(shape, color) {
    const p = shape.properties;
    return shape.name === "trend_line" && p.linecolor === color &&
      p.linewidth === 1 && p.linestyle === 2 && p.text === "" &&
      p.extendLeft === false && p.extendRight === false &&
      p.leftEnd === 0 && p.rightEnd === 0;
  }

  function percentage(shape, role) {
    if (typeof shape.properties.text !== "string") return null;
    const match = new RegExp(`^${role} % : (\\d{1,3}(?:\\.\\d{1,2})?)$`).exec(shape.properties.text);
    if (!match) return null;
    const value = Number(match[1]);
    return value >= 0 && value <= 100 ? Math.round(value * 100) : null;
  }

  function prices(shape, top, bottom) {
    return samePrice(shape.points[0].price, top) && samePrice(shape.points[1].price, bottom);
  }

  function only(items, predicate) {
    const matches = items.filter(predicate);
    return matches.length === 1 ? matches[0] : null;
  }

  /** Returns { ids: [zone, bull, bear, delta, midpoint, edge], kind }[]. */
  function findLegacyLiquidityGroups(shapeSnapshots) {
    if (!Array.isArray(shapeSnapshots)) return [];
    const counts = new Map();
    for (const shape of shapeSnapshots) {
      if (shape && typeof shape.id === "string") counts.set(shape.id, (counts.get(shape.id) || 0) + 1);
    }
    const shapes = shapeSnapshots.filter(shape => eligible(shape, counts));
    const proposals = [];
    for (const zone of shapes) {
      const kind = rectangle(zone, COLORS.resistance, 2, "center") ? "resistance" :
        rectangle(zone, COLORS.support, 2, "center") ? "support" : null;
      if (!kind || zone.properties.text !== "") continue;
      const [start, end] = zone.points;
      const top = start.price, bottom = end.price, middle = (top + bottom) / 2;
      if (!(top > bottom) || samePrice(top, bottom) || !(start.time < end.time)) continue;

      const half = (shape, color, role, high, low) => rectangle(shape, color, 1, "right") &&
        percentage(shape, role) !== null && prices(shape, high, low) &&
        shape.points[0].time === start.time && shape.points[1].time >= start.time &&
        shape.points[1].time <= end.time;
      const bull = only(shapes, shape => half(shape, COLORS.bull, "Bull",
        kind === "support" ? middle : top, kind === "support" ? bottom : middle));
      const bear = only(shapes, shape => half(shape, COLORS.bear, "Bear",
        kind === "support" ? top : middle, kind === "support" ? middle : bottom));
      if (!bull || !bear) continue;
      const bullPercent = percentage(bull, "Bull"), bearPercent = percentage(bear, "Bear");
      if (bullPercent + bearPercent !== 10000) continue;
      if (bullPercent === 0 && bull.points[1].time !== start.time ||
          bearPercent === 0 && bear.points[1].time !== start.time ||
          bullPercent > bearPercent && bull.points[1].time < bear.points[1].time ||
          bearPercent > bullPercent && bear.points[1].time < bull.points[1].time) continue;

      const color = bullPercent > 5000 ? "#00ff00" : "#ff0000";
      const delta = only(shapes, shape => {
        if (typeof shape.properties.text !== "string") return false;
        const match = /^Delta: (-?(?:0|[1-9]\d*))$/.exec(shape.properties.text);
        if (!match) return false;
        const value = Number(match[1]);
        if (!Number.isSafeInteger(value) || bullPercent > 5000 && value <= 0 ||
            bullPercent < 5000 && value >= 0 || bullPercent === 5000 && value !== 0) return false;
        return rectangle(shape, value > 0 ? COLORS.positiveDelta : COLORS.negativeDelta, 1, "center") &&
          prices(shape, top, bottom) && shape.points[0].time >= start.time &&
          shape.points[0].time <= end.time && shape.points[1].time === end.time;
      });
      if (!delta) continue;
      const markerTime = delta.points[0].time;
      if (bull.points[1].time > markerTime || bear.points[1].time > markerTime) continue;
      const midpoint = only(shapes, shape => line(shape, color) && prices(shape, middle, middle) &&
        shape.points[0].time === start.time && shape.points[1].time === markerTime);
      const edge = only(shapes, shape => line(shape, color) && prices(shape, top, bottom) &&
        shape.points[0].time === markerTime && shape.points[1].time === markerTime);
      if (!midpoint || !edge) continue;
      const ids = [zone.id, bull.id, bear.id, delta.id, midpoint.id, edge.id];
      if (new Set(ids).size === 6) proposals.push({ ids, kind });
    }

    // Two candidate zones may try to claim the same parts. Reject both; never
    // let iteration order choose which drawing family would be migrated.
    const claims = new Map();
    for (const group of proposals) for (const id of group.ids) claims.set(id, (claims.get(id) || 0) + 1);
    return proposals.filter(group => group.ids.every(id => claims.get(id) === 1));
  }

  return Object.freeze({ findLegacyLiquidityGroups });
});
