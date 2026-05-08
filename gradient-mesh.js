// gradient-mesh.js — Telegram-style morphing 4-color gradient mesh.
//
// What this is:
//   A premium-feeling animated chat background built from 4 large radial
//   colour blobs that slowly cycle through 8 preset arrangements.
//   Transitions between presets ease-in-out cubic; the result reads as a
//   continuously-morphing soft gradient that's barely perceptible at any
//   given moment but visibly different a minute later.
//
// Rendering approach — and why it changed:
//   Original spec called for a tiny (128×128) bitmap upscaled by CSS with
//   `filter:blur + transform:scale`. That's how Telegram does it and works
//   beautifully in a tree they fully control. In our injection context
//   (canvas inside #wa-bg-container, which sits at z-index:1 next to
//   WhatsApp's #main), the filter+transform pair promotes the canvas into
//   its own GPU compositor layer that renders invisibly behind / clipped
//   by host surfaces. The diagnostic was: water-bubbles (no filter, no
//   transform, full-res bitmap) renders fine inside the same container.
//
//   Fix: render at the canvas's actual CSS size with DPR multiplication,
//   exactly like water-bubbles. 4 radial-gradient fills per frame at full
//   resolution is still ~9× cheaper than water-bubbles' 36 fills, and the
//   browser's gradient rasterizer produces a perfectly smooth mesh without
//   needing any CSS filter to disguise upscaling artifacts.
//
// Design contract (matches water-bubbles.js):
//   Exposes a single namespace globalThis.GradientMesh with .init(container).
//   animated-bg.js calls .init() AFTER it has injected the animation HTML
//   (which contains <canvas id="gm-canvas">). .init() returns a cleanup
//   function that animated-bg.js invokes before swapping to a different
//   animation or removing the container — that teardown stops the rAF loop
//   and removes the resize / visibility listeners so nothing leaks.
//
// Theming:
//   Reads up to 5 CSS custom properties from the canvas's parent element:
//     --wac_custom_var_0..3 → the 4 blob colors (hex strings)
//     --wac_custom_var_4   → the canvas background color (hex string)
//   When a property isn't set, the matching default from CONFIG below is
//   used. This mirrors the rose_lui_lava_lamp/index.html convention, just
//   read from JS because canvas can't consume CSS variables directly.

