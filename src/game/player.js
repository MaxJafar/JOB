// ============ local player: movement, camera rig, combat ============
import * as THREE from 'three';
import { TUNE } from './config.js';
import { CEIL_H } from './level.js';
import { CLASS_BY_KEY } from './classes.js';
import { makePerson, makeHeldItem, makeChairMount, animateWalk, poseIdle } from './characters.js';
import { box, cyl } from './props.js';
import { computeItemMods } from './items.js';
import { upgradeMods } from './upgrades.js';
import { MODULE_BY_ID } from './modules.js';
import { clamp, lerp, damp, chance, dist2D } from '../core/utils.js';
import { PlayerMotor } from '../player/motor.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// Hide the local body before a wall-compressed third-person camera reaches the
// head. Separate enter/exit distances prevent flicker while sliding along a wall.
const CAMERA_HIDE_DIST = 0.8;
const CAMERA_SHOW_DIST = 1.05;

const RARITY_GLOW = { common: 0, uncommon: 0.35, rare: 0.8 };

/**
 * Build the visible wardrobe for a rig. Everything is measured off the rig's
 * own build block (`parts.build`), so one definition dresses every body type.
 * Returns the meshes it added so the caller can strip them on the next change.
 */
export function attachGearTo(parts, gearList) {
  const out = [];
  const B = parts.build ?? { headS: 0.42, chestW: 0.66, chestH: 0.74, chestD: 0.40, armLen: 0.68, legLen: 0.82, legW: 0.22, legD: 0.26 };
  const hs = B.headS / 0.42;
  const hy = B.headS * 0.57;
  const hTop = hy + B.headS / 2;
  const hFace = B.headS / 2 + 0.02;
  const cW = B.chestW, cH = B.chestH, cD = B.chestD;

  for (const g of gearList) {
    if (!g || !g.visual) continue;
    const glow = RARITY_GLOW[g.rarity] ?? 0;
    const added = [];
    const add = (mesh, parent) => { parent.add(mesh); added.push(mesh); out.push(mesh); };
    switch (g.visual) {
      case 'hardhat': {
        const dome = cyl(0.24 * hs, 0.3 * hs, 0.18, 0xffd23f, 8, { rough: 0.5 });
        dome.position.y = hTop + 0.05;
        const brim = cyl(0.34 * hs, 0.34 * hs, 0.03, 0xffd23f, 10, { rough: 0.5 });
        brim.position.y = hTop - 0.02;
        add(dome, parts.head); add(brim, parts.head);
        break;
      }
      case 'propcap': {
        const cap = cyl(0.24 * hs, 0.28 * hs, 0.12, 0xc0392b, 8);
        cap.position.y = hTop + 0.03;
        const prop = box(0.42, 0.02, 0.06, 0x38e1ff, { emissive: 0x1899b4, emissiveIntensity: 1 });
        prop.position.y = hTop + 0.13;
        add(cap, parts.head); add(prop, parts.head);
        break;
      }
      case 'headphones': {
        const band = box(B.headS + 0.06, 0.05, 0.05, 0x222833);
        band.position.y = hTop + 0.02;
        add(band, parts.head);
        for (const s of [-1, 1]) {
          const cup = box(0.07, 0.16, 0.14, 0xff4fa3);
          cup.position.set(s * (B.headS / 2 + 0.04), hy, 0);
          add(cup, parts.head);
        }
        break;
      }
      case 'crown': {
        const cr = cyl(0.24 * hs, 0.28 * hs, 0.16, 0xd4aa30, 6, { metal: 0.8, rough: 0.3, emissive: 0x6b5210, emissiveIntensity: 0.5 });
        cr.position.y = hTop + 0.07;
        add(cr, parts.head);
        break;
      }
      case 'visorcap': {
        const shell = box(B.headS + 0.04, 0.14, B.headS + 0.04, 0x2b3240);
        shell.position.y = hTop + 0.03;
        const lens = box(B.headS * 0.95, 0.13, 0.05, 0x9fe8ff, { emissive: 0x38e1ff, emissiveIntensity: 1.6, rough: 0.2 });
        lens.position.set(0, hy + 0.03, hFace);
        add(shell, parts.head); add(lens, parts.head);
        break;
      }
      case 'beanie': {
        const bm = box(B.headS + 0.05, 0.24, B.headS + 0.05, 0xe0559a);
        bm.position.y = hTop + 0.04;
        const cuff = box(B.headS + 0.07, 0.08, B.headS + 0.07, 0xf6f6f2);
        cuff.position.y = hTop - 0.06;
        add(bm, parts.head); add(cuff, parts.head);
        break;
      }
      case 'vest': {
        const v = box(cW + 0.08, cH * 0.82, cD + 0.08, 0xff9b2d, { emissive: 0x7a4a12, emissiveIntensity: 0.5 });
        v.position.y = cH * 0.47;
        const stripe = box(cW + 0.1, 0.08, cD + 0.1, 0xf6f6f2);
        stripe.position.y = cH * 0.55;
        add(v, parts.torso); add(stripe, parts.torso);
        break;
      }
      case 'blazer': {
        const b = box(cW + 0.1, cH * 0.94, cD + 0.08, 0x1d222b, { rough: 0.6 });
        b.position.y = cH * 0.46;
        const lapelL = box(0.1, cH * 0.5, 0.04, 0x2b323d); lapelL.position.set(-0.1, cH * 0.6, cD / 2 + 0.06); lapelL.rotation.z = 0.2;
        const lapelR = lapelL.clone(); lapelR.position.x = 0.1; lapelR.rotation.z = -0.2;
        add(b, parts.torso); add(lapelL, parts.torso); add(lapelR, parts.torso);
        break;
      }
      case 'apron': {
        const a = box(cW * 0.92, cH * 0.95, 0.04, 0x6b4a33);
        a.position.set(0, cH * 0.4, cD / 2 + 0.03);
        const pocket = box(cW * 0.6, 0.16, 0.05, 0x54381f);
        pocket.position.set(0, cH * 0.2, cD / 2 + 0.05);
        add(a, parts.torso); add(pocket, parts.torso);
        break;
      }
      case 'harness': {
        for (const s of [-1, 1]) {
          const strap = box(0.11, cH, 0.05, 0x22262c);
          strap.position.set(s * cW * 0.22, cH * 0.5, cD / 2 + 0.02);
          add(strap, parts.torso);
        }
        const belt = box(cW + 0.06, 0.14, cD + 0.06, 0x22262c);
        belt.position.y = cH * 0.12;
        const clip = box(0.12, 0.12, 0.06, 0xd4aa30, { metal: 0.7, rough: 0.3 });
        clip.position.set(0, cH * 0.12, cD / 2 + 0.05);
        add(belt, parts.torso); add(clip, parts.torso);
        break;
      }
      case 'cardigan': {
        const c = box(cW + 0.14, cH * 0.9, cD + 0.12, 0x6f6480, { rough: 0.98 });
        c.position.y = cH * 0.45;
        add(c, parts.torso);
        for (const s of [-1, 1]) {
          const sleeve = box(0.06, B.armLen * 0.55, 0.06, 0x6f6480, { rough: 0.98 });
          sleeve.position.set(0, -B.armLen * 0.3, 0);
          sleeve.scale.set(3.4, 1, 3.4);
          add(sleeve, s < 0 ? parts.armL : parts.armR);
        }
        break;
      }
      case 'hoodie': {
        const h = box(cW + 0.08, cH * 0.9, cD + 0.08, 0x2b3240, { rough: 0.95 });
        h.position.y = cH * 0.45;
        const hood = box(cW * 0.85, 0.24, cD * 0.7, 0x2b3240);
        hood.position.set(0, cH - 0.08, -cD * 0.4);
        const pouch = box(cW * 0.65, 0.2, 0.06, 0x222833);
        pouch.position.set(0, cH * 0.22, cD / 2 + 0.05);
        add(h, parts.torso); add(hood, parts.torso); add(pouch, parts.torso);
        break;
      }
      case 'cargos': {
        for (const s of [-1, 1]) {
          const leg = box(B.legW + 0.07, B.legLen * 0.94, B.legD + 0.07, 0x4a5340, { rough: 0.95 });
          leg.position.y = -B.legLen / 2;
          const pocket = box(0.1, 0.16, B.legD + 0.09, 0x3d4436);
          pocket.position.set(s * (B.legW / 2 + 0.04), -B.legLen * 0.55, 0);
          add(leg, s < 0 ? parts.legL : parts.legR);
          add(pocket, s < 0 ? parts.legL : parts.legR);
        }
        break;
      }
      case 'sneakers': {
        for (const s of [-1, 1]) {
          const shoe = box(B.legW + 0.09, 0.16, B.legD + 0.18, 0xf6f6f2, { rough: 0.7 });
          shoe.position.set(0, -B.legLen + 0.02, 0.07);
          const swoosh = box(B.legW + 0.1, 0.04, 0.1, 0xff4fa3, { emissive: 0xa32a68, emissiveIntensity: 0.6 });
          swoosh.position.set(0, -B.legLen + 0.06, 0.13);
          add(shoe, s < 0 ? parts.legL : parts.legR);
          add(swoosh, s < 0 ? parts.legL : parts.legR);
        }
        break;
      }
      case 'kneepads': {
        for (const s of [-1, 1]) {
          const pad = box(B.legW + 0.06, 0.18, 0.09, 0x22262c, { rough: 0.8 });
          pad.position.set(0, -B.legLen * 0.55, B.legD / 2 + 0.03);
          add(pad, s < 0 ? parts.legL : parts.legR);
        }
        break;
      }
      case 'watch': {
        const w = box(0.11, 0.07, 0.13, 0xd4aa30, { metal: 0.8, rough: 0.3 });
        w.position.set(0, -B.armLen + 0.1, 0);
        add(w, parts.armL);
        break;
      }
      case 'tracker': {
        const band = box(0.1, 0.06, 0.14, 0x22262c);
        band.position.set(0, -B.armLen + 0.1, 0);
        const scr = box(0.07, 0.05, 0.02, 0x58e07c, { emissive: 0x2ea656, emissiveIntensity: 1.6 });
        scr.position.set(0, -B.armLen + 0.1, 0.08);
        add(band, parts.armL); add(scr, parts.armL);
        break;
      }
      case 'lanyard': {
        const cordL = box(0.03, 0.3, 0.03, 0x2a3a5c); cordL.position.set(-0.11, cH - 0.22, cD / 2); cordL.rotation.z = 0.24;
        const cordR = cordL.clone(); cordR.position.x = 0.11; cordR.rotation.z = -0.24;
        const badge = box(0.18, 0.25, 0.02, 0xf2f6ff); badge.position.set(0, cH - 0.46, cD / 2 + 0.02);
        add(cordL, parts.torso); add(cordR, parts.torso); add(badge, parts.torso);
        break;
      }
      case 'pinset': {
        for (let i = 0; i < 3; i++) {
          const pin = cyl(0.045, 0.045, 0.02, 0xd4aa30, 6, { metal: 0.7, rough: 0.3, emissive: 0x6b5210, emissiveIntensity: 0.6 });
          pin.rotation.x = Math.PI / 2;
          pin.position.set(-0.13 + i * 0.13, cH - 0.2, cD / 2 + 0.02);
          add(pin, parts.torso);
        }
        break;
      }
    }
    // rarity tell: EXECUTIVE pieces are lit, SENIOR pieces glow faintly
    if (glow > 0) {
      for (const m of added) {
        m.traverse?.((o) => {
          if (!o.isMesh || !o.material || o.material.emissive === undefined) return;
          o.material = o.material.clone();
          o.material.emissive = new THREE.Color(g.color ?? 0xffffff);
          o.material.emissiveIntensity = Math.max(o.material.emissiveIntensity ?? 0, glow);
        });
      }
    }
  }
  for (const m of out) m.traverse?.((o) => { if (o.isMesh) o.castShadow = true; });
  return out;
}

