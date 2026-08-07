// ============ foot locking + stride warping (the anti-moonwalk pass) ============
// Two failures make cheap animation read as cheap, and both are about feet:
//
//   MOONWALKING  a run clip authored at 4.2 m/s played on a character moving
//                5.3 m/s. The legs cycle at the authored cadence while the body
//                travels 26% further, so every foot skates. No amount of clip
//                quality hides it — the mismatch IS the artefact.
//   FOOT SLIDING the planted foot is not actually planted. Even at the correct
//                speed the contact point drifts a few centimetres per stance
//                because the clip was keyed by hand and the character is scaled.
//
// This module fixes both, and it fixes them as DATA rather than as poses:
//
//   STRIDE WARP  splits the speed ratio between playback rate (cadence) and
//                horizontal leg spread (stride length), the way real gait scales.
//                Output: `stride.timeScale` for the AnimationAction and
//                `stride.strideScale` folded into the swing foot's goal.
//   FOOT LOCK    detects the stance phase, pins that foot's world position until
//                toe-off, and publishes it as an IK goal.
//
// It writes NOTHING to the skeleton. It produces goals; the two-bone solver in
// the IK pass consumes them. That separation is deliberate — this file decides
// WHERE a foot belongs, the solver decides how to bend the leg to get there, and
// neither has to know about the other's failure modes. There is therefore no
// import of the IK module here, and none is needed.
//
// Cost: ~2 matrix reads, ~2 sqrt and one damper per foot per frame, plus an
// optional throttled BVH ray. That is a Tier-0 budget (see src/ai/lod.js) — call
// it for the player and near enemies only. Everything degrades to a no-op with a
// missing bone, a missing skeleton, a missing BVH or a missing clip.

import * as THREE from 'three';
import { Damper } from '../core/spring.js';

// Module-scope scratch. Every one of these is written before it is read inside a
// single synchronous block; nothing here survives across calls. Allocating them
// per frame is how a 100-enemy floor ends up GC-stuttering.
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);

// A 1.8 m human has roughly a 0.9 m leg. Every threshold below is authored for
// that body and multiplied by (this rig's leg / REF_LEG), so the 1.40 m
// Micromanager and the 3.00 m Auditor get proportional plant heights instead of
// one of them never planting and the other never releasing.
const REF_LEG = 0.9;

// NaN-safe by construction. `v < lo ? lo : v > hi ? hi : v` returns NaN for a
// NaN input because both comparisons are false, which launders a poisoned number
// straight into a timeScale or an IK goal. Testing for the IN-RANGE case instead
// means anything that is not provably inside the range collapses to `lo`.
const clamp = (v, lo, hi) => (v >= lo ? (v <= hi ? v : hi) : lo);

// =====================================================================
// TUNABLE DATA — authored clip metadata
// =====================================================================
// glTF has nowhere to store "how fast was this clip keyed", and an in-place clip
// has zero root motion by construction, so the authored speed CANNOT be derived
// from the file. It has to live here. Getting it wrong is the single biggest
// cause of residual sliding, so measure it once per clip — stride length in
// metres divided by the time between two same-foot contacts — and write it down.
//
// `contact` windows are clip phase (0..1, wrapping) during which that foot is in
// stance. They are a GATE, not a driver: the heuristic still picks the exact
// plant frame, the window just stops a mid-air pose that happens to dip near the
// floor from latching. Windows are optional; omit them and detection is purely
// geometric.
export const STRIDE_CLIPS = {
  idle:  { name: 'idle',  speed: 0 },
  walk:  { name: 'walk',  speed: 1.45, contact: { L: [0.00, 0.62], R: [0.50, 0.12] } },
  run:   { name: 'run',   speed: 4.20, contact: { L: [0.02, 0.37], R: [0.52, 0.87] } },
  // Locomotion-adjacent states that must never be stride-warped: the clip is a
  // burst, not a gait, and scaling its playback rate just makes it look wrong.
  dash:  { name: 'dash',  speed: 0 },
  slide: { name: 'slide', speed: 0 },
  jump:  { name: 'jump',  speed: 0 },
  fall:  { name: 'fall',  speed: 0 },
};

