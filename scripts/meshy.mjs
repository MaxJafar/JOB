#!/usr/bin/env node
// ============ J.O.B — Meshy asset pipeline ============
// Resumable, manifest-driven 3D asset generation.
//
//   node scripts/meshy.mjs balance
//   node scripts/meshy.mjs list [--wave pilot]
//   node scripts/meshy.mjs gen --wave pilot          # generate a whole wave
//   node scripts/meshy.mjs gen intern securityguard  # or named slugs
//   node scripts/meshy.mjs status
//   node scripts/meshy.mjs index                     # rebuild models.json only
//
// Flags: --wave <name>  --no-rig  --no-anim  --dry  --force  --concurrency N
//
// Every stage is checkpointed in scripts/meshy.lock.json, so a crashed or
// interrupted run resumes without re-spending credits. The lockfile doubles as
// the licensing archive required by docs/MESHY_ASSET_PACK.md (prompt + task id
// + date + credits per asset).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS, WAVES, bySlug, buildPrompt, buildNegative, ANIM_ACTIONS } from './meshy-manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MODELS_DIR = path.join(ROOT, 'public', 'models');
const ANIM_DIR = path.join(MODELS_DIR, 'anim');
const LOCK_PATH = path.join(__dirname, 'meshy.lock.json');
const KEY_PATH = path.join(__dirname, '.meshy.key');
const API = 'https://api.meshy.ai/openapi';

// ---------- auth ----------
function apiKey() {
  const fromEnv = process.env.MESHY_API_KEY;
  if (fromEnv) return fromEnv.trim();
  if (fs.existsSync(KEY_PATH)) return fs.readFileSync(KEY_PATH, 'utf8').trim();
  die(`No API key. Set MESHY_API_KEY or write the key to ${rel(KEY_PATH)}`);
}

// ---------- tiny utils ----------
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function die(msg) { console.error(`\n  ERROR  ${msg}\n`); process.exit(1); }

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

function log(slug, msg) { console.log(`  ${C.cyan(slug.padEnd(18))} ${msg}`); }

