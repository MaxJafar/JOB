// ============ shared clip library + skeleton retargeting ============
// CHARACTER_ART_SPEC §3 says every character wears the same 21-bone skeleton,
// and §6 ships the animation separately:
//
//   public/models/characters/<slug>.glb   mesh + skeleton, NO animation
//   public/models/characters/_anims.glb   skeleton + every clip, NO mesh
//
// That is the single biggest cost saver in the whole pipeline — author one clip
// set, drive the whole roster — but only if the runtime actually honours it. So
// this module owns three things and nothing else:
//
//   1. load `_anims.glb` ONCE and key its clips by logical name
//   2. make those clips playable on a given character's skeleton
//   3. cache the result per (slug, clip) so a 40-enemy horde pays once, not 40x
//
// (3) is not an optimisation detail. `SkeletonUtils.retargetClip` works by
// standing up a throwaway AnimationMixer and stepping the source rig frame by
// frame, re-solving all 21 bones each step. It is tens of milliseconds per clip.
// Doing it per spawn would hitch every wave.
//
// Three tiers, cheapest first — most of the roster never reaches the expensive one:
//
//   PASSTHROUGH  bone names and rest pose are identical      -> the clip as-is, 0 cost
//   RENAME       rest pose identical, names differ by prefix -> rewrite track names, µs
//   RETARGET     rest poses genuinely diverge                -> SkeletonUtils, ms
//
// The RENAME tier exists because GLTFLoader strips `:` from node names, so a
// Mixamo rig arrives as `mixamorigHips` while a hand-named one arrives as
// `Hips`. Same skeleton, same rest pose, different strings — a full retarget
// there would be pure waste.
//
// EVERY failure path returns the source clip unmodified. A missing `_anims.glb`,
// a rig with no skeleton, a clip with zero duration, an exception out of three's
// solver — none of them may stop a character from rendering and playing. The
// worst outcome allowed here is "the animation looks wrong", never "the game
// throws".

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  retargetClip as retargetClipRaw,
  clone as cloneSkinned,
} from 'three/examples/jsm/utils/SkeletonUtils.js';
// skeleton.js owns the bone vocabulary — every spelling of every joint, the
// claiming resolver and the target->source name map. It is deliberately NOT
// duplicated here: two modules with their own idea of what `Thigh_L` means is
// exactly how a rig ends up half-matched with nothing logged.
import { BONE_KEYS, resolveBones, buildRetargetOptions, findSkinnedMesh } from './skeleton.js';

const BASE = '/models/characters';
const ANIMS_URL = `${BASE}/_anims.glb`;

const loader = new GLTFLoader();

// Retargeting samples the source clip at a fixed rate. Cap the total frame count
// so a pathological 20 s idle authored at 240 Hz can't allocate a 4 800-frame x
// 21-bone track set (~1.6 MB of Float32) during a level load.
let MAX_FRAMES = 600;

// Two rest quaternions this close count as "the same rig". 4 degrees is well
// under what a human reads as a wrong bind pose, and well over float noise from
// a round trip through Blender's exporter.
let REST_DOT = Math.cos((4 * Math.PI) / 180 / 2);

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ---------------------------------------------------------------- stats

const stats = {
  source: 'idle',      // idle | loading | loaded | missing
  clipsLoaded: 0,      // clips found in _anims.glb
  slugsCached: 0,
  clipsCached: 0,
  retargets: 0,        // full SkeletonUtils conversions performed
  renames: 0,          // track-name rewrites (cheap tier)
  passthroughs: 0,     // clips handed back untouched
  native: 0,           // character-authored clips that overrode a shared one
  cacheHits: 0,
  cacheMisses: 0,
  failures: 0,
  warnings: 0,
  retargetMs: 0,
};

/** Snapshot for the debug panel. Copied so a panel can't mutate live counters. */
export function retargetStats() {
  return { ...stats };
}

const warned = new Set();

