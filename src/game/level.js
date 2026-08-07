// ============ floor generation v2: room-graph offices ============
// A floor is no longer one open box. It's a spine of authored room types —
//   ENTRY → corridor → BULLPEN → corridor → WAVE ARENA → corridor → ELEVATOR HALL
// — with paid side rooms (VAULT, UTILITY) gated behind Department-Budget doors.
// The penthouse keeps its single executive arena.
import * as THREE from 'three';
import {
  makeCarpet, makeWindowStrip, makePoster, makeDesk, makeOfficeChair, makeCubicleCluster,
  makeFilingCabinet, makePlant, makeWaterCooler, makeVendingMachine, makeCoffeeMachine,
  makeCopierProp, makePillar, makeAlarmBox, makeChest, makeElevator,
  makeCEODesk, makeStatue, makeSodaCan, makeCanvasTexture, box, mat,
} from './props.js';
import { makeRng, rngRange, rngInt, rngChoose, resolveCircleAABB, segmentHitsAABB, clamp, dist2D, nextId } from '../core/utils.js';

const POSTER_LINES = {
  lobby: ['WELCOME\nTO J.O.B.', 'VISITORS MUST\nSIGN IN', 'NO SOLICITING', 'YOUR CAREER\nSTARTS HERE ▲'],
  finance: ['SYNERGY', 'Q4 OR\nDIE TRYIN', 'THE BUDGET\nIS A LIE', 'STONKS ▲'],
  marketing: ['BRAND!', 'GO VIRAL\nOR GO HOME', 'ENGAGE!', 'CONTENT\nIS KING'],
  sales: ['ALWAYS BE\nCLOSING', 'SALES\nLEADERBOARD', 'COFFEE IS FOR\nCLOSERS', 'RING THE\nBELL 🔔'],
  penthouse: ['VISION', 'DISRUPT', 'EXCELLENCE', 'PROFIT'],
};

const ROOM_SIGNS = {
  entry: 'RECEPTION', corridor: null, bullpen: 'OPEN OFFICE', arena: 'CONFERENCE CENTER',
  elevatorHall: 'ELEVATOR BANK', vault: '⚠ RESTRICTED — VAULT', utility: 'FACILITIES', breakroom: 'BREAK ROOM',
};

export const CEIL_H = 4.3;
const WALL_H = 4.6;
const WALL_T = 0.6;
const DOOR_W = 3.8;

export class Level {
  constructor(game, floorDef, seed) {
    this.game = game;
    this.def = floorDef;
    this.seed = seed;
    this.rng = makeRng(seed);
    this.group = new THREE.Group();
    this.colliders = [];
    this.interactables = [];
    this.destructibles = [];
    this.debris = [];
    this.chests = [];
    this.utilities = [];
    this.sodas = [];
    this.disposables = [];
    this.karenSpot = null;
    this.elevator = null;
    this.arrival = null;
    this.rooms = [];          // {id, type, x0,x1,z0,z1, cx,cz, discovered}
    this.paidDoors = [];      // {id, mesh, collider, cost, roomId, open, label}
    this.arenaSeals = [];     // seal barriers for the wave-arena lockdown
    this.arenaRoom = null;
    this.utilitySwitch = null;
    this.time = 0;
    this.build();
  }

  get bounds() { return this._bounds; }

  // ================= layout =================
  build() {
    const def = this.def;
    if (def.isFinal) { this.buildPenthouse(); return; }
    const rng = this.rng;
    const P = def.palette;

    // ---- generate the spine (south +z → north -z) ----
    const spine = [
      { type: 'entry', w: rngRange(rng, 15, 18), d: rngRange(rng, 11, 13) },
      { type: 'corridor', w: rngRange(rng, 5.5, 7), d: rngRange(rng, 10, 14) },
      { type: 'bullpen', w: rngRange(rng, 20, 26), d: rngRange(rng, 15, 19) },
      { type: 'corridor', w: rngRange(rng, 5.5, 7), d: rngRange(rng, 9, 13) },
      { type: 'arena', w: rngRange(rng, 21, 26), d: rngRange(rng, 17, 21) },
      { type: 'corridor', w: rngRange(rng, 6, 7.5), d: rngRange(rng, 7, 10) },
      { type: 'elevatorHall', w: rngRange(rng, 16, 19), d: rngRange(rng, 12, 14) },
    ];
    let z1 = 0; // running south edge
    let prevCx = 0;
    for (const s of spine) {
      // jitter the center but keep enough overlap with the previous room for a door
      const cx = s.type === 'entry' ? 0 : clamp(prevCx + rngRange(rng, -4, 4), -6, 6);
      const room = {
        id: this.rooms.length, type: s.type,
        x0: cx - s.w / 2, x1: cx + s.w / 2, z0: z1 - s.d, z1,
        cx, cz: z1 - s.d / 2, discovered: false, spine: true,
      };
      this.rooms.push(room);
      z1 = room.z0;
      prevCx = cx;
    }
    // ---- side rooms (behind paid doors) ----
    const sideDefs = [
      { type: 'vault', host: this.rooms.find((r) => r.type === 'arena'), cost: 60 },
      { type: 'utility', host: this.rooms.find((r) => r.type === 'bullpen'), cost: 40 },
    ];
    if (rng() < 0.5) sideDefs.push({ type: 'breakroom', host: this.rooms.find((r) => r.type === 'corridor'), cost: 25 });
    for (const sd of sideDefs) {
      if (!sd.host) continue;
      const host = sd.host;
      const hostD = host.z1 - host.z0;
      const w = rngRange(rng, 8.5, 10.5);
      const side = rng() < 0.5 ? -1 : 1;
      // shallow hosts (short corridors) shrink the side room instead of overshooting
      let d = rngRange(rng, 8.5, 10.5);
      if (hostD < d + 2.5) d = Math.max(6, hostD - 2.5);
      const czLo = host.z0 + d / 2 + 1, czHi = host.z1 - d / 2 - 1;
      const cz = czLo >= czHi ? (host.z0 + host.z1) / 2 : rngRange(rng, czLo, czHi);
      const room = {
        id: this.rooms.length, type: sd.type,
        x0: side < 0 ? host.x0 - w : host.x1,
        x1: side < 0 ? host.x0 : host.x1 + w,
        z0: cz - d / 2, z1: cz + d / 2,
        cx: side < 0 ? host.x0 - w / 2 : host.x1 + w / 2, cz,
        discovered: false, spine: false, host: host.id, paidCost: sd.cost, side,
      };
      this.rooms.push(room);
    }
    this.arenaRoom = this.rooms.find((r) => r.type === 'arena');

    // ---- envelope bounds ----
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const r of this.rooms) {
      minX = Math.min(minX, r.x0); maxX = Math.max(maxX, r.x1);
      minZ = Math.min(minZ, r.z0); maxZ = Math.max(maxZ, r.z1);
    }
    this._bounds = { minX: minX - 1, maxX: maxX + 1, minZ: minZ - 1, maxZ: maxZ + 1 };