export class Player {
  constructor(game, classKey, name = 'YOU') {
    this.game = game;
    this.id = 'local';
    this.name = name;
    this.classDef = CLASS_BY_KEY[classKey];
    this.classKey = classKey;

    // Movement lives in PlayerMotor. `pos` and `vel` are the MOTOR's vectors,
    // shared by reference so the ~60 existing `player.pos` call sites keep
    // working and there is still exactly one source of truth.
    this.radius = 0.45;
    this.motor = new PlayerMotor(game, { radius: this.radius, height: 1.8, stepHeight: 0.55 });
    this.pos = this.motor.pos;
    this.vel = this.motor.vel;
    this._bindMotorEvents();

    this.yaw = Math.PI;                // face -z... adjusted at spawn
    this.pitch = -0.08;
    this.dead = false;

    // combat state
    this.level = 1;
    this.xp = 0;
    this.money = 0;
    this.items = new Map();
    this.upgrades = new Map();
    this.shotCounter = 0;
    this.beamHeat = 0;
    this.coffeeBuffT = 0;
    this.hydratedThisFloor = false;
    this.kills = 0;
    // pockets & wardrobe
    this.ammo = CLASS_BY_KEY[classKey].primary.mag ?? Infinity;
    this.reloadT = 0;
    this.heatGauge = 0;        // IT / Barista overheat 0..1
    this.overheatLock = 0;
    this.chargeAmt = 0;        // Analyst: charged-shot wind-up 0..1
    this.throwable = null;     // {id, count}
    this.consumables = [];     // [{id}] max 2
    this.gearSlots = { head: null, body: null, legs: null, trinket: null };
    this.gearBag = [];         // unequipped wearables, max 6
    this.gearMeshes = [];      // attached visual meshes
    // ---- punch-card modules: the two slots loot fills (v0.4) ----
    // The chassis (primary + RMB signature) is fixed forever; THESE are the run.
    this.modules = { passive: null, special: null };
    this.moduleBag = [];       // unequipped cards, max 4
    this.specialCd = 0;        // X — the SPECIAL module's cooldown
    this.crowdNear = 0;        // enemies within 9m, resampled at 5 Hz (OPEN FLOOR PLAN)
    this._crowdT = 0;
    this.eliteBuffT = 0;       // EMPLOYEE OF THE MONTH window
    this.backupUsed = false;   // BACKUP SERVER — once per floor
    this.killsSinceSnack = 0;  // PAPER TRAIL counter
    this.hotT = 0;             // sandwich heal-over-time
    this.hotRate = 0;
    this.primaryCd = 0;
    this.secondaryCd = 0;
    this.iframes = 0;
    this.blocking = false;
    this.attackAnimT = 0;
    this.swingSide = 1;
    this.recoilT = 0;
    this.espresso = { t: 0, stacks: 0 };
    this.gooT = 0;
    this.slowT = 0;
    // ---- status effects the department mobs inflict ----
    this.stunT = 0;         // HR: rooted mid-meeting, no input
    this.stunDR = 0;        // diminishing returns on repeat stuns
    this.shockT = 0;        // IT: abilities offline
    this.crowdDrag = 0;     // 0..0.6 movement tax from being boxed in
    this.tether = null;     // The Mediator's leash
    // The Micromanager books you: a countdown you can beat, then a moment
    // held in place — but your weapons keep working (see applyBooked).
    this.meetingT = 0;      // seconds until the meeting starts (0 = none)
    this.meetingBy = null;  // the Micromanager running the countdown
    this.bookedT = 0;       // rooted in the meeting, still able to shoot
    this._offlineT = 0;
    this.parachuteUsed = false;
    this.hurtFlash = 0;
    this.beamSfxT = 0;
    this.stepT = 0;
    this.landDip = 0;       // procedural landing compression, fed by motor.onLand

    this.punchCount = 0;    // brawler combo counter
    this.boostT = 0;        // marketing manager: Full Send
    this.chargeT = 0;       // brawler: Body Check
    this.shieldT = 0;       // IRON JAW damage reduction window
    this.chairSpin = 0;     // visual drift on the office chair

    this.camMode = 'tp';    // 'fp' | 'tp'
    this.camBlend = 1;      // 0 = fp, 1 = tp
    this.cameraOccluded = false;

    this.recomputeStats();
    this.hp = this.stats.maxHp;

    // ---- character mesh ----
    const look = this.classDef.look;
    const person = makePerson({
      skin: look.skin ?? 0xE8B89B, shirt: look.shirt, pants: look.pants, tie: look.tie,
      hair: look.hair ?? 0x3a2a1a, accessories: look.accessories, build: look.build ?? 'normal',
    });
    this.mesh = new THREE.Group();
    this.mesh.add(person.root);
    this.body = person.root;
    this.parts = person.parts;
    if (this.classDef.gloves) {
      // no weapon: the hands ARE the weapon
      this.parts.grip.add(makeHeldItem('glove'));
      this.parts.gripL.add(makeHeldItem('glove'));
    } else if (this.classDef.weapon) {
      this.heldItem = makeHeldItem(this.classDef.weapon);
      this.parts.grip.add(this.heldItem);
    }
    if (this.classDef.offhand) {
      this.offhandItem = makeHeldItem(this.classDef.offhand);
      this.parts.gripL.add(this.offhandItem);
    }
    // ---- the ride ----
    // The chair is a sibling of the body, not a child, so it can counter-rotate
    // for drift while the character keeps facing where you are aiming.
    if (this.classDef.mount === 'chair') {
      this.chair = makeChairMount(look.chairColor ?? 0xff4fa3);
      this.mesh.add(this.chair);
      this.body.position.y = 0.5;            // seated
      this.parts.legL.rotation.x = -1.35;
      this.parts.legR.rotation.x = -1.35;
    }
    game.scene.add(this.mesh);

    // ---- first-person viewmodel ----
    this.viewmodel = new THREE.Group();
    if (this.classDef.gloves) {
      const gl = makeHeldItem('glove'); gl.position.set(-0.34, -0.3, 0.1); gl.scale.setScalar(1.3);
      const gr = makeHeldItem('glove'); gr.position.set(0.12, -0.42, 0); gr.scale.setScalar(1.3);
      this.vmWeapon = gr;
      this.viewmodel.add(gl, gr);
      this.vmGloveL = gl;
    } else {
      const vmWeapon = makeHeldItem(this.classDef.weapon);
      vmWeapon.scale.setScalar(1.15);
      this.vmWeapon = vmWeapon;
      this.viewmodel.add(vmWeapon);
    }
    if (this.classDef.offhand) {
      this.vmOffhand = makeHeldItem(this.classDef.offhand);
      this.vmOffhand.position.set(-0.75, -0.05, 0.15);
      this.viewmodel.add(this.vmOffhand);
    }
    this.viewmodel.position.set(0.44, -0.42, -0.78);
    this.viewmodel.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
    game.camera.add(this.viewmodel);
    this.viewmodel.visible = false;
  }

