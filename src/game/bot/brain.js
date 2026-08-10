// ============ bot decision layer — utility AI ============
// One tick = score every action the bot could take right now, take the best
// VALID one, and remember why. Deliberately not a state machine: a state machine
// encodes the transitions you thought of, and the interesting co-op behaviour
// (peel off the human, break off a kill to dodge an EMP, give up on a target
// that walked behind a pillar) lives in the transitions you did not.
//
//   snapshot  →  perception (reaction delay + LOS memory)  →  score  →  commit
//
// This module is PURE. It reads a plain-object world snapshot, never touches
// `game`, never imports THREE, never deals damage and never moves anything. It
// returns a DECISION; the orchestrator is what acts on it. That split is what
// makes bot behaviour testable without standing up a level.
//
// Three things in here exist purely to stop the bot reading as a robot:
//
//   REACTION DELAY — a threat that just appeared is not actionable for 150-300ms.
//     This is most of the difference between "a teammate" and "an aimbot", and it
//     is calibrated against the game's own telegraphs (influencer 0.2s, pounce
//     0.45s, closer 0.55s, sysadmin 0.9s): a bot should sometimes eat the fast
//     ones, exactly like a human does.
//   LOS MEMORY — a target that breaks line of sight stays "known" for 0.6s and is
//     then forgotten. Without it bots track through walls; with a longer window
//     they clairvoyantly pre-aim at corners.
//   HYSTERESIS — every action has a minimum dwell time AND must beat the current
//     action by a margin to displace it. Without both, ENGAGE and RETREAT sit
//     within noise of each other and the bot vibrates in place, which reads as
//     broken to a playtester and produces garbage pacing data.
//
// Urgency is the escape hatch on hysteresis: a 0.9s EMP telegraph is shorter than
// most dwell windows, so a dodge that cannot preempt dwell is a dodge that never
// happens. Candidates may flag `urgent` to bypass dwell and margin — and only a
// handful do.

import { clamp, rand, dist2D, angleDelta, yawFromDir, segPointDist2D } from '../../core/utils.js';
import { Damper } from '../../core/spring.js';

const RAD2DEG = 180 / Math.PI;

/** The action vocabulary. The orchestrator switches on these. */
export const ACTIONS = Object.freeze({
  ENGAGE: 'ENGAGE',
  REPOSITION: 'REPOSITION',
  RETREAT: 'RETREAT',
  FOLLOW_LEADER: 'FOLLOW_LEADER',
  REVIVE: 'REVIVE',
  GRAB_LOOT: 'GRAB_LOOT',
  USE_ABILITY: 'USE_ABILITY',
  RELOAD: 'RELOAD',
  REGROUP: 'REGROUP',
  ADVANCE_OBJECTIVE: 'ADVANCE_OBJECTIVE',
  IDLE: 'IDLE',
});

/**
 * Minimum seconds an action must be held before anything else may displace it.
 * Tuned per action by how bad it looks to abandon it half-done: a revive that
 * gets cancelled at 80% is worse than a reposition that gets cancelled at 80%.
 */
const DWELL = Object.freeze({
  [ACTIONS.ENGAGE]: 0.45,
  [ACTIONS.REPOSITION]: 0.5,
  [ACTIONS.RETREAT]: 0.9,
  [ACTIONS.FOLLOW_LEADER]: 0.6,
  [ACTIONS.REVIVE]: 1.5,
  [ACTIONS.GRAB_LOOT]: 0.8,
  [ACTIONS.USE_ABILITY]: 0.25,
  [ACTIONS.RELOAD]: 0.3,
  [ACTIONS.REGROUP]: 0.8,
  [ACTIONS.ADVANCE_OBJECTIVE]: 0.7,
  [ACTIONS.IDLE]: 0.2,
});

export const BOT_TUNE = {
  // --- perception ---
  reactionMin: 0.15,        // seconds before a newly-seen threat may be acted on
  reactionMax: 0.30,
  losMemory: 0.6,           // matches the enemy AI's own 0.2s LOS re-test stagger
  aimAcquireDeg: 5.5,       // aim cone on acquisition...
  aimFloorDeg: 1.15,        // ...decaying to the accountant's own weapon spread.
  aimSettle: 0.45,          // Damper smoothTime. Below ~1.2deg the ranged kits stop
                            // working at their design range, so the floor is a floor.

  // --- decision ---
  switchMargin: 0.12,       // a challenger must beat the incumbent by this much
  targetSwitchMargin: 0.25, // ...and by MORE than this to steal focus-fire
  targetDwell: 0.6,

  // --- positioning ---
  leaderLeash: 22,          // EnemyLOD tiers off the human alone: aggro dragged past
                            // 22m degrades to 20Hz AI, which is the inverse of the
                            // co-op signal we are trying to reproduce.
  leaderRegroup: 30,
  leaderComfort: 9,
  spacingMin: 3.5,          // roomba blast 3.4, synergy nova 3.6, auditor slam 4.2
  spacingChain: 6.0,        // itguy arc chains to a 2nd player within 6m; gossip
                            // goo splashes 6.5m. While either lives, spread out.
  strafeFlipMin: 1.8,
  strafeFlipMax: 4.0,

  // --- survival ---
  retreatHp: 0.34,
  recoverHp: 0.55,
  panicDist: 4.0,

  // --- resources ---
  reloadHardFrac: 0.02,     // effectively empty
  reloadSoftFrac: 0.32,
  reloadSafeDist: 8,
  heatCut: 0.80,            // 1.41s on / 0.91s off -> the 1.8s overheat lock never
  heatResume: 0.30,         // fires, at ~60% duty cycle which is the theoretical max
  heatCutOverclock: 0.90,
};

/**
 * Per-class combat doctrine. `hold*` is the range the bot tries to live at,
 * `band*` is the range it tolerates, `hardRange` is where the kit stops working
 * at all. Everything is derived from the kit's own numbers — see the notes.
 */
export const CLASS_DOCTRINE = Object.freeze({
  // staple 56 m/s, no spread, no peel tool: floor is melee reach, ceiling is aim.
  intern: { role: 'ranged', bandMin: 5, bandMax: 20, holdMin: 9, holdMax: 12, hardRange: 34, coneDeg: 5, needLos: true, projSpeed: 56, hasMag: true },
  // reach is range 3.0 + enemy radius, and the swing lunges 3.2 m/s forward.
  janitor: { role: 'melee', bandMin: 0, bandMax: 3.0, holdMin: 1.6, holdMax: 2.6, hardRange: 3.0, coneDeg: 70, needLos: false, projSpeed: 0, hasMag: false, canBlock: true },
  // lowest HP, no defensive tool: the whole class is standing still a long way off.
  accountant: { role: 'ranged', bandMin: 8, bandMax: 25, holdMin: 14, holdMax: 18, hardRange: 30, coneDeg: 4, needLos: true, projSpeed: 62, hasMag: true },
  // homing 3.4 rad/s means aim barely matters; 34 m/s means lead still does.
  hr: { role: 'ranged', bandMin: 7, bandMax: 22, holdMin: 10, holdMax: 14, hardRange: 26, coneDeg: 22, needLos: true, projSpeed: 34, hasMag: true },
  // beamTick hard-stops at 16m. It also does NOT test LOS, so we must.
  it: { role: 'ranged', bandMin: 4, bandMax: 15, holdMin: 8, holdMax: 12, hardRange: 15.5, coneDeg: 10, needLos: true, projSpeed: 0, hasMag: false, hasHeat: true },
  // pierce 3: the interesting behaviour is picking the angle, not the target.
  sales: { role: 'ranged', bandMin: 6, bandMax: 16, holdMin: 8, holdMax: 12, hardRange: 24, coneDeg: 5, needLos: true, projSpeed: 48, hasMag: true },
  // cone radius 7.5 and it aims by YAW ONLY (+-21deg) — the tightest in the game.
  marketing: { role: 'close', bandMin: 2, bandMax: 7, holdMin: 4, holdMax: 6, hardRange: 7.2, coneDeg: 21, needLos: true, projSpeed: 0, hasMag: false },
  // haymaker reach 3.6; knockbackResist 0.65 makes this the designated body.
  brawler: { role: 'melee', bandMin: 0, bandMax: 3.6, holdMin: 1.8, holdMax: 2.8, hardRange: 3.6, coneDeg: 43, needLos: false, projSpeed: 0, hasMag: false },
});

