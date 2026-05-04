// options.js — settings page.
//
// Surfaces the anonymous distinct ID (so the user can include it in any
// data-deletion request) and links to the privacy policy. There is no
// consent toggle — disclosure runs through the policy and the in-product
// "About usage data" card.
//
// TODO: replace <<< https://your-domain.example/privacy >>> in options.html
// once the privacy policy is hosted.

(function () {
  document.addEventListener("DOMContentLoaded", async () => {
    const idValue = document.getElementById("distinct-id");
    const copyBtn = document.getElementById("copy-id");
    const flash = document.getElementById("copied-flash");

    // We always have an ID — getDistinctId in the SW lazily generates one
    // on first call.
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
