import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { WorldBVH } from '../src/core/worldbvh.js';

// Two 20x20 rooms with a shared wall pierced by a single 3u door gap at z 2..5,
// plus a waist-high desk in the west room.
function makeLevel() {
  return {
    rooms: [
      { x0: -20, x1: 0, z0: -10, z1: 10 },
      { x0: 0, x1: 20, z0: -10, z1: 10 },
    ],
    colliders: [
      { minX: -0.2, maxX: 0.2, minZ: -10, maxZ: 2, h: 5 },
      { minX: -0.2, maxX: 0.2, minZ: 5, maxZ: 10, h: 5 },
      { minX: -8, maxX: -6, minZ: -4, maxZ: -2, h: 1.2, disabled: false },
    ],
    _bounds: { minX: -20, maxX: 20, minZ: -10, maxZ: 10 },
  };
}

describe('WorldBVH', () => {
  let level, bvh;
  beforeEach(() => {
    level = makeLevel();
    bvh = new WorldBVH();
    bvh.build(level);
  });

  it('builds one box per collider', () => {
    expect(bvh.bvh).toBeTruthy();
    expect(bvh.stats.boxes).toBe(3);
  });

  it('reports an exact hit distance rather than a stepped approximation', () => {
    // origin x=-5, wall face at x=-0.2 → exactly 4.8 away
    const hit = bvh.raycast(new THREE.Vector3(-5, 1.2, -5), new THREE.Vector3(1, 0, 0), 30);
    expect(hit).toBeTruthy();
    expect(hit.distance).toBeCloseTo(4.8, 2);
    expect(Number.isFinite(hit.normal.x)).toBe(true);
  });

  it('lets a ray through the door gap', () => {
    expect(bvh.raycast(new THREE.Vector3(-5, 1.2, 3.5), new THREE.Vector3(1, 0, 0), 30)).toBeNull();
  });

  // This is the tunnelling regression the old 0.7u ray march allowed: a wall
  // thinner than the step could sit entirely between two samples.
  it('does not tunnel through a wall thinner than the old sample step', () => {
    const thin = {
      rooms: [{ x0: -10, x1: 10, z0: -10, z1: 10 }],
      colliders: [{ minX: -0.05, maxX: 0.05, minZ: -10, maxZ: 10, h: 5 }],
      _bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
    };
    const b = new WorldBVH();
    b.build(thin);
    for (let i = 0; i < 50; i++) {
      const origin = new THREE.Vector3(-5 - i * 0.013, 1.2, -5);
      expect(b.raycast(origin, new THREE.Vector3(1, 0, 0), 30)).toBeTruthy();
    }
  });

  it('traces line of sight at the height it is asked for', () => {
    // desk is 1.2 tall: an eye at 1.6 sees over it, a knee at 0.6 does not
    expect(bvh.segmentBlocked(-12, 1.6, -3, -2, 1.6, -3)).toBe(false);
    expect(bvh.segmentBlocked(-12, 0.6, -3, -2, 0.6, -3)).toBe(true);
  });

  it('stops blocking once a destructible is smashed and the tree is refit', () => {
    expect(bvh.segmentBlocked(-12, 0.6, -3, -2, 0.6, -3)).toBe(true);
    level.colliders[2].disabled = true;
    bvh.markDirty();
    bvh.flush();
    expect(bvh.segmentBlocked(-12, 0.6, -3, -2, 0.6, -3)).toBe(false);
  });

  it('ignores flush() when nothing changed', () => {
    bvh.flush();
    expect(bvh.segmentBlocked(-12, 0.6, -3, -2, 0.6, -3)).toBe(true);
  });

  it('clamps camera pullback at the first wall', () => {
    const d = bvh.cameraDistance(new THREE.Vector3(-1, 1.5, -5), new THREE.Vector3(1, 0, 0), 6);
    expect(d).toBeGreaterThan(0.2);
    expect(d).toBeLessThan(1.2);
  });

  it('returns the requested distance when nothing is in the way', () => {
    const d = bvh.cameraDistance(new THREE.Vector3(-10, 1.5, 3.5), new THREE.Vector3(1, 0, 0), 4);
    expect(d).toBe(4);
  });

  it('answers ~20k rays per frame budget', () => {
    const dir = new THREE.Vector3(1, 0, 0);
    const o = new THREE.Vector3(-5, 1.2, -5);
    const t0 = performance.now();
    for (let i = 0; i < 20000; i++) { o.z = -9 + (i % 190) * 0.1; bvh.raycast(o, dir, 30); }
    // generous bound — this is a smoke alarm for an accidental O(n) regression,
    // not a benchmark assertion
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