  get centerPos() { return _v3.set(this.pos.x, this.pos.y + 1.0, this.pos.z); }
  get eyeY() { return this.slideT > 0 ? 1.05 : 1.62; }

  // ---- motor state, surfaced under the old field names ----
  // The rest of the class, the HUD, the netcode and the abilities all read
  // these. Delegating rather than mirroring means they can never drift.
  get onGround() { return this.motor.onGround; }
  set onGround(v) { this.motor.onGround = v; }
  get dashT() { return this.motor.dashT; }
  set dashT(v) { this.motor.dashT = v; }
  get dashCd() { return this.motor.dashCd; }
  set dashCd(v) { this.motor.dashCd = v; }
  get slideT() { return this.motor.slideT; }
  set slideT(v) { this.motor.slideT = v; }
  get momentumT() { return this.motor.momentumT; }
  set momentumT(v) { this.motor.momentumT = v; }
  get coyote() { return this.motor.coyote; }
  set coyote(v) { this.motor.coyote = v; }
  get jumpBuffer() { return this.motor.jumpBuffer; }
  set jumpBuffer(v) { this.motor.jumpBuffer = v; }
  get moveState() { return this.motor.state; }

  /**
   * All the juice stays here; the motor stays a pure solver. It reports what
   * happened, this decides what that should look and sound like.
   */
  _bindMotorEvents() {
    const g = this.game;
    this.motor.onJump = (slideJump) => {
      if (slideJump) g.effects.ring(this.pos, { color: 0xffffff, r1: 1.6, dur: 0.3, opacity: 0.4 });
      g.audio.sfx('jump');
    };
    this.motor.onSlideStart = () => g.audio.sfx('slide');
    this.motor.onDash = () => {
      this.iframes = Math.max(this.iframes, TUNE.dashIFrames);
      g.audio.sfx('dash');
      g.effects.burst(this.pos.clone().setY(0.4), { color: 0xffffff, n: 8, speed: 3, size: 0.09, ttl: 0.3 });
      this.breakTether();       // …and cuts the Mediator's leash
      this.stunT = 0;           // and is the only thing that ends a stun early
      this.bookedT = 0;         // walking out of a meeting is always allowed
      this.cancelMeeting();     // …and breaks the Micromanager's countdown
      // CAFFEINE DRIP: the dash stops being purely defensive
      const burn = this.passive('dashBurn');
      if (burn > 0) {
        g.addSlowZone({
          pos: this.pos.clone().setY(0), radius: 2.6, ttl: 2.4, factor: 0.7,
          dps: this.stats.damage * burn, owner: this, color: 0xffb36b, quiet: true,
        });
      }
    };
    this.motor.onLand = (fallSpeed) => {
      if (fallSpeed < 6) return;
      // landing compression: the camera and the legs both feel the impact
      g.audio.sfx('ui', { vol: Math.min(0.5, fallSpeed / 40) });
      this.landDip = Math.min(0.22, fallSpeed / 90);
      if (fallSpeed > 14) g.shake(Math.min(0.25, fallSpeed / 90));
    };
    this.motor.onStepUp = () => g.audio.sfx('ui', { vol: 0.12 });
  }

  /**
   * Read one tuned number off the equipped PASSIVE module, or 0 if the card
   * that owns it isn't equipped. Every passive hook site is this one lookup, so
   * adding a card never means touching the site that reads it.
   */
  passive(key) { return this.modules.passive?.v?.[key] ?? 0; }

  recomputeStats() {
    const c = this.classDef;
    const meta = this.game.meta.perkMods();
    const mods = computeItemMods(this.items);
    const ups = upgradeMods(this.upgrades);
    const lvlHp = 1 + (this.level - 1) * 0.08;
    const lvlDmg = 1 + (this.level - 1) * 0.06;
    // combo momentum: +3% attack & move speed per 5 combo, capped at +24%
    const comboBonus = Math.min(0.24, Math.floor((this.game.combo?.count ?? 0) / 5) * 0.03);
    const hasteStacks = (this.espresso.stacks > 0 ? 1 + 0.25 * this.espresso.stacks : 1)
      * (this.coffeeBuffT > 0 ? 1.25 : 1) * (1 + comboBonus);
    // wearable gear aggregation
    const gear = { damageMult: 0, maxHpBonus: 0, moveMult: 0, critChance: 0, regen: 0, moneyMult: 0, xpMult: 0, damageTakenMult: 0 };
    this.gooResist = false;
    for (const g of Object.values(this.gearSlots)) {
      if (!g) continue;
      for (const [k, v] of Object.entries(g.stats)) gear[k] = (gear[k] ?? 0) + v;
      if (g.gooResist) this.gooResist = true;
    }
    // ---- PASSIVE module contributions ----
    // OPEN FLOOR PLAN caps at 6 bodies: past that it stops being "you waded in"
    // and starts being "the director spawned a wave", which is not skill.
    const crowd = 1 + this.passive('crowdDamage') * Math.min(6, this.crowdNear ?? 0);
    const atFullHp = this.hp === undefined || this.hp >= (this._lastMaxHp ?? 0) - 0.5;
    const deskMove = 1 + (atFullHp ? this.passive('fullHpMove') : 0);
    const eotm = 1 + (this.eliteBuffT > 0 ? this.passive('eliteBuff') : 0);
    this.stats = {
      maxHp: (c.hp * lvlHp * meta.hpMult + mods.maxHpBonus + ups.maxHpBonus + gear.maxHpBonus) * mods.hpMult,
      damage: c.damage * lvlDmg * mods.damageMult * ups.damageMult * (1 + gear.damageMult) * meta.dmgMult
        * crowd * eotm,
      flatDamage: mods.flatDamage,
      atkCdMult: 1 / (mods.atkSpeedMult * ups.atkSpeedMult * hasteStacks),
      moveSpeed: c.speed * mods.moveMult * ups.moveMult * (1 + gear.moveMult) * meta.speedMult
        * (this.espresso.stacks > 0 ? 1 + 0.08 * this.espresso.stacks : 1)
        * (this.coffeeBuffT > 0 ? 1.12 : 1) * (1 + comboBonus * 0.6) * deskMove,
      sprintMult: TUNE.sprintMult * (c.sprintBonus ?? 1),
      critChance: TUNE.baseCrit + mods.critChance + ups.critChance + gear.critChance,
      critDamageBonus: (ups.critDamageBonus ?? 0) + (c.critDamageBonus ?? 0),
      regen: mods.regen + ups.regen + gear.regen + (c.regenBonus ?? 0) + meta.regen,
      moneyMult: mods.moneyMult * (c.moneyBonus ?? 1) * (1 + gear.moneyMult) * meta.moneyMult,
      xpMult: mods.xpMult * ups.xpMult * (1 + gear.xpMult) * (c.xpBonus ?? 1),
      dashCd: TUNE.dashCd * mods.dashCdMult * ups.dashCdMult * (1 - this.passive('dashCdMult')),
      // 0..0.9 — read by PlayerMotor.applyKnockback. Heavy archetypes and
      // body gear should be able to stand their ground against a Charger.
      knockbackResist: Math.min(0.9, (c.knockbackResist ?? 0) + (gear.knockbackResist ?? 0)),
      damageTakenMult: (c.damageTakenMult ?? 1) * (1 + gear.damageTakenMult),
      bleedChance: mods.bleedChance, bleedPower: mods.bleedPower,
      chainChance: mods.chainChance, chainCount: mods.chainCount,
      critExplode: mods.critExplode, critExplodePower: mods.critExplodePower,
      parachute: mods.parachute,
      espresso: mods.espresso,
      cryptoPortfolio: mods.cryptoPortfolio,
    };
    // STANDING DESK reads "am I at full HP", which needs maxHp — which is what
    // this function computes. Cache last frame's ceiling for the next call
    // rather than reading a value that does not exist yet.
    this._lastMaxHp = this.stats.maxHp;
    if (this.hp !== undefined) this.hp = Math.min(this.hp, this.stats.maxHp);
  }

  applyUpgrade(up) {
    this.upgrades.set(up.id, (this.upgrades.get(up.id) || 0) + 1);
    if (up.id === 'insurance') this.heal(this.stats.maxHp * 0.5);
    this.recomputeStats();
    this.game.hud.renderItems(this.items, this.upgrades, this.modules);
    this.game.audio.sfx(up.kind === 'evolution' ? 'item-rare' : 'item');
    this.game.hud.toast(`${up.icon} ${up.name}`, 'item');
  }

  xpToNext() { return Math.floor(TUNE.levelXpBase * Math.pow(TUNE.levelXpGrowth, this.level - 1)); }

  addXp(amount) {
    this.xp += amount * this.stats.xpMult;
    while (this.xp >= this.xpToNext()) {
      this.xp -= this.xpToNext();
      this.level++;
      this.recomputeStats();
      this.heal(this.stats.maxHp * 0.2, true);
      this.game.audio.sfx('levelup');
      this.game.effects.ring(this.pos, { color: 0x7fe7ff, r1: 3.4, dur: 0.55 });
      this.game.queueDraft();
    }
  }

  addMoney(amount) {
    this.money += amount * this.stats.moneyMult;
  }

  addItem(item) {
    this.items.set(item.id, (this.items.get(item.id) || 0) + 1);
    this.recomputeStats();
    this.game.hud.renderItems(this.items, this.upgrades, this.modules);
    this.game.hud.toast(`${item.icon} ${item.name}`, 'item');
    this.game.audio.sfx(item.rarity === 'rare' ? 'item-rare' : 'item');
  }

