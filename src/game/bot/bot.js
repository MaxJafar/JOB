// ============ BotPlayer — an AI teammate ============
// Registered into game.remotePlayers, which is the single insertion point that
// makes it a first-class teammate: livePlayers() reads that Map, and everything
// downstream already iterates livePlayers() — enemy target selection, the team
// HUD, explosion damage, the Director's team-spread signal. Nothing else in the
// game needed to change to know bots exist.
//
// A bot is deliberately built out of the REAL parts:
//   * PlayerMotor, so it accelerates, slides off walls and steps over desk lips
//     exactly as the human does — bot movement bugs are player movement bugs.
//   * The real class kits from classes.js, invoked as primary.fire(game, self,
//     aim). Playtesting beside a bot therefore playtests the actual weapon.
//   * game.combat queries, so a bot's line of sight is the same line of sight
//     an enemy uses. It cannot see or shoot through anything the player can't.
//
// What it is NOT: a second Player. It has no camera, no input, no HUD, no
// viewmodel, and it deliberately does not collect loot or XP — the run belongs
// to the human.

import * as THREE from 'three';
import { CLASS_BY_KEY } from '../classes.js';
import { Player } from '../player.js';
import { makePerson, makeHeldItem, animateWalk, poseIdle } from '../characters.js';
import { PlayerMotor } from '../../player/motor.js';
import { TUNE } from '../config.js';
import { clamp } from '../../core/utils.js';
// NOTE ON brain.js: it is authored and reviewed but deliberately NOT wired here.
// It and tactics.js both implement target scoring, fire decisions and the aim
// error model — my fault for briefing them with adjacent scopes. Running both
// would put two systems in a fight over the same decision every frame. tactics.js
// wins the combat role because it is written against the kits' actual numbers
// (the IT beam's 16m hard stop, the marketing cone's ±21° yaw-only aim, the heat
// duty cycle), and squad.js owns positioning. brain.js stays available for the
// higher-level action layer (revive / loot / objective) once the overlap is
// resolved — it is not dead code, it is unmerged.
import {
  createTacticsState, resetTactics, doctrineFor, pickThreat, decideCombat,
  refundAction, BOT_ACT,
} from './tactics.js';
import { SquadPositioner, worldDirToMoveIntent, DEFAULT_BANDS } from './squad.js';

const _v1 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _aimOrigin = new THREE.Vector3();
const _aimDir = new THREE.Vector3();

/** Bot ids are namespaced so they can never collide with a relay-assigned peer id. */
let _botSeq = 0;
export const nextBotId = () => `bot:${++_botSeq}`;

const BOT_NAMES = [
  'DAVE', 'SANDRA', 'KEVIN', 'PRIYA', 'GREG', 'MEI', 'TODD', 'ANJA',
  'BRENDA', 'MARCUS', 'YUKI', 'DEREK', 'NADIA', 'CHIP', 'ROSA',
];

