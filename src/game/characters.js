// ============ procedural low-poly humanoids ============
// Boxy office people with pivoted limbs for cheap procedural animation.
import * as THREE from 'three';
import { mat, box, cyl } from './props.js';
import { makeModelPerson } from './models.js';

export const SKINS = [0xE8B89B, 0xC68863, 0x8A5A3B, 0xF2CBA8, 0x6E4428];

// Body types. Every limb dimension lives here so a build swap is one word at
// the call site and the accessory/garment code can stay build-agnostic — it
// reads the same numbers back off `parts.build`.
export const BUILDS = {
  normal: {
    hipY: 0.86, hipX: 0.16, legW: 0.22, legD: 0.26, legLen: 0.82,
    chestW: 0.66, chestH: 0.74, chestD: 0.40, shoulderX: 0.42, shoulderY: 0.62,
    armW: 0.18, armD: 0.22, armLen: 0.68, handS: 0.16, headS: 0.42, neckY: 0.78,
  },
  // "big bulky dude with a big chest" — reads as a walking vending machine.
  bulky: {
    hipY: 0.94, hipX: 0.24, legW: 0.34, legD: 0.38, legLen: 0.88, legLen2: 1,
    chestW: 1.18, chestH: 0.92, chestD: 0.70, shoulderX: 0.72, shoulderY: 0.70,
    armW: 0.34, armD: 0.38, armLen: 0.80, handS: 0.28, headS: 0.40, neckY: 0.92,
  },
  petite: {
    hipY: 0.80, hipX: 0.14, legW: 0.19, legD: 0.22, legLen: 0.76,
    chestW: 0.56, chestH: 0.68, chestD: 0.34, shoulderX: 0.36, shoulderY: 0.58,
    armW: 0.15, armD: 0.19, armLen: 0.62, handS: 0.14, headS: 0.40, neckY: 0.72,
  },
};

