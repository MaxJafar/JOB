// ============ procedural low-poly humanoids ============
// Boxy office people with pivoted limbs for cheap procedural animation.
import * as THREE from 'three';
import { mat, box, cyl } from './props.js';
import { makeModelPerson } from './models.js';

export const SKINS = [0xE8B89B, 0xC68863, 0x8A5A3B, 0xF2CBA8, 0x6E4428];

// opts: {model, skin, shirt, pants, tie, hair, scale, zombie, accessories: ['glasses','headset','cap','bun','crown','sunglasses','hardhat','visor']}
// `model` names an authored GLB under public/models/characters (see
// docs/CHARACTER_ART_SPEC.md). Until that file exists we build the procedural
// boxes below, so every call site works whether or not the art has landed.
export function makePerson(opts = {}) {
  if (opts.model) {
    const rigged = makeModelPerson(opts.model, opts);
    if (rigged) return rigged;
  }
  const {
    skin = 0xE8B89B, shirt = 0xd9dde3, pants = 0x2e3542, tie = null,
    hair = 0x3a2a1a, scale = 1, zombie = false, accessories = [], tieLength = 0.5,
  } = opts;

  const root = new THREE.Group();
  const parts = {};

  // legs (pivot at hip, y=0.86)
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.16, 0.86, 0);
    const leg = box(0.22, 0.82, 0.26, pants);
    leg.position.y = -0.41;
    const shoe = box(0.24, 0.1, 0.36, 0x1d222b);
    shoe.position.set(0, -0.81, 0.05);
    hip.add(leg, shoe);
    root.add(hip);
    parts[side < 0 ? 'legL' : 'legR'] = hip;
  }

  // torso
  const torso = new THREE.Group();
  torso.position.y = 0.86;
  const chest = box(0.66, 0.74, 0.4, shirt);
  chest.position.y = 0.37;
  torso.add(chest);
  if (tie !== null) {
    const knot = box(0.1, 0.08, 0.05, tie);
    knot.position.set(0, 0.62, 0.22);
    const tieB = box(0.12, tieLength, 0.04, tie);
    tieB.position.set(0, 0.62 - tieLength / 2 - 0.05, 0.22);
    torso.add(knot, tieB);
  }
  // collar
  const collar = box(0.5, 0.08, 0.42, 0xffffff);
  collar.position.y = 0.7;
  torso.add(collar);
  root.add(torso);
  parts.torso = torso;

  // head (pivot at neck)
  const headG = new THREE.Group();
  headG.position.y = 0.78; // relative to torso
  const head = box(0.42, 0.42, 0.42, skin);
  head.position.y = 0.24;
  headG.add(head);
  // hair cap
  if (accessories.includes('bun')) {
    const hairM = box(0.44, 0.14, 0.44, hair); hairM.position.y = 0.47; headG.add(hairM);
    const bun = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), mat(hair)); bun.position.set(0, 0.5, -0.24); headG.add(bun);
  } else if (!accessories.includes('cap') && !accessories.includes('crown') && !accessories.includes('hardhat')) {
    const hairM = box(0.44, 0.12, 0.44, hair); hairM.position.y = 0.48; headG.add(hairM);
    const hairB = box(0.44, 0.2, 0.1, hair); hairB.position.set(0, 0.38, -0.18); headG.add(hairB);
  }
  // face: eyes
  const eyeMat = zombie ? mat(0xff4444, { emissive: 0xaa0000, emissiveIntensity: 1.2 }) : mat(0x1a1d24);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.06, zombie ? 0.05 : 0.07, 0.02), eyeMat);
    eye.position.set(side * 0.1, 0.26, 0.215);
    headG.add(eye);
  }
  // accessories
  if (accessories.includes('glasses')) {
    for (const side of [-1, 1]) {
      const lens = box(0.13, 0.11, 0.02, 0x222833, { rough: 0.3 }); lens.position.set(side * 0.1, 0.26, 0.23); headG.add(lens);
    }
    const bridge = box(0.08, 0.02, 0.02, 0x222833); bridge.position.set(0, 0.28, 0.23); headG.add(bridge);
  }
  if (accessories.includes('sunglasses')) {
    const shades = box(0.36, 0.1, 0.03, 0x0c0e14, { rough: 0.15, metal: 0.4 }); shades.position.set(0, 0.27, 0.23); headG.add(shades);
  }
  if (accessories.includes('headset')) {
    const band = box(0.46, 0.04, 0.04, 0x222833); band.position.y = 0.47; headG.add(band);
    const earcup = box(0.05, 0.12, 0.1, 0x222833); earcup.position.set(-0.24, 0.26, 0); headG.add(earcup);
    const micArm = box(0.03, 0.03, 0.2, 0x222833); micArm.position.set(-0.2, 0.14, 0.12); headG.add(micArm);
  }
  if (accessories.includes('cap')) {
    const capM = box(0.46, 0.14, 0.46, 0x3f6e4a); capM.position.y = 0.47; headG.add(capM);
    const brim = box(0.4, 0.04, 0.24, 0x3f6e4a); brim.position.set(0, 0.42, 0.3); headG.add(brim);
  }
  if (accessories.includes('crown')) {
    const crown = cyl(0.26, 0.3, 0.2, 0xd4aa30, 6, { metal: 0.8, rough: 0.25, emissive: 0x6b5210, emissiveIntensity: 0.5 });
    crown.position.y = 0.52;
    headG.add(crown);
  }
  if (accessories.includes('visor')) {
    const visor = box(0.4, 0.14, 0.05, 0x38e1ff, { emissive: 0x1899b4, emissiveIntensity: 1.4, rough: 0.2 });
    visor.position.set(0, 0.27, 0.22);
    headG.add(visor);
  }
  torso.add(headG);
  parts.head = headG;

  // arms (pivot at shoulder)
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.42, 0.62, 0);
    const arm = box(0.18, 0.68, 0.22, shirt);
    arm.position.y = -0.3;
    const hand = box(0.16, 0.14, 0.18, skin);
    hand.position.y = -0.68;
    shoulder.add(arm, hand);
    torso.add(shoulder);
    parts[side < 0 ? 'armL' : 'armR'] = shoulder;
    if (side > 0) {
      const grip = new THREE.Group();
      grip.position.set(0, -0.72, 0.08);
      shoulder.add(grip);
      parts.grip = grip; // weapons attach here
    } else {
      const gripL = new THREE.Group();
      gripL.position.set(0, -0.72, 0.08);
      shoulder.add(gripL);
      parts.gripL = gripL; // shields attach here
    }
  }

  if (zombie) {
    torso.rotation.x = 0.22;
    parts.armL.rotation.x = -1.15;
    parts.armR.rotation.x = -1.25;
  }

  root.scale.setScalar(scale);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return { root, parts, scale };
}

