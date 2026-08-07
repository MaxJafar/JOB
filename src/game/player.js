// ============ local player: movement, camera rig, combat ============
import * as THREE from 'three';
import { TUNE } from './config.js';
import { CEIL_H } from './level.js';
import { CLASS_BY_KEY } from './classes.js';
import { makePerson, makeHeldItem, animateWalk, poseIdle } from './characters.js';
import { box, cyl } from './props.js';
import { computeItemMods } from './items.js';
import { upgradeMods } from './upgrades.js';
import { clamp, lerp, damp, chance, dist2D } from '../core/utils.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Player {
  constructor(game, classKey, name = 'YOU') {
    this.game = game;
    this.id = 'local';
    this.name = name;
    this.classDef = CLASS_BY_KEY[classKey];
    this.classKey = classKey;

    this.pos = new THREE.Vector3(0, 0, 10);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI;                // face -z... adjusted at spawn
    this.pitch = -0.08;
    this.radius = 0.45;
    this.onGround = true;
    this.coyote = 0;
    this.jumpBuffer = 0;
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
    this.momentumT = 0;
    this.hydratedThisFloor = false;
    this.kills = 0;
    // pockets & wardrobe
    this.ammo = CLASS_BY_KEY[classKey].primary.mag ?? Infinity;
    this.reloadT = 0;
    this.heatGauge = 0;        // IT overheat 0..1
    this.overheatLock = 0;
    this.throwable = null;     // {id, count}
    this.consumables = [];     // [{id}] max 2
    this.gearSlots = { head: null, body: null, trinket: null };
    this.gearBag = [];         // unequipped wearables, max 6
    this.gearMeshes = [];      // attached visual meshes
    this.hotT = 0;             // sandwich heal-over-time
    this.hotRate = 0;
    this.primaryCd = 0;
    this.secondaryCd = 0;
    this.dashCd = 0;
    this.dashT = 0;
    this.iframes = 0;
    this.slideT = 0;
    this.blocking = false;
    this.attackAnimT = 0;
    this.swingSide = 1;
    this.recoilT = 0;
    this.espresso = { t: 0, stacks: 0 };
    this.gooT = 0;
    this.slowT = 0;
    this.latch = null;      // micromanager enemy latched on
    this.latchMash = 0;
    this.parachuteUsed = false;
    this.hurtFlash = 0;
    this.beamSfxT = 0;
    this.stepT = 0;

    this.camMode = 'tp';    // 'fp' | 'tp'
    this.camBlend = 1;      // 0 = fp, 1 = tp

    this.recomputeStats();
    this.hp = this.stats.maxHp;

    // ---- character mesh ----
    const look = this.classDef.look;
    const person = makePerson({
      model: this.classDef.model,
      skin: 0xE8B89B, shirt: look.shirt, pants: look.pants, tie: look.tie,
      hair: look.hair ?? 0x3a2a1a, accessories: look.accessories,
    });
    this.mesh = person.root;
    this.parts = person.parts;
    this.heldItem = makeHeldItem(this.classDef.weapon);
    this.parts.grip.add(this.heldItem);
    if (this.classDef.offhand) {
      this.offhandItem = makeHeldItem(this.classDef.offhand);
      this.parts.gripL.add(this.offhandItem);
    }
    game.scene.add(this.mesh);

    // ---- first-person viewmodel ----
    this.viewmodel = new THREE.Group();
    const vmWeapon = makeHeldItem(this.classDef.weapon);
    vmWeapon.scale.setScalar(1.15);
    this.vmWeapon = vmWeapon;
    this.viewmodel.add(vmWeapon);
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
    this.stats = {
      maxHp: (c.hp * lvlHp * meta.hpMult + mods.maxHpBonus + ups.maxHpBonus + gear.maxHpBonus) * mods.hpMult,
      damage: c.damage * lvlDmg * mods.damageMult * ups.damageMult * (1 + gear.damageMult) * meta.dmgMult,
      flatDamage: mods.flatDamage,
      atkCdMult: 1 / (mods.atkSpeedMult * ups.atkSpeedMult * hasteStacks),
      moveSpeed: c.speed * mods.moveMult * ups.moveMult * (1 + gear.moveMult) * meta.speedMult
        * (this.espresso.stacks > 0 ? 1 + 0.08 * this.espresso.stacks : 1)
        * (this.coffeeBuffT > 0 ? 1.12 : 1) * (1 + comboBonus * 0.6),
      sprintMult: TUNE.sprintMult * (c.sprintBonus ?? 1),
      critChance: TUNE.baseCrit + mods.critChance + ups.critChance + gear.critChance,
      critDamageBonus: ups.critDamageBonus ?? 0,
      regen: mods.regen + ups.regen + gear.regen + (c.regenBonus ?? 0) + meta.regen,
      moneyMult: mods.moneyMult * (c.moneyBonus ?? 1) * (1 + gear.moneyMult) * meta.moneyMult,
      xpMult: mods.xpMult * ups.xpMult * (1 + gear.xpMult) * (c.xpBonus ?? 1),
      dashCd: TUNE.dashCd * mods.dashCdMult * ups.dashCdMult,
      damageTakenMult: (c.damageTakenMult ?? 1) * (1 + gear.damageTakenMult),
      bleedChance: mods.bleedChance, bleedPower: mods.bleedPower,
      chainChance: mods.chainChance, chainCount: mods.chainCount,
      critExplode: mods.critExplode, critExplodePower: mods.critExplodePower,
      parachute: mods.parachute,
      espresso: mods.espresso,
      cryptoPortfolio: mods.cryptoPortfolio,
    };
    if (this.hp !== undefined) this.hp = Math.min(this.hp, this.stats.maxHp);
  }

  applyUpgrade(up) {
    this.upgrades.set(up.id, (this.upgrades.get(up.id) || 0) + 1);
    if (up.id === 'insurance') this.heal(this.stats.maxHp * 0.5);
    this.recomputeStats();
    this.game.hud.renderItems(this.items, this.upgrades);
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
    this.game.hud.renderItems(this.items, this.upgrades);
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
      this.hp = 0;
      this.die();
    }
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.detachLatch(false);
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
  coneHit({ range, arcDeg }) {
    const out = [];
    const fwd = _v1.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const cosA = Math.cos((arcDeg / 2) * Math.PI / 180);
    for (const e of this.game.enemies) {
      if (e.dead) continue;
      const d = dist2D(e.pos, this.pos);
      if (d > range + e.radius) continue;
      const to = _v2.set(e.pos.x - this.pos.x, 0, e.pos.z - this.pos.z).normalize();
      if (d < 1.2 || fwd.dot(to) > cosA) out.push(e);
    }
    return out;
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

  refreshGearVisuals() {
    // strip previous gear meshes, then attach current
    for (const m of this.gearMeshes) m.parent?.remove(m);
    this.gearMeshes.length = 0;
    const P = this.parts;
    const attach = (mesh, parent) => { parent.add(mesh); this.gearMeshes.push(mesh); };
    for (const g of Object.values(this.gearSlots)) {
      if (!g || !g.visual) continue;
      switch (g.visual) {
        case 'hardhat': {
          const hat = cyl(0.26, 0.3, 0.18, 0xffd23f, 8, { rough: 0.5 });
          hat.position.y = 0.52;
          attach(hat, P.head);
          break;
        }
        case 'propcap': {
          const cap = cyl(0.24, 0.26, 0.12, 0xc0392b, 8);
          cap.position.y = 0.5;
          const prop = box(0.4, 0.02, 0.05, 0x38e1ff);
          prop.position.y = 0.6;
          attach(cap, P.head);
          attach(prop, P.head);
          break;
        }
        case 'headphones': {
          const band = box(0.48, 0.05, 0.05, 0x222833);
          band.position.y = 0.48;
          attach(band, P.head);
          for (const s of [-1, 1]) {
            const cup = box(0.07, 0.16, 0.14, 0xff4fa3);
            cup.position.set(s * 0.25, 0.26, 0);
            attach(cup, P.head);
          }
          break;
        }
        case 'crown': {
          const cr = cyl(0.24, 0.28, 0.16, 0xd4aa30, 6, { metal: 0.8, rough: 0.3, emissive: 0x6b5210, emissiveIntensity: 0.5 });
          cr.position.y = 0.54;
          attach(cr, P.head);
          break;
        }
        case 'vest': {
          const v = box(0.72, 0.6, 0.46, 0xff9b2d, { emissive: 0x7a4a12, emissiveIntensity: 0.5 });
          v.position.y = 0.35;
          attach(v, P.torso);
          break;
        }
        case 'blazer': {
          const b = box(0.74, 0.68, 0.46, 0x1d222b, { rough: 0.6 });
          b.position.y = 0.34;
          attach(b, P.torso);
          break;
        }
        case 'apron': {
          const a = box(0.6, 0.7, 0.03, 0x6b4a33);
          a.position.set(0, 0.3, 0.23);
          attach(a, P.torso);
          break;
        }
        case 'watch': {
          const w = box(0.1, 0.06, 0.12, 0xd4aa30, { metal: 0.8, rough: 0.3 });
          w.position.set(0, -0.5, 0);
          attach(w, P.armL);
          break;
        }
      }
    }
    this.gearMeshes.forEach((m) => m.traverse?.((o) => { if (o.isMesh) o.castShadow = true; }));
  }

  detachLatch(hurtEnemy = true) {
    if (!this.latch) return;
    const mm = this.latch;
    this.latch = null;
    this.latchMash = 0;
    this.game.hud.setLatch(false);
    if (mm && !mm.dead) mm.onDetached(hurtEnemy);
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
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.iframes = Math.max(0, this.iframes - dt);
    this.attackAnimT = Math.max(0, this.attackAnimT - dt);
    this.recoilT = Math.max(0, this.recoilT - dt * 5);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.gooT = Math.max(0, this.gooT - dt);
    this.slowT = Math.max(0, this.slowT - dt);
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
    const fwdX = Math.sin(this.yaw), fwdZ = Math.cos(this.yaw);
    const rightX = Math.sin(this.yaw - Math.PI / 2), rightZ = Math.cos(this.yaw - Math.PI / 2);
    let ix = 0, iz = 0;
    if (input.isDown('KeyW')) iz += 1;
    if (input.isDown('KeyS')) iz -= 1;
    if (input.isDown('KeyA')) ix -= 1;
    if (input.isDown('KeyD')) ix += 1;
    const moving = ix !== 0 || iz !== 0;
    let wishX = 0, wishZ = 0;
    if (moving) {
      const il = Math.hypot(ix, iz);
      wishX = (fwdX * iz + rightX * ix) / il;
      wishZ = (fwdZ * iz + rightZ * ix) / il;
    }

    const sprinting = input.isDown('ShiftLeft') && iz > 0 && this.slideT <= 0 && !this.blocking;
    let speedCap = this.stats.moveSpeed * (sprinting ? this.stats.sprintMult : 1);
    if (this.blocking) speedCap *= 0.55;
    if (this.latch) speedCap *= 0.5;
    if (this.slowT > 0) speedCap *= 0.55;

    // slide
    if (this.slideT > 0) {
      this.slideT -= dt;
      const fr = 1.8;
      this.vel.x -= this.vel.x * fr * dt;
      this.vel.z -= this.vel.z * fr * dt;
    } else if ((input.pressed('ControlLeft') || input.pressed('KeyC')) && sprinting && this.onGround) {
      this.slideT = TUNE.slideTime;
      const boost = speedCap * TUNE.slideBoost;
      this.vel.x = wishX * boost || fwdX * boost;
      this.vel.z = wishZ * boost || fwdZ * boost;
      game.audio.sfx('slide');
    }

    // dash
    if (input.pressed('KeyQ') && this.dashCd <= 0 && this.dashT <= 0) {
      this.dashT = TUNE.dashTime;
      this.dashCd = this.stats.dashCd;
      this.iframes = Math.max(this.iframes, TUNE.dashIFrames);
      const dx = moving ? wishX : fwdX, dz = moving ? wishZ : fwdZ;
      this.vel.x = dx * TUNE.dashSpeed;
      this.vel.z = dz * TUNE.dashSpeed;
      game.audio.sfx('dash');
      game.effects.burst(this.pos.clone().setY(0.4), { color: 0xffffff, n: 8, speed: 3, size: 0.09, ttl: 0.3 });
      this.detachLatch(true); // dashing shakes off the micromanager
    }
    if (this.dashT > 0) {
      this.dashT -= dt;
    } else if (this.slideT <= 0) {
      // normal accel / friction
      const accel = this.onGround ? TUNE.groundAccel : TUNE.airAccel;
      if (moving) {
        this.vel.x += wishX * accel * dt;
        this.vel.z += wishZ * accel * dt;
      }
      const fr = this.onGround ? TUNE.groundFriction : 0.4;
      if (!moving || Math.hypot(this.vel.x, this.vel.z) > speedCap) {
        this.vel.x -= this.vel.x * Math.min(1, fr * dt);
        this.vel.z -= this.vel.z * Math.min(1, fr * dt);
      }
      const hv = Math.hypot(this.vel.x, this.vel.z);
      if (hv > speedCap && this.dashT <= 0 && this.momentumT <= 0) {
        this.vel.x = (this.vel.x / hv) * speedCap;
        this.vel.z = (this.vel.z / hv) * speedCap;
      }
    }
    this.momentumT = Math.max(0, this.momentumT - dt);

    // jump
    this.coyote = this.onGround ? TUNE.coyoteTime : Math.max(0, this.coyote - dt);
    this.jumpBuffer = input.pressed('Space') ? TUNE.jumpBuffer : Math.max(0, this.jumpBuffer - dt);
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.vel.y = TUNE.playerJump;
      // slide-jump: cash in the slide for a burst of momentum (skill tech)
      if (this.slideT > 0) {
        this.vel.x *= TUNE.slideJumpBoost;
        this.vel.z *= TUNE.slideJumpBoost;
        this.momentumT = TUNE.momentumTime;
        game.effects.ring(this.pos, { color: 0xffffff, r1: 1.6, dur: 0.3, opacity: 0.4 });
      }
      this.onGround = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.slideT = 0;
      game.audio.sfx('jump');
    }
    // latch mash
    if (this.latch && input.pressed('Space')) {
      this.latchMash++;
      game.shake(0.15);
      if (this.latchMash >= 5) this.detachLatch(true);
    }

    this.vel.y -= TUNE.gravity * dt;
    this.pos.addScaledVector(this.vel, dt);
    if (this.pos.y <= 0) { this.pos.y = 0; this.vel.y = 0; this.onGround = true; }
    else this.onGround = false;
    game.level.collideCircle(this.pos, this.radius, this.pos.y, 1.8);

    // footsteps
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hSpeed > 2) {
      this.stepT -= dt * hSpeed;
      if (this.stepT <= 0) { this.stepT = 2.6; game.audio.sfx('ui', { vol: 0.25 }); }
    }

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
      && (!cls.primary.mag || this.ammo > 0)
      && (!cls.primary.heat || this.overheatLock <= 0);

    if (input.mouse(0) && this.primaryCd <= 0 && !this.blocking && input.locked && canFire) {
      const aim = this.aimData();
      if (cls.primary.fire(game, this, aim)) {
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
            game.hud.toast('🔥 ROUTER OVERHEATED — REBOOTING', 'warn');
          }
        }
        if (!cls.primary.beam) game.effects.burst(this.muzzleWorldFx(), { color: 0xfff2b0, n: 2, speed: 1.2, size: 0.05, ttl: 0.12, gravity: 0 });
        game.net?.sendAction({ a: 'fire' });
      }
    }

    // throwable (G) & consumable (F)
    if (input.pressed('KeyG') && this.throwable?.count > 0 && input.locked) {
      game.throwGrenade(this, this.aimData());
    }
    if (input.pressed('KeyF') && this.consumables.length > 0) {
      game.useConsumable(this, 0);
    }
    // sandwich heal-over-time
    if (this.hotT > 0) {
      this.hotT -= dt;
      this.heal(this.hotRate * dt, true);
    }
    if (!cls.secondary.hold && (input.mouseClicked(2)) && this.secondaryCd <= 0 && input.locked) {
      const aim = this.aimData();
      if (cls.secondary.use(game, this, aim)) {
        this.secondaryCd = cls.secondary.cd;
        this.attackAnimT = Math.max(this.attackAnimT, 0.25);
      }
    }

    // interact
    game.checkInteract(this, input.pressed('KeyE'));

    // slow zones (mandatory meeting affects enemies; complainer goo affects player via hazards)
    // handled in game.update

    this.updateVisual(dt, hSpeed, sprinting);
  }

  updateVisual(dt, hSpeed, sprinting) {
    const game = this.game;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;

    const inFp = this.camBlend < 0.35;
    this.mesh.visible = !inFp;
    this.viewmodel.visible = inFp && !this.dead;

    if (!inFp) {
      const t = game.runTime;
      if (hSpeed > 0.6) animateWalk(this.parts, t, hSpeed / (this.stats.moveSpeed * this.stats.sprintMult));
      else poseIdle(this.parts, t);
      // aim arm
      const aimUp = -0.35 - this.pitch * 0.6;
      if (this.classKey === 'janitor') {
        this.parts.armR.rotation.x = this.attackAnimT > 0 ? -2.2 + (0.28 - this.attackAnimT) * 8 : -0.5;
        this.parts.armL.rotation.x = this.blocking ? -1.5 : -0.15;
        if (this.offhandItem) this.offhandItem.rotation.x = this.blocking ? 0.5 : 0;
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
      const dist = 4.6 * this.camBlend;
      const desired = eye.clone()
        .addScaledVector(back, dist)
        .addScaledVector(side, 0.7 * this.camBlend)
        .addScaledVector(UP, 0.35 * this.camBlend);
      // pull camera in if a wall is between eye and desired position
      const steps = 10;
      let t = 1;
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        const px = eye.x + (desired.x - eye.x) * k;
        const py = eye.y + (desired.y - eye.y) * k;
        const pz = eye.z + (desired.z - eye.z) * k;
        if (game.level && game.level.pointBlocked(px, py, pz)) { t = Math.max(0.05, k - 0.12); break; }
      }
      cam.position.lerpVectors(eye, desired, t);
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
    if (this.latch) {
      cam.position.x += Math.sin(game.runTime * 30) * 0.04;
      cam.position.y += Math.cos(game.runTime * 26) * 0.04;
    }
  }

  serializeState() {
    return {
      x: +this.pos.x.toFixed(2), y: +this.pos.y.toFixed(2), z: +this.pos.z.toFixed(2),
      yaw: +this.yaw.toFixed(2), pitch: +this.pitch.toFixed(2),
      hp: Math.round(this.hp), maxHp: Math.round(this.stats.maxHp),
      cls: this.classKey, name: this.name, dead: this.dead, lvl: this.level,
    };
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

    const def = CLASS_BY_KEY[this.classKey] ?? CLASS_BY_KEY.intern;
    const person = makePerson({ model: def.model, shirt: def.look.shirt, pants: def.look.pants, tie: def.look.tie, accessories: def.look.accessories, hair: def.look.hair ?? 0x3a2a1a });
    this.mesh = person.root;
    this.parts = person.parts;
    this.parts.grip.add(makeHeldItem(def.weapon));
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

  pushState(s, now) {
    this.buffer.push({ t: now, x: s.x, y: s.y, z: s.z, yaw: s.yaw });
    if (this.buffer.length > 20) this.buffer.shift();
    this.hp = s.hp; this.maxHp = s.maxHp; this.dead = s.dead;
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
    this.pos.set(tx, ty, tz);
    this.yaw = tyaw;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    const speed = Math.hypot(tx - prevX, tz - prevZ) / Math.max(dt, 0.001);
    if (speed > 0.6) animateWalk(this.parts, now, Math.min(1, speed / 8));
    else poseIdle(this.parts, now);
    this.mesh.visible = !this.dead;
  }

  dispose() {
    this.game.scene.remove(this.mesh);
  }
}
