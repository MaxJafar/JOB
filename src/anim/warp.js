// ============ root motion · motion warping · interrupt windows ============
// Three problems that all reduce to the same question — "where is the character
// at time t, and who decides" — and all three are solved here as NUMBERS, not as
// poses. Nothing in this file writes a bone rotation; it hands the caller a
// displacement to apply and a set of booleans about what the character is allowed
// to do. That separation is why it can be unit-tested headlessly.
//
//   1. ROOT MOTION, TWO MODES.
//      Locomotion is CODE DRIVEN: PlayerMotor owns velocity (src/player/motor.js),
//      the clip is in-place (CHARACTER_ART_SPEC §7 "keep the root bone in place"),
//      and this module reports nothing. Special actions — dash, lunge, vault,
//      execution, boss slam, knockback — are ROOT MOTION DRIVEN: the clip carries
//      the Hips translation and IS the authority on distance, because a designer
//      keying a desk-vault gets the arc right and a `vel.z = 6` never will.
//      `begin()` returns false when a clip has no root track, and that false IS
//      the answer "this one is code driven". There is no third state to get wrong.
//
//   2. MOTION WARPING.
//      The desk-leap clip covers 2.0 m. The player is 2.7 m away. Without warping
//      the enemy lands 0.7 m short every single time and the attack reads as
//      broken. So the remaining root trajectory is scaled and rotated toward the
//      actual goal — with a hard clamp, because a leap stretched 3x does not read
//      as a longer leap, it reads as a teleport. Whatever the clamp refuses to
//      cover is reported as `residual` rather than hidden, so the AI can decide to
//      not commit instead of committing to a whiff. `canReach()` is that decision,
//      and it uses the SAME clamp, so a leap that passes the check cannot miss by
//      geometry.
//
//   3. INTERRUPT WINDOWS.
//      { startup, active, recovery, cancelFrom } per action, in seconds. Combat
//      rhythm is entirely made of these four numbers: startup is the tell, active
//      is the hitbox, recovery is the punish window, and cancelFrom is how tight
//      the combo feels. `cancelInto` stops everything cancelling into everything,
//      which is the difference between a combo system and a mash button.
//
// AXIS / FACING — read before touching a sign. The game's forward is
// (sin(yaw), cos(yaw)) (motor.js:122) applied as `mesh.rotation.y = yaw`
// (player.js), so the game's model space has +Z forward — while CHARACTER_ART_SPEC
// §1 says delivered GLBs face -Z, and blendspace.js encodes the spec. The two
// conventions disagree by 180°, and a hardcoded sign here is a coin flip that
// sends every dash backwards. So the PREFERRED path takes no sign at all: give us
// a `basis` node and we transform the track-space delta by its matrixWorld basis
// vectors, which folds facing, parent rotation and the height-fit scale into one
// correct transform. `faceSign` exists only for the no-node fallback.
//
// Imports: `Damper` (never hand-rolled smoothing) and the canonical bone-name
// normaliser. Deliberately NOT three — every value this module touches is
// duck-typed (`track.times`, `matrixWorld.elements`, `bone.position.x`), so the
// whole file runs under `node` with no renderer, which is the only way the maths
// below ever gets tested.

import { Damper } from '../core/spring.js';
import { normalizeBoneName } from './skeleton.js';

const DEG = Math.PI / 180;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
/** Boundary NaN discipline: one bad dt upstream must not become a NaN transform. */
const num = (v, d) => (Number.isFinite(v) ? v : d);
/**
 * Three-tier boolean: an explicit caller override beats the action's table row,
 * which beats the instance default. `undefined` means "did not say", so `false` is
 * a real answer at every tier and cannot be mistaken for silence.
 */
const pickFlag = (a, b, c) => (typeof a === 'boolean' ? a
  : typeof b === 'boolean' ? b : c === true);

// Module scratch. Written before read inside one synchronous block, never
// retained across calls. Per-frame allocation here is a GC sawtooth at 100 enemies.
//
// Each pair belongs to exactly ONE function and no other function may borrow it.
// That looks wasteful for six tiny objects and is not: an earlier draft shared two
// buffers between rootDelta() and its own sampler, so passing the shared buffer in
// as `out` made the function read back values it had just overwritten and the
// wrapped-loop branch silently returned half a delta. Ownership is the fix — and
// the same rule is why there are two window buffers below rather than one.
const _win = mkWindow();   // fitWindow's default `out`, and nothing else
// _q belongs to the one-line queries built ON TOP of fitWindow — windowPhase,
// isActive, isBusy, windowRemaining, activeSpan, canCancel, crossedActive. They
// used to pass _win, which gave that buffer seven writers: `const w =
// fitWindow('attack_a'); isActive('death', t);` silently rewrote the caller's `w`
// to death's numbers. Splitting them means a held fitWindow() result survives any
// number of other queries into this module.
const _q = mkWindow();
const _sol = mkSolution();
const _s0 = { x: 0, y: 0, z: 0 };   // sampleTrackVec3 only
const _s1 = { x: 0, y: 0, z: 0 };   // sampleTrackVec3 only
const _r0 = { x: 0, y: 0, z: 0 };   // rootDelta / clipTravel only
const _r1 = { x: 0, y: 0, z: 0 };   // rootDelta / clipTravel only
const _rot = { x: 0, z: 0 };        // warpDelta only
const _lv = { x: 0, y: 0, z: 0 };   // RootMotionWarp only
const _wv = { x: 0, y: 0, z: 0 };   // RootMotionWarp only

