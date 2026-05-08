// water-bubbles.js — JS-driven canvas renderer for the "Water Bubbles" animation.
//
// Design contract:
//   Exposes a single namespace globalThis.WaterBubbles with .init(container).
//   animated-bg.js calls .init() AFTER it has injected the animation HTML
//   (which contains <canvas id="wb-canvas">). .init() returns a cleanup
//   function that animated-bg.js invokes before swapping to a different
//   animation or removing the container — that teardown stops the rAF loop
//   and removes the resize / visibility listeners so nothing leaks.
//
// Why a separate content script (and not inline <script> in index.html):
//   <script> tags inserted via innerHTML do not execute. Loading via
//   src= would also be subject to web.whatsapp.com's CSP. Content scripts
//   run in their own isolated world with the extension's own CSP, so this
//   is the cleanest path.
//
// Why canvas (not many DOM nodes with CSS keyframes):
//   The brief calls for drift + soft edge bounce + visual overlap. CSS
//   keyframes follow fixed paths; they can't react to viewport edges or
//   render layered specular highlights. A small canvas with rAF gives us
//   all three with one DOM node and one paint per frame.
//
// Performance targets:
//   - 36 bubbles by default → ~36 radial-gradient strokes per frame.
//   - Pauses entirely when the tab is hidden (visibilitychange).
//   - Self-terminates if the canvas is detached without an explicit
//     cleanup call (defensive — should not normally happen).
//   - Caps devicePixelRatio at 2 to avoid 4x paint cost on HiDPI screens.

