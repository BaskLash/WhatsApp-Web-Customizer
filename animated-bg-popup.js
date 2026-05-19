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

  // Analytics helper — single point so the try/catch lives in one place and
  // the call sites stay readable. Property values everywhere in this file are
  // either fixed-enum strings (registry ids/titles/artists, hardcoded subtab
  // ids) or booleans, so no privacy review needed per call site.
  function safeTrack(event, props) {
    try {
      if (window.track) window.track(event, props || {});
    } catch (_) { /* analytics must never break the popup */ }
  }

  // Registry. Order = display order in the gallery, ranked by
  // `animated_background_set` adoption (PostHog, ~4-week window). Manual
  // order — do not re-sort. Add new entries at the position the next data
  // refresh implies, not at the end.
  // `thumb` is relative to the extension root; `chrome.runtime.getURL` resolves it.
  const ANIMATIONS = [
    {
      id: "gradient_mesh",
      title: "Gradient Mesh",
      artist: "Bundled",
      thumb: "backgrounds/animated/gradient_mesh/thumbnail.svg",
    },
    {
      id: "cozy_window",
      title: "Cozy Window",
      artist: "Bundled",
      thumb: "backgrounds/animated/cozy_window/thumbnail.svg",
    },
    {
      id: "liquid_marble",
      title: "Liquid Marble",
      artist: "Bundled",
      thumb: "backgrounds/animated/liquid_marble/thumbnail.svg",
    },
    {
      id: "beep_ghost",
      title: "Floating Ghost",
      artist: "Beep",
      thumb: "backgrounds/animated/beep_ghost/thumbnail.png",
    },
    {
      id: "red_stapler_animated_gradient",
      title: "Animated Gradient",
      artist: "Red Stapler",
      thumb: "backgrounds/animated/red_stapler_animated_gradient/thumbnail.png",
    },
    {
      id: "water_bubbles",
      title: "Water Bubbles",
      artist: "Bundled",
      thumb: "backgrounds/animated/water_bubbles/thumbnail.svg",
    },
    {
      id: "rose_lui_lava_lamp",
      title: "Lava Lamp",
      artist: "Rose Lui",
      thumb: "backgrounds/animated/rose_lui_lava_lamp/thumbnail.png",
    },
    {
      id: "floating_bubbles",
      title: "Floating Bubbles",
      artist: "Bundled",
      thumb: "backgrounds/animated/floating_bubbles/thumbnail.svg",
    },
    {
      id: "tiffany_choong_stripes",
      title: "Stripes",
      artist: "Tiffany Choong",
      thumb: "backgrounds/animated/tiffany_choong_stripes/thumbnail.png",
    },
  ];

  // O(1) lookup so analytics events can include the human-readable title and
  // artist alongside the id. Both values are bundled metadata — no PII.
  const ANIM_BY_ID = new Map(ANIMATIONS.map((a) => [a.id, a]));

  // Currently-applied animation id (null when none/cleared). Mirrors what's
  // in chrome.storage.local["animated_background"] and is updated both when
  // the user selects in this popup AND when storage changes elsewhere. Used
  // to populate `previous_id` and `is_reselect` on analytics events without
  // an extra storage read per click.
  let currentAnimId = null;

  // Per-popup-session de-dup for the "first time the Animated subtab was
  // opened" event. Lets us measure how many popup sessions ever surface the
  // animation gallery without inflating from users who toggle Static↔Animated
  // back and forth.
  const seenSubtabs = new Set();

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
      // Dual-write deprecation window: `from`/`to` are kept for back-compat
      // with existing dashboards; `from_subtab`/`to_subtab` match the rest
      // of the sub-tab events (themes_subtab_changed,
      // theme_manager_subtab_changed). Drop `from`/`to` after the 2-release
      // cycle. See ANALYTICS.md for the cutover date.
      safeTrack("backgrounds_subtab_changed", {
        from: previous,            // DEPRECATED
        to: target,                // DEPRECATED
        from_subtab: previous,
        to_subtab: target,
      });
    }
    if (fireAnalytics) maybeFireSubtabFirstSeen(target);
  }

  function maybeFireSubtabFirstSeen(target) {
    if (!target || seenSubtabs.has(target)) return;
    seenSubtabs.add(target);
    if (target === "bg-animated") {
      // Counts unique popup sessions where the user actually engaged with
      // the Animated gallery (not just had it as the active subtab). Pairs
      // with `animated_background_set` to compute a discovery→apply funnel.
      safeTrack("animated_subtab_opened", {
        has_active_animation: !!currentAnimId,
        active_animation_id: currentAnimId || null,
      });
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

  function applySelection(animId, source) {
    const previousId = currentAnimId;
    const previousMeta = previousId ? ANIM_BY_ID.get(previousId) : null;

    if (!animId) {
      chrome.storage.local.remove(STORAGE_KEY, () => {
        // Includes previous_* so analytics can answer "which animations do
        // users abandon?" — the cleared event was previously a bare ping.
        safeTrack("animated_background_cleared", {
          previous_id: previousId || null,
          previous_name: previousMeta ? previousMeta.title : null,
          previous_artist: previousMeta ? previousMeta.artist : null,
          source: source || "gallery_click",
        });
      });
      currentAnimId = null;
      setActiveCard(null);
      return;
    }

    const isReselect = animId === previousId;
    const meta = ANIM_BY_ID.get(animId);

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
          safeTrack("animated_background_set", {
            id: animId,
            name: meta ? meta.title : null,
            artist: meta ? meta.artist : null,
            // Prior animation id (or null on first apply / after a clear).
            // Pairs with `id` to model selection journeys without join logic.
            previous_id: previousId || null,
            // Same id selected again — the user re-applied the active card.
            // Useful for filtering "true switch" events out of frequency
            // counts so a single popular animation doesn't get inflated by
            // accidental double-clicks.
            is_reselect: isReselect,
            // Lets analytics distinguish "first-time apply" vs.
            // "user replaced an existing static chat-view image".
            replaced_static_chatview: hadStaticChatview,
            // Input modality: lets us see how often the gallery is operated
            // via keyboard (accessibility signal).
            source: source || "gallery_click",
          });
        });
        currentAnimId = animId;
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
    applySelection(card.dataset.animId || null, "gallery_click");
  }

  function onCardKeydown(e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".anim-card");
    if (!card) return;
    e.preventDefault();
    applySelection(card.dataset.animId || null, "gallery_keyboard");
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-bg-subtab]").forEach((tab) => {
      tab.addEventListener("click", () => activateSubtab(tab.dataset.bgSubtab, true));
    });

    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const stored = result[STORAGE_KEY];
      const activeId = stored && typeof stored.id === "string" ? stored.id : null;
      currentAnimId = activeId;
      renderGallery(activeId);
    });

    // If another tab/popup changes selection while this popup is open, sync.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[STORAGE_KEY]) return;
      const next = changes[STORAGE_KEY].newValue;
      const activeId = next && typeof next.id === "string" ? next.id : null;
      currentAnimId = activeId;
      setActiveCard(activeId);
    });
  });
})();