(function () {
  "use strict";

  // ── Tunable constants ────────────────────────────────────────────────────
  // All visual / motion properties live here. The future maintainer should
  // be able to dial in the look without reading any of the rendering code.
  const CONFIG = {
    // Number of blobs. Telegram uses 4. Math throughout the file assumes 4
    // (one per preset entry); changing this requires editing POSITION_PRESETS.
    BLOB_COUNT: 4,

    // 8 preset arrangements of 4 normalized {x, y} positions each.
    // Telegram's canonical sequence — produces the signature "morph".
    POSITION_PRESETS: [
      [{x:0.80,y:0.10},{x:0.60,y:0.20},{x:0.35,y:0.25},{x:0.25,y:0.60}],
      [{x:0.20,y:0.50},{x:0.40,y:0.50},{x:0.85,y:0.25},{x:0.65,y:0.10}],
      [{x:0.65,y:0.85},{x:0.85,y:0.50},{x:0.45,y:0.20},{x:0.20,y:0.10}],
      [{x:0.10,y:0.85},{x:0.30,y:0.85},{x:0.65,y:0.55},{x:0.85,y:0.40}],
      [{x:0.50,y:0.95},{x:0.20,y:0.50},{x:0.40,y:0.20},{x:0.85,y:0.10}],
      [{x:0.20,y:0.20},{x:0.50,y:0.10},{x:0.85,y:0.15},{x:0.85,y:0.50}],
      [{x:0.20,y:0.50},{x:0.10,y:0.85},{x:0.50,y:0.85},{x:0.85,y:0.85}],
      [{x:0.85,y:0.50},{x:0.85,y:0.85},{x:0.50,y:0.85},{x:0.20,y:0.85}],
    ],

    // Time spent morphing from one preset to the next, in ms. 8s is the
    // slowest you can go before the motion stops registering as "moving"
    // and the fastest you can go before it feels mechanical.
    TRANSITION_DURATION_MS: 8000,
    // Brief pause at each preset before the next transition starts.
    // Adds rhythm; lets the eye briefly land on a stable composition.
    HOLD_DURATION_MS: 2000,

    // Radial gradient radius, as fraction of max(bitmap W, bitmap H).
    // 0.7 means each blob covers ~70% of the canvas's longest side; with
    // 4 blobs this guarantees heavy overlap → smooth multi-color blends.
    BLOB_RADIUS_FACTOR: 0.7,

    // Default palette. Telegram-signature teal/blue/purple/peach.
    // Override per-theme via --wac_custom_var_0..3 on the container.
    COLORS: ["#4A8FE8", "#A45EE5", "#F49AC2", "#7CD0D6"],

    // Canvas background fill — the darkest tone in the lineup. Override
    // via --wac_custom_var_4. The .gm-stage CSS uses the same default for
    // visual continuity before the first frame paints.
    BACKGROUND_COLOR: "#0F1419",

    // Hard cap on devicePixelRatio. Above 2× the GPU cost climbs sharply
    // for a soft gradient with no fine detail to resolve.
    MAX_DPR: 2,
  };

  // Total length of one full cycle through all 8 presets (ms).
  // Used to pick a random initial elapsed offset so the animation opens
  // mid-cycle rather than beginning at a stationary frame.
  const CYCLE_MS = (CONFIG.HOLD_DURATION_MS + CONFIG.TRANSITION_DURATION_MS) *
                   CONFIG.POSITION_PRESETS.length;

  // ── Init ─────────────────────────────────────────────────────────────────

  function init(container) {
    const canvas = container && container.querySelector("canvas#gm-canvas");
    if (!canvas) {
      console.warn("[gradient-mesh] no canvas#gm-canvas in container");
      return null;
    }
    // alpha: true (default) — same context options as water-bubbles. We
    // deliberately do NOT use { alpha: false } here even though the
    // background is opaque: keeping alpha consistent with the rest of the
    // animation lineup eliminates one variable when debugging stacking.
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      console.warn("[gradient-mesh] 2d context unavailable");
      return null;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.MAX_DPR);

    let rafId = 0;
    let running = true;
    // Wall-clock anchor. We compute elapsed = now - start each frame so the
    // cycle is independent of frame rate. Initial offset randomises start
    // position within the cycle so the animation opens already in motion.
    // Pick a random *transition* slot to start in, then a random point within
// that transition. Skips the hold windows so the animation visibly moves
// from frame one rather than potentially opening on a held still.
const slotMs = CONFIG.HOLD_DURATION_MS + CONFIG.TRANSITION_DURATION_MS;
const presetIdx = Math.floor(Math.random() * CONFIG.POSITION_PRESETS.length);
const intoTransition = Math.random() * CONFIG.TRANSITION_DURATION_MS;
const initialOffset = presetIdx * slotMs + CONFIG.HOLD_DURATION_MS + intoTransition;
const startTimestamp = performance.now() - initialOffset;

    // Resolved palette + background, read once at init from CSS custom
    // properties on the parent (with CONFIG defaults as fallback).
    const palette = resolvePalette(container);
    const backgroundColor = resolveBackground(container);

    // Pre-parsed RGB tuples per blob — saves us doing hex→rgb every frame.
    const palettesRgb = palette.map(hexToRgb);

    // Logical (CSS-pixel) canvas size. Bitmap is logical * dpr, drawing
    // math operates in CSS pixels via setTransform(dpr, …). Same pattern
    // as water-bubbles.js — that's the configuration we know renders
    // correctly inside #wa-bg-container under WhatsApp's stacking context.
    let logicalW = 0;
    let logicalH = 0;

    // ── Sizing ────────────────────────────────────────────────────────────
    // Bitmap matches the canvas's CSS-rendered size, with DPR scaling so
    // we get a sharp result on HiDPI screens. Called on init and on every
    // window resize — gradient radii in step() depend on logicalW/H so a
    // resize changes the mesh's spread automatically.
    function syncCanvasSize() {
      const rect = canvas.getBoundingClientRect();
      logicalW = Math.max(1, Math.floor(rect.width));
      logicalH = Math.max(1, Math.floor(rect.height));
      canvas.width = logicalW * dpr;
      canvas.height = logicalH * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // ── Step ──────────────────────────────────────────────────────────────
    // One frame: figure out where we are in the cycle, paint background,
    // composite 4 radial gradients on top with "lighter" so overlaps add.
    function step() {
      if (!running) return;
      // Defensive self-terminate if we were detached without an explicit
      // cleanup call. Cheap; matches water-bubbles.js behaviour.
      if (!canvas.isConnected) {
        running = false;
        return;
      }

      const w = logicalW;
      const h = logicalH;
      const radius = Math.max(w, h) * CONFIG.BLOB_RADIUS_FACTOR;

      const phase = computePhase(performance.now() - startTimestamp);
      const fromPreset = CONFIG.POSITION_PRESETS[phase.fromIdx];
      const toPreset = CONFIG.POSITION_PRESETS[phase.toIdx];
      const eased = easeInOutCubic(phase.progress);

      // Solid background. Composite mode reset to source-over so the fill
      // wipes the previous frame cleanly (the previous frame was drawn under
      // "lighter", which doesn't dim — we MUST wipe deliberately).
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, w, h);

      // Standard alpha compositing. Each blob paints over the previous with
// soft falloff (alpha 0.85 → 0 across the radius) so overlapping regions
// blend as colors rather than summing toward white. This is the key
// difference from "lighter" mode — we want color mixing, not luminance.
      ctx.globalCompositeOperation = "source-over";

      for (let i = 0; i < CONFIG.BLOB_COUNT; i++) {
        const fx = fromPreset[i].x, fy = fromPreset[i].y;
        const tx = toPreset[i].x,   ty = toPreset[i].y;
        const cx = lerp(fx, tx, eased) * w;
        const cy = lerp(fy, ty, eased) * h;

        const [r, g, b] = palettesRgb[i];
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        grad.addColorStop(0,    `rgba(${r}, ${g}, ${b}, 0.85)`);
grad.addColorStop(0.6,  `rgba(${r}, ${g}, ${b}, 0.25)`);
grad.addColorStop(1,    `rgba(${r}, ${g}, ${b}, 0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }

      rafId = requestAnimationFrame(step);
    }

    // ── Visibility / resize handlers ──────────────────────────────────────

    function onVisibility() {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(rafId);
      } else if (canvas.isConnected) {
        running = true;
        step();
      }
    }

    function onResize() {
      if (!canvas.isConnected) return;
      syncCanvasSize();
    }

    // ── Boot ──────────────────────────────────────────────────────────────

    syncCanvasSize();
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    step();

    // Cleanup: animated-bg.js calls this before swapping animations.
    return function cleanup() {
      running = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }

  // ── Phase / easing helpers ──────────────────────────────────────────────

  // Given milliseconds elapsed since the cycle's effective start, return:
  //   fromIdx  — current preset index (we're in its hold or transitioning out)
  //   toIdx    — preset we're heading toward
  //   progress — 0..1, where 0 means "at fromPreset" (still holding or just
  //              starting transition) and 1 means "at toPreset". During the
  //              hold phase, progress stays at 0.
  function computePhase(elapsedMs) {
    const slot = CONFIG.HOLD_DURATION_MS + CONFIG.TRANSITION_DURATION_MS;
    const presetCount = CONFIG.POSITION_PRESETS.length;
    const t = ((elapsedMs % CYCLE_MS) + CYCLE_MS) % CYCLE_MS; // safe mod
    const slotIdx = Math.floor(t / slot);
    const slotT = t - slotIdx * slot;
    let progress;
    if (slotT < CONFIG.HOLD_DURATION_MS) {
      progress = 0;
    } else {
      progress = (slotT - CONFIG.HOLD_DURATION_MS) /
                 CONFIG.TRANSITION_DURATION_MS;
    }
    return {
      fromIdx: slotIdx,
      toIdx: (slotIdx + 1) % presetCount,
      progress: progress,
    };
  }

  // easeInOutCubic — symmetric S-curve. Linear interpolation looks mechanical;
  // this gives the calm, weighted "swelling" feel of Telegram's transitions.
  function easeInOutCubic(t) {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // ── Theming ─────────────────────────────────────────────────────────────

  function resolvePalette(container) {
    const cs = container ? getComputedStyle(container) : null;
    const out = new Array(CONFIG.BLOB_COUNT);
    for (let i = 0; i < CONFIG.BLOB_COUNT; i++) {
      const value = cs ? cs.getPropertyValue(`--wac_custom_var_${i}`).trim() : "";
      out[i] = parseHexOr(value, CONFIG.COLORS[i]);
    }
    return out;
  }

  function resolveBackground(container) {
    const cs = container ? getComputedStyle(container) : null;
    const value = cs ? cs.getPropertyValue("--wac_custom_var_4").trim() : "";
    return parseHexOr(value, CONFIG.BACKGROUND_COLOR);
  }

  // Returns `value` if it's a usable #rrggbb / #rgb hex string, else `fallback`.
  // Other CSS color formats (rgb(), hsl(), gradients) fall through to fallback —
  // we'd otherwise need a full color parser, which is overkill for v1.
  function parseHexOr(value, fallback) {
    if (!value) return fallback;
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(value);
    return m ? "#" + m[1] : fallback;
  }

  function hexToRgb(hex) {
    let h = hex.trim().replace(/^#/, "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const num = parseInt(h, 16);
    return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff];
  }

  // Single namespace export. animated-bg.js looks for this exact shape.
  globalThis.GradientMesh = { init: init };
})();
