// ============ projectile simulation ============
import * as THREE from 'three';
import { segPointDist3D, nextId } from '../core/utils.js';

const _decalUp = new THREE.Vector3(0, 1, 0);
const _decalDir = new THREE.Vector3();

const geoCache = new Map();
function geo(kind) {
  if (geoCache.has(kind)) return geoCache.get(kind);
  let g;
  switch (kind) {
    case 'staple': g = new THREE.BoxGeometry(0.16, 0.06, 0.24); break;
    case 'calcshot': g = new THREE.BoxGeometry(0.13, 0.13, 0.22); break;
    case 'card': g = new THREE.BoxGeometry(0.3, 0.015, 0.2); break;
    case 'slip': g = new THREE.PlaneGeometry(0.34, 0.26); break;
    case 'paper': g = new THREE.IcosahedronGeometry(0.17, 0); break;
    case 'coffee': g = new THREE.IcosahedronGeometry(0.19, 0); break;
    case 'book': g = new THREE.BoxGeometry(0.42, 0.12, 0.32); break;
    case 'orb': g = new THREE.IcosahedronGeometry(0.26, 1); break;
    case 'brand': g = new THREE.IcosahedronGeometry(0.2, 1); break;
    case 'chunk': g = new THREE.BoxGeometry(0.5, 0.4, 0.45); break;
    case 'wave': g = new THREE.BoxGeometry(2.6, 0.5, 0.25); break;
    case 'grenade': g = new THREE.BoxGeometry(0.26, 0.2, 0.34); break;
    case 'tape': g = new THREE.IcosahedronGeometry(0.24, 0); break;
    case 'carafe': g = new THREE.CylinderGeometry(0.14, 0.18, 0.3, 7); break;
    default: g = new THREE.SphereGeometry(0.15, 6, 5);
  }
  geoCache.set(kind, g);
  return g;
}

const matDefs = {
  staple: { color: 0xd7dde6, metalness: 0.7, roughness: 0.3 },
  calcshot: { color: 0x9fffb3, emissive: 0x37d165, emissiveIntensity: 1.6 },
  card: { color: 0xffffff, roughness: 0.6 },
  slip: { color: 0xff9ec4, emissive: 0xdb5f92, emissiveIntensity: 0.55, side: THREE.DoubleSide },
  paper: { color: 0xf2f2f2, roughness: 0.9 },
  coffee: { color: 0x6b4423, emissive: 0x3a1f0a, emissiveIntensity: 0.4 },
  book: { color: 0x7a4c28, roughness: 0.85 },
  orb: { color: 0xffe08a, emissive: 0xffc23f, emissiveIntensity: 2.2 },
  brand: { color: 0xff7fc4, emissive: 0xff2f9e, emissiveIntensity: 2.2 },
  chunk: { color: 0x8d99a8, roughness: 0.9 },
  wave: { color: 0xd8ecff, emissive: 0x7fb4d8, emissiveIntensity: 0.8, transparent: true, opacity: 0.7 },
  grenade: { color: 0xc0392b, emissive: 0x551111, emissiveIntensity: 0.8 },
  tape: { color: 0xd9d2b8, roughness: 0.95 },
  carafe: { color: 0x3a2417, emissive: 0x1c0f06, emissiveIntensity: 0.4, roughness: 0.4 },
};
const matCache = new Map();
function pmat(kind) {
  if (!matCache.has(kind)) matCache.set(kind, new THREE.MeshStandardMaterial({ flatShading: true, ...(matDefs[kind] || matDefs.paper) }));
  return matCache.get(kind);
}

