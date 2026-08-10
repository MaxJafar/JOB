// ============ bot squad positioning ============
// Where a teammate bot should BE. Nothing about what it shoots — that is
// tactics.js — and nothing about how it gets there physically — that is
// PlayerMotor. This module is a pure decision layer: it reads the world and
// returns a MOVE INTENT (a world goal, a steering direction for this tick, and
// sprint/dash/jump flags). It never writes a position, never damages anything,
// never mutates game state. The orchestrator feeds the intent into
// motor.setIntent() so bots move with byte-identical physics to the human.
//
// The four failure modes this file exists to prevent, in order of how badly
// they poison a playtest:
//
//  1. THE CONGA LINE. Three bots seeking `leader.pos` all converge on one tile,
//     body-block each other in a doorway, and the party reads as one fat blob.
//     Fixed by distinct formation SLOTS (angle + distance around a smoothed
//     leader heading) plus a separation force.
//
//  2. THE LOD BLACK HOLE. src/ai/lod.js tiers every enemy off `game.player`
//     ONLY: an enemy chasing a bot past 22 m thinks at 20 Hz, past 45 m at 5 Hz.
//     A bot that wanders off and pulls half the wave with it turns that wave
//     into slow motion — the exact inverse of the co-op signal we want. Every
//     goal this module produces is therefore leashed inside LEASH_SOFT of the
//     human, and the bot abandons combat to regroup past REGROUP_DIST.
//
//  3. THE DESK CORNER. Direct seek grinds a bot into furniture forever. We use
//     the same rule the enemies use (direct steer when the line is clear,
//     PathAgent when it is blocked, LOS re-tested on a 0.2 s stagger) PLUS a
//     stuck detector that escalates repath -> sidestep -> hop -> ask the
//     orchestrator for a rescue.
//
//  4. THE BOT THAT PLAYS THE GAME FOR YOU. Bots must not finish the elevator
//     hold while the human is off looting, and must not walk through a paid
//     door the team has not bought. Both are explicit gates below.
//
// ALLOCATION: all THREE temporaries are module-scope. The returned intent is a
// single per-instance object, reused every tick — the orchestrator must consume
// it in the same frame, never store it.
//
// TIMING: everything here runs off `dt`. `game.net.now` is permanently 0 solo
// (NetSession.update early-returns before incrementing), so the `now` argument
// threaded through RemotePlayer.update is not a usable clock for bots.

import * as THREE from 'three';
import { PathAgent } from '../../core/navmesh.js';
import { damp } from '../../core/spring.js';
import { TUNE } from '../config.js';

// ---- module-scope scratch. Never returned to callers, never held across a
// ---- yield point; this whole module is synchronous.
const _navGoal = new THREE.Vector3();
const _goal = { x: 0, z: 0 };
const _sep = { x: 0, z: 0 };

export const SQUAD_TUNE = {
  // --- leash. Tied to the LOD tier boundaries in src/ai/lod.js: 22 m is where
  // --- an enemy drops from 60 Hz to 20 Hz thinking. Keeping bots inside 15 m
  // --- means the aggro they pull stays in the hot tier and behaves like real
  // --- co-op instead of like a slideshow.
  leashSoft: 15,        // engagement goals are clamped inside this of the leader
  regroupDist: 17,      // past this the bot drops combat positioning and closes
  sprintDist: 22,       // past this it sprints home
  rescueDist: 46,       // hopelessly separated — ask the orchestrator for help

  // --- personal space. Sized off the AoE radii a stacked party would all eat
  // --- together: roomba blast 3.4, synergy death nova 3.6, auditor slam 4.2.
  spacing: 3.6,
  spacingWide: 6.2,     // while a gossip (6.5 m goo) or field tech (6 m chain) lives
  spacingWeight: 0.85,  // capped below 1 so separation can never fully cancel
  // seek — two bots in a doorway must still make progress, not orbit forever

  // --- formation
  slotTolerance: 1.5,   // inside this of the slot the bot stops; stops the jitter
  slotRepathDrift: 2.5,

  // --- engagement
  bandPad: 0.9,         // hysteresis: don't re-cross the band edge every frame
  strafeAmp: 1.7,       // lateral wander so a holding bot is not a statue
  strafeAmpMelee: 0.8,
  strafeRate: 0.55,     // rad/s

  // --- stuck detector
  stuckSample: 0.3,     // s between progress samples
  stuckMinMove: 0.28,   // m expected per sample when actually trying to move
  stuckRepath: 0.6,     // s of no progress -> force a repath
  stuckDetour: 1.4,     // s -> commit to a perpendicular sidestep
  stuckRescue: 4.5,     // s -> raise requestUnstick
  detourHold: 0.8,      // s to commit to a sidestep before re-evaluating
  detourAngle: 1.22,    // ~70 deg

  // --- objectives
  assistHold: 1.6,      // stand this far from a downed ally, not on top of them
  boardRing: 1.25,      // bots fan out this far around the elevator tile
  elevatorFollowGate: 14, // leader must be this close before bots commit to boarding

  // --- reaction. Bots must not frame-perfectly escape a tether/latch.
  escapeReactMin: 0.16,
  escapeReactMax: 0.34,
  dashReserveRange: 12, // hold the dash for escapes while anything is this close
};

