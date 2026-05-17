// imageSelection.js — theme-slot picker in the popup.
//
// Storage schema (shared with manage-images.js):
//   - `uploadedImages`: [{ filename, dataUrl, source?, originalUrl? }]
//     `source` is "upload" (default) or "url" for URL-imported images.
//   - `disabledImages`: [src] — logical-deletion flag for predefined
//     remote-URL images listed in images.json.
//   - Theme slots (welcome, sidenav, chatview, navside) store either a
//     remote URL or a data: URL — both are usable directly as <img> src
//     and as CSS background-image.
//
// All images (bundled assets have been removed) are remote URLs or data:
// URLs, so no path translation is needed anywhere.

const PLACEHOLDER_SRC =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 9'%3E%3Crect fill='%23242530' width='16' height='9'/%3E%3C/svg%3E";
const THEME_SLOTS = ["welcome", "sidenav", "chatview", "navside"];

let predefinedSrcs = []; // from images.json (flat list of URLs)
let uploadedImages = []; // [{ filename, dataUrl, source?, originalUrl? }]
let disabledImages = new Set(); // src strings flagged as hidden
let currentType = null;
let selectedSrc = null;
let renderToken = 0; // guard against overlapping batched renders
const urlToDataUrlCache = new Map(); // remote URL → data URL, for the lifetime of the popup

// DOM
const modal = document.getElementById("image-modal");
const modalGallery = document.getElementById("modal-gallery");
const modalTitle = document.getElementById("modal-title");
const modalUploadBtn = document.getElementById("modal-upload");

if (modalUploadBtn) modalUploadBtn.textContent = "Manage Images";

// ── Helpers ─────────────────────────────────────────────────────────────────

function isUsableSrc(src) {
  return typeof src === "string" && /^(https?:|data:)/.test(src);
}

function previewFor(src) {
  return isUsableSrc(src) ? src : PLACEHOLDER_SRC;
}

function isUserImage(src) {
  return uploadedImages.some((i) => i.dataUrl === src);
}

function isPredefinedImage(src) {
  return predefinedSrcs.includes(src);
}

function setPreview(slot, src) {
  const el = document.getElementById(`${slot}-preview`);
  if (el) el.src = previewFor(src);
}

function openManagePage() {
  try {
    if (window.track) window.track("image_manager_opened");
  } catch (e) { /* ignore */ }
  const url = chrome.runtime.getURL("manage-images.html");
  if (chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url });
  } else {
    window.open(url, "_blank");
  }
}

// Fetches a remote image and converts it to a data URL using the same pipeline
// as local uploads. Needed because WhatsApp Web's CSP blocks external image
// origins in `background-image: url(...)`, so the theme slot must always hold
// a data URL by the time the content script reads it.
function fetchAsDataUrl(url) {
  if (urlToDataUrlCache.has(url)) return Promise.resolve(urlToDataUrlCache.get(url));
  return fetch(url, { mode: "cors" })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.blob();
    })
    .then((blob) => {
      if (!blob.type || !blob.type.startsWith("image/")) {
        throw new Error("The URL did not return an image.");
      }
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error("Read failed."));
        reader.readAsDataURL(blob);
      });
    })
    .then((dataUrl) => {
      urlToDataUrlCache.set(url, dataUrl);
      return dataUrl;
    });
}

// Unified conversion funnel: every save goes through here so the theme slot
// ends up with a `data:` URL regardless of whether the source was an upload,
// a URL-imported image (already a data URL), or a predefined remote URL.
async function ensureDataUrl(src) {
  if (typeof src !== "string" || !src) return null;
  if (src.startsWith("data:")) return src;
  if (/^https?:/.test(src)) return await fetchAsDataUrl(src);
  return null;
}

