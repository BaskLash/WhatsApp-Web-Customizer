// manage-images.js — dedicated image/theme management page.
// Reuses the existing storage schema from imageSelection.js:
//   - `uploadedImages`: [{ filename, dataUrl, source?, originalUrl? }]
//     `source` is "upload" (default, backwards compatible) or "url".
//   - `disabledImages`: [src]  — logical-deletion flag for predefined
//     images (we never remove bundled assets from disk).
// Theme slots (welcome, sidenav, chatview, navside) are untouched and
// still hold either an `images/...` path or a `data:` URL.

const ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB per image
const THEME_SLOTS = ["welcome", "sidenav", "chatview", "navside"];

const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const uploadStatus = document.getElementById("upload-status");
const urlInput = document.getElementById("url-input");
const urlAddBtn = document.getElementById("url-add-btn");
const urlStatus = document.getElementById("url-status");
const gallery = document.getElementById("gallery");
const libraryCount = document.getElementById("library-count");
const toastEl = document.getElementById("toast");
const filterButtons = document.querySelectorAll(".filter-btn");

let predefinedData = null; // parsed images.json
let uploadedImages = []; // user-uploaded / URL-added
let disabledImages = new Set(); // src strings flagged as hidden
let currentFilter = "all";

// ── Helpers ─────────────────────────────────────────────────────────────────

function getImageURL(src) {
  if (!src) return "";
  return src.startsWith("images/") ? chrome.runtime.getURL(src) : src;
}

function setStatus(node, message, kind = "info") {
  node.textContent = message;
  node.className = `status-line ${kind}`;
}

function showToast(message, kind = "success") {
  toastEl.textContent = message;
  toastEl.className = `toast ${kind} visible`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toastEl.className = `toast ${kind}`;
  }, 2200);
}

function extFromMime(mime) {
  const map = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
  return map[mime] || "img";
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

function loadState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["uploadedImages", "disabledImages"], (result) => {
      uploadedImages = Array.isArray(result.uploadedImages)
        ? result.uploadedImages
        : [];
      disabledImages = new Set(
        Array.isArray(result.disabledImages) ? result.disabledImages : [],
      );
      resolve();
    });
  });
}

function saveUploaded() {
  return new Promise((resolve) =>
    chrome.storage.local.set({ uploadedImages }, resolve),
  );
}

function saveDisabled() {
  return new Promise((resolve) =>
    chrome.storage.local.set(
      { disabledImages: [...disabledImages] },
      resolve,
    ),
  );
}

// If the user deleted/disabled the image that was currently assigned to a
// theme slot, clear that slot so the content script falls back cleanly.
function clearSlotsUsing(src) {
  return new Promise((resolve) => {
    chrome.storage.local.get(THEME_SLOTS, (result) => {
      const toRemove = THEME_SLOTS.filter((slot) => result[slot] === src);
      if (toRemove.length === 0) return resolve();
      chrome.storage.local.remove(toRemove, resolve);
    });
  });
}

// ── Image entry model ───────────────────────────────────────────────────────
//   { src, kind: "predefined"|"upload"|"url", category, filename, originalUrl? }
// `src` is what gets stored in theme slots and is the identity of the entry.

function buildEntries() {
  const entries = [];

  if (predefinedData) {
    for (const [category, group] of Object.entries(predefinedData)) {
      if (category === "uploaded") continue; // legacy key — ignore
      if (!Array.isArray(group.files)) continue;
      for (const path of group.files) {
        entries.push({
          src: path,
          kind: "predefined",
          category,
          filename: path,
        });
      }
    }
  }

  for (const item of uploadedImages) {
    const kind = item.source === "url" ? "url" : "upload";
    entries.push({
      src: item.dataUrl,
      kind,
      category: kind,
      filename: item.filename,
      originalUrl: item.originalUrl,
    });
  }

  return entries;
}

// ── Rendering ───────────────────────────────────────────────────────────────

