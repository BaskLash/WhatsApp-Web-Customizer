// reviewPrompt.js — non-intrusive Chrome Web Store review request.
//
// Gating rules (all must hold for the first-ever show):
//   - sessionCount >= 5  (a "session" = at most one bump per local calendar day)
//   - daysSinceInstall >= 3
//   - reviewModalShown is falsy
//
// Re-trigger (only after the user picked "Maybe later"):
//   - reviewAction === "later" AND deferShownOnce is falsy
//   - 7 days AND 5 sessions have elapsed since the deferral
//   - After this second show, deferShownOnce locks any further appearances
//
// The "Write a review" and "No thanks" paths permanently disable the modal.
// Storage failures are swallowed — the extension's UX must never break here.

(function () {
  "use strict";

  const KEYS = {
    installDate: "review:installDate",
    sessionCount: "review:sessionCount",
    lastSessionDate: "review:lastSessionDate",
    reviewModalShown: "review:reviewModalShown",
    reviewAction: "review:reviewAction",
    deferShownOnce: "review:deferShownOnce",
    deferStartSessions: "review:deferStartSessions",
    deferStartDate: "review:deferStartDate",
    activeLock: "review:activeLock",
  };

  const MIN_SESSIONS = 5;
  const MIN_DAYS_SINCE_INSTALL = 3;
  const DEFER_DAYS = 7;
  const DEFER_SESSIONS = 5;
  const POST_LOAD_DELAY_MS = 3000;
  const CHAT_UI_TIMEOUT_MS = 30000;
  const MS_PER_DAY = 86_400_000;
  // Cross-tab lock TTL: long enough that an open modal stays "claimed",
  // short enough that a crashed tab releases the slot quickly.
  const LOCK_TTL_MS = 30_000;

  let initialized = false;

  // --- storage helpers ------------------------------------------------------

  function safeGet(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (res) => {
          if (chrome.runtime.lastError) return resolve({});
          resolve(res || {});
        });
      } catch (_) {
        resolve({});
      }
    });
  }

  function safeSet(obj) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(obj, () => {
          if (chrome.runtime.lastError) return resolve(false);
          resolve(true);
        });
      } catch (_) {
        resolve(false);
      }
    });
  }

  function track(event, props) {
    try {
      if (typeof window !== "undefined" && typeof window.track === "function") {
        window.track(event, props || {});
      }
    } catch (_) { /* analytics never breaks UX */ }
  }

  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  // --- session + gating logic ----------------------------------------------

  async function recordSession() {
    const data = await safeGet([
      KEYS.installDate,
      KEYS.sessionCount,
      KEYS.lastSessionDate,
    ]);

    const updates = {};
    if (!data[KEYS.installDate]) {
      // First ever run — anchor the 3-day gate from now.
      updates[KEYS.installDate] = Date.now();
    }

    const today = todayKey();
    if (data[KEYS.lastSessionDate] !== today) {
      const prev = Number(data[KEYS.sessionCount] || 0);
      updates[KEYS.sessionCount] = prev + 1;
      updates[KEYS.lastSessionDate] = today;
    }

    if (Object.keys(updates).length) await safeSet(updates);
  }

  async function shouldShowModal() {
    const data = await safeGet([
      KEYS.installDate,
      KEYS.sessionCount,
      KEYS.reviewModalShown,
      KEYS.reviewAction,
      KEYS.deferShownOnce,
      KEYS.deferStartSessions,
      KEYS.deferStartDate,
    ]);

    const installDate = Number(data[KEYS.installDate] || 0);
    const sessionCount = Number(data[KEYS.sessionCount] || 0);
    // installDate is always set by recordSession before this runs; if it
    // isn't, something failed — fail safe and don't show.
    if (!installDate) return false;

    const daysSinceInstall = (Date.now() - installDate) / MS_PER_DAY;

    if (!data[KEYS.reviewModalShown]) {
      return (
        daysSinceInstall >= MIN_DAYS_SINCE_INSTALL &&
        sessionCount >= MIN_SESSIONS
      );
    }

    if (data[KEYS.reviewAction] === "later" && !data[KEYS.deferShownOnce]) {
      const deferStart = Number(data[KEYS.deferStartDate] || 0);
      const deferStartSessions = Number(data[KEYS.deferStartSessions] || 0);
      const daysSinceDefer = (Date.now() - deferStart) / MS_PER_DAY;
      const sessionsSinceDefer = sessionCount - deferStartSessions;
      return daysSinceDefer >= DEFER_DAYS && sessionsSinceDefer >= DEFER_SESSIONS;
    }

    return false;
  }

  // Best-effort lock to make sure only one open WhatsApp Web tab shows the
  // modal at a time. Other tabs back off if they see a fresh stamp.
  async function acquireLock() {
    const data = await safeGet([KEYS.activeLock]);
    const existing = data[KEYS.activeLock];
    if (existing && Date.now() - Number(existing.ts || 0) < LOCK_TTL_MS) {
      return false;
    }
    const stamp = { ts: Date.now(), id: Math.random().toString(36).slice(2) };
    await safeSet({ [KEYS.activeLock]: stamp });
    const confirm = await safeGet([KEYS.activeLock]);
    return confirm[KEYS.activeLock] && confirm[KEYS.activeLock].id === stamp.id;
  }

  async function releaseLock() {
    await safeSet({ [KEYS.activeLock]: null });
  }

  // --- DOM readiness --------------------------------------------------------

  function waitForChatUI(timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const ready =
          document.querySelector('header[data-testid="chatlist-header"]') ||
          document.getElementById("pane-side");
        if (ready) return resolve(true);
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(check, 500);
      };
      check();
    });
  }

  // --- modal ----------------------------------------------------------------

  const STYLES = `
    :host { all: initial; }
    .backdrop {
      position: fixed; inset: 0;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(2px);
      -webkit-backdrop-filter: blur(2px);
      display: flex; align-items: center; justify-content: center;
      z-index: 2147483647;
      opacity: 0;
      transition: opacity 220ms ease-out;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    }
    .backdrop.visible { opacity: 1; }
    .modal {
      position: relative;
      width: min(420px, calc(100vw - 32px));
      box-sizing: border-box;
      background: #ffffff;
      border-radius: 14px;
      padding: 28px 28px 24px;
      box-shadow:
        0 1px 2px rgba(0, 0, 0, 0.06),
        0 12px 32px rgba(0, 0, 0, 0.18);
      transform: translateY(8px) scale(0.98);
      opacity: 0;
      transition: opacity 220ms ease-out, transform 220ms ease-out;
      color: #111b21;
    }
    .backdrop.visible .modal {
      transform: translateY(0) scale(1);
      opacity: 1;
    }
    .close {
      position: absolute;
      top: 10px; right: 10px;
      width: 32px; height: 32px;
      border: 0; background: transparent;
      border-radius: 50%;
      cursor: pointer;
      color: #54656f;
      font-size: 22px; line-height: 1;
      display: inline-flex; align-items: center; justify-content: center;
      transition: background-color 150ms ease;
    }
    .close:hover { background: #f0f2f5; }
    .close:focus-visible { outline: 2px solid #00a884; outline-offset: 2px; }
    .logo-wrap {
      display: flex; justify-content: center;
      margin-bottom: 14px;
    }
    .logo {
      width: 56px; height: 56px;
      border-radius: 14px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
      display: block;
    }
    h2 {
      margin: 0 0 8px;
      font-size: 19px;
      font-weight: 600;
      letter-spacing: -0.01em;
      text-align: center;
      color: #111b21;
    }
    p.subtitle {
      margin: 0 0 18px;
      font-size: 14px;
      line-height: 1.5;
      text-align: center;
      color: #54656f;
    }
    .stars {
      display: flex; justify-content: center; gap: 4px;
      margin-bottom: 22px;
    }
    .stars svg { width: 22px; height: 22px; display: block; }
    .actions {
      display: flex; flex-direction: column; gap: 8px;
    }
    .btn {
      width: 100%;
      box-sizing: border-box;
      border: 0;
      border-radius: 10px;
      padding: 11px 16px;
      font-size: 14px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: background-color 140ms ease, color 140ms ease, transform 140ms ease;
    }
    .btn:active { transform: scale(0.99); }
    .btn-primary {
      background: #00a884; color: #ffffff;
    }
    .btn-primary:hover { background: #008069; }
    .btn-primary:focus-visible { outline: 2px solid #008069; outline-offset: 2px; }
    .btn-secondary {
      background: #f0f2f5; color: #111b21;
    }
    .btn-secondary:hover { background: #e5e8eb; }
    .btn-tertiary {
      background: transparent; color: #667781;
      padding-top: 8px; padding-bottom: 8px;
      font-weight: 500;
    }
    .btn-tertiary:hover { color: #111b21; }
    @media (max-width: 480px) {
      .modal { padding: 22px 20px 20px; border-radius: 12px; }
      h2 { font-size: 17px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .backdrop, .modal { transition: none; }
    }
  `;

  function starSVG() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#f5b400" d="M12 2.6l2.95 5.98 6.6.96-4.78 4.66 1.13 6.58L12 17.77l-5.9 3.1 1.13-6.58L2.45 9.54l6.6-.96L12 2.6z"/>
      </svg>
    `;
  }

  function buildHTML(iconUrl) {
    const safeIcon = iconUrl ? `<img class="logo" alt="" src="${iconUrl}">` : "";
    return `
      <div class="backdrop" role="presentation">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="wa-review-title" aria-describedby="wa-review-desc">
          <button class="close" type="button" aria-label="Close">&times;</button>
          <div class="logo-wrap">${safeIcon}</div>
          <h2 id="wa-review-title">Enjoying WhatsApp Web Customizer?</h2>
          <p class="subtitle" id="wa-review-desc">Your review helps others discover the extension and motivates us to keep improving it.</p>
          <div class="stars" aria-hidden="true">
            ${starSVG()}${starSVG()}${starSVG()}${starSVG()}${starSVG()}
          </div>
          <div class="actions">
            <button class="btn btn-primary" type="button" data-action="review">Write a review</button>
            <button class="btn btn-secondary" type="button" data-action="later">Maybe later</button>
            <button class="btn btn-tertiary" type="button" data-action="dismiss">No thanks</button>
          </div>
        </div>
      </div>
    `;
  }

  function reviewUrl() {
    try {
      const id = chrome.runtime.id;
      return `https://chromewebstore.google.com/detail/${id}/reviews`;
    } catch (_) {
      return "https://chromewebstore.google.com/";
    }
  }

  // Marks that the modal has been displayed (or deferred-displayed).
  // Done before the DOM is rendered so the lock + flag together prevent
  // duplicate shows even if the user reloads mid-render.
  async function markShown(isDeferred) {
    const updates = { [KEYS.reviewModalShown]: true };
    if (isDeferred) updates[KEYS.deferShownOnce] = true;
    await safeSet(updates);
  }

  async function persistAction(action, currentSessionCount) {
    const updates = { [KEYS.reviewAction]: action };
    if (action === "later") {
      updates[KEYS.deferStartDate] = Date.now();
      updates[KEYS.deferStartSessions] = Number(currentSessionCount || 0);
    }
    await safeSet(updates);
  }

  function renderModal({ iconUrl, isDeferred, sessionCount }) {
    return new Promise((resolve) => {
      const host = document.createElement("div");
      host.id = "wa-review-prompt-host";
      // Reset any inherited styles from WhatsApp's CSS.
      host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483647;";
      const root = host.attachShadow({ mode: "closed" });
      root.innerHTML = `<style>${STYLES}</style>${buildHTML(iconUrl)}`;
      document.documentElement.appendChild(host);

      const backdrop = root.querySelector(".backdrop");
      // Trigger fade-in on the next frame so the transition runs.
      requestAnimationFrame(() => backdrop.classList.add("visible"));

      let settled = false;
      const finish = async (action) => {
        if (settled) return;
        settled = true;
        await persistAction(action, sessionCount);
        track("review_modal_action", { action, deferred: !!isDeferred });
        backdrop.classList.remove("visible");
        setTimeout(() => host.remove(), 240);
        await releaseLock();
        resolve(action);
      };

      root.querySelector('[data-action="review"]').addEventListener("click", () => {
        try { window.open(reviewUrl(), "_blank", "noopener,noreferrer"); } catch (_) {}
        finish("reviewed");
      });
      root.querySelector('[data-action="later"]').addEventListener("click", () => finish("later"));
      root.querySelector('[data-action="dismiss"]').addEventListener("click", () => finish("dismissed"));
      root.querySelector(".close").addEventListener("click", () => finish("dismissed"));

      // Backdrop click closes (treated as dismiss). Modal click does not bubble.
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) finish("dismissed");
      });

      // Esc closes (dismiss). Captured at host level.
      const onKey = (e) => {
        if (e.key === "Escape") {
          document.removeEventListener("keydown", onKey, true);
          finish("dismissed");
        }
      };
      document.addEventListener("keydown", onKey, true);
    });
  }

  // --- entry point ----------------------------------------------------------

  async function init() {
    if (initialized) return;
    initialized = true;
    try {
      await recordSession();

      const ready = await waitForChatUI(CHAT_UI_TIMEOUT_MS);
      if (!ready) return;
      await new Promise((r) => setTimeout(r, POST_LOAD_DELAY_MS));

      if (!(await shouldShowModal())) return;
      if (!(await acquireLock())) return;

      const data = await safeGet([
        KEYS.reviewModalShown,
        KEYS.sessionCount,
      ]);
      const isDeferred = !!data[KEYS.reviewModalShown];
      const sessionCount = Number(data[KEYS.sessionCount] || 0);

      await markShown(isDeferred);
      track("review_modal_shown", { deferred: isDeferred, session_count: sessionCount });

      let iconUrl = "";
      try { iconUrl = chrome.runtime.getURL("icon/icon128.png"); } catch (_) {}

      await renderModal({ iconUrl, isDeferred, sessionCount });
    } catch (_) {
      // Never propagate — the host page must keep working.
      try { await releaseLock(); } catch (__) {}
    }
  }

  if (typeof window !== "undefined") {
    window.WAReviewPrompt = { init };
  }
})();
