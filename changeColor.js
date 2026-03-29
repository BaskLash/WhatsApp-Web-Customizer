// Utility: Apply transparency to the header once
function makeHeaderTransparent() {
  const header = document.querySelector("header");
  if (header && header.style.background !== "transparent") {
    header.style.background = "transparent";
  }
}

// Inject (or update) a global <style> tag that targets bubble selectors directly.
// Because it lives in <head>, it automatically covers all messages including those
// loaded after a chat switch — no per-node class manipulation needed.
function applyGlowingEffect(colors) {
  if (!Array.isArray(colors)) colors = [colors];

  const keyframes = colors
    .map((c, i) => {
      const percent = Math.floor((i / colors.length) * 100);
      return `${percent}% { box-shadow: 0 0 5px ${c}, 0 0 10px ${c}; }`;
    })
    .join("\n") +
    `\n100% { box-shadow: 0 0 5px ${colors[colors.length - 1]}, 0 0 10px ${colors[colors.length - 1]}; }`;

  const styleContent = `
    @keyframes glowingBorder {
      ${keyframes}
    }
    ._amk6, ._amk4 {
      border: 2px solid transparent;
      border-radius: 8px;
      animation: glowingBorder 2s infinite alternate;
    }
  `;

  let style = document.getElementById("glowingBorderStyle");
  if (!style) {
    style = document.createElement("style");
    style.id = "glowingBorderStyle";
    document.head.appendChild(style);
  }
  // Only rewrite the tag when the color actually changed
  if (style.innerHTML !== styleContent) {
    style.innerHTML = styleContent;
  }
}

// Initialize on load
function initGlowingFeature() {
  makeHeaderTransparent();

  // 1️⃣ Get initial color and apply
  chrome.storage.local.get(["color"], (result) => {
    applyGlowingEffect(result.color || "#ff00ff");
  });

  // 2️⃣ Watch for color updates in storage
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.color) {
      applyGlowingEffect(changes.color.newValue || "#ff00ff");
    }
  });
}

// ✅ Run it!
initGlowingFeature();