/**
 * One line per distinct failure, ever. A broken `_anims.glb` affects every
 * character on the floor; without the dedupe the console fills with 200 copies
 * of the same sentence and buries whatever else went wrong.
 *
 * `key` must therefore vary with whatever the MESSAGE names. A fixed key on a
 * per-slug or per-clip failure reports the first offender and hides every other
 * one — three broken rigs would print one line and look like a single bad
 * character. Constant keys are only for genuinely process-wide failures (the
 * clip library itself being absent or unreadable).
 */
function warnOnce(key, ...msg) {
  stats.warnings++;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn('[retarget]', ...msg);
}

// ---------------------------------------------------------------- clip naming

// Bone names go through skeleton.js. This one is only for CLIP names, which are
// a different problem: `normalizeBoneName` strips separators, and that would
// turn `attack_a` into `attacka`.
const MIXAMO = /^mixamorig[:_ ]?/i;

/**
 * Clip names are the one thing GLTFLoader does NOT sanitise, so they arrive
 * exactly as authored: `Armature|idle`, `idleAction`, `run.001`. Normalise to
 * the logical names CHARACTER_ART_SPEC §6 and AnimationController's CLIP_ALIASES
 * both speak, or half the library silently never resolves.
 */
export function clipKey(raw) {
  let n = String(raw ?? '');
  const bar = n.lastIndexOf('|');
  if (bar >= 0) n = n.slice(bar + 1);              // "Armature|idle" -> "idle"
  n = n.replace(MIXAMO, '').trim().toLowerCase();
  n = n.replace(/\.\d+$/, '');                     // Blender duplicate suffix ".001"
  const bare = n.replace(/_?action$/, '');         // Blender NLA export "idleAction"
  if (bare.length >= 3) n = bare;
  return n.replace(/[\s-]+/g, '_');
}

// ---------------------------------------------------------------- rig helpers

const EMPTY_GEO = new THREE.BufferGeometry();
const EMPTY_MAT = new THREE.MeshBasicMaterial({ visible: false });

/**
 * `_anims.glb` ships a skeleton with NO mesh (spec §6), but `retargetClip` reads
 * `source.skeleton` and `target.skeleton` — it cannot consume a bare Group. Wrap
 * the loose bones in a mesh-less SkinnedMesh so three's solver has the shape it
 * expects. Nothing here is ever rendered or added to a scene.
 */
function synthesizeSkinned(root) {
  const bones = [];
  root.traverse((o) => { if (o.isBone) bones.push(o); });
  if (!bones.length) {
    // Exporters sometimes emit joint nodes as plain Object3D when no mesh is
    // skinned to them — which is exactly the mesh-less clip file's situation.
    root.traverse((o) => { if (o !== root && o.type === 'Object3D' && o.name) bones.push(o); });
  }
  if (!bones.length) return null;

  root.updateMatrixWorld(true);                    // Skeleton.init() reads matrixWorld
  const mesh = new THREE.SkinnedMesh(EMPTY_GEO, EMPTY_MAT);
  mesh.name = '__retarget_proxy__';
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.skeleton = new THREE.Skeleton(bones);
  // Detached + identity bind matrices: AttachedBindMode would invert this
  // mesh's own (never-updated) world matrix every updateMatrixWorld.
  mesh.bindMode = THREE.DetachedBindMode;
  mesh.bindMatrix.identity();
  mesh.bindMatrixInverse.identity();
  return mesh;
}

/** First real skinned rig under `root`, or a synthesised one. Never throws. */
function rigOf(root) {
  if (!root) return null;
  let mesh = findSkinnedMesh(root);
  if (mesh && !mesh.skeleton) mesh = null;
  if (!mesh && typeof root.traverse === 'function') mesh = synthesizeSkinned(root);
  if (!mesh || !mesh.skeleton) return null;
  const bones = mesh.skeleton.bones.filter(Boolean);
  return bones.length ? { mesh, bones } : null;
}

// Rest pose is snapshotted as flat floats (pos3 + quat4 + scale3) rather than
// cloned Vector3/Quaternion objects: 21 bones x 3 objects per rig adds up across
// the roster, and restoring from a typed array is allocation-free.
const REST_STRIDE = 10;

