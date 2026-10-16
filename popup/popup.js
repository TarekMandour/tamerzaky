(function initializePopup() {
  "use strict";

  const THNDR_MATCH = "https://x.thndr.app/*";
  const THNDR_OPEN_URL = "https://x.thndr.app/workspaces/default/trade?view=stock";
  const views = {
    loading: document.getElementById("loading-view"),
    connectionError: document.getElementById("connection-error-view"),
    signedOut: document.getElementById("signed-out-view"),
    openThndr: document.getElementById("open-thndr-view"),
    social: document.getElementById("social-view")
  };
  const message = document.getElementById("message");
  const signIn = document.getElementById("sign-in");
  const signOut = document.getElementById("sign-out");
  const deleteAccount = document.getElementById("delete-account");
  const openThndr = document.getElementById("open-thndr");
  const retryStatus = document.getElementById("retry-status");
  const loadingCopy = document.getElementById("loading-copy");
  let renderVersion = 0;

  function show(view, notice = "") {
    for (const [name, element] of Object.entries(views)) {
      element.hidden = name !== view;
    }
    signOut.hidden = view !== "openThndr" && view !== "social";
    deleteAccount.hidden = signOut.hidden;
    message.textContent = notice;
    message.hidden = !notice;
  }

  async function within(promise, milliseconds) {
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error("انتهت مهلة التحقق. حاول مرة ثانية.");
        error.code = "POPUP_TIMEOUT";
        reject(error);
      }, milliseconds);
    });
    try { return await Promise.race([promise, deadline]); }
    finally { clearTimeout(timer); }
  }

  async function request(type, details = {}) {
    const response = await within(chrome.runtime.sendMessage({ type, ...details }),
      type === "AUTH_SIGN_IN" ? 150000 : type === "ACCOUNT_DELETE" ? 60000 : 35000);
    if (!response || !response.ok) {
      const error = new Error(response && response.error || "تعذّر الاتصال بالإضافة. حاول مرة ثانية.");
      error.code = response && response.code;
      throw error;
    }
    return response;
  }

  async function showAuthResult(result, version = ++renderVersion) {
    if (!result.authenticated) {
      show("signedOut", result.notice || "");
      return;
    }

    let thndrOpen = false;
    let notice = result.notice || (result.reloadFailures
      ? "بعض تبويبات ثاندر لم تُحدّث تلقائيًا. حدّث الشارت يدويًا."
      : "");
    try {
      const tabs = await within(chrome.tabs.query({ url: THNDR_MATCH }), 3000);
      thndrOpen = tabs.some((tab) => Number.isInteger(tab.id));
    } catch (_error) {
      notice ||= "تعذّر فحص تبويبات ثاندر. افتح ثاندر أو حدّث الصفحة.";
    }
    if (version !== renderVersion) return;
    show(thndrOpen ? "social" : "openThndr", notice);
  }

  async function run(type, details = {}) {
    const version = ++renderVersion;
    loadingCopy.textContent = type === "AUTH_SIGN_IN" ? "كمّل تسجيل الدخول في نافذة Google"
      : type === "AUTH_SIGN_OUT" ? "بنسجّل الخروج"
      : type === "ACCOUNT_DELETE" ? "بنتأكد من حذف بيانات الحساب" : "بنتأكد من تسجيل الدخول";
    show("loading");
    signIn.disabled = true;
    signOut.disabled = true;
    deleteAccount.disabled = true;
    retryStatus.disabled = true;
    try {
      const result = await request(type, details);
      if (version !== renderVersion) return;
      await showAuthResult(result, version);
    } catch (error) {
      if (version !== renderVersion) return;
      show(type === "AUTH_SIGN_IN" && error.code !== "POPUP_TIMEOUT" ? "signedOut" : "connectionError",
        type === "ACCOUNT_DELETE"
          ? "تعذّر تأكيد نتيجة الحذف. أعد التحقق من حالة الحساب."
          : error.code === "AUTH_TIMEOUT" ? error.message : "تعذّر التحقق من الحساب. حاول مرة ثانية.");
    } finally {
      if (version === renderVersion) {
        signIn.disabled = false;
        signOut.disabled = false;
        deleteAccount.disabled = false;
        retryStatus.disabled = false;
      }
    }
  }

  signIn.addEventListener("click", () => run("AUTH_SIGN_IN"));
  signOut.addEventListener("click", () => run("AUTH_SIGN_OUT"));
  deleteAccount.addEventListener("click", () => run("ACCOUNT_DELETE"));
  retryStatus.addEventListener("click", () => run("AUTH_STATUS"));
  openThndr.addEventListener("click", async () => {
    const version = renderVersion;
    openThndr.disabled = true;
    try {
      await within(chrome.tabs.create({ url: THNDR_OPEN_URL }), 3000);
      if (version !== renderVersion) return;
      await showAuthResult({ authenticated: true }, version);
    } catch (_error) {
      if (version === renderVersion)
        show("openThndr", "تعذّر فتح ثاندر تلقائيًا. افتح x.thndr.app في تبويب جديد.");
    } finally {
      openThndr.disabled = false;
    }
  });

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
    run("AUTH_STATUS");
  } else {
    show("signedOut");
  }
})();
