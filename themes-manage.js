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

  function genId(name) {
    const slug = String(name).toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    return `custom-${slug || "theme"}-${Date.now().toString(36)}`;
  }

  function normalizeForStorage(raw) {
    return {
      id: typeof raw.id === "string" && raw.id.startsWith("custom-")
        ? raw.id
        : genId(raw.name),
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
    return new Promise((resolve) => {
      chrome.storage.local.set({ [CUSTOM_KEY]: customs }, resolve);
    });
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

  async function importFromFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    let added = 0;
    let failed = 0;

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        failed++;
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
            setStatus("upload-status", `${file.name}: ${err}`, "error");
            continue;
          }
          await addOrReplaceTheme(item);
          added++;
        }
      } catch (e) {
        failed++;
        setStatus("upload-status", `${file.name}: ${e.message || "parse failed"}.`, "error");
      }
    }

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
    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = await res.json();
      const items = Array.isArray(parsed) ? parsed : [parsed];
      let added = 0;
      let failed = 0;
      for (const item of items) {
        const err = validateTheme(item);
        if (err) { failed++; continue; }
        await addOrReplaceTheme(item);
        added++;
      }
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

    if (theme.source === "custom") {
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
        if (!confirm(`Delete "${theme.name}"?`)) return;
        customs = customs.filter((t) => t.id !== theme.id);
        await saveCustoms();
        await clearActiveIfMatches(theme.id);
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
