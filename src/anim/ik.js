// ============ runtime IK: feet, hands, head ============
// Three separate problems that all reduce to "the authored clip is nearly right,
// but the world disagrees":
//
//   FEET   A walk cycle assumes a flat floor. The office is stairs, desks,
//          toppled cabinets and debris. Without grounding, feet hover a hand's
//          width above a stair tread or sink to the ankle in a desk. Ray the
//          real collision world, move the ankle onto it, and drop the pelvis so
//          the far leg bends instead of dislocating.
//   HANDS  Authoring a hand pose per weapon is a per-weapon art cost forever.
//          Instead the WEAPON carries a grip node and the hand is solved onto
//          it, so one `idle`/`run`/`shoot` set serves the whole armoury.
//   HEAD   An office worker that tracks you before it attacks reads as alive.
//          A clamped yaw/pitch cone applied AFTER the mixer, recomputed from
//          scratch every frame so it cannot fight or drift against the clip.
//
// >>>>>>>>>>>>>>>>>>>>>>>>>>>>>> READ THIS <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
// CCDIKSolver addresses bones by INTEGER INDEX into `mesh.skeleton.bones`, NOT
// by Bone object. `ik.target`, `ik.effector` and every `ik.links[i].index` are
// array indices, dereferenced with zero guards — a stale index throws inside
// updateOne(). Every index in this file is resolved ONCE at construction from
// real Bone objects and never recomputed.
//
// The array we hand the solver is OURS, not the SkinnedMesh's. Two reasons, both
// load-bearing:
//
//   1. The solver's IK *target* must be a bone inside that array; there is no
//      "solve toward this world position" API. Appending goal bones to a real
//      Skeleton means appending to `skeleton.boneInverses` too — and
//      `Skeleton.clone()` stores boneInverses BY REFERENCE, so every clone of a
//      character slug shares one array. One spawn appending 4 goals would grow
//      the array for every other instance, forever.
//   2. If a bone we need is weighted into a second SkinnedMesh (accessories),
//      `skeleton.bones.indexOf(bone)` returns -1 and the chain silently dies.
//
// CCDIKSolver only ever reads `this.mesh.skeleton.bones` (updateOne/_valid) and
// `mesh.matrixWorld` (CCDIKHelper only). So it is handed a proxy carrying both,
// backed by our own bone array. Verified against three 0.180.0's CCDIKSolver.js.
// >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
//
// This module NEVER ticks an AnimationMixer. It runs strictly after whoever owns
// the mixer has ticked it (models.js `updateMixers`), reading the pose the clip
// just produced. Ticking a mixer here would double-advance every clip.

import * as THREE from 'three';
import { CCDIKSolver } from 'three/examples/jsm/animation/CCDIKSolver.js';
import { Damper, Damper3 } from '../core/spring.js';

// ---------------------------------------------------------------- tunables ---

const FOOT_DEFAULTS = {
  enabled: true,
  rayUp: 0.55,          // start above the ankle: a foot already intersecting a
                        // stair riser must still find the tread above it
  maxRaise: 0.45,       // highest an ankle may be pushed above the root plane
  maxDrop: 0.40,        // furthest it may reach below (a ledge, not a chasm)
  maxPelvisDrop: 0.26,  // deliberately < maxDrop: a hip that sinks the full
                        // ledge depth reads as the character melting
  pelvisFactor: 0.85,
  reachMax: 0.985,      // fraction of full leg length the goal may sit at —
                        // 1.0 locks the knee and CCD then jitters on the axis
  reachMin: 0.30,
  smooth: 0.09,         // Damper smoothTime on the vertical correction
  pelvisSmooth: 0.13,
  weightSmooth: 0.12,
  alignToSurface: true,
  maxTilt: 0.45,        // rad of foot pitch/roll onto the surface normal
  tiltSmooth: 0.10,
  iterations: 8,        // CCDIKSolver defaults ik.iteration to 1, which leaves a
                        // 2-link leg visibly short of the goal. 5-10 is the band.
  maxAngle: 0.5,        // rad cap per CCD step; stops a teleporting goal snapping
  preBend: 0.10,        // see preBend() — knees bend toward the character front
  poleSign: 1,
};

const HAND_DEFAULTS = {
  enabled: true,
  smooth: 0.055,
  reachMax: 0.985,
  reachMin: 0.25,
  weightSmooth: 0.10,
  matchRotation: 1,     // 0 = position only, 1 = wrist fully owned by the grip
  iterations: 6,
  maxAngle: 0.6,
  preBend: 0.10,
  poleSign: -1,         // elbows bend toward the character's back
};

const LOOK_DEFAULTS = {
  enabled: true,
  maxYaw: 1.25,         // ~72deg — past this the shoulders would have to turn
  maxPitch: 0.60,       // ~34deg
  giveUp: 2.10,         // ~120deg: target is behind us, stop looking rather than
                        // pinning the head at the cone edge staring at a wall
  yawSmooth: 0.16,
  pitchSmooth: 0.16,
  weightSmooth: 0.22,
  share: { spine: 0.15, neck: 0.35, head: 0.50 },
};

// ------------------------------------------------------- module-scope temps ---
// Hoisted per the no-per-frame-allocation rule. Three disjoint pools so a helper
// can never clobber a caller's in-flight vector:
//   _v*/_q*   general use inside one sub-update
//   _r*       per-frame root frame, written once in update(), read by all
//   _d*       owned exclusively by applyWorldDelta()

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _scl = new THREE.Vector3();

const _rPos = new THREE.Vector3();
const _rQuat = new THREE.Quaternion();
const _rScl = new THREE.Vector3();
const _rUp = new THREE.Vector3();
const _rRight = new THREE.Vector3();
const _rFwd = new THREE.Vector3();

const _dPos = new THREE.Vector3();
const _dScl = new THREE.Vector3();
const _dq1 = new THREE.Quaternion();
const _dq2 = new THREE.Quaternion();

const _DOWN = new THREE.Vector3(0, -1, 0);
const _IDENT = new THREE.Quaternion();

