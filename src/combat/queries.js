// ============ combat query layer ============
// ONE place that knows how "what did I hit?" is answered. Weapons, abilities,
// bosses and hazards call this; none of them ever touch the BVH, Rapier or the
// enemy array directly.
//
// Why this earns its keep:
//   * Every query gets world occlusion for free. Before this, some attacks
//     checked walls and some did not, which reads to a player as "the game
//     cheats sometimes".
//   * Tuning lives in one file. Widening melee forgiveness or changing how
//     explosion falloff works is one edit, not fifteen.
//   * It is the natural place to hang the things that come next — hit
//     registration logs, lag compensation, damage-type tables.
//
// Every method returns plain data. Nothing here applies damage: queries answer
// questions, callers decide consequences.

import * as THREE from 'three';

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _v = new THREE.Vector3();
const _to = new THREE.Vector3();

/** Targets a query may consider. */
export const TARGET = {
  ENEMIES: 'enemies',
  PLAYERS: 'players',
  DESTRUCTIBLES: 'destructibles',
};

export class CombatQueries {
  /** @param {import('../game/game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.stats = { rays: 0, overlaps: 0, arcs: 0, los: 0 };
  }

  resetStats() { this.stats = { rays: 0, overlaps: 0, arcs: 0, los: 0 }; }

  // ------------------------------------------------------------------ sources

  /** @returns {Array<any>} live candidates of the requested kinds */
  _candidates(kinds) {
    const g = this.game;
    const out = [];
    if (kinds.includes(TARGET.ENEMIES)) {
      for (const e of g.enemies) if (!e.dead) out.push(e);
    }
    if (kinds.includes(TARGET.PLAYERS)) {
      for (const p of g.livePlayers()) out.push(p);
    }
    if (kinds.includes(TARGET.DESTRUCTIBLES)) {
      for (const d of g.level?.destructibles ?? []) if (!d.dead) out.push(d);
    }
    return out;
  }

  static _centerOf(t) {
    return t.center ?? t.centerPos ?? t.pos;
  }

  static _radiusOf(t) {
    return t.radius ?? 0.5;
  }

  // -------------------------------------------------------------------- casts

  /**
   * Hitscan against the world and (optionally) actors.
   * @param {THREE.Vector3} origin
   * @param {THREE.Vector3} dir normalized
   * @param {{range?: number, targets?: string[], ignore?: any, hitWorld?: boolean, radius?: number}} opts
   * @returns {{point: THREE.Vector3, dist: number, target: any|null, normal: THREE.Vector3|null, hitWorld: boolean}}
   */
  castRay(origin, dir, {
    range = 80, targets = [TARGET.ENEMIES], ignore = null, hitWorld = true, radius = 0,
  } = {}) {
    this.stats.rays++;
    _o.copy(origin);
    _d.copy(dir).normalize();

    let bestT = range;
    let hit = null;

    // actors: analytic ray-vs-sphere, widened by `radius` for a thick cast
    for (const t of this._candidates(targets)) {
      if (t === ignore) continue;
      const c = CombatQueries._centerOf(t);
      _v.set(c.x - _o.x, c.y - _o.y, c.z - _o.z);
      const proj = _v.dot(_d);
      if (proj < 0 || proj > bestT) continue;
      const perp2 = _v.lengthSq() - proj * proj;
      const r = CombatQueries._radiusOf(t) + radius;
      if (perp2 < r * r) { bestT = proj; hit = t; }
    }

    // world: exact BVH hit, and it wins any actor behind it
    let normal = null;
    let world = false;
    if (hitWorld) {
      const w = this.game.bvh?.raycast(_o, _d, bestT);
      if (w) { bestT = w.distance; hit = null; normal = w.normal.clone(); world = true; }
      if (_d.y < -1e-4) {
        const tFloor = -_o.y / _d.y;
        if (tFloor > 0 && tFloor < bestT) {
          bestT = tFloor; hit = null; world = true;
          normal = new THREE.Vector3(0, 1, 0);
        }
      }
    }

    return {
      point: _o.clone().addScaledVector(_d, bestT),
      dist: bestT,
      target: hit,
      normal,
      hitWorld: world,
    };
  }

