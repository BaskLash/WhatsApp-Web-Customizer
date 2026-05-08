// animated-bg.js — content script for animated chat backgrounds.
//
// Storage contract (popup writes, this script reads):
//   chrome.storage.local["animated_background"] = { id: "<path>" } | null
//
// Why this layering recipe (mirrors whatsapp-web-customize/src/chrome_services/content.ts):
//   1. Wait for #main to exist (WhatsApp loads it dynamically post-QR).
//   2. Inject a stylesheet rule `div#main { transform: none !important }`.
//      WhatsApp sets a CSS transform on #main to enable hardware compositing,
//      which creates a stacking context and makes #main paint as one opaque
//      compositor layer that obscures any siblings. Stripping the transform
//      lets the bg container show through #main's transparent gaps (the chat-
//      view backdrop area).
//   3. Insert <div id="wa-bg-container"> as a SIBLING of #main, BEFORE it in
//      DOM order — same anchor the reference extension uses.
//   4. position:fixed; width:100%; height:100%; z-index:1; background:#121212.
//      The dark fallback covers the brief window between container insertion
//      and the animation HTML arriving via fetch().
//   5. Drop the animation's HTML into the container via innerHTML.
//
// Cleanup model:
//   - Switching to a different animation: replace innerHTML. The animations
//     are pure CSS+SVG keyframes — no JS, no event listeners, no timers — so
//     replacing the DOM subtree fully stops the prior animation and frees
//     its resources. No manual loop teardown needed.
//   - Switching off ("None"): fully remove the container so WhatsApp's
//     native look returns. (The reference leaves a permanent dark fallback
//     in place; we deliberately diverge to give users a clean "off" state.)

(function () {
  const STORAGE_KEY = "animated_background";
  const CONTAINER_ID = "wa-bg-container";
  const STYLE_ID = "wa-animated-bg-style";

  // Allowlist: every value of `id` is concatenated into a chrome-extension
  // URL. The popup only ever writes one of these strings, but the content
  // script validates again so a corrupted storage value can never cause an
  // arbitrary fetch.
  const ALLOWED_IDS = new Set([
    "red_stapler_animated_gradient",
    "rose_lui_lava_lamp",
    "beep_ghost",
    "tiffany_choong_stripes",
    "floating_bubbles",
  ]);

  // Mirrors the reference extension's waitForElm(). One-shot — the observer
  // disconnects as soon as the element appears.
  function waitForElm(selector) {
    return new Promise((resolve) => {
      const existing = document.querySelector(selector);
      if (existing) return resolve(existing);
      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    });
  }

  function ensureClearTransformRule() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    // The reference uses `document.styleSheets[0].insertRule(...)` — fragile
    // because the host page may not have a stylesheet at index 0 yet. Owning
    // our own <style> element is the same effect with no race.
    style.textContent = "div#main { transform: none !important; }";
    (document.head || document.documentElement).appendChild(style);
  }

  function createContainer(mainEl) {
    const el = document.createElement("div");
    el.id = CONTAINER_ID;
    el.style.cssText =
      "width:100%;height:100%;position:fixed;top:0;left:0;" +
      "z-index:1;background-color:#121212";
    // Sibling of #main, inserted BEFORE it. This is the exact placement the
    // reference uses and is the placement WhatsApp's stacking hierarchy is
    // forgiving toward (combined with the transform-strip rule above).
    mainEl.parentNode.insertBefore(el, mainEl);
    return el;
  }

  function getOrCreateContainer() {
    let el = document.getElementById(CONTAINER_ID);
    if (el && el.isConnected) return Promise.resolve(el);
    return waitForElm("#main").then((mainEl) => {
      ensureClearTransformRule();
      // Race guard: another applyAnimation call may have created it while
      // we were awaiting #main.
      let live = document.getElementById(CONTAINER_ID);
      if (live && live.isConnected) return live;
      return createContainer(mainEl);
    });
  }

  function removeContainer() {
    const el = document.getElementById(CONTAINER_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  let lastAppliedId = null;
  // Monotonic token: the most recently scheduled apply wins. If a fetch is
  // still in flight when the user picks a different animation, the older
  // one's .then() sees a stale token and bails out — no flicker between
  // two animations.
  let applyToken = 0;

  function applyAnimation(id) {
    if (!id || !ALLOWED_IDS.has(id)) {
      removeContainer();
      lastAppliedId = null;
      return;
    }
    if (id === lastAppliedId) {
      const live = document.getElementById(CONTAINER_ID);
      if (live && live.isConnected) return;
    }

    const myToken = ++applyToken;
    const url = chrome.runtime.getURL(
      `backgrounds/animated/${id}/index.html`,
    );

    Promise.all([
      getOrCreateContainer(),
      fetch(url).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      }),
    ])
      .then(([container, html]) => {
        if (myToken !== applyToken) return;
        // Replacing innerHTML drops the previous animation's DOM (and any
        // associated style/animation state with it). This is sufficient
        // cleanup because the animations carry no JS state.
        container.innerHTML = html;
        lastAppliedId = id;
      })
      .catch((err) => {
        console.warn("[animated-bg] failed to load", id, err);
      });
  }

  function loadFromStorage() {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const value = result[STORAGE_KEY];
      const id = value && typeof value.id === "string" ? value.id : null;
      applyAnimation(id);
    });
  }

  // Live-update path: popup writes → onChanged → re-apply.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[STORAGE_KEY]) return;
    const next = changes[STORAGE_KEY].newValue;
    const id = next && typeof next.id === "string" ? next.id : null;
    applyAnimation(id);
  });

  // Initial mount on page load (manifest sets run_at=document_idle).
  loadFromStorage();
})();
