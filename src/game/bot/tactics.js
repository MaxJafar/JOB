// ============ bot combat doctrine & execution ============
//
// This module answers exactly one question, once per frame, per bot:
//
//     "given where I am, who I am shooting at, and what my kit is —
//      do I pull the trigger, and where do I point?"
//
// It NEVER damages anything, spawns anything, moves anything or touches the
// scene. It reads the world, advances its own weapon clocks, and returns a
// decision. The BotPlayer that owns the bot is what actually calls
// `cls.primary.fire(game, bot, decision.aim)`.
//
// WHY THAT SPLIT: the class kits in ../classes.js are the real, shipping
// weapons. If bots invoke them with a plausible aim vector and honest
// cooldowns, then playtesting the bots playtests the kits. The moment this
// file starts reimplementing "what a stapler does", that guarantee is gone.
//
// THE THREE THINGS THAT WOULD RUIN THE PLAYTEST, AND HOW THEY ARE PREVENTED:
//
//  1. Aimbots. A bot that never misses makes every fight easier than the real
//     thing, so pacing data collected beside it is worthless. Countered by
//     an aim-error cone that opens on acquisition and closes over ~0.45 s of
//     tracking, a 0.18-0.36 s reaction delay, per-shot error resampling, and
//     yaw-gated firing for the cone/melee kits (whose accuracy IS their yaw).
//
//  2. Wallhacks. `Player.beamTick` performs NO line-of-sight test and will
//     happily damage through a cubicle wall (see player.js:674). Every fire
//     gate here goes through `game.combat.lineOfSight` first.
//
//  3. Infinite ammo. A bot that ignores the magazine is testing a weapon that
//     does not exist. Cooldowns, magazines, reloads and the IT heat gauge are
//     mirrored from Player.update exactly, including `stats.atkCdMult`.
//
// KAREN IS THE OTHER HARD RULE. She is 950 hp / 51 DPS, starts idle, and ANY
// damage provokes her permanently onto whoever touched her (game.js:1070). A
// bot that clips her with a stray pierce/fan/AoE and then dies leaves a hunter
// loose in the run. So "never target karen" is not enough — every firing line,
// cone and placement is checked against her too.
//
// NO PER-FRAME ALLOCATION: all vectors and scratch arrays are module-scope and
// reused. The returned `aim` aliases those temps and is only valid until the
// next `decideCombat` call — the kits copy/clone what they keep, which is why
// that is safe (classes.js:25, :28, :137, :163).

import * as THREE from 'three';
import { clamp, rand, damp, angleDelta } from '../../core/utils.js';
import { Damper } from '../../core/spring.js';
import { CLASS_BY_KEY } from '../classes.js';

// ---------------------------------------------------------------- module temps
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _point = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _aimPoint = new THREE.Vector3();
const _center = new THREE.Vector3();
const _lead = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _predict = new THREE.Vector3();
const _cluster = new THREE.Vector3();
const _ahead = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _swing = { range: 0, arcDeg: 0, fireYawDeg: 0, isHaymaker: false };
const WORLD_UP = new THREE.Vector3(0, 1, 0);

// The one aim object handed to the kits. Reused; see the alias note above.
const _aim = { origin: _origin, dir: _dir, point: _point, camDir: _camDir };

// The one decision object handed back to the orchestrator. Same lifetime rule.
const _decision = {
  act: 'hold',
  aim: _aim,
  aimTarget: null,
  yaw: 0,
  yawErr: 0,
  standoff: 8,
  teamSpacing: 3.5,
  hasLos: false,
  forget: false,
  reason: '',
};

// Nearby-enemy scratch. Parallel arrays instead of {e,d} wrappers so a 42-mob
// scan costs zero garbage after the arrays have grown once.
const _near = [];
const _nearD = [];
const _scores = [];
const _ctx = {
  game: null,
  bot: null,
  doc: null,
  cls: null,
  target: null,
  dist: 0,
  aimX: 0,
  aimZ: 1,
  hpFrac: 1,
  humanDist: 0,
  n: 0,
  idleKaren: null,
  influencers: 0,
  gossips: 0,
  techs: 0,
  lockdown: false,
};

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** How far out the per-frame enemy scan looks. Covers HR's 26 m homing reach. */
export const SCAN_RADIUS = 30;

/** What `decideCombat` can ask the orchestrator to do. */
export const BOT_ACT = {
  HOLD: 'hold',
  PRIMARY: 'primary',
  SECONDARY: 'secondary',
  RELOAD: 'reload',
  BLOCK: 'block',
};

