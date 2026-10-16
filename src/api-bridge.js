/* ISOLATED-world bridge: a single bounded RPC, with no tokens in page events. */
(function installApiBridge() {
  "use strict";
  const ORIGIN = "https://x.thndr.app", CHANNEL = "tamer-ai-sr:v1";
  if (location.origin !== ORIGIN || globalThis.__THNDR_API_BRIDGE_INSTALLED__) return;
  globalThis.__THNDR_API_BRIDGE_INSTALLED__ = true;
  const pending = new Map();
  const errors = new Set(["authentication_required", "not_authorized", "timeout", "busy",
    "rate_limited", "service_unavailable", "invalid_request", "invalid_response"]);
  function reply(id, response) {
    const entry = pending.get(id);
    if (entry === undefined) return;
    clearTimeout(entry);
    pending.delete(id);
    let payload = { ok: false, error: "service_unavailable" };
    if (response && response.ok === true && response.result && typeof response.result === "object") {
      const raw = response.result;
      const list = values => Array.isArray(values) && values.length <= 9 && values.every(level =>
        level && typeof level.id === "string" && level.id.length <= 20 &&
        ["Fibonacci", "Classic", "Woodie"].includes(level.method) &&
        ["support", "resistance"].includes(level.side) && [1, 2, 3].includes(level.level) && Number.isFinite(level.price))
        ? values.map(({ id, method, side, level, price }) => ({ id, method, side, level, price })) : null;
      const supports = list(raw.supports), resistances = list(raw.resistances);
      if (typeof raw.ticker === "string" && /^EGX:[A-Z0-9][A-Z0-9._/-]{0,63}$/.test(raw.ticker) &&
          typeof raw.interval === "string" && /^(?:[1-9]\d{0,5}|[1-9]\d{0,2}[DWM])$/.test(raw.interval) &&
          typeof raw.scannerInterval === "string" && raw.scannerInterval.length <= 6 &&
          ["interval", "plain", "daily-fallback"].includes(raw.fallback) && typeof raw.fromCache === "boolean" &&
          Number.isFinite(raw.fetchedAt) && Number.isFinite(raw.expiresAt) && supports && resistances) {
        payload = { ok: true, result: { ticker: raw.ticker, interval: raw.interval,
          supports, resistances, scannerInterval: raw.scannerInterval,
          fallback: raw.fallback, fromCache: raw.fromCache, fetchedAt: raw.fetchedAt, expiresAt: raw.expiresAt } };
      } else payload.error = "invalid_response";
    } else if (response && errors.has(response.error)) payload.error = response.error;
    window.postMessage({ channel: CHANNEL, direction: "response", type: "AI_SR_LEVELS", id, ...payload }, ORIGIN);
  }
  function invalidate() {
    for (const id of Array.from(pending.keys())) reply(id, { ok: false, error: "authentication_required" });
    window.postMessage({ channel: CHANNEL, direction: "event", type: "AI_SR_AUTH", authenticated: false }, ORIGIN);
  }
  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== ORIGIN) return;
    const data = event.data;
    if (!data || Object.keys(data).sort().join(",") !== "channel,direction,id,interval,ticker,type" ||
        data.channel !== CHANNEL || data.direction !== "request" || data.type !== "AI_SR_LEVELS" ||
        typeof data.id !== "string" || !/^[a-zA-Z0-9:._-]{1,100}$/.test(data.id) ||
        typeof data.ticker !== "string" || !/^EGX:[A-Z0-9][A-Z0-9._/-]{0,63}$/.test(data.ticker) ||
        typeof data.interval !== "string" || !/^(?:[1-9]\d{0,5}|[1-9]\d{0,2}[DWM])$/.test(data.interval) ||
        pending.has(data.id)) return;
    if (pending.size >= 8) return;
    pending.set(data.id, setTimeout(() => reply(data.id, { ok: false, error: "timeout" }), 22000));
    try {
      Promise.resolve(chrome.runtime.sendMessage({ type: "AI_SR_LEVELS", ticker: data.ticker, interval: data.interval }))
        .then(response => reply(data.id, response), () => reply(data.id, null));
    } catch (_) { reply(data.id, null); }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && ["googleSignInEnabled", "emailRegistryEnabled"].some(key =>
      changes[key] && changes[key].newValue !== true)) invalidate();
  });
})();
