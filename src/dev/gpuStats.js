// ============ GPU/CPU frame timing (stats-gl) ============
// FrameStats already tells us how long a frame took. It cannot tell us WHY.
// stats-gl reads real GPU timer queries (EXT_disjoint_timer_query_webgl2), so a
// 22ms frame resolves into "8ms CPU, 14ms GPU" — which is the difference between
// "the director is spawning too much" and "bloom at 4K is too expensive".
//
// Dev-only and lazily imported: it patches the three renderer to insert timer
// queries, which is not something a shipping build should carry.

let StatsCtor = null;

export class GpuStats {
  constructor() {
    this.stats = null;
    this.ready = false;
    this.visible = false;
  }

  /**
   * @param {import('three').WebGLRenderer} renderer
   * @returns {Promise<boolean>}
   */
  async attach(renderer) {
    if (this.stats) return this.ready;
    try {
      if (!StatsCtor) {
        const mod = await import('stats-gl');
        StatsCtor = mod.default ?? mod.Stats ?? mod;
      }
      this.stats = new StatsCtor({
        trackGPU: true,
        trackCPT: false,
        logsPerSecond: 4,
        graphsPerSecond: 30,
        samplesLog: 40,
        samplesGraph: 10,
        precision: 2,
      });
      // init() takes the renderer (it patches three's render call to bracket the
      // GPU timer around it) and resolves once the timer extension is probed.
      await this.stats.init(renderer);
      const dom = this.stats.dom ?? this.stats.container;
      if (dom) {
        dom.style.position = 'fixed';
        dom.style.left = '8px';
        dom.style.bottom = '8px';
        dom.style.top = 'auto';
        dom.style.zIndex = '9001';
        dom.style.display = 'none';
        document.body.appendChild(dom);
        this.dom = dom;
      }
      this.ready = true;
    } catch (err) {
      // No timer extension (common on Firefox and locked-down drivers) is not a
      // failure worth interrupting anyone over — we just lose the GPU split.
      console.warn('[perf] stats-gl unavailable:', err?.message ?? err);
      this.stats = null;
      this.ready = false;
    }
    return this.ready;
  }

  setVisible(on) {
    this.visible = on;
    if (this.dom) this.dom.style.display = on ? '' : 'none';
  }

  toggle() { this.setVisible(!this.visible); }

  /** Bracket the render call: begin() before, end() after. */
  begin() { if (this.ready && this.visible) this.stats.begin(); }

  end() {
    if (!this.ready || !this.visible) return;
    this.stats.end();
    this.stats.update();
  }

  dispose() {
    this.dom?.remove();
    this.stats = null;
    this.ready = false;
  }
}