export class Projectiles {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.list = [];
    this._prev = new THREE.Vector3();
    this._home = new THREE.Vector3();
  }

  spawn(opts) {
    if (this.game.filterProjectile) opts = this.game.filterProjectile(opts);
    const p = {
      id: opts.id ?? nextId(),
      pos: opts.pos.clone(),
      vel: opts.vel.clone(),
      gravity: opts.gravity ?? 0,
      radius: opts.radius ?? 0.16,
      damage: opts.damage ?? 10,
      crit: opts.crit ?? false,
      friendly: opts.friendly ?? true,
      pierce: opts.pierce ?? 0,
      homing: opts.homing ?? 0,          // turn rate rad/s
      ttl: opts.ttl ?? 3,
      kind: opts.kind ?? 'paper',
      aoe: opts.aoe ?? 0,
      knockback: opts.knockback ?? 0,
      puddle: opts.puddle ?? null,        // hazard left on ground impact
      owner: opts.owner ?? null,          // player object for proc credit
      cosmetic: opts.cosmetic ?? false,   // client-side visual only
      spin: opts.spin ?? 0,
      boomerang: opts.boomerang ?? false, // sales evolution: card returns to owner
      returning: false,
      fromRicochet: opts.fromRicochet ?? false,
      slowSplat: opts.slowSplat ?? null,  // tape ball: slow zone on impact
      hitSet: new Set(),
      mesh: new THREE.Mesh(geo(opts.kind ?? 'paper'), pmat(opts.kind ?? 'paper')),
    };
    p.mesh.castShadow = p.kind !== 'slip';
    p.mesh.position.copy(p.pos);
    p.mesh.lookAt(p.pos.clone().add(p.vel));
    this.scene.add(p.mesh);
    this.list.push(p);
    return p;
  }

  remove(p) {
    const i = this.list.indexOf(p);
    if (i >= 0) this.list.splice(i, 1);
    this.scene.remove(p.mesh);
  }

  clear() {
    for (const p of this.list) this.scene.remove(p.mesh);
    this.list.length = 0;
  }

  update(dt) {
    const game = this.game;
    const level = game.level;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.ttl -= dt;
      if (p.ttl <= 0) {
        // fused ordnance detonates on expiry instead of fizzling
        if (p.aoe > 0 || p.puddle || p.slowSplat) this.impact(p);
        else this.remove(p);
        continue;
      }

      // homing steer
      if (p.homing > 0) {
        const target = p.friendly ? game.nearestEnemy(p.pos, 26) : game.player;
        if (target && !target.dead) {
          const tp = p.friendly ? target.center : target.centerPos;
          const desired = new THREE.Vector3().subVectors(tp, p.pos).normalize();
          const speed = p.vel.length();
          const cur = p.vel.clone().normalize();
          cur.lerp(desired, Math.min(1, p.homing * dt));
          p.vel.copy(cur.normalize().multiplyScalar(speed));
        }
      }

      // boomerang cards flip around and fly home
      if (p.boomerang && !p.returning && p.ttl < 1.6 && p.owner?.pos) {
        p.returning = true;
        p.hitSet.clear();
        p.pierce = 99;
        p.ttl = Math.max(p.ttl, 2.5);
      }
      if (p.returning && p.owner?.pos) {
        this._home.set(p.owner.pos.x, p.owner.pos.y + 1.2, p.owner.pos.z);
        if (p.pos.distanceTo(this._home) < 1.1) { this.remove(p); continue; }
        const speed = Math.max(34, p.vel.length());
        p.vel.copy(this._home.sub(p.pos).normalize().multiplyScalar(speed));
      }
      p.vel.y -= p.gravity * dt;
      this._prev.copy(p.pos);
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);
      if (p.spin) { p.mesh.rotation.y += p.spin * dt; p.mesh.rotation.x += p.spin * 0.6 * dt; }
      else p.mesh.lookAt(this._prev);

      // world collision
      const hitFloor = p.pos.y <= (p.radius * 0.5);
      if (hitFloor || level.pointBlocked(p.pos.x, p.pos.y, p.pos.z)) {
        p._hitFloor = hitFloor;
        // grenades bounce until the fuse runs out
        if (p.kind === 'grenade' && p.ttl > 0.05) {
          if (p.pos.y <= p.radius * 0.5) {
            p.pos.y = p.radius * 0.5 + 0.01;
            p.vel.y = Math.abs(p.vel.y) * 0.45;
            p.vel.x *= 0.7;
            p.vel.z *= 0.7;
          } else {
            p.pos.copy(this._prev);
            p.vel.x *= -0.45;
            p.vel.z *= -0.45;
          }
          if (p.vel.lengthSq() > 1) game.audio.sfx('beep', { vol: 0.35 });
          continue;
        }
        this.impact(p);
        continue;
      }
      if (p.pos.y > 40) { this.remove(p); continue; }
      if (p.cosmetic) continue;

      // entity collision
      if (p.friendly) {
        let consumed = false;
        for (const e of game.enemies) {
          if (e.dead || p.hitSet.has(e.id)) continue;
          const d = segPointDist3D(this._prev, p.pos, e.center);
          if (d < e.radius + p.radius) {
            p.hitSet.add(e.id);
            game.projectileHitEnemy(p, e);
            if (p.aoe > 0) { this.impact(p); consumed = true; break; }
            if (p.pierce > 0) { p.pierce--; }
            else { this.finish(p); consumed = true; break; }
          }
        }
        if (consumed) continue;
        // destructibles
        for (const d of level.destructibles) {
          if (d.dead) continue;
          if (segPointDist3D(this._prev, p.pos, d.pos) < d.radius + p.radius) {
            game.damageDestructible(d, p.damage);
            this.impact(p);
            consumed = true;
            break;
          }
        }
        if (consumed) continue;
      } else {
        // hostile: players & turrets
        const targets = game.allPlayerTargets();
        let consumed = false;
        for (const t of targets) {
          if (t.dead) continue;
          const c = t.centerPos;
          const d = segPointDist3D(this._prev, p.pos, c);
          if (d < (t.radius ?? 0.55) + p.radius) {
            game.projectileHitPlayer(p, t);
            this.impact(p);
            consumed = true;
            break;
          }
        }
        if (consumed) continue;
      }
    }
  }

  finish(p) {
    this.game.effects.burst(p.pos, { color: 0xffffff, n: 3, speed: 2.5, size: 0.07, ttl: 0.25 });
    this.remove(p);
  }

  impact(p) {
    const game = this.game;
    if (!p.cosmetic) {
      if (p.aoe > 0) {
        game.explode(p.pos, p.aoe, p.damage, { friendly: p.friendly, crit: p.crit, owner: p.owner, knockback: Math.max(6, p.knockback) });
      }
      if (p.puddle) {
        game.addHazard({ pos: p.pos.clone().setY(0), ...p.puddle });
      }
      if (p.slowSplat) {
        game.addSlowZone({ pos: p.pos.clone().setY(0), ...p.slowSplat });
      }
    }
    const colors = { coffee: 0x6b4423, orb: 0xffc23f, brand: 0xff2f9e, book: 0x7a4c28 };
    game.effects.burst(p.pos, { color: colors[p.kind] ?? 0xd8dde6, n: p.aoe > 0 ? 14 : 5, speed: p.aoe > 0 ? 7 : 3, size: 0.1, ttl: 0.4 });

    // Leave a mark. Instanced and hard-capped, so a ten-minute firefight costs
    // one draw call per decal kind no matter how much lead went downrange.
    if (game.decals && !p.cosmetic) {
      const kind = p.aoe > 0 ? 'scorch' : (p.kind === 'coffee' ? 'coffee' : 'bullet');
      // floor hits face up; wall hits use the surface the BVH reports
      const normal = p._hitFloor
        ? _decalUp
        : (game.bvh?.raycast(this._prev, _decalDir.copy(p.pos).sub(this._prev).normalize(), 4)?.normal ?? _decalUp);
      game.decals.spawn(kind, p.pos, normal);
    }
    this.remove(p);
  }
}