function snapshotRest(bones) {
  const out = new Float64Array(bones.length * REST_STRIDE);
  for (let i = 0; i < bones.length; i++) {
    const b = bones[i];
    const o = i * REST_STRIDE;
    out[o] = b.position.x; out[o + 1] = b.position.y; out[o + 2] = b.position.z;
    out[o + 3] = b.quaternion.x; out[o + 4] = b.quaternion.y;
    out[o + 5] = b.quaternion.z; out[o + 6] = b.quaternion.w;
    out[o + 7] = b.scale.x; out[o + 8] = b.scale.y; out[o + 9] = b.scale.z;
  }
  return out;
}

/**
 * `retargetClip` leaves BOTH rigs posed at the last sampled frame — three never
 * restores them. Converting a second clip would then start from that pose for
 * every bone the new clip doesn't animate, quietly corrupting it. Restore before
 * and after, always.
 */
function restoreRest(bones, rest) {
  for (let i = 0; i < bones.length; i++) {
    const b = bones[i];
    const o = i * REST_STRIDE;
    b.position.set(rest[o], rest[o + 1], rest[o + 2]);
    b.quaternion.set(rest[o + 3], rest[o + 4], rest[o + 5], rest[o + 6]);
    b.scale.set(rest[o + 7], rest[o + 8], rest[o + 9]);
    b.matrixWorldNeedsUpdate = true;
  }
}

/** |dot| of two rest quaternions, read straight out of the snapshots. */
function restAgrees(restA, ia, restB, ib) {
  const a = ia * REST_STRIDE + 3;
  const b = ib * REST_STRIDE + 3;
  const d = restA[a] * restB[b] + restA[a + 1] * restB[b + 1]
    + restA[a + 2] * restB[b + 2] + restA[a + 3] * restB[b + 3];
  return Math.abs(d) >= REST_DOT;
}

// ---------------------------------------------------------------- shared library

let sharedPromise = null;
/** @type {{clips: Map<string, THREE.AnimationClip>, mesh: any, bones: any[], rest: Float64Array, resolved: Record<string, any>, index: Map<any, number>, root: any, hips: any, hipsY: number} | null} */
let source = null;

const EMPTY_CLIPS = new Map();

function buildSource(gltf) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const rig = rigOf(root);
  if (!rig) return null;

  const index = new Map();
  rig.bones.forEach((b, i) => index.set(b, i));
  // Resolved ONCE at load: every character on the floor is compared against this
  // same source, and resolveBones() walks the whole hierarchy.
  const resolved = resolveBones(rig.mesh);
  const hips = resolved.hips ?? rig.bones[0];

  return {
    clips: new Map(),
    root,
    mesh: rig.mesh,
    bones: rig.bones,
    rest: snapshotRest(rig.bones),
    resolved,
    index,
    hips,
    // Rest hip height in the source rig's metres, used to scale the hip
    // translation track onto characters of a different size — see makeProxy.
    hipsY: hips ? hips.matrixWorld.elements[13] : 0,
  };
}

/**
 * Load `_anims.glb` exactly once. Resolves to a Map keyed by `clipKey`; resolves
 * to an EMPTY map (never rejects) when the file isn't there, because the art is
 * delivered incrementally and a missing clip library must not block a load.
 * @returns {Promise<Map<string, THREE.AnimationClip>>}
 */
