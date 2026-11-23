/* =====================================================================
   Air Canvas Precision Module
   Fixes: shaky lines, broken/disconnected strokes, pen flicker on/off.
   Works with MediaPipe Hands (landmark 8 = index fingertip).
   Drop this in BEFORE your main script, then follow the 3 steps at the bottom.
   ===================================================================== */
(function (global) {
  const CFG = {
    // One Euro filter: lower minCutoff = smoother when slow, higher beta = less lag when fast
    minCutoff: 1.5,
    beta: 0.02,
    dCutoff: 1.0,
    // Pen state (hysteresis) so the pen doesn't flicker
    penDownFrames: 2,      // frames the gesture must hold before pen goes down
    penUpGraceMs: 160,     // gesture may break this long before the stroke is paused
    lostHandGraceMs: 220,  // hand may vanish this long before the stroke is ended
    // Pinch mode (distance / hand size) with hysteresis
    pinchOn: 0.22,
    pinchOff: 0.38,
    // Reject tracking glitches (teleporting landmark)
    maxJumpPx: 220,
    maxGlitchFrames: 2,
  };

  /* ---------- One Euro filter ---------- */
  class LowPass {
    constructor() { this.y = null; }
    filter(x, a) { this.y = this.y === null ? x : a * x + (1 - a) * this.y; return this.y; }
  }
  class OneEuro {
    constructor(minCutoff, beta, dCutoff) {
      this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
      this.reset();
    }
    reset() { this.x = new LowPass(); this.dx = new LowPass(); this.tPrev = null; this.xPrev = null; }
    _alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
    filter(x, tMs) {
      if (this.tPrev === null) {
        this.tPrev = tMs; this.xPrev = x; this.x.y = x; this.dx.y = 0; return x;
      }
      const dt = Math.max((tMs - this.tPrev) / 1000, 1e-3);
      const rawVel = (x - this.xPrev) / dt;
      const vel = this.dx.filter(rawVel, this._alpha(this.dCutoff, dt));
      const cutoff = this.minCutoff + this.beta * Math.abs(vel);
      const out = this.x.filter(x, this._alpha(cutoff, dt));
      this.tPrev = tMs; this.xPrev = x;
      return out;
    }
  }

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  /* ---------- Pen controller ---------- */
  class PrecisionPen {
    constructor(cfg = {}) {
      this.cfg = Object.assign({}, CFG, cfg);
      this.fx = new OneEuro(this.cfg.minCutoff, this.cfg.beta, this.cfg.dCutoff);
      this.fy = new OneEuro(this.cfg.minCutoff, this.cfg.beta, this.cfg.dCutoff);
      this.down = false;      // stroke is active
      this.streak = 0;        // consecutive frames gesture is true
      this.lastWantT = 0;
      this.lastSeenT = 0;
      this.pinching = false;
      this.lastRaw = null;
      this.glitches = 0;
    }

    _fingerExtended(lm, tip, pip) {
      return dist(lm[tip], lm[0]) > dist(lm[pip], lm[0]) * 1.05;
    }
    _fingerCurled(lm, tip, pip) {
      return dist(lm[tip], lm[0]) < dist(lm[pip], lm[0]) * 1.02;
    }

    _wantDraw(lm, mode) {
      if (mode === 'pinch') {
        const size = dist(lm[0], lm[9]) || 1e-6;
        const ratio = dist(lm[4], lm[8]) / size;
        if (this.pinching) { if (ratio > this.cfg.pinchOff) this.pinching = false; }
        else if (ratio < this.cfg.pinchOn) this.pinching = true;
        return this.pinching;
      }
      // Index-finger mode: index up, and at least 2 of the other 3 fingers curled
      const indexUp = this._fingerExtended(lm, 8, 6);
      const curled = [[12, 10], [16, 14], [20, 18]]
        .filter(([t, p]) => this._fingerCurled(lm, t, p)).length;
      return indexUp && curled >= 2;
    }

    /**
     * @param lm        results.multiHandLandmarks[0] or null
     * @param tMs       performance.now()
     * @param w,h       canvas width/height in pixels
     * @param mirrored  true if you flip the video horizontally
     * @param mode      'index' or 'pinch'
     * @returns {type: 'start'|'move'|'hold'|'end'|'hover'|'none', x, y}
     */
    update(lm, tMs, w, h, mirrored, mode = 'index') {
      // Hand lost: keep the stroke alive briefly instead of cutting the line
      if (!lm) {
        if (this.down && tMs - this.lastSeenT > this.cfg.lostHandGraceMs) {
          this.down = false; this.streak = 0;
          return { type: 'end' };
        }
        return { type: this.down ? 'hold' : 'none' };
      }
      this.lastSeenT = tMs;

      // Raw fingertip in canvas pixels
      let rx = lm[8].x * w;
      const ry = lm[8].y * h;
      if (mirrored) rx = w - rx;

      // Glitch rejection (single-frame landmark teleports)
      if (this.lastRaw && Math.hypot(rx - this.lastRaw.x, ry - this.lastRaw.y) > this.cfg.maxJumpPx) {
        if (this.glitches < this.cfg.maxGlitchFrames) {
          this.glitches++;
          return { type: this.down ? 'hold' : 'hover' };
        }
        // Real fast move: accept it and restart the filter there
        this.fx.reset(); this.fy.reset();
      }
      this.glitches = 0;
      this.lastRaw = { x: rx, y: ry };

      const x = this.fx.filter(rx, tMs);
      const y = this.fy.filter(ry, tMs);

      // Pen state with hysteresis
      const want = this._wantDraw(lm, mode);
      if (want) { this.streak++; this.lastWantT = tMs; } else { this.streak = 0; }

      if (!this.down) {
        if (this.streak >= this.cfg.penDownFrames) {
          this.down = true;
          return { type: 'start', x, y };
        }
        return { type: 'hover', x, y };
      }
      if (!want && tMs - this.lastWantT > this.cfg.penUpGraceMs) {
        this.down = false;
        return { type: 'end', x, y };
      }
      // Gesture briefly broken: pause drawing but keep the stroke connected
      if (!want) return { type: 'hold', x, y };
      return { type: 'move', x, y };
    }
  }

  /* ---------- Smooth stroke renderer (no gaps, no jagged corners) ---------- */
  class StrokeRenderer {
    constructor(ctx) { this.ctx = ctx; this.prev = null; this.lastMid = null; }
    _dot(x, y) {
      const c = this.ctx;
      c.save();
      c.beginPath();
      c.arc(x, y, c.lineWidth / 2, 0, Math.PI * 2);
      c.fillStyle = c.strokeStyle;
      c.fill();
      c.restore();
    }
    begin(x, y) {
      const c = this.ctx;
      c.lineCap = 'round'; c.lineJoin = 'round';
      this.prev = { x, y }; this.lastMid = { x, y };
      this._dot(x, y);
    }
    add(x, y) {
      if (!this.prev) return this.begin(x, y);
      const c = this.ctx;
      const mid = { x: (this.prev.x + x) / 2, y: (this.prev.y + y) / 2 };
      c.beginPath();
      c.moveTo(this.lastMid.x, this.lastMid.y);
      c.quadraticCurveTo(this.prev.x, this.prev.y, mid.x, mid.y);
      c.stroke();
      this.lastMid = mid; this.prev = { x, y };
    }
    end() {
      if (!this.prev) return;
      const c = this.ctx;
      c.beginPath();
      c.moveTo(this.lastMid.x, this.lastMid.y);
      c.lineTo(this.prev.x, this.prev.y);
      c.stroke();
      this.prev = null; this.lastMid = null;
    }
  }

  global.PrecisionPen = PrecisionPen;
  global.StrokeRenderer = StrokeRenderer;
})(window);

