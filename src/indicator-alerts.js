/* Local, opt-in indicator signals and confirmed zone/level alerts.
 * No remote delivery, storage, sound or browser notification permission. */
(function registerIndicatorAlerts(root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.__THNDR_TAMER_ALERTS__ = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildAlerts(root) {
  "use strict";
  var MODES = ["Off", "Once per bar", "Once per bar close"];
  var DIRECTIONS = ["Both", "Bullish", "Bearish"];
  var CONDITIONS = {
    orbBuy: { study: "ORB", direction: "buy", title: "Buy Signal", message: "Breakout (Buy)", arTitle: "تأكيد اختراق صاعد" },
    orbSell: { study: "ORB", direction: "sell", title: "Sell Signal", message: "BreakDown (Sell)", arTitle: "تأكيد كسر هابط" },
    rmiBuy: { study: "RMI", direction: "buy", title: "BUY", message: "BUY", arTitle: "إشارة شراء" },
    rmiSell: { study: "RMI", direction: "sell", title: "SELL", message: "SELL", arTitle: "إشارة بيع" },
    trendBuy: { study: "Trend Signals", direction: "buy", title: "Buy signal", arTitle: "إشارة شراء" },
    trendStrongBuy: { study: "Trend Signals", direction: "buy", title: "Strong buy signal", arTitle: "إشارة شراء قوية" },
    trendSell: { study: "Trend Signals", direction: "sell", title: "Sell signal", arTitle: "إشارة بيع" },
    trendStrongSell: { study: "Trend Signals", direction: "sell", title: "Strong sell signal", arTitle: "إشارة بيع قوية" },
    liquidityBullRetest: { study: "Liquidity", direction: "buy", title: "Bullish retest confirmed", arTitle: "تأكيد إعادة اختبار صاعدة" },
    liquidityBearRetest: { study: "Liquidity", direction: "sell", title: "Bearish retest confirmed", arTitle: "تأكيد إعادة اختبار هابطة" },
    obBullRetest: { study: "Order Blocks", direction: "buy", title: "Bullish retest confirmed", arTitle: "تأكيد إعادة اختبار صاعدة" },
    obBearRetest: { study: "Order Blocks", direction: "sell", title: "Bearish retest confirmed", arTitle: "تأكيد إعادة اختبار هابطة" },
    srBullBreak: { study: "AI Support & Resistance", direction: "buy", title: "Resistance breakout confirmed", arTitle: "تأكيد اختراق المقاومة" },
    srBearBreak: { study: "AI Support & Resistance", direction: "sell", title: "Support breakdown confirmed", arTitle: "تأكيد كسر الدعم" }
  };

  function candidates(bar, direction) {
    var result = [], conditions = bar.conditions || {};
    Object.keys(CONDITIONS).forEach(function condition(key) {
      if (conditions[key] === true) result.push({ condition: key });
    });
    if (Array.isArray(bar.events)) result = result.concat(bar.events);
    return result.filter(function allowed(event) {
      var definition = event && Object.prototype.hasOwnProperty.call(CONDITIONS, event.condition) && CONDITIONS[event.condition];
      return definition && (direction === "Both" || definition.direction === (direction === "Bullish" ? "buy" : "sell"));
    });
  }

  function eventKey(event) { return JSON.stringify([event.condition, typeof event.id === "string" ? event.id : ""]); }

  function createChannel(emit) {
    var signature, time, wasClosed = false, armed = false, sent = new Set();
    var delivered = new Map();
    function selectBar(nextTime) {
      if (!delivered.has(nextTime)) delivered.set(nextTime, new Set());
      sent = delivered.get(nextTime);
      while (delivered.size > 64) delivered.delete(delivered.keys().next().value);
      time = nextTime;
    }
    return {
      update: function update(bar) {
        var mode = MODES.indexOf(bar.mode) === -1 ? "Off" : bar.mode;
        var direction = DIRECTIONS.indexOf(bar.direction) === -1 ? "Both" : bar.direction;
        var nextSignature = JSON.stringify([String(bar.signature || ""), mode, direction]);
        if (nextSignature !== signature) {
          delivered.clear();
          signature = nextSignature;
          armed = false;
          time = undefined;
        }
        if (Number.isFinite(time) && bar.time < time) armed = false;
        if (mode === "Off" || !Number.isFinite(bar.time)) { armed = false; return []; }
        // Initial history/recalculation is never an alert source. A just-closed
        // previously observed last bar may be delivered as non-last on a new tick.
        if (!bar.isLastBar && !(armed && bar.time === time && bar.isBarClosed)) {
          armed = false;
          time = bar.time;
          return [];
        }
        var pending = candidates(bar, direction);
        if (!armed) {
          armed = true;
          selectBar(bar.time);
          wasClosed = bar.isBarClosed;
          // Adding/enabling an alert must not announce a signal already present.
          // An open bar can still generate its first close-mode alert at its close.
          if (bar.isBarClosed || mode === "Once per bar") {
            pending.forEach(function seed(event) { sent.add(eventKey(event)); });
          }
          return [];
        }
        if (bar.time !== time) { selectBar(bar.time); wasClosed = false; }
        // Recalculating a candle already seen closed is not a new market event.
        if (wasClosed) return [];
        wasClosed = bar.isBarClosed;
        if (mode === "Once per bar close" && !bar.isBarClosed) return [];
        var events = [];
        pending.forEach(function check(candidate) {
          var key = eventKey(candidate);
          if (sent.has(key)) return;
          sent.add(key);
          var event = Object.assign({ condition: candidate.condition, time: time, symbol: bar.symbol || "",
            resolution: bar.resolution || "", price: bar.price, mode: mode,
            isBarClosed: bar.isBarClosed === true }, CONDITIONS[candidate.condition]);
          ["id", "label"].forEach(function copyText(field) { if (typeof candidate[field] === "string") event[field] = candidate[field]; });
          ["lower", "upper", "level"].forEach(function copyPrice(field) { if (Number.isFinite(candidate[field])) event[field] = candidate[field]; });
          events.push(event);
          if (typeof emit === "function") emit(event);
        });
        return events;
      }
    };
  }

  var ARABIC_STUDIES = {
    ORB: "نطاق الافتتاح (ORB)", RMI: "RMI", "Trend Signals": "إشارات الاتجاه",
    Liquidity: "السيولة", "Order Blocks": "الأوردر بلوكس", "AI Support & Resistance": "الدعم والمقاومة"
  };

  function timeframe(value, arabic) {
    var text = String(value || "").trim().toUpperCase(), count, unit;
    if (/^\d+$/.test(text)) {
      count = Number(text); unit = "minute";
      if (count > 0 && count % 60 === 0) { count /= 60; unit = "hour"; }
    } else {
      var match = /^(\d*)([SDWM])$/.exec(text);
      if (!match) return text || (arabic ? "غير متاح" : "Unavailable");
      count = Number(match[1] || 1);
      unit = { S: "second", D: "day", W: "week", M: "month" }[match[2]];
    }
    if (!(count > 0) || !Number.isFinite(count)) return arabic ? "غير متاح" : "Unavailable";
    if (!arabic) return count + " " + unit + (count === 1 ? "" : "s");
    var words = { second: ["ثانية", "ثانيتان", "ثوانٍ"], minute: ["دقيقة", "دقيقتان", "دقائق"],
      hour: ["ساعة", "ساعتان", "ساعات"], day: ["يوم", "يومان", "أيام"],
      week: ["أسبوع", "أسبوعان", "أسابيع"], month: ["شهر", "شهران", "أشهر"] }[unit];
    return count === 1 ? words[0] : count === 2 ? words[1] : count + " " + (count <= 10 ? words[2] : words[0]);
  }

  function stockName(value, arabic) {
    var text = typeof value === "string" ? value.trim() : "";
    // A host identifier is not a public stock ticker. Never present it as one.
    if (!text || /^=?\{/.test(text) || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(text)) {
      return arabic ? "السهم الحالي" : "Current symbol";
    }
    var egx = /^EGX(?:_DLY)?:([^:]+)$/i.exec(text);
    return egx ? egx[1] + " — " + (arabic ? "البورصة المصرية" : "Egyptian Exchange") : text;
  }

  function priceText(value, arabic) {
    return Number.isFinite(value) ? new Intl.NumberFormat("en-US", {
      useGrouping: false, maximumSignificantDigits: 12
    }).format(value) : arabic ? "غير متاح" : "Unavailable";
  }

  function formatAlert(event, arabic) {
    if (!event || !Object.prototype.hasOwnProperty.call(CONDITIONS, event.condition)) return null;
    arabic = arabic !== false;
    var definition = CONDITIONS[event.condition], rows = [];
    function row(label, english, value) { rows.push({ label: arabic ? label : english, value: value }); }
    row("السهم", "Symbol", stockName(event.symbol, arabic));
    row("الفريم", "Timeframe", timeframe(event.resolution, arabic));
    if (definition.study === "Liquidity" || definition.study === "Order Blocks") {
      var range = Number.isFinite(event.lower) && Number.isFinite(event.upper) && event.lower <= event.upper
        ? (arabic ? "من " : "From ") + priceText(event.lower, arabic) + (arabic ? " إلى " : " to ") + priceText(event.upper, arabic)
        : arabic ? "غير متاحة" : "Unavailable";
      row(definition.study === "Liquidity" ? "منطقة السيولة" : "منطقة الأوردر بلوك",
        definition.study === "Liquidity" ? "Liquidity zone" : "Order block zone", range);
    } else if (definition.study === "AI Support & Resistance") {
      row(definition.direction === "buy" ? "مستوى المقاومة" : "مستوى الدعم",
        definition.direction === "buy" ? "Resistance level" : "Support level", priceText(event.level, arabic));
      if (typeof event.label === "string" && event.label.trim()) row("مرجع المستوى", "Level reference", event.label);
    }
    var closed = event.isBarClosed === true;
    row(closed ? "سعر إغلاق الشمعة" : "السعر وقت التنبيه", closed ? "Candle close" : "Price at alert", priceText(event.price, arabic));
    var timestamp = Number.isFinite(event.time) ? (Math.abs(event.time) < 1e11 ? event.time * 1000 : event.time) : NaN;
    var date = new Date(timestamp), time = "";
    if (Number.isFinite(date.getTime())) {
      time = new Intl.DateTimeFormat(arabic ? "ar-EG-u-nu-latn" : "en-GB", {
        timeZone: "Africa/Cairo", day: "numeric", month: "long", hour: "numeric", minute: "2-digit"
      }).format(date);
    }
    return {
      direction: definition.direction,
      title: arabic ? definition.arTitle + " — " + ARABIC_STUDIES[definition.study] : definition.study + " — " + definition.title,
      rows: rows,
      note: event.isBarClosed === false ? (arabic ? "الشمعة لم تغلق بعد؛ قد تتغير الإشارة قبل الإغلاق." : "The candle is still open; the signal may change before close.") : "",
      timeLabel: arabic ? "وقت الشمعة · القاهرة" : "Candle time · Cairo", time: time
    };
  }

  function show(event) {
    var doc = root && root.document;
    if (!doc || !doc.body || !event || !Object.prototype.hasOwnProperty.call(CONDITIONS, event.condition)) return;
    var arabic = !/^en\b/i.test(doc.documentElement.lang || "");
    var presentation = formatAlert(event, arabic);
    var region = doc.getElementById("tz-indicator-alerts");
    if (!region) {
      region = doc.createElement("section");
      region.id = "tz-indicator-alerts";
      region.setAttribute("aria-label", arabic ? "تنبيهات مؤشرات تامر زكي" : "Tamer Zaky indicator alerts");
      region.style.cssText = "position:fixed;inset-inline-end:16px;bottom:52px;width:min(420px,calc(100vw - 32px));max-height:calc(100vh - 96px);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;box-sizing:border-box;padding:2px;z-index:10000;display:flex;flex-direction:column;gap:10px;pointer-events:auto;font:14px/1.65 Arial,sans-serif";
      doc.body.appendChild(region);
    }
    var item = doc.createElement("div");
    item.setAttribute("role", "status");
    item.setAttribute("aria-live", "polite");
    item.dir = arabic ? "rtl" : "ltr";
    var accent = presentation.direction === "buy" ? "#00E676" : "#F23645";
    item.style.cssText = "position:relative;flex-shrink:0;pointer-events:auto;background:#18212d;color:#fff;border:1px solid #617083;border-inline-start:4px solid " +
      accent + ";border-radius:10px;padding:14px 16px;box-shadow:0 3px 12px #0005;overflow-wrap:anywhere";
    var close = doc.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", arabic ? "إغلاق التنبيه" : "Dismiss alert");
    close.style.cssText = "position:absolute;inset-inline-end:10px;top:14px;z-index:1;background:transparent;color:#bfcbd8;border:0;cursor:pointer;font:22px Arial;width:28px;height:28px;padding:0;border-radius:4px";
    close.addEventListener("click", function dismiss() { item.remove(); if (!region.childElementCount) region.remove(); });
    var heading = doc.createElement("strong");
    heading.style.cssText = "display:block;font-size:15px;line-height:1.7;margin-bottom:12px;padding-inline:15px 30px;position:relative";
    heading.textContent = presentation.title;
    var dot = doc.createElement("span");
    dot.setAttribute("aria-hidden", "true");
    dot.style.cssText = "position:absolute;inset-inline-start:0;top:9px;width:8px;height:8px;border-radius:50%;background:" + accent;
    heading.appendChild(dot);
    var detail = doc.createElement("div");
    detail.style.cssText = "clear:both;display:grid;gap:7px";
    presentation.rows.forEach(function field(row) {
      var line = doc.createElement("div"), label = doc.createElement("strong"), value = doc.createElement("bdi");
      line.style.cssText = "display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px";
      label.style.cssText = "color:#b9c6d5;font-weight:600";
      label.textContent = row.label + ":";
      value.dir = "auto";
      value.style.cssText = "color:#fff;min-width:0";
      value.textContent = row.value;
      line.append(label, value); detail.appendChild(line);
    });
    item.append(close, heading, detail);
    if (presentation.note) {
      var note = doc.createElement("p");
      note.textContent = presentation.note;
      note.style.cssText = "font-size:12px;color:#f3ce8b;margin:12px 0 0";
      item.appendChild(note);
    }
    if (presentation.time) {
      var footer = doc.createElement("div"), timeLabel = doc.createElement("span"), timeValue = doc.createElement("bdi");
      footer.style.cssText = "display:flex;flex-wrap:wrap;gap:2px 8px;border-top:1px solid #354253;padding-top:9px;margin-top:12px;font-size:11px;color:#aebcd0";
      timeLabel.textContent = presentation.timeLabel + ":";
      timeValue.dir = "auto"; timeValue.textContent = presentation.time;
      footer.append(timeLabel, timeValue); item.appendChild(footer);
    }
    region.appendChild(item);
    while (region.childElementCount > 5) region.firstElementChild.remove();
    region.scrollTop = region.scrollHeight;
  }

  return Object.freeze({ MODES: Object.freeze(MODES), DIRECTIONS: Object.freeze(DIRECTIONS), createChannel: createChannel, formatAlert: formatAlert, show: show });
});