// ============================================================================
// DOCTRINE — the whole tuning surface, in data, live-editable at runtime.
// ============================================================================
//
// band       engagement geometry the mover should honour, in metres.
//            `hold` is the standing distance; `min`/`max` are where the bot
//            starts wanting to back off / close in.
// weapon     the physical facts the executor needs: projectile speed for lead,
//            reach for the fire gate, whether aim is a ray or a yaw.
// aim        the human-plausibility model. `acquireDeg` is the error cone the
//            instant a target is picked; it decays to `settleDeg` over
//            `settleTime` while the bot keeps tracking. `settleDeg` must stay
//            at or above the weapon's own spread or the class stops working —
//            the accountant's calculator already scatters +/-1.15 deg, and a
//            0.5 m target at 15 m subtends 1.9 deg, so ~1.0-1.5 deg is the
//            floor that keeps that class functional without being a laser.
// reload     `at` is the magazine fraction below which the bot tops up, but
//            only when nothing is inside `safeDist`. Reloading in someone's
//            face is a human mistake bots should not make on purpose.
// secondary  `trigger(c)` is a pure predicate over the scan context. It is
//            evaluated on a throttle (SECONDARY_EVAL_PERIOD), never per frame:
//            a bot re-deciding its ultimate at 60 Hz reads as a machine.
export const BOT_DOCTRINE = {
  // ---------------------------------------------------------------- intern
  // Eager and slightly reckless: sits 1 m closer than is wise so he can keep
  // shooting, and is the one who runs dry at the worst moment.
  intern: {
    role: 'ranged',
    band: { min: 5, hold: 10.5, max: 20 },
    weapon: {
      kind: 'projectile',
      speed: 56, // staple muzzle velocity — 0.21 s of lead at 12 m
      ttl: 2,
      range: 22,
      aimBy: 'ray',
      losMode: 'grace',
      aoe: 0,
      pierce: 0,
      homing: 0,
    },
    aim: {
      acquireDeg: 5.5,
      settleDeg: 1.5,
      settleTime: 0.45,
      trackPenalty: 20, // extra degrees per rad/s of target angular rate
      reactMin: 0.2,
      reactMax: 0.34,
      fireYawDeg: 50,
      losGrace: 0.35,
    },
    reload: { at: 0.3, safeDist: 8 },
    // Performance Sprint is a 16 deg fan: five staples only all connect on a
    // big body or a packed line. Fired as a generic damage button it is five
    // misses and a 5 s cooldown.
    secondary: {
      aimMode: 'ray',
      halfDeg: 8,
      guardLen: 12,
      trigger: (c) =>
        heavyWithin(c, 6) || countInCone(c, 8, 8, c.aimX, c.aimZ) >= 3,
      reason: 'fan into a packed line',
    },
  },

  // --------------------------------------------------------------- janitor
  // The immovable one. Walks at things, never retreats, leaves last.
  janitor: {
    role: 'melee',
    band: { min: 0, hold: 2.2, max: 3.0 },
    weapon: {
      kind: 'melee',
      speed: 0,
      range: 3.0,
      arcDeg: 140,
      aimBy: 'yaw',
      losMode: 'strict',
      aoe: 0,
    },
    aim: {
      acquireDeg: 0,
      settleDeg: 0,
      settleTime: 0.3,
      trackPenalty: 0,
      reactMin: 0.18,
      reactMax: 0.3,
      fireYawDeg: 55, // arc is +/-70; 55 keeps margin for a moving target
      losGrace: 0,
    },
    reload: null,
    // "Lid Up" is not an ability, it is a state (classes.js:68 is a no-op).
    // The 75% reduction lives in Player.damage over a 151 deg frontal arc, and
    // it GATES PRIMARY FIRE OFF (player.js:976). A bot that blocks forever
    // deals zero damage and reports a false wave-clear time, so the hold is
    // bounded and followed by a forced swing window.
    block: {
      meleeCount: 2,
      meleeRange: 2.5,
      hpFrac: 0.45,
      chargerRange: 15,
      minHold: 0.6,
      maxHold: 1.2,
      riotMaxHold: 2.0, // riotlid makes blocking offensive, so hold longer
      // The forced swing window has to be long enough to actually swing TWICE
      // at the 0.52 s Clean Sweep cadence. At 0.5 s the bot spent 71% of a
      // fight behind the lid and cleared waves at a third of the real rate,
      // which is exactly the kind of quiet measurement corruption that makes a
      // playtest lie to you.
      lockout: 1.1,
    },
    secondary: null,
  },

  // ------------------------------------------------------------ accountant
  // The tripod. Picks a firing position, stays, focuses one target to death,
  // and buffs the team on schedule.
  accountant: {
    role: 'ranged',
    band: { min: 8, hold: 16, max: 25 },
    weapon: {
      kind: 'projectile',
      speed: 62,
      ttl: 1.6,
      range: 24,
      aimBy: 'ray',
      losMode: 'grace',
      aoe: 0,
      pierce: 0,
      homing: 0,
    },
    aim: {
      acquireDeg: 5.0,
      // The weapon itself already scatters +/-1.15 deg (classes.js:84). Adding
      // much on top of that turns 12.5 shots/s into a hosepipe and the class
      // silently stops being the single-target answer it is designed as.
      settleDeg: 1.0,
      settleTime: 0.5,
      trackPenalty: 16,
      reactMin: 0.22,
      reactMax: 0.36,
      fireYawDeg: 50,
      losGrace: 0.35,
    },
    reload: { at: 0.25, safeDist: 9 },
    // Tax Audit is +30% team-wide damage taken for 6 s on an 11 s cooldown.
    // Uptime IS the value; holding it for a better moment is a net loss.
    secondary: {
      aimMode: 'self',
      trigger: (c) => countWithin(c, 14) >= 4 || heavyWithin(c, 14) || c.lockdown,
      reason: 'audit the room',
    },
    // taxbomb turns every 25th shot into a 3.2 m AoE orb. A bot that notices
    // and points that one shot at the cluster is the difference between the
    // upgrade reading as "nice" and reading as "a build".
    bombEvery: 25,
    bombAoe: 3.2,
  },

  // -------------------------------------------------------------------- hr
  // Thinks about the floor, not the target. Always dropping a zone ahead of
  // the team; never top of the damage chart.
  hr: {
    role: 'ranged',
    band: { min: 7, hold: 12, max: 22 },
    weapon: {
      kind: 'projectile',
      speed: 34, // slowest in the game — the largest lead of any kit
      ttl: 3.2,
      range: 20,
      aimBy: 'ray',
      losMode: 'grace',
      aoe: 0,
      pierce: 0,
      homing: 3.4,
    },
    aim: {
      // Homing forgives aim, so precision here is theatre — but it must still
      // LOOK like aiming or the class reads as a turret.
      acquireDeg: 7,
      settleDeg: 3.0,
      settleTime: 0.5,
      trackPenalty: 10,
      reactMin: 0.2,
      reactMax: 0.34,
      fireYawDeg: 55,
      losGrace: 0.4,
    },
    // 9-round magazine = 31% downtime. Reload discipline matters more on this
    // kit than any other, so the threshold is deliberately generous.
    reload: { at: 0.34, safeDist: 8 },
    // Mandatory Meeting is placed at aim.point. Place it where the horde WILL
    // be in half a second, not where it is — a zone dropped on a moving pack
    // catches nobody.
    secondary: {
      aimMode: 'point',
      radius: 6.5,
      bigRadius: 8.5,
      lookahead: 0.5,
      placeRange: 18,
      trigger: (c) => bestCluster(c, c.doc.secondary.radius, 0.5, 18) >= 3,
      reason: 'zone ahead of the pack',
    },
  },

  // -------------------------------------------------------------------- it
  // The support who never stops working: beam pulsing in a rhythm, a turret
  // always down, last one standing because of the regen.
  it: {
    role: 'mid',
    band: { min: 4, hold: 10, max: 15 },
    weapon: {
      kind: 'beam',
      speed: 0, // hitscan-ish tick: never lead
      ttl: 0,
      range: 15.2, // beamTick hard-stops at 16 m; 15.2 keeps a moving margin
      aimBy: 'ray',
      // STRICT, not grace: beamTick has no LOS test of its own and will damage
      // straight through a cubicle wall. This gate is the only thing stopping
      // the most blatant aimbot tell in the game.
      losMode: 'strict',
      aoe: 0,
      pierce: 0,
      homing: 0,
    },
    aim: {
      acquireDeg: 4.0,
      settleDeg: 2.2, // 1.4 m + radius off-axis tolerance is forgiving
      settleTime: 0.4,
      trackPenalty: 12,
      reactMin: 0.18,
      reactMax: 0.3,
      fireYawDeg: 50,
      losGrace: 0,
    },
    reload: null,
    // Heat is managed by Player.update, NOT by the kit — a bot must run it
    // itself. Numbers mirrored from player.js:966-995 exactly.
    //   +0.032/shot at 11.1 shots/s = +0.356/s firing, -0.55/s idle, lock 1.8 s
    // Cutting at 0.80 and resuming at 0.30 gives 1.41 s on / 0.91 s off and the
    // 1.8 s lockout literally never happens — which is what a good human does.
    heat: {
      perShot: 0.032,
      decay: 0.55,
      beamHeatDecay: 1.6,
      lockTime: 1.8,
      cutHigh: 0.8,
      cutLow: 0.3,
      overclockCutHigh: 0.9, // overclock rewards longer pulls
    },
    // Turret ttl 25 s > cooldown 14 s, so 100% uptime is available. Recast on
    // cooldown during a lockdown; otherwise only for a real cluster.
    secondary: {
      aimMode: 'point',
      placeRange: 8, // >8 m from the bot and the kit snaps it to the bot's feet
      trigger: (c) => c.lockdown || bestCluster(c, 12, 0, 8) >= 3,
      reason: 'router on the pack',
    },
  },

  // ----------------------------------------------------------------- sales
  // Never stands still. Always flanking, always lining people up, first to
  // reach someone who went down.
  sales: {
    role: 'ranged',
    band: { min: 6, hold: 10, max: 16 },
    weapon: {
      kind: 'projectile',
      speed: 48,
      ttl: 2.4,
      range: 18,
      aimBy: 'ray',
      losMode: 'grace',
      aoe: 0,
      pierce: 3, // up to 4 bodies per card
      homing: 0,
    },
    aim: {
      acquireDeg: 5.5,
      settleDeg: 1.4,
      settleTime: 0.45,
      trackPenalty: 18,
      reactMin: 0.19,
      reactMax: 0.32,
      fireYawDeg: 50,
      losGrace: 0.35,
    },
    reload: { at: 0.28, safeDist: 8 },
    // The behaviour that makes Sales read differently from Intern: do not just
    // shoot the nearest thing, shoot the angle that skewers the most bodies.
    pierceSeek: { radius: 0.75, maxRange: 18, period: 0.2 },
    // Cold Call is a peel tool with the biggest non-boss shove in the game,
    // not a damage button.
    secondary: {
      aimMode: 'yaw',
      range: 9,
      halfDeg: 35,
      fireYawDeg: 22,
      trigger: (c) =>
        countInCone(c, 9, 35, c.aimX, c.aimZ) >= 3 ||
        (c.hpFrac < 0.4 && countWithin(c, 4) >= 1),
      reason: 'peel with the shove',
    },
  },

  // ------------------------------------------------------------- marketing
  // Chaotic and always moving: drifts, overshoots, boosts through the middle
  // of the pack, dies first if left alone.
  marketing: {
    role: 'mid',
    band: { min: 2, hold: 5, max: 7 },
    weapon: {
      kind: 'cone',
      speed: 0,
      range: 7.5,
      // meleeArc's `angle` is the FULL cone, so 42 means +/-21 deg — the
      // tightest aim window in the game, and it reads player.yaw ONLY
      // (classes.js:232). This class's accuracy IS its yaw damper.
      arcDeg: 42,
      aimBy: 'yaw',
      losMode: 'strict',
      aoe: 0,
    },
    aim: {
      acquireDeg: 0,
      settleDeg: 0,
      settleTime: 0.25,
      trackPenalty: 0,
      reactMin: 0.18,
      reactMax: 0.28,
      fireYawDeg: 16, // inside +/-21 with margin
      losGrace: 0,
    },
    reload: null,
    // Full Send is 26 m/s for 0.9 s. Launched into a wall it is a wasted 7 s
    // cooldown and looks broken, so it is always segment-checked first.
    secondary: {
      aimMode: 'yaw',
      wallCheck: 12,
      fireYawDeg: 25,
      trigger: (c) =>
        (c.hpFrac < 0.35 && countWithin(c, 3) >= 2) ||
        countCorridor(c, 12, 2.2, c.aimX, c.aimZ) >= 3 ||
        c.humanDist > 18,
      reason: 'ride the extinguisher',
    },
  },

  // --------------------------------------------------------------- brawler
  // Slow, immovable, arrives last and leaves last. The one who gets between
  // the human and the copier.
  brawler: {
    role: 'melee',
    band: { min: 0, hold: 2.4, max: 3.6 },
    weapon: {
      kind: 'melee',
      speed: 0,
      range: 2.6, // jab; the haymaker reaches 3.6 and is handled below
      arcDeg: 85,
      aimBy: 'yaw',
      losMode: 'strict',
      aoe: 0,
    },
    aim: {
      acquireDeg: 0,
      settleDeg: 0,
      settleTime: 0.3,
      trackPenalty: 0,
      reactMin: 0.18,
      reactMax: 0.3,
      fireYawDeg: 36, // jab arc is +/-42.5
      losGrace: 0,
    },
    reload: null,
    // Every 3rd punch (2nd with southpaw) is a 2.6x haymaker with a wider arc.
    // Throwing it at one paperling wastes the class's whole damage profile, so
    // the bot will sit on the punch briefly waiting for the arc to fill.
    haymaker: { range: 3.6, arcDeg: 130, fireYawDeg: 58, holdMax: 0.5, wantTargets: 2 },
    secondary: {
      aimMode: 'yaw',
      wallCheck: 14,
      fireYawDeg: 25,
      trigger: (c) =>
        countCorridor(c, 14, 2.2, c.aimX, c.aimZ) >= 3 ||
        specialBetween(c, 5, 14) ||
        (c.hpFrac < 0.3 && countWithin(c, 3.5) >= 2),
      reason: 'body check through it',
    },
  },
};

/** How often the secondary trigger predicate is re-evaluated, in seconds. */
export const SECONDARY_EVAL_PERIOD = 0.15;

/** How often the aim-error sample is re-rolled while holding on a target. */
export const AIM_SAMPLE_PERIOD = 0.1;

/** Fallback for a class key with no doctrine — degrade, never crash. */
const FALLBACK_DOCTRINE = BOT_DOCTRINE.intern;

