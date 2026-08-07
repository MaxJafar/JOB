// ============ 2D locomotion blend space ============
// `speedNorm > 0.12 ? 'run' : 'idle'` (models.js:174) is why every character in
// this game currently reads as a wind-up toy: two poses, one hard switch, and the
// authored `walk` clip never plays at all. This replaces that decision with a
// continuous weighted blend over a 2D plane of local-space velocity.
//
//        +z forward
//            runF
//         walkF
//   runL walkL  idle  walkR runR      +x strafe right
//         walkB
//            runB
//
// AXIS CONVENTION — read this before touching a sign:
//   The blend space uses +z = FORWARD. Characters face -Z in model space
//   (CHARACTER_ART_SPEC §1), so world velocity must be rotated AND negated on z
//   to get here. `localVelocity()` below does exactly that; use it rather than
//   rederiving, because a flipped z silently plays the backpedal clip while the
//   character walks forward and nobody notices for a week.
//
// The three things this file exists to guarantee:
//
//   1. WEIGHTS ALWAYS SUM TO 1. Not "usually", not "unless the query lands in a
//      gap". A blend tree that sums to 0.7 does not look like a 70%-blended
//      character, it looks like a character sinking into the floor, because the
//      remaining 0.3 is the bind pose leaking through the mixer.
//
//   2. MISSING CLIPS DEGRADE, NEVER BREAK. The shipped clip contract is
//      idle/run/walk plus one-shots — there are NO directional clips yet. So the
//      degraded path is the DEFAULT path, not an edge case: with idle+walk+run
//      the space collapses to a clean 1D forward blend, and a rig with only
//      `idle` still emits { idle: 1 } forever instead of NaN or silence.
//
//   3. ZERO ALLOCATION PER FRAME. Every array is sized once in rebuild(); update()
//      only writes numbers into objects that already exist. The weights object
//      keeps its identity across rebuilds so a controller that cached the
//      reference before the GLB finished loading does not end up writing into a
//      dead object.
//
// Everything tunable is exported as plain data. SPEED_CURVE and BLEND_TUNING are
// read live every frame through `this.curve` / `this.tuning` — mutate them from
// the console and the next frame uses the new values, no rebuild, no reload.
// LOCOMOTION_SAMPLES is NOT live: rebuild() snapshots each sample's x/z into the
// _sx/_sz typed arrays and reads `clips` only while resolving, so editing the
// table requires a rebuild() call to take effect.

import { Damper } from '../core/spring.js';

// ---------------------------------------------------------------- tunable data

/**
 * Speed → blend response. Both curves are piecewise-linear LUTs of [x, y] pairs
 * sorted ascending on x; edit in place at runtime and the change is live.
 *
 * `radius` maps normalised planar speed (1 = full run) to the RADIUS of the
 * query point in the blend plane. The flat 0 shelf up to 0.12 is the deadzone:
 * it is what stops a character nudged by a physics push or a stopping-friction
 * frame from twitching a half-step of walk. The knee at 0.35 is deliberately
 * early so the walk cycle owns most of the low-speed band — the failure mode of
 * a linear ramp is that walk only ever appears as a 20%-weighted ghost.
 *
 * `rate` maps the SAME normalised speed to a clip time scale. Beyond 1.0 we stop
 * extrapolating the space (there is no sample out there) and speed the run clip
 * up instead, which is what keeps a dash from footsliding. Player speedNorm is
 * unclamped upstream (dash and knockback push well past 1), so the LUT is
 * defined out to 1.8 rather than left to the clamp.
 */
export const SPEED_CURVE = {
  // hysteresis band around the deadzone — see BlendSpace2D.moving
  moveOn: 0.14,
  moveOff: 0.07,
  radius: [[0, 0], [0.12, 0], [0.35, 0.45], [0.7, 0.85], [1, 1], [1.8, 1]],
  rate: [[0, 1], [1, 1], [1.4, 1.18], [1.8, 1.3]],
};

