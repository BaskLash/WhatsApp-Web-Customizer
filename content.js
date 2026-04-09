// Hauptfunktion: Initialisiert das Burger-Menü und die Logik für die Navigation
function initBurgerMenu() {
  // Selektoren als Strings speichern
  const containerSelector = ".x1c4vz4f.xs83m0k.xdl72j9.x1g77sc7.x78zum5.xozqiw3.x1oa3qoh.x12fk4p8.xeuugli.x2lwn1j.x1nhvcw1.xdt5ytf.x1cy8zhl.x1277o0a";
  const homeChatHeaderSelector = "div[class] > header:first-child";

  // Hilfsfunktion: Findet das Div, das den Header enthält
  const getHomeChatElement = () => document.querySelector(homeChatHeaderSelector)?.parentElement;

  function tryInit() {
    const container = document.querySelector(containerSelector);
    if (!container) return; 
    if (document.querySelector(".custom-burger-menu")) return;

    // Button erstellen
    const burgerButton = document.createElement("button");
    burgerButton.className = "custom-burger-menu";
    burgerButton.title = "Navigation ein-/ausblenden";
    burgerButton.innerHTML = `<span></span><span></span><span></span>`;

    // Styling hinzufügen
    const style = document.createElement("style");
    style.textContent = `
      .custom-burger-menu {
        display: inline-flex; flex-direction: column; justify-content: center; align-items: center;
        width: 40px; height: 36px; background: #444; border: none; cursor: pointer;
        padding: 6px; border-radius: 6px; z-index: 9999; transition: all 0.2s ease;
      }
      .custom-burger-menu span { display: block; width: 24px; height: 3px; background: #fff; border-radius: 2px; margin: 3px 0; }
      .custom-burger-menu:hover { background-color: #666; transform: scale(1.05); }
    `;
    document.head.appendChild(style);

    // Storage Funktionen
    const getSavedDisplayState = (key) => {
      return new Promise((resolve) => {
        chrome.storage.local.get([key], (result) => resolve(result[key] || "block"));
      });
    };

    const saveDisplayState = (key, value) => {
      chrome.storage.local.set({ [key]: value });
    };

    // Toggle Logik
    const toggleDisplay = (element, homeChatElement, key) => {
      if (!element) return;
      const currentDisplay = window.getComputedStyle(element).display;
      const newDisplay = currentDisplay === "none" ? "block" : "none";
      
      element.style.display = newDisplay;
      if (homeChatElement) homeChatElement.style.display = newDisplay;
      saveDisplayState(key, newDisplay);
    };

    // Zustand anwenden
    const applySavedState = async (elementSelector, storageKey, isHomeChat = false) => {
      const savedState = await getSavedDisplayState(storageKey);
      const element = isHomeChat ? getHomeChatElement() : document.querySelector(elementSelector);
      
      if (element) {
        element.style.display = savedState;
      }
    };

    // Click Event
    burgerButton.addEventListener("click", async () => {
      const homeChatElement = getHomeChatElement();
      
      const statusActive = document.querySelector("button[aria-label='Status'][aria-pressed='true']");
      const channelsActive = document.querySelector("button[aria-label='Channels'][aria-pressed='true']");
      const communitiesActive = document.querySelector("button[aria-label='Communities'][aria-pressed='true']");

      if (statusActive) {
        toggleDisplay(document.querySelector("div[aria-label='Status tab drawer']"), homeChatElement, "statusDisplay");
      } else if (channelsActive) {
        toggleDisplay(document.querySelector("div[aria-label='Channel tab drawer']"), homeChatElement, "channelsDisplay");
      } else if (communitiesActive) {
        toggleDisplay(document.querySelector("div[aria-label='Community tab drawer']"), homeChatElement, "communitiesDisplay");
      } else {
        toggleDisplay(homeChatElement, homeChatElement, "chatsDisplay");
      }
    });

    // Nav-Buttons Listener
    const setupNavButton = (btnSelector, targetSelector, storageKey, isHomeChat = false) => {
      const btn = document.querySelector(btnSelector);
      if (btn) {
        btn.addEventListener("click", () => {
          setTimeout(() => applySavedState(targetSelector, storageKey, isHomeChat), 150);
        });
      }
    };

    setupNavButton("button[aria-label='Chats']", homeChatHeaderSelector, "chatsDisplay", true);
    setupNavButton("button[aria-label='Status']", "div[aria-label='Status tab drawer']", "statusDisplay");
    setupNavButton("button[aria-label='Channels']", "div[aria-label='Channel tab drawer']", "channelsDisplay");
    setupNavButton("button[aria-label='Communities']", "div[aria-label='Community tab drawer']", "communitiesDisplay");

    container.insertBefore(burgerButton, container.firstChild);

    // Initialen Zustand laden
    const initStates = async () => {
      await applySavedState(homeChatHeaderSelector, "chatsDisplay", true);
      await applySavedState("div[aria-label='Status tab drawer']", "statusDisplay");
      await applySavedState("div[aria-label='Channel tab drawer']", "channelsDisplay");
      await applySavedState("div[aria-label='Community tab drawer']", "communitiesDisplay");
    };
    initStates();
  }

  const interval = setInterval(() => {
    tryInit();
    if (document.querySelector(containerSelector)) clearInterval(interval);
  }, 500);
}

