(function manageGoogleSignIn() {
  "use strict";

  const SCRIPT_ID = "tamer-studies-signed-in";
  const BRIDGE_ID = "tamer-api-bridge-signed-in";
  const THNDR_URL = "https://x.thndr.app/*";
  const THNDR_ORIGIN = "https://x.thndr.app";
  const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
  const USERS_URL = "https://api.tamerzaky.com/v1/users";
  const AI_SR_URL = "https://api.tamerzaky.com/v1/indicators/ai-sr";
  const CONSENT_VERSION = "2026-10-01-v2";
  const SILENT_TOKEN_TIMEOUT = 10000;
  const INTERACTIVE_TOKEN_TIMEOUT = 90000;
  const NETWORK_TIMEOUT = 8000;
  const SCRIPT_FILES = [
    "src/legacy-drawings.js",
    "src/alpha-renderer.js",
    "src/alpha-study.js",
    "src/pivot-scanner.js",
    "src/indicator-alerts.js",
    "src/zone-alerts.js",
    "src/pivot-points.js",
    "src/egx-activity.js",
    "src/activity-study.js",
    "src/activity-panel.js",
    "src/atr-fibonacci.js",
    "src/atr-fibonacci-study.js",
    "src/atr-fibonacci-panel.js",
    "src/tamer-studies.js",
    "src/indicator-panel.js",
    "src/injector.js"
  ];
  let work = Promise.resolve();
  let pendingStatus = null;
  let authGeneration = 0;
  let signInEpoch = 0;
  let authBlocked = false;
  const aiRequests = new Set();

  function invalidateRequests() {
    authGeneration += 1;
    authBlocked = true;
    for (const request of aiRequests) request.cancel();
  }

  function serial(task) {
    const next = work.then(() => task());
    work = next.catch(() => {});
    return next;
  }

  // Bound the awaited stage, not the whole action: a late token/response must
  // never continue into activation after the queue has moved on to sign-out.
  async function within(promise, milliseconds, onTimeout = () => {}) {
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error("انتهت مهلة الاتصال. اتأكد من الإنترنت وحاول مرة ثانية.");
        error.code = "AUTH_TIMEOUT";
        reject(error);
        onTimeout();
      }, milliseconds);
    });
    try { return await Promise.race([promise, deadline]); }
    finally { clearTimeout(timer); }
  }

  async function fetchJson(url, options) {
    const controller = new AbortController();
    const request = (async () => {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (!response.ok) {
        const error = new Error("تعذّر التحقق من الحساب. حاول مرة ثانية.");
        error.status = response.status;
        throw error;
      }
      return response.json();
    })();
    // Include reading the body; headers alone do not complete the request.
    return within(request, NETWORK_TIMEOUT, () => controller.abort());
  }

  function queueStatus(forceReload = false) {
    if (!forceReload && pendingStatus) return pendingStatus;
    const request = serial(() => status(forceReload));
    pendingStatus = request;
    const clear = () => { if (pendingStatus === request) pendingStatus = null; };
    request.then(clear, clear);
    return request;
  }

  async function registeredScripts() {
    return chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID, BRIDGE_ID] });
  }

  async function enableStudies() {
    const existing = await registeredScripts();
    const common = {
      matches: [THNDR_URL],
      runAt: "document_start",
      allFrames: true,
      matchOriginAsFallback: true,
      persistAcrossSessions: false
    };
    const desired = [
      { ...common, id: SCRIPT_ID, js: SCRIPT_FILES, world: "MAIN" },
      { ...common, id: BRIDGE_ID, js: ["src/api-bridge.js"], world: "ISOLATED" }
    ];
    if (existing.length === desired.length && desired.every((target) => {
      const actual = existing.find((item) => item.id === target.id);
      return actual && Object.keys(target).every((key) => JSON.stringify(actual[key]) === JSON.stringify(target[key]));
    })) return false;
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing.map((item) => item.id) });
    await chrome.scripting.registerContentScripts(desired);
    return true;
  }

  async function disableStudies() {
    const existing = await registeredScripts();
    if (!existing.length) return false;
    await chrome.scripting.unregisterContentScripts({ ids: existing.map((item) => item.id) });
    return true;
  }

  async function reloadThndrTabs() {
    let tabs;
    try { tabs = await within(chrome.tabs.query({ url: THNDR_URL }), 3000); }
    catch (_) { return 1; }
    const results = await Promise.allSettled(tabs
      .filter((tab) => Number.isInteger(tab.id))
      .map((tab) => within(chrome.tabs.reload(tab.id), 3000)));
    return results.filter((result) => result.status === "rejected").length;
  }

  async function googleUser(interactive) {
    const response = await within(chrome.identity.getAuthToken({ interactive }),
      interactive ? INTERACTIVE_TOKEN_TIMEOUT : SILENT_TOKEN_TIMEOUT);
    const token = typeof response === "string" ? response : response && response.token;
    if (!token) throw new Error("Google did not return a sign-in token.");

    let user;
    try {
      user = await fetchJson(USERINFO_URL, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store"
      });
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        await within(chrome.identity.removeCachedAuthToken({ token }), 3000).catch(() => {});
      }
      throw error;
    }
    if (!user || !user.sub || !user.email || user.email_verified !== true) {
      throw new Error("Google did not return a verified email address.");
    }
    return { email: user.email, token };
  }

  async function userRequest(user, method, operation = "touch") {
    return fetchJson(USERS_URL, {
      method,
      headers: {
        Authorization: `Bearer ${user.token}`,
        "Content-Type": "application/json"
      },
      body: method === "POST" ? JSON.stringify({
        operation,
        consent: true,
        consentVersion: CONSENT_VERSION,
        purpose: "account-access-support",
        source: "tamer-zaky-indicators-chrome-extension",
        extensionVersion: chrome.runtime.getManifest().version
      }) : undefined,
      cache: "no-store"
    });
  }

  async function lock(clearGoogleToken, reload) {
    invalidateRequests();
    await chrome.storage.local.set({
      googleSignInEnabled: false,
      emailRegistryEnabled: false,
      serviceDataConsent: false
    });
    const wasActive = await disableStudies();
    let notice;
    if (clearGoogleToken) {
      try {
        await within(chrome.identity.clearAllCachedAuthTokens(), 3000);
      } catch (_error) {
        notice = "Studies are locked, but Google could not fully clear its cached session.";
      }
    }
    const reloadFailures = (wasActive || reload) ? await reloadThndrTabs() : 0;
    return { authenticated: false, reloadFailures, notice };
  }

  async function status(forceReload) {
    const generation = authGeneration;
    const saved = await chrome.storage.local.get(["googleSignInEnabled", "emailRegistryEnabled"]);
    if (authBlocked || saved.googleSignInEnabled !== true || saved.emailRegistryEnabled !== true) {
      await disableStudies();
      return { authenticated: false };
    }
    try {
      const user = await googleUser(false);
      if (generation !== authGeneration) return { authenticated: false };
      let notice;
      try {
        await userRequest(user, "POST");
      } catch (error) {
        if (error.status === 401 || error.status === 403) throw error;
        notice = "المؤشرات تعمل، لكن تعذّر تحديث آخر استخدام على السيرفر.";
      }
      if (generation !== authGeneration) return { authenticated: false };
      const newlyEnabled = await enableStudies();
      if (generation !== authGeneration) return { authenticated: false };
      authBlocked = false;
      const reloadFailures = newlyEnabled || forceReload ? await reloadThndrTabs() : 0;
      if (generation !== authGeneration) return { authenticated: false };
      return { authenticated: true, email: user.email, reloadFailures, notice };
    } catch (error) {
      await lock(false, false);
      return { authenticated: false, notice: error.code === "AUTH_TIMEOUT"
        ? "انتهت مهلة التحقق من Google. اتأكد من الإنترنت وسجّل الدخول مرة ثانية."
        : "تعذّر التحقق من حساب Google أو تفعيل المؤشرات. سجّل الدخول مرة ثانية." };
    }
  }

  async function signIn() {
    const generation = authGeneration;
    const user = await googleUser(true);
    if (generation !== authGeneration) throw new Error("Sign-in was cancelled. Please sign in again.");
    try {
      await userRequest(user, "POST", "activate");
      if (generation !== authGeneration) throw new Error("Sign-in was cancelled. Please sign in again.");
      await chrome.storage.local.set({ googleSignInEnabled: true, emailRegistryEnabled: true });
      await enableStudies();
      if (generation !== authGeneration) throw new Error("Sign-in was cancelled. Please sign in again.");
      authBlocked = false;
      const reloadFailures = await reloadThndrTabs();
      if (generation !== authGeneration) return { authenticated: false };
      return { authenticated: true, email: user.email, reloadFailures };
    } catch (error) {
      await lock(false, false);
      throw error;
    }
  }

  async function deleteAccount() {
    const generation = authGeneration;
    let user;
    try {
      user = await googleUser(false);
      await userRequest(user, "DELETE");
      return lock(true, true);
    } catch (error) {
      // A failed response does not prove the server failed to delete. Verify
      // membership only after an explicit error response. A timed-out DELETE
      // may still commit after a successful touch, so uncertainty stays locked.
      if (user && error.status >= 400 && error.status < 500 && generation === authGeneration) {
        try {
          await userRequest(user, "POST", "touch");
          if (generation !== authGeneration) return { authenticated: false };
          await enableStudies();
          if (generation !== authGeneration) return { authenticated: false };
          authBlocked = false;
          // Cancellation may already have locked the page's AI bridge. A
          // fresh page restores its local auth state as well as the worker's.
          const reloadFailures = await reloadThndrTabs();
          if (generation !== authGeneration) return { authenticated: false };
          return { authenticated: true, email: user.email, reloadFailures,
            notice: "تعذّر حذف البيانات. حسابك ما زال مفعّلًا؛ حاول الحذف مرة ثانية." +
              (reloadFailures ? " حدّث تبويبات ثاندر يدويًا لاستعادة المؤشرات." : "") };
        } catch (_verificationError) { /* Keep the session locked when uncertain. */ }
      }
      if (generation !== authGeneration) return { authenticated: false };
      const result = await lock(false, true);
      return { ...result, notice: "تعذّر تأكيد حذف البيانات. الإضافة متوقفة؛ حاول لاحقًا أو تواصل مع الدعم." };
    }
  }

  function validAIRequest(message, sender) {
    if (!sender || sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab && sender.tab.id)) return false;
    try {
      if (new URL(sender.url).origin !== THNDR_ORIGIN ||
          (sender.origin !== undefined && sender.origin !== THNDR_ORIGIN)) return false;
    } catch (_) { return false; }
    return Object.keys(message).sort().join(",") === "interval,ticker,type" &&
      typeof message.ticker === "string" && /^EGX:[A-Z0-9][A-Z0-9._/-]{0,63}$/.test(message.ticker) &&
      typeof message.interval === "string" && /^(?:[1-9]\d{0,5}|[1-9]\d{0,2}[DWM])$/.test(message.interval);
  }

  // Return only typed indicator fields. Neither server extras nor auth details cross the bridge.
  function publicResult(raw, request) {
    const now = Date.now();
    if (!raw || raw.ticker !== request.ticker || raw.interval !== request.interval ||
        !Number.isFinite(raw.fetchedAt) || !Number.isFinite(raw.expiresAt) ||
        raw.fetchedAt > now + 30000 || raw.expiresAt <= now || raw.expiresAt <= raw.fetchedAt ||
        raw.expiresAt - raw.fetchedAt > 300000 || typeof raw.fromCache !== "boolean") return null;
    const fallback = { interval: request.interval, plain: "", "daily-fallback": "1D" };
    if (!Object.prototype.hasOwnProperty.call(fallback, raw.fallback) || raw.scannerInterval !== fallback[raw.fallback]) return null;
    const seen = new Set();
    function levels(items, side) {
      if (!Array.isArray(items) || items.length > 9) return null;
      const result = [];
      for (const item of items) {
        if (!item || !["Fibonacci", "Classic", "Woodie"].includes(item.method) || item.side !== side ||
            ![1, 2, 3].includes(item.level) || !Number.isFinite(item.price)) return null;
        const id = item.method.toLowerCase() + "_" + (side === "support" ? "s" : "r") + item.level;
        if (item.id !== id || seen.has(id)) return null;
        seen.add(id);
        result.push({ id, method: item.method, side, level: item.level, price: item.price });
      }
      return result;
    }
    const supports = levels(raw.supports, "support"), resistances = levels(raw.resistances, "resistance");
    if (!supports || !resistances || !seen.size) return null;
    return { ticker: request.ticker, interval: request.interval, supports, resistances,
      scannerInterval: raw.scannerInterval, fallback: raw.fallback, fromCache: raw.fromCache,
      fetchedAt: raw.fetchedAt, expiresAt: raw.expiresAt };
  }

  async function aiLevels(message, sender) {
    if (authBlocked) return { ok: false, error: "authentication_required" };
    const senderKey = sender.tab.id + ":" + (sender.frameId || 0);
    if (aiRequests.size >= 32 || Array.from(aiRequests).filter((item) => item.senderKey === senderKey).length >= 8)
      return { ok: false, error: "busy" };
    const generation = authGeneration, controller = new AbortController();
    let timer, cancel;
    const deadline = new Promise((resolve) => {
      cancel = () => { controller.abort(); resolve({ ok: false, error: "authentication_required" }); };
      timer = setTimeout(() => { controller.abort(); resolve({ ok: false, error: "timeout" }); }, 20000);
    });
    const record = { senderKey, cancel };
    aiRequests.add(record);
    const allowed = () => generation === authGeneration && !controller.signal.aborted;
    const operation = (async () => {
      const saved = await chrome.storage.local.get(["googleSignInEnabled", "emailRegistryEnabled"]);
      if (!allowed() || saved.googleSignInEnabled !== true || saved.emailRegistryEnabled !== true)
        return { ok: false, error: "authentication_required" };
      let token;
      try {
        const auth = await chrome.identity.getAuthToken({ interactive: false });
        token = typeof auth === "string" ? auth : auth && auth.token;
      } catch (_) { return { ok: false, error: "authentication_required" }; }
      if (!allowed() || !token) return { ok: false, error: "authentication_required" };
      const response = await fetch(AI_SR_URL, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: message.ticker, interval: message.interval }),
        cache: "no-store", redirect: "error", signal: controller.signal
      });
      if (!allowed()) return { ok: false, error: "authentication_required" };
      if (!response.ok) return { ok: false, error: response.status === 401 ? "authentication_required" :
        response.status === 403 ? "not_authorized" : response.status === 429 ? "rate_limited" :
          response.status === 400 ? "invalid_request" : "service_unavailable" };
      const body = await response.json();
      if (!allowed()) return { ok: false, error: "authentication_required" };
      const result = body && body.ok === true && publicResult(body.result, message);
      return result ? { ok: true, result } : { ok: false, error: "invalid_response" };
    })().catch(() => ({ ok: false, error: "service_unavailable" }));
    try {
      const result = await Promise.race([operation, deadline]);
      if (generation === authGeneration && (result.error === "authentication_required" || result.error === "not_authorized")) {
        signInEpoch += 1;
        invalidateRequests();
        // Notify every isolated frame immediately, without waiting for the auth action queue.
        await chrome.storage.local.set({ googleSignInEnabled: false, emailRegistryEnabled: false });
        serial(disableStudies).catch(() => {});
      }
      return result;
    } finally { clearTimeout(timer); aiRequests.delete(record); }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!sender || sender.id !== chrome.runtime.id || !message || typeof message.type !== "string") {
      return false;
    }
    if (message.type === "AI_SR_LEVELS") {
      if (!validAIRequest(message, sender)) return false;
      aiLevels(message, sender).then(sendResponse).catch(() => sendResponse({ ok: false, error: "service_unavailable" }));
      return true;
    }
    const actions = {
      AUTH_STATUS: status,
      AUTH_SIGN_IN: signIn,
      AUTH_SIGN_OUT: () => lock(true, true),
      ACCOUNT_DELETE: deleteAccount
    };
    const action = actions[message.type];
    if (!action) return false;
    if (message.type === "AUTH_SIGN_OUT" || message.type === "ACCOUNT_DELETE") {
      signInEpoch += 1;
      invalidateRequests();
    }
    const epoch = signInEpoch;
    if (message.type !== "AUTH_STATUS") pendingStatus = null;
    (message.type === "AUTH_STATUS" ? queueStatus() : serial(() => {
      if (message.type === "AUTH_SIGN_IN" && epoch !== signInEpoch)
        throw new Error("Sign-in was cancelled. Please sign in again.");
      return action();
    }))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message || "Sign-in failed.", code: error.code }));
    return true;
  });

  chrome.runtime.onInstalled.addListener((details) => {
    // Revalidate the saved Google session and refresh a previous script bundle.
    // A code update alone must not leave the authenticated chart on old files.
    queueStatus(details && details.reason === "update").catch(() => {});
  });

  chrome.runtime.onStartup.addListener(() => {
    queueStatus().catch(() => {});
  });
})();