/**
 * Formation slots, as an angle relative to the leader's smoothed heading
 * (0 = directly ahead of them) and a distance.
 *
 * Nothing sits in the forward cone. Director.pickSpawnPos() anchors every spawn
 * to `game.player` on a 13-27 m ring, and Enemy.pickTarget() is nearest-wins and
 * STICKY FOR LIFE (it only re-runs when the current target dies). A bot standing
 * between the human and the spawn ring therefore acquires the whole wave first
 * and owns it permanently — the human never gets shot at.
 *
 * Flanks are the honest compromise: partial aggro share, no spawn-ring theft.
 */
export const FORMATION_SLOTS = [
  { ang: -1.75, dist: 4.4 },  // right flank, slightly rear
  { ang: 1.75, dist: 4.4 },   // left flank
  { ang: Math.PI, dist: 5.2 },// rear guard
  { ang: -2.45, dist: 5.4 },  // right rear
  { ang: 2.45, dist: 5.4 },   // left rear
];
export const SLOT_COUNT = FORMATION_SLOTS.length;

/** Engagement bands used when tactics.js does not supply one. */
export const DEFAULT_BANDS = {
  melee: { min: 0, max: 2.4, melee: true },
  mid: { min: 3.5, max: 8, melee: false },
  ranged: { min: 8, max: 16, melee: false },
};

/**
 * Convert a world-space direction into the motor's camera-relative move axes.
 *
 * PlayerMotor builds its wish vector as `fwd * moveZ + right * moveX` where
 * fwd = (sin yaw, cos yaw) and right = (sin(yaw - PI/2), cos(yaw - PI/2)). This
 * is the exact inverse, so the orchestrator can hand the motor a move intent
 * that actually points where this module decided, whatever the bot is aiming at.
 *
 * @param {number} dirX world X of the desired move direction (need not be unit)
 * @param {number} dirZ world Z
 * @param {number} yaw the yaw the bot will report to the motor this tick
 * @param {{moveX:number, moveZ:number}} out mutated in place
 */
export function worldDirToMoveIntent(dirX, dirZ, yaw, out) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  out.moveX = -dirX * c + dirZ * s;
  out.moveZ = dirX * s + dirZ * c;
  return out;
}

/** Give every bot in a party a distinct slot. Stable across floors. */
export function assignSlots(bots) {
  let i = 0;
  for (const b of bots) {
    if (b?.squad?.setSlot) b.squad.setSlot(i);
    i++;
  }
}

/**
 * Per-bot positioning brain. One instance per bot, owned by BotPlayer.
 *
 * Usage:
 *   this.squad = new SquadPositioner(game, this, { slot: i, doctrine: 'ranged' });
 *   const mv = this.squad.update(dt, { leader: game.player, band, threat, ... });
 *   worldDirToMoveIntent(mv.moveDir.x, mv.moveDir.z, this.yaw, motorIntent);
 */
export class SquadPositioner {
  /**
   * @param {object} game
   * @param {object} bot the BotPlayer — needs pos, radius, dead, and optionally
   *                     tether/latch/dashCd for escape decisions
   * @param {{slot?: number, doctrine?: 'melee'|'mid'|'ranged'}} opts
   */
  constructor(game, bot, { slot = 0, doctrine = 'ranged' } = {}) {
    this.game = game;
    this.bot = bot;
    this.doctrine = doctrine;
    this.setSlot(slot);

    // Pathing. Rebuilt lazily whenever game.nav changes identity — buildFloor
    // publishes a NEW NavMesh and teardownRun disposes the old one, so a cached
    // PathAgent would be steering against freed wasm within one floor change.
    this._navRef = null;
    this._agent = null;

    // LOS is re-tested on a stagger, exactly like Enemy.moveToward, so a party
    // of bots does not add four BVH segment queries per frame on top of the horde.
    this._losT = Math.random() * 0.2;
    this._losBlocked = false;

    // Formation basis. See _basisHeading() for why this is damped.
    this._basis = 0;
    this._basisInit = false;

    // Strafe oscillator — a bot holding its engagement band should drift, not
    // stand at attention. Phase is offset per slot so the party does not sway
    // in unison like a chorus line.
    this._strafePhase = slot * 1.9;
    this._strafeSide = slot % 2 === 0 ? 1 : -1;
    this._strafeFlipT = 2 + Math.random() * 2.5;

    // Stuck detector state.
    this._sampleT = SQUAD_TUNE.stuckSample;
    this._lastX = 0;
    this._lastZ = 0;
    this._stuckT = 0;
    this._detourT = 0;
    this._detourSide = 1;
    this._hopT = 0;

    // Escape reaction timer. Non-zero means "I have noticed the tether but a
    // human would not have reacted yet".
    this._escapeT = 0;
    this._wasPinned = false;

    // The single reused intent object. Documented as frame-lifetime.
    this.intent = {
      target: new THREE.Vector3(),
      moveDir: { x: 0, z: 0 },
      move: false,
      sprint: false,
      dash: false,
      jump: false,
      speedScale: 1,
      faceYaw: 0,
      stance: 'follow',
      reason: 'init',
      stuck: false,
      requestUnstick: false,
      holdsObjective: false,
      assist: null,
      distToLeader: 0,
      distToGoal: 0,
    };
  }

