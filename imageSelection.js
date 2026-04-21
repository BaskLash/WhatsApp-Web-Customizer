// imageSelection.js — theme-slot picker in the popup.
// File uploads and URL imports have been moved to manage-images.html.
// This script now only selects from the existing library (predefined +
// user-added via the management page), respecting `disabledImages`.

const imageCache = new Map();
let imageData = null; // parsed images.json
let uploadedImages = []; // from chrome.storage.local
let disabledImages = new Set(); // from chrome.storage.local
let currentType = null;
let selectedSrc = null;

// DOM Elements
const modal = document.getElementById("image-modal");
const modalGallery = document.getElementById("modal-gallery");
const modalTitle = document.getElementById("modal-title");
const modalUploadBtn = document.getElementById("modal-upload");

// Label the button to reflect its new role.
if (modalUploadBtn) modalUploadBtn.textContent = "Manage Images";

const THEME_SLOTS = ["welcome", "sidenav", "chatview", "navside"];

// Open the management page in a new tab.
function openManagePage() {
  const url = chrome.runtime.getURL("manage-images.html");
  if (chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url });
  } else {
    window.open(url, "_blank");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  // Load previews + library metadata
  chrome.storage.local.get(
    [...THEME_SLOTS, "uploadedImages", "disabledImages"],
    (result) => {
      // Preview thumbnails for each theme slot
      THEME_SLOTS.forEach((id) => {
        const previewImg = document.getElementById(`${id}-preview`);
        if (!previewImg) return;
        previewImg.src = result[id]
          ? result[id].startsWith("data:")
            ? result[id]
            : chrome.runtime.getURL(result[id])
          : "default.jpg";
      });

      uploadedImages = Array.isArray(result.uploadedImages)
        ? result.uploadedImages
        : [];
      disabledImages = new Set(
        Array.isArray(result.disabledImages) ? result.disabledImages : [],
      );

      fetch(chrome.runtime.getURL("images.json"))
        .then((res) => res.json())
        .then((data) => {
          imageData = data;
          renderGallery();
        })
        .catch((err) => console.error("Failed to load images.json:", err));
    },
  );

  // "Manage Images" opens the dedicated page (no more popup file upload)
  if (modalUploadBtn) {
    modalUploadBtn.addEventListener("click", (e) => {
      e.preventDefault();
      openManagePage();
      closeModal();
    });
  }
});

// Keep the popup in sync when the management page changes the library.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  let needsRender = false;
  if (changes.uploadedImages) {
    uploadedImages = Array.isArray(changes.uploadedImages.newValue)
      ? changes.uploadedImages.newValue
      : [];
    needsRender = true;
  }
  if (changes.disabledImages) {
    disabledImages = new Set(
      Array.isArray(changes.disabledImages.newValue)
        ? changes.disabledImages.newValue
        : [],
    );
    needsRender = true;
  }
  // If a theme slot was cleared (because its image was deleted), refresh preview
  THEME_SLOTS.forEach((slot) => {
    if (changes[slot]) {
      const previewImg = document.getElementById(`${slot}-preview`);
      if (!previewImg) return;
      const v = changes[slot].newValue;
      previewImg.src = v
        ? v.startsWith("data:")
          ? v
          : chrome.runtime.getURL(v)
        : "default.jpg";
    }
  });
  if (needsRender && modal.style.display === "flex") renderGallery();
});

// ── Library helpers ─────────────────────────────────────────────────────────

function getAllImages() {
  const set = new Set();
  if (imageData) {
    for (const cat in imageData) {
      if (cat === "uploaded") continue; // legacy key — ignore
      const files = imageData[cat]?.files;
      if (Array.isArray(files)) files.forEach((src) => set.add(src));
    }
  }
  uploadedImages.forEach((img) => set.add(img.dataUrl));
  // Filter out logically-disabled entries
  return [...set].filter((src) => !disabledImages.has(src));
}

function preloadImage(src) {
  if (imageCache.has(src)) return imageCache.get(src);
  const img = new Image();
  img.src = src.startsWith("data:") ? src : chrome.runtime.getURL(src);
  img.loading = "lazy";
  img.onerror = () => console.warn(`Failed to preload: ${src}`);
  imageCache.set(src, img);
  return img;
}

function selectImageInGallery(src) {
  modalGallery
    .querySelectorAll(".image-option")
    .forEach((el) => el.classList.remove("selected"));
  const option = modalGallery.querySelector(`.image-option[data-src="${src}"]`);
  if (option) {
    option.classList.add("selected");
    selectedSrc = src;
  }
}

// ── Gallery rendering ───────────────────────────────────────────────────────

function renderGallery() {
  if (!imageData) return;
  modalGallery.innerHTML = "";
  const images = getAllImages();
  const BATCH_SIZE = 20;
  let index = 0;

  function renderBatch() {
    const fragment = document.createDocumentFragment();
    const end = Math.min(index + BATCH_SIZE, images.length);

    for (let i = index; i < end; i++) {
      const src = images[i];
      const option = document.createElement("div");
      option.className = "image-option";
      option.dataset.src = src;

      const img = preloadImage(src).cloneNode();
      img.alt = "";
      img.loading = "lazy";
      option.appendChild(img);

      option.addEventListener("click", () => {
        modalGallery
          .querySelectorAll(".image-option")
          .forEach((el) => el.classList.remove("selected"));
        option.classList.add("selected");
        selectedSrc = src;

        if (currentType) {
          const previewImg = document.getElementById(`${currentType}-preview`);
          if (previewImg) {
            previewImg.src = src.startsWith("data:")
              ? src
              : chrome.runtime.getURL(src);
          }
        }
      });

      fragment.appendChild(option);
    }

    modalGallery.appendChild(fragment);
    index = end;

    if (index < images.length) {
      requestIdleCallback(renderBatch, { timeout: 100 });
    } else if (selectedSrc) {
      selectImageInGallery(selectedSrc);
    }
  }

  renderBatch();
}

// ── Modal logic ─────────────────────────────────────────────────────────────

function openModal(type) {
  currentType = type;
  modalTitle.textContent = `Image selection for ${type}`;
  modal.style.display = "flex";
  modalGallery.scrollTo({ top: 0, behavior: "smooth" });

  chrome.storage.local.get([type], (result) => {
    if (result[type]) selectImageInGallery(result[type]);
  });
}

function closeModal() {
  modal.style.display = "none";
  currentType = null;
  selectedSrc = null;
}

document.getElementById("modal-save").addEventListener("click", () => {
  if (currentType && selectedSrc) {
    chrome.storage.local.set({ [currentType]: selectedSrc }, () => {
      const previewImg = document.getElementById(`${currentType}-preview`);
      if (previewImg) {
        previewImg.src = selectedSrc.startsWith("data:")
          ? selectedSrc
          : chrome.runtime.getURL(selectedSrc);
      }
    });
  }
  closeModal();
});

document.getElementById("modal-none").addEventListener("click", () => {
  if (currentType) {
    chrome.storage.local.remove(currentType);
    const previewImg = document.getElementById(`${currentType}-preview`);
    if (previewImg) previewImg.src = "default.jpg";
  }
  closeModal();
});

document.getElementById("modal-cancel").addEventListener("click", closeModal);

document.addEventListener("click", (e) => {
  const option = e.target.closest(".image-option[data-type]");
  if (option) openModal(option.dataset.type);
});