// =====================================================================
// 3. INTERRUPT WINDOWS — the data
// =====================================================================
// Times are SECONDS at the authored clip length and 1x attack speed.
// startup + active + recovery should equal `total`; where it does not, `total`
// wins (it is the clip length) and the phases are fitted to it proportionally.
//
// `cancelFrom` is elapsed seconds, NOT a phase name, because the interesting
// values sit *inside* recovery — that is what makes a combo feel tight without
// making the swing free to abort. `cancelFrom: Infinity` = fully committed.
//
// `cancelInto` is a whitelist of what may interrupt. `null` means anything,
// `[]` means nothing. This is the "not everything cancels into everything" rule
// as data, so tuning combat is editing this table and not chasing `if` chains.
//
// `armor: true` survives even a hit — a boss slam that a peashooter can cancel is
// not a boss. Death always lands regardless; nothing armours against that.
//
// `applyY` / `warpY` are the VERTICAL policy, and they live here rather than in
// WARP_DEFAULTS because they are a property of the action, not of the character:
// one enemy both dashes (motor owns gravity, applyY false) and vaults (clip owns
// the arc, applyY true), and an instance-wide flag silently discards one of them.
//
// Numbers are anchored to code that already ships, not invented:
//   attack_a/attack_b 0.28  — player.js meleeSwing sets attackAnimT = 0.28, and
//                             CHARACTER_ART_SPEC §7 pins both clips to 0.28 s
//                             precisely so the hit lands on the pose. If you
//                             change one, change all three.
//   shoot 0.15              — spec §7.
//   dash 0.25 / cancelFrom 0.20 — spec clip is 0.25 s; TUNE.dashTime is 0.20, so
//                             the cancel opens exactly when the motor stops
//                             driving the body. Cancelling earlier would let the
//                             player keep the dash speed AND act, which is the
//                             classic dash-cancel exploit.
//   slide 0.5               — TUNE.slideTime.
//   leap startup 0.45       — enemies.js Karen pounce: windupT = 0.45 then a
//                             game.delayed(0.45) launch. The tell and the clip
//                             MUST agree or the audio cue fires off-pose.
//   slam startup 0.70       — enemies.js CEO slam: windupT = 0.7 with a matching
//                             telegraph(…, 0.7) decal.
export const ACTION_WINDOWS = {
  // ---- committed melee (code-driven movement) ----
  attack_a: {
    total: 0.28, startup: 0.11, active: 0.08, recovery: 0.09, cancelFrom: 0.20,
    cancelInto: ['attack_b', 'dash', 'block', 'shoot'],
  },
  attack_b: {
    total: 0.28, startup: 0.11, active: 0.08, recovery: 0.09, cancelFrom: 0.20,
    // Deliberately NOT symmetric with attack_a: b cancels back into a, so the
    // alternating swing chain closes. Letting b cancel into b would make one
    // button a machine gun.
    cancelInto: ['attack_a', 'dash', 'block', 'shoot'],
  },
  shoot: {
    total: 0.15, startup: 0.03, active: 0.02, recovery: 0.10, cancelFrom: 0.07,
    cancelInto: ['shoot', 'dash', 'block', 'attack_a', 'attack_b'],
  },
  // ---- stances / traversal ----
  block: {
    // A held guard has no end until the button releases. Infinity is load-bearing:
    // it makes isActive() true forever after the raise, which is exactly the
    // semantics of a guard, and every span below is written to survive it.
    total: Infinity, startup: 0.06, active: Infinity, recovery: 0.12,
    cancelFrom: 0.06, cancelInto: null, hold: true,
  },
  slide: {
    total: 0.50, startup: 0.06, active: 0.38, recovery: 0.06, cancelFrom: 0.14,
    cancelInto: ['jump', 'dash', 'attack_a'], hold: true,
  },
  jump: {
    total: 0.50, startup: 0.06, active: 0.34, recovery: 0.10, cancelFrom: 0.06,
    cancelInto: null,
  },
  dash: {
    total: 0.25, startup: 0.02, active: 0.18, recovery: 0.05, cancelFrom: 0.20,
    cancelInto: ['attack_a', 'attack_b', 'shoot', 'block', 'jump'], iframes: true,
  },
  // ---- reactions ----
  hit: {
    // No hitbox of its own, so active is 0 and the whole clip is recovery. The
    // 0.12 cancel is hitstun: shorter and stagger stops mattering, longer and
    // being hit once by a crowd means never acting again.
    total: 0.30, startup: 0, active: 0, recovery: 0.30, cancelFrom: 0.12,
    cancelInto: ['dash', 'block', 'hit'],
  },
  death: {
    total: 1.40, startup: 0, active: 0, recovery: 1.40, cancelFrom: Infinity,
    cancelInto: [],
  },

  // ---- root-motion actions: the CLIP owns the displacement ----
  lunge: {
    total: 0.45, startup: 0.14, active: 0.12, recovery: 0.19, cancelFrom: 0.38,
    cancelInto: ['dash'], rootMotion: true, warp: true,
  },
  leap: {
    total: 0.95, startup: 0.45, active: 0.25, recovery: 0.25, cancelFrom: Infinity,
    cancelInto: [], rootMotion: true, warp: true, armor: true,
  },
  vault: {
    total: 0.60, startup: 0.10, active: 0.35, recovery: 0.15, cancelFrom: 0.50,
    // The clip owns the arc here, so applyY is ON — but warping stays
    // horizontal-only by contract (warpY false). Scaling the arc's HEIGHT to
    // reach further is how a character clips through a desk.
    cancelInto: ['run', 'walk', 'dash', 'jump'], rootMotion: true, warp: true,
    applyY: true, warpY: false,
  },
  slam: {
    total: 1.10, startup: 0.70, active: 0.18, recovery: 0.22, cancelFrom: Infinity,
    // Same deal as vault: the descent is authored, the reach is not.
    cancelInto: [], rootMotion: true, warp: true, armor: true,
    applyY: true, warpY: false,
  },
  execution: {
    total: 1.60, startup: 0.35, active: 0.25, recovery: 1.00, cancelFrom: Infinity,
    cancelInto: [], rootMotion: true, warp: true, armor: true, iframes: true,
  },
  knockback: {
    // Warping OFF on purpose: knockback has no target to land on, and warping it
    // toward one would pull the victim into the attacker.
    total: 0.55, startup: 0, active: 0, recovery: 0.55, cancelFrom: 0.42,
    cancelInto: ['hit', 'death'], rootMotion: true, warp: false,
  },
};

/**
 * Logical/authored name -> table key. Mutable at runtime like the rest of the
 * tunable data in this folder. The controller resolves clip names through its own
 * CLIP_ALIASES, so the string that reaches us may be either the logical state or
 * the raw clip name out of the GLB.
 */
export const ACTION_ALIASES = {
  attack: 'attack_a', attack_1: 'attack_a', attack_2: 'attack_b',
  melee: 'attack_a', swing: 'attack_a', swing_l: 'attack_b',
  fire: 'shoot', attack_ranged: 'shoot',
  guard: 'block', parry: 'block',
  hit_react: 'hit', flinch: 'hit', stagger: 'hit', stun: 'hit',
  die: 'death',
  pounce: 'leap', tackle: 'leap', charge_leap: 'leap',
  charge: 'lunge', dash_attack: 'lunge', rush: 'lunge',
  finisher: 'execution', grab: 'execution',
  groundpound: 'slam', slam_ground: 'slam',
  knockdown: 'knockback', launch: 'knockback',
};

/**
 * Interrupts that ignore `cancelFrom` entirely. Getting hit has to be able to
 * break a swing — otherwise a 0.28 s attack is 0.28 s of free super armour and
 * players learn to mash through crowds. `armor: true` on the action opts back out
 * of this; `death` gets through even that.
 */
const ALWAYS_CANCELS = new Set(['hit', 'death', 'knockback']);

// =====================================================================
// 3. INTERRUPT WINDOWS — the pure queries
// =====================================================================

/** Resolve any spelling to a table key. Returns '' for unknown input. */
export function resolveAction(state) {
  if (typeof state !== 'string' || !state) return '';
  if (ACTION_WINDOWS[state]) return state;
  const key = state.toLowerCase();
  if (ACTION_WINDOWS[key]) return key;
  const via = ACTION_ALIASES[key];
  return via && ACTION_WINDOWS[via] ? via : '';
}

/** Raw table row, or null. `fitWindow` is what you want in gameplay code. */
export function attackWindow(state) {
  const key = resolveAction(state);
  return key ? ACTION_WINDOWS[key] : null;
}

/** True when the clip, not the code, owns this action's displacement. */
export function isRootMotion(state) {
  return attackWindow(state)?.rootMotion === true;
}

/** True when this action's root trajectory may be warped toward a target. */
export function isWarpable(state) {
  const rec = attackWindow(state);
  return rec ? rec.rootMotion === true && rec.warp === true : false;
}

function mkWindow() {
  return {
    ok: false, state: '', startup: 0, active: 0, recovery: 0, total: 0,
    cancelFrom: 0, activeStart: 0, activeEnd: 0, hit: 0,
    rootMotion: false, warp: false, hold: false, armor: false, iframes: false,
    applyY: false, warpY: false,
  };
}

/**
 * Resolve a table row to ABSOLUTE seconds for this particular playback.
 *
 * Everything else in this section is a one-line question on top of this, so the
 * two corrections that matter live in exactly one place:
 *
 *   `duration`  the delivered clip is 0.31 s but the table says 0.28. Rather than
 *               letting the hitbox drift off the pose, the phases are stretched
 *               proportionally to the real clip. Ignored for `hold` actions and
 *               anything with a non-finite total, where the ratio is meaningless.
 *   `timeScale` the AnimationAction's playback rate — attack speed. Windows
 *               compress with it, because the whole point of attack speed is that
 *               the recovery shrinks too. Passing the buff to the mixer but not
 *               here is how a hasted player's hitbox stops matching the swing.
 *
 * @param {string} state
 * @param {{duration?: number, timeScale?: number}|null} opts
 * @param {object} out mutated in place — hoist it if you call this per frame.
 *   The DEFAULT is a module-scope singleton shared with every other fitWindow()
 *   caller, so a result you intend to keep across another call into this module
 *   must be copied or given its own buffer (`fitWindow(s, o, mkWindow())`).
 * @returns {{ok:boolean, state:string, startup:number, active:number,
 *   recovery:number, total:number, cancelFrom:number, activeStart:number,
 *   activeEnd:number, hit:number, rootMotion:boolean, warp:boolean,
 *   hold:boolean, armor:boolean, iframes:boolean, applyY:boolean,
 *   warpY:boolean}}
 */
