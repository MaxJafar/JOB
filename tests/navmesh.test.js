import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import { loadNav, NavMesh, PathAgent } from '../src/core/navmesh.js';

// Same two-room-one-door layout as the BVH tests: the ONLY route from the west
// room to the east room is the z 2..5 gap, so any valid path must detour north.
const level = {
  rooms: [
    { x0: -20, x1: 0, z0: -10, z1: 10 },
    { x0: 0, x1: 20, z0: -10, z1: 10 },
  ],
  colliders: [
    { minX: -0.2, maxX: 0.2, minZ: -10, maxZ: 2, h: 5 },
    { minX: -0.2, maxX: 0.2, minZ: 5, maxZ: 10, h: 5 },
  ],
  _bounds: { minX: -20, maxX: 20, minZ: -10, maxZ: 10 },
};

let nav;

beforeAll(async () => {
  expect(await loadNav()).toBe(true);
  nav = new NavMesh();
  expect(nav.build(level)).toBe(true);
});

afterAll(() => nav?.dispose());

describe('NavMesh', () => {
  it('reports a build time, not a hang', () => {
    expect(nav.ready).toBe(true);
    expect(nav.stats.buildMs).toBeLessThan(2000);
  });

  it('snaps an arbitrary point onto the walkable surface', () => {
    const p = nav.nearest(new THREE.Vector3(-10, 0, 0));
    expect(p).toBeTruthy();
    expect(Number.isFinite(p.x)).toBe(true);
  });

  it('routes around the wall instead of through it', () => {
    const path = nav.findPath(new THREE.Vector3(-15, 0, -8), new THREE.Vector3(15, 0, -8));
    expect(path).toBeTruthy();
    expect(path.length).toBeGreaterThan(1);
    // straight line would stay at z = -8; the only door is at z 2..5
    expect(Math.max(...path.map((p) => p.z))).toBeGreaterThan(1);
  });

  it('produces a path longer than the straight line when blocked', () => {
    const a = new THREE.Vector3(-15, 0, -8);
    const b = new THREE.Vector3(15, 0, -8);
    const path = nav.findPath(a, b);
    let len = 0;
    for (let i = 1; i < path.length; i++) len += path[i].distanceTo(path[i - 1]);
    expect(len).toBeGreaterThan(a.distanceTo(b));
  });

  it('returns null rather than throwing for an off-mesh destination', () => {
    const path = nav.findPath(new THREE.Vector3(-15, 0, -8), new THREE.Vector3(9999, 0, 9999));
    expect(path === null || Array.isArray(path)).toBe(true);
  });
});

describe('PathAgent', () => {
  it('yields to direct seek when the line of sight is clear', () => {
    const agent = new PathAgent(nav);
    const dir = agent.steer(new THREE.Vector3(-15, 0, -8), new THREE.Vector3(-10, 0, -8), 0.1, false);
    expect(dir).toBeNull();
  });

  it('returns a unit steering direction when blocked', () => {
    const agent = new PathAgent(nav);
    const dir = agent.steer(new THREE.Vector3(-15, 0, -8), new THREE.Vector3(15, 0, -8), 1, true);
    expect(dir).toBeTruthy();
    expect(dir.length()).toBeCloseTo(1, 5);
    expect(dir.y).toBe(0);
  });

  it('degrades to direct seek when there is no navmesh at all', () => {
    const agent = new PathAgent(new NavMesh());   // never built
    expect(agent.steer(new THREE.Vector3(), new THREE.Vector3(5, 0, 5), 0.1, true)).toBeNull();
  });

  it('walks the path toward the goal over repeated ticks', () => {
    const agent = new PathAgent(nav, { repathInterval: 0.5 });
    const pos = new THREE.Vector3(-15, 0, -8);
    const goal = new THREE.Vector3(15, 0, -8);
    const startDist = pos.distanceTo(goal);
    for (let i = 0; i < 600; i++) {
      const dir = agent.steer(pos, goal, 1 / 60, true);
      const d = dir ?? goal.clone().sub(pos).setY(0).normalize();
      pos.addScaledVector(d, 6 / 60);
      if (pos.distanceTo(goal) < 1.5) break;
    }
    expect(pos.distanceTo(goal)).toBeLessThan(startDist * 0.5);
  });

  it('staggers initial repath timers so a horde does not path in lockstep', () => {
    const cds = new Set();
    for (let i = 0; i < 30; i++) cds.add(new PathAgent(nav).cooldown);
    expect(cds.size).toBeGreaterThan(1);
  });
});
