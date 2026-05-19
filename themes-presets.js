// Preset themes ported byte-for-byte from Whatsapp-Web-Designer
// (popup/bundle.js + content_scripts/bundle.js). Each preset is the
// pairing { user-facing display name, exact CSS-variable map } that
// Designer ships, so applying any of these in the Customizer produces
// the identical look users see in Designer.
//
// The `id` is internal-only and matches Designer's codenames so values
// remain auditable against the source. Display names are what the user
// sees in the popup and manage page.
//
// Engine: themes-overrides.css (copied from Designer) targets WhatsApp's
// atomic class names against these CSS variables. themes-content.js
// applies a theme by writing the variables onto document.documentElement.
//
// Loaded by:
//   - popup       (themes.js)
//   - manage page (themes-manage.js)
//   - content     (themes-content.js)

(function () {
  // Canonical key list — themes-content.js iterates this to clear the inline
  // styles when switching themes off, themes-manage.js uses it for validation.
  const VAR_KEYS = [
    "--hyperlink-text",
    "--important-text",
    "--writing-text",
    "--read-by",
    "--message-incoming",
    "--message-outgoing",
    "--wait-color-big",
    "--wait-color-side",
    "--wait-side-chat-items",
    "--wait-side-chat-items-reverse",
    "--wait-side-chat-items-to-top",
    "--main-bg-constant",
    "--main-bg-to-top",
    "--main-bg-to-bottom",
    "--main-bg-to-positive-angle",
    "--main-bg-to-negative-angle",
    "--scrollbar-track-color"
  ];

  // Order: ranked by unique-user adoption from a 7-day PostHog window
  // (event `theme_applied`, source = "preset"). Manual ordering — do not
  // re-sort. Add new presets at the position the next data refresh implies.
  const PRESETS = [
    // Habiba → Red
    {
      id: "preset-red",
      name: "Red",
      source: "preset",
      vars: {
        "--hyperlink-text":               "rgba(0, 255, 255, 1)",
        "--important-text":               "rgba(253, 255, 189, 0.83)",
        "--main-bg-constant":             "rgba(155, 23, 23, 0.34)",
        "--main-bg-to-bottom":            "linear-gradient(to bottom, rgba(155, 23, 23, 0.34), rgba(146, 22, 22, 0.34))",
        "--main-bg-to-negative-angle":    "linear-gradient(45deg, rgba(155, 23, 23, 0.34), rgba(146, 22, 22, 0.34))",
        "--main-bg-to-positive-angle":    "linear-gradient(45deg, rgba(155, 23, 23, 0.34), rgba(146, 22, 22, 0.34))",
        "--main-bg-to-top":               "linear-gradient(to top, rgba(155, 23, 23, 0.34), rgba(146, 22, 22, 0.34))",
        "--message-incoming":             "rgba(145, 18, 39, 0.8)",
        "--message-outgoing":             "rgba(156, 79, 86, 0.8)",
        "--read-by":                      "rgba(0, 255, 255, 1)",
        "--scrollbar-track-color":        "rgba(215, 205, 149, 0.34)",
        "--wait-color-big":               "linear-gradient(45deg, rgba(108, 20, 20, 0.87), rgba(108, 20, 20, 0.86), rgba(108, 20, 20, 0.87))",
        "--wait-color-side":              "linear-gradient(45deg, rgba(108, 20, 20, 0.87), rgba(108, 20, 20, 0.86))",
        "--wait-side-chat-items":         "linear-gradient(45deg, rgba(95, 21, 21, 0.83), rgba(95, 21, 21, 0.79))",
        "--wait-side-chat-items-reverse": "linear-gradient(45deg, rgba(95, 21, 21, 0.79), rgba(95, 21, 21, 0.83))",
        "--wait-side-chat-items-to-top":  "linear-gradient(to top, rgba(95, 21, 21, 0.83), rgba(95, 21, 21, 0.79))",
        "--writing-text":                 "rgba(193, 239, 240, 1)"
      }
    },
    // Annan → Blue
    {
      id: "preset-blue",
      name: "Blue",
      source: "preset",
      vars: {
        "--hyperlink-text":               "rgba(252, 206, 76, 1)",
        "--important-text":               "rgba(11, 249, 166, 0.83)",
        "--main-bg-constant":             "rgba(25, 44, 87, 0.81)",
        "--main-bg-to-bottom":            "linear-gradient(to bottom, rgba(25, 44, 87, 0.81), rgba(17, 39, 90, 0.81))",
        "--main-bg-to-negative-angle":    "linear-gradient(45deg, rgba(25, 44, 87, 0.81), rgba(17, 39, 90, 0.81))",
        "--main-bg-to-positive-angle":    "linear-gradient(45deg, rgba(25, 44, 87, 0.81), rgba(17, 39, 90, 0.81))",
        "--main-bg-to-top":               "linear-gradient(to top, rgba(25, 44, 87, 0.81), rgba(17, 39, 90, 0.81))",
        "--message-incoming":             "rgba(10, 71, 97, 0.8)",
        "--message-outgoing":             "rgba(79, 10, 148, 0.8)",
        "--read-by":                      "rgb(0, 255, 255)",
        "--scrollbar-track-color":        "rgba(86, 11, 226, 0.6)",
        "--wait-color-big":               "linear-gradient(45deg, rgba(12, 46, 100, 0.83), rgba(10, 43, 97, 0.83), rgba(12, 46, 100, 0.83))",
        "--wait-color-side":              "linear-gradient(45deg, rgba(12, 46, 100, 0.83), rgba(10, 43, 97, 0.83))",
        "--wait-side-chat-items":         "linear-gradient(45deg, rgba(12, 34, 85, 0.83), rgba(10, 33, 87, 0.83))",
        "--wait-side-chat-items-reverse": "linear-gradient(45deg, rgba(10, 33, 87, 0.83), rgba(12, 34, 85, 0.83))",
        "--wait-side-chat-items-to-top":  "linear-gradient(to top, rgba(12, 34, 85, 0.83), rgba(10, 33, 87, 0.83))",
        "--writing-text":                 "rgba(223, 183, 170, 1)"
      }
    },
    // RawanTamer → Green
    {
      id: "preset-green",
      name: "Green",
      source: "preset",
      vars: {
        "--hyperlink-text":               "rgba(248, 241, 197, 1)",
        "--important-text":               "rgba(245, 118, 0, 0.89)",
        "--main-bg-constant":             "rgba(42, 102, 41, 0.59)",
        "--main-bg-to-bottom":            "linear-gradient(to bottom, rgba(42, 102, 41, 0.59), rgba(45, 102, 41, 0.59))",
        "--main-bg-to-negative-angle":    "linear-gradient(45deg, rgba(42, 102, 41, 0.59), rgba(45, 102, 41, 0.59))",
        "--main-bg-to-positive-angle":    "linear-gradient(45deg, rgba(42, 102, 41, 0.59), rgba(45, 102, 41, 0.59))",
        "--main-bg-to-top":               "linear-gradient(to top, rgba(42, 102, 41, 0.59), rgba(45, 102, 41, 0.59))",
        "--message-incoming":             "rgba(60, 66, 54, 0.8)",
        "--message-outgoing":             "rgba(50, 143, 116, 0.8)",
        "--read-by":                      "rgba(0, 250, 17, 1)",
        "--scrollbar-track-color":        "rgba(40, 226, 11, 0.6)",
        "--wait-color-big":               "linear-gradient(45deg, rgba(15, 62, 31, 0.83), rgba(15, 62, 31, 0.83), rgba(15, 62, 31, 0.83))",
        "--wait-color-side":              "linear-gradient(45deg, rgba(15, 62, 31, 0.83), rgba(15, 62, 31, 0.83))",
        "--wait-side-chat-items":         "linear-gradient(45deg, rgba(16, 56, 10, 0.83), rgba(15, 51, 10, 0.83))",
        "--wait-side-chat-items-reverse": "linear-gradient(45deg, rgba(15, 51, 10, 0.83), rgba(16, 56, 10, 0.83))",
        "--wait-side-chat-items-to-top":  "linear-gradient(to top, rgba(16, 56, 10, 0.83), rgba(15, 51, 10, 0.83))",
        "--writing-text":                 "rgba(230, 245, 179, 1)"
      }
    },
    // JohanLiebert → Monster
    {
      id: "preset-monster",
      name: "Monster",
      source: "preset",
      vars: {
        "--hyperlink-text":               "rgba(255, 225, 120, 1)",
        "--important-text":               "rgba(255, 200, 100, 0.8)",
        "--main-bg-constant":             "rgba(15, 15, 15, 1)",
        "--main-bg-to-bottom":            "linear-gradient(to bottom, rgba(15, 15, 15, 1), rgba(10, 10, 10, 1))",
        "--main-bg-to-negative-angle":    "linear-gradient(45deg, rgba(15, 15, 15, 1), rgba(10, 10, 10, 1))",
        "--main-bg-to-positive-angle":    "linear-gradient(45deg, rgba(15, 15, 15, 1), rgba(10, 10, 10, 1))",
        "--main-bg-to-top":               "linear-gradient(to top, rgba(15, 15, 15, 1), rgba(10, 10, 10, 1))",
        "--message-incoming":             "rgba(40, 40, 40, 0.85)",
        "--message-outgoing":             "rgba(125, 40, 40, 0.85)",
        "--read-by":                      "rgb(0, 255, 255)",
        "--scrollbar-track-color":        "rgba(20, 20, 20, 0.8)",
        "--wait-color-big":               "linear-gradient(45deg, rgba(15, 15, 15, 1), rgba(10, 10, 10, 1), rgba(15, 15, 15, 1))",
        "--wait-color-side":              "linear-gradient(45deg, rgba(15, 15, 15, 1), rgba(10, 10, 10, 1))",
        "--wait-side-chat-items":         "linear-gradient(45deg, rgba(30, 30, 30, 0.8), rgba(20, 20, 20, 0.8))",
        "--wait-side-chat-items-reverse": "linear-gradient(45deg, rgba(20, 20, 20, 0.8), rgba(30, 30, 30, 0.8))",
        "--wait-side-chat-items-to-top":  "linear-gradient(to top, rgba(30, 30, 30, 0.8), rgba(20, 20, 20, 0.8))",
        "--writing-text":                 "rgba(250, 250, 250, 1)"
      }
    },
    // Lain → DigitalVoid
    {
      id: "preset-digital-void",
      name: "Digital Void",
      source: "preset",
      vars: {
        "--hyperlink-text":               "rgba(0, 200, 255, 1)",
        "--important-text":               "rgba(0, 200, 255, 0.8)",
        "--main-bg-constant":             "rgba(31, 31, 31, 1)",
        "--main-bg-to-bottom":            "linear-gradient(to bottom, rgba(31, 31, 31, 1), rgba(15, 15, 15, 1))",
        "--main-bg-to-negative-angle":    "linear-gradient(45deg, rgba(31, 31, 31, 1), rgba(15, 15, 15, 1))",
        "--main-bg-to-positive-angle":    "linear-gradient(45deg, rgba(31, 31, 31, 1), rgba(15, 15, 15, 1))",
        "--main-bg-to-top":               "linear-gradient(to top, rgba(31, 31, 31, 1), rgba(15, 15, 15, 1))",
        "--message-incoming":             "rgba(82, 82, 82, 0.87)",
        "--message-outgoing":             "rgba(40, 90, 128, 0.8)",
        "--read-by":                      "rgba(0, 200, 255, 1)",
        "--scrollbar-track-color":        "rgba(10, 10, 10, 0.8)",
        "--wait-color-big":               "linear-gradient(45deg, rgba(31, 31, 31, 1), rgba(15, 15, 15, 1), rgba(31, 31, 31, 1))",
        "--wait-color-side":              "linear-gradient(45deg, rgba(31, 31, 31, 1), rgba(15, 15, 15, 1))",
        "--wait-side-chat-items":         "linear-gradient(45deg, rgba(31, 31, 3, 0.74), rgba(31, 31, 15, 0.74))",
        "--wait-side-chat-items-reverse": "linear-gradient(45deg, rgba(31, 31, 15, 0.74), rgba(31, 31, 3, 0.74))",
        "--wait-side-chat-items-to-top":  "linear-gradient(to top, rgba(31, 31, 3, 0.74), rgba(31, 31, 15, 0.74))",
        "--writing-text":                 "rgba(240, 240, 240, 1)"
      }
    },
    // DrAsmaaZaki → Purple
    {
      id: "preset-purple",
      name: "Purple",
      source: "preset",
      vars: {
        "--hyperlink-text":               "rgba(43, 235, 0, 1)",
        "--important-text":               "rgba(255, 159, 41, 0.83)",
        "--main-bg-constant":             "rgba(73, 28, 109, 0.59)",
        "--main-bg-to-bottom":            "linear-gradient(to bottom, rgba(73, 28, 109, 0.59), rgba(70, 27, 106, 0.59))",
        "--main-bg-to-negative-angle":    "linear-gradient(45deg, rgba(73, 28, 109, 0.59), rgba(70, 27, 106, 0.59))",
        "--main-bg-to-positive-angle":    "linear-gradient(45deg, rgba(73, 28, 109, 0.59), rgba(70, 27, 106, 0.59))",
        "--main-bg-to-top":               "linear-gradient(to top, rgba(73, 28, 109, 0.59), rgba(70, 27, 106, 0.59))",
        "--message-incoming":             "rgba(81, 22, 121, 0.8)",
        "--message-outgoing":             "rgba(98, 30, 200, 0.8)",
        "--read-by":                      "rgba(0, 224, 4, 1)",
        "--scrollbar-track-color":        "rgba(160, 0, 235, 0.6)",
        "--wait-color-big":               "linear-gradient(45deg, rgba(72, 26, 96, 0.83), rgba(69, 25, 92, 0.83), rgba(72, 26, 96, 0.83))",
        "--wait-color-side":              "linear-gradient(45deg, rgba(72, 26, 96, 0.83), rgba(69, 25, 92, 0.83))",
        "--wait-side-chat-items":         "linear-gradient(45deg, rgba(54, 12, 70, 0.83), rgba(58, 13, 74, 0.83))",
        "--wait-side-chat-items-reverse": "linear-gradient(45deg, rgba(58, 13, 74, 0.83), rgba(54, 12, 70, 0.83))",
        "--wait-side-chat-items-to-top":  "linear-gradient(to top, rgba(54, 12, 70, 0.83), rgba(58, 13, 74, 0.83))",
        "--writing-text":                 "rgba(252, 252, 252, 1)"
      }
    },
    // PASWG → Racy Whimsy
    {
      id: "preset-racy-whimsy",
      name: "Racy Whimsy",
      source: "preset",
      vars: {
        "--hyperlink-text":               "rgb(216, 255, 107)",
        "--important-text":               "rgba(255, 105, 180, 0.8)",
        "--main-bg-constant":             "rgba(0, 0, 0, 1)",
        "--main-bg-to-bottom":            "linear-gradient(to bottom, rgba(0, 0, 0, 1), rgba(20, 20, 20, 1))",
        "--main-bg-to-negative-angle":    "linear-gradient(45deg, rgba(0, 0, 0, 1), rgba(20, 20, 20, 1))",
        "--main-bg-to-positive-angle":    "linear-gradient(45deg, rgba(0, 0, 0, 1), rgba(20, 20, 20, 1))",
        "--main-bg-to-top":               "linear-gradient(to top, rgba(0, 0, 0, 1), rgba(20, 20, 20, 1))",
        "--message-incoming":             "rgba(206, 34, 103, 0.8)",
        "--message-outgoing":             "rgba(230, 71, 140, 0.8)",
        "--read-by":                      "rgba(255, 105, 180, 1)",
        "--scrollbar-track-color":        "rgba(20, 20, 20, 0.8)",
        "--wait-color-big":               "linear-gradient(45deg, rgb(0, 0, 0), rgb(20, 20, 20), rgb(0, 0, 0))",
        "--wait-color-side":              "linear-gradient(45deg, rgb(0, 0, 0), rgb(20, 20, 20))",
        "--wait-side-chat-items":         "linear-gradient(45deg, rgba(0, 0, 0, 1), rgba(20, 20, 20, 1))",
        "--wait-side-chat-items-reverse": "linear-gradient(45deg, rgba(20, 20, 20, 1), rgba(0, 0, 0, 1))",
        "--wait-side-chat-items-to-top":  "linear-gradient(to top, rgba(0, 0, 0, 1), rgba(20, 20, 20, 1))",
        "--writing-text":                 "rgba(250, 250, 250, 1)"
      }
    },
    // Yuri → Frostbite
    {
      id: "preset-frostbite",
      name: "Frostbite",
      source: "preset",
      vars: {
        "--hyperlink-text":               "rgba(70,130,180,1)",
        "--important-text":               "rgba(176,196,222,1)",
        "--main-bg-constant":             "rgba(119,136,153,0.8)",
        "--main-bg-to-bottom":            "linear-gradient(to bottom, rgba(119,136,153,0.8), rgba(70,130,180,0.8))",
        "--main-bg-to-negative-angle":    "linear-gradient(45deg, rgba(119,136,153,0.8), rgba(70,130,180,0.8))",
        "--main-bg-to-positive-angle":    "linear-gradient(45deg, rgba(119,136,153,0.8), rgba(70,130,180,0.8))",
        "--main-bg-to-top":               "linear-gradient(to top, rgba(119,136,153,0.8), rgba(70,130,180,0.8))",
        "--message-incoming":             "rgba(70,130,180,0.8)",
        "--message-outgoing":             "rgba(176,196,222,0.8)",
        "--read-by":                      "rgba(70,130,180,1)",
        "--scrollbar-track-color":        "rgba(119,136,153,0.6)",
        "--wait-color-big":               "linear-gradient(45deg, rgba(70,130,180,0.8), rgba(176,196,222,0.8), rgba(70,130,180,0.8))",
        "--wait-color-side":              "linear-gradient(45deg, rgba(70,130,180,0.8), rgba(176,196,222,0.8))",
        "--wait-side-chat-items":         "linear-gradient(45deg, rgba(60,110,160,0.8), rgba(70,130,180,0.8))",
        "--wait-side-chat-items-reverse": "linear-gradient(45deg, rgba(70,130,180,0.8), rgba(60,110,160,0.8))",
        "--wait-side-chat-items-to-top":  "linear-gradient(to top, rgba(60,110,160,0.8), rgba(70,130,180,0.8))",
        "--writing-text":                 "rgba(250,250,250,1)"
      }
    },
    // Yunru → Revolt
    {
      id: "preset-revolt",
      name: "Revolt",
      source: "preset",
      vars: {
        "--hyperlink-text":               "rgba(0, 221, 250, 0.93)",
        "--important-text":               "rgba(237, 156, 44, 0.9)",
        "--main-bg-constant":             "rgba(2, 23, 22, 0.73)",
        "--main-bg-to-bottom":            "linear-gradient(to bottom, rgba(2, 23, 22, 0.73), rgba(2, 23, 22, 0.74))",
        "--main-bg-to-negative-angle":    "linear-gradient(45deg, rgba(2, 23, 22, 0.73), rgba(2, 23, 22, 0.74))",
        "--main-bg-to-positive-angle":    "linear-gradient(45deg, rgba(2, 23, 22, 0.73), rgba(2, 23, 22, 0.74))",
        "--main-bg-to-top":               "linear-gradient(to top, rgba(2, 23, 22, 0.73), rgba(2, 23, 22, 0.74))",
        "--message-incoming":             "rgba(31, 51, 55, 0.85)",
        "--message-outgoing":             "rgba(52, 85, 85, 0.85)",
        "--read-by":                      "rgb(0, 255, 255)",
        "--scrollbar-track-color":        "rgba(219, 219, 219, 0.8)",
        "--wait-color-big":               "linear-gradient(45deg, rgba(13, 23, 23, 0.82), rgba(15, 26, 26, 0.82), rgba(13, 23, 23, 0.82))",
        "--wait-color-side":              "linear-gradient(45deg, rgba(13, 23, 23, 0.82), rgba(15, 26, 26, 0.82))",
        "--wait-side-chat-items":         "linear-gradient(45deg, rgba(19, 31, 37, 0.8), rgba(16, 29, 35, 0.8))",
        "--wait-side-chat-items-reverse": "linear-gradient(45deg, rgba(16, 29, 35, 0.8), rgba(19, 31, 37, 0.8))",
        "--wait-side-chat-items-to-top":  "linear-gradient(to top, rgba(19, 31, 37, 0.8), rgba(16, 29, 35, 0.8))",
        "--writing-text":                 "rgb(248, 236, 254)"
      }
    },
    // Raghad → Chill
    {
      id: "preset-chill",
      name: "Chill",
      source: "preset",
      vars: {
        "--hyperlink-text":               "rgba(253, 211, 201, 0.87)",
        "--important-text":               "rgba(242, 231, 156, 0.88)",
        "--main-bg-constant":             "rgba(126, 88, 58, 0.81)",
        "--main-bg-to-bottom":            "linear-gradient(to bottom, rgba(126, 88, 58, 0.81), rgba(126, 88, 58, 0.81))",
        "--main-bg-to-negative-angle":    "linear-gradient(45deg, rgba(126, 88, 58, 0.81), rgba(126, 88, 58, 0.81))",
        "--main-bg-to-positive-angle":    "linear-gradient(45deg, rgba(126, 88, 58, 0.81), rgba(126, 88, 58, 0.81))",
        "--main-bg-to-top":               "linear-gradient(to top, rgba(126, 88, 58, 0.81), rgba(126, 88, 58, 0.81))",
        "--message-incoming":             "rgba(114, 96, 75, 0.8)",
        "--message-outgoing":             "rgba(125, 79, 44, 0.8)",
        "--read-by":                      "rgba(22, 250, 254, 1)",
        "--scrollbar-track-color":        "rgba(240, 228, 215, 0.6)",
        "--wait-color-big":               "linear-gradient(45deg, rgba(84, 63, 48, 0.87), rgba(85, 63, 48, 0.87), rgba(84, 63, 48, 0.87))",
        "--wait-color-side":              "linear-gradient(45deg, rgba(84, 63, 48, 0.87), rgba(85, 63, 48, 0.87))",
        "--wait-side-chat-items":         "linear-gradient(45deg, rgba(129, 85, 49, 0.65), rgba(129, 85, 50, 0.65))",
        "--wait-side-chat-items-reverse": "linear-gradient(45deg, rgba(129, 85, 50, 0.65), rgba(129, 85, 49, 0.65))",
        "--wait-side-chat-items-to-top":  "linear-gradient(to top, rgba(129, 85, 49, 0.65), rgba(129, 85, 50, 0.65))",
        "--writing-text":                 "rgba(252, 252, 252, 1)"
      }
    },
    // James → CrimsonRegret
    {
      id: "preset-crimson-regret",
      name: "Crimson Regret",
      source: "preset",
      vars: {
        "--hyperlink-text":               "rgba(248, 255, 143, 1)",
        "--important-text":               "rgba(150, 0, 0, 0.8)",
        "--main-bg-constant":             "rgba(71, 71, 71, 1)",
        "--main-bg-to-bottom":            "linear-gradient(to bottom, rgba(71, 71, 71, 1), rgba(69, 69, 69, 1))",
        "--main-bg-to-negative-angle":    "linear-gradient(45deg, rgba(71, 71, 71, 1), rgba(69, 69, 69, 1))",
        "--main-bg-to-positive-angle":    "linear-gradient(45deg, rgba(71, 71, 71, 1), rgba(69, 69, 69, 1))",
        "--main-bg-to-top":               "linear-gradient(to top, rgba(71, 71, 71, 1), rgba(69, 69, 69, 1))",
        "--message-incoming":             "rgba(56, 56, 56, 0.8)",
        "--message-outgoing":             "rgba(77, 5, 5, 0.8)",
        "--read-by":                      "rgba(150, 0, 0, 1)",
        "--scrollbar-track-color":        "rgba(100, 100, 100, 0.8)",
        "--wait-color-big":               "linear-gradient(45deg, rgba(56, 56, 56, 1), rgba(54, 54, 54, 1), rgba(56, 56, 56, 1))",
        "--wait-color-side":              "linear-gradient(45deg, rgba(56, 56, 56, 1), rgba(54, 54, 54, 1))",
        "--wait-side-chat-items":         "linear-gradient(45deg, rgba(61, 61, 61, 1), rgba(56, 56, 56, 1))",
        "--wait-side-chat-items-reverse": "linear-gradient(45deg, rgba(56, 56, 56, 1), rgba(61, 61, 61, 1))",
        "--wait-side-chat-items-to-top":  "linear-gradient(to top, rgba(61, 61, 61, 1), rgba(56, 56, 56, 1))",
        "--writing-text":                 "rgba(250, 250, 250, 1)"
      }
    },
    // Yumeko → Temptation's Gamble
    {
      id: "preset-temptations-gamble",
      name: "Temptation's Gamble",
      source: "preset",
      vars: {
        "--hyperlink-text":               "rgba(255, 20, 147, 1)",
        "--important-text":               "rgba(255, 20, 147, 0.8)",
        "--main-bg-constant":             "rgba(128, 0, 128, 1)",
        "--main-bg-to-bottom":            "linear-gradient(to bottom, rgba(128, 0, 128, 1), rgba(110, 0, 110, 1))",
        "--main-bg-to-negative-angle":    "linear-gradient(45deg, rgba(128, 0, 128, 1), rgba(110, 0, 110, 1))",
        "--main-bg-to-positive-angle":    "linear-gradient(45deg, rgba(128, 0, 128, 1), rgba(110, 0, 110, 1))",
        "--main-bg-to-top":               "linear-gradient(to top, rgba(128, 0, 128, 1), rgba(110, 0, 110, 1))",
        "--message-incoming":             "rgba(255, 20, 147, 0.8)",
        "--message-outgoing":             "rgba(255, 20, 147, 0.8)",
        "--read-by":                      "rgba(255, 20, 147, 1)",
        "--scrollbar-track-color":        "rgba(110, 0, 110, 0.8)",
        "--wait-color-big":               "linear-gradient(45deg, rgba(128, 0, 128, 1), rgba(110, 0, 110, 1))",
        "--wait-color-side":              "linear-gradient(45deg, rgba(128, 0, 128, 1), rgba(110, 0, 110, 1))",
        "--wait-side-chat-items":         "linear-gradient(45deg, rgba(128, 0, 128, 1), rgba(110, 0, 110, 1))",
        "--wait-side-chat-items-reverse": "linear-gradient(45deg, rgba(110, 0, 110, 1), rgba(128, 0, 128, 1))",
        "--wait-side-chat-items-to-top":  "linear-gradient(to top, rgba(128, 0, 128, 1), rgba(110, 0, 110, 1))",
        "--writing-text":                 "rgba(250, 250, 250, 1)"
      }
    },
    // Community contribution → Luke Warm. Authored in the v2 editor, so it
    // carries a `meta` sidecar (other presets predate v2 and have none). Apply
    // path ignores `meta` — kept here for lossless round-trip if duplicated.
    {
      id: "preset-luke-warm",
      name: "Luke Warm",
      source: "preset",
      vars: {
        "--hyperlink-text":               "rgba(242, 218, 166, 1)",
        "--important-text":               "rgba(234, 133, 133, 1)",
        "--writing-text":                 "rgba(255, 255, 255, 1)",
        "--read-by":                      "rgba(38, 217, 253, 1)",
        "--message-incoming":             "rgba(145, 39, 141, 0.54)",
        "--message-outgoing":             "rgba(140, 43, 105, 0.52)",
        "--main-bg-constant":             "rgba(89, 15, 163, 0.57)",
        "--scrollbar-track-color":        "rgba(242, 242, 242, 0.33)",
        "--main-bg-to-top":               "linear-gradient(to top, rgba(89, 15, 163, 0), rgba(89, 15, 163, 0.81))",
        "--main-bg-to-bottom":            "linear-gradient(to bottom, rgba(89, 15, 163, 0), rgba(89, 15, 163, 0.81))",
        "--main-bg-to-positive-angle":    "linear-gradient(45deg, rgba(89, 15, 163, 0), rgba(89, 15, 163, 0.81))",
        "--main-bg-to-negative-angle":    "linear-gradient(45deg, rgba(89, 15, 163, 0), rgba(89, 15, 163, 0.81))",
        "--wait-color-big":               "linear-gradient(45deg, rgba(0, 0, 0, 0.65), rgba(0, 0, 0, 0))",
        "--wait-color-side":              "linear-gradient(45deg, rgba(0, 0, 0, 0.65), rgba(0, 0, 0, 0))",
        "--wait-side-chat-items":         "linear-gradient(45deg, rgba(0, 0, 0, 0.65), rgba(0, 0, 0, 0))",
        "--wait-side-chat-items-reverse": "linear-gradient(45deg, rgba(0, 0, 0, 0.65), rgba(0, 0, 0, 0))",
        "--wait-side-chat-items-to-top":  "linear-gradient(to top, rgba(0, 0, 0, 0.65), rgba(0, 0, 0, 0))"
      },
      meta: {
        editorVersion: "v2",
        colors: {
          "--hyperlink-text":      { color: "rgb(242, 218, 166)", opacity: 1 },
          "--important-text":      { color: "rgb(234, 133, 133)", opacity: 1 },
          "--writing-text":        { color: "rgb(255, 255, 255)", opacity: 1 },
          "--read-by":             { color: "rgb(38, 217, 253)",  opacity: 1 },
          "--message-incoming":    { color: "rgb(145, 39, 141)",  opacity: 0.54 },
          "--message-outgoing":    { color: "rgb(140, 43, 105)",  opacity: 0.52 },
          "--main-bg-constant":    { color: "rgb(89, 15, 163)",   opacity: 0.57 },
          "--scrollbar-track-color": { color: "rgb(242, 242, 242)", opacity: 0.33 }
        },
        gradients: {
          "--main-bg-to-top":               { color: "rgb(89, 15, 163)", opacity: 0.81, solid: false, reverse: true  },
          "--main-bg-to-bottom":            { color: "rgb(89, 15, 163)", opacity: 0.81, solid: false, reverse: true  },
          "--main-bg-to-positive-angle":    { color: "rgb(89, 15, 163)", opacity: 0.81, solid: false, reverse: true  },
          "--main-bg-to-negative-angle":    { color: "rgb(89, 15, 163)", opacity: 0.81, solid: false, reverse: true  },
          "--wait-color-big":               { color: "rgb(0, 0, 0)",     opacity: 0.65, solid: false, reverse: false },
          "--wait-color-side":              { color: "rgb(0, 0, 0)",     opacity: 0.65, solid: false, reverse: false },
          "--wait-side-chat-items":         { color: "rgb(0, 0, 0)",     opacity: 0.65, solid: false, reverse: false },
          "--wait-side-chat-items-reverse": { color: "rgb(0, 0, 0)",     opacity: 0.65, solid: false, reverse: false },
          "--wait-side-chat-items-to-top":  { color: "rgb(0, 0, 0)",     opacity: 0.65, solid: false, reverse: false }
        },
        colorGroupings: {
          mainBgUnified: true,
          waitUnified: true
        }
      }
    }
  ];

  // PII-safe theme_id for analytics.
  //
  // Stored custom theme IDs come from two eras:
  //   - Legacy: `custom-<name-slug>-<base36>` (genId derived from the user's
  //     chosen name → leaks text into PostHog).
  //   - New:    `custom-<base36-rand>-<base36-time>` — no name component.
  //
  // We never migrate stored IDs (`themes:active` references them). Instead
  // we filter at the analytics boundary: new IDs pass through, legacy IDs
  // collapse to a single literal so granularity is preserved for new themes
  // without leaking old ones.
  //
  // Matches: preset-* (any preset, safe), custom-<base36-only>-<base36-only>
  // with at least 6 chars of randomness. A slugged ID like
  // "custom-my-awesome-theme-lqv8z2" fails this because of the extra
  // hyphen-separated word groups.
  const SAFE_CUSTOM_ID_RE = /^custom-[0-9a-z]{6,}-[0-9a-z]{4,}$/;
  function safeThemeIdForAnalytics(theme) {
    if (!theme || typeof theme.id !== "string") return "unknown";
    const id = theme.id;
    if (id.startsWith("preset-")) return id;
    if (SAFE_CUSTOM_ID_RE.test(id)) return id;
    return "custom-legacy";
  }

  // Human-readable labels for each CSS variable. Shared by the Theme Editor
  // (control row labels) and the Import dialog's schema docs so the two
  // surfaces stay in lockstep. Keys must match VAR_KEYS exactly.
  const KEY_LABELS = {
    "--hyperlink-text":               "Hyperlink text",
    "--important-text":               "Important text",
    "--writing-text":                 "Compose-box text",
    "--read-by":                      "Read-receipt accent",
    "--message-incoming":             "Incoming bubble",
    "--message-outgoing":             "Outgoing bubble",
    "--main-bg-constant":             "Main background (base)",
    "--scrollbar-track-color":        "Scrollbar track",
    "--main-bg-to-top":               "Main bg — up",
    "--main-bg-to-bottom":            "Main bg — down",
    "--main-bg-to-positive-angle":    "Main bg — diagonal",
    "--main-bg-to-negative-angle":    "Main bg — diagonal (alt.)",
    "--wait-color-big":               "Loading screen (large)",
    "--wait-color-side":              "Loading screen (side)",
    "--wait-side-chat-items":         "Loading chat items",
    "--wait-side-chat-items-reverse": "Loading chat items (alt.)",
    "--wait-side-chat-items-to-top":  "Loading chat items (up)",
  };

  globalThis.WA_THEME_PRESETS               = PRESETS;
  globalThis.WA_THEME_VAR_KEYS              = VAR_KEYS;
  globalThis.WA_THEME_KEY_LABELS            = KEY_LABELS;
  globalThis.WA_SAFE_THEME_ID_FOR_ANALYTICS = safeThemeIdForAnalytics;
})();