export class BotPlayer {
  /**
   * @param {import('../game.js').Game} game
   * @param {{classKey?: string, name?: string, slot?: number, skill?: number}} opts
   */
  constructor(game, { classKey = 'intern', name = null, slot = 0, skill = 0.7 } = {}) {
    this.game = game;
    this.id = nextBotId();
    this.isBot = true;
    this.classKey = CLASS_BY_KEY[classKey] ? classKey : 'intern';
    this.classDef = CLASS_BY_KEY[this.classKey];
    this.name = name ?? BOT_NAMES[(slot + _botSeq) % BOT_NAMES.length];
    this.slot = slot;
    this.skill = clamp(skill, 0, 1);

    // ---- movement: the real motor ----
    this.radius = 0.45;
    this.motor = new PlayerMotor(game, { radius: this.radius, height: 1.8, stepHeight: 0.55 });
    this.pos = this.motor.pos;      // shared by reference, like Player does
    this.vel = this.motor.vel;
    this.yaw = Math.PI;
    this.pitch = 0;

    // ---- combat state the class kits read ----
    this.dead = false;
    this.level = 1;
    this.items = new Map();
    this.upgrades = new Map();      // bots take no drafts; the run is the human's
    this.recomputeStats();
    this.hp = this.stats.maxHp;
    this.maxHp = this.stats.maxHp;  // flat copy: hud.renderTeam reads maxHp, not stats.maxHp

    this.primaryCd = 0;
    this.secondaryCd = 0;
    this.iframes = 0;
    this.reloadT = 0;
    this.ammo = this.classDef.primary?.mag ?? Infinity;
    this.heatGauge = 0;
    this.overheatLock = 0;
    this.beamHeat = 0;
    this.beamSfxT = 0;              // beamTick decrements this; undefined would go NaN
    this.blocking = false;
    this.attackAnimT = 0;
    this.swingSide = 1;
    this.shotCounter = 0;
    this.punchCount = 0;
    this.recoilT = 0;
    this.boostT = 0;
    this.chargeT = 0;
    this.shieldT = 0;
    this.espresso = { t: 0, stacks: 0 };
    this.coffeeBuffT = 0;
    this.hotT = 0; this.hotRate = 0;

    // ---- status fields the enemy roster writes onto whatever it hits ----
    this.gooT = 0;
    this.slowT = 0;
    this.gooResist = false;
    this.latch = null;
    this.latchMash = 0;
    this.tether = null;
    this.hurtFlash = 0;
    this.stunT = 0;
    this.shockT = 0;
    this.downT = 0;                 // >0 while awaiting the next-floor respawn

    // ---- AI ----
    this.tactics = createTacticsState();
    this.doctrine = doctrineFor(this.classKey);
    const role = this.doctrine?.band?.melee ? 'melee'
      : (this.doctrine?.band?.hold ?? 10) < 7 ? 'mid' : 'ranged';
    this.squad = new SquadPositioner(game, this, { slot, doctrine: role });
    this.target = null;
    this._retargetT = 0;
    this._moveIntent = { moveX: 0, moveZ: 0 };
    this.lastDecision = null;

    this._buildMesh();
  }

  // ------------------------------------------------------------------ visual

  _buildMesh() {
    const def = this.classDef;
    const look = def.look ?? {};
    const person = makePerson({
      skin: look.skin ?? 0xE8B89B, shirt: look.shirt, pants: look.pants, tie: look.tie,
      accessories: look.accessories, hair: look.hair ?? 0x3a2a1a, build: look.build ?? 'normal',
    });
    this.mesh = new THREE.Group();
    this.mesh.add(person.root);
    this.body = person.root;
    this.parts = person.parts;
    if (def.gloves) {
      this.parts.grip.add(makeHeldItem('glove'));
      this.parts.gripL.add(makeHeldItem('glove'));
    } else if (def.weapon) {
      this.parts.grip.add(makeHeldItem(def.weapon));
    }
    this.game.scene.add(this.mesh);
    this.mesh.add(this._makePlate());
  }

  _makePlate() {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const g = canvas.getContext('2d');
    g.font = '700 28px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.8)';
    const label = `${this.name} [BOT]`;
    g.strokeText(label, 128, 32);
    g.fillStyle = '#a8e6a0';        // bots read green so they are never mistaken for a human
    g.fillText(label, 128, 32);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.plate = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    this.plate.scale.set(2.2, 0.55, 1);
    this.plate.position.y = 2.5;
    return this.plate;
  }

  // ------------------------------------------------------------------- stats

  /**
   * Bots scale off the class table and the floor's difficulty, NOT off the
   * human's items and drafts. A bot that inherited your build would make the
   * party's power curve depend on itself, which is exactly the signal a
   * playtest is trying to read.
   */
  recomputeStats() {
    const c = this.classDef;
    const lvlHp = 1 + (this.level - 1) * 0.08;
    const lvlDmg = 1 + (this.level - 1) * 0.06;
    // Deliberately a shade under a played character: a bot should feel like a
    // competent teammate, not a carry.
    const skillDmg = 0.72 + this.skill * 0.28;
    this.stats = {
      maxHp: c.hp * lvlHp,
      damage: c.damage * lvlDmg * skillDmg,
      flatDamage: 0,
      atkCdMult: 1 / (0.85 + this.skill * 0.15),
      moveSpeed: c.speed,
      sprintMult: TUNE.sprintMult * (c.sprintBonus ?? 1),
      critChance: TUNE.baseCrit,
      critDamageBonus: 0,
      regen: 0,
      moneyMult: 0, xpMult: 0,
      dashCd: TUNE.dashCd,
      damageTakenMult: c.damageTakenMult ?? 1,
      knockbackResist: c.knockbackResist ?? 0,
      bleedChance: 0, bleedPower: 0,
    };
    if (this.hp !== undefined) this.hp = Math.min(this.hp, this.stats.maxHp);
    this.maxHp = this.stats.maxHp;
  }