export function loadSharedClips(url = ANIMS_URL) {
  if (sharedPromise) return sharedPromise;
  stats.source = 'loading';

  sharedPromise = new Promise((resolve) => {
    // GLTFLoader/FileLoader can throw SYNCHRONOUSLY (a malformed URL, no global
    // fetch). An exception out of the executor rejects the promise, and the
    // `.then` below — which owns every transition out of 'loading' — would never
    // run: stats.source would read 'loading' forever and the rejected promise
    // would be cached for the life of the page. Resolve to null instead so the
    // missing-file path handles it like any other failed load.
    try {
      loader.load(url, resolve, undefined, () => { resolve(null); });
    } catch {
      resolve(null);
    }
  }).then((gltf) => {
    if (!gltf) {
      stats.source = 'missing';
      warnOnce('missing-anims', `${url} not found — characters fall back to whatever clips they ship themselves.`);
      return EMPTY_CLIPS;
    }
    try {
      const built = buildSource(gltf);
      if (!built) {
        stats.source = 'missing';
        warnOnce('anims-no-skeleton', `${url} has no bones — it must contain the shared skeleton, not just clips.`);
        return EMPTY_CLIPS;
      }
      for (const clip of gltf.animations || []) {
        if (clip) built.clips.set(clipKey(clip.name), clip);
      }
      source = built;
      stats.source = 'loaded';
      stats.clipsLoaded = built.clips.size;
      return built.clips;
    } catch (err) {
      stats.source = 'missing';
      stats.failures++;
      warnOnce('anims-parse', `failed to read ${url}:`, err);
      return EMPTY_CLIPS;
    }
  });

  return sharedPromise;
}

/** Sync peek at the loaded library. `null` until `loadSharedClips()` resolves. */
export function sharedClips() {
  return source ? source.clips : null;
}

// ---------------------------------------------------------------- target proxy

const TIER = { PASS: 0, RENAME: 1, RETARGET: 2 };

/**
 * Everything needed to convert clips onto one character, built once per slug.
 *
 * The rig here is an ISOLATED clone, never the cached template and never a live
 * instance. `retarget()` calls `skeleton.pose()` and rewrites every bone's local
 * TRS on every sampled frame; doing that to the template would leave the whole
 * roster's future clones stuck in the last frame of whatever clip converted
 * last, and doing it to a live instance would fight the mixer. `cloneSkinned`
 * shares geometry and materials, so the clone is a few hundred bytes of bones.
 */