  setSlot(i) {
    this.slot = ((i | 0) % SLOT_COUNT + SLOT_COUNT) % SLOT_COUNT;
    return this.slot;
  }

  setDoctrine(d) { this.doctrine = d; }

  /**
   * Drop every cached reference into the old floor. MUST be called from the
   * bot's buildFloor hook: game.nav and game.bvh are disposed and replaced, and
   * the bot is teleported, so a stale path and a stale progress sample would
   * both read as "instantly stuck, 40 m from my goal".
   */
  onFloorRebuilt() {
    this._navRef = null;
    this._agent = null;
    this._losBlocked = false;
    this._losT = Math.random() * 0.2;
    this._stuckT = 0;
    this._detourT = 0;
    this._sampleT = SQUAD_TUNE.stuckSample;
    this._basisInit = false;
    const p = this.bot?.pos;
    this._lastX = p?.x ?? 0;
    this._lastZ = p?.z ?? 0;
  }

  dispose() {
    this._agent = null;
    this._navRef = null;
    this.game = null;
    this.bot = null;
  }

  // ------------------------------------------------------------------- tick

  /**
   * @param {number} dt
   * @param {{
   *   leader?: object,            // game.player
   *   band?: {min:number,max:number,melee?:boolean},  // from tactics.js
   *   threat?: object,            // the enemy tactics.js is engaging
   *   downedAlly?: object,        // teammate to move to and hold on
   *   teammates?: Array<object>,  // pre-built list; avoids livePlayers() alloc
   *   spacing?: number,           // tactics can widen it (gossip / field tech alive)
   *   yaw?: number,               // the bot's current yaw, for honest sprint gating
   *   canAct?: boolean,           // false while stunned/shocked
   *   holdGround?: boolean,       // tactics pinning the bot (channelling a beam)
   *   dash?: boolean,             // tactics demanding a dash (dodge a telegraph)
   * }} input
   * @returns {typeof this.intent} reused — consume it this frame
   */
  update(dt, input) {
    const I = this.intent;
    const bot = this.bot;
    const game = this.game;
    I.requestUnstick = false;
    I.holdsObjective = false;
    I.assist = null;
    I.jump = false;
    I.dash = false;
    I.sprint = false;

    // Hard bail-outs. A bot with no world, no body, or a finished run must
    // produce a zero intent rather than throw — a crashed run is worth less
    // than a bot standing still.
    if (!game || !bot || bot.dead || game.runOver || !game.level) {
      return this._still(I, 'inactive');
    }
    const inp = input ?? {};
    const leader = inp.leader && !inp.leader.dead ? inp.leader : null;

    // Stunned / shocked / latched-and-mashing: no movement authority. Reset the
    // stuck detector or the bot will "escalate" its way out of a stun by
    // requesting a teleport.
    if (inp.canAct === false) {
      this._stuckT = 0;
      this._detourT = 0;
      this._sampleT = SQUAD_TUNE.stuckSample;
      this._lastX = bot.pos.x;
      this._lastZ = bot.pos.z;
      return this._still(I, 'cannot-act');
    }

    this._advanceTimers(dt);
    this._syncAgent();

    const dLeader = leader ? Math.hypot(bot.pos.x - leader.pos.x, bot.pos.z - leader.pos.z) : 0;
    I.distToLeader = dLeader;

    // ---- 1. choose a world goal, highest priority first ----
    this._chooseGoal(dt, inp, leader, dLeader, I);

    // ---- 2. refuse goals behind an unbought paid door ----
    if (!this._goalAllowed(_goal.x, _goal.z, leader)) {
      // Falling back to the leader keeps the party together instead of stranding
      // the bot at the doorframe repeatedly trying to walk into a locked room.
      if (leader) { _goal.x = leader.pos.x; _goal.z = leader.pos.z; I.reason = 'door-locked'; }
      else return this._still(I, 'door-locked-no-leader');
    }
    I.target.set(_goal.x, bot.pos.y, _goal.z);

    // ---- 3. steer: direct, navmesh, or detour ----
    const dGoal = Math.hypot(_goal.x - bot.pos.x, _goal.z - bot.pos.z);
    I.distToGoal = dGoal;
    const arrive = I.stance === 'follow' ? SQUAD_TUNE.slotTolerance : 0.55;
    // PROPORTIONAL seek, not bang-bang. A hard `dGoal > arrive` gate emits a
    // UNIT-magnitude direction above the threshold and EXACTLY ZERO below it,
    // while separation is continuous and is still non-zero AT the goal whenever
    // the slot ring sits inside another body's personal space. The two can never
    // balance: separation shoves the bot out, seek snaps to full strength, it
    // overshoots back in, seek vanishes — a permanent limit cycle that reads as
    // a teammate vibrating in place. Tapering seek across the ring gives the
    // forces a fixed point to settle at.
    const seekW = inp.holdGround
      ? 0
      : Math.min(1, dGoal / Math.max(0.35, arrive * 1.5));
    const wantsMove = seekW > 0.02;

    let dirX = 0, dirZ = 0;
    if (wantsMove) {
      dirX = (_goal.x - bot.pos.x) / dGoal;
      dirZ = (_goal.z - bot.pos.z) / dGoal;
      const steered = this._navSteer(dt, dGoal, _goal.x, _goal.z);
      if (steered) { dirX = steered.x; dirZ = steered.z; }
      if (this._detourT > 0) {
        // A committed sidestep. Rotating the seek direction (rather than
        // replacing it) means the bot still trends toward the goal while it
        // slides along whatever it was grinding into.
        const a = SQUAD_TUNE.detourAngle * this._detourSide;
        const s = Math.sin(a), c = Math.cos(a);
        const rx = dirX * c - dirZ * s;
        const rz = dirX * s + dirZ * c;
        dirX = rx; dirZ = rz;
      }
    }

    // Apply the taper AFTER steering — _navSteer returns a unit vector and would
    // otherwise throw the proportional weight away, restoring the limit cycle.
    dirX *= seekW;
    dirZ *= seekW;

    // ---- 4. separation from the human and every other teammate ----
    const sep = this._separation(inp, leader);
    if (sep.x !== 0 || sep.z !== 0) {
      const w = SQUAD_TUNE.spacingWeight;
      dirX += sep.x * w;
      dirZ += sep.z * w;
    }

    const dl = Math.hypot(dirX, dirZ);
    if (dl > 1e-4) {
      I.moveDir.x = dirX / dl;
      I.moveDir.z = dirZ / dl;
      I.move = true;
      I.faceYaw = Math.atan2(I.moveDir.x, I.moveDir.z);
    } else {
      I.moveDir.x = 0; I.moveDir.z = 0;
      I.move = false;
    }

    // Ease off near the goal so the bot settles instead of oscillating across
    // its slot. Pure-separation shuffles are deliberately slow — a teammate
    // sidling out of your way at a sprint looks broken.
    I.speedScale = inp.holdGround ? 0
      : wantsMove ? Math.min(1, 0.35 + dGoal / 2.5)
        : (I.move ? 0.4 : 0);

    // ---- 5. flags ----
    this._resolveStuck(dt, wantsMove, I);
    I.sprint = this._wantSprint(inp, I, dGoal, dLeader);
    I.dash = this._wantDash(inp, I, dLeader);
    if (this._hopT > 0 && this._hopT < 0.08) I.jump = true;

    return I;
  }

