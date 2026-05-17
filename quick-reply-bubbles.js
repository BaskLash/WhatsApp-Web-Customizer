const bubbleStyles = `
  #quick-reply-bubbles {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin: 12px 10px;
    padding: 8px 12px;
    justify-content: flex-start;
    z-index: 100;
  }

  .quick-reply-bubble {
    background: linear-gradient(135deg, #ffffff, #f0f0f5);
    color: #333;
    border-radius: 20px;
    padding: 10px 16px;
    cursor: pointer;
    font-size: 14px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    white-space: nowrap;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    transition: transform 0.3s ease, box-shadow 0.3s ease, background 0.3s ease;
    animation: bubbleAppear 0.4s ease-out forwards;
  }

  @keyframes bubbleAppear {
    0% {
      opacity: 0;
      transform: translateY(10px);
    }
    100% {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .quick-reply-bubble:hover {
    background: linear-gradient(135deg, #e0f7fa, #b2ebf2);
    transform: translateY(-2px) scale(1.05);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
  }

  .quick-reply-bubble:active {
    animation: bubbleClick 0.2s ease;
  }

  @keyframes bubbleClick {
    0% {
      transform: scale(1);
    }
    50% {
      transform: scale(0.95);
    }
    100% {
      transform: scale(1);
    }
  }
`;

// ── Session-level counters ──────────────────────────────────────────────
//
// Q: Of WA-Web page sessions where bubbles appeared, what share converted
//    to at least one insert? `quick_reply_bubbles_shown` (below) is
//    throttled per-impression and answers a different question
//    ("frequency of paint events"). The session event is the conversion
//    denominator — fired once per page session on `pagehide`.
//
// Counters reset only on a new page load (this content script re-evaluates
// on each navigation). Both metrics are pure integers — no PII path.
let sessionBubblesShownCount = 0;
let sessionBubblesInsertedCount = 0;
let sessionEventFired = false;

function fireBubblesSessionSummary() {
  if (sessionEventFired) return;
  // Only fire if bubbles ever appeared — sessions where the bar never
  // rendered (no quickReplies configured, no footer found) have nothing
  // to summarize.
  if (sessionBubblesShownCount === 0) return;
  sessionEventFired = true;
  try {
    if (window.track) {
      window.track("quick_reply_bubbles_session", {
        bubbles_shown_count: sessionBubblesShownCount,
        bubbles_inserted_count: sessionBubblesInsertedCount,
      });
    }
  } catch (_) { /* analytics must never break WhatsApp */ }
}

// pagehide is the recommended unload signal on modern Chrome; fires when
// the user navigates away, closes the tab, or BFCache-evicts the page.
// We piggyback on track.js's sendMessage → service-worker capture path,
// which uses keepalive at the fetch layer (in analytics.js's flush()), so
// the event survives the unload window.
window.addEventListener("pagehide", fireBubblesSessionSummary);

// Min seconds between bubbles_shown emissions, per page load. WhatsApp
// rebuilds the footer DOM on every chat switch and on every storage change,
// so a user who switches chats rapidly (or saves replies one by one with
// the popup open) would otherwise generate dozens of redundant events.
// 10s is short enough to capture real engagement windows, long enough to
// flatten flicker.
const BUBBLES_SHOWN_THROTTLE_MS = 10_000;
let lastBubblesShownAt = 0;

function buildBubbles(container, replies, footer) {
  const shuffled = [...replies].sort(() => 0.5 - Math.random());
  const toShow = shuffled.slice(0, Math.min(5, shuffled.length));
  const bubblesShown = toShow.length;

  // Session-level counter: every paint contributes, no throttle. The
  // session summary (fireBubblesSessionSummary) reports this on unload.
  sessionBubblesShownCount += bubblesShown;

  // Throttled denominator event. `count` = bubbles painted, `qr_count_total`
  // = library size — together they let us compute insert-rate per real
  // impression without per-millisecond noise. Throttled to one emission
  // every 10s per page load — see ANALYTICS.md for the throttle note.
  try {
    const now = Date.now();
    if (window.track && now - lastBubblesShownAt >= BUBBLES_SHOWN_THROTTLE_MS) {
      lastBubblesShownAt = now;
      // Q: How often do the bubbles get painted? Useful for spotting
      // chat-switch noise; sessions summary handles conversion-rate
      // questions instead.
      window.track("quick_reply_bubbles_shown", {
        count: bubblesShown,
        qr_count_total: replies.length,
      });
    }
  } catch (_) { /* analytics must never break WhatsApp */ }

  toShow.forEach((text, index) => {
    const bubble = document.createElement("span");
    bubble.textContent = text;
    bubble.className = "quick-reply-bubble";
    bubble.style.animationDelay = `${index * 0.1}s`;

    bubble.addEventListener("click", () => {
      const textarea = footer.querySelector("div[contenteditable='true']");
      if (textarea) {
        textarea.focus();
        document.execCommand("insertText", false, text);
      }
      sessionBubblesInsertedCount++;
      // Analytics: never the reply text or anything from the chat. Position
      // and count are structural — they refer to bubble slots, not content.
      try {
        if (window.track) {
          // Q: Which slot positions do users actually click? Tells us
          // whether the random shuffling is finding distribution or
          // whether position bias is real.
          window.track("quick_reply_inserted", {
            bubble_position: index,
            bubbles_shown: bubblesShown,
          });
        }
      } catch (e) { /* analytics must never break WhatsApp */ }
    });

    container.appendChild(bubble);
  });
}

let qrInsertInFlight = false;

function insertQuickReplyBubbles() {
  if (qrInsertInFlight) return;
  const footer = document.querySelector("footer");
  if (!footer || document.getElementById("quick-reply-bubbles")) return;

  qrInsertInFlight = true;

  chrome.storage.local.get(["quickReplies"], (result) => {
    try {
      // Re-check the footer/container — DOM may have changed during the async read.
      const footerNow = document.querySelector("footer");
      if (!footerNow || document.getElementById("quick-reply-bubbles")) return;

      const replies = Array.isArray(result.quickReplies)
        ? result.quickReplies
        : [];
      if (replies.length === 0) return;

      if (!document.getElementById("qr-bubble-styles")) {
        const styleSheet = document.createElement("style");
        styleSheet.id = "qr-bubble-styles";
        styleSheet.textContent = bubbleStyles;
        document.head.appendChild(styleSheet);
      }

      const container = document.createElement("div");
      container.id = "quick-reply-bubbles";
      footerNow.insertBefore(container, footerNow.firstChild);
      buildBubbles(container, replies, footerNow);
    } finally {
      qrInsertInFlight = false;
    }
  });
}

// Refresh bubbles live when the user saves changes in the popup
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.quickReplies) return;

  const replies = Array.isArray(changes.quickReplies.newValue)
    ? changes.quickReplies.newValue
    : [];

  const container = document.getElementById("quick-reply-bubbles");

  // User emptied the list — remove the bar entirely so it disappears live.
  if (replies.length === 0) {
    if (container) container.remove();
    return;
  }

  const footer = document.querySelector("footer");
  if (!footer) return;

  // User had no bubbles before (no container) but now has some — insert fresh.
  if (!container) {
    insertQuickReplyBubbles();
    return;
  }

  container.innerHTML = "";
  buildBubbles(container, replies, footer);
});

function observeDOMForQuickReplies() {
  const observer = new MutationObserver(() => {
    const footer = document.querySelector("footer");
    const bubbleReply = document.getElementById("quick-reply-bubbles");

    if (footer && !bubbleReply) {
      insertQuickReplyBubbles();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

observeDOMForQuickReplies();
