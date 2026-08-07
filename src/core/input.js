// ============ keyboard / mouse / pointer-lock ============
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressedSet = new Set();
    this.mouseDown = [false, false, false];
    this.mousePressed = [false, false, false];
    this._dx = 0;
    this._dy = 0;
    // The sim can run more than one fixed step per rendered frame. Edge-triggered
    // input (key presses, clicks, accumulated mouse delta) must be seen by exactly
    // ONE of them or you get double jumps and doubled mouse sensitivity.
    this._edgeGate = true;
    this.locked = false;
    this.wantLock = false;
    this.onLockLost = null; // game hooks pause here

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressedSet.add(e.code);
      if (['Space', 'Tab', 'F1'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => { this.down.clear(); this.mouseDown = [false, false, false]; });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button <= 2) { this.mouseDown[e.button] = true; this.mousePressed[e.button] = true; }
    });
    addEventListener('mouseup', (e) => { if (e.button <= 2) this.mouseDown[e.button] = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this._dx += e.movementX;
      this._dy += e.movementY;
    });

    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      if (was && !this.locked && this.onLockLost) this.onLockLost();
    });
    document.addEventListener('pointerlockerror', () => { this.locked = false; });
  }

  lock() {
    this.wantLock = true;
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p?.catch) p.catch(() => {
        try {
          const q = this.canvas.requestPointerLock();
          if (q?.catch) q.catch(() => { /* pointer lock unavailable (embedded context) */ });
        } catch { /* unavailable */ }
      });
    } catch {
      try {
        const q = this.canvas.requestPointerLock();
        if (q?.catch) q.catch(() => { /* unavailable */ });
      } catch { /* unavailable */ }
    }
  }
  unlock() {
    this.wantLock = false;
    if (this.locked) document.exitPointerLock();
  }

  isDown(code) { return this.down.has(code); }
  pressed(code) { return this._edgeGate && this.pressedSet.has(code); }
  mouse(btn) { return this.mouseDown[btn]; }
  mouseClicked(btn) { return this._edgeGate && this.mousePressed[btn]; }

  // Accumulated look delta — readable only by the first sim step of a frame, so
  // sensitivity does not scale with how many fixed steps happened to run.
  get mouseDX() { return this._edgeGate ? this._dx : 0; }
  get mouseDY() { return this._edgeGate ? this._dy : 0; }

  /** @param {boolean} first true only for the first fixed step of a frame */
  beginSubstep(first) { this._edgeGate = first; }

  endFrame() {
    this._edgeGate = true;
    this.pressedSet.clear();
    this.mousePressed = [false, false, false];
    this._dx = 0;
    this._dy = 0;
  }
}