  get centerPos() { return _v3.set(this.pos.x, this.pos.y + 1.0, this.pos.z); }

  /** Where the kit's projectiles leave from. Matches the player's muzzle height. */
  get aimOrigin() { return _aimOrigin.set(this.pos.x, this.pos.y + 1.25, this.pos.z); }

  // ------------------------------------------------------------------ combat

  /**
   * The host owns bots outright, so unlike RemotePlayer this applies damage
   * locally. Mirrors Player.damage closely enough that a bot dies to the same
   * things you do — which is the whole point of testing beside one.
   */
  damage(amount, source = null, opts = {}) {
    if (this.dead || this.iframes > 0 || this.game.runOver) return;
    let dmg = amount * this.stats.damageTakenMult;
    if (this.blocking && source) {
      _v1.set(source.x - this.pos.x, 0, source.z - this.pos.z).normalize();
      const fwd = _aimDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      if (fwd.dot(_v1) > 0.25) dmg *= 0.25;
    }
    dmg = Math.max(1, Math.round(dmg));
    this.hp -= dmg;
    this.hurtFlash = 0.35;
    if (opts.from) this.lastDamagedBy = opts.from;
    // Bots feed the Director like any teammate: pressure is a party-wide signal,
    // and a bot getting mauled is real pressure on the party.
    this.game.director?.onPlayerDamaged(dmg * 0.6);
    if (this.hp <= 0) this.die();
  }

  heal(amount) {
    if (this.dead) return;
    this.hp = Math.min(this.stats.maxHp, this.hp + amount);
  }