  heal(amount, silent = false) {
    if (this.dead) return;
    const before = this.hp;
    this.hp = Math.min(this.stats.maxHp, this.hp + amount);
    if (!silent && this.hp - before > 1) {
      this.game.effects.number(this.centerPos.clone().add(_v1.set(0, 0.8, 0)), this.hp - before, { heal: true });
    }
  }

  damage(amount, source = null, opts = {}) {
    if (this.dead || this.iframes > 0 || this.game.runOver || this.godMode) return;
    // who did it — feeds the death recap ("Terminated by: THE AUDITOR") and the
    // deaths-by-source telemetry the difficulty gates are read from
    if (opts.from) this.lastDamagedBy = opts.from;
    let dmg = amount * this.stats.damageTakenMult;
    if (this.shieldT > 0) dmg *= 0.75;   // IRON JAW
    // janitor lid block: frontal 150° arc
    if (this.blocking && source) {
      const toSrc = _v1.set(source.x - this.pos.x, 0, source.z - this.pos.z).normalize();
      const fwd = _v2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      if (fwd.dot(toSrc) > 0.25) {
        dmg *= 0.25;
        this.game.audio.sfx('block');
        this.game.effects.burst(this.centerPos, { color: 0x9aa3b0, n: 6, speed: 3, size: 0.08 });
        // RIOT LID: slam everything in front back with interest
        if (this.upgrades.get('riotlid')) {
          const hits = this.coneHit({ range: 3.4, arcDeg: 150 });
          for (const e of hits) {
            this.game.damageEnemy(e, this.stats.damage * 1.5, { owner: this });
            e.applyKnockback(this.pos, 14);
          }
          if (hits.length) this.game.effects.ring(this.pos, { color: 0x9aa3b0, r1: 3.4, dur: 0.3 });
        }
      }
    }
    dmg = Math.max(1, Math.round(dmg));
    this.hp -= dmg;
    this.hurtFlash = 0.35;
    this.game.director?.onPlayerDamaged(dmg);
    this.game.kpi?.onPlayerHurt();
    if (this.stats.cryptoPortfolio && this.money > 0) {
      const loss = Math.ceil(this.money * 0.1);
      this.money -= loss;
      this.game.hud.toast(`🪙 crypto dipped −$${loss}`, 'warn');
    }
    this.game.hud.hurt();
    this.game.audio.sfx('hurt', { vol: 0.8 });
    this.game.shake(Math.min(0.5, dmg / 40));
    this.game.postfx?.hitFlash(Math.min(1, dmg / 25));
    this.game.telemetry?.damageTaken(dmg);
    if (this.hp <= 0) {
      if (this.stats.parachute && !this.parachuteUsed) {
        this.parachuteUsed = true;
        this.hp = this.stats.maxHp * 0.4;
        this.iframes = 1.2;
        this.game.audio.sfx('parachute');
        this.game.hud.toast('🪂 GOLDEN PARACHUTE DEPLOYED', 'item');
        this.game.effects.ring(this.pos, { color: 0xffd23f, r1: 6, dur: 0.8 });
        return;
      }
      // BACKUP SERVER — once per floor, and it hands back i-frames rather than
      // health, so the save is a chance to escape, not a second health bar
      if (this.passive('restoreIframes') > 0 && !this.backupUsed) {
        this.backupUsed = true;
        this.hp = 1;
        this.iframes = this.passive('restoreIframes');
        this.game.audio.sfx('item-rare');
        this.game.hud.announce('💾 BACKUP SERVER — RESTORED FROM SNAPSHOT', 2.4, true);
        this.game.effects.ring(this.pos, { color: 0x7fe7ff, r1: 6, dur: 0.8 });
        return;
      }
      this.hp = 0;
      this.die();
    }
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.breakTether(true);
    this.stunT = this.shockT = this.crowdDrag = this.bookedT = 0;
    this.cancelMeeting();
    this.game.hud.setStatuses([]);
    this.game.effects.burst(this.centerPos, { color: 0xc03030, n: 24, speed: 6, ttl: 0.9 });
    // you too, buddy: Lego pieces everywhere
    this.game.effects.shatter(this.mesh, { center: this.centerPos.clone(), power: 7, upPower: 6 });
    this.mesh.visible = false;
    this.viewmodel.visible = false;
    this.game.onPlayerDeath(this);
  }

  // ---------- aiming ----------
  aimData() {
    const cam = this.game.camera;
    const origin = _v1.copy(cam.position);
    const dir = _v2.set(0, 0, -1).applyQuaternion(cam.quaternion).normalize();
    // find what the crosshair is over (enemies then walls)
    const hit = this.game.raycastAim(origin, dir, 70);
    const point = hit.point;
    // muzzle: FP → just in front of camera; TP → character chest, aimed at the crosshair point
    let mOrigin, mDir;
    if (this.camBlend < 0.5) {
      mOrigin = origin.clone().addScaledVector(dir, 0.5).addScaledVector(_v3.set(0, -1, 0), 0.12);
      mDir = dir.clone();
    } else {
      mOrigin = this.pos.clone().add(new THREE.Vector3(0, 1.25, 0));
      mDir = point.clone().sub(mOrigin).normalize();
    }
    return { origin: mOrigin, dir: mDir, point, camDir: dir.clone() };
  }

  muzzleWorldFx() {
    // world position for muzzle flash fx
    if (this.camBlend < 0.5) {
      const cam = this.game.camera;
      return _v1.copy(cam.position).addScaledVector(_v2.set(0, 0, -1).applyQuaternion(cam.quaternion), 0.9).clone();
    }
    const p = new THREE.Vector3();
    this.parts.grip.getWorldPosition(p);
    return p;
  }