export function fitWindow(state, opts = null, out = _win) {
  const key = resolveAction(state);
  out.state = key;
  out.ok = false;
  out.startup = 0; out.active = 0; out.recovery = 0; out.total = 0;
  out.cancelFrom = 0; out.activeStart = 0; out.activeEnd = 0; out.hit = 0;
  out.rootMotion = false; out.warp = false; out.hold = false;
  out.armor = false; out.iframes = false;
  out.applyY = false; out.warpY = false;
  if (!key) return out;

  const rec = ACTION_WINDOWS[key];
  const ts = Math.max(1e-3, num(opts?.timeScale, 1));
  const duration = num(opts?.duration, 0);

  // Only refit when both lengths are real and finite. A held stance has total
  // Infinity, and Infinity/duration would collapse every window to zero.
  let fit = 1;
  if (duration > 0 && Number.isFinite(rec.total) && rec.total > 1e-4) fit = duration / rec.total;
  const k = fit / ts;

  out.startup = num(rec.startup, 0) * k;
  // Infinity has to be tested for explicitly, NOT passed through num(): Infinity
  // is not finite, so num(Infinity, 0) is 0 and a held guard would collapse to a
  // zero-length active window that isActive() never reports as up.
  out.active = Number.isFinite(rec.active) ? rec.active * k : Infinity;
  out.recovery = num(rec.recovery, 0) * k;
  out.total = Number.isFinite(rec.total) ? rec.total * k : Infinity;
  out.cancelFrom = Number.isFinite(rec.cancelFrom) ? rec.cancelFrom * k : Infinity;
  out.activeStart = out.startup;
  out.activeEnd = out.startup + out.active;
  // Centre of the hitbox window — the frame to schedule the damage query and the
  // impact sound on. Zero-length windows (hit, knockback) collapse to their start,
  // which is the correct answer rather than a NaN midpoint.
  out.hit = Number.isFinite(out.activeEnd) ? (out.activeStart + out.activeEnd) * 0.5 : out.activeStart;
  out.rootMotion = rec.rootMotion === true;
  out.warp = rec.warp === true;
  out.hold = rec.hold === true;
  out.armor = rec.armor === true;
  out.iframes = rec.iframes === true;
  // Per-ACTION vertical policy. A character that both dashes (motor owns gravity)
  // and vaults (clip owns the arc) cannot express that with an instance-wide flag,
  // so the row wins and RootMotionWarp.begin() reads it from here.
  out.applyY = rec.applyY === true;
  out.warpY = rec.warpY === true;
  out.ok = true;
  return out;
}

/**
 * Where in the action we are. 'none' means the state has no window at all — an
 * unknown action does not own the character, which is the safe default.
 * @returns {'none'|'startup'|'active'|'recovery'|'done'}
 */
export function windowPhase(state, elapsed, opts = null) {
  const w = fitWindow(state, opts, _q);
  if (!w.ok) return 'none';
  const e = num(elapsed, 0);
  if (e >= w.total) return 'done';
  if (e < w.activeStart) return 'startup';
  if (e < w.activeEnd) return 'active';
  return 'recovery';
}

/**
 * Is the hitbox live? (For `block`, is the guard up?)
 * Combat should gate its damage query on this instead of on a hand-rolled timer,
 * so the hit and the pose can never drift apart.
 *
 * POINT SAMPLE — only reliable when your tick is faster than the shortest active
 * window. attack_a's window is [0.118, 0.204) and src/ai/lod.js hands banked
 * enemies 0.25 s substeps, so `elapsed` jumps 0 -> 0.25 straight over it and this
 * returns false on every sampled frame. Anything driven by the LOD scheduler must
 * use crossedActive(), which tests the SPAN instead of the instant.
 *
 * @param {string} state @param {number} elapsed seconds since the action started
 * @param {{duration?: number, timeScale?: number}|null} opts
 */
export function isActive(state, elapsed, opts = null) {
  const w = fitWindow(state, opts, _q);
  if (!w.ok) return false;
  const e = num(elapsed, 0);
  return e >= w.activeStart && e < w.activeEnd;
}

/**
 * Did the span (prevElapsed, elapsed] touch the damage window? This is the
 * LOD-safe form of isActive(): the substep loop in src/ai/lod.js can step a
 * banked enemy clean over an 86 ms window, and a hitbox that only exists when it
 * happens to be sampled is a monster that never hits you at range.
 *
 * Zero-length windows (`hit`, `knockback`, which have no hitbox of their own)
 * degrade to a crossing test on the `hit` instant, so they fire exactly once
 * rather than never.
 *
 * Still a "was it live", not a "have I already dealt damage" — one-shot dedupe
 * stays the caller's job, exactly as it is with isActive().
 *
 * @param {string} state
 * @param {number} prevElapsed elapsed at the START of this tick
 * @param {number} elapsed elapsed at the END of this tick
 * @param {{duration?: number, timeScale?: number}|null} opts
 */
export function crossedActive(state, prevElapsed, elapsed, opts = null) {
  const w = fitWindow(state, opts, _q);
  if (!w.ok) return false;
  const p = num(prevElapsed, 0);
  const e = num(elapsed, 0);
  if (e < p) return false;                       // a restart, not a span
  if (w.activeEnd > w.activeStart) return p < w.activeEnd && e >= w.activeStart;
  // Degenerate window: cross the hit instant once. `p <= hit && e > hit` rather
  // than `>=` on both sides, or a window at elapsed 0 would fire every frame.
  return p <= w.hit && e > w.hit;
}

/** True while the action is still running at all. */
export function isBusy(state, elapsed, opts = null) {
  const w = fitWindow(state, opts, _q);
  return w.ok ? num(elapsed, 0) < w.total : false;
}

/** Seconds left before the action releases the character. */
export function windowRemaining(state, elapsed, opts = null) {
  const w = fitWindow(state, opts, _q);
  if (!w.ok) return 0;
  return Math.max(0, w.total - num(elapsed, 0));
}

/** Absolute seconds of the damage window: [start, end). */
export function activeSpan(state, opts = null, out = { start: 0, end: 0, hit: 0 }) {
  const w = fitWindow(state, opts, _q);
  out.start = w.activeStart;
  out.end = w.activeEnd;
  out.hit = w.hit;
  return out;
}

/**
 * May `state`, `elapsed` seconds in, be interrupted — optionally by `into`?
 *
 * The ordering is the whole design:
 *   1. an unknown action never locks the character (a soft-lock is worse than a
 *      sloppy cancel, and this is the path every unlisted clip takes)
 *   2. a finished action is always cancellable
 *   3. death lands on anything, always
 *   4. hit / knockback land on anything without `armor`
 *   5. before cancelFrom, nothing else gets through — this is the commitment
 *      that makes recovery a punish window
 *   6. after cancelFrom, only what `cancelInto` allows
 *
 * @param {string} state the action currently running
 * @param {number} elapsed seconds since it started
 * @param {string|null} into what wants to interrupt; null asks "by anything?"
 * @param {{duration?: number, timeScale?: number}|null} opts
 */
export function canCancel(state, elapsed, into = null, opts = null) {
  const w = fitWindow(state, opts, _q);
  if (!w.ok) return true;
  const e = num(elapsed, 0);
  if (e >= w.total) return true;

  const target = resolveAction(into) || (typeof into === 'string' ? into.toLowerCase() : '');
  if (target === 'death') return true;
  if (target && !w.armor && ALWAYS_CANCELS.has(target)) return true;

  if (!(e >= w.cancelFrom)) return false;

  const list = ACTION_WINDOWS[w.state].cancelInto;
  if (!Array.isArray(list)) return true;          // null = anything
  if (!target) return list.length > 0;            // "by anything?" with a whitelist
  return list.includes(target);
}

// =====================================================================
// 1. ROOT MOTION — reading the track (pure)
// =====================================================================

// GLTFLoader emits 'Hips.position'; SkeletonUtils.retargetClip emits
// '.bones[Hips].position'. Both spellings have to hit, and the node name inside
// still needs the mixamo/namespace treatment — 'mixamorigHips' is what a GLB
// round trip actually produces (the colon is stripped by sanitizeNodeName).
const TRACK_RE = /^(?:\.bones\[(.+?)\]|(.+?))\.(position|quaternion|scale)$/;

