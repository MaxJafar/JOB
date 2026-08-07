// ============ enemy roster & AI ============
// Base office mobs + L4D-style specials (Gossip/Complainer/Micromanager)
// + rares (Karen = witch, Auditor = tank).
import * as THREE from 'three';
import { makePerson, animateWalk, poseIdle, makeHeldItem } from './characters.js';
import { mat, box, cyl } from './props.js';
import { rand, chance, dist2D, nextId, clamp } from '../core/utils.js';
import { PathAgent } from '../core/navmesh.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _navTo = new THREE.Vector3();

export const ENEMY_DEFS = {
  // ---------- tower-wide staff (every floor) ----------
  paperling: { name: 'Paperling', hp: 16, dmg: 7, speed: 6.8, radius: 0.42, centerY: 0.45, xp: 2, money: 4, credit: 5, ai: 'melee', attackRange: 1.5, attackCd: 1.1, windup: 0.3 },
  drone: { name: 'Cubicle Drone', hp: 46, dmg: 12, speed: 3.8, radius: 0.5, centerY: 1.0, xp: 4, money: 7, credit: 9, ai: 'melee', attackRange: 1.7, attackCd: 1.4, windup: 0.42 },
  printer: { name: 'Rogue Printer', hp: 70, dmg: 9, speed: 2.4, radius: 0.65, centerY: 0.6, xp: 6, money: 10, credit: 13, ai: 'ranged', rangeMin: 8, rangeMax: 19, volley: 3, volleyCd: 2.7, projSpeed: 17 },
  roomba: { name: 'Roomba-C4', hp: 24, dmg: 27, speed: 8.2, radius: 0.45, centerY: 0.2, xp: 5, money: 8, credit: 11, ai: 'kamikaze', fuse: 0.55, aoe: 3.4 },
  quad: { name: 'Delivery Drone', hp: 38, dmg: 9, speed: 5.2, radius: 0.5, centerY: 0, xp: 6, money: 10, credit: 14, ai: 'flyer', hover: 3.4, rangeMin: 6, rangeMax: 15, volleyCd: 2.2, projSpeed: 20 },
  copier: { name: 'Copier Golem', hp: 260, dmg: 21, speed: 2.8, radius: 0.95, centerY: 1.2, xp: 18, money: 28, credit: 30, ai: 'melee', attackRange: 2.4, attackCd: 1.9, windup: 0.6, big: true },
  gossip: { name: 'The Gossip', hp: 80, dmg: 0, speed: 3.2, radius: 0.6, centerY: 1.0, xp: 10, money: 16, credit: 20, ai: 'gossip', special: true, popRange: 3.0 },
  complainer: { name: 'The Complainer', hp: 95, dmg: 9, speed: 3.5, radius: 0.55, centerY: 1.0, xp: 12, money: 18, credit: 24, ai: 'spitter', rangeMin: 9, rangeMax: 18, volleyCd: 3.4, special: true },
  micromanager: { name: 'The Micromanager', hp: 65, dmg: 6, speed: 6.4, radius: 0.45, centerY: 0.8, xp: 14, money: 20, credit: 26, ai: 'jockey', special: true },
  motivator: { name: 'The Motivator', hp: 90, dmg: 0, speed: 3.8, radius: 0.5, centerY: 1.0, xp: 14, money: 22, credit: 22, ai: 'rally', special: true },
  karen: { name: 'KAREN', hp: 950, dmg: 46, speed: 8.6, radius: 0.5, centerY: 1.0, xp: 90, money: 150, credit: 0, ai: 'karen', rare: true },
  auditor: { name: 'THE AUDITOR', hp: 1600, dmg: 32, speed: 3.6, radius: 1.15, centerY: 1.6, xp: 130, money: 240, credit: 110, ai: 'auditor', rare: true, big: true },

  // ---------- HUMAN RESOURCES ----------
  // The threat here is not damage, it is being unable to leave. Reps are slow
  // and wide with a stun on contact; two of them is an inconvenience, six of
  // them is a meeting you do not get to walk out of.
  hrrep: {
    name: 'Talent Partner', hp: 125, dmg: 11, speed: 2.4, radius: 0.8, centerY: 1.0,
    xp: 7, money: 12, credit: 13, ai: 'stunner', attackRange: 2.2, attackCd: 1.8,
    windup: 0.5, stun: 0.85, crowd: 0.17, biome: 'hr',
  },
  intake: {
    name: 'Intake Coordinator', hp: 78, dmg: 9, speed: 3.2, radius: 0.55, centerY: 1.0,
    xp: 6, money: 10, credit: 12, ai: 'ranged', rangeMin: 7, rangeMax: 17, volley: 2,
    volleyCd: 2.9, projSpeed: 16, projKind: 'form', slowOnHit: 2.4, biome: 'hr',
  },
  mediator: {
    name: 'The Mediator', hp: 160, dmg: 9, speed: 3.0, radius: 0.6, centerY: 1.0,
    xp: 16, money: 26, credit: 28, ai: 'tether', special: true,
    tetherRange: 17, tetherPull: 5.4, tetherTime: 3.4, biome: 'hr',
  },

  // ---------- I.T. ----------
  itguy: {
    name: 'Field Technician', hp: 64, dmg: 9, speed: 4.4, radius: 0.5, centerY: 1.0,
    xp: 6, money: 11, credit: 12, ai: 'tesla', arcRange: 10, attackCd: 2.4,
    windup: 0.5, shock: 1.5, biome: 'it',
  },
  pylon: {
    name: 'Server Rack', hp: 250, dmg: 8, speed: 1.7, radius: 0.9, centerY: 1.1,
    xp: 14, money: 22, credit: 26, ai: 'aura', auraRadius: 4.4, auraCd: 0.6, big: true, biome: 'it',
  },
  sysadmin: {
    name: 'The Sysadmin', hp: 170, dmg: 10, speed: 3.6, radius: 0.55, centerY: 1.0,
    xp: 18, money: 28, credit: 32, ai: 'emp', special: true, empRange: 20, biome: 'it',
  },

  // ---------- MARKETING ----------
  // Paper-thin, deafening, and endless. They die to a stiff breeze and arrive
  // forty at a time.
  influencer: {
    name: 'Brand Intern', hp: 13, dmg: 6, speed: 9.4, radius: 0.36, centerY: 0.82,
    xp: 2, money: 4, credit: 4, ai: 'screamer', attackRange: 1.5, attackCd: 0.85,
    windup: 0.2, screamCd: 6, throwCd: 5, biome: 'marketing',
  },
  growth: {
    name: 'Growth Hacker', hp: 50, dmg: 10, speed: 6.0, radius: 0.46, centerY: 1.0,
    xp: 5, money: 9, credit: 10, ai: 'ranged', rangeMin: 6, rangeMax: 15, volley: 3,
    volleyCd: 2.2, projSpeed: 21, projKind: 'brand', biome: 'marketing',
  },
  streamer: {
    name: 'The Live-Streamer', hp: 145, dmg: 0, speed: 4.4, radius: 0.55, centerY: 1.0,
    xp: 18, money: 30, credit: 30, ai: 'stream', special: true, biome: 'marketing',
  },

  // ---------- SALES ----------
  closer: {
    name: 'Junior Closer', hp: 95, dmg: 19, speed: 5.0, radius: 0.5, centerY: 1.0,
    xp: 8, money: 14, credit: 16, ai: 'charger', chargeRange: 15, attackCd: 4.2, biome: 'sales',
  },
};

export const ELITE_MODS = {
  overtime: { name: 'OVERTIME', tint: 0xff5a2d, hpMult: 1.7, dmgMult: 1.3, speedMult: 1.45, costMult: 4 },
  synergy: { name: 'SYNERGIZED', tint: 0x38e1ff, hpMult: 2.6, dmgMult: 1.1, speedMult: 1.0, costMult: 4.5, deathNova: true },
};

const DRAB = [0x8a8f98, 0x7d8595, 0x93887c, 0x7c8a80, 0x9089a0];
const rngPick = (arr) => arr[(Math.random() * arr.length) | 0];

