// Tiny tab + collapse handler so the popup doesn't need bootstrap.bundle.js.
// Scope: only elements declared in popup.html — does not touch any IDs owned
// by popup.js / imageSelection.js / quick-replies.js / fontFamilyChange.js /
// fontSizeChange.js.

document.addEventListener("DOMContentLoaded", () => {
  // Vertical pill nav: clicking [data-tab="x"] activates pane #x.
  const tabs = document.querySelectorAll("[data-tab]");
  const panes = document.querySelectorAll(".tab-pane");

  // Tab IDs are part of the extension (popup.html), so they're a fixed
  // enum — safe to send as analytics property values.
  let activeTab =
    Array.from(tabs).find((t) => t.classList.contains("active"))?.dataset.tab ||
    "tab-display";

  // Per-popup-session de-dup: each tab fires "tab_first_seen" at most once.
  // Lets us measure how many popups ever surface the QR preview without
  // double-counting users who toggle tabs back and forth.
  const seenTabs = new Set([activeTab]);

  function maybeFireFirstSeen(tab) {
    if (!tab || seenTabs.has(tab)) return;
    seenTabs.add(tab);
    if (tab === "tab-replies") {
      try {
        if (window.track) window.track("quick_replies_preview_seen");
      } catch (_) { /* ignore */ }
    }
  }

  function activate(target) {
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === target));
    panes.forEach((p) => {
      const on = p.id === target;
      p.classList.toggle("show", on);
      p.classList.toggle("active", on);
    });
  }

  tabs.forEach((t) => {
    t.addEventListener("click", (e) => {
      e.preventDefault();
      const target = t.dataset.tab;
      if (target && target !== activeTab) {
        try {
          if (window.track) {
            window.track("popup_tab_changed", { from_tab: activeTab, to_tab: target });
          }
        } catch (_) { /* analytics must never break the popup */ }
        activeTab = target;
        maybeFireFirstSeen(target);
      }
      activate(target);
    });
  });

  // If the user lands directly on the Replies tab (e.g. it was the active
  // tab on popup open), fire once now.
  maybeFireFirstSeen(activeTab);

  // Lightweight collapse: clicking [data-collapse="#id"] toggles .show on #id.
  document.querySelectorAll("[data-collapse]").forEach((trigger) => {
    trigger.addEventListener("click", (e) => {
      e.preventDefault();
      const target = document.querySelector(trigger.dataset.collapse);
      if (!target) return;
      const open = target.classList.toggle("show");
      trigger.setAttribute("aria-expanded", open ? "true" : "false");
      trigger.classList.toggle("collapsed", !open);
    });
  });

  // Live preview of the selected font in the Typography tab.
  const fontPreview = document.getElementById("font-preview");
  const fontSelect = document.getElementById("fontSelector");
  if (fontPreview && fontSelect) {
    const updatePreview = () => {
      const v = fontSelect.value;
      fontPreview.style.fontFamily = v
        ? `'${v.replace(/\+/g, " ")}', sans-serif`
        : "";
    };
    fontSelect.addEventListener("change", updatePreview);
    // Run once after popup.js / fontFamilyChange.js have populated the value.
    setTimeout(updatePreview, 50);
  }
});
