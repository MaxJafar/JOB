// ============ navigation mesh (recast-navigation) ============
// Built ONCE per floor, right after the room graph is generated — never rebuilt
// mid-combat. Input geometry is synthesised from the level's own data: a floor
// quad per room plus a solid box per collider. Recast voxelises that and gives
// back the walkable surface with obstacles carved out, so enemies stop trying to
// walk through cubicle walls and instead route around them.
//
// Pathing is opt-in per enemy via PathAgent. Trash mobs in open bullpens keep
// using cheap direct seek; anything that has to navigate (specials, bosses,
// flankers, anything with a wall between it and its target) asks for a path.

import * as THREE from 'three';

let recast = null;
let generators = null;
let loadPromise = null;

/** Load + init the recast WASM once. Resolves false if unavailable. */
export async function loadNav() {
  if (recast) return true;
  if (!loadPromise) {
    loadPromise = Promise.all([
      import('recast-navigation'),
      import('@recast-navigation/three'),
    ])
      .then(async ([core, three]) => {
        await core.init();
        recast = core;
        generators = three;
        return true;
      })
      .catch((err) => {
        console.warn('[nav] recast unavailable, enemies fall back to direct seek:', err?.message ?? err);
        return false;
      });
  }
  return loadPromise;
}

// Office metrics: 1 unit = 1 metre, player capsule r=0.42 h=1.7.
const NAV_CONFIG = {
  cs: 0.28,                     // cell size — corridors are >= 3 player widths
  ch: 0.22,
  walkableSlopeAngle: 45,
  walkableHeight: 8,            // ceil(1.7 / ch)
  walkableClimb: 2,             // ceil(0.4 / ch) — desk lips, thresholds
  walkableRadius: 2,            // ceil(0.42 / cs)
  maxEdgeLen: 12,
  maxSimplificationError: 1.3,
  minRegionArea: 8,
  mergeRegionArea: 20,
  maxVertsPerPoly: 6,
  detailSampleDist: 6,
  detailSampleMaxError: 1,
};

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class NavMesh {
  constructor() {
    this.navMesh = null;
    this.query = null;
    this.ready = false;
    this.stats = { buildMs: 0, polys: 0 };
    this._intermediates = [];
  }

  /**
   * @param {{rooms: Array<{x0:number,x1:number,z0:number,z1:number}>,
   *          colliders: Array<{minX:number,maxX:number,minZ:number,maxZ:number,h?:number,disabled?:boolean}>}} level
   * @returns {boolean} whether a usable navmesh was produced
   */
  build(level) {
    if (!recast || !generators) return false;
    const t0 = performance.now();
    this.dispose();

    const mesh = buildSourceMesh(level);
    try {
      const result = generators.threeToSoloNavMesh([mesh], NAV_CONFIG, false);
      mesh.geometry.dispose();
      if (!result.success || !result.navMesh) {
        console.warn('[nav] generation failed:', result.error ?? 'unknown');
        return false;
      }
      this.navMesh = result.navMesh;
      this.query = new recast.NavMeshQuery(this.navMesh);
      this.ready = true;
      this.stats = {
        buildMs: Math.round(performance.now() - t0),
        polys: this.navMesh.getMaxTiles?.() ?? 0,
      };
      return true;
    } catch (err) {
      mesh.geometry.dispose();
      console.warn('[nav] generation threw:', err?.message ?? err);
      return false;
    }
  }

  /** Snap an arbitrary point onto the walkable surface. */
  nearest(pos) {
    if (!this.ready) return null;
    const r = this.query.findClosestPoint({ x: pos.x, y: pos.y, z: pos.z });
    return r?.success === false ? null : (r?.point ?? r);
  }

  /**
   * @returns {THREE.Vector3[]|null} waypoints from start to end, or null if no path
   */
  findPath(start, end) {
    if (!this.ready) return null;
    try {
      const r = this.query.computePath(
        { x: start.x, y: start.y, z: start.z },
        { x: end.x, y: end.y, z: end.z },
      );
      if (!r?.success || !r.path?.length) return null;
      return r.path.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    } catch {
      return null;
    }
  }

  dispose() {
    try { this.query?.destroy?.(); } catch { /* wasm already torn down */ }
    try { this.navMesh?.destroy?.(); } catch { /* wasm already torn down */ }
    this.query = null;
    this.navMesh = null;
    this.ready = false;
  }
}

/**
 * Per-enemy pathing state. Keeps the cost sane: repaths on a timer, only when
 * the target has actually moved, and only when the direct line is blocked.
 * Falls straight through to direct seek when there is no navmesh.
 */
