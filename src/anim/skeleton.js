// ============ JOB_HUMANOID_V1 — the shared skeleton standard ============
// docs/CHARACTER_ART_SPEC.md §3 promises one skeleton for the whole roster, which
// is what lets a single `_anims.glb` drive every character. That promise is only
// worth anything if something checks it, and checks it the SAME way everywhere —
// otherwise the CLI passes a model that the loader then silently fails to bind.
// So the standard lives here, once, as data:
//
//   * the canonical 22-bone hierarchy (parenting included)
//   * a name normaliser that survives the round trip Blender -> FBX -> Mixamo ->
//     GLTF, where prefixes, separators and casing all change under you
//   * a resolver that hands back a flat { hips, spine, ..., handR } map
//   * socket resolution that degrades DOWN THE BONE CHAIN instead of off it
//   * validate(), shaped for both `npm run model:check` and an in-game command
//   * the target->source name map SkeletonUtils.retarget needs
//
// This module deliberately imports NOTHING — not even three. Everything it touches
// is duck-typed (`.isBone`, `.traverse`, `.parent`, `.name`), so the Node-side
// asset checker CAN import it and validate a .glb without standing up a renderer:
//
//   validate({ names: skin.listJoints().map((j) => j.getName()) })
//
// It does not do so yet. As of this writing scripts/check-model.mjs maintains its
// own REQUIRED_BONES list, its own SOCKETS list and a much weaker normaliser
// (`n.replace(/^mixamorig:?/i, '').toLowerCase()`, no separator stripping), so the
// two ARE currently drifted: an Unreal-named rig (`pelvis`, `spine_01`, ...) is a
// hard exit-1 error there and a clean 22/22 here, and `Left_Up_Leg` resolves here
// and fails there. Migrating the CLI onto validate()/summarize() and deleting its
// duplicates is the fix; until that lands, treat the CLI verdict and this module's
// verdict as two independent opinions.
//
// Nothing here throws. A model with no skeleton at all returns a full `missing`
// list and every bone null; the caller falls back to the procedural boxes.
//
// Resolution is load-time work. Nothing in this file belongs in a frame loop.

/** Bump this when the bone list changes; delivered art is versioned against it. */
export const SKELETON_VERSION = 'JOB_HUMANOID_V1';

// The spec prose says "21 bones"; the hierarchy printed directly beneath it lists
// 22, and scripts/check-model.mjs requires all 22. Count the tree, not the prose.
//
// Columns: key · spec name · parent key · side · sideless base · alternate bases.
//
// The alternates are what other rigging tools call the same joint (Unreal, Unity
// humanoid, Rigify, 3ds Max Biped). They exist so a model that came back from the
// wrong pipeline still RESOLVES — but resolving is not the same as animating:
// three binds animation tracks by exact node name, so an alias-named rig needs a
// rename or a retarget pass. validate() says so loudly.
const RAW_BONES = [
  ['hips', 'Hips', null, '', 'Hips', ['Pelvis', 'Hip']],
  // The two numbering conventions run off by one and must not be mixed: Unreal's
  // `spine_01` is the FIRST spine bone, while Blender's `spine.001` is the one
  // AFTER `spine`. Line them up wrong and the whole torso shifts a joint.
  ['spine', 'Spine', 'hips', '', 'Spine', ['Spine01', 'Torso']],
  ['spine1', 'Spine1', 'spine', '', 'Spine1', ['Spine02', 'Spine001', 'Chest']],
  ['spine2', 'Spine2', 'spine1', '', 'Spine2', ['Spine03', 'Spine002', 'UpperChest', 'Chest2']],
  ['neck', 'Neck', 'spine2', '', 'Neck', ['Neck01', 'Neck001', 'Neck1']],
  ['head', 'Head', 'neck', '', 'Head', ['Head01']],
  ['shoulderL', 'LeftShoulder', 'spine2', 'L', 'Shoulder', ['Clavicle', 'Collar']],
  ['armL', 'LeftArm', 'shoulderL', 'L', 'Arm', ['UpperArm', 'UpArm', 'Arm1']],
  ['foreArmL', 'LeftForeArm', 'armL', 'L', 'ForeArm', ['LowerArm', 'Elbow', 'Arm2']],
  ['handL', 'LeftHand', 'foreArmL', 'L', 'Hand', ['Wrist']],
  ['shoulderR', 'RightShoulder', 'spine2', 'R', 'Shoulder', ['Clavicle', 'Collar']],
  ['armR', 'RightArm', 'shoulderR', 'R', 'Arm', ['UpperArm', 'UpArm', 'Arm1']],
  ['foreArmR', 'RightForeArm', 'armR', 'R', 'ForeArm', ['LowerArm', 'Elbow', 'Arm2']],
  ['handR', 'RightHand', 'foreArmR', 'R', 'Hand', ['Wrist']],
  ['upLegL', 'LeftUpLeg', 'hips', 'L', 'UpLeg', ['Thigh', 'UpperLeg', 'Leg1']],
  ['legL', 'LeftLeg', 'upLegL', 'L', 'Leg', ['Calf', 'Shin', 'LowerLeg', 'Knee', 'Leg2']],
  ['footL', 'LeftFoot', 'legL', 'L', 'Foot', ['Ankle']],
  ['toeBaseL', 'LeftToeBase', 'footL', 'L', 'ToeBase', ['Toe', 'Toes', 'Ball', 'Toe1']],
  ['upLegR', 'RightUpLeg', 'hips', 'R', 'UpLeg', ['Thigh', 'UpperLeg', 'Leg1']],
  ['legR', 'RightLeg', 'upLegR', 'R', 'Leg', ['Calf', 'Shin', 'LowerLeg', 'Knee', 'Leg2']],
  ['footR', 'RightFoot', 'legR', 'R', 'Foot', ['Ankle']],
  ['toeBaseR', 'RightToeBase', 'footR', 'R', 'ToeBase', ['Toe', 'Toes', 'Ball', 'Toe1']],
];