// MutationObserver: Reagiert auf Änderungen im DOM (für dynamisches Laden)
function observeDOMChanges() {
  const observer = new MutationObserver((mutations) => {
    if (
      mutations.some(
        (mutation) =>
          mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0
      )
    ) {
      initBurgerMenu(); // Versuche, das Menü neu zu initialisieren
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function applyVisibilityOptions() {
  chrome.storage.local.get(["visibilityOptions"], (data) => {
    const options = data.visibilityOptions || {
      status: false,
      channels: false,
      communities: false,
      lockedChats: false,
      archived: false,
    };

    const parent = document.querySelector(
      ".x1c4vz4f.xs83m0k.xdl72j9.x1g77sc7.x78zum5.xozqiw3.x1oa3qoh.x12fk4p8.xeuugli.x2lwn1j.x1nhvcw1.xdt5ytf.x1cy8zhl.x1277o0a"
    );
    if (parent) {
      const divChildren = Array.from(parent.children).filter(
        (child) => child.tagName.toLowerCase() === "div"
      );
      const map = { status: 1, channels: 2, communities: 3 };

      for (const key in map) {
        const index = map[key];
        if (divChildren[index]) {
          divChildren[index].style.display = options[key] ? "block" : "none";
        }
      }
    }

    // Handle Locked Chats and Archived
    const paneSide = document.getElementById("pane-side");
    if (paneSide) {
      const lockedChats = paneSide.querySelector(
        "button[aria-label='Locked chats']"
      );
      const archived = paneSide.querySelector("button[aria-label='Archived ']");

      if (lockedChats) {
        lockedChats.style.display = options.lockedChats ? "block" : "none";
      }

      if (archived) {
        archived.style.display = options.archived ? "block" : "none";
      }
    }
  });
}

// Hauptstartfunktion
function runAll() {
  initBurgerMenu();
  observeDOMChanges();

  // Versuche mehrfach, die Visibility anzuwenden
  let tries = 0;
  const interval = setInterval(() => {
    applyVisibilityOptions();
    tries++;
    if (tries > 10) clearInterval(interval);
  }, 1000);
}

// Starte, wenn die Seite geladen ist
document.addEventListener("DOMContentLoaded", runAll);
window.addEventListener("load", runAll);
window.addEventListener("load", customThemes);
setTimeout(runAll, 3000); // Fallback für verzögertes Laden

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "applyVisibilityFromPopup") {
    applyVisibilityOptions();
  }
});

// Apply zoom-based scaling to the whole WhatsApp Web page.
// Using CSS `zoom` (Chrome-only, but this is a Chrome extension) so that
// the entire layout shrinks/grows — ideal for small-window setups.
function applyFontScale(scale) {
  let style = document.getElementById("wa-font-scale-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "wa-font-scale-style";
    document.head.appendChild(style);
  }
  style.innerHTML = (scale && scale !== 1)
    ? `html { zoom: ${scale}; }`
    : "";
}

// Load saved scale on page load
chrome.storage.local.get(["wa-custom-scale"], (result) => {
  applyFontScale(Number(result["wa-custom-scale"] ?? 1));
});

// Re-apply whenever the popup changes the value
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes["wa-custom-scale"]) {
    applyFontScale(Number(changes["wa-custom-scale"].newValue ?? 1));
  }
});

