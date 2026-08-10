// ============ floor generation v4: the office labyrinth ============
// Every floor is a big double-loaded office plate: a central ELEVATOR CORE,
// corridor spines and cross-corridors, and blocks of departments subdivided
// into rooms with pocket dead-ends — then a seeded set of doorways is SEALED
// into solid wall (src/game/floorplan.js), so every floor is a different
// labyrinth with loops, long routes and shortcuts. The team badges in at four
// edge stairwells and has to navigate inward; the FLOOR LEAD keeps a private
// office (the LAIR) in an outer corner, meetable long before the elevator
// call. Paid side rooms (VAULT, UTILITY, BREAK ROOM) hang off the maze behind
// budget doors. The penthouse keeps its single executive arena.
import * as THREE from 'three';
import {
  makeCarpet, makeWindowStrip, makePoster, makeDesk, makeOfficeChair, makeCubicleCluster,
  makeFilingCabinet, makePlant, makeWaterCooler, makeVendingMachine, makeCoffeeMachine,
  makeCopierProp, makePillar, makeAlarmBox, makeChest, makeElevator, makeElevatorCore,
  makeStairwellDoor, makeCEODesk, makeStatue, makeSodaCan, makeCanvasTexture, box, mat,
} from './props.js';
import { makeRng, rngRange, rngInt, rngChoose, resolveCircleAABB, segmentHitsAABB, clamp, dist2D, nextId } from '../core/utils.js';
import { planFloor, pairKey } from './floorplan.js';

const POSTER_LINES = {
  lobby: ['WELCOME\nTO J.O.B.', 'VISITORS MUST\nSIGN IN', 'NO SOLICITING', 'YOUR CAREER\nSTARTS HERE ▲'],
  hr: ['OUR PEOPLE\nARE OUR\nGREATEST ASSET', 'SPEAK UP!\n(IN WRITING)', 'MANDATORY\nFUN 3PM', 'THIS IS A\nSAFE SPACE'],
  it: ['HAVE YOU TRIED\nREBOOTING', 'TICKET FIRST\nTHEN PANIC', 'DO NOT UNPLUG\nANYTHING', 'PATCH\nTUESDAY'],
  finance: ['SYNERGY', 'Q4 OR\nDIE TRYIN', 'THE BUDGET\nIS A LIE', 'STONKS ▲'],
  marketing: ['BRAND!', 'GO VIRAL\nOR GO HOME', 'ENGAGE!', 'CONTENT\nIS KING'],
  sales: ['ALWAYS BE\nCLOSING', 'SALES\nLEADERBOARD', 'COFFEE IS FOR\nCLOSERS', 'RING THE\nBELL 🔔'],
  penthouse: ['VISION', 'DISRUPT', 'EXCELLENCE', 'PROFIT'],
};

