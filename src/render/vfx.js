// ============ VFX manager (three.quarks) ============
// One registry of named effects. Weapons, bosses and hazards call
//   game.vfx.spawn('bulletImpactMetal', point, normal)
// and never construct a particle system themselves. That centralises pooling,
// quality scaling, particle caps and distance culling — the four things that
// otherwise get reinvented badly at every call site.
//
// Every constraint below was verified by reading three.quarks' installed source.
// They are all silent failures, which is why each one gets a comment:
//
//  1. A ParticleSystem whose emitter is NOT under a Scene self-disposes on the
//     first tick, with no error (ParticleSystem.ts walks emitter.parent to the
//     root and bails unless root.type === 'Scene'). So emitters are parented to
//     the real scene, never to a pooled offscreen Group.
//  2. `looping` DEFAULTS TO TRUE. A one-shot burst that forgets looping:false
//     never ends, so autoDestroy never fires, so it leaks for the life of the
//     scene. Every one-shot here sets it explicitly.
//  3. `worldSpace` DEFAULTS TO FALSE, which keeps particles glued to the emitter.
//     Impacts and explosions must not follow the thing that spawned them.
//  4. `material` is required AND is the batching key. A fresh material per burst
//     means a fresh draw call per burst, so materials are module-scope singletons.
//  5. BatchedRenderer.update() clamps delta to 0.1s internally. Feed it real
//     frame time — never accumulated catch-up time, which it would just discard.
//  6. three.quarks re-exports quarks.core's OWN Vector3/Vector4, which are NOT
//     three's. They are aliased on import here so they cannot shadow THREE's.

import * as THREE from 'three';
import {
  BatchedRenderer, ParticleSystem, RenderMode,
  ConstantValue, IntervalValue, ConstantColor, ColorOverLife, SizeOverLife,
  ApplyForce, Gradient, PiecewiseBezier, Bezier, SphereEmitter, ConeEmitter,
  Vector3 as QVec3, Vector4 as QVec4,
} from 'three.quarks';

// ---- module-scope singletons: these are the batching key (trap 4) ----
const _tex = makeSparkTexture();
const MATERIALS = {
  additive: new THREE.MeshBasicMaterial({
    map: _tex, blending: THREE.AdditiveBlending, transparent: true,
    depthWrite: false, side: THREE.DoubleSide,
  }),
  soft: new THREE.MeshBasicMaterial({
    map: _tex, blending: THREE.NormalBlending, transparent: true,
    depthWrite: false, side: THREE.DoubleSide,
  }),
};

const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

/**
 * A tiny radial-falloff sprite. Generated rather than shipped so the VFX system
 * has no asset dependency — the office is procedural everywhere else too.
 */
function makeSparkTexture() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const rgba = (hex, a = 1) => {
  _c.setHex(hex);
  return new QVec4(_c.r, _c.g, _c.b, a);
};
const _c = new THREE.Color();

/** Standard fade-out alpha curve, reused by most effects. */
const fadeOut = () => new PiecewiseBezier([[new Bezier(1, 0.85, 0.4, 0), 0]]);
const shrink = () => new PiecewiseBezier([[new Bezier(1, 0.9, 0.45, 0), 0]]);

/**
 * The effect registry. Adding an effect is adding an entry here — never a new
 * particle system at a call site.
 *
 * `count` is the burst size at quality 1.0; the governor scales it.
 * `build(opts)` returns ParticleSystemParameters.
 */