// opts: {model, skin, shirt, pants, tie, hair, scale, zombie, build,
//        accessories: ['glasses','headset','cap','bun','crown','sunglasses','hardhat','visor',
//                      'beanie','lanyard','ponytail','earbuds','mask','ringlight','apron']}
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
    build = 'normal', shoes = 0x1d222b, sleeve = null, collarColor = 0xffffff,
  } = opts;
  const B = BUILDS[build] ?? BUILDS.normal;
  const sleeveColor = sleeve ?? shirt;
  const hs = B.headS / 0.42;   // accessory scale factor, relative to the base head

  const root = new THREE.Group();
  const parts = {};

  // legs (pivot at hip)
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * B.hipX, B.hipY, 0);
    const leg = box(B.legW, B.legLen, B.legD, pants);
    leg.position.y = -B.legLen / 2;
    const shoe = box(B.legW + 0.02, 0.1, B.legD + 0.1, shoes);
    shoe.position.set(0, -B.legLen + 0.01, 0.05);
    hip.add(leg, shoe);
    root.add(hip);
    parts[side < 0 ? 'legL' : 'legR'] = hip;
  }

  // torso
  const torso = new THREE.Group();
  torso.position.y = B.hipY;
  const chest = box(B.chestW, B.chestH, B.chestD, shirt);
  chest.position.y = B.chestH / 2;
  torso.add(chest);
  if (tie !== null) {
    const knot = box(0.1, 0.08, 0.05, tie);
    knot.position.set(0, B.chestH - 0.12, B.chestD / 2 + 0.02);
    const tieB = box(0.12, tieLength, 0.04, tie);
    tieB.position.set(0, B.chestH - 0.12 - tieLength / 2 - 0.05, B.chestD / 2 + 0.02);
    torso.add(knot, tieB);
  }
  // collar
  const collar = box(B.chestW * 0.76, 0.08, B.chestD + 0.02, collarColor);
  collar.position.y = B.chestH - 0.04;
  torso.add(collar);
  root.add(torso);
  parts.torso = torso;

  // head (pivot at neck)
  const headG = new THREE.Group();
  headG.position.y = B.neckY; // relative to torso
  const head = box(B.headS, B.headS, B.headS, skin);
  head.position.y = B.headS * 0.57;
  headG.add(head);
  const hy = head.position.y;          // head center, for accessory placement
  const hTop = hy + B.headS / 2;
  const hFace = B.headS / 2 + 0.005;
  // hair cap
  if (accessories.includes('bun')) {
    const hairM = box(B.headS + 0.02, 0.14, B.headS + 0.02, hair); hairM.position.y = hTop + 0.02; headG.add(hairM);
    const bun = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12 * hs, 0), mat(hair)); bun.position.set(0, hTop + 0.05, -B.headS * 0.57); headG.add(bun);
  } else if (accessories.includes('ponytail')) {
    const hairM = box(B.headS + 0.02, 0.14, B.headS + 0.02, hair); hairM.position.y = hTop + 0.02; headG.add(hairM);
    const tail = box(0.14, 0.44, 0.14, hair);
    tail.position.set(0, hTop - 0.16, -B.headS * 0.62); tail.rotation.x = 0.25;
    headG.add(tail);
  } else if (!accessories.includes('cap') && !accessories.includes('crown')
    && !accessories.includes('hardhat') && !accessories.includes('beanie')) {
    const hairM = box(B.headS + 0.02, 0.12, B.headS + 0.02, hair); hairM.position.y = hTop + 0.03; headG.add(hairM);
    const hairB = box(B.headS + 0.02, 0.2, 0.1, hair); hairB.position.set(0, hTop - 0.07, -B.headS * 0.43); headG.add(hairB);
  }
  // face: eyes. `zombie` reads as BURNT OUT, not undead — heavy-lidded dark
  // eyes with under-eye bags instead of a red glow; the office is scary enough.
  const eyeMat = zombie ? mat(0x2b3038) : mat(0x1a1d24);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.06, zombie ? 0.045 : 0.07, 0.02), eyeMat);
    eye.position.set(side * 0.1, hy + 0.02, hFace);
    headG.add(eye);
  }
  if (zombie) {
    for (const side of [-1, 1]) {
      const bag = box(0.075, 0.028, 0.015, 0x9a8877);
      bag.position.set(side * 0.1, hy - 0.035, hFace);
      headG.add(bag);
    }
  }
  // accessories
  if (accessories.includes('glasses')) {
    for (const side of [-1, 1]) {
      const lens = box(0.13, 0.11, 0.02, 0x222833, { rough: 0.3 }); lens.position.set(side * 0.1, hy + 0.02, hFace + 0.015); headG.add(lens);
    }
    const bridge = box(0.08, 0.02, 0.02, 0x222833); bridge.position.set(0, hy + 0.04, hFace + 0.015); headG.add(bridge);
  }
  if (accessories.includes('sunglasses')) {
    const shades = box(0.36 * hs, 0.1, 0.03, 0x0c0e14, { rough: 0.15, metal: 0.4 }); shades.position.set(0, hy + 0.03, hFace + 0.015); headG.add(shades);
  }
  if (accessories.includes('headset')) {
    const band = box(B.headS + 0.04, 0.04, 0.04, 0x222833); band.position.y = hTop + 0.02; headG.add(band);
    const earcup = box(0.05, 0.12, 0.1, 0x222833); earcup.position.set(-B.headS * 0.58, hy + 0.02, 0); headG.add(earcup);
    const micArm = box(0.03, 0.03, 0.2, 0x222833); micArm.position.set(-B.headS * 0.48, hy - 0.1, 0.12); headG.add(micArm);
  }
  if (accessories.includes('earbuds')) {
    for (const side of [-1, 1]) {
      const bud = box(0.05, 0.07, 0.05, 0xf4f4f6); bud.position.set(side * B.headS * 0.55, hy + 0.02, 0.02); headG.add(bud);
      const stem = box(0.03, 0.13, 0.03, 0xf4f4f6); stem.position.set(side * B.headS * 0.55, hy - 0.08, 0.02); headG.add(stem);
    }
  }
  if (accessories.includes('cap')) {
    const capM = box(B.headS + 0.04, 0.14, B.headS + 0.04, 0x3f6e4a); capM.position.y = hTop + 0.02; headG.add(capM);
    const brim = box(B.headS - 0.02, 0.04, 0.24, 0x3f6e4a); brim.position.set(0, hTop - 0.03, B.headS * 0.72); headG.add(brim);
  }
  if (accessories.includes('beanie')) {
    const bm = box(B.headS + 0.05, 0.24, B.headS + 0.05, 0xe0559a); bm.position.y = hTop + 0.04; headG.add(bm);
    const cuff = box(B.headS + 0.07, 0.08, B.headS + 0.07, 0xffffff); cuff.position.y = hTop - 0.06; headG.add(cuff);
  }
  if (accessories.includes('mask')) {
    const m = box(B.headS * 0.72, 0.14, 0.05, 0xd8f0ff); m.position.set(0, hy - 0.09, hFace); headG.add(m);
  }
  if (accessories.includes('crown')) {
    const crown = cyl(0.26 * hs, 0.3 * hs, 0.2, 0xd4aa30, 6, { metal: 0.8, rough: 0.25, emissive: 0x6b5210, emissiveIntensity: 0.5 });
    crown.position.y = hTop + 0.07;
    headG.add(crown);
  }
  if (accessories.includes('hardhat')) {
    const dome = cyl(0.24 * hs, 0.3 * hs, 0.18, 0xffd23f, 8, { rough: 0.5 });
    dome.position.y = hTop + 0.05;
    const brim = cyl(0.34 * hs, 0.34 * hs, 0.03, 0xffd23f, 10, { rough: 0.5 });
    brim.position.y = hTop - 0.02;
    headG.add(dome, brim);
  }
  if (accessories.includes('visor')) {
    const visor = box(0.4 * hs, 0.14, 0.05, 0x38e1ff, { emissive: 0x1899b4, emissiveIntensity: 1.4, rough: 0.2 });
    visor.position.set(0, hy + 0.03, hFace);
    headG.add(visor);
  }
  torso.add(headG);
  parts.head = headG;

  // apron: chest bib + a skirt panel that hangs past the hip, so the silhouette
  // reads "service staff" from across a bullpen even at LOD distance
  if (accessories.includes('apron')) {
    const bib = box(B.chestW * 0.66, B.chestH * 0.5, 0.03, 0x2b3a30);
    bib.position.set(0, B.chestH * 0.42, B.chestD / 2 + 0.015);
    const skirt = box(B.chestW * 0.86, 0.34, 0.03, 0x2b3a30);
    skirt.position.set(0, -0.1, B.chestD / 2 + 0.01);
    const strapL = box(0.04, B.chestH * 0.42, 0.03, 0x2b3a30);
    strapL.position.set(-B.chestW * 0.22, B.chestH * 0.76, B.chestD / 2 + 0.01);
    const strapR = strapL.clone(); strapR.position.x = B.chestW * 0.22;
    torso.add(bib, skirt, strapL, strapR);
  }

  // lanyard hangs off the chest, not the head — but it's authored the same way
  if (accessories.includes('lanyard')) {
    const cordL = box(0.03, 0.28, 0.03, 0x2a3a5c); cordL.position.set(-0.11, B.chestH - 0.2, B.chestD / 2); cordL.rotation.z = 0.24;
    const cordR = cordL.clone(); cordR.position.x = 0.11; cordR.rotation.z = -0.24;
    const badge = box(0.17, 0.24, 0.02, 0xf2f6ff); badge.position.set(0, B.chestH - 0.44, B.chestD / 2 + 0.01);
    const stripe = box(0.17, 0.06, 0.01, 0x38e1ff, { emissive: 0x1899b4, emissiveIntensity: 0.8 }); stripe.position.set(0, B.chestH - 0.37, B.chestD / 2 + 0.02);
    torso.add(cordL, cordR, badge, stripe);
  }

  // arms (pivot at shoulder)
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * B.shoulderX, B.shoulderY, 0);
    const arm = box(B.armW, B.armLen, B.armD, sleeveColor);
    arm.position.y = -B.armLen / 2 + 0.04;
    const hand = box(B.handS, B.handS * 0.88, B.handS * 1.12, skin);
    hand.position.y = -B.armLen;
    shoulder.add(arm, hand);
    torso.add(shoulder);
    parts[side < 0 ? 'armL' : 'armR'] = shoulder;
    const g = new THREE.Group();
    g.position.set(0, -B.armLen - 0.04, 0.08);
    shoulder.add(g);
    if (side > 0) parts.grip = g;      // weapons attach here
    else parts.gripL = g;              // shields / offhand attach here
  }

  if (zombie) {
    // hunched commuter slump: arms hang at the sides (one hand free for a
    // briefcase), no more outstretched zombie reach
    torso.rotation.x = 0.22;
    parts.armL.rotation.x = -0.28;
    parts.armR.rotation.x = -0.18;
    parts.armR.rotation.z = -0.12;
  }
  if (build === 'bulky') {
    // heavies stand with their arms pushed out by their own lats
    parts.armL.rotation.z = 0.2;
    parts.armR.rotation.z = -0.2;
  }

  parts.build = B;
  parts.baseTorsoY = B.hipY;
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
  parts.torso.position.y = (parts.baseTorsoY ?? 0.86) + Math.abs(Math.sin(f)) * 0.045 * Math.min(1, speedNorm);
}

