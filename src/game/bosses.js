// ============ department heads & the C.E.O. ============
import * as THREE from 'three';
import { Enemy, ENEMY_DEFS } from './enemies.js';
import { makePerson, makeHeldItem, animateWalk } from './characters.js';
import { mat, box, cyl } from './props.js';
import { rand, dist2D, clamp } from '../core/utils.js';

const _v1 = new THREE.Vector3();

export const BOSS_DEFS = {
  security: {
    name: 'GUS DUTY', title: 'HEAD OF SECURITY', hp: 1750, dmg: 20, speed: 3.9, radius: 1.0,
    centerY: 1.6, xp: 120, money: 240, scale: 1.7,
    look: { skin: 0xc9976b, shirt: 0x2e3d59, pants: 0x1e2637, tie: 0x11151d, accessories: ['sunglasses', 'cap'], hair: 0x222222, weapon: 'phone' },
  },
  cfo: {
    name: 'DEREK KROHN', title: 'HEAD OF FINANCE', hp: 2300, dmg: 24, speed: 3.1, radius: 1.0,
    centerY: 1.6, xp: 160, money: 320, scale: 1.75,
    look: { skin: 0xd8b28f, shirt: 0x39414f, pants: 0x2a303c, tie: 0xd4aa30, accessories: ['glasses'], hair: 0x555a63, weapon: 'ledger' },
  },
  cmo: {
    name: 'BRANDI SPARK', title: 'HEAD OF MARKETING', hp: 2700, dmg: 22, speed: 3.6, radius: 1.0,
    centerY: 1.6, xp: 190, money: 380, scale: 1.75,
    look: { skin: 0xe8bc9d, shirt: 0xff4fa3, pants: 0x3a2f4d, tie: null, accessories: ['sunglasses', 'bun'], hair: 0xe0559a, weapon: 'megaphone' },
  },
  vp: {
    name: 'CHAD MAVERICK', title: 'HEAD OF SALES', hp: 3300, dmg: 26, speed: 4.0, radius: 1.0,
    centerY: 1.6, xp: 230, money: 450, scale: 1.8,
    look: { skin: 0xdba577, shirt: 0x3a5f8a, pants: 0x22334a, tie: 0xff9b2d, accessories: ['headset'], hair: 0x30231a, weapon: 'phone' },
  },
  ceo: {
    name: 'THE C.E.O.', title: 'CHIEF EXECUTIVE OVERLORD', hp: 7000, dmg: 30, speed: 3.0, radius: 1.25,
    centerY: 2.0, xp: 500, money: 1000, scale: 2.3,
    look: { skin: 0xcfae8e, shirt: 0x16161c, pants: 0x101014, tie: 0xffd23f, accessories: ['crown'], hair: 0xd9d9d9, weapon: 'gavel' },
  },
};

// register into ENEMY_DEFS so shared systems can treat bosses as enemies
for (const [k, d] of Object.entries(BOSS_DEFS)) {
  ENEMY_DEFS[k] = {
    name: d.name, hp: d.hp, dmg: d.dmg, speed: d.speed, radius: d.radius, centerY: d.centerY,
    xp: d.xp, money: d.money, credit: 0, ai: 'boss', rare: true, big: true, boss: true,
  };
}

export class Boss extends Enemy {
  constructor(game, key, pos, opts = {}) {
    super(game, key, pos, opts);
    this.bossDef = BOSS_DEFS[key];
    this.kbResist = 0.06;
    this.attackTimer = 2.2;   // opening grace
    this.busy = false;
    this.phase = 1;
    this.enraged = false;
    this.cds = {};
    this.beamState = null;
    this.chargeState = null;

    // replace the placeholder mesh with a themed executive
    this.disposeMesh();
    const L = this.bossDef.look;
    const person = makePerson({
      skin: L.skin, shirt: L.shirt, pants: L.pants, tie: L.tie, hair: L.hair,
      accessories: L.accessories, tieLength: 0.62,
    });
    person.root.scale.setScalar(this.bossDef.scale);
    this.mesh = new THREE.Group();
    this.mesh.add(person.root);
    this.parts = person.parts;
    this.parts.person = person;
    this.parts.grip.add(makeHeldItem(L.weapon));
    if (key === 'ceo') this.buildThrone();
    this.mesh.position.copy(this.pos);
    game.scene.add(this.mesh);
  }