// The controller resolves logical states through CLIP_ALIASES, so the name that
// reaches us may be the raw clip name from the GLB. Map those back rather than
// silently falling through to the speed guess.
export const STRIDE_ALIASES = {
  sprint: 'run', run_forward: 'run', jog: 'run',
  walk_forward: 'walk', walk_slow: 'walk',
  idle_a: 'idle', stand: 'idle',
  jump_loop: 'fall', jump_start: 'jump',
};

export const FOOTLOCK_DEFAULTS = {
  // --- plant detection (metres / metres-per-second, all x sizeScale) ---
  plantHeight: 0.11,     // ankle must be at least this low to START a lock
  releaseHeight: 0.19,   // ...and must rise past this to break one (hysteresis:
                         //    one threshold makes the lock chatter at the edge)
  plantSpeed: 0.55,      // world horizontal ankle speed under which we call it planted
  driftTolerance: 1.25,  // headroom on top of the drift stride warping leaves behind
                         //   (see the gate in update() — this is why 0.55 alone is a trap)
  riseSpeed: 0.40,       // upward world speed that means toe-off — breaks a lock at once
  maxLockTime: 0.90,     // insurance: no lock outlives this, so a stuck detector
                         //   can't pin a foot to the floor forever
  // --- lock release / hip compensation ---
  maxReach: 0.97,        // fraction of leg length before the leg would straighten to a
                         //   spike (spec §9 "limbs stretch to a point")
  maxHipDrop: 0.22,      // how far we will ask the pelvis to sink before releasing instead
  hipDropSmooth: 0.10,
  // --- blending ---
  lockIn: 0.05,          // seconds to fade the pin in — fast, the plant is an event
  lockOut: 0.09,         //   ...and slower to fade out, toe-off is a roll
  // --- ground probing ---
  groundProbeHz: 10,     // a floor under a planted foot does not change; polling it
                         //   every frame per foot is 2N BVH rays for nothing
  probeUp: 0.45,
  probeDown: 0.90,
  // --- stride warping ---
  cadenceExp: 0.40,      // timeScale = ratio^cadenceExp, stride takes the remainder.
                         //   Human gait scales cadence ~0.4 / stride ~0.6 with speed;
                         //   putting it all in timeScale gives you a chipmunk sprint.
  minTimeScale: 0.65, maxTimeScale: 1.55,
  minStrideScale: 0.70, maxStrideScale: 1.45,
  strideSmooth: 0.12,    // damper on the speed ratio: raw speed is noisy and a jittering
                         //   timeScale is audible as a stuttering footstep cadence
  idleSpeed: 0.05,       // below this we stop warping entirely (ratio -> 0 -> nonsense)
  // --- misc ---
  contactMode: 'auto',   // 'auto'      window gates the heuristic when there IS a
                         //             window and a phase; pure geometry otherwise
                         // 'window'    strict: no window or no phase means no lock
                         // 'heuristic' ignore windows entirely, geometry only
  teleportDist: 1.20,    // per-frame root movement that means a respawn, not a run
  autoUpdateMatrices: true,
};

// =====================================================================
// stride warping
// =====================================================================

/**
 * Resolve a clip name to its authored-speed record, tolerating aliases and
 * unknown names. Never returns null — an unrecognised clip falls back on what
 * the character is actually doing, because refusing to warp is worse than
 * warping against a slightly wrong reference.
 */
export function clipStride(name, speed = 0) {
  if (name) {
    const key = STRIDE_ALIASES[name] ?? name;
    const rec = STRIDE_CLIPS[key];
    if (rec) return rec;
  }
  return speed > STRIDE_CLIPS.run.speed * 0.55 ? STRIDE_CLIPS.run : STRIDE_CLIPS.walk;
}

/**
 * Split a speed ratio into playback rate and leg spread.
 *
 * @param {number} speed   actual ground speed, m/s
 * @param {string} clip    logical or raw clip name
 * @param {object} out     mutated in place — hoist it, this runs every frame
 * @param {object} opts    subset of FOOTLOCK_DEFAULTS
 * @returns {{clip:string, authored:number, ratio:number, timeScale:number, strideScale:number, residual:number}}
 */