  // ---------- melee helpers ----------
  /**
   * Every melee swing goes through the combat query layer, so it gets wall
   * occlusion and nearest-first target ordering for free. Before this, a swing
   * could reach through a cubicle wall — the arc test never asked about geometry.
   */
  coneHit({ range, arcDeg, maxTargets = 12 }) {
    return this.game.combat.meleeArc({
      origin: this.pos,
      direction: _v1.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)),
      radius: range,
      angle: arcDeg,
      maxTargets,
    });
  }

  meleeSwing({ range, arcDeg, mult, knockback }) {
    const game = this.game;
    this.attackAnimT = 0.28;
    this.swingSide *= -1;
    game.audio.sfx('swing');
    // fluid swing: visible arc trail + forward lunge
    game.effects.slash(this.pos, this.yaw, range, this.swingSide, 0xf2f6ff);
    if (this.onGround) {
      this.vel.x += Math.sin(this.yaw) * 3.2;
      this.vel.z += Math.cos(this.yaw) * 3.2;
    }
    const hits = this.coneHit({ range, arcDeg });
    for (const e of hits) {
      const crit = chance(this.stats.critChance);
      game.damageEnemy(e, (this.stats.damage * mult + this.stats.flatDamage) * (crit ? 2 : 1), { crit, owner: this, melee: true });
      e.applyKnockback(this.pos, knockback);
    }
    if (hits.length) game.audio.sfx('melee-hit');
    // evolutions
    const fwdSwing = _v1.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    if (this.upgrades.get('wetfloor')) {
      const spot = this.pos.clone().addScaledVector(fwdSwing, 1.8).setY(0);
      game.addSlowZone({ pos: spot, radius: 2.6, ttl: 2.5, factor: 0.55, color: 0x7fd4ff, quiet: true });
    }
    if (this.upgrades.get('broomwave')) {
      game.projectiles.spawn({
        pos: this.pos.clone().add(new THREE.Vector3(0, 1.0, 0)),
        vel: fwdSwing.clone().multiplyScalar(20), kind: 'wave',
        damage: (this.stats.damage * 0.6 + this.stats.flatDamage), crit: chance(this.stats.critChance),
        friendly: true, ttl: 0.55, owner: this, pierce: 99, knockback: 5, radius: 1.1,
      });
    }
    // shove debris around for flavor
    game.level.kickDebris(this.pos.clone().addScaledVector(_v1.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), 1.6), 2.4, 5);
    // also whack destructibles
    const fwd = _v1.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    for (const d of game.level.destructibles) {
      if (d.dead) continue;
      const dd = dist2D(d.pos, this.pos);
      if (dd < range + 0.5) {
        const to = _v2.set(d.pos.x - this.pos.x, 0, d.pos.z - this.pos.z).normalize();
        if (fwd.dot(to) > 0.4) game.damageDestructible(d, this.stats.damage * mult);
      }
    }
    return hits.length > 0;
  }

  beamTick(aim) {
    const game = this.game;
    const range = 16;
    // overclock: damage ramps while the beam is held
    if (this.upgrades.get('overclock')) this.beamHeat = Math.min(1, this.beamHeat + game.dtLast / 3);
    // pick target: nearest enemy near the aim ray
    let best = null, bestScore = 1e9;
    for (const e of game.enemies) {
      if (e.dead) continue;
      const to = _v1.copy(e.center).sub(aim.origin);
      const d = to.length();
      if (d > range) continue;
      const along = to.dot(aim.dir);
      if (along < 0) continue;
      const off = Math.sqrt(Math.max(0, d * d - along * along));
      if (off < 1.4 + e.radius && off < bestScore) { bestScore = off; best = e; }
    }
    const crit = chance(this.stats.critChance);
    const heatMult = 1 + this.beamHeat;
    const dmg = (this.stats.damage + this.stats.flatDamage * 0.4) * heatMult * (crit ? 2 : 1);
    const beamColor = this.beamHeat > 0.6 ? 0xff9b2d : 0x38e1ff;
    if (best) {
      game.damageEnemy(best, dmg, { crit, owner: this, beam: true });
      game.effects.beam(this.muzzleWorldFx(), best.center, { color: beamColor });
      // chain to additional targets
      const chains = 1 + (this.upgrades.get('bandwidth') || 0);
      let src = best;
      const hitSet = new Set([best.id]);
      for (let c = 0; c < chains; c++) {
        let chained = null, cd2 = 1e9;
        for (const e2 of game.enemies) {
          if (e2.dead || hitSet.has(e2.id)) continue;
          const dd = e2.pos.distanceTo(src.pos);
          if (dd < 7 && dd < cd2) { cd2 = dd; chained = e2; }
        }
        if (!chained) break;
        hitSet.add(chained.id);
        game.damageEnemy(chained, dmg * 0.6, { crit: false, owner: this, beam: true });
        game.effects.beam(src.center.clone(), chained.center.clone(), { color: 0x7fe7ff, jitter: 0.5 });
        src = chained;
      }
    } else {
      const end = aim.origin.clone().addScaledVector(aim.dir, Math.min(range, aim.point.distanceTo(aim.origin)));
      game.effects.beam(this.muzzleWorldFx(), end, { color: 0x2a9fc4, jitter: 0.2 });
    }
    this.beamSfxT -= game.dtLast;
    if (this.beamSfxT <= 0) { game.audio.sfx('zap'); this.beamSfxT = 0.11; }
    return true;
  }

  startReload() {
    const cls = this.classDef;
    if (!cls.primary.mag || this.reloadT > 0) return;
    this.reloadT = cls.primary.reload;
    this.game.audio.sfx('ui2', { vol: 0.7 });
  }

  // ---------- wearable gear ----------
  pickupGear(gear) {
    if (!this.gearSlots[gear.slot]) {
      this.equipGear(gear);
    } else if (this.gearBag.length < 6) {
      this.gearBag.push(gear);
      this.game.hud.toast(`💼 ${gear.icon} ${gear.name} → bag (Tab)`, 'item');
    } else {
      // bag full: convert to cash
      this.addMoney(20);
      this.game.hud.toast(`💼 bag full — ${gear.name} pawned for $20`, 'warn');
      return;
    }
    this.game.audio.sfx(gear.rarity === 'rare' ? 'item-rare' : 'item');
  }

  equipGear(gear) {
    const old = this.gearSlots[gear.slot];
    this.gearSlots[gear.slot] = gear;
    const bagIdx = this.gearBag.indexOf(gear);
    if (bagIdx >= 0) this.gearBag.splice(bagIdx, 1);
    if (old && this.gearBag.length < 6) this.gearBag.push(old);
    this.recomputeStats();
    this.refreshGearVisuals();
    this.game.hud.toast(`${gear.icon} equipped: ${gear.name}`, 'item');
  }

  // ---------- punch-card modules ----------
  /**
   * A card goes straight into its slot if the slot is empty — a first module
   * should never need a menu trip. After that it lands in the bag and the
   * player chooses, because swapping a working build is a real decision.
   */
  pickupModule(mod) {
    const slot = mod.kind;
    if (!this.modules[slot]) {
      this.equipModule(mod);
    } else if (this.moduleBag.length < 4) {
      this.moduleBag.push(mod);
      this.game.hud.toast(`🗃️ ${mod.icon} ${mod.name} → bag (Tab)`, 'item');
      this.game.audio.sfx(mod.tier >= 2 ? 'item-rare' : 'item');
    } else {
      this.addMoney(45);
      this.game.hud.toast(`🗃️ card file full — ${mod.name} filed for $45`, 'warn');
      return;
    }
    // a power spike you never got to taste is not a power spike (D 1.2)
    this.game.director?.grantSpikeGrace();
    this.game.telemetry?.modulePicked?.(mod.id, mod.rarity, this.game.runTime);
  }

  equipModule(mod) {
    const slot = mod.kind;
    const old = this.modules[slot];
    this.modules[slot] = mod;
    const bagIdx = this.moduleBag.indexOf(mod);
    if (bagIdx >= 0) this.moduleBag.splice(bagIdx, 1);
    if (old && this.moduleBag.length < 4) this.moduleBag.push(old);
    // a fresh card is ready immediately; swapping one mid-fight is not free
    if (slot === 'special') this.specialCd = old ? Math.min(this.specialCd, mod.cd) : 0;
    this.recomputeStats();
    this.game.hud.setModules?.(this);
    this.game.hud.toast(`${mod.icon} installed: ${mod.name}`, 'item');
    this.game.audio.sfx(mod.tier >= 2 ? 'item-rare' : 'item');
  }

  /** Effective cooldown after ERGONOMIC CHAIR. */
  specialCooldown() {
    const base = this.modules.special?.cd ?? 0;
    return base * (1 - this.passive('specialCdMult'));
  }

  /**
   * Passive-module bookkeeping.
   *
   * The two state-dependent passives (OPEN FLOOR PLAN's crowd count, STANDING
   * DESK's at-full-HP check) both feed `stats.damage`/`stats.moveSpeed`, which
   * means they need a `recomputeStats()`. Doing that every frame for every
   * player is exactly the kind of cost that hides in a frame graph, so both are
   * EDGE-TRIGGERED: the crowd is bucketed and resampled at 5 Hz, and a recompute
   * only fires when the bucket or the full-HP flag actually changes.
   */
  updateModules(dt) {
    let dirty = false;
    if (this.eliteBuffT > 0) {
      this.eliteBuffT -= dt;
      if (this.eliteBuffT <= 0) { this.eliteBuffT = 0; dirty = true; }
    }
    if (this.passive('crowdDamage') > 0) {
      this._crowdT -= dt;
      if (this._crowdT <= 0) {
        this._crowdT = 0.2;
        let n = 0;
        for (const e of this.game.enemies) {
          if (!e.dead && dist2D(e.pos, this.pos) < 9) n++;
          if (n >= 6) break;   // the bonus caps at 6 — counting past it is waste
        }
        if (n !== this.crowdNear) { this.crowdNear = n; dirty = true; }
      }
    } else if (this.crowdNear !== 0) {
      this.crowdNear = 0;
      dirty = true;
    }
    if (this.passive('fullHpMove') > 0) {
      const full = this.hp >= this.stats.maxHp - 0.5;
      if (full !== this._wasFullHp) { this._wasFullHp = full; dirty = true; }
    }
    if (dirty) this.recomputeStats();
  }

  /**
   * Rebuild every equipped piece onto the rig. Sized from `parts.build` so a
   * hard hat that fits the Intern also fits the Facilities Guy's head and the
   * Marketing Manager's smaller frame — no per-class wardrobes.
   *
   * `attachGearTo` is shared with RemotePlayer, so what you're wearing is what
   * your teammates see.
   */
  refreshGearVisuals() {
    for (const m of this.gearMeshes) m.parent?.remove(m);
    this.gearMeshes.length = 0;
    this.gearMeshes = attachGearTo(this.parts, Object.values(this.gearSlots));
  }

  // ---------- status effects ----------
  /**
   * HR's stun. Diminishing returns are the whole design: one Talent Partner is
   * a speed bump, six of them should feel like drowning — but you must always
   * get an input back, so each successive stun lands shorter and the resistance
   * only bleeds off once you are clear of them.
   */
  applyStun(dur, fromPos = null) {
    if (this.dead || this.iframes > 0 || this.godMode) return;
    const applied = dur * Math.max(0.22, 1 - this.stunDR);
    if (applied < 0.08) return;
    this.stunT = Math.max(this.stunT, applied);
    this.stunDR = Math.min(0.78, this.stunDR + 0.3);
    this.game.audio.sfx('block', { vol: 0.45 });
    this.game.effects.ring(this.pos, { color: 0xff9ec4, r0: 0.3, r1: 1.5, dur: 0.3, opacity: 0.55 });
    if (fromPos) this.game.shake(0.12);
  }

  /**
   * The Micromanager's meeting. Deliberately NOT a stun: you are pinned in
   * place but keep every weapon and ability, because a special that takes the
   * mouse away is a special you cannot fight back against. Dash still leaves.
   */
  applyBooked(dur) {
    if (this.dead || this.iframes > 0 || this.godMode) return;
    this.bookedT = Math.max(this.bookedT, dur);
    this.cancelMeeting();
    this.game.audio.sfx('phone', { vol: 0.9 });
    this.game.effects.ring(this.pos, { color: 0xffb347, r0: 2.6, r1: 1.4, dur: 0.45, opacity: 0.7 });
    this.game.hud.toast('📅 MEETING STARTED — dash to walk out', 'warn');
  }

  /** Clear a pending countdown (he lost sight of you, or died, or it fired). */
  cancelMeeting(quiet = true) {
    if (!this.meetingT) return;
    this.meetingT = 0;
    this.meetingBy = null;
    if (!quiet) {
      this.game.audio.sfx('ui', { vol: 0.5 });
      this.game.hud.toast('📅 meeting cancelled', 'item');
    }
  }

  /** IT's shock: you keep your feet, you lose your toolkit. */
  applyShock(dur) {
    if (this.dead || this.iframes > 0 || this.godMode) return;
    this.shockT = Math.max(this.shockT, dur);
    this.game.effects.burst(this.centerPos, { color: 0x38e1ff, n: 5, speed: 3, size: 0.07, ttl: 0.3, gravity: 2 });
  }

  systemsOfflineFeedback() {
    if (this._offlineT > this.game.runTime) return;   // don't machine-gun the toast
    this._offlineT = this.game.runTime + 1.2;
    this.game.audio.sfx('ui', { vol: 0.6 });
    this.game.hud.toast(this.stunT > 0 ? '📋 you are in a meeting' : '⚡ SYSTEMS OFFLINE', 'warn');
  }

  breakTether(quiet = false) {
    const m = this.tether;
    if (!m) return;
    this.tether = null;
    if (m.tethered === this) m.endTether();
    if (!quiet) {
      this.game.audio.sfx('block', { vol: 0.8 });
      this.game.hud.toast('✂ tether cut', 'item');
    }
  }

  /** Everything currently being done to you, for the HUD strip. */
  statusList() {
    const out = [];
    if (this.stunT > 0) out.push({ k: 'stun', icon: '📋', label: 'IN A MEETING' });
    if (this.meetingT > 0) out.push({ k: 'meeting', icon: '📅', label: `MEETING IN ${Math.ceil(this.meetingT)}` });
    if (this.bookedT > 0) out.push({ k: 'booked', icon: '📅', label: 'MEETING IN PROGRESS' });
    if (this.tether) out.push({ k: 'tether', icon: '🪢', label: 'DASH TO BREAK' });
    if (this.shockT > 0) out.push({ k: 'shock', icon: '⚡', label: 'SYSTEMS OFFLINE' });
    if (this.crowdDrag > 0.2) out.push({ k: 'crowd', icon: '🚧', label: 'BOXED IN' });
    return out;
  }

  // ---------- per-frame ----------
  update(dt) {
    const game = this.game;
    const input = game.input;
    if (this.dead) return;

    // look
    if (input.locked) {
      const sens = game.meta.settings.sensitivity * 0.0022;
      this.yaw -= input.mouseDX * sens;
      const inv = game.meta.settings.invertY ? -1 : 1;
      this.pitch = clamp(this.pitch - input.mouseDY * sens * inv, -1.5, 1.5);
    }

    // camera toggle
    if (input.pressed('KeyV')) {
      this.camMode = this.camMode === 'tp' ? 'fp' : 'tp';
      game.audio.sfx('ui');
    }
    this.camBlend = damp(this.camBlend, this.camMode === 'tp' ? 1 : 0, 10, dt);

    // timers
    this.primaryCd = Math.max(0, this.primaryCd - dt);
    this.secondaryCd = Math.max(0, this.secondaryCd - dt);
    this.specialCd = Math.max(0, this.specialCd - dt);
    this.iframes = Math.max(0, this.iframes - dt);
    this.attackAnimT = Math.max(0, this.attackAnimT - dt);
    // (dash cooldown is ticked inside the motor)
    this.recoilT = Math.max(0, this.recoilT - dt * 5);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.gooT = Math.max(0, this.gooT - dt);
    this.slowT = Math.max(0, this.slowT - dt);
    this.stunT = Math.max(0, this.stunT - dt);
    this.shockT = Math.max(0, this.shockT - dt);
    this.bookedT = Math.max(0, this.bookedT - dt);
    // the countdown itself is ticked by the Micromanager running it, so it
    // stops the instant he dies or loses you — but drop it if he goes away
    if (this.meetingT > 0 && (!this.meetingBy || this.meetingBy.dead)) this.cancelMeeting();
    this.boostT = Math.max(0, this.boostT - dt);
    this.chargeT = Math.max(0, this.chargeT - dt);
    this.shieldT = Math.max(0, this.shieldT - dt);
    // stun resistance only recovers once nothing is stunning you
    if (this.stunT <= 0) this.stunDR = Math.max(0, this.stunDR - dt * 0.24);
    if (this.tether && (this.tether.dead || this.tether.tethered !== this)) this.tether = null;

    // Being surrounded is its own mechanic: wide, slow bodies (HR) each add a
    // movement tax, so a wall of them is a cage rather than a damage race.
    let crowd = 0;
    for (const e of game.enemies) {
      if (e.dead || !e.def.crowd) continue;
      if (dist2D(e.pos, this.pos) < e.radius + 2.1) crowd += e.def.crowd;
    }
    this.crowdDrag = Math.min(0.6, crowd);
    this.updateModules(dt);
    if (!input.mouse(0)) this.beamHeat = Math.max(0, this.beamHeat - dt * 1.6);
    if (this.espresso.t > 0) {
      this.espresso.t -= dt;
      if (this.espresso.t <= 0) { this.espresso.stacks = 0; this.recomputeStats(); }
    }
    if (this.coffeeBuffT > 0) {
      this.coffeeBuffT -= dt;
      if (this.coffeeBuffT <= 0) { this.coffeeBuffT = 0; this.recomputeStats(); }
    }

    // regen
    if (this.stats.regen > 0) this.heal(this.stats.regen * dt, true);

    // ---- movement ----
    // Everything below is INTENT. The motor owns the physics: see
    // src/player/motor.js for the accel model, collision sweep and step logic.
    // `stunned` gates everything; `rooted` only pins your feet, so a booked
    // meeting still lets you shoot your way out of it.
    const stunned = this.stunT > 0;
    const rooted = stunned || this.bookedT > 0;
    let ix = 0, iz = 0;
    if (!rooted) {
      if (input.isDown('KeyW')) iz += 1;
      if (input.isDown('KeyS')) iz -= 1;
      if (input.isDown('KeyA')) ix -= 1;
      if (input.isDown('KeyD')) ix += 1;
    }

    const sprinting = !rooted && input.isDown('ShiftLeft') && iz > 0 && this.slideT <= 0 && !this.blocking;
    let speedCap = this.stats.moveSpeed * (sprinting ? this.stats.sprintMult : 1);
    if (this.blocking) speedCap *= 0.55;
    if (this.slowT > 0) speedCap *= 0.55;
    if (this.shockT > 0) speedCap *= 0.8;
    if (this.tether) speedCap *= 0.7;
    speedCap *= 1 - this.crowdDrag;

    // Dash stays live through a stun on purpose — it is the panic button, the
    // tether cutter and the only early exit from a meeting. It costs a 3.6s
    // cooldown, so spending it is a real decision. Shock is what takes it away.
    const wantDash = input.pressed('KeyQ') && this.shockT <= 0;
    this.motor.knockbackResist = this.stats.knockbackResist ?? 0;
    this.motor.setIntent({
      moveX: ix, moveZ: iz, yaw: this.yaw,
      sprint: sprinting,
      jump: !rooted && input.pressed('Space'),
      // you cannot slide on a chair — you are already sliding
      slide: !rooted && !this.classDef.mount && (input.pressed('ControlLeft') || input.pressed('KeyC')),
      dash: wantDash,
      speedCap,
      dashCd: this.stats.dashCd,
      canAct: !this.dead,
    });
    this.motor.update(dt);

    // footsteps
    const hSpeed = this.motor.speed;
    if (this.onGround && hSpeed > 2) {
      this.stepT -= dt * hSpeed;
      if (this.stepT <= 0) { this.stepT = 2.6; game.audio.sfx('ui', { vol: 0.25 }); }
    }

    // procedural landing compression — decays into the camera/weapon rigs
    if (this.landDip > 0) this.landDip = Math.max(0, this.landDip - dt * 1.6);

    // ---- abilities ----
    const cls = this.classDef;
    this.blocking = !!cls.secondary.hold && input.mouse(2) && !this.dead;

    // reload & heat management
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        this.ammo = cls.primary.mag;
        game.audio.sfx('chest', { vol: 0.5 });
      }
    }
    if (input.pressed('KeyR') && cls.primary.mag && this.ammo < cls.primary.mag && this.reloadT <= 0) {
      this.startReload();
    }
    if (cls.primary.heat) {
      this.overheatLock = Math.max(0, this.overheatLock - dt);
      if (!input.mouse(0) || this.overheatLock > 0) this.heatGauge = Math.max(0, this.heatGauge - dt * 0.55);
    }

    const canFire = this.reloadT <= 0
      && !stunned
      && (!cls.primary.mag || this.ammo > 0)
      && (!cls.primary.heat || this.overheatLock <= 0);

    // ---- charged primaries (THE ANALYST) ----
    // Hold to wind up, release to fire. The wind-up is the aim time and the
    // whole skill demand: you may walk while charging, but you have to commit
    // to a firing line long enough to fill the bar. Letting go early still
    // fires — a panic shot that does almost nothing is a better teacher than
    // an input that silently does nothing at all.
    let firedCharge = null;
    if (cls.primary.charge) {
      const holding = input.mouse(0) && !this.blocking && input.locked && canFire;
      if (holding) {
        this.chargeAmt = Math.min(1, this.chargeAmt + dt / cls.primary.charge);
      } else if (this.chargeAmt > 0) {
        firedCharge = this.chargeAmt;
        this.chargeAmt = 0;
      }
      // an interrupt (stun, reload, empty mag) drops the shot rather than
      // banking it — otherwise a stun would hand you a free full charge
      if (!canFire || stunned) { this.chargeAmt = 0; firedCharge = null; }
    }

    const wantsPrimary = cls.primary.charge ? firedCharge !== null : input.mouse(0);
    if (wantsPrimary && this.primaryCd <= 0 && !this.blocking && input.locked && canFire) {
      const aim = this.aimData();
      if (cls.primary.fire(game, this, aim, firedCharge ?? 1)) {
        this.primaryCd = cls.primary.cd * this.stats.atkCdMult;
        this.attackAnimT = Math.max(this.attackAnimT, 0.16);
        this.recoilT = 1;
        if (cls.primary.mag) {
          this.ammo--;
          if (this.ammo <= 0) this.startReload();
        }
        if (cls.primary.heat) {
          this.heatGauge += 0.032;
          if (this.heatGauge >= 1) {
            this.heatGauge = 1;
            this.overheatLock = 1.8;
            game.audio.sfx('spit', { vol: 0.8 });
            game.effects.burst(this.muzzleWorldFx(), { color: 0xff7b2d, n: 10, speed: 3, ttl: 0.5 });
            game.hud.toast(cls.primary.overheatMsg ?? '🔥 ROUTER OVERHEATED — REBOOTING', 'warn');
          }
        }
        if (!cls.primary.beam) game.effects.burst(this.muzzleWorldFx(), { color: 0xfff2b0, n: 2, speed: 1.2, size: 0.05, ttl: 0.12, gravity: 0 });
        game.net?.sendAction({ a: 'fire' });
      }
    }

    // throwable (G) & consumable (F) — both are "systems", both go down to shock
    const abilitiesOnline = this.shockT <= 0 && !stunned;
    if (input.pressed('KeyG') && this.throwable?.count > 0 && input.locked) {
      if (abilitiesOnline) game.throwGrenade(this, this.aimData());
      else this.systemsOfflineFeedback();
    }
    if (input.pressed('KeyF') && this.consumables.length > 0) {
      if (abilitiesOnline) game.useConsumable(this, 0);
      else this.systemsOfflineFeedback();
    }
    // sandwich heal-over-time
    if (this.hotT > 0) {
      this.hotT -= dt;
      this.heal(this.hotRate * dt, true);
    }
    if (!cls.secondary.hold && (input.mouseClicked(2)) && this.secondaryCd <= 0 && input.locked) {
      if (!abilitiesOnline) {
        this.systemsOfflineFeedback();
      } else {
        const aim = this.aimData();
        if (cls.secondary.use(game, this, aim)) {
          this.secondaryCd = cls.secondary.cd;
          this.attackAnimT = Math.max(this.attackAnimT, 0.25);
        }
      }
    }

    // SPECIAL module (X) — the loot-filled slot, same offline rules as the rest
    if (input.pressed('KeyX') && this.modules.special && this.specialCd <= 0 && input.locked) {
      if (!abilitiesOnline) {
        this.systemsOfflineFeedback();
      } else {
        const mod = this.modules.special;
        const def = MODULE_BY_ID[mod.id];
        if (def?.use(game, this, this.aimData(), mod)) {
          this.specialCd = this.specialCooldown();
          this.attackAnimT = Math.max(this.attackAnimT, 0.25);
          game.telemetry?.moduleUsed?.(mod.id, game.runTime);
        }
      }
    }

    // interact
    game.checkInteract(this, input.pressed('KeyE'));
    game.hud.setStatuses(this.statusList());

    // slow zones (mandatory meeting affects enemies; complainer goo affects player via hazards)
    // handled in game.update

    this.updateVisual(dt, hSpeed, sprinting);
  }

  updateVisual(dt, hSpeed, sprinting) {
    const game = this.game;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;

    const inFp = this.camBlend < 0.35;
    this.mesh.visible = !inFp && !this.cameraOccluded;
    this.viewmodel.visible = inFp && !this.dead;

    if (!inFp) {
      const t = game.runTime;
      const onChair = !!this.chair;
      if (onChair) {
        // seated: legs stay tucked, the CHAIR does the moving
        this.updateChair(dt, hSpeed);
      } else if (hSpeed > 0.6) {
        animateWalk(this.parts, t, hSpeed / (this.stats.moveSpeed * this.stats.sprintMult));
      } else poseIdle(this.parts, t);
      // aim arm
      const aimUp = -0.35 - this.pitch * 0.6;
      if (this.classKey === 'janitor') {
        this.parts.armR.rotation.x = this.attackAnimT > 0 ? -2.2 + (0.28 - this.attackAnimT) * 8 : -0.5;
        this.parts.armL.rotation.x = this.blocking ? -1.5 : -0.15;
        if (this.offhandItem) this.offhandItem.rotation.x = this.blocking ? 0.5 : 0;
      } else if (this.classDef.gloves) {
        // boxer's guard: hands up, and the swing alternates sides
        const swing = this.attackAnimT > 0 ? (0.26 - this.attackAnimT) * 9 : 0;
        const lead = this.swingSide > 0 ? 'armR' : 'armL';
        const off = this.swingSide > 0 ? 'armL' : 'armR';
        this.parts[lead].rotation.x = this.attackAnimT > 0 ? -1.9 + swing : -1.35;
        this.parts[off].rotation.x = -1.5;
        this.parts.armL.rotation.z = 0.28;
        this.parts.armR.rotation.z = -0.28;
      } else {
        this.parts.armR.rotation.x = this.attackAnimT > 0 ? -1.45 + this.recoilT * 0.12 : aimUp - 0.9;
        this.parts.armR.rotation.z = -0.08;
      }
      this.parts.head.rotation.x = -this.pitch * 0.5;
      // slide pose
      this.mesh.scale.y = this.slideT > 0 ? 0.62 : 1;
    }

    // viewmodel bob & recoil
    if (inFp) {
      const bob = Math.sin(game.runTime * 9) * Math.min(1, hSpeed / 7) * 0.02;
      this.viewmodel.position.set(
        0.44 + Math.cos(game.runTime * 4.5) * Math.min(1, hSpeed / 7) * 0.008,
        -0.42 + bob,
        -0.78 + this.recoilT * 0.09
      );
      this.viewmodel.rotation.x = this.recoilT * 0.14 + (this.blocking ? 0 : 0);
      if (this.vmOffhand) {
        // raise lid to center while blocking
        this.vmOffhand.position.lerp(_v1.set(this.blocking ? -0.35 : -0.75, this.blocking ? -0.28 : -0.05, this.blocking ? -0.35 : 0.15), 1 - Math.exp(-14 * dt));
      }
    }
  }

  /**
   * The chair sells the whole class. Casters spin with ground speed, the seat
   * leans into the turn, and the base yaws behind the direction of travel so
   * hard turns visibly drift instead of pivoting on the spot.
   */
  updateChair(dt, hSpeed) {
    const c = this.chair;
    const { swivel, spider, casters } = c.userData;
    // legs stay tucked whatever the locomotion code wanted
    this.parts.legL.rotation.x = -1.35 + Math.sin(this.game.runTime * 6) * 0.05;
    this.parts.legR.rotation.x = -1.35 - Math.sin(this.game.runTime * 6) * 0.05;
    this.parts.torso.position.y = (this.parts.baseTorsoY ?? 0.86) + Math.sin(this.game.runTime * 7) * 0.01 * Math.min(1, hSpeed / 6);

    const spin = hSpeed * dt * 5;
    for (const w of casters) w.rotation.x += spin;

    // travel direction vs facing → drift angle
    const moveYaw = (Math.abs(this.vel.x) + Math.abs(this.vel.z)) > 0.6
      ? Math.atan2(this.vel.x, this.vel.z) : this.yaw;
    let drift = moveYaw - this.yaw;
    while (drift > Math.PI) drift -= Math.PI * 2;
    while (drift < -Math.PI) drift += Math.PI * 2;
    this.chairSpin = damp(this.chairSpin, drift, 6, dt);
    spider.rotation.y = this.chairSpin;
    swivel.rotation.z = damp(swivel.rotation.z, clamp(-this.chairSpin * 0.35, -0.3, 0.3), 8, dt);
    // boosting: the whole rig tips back
    swivel.rotation.x = damp(swivel.rotation.x, this.boostT > 0 ? -0.22 : 0, 9, dt);
    c.position.y = this.boostT > 0 ? 0.1 : 0;
  }

  updateCamera(dt) {
    const game = this.game;
    const cam = game.camera;
    const eye = _v1.set(this.pos.x, this.pos.y + this.eyeY, this.pos.z);

    // build orientation
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw + Math.PI, 0, 'YXZ'));

    if (this.camBlend < 0.001) {
      cam.position.copy(eye);
      cam.quaternion.copy(q);
    } else {
      // third-person: orbit behind
      const back = _v2.set(0, 0, 1).applyQuaternion(q); // camera looks -z; +z is behind
      const side = _v3.set(1, 0, 0).applyQuaternion(q);
      // Wide bodies need more room or they eat the frame — the Facilities Guy
      // is nearly twice the Intern's chest width and was blocking his own aim.
      const bulk = (this.parts.build?.chestW ?? 0.66) / 0.66;
      const dist = 4.6 * (1 + (bulk - 1) * 0.85) * this.camBlend;
      const desired = eye.clone()
        .addScaledVector(back, dist)
        .addScaledVector(side, 0.7 * this.camBlend)
        .addScaledVector(UP, 0.35 * this.camBlend);
      // Exact wall collision. The old ten-sample march could miss thin walls and
      // its forced minimum placed the camera inside the avatar (or through a wall)
      // when the player backed into one.
      const cameraDir = _v4.copy(desired).sub(eye);
      const wantedDist = cameraDir.length();
      cameraDir.divideScalar(wantedDist);
      const cameraDist = game.bvh?.cameraDistance(eye, cameraDir, wantedDist) ?? wantedDist;
      cam.position.copy(eye).addScaledVector(cameraDir, cameraDist);

      const blocked = cameraDist < wantedDist - 1e-3;
      const hideAt = this.cameraOccluded ? CAMERA_SHOW_DIST : CAMERA_HIDE_DIST;
      this.cameraOccluded = blocked && cameraDist < hideAt;
      // In a gap narrower than the avatar there is nowhere to place a third-
      // person camera. Keep the safe camera position and remove the local body
      // from the render so the back of its head cannot cover the screen.
      this.mesh.visible = !this.dead && this.camBlend >= 0.35 && !this.cameraOccluded;
      // rooms have real ceilings now — keep the camera under them
      if (game.level && !game.level.def.isFinal) {
        cam.position.y = Math.min(cam.position.y, CEIL_H - 0.25);
      }
      cam.quaternion.copy(q);
    }

    // shake
    if (game.camShakeAmt > 0.001) {
      cam.position.x += (Math.random() - 0.5) * game.camShakeAmt * 0.5;
      cam.position.y += (Math.random() - 0.5) * game.camShakeAmt * 0.5;
      cam.position.z += (Math.random() - 0.5) * game.camShakeAmt * 0.5;
    }
    // being held in a meeting nudges the camera — you are fidgeting
    if (this.bookedT > 0) {
      cam.position.x += Math.sin(game.runTime * 18) * 0.02;
      cam.position.y += Math.cos(game.runTime * 15) * 0.02;
    }
  }

  serializeState() {
    return {
      x: +this.pos.x.toFixed(2), y: +this.pos.y.toFixed(2), z: +this.pos.z.toFixed(2),
      yaw: +this.yaw.toFixed(2), pitch: +this.pitch.toFixed(2),
      hp: Math.round(this.hp), maxHp: Math.round(this.stats.maxHp),
      cls: this.classKey, name: this.name, dead: this.dead, lvl: this.level,
      // what you're wearing, so teammates can see it. Compact and only the
      // fields the visual builder actually reads.
      gear: this.gearFingerprint(),
    };
  }

  gearFingerprint() {
    const out = [];
    for (const g of Object.values(this.gearSlots)) {
      if (g?.visual) out.push([g.visual, g.rarity, g.color]);
    }
    return out;
  }

  dispose() {
    this.game.scene.remove(this.mesh);
    this.game.camera.remove(this.viewmodel);
  }
}