// Spec §4. `parent` is the canonical bone key the socket hangs off, and also the
// first rung of the fallback ladder when the socket empty wasn't exported.
// Keys are neutral (handR / handL / head / back / chest); game code maps those to
// its own slot names — models.js calls socket handR "grip" and handL "gripL".
const RAW_SOCKETS = [
  ['handR', 'socket_hand_R', 'handR', ['socket_r_hand', 'socket_hand_right', 'hand_socket_R', 'weapon_R']],
  ['handL', 'socket_hand_L', 'handL', ['socket_l_hand', 'socket_hand_left', 'hand_socket_L', 'weapon_L']],
  ['head', 'socket_head', 'head', ['head_socket', 'socket_hat']],
  ['back', 'socket_back', 'spine2', ['back_socket', 'socket_spine_back']],
  ['chest', 'socket_chest', 'spine2', ['chest_socket']],
];

// ---------------------------------------------------------------- name matching

// Mixamo's prefix arrives in two spellings and you get no say in which: FBX keeps
// `mixamorig:Hips`, but GLTFLoader runs every node name through
// PropertyBinding.sanitizeNodeName, which STRIPS ':' outright — so the same rig
// exported to GLB shows up as `mixamorigHips`. Matching only the colon form is the
// single most common reason a delivered rig "has no bones".
const RIG_PREFIX = /^mixamorig[\s:_.|-]*/i;

// Namespace prefixes from other pipelines. A separator is REQUIRED here so that a
// bone legitimately starting with these letters (`Belly`, `Ribcage`) isn't eaten.
const NAMESPACE_PREFIX =
  /^(?:def|deform|deformer|bip0*1|biped|armature|rig|skel|skeleton|jnt|joint|b)[\s:_.|-]+/i;

// Everything a DCC tool might use to separate words, including the '.' Blender
// puts in `spine.001` and the '|' Maya puts in namespaces.
const SEPARATORS = /[\s_.:|/\\()-]+/g;

// Non-global on purpose: a /g regex carries lastIndex between .test() calls and
// would start skipping matches inside the resolver's loop.
const DIGIT_TAIL = /^\d+$/;

/**
 * Collapse any spelling of a bone name to a comparable key: prefix stripped,
 * separators removed, lowercased. `mixamorig:LeftUpLeg`, `mixamorigLeftUpLeg`,
 * `Left_Up_Leg` and `leftupleg` all become `leftupleg`.
 * @param {string} name
 * @returns {string} '' for anything unusable — never throws on null/undefined.
 */