function renderGallery() {
  const entries = buildEntries();
  const visible = entries.filter((e) => {
    const isDisabled = disabledImages.has(e.src);
    switch (currentFilter) {
      case "predefined":
        return e.kind === "predefined" && !isDisabled;
      case "upload":
        return e.kind === "upload" && !isDisabled;
      case "url":
        return e.kind === "url" && !isDisabled;
      case "disabled":
        return isDisabled;
      case "all":
      default:
        return !isDisabled;
    }
  });

  gallery.innerHTML = "";
  libraryCount.textContent = `${visible.length} of ${entries.length} image${entries.length === 1 ? "" : "s"}`;

  if (visible.length === 0) {
    const empty = document.createElement("div");
    empty.className = "gallery-empty";
    empty.textContent =
      currentFilter === "disabled"
        ? "No disabled images."
        : "No images in this view yet.";
    gallery.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const entry of visible) {
    fragment.appendChild(renderCard(entry));
  }
  gallery.appendChild(fragment);
}

function renderCard(entry) {
  const card = document.createElement("div");
  card.className = "img-card";
  if (disabledImages.has(entry.src)) card.classList.add("disabled");
  card.title = entry.filename;

  const img = document.createElement("img");
  img.loading = "lazy";
  img.alt = "";
  img.src = getImageURL(entry.src);
  card.appendChild(img);

  if (entry.kind !== "predefined") {
    const badge = document.createElement("span");
    badge.className = `img-badge ${entry.kind}`;
    badge.textContent = entry.kind === "url" ? "URL" : "Upload";
    card.appendChild(badge);
  }

  if (disabledImages.has(entry.src) && entry.kind === "predefined") {
    const restore = document.createElement("button");
    restore.className = "img-card-action restore";
    restore.textContent = "Restore";
    restore.title = "Restore this image";
    restore.addEventListener("click", () => restoreImage(entry));
    card.appendChild(restore);
  } else {
    const del = document.createElement("button");
    del.className = "img-card-action delete";
    del.textContent = "✕";
    del.title =
      entry.kind === "predefined"
        ? "Hide this predefined image"
        : "Delete this image";
    del.addEventListener("click", () => deleteImage(entry));
    card.appendChild(del);
  }

  return card;
}

// ── Actions ─────────────────────────────────────────────────────────────────

async function deleteImage(entry) {
  if (entry.kind === "predefined") {
    disabledImages.add(entry.src);
    await saveDisabled();
    await clearSlotsUsing(entry.src);
    showToast("Image hidden. Use the Disabled filter to restore it.");
  } else {
    const idx = uploadedImages.findIndex((i) => i.dataUrl === entry.src);
    if (idx === -1) return;
    uploadedImages.splice(idx, 1);
    // If it also happened to be in disabledImages, clean up.
    if (disabledImages.delete(entry.src)) await saveDisabled();
    await saveUploaded();
    await clearSlotsUsing(entry.src);
    showToast("Image deleted.");
  }
  renderGallery();
}

async function restoreImage(entry) {
  if (!disabledImages.delete(entry.src)) return;
  await saveDisabled();
  showToast("Image restored.");
  renderGallery();
}

async function addUploadedFromDataUrl(dataUrl, { mime, suggestedName, source, originalUrl }) {
  if (uploadedImages.some((i) => i.dataUrl === dataUrl)) {
    return { added: false, reason: "duplicate" };
  }
  const timestamp = Date.now() + Math.floor(Math.random() * 1000);
  const ext = extFromMime(mime);
  const folder = source === "url" ? "url" : "uploaded";
  const filename =
    suggestedName || `images/${folder}/${source || "uploaded"}_${timestamp}.${ext}`;
  const entry = { filename, dataUrl };
  if (source) entry.source = source;
  if (originalUrl) entry.originalUrl = originalUrl;
  uploadedImages.push(entry);
  await saveUploaded();
  return { added: true };
}

async function handleFiles(files) {
  if (!files || files.length === 0) return;
  let added = 0;
  let skipped = 0;
  let errors = 0;

  setStatus(uploadStatus, `Processing ${files.length} file(s)…`, "info");

  for (const file of files) {
    if (!ACCEPTED_MIME.includes(file.type)) {
      errors++;
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      errors++;
      continue;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      const result = await addUploadedFromDataUrl(dataUrl, {
        mime: file.type,
        source: "upload",
      });
      if (result.added) added++;
      else skipped++;
    } catch (_err) {
      errors++;
    }
  }

  const parts = [];
  if (added) parts.push(`${added} added`);
  if (skipped) parts.push(`${skipped} duplicate`);
  if (errors) parts.push(`${errors} rejected`);
  setStatus(
    uploadStatus,
    parts.length ? parts.join(" · ") : "No images added.",
    errors && !added ? "error" : added ? "success" : "info",
  );
  if (added) {
    showToast(`${added} image${added === 1 ? "" : "s"} added.`);
    renderGallery();
  }
  fileInput.value = "";
}

