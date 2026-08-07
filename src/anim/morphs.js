// ============ morph targets: body variation, correctives, face ============
// Three unrelated problems that all happen to be solved by the same GPU feature,
// so they share one binding pass and one per-character update instead of three:
//
//   BODY       One clerk mesh, seven shape keys, a deterministic per-NPC blend.
//              A floor holds 40+ office workers; shipping a mesh per silhouette
//              is an art cost and a draw-call cost forever. Shape keys are free
//              at render time (a vertex-shader lerp over shared geometry) and
//              cost one float per target per mesh on the CPU.
//   CORRECTIVE Linear blend skinning collapses a joint toward its axis: bend an
//              elbow past ~90deg and the forearm volume folds into the upper arm
//              like a drinking straw. The fix is a shape key driven by the joint
//              angle itself. Four to eight of them across elbows/knees/shoulders
//              /hips is the difference between "low-poly" and "cheap".
//   FACE       Blink, brow and jaw. An office worker that never blinks reads as
//              a prop. This is the cheapest per-character aliveness in the box.
//
// >>>>>>>>>>>>>>>>>>>>>>>>>>>>>> DORMANT BY DESIGN <<<<<<<<<<<<<<<<<<<<<<<<<<<<<
// `Mesh.morphTargetInfluences` and `.morphTargetDictionary` are `undefined` —
// not empty — on any mesh without morph attributes; the Mesh constructor never
// initialises them and only `updateMorphTargets()` does. Today's roster has no
// morphs at all, so EVERY entry point here resolves to `available === false` and
// `update()` costs one boolean test. Nothing throws, nothing warns, nothing
// changes on screen. It lights up the day art delivers shape keys.
// >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
//
// ORDERING: like ik.js, this module NEVER ticks an AnimationMixer. Correctives
// read the bone pose the clip just produced, so `update()` must run AFTER
// models.js `updateMixers()`. Called before it, correctives lag one frame —
// invisible, but wrong, and it compounds with animation LOD.

import * as THREE from 'three';
import { Damper, damp } from '../core/spring.js';
import { clamp, makeRng, rngRange, weightedChoose } from '../core/utils.js';

// ------------------------------------------------------------ name matching ---
// Shape-key names survive a glTF round trip only via `extras.targetNames`, and
// GLTFLoader silently falls back to '0','1','2' when that array's length does
// not match the influence count. Blender writes it; other exporters may not. So
// every lookup is (a) tolerant of spelling and (b) able to find nothing.

const SEPARATORS = /[\s_.:|/\\()[\]-]+/g;
const TOOL_PREFIX = /^(bs|shp|shape|shapekey|morph|blendshape|target)(?=[a-z])/;
const ALL_DIGITS = /^\d+$/;

/** 'Body Thin' / 'BODY_THIN' / 'BS_Body.Thin' -> 'bodythin'. */
export function normalizeMorphName(name) {
  const flat = String(name || '').toLowerCase().replace(SEPARATORS, '');
  return flat.replace(TOOL_PREFIX, '');
}

// Canonical key -> candidate spellings. Candidates are normalized at module load
// so the table stays readable and both sides go through the same function.
// Order matters: the first alias a mesh actually has wins for that mesh.
const RAW_ALIASES = {
  // ---- body variation ----
  bodyThin:     ['BodyThin', 'Thin', 'Slim', 'Skinny', 'BodySlim'],
  bodyFat:      ['BodyFat', 'Fat', 'Heavy', 'Chubby', 'BodyHeavy', 'BodyRound'],
  bodyMuscular: ['BodyMuscular', 'Muscular', 'Buff', 'BodyBuff', 'BodyAthletic'],
  bodyShort:    ['BodyShort', 'Short', 'BodySmall'],
  bodyTall:     ['BodyTall', 'Tall', 'BodyLarge'],
  noseBig:      ['NoseBig', 'BigNose', 'NoseLarge', 'Nose'],
  jawWide:      ['JawWide', 'WideJaw', 'JawBroad', 'Jaw'],

  // ---- face ----
  // The shared 'Blink' spellings sit LAST in both eye lists on purpose: a rig
  // that ships one combined blink binds both channels to the same index, which
  // is better than no blink at all. It is NOT free, though: two channels writing
  // one influence means the second one in FACE_KEYS order wins, so a single-eye
  // `pulse('blinkL')` would silently vanish. `_bind()` detects the shared case
  // and `_updateFace()` collapses the pair with max() instead of letting blinkR
  // clobber blinkL — a wink then reads as a full blink rather than as nothing.
  blinkL:    ['BlinkL', 'Blink_Left', 'EyeBlinkL', 'EyeCloseL', 'LBlink', 'Blink', 'EyeBlink', 'EyesClosed'],
  blinkR:    ['BlinkR', 'Blink_Right', 'EyeBlinkR', 'EyeCloseR', 'RBlink', 'Blink', 'EyeBlink', 'EyesClosed'],
  browUp:    ['BrowUp', 'BrowsUp', 'BrowRaise', 'EyebrowUp', 'BrowInnerUp'],
  browDown:  ['BrowDown', 'BrowsDown', 'BrowLower', 'EyebrowDown', 'BrowAngry'],
  smile:     ['Smile', 'MouthSmile', 'Happy', 'Grin'],
  angry:     ['Angry', 'Anger', 'Mad', 'Scowl', 'MouthFrown'],
  mouthOpen: ['MouthOpen', 'JawOpen', 'OpenMouth', 'Viseme_AA'],
  mouthO:    ['MouthO', 'Ooh', 'Pucker', 'MouthPucker', 'Viseme_OU'],

  // ---- correctives ----
  elbowFixL:    ['Elbow90Fix_L', 'Elbow90Fix.L', 'ElbowFixL', 'Elbow90L', 'ElbowBendL'],
  elbowFixR:    ['Elbow90Fix_R', 'Elbow90Fix.R', 'ElbowFixR', 'Elbow90R', 'ElbowBendR'],
  kneeFixL:     ['Knee90Fix_L', 'Knee90Fix.L', 'KneeFixL', 'Knee90L', 'KneeBendL'],
  kneeFixR:     ['Knee90Fix_R', 'Knee90Fix.R', 'KneeFixR', 'Knee90R', 'KneeBendR'],
  shoulderFixL: ['ShoulderFix_L', 'ShoulderFix.L', 'ShoulderFixL', 'DeltoidL', 'ShoulderUpL'],
  shoulderFixR: ['ShoulderFix_R', 'ShoulderFix.R', 'ShoulderFixR', 'DeltoidR', 'ShoulderUpR'],
  hipFixL:      ['HipFix_L', 'HipFix.L', 'HipFixL', 'HipFlexL', 'ThighFixL'],
  hipFixR:      ['HipFix_R', 'HipFix.R', 'HipFixR', 'HipFlexR', 'ThighFixR'],
};

