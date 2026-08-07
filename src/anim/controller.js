// ============ AnimationController ============
// AnimationMixer plays clips. It does not decide WHICH clip, and that gap is
// where every game's animation code rots into:
//
//   if (shooting && running && reloading && hit) { ... }
//
// So this is a layered state machine over the mixer. A layer owns a slice of the
// body and resolves independently; the controller only arbitrates between them.
//
//   BASE      idle / walk / run / jump / fall        — locomotion, always on
//   UPPER     aim / reload / fire / melee            — masked to the torso
//   ADDITIVE  recoil / hit reaction / breathing      — offsets, never poses
//   OVERRIDE  stun / death / knockdown / execution   — takes the whole body
//
// Three.js has no true bone masking, so UPPER is implemented as a weighted
// action that shares the mixer, and ADDITIVE is applied procedurally to bone
// transforms after the mixer runs. That is the honest trade for a low-poly game:
// it costs nothing and reads correctly at gameplay distance.
//
// Procedural offsets live here too, because they belong to the same clock:
// weapon sway, recoil springs, landing compression, torso aim offset, look-at.
// They are most of what makes a faceted low-poly character feel expensive.

import * as THREE from 'three';
import { Spring, Spring3, Damper, damp } from '../core/spring.js';

export const LAYER = { BASE: 'base', UPPER: 'upper', ADDITIVE: 'additive', OVERRIDE: 'override' };

/** Clip name candidates per logical state, tried in order. */
const CLIP_ALIASES = {
  idle: ['idle', 'idle_a', 'stand'],
  walk: ['walk', 'walk_forward'],
  run: ['run', 'sprint', 'run_forward'],
  jump: ['jump', 'jump_start'],
  fall: ['fall', 'jump_loop', 'jump'],
  land: ['land', 'jump_end'],
  attack: ['attack_a', 'attack', 'attack_1', 'melee'],
  attack_b: ['attack_b', 'attack_2'],
  fire: ['fire', 'shoot', 'attack_a'],
  reload: ['reload'],
  hit: ['hit', 'hit_react', 'flinch'],
  death: ['death', 'die'],
  stun: ['stun', 'stagger'],
  taunt: ['taunt', 'emote'],
  charge: ['charge', 'run'],
};

export class AnimationController {
  /**
   * @param {THREE.Object3D} root
   * @param {{clips?: Map<string, THREE.AnimationClip>, mixer?: THREE.AnimationMixer, bones?: any}} opts
   */
  constructor(root, { clips = new Map(), mixer = null, bones = {} } = {}) {
    this.root = root;
    this.mixer = mixer ?? new THREE.AnimationMixer(root);
    this.bones = bones;
    this.actions = new Map();
    this.clipNames = new Set();

    for (const [name, clip] of clips) {
      const action = this.mixer.clipAction(clip);
      this.actions.set(name, action);
      this.clipNames.add(name);
    }

    /** @type {Record<string, {state: string|null, action: any, weight: number, lock: number}>} */
    this.layers = {
      [LAYER.BASE]: { state: null, action: null, weight: 1, lock: 0 },
      [LAYER.UPPER]: { state: null, action: null, weight: 0, lock: 0 },
      [LAYER.OVERRIDE]: { state: null, action: null, weight: 0, lock: 0 },
    };

    // ---- procedural rig ----
    this.recoil = new Spring3({ stiffness: 380, damping: 0.55 });   // rings on purpose
    this.sway = new Spring3({ stiffness: 90, damping: 0.85 });
    this.lag = new Spring3({ stiffness: 130, damping: 0.9 });
    this.landSpring = new Spring(0, { stiffness: 240, damping: 0.62 });
    this.breathT = Math.random() * 10;
    this.bobT = 0;
    this.aimPitch = new Damper(0, 0.09);
    this.lookYaw = new Damper(0, 0.14);
    this.flinch = new Spring3({ stiffness: 300, damping: 0.5 });

    /** Output the owner reads each frame. */
    this.offsets = {
      weaponPos: new THREE.Vector3(),
      weaponRot: new THREE.Euler(),
      cameraPos: new THREE.Vector3(),
      torsoPitch: 0,
      headYaw: 0,
      bodyDip: 0,
    };

    this.speedNorm = 0;
    this.enabled = true;
    this.play('idle', LAYER.BASE, 0);
  }