export function normalizeBoneName(name) {
  if (typeof name !== 'string' || !name) return '';
  // Strip REPEATEDLY and namespace-first, because the prefixes stack and a single
  // pass of each in the wrong order does not compose: `Armature|mixamorigHips` and
  // `rig_mixamorigHead` both come out of real Maya/FBX -> glTF pipelines (GLTFLoader
  // strips [ ] . : / but NOT '|'), and stripping the rig prefix first leaves the
  // namespace in front of it where the namespace regex can no longer see it.
  let s = name.trim();
  for (let i = 0; i < 4; i++) {
    const next = s.replace(NAMESPACE_PREFIX, '').replace(RIG_PREFIX, '');
    if (next === s) break;
    s = next;
  }
  return s.toLowerCase().replace(SEPARATORS, '');
}

/** Side markers land in four places depending on the tool; accept all of them. */
function expandSpellings(base, alts, side) {
  const out = [];
  const add = (s) => {
    if (s && !out.includes(s)) out.push(s);
  };
  for (const raw of [base, ...alts]) {
    const b = normalizeBoneName(raw);
    if (!b) continue;
    if (!side) {
      add(b);
      continue;
    }
    const long = side === 'L' ? 'left' : 'right';
    const short = side.toLowerCase();
    add(long + b); // LeftArm
    add(b + short); // Arm_L
    add(short + b); // L_Arm
    add(b + long); // Arm_Left
  }
  return out;
}

// Frozen all the way down, entries and their `alts` included: these tables are
// process-wide singletons and a caller who pushed onto one would silently change
// bone resolution for every other consumer.
/** @type {ReadonlyArray<{key,name,parent,side,base,alts,norm,spellings}>} */
export const BONES = Object.freeze(
  RAW_BONES.map(([key, name, parent, side, base, alts]) =>
    Object.freeze({
      key,
      name,
      parent,
      side,
      base,
      alts: Object.freeze(alts),
      norm: normalizeBoneName(name),
      spellings: Object.freeze(expandSpellings(base, alts, side)),
    }),
  ),
);

/** @type {ReadonlyArray<{key,name,parent,spellings}>} */
export const SOCKETS = Object.freeze(
  RAW_SOCKETS.map(([key, name, parent, alts]) =>
    Object.freeze({
      key,
      name,
      parent,
      spellings: Object.freeze([name, ...alts].map(normalizeBoneName).filter(Boolean)),
    }),
  ),
);

export const BONE_KEYS = Object.freeze(BONES.map((b) => b.key));
export const BONE_NAMES = Object.freeze(BONES.map((b) => b.name));
export const SOCKET_KEYS = Object.freeze(SOCKETS.map((s) => s.key));

export const BONE_BY_KEY = Object.freeze(Object.fromEntries(BONES.map((b) => [b.key, b])));
export const SOCKET_BY_KEY = Object.freeze(Object.fromEntries(SOCKETS.map((s) => [s.key, s])));

// spelling -> canonical key. First registration wins, and BONES is walked in
// hierarchy order, so `Chest` binds to Spine1 rather than to Spine2's `Chest2`
// alias. Only the sideless aliases can ever collide: expandSpellings never emits a
// sideless spelling for a sided bone, so bare `Shoulder`, `Arm` or `UpperArm`
// resolve to nothing at all by design — a side marker is mandatory on those.
const KEY_BY_SPELLING = new Map();
for (const def of BONES) {
  for (const sp of def.spellings) if (!KEY_BY_SPELLING.has(sp)) KEY_BY_SPELLING.set(sp, def.key);
}

/**
 * Best-effort single-name lookup. Has no claiming, so on a rig where two joints
 * share an alias it can answer for both — resolveBones() is the authority.
 * @param {string} name
 * @returns {string|null} canonical bone key
 */
export function canonicalKeyFor(name) {
  return KEY_BY_SPELLING.get(normalizeBoneName(name)) ?? null;
}

// -------------------------------------------------------------- node collection