/** @type {Record<string, string[]>} normalized alias lists, built once. */
const ALIASES = Object.create(null);
for (const key of Object.keys(RAW_ALIASES)) {
  const seen = new Set();
  const list = [];
  for (const spelling of RAW_ALIASES[key]) {
    const n = normalizeMorphName(spelling);
    if (n && !seen.has(n)) { seen.add(n); list.push(n); }
  }
  ALIASES[key] = list;
}

export const BODY_KEYS = Object.freeze(['bodyThin', 'bodyFat', 'bodyMuscular', 'bodyShort', 'bodyTall', 'noseBig', 'jawWide']);
export const FACE_KEYS = Object.freeze(['blinkL', 'blinkR', 'browUp', 'browDown', 'smile', 'angry', 'mouthOpen', 'mouthO']);
export const MORPH_KEYS = Object.freeze(Object.keys(RAW_ALIASES));

const FACE_INDEX = Object.create(null);
FACE_KEYS.forEach((k, i) => { FACE_INDEX[k] = i; });
const F_BLINK_L = FACE_INDEX.blinkL;
const F_BLINK_R = FACE_INDEX.blinkR;

// ------------------------------------------------------------ body variation ---
// Two exclusive groups plus two independent details. The exclusivity is the
// whole trick: sampling all five body shapes independently makes every NPC land
// near the mean, which produces a crowd of identical mid-sized clerks — exactly
// the failure this feature exists to prevent. It is also physically wrong on the
// mesh, since Thin and Fat displace the same vertices in opposite directions and
// at 0.5/0.5 you get a lumpy silhouette rather than an average one.

const BUILD_POOL = [
  { key: null, w: 22, lo: 0, hi: 0 },                    // plain baseline clerks
  { key: 'bodyThin', w: 26, lo: 0.35, hi: 1.0 },
  { key: 'bodyFat', w: 26, lo: 0.30, hi: 0.95 },
  { key: 'bodyMuscular', w: 18, lo: 0.30, hi: 0.90 },
];
const HEIGHT_POOL = [
  { key: null, w: 30, lo: 0, hi: 0 },
  { key: 'bodyShort', w: 35, lo: 0.25, hi: 1.0 },
  { key: 'bodyTall', w: 35, lo: 0.25, hi: 1.0 },
];

// ------------------------------------------------------------- correctives ---
// `angleRange` is DEGREES in the table (authored by hand, read by humans) and
// radians in the compiled entry. `boneA`/`boneB` are candidate-name lists in the
// same lowercase, prefix-stripped form models.js and ik.js use.
//
// The measured quantity is the rotation of boneB's frame relative to boneA's,
// minus whatever that relation was at rest. That is parenting-agnostic: a rig
// with a twist bone spliced between shoulder and elbow still measures the same
// elbow bend, which is the exact case ik.js has to drop a whole chain for.
//
// `hinge: true` marks a joint that bends on ONE axis and must ignore roll. The
// 21-bone contract skeleton has no forearm/shin twist bone, so Mixamo bakes
// pronation into LeftForeArm's own local quaternion: a straight arm with 60deg
// of wrist roll would otherwise read as a 60deg "bend" and fire a volume
// correction on an unbent elbow. A hinge entry removes the component about the
// bone's own long axis (derived from its child's rest offset) before measuring.
// Ball joints — shoulder, hip — leave it off: there the total rotation
// magnitude genuinely IS the quantity that drives the corrective.
// `axis: 'x'|'y'|'z'` still selects the older signed single-axis measurement for
// a rig whose hinge axis is known exactly and whose hyperextension must read
// negative.

const CURVES = {
  linear: (t) => t,
  smooth: (t) => t * t * (3 - 2 * t),
  in: (t) => t * t,
  out: (t) => t * (2 - t),
  // Peaks mid-range: for a shape that only corrects the ~90deg pinch and must
  // fade back out again as the joint straightens OR folds fully closed.
  bell: (t) => Math.sin(t * Math.PI),
};

export const CORRECTIVE_TABLE = Object.freeze([
  { morph: 'elbowFixL', boneA: ['leftarm', 'upperarm_l', 'arm_l'], boneB: ['leftforearm', 'lowerarm_l', 'forearm_l'], angleRange: [20, 140], curve: 'smooth', hinge: true },
  { morph: 'elbowFixR', boneA: ['rightarm', 'upperarm_r', 'arm_r'], boneB: ['rightforearm', 'lowerarm_r', 'forearm_r'], angleRange: [20, 140], curve: 'smooth', hinge: true },
  { morph: 'kneeFixL', boneA: ['leftupleg', 'upleg_l', 'thigh_l'], boneB: ['leftleg', 'leg_l', 'calf_l', 'shin_l'], angleRange: [20, 130], curve: 'smooth', hinge: true },
  { morph: 'kneeFixR', boneA: ['rightupleg', 'upleg_r', 'thigh_r'], boneB: ['rightleg', 'leg_r', 'calf_r', 'shin_r'], angleRange: [20, 130], curve: 'smooth', hinge: true },
  { morph: 'shoulderFixL', boneA: ['leftshoulder', 'clavicle_l', 'shoulder_l'], boneB: ['leftarm', 'upperarm_l', 'arm_l'], angleRange: [25, 95], curve: 'smooth' },
  { morph: 'shoulderFixR', boneA: ['rightshoulder', 'clavicle_r', 'shoulder_r'], boneB: ['rightarm', 'upperarm_r', 'arm_r'], angleRange: [25, 95], curve: 'smooth' },
  { morph: 'hipFixL', boneA: ['hips', 'hip', 'pelvis'], boneB: ['leftupleg', 'upleg_l', 'thigh_l'], angleRange: [25, 100], curve: 'smooth' },
  { morph: 'hipFixR', boneA: ['hips', 'hip', 'pelvis'], boneB: ['rightupleg', 'upleg_r', 'thigh_r'], angleRange: [25, 100], curve: 'smooth' },
]);

