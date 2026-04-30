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

// Event Listener für Änderung
fontSelector.addEventListener("change", () => {
  const selectedFont = fontSelector.value;
  applyFont(selectedFont);

  // Auswahl speichern
  chrome.storage.local.set({ fontStyle: selectedFont });
});

// Beim Laden prüfen, ob schon ein Font gespeichert wurde
chrome.storage.local.get(["fontStyle"], (result) => {
  const savedFont = result.fontStyle || "";
  fontSelector.value = savedFont; // Vorauswahl setzen
  applyFont(savedFont); // Direkt anwenden
});
}
