// ============ juice: particles, damage numbers, rings, telegraphs ============
import * as THREE from 'three';
import { rand } from '../core/utils.js';

const PARTICLE_MAX = 260;
const NUMBER_MAX = 40;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    /** @type {import('../core/physics.js').PhysicsWorld|null} injected once Rapier loads */
    this.physics = null;
    this.particles = [];
    this.free = [];
    const geo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < PARTICLE_MAX; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.free.push(m);
    }
    // damage numbers: pooled sprites with individual canvas textures
    this.numbers = [];
    this.freeNumbers = [];
    for (let i = 0; i < NUMBER_MAX; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 160; canvas.height = 80;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
      sp.visible = false;
      sp.scale.set(1.6, 0.8, 1);
      scene.add(sp);
      this.freeNumbers.push({ sp, canvas, tex });
    }
    this.rings = [];
    this.telegraphs = [];
    this.beams = [];
    this.gibs = [];          // "Lego" body parts tumbling with physics
    this.slashes = [];       // melee arc trails
    this._ringGeo = new THREE.RingGeometry(0.92, 1, 40);
    this._circGeo = new THREE.CircleGeometry(1, 36);
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
  }

  // ---- Lego shatter: detach every mesh of a character/prop into physics gibs ----
  shatter(rootGroup, { center = null, dir = null, power = 6, upPower = 5, maxPieces = 26 } = {}) {
    rootGroup.updateWorldMatrix(true, true);
    const pieces = [];
    rootGroup.traverse((o) => {
      if (o.isMesh && o.visible && o.geometry) pieces.push(o);
    });
    // biggest pieces first, cap count
    pieces.length = Math.min(pieces.length, maxPieces);
    const c = center ?? new THREE.Vector3().setFromMatrixPosition(rootGroup.matrixWorld);
    for (const src of pieces) {
      // hard cap on simultaneous gibs — recycle the oldest
      if (this.gibs.length >= 120) {
        const old = this.gibs.shift();
        this.scene.remove(old.mesh);
      }
      const mesh = new THREE.Mesh(src.geometry, src.material);
      src.matrixWorld.decompose(this._v, this._q, this._s);
      mesh.position.copy(this._v);
      mesh.quaternion.copy(this._q);
      mesh.scale.copy(this._s);
      mesh.castShadow = true;
      this.scene.add(mesh);
      const away = this._v.clone().sub(c);
      away.y = 0;
      const len = Math.max(0.2, away.length());
      away.divideScalar(len);
      const vel = new THREE.Vector3(
        away.x * power * rand(0.5, 1.4) + (dir ? dir.x * power * 0.8 : 0),
        rand(0.4, 1.1) * upPower,
        away.z * power * rand(0.5, 1.4) + (dir ? dir.z * power * 0.8 : 0),
      );
      const angVel = new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9));
      const ttl = rand(1.6, 2.4);

      // With Rapier, a severed arm bounces off the desk it landed on, wedges in
      // a doorway and gets kicked by the next explosion. Without it, the legacy
      // integrator below just bounces everything off the y=0 plane and lets it
      // sink through furniture.
      if (this.physics?.ready) {
        this.physics.addGib(mesh, { vel, angVel, ttl });
        continue;
      }
      this.gibs.push({
        mesh, vel, angVel,
        ttl, life0: 2.4, bounces: 0,
        rest: 0.08,
      });
    }
  }

  // ---- melee slash trail: a fading arc fan in front of the attacker ----
  slash(pos, yaw, range, side = 1, color = 0xffffff) {
    const geo = new THREE.CircleGeometry(range, 18, 0, 2.2);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false,
    }));
    m.position.set(pos.x, pos.y + 1.15, pos.z);
    m.rotation.order = 'YXZ';
    m.rotation.y = yaw + Math.PI / 2 - 1.1;
    m.rotation.x = -Math.PI / 2 + 0.35;
    this.scene.add(m);
    this.slashes.push({ mesh: m, t: 0, dur: 0.16, side, yaw });
  }

  burst(pos, { color = 0xffffff, n = 10, speed = 6, size = 0.14, gravity = 14, ttl = 0.55, up = 3.5, spread = 1 } = {}) {
    for (let i = 0; i < n; i++) {
      const m = this.free.pop();
      if (!m) break;
      m.visible = true;
      m.material.color.setHex(color);
      m.material.opacity = 1;
      const s = size * rand(0.6, 1.5);
      m.scale.set(s, s, s);
      m.position.copy(pos);
      const a = rand(0, Math.PI * 2), r = rand(0.2, 1) * speed * spread;
      this.particles.push({
        m, ttl, life: ttl, gravity,
        vx: Math.cos(a) * r, vy: rand(0.3, 1) * up + speed * 0.3, vz: Math.sin(a) * r,
        spin: rand(-8, 8),
      });
    }
  }

  confetti(pos, n = 16) {
    const colors = [0xff4fa3, 0x38e1ff, 0xffd23f, 0x58e07c, 0xffffff];
    for (const c of colors) this.burst(pos, { color: c, n: Math.ceil(n / 5), speed: 4, up: 6, gravity: 8, ttl: 1.1, size: 0.1 });
  }

  number(pos, value, { crit = false, color = null, heal = false } = {}) {
    const rec = this.freeNumbers.pop();
    if (!rec) return;
    const { sp, canvas, tex } = rec;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, 160, 80);
    g.font = `900 ${crit ? 44 : 34}px Arial`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,0.85)';
    const txt = heal ? `+${Math.round(value)}` : `${Math.round(value)}${crit ? '!' : ''}`;
    g.strokeText(txt, 80, 40);
    g.fillStyle = color || (heal ? '#6cf28e' : crit ? '#ffd23f' : '#ffffff');
    g.fillText(txt, 80, 40);
    tex.needsUpdate = true;
    sp.visible = true;
    sp.position.copy(pos);
    sp.position.x += rand(-0.3, 0.3);
    sp.position.z += rand(-0.3, 0.3);
    sp.scale.set(crit ? 2.2 : 1.6, crit ? 1.1 : 0.8, 1);
    sp.material.opacity = 1;
    this.numbers.push({ rec, ttl: 0.75, vy: 2.2 });
  }

  // expanding shockwave ring on the ground
  ring(pos, { color = 0xffffff, r0 = 0.5, r1 = 6, dur = 0.5, y = 0.06, opacity = 0.9 } = {}) {
    const m = new THREE.Mesh(this._ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos.x, y, pos.z);
    m.scale.setScalar(r0);
    this.scene.add(m);
    this.rings.push({ m, t: 0, dur, r0, r1 });
  }

  // ground danger circle that fills up over `dur` — returns handle, auto-removes
  telegraph(pos, radius, dur, color = 0xff4d5a) {
    const outline = new THREE.Mesh(this._ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    outline.rotation.x = -Math.PI / 2;
    outline.position.set(pos.x, 0.07, pos.z);
    outline.scale.setScalar(radius);
    const fill = new THREE.Mesh(this._circGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
    fill.rotation.x = -Math.PI / 2;
    fill.position.set(pos.x, 0.06, pos.z);
    fill.scale.setScalar(0.01);
    this.scene.add(outline, fill);
    const h = { outline, fill, t: 0, dur, radius, done: false };
    this.telegraphs.push(h);
    return h;
  }

  // short-lived zap beam between two points
  beam(a, b, { color = 0x38e1ff, ttl = 0.09, jitter = 0.35, width = 3 } = {}) {
    const pts = [];
    const segs = 7;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const p = new THREE.Vector3().lerpVectors(a, b, t);
      if (i > 0 && i < segs) {
        p.x += rand(-jitter, jitter); p.y += rand(-jitter, jitter); p.z += rand(-jitter, jitter);
      }
      pts.push(p);
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, linewidth: width }));
    this.scene.add(line);
    this.beams.push({ line, ttl, life: ttl });
  }

  update(dt) {
    // particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.ttl -= dt;
      if (p.ttl <= 0) {
        p.m.visible = false;
        this.free.push(p.m);
        this.particles.splice(i, 1);
        continue;
      }
      p.vy -= p.gravity * dt;
      p.m.position.x += p.vx * dt;
      p.m.position.y += p.vy * dt;
      p.m.position.z += p.vz * dt;
      if (p.m.position.y < 0.04) { p.m.position.y = 0.04; p.vy *= -0.35; p.vx *= 0.7; p.vz *= 0.7; }
      p.m.rotation.x += p.spin * dt;
      p.m.rotation.z += p.spin * dt;
      p.m.material.opacity = Math.min(1, (p.ttl / p.life) * 2);
    }
    // numbers
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.ttl -= dt;
      if (n.ttl <= 0) {
        n.rec.sp.visible = false;
        this.freeNumbers.push(n.rec);
        this.numbers.splice(i, 1);
        continue;
      }
      n.rec.sp.position.y += n.vy * dt;
      n.vy *= 0.96;
      n.rec.sp.material.opacity = Math.min(1, n.ttl / 0.3);
    }
    // rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) {
        this.scene.remove(r.m); r.m.material.dispose();
        this.rings.splice(i, 1);
        continue;
      }
      r.m.scale.setScalar(r.r0 + (r.r1 - r.r0) * k);
      r.m.material.opacity = (1 - k) * 0.9;
    }
    // telegraphs
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const t = this.telegraphs[i];
      t.t += dt;
      const k = Math.min(1, t.t / t.dur);
      t.fill.scale.setScalar(Math.max(0.01, k * t.radius));
      t.outline.material.opacity = 0.5 + 0.4 * Math.sin(t.t * 16);
      if (t.t >= t.dur + 0.12 || t.done) {
        this.scene.remove(t.outline, t.fill);
        t.outline.material.dispose(); t.fill.material.dispose();
        this.telegraphs.splice(i, 1);
      }
    }
    // beams
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.ttl -= dt;
      if (b.ttl <= 0) {
        this.scene.remove(b.line);
        b.line.geometry.dispose(); b.line.material.dispose();
        this.beams.splice(i, 1);
      } else {
        b.line.material.opacity = b.ttl / b.life;
      }
    }
    // gibs (Lego pieces)
    for (let i = this.gibs.length - 1; i >= 0; i--) {
      const g = this.gibs[i];
      g.ttl -= dt;
      if (g.ttl <= 0) {
        this.scene.remove(g.mesh);
        this.gibs.splice(i, 1);
        continue;
      }
      g.vel.y -= 22 * dt;
      g.mesh.position.addScaledVector(g.vel, dt);
      g.mesh.rotation.x += g.angVel.x * dt;
      g.mesh.rotation.y += g.angVel.y * dt;
      g.mesh.rotation.z += g.angVel.z * dt;
      if (g.mesh.position.y < g.rest) {
        g.mesh.position.y = g.rest;
        g.vel.y *= -0.42;
        g.vel.x *= 0.65;
        g.vel.z *= 0.65;
        g.angVel.multiplyScalar(0.55);
        g.bounces++;
        if (g.bounces > 3) { g.vel.set(0, 0, 0); g.angVel.set(0, 0, 0); }
      }
      // pop out of existence at the end (Lego cleanup crew)
      if (g.ttl < 0.35) g.mesh.scale.multiplyScalar(Math.max(0.01, 1 - dt * 4));
    }
    // slash trails
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      const s = this.slashes[i];
      s.t += dt;
      const k = s.t / s.dur;
      if (k >= 1) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        s.mesh.material.dispose();
        this.slashes.splice(i, 1);
        continue;
      }
      s.mesh.material.opacity = 0.5 * (1 - k);
      s.mesh.rotation.y = s.yaw + Math.PI / 2 - 1.1 + s.side * k * 1.6; // sweep
    }
  }

  dispose() {
    for (const p of this.particles) { p.m.visible = false; this.free.push(p.m); }
    this.particles.length = 0;
    this.physics?.clearGibs();
    for (const g of this.gibs) this.scene.remove(g.mesh);
    this.gibs.length = 0;
    for (const s of this.slashes) { this.scene.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose(); }
    this.slashes.length = 0;
  }
}
