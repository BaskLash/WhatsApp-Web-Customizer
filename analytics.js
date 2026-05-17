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
        // Stable per-emission ID. PostHog uses this to drop duplicates if a
        // batch is retried after a partial failure (see flush() catch path).
        $insert_id: generateUUID(),
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

    let httpStatus = null;
    try {
      const res = await fetch(`${POSTHOG_HOST}/batch/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      });
      if (!res.ok) {
        httpStatus = res.status;
        throw new Error(`PostHog returned ${res.status}`);
      }
      // Only drop the batch we sent. New events captured during the request
      // stay queued for the next flush.
      const after = await chrome.storage.local.get(STORAGE_KEYS.QUEUE);
      const live = Array.isArray(after[STORAGE_KEYS.QUEUE]) ? after[STORAGE_KEYS.QUEUE] : [];
      const drained = live.slice(batch.length);
      const finalQueue = drained.length <= remaining.length ? drained : remaining.concat(live.slice(remaining.length));
      await chrome.storage.local.set({ [STORAGE_KEYS.QUEUE]: finalQueue });
    } catch (err) {
      console.warn("[analytics] flush failed, will retry:", err);
      // Report through the dedicated self-telemetry pipe — NOT capture().
      // capture() puts events into the same storage queue that just failed,
      // which used to cascade (the failure event would bloat the next batch,
      // making the next flush more likely to fail, multiplying the report).
      // The pipe below has a bounded in-memory queue and is wired so that
      // its own failures never re-emit anything.
      reportFlushFailure(err, batch.length, httpStatus);
    }
  }

  // ── Self-telemetry pipe ─────────────────────────────────────────────────
  //
  // Reporting analytics health is itself an analytics event, but we keep it
  // off the main queue and on a dedicated path so a delivery storm can never
  // amplify itself. Hard rules:
  //   1. Bounded in-memory queue (per SW lifetime). Overflows drop oldest
  //      and tick a counter. The counter rides on the next successfully
  //      sent failure report so we don't lose visibility into the storm.
  //   2. If the self-telemetry pipe itself fails, the failure is swallowed —
  //      no re-enqueue, no further events. console.warn only.
  //   3. Never goes through capture() or the main queue.
  const SELF_TELEMETRY_MAX = 10;
  let selfTelemetryQueue = [];     // [{ event, properties, timestamp }]
  let droppedFailureReports = 0;   // Capacity overflows since last successful send.
  let selfTelemetryInFlight = false;

  function classifyFlushError(err) {
    const msg = err && err.message ? String(err.message) : "";
    if (/^PostHog returned/i.test(msg)) return "http_error";
    if (/network|fetch|TypeError|Failed to fetch/i.test(msg)) return "network_error";
    return "unknown";
  }

  function reportFlushFailure(err, batchSize, httpStatus) {
    const errorClass = classifyFlushError(err);
    const props = {
      // Dual-write deprecation: keep `status` for two release cycles so any
      // existing dashboard breakdowns survive the cutover. Migrate consumers
      // to `error_class` (enum) or `endpoint_status` (HTTP code). See
      // ANALYTICS.md for the dual-write window.
      status: errorClass,
      error_class: errorClass,
      endpoint_status: typeof httpStatus === "number" ? httpStatus : null,
      batch_size: batchSize,
    };
    if (droppedFailureReports > 0) {
      props.dropped_failure_reports = droppedFailureReports;
      droppedFailureReports = 0;
    }

    if (selfTelemetryQueue.length >= SELF_TELEMETRY_MAX) {
      selfTelemetryQueue.shift();
      droppedFailureReports++;
    }
    selfTelemetryQueue.push({
      event: "analytics_flush_failed",
      properties: props,
      timestamp: new Date().toISOString(),
    });

    // Fire-and-forget — caller doesn't await. If we can't send right now,
    // the queue persists for the next reportFlushFailure() call or the next
    // SW wake-up to drain. No alarm wakes this pipe on its own; if the SW
    // shuts down with events in this queue, they're lost (intentional —
    // we'd rather drop telemetry-about-telemetry than risk recursion).
    flushSelfTelemetry();
  }

  async function flushSelfTelemetry() {
    if (selfTelemetryInFlight) return;
    if (selfTelemetryQueue.length === 0) return;
    selfTelemetryInFlight = true;
    const batch = selfTelemetryQueue.slice();
    try {
      const distinctId = await getDistinctId();
      const manifest = chrome.runtime.getManifest();
      const payload = {
        api_key: POSTHOG_API_KEY,
        batch: batch.map((e) => ({
          event: e.event,
          properties: {
            ...e.properties,
            distinct_id: distinctId,
            $insert_id: generateUUID(),
            $lib: "chrome-extension",
            extension_version: manifest.version,
            browser_language: typeof navigator !== "undefined" ? navigator.language : undefined,
          },
          timestamp: e.timestamp,
          distinct_id: distinctId,
        })),
      };
      const res = await fetch(`${POSTHOG_HOST}/batch/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      });
      if (res.ok) {
        // Drop only what we sent — events that landed after the batch was
        // sliced (rare on a 10-cap queue, but theoretically possible)
        // remain for the next call.
        selfTelemetryQueue = selfTelemetryQueue.slice(batch.length);
      }
      // Non-ok response: leave queue in place, don't emit anything. The
      // recursion gate. Next reportFlushFailure() call will retry.
    } catch (err) {
      // Recursion gate again — silent in production. Dev builds can inspect
      // service-worker logs to see this.
      console.warn("[analytics] self-telemetry flush failed (silent):", err && err.message);
    } finally {
      selfTelemetryInFlight = false;
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
          // Dual-write deprecation window (2 release cycles). `from`/`to`
          // are the legacy names — they collide with tab/sub-tab transition
          // events that use the same property names for navigation moves.
          // Migrate consumers to `previous_version` / `version`, then drop
          // the legacy pair. See ANALYTICS.md for the cutover date.
          await capture("extension_updated", {
            from: details.previousVersion,            // DEPRECATED
            to: currentVersion,                       // DEPRECATED
            previous_version: details.previousVersion,
            version: currentVersion,
          });
        }
      }
      await flush();
    });

    chrome.runtime.onStartup.addListener(() => flush());
  }

  self.analytics = { initAnalytics, capture, flush, getDistinctId };
})();