  // -------------------------------------------------------------- goal choice

  _chooseGoal(dt, inp, leader, dLeader, I) {
    const game = this.game;
    const bot = this.bot;
    const level = game.level;

    // (a) DOWNED ALLY — highest priority short of being dead ourselves. The
    // actual revive is the orchestrator's to wire; we only guarantee the bot is
    // standing there when it wants to.
    const ally = inp.downedAlly;
    if (ally?.pos && ally !== bot) {
      const d = Math.hypot(bot.pos.x - ally.pos.x, bot.pos.z - ally.pos.z);
      if (d < SQUAD_TUNE.rescueDist) {
        this._ringGoal(ally.pos, SQUAD_TUNE.assistHold, _goal);
        I.stance = 'assist';
        I.reason = 'downed-ally';
        I.assist = ally;
        return;
      }
    }

    if (!leader) {
      // No human to anchor to (dead, or mid-teardown). Hold — wandering with no
      // leash reference is how a bot ends up 60 m away in a sealed room.
      _goal.x = bot.pos.x; _goal.z = bot.pos.z;
      I.stance = 'hold';
      I.reason = 'no-leader';
      return;
    }

    // (b) LOCKDOWN — outranks the leash, because the leash cannot see a seal.
    // A bot inside the sealed arena whose leader is outside it would otherwise
    // spend the whole wave grinding into a barrier while the stuck detector
    // escalated; and a bot caught OUTSIDE contributes nothing and drags Director
    // teamSpread (pressure.js) to a value no real party produces.
    const arena = level.arenaRoom;
    if (game.lockdown && arena && level.roomAt) {
      const here = level.roomAt(bot.pos.x, bot.pos.z);
      const leaderIn = level.roomAt(leader.pos.x, leader.pos.z) === arena;
      if (here !== arena) {
        _goal.x = leaderIn ? leader.pos.x : arena.cx;
        _goal.z = leaderIn ? leader.pos.z : arena.cz;
        this._clampToRoom(arena, 1.8, _goal);
        I.stance = 'objective';
        I.reason = 'enter-arena';
        return;
      }
      if (!leaderIn) {
        _goal.x = bot.pos.x;
        _goal.z = bot.pos.z;
        this._clampToRoom(arena, 1.8, _goal);
        I.stance = 'objective';
        I.reason = 'hold-arena';
        return;
      }
    }

    // (c) REGROUP — overrides everything tactical. Past this range the bot's
    // aggro is falling out of the enemy LOD hot tier and the party has visually
    // split, both of which corrupt the playtest signal.
    if (dLeader > SQUAD_TUNE.regroupDist) {
      _goal.x = leader.pos.x;
      _goal.z = leader.pos.z;
      I.stance = 'regroup';
      I.reason = 'leash';
      return;
    }

    const el = level.elevator;

    // (d) BOARDING — only once the human has actually committed to leaving.
    // Bots that beeline for the elevator the moment it opens strand the human
    // alone in a room he is still looting, which is both bad co-op and a
    // Director teamSpread lie.
    if (el?.pos && game.eventState === 'open') {
      const leaderToEl = Math.hypot(leader.pos.x - el.pos.x, leader.pos.z - el.pos.z);
      if (leaderToEl < SQUAD_TUNE.elevatorFollowGate) {
        this._ringGoal(el.pos, SQUAD_TUNE.boardRing, _goal);
        I.stance = 'objective';
        I.reason = 'board';
        return;
      }
    }

    // (e) HOLDING THE CORE — updateElevatorEvent accepts ANY livePlayers()
    // member inside eventZoneRadius, so a parked bot can finish the call while
    // the human is elsewhere. That would delete the whole point of the event.
    // Bots therefore only count as holders when the human is holding too: we
    // clamp the normal formation goal into the zone rather than seeking it.
    let anchorX = leader.pos.x, anchorZ = leader.pos.z;
    let insideZone = false;
    if (el?.pos && game.eventState === 'charging') {
      const R = TUNE.eventZoneRadius;
      const leaderInZone = Math.hypot(leader.pos.x - el.pos.x, leader.pos.z - el.pos.z) < R;
      if (leaderInZone) {
        insideZone = true;
        // pull the anchor toward the zone centre so the slot ring lands inside
        const ax = anchorX - el.pos.x, az = anchorZ - el.pos.z;
        const ad = Math.hypot(ax, az);
        const cap = Math.max(0, R * 0.62);
        if (ad > cap && ad > 1e-4) {
          anchorX = el.pos.x + (ax / ad) * cap;
          anchorZ = el.pos.z + (az / ad) * cap;
        }
      }
    }

    // (f) COMBAT BAND — kite or close, per tactics.js's doctrine.
    const threat = inp.threat;
    if (threat?.pos && !threat.dead) {
      this._engageGoal(threat, inp.band, leader, _goal);
      I.stance = 'engage';
      I.reason = 'band';
      I.holdsObjective = insideZone;
      return;
    }

    // (g) FOLLOW — the default. Formation slot around a smoothed leader heading.
    this._slotGoal(dt, leader, anchorX, anchorZ, _goal);
    I.stance = 'follow';
    I.reason = insideZone ? 'hold-core' : 'formation';
    I.holdsObjective = insideZone;
  }