// Names a root-motion track can hang off. `root` and `rootmotion` cover rigs that
// carry a dedicated motion bone above the hips; the spec skeleton uses Hips.
const ROOT_NAMES = new Set(['hips', 'hip', 'pelvis', 'root', 'rootmotion', 'motion', 'reference']);

// three's InterpolateDiscrete. Compared numerically so this file stays free of a
// three import; the constant has been 2300 since r70 and is part of the format.
const INTERPOLATE_DISCRETE = 2300;

/**
 * Find the translation track that carries this clip's displacement.
 *
 * An explicit `boneName` is AUTHORITATIVE, not a preference: it gets its own pass
 * over every track, and if nothing matches the answer is null. The two passes have
 * to be separate, because a single fused loop lets the `node === 'hips'` shortcut
 * below return before a later track can even be tested against the caller's name —
 * so on exactly the rig ROOT_NAMES exists for (a dedicated motion bone above the
 * hips) `findRootTrack(clip, 'root')` used to hand back Hips, or not, depending on
 * track order in the file. Returning null for an unmatched explicit name is also
 * order-independent: "you asked for a bone this clip does not animate" beats
 * quietly extracting a different bone's displacement.
 *
 * @param {{tracks?: Array}} clip an AnimationClip (duck-typed)
 * @param {string|null} boneName explicit node name; when given, nothing else matches
 * @returns {object|null} the KeyframeTrack, or null for an in-place clip
 */
export function findRootTrack(clip, boneName = null) {
  const tracks = clip?.tracks;
  if (!Array.isArray(tracks) || tracks.length === 0) return null;
  const want = boneName ? normalizeBoneName(boneName) : '';

  if (want) {
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      const m = TRACK_RE.exec(t?.name ?? '');
      if (!m || m[3] !== 'position') continue;
      if (normalizeBoneName(m[1] ?? m[2] ?? '') === want) return t;
    }
    return null;
  }

  let fallback = null;
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const m = TRACK_RE.exec(t?.name ?? '');
    if (!m || m[3] !== 'position') continue;
    const node = normalizeBoneName(m[1] ?? m[2] ?? '');
    if (!ROOT_NAMES.has(node)) continue;
    // Prefer an exact 'hips': a rig with both a motion bone and hips would
    // otherwise hand back whichever came first in the file.
    if (node === 'hips') return t;
    if (!fallback) fallback = t;
  }
  return fallback;
}

/** Cheap predicate for "is this action clip-driven or code-driven". */
export function hasRootMotion(clip, boneName = null) {
  const track = findRootTrack(clip, boneName);
  if (!track) return false;
  // A track with a single key is an in-place clip that merely pinned the hips.
  return (track.times?.length ?? 0) > 1;
}

/**
 * Sample a Vector3 keyframe track at `time`. Allocation-free, no three.
 *
 * Handles the two layouts glTF actually produces: a plain 3-float stride, and
 * CUBICSPLINE's 9-float stride of [inTangent, value, outTangent]. Missing the
 * second one does not fail loudly — it silently reads tangents as positions and
 * hands back a displacement several times too large, which is the single worst
 * bug this file could ship. Cubic keys are still interpolated LINEARLY here: we
 * want the displacement between two times, and the tangential error over a
 * 0.25 s burst is well under a centimetre.
 *
 * @param {{times?: ArrayLike<number>, values?: ArrayLike<number>}} track
 * @param {number} time seconds
 * @param {{x:number,y:number,z:number}} out mutated in place
 */
export function sampleTrackVec3(track, time, out = { x: 0, y: 0, z: 0 }) {
  out.x = 0; out.y = 0; out.z = 0;
  const times = track?.times;
  const values = track?.values;
  const n = times?.length ?? 0;
  if (!n || !values) return out;

  const stride = Math.floor(values.length / n);
  if (stride < 3) return out;
  const off = stride >= 9 ? 3 : 0;                 // CUBICSPLINE: skip inTangent

  const t = num(time, 0);
  // `!(t > times[0])` rather than `t <= times[0]` so a NaN time clamps to the
  // first key instead of falling through the binary search with NaN comparisons.
  if (!(t > times[0])) return readKey(values, 0, stride, off, out);
  if (t >= times[n - 1]) return readKey(values, n - 1, stride, off, out);

  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid; else hi = mid;
  }
  readKey(values, lo, stride, off, _s0);
  if (track.getInterpolation?.() === INTERPOLATE_DISCRETE) {
    out.x = _s0.x; out.y = _s0.y; out.z = _s0.z;
    return out;
  }
  readKey(values, hi, stride, off, _s1);
  const span = times[hi] - times[lo];
  // Duplicate times are legal — they express a step. Dividing by that zero span
  // would emit NaN and poison every downstream damper permanently.
  const f = span > 1e-9 ? (t - times[lo]) / span : 0;
  out.x = _s0.x + (_s1.x - _s0.x) * f;
  out.y = _s0.y + (_s1.y - _s0.y) * f;
  out.z = _s0.z + (_s1.z - _s0.z) * f;
  return out;
}

/** Hoisted out of sampleTrackVec3: a closure per call is a per-frame allocation. */
function readKey(values, i, stride, off, dst) {
  const b = i * stride + off;
  dst.x = num(values[b], 0);
  dst.y = num(values[b + 1], 0);
  dst.z = num(values[b + 2], 0);
  return dst;
}

/**
 * Track-space displacement between two clip times.
 *
 * A backwards `t1` is treated as a LOOP (tail + head), which is right for a
 * looping root-motion clip and wrong for an action that was reset. The two are
 * indistinguishable from time alone, so callers announce a restart by calling
 * `begin()`; `maxStepSpeed` in the driver catches whatever slips past.
 *
 * @param {object} track from findRootTrack
 * @param {number} t0 previous clip time
 * @param {number} t1 current clip time
 * @param {number} duration clip duration (0 = derive from the last key)
 * @param {{x:number,y:number,z:number}} out mutated in place
 */
export function rootDelta(track, t0, t1, duration = 0, out = { x: 0, y: 0, z: 0 }) {
  out.x = 0; out.y = 0; out.z = 0;
  const times = track?.times;
  const n = times?.length ?? 0;
  if (n < 2) return out;

  const start = times[0];
  const end = duration > 0 ? duration : times[n - 1];
  const a = clamp(num(t0, 0), start, end);
  const b = clamp(num(t1, 0), start, end);

  if (b >= a) {
    sampleTrackVec3(track, b, _r0);
    sampleTrackVec3(track, a, _r1);
    out.x = _r0.x - _r1.x; out.y = _r0.y - _r1.y; out.z = _r0.z - _r1.z;
    return out;
  }

  // Wrapped: (end - a) + (b - start).
  sampleTrackVec3(track, end, _r0);
  sampleTrackVec3(track, a, _r1);
  out.x = _r0.x - _r1.x; out.y = _r0.y - _r1.y; out.z = _r0.z - _r1.z;
  sampleTrackVec3(track, b, _r0);
  sampleTrackVec3(track, start, _r1);
  out.x += _r0.x - _r1.x; out.y += _r0.y - _r1.y; out.z += _r0.z - _r1.z;
  return out;
}

/**
 * Total track-space displacement of a clip, first key to last. This is the number
 * the AI needs BEFORE committing: "this leap covers 2.0 m, the player is 2.7 m
 * away, can I make it" — see canReach().
 * @returns {{x:number,y:number,z:number,planar:number,length:number}}
 */
export function clipTravel(clip, boneName = null, out = { x: 0, y: 0, z: 0, planar: 0, length: 0 }) {
  out.x = 0; out.y = 0; out.z = 0; out.planar = 0; out.length = 0;
  const track = clip?.times ? clip : findRootTrack(clip, boneName);
  const n = track?.times?.length ?? 0;
  if (n < 2) return out;
  sampleTrackVec3(track, track.times[n - 1], _r0);
  sampleTrackVec3(track, track.times[0], _r1);
  out.x = _r0.x - _r1.x;
  out.y = _r0.y - _r1.y;
  out.z = _r0.z - _r1.z;
  out.planar = Math.hypot(out.x, out.z);
  out.length = Math.hypot(out.x, out.y, out.z);
  return out;
}