export const VFX_DEFS = {
  bulletImpactMetal: {
    count: 10, life: 0.35, radius: 1.2,
    build: (n) => ({
      duration: 0.2, looping: false, autoDestroy: true, worldSpace: true,
      shape: new ConeEmitter({ radius: 0.02, angle: 0.8, thickness: 1 }),
      startLife: new IntervalValue(0.12, 0.3),
      startSpeed: new IntervalValue(3, 9),
      startSize: new IntervalValue(0.03, 0.08),
      startColor: new ConstantColor(rgba(0xffd9a0, 1)),
      emissionOverTime: new ConstantValue(0),
      emissionBursts: [{ time: 0, count: new ConstantValue(n), cycle: 1, interval: 0.01, probability: 1 }],
      behaviors: [
        new ApplyForce(new QVec3(0, -1, 0), new ConstantValue(14)),
        new ColorOverLife(new Gradient([[new QVec3(1, 0.85, 0.55), 0], [new QVec3(1, 0.35, 0.1), 1]], [[1, 0], [0, 1]])),
        new SizeOverLife(shrink()),
      ],
      material: MATERIALS.additive, renderMode: RenderMode.BillBoard,
    }),
  },

  bulletImpactDrywall: {
    count: 8, life: 0.5, radius: 1.0,
    build: (n) => ({
      duration: 0.2, looping: false, autoDestroy: true, worldSpace: true,
      shape: new ConeEmitter({ radius: 0.05, angle: 0.9, thickness: 1 }),
      startLife: new IntervalValue(0.25, 0.5),
      startSpeed: new IntervalValue(1, 3.5),
      startSize: new IntervalValue(0.04, 0.1),
      startColor: new ConstantColor(rgba(0xd8dde6, 0.9)),
      emissionOverTime: new ConstantValue(0),
      emissionBursts: [{ time: 0, count: new ConstantValue(n), cycle: 1, interval: 0.01, probability: 1 }],
      behaviors: [
        new ApplyForce(new QVec3(0, -1, 0), new ConstantValue(9)),
        new ColorOverLife(new Gradient([[new QVec3(0.85, 0.87, 0.9), 0], [new QVec3(0.6, 0.6, 0.62), 1]], [[0.9, 0], [0, 1]])),
        new SizeOverLife(shrink()),
      ],
      material: MATERIALS.soft, renderMode: RenderMode.BillBoard,
    }),
  },

  // The office's signature death particle. Paper, not blood.
  paperBurst: {
    count: 16, life: 1.4, radius: 1.4,
    build: (n) => ({
      duration: 0.3, looping: false, autoDestroy: true, worldSpace: true,
      shape: new SphereEmitter({ radius: 0.25, thickness: 1, arc: Math.PI * 2 }),
      startLife: new IntervalValue(0.8, 1.6),
      startSpeed: new IntervalValue(1.5, 5),
      startSize: new IntervalValue(0.1, 0.22),
      startRotation: new IntervalValue(0, Math.PI * 2),
      startColor: new ConstantColor(rgba(0xf4f1e8, 1)),
      emissionOverTime: new ConstantValue(0),
      emissionBursts: [{ time: 0, count: new ConstantValue(n), cycle: 1, interval: 0.02, probability: 1 }],
      behaviors: [
        // light drag-ish fall so sheets flutter rather than drop like stones
        new ApplyForce(new QVec3(0, -1, 0), new ConstantValue(3.2)),
        new ColorOverLife(new Gradient([[new QVec3(0.96, 0.94, 0.9), 0], [new QVec3(0.9, 0.88, 0.82), 1]], [[1, 0], [1, 0.7], [0, 1]])),
      ],
      material: MATERIALS.soft, renderMode: RenderMode.BillBoard,
    }),
  },

  muzzleFlash: {
    count: 5, life: 0.08, radius: 0.5,
    build: (n) => ({
      duration: 0.06, looping: false, autoDestroy: true, worldSpace: true,
      shape: new ConeEmitter({ radius: 0.01, angle: 0.35, thickness: 1 }),
      startLife: new IntervalValue(0.03, 0.08),
      startSpeed: new IntervalValue(2, 6),
      startSize: new IntervalValue(0.12, 0.26),
      startColor: new ConstantColor(rgba(0xfff0c0, 1)),
      emissionOverTime: new ConstantValue(0),
      emissionBursts: [{ time: 0, count: new ConstantValue(n), cycle: 1, interval: 0.01, probability: 1 }],
      behaviors: [new ColorOverLife(new Gradient([[new QVec3(1, 0.95, 0.75), 0], [new QVec3(1, 0.5, 0.1), 1]], [[1, 0], [0, 1]])), new SizeOverLife(fadeOut())],
      material: MATERIALS.additive, renderMode: RenderMode.BillBoard,
    }),
  },

  printerExplosion: {
    count: 30, life: 1.0, radius: 3.5,
    build: (n) => ({
      duration: 0.35, looping: false, autoDestroy: true, worldSpace: true,
      shape: new SphereEmitter({ radius: 0.4, thickness: 1, arc: Math.PI * 2 }),
      startLife: new IntervalValue(0.4, 1.0),
      startSpeed: new IntervalValue(4, 12),
      startSize: new IntervalValue(0.12, 0.3),
      startColor: new ConstantColor(rgba(0xffb36b, 1)),
      emissionOverTime: new ConstantValue(0),
      emissionBursts: [{ time: 0, count: new ConstantValue(n), cycle: 1, interval: 0.02, probability: 1 }],
      behaviors: [
        new ApplyForce(new QVec3(0, -1, 0), new ConstantValue(11)),
        new ColorOverLife(new Gradient([[new QVec3(1, 0.85, 0.45), 0], [new QVec3(0.35, 0.12, 0.05), 1]], [[1, 0], [0, 1]])),
        new SizeOverLife(shrink()),
      ],
      material: MATERIALS.additive, renderMode: RenderMode.BillBoard,
    }),
  },

  tonerCloud: {
    count: 18, life: 1.8, radius: 2.5,
    build: (n) => ({
      duration: 0.5, looping: false, autoDestroy: true, worldSpace: true,
      shape: new SphereEmitter({ radius: 0.5, thickness: 0.4, arc: Math.PI * 2 }),
      startLife: new IntervalValue(1.0, 2.0),
      startSpeed: new IntervalValue(0.4, 1.6),
      startSize: new IntervalValue(0.5, 1.1),
      startColor: new ConstantColor(rgba(0x1a1a1e, 0.55)),
      emissionOverTime: new ConstantValue(0),
      emissionBursts: [{ time: 0, count: new ConstantValue(n), cycle: 1, interval: 0.03, probability: 1 }],
      behaviors: [
        new ApplyForce(new QVec3(0, 1, 0), new ConstantValue(0.5)),
        new ColorOverLife(new Gradient([[new QVec3(0.1, 0.1, 0.12), 0], [new QVec3(0.2, 0.2, 0.22), 1]], [[0.55, 0], [0, 1]])),
      ],
      material: MATERIALS.soft, renderMode: RenderMode.BillBoard,
    }),
  },

  coffeeSplash: {
    count: 12, life: 0.7, radius: 1.6,
    build: (n) => ({
      duration: 0.25, looping: false, autoDestroy: true, worldSpace: true,
      shape: new ConeEmitter({ radius: 0.1, angle: 1.0, thickness: 1 }),
      startLife: new IntervalValue(0.35, 0.75),
      startSpeed: new IntervalValue(2, 6),
      startSize: new IntervalValue(0.07, 0.16),
      startColor: new ConstantColor(rgba(0x6b4423, 1)),
      emissionOverTime: new ConstantValue(0),
      emissionBursts: [{ time: 0, count: new ConstantValue(n), cycle: 1, interval: 0.01, probability: 1 }],
      behaviors: [
        new ApplyForce(new QVec3(0, -1, 0), new ConstantValue(16)),
        new SizeOverLife(shrink()),
      ],
      material: MATERIALS.soft, renderMode: RenderMode.BillBoard,
    }),
  },

  confetti: {
    count: 24, life: 2.2, radius: 2.0,
    build: (n) => ({
      duration: 0.3, looping: false, autoDestroy: true, worldSpace: true,
      shape: new SphereEmitter({ radius: 0.3, thickness: 1, arc: Math.PI * 2 }),
      startLife: new IntervalValue(1.2, 2.4),
      startSpeed: new IntervalValue(3, 7),
      startSize: new IntervalValue(0.08, 0.16),
      startRotation: new IntervalValue(0, Math.PI * 2),
      startColor: new ConstantColor(rgba(0xff4fa3, 1)),
      emissionOverTime: new ConstantValue(0),
      emissionBursts: [{ time: 0, count: new ConstantValue(n), cycle: 1, interval: 0.02, probability: 1 }],
      behaviors: [
        new ApplyForce(new QVec3(0, -1, 0), new ConstantValue(4.5)),
        new ColorOverLife(new Gradient([[new QVec3(1, 0.31, 0.64), 0], [new QVec3(0.22, 0.88, 1), 1]], [[1, 0], [1, 0.8], [0, 1]])),
      ],
      material: MATERIALS.soft, renderMode: RenderMode.BillBoard,
    }),
  },
};

