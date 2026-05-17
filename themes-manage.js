// themes-manage.js — Theme Manager page logic.
//
// Storage schema (shared with themes.js / themes-content.js):
//   "themes:active"  → { id }                 — currently applied theme
//   "themes:custom"  → Theme[]                — user-imported themes
// Presets live in window.WA_THEME_PRESETS (themes-presets.js) and are not
// stored — they are baked into the extension and cannot be deleted.

(function () {
  const ACTIVE_KEY = "themes:active";
  const CUSTOM_KEY = "themes:custom";
  const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1 MB per theme JSON

  // Internal cache so DOM rendering doesn't have to chrome.storage.get every time.
  let customs = [];
  let activeId = null;

  // ── Toast ────────────────────────────────────────────────────────────────
  let toastTimer;
  function toast(msg, kind = "info") {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.className = `toast visible ${kind === "error" ? "error" : "success"}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("visible"), 2500);
  }

  function setStatus(elId, msg, kind = "info") {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = msg;
    el.className = `status-line ${kind}`;
  }

  // ── Validation ───────────────────────────────────────────────────────────
  function validateTheme(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj))
      return "Theme must be a JSON object.";
    if (typeof obj.name !== "string" || !obj.name.trim())
      return "Theme is missing a 'name' string.";
    if (!obj.vars || typeof obj.vars !== "object" || Array.isArray(obj.vars))
      return "Theme is missing a 'vars' object.";
    const entries = Object.entries(obj.vars);
    if (entries.length === 0) return "'vars' object is empty.";
    for (const [k, v] of entries) {
      if (!k.startsWith("--"))
        return `Variable '${k}' must start with '--'.`;
      if (typeof v !== "string" || !v.trim())
        return `Variable '${k}' must be a non-empty string.`;
    }
    return null;
  }

  // Name-less custom-theme IDs. We used to slug the user's chosen name into
  // the ID, but that leaked free text into PostHog (see WA_SAFE_THEME_ID_FOR_ANALYTICS).
  // Existing slugged IDs are never migrated — see themes-presets.js for how
  // we filter them at the analytics boundary.
  //
  // Format: custom-<rand>-<time>. The rand part carries the entropy; the
  // time suffix keeps lexical-sort roughly equal to creation order, which
  // is convenient for any future debugging that wants to age-sort.
  function genId() {
    const rand = Math.random().toString(36).slice(2, 10).padEnd(8, "0");
    const time = Date.now().toString(36);
    return `custom-${rand}-${time}`;
  }

  function normalizeForStorage(raw) {
    return {
      id: typeof raw.id === "string" && raw.id.startsWith("custom-")
        ? raw.id
        : genId(),
      name: String(raw.name).trim().slice(0, 80),
      author: typeof raw.author === "string" ? raw.author.trim().slice(0, 80) : "",
      source: "custom",
      vars: raw.vars
    };
  }

  // ── Persistence ──────────────────────────────────────────────────────────
  function loadAll() {
    return new Promise((resolve) => {
      chrome.storage.local.get([ACTIVE_KEY, CUSTOM_KEY], (result) => {
        customs = Array.isArray(result[CUSTOM_KEY]) ? result[CUSTOM_KEY] : [];
        activeId = (result[ACTIVE_KEY] && result[ACTIVE_KEY].id) || null;
        resolve();
      });
    });
  }

  function saveCustoms() {
    // MV3 chrome.storage.local.set returns a Promise that rejects on errors
    // (most importantly QUOTA_BYTES). The previous callback signature
    // swallowed errors silently; the editor's storage_quota analytics
    // reason depends on the rejection bubbling up.
    return chrome.storage.local.set({ [CUSTOM_KEY]: customs });
  }

  function setActive(id) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [ACTIVE_KEY]: { id } }, resolve);
    });
  }

  function clearActiveIfMatches(id) {
    if (activeId === id) {
      return new Promise((resolve) => {
        chrome.storage.local.remove(ACTIVE_KEY, resolve);
      });
    }
    return Promise.resolve();
  }

  // Adds (or replaces) a single validated theme. Replacement happens when
  // a theme with the same id is imported — typical when re-importing an
  // exported file.
  async function addOrReplaceTheme(rawTheme) {
    const normalized = normalizeForStorage(rawTheme);
    const idx = customs.findIndex((t) => t.id === normalized.id);
    if (idx >= 0) customs[idx] = normalized;
    else customs.push(normalized);
    await saveCustoms();
    return normalized;
  }

  // ── Import: file ─────────────────────────────────────────────────────────
  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error("Read failed."));
      reader.readAsText(file);
    });
  }

  // Maps validateTheme() messages to a fixed enum so reasons stay safe to
  // report. Anything we don't recognize collapses into "other".
  function classifyValidationError(msg) {
    if (!msg) return "other";
    if (/JSON object/.test(msg)) return "not_object";
    if (/'name'/.test(msg)) return "missing_name";
    if (/'vars'/.test(msg)) return "missing_vars";
    if (/empty/.test(msg)) return "empty_vars";
    if (/start with '--'/.test(msg)) return "invalid_var_key";
    if (/non-empty string/.test(msg)) return "invalid_var_value";
    return "other";
  }

  function trackImportRejection(reason, method) {
    try {
      if (window.track) {
        window.track("theme_import_rejected", { reason, method });
      }
    } catch (_) { /* ignore */ }
  }

  async function importFromFiles(fileList, method = "file_picker") {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    let added = 0;
    let failed = 0;

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        failed++;
        trackImportRejection("too_large", method);
        setStatus("upload-status", `${file.name}: file too large.`, "error");
        continue;
      }
      try {
        const text = await readFileAsText(file);
        const parsed = JSON.parse(text);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          const err = validateTheme(item);
          if (err) {
            failed++;
            trackImportRejection(classifyValidationError(err), method);
            setStatus("upload-status", `${file.name}: ${err}`, "error");
            continue;
          }
          await addOrReplaceTheme(item);
          added++;
        }
      } catch (e) {
        failed++;
        trackImportRejection("parse_error", method);
        setStatus("upload-status", `${file.name}: ${e.message || "parse failed"}.`, "error");
      }
    }

    try {
      if (window.track && (added > 0 || failed > 0)) {
        window.track("theme_imported", {
          method,
          added_count: added,
          failed_count: failed,
        });
      }
    } catch (_) { /* ignore */ }

    if (added > 0) {
      setStatus("upload-status",
        `Imported ${added} theme${added === 1 ? "" : "s"}` +
        (failed ? ` (${failed} failed)` : ""), "success");
      toast(`Imported ${added} theme${added === 1 ? "" : "s"}.`, "success");
      renderAll();
    } else if (failed > 0) {
      toast("Import failed. See details above.", "error");
    }
  }

  // ── Import: URL ──────────────────────────────────────────────────────────
  async function importFromUrl(url) {
    setStatus("url-status", "Fetching…", "info");
    const method = "url";
    let httpFailed = false;
    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) {
        httpFailed = true;
        trackImportRejection("http_error", method);
        throw new Error(`HTTP ${res.status}`);
      }
      const parsed = await res.json();
      const items = Array.isArray(parsed) ? parsed : [parsed];
      let added = 0;
      let failed = 0;
      for (const item of items) {
        const err = validateTheme(item);
        if (err) {
          failed++;
          trackImportRejection(classifyValidationError(err), method);
          continue;
        }
        await addOrReplaceTheme(item);
        added++;
      }
      try {
        if (window.track && (added > 0 || failed > 0)) {
          window.track("theme_imported", {
            method,
            added_count: added,
            failed_count: failed,
          });
        }
      } catch (_) { /* ignore */ }
      if (added > 0) {
        setStatus("url-status",
          `Imported ${added} theme${added === 1 ? "" : "s"}` +
          (failed ? ` (${failed} skipped)` : ""), "success");
        toast(`Imported ${added} theme${added === 1 ? "" : "s"}.`, "success");
        renderAll();
      } else {
        setStatus("url-status", "No valid themes in response.", "error");
      }
    } catch (e) {
      // Don't double-count: HTTP-status failures already emitted http_error.
      if (!httpFailed) trackImportRejection("network_error", method);
      setStatus("url-status", `Failed: ${e.message || "network error"}.`, "error");
    }
  }

  // ── Export ───────────────────────────────────────────────────────────────
  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportTheme(theme) {
    const safeName = (theme.name || theme.id).replace(/[^a-z0-9-_]+/gi, "_");
    downloadJson(`${safeName}.json`, {
      name: theme.name,
      author: theme.author || "",
      vars: theme.vars
    });
    try {
      if (window.track) window.track("theme_exported", { mode: "single", count: 1 });
    } catch (_) { /* ignore */ }
  }

  function exportAll() {
    if (!customs.length) {
      toast("No custom themes to export.", "error");
      return;
    }
    downloadJson("custom-themes.json", customs.map((t) => ({
      name: t.name,
      author: t.author || "",
      vars: t.vars
    })));
    try {
      if (window.track) {
        window.track("theme_exported", { mode: "all", count: customs.length });
      }
    } catch (_) { /* ignore */ }
    toast(`Exported ${customs.length} theme${customs.length === 1 ? "" : "s"}.`, "success");
  }

  // ── Rendering ────────────────────────────────────────────────────────────
  function buildSwatch(vars) {
    // Values may be gradients or solid colors → four flex cells, each takes
    // the value as a `background` so either form renders.
    const stops = [
      vars["--wait-color-side"]      || "#222",
      vars["--wait-side-chat-items"] || "#333",
      vars["--message-outgoing"]     || "#444",
      vars["--hyperlink-text"]       || "#10b981"
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

  function renderCard(theme) {
    const card = document.createElement("div");
    card.className = "theme-card" + (theme.id === activeId ? " active" : "");
    card.dataset.id = theme.id;

    const swatch = document.createElement("div");
    swatch.className = "swatch";
    swatch.appendChild(buildSwatch(theme.vars || {}));

    const meta = document.createElement("div");
    meta.className = "meta";

    const left = document.createElement("div");
    const name = document.createElement("div");
    name.className = "meta-name";
    name.textContent = theme.name;
    left.appendChild(name);
    if (theme.author) {
      const author = document.createElement("div");
      author.className = "meta-author";
      author.textContent = `by ${theme.author}`;
      left.appendChild(author);
    }

    const badge = document.createElement("span");
    badge.className = `badge ${theme.source === "preset" ? "preset" : "custom"}`;
    badge.textContent = theme.source === "preset" ? "Preset" : "Custom";

    meta.appendChild(left);
    meta.appendChild(badge);

    const actions = document.createElement("div");
    actions.className = "actions";

    // Both presets and customs can be duplicated as a new editable custom.
    const dupBtn = document.createElement("button");
    dupBtn.className = "dup";
    dupBtn.title = "Duplicate as custom";
    dupBtn.textContent = "⎘";
    dupBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openEditor({
        mode: "create",
        source: theme.source === "preset" ? "duplicate_preset" : "duplicate_custom",
        seedFrom: theme,
      });
    });
    actions.appendChild(dupBtn);

    if (theme.source === "custom") {
      const editBtn = document.createElement("button");
      editBtn.className = "edit";
      editBtn.title = "Edit this theme";
      editBtn.textContent = "✎";
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openEditor({ mode: "edit", source: "theme_manager", editingId: theme.id });
      });
      actions.appendChild(editBtn);

      const exportBtn = document.createElement("button");
      exportBtn.className = "export";
      exportBtn.title = "Export this theme";
      exportBtn.textContent = "↓";
      exportBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        exportTheme(theme);
      });
      actions.appendChild(exportBtn);

      const delBtn = document.createElement("button");
      delBtn.className = "delete";
      delBtn.title = "Delete this theme";
      delBtn.textContent = "✕";
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const safeId = globalThis.WA_SAFE_THEME_ID_FOR_ANALYTICS(theme);
        if (!confirm(`Delete "${theme.name}"?`)) {
          try {
            if (window.track) {
              window.track("custom_theme_delete_cancelled", { theme_id: safeId });
            }
          } catch (_) { /* ignore */ }
          return;
        }
        const wasActive = activeId === theme.id;
        customs = customs.filter((t) => t.id !== theme.id);
        await saveCustoms();
        await clearActiveIfMatches(theme.id);
        try {
          if (window.track) {
            // Legacy event — kept for dashboard compat.
            window.track("theme_deleted", {
              theme_id: safeId,
              was_active: wasActive,
            });
            // New richer event — distinguishes deletion path (manager card).
            window.track("custom_theme_deleted", {
              theme_id: safeId,
              was_active: wasActive,
              source: "theme_manager",
            });
          }
        } catch (_) { /* ignore */ }
        toast("Theme deleted.", "success");
        renderAll();
      });
      actions.appendChild(delBtn);
    }

    card.appendChild(swatch);
    card.appendChild(meta);
    if (actions.childNodes.length) card.appendChild(actions);

    card.addEventListener("click", async () => {
      await setActive(theme.id);
      activeId = theme.id;
      try {
        if (window.track) {
          window.track("theme_applied", {
            theme_id: globalThis.WA_SAFE_THEME_ID_FOR_ANALYTICS(theme),
            source: theme.source === "preset" ? "preset" : "custom",
            from_page: "manage",
          });
        }
      } catch (_) { /* ignore */ }
      toast(`Applied "${theme.name}".`, "success");
      renderAll();
    });

    return card;
  }

  function renderAll() {
    const presetGrid = document.getElementById("presets-grid");
    const customGrid = document.getElementById("customs-grid");
    const customCount = document.getElementById("custom-count");
    if (!presetGrid || !customGrid) return;

    const presets = Array.isArray(globalThis.WA_THEME_PRESETS) ? globalThis.WA_THEME_PRESETS : [];

    presetGrid.innerHTML = "";
    presets.forEach((t) => presetGrid.appendChild(renderCard(t)));

    customGrid.innerHTML = "";
    if (customs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "grid-empty";
      empty.textContent = "No custom themes yet. Drop a JSON file or paste a URL above.";
      customGrid.appendChild(empty);
    } else {
      customs.forEach((t) => customGrid.appendChild(renderCard(t)));
    }

    if (customCount) {
      customCount.textContent = customs.length
        ? `${customs.length} theme${customs.length === 1 ? "" : "s"}`
        : "";
    }
  }

  // ── Editor ───────────────────────────────────────────────────────────────
  //
  // The editor is a modal that builds itself from WA_THEME_VAR_KEYS on first
  // open. Every preset, every imported theme, and every user-created theme
  // shares the exact same { name, vars } shape — so create/edit/duplicate
  // all map onto a single "draft" model. Save goes through
  // addOrReplaceTheme(), the same code path imports use, which means an
  // imported theme can be edited here without any branching.
  //
  // Var taxonomy: WA_THEME_VAR_KEYS has 17 entries. Eight are simple colors
  // (rgba/rgb/hex), nine are CSS background strings that are typically
  // linear-gradient(...). We offer a native color picker on the eight color
  // vars; the nine gradient vars only get a free-form text input because
  // <input type="color"> can't represent multi-stop gradients.

  // Friendly labels. Source of truth for which vars are color vs background.
  const VAR_META = [
    // Colors (rgba / rgb / hex). Render with color picker shortcut.
    { key: "--hyperlink-text",        label: "Hyperlink text",            kind: "color" },
    { key: "--important-text",        label: "Important text",            kind: "color" },
    { key: "--writing-text",          label: "Compose-box text",          kind: "color" },
    { key: "--read-by",               label: "Read-receipt accent",       kind: "color" },
    { key: "--message-incoming",      label: "Incoming message bubble",   kind: "color" },
    { key: "--message-outgoing",      label: "Outgoing message bubble",   kind: "color" },
    { key: "--main-bg-constant",      label: "Main background (solid)",   kind: "color" },
    { key: "--scrollbar-track-color", label: "Scrollbar track",           kind: "color" },
    // Gradients / CSS background strings. Free-form text only.
    { key: "--main-bg-to-top",                label: "Main bg — gradient ↑",       kind: "background" },
    { key: "--main-bg-to-bottom",             label: "Main bg — gradient ↓",       kind: "background" },
    { key: "--main-bg-to-positive-angle",     label: "Main bg — gradient ⇗ (+45°)", kind: "background" },
    { key: "--main-bg-to-negative-angle",     label: "Main bg — gradient ⇘ (-45°)", kind: "background" },
    { key: "--wait-color-big",                label: "Loading screen (large)",     kind: "background" },
    { key: "--wait-color-side",               label: "Loading screen (side)",      kind: "background" },
    { key: "--wait-side-chat-items",          label: "Loading chat items",         kind: "background" },
    { key: "--wait-side-chat-items-reverse",  label: "Loading chat items (rev.)",  kind: "background" },
    { key: "--wait-side-chat-items-to-top",   label: "Loading chat items (↑)",     kind: "background" },
  ];

  // Editor state. `null` means closed.
  let editor = null;

  // ── Editor validation helpers ────────────────────────────────────────────
  // CSS-property roundtrip: assign value to a throwaway element's style; the
  // browser silently rejects invalid values, leaving the property as "". This
  // catches malformed rgba(), unknown named colors, broken gradients, etc.
  function isValidCssColor(value) {
    if (typeof value !== "string" || !value.trim()) return false;
    const el = document.createElement("div");
    el.style.color = "";
    el.style.color = value;
    return el.style.color !== "";
  }
  function isValidCssBackground(value) {
    if (typeof value !== "string" || !value.trim()) return false;
    const el = document.createElement("div");
    el.style.background = "";
    el.style.background = value;
    return el.style.background !== "";
  }
  function isValidVarValue(kind, value) {
    return kind === "color" ? isValidCssColor(value) : isValidCssBackground(value);
  }

  // Parse the user's current var text into a #rrggbb for the color picker.
  // If we can't, fall back to #000000 — the picker isn't authoritative anyway.
  function valueToHex(value) {
    if (typeof value !== "string") return "#000000";
    const trimmed = value.trim();
    if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
      return "#" + trimmed.slice(1).split("").map((c) => c + c).join("").toLowerCase();
    }
    if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
    const m = trimmed.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
    if (m) {
      const hx = (n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, "0");
      return "#" + hx(m[1]) + hx(m[2]) + hx(m[3]);
    }
    return "#000000";
  }

  // ── Editor open/close ────────────────────────────────────────────────────
  // opts = { mode: "create"|"edit", source: "theme_manager"|"duplicate_preset"|"duplicate_custom",
  //          editingId?: string, seedFrom?: Theme }
  function openEditor(opts) {
    const mode = opts.mode === "edit" ? "edit" : "create";
    const source = opts.source || "theme_manager";

    let seed = null;
    if (mode === "edit" && opts.editingId) {
      seed = customs.find((t) => t.id === opts.editingId) || null;
      if (!seed) {
        toast("Theme not found.", "error");
        return;
      }
    } else if (opts.seedFrom) {
      seed = opts.seedFrom;
    }

    const draftName = mode === "edit"
      ? (seed ? seed.name : "")
      : (seed && opts.source === "duplicate_preset")
        ? `${seed.name} (copy)`
        : (seed && opts.source === "duplicate_custom")
          ? `${seed.name} (copy)`
          : "";
    const draftVars = {};
    VAR_META.forEach(({ key }) => {
      draftVars[key] = seed && seed.vars && typeof seed.vars[key] === "string"
        ? seed.vars[key]
        : "";
    });

    editor = {
      mode,
      source,
      editingId: mode === "edit" ? (seed ? seed.id : null) : null,
      originalName: mode === "edit" && seed ? seed.name : null,
      draft: { name: draftName, vars: draftVars },
      dirty: false,
    };

    // Title + analytics
    document.getElementById("editor-title").textContent =
      mode === "edit" ? `Edit Theme` : "Create Theme";
    try {
      if (window.track) {
        window.track("theme_creator_opened", {
          mode,
          source,
          theme_id: editor.editingId, // null on create
        });
      }
    } catch (_) { /* ignore */ }

    renderEditor();

    const backdrop = document.getElementById("editor-backdrop");
    backdrop.classList.add("visible");
    // Focus the name field for immediate typing.
    setTimeout(() => {
      const nameInput = document.getElementById("editor-name");
      if (nameInput) nameInput.focus();
    }, 0);
  }

  function closeEditor(opts) {
    if (!editor) return;
    const wasDirty = editor.dirty;
    const mode = editor.mode;
    const skipEvent = opts && opts.skipEvent;
    editor = null;
    document.getElementById("editor-backdrop").classList.remove("visible");
    if (!skipEvent) {
      try {
        if (window.track) {
          window.track("theme_creator_closed", {
            mode,
            had_unsaved_changes: !!wasDirty,
          });
        }
      } catch (_) { /* ignore */ }
    }
  }

  // ── Editor rendering ─────────────────────────────────────────────────────
  function renderEditor() {
    if (!editor) return;

    // Name input
    const nameInput = document.getElementById("editor-name");
    const counter = document.getElementById("editor-name-counter");
    nameInput.value = editor.draft.name;
    counter.textContent = `${editor.draft.name.length} / 40`;
    document.getElementById("editor-name-error").textContent = "";
    nameInput.classList.remove("error");
    document.getElementById("editor-footer-status").textContent = "";

    // Var fields — build once. Subsequent renderEditor() calls (e.g. from
    // openEditor seeded with new values) replace the contents.
    const colorWrap    = document.getElementById("editor-color-fields");
    const gradientWrap = document.getElementById("editor-gradient-fields");
    colorWrap.innerHTML = "";
    gradientWrap.innerHTML = "";

    VAR_META.forEach((meta) => {
      const row = buildVarRow(meta);
      (meta.kind === "color" ? colorWrap : gradientWrap).appendChild(row);
    });
  }

  function buildVarRow(meta) {
    const row = document.createElement("div");
    row.className = "var-row";
    row.dataset.varKey = meta.key;

    const label = document.createElement("label");
    label.htmlFor = `editor-var-${meta.key}`;
    label.innerHTML = "";
    const labelText = document.createElement("span");
    labelText.textContent = meta.label;
    const labelCode = document.createElement("code");
    labelCode.textContent = meta.key;
    label.appendChild(labelText);
    label.appendChild(labelCode);

    // Color shortcut (only for `kind === "color"`).
    let colorPicker;
    if (meta.kind === "color") {
      colorPicker = document.createElement("input");
      colorPicker.type = "color";
      colorPicker.value = valueToHex(editor.draft.vars[meta.key]);
      colorPicker.title = "Pick a color (resets alpha)";
    } else {
      colorPicker = document.createElement("span");
      colorPicker.className = "color-placeholder";
    }

    const text = document.createElement("input");
    text.type = "text";
    text.id = `editor-var-${meta.key}`;
    text.value = editor.draft.vars[meta.key];
    text.placeholder = meta.kind === "color"
      ? "rgba(0, 0, 0, 1)"
      : "linear-gradient(to bottom, ...)";
    text.spellcheck = false;
    text.autocomplete = "off";

    const swatch = document.createElement("div");
    swatch.className = "swatch-cell";
    swatch.style.background = editor.draft.vars[meta.key] || "transparent";

    const err = document.createElement("div");
    err.className = "field-error-inline";

    const updateSwatch = (value) => {
      swatch.style.background = "";
      swatch.style.background = value || "transparent";
    };
    const clearError = () => {
      err.textContent = "";
      text.classList.remove("error");
    };

    text.addEventListener("input", () => {
      editor.draft.vars[meta.key] = text.value;
      editor.dirty = true;
      updateSwatch(text.value);
      clearError();
    });
    if (meta.kind === "color") {
      colorPicker.addEventListener("input", () => {
        const hex = colorPicker.value;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const v = `rgb(${r}, ${g}, ${b})`;
        text.value = v;
        editor.draft.vars[meta.key] = v;
        editor.dirty = true;
        updateSwatch(v);
        clearError();
      });
    }

    row.appendChild(label);
    row.appendChild(colorPicker);
    row.appendChild(text);
    row.appendChild(swatch);
    row.appendChild(err);
    return row;
  }

  // ── Editor save ──────────────────────────────────────────────────────────
  function trackSaveFailed(reason) {
    try {
      if (window.track && editor) {
        window.track("custom_theme_save_failed", {
          reason,
          mode: editor.mode,
        });
      }
    } catch (_) { /* ignore */ }
  }

  function findDuplicateByName(name, excludeId) {
    const norm = name.trim().toLowerCase();
    return customs.find(
      (t) => t.id !== excludeId && (t.name || "").trim().toLowerCase() === norm
    ) || null;
  }

  async function saveDraft() {
    if (!editor) return;
    const nameInput = document.getElementById("editor-name");
    const nameErr = document.getElementById("editor-name-error");
    const footerStatus = document.getElementById("editor-footer-status");

    nameErr.textContent = "";
    nameInput.classList.remove("error");
    footerStatus.textContent = "";

    const rawName = editor.draft.name || "";
    const name = rawName.trim();

    if (!name) {
      nameInput.classList.add("error");
      nameErr.textContent = "Name is required.";
      trackSaveFailed("empty_name");
      return;
    }
    if (name.length > 40) {
      // The input has maxlength=40, but defend in depth (paste, programmatic).
      nameInput.classList.add("error");
      nameErr.textContent = "Name must be 40 characters or fewer.";
      trackSaveFailed("name_too_long");
      return;
    }

    // Per-field color validation. Collect all bad fields so the user can fix
    // them in one pass rather than one-at-a-time.
    let badFieldCount = 0;
    let firstBadField = null;
    document.querySelectorAll(".var-row").forEach((row) => {
      const key = row.dataset.varKey;
      const meta = VAR_META.find((m) => m.key === key);
      if (!meta) return;
      const value = editor.draft.vars[key];
      const inlineErr = row.querySelector(".field-error-inline");
      const textInput = row.querySelector('input[type="text"]');
      inlineErr.textContent = "";
      textInput.classList.remove("error");
      if (!isValidVarValue(meta.kind, value)) {
        textInput.classList.add("error");
        inlineErr.textContent = meta.kind === "color"
          ? "Not a valid CSS color."
          : "Not a valid CSS background value.";
        badFieldCount++;
        if (!firstBadField) firstBadField = textInput;
      }
    });
    if (badFieldCount > 0) {
      footerStatus.textContent = `Fix ${badFieldCount} invalid value${badFieldCount === 1 ? "" : "s"} above.`;
      trackSaveFailed("invalid_color");
      if (firstBadField) firstBadField.focus();
      return;
    }

    // Duplicate-name check. In edit mode, ignore self (the theme being edited).
    const dup = findDuplicateByName(name, editor.editingId);
    let overwrote = false;
    let targetId = editor.editingId;

    if (dup) {
      // Spec: prompt to overwrite or rename. We use confirm() — OK = overwrite,
      // Cancel = rename (stay in editor; treat as save_failed).
      const ok = confirm(
        `A theme named "${dup.name}" already exists.\n\n` +
        `OK to overwrite it, or Cancel to choose a different name.`
      );
      if (!ok) {
        nameInput.classList.add("error");
        nameErr.textContent = "Another theme already uses this name.";
        trackSaveFailed("duplicate_name");
        nameInput.focus();
        return;
      }
      overwrote = true;
      // Overwrite collapses onto the existing theme's id so themes:active
      // references and any external references stay stable.
      targetId = dup.id;
    }

    // Build the theme object. If editing, preserve fields we don't expose
    // (author etc.); if creating, fresh.
    let base = null;
    if (editor.mode === "edit" && editor.editingId) {
      base = customs.find((t) => t.id === editor.editingId) || null;
    } else if (overwrote) {
      base = dup;
    }
    const themeToSave = {
      id: targetId || undefined, // let normalizeForStorage assign on create
      name,
      author: base && base.author ? base.author : "",
      source: "custom",
      vars: { ...editor.draft.vars },
    };

    let saved;
    try {
      saved = await addOrReplaceTheme(themeToSave);
    } catch (e) {
      // chrome.storage.local.set rejects with a QuotaExceededError-ish error.
      // We don't trust the error type — match by name in the message too.
      const msg = (e && (e.message || String(e))) || "";
      const isQuota = /quota|QUOTA|exceed/i.test(msg);
      footerStatus.textContent = isQuota
        ? "Storage is full. Delete some themes and try again."
        : "Save failed. Please try again.";
      trackSaveFailed(isQuota ? "storage_quota" : "other");
      return;
    }

    // Success path: emit save event, then close (no creator_closed event —
    // a successful save isn't a "closed without saving").
    try {
      if (window.track) {
        window.track("custom_theme_saved", {
          mode: editor.mode,
          theme_id: globalThis.WA_SAFE_THEME_ID_FOR_ANALYTICS(saved),
          name_length: name.length,
          source: editor.source,
          overwrote_existing: overwrote,
        });
      }
    } catch (_) { /* ignore */ }

    toast(
      editor.mode === "edit" ? "Theme updated." : "Theme created.",
      "success"
    );
    closeEditor({ skipEvent: true });
    renderAll();
  }

  // ── Bootstrap ────────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", async () => {
    await loadAll();
    renderAll();

    // File drop zone
    const dropZone = document.getElementById("drop-zone");
    const fileInput = document.getElementById("file-input");

    dropZone.addEventListener("click", () => fileInput.click());
    dropZone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
    });
    ["dragenter", "dragover"].forEach((ev) =>
      dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add("dragover"); })
    );
    ["dragleave", "drop"].forEach((ev) =>
      dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove("dragover"); })
    );
    dropZone.addEventListener("drop", (e) => {
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length) importFromFiles(dt.files);
    });
    fileInput.addEventListener("change", (e) => importFromFiles(e.target.files));

    // URL import
    const urlInput = document.getElementById("url-input");
    const urlBtn = document.getElementById("url-add-btn");
    const triggerUrl = () => {
      const url = (urlInput.value || "").trim();
      if (!url) { setStatus("url-status", "Enter a URL first.", "error"); return; }
      importFromUrl(url);
    };
    urlBtn.addEventListener("click", triggerUrl);
    urlInput.addEventListener("keydown", (e) => { if (e.key === "Enter") triggerUrl(); });

    // Export all
    const exportAllBtn = document.getElementById("export-all-btn");
    if (exportAllBtn) exportAllBtn.addEventListener("click", exportAll);

    // ── Editor wiring ───────────────────────────────────────────────────
    const createBtn = document.getElementById("create-theme-btn");
    if (createBtn) {
      createBtn.addEventListener("click", () => {
        openEditor({ mode: "create", source: "theme_manager" });
      });
    }

    const backdrop = document.getElementById("editor-backdrop");
    document.getElementById("editor-close").addEventListener("click", () => closeEditor());
    document.getElementById("editor-cancel").addEventListener("click", () => closeEditor());
    document.getElementById("editor-save").addEventListener("click", () => saveDraft());

    // Click outside the editor card closes it. Pointer events on inner
    // children bubble to the backdrop; we only react when the backdrop
    // itself is the click target.
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeEditor();
    });

    document.addEventListener("keydown", (e) => {
      if (!editor) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeEditor();
      }
    });

    // Name field — keep editor.draft in sync and update the counter live.
    const nameInput = document.getElementById("editor-name");
    const nameCounter = document.getElementById("editor-name-counter");
    nameInput.addEventListener("input", () => {
      if (!editor) return;
      editor.draft.name = nameInput.value;
      editor.dirty = true;
      nameCounter.textContent = `${nameInput.value.length} / 40`;
      // Clear stale name error as the user types.
      const nameErr = document.getElementById("editor-name-error");
      if (nameErr.textContent) {
        nameErr.textContent = "";
        nameInput.classList.remove("error");
      }
    });

    // Deep-link from popup: themes.html#create → auto-open the editor.
    // We strip the hash so a reload doesn't reopen unexpectedly.
    if (window.location.hash === "#create") {
      history.replaceState(null, "", window.location.pathname + window.location.search);
      openEditor({ mode: "create", source: "theme_manager" });
    }

    // Live updates from popup or another tab
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area !== "local") return;
      if (changes[ACTIVE_KEY] || changes[CUSTOM_KEY]) {
        await loadAll();
        renderAll();
      }
    });
  });
})();
