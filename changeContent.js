// Accept only `data:` URLs. WhatsApp Web's CSP blocks external image
// origins in `background-image: url(...)`, so cross-origin URLs would
// silently fail to render. The popup converts every selection to a data
// URL before storing — this guard rejects anything that still slipped
// through (e.g. slot values from pre-fix installs).
function isUsableSrc(src) {
  return typeof src === "string" && src.startsWith("data:");
}

function customThemes() {
  console.log("Starting custom themes...");

  const interval = setInterval(() => {
    const paneSide = document.getElementById("pane-side");
    const main = document.getElementById("main");
    const parent = document.querySelector('div[tabindex="-1"][class^="two"]');
    const grid = document.querySelector('div[role="grid"]');
    const headerEl = document.querySelector("header[tabindex='0']");

    if (headerEl) {
      chrome.storage.local.get(["navside"], (result) => {
        // Theme slots must always hold a `data:` URL by the time we read
        // them (the popup converts remote URLs on save). Anything else is
        // dropped so WhatsApp Web's CSP can't block the background load.
        const navsideImage = isUsableSrc(result.navside) ? result.navside : null;

        if (navsideImage) {
          headerEl.style.backgroundImage = `url('${navsideImage}')`;
          headerEl.style.backgroundSize = "cover";
          headerEl.style.backgroundPosition = "center";
        }
      });
    }

    if ((paneSide || grid) && (main || parent)) {
      // ── Chat List Styling (FIXED VERSION – no layout break) ──
      let style = document.getElementById("wa-chat-style");
      if (!style) {
        style = document.createElement("style");
        style.id = "wa-chat-style";
        document.head.appendChild(style);
      }

      style.innerHTML = `
/* Chat container (leichtes Glass-Design) */
#pane-side [role="row"] > div {
    background: rgba(0, 0, 0, 0.25);
    border-radius: 10px;
    transition: background 0.15s ease;
}

/* Hover */
#pane-side [role="row"]:hover > div {
    background: rgba(255, 255, 255, 0.1);
}

/* Aktiver Chat */
#pane-side [aria-selected="true"] > div {
    background: rgba(255, 255, 255, 0.2) !important;
}

/* Name */
#pane-side span[title] {
    color: white !important;
    font-weight: 500 !important;
}

/* Vorschau */
#pane-side span[dir="auto"] {
    color: rgba(255,255,255,0.8) !important;
    font-weight: 400 !important;
}
`;
      // Lade gespeicherte Bilder
      chrome.storage.local.get(["welcome", "chatview", "sidenav"], (result) => {
        const welcomeImage = isUsableSrc(result.welcome) ? result.welcome : null;
        const chatviewImage = isUsableSrc(result.chatview) ? result.chatview : null;
        const sidenavImage = isUsableSrc(result.sidenav) ? result.sidenav : null;

        // PaneSide / Sidenav
        if (paneSide && sidenavImage) {
          paneSide.style.backgroundImage = `url('${sidenavImage}')`;
          paneSide.style.backgroundSize = "cover";
          paneSide.style.backgroundPosition = "center";
        }

        // Main / Chatview
        if (main && chatviewImage) {
          const chatBg = document.querySelector(
            "[data-asset-chat-background-dark], [data-asset-chat-background-light]",
          );

          if (chatBg) {
            chatBg.style.backgroundImage = "none";
          }

          main.style.backgroundImage = `url('${chatviewImage}')`;
          main.style.backgroundSize = "cover";
          main.style.backgroundPosition = "center";
        }

        // Welcome Page
        // Alle div-Elemente im Dokument holen
        const divs = document.querySelectorAll("div");
        let colgonResult = null;

        // Passendes div suchen (3 Buttons, 1 Klasse)
        divs.forEach((div) => {
          if (div.classList.length !== 1) return;
          const children = div.children;
          if (children.length !== 3) return;
          const allButtons = Array.from(children).every(
            (child) => child.tagName === "BUTTON",
          );
          if (allButtons) colgonResult = div;
        });

        if (colgonResult) {
          const parent = colgonResult.parentElement;

          if (parent && parent.tagName === "SECTION") {
            // 1. Hintergrundbild auf die Section setzen
            parent.style.backgroundImage = `url("${welcomeImage}")`;
            parent.style.backgroundSize = "cover";
            parent.style.backgroundPosition = "center";
            parent.style.backgroundRepeat = "no-repeat";

            // 2. Section-Layout für die Texte vorbereiten
            parent.style.position = "relative";
            parent.style.display = "flex";
            parent.style.flexDirection = "column";
            parent.style.alignItems = "center";
            parent.style.justifyContent = "center";
            parent.style.textAlign = "center";

            // 3. Überprüfung: Existieren die Texte schon?
            if (!document.getElementById("custom-welcome-title")) {
              // H1 Text direkt in die Section einfügen
              const h1 = document.createElement("h1");
              h1.id = "custom-welcome-title"; // Eindeutige ID vergeben
              h1.textContent = "Welcome To WhatsApp Web";
              h1.style.color = "white";
              h1.style.fontSize = "36px";
              h1.style.fontWeight = "bold";
              h1.style.textShadow = "2px 2px 8px rgba(0,0,0,0.7)";
              h1.style.zIndex = "10";
              h1.style.margin = "0";
              parent.appendChild(h1);

              // H2 Text direkt darunter einfügen
              const h2 = document.createElement("h2");
              h2.id = "custom-welcome-subtitle"; // Eindeutige ID vergeben
              h2.textContent = "Thanks for using WhatsApp Web Customizer!";
              h2.style.color = "rgba(255, 255, 255, 0.9)";
              h2.style.fontSize = "20px";
              h2.style.fontWeight = "400";
              h2.style.textShadow = "1px 1px 5px rgba(0,0,0,0.7)";
              h2.style.zIndex = "10";
              h2.style.marginTop = "10px";
              parent.appendChild(h2);

              console.log("Texte wurden neu erstellt.");
            } else {
              console.log("Texte existieren bereits – kein Duplikat erstellt.");
            }
          }
        }
      });
    }
    console.log("Making header transparent");
    // Select the header
    const header = document.querySelector("div#main > header");

    if (header) {
      // Set the text color to white (important)
      header.style.setProperty("color", "white", "important");

      // Make the background transparent without affecting children
      header.style.background = "none";
    }
  }, 500);
}
customThemes();