  /**
   * The formation slot, in world space.
   *
   * The basis heading is NOT the leader's raw yaw. In an FPS the human's yaw
   * whips 180 degrees every time he checks his back, and slots pinned to raw yaw
   * would send three bots sprinting in circles around him — the classic dizzy
   * escort AI. We prefer his velocity heading while he is actually moving (which
   * is what "the direction the team is going" means) and fall back to a heavily
   * damped view yaw when he is standing still.
   */
  _slotGoal(dt, leader, anchorX, anchorZ, out) {
    const h = this._basisHeading(dt, leader);
    const s = FORMATION_SLOTS[this.slot];
    const ang = h + this._slotAngle(s.ang);
    const dist = this._slotDist(s.dist);
    out.x = anchorX + Math.sin(ang) * dist;
    out.z = anchorZ + Math.cos(ang) * dist;
  }

  _slotAngle(base) {
    // Melee doctrines sit further forward on the flank so they can actually get
    // between the human and a closing wave; ranged stays wide and rear.
    if (this.doctrine === 'melee') return base * 0.62;
    return base;
  }

  _slotDist(base) {
    if (this.doctrine === 'melee') return base * 0.82;
    if (this.doctrine === 'ranged') return base * 1.1;
    return base;
  }

  _basisHeading(dt, leader) {
    let want;
    const v = leader.vel ?? leader.motor?.vel ?? null;
    const sp = v ? Math.hypot(v.x, v.z) : 0;
    if (sp > 1.5) want = Math.atan2(v.x, v.z);
    else want = leader.yaw ?? this._basis;

    if (!this._basisInit) { this._basis = want; this._basisInit = true; return want; }
    // Unwrap first, then damp — damping the raw angle would take the long way
    // around every time the leader crosses +/-PI.
    let d = (want - this._basis) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    this._basis = damp(this._basis, this._basis + d, 2.4, dt);
    return this._basis;
  }