export class PathAgent {
  /**
   * @param {NavMesh} nav
   * @param {{repathInterval?: number, arriveDist?: number, targetDrift?: number}} opts
   */
  constructor(nav, { repathInterval = 0.55, arriveDist = 0.9, targetDrift = 2.5 } = {}) {
    this.nav = nav;
    this.repathInterval = repathInterval;
    this.arriveDist = arriveDist;
    this.targetDrift = targetDrift;
    this.path = null;
    this.index = 0;
    this.cooldown = Math.random() * repathInterval; // stagger the herd
    this.lastTarget = new THREE.Vector3(Infinity, 0, Infinity);
    this.failed = false;
  }

  /**
   * Ask for the direction to move this tick.
   * @param {THREE.Vector3} from current position
   * @param {THREE.Vector3} to desired destination
   * @param {number} dt
   * @param {boolean} directBlocked is the straight line obstructed?
   * @returns {THREE.Vector3|null} unit direction, or null to use direct seek
   */
  steer(from, to, dt, directBlocked) {
    if (!this.nav?.ready) return null;
    this.cooldown -= dt;

    // Clear line of sight: drop the path and beeline. Cheaper and looks better.
    if (!directBlocked) {
      this.path = null;
      return null;
    }

    const drifted = this.lastTarget.distanceToSquared(to) > this.targetDrift * this.targetDrift;
    if (!this.path || this.cooldown <= 0 || drifted) {
      this.cooldown = this.repathInterval;
      this.lastTarget.copy(to);
      this.path = this.nav.findPath(from, to);
      this.index = 0;
      this.failed = !this.path;
      if (this.path && this.path.length > 1) this.index = 1; // skip our own cell
    }
    if (!this.path || this.index >= this.path.length) return null;

    // advance past waypoints we've already reached
    while (this.index < this.path.length) {
      const wp = this.path[this.index];
      _a.set(wp.x - from.x, 0, wp.z - from.z);
      if (_a.lengthSq() > this.arriveDist * this.arriveDist) break;
      this.index++;
    }
    if (this.index >= this.path.length) { this.path = null; return null; }

    const wp = this.path[this.index];
    _b.set(wp.x - from.x, 0, wp.z - from.z);
    const len = _b.length();
    if (len < 1e-4) return null;
    return _b.divideScalar(len);
  }

  reset() { this.path = null; this.index = 0; this.cooldown = 0; }
}

/**
 * Synthesise the geometry recast should voxelise: room floors + obstacle boxes.
 * We build it from level data rather than the render scene so decorative meshes
 * (ceiling panels, signage, light strips) never confuse the walkable surface.
 */
function buildSourceMesh(level) {
  const pos = [];
  const idx = [];
  let v = 0;

  const quad = (x0, z0, x1, z1, y) => {
    pos.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
    idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
    v += 4;
  };

  const boxSolid = (minX, maxX, minZ, maxZ, h) => {
    const y0 = 0, y1 = h;
    const c = [
      [minX, y0, minZ], [maxX, y0, minZ], [maxX, y0, maxZ], [minX, y0, maxZ],
      [minX, y1, minZ], [maxX, y1, minZ], [maxX, y1, maxZ], [minX, y1, maxZ],
    ];
    for (const p of c) pos.push(p[0], p[1], p[2]);
    const f = [
      [4, 5, 6], [4, 6, 7],       // top
      [0, 2, 1], [0, 3, 2],       // bottom
      [0, 1, 5], [0, 5, 4],
      [1, 2, 6], [1, 6, 5],
      [2, 3, 7], [2, 7, 6],
      [3, 0, 4], [3, 4, 7],
    ];
    for (const t of f) idx.push(v + t[0], v + t[1], v + t[2]);
    v += 8;
  };

  // Floors. Rooms overlap at shared edges by design; recast merges them.
  for (const r of level.rooms ?? []) quad(r.x0, r.z0, r.x1, r.z1, 0);
  if (!level.rooms?.length && level._bounds) {
    const b = level._bounds;
    quad(b.minX, b.minZ, b.maxX, b.maxZ, 0);
  }

  // Obstacles. Anything under ~0.5u tall is a threshold, not a wall — enemies
  // step over those, so leaving them out avoids shredding the navmesh.
  for (const c of level.colliders ?? []) {
    const h = c.h ?? 5;
    if (c.disabled || h < 0.5) continue;
    boxSolid(c.minX, c.maxX, c.minZ, c.maxZ, Math.min(h, 5));
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo);
}

export { NAV_CONFIG, buildSourceMesh };
