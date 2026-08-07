// ============ enemy AI + animation LOD ============
// The 100-enemy dream does not survive "every enemy thinks every frame". Most
// of them are behind you, behind a wall, or 40 metres away arguing with a
// filing cabinet — and none of that needs 60 Hz.
//
// Tiers by distance and visibility:
//
//   Tier 0  near / on screen     60 Hz   full navigation, perception, animation
//   Tier 1  mid                  20 Hz   simplified navigation
//   Tier 2  far                    5 Hz   strategic movement only
//   Tier 3  very far / unseen      1 Hz   abstract — walk the straight line home
//
// The critical detail is that a skipped tick is not a lost tick: an enemy that
// updates at 5 Hz gets called with the ACCUMULATED dt, so it covers the same
// ground at the same speed. Skipping without accumulating turns distant hordes
// into slow-motion stragglers, which players read as the game being broken.
//
// Tiers are re-evaluated on a rolling budget rather than for every enemy every
// frame, because the classification itself is not free at 120 enemies.

const TIERS = [
  { name: 'near', maxDist: 22, hz: 60, anim: 1 },
  { name: 'mid', maxDist: 45, hz: 20, anim: 2 },
  { name: 'far', maxDist: 75, hz: 5, anim: 4 },
  { name: 'distant', maxDist: Infinity, hz: 1, anim: 8 },
];

// Anything closer than this is always Tier 0 regardless of what else is true —
// a special that has closed to melee must never think at 5 Hz.
const ALWAYS_HOT = 12;

// Largest single integration handed to an enemy, and the most banked time we
// will ever try to work off at once (a long stall is written off, not replayed).
const MAX_SUBSTEP = 0.25;
const MAX_CATCHUP = 1.5;

export class EnemyLOD {
  /** @param {import('../game/game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.enabled = true;
    this.reclassifyPerFrame = 24;   // rolling budget
    this._cursor = 0;
    this.bias = 1;                  // PerformanceGovernor scales this: >1 = harsher LOD
    this.counts = [0, 0, 0, 0];
    this.stats = { updated: 0, skipped: 0 };
  }

  /** Fresh enemies start hot so they never pop in mid-think. */
  register(enemy) {
    enemy.lodTier = 0;
    enemy.lodAccum = 0;
    enemy.lodInterval = 0;
    enemy.lodPhase = Math.random();  // de-sync the herd's think frames
    enemy.animSkip = 0;
    enemy.animAccum = 0;
  }

  /**
   * Run every enemy at its tier's rate.
   * @param {number} dt
   * @param {(e: any, edt: number) => boolean} tick returns false to remove
   * @returns {Array<any>} enemies that asked to be removed
   */
  update(dt, tick) {
    const g = this.game;
    const enemies = g.enemies;
    const dead = [];
    this.counts[0] = this.counts[1] = this.counts[2] = this.counts[3] = 0;
    this.stats.updated = 0;
    this.stats.skipped = 0;

    const player = g.player;
    const px = player?.pos.x ?? 0;
    const pz = player?.pos.z ?? 0;

    // reclassify a slice of the roster this frame
    if (this.enabled && enemies.length) {
      const n = Math.min(this.reclassifyPerFrame, enemies.length);
      for (let i = 0; i < n; i++) {
        this._cursor = (this._cursor + 1) % enemies.length;
        this._classify(enemies[this._cursor], px, pz);
      }
    }

    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (e.lodTier === undefined) this.register(e);

      // Bosses, latched specials and anything mid-attack always run hot: an
      // attack that resolves on a 5 Hz tick is an unfair hit.
      const forceHot = !this.enabled || e.def?.boss || e.state === 'latched'
        || e.windupT > 0 || e.netPuppet;

      this.counts[forceHot ? 0 : e.lodTier]++;

      if (forceHot) {
        if (!tick(e, dt)) dead.push(e);
        this.stats.updated++;
        continue;
      }

      e.lodAccum += dt;
      if (e.lodAccum < e.lodInterval) { this.stats.skipped++; continue; }

      // SUB-STEP the banked time; do not clamp it. A 1 Hz enemy banks a full
      // second, and integrating that in one go would teleport it through walls
      // — but clamping to 0.25 silently throws 75% of its movement away, which
      // is what turns a distant horde into slow-motion stragglers. Conserve the
      // time, bound each individual step.
      let remaining = Math.min(e.lodAccum, MAX_CATCHUP);
      e.lodAccum = 0;
      let alive = true;
      while (remaining > 1e-4 && alive) {
        const s = Math.min(remaining, MAX_SUBSTEP);
        alive = tick(e, s);
        remaining -= s;
      }
      if (!alive) dead.push(e);
      this.stats.updated++;
    }
    return dead;
  }

  _classify(e, px, pz) {
    if (!e || e.dead) return;
    const dx = e.pos.x - px, dz = e.pos.z - pz;
    const d = Math.sqrt(dx * dx + dz * dz);

    if (d < ALWAYS_HOT) {
      e.lodTier = 0;
      e.lodInterval = 0;
      e.animSkip = 0;
      return;
    }

    let tier = 3;
    for (let i = 0; i < TIERS.length; i++) {
      if (d <= TIERS[i].maxDist * (1 / this.bias)) { tier = i; break; }
    }

    // Something you cannot see does not need to think at the rate of something
    // you can — drop it one tier, but never past the last one.
    if (tier > 0 && this.game.level?.losBlocked(e.pos.x, e.pos.z, px, pz)) {
      tier = Math.min(TIERS.length - 1, tier + 1);
    }

    const t = TIERS[tier];
    e.lodTier = tier;
    e.lodInterval = t.hz >= 60 ? 0 : (1 / t.hz) * (0.85 + e.lodPhase * 0.3);
    e.animSkip = Math.round(t.anim * this.bias) - 1;
  }

  /**
   * Animation LOD, applied at render time. Near enemies get every frame; far
   * ones get every Nth and hold the pose between, which is invisible at 40m and
   * is most of the cost of a crowd.
   * @returns {boolean} whether this enemy should advance its visual this frame
   */
  shouldAnimate(e, dt) {
    if (!this.enabled || !e.animSkip) return true;
    e.animAccum = (e.animAccum ?? 0) + 1;
    if (e.animAccum <= e.animSkip) return false;
    e.animAccum = 0;
    return true;
  }

  summary() {
    return {
      near: this.counts[0], mid: this.counts[1], far: this.counts[2], distant: this.counts[3],
      updated: this.stats.updated, skipped: this.stats.skipped,
      bias: +this.bias.toFixed(2),
    };
  }
}

export { TIERS };