  /**
   * Kite or close to the engagement band tactics.js handed us.
   *
   * Two things make this read human rather than mechanical: the band edges have
   * hysteresis (a bot that re-crosses `min` every frame twitches in place), and
   * the hold position carries a slow lateral drift instead of being a fixed
   * point in space.
   */
  _engageGoal(threat, band, leader, out) {
    const bot = this.bot;
    const B = band ?? DEFAULT_BANDS[this.doctrine] ?? DEFAULT_BANDS.ranged;
    const min = Math.max(0, B.min ?? 0);
    const max = Math.max(min + 0.5, B.max ?? min + 6);
    const melee = B.melee ?? this.doctrine === 'melee';

    let dx = bot.pos.x - threat.pos.x;
    let dz = bot.pos.z - threat.pos.z;
    let d = Math.hypot(dx, dz);
    if (d < 1e-4) { dx = 1; dz = 0; d = 1e-4; }
    dx /= d; dz /= d;

    const pad = Math.min(SQUAD_TUNE.bandPad, (max - min) * 0.25);
    let want = d;
    if (d < min) want = min + pad;          // melee closed on us — back off
    else if (d > max) want = max - pad;     // drifted out of range — close in

    // Lateral drift. Perpendicular to the threat axis, oscillating, with the
    // side flipping every few seconds so the bot does not orbit predictably.
    const amp = melee ? SQUAD_TUNE.strafeAmpMelee : SQUAD_TUNE.strafeAmp;
    const lat = Math.sin(this._strafePhase) * amp * this._strafeSide;

    out.x = threat.pos.x + dx * want + -dz * lat;
    out.z = threat.pos.z + dz * want + dx * lat;

    // Leash the engagement goal. Without this a ranged bot happily backpedals
    // 25 m from the human to hold its band, dragging its aggro into the 20 Hz
    // LOD tier and splitting the party for the Director's pressure model.
    if (leader) {
      const lx = out.x - leader.pos.x, lz = out.z - leader.pos.z;
      const ld = Math.hypot(lx, lz);
      if (ld > SQUAD_TUNE.leashSoft && ld > 1e-4) {
        const k = SQUAD_TUNE.leashSoft / ld;
        out.x = leader.pos.x + lx * k;
        out.z = leader.pos.z + lz * k;
      }
    }
  }

  /** A point on a small ring around `centre`, offset by slot so bots fan out. */
  _ringGoal(centre, r, out) {
    const a = (this.slot / SLOT_COUNT) * Math.PI * 2;
    out.x = centre.x + Math.sin(a) * r;
    out.z = centre.z + Math.cos(a) * r;
  }

  _clampToRoom(room, margin, out) {
    const x0 = Math.min(room.x0 + margin, room.cx);
    const x1 = Math.max(room.x1 - margin, room.cx);
    const z0 = Math.min(room.z0 + margin, room.cz);
    const z1 = Math.max(room.z1 - margin, room.cz);
    out.x = Math.min(x1, Math.max(x0, out.x));
    out.z = Math.min(z1, Math.max(z0, out.z));
  }

  /**
   * Paid doors. `level.isRoomOpen` is the single source of truth the interact
   * code uses, so we defer to it rather than re-deriving door state.
   *
   * The leader exception matters: if the human somehow ends up inside a locked
   * room (host migration, a door re-closing, a level edge case), abandoning him
   * is worse than clipping the rule. Following is the sane degradation.
   */
  _goalAllowed(x, z, leader) {
    const level = this.game?.level;
    if (!level?.roomAt) return true;
    const r = level.roomAt(x, z);
    if (!r || !r.paidCost) return true;
    if (level.isRoomOpen?.(r)) return true;
    if (leader && level.roomAt(leader.pos.x, leader.pos.z) === r) return true;
    return false;
  }