/**
 * Flatten anything that might carry a skeleton into `{ name, node, norm }` rows.
 * Accepts an Object3D root, a SkinnedMesh, a Skeleton, an Array<Bone>, an array of
 * strings, or `{ names: string[] }` (the shape the Node asset checker passes).
 */
function collect(source) {
  const entries = [];
  const seenNodes = new Set();
  const seenNames = new Set();

  const addNode = (node) => {
    if (!node || seenNodes.has(node)) return;
    // Bones and empties only. Letting meshes and groups in would flood `extra`
    // with body panels and make the "non-standard bone" warning useless.
    if (!node.isBone && node.type !== 'Object3D') return;
    seenNodes.add(node);
    entries.push({ name: node.name || '', node, norm: normalizeBoneName(node.name || '') });
  };

  const addName = (name) => {
    if (typeof name !== 'string' || seenNames.has(name)) return;
    seenNames.add(name);
    entries.push({ name, node: null, norm: normalizeBoneName(name) });
  };

  const visit = (src, depth) => {
    if (src == null || depth > 4) return;
    if (typeof src === 'string') {
      addName(src);
      return;
    }
    if (Array.isArray(src)) {
      for (const s of src) visit(s, depth + 1);
      return;
    }
    if (Array.isArray(src.names)) {
      for (const s of src.names) visit(s, depth + 1);
      return;
    }
    if (src.isObject3D && typeof src.traverse === 'function') {
      src.traverse((o) => {
        addNode(o);
        // In a GLTF the joints are usually siblings of the SkinnedMesh, not its
        // children — traversing the mesh alone finds an empty skeleton. Fold the
        // skin's own bone list in, and traverse each bone so socket empties
        // (which are children of bones but not skinning joints) are picked up.
        if (o.isSkinnedMesh && o.skeleton) {
          for (const b of o.skeleton.bones || []) if (b && b.traverse) b.traverse(addNode);
        }
      });
      return;
    }
    if (Array.isArray(src.bones)) {
      for (const b of src.bones) {
        if (b && b.traverse) b.traverse(addNode);
        else addNode(b);
      }
    }
  };

  visit(source, 0);

  const byNorm = new Map();
  const dupes = [];
  for (const e of entries) {
    if (!e.norm) continue;
    // GLTFLoader de-duplicates identical node names by appending _1, _2..., and
    // two different spellings can normalise together (`Left_Arm` + `LeftArm`).
    // First in traversal order wins — that is the one the exporter wrote first —
    // and the loser is reported so nobody debugs a bone that binds to its twin.
    if (byNorm.has(e.norm)) dupes.push(e);
    else byNorm.set(e.norm, e);
  }
  return { entries, byNorm, dupes };
}

/** Accept a raw source or an already-built index (including indexNodes()' Map). */
function asIndex(source) {
  if (source instanceof Map) {
    const byNorm = new Map();
    for (const [norm, v] of source) {
      byNorm.set(norm, v && v.norm !== undefined ? v : { name: v?.name ?? norm, node: v ?? null, norm });
    }
    return { entries: [...byNorm.values()], byNorm, dupes: [] };
  }
  return collect(source);
}

/**
 * Map of normalised name -> node, covering bones and empties.
 *
 * Same SHAPE as the private index in game/models.js but not the same KEYS: that
 * one only lowercases and keeps separators (`socket_hand_r`), this one strips them
 * (`sockethandr`). Swapping it in without also moving the lookups over to
 * resolveBones()/resolveSockets() finds nothing and every prop lands on the
 * fallback. Pass the result back into resolveBones() to avoid a second traversal.
 * @returns {Map<string, object>}
 */
export function indexNodes(source) {
  const out = new Map();
  for (const [norm, entry] of asIndex(source).byNorm) out.set(norm, entry.node);
  return out;
}

// ----------------------------------------------------------- bone resolution

