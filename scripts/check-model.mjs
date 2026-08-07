#!/usr/bin/env node
// ============ J.O.B — character GLB checker ============
// Validates a delivered model against docs/CHARACTER_ART_SPEC.md before it goes
// near the engine. A skeleton mistake caught on character one is cheap; the same
// mistake found on character six means re-exporting six files.
//
//   npm run model:check public/models/characters/bruiser.glb
//   npm run model:check public/models/characters/*.glb
//   npm run model:check -- --anims public/models/characters/_anims.glb
//
// Exits non-zero if any ERROR is found. Warnings never fail the check.

import fs from 'node:fs';
import path from 'node:path';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// Spec §3 — the shared skeleton. Every character must carry these exact bones
// (with or without a `mixamorig:` prefix) or the shared clips won't drive it.
const REQUIRED_BONES = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
];
const SOCKETS = ['socket_hand_R', 'socket_hand_L', 'socket_head', 'socket_back', 'socket_chest'];

// Spec §6 — clips the game drives. Optional ones don't warn.
const CLIPS = ['idle', 'run', 'attack_a', 'attack_b', 'shoot', 'block', 'dash', 'slide', 'jump', 'hit', 'death'];
const CLIP_LENGTH = { attack_a: [0.2, 0.4], attack_b: [0.2, 0.4], shoot: [0.08, 0.3], death: [1.0, 2.2] };

const TRI_MAX = 6000, TRI_TYPICAL = 3000;
const norm = (n) => n.replace(/^mixamorig:?/i, '').toLowerCase();

async function checkCharacter(file) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  const errors = [], warns = [], notes = [];

  // ---- geometry ----
  const scene = root.listScenes()[0];
  const { min, max } = getBounds(scene);
  const h = max[1] - min[1], w = max[0] - min[0], d = max[2] - min[2];

  const tris = root.listMeshes().flatMap((m) => m.listPrimitives()).reduce((n, p) => {
    const idx = p.getIndices();
    return n + (idx ? idx.getCount() : (p.getAttribute('POSITION')?.getCount() ?? 0)) / 3;
  }, 0);

  if (tris > TRI_MAX) errors.push(`${Math.round(tris)} tris exceeds the ${TRI_MAX} ceiling`);
  else if (tris > TRI_TYPICAL) warns.push(`${Math.round(tris)} tris — over the ${TRI_TYPICAL} target for non-bosses`);

  // Spec §1: feet on the floor, centred on x/z.
  if (Math.abs(min[1]) > 0.02) errors.push(`feet are at y=${min[1].toFixed(3)}, must be 0 (origin between the feet)`);
  const offX = (min[0] + max[0]) / 2;
  if (Math.abs(offX) > 0.08) warns.push(`not centred on X (midpoint ${offX.toFixed(2)}m)`);
  if (h < 1.2 || h > 3.5) warns.push(`height ${h.toFixed(2)}m is outside the 1.2-3.5m roster range — check your units`);

  // Spec §1: T-pose means arms straight out. Human arm span is roughly equal to
  // height, so don't demand width > height — that warns on correct models.
  // Arms down or folded is what we're actually looking for.
  if (w < h * 0.75) warns.push(`width ${w.toFixed(2)}m is only ${(w / h * 100).toFixed(0)}% of height — arms may not be straight out (T-pose required)`);
  if (d > w * 0.7) warns.push(`unusually deep (${d.toFixed(2)}m) — arms may be pointing forward (A-pose) rather than sideways`);

  // ---- skeleton ----
  const skins = root.listSkins();
  if (!skins.length) {
    errors.push('no skin/armature — the mesh is not rigged');
  } else {
    const bones = new Set();
    for (const skin of skins) for (const j of skin.listJoints()) bones.add(norm(j.getName()));
    const missing = REQUIRED_BONES.filter((b) => !bones.has(norm(b)));
    if (missing.length) errors.push(`missing ${missing.length} required bone(s): ${missing.join(', ')}`);
    const extra = [...bones].filter((b) => !REQUIRED_BONES.map(norm).includes(b) && !b.startsWith('socket_'));
    if (extra.length) notes.push(`${extra.length} non-standard bone(s) — shared clips won't drive them: ${extra.slice(0, 6).join(', ')}`);
  }

  // Sockets can live outside the skin, so search every node.
  const nodeNames = new Set(root.listNodes().map((n) => norm(n.getName())));
  const missingSockets = SOCKETS.filter((s) => !nodeNames.has(norm(s)));
  if (missingSockets.length) warns.push(`missing socket(s), attachment falls back to the parent bone: ${missingSockets.join(', ')}`);

  // ---- materials (spec §5: flat colour, no baked light) ----
  const mats = root.listMaterials();
  if (mats.length > 2) warns.push(`${mats.length} materials — spec is <= 2 (each one is another draw call)`);
  for (const m of mats) {
    const name = m.getName() || '(unnamed)';
    if (m.getNormalTexture()) errors.push(`material '${name}' has a normal map — flat-shaded style, remove it`);
    if (m.getOcclusionTexture()) errors.push(`material '${name}' has an AO map — baked shading is what makes models look muddy`);
    if (m.getEmissiveTexture()) notes.push(`material '${name}' has an emissive map`);
    if (m.getMetallicFactor() > 0.05) warns.push(`material '${name}' metallic=${m.getMetallicFactor().toFixed(2)}, should be 0`);
  }

  if (root.listAnimations().length) {
    notes.push(`${root.listAnimations().length} embedded clip(s) — these override the shared set by name`);
  }

  return { errors, warns, notes, stats: `${h.toFixed(2)}m tall · ${Math.round(tris)} tris · ${mats.length} mat · ${skins.length ? 'rigged' : 'NO RIG'}` };
}