function makeProxy(slug, root) {
  const clone = cloneSkinned(root);
  // Strip models.js's height-fit scale (models.js:103-105 puts it on the root).
  // Bone-local values are authored in metres beneath that scale, so zeroing the
  // root puts target and source in the same frame — otherwise the emitted hip
  // translation comes out divided by the fit factor.
  clone.position.set(0, 0, 0);
  clone.quaternion.identity();
  clone.scale.set(1, 1, 1);
  clone.updateMatrixWorld(true);

  const rig = rigOf(clone);
  if (!rig) return null;

  const rest = snapshotRest(rig.bones);
  // Join the two rigs on skeleton.js's canonical keys rather than on strings.
  // resolveBones() claims each node once, so `Leg_L` can't answer for both
  // LeftUpLeg and LeftLeg the way a plain name index would let it.
  const resolved = resolveBones(rig.mesh);
  // Parent membership is tested against the RESOLVED canonical bones on BOTH
  // sides, never against raw skeleton membership. `_anims.glb` ships no mesh
  // (spec §6), so its joints arrive as plain Object3D and synthesizeSkinned's
  // fallback sweeps in the armature node above Hips too. Testing the source
  // against `skeleton.bones` and the target against a real `skeleton.bones` —
  // which never contains an armature — made the hips disagree on every rig,
  // failing parentsOk for the entire roster and forcing the expensive tier.
  const inTarget = new Set(Object.values(resolved).filter(Boolean));
  const srcCanon = new Set(Object.values(source.resolved).filter(Boolean));
  const srcToTarget = new Map();
  let matched = 0;
  let exact = 0;
  let restOk = true;
  let parentsOk = true;

  for (const key of BONE_KEYS) {
    const bone = resolved[key];
    const srcBone = source.resolved[key];
    if (!bone || !srcBone) continue;

    srcToTarget.set(srcBone.name, bone.name);
    matched++;
    if (srcBone.name === bone.name) exact++;

    const ti = rig.bones.indexOf(bone);
    const si = source.index.get(srcBone);
    if (ti >= 0 && si !== undefined && !restAgrees(rest, ti, source.rest, si)) restOk = false;

    // A bone whose parent differs between rigs cannot be driven by a rotation
    // track authored on the other one, however well the names line up. Only
    // compare parents that are themselves CANONICAL bones: the root bone's
    // parent is whatever armature/scene node the exporter happened to emit, and
    // those never match across two files — comparing them would reject every
    // identical rig. Both sides must use the same test or the asymmetry alone
    // fails the check (see the srcCanon/inTarget comment above).
    const tp = bone.parent && inTarget.has(bone.parent) ? bone.parent.name : '';
    const sp = srcBone.parent && srcCanon.has(srcBone.parent) ? srcBone.parent.name : '';
    if (Boolean(tp) !== Boolean(sp)) parentsOk = false;
    else if (tp && sp && srcToTarget.get(sp) !== tp) parentsOk = false;
  }

  let tier = TIER.RETARGET;
  if (matched === 0) {
    // Nothing lines up at all. Retargeting would produce a clip with zero
    // tracks, which is strictly worse than the source clip binding by luck.
    tier = TIER.PASS;
    warnOnce(`no-bone-match:${slug}`, `'${slug}' shares no bones with the shared rig — clips are used unmodified.`);
  } else if (restOk && parentsOk) {
    tier = exact === matched ? TIER.PASS : TIER.RENAME;
  }

  // The hip track is authored in the source rig's metres. A 1.40 m Micromanager
  // driven by a 1.80 m rig's hip bob would pogo half a metre; a 3.00 m Auditor
  // would barely shift. Scaling by the rest hip-height ratio also means a clip
  // that does NOT animate the hip resolves to exactly the target's own rest hip
  // height instead of the source's.
  const targetHipsY = resolved.hips ? resolved.hips.matrixWorld.elements[13] : 0;
  let scale = 1;
  if (source.hipsY > 1e-4 && targetHipsY > 1e-4) {
    scale = Math.min(10, Math.max(0.1, targetHipsY / source.hipsY));
  }

  return {
    slug,
    clone,
    mesh: rig.mesh,
    bones: rig.bones,
    rest,
    srcToTarget,
    // Every name this skeleton actually owns, canonical or not. renameTracks
    // uses it to pass a twist/prop/hair joint through under its own name when
    // both rigs happen to spell it identically — the PASS tier would have kept
    // that track, so the RENAME tier must not silently drop it.
    nameSet: new Set(rig.bones.map((b) => b.name)),
    // The source rig's hip bone name, so renameTracks can recognise the one
    // track that carries root motion and needs `scale` applied.
    hipName: source.hips ? source.hips.name : '',
    scale,
    tier,
    matched,
    // buildRetargetOptions fills in `names` (target -> source, the direction
    // SkeletonUtils actually iterates) and `hip` — which defaults to the literal
    // string 'hip', matches nothing on a Mixamo rig, and silently disables the
    // hip translation track and `scale` along with it.
    options: buildRetargetOptions(rig.mesh, source.mesh, {
      scale,
      useFirstFramePosition: false,
      useTargetMatrix: false,
      fps: 30,   // replaced per clip; retargetClip only defaults it when undefined
    }),
  };
}

// ---------------------------------------------------------------- conversion

// `Name.property` (GLTF) or `.bones[Name].property` (SkeletonUtils output).
const TRACK_RE = /^(?:\.bones\[(.+?)\]|(.+?))\.(position|quaternion|scale)$/;

/**
 * Rewrite a clip's track node names through a bone map. This is the RENAME tier
 * and it is ~1000x cheaper than a real retarget: when two rigs differ only in
 * how the exporter spelled the bones, that is all the work there is.
 *
 * The rule is "rename what we can identify, keep everything else, drop only what
 * this rig provably cannot play". A track this tier discards is a track the PASS
 * tier would have kept, and the caller sees no difference between the two — so
 * the same clip would behave differently on two characters for no visible
 * reason.
 */