function resolveInto(index) {
  const bones = {};
  const how = {};
  const claimed = new Set();
  for (const def of BONES) {
    bones[def.key] = null;
    how[def.key] = null;
  }

  // Claiming is what stops one joint answering for two slots. A rig with a single
  // `Leg_L` must not become both LeftUpLeg and LeftLeg — the second lookup finds
  // the node already taken and reports LeftLeg missing, which is the truth.
  const take = (def, entry, mode) => {
    if (!entry || claimed.has(entry)) return false;
    claimed.add(entry);
    bones[def.key] = entry.node ?? null;
    how[def.key] = { mode, name: entry.name };
    return true;
  };

  // Pass 1 — the spec spelling, for every bone, before any alias is considered.
  // Ordering matters: a rig that is correct must never be matched by an alias.
  for (const def of BONES) take(def, index.byNorm.get(def.norm), 'exact');

  // Pass 2 — alternate names from other rigging tools.
  for (const def of BONES) {
    if (how[def.key]) continue;
    for (const sp of def.spellings) if (take(def, index.byNorm.get(sp), 'alias')) break;
  }

  // Pass 3 — GLTFLoader's duplicate suffix (`Hips` + `Hips_1` -> hips, hips1).
  // Matched by canonical-prefix + digits rather than by stripping trailing digits,
  // because stripping would turn `Spine1` into `Spine` and hand Spine1's node to
  // Spine. The prefix has to be the LONGEST one that fits for the same reason:
  // `Spine1_1` normalises to `spine11`, which `spine` also prefixes, and whichever
  // bone is tested first would otherwise win. Only the best candidate is offered,
  // so a suffixed duplicate never lands on a neighbouring joint.
  for (const [norm, entry] of index.byNorm) {
    if (claimed.has(entry)) continue;
    let best = null;
    for (const def of BONES) {
      if (norm.length <= def.norm.length || !norm.startsWith(def.norm)) continue;
      if (!DIGIT_TAIL.test(norm.slice(def.norm.length))) continue;
      if (!best || def.norm.length > best.norm.length) best = def;
    }
    if (best && !how[best.key]) take(best, entry, 'dedupe');
  }

  return { bones, how, claimed };
}

/**
 * Resolve a rig to the normalised bone map the rest of the engine speaks.
 *
 * Every one of the 22 keys is ALWAYS present, holding a bone or null, so callers
 * can destructure without guards — `const { head, spine2 } = resolveBones(root)`
 * and then `if (head)`. AnimationController._applyBones reads `.hips` / `.spine` /
 * `.head` off this object directly.
 *
 * A name-only source (the CLI's `{ names }`) has no nodes to hand back, so every
 * value is null even for bones that matched. Use validate().matched when you need
 * "did this name resolve" rather than "give me the node".
 *
 * @param {object|Array|Map} source Object3D root, SkinnedMesh, Skeleton, bone
 *   array, name array, `{ names }`, or an index from indexNodes().
 * @returns {Record<string, object|null>}
 */
export function resolveBones(source) {
  return resolveInto(asIndex(source)).bones;
}

// --------------------------------------------------------- socket resolution

// `how` is resolveInto()'s match map. It is what makes the fallback walk work on a
// name-only source (the CLI's `{ names }`), where every value in `bones` is null
// even for bones that resolved perfectly — testing node truthiness alone would
// report `socket_hand_R -> nothing` on a rig whose RightHand is right there.
function resolveSocketsFrom(index, bones, claimed, how = null) {
  const out = {};
  for (const def of SOCKETS) {
    let entry = null;
    for (const sp of def.spellings) {
      const hit = index.byNorm.get(sp);
      if (hit) {
        entry = hit;
        break;
      }
    }
    if (entry) {
      if (claimed) claimed.add(entry);
      out[def.key] = {
        name: def.name,
        present: true,
        node: entry.node ?? null,
        via: entry.name,
        exact: true,
      };
      continue;
    }

    // Spec §4: "if a socket is missing the loader falls back to the parent bone,
    // so a partial delivery still works — it just aims worse." Walk the canonical
    // parent chain rather than stopping at the first rung, so a rig that is also
    // missing RightHand hangs the weapon off the forearm — still animated, just
    // further from the fist. Falling OFF the skeleton (onto the model wrapper) is
    // the one outcome to avoid: the prop stops following the arm entirely and
    // hovers beside the character, which reads as a bug rather than as low detail.
    let node = null;
    let via = null;
    for (let key = def.parent, hops = 0; key && hops < BONES.length; hops++) {
      if (bones[key] || (how && how[key])) {
        node = bones[key] ?? null;
        via = BONE_BY_KEY[key].name;
        break;
      }
      key = BONE_BY_KEY[key].parent;
    }
    out[def.key] = { name: def.name, present: false, node, via, exact: false };
  }
  return out;
}

