// ============ secondary motion: spring bone chains ============
// Ties, ID badges, lanyards, ponytails, coat tails, backpack straps, printer
// cables. This is NOT cloth simulation. It is a chain of spring-damped bones
// with a hard length lock and an angular cone — roughly 95% of the visual payoff
// of cloth for ~2% of the cost, and it cannot explode or invert.
//
// Why an office game cares: an employee who sprints and whose tie swings, then
// stops dead and whose tie keeps going and slaps their chest, reads as ALIVE.
// The clip library does not have to know about it, the artist does not have to
// author it, and gameplay never calls into it.
//
// ---------------------------------------------------------------- the model --
// One particle per bone, holding that bone's TAIL (the position of its child, or
// an extrapolated tip for the last bone). Every frame:
//
//   1. the bone is reset to its authored local rotation, so the "rest tail" is
//      recomputed from the pose the clip actually wants — nothing accumulates
//   2. the particle springs toward that rest tail, in WORLD space
//   3. the particle is projected back onto the sphere of exact bone length
//      (bones do not stretch) and into a cone around the rest direction (bones
//      do not invert)
//   4. the rotation that carries rest-direction onto particle-direction is
//      converted to a local quaternion and slerped in by the current weight
//
// Simulating in WORLD space is the whole trick for inheriting owner motion. The
// target sweeps along with the running character and the particle lags behind
// it; a sudden stop leaves the particle with velocity the target no longer has,
// so it overshoots forward and rings back. No velocity plumbing, no
// acceleration estimation, no special case for dashes or knockback — it falls
// out of the frame of reference for free.
//
// Because the length constraint removes the radial degree of freedom, what is
// left is a driven pendulum: `stiffness` maps to swing frequency (w = sqrt(k))
// INDEPENDENTLY of bone length, and `gravity` shows up as a rest-angle sag
// rather than as stretch — `tan(sag) = gravity / stiffness`, with the bone length
// cancelled out on purpose. That is why a 6cm badge and a 30cm coat tail can
// share a tuning vocabulary, and why `gravity` is an angle-space number rather
// than m/s^2.
//
// All integration is Spring/Spring3 from core/spring.js — which sub-steps at 8ms
// and is stable through a 250ms hitch. This module sub-steps the CONSTRAINTS on
// top of that, because a spring that is stable but unconstrained for a whole
// long frame can still leave one visibly wrong pose.
//
// This module NEVER ticks an AnimationMixer. It runs strictly after the mixer
// (models.js `updateMixers`) and after IK, reading the pose they produced.

import * as THREE from 'three';
import { Spring3, Damper } from '../core/spring.js';
import { normalizeBoneName, canonicalKeyFor } from './skeleton.js';

// ---------------------------------------------------------------- tunables ---

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Per-chain tuning. `damping` is a Spring damping RATIO (spring.js vocabulary):
 * 1 = critical, below that it rings, which for secondary motion is the point.
 * `maxAngle` is RADIANS of deviation from the rest direction, per joint.
 *
 * `gravity` is NOT m/s^2. Because the length constraint removes the radial degree
 * of freedom, the only thing a downward pull can do is tilt the bone, and the
 * steady-state tilt is `tan(sag) = gravity / stiffness` — a pure angle, with the
 * bone length divided out (see the `invK` line in _solveChain). Read the number as
 * "sag units": at the default 50/160 a chain hangs ~17 deg off its authored
 * direction. Feeding real m/s^2 here made short chains (a 3cm badge) sag ~15x
 * harder than long ones and park permanently against their cone cap.
 */
export const CHAIN_DEFAULTS = Object.freeze({
  stiffness: 160,       // w = sqrt(k) rad/s -> 12.6 rad/s ~ 2 Hz
  damping: 0.40,        // rings ~2 times before settling
  gravity: 50,          // sag units: tan(rest sag) = gravity / stiffness
  maxAngle: 55 * DEG,   // cone half-angle around the authored direction
  inertia: 1,           // 1 = full owner-motion inheritance (max swing),
                        // 0 = carried rigidly, only bone animation moves it
  tipStiffness: 0.6,    // stiffness multiplier at the LAST joint, lerped along
  tipAngle: 1.4,        // maxAngle multiplier at the last joint — tips are freer
  tipLength: 0,         // metres for the virtual tail of a childless bone;
                        // 0 = derive it from the bone's own length
  depth: 6,             // max bones taken when walking down from a chain root
  enabled: true,
});

/**
 * Named presets. Auto-discovery picks one by bone name; explicit chains may name
 * one with `preset`. Numbers are eyeballed against 1 unit = 1 metre and the
 * 21-bone spec skeleton, and are meant to be edited — this object is the tuning
 * surface, not the code below it.
 */
