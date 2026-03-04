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
        // Falls lokale Datei in Extension, nutze chrome.runtime.getURL
        const getImageURL = (src) =>
          src && src.startsWith("images/") ? chrome.runtime.getURL(src) : src;

        // result.navside ist der gespeicherte Bildpfad/URL
        const navsideImage = getImageURL(result.navside);

        if (navsideImage) {
          headerEl.style.backgroundImage = `url('${navsideImage}')`;
          headerEl.style.backgroundSize = "cover";
          headerEl.style.backgroundPosition = "center";
        }
      });
    }

    if ((paneSide || grid) && (main || parent)) {
      // Lade gespeicherte Bilder
      chrome.storage.local.get(["welcome", "chatview", "sidenav"], (result) => {
        // Falls lokale Datei in Extension, nutze chrome.runtime.getURL
        const getImageURL = (src) =>
          src && src.startsWith("images/") ? chrome.runtime.getURL(src) : src;

        const welcomeImage = getImageURL(result.welcome);
        const chatviewImage = getImageURL(result.chatview);
        const sidenavImage = getImageURL(result.sidenav);

        // PaneSide / Sidenav
        if (paneSide && sidenavImage) {
          paneSide.style.backgroundImage = `url('${sidenavImage}')`;
          paneSide.style.backgroundSize = "cover";
          paneSide.style.backgroundPosition = "center";
        }

        // Main / Chatview
        if (main && chatviewImage) {
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

        // Chat list items
        if (grid) {
          Array.from(grid.children).forEach((child) => {
            const innerChild =
              child?.children?.[0]?.children?.[0]?.children?.[0];
            if (innerChild) {
              // Nur den Hintergrund leicht transparent machen
              innerChild.style.backgroundColor = "rgba(255, 255, 255, 0.7)";
              innerChild.style.border = "2px solid black";
              innerChild.style.borderRadius = "20px";

              // Funktion, um rekursiv alle Textelemente auf schwarz + bold zu setzen
              function setTextBlackBold(element) {
                // Prüfen, ob es ein sichtbarer Text ist
                if (element.nodeType === Node.ELEMENT_NODE) {
                  element.style.setProperty("color", "black", "important");
                  element.style.fontWeight = "bold";
                  element.style.fontSize = "1.2rem";
                  Array.from(element.children).forEach(setTextBlackBold);
                }
              }

              setTextBlackBold(innerChild);
            }
          });
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

    // const topload = document.querySelector("div#side>div._ak9t");
    // if (topload) {
    //   topload.style.background = "red"; // fully transparent
    // }

    // const offload = document.querySelector(
    //   "div#side>div[tabindex='-1'][role='tablist']"
    // );
    // if (offload) {
    //   offload.style.background = "none"; // fully transparent
    // }
  }, 500);
}
customThemes();