// walk-cycle: drive limbs from time + planar speed
export function animateWalk(parts, t, speedNorm, opts = {}) {
  // Skinned rigs are owned by their AnimationMixer — just pick the state.
  if (parts.rig) { parts.rig.setLocomotion(speedNorm); return; }
  const { zombie = false, armSwing = 1 } = opts;
  const f = t * (zombie ? 7 : 10);
  const amp = Math.min(1, speedNorm) * (zombie ? 0.5 : 0.75);
  parts.legL.rotation.x = Math.sin(f) * amp;
  parts.legR.rotation.x = Math.sin(f + Math.PI) * amp;
  if (!zombie) {
    parts.armL.rotation.x = Math.sin(f + Math.PI) * amp * 0.7 * armSwing;
    parts.armR.rotation.x = Math.sin(f) * amp * 0.7 * armSwing;
  }
  parts.torso.position.y = 0.86 + Math.abs(Math.sin(f)) * 0.045 * Math.min(1, speedNorm);
}

export function poseIdle(parts, t) {
  if (parts.rig) { parts.rig.setLocomotion(0); return; }
  parts.legL.rotation.x = 0;
  parts.legR.rotation.x = 0;
  parts.torso.position.y = 0.86 + Math.sin(t * 2.2) * 0.012;
}