  // ----------------------------------------------------------------- steering

  /** Rebuild the PathAgent whenever the floor's navmesh is swapped underneath us. */
  _syncAgent() {
    const nav = this.game.nav ?? null;
    if (nav === this._navRef) return;
    this._navRef = nav;
    // No navmesh (recast failed to load, or mid-rebuild) is a supported state:
    // steer() would return null anyway and we fall through to direct seek.
    this._agent = nav
      ? new PathAgent(nav, { repathInterval: 0.5, arriveDist: 0.9, targetDrift: SQUAD_TUNE.slotRepathDrift })
      : null;
  }

  /**
   * Same rule the enemies use in Enemy.moveToward: pay for pathing only when a
   * detour could change the answer — far enough that it matters, and a wall
   * actually in the way. LOS on a 0.2 s stagger keeps four bots from adding
   * four BVH segment queries per frame on top of a 40-mob horde.
   * @returns {THREE.Vector3|null} unit steer direction, or null for direct seek
   */
  _navSteer(dt, dGoal, gx, gz) {
    if (dGoal <= 2) return null;
    this._losT -= dt;
    if (this._losT <= 0) {
      this._losT = 0.2;
      const level = this.game.level;
      this._losBlocked = level?.losBlocked ? level.losBlocked(this.bot.pos.x, this.bot.pos.z, gx, gz) : false;
    }
    if (!this._losBlocked || !this._agent) return null;
    _navGoal.set(gx, 0, gz);
    return this._agent.steer(this.bot.pos, _navGoal, dt, true);
  }

  /**
   * Separation from the human and every other teammate.
   *
   * Standing inside a teammate is the single most annoying thing a co-op bot can
   * do, and a stacked party makes every AoE in the game hit all four at once —
   * which would also flatten Director teamSpread to a number no real party
   * produces. The push is a soft (1 - d/r) falloff so bots ease apart instead of
   * popping.
   */
  _separation(inp, leader) {
    _sep.x = 0; _sep.z = 0;
    const bot = this.bot;
    const r = inp.spacing ?? SQUAD_TUNE.spacing;
    const r2 = r * r;

    const push = (o) => {
      if (!o || o === bot || o.dead) return;
      const dx = bot.pos.x - o.pos.x, dz = bot.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r2 || d2 < 1e-6) return;
      const d = Math.sqrt(d2);
      const w = (1 - d / r) / d;
      _sep.x += dx * w;
      _sep.z += dz * w;
    };