// =====================================================================
// track space -> world space
// =====================================================================

/**
 * Transform a track-space delta by an object's world basis.
 *
 * `matrixWorld.elements` columns ARE the scaled basis vectors, so this folds
 * facing, every parent rotation and the height-fit scale from models.js into one
 * multiply. No facing convention to get wrong, no scale to remember: a 2.4x boss
 * covers 2.4x the ground, automatically.
 *
 * We read matrixWorld and deliberately do NOT force an update. Calling
 * updateMatrixWorld from inside a per-character update recurses through every
 * descendant (and from a scene node, the whole scene) — a frame-time cliff. One
 * frame of staleness is a sub-millimetre error at gameplay speeds.
 *
 * @param {ArrayLike<number>|null} e matrixWorld.elements, column-major
 */
export function matrixToWorld(e, lx, ly, lz, out = { x: 0, y: 0, z: 0 }) {
  if (!e || e.length < 11) { out.x = lx; out.y = ly; out.z = lz; return out; }
  out.x = e[0] * lx + e[4] * ly + e[8] * lz;
  out.y = e[1] * lx + e[5] * ly + e[9] * lz;
  out.z = e[2] * lx + e[6] * ly + e[10] * lz;
  return out;
}

/**
 * Fallback for when there is no node to read a basis from.
 *
 * `faceSign` is the model-space axis that is the game's forward: +1 for the
 * procedural rigs and the motor convention (forward = (sin yaw, cos yaw), applied
 * as mesh.rotation.y = yaw), -1 for a CHARACTER_ART_SPEC §1 GLB that faces -Z.
 * The two disagree by exactly 180°, which is why `basis` is strongly preferred —
 * it makes the question disappear instead of answering it wrong half the time.
 */
export function yawToWorld(lx, ly, lz, yaw, faceSign = -1, scale = 1, out = { x: 0, y: 0, z: 0 }) {
  const f = faceSign < 0 ? -1 : 1;
  const gx = lx * f, gz = lz * f;               // 180° about Y negates x and z
  const s = Math.sin(num(yaw, 0)), c = Math.cos(num(yaw, 0));
  const k = num(scale, 1);
  out.x = (gx * c + gz * s) * k;
  out.y = ly * k;
  out.z = (-gx * s + gz * c) * k;
  return out;
}

/**
 * Average XZ scale baked into a world matrix. Needed because matrixToWorld folds
 * scale in silently: a caller asking "how far does this leap actually cover"
 * before the action starts has to apply the same factor by hand, and models.js's
 * height fit means the 1.40 m Micromanager and the 3.00 m Auditor do NOT cover
 * the same ground with the same clip.
 *
 * Non-uniform scale has no single honest answer, so the two horizontal axes are
 * averaged rather than one being picked and quietly being wrong on the other.
 */
export function matrixScaleXZ(e) {
  if (!e || e.length < 11) return 1;
  const sx = Math.hypot(e[0], e[1], e[2]);
  const sz = Math.hypot(e[8], e[9], e[10]);
  const s = (sx + sz) * 0.5;
  return s > 1e-6 ? s : 1;
}

/** Rotate a world planar vector about +Y, three's sign convention. */
export function rotateY(x, z, angle, out = { x: 0, z: 0 }) {
  const s = Math.sin(angle), c = Math.cos(angle);
  out.x = x * c + z * s;
  out.z = -x * s + z * c;
  return out;
}

// =====================================================================
// 2. MOTION WARPING — the solve (pure)
// =====================================================================

export const WARP_DEFAULTS = {
  // Stretch is the dangerous direction: a leap played over 1.4x its authored
  // distance still reads as a leap, 2x reads as a teleport. Squash is safer
  // (stopping short looks like a short lunge) but is clamped separately anyway,
  // because collapsing a 2 m leap to 0.4 m makes the legs cycle over nothing.
  maxStretch: 0.40,
  maxSquash: 0.40,
  // Rotating the trajectory is far cheaper visually than stretching it — the body
  // is already turning — but past ~35° the character visibly pivots in mid-air.
  maxYaw: 35 * DEG,
  // Stop AT the target, not inside it. Pass (myRadius + theirRadius) so a lunge
  // ends at contact range instead of interpenetrating and getting pushed out.
  contact: 0,
  // Below this the clip is in-place for practical purposes: scaling ~0 by any
  // factor is still ~0, and dividing by it is where a NaN enters the transform.
  minTravel: 0.15,
  // Fraction of the clip after which retargeting stops. Chasing a moving target
  // past the hit frame is what makes an attack feel like it homes through your
  // dodge — the commitment IS the counterplay.
  warpLockAt: 0.55,
  // A mid-flight re-solve changes the scale discontinuously; at 8 m/s that is a
  // visible several-centimetre pop in one frame. Damper is critically damped so
  // it can never overshoot the solved scale and sail past the target.
  warpSmooth: 0.05,
  // Vertical is NOT warped by default: scaling a vault's arc to cover more ground
  // also raises or lowers it, and that is how a character clips through a desk.
  warpY: false,
  // Whether vertical root motion is extracted at all. Off by default because the
  // motor owns gravity; on for vaults and slams where the clip owns the arc.
  applyY: false,
  // Teleport guard, metres per SECOND of world displacement — a rate, not a
  // distance. This has to scale with the caller's dt or it stops being a teleport
  // guard and becomes a speed limit: src/ai/lod.js hands banked enemies 0.25 s
  // substeps, and a 4.8 m slam over 1.1 s legitimately covers 1.09 m in one such
  // call. An absolute 1.0 m budget silently zeroed four steps out of five and the
  // boss travelled 0.44 m of its 4.80 m, which is precisely the "N calls summing
  // to dt equal one call of dt" guarantee this class advertises.
  //
  // 12 m/s is roughly 3x the peak an authored clip reaches (that same slam peaks
  // near 4.4 m/s), while a clip RESTART — the thing actually being guarded, a
  // whole clip's travel inside one frame — is 288 m/s at 60 Hz and still rejected.
  maxStepSpeed: 12,
  // Floor on the dt used to compute that budget, so a zero-dt or paused-frame call
  // cannot collapse the allowance to zero and reject an honest delta.
  minStepDt: 1 / 240,
  // No-basis fallback only. See yawToWorld.
  faceSign: -1,
  worldScale: 1,
};

function mkSolution() {
  return { ok: false, scale: 1, yaw: 0, travel: 0, want: 0, residual: 0, reach: 1, clamped: false };
}

/**
 * Solve the warp: how much to scale and rotate the remaining root trajectory so
 * the action ends on the goal.
 *
 * All four inputs are WORLD-SPACE planar vectors — the trajectory has already
 * been through the basis transform, so no facing convention survives to this
 * point and the maths is pure trigonometry.
 *
 * @param {number} tx remaining trajectory, world X
 * @param {number} tz remaining trajectory, world Z
 * @param {number} gx vector from the character to the goal, world X
 * @param {number} gz vector from the character to the goal, world Z
 * @param {object} out mutated in place
 * @param {typeof WARP_DEFAULTS} opts
 * @returns {{ok:boolean, scale:number, yaw:number, travel:number, want:number,
 *   residual:number, reach:number, clamped:boolean}}
 *   `residual` is the metres the clamp REFUSED to cover — surfaced, not hidden,
 *   because it is the number that says "this attack is going to whiff and the AI
 *   should have picked a different one". `reach` is 1 when the goal is inside the
 *   clamp and <1 by the fraction that is reachable when it is not.
 */
