// ============ PlayerMotor ============
// Rapier supplies collision QUERIES. It does not get to decide how the character
// feels. Applying forces to a rigid body and calling that player movement is the
// fastest route to mushy controls, so the motor owns the whole pipeline:
//
//   Input → Desired velocity → Movement state → Acceleration model
//         → Collision sweep → Step/slope resolution → Final position
//         → Visual interpolation
//
// The acceleration numbers are the ones already tuned in TUNE and shipping; this
// is a restructure, not a re-tune. What is NEW is everything the old inline
// block had no room for: wall-slide response, step-up, standing on surfaces,
// moving-platform velocity inheritance, and knockback resistance.
//
// The motor is deliberately event-driven (onJump/onLand/onDash/...) so all the
// juice — audio, particles, camera kick — stays with the owner and the motor
// stays a pure movement solver that can be unit-tested headlessly.

import * as THREE from 'three';
import { TUNE } from '../game/config.js';

const _wish = new THREE.Vector3();
const _pre = new THREE.Vector3();
const _corr = new THREE.Vector3();

/** Mutually exclusive locomotion states. Abilities layer on top. */
export const MOVE_STATE = {
  IDLE: 'idle',
  WALK: 'walk',
  SPRINT: 'sprint',
  AIR: 'air',
  SLIDE: 'slide',
  DASH: 'dash',
};

export class PlayerMotor {
  /**
   * @param {import('../game/game.js').Game} game
   * @param {{radius?: number, height?: number, stepHeight?: number}} opts
   */
  constructor(game, { radius = 0.42, height = 1.8, stepHeight = 0.55 } = {}) {
    this.game = game;
    this.radius = radius;
    this.height = height;
    this.stepHeight = stepHeight;

    this.pos = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();     // for render interpolation
    this.vel = new THREE.Vector3();
    this.platformVel = new THREE.Vector3(); // inherited from moving surfaces

    this.onGround = false;
    this.groundY = 0;
    this.state = MOVE_STATE.IDLE;
    this.wasOnGround = false;

    this.coyote = 0;
    this.jumpBuffer = 0;
    this.slideT = 0;
    this.dashT = 0;
    this.dashCd = 0;
    this.momentumT = 0;
    this.airTime = 0;
    this.lastFallSpeed = 0;

    this.knockbackResist = 0;   // 0..1, raised by gear/perks

    // intent, refreshed by the owner every tick
    this.intent = {
      moveX: 0, moveZ: 0, yaw: 0,
      sprint: false, jump: false, slide: false, dash: false,
      speedCap: 6, dashCd: TUNE.dashCd, canAct: true,
    };

    // events — assigned by Player
    this.onJump = null;      // (slideJump: boolean)
    this.onLand = null;      // (fallSpeed: number)
    this.onSlideStart = null;
    this.onDash = null;      // (dirX, dirZ)
    this.onStepUp = null;    // (height: number)
    this.onWallHit = null;   // (speed: number)
  }

  // ------------------------------------------------------------------- setup

  teleport(x, y, z) {
    this.pos.set(x, y, z);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.platformVel.set(0, 0, 0);
    this.slideT = this.dashT = this.momentumT = 0;
    this.coyote = this.jumpBuffer = 0;
    this.onGround = true;
    this.groundY = 0;
  }

  /** @param {Partial<typeof this.intent>} i */
  setIntent(i) { Object.assign(this.intent, i); }

  /** External shove — explosions, charges, boss slams. Respects resistance. */
  applyKnockback(dirX, dirY, dirZ, force) {
    const k = force * (1 - Math.min(0.9, this.knockbackResist));
    this.vel.x += dirX * k;
    this.vel.y += dirY * k;
    this.vel.z += dirZ * k;
    if (dirY > 0) this.onGround = false;
  }

  /** Direct velocity override — grapples, lunges, scripted moves. */
  setVelocity(x, y, z) { this.vel.set(x, y, z); }

  // -------------------------------------------------------------------- tick