/** Solver knobs. Also live-tunable. */
export const BLEND_TUNING = {
  // Kernel radius in blend-space units. MUST exceed the largest gap between
  // adjacent samples or a query can land outside every kernel; 1.1 covers the
  // 0.707 diagonal-to-cardinal gap with room to spare. Shrinking this below ~0.8
  // is the one setting that can trip the nearest-sample emergency path.
  radius: 1.1,
  // Shepard exponent. 2 is the sweet spot and is special-cased to avoid pow().
  power: 2,
  // Weights under this are zeroed and the rest renormalised. A 0.2% contribution
  // is invisible but still costs a full PropertyMixer pass every frame.
  cull: 0.004,
  // Input smoothing. Damper is critically damped and unconditionally stable, so
  // this survives the LOD substep loop handing us wildly irregular dt.
  velocitySmooth: 0.08,
  rateMin: 0.35,
  rateMax: 1.8,
  // With no backward clip, playing the forward cycle at -1 rate reads as a real
  // backpedal. Set false if a rig's forward clip has asymmetric arm swing that
  // looks wrong reversed — you get a moonwalk instead, which is the lesser evil
  // compared to a character sliding backwards in the idle pose.
  reverseBackpedal: true,
};

/**
 * The sample table. `x` is strafe-right, `z` is forward, both in units where 1 =
 * full run speed. `clips` is an ordered candidate list; the first name the rig
 * actually resolves wins, and a sample whose whole list misses is dropped from
 * the solve entirely.
 *
 * Note what is NOT here: no cross-axis aliases. walkL does not fall back to
 * 'walk'. Degradation is decided once, explicitly, in _build() — an accidental
 * alias would make a sidestep play the forward cycle at full weight while the
 * space still believed it had lateral coverage, and the fold below would never
 * run.
 */
export const LOCOMOTION_SAMPLES = [
  { id: 'idle', x: 0, z: 0, clips: ['idle', 'idle_a', 'stand'] },
  { id: 'walkF', x: 0, z: 0.45, clips: ['walk', 'walk_forward', 'walk_f'] },
  { id: 'runF', x: 0, z: 1, clips: ['run', 'sprint', 'run_forward', 'run_f'] },
  { id: 'walkB', x: 0, z: -0.45, clips: ['walk_back', 'walk_backward', 'walk_b'] },
  { id: 'runB', x: 0, z: -1, clips: ['run_back', 'run_backward', 'run_b'] },
  { id: 'walkL', x: -0.45, z: 0, clips: ['walk_left', 'strafe_left', 'walk_l'] },
  { id: 'walkR', x: 0.45, z: 0, clips: ['walk_right', 'strafe_right', 'walk_r'] },
  { id: 'runL', x: -1, z: 0, clips: ['run_left', 'strafe_run_left', 'run_l'] },
  { id: 'runR', x: 1, z: 0, clips: ['run_right', 'strafe_run_right', 'run_r'] },
  { id: 'runFL', x: -0.71, z: 0.71, clips: ['run_fl', 'run_forward_left'] },
  { id: 'runFR', x: 0.71, z: 0.71, clips: ['run_fr', 'run_forward_right'] },
  { id: 'runBL', x: -0.71, z: -0.71, clips: ['run_bl', 'run_back_left'] },
  { id: 'runBR', x: 0.71, z: -0.71, clips: ['run_br', 'run_back_right'] },
];

// A sample counts as off-axis past this. Loose enough that a hand-tuned table
// with a 0.02 nudge on a forward sample is still treated as forward.
const AXIS_EPS = 0.05;

// ------------------------------------------------------------------- helpers

/**
 * Piecewise-linear LUT lookup. Allocation-free: indexes the pairs rather than
 * destructuring them, because array destructuring runs the iterator protocol and
 * allocates on every call — invisible in a benchmark, a GC sawtooth at 120
 * characters.
 * @param {Array<[number, number]>} lut sorted ascending on x
 */