// ---------------------------------------------------------------- face mood ---
// A mood is a sustained target vector over FACE_KEYS; reactions are transient
// pulses on top. Both are compiled to index/value tuples at module load so the
// per-frame path never touches a string.

const RAW_MOODS = {
  neutral: {},
  angry: { angry: 0.85, browDown: 0.70 },
  focused: { browDown: 0.35 },
  happy: { smile: 0.80, browUp: 0.25 },
  afraid: { browUp: 0.80, mouthOpen: 0.25 },
  // Eyes shut and jaw slack. Blink scheduling stops here — a corpse that keeps
  // blinking is the single most conspicuous animation bug in a shooter.
  dead: { blinkL: 1, blinkR: 1, mouthOpen: 0.35 },
};

/** kind -> [faceIndex, amount, holdSeconds, decaySeconds][] */
const RAW_REACTIONS = {
  attack: [['browDown', 0.75, 0.06, 0.28], ['angry', 0.60, 0.06, 0.30]],
  hurt: [['browDown', 0.60, 0.04, 0.22], ['mouthOpen', 0.45, 0.05, 0.25], ['blinkL', 1, 0.05, 0.16], ['blinkR', 1, 0.05, 0.16]],
  scream: [['mouthOpen', 0.95, 0.20, 0.35], ['browUp', 0.55, 0.20, 0.35], ['angry', 0.50, 0.20, 0.40]],
  alert: [['browUp', 0.70, 0.10, 0.45]],
  laugh: [['smile', 0.90, 0.15, 0.50], ['browUp', 0.30, 0.15, 0.50]],
  taunt: [['smile', 0.70, 0.25, 0.40], ['browDown', 0.30, 0.25, 0.40]],
};

const MOODS = Object.create(null);
for (const name of Object.keys(RAW_MOODS)) {
  const vec = new Float32Array(FACE_KEYS.length);
  for (const key of Object.keys(RAW_MOODS[name])) {
    const i = FACE_INDEX[key];
    if (i !== undefined) vec[i] = RAW_MOODS[name][key];
  }
  MOODS[name] = vec;
}

const REACTIONS = Object.create(null);
for (const kind of Object.keys(RAW_REACTIONS)) {
  REACTIONS[kind] = RAW_REACTIONS[kind]
    .map(([key, amount, hold, decay]) => [FACE_INDEX[key], amount, hold, decay])
    .filter(([i]) => i !== undefined);
}

export const MOOD_NAMES = Object.freeze(Object.keys(RAW_MOODS));
export const REACTION_NAMES = Object.freeze(Object.keys(RAW_REACTIONS));

// -------------------------------------------------------- module-scope temps ---
// Hoisted per the no-per-frame-allocation rule. Owned exclusively by
// _updateCorrectives(); nothing else may borrow them mid-solve.
const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();
const _qRel = new THREE.Quaternion();
const _tPos = new THREE.Vector3();
const _tScl = new THREE.Vector3();

const DEG = Math.PI / 180;
const EPS = 1e-4;

// `clamp` is `v<a?a:v>b?b:v` — BOTH comparisons are false for NaN and undefined,
// so either sails straight through it and into morphTargetInfluences, where
// WebGLRenderer's arithmetic turns the whole mesh into NaN vertices and the
// character disappears. Every public setter that takes a caller-supplied number
// launders it through this first.
const num = (v, d) => (Number.isFinite(v) ? v : d);

// Warn once per distinct mesh name, not per spawn: 200 enemies sharing one
// mis-exported clerk mesh would otherwise emit 200 identical lines per floor.
const _warnedMeshes = new Set();

// ------------------------------------------------------------ bone indexing ---
// GLTFLoader strips ':' from node names, so `mixamorig:Hips` arrives as
// `mixamorigHips`. Same regex models.js:29 and ik.js use — do not "fix" it to
// require the colon or GLB-loaded rigs stop matching entirely.
const stripPrefix = (n) => String(n || '').replace(/^mixamorig:?/i, '');

/** Accepts models.js's `parts.bones` Map, a plain object, or any Object3D root. */
function buildBoneIndex(src) {
  const map = new Map();
  if (!src) return map;
  if (src instanceof Map) {
    for (const [k, v] of src) if (v) map.set(String(k).toLowerCase(), v);
    return map;
  }
  if (src.isObject3D) {
    // Sockets ship as empty Object3Ds from some pipelines and as Bones from
    // others; index both so a partial delivery still resolves.
    src.traverse((o) => {
      if (o.isBone || o.type === 'Object3D') map.set(stripPrefix(o.name).toLowerCase(), o);
    });
    return map;
  }
  for (const k of Object.keys(src)) if (src[k]) map.set(k.toLowerCase(), src[k]);
  return map;
}

function pickBone(index, names) {
  if (typeof names === 'string') return index.get(names.toLowerCase()) || null;
  for (const n of names || []) {
    const b = index.get(String(n).toLowerCase());
    if (b) return b;
  }
  return null;
}

// ------------------------------------------------------------------- angles ---

/** Unsigned rotation magnitude of a unit quaternion, in radians, 0..PI. */
function quatAngle(q) {
  return 2 * Math.acos(clamp(Math.abs(q.w), 0, 1));
}