// ── Bootstrap ───────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get(
    [...THEME_SLOTS, "uploadedImages", "disabledImages"],
    (result) => {
      THEME_SLOTS.forEach((slot) => setPreview(slot, result[slot]));
      uploadedImages = Array.isArray(result.uploadedImages)
        ? result.uploadedImages
        : [];
      disabledImages = new Set(
        Array.isArray(result.disabledImages) ? result.disabledImages : [],
      );

      fetch(chrome.runtime.getURL("images.json"))
        .then((res) => res.json())
        .then((data) => {
          predefinedSrcs = extractPredefinedSrcs(data);
          renderGallery();
        })
        .catch((err) => console.error("Failed to load images.json:", err));

      // Self-heal slots left over from pre-CSP-fix installs: they contain a
      // raw HTTPS URL that WhatsApp Web's CSP blocks. Convert to data URLs
      // in the background so the selection actually renders next time.
      migrateLegacySlots(result);
    },
  );

  if (modalUploadBtn) {
    modalUploadBtn.addEventListener("click", (e) => {
      e.preventDefault();
      openManagePage();
      closeModal();
    });
  }
});

async function migrateLegacySlots(initialValues) {
  const migrations = {};
  for (const slot of THEME_SLOTS) {
    const v = initialValues[slot];
    if (typeof v === "string" && /^https?:/.test(v)) {
      try {
        migrations[slot] = await fetchAsDataUrl(v);
      } catch (err) {
        console.warn(`Legacy ${slot} slot could not be converted:`, err);
      }
    }
  }
  if (Object.keys(migrations).length > 0) {
    chrome.storage.local.set(migrations);
  }
}

function extractPredefinedSrcs(data) {
  const out = [];
  if (!data) return out;
  for (const key of Object.keys(data)) {
    // `uploaded` was a legacy side-channel — ignore if it ever appears.
    if (key === "uploaded") continue;
    const files = data[key]?.files;
    if (!Array.isArray(files)) continue;
    for (const src of files) if (isUsableSrc(src)) out.push(src);
  }
  return out;
}

// ── Live sync with the management page ─────────────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  let libraryChanged = false;

  if (changes.uploadedImages) {
    uploadedImages = Array.isArray(changes.uploadedImages.newValue)
      ? changes.uploadedImages.newValue
      : [];
    libraryChanged = true;
  }
  if (changes.disabledImages) {
    disabledImages = new Set(
      Array.isArray(changes.disabledImages.newValue)
        ? changes.disabledImages.newValue
        : [],
    );
    libraryChanged = true;
  }

  for (const slot of THEME_SLOTS) {
    if (changes[slot]) setPreview(slot, changes[slot].newValue);
  }

  if (libraryChanged && modal.style.display === "flex") renderGallery();
});

// ── Library view (predefined + user, minus disabled) ────────────────────────

function visibleSrcs() {
  const seen = new Set();
  const out = [];
  for (const src of predefinedSrcs) {
    if (disabledImages.has(src) || seen.has(src)) continue;
    seen.add(src);
    out.push(src);
  }
  for (const img of uploadedImages) {
    const src = img.dataUrl;
    if (!isUsableSrc(src) || disabledImages.has(src) || seen.has(src)) continue;
    seen.add(src);
    out.push(src);
  }
  return out;
}

// ── Gallery rendering ───────────────────────────────────────────────────────

function renderGallery() {
  const token = ++renderToken;
  modalGallery.innerHTML = "";
  const images = visibleSrcs();

  if (images.length === 0) {
    const empty = document.createElement("div");
    empty.className = "gallery-empty-hint";
    empty.style.cssText =
      "padding:20px;color:#a0a0a0;font-size:13px;text-align:center;width:100%";
    empty.textContent =
      "No images available. Use “Manage Images” to add some.";
    modalGallery.appendChild(empty);
    return;
  }

  const BATCH_SIZE = 12;
  let index = 0;

  const renderBatch = () => {
    if (token !== renderToken) return; // superseded by another render
    const fragment = document.createDocumentFragment();
    const end = Math.min(index + BATCH_SIZE, images.length);

    for (let i = index; i < end; i++) {
      fragment.appendChild(createOption(images[i]));
    }

    modalGallery.appendChild(fragment);
    index = end;

    if (index < images.length) {
      (window.requestIdleCallback || window.requestAnimationFrame)(renderBatch, {
        timeout: 100,
      });
    } else if (selectedSrc) {
      selectImageInGallery(selectedSrc);
    }
  };

  renderBatch();
}