function renameTracks(clip, proxy) {
  const map = proxy.srcToTarget;
  const nameSet = proxy.nameSet;
  const tracks = [];
  for (const t of clip.tracks) {
    const m = TRACK_RE.exec(t.name);
    if (!m) {
      // Not a TRS bone track at all — a morphTargetInfluences track, a material
      // property, anything. Not ours to rename, and not ours to delete either.
      tracks.push(t.clone());
      continue;
    }
    const node = m[1] ?? m[2];
    // Canonical join first; failing that, an identically-named bone on this
    // skeleton. srcToTarget only covers the 22 BONE_KEYS, so twist bones, prop
    // bones and hair joints have no entry even when both rigs spell them the
    // same — without the fallback a rig that takes this tier over ONE misspelled
    // bone loses all of its non-canonical animation.
    const mapped = map.get(node) ?? (nameSet.has(node) ? node : null);
    if (!mapped) continue;                         // source bone this character lacks
    const copy = t.clone();
    copy.name = `${mapped}.${m[3]}`;
    // The hip translation track is authored in the SOURCE rig's metres. The
    // RETARGET tier scales it via options.scale; this tier has to do it by hand
    // or a 1.40 m character driven by a 1.80 m rig inherits the taller rig's hip
    // bob at full size. Tier selection only compares rest ORIENTATIONS, so two
    // rigs of different proportions but matching bind poses land here.
    if (m[3] === 'position' && node === proxy.hipName && proxy.scale !== 1) {
      const v = copy.values;
      for (let i = 0; i < v.length; i++) v[i] *= proxy.scale;
    }
    tracks.push(copy);
  }
  if (!tracks.length) return null;
  // Pass the real duration so the constructor doesn't recompute it, and carry
  // blendMode across — an additive clip must not silently become normal.
  return new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
}

/**
 * SkeletonUtils emits `.bones[Name].quaternion`, which PropertyBinding only
 * resolves when the mixer root itself exposes a `.skeleton`. ModelRig builds its
 * mixer over the cloned scene GROUP, so those tracks would bind to nothing and
 * log `Can not bind to bones as node does not have a skeleton`. Rewriting to the
 * plain `Name.quaternion` form makes the converted clip bind exactly like a
 * GLTF-authored one — on a Group root or a SkinnedMesh root, either way.
 *
 * Also carries `blendMode` and `duration` across from the source clip.
 * `retargetClip` returns `new AnimationClip(name, -1, tracks)`, which resets
 * blendMode to Normal and recomputes the duration from Float32 keyframe times.
 * renameTracks deliberately preserves both, so without this the two tiers would
 * disagree: an additive clip would stay additive on a cheap rig and silently
 * become a full-strength normal clip on an expensive one.
 */
function normalizeTrackNames(clip, src = null) {
  for (const t of clip.tracks) {
    const m = TRACK_RE.exec(t.name);
    if (m && m[1] !== undefined) t.name = `${m[1]}.${m[3]}`;
  }
  if (src) {
    clip.blendMode = src.blendMode;
    if (Number.isFinite(src.duration) && src.duration > 0) clip.duration = src.duration;
  }
  return clip;
}

/**
 * Sampling rate for one clip. Guards three's two divide-by-zero traps — `fps`
 * defaults to `maxKeys / duration` (Infinity on a zero-length clip, which makes
 * `new Float32Array(NaN)` or a RangeError), and `delta = duration / (numFrames -
 * 1)` is Infinity when the clip resolves to a single frame — and enforces a
 * minimum sample RATE so a sparsely-keyed source clip isn't decimated.
 * @returns {number} 0 when the clip must not be retargeted at all
 */
function safeFps(clip) {
  if (!clip || !clip.tracks || !clip.tracks.length) return 0;
  const d = clip.duration;
  if (!(d > 1e-4)) return 0;

  let keys = 2;
  for (const t of clip.tracks) {
    if (t.times && t.times.length > keys) keys = t.times.length;
  }
  let fps = keys / d;
  if (!Number.isFinite(fps) || fps <= 0) fps = 30;
  // `keys / d` is a keyframe COUNT spread over a duration, which is only a sane
  // sample RATE for a baked export. A hand-keyed 1 s idle with 3 poses would
  // resample to 3 fps, and because retargetClip samples at uniform `frame *
  // delta` times that do not line up with the source's keyframe times, every
  // intermediate pose is simply lost — lossy decimation, not a rename. So floor
  // the RATE at 30 Hz (or the frame cap, whichever is lower). Already-baked
  // 30/60 Hz clips are untouched; MAX_FRAMES still guards the other direction.
  fps = Math.max(fps, 2.5 / d, Math.min(30, MAX_FRAMES / d));
  const cap = MAX_FRAMES / d;
  if (fps > cap) fps = cap;
  return fps;
}

