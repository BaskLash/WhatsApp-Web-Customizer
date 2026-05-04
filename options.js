// options.js — settings page for the analytics consent toggle and the
// anonymous distinct ID. Runs in a normal extension page context, so
// chrome.runtime is fully available.

(function () {
  document.addEventListener("DOMContentLoaded", async () => {
    const toggle = document.getElementById("consent-toggle");
    const idValue = document.getElementById("distinct-id");
    const copyBtn = document.getElementById("copy-id");
    const flash = document.getElementById("copied-flash");

    // Initialize toggle from current consent state.
    try {
      const consent = await window.getAnalyticsConsent();
      toggle.checked = consent === "granted";
    } catch (err) {
      toggle.checked = false;
    }

    toggle.addEventListener("change", async () => {
      try {
        await window.setAnalyticsConsent(toggle.checked ? "granted" : "declined");
      } catch (err) {
        // Revert UI on failure so the toggle reflects reality.
        toggle.checked = !toggle.checked;
      }
    });

    // Show distinct ID. We always have one — getDistinctId in the SW
    // generates+stores on first call.
    try {
      const id = await window.getAnalyticsDistinctId();
      if (id) idValue.textContent = id;
    } catch (err) {
      idValue.textContent = "—";
    }

    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        const text = idValue.textContent || "";
        if (!text || text === "—") return;
        try {
          await navigator.clipboard.writeText(text);
          flash.classList.add("show");
          setTimeout(() => flash.classList.remove("show"), 1200);
        } catch (err) {
          // Clipboard may be denied; fall back to selecting the text so
          // the user can copy manually.
          const range = document.createRange();
          range.selectNodeContents(idValue);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
      });
    }
  });
})();
