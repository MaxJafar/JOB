import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import { loadPhysics, PhysicsWorld } from '../src/core/physics.js';

// A room with a solid waist-high desk in the middle. Gibs dropped above the desk
// must land ON it, not sink through — that is the whole point of moving debris
// off the y=0 bouncer.
const level = {
  rooms: [{ x0: -10, x1: 10, z0: -10, z1: 10 }],
  colliders: [
    { minX: -10, maxX: -9.6, minZ: -10, maxZ: 10, h: 5 },
    { minX: -2, maxX: 2, minZ: -2, maxZ: 2, h: 1.2 },
  ],
  _bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
};

function gibMesh(x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.25));
  m.position.set(x, y, z);
  return m;
}

let phys;

beforeAll(async () => {
  expect(await loadPhysics()).toBe(true);
  phys = new PhysicsWorld();
  expect(phys.init()).toBe(true);
  phys.syncLevel(level, 4.3);
});

afterAll(() => phys?.dispose());

describe('PhysicsWorld', () => {
  it('mirrors the level colliders plus ground and ceiling', () => {
    expect(phys.levelBodies.length).toBe(level.colliders.length + 2);
    expect(phys.colliderByOwner.size).toBe(level.colliders.length);
  });

  it('settles a gib on the floor without letting it fall through', () => {
    phys.clearGibs();
    const m = gibMesh(6, 3, 6);
    phys.addGib(m, { ttl: 60 });
    for (let i = 0; i < 180; i++) phys.update(1 / 60);
    expect(m.position.y).toBeGreaterThan(0);
    expect(m.position.y).toBeLessThan(0.4);
  });

  it('lands a gib on top of the desk, not inside it', () => {
    phys.clearGibs();
    const m = gibMesh(0, 3, 0);   // directly above the 1.2-tall desk
    phys.addGib(m, { ttl: 60 });
    for (let i = 0; i < 240; i++) phys.update(1 / 60);
    expect(m.position.y).toBeGreaterThan(1.2);
    expect(m.position.y).toBeLessThan(1.7);
  });

  it('stops colliding once the desk is smashed', () => {
    phys.setColliderEnabled(level.colliders[1], false);
    phys.clearGibs();
    const m = gibMesh(0, 3, 0);
    phys.addGib(m, { ttl: 60 });
    for (let i = 0; i < 240; i++) phys.update(1 / 60);
    expect(m.position.y).toBeLessThan(0.4);
    phys.setColliderEnabled(level.colliders[1], true);
  });

  it('copies body transforms onto the mesh every tick', () => {
    phys.clearGibs();
    const m = gibMesh(5, 4, 5);
    const g = phys.addGib(m, { vel: new THREE.Vector3(2, 0, 0), ttl: 60 });
    phys.update(1 / 60);
    const t = g.body.translation();
    expect(m.position.x).toBeCloseTo(t.x, 6);
    expect(m.position.y).toBeCloseTo(t.y, 6);
  });

  it('retires gibs when their ttl expires and detaches the mesh', () => {
    phys.clearGibs();
    const parent = new THREE.Group();
    const m = gibMesh(4, 2, 4);
    parent.add(m);
    phys.addGib(m, { ttl: 0.1 });
    expect(phys.gibs.length).toBe(1);
    for (let i = 0; i < 20; i++) phys.update(1 / 60);
    expect(phys.gibs.length).toBe(0);
    expect(m.parent).toBeNull();
  });

  it('recycles retired bodies instead of leaking them', () => {
    phys.clearGibs();
    phys.gibPool.length = 0;
    const m = gibMesh(3, 2, 3);
    phys.addGib(m, { ttl: 0.05 });
    for (let i = 0; i < 10; i++) phys.update(1 / 60);
    expect(phys.gibPool.length).toBe(1);
    phys.addGib(gibMesh(3, 2, 3), { ttl: 60 });
    expect(phys.gibPool.length).toBe(0);   // reused, not re-allocated
  });

  it('enforces the gib cap so a mass death cannot unbound the world', () => {
    phys.clearGibs();
    for (let i = 0; i < 400; i++) phys.addGib(gibMesh(i % 8, 2, (i % 5) - 2), { ttl: 60 });
    expect(phys.gibs.length).toBeLessThanOrEqual(140);
  });

  it('shoves gibs away from an explosion', () => {
    phys.clearGibs();
    const m = gibMesh(1, 0.3, 0);
    phys.addGib(m, { ttl: 60 });
    for (let i = 0; i < 30; i++) phys.update(1 / 60);
    const before = m.position.clone();
    phys.kick(new THREE.Vector3(0, 0.3, 0), 6, 30);
    for (let i = 0; i < 20; i++) phys.update(1 / 60);
    expect(m.position.distanceTo(before)).toBeGreaterThan(0.2);
  });

  it('never produces a non-finite transform', () => {
    phys.clearGibs();
    for (let i = 0; i < 60; i++) {
      phys.addGib(gibMesh((i % 9) - 4, 2 + (i % 3), (i % 7) - 3), {
        vel: new THREE.Vector3(Math.sin(i) * 12, 6, Math.cos(i) * 12),
        angVel: new THREE.Vector3(i, -i, i * 0.5),
        ttl: 60,
      });
    }
    for (let i = 0; i < 300; i++) phys.update(1 / 60);
    for (const g of phys.gibs) {
      const t = g.body.translation();
      expect(Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z)).toBe(true);
      expect(t.y).toBeGreaterThan(-1);
    }
  });

  it('caps sub-steps so a long stall cannot spiral', () => {
    phys.clearGibs();
    phys.addGib(gibMesh(0, 2, 0), { ttl: 60 });
    const t0 = performance.now();
    phys.update(10);        // a ten-second hitch
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe('CharacterMotor', () => {
  // The motor's contract is move() then step(); these helpers keep the tests
  // honest about that ordering rather than exercising a pattern the game
  // never uses.
  function tick(motor, pos, disp, n) {
    for (let i = 0; i < n; i++) {
      motor.move(pos, disp);
      phys.update(1 / 60);
    }
  }

  it('stops the capsule at a wall instead of passing through it', () => {
    const motor = phys.createMotor({ radius: 0.42, height: 1.1 });
    expect(motor).toBeTruthy();
    const pos = new THREE.Vector3(-5, 0, 5);
    motor.teleport(pos);
    tick(motor, pos, new THREE.Vector3(-0.15, -0.05, 0), 200);   // walk west into the wall
    expect(pos.x).toBeGreaterThan(-9.7);
    expect(Number.isFinite(pos.x)).toBe(true);
    motor.dispose();
  });

  it('falls and reports grounded once it has settled on the floor', () => {
    const motor = phys.createMotor({ radius: 0.42, height: 1.1 });
    const pos = new THREE.Vector3(6, 1.5, 6);
    motor.teleport(pos);
    tick(motor, pos, new THREE.Vector3(0, -0.08, 0), 120);
    expect(motor.grounded).toBe(true);
    expect(pos.y).toBeGreaterThan(-0.2);
    expect(pos.y).toBeLessThan(0.2);
    motor.dispose();
  });

  it('walks freely across open floor', () => {
    const motor = phys.createMotor({ radius: 0.42, height: 1.1 });
    const pos = new THREE.Vector3(6, 0, -6);
    motor.teleport(pos);
    const x0 = pos.x;
    tick(motor, pos, new THREE.Vector3(-0.05, -0.05, 0), 60);
    expect(pos.x).toBeLessThan(x0 - 1);
    motor.dispose();
  });
});