    push(leader);
    // Prefer a caller-supplied list: game.livePlayers() allocates a fresh array
    // every call and this runs every frame per bot.
    const mates = inp.teammates;
    if (mates) {
      for (let i = 0; i < mates.length; i++) push(mates[i]);
    } else if (this.game.remotePlayers) {
      for (const mate of this.game.remotePlayers.values()) push(mate);
    }
    return _sep;
  }

  // ------------------------------------------------------------------- stuck

  /**
   * Progress-based stuck detection, escalating.
   *
   * Distance-to-goal is NOT a usable signal on its own — a bot pressed against a
   * desk while its goal orbits with the leader can show "progress" without
   * moving. We measure actual world displacement per sample instead, and only
   * count it against the bot when it genuinely asked to move.
   *
   * Escalation exists because each fix is cheap and the next one is uglier:
   *   0.6 s -> force a repath (the path is stale or crosses a smashed prop)
   *   1.4 s -> commit to a perpendicular sidestep and flip sides
   *   4.5 s -> give up and ask the orchestrator to rescue us
   */
  _resolveStuck(dt, wantsMove, I) {
    const bot = this.bot;
    this._sampleT -= dt;
    if (this._sampleT > 0) { I.stuck = this._stuckT >= SQUAD_TUNE.stuckRepath; return; }

    const moved = Math.hypot(bot.pos.x - this._lastX, bot.pos.z - this._lastZ);
    this._lastX = bot.pos.x;
    this._lastZ = bot.pos.z;
    const window = SQUAD_TUNE.stuckSample;
    this._sampleT += window;

    if (!wantsMove || moved >= SQUAD_TUNE.stuckMinMove) {
      this._stuckT = 0;
      this._detourT = 0;
      I.stuck = false;
      return;
    }

    this._stuckT += window;
    I.stuck = true;

    if (this._stuckT >= SQUAD_TUNE.stuckRescue) {
      // Only the orchestrator may move a body. We raise the flag and reset so we
      // do not spam a teleport request every frame.
      I.requestUnstick = true;
      this._stuckT = 0;
      this._detourT = 0;
      this._agent?.reset();
      return;
    }
    if (this._stuckT >= SQUAD_TUNE.stuckDetour) {
      if (this._detourT <= 0) {
        this._detourT = SQUAD_TUNE.detourHold;
        this._detourSide = -this._detourSide;   // the last side clearly failed
        this._hopT = 0.001;                     // one hop: clears low debris
      }
    } else if (this._stuckT >= SQUAD_TUNE.stuckRepath) {
      this._agent?.reset();
    }
  }

  // ------------------------------------------------------------------- flags

  _advanceTimers(dt) {
    this._strafePhase += SQUAD_TUNE.strafeRate * dt;
    if (this._strafePhase > Math.PI * 2) this._strafePhase -= Math.PI * 2;
    this._strafeFlipT -= dt;
    if (this._strafeFlipT <= 0) {
      this._strafeFlipT = 2 + Math.random() * 2.5;
      this._strafeSide = -this._strafeSide;
    }
    this._detourT = Math.max(0, this._detourT - dt);
    if (this._hopT > 0) this._hopT = this._hopT > 0.12 ? 0 : this._hopT + dt;

    // Escape reaction. A bot that dashes out of a Mediator tether on the exact
    // frame it lands is an aimbot with legs; a human takes ~0.2 s to notice.
    const pinned = !!(this.bot.tether || this.bot.bookedT > 0);
    if (pinned && !this._wasPinned) {
      this._escapeT = SQUAD_TUNE.escapeReactMin
        + Math.random() * (SQUAD_TUNE.escapeReactMax - SQUAD_TUNE.escapeReactMin);
    }
    if (!pinned) this._escapeT = 0;
    else this._escapeT = Math.max(0, this._escapeT - dt);
    this._wasPinned = pinned;
  }

  /**
   * Sprint is only real when the motor sees forward intent: it gates on
   * `moveZ > 0`, so a bot backpedalling out of a melee CANNOT sprint no matter
   * what we ask for. We therefore only claim sprint when the bot is actually
   * facing roughly where it is going — otherwise the flag is a lie that makes
   * the bot look like it should be outrunning something and never does.
   */
  _wantSprint(inp, I, dGoal, dLeader) {
    if (!I.move || inp.holdGround) return false;
    if (I.stance === 'engage' && dGoal < 8) return false;   // kiting, not commuting
    if (dGoal < 6 && dLeader < SQUAD_TUNE.regroupDist) return false;
    const yaw = inp.yaw;
    if (yaw === undefined || yaw === null) return dLeader > SQUAD_TUNE.sprintDist;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    return I.moveDir.x * fx + I.moveDir.z * fz > 0.72;
  }

  /**
   * Dash policy. The dash is the universal panic button — it clears stunT,
   * walks out of a Micromanager's meeting and cuts a Mediator tether — and it
   * has a 3.6 s cooldown. A bot that burns it as a movement key is both obviously
   * inhuman AND dashless the moment it actually needs it, so movement dashes are
   * only allowed when nothing dangerous is nearby.
   */
  _wantDash(inp, I, dLeader) {
    if (inp.dash) return true;                      // tactics is dodging a telegraph
    if ((this.bot.dashCd ?? 0) > 0) return false;   // motor would eat it anyway
    if (this.bot.shockT > 0) return false;          // shock disables the dash entirely

    // escape: pinned, and a plausible human reaction time has elapsed
    if ((this.bot.tether || this.bot.bookedT > 0) && this._escapeT <= 0) return true;

    // movement: closing a real gap, and only when the dash is not needed for
    // defence in the next few seconds
    if (I.stance !== 'regroup' || dLeader < SQUAD_TUNE.sprintDist) return false;
    if (!I.move) return false;
    const near = this.game.nearestEnemy?.(this.bot.pos, SQUAD_TUNE.dashReserveRange);
    if (near) return false;
    // Do not launch into a wall: 3.6 m of dash into furniture is a wasted
    // cooldown and reads as a broken bot.
    const bvh = this.game.bvh;
    if (bvh?.segmentBlocked) {
      const p = this.bot.pos;
      const ahead = 4;
      if (bvh.segmentBlocked(p.x, p.y + 1, p.z,
        p.x + I.moveDir.x * ahead, p.y + 1, p.z + I.moveDir.z * ahead)) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ helpers

  _still(I, reason) {
    I.moveDir.x = 0;
    I.moveDir.z = 0;
    I.move = false;
    I.sprint = false;
    I.dash = false;
    I.jump = false;
    I.speedScale = 0;
    I.stance = 'hold';
    I.reason = reason;
    I.stuck = false;
    if (this.bot?.pos) I.target.copy(this.bot.pos);
    return I;
  }
}
