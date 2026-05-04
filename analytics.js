// Anonymous usage analytics — see privacy policy at <PRIVACY_URL>.
// No message content, contacts, or chat data is ever transmitted.
//
// analytics.js — lightweight PostHog client for Chrome MV3 service workers.
//
// Why this design:
//   - Runs only inside the service worker. Popup, options, and content
//     scripts forward events via chrome.runtime.sendMessage, so the API key
//     and queue never live in a page-side context.
//   - Always-on. Events are queued and flushed; there is no opt-in toggle.
//     Disclosure happens through the privacy policy and the options page.
//   - Queue-and-batch. Events are queued in chrome.storage.local and flushed
//     every 30s via chrome.alarms. Survives service-worker shutdown.
//   - No external dependencies, no posthog-js. Plain fetch with keepalive.
//
// Privacy contract (enforced by callers, not this file):
//   - Property values must never contain text from WhatsApp's UI.
//   - Counts, durations, and fixed-enum strings only. See track.js callers.
//   - IP geolocation is disabled at the PostHog project level.
//
// Loaded via importScripts() from background.js. Exposes self.analytics.

(function () {
  // TODO: replace before publishing — keep out of public repo if possible.
  const POSTHOG_API_KEY = "phc_D7eF9i6oXNgCTRHZ9VPHJNs5AaBudskFF36har3UYyPW";
  const POSTHOG_HOST = "https://eu.i.posthog.com";

  const STORAGE_KEYS = {
    DISTINCT_ID: "analytics_distinct_id",
    QUEUE: "analytics_queue",
  };

  const FLUSH_INTERVAL_SECONDS = 30;
  const MAX_QUEUE_SIZE = 200;
  const MAX_BATCH_SIZE = 50;

  function generateUUID() {
    return crypto.randomUUID();
  }

  async function getDistinctId() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.DISTINCT_ID);
    const id = result[STORAGE_KEYS.DISTINCT_ID];
    if (id) return id;
    const newId = generateUUID();
    await chrome.storage.local.set({ [STORAGE_KEYS.DISTINCT_ID]: newId });
    return newId;
  }

  async function capture(eventName, properties = {}) {
    const distinctId = await getDistinctId();
    const manifest = chrome.runtime.getManifest();

    const event = {
      event: eventName,
      properties: {
        ...properties,
        distinct_id: distinctId,
        $lib: "chrome-extension",
        extension_version: manifest.version,
        browser_language: typeof navigator !== "undefined" ? navigator.language : undefined,
      },
      timestamp: new Date().toISOString(),
    };

    const stored = await chrome.storage.local.get(STORAGE_KEYS.QUEUE);
    const queue = Array.isArray(stored[STORAGE_KEYS.QUEUE]) ? stored[STORAGE_KEYS.QUEUE] : [];
    queue.push(event);
    // Drop the oldest events if the queue overflows. Bounded growth matters
    // because the SW may sit idle (or offline) for long periods and we don't
    // want a backlog to balloon storage.
    if (queue.length > MAX_QUEUE_SIZE) queue.splice(0, queue.length - MAX_QUEUE_SIZE);
    await chrome.storage.local.set({ [STORAGE_KEYS.QUEUE]: queue });
  }

  async function flush() {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.QUEUE);
    const queue = Array.isArray(stored[STORAGE_KEYS.QUEUE]) ? stored[STORAGE_KEYS.QUEUE] : [];
    if (queue.length === 0) return;

    const batch = queue.slice(0, MAX_BATCH_SIZE);
    const remaining = queue.slice(MAX_BATCH_SIZE);

    const payload = {
      api_key: POSTHOG_API_KEY,
      batch: batch.map((e) => ({
        event: e.event,
        properties: e.properties,
        timestamp: e.timestamp,
        distinct_id: e.properties.distinct_id,
      })),
    };

    try {
      const res = await fetch(`${POSTHOG_HOST}/batch/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      });
      if (!res.ok) throw new Error(`PostHog returned ${res.status}`);
      // Only drop the batch we sent. New events captured during the request
      // stay queued for the next flush.
      const after = await chrome.storage.local.get(STORAGE_KEYS.QUEUE);
      const live = Array.isArray(after[STORAGE_KEYS.QUEUE]) ? after[STORAGE_KEYS.QUEUE] : [];
      const drained = live.slice(batch.length);
      const finalQueue = drained.length <= remaining.length ? drained : remaining.concat(live.slice(remaining.length));
      await chrome.storage.local.set({ [STORAGE_KEYS.QUEUE]: finalQueue });
    } catch (err) {
      console.warn("[analytics] flush failed, will retry:", err);
    }
  }

  // All listener registrations must run synchronously at SW init. MV3
  // service workers are torn down between events; if these get registered
  // inside an async chain, the events that woke the worker can be missed.
  function initAnalytics() {
    chrome.alarms.create("analytics_flush", {
      periodInMinutes: FLUSH_INTERVAL_SECONDS / 60,
    });

    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === "analytics_flush") flush();
    });

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || typeof msg.type !== "string") return;
      if (msg.type === "analytics:capture") {
        capture(msg.event, msg.properties).then(() => sendResponse({ ok: true }));
        return true;
      }
      if (msg.type === "analytics:getDistinctId") {
        getDistinctId().then((value) => sendResponse({ value }));
        return true;
      }
      if (msg.type === "analytics:flush") {
        flush().then(() => sendResponse({ ok: true }));
        return true;
      }
    });

    // Install / update events. We rely on Chrome's details.previousVersion
    // rather than tracking it ourselves, so there's no per-version state in
    // chrome.storage.local for analytics to manage.
    chrome.runtime.onInstalled.addListener(async (details) => {
      const currentVersion = chrome.runtime.getManifest().version;
      if (details.reason === "install") {
        await capture("extension_installed", { version: currentVersion });
      } else if (details.reason === "update") {
        if (details.previousVersion && details.previousVersion !== currentVersion) {
          await capture("extension_updated", {
            from: details.previousVersion,
            to: currentVersion,
          });
        }
      }
      await flush();
    });

    chrome.runtime.onStartup.addListener(() => flush());
  }

  self.analytics = { initAnalytics, capture, flush, getDistinctId };
})();
