// ============ procedural pose layer ============
// The mixer plays clips. This is everything a clip cannot know: which way the
// body is currently being thrown, how far the aim has drifted from the feet, and
// the fact that a standing person is never actually still.
//
// THE RULE THAT GOVERNS THIS WHOLE FILE: input is never delayed. Gameplay yaw,
// aim ray, movement and hit detection are untouched — this layer only emits small
// rotation deltas that are added to the skeleton AFTER the mixer has written its
// pose. A *body* that trails the camera by 80ms feels heavy; a *crosshair* that
// trails the camera by 80ms feels broken. Everything here lives on the far side
// of that line, which is why the output is a delta on the visual root and never a
// correction pushed back into `player.yaw`.
//
// Four effects, all built on core/spring.js. There is no division by dt anywhere
// in this file, which is not optional: src/ai/lod.js drives far enemies with
// sub-millisecond substeps and skips frames entirely, so anything of the form
// `(a - b) / dt` would detonate.
//
// Stability is NOT uniform across the two primitives, and the difference is
// load-bearing if you ever wire a different tick source (a worker, a replay
// scrubber, a headless test):
//   * Damper is unconditionally stable at any dt — it is the SmoothDamp Padé
//     form, and every damper here inherits that. All four effects' smoothing is
//     Dampers.
//   * The ONE Spring (`_whip`, shoulder follow-through) is explicit Euler with
//     spring.js's eight-substep cap, so h = dt/8 above 64ms and at stiffness 150
//     it diverges once h passes 2/omega_n ≈ 0.163s, i.e. dt ≳ 1.3s. game.js
//     clamps dt to 0.05 so this is unreachable through the game loop today, but
//     the spring's output is sanitised at its one use site anyway: clamp() lets
//     NaN through both of its comparisons, and one NaN in a bone quaternion
//     deletes the whole SkinnedMesh with nothing in the console.
//
//   LEAN          lateral acceleration banks the body into the turn — 3° hips,
//                 5° spine, 2° shoulders. Without it, sprinting around a corner
//                 looks like the character is being dragged sideways on a rail.
//   INERTIA CHAIN hips lead, spine follows, chest catches up, head holds the aim.
//                 Each link damps toward the PREVIOUS link's output, so lag
//                 compounds down the chain. That compounding is what reads as mass;
//                 four independent dampers on the same target read as jelly.
//   BREATHING     a character that is bit-identical for 200 frames reads as a
//                 paused game, not as a calm one.
//   TURN-IN-PLACE the visual body is allowed to fall behind the aim up to a twist
//                 limit, then pivots to catch up — which is what stops the neck
//                 from doing an owl impression when the player spins the camera.
//
// Output is a plain offsets object: per-bone euler DELTAS plus a root yaw delta.
// Deltas, not poses, and deliberately NOT THREE.Euler — an Euler invites
// `bone.rotation.copy(d)`, which silently discards the mixer's pose and leaves the
// character frozen in a 3-degree lean with no error anywhere.
//
// Nothing allocates after construction. Nothing requires bones: with no skeleton
// the offsets are still produced (a procedural box rig can read `lean`/`rootYaw`),
// and apply() with a missing bone skips that bone rather than throwing.

import { Damper, Spring } from '../core/spring.js';

const DEG = Math.PI / 180;
const PI = Math.PI;
const TAU = PI * 2;

/** Bones this layer writes, in the order the controller should apply them. */
export const POSE_SLOTS = ['hips', 'spine', 'chest', 'shoulderL', 'shoulderR', 'head'];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Shortest-arc wrap into (-PI, PI]. */
function wrapPi(a) {
  a %= TAU;
  if (a > PI) a -= TAU;
  else if (a < -PI) a += TAU;
  return a;
}

