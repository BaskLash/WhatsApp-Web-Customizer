// Anonymous usage analytics — see privacy policy at <PRIVACY_URL>.
// No message content, contacts, or chat data is ever transmitted.
//
// track.js — page-side helper for popup, options, and content scripts.
//
// Why a thin wrapper:
//   - All real work lives in the service worker (analytics.js). This file
//     just forwards events via chrome.runtime.sendMessage so the API key,
//     queue, and network traffic stay out of any page-side context.
//   - Defensive: every entry point is wrapped so a torn-down extension
//     context (e.g. during reload or update) never breaks WhatsApp itself.
//   - Content scripts run in an isolated world, so attaching to `window`
//     here does NOT expose anything to web.whatsapp.com's own JS.

(function () {
  function track(eventName, properties) {
    try {
      // sendMessage with no listener throws when the SW is gone. We swallow
      // it — analytics must never affect the user-facing feature.
      chrome.runtime.sendMessage({
        type: "analytics:capture",
        event: eventName,
        properties: properties || {},
      });
    } catch (err) {
      // Intentionally silent.
    }
  }

  function getDistinctId() {
    try {
      return chrome.runtime
        .sendMessage({ type: "analytics:getDistinctId" })
        .then((res) => (res && res.value) || null)
        .catch(() => null);
    } catch (err) {
      return Promise.resolve(null);
    }
  }

  if (typeof window !== "undefined") {
    window.track = track;
    window.getAnalyticsDistinctId = getDistinctId;
  }
})();
