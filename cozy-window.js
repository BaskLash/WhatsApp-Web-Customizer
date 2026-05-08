// cozy-window.js — Vector-illustration cozy room scene.
//                   Lo-fi study aesthetic: rainy window, warm desk lamp,
//                   raindrops sliding down the glass.
//
// What this is:
//   A still-life scene drawn entirely with canvas primitives — no images,
//   no SVG sprites, no emoji — composited on top of which three small
//   animated subsystems give it life:
//     1. Raindrops on the window (form → sit → slide, with merging).
//     2. Lamp flicker (subtle multi-sine modulation of glow alpha).
//     3. Distant ambient rain in the night sky (faint diagonal streaks).
//   The static composition (sky, window frame, desk, lamp body) is
//   pre-rendered ONCE to an offscreen canvas at init/resize and blitted
//   each frame. Without this caching the per-frame cost of drawing every
//   primitive would be ~10× higher than the 8-fill water-bubbles loop.
//   With it, per-frame paint is: 1 image blit + 1 clip + ambient rain +
//   reflections + drops + lamp glow + warm tint. Comparable to the cheaper
//   animations in this lineup.
//
// Why this approach (canvas primitives, not bitmaps):
//   Bitmap assets would balloon the extension package, force per-DPR
//   variants, and bake-in the palette. Drawing from primitives lets us
//   theme the colors via CSS custom properties (see Theming below) and
//   produces crisp results at every screen size.
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
// Drop lifecycle (so a future maintainer can extend without re-deriving):
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
    DROP_MIN_RADIUS: 1.5,         // smallest visible drop, in CSS px
    DROP_MAX_RADIUS: 5,           // post-merge-grown drops cap here
    DROP_MIN_SIT_MS: 800,         // shortest a sitting drop holds before sliding
    DROP_MAX_SIT_MS: 4000,        // longest — variation here is what makes the
                                  // drop population feel asynchronous (drops
                                  // don't all start sliding at the same time)
    DROP_GRAVITY: 120,            // px/sec² — gentle. Real gravity in this
                                  // pixel space would be wildly too fast.
    DROP_INITIAL_VELOCITY: 30,    // px/sec — the "kick" when a drop starts
                                  // sliding. Without this they'd start at 0
                                  // and look briefly stuck.
    DROP_TRAIL_LENGTH: 12,        // ring-buffer length of recent positions
    DROP_MERGE_RADIUS: 4,         // sliding drops absorb sitters within this
                                  // CSS-px gap (added to the sum of radii)
    DROP_FORM_MS: 600,            // fade-in duration when a drop appears

    // ── Ambient rain (background atmosphere, NOT the drops on glass) ──
    AMBIENT_RAIN_COUNT: 15,
    AMBIENT_RAIN_VELOCITY: 80,    // px/sec, constant (no gravity)
    AMBIENT_RAIN_ALPHA: 0.08,     // very faint — it's atmosphere, not weather
    AMBIENT_RAIN_LENGTH: 12,      // line-segment length, CSS px
    AMBIENT_RAIN_TILT: 0.25,      // x-offset per length unit (light wind)

    // ── Lamp flicker ──
    LAMP_FLICKER_BASE: 0.92,      // floor of the flicker multiplier
    LAMP_FLICKER_AMPLITUDE: 0.08, // peak above floor → range [0.92, 1.00].
                                  // Pushed any higher and the flicker becomes
                                  // perceptibly pulsy. This is a cozy lamp,
                                  // not a fire alarm.
    LAMP_GLOW_RADIUS_FACTOR: 0.40, // fraction of canvas width
    LAMP_GLOW_CENTER_ALPHA: 0.55,  // alpha at gradient center, pre-flicker
    LAMP_GLOW_MID_ALPHA: 0.20,     // alpha at midpoint of gradient

    // ── Ambient warm tint (whole canvas, very subtle) ──
    AMBIENT_TINT_ALPHA: 0.04,

    // ── Pane reflection (warm patch in lower-right of each pane) ──
    PANE_REFLECTION_ALPHA: 0.08,

    // ── Colors ──
    // Sky top is themable; bottom is derived implicitly from this default
    // (we don't expose it as a variable to avoid exposing two related
    // colors that users could de-sync visually).
    COLOR_NIGHT_SKY_TOP: "#0A0E2A",
    COLOR_NIGHT_SKY_BOTTOM: "#15182E",
    COLOR_WINDOW_FRAME: "#3A2418",
    COLOR_DESK: "#2A1810",
    COLOR_LAMP_BODY: "#8B6F3A",
    COLOR_LAMP_BULB: "#FFD89B",
    COLOR_LAMP_GLOW: "#FFA94D",
    COLOR_AMBIENT_RAIN: "#B8C4D8",
    // Drop colors (not themable — tightly tuned against the dark sky):
    COLOR_DROP_BRIGHT: [200, 215, 235], // upper RGB for radial center
    COLOR_DROP_DARK: [100, 115, 140],   // RGB for outer edge
    COLOR_DROP_HIGHLIGHT: [255, 245, 225], // tiny lamp-specular spot

    // ── Per-frame integration safety ──
    MAX_FRAME_DT_MS: 50,          // cap dt so a tab returning from hidden
                                  // doesn't catapult drops off-screen on the
                                  // first frame after resume.

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

    // Resolve themed colors. Only 4 are themable; the rest are constants.
    const palette = resolvePalette(container);

    let logicalW = 0, logicalH = 0;
    let layout = null;
    let panes = null;
    // Offscreen cache for the static composition. Recreated on resize.
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

      // Recompute scene geometry — everything below scales with W/H.
      layout = computeLayout(logicalW, logicalH);
      panes = computePanes(layout);

      rebuildOffscreen();

      // Cull or rehome drops/streaks that are now outside the new bounds.
      // Without this, a window-resize that shrinks the panes leaves stale
      // drops floating in the frame area.
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
      renderStaticScene(offscreenCtx, logicalW, logicalH, layout, panes, palette);
    }

    // ── Initial population ────────────────────────────────────────────────
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
      // Cap dt to MAX_FRAME_DT_MS — protects physics from huge time jumps
      // when the tab resumes from hidden.
      const dtMs = Math.min(CONFIG.MAX_FRAME_DT_MS, now - lastFrameMs);
      lastFrameMs = now;
      const elapsedMs = now - startTimestamp;
      const flicker = flickerIntensity(elapsedMs);

      // Update animated state.
      updateAmbientRain(ambientRain, dtMs, panes);
      updateDrops(drops, dtMs, panes, logicalH);
      checkDropMerges(drops, panes);

      // ── Paint ──
      // 1. Blit the cached static scene. drawImage with explicit dest size
      //    so we render at logical (CSS-px) coordinates regardless of the
      //    bitmap's DPR-scaled size.
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(offscreen, 0, 0, logicalW, logicalH);

      // 2. Inside-pane animated stack: ambient rain (back), pane reflections,
      //    raindrops on glass (front). Clipped so nothing bleeds onto the
      //    window frame.
      ctx.save();
      clipToPanes(ctx, panes);
      drawAmbientRain(ctx, ambientRain, palette.ambientRainRgb);
      drawPaneReflections(ctx, panes, palette.lampGlowRgb);
      drawDrops(ctx, drops);
      ctx.restore();

      // 3. Lamp glow over everything (the warm wash that defines the mood).
      drawLampGlow(ctx, logicalW, logicalH, layout, palette.lampGlowRgb, flicker);

      // 4. Final whole-canvas warm ambient tint — keeps the room consistent.
      drawAmbientTint(ctx, logicalW, logicalH, palette.lampGlowRgb, flicker);

      rafId = requestAnimationFrame(step);
    }

    // ── Visibility / resize ───────────────────────────────────────────────
    function onVisibility() {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(rafId);
      } else if (canvas.isConnected) {
        // Reset lastFrameMs so the post-resume frame doesn't use a stale dt.
        lastFrameMs = performance.now();
        running = true;
        step();
      }
    }

    function onResize() {
      if (!canvas.isConnected) return;
      syncCanvasSize();
    }

    // ── Boot ──────────────────────────────────────────────────────────────
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    step();

    // Cleanup: animated-bg.js calls this before swapping animations.
    return function cleanup() {
      running = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      // Drop references so the offscreen bitmap can be GC'd promptly.
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
        y: 0.82 * h,
        height: 0.18 * h,
      },
      lamp: {
        bulbX: 0.88 * w,
        bulbY: 0.78 * h,
        bulbR: Math.max(4, 0.012 * h),
        shadeBottomW: Math.max(28, 0.05 * w),
        shadeTopW: Math.max(14, 0.025 * w),
        shadeH: Math.max(28, 0.08 * h),
        stemH: Math.max(8, 0.02 * h),
        stemW: Math.max(4, 0.008 * w),
        glowRadius: CONFIG.LAMP_GLOW_RADIUS_FACTOR * w,
      },
    };
  }

  // Pane bounds, accounting for frame thickness on every edge so drops
  // and reflections don't clip onto the wood.
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

  // ── Static scene rendering (cached to offscreen canvas) ──────────────────

  function renderStaticScene(o, w, h, layout, panes, palette) {
    // 1. Night sky gradient (top: cooler/darker, bottom: slightly warmer)
    const sky = o.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, palette.skyTop);
    sky.addColorStop(1, palette.skyBottom);
    o.fillStyle = sky;
    o.fillRect(0, 0, w, h);

    // 2. Window frame (drawn as 4 outer edges + 2 dividers, then a subtle
    //    inner shadow at the top of each pane to suggest depth).
    drawWindowFrame(o, layout, panes, palette);

    // 3. Desk surface (horizontal band at bottom, slight gradient)
    drawDesk(o, w, h, layout, palette);

    // 4. Lamp body (lampshade trapezoid + stem + bulb circle).
    //    The GLOW is animated and drawn each frame in step(), not here.
    drawLamp(o, layout, palette);
  }

  function drawWindowFrame(o, layout, panes, palette) {
    const f = layout.windowFrame;
    const t = f.thickness;

    o.fillStyle = palette.windowFrame;
    // Outer edges
    o.fillRect(f.x, f.y, f.width, t);                     // top
    o.fillRect(f.x, f.y + f.height - t, f.width, t);      // bottom
    o.fillRect(f.x, f.y, t, f.height);                    // left
    o.fillRect(f.x + f.width - t, f.y, t, f.height);      // right
    // Dividers (centered on pane lines, so subtract half-thickness)
    o.fillRect(layout.paneVDivider - t / 2, f.y, t, f.height);
    o.fillRect(f.x, layout.paneHDivider - t / 2, f.width, t);

    // Inner-edge shadow at the top of each pane — sells depth without
    // drawing an actual sill. Gradient runs from a translucent black at the
    // pane top to fully transparent ~30% down.
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
    // Thin warmer line at the front edge (catches a hint of lamp light)
    o.fillStyle = "rgba(255, 200, 140, 0.06)";
    o.fillRect(0, layout.desk.y, w, 2);
  }

  function drawLamp(o, layout, palette) {
    const L = layout.lamp;
    const shadeBottom = L.bulbY - L.bulbR - 2;
    const shadeTop = shadeBottom - L.shadeH;

    // Stem (small rectangle above the shade)
    o.fillStyle = palette.lampBody;
    o.fillRect(L.bulbX - L.stemW / 2, shadeTop - L.stemH, L.stemW, L.stemH);

    // Lampshade trapezoid
    o.beginPath();
    o.moveTo(L.bulbX - L.shadeTopW / 2, shadeTop);
    o.lineTo(L.bulbX + L.shadeTopW / 2, shadeTop);
    o.lineTo(L.bulbX + L.shadeBottomW / 2, shadeBottom);
    o.lineTo(L.bulbX - L.shadeBottomW / 2, shadeBottom);
    o.closePath();
    o.fill();

    // Subtle inner-bottom highlight on the shade (warm spill from the bulb)
    const shadeGrad = o.createLinearGradient(L.bulbX, shadeTop, L.bulbX, shadeBottom);
    shadeGrad.addColorStop(0, "rgba(255, 200, 130, 0)");
    shadeGrad.addColorStop(1, "rgba(255, 200, 130, 0.30)");
    o.fillStyle = shadeGrad;
    o.beginPath();
    o.moveTo(L.bulbX - L.shadeTopW / 2, shadeTop);
    o.lineTo(L.bulbX + L.shadeTopW / 2, shadeTop);
    o.lineTo(L.bulbX + L.shadeBottomW / 2, shadeBottom);
    o.lineTo(L.bulbX - L.shadeBottomW / 2, shadeBottom);
    o.closePath();
    o.fill();

    // Bulb (warm yellow circle just below the shade)
    o.fillStyle = palette.lampBulb;
    o.beginPath();
    o.arc(L.bulbX, L.bulbY, L.bulbR, 0, Math.PI * 2);
    o.fill();
  }

  // ── Drops ────────────────────────────────────────────────────────────────

  function spawnInitialDrops(panes) {
    // Mix of states so the first painted frame is already alive — some
    // drops formed and sitting, a few mid-slide, a couple still forming.
    const out = new Array(CONFIG.DROP_COUNT);
    for (let i = 0; i < CONFIG.DROP_COUNT; i++) {
      const d = newDrop(panes);
      const r = Math.random();
      if (r < 0.7) {
        // Sitting at full opacity, somewhere in the wait window.
        d.state = "sitting";
        d.opacity = 1;
        d.sittingMs = Math.random() * CONFIG.DROP_MAX_SIT_MS;
      } else if (r < 0.9) {
        // Forming, partially opaque.
        d.state = "forming";
        d.formingMs = Math.random() * CONFIG.DROP_FORM_MS;
        d.opacity = d.formingMs / CONFIG.DROP_FORM_MS;
      } else {
        // Sliding with a head start so drops are visibly moving on frame 1.
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

  // Reuse an existing drop object rather than allocating — keeps GC quiet.
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

  // O(n²) but n=40 → 1600 distance checks/frame, negligible. A spatial
  // hash would be premature optimization here.
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
          // Slider grows (capped) by half of the absorbed drop's radius —
          // not the full radius, otherwise merges feel cartoonish.
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
      // Older entries (lower i) fade more. 0.15 max is the spec's "very
      // low alpha" target; trail should suggest, not draw a streak.
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

    // Body radial: bright center → dark edge. The dark outline is what
    // makes a drop on glass read as a drop instead of a paint blob.
    const grad = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.radius);
    grad.addColorStop(0,   `rgba(${br}, ${bg}, ${bb}, ${op * 0.9})`);
    grad.addColorStop(0.7, `rgba(${dr}, ${dg}, ${db}, ${op * 0.7})`);
    grad.addColorStop(1,   `rgba(${dr}, ${dg}, ${db}, ${op * 0.4})`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.radius, 0, Math.PI * 2);
    ctx.fill();

    // Specular highlight: tiny bright spot upper-left, simulating the
    // lamp reflecting off the drop's curved surface. Position is fixed
    // upper-left for all drops — real refraction would point toward the
    // light source, but getting that exactly right doesn't pay off and
    // upper-left reads correctly with the lamp at lower-right.
    const hx = d.x - d.radius * 0.35;
    const hy = d.y - d.radius * 0.35;
    const hRad = Math.max(0.6, d.radius * 0.30);
    ctx.fillStyle = `rgba(${hr}, ${hg}, ${hb}, ${op * 0.7})`;
    ctx.beginPath();
    ctx.arc(hx, hy, hRad, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Ambient rain (in the night sky behind the window) ────────────────────

  function spawnInitialAmbientRain(panes) {
    const out = new Array(CONFIG.AMBIENT_RAIN_COUNT);
    for (let i = 0; i < out.length; i++) {
      out[i] = newAmbientRain(panes);
      // Pre-distribute across full height so the first frame already has
      // streaks at varying y positions (no "everything starts at the top").
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
      // Respawn when the segment's top exits the lowest pane bottom.
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
    const tilt = CONFIG.AMBIENT_RAIN_TILT * len; // x-offset across one length
    for (let i = 0; i < streaks.length; i++) {
      const s = streaks[i];
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      // Slight diagonal: drops fall and drift right (light wind from left).
      ctx.lineTo(s.x + tilt, s.y - len);
      ctx.stroke();
    }
  }

  // ── Pane reflections (warm patch in lower-right of each pane) ────────────

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

  // ── Lamp glow + warm tint (animated with flicker) ────────────────────────

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
  // Three layered low-frequency sines sum to a value in roughly [-1, 1],
  // scaled into [0, 1] then mapped to [BASE, BASE + AMPLITUDE]. The three
  // frequencies are deliberately incommensurable so the flicker never
  // visibly repeats. Result is a multiplier on lamp-glow alpha.
  function flickerIntensity(t) {
    const s =
      0.6 * Math.sin(t * 0.0011 + 0.0) +
      0.3 * Math.sin(t * 0.0037 + 1.7) +
      0.1 * Math.sin(t * 0.0089 + 3.2);
    // s is in roughly [-1, 1]; map to [0, 1]:
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
      // Hex strings for static-scene fillStyle assignments.
      skyTop: skyTop,
      skyBottom: CONFIG.COLOR_NIGHT_SKY_BOTTOM,
      windowFrame: winFrame,
      desk: CONFIG.COLOR_DESK,
      lampBody: lampBody,
      lampBulb: CONFIG.COLOR_LAMP_BULB,
      // RGB tuples for per-frame rgba() composition.
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

  // Lighten a hex color by mixing toward white. Used for the desk gradient.
  function lighten(hex, amount) {
    const [r, g, b] = hexToRgb(hex);
    const mix = (c) => Math.round(c + (255 - c) * amount);
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
  }

  // Single namespace export. animated-bg.js looks for this exact shape.
  globalThis.CozyWindow = { init: init };
})();