// ============================================================================
// THREAT — who to shoot, and who to never touch.
// ============================================================================
//
// Base weights straight off the enemy roster's actual threat to the HUMAN.
// The scorer then multiplies by urgency (is it mid-telegraph? is it about to
// pop?) and divides by distance-to-human, because the entire point of a bot
// teammate is to take pressure off the person holding the mouse.
export const THREAT_BASE = {
  karen: -Infinity, // see karenIsUntouchable() — never, under any circumstance
  gossip: 100, // pops at 3 m and goo-marks the whole party
  micromanager: 95, // rides the human and halves their speed
  streamer: 90, // marks everyone at 22 m AND queues a horde
  motivator: 85, // rally makes roombas outrun a sprinting janitor
  sysadmin: 80, // 5 m shock field, and shock removes the dash
  mediator: 75, // 17 m leash
  roomba: 60, // ranged only — melee gets 0, see the role guard below
  itguy: 55, // arc chains to a second teammate within 6 m
  complainer: 50,
  closer: 50,
  boss: 45,
  auditor: 40,
  pylon: 35, // ranged only
  hrrep: 30, // dangerous by count, not individually
  influencer: 20, // trash until there are three of them screaming
  copier: 15,
  printer: 12,
  drone: 10,
  quad: 10,
  intake: 10,
  growth: 10,
  paperling: 10,
};

const DEFAULT_THREAT = 10;

/** Enemies a melee bot must never walk into. */
const MELEE_FORBIDDEN = {
  // 3.4 m blast vs a 3.0 m broom / 3.6 m haymaker: the trade cannot be won
  // unless the swing one-shots, which stops being true above director coeff
  // ~0.2 because enemy hp scales 30% per coefficient point.
  roomba: true,
  // 4.4 m aura, 13 DPS plus a rolling ability lockout, 250 hp.
  pylon: true,
};

/** Melee-ish AI kinds, for the janitor's block predicate. */
const MELEE_AI = {
  melee: true,
  kamikaze: true,
  stunner: true,
  charger: true,
  screamer: true,
  jockey: true,
  karen: true,
  auditor: true,
};

// ============================================================================
// state
// ============================================================================

/**
 * Per-bot tactics state. The orchestrator stores this on the bot; if it forgets,
 * `decideCombat` lazily creates one rather than throwing.
 */
export function createTacticsState() {
  return {
    // aim model
    err: new Damper(6, 0.45), // current aim error, degrees
    ox: 0, // current unit-disk error sample
    oy: 0,
    sampleT: 0,

    // acquisition / memory
    targetId: -1,
    reactT: 0,
    trackT: 0,
    lostT: 0,
    hadLos: false,
    lastSeen: new THREE.Vector3(),

    // measured target velocity (enemies carry no `vel` field, so it is
    // finite-differenced and smoothed — noisy, which is fine: noisy lead is
    // exactly what a human produces)
    velId: -1,
    px: 0,
    py: 0,
    pz: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    velWarm: false,

    // secondary throttle
    secT: 0,
    secWant: false,
    secReason: '',

    // per-class resources
    blockT: 0,
    blockLock: 0,
    beamCut: false,
    holding: false,
    hayHoldT: 0,
    pierceT: 0,
    pierceId: -1,
    pierceCount: 0,
  };
}

/**
 * Drop everything tied to a floor or a run. Called on floor change and on
 * dispose: holding an enemy reference across `teardownRun` would pin a disposed
 * mesh, and holding a stale lastSeen position would make the bot shoot at a
 * wall on the new floor.
 */
export function resetTactics(state) {
  if (!state) return;
  state.err.snap(6);
  state.targetId = -1;
  state.reactT = 0;
  state.trackT = 0;
  state.lostT = 0;
  state.hadLos = false;
  state.velId = -1;
  state.velWarm = false;
  state.vx = 0;
  state.vy = 0;
  state.vz = 0;
  state.secWant = false;
  state.secT = 0;
  state.blockT = 0;
  state.blockLock = 0;
  state.beamCut = false;
  state.holding = false;
  state.hayHoldT = 0;
  state.pierceId = -1;
  state.pierceCount = 0;
}

/** Doctrine lookup that degrades instead of throwing on an unknown class. */
export function doctrineFor(classKey) {
  return BOT_DOCTRINE[classKey] ?? FALLBACK_DOCTRINE;
}

// ============================================================================
// scan — one pass over the enemy list, reused by scoring and by the triggers
// ============================================================================

function buildCtx(game, bot, doc, target) {
  _near.length = 0;
  _nearD.length = 0;
  _ctx.game = game;
  _ctx.bot = bot;
  _ctx.doc = doc;
  _ctx.cls = CLASS_BY_KEY[bot?.classKey] ?? null;
  _ctx.target = target ?? null;
  _ctx.n = 0;
  _ctx.idleKaren = null;
  _ctx.influencers = 0;
  _ctx.gossips = 0;
  _ctx.techs = 0;
  _ctx.lockdown = !!game?.lockdown;
  _ctx.hpFrac = clamp((bot?.hp ?? 1) / Math.max(1, bot?.maxHp ?? 1), 0, 1);

  const human = game?.player;
  _ctx.humanDist = human && !human.dead ? dist2(bot.pos, human.pos) : 0;

  // Facing, used by every cone/corridor predicate. Falls back to the bot's own
  // yaw when there is no target OR when a caller hands us a half-built one, so
  // the triggers never see NaN and a malformed target cannot end the run.
  if (target?.pos) {
    const dx = target.pos.x - bot.pos.x;
    const dz = target.pos.z - bot.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    _ctx.aimX = dx / d;
    _ctx.aimZ = dz / d;
    _ctx.dist = d;
  } else {
    _ctx.aimX = Math.sin(bot?.yaw ?? 0);
    _ctx.aimZ = Math.cos(bot?.yaw ?? 0);
    _ctx.dist = 0;
  }

  const list = game?.enemies;
  if (!list) return _ctx;
  const r2 = SCAN_RADIUS * SCAN_RADIUS;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e || e.dead || !e.pos) continue;
    const dx = e.pos.x - bot.pos.x;
    const dz = e.pos.z - bot.pos.z;
    const d2v = dx * dx + dz * dz;
    if (d2v > r2) continue;
    const d = Math.sqrt(d2v);
    _near.push(e);
    _nearD.push(d);
    switch (e.key) {
      case 'influencer':
        _ctx.influencers++;
        break;
      case 'gossip':
        _ctx.gossips++;
        break;
      case 'itguy':
        _ctx.techs++;
        break;
      case 'karen':
        // Only an IDLE Karen is a hazard to avoid clipping: once provoked she
        // has already chosen a victim and further damage changes nothing
        // (Enemy.provoke early-returns when state !== 'idle').
        if (e.state === 'idle' && (!_ctx.idleKaren || d < dist2(bot.pos, _ctx.idleKaren.pos))) {
          _ctx.idleKaren = e;
        }
        break;
      default:
        break;
    }
  }
  _ctx.n = _near.length;
  return _ctx;
}

function dist2(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

// ------------------------------------------------------------- ctx predicates

/** Live enemies within `r` metres of the bot. */
export function countWithin(c, r) {
  let n = 0;
  for (let i = 0; i < c.n; i++) if (_nearD[i] <= r) n++;
  return n;
}

/** Live enemies inside a `+/-halfDeg` cone of (dx,dz), within `r` metres. */
export function countInCone(c, r, halfDeg, dx, dz) {
  const half = Math.cos(halfDeg * DEG);
  let n = 0;
  for (let i = 0; i < c.n; i++) {
    const d = _nearD[i];
    if (d > r) continue;
    if (d < 0.35) {
      n++;
      continue;
    }
    const e = _near[i];
    const ux = (e.pos.x - c.bot.pos.x) / d;
    const uz = (e.pos.z - c.bot.pos.z) / d;
    if (ux * dx + uz * dz >= half) n++;
  }
  return n;
}

/** Live enemies inside a rectangular corridor — the shape a charge sweeps. */
export function countCorridor(c, len, halfWidth, dx, dz) {
  let n = 0;
  for (let i = 0; i < c.n; i++) {
    const e = _near[i];
    const rx = e.pos.x - c.bot.pos.x;
    const rz = e.pos.z - c.bot.pos.z;
    const along = rx * dx + rz * dz;
    if (along < 0 || along > len) continue;
    const off = Math.abs(rx * dz - rz * dx);
    if (off <= halfWidth + (e.radius ?? 0.5)) n++;
  }
  return n;
}

/** Is there a big/rare/boss body worth spending a burst on? */
export function heavyWithin(c, r) {
  for (let i = 0; i < c.n; i++) {
    if (_nearD[i] > r) continue;
    const def = _near[i].def;
    if (def?.big || def?.rare || def?.boss) return true;
  }
  return false;
}

/** A special (not Karen) in the `lo..hi` shell — the Body Check window. */
export function specialBetween(c, lo, hi) {
  for (let i = 0; i < c.n; i++) {
    const d = _nearD[i];
    if (d < lo || d > hi) continue;
    const e = _near[i];
    if (e.key === 'karen') continue;
    if (e.def?.special) return true;
  }
  return false;
}

/**
 * Where enemy `e` will be in `t` seconds, assuming it keeps walking at its own
 * enemy toward its own target. Cheaper and steadier than finite-differencing
 * every mob, and it is what the AI is actually going to do.
 */
function predictPos(e, t, out) {
  out.set(e.pos.x, e.pos.y, e.pos.z);
  if (t <= 0) return out;
  const tp = e.target?.pos;
  if (!tp) return out;
  const dx = tp.x - e.pos.x;
  const dz = tp.z - e.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.5) return out;
  const step = Math.min((e.speed ?? 3) * t, d);
  out.x += (dx / d) * step;
  out.z += (dz / d) * step;
  return out;
}