(function () {
  "use strict";

  // ── Tunable constants ────────────────────────────────────────────────────
  // All movement / appearance is governed by these. Adjust here when
  // iterating on feel; the rest of the file is structural.
  const CONFIG = {
    BUBBLE_COUNT: 36,
    MIN_RADIUS: 8,    // small detail bubbles
    MAX_RADIUS: 60,   // largest, slowest-feeling bubbles
    MIN_SPEED: 0.15,  // px per frame at 60fps
    MAX_SPEED: 0.55,
    HUE_MIN: 188,     // teal-cyan
    HUE_MAX: 218,     // soft blue
    ALPHA_MIN: 0.18,
    ALPHA_MAX: 0.55,
    // Per-frame translucent black wash — produces motion-trail glow.
    // Lower alpha = longer trails. 0 disables trails (cleared each frame).
    TRAIL_FADE_ALPHA: 0,
    // Tiny perturbation applied to velocity on each edge bounce. Keeps
    // bubbles from settling into perfectly mirrored loops over time.
    BOUNCE_JITTER: 0.05,
    // Larger bubbles drift a bit slower — feels heavier, adds depth.
    SIZE_TO_SPEED_BIAS: 0.6,
    // Hard cap on devicePixelRatio. Above 2x the GPU cost rises sharply
    // for negligible perceived quality on a soft, blurry effect.
    MAX_DPR: 2,
  };

  // ── Init ─────────────────────────────────────────────────────────────────

  function init(container) {
    const canvas = container && container.querySelector("canvas#wb-canvas");
    if (!canvas) {
      console.warn("[water-bubbles] no canvas#wb-canvas in container");
      return null;
    }
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) {
      console.warn("[water-bubbles] 2d context unavailable");
      return null;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.MAX_DPR);
    let bubbles = [];
    let rafId = 0;
    let running = true;
    // Tracks logical (CSS) canvas size so the step loop doesn't have to
    // recompute width / dpr each frame.
    let logicalW = 0;
    let logicalH = 0;

    // ── Sizing ────────────────────────────────────────────────────────────
    // The canvas's CSS size comes from the parent (.wb-stage covers the
    // bg container at 100%). We sync the bitmap size to that with a DPR
    // multiplier and then scale the drawing context to match — coordinates
    // can stay in CSS pixels everywhere else.
    function syncCanvasSize() {
      const rect = canvas.getBoundingClientRect();
      logicalW = Math.max(1, Math.floor(rect.width));
      logicalH = Math.max(1, Math.floor(rect.height));
      canvas.width = logicalW * dpr;
      canvas.height = logicalH * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // ── Spawn ─────────────────────────────────────────────────────────────
    // Bubbles are independent — no inter-bubble physics. They overlap
    // visually via screen blending in the draw step. That's the brief.
    function spawn() {
      bubbles = new Array(CONFIG.BUBBLE_COUNT);
      for (let i = 0; i < CONFIG.BUBBLE_COUNT; i++) {
        const r = randRange(CONFIG.MIN_RADIUS, CONFIG.MAX_RADIUS);
        // Larger bubbles trend slower (heavier feel). The bias is gentle —
        // every size still spans the full speed range, just weighted.
        const sizeFactor = 1 - (r - CONFIG.MIN_RADIUS) /
          (CONFIG.MAX_RADIUS - CONFIG.MIN_RADIUS);
        const speedScale = 1 - (1 - sizeFactor) * CONFIG.SIZE_TO_SPEED_BIAS;
        const speed = randRange(CONFIG.MIN_SPEED, CONFIG.MAX_SPEED) * speedScale;
        const angle = Math.random() * Math.PI * 2;
        bubbles[i] = {
          x: r + Math.random() * Math.max(1, logicalW - 2 * r),
          y: r + Math.random() * Math.max(1, logicalH - 2 * r),
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          r: r,
          hue: randRange(CONFIG.HUE_MIN, CONFIG.HUE_MAX),
          alpha: randRange(CONFIG.ALPHA_MIN, CONFIG.ALPHA_MAX),
        };
      }
    }

    // ── Step ──────────────────────────────────────────────────────────────
    // One animation frame: integrate positions, soft-bounce off edges,
    // paint a translucent dark wash for trails, then draw each bubble
    // with screen blending so overlaps brighten naturally.
    function step() {
      if (!running) return;
      // Defensive self-terminate if we were detached without an explicit
      // cleanup call. Cheap check; no observer needed.
      if (!canvas.isConnected) {
        running = false;
        return;
      }

      // Trail fade. Drawn under "source-over" so it actually dims the
      // canvas rather than additively brightening it.
      if (CONFIG.TRAIL_FADE_ALPHA > 0) {
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = `rgba(4, 16, 31, ${CONFIG.TRAIL_FADE_ALPHA})`;
        ctx.fillRect(0, 0, logicalW, logicalH);
      } else {
        ctx.clearRect(0, 0, logicalW, logicalH);
      }

      ctx.globalCompositeOperation = "source-over";

      for (let i = 0; i < bubbles.length; i++) {
        const b = bubbles[i];

        // Edge handling: clamp position back inside the box, flip the
        // perpendicular velocity component, and add a small random
        // perturbation so the system doesn't lock into mirrored cycles.
        if (b.x - b.r < 0) {
          b.x = b.r;
          b.vx = Math.abs(b.vx) + (Math.random() - 0.5) * CONFIG.BOUNCE_JITTER;
        } else if (b.x + b.r > logicalW) {
          b.x = logicalW - b.r;
          b.vx = -Math.abs(b.vx) + (Math.random() - 0.5) * CONFIG.BOUNCE_JITTER;
        }
        if (b.y - b.r < 0) {
          b.y = b.r;
          b.vy = Math.abs(b.vy) + (Math.random() - 0.5) * CONFIG.BOUNCE_JITTER;
        } else if (b.y + b.r > logicalH) {
          b.y = logicalH - b.r;
          b.vy = -Math.abs(b.vy) + (Math.random() - 0.5) * CONFIG.BOUNCE_JITTER;
        }

        b.x += b.vx;
        b.y += b.vy;

        // Bubble body: hollow center with a bright rim. The gradient stays
        // nearly transparent through most of the radius, then ramps up
        // sharply near the edge to mimic total internal reflection on a
        // thin water film. This is what makes it read as "bubble" and not
        // "glowing orb".
        const body = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
        body.addColorStop(0,    `hsla(${b.hue}, 70%, 70%, 0)`);
        body.addColorStop(0.65, `hsla(${b.hue}, 60%, 70%, ${b.alpha * 0.05})`);
        body.addColorStop(0.88, `hsla(${b.hue}, 75%, 75%, ${b.alpha * 0.35})`);
        body.addColorStop(0.97, `hsla(${b.hue}, 80%, 88%, ${b.alpha})`);
        body.addColorStop(1,    `hsla(${b.hue}, 80%, 88%, 0)`);

        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();

        // Primary specular highlight: a small sharp bright dot up and to
        // the left of center, simulating a single light source above the
        // scene. The tight 0 → 0.5 falloff is what sells it as a real
        // reflection rather than just another soft blob.
        const hlX = b.x - b.r * 0.4;
        const hlY = b.y - b.r * 0.4;
        const hlR = b.r * 0.35;
        const highlight = ctx.createRadialGradient(hlX, hlY, 0, hlX, hlY, hlR);
        highlight.addColorStop(0,   `rgba(255, 255, 255, ${b.alpha * 1.1})`);
        highlight.addColorStop(0.5, `rgba(255, 255, 255, ${b.alpha * 0.2})`);
        highlight.addColorStop(1,   `rgba(255, 255, 255, 0)`);

        ctx.fillStyle = highlight;
        ctx.beginPath();
        ctx.arc(hlX, hlY, hlR, 0, Math.PI * 2);
        ctx.fill();

        // Secondary highlight: fainter, larger reflection on the bottom-
        // right rim — the "bounce light" from the environment hitting the
        // far side of the bubble. Subtle, but it's what makes a bubble
        // read as three-dimensional rather than a flat disc with a shine.
        const sX = b.x + b.r * 0.45;
        const sY = b.y + b.r * 0.45;
        const sR = b.r * 0.5;
        const secondary = ctx.createRadialGradient(sX, sY, 0, sX, sY, sR);
        secondary.addColorStop(0, `hsla(${b.hue}, 50%, 90%, ${b.alpha * 0.25})`);
        secondary.addColorStop(1, `hsla(${b.hue}, 50%, 90%, 0)`);

        ctx.fillStyle = secondary;
        ctx.beginPath();
        ctx.arc(sX, sY, sR, 0, Math.PI * 2);
        ctx.fill();
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
      // Re-clamp existing bubbles so none are stuck outside the new bounds.
      for (let i = 0; i < bubbles.length; i++) {
        const b = bubbles[i];
        if (b.x - b.r < 0) b.x = b.r;
        if (b.x + b.r > logicalW) b.x = logicalW - b.r;
        if (b.y - b.r < 0) b.y = b.r;
        if (b.y + b.r > logicalH) b.y = logicalH - b.r;
      }
    }

    // ── Boot ──────────────────────────────────────────────────────────────

    syncCanvasSize();
    spawn();
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    step();

    // Cleanup: animated-bg.js calls this before swapping animations.
    return function cleanup() {
      running = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      bubbles = [];
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  function randRange(min, max) {
    return min + Math.random() * (max - min);
  }

  // Single namespace export. animated-bg.js looks for this exact shape.
  globalThis.WaterBubbles = { init: init };
})();