// ------------------------------------------------------------ bone lookup ---
// GLTFLoader strips ':' from node names (sanitizeNodeName), so `mixamorig:Hips`
// arrives as `mixamorigHips`. Match both forms — same regex models.js uses.
const stripPrefix = (n) => String(n || '').replace(/^mixamorig:?/i, '');

/**
 * Blend weights arrive from callers as ratios; a non-finite one reads as "off".
 * The UPPER clamp matters as much as the lower: player.js derives speedNorm as
 * hSpeed / (moveSpeed * sprintMult) with no clamp of its own, and a dash or a
 * knockback pushes that above 1. Unclamped, that scales the foot target past the
 * ground and drives the ankle ~18cm through the floor with the pelvis pinned at
 * full drop.
 */
const weight01 = (v) => (Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0);

const BONES = {
  hips: ['hips', 'hip', 'pelvis'],
  spine2: ['spine2', 'spine_02', 'upperchest', 'chest'],
  neck: ['neck'],
  head: ['head'],
};

const LEG_SPEC = [
  { side: 'left', upper: ['leftupleg', 'upleg_l', 'thigh_l'], lower: ['leftleg', 'leg_l', 'calf_l', 'shin_l'], foot: ['leftfoot', 'foot_l'], toe: ['lefttoebase', 'toe_l', 'ball_l'] },
  { side: 'right', upper: ['rightupleg', 'upleg_r', 'thigh_r'], lower: ['rightleg', 'leg_r', 'calf_r', 'shin_r'], foot: ['rightfoot', 'foot_r'], toe: ['righttoebase', 'toe_r', 'ball_r'] },
];

const ARM_SPEC = [
  { side: 'left', upper: ['leftarm', 'upperarm_l', 'arm_l'], lower: ['leftforearm', 'lowerarm_l', 'forearm_l'], hand: ['lefthand', 'hand_l'] },
  { side: 'right', upper: ['rightarm', 'upperarm_r', 'arm_r'], lower: ['rightforearm', 'lowerarm_r', 'forearm_r'], hand: ['righthand', 'hand_r'] },
];

/** Accepts models.js's `parts.bones` Map, a plain object, or any Object3D root. */
function buildBoneIndex(src) {
  const map = new Map();
  if (!src) return map;
  if (src instanceof Map) {
    for (const [k, v] of src) if (v) map.set(String(k).toLowerCase(), v);
    return map;
  }
  if (src.isObject3D) {
    // Sockets are exported as empty Object3Ds by some pipelines and as Bones by
    // others; index both so a partial delivery still resolves.
    src.traverse((o) => {
      if (o.isBone || o.type === 'Object3D') map.set(stripPrefix(o.name).toLowerCase(), o);
      // A SkinnedMesh's bones hang off the armature node as SIBLINGS of the mesh,
      // never as its children, and the mesh's own `type` is 'SkinnedMesh' — so
      // traverse() alone extracts NOTHING from a bare SkinnedMesh. Harvest the
      // skeleton as well, with the same key shape, so `mesh` resolves identically
      // to models.js `parts.bones`.
      // BACKFILL, never overwrite: a second SkinnedMesh with its own distinct
      // skeleton (an accessory rig not produced by SkeletonUtils.clone) would
      // otherwise win over the real bones found in the root subtree — and those
      // bones are not refreshed by our updateMatrixWorld, so every solve would
      // read stale world matrices. The traverse's own result must win.
      if (o.isSkinnedMesh && o.skeleton) {
        for (const b of o.skeleton.bones) {
          if (!b) continue;
          const key = stripPrefix(b.name).toLowerCase();
          if (!map.has(key)) map.set(key, b);
        }
      }
    });
    return map;
  }
  for (const k of Object.keys(src)) if (src[k]) map.set(k.toLowerCase(), src[k]);
  return map;
}

const pick = (index, names) => {
  for (const n of names) {
    const b = index.get(n);
    if (b) return b;
  }
  return null;
};

/**
 * CCDIKSolver._valid() console.warns (per rig, per spawn) when links are not an
 * effector-outward parent chain. We test the same condition first and drop the
 * chain instead — a rig with a twist bone spliced into the leg degrades to "no
 * foot IK" rather than to a wall of console spam and a mis-solved limb.
 */
function chainIsParented(effector, links) {
  let node = effector;
  for (const b of links) {
    if (!b || node.parent !== b) return false;
    node = b;
  }
  return true;
}

/** Detached goal bone. We author its matrixWorld directly — see _setGoal(). */
function makeGoal(name) {
  const b = new THREE.Bone();
  b.name = name;
  // Deliberately never parented. The solver reads nothing but matrixWorld, so a
  // free-floating goal costs zero scene-graph work and cannot be overwritten by
  // the renderer's scene.updateMatrixWorld() pass.
  b.matrixAutoUpdate = false;
  b.matrixWorldAutoUpdate = false;
  return b;
}

/** World-space translation straight into a goal's matrixWorld. */
function setGoal(goal, x, y, z) {
  const e = goal.matrixWorld.elements;
  e[12] = x; e[13] = y; e[14] = z;
}

/**
 * Pull `out` onto the spherical shell around a joint. A CCD chain asked to reach
 * past its own length converges to a locked-straight limb and then oscillates on
 * the singular axis; clamping the GOAL instead keeps the pose bent and stable.
 */
function clampReach(out, jx, jy, jz, minLen, maxLen) {
  const dx = out.x - jx, dy = out.y - jy, dz = out.z - jz;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 1e-5) return;
  const k = d > maxLen ? maxLen / d : (d < minLen ? minLen / d : 1);
  if (k === 1) return;
  out.set(jx + dx * k, jy + dy * k, jz + dz * k);
}

// Above this cosine between the two segments the chain counts as dead straight.
const STRAIGHT_COS = 0.9995;

/**
 * Break the CCD straight-chain singularity.
 *
 * When a chain is exactly straight and its goal sits on that same axis, EVERY
 * candidate rotation reduces the error by zero: updateOne() measures angle < 1e-5
 * for every link, never sets `rotated`, and breaks out on the first iteration.
 * A character whose idle pose has dead-straight legs would then never ground a
 * single foot — no error, no warning, the feature just silently does nothing.
 *
 * One deterministic nudge fixes it. Rotating the chain's root bone by a small
 * angle about `chainDir x pole` moves the middle joint toward the perpendicular
 * component of `pole` — that identity holds for any bone orientation, so knees
 * go forward and elbows go back without hard-coding either rig's rest basis.
 * Self-limiting: once the chain is bent the straightness test stops firing.
 */
