// Utility: Apply transparency to the header once
function makeHeaderTransparent() {
  const header = document.querySelector("header");
  if (header && header.style.background !== "transparent") {
    header.style.background = "transparent";
  }
}

// Build and inject a global <style> tag with differentiated glow animations.
// colorIn  → received messages (.message-in)
// colorOut → sent messages    (.message-out)
// Scoped to the active chat panel so no system UI is affected.
function applyGlowingEffect(colorIn, colorOut) {
  const styleContent = `
    @keyframes glowIn {
      0%   { box-shadow: 0 0 5px ${colorIn},  0 0 10px ${colorIn};  }
      100% { box-shadow: 0 0 10px ${colorIn}, 0 0 20px ${colorIn}; }
    }
    @keyframes glowOut {
      0%   { box-shadow: 0 0 5px ${colorOut},  0 0 10px ${colorOut};  }
      100% { box-shadow: 0 0 10px ${colorOut}, 0 0 20px ${colorOut}; }
    }

    div[tabindex='0'][data-tab='8'] .message-in ._amk6,
    div[tabindex='0'][data-tab='8'] .message-in ._amk4 {
      border: 2px solid transparent;
      border-radius: 8px;
      animation: glowIn 2s infinite alternate;
    }

    div[tabindex='0'][data-tab='8'] .message-out ._amk6,
    div[tabindex='0'][data-tab='8'] .message-out ._amk4 {
      border: 2px solid transparent;
      border-radius: 8px;
      animation: glowOut 2s infinite alternate;
    }
  `;

  let style = document.getElementById("glowingBorderStyle");
  if (!style) {
    style = document.createElement("style");
    style.id = "glowingBorderStyle";
    document.head.appendChild(style);
  }
  // Only rewrite the tag when the colors actually changed
  if (style.innerHTML !== styleContent) {
    style.innerHTML = styleContent;
  }
}

// Read both color keys and apply. Centralising the read here ensures
// that a change to either key always sees the up-to-date value of the other.
function loadAndApply() {
  chrome.storage.local.get(["colorIn", "colorOut"], (result) => {
    applyGlowingEffect(
      result.colorIn  || "#00aaff",
      result.colorOut || "#00ff88"
    );
  });
}

// Initialize on load
function initGlowingFeature() {
  makeHeaderTransparent();

  // 1️⃣ Apply saved colors immediately
  loadAndApply();

  // 2️⃣ Re-apply whenever either color is changed from the popup
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && (changes.colorIn || changes.colorOut)) {
      loadAndApply();
    }
  });
}

// ✅ Run it!
initGlowingFeature();