/**
 * Densest cluster of enemies, predicted `lookahead` seconds forward. Writes the
 * winning centre to the module `_cluster` temp (read it with `clusterPoint()`)
 * and returns the head count.
 *
 * Placing a zone where the pack IS catches nobody: by the time the kit resolves,
 * a 6 m/s pack has already left. Placing where it WILL BE is the whole trick.
 */
export function bestCluster(c, radius, lookahead, maxDist) {
  let bestN = 0;
  _cluster.set(c.bot.pos.x, 0, c.bot.pos.z);
  // Bound the O(n^2): 24 candidates is ~576 comparisons at worst, and this only
  // runs on the secondary throttle, not per frame.
  const cand = Math.min(c.n, 24);
  const r2 = radius * radius;
  for (let i = 0; i < cand; i++) {
    if (_nearD[i] > maxDist) continue;
    predictPos(_near[i], lookahead, _predict);
    let n = 0;
    for (let j = 0; j < c.n; j++) {
      const e = _near[j];
      const dx = e.pos.x - _predict.x;
      const dz = e.pos.z - _predict.z;
      if (dx * dx + dz * dz <= r2) n++;
    }
    if (n > bestN) {
      bestN = n;
      _cluster.set(_predict.x, 0, _predict.z);
    }
  }
  return bestN;
}

/** The point written by the last `bestCluster` call. Aliases a module temp. */
export function clusterPoint() {
  return _cluster;
}

/** Melee-ish enemies inside the janitor's 151 deg block arc. */
function meleeThreatFront(c, r, dx, dz) {
  let n = 0;
  for (let i = 0; i < c.n; i++) {
    const d = _nearD[i];
    if (d > r) continue;
    const e = _near[i];
    if (!MELEE_AI[e.def?.ai]) continue;
    if (d < 0.35) {
      n++;
      continue;
    }
    // dot > 0.25 is exactly the frontal window Player.damage uses (player.js:520)
    if (((e.pos.x - c.bot.pos.x) / d) * dx + ((e.pos.z - c.bot.pos.z) / d) * dz > 0.25) n++;
  }
  return n;
}

/** A Junior Closer mid-windup that has already picked this bot. */
function chargerLockedOn(c, bot, r) {
  for (let i = 0; i < c.n; i++) {
    if (_nearD[i] > r) continue;
    const e = _near[i];
    if (e.key !== 'closer') continue;
    if ((e.windupT ?? 0) > 0 && e.target === bot) return true;
  }
  return false;
}

// ============================================================================
// KAREN GUARDS
// ============================================================================
//
// A `never target karen` filter is NOT sufficient. HR's slips re-home to
// whatever is nearest the projectile, Sales' cards pierce four bodies, the
// intern's fan is 16 deg wide, and half the secondaries are area effects. Any
// one of those clipping her starts a 950 hp / 51 DPS hunt that outruns every
// class in the game. So the firing LINE and the placement AREA get checked too.

function karenIsUntouchable(e) {
  return e?.key === 'karen';
}

/** Would an area effect centred at (x,z) with `r` metres of radius touch her? */
function karenInSphere(c, x, z, r) {
  const k = c.idleKaren;
  if (!k) return false;
  const reach = r + (k.radius ?? 0.5) + 0.6; // margin for her own movement
  const dx = k.pos.x - x;
  const dz = k.pos.z - z;
  return dx * dx + dz * dz < reach * reach;
}

/** Would a shot or a pierce line from the bot along (dx,dz) clip her? */
function karenOnLine(c, dx, dz, len, pad) {
  const k = c.idleKaren;
  if (!k) return false;
  const rx = k.pos.x - c.bot.pos.x;
  const rz = k.pos.z - c.bot.pos.z;
  const along = clamp(rx * dx + rz * dz, 0, len);
  const ox = rx - dx * along;
  const oz = rz - dz * along;
  const reach = (k.radius ?? 0.5) + pad;
  return ox * ox + oz * oz < reach * reach;
}

/**
 * Homing is the nastiest case: `Projectile.update` re-acquires the nearest
 * enemy to the PROJECTILE every frame within 26 m (projectiles.js:127), so an
 * idle Karen anywhere near the flight path will eat the slip regardless of what
 * the bot aimed at. The only safe policy is not to fire in her half of the room.
 */
function karenBlocksHoming(c, targetDist) {
  const k = c.idleKaren;
  if (!k) return false;
  return dist2(c.bot.pos, k.pos) < Math.max(12, targetDist + 6);
}

// ============================================================================
// TARGET PRIORITY
// ============================================================================

/**
 * How badly this bot wants to shoot this enemy. Higher is better; 0 or below
 * means "do not engage". Never throws on a malformed enemy.
 *
 * @param {import('../game.js').Game} game
 * @param {any} bot
 * @param {any} e enemy
 * @param {object} c scan context from buildCtx (optional, for count-scaled weights)
 * @param {boolean} withLos include the occlusion penalty (a BVH segment test).
 *        `pickThreat` passes false and applies it itself, to only pay for it on
 *        the handful of enemies that could actually win.
 */
export function scoreThreat(game, bot, e, c = null, withLos = true) {
  if (!e || e.dead || !e.pos) return 0;

  // Karen: never, at any range, for any reason. Provoking her and then dying is
  // the single largest way a bot can poison a playtest.
  if (karenIsUntouchable(e)) return 0;

  const doc = doctrineFor(bot?.classKey);
  const def = e.def ?? null;
  let s = THREAT_BASE[e.key] ?? (def?.boss ? THREAT_BASE.boss : DEFAULT_THREAT);

  const dSelf = dist2(bot.pos, e.pos);

  // --- role guards: things a melee bot must not walk into -------------------
  if (doc.role === 'melee' && MELEE_FORBIDDEN[e.key]) {
    // A roomba is only a legal melee target if one swing removes it before the
    // 0.55 s fuse. Enemy hp scales 30% per director coefficient point, so this
    // has to be computed against LIVE hp, never assumed.
    if (e.key === 'roomba' && oneSwingKills(bot, e)) s = 45;
    else return 0;
  }

  // --- urgency multipliers --------------------------------------------------
  switch (e.key) {
    case 'gossip':
      // It pops at 3 m from its target and goo-marks everyone within 6.5 m.
      // Inside 6 m of anybody it is already a failure in progress.
      if (e.target && dist2(e.pos, e.target.pos) < 6) s *= 2;
      break;
    case 'micromanager':
      if (e.latchedTo === game?.player) s *= 3;
      else if (e.latchedTo) s *= 2;
      else if (e.state === 'pounce') s *= 1.6;
      break;
    case 'sysadmin':
      // strikeAnim is set the frame the 0.9 s EMP telegraph is drawn.
      if ((e.strikeAnim ?? 0) > 0) s *= 2;
      break;
    case 'closer':
      if ((e.windupT ?? 0) > 0) s *= 2;
      break;
    case 'influencer':
      // One is trash. Three screaming reassigns the aggro of everything within
      // 12 m and rallies it, which is a different problem entirely.
      if (c && c.influencers >= 3) s *= 3;
      break;
    case 'hrrep':
      // crowdDrag caps at 0.6: four Talent Partners is a 40% movement tax on
      // whoever they are surrounding.
      if (e.target === game?.player) s *= 1.8;
      break;
    case 'roomba':
      // A live roomba near the human is a 27 damage delete button.
      if (game?.player && dist2(e.pos, game.player.pos) < 7) s *= 1.6;
      break;
    default:
      break;
  }

  // Anything currently hunting the human is worth more than anything hunting a
  // bot: the entire justification for bot teammates is pressure relief.
  if (e.target && e.target === game?.player) s *= 1.35;

  if (e.elite) s *= 1.3;

  // Finish what is nearly dead — mild, so bots do not all pile onto one husk.
  const hpFrac = clamp((e.hp ?? 1) / Math.max(1, e.maxHp ?? 1), 0, 1);
  s *= 1 + 0.35 * (1 - hpFrac);

  // --- geometry -------------------------------------------------------------
  // Proximity to the HUMAN, per the doctrine: bots exist to peel.
  const dHuman = game?.player ? dist2(e.pos, game.player.pos) : dSelf;
  s /= 1 + dHuman / 10;

  // Falls off hard past the bot's own band so nobody sprints across the floor
  // chasing a printer.
  if (dSelf > doc.band.max) s /= 1 + (dSelf - doc.band.max) / 8;

  // Visible beats theoretically-better-but-behind-a-wall, without erasing it:
  // a Gossip through a cubicle still outranks a paperling in the open.
  if (withLos && game?.combat) {
    _tmp.copy(e.center ?? e.pos);
    if (!safeLos(game, botEye(bot), _tmp)) s *= 0.25;
  }

  return s;
}

/**
 * Would a single primary swing delete this enemy outright? Both melee kits swing
 * at mult 1 for their basic attack, so this is the honest jab/sweep number — the
 * brawler's haymaker is deliberately NOT counted, because he cannot choose which
 * punch lands next.
 */
function oneSwingKills(bot, e) {
  if (!bot?.stats) return false;
  const dmg = (bot.stats.damage ?? 0) + (bot.stats.flatDamage ?? 0);
  return dmg >= (e.hp ?? 0);
}

/**
 * Pick who this bot should be shooting.
 *
 * Sticky by design: `current` is only dropped when something scores 35% better.
 * Bots that re-target every frame look like software, and they never actually
 * kill anything because the reaction delay restarts on every switch.
 *
 * COST NOTE: the occlusion term is the expensive part, so it is applied in a
 * second pass over only the contenders. Even so, the orchestrator should call
 * this on a ~5 Hz throttle rather than every frame — four bots re-ranking 42
 * mobs at 60 Hz is a real BVH bill for a decision that cannot usefully change
 * faster than the bot's own reaction time.
 */