  applyStun(dur) { this.stunT = Math.max(this.stunT, dur); }
  applyShock(dur) { this.shockT = Math.max(this.shockT, dur); }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.hp = 0;
    this.downT = 0;
    this.latch = null;
    this.mesh.visible = false;
    this.game.effects.shatter(this.body, { center: this.centerPos.clone(), power: 6, upPower: 5 });
    this.game.hud?.toast?.(`${this.name} was terminated`, 'warn');
    this.game.audio.sfx('death', { vol: 0.35, pos: this.pos });
    // Same rule the humans get (game.onPlayerDeath): down until the next floor.
    this.game.checkPartyWipe?.();
  }

  /** Called on floor change — a downed teammate comes back with the elevator. */
  respawn(pos) {
    this.dead = false;
    this.hp = this.stats.maxHp * 0.6;
    this.mesh.visible = true;
    this.motor.teleport(pos.x, pos.y, pos.z);
    resetTactics(this.tactics);
    this.brain.reset?.();
    this.squad.reset?.();
  }

  // -------------------------------------------------------------------- tick

  /**
   * @param {number} dt
   * @param {number} now unused; signature matches RemotePlayer so game.js can
   *   call every teammate identically
   */
  update(dt) {
    if (this.dead) { this.downT += dt; return; }

    // ---- timers ----
    // NOTE: primaryCd / secondaryCd / reloadT / ammo / heat are NOT ticked here.
    // decideCombat() owns the weapon bookkeeping end to end: advanceClocks()
    // ticks them, tryPrimary() DEBITS cd+ammo at the moment it decides to fire,
    // and refundAction() puts them back if we cannot perform. Ticking them here
    // too double-decremented the cooldown, and guarding on it here rejected the
    // very shot tactics had already paid for — the bots aimed, spent ammo, and
    // never fired a single projectile.
    this.iframes = Math.max(0, this.iframes - dt);
    this.attackAnimT = Math.max(0, this.attackAnimT - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.gooT = Math.max(0, this.gooT - dt);
    this.slowT = Math.max(0, this.slowT - dt);
    this.stunT = Math.max(0, this.stunT - dt);
    this.shockT = Math.max(0, this.shockT - dt);
    this.recoilT = Math.max(0, this.recoilT - dt * 5);

    const canAct = this.stunT <= 0 && !this.latch;

    // ---- 1. target ----
    // Re-scored on a throttle, not per frame: pickThreat walks the whole enemy
    // list, and a bot that re-picks at 60 Hz flickers between two equally-good
    // targets and never commits to either.
    this._retargetT -= dt;
    if (this._retargetT <= 0 || !this.target || this.target.dead) {
      this._retargetT = 0.25;
      this.target = pickThreat(this.game, this, this.target);
    }

    // ---- 2. combat: aim, trigger, resource management ----
    const dec = canAct ? decideCombat(this.game, this, this.target, dt) : null;
    this.lastDecision = dec;
    let firing = false;
    if (dec) {
      if (Number.isFinite(dec.yaw)) this.yaw = dec.yaw;
      firing = this._executeCombat(dec);
    }

    // ---- 3. move ----
    const band = this.doctrine?.band
      ? { min: dec?.standoff ?? this.doctrine.band.min, max: this.doctrine.band.max, melee: !!this.doctrine.band.melee }
      : DEFAULT_BANDS.ranged;
    const intent = this.squad.update(dt, {
      leader: this.game.player,
      band,
      threat: this.target,
      teammates: this.game.livePlayers(),
      spacing: dec?.teamSpacing ?? 3.5,
      yaw: this.yaw,
      canAct,
      holdGround: dec?.act === BOT_ACT.BLOCK,
      dash: false,
    });

    if (!canAct) {
      this.motor.setIntent({ moveX: 0, moveZ: 0, yaw: this.yaw, speedCap: 0, canAct: false });
    } else if (intent?.move) {
      // squad works in world directions; the motor wants camera-relative axes.
      worldDirToMoveIntent(intent.moveDir.x, intent.moveDir.z, this.yaw, this._moveIntent);
      let cap = this.stats.moveSpeed * (intent.sprint ? this.stats.sprintMult : 1);
      cap *= (intent.speedScale ?? 1) * (this.slowT > 0 ? 0.55 : 1) * (this.blocking ? 0.55 : 1);
      this.motor.setIntent({
        moveX: this._moveIntent.moveX, moveZ: this._moveIntent.moveZ, yaw: this.yaw,
        sprint: !!intent.sprint, jump: !!intent.jump, slide: false, dash: !!intent.dash,
        speedCap: cap, dashCd: this.stats.dashCd, canAct: true,
      });
    } else {
      this.motor.setIntent({ moveX: 0, moveZ: 0, yaw: this.yaw, speedCap: this.stats.moveSpeed, canAct: true });
    }
    this.motor.update(dt);

    // ---- 4. visual ----
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    const speed = this.motor.speed;
    if (speed > 0.6) animateWalk(this.parts, this.game.runTime, Math.min(1, speed / 8));
    else poseIdle(this.parts, this.game.runTime);
    if (firing) this.attackAnimT = 0.2;
    this.mesh.visible = !this.dead;
  }

  /**
   * Fire the REAL class kit. This is the point of the whole design: the bot
   * calls primary.fire(game, self, aim) exactly as Player does, so a weapon that
   * feels wrong beside a bot is a weapon that is wrong.
   * @returns {boolean} whether it actually fired
   */
  _executeCombat(dec) {
    const cls = this.classDef;
    const aimAt = dec.aimTarget;
    if (aimAt) {
      _aimDir.set(aimAt.x - this.aimOrigin.x, aimAt.y - this.aimOrigin.y, aimAt.z - this.aimOrigin.z);
      if (_aimDir.lengthSq() < 1e-6) _aimDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      _aimDir.normalize();
    } else {
      _aimDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    }
    // The aim object must match what Player builds, not just {origin, dir}: the
    // kits also read aim.point (the world hit position). The IT beam's MISS path
    // does `aim.point.distanceTo(aim.origin)` and threw on every shot that did
    // not already have a target locked — which is why that class fired zero
    // times. Same raycastAim call the human makes, so the bot's beam terminates
    // on exactly the geometry the player's would.
    const origin = this.aimOrigin.clone();
    const dir = _aimDir.clone();
    const rc = this.game.raycastAim(origin, dir, 80);
    const aim = { origin, dir, point: rc.point, enemy: rc.enemy, dist: rc.dist };

    this.blocking = dec.act === BOT_ACT.BLOCK;

    // tactics has already paid the cost; our only job is to perform the action
    // and hand the cost back if the kit itself refuses.
    switch (dec.act) {
      case BOT_ACT.PRIMARY: {
        let ok;
        try { ok = cls.primary?.fire?.(this.game, this, aim); }
        catch (err) { console.warn(`[bot] ${this.classKey} primary threw:`, err?.message ?? err); ok = false; }
        if (ok === false) { refundAction(this, dec); return false; }
        this.shotCounter++;
        this.attackAnimT = 0.2;
        return true;
      }
      case BOT_ACT.SECONDARY: {
        let ok;
        try { ok = cls.secondary?.use?.(this.game, this, aim); }
        catch (err) { console.warn(`[bot] ${this.classKey} secondary threw:`, err?.message ?? err); ok = false; }
        if (ok === false) { refundAction(this, dec); return false; }
        return true;
      }
      // RELOAD and BLOCK are pure state, already applied by tactics.
      default:
        return false;
    }
  }

  // ---- kit callbacks ----
  // The class kits call these ON the player they are given. Bots must provide
  // them or a melee kit throws the moment it swings.

  get onGround() { return this.motor.onGround; }
  set onGround(v) { this.motor.onGround = v; }

  /** Same wall-aware cone the human gets — bots cannot swing through a cubicle. */
  coneHit({ range, arcDeg, maxTargets = 12 }) {
    return this.game.combat.meleeArc({
      origin: this.pos,
      direction: _aimDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)),
      radius: range,
      angle: arcDeg,
      maxTargets,
    });
  }

  /**
   * Where a beam or tracer visually leaves this character. Bots have no
   * first-person viewmodel, but the kits still need a world-space origin —
   * effects.beam(from, to) dereferences it, so returning null threw
   * "Cannot read properties of undefined (reading 'distanceTo')" every tick the
   * IT beam fired. Fresh vector, not a shared temp: effects retain it for the
   * life of the beam.
   */
  muzzleWorldFx() {
    return new THREE.Vector3(
      this.pos.x + Math.sin(this.yaw) * 0.45,
      this.pos.y + 1.25,
      this.pos.z + Math.cos(this.yaw) * 0.45,
    );
  }
  addMoney() { /* the run's money is the human's */ }
  addXp() { /* likewise */ }
  addItem() { /* bots take no loot */ }

  /** Debug-panel readout: why is this bot doing what it is doing? */
  explain() {
    return {
      name: this.name,
      cls: this.classKey,
      hp: `${Math.round(this.hp)}/${Math.round(this.stats.maxHp)}`,
      act: this.lastDecision?.act ?? '—',
      why: this.lastDecision?.reason ?? '',
      target: this.target?.def?.name ?? '—',
      ammo: Number.isFinite(this.ammo) ? this.ammo : '∞',
      dist: this.game.player ? +this.pos.distanceTo(this.game.player.pos).toFixed(1) : 0,
    };
  }

  dispose() {
    this.game.scene.remove(this.mesh);
    this.mesh.traverse((o) => {
      if (o.isMesh && o.geometry?.dispose) o.geometry.dispose();
      if (o.isSprite) { o.material.map?.dispose(); o.material.dispose(); }
    });
    this.motor?.dispose?.();
  }
}

// Borrow the player's OWN melee and beam implementations, rather than porting
// them. A bot's swing must literally BE the player's swing — a reimplementation
// would drift, and then playtesting the kit beside a bot would be testing a
// different weapon than the one that ships. BotPlayer deliberately carries every
// field these touch (onGround, vel, stats, upgrades, swingSide, attackAnimT).
BotPlayer.prototype.meleeSwing = Player.prototype.meleeSwing;
BotPlayer.prototype.beamTick = Player.prototype.beamTick;
