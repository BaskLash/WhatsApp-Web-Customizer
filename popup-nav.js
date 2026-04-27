// Tiny tab + collapse handler so the popup doesn't need bootstrap.bundle.js.
// Scope: only elements declared in popup.html — does not touch any IDs owned
// by popup.js / imageSelection.js / quick-replies.js / fontFamilyChange.js /
// fontSizeChange.js.

document.addEventListener("DOMContentLoaded", () => {
  // Vertical pill nav: clicking [data-tab="x"] activates pane #x.
  const tabs = document.querySelectorAll("[data-tab]");
  const panes = document.querySelectorAll(".tab-pane");

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
      activate(t.dataset.tab);
    });
  });

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