function createOption(src) {
  const option = document.createElement("div");
  option.className = "image-option";
  option.dataset.src = src;

  const img = document.createElement("img");
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  img.src = src;
  option.appendChild(img);

  // Per-image delete button:
  //   - predefined → logical disable (adds to disabledImages)
  //   - upload / url → hard delete from uploadedImages
  const delBtn = document.createElement("button");
  delBtn.className = "delete-btn";
  delBtn.textContent = "✕";
  delBtn.title = isPredefinedImage(src)
    ? "Hide this image"
    : "Delete this image";
  delBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    deleteImage(src);
  });
  option.appendChild(delBtn);

  option.addEventListener("click", () => {
    modalGallery
      .querySelectorAll(".image-option.selected")
      .forEach((el) => el.classList.remove("selected"));
    option.classList.add("selected");
    selectedSrc = src;

    if (currentType) setPreview(currentType, src);
  });

  return option;
}

function selectImageInGallery(src) {
  modalGallery
    .querySelectorAll(".image-option.selected")
    .forEach((el) => el.classList.remove("selected"));
  const option = modalGallery.querySelector(
    `.image-option[data-src="${cssEscape(src)}"]`,
  );
  if (option) {
    option.classList.add("selected");
    selectedSrc = src;
  }
}

// CSS.escape isn't needed for https URLs but data: URLs contain characters
// (`:`, `,`, `/`, `+`, `=`) that the selector engine handles fine inside an
// attribute selector — except when the value also contains `"`. The data URL
// we produce never does, but escape defensively.
function cssEscape(value) {
  return window.CSS && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
}

// ── Deletion ────────────────────────────────────────────────────────────────

function deleteImage(src) {
  let kind = null;
  if (isUserImage(src)) {
    // We can't tell upload vs. url apart here without re-reading storage —
    // categorize as "user" and let manage-images send the precise breakdown.
    kind = "user";
    uploadedImages = uploadedImages.filter((i) => i.dataUrl !== src);
    chrome.storage.local.set({ uploadedImages }, () => clearSlotsUsing(src));
    // A user image might also have been individually disabled — clean up.
    if (disabledImages.delete(src)) {
      chrome.storage.local.set({ disabledImages: [...disabledImages] });
    }
  } else if (isPredefinedImage(src)) {
    kind = "predefined";
    disabledImages.add(src);
    chrome.storage.local.set(
      { disabledImages: [...disabledImages] },
      () => clearSlotsUsing(src),
    );
  } else {
    return;
  }

  try {
    if (window.track) {
      // Dual-write deprecation: `from_page` → `source` (see ANALYTICS.md).
      window.track("image_deleted", {
        kind,
        from_page: "popup",   // DEPRECATED
        source: "popup",
      });
    }
  } catch (_) { /* ignore */ }

  if (selectedSrc === src) selectedSrc = null;
  renderGallery();
}

function clearSlotsUsing(src) {
  chrome.storage.local.get(THEME_SLOTS, (result) => {
    const toRemove = THEME_SLOTS.filter((slot) => result[slot] === src);
    if (toRemove.length === 0) return;
    chrome.storage.local.remove(toRemove, () => {
      toRemove.forEach((slot) => setPreview(slot, null));
    });
  });
}

// ── Modal logic ─────────────────────────────────────────────────────────────

