// popup.js (minor adjustments for consistency and to ensure immediate apply)
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
      status: false, // Changed default to false (hidden) as per your description
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

  // Save to storage
  chrome.storage.local.set({ visibilityOptions: options }, () => {
    // Send message to content script to apply changes
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

  // Handle Locked Chats and Archived
  const paneSide = document.getElementById("pane-side");
  if (paneSide) {
    const lockedChats = paneSide.querySelector(
      "button[aria-label='Locked chats']"
    );
    const archived = paneSide.querySelector("button[aria-label='Archived ']");

    if (lockedChats) {
      lockedChats.style.display = options.lockedChats ? "block" : "none";
    }

    if (archived) {
      archived.style.display = options.archived ? "block" : "none";
    }
  }
}

// Hook up listeners
checkboxIds.forEach((id) => {
  document.getElementById(id).addEventListener("change", saveAndApplyOptions);
});

loadOptions();
// Color Input auswählen
const colorInput = document.querySelector("input[type='color']");

if (colorInput) {
  // 1️⃣ Gespeicherte Farbe beim Laden des Popups setzen
  chrome.storage.local.get(["color"], (result) => {
    if (result.color) {
      colorInput.value = result.color;
      console.log("Gespeicherte Farbe geladen:", result.color);
    }
  });

  // 2️⃣ Beim Ändern des Inputs den Wert speichern
  colorInput.addEventListener("input", (e) => {
    const selectedColor = e.target.value; // z. B. "#ff0000"

    // In chrome.storage.local unter "color" speichern
    chrome.storage.local.set({ color: selectedColor }, () => {
      console.log("Farbe gespeichert:", selectedColor);
    });
  });
}
document.getElementById("discoButton").addEventListener("click", function () {
  // Disco-Farben als Array
  const discoColors = ["#ff00ff", "#00ffff", "#ff00ff"];

  // In chrome.storage.local speichern
  chrome.storage.local.set({ color: discoColors }, () => {
    console.log("Disco-Farben gespeichert:", discoColors);

    // Optional: direkt das Color Input auf die erste Farbe setzen
    const colorInput = document.querySelector("input[type='color']");
    if (colorInput) colorInput.value = discoColors[0];
  });
});

document.getElementById("discoButton2").addEventListener("click", function () {
  // Neue Disco-Farben als Array
  const discoColors = ["#ff0000", "#00ff00", "#0000ff"]; // Rot, Grün, Blau

  // In chrome.storage.local speichern
  chrome.storage.local.set({ color: discoColors }, () => {
    console.log("Disco-Farben gespeichert:", discoColors);

    // Optional: direkt das Color Input auf die erste Farbe setzen
    const colorInput = document.querySelector("input[type='color']");
    if (colorInput) colorInput.value = discoColors[0];
  });
});

document.getElementById("discoButton3").addEventListener("click", function () {
  // Farben leeren
  const emptyColors = [];

  // In chrome.storage.local speichern
  chrome.storage.local.set({ color: emptyColors }, () => {
    console.log("Farben geleert");

    // Color Input zurücksetzen (optional auf Standardwert #000000)
    const colorInput = document.querySelector("input[type='color']");
    if (colorInput) colorInput.value = "#000000";
  });
});

document
      .getElementById("report-bug")
      .addEventListener("click", () => {
        window.open("https://forms.gle/U7jteYT8hpM19pWZA", "_blank");
      });

      document
      .getElementById("feature-request")
      .addEventListener("click", () => {
        window.open("https://forms.gle/9Svkf6pVknArjamz9", "_blank");
      });
