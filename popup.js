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

function saveAndApplyOptions() {
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
  document.getElementById(id).addEventListener("change", saveAndApplyOptions);
});

loadOptions();

// ── Color Selection ───────────────────────────────────────────────────────────
const colorInInput  = document.getElementById("colorIn");
const colorOutInput = document.getElementById("colorOut");

// Load saved colors into the pickers on popup open
chrome.storage.local.get(["colorIn", "colorOut"], (result) => {
  if (result.colorIn)  colorInInput.value  = result.colorIn;
  if (result.colorOut) colorOutInput.value = result.colorOut;
});

// Save whenever the user picks a new color — changeColor.js reacts via onChanged
colorInInput.addEventListener("input", (e) => {
  chrome.storage.local.set({ colorIn: e.target.value });
});
colorOutInput.addEventListener("input", (e) => {
  chrome.storage.local.set({ colorOut: e.target.value });
});

// Preset buttons — each sets both channels to a themed pair
document.getElementById("discoButton").addEventListener("click", () => {
  chrome.storage.local.set({ colorIn: "#ff00ff", colorOut: "#00ffff" }, () => {
    colorInInput.value  = "#ff00ff";
    colorOutInput.value = "#00ffff";
  });
});

document.getElementById("discoButton2").addEventListener("click", () => {
  chrome.storage.local.set({ colorIn: "#ff0000", colorOut: "#00ff00" }, () => {
    colorInInput.value  = "#ff0000";
    colorOutInput.value = "#00ff00";
  });
});

document.getElementById("discoButton3").addEventListener("click", () => {
  // Reset to defaults
  chrome.storage.local.set({ colorIn: "#00aaff", colorOut: "#00ff88" }, () => {
    colorInInput.value  = "#00aaff";
    colorOutInput.value = "#00ff88";
  });
});

// ── Light Font & Privacy Mode toggles ────────────────────────────────────────
["lightFont", "privacyMode"].forEach((key) => {
  const cb = document.getElementById(key);
  chrome.storage.local.get([key], (r) => { cb.checked = !!r[key]; });
  cb.addEventListener("change", () => chrome.storage.local.set({ [key]: cb.checked }));
});

document.getElementById("report-bug").addEventListener("click", () => {
  window.open("https://forms.gle/U7jteYT8hpM19pWZA", "_blank");
});

document.getElementById("feature-request").addEventListener("click", () => {
  window.open("https://forms.gle/9Svkf6pVknArjamz9", "_blank");
});