export const CHAIN_PRESETS = Object.freeze({
  // A necktie is light, long and hinged at one point: the loosest thing on the
  // character and the one players actually notice.
  tie: { stiffness: 120, damping: 0.30, maxAngle: 65 * DEG, tipStiffness: 0.55 },
  // Clipped at the pocket, short, mostly rotates in place.
  badge: { stiffness: 260, damping: 0.45, maxAngle: 45 * DEG, tipStiffness: 0.8 },
  lanyard: { stiffness: 150, damping: 0.35, maxAngle: 55 * DEG, tipStiffness: 0.6 },
  // Reduced gravity: hair has body and does not hang like a wet rope.
  hair: { stiffness: 170, damping: 0.45, gravity: 30, maxAngle: 50 * DEG },
  ponytail: { stiffness: 140, damping: 0.38, gravity: 40, maxAngle: 70 * DEG, tipAngle: 1.6 },
  coat: { stiffness: 90, damping: 0.42, maxAngle: 55 * DEG, tipStiffness: 0.7 },
  // A loaded strap barely moves; over-swinging one reads as a broken rig.
  strap: { stiffness: 220, damping: 0.55, maxAngle: 30 * DEG, tipStiffness: 0.85 },
  cable: { stiffness: 80, damping: 0.30, maxAngle: 80 * DEG, tipAngle: 1.2 },
  generic: {},
});

/**
 * Bone-name conventions that get spring motion for free. Tested against the
 * name with separators stripped (`Tie_01` -> `tie01`), first match wins.
 *
 * `dyn`/`spring`/`jiggle`/`wobble`/`sec` prefixes are the universal artist escape
 * hatch: any bone can opt in without this table growing. Keep the comment and the
 * regex in step — an artist who follows a prefix that is only documented gets no
 * spring motion and no warning anywhere.
 */
export const CHAIN_PATTERNS = Object.freeze([
  { re: /^(dyn|spring|jiggle|wobble|sec)/, preset: 'generic' },
  { re: /necktie|(^|[^a-z])tie\d*$|tieknot|tieend/, preset: 'tie' },
  { re: /badge|idcard|nametag|(^|[^a-z])tag\d*$/, preset: 'badge' },
  { re: /lanyard|neckstrap/, preset: 'lanyard' },
  { re: /ponytail|pigtail|braid|bun\d*$/, preset: 'ponytail' },
  // `[^c]hair` because this game is full of office furniture and `chair` is not
  // a hair strand.
  { re: /(^|[^c])hair|fringe|bang\d*$/, preset: 'hair' },
  { re: /coat|jacket|skirt|cape|scarf|apron|tassel|flap|tail\d*$/, preset: 'coat' },
  { re: /strap|backpack|satchel|pouch|holster|belt/, preset: 'strap' },
  { re: /cable|cord|wire|rope|chainlink|antenna/, preset: 'cable' },
]);

export const SECONDARY_DEFAULTS = Object.freeze({
  auto: true,
  maxChains: 8,         // a bound, not a target: a hair rig with 40 strands must
                        // not silently become 40 chains on 60 enemies
  maxDepth: 6,
  disableTier: 2,       // ai/lod.js tier 2 is 'far' (75m). Nothing past mid-range
                        // can resolve a tie swinging; stop paying for it.
  fadeTime: 0.18,       // weight Damper — fading out beats snapping to rest
  teleport: 2.5,        // metres of owner movement in one update that means
                        // "respawn / floor change", not "sprint"
});

// Longest slice of real time we will ever simulate in one call. A 400ms stall is
// written off, not replayed: replaying it makes every tie in the level detonate
// at once, which players read as the game breaking on the hitch it just had.
const MAX_SIM = 0.1;
// 0.008 exactly, which is spring.js's own internal sub-step threshold
// (`ceil(dt / 0.008)`). At 1/120 = 0.008333 every outer sub-step sat just above
// that line and bought a SECOND inner Euler step it did not need — double the
// integration work for the same constraint cadence. Matching the threshold makes
// one outer step cost exactly one inner step.
const TARGET_STEP = 1 / 125;
const MAX_SUBSTEPS = 8;

// ------------------------------------------------------- module-scope temps ---
// Hoisted per the no-per-frame-allocation rule. Disjoint pools so a helper can
// never clobber a caller's in-flight vector:
//   _j*   joint frame setup, written once per joint per frame
//   _c*   owned exclusively by _constrain()
//   _q*   owned exclusively by _writeBone()
//   _o*   owner-motion bookkeeping

const _jHead = new THREE.Vector3();
const _jTail = new THREE.Vector3();

const _cDir = new THREE.Vector3();
const _cRest = new THREE.Vector3();
const _cq1 = new THREE.Quaternion();
const _cq2 = new THREE.Quaternion();

const _qPos = new THREE.Vector3();
const _qParent = new THREE.Quaternion();
const _qScl = new THREE.Vector3();
const _qDelta = new THREE.Quaternion();
const _qLocal = new THREE.Quaternion();
const _qDir = new THREE.Vector3();
const _qRest = new THREE.Vector3();

const _oPos = new THREE.Vector3();
const _mInv = new THREE.Matrix4();
const _tmp = new THREE.Vector3();

// update() runs per character per frame and the documented call is `update(dt)`
// with no options. A `= {}` default parameter is evaluated on EVERY such call, so
// that signature alone allocates 60 objects/second/character. Share one frozen
// instance instead — a module-scope reference in a default expression is free.
const NO_OPTS = Object.freeze({});

// ------------------------------------------------------------- name matching ---
// skeleton.js owns the one normaliser for the whole animation stack, and it is the
// strong one: it strips `mixamorig` followed by ANY separator (GLTFLoader removes
// ':' but not '_' or '|'), peels DEF-/rig-/Armature- style namespaces, and does it
// repeatedly so stacked prefixes compose. A weaker local copy let spellings like
// `mixamorig_LeftForeArm` normalize to `mixamorigleftforearm`, miss the spec-bone
// blocklist below, and leave an arm eligible to be handed to a spring.

