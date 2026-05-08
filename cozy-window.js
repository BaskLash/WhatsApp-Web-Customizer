// cozy-window.js — Vector-illustration cozy room scene.
//                   Lo-fi study aesthetic: rainy window, warm desk lamp,
//                   raindrops sliding down the glass, a silhouetted figure
//                   studying at the desk.
//
// What this is:
//   A still-life scene drawn entirely with canvas primitives — no images,
//   no SVG sprites, no emoji — composited on top of which a few small
//   animated subsystems give it life:
//     1. Raindrops on the window (form → sit → slide, with merging).
//     2. Lamp flicker (subtle multi-sine modulation of glow alpha).
//     3. Distant ambient rain in the night sky (faint diagonal streaks).
//     4. Mug steam (slow horizontal drift + alpha modulation).
//   The static composition (sky, city lights, window frame, desk, book,
//   mug, lamp, figure, vignette) is pre-rendered ONCE to an offscreen
//   canvas at init/resize and blitted each frame. Without this caching the
//   per-frame cost of drawing every primitive would dominate.
//   With it, per-frame paint is: 1 image blit + 1 clip + ambient rain +
//   reflections + drops + steam + lamp glow + warm tint.
//
// Why this approach (canvas primitives, not bitmaps):
//   Bitmap assets would balloon the extension package, force per-DPR
//   variants, and bake-in the palette. Drawing from primitives lets us
//   theme the colors via CSS custom properties (see Theming below) and
//   produces crisp results at every screen size.
//
// On the figure:
//   A GENERIC silhouette of a person seen from behind — head bent over a
//   book, hair tied up, headphones over the ears. Deliberately not a
//   likeness of any copyrighted character. The pose evokes the lo-fi
//   study aesthetic without copying any specific figure. Drawn as a
//   solid-fill near-black shape; the lamp glow naturally rim-lights her
//   right side because the lamp is to her right.
//
// Composition order (back to front):
//   sky → city lights (in panes) → window frame → desk → lamp →
//   mug (right of figure) → book (under figure's arm) → figure →
//   vignette. Lamp is BEHIND the figure so her right side gets rim-lit
//   by the per-frame glow without the lamp itself being occluded.
//
// Design contract (matches gradient-mesh.js / liquid-marble.js):
//   Exposes globalThis.CozyWindow with .init(container). animated-bg.js
//   calls .init() AFTER injecting <canvas id="cw-canvas">. .init() returns
//   a cleanup function; animated-bg.js invokes it before swapping animations.
//
// Composite-mode lesson from Gradient Mesh:
//   source-over throughout. We learned the hard way that "lighter" causes
//   warm tints to wash to white in overlap regions, destroying the palette.
//   Every paint here uses standard alpha compositing.
//
// Drop lifecycle:
//   "forming"  → drop fades in over ~600ms, then transitions to "sitting".
//   "sitting"  → drop holds at full opacity until sittingMs reaches 0,
//                then transitions to "sliding".
//   "sliding"  → gravity accelerates downward velocity; trail accumulates
//                in a ring buffer; on exit-pane the drop respawns as
//                "forming" elsewhere. Sliding drops absorb sitting drops
//                they pass over (within DROP_MERGE_RADIUS) — the absorbed
//                drop respawns; the slider grows.
//
// Theming:
//   Reads four CSS custom properties from the canvas's parent. Only four
//   because the palette is carefully balanced — exposing every color would
//   let users break the cozy mood. The four chosen variables are the ones
//   that meaningfully shift mood (lamp glow color is the biggest lever).
//     --wac_custom_var_0 → lamp glow (warm orange = cozy, blue = melancholic)
//     --wac_custom_var_1 → night sky top
//     --wac_custom_var_2 → window frame
//     --wac_custom_var_3 → lamp body