export function strideWarp(speed, clip, out = {}, opts = FOOTLOCK_DEFAULTS) {
  // This is a SECOND boundary, not an internal helper: it is exported and the
  // controller may call it without going through FootLock.update(). A non-finite
  // speed slips past `!(meta.speed > 0)` and `NaN < idleSpeed` (both false),
  // reaches Math.pow(NaN, exp) and comes back out as out.timeScale = NaN. The
  // documented consumer is AnimationAction.timeScale, whose _updateTime is
  // poisoned permanently by one NaN — it does not wash out next frame. So
  // sanitize here exactly the way update() does, and use `sp` everywhere below.
  const sp = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  const meta = clipStride(clip, sp);
  out.clip = meta.name;
  out.authored = meta.speed;

  // A clip with no authored speed is a burst, not a gait. Warping `dash` or
  // `jump` by the movement ratio is how a dash ends up playing at 1.5x and
  // desyncing from the i-frame window it was authored against.
  if (!(meta.speed > 0) || sp < (opts.idleSpeed ?? 0.05)) {
    out.ratio = 1; out.timeScale = 1; out.strideScale = 1; out.residual = 0;
    return out;
  }

  const ratio = Math.max(0.05, sp / meta.speed);
  const ts = clamp(Math.pow(ratio, opts.cadenceExp ?? 0.4),
    opts.minTimeScale ?? 0.65, opts.maxTimeScale ?? 1.55);
  // Whatever cadence did not absorb, stride length must — the product has to
  // equal the ratio exactly or the residual comes straight back out as sliding.
  const ss = clamp(ratio / ts, opts.minStrideScale ?? 0.7, opts.maxStrideScale ?? 1.45);

  out.ratio = ratio;
  out.timeScale = ts;
  out.strideScale = ss;
  // Non-zero residual means the clamps ate part of the speed and the foot WILL
  // slide by this fraction. Surfaced rather than hidden: it is the number that
  // tells you the character has outgrown its clip and needs a real sprint take.
  out.residual = ratio - ts * ss;
  return out;
}

// =====================================================================
// bone resolution
// =====================================================================

const stripPrefix = (n) => String(n).replace(/^mixamorig:?/i, '');
// GLTFLoader strips [ ] . : / from node names and turns whitespace into '_', so
// the same joint arrives as 'mixamorigLeftUpLeg', 'LeftUpLeg' or 'thigh_L'
// depending on the exporter. Normalise aggressively; a missed match costs the
// whole leg.
const normKey = (n) => stripPrefix(n).toLowerCase().replace(/[\s._-]/g, '');

// No toe entry: this module locks and warps the ANKLE, and foot roll comes from
// the probe normal, not from the ball joint. src/anim/ik.js resolves its own toe
// for the roll pivot. Carrying a second, silently diverging toe name table here
// for a field nothing reads is how the two lists end up disagreeing.
const LEG_NAMES = {
  L: {
    upleg: ['leftupleg', 'upleglf', 'thighl', 'lthigh', 'legupperl', 'lupleg'],
    leg: ['leftleg', 'legl', 'shinl', 'calfl', 'lleg', 'leglowerl'],
    foot: ['leftfoot', 'footl', 'lfoot', 'ankle l', 'anklel'],
  },
  R: {
    upleg: ['rightupleg', 'uplegrt', 'thighr', 'rthigh', 'legupperr', 'rupleg'],
    leg: ['rightleg', 'legr', 'shinr', 'calfr', 'rleg', 'leglowerr'],
    foot: ['rightfoot', 'footr', 'rfoot', 'ankle r', 'ankler'],
  },
};
const HIP_NAMES = ['hips', 'hip', 'pelvis', 'root'];

/**
 * Build a normalised name -> bone index from anything the codebase might hand
 * us: the `parts.bones` Map from models.js, a SkinnedMesh, a Skeleton, a raw
 * Object3D subtree, or a plain `{hips, leftFoot}` object.
 */