function buildMesh(key, elite) {
  const g = new THREE.Group();
  const parts = {};
  const tint = elite ? ELITE_MODS[elite].tint : null;

  switch (key) {
    case 'paperling': {
      const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 0), mat(0xeeeeee, { rough: 0.95 }));
      body.position.y = 0.42;
      body.castShadow = true;
      for (const side of [-1, 1]) {
        const eye = box(0.09, 0.09, 0.02, 0xc03030, { emissive: 0x881111, emissiveIntensity: 1.5 });
        eye.position.set(side * 0.13, 0.5, 0.34);
        g.add(eye);
      }
      const legL = box(0.08, 0.24, 0.08, 0xd8d8d8); legL.position.set(-0.14, 0.12, 0);
      const legR = legL.clone(); legR.position.x = 0.14;
      g.add(body, legL, legR);
      parts.body = body; parts.legL = legL; parts.legR = legR;
      break;
    }
    case 'drone': {
      const p = makePerson({
        skin: 0xb9b3ab, shirt: DRAB[(Math.random() * DRAB.length) | 0], pants: 0x3c414c,
        tie: chance(0.7) ? 0x5d2f35 : null, zombie: true, hair: 0x2c2c2c,
      });
      g.add(p.root);
      Object.assign(parts, p.parts);
      parts.person = p;
      break;
    }
    case 'printer': {
      const body = box(0.95, 0.7, 0.7, 0xb9bfc7); body.position.y = 0.55;
      const tray = box(0.6, 0.05, 0.4, 0xd9dde3); tray.position.set(0, 0.95, 0.2);
      const lamp = box(0.1, 0.1, 0.1, 0x58e07c, { emissive: 0x2ea656, emissiveIntensity: 2 }); lamp.position.set(0.3, 0.95, -0.2);
      const slot = box(0.6, 0.08, 0.05, 0x1a1e26); slot.position.set(0, 0.62, 0.36);
      for (const [sx, sz] of [[-0.35, -0.25], [0.35, -0.25], [-0.35, 0.25], [0.35, 0.25]]) {
        const wheel = cyl(0.09, 0.09, 0.07, 0x2a2e36, 8);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(sx, 0.09, sz);
        g.add(wheel);
      }
      g.add(body, tray, lamp, slot);
      parts.lamp = lamp;
      break;
    }
    case 'roomba': {
      const disc = cyl(0.42, 0.45, 0.16, 0x2a2e36, 12); disc.position.y = 0.12;
      const top = cyl(0.2, 0.22, 0.08, 0x3c414c, 10); top.position.y = 0.24;
      const lamp = box(0.1, 0.06, 0.1, 0xff3b30, { emissive: 0xff3b30, emissiveIntensity: 2.4 }); lamp.position.y = 0.3;
      g.add(disc, top, lamp);
      parts.lamp = lamp;
      break;
    }
    case 'quad': {
      const body = box(0.5, 0.2, 0.5, 0x8a5a2e); body.position.y = 0;
      const label = box(0.3, 0.12, 0.02, 0xd9dde3); label.position.set(0, 0, 0.26);
      g.add(body, label);
      parts.rotors = [];
      for (const [sx, sz] of [[-0.32, -0.32], [0.32, -0.32], [-0.32, 0.32], [0.32, 0.32]]) {
        const arm = box(0.08, 0.04, 0.08, 0x2a2e36); arm.position.set(sx, 0.12, sz);
        const rotor = box(0.4, 0.02, 0.06, 0x9aa3b0); rotor.position.set(sx, 0.17, sz);
        g.add(arm, rotor);
        parts.rotors.push(rotor);
      }
      break;
    }
    case 'copier': {
      const bodyGroup = new THREE.Group();
      const body = box(1.3, 1.5, 0.9, 0xb9bfc7); body.position.y = 1.15;
      const lid = box(1.2, 0.12, 0.8, 0x8f959d); lid.position.y = 1.95;
      const face = box(0.7, 0.25, 0.06, 0x14e07c, { emissive: 0x0a8a4a, emissiveIntensity: 1.5 }); face.position.set(0, 1.5, 0.47);
      const legL2 = box(0.35, 0.5, 0.4, 0x6b727c); legL2.position.set(-0.35, 0.25, 0);
      const legR2 = legL2.clone(); legR2.position.x = 0.35;
      const armL2 = box(0.28, 1.1, 0.32, 0x9aa3b0); armL2.position.set(-0.9, 1.2, 0);
      const armR2 = armL2.clone(); armR2.position.x = 0.9;
      bodyGroup.add(body, lid, face, legL2, legR2, armL2, armR2);
      g.add(bodyGroup);
      parts.armL = armL2; parts.armR = armR2; parts.bodyG = bodyGroup;
      break;
    }
    case 'gossip': {
      const p = makePerson({ skin: 0xa8c69b, shirt: 0x86a86b, pants: 0x4c5a42, hair: 0x4a3b22 });
      p.root.scale.set(1.5, 1.05, 1.5);
      g.add(p.root);
      Object.assign(parts, p.parts);
      parts.person = p;
      const phone = makeHeldItem('phone');
      p.parts.grip.add(phone);
      p.parts.armR.rotation.x = -1.9; // phone to ear
      break;
    }
    case 'complainer': {
      const p = makePerson({ skin: 0xc9a06b, shirt: 0x6b4a33, pants: 0x3a2f26, hair: 0x2c1d10 });
      g.add(p.root);
      Object.assign(parts, p.parts);
      parts.person = p;
      const mug = cyl(0.12, 0.1, 0.18, 0xc03030, 8);
      p.parts.grip.add(mug);
      break;
    }
    case 'micromanager': {
      const p = makePerson({ skin: 0xd8a690, shirt: 0xd9dde3, pants: 0x33383f, tie: 0xc03030, accessories: ['glasses'], hair: 0x22160c });
      p.root.scale.setScalar(0.82);
      g.add(p.root);
      Object.assign(parts, p.parts);
      parts.person = p;
      p.parts.torso.rotation.x = 0.5; // predatory crouch
      p.parts.armL.rotation.x = -1.6;
      p.parts.armR.rotation.x = -1.6;
      break;
    }
    case 'motivator': {
      const p = makePerson({ skin: 0xdba577, shirt: 0xff9b2d, pants: 0x33383f, tie: 0xc03030, accessories: ['sunglasses'], hair: 0x1d1207 });
      g.add(p.root);
      Object.assign(parts, p.parts);
      parts.person = p;
      const mega = makeHeldItem('megaphone');
      p.parts.grip.add(mega);
      p.parts.armR.rotation.x = -1.7; // megaphone raised
      const auraRing = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.9, 20),
        new THREE.MeshBasicMaterial({ color: 0xff9b2d, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
      auraRing.rotation.x = -Math.PI / 2;
      auraRing.position.y = 0.06;
      g.add(auraRing);
      parts.auraRing = auraRing;
      break;
    }
    case 'karen': {
      const p = makePerson({ skin: 0xecc3a2, shirt: 0xd8b8c8, pants: 0x6b4a5c, accessories: ['bun'], hair: 0xd8b26a });
      g.add(p.root);
      Object.assign(parts, p.parts);
      parts.person = p;
      p.parts.armL.rotation.x = -1.1; p.parts.armL.rotation.z = 0.9;   // crossed arms
      p.parts.armR.rotation.x = -1.1; p.parts.armR.rotation.z = -0.9;
      break;
    }
    case 'auditor': {
      const p = makePerson({ skin: 0x9a9a9a, shirt: 0x33383f, pants: 0x22262c, tie: 0x8a0f1c, accessories: ['sunglasses'], hair: 0x111111 });
      p.root.scale.setScalar(2.4);
      g.add(p.root);
      Object.assign(parts, p.parts);
      parts.person = p;
      const case1 = makeHeldItem('ledger');
      p.parts.grip.add(case1);
      break;
    }

    // ================= HUMAN RESOURCES =================
    case 'hrrep': {
      const p = makePerson({
        skin: chance(0.5) ? 0xe4bb9c : 0xc08a63, shirt: chance(0.5) ? 0xb7a2c9 : 0x9fb8c9,
        pants: 0x4a4457, hair: chance(0.5) ? 0x6b4a2c : 0x8a8f98,
        accessories: [chance(0.5) ? 'bun' : 'ponytail', 'glasses', 'lanyard'],
      });
      // the cardigan: a soft shell over the shirt that reads at a glance
      const cardigan = box(0.78, 0.68, 0.5, 0x6f6480, { rough: 0.98 });
      cardigan.position.y = 0.34;
      p.parts.torso.add(cardigan);
      g.add(p.root);
      Object.assign(parts, p.parts);
      parts.person = p;
      p.parts.grip.add(makeHeldItem('clipboard'));
      p.parts.armR.rotation.x = -0.9;
      p.parts.armL.rotation.x = -0.7;
      break;
    }
    case 'intake': {
      const p = makePerson({
        skin: 0xd8a690, shirt: 0xcfd6e0, pants: 0x424a58, hair: 0x30231a,
        accessories: ['headset', 'mask', 'lanyard'],
      });
      g.add(p.root);
      Object.assign(parts, p.parts);
      parts.person = p;
      p.parts.grip.add(makeHeldItem('folder'));
      break;
    }
    case 'mediator': {
      const p = makePerson({
        skin: 0xecc3a2, shirt: 0x3f4a63, pants: 0x272d3a, tie: 0x7a8ba8,
        hair: 0x2c2c2c, accessories: ['glasses', 'lanyard'],
      });
      p.root.scale.set(1.05, 1.12, 1.05);
      g.add(p.root);
      Object.assign(parts, p.parts);
      parts.person = p;
      p.parts.grip.add(makeHeldItem('clipboard'));
      // the coil of "process" it lassos you with
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 5, 12),
        mat(0xff9ec4, { emissive: 0xdb5f92, emissiveIntensity: 1.4 }));
      coil.rotation.y = Math.PI / 2;
      p.parts.gripL.add(coil);
      parts.coil = coil;
      p.parts.armL.rotation.x = -1.1;
      break;
    }

    // ================= I.T. =================
    case 'itguy': {
      const p = makePerson({
        skin: 0xd0a583, shirt: 0x2b3240, pants: 0x1d2129, hair: 0x2a1c10,
        accessories: ['headset', 'glasses'], sleeve: 0x353d4d,
      });
      // hi-vis tool vest so a tesla tech reads instantly in a dark server room
      const vest = box(0.72, 0.5, 0.46, 0x2f8fbf, { emissive: 0x1a5e80, emissiveIntensity: 0.7 });
      vest.position.y = 0.36;
      p.parts.torso.add(vest);
      const belt = box(0.7, 0.1, 0.44, 0x14171d); belt.position.y = 0.06;
      p.parts.torso.add(belt);
      g.add(p.root);
      Object.assign(parts, p.parts);
      parts.person = p;
      const wand = makeHeldItem('teslawand');
      p.parts.grip.add(wand);
      parts.wandTip = wand.userData.tip;
      p.parts.armR.rotation.x = -1.1;
      break;
    }
    case 'pylon': {
      // a 42U rack that got up and walked
      const rack = new THREE.Group();
      const shell = box(1.0, 1.9, 0.85, 0x23272e, { rough: 0.7 });
      shell.position.y = 1.15;
      const mesh2 = box(0.86, 1.6, 0.02, 0x11141a); mesh2.position.set(0, 1.18, 0.44);
      rack.add(shell, mesh2);
      const leds = [];
      for (let row = 0; row < 7; row++) {
        const blade = box(0.8, 0.16, 0.06, 0x2f3540); blade.position.set(0, 0.45 + row * 0.23, 0.44);
        rack.add(blade);
        for (let i = 0; i < 3; i++) {
          const led = box(0.05, 0.05, 0.03, 0x58e07c, { emissive: 0x2ea656, emissiveIntensity: 2.2 });
          led.position.set(-0.28 + i * 0.13, 0.45 + row * 0.23, 0.48);
          rack.add(led);
          leds.push(led);
        }
      }
      // cable bundle trailing out of the back
      const cable = cyl(0.06, 0.06, 0.9, 0x14171d, 6);
      cable.rotation.x = 0.7; cable.position.set(0.3, 0.5, -0.55);
      rack.add(cable);
      const legL3 = box(0.26, 0.42, 0.3, 0x39404a); legL3.position.set(-0.3, 0.21, 0);
      const legR3 = legL3.clone(); legR3.position.x = 0.3;
      rack.add(legL3, legR3);
      // the live field it walks around inside
      const field = new THREE.Mesh(new THREE.RingGeometry(4.0, 4.4, 28),
        new THREE.MeshBasicMaterial({ color: 0x38e1ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
      field.rotation.x = -Math.PI / 2;
      field.position.y = 0.06;
      g.add(rack, field);
      parts.rack = rack; parts.leds = leds; parts.field = field;
      parts.legL = legL3; parts.legR = legR3;
      break;
    }
    case 'sysadmin': {
      const p = makePerson({
        skin: 0xc79a72, shirt: 0x1f242e, pants: 0x171a21, hair: 0x1a1a1a,
        accessories: ['visor', 'beanie'],
      });
      // hoodie + the backpack that has never once been unpacked
      const hood = box(0.6, 0.24, 0.5, 0x1f242e); hood.position.set(0, 0.66, -0.14);
      p.parts.torso.add(hood);
      const pack = box(0.5, 0.6, 0.22, 0x2a2e36); pack.position.set(0, 0.36, -0.3);
      p.parts.torso.add(pack);
      g.add(p.root);
      Object.assign(parts, p.parts);
      parts.person = p;
      const laptop = new THREE.Group();
      const deck = box(0.36, 0.02, 0.26, 0x3a4150); deck.position.y = -0.01;
      const lid = box(0.36, 0.26, 0.02, 0x3a4150); lid.position.set(0, 0.13, -0.13); lid.rotation.x = -0.35;
      const scr2 = box(0.32, 0.22, 0.01, 0x58e07c, { emissive: 0x2ea656, emissiveIntensity: 1.8 });
      scr2.position.set(0, 0.13, -0.115); scr2.rotation.x = -0.35;
      laptop.add(deck, lid, scr2);
      p.parts.gripL.add(laptop);
      p.parts.armL.rotation.x = -1.4;
      break;
    }

    // ================= MARKETING =================
    case 'influencer': {
      const p = makePerson({
        build: 'petite',
        skin: chance(0.5) ? 0xf2cba8 : 0xa06a45,
        shirt: rngPick([0x35e0c8, 0xff4fa3, 0xfff35c, 0x9b5cff]),
        pants: rngPick([0x22262c, 0xe8e8ee, 0x3b2f5c]),
        hair: rngPick([0x35e0c8, 0xff4fa3, 0x9b5cff, 0x1a1a1a]),
        accessories: [chance(0.5) ? 'beanie' : 'ponytail', 'earbuds'],
      });
      g.add(p.root);
      Object.assign(parts, p.parts);
      parts.person = p;
      // one hand films, the other hand is the weapon
      const stick = makeHeldItem('selfiestick');
      stick.scale.setScalar(0.85);
      p.parts.gripL.add(stick);
      p.parts.armL.rotation.x = -2.2;
      p.parts.grip.add(makeHeldItem('phone'));
      break;
    }
    case 'growth': {
      const p = makePerson({
        skin: 0xdba577, shirt: 0x101318, pants: 0x2a2e36, hair: 0x1a1a1a,
        accessories: ['sunglasses', 'beanie', 'earbuds'],
      });
      // the obligatory unbranded-branded tee
      const print = box(0.4, 0.26, 0.02, 0xff4fa3, { emissive: 0xa32a68, emissiveIntensity: 0.7 });
      print.position.set(0, 0.4, 0.21);
      p.parts.torso.add(print);
      g.add(p.root);
      Object.assign(parts, p.parts);
      parts.person = p;
      p.parts.grip.add(makeHeldItem('phone'));
      break;
    }
    case 'streamer': {
      const p = makePerson({
        skin: 0xe8bc9d, shirt: 0x1b1420, pants: 0x2b2038, hair: 0xff4fa3,
        accessories: ['headset', 'ponytail'],
      });
      g.add(p.root);
      Object.assign(parts, p.parts);
      parts.person = p;
      const ring = makeHeldItem('ringlight');
      p.parts.gripL.add(ring);
      p.parts.armL.rotation.x = -2.3;
      p.parts.grip.add(makeHeldItem('selfiestick'));
      p.parts.armR.rotation.x = -1.6;
      // the ON AIR tally light — the tell that it is about to go live
      const tally = box(0.3, 0.12, 0.05, 0xff2d55, { emissive: 0xff2d55, emissiveIntensity: 0.4 });
      tally.position.set(0, 0.52, 0.24);
      p.parts.torso.add(tally);
      parts.tally = tally;
      break;
    }

    // ================= SALES =================
    case 'closer': {
      const p = makePerson({
        skin: 0xd8a166, shirt: 0x2c3f5a, pants: 0x1c2536, tie: 0xff9b2d,
        hair: 0x241a12, accessories: ['sunglasses', 'lanyard'],
      });
      // shoulder pads: the suit is doing a lot of the closing
      const jacket = box(0.86, 0.6, 0.5, 0x223146, { rough: 0.7 });
      jacket.position.y = 0.36;
      p.parts.torso.add(jacket);
      g.add(p.root);
      Object.assign(parts, p.parts);
      parts.person = p;
      p.parts.grip.add(makeHeldItem('cards'));
      break;
    }
  }

  if (tint) {
    // elite aura: glowing base ring + tinted emissive on all materials
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.85, 20),
      new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    g.add(ring);
    g.traverse((o) => {
      if (o.isMesh && o.material && o.material.emissive !== undefined) {
        o.material = o.material.clone();
        o.material.emissive = new THREE.Color(tint);
        o.material.emissiveIntensity = Math.max(o.material.emissiveIntensity ?? 0, 0.25);
      }
    });
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, parts };
}

