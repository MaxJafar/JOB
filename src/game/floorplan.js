// ============ floor plan v4: the office labyrinth (pure, testable) ============
// Turns a seed + floor def into rectangles and a door graph — no THREE, no DOM —
// so tests can hammer hundreds of seeds. Level.build consumes the plan.
//
// The plate is a classic double-loaded office lattice: a central ELEVATOR CORE,
// two full-depth corridor spines flanking it, two cross-corridors, and eight
// blocks of departments subdivided into rooms and pocket dead-ends. Rooms that
// touch get doorways automatically (buildRoomShell), so the labyrinth is cut
// the other way around: SEAL a seeded subset of adjacencies into solid wall,
// then BFS-repair until every room is reachable from the core. Result: winding
// multi-route floors with loops, dead-end pockets, paid side rooms — and the
// floor lead keeps an office (the LAIR) in an outer corner, meetable long
// before the elevator call.
import { makeRng, rngRange, rngChoose } from '../core/utils.js';

export const CORRIDOR_W = 5.6;
export const PLAN_DOOR_W = 3.8;                  // mirrors DOOR_W in level.js
const MIN_DOOR_OVERLAP = PLAN_DOOR_W + 1.4;      // a doorway must actually fit
const MIN_ROOM = 8;                              // no closet smaller than this
const SEAL_P = 0.38;                             // labyrinth-ness dial

export function pairKey(a, b) { return a < b ? `${a}:${b}` : `${b}:${a}`; }

/** Shared-edge adjacency over axis-aligned rects. Returns [{a, b, overlap}]. */
export function computeAdjacency(rooms) {
  const out = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const A = rooms[i], B = rooms[j];
      const touchZ = Math.abs(A.z1 - B.z0) < 0.01 || Math.abs(A.z0 - B.z1) < 0.01;
      const touchX = Math.abs(A.x1 - B.x0) < 0.01 || Math.abs(A.x0 - B.x1) < 0.01;
      if (touchZ) {
        const overlap = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
        if (overlap > 0.01) out.push({ a: A.id, b: B.id, overlap });
      } else if (touchX) {
        const overlap = Math.min(A.z1, B.z1) - Math.max(A.z0, B.z0);
        if (overlap > 0.01) out.push({ a: A.id, b: B.id, overlap });
      }
    }
  }
  return out;
}

const STAIR_WINGS = [
  { key: 'n', ax: 0, az: -1, side: 'north', label: 'NORTH STAIR' },
  { key: 'e', ax: 1, az: 0, side: 'east', label: 'EAST STAIR' },
  { key: 's', ax: 0, az: 1, side: 'south', label: 'SOUTH STAIR' },
  { key: 'w', ax: -1, az: 0, side: 'west', label: 'WEST STAIR' },
];

const MAIN_TYPES = ['bullpen', 'records', 'conference', 'lounge'];
const PAID_POCKETS = [
  { type: 'vault', cost: 60 },
  { type: 'utility', cost: 40 },
  { type: 'breakroom', cost: 25 },
];

function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Split a rect once along its longer axis at a seeded fraction. */
function splitRect(rng, r, axis = null) {
  const w = r.x1 - r.x0, d = r.z1 - r.z0;
  const ax = axis ?? (w >= d ? 'x' : 'z');
  const len = ax === 'x' ? w : d;
  if (len < MIN_ROOM * 2 + 0.5) return null;
  const cutMin = MIN_ROOM / len, cutMax = 1 - MIN_ROOM / len;
  const t = rngRange(rng, Math.max(cutMin, 0.38), Math.min(cutMax, 0.62));
  if (ax === 'x') {
    const cut = r.x0 + w * t;
    return [{ ...r, x1: cut }, { ...r, x0: cut }];
  }
  const cut = r.z0 + d * t;
  return [{ ...r, z1: cut }, { ...r, z0: cut }];
}