function boneIndex(source) {
  if (!source) return null;
  const out = new Map();
  const put = (name, node) => { if (node && name) out.set(normKey(name), node); };

  if (source instanceof Map) {
    for (const [k, v] of source) put(k, v);
  } else if (source.isObject3D) {
    // A SkinnedMesh's skeleton is the cheap path; the traverse is the fallback
    // for a rig whose sockets were exported as plain Object3D empties.
    if (source.skeleton?.bones) for (const b of source.skeleton.bones) put(b.name, b);
    source.traverse((o) => put(o.name, o));
  } else if (Array.isArray(source.bones)) {
    // THREE.Skeleton. It carries NO `isSkeleton` flag in r180 — checking for one
    // makes every skeleton fall through to the plain-object branch, match
    // nothing, and go silently inert. Duck-type the bones array instead.
    for (const b of source.bones) put(b?.name, b);
  } else if (Array.isArray(source)) {
    for (const b of source) put(b?.name, b);
  } else if (typeof source === 'object') {
    for (const k of Object.keys(source)) {
      const v = source[k];
      if (v?.isObject3D) { put(k, v); put(v.name, v); }
    }
  }
  return out.size ? out : null;
}

function pick(index, names) {
  for (let i = 0; i < names.length; i++) {
    const b = index.get(normKey(names[i]));
    if (b) return b;
  }
  return null;
}

// =====================================================================
// per-foot state
// =====================================================================

class Foot {
  constructor(side, index) {
    const n = LEG_NAMES[side];
    this.side = side;
    this.upleg = index ? pick(index, n.upleg) : null;
    this.leg = index ? pick(index, n.leg) : null;
    this.foot = index ? pick(index, n.foot) : null;
    this.valid = Boolean(this.upleg && this.leg && this.foot);

    // Bone rest translation IS the parent bone's length, so the leg measures
    // itself without needing a single valid world matrix. Falls back to the
    // reference leg so a rig with zeroed rest offsets still gets sane thresholds.
    const thigh = this.leg?.position.length() ?? 0;
    const shin = this.foot?.position.length() ?? 0;
    this.legLocal = thigh + shin > 1e-3 ? thigh + shin : REF_LEG;
    this.legWorld = this.legLocal;

    this.prevX = 0; this.prevY = 0; this.prevZ = 0;
    this.hasPrev = false;
    this.locked = false;
    this.lockT = 0;
    this.lockX = 0; this.lockY = 0; this.lockZ = 0;
    this.groundY = 0;
    // The ground normal must be initialised HERE, not left to whichever branch of
    // the probe happens to run first. update() copies all three onto the goal
    // every frame, and a solver doing atan2(ny, nz) on an undefined turns the
    // foot rotation into a NaN quaternion that never washes out. Today the
    // invariant holds by accident; any future gate on the probe (animation LOD,
    // a `live` check) would break it silently.
    this.nx = 0; this.ny = 1; this.nz = 0;
    this.probeT = 0;
    this.weight = new Damper(0, FOOTLOCK_DEFAULTS.lockIn);

    // The frame-stable output object. Consumers hold this reference across
    // frames; it is mutated, never replaced.
    this.goal = {
      side,
      valid: this.valid,
      x: 0, y: 0, z: 0,          // world-space ankle target, lock already blended in
      nx: 0, ny: 1, nz: 0,       // ground normal for foot roll
      weight: 0,                 // 0..1 lock authority (also baked into x/y/z)
      locked: false,
      planted: false,
      groundY: 0,
      slip: 0,                   // world speed the animation wanted while pinned
    };
  }

  release() { this.locked = false; this.lockT = 0; }
}

function inPhase(p, a, b) {
  // Windows wrap past 1: the right foot's stance in a walk is [0.50, 0.12].
  return a <= b ? (p >= a && p <= b) : (p >= a || p <= b);
}

// =====================================================================
// FootLock
// =====================================================================