export class Enemy {
  constructor(game, key, pos, { elite = null, hpMult = 1, dmgMult = 1 } = {}) {
    const def = ENEMY_DEFS[key];
    this.game = game;
    this.def = def;
    this.key = key;
    this.id = nextId();
    this.elite = elite;
    const em = elite ? ELITE_MODS[elite] : null;

    this.maxHp = def.hp * hpMult * (em?.hpMult ?? 1);
    this.hp = this.maxHp;
    this.dmg = def.dmg * dmgMult * (em?.dmgMult ?? 1);
    this.speed = def.speed * (em?.speedMult ?? 1) * rand(0.92, 1.08);
    this.radius = def.radius * (em ? 1.15 : 1);
    this.pos = pos.clone();
    this.pos.y = def.ai === 'flyer' ? def.hover : 0;
    this.kb = new THREE.Vector3();
    this.dead = false;
    this.state = def.ai === 'karen' ? 'idle' : 'seek';
    this.stateT = 0;
    this.attackCd = rand(0.3, 1.2);
    this.windupT = 0;
    this.animT = rand(0, 10);
    this.bleeds = [];
    this.auditT = 0;
    this.slowFactor = 1;
    this.target = null;
    this.provokeT = 0;      // karen
    this.orbitDir = chance(0.5) ? 1 : -1;
    this.deathT = -1;
    this.fuseT = -1;        // roomba
    this.latchedTo = null;  // micromanager
    this.detachCd = 0;
    this.throwCd = 5;       // auditor
    this.beepT = 0;
    this.tetherT = 0;       // mediator
    this.tethered = null;
    this.tetherMesh = null;
    this.liveT = 0;         // streamer "on air"
    this.chargeV = null;    // closer
    this.stunT = 0;         // staggered by a haymaker / body check
    this.chillT = 0;        // CO2 chill: slowed and un-rallyable
    this.chillVuln = 0;

    // Navmesh steering. Flyers ignore it (they go over the cubicles), and it
    // only engages when the straight line is actually blocked — an open bullpen
    // still gets cheap direct seek.
    this.nav = def.ai === 'flyer' ? null : new PathAgent(game.nav);
    this._losT = rand(0, 0.25);
    this._losBlocked = false;

    const { group, parts } = buildMesh(key, elite);
    this.mesh = group;
    this.parts = parts;
    this.mesh.position.copy(this.pos);
    game.scene.add(this.mesh);

    if (def.big || def.rare) {
      // heavier footprint for the heavies
      this.kbResist = 0.25;
    } else this.kbResist = 1;
  }