async function checkAnims(file) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  const errors = [], warns = [], notes = [];

  const clips = new Map(root.listAnimations().map((a) => {
    const dur = Math.max(0, ...a.listSamplers().map((s) => {
      const input = s.getInput();
      return input ? input.getMax([])[0] : 0;
    }));
    return [norm(a.getName()), dur];
  }));
  if (!clips.size) errors.push('no animations in this file');

  for (const want of CLIPS) {
    if (!clips.has(want)) warns.push(`no '${want}' clip`);
  }
  for (const [name, [lo, hi]] of Object.entries(CLIP_LENGTH)) {
    const dur = clips.get(name);
    if (dur === undefined) continue;
    if (dur < lo || dur > hi) {
      warns.push(`'${name}' is ${dur.toFixed(2)}s — spec wants ${lo}-${hi}s (gameplay timing depends on it)`);
    }
  }
  if (root.listMeshes().length) {
    notes.push(`carries ${root.listMeshes().length} mesh(es) — strip them, only clips are used from this file`);
  }
  notes.push(`clips: ${[...clips.keys()].join(', ')}`);
  return { errors, warns, notes, stats: `${clips.size} clips` };
}

async function main() {
  const args = process.argv.slice(2);
  const isAnims = args.includes('--anims');
  const files = args.filter((a) => !a.startsWith('--'));
  if (!files.length) {
    console.log('\n  usage: npm run model:check <file.glb> [...]\n         npm run model:check -- --anims _anims.glb\n');
    process.exit(1);
  }

  let failed = 0;
  console.log();
  for (const file of files) {
    if (!fs.existsSync(file)) { console.log(`  MISSING  ${file}\n`); failed++; continue; }
    const name = path.basename(file);
    let r;
    try {
      r = (isAnims || name.startsWith('_anims')) ? await checkAnims(file) : await checkCharacter(file);
    } catch (err) {
      console.log(`  UNREADABLE  ${name}\n              ${err.message}\n`);
      failed++;
      continue;
    }
    const verdict = r.errors.length ? 'FAIL' : r.warns.length ? 'WARN' : 'PASS';
    if (r.errors.length) failed++;
    console.log(`  ${verdict}  ${name}   ${r.stats}`);
    for (const e of r.errors) console.log(`        ERROR  ${e}`);
    for (const w of r.warns) console.log(`        warn   ${w}`);
    for (const n of r.notes) console.log(`        note   ${n}`);
    console.log();
  }
  if (failed) console.log(`  ${failed} file(s) failed — see docs/CHARACTER_ART_SPEC.md\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