// ---------- lockfile ----------
function loadLock() {
  if (!fs.existsSync(LOCK_PATH)) return { version: 1, assets: {} };
  try { return JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8')); }
  catch { return { version: 1, assets: {} }; }
}
let LOCK = loadLock();
function entry(slug) {
  LOCK.assets[slug] ||= { slug, stages: {}, credits: 0 };
  return LOCK.assets[slug];
}
function saveLock() {
  fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
  fs.writeFileSync(LOCK_PATH, JSON.stringify(LOCK, null, 2) + '\n', 'utf8');
}

// ---------- HTTP ----------
async function api(method, endpoint, body) {
  const res = await fetch(`${API}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const detail = json?.message || text?.slice(0, 300) || res.statusText;
    const err = new Error(`${method} ${endpoint} -> ${res.status}: ${detail}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

// Poll a task until it leaves PENDING/IN_PROGRESS. Returns the final task object.
async function poll(endpoint, id, slug, label) {
  let lastPct = -1;
  for (let i = 0; i < 600; i++) { // ~40 min ceiling at 4s
    const task = await api('GET', `${endpoint}/${id}`);
    const status = task.status;
    if (status === 'SUCCEEDED') {
      if (lastPct >= 0) process.stdout.write('\n');
      return task;
    }
    if (status === 'FAILED' || status === 'CANCELED') {
      if (lastPct >= 0) process.stdout.write('\n');
      const why = task.task_error?.message || status;
      throw new Error(`${label} ${status}: ${why}`);
    }
    const pct = task.progress ?? 0;
    if (pct !== lastPct) {
      process.stdout.write(`\r  ${C.cyan(slug.padEnd(18))} ${label} ${C.dim(`${pct}%`)}   `);
      lastPct = pct;
    }
    await sleep(4000);
  }
  throw new Error(`${label} timed out`);
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} for ${dest}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return buf.length;
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

// ---------- stages ----------
// Each stage is a no-op when its lock entry already holds a SUCCEEDED task id,
// so re-running `gen` after a failure only pays for what is actually missing.

async function stagePreview(asset, e, opts) {
  if (e.stages.preview?.id && !opts.force) return e.stages.preview.id;
  const prompt = buildPrompt(asset);
  const body = {
    mode: 'preview',
    prompt,
    negative_prompt: buildNegative(asset),
    ai_model: opts.model || 'meshy-6',
    model_type: 'lowpoly',      // the real low-poly lever — adjectives don't do it
    topology: 'triangle',
    target_polycount: asset.polycount ?? 4000,
    should_remesh: true,
    symmetry_mode: 'auto',
  };
  // Characters must come back in A-pose with empty hands, or auto-rigging and
  // our socket-attached weapons both break.
  if (asset.kind !== 'prop') body.pose_mode = 'a-pose';

  if (opts.dry) { log(asset.slug, C.dim(`[dry] preview  ${prompt.slice(0, 60)}...`)); return null; }

  const { result: id } = await api('POST', '/v2/text-to-3d', body);
  e.prompt = prompt;
  e.name = asset.name;
  e.stages.preview = { id, requestedAt: new Date().toISOString() };
  saveLock();
  const task = await poll('/v2/text-to-3d', id, asset.slug, 'preview');
  e.stages.preview.status = task.status;
  e.stages.preview.finishedAt = new Date().toISOString();
  e.credits += task.consumed_credits ?? 0;
  saveLock();
  log(asset.slug, `${C.green('preview')}  ${C.dim(id)}`);
  return id;
}

async function stageRefine(asset, e, previewId, opts) {
  if (e.stages.refine?.id && !opts.force) return e.stages.refine.id;
  if (opts.dry) { log(asset.slug, C.dim('[dry] refine')); return null; }

  // No texture_prompt: v2 used one saying "no shading, no highlights" and every
  // asset came back bleached white. Colour direction lives in the main prompt.
  const { result: id } = await api('POST', '/v2/text-to-3d', {
    mode: 'refine',
    preview_task_id: previewId,
    enable_pbr: false,          // flat-shaded art direction — PBR maps are dead weight
    texture_resolution: '2k',
  });
  e.stages.refine = { id, requestedAt: new Date().toISOString() };
  saveLock();
  const task = await poll('/v2/text-to-3d', id, asset.slug, 'refine ');
  e.stages.refine.status = task.status;
  e.stages.refine.finishedAt = new Date().toISOString();
  e.credits += task.consumed_credits ?? 0;

  const glb = task.model_urls?.glb;
  if (!glb) throw new Error('refine returned no glb url');
  const dest = path.join(MODELS_DIR, `${asset.slug}.glb`);
  const size = await download(glb, dest);
  e.files = { ...(e.files || {}), base: rel(dest) };
  saveLock();
  log(asset.slug, `${C.green('refine')}   ${C.dim(`${rel(dest)}  ${kb(size)}`)}`);
  return id;
}

async function stageRig(asset, e, refineId, opts) {
  if (e.stages.rig?.id && !opts.force) return e.stages.rig.id;
  if (opts.dry) { log(asset.slug, C.dim('[dry] rig')); return null; }

  const { result: id } = await api('POST', '/v1/rigging', {
    input_task_id: refineId,
    height_meters: asset.height ?? 1.8,
  });
  e.stages.rig = { id, requestedAt: new Date().toISOString() };
  saveLock();
  const task = await poll('/v1/rigging', id, asset.slug, 'rig    ');
  e.stages.rig.status = task.status;
  e.stages.rig.finishedAt = new Date().toISOString();
  e.credits += task.consumed_credits ?? 0;

  const rigged = task.result?.rigged_character_glb_url || task.result?.result?.rigged_character_glb_url;
  if (!rigged) throw new Error('rig returned no glb url');
  const dest = path.join(MODELS_DIR, `${asset.slug}.rigged.glb`);
  const size = await download(rigged, dest);
  e.files = { ...(e.files || {}), rigged: rel(dest) };
  saveLock();
  log(asset.slug, `${C.green('rig')}      ${C.dim(`${rel(dest)}  ${kb(size)}`)}`);
  return id;
}

async function stageAnims(asset, e, rigId, opts) {
  const clips = asset.anims || [];
  if (!clips.length) return;
  e.stages.anims ||= {};
  for (const clip of clips) {
    const action = ANIM_ACTIONS[clip];
    if (action === undefined) { log(asset.slug, C.yellow(`skip anim '${clip}' — no action id`)); continue; }
    if (e.stages.anims[clip]?.file && !opts.force) continue;
    if (opts.dry) { log(asset.slug, C.dim(`[dry] anim ${clip}`)); continue; }

    const { result: id } = await api('POST', '/v1/animations', {
      rig_task_id: rigId,
      action_id: action,
    });
    e.stages.anims[clip] = { id, action, requestedAt: new Date().toISOString() };
    saveLock();
    const task = await poll('/v1/animations', id, asset.slug, `anim ${clip.padEnd(8)}`);
    e.credits += task.consumed_credits ?? 0;

    const url = task.result?.animation_glb_url || task.result?.result?.animation_glb_url;
    if (!url) { log(asset.slug, C.yellow(`anim ${clip}: no glb url`)); continue; }
    const dest = path.join(ANIM_DIR, asset.slug, `${clip}.glb`);
    const size = await download(url, dest);
    e.stages.anims[clip].file = rel(dest);
    e.stages.anims[clip].status = task.status;
    saveLock();
    log(asset.slug, `${C.green('anim')}     ${clip.padEnd(10)} ${C.dim(`${kb(size)}`)}`);
  }
}

// Preview-only probe: 5 credits and a render to look at, so prompt changes get
// judged before paying for refine + rig + six animations.
async function stageThumb(asset, e, taskId, stage) {
  const task = await api('GET', `/v2/text-to-3d/${taskId}`);
  if (!task.thumbnail_url) return;
  const dest = path.join(ROOT, 'docs', 'asset-qa', `${asset.slug}.${stage}.png`);
  await download(task.thumbnail_url, dest);
  log(asset.slug, `${C.green('thumb')}    ${C.dim(rel(dest))}`);
}

async function generate(asset, opts) {
  const e = entry(asset.slug);
  e.wave = asset.wave;
  // A forced regeneration must not erase the audit trail — the lockfile is the
  // licensing archive (prompt + task id + date per asset).
  if (opts.force && e.stages?.preview?.id) {
    (e.history ||= []).push({ retiredAt: new Date().toISOString(), prompt: e.prompt, stages: e.stages, credits: e.credits });
    e.stages = {};
    e.credits = 0;
    delete e.error;
    delete e.completedAt;
    saveLock();
  }
  try {
    const previewId = await stagePreview(asset, e, opts);
    if (opts.dry) return { slug: asset.slug, ok: true };
    if (!opts.refine) {
      await stageThumb(asset, e, previewId, 'preview');
      return { slug: asset.slug, ok: true, credits: e.credits };
    }
    const refineId = await stageRefine(asset, e, previewId, opts);
    if (asset.kind !== 'prop' && opts.rig) {
      const rigId = await stageRig(asset, e, refineId, opts);
      if (opts.anim) await stageAnims(asset, e, rigId, opts);
    }
    e.completedAt = new Date().toISOString();
    saveLock();
    return { slug: asset.slug, ok: true, credits: e.credits };
  } catch (err) {
    e.error = String(err.message || err);
    saveLock();
    console.log(`  ${C.cyan(asset.slug.padEnd(18))} ${C.red('FAILED')}   ${e.error}`);
    return { slug: asset.slug, ok: false, error: e.error };
  }
}

// Bounded-concurrency map — Meshy queues per-account, so a few in flight is
// plenty and keeps failures easy to read.
async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }));
  return out;
}

