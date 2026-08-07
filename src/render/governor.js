// ============ PerformanceGovernor ============
// This is what lets the office hold 120 screaming employees, flying paper,
// exploding printers and blood decals while still hitting the frame target.
// Not prettier shaders — a closed loop that spends quality only when there is
// headroom, and gives it back the instant there is not.
//
// Two halves:
//
//   1. STATIC PRESET — detect-gpu classifies the machine once at boot, so a
//      potato laptop never has to *discover* it cannot run bloom by dropping
//      frames for ten seconds first.
//   2. DYNAMIC GOVERNOR — a slow control loop on the 1% low. Slow on purpose:
//      a governor that reacts to single frames oscillates, and visible quality
//      oscillation is worse than being one tier too low.
//
// Ordering matters. Dials are given back in the reverse order they were taken,
// and the things players notice least go first:
//   gibs → particles → decals → enemy animation rate → AI LOD → shadows → post-FX
//
// Post-FX is last because losing bloom changes how the whole game looks.

export const QUALITY_TIERS = ['potato', 'low', 'medium', 'high', 'ultra'];

/** Everything the governor is allowed to touch, per tier. */
// `decals` is a TOTAL across every decal kind. DECAL_KINDS sums to 410 at
// nominal, so `high` is deliberately 410 — a preset that silently scales the
// authored budgets down is a preset that makes "high" look worse than authored.
const PRESETS = {
  potato: { postfx: 'off', shadows: false, shadowSize: 512, maxGibs: 20, particles: 0.25, decals: 60, animBias: 2.2, lodBias: 1.8, pixelRatio: 1 },
  low: { postfx: 'off', shadows: true, shadowSize: 1024, maxGibs: 40, particles: 0.5, decals: 130, animBias: 1.7, lodBias: 1.45, pixelRatio: 1 },
  medium: { postfx: 'low', shadows: true, shadowSize: 1024, maxGibs: 80, particles: 0.75, decals: 250, animBias: 1.3, lodBias: 1.2, pixelRatio: 1.25 },
  high: { postfx: 'high', shadows: true, shadowSize: 2048, maxGibs: 120, particles: 1, decals: 410, animBias: 1, lodBias: 1, pixelRatio: 1.5 },
  ultra: { postfx: 'high', shadows: true, shadowSize: 4096, maxGibs: 140, particles: 1.25, decals: 560, animBias: 1, lodBias: 0.85, pixelRatio: 2 },
};

export class PerformanceGovernor {
  /** @param {import('../game/game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.enabled = true;
    this.targetFps = 60;
    this.tier = 'high';
    this.tierIndex = QUALITY_TIERS.indexOf('high');
    this.settings = { ...PRESETS.high };
    this.gpu = null;
    this.locked = false;          // true once the player picks a tier by hand

    this._sampleT = 0;
    this._holdT = 0;              // cooldown after a change, stops oscillation
    this._badStreak = 0;
    this._goodStreak = 0;
    this._lastFrameCount = -1;    // guards against judging throttled frames
    this.history = [];
    this.changes = [];            // audit trail, shown in the debug panel
  }

  /**
   * One-shot classification. Never blocks boot: a failed probe just keeps the
   * default tier.
   */
  async detect() {
    try {
      const { getGPUTier } = await import('detect-gpu');
      const t = await getGPUTier({ failIfMajorPerformanceCaveat: false });
      this.gpu = t;
      // detect-gpu tiers: 0 = unusable, 1 = low, 2 = mid, 3 = high
      const map = ['potato', 'low', 'medium', 'high'];
      let picked = map[Math.min(3, Math.max(0, t.tier ?? 2))];
      if (t.isMobile) picked = 'low';
      // a high-tier desktop GPU with a good fps estimate earns ultra
      if (t.tier >= 3 && (t.fps ?? 0) >= 120 && !t.isMobile) picked = 'ultra';
      this.applyTier(picked, 'gpu-detect');
      console.info(`[perf] GPU "${t.gpu ?? 'unknown'}" tier=${t.tier} → ${picked}`);
    } catch (err) {
      console.warn('[perf] GPU detection unavailable, staying on', this.tier, err?.message ?? err);
    }
    return this.tier;
  }