const DEFAULT_DOCTRINE = CLASS_DOCTRINE.intern;

/**
 * Base target desirability. Absolute numbers, not normalised — the distance
 * divisors below do the normalising. Melee overrides zero out the things a melee
 * class must never walk into.
 */
export const THREAT_BASE = Object.freeze({
  karen: -Infinity,   // 950hp / 51 DPS, provoked by ANY damage, hunts only its
                      // provoker and outruns every class. A bot that provokes her
                      // and dies hands the human a permanent hunter. Never.
  gossip: 100,        // a 4s rumor call that ends in a director horde
  micromanager: 95,   // books a meeting that roots whoever it lands on
  streamer: 90,       // marks everyone, rallies everything, queues a horde
  motivator: 85,      // rally x1.3 speed makes roombas outrun sprinting melee
  sysadmin: 80,       // EMP shock disables dash/secondary/consumables
  mediator: 75,       // tether costs the dash, or the fight
  roomba: 60,         // ranged only — see MELEE_BASE
  itguy: 55,          // arc chains to a second player within 6m
  complainer: 50,
  closer: 50,
  auditor: 40,
  pylon: 35,          // ranged only
  hrrep: 30,          // harmless alone, a 40% movement tax in fours
  influencer: 20,
  copier: 15,
});

/**
 * Melee-class overrides. Not "lower priority" — ZERO, because these are targets a
 * melee bot cannot trade with at all and any nonzero score eventually wins.
 *   roomba: fuse arms at 1.8m and detonates for 3.4m. Janitor reach is 3.0 and
 *           the haymaker is 3.6 — both are inside the blast. There is no swing
 *           that beats it once enemyHpScale puts it over a one-shot.
 *   pylon:  4.4m aura at ~13 DPS plus a rolling shock lockout, on 250hp.
 */
const MELEE_BASE = Object.freeze({ roomba: 0, pylon: 0 });

const DEFAULT_BASE = 10;

/** Enemies whose presence forces the party to spread out (chain / splash risk). */
const SPREAD_FORCING = Object.freeze({ itguy: 1, gossip: 1 });

// ---------------------------------------------------------------------------
// scoring helpers
// ---------------------------------------------------------------------------

/**
 * Desirability of one threat for one bot. Exported so the debug panel and the
 * orchestrator's target-marker can show the same number the brain acted on.
 *
 * @param {object} t threat view (see decide() for the snapshot contract)
 * @param {object} doctrine CLASS_DOCTRINE entry
 * @param {object} ctx per-tick context (needs .influencerCount, .leaderPos)
 * @param {{x:number,z:number}} selfPos
 * @returns {number} higher is better; <= 0 means "do not target"
 */
export function scoreThreat(t, doctrine, ctx, selfPos) {
  const melee = doctrine.role === 'melee';
  let base = melee && MELEE_BASE[t.key] !== undefined ? MELEE_BASE[t.key] : THREAT_BASE[t.key];
  if (base === undefined) base = t.boss ? 65 : DEFAULT_BASE;
  if (base <= 0) return base === 0 ? 0 : -Infinity;

  let urgency = 1;
  // A special that is about to resolve its payload is worth more than the same
  // special idling — this is what makes bots interrupt rather than grind.
  switch (t.key) {
    case 'gossip':
      // The call is the whole threat and it is interruptible: four seconds to
      // kill her or the floor gets rerouted onto everyone.
      if (t.casting) urgency *= 4;
      break;
    case 'micromanager':
      if (t.booking && t.onLeader) urgency *= 3;      // the human is on the clock
      else if (t.booking) urgency *= 2;
      break;
    case 'sysadmin':
      if (t.telegraph) urgency *= 2;
      break;
    case 'closer':
      if (t.windup > 0) urgency *= 2;                 // 0.55s, then it is unstoppable
      break;
    case 'influencer':
      if (ctx.influencerCount >= 3) urgency *= 3;     // the scream reassigns aggro
      break;
    case 'hrrep':
      urgency *= 1 + clamp(ctx.hrrepCount - 1, 0, 3) * 0.4;
      break;
    default:
      break;
  }
  if (t.onLeader) urgency *= 1.35;   // the whole point of a teammate is peeling
  if (t.elite) urgency *= 1.15;
  // Nearly-dead things are cheap kills; finishing them shrinks the crowd fastest.
  if (t.hpFrac !== undefined && t.hpFrac < 0.25) urgency *= 1.2;

  // Two independent distance falloffs. Distance-to-human decides whether it is
  // the team's problem at all; distance-to-self decides whether this bot is the
  // one who can solve it. Only the overshoot past our own reach is penalised, so
  // everything already inside the band competes on merit alone.
  const dLeader = t.distToLeader ?? dist2D(t.pos, ctx.leaderPos);
  const over = Math.max(0, (t.dist ?? dist2D(t.pos, selfPos)) - doctrine.hardRange);
  return (base * urgency) / (1 + dLeader / 10) / (1 + over / 12);
}

// ---------------------------------------------------------------------------
// BotBrain
// ---------------------------------------------------------------------------

/** Perception record per known threat. Pooled — these outlive individual ticks. */
function newRecord() {
  return { reaction: 0, age: 0, lostFor: 0, lastSeen: -1, ready: false };
}

export class BotBrain {
  /**
   * @param {string} classKey one of CLASS_DOCTRINE's keys
   * @param {{ personality?: number, botLoot?: boolean, holdObjectiveAlone?: boolean }} [opts]
   *   personality 0..1 skews aggression: 0 = hangs back and holds range, 1 = pushes
   *   1-2m past the band. Give each bot in a party a different value or four bots
   *   will move as one organism and the aggro spread reads nothing like real co-op.
   */
  constructor(classKey, opts = {}) {
    this.classKey = classKey;
    this.doctrine = CLASS_DOCTRINE[classKey] ?? DEFAULT_DOCTRINE;
    this.personality = clamp(opts.personality ?? 0.5, 0, 1);
    // Bots must not steal the run: money/XP/items are the human's. Loot pickup is
    // therefore OFF unless something upstream explicitly opts in per-item.
    this.botLoot = opts.botLoot === true;
    // A bot parked in the elevator ring completes the call on its own, because the
    // hold zone accepts any livePlayers() member. That would let the party skip a
    // floor without the human present, so by default we require the human nearby.
    this.holdObjectiveAlone = opts.holdObjectiveAlone === true;

    this.action = ACTIONS.IDLE;
    this.reason = 'init';
    this.actionSince = 0;
    this.actionScore = 0;
    this.targetId = null;
    this.targetSince = 0;

    // Aim error that shrinks while a target is tracked. Damper, not hand-rolled
    // easing: it is unconditionally stable at any dt, so a 200ms frame hitch
    // cannot snap the bot to a perfect shot.
    this.aim = new Damper(BOT_TUNE.aimAcquireDeg, BOT_TUNE.aimSettle);

    this._seen = new Map();
    this._pool = [];
    this._pruneT = 0;
    this._strafeSign = Math.random() < 0.5 ? -1 : 1;
    this._strafeT = rand(BOT_TUNE.strafeFlipMin, BOT_TUNE.strafeFlipMax);
    this._haymakerHold = 0;
    this._beamOn = true;
    this._lastTime = -1;

    // Everything below is allocated once and mutated in place. This runs for four
    // bots at 60Hz; a fresh decision object per bot per frame is 240 objects/sec
    // of pure GC churn for no reason.
    this._cand = [];
    for (let i = 0; i < 14; i++) this._cand.push({ action: '', score: 0, reason: '', target: null, urgent: false });
    this._candN = 0;

    this._goal = { x: 0, z: 0, kind: 'hold' };
    this._abilityAim = { x: 0, y: 0, z: 0 };
    this._ctx = {
      hpFrac: 1, ammoFrac: 1, leaderDist: 0, leaderPos: { x: 0, z: 0 }, leaderHpFrac: 1,
      nearDist: Infinity, nearThreat: null, count6: 0, count12: 0, frontal: 0,
      specialAlive: false, spreadForcing: false, influencerCount: 0, hrrepCount: 0,
      karen: null, target: null, targetScore: 0, targetPrioNorm: 0, spacing: BOT_TUNE.spacingMin,
      dodge: null, threatCount: 0, lockdown: false,
    };

    /** The decision. Reused every tick — copy anything you need to keep. */
    this.decision = {
      action: ACTIONS.IDLE,
      reason: 'init',
      target: null,
      targetId: null,
      moveGoal: this._goal,
      faceMove: false,       // point yaw at the move direction (required to sprint)
      wantSprint: false,
      wantDash: false,
      dashReason: '',
      desiredRange: 0,
      fire: false,
      fireReason: 'init',
      aimAt: null,
      aimErrorDeg: BOT_TUNE.aimAcquireDeg,
      leadTime: 0,
      useSecondary: false,
      secondaryReason: '',
      secondaryAim: null,
      wantReload: false,
      wantBlock: false,
      holdHaymaker: false,
      beamOn: true,
      scores: this._cand,
      scoreCount: 0,
    };
  }

