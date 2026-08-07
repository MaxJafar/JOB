// ============ Rapier physics layer ============
// Scope, deliberately narrow (see docs/ENGINE.md):
//   * WORLD      — level AABB colliders mirrored as fixed cuboids so anything
//                  physical collides with the real floor plan, not just y=0.
//   * DEBRIS     — Lego gibs & furniture shrapnel as pooled dynamic bodies.
//                  Purely cosmetic: never touches the authoritative sim, so it
//                  needs no netcode and no determinism guarantees.
//   * MOTOR      — a KinematicCharacterController wrapper for the player capsule.
//                  Rapier's own docs say character movement stays game-specific,
//                  so this is a motor we drive, not a controller we obey. It is
//                  OPT-IN (settings.physicsMotor) because the existing dash /
//                  slide / momentum feel in TUNE is hand-tuned and shipping.
//
// Everything degrades gracefully: if the WASM fails to load, `ready` stays false
// and every call is a no-op, so the game runs exactly as it did before.

import * as THREE from 'three';

/** @type {any} */
let RAPIER = null;
let loadPromise = null;

const GIB_CAP = 140;
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

/**
 * Load the Rapier WASM module exactly once. Safe to call from anywhere;
 * concurrent callers share the same promise.
 * @returns {Promise<boolean>} true when physics is usable
 */
export async function loadPhysics() {
  if (RAPIER) return true;
  if (!loadPromise) {
    loadPromise = import('@dimforge/rapier3d-compat')
      .then(async (mod) => {
        const api = mod.default ?? mod;
        await api.init({});   // object form; the positional signature is deprecated
        RAPIER = api;
        return true;
      })
      .catch((err) => {
        console.warn('[physics] Rapier unavailable, falling back to legacy motion:', err?.message ?? err);
        return false;
      });
  }
  return loadPromise;
}

export class PhysicsWorld {
  constructor() {
    this.ready = false;
    this.world = null;
    this.gibs = [];          // { body, collider, mesh, ttl, life }
    this.gibPool = [];       // recycled { body, collider }
    this.levelBodies = [];   // fixed bodies mirroring level.colliders
    this.colliderByOwner = new Map(); // level collider record -> rapier collider
    this.accum = 0;
    this.step = 1 / 60;
    this.stats = { bodies: 0, stepMs: 0 };
  }

  /** @returns {boolean} */
  init() {
    if (!RAPIER || this.world) return this.ready;
    this.world = new RAPIER.World({ x: 0, y: -26, z: 0 });
    this.world.timestep = this.step;
    // Small integration-parameter tweak: gibs are tiny and fast, so give the
    // solver a touch more room than the default before it calls things resting.
    this.world.integrationParameters.numSolverIterations = 4;
    this.ready = true;
    return true;
  }

  // ================= world geometry =================

  /**
   * Mirror a Level's AABB collider list into Rapier as static cuboids, plus a
   * ground plane and a ceiling. Call once per floor build.
   * @param {{colliders: Array<any>, _bounds?: any}} level
   * @param {number} ceilH
   */
  syncLevel(level, ceilH = 4.3) {
    if (!this.ready) return;
    this.clearLevel();
    const wallY = 5;

    // Ground and ceiling are sized to the ACTUAL floor plan plus a margin.
    // A previous version used a fixed 800x800 slab; at that scale Rapier's
    // shape-casts lose enough precision that snapToGround drags the character
    // capsule straight through the floor. Keep world geometry near gameplay
    // scale — an oversized "just in case" collider is not free.
    const b = boundsOf(level);
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const hx = (b.maxX - b.minX) / 2 + 12;
    const hz = (b.maxZ - b.minZ) / 2 + 12;
    this._addStatic(cx, -0.5, cz, hx, 0.5, hz);

    for (const c of level.colliders) {
      const hx = (c.maxX - c.minX) / 2;
      const hz = (c.maxZ - c.minZ) / 2;
      const h = c.h ?? wallY;
      if (hx <= 0.01 || hz <= 0.01 || h <= 0.01) continue;
      const col = this._addStatic(
        (c.minX + c.maxX) / 2, h / 2, (c.minZ + c.maxZ) / 2,
        hx, h / 2, hz,
      );
      this.colliderByOwner.set(c, col);
      if (c.disabled) col.setEnabled(false);
    }

    // ceiling so gibs never escape the building
    if (ceilH > 0) this._addStatic(cx, ceilH + 0.5, cz, hx, 0.5, hz);
  }

  /** Broken furniture disables its AABB — keep Rapier in step with that. */
  setColliderEnabled(levelCollider, on) {
    const col = this.colliderByOwner.get(levelCollider);
    if (col) col.setEnabled(on);
  }