/**
 * Resolve the five gear sockets, falling back down the bone chain when a socket
 * empty wasn't exported.
 *
 * @param {object|Array|Map} source
 * @param {Record<string, object|null>} [bones] pass the map from resolveBones() to
 *   supply the nodes; the (cheap, traversal-free) bone match still runs so the
 *   fallback chain knows which bones exist on a name-only source.
 * @returns {Record<string, {name: string, present: boolean, node: object|null,
 *   via: string|null, exact: boolean}>} `node` is what to parent the prop to;
 *   `exact` false means it is a fallback and the placement is approximate.
 */
export function resolveSockets(source, bones = null) {
  const index = asIndex(source);
  const r = resolveInto(index);
  return resolveSocketsFrom(index, bones ?? r.bones, null, r.how);
}

// ------------------------------------------------------------------ validation

/**
 * Check a rig against JOB_HUMANOID_V1. Shared by `npm run model:check` (which
 * passes `{ names: [...] }` from gltf-transform) and by an in-game console
 * command (which passes a loaded Object3D).
 *
 * Missing bones are the only thing that can fail: sockets, aliases and extra
 * bones all still render, they just render worse — same policy as the CLI, where
 * warnings never set a non-zero exit code.
 *
 * @param {object|Array|Map} source
 * @param {{requireSockets?: boolean}} [opts]
 * @returns {{ok: boolean, missing: string[], extra: string[],
 *   sockets: Record<string, object>, warnings: string[],
 *   bones: Record<string, object|null>, matched: Record<string, object|null>,
 *   found: number, expected: number, version: string}}
 */
export function validate(source, { requireSockets = false } = {}) {
  const index = asIndex(source);
  const { bones, how, claimed } = resolveInto(index);
  const sockets = resolveSocketsFrom(index, bones, claimed, how);

  const missing = [];
  const warnings = [];
  const renamed = [];

  for (const def of BONES) {
    const m = how[def.key];
    if (!m) missing.push(def.name);
    else if (m.mode !== 'exact') renamed.push(`${m.name} -> ${def.name}`);
  }

  if (!index.entries.length) {
    warnings.push('no bones or empties found — this asset is not rigged');
  }

  if (renamed.length) {
    // The load-bearing warning in this file. Resolution succeeded, so the model
    // looks fine in a viewer, but three's PropertyBinding binds animation tracks
    // by EXACT node name: the shared _anims.glb will not touch these joints and
    // the character will T-pose from the neck down with no error anywhere.
    warnings.push(
      `${renamed.length} bone(s) matched only by an alternate name — the shared clips bind by exact ` +
        `name and will NOT drive them. Rename in Blender, or retarget with buildRetargetOptions(): ` +
        renamed.slice(0, 8).join(', ') +
        (renamed.length > 8 ? ` (+${renamed.length - 8} more)` : ''),
    );
  }

  for (const e of index.dupes) {
    warnings.push(
      `'${e.name}' collides with '${index.byNorm.get(e.norm).name}' once names are normalised — ` +
        `GLTFLoader de-duplicates with a _1 suffix, so lookups may bind to the wrong joint`,
    );
  }

  const noSocket = SOCKET_KEYS.filter((k) => !sockets[k].present);
  if (noSocket.length) {
    warnings.push(
      `missing socket(s), attachment falls back down the bone chain: ` +
        noSocket.map((k) => `${sockets[k].name} -> ${sockets[k].via ?? 'nothing'}`).join(', '),
    );
  }

  // Structural checks need real nodes; a name-only source (the CLI) skips them.
  for (const def of BONES) {
    if (!def.parent) continue;
    const child = bones[def.key];
    const parent = bones[def.parent];
    if (!child || !parent || !child.parent) continue;
    // Allow intermediate joints (twist bones, IK helpers) — only a broken CHAIN
    // matters, because that is what makes limbs stretch to a point when animated.
    let node = child.parent;
    let found = false;
    for (let hops = 0; node && hops < 8; hops++) {
      if (node === parent) {
        found = true;
        break;
      }
      node = node.parent;
    }
    if (!found) {
      warnings.push(
        `${def.name} is not parented under ${BONE_BY_KEY[def.parent].name} — the hierarchy in ` +
          `CHARACTER_ART_SPEC §3 is part of the contract; shared clips will deform this limb wrongly`,
      );
    }
  }

  if (bones.hips && bones.hips.parent && bones.hips.parent.isBone) {
    warnings.push(
      `'${bones.hips.parent.name}' sits above Hips — spec §6 requires in-place clips; an animated ` +
        `root bone translates the character a second time on top of the gameplay move`,
    );
  }

  const extra = [];
  for (const e of index.entries) {
    if (claimed.has(e) || !e.norm) continue;
    if (e.norm.startsWith('socket')) {
      warnings.push(`'${e.name}' looks like a socket but is not one this build knows — it is ignored`);
      continue;
    }
    // Plain empties are harmless (exporters leave them behind). Unknown BONES are
    // not: they cost skinning weight and no shared clip will ever move them.
    if (e.node && !e.node.isBone) continue;
    extra.push(e.name);
  }
  if (extra.length) {
    warnings.push(
      `${extra.length} non-standard bone(s) — no shared clip drives these: ${extra.slice(0, 6).join(', ')}` +
        (extra.length > 6 ? ` (+${extra.length - 6} more)` : ''),
    );
  }

  const found = BONES.length - missing.length;
  const ok = missing.length === 0 && (!requireSockets || noSocket.length === 0);
  return {
    ok,
    missing,
    extra,
    sockets,
    warnings,
    bones,
    matched: how,
    found,
    expected: BONES.length,
    version: SKELETON_VERSION,
  };
}