// ── Light Font Mode ────────────────────────────────────────────────────────────
// Overrides bold font-weight in the sidebar and chat header so the UI looks
// lighter. Targets only named text nodes — not icons or avatars.
function applyLightFont(enabled) {
  let style = document.getElementById("wa-light-font-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "wa-light-font-style";
    document.head.appendChild(style);
  }
  style.innerHTML = enabled ? `
    #pane-side span[title],
    #pane-side span[dir="auto"],
    #pane-side span[dir="ltr"],
    #main header span[dir="auto"],
    #main header span[dir="ltr"],
    #main header h1 {
      font-weight: 400 !important;
    }
  ` : "";
}

chrome.storage.local.get(["lightFont"], (result) => {
  applyLightFont(!!result.lightFont);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.lightFont !== undefined) {
    applyLightFont(!!changes.lightFont.newValue);
  }
});

// ── Privacy Mode ───────────────────────────────────────────────────────────────
// Blurs message previews in the chat list so bystanders or screen-share
// viewers cannot read conversations. Hovering a row reveals it temporarily.
function applyPrivacyMode(enabled) {
  let style = document.getElementById("wa-privacy-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "wa-privacy-style";
    document.head.appendChild(style);
  }
  style.innerHTML = enabled ? `
    #pane-side [role="row"] > div {
      filter: blur(6px);
      transition: filter 0.15s ease;
    }
    #pane-side [role="row"]:hover > div {
      filter: blur(0);
    }
  ` : "";
}

chrome.storage.local.get(["privacyMode"], (result) => {
  applyPrivacyMode(!!result.privacyMode);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.privacyMode !== undefined) {
    applyPrivacyMode(!!changes.privacyMode.newValue);
  }
});