function preBend(upper, lower, effector, poleX, poleY, poleZ, angle) {
  if (!(angle > 0)) return;
  _v1.setFromMatrixPosition(upper.matrixWorld);
  _v2.setFromMatrixPosition(lower.matrixWorld);
  _v3.setFromMatrixPosition(effector.matrixWorld);
  const ax = _v2.x - _v1.x, ay = _v2.y - _v1.y, az = _v2.z - _v1.z;
  const bx = _v3.x - _v2.x, by = _v3.y - _v2.y, bz = _v3.z - _v2.z;
  const la = Math.sqrt(ax * ax + ay * ay + az * az);
  const lb = Math.sqrt(bx * bx + by * by + bz * bz);
  if (la < 1e-5 || lb < 1e-5) return;
  if ((ax * bx + ay * by + az * bz) / (la * lb) < STRAIGHT_COS) return;   // already bent

  const dx = ax / la, dy = ay / la, dz = az / la;
  _v1.set(dy * poleZ - dz * poleY, dz * poleX - dx * poleZ, dx * poleY - dy * poleX);
  if (_v1.lengthSq() < 1e-8) return;   // pole parallel to the chain: no hinge exists
  _q1.setFromAxisAngle(_v1.normalize(), angle);
  applyWorldDelta(upper, _q1);
}

/**
 * Non-accumulation guard for every bone this module rotates.
 *
 * All of it is an OFFSET on top of the pose the AnimationMixer wrote this frame,
 * and that is only drift-free while the mixer really does rewrite it. A rig
 * delivered without a `walk` clip, a layer whose action faded to weight 0 (three
 * then sets action.enabled = false and stops writing), or the procedural box rig
 * with no mixer at all, would otherwise integrate the correction every frame
 * until the limb wraps around — slowly enough to look like a physics bug.
 *
 * Bit-exact comparison against what we last wrote separates the two cases with
 * zero configuration: a quaternion still identical to ours means nobody else
 * owns this bone, so we put back the pose we found before touching it.
 */
class PoseGuard {
  constructor() { this.bones = []; this.anim = []; this.written = []; }

  add(bone) {
    if (!bone || this.bones.indexOf(bone) !== -1) return;
    this.bones.push(bone);
    this.anim.push(bone.quaternion.clone());
    // NaN never compares equal, so the first restore() always takes the
    // "somebody else owns this" branch and simply samples the current pose.
    this.written.push(new THREE.Quaternion(NaN, NaN, NaN, NaN));
  }

  /** @returns {boolean} true if any bone's LOCAL transform was actually rewritten. */
  restore() {
    let changed = false;
    for (let i = 0; i < this.bones.length; i++) {
      const q = this.bones[i].quaternion, w = this.written[i];
      if (q.x === w.x && q.y === w.y && q.z === w.z && q.w === w.w) {
        const a = this.anim[i];
        // Only report a change when the value really moves. Restoring a bone we
        // never offset is a no-op, and calling it "changed" would force the
        // world-matrix refresh every frame and make skipMatrixUpdate useless.
        if (q.x !== a.x || q.y !== a.y || q.z !== a.z || q.w !== a.w) { q.copy(a); changed = true; }
      } else this.anim[i].copy(q);
    }
    return changed;
  }

  commit() {
    for (let i = 0; i < this.bones.length; i++) this.written[i].copy(this.bones[i].quaternion);
  }
}

/** Live bone-chain length in WORLD units, so a rescaled root stays correct. */
function chainLength(a, b, c) {
  _v1.setFromMatrixPosition(a.matrixWorld);
  _v2.setFromMatrixPosition(b.matrixWorld);
  _v3.setFromMatrixPosition(c.matrixWorld);
  return _v1.distanceTo(_v2) + _v2.distanceTo(_v3);
}

/**
 * Add a WORLD-space rotation on top of whatever the mixer wrote to this bone
 * this frame.
 *
 * This is the whole trick behind "must not fight the mixer": the delta is
 * recomputed from the current pose every single frame and PREmultiplied onto the
 * freshly-written local quaternion. Nothing is stored on the bone, so there is
 * no accumulation and no drift — if the look-at is switched off, the very next
 * mixer tick restores the authored pose exactly.
 *
 * Owns _dPos, _dScl, _dq1, _dq2 exclusively, so a caller may keep a general
 * temp (_v1, _q1, ...) live across this call.
 */
function applyWorldDelta(bone, qDeltaWorld) {
  const parent = bone.parent;
  if (parent) {
    // decompose (not setFromRotationMatrix) so a scaled armature does not shear
    // the extracted rotation. Non-uniform scale is still approximate — the art
    // spec forbids it, and the failure is a slightly wrong angle, not a throw.
    parent.matrixWorld.decompose(_dPos, _dq1, _dScl);
    _dq2.copy(_dq1).invert().multiply(qDeltaWorld).multiply(_dq1); // P^-1 * D * P
    bone.quaternion.premultiply(_dq2);
  } else {
    bone.quaternion.premultiply(qDeltaWorld);
  }
  // Descendants must see the change before the next chain is solved against it.
  bone.updateMatrixWorld(true);
}

// ------------------------------------------------------------------ class ---