export class VFXManager {
  /**
   * @param {THREE.Scene} scene MUST be a real Scene — see trap 1.
   */
  constructor(scene) {
    this.scene = scene;
    this.enabled = true;
    this.quality = 1;          // scaled by PerformanceGovernor
    this.maxLive = 48;         // concurrent systems
    this.cullDistance = 60;
    this.listener = new THREE.Vector3();
    this.batched = null;
    this.live = [];
    this.stats = { spawned: 0, culled: 0, dropped: 0, live: 0 };
    this._pendingChain = [];   // trap 7: chained VFX must wait a frame

    try {
      this.batched = new BatchedRenderer();
      this.batched.name = 'vfx';
      // The batched renderer is what actually draws; it must be in the scene
      // graph, and so must every emitter (trap 1).
      scene.add(this.batched);
    } catch (err) {
      console.warn('[vfx] three.quarks unavailable, effects disabled:', err?.message ?? err);
      this.enabled = false;
    }
  }

  setListener(pos) {
    if (pos) this.listener.set(pos.x, pos.y, pos.z);
  }

  /**
   * @param {string} name key in VFX_DEFS
   * @param {{x:number,y:number,z:number}} pos world position
   * @param {THREE.Vector3|null} normal orients cone emitters along the surface
   * @param {{scale?: number, count?: number}} opts
   */
  spawn(name, pos, normal = null, { scale = 1, count = null } = {}) {
    if (!this.enabled || !this.batched) return null;
    const def = VFX_DEFS[name];
    if (!def) return null;

    // distance cull before doing any work — a burst behind you at 80m is pure cost
    const dx = pos.x - this.listener.x, dy = pos.y - this.listener.y, dz = pos.z - this.listener.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    const cull = this.cullDistance + def.radius * 4;
    if (d2 > cull * cull) { this.stats.culled++; return null; }

    if (this.live.length >= this.maxLive) {
      // retire the oldest rather than refusing: a missing hit spark reads as a
      // missed shot, which is worse than a slightly shorter-lived one
      this._retire(0);
    }

    const n = Math.max(1, Math.round((count ?? def.count) * this.quality * scale));
    let sys;
    try {
      sys = new ParticleSystem(def.build(n));
    } catch (err) {
      console.warn(`[vfx] "${name}" failed to build:`, err?.message ?? err);
      this.stats.dropped++;
      return null;
    }

    const emitter = sys.emitter;
    emitter.position.set(pos.x, pos.y, pos.z);
    if (normal && Number.isFinite(normal.x)) {
      // point the cone along the surface normal so sparks spray off the wall
      _v.set(normal.x, normal.y, normal.z).normalize();
      _q.setFromUnitVectors(_up, _v);
      emitter.quaternion.copy(_q);
    } else {
      emitter.quaternion.identity();
    }

    this.scene.add(emitter);          // trap 1: must be under the Scene
    this.batched.addSystem(sys);
    this.live.push({ sys, emitter, ttl: def.life + 0.5 });
    this.stats.spawned++;
    return sys;
  }