export function sampleCurve(lut, x) {
  if (!lut || lut.length === 0) return 0;
  const n = lut.length;
  if (!(x > lut[0][0])) return lut[0][1];          // also catches NaN input
  if (x >= lut[n - 1][0]) return lut[n - 1][1];
  for (let i = 1; i < n; i++) {
    const bx = lut[i][0];
    if (x <= bx) {
      const ax = lut[i - 1][0];
      const span = bx - ax;
      // Duplicate x values are legal — they express a step. Dividing by that
      // zero span would hand back NaN and poison every downstream damper.
      if (span <= 1e-9) return lut[i][1];
      return lut[i - 1][1] + (lut[i][1] - lut[i - 1][1]) * ((x - ax) / span);
    }
  }
  return lut[n - 1][1];
}

/** Shared output for localVelocity — overwritten on every call, never retained. */
const _local = { x: 0, z: 0 };

/**
 * World planar velocity → blend-space local velocity.
 *
 * Characters face -Z, so "forward" is the NEGATIVE local z axis, and the blend
 * space wants forward positive. Both flips are folded into the z line below. If
 * you inline this and get a backwards character, that is the line.
 *
 * @param {number} wx world velocity x
 * @param {number} wz world velocity z
 * @param {number} yaw character rotation.y in radians
 * @param {{x:number,z:number}} out mutated in place (Damper3.to idiom)
 * @returns {{x:number,z:number}} out — x = strafe right, z = forward
 */
export function localVelocity(wx, wz, yaw, out = _local) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  out.x = wx * c - wz * s;              // local +X = right
  out.z = -(wx * s + wz * c);           // local -Z = forward, so negate
  return out;
}

/**
 * Accept anything that can answer "does this rig have this clip".
 * Order matters: AnimationController.resolve() understands CLIP_ALIASES, so it
 * is preferred over a bare has() that only does exact matches.
 */
function toResolver(src) {
  let fn = null;
  if (typeof src === 'function') fn = src;
  else if (src && typeof src.resolve === 'function') fn = (n) => src.resolve(n);
  else if (src && src.actions instanceof Map) fn = (n) => (src.actions.has(n) ? n : null);
  else if (typeof src?.has === 'function') fn = (n) => (src.has(n) ? n : null);
  else if (Array.isArray(src)) { const set = new Set(src); fn = (n) => (set.has(n) ? n : null); }
  if (!fn) return () => null;
  // A resolver is caller-supplied code running during asset load. Never let it
  // take the frame down — a rig with an exotic resolver degrades to "no clips",
  // which is a boring character, not a crash.
  return (n) => {
    try {
      const r = fn(n);
      return typeof r === 'string' && r.length > 0 ? r : null;
    } catch {
      return null;
    }
  };
}

// -------------------------------------------------------------- the blend space

export class BlendSpace2D {
  /**
   * @param {{
   *   resolve?: Function|Map|Set|Array<string>|{resolve?:Function,has?:Function,actions?:Map},
   *   samples?: Array<{id:string,x:number,z:number,clips:string[]}>,
   *   curve?: typeof SPEED_CURVE,
   *   tuning?: typeof BLEND_TUNING,
   *   maxSpeed?: number,
   * }} opts
   */
  constructor({
    resolve = null,
    samples = LOCOMOTION_SAMPLES,
    curve = SPEED_CURVE,
    tuning = BLEND_TUNING,
    maxSpeed = 1,
  } = {}) {
    this.samples = samples;
    this.curve = curve;
    this.tuning = tuning;
    /** Speed in m/s that maps to blend radius 1. Callers may override per-update. */
    this.maxSpeed = maxSpeed > 1e-4 ? maxSpeed : 1;

    /** Resolved clip names, stable order. Iterate this — Object.keys() allocates. */
    this.names = [];
    /** name -> weight, sums to exactly 1 whenever `valid`. Identity is stable. */
    this.weights = {};

    this.playRate = 1;
    this.magnitude = 0;        // smoothed normalised speed, UNclamped
    this.moving = false;       // hysteresis-latched
    this.backpedal = false;
    this.dominant = null;      // heaviest clip — footstep timing, debug HUD
    this.idleName = null;
    this.hasLateral = false;
    this.hasBackward = false;

    // Input smoothing. Two independent dampers rather than one on the magnitude:
    // smoothing the magnitude alone lets the DIRECTION snap, which pops the
    // whole blend when a player flicks from forward to strafe.
    this._dx = new Damper(0, tuning.velocitySmooth);
    this._dz = new Damper(0, tuning.velocitySmooth);

    this._resolveSrc = resolve;
    this._slot = null;         // sample index -> names index, -1 = dropped
    this._sx = null;
    this._sz = null;
    this._w = null;
    // Authored cycle length per resolved clip, so applyTo can keep co-active
    // locomotion clips in phase. Measured lazily in applyTo — see _measureCycles.
    this._cycleDur = null;     // names index -> clip duration in seconds, 0 = unknown
    this._cycleReady = false;
    this.rebuild(resolve, samples);
  }

