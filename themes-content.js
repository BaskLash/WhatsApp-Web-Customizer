// Theme injection on web.whatsapp.com.
//
// Mechanism (mirrors Whatsapp-Web-Designer's working approach):
//   1. Inject themes-overrides.css as a <link> in <head>. That stylesheet
//      defines hundreds of selectors against WhatsApp's atomic class names
//      and references CSS variables (--hyperlink-text, --message-incoming,
//      --wait-color-big, etc.).
//   2. To "apply" a theme, set those CSS variables on document.documentElement
//      via element.style.setProperty(name, value). The cascade does the rest.
//   3. To "remove" a theme, removeProperty on every key the engine knows
//      about (window.WA_THEME_VAR_KEYS), then detach the <link>.
//
// No DOM walking, no flicker on switch — a single inline-style rewrite on
// <html> is enough to repaint every WhatsApp surface that the override
// stylesheet targets.

const ACTIVE_KEY = "themes:active";
const CUSTOM_KEY = "themes:custom";
const STYLESHEET_PATH = "themes-overrides.css";
const STYLESHEET_ID = "wa-theme-overrides";

function injectStylesheet() {
  if (document.getElementById(STYLESHEET_ID)) return;
  const link = document.createElement("link");
  link.id = STYLESHEET_ID;
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL(STYLESHEET_PATH);
  (document.head || document.documentElement).appendChild(link);
}

function removeStylesheet() {
  const link = document.getElementById(STYLESHEET_ID);
  if (link) link.remove();
}

function applyVars(vars) {
  const root = document.documentElement;
  Object.entries(vars).forEach(([k, v]) => {
    if (typeof k === "string" && k.startsWith("--") && typeof v === "string" && v) {
      root.style.setProperty(k, v);
    }
  });
}

function clearVars() {
  const root = document.documentElement;
  const keys = Array.isArray(globalThis.WA_THEME_VAR_KEYS) ? globalThis.WA_THEME_VAR_KEYS : [];
  keys.forEach((k) => root.style.removeProperty(k));
}

function findTheme(activeId, customs) {
  if (!activeId) return null;
  const presets = Array.isArray(globalThis.WA_THEME_PRESETS) ? globalThis.WA_THEME_PRESETS : [];
  const all = [...presets, ...(Array.isArray(customs) ? customs : [])];
  return all.find((t) => t && t.id === activeId) || null;
}

function loadAndApply() {
  chrome.storage.local.get([ACTIVE_KEY, CUSTOM_KEY], (result) => {
    const active  = result[ACTIVE_KEY];
    const customs = result[CUSTOM_KEY];
    const theme   = active && active.id ? findTheme(active.id, customs) : null;

    if (theme && theme.vars) {
      injectStylesheet();
      // Clear before re-apply so a switch from theme A→B doesn't leave A's
      // variables behind for any keys B does not define.
      clearVars();
      applyVars(theme.vars);
    } else {
      clearVars();
      removeStylesheet();
    }
  });
}

// Apply on script load. Manifest sets run_at=document_idle, so head/body exist.
loadAndApply();

// Live updates from the popup or the Theme Manager page.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[ACTIVE_KEY] || changes[CUSTOM_KEY]) loadAndApply();
});