/**
 * Signed rotation about a unit axis (swing-twist decomposition). A knee that
 * hyperextends must read NEGATIVE, not "the same as bending", or the corrective
 * fires on the wrong side of the joint.
 */
function twistAngle(q, ax, ay, az) {
  let x = q.x, y = q.y, z = q.z, w = q.w;
  // q and -q are the same rotation but produce opposite signs here; canonicalise.
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const d = x * ax + y * ay + z * az;
  const px = ax * d, py = ay * d, pz = az * d;
  const vec = Math.sqrt(px * px + py * py + pz * pz);
  const len = Math.sqrt(vec * vec + w * w);
  if (len < 1e-8) return 0;     // pure 180deg swing — twist is genuinely undefined
  return 2 * Math.atan2((d < 0 ? -vec : vec) / len, w / len);
}

/**
 * Unsigned SWING magnitude about a unit axis: the rotation left over once the
 * twist about `a` is divided out (swing-twist decomposition, q = swing * twist).
 *
 * Derivation of the shortcut: twist = normalize(a*d, w) with d = q.xyz . a, so
 * swing = q * conj(twist) has scalar part (w^2 + d^2) / sqrt(w^2 + d^2), i.e.
 * exactly sqrt(w^2 + d^2). No temporaries, no allocation, one sqrt.
 *
 * This is what a hinge needs: roll about the bone's long axis lands entirely in
 * the twist and contributes nothing here, while a genuine bend is unaffected.
 */
function swingAngle(q, ax, ay, az) {
  const w = q.w < 0 ? -q.w : q.w;
  const d = (q.w < 0 ? -1 : 1) * (q.x * ax + q.y * ay + q.z * az);
  return 2 * Math.acos(clamp(Math.sqrt(d * d + w * w), 0, 1));
}

const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/**
 * The bone's own long axis in its LOCAL frame, from its child's rest offset.
 *
 * `_qRel` is always expressed in boneB's rest-local frame (both the direct and
 * the decompose path produce restRelation^-1 * currentRelation), so this axis is
 * directly usable as the twist axis. A leaf bone, or a child sitting exactly on
 * its parent's origin, yields null and the caller falls back to the total
 * magnitude — degraded, but never wrong-by-throwing.
 */
function boneLongAxis(bone) {
  const kids = bone && bone.children;
  if (!kids || !kids.length) return null;
  // Prefer a real Bone: props, sockets and meshes get parented to joints too,
  // and a weapon socket's offset is not the bone's anatomical direction.
  const offsetOf = (c) => {
    const p = c && c.position;
    if (!p) return 0;
    const l = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
    return Number.isFinite(l) ? l : 0;
  };
  let pick = null, len = 0;
  for (const c of kids) { const l = offsetOf(c); if (c && c.isBone && l > 1e-6) { pick = c.position; len = l; break; } }
  if (!pick) {
    for (const c of kids) { const l = offsetOf(c); if (l > 1e-6) { pick = c.position; len = l; break; } }
  }
  if (!pick) return null;
  return [pick.x / len, pick.y / len, pick.z / len];
}

// ----------------------------------------------------------------- binding ---

function collectMorphMeshes(root, out) {
  if (!root || !root.traverse) return out;
  root.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    // Both are `undefined` on a mesh with no morph attributes. Unguarded
    // indexing throws, which is the whole reason this module can ship dormant.
    if (!o.morphTargetDictionary || !o.morphTargetInfluences) return;
    out.push(o);
  });
  return out;
}

/**
 * True when two canonical keys resolved to the exact same set of (mesh, index)
 * pairs — i.e. one shape key is doing both jobs, so writing them independently
 * means the later write wins.
 */
function sameTargets(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].inf !== b[i].inf || a[i].i !== b[i].i) return false;
  }
  return true;
}

/** Write one value to every (mesh, index) pair a canonical key resolved to. */
function writeTargets(targets, v) {
  if (!targets) return;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    t.inf[t.i] = v;
  }
}

// ---------------------------------------------------------------- seeding ---

/**
 * Deterministic uint32 from a number or a string (FNV-1a).
 *
 * Determinism is a NETWORK requirement, not a nicety: co-op clients each build
 * their own crowd, so the seed must come from something both sides agree on —
 * the floor seed plus a spawn index, never `Math.random()` and never an object
 * identity. Pass a per-client value and every player sees a different crowd.
 */