export function poseIdle(parts, t) {
  if (parts.rig) { parts.rig.setLocomotion(0); return; }
  parts.legL.rotation.x = 0;
  parts.legR.rotation.x = 0;
  parts.torso.position.y = (parts.baseTorsoY ?? 0.86) + Math.sin(t * 2.2) * 0.012;
}

// ---------- held weapons / props ----------
export function makeHeldItem(kind) {
  const g = new THREE.Group();
  switch (kind) {
    case 'stapler': {
      // A real desk stapler: cast base with a rubber foot, a chromed anvil, a
      // hinged magazine arm that sits slightly proud of the base, and the seam
      // between the two halves you can actually read at gameplay distance.
      const body = new THREE.Group();
      const base = box(0.1, 0.045, 0.42, 0x1c2028, { rough: 0.55 });
      base.position.set(0, 0.022, 0);
      const foot = box(0.115, 0.02, 0.2, 0x14171d, { rough: 0.95 });
      foot.position.set(0, 0.006, -0.09);
      // the metal anvil plate the staple legs curl against
      const anvil = box(0.075, 0.012, 0.1, 0xc8ccd4, { metal: 0.85, rough: 0.25 });
      anvil.position.set(0, 0.05, 0.12);
      // hinge block at the back
      const hinge = cyl(0.028, 0.028, 0.1, 0xb8bcc4, 8, { metal: 0.8, rough: 0.3 });
      hinge.rotation.z = Math.PI / 2;
      hinge.position.set(0, 0.062, -0.17);
      // magazine arm — the red body, tilted up off the base like a real one
      const arm = new THREE.Group();
      arm.position.set(0, 0.062, -0.17);
      const shell = box(0.098, 0.062, 0.34, 0xb3161f, { rough: 0.42 });
      shell.position.set(0, 0.03, 0.17);
      const crown = box(0.082, 0.02, 0.3, 0xd8242e, { rough: 0.35 });
      crown.position.set(0, 0.065, 0.17);
      const nose = box(0.09, 0.04, 0.05, 0x9aa0aa, { metal: 0.7, rough: 0.3 });
      nose.position.set(0, 0.022, 0.335);
      // staple strip peeking out of the magazine slot
      const strip = box(0.05, 0.016, 0.2, 0xd9dde3, { metal: 0.6, rough: 0.35 });
      strip.position.set(0, 0.012, 0.16);
      arm.add(shell, crown, nose, strip);
      arm.rotation.x = -0.11;
      body.add(base, foot, anvil, hinge, arm);
      // held nose-forward, canted the way a hand actually holds it
      body.rotation.set(0, 0, 0.12);
      body.position.set(0, 0.02, 0.06);
      g.add(body);
      g.userData.armPivot = arm;
      break;
    }
    case 'extinguisher': {
      // CO2 fire extinguisher — the Marketing Manager's crowd-clearing sidearm.
      const tank = cyl(0.115, 0.125, 0.56, 0xc0392b, 12, { rough: 0.4, metal: 0.25 });
      tank.position.set(0, 0, 0.06);
      const capTop = cyl(0.09, 0.115, 0.09, 0xc0392b, 12, { rough: 0.4 });
      capTop.position.set(0, 0.31, 0.06);
      const capBot = cyl(0.115, 0.1, 0.07, 0x8e2f22, 12, { rough: 0.6 });
      capBot.position.set(0, -0.3, 0.06);
      const label = box(0.16, 0.2, 0.005, 0xf2f6ff);
      label.position.set(0, -0.02, 0.19);
      const labelBar = box(0.16, 0.05, 0.006, 0x1c2028);
      labelBar.position.set(0, 0.06, 0.192);
      const neck = cyl(0.045, 0.05, 0.1, 0x9aa0aa, 8, { metal: 0.8, rough: 0.3 });
      neck.position.set(0, 0.39, 0.06);
      const lever = box(0.07, 0.035, 0.24, 0x1c2028, { rough: 0.5 });
      lever.position.set(0, 0.45, 0.03);
      const gauge = cyl(0.045, 0.045, 0.02, 0xd9dde3, 8, { metal: 0.6 });
      gauge.rotation.x = Math.PI / 2;
      gauge.position.set(0.08, 0.4, 0.06);
      // hose + horn
      const hose = cyl(0.022, 0.022, 0.4, 0x14171d, 6, { rough: 0.9 });
      hose.rotation.z = -0.9; hose.position.set(0.14, 0.24, 0.06);
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.24, 10, 1, true), mat(0x1c2028, { rough: 0.6 }));
      horn.rotation.x = Math.PI / 2;
      horn.position.set(0.25, 0.12, 0.16);
      g.add(tank, capTop, capBot, label, labelBar, neck, lever, gauge, hose, horn);
      g.userData.muzzle = horn;
      g.scale.setScalar(0.9);
      g.rotation.x = 0.25;
      break;
    }
    case 'glove': {
      // boxing glove — worn, not held; one per hand
      const mitt = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), mat(0xb3161f, { rough: 0.55 }));
      mitt.scale.set(1, 0.92, 1.18);
      mitt.position.z = 0.08;
      const thumb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), mat(0xb3161f, { rough: 0.55 }));
      thumb.position.set(-0.14, -0.03, 0.06);
      const cuff = cyl(0.13, 0.15, 0.16, 0xf2f6ff, 8, { rough: 0.8 });
      cuff.position.set(0, 0, -0.13);
      cuff.rotation.x = Math.PI / 2;
      const lace = box(0.02, 0.1, 0.02, 0xf2f6ff);
      lace.position.set(0, 0.14, 0.02);
      g.add(mitt, thumb, cuff, lace);
      break;
    }
    case 'ringlight': {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.045, 6, 16),
        mat(0xfff4dc, { emissive: 0xfff0c0, emissiveIntensity: 2.2 }));
      ring.position.set(0, 0.28, 0);
      const stalk = cyl(0.022, 0.028, 0.5, 0x2a2e36, 6);
      stalk.position.set(0, 0.02, 0);
      const clamp2 = box(0.1, 0.06, 0.12, 0x2a2e36);
      clamp2.position.set(0, -0.24, 0);
      g.add(ring, stalk, clamp2);
      break;
    }
    case 'selfiestick': {
      const stick = cyl(0.02, 0.024, 0.72, 0x9aa3b0, 6, { metal: 0.6, rough: 0.4 });
      stick.rotation.x = Math.PI / 2.6; stick.position.set(0, 0.14, 0.24);
      const clip = box(0.14, 0.06, 0.06, 0x2a2e36); clip.position.set(0, 0.42, 0.55);
      const phone = box(0.12, 0.24, 0.02, 0x14171d); phone.position.set(0, 0.5, 0.56);
      const scr = box(0.1, 0.2, 0.008, 0x38e1ff, { emissive: 0x1899b4, emissiveIntensity: 1.6 });
      scr.position.set(0, 0.5, 0.572);
      g.add(stick, clip, phone, scr);
      break;
    }
    case 'teslawand': {
      // IT field technician's "diagnostic probe"
      const grip3 = box(0.09, 0.22, 0.09, 0x1c2028, { rough: 0.6 });
      const barrel = cyl(0.035, 0.045, 0.42, 0x39404a, 8, { metal: 0.6, rough: 0.35 });
      barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.12, 0.22);
      const coilA = cyl(0.075, 0.075, 0.03, 0x38e1ff, 10, { emissive: 0x1899b4, emissiveIntensity: 2 });
      coilA.rotation.x = Math.PI / 2; coilA.position.set(0, 0.12, 0.3);
      const coilB = coilA.clone(); coilB.position.z = 0.38;
      const tip = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 0),
        mat(0x9fe8ff, { emissive: 0x38e1ff, emissiveIntensity: 2.6 }));
      tip.position.set(0, 0.12, 0.46);
      g.add(grip3, barrel, coilA, coilB, tip);
      g.userData.tip = tip;
      break;
    }
    case 'clipboard': {
      const board = box(0.34, 0.46, 0.02, 0x9a6b3f, { rough: 0.9 });
      const paper = box(0.3, 0.4, 0.01, 0xf6f6f2); paper.position.set(0, -0.02, 0.016);
      const clip2 = box(0.16, 0.06, 0.04, 0xb8bcc4, { metal: 0.7, rough: 0.3 }); clip2.position.set(0, 0.23, 0.02);
      for (let i = 0; i < 4; i++) {
        const line = box(0.22, 0.012, 0.004, 0x8a94a6);
        line.position.set(0, 0.1 - i * 0.08, 0.023);
        g.add(line);
      }
      g.add(board, paper, clip2);
      g.rotation.x = -0.5;
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
    case 'mug': {
      const cup = cyl(0.12, 0.1, 0.2, 0xf2f6ff, 10, { rough: 0.5 });
      const brew = cyl(0.105, 0.105, 0.01, 0x4a2c17, 10); brew.position.y = 0.08;
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 5, 10), mat(0xf2f6ff, { rough: 0.5 }));
      handle.position.set(0.13, 0, 0); handle.rotation.y = Math.PI / 2;
      g.add(cup, brew, handle);
      break;
    }
    case 'steamwand': {
      // an espresso machine's steam arm, unbolted and carried
      const pitcher = cyl(0.11, 0.13, 0.24, 0xc9d2dc, 10, { metal: 0.8, rough: 0.25 });
      const spout = cyl(0.02, 0.02, 0.44, 0xd9e2ec, 6, { metal: 0.9, rough: 0.15 });
      spout.rotation.x = Math.PI / 2; spout.position.set(0, 0.06, 0.26);
      const tip = cyl(0.035, 0.02, 0.07, 0x8f99a5, 8, { metal: 0.9, rough: 0.2 });
      tip.rotation.x = Math.PI / 2; tip.position.set(0, 0.06, 0.5);
      const valve = box(0.07, 0.07, 0.07, 0x1d222b); valve.position.set(0, 0.14, 0.06);
      g.add(pitcher, spout, tip, valve);
      break;
    }
    case 'ledgerrifle': {
      // a bound ledger with a barrel through it — the paperwork IS the weapon
      const stock = box(0.11, 0.15, 0.42, 0x5a3d22); stock.position.z = -0.1;
      const spine = box(0.13, 0.17, 0.06, 0x2f4c3a); spine.position.z = -0.3;
      const barrel = cyl(0.028, 0.028, 0.68, 0x3a4049, 8, { metal: 0.8, rough: 0.3 });
      barrel.rotation.x = Math.PI / 2; barrel.position.z = 0.4;
      const scope = cyl(0.035, 0.035, 0.2, 0x1d222b, 8); scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.13, 0.06);
      const lens = cyl(0.033, 0.033, 0.01, 0xffd23f, 8, { emissive: 0xffd23f, emissiveIntensity: 1.2 });
      lens.rotation.x = Math.PI / 2; lens.position.set(0, 0.13, 0.17);
      g.add(stock, spine, barrel, scope, lens);
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