  /** @param {string} tier @param {string} reason */
  applyTier(tier, reason = 'manual') {
    if (!QUALITY_TIERS.includes(tier)) return;
    const prev = this.tier;
    this.tier = tier;
    this.tierIndex = QUALITY_TIERS.indexOf(tier);
    this.settings = { ...PRESETS[tier] };
    this._push(prev, tier, reason);
    this._apply();
  }

  _push(from, to, reason) {
    if (from === to) return;
    this.changes.push({ from, to, reason, at: Math.round(this.game.runTime ?? 0) });
    if (this.changes.length > 20) this.changes.shift();
  }

  /** Push the current settings into every system that consumes them. */
  _apply() {
    const g = this.game;
    const s = this.settings;

    g.postfx?.setQuality(s.postfx);

    if (g.renderer) {
      g.renderer.shadowMap.enabled = s.shadows;
      g.renderer.setPixelRatio(Math.min(devicePixelRatio, s.pixelRatio));
    }
    if (g.physics) g.physics.maxGibs = s.maxGibs;
    if (g.effects) g.effects.particleScale = s.particles;
    if (g.decals) g.decals.setBudget(s.decals);
    if (g.enemyLOD) g.enemyLOD.bias = s.lodBias;
    if (g.vfx) g.vfx.quality = s.particles;
  }

  /**
   * Slow closed loop. Called once per frame; acts at most every few seconds.
   * Judged on the 1% low, not the average — an average of 60 with a 22fps
   * worst percentile is a game that stutters, and the player feels the
   * percentile, not the mean.
   */
  update(dt) {
    if (!this.enabled || this.locked) return;
    this._sampleT += dt;
    this._holdT = Math.max(0, this._holdT - dt);
    if (this._sampleT < 1) return;
    this._sampleT = 0;

    const stats = this.game.frameStats;
    if (!stats || stats.count < 60) return;

    // A backgrounded tab has its rAF throttled to ~1 Hz, so frame times look
    // catastrophic while nothing is actually being rendered. Judging that would
    // drop an alt-tabbed player to potato and leave them there. Only act on
    // numbers that came from frames we actually drew since the last check.
    if (document.hidden) { this._badStreak = 0; this._goodStreak = 0; return; }
    if (stats.i === this._lastFrameCount) return;   // no new frames — stale sample
    this._lastFrameCount = stats.i;

    const budget = 1000 / this.targetFps;
    const p99 = stats.p99Ms;
    this.history.push(+p99.toFixed(1));
    if (this.history.length > 30) this.history.shift();

    // 1.35x budget = the 1% low has fallen to ~44fps at a 60 target
    if (p99 > budget * 1.35) {
      this._badStreak++;
      this._goodStreak = 0;
    } else if (p99 < budget * 0.75 && stats.avgMs < budget * 0.7) {
      this._goodStreak++;
      this._badStreak = 0;
    } else {
      this._badStreak = Math.max(0, this._badStreak - 1);
      this._goodStreak = Math.max(0, this._goodStreak - 1);
    }

    if (this._holdT > 0) return;

    // Drop fast (2 bad seconds), climb slowly (12 good ones). Being one tier
    // too low is invisible; flickering between tiers is not.
    if (this._badStreak >= 2 && this.tierIndex > 0) {
      this.applyTier(QUALITY_TIERS[this.tierIndex - 1], `p99 ${p99.toFixed(1)}ms > budget`);
      this._badStreak = 0;
      this._holdT = 8;
    } else if (this._goodStreak >= 12 && this.tierIndex < QUALITY_TIERS.length - 1) {
      this.applyTier(QUALITY_TIERS[this.tierIndex + 1], `headroom, p99 ${p99.toFixed(1)}ms`);
      this._goodStreak = 0;
      this._holdT = 20;   // longer, so we don't immediately bounce back down
    }
  }

  /** Player picked a tier in the settings menu — stop second-guessing them. */
  lockTo(tier) {
    this.locked = true;
    this.applyTier(tier, 'player choice');
  }

  unlock() { this.locked = false; }

  summary() {
    return {
      tier: this.tier,
      locked: this.locked,
      gpu: this.gpu?.gpu ?? 'unknown',
      targetFps: this.targetFps,
      p99: this.game.frameStats ? +this.game.frameStats.p99Ms.toFixed(1) : 0,
      lastChange: this.changes[this.changes.length - 1] ?? null,
    };
  }
}

export { PRESETS };