  /**
   * A ray with thickness — forgiving hitscan that still respects walls. This is
   * what most player weapons should use: pixel-thin rays feel unfair at range.
   */
  castSphere(origin, dir, sphereRadius, opts = {}) {
    return this.castRay(origin, dir, { ...opts, radius: sphereRadius });
  }

  /**
   * Swept capsule, approximated by sampling along the segment. Used for dashes,
   * charges and boss lunges: "what did I run through on the way?"
   * @returns {Array<any>} everything overlapped along the sweep
   */
  castCapsule(from, to, capsuleRadius, { targets = [TARGET.ENEMIES], ignore = null, maxTargets = 32 } = {}) {
    this.stats.overlaps++;
    const hits = [];
    _v.copy(to).sub(from);
    const len = _v.length();
    if (len < 1e-4) return this.overlapSphere(from, capsuleRadius, { targets, ignore, maxTargets });
    _d.copy(_v).divideScalar(len);

    for (const t of this._candidates(targets)) {
      if (t === ignore) continue;
      const c = CombatQueries._centerOf(t);
      _to.set(c.x - from.x, c.y - from.y, c.z - from.z);
      // distance from the actor centre to the segment
      const proj = Math.max(0, Math.min(len, _to.dot(_d)));
      const dx = _to.x - _d.x * proj;
      const dy = _to.y - _d.y * proj;
      const dz = _to.z - _d.z * proj;
      const r = CombatQueries._radiusOf(t) + capsuleRadius;
      if (dx * dx + dy * dy + dz * dz <= r * r) hits.push(t);
      if (hits.length >= maxTargets) break;
    }
    return hits;
  }

  // ----------------------------------------------------------------- overlaps