export class CharacterIK {
  /**
   * @param {{
   *   root: THREE.Object3D,                 outer wrapper — its origin is the foot plane
   *   bones?: Map|Object|THREE.Object3D,    models.js `parts.bones`, or anything to index
   *   mesh?: THREE.SkinnedMesh,             for createHelper(); also a valid bone source
   *   world?: import('../core/worldbvh.js').WorldBVH,
   *   feet?: object, hands?: object, look?: object,
   * }} opts
   */
  constructor({ root, bones = null, mesh = null, world = null, feet = {}, hands = {}, look = {} } = {}) {
    this.root = root || mesh || null;
    this.mesh = mesh || null;
    this.world = world || null;
    this.enabled = true;

    // `weight` and `target` are read every frame as the default when the matching
    // opts.* is omitted (see update()), so they are real knobs — the literal must
    // fall back to the caller's value rather than clobber it.
    this.feet = { ...FOOT_DEFAULTS, ...feet, weight: feet?.weight ?? 1 };
    this.hands = { ...HAND_DEFAULTS, ...hands, weight: hands?.weight ?? 1 };
    this.look = { ...LOOK_DEFAULTS, ...look, weight: look?.weight ?? 1, target: look?.target ?? null };
    this.look.share = { ...LOOK_DEFAULTS.share, ...(look?.share || {}) };

    // applyLOD() runs every frame for every enemy and would otherwise force-enable
    // a feature the caller deliberately switched off (a non-humanoid enemy, a rig
    // with known-bad legs, a perf opt-out). Capture the authored intent and AND
    // against it, so "off" means off for the life of the rig.
    this._cfgFeet = this.feet.enabled !== false;
    this._cfgHands = this.hands.enabled !== false;
    this._cfgLook = this.look.enabled !== false;

    this.stats = { rays: 0, solves: 0 };

    // ---- bone resolution. Anything unresolved simply removes a feature. ----
    // `root` before `mesh`: the armature (and therefore every bone) lives under
    // the root, while a SkinnedMesh only yields bones via its skeleton. Both work
    // now, but preferring the root keeps sockets and non-skinning empties indexed.
    const index = buildBoneIndex(bones || root || mesh);
    this.boneIndex = index;
    this.hips = pick(index, BONES.hips);

    /** Our own bone table — the array indices below point into THIS. */
    this.boneArray = [];
    this._slot = new Map();
    this.iks = [];

    this.legs = [];
    this.arms = [];
    this.lookSegments = [];
    this.guard = new PoseGuard();

    if (this.root) {
      this._buildLegs(index);
      this._buildArms(index);
      this._buildLook(index);
    }

    // The solver snapshots _initialQuaternions from the iks array handed to the
    // CONSTRUCTOR. Mutating solver.iks afterwards leaves that array stale and
    // the next blended solve reads undefined and throws. So: every chain this
    // rig will ever use is built here, once, and enable/disable is expressed by
    // calling updateOne() selectively rather than by editing solver.iks.
    this.solver = this.iks.length ? new CCDIKSolver(this._proxy(), this.iks) : null;
    this.helper = null;

    // Pelvis-drop bookkeeping — see _applyPelvis() for why both are needed.
    this._hipsAnimY = this.hips ? this.hips.position.y : 0;
    this._hipsWrittenY = NaN;
    this._pelvisActive = false;
    this._pelvisD = new Damper(0, this.feet.pelvisSmooth);

    this._dirty = false;        // did last frame actually write to a bone?
    this._lookApplied = false;
    this._lookYawD = new Damper(0, this.look.yawSmooth);
    this._lookPitchD = new Damper(0, this.look.pitchSmooth);
    this._lookWD = new Damper(0, this.look.weightSmooth);

    /** False when nothing resolved: update() then costs one boolean test. */
    this.available = Boolean(this.root) && (this.legs.length > 0 || this.arms.length > 0 || this.lookSegments.length > 0);
  }

  /**
   * The stand-in SkinnedMesh. CCDIKSolver touches exactly these two members;
   * matrixWorld is passed BY REFERENCE so CCDIKHelper keeps tracking the real
   * mesh without any per-frame copy.
   */
  _proxy() {
    return {
      isSkinnedMesh: true,
      skeleton: { bones: this.boneArray },
      matrixWorld: (this.mesh || this.root).matrixWorld,
    };
  }

  /** Intern a Bone and return its index in our table. THE index the solver uses. */
  _idx(bone) {
    let i = this._slot.get(bone);
    if (i === undefined) {
      i = this.boneArray.length;
      this.boneArray.push(bone);
      this._slot.set(bone, i);
    }
    return i;
  }

  // ------------------------------------------------------------ chain setup

  _buildLegs(index) {
    for (const spec of LEG_SPEC) {
      const upper = pick(index, spec.upper);
      const lower = pick(index, spec.lower);
      const foot = pick(index, spec.foot);
      // A rig missing any of the three simply has no foot IK on that side.
      if (!upper || !lower || !foot) continue;
      if (!chainIsParented(foot, [lower, upper])) continue;

      const goal = makeGoal(`ik_goal_foot_${spec.side}`);
      const ik = {
        target: this._idx(goal),
        effector: this._idx(foot),
        // links are effector-outward: knee first, then hip. Reversing them makes
        // CCDIKSolver._valid() warn and the solve converge to nonsense.
        links: [{ index: this._idx(lower) }, { index: this._idx(upper) }],
        iteration: this.feet.iterations,
        maxAngle: this.feet.maxAngle,
        blendFactor: 1,
        // rotationMin/rotationMax deliberately unset. They are Vector3 Euler
        // clamps (the JSDoc says {number}, the code says Vector3) applied in the
        // bone's own rest basis, which differs per exporter. A wrong knee hinge
        // is a visibly broken leg; the reach clamp plus starting from an already
        // bent authored pose keeps CCD out of the hyperextension basin anyway.
      };
      this.iks.push(ik);
      this.guard.add(upper); this.guard.add(lower); this.guard.add(foot);

      this.legs.push({
        side: spec.side,
        upper, lower, foot,
        toe: pick(index, spec.toe),
        goal, ik,
        enabled: true,
        yD: new Damper(0, this.feet.smooth),
        wD: new Damper(0, this.feet.weightSmooth),
        pitchD: new Damper(0, this.feet.tiltSmooth),
        rollD: new Damper(0, this.feet.tiltSmooth),
        animPos: new THREE.Vector3(),
        target: new THREE.Vector3(),
        nx: 0, ny: 1, nz: 0,
        hit: false,
      });
    }
  }

