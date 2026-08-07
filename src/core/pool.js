// ============ object pooling ============
// Mandatory for this game. At peak the office produces bullets, shell casings,
// hit sparks, paper confetti, damage numbers, gibs, decals and pickups by the
// hundred per second. `new Thing()` + `scene.add()` + `scene.remove()` at that
// rate is not a rendering cost, it is a *GC* cost: allocation churn produces
// exactly the intermittent 40ms frame spikes that make a 60fps game feel bad.
//
// Contract:
//   const p = new Pool({ create, reset, capacity })
//   const item = p.acquire()      // never null unless capacity is hit
//   p.release(item)               // back to the free list
//   p.releaseAll()                // floor change / run teardown
//
// The pool never shrinks. That is deliberate — steady-state memory in a wave
// shooter is the high-water mark anyway, and shrinking just guarantees you
// re-allocate during the next wave.

export class Pool {
  /**
   * @param {{
   *   create: () => any,
   *   reset?: (item: any) => void,
   *   dispose?: (item: any) => void,
   *   capacity?: number,
   *   prewarm?: number,
   *   name?: string,
   * }} opts
   */
  constructor({ create, reset = null, dispose = null, capacity = 512, prewarm = 0, name = 'pool' }) {
    this._create = create;
    this._reset = reset;
    this._dispose = dispose;
    this.capacity = capacity;
    this.name = name;
    this.free = [];
    this.live = new Set();
    this.created = 0;
    this.peak = 0;
    this.starved = 0;      // times we hit capacity — surfaces in the debug panel
    for (let i = 0; i < prewarm; i++) this.free.push(this._make());
  }

  _make() {
    this.created++;
    return this._create();
  }

  /** @returns {any|null} null only when capacity is exhausted */
  acquire() {
    let item = this.free.pop();
    if (!item) {
      if (this.live.size >= this.capacity) {
        this.starved++;
        return null;
      }
      item = this._make();
    }
    this.live.add(item);
    if (this.live.size > this.peak) this.peak = this.live.size;
    return item;
  }

  /**
   * Acquire, recycling the oldest live item when full instead of failing.
   * Right for cosmetics (gibs, decals, particles) where "the oldest blood splat
   * disappears" beats "no blood splat appears".
   */
  acquireRecycling() {
    const item = this.acquire();
    if (item) return item;
    const oldest = this.live.values().next().value;
    if (oldest === undefined) return null;
    this.release(oldest);
    return this.acquire();
  }

  release(item) {
    if (!this.live.delete(item)) return false;   // double-release is a no-op
    this._reset?.(item);
    this.free.push(item);
    return true;
  }

  releaseAll() {
    for (const item of this.live) {
      this._reset?.(item);
      this.free.push(item);
    }
    this.live.clear();
  }

  /** Full teardown — only on shutdown, not between floors. */
  destroy() {
    this.releaseAll();
    if (this._dispose) for (const item of this.free) this._dispose(item);
    this.free.length = 0;
    this.created = 0;
  }

  get size() { return this.live.size; }
  get idle() { return this.free.length; }

  stats() {
    return {
      name: this.name,
      live: this.live.size,
      free: this.free.length,
      created: this.created,
      peak: this.peak,
      starved: this.starved,
      capacity: this.capacity,
    };
  }
}

/**
 * Registry so the debug panel and the PerformanceGovernor can see every pool at
 * once — "which pool is starving" is the first question when the frame time
 * spikes during a horde.
 */
export class PoolManager {
  constructor() {
    /** @type {Map<string, Pool>} */
    this.pools = new Map();
  }

  /** @returns {Pool} */
  register(name, opts) {
    const p = new Pool({ ...opts, name });
    this.pools.set(name, p);
    return p;
  }

  get(name) { return this.pools.get(name) ?? null; }

  /** Between floors: hand everything back without freeing the buffers. */
  releaseAll() {
    for (const p of this.pools.values()) p.releaseAll();
  }

  destroy() {
    for (const p of this.pools.values()) p.destroy();
    this.pools.clear();
  }

  stats() {
    return [...this.pools.values()].map((p) => p.stats());
  }

  /** Total live objects across every pool — one number for the perf overlay. */
  get totalLive() {
    let n = 0;
    for (const p of this.pools.values()) n += p.live.size;
    return n;
  }
}
