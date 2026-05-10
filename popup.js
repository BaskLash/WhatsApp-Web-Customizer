const checkboxIds = [
  "status",
  "channels",
  "communities",
  "lockedChats",
  "archived",
];

function loadOptions() {
  chrome.storage.local.get(["visibilityOptions"], (data) => {
    const options = data.visibilityOptions || {
      status: false,
      channels: false,
      communities: false,
      lockedChats: false,
      archived: false,
    };

    checkboxIds.forEach((id) => {
      document.getElementById(id).checked = options[id];
    });
  });
}

function saveAndApplyOptions(changedId) {
  const options = {};
  checkboxIds.forEach((id) => {
    options[id] = document.getElementById(id).checked;
  });

  chrome.storage.local.set({ visibilityOptions: options }, () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0]) return;
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: applyVisibilityFromPopup,
        args: [options],
      });
    });
  });

  // Analytics: only the setting name (fixed enum) and the new boolean value.
  // No DOM text, no chat data — checkbox IDs are part of the extension.
  if (changedId) {
    try {
      window.track("visibility_setting_changed", {
        setting: changedId,
        enabled: !!options[changedId],
      });
    } catch (e) { /* analytics must never break the popup */ }
  }
}

// Function to inject into content.js context
function applyVisibilityFromPopup(options) {
  const parent = document.querySelector(
    ".x1c4vz4f.xs83m0k.xdl72j9.x1g77sc7.x78zum5.xozqiw3.x1oa3qoh.x12fk4p8.xeuugli.x2lwn1j.x1nhvcw1.xdt5ytf.x1cy8zhl.x1277o0a"
  );
  if (parent) {
    const divChildren = Array.from(parent.children).filter(
      (child) => child.tagName.toLowerCase() === "div"
    );
    const map = { status: 1, channels: 2, communities: 3 };

    for (const key in map) {
      const index = map[key];
      if (divChildren[index]) {
        divChildren[index].style.display = options[key] ? "block" : "none";
      }
    }
  }

  const paneSide = document.getElementById("pane-side");
  if (paneSide) {
    const lockedChats = paneSide.querySelector("button[aria-label='Locked chats']");
    const archived = paneSide.querySelector("button[aria-label='Archived ']");

    if (lockedChats) lockedChats.style.display = options.lockedChats ? "block" : "none";
    if (archived)    archived.style.display    = options.archived    ? "block" : "none";
  }
}

checkboxIds.forEach((id) => {
  document.getElementById(id).addEventListener("change", () => saveAndApplyOptions(id));
});

loadOptions();

// One popup_opened event per popup invocation. Chrome rebuilds the popup
// each time the icon is clicked, so this fires once per session. Boolean
// snapshot answers "which features does this user have configured?" without
// needing per-feature events — useful as a denominator for engagement.
try {
  chrome.storage.local.get(
    [
      "themes:active",
      "welcome", "navside", "sidenav", "chatview",
      "fontStyle",
      "wa-custom-scale",
      "privacyMode",
      "quickReplies",
      "visibilityOptions",
      "animated_background",
    ],
    (r) => {
      const visibility = r.visibilityOptions || {};
      // Animated background fingerprint: lets us answer "what share of
      // popup-opening users currently have an animation set?" passively,
      // without depending on a fresh selection event during the session.
      // The id is a fixed enum from animated-bg.js's ALLOWED_IDS — no PII.
      const animBg = r.animated_background;
      const animatedId = animBg && typeof animBg.id === "string" ? animBg.id : null;
      const props = {
        has_active_theme: !!(r["themes:active"] && r["themes:active"].id),
        has_any_slot: !!(r.welcome || r.navside || r.sidenav || r.chatview),
        font_set: !!r.fontStyle,
        scale_changed: Number(r["wa-custom-scale"] ?? 1) !== 1,
        privacy_mode: !!r.privacyMode,
        qr_count: Array.isArray(r.quickReplies) ? r.quickReplies.length : 0,
        visibility_status: !!visibility.status,
        visibility_channels: !!visibility.channels,
        visibility_communities: !!visibility.communities,
        visibility_locked_chats: !!visibility.lockedChats,
        visibility_archived: !!visibility.archived,
        has_animated_background: !!animatedId,
        animated_background_id: animatedId,
      };
      try { window.track && window.track("popup_opened", props); } catch (_) { /* ignore */ }
    },
  );
} catch (e) { /* ignore */ }

// ── Light Font & Privacy Mode toggles ────────────────────────────────────────
["privacyMode"].forEach((key) => {
  const cb = document.getElementById(key);
  chrome.storage.local.get([key], (r) => { cb.checked = !!r[key]; });
  cb.addEventListener("change", () => {
    chrome.storage.local.set({ [key]: cb.checked });
    if (key === "privacyMode") {
      try {
        window.track("privacy_mode_toggled", { enabled: cb.checked });
      } catch (e) { /* ignore */ }
    }
  });
});

document.getElementById("report-bug").addEventListener("click", () => {
  try { window.track("external_link_clicked", { target: "report_bug" }); } catch (e) { /* ignore */ }
  window.open("https://forms.gle/U7jteYT8hpM19pWZA", "_blank");
});

document.getElementById("feature-request").addEventListener("click", () => {
  try { window.track("external_link_clicked", { target: "feature_request" }); } catch (e) { /* ignore */ }
  window.open("https://forms.gle/9Svkf6pVknArjamz9", "_blank");
});

const settingsBtn = document.getElementById("open-settings");
if (settingsBtn) {
  settingsBtn.addEventListener("click", () => {
    try {
      if (window.track) window.track("settings_gear_clicked");
    } catch (_) { /* ignore */ }
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL("options.html"), "_blank");
    }
  });
}
