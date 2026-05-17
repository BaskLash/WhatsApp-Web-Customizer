// Popup logic for the Themes tab.
// - Renders preset cards (from WA_THEME_PRESETS) and any custom themes
//   the user has imported (from chrome.storage.local["themes:custom"]).
// - Clicking a card writes { id } to "themes:active"; the content script
//   (themes-content.js) listens to chrome.storage and re-renders WhatsApp Web.
// - "Manage Items" opens themes.html in a new tab.

(function () {
  const ACTIVE_KEY = "themes:active";
  const CUSTOM_KEY = "themes:custom";

  function getAllThemes(customs) {
    const presets = Array.isArray(globalThis.WA_THEME_PRESETS) ? globalThis.WA_THEME_PRESETS : [];
    return { presets, customs: Array.isArray(customs) ? customs : [] };
  }

  function buildSwatch(vars) {
    // Theme values may be gradients (linear-gradient(...)) or solid colors,
    // so render four side-by-side cells whose `background` accepts either.
    const stops = [
      vars["--wait-color-side"]              || "#222",
      vars["--wait-side-chat-items"]         || "#333",
      vars["--message-outgoing"]             || "#444",
      vars["--hyperlink-text"]               || "#10b981"
    ];
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex; width:100%; height:100%;";
    stops.forEach((s) => {
      const cell = document.createElement("div");
      cell.style.cssText = `flex:1 1 0; background:${s};`;
      wrap.appendChild(cell);
    });
    return wrap;
  }

  function renderCard(theme, activeId) {
    const col = document.createElement("div");
    col.className = "col-6";

    const card = document.createElement("div");
    card.className = "theme-card" + (theme.id === activeId ? " active" : "");
    card.dataset.id = theme.id;
    card.setAttribute("role", "button");
    card.tabIndex = 0;

    const swatch = document.createElement("div");
    swatch.className = "theme-swatch";
    swatch.appendChild(buildSwatch(theme.vars || {}));

    const label = document.createElement("div");
    label.className = "theme-label";
    label.textContent = theme.name || theme.id;

    const tag = document.createElement("span");
    tag.className = "theme-tag";
    tag.textContent = theme.source === "preset" ? "Preset" : "Custom";

    card.appendChild(swatch);
    card.appendChild(label);
    card.appendChild(tag);
    col.appendChild(card);

    const activate = () => {
      chrome.storage.local.set({ [ACTIVE_KEY]: { id: theme.id } });
      // Analytics: presets get their stable id (e.g. "preset-blue").
      // Custom themes report only "custom" — never the user's chosen name.
      try {
        if (window.track) {
          window.track("theme_applied", {
            theme_id: globalThis.WA_SAFE_THEME_ID_FOR_ANALYTICS(theme),
            source: theme.source === "preset" ? "preset" : "custom",
          });
        }
      } catch (e) { /* ignore */ }
    };
    card.addEventListener("click", activate);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate();
      }
    });

    return col;
  }

  function renderAll() {
    const presetGrid = document.getElementById("theme-presets-grid");
    const customGrid = document.getElementById("theme-customs-grid");
    const customWrap = document.getElementById("theme-customs-wrap");
    if (!presetGrid || !customGrid) return;

    chrome.storage.local.get([ACTIVE_KEY, CUSTOM_KEY], (result) => {
      const activeId = (result[ACTIVE_KEY] && result[ACTIVE_KEY].id) || null;
      const { presets, customs } = getAllThemes(result[CUSTOM_KEY]);

      presetGrid.innerHTML = "";
      presets.forEach((t) => presetGrid.appendChild(renderCard(t, activeId)));

      customGrid.innerHTML = "";
      if (customs.length === 0) {
        if (customWrap) customWrap.style.display = "none";
      } else {
        if (customWrap) customWrap.style.display = "";
        customs.forEach((t) => customGrid.appendChild(renderCard(t, activeId)));
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderAll();

    // Opening the manager from one of two buttons. We always reuse the
    // same target tab/path so the manager page is single-instance from
    // the user's perspective; only the analytics `source` differs and,
    // for "Create", we tack on `#create` so themes-manage.js can pop the
    // editor open on load.
    function openManager(opts) {
      const source = opts && opts.source;
      const hash = opts && opts.hash;
      try {
        if (window.track) {
          // Existing default has no `source` (preserves historical shape).
          // The new Create entry adds source: "create_button".
          if (source) window.track("theme_manager_opened", { source });
          else window.track("theme_manager_opened");
        }
      } catch (e) { /* ignore */ }
      const url = chrome.runtime.getURL("themes.html") + (hash || "");
      if (chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url });
      } else {
        window.open(url, "_blank");
      }
    }

    const manageBtn = document.getElementById("open-theme-manager");
    if (manageBtn) {
      manageBtn.addEventListener("click", () => openManager());
    }

    const createBtn = document.getElementById("create-theme");
    if (createBtn) {
      createBtn.addEventListener("click", () =>
        openManager({ source: "create_button", hash: "#create" })
      );
    }

    const resetBtn = document.getElementById("reset-theme");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        chrome.storage.local.remove(ACTIVE_KEY);
        try {
          if (window.track) window.track("theme_reset");
        } catch (e) { /* ignore */ }
      });
    }

    // Live-refresh the active highlight if storage changes (e.g. another
    // popup window or the manage page applies a different theme).
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[ACTIVE_KEY] || changes[CUSTOM_KEY]) renderAll();
    });
  });
})();