// One NaN reaching a Damper poisons it permanently — every later frame produces
// NaN, the bone quaternion becomes NaN, and the whole SkinnedMesh vanishes with no
// console output at all. A yaw of `atan2(0,0)` or a dt of 0/0 upstream is enough.
// Rejecting non-finite input at the door is two instructions and saves an
// afternoon. Infinity is rejected too: it survives arithmetic and produces NaN one
// multiply later, where the origin is no longer visible.
const num = (v, d) => (Number.isFinite(v) ? v : d);

/** Per-slot bookkeeping for apply()'s re-entrancy guard. */
const mkSlot = () => ({ fx: NaN, fy: NaN, fz: NaN, dx: 0, dy: 0, dz: 0 });

// A default parameter of `{}` allocates a fresh object on every call that omits
// the argument — a per-frame garbage source hiding in the function signature.
const NO_STATE = Object.freeze({});

/**
 * Tuning. Flat on purpose: a nested `{ lean: {...} }` would let a partial override
 * silently wipe its siblings via Object.assign, and the failure looks like "lean
 * randomly stopped working" three weeks later.
 */
export const POSE_DEFAULTS = Object.freeze({
  // Which way the rig faces in bone space. CHARACTER_ART_SPEC fixes -Z; a rig
  // exported facing +Z (Mixamo's native convention) flips pitch and roll only.
  facingZ: -1,

  // ---- lean ----
  leanHipsDeg: 3,        // spec distribution: the bank is shared, never one joint
  leanSpineDeg: 5,
  leanShoulderDeg: 2,
  leanPitchDeg: 3,       // accel/brake tilt, same machinery, different axis
  leanSink: 0.012,       // metres the hips drop at full bank
  headLevel: 0.55,       // fraction of inherited roll the head cancels (1.0 = robot)
  leanRef: 3.0,          // lateral velocity gap (m/s) that equals a full bank
  leanTurnRef: 3.1,      // same, for the yaw-rate fallback path — tuned so both
                         // paths agree to ~0.05 on an identical 7m/s corner, or a
                         // character banks differently depending on who drives it
  refSpeed: 5,           // assumed m/s when only speedNorm is supplied
  leanSmooth: 0.1,
  velLag: 0.14,
  mirrorShoulders: true, // Mixamo shoulder bones have mirrored rest bases

  // ---- inertia chain (seconds of lag, hips fastest) ----
  lagHips: 0.045,
  lagSpine: 0.085,
  lagChest: 0.13,
  lagHead: 0.09,         // fast: the head chases the AIM, it does not trail the body

  // ---- twist distribution; must sum to 1 or the head misses the aim ----
  twistHips: 0.06,
  twistSpine: 0.24,
  twistChest: 0.3,
  twistHead: 0.4,
  maxTwistDeg: 85,

  // ---- turn in place ----
  turnStartDeg: 62,      // divergence that latches a pivot
  turnStopDeg: 10,       // ...and the one that releases it (hysteresis, see below)
  turnRestRate: 0.4,     // rad/s the pivot must decay to before it may release
  turnSmooth: 0.16,
  settleSmooth: 1.1,     // planted-and-not-pivoting creep back toward the aim
  moveSmooth: 0.07,      // while moving the body just follows; feet already turned
  moveThresh: 0.06,

  // ---- shoulder follow-through ----
  whipLag: 0.05,
  whipGain: 1.1,
  whipLimitDeg: 6,
  whipStiffness: 150,
  whipDamping: 0.62,     // <1: overshoots on release, which IS the follow-through

  // ---- breathing ----
  breathRate: 1.15,
  breathDeg: 0.9,
  breathLift: 0.006,
  breathFade: 0.35,      // speedNorm at which breathing is fully gone
  swayRate: 0.31,
  swayDeg: 0.55,
});

