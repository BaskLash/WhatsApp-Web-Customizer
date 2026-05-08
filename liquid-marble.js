// liquid-marble.js — Organic liquid-flow effect via summed-sine motion
//                    plus a per-frame trail fade.
//
// What this is:
//   Eight colored "veins" wander through the canvas on slow, non-repeating
//   trajectories. Each vein is rendered as a soft radial gradient, and each
//   frame begins with a faint translucent overlay of the background color
//   instead of a hard wipe — so the canvas accumulates a subtle "memory" of
//   where the veins recently were. The combined effect reads as ink swirling
//   through water rather than a static gradient mesh.
//
// Why this approach (and why not the obvious alternatives):
//   - Summed incommensurable sines (3 frequencies per axis, with random
//     per-vein phase offsets) produce motion that never visibly repeats and
//     traces organic curlicues. A single sine produces orbital motion; a
//     Perlin-noise approximation costs more and reads no better; a real
//     fluid simulation is wildly out of budget. The sum-of-sines trick is
//     the cheapest thing that actually looks like fluid flow.
//   - Trail fade is implemented as a low-alpha overlay of the background
//     color (~12% per frame), NOT an offscreen canvas snapshot. The overlay
//     is a single fillRect — orders of magnitude cheaper than blitting an
//     offscreen canvas every frame. Do not "optimize" by switching to an
//     offscreen-canvas approach; that would be slower, not faster.
//   - The composite-mode lesson learned the hard way during Gradient Mesh:
//     use "source-over" with tuned alpha, NOT "lighter". With "lighter",
//     overlapping veins sum toward white and the palette goes pale in the
//     middle — destroying the inky-color identity each vein is supposed to
//     keep. "source-over" with center-alpha 0.55 lets veins blend as colors,
//     which is exactly the swirled-ink aesthetic we want.
//
// Design contract (matches gradient-mesh.js / water-bubbles.js):
//   Exposes a single namespace globalThis.LiquidMarble with .init(container).
//   animated-bg.js calls .init() AFTER injecting the animation HTML (which
//   contains <canvas id="lm-canvas">). .init() returns a cleanup function
//   that animated-bg.js invokes before swapping to a different animation or
//   removing the container — that teardown stops the rAF loop and removes
//   the resize / visibility listeners so nothing leaks.
//
// Performance notes:
//   Per frame: 1 background-fade fillRect + 8 radial-gradient fillRects.
//   That's 9 full-canvas fills, all with cheap shaders. On any machine that
//   runs WhatsApp Web acceptably this is well under 1ms/frame; rAF is the
//   bottleneck, not paint.
//
// Theming:
//   Reads up to 9 CSS custom properties from the canvas's parent element:
//     --wac_custom_var_0..7 → the 8 vein colors (hex strings)
//     --wac_custom_var_8    → the canvas background color (hex string)
//   When a property isn't set, the matching default from CONFIG below is
//   used. Same convention as gradient-mesh.js and rose_lui_lava_lamp.