  /** Queue an effect for NEXT frame — safe from inside a particle event (trap 7). */
  spawnNextFrame(name, pos, normal = null, opts = {}) {
    this._pendingChain.push({ name, pos: { x: pos.x, y: pos.y, z: pos.z }, normal, opts });
  }

  _retire(i) {
    const e = this.live[i];
    if (!e) return;
    try { this.batched.deleteSystem(e.sys); } catch { /* already gone */ }
    e.emitter.parent?.remove(e.emitter);
    this.live.splice(i, 1);
  }

  /**
   * @param {number} dt REAL frame delta. Do not pass accumulated catch-up time —
   * BatchedRenderer clamps to 0.1s internally and would silently discard it.
   */
  update(dt) {
    if (!this.enabled || !this.batched) return;

    if (this._pendingChain.length) {
      const q = this._pendingChain;
      this._pendingChain = [];
      for (const c of q) this.spawn(c.name, c.pos, c.normal, c.opts);
    }

    this.batched.update(Math.min(dt, 0.1));

    // autoDestroy leaves the emitter Object3D behind; reap on our own timer so
    // a floor change cannot strand a hundred empty emitters in the scene
    for (let i = this.live.length - 1; i >= 0; i--) {
      const e = this.live[i];
      e.ttl -= dt;
      if (e.ttl <= 0) this._retire(i);
    }
    this.stats.live = this.live.length;
  }

  /** Floor change / run teardown. */
  clear() {
    for (let i = this.live.length - 1; i >= 0; i--) this._retire(i);
    this._pendingChain.length = 0;
  }

  dispose() {
    this.clear();
    if (this.batched) this.scene.remove(this.batched);
    this.batched = null;
  }
}