/** `Tie_L.001` -> `tiel001`. Separator-insensitive so exporters stop mattering. */
export const normalizeName = normalizeBoneName;

/**
 * @returns {string|null} preset name, or null when the bone is not a chain root.
 *
 * The canonical skeleton (docs/CHARACTER_ART_SPEC.md §3-4) is checked FIRST and is
 * never claimable: a pattern that accidentally matched `LeftForeArm` would hand the
 * arm to a spring and the character would flail. canonicalKeyFor() knows every
 * alias spelling skeleton.js supports — Unreal, Unity, Rigify, Biped — so the
 * patterns above can stay liberal. Sockets are attachment points, not links.
 */
export function matchChainPattern(name, patterns = CHAIN_PATTERNS) {
  const key = normalizeName(name);
  if (!key || key.startsWith('socket') || canonicalKeyFor(name)) return null;
  for (const p of patterns) {
    if (p.re.test(key)) return p.preset;
  }
  return null;
}

/** Accepts models.js's `parts.bones` Map, a plain object, or any Object3D root. */
function buildBoneIndex(src) {
  const map = new Map();
  if (!src) return map;
  if (src instanceof Map) {
    for (const [k, v] of src) if (v) map.set(String(k).toLowerCase(), v);
    return map;
  }
  if (src.isObject3D) {
    // Sockets and accessory pivots are exported as empty Object3Ds by some
    // pipelines and as Bones by others; index both or half the rigs resolve.
    src.traverse((o) => {
      if (o.isBone || o.type === 'Object3D') map.set(normalizeName(o.name), o);
    });
    return map;
  }
  for (const k of Object.keys(src)) if (src[k]) map.set(normalizeName(k), src[k]);
  return map;
}

function resolveBone(ref, index) {
  if (!ref) return null;
  if (ref.isObject3D) return ref;
  return index.get(normalizeName(ref)) || index.get(String(ref).toLowerCase()) || null;
}

/**
 * Children that can carry a chain. Meshes are geometry, not links; sockets are
 * attachment points authored at zero length, and following one would produce a
 * degenerate bone direction and a NaN quaternion two lines later.
 */
function chainChildren(node, out) {
  out.length = 0;
  for (const c of node.children) {
    if (!c || c.isMesh || c.isSkinnedMesh) continue;
    if (!c.isBone && c.type !== 'Object3D') continue;
    if (normalizeName(c.name).startsWith('socket')) continue;
    out.push(c);
  }
  return out;
}

const _kids = [];

// ------------------------------------------------------------- discovery ---

/**
 * Find spring chains by bone-name convention. Pure: it allocates and returns
 * plain specs, touches no transforms, and is the piece worth unit-testing.
 *
 * A matched bone becomes a chain ROOT only if no ancestor also matched, so a
 * `tie_01 -> tie_02 -> tie_03` strand produces ONE chain rather than three
 * overlapping ones fighting over the same bones.
 *
 * @param {Map|Object|THREE.Object3D} source
 * @param {{maxChains?: number, maxDepth?: number, patterns?: Array, exclude?: Set}} [opts]
 * @returns {Array<{root: THREE.Object3D, bones: Array<THREE.Object3D>, preset: string, name: string}>}
 */
export function discoverChains(source, opts = {}) {
  const {
    maxChains = SECONDARY_DEFAULTS.maxChains,
    maxDepth = SECONDARY_DEFAULTS.maxDepth,
    patterns = CHAIN_PATTERNS,
    exclude = null,
  } = opts;

  const index = buildBoneIndex(source);
  const hits = new Map();   // bone -> preset
  for (const bone of index.values()) {
    if (!bone || !bone.isObject3D) continue;
    if (exclude?.has(bone)) continue;
    const preset = matchChainPattern(bone.name, patterns);
    if (preset) hits.set(bone, preset);
  }
  if (!hits.size) return [];

  const roots = [];
  for (const [bone, preset] of hits) {
    let anc = bone.parent, owned = false;
    while (anc) {
      if (hits.has(anc)) { owned = true; break; }
      anc = anc.parent;
    }
    if (!owned) roots.push({ bone, preset });
  }
  // Stable output regardless of Map insertion order, which depends on traversal
  // order, which depends on the exporter. A test that asserts chain order should
  // not fail because Blender renamed a collection.
  roots.sort((a, b) => (a.bone.name < b.bone.name ? -1 : a.bone.name > b.bone.name ? 1 : 0));

  const specs = [];
  for (const r of roots) {
    if (specs.length >= maxChains) break;
    expandChain(r.bone, r.preset, maxDepth, maxChains, specs);
  }
  return specs;
}

/**
 * Walk down from `node`, extending while there is exactly one usable child. At a
 * fork the chain ENDS and one sibling chain is spawned per branch.
 *
 * The disjointness matters more than it looks: two chains sharing a bone would
 * both write its local quaternion every frame, and the second write would erase
 * the first with no error and no visual clue beyond "the hair is stiff".
 */
