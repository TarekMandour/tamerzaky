(function installThndrCustomIndicators() {
  "use strict";

  var PATCH_MARKER = "__thndrTamerStudiesPatchedV1";
  var MAX_RETRIES = 120;
  var studyApi = globalThis.__THNDR_TAMER_STUDIES__;
  var capturedWidgets = [];
  var widgetRegistrations = new Map();
  var lastFrameworkScan = 0;
  var directDiscoveryTimer = null;

  if (!studyApi || typeof studyApi.createStudies !== "function") return;

  function captureWidget(candidate, frame) {
    if (!candidate) return;
    if (widgetRegistrations.has(candidate)) {
      if (frame) widgetRegistrations.get(candidate).frames.add(frame);
      return;
    }
    if (typeof candidate.activeChart !== "function" && typeof candidate.chart !== "function") return;
    var renderer = window.__THNDR_ALPHA_RENDERER__;
    if (!renderer || typeof renderer.registerWidget !== "function") return;
    capturedWidgets.push(candidate);
    widgetRegistrations.set(candidate, {
      frames: new Set(frame ? [frame] : []),
      unregister: renderer.registerWidget(candidate, {
        getDocument: function getChartDocument() {
          try {
            var known = widgetRegistrations.get(candidate);
            var currentFrame = known && Array.from(known.frames).find(function (item) { return item.isConnected !== false; }) || frame;
            return currentFrame ? currentFrame.contentDocument : window !== window.top ? document : null;
          } catch (_) { return null; }
        },
        getTheme: function getHostTheme() {
          try {
            var known = widgetRegistrations.get(candidate);
            var currentFrame = known && Array.from(known.frames).find(function connected(item) { return item.isConnected !== false; }) || frame;
            var doc = currentFrame ? currentFrame.contentDocument : document;
            var element = doc && doc.documentElement;
            if (!element) return undefined;
            var theme = element.getAttribute("data-theme");
            if (theme === "light" || theme === "dark") return theme;
            if (element.classList.contains("theme-light")) return "light";
            if (element.classList.contains("theme-dark")) return "dark";
          } catch (_error) { /* Detached or cross-origin frames expose no theme. */ }
          return undefined;
        }
      })
    });
  }

  function releaseWidget(widget, registration) {
    if (typeof registration.unregister === "function") registration.unregister();
    widgetRegistrations.delete(widget);
    var index = capturedWidgets.indexOf(widget);
    if (index !== -1) capturedWidgets.splice(index, 1);
  }

  function chartFrames() {
    return document.querySelectorAll
      ? Array.from(document.querySelectorAll('iframe[id^="tradingview_"], iframe[name^="tradingview_"]')) : [];
  }

  function captureDirectFrameApi(frame) {
    var candidate;
    try { candidate = frame.contentWindow && frame.contentWindow.tradingViewApi; }
    catch (_error) { return false; }
    if (!candidate || typeof candidate.activeChart !== "function") return false;
    widgetRegistrations.forEach(function replaceOldFrameApi(registration, widget) {
      if (widget === candidate || !registration.frames.has(frame)) return;
      registration.frames.delete(frame);
      if (!registration.frames.size) releaseWidget(widget, registration);
    });
    captureWidget(candidate, frame);
    return widgetRegistrations.has(candidate);
  }

  function discoverDirectFrameApis() {
    directDiscoveryTimer = null;
    var frames = chartFrames();
    if (!frames.length) return;
    frames.forEach(captureDirectFrameApi);
    if (!capturedWidgets.length) directDiscoveryTimer = setTimeout(discoverDirectFrameApis, 500);
  }

  function scheduleDirectDiscovery() {
    if (capturedWidgets.length || directDiscoveryTimer !== null || !chartFrames().length) return;
    directDiscoveryTimer = setTimeout(discoverDirectFrameApis, 500);
  }

  function inspectFrameworkValue(value, depth, state) {
    if (!value || depth < 0 || state.remaining <= 0 ||
        (typeof value !== "object" && typeof value !== "function")) return;
    if (value.nodeType || state.seen.has(value)) return;
    state.seen.add(value);
    state.remaining -= 1;
    captureWidget(value, state.frame);

    var keys;
    try { keys = Object.getOwnPropertyNames(value); } catch (_error) { return; }
    keys.forEach(function inspectKey(key) {
      if (key === "child" || key === "sibling" || key === "alternate" ||
          key === "window" || key === "document" || key === "parent" ||
          key === "top" || key === "constructor" || key === "prototype") return;
      var descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (_error) { return; }
      if (descriptor && "value" in descriptor) {
        inspectFrameworkValue(descriptor.value, depth - 1, state);
      }
    });
  }

  function inspectChartFramework() {
    if (!document.querySelectorAll) return;
    var frames = chartFrames();
    widgetRegistrations.forEach(function pruneDetached(registration, widget) {
      if (!registration.frames.size || Array.from(registration.frames).some(function present(frame) { return frames.indexOf(frame) !== -1; })) return;
      releaseWidget(widget, registration);
    });
    frames.forEach(captureDirectFrameApi);
    scheduleDirectDiscovery();
    if (Date.now() - lastFrameworkScan < 250) return;
    lastFrameworkScan = Date.now();
    frames.forEach(function inspectFrame(frame) {
      if (captureDirectFrameApi(frame)) return;
      var element = frame;
      for (var level = 0; element && level < 6; level += 1, element = element.parentElement) {
        var keys;
        try { keys = Object.getOwnPropertyNames(element); } catch (_error) { continue; }
        keys.forEach(function inspectProperty(key) {
          if (!/^__react(?:Fiber|Props|Container)\$/.test(key)) return;
          var descriptor;
          try { descriptor = Object.getOwnPropertyDescriptor(element, key); } catch (_error) { return; }
          if (descriptor && "value" in descriptor) {
            inspectFrameworkValue(descriptor.value, 12, { seen: new WeakSet(), remaining: 800, frame: frame });
          }
        });
      }
    });
  }

  function appendStudies(PineJS, existingGetter, receiver) {
    var existing;
    try {
      existing = typeof existingGetter === "function"
        ? existingGetter.call(receiver, PineJS)
        : [];
    } catch (error) {
      console.warn("[Thndr Custom Indicators] Existing indicator loader failed.", error);
      existing = [];
    }

    return Promise.resolve(existing)
      .catch(function recoverExisting(error) {
        console.warn("[Thndr Custom Indicators] Existing indicators could not be loaded.", error);
        return [];
      })
      .then(function append(indicators) {
        var merged = Array.isArray(indicators) ? indicators.slice() : [];
        studyApi.createStudies(PineJS).forEach(function add(definition) {
          if (!merged.some(function sameId(item) {
            return item && item.metainfo && item.metainfo.id === definition.metainfo.id;
          })) merged.push(definition);
        });
        return merged;
      });
  }

  function patchBridge(ownerWindow, id) {
    if (!ownerWindow || !id) return false;
    var bridge;
    try {
      bridge = ownerWindow[id];
    } catch (_error) {
      return false;
    }
    if (!bridge || typeof bridge !== "object") return false;
    if (bridge[PATCH_MARKER]) return true;

    var original = bridge.getCustomIndicators;
    try {
      bridge.getCustomIndicators = function getCustomIndicators(PineJS) {
        return appendStudies(PineJS, original, this);
      };
      Object.defineProperty(bridge, PATCH_MARKER, { value: true });
    } catch (_error) {
      return false;
    }

    console.info("[Thndr Custom Indicators] Registered", studyApi.SPECS.map(function name(spec) {
      return spec.name;
    }));
    return true;
  }

  function patchKnownBridges(ownerWindow) {
    var keys;
    try {
      keys = Object.getOwnPropertyNames(ownerWindow);
    } catch (_error) {
      return false;
    }
    var patched = keys.reduce(function patch(found, key) {
      return key.indexOf("tradingview_") === 0
        ? patchBridge(ownerWindow, key) || found
        : found;
    }, false);
    if (ownerWindow === window && window === window.top) inspectChartFramework();
    return patched;
  }

  function inspectNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.tagName === "IFRAME") {
      patchBridge(window, node.id || node.name);
    }
    if (typeof node.querySelectorAll === "function") {
      node.querySelectorAll('iframe[id^="tradingview_"], iframe[name^="tradingview_"]').forEach(function patchFrame(frame) {
        patchBridge(window, frame.id || frame.name);
      });
    }
  }

  function observeTopDocument() {
    patchKnownBridges(window);
    var target = document.documentElement || document;
    var observer = new MutationObserver(function onMutations(mutations) {
      mutations.forEach(function inspect(mutation) {
        mutation.addedNodes.forEach(inspectNode);
      });
      patchKnownBridges(window);
    });
    observer.observe(target, { childList: true, subtree: true });

    (function retry(attempt) {
      patchKnownBridges(window);
      if (capturedWidgets.length || attempt >= MAX_RETRIES) return;
      setTimeout(function next() { retry(attempt + 1); }, 50);
    })(0);
  }

  function patchParent(attempt) {
    if (window === window.top) return;
    var parent;
    try {
      parent = window.parent;
    } catch (_error) {
      return;
    }
    if (patchKnownBridges(parent) || attempt >= MAX_RETRIES) return;
    setTimeout(function next() { patchParent(attempt + 1); }, 50);
  }

  if (window === window.top) {
    if (document.documentElement) observeTopDocument();
    else document.addEventListener("readystatechange", observeTopDocument, { once: true });
  } else {
    patchParent(0);
  }
})();
