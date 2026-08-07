// ============ voice manager: priority, limits, spatialisation ============
// The failure mode this exists to prevent: a 40-enemy horde all firing in the
// same frame means 40 simultaneous oscillator voices. That is not "loud", it is
// a wall of mud that clips the master bus and drowns the sounds that carry
// information — hit confirms, special-infected signatures, low-HP warnings.
//
// Rules, in the order they are applied:
//   1. DISTANCE   — out past maxDist the sound is dropped, not just quietened.
//   2. COOLDOWN   — the same cue cannot retrigger inside its own cooldown.
//   3. POLYPHONY  — per-cue cap on concurrent voices.
//   4. BUDGET     — global cap on NEW voices per frame; ties broken by priority.
// Anything rejected by 2-4 is silently folded into the voice already playing,
// which is what a listener hears anyway.

/**
 * @typedef {{limit: number, cooldown: number, priority: number, maxDist: number}} VoiceRule
 */

const DEFAULT_RULE = { limit: 4, cooldown: 0.03, priority: 5, maxDist: 42 };

// priority 0 = never drop (player feedback), 9 = first to go (ambient chatter)
/** @type {Record<string, Partial<VoiceRule>>} */
export const VOICE_RULES = {
  // --- player feedback: always audible, these ARE the game's feedback loop ---
  hit: { limit: 6, cooldown: 0.012, priority: 0, maxDist: 1e9 },
  crit: { limit: 4, cooldown: 0.02, priority: 0, maxDist: 1e9 },
  'melee-hit': { limit: 4, cooldown: 0.02, priority: 0, maxDist: 1e9 },
  hurt: { limit: 2, cooldown: 0.12, priority: 0, maxDist: 1e9 },
  block: { limit: 2, cooldown: 0.05, priority: 0, maxDist: 1e9 },
  kill: { limit: 4, cooldown: 0.03, priority: 1, maxDist: 1e9 },
  levelup: { limit: 1, cooldown: 0.5, priority: 0, maxDist: 1e9 },
  item: { limit: 2, cooldown: 0.1, priority: 1, maxDist: 1e9 },
  'item-rare': { limit: 1, cooldown: 0.3, priority: 0, maxDist: 1e9 },
  coin: { limit: 3, cooldown: 0.04, priority: 4, maxDist: 1e9 },

  // --- special/boss signatures: these must cut through a horde (D 5.4) ---
  'karen-scream': { limit: 1, cooldown: 0.8, priority: 0, maxDist: 90 },
  'gossip-pop': { limit: 2, cooldown: 0.15, priority: 1, maxDist: 70 },
  roar: { limit: 1, cooldown: 0.6, priority: 0, maxDist: 90 },
  pounce: { limit: 2, cooldown: 0.2, priority: 1, maxDist: 70 },
  spit: { limit: 2, cooldown: 0.15, priority: 2, maxDist: 60 },
  horde: { limit: 1, cooldown: 1.0, priority: 0, maxDist: 1e9 },
  alarm: { limit: 1, cooldown: 0.5, priority: 1, maxDist: 1e9 },

  // --- the crowd: hard-limited, this is where the mud comes from ---
  smg: { limit: 3, cooldown: 0.03, priority: 6, maxDist: 40 },
  staple: { limit: 3, cooldown: 0.035, priority: 6, maxDist: 40 },
  zap: { limit: 3, cooldown: 0.04, priority: 6, maxDist: 35 },
  card: { limit: 3, cooldown: 0.04, priority: 6, maxDist: 40 },
  slip: { limit: 2, cooldown: 0.06, priority: 6, maxDist: 40 },
  turret: { limit: 2, cooldown: 0.06, priority: 7, maxDist: 30 },
  swing: { limit: 3, cooldown: 0.05, priority: 5, maxDist: 30 },
  phone: { limit: 2, cooldown: 0.2, priority: 8, maxDist: 30 },
  ui: { limit: 4, cooldown: 0.02, priority: 7, maxDist: 1e9 },

  explosion: { limit: 3, cooldown: 0.05, priority: 1, maxDist: 80 },
};