(function () {
  "use strict";

  // ── Tunable constants ────────────────────────────────────────────────────
  // All visual / motion properties live here. The future maintainer should
  // be able to dial in the look without reading any of the rendering code.
  const CONFIG = {
    // Number of vein controllers. 8 gives enough density that the canvas
    // always has multiple active currents but stays cheap to render.
    VEIN_COUNT: 8,

    // Radial gradient radius, as fraction of max(canvas W, canvas H). 0.55
    // gives veins big enough to overlap each other generously (which is
    // what makes the colors actually mix) without each one swallowing the
    // whole canvas.
    VEIN_RADIUS_FACTOR: 0.55,

    // Center alpha of each vein's radial gradient. The 0.55 → 0.22 → 0
    // falloff (computed in step()) is what produces clean color blending
    // under "source-over". Pushing this higher loses color identity in
    // overlap regions; pushing it much lower makes the canvas read as
    // washed-out bg with hints of color.
    BASE_ALPHA: 0.55,

    // Per-frame translucent background overlay. 0.12 means each frame
    // dims the previous frame by ~12% — fast enough that trails fade in
    // about half a second at 60fps, slow enough to read as "smearing" /
    // "memory" rather than "ghosting". This single low-alpha fillRect is
    // the entire trail mechanism; no offscreen canvas needed.
    TRAIL_FADE_ALPHA: 0.12,

    // Time scale: multiplier from elapsed milliseconds → the dimensionless
    // `t` value fed to the sine layer. Kept tiny on purpose. With
    // FREQUENCIES[0]=0.05 and TIME_SCALE=0.0004, the slowest sine takes
    // ~5 minutes to complete one full cycle. The motion should feel
    // nearly meditative — if a casual viewer can clock the timing of any
    // single sine, this number is too large.
    TIME_SCALE: 0.0004,

    // Three layered sine frequencies per coordinate, in radians per
    // t-unit. Chosen to be incommensurable (no integer ratios between
    // them) so the sum never repeats. Largest carries the broad motion;
    // smaller two add the wobble that sells "fluid" instead of "orbiting".
    FREQUENCIES: [0.05, 0.13, 0.27],

    // Matched amplitudes (must align 1:1 with FREQUENCIES). Sum is 0.48,
    // so each axis varies in [0.5 - 0.48, 0.5 + 0.48] = [0.02, 0.98] of
    // canvas extent — veins traverse essentially the full canvas without
    // ever hugging the absolute edge.
    AMPLITUDES: [0.30, 0.12, 0.06],

    // Default palette: dark, saturated inky tones — moodier than Gradient
    // Mesh's daytime palette. Override per-theme via --wac_custom_var_0..7
    // on the container.
    COLORS: [
      "#1B3A6B", // deep navy
      "#3E1F5C", // royal purple
      "#6B1F4E", // wine
      "#0F4C5C", // deep teal
      "#5C2A3F", // mulberry
      "#1F4068", // midnight blue
      "#4A1942", // plum
      "#2A5F5F", // dark cyan
    ],

    // Canvas background fill. Darker than Gradient Mesh's #0F1419 because
    // the fade trails need genuinely dark space to fade into. Override via
    // --wac_custom_var_8. The .lm-stage CSS uses the same default for
    // visual continuity before the first frame paints.
    BACKGROUND_COLOR: "#0A0E1A",

    // Hard cap on devicePixelRatio. Above 2× the GPU cost climbs sharply
    // for a soft gradient with no fine detail to resolve.
    MAX_DPR: 2,
  };

  // ── Init ─────────────────────────────────────────────────────────────────

  function init(container) {
    const canvas = container && container.querySelector("canvas#lm-canvas");
    if (!canvas) {
      console.warn("[liquid-marble] no canvas#lm-canvas in container");
      return null;
    }
    // Default getContext options (alpha:true). Same as gradient-mesh and
    // water-bubbles — keeping the context options consistent across the
    // animation lineup eliminates one variable when debugging stacking.
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      console.warn("[liquid-marble] 2d context unavailable");
      return null;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.MAX_DPR);

    let rafId = 0;
    let running = true;

    // Random t offset puts veins at random points along their trajectories
    // on the very first frame, so the animation opens already mid-flow
    // rather than with all veins clustered at their t=0 positions.
    const initialT = Math.random() * 1000;
    const startTimestamp = performance.now();

    // Resolve palette + background via CSS custom properties on `container`,
    // falling back to CONFIG defaults. Read once at init — themes update
    // would trigger a fresh apply via animated-bg.js, which reruns init.
    const palette = resolvePalette(container);
    const backgroundColor = resolveBackground(container);
    const palettesRgb = palette.map(hexToRgb);
    const bgRgb = hexToRgb(backgroundColor);

    // Each vein gets a color and 6 random phase offsets — three for x,
    // three for y. Sharing the FREQUENCIES table while randomizing phases
    // is what makes 8 veins trace 8 distinct paths rather than 8 copies of
    // the same path.
    const veins = new Array(CONFIG.VEIN_COUNT);
    for (let i = 0; i < CONFIG.VEIN_COUNT; i++) {
      veins[i] = {
        rgb: palettesRgb[i % palettesRgb.length],
        p: [twoPiRand(), twoPiRand(), twoPiRand()],
        q: [twoPiRand(), twoPiRand(), twoPiRand()],
      };
    }

    // Logical (CSS-pixel) canvas size. Bitmap is logical * dpr, drawing
    // math operates in CSS pixels via setTransform(dpr, …). Same pattern
    // as gradient-mesh.js and water-bubbles.js — that's the configuration
    // we know renders correctly inside #wa-bg-container under WhatsApp's
    // stacking context.
    let logicalW = 0;
    let logicalH = 0;

    // ── Sizing ────────────────────────────────────────────────────────────
    function syncCanvasSize() {
      const rect = canvas.getBoundingClientRect();
      logicalW = Math.max(1, Math.floor(rect.width));
      logicalH = Math.max(1, Math.floor(rect.height));
      canvas.width = logicalW * dpr;
      canvas.height = logicalH * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // ── Step ──────────────────────────────────────────────────────────────
    // One frame: faint background overlay (the trail mechanism), then 8
    // radial gradients with source-over compositing.
    function step() {
      if (!running) return;
      // Defensive self-terminate if the canvas was detached without an
      // explicit cleanup call. Cheap; matches gradient-mesh.js / water-bubbles.
      if (!canvas.isConnected) {
        running = false;
        return;
      }

      const w = logicalW;
      const h = logicalH;
      const radius = Math.max(w, h) * CONFIG.VEIN_RADIUS_FACTOR;
      const t = initialT + (performance.now() - startTimestamp) * CONFIG.TIME_SCALE;

      // Trail fade: low-alpha bg overlay rather than a hard wipe. This
      // single fillRect is the entire trail mechanism. The previous frame's
      // pixels remain visible at (1 - TRAIL_FADE_ALPHA) opacity, so motion
      // leaves a fading wake — the "ink in water" feel.
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = `rgba(${bgRgb[0]}, ${bgRgb[1]}, ${bgRgb[2]}, ${CONFIG.TRAIL_FADE_ALPHA})`;
      ctx.fillRect(0, 0, w, h);

      // Veins, drawn over the faded prior frame. Composite stays
      // source-over: blob colors mix with each other and the background
      // through standard alpha compositing, which preserves color identity
      // (so you can still tell wine from teal where they overlap).
      // DO NOT switch this to "lighter" — see header comment.
      for (let i = 0; i < CONFIG.VEIN_COUNT; i++) {
        const vein = veins[i];
        // Sum-of-sines position. Three layered sines per axis: the largest
        // carries broad motion, the smaller-faster ones add wobble. Random
        // phases per vein make each path unique.
        const x = 0.5 +
          CONFIG.AMPLITUDES[0] * Math.sin(t * CONFIG.FREQUENCIES[0] + vein.p[0]) +
          CONFIG.AMPLITUDES[1] * Math.sin(t * CONFIG.FREQUENCIES[1] + vein.p[1]) +
          CONFIG.AMPLITUDES[2] * Math.sin(t * CONFIG.FREQUENCIES[2] + vein.p[2]);
        const y = 0.5 +
          CONFIG.AMPLITUDES[0] * Math.sin(t * CONFIG.FREQUENCIES[0] + vein.q[0]) +
          CONFIG.AMPLITUDES[1] * Math.sin(t * CONFIG.FREQUENCIES[1] + vein.q[1]) +
          CONFIG.AMPLITUDES[2] * Math.sin(t * CONFIG.FREQUENCIES[2] + vein.q[2]);
        const cx = x * w;
        const cy = y * h;

        const [r, g, b] = vein.rgb;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${CONFIG.BASE_ALPHA})`);
        grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${CONFIG.BASE_ALPHA * 0.4})`);
        grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
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
      // Veins use normalized [0..1] positions multiplied by w/h each
      // frame, so a resize requires no internal state changes — the next
      // step() picks up the new dimensions automatically.
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

  // ── Helpers ─────────────────────────────────────────────────────────────

  function twoPiRand() {
    return Math.random() * Math.PI * 2;
  }

  function resolvePalette(container) {
    const cs = container ? getComputedStyle(container) : null;
    const out = new Array(CONFIG.VEIN_COUNT);
    for (let i = 0; i < CONFIG.VEIN_COUNT; i++) {
      const value = cs ? cs.getPropertyValue(`--wac_custom_var_${i}`).trim() : "";
      out[i] = parseHexOr(value, CONFIG.COLORS[i % CONFIG.COLORS.length]);
    }
    return out;
  }

  function resolveBackground(container) {
    const cs = container ? getComputedStyle(container) : null;
    const value = cs ? cs.getPropertyValue("--wac_custom_var_8").trim() : "";
    return parseHexOr(value, CONFIG.BACKGROUND_COLOR);
  }

  // Returns `value` if it's a usable #rrggbb / #rgb hex string, else `fallback`.
  // Other CSS color formats (rgb(), hsl(), gradients) fall through — we'd
  // need a full color parser, which is overkill for v1.
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
  globalThis.LiquidMarble = { init: init };
})();
