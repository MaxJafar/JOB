// ============ static world BVH (three-mesh-bvh) ============
// Replaces two hot O(n) loops that both scanned every collider on the floor:
//
//   game.raycastAim()  — sampled points every 0.7u along the ray and tested each
//                        against every collider. Cheap-ish, but it tunnels through
//                        thin walls and its cost is (range/0.7) x colliders.
//   level.losBlocked() — segment-vs-AABB against every collider, called by every
//                        enemy every think tick.
//
// The BVH is built from the SAME AABB list the movement collision uses, not from
// render meshes. That is deliberate: if bullets and bodies disagreed about what
// is solid you get "I shot through the desk I can't walk through" bugs. Same
// semantics, log-time queries, and exact hits instead of 0.7u stepping.

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

const VERTS_PER_BOX = 24;
const INDICES_PER_BOX = 36;

// unit cube: 6 faces x 4 corners, matching THREE.BoxGeometry winding
const FACES = [
  { n: [1, 0, 0], v: [[1, 1, -1], [1, 1, 1], [1, -1, 1], [1, -1, -1]] },
  { n: [-1, 0, 0], v: [[-1, 1, 1], [-1, 1, -1], [-1, -1, -1], [-1, -1, 1]] },
  { n: [0, 1, 0], v: [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, -1, 0], v: [[-1, -1, 1], [1, -1, 1], [1, -1, -1], [-1, -1, -1]] },
  { n: [0, 0, 1], v: [[-1, 1, 1], [1, 1, 1], [1, -1, 1], [-1, -1, 1]] },
  { n: [0, 0, -1], v: [[1, 1, -1], [-1, 1, -1], [-1, -1, -1], [1, -1, -1]] },
];

const _ray = new THREE.Ray();
const _dir = new THREE.Vector3();
const _from = new THREE.Vector3();

export class WorldBVH {
  constructor() {
    this.bvh = null;
    this.geometry = null;
    this.records = [];      // level collider records, index-aligned with boxes
    this.positions = null;
    this._dirty = false;
    this.stats = { boxes: 0, buildMs: 0 };
  }

  /**
   * (Re)build the acceleration structure for a floor.
   * @param {{colliders: Array<{minX:number,maxX:number,minZ:number,maxZ:number,h?:number,disabled?:boolean}>}} level
   */
  build(level) {
    const t0 = performance.now();
    const src = level.colliders;
    const n = src.length;
    this.records = src;

    const positions = new Float32Array(n * VERTS_PER_BOX * 3);
    const normals = new Float32Array(n * VERTS_PER_BOX * 3);
    const indices = new Uint32Array(n * INDICES_PER_BOX);

    for (let i = 0; i < n; i++) {
      this._writeBox(positions, normals, indices, i, src[i]);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));

    this.geometry?.dispose();
    this.geometry = geo;
    this.positions = positions;
    this.bvh = new MeshBVH(geo, { targetLeafSize: 8, strategy: 0 });
    this._dirty = false;
    this.stats = { boxes: n, buildMs: performance.now() - t0 };
  }

  _writeBox(positions, normals, indices, i, c) {
    const vBase = i * VERTS_PER_BOX;
    const pBase = vBase * 3;
    const iBase = i * INDICES_PER_BOX;

    // A disabled collider (smashed furniture) collapses to a degenerate point so
    // it stops blocking without invalidating the vertex layout.
    const dead = !!c.disabled;
    const cx = (c.minX + c.maxX) / 2;
    const cz = (c.minZ + c.maxZ) / 2;
    const h = c.h ?? 5;
    const cy = h / 2;
    const hx = dead ? 0 : (c.maxX - c.minX) / 2;
    const hy = dead ? 0 : h / 2;
    const hz = dead ? 0 : (c.maxZ - c.minZ) / 2;

    let vi = 0;
    for (let f = 0; f < 6; f++) {
      const face = FACES[f];
      for (let k = 0; k < 4; k++) {
        const o = pBase + vi * 3;
        positions[o] = cx + face.v[k][0] * hx;
        positions[o + 1] = cy + face.v[k][1] * hy;
        positions[o + 2] = cz + face.v[k][2] * hz;
        normals[o] = face.n[0];
        normals[o + 1] = face.n[1];
        normals[o + 2] = face.n[2];
        vi++;
      }
      const q = vBase + f * 4;
      const t = iBase + f * 6;
      indices[t] = q; indices[t + 1] = q + 1; indices[t + 2] = q + 2;
      indices[t + 3] = q; indices[t + 4] = q + 2; indices[t + 5] = q + 3;
    }
  }

  /** Call when a destructible breaks (or a paid door opens). Cheap; batched. */
  markDirty() { this._dirty = true; }

  /** Fold pending collider changes into the tree. Once per frame at most. */
  flush() {
    if (!this._dirty || !this.bvh) return;
    for (let i = 0; i < this.records.length; i++) {
      this._writeBox(this.positions, this.geometry.attributes.normal.array,
        this.geometry.index.array, i, this.records[i]);
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.bvh.refit();
    this._dirty = false;
  }

  /**
   * First solid hit along a ray.
   * @returns {{point: THREE.Vector3, distance: number, normal: THREE.Vector3, faceIndex: number}|null}
   */
  raycast(origin, dir, maxDist = 200) {
    if (!this.bvh) return null;
    _ray.origin.copy(origin);
    _ray.direction.copy(dir).normalize();
    const hit = this.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, maxDist);
    return hit ?? null;
  }

  /** Is anything solid between two points? Used for AI line of sight. */
  segmentBlocked(ax, ay, az, bx, by, bz) {
    if (!this.bvh) return false;
    _from.set(ax, ay, az);
    _dir.set(bx - ax, by - ay, bz - az);
    const len = _dir.length();
    if (len < 1e-4) return false;
    _dir.divideScalar(len);
    _ray.origin.copy(_from);
    _ray.direction.copy(_dir);
    return !!this.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, len);
  }

  /**
   * Camera collision for the third-person rig: how far can the camera pull back
   * from `pivot` along `dir` before it clips geometry?
   */
  cameraDistance(pivot, dir, want, pad = 0.28) {
    const hit = this.raycast(pivot, dir, want + pad);
    if (!hit) return want;
    return Math.max(0.25, hit.distance - pad);
  }

  dispose() {
    this.geometry?.dispose();
    this.geometry = null;
    this.bvh = null;
    this.records = [];
    this.positions = null;
  }
}