    // ---- lighting (dimmer, moodier: emissives carry the look now) ----
    const hemi = new THREE.HemisphereLight(P.sky, P.trim, 0.62);
    const sun = new THREE.DirectionalLight(P.light, 1.0);
    sun.position.set(14, 22, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = minX - 4; sun.shadow.camera.right = maxX + 4;
    sun.shadow.camera.top = maxZ + 4; sun.shadow.camera.bottom = minZ - 4;
    sun.shadow.camera.far = 70;
    sun.shadow.bias = -0.0004;
    this.group.add(hemi, sun, sun.target);
    this.lights = { hemi, sun };

    // ---- build each room ----
    for (const room of this.rooms) this.buildRoomShell(room);
    // door gaps between connected rooms (walls were built solid; gaps carved via segments)
    // handled inside buildRoomShell wall segments using this.connections computed here:
    // (connections were computed in buildRoomShell via neighbors — see _doorGaps)

    // ---- room content ----
    for (const room of this.rooms) this.furnishRoom(room);

    // ---- elevators ----
    const entry = this.rooms[0];
    const hall = this.rooms.find((r) => r.type === 'elevatorHall');
    this.arrival = this.placeElevator(entry.cx, entry.z1 - 0.4, Math.PI, P, false);
    this.arrival.doorOpen = 1;
    this.arrival.closeTimer = 2.2;
    this.playerSpawn = new THREE.Vector3(entry.cx, 0, entry.z1 - 4.2);
    this.elevator = this.placeElevator(hall.cx, hall.z0 + 0.4, 0, P, true);

    // ---- karen lurks in a corridor ----
    if (this.rng() < def.karenChance) {
      const corr = this.rooms.filter((r) => r.type === 'corridor');
      if (corr.length) {
        const c = rngChoose(this.rng, corr);
        this.karenSpot = new THREE.Vector3(clamp(c.cx + rngRange(this.rng, -1, 1), c.x0 + 1, c.x1 - 1), 0, c.cz);
      }
    }
  }

