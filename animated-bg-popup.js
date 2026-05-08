// animated-bg-popup.js — Backgrounds → "Animated" sub-tab in the popup.
//
// Renders the gallery, handles sub-tab switching, and persists the user's
// pick to chrome.storage.local. The content script (animated-bg.js) reads
// the same storage key and injects/removes the animation HTML on
// web.whatsapp.com.
//
// All registry data here (id, title, artist, thumbnail) is hard-coded —
// these are bundled assets, not user input. Property values sent to
// analytics are limited to the registry id, which is a fixed enum.

(function () {
  const STORAGE_KEY = "animated_background";

  // Registry. Order = display order in the gallery.
  // `thumb` is relative to the extension root; `chrome.runtime.getURL` resolves it.
  const ANIMATIONS = [
    {
      id: "gradient_mesh",
      title: "Gradient Mesh",
      artist: "Bundled",
      thumb: "backgrounds/animated/gradient_mesh/thumbnail.svg",
    },
    {
      id: "liquid_marble",
      title: "Liquid Marble",
      artist: "Bundled",
      thumb: "backgrounds/animated/liquid_marble/thumbnail.svg",
    },
    {
      id: "water_bubbles",
      title: "Water Bubbles",
      artist: "Bundled",
      thumb: "backgrounds/animated/water_bubbles/thumbnail.svg",
    },
    {
      id: "floating_bubbles",
      title: "Floating Bubbles",
      artist: "Bundled",
      thumb: "backgrounds/animated/floating_bubbles/thumbnail.svg",
    },
    {
      id: "rose_lui_lava_lamp",
      title: "Lava Lamp",
      artist: "Rose Lui",
      thumb: "backgrounds/animated/rose_lui_lava_lamp/thumbnail.png",
    },
    {
      id: "red_stapler_animated_gradient",
      title: "Animated Gradient",
      artist: "Red Stapler",
      thumb: "backgrounds/animated/red_stapler_animated_gradient/thumbnail.png",
    },
    {
      id: "beep_ghost",
      title: "Floating Ghost",
      artist: "Beep",
      thumb: "backgrounds/animated/beep_ghost/thumbnail.png",
    },
    {
      id: "tiffany_choong_stripes",
      title: "Stripes",
      artist: "Tiffany Choong",
      thumb: "backgrounds/animated/tiffany_choong_stripes/thumbnail.png",
    },
  ];

  // ── Sub-tab toggle ────────────────────────────────────────────────────────

  function activateSubtab(target, fireAnalytics) {
    const tabs = document.querySelectorAll("[data-bg-subtab]");
    if (!tabs.length) return;
    let previous = null;
    tabs.forEach((t) => {
      const on = t.dataset.bgSubtab === target;
      if (t.classList.contains("active")) previous = t.dataset.bgSubtab;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll(".bg-subpane").forEach((p) => {
      p.hidden = p.id !== target;
    });

    if (fireAnalytics && previous && previous !== target) {
      try {
        if (window.track) {
          window.track("backgrounds_subtab_changed", {
            from: previous,
            to: target,
          });
        }
      } catch (_) { /* ignore */ }
    }
  }

  // ── Gallery rendering ─────────────────────────────────────────────────────

  function setActiveCard(activeId) {
    const grid = document.getElementById("anim-grid");
    if (!grid) return;
    grid.querySelectorAll(".anim-card").forEach((card) => {
      card.classList.toggle("active", card.dataset.animId === (activeId || ""));
    });
  }

  function buildCard(anim, isActive) {
    const card = document.createElement("div");
    card.className = "anim-card" + (isActive ? " active" : "");
    card.dataset.animId = anim.id;
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.setAttribute("aria-label", `Apply ${anim.title}`);

    const thumb = document.createElement("div");
    thumb.className = "anim-thumb";
    thumb.style.backgroundImage = `url("${chrome.runtime.getURL(anim.thumb)}")`;
    card.appendChild(thumb);

    const meta = document.createElement("div");
    meta.className = "anim-meta";
    meta.textContent = anim.title;
    if (anim.artist) {
      const sub = document.createElement("span");
      sub.className = "anim-artist";
      sub.textContent = `by ${anim.artist}`;
      meta.appendChild(sub);
    }
    card.appendChild(meta);
    return card;
  }

  function buildNoneCard(isActive) {
    const card = document.createElement("div");
    card.className = "anim-card anim-none" + (isActive ? " active" : "");
    card.dataset.animId = "";
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.setAttribute("aria-label", "Clear animated background");

    const thumb = document.createElement("div");
    thumb.className = "anim-thumb";
    thumb.textContent = "None";
    card.appendChild(thumb);

    const meta = document.createElement("div");
    meta.className = "anim-meta";
    meta.textContent = "None";
    const sub = document.createElement("span");
    sub.className = "anim-artist";
    sub.textContent = "Disable animations";
    meta.appendChild(sub);
    card.appendChild(meta);
    return card;
  }

  function applySelection(animId) {
    if (!animId) {
      chrome.storage.local.remove(STORAGE_KEY, () => {
        try {
          if (window.track) window.track("animated_background_cleared");
        } catch (_) { /* ignore */ }
      });
      setActiveCard(null);
      return;
    }

    // Mirrors the static chat-view flow: only one chat-view backdrop runs
    // at a time. If a static image is currently set in the chatview slot,
    // clear it BEFORE writing the animation key so the user immediately
    // sees the animation instead of the static image painting over it.
    // imageSelection.js's storage.onChanged listener will then auto-reset
    // the chatview preview tile in the Static sub-tab.
    chrome.storage.local.get(["chatview"], (snapshot) => {
      const hadStaticChatview = !!snapshot.chatview;

      const writeAnimation = () => {
        chrome.storage.local.set({ [STORAGE_KEY]: { id: animId } }, () => {
          try {
            if (window.track) {
              window.track("animated_background_set", {
                id: animId,
                // Lets analytics distinguish "first-time apply" vs.
                // "user replaced an existing static chat-view image".
                replaced_static_chatview: hadStaticChatview,
              });
            }
          } catch (_) { /* ignore */ }
        });
        setActiveCard(animId);
      };

      if (hadStaticChatview) {
        chrome.storage.local.remove("chatview", writeAnimation);
      } else {
        writeAnimation();
      }
    });
  }

  function renderGallery(activeId) {
    const grid = document.getElementById("anim-grid");
    if (!grid) return;
    grid.innerHTML = "";

    const fragment = document.createDocumentFragment();
    fragment.appendChild(buildNoneCard(!activeId));
    for (const anim of ANIMATIONS) {
      fragment.appendChild(buildCard(anim, anim.id === activeId));
    }
    grid.appendChild(fragment);

    grid.addEventListener("click", onCardClick);
    grid.addEventListener("keydown", onCardKeydown);
  }

  function onCardClick(e) {
    const card = e.target.closest(".anim-card");
    if (!card) return;
    applySelection(card.dataset.animId || null);
  }

  function onCardKeydown(e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".anim-card");
    if (!card) return;
    e.preventDefault();
    applySelection(card.dataset.animId || null);
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-bg-subtab]").forEach((tab) => {
      tab.addEventListener("click", () => activateSubtab(tab.dataset.bgSubtab, true));
    });

    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const stored = result[STORAGE_KEY];
      const activeId = stored && typeof stored.id === "string" ? stored.id : null;
      renderGallery(activeId);
    });

    // If another tab/popup changes selection while this popup is open, sync.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[STORAGE_KEY]) return;
      const next = changes[STORAGE_KEY].newValue;
      const activeId = next && typeof next.id === "string" ? next.id : null;
      setActiveCard(activeId);
    });
  });
})();