export class FootLock {
  /**
   * @param {Map|THREE.Object3D|THREE.Skeleton|object} source anything boneIndex() understands
   * @param {Partial<typeof FOOTLOCK_DEFAULTS>} opts
   */
  constructor(source, opts = {}) {
    this.opts = { ...FOOTLOCK_DEFAULTS, ...opts };
    const index = boneIndex(source);

    this.hips = index ? pick(index, HIP_NAMES) : null;
    this.feet = [new Foot('L', index), new Foot('R', index)];
    /** @type {Array<object>} stable goal objects — read these every frame. */
    this.goals = [this.feet[0].goal, this.feet[1].goal];

    // A rig missing a leg is not an error, it is a paperling. Go permanently
    // inert rather than guarding every branch below.
    this.active = this.feet[0].valid || this.feet[1].valid;
    this.enabled = true;

    this.sizeScale = 1;
    /** Pelvis compensation, metres, <= 0. The OWNER applies this — AnimationController
     *  ._applyBones already writes hips.position.y and two writers would fight. */
    this.hipDrop = 0;
    this._hipDamp = new Damper(0, this.opts.hipDropSmooth);

    this.stride = { clip: 'idle', authored: 0, ratio: 1, timeScale: 1, strideScale: 1, residual: 0 };
    this._speed = new Damper(0, this.opts.strideSmooth);

    this._prevRootX = 0; this._prevRootZ = 0; this._hasRoot = false;
    this.stats = { locked: 0, slip: 0, probes: 0 };
  }

  /** Teleport, floor change, respawn — anything that invalidates last frame's
   *  positions. Without this a floor transition pins a foot to the old room. */
  reset() {
    for (const f of this.feet) {
      f.release();
      f.hasPrev = false;
      f.weight.snap(0);
      f.goal.weight = 0;
      f.goal.locked = false;
      f.goal.planted = false;
    }
    this._hasRoot = false;
    this.hipDrop = 0;
    this._hipDamp.snap(0);
    // Carrying the pre-teleport cadence into the new room warps the first
    // stride of the arrival for no reason.
    this._speed.snap(0);
  }