const MAX_NEW_VOICES_PER_FRAME = 22;

export class VoiceManager {
  /** @param {{sfx: (name: string, opt?: any) => void}} audio */
  constructor(audio) {
    this.audio = audio;
    this.listener = { x: 0, y: 0, z: 0 };
    this.active = new Map();   // name -> { count, cooldown }
    this.pending = [];
    this.frameBudget = MAX_NEW_VOICES_PER_FRAME;
    this.stats = { played: 0, dropped: 0, culled: 0 };
    this.enabled = true;
  }

  setListener(pos) {
    if (!pos) return;
    this.listener.x = pos.x; this.listener.y = pos.y; this.listener.z = pos.z;
  }

  /** @returns {VoiceRule} */
  rule(name) {
    const r = VOICE_RULES[name];
    return r ? { ...DEFAULT_RULE, ...r } : DEFAULT_RULE;
  }

  /**
   * Queue a sound. Positional sounds attenuate and cull; omit `pos` for UI and
   * first-person cues that should always play at full volume.
   * @param {string} name
   * @param {{pos?: {x:number,y:number,z:number}, vol?: number, priority?: number}} opts
   */
  play(name, { pos = null, vol = 1, priority = null } = {}) {
    if (!this.enabled) { this.audio.sfx(name, { vol }); return true; }
    const rule = this.rule(name);
    let gain = vol;

    if (pos) {
      const dx = pos.x - this.listener.x;
      const dy = pos.y - this.listener.y;
      const dz = pos.z - this.listener.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > rule.maxDist) { this.stats.culled++; return false; }
      // inverse-ish rolloff with a 4m "full volume" bubble around the listener
      gain *= 1 / (1 + Math.max(0, d - 4) * 0.085);
      if (gain < 0.035) { this.stats.culled++; return false; }
    }

    const st = this.active.get(name);
    if (st) {
      if (st.cooldown > 0) { this.stats.dropped++; return false; }
      if (st.count >= rule.limit) { this.stats.dropped++; return false; }
    }

    this.pending.push({ name, gain, priority: priority ?? rule.priority, rule });
    return true;
  }

  /** Flush the queue under the frame budget, loudest/most important first. */
  flush() {
    if (this.pending.length === 0) return;
    // Highest priority (lowest number) first; louder wins ties, since a loud
    // sound is a near sound and near sounds carry the information.
    this.pending.sort((a, b) => (a.priority - b.priority) || (b.gain - a.gain));

    let emitted = 0;
    let dropped = 0;
    for (const v of this.pending) {
      if (emitted >= this.frameBudget) { dropped++; continue; }

      // Polyphony has to be re-checked HERE, not only at play() time. Forty
      // enemies firing in the same frame all queue before a single flush has
      // run, so the play()-time check sees an empty active map and waves every
      // one of them through. This is the check that actually holds the line.
      let st = this.active.get(v.name);
      if (!st) { st = { count: 0, cooldown: 0 }; this.active.set(v.name, st); }
      if (st.count >= v.rule.limit) { dropped++; continue; }

      this.audio.sfx(v.name, { vol: v.gain });
      st.count++;
      st.cooldown = v.rule.cooldown;
      emitted++;
      this.stats.played++;
    }
    this.stats.dropped += dropped;
    this.pending.length = 0;
  }

  /** @param {number} dt real (unscaled) seconds — audio does not slow-mo */
  update(dt) {
    for (const [name, st] of this.active) {
      st.cooldown -= dt;
      // voices retire on a short decay; the synth's own envelopes are all < 0.7s
      st.count -= dt * 3.5;
      if (st.count <= 0 && st.cooldown <= 0) this.active.delete(name);
      else if (st.count < 0) st.count = 0;
    }
    this.flush();
  }

  resetStats() { this.stats = { played: 0, dropped: 0, culled: 0 }; }
}
