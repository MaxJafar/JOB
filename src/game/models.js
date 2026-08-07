// ============ hand-authored character models (Blender → GLB) ============
// Loads the skinned GLBs described by docs/CHARACTER_ART_SPEC.md and returns rigs
// that are drop-in compatible with the procedural `makePerson()` shape:
//   { root, parts, scale }  — plus `parts.rig` when the rig is skeletal.
//
// Layout on disk:
//   public/models/characters/<slug>.glb   mesh + skeleton, no animation
//   public/models/characters/_anims.glb   skeleton + every clip, no mesh
//
// Because every character shares one skeleton (spec §3), the clip set is loaded
// ONCE and reused by the whole roster.
//
// Nothing here is required for the game to run: a missing file falls back to the
// procedural boxes in characters.js, so this is inert until real art lands.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

const BASE = '/models/characters';
const loader = new GLTFLoader();

const cache = new Map();      // slug -> { scene, clips: Map, height }
const pending = new Map();    // slug -> Promise (dedupe concurrent loads)
const liveRigs = new Set();   // ticked by updateMixers
let sharedClips = null;       // Map<name, AnimationClip> from _anims.glb
let sharedClipsPromise = null;

// ---------- helpers ----------
const stripPrefix = (n) => n.replace(/^mixamorig:?/i, '');

function loadGLB(url) {
  return new Promise((resolve, reject) => { loader.load(url, resolve, undefined, reject); });
}

// Spec §5: flat colour only. Enforce it on load so a stray smooth-shaded or
// PBR-mapped material can't quietly break the look of the whole scene.
function normalizeMaterials(root) {
  root.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    o.castShadow = true;
    o.receiveShadow = false;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (!m) continue;
      m.flatShading = true;
      if ('metalness' in m) m.metalness = 0;
      if ('roughness' in m) m.roughness = 1;
      m.normalMap = null;
      m.aoMap = null;
      if (m.map) {
        // Palette atlas: swatches must not blend into each other.
        m.map.magFilter = THREE.NearestFilter;
        m.map.minFilter = THREE.NearestFilter;
        m.map.generateMipmaps = false;
        m.map.colorSpace = THREE.SRGBColorSpace;
      }
      m.needsUpdate = true;
    }
  });
}

// Sockets are empty bones (spec §4); fall back to the parent bone when absent so
// a partial delivery still attaches weapons, just less precisely.
const SOCKETS = {
  grip:  ['socket_hand_r', 'righthand'],
  gripL: ['socket_hand_l', 'lefthand'],
  head:  ['socket_head', 'head'],
  back:  ['socket_back', 'spine2'],
  chest: ['socket_chest', 'spine2'],
};

function indexBones(root) {
  const byName = new Map();
  root.traverse((o) => {
    if (o.isBone || o.type === 'Object3D') byName.set(stripPrefix(o.name).toLowerCase(), o);
  });
  return byName;
}

// ---------- loading ----------
async function loadSharedClips() {
  if (sharedClips) return sharedClips;
  if (sharedClipsPromise) return sharedClipsPromise;
  sharedClipsPromise = loadGLB(`${BASE}/_anims.glb`)
    .then((gltf) => {
      sharedClips = new Map();
      for (const c of gltf.animations || []) sharedClips.set(stripPrefix(c.name).toLowerCase(), c);
      return sharedClips;
    })
    .catch(() => { sharedClips = new Map(); return sharedClips; });  // no shared set yet
  return sharedClipsPromise;
}

async function loadOne(slug, height) {
  const gltf = await loadGLB(`${BASE}/${slug}.glb`);
  const scene = gltf.scene;
  normalizeMaterials(scene);

  // Spec §1: feet at y=0 and an exact height. Trust the file, but correct it —
  // a model that ships 5% short shouldn't silently change how big it reads.
  const bbox = new THREE.Box3().setFromObject(scene);
  const rawH = Math.max(1e-3, bbox.max.y - bbox.min.y);
  if (height) {
    const fit = height / rawH;
    scene.scale.multiplyScalar(fit);
    scene.position.y -= bbox.min.y * fit;
  } else {
    scene.position.y -= bbox.min.y;
  }

  // Shared clips first, then anything the character ships itself (which wins).
  const clips = new Map(await loadSharedClips());
  for (const c of gltf.animations || []) clips.set(stripPrefix(c.name).toLowerCase(), c);

  const rec = { slug, scene, clips, height: height || rawH };
  cache.set(slug, rec);
  return rec;
}