  /** True once at least one clip resolved. False means: fall back to your own path. */
  get valid() { return this.names.length > 0; }

  // ------------------------------------------------------------------- build

  /**
   * Resolve the sample table against a rig's actual clip set. Cheap enough to
   * call again when clips arrive late (models.js loads _anims.glb asynchronously,
   * so a character can exist for several frames before it has any).
   */
  rebuild(resolve = this._resolveSrc, samples = this.samples) {
    this._resolveSrc = resolve;
    this.samples = Array.isArray(samples) ? samples : [];
    const res = toResolver(resolve);
    const n = this.samples.length;

    if (!this._slot || this._slot.length !== n) {
      this._slot = new Int32Array(n);
      this._sx = new Float64Array(n);
      this._sz = new Float64Array(n);
      this._w = new Float64Array(n);
      this._cycleDur = new Float64Array(n);
    }
    // The clip set just changed, so any measured duration is stale. 0 means
    // "unknown", which applyTo reads as "leave this clip's rate alone". Sized by
    // samples.length but indexed by names index, which is never larger.
    this._cycleDur.fill(0);
    this._cycleReady = false;

    // Keep the SAME weights object. A controller that grabbed this reference in
    // its constructor would otherwise keep writing into an orphan after the
    // clips land, and every weight it pushes would read as 0.
    for (const k of Object.keys(this.weights)) delete this.weights[k];
    this.names.length = 0;
    this.idleName = null;

    const index = new Map();     // resolved clip name -> names index (build-time only)
    const axisNames = new Set(); // names claimed by forward/idle samples

    for (let i = 0; i < n; i++) {
      this._slot[i] = -1;
      const s = this.samples[i];
      if (!s || !Array.isArray(s.clips)) continue;

      let hit = null;
      for (let c = 0; c < s.clips.length; c++) {
        hit = res(s.clips[c]);
        if (hit) break;
      }
      if (!hit) continue;

      let idx = index.get(hit);
      if (idx === undefined) {
        idx = this.names.length;
        this.names.push(hit);
        index.set(hit, idx);
        this.weights[hit] = 0;
      }
      this._slot[i] = idx;
      this._sx[i] = Number.isFinite(s.x) ? s.x : 0;
      this._sz[i] = Number.isFinite(s.z) ? s.z : 0;

      const lateral = Math.abs(this._sx[i]) >= AXIS_EPS;
      const backward = this._sz[i] <= -AXIS_EPS;
      if (!lateral && !backward) axisNames.add(hit);
      if (!lateral && Math.abs(this._sz[i]) < AXIS_EPS) this.idleName = hit;
    }

    // Coverage: an off-axis sample only counts if it resolved to a clip the
    // forward axis is not already using. Two samples sharing one clip is legal
    // (their weights sum — see the += in update) but it does NOT mean the rig
    // can actually animate that direction.
    this.hasLateral = false;
    this.hasBackward = false;
    for (let i = 0; i < n; i++) {
      if (this._slot[i] < 0) continue;
      const name = this.names[this._slot[i]];
      if (axisNames.has(name)) continue;
      if (Math.abs(this._sx[i]) >= AXIS_EPS) this.hasLateral = true;
      if (this._sz[i] <= -AXIS_EPS) this.hasBackward = true;
    }

    this.reset();
    return this;
  }