export function planFloor(seed, def) {
  const rng = makeRng(seed);
  const [W, D] = def.size;
  const hw = W / 2, hd = D / 2;
  const rooms = [];
  const push = (type, x0, x1, z0, z1, extra = {}) => {
    const r = {
      id: rooms.length, type, x0, x1, z0, z1,
      cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, spine: true, ...extra,
    };
    rooms.push(r);
    return r;
  };

  // ---- lattice cuts ----
  const coreW = rngRange(rng, 24, 27);
  const coreD = rngRange(rng, 21, 24);
  const vx0 = -coreW / 2 - CORRIDOR_W, vx1 = -coreW / 2;
  const vx2 = coreW / 2, vx3 = coreW / 2 + CORRIDOR_W;
  const hz0 = -coreD / 2 - CORRIDOR_W, hz1 = -coreD / 2;
  const hz2 = coreD / 2, hz3 = coreD / 2 + CORRIDOR_W;

  const core = push('core', vx1, vx2, hz1, hz2);

  // corridor spines (full depth) + cross segments — the double-loaded skeleton
  push('corridor', vx0, vx1, -hd, hd);
  push('corridor', vx2, vx3, -hd, hd);
  for (const [z0, z1] of [[hz0, hz1], [hz2, hz3]]) {
    push('corridor', -hw, vx0, z0, z1);
    push('corridor', vx1, vx2, z0, z1);
    push('corridor', vx3, hw, z0, z1);
  }

  // ---- the eight blocks around the skeleton ----
  const blocks = [
    { stair: 'n', x0: vx1, x1: vx2, z0: -hd, z1: hz0 },
    { stair: 's', x0: vx1, x1: vx2, z0: hz3, z1: hd },
    { stair: 'w', x0: -hw, x1: vx0, z0: hz1, z1: hz2 },
    { stair: 'e', x0: vx3, x1: hw, z0: hz1, z1: hz2 },
    { corner: true, x0: -hw, x1: vx0, z0: -hd, z1: hz0 },
    { corner: true, x0: vx3, x1: hw, z0: -hd, z1: hz0 },
    { corner: true, x0: -hw, x1: vx0, z0: hz3, z1: hd },
    { corner: true, x0: vx3, x1: hw, z0: hz3, z1: hd },
  ];

  const mainPool = shuffle(rng, [...MAIN_TYPES, ...shuffle(rng, MAIN_TYPES)]);
  let mainIdx = 0;
  const nextMain = () => mainPool[mainIdx++ % mainPool.length];

  const stairs = [];
  const pocketRects = [];

  for (const b of blocks) {
    if (b.stair) {
      // stair room at the plate edge + an antechamber toward the skeleton
      const wing = STAIR_WINGS.find((s) => s.key === b.stair);
      const horizontal = wing.ax !== 0;                 // wing runs along x?
      const depth = horizontal ? b.x1 - b.x0 : b.z1 - b.z0;
      let stairRect = b, ante = null;
      if (depth >= MIN_ROOM * 2 + 2) {
        const t = rngRange(rng, 0.45, 0.58);
        if (wing.key === 'w') { const cut = b.x0 + depth * t; stairRect = { ...b, x1: cut }; ante = { ...b, x0: cut }; }
        if (wing.key === 'e') { const cut = b.x1 - depth * t; stairRect = { ...b, x0: cut }; ante = { ...b, x1: cut }; }
        if (wing.key === 'n') { const cut = b.z0 + depth * t; stairRect = { ...b, z1: cut }; ante = { ...b, z0: cut }; }
        if (wing.key === 's') { const cut = b.z1 - depth * t; stairRect = { ...b, z0: cut }; ante = { ...b, z1: cut }; }
      }
      const sr = push(nextMain(), stairRect.x0, stairRect.x1, stairRect.z0, stairRect.z1,
        { arrivalSide: wing.side, stairLabel: wing.label });
      stairs.push({ key: wing.key, ax: wing.ax, az: wing.az, side: wing.side, label: wing.label, roomId: sr.id });
      if (ante) push(nextMain(), ante.x0, ante.x1, ante.z0, ante.z1);
    } else {
      // corner block: main room(s) + pocket dead-ends. Always split at least once.
      const first = splitRect(rng, b) ?? [b];
      const rects = [];
      for (const half of first) {
        const again = rng() < 0.6 ? splitRect(rng, half) : null;
        if (again) rects.push(...again); else rects.push(half);
      }
      rects.sort((a, c) => ((c.x1 - c.x0) * (c.z1 - c.z0)) - ((a.x1 - a.x0) * (a.z1 - a.z0)));
      rects.forEach((r, i) => {
        if (i === 0) push(nextMain(), r.x0, r.x1, r.z0, r.z1);
        else pocketRects.push(r);
      });
    }
  }

  // ---- pockets: the lair first (farthest corner), then paid rooms, then dead ends ----
  pocketRects.sort((a, c) =>
    (Math.abs(c.x0 + c.x1) + Math.abs(c.z0 + c.z1)) - (Math.abs(a.x0 + a.x1) + Math.abs(a.z0 + a.z1)));
  let lairId = null;
  const paidPool = shuffle(rng, PAID_POCKETS);
  for (const r of pocketRects) {
    const wDim = r.x1 - r.x0, dDim = r.z1 - r.z0;
    if (lairId === null && wDim >= MIN_ROOM && dDim >= MIN_ROOM) {
      lairId = push('lair', r.x0, r.x1, r.z0, r.z1, { spine: false }).id;
    } else if (paidPool.length) {
      const p = paidPool.shift();
      push(p.type, r.x0, r.x1, r.z0, r.z1, { spine: false, paidCost: p.cost });
    } else {
      push(rngChoose(rng, ['records', 'lounge']), r.x0, r.x1, r.z0, r.z1, { spine: false, pocket: true });
    }
  }

  // ---- adjacency + the maze cut ----
  const adjacency = computeAdjacency(rooms);
  const sealed = new Set();
  const repairable = [];
  const byRoom = new Map(rooms.map((r) => [r.id, []]));
  const isPocket = (r) => r.paidCost || r.type === 'lair' || r.pocket;

  // single-door rooms: pick the widest adjacency as THE door, seal the rest
  const pocketDoor = new Map();
  for (const r of rooms) {
    if (!isPocket(r)) continue;
    const mine = adjacency.filter((p) => (p.a === r.id || p.b === r.id) && p.overlap >= MIN_DOOR_OVERLAP);
    mine.sort((a, c) => c.overlap - a.overlap);
    if (mine.length) {
      const door = mine[0];
      pocketDoor.set(r.id, door);
      if (r.paidCost) r.host = door.a === r.id ? door.b : door.a;
    }
  }

  for (const p of adjacency) {
    const A = rooms[p.a], B = rooms[p.b];
    const key = pairKey(p.a, p.b);
    if (p.overlap < MIN_DOOR_OVERLAP) { sealed.add(key); continue; }   // no door fits: solid wall
    if (A.type === 'core' || B.type === 'core') continue;              // core mouths stay open
    const pocket = isPocket(A) ? A : isPocket(B) ? B : null;
    if (pocket) {
      if (pocketDoor.get(pocket.id) !== p) { sealed.add(key); repairable.push({ key, p, last: true }); }
      continue;
    }
    if (rng() < SEAL_P) { sealed.add(key); repairable.push({ key, p, last: false }); }
  }

  for (const p of adjacency) {
    if (sealed.has(pairKey(p.a, p.b))) continue;
    byRoom.get(p.a).push(p.b);
    byRoom.get(p.b).push(p.a);
  }

  // ---- BFS repair: everything must be reachable from the core ----
  const reach = () => {
    const seen = new Set([core.id]);
    const q = [core.id];
    while (q.length) {
      const id = q.pop();
      for (const n of byRoom.get(id)) if (!seen.has(n)) { seen.add(n); q.push(n); }
    }
    return seen;
  };
  let seen = reach();
  let guard = 200;
  while (seen.size < rooms.length && guard-- > 0) {
    const frontier = (allowLast) => repairable.find(({ key, p, last }) =>
      sealed.has(key) && (!last || allowLast) && (seen.has(p.a) !== seen.has(p.b)));
    const fix = frontier(false) ?? frontier(true);
    if (!fix) break;
    sealed.delete(fix.key);
    byRoom.get(fix.p.a).push(fix.p.b);
    byRoom.get(fix.p.b).push(fix.p.a);
    seen = reach();
  }

  return { rooms, sealed, coreId: core.id, lairId, stairs };
}