export class ProceduralPose {
  /** @param {Partial<typeof POSE_DEFAULTS>} opts */
  constructor(opts = {}) {
    const c = Object.assign({}, POSE_DEFAULTS, opts);
    this.cfg = c;
    // Public on purpose (the LOD scheduler flips it for offscreen enemies), and
    // update() treats a disabled frame as a discontinuity: it drops _primed so the
    // first re-enabled frame snaps to the live heading. Without that, a character
    // that turned 180° while disabled unwinds over settleSmooth or latches a bogus
    // pivot. A re-enable is a teleport as far as this layer is concerned.
    this.enabled = true;

    // +1 for a -Z-facing rig (the spec), -1 for +Z. Multiplies pitch and roll only:
    // the twist axis is the bone's up axis either way, so yaw is unaffected.
    this._flip = c.facingZ < 0 ? 1 : -1;

    // ---- inertia chain ----
    this._hipsD = new Damper(0, c.lagHips);
    this._spineD = new Damper(0, c.lagSpine);
    this._chestD = new Damper(0, c.lagChest);
    this._headD = new Damper(0, c.lagHead);

    // ---- turn in place ----
    this._visD = new Damper(0, c.moveSmooth);   // visual body yaw, lags gameplay yaw
    this._turning = false;

    // ---- lean ----
    this._leanD = new Damper(0, c.leanSmooth);
    this._tiltD = new Damper(0, c.leanSmooth);
    this._velX = new Damper(0, c.velLag);
    this._velZ = new Damper(0, c.velLag);
    this._yawLag = new Damper(0, c.velLag);

    // ---- shoulder follow-through ----
    this._hipLag = new Damper(0, c.whipLag);
    this._whip = new Spring(0, { stiffness: c.whipStiffness, damping: c.whipDamping });

    // Continuous (unwrapped) angles. Damping a raw ±PI angle makes a character
    // spin the long way round every time it crosses the seam behind itself.
    this._yawU = 0;
    this._lookU = 0;

    // Random phase so a squad of twelve does not inhale in lockstep — synchronised
    // breathing reads as a bug, not as an army.
    this._breathT = Math.random() * 10;
    this._primed = false;

    /** Output. Allocated once; every field is rewritten every frame. */
    this.offsets = {
      hips: { x: 0, y: 0, z: 0 },
      spine: { x: 0, y: 0, z: 0 },
      chest: { x: 0, y: 0, z: 0 },
      shoulderL: { x: 0, y: 0, z: 0 },
      shoulderR: { x: 0, y: 0, z: 0 },
      head: { x: 0, y: 0, z: 0 },
      hipsOffsetY: 0,   // metres, ADD to hips.position.y
      rootYaw: 0,       // radians, ADD to the visual root's rotation.y
      lean: 0,          // -1..1, +1 = banked to the character's right
      twist: 0,         // radians of aim-vs-feet divergence currently absorbed
      turning: false,
    };

    this._applied = {
      hips: mkSlot(), spine: mkSlot(), chest: mkSlot(),
      shoulderL: mkSlot(), shoulderR: mkSlot(), head: mkSlot(),
    };
    this._appliedRoot = { f: NaN, d: 0 };
    this._appliedY = { f: NaN, d: 0 };
  }

  /**
   * Snap all state to a heading. MANDATORY on spawn, teleport and floor change:
   * without it the dampers start at 0 and a character that spawns facing east
   * whips 90° through its first second, and a floor transition sends the visual
   * body the long way around while turn-in-place tries to catch a >180° error.
   */
  reset(yaw = 0, lookYaw = yaw) {
    const y = num(yaw, 0);
    const l = num(lookYaw, y);
    this._yawU = y;
    this._lookU = l;
    this._hipsD.snap(y); this._spineD.snap(y); this._chestD.snap(y); this._headD.snap(y);
    this._visD.snap(y);
    this._yawLag.snap(y);
    this._hipLag.snap(y);
    this._velX.snap(0); this._velZ.snap(0);
    this._leanD.snap(0); this._tiltD.snap(0);
    this._whip.snap(0);
    this._turning = false;
    this._primed = true;
    this._zero();
    // Deliberately NOT _forgetApplied(). Those are two different concerns:
    // reset() restores HEADING continuity, the applied-memory tracks BONE
    // IDENTITY. Clearing the memory here means the delta this layer wrote before
    // a disable is never subtracted, so the next enable stacks a fresh delta on
    // top of it — a corkscrew that gains a few degrees per cycle on any channel
    // nothing else rewrites (an untracked bone, an unwritten root wrapper,
    // hips.position.y). Measured before the fix: 2.2 -> 10.5 deg over five
    // disable/enable cycles, unbounded. _forgetApplied() stays for its real
    // caller — a genuine rig swap, where the old bones are gone and their
    // recorded deltas are meaningless.
  }