  // Build walls/floor/ceiling for one room, carving door gaps toward neighbors.
  buildRoomShell(room) {
    const P = this.def.palette;
    const w = room.x1 - room.x0, d = room.z1 - room.z0;

    // floor
    const carpet = makeCarpet(w, d, P, this.def.key);
    carpet.position.set(room.cx, 0.01 + room.id * 0.0005, room.cz);
    this.group.add(carpet);
    this.disposables.push(carpet.material.map, carpet.material);

    // ceiling with glowing light panels (the big look upgrade)
    const ceilTex = makeCanvasTexture(128, 128, (g) => {
      g.fillStyle = '#1c2028'; g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#fff3d6';
      g.fillRect(24, 24, 34, 34);
      g.fillRect(70, 70, 34, 34);
      g.globalAlpha = 0.25;
      g.fillRect(70, 24, 34, 34);
      g.fillRect(24, 70, 34, 34);
    }, { repeat: [Math.max(1, Math.round(w / 6)), Math.max(1, Math.round(d / 6))] });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({ map: ceilTex, emissive: 0xffffff, emissiveMap: ceilTex, emissiveIntensity: 0.85, color: 0x2a2e36, roughness: 0.9 }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(room.cx, CEIL_H, room.cz);
    this.group.add(ceil);
    this.disposables.push(ceilTex, ceil.material);

    // accent room light (no shadows — cheap)
    if (room.type === 'vault' || room.type === 'utility' || room.type === 'breakroom' || room.type === 'arena') {
      const tint = room.type === 'vault' ? 0xffd23f : room.type === 'utility' ? 0x38e1ff : room.type === 'breakroom' ? 0x58e07c : 0xff9b2d;
      const pt = new THREE.PointLight(tint, room.type === 'arena' ? 12 : 20, Math.max(w, d) * 1.4, 1.8);
      pt.position.set(room.cx, CEIL_H - 0.8, room.cz);
      this.group.add(pt);
    }

    // door gaps to neighbors: find touching rooms
    const gaps = { south: [], north: [], west: [], east: [] };
    for (const other of this.rooms) {
      if (other === room) continue;
      // other is north neighbor (other.z1 === room.z0)
      if (Math.abs(other.z1 - room.z0) < 0.01 && other.x0 < room.x1 && other.x1 > room.x0) {
        const lo = Math.max(other.x0, room.x0), hi = Math.min(other.x1, room.x1);
        gaps.north.push(this.gapCenter(room, other, lo, hi));
      }
      if (Math.abs(other.z0 - room.z1) < 0.01 && other.x0 < room.x1 && other.x1 > room.x0) {
        const lo = Math.max(other.x0, room.x0), hi = Math.min(other.x1, room.x1);
        gaps.south.push(this.gapCenter(room, other, lo, hi));
      }
      if (Math.abs(other.x1 - room.x0) < 0.01 && other.z0 < room.z1 && other.z1 > room.z0) {
        const lo = Math.max(other.z0, room.z0), hi = Math.min(other.z1, room.z1);
        gaps.west.push(this.gapCenter(room, other, lo, hi));
      }
      if (Math.abs(other.x0 - room.x1) < 0.01 && other.z0 < room.z1 && other.z1 > room.z0) {
        const lo = Math.max(other.z0, room.z0), hi = Math.min(other.z1, room.z1);
        gaps.east.push(this.gapCenter(room, other, lo, hi));
      }
    }
    // carve doorways for the arrival / exit elevators in the perimeter walls
    // (3.7 ≈ cab width — the door collider must span the whole carve, no slits)
    const elevGap = { c: room.cx, w: 3.7, lo: room.cx - 1.85, hi: room.cx + 1.85, otherId: -1, builder: true, paid: false, arenaEdge: false };
    if (room.type === 'entry') gaps.south.push(elevGap);
    if (room.type === 'elevatorHall') gaps.north.push(elevGap);

    // walls: for shared edges only the room with the LOWER id builds the overlap
    this.buildWallRun(room, 'north', gaps.north);
    this.buildWallRun(room, 'south', gaps.south);
    this.buildWallRun(room, 'west', gaps.west);
    this.buildWallRun(room, 'east', gaps.east);
  }

  gapCenter(room, other, lo, hi) {
    // stable gap center derived from both room ids so both sides carve identically
    const key = Math.min(room.id, other.id) * 31 + Math.max(room.id, other.id);
    const t = 0.35 + ((key * 2654435761) % 1000) / 1000 * 0.3;
    const c = lo + (hi - lo) * t;
    const gap = {
      c: clamp(c, lo + DOOR_W / 2 + 0.4, hi - DOOR_W / 2 - 0.4),
      w: DOOR_W,
      lo, hi,                    // full shared-edge overlap (the neighbor owns this stretch if we're not builder)
      otherId: other.id,
      builder: Math.min(room.id, other.id) === room.id,
      paid: (other.paidCost && other.host === room.id) || (room.paidCost && room.host === other.id),
      paidRoom: other.paidCost && other.host === room.id ? other : (room.paidCost && room.host === other.id ? room : null),
      arenaEdge: room.type === 'arena' || other.type === 'arena',
    };
    return gap;
  }

  buildWallRun(room, side, gapList) {
    const P = this.def.palette;
    const horizontal = side === 'north' || side === 'south';
    const lo = horizontal ? room.x0 : room.z0;
    const hi = horizontal ? room.x1 : room.z1;
    const line = side === 'north' ? room.z0 : side === 'south' ? room.z1 : side === 'west' ? room.x0 : room.x1;
    // Ownership rule: for each shared edge the LOWER-id room builds the overlap
    // stretch (with its door gap). The other room must still build the parts of
    // its own wall OUTSIDE the overlap — otherwise wider rooms get holes.
    const cuts = [];   // intervals of this wall we must NOT build
    for (const g of gapList) {
      if (g.builder) cuts.push([g.c - g.w / 2, g.c + g.w / 2]);      // just the doorway
      else cuts.push([g.lo, g.hi]);                                   // neighbor owns the whole overlap
    }
    cuts.sort((a, b) => a[0] - b[0]);
    let cursor = lo;
    const segs = [];
    for (const [a, b] of cuts) {
      segs.push([cursor, Math.max(cursor, a)]);
      cursor = Math.max(cursor, b);
    }
    segs.push([cursor, hi]);
    const sorted = gapList.filter((g) => g.builder).sort((a, b) => a.c - b.c);
    for (const [a, b] of segs) {
      if (b - a < 0.15) continue;
      const len = b - a, mid = (a + b) / 2;
      const wall = box(horizontal ? len : WALL_T, WALL_H, horizontal ? WALL_T : len, P.wall);
      wall.position.set(horizontal ? mid : line, WALL_H / 2, horizontal ? line : mid);
      wall.receiveShadow = true;
      this.group.add(wall);
      // accent trim strip
      const trim = box(horizontal ? len : 0.08, 0.12, horizontal ? 0.08 : len, P.accent, { emissive: P.accent, emissiveIntensity: 0.7 });
      trim.position.set(horizontal ? mid : line + (side === 'west' ? WALL_T / 2 + 0.01 : -WALL_T / 2 - 0.01), 2.7, horizontal ? line + (side === 'north' ? WALL_T / 2 + 0.01 : -WALL_T / 2 - 0.01) : mid);
      this.group.add(trim);
      if (horizontal) this.addCollider(a, b, line - WALL_T / 2, line + WALL_T / 2, WALL_H);
      else this.addCollider(line - WALL_T / 2, line + WALL_T / 2, a, b, WALL_H);
    }
    // door dressing per gap: header sign + paid barrier + arena seal
    for (const g of sorted) {
      const gx = horizontal ? g.c : line;
      const gz = horizontal ? line : g.c;
      // header above the doorway
      const header = box(horizontal ? g.w + 0.6 : WALL_T, WALL_H - 3.1, horizontal ? WALL_T : g.w + 0.6, P.trim);
      header.position.set(gx, 3.1 + (WALL_H - 3.1) / 2, gz);
      this.group.add(header);
      const other = this.rooms[g.otherId];
      if (!other) continue; // elevator doorway — no room beyond
      const signText = ROOM_SIGNS[other.type];
      if (signText && (other.spine === false || other.type === 'arena' || other.type === 'elevatorHall')) {
        const sign = makePoster(signText, other.type === 'vault' ? '#ffd23f' : '#9fd8ff', '#10141c');
        sign.scale.setScalar(0.55);
        sign.position.set(gx + (horizontal ? 0 : (side === 'west' ? 0.35 : -0.35)), 2.72, gz + (horizontal ? (side === 'north' ? 0.35 : -0.35) : 0));
        sign.rotation.y = horizontal ? (side === 'north' ? 0 : Math.PI) : (side === 'west' ? Math.PI / 2 : -Math.PI / 2);
        this.group.add(sign);
        this.disposables.push(sign.material.map, sign.material);
      }
      if (g.paid && g.paidRoom) {
        this.buildPaidDoor(gx, gz, horizontal, g.w, g.paidRoom);
      }
      if (g.arenaEdge) {
        this.buildArenaSeal(gx, gz, horizontal, g.w);
      }
    }
  }

  buildPaidDoor(x, z, horizontal, gapW, paidRoom) {
    const mesh = box(horizontal ? gapW : 0.3, 3.1, horizontal ? 0.3 : gapW, 0x22303f, { rough: 0.4, opacity: 0.82, emissive: 0x0d2733, emissiveIntensity: 0.6 });
    mesh.position.set(x, 1.55, z);
    this.group.add(mesh);
    const lock = box(0.4, 0.4, 0.4, 0xffd23f, { emissive: 0xaa8a1c, emissiveIntensity: 1.4 });
    lock.position.set(x, 2.2, z);
    this.group.add(lock);
    this.addCollider(
      horizontal ? x - gapW / 2 : x - 0.2, horizontal ? x + gapW / 2 : x + 0.2,
      horizontal ? z - 0.2 : z - gapW / 2, horizontal ? z + 0.2 : z + gapW / 2, WALL_H);
    const collider = this.colliders[this.colliders.length - 1];
    const door = {
      id: nextId(), mesh, lock, collider, open: false,
      cost: paidRoom.paidCost, roomId: paidRoom.id,
      label: ROOM_SIGNS[paidRoom.type] ?? 'SIDE ROOM',
      pos: new THREE.Vector3(x, 0, z), radius: 3.0,
    };
    this.paidDoors.push(door);
  }

  buildArenaSeal(x, z, horizontal, gapW) {
    const mesh = box(horizontal ? gapW : 0.35, 3.1, horizontal ? 0.35 : gapW, 0xc03030, { emissive: 0x7a1414, emissiveIntensity: 1.0, opacity: 0.85 });
    mesh.position.set(x, 1.55, z);
    mesh.visible = false;
    this.group.add(mesh);
    this.addCollider(
      horizontal ? x - gapW / 2 : x - 0.25, horizontal ? x + gapW / 2 : x + 0.25,
      horizontal ? z - 0.25 : z - gapW / 2, horizontal ? z + 0.25 : z + gapW / 2, WALL_H);
    const collider = this.colliders[this.colliders.length - 1];
    collider.disabled = true;
    this.arenaSeals.push({ mesh, collider });
  }

  setArenaSealed(sealed) {
    for (const s of this.arenaSeals) {
      s.mesh.visible = sealed;
      this.setColliderDisabled(s.collider, !sealed);
    }
  }

  // ================= furnishing =================
  furnishRoom(room) {
    const P = this.def.palette;
    const rng = this.rng;
    const w = room.x1 - room.x0, d = room.z1 - room.z0;
    this.occupied = this.occupied ?? [];
    const occupied = [];
    const tryPlace = (r, margin = 1.0, tries = 24, inset = 1.6) => {
      for (let i = 0; i < tries; i++) {
        const x = rngRange(rng, room.x0 + inset, room.x1 - inset);
        const z = rngRange(rng, room.z0 + inset, room.z1 - inset);
        let ok = true;
        for (const o of occupied) if (Math.hypot(x - o.x, z - o.z) < o.r + r + margin) { ok = false; break; }
        // keep doorways clear
        if (ok && this.nearDoorway(x, z, 2.6)) ok = false;
        if (ok) { occupied.push({ x, z, r }); return { x, z }; }
      }
      return null;
    };
    const posters = POSTER_LINES[this.def.key] ?? POSTER_LINES.finance;
    const addPoster = () => {
      const onWest = rng() < 0.5;
      const p = makePoster(rngChoose(rng, posters), '#' + P.accent.toString(16).padStart(6, '0'));
      p.position.set(onWest ? room.x0 + 0.35 : room.x1 - 0.35, 2.4, rngRange(rng, room.z0 + 2, room.z1 - 2));
      p.rotation.y = onWest ? Math.PI / 2 : -Math.PI / 2;
      this.group.add(p);
      this.disposables.push(p.material.map, p.material);
    };
    const placeDestr = (fac, kind, hp, radius, footprint = true) => {
      const p = tryPlace(radius + 0.2);
      if (!p) return null;
      const g = fac();
      g.position.set(p.x, 0, p.z);
      g.rotation.y = rngInt(rng, 0, 3) * Math.PI / 2;
      this.group.add(g);
      const col = footprint ? this.addFootprintCollider(g, p.x, p.z, g.rotation.y) : null;
      this.destructibles.push({ id: nextId(), kind, pos: new THREE.Vector3(p.x, 0.8, p.z), radius, hp, group: g, dead: false, collider: col });
      return g;
    };

    switch (room.type) {
      case 'entry': {
        // reception desk + plants: a calm hook room
        const desk = makeDesk(P);
        desk.position.set(room.cx - 2.5, 0, room.cz);
        desk.rotation.y = Math.PI;
        this.group.add(desk);
        this.addFootprintCollider(desk, room.cx - 2.5, room.cz, Math.PI);
        for (let i = 0; i < 3; i++) { const p = tryPlace(0.5); if (p) { const pl = makePlant(); pl.position.set(p.x, 0, p.z); this.group.add(pl); this.registerDebris(pl); } }
        addPoster();
        break;
      }
      case 'corridor': {
        // cover + a trickle of hazards; corridors carry tension, not transit
        const n = Math.max(1, Math.round(d / 6));
        for (let i = 0; i < n; i++) placeDestr(() => makeFilingCabinet(), 'furniture', 50, 0.8);
        if (rng() < 0.5) placeDestr(() => makeCopierProp(), 'furniture', 50, 0.85);
        if (rng() < 0.4) { const p = tryPlace(0.5); if (p) { const c = makeOfficeChair(); c.position.set(p.x, 0, p.z); this.group.add(c); this.registerDebris(c); } }
        // wall-mounted alarm (danger: shooting it calls a horde)
        if (rng() < 0.55) {
          const ax = rng() < 0.5 ? room.x0 + 0.4 : room.x1 - 0.4;
          const az = rngRange(rng, room.z0 + 2, room.z1 - 2);
          const alarm = makeAlarmBox();
          alarm.position.set(ax, 1.7, az);
          this.group.add(alarm);
          this.destructibles.push({ id: nextId(), kind: 'alarm', pos: new THREE.Vector3(ax, 1.7, az), radius: 0.45, hp: 1, group: alarm, dead: false });
        }
        break;
      }
      case 'bullpen': {
        // cubicle pods + desks: the working floor
        const pods = Math.max(1, Math.round((w * d) / 160));
        for (let i = 0; i < pods; i++) {
          const p = tryPlace(3.4, 1.4);
          if (!p) continue;
          const c = makeCubicleCluster(P);
          c.position.set(p.x, 0, p.z);
          this.group.add(c);
          const { L, T, H } = c.userData.crossColliders;
          this.addCollider(p.x - L / 2, p.x + L / 2, p.z - T / 2, p.z + T / 2, H);
          this.addCollider(p.x - T / 2, p.x + T / 2, p.z - L / 2, p.z + L / 2, H);
        }
        for (let i = 0; i < Math.round(w / 5); i++) placeDestr(() => makeDesk(P), 'furniture', 40, 1.15);
        placeDestr(() => makeCoffeeMachine(), 'coffee', 30, 0.8);
        if (rng() < 0.7) placeDestr(() => makeWaterCooler(), 'cooler', 20, 0.6);
        for (let i = 0; i < 3; i++) { const p = tryPlace(0.5); if (p) { const pl = makePlant(); pl.position.set(p.x, 0, p.z); this.group.add(pl); this.registerDebris(pl); } }
        addPoster(); addPoster();
        this.spawnChestIn(room);
        break;
      }
      case 'arena': {
        // open conference center: pillars for cover, room to kite; sealed during lockdown
        for (const [fx, fz] of [[0.28, 0.3], [0.72, 0.3], [0.28, 0.7], [0.72, 0.7]]) {
          const px = room.x0 + w * fx, pz = room.z0 + d * fz;
          const pil = makePillar(WALL_H, P.trim);
          pil.position.set(px, 0, pz);
          this.group.add(pil);
          this.addFootprintCollider(pil, px, pz, 0);
          occupied.push({ x: px, z: pz, r: 1.2 });
        }
        for (let i = 0; i < 3; i++) placeDestr(() => makeDesk(P), 'furniture', 40, 1.15);
        placeDestr(() => makeVendingMachine(P), 'vending', 50, 0.9);
        addPoster();
        this.spawnChestIn(room);
        break;
      }
      case 'elevatorHall': {
        for (let i = 0; i < 2; i++) placeDestr(() => makeFilingCabinet(), 'furniture', 50, 0.8);
        for (let i = 0; i < 2; i++) { const p = tryPlace(0.5); if (p) { const pl = makePlant(); pl.position.set(p.x, 0, p.z); this.group.add(pl); this.registerDebris(pl); } }
        this.spawnChestIn(room);
        break;
      }
      case 'vault': {
        // the payoff room: gold light, exec chest, cash
        const statue = makeStatue();
        statue.position.set(room.cx, 0, room.z0 + 1.8);
        this.group.add(statue);
        this.addFootprintCollider(statue, room.cx, room.z0 + 1.8, 0);
        this.spawnChestIn(room, true);
        this.spawnChestIn(room);
        room.vaultLoot = true;
        break;
      }
      case 'utility': {
        // facilities: utility stations + the floor switch
        const utils = ['printer3d', 'coffeestation', 'shredder', 'hydration'];
        for (let i = 0; i < 2; i++) {
          const idx = Math.floor(rng() * utils.length);
          const type = utils.splice(idx, 1)[0];
          const p = tryPlace(1.0, 1.2);
          if (p) this.spawnUtility(type, p.x, p.z);
        }
        this.buildFloorSwitch(room);
        break;
      }
      case 'breakroom': {
        placeDestr(() => makeVendingMachine(P), 'vending', 50, 0.9);
        const p = tryPlace(1.0);
        if (p) this.spawnUtility('hydration', p.x, p.z);
        for (let i = 0; i < 3; i++) this.dropSoda(new THREE.Vector3(room.cx + rngRange(rng, -2, 2), 0, room.cz + rngRange(rng, -2, 2)));
        break;
      }
    }
  }

  buildFloorSwitch(room) {
    const g = new THREE.Group();
    const panel = box(1.2, 1.8, 0.3, 0x2a2e36, { rough: 0.5 });
    panel.position.y = 0.9;
    const lever = box(0.16, 0.5, 0.16, 0xff4d5a, { emissive: 0x7a1414, emissiveIntensity: 1.2 });
    lever.position.set(0, 1.2, 0.22);
    lever.rotation.x = 0.5;
    const label = makePoster('FLOOR\nBREAKER', '#38e1ff', '#0d1118');
    label.scale.setScalar(0.4);
    label.position.set(0, 1.85, 0.18);
    g.add(panel, lever, label);
    g.position.set(room.cx, 0, room.z0 + 0.8);
    this.group.add(g);
    this.addCollider(room.cx - 0.6, room.cx + 0.6, room.z0 + 0.5, room.z0 + 1.1, 2);
    this.utilitySwitch = {
      id: nextId(), pos: new THREE.Vector3(room.cx, 0.9, room.z0 + 1.4), radius: 2.6,
      used: false, lever, group: g,
    };
    this.disposables.push(label.material.map, label.material);
  }

  spawnChestIn(room, gold = false) {
    for (let i = 0; i < 14; i++) {
      const x = rngRange(this.rng, room.x0 + 1.6, room.x1 - 1.6);
      const z = rngRange(this.rng, room.z0 + 1.6, room.z1 - 1.6);
      if (this.nearDoorway(x, z, 2.2)) continue;
      let blocked = false;
      for (const c of this.colliders) {
        if (!c.disabled && x > c.minX - 1 && x < c.maxX + 1 && z > c.minZ - 1 && z < c.maxZ + 1 && (c.h ?? 5) > 0.5) { blocked = true; break; }
      }
      if (blocked) continue;
      const g = makeChest(gold);
      g.position.set(x, 0, z);
      g.rotation.y = rngRange(this.rng, 0, Math.PI * 2);
      this.group.add(g);
      const chest = {
        id: nextId(), kind: gold ? 'goldchest' : 'chest', gold,
        pos: new THREE.Vector3(x, 0.4, z), radius: 2.4, group: g,
        opened: false, lid: g.userData.lid, lidT: 0,
      };
      this.chests.push(chest);
      this.interactables.push(chest);
      return chest;
    }
    return null;
  }

  nearDoorway(x, z, r) {
    for (const dr of this.paidDoors) if (Math.hypot(x - dr.pos.x, z - dr.pos.z) < r) return true;
    for (const s of this.arenaSeals) if (Math.hypot(x - s.mesh.position.x, z - s.mesh.position.z) < r) return true;
    // also keep spine room-to-room gaps clear via room edges proximity
    for (const room of this.rooms) {
      if (Math.abs(z - room.z0) < 1.2 || Math.abs(z - room.z1) < 1.2) {
        if (x > room.x0 - 1 && x < room.x1 + 1) return true;
      }
    }
    return false;
  }

  // ================= penthouse (single executive arena, as before) =================
  buildPenthouse() {
    const def = this.def;
    const P = def.palette;
    const W = def.size[0], D = def.size[1];
    const hw = W / 2, hd = D / 2;
    this._bounds = { minX: -hw + 1.1, maxX: hw - 1.1, minZ: -hd + 1.1, maxZ: hd - 1.1 };
    this.rooms = [{ id: 0, type: 'penthouse', x0: -hw, x1: hw, z0: -hd, z1: hd, cx: 0, cz: 0, discovered: true, spine: true }];

    const carpet = makeCarpet(W, D, P, def.key);
    this.group.add(carpet);
    this.disposables.push(carpet.material.map, carpet.material);
    const mkWall = (len, x, z, rotY) => {
      const wl = box(len, WALL_H, 0.6, P.wall);
      wl.position.set(x, WALL_H / 2, z);
      wl.rotation.y = rotY;
      this.group.add(wl);
    };
    mkWall(W, 0, -hd, 0); mkWall(W, 0, hd, 0);
    mkWall(D, -hw, 0, Math.PI / 2); mkWall(D, hw, 0, Math.PI / 2);
    // real perimeter colliders so entities/projectiles stop at the wall face, not an invisible inset
    this.addCollider(-hw - 0.3, hw + 0.3, -hd - 0.3, -hd + 0.3, WALL_H);
    this.addCollider(-hw - 0.3, hw + 0.3, hd - 0.3, hd + 0.3, WALL_H);
    this.addCollider(-hw - 0.3, -hw + 0.3, -hd, hd, WALL_H);
    this.addCollider(hw - 0.3, hw + 0.3, -hd, hd, WALL_H);
    this._bounds = { minX: -hw + 0.4, maxX: hw - 0.4, minZ: -hd + 0.4, maxZ: hd - 0.4 };
    for (const side of [-1, 1]) {
      const win = makeWindowStrip(D * 0.85, 2.6, P);
      win.position.set(side * (hw - 0.28), 2.6, 0);
      win.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      this.group.add(win);
      this.disposables.push(win.material.map, win.material);
    }
    const hemi = new THREE.HemisphereLight(P.sky, P.trim, 0.7);
    const sun = new THREE.DirectionalLight(P.light, 1.2);
    sun.position.set(hw * 0.6, 18, -hd * 0.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -hw - 4; sun.shadow.camera.right = hw + 4;
    sun.shadow.camera.top = hd + 4; sun.shadow.camera.bottom = -hd - 4;
    this.group.add(hemi, sun, sun.target);
    this.lights = { hemi, sun };

    const desk = makeCEODesk(P);
    desk.position.set(0, 0, -8);
    this.group.add(desk);
    this.addFootprintCollider(desk, 0, -8, 0);
    const rc = new THREE.Mesh(new THREE.PlaneGeometry(4, 26), mat(0x7c1622, { rough: 0.95 }));
    rc.rotation.x = -Math.PI / 2;
    rc.position.set(0, 0.02, 4);
    this.group.add(rc);
    for (const sx of [-6, 6]) {
      const s = makeStatue();
      s.position.set(sx, 0, -10);
      this.group.add(s);
      this.addFootprintCollider(s, sx, -10, 0);
    }
    for (const [px, pz] of [[-12, -2], [12, -2], [-12, 10], [12, 10]]) {
      const pil = makePillar(WALL_H, 0x4a3d20);
      pil.position.set(px, 0, pz);
      this.group.add(pil);
      this.addFootprintCollider(pil, px, pz, 0);
    }
    this.arrival = this.placeElevator(0, hd - 0.4, Math.PI, P, false);
    this.arrival.doorOpen = 1;
    this.arrival.closeTimer = 2.2;
    this.playerSpawn = new THREE.Vector3(0, 0, hd - 4.5);
    this.elevator = this.placeElevator(0, -hd + 0.4, 0, P, true);
    for (let i = 0; i < def.chests; i++) this.spawnChestIn(this.rooms[0]);
    const utils = ['printer3d', 'coffeestation', 'hydration'];
    for (let i = 0; i < 2; i++) {
      const x = rngRange(this.rng, -hw + 4, hw - 4), z = rngRange(this.rng, -hd + 4, hd - 4);
      this.spawnUtility(utils[i], x, z);
    }
  }

  // ================= shared helpers (API preserved) =================
  placeElevator(x, z, rotY, P, isExit) {
    const g = makeElevator(P, this.def?.elevatorModel ?? null);
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    this.group.add(g);
    const rec = {
      group: g, doorL: g.userData.doorL, doorR: g.userData.doorR,
      pos: new THREE.Vector3(x, 0, z + (rotY === 0 ? 2.2 : -2.2)),
      innerPos: new THREE.Vector3(x, 0, z + (rotY === 0 ? -0.9 : 0.9)),
      doorOpen: 0, targetOpen: 0, isExit, W: g.userData.W,
    };
    // door collider spans the full doorway carve (±1.9 ≥ carve ±1.85 — no slits)
    if (rotY === 0) this.addCollider(x - 1.9, x + 1.9, z - 2.2, z - 0.1, 4, rec);
    else this.addCollider(x - 1.9, x + 1.9, z + 0.1, z + 2.2, 4, rec);
    rec.doorCollider = this.colliders[this.colliders.length - 1];
    // permanent cab shell: the doorway leads into the cab, NEVER into the void
    const s = rotY === 0 ? -1 : 1;   // which side of the wall the cab sits on
    const zNear = z + s * 0.0, zFar = z + s * 2.5;
    const zMin = Math.min(zNear, zFar), zMax = Math.max(zNear, zFar);
    this.addCollider(x - 2.4, x - 1.7, zMin - 0.4, zMax + 0.4, WALL_H);  // left cab wall
    this.addCollider(x + 1.7, x + 2.4, zMin - 0.4, zMax + 0.4, WALL_H);  // right cab wall
    const bz0 = Math.min(z + s * 2.1, z + s * 2.7), bz1 = Math.max(z + s * 2.1, z + s * 2.7);
    this.addCollider(x - 2.4, x + 2.4, bz0, bz1, WALL_H);                // back of cab
    return rec;
  }

  spawnUtility(type, x, z) {
    const g = new THREE.Group();
    let base, glow;
    switch (type) {
      case 'printer3d': base = makeCopierProp(); glow = 0x58e07c; break;
      case 'coffeestation': base = makeCoffeeMachine(); glow = 0xffd23f; break;
      case 'shredder': base = makeFilingCabinet(); glow = 0xff4d5a; break;
      case 'hydration': base = makeWaterCooler(); glow = 0x38e1ff; break;
    }
    g.add(base);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.1, 24),
      new THREE.MeshBasicMaterial({ color: glow, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    g.add(ring);
    g.position.set(x, 0, z);
    this.group.add(g);
    this.addFootprintCollider(base, x, z, 0);
    this.utilities.push({
      id: nextId(), kind: 'utility', type, pos: new THREE.Vector3(x, 0.5, z),
      radius: 2.5, group: g, ring, uses: type === 'printer3d' ? 2 : 99, priceMult: 1,
    });
  }

  addCollider(minX, maxX, minZ, maxZ, h, owner = null) {
    this.colliders.push({ minX, maxX, minZ, maxZ, h, owner });
  }

  addFootprintCollider(group, x, z, rotY) {
    const fp = group.userData.footprint;
    if (!fp) return null;
    const rot90 = Math.abs(Math.sin(rotY)) > 0.5;
    const w = rot90 ? fp.d : fp.w, d = rot90 ? fp.w : fp.d;
    this.addCollider(x - w / 2, x + w / 2, z - d / 2, z + d / 2, fp.h);
    return this.colliders[this.colliders.length - 1];
  }

  registerDebris(group) {
    this.debris.push({ group, vel: new THREE.Vector3(), angVel: new THREE.Vector3(), active: false });
  }

  kickDebris(pos, radius, force) {
    for (const d of this.debris) {
      const dd = dist2D(d.group.position, pos);
      if (dd < radius) {
        const k = (1 - dd / radius) * force;
        const dx = d.group.position.x - pos.x, dz = d.group.position.z - pos.z;
        const len = Math.max(0.2, Math.hypot(dx, dz));
        d.vel.x += (dx / len) * k;
        d.vel.z += (dz / len) * k;
        d.vel.y += k * 0.6;
        d.angVel.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
        d.active = true;
      }
    }
  }

  roomAt(x, z) {
    for (const r of this.rooms) {
      if (x >= r.x0 - 0.3 && x <= r.x1 + 0.3 && z >= r.z0 - 0.3 && z <= r.z1 + 0.3) return r;
    }
    return null;
  }

  adjacentRoomIds(room) {
    const out = new Set([room.id]);
    for (const other of this.rooms) {
      if (other === room) continue;
      const touchZ = Math.abs(other.z1 - room.z0) < 0.01 || Math.abs(other.z0 - room.z1) < 0.01;
      const touchX = Math.abs(other.x1 - room.x0) < 0.01 || Math.abs(other.x0 - room.x1) < 0.01;
      const overlapX = other.x0 < room.x1 && other.x1 > room.x0;
      const overlapZ = other.z0 < room.z1 && other.z1 > room.z0;
      if ((touchZ && overlapX) || (touchX && overlapZ)) out.add(other.id);
    }
    return out;
  }

  collideCircle(pos, radius, entityY = 0, entityH = 1.8) {
    let hit = false;
    const b = this._bounds;
    if (pos.x < b.minX + radius) { pos.x = b.minX + radius; hit = true; }
    if (pos.x > b.maxX - radius) { pos.x = b.maxX - radius; hit = true; }
    if (pos.z < b.minZ + radius) { pos.z = b.minZ + radius; hit = true; }
    if (pos.z > b.maxZ - radius) { pos.z = b.maxZ - radius; hit = true; }
    for (const c of this.colliders) {
      if (c.disabled) continue;
      if (resolveCircleAABB(pos, radius, c, entityY, entityH)) hit = true;
    }
    return hit;
  }

  /**
   * AI line of sight. Called by every enemy every think tick, so it is one of
   * the hottest queries in the game — hence the BVH. Traced at chest height
   * (1.35u) because that is what "can it see me" actually means: waist-high
   * furniture blocks a crawling roomba, not a standing drone.
   */
  losBlocked(ax, az, bx, bz) {
    const bvh = this.game?.bvh;
    if (bvh?.bvh) return bvh.segmentBlocked(ax, 1.35, az, bx, 1.35, bz);
    // fallback while the floor's BVH is still being built
    for (const c of this.colliders) {
      if (c.disabled || (c.h !== undefined && c.h < 1.3)) continue;
      if (segmentHitsAABB(ax, az, bx, bz, c)) return true;
    }
    return false;
  }

  pointBlocked(x, y, z) {
    const b = this._bounds;
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return true;
    if (y > CEIL_H - 0.05 && !this.def.isFinal) return true;
    for (const c of this.colliders) {
      if (c.disabled) continue;
      if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ && y < (c.h ?? WALL_H)) return true;
    }
    return false;
  }

  // room-aware spawn point: same room or an adjacent one, never the void.
  // onlyRoom restricts sampling to a single room (arena lockdowns spawn INSIDE the seal).
  findSpawnPoint(nearPos, minD, maxD, viewDir = null, onlyRoom = null) {
    const room = this.roomAt(nearPos.x, nearPos.z) ?? this.rooms[0];
    const candidates = onlyRoom
      ? [onlyRoom]
      : [...this.adjacentRoomIds(room)].map((id) => this.rooms[id])
        .filter((r) => !r.paidCost || this.isRoomOpen(r));
    for (let i = 0; i < 20; i++) {
      const r = candidates[(Math.random() * candidates.length) | 0];
      const x = clamp(r.x0 + Math.random() * (r.x1 - r.x0), r.x0 + 1.2, r.x1 - 1.2);
      const z = clamp(r.z0 + Math.random() * (r.z1 - r.z0), r.z0 + 1.2, r.z1 - 1.2);
      const dd = Math.hypot(x - nearPos.x, z - nearPos.z);
      if (dd < Math.min(minD, 8) * 0.6 || dd > maxD * 1.6) continue;
      let inside = false;
      for (const c of this.colliders) {
        if (!c.disabled && x > c.minX - 0.5 && x < c.maxX + 0.5 && z > c.minZ - 0.5 && z < c.maxZ + 0.5) { inside = true; break; }
      }
      if (inside) continue;
      if (viewDir && i < 12 && dd > 1) {
        const dx = (x - nearPos.x) / dd, dz = (z - nearPos.z) / dd;
        const dot = dx * viewDir.x + dz * viewDir.z;
        const occluded = this.losBlocked(nearPos.x, nearPos.z, x, z);
        if (dot > 0.25 && !occluded) continue;
      }
      return new THREE.Vector3(x, 0, z);
    }
    // fallback: center of an adjacent room
    const r = candidates[(Math.random() * candidates.length) | 0] ?? room;
    return new THREE.Vector3(r.cx, 0, r.cz);
  }

  isRoomOpen(room) {
    const door = this.paidDoors.find((d) => d.roomId === room.id);
    return !door || door.open;
  }

  /**
   * Single funnel for toggling a collider so the BVH and the physics world stay
   * in step with it. Only fires on an actual change — the elevator doors call
   * this every frame and a per-frame BVH refit would be pure waste.
   */
  setColliderDisabled(collider, disabled) {
    if (!collider || collider.disabled === disabled) return;
    collider.disabled = disabled;
    this.game?.bvh?.markDirty();
    this.game?.physics?.setColliderEnabled(collider, !disabled);
  }

  openPaidDoor(door) {
    door.open = true;
    this.setColliderDisabled(door.collider, true);
    door.mesh.visible = false;
    door.lock.material = door.lock.material.clone();
    door.lock.material.color.setHex(0x58e07c);
    door.lock.material.emissive.setHex(0x1d7a34);
    door.lock.position.y = 3.0;
  }

  setDoors(rec, open) { rec.targetOpen = open ? 1 : 0; }

  update(dt, game) {
    this.time += dt;
    for (const rec of [this.elevator, this.arrival]) {
      if (!rec) continue;
      if (rec.closeTimer !== undefined) {
        rec.closeTimer -= dt;
        if (rec.closeTimer <= 0) { rec.targetOpen = 0; rec.closeTimer = undefined; }
        else rec.doorOpen = 1;
      }
      const speed = 1.4;
      if (rec.doorOpen < rec.targetOpen) rec.doorOpen = Math.min(rec.targetOpen, rec.doorOpen + dt * speed);
      else if (rec.doorOpen > rec.targetOpen) rec.doorOpen = Math.max(rec.targetOpen, rec.doorOpen - dt * speed);
      const slide = rec.doorOpen * (rec.W / 2 - 0.1);
      rec.doorL.position.x = -rec.W / 4 - slide;
      rec.doorR.position.x = rec.W / 4 + slide;
      if (rec.doorCollider) this.setColliderDisabled(rec.doorCollider, rec.doorOpen > 0.75);
    }
    for (const ch of this.chests) {
      if (ch.opened && ch.lidT < 1) {
        ch.lidT = Math.min(1, ch.lidT + dt * 3);
        ch.lid.rotation.x = -ch.lidT * 1.9;
      }
    }
    for (const u of this.utilities) {
      u.ring.material.opacity = u.uses <= 0 ? 0.08 : 0.35 + Math.sin(this.time * 3) * 0.2;
    }
    for (const d of this.debris) {
      if (!d.active) continue;
      d.vel.y -= 18 * dt;
      d.group.position.addScaledVector(d.vel, dt);
      d.group.rotation.x += d.angVel.x * dt;
      d.group.rotation.y += d.angVel.y * dt;
      d.group.rotation.z += d.angVel.z * dt;
      if (d.group.position.y < 0) {
        d.group.position.y = 0;
        d.vel.y *= -0.3;
        d.vel.x *= 0.6; d.vel.z *= 0.6;
        d.angVel.multiplyScalar(0.5);
        if (d.vel.lengthSq() < 0.4) d.active = false;
      }
    }
    for (let i = this.sodas.length - 1; i >= 0; i--) {
      const s = this.sodas[i];
      s.group.rotation.y += dt * 3;
      s.group.position.y = 0.35 + Math.sin(this.time * 3 + s.phase) * 0.08;
      const pl = game.player;
      if (pl && !pl.dead) {
        const dd = dist2D(s.group.position, pl.pos);
        if (dd < 3.5) {
          const dir = new THREE.Vector3().subVectors(pl.pos, s.group.position);
          dir.y = 0;
          s.group.position.addScaledVector(dir.normalize(), dt * 9);
        }
        if (dd < 0.8) {
          game.onSodaPickup(s);
          this.group.remove(s.group);
          this.sodas.splice(i, 1);
        }
      }
    }
  }

  dropSoda(pos) {
    const g = makeSodaCan();
    g.position.set(pos.x + (Math.random() - 0.5) * 1.4, 0.35, pos.z + (Math.random() - 0.5) * 1.4);
    this.group.add(g);
    this.sodas.push({ group: g, phase: Math.random() * 6 });
  }

  dispose(scene) {
    scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.isMesh || o.isLine) o.geometry?.dispose();
    });
    for (const d of this.disposables) d?.dispose?.();
  }
}