  /**
   * @param {number} dt seconds
   * @param {{
   *   root?: THREE.Object3D, speed?: number, clip?: string, phase?: number,
   *   grounded?: boolean, enabled?: boolean, bvh?: {raycast: Function}, groundY?: number,
   * }} ctx
   *   root     the character wrapper (feet-at-origin), used for facing + ground fallback
   *   speed    planar speed in m/s — the same number that feeds speedNorm
   *   clip     the BASE layer's current logical state ('run' / 'walk' / ...)
   *   phase    optional clip phase 0..1 (action.time / clip.duration) for contact windows
   *   bvh      optional WorldBVH for stairs/props; flat floors don't need it
   * @returns {Array<object>} this.goals (stable references)
   */
  update(dt, ctx = {}) {
    const goals = this.goals;
    const o = this.opts;

    // NaN discipline, at the boundary and once. A NaN dt from a stalled tab, a
    // NaN speed from a divide-by-zero upstream, or a bone matrix some other
    // system already poisoned would otherwise become a NaN IK goal — and a NaN
    // quaternion does not wash out on the next frame, it corrupts the skeleton
    // for the lifetime of the character. `??` does not catch NaN; isFinite does.
    // Negative speed is clamped rather than rejected: it only ever means the
    // caller subtracted in the wrong order, and its warp is nonsense either way.
    const step = Number.isFinite(dt) ? dt : 0;
    const speed = Number.isFinite(ctx.speed) ? Math.max(0, ctx.speed) : 0;

    // Stride warping is useful even on a rig with no legs we can find (the
    // timeScale still drives the mixer), so it runs before the active gate.
    // The damper smooths the SPEED, not the ratio, so switching clips does not
    // drag the previous clip's warp along behind it.
    strideWarp(this._speed.to(speed, step), ctx.clip, this.stride, o);

    if (!this.active || step <= 0) return goals;

    const root = ctx.root ?? null;
    // Bone matrixWorld is only refreshed by the renderer's scene traversal, so
    // sampling right after mixer.update() reads LAST frame's pose. A one-frame-
    // stale plant position slides by speed*dt (~9 cm at 5 m/s) — exactly the
    // artefact this module exists to remove. updateWorldMatrix is the surgical
    // form: ancestors then this subtree, not the whole scene.
    if (root && o.autoUpdateMatrices) root.updateWorldMatrix(true, true);

    let rootY = Number.isFinite(ctx.groundY) ? ctx.groundY : 0;
    _fwd.set(0, 0, -1);
    if (root) {
      _v1.setFromMatrixPosition(root.matrixWorld);
      // An explicit ctx.groundY always wins and was already taken above; the
      // root's own y is only the fallback when the caller supplied nothing.
      if (!Number.isFinite(ctx.groundY) && Number.isFinite(_v1.y)) rootY = _v1.y;

      // A respawn or floor change moves the root metres in one frame. Without
      // this the old lock survives and the IK tears the leg across the level.
      if (this._hasRoot) {
        const dx = _v1.x - this._prevRootX, dz = _v1.z - this._prevRootZ;
        if (dx * dx + dz * dz > o.teleportDist * o.teleportDist) this.reset();
      }
      this._prevRootX = _v1.x; this._prevRootZ = _v1.z; this._hasRoot = true;

      // Characters face -Z (CHARACTER_ART_SPEC §1), so forward is the negated
      // Z basis column. Column read + negate beats getWorldDirection(), which
      // re-walks the ancestor chain and allocates nothing but costs everything.
      _fwd.setFromMatrixColumn(root.matrixWorld, 2).negate();
      _fwd.y = 0;
      const fl = _fwd.length();
      if (fl > 1e-5) _fwd.divideScalar(fl); else _fwd.set(0, 0, -1);
    }

    const live = this.enabled && ctx.enabled !== false && ctx.grounded !== false;
    const bvh = ctx.bvh ?? null;
    const meta = clipStride(this.stride.clip, speed);
    const phase = typeof ctx.phase === 'number' && isFinite(ctx.phase)
      ? ctx.phase - Math.floor(ctx.phase) : null;

    let hipNeed = 0;
    let lockedCount = 0;
    let worstSlip = 0;

    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      const goal = f.goal;
      if (!f.valid) continue;

      // Hoisted-temp matrix read, never getWorldPosition(): CCDIKSolver avoids
      // it for the same reason — the getter forces a fresh ancestor walk per call.
      _v1.setFromMatrixPosition(f.foot.matrixWorld);
      const ax = _v1.x, ay = _v1.y, az = _v1.z;

      // Somebody else's NaN stops here. A poisoned bone matrix (a zero-scale
      // parent, a bad retarget, a divide-by-zero in another system) would
      // otherwise be laundered into an IK goal and from there into a quaternion
      // that never recovers. Drop the lock, publish zero authority, hold the
      // last good position, and let the mixer pose the leg on its own.
      if (!Number.isFinite(ax + ay + az)) {
        f.release();
        f.hasPrev = false;
        f.weight.snap(0);
        goal.weight = 0; goal.locked = false; goal.planted = false; goal.slip = 0;
        continue;
      }

      // Accumulated world scale of the chain (height fit x spawn scale x elite
      // scale), so thresholds track the character that is actually on screen.
      const boneScale = _v2.setFromMatrixColumn(f.foot.matrixWorld, 1).length() || 1;
      f.legWorld = f.legLocal * boneScale;
      const s = clamp(f.legWorld / REF_LEG, 0.35, 3);
      this.sizeScale = s;

      // World velocity, not character-relative: a correctly stride-warped stance
      // foot is motionless IN THE WORLD, and that is the whole test. In
      // character space the same foot is travelling backwards at the authored
      // speed by construction, which makes local velocity useless here.
      let vy = 0, hspeed = 0;
      if (f.hasPrev) {
        const inv = 1 / step;
        const vx = (ax - f.prevX) * inv;
        const vz = (az - f.prevZ) * inv;
        vy = (ay - f.prevY) * inv;
        hspeed = Math.sqrt(vx * vx + vz * vz);
      }
      f.prevX = ax; f.prevY = ay; f.prevZ = az; f.hasPrev = true;

      // ---- ground ----
      f.probeT -= step;
      if (bvh && !f.locked && f.probeT <= 0) {
        this._probe(f, ax, ay, az, rootY, bvh, s);
        f.probeT = 1 / Math.max(1, o.groundProbeHz);
      } else if (!bvh) {
        // No BVH: the character origin sits on the floor by spec (§1, feet at
        // y=0), so it IS the ground plane. Flat floors are the common case and
        // this path costs zero rays.
        f.groundY = rootY; f.nx = 0; f.ny = 1; f.nz = 0;
      }

      const height = ay - f.groundY;

      // ---- plant detection ----
      const windowOk = this._contactAllowed(f, phase, meta);
      let planted;
      if (!live) {
        planted = false;
      } else if (f.locked) {
        // Staying locked deliberately ignores horizontal speed. If the authored
        // speed is wrong the pinned foot's animated position races away, and
        // releasing on that would hand the slide straight back. Toe-off is a
        // RISE, so height and vertical velocity are the honest exit signals.
        planted = windowOk
          && height <= o.releaseHeight * s
          && vy <= o.riseSpeed * s
          && f.lockT < o.maxLockTime;
      } else {
        // The stance foot is NOT motionless before the lock engages. Stride
        // warping deliberately hands the SPATIAL half of the correction to the
        // lock, so a correctly warped stance foot still drifts at
        // speed * (1 - 1/strideScale) — 0.7 m/s at a 5.3 m/s sprint. A fixed
        // 0.55 m/s gate would reject exactly the plants that matter most, and
        // the system would look like it does nothing at speed. Widen the gate by
        // the drift the lock exists to absorb, then cap it well under the swing
        // foot's speed (~2x body speed) so the gate can never catch a foot
        // mid-air.
        const drift = speed * Math.abs(1 - 1 / Math.max(0.05, this.stride.strideScale));
        const gate = Math.min(
          o.plantSpeed * s + drift * o.driftTolerance,
          Math.max(o.plantSpeed * s, speed * 0.55),
        );
        planted = windowOk
          && height <= o.plantHeight * s
          && vy <= o.riseSpeed * s
          && hspeed <= gate;
      }

      // ---- lock transitions ----
      if (planted && !f.locked) {
        // Probe once at the exact plant frame even if the throttle says no: this
        // is the one sample that has to be right, everything else is a hold.
        if (bvh) { this._probe(f, ax, ay, az, rootY, bvh, s); f.probeT = 1 / Math.max(1, o.groundProbeHz); }
        f.locked = true;
        f.lockT = 0;
        f.lockX = ax;
        f.lockZ = az;
        // Snap to the ground instead of trusting the clip's ankle height —
        // removes the "floating above / sunk into the floor" read for free, and
        // clamping keeps a bad frame from burying the foot.
        f.lockY = f.groundY + clamp(ay - f.groundY, 0.005 * s, 0.22 * s);
      } else if (!planted && f.locked) {
        f.release();
      }

      // ---- reach: lower the pelvis before breaking the lock ----
      if (f.locked) {
        f.lockT += step;
        _v2.setFromMatrixPosition(f.upleg.matrixWorld);
        const dx = _v2.x - f.lockX, dy = _v2.y - f.lockY, dz = _v2.z - f.lockZ;
        const reach = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const over = reach - f.legWorld * o.maxReach;
        if (over > o.maxHipDrop * s) {
          // Even a fully dropped pelvis cannot reach. Let go — a released foot
          // reads as a fast step, a stretched one reads as a broken rig.
          f.release();
        } else if (over > 0 && over > hipNeed) {
          hipNeed = over;
        }
      }

      // ---- blend ----
      const w = f.weight.to(f.locked ? 1 : 0, step, f.locked ? o.lockIn : o.lockOut);

      // Stride-warped swing target: scale the foot's forward offset from the
      // pelvis so the step reaches as far as the body is travelling. Faded out
      // by the lock weight because a pinned foot must not be pushed anywhere.
      let gx = ax, gy = ay, gz = az;
      const ss = this.stride.strideScale;
      if (ss !== 1 && this.hips && w < 1) {
        _v2.setFromMatrixPosition(this.hips.matrixWorld);
        const fwdAmt = (ax - _v2.x) * _fwd.x + (az - _v2.z) * _fwd.z;
        const extra = fwdAmt * (ss - 1) * (1 - w);
        gx += _fwd.x * extra;
        gz += _fwd.z * extra;
      }

      if (w > 0) {
        gx += (f.lockX - gx) * w;
        gy += (f.lockY - gy) * w;
        gz += (f.lockZ - gz) * w;
      }

      // Never publish a goal below the floor. Stride warping lengthens the step,
      // and a lengthened step on a descending swing arc pushes the ankle through
      // the ground — the solver would happily solve to it.
      const floorY = f.groundY + 0.005 * s;
      if (gy < floorY) gy = floorY;

      goal.x = gx; goal.y = gy; goal.z = gz;
      goal.nx = f.nx; goal.ny = f.ny; goal.nz = f.nz;
      goal.weight = w;
      goal.locked = f.locked;
      goal.planted = planted;
      goal.groundY = f.groundY;
      goal.slip = f.locked ? hspeed : 0;

      if (f.locked) lockedCount++;
      if (goal.slip > worstSlip) worstSlip = goal.slip;
    }

