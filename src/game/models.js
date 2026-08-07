// ============ GLTF character models (Meshy pipeline) ============
// Loads the rigged GLBs produced by scripts/meshy.mjs and hands back rigs that
// are drop-in compatible with the procedural `makePerson()` shape:
//   { root, parts, scale }  — plus `parts.rig` when the rig is skeletal.
//
// Every call site keeps working if a model is missing: `makePerson({ model })`
// falls back to boxes. Silhouettes are the ship blocker, not perfection
// (docs/MESHY_ASSET_PACK.md §Integration pipeline, step 5).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

const loader = new GLTFLoader();

let INDEX = null;                  // parsed public/models/models.json
const cache = new Map();           // slug -> { scene, clips: Map, height, sockets }
const pending = new Map();         // slug -> Promise (dedupe concurrent loads)
const liveRigs = new Set();        // live ModelRigs, ticked by updateMixers

export const MODEL_STATE = { IDLE: 'idle', RUN: 'run', ATTACK: 'attack_a', HIT: 'hit', DEATH: 'death' };

// ---------- index ----------
export async function initModels() {
  if (INDEX) return INDEX;
  try {
    const res = await fetch('/models/models.json', { cache: 'no-cache' });
    INDEX = res.ok ? await res.json() : { assets: {} };
  } catch {
    INDEX = { assets: {} };        // no pack generated yet — procedural everywhere
  }
  return INDEX;
}

export function modelIndex() { return INDEX?.assets ?? {}; }
export function hasModel(slug) { return Boolean(slug && cache.has(slug)); }
export function isDeclared(slug) { return Boolean(slug && INDEX?.assets?.[slug]); }

// ---------- material normalization ----------
// Meshy ships PBR-ish materials; the game is flat-shaded low-poly. Clamp them so
// a generated asset can never out-shine the procedural props next to it.
function normalizeMaterials(root) {
  root.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    o.castShadow = true;
    o.receiveShadow = false;
    o.frustumCulled = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      m.flatShading = true;
      if ('metalness' in m) m.metalness = Math.min(m.metalness ?? 0, 0.08);
      if ('roughness' in m) m.roughness = Math.max(m.roughness ?? 1, 0.82);
      if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
      m.normalMap = null;          // facets must read as facets, not fake detail
      m.side = THREE.FrontSide;
      m.needsUpdate = true;
    }
  });
}

// ---------- skeleton probing ----------
// Meshy's auto-rig bone names are not contractual, so match by pattern rather
// than hard-coding one naming scheme.
const BONE_PATTERNS = {
  head:   [/head$/i, /head[_.]?(01|1)?$/i, /neck/i],
  handR:  [/right[_.]?hand$/i, /hand[_.]?r$/i, /r[_.]?hand$/i, /mixamorig:?RightHand$/i],
  handL:  [/left[_.]?hand$/i, /hand[_.]?l$/i, /l[_.]?hand$/i, /mixamorig:?LeftHand$/i],
  spine:  [/spine[_.]?(02|2)?$/i, /chest/i, /upper[_.]?body/i, /torso/i],
  hips:   [/hips?$/i, /pelvis/i, /root$/i],
};

function findBones(root) {
  const bones = [];
  root.traverse((o) => { if (o.isBone) bones.push(o); });
  const found = {};
  for (const [key, patterns] of Object.entries(BONE_PATTERNS)) {
    for (const re of patterns) {
      const hit = bones.find((b) => re.test(b.name));
      if (hit) { found[key] = hit; break; }
    }
  }
  return { bones, found };
}

// ---------- loading ----------
function loadGLB(url) {
  return new Promise((resolve, reject) => { loader.load(url, resolve, undefined, reject); });
}

async function loadOne(slug) {
  const decl = INDEX?.assets?.[slug];
  if (!decl?.model) return null;

  const gltf = await loadGLB(decl.model);
  const scene = gltf.scene;
  normalizeMaterials(scene);

  // Normalize authored scale to the design height so a 2.6 m Stakeholder really
  // reads as 2.6 m next to a 1.8 m Intern.
  const bbox = new THREE.Box3().setFromObject(scene);
  const rawH = Math.max(1e-3, bbox.max.y - bbox.min.y);
  const target = decl.height || rawH;
  const fit = target / rawH;
  scene.position.y -= bbox.min.y * fit;   // plant feet on y = 0
  scene.scale.setScalar(fit);

  // Meshy's rigged GLB carries a rest-pose stub ("Armature|clip0|baselayer").
  // It is not a state the game ever plays, so keep it out of the action map.
  const RIG_STUB = /baselayer|clip0/i;
  const clips = new Map();
  for (const c of gltf.animations || []) {
    if (RIG_STUB.test(c.name)) continue;
    clips.set(c.name.toLowerCase(), c);
  }

  // Per-clip GLBs from the animation API: keep the AnimationClip, drop the mesh.
  const animUrls = decl.anims || {};
  await Promise.all(Object.entries(animUrls).map(async ([name, url]) => {
    try {
      const a = await loadGLB(url);
      const clip = a.animations?.[0];
      if (clip) { clip.name = name; clips.set(name, clip); }
    } catch (err) {
      console.warn(`[models] ${slug}: animation '${name}' failed`, err);
    }
  }));

  const rec = { slug, scene, clips, height: target, decl };
  cache.set(slug, rec);
  return rec;
}