  _addStatic(x, y, z, hx, hy, hz) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z),
    );
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.85).setRestitution(0.1),
      body,
    );
    this.levelBodies.push(body);
    return col;
  }

  clearLevel() {
    if (!this.ready) return;
    for (const b of this.levelBodies) this.world.removeRigidBody(b);
    this.levelBodies.length = 0;
    this.colliderByOwner.clear();
  }

  // ================= debris =================

  /**
   * Hand a three.js mesh to the physics world as a tumbling dynamic box.
   * The caller keeps ownership of the mesh; we only drive its transform.
   * @param {THREE.Mesh} mesh already positioned/rotated in world space
   * @param {{vel?: THREE.Vector3, angVel?: THREE.Vector3, ttl?: number}} opts
   */
  addGib(mesh, { vel = null, angVel = null, ttl = 2.2 } = {}) {
    if (!this.ready) return null;
    if (this.gibs.length >= GIB_CAP) this._retireGib(0);

    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    _box.copy(mesh.geometry.boundingBox);
    _box.getSize(_size);
    const hx = Math.max(0.03, (_size.x * Math.abs(mesh.scale.x)) / 2);
    const hy = Math.max(0.03, (_size.y * Math.abs(mesh.scale.y)) / 2);
    const hz = Math.max(0.03, (_size.z * Math.abs(mesh.scale.z)) / 2);

    let entry = this.gibPool.pop();
    if (entry) {
      // reuse: resize the collider rather than churning allocations
      entry.collider.setHalfExtents({ x: hx, y: hy, z: hz });
      entry.body.setEnabled(true);
    } else {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setLinearDamping(0.12)
          .setAngularDamping(0.35)
          .setCcdEnabled(true),
      );
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy, hz)
          .setFriction(0.7)
          .setRestitution(0.34)
          .setDensity(1.4),
        body,
      );
      entry = { body, collider };
    }

    const b = entry.body;
    b.setTranslation({ x: mesh.position.x, y: Math.max(hy, mesh.position.y), z: mesh.position.z }, true);
    b.setRotation({ x: mesh.quaternion.x, y: mesh.quaternion.y, z: mesh.quaternion.z, w: mesh.quaternion.w }, true);
    b.setLinvel(vel ? { x: vel.x, y: vel.y, z: vel.z } : { x: 0, y: 0, z: 0 }, true);
    b.setAngvel(angVel ? { x: angVel.x, y: angVel.y, z: angVel.z } : { x: 0, y: 0, z: 0 }, true);
    b.wakeUp();

    const g = { ...entry, mesh, ttl, life: ttl };
    this.gibs.push(g);
    return g;
  }

  /** Shockwave: shove every nearby gib. Used by explosions & boss slams. */
  kick(pos, radius, force) {
    if (!this.ready) return;
    const r2 = radius * radius;
    for (const g of this.gibs) {
      const t = g.body.translation();
      const dx = t.x - pos.x, dy = t.y - pos.y, dz = t.z - pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      const d = Math.max(0.3, Math.sqrt(d2));
      const k = (1 - d / radius) * force;
      g.body.applyImpulse({ x: (dx / d) * k, y: (dy / d) * k + k * 0.5, z: (dz / d) * k }, true);
    }
  }

  _retireGib(i) {
    const g = this.gibs[i];
    if (!g) return;
    g.body.setEnabled(false);
    g.body.sleep();
    this.gibPool.push({ body: g.body, collider: g.collider });
    if (g.mesh.parent) g.mesh.parent.remove(g.mesh);
    this.gibs.splice(i, 1);
  }

  clearGibs() {
    for (let i = this.gibs.length - 1; i >= 0; i--) this._retireGib(i);
  }

  // ================= character motor =================

  /**
   * A kinematic capsule + character controller for the player. We supply the
   * desired translation from our own movement code; Rapier only tells us how
   * much of it actually fits. Feel stays ours.
   */
  createMotor({ radius = 0.42, height = 1.1, offset = 0.02 } = {}) {
    if (!this.ready) return null;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, height, 0),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(height / 2, radius),
      body,
    );
    const ctrl = this.world.createCharacterController(offset);
    ctrl.setUp({ x: 0, y: 1, z: 0 });
    ctrl.enableAutostep(0.45, 0.25, true);   // vault low ledges / desk lips
    ctrl.enableSnapToGround(0.35);           // no stutter on ramps & thresholds
    ctrl.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    ctrl.setMinSlopeSlideAngle((38 * Math.PI) / 180);
    ctrl.setApplyImpulsesToDynamicBodies(true); // kick gibs around while running
    ctrl.setCharacterMass(80);
    return new CharacterMotor(this, body, collider, ctrl, radius, height);
  }

  // ================= tick =================

  /**
   * Fixed-step the physics world and copy transforms back onto the meshes.
   * @param {number} dt frame delta in seconds (already time-scaled)
   */
  update(dt) {
    if (!this.ready) return;
    const t0 = performance.now();
    this.accum = Math.min(this.accum + dt, 0.2); // never spiral after a stall
    let steps = 0;
    while (this.accum >= this.step && steps < 5) {
      this.world.step();
      this.accum -= this.step;
      steps++;
    }

    for (let i = this.gibs.length - 1; i >= 0; i--) {
      const g = this.gibs[i];
      g.ttl -= dt;
      if (g.ttl <= 0) { this._retireGib(i); continue; }
      const t = g.body.translation();
      const r = g.body.rotation();
      g.mesh.position.set(t.x, t.y, t.z);
      g.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      if (g.ttl < 0.35) g.mesh.scale.multiplyScalar(Math.max(0.01, 1 - dt * 4)); // Lego cleanup crew
    }

    this.stats.bodies = this.gibs.length;
    this.stats.stepMs = performance.now() - t0;
  }

  dispose() {
    this.clearGibs();
    this.clearLevel();
    for (const e of this.gibPool) this.world?.removeRigidBody(e.body);
    this.gibPool.length = 0;
    this.world?.free?.();
    this.world = null;
    this.ready = false;
  }
}