// ---------- the Marketing Manager's ride ----------
// A real task chair with a caster base, built so the seat can be parented to a
// character root: the person sits on it, the base counter-rotates for drift.
export function makeChairMount(color = 0xff4fa3) {
  const g = new THREE.Group();
  const swivel = new THREE.Group();
  const seat = box(0.56, 0.1, 0.56, color, { rough: 0.7 });
  seat.position.y = 0.46;
  const backPost = box(0.1, 0.24, 0.1, 0x2a2e36); backPost.position.set(0, 0.58, 0.26);
  const backRest = box(0.54, 0.6, 0.1, color, { rough: 0.7 }); backRest.position.set(0, 0.96, 0.3);
  const lumbar = box(0.46, 0.12, 0.04, 0x1c2028); lumbar.position.set(0, 0.8, 0.24);
  for (const s of [-1, 1]) {
    const armRest = box(0.07, 0.06, 0.36, 0x1c2028);
    armRest.position.set(s * 0.3, 0.68, 0.06);
    const armPost = box(0.06, 0.18, 0.06, 0x1c2028);
    armPost.position.set(s * 0.3, 0.56, 0.18);
    swivel.add(armRest, armPost);
  }
  const gasLift = cyl(0.055, 0.07, 0.3, 0xb8bcc4, 8, { metal: 0.7, rough: 0.3 });
  gasLift.position.y = 0.28;
  swivel.add(seat, backPost, backRest, lumbar, gasLift);

  const spider = new THREE.Group();
  const hub = cyl(0.09, 0.11, 0.08, 0x2a2e36, 8);
  hub.position.y = 0.12;
  spider.add(hub);
  const casters = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const spoke = box(0.07, 0.05, 0.34, 0x2a2e36);
    spoke.position.set(Math.sin(a) * 0.17, 0.12, Math.cos(a) * 0.17);
    spoke.rotation.y = a;
    const wheelG = new THREE.Group();
    wheelG.position.set(Math.sin(a) * 0.34, 0.06, Math.cos(a) * 0.34);
    const wheel = cyl(0.06, 0.06, 0.045, 0x14171d, 8, { rough: 0.85 });
    wheel.rotation.z = Math.PI / 2;
    wheelG.add(wheel);
    spider.add(spoke, wheelG);
    casters.push(wheelG);
  }
  g.add(swivel, spider);
  g.userData = { swivel, spider, casters };
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
