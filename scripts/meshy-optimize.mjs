#!/usr/bin/env node
// ============ J.O.B — Meshy GLB optimizer ============
// Meshy's animation API returns a FULL character GLB per clip (~5-6 MB each),
// so a 6-clip character costs ~38 MB to ship one skeleton six times. The engine
// only keeps `gltf.animations[0]` from those files (see src/game/models.js), so
// everything else is dead weight.
//
//   node scripts/meshy-optimize.mjs          # strip anims + tidy base meshes
//   node scripts/meshy-optimize.mjs --check  # report sizes, write nothing
//
// Raw downloads are moved to .meshy-cache/ (gitignored) rather than deleted —
// the Meshy download URLs are signed and expire, so the raws are not re-gettable.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, resample } from '@gltf-transform/functions';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MODELS_DIR = path.join(ROOT, 'public', 'models');
const ANIM_DIR = path.join(MODELS_DIR, 'anim');
const CACHE_DIR = path.join(ROOT, '.meshy-cache');

const CHECK = process.argv.includes('--check');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;

function archive(file) {
  const dest = path.join(CACHE_DIR, path.relative(MODELS_DIR, file));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}

// An animation-only GLB: node hierarchy + AnimationClips, nothing renderable.
async function stripAnimation(file) {
  const doc = await io.read(file);
  const root = doc.getRoot();

  const clips = root.listAnimations().length;
  if (!clips) throw new Error('no animations — refusing to strip');

  // Order matters: meshes first (detaches them from nodes), then the skins and
  // shading data they referenced. Node transforms stay — the clips target them.
  for (const mesh of root.listMeshes()) mesh.dispose();
  for (const skin of root.listSkins()) skin.dispose();
  for (const material of root.listMaterials()) material.dispose();
  for (const texture of root.listTextures()) texture.dispose();

  await doc.transform(
    resample(),                       // drop redundant keyframes
    prune({ keepAttributes: false }), // sweep accessors the meshes owned
    dedup(),
  );

  // Guard against a silent gut: the clips must survive with live channels.
  const after = root.listAnimations();
  if (!after.length) throw new Error('stripping removed every animation');
  for (const anim of after) {
    const live = anim.listChannels().filter((c) => c.getTargetNode());
    if (!live.length) throw new Error(`animation '${anim.getName()}' lost all channel targets`);
  }
  return doc;
}

// Base/rigged meshes stay renderable — just remove duplication and dead data.
async function tidyBase(file) {
  const doc = await io.read(file);
  await doc.transform(dedup(), prune({ keepAttributes: false }));
  return doc;
}

async function optimizeFile(file, kind) {
  const before = fs.statSync(file).size;
  let doc;
  try {
    doc = kind === 'anim' ? await stripAnimation(file) : await tidyBase(file);
  } catch (err) {
    console.log(`  ${'SKIP'.padEnd(6)} ${rel(file).padEnd(46)} ${err.message}`);
    return { before, after: before, skipped: true };
  }
  const bytes = await io.writeBinary(doc);
  if (CHECK) {
    console.log(`  ${'check'.padEnd(6)} ${rel(file).padEnd(46)} ${mb(before)} -> ${mb(bytes.byteLength)}`);
    return { before, after: bytes.byteLength };
  }
  archive(file);
  fs.writeFileSync(file, Buffer.from(bytes));
  const saved = ((1 - bytes.byteLength / before) * 100).toFixed(0);
  console.log(`  ${'ok'.padEnd(6)} ${rel(file).padEnd(46)} ${mb(before)} -> ${mb(bytes.byteLength)}  (-${saved}%)`);
  return { before, after: bytes.byteLength };
}

async function main() {
  if (!fs.existsSync(MODELS_DIR)) {
    console.log('\n  no public/models — run `node scripts/meshy.mjs gen --wave pilot` first\n');
    return;
  }
  const glbs = fs.readdirSync(MODELS_DIR).filter((f) => f.endsWith('.glb'));
  // models.json points characters at `<slug>.rigged.glb`; the un-rigged mesh is
  // only a pipeline intermediate, so keep it out of the shipped bundle.
  const superseded = glbs.filter((f) => !f.endsWith('.rigged.glb') && glbs.includes(f.replace(/\.glb$/, '.rigged.glb')));
  const bases = glbs.filter((f) => !superseded.includes(f)).map((f) => path.join(MODELS_DIR, f));
  const anims = [];
  if (fs.existsSync(ANIM_DIR)) {
    for (const slug of fs.readdirSync(ANIM_DIR)) {
      const dir = path.join(ANIM_DIR, slug);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const f of fs.readdirSync(dir)) if (f.endsWith('.glb')) anims.push(path.join(dir, f));
    }
  }

  console.log(`\n  ${CHECK ? 'CHECK ' : ''}optimizing ${bases.length} mesh + ${anims.length} animation GLBs\n`);
  let before = 0, after = 0;

  for (const f of superseded) {
    const full = path.join(MODELS_DIR, f);
    const freed = fs.statSync(full).size;
    before += freed;
    if (CHECK) { console.log(`  ${'move'.padEnd(6)} ${rel(full).padEnd(46)} ${mb(freed)} -> cache (superseded by .rigged)`); continue; }
    archive(full);
    fs.unlinkSync(full);
    console.log(`  ${'moved'.padEnd(6)} ${rel(full).padEnd(46)} ${mb(freed)} freed (superseded by .rigged)`);
  }
  for (const f of anims) { const r = await optimizeFile(f, 'anim'); before += r.before; after += r.after; }
  for (const f of bases) { const r = await optimizeFile(f, 'base'); before += r.before; after += r.after; }

  console.log(`\n  total ${mb(before)} -> ${mb(after)}  (-${((1 - after / before) * 100).toFixed(0)}%)`);
  if (!CHECK) console.log(`  raws archived in ${rel(CACHE_DIR)}`);
  console.log();
}

main().catch((e) => { console.error(e); process.exit(1); });