  /** Teleport / respawn / floor change: drop all smoothing state, snap to idle. */
  reset() {
    this._dx.snap(0);
    this._dz.snap(0);
    this.moving = false;
    this.backpedal = false;
    this.magnitude = 0;
    this.playRate = 1;
    for (let i = 0; i < this.names.length; i++) this.weights[this.names[i]] = 0;
    this.dominant = this.idleName ?? this.names[0] ?? null;
    if (this.dominant) this.weights[this.dominant] = 1;
    return this;
  }

  // ------------------------------------------------------------------ solve

  /**
   * The per-frame call. Allocation-free.
   *
   * @param {number} dt seconds
   * @param {number} vx LOCAL velocity, +x = strafe right (m/s)
   * @param {number} vz LOCAL velocity, +z = forward (m/s) — see localVelocity()
   * @param {number} [maxSpeed] speed that maps to blend radius 1
   * @returns {Record<string, number>} this.weights, summing to 1
   */
  update(dt, vx, vz, maxSpeed = this.maxSpeed) {
    const w = this.weights;
    const names = this.names;
    const nn = names.length;

    this.playRate = 1;
    this.backpedal = false;
    if (nn === 0) {
      // No clips resolved at all. Say so honestly and let the owner keep using
      // whatever it did before; do not fabricate weights for names that do not
      // exist, which would make the controller call setEffectiveWeight on null.
      this.moving = false;
      this.magnitude = 0;
      this.dominant = null;
      return w;
    }
    for (let i = 0; i < nn; i++) w[names[i]] = 0;

    const T = this.tuning;
    const C = this.curve;

    // ---- 1. sanitise, normalise, smooth ---------------------------------
    // A single NaN reaching a Damper poisons its stored velocity permanently and
    // the rig freezes in whatever pose it held — no error, no recovery. Physics
    // hands out NaN more often than anyone admits, so gate the input AND re-seat
    // the damper if it ever got through.
    const scale = maxSpeed > 1e-4 ? 1 / maxSpeed : 1;
    const tx = Number.isFinite(vx) ? vx * scale : 0;
    const tz = Number.isFinite(vz) ? vz * scale : 0;
    if (!Number.isFinite(this._dx.value) || !Number.isFinite(this._dz.value)) {
      this._dx.snap(0);
      this._dz.snap(0);
    }
    // Clamp dt rather than trusting it: the LOD substep loop feeds sub-frame
    // slices and a tab-out feeds seconds. Damper is stable either way, but the
    // hysteresis timing below is not.
    const sdt = Number.isFinite(dt) && dt > 0 ? (dt > 0.25 ? 0.25 : dt) : 0;
    const nx = this._dx.to(tx, sdt, T.velocitySmooth);
    const nz = this._dz.to(tz, sdt, T.velocitySmooth);

    const mag = Math.sqrt(nx * nx + nz * nz);
    this.magnitude = mag;

    // ---- 2. deadzone + hysteresis ---------------------------------------
    // Two thresholds, not one. A single threshold plus any noise on the velocity
    // — stopping friction, a separation push from a neighbouring enemy, a
    // network-interpolated remote player — makes the character strobe between
    // idle and walk at exactly the speed a player spends most of their time
    // hovering around. The curve's flat 0 shelf covers the same failure from the
    // other side; belt and braces, because a tuner is free to delete the shelf.
    if (this.moving) { if (mag < C.moveOff) this.moving = false; }
    else if (mag > C.moveOn) this.moving = true;

    // ---- 3. speed -> query radius (DATA) --------------------------------
    const radius = sampleCurve(C.radius, this.moving ? mag : 0);
    let qx = 0, qz = 0;
    if (mag > 1e-6 && radius > 0) {
      // Re-length the smoothed direction to the curve's radius. Direction comes
      // from the raw magnitude, not the gated one, so the heading stays correct
      // right down to the deadzone edge.
      const k = radius / mag;
      qx = nx * k;
      qz = nz * k;
    }

    // ---- 4. fold the query onto the axes this rig actually has -----------
    // ORDER IS LOAD-BEARING. The lateral fold runs FIRST because it can flip the
    // sign of qz, and the backpedal fold below must see the folded value. Run
    // them the other way round and a sidestep on a rig with no strafe clips
    // produces a full-magnitude BACKWARD query that nothing folds back — on the
    // shipped idle/walk/run set both forward samples then sit outside the kernel
    // radius and the solver returns { idle: 1 } at full speed, forever.
    if (!this.hasLateral && qx !== 0) {
      // No strafe clips. Do NOT just drop the lateral component — a pure
      // sidestep would then query the origin and the character would slide at
      // full speed in the idle pose, which is the single worst-looking bug in
      // this whole system. Fold the magnitude onto the forward axis instead so a
      // sidestep at least plays the walk/run cycle.
      const m = Math.sqrt(qx * qx + qz * qz);
      // Same -1e-6 epsilon as the backpedal test below, and for the same reason:
      // a Damper asymptotes and never actually reaches 0, so a character that
      // ever moved backwards carries a denormal negative qz for the rest of its
      // life. A bare `qz < 0` reads that dust as "backpedalling" and throws the
      // whole sidestep onto the -z axis with no second pass to catch it.
      qz = qz < -1e-6 ? -m : m;
      qx = 0;
    }
    let rateSign = 1;
    if (!this.hasBackward && qz < -1e-6) {
      this.backpedal = true;
      if (T.reverseBackpedal) {
        // Mirror through the origin and run the clip backwards. Geometrically
        // this is exact: the forward-right cycle reversed IS a back-left cycle.
        qx = -qx;
        qz = -qz;
        rateSign = -1;
      } else {
        qz = -qz;   // moonwalk: wrong-footed, but the legs move
      }
    }

    // ---- 5. modified-Shepard scatter interpolation ----------------------
    // Plain inverse-distance leaks: at a full forward run the left and right
    // samples still contribute a percent or two each, and the character strafes
    // faintly while sprinting straight. The Franke–Little form below multiplies
    // by (R-d)/R so a sample's influence reaches EXACTLY zero at radius R —
    // local support, still exact at the nodes, still C0 everywhere, and unlike
    // k-nearest it has no set-membership pop when a sample drops out.
    const slot = this._slot, sx = this._sx, sz = this._sz, sw = this._w;
    const R = T.radius > 1e-4 ? T.radius : 1e-4;
    const P = T.power;
    const ns = this.samples.length;
    let total = 0, exact = -1, bestI = -1, bestD = Infinity;

    for (let i = 0; i < ns; i++) {
      if (slot[i] < 0) continue;
      const dx = qx - sx[i], dz = qz - sz[i];
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < bestD) { bestD = d; bestI = i; }
      if (d < 1e-5) { exact = i; break; }   // sitting on a node: 1/d would blow up
      if (d >= R) { sw[i] = 0; continue; }
      const t = (R - d) / (R * d);
      sw[i] = P === 2 ? t * t : Math.pow(t, P);
      total += sw[i];
    }