const ROOM_SIGNS = {
  core: 'ELEVATOR CORE', corridor: null, bullpen: 'OPEN OFFICE', conference: 'CONFERENCE CENTER',
  lounge: 'STAFF LOUNGE', records: 'RECORDS', vault: '⚠ RESTRICTED — VAULT',
  utility: 'FACILITIES', breakroom: 'BREAK ROOM', lair: '⚠ FLOOR LEAD — PRIVATE OFFICE',
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
    if (def.sandbox) { this.buildSandbox(); return; }
    if (def.isFinal) { this.buildPenthouse(); return; }
    const P = def.palette;

    // ---- plan first (pure + seeded), then pour the concrete ----
    const plan = planFloor(this.seed, def);
    this.rooms = plan.rooms.map((r) => ({ ...r, discovered: false }));
    this.sealedPairs = plan.sealed;
    this.coreRoom = this.rooms[plan.coreId];
    // `arenaRoom` is what the director and the seal code call "the room the
    // lockdown happens in" — on a labyrinth floor that is still the core.
    this.arenaRoom = this.coreRoom;
    this.lairRoom = plan.lairId != null ? this.rooms[plan.lairId] : null;

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
    sun.shadow.camera.far = 90;
    sun.shadow.bias = -0.0004;
    this.group.add(hemi, sun, sun.target);
    this.lights = { hemi, sun };

    // ---- shells, then contents ----
    for (const room of this.rooms) this.buildRoomShell(room);
    for (const room of this.rooms) this.furnishRoom(room);

    // ---- the elevator core, and the stairwells the team badges in at ----
    this.elevator = this.placeCoreElevator(P);
    this.playerSpawns = plan.stairs.map((s) => this.placeStairwell(
      { key: s.key, ax: s.ax, az: s.az, outer: this.rooms[s.roomId] }, P));

    // ---- karen lurks in a corridor ----
    if (this.rng() < def.karenChance) {
      const corr = this.rooms.filter((r) => r.type === 'corridor');
      if (corr.length) {
        const c = rngChoose(this.rng, corr);
        this.karenSpot = new THREE.Vector3(
          clamp(c.cx + rngRange(this.rng, -1, 1), c.x0 + 1.5, c.x1 - 1.5), 0,
          clamp(c.cz, c.z0 + 1.5, c.z1 - 1.5));
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
    if (room.type === 'vault' || room.type === 'utility' || room.type === 'breakroom' || room.type === 'lair' || room.type === 'arena') {
      const tint = room.type === 'vault' ? 0xffd23f : room.type === 'utility' ? 0x38e1ff
        : room.type === 'breakroom' ? 0x58e07c : room.type === 'lair' ? 0xff4d5a : 0xff9b2d;
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
      // every core mouth gets a shutter — this is what slams down for the holdout
      arenaEdge: room.type === 'core' || other.type === 'core',
      // labyrinth cut (floorplan.js): sealed adjacencies get solid wall, no door
      sealed: this.sealedPairs?.has(pairKey(room.id, other.id)) ?? false,
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
      if (g.sealed) {                                                 // labyrinth cut: solid wall
        if (!g.builder) cuts.push([g.lo, g.hi]);                      // the owner builds straight through
        continue;
      }
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
    const sorted = gapList.filter((g) => g.builder && !g.sealed).sort((a, b) => a.c - b.c);
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
      if (signText && (other.spine === false || other.type === 'core')) {
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

  /**
   * Where a wing room's stairwell door and the spawn in front of it sit.
   * Shared by furnishRoom (which reserves the landing) and placeStairwell
   * (which builds it), so furniture can never spawn on top of a player.
   */
  stairLanding(room) {
    const side = room.arrivalSide;
    if (!side) return null;
    const horizontal = side === 'north' || side === 'south';
    const line = side === 'north' ? room.z0 : side === 'south' ? room.z1 : side === 'west' ? room.x0 : room.x1;
    const inward = (side === 'north' || side === 'west') ? 1 : -1;
    return {
      side, horizontal, line, inward,
      doorX: horizontal ? room.cx : line + inward * 0.32,
      doorZ: horizontal ? line + inward * 0.32 : room.cz,
      x: horizontal ? room.cx : line + inward * 3.6,
      z: horizontal ? line + inward * 3.6 : room.cz,
    };
  }

  // ================= furnishing =================
  // v4: rooms are dressed like an office, not a yard sale — desks in aligned
  // rows with their chairs tucked in, machines flush against walls, cabinets
  // forming aisles, meeting tables with real seating. Randomness only jitters
  // positions; orientation and grouping are structural.
  furnishRoom(room) {
    const P = this.def.palette;
    const rng = this.rng;
    const w = room.x1 - room.x0, d = room.z1 - room.z0;
    const occupied = [];
    // Reserve the stairwell landing FIRST. Players materialise here, so nothing
    // — furniture, pillars or chests — may claim it.
    const landing = this.stairLanding(room);
    if (landing) occupied.push({ x: landing.x, z: landing.z, r: 3.6 });
    const free = (x, z, r) => {
      if (this.nearDoorway(x, z, 2.5)) return false;
      for (const o of occupied) if (Math.hypot(x - o.x, z - o.z) < o.r + r) return false;
      return true;
    };
    const tryPlace = (r, margin = 1.0, tries = 24, inset = 1.6) => {
      for (let i = 0; i < tries; i++) {
        const x = rngRange(rng, room.x0 + inset, room.x1 - inset);
        const z = rngRange(rng, room.z0 + inset, room.z1 - inset);
        if (!free(x, z, r + margin)) continue;
        occupied.push({ x, z, r });
        return { x, z };
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
    const registerDestr = (g, x, z, kind, hp, radius, footprint = true) => {
      this.group.add(g);
      const col = footprint ? this.addFootprintCollider(g, x, z, g.rotation.y) : null;
      this.destructibles.push({ id: nextId(), kind, pos: new THREE.Vector3(x, 0.8, z), radius, hp, group: g, dead: false, collider: col });
    };
    const placeDestrAt = (x, z, rotY, fac, kind, hp, radius, footprint = true) => {
      if (!free(x, z, radius + 0.15)) return null;
      occupied.push({ x, z, r: radius });
      const g = fac();
      g.position.set(x, 0, z);
      g.rotation.y = rotY;
      registerDestr(g, x, z, kind, hp, radius, footprint);
      return g;
    };
    const placeDestr = (fac, kind, hp, radius, footprint = true) => {
      const p = tryPlace(radius + 0.2);
      if (!p) return null;
      const g = fac();
      g.position.set(p.x, 0, p.z);
      g.rotation.y = rngInt(rng, 0, 3) * Math.PI / 2;
      registerDestr(g, p.x, p.z, kind, hp, radius, footprint);
      return g;
    };
    const placeProp = (x, z, rotY, fac) => {
      if (!free(x, z, 0.55)) return null;
      occupied.push({ x, z, r: 0.5 });
      const g = fac();
      g.position.set(x, 0, z);
      g.rotation.y = rotY;
      this.group.add(g);
      this.registerDebris(g);
      return g;
    };
    // flush-to-wall placement: t runs 0..1 along the wall, rotY faces the room
    const wallSpot = (side, t, inset) => {
      if (side === 'w') return { x: room.x0 + inset, z: room.z0 + 2 + (d - 4) * t, rotY: Math.PI / 2 };
      if (side === 'e') return { x: room.x1 - inset, z: room.z0 + 2 + (d - 4) * t, rotY: -Math.PI / 2 };
      if (side === 'n') return { x: room.x0 + 2 + (w - 4) * t, z: room.z0 + inset, rotY: 0 };
      return { x: room.x0 + 2 + (w - 4) * t, z: room.z1 - inset, rotY: Math.PI };
    };
    const mountAlarm = (side) => {
      const s = wallSpot(side, rngRange(rng, 0.15, 0.85), 0.4);
      const alarm = makeAlarmBox();
      alarm.position.set(s.x, 1.7, s.z);
      this.group.add(alarm);
      this.destructibles.push({ id: nextId(), kind: 'alarm', pos: new THREE.Vector3(s.x, 1.7, s.z), radius: 0.45, hp: 1, group: alarm, dead: false });
    };
    // a run of desks, each with its office chair tucked in behind it
    const deskRow = (cx, cz, rotY, count, gap = 3.3) => {
      const fx = Math.sin(rotY), fz = Math.cos(rotY);       // desk facing
      const rx = Math.cos(rotY), rz = -Math.sin(rotY);      // along the row
      const start = -((count - 1) / 2) * gap;
      for (let i = 0; i < count; i++) {
        const x = cx + rx * (start + i * gap), z = cz + rz * (start + i * gap);
        const g = placeDestrAt(x, z, rotY, () => makeDesk(P), 'furniture', 40, 1.15);
        if (g) placeProp(x - fx * 1.15, z - fz * 1.15, rotY, () => makeOfficeChair(P.cubicle));
      }
    };
    const longSides = w >= d ? ['n', 's'] : ['w', 'e'];

    switch (room.type) {
      case 'core': {
        // The arena. Kept deliberately open — the elevator shaft in the middle
        // is the only hard cover, so the holdout is about angles, not camping.
        occupied.push({ x: 0, z: 0, r: 5.4 });
        for (const [fx2, fz2] of [[0.16, 0.16], [0.84, 0.16], [0.16, 0.84], [0.84, 0.84]]) {
          const px = room.x0 + w * fx2, pz = room.z0 + d * fz2;
          if (!free(px, pz, 1.2)) continue;
          const pil = makePillar(WALL_H, P.trim);
          pil.position.set(px, 0, pz);
          this.group.add(pil);
          this.addFootprintCollider(pil, px, pz, 0);
          occupied.push({ x: px, z: pz, r: 1.2 });
        }
        // twin reception desks facing the elevator mouth
        for (const sdir of [-1, 1]) {
          const g = placeDestrAt(sdir * 4.8, 6.6, Math.PI, () => makeDesk(P), 'furniture', 40, 1.15);
          if (g) placeProp(sdir * 4.8, 7.8, Math.PI, () => makeOfficeChair(P.cubicle));
        }
        const vs = wallSpot('n', 0.5, 0.85);
        placeDestrAt(vs.x, vs.z, vs.rotY, () => makeVendingMachine(P), 'vending', 50, 0.9);
        addPoster(); addPoster();
        this.spawnChestIn(room);
        break;
      }
      case 'corridor': {
        // everything hugs the walls: corridors carry tension, never clutter
        const horizontal = w >= d;
        const wallSides = horizontal ? ['n', 's'] : ['w', 'e'];
        const len = horizontal ? w : d;
        const n = Math.max(1, Math.round(len / 11));
        for (let i = 0; i < n; i++) {
          const side = wallSides[i % 2];
          const t = clamp((i + 0.5) / n + rngRange(rng, -0.08, 0.08), 0.05, 0.95);
          const s = wallSpot(side, t, 0.75);
          if (rng() < 0.7) placeDestrAt(s.x, s.z, s.rotY, () => makeFilingCabinet(), 'furniture', 50, 0.8);
          else placeDestrAt(s.x, s.z, s.rotY, () => makeCopierProp(), 'furniture', 50, 0.85);
        }
        if (rng() < 0.5) {
          // waiting bench: two chairs side by side against the wall
          const s = wallSpot(wallSides[0], rngRange(rng, 0.2, 0.8), 0.8);
          const bx = horizontal ? 0.95 : 0, bz = horizontal ? 0 : 0.95;
          placeProp(s.x, s.z, s.rotY, () => makeOfficeChair(P.cubicle));
          placeProp(s.x + bx, s.z + bz, s.rotY, () => makeOfficeChair(P.cubicle));
        }
        if (rng() < 0.55) mountAlarm(wallSides[rng() < 0.5 ? 0 : 1]);
        addPoster();
        if (len > 34) addPoster();
        break;
      }
      case 'bullpen': {
        const horizontal = w >= d;
        const rotY = horizontal ? 0 : Math.PI / 2;
        if (rng() < 0.5 && w > 15 && d > 15) {
          // STYLE A: cubicle farm — clusters on an aligned grid
          const cols = Math.max(1, Math.floor((w - 6) / 11));
          const rows = Math.max(1, Math.floor((d - 6) / 11));
          for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
            const x = room.x0 + 3 + (w - 6) * ((i + 0.5) / cols) + rngRange(rng, -0.6, 0.6);
            const z = room.z0 + 3 + (d - 6) * ((j + 0.5) / rows) + rngRange(rng, -0.6, 0.6);
            if (!free(x, z, 3.5)) continue;
            occupied.push({ x, z, r: 3.4 });
            const c = makeCubicleCluster(P);
            c.position.set(x, 0, z);
            this.group.add(c);
            const { L, T, H } = c.userData.crossColliders;
            this.addCollider(x - L / 2, x + L / 2, z - T / 2, z + T / 2, H);
            this.addCollider(x - T / 2, x + T / 2, z - L / 2, z + L / 2, H);
          }
        } else {
          // STYLE B: open plan — aligned desk rows, all facing the same way
          const across = horizontal ? d : w;
          const along = horizontal ? w : d;
          const rows = Math.max(1, Math.floor(across / 5.6) - 1);
          const count = Math.min(5, Math.max(2, Math.floor(along / 3.8) - 1));
          for (let j = 0; j < rows; j++) {
            const off = (j + 0.5) / rows;
            const cx = horizontal ? room.cx : room.x0 + 2.6 + (w - 5.2) * off;
            const cz = horizontal ? room.z0 + 2.6 + (d - 5.2) * off : room.cz;
            deskRow(cx, cz, rotY, count);
          }
        }
        // kitchenette against a wall + greenery in the corners
        const k1 = wallSpot(longSides[0], 0.14, 0.8);
        placeDestrAt(k1.x, k1.z, k1.rotY, () => makeCoffeeMachine(), 'coffee', 30, 0.8);
        const k2 = wallSpot(longSides[0], 0.27, 0.75);
        placeDestrAt(k2.x, k2.z, k2.rotY, () => makeWaterCooler(), 'cooler', 20, 0.6);
        placeProp(room.x0 + 1.3, room.z0 + 1.3, 0, () => makePlant());
        placeProp(room.x1 - 1.3, room.z1 - 1.3, 0, () => makePlant());
        addPoster(); addPoster();
        if (rng() < 0.6) this.spawnChestIn(room);
        break;
      }
      case 'conference': {
        // one long boardroom table down the middle, chairs on both sides
        const horizontal = w >= d;
        const rotY = horizontal ? 0 : Math.PI / 2;
        const fx = Math.sin(rotY), fz = Math.cos(rotY);        // across the table
        const rx = Math.cos(rotY), rz = -Math.sin(rotY);       // along the table
        const segs = Math.max(1, Math.floor(((horizontal ? w : d) - 8) / 4.1));
        const start = -((segs - 1) / 2) * 3.9;
        for (let i = 0; i < segs; i++) {
          const x = room.cx + rx * (start + i * 3.9), z = room.cz + rz * (start + i * 3.9);
          const table = makeDesk(P, false);
          table.scale.set(1.9, 1.05, 1.5);
          table.position.set(x, 0, z);
          table.rotation.y = rotY;
          this.group.add(table);
          if (horizontal) this.addCollider(x - 1.9, x + 1.9, z - 0.75, z + 0.75, 0.84);
          else this.addCollider(x - 0.75, x + 0.75, z - 1.9, z + 1.9, 0.84);
          occupied.push({ x, z, r: 2.0 });
          for (const sdir of [-1, 1]) {
            const crot = sdir < 0 ? rotY : rotY + Math.PI;
            placeProp(x + fx * sdir * 1.7 + rx * 0.7, z + fz * sdir * 1.7 + rz * 0.7, crot, () => makeOfficeChair(P.cubicle));
            placeProp(x + fx * sdir * 1.7 - rx * 0.9, z + fz * sdir * 1.7 - rz * 0.9, crot, () => makeOfficeChair(P.cubicle));
          }
        }
        // the presentation wall
        const es = wallSpot(horizontal ? 'w' : 'n', 0.5, 0.4);
        const scr = makePoster(rngChoose(rng, posters), '#' + P.accent.toString(16).padStart(6, '0'));
        scr.position.set(es.x, 2.5, es.z);
        scr.rotation.y = es.rotY;
        scr.scale.setScalar(1.3);
        this.group.add(scr);
        this.disposables.push(scr.material.map, scr.material);
        for (const [fxr, fzr] of [[0.15, 0.5], [0.85, 0.5]]) {
          const px = room.x0 + w * fxr, pz = room.z0 + d * fzr;
          if (!free(px, pz, 1.3)) continue;
          const pil = makePillar(WALL_H, P.trim);
          pil.position.set(px, 0, pz);
          this.group.add(pil);
          this.addFootprintCollider(pil, px, pz, 0);
          occupied.push({ x: px, z: pz, r: 1.2 });
        }
        if (rng() < 0.6) this.spawnChestIn(room);
        break;
      }
      case 'records': {
        // shelving AISLES along the long axis: tight sightlines, gaps to slip
        // through — great for specials, awful for you
        const horizontal = w >= d;
        const rotY = horizontal ? 0 : Math.PI / 2;
        const across = (horizontal ? d : w) - 5;
        const rows = Math.max(2, Math.floor(across / 3.4));
        const runLen = (horizontal ? w : d) - 6;
        const per = Math.max(2, Math.floor(runLen / 1.75));
        for (let j = 0; j < rows; j++) {
          if (rng() < 0.18) continue;                    // a missing row = a wide aisle
          const off = (j + 0.5) / rows;
          for (let i = 0; i < per; i++) {
            if (rng() < 0.22) continue;                  // gaps to slip through
            const along = -runLen / 2 + (i + 0.5) * (runLen / per);
            const x = horizontal ? room.cx + along : room.x0 + 2.5 + (w - 5) * off;
            const z = horizontal ? room.z0 + 2.5 + (d - 5) * off : room.cz + along;
            placeDestrAt(x, z, rotY, () => makeFilingCabinet(), 'furniture', 50, 0.8);
          }
        }
        const cs = wallSpot(longSides[0], 0.92, 0.85);
        placeDestrAt(cs.x, cs.z, cs.rotY, () => makeCopierProp(), 'furniture', 50, 0.85);
        if (rng() < 0.7) mountAlarm(longSides[1]);
        addPoster();
        if (rng() < 0.5) this.spawnChestIn(room);
        break;
      }
      case 'lounge': {
        // kitchenette line against one wall, seating circle in the middle
        const kw = longSides[0];
        const s1 = wallSpot(kw, 0.22, 0.85);
        placeDestrAt(s1.x, s1.z, s1.rotY, () => makeVendingMachine(P), 'vending', 50, 0.9);
        const s2 = wallSpot(kw, 0.4, 0.8);
        placeDestrAt(s2.x, s2.z, s2.rotY, () => makeCoffeeMachine(), 'coffee', 30, 0.8);
        const s3 = wallSpot(kw, 0.55, 0.75);
        placeDestrAt(s3.x, s3.z, s3.rotY, () => makeWaterCooler(), 'cooler', 20, 0.6);
        const t = makeDesk(P, false);
        t.scale.set(0.9, 0.62, 0.9);
        t.position.set(room.cx, 0, room.cz);
        this.group.add(t);
        this.addCollider(room.cx - 0.9, room.cx + 0.9, room.cz - 0.65, room.cz + 0.65, 0.5);
        occupied.push({ x: room.cx, z: room.cz, r: 1.2 });
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + 0.4;
          const chx = room.cx + Math.cos(a) * 2.1, chz = room.cz + Math.sin(a) * 2.1;
          placeProp(chx, chz, Math.atan2(-Math.cos(a), -Math.sin(a)), () => makeOfficeChair(P.cubicle));
        }
        placeProp(room.x0 + 1.3, room.z1 - 1.3, 0, () => makePlant());
        placeProp(room.x1 - 1.3, room.z0 + 1.3, 0, () => makePlant());
        const hp2 = tryPlace(1.0, 1.2);
        if (hp2) this.spawnUtility('hydration', hp2.x, hp2.z);
        for (let i = 0; i < 3; i++) this.dropSoda(new THREE.Vector3(room.cx + rngRange(rng, -3, 3), 0, room.cz + rngRange(rng, -3, 3)));
        addPoster();
        if (rng() < 0.6) this.spawnChestIn(room);
        break;
      }
      case 'lair': {
        // the floor lead's private office: meet them here on YOUR terms, or at
        // the elevator on theirs. One door, an executive desk, and their prize.
        const g = makeCEODesk(P);
        const dx = room.cx, dz = room.z0 + 2.6;
        g.position.set(dx, 0, dz);
        this.group.add(g);
        this.addFootprintCollider(g, dx, dz, 0);
        occupied.push({ x: dx, z: dz, r: 2.3 });
        const st = makeStatue();
        st.position.set(room.x0 + 1.7, 0, room.z0 + 1.7);
        this.group.add(st);
        this.addFootprintCollider(st, room.x0 + 1.7, room.z0 + 1.7, 0);
        for (const tw of [0.62, 0.82]) {
          const cs2 = wallSpot('w', tw, 0.75);
          placeDestrAt(cs2.x, cs2.z, cs2.rotY, () => makeFilingCabinet(), 'furniture', 50, 0.8);
        }
        placeProp(room.x1 - 1.4, room.z0 + 1.5, 0, () => makePlant());
        this.spawnChestIn(room, true);     // the lead's gold chest
        addPoster();
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
        const bs = wallSpot(longSides[0], 0.3, 0.85);
        placeDestrAt(bs.x, bs.z, bs.rotY, () => makeVendingMachine(P), 'vending', 50, 0.9);
        const p = tryPlace(1.0);
        if (p) this.spawnUtility('hydration', p.x, p.z);
        for (let i = 0; i < 3; i++) this.dropSoda(new THREE.Vector3(room.cx + rngRange(rng, -2, 2), 0, room.cz + rngRange(rng, -2, 2)));
        break;
      }
      default: {
        // unpaid pocket dead-ends fall back to a light records/lounge dressing
        for (let i = 0; i < 3; i++) placeDestr(() => makeFilingCabinet(), 'furniture', 50, 0.8);
        placeProp(room.x0 + 1.3, room.z0 + 1.3, 0, () => makePlant());
        if (rng() < 0.5) this.spawnChestIn(room);
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
    // keep room-to-room gaps clear. The hub plate has doorways on all four
    // sides of the core, so both axes have to be checked — a z-only test used
    // to let a chest park itself in an east/west corridor mouth.
    for (const room of this.rooms) {
      if ((Math.abs(z - room.z0) < 1.2 || Math.abs(z - room.z1) < 1.2)
        && x > room.x0 - 1 && x < room.x1 + 1) return true;
      if ((Math.abs(x - room.x0) < 1.2 || Math.abs(x - room.x1) < 1.2)
        && z > room.z0 - 1 && z < room.z1 + 1) return true;
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
    // one arena, so everyone steps out of the same executive elevator
    this.playerSpawns = [-3, 3, -6, 6].map((dx) => ({
      wing: 'p', label: 'EXECUTIVE ELEVATOR',
      pos: new THREE.Vector3(dx * 0.5, 0, hd - 4.5), yaw: Math.PI,
    }));
    this.elevator = this.placeElevator(0, -hd + 0.4, 0, P, true);
    for (let i = 0; i < def.chests; i++) this.spawnChestIn(this.rooms[0]);
    const utils = ['printer3d', 'coffeestation', 'hydration'];
    for (let i = 0; i < 2; i++) {
      const x = rngRange(this.rng, -hw + 4, hw - 4), z = rngRange(this.rng, -hd + 4, hd - 4);
      this.spawnUtility(utils[i], x, z);
    }
  }

  // ================= sandbox (v0.2 toy-test floor) =================
  // One open room, packed with breakables and self-respawning crash-test
  // dummies. No elevator, no objectives: the room exists to answer "is ten
  // minutes of movement and hitting things fun on its own?" (D 5.1). The
  // dummy pads are reserved before furniture so a respawn never lands inside
  // a vending machine.
  buildSandbox() {
    const def = this.def;
    const P = def.palette;
    const rng = this.rng;
    const [W, D] = def.size;
    const hw = W / 2, hd = D / 2;
    const room = { id: 0, type: 'sandbox', x0: -hw, x1: hw, z0: -hd, z1: hd, cx: 0, cz: 0, discovered: true, spine: true };
    this.rooms.push(room);
    this.coreRoom = room;
    this.arenaRoom = room;
    this._bounds = { minX: -hw + 0.4, maxX: hw - 0.4, minZ: -hd + 0.4, maxZ: hd - 0.4 };

    // lighting: same recipe as the hub floors
    const hemi = new THREE.HemisphereLight(P.sky, P.trim, 0.62);
    const sun = new THREE.DirectionalLight(P.light, 1.0);
    sun.position.set(14, 22, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -hw - 4; sun.shadow.camera.right = hw + 4;
    sun.shadow.camera.top = hd + 4; sun.shadow.camera.bottom = -hd - 4;
    sun.shadow.camera.far = 90;
    sun.shadow.bias = -0.0004;
    this.group.add(hemi, sun, sun.target);
    this.lights = { hemi, sun };

    this.buildRoomShell(room);   // a single room has no neighbours: four solid walls

    // ---- dummy pads on a ring, reserved before any furniture ----
    const occupied = [{ x: 0, z: hd - 3, r: 3.6 }];   // the player's arrival strip
    this.dummySpots = [];
    const nDummies = def.dummies ?? 6;
    const ringR = Math.min(hw, hd) * 0.55;
    for (let i = 0; i < nDummies; i++) {
      const a = (i / nDummies) * Math.PI * 2;
      const x = Math.cos(a) * ringR, z = Math.sin(a) * ringR;
      this.dummySpots.push(new THREE.Vector3(x, 0, z));
      occupied.push({ x, z, r: 2.0 });
      const pad = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.95, 24),
        new THREE.MeshBasicMaterial({ color: P.accent, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(x, 0.04, z);
      this.group.add(pad);
    }

    const tryPlace = (r, margin = 0.8, tries = 30) => {
      for (let i = 0; i < tries; i++) {
        const x = rngRange(rng, -hw + 1.8, hw - 1.8);
        const z = rngRange(rng, -hd + 1.8, hd - 1.8);
        let ok = true;
        for (const o of occupied) if (Math.hypot(x - o.x, z - o.z) < o.r + r + margin) { ok = false; break; }
        if (ok) { occupied.push({ x, z, r }); return { x, z }; }
      }
      return null;
    };
    const placeDestr = (fac, kind, hp, radius) => {
      const p = tryPlace(radius + 0.2);
      if (!p) return;
      const g = fac();
      g.position.set(p.x, 0, p.z);
      g.rotation.y = rngInt(rng, 0, 3) * Math.PI / 2;
      this.group.add(g);
      const col = this.addFootprintCollider(g, p.x, p.z, g.rotation.y);
      this.destructibles.push({ id: nextId(), kind, pos: new THREE.Vector3(p.x, 0.8, p.z), radius, hp, group: g, dead: false, collider: col });
    };

    // dense destructibles: the sandbox IS the furniture
    for (let i = 0; i < 2; i++) {
      const p = tryPlace(3.4, 1.2);
      if (!p) continue;
      const c = makeCubicleCluster(P);
      c.position.set(p.x, 0, p.z);
      this.group.add(c);
      const { L, T, H } = c.userData.crossColliders;
      this.addCollider(p.x - L / 2, p.x + L / 2, p.z - T / 2, p.z + T / 2, H);
      this.addCollider(p.x - T / 2, p.x + T / 2, p.z - L / 2, p.z + L / 2, H);
    }
    for (let i = 0; i < Math.round((W * D) / 90); i++) placeDestr(() => makeDesk(P), 'furniture', 40, 1.15);
    for (let i = 0; i < 6; i++) placeDestr(() => makeFilingCabinet(), 'furniture', 50, 0.8);
    for (let i = 0; i < 3; i++) placeDestr(() => makeVendingMachine(P), 'vending', 50, 0.9);
    for (let i = 0; i < 3; i++) placeDestr(() => makeCoffeeMachine(), 'coffee', 30, 0.8);
    for (let i = 0; i < 3; i++) placeDestr(() => makeWaterCooler(), 'cooler', 20, 0.6);
    for (let i = 0; i < 2; i++) placeDestr(() => makeCopierProp(), 'furniture', 50, 0.85);
    for (let i = 0; i < 6; i++) {
      const p = tryPlace(0.5);
      if (!p) continue;
      const pl = rng() < 0.5 ? makePlant() : makeOfficeChair(P.cubicle);
      pl.position.set(p.x, 0, p.z);
      this.group.add(pl);
      this.registerDebris(pl);
    }
    for (let i = 0; i < 4; i++) this.dropSoda(new THREE.Vector3(rngRange(rng, -hw + 3, hw - 3), 0, rngRange(rng, -hd + 3, hd - 3)));

    // badge in at the south wall, facing the room; no elevator on this floor
    this.playerSpawns = [{ wing: 's', label: null, pos: new THREE.Vector3(0, 0, hd - 3), yaw: Math.PI }];
  }

  /**
   * The elevator core: a solid shaft standing in the middle of the plate with
   * its doors facing +z. Unlike the wall-mounted cab this is an obstacle in its
   * own right — during the holdout it is the pillar everyone rotates around.
   */
  placeCoreElevator(P) {
    const g = makeElevatorCore(P);
    this.group.add(g);
    const { doorL, doorR, W, shaftW, shaftD } = g.userData;
    const rec = {
      group: g, doorL, doorR,
      pos: new THREE.Vector3(0, 0, shaftD / 2 + 2.0),      // where you stand to board
      innerPos: new THREE.Vector3(0, 0, shaftD / 2 + 1.0), // where the boss steps out
      doorOpen: 0, targetOpen: 0, isExit: true, W, isCore: true,
    };
    // the shaft itself is solid; the doorway strip in front of it is the only
    // part that opens, and it opens into the cab, never into the void
    const hw = shaftW / 2, hd = shaftD / 2;
    this.addCollider(-hw, hw, -hd, hd - 0.45, WALL_H);            // shaft body
    this.addCollider(-hw, -hw + 0.45, hd - 0.45, hd + 0.2, WALL_H); // left jamb
    this.addCollider(hw - 0.45, hw, hd - 0.45, hd + 0.2, WALL_H);   // right jamb
    this.addCollider(-hw + 0.45, hw - 0.45, hd - 0.45, hd + 0.2, WALL_H, rec); // the doors
    rec.doorCollider = this.colliders[this.colliders.length - 1];
    // a pool of light so the core reads as the objective from across the plate
    const lamp = new THREE.PointLight(P.accent, 26, 22, 1.7);
    lamp.position.set(0, CEIL_H - 0.5, hd + 2.4);
    this.group.add(lamp);
    return rec;
  }

  /**
   * A stairwell against a wing room's outer wall. Purely dressing plus the
   * spawn point in front of it — the elevator is the only way UP, the stairs
   * are only how you got in.
   */
  placeStairwell(wing, P) {
    const room = wing.outer;
    const L = this.stairLanding(room);
    const g = makeStairwellDoor(P, room.stairLabel ?? 'STAIRWELL');
    g.position.set(L.doorX, 0, L.doorZ);
    g.rotation.y = L.horizontal
      ? (L.side === 'north' ? 0 : Math.PI)
      : (L.side === 'west' ? Math.PI / 2 : -Math.PI / 2);
    this.group.add(g);
    this.disposables.push(g.userData.sign.material.map, g.userData.sign.material);
    return {
      wing: wing.key,
      label: room.stairLabel ?? 'STAIRWELL',
      pos: new THREE.Vector3(L.x, 0, L.z),
      // face down the wing, toward the core
      yaw: Math.atan2(-wing.ax, -wing.az),
    };
  }

  // ================= shared helpers (API preserved) =================
  placeElevator(x, z, rotY, P, isExit) {
    const g = makeElevator(P);
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
  /**
   * Height of the highest walkable surface under (x, z) that is at or below
   * `maxY`. Returns 0 for bare floor.
   *
   * `resolveCircleAABB` already lets an entity whose feet are above a collider's
   * top pass through it horizontally — it just had nothing to stand on, so
   * everything fell back to y = 0. Sampling here is what turns that latent
   * behaviour into vaulting onto desks and stepping over thresholds.
   *
   * @param {number} maxY highest surface to consider (feet + step height)
   * @param {number} r horizontal probe radius
   */
  groundHeightAt(x, z, maxY = 1e9, r = 0.3) {
    let best = 0;
    for (const c of this.colliders) {
      if (c.disabled) continue;
      const h = c.h ?? WALL_H;
      if (h <= best || h > maxY) continue;
      if (x < c.minX - r || x > c.maxX + r) continue;
      if (z < c.minZ - r || z > c.maxZ + r) continue;
      best = h;
    }
    return best;
  }

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