  /**
   * @param {number} dt seconds
   * @param {{
   *   yaw?: number, lookYaw?: number, vx?: number, vz?: number, speed?: number,
   *   speedNorm?: number, dead?: boolean,
   * }} state
   *   yaw      gameplay body facing (radians, world). What the mesh already uses.
   *   lookYaw  aim facing; defaults to yaw. Divergence drives twist + turn-in-place.
   *   vx/vz    world planar velocity. Omit and lean falls back to yaw rate × speed.
   *   speed    m/s, only used by that fallback; defaults to speedNorm × refSpeed.
   *
   * Note there is no `pitch`: aim pitch belongs to AnimationController.torsoPitch,
   * and emitting it here as well would apply it to the spine twice.
   *
   * @returns {typeof this.offsets} the same object every frame — do not retain a
   *          field by reference expecting it to be a snapshot.
   */
  update(dt, state = NO_STATE) {
    const o = this.offsets;
    // dt <= 0 is a paused/hitstop frame: hold the pose rather than zeroing it, or
    // every pause pops the character upright for one frame. Also catches NaN dt.
    if (!(dt > 0)) return o;
    // Disabled is a discontinuity, not a pause: the character keeps moving and
    // turning while this layer is off, so every damper here is stale by the time
    // it comes back. Dropping _primed makes the next enabled frame take the
    // reset() path below, which snaps to the live heading and forgets what apply()
    // last wrote. (dt <= 0 above is the opposite case — a genuinely frozen world,
    // where holding the pose is correct.)
    if (!this.enabled) { this._primed = false; return this._zero(); }

    const c = this.cfg;
    const yaw = num(state.yaw, this._yawU);
    const lookYaw = num(state.lookYaw, yaw);
    // Player speedNorm is an unclamped ratio — dash and knockback push it past 1
    // (see player.js). Clamp wide so a dash still counts as "moving", then use
    // narrow ranges below where a 0..1 is actually required.
    const speedNorm = clamp(num(state.speedNorm, 0), 0, 4);
    const dead = state.dead === true;

    if (!this._primed) this.reset(yaw, lookYaw);

    // Accumulate into continuous space via shortest arc, so every consumer below
    // works in plain subtraction with no seam. Valid for any input convention:
    // wrapped atan2 (enemies) or the player's unbounded mouse-accumulated yaw.
    this._yawU += wrapPi(yaw - this._yawU);
    this._lookU += wrapPi(lookYaw - this._lookU);

    // ------------------------------------------------------- turn in place
    // The target is always the real heading; only how hard we chase it changes.
    // Three regimes, and the slow one matters as much as the fast one.
    const yawErr = this._yawU - this._visD.value;
    const moving = speedNorm > c.moveThresh;
    let smooth;
    if (moving || dead) {
      // The feet are already carrying the body around; a pivot state here would
      // fight the locomotion clip.
      this._turning = false;
      smooth = c.moveSmooth;
    } else {
      const mag = Math.abs(yawErr);
      // A Damper cannot overshoot on its own, but RAISING smoothTime mid-flight
      // shrinks omega while the stored velocity survives, and the body coasts past
      // the aim then creeps back for seconds. So the slow regime is gated on the
      // damper actually being at rest — not just on the pivot flag.
      const atRest = Math.abs(this._visD.vel) < c.turnRestRate;
      // Latch wide, release narrow. A single threshold makes the body chatter on
      // and off at exactly 62° as mouse noise crosses the line, which reads as a
      // physics bug. Only hand the heading over once the pivot has come to rest.
      if (this._turning) {
        if (mag < c.turnStopDeg * DEG && atRest) this._turning = false;
      } else if (mag > c.turnStartDeg * DEG) this._turning = true;
      // Not pivoting still creeps, ~1s to bleed off whatever twist is left. Holding
      // the heading outright instead leaves a permanent offset — every sub-threshold
      // camera nudge banks it, and the visual body ends up parked 20° off the aim
      // forever, which reads as a broken mesh rather than as a relaxed stance.
      //
      // `!atRest` is what catches the moving->stopped transition, which is NOT a
      // pivot and so never sets _turning: release W mid-mouse-turn and _visD is
      // still carrying the full yaw rate at moveSmooth's 0.07s. Dropping straight
      // to settleSmooth on that frame throws the body 26° past the aim at 3 rad/s
      // (53° at 6 rad/s) and takes ~3s to come back. Stay on the 0.16s response
      // until the velocity has genuinely bled off, then hand over to the creep.
      smooth = this._turning || !atRest ? c.turnSmooth : c.settleSmooth;
    }
    const vis = this._visD.to(this._yawU, dt, smooth);
    // wrapPi is the safety net for the case reset() was not called on a teleport:
    // the body takes the short way around while it catches up instead of unwinding
    // through a full revolution.
    o.rootYaw = wrapPi(vis - this._yawU);
    o.turning = this._turning;

    // --------------------------------------------------------- inertia chain
    const maxTwist = c.maxTwistDeg * DEG;
    const twist = clamp(this._lookU - vis, -maxTwist, maxTwist);
    // Each link targets the previous link's OUTPUT plus its share of the twist.
    // Because the shares sum to 1, the head lands on the aim at rest; because the
    // targets are chained, the lag compounds and the body unwinds like a whip.
    const hipsA = this._hipsD.to(vis + twist * c.twistHips, dt);
    const spineA = this._spineD.to(hipsA + twist * c.twistSpine, dt);
    const chestA = this._chestD.to(spineA + twist * c.twistChest, dt);
    const headA = this._headD.to(chestA + twist * c.twistHead, dt);

    // Bone rotations compose down the hierarchy, so each delta is measured against
    // its PARENT segment, not against the root. Measuring everything against the
    // root instead makes the head twist by roughly four times the intended angle.
    const dHipsY = hipsA - vis;
    const dSpineY = spineA - hipsA;
    let dChestY = chestA - spineA;
    const dHeadY = headA - chestA;

    // Angular rate without dividing by dt: the gap between the hips angle and a
    // lagged copy of it is proportional to how fast the hips are turning, and it
    // stays bounded on the sub-millisecond substeps the enemy LOD hands out.
    const hipRate = hipsA - this._hipLag.to(hipsA, dt);
    const whipLim = c.whipLimitDeg * DEG;
    // Spring, not Damper: the shoulders trail during the turn and overshoot as it
    // stops. The overshoot decays to zero, so unlike a springy chain link this
    // cannot settle into a persistent wobble during a sustained circle-strafe.
    let whip = this._whip.update(dt, clamp(-hipRate * c.whipGain, -whipLim, whipLim));
    // This is the one value in the file that a non-NaN input can still turn into
    // NaN: Spring is explicit Euler under an eight-substep cap (see the header) and
    // diverges at a pathological dt. clamp() passes NaN through both comparisons,
    // so the double clamp is no guard at all — one NaN here reaches chest.y, the
    // bone quaternion, and the SkinnedMesh disappears with an empty console.
    // Re-snap rather than merely substituting, or the spring stays poisoned.
    if (!Number.isFinite(whip)) { this._whip.snap(0); whip = 0; }
    dChestY += clamp(whip, -whipLim, whipLim);

    // ----------------------------------------------------------------- lean
    // Character faces -Z, so forward = (-sin y, 0, -cos y) and right = (cos y, 0, -sin y).
    const sy = Math.sin(this._yawU);
    const cy = Math.cos(this._yawU);
    let lat;
    let lon = 0;   // the fallback path below has no longitudinal signal to give
    if (Number.isFinite(state.vx) || Number.isFinite(state.vz)) {
      const vx = num(state.vx, 0);
      const vz = num(state.vz, 0);
      // Acceleration proxy: the gap between velocity and a lagged copy of it.
      // Same dt-free trick as the hips rate, and it needs no previous-frame
      // velocity, which the LOD substep loop would corrupt anyway.
      const ax = vx - this._velX.to(vx, dt);
      const az = vz - this._velZ.to(vz, dt);
      lat = (ax * cy - az * sy) / c.leanRef;
      lon = (-ax * sy - az * cy) / c.leanRef;
    } else {
      // Enemies never store a velocity vector (moveToward computes and discards
      // it). Centripetal acceleration is speed × yaw rate and points to the
      // character's left for a rising yaw, which is all a corner bank needs.
      const speed = num(state.speed, speedNorm * c.refSpeed);
      const yawRate = this._yawU - this._yawLag.to(this._yawU, dt);
      lat = (-speed * yawRate) / c.leanTurnRef;
    }
    const lean = this._leanD.to(clamp(lat, -1, 1), dt);
    const tilt = this._tiltD.to(clamp(lon, -1, 1), dt);
    o.lean = lean;
    o.twist = twist;

    const f = this._flip;
    // A rotation about +Z tips the top toward -X, so banking to the character's
    // right (+lean) needs a NEGATIVE roll. Same reasoning for pitch about +X.
    // A runner banks INTO the turn like a motorcycle — do not "fix" this to the
    // passenger-thrown-outward sign, which is a different body doing a different job.
    const roll = -lean * f;
    const pitchLean = -tilt * f;

    // ------------------------------------------------------------ breathing
    this._breathT += dt;
    // Fades out as soon as the character is doing anything: breathing under a run
    // cycle just fights the clip's own chest motion.
    const calm = dead ? 0 : clamp(1 - speedNorm / c.breathFade, 0, 1);
    const bt = this._breathT * c.breathRate;
    // Two detuned sines: a single pure sine at a fixed rate reads as a metronome,
    // and the eye picks that up as mechanical within a couple of seconds.
    const breath = (Math.sin(bt) * 0.72 + Math.sin(bt * 0.37) * 0.28) * calm;
    const sway = Math.sin(this._breathT * c.swayRate) * calm;
    const bDeg = c.breathDeg * DEG;

    // ------------------------------------------------------------- assemble
    const hips = o.hips;
    hips.x = pitchLean * c.leanPitchDeg * DEG * 0.35;
    hips.y = dHipsY;
    hips.z = roll * c.leanHipsDeg * DEG + sway * c.swayDeg * DEG;

    const spine = o.spine;
    spine.x = pitchLean * c.leanPitchDeg * DEG * 0.65 + breath * bDeg;
    spine.y = dSpineY;
    spine.z = roll * c.leanSpineDeg * DEG;

    const chest = o.chest;
    chest.x = -breath * bDeg * 0.5;             // ribs open, sternum stays put
    chest.y = dChestY;
    chest.z = -sway * c.swayDeg * DEG * 0.6;    // keeps the head over the feet

    // Shoulder bones carry only the 2° bank. Their rest bases are mirrored on a
    // Mixamo rig, so the same world roll needs opposite local values; and because
    // the whole contribution is 2°, a rig whose shoulder axes differ degrades to an
    // invisible nudge rather than to a broken arm.
    const sh = roll * c.leanShoulderDeg * DEG;
    o.shoulderL.x = 0; o.shoulderL.y = 0; o.shoulderL.z = sh;
    o.shoulderR.x = 0; o.shoulderR.y = 0;
    o.shoulderR.z = c.mirrorShoulders ? -sh : sh;

    const head = o.head;
    head.x = breath * bDeg * 0.25;
    head.y = dHeadY;
    // Counter-roll against what the head inherits from hips + spine. Partial on
    // purpose: a fully level head is a gyroscope, not a person.
    head.z = lean * f * (c.leanHipsDeg + c.leanSpineDeg) * c.headLevel * DEG;

    o.hipsOffsetY = breath * c.breathLift - Math.abs(lean) * c.leanSink;
    return o;
  }

