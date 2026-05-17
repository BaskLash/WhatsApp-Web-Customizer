// Popup logic for the Themes tab.
// - Renders preset cards (from WA_THEME_PRESETS) and any custom themes
//   the user has imported (from chrome.storage.local["themes:custom"]).
// - Clicking a card writes { id } to "themes:active"; the content script
//   (themes-content.js) listens to chrome.storage and re-renders WhatsApp Web.
// - "Manage Items" opens themes.html in a new tab.

(function () {
  const ACTIVE_KEY = "themes:active";
  const CUSTOM_KEY = "themes:custom";

  // Cached count of custom themes, refreshed by renderAll(). The sub-tab
  // analytics event reports this without needing an extra storage read.
  let customThemeCount = 0;

  function getAllThemes(customs) {
    const presets = Array.isArray(globalThis.WA_THEME_PRESETS) ? globalThis.WA_THEME_PRESETS : [];
    return { presets, customs: Array.isArray(customs) ? customs : [] };
  }

  // One way to open the Theme Manager from anywhere in the popup. `hash`
  // controls the deep-link target on the manager page (#create pops the
  // editor open on load — see themes-manage.js). `source` is forwarded to
  // analytics. Hoisted out of DOMContentLoaded so the empty-state CTA and
  // "+ New theme" affordances can call it.
  function openManager(opts) {
    const source = opts && opts.source;
    const hash = opts && opts.hash;
    try {
      if (window.track) {
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
    const emptyState = document.getElementById("theme-customs-empty");
    const newBtn     = document.getElementById("theme-customs-new");
    if (!presetGrid || !customGrid) return;

    chrome.storage.local.get([ACTIVE_KEY, CUSTOM_KEY], (result) => {
      const activeId = (result[ACTIVE_KEY] && result[ACTIVE_KEY].id) || null;
      const { presets, customs } = getAllThemes(result[CUSTOM_KEY]);

      presetGrid.innerHTML = "";
      presets.forEach((t) => presetGrid.appendChild(renderCard(t, activeId)));

      customGrid.innerHTML = "";
      customThemeCount = customs.length;
      if (customs.length === 0) {
        if (emptyState) emptyState.style.display = "";
        if (newBtn) newBtn.style.display = "none";
      } else {
        if (emptyState) emptyState.style.display = "none";
        if (newBtn) newBtn.style.display = "";
        customs.forEach((t) => customGrid.appendChild(renderCard(t, activeId)));
      }
    });
  }

  // ── Sub-tab navigation (Presets / Custom) ─────────────────────────────────
  // Mirrors animated-bg-popup.js's activateSubtab. We use a separate
  // [data-themes-subtab] attribute so the two surfaces don't accidentally
  // cross-toggle, but the CSS classes (.bg-subtabs / .bg-subtab / .bg-subpane)
  // are shared with Backgrounds — same look, same a11y attributes.
  function activateThemesSubtab(target, fireAnalytics) {
    const tabs = document.querySelectorAll("[data-themes-subtab]");
    if (!tabs.length) return;
    let previous = null;
    tabs.forEach((t) => {
      const on = t.dataset.themesSubtab === target;
      if (t.classList.contains("active")) previous = t.dataset.themesSubtab;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll("#tab-themes .bg-subpane").forEach((p) => {
      p.hidden = p.id !== target;
    });
    if (fireAnalytics && previous && previous !== target) {
      try {
        if (window.track) {
          window.track("themes_subtab_changed", {
            from_subtab: subtabIdToEnum(previous),
            to_subtab:   subtabIdToEnum(target),
            custom_theme_count: customThemeCount,
          });
        }
      } catch (_) { /* ignore */ }
    }
  }

  // The DOM ids ("themes-presets" / "themes-customs") are scoped for HTML
  // uniqueness; the analytics enum is the unscoped form the spec asks for.
  function subtabIdToEnum(id) {
    if (id === "themes-presets") return "presets";
    if (id === "themes-customs") return "custom";
    return id;
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderAll();

    // Sub-tab clicks. Same wiring shape as animated-bg-popup.js so behavior
    // matches the Backgrounds tab; analytics is keyed on the unscoped enum.
    document.querySelectorAll("[data-themes-subtab]").forEach((tab) => {
      tab.addEventListener("click", () =>
        activateThemesSubtab(tab.dataset.themesSubtab, true)
      );
    });

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

    // New entry points for the Custom sub-tab. Both deep-link to the editor
    // via the same #create hash mechanism; only the analytics `source`
    // differs so we can tell which surface drove the open.
    const emptyCta = document.getElementById("theme-customs-create");
    if (emptyCta) {
      emptyCta.addEventListener("click", () =>
        openManager({ source: "popup_custom_empty_state", hash: "#create" })
      );
    }

    const newThemeBtn = document.getElementById("theme-customs-new");
    if (newThemeBtn) {
      newThemeBtn.addEventListener("click", () =>
        openManager({ source: "popup_custom_subtab", hash: "#create" })
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