// ------------------------------------------------------------------ retargeting

/**
 * Bone-name map for SkeletonUtils.retarget's `names` option.
 *
 * Direction matters and is easy to get backwards: retarget iterates the TARGET
 * skeleton and looks the resolved name up in the SOURCE, so this is keyed by the
 * target's spelling and valued with the canonical (source) spelling. Getting it
 * backwards is a silent no-op, not an error.
 *
 *   retarget(targetSkinnedMesh, sourceSkinnedMesh, { names: RETARGET_NAMES, hip: 'Hips' })
 *
 * Two things this static map cannot do, because it is keyed by literal strings:
 * it only covers spec-conformant spellings plus the mixamorig prefix variants,
 * and it cannot know the source rig's own spelling. When you hold both rigs, use
 * buildRetargetOptions() — it is built from the actual skeletons and cannot miss.
 *
 * Null-prototype so that a bone named `constructor` or `toString` resolves to
 * undefined (no match) instead of to an inherited function.
 * @type {Record<string, string>}
 */
export const RETARGET_NAMES = Object.create(null);
for (const def of [...BONES, ...SOCKETS]) {
  const spellings = [
    def.name,
    def.name.toLowerCase(),
    `mixamorig:${def.name}`,
    `mixamorig${def.name}`,
    `mixamorig_${def.name}`,
  ];
  if (def.side) {
    spellings.push(`${def.base}_${def.side}`, `${def.base}.${def.side}`, `${def.side}_${def.base}`);
  }
  for (const s of spellings) if (!(s in RETARGET_NAMES)) RETARGET_NAMES[s] = def.name;
}

/**
 * The `getBoneName` form, which retarget consults BEFORE `names` and which runs
 * the full normaliser instead of a literal string lookup — strictly more tolerant
 * than RETARGET_NAMES on the target side.
 *
 * Falls back to the bone's own name so unrecognised joints (twist bones, custom
 * sockets) can still match a same-named joint on the source. That fallback is not
 * cosmetic: SkeletonUtils.getBoneName has NO `|| bone.name` of its own in the main
 * matching loop, so an options object without it matches nothing at all and
 * retarget degenerates into a silent skeleton.pose() reset.
 *
 * Assumes the SOURCE rig uses canonical spec names, which _anims.glb does.
 * @param {{name?: string}} bone
 */
export function retargetBoneName(bone) {
  const key = canonicalKeyFor(bone?.name);
  if (key) return BONE_BY_KEY[key].name;
  const socket = SOCKETS.find((s) => s.spellings.includes(normalizeBoneName(bone?.name)));
  return socket ? socket.name : (bone?.name ?? '');
}