export function pickThreat(game, bot, current = null, maxRange = SCAN_RADIUS) {
  if (!game || !bot || bot.dead) return null;
  const doc = doctrineFor(bot.classKey);
  const c = buildCtx(game, bot, doc, current);

  // Pass 1: everything except line of sight.
  _scores.length = 0;
  let raw = 0;
  for (let i = 0; i < c.n; i++) {
    const s = _nearD[i] > maxRange ? 0 : scoreThreat(game, bot, _near[i], c, false);
    _scores.push(s);
    if (s > raw) raw = s;
  }

  // Pass 2: only contenders can win, so only contenders are worth a raycast.
  const cutoff = raw * 0.4;
  let best = null;
  let bestScore = 0;
  let curScore = 0;
  for (let i = 0; i < c.n; i++) {
    let s = _scores[i];
    if (s <= 0) continue;
    if (s >= cutoff) {
      _tmp.copy(_near[i].center ?? _near[i].pos);
      if (!safeLos(game, botEye(bot), _tmp)) s *= 0.25;
    }
    if (_near[i] === current) curScore = s;
    if (s > bestScore) {
      bestScore = s;
      best = _near[i];
    }
  }

  if (current && !current.dead && curScore > 0 && bestScore < curScore * 1.35) return current;
  return best;
}

/** Eye point for occlusion tests. Own temp — `centerPos` is a shared one. */
function botEye(bot) {
  return _eye.set(bot.pos.x, bot.pos.y + 1.25, bot.pos.z);
}

// ============================================================================
// AIM
// ============================================================================

/** lineOfSight that tolerates a missing combat layer instead of throwing. */
function safeLos(game, from, to) {
  const combat = game?.combat;
  if (!combat) return true;
  try {
    return combat.lineOfSight(from, to);
  } catch {
    return true;
  }
}

/**
 * Time-of-flight lead. Two fixed-point iterations: the closed-form quadratic is
 * exact, but our velocity estimate is far noisier than the solve, so the extra
 * precision would be spent on noise.
 *
 * `maxT` is clamped to the projectile's own ttl — leading further than the round
 * can fly aims the bot at empty floor.
 */
function solveLead(out, origin, tx, ty, tz, vx, vy, vz, speed, maxT) {
  let t = 0;
  for (let i = 0; i < 2; i++) {
    const px = tx + vx * t;
    const py = ty + vy * t;
    const pz = tz + vz * t;
    const d = Math.hypot(px - origin.x, py - origin.y, pz - origin.z);
    t = clamp(d / speed, 0, maxT);
  }
  out.set(tx + vx * t, ty + vy * t, tz + vz * t);
  return t;
}

/**
 * Rotate `dir` off-axis by `errRad` using the current unit-disk sample. The
 * sample is held between re-rolls so the aim does not shake at 60 Hz — a
 * per-frame random cone both looks wrong and averages out to perfect accuracy
 * over a burst, which is the opposite of what we want.
 */
function applyAimError(dir, errRad, ox, oy) {
  if (errRad <= 1e-4) return dir;
  _right.copy(dir).cross(WORLD_UP);
  if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0); // straight up/down
  _right.normalize();
  _up.copy(_right).cross(dir).normalize();
  const k = Math.tan(errRad);
  dir.addScaledVector(_right, k * ox).addScaledVector(_up, k * oy);
  return dir.normalize();
}

function rerollSample(state) {
  // Uniform-in-disk (sqrt) rather than uniform-in-radius: without the sqrt the
  // samples bunch at the centre and the bot is accidentally a laser.
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random());
  state.ox = Math.cos(a) * r;
  state.oy = Math.sin(a) * r;
  state.sampleT = AIM_SAMPLE_PERIOD;
}

/**
 * Finite-difference the target's velocity. Enemies carry no `vel` field, so
 * this is the only way to lead them. Smoothed hard, and magnitude-clamped so a
 * knockback launch or a Closer charge does not make the bot aim at the ceiling.
 */
function trackVelocity(state, e, cx, cy, cz, dt) {
  if (state.velId !== e.id || !state.velWarm) {
    state.velId = e.id;
    state.velWarm = true;
    state.vx = 0;
    state.vy = 0;
    state.vz = 0;
  } else if (dt > 1e-4) {
    const rx = (cx - state.px) / dt;
    const ry = (cy - state.py) / dt;
    const rz = (cz - state.pz) / dt;
    state.vx = damp(state.vx, rx, 9, dt);
    state.vy = damp(state.vy, ry, 9, dt);
    state.vz = damp(state.vz, rz, 9, dt);
    const sp = Math.hypot(state.vx, state.vy, state.vz);
    if (sp > 14) {
      const k = 14 / sp;
      state.vx *= k;
      state.vy *= k;
      state.vz *= k;
    }
  }
  state.px = cx;
  state.py = cy;
  state.pz = cz;
}

// ============================================================================
// THE EXECUTOR
// ============================================================================

/**
 * Decide this bot's combat action for this frame.
 *
 * CONTRACT — read this before wiring it up:
 *
 *  * Call EXACTLY ONCE per bot per frame. It advances the bot's weapon clocks
 *    (`primaryCd`, `secondaryCd`, `reloadT`, `ammo`, `heatGauge`,
 *    `overheatLock`, `beamHeat`) and its own aim/reaction state.
 *
 *  * The clocks live ON THE BOT, under the same field names `Player` uses. That
 *    is deliberate: the marketing kit refunds `player.secondaryCd` (classes.js:290)
 *    and the sales kit resets `player.dashCd` (classes.js:203), so a private
 *    copy of those numbers would silently discard upgrade effects.
 *
 *  * Cooldown and ammo are committed OPTIMISTICALLY when `act` is `primary` or
 *    `secondary`. If the kit's `fire`/`use` returns false, call
 *    `refundAction(bot, decision)`. The failure direction of forgetting is "the
 *    bot shoots slightly slower", not "the bot machine-guns", which is the
 *    right way round.
 *
 *  * `decision` and `decision.aim` alias module temps and are only valid until
 *    the next call. The kits clone what they keep, so passing `decision.aim`
 *    straight into `primary.fire` is safe.
 *
 * @param {import('../game.js').Game} game
 * @param {any} bot   a BotPlayer: needs pos, yaw, hp, maxHp, classKey, stats, upgrades
 * @param {any} target the enemy chosen by `pickThreat` (may be null)
 * @param {number} dt  seconds; derive from dt, never from `net.now` (0 when solo)
 * @returns {typeof _decision}
 */
