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
    // `meta` is optional and additive — only used by the v2 editor for
    // lossless round-tripping. If present, must be a plain object so a
    // hostile import can't smuggle in arrays / functions / nulls that the
    // editor would treat as objects later.
    if (obj.meta !== undefined) {
      if (!obj.meta || typeof obj.meta !== "object" || Array.isArray(obj.meta)) {
        return "'meta' must be an object if present.";
      }
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
    const out = {
      id: typeof raw.id === "string" && raw.id.startsWith("custom-")
        ? raw.id
        : genId(),
      name: String(raw.name).trim().slice(0, 80),
      author: typeof raw.author === "string" ? raw.author.trim().slice(0, 80) : "",
      source: "custom",
      vars: raw.vars
    };
    // `meta` is the v2-editor sidecar (see Editor section). Strictly optional;
    // omit the key entirely when not present so legacy storage rows stay byte-
    // identical and so exports of legacy themes don't gain a stray "meta": null.
    if (raw.meta && typeof raw.meta === "object" && !Array.isArray(raw.meta)) {
      out.meta = raw.meta;
    }
    return out;
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

  // Build the JSON payload for a single theme export. We deliberately omit
  // `id` and `source` (they're recomputed on import) and conditionally
  // include `meta` so legacy themes round-trip identically.
  function buildExportPayload(theme) {
    const payload = {
      name: theme.name,
      author: theme.author || "",
      vars: theme.vars,
    };
    if (theme.meta && typeof theme.meta === "object") {
      payload.meta = theme.meta;
    }
    return payload;
  }

  function exportTheme(theme) {
    const safeName = (theme.name || theme.id).replace(/[^a-z0-9-_]+/gi, "_");
    downloadJson(`${safeName}.json`, buildExportPayload(theme));
    try {
      if (window.track) window.track("theme_exported", { mode: "single", count: 1 });
    } catch (_) { /* ignore */ }
  }

  function exportAll() {
    if (!customs.length) {
      toast("No custom themes to export.", "error");
      return;
    }
    downloadJson("custom-themes.json", customs.map(buildExportPayload));
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

  // ── Editor (v2) ──────────────────────────────────────────────────────────
  //
  // v1 exposed all 17 CSS variables as raw text fields, forcing users to
  // hand-write `linear-gradient(...)` strings for the nine background vars.
  // That doesn't work for non-developers.
  //
  // v2 splits the surface into:
  //
  //   • COLORS section — 8 vars, each rendered as
  //       (color picker, opacity slider, live swatch).
  //     Grouped under "Text", "Message bubbles", "Other" so 8 rows feel like
  //     three short lists. The raw `rgb(...)` text input is gone; the CSS
  //     variable name lives behind an "Advanced" disclosure.
  //
  //   • BACKGROUNDS section — 9 vars, each rendered as
  //       (color picker, opacity slider, solid toggle, reverse button,
  //        live swatch).
  //     Direction (`to top`, `45deg`, …) is *inferred from the var name* and
  //     never user-editable. Two "unified" toggles cascade edits across the
  //     four main-bg vars and the five wait vars respectively. No raw CSS
  //     anywhere in the UI.
  //
  // Storage extension (additive, opt-in): the editor persists its raw inputs
  // into `theme.meta.gradients` and `theme.meta.colorGroupings` so re-open
  // is lossless. The apply path (themes-content.js) still reads only `vars`.
  // Themes without `meta` (legacy customs, presets being duplicated, third-
  // party imports) open via a best-effort parse from `vars`.

  // ─── Var taxonomy ────────────────────────────────────────────────────────
  // Colors get sub-grouped for the UX. Sub-group order is preserved as the
  // render order in the editor.
  const COLOR_VAR_GROUPS = [
    {
      label: "Text",
      vars: [
        { key: "--hyperlink-text", label: "Hyperlink text" },
        { key: "--important-text", label: "Important text" },
        { key: "--writing-text",   label: "Compose-box text" },
        { key: "--read-by",        label: "Read-receipt accent" },
      ],
    },
    {
      label: "Message bubbles",
      vars: [
        { key: "--message-incoming", label: "Incoming bubble" },
        { key: "--message-outgoing", label: "Outgoing bubble" },
      ],
    },
    {
      label: "Other",
      vars: [
        { key: "--main-bg-constant",      label: "Main background (base)" },
        { key: "--scrollbar-track-color", label: "Scrollbar track" },
      ],
    },
  ];

  // Direction map for gradients. Cross-checked against preset values in
  // themes-presets.js — both `*-positive-angle` and `*-negative-angle` use
  // `45deg` (the Designer reference does the same), so don't infer
  // `-45deg` from the var name even though the name suggests it.
  const GRADIENT_VAR_META = {
    "--main-bg-to-top":               { label: "Main bg — up",                  direction: "to top",    group: "mainBg" },
    "--main-bg-to-bottom":            { label: "Main bg — down",                direction: "to bottom", group: "mainBg" },
    "--main-bg-to-positive-angle":    { label: "Main bg — diagonal",            direction: "45deg",     group: "mainBg" },
    "--main-bg-to-negative-angle":    { label: "Main bg — diagonal (alt.)",     direction: "45deg",     group: "mainBg" },
    "--wait-color-big":               { label: "Loading screen (large)",        direction: "45deg",     group: "wait" },
    "--wait-color-side":              { label: "Loading screen (side)",         direction: "45deg",     group: "wait" },
    "--wait-side-chat-items":         { label: "Loading chat items",            direction: "45deg",     group: "wait" },
    "--wait-side-chat-items-reverse": { label: "Loading chat items (alt.)",     direction: "45deg",     group: "wait" },
    "--wait-side-chat-items-to-top":  { label: "Loading chat items (up)",       direction: "to top",    group: "wait" },
  };

  const MAIN_BG_GRADIENT_VARS = Object.keys(GRADIENT_VAR_META)
    .filter((k) => GRADIENT_VAR_META[k].group === "mainBg");
  const WAIT_GRADIENT_VARS = Object.keys(GRADIENT_VAR_META)
    .filter((k) => GRADIENT_VAR_META[k].group === "wait");

  // All color vars (across sub-groups), flat. The `--main-bg-constant` here
  // is also cascaded by the mainBgUnified toggle (Designer behavior).
  const ALL_COLOR_VARS = COLOR_VAR_GROUPS.flatMap((g) => g.vars.map((v) => v.key));

  // Editor state. `null` means closed.
  let editor = null;

  // ─── Helpers: rgb(a) parsing / formatting ────────────────────────────────
  const RGB_RE_FIRST = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9]*\.?[0-9]+))?\s*\)/i;
  const RGB_RE_ALL   = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9]*\.?[0-9]+))?\s*\)/gi;

  function parseRgbTriplet(rgbLike) {
    const m = String(rgbLike).match(RGB_RE_FIRST);
    if (!m) return [0, 0, 0];
    return [m[1], m[2], m[3]].map((n) => Math.max(0, Math.min(255, Number(n))));
  }

  function formatAlpha(a) {
    const v = Math.max(0, Math.min(1, Number(a)));
    if (v === 0) return "0";
    if (v === 1) return "1";
    return v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  }

  function rgbaFor(rgb, opacity) {
    const [r, g, b] = parseRgbTriplet(rgb);
    return `rgba(${r}, ${g}, ${b}, ${formatAlpha(opacity)})`;
  }

  function rgbToHex(rgbLike) {
    const [r, g, b] = parseRgbTriplet(rgbLike);
    const hx = (n) => n.toString(16).padStart(2, "0");
    return "#" + hx(r) + hx(g) + hx(b);
  }

  function hexToRgb(hex) {
    return `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
  }

  // ─── Helpers: input → CSS string (for storage in `vars`) ─────────────────
  function renderColorVar({ color, opacity }) {
    return rgbaFor(color, opacity);
  }

  function renderGradientVar({ color, opacity, solid, reverse }, direction) {
    const opaque = rgbaFor(color, opacity);
    if (solid) return opaque;
    const [r, g, b] = parseRgbTriplet(color);
    const transparent = `rgba(${r}, ${g}, ${b}, 0)`;
    const stops = reverse
      ? `${transparent}, ${opaque}`
      : `${opaque}, ${transparent}`;
    return `linear-gradient(${direction}, ${stops})`;
  }

  // ─── Helpers: legacy CSS string → editor inputs (best-effort parse) ──────
  function parseColorToInputs(value) {
    if (typeof value !== "string" || !value.trim()) {
      return { color: "rgb(0, 0, 0)", opacity: 1, fallback: true };
    }
    const m = value.match(RGB_RE_FIRST);
    if (m) {
      return {
        color: `rgb(${m[1]}, ${m[2]}, ${m[3]})`,
        opacity: m[4] !== undefined
          ? Math.max(0, Math.min(1, parseFloat(m[4])))
          : 1,
        fallback: false,
      };
    }
    // Hex / named colors — punt to a sensible default; user can re-pick.
    return { color: "rgb(0, 0, 0)", opacity: 1, fallback: true };
  }

  function parseGradientToInputs(value) {
    if (typeof value !== "string" || !value.trim()) {
      return { color: "rgb(0, 0, 0)", opacity: 1, solid: false, reverse: false, fallback: true };
    }
    const trimmed = value.trim();
    if (!/linear-gradient/i.test(trimmed)) {
      // Solid color (no gradient).
      const c = parseColorToInputs(trimmed);
      return {
        color: c.color,
        opacity: c.opacity,
        solid: true,
        reverse: false,
        fallback: c.fallback,
      };
    }
    const stops = [...trimmed.matchAll(RGB_RE_ALL)];
    if (stops.length === 0) {
      return { color: "rgb(0, 0, 0)", opacity: 1, solid: false, reverse: false, fallback: true };
    }
    const firstAlpha  = stops[0][4] !== undefined ? parseFloat(stops[0][4]) : 1;
    const secondAlpha = stops.length > 1 && stops[1][4] !== undefined ? parseFloat(stops[1][4]) : 1;
    // If the first stop is more transparent than the second, the gradient is
    // fading-in rather than fading-out — that's our `reverse` state. The base
    // color comes from whichever stop carries the visible opacity.
    const reverse = firstAlpha < secondAlpha;
    const baseStop = reverse ? stops[1] : stops[0];
    return {
      color: `rgb(${baseStop[1]}, ${baseStop[2]}, ${baseStop[3]})`,
      opacity: baseStop[4] !== undefined ? Math.max(0, Math.min(1, parseFloat(baseStop[4]))) : 1,
      solid: false,
      reverse,
      fallback: false,
    };
  }

  // ─── Group-equality check (smart default for unified toggles) ────────────
  function gradientInputsEqual(a, b) {
    if (!a || !b) return false;
    return a.color === b.color
      && Math.abs(a.opacity - b.opacity) < 0.005
      && a.solid === b.solid
      && a.reverse === b.reverse;
  }

  function colorInputsEqual(a, b) {
    if (!a || !b) return false;
    return a.color === b.color && Math.abs(a.opacity - b.opacity) < 0.005;
  }

  // For mainBg unification we also care that the constant color matches the
  // gradient color (because the unified row drives both). We don't compare
  // opacities here — the constant slot has its own slider in the Other
  // sub-group, and we cascade only the *color* component on toggle.
  function isMainBgUnified(gradientInputs, colorInputs) {
    if (!MAIN_BG_GRADIENT_VARS.length) return false;
    const first = gradientInputs[MAIN_BG_GRADIENT_VARS[0]];
    if (!first) return false;
    const gradAllEqual = MAIN_BG_GRADIENT_VARS.every(
      (k) => gradientInputsEqual(gradientInputs[k], first)
    );
    if (!gradAllEqual) return false;
    const ck = colorInputs["--main-bg-constant"];
    return !!ck && ck.color === first.color;
  }

  function isWaitUnified(gradientInputs) {
    if (!WAIT_GRADIENT_VARS.length) return false;
    const first = gradientInputs[WAIT_GRADIENT_VARS[0]];
    return WAIT_GRADIENT_VARS.every(
      (k) => gradientInputsEqual(gradientInputs[k], first)
    );
  }

  // ─── Build the draft state from a seed theme (or empty defaults) ─────────
  // Preference order: theme.meta.gradients > parse(theme.vars) > defaults.
  function buildDraftFromSeed(seed) {
    const colors = {};
    const gradients = {};
    let anyFallback = false;

    ALL_COLOR_VARS.forEach((key) => {
      const fromMeta = seed && seed.meta && seed.meta.colors && seed.meta.colors[key];
      if (fromMeta && typeof fromMeta === "object") {
        colors[key] = {
          color: typeof fromMeta.color === "string" ? fromMeta.color : "rgb(0, 0, 0)",
          opacity: typeof fromMeta.opacity === "number" ? fromMeta.opacity : 1,
        };
        return;
      }
      const rawValue = seed && seed.vars && seed.vars[key];
      const parsed = parseColorToInputs(rawValue);
      colors[key] = { color: parsed.color, opacity: parsed.opacity };
      if (parsed.fallback && rawValue) anyFallback = true;
    });

    Object.keys(GRADIENT_VAR_META).forEach((key) => {
      const fromMeta = seed && seed.meta && seed.meta.gradients && seed.meta.gradients[key];
      if (fromMeta && typeof fromMeta === "object") {
        gradients[key] = {
          color:   typeof fromMeta.color === "string" ? fromMeta.color : "rgb(0, 0, 0)",
          opacity: typeof fromMeta.opacity === "number" ? fromMeta.opacity : 1,
          solid:   !!fromMeta.solid,
          reverse: !!fromMeta.reverse,
        };
        return;
      }
      const rawValue = seed && seed.vars && seed.vars[key];
      const parsed = parseGradientToInputs(rawValue);
      gradients[key] = {
        color:   parsed.color,
        opacity: parsed.opacity,
        solid:   parsed.solid,
        reverse: parsed.reverse,
      };
      if (parsed.fallback && rawValue) anyFallback = true;
    });

    // Unified toggles: prefer the explicit meta hint; otherwise smart-detect
    // from the current values. On a fresh create with no seed, default to on.
    const groupingsMeta = seed && seed.meta && seed.meta.colorGroupings;
    const mainBgUnified = groupingsMeta && typeof groupingsMeta.mainBgUnified === "boolean"
      ? groupingsMeta.mainBgUnified
      : (seed ? isMainBgUnified(gradients, colors) : true);
    const waitUnified = groupingsMeta && typeof groupingsMeta.waitUnified === "boolean"
      ? groupingsMeta.waitUnified
      : (seed ? isWaitUnified(gradients) : true);

    return {
      colors,
      gradients,
      groupings: { mainBgUnified, waitUnified },
      // Did we hit a parse fallback while reading legacy `vars`? The notice
      // only shows when there's a seed AND parsing dropped detail — fresh
      // creates with no seed don't trigger it.
      parseFallback: !!seed && !(seed.meta && seed.meta.gradients) && anyFallback,
    };
  }

  // ─── Open / close ────────────────────────────────────────────────────────
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
      : (seed && (opts.source === "duplicate_preset" || opts.source === "duplicate_custom"))
        ? `${seed.name} (copy)`
        : "";

    const built = buildDraftFromSeed(seed);

    editor = {
      mode,
      source,
      editingId: mode === "edit" && seed ? seed.id : null,
      originalName: mode === "edit" && seed ? seed.name : null,
      draft: {
        name: draftName,
        colors: built.colors,
        gradients: built.gradients,
        groupings: built.groupings,
      },
      showAdvanced: false,
      dirty: false,
      parseFallbackShown: built.parseFallback,
    };

    document.getElementById("editor-title").textContent =
      mode === "edit" ? "Edit Theme" : "Create Theme";
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

    document.getElementById("editor-backdrop").classList.add("visible");
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

  // ─── Top-level render ────────────────────────────────────────────────────
  function renderEditor() {
    if (!editor) return;

    const nameInput = document.getElementById("editor-name");
    const counter = document.getElementById("editor-name-counter");
    nameInput.value = editor.draft.name;
    counter.textContent = `${editor.draft.name.length} / 40`;
    document.getElementById("editor-name-error").textContent = "";
    nameInput.classList.remove("error");
    document.getElementById("editor-footer-status").textContent = "";

    // Legacy-fallback notice. We render it once per open; if the user
    // dismisses (via the small × button), parseFallbackShown stays false.
    const notice = document.getElementById("editor-notice");
    if (editor.parseFallbackShown) {
      notice.style.display = "";
      notice.innerHTML = "";
      const msg = document.createElement("span");
      msg.textContent = "This theme was created in an older version; some gradient details may have been reset.";
      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.className = "notice-dismiss";
      dismiss.setAttribute("aria-label", "Dismiss notice");
      dismiss.textContent = "✕";
      dismiss.addEventListener("click", () => {
        editor.parseFallbackShown = false;
        notice.style.display = "none";
      });
      notice.appendChild(msg);
      notice.appendChild(dismiss);
    } else {
      notice.style.display = "none";
      notice.textContent = "";
    }

    // Advanced (var-name) toggle. Default off.
    const advToggle = document.getElementById("editor-advanced-toggle");
    advToggle.checked = !!editor.showAdvanced;
    document.body.classList.toggle("editor-show-advanced", !!editor.showAdvanced);

    renderColorSection();
    renderGradientSection();
  }

  // ─── Colors section ──────────────────────────────────────────────────────
  function renderColorSection() {
    const root = document.getElementById("editor-color-section");
    root.innerHTML = "";
    COLOR_VAR_GROUPS.forEach((group) => {
      const subhead = document.createElement("div");
      subhead.className = "var-subgroup-label";
      subhead.textContent = group.label;
      root.appendChild(subhead);
      group.vars.forEach((meta) => {
        root.appendChild(buildColorRow(meta));
      });
    });
  }

  function buildColorRow(meta) {
    const row = document.createElement("div");
    row.className = "color-row";
    row.dataset.varKey = meta.key;

    const label = document.createElement("div");
    label.className = "var-label";
    const labelText = document.createElement("span");
    labelText.className = "var-label-text";
    labelText.textContent = meta.label;
    const labelCode = document.createElement("code");
    labelCode.className = "var-label-code";
    labelCode.textContent = meta.key;
    label.appendChild(labelText);
    label.appendChild(labelCode);

    const state = editor.draft.colors[meta.key];

    const colorPicker = document.createElement("input");
    colorPicker.type = "color";
    colorPicker.value = rgbToHex(state.color);
    colorPicker.title = "Pick a color";

    const opacityWrap = document.createElement("div");
    opacityWrap.className = "opacity-wrap";
    const opacity = document.createElement("input");
    opacity.type = "range";
    opacity.min = "0"; opacity.max = "100"; opacity.step = "1";
    opacity.value = String(Math.round(state.opacity * 100));
    opacity.title = "Opacity";
    const opacityValue = document.createElement("span");
    opacityValue.className = "opacity-value";
    opacityValue.textContent = `${opacity.value}%`;
    opacityWrap.appendChild(opacity);
    opacityWrap.appendChild(opacityValue);

    const swatch = document.createElement("div");
    swatch.className = "swatch-cell";
    swatch.style.background = renderColorVar(state);

    const update = () => {
      const css = renderColorVar(state);
      swatch.style.background = "";
      swatch.style.background = css;
      opacityValue.textContent = `${Math.round(state.opacity * 100)}%`;
      editor.dirty = true;
      // `--main-bg-constant` lives in this section but is cascaded by the
      // mainBg unified toggle when on. Forward the *color* (not opacity)
      // to all mainBg gradients in that case — matches Designer's
      // setMainBgVariables behavior.
      if (meta.key === "--main-bg-constant" && editor.draft.groupings.mainBgUnified) {
        MAIN_BG_GRADIENT_VARS.forEach((k) => {
          editor.draft.gradients[k].color = state.color;
        });
        rerenderMainBgRows();
      }
    };

    colorPicker.addEventListener("input", () => {
      state.color = hexToRgb(colorPicker.value);
      update();
    });
    opacity.addEventListener("input", () => {
      state.opacity = Number(opacity.value) / 100;
      update();
    });

    row.appendChild(label);
    row.appendChild(colorPicker);
    row.appendChild(opacityWrap);
    row.appendChild(swatch);
    return row;
  }

  // ─── Gradient section ────────────────────────────────────────────────────
  function renderGradientSection() {
    const root = document.getElementById("editor-gradient-section");
    root.innerHTML = "";

    // Unified toggles row.
    const toggles = document.createElement("div");
    toggles.className = "unified-toggles";
    toggles.appendChild(buildUnifiedToggle({
      id: "unified-main-bg",
      label: "Use the same color for all main backgrounds",
      get: () => editor.draft.groupings.mainBgUnified,
      set: (on) => {
        editor.draft.groupings.mainBgUnified = on;
        if (on) cascadeMainBg(editor.draft.gradients[MAIN_BG_GRADIENT_VARS[0]]);
        editor.dirty = true;
        renderGradientSection();
      },
    }));
    toggles.appendChild(buildUnifiedToggle({
      id: "unified-wait",
      label: "Use the same color for all loading states",
      get: () => editor.draft.groupings.waitUnified,
      set: (on) => {
        editor.draft.groupings.waitUnified = on;
        if (on) cascadeWait(editor.draft.gradients[WAIT_GRADIENT_VARS[0]]);
        editor.dirty = true;
        renderGradientSection();
      },
    }));
    root.appendChild(toggles);

    // Render each group.
    appendGradientGroup(root, {
      label: "Main background",
      vars: MAIN_BG_GRADIENT_VARS,
      unified: editor.draft.groupings.mainBgUnified,
      cascade: cascadeMainBg,
      dataAttr: "mainbg",
    });
    appendGradientGroup(root, {
      label: "Loading states",
      vars: WAIT_GRADIENT_VARS,
      unified: editor.draft.groupings.waitUnified,
      cascade: cascadeWait,
      dataAttr: "wait",
    });
  }

  function buildUnifiedToggle({ id, label, get, set }) {
    const wrap = document.createElement("label");
    wrap.className = "toggle-row";
    wrap.htmlFor = id;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = id;
    input.checked = !!get();
    input.addEventListener("change", () => {
      const wasOn = !!get();
      const isOn = input.checked;
      set(isOn);
      try {
        // Treat toggling off as a "reset" of that group; we only fire the
        // event on the on→off transition to avoid noise.
        if (window.track && wasOn && !isOn) {
          window.track("theme_editor_reset_to_default", { field: "unified_toggle" });
        }
      } catch (_) { /* ignore */ }
    });
    const text = document.createElement("span");
    text.textContent = label;
    wrap.appendChild(input);
    wrap.appendChild(text);
    return wrap;
  }

  function appendGradientGroup(root, { label, vars, unified, cascade, dataAttr }) {
    const groupHead = document.createElement("div");
    groupHead.className = "var-subgroup-label";
    groupHead.textContent = label + (unified ? " (one color for all)" : "");
    root.appendChild(groupHead);

    if (unified) {
      // Single row that cascades to all member vars.
      const firstKey = vars[0];
      const state = editor.draft.gradients[firstKey];
      // We label it generically — the user is editing the group, not a var.
      const row = buildGradientRow({
        key: firstKey,
        labelOverride: label,
        state,
        onChange: () => cascade(state),
        groupDataAttr: dataAttr,
      });
      root.appendChild(row);
    } else {
      vars.forEach((key) => {
        const state = editor.draft.gradients[key];
        const meta = GRADIENT_VAR_META[key];
        const row = buildGradientRow({
          key,
          labelOverride: meta.label,
          state,
          onChange: () => {},
          groupDataAttr: dataAttr,
        });
        root.appendChild(row);
      });
    }
  }

  function buildGradientRow({ key, labelOverride, state, onChange, groupDataAttr }) {
    const row = document.createElement("div");
    row.className = "gradient-row";
    row.dataset.varKey = key;
    row.dataset.group = groupDataAttr;

    const label = document.createElement("div");
    label.className = "var-label";
    const labelText = document.createElement("span");
    labelText.className = "var-label-text";
    labelText.textContent = labelOverride;
    const labelCode = document.createElement("code");
    labelCode.className = "var-label-code";
    labelCode.textContent = key;
    label.appendChild(labelText);
    label.appendChild(labelCode);

    const colorPicker = document.createElement("input");
    colorPicker.type = "color";
    colorPicker.value = rgbToHex(state.color);
    colorPicker.title = "Base color";

    const opacityWrap = document.createElement("div");
    opacityWrap.className = "opacity-wrap";
    const opacity = document.createElement("input");
    opacity.type = "range";
    opacity.min = "0"; opacity.max = "100"; opacity.step = "1";
    opacity.value = String(Math.round(state.opacity * 100));
    opacity.title = "Opacity at the visible end";
    const opacityValue = document.createElement("span");
    opacityValue.className = "opacity-value";
    opacityValue.textContent = `${opacity.value}%`;
    opacityWrap.appendChild(opacity);
    opacityWrap.appendChild(opacityValue);

    const solidWrap = document.createElement("label");
    solidWrap.className = "toggle-row inline";
    const solid = document.createElement("input");
    solid.type = "checkbox";
    solid.checked = !!state.solid;
    const solidText = document.createElement("span");
    solidText.textContent = "Solid";
    solidWrap.appendChild(solid);
    solidWrap.appendChild(solidText);

    const reverse = document.createElement("button");
    reverse.type = "button";
    reverse.className = "reverse-btn";
    reverse.textContent = state.reverse ? "Reversed ⇆" : "Reverse";
    if (state.solid) reverse.disabled = true;

    const swatch = document.createElement("div");
    swatch.className = "swatch-cell";
    const meta = GRADIENT_VAR_META[key];
    swatch.style.background = renderGradientVar(state, meta.direction);

    const update = () => {
      swatch.style.background = "";
      swatch.style.background = renderGradientVar(state, meta.direction);
      opacityValue.textContent = `${Math.round(state.opacity * 100)}%`;
      reverse.textContent = state.reverse ? "Reversed ⇆" : "Reverse";
      reverse.disabled = !!state.solid;
      editor.dirty = true;
      onChange();
      // Cascading edits re-render the whole section so the other rows in
      // the group reflect the new state; we don't need to manually touch
      // their DOM here.
    };

    colorPicker.addEventListener("input", () => {
      state.color = hexToRgb(colorPicker.value);
      update();
    });
    opacity.addEventListener("input", () => {
      state.opacity = Number(opacity.value) / 100;
      update();
    });
    solid.addEventListener("change", () => {
      state.solid = solid.checked;
      // Reverse has no meaning when solid; clear it to keep state tidy
      // (matters for the meta sidecar round-trip).
      if (state.solid) state.reverse = false;
      update();
    });
    reverse.addEventListener("click", () => {
      if (state.solid) return;
      state.reverse = !state.reverse;
      update();
    });

    row.appendChild(label);
    row.appendChild(colorPicker);
    row.appendChild(opacityWrap);
    row.appendChild(solidWrap);
    row.appendChild(reverse);
    row.appendChild(swatch);
    return row;
  }

  // Cascade helpers. We mutate the per-var state objects in place so the
  // "without losing their values" guarantee holds when the user toggles
  // unified off — each row reads back from the same state slot.
  function cascadeMainBg(source) {
    if (!source) return;
    const snap = {
      color: source.color,
      opacity: source.opacity,
      solid: source.solid,
      reverse: source.reverse,
    };
    MAIN_BG_GRADIENT_VARS.forEach((k) => {
      const s = editor.draft.gradients[k];
      s.color = snap.color;
      s.opacity = snap.opacity;
      s.solid = snap.solid;
      s.reverse = snap.reverse;
    });
    // The constant slot's color follows the group; opacity is independent
    // (preset Monster shows constant at α=1 while bg-to-top gradients have
    // α<1; the user may want to keep that asymmetry).
    if (editor.draft.colors["--main-bg-constant"]) {
      editor.draft.colors["--main-bg-constant"].color = snap.color;
    }
  }

  function cascadeWait(source) {
    if (!source) return;
    const snap = {
      color: source.color,
      opacity: source.opacity,
      solid: source.solid,
      reverse: source.reverse,
    };
    WAIT_GRADIENT_VARS.forEach((k) => {
      const s = editor.draft.gradients[k];
      s.color = snap.color;
      s.opacity = snap.opacity;
      s.solid = snap.solid;
      s.reverse = snap.reverse;
    });
  }

  function rerenderMainBgRows() {
    // Called when --main-bg-constant changes color and mainBgUnified is on.
    // Cheapest correct thing to do is re-render the gradient section.
    renderGradientSection();
  }

  // ─── Save ────────────────────────────────────────────────────────────────
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

  // Render the draft into the final theme {vars, meta} shape.
  function renderDraftToTheme() {
    const vars = {};
    ALL_COLOR_VARS.forEach((k) => {
      vars[k] = renderColorVar(editor.draft.colors[k]);
    });
    Object.keys(GRADIENT_VAR_META).forEach((k) => {
      vars[k] = renderGradientVar(editor.draft.gradients[k], GRADIENT_VAR_META[k].direction);
    });

    // meta sidecar — only the fields the editor needs to round-trip. We
    // deliberately do not record the rendered CSS in meta (vars carries
    // that). Saving the slim shape keeps storage compact.
    const metaColors = {};
    ALL_COLOR_VARS.forEach((k) => {
      const s = editor.draft.colors[k];
      metaColors[k] = { color: s.color, opacity: s.opacity };
    });
    const metaGradients = {};
    Object.keys(GRADIENT_VAR_META).forEach((k) => {
      const s = editor.draft.gradients[k];
      metaGradients[k] = {
        color: s.color,
        opacity: s.opacity,
        solid: s.solid,
        reverse: s.reverse,
      };
    });
    const meta = {
      editorVersion: "v2",
      colors: metaColors,
      gradients: metaGradients,
      colorGroupings: {
        mainBgUnified: editor.draft.groupings.mainBgUnified,
        waitUnified:   editor.draft.groupings.waitUnified,
      },
    };
    return { vars, meta };
  }

  async function saveDraft() {
    if (!editor) return;
    const nameInput = document.getElementById("editor-name");
    const nameErr = document.getElementById("editor-name-error");
    const footerStatus = document.getElementById("editor-footer-status");

    nameErr.textContent = "";
    nameInput.classList.remove("error");
    footerStatus.textContent = "";

    const name = (editor.draft.name || "").trim();
    if (!name) {
      nameInput.classList.add("error");
      nameErr.textContent = "Name is required.";
      trackSaveFailed("empty_name");
      return;
    }
    if (name.length > 40) {
      nameInput.classList.add("error");
      nameErr.textContent = "Name must be 40 characters or fewer.";
      trackSaveFailed("name_too_long");
      return;
    }

    // v2 doesn't have free-form text inputs, so `invalid_color` should be
    // unreachable in the happy path. Keep the rendered values in `vars`
    // syntactically anchored by the renderer; no per-field validation needed.

    const dup = findDuplicateByName(name, editor.editingId);
    let overwrote = false;
    let targetId = editor.editingId;
    if (dup) {
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
      targetId = dup.id;
    }

    const { vars, meta } = renderDraftToTheme();

    let base = null;
    if (editor.mode === "edit" && editor.editingId) {
      base = customs.find((t) => t.id === editor.editingId) || null;
    } else if (overwrote) {
      base = dup;
    }

    const themeToSave = {
      id: targetId || undefined,
      name,
      author: base && base.author ? base.author : "",
      source: "custom",
      vars,
      meta,
    };

    let saved;
    try {
      saved = await addOrReplaceTheme(themeToSave);
    } catch (e) {
      const msg = (e && (e.message || String(e))) || "";
      const isQuota = /quota|QUOTA|exceed/i.test(msg);
      footerStatus.textContent = isQuota
        ? "Storage is full. Delete some themes and try again."
        : "Save failed. Please try again.";
      trackSaveFailed(isQuota ? "storage_quota" : "other");
      return;
    }

    // Compute analytics summary properties. None of these include any user
    // text or color values — only counts and booleans.
    const solidCount = Object.keys(GRADIENT_VAR_META).reduce(
      (n, k) => n + (editor.draft.gradients[k].solid ? 1 : 0),
      0
    );

    try {
      if (window.track) {
        window.track("custom_theme_saved", {
          mode: editor.mode,
          theme_id: globalThis.WA_SAFE_THEME_ID_FOR_ANALYTICS(saved),
          name_length: name.length,
          source: editor.source,
          overwrote_existing: overwrote,
          gradients_used_unified_main_bg: !!editor.draft.groupings.mainBgUnified,
          gradients_used_unified_wait:    !!editor.draft.groupings.waitUnified,
          gradients_used_solid_count:     solidCount,
          editor_version: "v2",
        });
      }
    } catch (_) { /* ignore */ }

    toast(editor.mode === "edit" ? "Theme updated." : "Theme created.", "success");
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
      const nameErr = document.getElementById("editor-name-error");
      if (nameErr.textContent) {
        nameErr.textContent = "";
        nameInput.classList.remove("error");
      }
    });

    // Advanced (CSS-variable names) disclosure. Off by default; flips a
    // body class that CSS uses to reveal the .var-label-code elements.
    const advToggle = document.getElementById("editor-advanced-toggle");
    if (advToggle) {
      advToggle.addEventListener("change", () => {
        if (editor) editor.showAdvanced = advToggle.checked;
        document.body.classList.toggle("editor-show-advanced", advToggle.checked);
      });
    }

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
