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