function openModal(type) {
  currentType = type;
  // Nutze innerHTML für die Formatierung (fett & kursiv)
  modalTitle.innerHTML = `Image selection for <b><i>${type}</i></b>`;
  modal.style.display = "flex";
  modalGallery.scrollTo({ top: 0 });

  // `type` is the slot enum (welcome/navside/sidenav/chatview) — no UI text.
  try {
    if (window.track) window.track("image_modal_opened", { slot: type });
  } catch (_) { /* ignore */ }

  chrome.storage.local.get([type], (result) => {
    if (result[type]) selectImageInGallery(result[type]);
  });
}

// `outcome` is a fixed enum: saved | cleared | cancel | backdrop | esc.
// "cancel" covers the explicit Cancel button; backdrop/esc paths aren't
// wired today — left here so future shortcuts can plug in cleanly.
function closeModal(outcome = "cancel") {
  const slot = currentType;
  modal.style.display = "none";
  currentType = null;
  selectedSrc = null;
  try {
    if (slot && window.track) {
      window.track("image_modal_closed", { slot, outcome });
    }
  } catch (_) { /* ignore */ }
}

const modalSaveBtn = document.getElementById("modal-save");
modalSaveBtn.addEventListener("click", async () => {
  if (!currentType || !selectedSrc) {
    closeModal();
    return;
  }

  const slot = currentType;
  const src = selectedSrc;

  const originalLabel = modalSaveBtn.textContent;
  modalSaveBtn.disabled = true;
  modalSaveBtn.textContent = "Saving…";

  try {
    const dataUrl = await ensureDataUrl(src);
    if (!dataUrl) {
      alert(
        "Couldn't prepare that image. It may have blocked cross-origin access — try uploading it from your device via Manage Images.",
      );
      return;
    }
    await new Promise((resolve) =>
      chrome.storage.local.set({ [slot]: dataUrl }, resolve),
    );
    setPreview(slot, dataUrl);

    // Animated→Static mutex: only the chatview slot conflicts with an
    // animated background (both target the same area behind the chat).
    // If an animation is currently active, clear it now so the static
    // image takes over cleanly. animated-bg.js's storage.onChanged listener
    // will tear down the bg container and stop the running animation.
    let replacedAnimation = false;
    if (slot === "chatview") {
      const snapshot = await new Promise((resolve) =>
        chrome.storage.local.get(["animated_background"], resolve),
      );
      if (snapshot.animated_background) {
        replacedAnimation = true;
        await new Promise((resolve) =>
          chrome.storage.local.remove("animated_background", resolve),
        );
      }
    }

    // Analytics: slot is the fixed enum (welcome/navside/sidenav/chatview).
    // `source` is derived structurally from the library — we never look at
    // the URL or filename itself.
    try {
      if (window.track) {
        const source = isUserImage(src) ? "uploaded" : "predefined";
        const props = { slot, source };
        // Only meaningful for chatview; included unconditionally because
        // the property is structural (boolean, fixed name, no PII).
        if (slot === "chatview") props.replaced_animation = replacedAnimation;
        window.track("background_slot_set", props);
      }
    } catch (e) { /* ignore */ }
    closeModal("saved");
  } catch (err) {
    console.error("Failed to save image:", err);
    alert(
      "Couldn't save that image: " +
        (err && err.message ? err.message : "fetch failed.") +
        "\nTip: download the image and add it via Manage Images instead.",
    );
  } finally {
    modalSaveBtn.disabled = false;
    modalSaveBtn.textContent = originalLabel;
  }
});

document.getElementById("modal-none").addEventListener("click", () => {
  if (currentType) {
    const slot = currentType;
    chrome.storage.local.remove(slot);
    setPreview(slot, null);
    try {
      if (window.track) window.track("background_slot_cleared", { slot });
    } catch (e) { /* ignore */ }
  }
  closeModal("cleared");
});

document.getElementById("modal-cancel").addEventListener("click", () => closeModal("cancel"));

document.addEventListener("click", (e) => {
  const option = e.target.closest(".image-option[data-type]");
  if (option) openModal(option.dataset.type);
});