    if (exact >= 0) {
      w[names[slot[exact]]] = 1;
    } else if (total > 0) {
      const inv = 1 / total;
      for (let i = 0; i < ns; i++) {
        const k = slot[i];
        if (k < 0 || sw[i] <= 0) continue;
        // `+=`, never `=`: a custom table may point two samples at the same clip
        // and an overwrite would quietly drop the other one's share, leaving the
        // total below 1 and the bind pose bleeding through.
        w[names[k]] += sw[i] * inv;
      }
    } else if (bestI >= 0) {
      // Every kernel missed. Only reachable by live-tuning `radius` below the
      // sample spacing, but an all-zero weight set renders as a T-pose, so snap
      // to the nearest sample rather than emit one.
      w[names[slot[bestI]]] = 1;
    } else {
      w[names[0]] = 1;
    }

    // ---- 6. cull dust, renormalise, pick the dominant clip ---------------
    let sum = 0, top = 0, dom = null;
    const cull = T.cull;
    for (let i = 0; i < nn; i++) {
      const name = names[i];
      let v = w[name];
      // Written as `!(v > cull)` so a NaN that survived everything above still
      // lands on 0. `v < cull` is false for NaN and would propagate it into the
      // normalisation and out to every action on the mixer.
      if (!(v > cull)) v = 0;
      w[name] = v;
      sum += v;
      if (v > top) { top = v; dom = name; }
    }
    if (sum > 0) {
      const inv = 1 / sum;
      for (let i = 0; i < nn; i++) w[names[i]] *= inv;
    } else {
      // Cannot happen with sane tuning (the max weight is always >= 1/nn), but
      // the invariant "sums to 1" is load-bearing for the caller, so enforce it.
      dom = this.idleName ?? names[0];
      w[dom] = 1;
    }
    this.dominant = dom;