export function solveWarp(tx, tz, gx, gz, out = _sol, opts = WARP_DEFAULTS) {
  const maxStretch = Math.max(0, num(opts?.maxStretch, 0.4));
  const maxSquash = clamp(num(opts?.maxSquash, 0.4), 0, 0.95);
  const maxYaw = Math.max(0, num(opts?.maxYaw, 35 * DEG));
  const contact = Math.max(0, num(opts?.contact, 0));
  const minTravel = Math.max(1e-4, num(opts?.minTravel, 0.15));

  const ax = num(tx, 0), az = num(tz, 0);
  const bx = num(gx, 0), bz = num(gz, 0);
  const tLen = Math.hypot(ax, az);
  const gLen = Math.hypot(bx, bz);

  out.ok = false; out.scale = 1; out.yaw = 0; out.clamped = false;
  out.travel = tLen; out.want = 0; out.residual = 0; out.reach = 1;

  // An in-place clip has no trajectory to warp, and a goal we are already
  // standing on has no direction. Both return the identity warp rather than a
  // divide-by-zero, so a mis-tagged action degrades to "plays normally".
  if (!(tLen > minTravel) || !(gLen > 1e-4)) return out;

  const want = Math.max(0, gLen - contact);
  const raw = want / tLen;
  const scale = clamp(raw, 1 - maxSquash, 1 + maxStretch);

  // Signed angle from the trajectory to the goal about +Y, in three's rotation
  // sense — the same one rotateY() applies, so solve and apply cannot disagree.
  const cross = az * bx - ax * bz;
  const dot = ax * bx + az * bz;
  const rawYaw = Math.atan2(cross, dot);
  const yaw = clamp(rawYaw, -maxYaw, maxYaw);

  out.ok = true;
  out.scale = scale;
  out.yaw = yaw;
  out.want = want;
  out.clamped = scale !== raw || yaw !== rawYaw;
  out.residual = want - tLen * scale;
  out.reach = raw > 1 + maxStretch ? (1 + maxStretch) / raw : 1;
  return out;
}

/**
 * Pre-flight check, using the SAME clamp solveWarp will apply. An AI that gates
 * its leap on this can never launch an attack that the warp then refuses to
 * stretch far enough — the whiff is designed out rather than tuned around.
 *
 * @param {number} travel clip planar travel, metres (clipTravel().planar * scale)
 * @param {number} dist distance to the target, metres
 */
export function canReach(travel, dist, opts = WARP_DEFAULTS) {
  const contact = Math.max(0, num(opts?.contact, 0));
  const want = Math.max(0, num(dist, 0) - contact);
  const t = num(travel, 0);
  const minTravel = Math.max(1e-4, num(opts?.minTravel, 0.15));
  if (!(t > minTravel)) return want <= 1e-3;
  const maxSquash = clamp(num(opts?.maxSquash, 0.4), 0, 0.95);
  return want <= t * (1 + Math.max(0, num(opts?.maxStretch, 0.4))) + 1e-4
    && want >= t * (1 - maxSquash) - 1e-4;
}

/**
 * Apply a solved warp to one frame's world-space delta.
 * Planar only unless `warpY` — see WARP_DEFAULTS.
 */
export function warpDelta(wx, wy, wz, scale, yaw, warpY = false, out = { x: 0, y: 0, z: 0 }) {
  const s = num(scale, 1);
  rotateY(num(wx, 0) * s, num(wz, 0) * s, num(yaw, 0), _rot);
  out.x = _rot.x;
  out.z = _rot.z;
  out.y = num(wy, 0) * (warpY ? s : 1);
  return out;
}

// =====================================================================
// the driver — thin state over the pure parts above
// =====================================================================

/**
 * Per-character root-motion + warp state.
 *
 * It owns four numbers (clip time, elapsed, accumulated displacement, solved
 * warp) and delegates every calculation to the exported pure functions, so the
 * maths stays testable without standing up a character. Nothing here is global.
 *
 * Frame order, and it matters:
 *
 *   rm.begin('leap', clip, { basis, x, z, targetX, targetZ, contact });
 *   ...
 *   mixer.update(dt);                       // the mixer writes Hips.position
 *   const m = rm.update(dt, { time: action.time, x: pos.x, z: pos.z });
 *   entity.pos.x += m.dx; entity.pos.z += m.dz;   // (through the motor/collision)
 *   rm.hold();                              // pin the bone back, visual stays put
 *
 * `hold()` must run AFTER the mixer or the mixer overwrites it, and after the
 * delta is read or the delta is always zero. Both failure modes are silent. It is
 * safe to call unconditionally every frame: it self-gates on the action binding
 * and is a no-op until begin() and again after cancel().
 *
 * The LOD substep loop (src/ai/lod.js) calls an enemy's tick several times per
 * frame with sub-dt slices, and skips it entirely on other frames. That is safe
 * here: displacement is derived from clip-time deltas and accumulated, so N calls
 * summing to dt produce exactly what one call of dt would — and the teleport
 * guard is budgeted as a RATE (maxStepSpeed) rather than an absolute distance
 * precisely so a 0.25 s substep does not trip it. What is NOT substep-safe is the
 * point-sampled isActive(): a 0.25 s slice steps clean over an 86 ms hitbox
 * window, so LOD-driven entities must gate damage on crossedActive() instead.
 */
export class RootMotionWarp {
  /** @param {Partial<typeof WARP_DEFAULTS>} opts */
  constructor(opts = {}) {
    this.opts = { ...WARP_DEFAULTS, ...opts };

    // Per-ACTION solve options. Prototype-chained to this.opts so live console
    // tuning of the instance options still reads through, while `contact` is an
    // own property that begin() sets and cancel() restores. begin() used to write
    // ctx.contact straight onto this.opts, where it outlived the action: a lunge
    // with contact 1.2 left every later leap stopping 1.2 m short, and because
    // canReach() reads the same field the pre-flight check that is supposed to
    // guarantee no whiff agreed with the whiff.
    this._solveOpts = Object.create(this.opts);
    this._solveOpts.contact = num(this.opts.contact, 0);

    // Per-action vertical policy, resolved in begin() from the ACTION_WINDOWS row
    // (then ctx, then the instance default). Never read from this.opts per frame.
    this.applyY = this.opts.applyY === true;
    this.warpY = this.opts.warpY === true;

    // rig binding (set once per character)
    this.bone = null;      // the Hips bone, for hold()
    this.basis = null;     // Object3D whose matrixWorld maps track space -> world
    this.yaw = 0;
    this.faceSign = this.opts.faceSign;
    this.worldScale = num(this.opts.worldScale, 1);

    // action binding (set per begin())
    this.state = '';
    this.track = null;
    this.duration = 0;
    this.timeScale = 1;
    this.rest = { x: 0, y: 0, z: 0 };
    this.travel = { x: 0, y: 0, z: 0, planar: 0, length: 0 };

    this.active = false;
    this.locked = false;   // retargeting closed (past warpLockAt)
    this.time = 0;         // clip time, seconds
    this.elapsed = 0;      // wall time since begin, for the window queries
    this.prevElapsed = 0;  // elapsed at the START of the last update() — see crossedActive()
    this.haveTarget = false;
    this.targetX = 0;
    this.targetZ = 0;

    // Solved targets; the dampers chase these so a mid-flight re-solve eases in.
    this._wantScale = 1;
    this._wantYaw = 0;
    this._scale = new Damper(1, this.opts.warpSmooth);
    this._yaw = new Damper(0, this.opts.warpSmooth);

    /** Stable output — mutated every frame, never replaced. Hold the reference. */
    this.out = {
      active: false, done: true, state: '', phase: 'none',
      dx: 0, dy: 0, dz: 0,        // THIS frame's world displacement to apply
      x: 0, y: 0, z: 0,           // accumulated since begin()
      progress: 0, elapsed: 0,
      scale: 1, yaw: 0, residual: 0, reach: 1, warped: false,
    };

    this.stats = { steps: 0, rejected: 0, solves: 0 };
  }

  /**
   * Contact offset in metres for the RUNNING action — "stop at my radius plus
   * theirs" rather than inside the target. An accessor rather than a plain field
   * so it cannot desync from the object solveWarp/canReach actually read.
   */
  get contact() { return num(this._solveOpts.contact, 0); }
  set contact(v) { this._solveOpts.contact = num(v, 0); }

