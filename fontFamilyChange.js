// This file is loaded as both a popup script (where #fontSelector exists)
// and a content script on web.whatsapp.com (where it does not). The guard
// below makes the content-script load a no-op so we don't TypeError on
// `null.addEventListener`. Font injection on WhatsApp Web is handled by
// content.js's applyFont path, so this file simply has nothing to do there.
const fontSelector = document.getElementById("fontSelector");
if (fontSelector) {
let styleTag = null;
let fontLink = null;

// Hilfsfunktion: Schriftart anwenden
function applyFont(font) {
  // Wenn keine Auswahl ("Nothing"), Standard-Schrift
  if (!font) {
    if (!styleTag) {
      styleTag = document.createElement("style");
      document.head.appendChild(styleTag);
    }
    styleTag.innerHTML = `
      * {
        font-family: sans-serif !important;
      }
    `;
    // Falls vorher ein Google Font Link existiert, entfernen
    if (fontLink) {
      fontLink.remove();
      fontLink = null;
    }
    return;
  }

  // Google Font dynamisch laden
  if (!fontLink) {
    fontLink = document.createElement("link");
    fontLink.rel = "stylesheet";
    document.head.appendChild(fontLink);
  }
  fontLink.href = `https://fonts.googleapis.com/css2?family=${font}&display=swap`;

  // Style-Tag aktualisieren / erstellen
  if (!styleTag) {
    styleTag = document.createElement("style");
    document.head.appendChild(styleTag);
  }
  styleTag.innerHTML = `
    * {
      font-family: '${font.replace(/\+/g, " ")}', sans-serif !important;
    }
  `;
}

// ── Session-settled tracking ────────────────────────────────────────────
//
// Q: Where do users LAND when exploring fonts? font_family_changed fires
//    per-step (median ~21 per user in production); this event captures the
//    destination so we can build a "tried→settled" funnel.
//
// Trigger rules (kept explicit so the data is interpretable):
//   - Fires at most ONCE per popup session.
//   - Fires on `pagehide` IFF the user changed the font at least once in
//     this popup session (pagehide is the popup-close signal — `beforeunload`
//     fires unreliably for Chrome extension popups).
//   - Also fires after 60s of no further font changes (catches users who
//     leave the popup open after settling).
//   - Does NOT fire if the user never touched the font control in this
//     popup session.
//
// Without these rules being explicit, `changes_in_session` would be a
// denominator no one trusts. Document in ANALYTICS.md, match the impl.
const SETTLED_IDLE_MS = 60_000;
let fontChangesInSession = 0;
let lastChosenFont = "";
let settledFired = false;
let idleTimer = null;

function maybeFireFontSettled(reason) {
  if (settledFired) return;
  if (fontChangesInSession === 0) return;       // Never touched → don't fire.
  settledFired = true;
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  try {
    if (typeof window !== "undefined" && window.track) {
      window.track("font_family_session_settled", {
        final_font: lastChosenFont || "",
        changes_in_session: fontChangesInSession,
      });
    }
  } catch (_) { /* ignore */ }
}

// Event Listener für Änderung
fontSelector.addEventListener("change", () => {
  const selectedFont = fontSelector.value;
  applyFont(selectedFont);

  // Auswahl speichern
  chrome.storage.local.set({ fontStyle: selectedFont });

  // Analytics: the font value comes from the fixed <select> enum in
  // popup.html; "" means "Nothing". No free-text user input.
  try {
    if (typeof window !== "undefined" && window.track) {
      // Q: How much font exploration do users do before settling?
      // Pairs with font_family_session_settled to model the journey.
      window.track("font_family_changed", { font: selectedFont || "" });
    }
  } catch (e) { /* ignore */ }

  fontChangesInSession++;
  lastChosenFont = selectedFont || "";
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => maybeFireFontSettled("idle"), SETTLED_IDLE_MS);
});

// Popup unload (Chrome closes the popup → DOM is destroyed). `pagehide` is
// the recommended unload signal for extension popups; `beforeunload` doesn't
// fire reliably here. We fire-and-forget; track.js's sendMessage is fast
// enough to be picked up by the service worker before teardown.
window.addEventListener("pagehide", () => maybeFireFontSettled("popup_close"));

// Beim Laden prüfen, ob schon ein Font gespeichert wurde
chrome.storage.local.get(["fontStyle"], (result) => {
  const savedFont = result.fontStyle || "";
  fontSelector.value = savedFont; // Vorauswahl setzen
  applyFont(savedFont); // Direkt anwenden
});
}
