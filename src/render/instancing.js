// ============ InstancingManager ============
// A floor of this game is hundreds of repeated objects: chairs, monitors,
// papers, ceiling light panels, cubicle panels, pillars, bullet holes. Drawn
// individually that is a draw call each, and the CPU cost of issuing them is
// what caps the scene long before the GPU is troubled.
//
// Budget we are aiming at:
//   environment  30-100 draw calls
//   enemies      10-40
//   weapons/VFX  20-50
// rather than 3000.
//
// Usage:
//   const batch = instancing.batch('chair', geometry, material, 256);
//   const id = batch.add(position, quaternion, scale);   // returns a handle
//   batch.setColorAt(id, color);
//   batch.remove(id);                                    // swap-with-last, O(1)
//
// Instances are only worth it for things that share geometry AND material and
// do not need per-object logic. Anything that animates its own skeleton, or
// needs to be raycast individually, stays a normal Mesh.

import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();
const _hidden = new THREE.Matrix4().makeScale(0, 0, 0);

export class InstanceBatch {
  /**
   * @param {THREE.BufferGeometry} geometry
   * @param {THREE.Material} material
   * @param {number} capacity
   */
  constructor(name, geometry, material, capacity, { castShadow = true, receiveShadow = true, colors = false } = {}) {
    this.name = name;
    this.capacity = capacity;
    this.count = 0;
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.name = `inst:${name}`;
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = receiveShadow;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;   // one batch spans the floor; culling it as a unit is wrong
    if (colors) {
      this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
      this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    // slot -> stable handle, so removals can be O(1) swap-with-last without
    // invalidating every handle the caller is holding
    this._slotOfHandle = new Map();
    this._handleOfSlot = [];
    this._nextHandle = 1;
    this.mesh.count = 0;
  }

  /** @returns {number|null} stable handle, or null when full */
  add(position, quaternion = null, scale = null) {
    if (this.count >= this.capacity) return null;
    const slot = this.count++;
    const handle = this._nextHandle++;
    this._slotOfHandle.set(handle, slot);
    this._handleOfSlot[slot] = handle;
    this.setTransform(handle, position, quaternion, scale);
    this.mesh.count = this.count;
    return handle;
  }

  setTransform(handle, position, quaternion = null, scale = null) {
    const slot = this._slotOfHandle.get(handle);
    if (slot === undefined) return false;
    _m.compose(position, quaternion ?? _q.identity(), scale ?? _s.set(1, 1, 1));
    this.mesh.setMatrixAt(slot, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
    return true;
  }

  setColorAt(handle, color) {
    const slot = this._slotOfHandle.get(handle);
    if (slot === undefined || !this.mesh.instanceColor) return false;
    this.mesh.setColorAt(slot, _c.set(color));
    this.mesh.instanceColor.needsUpdate = true;
    return true;
  }

  /** O(1): move the last instance into the freed slot and shrink the count. */
  remove(handle) {
    const slot = this._slotOfHandle.get(handle);
    if (slot === undefined) return false;
    const last = this.count - 1;
    if (slot !== last) {
      this.mesh.getMatrixAt(last, _m);
      this.mesh.setMatrixAt(slot, _m);
      if (this.mesh.instanceColor) {
        this.mesh.getColorAt(last, _c);
        this.mesh.setColorAt(slot, _c);
      }
      const movedHandle = this._handleOfSlot[last];
      this._slotOfHandle.set(movedHandle, slot);
      this._handleOfSlot[slot] = movedHandle;
    }
    this._slotOfHandle.delete(handle);
    this._handleOfSlot.length = last;
    this.count = last;
    this.mesh.count = this.count;
    this.mesh.setMatrixAt(last, _hidden);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    return true;
  }

  clear() {
    this.count = 0;
    this.mesh.count = 0;
    this._slotOfHandle.clear();
    this._handleOfSlot.length = 0;
  }

  dispose() {
    this.mesh.dispose();
    this.clear();
  }

  get full() { return this.count >= this.capacity; }
}

export class InstancingManager {
  /** @param {THREE.Scene|THREE.Group} parent */
  constructor(parent) {
    this.parent = parent;
    /** @type {Map<string, InstanceBatch>} */
    this.batches = new Map();
  }

  /**
   * Get or create a batch. Keyed by name, so repeated calls with the same name
   * share one draw call.
   */
  batch(name, geometry, material, capacity = 256, opts = {}) {
    let b = this.batches.get(name);
    if (b) return b;
    b = new InstanceBatch(name, geometry, material, capacity, opts);
    this.parent.add(b.mesh);
    this.batches.set(name, b);
    return b;
  }

  get(name) { return this.batches.get(name) ?? null; }

  /**
   * Swallow an existing scene object into a batch keyed by its geometry+material
   * identity. The convenient path for level generation: build props normally,
   * then hand the repeated ones over.
   * @returns {{batch: InstanceBatch, handle: number}|null}
   */
  absorb(mesh, { capacity = 256, key = null } = {}) {
    if (!mesh.isMesh || Array.isArray(mesh.material)) return null;
    const k = key ?? `${mesh.geometry.uuid}:${mesh.material.uuid}`;
    const b = this.batch(k, mesh.geometry, mesh.material, capacity, {
      castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow,
    });
    mesh.updateWorldMatrix(true, false);
    mesh.matrixWorld.decompose(_pos, _quat, _scale);
    const handle = b.add(_pos, _quat, _scale);
    if (handle === null) return null;
    mesh.parent?.remove(mesh);
    return { batch: b, handle };
  }

  clear() {
    for (const b of this.batches.values()) b.clear();
  }

  dispose() {
    for (const b of this.batches.values()) {
      this.parent.remove(b.mesh);
      b.dispose();
    }
    this.batches.clear();
  }

  stats() {
    let instances = 0;
    for (const b of this.batches.values()) instances += b.count;
    return { batches: this.batches.size, instances, drawCallsSaved: Math.max(0, instances - this.batches.size) };
  }
}

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