// ---------- models.json (engine-facing index) ----------
function writeIndex() {
  const out = { generated: new Date().toISOString(), assets: {} };
  for (const asset of ASSETS) {
    const e = LOCK.assets[asset.slug];
    if (!e?.files?.base) continue;
    const toUrl = (p) => (p ? '/' + p.replace(/^public\//, '') : null);
    const anims = {};
    for (const [clip, a] of Object.entries(e.stages?.anims || {})) {
      if (a.file) anims[clip] = toUrl(a.file);
    }
    out.assets[asset.slug] = {
      name: asset.name,
      kind: asset.kind,
      height: asset.height ?? null,
      model: toUrl(e.files.rigged || e.files.base),
      rigged: Boolean(e.files.rigged),
      ...(Object.keys(anims).length ? { anims } : {}),
    };
  }
  const dest = path.join(MODELS_DIR, 'models.json');
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`\n  ${C.green('index')}    ${rel(dest)}  (${Object.keys(out.assets).length} assets)`);
}

// ---------- commands ----------
function parseArgs(argv) {
  const opts = { wave: null, refine: true, rig: true, anim: true, dry: false, force: false, concurrency: 3, model: null };
  const slugs = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--wave') opts.wave = argv[++i];
    else if (a === '--model') opts.model = argv[++i];
    else if (a === '--preview-only') { opts.refine = false; opts.rig = false; opts.anim = false; }
    else if (a === '--no-rig') opts.rig = false;
    else if (a === '--no-anim') opts.anim = false;
    else if (a === '--dry') opts.dry = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--concurrency') opts.concurrency = Number(argv[++i]) || 3;
    else if (a.startsWith('--')) die(`unknown flag ${a}`);
    else slugs.push(a);
  }
  return { opts, slugs };
}