/** The expensive tier. Returns null on any failure so the caller can fall back. */
function fullRetarget(proxy, clip) {
  const fps = safeFps(clip);
  if (!fps) {
    warnOnce(`degenerate-clip:${clip?.name}`, `clip '${clip?.name}' has no usable duration or tracks — used unmodified.`);
    return null;
  }

  const t0 = nowMs();
  try {
    // Both rigs must start from rest: the internal mixer only writes the bones
    // the clip animates, so anything left over from the previous conversion
    // would bleed into this one.
    restoreRest(source.bones, source.rest);
    restoreRest(proxy.bones, proxy.rest);
    source.root.updateMatrixWorld(true);
    proxy.clone.updateMatrixWorld(true);

    proxy.options.fps = fps;
    const out = retargetClipRaw(proxy.mesh, source.mesh, clip, proxy.options);
    if (!out || !out.tracks.length) return null;

    stats.retargets++;
    return normalizeTrackNames(out, clip);
  } catch (err) {
    stats.failures++;
    warnOnce(`retarget-throw:${proxy.slug}`, `retargeting onto '${proxy.slug}' failed — shared clips are used unmodified:`, err);
    return null;
  } finally {
    // Leave nothing posed. The proxy is thrown away, but `source` is reused by
    // every other character on the floor.
    restoreRest(source.bones, source.rest);
    restoreRest(proxy.bones, proxy.rest);
    source.root.updateMatrixWorld(true);
    stats.retargetMs += nowMs() - t0;
  }
}

// ---------------------------------------------------------------- cache

/** slug -> (clip key -> converted clip). The 40-enemy horde converts once. */
const converted = new Map();

function cacheFor(slug) {
  let m = converted.get(slug);
  if (!m) { m = new Map(); converted.set(slug, m); stats.slugsCached = converted.size; }
  return m;
}

/**
 * @param {() => object|null} getProxy called ONLY on a cache miss — building a
 *   proxy costs a skeleton clone plus a rest-pose diff, and a warm slug must not
 *   pay for it.
 */
function adapt(slug, key, clip, getProxy) {
  const cache = cacheFor(slug);
  const hit = cache.get(key);
  if (hit) { stats.cacheHits++; return hit; }
  stats.cacheMisses++;

  const proxy = getProxy();
  let out = clip;
  if (proxy) {
    if (proxy.tier === TIER.RENAME) {
      const renamed = renameTracks(clip, proxy);
      if (renamed) { out = renamed; stats.renames++; } else stats.passthroughs++;
    } else if (proxy.tier === TIER.RETARGET) {
      const solved = fullRetarget(proxy, clip);
      if (solved) out = solved; else stats.passthroughs++;
    } else {
      stats.passthroughs++;
    }
  } else {
    stats.passthroughs++;
  }

  cache.set(key, out);
  stats.clipsCached++;
  return out;
}

// ---------------------------------------------------------------- public API

function normalizeOwn(ownClips) {
  const out = new Map();
  if (!ownClips) return out;
  if (ownClips instanceof Map) {
    for (const [k, c] of ownClips) if (c) out.set(clipKey(k), c);
    return out;
  }
  if (Array.isArray(ownClips)) {
    for (const c of ownClips) if (c) out.set(clipKey(c.name), c);
  }
  return out;
}

/**
 * The one call the model loader makes. Returns the full clip set for a character:
 * the shared library made playable on this skeleton, overlaid by anything the
 * character ships itself.
 *
 * Spec §6: a character's own signature clips override the shared set by name.
 * Those are authored on that character's own skeleton, so they are used
 * verbatim — retargeting a clip onto the rig it was authored for is a lossy
 * no-op at best.
 *
 * @param {string} slug           cache key; every instance of a slug shares one conversion
 * @param {THREE.Object3D} root   the character's loaded scene (template, not a live instance)
 * @param {Map<string, THREE.AnimationClip>|THREE.AnimationClip[]|null} ownClips
 * @returns {Promise<Map<string, THREE.AnimationClip>>} keyed by `clipKey`
 */