  /**
   * Optional convenience applier. Call ONCE per frame, immediately after
   * mixer.update(), with `{ hips, spine, chest, shoulderL, shoulderR, head, root }`
   * — any subset; a missing bone is skipped, never thrown on. Build it with
   * `resolvePoseBones(parts.bones, built.root)` — pass the root, or turn-in-place
   * is computed every frame and then dropped on the floor with no symptom beyond
   * "the body never pivots".
   *
   * Everything is added, never assigned: assigning would discard the mixer's pose
   * for that bone, and on the hips it would flatten the walk cycle's vertical bob.
   */
  apply(bones) {
    if (!bones) return;
    const o = this.offsets;
    const A = this._applied;
    if (bones.hips) applySlot(bones.hips, o.hips, A.hips);
    if (bones.spine) applySlot(bones.spine, o.spine, A.spine);
    if (bones.chest) applySlot(bones.chest, o.chest, A.chest);
    if (bones.shoulderL) applySlot(bones.shoulderL, o.shoulderL, A.shoulderL);
    if (bones.shoulderR) applySlot(bones.shoulderR, o.shoulderR, A.shoulderR);
    if (bones.head) applySlot(bones.head, o.head, A.head);

    const hb = bones.hips;
    if (hb && hb.position) applyAxis(hb.position, 'y', o.hipsOffsetY, this._appliedY);
    const rb = bones.root;
    if (rb && rb.rotation) applyAxis(rb.rotation, 'y', o.rootYaw, this._appliedRoot);
  }

