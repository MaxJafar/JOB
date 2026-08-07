// ============ low-poly office furniture factories ============
// Every prop is built from primitives with flat shading. No external assets.
import * as THREE from 'three';
import { makeModelProp } from './models.js';

const matCache = new Map();
export function mat(color, { rough = 0.92, metal = 0.0, emissive = 0, emissiveIntensity = 1, transparent = false, opacity = 1 } = {}) {
  const key = `${color}|${rough}|${metal}|${emissive}|${emissiveIntensity}|${opacity}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, roughness: rough, metalness: metal, flatShading: true,
      emissive, emissiveIntensity, transparent: transparent || opacity < 1, opacity,
    });
    matCache.set(key, m);
  }
  return m;
}

export function box(w, h, d, color, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
export function cyl(rt, rb, h, color, seg = 8, opts = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color, opts));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function makeCanvasTexture(w, h, draw, { repeat = null } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(repeat[0], repeat[1]); }
  return tex;
}

const hex = (n) => '#' + n.toString(16).padStart(6, '0');

// ---------- big surfaces ----------
export function makeCarpet(wid, dep, palette, floorKey) {
  const tex = makeCanvasTexture(256, 256, (g) => {
    g.fillStyle = hex(palette.carpet); g.fillRect(0, 0, 256, 256);
    g.globalAlpha = 0.16;
    if (floorKey === 'finance') {
      g.strokeStyle = '#ffffff';
      for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, 256); g.stroke(); g.beginPath(); g.moveTo(0, i * 32); g.lineTo(256, i * 32); g.stroke(); }
    } else if (floorKey === 'marketing') {
      g.strokeStyle = hex(palette.accent); g.lineWidth = 5;
      for (let i = -4; i < 12; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32 + 90, 256); g.stroke(); }
    } else if (floorKey === 'sales') {
      g.fillStyle = '#ffffff';
      for (let x = 16; x < 256; x += 42) for (let y = 16; y < 256; y += 42) { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
    } else {
      g.fillStyle = '#ffffff'; g.globalAlpha = 0.05;
      for (let i = 0; i < 40; i++) { g.fillRect(Math.random() * 256, Math.random() * 256, 60, 2); }
    }
    g.globalAlpha = 0.08; g.fillStyle = '#000';
    for (let i = 0; i < 500; i++) g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }, { repeat: [wid / 8, dep / 8] });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(wid, dep), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, color: 0xffffff }));
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  return m;
}

export function makeWindowStrip(len, height, palette) {
  const tex = makeCanvasTexture(256, 128, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, hex(palette.sky));
    grad.addColorStop(1, '#1c2431');
    g.fillStyle = grad; g.fillRect(0, 0, 256, 128);
    // distant skyline
    g.fillStyle = 'rgba(10,14,22,0.85)';
    let x = 0;
    while (x < 256) { const w = 14 + Math.random() * 22, h = 20 + Math.random() * 60; g.fillRect(x, 128 - h, w, h); x += w + 6; }
    g.fillStyle = 'rgba(255,238,170,0.8)';
    for (let i = 0; i < 60; i++) g.fillRect(Math.random() * 256, 70 + Math.random() * 52, 2, 2);
    // mullions
    g.fillStyle = 'rgba(20,24,30,0.9)';
    for (let i = 0; i <= 8; i++) g.fillRect(i * 32 - 2, 0, 4, 128);
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(len, height),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.55, color: 0x888888 }));
  return m;
}

export function makePoster(text, color, bg = '#22293a') {
  const tex = makeCanvasTexture(256, 192, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, 256, 192);
    g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 8; g.strokeRect(6, 6, 244, 180);
    g.fillStyle = color; g.font = '900 34px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const lines = text.split('\n');
    lines.forEach((ln, i) => g.fillText(ln, 128, 96 + (i - (lines.length - 1) / 2) * 40));
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.65), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
  return m;
}

// ---------- furniture ----------
export function makeDesk(palette, withMonitor = true) {
  const g = new THREE.Group();
  const top = box(1.9, 0.09, 0.95, palette.desk); top.position.y = 0.76; g.add(top);
  for (const [sx, sz] of [[-0.85, -0.4], [0.85, -0.4], [-0.85, 0.4], [0.85, 0.4]]) {
    const leg = box(0.09, 0.74, 0.09, 0x333a45); leg.position.set(sx, 0.37, sz); g.add(leg);
  }
  if (withMonitor) {
    const mon = box(0.62, 0.4, 0.05, 0x22262e); mon.position.set(0, 1.18, -0.18);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.32),
      mat(0x0e141c, { emissive: Math.random() < 0.5 ? 0x2d86ff : 0x33ff88, emissiveIntensity: 0.9, rough: 0.4 }));
    scr.position.z = 0.028; mon.add(scr);
    const stand = box(0.08, 0.18, 0.08, 0x333a45); stand.position.set(0, 0.9, -0.18);
    const kb = box(0.5, 0.03, 0.18, 0xd8dce2); kb.position.set(0, 0.82, 0.15);
    g.add(mon, stand, kb);
  }
  g.userData.footprint = { w: 1.9, d: 0.95, h: 0.82 };
  return g;
}

export function makeOfficeChair(color = 0x2b3140) {
  const g = new THREE.Group();
  const seat = box(0.5, 0.08, 0.5, color); seat.position.y = 0.5;
  const back = box(0.5, 0.55, 0.08, color); back.position.set(0, 0.83, 0.24);
  const pole = cyl(0.04, 0.04, 0.4, 0x555c66, 6); pole.position.y = 0.3;
  const base = cyl(0.3, 0.34, 0.06, 0x555c66, 5); base.position.y = 0.06;
  g.add(seat, back, pole, base);
  g.userData.debris = true;
  return g;
}

export function makeCubicleCluster(palette) {
  // 2x2 pod formed by a cross of panels; outer sides open
  const g = new THREE.Group();
  const H = 1.5, L = 4.6, T = 0.1;
  const wallA = box(L, H, T, palette.cubicle); wallA.position.y = H / 2;
  const wallB = box(T, H, L, palette.cubicle); wallB.position.y = H / 2;
  const capA = box(L, 0.06, T + 0.06, 0xd9dde3); capA.position.y = H + 0.02;
  const capB = box(T + 0.06, 0.06, L, 0xd9dde3); capB.position.y = H + 0.02;
  g.add(wallA, wallB, capA, capB);
  // little desks tucked into each quadrant
  for (const [qx, qz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const desk = box(1.5, 0.07, 0.6, palette.desk);
    desk.position.set(qx * 1.15, 0.72, qz * 0.42);
    const mon = box(0.5, 0.34, 0.05, 0x22262e);
    mon.position.set(qx * 1.15, 1.05, qz * 0.42 - 0.15 * qz);
    g.add(desk, mon);
  }
  g.userData.crossColliders = { L, T, H };
  return g;
}

export function makeFilingCabinet() {
  const g = new THREE.Group();
  const body = box(0.62, 1.32, 0.55, 0x7a828e); body.position.y = 0.66; g.add(body);
  for (let i = 0; i < 4; i++) {
    const h = box(0.4, 0.05, 0.03, 0x39404a); h.position.set(0, 0.28 + i * 0.31, 0.29); g.add(h);
  }
  g.userData.footprint = { w: 0.62, d: 0.55, h: 1.35 };
  return g;
}

export function makePlant() {
  const g = new THREE.Group();
  const pot = cyl(0.22, 0.28, 0.34, 0xa5552e, 7); pot.position.y = 0.17;
  const stem = cyl(0.04, 0.05, 0.5, 0x4a6b2d, 5); stem.position.y = 0.55;
  g.add(pot, stem);
  for (let i = 0; i < 3; i++) {
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28 - i * 0.05, 0), mat(0x3e8f4a, { rough: 0.95 }));
    leaf.position.y = 0.75 + i * 0.28;
    leaf.castShadow = true;
    g.add(leaf);
  }
  g.userData.debris = true;
  return g;
}

export function makeWaterCooler() {
  const g = new THREE.Group();
  const base = box(0.45, 1.0, 0.45, 0xd9dde3); base.position.y = 0.5;
  const bottle = cyl(0.2, 0.2, 0.5, 0x7fd4ff, 8, { rough: 0.3, opacity: 0.75 }); bottle.position.y = 1.28;
  const spout = box(0.1, 0.08, 0.1, 0x39404a); spout.position.set(0, 0.85, 0.26);
  g.add(base, bottle, spout);
  g.userData.footprint = { w: 0.5, d: 0.5, h: 1.4 };
  return g;
}

export function makeVendingMachine(palette) {
  const g = new THREE.Group();
  const body = box(1.1, 2.05, 0.75, 0x8e2f3c); body.position.y = 1.02;
  const front = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.4),
    mat(0x0c1018, { emissive: 0x77c4ff, emissiveIntensity: 0.5, rough: 0.35 }));
  front.position.set(-0.12, 1.2, 0.38);
  const slot = box(0.55, 0.18, 0.03, 0x1a1e26); slot.position.set(-0.12, 0.35, 0.38);
  g.add(body, front, slot);
  g.userData.footprint = { w: 1.1, d: 0.75, h: 2.1 };
  return g;
}

export function makeCoffeeMachine() {
  const g = new THREE.Group();
  const counter = box(1.0, 0.86, 0.6, 0x6b4a33); counter.position.y = 0.43;
  const machine = box(0.42, 0.5, 0.38, 0x2a2e36); machine.position.set(-0.18, 1.11, 0);
  const lamp = box(0.07, 0.07, 0.07, 0xff3b30, { emissive: 0xff3b30, emissiveIntensity: 2 }); lamp.position.set(-0.18, 1.4, 0.16);
  const pot = cyl(0.11, 0.13, 0.2, 0x8a5a2e, 7, { rough: 0.4, opacity: 0.85 }); pot.position.set(0.25, 0.98, 0.05);
  g.add(counter, machine, lamp, pot);
  g.userData.footprint = { w: 1.0, d: 0.6, h: 1.4 };
  g.userData.lamp = lamp;
  return g;
}

export function makeCopierProp() {
  const g = new THREE.Group();
  const body = box(1.0, 1.0, 0.65, 0xb9bfc7); body.position.y = 0.5;
  const lid = box(0.9, 0.07, 0.55, 0x8f959d); lid.position.y = 1.04;
  const tray = box(0.5, 0.04, 0.35, 0xd9dde3); tray.position.set(0.6, 0.72, 0);
  g.add(body, lid, tray);
  g.userData.footprint = { w: 1.15, d: 0.7, h: 1.1 };
  return g;
}

export function makePillar(h, color) {
  const g = new THREE.Group();
  const p = box(0.9, h, 0.9, color); p.position.y = h / 2;
  const base = box(1.1, 0.25, 1.1, 0x272c35); base.position.y = 0.125;
  g.add(p, base);
  g.userData.footprint = { w: 0.95, d: 0.95, h };
  return g;
}

export function makeAlarmBox() {
  const g = new THREE.Group();
  const body = box(0.26, 0.34, 0.14, 0xc03030, { emissive: 0x550000, emissiveIntensity: 0.6 });
  const handle = box(0.08, 0.16, 0.05, 0xffffff); handle.position.z = 0.08;
  g.add(body, handle);
  return g;
}

export function makeCeilingLight() {
  const g = new THREE.Group();
  const wire = cyl(0.015, 0.015, 1.6, 0x222222, 4); wire.position.y = 0.8;
  const shade = cyl(0.34, 0.5, 0.28, 0x2f3540, 8); shade.position.y = -0.05;
  const bulb = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 0.1, 8), mat(0xfff2cf, { emissive: 0xffe9b0, emissiveIntensity: 1.6 }));
  bulb.position.y = -0.16;
  g.add(wire, shade, bulb);
  return g;
}

export function makeSodaCan() {
  const g = new THREE.Group();
  const can = cyl(0.09, 0.09, 0.26, 0x35c6ff, 8, { rough: 0.3, metal: 0.6 });
  const top = cyl(0.07, 0.09, 0.02, 0xd9dde3, 8); top.position.y = 0.14;
  g.add(can, top);
  return g;
}

// ---------- interactables ----------
export function makeChest(gold = false) {
  const g = new THREE.Group();
  const base = box(0.95, 0.5, 0.62, gold ? 0xa8842a : 0x5d6675); base.position.y = 0.25;
  const lidG = new THREE.Group(); lidG.position.set(0, 0.5, -0.31);
  const lid = box(0.95, 0.16, 0.62, gold ? 0xd4aa30 : 0x767f8f); lid.position.set(0, 0.08, 0.31);
  lidG.add(lid);
  const clasp = box(0.14, 0.14, 0.06, gold ? 0xffe08a : 0xd9b64a, { emissive: gold ? 0xffd23f : 0x8a742a, emissiveIntensity: 0.8 });
  clasp.position.set(0, 0.42, 0.33);
  const label = makePoster(gold ? 'EXEC\nSTASH' : 'SUPPLY', gold ? '#ffd23f' : '#9fd8ff', '#1a1f29');
  label.scale.setScalar(0.22); label.position.set(0, 0.28, 0.315);
  g.add(base, lidG, clasp, label);
  g.userData.lid = lidG;
  g.userData.footprint = { w: 0.95, d: 0.62, h: 0.6 };
  return g;
}

// `modelSlug` swaps the plain trim surround for a Meshy facade. Doors, cab,
// sign and call button stay procedural — the elevator event animates them.
export function makeElevator(palette, modelSlug = null) {
  const g = new THREE.Group();
  const W = 3.6, H = 3.2, D = 1.6;
  const facade = modelSlug ? makeModelProp(modelSlug) : null;
  const frame = facade || box(W + 0.8, H + 0.5, 0.35, palette.trim);
  if (facade) {
    // Fit the generated facade to the shaft opening, then sit it behind the doors.
    const bb = new THREE.Box3().setFromObject(facade);
    const fit = (H + 0.5) / Math.max(1e-3, bb.max.y - bb.min.y);
    facade.scale.multiplyScalar(fit);
    facade.position.set(0, -bb.min.y * fit, -D - 0.15);
    facade.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  } else {
    frame.position.set(0, (H + 0.5) / 2, -D - 0.15);
  }
  const cab = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mat(0x161a22, { rough: 0.9 }));
  cab.position.set(0, H / 2, -D / 2 - 0.3);
  const cabLight = box(W - 0.6, 0.06, D - 0.5, 0xfff2cf, { emissive: 0xffe9b0, emissiveIntensity: 1.4 });
  cabLight.position.set(0, H - 0.1, -D / 2 - 0.3);
  const doorL = box(W / 2 - 0.05, H - 0.1, 0.12, 0x9aa3b0, { metal: 0.55, rough: 0.35 });
  doorL.position.set(-W / 4, (H - 0.1) / 2, -0.26);
  const doorR = doorL.clone(); doorR.position.x = W / 4;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.5), (() => {
    const tex = makeCanvasTexture(192, 64, (gc) => {
      gc.fillStyle = '#101318'; gc.fillRect(0, 0, 192, 64);
      gc.fillStyle = '#58e07c'; gc.font = '900 38px Arial'; gc.textAlign = 'center'; gc.textBaseline = 'middle';
      gc.fillText('▲ UP', 96, 34);
    });
    return new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.9, color: 0x666666 });
  })());
  sign.position.set(0, H + 0.55, -0.2);
  const button = box(0.16, 0.24, 0.08, 0xd9dde3, { emissive: 0x58e07c, emissiveIntensity: 0.4 });
  button.position.set(W / 2 + 0.55, 1.25, -0.25);
  g.add(frame, cab, cabLight, doorL, doorR, sign, button);
  g.userData = { doorL, doorR, sign, W, H, D };
  return g;
}

export function makeCEODesk(palette) {
  const g = new THREE.Group();
  const top = box(4.4, 0.14, 1.7, 0x2c1f12, { rough: 0.5 }); top.position.y = 0.95;
  const front = box(4.4, 0.9, 0.16, 0x241a10); front.position.set(0, 0.46, 0.75);
  const sideL = box(0.16, 0.9, 1.6, 0x241a10); sideL.position.set(-2.1, 0.46, 0);
  const sideR = sideL.clone(); sideR.position.x = 2.1;
  const trim = box(4.5, 0.06, 1.8, 0xd4aa30, { metal: 0.7, rough: 0.3 }); trim.position.y = 1.03;
  const plaque = makePoster('C.E.O.', '#ffd23f', '#141017'); plaque.scale.setScalar(0.35); plaque.position.set(0, 0.66, 0.84);
  g.add(top, front, sideL, sideR, trim, plaque);
  g.userData.footprint = { w: 4.5, d: 1.8, h: 1.1 };
  return g;
}

export function makeStatue() {
  const g = new THREE.Group();
  const ped = box(1.1, 1.0, 1.1, 0x3d3a45); ped.position.y = 0.5;
  const body = cyl(0.3, 0.45, 1.2, 0xd4aa30, 6, { metal: 0.85, rough: 0.25 }); body.position.y = 1.6;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), mat(0xd4aa30, { metal: 0.85, rough: 0.25 }));
  head.position.y = 2.4; head.castShadow = true;
  const armL = box(0.14, 0.7, 0.14, 0xd4aa30, { metal: 0.85, rough: 0.25 }); armL.position.set(-0.45, 1.9, 0); armL.rotation.z = 0.8;
  const armR = armL.clone(); armR.position.x = 0.45; armR.rotation.z = -0.8;
  g.add(ped, body, head, armL, armR);
  g.userData.footprint = { w: 1.2, d: 1.2, h: 2.6 };
  return g;
}
