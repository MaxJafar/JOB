// ============ math & misc helpers ============
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
// frame-rate independent smoothing (exp decay)
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const choose = (arr) => arr[(Math.random() * arr.length) | 0];
export const chance = (p) => Math.random() < p;

export function weightedChoose(entries, rng = Math.random) {
  // entries: [{w, ...}]
  let total = 0;
  for (const e of entries) total += e.w;
  let r = rng() * total;
  for (const e of entries) { r -= e.w; if (r <= 0) return e; }
  return entries[entries.length - 1];
}

// seeded rng (mulberry32) — used for level gen so co-op clients build identical floors
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rngRange = (rng, a, b) => a + rng() * (b - a);
export const rngInt = (rng, a, b) => Math.floor(rngRange(rng, a, b + 1));
export const rngChoose = (rng, arr) => arr[(rng() * arr.length) | 0];

export function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
export const formatMoney = (n) => `$ ${Math.floor(n)}`;

// yaw angle from direction (x, z)
export const yawFromDir = (x, z) => Math.atan2(x, z);
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ---- 2D circle vs AABB resolution (entities live on XZ plane) ----
// aabb: {minX, maxX, minZ, maxZ, h}. Returns true if a push happened; mutates pos.
export function resolveCircleAABB(pos, radius, aabb, entityY = 0, entityH = 1.8) {
  if (aabb.h !== undefined && entityY > aabb.h) return false; // stepping over a low obstacle (jumped on? we treat as pass)
  const cx = clamp(pos.x, aabb.minX, aabb.maxX);
  const cz = clamp(pos.z, aabb.minZ, aabb.maxZ);
  const dx = pos.x - cx, dz = pos.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= radius * radius) return false;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2), push = (radius - d) / d;
    pos.x += dx * push; pos.z += dz * push;
  } else {
    // center inside the box — push out along smallest axis
    const lx = pos.x - aabb.minX, rx = aabb.maxX - pos.x;
    const lz = pos.z - aabb.minZ, rz = aabb.maxZ - pos.z;
    const m = Math.min(lx, rx, lz, rz);
    if (m === lx) pos.x = aabb.minX - radius;
    else if (m === rx) pos.x = aabb.maxX + radius;
    else if (m === lz) pos.z = aabb.minZ - radius;
    else pos.z = aabb.maxZ + radius;
  }
  return true;
}

// 2D segment vs AABB (used for line-of-sight checks against tall props)
export function segmentHitsAABB(x1, z1, x2, z2, aabb) {
  // slab method on XZ
  const dx = x2 - x1, dz = z2 - z1;
  let tmin = 0, tmax = 1;
  if (Math.abs(dx) < 1e-9) {
    if (x1 < aabb.minX || x1 > aabb.maxX) return false;
  } else {
    let t1 = (aabb.minX - x1) / dx, t2 = (aabb.maxX - x1) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (z1 < aabb.minZ || z1 > aabb.maxZ) return false;
  } else {
    let t1 = (aabb.minZ - z1) / dz, t2 = (aabb.maxZ - z1) / dz;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

// distance from point P to segment AB, all on XZ plane
export function segPointDist2D(ax, az, bx, bz, px, pz) {
  const abx = bx - ax, abz = bz - az;
  const t = clamp(((px - ax) * abx + (pz - az) * abz) / (abx * abx + abz * abz + 1e-9), 0, 1);
  const cx = ax + abx * t, cz = az + abz * t;
  const dx = px - cx, dz = pz - cz;
  return Math.sqrt(dx * dx + dz * dz);
}

// 3D distance from point to segment (projectile sweeps)
export function segPointDist3D(a, b, p) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / (abx * abx + aby * aby + abz * abz + 1e-9), 0, 1);
  const cx = a.x + abx * t, cy = a.y + aby * t, cz = a.z + abz * t;
  const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function dist2D(a, b) {
  const dx = a.x - b.x, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

let _id = 1;
export const nextId = () => _id++;