export function decideCombat(game, bot, target, dt) {
  const state = bot?.tactics ?? (bot ? (bot.tactics = createTacticsState()) : null);
  const doc = doctrineFor(bot?.classKey);
  const cls = CLASS_BY_KEY[bot?.classKey] ?? null;

  // Reset the shared decision every call so a bailout can never leak last
  // frame's action into this frame.
  _decision.act = BOT_ACT.HOLD;
  _decision.aimTarget = null;
  _decision.forget = false;
  _decision.hasLos = false;
  _decision.reason = '';
  _decision.standoff = doc.band.hold;
  _decision.teamSpacing = 3.5;
  _decision.yaw = bot?.yaw ?? 0;
  _decision.yawErr = 0;
  fallbackAim(bot);

  if (!game || !bot || !state || !cls || bot.dead || game.runOver) return _decision;

  const d = Math.max(0, Math.min(dt || 0, 0.1)); // a 200 ms hitch must not fire ten times
  advanceClocks(bot, cls, d);

  const c = buildCtx(game, bot, doc, target);

  // Spacing: 3.5 m clears the roomba blast (3.4), the synergy nova (3.6) and
  // the auditor slam is close behind. A live Gossip (6.5 m goo) or Field
  // Technician (6 m arc chain) widens it — four bots stacked on the human means
  // one cast hits the whole party, and the Director's teamSpread reading, which
  // is the pacing signal we are here to test, becomes meaningless.
  _decision.teamSpacing = c.gossips > 0 || c.techs > 0 ? 6.0 : 3.5;

  // --- target bookkeeping ---------------------------------------------------
  const valid = !!target && !target.dead && !!target.pos && !karenIsUntouchable(target);
  if (!valid) {
    state.targetId = -1;
    state.hadLos = false;
    state.lostT = 0;
    // Heat still has to bleed off while idle or the bot resumes locked out.
    coolDown(bot, doc, d, false);
    updateBlock(game, bot, doc, state, c, d);
    if (state.blockT > 0) {
      _decision.act = BOT_ACT.BLOCK;
      _decision.reason = 'blocking, no target';
    } else if (wantsReload(bot, cls, doc, c)) {
      startReload(bot, cls);
      _decision.act = BOT_ACT.RELOAD;
      _decision.reason = 'topping up between fights';
    }
    return _decision;
  }

  _decision.aimTarget = target;

  if (state.targetId !== target.id) {
    // New acquisition: full reaction delay and a wide-open error cone. This is
    // what makes a bot miss the first shots of a snap turn instead of landing
    // them, and it is the single most important line in the file for keeping
    // the playtest honest.
    state.targetId = target.id;
    state.reactT = rand(doc.aim.reactMin, doc.aim.reactMax);
    state.err.snap(doc.aim.acquireDeg);
    state.trackT = 0;
    state.lostT = 0;
    state.hadLos = false;
    state.velWarm = false;
    rerollSample(state);
  }
  state.reactT = Math.max(0, state.reactT - d);
  state.trackT += d;

  // --- where the target is, and where it is going ---------------------------
  _center.copy(target.center ?? target.centerPos ?? target.pos); // `center` is a shared temp — copy now
  trackVelocity(state, target, _center.x, _center.y, _center.z, d);

  // Muzzle sits at chest height, matching Player's third-person aim origin
  // (player.js:594) so the bot's shots leave from where its model holds a gun.
  _origin.set(bot.pos.x, bot.pos.y + 1.25, bot.pos.z);

  const losNow = safeLos(game, _origin, _center);
  if (losNow) {
    state.lastSeen.copy(_center);
    state.hadLos = true;
    state.lostT = 0;
  } else if (state.hadLos) {
    state.lostT += d;
    // Losing sight does not instantly delete the target — a human keeps
    // shooting at where it went for a beat. Past the grace window the bot
    // genuinely forgets and the orchestrator should re-acquire.
    if (state.lostT > Math.max(0.6, doc.aim.losGrace + 0.25)) {
      _decision.forget = true;
      state.hadLos = false;
    }
  } else if (state.trackT > 1.5) {
    // Never had sight of it at all. Without this a bot fixates forever on
    // something two rooms away that it scored highly and can never shoot,
    // standing there aiming at a wall while the human takes the whole wave.
    _decision.forget = true;
  }
  _decision.hasLos = losNow;

  // --- aim ------------------------------------------------------------------
  const aimAt = losNow ? _center : state.lastSeen;
  const dist = Math.hypot(aimAt.x - _origin.x, aimAt.y - _origin.y, aimAt.z - _origin.z);

  // Aim error target: the floor, plus a penalty for how fast the target is
  // crossing the bot's view. Something strafing at 8 m/s at 6 m is 1.3 rad/s of
  // tracking and should be genuinely hard to hit.
  const lat = lateralRate(state, _origin, aimAt, dist);
  const errTarget = doc.aim.settleDeg + doc.aim.trackPenalty * lat;
  // The cone does not START closing until the reaction delay is spent. The
  // delay is "noticing"; the settle is "getting the crosshair on it". Letting
  // them overlap meant the bot had already converged halfway by the time it was
  // allowed to shoot, and the first shots of a snap-turn landed — which is the
  // one thing this model exists to prevent.
  const errDeg = state.reactT > 0
    ? state.err.snap(Math.max(state.err.value, doc.aim.acquireDeg))
    : state.err.to(errTarget, d, doc.aim.settleTime);

  state.sampleT -= d;
  if (state.sampleT <= 0) rerollSample(state);

  // Lead only for real projectiles. The beam and the CO2 cone resolve instantly,
  // and leading them just points the bot at nothing.
  const speed = doc.weapon.speed;
  if (speed > 0 && losNow) {
    const maxT = doc.weapon.ttl > 0 ? doc.weapon.ttl * 0.9 : 1.5;
    solveLead(_lead, _origin, aimAt.x, aimAt.y, aimAt.z, state.vx, state.vy, state.vz, speed, maxT);
    // Never lead into a wall: if the predicted point is occluded, a human would
    // have shot at the body instead of the prediction.
    if (safeLos(game, _origin, _lead)) _point.copy(_lead);
    else _point.copy(aimAt);
  } else {
    _point.copy(aimAt);
  }

  _dir.copy(_point).sub(_origin);
  if (_dir.lengthSq() < 1e-6) _dir.set(Math.sin(bot.yaw), 0, Math.cos(bot.yaw));
  _dir.normalize();
  applyAimError(_dir, errDeg * DEG, state.ox, state.oy);
  _camDir.copy(_dir);
  // `point` is what HR's zone and IT's turret are placed at, and beamTick
  // dereferences it unconditionally (player.js:717) — it must always be a real
  // point on the aim ray, never null.
  _point.copy(_origin).addScaledVector(_dir, Math.max(1, dist));

  // Desired facing, for the orchestrator's yaw damper. The cone and melee kits
  // read `player.yaw` and ignore aim.dir entirely, so for them this IS the aim.
  const wantYaw = Math.atan2(aimAt.x - bot.pos.x, aimAt.z - bot.pos.z);
  _decision.yaw = wantYaw;
  _decision.yawErr = Math.abs(angleDelta(bot.yaw ?? 0, wantYaw));

  // --- standoff for the mover ----------------------------------------------
  _decision.standoff = standoffFor(doc, target);

  // --- resources ------------------------------------------------------------
  updateBlock(game, bot, doc, state, c, d);
  if (state.blockT > 0) {
    // Blocking gates primary fire off entirely (player.js:976), so this must
    // short-circuit before any fire decision.
    coolDown(bot, doc, d, false);
    _decision.act = BOT_ACT.BLOCK;
    _decision.reason = 'lid up';
    return _decision;
  }

  const stunned = (bot.stunT ?? 0) > 0;
  const shocked = (bot.shockT ?? 0) > 0;

  // --- secondary ------------------------------------------------------------
  // Evaluated on a throttle, not per frame. Shock disables abilities entirely
  // (player.js:1013), same as it does for the human.
  state.secT -= d;
  if (state.secT <= 0) {
    state.secT = SECONDARY_EVAL_PERIOD;
    state.secWant = false;
    const sec = doc.secondary;
    if (sec && !stunned && !shocked && (bot.secondaryCd ?? 0) <= 0 && cls.secondary && !cls.secondary.hold) {
      state.secWant = safeTrigger(sec, c);
      state.secReason = sec.reason ?? 'secondary';
    }
  }

  if (state.secWant && !stunned && !shocked && (bot.secondaryCd ?? 0) <= 0 && state.reactT <= 0) {
    if (prepareSecondary(game, bot, doc, c, target)) {
      bot.secondaryCd = cls.secondary.cd; // raw cd: secondary ignores atkCdMult
      state.secWant = false;
      coolDown(bot, doc, d, false);
      _decision.act = BOT_ACT.SECONDARY;
      _decision.reason = state.secReason;
      return _decision;
    }
    // Not viable this instant (wall in the way, Karen in the blast). Keep the
    // intent and re-check on the next throttle tick rather than burning it.
  }

  // --- reload ---------------------------------------------------------------
  if (wantsReload(bot, cls, doc, c)) {
    startReload(bot, cls);
    coolDown(bot, doc, d, false);
    _decision.act = BOT_ACT.RELOAD;
    _decision.reason = 'mag low, nothing close';
    return _decision;
  }

  // --- primary --------------------------------------------------------------
  const fired = tryPrimary(game, bot, doc, cls, state, c, target, losNow, dist, d);
  // Heat bleeds off on trigger-up, not on tick-gaps. See `state.holding`.
  coolDown(bot, doc, d, state.holding);
  if (fired) {
    _decision.act = BOT_ACT.PRIMARY;
    _decision.reason = 'primary';
  }
  return _decision;
}

/**
 * Refund an optimistically-committed action. Only needed when a kit's
 * `fire`/`use` returns false — none of the eight shipping kits do, but a future
 * one might, and a silently half-committed cooldown is a miserable bug.
 */
export function refundAction(bot, decision) {
  if (!bot || !decision) return;
  const cls = CLASS_BY_KEY[bot.classKey];
  if (!cls) return;
  if (decision.act === BOT_ACT.PRIMARY) {
    bot.primaryCd = 0;
    if (cls.primary.mag) bot.ammo = Math.min(cls.primary.mag, (bot.ammo ?? 0) + 1);
    if (cls.primary.heat) bot.heatGauge = Math.max(0, (bot.heatGauge ?? 0) - 0.032);
  } else if (decision.act === BOT_ACT.SECONDARY) {
    bot.secondaryCd = 0;
  }
}

// ---------------------------------------------------------------- primary fire