  /** Zero the output without touching the simulation state. */
  _zero() {
    const o = this.offsets;
    for (const k of POSE_SLOTS) { const d = o[k]; d.x = 0; d.y = 0; d.z = 0; }
    o.hipsOffsetY = 0;
    o.rootYaw = 0;
    o.lean = 0;
    o.twist = 0;
    o.turning = false;
    return o;
  }

  /** Drop apply()'s memory of what it last wrote — after a rig swap or a reset. */
  _forgetApplied() {
    for (const k of POSE_SLOTS) {
      const s = this._applied[k];
      s.fx = NaN; s.fy = NaN; s.fz = NaN;
      s.dx = 0; s.dy = 0; s.dz = 0;
    }
    this._appliedY.f = NaN; this._appliedY.d = 0;
    this._appliedRoot.f = NaN; this._appliedRoot.d = 0;
  }
}

// ---------------------------------------------------------------- appliers
//
// Both of these solve the same problem. Adding a delta every frame is only
// correct while something else rewrites the value first — for a bone the mixer
// does, but ONLY for bones the clip actually has a track for. A rig delivered
// without a Spine1 track would integrate our 5° lean every single frame and
// corkscrew itself into the floor over about a minute, with nothing in the console.
//
// The guard: remember the exact value we left behind. If it is still bit-identical
// on the next visit, nothing wrote to it in between, so we undo our own delta
// before adding the new one. If it changed, the mixer owns it and a plain add is
// right. Bit-exact comparison is sound here precisely because the alternative to
// "the mixer wrote" is "absolutely nothing touched this float".