  // ------------------------------------------------------------------- clips

  /** Resolve a logical state to a real clip name this rig actually has. */
  resolve(state) {
    if (this.actions.has(state)) return state;
    for (const alias of CLIP_ALIASES[state] ?? []) {
      if (this.actions.has(alias)) return alias;
    }
    return null;
  }

  has(state) { return this.resolve(state) !== null; }

  /**
   * @param {string} state logical state name
   * @param {string} layer
   * @param {number} fade crossfade seconds — 80-140ms is the readable band
   * @param {{lock?: number, restart?: boolean, weight?: number, timeScale?: number}} opts
   */
  play(state, layer = LAYER.BASE, fade = 0.12, { lock = 0, restart = false, weight = 1, timeScale = 1 } = {}) {
    const L = this.layers[layer];
    if (!L) return false;
    const name = this.resolve(state);
    if (!name) return false;
    const next = this.actions.get(name);
    if (L.action === next && !restart) { L.lock = Math.max(L.lock, lock); return true; }

    next.reset();
    next.setEffectiveWeight(weight);
    next.setEffectiveTimeScale(timeScale);
    next.play();
    if (L.action && L.action !== next) L.action.crossFadeTo(next, fade, false);
    else next.fadeIn(fade);

    L.action = next;
    L.state = state;
    L.lock = lock;
    L.weight = weight;
    return true;
  }

  /** A one-shot that owns its layer for `duration`, then releases it. */
  oneShot(state, layer = LAYER.UPPER, duration = 0.45, fade = 0.06) {
    if (!this.has(state)) return false;
    const action = this.actions.get(this.resolve(state));
    action.loop = THREE.LoopOnce;
    action.clampWhenFinished = true;
    return this.play(state, layer, fade, { lock: duration, restart: true });
  }

  stopLayer(layer, fade = 0.15) {
    const L = this.layers[layer];
    if (!L?.action) return;
    L.action.fadeOut(fade);
    L.action = null;
    L.state = null;
    L.lock = 0;
  }

  // ------------------------------------------------------------------- drive

  /**
   * The one call gameplay makes. Everything the controller needs to pick clips
   * arrives as a flat description of what the character is doing — no clip names
   * and no `if (a && b && c)` at the call site.
   *
   * @param {{
   *   moveState?: string, speedNorm?: number, grounded?: boolean, airTime?: number,
   *   firing?: boolean, reloading?: boolean, aiming?: boolean, blocking?: boolean,
   *   dead?: boolean, stunned?: boolean,
   * }} intent
   */
  setIntent(intent) {
    if (!this.enabled) return;
    const {
      moveState = 'idle', speedNorm = 0, grounded = true, airTime = 0,
      firing = false, reloading = false, dead = false, stunned = false,
    } = intent;
    this.speedNorm = speedNorm;

    // OVERRIDE wins outright
    if (dead) { this.play('death', LAYER.OVERRIDE, 0.08, { lock: 99 }); return; }
    if (stunned) { this.play('stun', LAYER.OVERRIDE, 0.08, { lock: 0.4 }); return; }
    const O = this.layers[LAYER.OVERRIDE];
    if (O.lock <= 0 && O.action) this.stopLayer(LAYER.OVERRIDE);
    if (O.lock > 0) return;

    // BASE: locomotion
    let base = 'idle';
    if (!grounded) base = airTime > 0.25 ? 'fall' : 'jump';
    else if (moveState === 'slide' || moveState === 'dash') base = 'run';
    else if (speedNorm > 0.65) base = 'run';
    else if (speedNorm > 0.08) base = 'walk';
    this.play(base, LAYER.BASE, base === 'idle' ? 0.16 : 0.1);

    // UPPER: only claims the torso when it has something to say
    const U = this.layers[LAYER.UPPER];
    if (U.lock <= 0) {
      if (reloading && this.has('reload')) this.play('reload', LAYER.UPPER, 0.08, { lock: 0.6, weight: 0.85 });
      else if (firing && this.has('fire')) this.oneShot('fire', LAYER.UPPER, 0.18);
      else if (U.action) this.stopLayer(LAYER.UPPER, 0.12);
    }
  }