  get center() { return _v2.set(this.pos.x, this.pos.y + this.def.centerY, this.pos.z); }
  get displayName() {
    const base = this.def.name;
    return this.elite ? `${ELITE_MODS[this.elite].name} ${base}` : base;
  }

  applyKnockback(fromPos, force) {
    const d = _v1.set(this.pos.x - fromPos.x, 0, this.pos.z - fromPos.z).normalize();
    this.kb.addScaledVector(d, force * this.kbResist);
  }

  /** Stagger. Bosses and rares shrug most of it off so they never get chain-locked. */
  applyStun(dur) {
    if (this.dead) return;
    const scale = this.def.boss ? 0.25 : this.def.rare || this.def.big ? 0.5 : 1;
    this.stunT = Math.max(this.stunT, dur * scale);
  }

  // find who to chase
  pickTarget() {
    const game = this.game;
    let best = null, bd = 1e9;
    for (const t of game.livePlayers()) {
      const d = dist2D(t.pos, this.pos);
      // gossip goo makes you irresistible to the mob
      const bias = (t.gooT ?? 0) > 0 ? 0.4 : 1;
      if (d * bias < bd) { bd = d * bias; best = t; }
    }
    return best;
  }

  moveToward(tx, tz, dt, speedMult = 1) {
    const d = Math.hypot(tx - this.pos.x, tz - this.pos.z);
    if (d <= 0.05) return;
    let dx = (tx - this.pos.x) / d;
    let dz = (tz - this.pos.z) / d;

    // Only pay for pathing when it can change the answer: far enough away that a
    // detour matters, and a wall actually in the way. LOS is re-checked on a
    // stagger timer rather than every frame so a 40-mob horde does not run 40
    // ray queries per tick.
    if (this.nav && d > 2.5) {
      this._losT -= dt;
      if (this._losT <= 0) {
        this._losT = 0.2;
        this._losBlocked = this.game.level.losBlocked(this.pos.x, this.pos.z, tx, tz);
      }
      if (this._losBlocked) {
        _navTo.set(tx, 0, tz);
        const steer = this.nav.steer(this.pos, _navTo, dt, true);
        if (steer) { dx = steer.x; dz = steer.z; }
      }
    }

    const s = this.speed * speedMult * this.slowFactor * (this.rallyT > 0 ? 1.3 : 1);
    this.pos.x += dx * s * dt;
    this.pos.z += dz * s * dt;
    this.faceYaw = Math.atan2(dx, dz);
  }