// ============ remote co-op teammate (render puppet) ============
export class RemotePlayer {
  constructor(game, id, state) {
    this.game = game;
    this.id = id;
    this.name = state.name || 'COWORKER';
    this.classKey = state.cls || 'intern';
    this.dead = !!state.dead;
    this.hp = state.hp ?? 100;
    this.maxHp = state.maxHp ?? 100;
    this.pos = new THREE.Vector3(state.x || 0, state.y || 0, state.z || 0);
    this.radius = 0.45;
    this.buffer = [];      // interpolation snapshots {t, x,y,z,yaw}
    this.yaw = state.yaw || 0;
    // Derived from the interpolated motion each frame. Bosses read teammate
    // velocity to LEAD their shots (bosses.js atkColdCall); without it the lead
    // term is undefined and the prediction lands on NaN, so bosses fire at the
    // world origin instead of at the teammate.
    this.vel = new THREE.Vector3();
    // Status fields the enemy roster writes onto whatever it hits. Declared so
    // an enemy write never silently creates a property on the wrong shape, and
    // so `(t.gooT ?? 0) > 0` in pickTarget reads a real value.
    this.gooT = 0;
    this.slowT = 0;
    this.gooResist = false;
    this.tether = null;
    this.meetingT = 0;
    this.meetingBy = null;
    this.bookedT = 0;

    const def = CLASS_BY_KEY[this.classKey] ?? CLASS_BY_KEY.intern;
    const person = makePerson({
      skin: def.look.skin ?? 0xE8B89B, shirt: def.look.shirt, pants: def.look.pants, tie: def.look.tie,
      accessories: def.look.accessories, hair: def.look.hair ?? 0x3a2a1a, build: def.look.build ?? 'normal',
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
    if (def.mount === 'chair') {
      this.chair = makeChairMount(def.look.chairColor ?? 0xff4fa3);
      this.mesh.add(this.chair);
      this.body.position.y = 0.5;
      this.parts.legL.rotation.x = -1.35;
      this.parts.legR.rotation.x = -1.35;
    }
    this.gearMeshes = [];
    this.gearKey = '';
    game.scene.add(this.mesh);

    // floating nameplate
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const g = canvas.getContext('2d');
    g.font = '700 30px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(this.name, 128, 32);
    g.fillStyle = '#9fd8ff'; g.fillText(this.name, 128, 32);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.plate = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    this.plate.scale.set(2, 0.5, 1);
    this.plate.position.y = 2.5;
    this.mesh.add(this.plate);
  }

  get centerPos() { return _v3.set(this.pos.x, this.pos.y + 1.0, this.pos.z); }

  // ---- combat verbs ----
  // These are NOT optional. `pickTarget()` selects from livePlayers(), which
  // includes remote teammates, and roughly seventeen call sites across
  // enemies.js and bosses.js then call `target.damage(...)` with no guard. A
  // RemotePlayer without this method throws TypeError inside the enemy update
  // loop the first time any enemy melees a human teammate — a hard crash in real
  // co-op. It survived testing only because spawns anchor to game.player
  // (director.js pickSpawnPos) and targeting is nearest, so on the host the
  // local player is *usually* nearest. Usually is not always.
  //
  // Authority: a remote player's HP belongs to THEIR client. The host must not
  // mutate it locally — it relays, and the owning client applies it. That is the
  // same path game.explode() already uses for area damage.

  /** @param {number} amount @param {THREE.Vector3|null} source @param {object} opts */
  damage(amount, source = null, _opts = {}) {
    if (this.dead || !(amount > 0)) return;
    const net = this.game.net;
    if (net?.connected && net.isHost) {
      net.sendEvent({ k: 'pdmg', v: amount, x: source?.x ?? this.pos.x, z: source?.z ?? this.pos.z }, this.id);
    }
    // No local HP write: the authoritative value arrives back in the next
    // pstate snapshot. Writing here would fight that and make the health bar
    // flicker between the predicted and the real value.
  }

  applyStun(dur, fromPos = null) {
    const net = this.game.net;
    if (net?.connected && net.isHost) {
      net.sendEvent({ k: 'pstun', v: dur, x: fromPos?.x ?? this.pos.x, z: fromPos?.z ?? this.pos.z }, this.id);
    }
  }

  applyShock(dur) {
    const net = this.game.net;
    if (net?.connected && net.isHost) net.sendEvent({ k: 'pshock', v: dur }, this.id);
  }

  heal() { /* owned by their client; nothing to do here */ }

  pushState(s, now) {
    this.buffer.push({ t: now, x: s.x, y: s.y, z: s.z, yaw: s.yaw });
    if (this.buffer.length > 20) this.buffer.shift();
    this.hp = s.hp; this.maxHp = s.maxHp; this.dead = s.dead;
    // rebuild the wardrobe only when it actually changed — this arrives at the
    // snapshot rate and rebuilding meshes 20×/s per teammate would be absurd
    if (s.gear) {
      const key = JSON.stringify(s.gear);
      if (key !== this.gearKey) {
        this.gearKey = key;
        for (const m of this.gearMeshes) m.parent?.remove(m);
        this.gearMeshes = attachGearTo(this.parts,
          s.gear.map(([visual, rarity, color]) => ({ visual, rarity, color })));
      }
    }
  }

  update(dt, now) {
    // render 120ms in the past for smooth interp
    const renderT = now - 0.12;
    const buf = this.buffer;
    let a = null, b = null;
    for (let i = 0; i < buf.length - 1; i++) {
      if (buf[i].t <= renderT && buf[i + 1].t >= renderT) { a = buf[i]; b = buf[i + 1]; break; }
    }
    let tx, ty, tz, tyaw;
    if (a && b) {
      const k = (renderT - a.t) / Math.max(0.001, b.t - a.t);
      tx = lerp(a.x, b.x, k); ty = lerp(a.y, b.y, k); tz = lerp(a.z, b.z, k);
      tyaw = a.yaw + (b.yaw - a.yaw) * k;
    } else if (buf.length) {
      const last = buf[buf.length - 1];
      tx = last.x; ty = last.y; tz = last.z; tyaw = last.yaw;
    } else return;
    const prevX = this.pos.x, prevZ = this.pos.z;
    const prevY = this.pos.y;
    this.pos.set(tx, ty, tz);
    const invDt = 1 / Math.max(dt, 0.001);
    this.vel.set((tx - prevX) * invDt, (ty - prevY) * invDt, (tz - prevZ) * invDt);
    this.yaw = tyaw;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    const speed = Math.hypot(tx - prevX, tz - prevZ) / Math.max(dt, 0.001);
    if (this.chair) {
      // seated teammates keep their legs tucked; the casters carry the motion
      this.parts.legL.rotation.x = -1.35;
      this.parts.legR.rotation.x = -1.35;
      for (const wh of this.chair.userData.casters) wh.rotation.x += speed * dt * 5;
    } else if (speed > 0.6) animateWalk(this.parts, now, Math.min(1, speed / 8));
    else poseIdle(this.parts, now);
    this.mesh.visible = !this.dead;
  }

  dispose() {
    this.game.scene.remove(this.mesh);
  }
}