function expandChain(node, preset, maxDepth, maxChains, out) {
  if (out.length >= maxChains || maxDepth < 1) return;
  const bones = [node];
  let cur = node;
  while (bones.length < maxDepth) {
    const kids = chainChildren(cur, _kids);
    if (kids.length !== 1) break;
    cur = kids[0];
    bones.push(cur);
  }

  const kids = chainChildren(cur, _kids);
  const forked = kids.length > 1;

  // A bone named `Hair` that immediately forks into four strands is a CONTAINER,
  // not a link: it has no direction of its own, so its tail would be whichever
  // strand happened to be longest, and rotating it would swing the entire scalp.
  // Simulate the strands and leave the container to the head bone. A bone that
  // ends alone because it is a LEAF (an ID badge) is a real one-bone chain and
  // is kept — the distinction is whether the bone contributed a link.
  if (!(forked && bones.length === 1)) {
    out.push({ root: node, bones, preset, name: node.name });
  }

  // Only fork when we stopped ON a fork; stopping on maxDepth means the artist
  // authored a longer strand than we are willing to simulate, and continuing it
  // as a "branch" would quietly reinstate the cost the cap exists to bound.
  // A dropped container consumed no budget, so its strands get the full depth.
  const rem = forked && bones.length === 1 ? maxDepth : maxDepth - bones.length;
  if (!forked || rem < 1) return;
  // chainChildren reuses one array; copy before recursing into it.
  const branches = kids.slice();
  for (const b of branches) {
    if (out.length >= maxChains) return;
    expandChain(b, preset, rem, maxChains, out);
  }
}

// ------------------------------------------------------------- constraints ---

/**
 * Write a constrained position back into the springs, killing only the velocity
 * still driving INTO the constraint.
 *
 * Clamping position while leaving velocity alone is the classic way to make a
 * constrained spring pump energy: every step the solver pushes out, the clamp
 * pushes back, and the pair acts as a motor. Removing the inward normal
 * component (and only that) leaves the tangential slide intact, so the tip keeps
 * sweeping along the cone instead of sticking to its edge.
 */
function reproject(s, x, y, z) {
  const cx = x - s.x.value, cy = y - s.y.value, cz = z - s.z.value;
  const l2 = cx * cx + cy * cy + cz * cz;
  if (l2 > 1e-12) {
    const inv = 1 / Math.sqrt(l2);
    const nx = cx * inv, ny = cy * inv, nz = cz * inv;
    const vn = s.x.vel * nx + s.y.vel * ny + s.z.vel * nz;
    if (vn < 0) { s.x.vel -= vn * nx; s.y.vel -= vn * ny; s.z.vel -= vn * nz; }
  }
  s.x.value = x; s.y.value = y; s.z.value = z;
}

/** Local world matrix compose. `updateMatrixWorld(true)` would recurse into every
 *  descendant of the chain root once per joint — O(n^2) for zero benefit, since
 *  we walk the chain top-down and touch each bone ourselves. */
function composeWorld(bone) {
  bone.updateMatrix();
  if (bone.parent) bone.matrixWorld.multiplyMatrices(bone.parent.matrixWorld, bone.matrix);
  else bone.matrixWorld.copy(bone.matrix);
  bone.matrixWorldNeedsUpdate = false;
}

// ------------------------------------------------------------------ class ---

export class SecondaryMotion {
  /**
   * @param {{
   *   root?: THREE.Object3D,               outer wrapper from makePerson()
   *   bones?: Map|Object|THREE.Object3D,   models.js `parts.bones`, or anything to index
   *   owner?: THREE.Object3D,              world-motion source; defaults to root
   *   chains?: Array<object>,              explicit specs — see addChain()
   *   auto?: boolean,                      also discover chains by name convention
   *   maxChains?: number, maxDepth?: number, disableTier?: number,
   *   fadeTime?: number, teleport?: number,
   *   defaults?: object,                   CHAIN_DEFAULTS overrides for every chain
   * }} opts
   */
  constructor(opts = {}) {
    const {
      root = null, bones = null, owner = null, chains = null,
      auto = SECONDARY_DEFAULTS.auto,
      maxChains = SECONDARY_DEFAULTS.maxChains,
      maxDepth = SECONDARY_DEFAULTS.maxDepth,
      disableTier = SECONDARY_DEFAULTS.disableTier,
      fadeTime = SECONDARY_DEFAULTS.fadeTime,
      teleport = SECONDARY_DEFAULTS.teleport,
      defaults = null,
    } = opts;

    this.root = root || (bones && bones.isObject3D ? bones : null);
    this.owner = owner || this.root;
    this.index = buildBoneIndex(bones || this.root);
    this.defaults = { ...CHAIN_DEFAULTS, ...(defaults || {}) };
    this.maxChains = maxChains;
    this.maxDepth = maxDepth;
    this.disableTier = disableTier;
    this.teleport = teleport;

    this.enabled = true;
    this.weight = 1;
    this.lodTier = 0;
    this.wind = new THREE.Vector3();

    /** @type {Array<object>} */
    this.chains = [];
    /** Every bone claimed by a chain. A bone may belong to exactly one. */
    this._claimed = new Set();

    this._wD = new Damper(1, fadeTime);
    this._primed = false;      // false = snap to rest on the next solve
    this._idle = false;        // faded out AND already restored: skip everything
    this._ownerValid = false;
    this._ox = 0; this._oy = 0; this._oz = 0;

    this.stats = { chains: 0, joints: 0, simulated: 0, steps: 0 };

    if (Array.isArray(chains)) {
      for (const spec of chains) this.addChain(spec);
    }
    if (auto) {
      for (const spec of discoverChains(this.index, {
        maxChains: this.maxChains - this.chains.length,
        maxDepth: this.maxDepth,
        exclude: this._claimed,
      })) {
        this.addChain(spec);
      }
    }

    /** False when nothing resolved: update() then costs one boolean test. */
    this.available = this.chains.length > 0;
  }