(function () {
  "use strict";

  // ── Tunable constants ────────────────────────────────────────────────────
  const CONFIG = {
    // ── Drops ──
    DROP_COUNT: 40,
    DROP_MIN_RADIUS: 1.5,
    DROP_MAX_RADIUS: 5,
    DROP_MIN_SIT_MS: 800,
    DROP_MAX_SIT_MS: 4000,
    DROP_GRAVITY: 120,
    DROP_INITIAL_VELOCITY: 30,
    DROP_TRAIL_LENGTH: 12,
    DROP_MERGE_RADIUS: 4,
    DROP_FORM_MS: 600,

    // ── Ambient rain ──
    AMBIENT_RAIN_COUNT: 15,
    AMBIENT_RAIN_VELOCITY: 80,
    AMBIENT_RAIN_ALPHA: 0.08,
    AMBIENT_RAIN_LENGTH: 12,
    AMBIENT_RAIN_TILT: 0.25,

    // ── Lamp flicker ──
    LAMP_FLICKER_BASE: 0.92,
    LAMP_FLICKER_AMPLITUDE: 0.08,
    LAMP_GLOW_RADIUS_FACTOR: 0.40,
    LAMP_GLOW_CENTER_ALPHA: 0.55,
    LAMP_GLOW_MID_ALPHA: 0.20,

    // ── Ambient warm tint ──
    AMBIENT_TINT_ALPHA: 0.04,

    // ── Pane reflection ──
    PANE_REFLECTION_ALPHA: 0.08,

    // ── City lights ──
    CITY_LIGHTS_PER_PANE: 5,
    CITY_LIGHTS_BAND_FRACTION: 0.45,
    CITY_LIGHTS_RGB: [255, 200, 130],
    CITY_LIGHTS_ALPHA_MIN: 0.30,
    CITY_LIGHTS_ALPHA_MAX: 0.60,
    CITY_LIGHTS_SIZE_MIN_PX: 1,
    CITY_LIGHTS_SIZE_MAX_PX: 2,

    // ── Vignette ──
    VIGNETTE_ALPHA: 0.25,

    // ── Steam ──
    // Bumped alpha range a bit since the lamp glow now overlaps the steam
    // column directly (mug sits closer to the lamp). The lower bound stays
    // visible without the upper bound becoming a milky cloud.
    STEAM_X_DRIFT_PX: 2,
    STEAM_FREQUENCY: 0.0008,
    STEAM_ALPHA_MIN: 0.07,
    STEAM_ALPHA_MAX: 0.16,
    STEAM_HEIGHT_FACTOR: 0.06,
    STEAM_WIDTH_FACTOR: 0.020,

    // ── Colors ──
    COLOR_NIGHT_SKY_TOP: "#0A0E2A",
    COLOR_NIGHT_SKY_BOTTOM: "#15182E",
    COLOR_WINDOW_FRAME: "#3A2418",
    COLOR_DESK: "#2A1810",
    COLOR_LAMP_BODY: "#8B6F3A",
    COLOR_LAMP_BULB: "#FFD89B",
    COLOR_LAMP_GLOW: "#FFA94D",
    COLOR_AMBIENT_RAIN: "#B8C4D8",
    // Figure colors. Not pure black — a near-black with a touch of warm
    // brown, so the lamp's warm rim light reads naturally against the body
    // tone instead of looking like a sticker pasted onto the scene.
    COLOR_FIGURE_BODY: "#0E0B12",
    COLOR_FIGURE_HAIR: "#1A1018",
    COLOR_FIGURE_RIM: "rgba(255, 180, 110, 0.14)", // warm rim on right side
    // Drop colors:
    COLOR_DROP_BRIGHT: [200, 215, 235],
    COLOR_DROP_DARK: [100, 115, 140],
    COLOR_DROP_HIGHLIGHT: [255, 245, 225],

    MAX_FRAME_DT_MS: 50,
    MAX_DPR: 2,
  };

  // ── Init ─────────────────────────────────────────────────────────────────

  function init(container) {
    const canvas = container && container.querySelector("canvas#cw-canvas");
    if (!canvas) {
      console.warn("[cozy-window] no canvas#cw-canvas in container");
      return null;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      console.warn("[cozy-window] 2d context unavailable");
      return null;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.MAX_DPR);

    let rafId = 0;
    let running = true;
    let lastFrameMs = performance.now();
    const startTimestamp = lastFrameMs;

    const palette = resolvePalette(container);

    // City-light positions in normalized coords; stable across resizes.
    const cityLights = generateCityLights();

    let logicalW = 0, logicalH = 0;
    let layout = null;
    let panes = null;
    let offscreen = null;
    let offscreenCtx = null;

    let drops = [];
    let ambientRain = [];

    // ── Sizing + layout ───────────────────────────────────────────────────
    function syncCanvasSize() {
      const rect = canvas.getBoundingClientRect();
      logicalW = Math.max(1, Math.floor(rect.width));
      logicalH = Math.max(1, Math.floor(rect.height));
      canvas.width = logicalW * dpr;
      canvas.height = logicalH * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      layout = computeLayout(logicalW, logicalH);
      panes = computePanes(layout);

      rebuildOffscreen();

      for (let i = 0; i < drops.length; i++) {
        if (!pointInAnyPane(drops[i].x, drops[i].y, panes)) {
          respawnDropInPlace(drops[i], panes);
        }
      }
      for (let i = 0; i < ambientRain.length; i++) {
        if (!pointInAnyPane(ambientRain[i].x, ambientRain[i].y, panes)) {
          respawnRainInPlace(ambientRain[i], panes);
        }
      }
    }

    function rebuildOffscreen() {
      if (!offscreen) {
        offscreen = document.createElement("canvas");
        offscreenCtx = offscreen.getContext("2d");
      }
      offscreen.width = logicalW * dpr;
      offscreen.height = logicalH * dpr;
      offscreenCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderStaticScene(offscreenCtx, logicalW, logicalH, layout, panes, palette, cityLights);
    }

    syncCanvasSize();
    drops = spawnInitialDrops(panes);
    ambientRain = spawnInitialAmbientRain(panes);

    // ── Step ──────────────────────────────────────────────────────────────
    function step() {
      if (!running) return;
      if (!canvas.isConnected) {
        running = false;
        return;
      }

      const now = performance.now();
      const dtMs = Math.min(CONFIG.MAX_FRAME_DT_MS, now - lastFrameMs);
      lastFrameMs = now;
      const elapsedMs = now - startTimestamp;
      const flicker = flickerIntensity(elapsedMs);

      updateAmbientRain(ambientRain, dtMs, panes);
      updateDrops(drops, dtMs, panes, logicalH);
      checkDropMerges(drops, panes);

      // ── Paint ──
      // 1. Blit cached static scene.
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(offscreen, 0, 0, logicalW, logicalH);

      // 2. Inside-pane animated stack: ambient rain → reflections → drops.
      ctx.save();
      clipToPanes(ctx, panes);
      drawAmbientRain(ctx, ambientRain, palette.ambientRainRgb);
      drawPaneReflections(ctx, panes, palette.lampGlowRgb);
      drawDrops(ctx, drops);
      ctx.restore();

      // 3. Steam — drawn over the static scene but UNDER the lamp glow,
      //    so the warm wash from the lamp tints the steam.
      drawSteam(ctx, layout, elapsedMs);

      // 4. Lamp glow — the warm wash that defines the mood.
      drawLampGlow(ctx, logicalW, logicalH, layout, palette.lampGlowRgb, flicker);

      // 5. Final whole-canvas warm ambient tint.
      drawAmbientTint(ctx, logicalW, logicalH, palette.lampGlowRgb, flicker);

      rafId = requestAnimationFrame(step);
    }

    function onVisibility() {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(rafId);
      } else if (canvas.isConnected) {
        lastFrameMs = performance.now();
        running = true;
        step();
      }
    }

    function onResize() {
      if (!canvas.isConnected) return;
      syncCanvasSize();
    }

    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    step();

    return function cleanup() {
      running = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      offscreen = null;
      offscreenCtx = null;
      drops = [];
      ambientRain = [];
    };
  }

  // ── Layout math ──────────────────────────────────────────────────────────

  function computeLayout(w, h) {
    const minDim = Math.min(w, h);
    const frameThickness = Math.max(4, 0.02 * minDim);
    const deskY = 0.82 * h;

    // ── Lamp anatomy (built bottom-up from the desk) ──
    // Vertical stack (smaller y = higher):
    //   shadeTopY    ─── ┐
    //                    │ shade (trapezoid)
    //   shadeBottomY ─── ┘
    //                      bulb (drawn BEFORE shade — top half hidden by it)
    //                    │ neck (vertical rectangle)
    //   neckBottomY  ─── │ = baseTopY
    //                    │ base (low trapezoid)
    //   baseBottomY  ─── ┘ = deskY
    const bulbX = 0.83 * w;
    const bulbR = Math.max(4, 0.012 * h);

    const baseH = Math.max(8, 0.018 * h);
    const baseBottomY = deskY;
    const baseTopY = baseBottomY - baseH;
    const baseBottomW = Math.max(40, 0.065 * w);
    const baseTopW = Math.max(28, 0.045 * w);

    const neckH = Math.max(40, 0.12 * h);
    const neckBottomY = baseTopY;
    const neckTopY = neckBottomY - neckH;
    // Pole thickness: previous value (0.01 * w → ~12px on a 1200px canvas)
    // was visually invisible against the dark scene — read as a thin line
    // and got swallowed by the warm lamp glow. Bumped to 0.022 * w so the
    // pole is roughly 1/3 the width of the lampshade bottom, which is the
    // standard "looks like a real desk lamp" proportion. Floor of 10px so
    // the pole stays visible on small canvas sizes too.
    const neckW = Math.max(10, 0.022 * w);

    const shadeH = Math.max(28, 0.08 * h);
    const shadeBottomY = neckTopY;
    const shadeTopY = shadeBottomY - shadeH;
    const shadeBottomW = Math.max(28, 0.05 * w);
    const shadeTopW = Math.max(14, 0.025 * w);

    // Bulb sits with center slightly above shadeBottomY, so its top half is
    // inside the shade silhouette. The shade is drawn AFTER the bulb,
    // hiding the upper portion. Glow center is at this bulbY so the radial
    // wash emanates from the visible bulb.
    const bulbY = shadeBottomY - bulbR * 0.2;

    // ── Figure anatomy ──
    // Generic person seen from BACK, head bent over the desk, hair tied up,
    // headphones on. Positioned slightly left of center so the lamp (right
    // side) rim-lights her shoulder/head edge.
    //
    // Vertical structure (top → bottom):
    //   bun on top of head
    //   head (with headphone band crossing the top, ear cups on sides)
    //   shoulders (hoodie/sweater shape, sloping outward)
    //   torso continues off the bottom of the canvas
    //
    // The figure sits in front of the desk, occluding the desk's front edge
    // and parts of the lower window panes. Her upper body extends up into
    // the lower-left pane area.
    const figCx = 0.42 * w;            // center x — left of window center
    const headCy = 0.62 * h;            // head center y — in lower-left pane area
    const headR  = Math.max(28, 0.075 * h); // head radius (roughly 7.5% canvas h)
    // Shoulders: torso silhouette starts where neck meets shoulders, slopes
    // outward to the figure's full shoulder width, then the shoulders extend
    // off-canvas (sweater lower half not drawn — out of frame below).
    const neckY = headCy + headR * 0.95;
    const shoulderY = headCy + headR * 1.4;
    const shoulderHalfW = headR * 2.6;  // shoulder span ~5.2× head radius
    const torsoBottomY = h + 4;         // extends just past canvas bottom

    return {
      w: w,
      h: h,
      windowFrame: {
        x: 0.20 * w,
        y: 0.08 * h,
        width: 0.65 * w,
        height: 0.62 * h,
        thickness: frameThickness,
      },
      paneVDivider: 0.525 * w,
      paneHDivider: 0.39 * h,
      desk: {
        y: deskY,
        height: 0.18 * h,
      },
      lamp: {
        bulbX: bulbX,
        bulbY: bulbY,
        bulbR: bulbR,
        shadeTopY: shadeTopY,
        shadeBottomY: shadeBottomY,
        shadeTopW: shadeTopW,
        shadeBottomW: shadeBottomW,
        neckTopY: neckTopY,
        neckBottomY: neckBottomY,
        neckW: neckW,
        baseTopY: baseTopY,
        baseBottomY: baseBottomY,
        baseTopW: baseTopW,
        baseBottomW: baseBottomW,
        glowRadius: CONFIG.LAMP_GLOW_RADIUS_FACTOR * w,
      },
      // Book: nudged right (closer to figure's left forearm area) and
      // upsized so it reads as a book at typical canvas dimensions.
      book: {
        x: 0.30 * w,
        topY: deskY - 0.030 * h,
        w: 0.075 * w,
        h: 0.030 * h,
      },
      // Mug: between figure (right shoulder area) and lamp base. Steam
      // emits straight up from cx with a tiny sine drift in step().
      mug: {
        cx: 0.66 * w,
        topY: deskY - 0.050 * h,
        w: 0.038 * w,
        h: 0.050 * h,
      },
      figure: {
        cx: figCx,
        headCy: headCy,
        headR: headR,
        bunCy: headCy - headR * 0.85,
        bunR:  headR * 0.50,
        // Headphone band: thin arc across the top of the head.
        // Ear cups: small ellipses on the sides at headphone-cup height.
        headphoneCupR: headR * 0.30,
        headphoneCupCy: headCy - headR * 0.05,
        neckY: neckY,
        shoulderY: shoulderY,
        shoulderHalfW: shoulderHalfW,
        torsoBottomY: torsoBottomY,
      },
    };
  }

  function computePanes(layout) {
    const f = layout.windowFrame;
    const t = f.thickness;
    const left = f.x + t;
    const right = f.x + f.width - t;
    const top = f.y + t;
    const bottom = f.y + f.height - t;
    const vMid = layout.paneVDivider;
    const hMid = layout.paneHDivider;
    return [
      { x: left, y: top, w: vMid - left - t / 2, h: hMid - top - t / 2 },
      { x: vMid + t / 2, y: top, w: right - (vMid + t / 2), h: hMid - top - t / 2 },
      { x: left, y: hMid + t / 2, w: vMid - left - t / 2, h: bottom - (hMid + t / 2) },
      { x: vMid + t / 2, y: hMid + t / 2, w: right - (vMid + t / 2), h: bottom - (hMid + t / 2) },
    ];
  }

  function pointInAnyPane(x, y, panes) {
    for (let i = 0; i < panes.length; i++) {
      const p = panes[i];
      if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return true;
    }
    return false;
  }

  function clipToPanes(ctx, panes) {
    ctx.beginPath();
    for (let i = 0; i < panes.length; i++) {
      const p = panes[i];
      ctx.rect(p.x, p.y, p.w, p.h);
    }
    ctx.clip();
  }

  // ── Static scene rendering ───────────────────────────────────────────────

  function renderStaticScene(o, w, h, layout, panes, palette, cityLights) {
    // 1. Night sky gradient
    const sky = o.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, palette.skyTop);
    sky.addColorStop(1, palette.skyBottom);
    o.fillStyle = sky;
    o.fillRect(0, 0, w, h);

    // 2. City lights inside panes (behind the window frame).
    drawCityLights(o, cityLights, panes);

    // 3. Window frame.
    drawWindowFrame(o, layout, panes, palette);

    // 4. Desk surface.
    drawDesk(o, w, h, layout, palette);

    // 5. Lamp (BEHIND the figure, so the figure's right edge gets rim-lit
    //    by the per-frame glow that's rendered later in step()).
    drawLamp(o, layout, palette);

    // 6. Mug (between figure and lamp). Static; steam is per-frame.
    drawMug(o, layout);

    // 7. Book on desk (under the figure's left-arm area; partially hidden).
    drawBook(o, layout, palette);

    // 8. Figure — drawn IN FRONT of the desk, lamp, mug, and book. She's
    //    the foreground anchor of the composition.
    drawFigure(o, layout);

    // 9. Vignette — drawn LAST so it tints everything in the cache. The
    //    per-frame lamp glow paints over the vignette via alpha
    //    compositing, so the warm pool of light still pierces through the
    //    corner darkness.
    drawVignette(o, w, h);
  }

  function drawWindowFrame(o, layout, panes, palette) {
    const f = layout.windowFrame;
    const t = f.thickness;

    o.fillStyle = palette.windowFrame;
    o.fillRect(f.x, f.y, f.width, t);
    o.fillRect(f.x, f.y + f.height - t, f.width, t);
    o.fillRect(f.x, f.y, t, f.height);
    o.fillRect(f.x + f.width - t, f.y, t, f.height);
    o.fillRect(layout.paneVDivider - t / 2, f.y, t, f.height);
    o.fillRect(f.x, layout.paneHDivider - t / 2, f.width, t);

    for (let i = 0; i < panes.length; i++) {
      const p = panes[i];
      const sh = Math.max(8, p.h * 0.20);
      const grad = o.createLinearGradient(p.x, p.y, p.x, p.y + sh);
      grad.addColorStop(0, "rgba(0, 0, 0, 0.45)");
      grad.addColorStop(1, "rgba(0, 0, 0, 0)");
      o.fillStyle = grad;
      o.fillRect(p.x, p.y, p.w, sh);
    }
  }

  function drawDesk(o, w, h, layout, palette) {
    const grad = o.createLinearGradient(0, layout.desk.y, 0, layout.desk.y + layout.desk.height);
    grad.addColorStop(0, lighten(palette.desk, 0.20));
    grad.addColorStop(1, palette.desk);
    o.fillStyle = grad;
    o.fillRect(0, layout.desk.y, w, layout.desk.height);
    o.fillStyle = "rgba(255, 200, 140, 0.06)";
    o.fillRect(0, layout.desk.y, w, 2);
  }

  // Lamp drawing with the bulb-order fix:
  //   base → neck → BULB → shade → shade gradient
  // The shade is drawn AFTER the bulb so the shade's silhouette correctly
  // hides the upper half of the bulb. Previously the bulb was drawn last
  // (on top of the shade) so it sat in front of the shade outline rather
  // than peeking out from under it.
  function drawLamp(o, layout, palette) {
    const L = layout.lamp;
    o.fillStyle = palette.lampBody;

    // 1. Base.
    o.beginPath();
    o.moveTo(L.bulbX - L.baseTopW / 2, L.baseTopY);
    o.lineTo(L.bulbX + L.baseTopW / 2, L.baseTopY);
    o.lineTo(L.bulbX + L.baseBottomW / 2, L.baseBottomY);
    o.lineTo(L.bulbX - L.baseBottomW / 2, L.baseBottomY);
    o.closePath();
    o.fill();

    // 2. Neck.
    o.fillRect(L.bulbX - L.neckW / 2, L.neckTopY, L.neckW, L.neckH);

    // 3. Bulb — drawn BEFORE the shade. The shade will cover its upper half.
    o.fillStyle = palette.lampBulb;
    o.beginPath();
    o.arc(L.bulbX, L.bulbY, L.bulbR, 0, Math.PI * 2);
    o.fill();

    // 4. Shade — drawn AFTER the bulb, hiding the bulb's upper half and
    //    leaving only the bottom crescent visible below shadeBottomY.
    o.fillStyle = palette.lampBody;
    o.beginPath();
    o.moveTo(L.bulbX - L.shadeTopW / 2, L.shadeTopY);
    o.lineTo(L.bulbX + L.shadeTopW / 2, L.shadeTopY);
    o.lineTo(L.bulbX + L.shadeBottomW / 2, L.shadeBottomY);
    o.lineTo(L.bulbX - L.shadeBottomW / 2, L.shadeBottomY);
    o.closePath();
    o.fill();

    // 5. Inner-bottom warm spill on the shade.
    const shadeGrad = o.createLinearGradient(L.bulbX, L.shadeTopY, L.bulbX, L.shadeBottomY);
    shadeGrad.addColorStop(0, "rgba(255, 200, 130, 0)");
    shadeGrad.addColorStop(1, "rgba(255, 200, 130, 0.30)");
    o.fillStyle = shadeGrad;
    o.beginPath();
    o.moveTo(L.bulbX - L.shadeTopW / 2, L.shadeTopY);
    o.lineTo(L.bulbX + L.shadeTopW / 2, L.shadeTopY);
    o.lineTo(L.bulbX + L.shadeBottomW / 2, L.shadeBottomY);
    o.lineTo(L.bulbX - L.shadeBottomW / 2, L.shadeBottomY);
    o.closePath();
    o.fill();
  }

  function drawBook(o, layout, palette) {
    const b = layout.book;
    const cover = lighten(palette.desk, 0.30);
    const spine = darken(palette.desk, 0.30);

    o.fillStyle = cover;
    o.fillRect(b.x, b.topY, b.w, b.h);

    o.fillStyle = spine;
    o.fillRect(b.x, b.topY, Math.max(2, b.w * 0.10), b.h);

    o.fillStyle = "rgba(255, 200, 130, 0.10)";
    o.fillRect(b.x, b.topY, b.w, 1);
  }

  function drawMug(o, layout) {
    const m = layout.mug;
    const body = "#26242C";
    const rimHighlight = "rgba(255, 200, 130, 0.22)";
    const x = m.cx - m.w / 2;

    o.fillStyle = body;
    o.fillRect(x, m.topY, m.w, m.h);

    // Handle: open arc on the right side.
    o.strokeStyle = body;
    o.lineWidth = Math.max(2, m.w * 0.20);
    o.beginPath();
    o.arc(x + m.w, m.topY + m.h * 0.5, m.h * 0.28, -Math.PI / 2, Math.PI / 2);
    o.stroke();

    // Rim catches lamp light.
    o.fillStyle = rimHighlight;
    o.fillRect(x, m.topY, m.w, Math.max(1.5, m.h * 0.06));
  }

  // ── Figure (the centerpiece silhouette) ──────────────────────────────────
  // Drawn in this order, all in COLOR_FIGURE_BODY (or hair/headphone tones):
  //   1. Torso silhouette: a closed path from off-canvas-right at the
  //      bottom, sweeping up to the right shoulder, up the right side of
  //      the neck, around the head, down the left side of the neck, out
  //      to the left shoulder, and off-canvas-left at the bottom.
  //   2. Head: circle. (Already covered by the torso path's neck/head
  //      contour, but a separate circle ensures clean coverage.)
  //   3. Hair bun: a smaller circle on top of the head.
  //   4. Headphone band: a thin arc across the top of the head.
  //   5. Headphone cups: two filled circles on the sides of the head.
  //   6. Subtle warm rim light on the right edge of head and shoulder
  //      (the side facing the lamp).
  function drawFigure(o, layout) {
    const F = layout.figure;

    // 1. Torso silhouette — drawn first; the head circle will sit on top
    //    of it cleanly. We draw it as a single closed path including the
    //    head outline so the body→neck→head transition is seamless even
    //    if the head circle's outline doesn't perfectly tangent the neck.
    o.fillStyle = CONFIG.COLOR_FIGURE_BODY;
    o.beginPath();
    // Start at bottom-right (off-canvas), going counter-clockwise.
    o.moveTo(F.cx + F.shoulderHalfW + 40, F.torsoBottomY);
    // Up to right shoulder.
    o.lineTo(F.cx + F.shoulderHalfW, F.shoulderY);
    // Quadratic curve to right side of neck.
    o.quadraticCurveTo(
      F.cx + F.headR * 0.7, F.neckY + 8,
      F.cx + F.headR * 0.35, F.neckY
    );
    // Up the right side of the head — round the head with an arc.
    o.lineTo(F.cx + F.headR * 0.35, F.headCy);
    // Arc across the top of the head (right ear → over the top → left ear).
    o.arc(F.cx, F.headCy, F.headR, 0, Math.PI, true);
    // Down the left side of the neck.
    o.lineTo(F.cx - F.headR * 0.35, F.neckY);
    // Quadratic curve out to left shoulder.
    o.quadraticCurveTo(
      F.cx - F.headR * 0.7, F.neckY + 8,
      F.cx - F.shoulderHalfW, F.shoulderY
    );
    // Off-canvas-left at the bottom.
    o.lineTo(F.cx - F.shoulderHalfW - 40, F.torsoBottomY);
    o.closePath();
    o.fill();

    // 2. Head — solid circle to fill any gap from the path approximation
    //    of the head contour.
    o.fillStyle = CONFIG.COLOR_FIGURE_BODY;
    o.beginPath();
    o.arc(F.cx, F.headCy, F.headR, 0, Math.PI * 2);
    o.fill();

    // 3. Hair bun on top of head (slightly offset upward; reads as a low
    //    bun or topknot from behind).
    o.fillStyle = CONFIG.COLOR_FIGURE_HAIR;
    o.beginPath();
    o.arc(F.cx, F.bunCy, F.bunR, 0, Math.PI * 2);
    o.fill();

    // 4. Headphone band — thin warm-dark arc across the top of the head.
    //    Color is slightly lighter than body so it reads as a separate
    //    accessory, not as part of the silhouette.
    o.strokeStyle = "#2A1E2C";
    o.lineWidth = Math.max(2, F.headR * 0.10);
    o.beginPath();
    o.arc(F.cx, F.headCy, F.headR * 1.02, Math.PI + 0.15, -0.15, false);
    o.stroke();

    // 5. Headphone cups — two filled circles on the sides of the head.
    o.fillStyle = "#2A1E2C";
    o.beginPath();
    o.arc(F.cx - F.headR * 0.95, F.headphoneCupCy, F.headphoneCupR, 0, Math.PI * 2);
    o.fill();
    o.beginPath();
    o.arc(F.cx + F.headR * 0.95, F.headphoneCupCy, F.headphoneCupR, 0, Math.PI * 2);
    o.fill();

    // 6. Warm rim light on the right side (lamp-facing edge). Drawn as
    //    a thin crescent: a stroked arc just outside the head silhouette
    //    on the right, plus a soft warm glow along the right shoulder.
    //    This is what makes the figure read as "lit from the right" rather
    //    than as a flat sticker.
    o.strokeStyle = CONFIG.COLOR_FIGURE_RIM;
    o.lineWidth = Math.max(1.5, F.headR * 0.06);
    o.beginPath();
    o.arc(F.cx, F.headCy, F.headR * 1.0, -Math.PI * 0.45, Math.PI * 0.35, false);
    o.stroke();
    // Right shoulder rim — short stroke along the shoulder slope.
    o.beginPath();
    o.moveTo(F.cx + F.headR * 0.4, F.neckY + 4);
    o.quadraticCurveTo(
      F.cx + F.headR * 0.9, F.neckY + 14,
      F.cx + F.shoulderHalfW * 0.95, F.shoulderY
    );
    o.stroke();
  }

  function drawCityLights(o, lights, panes) {
    const [cr, cg, cb] = CONFIG.CITY_LIGHTS_RGB;
    const xMargin = 4;
    const yMargin = 4;
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i];
      const p = panes[l.paneIdx];
      if (!p) continue;
      const bandH = p.h * CONFIG.CITY_LIGHTS_BAND_FRACTION;
      const bandStart = p.y + p.h - bandH;
      const x = p.x + xMargin + l.u * Math.max(0, p.w - 2 * xMargin);
      const y = bandStart + yMargin + l.v * Math.max(0, bandH - 2 * yMargin);
      o.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${l.alpha})`;
      o.beginPath();
      o.arc(x, y, l.size, 0, Math.PI * 2);
      o.fill();
    }
  }

  function drawVignette(o, w, h) {
    // Stops at 0.5 and 1: center/middle stays clear, only the outer 50%
    // of the radial fades to corner darkness.
    const cx = w / 2;
    const cy = h / 2;
    const outerR = Math.sqrt(w * w + h * h) / 2;
    const grad = o.createRadialGradient(cx, cy, 0, cx, cy, outerR);
    grad.addColorStop(0.5, "rgba(0, 0, 0, 0)");
    grad.addColorStop(1,   `rgba(0, 0, 0, ${CONFIG.VIGNETTE_ALPHA})`);
    o.fillStyle = grad;
    o.fillRect(0, 0, w, h);
  }

  function generateCityLights() {
    const PANE_COUNT = 4;
    const out = new Array(PANE_COUNT * CONFIG.CITY_LIGHTS_PER_PANE);
    let idx = 0;
    for (let p = 0; p < PANE_COUNT; p++) {
      for (let i = 0; i < CONFIG.CITY_LIGHTS_PER_PANE; i++) {
        out[idx++] = {
          paneIdx: p,
          u: Math.random(),
          v: Math.random(),
          alpha: CONFIG.CITY_LIGHTS_ALPHA_MIN +
                 Math.random() * (CONFIG.CITY_LIGHTS_ALPHA_MAX - CONFIG.CITY_LIGHTS_ALPHA_MIN),
          size: CONFIG.CITY_LIGHTS_SIZE_MIN_PX +
                Math.random() * (CONFIG.CITY_LIGHTS_SIZE_MAX_PX - CONFIG.CITY_LIGHTS_SIZE_MIN_PX),
        };
      }
    }
    return out;
  }

  // ── Steam (animated) ─────────────────────────────────────────────────────

  function drawSteam(ctx, layout, t) {
    const m = layout.mug;
    // One slow sine for drift; a phase-offset sine for alpha so the two
    // aren't perfectly correlated.
    const drift = Math.sin(t * CONFIG.STEAM_FREQUENCY) * CONFIG.STEAM_X_DRIFT_PX;
    const alphaSine = Math.sin(t * CONFIG.STEAM_FREQUENCY + 1.3) * 0.5 + 0.5;
    const alpha = CONFIG.STEAM_ALPHA_MIN +
                  alphaSine * (CONFIG.STEAM_ALPHA_MAX - CONFIG.STEAM_ALPHA_MIN);

    const halfW = (CONFIG.STEAM_WIDTH_FACTOR * layout.w) / 2;
    const cx = m.cx + drift;
    const bottom = m.topY;
    const top = bottom - CONFIG.STEAM_HEIGHT_FACTOR * layout.h;

    const grad = ctx.createLinearGradient(cx, top, cx, bottom);
    grad.addColorStop(0, "rgba(255, 255, 255, 0)");
    grad.addColorStop(1, `rgba(255, 255, 255, ${alpha})`);
    ctx.fillStyle = grad;
    ctx.fillRect(cx - halfW, top, halfW * 2, bottom - top);
  }

  // ── Drops ────────────────────────────────────────────────────────────────

  function spawnInitialDrops(panes) {
    const out = new Array(CONFIG.DROP_COUNT);
    for (let i = 0; i < CONFIG.DROP_COUNT; i++) {
      const d = newDrop(panes);
      const r = Math.random();
      if (r < 0.7) {
        d.state = "sitting";
        d.opacity = 1;
        d.sittingMs = Math.random() * CONFIG.DROP_MAX_SIT_MS;
      } else if (r < 0.9) {
        d.state = "forming";
        d.formingMs = Math.random() * CONFIG.DROP_FORM_MS;
        d.opacity = d.formingMs / CONFIG.DROP_FORM_MS;
      } else {
        d.state = "sliding";
        d.opacity = 1;
        d.velocity = CONFIG.DROP_INITIAL_VELOCITY + Math.random() * 60;
      }
      out[i] = d;
    }
    return out;
  }

  function newDrop(panes) {
    const pane = panes[Math.floor(Math.random() * panes.length)];
    const margin = 6;
    return {
      x: pane.x + margin + Math.random() * Math.max(1, pane.w - 2 * margin),
      y: pane.y + margin + Math.random() * Math.max(1, pane.h - 2 * margin),
      radius: CONFIG.DROP_MIN_RADIUS + Math.random() *
              (CONFIG.DROP_MAX_RADIUS - CONFIG.DROP_MIN_RADIUS),
      state: "forming",
      formingMs: 0,
      sittingMs: CONFIG.DROP_MIN_SIT_MS + Math.random() *
                 (CONFIG.DROP_MAX_SIT_MS - CONFIG.DROP_MIN_SIT_MS),
      velocity: 0,
      trail: [],
      opacity: 0,
    };
  }

  function respawnDropInPlace(d, panes) {
    const fresh = newDrop(panes);
    d.x = fresh.x;
    d.y = fresh.y;
    d.radius = fresh.radius;
    d.state = "forming";
    d.formingMs = 0;
    d.sittingMs = fresh.sittingMs;
    d.velocity = 0;
    d.trail.length = 0;
    d.opacity = 0;
  }

  function updateDrops(drops, dtMs, panes, h) {
    const dtSec = dtMs / 1000;
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      if (d.state === "forming") {
        d.formingMs += dtMs;
        if (d.formingMs >= CONFIG.DROP_FORM_MS) {
          d.state = "sitting";
          d.opacity = 1;
        } else {
          d.opacity = d.formingMs / CONFIG.DROP_FORM_MS;
        }
      } else if (d.state === "sitting") {
        d.sittingMs -= dtMs;
        if (d.sittingMs <= 0) {
          d.state = "sliding";
          d.velocity = CONFIG.DROP_INITIAL_VELOCITY;
        }
      } else if (d.state === "sliding") {
        d.velocity += CONFIG.DROP_GRAVITY * dtSec;
        d.y += d.velocity * dtSec;
        d.trail.push({ x: d.x, y: d.y });
        if (d.trail.length > CONFIG.DROP_TRAIL_LENGTH) d.trail.shift();
        if (d.y > h || !pointInAnyPane(d.x, d.y, panes)) {
          respawnDropInPlace(d, panes);
        }
      }
    }
  }

  function checkDropMerges(drops, panes) {
    for (let i = 0; i < drops.length; i++) {
      const a = drops[i];
      if (a.state !== "sliding") continue;
      for (let j = 0; j < drops.length; j++) {
        if (i === j) continue;
        const b = drops[j];
        if (b.state !== "sitting") continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < CONFIG.DROP_MERGE_RADIUS + a.radius + b.radius) {
          a.radius = Math.min(CONFIG.DROP_MAX_RADIUS, a.radius + b.radius * 0.5);
          respawnDropInPlace(b, panes);
        }
      }
    }
  }

  function drawDrops(ctx, drops) {
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      drawDropTrail(ctx, d);
      drawDropBody(ctx, d);
    }
  }

  function drawDropTrail(ctx, d) {
    if (d.state !== "sliding" || d.trail.length === 0) return;
    const trailR = d.radius * 0.5;
    const len = d.trail.length;
    for (let i = 0; i < len; i++) {
      const a = (i / len) * 0.15;
      ctx.fillStyle = `rgba(${CONFIG.COLOR_DROP_BRIGHT[0]}, ${CONFIG.COLOR_DROP_BRIGHT[1]}, ${CONFIG.COLOR_DROP_BRIGHT[2]}, ${a})`;
      ctx.beginPath();
      ctx.arc(d.trail[i].x, d.trail[i].y, trailR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawDropBody(ctx, d) {
    if (d.opacity <= 0) return;
    const [br, bg, bb] = CONFIG.COLOR_DROP_BRIGHT;
    const [dr, dg, db] = CONFIG.COLOR_DROP_DARK;
    const [hr, hg, hb] = CONFIG.COLOR_DROP_HIGHLIGHT;
    const op = d.opacity;

    const grad = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.radius);
    grad.addColorStop(0,   `rgba(${br}, ${bg}, ${bb}, ${op * 0.9})`);
    grad.addColorStop(0.7, `rgba(${dr}, ${dg}, ${db}, ${op * 0.7})`);
    grad.addColorStop(1,   `rgba(${dr}, ${dg}, ${db}, ${op * 0.4})`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.radius, 0, Math.PI * 2);
    ctx.fill();

    const hx = d.x - d.radius * 0.35;
    const hy = d.y - d.radius * 0.35;
    const hRad = Math.max(0.6, d.radius * 0.30);
    ctx.fillStyle = `rgba(${hr}, ${hg}, ${hb}, ${op * 0.7})`;
    ctx.beginPath();
    ctx.arc(hx, hy, hRad, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Ambient rain ─────────────────────────────────────────────────────────

  function spawnInitialAmbientRain(panes) {
    const out = new Array(CONFIG.AMBIENT_RAIN_COUNT);
    for (let i = 0; i < out.length; i++) {
      out[i] = newAmbientRain(panes);
      const pane = pickPane(out[i].x, out[i].y, panes);
      if (pane) out[i].y = pane.y + Math.random() * pane.h;
    }
    return out;
  }

  function newAmbientRain(panes) {
    const pane = panes[Math.floor(Math.random() * panes.length)];
    return {
      x: pane.x + Math.random() * pane.w,
      y: pane.y - CONFIG.AMBIENT_RAIN_LENGTH,
    };
  }

  function respawnRainInPlace(s, panes) {
    const fresh = newAmbientRain(panes);
    s.x = fresh.x;
    s.y = fresh.y;
  }

  function pickPane(x, y, panes) {
    for (let i = 0; i < panes.length; i++) {
      const p = panes[i];
      if (x >= p.x && x <= p.x + p.w && y >= p.y - 100 && y <= p.y + p.h + 100) {
        return p;
      }
    }
    return null;
  }

  function updateAmbientRain(streaks, dtMs, panes) {
    const dy = (CONFIG.AMBIENT_RAIN_VELOCITY * dtMs) / 1000;
    for (let i = 0; i < streaks.length; i++) {
      const s = streaks[i];
      s.y += dy;
      if (!ambientRainStillVisible(s, panes)) {
        respawnRainInPlace(s, panes);
      }
    }
  }

  function ambientRainStillVisible(s, panes) {
    for (let i = 0; i < panes.length; i++) {
      const p = panes[i];
      if (s.x >= p.x && s.x <= p.x + p.w &&
          s.y - CONFIG.AMBIENT_RAIN_LENGTH < p.y + p.h) {
        return true;
      }
    }
    return false;
  }

  function drawAmbientRain(ctx, streaks, rgb) {
    ctx.strokeStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${CONFIG.AMBIENT_RAIN_ALPHA})`;
    ctx.lineWidth = 1;
    const len = CONFIG.AMBIENT_RAIN_LENGTH;
    const tilt = CONFIG.AMBIENT_RAIN_TILT * len;
    for (let i = 0; i < streaks.length; i++) {
      const s = streaks[i];
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + tilt, s.y - len);
      ctx.stroke();
    }
  }

  // ── Pane reflections ─────────────────────────────────────────────────────

  function drawPaneReflections(ctx, panes, glowRgb) {
    for (let i = 0; i < panes.length; i++) {
      const p = panes[i];
      const cx = p.x + p.w * 0.75;
      const cy = p.y + p.h * 0.85;
      const r = Math.max(p.w, p.h) * 0.65;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0,   `rgba(${glowRgb[0]}, ${glowRgb[1]}, ${glowRgb[2]}, ${CONFIG.PANE_REFLECTION_ALPHA})`);
      g.addColorStop(1,   `rgba(${glowRgb[0]}, ${glowRgb[1]}, ${glowRgb[2]}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(p.x, p.y, p.w, p.h);
    }
  }

  // ── Lamp glow + warm tint ────────────────────────────────────────────────

  function drawLampGlow(ctx, w, h, layout, glowRgb, flicker) {
    const L = layout.lamp;
    const grad = ctx.createRadialGradient(L.bulbX, L.bulbY, 0, L.bulbX, L.bulbY, L.glowRadius);
    grad.addColorStop(0,
      `rgba(${glowRgb[0]}, ${glowRgb[1]}, ${glowRgb[2]}, ${CONFIG.LAMP_GLOW_CENTER_ALPHA * flicker})`);
    grad.addColorStop(0.5,
      `rgba(${glowRgb[0]}, ${glowRgb[1]}, ${glowRgb[2]}, ${CONFIG.LAMP_GLOW_MID_ALPHA * flicker})`);
    grad.addColorStop(1,
      `rgba(${glowRgb[0]}, ${glowRgb[1]}, ${glowRgb[2]}, 0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  function drawAmbientTint(ctx, w, h, glowRgb, flicker) {
    ctx.fillStyle = `rgba(${glowRgb[0]}, ${glowRgb[1]}, ${glowRgb[2]}, ${CONFIG.AMBIENT_TINT_ALPHA * flicker})`;
    ctx.fillRect(0, 0, w, h);
  }

  // ── Flicker ──────────────────────────────────────────────────────────────

  function flickerIntensity(t) {
    const s =
      0.6 * Math.sin(t * 0.0011 + 0.0) +
      0.3 * Math.sin(t * 0.0037 + 1.7) +
      0.1 * Math.sin(t * 0.0089 + 3.2);
    const norm = (s + 1) / 2;
    return CONFIG.LAMP_FLICKER_BASE + CONFIG.LAMP_FLICKER_AMPLITUDE * norm;
  }

  // ── Theming ──────────────────────────────────────────────────────────────

  function resolvePalette(container) {
    const cs = container ? getComputedStyle(container) : null;
    const lampGlow = parseHexOr(read(cs, "--wac_custom_var_0"), CONFIG.COLOR_LAMP_GLOW);
    const skyTop   = parseHexOr(read(cs, "--wac_custom_var_1"), CONFIG.COLOR_NIGHT_SKY_TOP);
    const winFrame = parseHexOr(read(cs, "--wac_custom_var_2"), CONFIG.COLOR_WINDOW_FRAME);
    const lampBody = parseHexOr(read(cs, "--wac_custom_var_3"), CONFIG.COLOR_LAMP_BODY);
    return {
      skyTop: skyTop,
      skyBottom: CONFIG.COLOR_NIGHT_SKY_BOTTOM,
      windowFrame: winFrame,
      desk: CONFIG.COLOR_DESK,
      lampBody: lampBody,
      lampBulb: CONFIG.COLOR_LAMP_BULB,
      lampGlowRgb: hexToRgb(lampGlow),
      ambientRainRgb: hexToRgb(CONFIG.COLOR_AMBIENT_RAIN),
    };
  }

  function read(cs, name) {
    return cs ? cs.getPropertyValue(name).trim() : "";
  }

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

  function lighten(hex, amount) {
    const [r, g, b] = hexToRgb(hex);
    const mix = (c) => Math.round(c + (255 - c) * amount);
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
  }

  function darken(hex, amount) {
    const [r, g, b] = hexToRgb(hex);
    const mix = (c) => Math.round(c * (1 - amount));
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
  }

  globalThis.CozyWindow = { init: init };
})();