function tryPrimary(game, bot, doc, cls, state, c, target, losNow, dist, dt) {
  // `holding` means "would a human be holding the trigger right now", which is
  // NOT the same as "did a tick fire this frame". The IT beam ticks once every
  // 0.09 s but the heat gauge only decays while the button is UP (player.js:967).
  // Decaying on every non-tick frame gave the bot an 88% beam duty cycle
  // against a physical ceiling of 60.8% — the class's entire resource, and the
  // thing the kit is balanced around, silently stopped existing.
  state.holding = false;

  if (state.reactT > 0) return false; // the trigger delay after acquiring
  if ((bot.reloadT ?? 0) > 0) return false;
  if ((bot.stunT ?? 0) > 0) return false;
  if (cls.primary.mag && (bot.ammo ?? 0) <= 0) return false;

  const w = doc.weapon;

  // Line of sight. `strict` means the kit itself does no occlusion test (the IT
  // beam, and every meleeArc that would otherwise swing at a wall), so the bot
  // must not fire blind at all. `grace` lets a projectile class keep shooting at
  // the last known spot for a beat — but only if that spot is itself reachable,
  // so the bot is firing into open floor, never through geometry.
  if (!losNow) {
    if (w.losMode !== 'grace') return false;
    // `hadLos` gates the whole grace path. Without it, lostT is 0 on a bot that
    // has NEVER seen this target, so the grace branch fires immediately and
    // shoots at state.lastSeen — which is either the zero vector or the last
    // position of a PREVIOUS target. That is a bot firing through a wall at a
    // remembered ghost: the exact aimbot-through-geometry behaviour this whole
    // module is built to avoid.
    if (!state.hadLos) return false;
    if (state.lostT > doc.aim.losGrace) return false;
    if (!safeLos(game, _origin, state.lastSeen)) return false;
  }

  // Yaw gate. For the yaw-aimed kits (janitor, brawler, marketing, and sales'
  // cone) this is the entire accuracy model: the bot cannot land a 42 deg CO2
  // cone until it has actually finished turning.
  const swing = swingShape(bot, doc);
  if (_decision.yawErr > (swing.fireYawDeg ?? doc.aim.fireYawDeg) * DEG) return false;

  // Range. Melee reach is `range + target radius`, matching meleeArc's own test;
  // 0.95 keeps the bot from whiffing on the exact edge as the target drifts.
  const reach = w.kind === 'melee' || w.kind === 'cone'
    ? (swing.range + (target.radius ?? 0.5)) * 0.95
    : w.range;
  const planar = Math.hypot(target.pos.x - bot.pos.x, target.pos.z - bot.pos.z);
  if ((w.kind === 'melee' || w.kind === 'cone' ? planar : dist) > reach) return false;

  // IT heat: cut at 0.80, resume at 0.30. Hysteresis, not a hard threshold —
  // without it the bot chatters on and off at the boundary and the beam
  // stutters visibly.
  if (cls.primary.heat) {
    const h = doc.heat;
    const cut = bot.upgrades?.get?.('overclock') ? h.overclockCutHigh : h.cutHigh;
    if ((bot.overheatLock ?? 0) > 0) return false;
    if (state.beamCut) {
      if ((bot.heatGauge ?? 0) > h.cutLow) return false;
      state.beamCut = false;
    } else if ((bot.heatGauge ?? 0) >= cut) {
      state.beamCut = true;
      return false;
    }
  }

  // Brawler: hold the haymaker briefly for a fuller arc. Throwing a 2.6x punch
  // at one paperling is the class's whole damage profile wasted.
  if (bot.classKey === 'brawler' && swing.isHaymaker) {
    const hm = doc.haymaker;
    const inArc = countInCone(c, hm.range, hm.arcDeg / 2, c.aimX, c.aimZ);
    if (inArc < hm.wantTargets && state.hayHoldT < hm.holdMax) {
      state.hayHoldT += dt;
      return false;
    }
    state.hayHoldT = 0;
  } else {
    state.hayHoldT = 0;
  }

  // Sales: re-pick the aim target every 0.2 s to the angle that skewers the most
  // bodies. This is the behaviour that makes the pierce upgrade legible in a
  // playtest instead of invisible. It runs BEFORE the Karen check because it
  // changes the firing line, and the old line's safety says nothing about the
  // new one.
  if (doc.pierceSeek) retargetForPierce(game, bot, doc, c, state, dist, dt);

  // Karen. Every shape gets checked, because a filter on target selection alone
  // does not stop a pierce line, a 16 deg fan or a homing slip from finding her.
  if (!karenSafePrimary(c, doc, bot, dist)) return false;

  // Everything above is INTENT. Only the weapon's own cadence decides whether a
  // tick lands this frame, so the cooldown gate goes last — see `holding` above.
  state.holding = true;
  if ((bot.primaryCd ?? 0) > 0) return false;

  // --- commit (see the optimistic-commit note on decideCombat) --------------
  bot.primaryCd = cls.primary.cd * (bot.stats?.atkCdMult ?? 1);
  if (cls.primary.mag) {
    bot.ammo = (bot.ammo ?? cls.primary.mag) - 1;
    if (bot.ammo <= 0) startReload(bot, cls);
  }
  if (cls.primary.heat) {
    bot.heatGauge = (bot.heatGauge ?? 0) + doc.heat.perShot;
    if (bot.heatGauge >= 1) {
      bot.heatGauge = 1;
      bot.overheatLock = doc.heat.lockTime;
      state.beamCut = true;
    }
  }
  rerollSample(state); // independent error per shot, not per frame
  return true;
}

/** Which swing is about to happen — jab vs haymaker changes reach and arc. */
function swingShape(bot, doc) {
  _swing.range = doc.weapon.range;
  _swing.arcDeg = doc.weapon.arcDeg ?? 0;
  _swing.fireYawDeg = doc.aim.fireYawDeg;
  _swing.isHaymaker = false;
  if (bot.classKey === 'brawler' && doc.haymaker) {
    const every = bot.upgrades?.get?.('southpaw') ? 2 : 3;
    // The kit increments punchCount BEFORE deciding (classes.js:313), so the
    // punch about to be thrown is number punchCount + 1.
    if (((bot.punchCount ?? 0) + 1) % every === 0) {
      _swing.range = doc.haymaker.range;
      _swing.arcDeg = doc.haymaker.arcDeg;
      _swing.fireYawDeg = doc.haymaker.fireYawDeg;
      _swing.isHaymaker = true;
    }
  }
  return _swing;
}

/**
 * Karen safety for whatever the primary is about to do. Each weapon kind is
 * checked against the shape it actually produces, not a generic radius.
 */
function karenSafePrimary(c, doc, bot, dist) {
  if (!c.idleKaren) return true;
  const w = doc.weapon;

  if (w.homing) return !karenBlocksHoming(c, dist);

  if (w.kind === 'cone' || w.kind === 'melee') {
    // The arc sweeps everything in front — check the whole wedge.
    return !karenInArc(c, w.range + 1);
  }

  if (w.kind === 'beam') {
    // beamTick picks the nearest enemy within 1.4 m of the ray, so the ray is
    // the shape that matters, and it chains 0.6x to anything within 7 m of what
    // it hits — which is why the pad is generous.
    return !karenOnLine(c, c.aimX, c.aimZ, w.range, 2.0) && !karenInSphere(c, _point.x, _point.z, 7);
  }

  // Projectiles: the flight line, widened by the pierce depth and by the AoE of
  // the accountant's tax bomb if this is the 25th shot.
  const pad = w.pierce > 0 ? 1.4 : 0.9;
  const len = Math.min(w.range, dist + (w.pierce > 0 ? 6 : 1.5));
  if (karenOnLine(c, c.aimX, c.aimZ, len, pad)) return false;
  if (doc.bombAoe && bot.upgrades?.get?.('taxbomb')) {
    const next = ((bot.shotCounter ?? 0) + 1) % doc.bombEvery === 0;
    if (next && karenInSphere(c, _point.x, _point.z, doc.bombAoe)) return false;
  }
  return true;
}

/** True if an idle Karen sits inside the forward wedge the bot is about to sweep. */
function karenInArc(c, radius) {
  const k = c.idleKaren;
  if (!k) return false;
  const dx = k.pos.x - c.bot.pos.x;
  const dz = k.pos.z - c.bot.pos.z;
  const d = Math.hypot(dx, dz);
  if (d > radius + (k.radius ?? 0.5)) return false;
  if (d < 0.5) return true;
  // Deliberately wider than the real arc: a Karen who is merely near the swing
  // is not worth the risk of her drifting into it mid-animation.
  return (dx / d) * c.aimX + (dz / d) * c.aimZ > 0.2;
}

/**
 * Sales only. Find the enemy whose firing line collects the most other bodies
 * and aim at that instead of at the priority target — a piercing card that hits
 * four things is 177 DPS, one that hits one is 44.
 */
function retargetForPierce(game, bot, doc, c, state, dist, dt) {
  const ps = doc.pierceSeek;
  state.pierceT -= dt;
  if (state.pierceT > 0) return;
  state.pierceT = ps.period;

  let bestN = 1;
  let best = null;
  const cand = Math.min(c.n, 16);
  for (let i = 0; i < cand; i++) {
    if (_nearD[i] > ps.maxRange) continue;
    const e = _near[i];
    if (karenIsUntouchable(e)) continue;
    const ux = (e.pos.x - bot.pos.x) / (_nearD[i] || 1);
    const uz = (e.pos.z - bot.pos.z) / (_nearD[i] || 1);
    let n = 0;
    for (let j = 0; j < c.n; j++) {
      const o = _near[j];
      const rx = o.pos.x - bot.pos.x;
      const rz = o.pos.z - bot.pos.z;
      const along = rx * ux + rz * uz;
      if (along < 0 || along > ps.maxRange) continue;
      const off = Math.abs(rx * uz - rz * ux);
      if (off <= ps.radius + (o.radius ?? 0.5)) n++;
    }
    if (n > bestN) {
      bestN = n;
      best = e;
    }
  }
  if (!best || bestN < 2) return;
  if (!safeLos(game, _origin, _tmp.copy(best.center ?? best.pos))) return;
  // Re-point the already-built aim ray. The error cone is intentionally NOT
  // re-rolled here: the bot chose a line, it does not get a free re-aim.
  _dir.copy(_tmp).sub(_origin).normalize();
  // Keep the ctx facing in sync — the Karen line check that runs next reads it,
  // and it must describe the line the bot is now actually going to shoot.
  c.aimX = _dir.x;
  c.aimZ = _dir.z;
  const h = Math.hypot(c.aimX, c.aimZ) || 1;
  c.aimX /= h;
  c.aimZ /= h;
  applyAimError(_dir, state.err.value * DEG, state.ox, state.oy);
  _point.copy(_origin).addScaledVector(_dir, Math.max(1, dist));
  _camDir.copy(_dir);
  state.pierceId = best.id;
  state.pierceCount = bestN;
}

// ------------------------------------------------------------------ secondary

/** Evaluate a doctrine trigger without letting a bad predicate kill the run. */
function safeTrigger(sec, c) {
  try {
    return !!sec.trigger(c);
  } catch {
    return false;
  }
}

/**
 * Point the aim at whatever the secondary needs and report whether it is worth
 * spending. Returns false to abort the cast (wall in the way, Karen in the
 * blast) so the cooldown is not burned.
 */