async function handleUrlAdd() {
  const rawUrl = urlInput.value.trim();
  if (!rawUrl) {
    setStatus(urlStatus, "Please enter an image URL.", "error");
    return;
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_err) {
    setStatus(urlStatus, "That doesn't look like a valid URL.", "error");
    return;
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    setStatus(urlStatus, "Only http(s) URLs are supported.", "error");
    return;
  }

  urlAddBtn.disabled = true;
  urlStatus.innerHTML = '<span class="spinner"></span>Fetching image…';
  urlStatus.className = "status-line info";

  try {
    // Ask the user for host permission on this origin so the extension can
    // fetch without being blocked by CORS. Declared via optional_host_permissions
    // in the manifest — nothing happens if the user has already granted it.
    const origin = `${parsed.protocol}//${parsed.host}/*`;
    if (chrome.permissions && chrome.permissions.request) {
      try {
        await new Promise((resolve) =>
          chrome.permissions.request({ origins: [origin] }, () => resolve()),
        );
      } catch (_e) {
        // Permission request failures are non-fatal — fetch may still succeed
        // if the server sends permissive CORS headers.
      }
    }

    const response = await fetch(rawUrl, { mode: "cors" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim();
    const blob = await response.blob();
    const mime = ACCEPTED_MIME.includes(contentType)
      ? contentType
      : ACCEPTED_MIME.includes(blob.type)
        ? blob.type
        : null;
    if (!mime) {
      throw new Error("The URL did not return a supported image (JPG, PNG, WEBP, GIF).");
    }
    if (blob.size > MAX_FILE_BYTES) {
      throw new Error("Image is too large (max 8 MB).");
    }
    const dataUrl = await fileToDataUrl(
      new File([blob], "url-image", { type: mime }),
    );
    const result = await addUploadedFromDataUrl(dataUrl, {
      mime,
      source: "url",
      originalUrl: rawUrl,
    });
    if (!result.added) {
      setStatus(urlStatus, "This image is already in your library.", "info");
    } else {
      setStatus(urlStatus, "Image added to your library.", "success");
      urlInput.value = "";
      showToast("URL image added.");
      renderGallery();
    }
  } catch (err) {
    // CORS failures surface as a generic TypeError with no message in Chrome —
    // give the user a hint so they know they can still upload the file manually.
    const msg = err && err.message ? err.message : "Failed to fetch image.";
    const hint = /Failed to fetch|NetworkError|HTTP/.test(msg)
      ? "Some sites block cross-origin downloads. Try saving the image and uploading it from your device."
      : "";
    setStatus(urlStatus, hint ? `${msg} ${hint}` : msg, "error");
  } finally {
    urlAddBtn.disabled = false;
  }
}

// ── Event wiring ────────────────────────────────────────────────────────────

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener("change", (e) => handleFiles(e.target.files));

urlAddBtn.addEventListener("click", handleUrlAdd);
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleUrlAdd();
});

filterButtons.forEach((btn) =>
  btn.addEventListener("click", () => {
    filterButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter;
    renderGallery();
  }),
);

// Keep the gallery fresh if the popup (or another tab) changes state.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  let changed = false;
  if (changes.uploadedImages) {
    uploadedImages = Array.isArray(changes.uploadedImages.newValue)
      ? changes.uploadedImages.newValue
      : [];
    changed = true;
  }
  if (changes.disabledImages) {
    disabledImages = new Set(
      Array.isArray(changes.disabledImages.newValue)
        ? changes.disabledImages.newValue
        : [],
    );
    changed = true;
  }
  if (changed) renderGallery();
});

// ── Boot ────────────────────────────────────────────────────────────────────

(async function init() {
  try {
    const res = await fetch(chrome.runtime.getURL("images.json"));
    predefinedData = await res.json();
  } catch (err) {
    console.error("Failed to load images.json", err);
    predefinedData = {};
  }
  await loadState();
  renderGallery();
})();