  // ------------------------------------------------------------ chain setup

  /**
   * @param {{
   *   bones?: Array<string|THREE.Object3D>,  explicit list, root-first — wins over `root`
   *   root?: string|THREE.Object3D,          chain root; descendants are walked
   *   depth?: number, preset?: string, enabled?: boolean,
   *   stiffness?: number, damping?: number, gravity?: number, maxAngle?: number,
   *   inertia?: number, tipStiffness?: number, tipAngle?: number, tipLength?: number,
   * }} spec
   * @returns {object|null} the chain, or null if nothing usable resolved
   *
   * Chains solve in the order they were added. Auto-discovery never produces
   * nested chains, but if you hand-author one whose root is a DESCENDANT of
   * another chain's bone, add it second — otherwise it solves against its
   * parent's pose from the previous frame and lags by one frame.
   */
  addChain(spec = {}) {
    if (this.chains.length >= this.maxChains) return null;
    const cfg = { ...this.defaults, ...(CHAIN_PRESETS[spec.preset] || null), ...spec };

    const list = [];
    if (Array.isArray(spec.bones) && spec.bones.length) {
      for (const ref of spec.bones) {
        const b = resolveBone(ref, this.index);
        if (b) list.push(b);
      }
    } else {
      const rootBone = resolveBone(spec.root, this.index);
      if (rootBone) {
        const depth = Math.max(1, Math.min(cfg.depth ?? this.maxDepth, this.maxDepth));
        list.push(rootBone);
        let cur = rootBone;
        while (list.length < depth) {
          const kids = chainChildren(cur, _kids);
          if (kids.length !== 1) break;
          cur = kids[0];
          list.push(cur);
        }
      }
    }

    // A bone driven by two chains gets written twice per frame and the second
    // write wins silently. TRUNCATE at the first bone somebody else owns rather
    // than filtering it out — a chain with a hole in it still solves, but its
    // tip falloff and its cone limits then describe a shape nobody authored.
    let n = 0;
    while (n < list.length) {
      const b = list[n];
      if (!b || !b.isObject3D || this._claimed.has(b)) break;
      n++;
    }
    list.length = n;
    if (!n) return null;

    const joints = [];
    for (let i = 0; i < n; i++) {
      const bone = list[i];
      // Falloff toward the tip: stiff at the anchor, loose at the end. With one
      // bone there is no gradient, so t=0 and the chain keeps its base tuning.
      const t = n > 1 ? i / (n - 1) : 0;
      const stiffness = Math.max(1, cfg.stiffness * lerp(1, cfg.tipStiffness, t));
      const maxAngle = clamp(cfg.maxAngle * lerp(1, cfg.tipAngle, t), 0.02, Math.PI * 0.95);
      joints.push({
        bone,
        spring: new Spring3({ stiffness, damping: clamp(cfg.damping, 0.02, 4) }),
        stiffness,
        maxAngle,
        cosMax: Math.cos(maxAngle),
        // Authored local rotation. Re-captured whenever something else (the
        // mixer, IK) writes this bone — see step 1 of _solveChain().
        rest: bone.quaternion.clone(),
        written: new THREE.Quaternion(),
        hasWritten: false,
        tailLocal: null,        // resolved on first solve, when matrices are live
        active: false,
        // Priming is PER JOINT, not per system: addChain() is public and chains
        // added after the first update() would otherwise never get their snap,
        // starting their first solve with the tail at the world origin.
        primed: false,
        // per-frame scratch, kept as plain numbers so the solve allocates nothing
        hx: 0, hy: 0, hz: 0,
        rdx: 0, rdy: 1, rdz: 0,
        len: 0, tx: 0, ty: 0, tz: 0,
      });
      this._claimed.add(bone);
    }

    const chain = {
      name: spec.name || list[0].name || 'chain',
      preset: spec.preset || 'generic',
      cfg,
      joints,
      bones: list,
      enabled: cfg.enabled !== false,
    };
    this.chains.push(chain);
    this.stats.chains = this.chains.length;
    this.stats.joints += joints.length;
    this.available = true;
    return chain;
  }

  // ------------------------------------------------------------------ drive

  /** LOD tier from ai/lod.js. At or beyond `disableTier` the chains fade to rest. */
  setLOD(tier) { this.lodTier = tier | 0; return this; }

  setEnabled(v) {
    this.enabled = Boolean(v);
    if (this.enabled) this._idle = false;   // re-arm; the next solve re-primes
    return this;
  }

  /**
   * Constant world-space push on top of gravity — an AC vent, a fan. Same units as
   * `gravity`: a component of magnitude `stiffness` tilts a chain 45 deg toward it,
   * independently of bone length.
   */
  setWind(x, y, z) { this.wind.set(x, y, z); return this; }