  // ------------------------------------------------- procedural (the cheap win)

  /** Weapon kick. Vertical rise plus a little backward punch. */
  addRecoil(strength = 1) {
    this.recoil.impulse(
      (Math.random() - 0.5) * 1.2 * strength,
      2.6 * strength,
      -3.4 * strength,
    );
  }

  /** Directional flinch, so a hit from the left visibly pushes you right. */
  addFlinch(dirX, dirZ, strength = 1) {
    this.flinch.impulse(-dirX * 2.4 * strength, 0.6 * strength, -dirZ * 2.4 * strength);
  }

  /** Landing compression — the single most-felt piece of procedural animation. */
  addLandImpact(fallSpeed) {
    this.landSpring.impulse(-Math.min(1, fallSpeed / 22));
  }

  /**
   * @param {number} dt
   * @param {{yawDelta?: number, pitch?: number, moveX?: number, moveZ?: number, lookYaw?: number}} rig
   */
  update(dt, rig = {}) {
    const L = this.layers;
    for (const k of Object.keys(L)) L[k].lock = Math.max(0, L[k].lock - dt);
    this.mixer.update(dt);
    if (!this.enabled) return this.offsets;

    const { yawDelta = 0, pitch = 0, moveX = 0, moveZ = 0, lookYaw = 0 } = rig;

    // sway: the weapon lags behind where you swing the camera
    this.sway.update(dt, -yawDelta * 0.9, pitch * 0.12, 0);
    // lag: and behind where you move
    this.lag.update(dt, -moveX * 0.06, 0, -moveZ * 0.05);
    this.recoil.update(dt, 0, 0, 0);
    this.flinch.update(dt, 0, 0, 0);
    this.landSpring.update(dt, 0);

    this.breathT += dt;
    this.bobT += dt * (2 + this.speedNorm * 9);
    const breathe = Math.sin(this.breathT * 1.4) * 0.006;
    const bobY = Math.sin(this.bobT * 2) * 0.016 * this.speedNorm;
    const bobX = Math.cos(this.bobT) * 0.02 * this.speedNorm;

    const o = this.offsets;
    o.weaponPos.set(
      this.sway.x.value * 0.04 + this.lag.x.value + this.recoil.x.value * 0.01 + bobX + this.flinch.x.value * 0.02,
      this.sway.y.value * 0.03 + this.lag.y.value + this.recoil.y.value * 0.012 + bobY + breathe + this.landSpring.value * 0.09,
      this.lag.z.value + this.recoil.z.value * 0.012,
    );
    o.weaponRot.set(
      this.recoil.y.value * 0.02 + this.sway.y.value * 0.01,
      this.sway.x.value * 0.02,
      this.sway.x.value * 0.012,
    );
    o.cameraPos.set(
      this.flinch.x.value * 0.01,
      this.landSpring.value * 0.13 + this.recoil.y.value * 0.004,
      this.flinch.z.value * 0.01,
    );
    o.torsoPitch = this.aimPitch.to(pitch * 0.45, dt);
    o.headYaw = this.lookYaw.to(lookYaw, dt);
    o.bodyDip = this.landSpring.value;

    this._applyBones(o);
    return o;
  }

  /** Push the procedural pose onto real bones, if this rig exposes them. */
  _applyBones(o) {
    const b = this.bones;
    if (b.spine) b.spine.rotation.x = damp(b.spine.rotation.x, o.torsoPitch, 14, 1 / 60);
    if (b.head) b.head.rotation.y = damp(b.head.rotation.y, o.headYaw, 12, 1 / 60);
    if (b.hips && o.bodyDip) b.hips.position.y = o.bodyDip * 0.12;
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.actions.clear();
  }
}
