// ============ springs & dampers ============
// ~120 lines that will do more for perceived polish than most dependencies.
// Everything that currently snaps or lerps with a magic `* dt * 8` should end up
// here: camera follow, FOV, recoil, weapon lag, crosshair bloom, HUD bars,
// health bars, damage indicators, lock-on, hit reactions, menu transitions.
//
// Two flavours, and the difference matters:
//
//   Damper — critically damped, NEVER overshoots. Use when the target is truth
//            and you just want to arrive smoothly: camera follow, HUD bars, FOV.
//            Unconditionally stable at any dt (Unity's SmoothDamp formulation),
//            so a 200ms hitch cannot make it explode.
//
//   Spring — configurable damping ratio, CAN overshoot and ring. Use when the
//            overshoot is the point: recoil kick, crosshair bloom, weapon
//            landing compression, a health bar that punches past and settles.
//
// Reach for Damper by default. Overshoot is a flavour, not a default.

/**
 * Critically damped smoothing toward a target. Never overshoots, never rings.
 * State is held per-instance so callers just say `d.to(target, dt)`.
 */
export class Damper {
  /** @param {number} value @param {number} smoothTime seconds to ~63% of the way */
  constructor(value = 0, smoothTime = 0.12) {
    this.value = value;
    this.vel = 0;
    this.smoothTime = smoothTime;
  }

  /** @returns {number} the new value */
  to(target, dt, smoothTime = this.smoothTime) {
    if (dt <= 0) return this.value;
    // Ryan Juckett / Unity SmoothDamp: a Padé approximant of e^-x that stays
    // stable for arbitrarily large dt instead of exploding like naive Euler.
    const omega = 2 / Math.max(1e-4, smoothTime);
    const x = omega * dt;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = this.value - target;
    const temp = (this.vel + omega * change) * dt;
    this.vel = (this.vel - omega * temp) * exp;
    this.value = target + (change + temp) * exp;
    return this.value;
  }

  snap(v) { this.value = v; this.vel = 0; return v; }
}

/**
 * A real spring-damper. `damping` is the ratio: 1 = critical, <1 rings and
 * overshoots, >1 is sluggish.
 */
export class Spring {
  constructor(value = 0, { stiffness = 170, damping = 0.7 } = {}) {
    this.value = value;
    this.target = value;
    this.vel = 0;
    this.stiffness = stiffness;
    this.damping = damping;
  }

  /** Instant velocity injection — a recoil kick, a hit punch. */
  impulse(v) { this.vel += v; return this; }

  update(dt, target = this.target) {
    this.target = target;
    if (dt <= 0) return this.value;
    // Sub-step so a stiff spring stays stable through a long frame. A spring at
    // k=400 integrated with a single 50ms step diverges; three 16ms steps do not.
    const steps = Math.min(8, Math.max(1, Math.ceil(dt / 0.008)));
    const h = dt / steps;
    const c = 2 * this.damping * Math.sqrt(this.stiffness);
    for (let i = 0; i < steps; i++) {
      const a = this.stiffness * (this.target - this.value) - c * this.vel;
      this.vel += a * h;
      this.value += this.vel * h;
    }
    return this.value;
  }

  snap(v) { this.value = v; this.target = v; this.vel = 0; return v; }
  get settled() { return Math.abs(this.vel) < 1e-3 && Math.abs(this.target - this.value) < 1e-3; }
}

/** Three independent dampers sharing one smoothTime — camera position, offsets. */
export class Damper3 {
  constructor(x = 0, y = 0, z = 0, smoothTime = 0.12) {
    this.x = new Damper(x, smoothTime);
    this.y = new Damper(y, smoothTime);
    this.z = new Damper(z, smoothTime);
  }

  /** @param {{x:number,y:number,z:number}} out mutated in place */
  to(out, tx, ty, tz, dt, smoothTime) {
    out.x = this.x.to(tx, dt, smoothTime);
    out.y = this.y.to(ty, dt, smoothTime);
    out.z = this.z.to(tz, dt, smoothTime);
    return out;
  }

  snap(x, y, z) { this.x.snap(x); this.y.snap(y); this.z.snap(z); }
}

/** Three springs — weapon sway, recoil offset, procedural lag. */
export class Spring3 {
  constructor(opts = {}) {
    this.x = new Spring(0, opts);
    this.y = new Spring(0, opts);
    this.z = new Spring(0, opts);
  }

  impulse(x, y, z) { this.x.impulse(x); this.y.impulse(y); this.z.impulse(z); return this; }

  update(dt, tx = 0, ty = 0, tz = 0) {
    this.x.update(dt, tx);
    this.y.update(dt, ty);
    this.z.update(dt, tz);
    return this;
  }

  snap(x = 0, y = 0, z = 0) { this.x.snap(x); this.y.snap(y); this.z.snap(z); }
}

/**
 * Framerate-independent exponential approach — the correct form of the
 * `v += (target - v) * 0.1` idiom that is scattered through most game code and
 * silently changes behaviour with framerate.
 * @param {number} lambda higher = snappier
 */
export function damp(current, target, lambda, dt) {
  return target + (current - target) * Math.exp(-lambda * dt);
}