export function preloadModels(entries) {
  return Promise.all(entries.filter(Boolean).map(({ slug, height }) => {
    if (cache.has(slug)) return cache.get(slug);
    if (pending.has(slug)) return pending.get(slug);
    const p = loadOne(slug, height)
      .catch(() => null)   // not delivered yet — characters.js uses the box rig
      .finally(() => pending.delete(slug));
    pending.set(slug, p);
    return p;
  }));
}

export function hasModel(slug) { return Boolean(slug && cache.has(slug)); }
export function loadedModels() { return [...cache.keys()]; }

// ---------- rig instance ----------
const ONE_SHOT = /^(attack_|shoot|dash|jump|hit|death)/;

class ModelRig {
  constructor(rec) {
    this.slug = rec.slug;
    this.root = cloneSkinned(rec.scene);
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = new Map();
    for (const [name, clip] of rec.clips) {
      const action = this.mixer.clipAction(clip);
      if (ONE_SHOT.test(name)) action.loop = THREE.LoopOnce;
      if (name === 'death') action.clampWhenFinished = true;
      this.actions.set(name, action);
    }
    this.current = null;
    this.currentName = null;
    this.locked = 0;             // seconds a one-shot owns the rig
    liveRigs.add(this);
    this.play('idle', 0);
  }

  has(name) { return this.actions.has(name); }

  play(name, fade = 0.12, { lock = 0, restart = false } = {}) {
    const next = this.actions.get(name);
    if (!next) return false;
    if (this.current === next && !restart) return true;
    next.reset().setEffectiveWeight(1).play();
    if (this.current && this.current !== next) this.current.crossFadeTo(next, fade, false);
    else if (this.current !== next) next.fadeIn(fade);
    this.current = next;
    this.currentName = name;
    this.locked = lock;
    return true;
  }

  // Driven by animateWalk/poseIdle so gameplay code stays unaware of skinning.
  setLocomotion(speedNorm) {
    if (this.locked > 0) return;
    this.play(speedNorm > 0.12 ? 'run' : 'idle', 0.16);
  }

  oneShot(name, duration = 0.5) {
    if (!this.has(name)) return false;
    return this.play(name, 0.06, { lock: duration, restart: true });
  }

  update(dt) {
    if (this.locked > 0) this.locked -= dt;
    this.mixer.update(dt);
  }

  dispose() {
    liveRigs.delete(this);
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }
}

// Ticked once per frame from the game loop, so rigs share hit-stop / slow-mo.
export function updateMixers(dt) {
  for (const rig of liveRigs) rig.update(dt);
}

// Entities leave the scene without a teardown hook; reap detached rigs so
// mixers don't leak across runs.
export function reapRigs() {
  for (const rig of liveRigs) {
    let node = rig.root, attached = false;
    while (node) { if (node.isScene) { attached = true; break; } node = node.parent; }
    if (!attached) rig.dispose();
  }
}

// ---------- makePerson-compatible factory ----------
// Returns null when the model isn't loaded, so callers fall through to boxes.
export function makeModelPerson(slug, opts = {}) {
  const rec = cache.get(slug);
  if (!rec) return null;

  const rig = new ModelRig(rec);
  const root = new THREE.Group();
  root.add(rig.root);

  const bones = indexBones(rig.root);
  const invScale = 1 / (rig.root.scale.x || 1);
  const attach = (names, fallbackY) => {
    const g = new THREE.Group();
    const bone = names.map((n) => bones.get(n)).find(Boolean);
    if (bone) { bone.add(g); g.scale.setScalar(invScale); }  // undo the height fit
    else { g.position.y = fallbackY; root.add(g); }
    return g;
  };

  const parts = {
    grip:  attach(SOCKETS.grip, 1.05),
    gripL: attach(SOCKETS.gripL, 1.05),
    head:  attach(SOCKETS.head, 1.62),
    back:  attach(SOCKETS.back, 1.3),
    chest: attach(SOCKETS.chest, 1.3),
    // Detached dummies: legacy limb-rotation writes land here harmlessly while
    // the AnimationMixer owns the real skeleton.
    torso: new THREE.Group(),
    armL: new THREE.Group(), armR: new THREE.Group(),
    legL: new THREE.Group(), legR: new THREE.Group(),
    rig,
    bones,
  };

  if (opts.scale && opts.scale !== 1) root.scale.setScalar(opts.scale);
  return { root, parts, scale: opts.scale ?? 1, rig };
}