  buildThrone() {
    // phase-1 golden throne the CEO rides
    const t = new THREE.Group();
    const seat = box(1.6, 0.25, 1.6, 0x2c2320);
    seat.position.y = 1.0;
    const back = box(1.6, 2.2, 0.25, 0x2c2320); back.position.set(0, 2.0, 0.8);
    const trim = box(1.7, 0.12, 1.7, 0xd4aa30, { metal: 0.8, rough: 0.25 }); trim.position.y = 1.15;
    const skirt = box(1.9, 0.9, 1.9, 0x1c1613); skirt.position.y = 0.45;
    const jetL = cyl(0.2, 0.3, 0.5, 0x6b727c, 8); jetL.position.set(-0.7, 0.2, -0.6);
    const jetR = jetL.clone(); jetR.position.x = 0.7;
    const flameL = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.6, 6), mat(0xffb36b, { emissive: 0xff7b2d, emissiveIntensity: 2.5 }));
    flameL.rotation.x = Math.PI; flameL.position.set(-0.7, -0.25, -0.6);
    const flameR = flameL.clone(); flameR.position.x = 0.7;
    t.add(seat, back, trim, skirt, jetL, jetR, flameL, flameR);
    this.throne = t;
    this.flames = [flameL, flameR];
    this.mesh.add(t);
    // CEO sits: raise the person
    this.parts.person.root.position.y = 1.2;
  }

  maxAttackCd() { return this.enraged ? 1.5 : this.phase === 2 ? 2.2 : 3.0; }

  ai(dt, target) {
    const game = this.game;
    // charge movement (VP)
    if (this.chargeState) {
      const c = this.chargeState;
      this.pos.x += c.dx * c.speed * dt;
      this.pos.z += c.dz * c.speed * dt;
      this.faceYaw = Math.atan2(c.dx, c.dz);
      c.dist -= c.speed * dt;
      for (const t of game.livePlayers()) {
        if (!c.hit.has(t.id) && dist2D(t.pos, this.pos) < 1.8) {
          c.hit.add(t.id);
          t.damage(this.dmg * 1.2, this.pos);
          game.shake(0.5);
        }
      }
      game.effects.burst(this.pos.clone().setY(0.3), { color: 0xff9b2d, n: 2, speed: 2, size: 0.1, ttl: 0.25 });
      if (c.dist <= 0 || game.level.collideCircle(this.pos, this.radius, 0, 3)) {
        this.chargeState = null;
        this.busy = false;
      }
      return;
    }
    // rotating beam (CEO p2)
    if (this.beamState) {
      const b = this.beamState;
      b.t += dt;
      b.angle += b.dir * b.speed * dt;
      const bx = Math.sin(b.angle), bz = Math.cos(b.angle);
      this.faceYaw = b.angle;
      // hurt players standing in the beam line (jump to dodge)
      for (const t of game.livePlayers()) {
        const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z;
        const along = dx * bx + dz * bz;
        if (along < 1 || along > b.range) continue;
        const off = Math.abs(dx * bz - dz * bx);
        if (off < 1.0 && t.pos.y < 1.15) {
          if (!b.lastHit.has(t.id) || b.lastHit.get(t.id) < b.t - 0.6) {
            b.lastHit.set(t.id, b.t);
            t.damage(this.dmg * 0.7, this.pos);
          }
        }
      }
      if (b.mesh) {
        b.mesh.position.set(this.pos.x + bx * b.range / 2, 1.0, this.pos.z + bz * b.range / 2);
        b.mesh.rotation.y = b.angle;
      }
      if (b.t >= b.dur) {
        game.scene.remove(b.mesh);
        b.mesh.geometry.dispose(); b.mesh.material.dispose();
        this.beamState = null;
        this.busy = false;
      }
      return;
    }

    if (this.busy) return;

    // stroll toward the nearest target between attacks
    const d = dist2D(target.pos, this.pos);
    const desired = this.key === 'cmo' ? 10 : 3;
    if (d > desired) this.moveToward(target.pos.x, target.pos.z, dt);
    else this.faceYaw = Math.atan2(target.pos.x - this.pos.x, target.pos.z - this.pos.z);
    // close-range swat so hugging the boss isn't free
    if (d < 2.6 && this.attackCd <= 0) {
      this.attackCd = 1.6;
      this.strikeAnim = 0.5;
      target.damage(this.dmg * 0.8, this.pos);
      target.vel?.add(_v1.set(target.pos.x - this.pos.x, 0.3, target.pos.z - this.pos.z).normalize().multiplyScalar(7));
      game.audio.sfx('melee-hit');
    }

    this.attackTimer -= dt;
    if (this.attackTimer <= 0) {
      this.attackTimer = this.maxAttackCd() * rand(0.9, 1.25);
      this.pickAttack(target);
    }
  }

  pickAttack(target) {
    const opts = this.attackOptions();
    const usable = opts.filter((o) => (this.cds[o.id] ?? 0) <= this.game.runTime);
    if (!usable.length) return;
    const total = usable.reduce((s, o) => s + o.w, 0);
    let r = Math.random() * total;
    for (const o of usable) {
      r -= o.w;
      if (r <= 0) {
        this.cds[o.id] = this.game.runTime + o.cd;
        o.run(target);
        return;
      }
    }
  }

  attackOptions() {
    switch (this.key) {
      case 'security': return [
        { id: 'charge', w: 3, cd: 6.5, run: (t) => this.atkCharge(t) },
        { id: 'halt', w: 2.6, cd: 7, run: (t) => this.atkColdCall(t) },
        { id: 'slam', w: 1.8, cd: 10, run: (t) => this.atkJumpSlam(t, 4.4, 0xc59d45) },
      ];
      case 'cfo': return [
        { id: 'ledger', w: 3, cd: 4, run: (t) => this.atkLedgerLob(t) },
        { id: 'coins', w: 2.4, cd: 7, run: () => this.atkCoinStorm() },
        { id: 'slam', w: 2, cd: 9, run: (t) => this.atkJumpSlam(t, 5, 0xd4aa30) },
      ];
      case 'cmo': return [
        { id: 'blast', w: 3, cd: 4, run: (t) => this.atkBrandBlast(t) },
        { id: 'blink', w: 2.4, cd: 6, run: (t) => this.atkBlink(t) },
        { id: 'viral', w: 1.6, cd: 12, run: () => this.atkSummon(['paperling', 'paperling', 'paperling', 'quad'], 'GOING VIRAL!') },
        { id: 'hype', w: 2, cd: 8, run: () => this.atkShockRing(0xff4fa3) },
      ];
      case 'vp': return [
        { id: 'charge', w: 3, cd: 6, run: (t) => this.atkCharge(t) },
        { id: 'shout', w: 2.6, cd: 7, run: (t) => this.atkColdCall(t) },
        { id: 'closers', w: 1.5, cd: 14, run: () => this.atkSummon(['drone', 'drone', 'micromanager'], 'CLOSERS — ON ME!') },
      ];
      case 'ceo': {
        const base = [
          { id: 'synergy', w: 3, cd: 5, run: (t) => this.atkSynergyOrbs(t) },
          { id: 'layoff', w: 2.6, cd: 8, run: () => this.atkShockRing(0xffd23f, 2) },
          { id: 'interns', w: 1.6, cd: 13, run: () => this.atkSummon(['paperling', 'paperling', 'drone', 'drone'], 'INTERNS. DEAL WITH THIS.') },
        ];
        if (this.phase === 2) {
          base.push(
            { id: 'beam', w: 2.6, cd: 11, run: () => this.atkQuarterlyBeam() },
            { id: 'slam', w: 2.2, cd: 9, run: (t) => this.atkJumpSlam(t, 6, 0xffd23f) },
          );
        }
        return base;
      }
    }
    return [];
  }

  // ---------- attacks ----------
  atkLedgerLob(target) {
    const game = this.game;
    this.strikeAnim = 0.6;
    for (let i = 0; i < 3; i++) {
      game.delayed(i * 0.35, () => {
        if (this.dead) return;
        const t = game.nearestPlayer(this.pos) ?? target;
        const lead = t.vel ? _v1.copy(t.pos).addScaledVector(t.vel, 0.4) : _v1.copy(t.pos);
        const dir = lead.clone().sub(this.pos);
        const dist = dir.length();
        dir.normalize();
        game.projectiles.spawn({
          pos: this.center.clone().add(new THREE.Vector3(0, 0.6, 0)),
          vel: dir.multiplyScalar(clamp(dist * 1.0, 10, 22)).setY(7 + dist * 0.15),
          gravity: 15, kind: 'book', damage: this.dmg, friendly: false, ttl: 4, radius: 0.3, aoe: 2.6, knockback: 8, spin: 8,
        });
        game.audio.sfx('swing');
      });
    }
  }

  atkCoinStorm() {
    const game = this.game;
    this.strikeAnim = 0.6;
    game.audio.sfx('buy', { vol: 1.2 });
    for (let wave = 0; wave < 2; wave++) {
      game.delayed(wave * 0.7, () => {
        if (this.dead) return;
        const n = 14;
        const off = wave * (Math.PI / n);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + off;
          game.projectiles.spawn({
            pos: this.center.clone(),
            vel: new THREE.Vector3(Math.sin(a) * 11, 0, Math.cos(a) * 11),
            kind: 'orb', damage: this.dmg * 0.6, friendly: false, ttl: 3.2, radius: 0.24,
          });
        }
      });
    }
  }

  atkJumpSlam(target, radius, color) {
    const game = this.game;
    this.busy = true;
    const dest = target.pos.clone();
    game.effects.telegraph(dest, radius, 1.0);
    game.audio.sfx('roar', { vol: 0.5 });
    const start = this.pos.clone();
    let t = 0;
    const hop = { update: (dt) => {
      t += dt / 1.0;
      if (t >= 1) {
        this.pos.copy(dest);
        this.pos.y = 0;
        this.busy = false;
        game.audio.sfx('explosion');
        game.shake(0.7);
        game.effects.ring(dest, { color, r1: radius, dur: 0.45 });
        game.level.kickDebris(dest, radius + 1, 10);
        for (const p of game.livePlayers()) {
          if (dist2D(p.pos, dest) < radius && p.pos.y < 1.5) p.damage(this.dmg * 1.1, dest);
        }
        return false;
      }
      const k = t;
      this.pos.lerpVectors(start, dest, k);
      this.pos.y = Math.sin(k * Math.PI) * 6;
      return true;
    } };
    game.tickers.push(hop);
  }

  atkBrandBlast(target) {
    const game = this.game;
    this.strikeAnim = 0.5;
    game.audio.sfx('horde', { vol: 0.5 });
    for (let i = 0; i < 5; i++) {
      game.delayed(i * 0.12, () => {
        if (this.dead) return;
        const dir = _v1.copy(target.centerPos).sub(this.center).normalize();
        dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), rand(-0.18, 0.18));
        game.projectiles.spawn({
          pos: this.center.clone(), vel: dir.multiplyScalar(17),
          kind: 'brand', damage: this.dmg * 0.7, friendly: false, ttl: 3, radius: 0.2, homing: 0.8,
        });
      });
    }
  }

  atkBlink(target) {
    const game = this.game;
    game.effects.confetti(this.center, 20);
    game.audio.sfx('dash');
    const spot = game.level.findSpawnPoint(target.pos, 6, 11, null);
    this.pos.copy(spot);
    game.effects.confetti(this.center, 20);
    game.effects.ring(this.pos, { color: 0xff4fa3, r1: 3, dur: 0.4 });
  }

  atkSummon(keys, line) {
    const game = this.game;
    this.strikeAnim = 0.6;
    game.hud.announce(line, 1.8, true);
    game.audio.sfx('phone');
    for (const k of keys) {
      const p = game.level.findSpawnPoint(this.pos, 3, 7, null);
      game.spawnEnemy(k, p, { fromBoss: true });
    }
  }

  atkShockRing(color, count = 1) {
    const game = this.game;
    this.strikeAnim = 0.6;
    game.audio.sfx('roar', { vol: 0.6 });
    for (let i = 0; i < count; i++) {
      game.delayed(i * 0.8, () => {
        if (this.dead) return;
        game.spawnShockRing(this.pos.clone(), {
          speed: 9, width: 1.1, dmg: this.dmg * 0.8, color, maxR: 26,
        });
      });
    }
  }

  atkCharge(target) {
    const game = this.game;
    this.busy = true;
    const dir = _v1.copy(target.pos).sub(this.pos).setY(0).normalize();
    const dist = clamp(dist2D(target.pos, this.pos) + 6, 10, 30);
    // telegraph line
    const tele = new THREE.Mesh(new THREE.PlaneGeometry(2.2, dist),
      new THREE.MeshBasicMaterial({ color: 0xff4d5a, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
    tele.rotation.x = -Math.PI / 2;
    tele.position.copy(this.pos).addScaledVector(dir, dist / 2).setY(0.08);
    tele.rotation.z = -Math.atan2(dir.x, dir.z);
    game.scene.add(tele);
    game.audio.sfx('phone', { vol: 1.2 });
    game.delayed(0.9, () => {
      game.scene.remove(tele);
      tele.geometry.dispose(); tele.material.dispose();
      if (this.dead) { this.busy = false; return; }
      game.audio.sfx('roar', { vol: 0.7 });
      this.chargeState = { dx: dir.x, dz: dir.z, speed: 19, dist, hit: new Set() };
    });
  }

  atkColdCall(target) {
    const game = this.game;
    this.strikeAnim = 0.6;
    game.effects.telegraph(target.pos.clone(), 4.5, 0.8);
    const spot = target.pos.clone();
    game.delayed(0.8, () => {
      if (this.dead) return;
      game.audio.sfx('horde');
      game.shake(0.5);
      game.effects.ring(spot, { color: 0xff9b2d, r1: 4.5, dur: 0.4 });
      for (const p of game.livePlayers()) {
        if (dist2D(p.pos, spot) < 4.5) {
          p.damage(this.dmg, spot);
          p.vel?.add(_v1.set(p.pos.x - spot.x, 0.5, p.pos.z - spot.z).normalize().multiplyScalar(12));
        }
      }
    });
  }

  atkSynergyOrbs(target) {
    const game = this.game;
    this.strikeAnim = 0.6;
    game.audio.sfx('roar', { vol: 0.4 });
    for (let i = 0; i < 6; i++) {
      game.delayed(i * 0.18, () => {
        if (this.dead) return;
        const a = (i / 6) * Math.PI * 2;
        const v = new THREE.Vector3(Math.sin(a) * 6, 3.5, Math.cos(a) * 6);
        game.projectiles.spawn({
          pos: this.center.clone().add(new THREE.Vector3(0, 1, 0)),
          vel: v, kind: 'orb', damage: this.dmg * 0.65, friendly: false, ttl: 5, radius: 0.26, homing: 1.5,
        });
      });
    }
  }

  atkQuarterlyBeam() {
    const game = this.game;
    this.busy = true;
    const range = 26;
    const startAngle = Math.atan2((game.player?.pos.x ?? 0) - this.pos.x, (game.player?.pos.z ?? 0) - this.pos.z) - 1.2;
    const beamMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, range),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.75 }));
    game.scene.add(beamMesh);
    game.audio.sfx('alarm');
    game.hud.announce('QUARTERLY REVIEW — JUMP!', 1.6, true);
    this.beamState = { t: 0, dur: 3.4, angle: startAngle, dir: 1, speed: 1.25, range, mesh: beamMesh, lastHit: new Map() };
  }

  // ---------- lifecycle ----------
  update(dt) {
    const alive = super.update(dt);
    // phase flip for CEO
    if (!this.dead && this.key === 'ceo' && this.phase === 1 && this.hp < this.maxHp * 0.5) {
      this.phase = 2;
      this.busy = false;
      const game = this.game;
      game.hud.announce('THE C.E.O. IS OUT OF THE CHAIR', 2.4, true);
      game.audio.sfx('explosion');
      game.shake(0.9);
      if (this.throne) {
        game.effects.burst(this.pos.clone().setY(1), { color: 0xd4aa30, n: 30, speed: 8, ttl: 1 });
        game.explode(this.pos.clone(), 5, 20, { friendly: false, knockback: 14 });
        this.mesh.remove(this.throne);
        this.throne = null;
        this.parts.person.root.position.y = 0;
      }
      this.speed *= 1.5;
    }
    if (!this.dead && !this.enraged && this.hp < this.maxHp * 0.15) {
      this.enraged = true;
      this.game.hud.announce(this.key === 'ceo' ? 'HOSTILE TAKEOVER — ENRAGED' : `${this.bossDef.name} IS FURIOUS`, 2, true);
      this.game.audio.sfx('roar');
    }
    if (this.flames) {
      for (const f of this.flames) f.scale.y = 0.8 + Math.sin(this.animT * 30 + f.position.x) * 0.3;
    }
    // keep the boss HP bar fresh
    if (!this.dead) this.game.hud.updateBoss(this.hp / this.maxHp);
    return alive;
  }

  updateVisual(dt) {
    this.mesh.position.copy(this.pos);
    if (this.faceYaw !== undefined) {
      let d = this.faceYaw - this.mesh.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.mesh.rotation.y += d * Math.min(1, dt * 8);
    }
    this.strikeAnim = Math.max(0, (this.strikeAnim ?? 0) - dt);
    const p = this.parts;
    if (p.person) {
      const moving = !this.busy && this.state !== 'idle';
      if (this.key === 'ceo' && this.phase === 1) {
        // riding the throne: legs forward
        p.legL.rotation.x = -1.3; p.legR.rotation.x = -1.3;
        this.mesh.position.y = this.pos.y + Math.sin(this.animT * 3) * 0.15 + 0.2;
      } else if (moving) {
        animateWalk(p, this.animT, 0.7);
      }
      if (this.strikeAnim > 0) {
        p.armR.rotation.x = -2.6 + (0.6 - this.strikeAnim) * 2;
      } else if (this.key !== 'ceo' || this.phase === 2) {
        p.armR.rotation.x = -0.4;
      }
    }
  }

  die(instant, opts = {}) {
    if (this.dead) return;
    if (this.beamState?.mesh) {
      this.game.scene.remove(this.beamState.mesh);
      this.beamState.mesh.geometry.dispose();
      this.beamState.mesh.material.dispose();
      this.beamState = null;
    }
    super.die(instant, opts);
    this.game.onBossDefeated(this);
  }
}