export async function buildClipSet(slug, root, ownClips = null) {
  const own = normalizeOwn(ownClips);
  const out = new Map();

  let library = EMPTY_CLIPS;
  try {
    library = await loadSharedClips();
  } catch (err) {
    stats.failures++;
    warnOnce('shared-load', 'shared clip library failed to load:', err);
  }

  if (source && library.size && root) {
    // Lazy: a slug whose clips are already cached never builds a proxy at all,
    // and a proxy costs a skeleton clone plus a rest-pose comparison.
    let proxy;
    let tried = false;
    const need = () => {
      if (!tried) {
        tried = true;
        try {
          proxy = makeProxy(slug, root);
          // `else` on purpose: a proxy that THREW has already been reported, and
          // reporting it a second time as "no skeleton" describes the wrong
          // cause. One failure, one line.
          if (!proxy) {
            warnOnce(`no-skeleton:${slug}`, `'${slug}' exposes no skeleton — shared clips are used unmodified.`);
          }
        } catch (err) {
          stats.failures++;
          warnOnce(`proxy-build:${slug}`, `could not prepare '${slug}' for retargeting — shared clips are used unmodified:`, err);
          proxy = null;
        }
      }
      return proxy;
    };

    for (const [key, clip] of library) {
      if (own.has(key)) continue;                  // §6: the character's own clip wins
      out.set(key, adapt(slug, key, clip, need));
    }
  } else {
    for (const [key, clip] of library) if (!own.has(key)) out.set(key, clip);
  }

  for (const [key, clip] of own) {
    if (library.has(key)) stats.native++;          // this one shadowed a shared clip
    out.set(key, clip);
  }
  return out;
}

/**
 * Convert a single shared clip for a character. Same caching and same fallbacks
 * as `buildClipSet`; useful for a clip pulled in after the initial load.
 * Requires `loadSharedClips()` to have resolved — returns `clip` untouched
 * otherwise, like every other failure path here.
 *
 * @returns {THREE.AnimationClip} never null
 */
export function retargetClipFor(slug, root, clip, key = null) {
  if (!clip) return clip;
  const k = key ?? clipKey(clip.name);
  const cache = converted.get(slug);
  const hit = cache && cache.get(k);
  if (hit) { stats.cacheHits++; return hit; }
  if (!source || !root) { stats.passthroughs++; return clip; }

  return adapt(slug, k, clip, () => {
    try {
      return makeProxy(slug, root);
    } catch (err) {
      stats.failures++;
      warnOnce(`proxy-build:${slug}`, `could not prepare '${slug}' for retargeting:`, err);
      return null;
    }
  });
}

/** Drop cached conversions. Omit `slug` to clear everything (floor teardown). */
export function clearRetargetCache(slug = null) {
  if (slug === null) converted.clear();
  else converted.delete(slug);
  stats.slugsCached = converted.size;
  let n = 0;
  for (const m of converted.values()) n += m.size;
  stats.clipsCached = n;
}

/**
 * Tuning hooks for the two thresholds that decide how much work happens.
 *
 * `restToleranceDeg` is the interesting one: raise it and rigs with slightly
 * different bind poses take the cheap RENAME path instead of a full solve;
 * lower it and more of the roster gets properly retargeted. Bone naming is not
 * here — skeleton.js owns that vocabulary.
 *
 * @param {{restToleranceDeg?: number, maxFrames?: number}} opts
 */
export function configureRetarget(opts = {}) {
  if (Number.isFinite(opts.restToleranceDeg)) {
    REST_DOT = Math.cos((Math.max(0, opts.restToleranceDeg) * Math.PI) / 180 / 2);
  }
  if (Number.isFinite(opts.maxFrames)) MAX_FRAMES = Math.max(2, Math.floor(opts.maxFrames));
  clearRetargetCache();   // anything already converted used the old rules
}