// ---------- held weapons / props ----------
export function makeHeldItem(kind) {
  const g = new THREE.Group();
  switch (kind) {
    case 'stapler': {
      const base = box(0.34, 0.08, 0.12, 0x333a45);
      const top = box(0.34, 0.07, 0.11, 0xc03030, { rough: 0.6 });
      top.position.set(0, 0.08, 0); top.rotation.z = 0.06;
      g.add(base, top);
      g.rotation.x = -Math.PI / 2;
      break;
    }
    case 'broom': {
      const stick = cyl(0.03, 0.03, 1.7, 0x8a5a2e, 6); stick.rotation.x = Math.PI / 2; stick.position.z = 0.5;
      const head = box(0.34, 0.1, 0.14, 0xd9a94a); head.position.z = 1.35;
      const bristles = box(0.3, 0.22, 0.1, 0xe8cf7a); bristles.position.set(0, -0.14, 1.35);
      g.add(stick, head, bristles);
      break;
    }
    case 'lid': {
      const lid = cyl(0.42, 0.46, 0.09, 0x9aa3b0, 10, { metal: 0.7, rough: 0.35 });
      lid.rotation.x = Math.PI / 2;
      const handle = box(0.1, 0.05, 0.22, 0x6b727c); handle.position.z = -0.08;
      g.add(lid, handle);
      break;
    }
    case 'calculator': {
      const body = box(0.26, 0.4, 0.06, 0x2a2e36);
      const scr = box(0.2, 0.09, 0.02, 0x9fffb3, { emissive: 0x58e07c, emissiveIntensity: 1.2 });
      scr.position.set(0, 0.12, 0.035);
      g.add(body, scr);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        const key = box(0.05, 0.05, 0.02, 0xd9dde3);
        key.position.set(-0.07 + c * 0.07, -0.02 - r * 0.07, 0.035);
        g.add(key);
      }
      g.rotation.x = -Math.PI / 2.4;
      break;
    }
    case 'folder': {
      const f1 = box(0.34, 0.46, 0.03, 0xff8fb7);
      const f2 = box(0.34, 0.46, 0.03, 0xffb7d0); f2.position.z = 0.035; f2.rotation.y = 0.12;
      const paper = box(0.3, 0.4, 0.01, 0xffffff); paper.position.z = 0.02;
      g.add(f1, paper, f2);
      break;
    }
    case 'taser': {
      const body = box(0.14, 0.12, 0.42, 0x2a2e36);
      const prongs = box(0.1, 0.04, 0.1, 0xd4aa30, { metal: 0.8, rough: 0.3 }); prongs.position.z = 0.26;
      const coil = cyl(0.05, 0.05, 0.14, 0x38e1ff, 6, { emissive: 0x1899b4, emissiveIntensity: 1.5 });
      coil.rotation.x = Math.PI / 2; coil.position.set(0, 0.09, 0.1);
      g.add(body, prongs, coil);
      break;
    }
    case 'cards': {
      for (let i = 0; i < 5; i++) {
        const card = box(0.16, 0.24, 0.008, 0xffffff);
        card.position.set(i * 0.03 - 0.06, 0, i * 0.008);
        card.rotation.z = (i - 2) * 0.16;
        g.add(card);
      }
      break;
    }
    case 'ledger': {
      const cover = box(0.5, 0.66, 0.1, 0x5a3d22);
      const pages = box(0.46, 0.6, 0.06, 0xefe6cf); pages.position.z = 0.03;
      g.add(cover, pages);
      break;
    }
    case 'megaphone': {
      const cone = cyl(0.2, 0.07, 0.4, 0xff4fa3, 8); cone.rotation.x = Math.PI / 2; cone.position.z = 0.2;
      const grip2 = box(0.06, 0.16, 0.06, 0x2a2e36); grip2.position.y = -0.12;
      g.add(cone, grip2);
      break;
    }
    case 'phone': {
      const body = box(0.1, 0.34, 0.05, 0x1a1e26);
      const scr = box(0.08, 0.28, 0.01, 0x38e1ff, { emissive: 0x1899b4, emissiveIntensity: 1.2 }); scr.position.z = 0.03;
      g.add(body, scr);
      break;
    }
    case 'gavel': {
      const handle = cyl(0.035, 0.035, 0.5, 0x8a5a2e, 6); handle.rotation.x = Math.PI / 2; handle.position.z = 0.14;
      const head = cyl(0.11, 0.11, 0.3, 0xd4aa30, 8, { metal: 0.7, rough: 0.3 }); head.rotation.z = Math.PI / 2; head.position.z = 0.42;
      g.add(handle, head);
      break;
    }
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