  update(dt) {
    this.prevPos.copy(this.pos);
    const level = this.game.level;
    const I = this.intent;

    this.dashCd = Math.max(0, this.dashCd - dt);

    // ---- 1. input → desired direction (camera-relative) ----
    const fwdX = Math.sin(I.yaw), fwdZ = Math.cos(I.yaw);
    const rightX = Math.sin(I.yaw - Math.PI / 2), rightZ = Math.cos(I.yaw - Math.PI / 2);
    const moving = I.moveX !== 0 || I.moveZ !== 0;
    let wishX = 0, wishZ = 0;
    if (moving) {
      const il = Math.hypot(I.moveX, I.moveZ);
      wishX = (fwdX * I.moveZ + rightX * I.moveX) / il;
      wishZ = (fwdZ * I.moveZ + rightZ * I.moveX) / il;
    }
    const sprinting = I.sprint && I.moveZ > 0 && this.slideT <= 0;
    const speedCap = I.speedCap;

    // ---- 2. movement state ----
    this._advanceAbilities(dt, { wishX, wishZ, fwdX, fwdZ, moving, sprinting, speedCap });

    // ---- 3. acceleration model ----
    if (this.dashT > 0) {
      this.dashT -= dt;
    } else if (this.slideT > 0) {
      this.slideT -= dt;
      const fr = 1.8;                       // slides bleed speed, they don't stop
      this.vel.x -= this.vel.x * fr * dt;
      this.vel.z -= this.vel.z * fr * dt;
    } else {
      const accel = this.onGround ? TUNE.groundAccel : TUNE.airAccel;
      if (moving) {
        this.vel.x += wishX * accel * dt;
        this.vel.z += wishZ * accel * dt;
      }
      const fr = this.onGround ? TUNE.groundFriction : 0.4;
      const hv0 = Math.hypot(this.vel.x, this.vel.z);
      if (!moving || hv0 > speedCap) {
        this.vel.x -= this.vel.x * Math.min(1, fr * dt);
        this.vel.z -= this.vel.z * Math.min(1, fr * dt);
      }
      const hv = Math.hypot(this.vel.x, this.vel.z);
      // momentum window: a slide-jump keeps its speed for a moment, which is the
      // whole reward for the tech
      if (hv > speedCap && this.momentumT <= 0) {
        this.vel.x = (this.vel.x / hv) * speedCap;
        this.vel.z = (this.vel.z / hv) * speedCap;
      }
    }
    this.momentumT = Math.max(0, this.momentumT - dt);

    // ---- 4. jump (coyote + buffer, evaluated after accel so slide-jump reads
    //         the boosted horizontal velocity) ----
    this.coyote = this.onGround ? TUNE.coyoteTime : Math.max(0, this.coyote - dt);
    this.jumpBuffer = I.jump ? TUNE.jumpBuffer : Math.max(0, this.jumpBuffer - dt);
    if (this.jumpBuffer > 0 && this.coyote > 0) this._doJump();

    // ---- 5. integrate ----
    this.vel.y -= TUNE.gravity * dt;
    _pre.copy(this.pos);
    this.pos.x += (this.vel.x + this.platformVel.x) * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += (this.vel.z + this.platformVel.z) * dt;

    // ---- 6. ground first, THEN horizontal ----
    // Order is load-bearing. resolveCircleAABB only lets you pass over a
    // collider when your feet are strictly above its top, and gravity puts you
    // a hair below the surface every single tick — so resolving horizontally
    // first ejects anyone standing on a desk out sideways, every frame.
    this._resolveGround(level);
    this._resolveCollision(level, _pre);
    if (this._steppedUp) { this._resolveGround(level); this._steppedUp = false; }

    // ---- 7. bookkeeping ----
    if (this.onGround && !this.wasOnGround) {
      this.airTime = 0;
      this.onLand?.(this.lastFallSpeed);
    }
    if (!this.onGround) this.airTime += dt;
    this.wasOnGround = this.onGround;
    this.state = this._deriveState(moving, sprinting);
    return this.state;
  }

  // --------------------------------------------------------------- internals

  _advanceAbilities(dt, { wishX, wishZ, fwdX, fwdZ, moving, sprinting, speedCap }) {
    const I = this.intent;
    if (!I.canAct) return;

    // slide: only from a sprint on the ground, and it cashes in the speed cap
    if (this.slideT <= 0 && I.slide && sprinting && this.onGround) {
      this.slideT = TUNE.slideTime;
      const boost = speedCap * TUNE.slideBoost;
      this.vel.x = (wishX || fwdX) * boost;
      this.vel.z = (wishZ || fwdZ) * boost;
      this.onSlideStart?.();
    }

    // dash: a flat impulse, not a force — instant response is the point
    if (I.dash && this.dashCd <= 0 && this.dashT <= 0) {
      this.dashT = TUNE.dashTime;
      this.dashCd = I.dashCd;
      const dx = moving ? wishX : fwdX;
      const dz = moving ? wishZ : fwdZ;
      this.vel.x = dx * TUNE.dashSpeed;
      this.vel.z = dz * TUNE.dashSpeed;
      this.onDash?.(dx, dz);
    }
  }