  separate(dt) {
    for (const e of this.game.enemies) {
      if (e === this || e.dead) continue;
      const dx = this.pos.x - e.pos.x, dz = this.pos.z - e.pos.z;
      const rr = this.radius + e.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = ((rr - d) / d) * 0.5;
        this.pos.x += dx * push;
        this.pos.z += dz * push;
      }
    }
  }

  update(dt) {
    if (this.dead) {
      this.deathT += dt;
      return this.deathT < 0.05; // gibs carry the death — remove almost immediately
    }

    this.animT += dt;
    this.attackCd -= dt;
    this.detachCd -= dt;
    this.auditT = Math.max(0, this.auditT - dt);
    this.rallyT = Math.max(0, (this.rallyT ?? 0) - dt);

    // damage over time (shredder bleed)
    for (let i = this.bleeds.length - 1; i >= 0; i--) {
      const b = this.bleeds[i];
      b.t -= dt;
      b.acc = (b.acc || 0) + b.dps * dt;
      if (b.acc >= 1) {
        this.game.damageEnemy(this, b.acc, { silent: true, dot: true, owner: b.owner });
        b.acc = 0;
      }
      if (b.t <= 0) this.bleeds.splice(i, 1);
    }
    if (this.dead) return true;

    // knockback decay
    this.pos.addScaledVector(this.kb, dt);
    this.kb.multiplyScalar(Math.max(0, 1 - dt * 6));

    this.liveT = Math.max(0, this.liveT - dt);
    this.stunT = Math.max(0, this.stunT - dt);
    this.chillVuln = Math.max(0, this.chillVuln - dt);
    if (this.chillT > 0) {
      // game.update resets slowFactor every frame, so chill has to re-assert it
      this.chillT -= dt;
      this.slowFactor = Math.min(this.slowFactor, 0.45);
      this.rallyT = 0;
    }
    if (this.tetherT > 0) this.updateTether(dt);

    const target = this.state === 'latched' ? this.latchedTo : (this.target && !this.target.dead ? this.target : this.pickTarget());
    this.target = target;
    // staggered: still bleeds, still gets pushed, just does not act
    if (target && this.stunT <= 0) this.ai(dt, target);

    // world collision & separation (latched riders skip; flyers still respect
    // walls — rooms have real walls now, and 4.6m walls beat a 3.4m hover)
    if (this.state !== 'latched') {
      if (this.def.ai !== 'flyer') this.separate(dt);
      this.game.level.collideCircle(this.pos, this.radius, this.pos.y, 1);
    }

    // audit tint feedback
    const audited = this.auditT > 0;
    if (audited !== this._auditVis) {
      this._auditVis = audited;
      this.mesh.traverse((o) => {
        if (o.isMesh && o.material && o.material.emissive !== undefined) {
          if (audited) { o.userData._em = o.material.emissiveIntensity; o.material = o.material.clone(); o.material.emissive = new THREE.Color(0xffd23f); o.material.emissiveIntensity = 0.5; }
        }
      });
    }

    this.updateVisual(dt);
    return true;
  }

  ai(dt, target) {
    const game = this.game;
    const def = this.def;
    const d = dist2D(target.pos, this.pos);

    switch (def.ai) {
      case 'melee': {
        if (this.windupT > 0) {
          this.windupT -= dt;
          if (this.windupT <= 0) {
            if (dist2D(target.pos, this.pos) < def.attackRange + 0.6) {
              target.damage(this.dmg * (this.rallyT > 0 ? 1.2 : 1), this.pos, { from: this.key });
            }
            this.attackCd = def.attackCd;
          }
          break;
        }
        if (d > def.attackRange) this.moveToward(target.pos.x, target.pos.z, dt);
        else if (this.attackCd <= 0) {
          this.windupT = def.windup;
          this.strikeAnim = 0.5;
        }
        break;
      }
      case 'ranged': {
        if (d < def.rangeMin) this.moveToward(this.pos.x * 2 - target.pos.x, this.pos.z * 2 - target.pos.z, dt, 0.8);
        else if (d > def.rangeMax) this.moveToward(target.pos.x, target.pos.z, dt);
        else {
          // strafe slowly
          const px = -(target.pos.z - this.pos.z), pz = (target.pos.x - this.pos.x);
          const pl = Math.hypot(px, pz) || 1;
          this.moveToward(this.pos.x + (px / pl) * this.orbitDir * 2, this.pos.z + (pz / pl) * this.orbitDir * 2, dt, 0.4);
          this.faceYaw = Math.atan2(target.pos.x - this.pos.x, target.pos.z - this.pos.z);
        }
        if (this.attackCd <= 0 && d < def.rangeMax + 2 && !game.level.losBlocked(this.pos.x, this.pos.z, target.pos.x, target.pos.z)) {
          this.attackCd = def.volleyCd * rand(0.85, 1.2);
          const n = def.volley ?? 1;
          for (let i = 0; i < n; i++) {
            const delay = i * 0.14;
            game.delayed(delay, () => {
              if (this.dead) return;
              const dir = _v1.copy(target.centerPos).sub(this.center);
              const dist = dir.length();
              dir.normalize();
              game.projectiles.spawn({
                pos: this.center.clone(), vel: dir.multiplyScalar(def.projSpeed).add(_v2.set(0, dist * 0.12, 0)),
                gravity: 6, kind: def.projKind ?? 'paper', damage: this.dmg, friendly: false, ttl: 3.5, radius: 0.2,
                status: def.slowOnHit ? { slow: def.slowOnHit } : null,
              });
              game.audio.sfx('slip', { vol: 0.5 });
            });
          }
          if (this.parts.lamp) this.parts.lamp.material.emissiveIntensity = 4;
        }
        break;
      }
      case 'kamikaze': {
        if (this.fuseT >= 0) {
          this.fuseT -= dt;
          this.beepT -= dt;
          if (this.beepT <= 0) { game.audio.sfx('beep'); this.beepT = 0.14; }
          if (this.fuseT <= 0) {
            game.explode(this.center.clone(), def.aoe, this.dmg, { friendly: false, knockback: 10 });
            this.die(true);
          }
          break;
        }
        this.moveToward(target.pos.x, target.pos.z, dt);
        if (d < 1.8) { this.fuseT = def.fuse; }
        break;
      }
      case 'flyer': {
        // hover & orbit
        const hover = def.hover + Math.sin(this.animT * 2.4) * 0.35;
        this.pos.y += (hover - this.pos.y) * Math.min(1, dt * 3);
        if (d < def.rangeMin) this.moveToward(this.pos.x * 2 - target.pos.x, this.pos.z * 2 - target.pos.z, dt, 0.9);
        else if (d > def.rangeMax) this.moveToward(target.pos.x, target.pos.z, dt);
        else {
          const px = -(target.pos.z - this.pos.z), pz = (target.pos.x - this.pos.x);
          const pl = Math.hypot(px, pz) || 1;
          this.moveToward(this.pos.x + (px / pl) * this.orbitDir * 3, this.pos.z + (pz / pl) * this.orbitDir * 3, dt, 0.7);
          this.faceYaw = Math.atan2(target.pos.x - this.pos.x, target.pos.z - this.pos.z);
        }
        if (chance(dt * 0.25)) this.orbitDir *= -1;
        if (this.attackCd <= 0 && d < def.rangeMax + 2
          && !game.level.losBlocked(this.pos.x, this.pos.z, target.pos.x, target.pos.z)) {
          this.attackCd = def.volleyCd * rand(0.8, 1.3);
          const dir = _v1.copy(target.centerPos).sub(this.center).normalize();
          game.projectiles.spawn({
            pos: this.center.clone(), vel: dir.multiplyScalar(def.projSpeed),
            kind: 'brand', damage: this.dmg, friendly: false, ttl: 3, radius: 0.18,
          });
          game.audio.sfx('smg', { vol: 0.5 });
        }
        break;
      }
      case 'gossip': {
        this.moveToward(target.pos.x, target.pos.z, dt);
        if (d < def.popRange) this.pop();
        break;
      }
      case 'spitter': {
        if (d < def.rangeMin - 2) this.moveToward(this.pos.x * 2 - target.pos.x, this.pos.z * 2 - target.pos.z, dt, 0.9);
        else if (d > def.rangeMax) this.moveToward(target.pos.x, target.pos.z, dt);
        else this.faceYaw = Math.atan2(target.pos.x - this.pos.x, target.pos.z - this.pos.z);
        if (this.attackCd <= 0 && d < def.rangeMax + 2) {
          this.attackCd = def.volleyCd * rand(0.9, 1.15);
          // lob a coffee glob with a gravity arc onto the target
          const dir = _v1.copy(target.pos).sub(this.pos);
          const dist = dir.length();
          dir.normalize();
          const speed = clamp(dist * 1.1, 8, 20);
          game.projectiles.spawn({
            pos: this.center.clone(), vel: dir.multiplyScalar(speed).setY(6 + dist * 0.22),
            gravity: 14, kind: 'coffee', damage: this.dmg, friendly: false, ttl: 4, radius: 0.22,
            aoe: 1.6, puddle: { radius: 2.7, dps: 10, ttl: 6, kind: 'coffee' },
          });
          game.audio.sfx('spit');
          this.strikeAnim = 0.5;
        }
        break;
      }
      case 'jockey': {
        if (this.state === 'latched') {
          const t = this.latchedTo;
          if (!t || t.dead || t.latch !== this) { this.state = 'flee'; this.stateT = 2; this.latchedTo = null; break; }
          // ride the shoulders, tick damage
          this.pos.set(t.pos.x, t.pos.y + 1.1, t.pos.z);
          this.tickT = (this.tickT ?? 0) - dt;
          if (this.tickT <= 0) { t.damage(this.dmg, this.pos, { from: this.key }); this.tickT = 0.8; }
          break;
        }
        if (this.state === 'flee') {
          this.stateT -= dt;
          this.moveToward(this.pos.x * 2 - target.pos.x, this.pos.z * 2 - target.pos.z, dt, 1.2);
          if (this.stateT <= 0) { this.state = 'stalk'; this.detachCd = 5; }
          break;
        }
        if (this.state === 'pounce') {
          // ballistic leap
          this.vy = (this.vy ?? 7) - 22 * dt;
          this.pos.y += this.vy * dt;
          this.pos.x += this.pvx * dt;
          this.pos.z += this.pvz * dt;
          if (d < 1.3 && this.pos.y < 1.8 && !target.dead && !target.latch && this.detachCd <= 0) {
            // LATCHED!
            this.state = 'latched';
            this.latchedTo = target;
            target.latch = this;
            target.latchMash = 0;
            game.hud.setLatch(target === game.player);
            game.audio.sfx('pounce');
          }
          if (this.pos.y <= 0) { this.pos.y = 0; this.state = 'stalk'; this.attackCd = 1.2; }
          break;
        }
        // stalk: circle at range, then pounce
        this.state = 'stalk';
        const orbitR = 9;
        const px = -(target.pos.z - this.pos.z), pz = (target.pos.x - this.pos.x);
        const pl = Math.hypot(px, pz) || 1;
        if (d > orbitR + 3) this.moveToward(target.pos.x, target.pos.z, dt, 1.1);
        else if (d < orbitR - 3) this.moveToward(this.pos.x * 2 - target.pos.x, this.pos.z * 2 - target.pos.z, dt, 0.9);
        else this.moveToward(this.pos.x + (px / pl) * this.orbitDir * 3, this.pos.z + (pz / pl) * this.orbitDir * 3, dt, 0.85);
        if (this.attackCd <= 0 && this.detachCd <= 0 && d < 14 && !target.latch) {
          this.attackCd = rand(4, 7);
          if (!game.level.losBlocked(this.pos.x, this.pos.z, target.pos.x, target.pos.z)) {
            // windup scream then leap
            this.windupT = 0.45;
            game.audio.sfx('pounce', { vol: 0.7 });
            game.delayed(0.45, () => {
              if (this.dead || this.state === 'latched') return;
              this.state = 'pounce';
              const dir = _v1.copy(target.pos).sub(this.pos);
              const dist2 = dir.length();
              dir.normalize();
              const spd = clamp(dist2 * 1.35, 8, 10);
              this.pvx = dir.x * spd; this.pvz = dir.z * spd;
              this.vy = 6.5;
            });
          }
        }
        break;
      }
      case 'rally': {
        // The Motivator: hangs back and pumps up the workforce. Kill it first.
        const safe = 11;
        if (d < safe - 2) this.moveToward(this.pos.x * 2 - target.pos.x, this.pos.z * 2 - target.pos.z, dt, 1.1);
        else if (d > safe + 4) this.moveToward(target.pos.x, target.pos.z, dt, 0.9);
        else this.faceYaw = Math.atan2(target.pos.x - this.pos.x, target.pos.z - this.pos.z);
        if (this.attackCd <= 0) {
          this.attackCd = 4.2;
          let pumped = 0;
          for (const e of game.enemies) {
            if (e.dead || e === this || e.def.boss) continue;
            if (dist2D(e.pos, this.pos) < 10) { e.rallyT = 5; pumped++; }
          }
          if (pumped > 0) {
            game.effects.ring(this.pos, { color: 0xff9b2d, r1: 10, dur: 0.55, opacity: 0.6 });
            game.audio.sfx('horde', { vol: 0.35 });
            this.strikeAnim = 0.5;
          }
        }
        break;
      }
      case 'karen': {
        if (this.state === 'idle') {
          // provoked by damage (handled in damageEnemy) or loitering close
          if (d < 3.4) {
            this.provokeT += dt;
            if (this.provokeT > 2) this.provoke(target);
          } else this.provokeT = Math.max(0, this.provokeT - dt);
          break;
        }
        if (this.state === 'screaming') {
          this.stateT -= dt;
          if (this.stateT <= 0) this.state = 'hunt';
          break;
        }
        if (this.state === 'hunt') {
          const prov = this.provoker && !this.provoker.dead ? this.provoker : null;
          if (!prov) { this.calmExit(); break; }
          const pd = dist2D(prov.pos, this.pos);
          if (pd > 1.6) this.moveToward(prov.pos.x, prov.pos.z, dt);
          else if (this.attackCd <= 0) {
            this.attackCd = 0.9;
            this.strikeAnim = 0.5;
            prov.damage(this.dmg, this.pos, { from: this.key });
            game.shake(0.3);
          }
        }
        break;
      }
      case 'auditor': {
        if (this.windupT > 0) {
          this.windupT -= dt;
          break;
        }
        this.throwCd -= dt;
        if (d > 3.4) {
          this.moveToward(target.pos.x, target.pos.z, dt);
          if (this.throwCd <= 0 && d > 8 && d < 26) {
            this.throwCd = 8;
            this.strikeAnim = 0.6;
            const dir = _v1.copy(target.pos).sub(this.pos);
            const dist = dir.length();
            dir.normalize();
            game.projectiles.spawn({
              pos: this.center.clone().add(_v2.set(0, 0.8, 0)), vel: dir.multiplyScalar(clamp(dist * 0.9, 10, 20)).setY(7),
              gravity: 16, kind: 'chunk', damage: this.dmg * 0.8, friendly: false, ttl: 4, radius: 0.4,
              aoe: 3, knockback: 10, spin: 6,
            });
            game.audio.sfx('swing', { vol: 1.2 });
          }
        } else if (this.attackCd <= 0) {
          this.attackCd = 2.4;
          this.windupT = 0.7;
          const slamPos = this.pos.clone();
          game.effects.telegraph(slamPos, 4.2, 0.7);
          game.delayed(0.7, () => {
            if (this.dead) return;
            game.audio.sfx('explosion', { vol: 0.8 });
            game.shake(0.6);
            game.effects.ring(slamPos, { color: 0xffb36b, r1: 4.2, dur: 0.4 });
            game.level.kickDebris(slamPos, 5, 9);
            for (const t of game.livePlayers()) {
              if (dist2D(t.pos, slamPos) < 4.2 && t.pos.y < 1.4) {
                t.damage(this.dmg, slamPos, { from: this.key });
              }
            }
          });
        }
        break;
      }

      // ---- HR: the meeting you cannot leave ----
      // Same shape as `melee`, except the hit roots you. One of these is a
      // speed bump; the `crowd` field on the def is what turns a group of them
      // into a wall (Player.update reads it and taxes your movement).
      case 'stunner': {
        if (this.windupT > 0) {
          this.windupT -= dt;
          if (this.windupT <= 0) {
            if (dist2D(target.pos, this.pos) < def.attackRange + 0.6) {
              target.damage(this.dmg * (this.rallyT > 0 ? 1.2 : 1), this.pos, { from: this.key });
              target.applyStun?.(def.stun, this.pos);
            }
            this.attackCd = def.attackCd;
          }
          break;
        }
        if (d > def.attackRange) this.moveToward(target.pos.x, target.pos.z, dt);
        else if (this.attackCd <= 0) {
          this.windupT = def.windup;
          this.strikeAnim = 0.5;
          game.audio.sfx('ui2', { vol: 0.5 });
        }
        break;
      }

      // ---- HR: The Mediator drags you into a mandatory 1:1 ----
      case 'tether': {
        if (this.tetherT > 0) {
          // reeling: hold ground, keep the leash taut
          this.faceYaw = Math.atan2(this.tethered.pos.x - this.pos.x, this.tethered.pos.z - this.pos.z);
          break;
        }
        const safe = 9;
        if (d < safe - 3) this.moveToward(this.pos.x * 2 - target.pos.x, this.pos.z * 2 - target.pos.z, dt, 1.15);
        else if (d > safe + 4) this.moveToward(target.pos.x, target.pos.z, dt);
        else this.faceYaw = Math.atan2(target.pos.x - this.pos.x, target.pos.z - this.pos.z);
        if (this.attackCd <= 0 && d < def.tetherRange && !target.tether
          && !game.level.losBlocked(this.pos.x, this.pos.z, target.pos.x, target.pos.z)) {
          this.attackCd = rand(7, 10);
          this.strikeAnim = 0.6;
          this.startTether(target);
        }
        break;
      }

      // ---- IT: arc welder with an ethernet cable ----
      case 'tesla': {
        if (this.windupT > 0) {
          this.windupT -= dt;
          if (this.parts.wandTip) {
            this.parts.wandTip.material.emissiveIntensity = 2.6 + Math.sin(this.animT * 40) * 2.4;
          }
          if (this.windupT <= 0) this.fireArc(target);
          break;
        }
        if (d > def.arcRange - 1) this.moveToward(target.pos.x, target.pos.z, dt);
        else if (d < def.arcRange * 0.45) this.moveToward(this.pos.x * 2 - target.pos.x, this.pos.z * 2 - target.pos.z, dt, 0.9);
        else {
          const px = -(target.pos.z - this.pos.z), pz = (target.pos.x - this.pos.x);
          const pl = Math.hypot(px, pz) || 1;
          this.moveToward(this.pos.x + (px / pl) * this.orbitDir * 3, this.pos.z + (pz / pl) * this.orbitDir * 3, dt, 0.55);
          this.faceYaw = Math.atan2(target.pos.x - this.pos.x, target.pos.z - this.pos.z);
        }
        if (this.attackCd <= 0 && d < def.arcRange
          && !game.level.losBlocked(this.pos.x, this.pos.z, target.pos.x, target.pos.z)) {
          this.attackCd = def.attackCd * rand(0.85, 1.2);
          this.windupT = def.windup;
          this.strikeAnim = 0.6;
          game.audio.sfx('zap', { vol: 0.8 });
        }
        break;
      }

      // ---- IT: a rack that is live and does not care ----
      case 'aura': {
        if (d > def.auraRadius * 0.55) this.moveToward(target.pos.x, target.pos.z, dt);
        else this.faceYaw = Math.atan2(target.pos.x - this.pos.x, target.pos.z - this.pos.z);
        if (this.attackCd <= 0) {
          this.attackCd = def.auraCd;
          let zapped = false;
          for (const t of game.livePlayers()) {
            if (dist2D(t.pos, this.pos) < def.auraRadius && t.pos.y < 2.2) {
              t.damage(this.dmg, this.pos, { from: this.key });
              t.applyShock?.(0.5);
              zapped = true;
            }
          }
          if (zapped) {
            game.effects.ring(this.pos, { color: 0x38e1ff, r1: def.auraRadius, dur: 0.3, opacity: 0.5 });
            game.audio.sfx('zap', { vol: 0.5 });
          }
        }
        break;
      }

      // ---- IT: The Sysadmin pushes an update you did not ask for ----
      case 'emp': {
        const keep = 13;
        if (d < keep - 4) this.moveToward(this.pos.x * 2 - target.pos.x, this.pos.z * 2 - target.pos.z, dt, 1.15);
        else if (d > keep + 5) this.moveToward(target.pos.x, target.pos.z, dt);
        else this.faceYaw = Math.atan2(target.pos.x - this.pos.x, target.pos.z - this.pos.z);
        if (this.attackCd <= 0 && d < def.empRange) {
          this.attackCd = rand(6, 8.5);
          this.strikeAnim = 0.6;
          const spot = target.pos.clone().setY(0);
          game.effects.telegraph(spot, 5, 0.9, 0x38e1ff);
          game.audio.sfx('ui2', { vol: 1.1 });
          game.delayed(0.9, () => {
            if (this.dead) return;
            game.audio.sfx('zap', { vol: 1.4 });
            game.effects.ring(spot, { color: 0x38e1ff, r1: 5, dur: 0.5 });
            game.addHazard({
              pos: spot, radius: 5, ttl: 6, dps: this.dmg * 0.7, kind: 'emp', shock: 0.9,
            });
          });
        }
        break;
      }

      // ---- MARKETING: loud, disposable, everywhere ----
      case 'screamer': {
        if (this.windupT > 0) {
          this.windupT -= dt;
          if (this.windupT <= 0) {
            if (dist2D(target.pos, this.pos) < def.attackRange + 0.6) {
              target.damage(this.dmg * (this.rallyT > 0 ? 1.2 : 1), this.pos, { from: this.key });
            }
            this.attackCd = def.attackCd;
          }
          break;
        }
        this.screamT = (this.screamT ?? rand(1, def.screamCd)) - dt;
        this.throwT = (this.throwT ?? rand(1, def.throwCd)) - dt;
        // the scream: no damage, but it pulls the room onto you
        if (this.screamT <= 0 && d < 20) {
          this.screamT = def.screamCd * rand(0.8, 1.4);
          this.strikeAnim = 0.5;
          game.audio.sfx('karen-scream', { vol: 0.28 });
          game.effects.ring(this.pos, { color: 0xff4fa3, r1: 8, dur: 0.35, opacity: 0.45 });
          let heard = 0;
          for (const e of game.enemies) {
            if (e.dead || e === this || e.def.boss || e.def.rare) continue;
            if (dist2D(e.pos, this.pos) < 12) { e.rallyT = Math.max(e.rallyT ?? 0, 3.5); e.target = target; heard++; }
          }
          if (heard > 6) game.hud.toast('📣 they are filming this', 'warn');
        }
        // and the thrown phone, so a crowd of them still threatens at range
        if (this.throwT <= 0 && d > 5 && d < 20
          && !game.level.losBlocked(this.pos.x, this.pos.z, target.pos.x, target.pos.z)) {
          this.throwT = def.throwCd * rand(0.8, 1.5);
          this.strikeAnim = 0.5;
          const dir = _v1.copy(target.centerPos).sub(this.center);
          const dist = dir.length();
          dir.normalize();
          game.projectiles.spawn({
            pos: this.center.clone(), vel: dir.multiplyScalar(clamp(dist * 1.2, 12, 24)).setY(4 + dist * 0.16),
            gravity: 13, kind: 'brand', damage: this.dmg * 1.3, friendly: false, ttl: 3, radius: 0.2, spin: 14,
          });
          game.audio.sfx('card', { vol: 0.6 });
        }
        if (d > def.attackRange) this.moveToward(target.pos.x, target.pos.z, dt);
        else if (this.attackCd <= 0) { this.windupT = def.windup; this.strikeAnim = 0.4; }
        break;
      }

      // ---- MARKETING: The Live-Streamer monetizes your death ----
      case 'stream': {
        const keep = 12;
        if (d < keep - 4) this.moveToward(this.pos.x * 2 - target.pos.x, this.pos.z * 2 - target.pos.z, dt, 1.2);
        else if (d > keep + 5) this.moveToward(target.pos.x, target.pos.z, dt, 1.05);
        else this.faceYaw = Math.atan2(target.pos.x - this.pos.x, target.pos.z - this.pos.z);
        if (this.attackCd <= 0 && d < 22) {
          this.attackCd = rand(9, 13);
          this.liveT = 6;
          this.strikeAnim = 0.6;
          game.hud.announce('🔴 LIVE — YOU ARE THE CONTENT', 2.2, true);
          game.audio.sfx('phone', { vol: 1.2 });
          game.effects.ring(this.pos, { color: 0xff2d55, r1: 14, dur: 0.6 });
          // being on camera marks you exactly like gossip goo, and the algorithm
          // sends reinforcements
          for (const t of game.livePlayers()) {
            if (dist2D(t.pos, this.pos) < 22) {
              t.gooT = Math.max(t.gooT ?? 0, t.gooResist ? 3 : 6);
              if (t === game.player) game.hud.setGoo(true);
            }
          }
          for (const e of game.enemies) {
            if (e.dead || e === this || e.def.boss) continue;
            if (dist2D(e.pos, this.pos) < 16) e.rallyT = Math.max(e.rallyT ?? 0, 6);
          }
          game.director?.queueHorde(Math.round(4 + game.director.coeff * 2));
        }
        break;
      }

      // ---- SALES: the handshake ----
      case 'charger': {
        if (this.chargeV) {
          this.pos.x += this.chargeV.x * dt;
          this.pos.z += this.chargeV.z * dt;
          this.chargeT -= dt;
          for (const t of game.livePlayers()) {
            if (this.chargeHit.has(t.id)) continue;
            if (dist2D(t.pos, this.pos) < 1.7) {
              this.chargeHit.add(t.id);
              t.damage(this.dmg, this.pos, { from: this.key });
              t.vel?.add(_v1.set(t.pos.x - this.pos.x, 0.4, t.pos.z - this.pos.z).normalize().multiplyScalar(11));
              game.shake(0.3);
            }
          }
          if (this.chargeT <= 0 || game.level.collideCircle(this.pos, this.radius, 0, 1.8)) {
            this.chargeV = null;
            this.attackCd = def.attackCd * rand(0.85, 1.2);
          }
          break;
        }
        if (this.windupT > 0) {
          this.windupT -= dt;
          this.faceYaw = Math.atan2(target.pos.x - this.pos.x, target.pos.z - this.pos.z);
          if (this.windupT <= 0) {
            const dir = _v1.set(Math.sin(this.faceYaw), 0, Math.cos(this.faceYaw));
            this.chargeV = { x: dir.x * 21, z: dir.z * 21 };
            this.chargeT = 0.85;
            this.chargeHit = new Set();
            game.audio.sfx('dash', { vol: 0.8 });
          }
          break;
        }
        if (d > 2.4) this.moveToward(target.pos.x, target.pos.z, dt);
        if (this.attackCd <= 0 && d < def.chargeRange && d > 3
          && !game.level.losBlocked(this.pos.x, this.pos.z, target.pos.x, target.pos.z)) {
          this.windupT = 0.55;
          this.strikeAnim = 0.6;
          game.audio.sfx('phone', { vol: 0.7 });
        }
        break;
      }
    }
  }

  // ---------- The Mediator's leash ----------
  startTether(target) {
    const game = this.game;
    const def = this.def;
    this.tetherT = def.tetherTime;
    this.tethered = target;
    target.tether = this;
    game.audio.sfx('slip', { vol: 1.2 });
    game.hud.announce('📋 MANDATORY 1:1 — BREAK THE TETHER', 2, true);
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 1),
      new THREE.MeshBasicMaterial({ color: 0xff9ec4, transparent: true, opacity: 0.85 }));
    game.scene.add(line);
    this.tetherMesh = line;
  }

  updateTether(dt) {
    const t = this.tethered;
    if (!t || t.dead || t.tether !== this) return this.endTether();
    this.tetherT -= dt;
    const d = dist2D(t.pos, this.pos);
    if (this.tetherT <= 0 || d > 26) return this.endTether();
    // reel them in — dashing, or killing the Mediator, is the way out
    const dx = (this.pos.x - t.pos.x) / (d || 1), dz = (this.pos.z - t.pos.z) / (d || 1);
    if (d > 2.2) {
      t.pos.x += dx * this.def.tetherPull * dt;
      t.pos.z += dz * this.def.tetherPull * dt;
      this.game.level.collideCircle(t.pos, t.radius ?? 0.45, t.pos.y, 1.8);
    }
    t.slowT = Math.max(t.slowT ?? 0, 0.2);
    // draw the leash
    const m = this.tetherMesh;
    if (m) {
      const a = this.center.clone(), b = _v1.set(t.pos.x, t.pos.y + 1.0, t.pos.z);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.scale.z = Math.max(0.1, a.distanceTo(b));
      m.lookAt(b);
      m.material.opacity = 0.55 + Math.sin(this.animT * 18) * 0.3;
    }
    return true;
  }

  endTether() {
    if (this.tethered && this.tethered.tether === this) this.tethered.tether = null;
    this.tethered = null;
    this.tetherT = 0;
    if (this.tetherMesh) {
      this.game.scene.remove(this.tetherMesh);
      this.tetherMesh.geometry.dispose();
      this.tetherMesh.material.dispose();
      this.tetherMesh = null;
    }
    return false;
  }

  // ---------- the Field Technician's arc ----------
  fireArc(target) {
    const game = this.game;
    const def = this.def;
    if (dist2D(target.pos, this.pos) > def.arcRange + 2
      || game.level.losBlocked(this.pos.x, this.pos.z, target.pos.x, target.pos.z)) return;
    const from = this.center.clone();
    game.effects.beam(from, target.centerPos.clone(), { color: 0x38e1ff, jitter: 0.6, width: 4, ttl: 0.16 });
    target.damage(this.dmg, this.pos, { from: this.key });
    target.applyShock?.(def.shock);
    game.audio.sfx('zap', { vol: 1.3 });
    // the arc jumps to whatever else is standing in the puddle
    let src = target;
    for (let i = 0; i < 1; i++) {
      let next = null, nd = 6;
      for (const t2 of game.livePlayers()) {
        if (t2 === target || t2 === src) continue;
        const dd = dist2D(t2.pos, src.pos);
        if (dd < nd) { nd = dd; next = t2; }
      }
      if (!next) break;
      game.effects.beam(src.centerPos.clone(), next.centerPos.clone(), { color: 0x7fe7ff, jitter: 0.4 });
      next.damage(this.dmg * 0.6, this.pos, { from: this.key });
      next.applyShock?.(def.shock * 0.6);
      src = next;
    }
  }

  pop() {
    // the Gossip explodes into rumor gas: marks players, calls a horde
    if (this.dead) return;
    const game = this.game;
    game.audio.sfx('gossip-pop');
    game.effects.burst(this.center, { color: 0x86d86b, n: 26, speed: 5, ttl: 0.9, size: 0.16 });
    game.effects.ring(this.pos, { color: 0x86d86b, r1: 6.5, dur: 0.6 });
    const marked = [];
    for (const t of game.livePlayers()) {
      if (dist2D(t.pos, this.pos) < 6.5) {
        t.gooT = t.gooResist ? 4 : 8;   // noise-cancelling headphones halve the mark
        marked.push(t);
        if (t === game.player) game.hud.setGoo(true);
      }
    }
    game.director?.onGossipPop(marked.length ? marked : [this.target].filter(Boolean));
    this.die(true);
  }

  provoke(target) {
    if (this.state !== 'idle') return;
    this.state = 'screaming';
    this.stateT = 1.1;
    this.provoker = target;
    this.game.audio.sfx('karen-scream');
    this.game.hud.announce('KAREN IS SPEAKING TO THE MANAGER', 2.2, true);
    this.game.audio.setMood('boss');
    // arms uncross
    if (this.parts.armL) { this.parts.armL.rotation.z = 0; this.parts.armR.rotation.z = 0; }
  }

  calmExit() {
    // provoker died — Karen leaves satisfied
    this.game.hud.toast('Karen left. She will be contacting corporate.', 'warn');
    this.game.audio.setMood('chill');
    this.die(true, { silent: true, noDrops: true });
  }

  onDetached(hurt) {
    this.state = 'flee';
    this.stateT = 2.2;
    this.latchedTo = null;
    this.detachCd = 6;
    this.pos.y = 0;
    if (hurt) this.game.damageEnemy(this, this.maxHp * 0.15, { silent: false });
    this.kb.set(rand(-6, 6), 0, rand(-6, 6));
  }

  die(instant = false, { silent = false, noDrops = false } = {}) {
    if (this.dead) return;
    this.dead = true;
    this.deathT = 0;
    if (this.tetherT > 0) this.endTether();
    if (this.latchedTo) {
      const t = this.latchedTo;
      if (t.latch === this) { t.latch = null; this.game.hud.setLatch(false); }
    }
    if (!silent) this.game.audio.sfx('kill', { vol: this.def.big ? 1.2 : 0.7 });
    // LEGO TIME: the body detaches into tumbling pieces
    if (!silent || !noDrops) {
      const killer = this.lastHitBy;
      const dir = killer?.pos ? this.pos.clone().sub(killer.pos).setY(0).normalize() : null;
      this.game.effects.shatter(this.mesh, {
        center: this.center.clone(), dir,
        power: this.def.big ? 8 : 6, upPower: this.def.big ? 7 : 5,
        maxPieces: this.def.big ? 34 : 22,
      });
    }
    this.mesh.visible = false;
    this.game.onEnemyDied(this, noDrops);
  }

  updateVisual(dt) {
    this.mesh.position.copy(this.pos);
    if (this.faceYaw !== undefined) {
      let d = this.faceYaw - this.mesh.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.mesh.rotation.y += d * Math.min(1, dt * 10);
    }
    this.strikeAnim = Math.max(0, (this.strikeAnim ?? 0) - dt);

    const p = this.parts;
    const moving = this.state !== 'idle' && this.state !== 'latched';
    switch (this.key) {
      case 'paperling': {
        const hop = Math.abs(Math.sin(this.animT * 9));
        this.mesh.position.y = this.pos.y + hop * 0.22;
        if (p.legL) { p.legL.rotation.x = Math.sin(this.animT * 9) * 0.7; p.legR.rotation.x = -Math.sin(this.animT * 9) * 0.7; }
        break;
      }
      case 'drone': case 'gossip': case 'complainer': {
        if (p.person) {
          if (moving) animateWalk(p, this.animT, 0.8, { zombie: this.key === 'drone' });
          if (this.windupT > 0 || this.strikeAnim > 0) p.armR.rotation.x = -2.4;
          else if (this.key === 'gossip') p.armR.rotation.x = -1.9;
        }
        break;
      }
      case 'motivator': {
        if (p.person) {
          animateWalk(p, this.animT, moving ? 0.7 : 0);
          p.armR.rotation.x = this.strikeAnim > 0 ? -2.6 : -1.7;
        }
        if (p.auraRing) {
          const k = 1 + Math.sin(this.animT * 4) * 0.15;
          p.auraRing.scale.setScalar(k);
          p.auraRing.material.opacity = 0.35 + Math.sin(this.animT * 4) * 0.2;
        }
        break;
      }
      case 'micromanager': {
        if (p.person && this.state !== 'latched') animateWalk(p, this.animT * 1.4, 1);
        if (this.state === 'latched') {
          p.legL.rotation.x = -1.4; p.legR.rotation.x = -1.4;
          p.armL.rotation.x = -2.2; p.armR.rotation.x = -2.2;
        }
        break;
      }
      case 'karen': {
        if (p.person) {
          if (this.state === 'hunt') animateWalk(p, this.animT * 1.3, 1);
          else if (this.state === 'screaming') {
            p.armL.rotation.x = -2.6; p.armR.rotation.x = -2.6;
            this.mesh.position.y = this.pos.y + Math.abs(Math.sin(this.animT * 22)) * 0.08;
          } else poseIdle(p, this.animT);
        }
        break;
      }
      case 'auditor': {
        if (p.person) {
          animateWalk(p, this.animT * 0.7, moving ? 0.8 : 0);
          if (this.windupT > 0) { p.armL.rotation.x = -2.8; p.armR.rotation.x = -2.8; }
        }
        break;
      }
      case 'quad': {
        for (const r of p.rotors ?? []) r.rotation.y += dt * 40;
        break;
      }
      case 'roomba': {
        this.mesh.rotation.y += dt * 2;
        if (this.fuseT >= 0 && p.lamp) p.lamp.material.emissiveIntensity = 2.4 + Math.sin(this.animT * 40) * 2;
        break;
      }
      case 'copier': {
        if (p.bodyG) p.bodyG.rotation.z = Math.sin(this.animT * 6) * 0.06;
        if (this.windupT > 0) { p.armL.rotation.x = -1.2; p.armR.rotation.x = -1.2; }
        else { p.armL.rotation.x = 0; p.armR.rotation.x = 0; }
        break;
      }
      case 'printer': {
        if (p.lamp && p.lamp.material.emissiveIntensity > 2) p.lamp.material.emissiveIntensity -= dt * 6;
        break;
      }
      case 'hrrep': case 'intake': case 'closer': {
        if (p.person) {
          animateWalk(p, this.animT * (this.key === 'closer' ? 1.2 : 0.65), moving ? 0.75 : 0, { armSwing: 0.5 });
          if (this.windupT > 0 || this.strikeAnim > 0) { p.armR.rotation.x = -2.5; p.armL.rotation.x = -2.2; }
          else if (this.key === 'hrrep') { p.armR.rotation.x = -0.9; p.armL.rotation.x = -0.7; }
          if (this.chargeV) { p.armL.rotation.x = -2.6; p.armR.rotation.x = -2.6; }
        }
        break;
      }
      case 'mediator': {
        if (p.person) {
          animateWalk(p, this.animT * 0.8, moving ? 0.7 : 0);
          p.armL.rotation.x = this.tetherT > 0 ? -2.5 : -1.1;
        }
        if (p.coil) p.coil.rotation.x += dt * (this.tetherT > 0 ? 12 : 2);
        break;
      }
      case 'itguy': case 'sysadmin': {
        if (p.person) {
          animateWalk(p, this.animT * 1.1, moving ? 0.8 : 0, { armSwing: 0.4 });
          if (this.key === 'itguy') p.armR.rotation.x = this.windupT > 0 ? -1.7 : -1.1;
          else p.armL.rotation.x = -1.4;
        }
        break;
      }
      case 'pylon': {
        if (p.rack) p.rack.rotation.z = Math.sin(this.animT * 3.5) * 0.05;
        if (p.legL) { p.legL.rotation.x = Math.sin(this.animT * 3) * 0.4; p.legR.rotation.x = -Math.sin(this.animT * 3) * 0.4; }
        if (p.field) {
          const k = 0.95 + Math.sin(this.animT * 6) * 0.06;
          p.field.scale.setScalar(k);
          p.field.material.opacity = 0.24 + Math.sin(this.animT * 6) * 0.14;
        }
        // LEDs flicker in a rolling pattern so the rack always looks busy
        if (p.leds) {
          for (let i = 0; i < p.leds.length; i++) {
            p.leds[i].material.emissiveIntensity = 1.2 + Math.sin(this.animT * 9 + i * 0.7) * 1.2;
          }
        }
        break;
      }
      case 'influencer': case 'growth': {
        if (p.person) {
          animateWalk(p, this.animT * 1.5, moving ? 1 : 0, { armSwing: 0.35 });
          p.armL.rotation.x = -2.2;   // always filming
          if (this.windupT > 0 || this.strikeAnim > 0) p.armR.rotation.x = -2.6;
          else if (this.key === 'growth') p.armR.rotation.x = -1.5;
        }
        break;
      }
      case 'streamer': {
        if (p.person) {
          animateWalk(p, this.animT * 1.2, moving ? 0.85 : 0, { armSwing: 0.3 });
          p.armL.rotation.x = -2.3;
          p.armR.rotation.x = -1.6;
        }
        if (p.tally) {
          // solid red while live, dim idle pulse otherwise
          p.tally.material.emissiveIntensity = this.liveT > 0
            ? 2.4 + Math.sin(this.animT * 14) * 0.8
            : 0.35;
        }
        break;
      }
    }
    // windup flash: puff up slightly
    if (this.windupT > 0 && !this.def.rare) {
      this.mesh.scale.setScalar(1 + Math.sin(this.animT * 30) * 0.04);
    } else if (!this.dead) {
      this.mesh.scale.setScalar(1);
    }
  }

  disposeMesh() {
    if (this.tetherMesh) this.endTether();
    this.game.scene.remove(this.mesh);
  }
}