  _buildArms(index) {
    for (const spec of ARM_SPEC) {
      const upper = pick(index, spec.upper);
      const lower = pick(index, spec.lower);
      const hand = pick(index, spec.hand);
      if (!upper || !lower || !hand) continue;
      if (!chainIsParented(hand, [lower, upper])) continue;

      const goal = makeGoal(`ik_goal_hand_${spec.side}`);
      const ik = {
        target: this._idx(goal),
        effector: this._idx(hand),
        links: [{ index: this._idx(lower) }, { index: this._idx(upper) }],
        iteration: this.hands.iterations,
        maxAngle: this.hands.maxAngle,
        blendFactor: 1,
      };
      this.iks.push(ik);
      this.guard.add(upper); this.guard.add(lower); this.guard.add(hand);

      this.arms.push({
        side: spec.side,
        upper, lower, hand,
        goal, ik,
        enabled: true,
        target: null,             // Object3D grip node, or null
        weight: 1,
        matchRotation: this.hands.matchRotation,
        gripOffset: new THREE.Quaternion(),
        wD: new Damper(0, this.hands.weightSmooth),
        posD: new Damper3(0, 0, 0, this.hands.smooth),
        goalPos: new THREE.Vector3(),
        primed: false,
      });
    }
  }

  _buildLook(index) {
    const head = pick(index, BONES.head);
    if (!head) return;   // no head bone -> no look-at, silently
    const segs = [
      { bone: pick(index, BONES.spine2), frac: this.look.share.spine },
      { bone: pick(index, BONES.neck), frac: this.look.share.neck },
      { bone: head, frac: this.look.share.head },
    ].filter((s) => s.bone && s.frac > 0);

    // Renormalise so a rig without a Neck still turns its head the full amount
    // instead of quietly under-rotating by 35%.
    let sum = 0;
    for (const s of segs) sum += s.frac;
    if (sum > 1e-4) for (const s of segs) s.frac /= sum;
    for (const s of segs) this.guard.add(s.bone);
    this.lookSegments = segs;
    this.headBone = head;
  }

  // ----------------------------------------------------------------- public

  /**
   * @param {'left'|'right'} side
   * @param {THREE.Object3D|null} node grip node on the weapon (or anything)
   * @param {{matchRotation?: number, weight?: number}} [opts]
   */
  setHandTarget(side, node, opts = {}) {
    const arm = this.arms.find((a) => a.side === side);
    if (!arm) return false;
    if (!node) { arm.target = null; arm.primed = false; return true; }

    // A grip node parented UNDER the hand we are about to solve is a feedback
    // loop: the goal moves because the hand moved. Refuse rather than shipping a
    // slow drift nobody can reproduce.
    for (let n = node; n; n = n.parent) {
      if (n === arm.hand || n === arm.lower || n === arm.upper) return false;
    }

    arm.target = node;
    arm.primed = false;   // snap the damper on the first solved frame, no sweep
    if (opts.matchRotation !== undefined) arm.matchRotation = opts.matchRotation;
    if (opts.weight !== undefined) arm.weight = opts.weight;
    return true;
  }

  clearHandTarget(side) { return this.setHandTarget(side, null); }

  /** @param {THREE.Vector3|THREE.Object3D|null} target */
  setLookTarget(target) { this.look.target = target || null; }

  /**
   * Animation LOD. Tier comes straight from EnemyLOD (`e.lodTier`): 0 near,
   * 3 distant. Foot grounding is the expensive one (two BVH rays + two solves)
   * and also the first thing that stops being legible with distance.
   */
  applyLOD(tier) {
    // ANDed against the constructor's flags: LOD may only ever take a feature
    // away, never hand one back that the caller never asked for.
    this.feet.enabled = this._cfgFeet && tier <= 0;
    this.hands.enabled = this._cfgHands && tier <= 1;
    this.look.enabled = this._cfgLook && tier <= 1;
    // iteration is safe to mutate per frame; links.length is NOT (it sizes the
    // solver's _initialQuaternions, which is snapshotted in the constructor).
    for (const leg of this.legs) leg.ik.iteration = tier <= 0 ? this.feet.iterations : 3;
    for (const arm of this.arms) arm.ik.iteration = tier <= 0 ? this.hands.iterations : 3;
  }

  /**
   * Run every enabled solver. Call AFTER the AnimationMixer has been ticked for
   * this frame — this reads the pose the clip just wrote and edits it in place.
   * It never ticks a mixer itself; doing so would double-advance every clip that
   * models.js `updateMixers` already drives.
   *
   * Safe to call on a rig with no mixer, no clips, or a faded-out layer: PoseGuard
   * detects that nobody rewrote a bone and restores the pre-IK pose first, so the
   * corrections stay offsets instead of integrating.
   *
   * @param {number} dt
   * @param {{
   *   footWeight?: number, handWeight?: number, lookWeight?: number,
   *   grounded?: boolean, lookTarget?: THREE.Vector3|THREE.Object3D|null,
   *   skipMatrixUpdate?: boolean,
   * }} [opts]
   */
  update(dt, opts = {}) {
    if (!this.enabled || !this.available || !(dt > 0)) return;

    // Fully switched off AND nothing left over from last frame: bail before the
    // world-matrix refresh. That refresh is the single largest fixed cost here,
    // and at LOD 2+ it would be paid by every distant enemy for no visible
    // result. `_dirty` keeps one more full pass running after a shutdown so the
    // dampers can fade the last correction out instead of snapping it away.
    if (!this.feet.enabled && !this.hands.enabled && !this.look.enabled && !this._dirty) return;

    if (opts.lookTarget !== undefined) this.look.target = opts.lookTarget;
    // Airborne feet must not be nailed to the floor they left.
    const grounded = opts.grounded !== false;
    // Sanitise the three weights HERE, once, at the only boundary they enter by.
    // A NaN weight is not merely a no-op: the look path computes `want * weight`
    // with want already 0, and 0 * NaN is NaN, which lands in _lookWD and then in
    // a bone quaternion — and a NaN never leaves a damper. Callers derive these
    // from speed ratios and LOD blends, so a non-finite value is one divide away.
    const footW = weight01(opts.footWeight ?? this.feet.weight) * (grounded ? 1 : 0);
    const handW = weight01(opts.handWeight ?? this.hands.weight);
    const lookW = weight01(opts.lookWeight ?? this.look.weight);

    // Undo any of last frame's corrections the mixer did not already overwrite,
    // so what follows is always an offset on a clean authored pose. Must run
    // before the world-matrix refresh, because it edits local transforms.
    //
    // The pelvis drop is a local transform too, and it MUST be undone here rather
    // than lazily inside _applyPelvis(): _updateFeet samples every ankle from
    // foot.matrixWorld long before the pelvis code runs, so on a rig whose clips
    // carry no Hips translation track a lazy read-back leaves both feet planted a
    // full maxPelvisDrop below the surface the ray found — stable, silent, wrong.
    const restoredBones = this.guard.restore();
    const restoredHips = this._restorePelvis();

    // The mixer wrote LOCAL transforms; every solver below works in world space.
    // updateWorldMatrix(parents, children) is the surgical form —
    // updateMatrixWorld() would not refresh our ancestors, and calling it on the
    // scene from inside a per-character update is O(scene).
    //
    // skipMatrixUpdate is only honoured when the restore above changed nothing.
    // Otherwise the solvers would read matrixWorlds describing LAST frame's
    // solved pose while writing offsets onto THIS frame's restored locals; the
    // two disagree by exactly the last correction and the solve lands wrong.
    if (!opts.skipMatrixUpdate || restoredBones || restoredHips) this.root.updateWorldMatrix(true, true);

    this.root.matrixWorld.decompose(_rPos, _rQuat, _rScl);
    _rUp.set(0, 1, 0).applyQuaternion(_rQuat);
    _rRight.set(1, 0, 0).applyQuaternion(_rQuat);
    _rFwd.set(0, 0, -1).applyQuaternion(_rQuat);   // art spec: characters face -Z

    this.stats.rays = 0;
    this.stats.solves = 0;
    this._lookApplied = false;

    // Order is not arbitrary:
    //   feet   pelvis drop moves EVERYTHING, so it has to happen first
    //   look   spine2 is an ancestor of both arms, so it must precede hands
    //   hands  last, solved against the final torso pose
    this._updateFeet(dt, footW);
    this._updateLook(dt, lookW);
    this._updateHands(dt, handW);

    this._dirty = this.stats.solves > 0 || this._pelvisActive || this._lookApplied;
    this.guard.commit();
  }