  /** Floor change, respawn, or anything that invalidates perception continuity. */
  reset(time = 0) {
    for (const [, r] of this._seen) this._pool.push(r);
    this._seen.clear();
    this.action = ACTIONS.IDLE;
    this.reason = 'reset';
    this.actionSince = time;
    this.actionScore = 0;
    this.targetId = null;
    this.targetSince = time;
    this.aim.snap(BOT_TUNE.aimAcquireDeg);
    this._haymakerHold = 0;
    this._beamOn = true;
    this._lastTime = -1;
    const d = this.decision;
    d.action = ACTIONS.IDLE; d.reason = 'reset'; d.target = null; d.targetId = null;
    d.fire = false; d.useSecondary = false; d.wantReload = false; d.wantBlock = false;
    d.scoreCount = 0;
  }

  /**
   * Score every action and commit to one.
   *
   * SNAPSHOT CONTRACT (all plain data; no THREE, nothing is retained):
   *   time    number, monotonic seconds. Use game.runTime — net.now is
   *           PERMANENTLY 0 when solo and will freeze every timer in here.
   *   self    { pos:{x,y,z}, yaw, hp, maxHp, ammo, magSize, reloading, dead,
   *             heat, overheated, stunned, shocked, booked, tethered,
   *             dashReady, secondaryReady, punchCount, overclock }
   *   leader  { pos, hp, maxHp, dead, down } — the HUMAN. May be null.
   *   allies  [ { id, pos, hp, maxHp, dead, down, isLeader } ]
   *   threats [ { id, key, pos:{x,y,z}, aimPos:{x,y,z}, dist, distToLeader,
   *               hpFrac, los, elite, boss, special, big, rare, windup,
   *               telegraph, casting, booking, onLeader, radius, speed } ]
   *             `casting` = the Gossip's rumor call is live (interruptible);
   *             `booking` = the Micromanager has a meeting on someone's clock.
   *             `aimPos` must be the enemy CENTER (pos.y + def.centerY) or every
   *             shot at a Delivery Drone hovering at 3.4m goes low.
   *   hazards [ { x, z, radius, urgent } ] EMP fields, coffee puddles, telegraphs.
   *   world   { lockdown, elevatorReady, objectivePos, objectiveDist, runOver,
   *             loot: [{ id, pos, dist, forBot }], coeff }
   *
   * The brain writes three fields back onto each threat VIEW: `dist` (cached),
   * `actionable` (reaction delay elapsed and still remembered) and `forgotten`
   * (LOS memory expired). Those are annotations on the orchestrator's own
   * per-tick scratch objects, not on game entities — writing them beats
   * allocating a parallel array of 40 perception records every frame.
   *
   * @param {object} snap
   * @param {number} [dt] seconds; derived from snap.time if omitted
   * @returns {object} this.decision — reused, do not retain
   */
  decide(snap, dt) {
    const d = this.decision;
    // NEVER THROW. A bot with a malformed snapshot idles in place; it does not
    // take the run down with it.
    if (!snap || !snap.self) {
      d.action = ACTIONS.IDLE; d.reason = 'no-snapshot'; d.fire = false;
      d.useSecondary = false; d.scoreCount = 0;
      return d;
    }

    const time = Number.isFinite(snap.time) ? snap.time : (this._lastTime < 0 ? 0 : this._lastTime);
    if (!Number.isFinite(dt)) dt = this._lastTime < 0 ? 0 : time - this._lastTime;
    // Clamp: a tab-out produces a multi-second dt that would age every reaction
    // timer past its threshold at once and make the whole party twitch on return.
    dt = clamp(dt, 0, 0.25);
    this._lastTime = time;

    const self = snap.self;
    if (self.dead || snap.world?.runOver) {
      d.action = ACTIONS.IDLE; d.reason = self.dead ? 'dead' : 'run-over';
      d.fire = false; d.useSecondary = false; d.wantBlock = false; d.scoreCount = 0;
      return d;
    }

    this._perceive(snap, dt, time);
    this._buildContext(snap, time);
    this._scoreAll(snap);
    this._commit(time);
    this._emit(snap, dt);
    return d;
  }

  // -------------------------------------------------------------------------
  // perception — reaction delay + LOS memory
  // -------------------------------------------------------------------------

  _perceive(snap, dt, time) {
    const seen = this._seen;
    const threats = snap.threats;
    if (!threats) return;

    for (let i = 0; i < threats.length; i++) {
      const t = threats[i];
      if (!t || t.id === undefined) continue;
      let r = seen.get(t.id);
      if (!r) {
        r = this._pool.pop() ?? newRecord();
        // Per-threat, not per-bot: a bot with one global reaction timer reacts to
        // an ambush of six in a single synchronised instant, which no human does.
        r.reaction = rand(BOT_TUNE.reactionMin, BOT_TUNE.reactionMax);
        r.age = 0; r.lostFor = 0; r.ready = false;
        seen.set(t.id, r);
      }
      r.lastSeen = time;
      if (t.los) {
        r.age += dt;
        r.lostFor = 0;
      } else {
        r.lostFor += dt;
        // Out of sight, the reaction clock stops but does not rewind — stepping
        // back out from behind the same pillar should not cost a fresh 300ms.
      }
      r.ready = r.age >= r.reaction;
      t.actionable = r.ready && (t.los || r.lostFor < BOT_TUNE.losMemory);
      t.forgotten = !t.los && r.lostFor >= BOT_TUNE.losMemory;
    }

    // Prune on a 1s cadence rather than every frame: the map is small, but this
    // is four bots x 60Hz and the work is pure garbage collection.
    this._pruneT += dt;
    if (this._pruneT >= 1) {
      this._pruneT = 0;
      for (const [id, r] of seen) {
        if (time - r.lastSeen > 3) { seen.delete(id); this._pool.push(r); }
      }
    }
  }

  // -------------------------------------------------------------------------
  // context
  // -------------------------------------------------------------------------