    // Negative = sink. Damped so a single over-reaching frame does not bob the
    // whole body; the owner reads `hipDrop` and applies it to the pelvis.
    this.hipDrop = this._hipDamp.to(-Math.min(hipNeed, o.maxHipDrop * this.sizeScale), step);
    this.stats.locked = lockedCount;
    // `slip` is the tuning number: the world speed a pinned foot still wanted.
    // Near zero means STRIDE_CLIPS[clip].speed is right. Persistently high means
    // it is not, and no amount of threshold tweaking will fix that.
    this.stats.slip = worstSlip;
    return goals;
  }

  /** Downward ray from above the ankle. Returns nothing; writes onto the foot. */
  _probe(f, ax, ay, az, rootY, bvh, s) {
    f.groundY = rootY;
    f.nx = 0; f.ny = 1; f.nz = 0;
    if (!bvh?.raycast) return;
    const up = this.opts.probeUp * s;
    _origin.set(ax, ay + up, az);
    const hit = bvh.raycast(_origin, _down, up + this.opts.probeDown * s);
    this.stats.probes++;
    // No hit means open air or no BVH built — the character's own origin stands
    // in. A hit with a non-finite y is a malformed collider; treat it the same
    // rather than pinning a foot to NaN.
    if (!hit?.point || !Number.isFinite(hit.point.y)) return;

    f.groundY = hit.point.y;
    const n = hit.normal;
    // A steep normal means we clipped a wall face, not a floor. Keeping it would
    // roll the foot 80 degrees onto its side.
    if (n && n.y > 0.5) { f.nx = n.x; f.ny = n.y; f.nz = n.z; }
  }

  _contactAllowed(f, phase, meta) {
    const mode = this.opts.contactMode;
    if (mode === 'heuristic') return true;
    const w = meta.contact?.[f.side];
    // No authored window, or no phase from the caller. 'auto' falls through to
    // pure geometry — refusing outright would silently disable locking for every
    // clip whose windows were never measured, which is most of them. 'window' is
    // the strict opt-in: it means "trust the authored windows and nothing else",
    // so with no window to consult it must say no, otherwise it is just a second
    // name for 'auto' and the three-mode option only ever delivered two.
    if (!w || phase === null) return mode !== 'window';
    return inPhase(phase, w[0], w[1]);
  }

  /** Drop bone references so a pooled/despawned character's skeleton is not kept
   *  alive by this object. Nothing here owns GPU resources. */
  dispose() {
    this.reset();
    this.hips = null;
    for (const f of this.feet) {
      f.upleg = f.leg = f.foot = null;
      f.valid = false;
      f.goal.valid = false;   // consumers gate on the goal, not on the Foot
    }
    this.active = false;
  }
}

/**
 * Tolerant factory. Returns a FootLock that is permanently inert (`active` is
 * false, `update()` is a two-branch early-out) when the rig has no legs, rather
 * than null — so call sites never need a null check in their hot loop.
 */
export function makeFootLock(source, opts = {}) {
  return new FootLock(source, opts);
}