  // ------------------------------------------------------------------- feet

  _updateFeet(dt, weight) {
    const F = this.feet;
    const on = Boolean(F.enabled && this.world && this.legs.length > 0 && weight > 0.001);

    // 1. Sample the ground under each ankle from the CURRENT animated pose. The
    //    goal is an ABSOLUTE world position, so it must be captured before the
    //    pelvis moves the legs underneath us.
    let lowest = 0;
    for (const leg of this.legs) {
      const w = leg.wD.to(on && leg.enabled ? weight : 0, dt);
      // Note this gates on the damped WEIGHT, not on `on`: switching IK off must
      // fade the correction out over ~120ms, not snap the feet back mid-stride.
      if (w <= 0.002) { leg.hit = false; continue; }

      leg.animPos.setFromMatrixPosition(leg.foot.matrixWorld);
      let delta = 0;
      leg.hit = false;

      if (on && leg.enabled) {
        // Ray from between the ankle and the toe, not from the ankle. The ankle
        // sits well behind the contact patch, so on a stair edge an ankle-only
        // ray reads the LOWER step and drives the toes through the riser.
        let sx = leg.animPos.x, sz = leg.animPos.z;
        if (leg.toe) {
          _v2.setFromMatrixPosition(leg.toe.matrixWorld);
          sx = (sx + _v2.x) * 0.5;
          sz = (sz + _v2.z) * 0.5;
        }
        _v1.set(sx, leg.animPos.y + F.rayUp, sz);
        const hit = this.world.raycast(_v1, _DOWN, F.rayUp + F.maxDrop + F.maxRaise);
        this.stats.rays++;
        // A degenerate collision triangle can hand back a non-finite point or
        // normal. MathUtils.clamp launders NaN straight through (both comparisons
        // are false), so it would reach leg.yD and never leave. Treat it as a miss.
        if (hit && Number.isFinite(hit.point?.y)) {
          leg.hit = true;
          // Ground height relative to the character's own foot plane (root
          // origin), NOT to the animated ankle — otherwise a lifted foot mid
          // stride would read its own lift as terrain and stair-step upward.
          delta = THREE.MathUtils.clamp(hit.point.y - _rPos.y, -F.maxDrop, F.maxRaise);
          const n = hit.normal || hit.face?.normal || null;
          if (n && Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z)) {
            leg.nx = n.x; leg.ny = n.y; leg.nz = n.z;
          } else { leg.nx = 0; leg.ny = 1; leg.nz = 0; }
        }
      }

      // Missing hit (a pit, a hole in the collision) decays to zero rather than
      // holding the last correction — a stale offset looks like a broken leg.
      const y = leg.yD.to(delta, dt);
      // The pelvis must follow the correction the FEET actually received, not the
      // raw one. `on` only goes false at weight <= 0.001, so during the ~120ms wD
      // ramp (IK switching on, or LOD tier 1 -> 0) an unweighted `lowest` sinks
      // the hips the full drop while the feet have barely moved — straight legs,
      // body in the floor, the exact artifact the pelvis drop exists to prevent.
      const yw = y * w;
      leg.target.set(leg.animPos.x, leg.animPos.y + yw, leg.animPos.z);
      if (yw < lowest) lowest = yw;
    }

    // 2. Pelvis. The foot that has to reach DOWNWARD is the one that runs out of
    //    leg, so the hips follow the lowest correction. Without this, one foot on
    //    a step below the other visibly dislocates at the knee.
    this._applyPelvis(this._pelvisD.to(
      Math.max(-F.maxPelvisDrop, Math.min(0, lowest * F.pelvisFactor)) * (on ? 1 : 0), dt,
    ));

