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
        const divs = document.querySelectorAll('div');
        let colgonResult = null;

        divs.forEach(div => {
            if (div.classList.length !== 1) return;
            const children = div.children;
            if (children.length !== 3) return;
            const allButtons = Array.from(children).every(child => child.tagName === "BUTTON");
            if (allButtons) colgonResult = div;
        });

        if (colgonResult) {
            const parent = colgonResult.parentElement;

            if (parent && parent.tagName === "SECTION") {
                // 1. Hintergrund setzen (Dein gewünschtes Bild statt SVG)
                parent.style.backgroundImage = `url("${welcomeImage}")`;
                parent.style.backgroundSize = "cover";
                parent.style.backgroundPosition = "center";
                parent.style.backgroundRepeat = "no-repeat";

                // 2. Inhalt im 5. Kind-Element (Index 4) anpassen
                const child = parent.children[4];
                if (child) {
                    // SVG entfernen/ersetzen (wird hier entfernt, da wir den Hintergrund nutzen)
                    const existingSvg = child.querySelector("svg");
                    if (existingSvg) existingSvg.remove();

                    // H1 anpassen oder erstellen
                    let header = child.querySelector("h1");
                    if (!header) {
                        header = document.createElement("h1");
                        child.prepend(header);
                    }
                    header.textContent = "Welcome To WhatsApp Web";
                    header.style.color = "white"; // Optional für bessere Lesbarkeit

                    // H2 erstellen (unter dem H1)
                    let subHeader = child.querySelector("h2");
                    if (!subHeader) {
                        subHeader = document.createElement("h2");
                        header.after(subHeader);
                    }
                    subHeader.textContent = "Thanks for using WhatsApp Web Customizer!";
                    subHeader.style.color = "white"; // Optional

                    // Alten Paragraphen und Download-Button entfernen
                    const paragraph = child.querySelector(".x14mdic9");
                    if (paragraph) paragraph.remove();

                    const download = child.querySelector(".x1ci5j9l.x78zum5.xl56j7k");
                    if (download) download.remove();
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