    // ---- 7. play rate (DATA) --------------------------------------------
    let rate = sampleCurve(C.rate, mag);
    if (!Number.isFinite(rate)) rate = 1;
    if (rate < T.rateMin) rate = T.rateMin;
    else if (rate > T.rateMax) rate = T.rateMax;
    this.playRate = rate * rateSign;

    return w;
  }

  // ------------------------------------------------------------------ apply

  /**
   * Optional convenience: push the solved weights straight onto AnimationActions.
   * The controller is free to do this itself — this exists because two mixer
   * behaviours bite everyone exactly once:
   *
   *   1. An action whose fadeOut completed sets `enabled = false`, and
   *      setEffectiveWeight computes `enabled ? weight : 0`. Re-weighting a
   *      previously faded-out clip is therefore a SILENT no-op and the blend
   *      tree simply never comes back.
   *   2. setEffectiveWeight calls stopFading(), which is what we want: a
   *      leftover crossfade interpolant would otherwise keep overwriting our
   *      weights every frame with values from a transition that already ended.
   *
   * @param {Map<string, any>|Record<string, any>} actions name -> AnimationAction
   * @param {boolean} applyTimeScale also push playRate onto the locomotion clips
   */
  applyTo(actions, applyTimeScale = true) {
    if (!actions) return;
    const names = this.names, w = this.weights;
    const getter = typeof actions.get === 'function' ? null : actions;
    if (applyTimeScale && !this._cycleReady) this._measureCycles(actions, getter);
    const refDur = applyTimeScale ? this._blendedCycle() : 0;
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const a = getter ? getter[name] : actions.get(name);
      if (!a || typeof a.setEffectiveWeight !== 'function') continue;
      const v = w[name];

      // Idle keeps rate 1: a 0.35x idle is a character having a stroke, and idle
      // is the one clip whose weight is high precisely when the rate curve is
      // furthest from 1.
      //
      // Every other locomotion clip is warped by its own cycle length as well as
      // by playRate. A walk cycle is ~1.0 s and a run ~0.65 s, so pushing one
      // identical timeScale onto both makes them complete strides at different
      // wall-clock rates: after a few seconds of steady mid-speed motion the two
      // blended poses sit at arbitrary relative phase — one leg forward in
      // `walk` while the same leg is back in `run` — and the legs swim through
      // each other. Half speed solves to walk 0.87 / run 0.11, so this is the
      // band the blend space was built for, not an edge case.
      //
      // A clip's cycle takes `duration / timeScale` seconds, so matching cycle
      // RATES means timeScale must scale WITH duration, not against it.
      //
      // Applied in BOTH branches on purpose. A culled clip is deliberately left
      // running at weight 0 (see below), so if its rate went stale while parked
      // it would drift out of phase and come back in wrong-footed — which is the
      // same artifact, just deferred until the player changes speed.
      if (applyTimeScale && name !== this.idleName && typeof a.setEffectiveTimeScale === 'function') {
        a.setEffectiveTimeScale(this.playRate * this._cycleWarp(i, refDur));
      }

      if (v > 0) {
        a.enabled = true;
        a.paused = false;
        // Everything past the setEffectiveWeight guard is duck-typed too. The
        // caller may hand us a pooled, disposed or partially-stubbed action, and
        // a TypeError thrown from inside the frame loop is exactly the failure
        // toResolver() goes out of its way to prevent on the resolver path.
        if (typeof a.isRunning === 'function' && typeof a.play === 'function' && !a.isRunning()) a.play();
        a.setEffectiveWeight(v);
      } else {
        // Left active at weight 0 rather than stopped. stop() resets `time`, so
        // a clip that flickers across the cull threshold would restart its cycle
        // every time and the feet would stutter. Six zero-weight actions cost a
        // trivial binding pass; a phase reset costs the whole illusion.
        a.setEffectiveWeight(0);
      }
    }
  }

  /**
   * Cache each resolved clip's authored duration. Runs from applyTo until every
   * name has an action to ask; clip durations never change, so calling getClip()
   * per action per frame would be pure waste. An action that cannot answer
   * getClip() keeps duration 0, which _cycleWarp reads as "leave it alone" —
   * i.e. exactly the old single-timeScale behaviour.
   */
  _measureCycles(actions, getter) {
    const names = this.names;
    let missing = 0;
    for (let i = 0; i < names.length; i++) {
      const a = getter ? getter[names[i]] : actions.get(names[i]);
      if (!a) { missing++; continue; }   // action may still be loading — retry
      const d = typeof a.getClip === 'function' ? a.getClip()?.duration : 0;
      this._cycleDur[i] = d > 1e-4 ? d : 0;
    }
    if (missing === 0) this._cycleReady = true;
  }

  /**
   * Weight-blended locomotion cycle length, in seconds. This is the wall-clock
   * stride every co-active clip is warped onto.
   *
   * Deliberately weighted rather than "pick the fastest clip": with a fixed
   * reference, a low-speed walk/run blend would drive the walk cycle at 1.5x its
   * authored rate — trading drift for a scurry. Weighting means the reference IS
   * the walk cycle when walk owns the blend and the run cycle when run does, it
   * moves continuously in between, and with only one locomotion clip active it
   * collapses to that clip's own duration, so the common case is a no-op.
   *
   * Idle is excluded: its duration is a breathing loop, not a stride, and it is
   * heaviest exactly where it would drag the average furthest off.
   * @returns {number} 0 when nothing measurable exists at all
   */
  _blendedCycle() {
    if (!this._cycleReady) return 0;
    const names = this.names, w = this.weights, dur = this._cycleDur;
    let acc = 0, wsum = 0, all = 0, count = 0;
    for (let i = 0; i < names.length; i++) {
      if (names[i] === this.idleName || !(dur[i] > 1e-4)) continue;
      all += dur[i];
      count++;
      const v = w[names[i]];
      if (v > 0) { acc += v * dur[i]; wsum += v; }
    }
    if (wsum > 0) return acc / wsum;
    // Standing still: every locomotion clip is culled to weight 0 but still
    // running, so they need a reference anyway or they drift apart while parked
    // and the first step out of idle is wrong-footed. Any constant works; the
    // unweighted mean keeps the warp factors closest to 1.
    return count > 0 ? all / count : 0;
  }

  /**
   * Per-clip timeScale multiplier that puts clip `i` on the blended stride.
   * Clamped: a truncated or placeholder clip would otherwise ask the mixer for a
   * 50x timeScale, which looks far worse than the drift being corrected.
   */
  _cycleWarp(i, refDur) {
    const d = this._cycleDur[i];
    if (!(refDur > 1e-4) || !(d > 1e-4)) return 1;
    const k = d / refDur;
    if (k < 0.25) return 0.25;
    if (k > 4) return 4;
    return k;
  }

  /** Dev HUD only — allocates, do not call from the frame loop. */
  summary() {
    const out = {
      moving: this.moving,
      speed: +this.magnitude.toFixed(3),
      rate: +this.playRate.toFixed(2),
      dominant: this.dominant,
      lateral: this.hasLateral,
      backward: this.hasBackward,
      backpedal: this.backpedal,
      weights: {},
    };
    for (let i = 0; i < this.names.length; i++) {
      const n = this.names[i];
      if (this.weights[n] > 0) out.weights[n] = +this.weights[n].toFixed(3);
    }
    return out;
  }
}