  /**
   * @param {{targets?: string[], ignore?: any, maxTargets?: number, requireLos?: boolean, losFrom?: THREE.Vector3}} opts
   * @returns {Array<any>} sorted nearest-first
   */
  overlapSphere(center, radius, {
    targets = [TARGET.ENEMIES], ignore = null, maxTargets = 64, requireLos = false, losFrom = null,
  } = {}) {
    this.stats.overlaps++;
    const out = [];
    const eye = losFrom ?? center;
    for (const t of this._candidates(targets)) {
      if (t === ignore) continue;
      const c = CombatQueries._centerOf(t);
      const dx = c.x - center.x, dy = c.y - center.y, dz = c.z - center.z;
      const r = radius + CombatQueries._radiusOf(t);
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r * r) continue;
      if (requireLos && !this.lineOfSight(eye, c)) continue;
      out.push({ target: t, dist: Math.sqrt(d2) });
    }
    out.sort((a, b) => a.dist - b.dist);
    return out.slice(0, maxTargets).map((h) => h.target);
  }

  /** Axis-aligned box overlap — sealed rooms, trigger volumes, arena checks. */
  overlapBox(min, max, { targets = [TARGET.ENEMIES], ignore = null, maxTargets = 128 } = {}) {
    this.stats.overlaps++;
    const out = [];
    for (const t of this._candidates(targets)) {
      if (t === ignore) continue;
      const p = t.pos ?? CombatQueries._centerOf(t);
      if (p.x < min.x || p.x > max.x || p.z < min.z || p.z > max.z) continue;
      if (min.y !== undefined && (p.y < min.y || p.y > max.y)) continue;
      out.push(t);
      if (out.length >= maxTargets) break;
    }
    return out;
  }

  // --------------------------------------------------------------------- misc

  /**
   * Can A see B? Traced at chest height through the world BVH — the same query
   * the AI uses, so "it shot me through a wall" and "it saw me through a wall"
   * can never disagree.
   */
  lineOfSight(from, to, eyeHeight = 1.35) {
    this.stats.los++;
    const bvh = this.game.bvh;
    if (!bvh?.bvh) return true;
    return !bvh.segmentBlocked(
      from.x, from.y > 0.1 ? from.y : eyeHeight, from.z,
      to.x, to.y > 0.1 ? to.y : eyeHeight, to.z,
    );
  }

  /**
   * The workhorse for every melee swing.
   *
   *   combat.meleeArc({ origin, direction, radius: 2.4, angle: 110, maxTargets: 12 })
   *
   * Cone test + wall occlusion + nearest-first ordering, so a swing cannot reach
   * through a cubicle wall and the damage cap hits who you actually swung at.
   * @param {{origin: THREE.Vector3, direction: THREE.Vector3, radius: number,
   *          angle?: number, maxTargets?: number, targets?: string[], ignore?: any,
   *          requireLos?: boolean}} opts
   * @returns {Array<any>}
   */
  meleeArc({
    origin, direction, radius, angle = 110, maxTargets = 12,
    targets = [TARGET.ENEMIES], ignore = null, requireLos = true,
  }) {
    this.stats.arcs++;
    const half = Math.cos((angle / 2) * (Math.PI / 180));
    _d.set(direction.x, 0, direction.z).normalize();
    const out = [];

    for (const t of this._candidates(targets)) {
      if (t === ignore) continue;
      const p = t.pos ?? CombatQueries._centerOf(t);
      const dx = p.x - origin.x, dz = p.z - origin.z;
      const dist = Math.hypot(dx, dz);
      const reach = radius + CombatQueries._radiusOf(t);
      if (dist > reach) continue;
      // anything close enough to be touching is inside the arc regardless of facing
      if (dist > 0.35) {
        const dot = (dx / dist) * _d.x + (dz / dist) * _d.z;
        if (dot < half) continue;
      }
      if (requireLos && !this.lineOfSight(origin, CombatQueries._centerOf(t))) continue;
      out.push({ target: t, dist });
    }
    out.sort((a, b) => a.dist - b.dist);
    return out.slice(0, maxTargets).map((h) => h.target);
  }

  /**
   * Radial damage query with falloff and optional wall shielding.
   * @returns {Array<{target: any, dist: number, falloff: number}>} falloff in (0, 1]
   */
  explosionQuery(center, radius, {
    targets = [TARGET.ENEMIES], ignore = null, minFalloff = 0.5,
    requireLos = false, maxTargets = 64,
  } = {}) {
    this.stats.overlaps++;
    const out = [];
    for (const t of this._candidates(targets)) {
      if (t === ignore) continue;
      const c = CombatQueries._centerOf(t);
      const p = t.pos ?? c;
      const dx = p.x - center.x, dz = p.z - center.z;
      const dy = (c.y ?? 0) - center.y;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const reach = radius + CombatQueries._radiusOf(t);
      if (dist > reach) continue;
      if (requireLos && !this.lineOfSight(center, c)) continue;
      // linear falloff from full damage at the centre to `minFalloff` at the rim
      const k = 1 - (dist / reach) * (1 - minFalloff);
      out.push({ target: t, dist, falloff: Math.max(minFalloff, Math.min(1, k)) });
      if (out.length >= maxTargets) break;
    }
    out.sort((a, b) => a.dist - b.dist);
    return out;
  }

  /**
   * Nearest valid target in front of the camera — lock-on, homing acquisition,
   * "who am I aiming at" for the HUD.
   */
  acquireTarget(origin, dir, { range = 40, coneDeg = 22, targets = [TARGET.ENEMIES], requireLos = true } = {}) {
    const half = Math.cos((coneDeg / 2) * (Math.PI / 180));
    _d.copy(dir).normalize();
    let best = null, bestScore = -Infinity;
    for (const t of this._candidates(targets)) {
      const c = CombatQueries._centerOf(t);
      _v.set(c.x - origin.x, c.y - origin.y, c.z - origin.z);
      const dist = _v.length();
      if (dist > range || dist < 1e-3) continue;
      const dot = _v.divideScalar(dist).dot(_d);
      if (dot < half) continue;
      if (requireLos && !this.lineOfSight(origin, c)) continue;
      // prefer centred over merely close: aim intent beats proximity
      const score = dot * 2 - dist / range;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    return best;
  }
}
