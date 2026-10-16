/* MAIN-world client. Prices come through the isolated extension bridge only. */
(function installPivotClient(root, factory) {
  "use strict";
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.__THNDR_PIVOT_SCANNER__ = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildPivotClient(root) {
  "use strict";
  const ORIGIN = "https://x.thndr.app", CHANNEL = "tamer-ai-sr:v1";
  const pending = new Map(), authListeners = new Set();
  const prefix = Date.now().toString(36) + Math.random().toString(36).slice(2);
  let sequence = 0;
  let authBlocked = false;
  const errors = new Set(["authentication_required", "not_authorized", "timeout", "busy",
    "rate_limited", "service_unavailable", "invalid_request", "invalid_response"]);

  function normalizeTicker(raw) {
    if (typeof raw !== "string" || raw.length > 80) return "";
    const value = raw.trim().toUpperCase().replace(/^EGX_DLY:/, "EGX:");
    return /^EGX:[A-Z0-9][A-Z0-9._/-]{0,63}$/.test(value) ? value : "";
  }
  function normalizeInterval(raw) {
    if (typeof raw !== "string" && typeof raw !== "number") return "";
    let value = String(raw).trim();
    if (value.length > 12) return "";
    if (/^[DWM]$/.test(value)) value = "1" + value;
    if (/^\d+m$/.test(value)) value = value.slice(0, -1);
    if (/^\d+h$/i.test(value)) value = String(Number(value.slice(0, -1)) * 60);
    if (/^\d+[dw]$/.test(value)) value = value.toUpperCase();
    const match = /^(\d+)([DWM]?)$/.exec(value);
    if (!match || Number(match[1]) < 1 || Number(match[1]) > (match[2] ? 999 : 999999)) return "";
    return String(Number(match[1])) + match[2];
  }
  function boundaryDelay(interval, now) {
    const value = normalizeInterval(interval), date = new Date(now);
    let next;
    if (/^\d+$/.test(value)) {
      const span = Number(value) * 60000;
      next = (Math.floor(now / span) + 1) * span;
    } else if (/^\d+D$/.test(value)) {
      const span = Number(value.slice(0, -1)) * 86400000;
      next = (Math.floor(now / span) + 1) * span;
    } else if (/^\d+W$/.test(value)) {
      const sunday = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - date.getUTCDay());
      next = sunday + Number(value.slice(0, -1)) * 7 * 86400000;
    } else if (/^\d+M$/.test(value)) {
      const months = Number(value.slice(0, -1)), month = date.getUTCMonth();
      next = Date.UTC(date.getUTCFullYear(), month - month % months + months, 1);
    }
    return Number.isFinite(next) ? Math.max(1000, next - now + 1500) : null;
  }
  function failure(code) {
    const error = new Error("AI Support & Resistance request failed.");
    error.code = errors.has(code) ? code : "service_unavailable";
    return error;
  }
  function validateResult(raw, ticker, interval) {
    const now = Date.now();
    if (!raw || raw.ticker !== ticker || raw.interval !== interval ||
        !Number.isFinite(raw.fetchedAt) || !Number.isFinite(raw.expiresAt) ||
        raw.fetchedAt > now + 30000 || raw.expiresAt <= now || raw.expiresAt <= raw.fetchedAt ||
        raw.expiresAt - raw.fetchedAt > 300000 || typeof raw.fromCache !== "boolean") return null;
    const fallback = { interval, plain: "", "daily-fallback": "1D" };
    if (!Object.prototype.hasOwnProperty.call(fallback, raw.fallback) || raw.scannerInterval !== fallback[raw.fallback]) return null;
    const seen = new Set();
    function levels(list, side) {
      if (!Array.isArray(list) || list.length > 9) return null;
      const result = [];
      for (const level of list) {
        if (!level || !["Fibonacci", "Classic", "Woodie"].includes(level.method) ||
            level.side !== side || ![1, 2, 3].includes(level.level) || !Number.isFinite(level.price)) return null;
        const id = level.method.toLowerCase() + "_" + (side === "support" ? "s" : "r") + level.level;
        if (level.id !== id || seen.has(id)) return null;
        seen.add(id);
        result.push({ id, method: level.method, side, level: level.level, price: level.price });
      }
      return result;
    }
    const supports = levels(raw.supports, "support"), resistances = levels(raw.resistances, "resistance");
    if (!supports || !resistances || !seen.size) return null;
    return { ticker, interval, supports, resistances, scannerInterval: raw.scannerInterval,
      fallback: raw.fallback, fromCache: raw.fromCache, fetchedAt: raw.fetchedAt, expiresAt: raw.expiresAt };
  }
  function finish(id, error, result) {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    root.clearTimeout(entry.timer);
    if (error) entry.reject(error); else entry.resolve(result);
  }
  function invalidateAuth(code) {
    authBlocked = true;
    for (const id of Array.from(pending.keys())) finish(id, failure(code));
    for (const callback of authListeners) { try { callback(); } catch (_) {} }
  }
  if (root && typeof root.addEventListener === "function") root.addEventListener("message", function receive(event) {
    if (event.source !== root || event.origin !== ORIGIN) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL) return;
    if (Object.keys(data).sort().join(",") === "authenticated,channel,direction,type" &&
        data.direction === "event" && data.type === "AI_SR_AUTH" && data.authenticated === false) {
      invalidateAuth("authentication_required"); return;
    }
    if (data.direction !== "response" || data.type !== "AI_SR_LEVELS" || typeof data.id !== "string") return;
    if (Object.keys(data).sort().join(",") !== (data.ok === true ?
      "channel,direction,id,ok,result,type" : "channel,direction,error,id,ok,type")) return;
    const entry = pending.get(data.id);
    if (!entry) return;
    if (data.ok === false && errors.has(data.error)) {
      if (data.error === "authentication_required" || data.error === "not_authorized") invalidateAuth(data.error);
      else finish(data.id, failure(data.error));
    } else if (data.ok === true) {
      const result = validateResult(data.result, entry.ticker, entry.interval);
      finish(data.id, result ? null : failure("invalid_response"), result);
    }
  });
  function fetchLevels(rawTicker, rawInterval) {
    const ticker = normalizeTicker(rawTicker), interval = normalizeInterval(rawInterval);
    if (!ticker || !interval) return Promise.resolve(null);
    if (authBlocked) return Promise.reject(failure("authentication_required"));
    if (!root || !root.location || root.location.origin !== ORIGIN || typeof root.postMessage !== "function") {
      return Promise.reject(failure("service_unavailable"));
    }
    for (const entry of pending.values()) if (entry.ticker === ticker && entry.interval === interval) return entry.promise;
    if (pending.size >= 8) return Promise.reject(failure("busy"));
    const id = prefix + ":" + (++sequence);
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const entry = { ticker, interval, promise, resolve, reject,
      timer: root.setTimeout(() => finish(id, failure("timeout")), 24000) };
    pending.set(id, entry);
    try { root.postMessage({ channel: CHANNEL, direction: "request", type: "AI_SR_LEVELS", id, ticker, interval }, ORIGIN); }
    catch (_) { finish(id, failure("service_unavailable")); }
    return promise;
  }
  function onAuthInvalidated(callback) {
    authListeners.add(callback);
    return () => authListeners.delete(callback);
  }
  return Object.freeze({ normalizeTicker, normalizeInterval, boundaryDelay, fetchLevels, onAuthInvalidated });
});