  /**
   * Bind the rig. Cheap and idempotent — call it again after a model swap.
   * @param {{bone?: object, basis?: object, worldScale?: number, yaw?: number,
   *          faceSign?: number}} rig
   *   bone   the Hips bone (or whatever findRootTrack matched) for hold()
   *   basis  the node whose matrixWorld maps track space to world. The RIGHT
   *          answer is the root bone's PARENT (the armature node): bone.position
   *          is parent-relative, so that is the space the track lives in.
   */
  bind({ bone = null, basis = null, worldScale, yaw, faceSign } = {}) {
    this.bone = bone ?? null;
    // Default the basis to the bone's parent rather than the bone itself — using
    // the bone would fold the animated hip rotation into the displacement and
    // make the character corkscrew.
    this.basis = basis ?? bone?.parent ?? null;
    if (Number.isFinite(worldScale)) this.worldScale = worldScale;
    if (Number.isFinite(yaw)) this.yaw = yaw;
    if (Number.isFinite(faceSign)) this.faceSign = faceSign < 0 ? -1 : 1;
    return this;
  }

  /**
   * Start a root-motion action.
   *
   * @param {string} state logical action name (drives the window queries)
   * @param {object} clip AnimationClip, or a raw track
   * @param {{time?: number, timeScale?: number, duration?: number,
   *          x?: number, z?: number, targetX?: number, targetZ?: number,
   *          contact?: number, boneName?: string, rest?: object,
   *          basis?: object, bone?: object, yaw?: number,
   *          applyY?: boolean, warpY?: boolean}} ctx
   *   contact/applyY/warpY are PER-ACTION and are restored to the instance
   *   defaults by cancel(); nothing here mutates this.opts.
   * @returns {boolean} FALSE means this clip has no usable root motion, i.e. the
   *   action is code driven. That is a normal answer, not a failure — every
   *   in-place locomotion clip returns it.
   */
  begin(state, clip, ctx = {}) {
    this.cancel();
    if (ctx.bone || ctx.basis) this.bind({ bone: ctx.bone ?? this.bone, basis: ctx.basis });
    if (Number.isFinite(ctx.yaw)) this.yaw = ctx.yaw;

    const track = clip?.times ? clip : findRootTrack(clip, ctx.boneName ?? null);
    this.state = resolveAction(state) || (typeof state === 'string' ? state : '');
    this.timeScale = Math.max(1e-3, num(ctx.timeScale, 1));
    this.elapsed = 0;
    this.time = num(ctx.time, 0);

    const keys = track?.times?.length ?? 0;
    if (keys < 2) {
      // In-place clip: nothing to extract. Leave `active` false so update() is a
      // no-op and the motor keeps ownership of the body.
      this.out.state = this.state;
      // ...and drop the action identity, or the bound queries answer about an
      // action that is not running. `elapsed` never advances on this path, so a
      // retained state left phase() reporting 'startup' and remaining() reporting
      // the full clip length forever — a caller gating on "is the character
      // committed" would never see it released. 'none' is the documented safe
      // answer for exactly this case; out.state keeps the name for the caller.
      this.state = '';
      return false;
    }

    this.track = track;
    this.duration = num(clip?.duration, 0) || track.times[keys - 1];
    clipTravel(track, null, this.travel);

    // The rest pose to pin the bone back to. The clip's own first keyframe is the
    // right default: it is exactly "where the authored motion started", so
    // holding there removes precisely the displacement we extracted, no more.
    //
    // All THREE components go through `num`. Validating only .x and copying .y/.z
    // raw let a partial `{x, z}` literal — the shape this very file uses for _rot —
    // write undefined onto the bone in hold(); THREE.Vector3 does not validate, so
    // Matrix4.compose turned that into a NaN matrixWorld and the whole skinned
    // character vanished with nothing on the console.
    if (ctx.rest) {
      this.rest.x = num(ctx.rest.x, 0);
      this.rest.y = num(ctx.rest.y, 0);
      this.rest.z = num(ctx.rest.z, 0);
    } else {
      sampleTrackVec3(track, track.times[0], this.rest);
    }

    this.active = true;
    this.locked = false;
    this._scale.snap(1);
    this._yaw.snap(0);
    this._resetOut();
    this.out.active = true;
    this.out.done = false;
    this.out.state = this.state;

    // Per-action, on the solve-opts object — NOT onto this.opts, which would
    // outlive the action and corrupt every later one. cancel() (run at the top of
    // this method) has already restored the instance default underneath.
    if (Number.isFinite(ctx.contact)) this._solveOpts.contact = ctx.contact;

    // Vertical policy: the ACTION_WINDOWS row is the authority, ctx overrides it
    // for a one-off, and the instance option is the floor for actions with no row.
    const row = ACTION_WINDOWS[this.state] ?? null;
    this.applyY = pickFlag(ctx.applyY, row?.applyY, this.opts.applyY);
    this.warpY = pickFlag(ctx.warpY, row?.warpY, this.opts.warpY);

    if (Number.isFinite(ctx.targetX) && Number.isFinite(ctx.targetZ)) {
      this.haveTarget = true;
      this.targetX = ctx.targetX;
      this.targetZ = ctx.targetZ;
      // Solve immediately so the very first frame is already warped, and SNAP the
      // dampers to it. Letting them ease in from 1.0 would spend the opening
      // frames travelling the unwarped distance, which the rest of the clip then
      // has to make up — visible as a lurch at the start of every lunge.
      this._solve(num(ctx.x, 0), num(ctx.z, 0));
      this._scale.snap(this._wantScale);
      this._yaw.snap(this._wantYaw);
      this.out.scale = this._wantScale;
      this.out.yaw = this._wantYaw;
    }
    return true;
  }

  /**
   * Move the goal mid-action. No-op once past `warpLockAt` — see the comment on
   * that option; this is where "the attack homes through your dodge" is refused.
   * @returns {boolean} whether the solve actually ran
   */
  retarget(targetX, targetZ, curX, curZ) {
    if (!this.active || this.locked) return false;
    if (!Number.isFinite(targetX) || !Number.isFinite(targetZ)) return false;
    this.haveTarget = true;
    this.targetX = targetX;
    this.targetZ = targetZ;
    this._solve(num(curX, 0), num(curZ, 0));
    return true;
  }

  /**
   * Abort — an interrupt, a death, a floor change. Deliberately does NOT touch the
   * bone: the mixer is about to crossfade to something else and pinning the hips
   * on the way out would fight that fade for its whole duration.
   */
  cancel() {
    this.active = false;
    this.locked = false;
    this.haveTarget = false;
    this.track = null;
    this.state = '';
    this.duration = 0;
    this.time = 0;
    this.elapsed = 0;
    this.prevElapsed = 0;
    // Restore everything begin() may have overridden per action, so the next
    // action starts from the instance defaults and never inherits the last one's
    // contact offset or vertical policy.
    this._solveOpts.contact = num(this.opts.contact, 0);
    this.applyY = this.opts.applyY === true;
    this.warpY = this.opts.warpY === true;
    // A stale rest must not be reachable: hold() is guarded on this.track, which
    // is cleared above, but zeroing here means even a forced hold cannot pin the
    // hips to a previous action's origin.
    this.rest.x = 0; this.rest.y = 0; this.rest.z = 0;
    this._wantScale = 1;
    this._wantYaw = 0;
    this._scale.snap(1);
    this._yaw.snap(0);
    this._resetOut();
    return this;
  }

  _resetOut() {
    const o = this.out;
    o.active = false; o.done = true; o.phase = 'none';
    o.dx = 0; o.dy = 0; o.dz = 0;
    o.x = 0; o.y = 0; o.z = 0;
    o.progress = 0; o.elapsed = 0;
    o.scale = 1; o.yaw = 0; o.residual = 0; o.reach = 1; o.warped = false;
  }

  /** Track-space -> world, via the basis node when we have one. */
  _toWorld(lx, ly, lz, out) {
    const e = this.basis?.matrixWorld?.elements;
    if (e) return matrixToWorld(e, lx, ly, lz, out);
    return yawToWorld(lx, ly, lz, this.yaw, this.faceSign, this.worldScale, out);
  }