// Both do the arithmetic in locals and write ONCE. Every Euler component setter
// fires _onChangeCallback, which Object3D wires to quaternion.setFromEuler — so
// the naive six-write form rebuilds the quaternion up to six times per bone per
// frame and throws five of them away. Six slots × 30 enemies is ~1000 discarded
// setFromEuler calls per frame. Euler.set() fires the callback exactly once and
// defaults `order` to the euler's own, so the bone's rotation order survives.
// The non-Euler fallback keeps the never-throw contract for procedural box rigs
// and test doubles whose `rotation` is a plain {x,y,z}.

function applySlot(bone, d, s) {
  const r = bone.rotation;
  if (!r) return;
  let x = r.x, y = r.y, z = r.z;
  if (x === s.fx) x -= s.dx;
  if (y === s.fy) y -= s.dy;
  if (z === s.fz) z -= s.dz;
  x += d.x; y += d.y; z += d.z;
  if (typeof r.set === 'function') r.set(x, y, z);
  else { r.x = x; r.y = y; r.z = z; }
  s.fx = x; s.fy = y; s.fz = z;
  s.dx = d.x; s.dy = d.y; s.dz = d.z;
}

function applyAxis(target, axis, delta, s) {
  let v = target[axis];
  if (v === s.f) v -= s.d;
  v += delta;
  target[axis] = v;
  s.f = v;
  s.d = delta;
}