// ── Custom Chat Pinning ────────────────────────────────────────────────────────
// Extends WhatsApp's 3-pin limit with unlimited client-side custom pins.
// A "Pin" button appears on hover over each chat row. Pinned chats receive
// a visible 📌 marker. Storage key: "customPinnedChats" (string[]).
(function initCustomPinning() {
  const STORAGE_KEY = "customPinnedChats";
  const BTN_CLASS   = "wa-cpin-btn";
  const MARK_CLASS  = "wa-cpin-marker";

  // Inject once — position:relative on rows is all we need via CSS
  const style = document.createElement("style");
  style.id = "wa-cpin-style";
  style.innerHTML = `
    #pane-side [role="row"] { position: relative; }
    .${BTN_CLASS} {
      position: absolute; bottom: 6px; right: 6px;
      background: rgba(16,185,129,0.9); color: #fff;
      border: none; border-radius: 4px;
      padding: 2px 7px; font-size: 10px; font-family: sans-serif;
      cursor: pointer; z-index: 20; opacity: 0;
      transition: opacity 0.15s ease;
      pointer-events: auto;
    }
    #pane-side [role="row"]:hover .${BTN_CLASS} { opacity: 1; }
    .${MARK_CLASS} {
      position: absolute; top: 6px; right: 6px;
      font-size: 11px; z-index: 20; pointer-events: none;
      filter: drop-shadow(0 0 2px rgba(0,0,0,0.6));
    }
  `;
  document.head.appendChild(style);

  function getPinned(cb) {
    chrome.storage.local.get([STORAGE_KEY], (r) => cb(r[STORAGE_KEY] || []));
  }
  function savePinned(list) {
    chrome.storage.local.set({ [STORAGE_KEY]: list });
  }
  function getChatName(row) {
    const el = row.querySelector("span[title]") ||
               row.querySelector("span[dir='auto']");
    return el ? (el.title || el.textContent).trim() : null;
  }

  function applyPinMarkers() {
    const rows = document.querySelectorAll('#pane-side [role="row"]');
    if (!rows.length) return;

    getPinned((pinned) => {
      rows.forEach((row) => {
        const name = getChatName(row);
        if (!name) return;

        const isPinned = pinned.includes(name);

        // Pin marker (📌 icon)
        let marker = row.querySelector(`.${MARK_CLASS}`);
        if (isPinned && !marker) {
          marker = document.createElement("span");
          marker.className = MARK_CLASS;
          marker.textContent = "📌";
          row.appendChild(marker);
        } else if (!isPinned && marker) {
          marker.remove();
        }

        // Pin / Unpin button (shown on hover via CSS)
        let btn = row.querySelector(`.${BTN_CLASS}`);
        if (!btn) {
          btn = document.createElement("button");
          btn.className = BTN_CLASS;
          row.appendChild(btn);

          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            const chatName = getChatName(row);
            if (!chatName) return;
            getPinned((current) => {
              const updated = current.includes(chatName)
                ? current.filter((n) => n !== chatName)
                : [...current, chatName];
              savePinned(updated);
              // Immediate visual refresh without waiting for interval
              applyPinMarkers();
            });
          });
        }

        btn.textContent = isPinned ? "Unpin" : "Pin";
        btn.title = isPinned ? "Remove custom pin" : "Custom pin this chat";
      });
    });
  }

  // Re-apply when storage changes (e.g. pinned from another context)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY]) applyPinMarkers();
  });

  // Poll periodically to catch newly rendered rows (virtual scroll)
  // Debounced so it does not pile up if the page is very active
  let pollTimer = null;
  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(applyPinMarkers, 300);
  }

  // Watch #pane-side for structural changes (chat list updates)
  function observePaneSide() {
    const paneSide = document.getElementById("pane-side");
    if (!paneSide) return false;
    new MutationObserver((mutations) => {
      // Ignore mutations caused by our own marker/button nodes
      const isOwn = mutations.every((m) =>
        [...m.addedNodes, ...m.removedNodes].every(
          (n) => n.nodeType !== 1 ||
            n.classList?.contains(BTN_CLASS) ||
            n.classList?.contains(MARK_CLASS)
        )
      );
      if (!isOwn) schedulePoll();
    }).observe(paneSide, { childList: true, subtree: true });
    return true;
  }

  // Start once pane-side is present
  if (!observePaneSide()) {
    const waitForPane = setInterval(() => {
      if (observePaneSide()) {
        clearInterval(waitForPane);
        applyPinMarkers();
      }
    }, 800);
  } else {
    applyPinMarkers();
  }
})();

// Funktion, die die Schrift global setzt
function applyFont(fontName) {
  let existingLink = document.getElementById("dynamicFontLink");
  let existingStyle = document.getElementById("dynamicFontStyle");

  if (existingLink) existingLink.remove();
  if (existingStyle) existingStyle.remove();

  if (!fontName) return;

  // 1. Google Font Link
  const link = document.createElement("link");
  link.id = "dynamicFontLink";
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${fontName}&display=swap`;
  document.head.appendChild(link);

  // 2. Replace + with space for CSS
  const cssFontName = fontName.replace(/\+/g, " ");

  // 3. Style tag
  const style = document.createElement("style");
  style.id = "dynamicFontStyle";
  style.innerHTML = `
    * {
      font-family: '${cssFontName}', sans-serif !important;
    }
  `;
  document.head.appendChild(style);
}

// 1️⃣ Beim Laden prüfen, ob schon ein Font gespeichert ist
chrome.storage.local.get(["fontStyle"], (result) => {
  const fontName = result.fontStyle || "";
  applyFont(fontName);
});

// 2️⃣ Änderungen an fontStyle direkt anwenden
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.fontStyle) {
    const newFont = changes.fontStyle.newValue || "";
    applyFont(newFont);
  }
});