export function preloadModels(slugs) {
  return Promise.all(slugs.filter(Boolean).map((slug) => {
    if (cache.has(slug)) return cache.get(slug);
    if (pending.has(slug)) return pending.get(slug);
    const p = loadOne(slug)
      .catch((err) => { console.warn(`[models] ${slug} failed to load — using procedural`, err); return null; })
      .finally(() => pending.delete(slug));
    pending.set(slug, p);
    return p;
  }));
}

// Load every model the pack declares. Called once from the boot sequence.
export async function preloadAll() {
  await initModels();
  return preloadModels(Object.keys(modelIndex()));
}

// ---------- rig instance ----------
class ModelRig {
  constructor(rec) {
    this.slug = rec.slug;
    this.root = cloneSkinned(rec.scene);
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = new Map();
    for (const [name, clip] of rec.clips) {
      const action = this.mixer.clipAction(clip);
      if (name === 'death') { action.loop = THREE.LoopOnce; action.clampWhenFinished = true; }
      if (name === 'hit' || name.startsWith('attack')) action.loop = THREE.LoopOnce;
      this.actions.set(name, action);
    }
    this.current = null;
    this.locked = 0;               // seconds a one-shot owns the mixer
    liveRigs.add(this);
    this.play('idle', 0);
  }

  has(name) { return this.actions.has(name); }

  // Crossfade into a looping state. One-shots (attack/hit/death) hold the rig
  // for their duration via `lock`, then fall back to whatever is asked next.
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

  // Called by animateWalk/poseIdle so gameplay code stays unaware of skinning.
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

// Ticked once per frame from the game loop; honours game.timeScale via `dt`.
export function updateMixers(dt) {
  for (const rig of liveRigs) rig.update(dt);
}

// Entities are removed from the scene without a teardown hook, so reap rigs
// whose root has been detached rather than leaking mixers across runs.
export function reapRigs() {
  for (const rig of liveRigs) {
    let node = rig.root, attached = false;
    while (node) { if (node.isScene) { attached = true; break; } node = node.parent; }
    if (!attached) rig.dispose();
  }
}

// ---------- static props ----------
// Non-skinned assets (elevators, thrones, set dressing). Returns null when the
// model isn't loaded so callers keep their procedural version.
export function makeModelProp(slug, { scale = 1 } = {}) {
  const rec = cache.get(slug);
  if (!rec) return null;
  const g = rec.scene.clone(true);
  if (scale !== 1) g.scale.multiplyScalar(scale);
  return g;
}

// ---------- makePerson-compatible factory ----------
// Returns null when the model isn't available, so callers fall through to boxes.
export function makeModelPerson(slug, opts = {}) {
  const rec = cache.get(slug);
  if (!rec) return null;

  const rig = new ModelRig(rec);
  const root = new THREE.Group();
  root.add(rig.root);

  const { found } = findBones(rig.root);

  // Sockets: real children of real bones, so held props inherit the animation.
  const socket = (bone, fallbackY) => {
    const g = new THREE.Group();
    if (bone) {
      bone.add(g);
      // Bone space is authored-scale; undo the fit so props keep world size.
      const s = rig.root.scale.x || 1;
      g.scale.setScalar(1 / s);
    } else {
      g.position.y = fallbackY;
      root.add(g);
    }
    return g;
  };

  const parts = {
    // Live sockets — weapons, muzzle positions, head pitch.
    grip: socket(found.handR, 1.05),
    gripL: socket(found.handL, 1.05),
    head: socket(found.head, 1.62),
    // Detached dummies: legacy limb-rotation writes land here harmlessly while
    // the AnimationMixer owns the actual skeleton.
    torso: new THREE.Group(),
    armL: new THREE.Group(),
    armR: new THREE.Group(),
    legL: new THREE.Group(),
    legR: new THREE.Group(),
    rig,
    bones: found,
  };

  if (opts.scale && opts.scale !== 1) root.scale.setScalar(opts.scale);

  return { root, parts, scale: opts.scale ?? 1, rig };
}