    // 3. Solve. Reach is measured live so a rescaled root (enemies.js scales
    //    bosses to 2.4x) does not silently break the clamp.
    for (const leg of this.legs) {
      const w = leg.wD.value;
      if (w <= 0.02 || !leg.enabled) continue;
      const len = chainLength(leg.upper, leg.lower, leg.foot);
      _v1.setFromMatrixPosition(leg.upper.matrixWorld);
      clampReach(leg.target, _v1.x, _v1.y, _v1.z, len * F.reachMin, len * F.reachMax);
      // Rotating about the hip does not move the hip, so the clamp above stays
      // valid across the nudge.
      preBend(leg.upper, leg.lower, leg.foot,
        _rFwd.x * F.poleSign, _rFwd.y * F.poleSign, _rFwd.z * F.poleSign, F.preBend);
      setGoal(leg.goal, leg.target.x, leg.target.y, leg.target.z);
      this._solve(leg.ik, w);
      if (F.alignToSurface && leg.hit) this._alignFoot(leg, dt, w);
    }
  }

  /**
   * Undo last frame's pelvis drop before anything samples a world matrix.
   *
   * Exact float equality against what we last wrote distinguishes "the clip has
   * no Hips translation track, so nobody overwrote us" from "the mixer rewrote
   * it" with no per-rig config. _hipsWrittenY starts NaN, and NaN never compares
   * equal, so the very first frame always takes the "somebody else owns it" path.
   *
   * @returns {boolean} true if a local transform actually moved
   */
  _restorePelvis() {
    const hips = this.hips;
    if (!hips || hips.position.y !== this._hipsWrittenY) return false;
    if (hips.position.y === this._hipsAnimY) return false;
    hips.position.y = this._hipsAnimY;
    return true;
  }

  /**
   * Vertical pelvis offset, in the hips' own parent space.
   *
   * The mixer owns hips.position: it rewrites it every frame from the clip's hip
   * track, which is what makes "read it, add our offset, write it back" safe.
   * But a rig whose clips carry NO hips translation track never gets rewritten,
   * and the same read-add-write would then integrate our own offset every frame
   * until the character sinks through the floor. That read-back lives in
   * _restorePelvis(), which update() calls up front alongside guard.restore() —
   * so by the time we get here hips.position.y is guaranteed to be the authored
   * value, with no equality test needed.
   */
  _applyPelvis(dropWorld) {
    const hips = this.hips;
    if (!hips) return;
    // Skip the full-body world-matrix pass on flat ground, which is most frames.
    if (Math.abs(dropWorld) < 1e-5 && !this._pelvisActive) return;
    const animY = hips.position.y;
    this._hipsAnimY = animY;

    // hips.position is parent-local; convert the world drop through the parent's
    // scale. The art spec fixes the armature Y-up and unrotated, so scale is the
    // only term that matters — a rotated armature root would need the full
    // inverse transform and is out of contract.
    let s = 1;
    if (hips.parent) {
      hips.parent.matrixWorld.decompose(_v1, _q1, _scl);
      s = Math.abs(_scl.y) > 1e-4 ? _scl.y : 1;
    }
    hips.position.y = animY + dropWorld / s;
    this._hipsWrittenY = hips.position.y;
    this._pelvisActive = Math.abs(dropWorld) >= 1e-5;
    // Legs and torso must see the new pelvis before anything solves against it.
    hips.updateMatrixWorld(true);
  }

  /** Pitch/roll the foot onto the surface so it sits flush on a ramp or stair. */
  _alignFoot(leg, dt, w) {
    // Surface normal expressed in the character's frame, so the split into
    // "pitch about right" and "roll about forward" matches how the body reads.
    _v1.set(leg.nx, leg.ny, leg.nz).applyQuaternion(_q1.copy(_rQuat).invert());
    const maxT = this.feet.maxTilt;
    const pitch = THREE.MathUtils.clamp(Math.atan2(_v1.z, Math.max(1e-4, _v1.y)), -maxT, maxT);
    // No negation. The roll is applied about _rFwd = (0, 0, -1) (characters face
    // -Z per the art spec), and rotating +Y about -Z by a POSITIVE angle tilts the
    // sole toward +X — so atan2(+x, y) is already the correct sign. Negating it
    // tilted the foot AWAY from a laterally sloped surface, doubling the mismatch
    // instead of removing it: measured 0.25 rad -> 0.50 rad on a ramp. Invisible
    // on flat floors, wrong on every stair cheek and toppled prop.
    const roll = THREE.MathUtils.clamp(Math.atan2(_v1.x, Math.max(1e-4, _v1.y)), -maxT, maxT);
    const p = leg.pitchD.to(pitch * w, dt);
    const r = leg.rollD.to(roll * w, dt);
    if (Math.abs(p) < 1e-4 && Math.abs(r) < 1e-4) return;
    _q1.setFromAxisAngle(_rRight, p);
    _q2.setFromAxisAngle(_rFwd, r);
    applyWorldDelta(leg.foot, _q1.multiply(_q2));
  }

  // ------------------------------------------------------------------- look

  _updateLook(dt, weight) {
    if (!this.lookSegments.length) return;
    const L = this.look;
    const head = this.headBone;

    let yaw = 0, pitch = 0, want = 0;
    const t = L.target;
    if (L.enabled && t && weight > 0.001) {
      if (t.isVector3) _v1.copy(t);
      else if (t.isObject3D) _v1.setFromMatrixPosition(t.matrixWorld);
      else if (typeof t.x === 'number') _v1.set(t.x, t.y ?? _rPos.y, t.z);
      else _v1.set(NaN, NaN, NaN);

      // A half-built target ({x,z} with no y, a pooled entity mid-respawn) must
      // not poison the dampers with NaN — once in, a NaN never leaves.
      if (Number.isFinite(_v1.x) && Number.isFinite(_v1.y) && Number.isFinite(_v1.z)) {
        _v2.setFromMatrixPosition(head.matrixWorld);
        _v3.subVectors(_v1, _v2).applyQuaternion(_q1.copy(_rQuat).invert());
        const flat = Math.hypot(_v3.x, _v3.z);
        if (flat > 1e-4 || Math.abs(_v3.y) > 1e-4) {
          // Forward is -Z (art spec), so both terms are negated: a target dead
          // ahead gives atan2(0, +1) = 0 rather than pi.
          const rawYaw = Math.atan2(-_v3.x, -_v3.z);
          const rawPitch = Math.atan2(_v3.y, Math.max(1e-4, flat));
          // Past `giveUp` the target is behind the shoulder. Releasing beats
          // pinning the head at the cone edge staring into a wall.
          if (Math.abs(rawYaw) < L.giveUp) {
            want = 1;
            yaw = THREE.MathUtils.clamp(rawYaw, -L.maxYaw, L.maxYaw);
            pitch = THREE.MathUtils.clamp(rawPitch, -L.maxPitch, L.maxPitch);
          }
        }
      }
    }

    // Weight is damped separately from the angles: acquiring or releasing a
    // target must fade, but must not drag the angle back through zero on the way.
    const w = this._lookWD.to(want * (L.enabled ? weight : 0), dt);
    const y = this._lookYawD.to(yaw, dt) * w;
    const p = this._lookPitchD.to(pitch, dt) * w;
    if (Math.abs(y) < 1e-4 && Math.abs(p) < 1e-4) return;

    // Fractions are applied root-ward first and INHERIT down the chain, so
    // 0.15 + 0.35 + 0.50 lands the head at the full angle while the spine and
    // neck carry their share — a head-only turn reads like an owl.
    for (const seg of this.lookSegments) {
      _q1.setFromAxisAngle(_rUp, y * seg.frac);
      _q2.setFromAxisAngle(_rRight, p * seg.frac);
      applyWorldDelta(seg.bone, _q1.multiply(_q2));
    }
    this._lookApplied = true;
  }

  // ------------------------------------------------------------------ hands

  _updateHands(dt, weight) {
    const H = this.hands;
    for (const arm of this.arms) {
      const live = H.enabled && arm.enabled && arm.target && weight > 0.001;
      const w = arm.wD.to(live ? weight * arm.weight : 0, dt);
      if (w <= 0.02) { arm.primed = false; continue; }
      if (!arm.target) continue;

      _v1.setFromMatrixPosition(arm.target.matrixWorld);
      if (!arm.primed) {
        // First frame on a new weapon: snap, do not sweep the hand across the
        // room from wherever the last grip was.
        arm.posD.snap(_v1.x, _v1.y, _v1.z);
        arm.goalPos.copy(_v1);
        // Freeze the wrist's CURRENT relationship to the grip node. From here
        // the hand rides the weapon's frame, which is exactly what lets one
        // authored hand pose serve every weapon: the weapon's grip node defines
        // the pose, the clip only has to get the arm roughly there.
        arm.target.matrixWorld.decompose(_v2, _q1, _scl);
        arm.hand.matrixWorld.decompose(_v3, _q2, _scl);
        arm.gripOffset.copy(_q1).invert().multiply(_q2);
        arm.primed = true;
      } else {
        arm.posD.to(arm.goalPos, _v1.x, _v1.y, _v1.z, dt);
      }

      const len = chainLength(arm.upper, arm.lower, arm.hand);
      _v2.setFromMatrixPosition(arm.upper.matrixWorld);
      _v3.copy(arm.goalPos);
      clampReach(_v3, _v2.x, _v2.y, _v2.z, len * H.reachMin, len * H.reachMax);
      const gx = _v3.x, gy = _v3.y, gz = _v3.z;   // preBend reuses _v1.._v3
      preBend(arm.upper, arm.lower, arm.hand,
        _rFwd.x * H.poleSign, _rFwd.y * H.poleSign, _rFwd.z * H.poleSign, H.preBend);
      setGoal(arm.goal, gx, gy, gz);
      this._solve(arm.ik, w);

      if (arm.matchRotation > 0.001) this._matchWrist(arm, w * arm.matchRotation);
    }
  }

  /** Rotate the wrist so the held item sits in the grip node's frame. */
  _matchWrist(arm, amount) {
    arm.target.matrixWorld.decompose(_v1, _q1, _scl);
    _q1.multiply(arm.gripOffset);                    // desired hand world rotation
    arm.hand.matrixWorld.decompose(_v2, _q2, _scl);  // current hand world rotation
    _q1.multiply(_q2.invert());                      // world-space delta
    if (amount < 0.999) {
      // Scale the delta by slerping it out of identity. Written as two steps on
      // purpose: slerpQuaternions(a, b) is copy(a).slerp(b), which silently
      // collapses to identity when the destination and `b` are the same object.
      _q2.copy(_IDENT).slerp(_q1, amount);
      applyWorldDelta(arm.hand, _q2);
    } else {
      applyWorldDelta(arm.hand, _q1);
    }
  }

  // ----------------------------------------------------------------- solver

  _solve(ik, weight) {
    if (!this.solver) return;
    // blendFactor < 1 makes updateOne snapshot every link quaternion and slerp
    // back afterwards. Snapping a near-1 weight to exactly 1 skips both loops —
    // free, and it is the common case.
    ik.blendFactor = weight >= 0.999 ? 1 : weight;
    this.solver.updateOne(ik, ik.blendFactor);
    this.stats.solves++;
  }

  // ------------------------------------------------------------------ debug

  /** Red = goals, green = effectors, blue = links. Caller adds it to the scene. */
  createHelper(sphereSize = 0.06) {
    if (!this.solver || this.helper) return this.helper;
    this.helper = this.solver.createHelper(sphereSize);
    return this.helper;
  }

  dispose() {
    this.helper?.dispose();
    this.helper?.removeFromParent();
    this.helper = null;
    this.solver = null;
    this.iks.length = 0;
    this.boneArray.length = 0;
    this._slot.clear();
    this.boneIndex.clear();
    this.guard.bones.length = 0;
    this.guard.anim.length = 0;
    this.guard.written.length = 0;
    for (const arm of this.arms) { arm.target = null; arm.primed = false; }
    this.look.target = null;
    this.available = false;
  }
}

/**
 * Always returns an instance, never null. A rig with no skeleton, no legs and no
 * head yields one whose update() is a single boolean test — callers get to skip
 * the null check, which is the difference between "IK is optional" and "IK is
 * optional at 30 call sites".
 *
 *   const ik = createCharacterIK({ root, bones: parts.bones, world: game.worldBVH });
 *   // ... after updateMixers(dt):
 *   ik.update(dt, { grounded, lookTarget: player.pos });
 */
export function createCharacterIK(opts = {}) {
  return new CharacterIK(opts);
}

export { FOOT_DEFAULTS, HAND_DEFAULTS, LOOK_DEFAULTS };