function prepareSecondary(game, bot, doc, c, target) {
  const sec = doc.secondary;
  if (!sec) return false;

  switch (sec.aimMode) {
    case 'self':
      // Tax Audit measures from player.pos and does no damage, so the only
      // question is whether Karen would be marked — and auditT alone does not
      // provoke her, so there is nothing to guard.
      return true;

    case 'point': {
      // Recomputed, NOT reused from the trigger: `_cluster` is a shared module
      // temp and the trigger may have run up to SECONDARY_EVAL_PERIOD ago with
      // another bot's scan overwriting it since. Reusing it would drop a
      // meeting room on a different bot's pack.
      const r0 = sec.radius ?? 12;
      const n = bestCluster(c, r0, sec.lookahead ?? 0, sec.placeRange ?? 18);
      if (n <= 0) return false;
      _aimPoint.copy(clusterPoint());
      if (_aimPoint.lengthSq() < 1e-6) _aimPoint.set(target.pos.x, 0, target.pos.z);
      const maxPlace = sec.placeRange ?? 18;
      // IT's kit snaps the spot to the bot's feet if it is more than 8 m away
      // (classes.js:165), which would drop a turret in the wrong room; clamp
      // here so the placement the bot intended is the placement it gets.
      const dx = _aimPoint.x - bot.pos.x;
      const dz = _aimPoint.z - bot.pos.z;
      const dd = Math.hypot(dx, dz);
      if (dd > maxPlace) {
        _aimPoint.set(bot.pos.x + (dx / dd) * maxPlace, 0, bot.pos.z + (dz / dd) * maxPlace);
      }
      // bigmeeting's zone deals damage, so an idle Karen inside it is a provoke.
      const r = bot.upgrades?.get?.('bigmeeting') ? (sec.bigRadius ?? sec.radius ?? 6.5) : (sec.radius ?? 6.5);
      if (bot.upgrades?.get?.('bigmeeting') && karenInSphere(c, _aimPoint.x, _aimPoint.z, r)) return false;
      if (bot.classKey === 'it' && karenInSphere(c, _aimPoint.x, _aimPoint.z, 12)) return false;
      _point.copy(_aimPoint);
      return true;
    }

    case 'yaw': {
      // Cone and charge secondaries fire along player.yaw, so they must not go
      // until the bot has finished turning — otherwise Full Send launches at
      // 26 m/s in a direction nobody chose.
      if (_decision.yawErr > (sec.fireYawDeg ?? 25) * DEG) return false;
      if (sec.wallCheck) {
        // A 26 m/s launch into a wall is a wasted 7 s cooldown that reads as a
        // broken bot, so the corridor is segment-tested before committing.
        const bvh = game.bvh;
        if (bvh?.segmentBlocked) {
          _ahead.set(
            bot.pos.x + c.aimX * sec.wallCheck,
            1.0,
            bot.pos.z + c.aimZ * sec.wallCheck,
          );
          try {
            if (bvh.segmentBlocked(bot.pos.x, 1.0, bot.pos.z, _ahead.x, _ahead.y, _ahead.z)) return false;
          } catch {
            /* no acceleration structure this floor — take the shot */
          }
        }
      }
      if (karenInArc(c, sec.range ?? sec.wallCheck ?? 9)) return false;
      return true;
    }

    case 'ray':
    default: {
      // The intern's fan is 16 deg wide; check the whole wedge, not the ray.
      if (karenOnLine(c, c.aimX, c.aimZ, sec.guardLen ?? 12, 2.5)) return false;
      return true;
    }
  }
}

// --------------------------------------------------------------------- clocks

function advanceClocks(bot, cls, dt) {
  bot.primaryCd = Math.max(0, (bot.primaryCd ?? 0) - dt);
  bot.secondaryCd = Math.max(0, (bot.secondaryCd ?? 0) - dt);
  if (bot.ammo === undefined) bot.ammo = cls.primary.mag ?? Infinity;
  if (bot.reloadT === undefined) bot.reloadT = 0;
  if (bot.heatGauge === undefined) bot.heatGauge = 0;
  if (bot.overheatLock === undefined) bot.overheatLock = 0;
  if (bot.beamHeat === undefined) bot.beamHeat = 0;
  if (bot.reloadT > 0) {
    bot.reloadT -= dt;
    if (bot.reloadT <= 0) {
      bot.reloadT = 0;
      bot.ammo = cls.primary.mag ?? Infinity;
    }
  }
}

/**
 * Heat bookkeeping, mirrored from Player.update (player.js:966-968, :882).
 * Both gauges only decay on frames the beam did NOT fire — that asymmetry is
 * what makes the 60.8% duty cycle real rather than a suggestion.
 */
function coolDown(bot, doc, dt, fired) {
  if (!doc.heat) return;
  bot.overheatLock = Math.max(0, (bot.overheatLock ?? 0) - dt);
  if (!fired || (bot.overheatLock ?? 0) > 0) {
    bot.heatGauge = Math.max(0, (bot.heatGauge ?? 0) - dt * doc.heat.decay);
  }
  if (!fired) {
    bot.beamHeat = Math.max(0, (bot.beamHeat ?? 0) - dt * doc.heat.beamHeatDecay);
  }
}

function startReload(bot, cls) {
  if (!cls.primary.mag) return;
  if ((bot.reloadT ?? 0) > 0) return;
  bot.reloadT = cls.primary.reload ?? 1;
}

/**
 * Reload policy: top up when the magazine is low AND nothing is close enough to
 * punish the animation. Bots that reload with a Closer at 3 m are not testing
 * the same weapon a human is.
 */
function wantsReload(bot, cls, doc, c) {
  const mag = cls?.primary?.mag;
  if (!mag || !doc.reload) return false;
  if ((bot.reloadT ?? 0) > 0) return false;
  const ammo = bot.ammo ?? mag;
  if (ammo >= mag) return false;
  if (ammo <= 0) return true; // forced; the kit cannot fire anyway
  if (ammo / mag > doc.reload.at) return false;
  return countWithin(c, doc.reload.safeDist) === 0;
}

// ---------------------------------------------------------------------- block

/**
 * The janitor's lid. Raised for a real reason, dropped on a timer, and then
 * locked out briefly so the bot actually swings — a bot that holds block
 * permanently deals zero damage and reports a false wave-clear time, which is
 * exactly the kind of silent measurement corruption this whole exercise is
 * meant to avoid.
 */
function updateBlock(game, bot, doc, state, c, dt) {
  const b = doc.block;
  if (!b) {
    state.blockT = 0;
    bot.blocking = false;
    return;
  }

  if (state.blockLock > 0) {
    state.blockLock -= dt;
    state.blockT = 0;
    bot.blocking = false;
    return;
  }

  const maxHold = bot.upgrades?.get?.('riotlid') ? b.riotMaxHold : b.maxHold;
  if (state.blockT > 0) {
    state.blockT += dt;
    // Hold at least minHold so the block is not a single-frame flicker, and
    // never past maxHold so the bot returns to dealing damage.
    if (state.blockT >= maxHold || !blockReason(game, bot, doc, c)) {
      if (state.blockT >= b.minHold) {
        state.blockT = 0;
        state.blockLock = b.lockout;
        bot.blocking = false;
        return;
      }
    }
    bot.blocking = true;
    return;
  }

  if (blockReason(game, bot, doc, c)) {
    state.blockT = dt;
    bot.blocking = true;
  } else {
    bot.blocking = false;
  }
}

function blockReason(game, bot, doc, c) {
  const b = doc.block;
  const fx = Math.sin(bot.yaw ?? 0);
  const fz = Math.cos(bot.yaw ?? 0);
  if (meleeThreatFront(c, b.meleeRange, fx, fz) >= b.meleeCount) return true;
  if (chargerLockedOn(c, bot, b.chargerRange)) return true;
  if (c.hpFrac < b.hpFrac && meleeThreatFront(c, 6, fx, fz) >= 1) return true;
  return false;
}

// ------------------------------------------------------------------- geometry

/**
 * How far the mover should try to stay from this specific target. The band is
 * the default; specific enemies override it because their threat is a radius,
 * not a distance.
 */
function standoffFor(doc, target) {
  let s = doc.band.hold;
  switch (target.key) {
    case 'roomba':
      // 3.4 m blast with 0.5 falloff, armed at 1.8 m from its target.
      s = Math.max(s, 5.0);
      break;
    case 'pylon':
      // 4.4 m aura: 13 DPS plus a rolling ability lockout.
      s = Math.max(s, 6.0);
      break;
    case 'auditor':
      // 4.2 m slam on a 0.7 s telegraph.
      s = doc.role === 'melee' ? Math.max(s, 3.0) : Math.max(s, 8.0);
      break;
    case 'karen':
      s = Math.max(s, 12);
      break;
    default:
      break;
  }
  if (target.elite === 'synergy' && doc.role === 'melee') {
    // Death nova is a 3.6 m hostile explosion — do not be inside it at the kill.
    s = Math.max(s, 2.6);
  }
  return s;
}

/**
 * Angular rate of the target across the bot's view, in rad/s. This is what
 * makes a strafing runner genuinely harder to hit than a walker, rather than
 * distance alone.
 */
function lateralRate(state, origin, at, dist) {
  if (dist < 0.5) return 0;
  const ux = (at.x - origin.x) / dist;
  const uy = (at.y - origin.y) / dist;
  const uz = (at.z - origin.z) / dist;
  const along = state.vx * ux + state.vy * uy + state.vz * uz;
  const lx = state.vx - ux * along;
  const ly = state.vy - uy * along;
  const lz = state.vz - uz * along;
  return Math.hypot(lx, ly, lz) / dist;
}

/**
 * A valid aim even with no target and no world. Several kits dereference
 * `aim.point` unconditionally, so it can never be null — a dead bot with a
 * half-built aim object would take the run down with it.
 */
function fallbackAim(bot) {
  const x = bot?.pos?.x ?? 0;
  const y = (bot?.pos?.y ?? 0) + 1.25;
  const z = bot?.pos?.z ?? 0;
  const yaw = bot?.yaw ?? 0;
  _origin.set(x, y, z);
  _dir.set(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
  _camDir.copy(_dir);
  _point.copy(_origin).addScaledVector(_dir, 10);
}

/** Degrees-to-radians for anyone tuning BOT_DOCTRINE from the console. */
export const DOCTRINE_UNITS = { DEG, RAD };