/**
 * Thin wrapper around Rapier's KinematicCharacterController.
 * Usage per tick: motor.move(pos, displacement) -> writes the resolved position
 * back into `pos` and reports whether we ended up grounded.
 */
export class CharacterMotor {
  constructor(phys, body, collider, ctrl, radius, height) {
    this.phys = phys;
    this.body = body;
    this.collider = collider;
    this.ctrl = ctrl;
    this.radius = radius;
    this.height = height;
    // A Rapier capsule is built from a half-height PLUS two hemisphere caps, so
    // the distance from its centre down to the feet is halfHeight + radius —
    // not the half-height alone. Getting this wrong buries the capsule or
    // floats it, and both read as "the character controller is broken".
    this.footOffset = height / 2 + radius;
    this.grounded = false;
  }

  /**
   * Teleport (respawn, elevator, floor change) — skips collision resolution.
   * Sets both the current and next transform so a step in flight cannot drag
   * the capsule back to where it used to be.
   */
  teleport(pos) {
    const t = { x: pos.x, y: pos.y + this.footOffset, z: pos.z };
    this.body.setTranslation(t, true);
    this.body.setNextKinematicTranslation(t);
  }

  /**
   * Canonical Rapier kinematic-character flow, and the ordering matters:
   *   read the collider's CURRENT position -> ask the controller how much of the
   *   desired move fits -> write the result as the NEXT kinematic translation.
   *
   * The obvious-looking version (setTranslation on the body, then immediately
   * computeColliderMovement) silently reads a stale collider pose, because a
   * collider attached to a body only picks up the body's transform when the
   * world steps. The character then resolves against where it used to be.
   *
   * Caller contract: PhysicsWorld.update() must step the world each frame.
   *
   * @param {THREE.Vector3} pos feet position, mutated in place
   * @param {THREE.Vector3} disp desired displacement this tick
   * @returns {boolean} grounded after the move
   */
  move(pos, disp) {
    const here = this.body.translation();
    this.ctrl.computeColliderMovement(this.collider, { x: disp.x, y: disp.y, z: disp.z });
    const m = this.ctrl.computedMovement();
    this.grounded = this.ctrl.computedGrounded();

    // Never write to the collider directly: on a collider attached to a body,
    // setTranslation is interpreted relative to that parent, which quietly
    // desyncs the shape from the body and makes the character fall through the
    // floor. The body owns the transform; the step propagates it.
    const next = { x: here.x + m.x, y: here.y + m.y, z: here.z + m.z };
    this.body.setNextKinematicTranslation(next);

    pos.x = next.x;
    pos.y = next.y - this.footOffset;
    pos.z = next.z;
    return this.grounded;
  }

  dispose() {
    this.phys.world?.removeRigidBody(this.body);
  }
}

/**
 * Extent of a floor, preferring the level's own bounds and falling back to the
 * collider list (which is what the tests and the navmesh source mesh use).
 */
function boundsOf(level) {
  if (level._bounds) return level._bounds;
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const r of level.rooms ?? []) {
    b.minX = Math.min(b.minX, r.x0); b.maxX = Math.max(b.maxX, r.x1);
    b.minZ = Math.min(b.minZ, r.z0); b.maxZ = Math.max(b.maxZ, r.z1);
  }
  for (const c of level.colliders ?? []) {
    b.minX = Math.min(b.minX, c.minX); b.maxX = Math.max(b.maxX, c.maxX);
    b.minZ = Math.min(b.minZ, c.minZ); b.maxZ = Math.max(b.maxZ, c.maxZ);
  }
  if (!Number.isFinite(b.minX)) return { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
  return b;
}

// re-exported so callers can feature-detect without importing the WASM module
export function physicsAvailable() { return !!RAPIER; }
export { _v, _q, _s, boundsOf };