  _doJump() {
    this.vel.y = TUNE.playerJump;
    const slideJump = this.slideT > 0;
    if (slideJump) {
      this.vel.x *= TUNE.slideJumpBoost;
      this.vel.z *= TUNE.slideJumpBoost;
      this.momentumT = TUNE.momentumTime;
    }
    // keep the platform's motion when you leave it, or jumping on a lift throws
    // you off the back of it
    this.vel.x += this.platformVel.x;
    this.vel.z += this.platformVel.z;
    this.onGround = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.slideT = 0;
    this.onJump?.(slideJump);
  }

  /**
   * Horizontal collision with wall-slide and step-up.
   *
   * The old code just called collideCircle and let the position get corrected,
   * leaving velocity still pointing into the wall — so you stuck to walls and
   * lost all momentum on a graze. Here the correction vector is measured and
   * removed from velocity, which turns a graze into a slide.
   */
  _resolveCollision(level, preMove) {
    if (!level) return;
    _corr.copy(this.pos);
    // +epsilon: "resting on it" must read as "above it", or a surface you are
    // standing on is also a wall you are inside of.
    const hit = level.collideCircle(this.pos, this.radius, this.pos.y + 0.02, this.height);
    if (!hit) return;

    _corr.subVectors(this.pos, _corr);      // how far we were pushed out
    _corr.y = 0;
    const cl = _corr.length();
    if (cl < 1e-6) return;
    _corr.divideScalar(cl);

    // Step-up: if the blocker's top is within step height, climb it instead of
    // being stopped dead by a desk lip or a door threshold.
    if (this.onGround || this.airTime < 0.2) {
      const targetY = this.pos.y + this.stepHeight;
      // Probe past the LEADING EDGE, not at the stopped position. Collision
      // halts the centre a full radius short of the ledge, so sampling at the
      // centre always reports bare floor and the step never fires.
      const reach = this.radius + 0.12;
      const wantX = this.pos.x - _corr.x * reach;
      const wantZ = this.pos.z - _corr.z * reach;
      const ahead = level.groundHeightAt(wantX, wantZ, targetY, this.radius * 0.5);
      const rise = ahead - this.pos.y;
      if (rise > 0.02 && rise <= this.stepHeight) {
        const saveX = this.pos.x, saveZ = this.pos.z, saveY = this.pos.y;
        this.pos.set(wantX, ahead, wantZ);
        if (level.collideCircle(this.pos, this.radius, this.pos.y + 0.02, this.height)) {
          this.pos.set(saveX, saveY, saveZ);        // no room up there after all
        } else {
          this._steppedUp = true;
          this.onStepUp?.(rise);
          return;
        }
      }
    }

    // Wall slide: strip the into-wall component so lateral speed survives.
    const into = this.vel.x * _corr.x + this.vel.z * _corr.z;
    if (into < 0) {
      const speed = Math.hypot(this.vel.x, this.vel.z);
      this.vel.x -= _corr.x * into;
      this.vel.z -= _corr.z * into;
      if (speed > 6) this.onWallHit?.(speed);
    }
  }

  /** Landing, standing on props, and falling off them. */
  _resolveGround(level) {
    const probe = level
      ? level.groundHeightAt(this.pos.x, this.pos.z, this.pos.y + this.stepHeight, this.radius * 0.8)
      : 0;
    this.groundY = probe;

    if (this.pos.y <= probe + 1e-3) {
      if (this.vel.y < 0) this.lastFallSpeed = -this.vel.y;
      this.pos.y = probe;
      this.vel.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }
    // hard floor: nothing may end a tick below the building
    if (this.pos.y < 0) { this.pos.y = 0; this.vel.y = 0; this.onGround = true; }
  }

  _deriveState(moving, sprinting) {
    if (this.dashT > 0) return MOVE_STATE.DASH;
    if (this.slideT > 0) return MOVE_STATE.SLIDE;
    if (!this.onGround) return MOVE_STATE.AIR;
    if (!moving) return MOVE_STATE.IDLE;
    return sprinting ? MOVE_STATE.SPRINT : MOVE_STATE.WALK;
  }

  // ------------------------------------------------------------------ output

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  get speedNorm() { return Math.min(1, this.speed / Math.max(0.001, this.intent.speedCap)); }

  /**
   * Render position for a given interpolation alpha. Lets the renderer run
   * ahead of a 60 Hz fixed sim without the camera stepping.
   */
  renderPosition(out, alpha) {
    return out.lerpVectors(this.prevPos, this.pos, alpha);
  }
}
