// consent.js — handles the first-run consent dialog.
//
// Default is "declined". The dialog is opened once on install by the
// service worker; the user can change their mind any time from the
// settings (options) page.

(function () {
  function close() {
    // chrome.tabs.getCurrent + remove gives a clean exit on the page the
    // service worker opened on install. Falls back to window.close for any
    // other context.
    try {
      chrome.tabs.getCurrent((tab) => {
        if (tab && tab.id != null) {
          chrome.tabs.remove(tab.id);
        } else {
          window.close();
        }
      });
    } catch (err) {
      window.close();
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const acceptBtn = document.getElementById("accept");
    const declineBtn = document.getElementById("decline");

    if (acceptBtn) {
      acceptBtn.addEventListener("click", async () => {
        acceptBtn.disabled = true;
        declineBtn.disabled = true;
        try {
          await window.setAnalyticsConsent("granted");
        } catch (err) {
          // Even if the SW message fails, close — user has made their
          // choice; we don't want them stuck on this tab.
        }
        close();
      });
    }

    if (declineBtn) {
      declineBtn.addEventListener("click", async () => {
        acceptBtn.disabled = true;
        declineBtn.disabled = true;
        try {
          await window.setAnalyticsConsent("declined");
        } catch (err) {
          // Same reasoning as above.
        }
        close();
      });
    }
  });
})();