  /**
   * A world-space velocity kick. Scaled along the chain so the tip whips and the
   * anchor barely moves, which is what a hit or a hard dash actually looks like.
   */
  impulse(x, y, z, strength = 1) {
    for (const c of this.chains) {
      const n = c.joints.length;
      for (let i = 0; i < n; i++) {
        const k = strength * (n > 1 ? 0.35 + 0.65 * (i / (n - 1)) : 1);
        c.joints[i].spring.impulse(x * k, y * k, z * k);
      }
    }
    return this;
  }

  /** Drop all simulation state; the next solve snaps every tip onto its rest. */
  reset() {
    this._primed = false;
    this._ownerValid = false;
    return this;
  }

  /**
   * @param {number} dt seconds (accumulated dt is fine — see the sub-stepping)
   * @param {{weight?: number, lod?: number, tier?: number, skipMatrixUpdate?: boolean}} [opts]
   */
  update(dt, opts = NO_OPTS) {
    this.stats.simulated = 0;
    this.stats.steps = 0;
    if (!this.available || !(dt > 0)) return;

    const tier = opts.lod ?? opts.tier ?? this.lodTier;
    const want = this.enabled && tier < this.disableTier
      ? clamp(opts.weight ?? this.weight, 0, 1)
      : 0;
    // A Damper only ever asymptotes. Snapping the last thousandth is what makes
    // "faded out" mean the EXACT authored pose rather than a pose that is 0.1%
    // wrong forever — which is the difference between a clean restore and a
    // chain that can never be verified as off.
    let w = this._wD.to(want, dt);
    if (w < 1e-3) w = 0;
    else if (w > 0.999) w = 1;

    // Fully faded AND the rest pose has already been written back. Nothing else
    // writes these bones (no clip animates a tie), so one restoring pass at w=0
    // is enough and every frame after it is free.
    // The owner keeps moving while we are off, so the delta across a fade-out is a
    // fake one-frame teleport that would launch every chain on re-entry. What
    // actually protects against that is `_primed`, cleared by `this._primed =
    // !this._idle` at the bottom of this method: the owner block below refuses to
    // trust a carry delta unless the springs were running last frame, and the
    // solver re-snaps every joint onto its rest tail. Do NOT "fix" this by
    // clearing `_ownerValid` here — the owner block re-sets it to true nine lines
    // later in the same call, so that assignment was never observable.
    if (w === 0) {
      if (this._idle) return;
      this._idle = true;
    } else {
      this._idle = false;
    }

    // The mixer wrote LOCAL transforms; everything below works in world space.
    // updateWorldMatrix(parents, children) is the surgical form — updateMatrixWorld()
    // would not refresh our ancestors, and calling it on the scene from inside a
    // per-character update is O(scene).
    if (!opts.skipMatrixUpdate && this.root) this.root.updateWorldMatrix(true, true);

    // ---- owner motion -----------------------------------------------------
    let carryX = 0, carryY = 0, carryZ = 0;
    if (this.owner) {
      _oPos.setFromMatrixPosition(this.owner.matrixWorld);
      // `_primed` as well as `_ownerValid`: the stored position is only a valid
      // baseline if the springs were actually simulating against it last frame.
      // After a fade-out, a reset() or a teleport it is stale by an arbitrary
      // amount, and the joints are about to be re-snapped anyway.
      if (this._ownerValid && this._primed) {
        carryX = _oPos.x - this._ox; carryY = _oPos.y - this._oy; carryZ = _oPos.z - this._oz;
        // A respawn, a floor change or a teleport moves the root further in one
        // frame than any sprint can. Without this the whole rig streams across
        // the level for a second, trailing a tie through three rooms.
        const d2 = carryX * carryX + carryY * carryY + carryZ * carryZ;
        if (d2 > this.teleport * this.teleport) { this._primed = false; carryX = carryY = carryZ = 0; }
      }
      this._ox = _oPos.x; this._oy = _oPos.y; this._oz = _oPos.z;
      this._ownerValid = true;
    }

    // ---- sub-stepping -----------------------------------------------------
    // Spring already sub-steps internally, but the length/cone constraints do
    // not: a single 250ms constraint pass lets a tip travel a long way through
    // the cone wall before it is caught. Step both together.
    const sim = Math.min(dt, MAX_SIM);
    const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(sim / TARGET_STEP)));
    const h = sim / steps;
    this.stats.steps = steps;

    for (const chain of this.chains) {
      if (!chain.enabled) continue;
      this._solveChain(chain, h, steps, w, carryX, carryY, carryZ);
    }
    // Going idle disarms the springs so the frame we come back on snaps them
    // onto the rest pose instead of releasing a second of stored swing.
    this._primed = !this._idle;
  }

  // ------------------------------------------------------------------ solve

  _solveChain(chain, h, steps, w, carryX, carryY, carryZ) {
    const inert = 1 - clamp(chain.cfg.inertia ?? 1, 0, 1);
    const gy = -(chain.cfg.gravity ?? 0);
    const wind = this.wind;

    for (const j of chain.joints) {
      const bone = j.bone;

      // ---- 1. authored rest ------------------------------------------------
      // If something else wrote this bone since our last write, THAT is the
      // authored pose and we must spring around it (a coat bone that IS in the
      // walk clip). If the value is bit-identical to what we wrote, nothing else
      // owns it and our stored rest is the truth (a tie no clip touches).
      // Getting this wrong one way ignores the animation; the other way lets our
      // own output feed back and the chain slowly curls into a spiral.
      const q = bone.quaternion;
      if (!j.hasWritten || q.x !== j.written.x || q.y !== j.written.y
        || q.z !== j.written.z || q.w !== j.written.w) {
        j.rest.copy(q);
      }
      bone.quaternion.copy(j.rest);
      composeWorld(bone);

      // ---- 2. rest tail ----------------------------------------------------
      if (!j.tailLocal && !this._resolveTail(j, chain)) { j.active = false; continue; }
      _jHead.setFromMatrixPosition(bone.matrixWorld);
      _jTail.copy(j.tailLocal).applyMatrix4(bone.matrixWorld);

      const dx = _jTail.x - _jHead.x, dy = _jTail.y - _jHead.y, dz = _jTail.z - _jHead.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // Zero-length in WORLD space: a collapsed bone, or a root scaled to 0 by a
      // death/shrink effect. There is no direction to rotate onto.
      if (!(len > 1e-5)) { j.active = false; continue; }

      const inv = 1 / len;
      j.hx = _jHead.x; j.hy = _jHead.y; j.hz = _jHead.z;
      j.rdx = dx * inv; j.rdy = dy * inv; j.rdz = dz * inv;
      j.len = len;

      // Gravity and wind enter as a TARGET offset, not as a force added to the
      // integrator. For a linear spring the two are identical by superposition
      // (equilibrium sits at a/k), and this way core/spring.js stays the only
      // integrator in the codebase.
      //
      // The offset is scaled by the BONE LENGTH, which is what makes the header's
      // "a 6cm badge and a 30cm coat tail share a tuning vocabulary" true for
      // gravity as well as for stiffness. The length constraint two lines down
      // converts the offset straight into an angle, tan(sag) = offset / len, so an
      // absolute offset of g/k sagged as 1/len: measured on a horizontal 3-bone
      // chain, `coat` at 0.20 m settled at 28.6 deg but at 0.05 m settled at
      // 55.0 deg — EXACTLY its cone cap, i.e. pinned against the wall with no
      // swing headroom left in the gravity direction, which is how the short
      // `badge` preset rendered as a static 45-deg droop that never moved. With
      // the length in the numerator it cancels and tan(sag) = gravity / stiffness
      // for every chain, whatever its size. See CHAIN_DEFAULTS: `gravity` is
      // therefore a sag number, not m/s^2, and `wind` is in the same units.
      const invK = j.len / j.stiffness;
      j.tx = _jTail.x + wind.x * invK;
      j.ty = _jTail.y + (gy + wind.y) * invK;
      j.tz = _jTail.z + wind.z * invK;

      const s = j.spring;
      // ---- 3. prime / sanity ----------------------------------------------
      // `!j.primed` as well as `!this._primed`: a Spring3 initialises to (0,0,0),
      // which is the world ORIGIN and is perfectly finite, so a joint added by a
      // late addChain() would sail past the NaN rescue below and solve its first
      // frame against a direction pointing at the origin — measured as a 76 deg
      // first-frame deviation on a 2-bone cable, hard against its 80 deg cap,
      // followed by a half-second whip back. `_primed` stays as the system-wide
      // override so reset() and the fade-out path still re-snap everything.
      // NaN can only arrive from outside (a NaN owner transform, a degenerate
      // skeleton), but once in the spring it is permanent and the mesh vanishes.
      if (!this._primed || !j.primed || !Number.isFinite(s.x.value + s.y.value + s.z.value)) {
        s.snap(_jTail.x, _jTail.y, _jTail.z);
        j.primed = true;
      } else if (inert > 0) {
        // Carry the particle partway with the owner. inertia=1 leaves it fully
        // behind (world-space lag = maximum swing); inertia=0 drags it rigidly
        // so only bone animation can move it — a badge bolted to a pocket.
        s.x.value += carryX * inert;
        s.y.value += carryY * inert;
        s.z.value += carryZ * inert;
      }

      // ---- 4. integrate + constrain ---------------------------------------
      for (let k = 0; k < steps; k++) {
        s.update(h, j.tx, j.ty, j.tz);
        this._constrain(j);
      }

      // ---- 5. back onto the bone -------------------------------------------
      this._writeBone(j, w);
      composeWorld(bone);   // the next joint down solves against this pose
      j.active = true;
      this.stats.simulated++;
    }
  }

  /**
   * Project the particle onto the sphere of exact bone length, then into the
   * cone around the authored direction. Both in one write: the final position is
   * always head + clampedDirection * length.
   *
   * The length lock is what makes this a BONE chain and not a blob — bones do
   * not stretch, and a stretched one tears the skinned mesh open at the joint.
   * The cone is what makes it unable to invert: without it a fast enough stop
   * flips the tie through the chest and it never comes back.
   */
  _constrain(j) {
    const s = j.spring;
    _cDir.set(s.x.value - j.hx, s.y.value - j.hy, s.z.value - j.hz);
    _cRest.set(j.rdx, j.rdy, j.rdz);
    const d = _cDir.length();
    // Collapsed exactly onto the pivot: no direction survives, so restart from
    // rest. setFromUnitVectors on a zero vector yields a NaN quaternion.
    if (d < 1e-6) _cDir.copy(_cRest);
    else _cDir.multiplyScalar(1 / d);

    const cos = clamp(_cDir.dot(_cRest), -1, 1);
    if (cos < j.cosMax) {
      const ang = Math.acos(cos);
      // Rotate REST toward the violating direction by exactly maxAngle, rather
      // than clamping components: this preserves the swing plane, so a tie that
      // is trying to go over the shoulder stops at the cone edge on that side
      // instead of snapping to some axis-aligned compromise.
      _cq1.setFromUnitVectors(_cRest, _cDir);
      _cq2.identity().slerp(_cq1, j.maxAngle / ang);
      _cDir.copy(_cRest).applyQuaternion(_cq2);
    }
    reproject(s, j.hx + _cDir.x * j.len, j.hy + _cDir.y * j.len, j.hz + _cDir.z * j.len);
  }

  /**
   * Convert "the tail is here instead of there" into a local quaternion.
   *
   * local = P^-1 * D * P * rest, where D is the world-space rotation carrying the
   * rest direction onto the simulated one and P is the parent's world rotation.
   * Everything is rebuilt from `rest` every frame, so switching this module off
   * — or fading it to zero — restores the authored pose exactly, with no drift
   * to unwind.
   */
  _writeBone(j, w) {
    const bone = j.bone;
    const s = j.spring;
    _qDir.set(s.x.value - j.hx, s.y.value - j.hy, s.z.value - j.hz);
    const d = _qDir.length();
    if (d < 1e-6) { bone.quaternion.copy(j.rest); j.written.copy(j.rest); j.hasWritten = true; return; }
    _qDir.multiplyScalar(1 / d);
    _qRest.set(j.rdx, j.rdy, j.rdz);
    _qDelta.setFromUnitVectors(_qRest, _qDir);

    if (bone.parent) {
      // decompose (not setFromRotationMatrix) so a scaled armature does not
      // shear the extracted rotation. The art spec forbids non-uniform scale;
      // the failure there is a slightly wrong angle, not a throw.
      bone.parent.matrixWorld.decompose(_qPos, _qParent, _qScl);
      _qLocal.copy(_qParent).invert().multiply(_qDelta).multiply(_qParent).multiply(j.rest);
    } else {
      _qLocal.copy(_qDelta).multiply(j.rest);
    }
    // Weight is a slerp FROM the authored pose, so w=0 is exactly the clip and
    // the LOD fade needs no separate restore path.
    bone.quaternion.copy(j.rest).slerp(_qLocal, w);
    j.written.copy(bone.quaternion);
    j.hasWritten = true;
  }

  /**
   * Where this bone's tail sits in its own local space. Deferred to the first
   * solve because it needs live world matrices, which do not exist yet while
   * makePerson() is still assembling the rig.
   */
  _resolveTail(j, chain) {
    const bone = j.bone;
    // Prefer a real child — the longest one, because socket-style zero-length
    // children exist on plenty of rigs and would give a degenerate direction.
    let best = null, bestLen = 1e-4;
    const kids = chainChildren(bone, _kids);
    for (const c of kids) {
      const l = c.position.length();
      if (l > bestLen) { bestLen = l; best = c; }
    }
    if (best) {
      j.tailLocal = best.position.clone();
      return true;
    }

    // Childless tip: extend along the direction the bone itself points, i.e. the
    // parent->bone offset carried forward. That is the only defensible guess and
    // it matches how the strand was modelled.
    const want = chain.cfg.tipLength;
    if (bone.parent) {
      _jHead.setFromMatrixPosition(bone.matrixWorld);        // this bone, world
      _tmp.setFromMatrixPosition(bone.parent.matrixWorld);   // its parent, world
      _jTail.copy(_jHead).sub(_tmp);
      const l = _jTail.length();
      if (l > 1e-5) {
        // Default to 60% of the previous bone's length: long enough to swing
        // visibly, short enough that it cannot outreach the strand it extends.
        const tip = want > 0 ? want : clamp(l * 0.6, 0.02, 0.30);
        _jTail.multiplyScalar(tip / l).add(_jHead);          // world-space tail
        _mInv.copy(bone.matrixWorld).invert();               // -> bone local
        j.tailLocal = new THREE.Vector3().copy(_jTail).applyMatrix4(_mInv);
        if (j.tailLocal.lengthSq() > 1e-10) return true;
      }
    }
    // No parent, or a zero-length parent offset. +Y is the Mixamo bone axis
    // (spec §3), so it is the least-wrong fallback; a chain that lands here
    // still swings, just about an axis the artist did not choose.
    j.tailLocal = new THREE.Vector3(0, want > 0 ? want : 0.08, 0);
    return true;
  }

  // ---------------------------------------------------------------- teardown

  /** Restore every authored pose and release the bones. Safe to call twice. */
  dispose() {
    for (const chain of this.chains) {
      for (const j of chain.joints) {
        if (j.bone?.isObject3D) j.bone.quaternion.copy(j.rest);
      }
    }
    this.chains.length = 0;
    this._claimed.clear();
    this.index.clear();
    this.available = false;
    this.stats.chains = 0;
    this.stats.joints = 0;
  }
}

/**
 * Convenience factory matching the rest of src/anim. Returns a SecondaryMotion
 * whose `available` is false when the rig has nothing to swing — call update()
 * unconditionally; it costs one boolean.
 */
export function createSecondaryMotion(opts = {}) {
  return new SecondaryMotion(opts);
}