  /**
   * Solve against the trajectory REMAINING from the current clip time, measured
   * from where the character actually is. Using the remaining travel rather than
   * the whole clip is what makes a re-solve continuous: the part already walked is
   * baked into the position we are measuring from, so only the direction changes,
   * never the place.
   */
  _solve(curX, curZ, fromTime = this.time) {
    if (!this.track || !this.haveTarget) return;
    // `fromTime` MUST be the clip time that (curX, curZ) corresponds to — the
    // START of the frame, not the end. Solving the remaining trajectory from the
    // new time against the old position leaves this frame's segment out of the
    // denominator but inside the measured distance, and every frame overshoots by
    // that segment. It converges to a consistent ~2% long, which reads as an
    // attack that reliably lands a step past the target.
    rootDelta(this.track, fromTime, this.duration, this.duration, _lv);
    this._toWorld(_lv.x, _lv.y, _lv.z, _wv);
    solveWarp(_wv.x, _wv.z, this.targetX - curX, this.targetZ - curZ, _sol, this._solveOpts);
    this.stats.solves++;
    if (!_sol.ok) return;
    this._wantScale = _sol.scale;
    this._wantYaw = _sol.yaw;
    this.out.residual = _sol.residual;
    this.out.reach = _sol.reach;
    this.out.warped = _sol.clamped
      || Math.abs(_sol.scale - 1) > 1e-3 || Math.abs(_sol.yaw) > 1e-3;
  }

  /** World scale on the horizontal axes, however the basis was supplied. */
  _scaleXZ() {
    const e = this.basis?.matrixWorld?.elements;
    return e ? matrixScaleXZ(e) : num(this.worldScale, 1);
  }

  /**
   * @param {number} dt seconds
   * @param {{time?: number, x?: number, z?: number, targetX?: number,
   *          targetZ?: number, timeScale?: number}} ctx
   *   time  the AnimationAction's clip time. Strongly preferred over letting us
   *         integrate dt ourselves — the mixer is the authority on where the clip
   *         is, and a controller crossfade or a hit-stop makes an internal clock
   *         drift out of phase with the pose the displacement belongs to.
   * @returns {typeof RootMotionWarp.prototype.out} stable object, mutated
   */
  update(dt, ctx = {}) {
    const o = this.out;
    o.dx = 0; o.dy = 0; o.dz = 0;
    if (!this.active || !this.track) {
      o.active = false;
      return o;
    }

    const step = Math.max(0, num(dt, 0));
    if (Number.isFinite(ctx.timeScale)) this.timeScale = Math.max(1e-3, ctx.timeScale);
    this.prevElapsed = this.elapsed;
    this.elapsed += step;

    const prev = this.time;
    const next = Number.isFinite(ctx.time) ? ctx.time : this.time + step * this.timeScale;
    this.time = this.duration > 0 ? Math.min(next, this.duration) : next;

    const progress = this.duration > 0 ? clamp(this.time / this.duration, 0, 1) : 1;
    o.progress = progress;
    o.elapsed = this.elapsed;
    o.phase = windowPhase(this.state, this.elapsed, this);

    // Close the warp before the hit frame. After this the trajectory is fixed and
    // the target can dodge it — which is the entire point of a telegraph.
    if (!this.locked && progress >= num(this.opts.warpLockAt, 0.55)) this.locked = true;
    if (!this.locked && this.haveTarget
      && Number.isFinite(ctx.targetX) && Number.isFinite(ctx.targetZ)) {
      this.targetX = ctx.targetX;
      this.targetZ = ctx.targetZ;
    }
    if (!this.locked && this.haveTarget && Number.isFinite(ctx.x) && Number.isFinite(ctx.z)) {
      this._solve(ctx.x, ctx.z, prev);
    }

    // Damped so a re-solve cannot pop the body. Critically damped, so it can
    // never overshoot the solved scale and sail past the target.
    const scale = this._scale.to(this._wantScale, step);
    const yaw = this._yaw.to(this._wantYaw, step);
    o.scale = scale;
    o.yaw = yaw;

    rootDelta(this.track, prev, this.time, this.duration, _lv);
    this._toWorld(_lv.x, _lv.y, _lv.z, _wv);
    warpDelta(_wv.x, _wv.y, _wv.z, scale, yaw, this.warpY === true, _lv);

    let dx = num(_lv.x, 0);
    let dy = this.applyY === true ? num(_lv.y, 0) : 0;
    let dz = num(_lv.z, 0);

    // Teleport guard. A clip restart, a floor change or a corrupted track would
    // otherwise emit one enormous delta and fling the character across the map.
    // Budgeted as a RATE so a long-but-legitimate LOD substep survives it — see
    // maxStepSpeed in WARP_DEFAULTS for why an absolute metre cap was wrong.
    const budget = Math.max(0, num(this.opts.maxStepSpeed, 12))
      * Math.max(step, Math.max(1e-6, num(this.opts.minStepDt, 1 / 240)));
    if (budget > 0 && Math.hypot(dx, dy, dz) > budget) {
      dx = 0; dy = 0; dz = 0;
      this.stats.rejected++;
    }

    o.dx = dx; o.dy = dy; o.dz = dz;
    o.x += dx; o.y += dy; o.z += dz;
    this.stats.steps++;

    if (this.duration > 0 && this.time >= this.duration - 1e-5) {
      o.done = true;
      o.active = false;
      this.active = false;
    }
    return o;
  }

  /**
   * Pin the visual root back where the clip started, so the character does not
   * travel twice — once via the bone and once via the displacement we just handed
   * the caller. Call AFTER mixer.update() and after update(); either order slip
   * fails silently (double motion, or no motion at all).
   *
   * Y is only pinned when we actually extracted it. Otherwise the authored
   * vertical bob stays, which is what an in-place clip wants — and it also keeps
   * us out of AnimationController._applyBones' way, which writes hips.position.y.
   *
   * Gated on `this.track` — the ACTION BINDING, which begin() sets and only
   * cancel() clears. That is deliberately not `this.active` and not `out.active`:
   * update() clears both on the same frame it emits the final delta, so gating on
   * either would leave the completing frame unpinned and the visual hips would
   * snap forward by the clip's whole travel (2 m at 1x, 4.8 m on a 2.4x boss) for
   * exactly one frame. With the track as the gate the caller's rule is simply
   * "call hold() every frame until you call cancel()", and an unconditional
   * hold() in a generic character tick can no longer clamp the hips of every
   * in-place clip that follows to the previous action's rest — or to the origin.
   *
   * @param {object} [bone] override; defaults to the bound one
   * @returns {boolean} false when no action is bound or there is no bone — a rig
   *   missing Hips still plays, it just double-moves, which beats throwing
   *   mid-frame.
   */
  hold(bone = this.bone) {
    if (!this.track) return false;
    const p = bone?.position;
    if (!p) return false;
    p.x = this.rest.x;
    p.z = this.rest.z;
    if (this.applyY === true) p.y = this.rest.y;
    return true;
  }

  // ---- convenience over the running action (the window queries, bound) ----

  /** @returns {'none'|'startup'|'active'|'recovery'|'done'} */
  phase() { return windowPhase(this.state, this.elapsed, this); }
  /** Is this action's hitbox live right now? */
  isActive() { return isActive(this.state, this.elapsed, this); }
  /** May `into` interrupt what is running? */
  canCancel(into = null) { return canCancel(this.state, this.elapsed, into, this); }
  /** Seconds until the action releases the character. */
  remaining() { return windowRemaining(this.state, this.elapsed, this); }
  /** Planar metres this clip covers in the WORLD, at this character's scale. */
  travelPlanar() { return this.travel.planar * this._scaleXZ(); }
  /** Pre-flight, with this instance's clamps AND the running action's contact. */
  canReach(dist) { return canReach(this.travelPlanar(), dist, this._solveOpts); }
  /**
   * LOD-safe hitbox query: did the last update() step ACROSS the damage window?
   * Prefer this to isActive() for anything the substep scheduler drives.
   */
  crossedActive() { return crossedActive(this.state, this.prevElapsed, this.elapsed, this); }
}

/** Factory, matching makeFootLock/createCharacterIK in this folder. */
export function makeRootMotionWarp(opts = {}) {
  return new RootMotionWarp(opts);
}