/**
 * Exact target -> source name map, built from two live rigs. Only bones both
 * skeletons actually have are included, so a partial character can't ask retarget
 * for a joint the clip source doesn't own.
 * @returns {Record<string, string>}
 */
export function buildRetargetNames(target, source) {
  const ti = asIndex(target);
  const si = asIndex(source);
  return buildRetargetNamesFrom(ti, si, resolveInto(ti), resolveInto(si));
}

// Index-and-resolution-reusing core. collect() is a full scene traversal plus a
// re-traversal of every bone of every SkinnedMesh found, so each rig gets walked
// exactly ONCE per buildRetargetOptions() call rather than the two-and-a-half it
// used to take — the same reuse the indexNodes() doc tells callers to do.
function buildRetargetNamesFrom(ti, si, tr, sr) {
  const t = tr.bones;
  const s = sr.bones;
  const names = Object.create(null);
  for (const def of BONES) {
    if (t[def.key]?.name && s[def.key]?.name) names[t[def.key].name] = s[def.key].name;
  }
  const ts = resolveSocketsFrom(ti, t, null, tr.how);
  const ss = resolveSocketsFrom(si, s, null, sr.how);
  for (const def of SOCKETS) {
    // Only map sockets that are real on BOTH sides; a fallback node is already
    // mapped under its own bone key and mapping it twice would fight itself.
    if (ts[def.key].exact && ss[def.key].exact && ts[def.key].node && ss[def.key].node) {
      names[ts[def.key].node.name] = ss[def.key].node.name;
    }
  }
  return names;
}

/**
 * Ready-made options object for SkeletonUtils.retarget / retargetClip.
 *
 * `hip` is the trap: it defaults to the literal string 'hip' and is compared
 * against the RESOLVED (source) name, so on a Mixamo rig — where the bone is
 * `Hips` — root-motion scaling silently never fires and `scale` / `hipInfluence`
 * do nothing at all. Filling it in from the source skeleton is the whole point of
 * this helper.
 *
 * `preserveBonePositions` stays on so the target keeps its own bone lengths: the
 * roster runs from a 1.40 m Micromanager to a 3.00 m Auditor off one clip set, and
 * baking the source's translations in would stretch every one of them to the
 * source's proportions.
 *
 * @param {object} target skeleton/mesh being posed
 * @param {object} source skeleton the clips were authored on
 * @param {object} [extra] merged last — pass `scale`, `hipInfluence`, `localOffsets`
 */
export function buildRetargetOptions(target, source, extra = {}) {
  const ti = asIndex(target);
  const si = asIndex(source);
  const tr = resolveInto(ti);
  const sr = resolveInto(si);
  return {
    names: buildRetargetNamesFrom(ti, si, tr, sr),
    hip: sr.bones.hips?.name ?? 'Hips',
    preserveBonePositions: true,
    preserveBoneMatrix: true,
    ...extra,
  };
}

/**
 * First SkinnedMesh in a subtree, or null.
 *
 * SkeletonUtils.retarget / retargetClip reach straight for `target.skeleton.bones`
 * and throw `Cannot read properties of undefined` when handed a gltf.scene Group —
 * which is exactly what the loader gives you. Resolve the mesh first.
 * @param {object} root
 */
export function findSkinnedMesh(root) {
  if (!root) return null;
  if (root.isSkinnedMesh) return root;
  if (typeof root.traverse !== 'function') return null;
  let found = null;
  root.traverse((o) => {
    if (!found && o.isSkinnedMesh) found = o;
  });
  return found;
}

/**
 * One-line verdict for a console command:
 *   `JOB_HUMANOID_V1: 22/22 bones · 5/5 sockets · 2 warning(s)`
 * @param {ReturnType<typeof validate>} report
 */
export function summarize(report) {
  const sock = SOCKET_KEYS.filter((k) => report.sockets[k]?.present).length;
  return (
    `${report.version}: ${report.found}/${report.expected} bones · ${sock}/${SOCKET_KEYS.length} sockets · ` +
    `${report.warnings.length} warning(s)${report.ok ? '' : ` · MISSING ${report.missing.join(', ')}`}`
  );
}