/**
 * Turn a bone index into the named handles apply() wants. BOTH of the project's
 * bone vocabularies are accepted, because there are two and they disagree:
 *   * src/game/models.js `parts.bones` — a Map keyed by lowercased,
 *     mixamorig-stripped node names (`leftshoulder`, `spine2`, `hips`).
 *   * src/anim/skeleton.js resolveBones() — a plain object keyed by canonical
 *     camelCase keys with a side suffix (`shoulderL`, `spine2`, `hips`).
 * Every pick list below carries the spellings from both, so either input resolves
 * the same six slots. Returns nulls for whatever the rig lacks.
 *
 * @param {Map<string, object>|Record<string, object>|null} source bone index
 * @param {object|null} root the visual wrapper Object3D whose rotation.y gameplay
 *   already writes. apply() adds `rootYaw` to it — turn-in-place produces NOTHING
 *   visible without it, silently, because the whole effect lives on that one
 *   float. It is NOT a bone, so it never goes through pick()/claimed.
 *
 * Every bone slot is claimed at most once. A rig that ships only `Spine` would
 * otherwise resolve both `spine` and `chest` to the same bone and apply the lean
 * and the twist to it twice — which looks like a tuning problem and is not one.
 * Chest is resolved first because it carries the largest twist share and the
 * shoulders hang off it; losing the mid-spine link is much cheaper than losing it.
 */
export function resolvePoseBones(source, root = null) {
  if (!source) return { hips: null, spine: null, chest: null, head: null, shoulderL: null, shoulderR: null, root };
  const get = typeof source.get === 'function' ? (k) => source.get(k) : (k) => source[k];
  const claimed = new Set();
  const pick = (names) => {
    for (const n of names) {
      const b = get(n);
      if (b && !claimed.has(b)) { claimed.add(b); return b; }
    }
    return null;
  };
  const chest = pick(['spine2', 'chest', 'spine1', 'spine']);
  const spine = pick(['spine1', 'spine']);
  const hips = pick(['hips', 'pelvis']);
  const head = pick(['head']);
  // skeleton.js key first, models.js node name second. There is no
  // socket_shoulder_* in the character contract — RAW_SOCKETS is hand/head/back/
  // chest only — so looking for one was a dead lookup that shadowed nothing.
  const shoulderL = pick(['shoulderL', 'leftshoulder']);
  const shoulderR = pick(['shoulderR', 'rightshoulder']);
  return { hips, spine, chest, head, shoulderL, shoulderR, root };
}