  _buildContext(snap, time) {
    const c = this._ctx;
    const self = snap.self;
    const doctrine = this.doctrine;

    c.hpFrac = clamp(self.hp / Math.max(1, self.maxHp), 0, 1);
    c.ammoFrac = doctrine.hasMag && self.magSize ? clamp(self.ammo / self.magSize, 0, 1) : 1;
    c.lockdown = !!snap.world?.lockdown;

    const leader = snap.leader;
    if (leader && leader.pos) {
      c.leaderPos.x = leader.pos.x; c.leaderPos.z = leader.pos.z;
      c.leaderDist = dist2D(self.pos, leader.pos);
      c.leaderHpFrac = clamp(leader.hp / Math.max(1, leader.maxHp), 0, 1);
    } else {
      // No human (spectating, teardown mid-frame): fall back to holding station
      // where we stand rather than sprinting at coordinate zero.
      c.leaderPos.x = self.pos.x; c.leaderPos.z = self.pos.z;
      c.leaderDist = 0; c.leaderHpFrac = 1;
    }

    c.nearDist = Infinity; c.nearThreat = null;
    c.count6 = 0; c.count12 = 0; c.frontal = 0;
    c.specialAlive = false; c.spreadForcing = false;
    c.influencerCount = 0; c.hrrepCount = 0; c.karen = null;
    c.target = null; c.targetScore = 0;

    const threats = snap.threats ?? [];
    c.threatCount = threats.length;
    const fx = Math.sin(self.yaw), fz = Math.cos(self.yaw);

    // Pass 1: population stats that pass 2's scoring depends on.
    for (let i = 0; i < threats.length; i++) {
      const t = threats[i];
      if (!t) continue;
      if (t.key === 'influencer') c.influencerCount++;
      else if (t.key === 'hrrep') c.hrrepCount++;
      else if (t.key === 'karen') c.karen = t;
      if (t.special) c.specialAlive = true;
      if (SPREAD_FORCING[t.key]) c.spreadForcing = true;
    }
    c.spacing = c.spreadForcing ? BOT_TUNE.spacingChain : BOT_TUNE.spacingMin;

    // Pass 2: proximity + target selection.
    let best = null, bestScore = 0;
    for (let i = 0; i < threats.length; i++) {
      const t = threats[i];
      if (!t) continue;
      const dist = t.dist ?? dist2D(self.pos, t.pos);
      t.dist = dist;

      // Proximity counts intentionally ignore the reaction gate: getting crowded
      // is a physical fact, not a perception, and a bot that does not feel the
      // press until it has "reacted" walks into packs.
      if (dist < c.nearDist) { c.nearDist = dist; c.nearThreat = t; }
      if (dist < 6) c.count6++;
      if (dist < 12) c.count12++;
      if (dist < 5) {
        const dx = t.pos.x - self.pos.x, dz = t.pos.z - self.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        if ((fx * dx + fz * dz) / l > 0.25) c.frontal++;   // the block arc is 151deg
      }

      if (!t.actionable || t.forgotten) continue;
      if (doctrine.needLos && !t.los) continue;
      const s = scoreThreat(t, doctrine, c, self.pos);
      if (s > bestScore) { bestScore = s; best = t; }
    }

    // Focus fire with hysteresis: swapping targets every time a paperling drifts
    // half a metre closer means nothing ever dies, and DPS-through-the-wave is
    // the single number a pacing playtest is measuring.
    if (this.targetId !== null) {
      let cur = null;
      for (let i = 0; i < threats.length; i++) {
        if (threats[i] && threats[i].id === this.targetId) { cur = threats[i]; break; }
      }
      const curOk = cur && cur.actionable && !cur.forgotten && (!doctrine.needLos || cur.los);
      if (curOk) {
        const curScore = scoreThreat(cur, doctrine, c, self.pos);
        const held = time - this.targetSince;
        if (held < BOT_TUNE.targetDwell || bestScore < curScore * (1 + BOT_TUNE.targetSwitchMargin)) {
          best = cur; bestScore = curScore;
        }
      }
    }

    if (best && bestScore > 0) {
      if (!this.targetId || this.targetId !== best.id) {
        this.targetId = best.id;
        this.targetSince = time;
        // Fresh target = fresh aim cone. This is why bots miss the first shots of
        // a swap instead of snapping onto every new head that appears.
        this.aim.snap(BOT_TUNE.aimAcquireDeg);
      }
      c.target = best;
      c.targetScore = bestScore;
    } else {
      this.targetId = null;
      c.target = null;
      c.targetScore = 0;
    }
    c.targetPrioNorm = clamp(bestScore / 120, 0, 1);

    // Hazard / telegraph the bot is currently standing in. Sysadmin gives 0.9s to
    // clear a 5m circle and every class can cover that at walking speed — failing
    // it does not read as a hard fight, it reads as a broken bot.
    c.dodge = null;
    const hz = snap.hazards;
    if (hz) {
      let worst = 0;
      for (let i = 0; i < hz.length; i++) {
        const h = hz[i];
        if (!h) continue;
        const dx = self.pos.x - h.x, dz = self.pos.z - h.z;
        const d = Math.hypot(dx, dz);
        if (d > h.radius) continue;
        const pen = (h.radius - d) * (h.urgent ? 2 : 1);
        if (pen > worst) { worst = pen; c.dodge = h; }
      }
    }
  }

  // -------------------------------------------------------------------------
  // candidate scoring
  // -------------------------------------------------------------------------

  _push(action, score, reason, target, urgent) {
    if (this._candN >= this._cand.length) return;
    const s = this._cand[this._candN++];
    s.action = action; s.score = score; s.reason = reason;
    s.target = target ?? null; s.urgent = !!urgent;
  }

