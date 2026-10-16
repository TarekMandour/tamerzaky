/* Owned Arabic activity cards, reconciled by the existing chart lifecycle. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.__THNDR_ACTIVITY_PANEL__ = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";
  var NAME = "EGX Activity - [Tamer Zaky]", published = new Map(), charts = new Map();
  var reasons = {
    stock_only: "متاح لأسهم السوق المصري فقط.",
    egx_only: "متاح لأسهم السوق المصري فقط.",
    unsupported_interval: "اختَر فريم ١ أو ٥ أو ١٠ أو ١٥ أو ٣٠ أو ٦٠ دقيقة.",
    unsupported_ticker: "متاح لأسهم السوق المصري فقط.",
    no_closed_bars: "في انتظار إغلاق أول شمعة من الجلسة.",
    no_data: "في انتظار بيانات حجم التداول.",
    no_bars: "في انتظار بيانات حجم التداول.",
    current_missing_volume: "بيانات حجم التداول ناقصة في الجلسة المعروضة؛ المقارنة غير متاحة.",
    current_missing_bars: "شموع ناقصة من افتتاح الجلسة حتى المقارنة. حمّل تاريخًا إضافيًا أو جرّب فريمًا أكبر.",
    current_unclosed_bars: "بعض شموع الفترة لم تتأكد بعد؛ المقارنة غير متاحة.",
    current_unaligned_bars: "توقيت الشموع لا يطابق جلسة EGX المعتادة؛ المقارنة غير متاحة.",
    zero_baseline: "متوسط المقارنة صفر؛ لا يمكن حساب نسبة موثوقة.",
    incomplete_current_session: "بيانات الجلسة الحالية غير مكتملة من الافتتاح. حمّل تاريخًا إضافيًا أو جرّب فريمًا أكبر.",
    insufficient_sessions: "نحتاج ٥ جلسات سابقة مكتملة على الأقل حتى نفس الوقت. حمّل تاريخًا إضافيًا أو جرّب فريمًا أكبر."
  };
  var number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  function timeLabel(minutes) {
    return Number.isFinite(minutes) ? String(Math.floor(minutes / 60)).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0") : "—";
  }
  function viewModel(snapshot) {
    var r = snapshot && snapshot.result || {}, ready = r.status === "ready" && Number.isFinite(r.ratio);
    var ratio = ready ? r.ratio : null;
    var level = !ready ? "waiting" : ratio >= 2 ? "high" : ratio >= 1.5 ? "above" : ratio >= .75 ? "normal" : "low";
    var labels = { waiting: "المقارنة غير متاحة", high: "نشاط مرتفع جدًا", above: "أعلى من المعتاد", normal: "حول المعتاد", low: "أقل من المعتاد" };
    return { ready: ready, level: level, title: labels[level], ratio: ready ? ratio.toFixed(2) + "×" : "—",
      ticker: snapshot && snapshot.ticker || "EGX", interval: snapshot && snapshot.interval || "",
      intervalLabel: snapshot && /^(1|5|10|15|30|60)$/.test(snapshot.interval)
        ? "فريم " + snapshot.interval + " دقيقة" : "فريم " + (snapshot && snapshot.interval || "غير متاح"),
      current: Number.isFinite(r.currentVolume) ? number.format(r.currentVolume) : "—",
      average: Number.isFinite(r.averageVolume) ? number.format(r.averageVolume) : "—",
      cutoff: timeLabel(r.cutoffMinutes), date: r.date || "—", sessions: r.sessionCount || 0,
      lookback: snapshot && snapshot.lookback || 20,
      excluded: Array.isArray(r.excludedSessions) ? r.excludedSessions.length : 0,
      reason: ready ? "" : reasons[r.reason] || (r.status === "unsupported" ? reasons.unsupported_interval : reasons.insufficient_sessions),
      explanation: ready ? "حجم الأسهم المتداولة حتى آخر شمعة مغلقة ÷ متوسط نفس الفترة من الجلسات السابقة." : "",
      footer: "نشاط تداول، وليس إشارة شراء أو إثبات دخول مؤسسات." };
  }
  function publish(snapshot, relayed) {
    if (!snapshot || typeof snapshot.token !== "string" || !snapshot.token) return;
    published.set(snapshot.token, snapshot);
    if (published.size > 100) published.delete(published.keys().next().value);
    if (relayed) return;
    var hosts = [];
    try { if (root.parent && root.parent !== root) hosts.push(root.parent); } catch (_) {}
    try { if (root.frames) for (var i = 0; i < root.frames.length; i++) hosts.push(root.frames[i]); } catch (_) {}
    hosts.forEach(function (host) {
      try { var other = host.__THNDR_ACTIVITY_PANEL__; if (other && other !== api) other.publish(snapshot, true); } catch (_) {}
    });
  }
  function node(doc, tag, cls, text) {
    var el = doc.createElement(tag); if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text; return el;
  }
  function ensureStyle(doc) {
    if (doc.getElementById("tz-activity-style")) return;
    var style = node(doc, "style"); style.id = "tz-activity-style";
    style.textContent = '.tz-activity-stack{position:fixed;right:64px;bottom:42px;z-index:18;width:min(300px,calc(100vw - 84px));max-height:65vh;overflow:auto;display:grid;gap:8px;pointer-events:none;font:12px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.tz-activity-card{direction:rtl;text-align:right;background:#131d2b;color:#edf3fa;border:1px solid #34465d;border-radius:10px;box-shadow:0 4px 18px #0003;pointer-events:auto;overflow:hidden}.tz-activity-card [hidden]{display:none!important}.tz-activity-head{display:flex;justify-content:space-between;align-items:center;padding:9px 12px;gap:8px}.tz-activity-head strong{font-size:13px}.tz-activity-card button{font:inherit;background:transparent;color:inherit;border:1px solid #52657a;border-radius:5px;cursor:pointer;min-width:30px;min-height:28px}.tz-activity-card button:focus-visible{outline:2px solid #7dd3fc;outline-offset:2px}.tz-activity-body{padding:0 12px 12px}.tz-activity-symbol{color:#b9c8da;font-size:11px;display:flex;justify-content:space-between;gap:8px}.tz-activity-result{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:9px 0}.tz-activity-ratio{font-size:30px;font-weight:700;line-height:1.2;color:#7dd3fc;direction:ltr}.tz-activity-card[data-level=high] .tz-activity-ratio,.tz-activity-card[data-level=above] .tz-activity-ratio{color:#facc6b}.tz-activity-stats{display:grid;gap:4px;border-top:1px solid #34465d;border-bottom:1px solid #34465d;padding:7px 0}.tz-activity-row{display:flex;justify-content:space-between;gap:8px}.tz-activity-muted{color:#b9c8da;font-size:11px;margin:7px 0 0}.tz-activity-card bdi{direction:ltr;unicode-bidi:isolate}.tz-activity-reason{margin:8px 0;color:#facc6b}.theme-light .tz-activity-card,[data-theme=light] .tz-activity-card{background:#fff;color:#152338;border-color:#c8d3df}.theme-light .tz-activity-muted,.theme-light .tz-activity-symbol,[data-theme=light] .tz-activity-muted,[data-theme=light] .tz-activity-symbol{color:#52647a}.theme-light .tz-activity-ratio,[data-theme=light] .tz-activity-ratio{color:#076c93}.theme-light .tz-activity-card[data-level=high] .tz-activity-ratio,.theme-light .tz-activity-card[data-level=above] .tz-activity-ratio,.theme-light .tz-activity-reason,[data-theme=light] .tz-activity-reason{color:#875900}@media(max-width:450px){.tz-activity-stack{right:48px;width:calc(100vw - 62px);bottom:38px;max-height:50vh}.tz-activity-ratio{font-size:26px}}';
    (doc.head || doc.documentElement).appendChild(style);
  }
  function renderCard(doc, existing, snapshot) {
    var v = viewModel(snapshot), card = existing || node(doc, "section", "tz-activity-card");
    var collapsed = card.getAttribute("data-collapsed") === "true";
    card.setAttribute("aria-label", "رادار نشاط التداول " + v.ticker);
    card.setAttribute("data-level", v.level); card.setAttribute("dir", "rtl");
    var key = JSON.stringify(v);
    if (card.__activityKey === key) return card;
    card.__activityKey = key;
    while (card.firstChild) card.removeChild(card.firstChild);
    var head = node(doc, "div", "tz-activity-head"), body = node(doc, "div", "tz-activity-body");
    var toggle = node(doc, "button", "", collapsed ? "+" : "−"); toggle.type = "button";
    toggle.setAttribute("aria-label", collapsed ? "توسيع رادار النشاط" : "تصغير رادار النشاط");
    toggle.setAttribute("aria-expanded", String(!collapsed)); body.hidden = collapsed;
    toggle.addEventListener("click", function () {
      body.hidden = !body.hidden; card.setAttribute("data-collapsed", String(body.hidden));
      toggle.textContent = body.hidden ? "+" : "−";
      toggle.setAttribute("aria-expanded", String(!body.hidden));
      toggle.setAttribute("aria-label", body.hidden ? "توسيع رادار النشاط" : "تصغير رادار النشاط");
    });
    head.append(node(doc, "strong", "", "رادار نشاط التداول"), toggle);
    var symbol = node(doc, "div", "tz-activity-symbol");
    symbol.append(node(doc, "bdi", "", v.ticker), node(doc, "span", "", v.intervalLabel));
    var result = node(doc, "div", "tz-activity-result");
    result.append(node(doc, "span", "", v.title), node(doc, "bdi", "tz-activity-ratio", v.ratio));
    body.append(symbol, result);
    if (v.reason) body.appendChild(node(doc, "p", "tz-activity-reason", v.reason));
    var stats = node(doc, "div", "tz-activity-stats");
    [["حجم الجلسة حتى المقارنة", v.current + " سهم"], ["متوسط نفس الفترة", v.average + " سهم"]].forEach(function (pair) {
      var row = node(doc, "div", "tz-activity-row"); row.append(node(doc, "span", "", pair[0]), node(doc, "bdi", "", pair[1])); stats.appendChild(row);
    });
    body.appendChild(stats);
    var stamp = node(doc, "p", "tz-activity-muted");
    stamp.append(node(doc, "span", "", "الجلسة "), node(doc, "bdi", "", v.date),
      node(doc, "span", "", " · حتى "), node(doc, "bdi", "", v.cutoff), node(doc, "span", "", " بتوقيت القاهرة"));
    body.appendChild(stamp);
    body.appendChild(node(doc, "p", "tz-activity-muted", "المقارنة: " + v.sessions + " جلسة صالحة من آخر " + v.lookback + " جلسة" + (v.excluded ? " · مستبعدة: " + v.excluded : "")));
    if (v.explanation) body.appendChild(node(doc, "p", "tz-activity-muted", v.explanation));
    body.appendChild(node(doc, "p", "tz-activity-muted", v.footer)); card.append(head, body); return card;
  }
  function clearChart(chart) {
    var state = charts.get(chart); if (!state) return;
    state.entries.forEach(function (card) { card.remove(); });
    if (!state.stack.children.length) state.stack.remove(); charts.delete(chart);
  }
  function auditChart(chart, options) {
    var doc = options.document;
    if (!doc || !doc.body || !chart || !root.__THNDR_ACTIVITY_STUDY__) return;
    var identity = root.__THNDR_ACTIVITY_STUDY__.chartIdentity(chart);
    if (!identity) { clearChart(chart); return; }
    var state = charts.get(chart);
    if (state && (state.doc !== doc || !state.stack.isConnected)) { clearChart(chart); state = null; }
    var studies;
    try { studies = chart.getAllStudies().filter(function (s) { return s.name === NAME; }); } catch (_) { clearChart(chart); return; }
    if (!studies.length) { clearChart(chart); return; }
    ensureStyle(doc);
    if (!state) {
      var stack = doc.querySelector(".tz-activity-stack") || node(doc, "div", "tz-activity-stack");
      if (!stack.isConnected) doc.body.appendChild(stack);
      state = { doc: doc, stack: stack, entries: new Map() }; charts.set(chart, state);
    }
    var active = new Set();
    studies.forEach(function (info) {
      try {
        var study = chart.getStudyById(info.id), inputs = study.getInputValues();
        function value(id) { var field = inputs.find(function (i) { return i.id === id; }); return field && field.value; }
        if (value("enabled") === false || options.visible(info.id) === false) return;
        var token = value("__tz_instance");
        if (!options.owns(info.id, token)) return;
        var snapshot = published.get(token);
        if (!snapshot || snapshot.raw.toLowerCase() !== identity.raw.toLowerCase() || snapshot.interval !== identity.interval ||
            snapshot.ticker !== identity.ticker || snapshot.lookback !== value("lookback")) {
          snapshot = { ticker: identity.ticker, interval: identity.interval, lookback: value("lookback"),
            result: { status: "insufficient", reason: "no_data" } };
        }
        active.add(info.id);
        var card = renderCard(doc, state.entries.get(info.id), snapshot);
        state.entries.set(info.id, card); if (!card.isConnected) state.stack.appendChild(card);
      } catch (_) { /* Loading/removing an owner hides its old card. */ }
    });
    state.entries.forEach(function (card, id) { if (!active.has(id)) { card.remove(); state.entries.delete(id); } });
  }
  var api = Object.freeze({ publish: publish, auditChart: auditChart, clearChart: clearChart, viewModel: viewModel,
    renderCard: renderCard, ensureStyle: ensureStyle, getSnapshot: function (token) { return published.get(token); } });
  return api;
});
