#!/usr/bin/env node
// ============ J.O.B — generated-mesh sanity check ============
// Catches the failure modes that only show up downstream, before we pay for
// rigging and six animations.
//
//   node scripts/meshy-validate.mjs [slug...]
//
// Rigging is the step that rejects bad geometry, and it rejects it with an
// opaque 422 ("Pose estimation failed") after you have already paid for refine.
// Checks here are the cheap version of that feedback:
//   - aspect      a duplicated or sprawled body reads far wider than a humanoid
//   - tri budget  `target_polycount` is advisory; meshy-6 routinely overshoots
//                 several-fold, and heavy meshes are the ones that fail to rig
//   - materials   a mesh that skipped texturing has none

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { ASSETS, bySlug } from './meshy-manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MODELS_DIR = path.join(ROOT, 'public', 'models');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// A-pose humans land around 0.55-0.85 wide-over-tall (arms out widen it).
// Two bodies side by side, or a collapsed/sprawled mesh, blow past 1.0.
const MAX_ASPECT = 0.95;
// meshy-6 treats target_polycount as a hint. 4x is the point where it stops
// being "a bit over" and starts being a different asset than we asked for.
const TRI_TOLERANCE = 4;

async function check(asset) {
  // Check the refine output first — that is the mesh the rigging endpoint eats.
  // (Checking `.rigged.glb` first silently validated a previous generation.)
  const file = ['.glb', '.rigged.glb'].map((s) => path.join(MODELS_DIR, asset.slug + s)).find(fs.existsSync);
  if (!file) return { slug: asset.slug, skip: 'not generated' };

  const doc = await io.read(file);
  const scene = doc.getRoot().listScenes()[0];
  const { min, max } = getBounds(scene);
  const size = { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] };
  const aspect = size.x / Math.max(1e-6, size.y);

  const tris = doc.getRoot().listMeshes()
    .flatMap((m) => m.listPrimitives())
    .reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0) / 3, 0);

  const issues = [];
  if (asset.kind !== 'prop' && aspect > MAX_ASPECT) {
    issues.push(`aspect ${aspect.toFixed(2)} > ${MAX_ASPECT} — likely a duplicated or sprawled body`);
  }
  if (size.y <= 0.01) issues.push('zero height');
  if (!doc.getRoot().listMaterials().length) issues.push('no materials — texturing did not run');
  // Warning, not a failure: a 24k-tri Intern threw a 422 from rigging once and
  // then rigged fine on a straight retry, so weight alone does not predict it.
  // Worth surfacing for the draw-call budget; never worth blocking a wave.
  const warnings = [];
  const budget = (asset.polycount ?? 4000) * TRI_TOLERANCE;
  if (tris > budget) {
    warnings.push(`${Math.round(tris)} tris vs ${asset.polycount ?? 4000} requested — meshy-6 treats target_polycount as a hint`);
  }

  return { slug: asset.slug, file: path.basename(file), aspect, tris: Math.round(tris), size, issues, warnings };
}

async function main() {
  const args = process.argv.slice(2);
  const targets = args.length ? args.map((s) => bySlug(s) || { slug: s, kind: 'character' }) : ASSETS;

  console.log();
  let bad = 0;
  for (const asset of targets) {
    const r = await check(asset);
    if (r.skip) continue;
    const dims = `${r.size.x.toFixed(2)}w x ${r.size.y.toFixed(2)}h`;
    const label = r.issues.length ? 'FAIL' : r.warnings.length ? 'warn' : 'ok  ';
    if (r.issues.length) bad++;
    console.log(`  ${label}  ${r.slug.padEnd(18)} ${dims.padEnd(20)} ${String(r.tris).padStart(6)} tris  aspect ${r.aspect.toFixed(2)}`);
    for (const i of r.issues) console.log(`        ${i}`);
    for (const w of r.warnings) console.log(`        note: ${w}`);
  }
  console.log(bad ? `\n  ${bad} asset(s) need regeneration: node scripts/meshy.mjs gen <slug> --force\n` : '\n  all checked assets look sane\n');
  process.exitCode = bad ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(1); });