function select(slugs, wave) {
  if (slugs.length) {
    return slugs.map((s) => bySlug(s) || die(`unknown slug '${s}' — try: node scripts/meshy.mjs list`));
  }
  if (wave) {
    if (!WAVES.includes(wave)) die(`unknown wave '${wave}' — one of: ${WAVES.join(', ')}`);
    return ASSETS.filter((a) => a.wave === wave);
  }
  die('specify slugs or --wave <name>');
}

async function main() {
  const [cmd, ...argv] = process.argv.slice(2);
  const { opts, slugs } = parseArgs(argv);

  if (!cmd || cmd === 'help') {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
      .split('\n').slice(1, 20).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return;
  }

  if (cmd === 'balance') {
    const b = await api('GET', '/v1/balance');
    console.log(`\n  Meshy credits: ${C.bold(b.balance)}\n`);
    return;
  }

  if (cmd === 'list') {
    console.log();
    for (const wave of WAVES) {
      const inWave = ASSETS.filter((a) => a.wave === wave);
      if (opts.wave && opts.wave !== wave) continue;
      console.log(`  ${C.bold(wave)}  ${C.dim(`(${inWave.length})`)}`);
      for (const a of inWave) {
        const e = LOCK.assets[a.slug];
        const mark = e?.files?.rigged ? C.green('rigged') : e?.files?.base ? C.yellow('mesh  ') : C.dim('—     ');
        console.log(`    ${mark}  ${a.slug.padEnd(18)} ${C.dim(a.name)}`);
      }
    }
    console.log();
    return;
  }

  if (cmd === 'status') {
    const rows = Object.values(LOCK.assets);
    if (!rows.length) { console.log('\n  nothing generated yet\n'); return; }
    console.log();
    let total = 0;
    for (const e of rows) {
      total += e.credits || 0;
      const anims = Object.keys(e.stages?.anims || {}).length;
      const state = e.error ? C.red('error') : e.completedAt ? C.green('done ') : C.yellow('part ');
      console.log(`  ${state}  ${e.slug.padEnd(18)} ${String(e.credits || 0).padStart(4)} cr  ${anims} anims  ${C.dim(e.error || e.completedAt || '')}`);
    }
    console.log(`\n  total spent: ${C.bold(total)} credits\n`);
    return;
  }

  if (cmd === 'index') { writeIndex(); return; }

  // Pull Meshy's rendered preview for each generated asset into one folder, so
  // art direction can be judged without loading the game.
  if (cmd === 'thumbs') {
    const dir = path.join(ROOT, 'docs', 'asset-qa');
    const rows = Object.values(LOCK.assets).filter((e) => e.stages?.refine?.id);
    console.log();
    for (const e of rows) {
      for (const [stage, taskId] of [['refine', e.stages.refine?.id], ['preview', e.stages.preview?.id]]) {
        if (!taskId) continue;
        const task = await api('GET', `/v2/text-to-3d/${taskId}`);
        if (!task.thumbnail_url) continue;
        const dest = path.join(dir, `${e.slug}.${stage}.png`);
        const size = await download(task.thumbnail_url, dest);
        console.log(`  ${C.green('thumb')}   ${rel(dest).padEnd(40)} ${kb(size)}`);
        break;   // refine wins when present
      }
    }
    console.log();
    return;
  }

  if (cmd === 'gen') {
    const targets = select(slugs, opts.wave);
    const b = await api('GET', '/v1/balance');
    console.log(`\n  ${C.bold(`Generating ${targets.length} asset(s)`)}${opts.dry ? C.yellow('  [DRY RUN]') : ''}`);
    console.log(`  ${C.dim(`balance ${b.balance} credits · rig=${opts.rig} anim=${opts.anim} concurrency=${opts.concurrency}`)}\n`);

    const results = await pool(targets, opts.concurrency, (a) => generate(a, opts));
    const ok = results.filter((r) => r.ok).length;
    const after = await api('GET', '/v1/balance');
    console.log(`\n  ${ok}/${results.length} succeeded · spent ${C.bold(b.balance - after.balance)} credits · ${after.balance} left`);
    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      console.log(`  ${C.red('failed:')} ${failed.map((f) => f.slug).join(', ')}  ${C.dim('(re-run gen to resume)')}`);
    }
    if (!opts.dry) writeIndex();
    console.log();
    return;
  }

  die(`unknown command '${cmd}'`);
}

main().catch((e) => die(e.stack || e.message));
