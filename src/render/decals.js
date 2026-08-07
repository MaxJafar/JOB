// ============ decals ============
// Bullet holes, blood splats, scorch marks, coffee stains. The cheapest way to
// make a room look fought-in — and the first system to leak memory if you let it
// grow unbounded, so every kind has a hard budget and recycles oldest-first.
//
// Built on InstancedMesh: 150 blood splats are ONE draw call, not 150. That is
// the whole reason the InstancingManager exists, and it is why decals can be
// generous here without costing anything the frame budget notices.
//
// Placement is a projected quad, not DecalGeometry. Real decal projection needs
// the target mesh's triangles and produces new geometry per decal; on flat
// office walls and floors a camera-facing quad offset along the surface normal
// is visually identical and costs nothing.

import * as THREE from 'three';

const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3(0, 0, 1);
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();

/** Per-kind budget and look. Budgets are the ceiling; the governor scales them. */
export const DECAL_KINDS = {
  bullet: { color: 0x1a1a1e, size: [0.12, 0.22], budget: 100, fade: 0 },
  blood: { color: 0x7a1220, size: [0.35, 0.8], budget: 150, fade: 0 },
  scorch: { color: 0x14100c, size: [0.7, 1.5], budget: 40, fade: 0 },
  coffee: { color: 0x4a3122, size: [0.5, 1.1], budget: 40, fade: 0 },
  paper: { color: 0xe8e6df, size: [0.2, 0.4], budget: 80, fade: 0 },
};

export class DecalSystem {
  /**
   * @param {import('./instancing.js').InstancingManager} instancing
   */
  constructor(instancing) {
    this.instancing = instancing;
    this.budgetScale = 1;
    /** @type {Map<string, {batch: any, ring: Array<number>, cursor: number, cap: number}>} */
    this.kinds = new Map();
    this._geo = new THREE.PlaneGeometry(1, 1);
    this._mats = new Map();
  }

  _material(kind) {
    let m = this._mats.get(kind);
    if (m) return m;
    const def = DECAL_KINDS[kind];
    m = new THREE.MeshBasicMaterial({
      color: def.color,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      polygonOffset: true,        // sit on the surface without z-fighting
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      side: THREE.DoubleSide,
    });
    this._mats.set(kind, m);
    return m;
  }

  _slot(kind) {
    let s = this.kinds.get(kind);
    if (s) return s;
    const def = DECAL_KINDS[kind];
    if (!def) return null;
    const cap = Math.max(4, Math.round(def.budget * this.budgetScale));
    const batch = this.instancing.batch(`decal:${kind}`, this._geo, this._material(kind), def.budget, {
      castShadow: false, receiveShadow: false,
    });
    s = { batch, ring: [], cursor: 0, cap };
    this.kinds.set(kind, s);
    return s;
  }

  /** PerformanceGovernor calls this — decals are early on the list of things to cut. */
  setBudget(total) {
    const nominal = Object.values(DECAL_KINDS).reduce((n, d) => n + d.budget, 0);
    this.budgetScale = Math.max(0.05, total / nominal);
    for (const [kind, s] of this.kinds) {
      s.cap = Math.max(4, Math.round(DECAL_KINDS[kind].budget * this.budgetScale));
      while (s.ring.length > s.cap) this._retireOldest(s);
    }
  }

  _retireOldest(s) {
    const handle = s.ring.shift();
    if (handle !== undefined) s.batch.remove(handle);
  }

  /**
   * Stick a decal to a surface.
   * @param {string} kind
   * @param {THREE.Vector3} point contact point
   * @param {THREE.Vector3} normal surface normal (from the BVH raycast)
   * @param {{size?: number, rotate?: boolean}} opts
   */
  spawn(kind, point, normal, { size = null, rotate = true } = {}) {
    const def = DECAL_KINDS[kind];
    const s = this._slot(kind);
    if (!s || !def) return null;

    while (s.ring.length >= s.cap) this._retireOldest(s);

    const n = normal && Number.isFinite(normal.x) ? normal : _up;
    // lift off the surface so it never z-fights with the wall it is stuck to
    _pos.copy(point).addScaledVector(n, 0.012);
    _q.setFromUnitVectors(_fwd, n);
    if (rotate) {
      // random roll around the surface normal, so repeated hits never tile
      const roll = new THREE.Quaternion().setFromAxisAngle(n, Math.random() * Math.PI * 2);
      _q.premultiply(roll);
    }
    const px = size ?? (def.size[0] + Math.random() * (def.size[1] - def.size[0]));
    _scale.set(px, px, 1);

    const handle = s.batch.add(_pos, _q, _scale);
    if (handle === null) return null;
    s.ring.push(handle);
    return handle;
  }

  /**
   * Convenience: place a decal wherever a shot landed. Skips the call entirely
   * when the hit was an actor rather than the world.
   * @param {{point: THREE.Vector3, normal: THREE.Vector3|null, hitWorld: boolean}} hit
   */
  spawnFromHit(kind, hit) {
    if (!hit?.hitWorld) return null;
    return this.spawn(kind, hit.point, hit.normal);
  }

  clear() {
    for (const s of this.kinds.values()) {
      s.batch.clear();
      s.ring.length = 0;
    }
  }

  dispose() {
    this.clear();
    this.kinds.clear();
    this._geo.dispose();
    for (const m of this._mats.values()) m.dispose();
    this._mats.clear();
  }

  stats() {
    const out = {};
    for (const [kind, s] of this.kinds) out[kind] = `${s.ring.length}/${s.cap}`;
    return out;
  }
}
