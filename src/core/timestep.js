// ============ fixed-timestep simulation driver ============
// The old loop fed raw frame delta straight into the sim, which means the game
// literally plays differently at 60 / 120 / 144 Hz: `vel -= vel * fr * dt` and
// `vel += accel * dt` are semi-implicit Euler, and their curves bend with dt.
// Dash distance, slide decay and jump apex all drift. This pins the simulation
// to a constant rate and lets the renderer run as fast as it likes.
//
// Slow-mo and hit-stop feed SCALED time into `advance()`, which is exactly right:
// fewer sim steps happen per real second, so the world moves in slow motion
// without any per-system special-casing.

export class FixedTimestep {
  /**
   * @param {{hz?: number, maxSubSteps?: number}} opts
   */
  constructor({ hz = 60, maxSubSteps = 5 } = {}) {
    this.hz = hz;
    this.step = 1 / hz;
    this.maxSubSteps = maxSubSteps;
    this.accum = 0;
    this.alpha = 0;          // 0..1 blend between last and next sim state
    this.stepsLastFrame = 0;
    this.droppedTime = 0;    // sim time discarded to avoid a death spiral
  }

  setRate(hz) {
    this.hz = hz;
    this.step = 1 / hz;
  }

  /**
   * @param {number} dt scaled frame delta in seconds
   * @param {(step: number, first: boolean) => void} simFn
   * @returns {number} number of steps run this frame
   */
  advance(dt, simFn) {
    this.accum += dt;
    let steps = 0;
    while (this.accum >= this.step && steps < this.maxSubSteps) {
      simFn(this.step, steps === 0);
      this.accum -= this.step;
      steps++;
    }
    // Hard stall (tab-out, GC pause, level build): throw the backlog away rather
    // than trying to catch up, which would only stall harder.
    if (this.accum >= this.step) {
      this.droppedTime += this.accum;
      this.accum = 0;
    }
    this.alpha = this.accum / this.step;
    this.stepsLastFrame = steps;
    return steps;
  }

  reset() {
    this.accum = 0;
    this.alpha = 0;
    this.stepsLastFrame = 0;
  }
}

/**
 * Rolling frame-time statistics for the perf overlay and telemetry.
 * Tracks the 1% low, which is what actually makes a game feel bad — an average
 * of 60fps with a 12fps worst percentile reads as "stuttery", not "smooth".
 */
export class FrameStats {
  constructor(window = 180) {
    this.window = window;
    this.samples = new Float32Array(window);
    this.i = 0;
    this.count = 0;
    this.fps = 0;
    this.avgMs = 0;
    this.p99Ms = 0;
    this._sorted = new Float32Array(window);
    this._recalc = 0;
  }

  push(ms) {
    this.samples[this.i] = ms;
    this.i = (this.i + 1) % this.window;
    this.count = Math.min(this.count + 1, this.window);
    if (--this._recalc > 0) return;
    this._recalc = 15; // recompute 4x/second, not every frame

    let sum = 0;
    for (let k = 0; k < this.count; k++) {
      const v = this.samples[k];
      sum += v;
      this._sorted[k] = v;
    }
    this.avgMs = sum / this.count;
    this.fps = this.avgMs > 0 ? 1000 / this.avgMs : 0;

    // "1% low" as the benchmarking world means it: the MEAN of the worst 1% of
    // frames, not the value sitting at the 99th percentile index. With a small
    // window the index form steps straight over a lone 90ms hitch and reports a
    // healthy number for a session that visibly stuttered.
    const slice = this._sorted.subarray(0, this.count);
    slice.sort();
    const worstN = Math.max(1, Math.floor(this.count * 0.01));
    let worstSum = 0;
    for (let k = this.count - worstN; k < this.count; k++) worstSum += slice[k];
    this.p99Ms = worstSum / worstN;
  }
}
