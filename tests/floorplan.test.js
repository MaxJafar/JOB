import { describe, it, expect } from 'vitest';
import { planFloor, computeAdjacency, pairKey, PLAN_DOOR_W } from '../src/game/floorplan.js';
import { FLOORS } from '../src/game/config.js';

// v4 labyrinth invariants, hammered across many seeds — the successor to the
// v0.36 "verified over 200 generated levels" pass, now running in CI.

const SEEDS = Array.from({ length: 40 }, (_, i) => 1000 + i * 7919);
const hubFloors = FLOORS.filter((f) => !f.isFinal);

function overlapArea(a, b) {
  const x = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const z = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
  return Math.max(0, x) * Math.max(0, z);
}

describe('floorplan v4', () => {
  it('every hub floor × 40 seeds: big, non-overlapping, connected, 4 stairs, a lair', () => {
    for (const def of hubFloors) {
      for (const seed of SEEDS) {
        const plan = planFloor(seed, def);
        const { rooms, sealed } = plan;
        const label = `${def.key}@${seed}`;

        // scale: this should feel like a floor plate, not a lobby
        expect(rooms.length, label).toBeGreaterThanOrEqual(18);
        expect(rooms.filter((r) => r.type === 'corridor').length, label).toBeGreaterThanOrEqual(8);

        // geometry: inside the plate, and no two rooms overlap
        const hw = def.size[0] / 2, hd = def.size[1] / 2;
        for (const r of rooms) {
          expect(r.x0, label).toBeGreaterThanOrEqual(-hw - 0.01);
          expect(r.x1, label).toBeLessThanOrEqual(hw + 0.01);
          expect(r.z0, label).toBeGreaterThanOrEqual(-hd - 0.01);
          expect(r.z1, label).toBeLessThanOrEqual(hd + 0.01);
        }
        for (let i = 0; i < rooms.length; i++) {
          for (let j = i + 1; j < rooms.length; j++) {
            expect(overlapArea(rooms[i], rooms[j]), `${label} overlap ${i}/${j}`).toBeLessThan(0.01);
          }
        }

        // stairs: four, on four distinct sides, rooms marked for the landing code
        expect(plan.stairs.length, label).toBe(4);
        expect(new Set(plan.stairs.map((s) => s.side)).size, label).toBe(4);
        for (const s of plan.stairs) expect(rooms[s.roomId].arrivalSide, label).toBe(s.side);

        // the floor lead's office exists and is a real room
        expect(plan.lairId, label).not.toBeNull();
        const lair = rooms[plan.lairId];
        expect(lair.type, label).toBe('lair');
        expect(Math.min(lair.x1 - lair.x0, lair.z1 - lair.z0), label).toBeGreaterThanOrEqual(7.9);

        // every open doorway must actually fit a door
        const adjacency = computeAdjacency(rooms);
        for (const p of adjacency) {
          if (!sealed.has(pairKey(p.a, p.b))) {
            expect(p.overlap, `${label} door ${p.a}/${p.b}`).toBeGreaterThanOrEqual(PLAN_DOOR_W + 1.2);
          }
        }

        // the maze actually cut walls (a labyrinth, not an open plan)
        expect(sealed.size, label).toBeGreaterThanOrEqual(3);

        // connectivity: BFS over open doors reaches every room from the core
        const nbr = new Map(rooms.map((r) => [r.id, []]));
        for (const p of adjacency) {
          if (sealed.has(pairKey(p.a, p.b))) continue;
          nbr.get(p.a).push(p.b);
          nbr.get(p.b).push(p.a);
        }
        const seen = new Set([plan.coreId]);
        const q = [plan.coreId];
        while (q.length) {
          const id = q.pop();
          for (const n of nbr.get(id)) if (!seen.has(n)) { seen.add(n); q.push(n); }
        }
        expect(seen.size, `${label} connectivity`).toBe(rooms.length);

        // paid pockets: reachable, and the host is one of their open doors
        for (const r of rooms.filter((rr) => rr.paidCost)) {
          const open = adjacency.filter((p) =>
            (p.a === r.id || p.b === r.id) && !sealed.has(pairKey(p.a, p.b)));
          expect(open.length, `${label} paid ${r.type}`).toBeGreaterThanOrEqual(1);
          const others = open.map((p) => (p.a === r.id ? p.b : p.a));
          expect(others, `${label} paid host`).toContain(r.host);
        }
      }
    }
  });
});