  _scoreAll(snap) {
    this._candN = 0;
    const c = this._ctx;
    const self = snap.self;
    const doctrine = this.doctrine;
    const world = snap.world ?? {};

    // ---- DODGE (as REPOSITION) ------------------------------------------
    // Urgent so it can preempt dwell — see the module header.
    if (c.dodge) {
      this._push(ACTIONS.REPOSITION, 1.35, c.dodge.urgent ? 'telegraph' : 'hazard', null, true);
    }

    // Melee classes have two positions they must never hold, and both are
    // "standing still while something else ticks damage on you".
    if (doctrine.role === 'melee' && c.nearThreat) {
      if (c.nearThreat.key === 'roomba' && c.nearDist < 5) {
        this._push(ACTIONS.REPOSITION, 1.2, 'roomba-blast', c.nearThreat, true);
      } else if (c.nearThreat.key === 'pylon' && c.nearDist < 4.8) {
        this._push(ACTIONS.REPOSITION, 1.0, 'pylon-aura', c.nearThreat, true);
      }
    }

    // ---- RETREAT ---------------------------------------------------------
    // Two independent pressures: how hurt we are, and how surrounded we are.
    // Either alone can justify backing off; together they should be decisive.
    const hurt = clamp((BOT_TUNE.retreatHp - c.hpFrac) / Math.max(0.01, BOT_TUNE.retreatHp), 0, 1);
    const pressed = clamp(1 - c.nearDist / BOT_TUNE.panicDist, 0, 1);
    // Low HP alone is not a reason to run — there has to be something to run FROM.
    // Without this a bot that survives a wave at 20% keeps sprinting away from an
    // empty room instead of rejoining, which reads as the AI being stuck.
    const inDanger = clamp(1 - Math.max(0, c.nearDist - 6) / 8, 0, 1);
    let retreat = hurt * 0.85 * inDanger + pressed * hurt * 0.5 + clamp(c.count6 / 5, 0, 1) * 0.2;
    if (self.booked) retreat += 0.25;
    if (c.hpFrac < 0.18) retreat += 0.3;
    // Asymmetric exit: once retreating we keep retreating until healthy again,
    // otherwise the bot bounces off its own threshold at exactly retreatHp.
    if (this.action === ACTIONS.RETREAT && c.hpFrac < BOT_TUNE.recoverHp) retreat += 0.25;
    if (retreat > 0.05) this._push(ACTIONS.RETREAT, retreat, 'hurt', c.nearThreat, c.hpFrac < 0.18);

    // ---- ENGAGE ----------------------------------------------------------
    if (c.target) {
      const inBand = c.target.dist >= doctrine.bandMin && c.target.dist <= doctrine.bandMax;
      let engage = 0.5 + c.targetPrioNorm * 0.38 + (inBand ? 0.12 : 0);
      if (c.ammoFrac <= BOT_TUNE.reloadHardFrac) engage -= 0.45;   // dry: nothing to engage with
      else if (c.ammoFrac < 0.2) engage -= 0.12;
      if (doctrine.hasHeat && self.overheated) engage -= 0.35;
      if (c.hpFrac < BOT_TUNE.retreatHp) engage -= 0.2;
      // Aggression personality: a whole party of identical bots moves as one
      // organism and the aggro spread stops resembling four different people.
      engage += (this.personality - 0.5) * 0.12;
      this._push(ACTIONS.ENGAGE, clamp(engage, 0, 1.2), inBand ? 'in-band' : 'closing', c.target, false);

      // ---- REPOSITION (band correction) ---------------------------------
      // Out of band is not out of the fight — it is the same fight from the
      // wrong distance, which is how the ranged classes get chewed up.
      if (!inBand) {
        const off = c.target.dist < doctrine.bandMin
          ? (doctrine.bandMin - c.target.dist) / Math.max(1, doctrine.bandMin)
          : (c.target.dist - doctrine.bandMax) / Math.max(1, doctrine.bandMax);
        this._push(ACTIONS.REPOSITION, clamp(0.45 + off * 0.5, 0, 1.05),
          c.target.dist < doctrine.bandMin ? 'too-close' : 'too-far', c.target, false);
      }
    }

    // Party spacing. Four bots stacked on the human means every AoE in the game
    // hits the entire party at once and the Director's teamSpread reads zero.
    if (c.leaderDist < c.spacing && c.threatCount > 0) {
      this._push(ACTIONS.REPOSITION, 0.55 + (c.spacing - c.leaderDist) * 0.08, 'spacing', null, false);
    }

    // ---- FOLLOW / REGROUP ------------------------------------------------
    // Past the leash, enemies chasing this bot drop to 20Hz thinking because LOD
    // tiers off the human alone. Aggro dragged out there stops behaving like
    // aggro, so distance from the human is a hard behavioural constraint.
    if (c.leaderDist > BOT_TUNE.leaderRegroup) {
      this._push(ACTIONS.REGROUP, 1.25, 'lost-the-party', null, true);
    } else if (c.leaderDist > BOT_TUNE.leaderLeash) {
      this._push(ACTIONS.REGROUP, 0.85 + (c.leaderDist - BOT_TUNE.leaderLeash) * 0.03, 'leash', null, false);
    } else if (c.leaderDist > BOT_TUNE.leaderComfort) {
      const t = (c.leaderDist - BOT_TUNE.leaderComfort) / (BOT_TUNE.leaderLeash - BOT_TUNE.leaderComfort);
      // Following must lose to fighting when there is something to fight, or the
      // bots trail the human in a conga line and never take a single enemy.
      this._push(ACTIONS.FOLLOW_LEADER, clamp(0.25 + t * 0.45, 0, 0.8), 'catching-up', null, false);
    } else if (!c.target) {
      this._push(ACTIONS.FOLLOW_LEADER, 0.3, 'idle-follow', null, false);
    }

    // ---- REVIVE ----------------------------------------------------------
    const down = this._nearestDown(snap);
    if (down) {
      const dd = dist2D(self.pos, down.pos);
      let rev = clamp(1.0 - dd / 40, 0.35, 1.0);
      if (down.isLeader) rev += 0.3;                     // the run ends without them
      if (c.count6 >= 3 && c.hpFrac < 0.4) rev -= 0.35;  // dying next to them helps nobody
      this._push(ACTIONS.REVIVE, rev, down.isLeader ? 'leader-down' : 'ally-down', down, false);
    }

    // ---- RELOAD ----------------------------------------------------------
    if (doctrine.hasMag && !self.reloading) {
      if (c.ammoFrac <= BOT_TUNE.reloadHardFrac) {
        this._push(ACTIONS.RELOAD, 0.95, 'empty', null, true);
      } else if (c.ammoFrac < BOT_TUNE.reloadSoftFrac && c.nearDist > BOT_TUNE.reloadSafeDist) {
        // Topping off during a lull is free; topping off with something at 4m is
        // a second of standing still, which is how the low-HP classes die.
        this._push(ACTIONS.RELOAD, 0.55, 'top-off', null, false);
      }
    }

    // ---- USE_ABILITY -----------------------------------------------------
    const ab = this._evalSecondary(snap, c);
    if (ab.score > 0) this._push(ACTIONS.USE_ABILITY, ab.score, ab.reason, c.target, ab.urgent);
    this._ability = ab;

    // ---- GRAB_LOOT -------------------------------------------------------
    // Default-off: loot, XP and Department Budget attribution belongs to the
    // human. Items are only chased when something upstream flags them for bots.
    if (this.botLoot && world.loot) {
      for (let i = 0; i < world.loot.length; i++) {
        const it = world.loot[i];
        if (!it || it.forBot !== true) continue;
        const dd = it.dist ?? dist2D(self.pos, it.pos);
        if (dd > 25) continue;
        this._push(ACTIONS.GRAB_LOOT, clamp(0.5 - dd / 60, 0.1, 0.5), 'loot', it, false);
        break;
      }
    }

    // ---- ADVANCE_OBJECTIVE ----------------------------------------------
    if (world.elevatorReady && !c.lockdown && world.objectivePos) {
      const leaderNear = this.holdObjectiveAlone
        || dist2D(c.leaderPos, world.objectivePos) < 14;
      if (leaderNear) {
        // Below the FOLLOW ceiling on purpose: bots suggest the exit, they do not
        // drag the party through it.
        this._push(ACTIONS.ADVANCE_OBJECTIVE, c.threatCount === 0 ? 0.7 : 0.42, 'elevator', null, false);
      }
    }

    // Always a floor candidate so `_commit` can never come up empty.
    this._push(ACTIONS.IDLE, 0.05, 'nothing-to-do', null, false);
    this.decision.scoreCount = this._candN;
  }