export function morphSeed(x) {
  if (typeof x === 'number' && Number.isFinite(x)) return Math.abs(Math.trunc(x)) >>> 0;
  const s = String(x ?? '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ================================================================== runtime ===

export class CharacterMorphs {
  /**
   * @param {{
   *   root?: THREE.Object3D,          character root to scan for morph meshes
   *   meshes?: THREE.Mesh[],          explicit mesh list (skips the traverse)
   *   bones?: Map|Object|THREE.Object3D,   models.js `parts.bones`, or anything indexable
   *   seed?: number|string,           deterministic per-NPC identity
   *   body?: boolean|Object<string,number>, false to skip, or explicit weights
   *   correctives?: Array,            defaults to CORRECTIVE_TABLE
   *   face?: boolean,
   *   mood?: string,
   *   reassert?: boolean,        rewrite every channel every frame (see below)
   *   reassertBody?: boolean,    deprecated alias for `reassert`
   *   enabled?: boolean,
   * }} opts
   */
  constructor({
    root = null,
    meshes = null,
    bones = null,
    seed = 0,
    body = true,
    correctives = CORRECTIVE_TABLE,
    face = true,
    mood = 'neutral',
    reassert = false,
    reassertBody = false,
    enabled = true,
  } = {}) {
    this.root = root;
    this.enabled = enabled;
    // Set this when a clip animates morphTargetInfluences. A GLTF morph track is
    // named 'Mesh.morphTargetInfluences' with no index, so it binds as
    // EntireArray and rewrites the WHOLE array every mixer tick. Body, face and
    // correctives all cache what they last wrote and skip unchanged writes, so
    // ONE such track silently freezes all three forever: the mixer reverts the
    // array, the caches still hold the old values, every delta stays under EPS
    // and nothing is ever written again. `reassert` bypasses all three caches.
    this.reassert = Boolean(reassert || reassertBody);
    this.lod = 0;
    this.seed = morphSeed(seed);

    this.meshes = Array.isArray(meshes) && meshes.length
      ? meshes.filter((m) => m && m.morphTargetDictionary && m.morphTargetInfluences)
      : collectMorphMeshes(root, []);

    /** @type {Map<string, Array<{inf: number[], i: number}>>} */
    this.bindings = this._bind();

    /**
     * The one flag every hot path tests. False means: no mesh, no morphs, or
     * morphs whose names survived export as '0','1','2'. All three degrade to
     * the same thing — a character that renders and animates, just without any
     * of this.
     */
    this.available = this.bindings.size > 0;

    // The face gets its own stream, salted away from the body's. If they shared
    // one, adding a single extra face draw later would reshuffle every
    // silhouette in the game — a change nobody would connect to the commit that
    // caused it. (The body's stream is built per call inside
    // applyBodyVariation, so that call is idempotent.)
    this._rngFace = makeRng(this.seed ^ 0x5bf03635);

    // ---- body ----
    this.bodyWeights = new Float32Array(BODY_KEYS.length);
    this._bodyTargets = BODY_KEYS.map((k) => this.bindings.get(k) || null);
    this.bodyDescriptor = null;
    if (body) this.applyBodyVariation(this.seed, typeof body === 'object' ? body : null);

    // ---- correctives ----
    this.correctives = this._buildCorrectives(correctives, buildBoneIndex(bones || root));

    // ---- face ----
    const n = FACE_KEYS.length;
    this._faceTargets = FACE_KEYS.map((k) => this.bindings.get(k) || null);
    this._faceVal = new Float32Array(n);     // what is currently on the mesh
    this._moodVal = new Float32Array(n);     // damped sustained pose
    this._moodTarget = new Float32Array(n);
    this._pulse = new Float32Array(n);
    this._pulseHold = new Float32Array(n);
    this._pulseRate = new Float32Array(n);   // units per second of decay
    this.faceEnabled = Boolean(face) && this._faceTargets.some(Boolean);
    // A rig that ships one combined 'Blink' binds blinkL and blinkR to the same
    // influence. Detect it once so _updateFace can collapse the pair with max()
    // instead of letting blinkR (which comes second in FACE_KEYS) overwrite
    // whatever blinkL just wrote — which would make a one-eyed wink a no-op.
    this._blinkShared = sameTargets(this._faceTargets[F_BLINK_L], this._faceTargets[F_BLINK_R]);
    this._blinkWrote = -1;                   // last value pushed to the shared index
    this.moodName = 'neutral';
    this.setMood(mood, 1);

    this.blinkEnabled = true;
    this.blinkPhase = -1;                    // -1 = eyes open, else 0..1 progress
    this.blinkDuration = 0.16;
    // Random initial delay, not a fresh full interval: spawning a wave would
    // otherwise blink the entire crowd in unison on the same frame.
    this._blinkT = rngRange(this._rngFace, 0.2, 7);

    this.stats = { corrections: 0 };
  }

  // ------------------------------------------------------------------ bind

  _bind() {
    const bind = new Map();

    for (const mesh of this.meshes) {
      const dict = mesh.morphTargetDictionary;
      const inf = mesh.morphTargetInfluences;
      const byNorm = new Map();
      let named = 0, numeric = 0;

      for (const raw of Object.keys(dict)) {
        const i = dict[raw];
        // A dictionary rebuilt from extras.targetNames can outlive a geometry
        // edit; an out-of-range index would write past the influences array and
        // silently do nothing (or throw on a typed array).
        if (!Number.isInteger(i) || i < 0 || i >= inf.length) continue;
        if (ALL_DIGITS.test(raw)) numeric++; else named++;
        const key = normalizeMorphName(raw);
        if (key && !byNorm.has(key)) byNorm.set(key, i);
      }

      for (const canonical of MORPH_KEYS) {
        for (const alias of ALIASES[canonical]) {
          const i = byNorm.get(alias);
          if (i === undefined) continue;
          let list = bind.get(canonical);
          if (!list) bind.set(canonical, (list = []));
          list.push({ inf, i });
          break;                              // first matching alias per mesh wins
        }
      }

      // Morphs exist but nothing matched AND the names are numeric: that is the
      // exporter dropping extras.targetNames, not an art decision. Worth exactly
      // one line in the console, because it is otherwise indistinguishable from
      // "no morphs authored yet" and would ship silently broken.
      if (numeric > 0 && named === 0) {
        const id = mesh.name || mesh.geometry?.name || 'unnamed-mesh';
        if (!_warnedMeshes.has(id)) {
          _warnedMeshes.add(id);
          console.warn(`[morphs] "${id}" has ${numeric} unnamed morph targets — the exporter dropped extras.targetNames, so nothing can be driven by name.`);
        }
      }
    }
    return bind;
  }

  has(key) { return this.bindings.has(key); }

  /**
   * Manual override. Only meaningful for keys neither the face nor a corrective
   * drives.
   *
   * The finiteness test is not defensive noise: `clamp` is `v<a?a:v>b?b:v`, and
   * BOTH comparisons are false for `undefined` and for `NaN`, so either sails
   * straight through into `morphTargetInfluences[i]`. WebGLRenderer does
   * arithmetic on that array, so one NaN turns every vertex of the mesh into NaN
   * and the character vanishes — from a caller that merely passed the wrong
   * variable name.
   */
  set(key, value) {
    if (!Number.isFinite(value)) return false;
    writeTargets(this.bindings.get(key), clamp(value, 0, 1));
    return true;
  }

  // --------------------------------------------------------- body variation

  /**
   * Deterministic silhouette for one NPC. Called once at spawn; the weights are
   * static after that (a clerk does not change build at runtime).
   *
   * Idempotent: the RNG is rebuilt from the seed on every call rather than
   * continuing a stored stream, so calling this twice cannot hand the same NPC
   * two different bodies — which on a co-op guest would show up as one client
   * disagreeing with the others about who is who.
   *
   * @param {number|string} seed
   * @param {Object<string, number>|null} explicit forced weights, bypassing the draw
   * @returns {{build: string|null, height: string|null, buildBias: number, heightBias: number, weights: Object<string, number>}}
   */
  applyBodyVariation(seed = this.seed, explicit = null) {
    const w = this.bodyWeights;
    w.fill(0);
    let build = null, height = null;

    if (explicit) {
      for (let i = 0; i < BODY_KEYS.length; i++) {
        const v = explicit[BODY_KEYS[i]];
        if (Number.isFinite(v)) w[i] = clamp(v, 0, 1);
      }
    } else {
      const rng = makeRng(morphSeed(seed) ^ 0x9e3779b9);
      const b = weightedChoose(BUILD_POOL, rng);
      const h = weightedChoose(HEIGHT_POOL, rng);
      // Draw the magnitude unconditionally, even when the pick is `null`, so the
      // number of draws is fixed regardless of which branch was taken. Otherwise
      // a baseline clerk consumes two fewer draws and its nose/jaw come from a
      // different point in the stream than a fat clerk's — which quietly
      // correlates face detail with build across the whole crowd.
      const bMag = rngRange(rng, b.lo, b.hi);
      const hMag = rngRange(rng, h.lo, h.hi);
      if (b.key) { w[BODY_KEYS.indexOf(b.key)] = bMag; build = b.key; }
      if (h.key) { w[BODY_KEYS.indexOf(h.key)] = hMag; height = h.key; }
      // Detail shapes are independent and biased low: `^1.7` keeps most faces
      // ordinary so the few big noses actually read as distinct individuals
      // instead of everyone looking equally exaggerated.
      w[BODY_KEYS.indexOf('noseBig')] = Math.pow(rng(), 1.7) * 0.9;
      w[BODY_KEYS.indexOf('jawWide')] = Math.pow(rng(), 1.7) * 0.85;
    }

    this._writeBody();

    const weights = {};
    for (let i = 0; i < BODY_KEYS.length; i++) weights[BODY_KEYS[i]] = w[i];
    this.bodyDescriptor = {
      build,
      height,
      // Advisory outputs. A caller that also nudges root scale by a couple of
      // percent from these gets silhouette variety that survives distance, where
      // the morphs themselves stop being readable.
      buildBias: w[BODY_KEYS.indexOf('bodyFat')] - w[BODY_KEYS.indexOf('bodyThin')],
      heightBias: w[BODY_KEYS.indexOf('bodyTall')] - w[BODY_KEYS.indexOf('bodyShort')],
      weights,
    };
    return this.bodyDescriptor;
  }

  _writeBody() {
    for (let i = 0; i < BODY_KEYS.length; i++) writeTargets(this._bodyTargets[i], this.bodyWeights[i]);
  }

  // ------------------------------------------------------------ correctives

  _buildCorrectives(table, index) {
    const out = [];
    for (const spec of table || []) {
      const targets = this.bindings.get(spec.morph);
      if (!targets) continue;                      // no shape key -> no corrective
      const boneA = pickBone(index, spec.boneA);
      const boneB = pickBone(index, spec.boneB);
      if (!boneA || !boneB || boneA === boneB) continue;

      const [loDeg, hiDeg] = spec.angleRange || [0, 90];
      const lo = loDeg * DEG, hi = hiDeg * DEG;
      if (Math.abs(hi - lo) < 1e-6) continue;      // a zero-width range is all-or-nothing noise

      const axis = AXES[spec.axis] || null;
      // A hinge measures SWING only, about boneB's own long axis, so roll baked
      // into the bone (Mixamo has no forearm/shin twist bone, so pronation lands
      // in LeftForeArm's own quaternion) cannot masquerade as a bend. An
      // explicit `axis` wins — that caller knows the rig exactly. A leaf boneB
      // gives no axis, and then this degrades to the total magnitude, which is
      // what the old code always did.
      const swing = !axis && spec.hinge ? boneLongAxis(boneB) : null;
      const curve = typeof spec.curve === 'function' ? spec.curve : (CURVES[spec.curve] || CURVES.smooth);

      // Fast path: when boneB is a direct child of boneA its LOCAL quaternion is
      // already the relative rotation, so the whole measurement costs a few
      // multiplies and no matrix decompose. Every entry in the default table
      // hits this on a spec-compliant rig.
      const direct = boneB.parent === boneA;

      const entry = {
        morph: spec.morph,
        targets, boneA, boneB, direct, axis, swing, curve, lo, hi,
        scale: Number.isFinite(spec.scale) ? clamp(spec.scale, 0, 1) : 1,
        restInv: new THREE.Quaternion(),
        // A small damper hides the stair-stepping that animation LOD introduces
        // when a distant enemy's mixer only ticks every 3rd frame. Set
        // `smooth: 0` on an entry that must track the pose exactly.
        damper: new Damper(0, Number.isFinite(spec.smooth) ? spec.smooth : 0.05),
        value: 0,
      };
      out.push(entry);
    }
    if (out.length) this.captureRest(out);
    return out;
  }

  /**
   * Snapshot the joint relations that count as "no correction needed".
   *
   * Called from the constructor, which for models.js runs after
   * SkeletonUtils.clone but BEFORE the first mixer tick — i.e. at bind pose,
   * which is what we want. If your pipeline poses the rig before building this
   * object, call captureRest() again at bind pose or every corrective will read
   * a constant non-zero angle and sit permanently half-fired.
   */
  captureRest(list = this.correctives) {
    for (const e of list) {
      if (e.direct) {
        e.restInv.copy(e.boneB.quaternion).invert();
      } else {
        // matrixWorld is only refreshed by the renderer's scene traversal, which
        // runs AFTER this module. Without this the slow path measures last
        // frame's pose — the exact one-frame lag the ORDERING note at the top of
        // the file exists to prevent. updateWorldMatrix(true, false) walks
        // ancestors only, allocates nothing, and is paid solely by the entries
        // that actually took the slow path.
        e.boneA.updateWorldMatrix(true, false);
        e.boneB.updateWorldMatrix(true, false);
        e.boneA.matrixWorld.decompose(_tPos, _qA, _tScl);
        e.boneB.matrixWorld.decompose(_tPos, _qB, _tScl);
        e.restInv.copy(_qA).invert().multiply(_qB).invert();
      }
      e.damper.snap(0);
      e.value = 0;
      writeTargets(e.targets, 0);
    }
  }

  _updateCorrectives(dt) {
    for (let i = 0; i < this.correctives.length; i++) {
      const e = this.correctives[i];

      if (e.direct) {
        _qRel.copy(e.restInv).multiply(e.boneB.quaternion);
      } else {
        // Same ancestor refresh as captureRest: matrixWorld is stale at this
        // point in the frame. See the comment there.
        e.boneA.updateWorldMatrix(true, false);
        e.boneB.updateWorldMatrix(true, false);
        // decompose() normalises out scale; setFromRotationMatrix() does not and
        // would return a non-unit quaternion on any scaled bone chain.
        e.boneA.matrixWorld.decompose(_tPos, _qA, _tScl);
        e.boneB.matrixWorld.decompose(_tPos, _qB, _tScl);
        _qA.invert().multiply(_qB);              // _qA := current A->B relation
        _qRel.copy(e.restInv).multiply(_qA);     // ...minus the rest relation
      }

      const angle = e.axis
        ? twistAngle(_qRel, e.axis[0], e.axis[1], e.axis[2])
        : e.swing
          ? swingAngle(_qRel, e.swing[0], e.swing[1], e.swing[2])
          : quatAngle(_qRel);
      // A bone whose quaternion has gone non-finite (a physics blow-up in
      // secondary.js, an IK solver fed a bad limit) would otherwise produce a
      // NaN target, and a Damper that has once seen NaN stays NaN forever — the
      // corrective would be permanently dead even after the bone recovered, and
      // the NaN would reach morphTargetInfluences and erase the mesh. Skipping
      // the entry holds the last good value and self-heals on the next good
      // frame.
      if (!Number.isFinite(angle)) continue;
      const t = clamp((angle - e.lo) / (e.hi - e.lo), 0, 1);
      const target = clamp(e.curve(t), 0, 1) * e.scale;
      const v = e.damper.to(target, dt);

      const changed = Math.abs(v - e.value) > EPS;
      if (this.reassert || changed) {
        e.value = v;
        writeTargets(e.targets, v);
        // Counts real pose changes only, so the stat still means something when
        // reassert is forcing a write on every frame regardless.
        if (changed) this.stats.corrections++;
      }
    }
  }

  // ------------------------------------------------------------------- face

  /** @param {string} name one of MOOD_NAMES @param {number} strength 0..1 */
  setMood(name, strength = 1) {
    const vec = MOODS[name] || MOODS.neutral;
    this.moodName = MOODS[name] ? name : 'neutral';
    const s = clamp(num(strength, 1), 0, 1);
    for (let i = 0; i < this._moodTarget.length; i++) this._moodTarget[i] = vec[i] * s;
  }

  /**
   * Transient expression on top of the mood. `hold` then linear decay, because
   * an exponential tail on a jaw looks like the character is chewing.
   *
   * @returns {boolean} false if `key` is not a face channel
   */
  pulse(key, amount = 1, hold = 0.06, decay = 0.28) {
    const i = FACE_INDEX[key];
    if (i === undefined) return false;
    const a = clamp(num(amount, 1), 0, 1);
    // max(), not +=: two overlapping reactions must not drive a jaw past 1 and
    // then take twice as long to come back down.
    if (a > this._pulse[i]) this._pulse[i] = a;
    this._pulseHold[i] = Math.max(this._pulseHold[i], Math.max(0, num(hold, 0.06)));
    this._pulseRate[i] = 1 / Math.max(0.02, num(decay, 0.28));
    return true;
  }

  /** @param {string} kind one of REACTION_NAMES */
  react(kind, strength = 1) {
    const set = REACTIONS[kind];
    if (!set) return false;
    const s = clamp(num(strength, 1), 0, 1);
    for (let i = 0; i < set.length; i++) {
      const [idx, amount, hold, decay] = set[i];
      const a = amount * s;
      if (a > this._pulse[idx]) this._pulse[idx] = a;
      this._pulseHold[idx] = Math.max(this._pulseHold[idx], hold);
      this._pulseRate[idx] = 1 / Math.max(0.02, decay);
    }
    return true;
  }

  /** Jaw drops and holds — the boss scream, the alerted-horde shout. */
  scream(duration = 0.45, strength = 1) {
    const d = Math.max(0.08, num(duration, 0.45));
    const s = clamp(num(strength, 1), 0, 1);
    this.pulse('mouthOpen', 0.95 * s, d * 0.6, d * 0.4);
    this.pulse('browUp', 0.55 * s, d * 0.6, d * 0.4);
    this.pulse('angry', 0.5 * s, d * 0.6, d * 0.5);
  }

  /** Force a blink now (a hit reaction, a flash of light). */
  blinkNow() {
    if (this.blinkPhase < 0) this.blinkPhase = 0;
  }

  _updateFace(dt) {
    // ---- blink schedule ----
    // Interval comes from the NPC's own seeded stream, so the SEQUENCE is
    // identical on every client. The phase is not, and cannot be — clients have
    // different frame timings — but nobody can perceive two clerks blinking
    // 80ms apart, whereas a crowd built from different bodies is obvious.
    if (this.blinkEnabled && this.moodName !== 'dead') {
      if (this.blinkPhase >= 0) {
        this.blinkPhase += dt / this.blinkDuration;
        if (this.blinkPhase >= 1) {
          this.blinkPhase = -1;
          this._blinkT = rngRange(this._rngFace, 2, 7);
        }
      } else {
        this._blinkT -= dt;
        if (this._blinkT <= 0) this.blinkPhase = 0;
      }
    } else if (this.blinkPhase >= 0) {
      this.blinkPhase = -1;
    }

    let blink = 0;
    if (this.blinkPhase >= 0) {
      const p = this.blinkPhase;
      // Asymmetric: eyelids slam shut and drift open. A symmetric triangle reads
      // as a slow, sleepy blink no matter how short you make it.
      blink = p < 0.34 ? p / 0.34 : p < 0.46 ? 1 : 1 - (p - 0.46) / 0.54;
    }

    for (let i = 0; i < FACE_KEYS.length; i++) {
      const targets = this._faceTargets[i];

      // Mood eases; pulses hold then decay linearly.
      this._moodVal[i] = damp(this._moodVal[i], this._moodTarget[i], 9, dt);
      if (this._pulse[i] > 0) {
        if (this._pulseHold[i] > 0) this._pulseHold[i] -= dt;
        else this._pulse[i] = Math.max(0, this._pulse[i] - this._pulseRate[i] * dt);
      }

      let v = clamp(this._moodVal[i] + this._pulse[i], 0, 1);
      // A blink must win over whatever the mood is doing to the eyes, not add to
      // it, or an angry NPC blinks half-way and looks like it is squinting.
      const isBlink = i === F_BLINK_L || i === F_BLINK_R;
      if (isBlink) v = Math.max(v, blink);

      if (isBlink && this._blinkShared) {
        // One influence, two channels. Record the intent; the single write
        // happens after the loop so blinkR cannot clobber blinkL's wink.
        this._faceVal[i] = v;
        continue;
      }

      if (targets && (this.reassert || Math.abs(v - this._faceVal[i]) > EPS)) {
        this._faceVal[i] = v;
        writeTargets(targets, v);
      }
    }

    if (this._blinkShared) {
      const m = Math.max(this._faceVal[F_BLINK_L], this._faceVal[F_BLINK_R]);
      if (this.reassert || Math.abs(m - this._blinkWrote) > EPS) {
        this._blinkWrote = m;
        writeTargets(this._faceTargets[F_BLINK_L], m);
      }
    }
  }

  // ------------------------------------------------------------------- tick

  /**
   * Animation LOD tier. 0 = everything, 1 = correctives only (a face is
   * sub-pixel at that range), 2 = frozen. Pair it with src/ai/lod.js — the
   * silhouette correctives are what still matter at distance, not the brows.
   */
  setLOD(tier) {
    const t = tier | 0;
    if (t === this.lod) return;
    // Leaving tier 0 mid-blink would freeze the eyes shut for as long as the
    // enemy stays far away. One flush costs two writes and removes that entirely.
    //
    // Flush to the sustained MOOD value, not to zero: the 'dead' mood pins
    // blinkL/blinkR to 1 precisely so a corpse's eyes stay shut, and zeroing
    // them here would pop a dead clerk's eyes open the moment it crossed the LOD
    // boundary and hold them open for as long as it stayed far away. The
    // transient part of a blink lives in blinkPhase, which the line above
    // already cleared, so this drops exactly the transient and nothing else.
    if (t >= 1 && this.lod < 1 && this.faceEnabled) {
      this.blinkPhase = -1;
      const mL = this._moodVal[F_BLINK_L];
      const mR = this._moodVal[F_BLINK_R];
      this._faceVal[F_BLINK_L] = mL;
      this._faceVal[F_BLINK_R] = mR;
      if (this._blinkShared) {
        const m = Math.max(mL, mR);
        this._blinkWrote = m;
        writeTargets(this._faceTargets[F_BLINK_L], m);
      } else {
        writeTargets(this._faceTargets[F_BLINK_L], mL);
        writeTargets(this._faceTargets[F_BLINK_R], mR);
      }
    }
    this.lod = t;
  }

  /**
   * Run AFTER the AnimationMixer has ticked (models.js `updateMixers`).
   * @param {number} dt seconds
   */
  update(dt) {
    if (!this.available || !this.enabled || this.lod >= 2 || !(dt > 0)) return;
    if (this.correctives.length) this._updateCorrectives(dt);
    if (this.faceEnabled && this.lod < 1) this._updateFace(dt);
    // Body is the one channel with no per-frame solve of its own, so it needs an
    // explicit rewrite here; correctives and the face already bypassed their
    // caches above on the same flag. Off by default because the roster has no
    // morph tracks and all of this is pure waste when it is not needed.
    if (this.reassert) this._writeBody();
  }

  /** Art QA: what actually bound, and what the art is missing. */
  report() {
    return {
      available: this.available,
      meshes: this.meshes.length,
      bound: [...this.bindings.keys()],
      missing: MORPH_KEYS.filter((k) => !this.bindings.has(k)),
      correctives: this.correctives.map((e) => e.morph),
      body: this.bodyDescriptor,
    };
  }

  /**
   * Drop every reference into the character's meshes and skeleton so a pooled or
   * despawned NPC is not kept alive by this object. Nothing here owns GPU
   * resources; the influences arrays belong to the meshes.
   */
  dispose() {
    for (const e of this.correctives) { e.targets = null; e.boneA = null; e.boneB = null; }
    this.correctives.length = 0;
    this.bindings.clear();
    this._bodyTargets.length = 0;
    this._faceTargets.length = 0;
    this.meshes.length = 0;
    this.available = false;
    this.enabled = false;
  }
}

/**
 * Tolerant factory. Returns a CharacterMorphs that is permanently inert
 * (`available` false, `update()` a single boolean test) when the character has
 * no morph targets — rather than null, so call sites never need a null check in
 * their hot loop. That is the state the entire current roster is in.
 */
export function createCharacterMorphs(opts = {}) {
  return new CharacterMorphs(opts);
}

export { CURVES as MORPH_CURVES };