/* =====================================================================
   HOW TO WIRE IT IN (3 steps)

   1) MediaPipe options (more accurate tracking):
        hands.setOptions({
          maxNumHands: 1,
          modelComplexity: 1,            // 1 = most accurate
          minDetectionConfidence: 0.7,
          minTrackingConfidence: 0.7,
        });
      Camera / video size:  width: 1280, height: 720

   2) Create once, after your drawing canvas context exists:
        const pen = new PrecisionPen();
        const stroke = new StrokeRenderer(drawCtx);   // drawCtx = the canvas you draw on
        // Set drawCtx.strokeStyle / lineWidth / shadowBlur from your colour + width sliders as usual.
        // IMPORTANT: draw on a separate persistent canvas; never clear it every frame.

   3) Inside your hands.onResults(results) replace the old draw logic with:
        const lm  = results.multiHandLandmarks && results.multiHandLandmarks[0];
        const mode = 'index';                     // or 'pinch' to match your Drawing Mode selector
        const r = pen.update(lm, performance.now(), drawCanvas.width, drawCanvas.height, true, mode);
        if (r.type === 'start')      stroke.begin(r.x, r.y);
        else if (r.type === 'move')  stroke.add(r.x, r.y);
        else if (r.type === 'end')   stroke.end();
        // 'hover' -> just move your cursor dot to r.x, r.y (don't draw)
        // 'hold'  -> do nothing; the stroke stays connected and resumes
   ===================================================================== */