  _nearestDown(snap) {
    const allies = snap.allies;
    let best = null, bd = Infinity;
    if (allies) {
      for (let i = 0; i < allies.length; i++) {
        const a = allies[i];
        if (!a || !a.down || !a.pos) continue;
        const d = dist2D(snap.self.pos, a.pos);
        if (d < bd) { bd = d; best = a; }
      }
    }
    const leader = snap.leader;
    if (leader && leader.down && leader.pos) {
      const d = dist2D(snap.self.pos, leader.pos);
      if (d < bd) { best = leader; }
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // per-class secondary logic
  // -------------------------------------------------------------------------

  /**
   * @returns {{score:number, reason:string, urgent:boolean, aim:string}}
   *   aim: 'target' | 'cluster' | 'forward' | 'self' — the orchestrator resolves
   *   it into the aim object the kit expects (several kits need `aim.point`, and
   *   HR's Mandatory Meeting silently lands on the caster's own feet without it).
   */
  _evalSecondary(snap, c) {
    const out = this._ab ?? (this._ab = { score: 0, reason: '', urgent: false, aim: 'target' });
    out.score = 0; out.reason = ''; out.urgent = false; out.aim = 'target';

    const self = snap.self;
    // Shock disables the secondary outright — offering it would make the bot
    // spam a button that does nothing and read as stuck.
    if (!self.secondaryReady || self.shocked) return out;

    const t = c.target;
    const cluster = this._clusterCount(snap, c);

    switch (this.classKey) {
      case 'intern':
        // 16deg fan, 5 staples: only worth it on a body wide enough to eat the
        // whole spread, or a packed line. Otherwise it is a 5s cooldown for one hit.
        if (t && t.dist < 6 && (t.big || t.rare || t.boss)) { out.score = 0.62; out.reason = 'fan-big'; }
        else if (cluster >= 3 && c.nearDist < 8) { out.score = 0.58; out.reason = 'fan-pack'; out.aim = 'cluster'; }
        break;

      case 'janitor':
        // Lid Up is a held STATE, not a cast — it is emitted as wantBlock in
        // _emit(). Never scored as an action or the bot would "use" it forever.
        break;

      case 'accountant':
        // +30% team damage for 6s on an 11s cooldown, 14m from the caster with no
        // LOS test. Uptime is the whole value; there is no better moment to save
        // it for. Fires on any worthwhile crowd, and unconditionally at lockdown.
        if (c.lockdown && c.count12 >= 2) { out.score = 0.85; out.reason = 'audit-lockdown'; out.aim = 'self'; }
        else if (cluster >= 4) { out.score = 0.72; out.reason = 'audit-crowd'; out.aim = 'self'; }
        else if (t && t.dist < 14 && (t.rare || t.boss || t.big || t.special)) { out.score = 0.7; out.reason = 'audit-priority'; out.aim = 'self'; }
        break;

      case 'hr':
        // Slow to 0.4x. Value scales with how fast the things inside it are, so
        // it wants to land ahead of a rush, not on top of the current crowd.
        if (cluster >= 3) { out.score = 0.72; out.reason = 'meeting-pack'; out.aim = 'cluster'; }
        else if (c.nearThreat && c.nearThreat.speed >= 6 && c.nearDist < 12) { out.score = 0.66; out.reason = 'meeting-runner'; out.aim = 'cluster'; }
        break;

      case 'it':
        // ttl 25s on a 14s cooldown = 100% uptime is free. Recast whenever the
        // fight justifies a turret at all; holding it back only wastes seconds.
        if (c.lockdown || cluster >= 3 || c.count12 >= 3) { out.score = 0.68; out.reason = 'router'; out.aim = 'self'; }
        break;

      case 'sales':
        // Cold Call is a PEEL, not damage: 16 knockback in a 70deg cone.
        if (c.hpFrac < 0.4 && c.nearDist < 4) { out.score = 0.95; out.reason = 'coldcall-escape'; out.urgent = true; }
        else if (cluster >= 3 && c.nearDist < 9) { out.score = 0.6; out.reason = 'coldcall-pack'; out.aim = 'cluster'; }
        break;

      case 'marketing':
        // Full Send is 26 m/s of committed travel. The wall check is the
        // orchestrator's job (bvh.segmentBlocked 12m ahead) — a launch into a
        // wall burns 7s and looks broken — so this only expresses intent.
        if (c.hpFrac < 0.35 && c.count6 >= 2) { out.score = 1.0; out.reason = 'fullsend-escape'; out.urgent = true; out.aim = 'forward'; }
        else if (c.leaderDist > 18) { out.score = 0.75; out.reason = 'fullsend-regroup'; out.aim = 'forward'; }
        else if (cluster >= 3) { out.score = 0.6; out.reason = 'fullsend-ram'; out.aim = 'forward'; }
        break;

      case 'brawler':
        // Body Check has i-frames for its entire 0.65s. That makes it the panic
        // button first and the gap-closer second.
        if (c.hpFrac < 0.3 && c.count6 >= 2) { out.score = 1.0; out.reason = 'bodycheck-iframes'; out.urgent = true; out.aim = 'forward'; }
        else if (t && t.special && t.dist > 5 && t.dist < 14) { out.score = 0.8; out.reason = 'bodycheck-special'; out.aim = 'target'; }
        else if (cluster >= 3 && c.nearDist < 14) { out.score = 0.62; out.reason = 'bodycheck-pack'; out.aim = 'forward'; }
        break;

      case 'barista':
        // Steam Burst is worth exactly what the gauge holds — 0.6x cold, 3.2x
        // full — so the decision is never "is there a target", it is "is the
        // gauge worth spending". The one exception is escaping.
        if (c.hpFrac < 0.35 && c.count6 >= 2) { out.score = 0.92; out.reason = 'burst-escape'; out.urgent = true; out.aim = 'self'; }
        else if ((self.heat ?? 0) > 0.85) { out.score = 0.8; out.reason = 'burst-nearlock'; out.aim = 'self'; }
        else if ((self.heat ?? 0) > 0.55 && cluster >= 2) { out.score = 0.7; out.reason = 'burst-hot'; out.aim = 'self'; }
        break;

      case 'analyst':
        // Risk Assessment is a 9s single-target +45%. It is worth a cooldown
        // only on something that will still be alive to receive it.
        if (t && (t.boss || t.rare)) { out.score = 0.85; out.reason = 'flag-boss'; }
        else if (t && (t.big || t.special) && t.dist < 30) { out.score = 0.7; out.reason = 'flag-priority'; }
        break;

      default:
        break;
    }
    return out;
  }

  /**
   * How many threats sit inside a 6.5m circle centred on the best candidate
   * centre, and where that centre is. O(n^2) but bounded to 24 threats and only
   * evaluated when a secondary is actually off cooldown.
   */
  _clusterCount(snap, c) {
    const threats = snap.threats;
    if (!threats || !threats.length) return 0;
    const n = Math.min(threats.length, 24);
    let bestN = 0, bx = 0, bz = 0;
    for (let i = 0; i < n; i++) {
      const a = threats[i];
      if (!a || a.dist > 20 || a.key === 'karen') continue;
      let count = 0;
      for (let j = 0; j < n; j++) {
        const b = threats[j];
        if (!b || b.key === 'karen') continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        if (dx * dx + dz * dz < 42.25) count++;   // 6.5m
      }
      if (count > bestN) { bestN = count; bx = a.pos.x; bz = a.pos.z; }
    }
    // Karen is excluded from the centre search AND vetoes a placement she would
    // sit inside: any AoE that clips her provokes 950hp of hunter. A "never
    // target karen" filter alone is not enough — the splash has to miss her too.
    if (bestN > 0 && c.karen) {
      const dx = c.karen.pos.x - bx, dz = c.karen.pos.z - bz;
      if (dx * dx + dz * dz < 81) return 0;       // 9m of margin around her
    }
    this._abilityAim.x = bx; this._abilityAim.y = 0; this._abilityAim.z = bz;
    return bestN;
  }

  // -------------------------------------------------------------------------
  // commit — hysteresis
  // -------------------------------------------------------------------------

  _commit(time) {
    let best = this._cand[0];
    let curScore = -1;
    for (let i = 0; i < this._candN; i++) {
      const s = this._cand[i];
      if (s.score > best.score) best = s;
      if (s.action === this.action && s.score > curScore) curScore = s.score;
    }

    if (best.action === this.action) {
      this.actionScore = best.score;
      this.reason = best.reason;
      this._commitTarget(best);
      return;
    }

    // The current action stopped being offered at all (target died, hazard gone).
    // Switching immediately is correct — dwell exists to stop jitter between two
    // live options, not to keep a bot committed to something that no longer exists.
    const incumbentGone = curScore < 0;
    if (!best.urgent && !incumbentGone) {
      if (time - this.actionSince < (DWELL[this.action] ?? 0.4)) { this.actionScore = curScore; return; }
      if (best.score < curScore + BOT_TUNE.switchMargin) { this.actionScore = curScore; return; }
    }

    this.action = best.action;
    this.reason = best.reason;
    this.actionScore = best.score;
    this.actionSince = time;
    this._commitTarget(best);
  }

  _commitTarget(best) {
    const d = this.decision;
    d.action = this.action;
    d.reason = this.reason;
    // ENGAGE/USE_ABILITY keep the focus-fire target; the movement actions carry
    // whatever they were scored against (a downed ally, a loot drop, the roomba
    // we are running from) so the orchestrator has something to steer at.
    d.target = best.target ?? this._ctx.target;
    d.targetId = d.target && d.target.id !== undefined ? d.target.id : null;
  }

  // -------------------------------------------------------------------------
  // emit — movement goal, aim, trigger discipline
  // -------------------------------------------------------------------------

  _emit(snap, dt) {
    const d = this.decision;
    const c = this._ctx;
    const self = snap.self;
    const doctrine = this.doctrine;
    const goal = this._goal;

    // Strafe sign flips on a timer so the bot's sidestep does not read as a
    // metronome, and so two bots in the same fight do not orbit in lockstep.
    this._strafeT -= dt;
    if (this._strafeT <= 0) {
      this._strafeSign = -this._strafeSign;
      this._strafeT = rand(BOT_TUNE.strafeFlipMin, BOT_TUNE.strafeFlipMax);
    }

    d.faceMove = false;
    d.wantSprint = false;
    d.wantDash = false;
    d.dashReason = '';
    d.desiredRange = (doctrine.holdMin + doctrine.holdMax) * 0.5;

    goal.x = self.pos.x; goal.z = self.pos.z; goal.kind = 'hold';

    switch (this.action) {
      case ACTIONS.ENGAGE: {
        const t = d.target ?? c.target;
        if (t) {
          const hold = doctrine.holdMin + (doctrine.holdMax - doctrine.holdMin) * (1 - this.personality);
          this._orbit(goal, self.pos, t.pos, hold);
          goal.kind = 'orbit';
        }
        break;
      }
      case ACTIONS.REPOSITION: {
        if (this.reason === 'telegraph' || this.reason === 'hazard') {
          const h = c.dodge;
          if (h) { this._away(goal, self.pos, h, h.radius + 2.5); goal.kind = 'dodge'; d.faceMove = true; }
        } else if (this.reason === 'spacing') {
          this._away(goal, self.pos, c.leaderPos, c.spacing + 1.5);
          goal.kind = 'spread';
        } else if (this.reason === 'roomba-blast' || this.reason === 'pylon-aura') {
          const t = d.target ?? c.nearThreat;
          if (t) { this._away(goal, self.pos, t.pos, this.reason === 'roomba-blast' ? 6.5 : 6.0); goal.kind = 'kite'; d.faceMove = true; }
        } else {
          const t = d.target ?? c.target;
          if (t) { this._orbit(goal, self.pos, t.pos, (doctrine.holdMin + doctrine.holdMax) * 0.5); goal.kind = 'band'; }
        }
        break;
      }
      case ACTIONS.RETREAT: {
        const t = c.nearThreat;
        if (t) this._away(goal, self.pos, t.pos, 12);
        // Bias the retreat toward the human. Running away from the fight AND the
        // party is how a bot ends up alone at 40m where the LOD makes its pursuers
        // think at 5Hz — which reads as the bot escaping for free.
        goal.x = goal.x * 0.65 + c.leaderPos.x * 0.35;
        goal.z = goal.z * 0.65 + c.leaderPos.z * 0.35;
        // ...but never THROUGH them. A panicking bot that ends up standing inside
        // the human hands every AoE in the game a two-for-one and makes the
        // Director's teamSpread read zero at the exact moment it matters most.
        this._pushOff(goal, c.leaderPos, c.spacing);
        goal.kind = 'retreat';
        // Sprint requires FORWARD intent, so fleeing means turning your back on
        // the thing chasing you. That constraint is free panic-body-language.
        d.faceMove = true;
        d.wantSprint = true;
        if (self.dashReady && (self.booked || self.tethered || c.nearDist < 3)) {
          d.wantDash = true;
          // dashing is the only way out of a meeting, and it cuts a leash too
          d.dashReason = self.booked ? 'leave-meeting' : self.tethered ? 'break-tether' : 'disengage';
        }
        break;
      }
      case ACTIONS.REGROUP:
      case ACTIONS.FOLLOW_LEADER: {
        // Stop at comfort range, not on top of the human — see the spacing note.
        this._toward(goal, self.pos, c.leaderPos, Math.max(c.spacing, BOT_TUNE.leaderComfort * 0.75));
        goal.kind = 'follow';
        d.faceMove = true;
        d.wantSprint = this.action === ACTIONS.REGROUP || c.leaderDist > BOT_TUNE.leaderLeash * 0.8;
        break;
      }
      case ACTIONS.REVIVE: {
        const a = d.target;
        if (a && a.pos) { this._toward(goal, self.pos, a.pos, 1.2); goal.kind = 'revive'; }
        d.faceMove = true;
        d.wantSprint = c.nearDist > 8;
        break;
      }
      case ACTIONS.GRAB_LOOT: {
        const it = d.target;
        if (it && it.pos) { this._toward(goal, self.pos, it.pos, 0.5); goal.kind = 'loot'; }
        d.faceMove = true;
        break;
      }
      case ACTIONS.ADVANCE_OBJECTIVE: {
        const o = snap.world?.objectivePos;
        if (o) { this._toward(goal, self.pos, o, 1.5); goal.kind = 'objective'; }
        d.faceMove = true;
        d.wantSprint = c.threatCount === 0;
        break;
      }
      case ACTIONS.RELOAD: {
        // Reloading is 1.0-1.45s of standing still. Back off while it happens.
        if (c.nearThreat && c.nearDist < BOT_TUNE.reloadSafeDist) {
          this._away(goal, self.pos, c.nearThreat.pos, BOT_TUNE.reloadSafeDist + 2);
          goal.kind = 'reload-back';
          d.faceMove = true;
        }
        break;
      }
      case ACTIONS.USE_ABILITY: {
        const t = d.target ?? c.target;
        if (t) { this._orbit(goal, self.pos, t.pos, (doctrine.holdMin + doctrine.holdMax) * 0.5); goal.kind = 'orbit'; }
        break;
      }
      default:
        break;
    }

    // ---- aim -------------------------------------------------------------
    const t = c.target;
    d.aimAt = t ? (t.aimPos ?? t.pos) : null;
    // Error shrinks toward the floor only while the target is actually visible;
    // tracking a remembered target through a wall must not sharpen the shot.
    const settleTarget = t && t.los ? BOT_TUNE.aimFloorDeg : BOT_TUNE.aimAcquireDeg * 0.75;
    d.aimErrorDeg = this.aim.to(settleTarget, dt);
    d.leadTime = t && doctrine.projSpeed > 0 ? t.dist / doctrine.projSpeed : 0;

    // ---- trigger discipline ---------------------------------------------
    d.fire = false;
    d.fireReason = 'no-target';
    if (t && !self.stunned) {
      const yawErr = Math.abs(angleDelta(self.yaw, yawFromDir(t.pos.x - self.pos.x, t.pos.z - self.pos.z))) * RAD2DEG;
      if (this.action !== ACTIONS.ENGAGE && this.action !== ACTIONS.REPOSITION && this.action !== ACTIONS.USE_ABILITY) d.fireReason = 'busy';
      else if (!t.actionable) d.fireReason = 'reacting';
      // beamTick performs NO line-of-sight test and will happily melt things
      // through cubicle walls. Every LOS gate in this codebase for the IT class
      // is this one, so it is not optional.
      else if (doctrine.needLos && !t.los) d.fireReason = 'no-los';
      else if (t.dist > doctrine.hardRange) d.fireReason = 'out-of-range';
      // The yaw-only kits (janitor/brawler/marketing/sales-secondary) resolve
      // their cone from player.yaw and ignore aim.dir entirely, so the yaw damper
      // IS their accuracy model. Firing before it has caught up is a wasted swing.
      else if (yawErr > doctrine.coneDeg) d.fireReason = 'off-axis';
      else if (doctrine.hasMag && self.ammo <= 0) d.fireReason = 'empty';
      else if (doctrine.hasHeat && (self.overheated || !this._beamOn)) d.fireReason = 'heat';
      else if (this._karenInLine(snap, t)) d.fireReason = 'karen-in-line';
      else { d.fire = true; d.fireReason = 'clear'; }
    }

    // ---- resources -------------------------------------------------------
    d.wantReload = doctrine.hasMag && !self.reloading
      && (c.ammoFrac <= BOT_TUNE.reloadHardFrac
        || (c.ammoFrac < BOT_TUNE.reloadSoftFrac && c.nearDist > BOT_TUNE.reloadSafeDist));

    if (doctrine.hasHeat) {
      // Duty cycle instead of a hard overheat: cut at 0.80, resume at 0.30. The
      // 1.8s total lockout is strictly worse than any pause we take voluntarily.
      const cut = self.overclock ? BOT_TUNE.heatCutOverclock : BOT_TUNE.heatCut;
      const heat = self.heat ?? 0;
      if (this._beamOn && heat >= cut) this._beamOn = false;
      else if (!this._beamOn && heat <= BOT_TUNE.heatResume) this._beamOn = true;
      if (self.overheated) this._beamOn = false;
    }
    d.beamOn = this._beamOn;

    // Janitor block. A bot that holds the lid permanently deals zero damage and
    // reports a false wave-clear time, so this is deliberately narrow and the
    // orchestrator is expected to drop it to swing.
    d.wantBlock = !!doctrine.canBlock && (
      (c.frontal >= 2 && c.nearDist < 2.5)
      || (c.hpFrac < 0.45 && c.frontal >= 1)
      || this._closerIncoming(snap)
    );

    // Haymaker discipline: every 3rd punch is 2.6x with a stun. Holding it for a
    // worthwhile arc is the difference between playing the class and mashing it —
    // but only briefly, or the bot's DPS reads as broken instead of deliberate.
    d.holdHaymaker = false;
    if (this.classKey === 'brawler' && self.punchCount !== undefined) {
      const nextIsHaymaker = (self.punchCount % 3) === 2;
      if (nextIsHaymaker && c.count6 < 2 && (!t || t.dist > 3.6)) {
        this._haymakerHold += dt;
        d.holdHaymaker = this._haymakerHold < 0.5;
      } else this._haymakerHold = 0;
    }

    const ab = this._ability;
    d.useSecondary = this.action === ACTIONS.USE_ABILITY
      || (!!ab && ab.score >= 0.6 && self.secondaryReady && !self.shocked
        && (this.action === ACTIONS.ENGAGE || this.action === ACTIONS.REPOSITION));
    d.secondaryReason = d.useSecondary && ab ? ab.reason : '';
    d.secondaryAim = null;
    if (d.useSecondary && ab) {
      if (ab.aim === 'cluster') d.secondaryAim = this._abilityAim;
      else if (ab.aim === 'self') { this._abilityAim.x = self.pos.x; this._abilityAim.y = self.pos.y; this._abilityAim.z = self.pos.z; d.secondaryAim = this._abilityAim; }
      else if (ab.aim === 'target' && t) d.secondaryAim = t.aimPos ?? t.pos;
    }
  }

  /**
   * Karen veto on the firing line. Homing slips re-target every frame, cards
   * pierce four bodies and crits explode — so refusing to *aim* at her is not
   * enough, the line has to be clean too.
   */
  _karenInLine(snap, t) {
    const k = this._ctx.karen;
    if (!k) return false;
    const s = snap.self.pos;
    // 2.2m of clearance: her radius is 0.5 and every splash effect in the game is
    // wider than the gap you would leave by eye.
    return segPointDist2D(s.x, s.z, t.pos.x, t.pos.z, k.pos.x, k.pos.z) < 2.2;
  }

  /** A Junior Closer mid-windup, aimed roughly at us. Its 0.55s is the block cue. */
  _closerIncoming(snap) {
    const threats = snap.threats;
    if (!threats) return false;
    for (let i = 0; i < threats.length; i++) {
      const t = threats[i];
      if (t && t.key === 'closer' && t.windup > 0 && t.dist < 15) return true;
    }
    return false;
  }

  // ---- movement goal helpers (all write into `out`, never allocate) --------

  /** Stand at `range` from `at`, offset sideways so the bot is not a statue. */
  _orbit(out, from, at, range) {
    let dx = from.x - at.x, dz = from.z - at.z;
    let l = Math.hypot(dx, dz);
    if (l < 1e-4) { dx = 1; dz = 0; l = 1; }
    dx /= l; dz /= l;
    const tx = -dz * this._strafeSign, tz = dx * this._strafeSign;
    // Strafe amplitude scales with range: an accountant at 16m can slide 3m
    // sideways and stay on target, a janitor at 2m cannot without leaving reach.
    const strafe = Math.min(3, range * 0.35);
    out.x = at.x + dx * range + tx * strafe;
    out.z = at.z + dz * range + tz * strafe;
  }

  _away(out, from, at, range) {
    let dx = from.x - at.x, dz = from.z - at.z;
    let l = Math.hypot(dx, dz);
    if (l < 1e-4) { dx = 1; dz = 0; l = 1; }
    dx /= l; dz /= l;
    out.x = at.x + dx * range;
    out.z = at.z + dz * range;
  }

  /** Shove a goal point out to at least `range` from `at`, keeping its bearing. */
  _pushOff(out, at, range) {
    let dx = out.x - at.x, dz = out.z - at.z;
    let l = Math.hypot(dx, dz);
    if (l >= range) return;
    if (l < 1e-4) { dx = 1; dz = 0; l = 1; }
    out.x = at.x + (dx / l) * range;
    out.z = at.z + (dz / l) * range;
  }

  _toward(out, from, at, stopAt) {
    let dx = from.x - at.x, dz = from.z - at.z;
    const l = Math.hypot(dx, dz);
    if (l <= stopAt || l < 1e-4) { out.x = from.x; out.z = from.z; return; }
    dx /= l; dz /= l;
    out.x = at.x + dx * stopAt;
    out.z = at.z + dz * stopAt;
  }

  // -------------------------------------------------------------------------
  // debug
  // -------------------------------------------------------------------------

  /**
   * Human-readable dump for the debug panel. Allocates — this is the inspection
   * path, not the hot path. An AI you cannot see the scores of is an AI you
   * cannot tune, and every "why did it do that?" costs a playtest session.
   */
  explain() {
    const c = this._ctx;
    const rows = [];
    for (let i = 0; i < this._candN; i++) {
      const s = this._cand[i];
      rows.push({ action: s.action, score: +s.score.toFixed(3), reason: s.reason, urgent: s.urgent });
    }
    rows.sort((a, b) => b.score - a.score);
    const d = this.decision;
    return {
      cls: this.classKey,
      action: this.action,
      reason: this.reason,
      score: +this.actionScore.toFixed(3),
      dwell: +(DWELL[this.action] ?? 0.4).toFixed(2),
      target: c.target ? `${c.target.key}#${c.target.id}` : '—',
      targetScore: +c.targetScore.toFixed(1),
      fire: d.fire ? 'YES' : d.fireReason,
      aimErr: +d.aimErrorDeg.toFixed(2),
      hp: +c.hpFrac.toFixed(2),
      ammo: +c.ammoFrac.toFixed(2),
      leaderDist: +c.leaderDist.toFixed(1),
      near: +(c.nearDist === Infinity ? -1 : c.nearDist).toFixed(1),
      crowd6: c.count6,
      crowd12: c.count12,
      spacing: c.spacing,
      secondary: d.useSecondary ? d.secondaryReason : '—',
      block: d.wantBlock,
      beam: d.beamOn,
      candidates: rows,
    };
  }
}

export default BotBrain;
