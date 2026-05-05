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

function buildBubbles(container, replies, footer) {
  const shuffled = [...replies].sort(() => 0.5 - Math.random());
  const toShow = shuffled.slice(0, Math.min(5, shuffled.length));

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
      // Analytics: never the reply text or anything from the chat. Only
      // that a bubble was used.
      try {
        if (window.track) window.track("quick_reply_inserted");
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
