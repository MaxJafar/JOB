import { describe, it, expect, beforeEach } from 'vitest';
import { PlayerMotor, MOVE_STATE } from '../src/player/motor.js';
import { TUNE } from '../src/game/config.js';
import { resolveCircleAABB } from '../src/core/utils.js';

// Minimal stand-in for Level: the motor only needs collideCircle + groundHeightAt.
function makeLevel(colliders = []) {
  const bounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
  return {
    colliders,
    collideCircle(pos, radius, entityY = 0, entityH = 1.8) {
      let hit = false;
      if (pos.x < bounds.minX + radius) { pos.x = bounds.minX + radius; hit = true; }
      if (pos.x > bounds.maxX - radius) { pos.x = bounds.maxX - radius; hit = true; }
      if (pos.z < bounds.minZ + radius) { pos.z = bounds.minZ + radius; hit = true; }
      if (pos.z > bounds.maxZ - radius) { pos.z = bounds.maxZ - radius; hit = true; }
      for (const c of colliders) {
        if (c.disabled) continue;
        if (resolveCircleAABB(pos, radius, c, entityY, entityH)) hit = true;
      }
      return hit;
    },
    groundHeightAt(x, z, maxY = 1e9, r = 0.3) {
      let best = 0;
      for (const c of colliders) {
        if (c.disabled) continue;
        const h = c.h ?? 5;
        if (h <= best || h > maxY) continue;
        if (x < c.minX - r || x > c.maxX + r) continue;
        if (z < c.minZ - r || z > c.maxZ + r) continue;
        best = h;
      }
      return best;
    },
    losBlocked: () => false,
  };
}

function makeMotor(colliders = []) {
  const game = { level: makeLevel(colliders) };
  const m = new PlayerMotor(game, { radius: 0.45, height: 1.8, stepHeight: 0.55 });
  m.teleport(0, 0, 0);
  return m;
}

const step = 1 / 60;
function run(m, ticks, intent = {}) {
  for (let i = 0; i < ticks; i++) {
    m.setIntent(intent);
    m.update(step);
  }
}

describe('PlayerMotor — locomotion', () => {
  let m;
  beforeEach(() => { m = makeMotor(); });

  it('starts grounded and idle', () => {
    run(m, 5, { speedCap: 6 });
    expect(m.onGround).toBe(true);
    expect(m.state).toBe(MOVE_STATE.IDLE);
  });

  it('accelerates toward the speed cap but never past it', () => {
    run(m, 180, { moveZ: 1, yaw: 0, speedCap: 6 });
    expect(m.speed).toBeGreaterThan(5.5);
    expect(m.speed).toBeLessThanOrEqual(6.05);
    expect(m.state).toBe(MOVE_STATE.WALK);
  });

  it('moves in the direction the camera faces', () => {
    run(m, 60, { moveZ: 1, yaw: Math.PI / 2, speedCap: 6 });
    expect(m.pos.x).toBeGreaterThan(1);
    expect(Math.abs(m.pos.z)).toBeLessThan(0.5);
  });

  it('decelerates to a stop when input releases', () => {
    run(m, 120, { moveZ: 1, yaw: 0, speedCap: 6 });
    run(m, 120, { moveZ: 0, yaw: 0, speedCap: 6 });
    expect(m.speed).toBeLessThan(0.2);
  });

  it('sprints faster than it walks', () => {
    run(m, 180, { moveZ: 1, yaw: 0, speedCap: 6 });
    const walk = m.speed;
    const m2 = makeMotor();
    run(m2, 180, { moveZ: 1, yaw: 0, sprint: true, speedCap: 6 * TUNE.sprintMult });
    expect(m2.speed).toBeGreaterThan(walk * 1.3);
    expect(m2.state).toBe(MOVE_STATE.SPRINT);
  });

  // Framerate independence is the whole reason the fixed timestep exists;
  // the motor must not undo it.
  it('reaches the same speed regardless of step size', () => {
    const a = makeMotor(), b = makeMotor();
    for (let i = 0; i < 120; i++) { a.setIntent({ moveZ: 1, yaw: 0, speedCap: 6 }); a.update(1 / 60); }
    for (let i = 0; i < 240; i++) { b.setIntent({ moveZ: 1, yaw: 0, speedCap: 6 }); b.update(1 / 120); }
    expect(Math.abs(a.speed - b.speed)).toBeLessThan(0.35);
  });
});

describe('PlayerMotor — jump, coyote, buffer', () => {
  it('jumps and lands', () => {
    const m = makeMotor();
    const events = [];
    m.onJump = () => events.push('jump');
    m.onLand = () => events.push('land');
    m.setIntent({ jump: true, speedCap: 6 });
    m.update(step);
    expect(events).toContain('jump');
    expect(m.onGround).toBe(false);
    run(m, 200, { jump: false, speedCap: 6 });
    expect(m.onGround).toBe(true);
    expect(events).toContain('land');
  });

  it('allows a coyote-time jump just after leaving a ledge', () => {
    const m = makeMotor([{ minX: -2, maxX: 2, minZ: -2, maxZ: 2, h: 1.0 }]);
    m.teleport(0, 1.0, 0);
    run(m, 2, { speedCap: 6 });
    expect(m.onGround).toBe(true);
    // walk off the edge, then jump within the coyote window
    run(m, 6, { moveX: 1, yaw: 0, speedCap: 6 });
    m.setIntent({ moveX: 1, yaw: 0, jump: true, speedCap: 6 });
    m.update(step);
    expect(m.vel.y).toBeGreaterThan(0);
  });

  it('buffers a jump pressed just before landing', () => {
    const m = makeMotor();
    m.setIntent({ jump: true, speedCap: 6 });
    m.update(step);
    expect(m.onGround).toBe(false);

    let fired = 0;
    m.onJump = () => fired++;
    let pressed = false;
    for (let i = 0; i < 120; i++) {
      // press once on the way down, inside the 0.12s buffer window
      const press = !pressed && m.vel.y < 0 && m.pos.y < 0.1;
      if (press) pressed = true;
      m.setIntent({ jump: press, speedCap: 6 });
      m.update(step);
      if (fired) break;
    }
    expect(pressed).toBe(true);
    expect(fired).toBe(1);   // the buffered press fired on touchdown
  });

  it('does not double-jump from a single press', () => {
    const m = makeMotor();
    let jumps = 0;
    m.onJump = () => jumps++;
    for (let i = 0; i < 10; i++) { m.setIntent({ jump: true, speedCap: 6 }); m.update(step); }
    expect(jumps).toBe(1);
  });
});

describe('PlayerMotor — abilities', () => {
  it('dashes at dash speed and respects the cooldown', () => {
    const m = makeMotor();
    m.setIntent({ dash: true, yaw: 0, speedCap: 6, dashCd: 3.6 });
    m.update(step);
    expect(m.speed).toBeGreaterThan(TUNE.dashSpeed * 0.85);
    expect(m.state).toBe(MOVE_STATE.DASH);
    let dashes = 0;
    m.onDash = () => dashes++;
    run(m, 60, { dash: true, yaw: 0, speedCap: 6, dashCd: 3.6 });
    expect(dashes).toBe(0);   // still cooling down
  });

  it('slides only from a sprint on the ground', () => {
    const m = makeMotor();
    m.setIntent({ moveZ: 1, yaw: 0, slide: true, sprint: false, speedCap: 6 });
    m.update(step);
    expect(m.state).not.toBe(MOVE_STATE.SLIDE);

    run(m, 60, { moveZ: 1, yaw: 0, sprint: true, speedCap: 9 });
    m.setIntent({ moveZ: 1, yaw: 0, sprint: true, slide: true, speedCap: 9 });
    m.update(step);
    expect(m.state).toBe(MOVE_STATE.SLIDE);
  });

  it('slide-jump keeps momentum above the normal cap', () => {
    const m = makeMotor();
    run(m, 90, { moveZ: 1, yaw: 0, sprint: true, speedCap: 9 });
    m.setIntent({ moveZ: 1, yaw: 0, sprint: true, slide: true, speedCap: 9 });
    m.update(step);
    const slideSpeed = m.speed;
    m.setIntent({ moveZ: 1, yaw: 0, sprint: true, jump: true, speedCap: 9 });
    m.update(step);
    expect(m.speed).toBeGreaterThan(slideSpeed * 1.1);
    expect(m.momentumT).toBeGreaterThan(0);
  });
});

describe('PlayerMotor — collision', () => {
  // NOTE the engine's strafe convention: at yaw 0 the character faces +Z and
  // "right" is -X, so a positive moveX travels toward NEGATIVE x. Obstacles in
  // these tests are placed accordingly.
  it('does not pass through a wall', () => {
    const m = makeMotor([{ minX: -5, maxX: -4, minZ: -20, maxZ: 20, h: 5 }]);
    run(m, 300, { moveX: 1, yaw: 0, speedCap: 9 });
    expect(m.pos.x).toBeCloseTo(-3.55, 1);   // wall face at -4, plus body radius
  });

  // Wall-slide is the difference between grazing a doorframe and stopping dead.
  it('slides along a wall instead of sticking to it', () => {
    // wall long enough that 120 ticks cannot round its end
    const m = makeMotor([{ minX: -5, maxX: -4, minZ: -200, maxZ: 200, h: 5 }]);
    // diagonal into the wall: X is blocked, Z must keep moving
    run(m, 120, { moveX: 1, moveZ: 1, yaw: 0, speedCap: 8 });
    expect(m.pos.x).toBeCloseTo(-3.55, 1);   // wall face at -4, plus body radius
    expect(Math.abs(m.pos.z)).toBeGreaterThan(4);
  });

  it('steps up onto a low ledge and keeps walking on it', () => {
    const m = makeMotor([{ minX: -12, maxX: -2, minZ: -6, maxZ: 6, h: 0.4 }]);
    let stepped = 0;
    m.onStepUp = () => stepped++;
    run(m, 45, { moveX: 1, yaw: 0, speedCap: 6 });   // stop while still on the ledge
    expect(stepped).toBe(1);
    expect(m.pos.x).toBeLessThan(-2.5);
    expect(m.pos.y).toBeCloseTo(0.4, 2);
    expect(m.onGround).toBe(true);
  });

  it('is stopped by anything taller than the step height', () => {
    const m = makeMotor([{ minX: -12, maxX: -2, minZ: -6, maxZ: 6, h: 1.4 }]);
    run(m, 200, { moveX: 1, yaw: 0, speedCap: 6 });
    expect(m.pos.x).toBeCloseTo(-1.55, 1);   // ledge face at -2, plus body radius
    expect(m.pos.y).toBeLessThan(0.1);
  });

  it('stands on a surface without being ejected off it', () => {
    const m = makeMotor([{ minX: -3, maxX: 3, minZ: -3, maxZ: 3, h: 1.0 }]);
    m.teleport(0, 1.0, 0);
    run(m, 30, { speedCap: 6 });
    expect(m.pos.y).toBeCloseTo(1.0, 2);
    expect(Math.abs(m.pos.x)).toBeLessThan(0.5);   // not shoved out sideways
    expect(m.onGround).toBe(true);
  });

  it('falls off a surface back to the floor', () => {
    const m = makeMotor([{ minX: -3, maxX: 3, minZ: -3, maxZ: 3, h: 1.0 }]);
    m.teleport(0, 1.0, 0);
    run(m, 4, { speedCap: 6 });
    expect(m.pos.y).toBeCloseTo(1.0, 2);
    run(m, 300, { moveX: 1, yaw: 0, speedCap: 6 });
    expect(m.pos.y).toBeCloseTo(0, 2);
  });

  it('never ends a tick below the floor', () => {
    const m = makeMotor([{ minX: -3, maxX: 3, minZ: -3, maxZ: 3, h: 1.0 }]);
    for (let i = 0; i < 600; i++) {
      m.setIntent({ moveX: Math.sin(i * 0.3), moveZ: Math.cos(i * 0.2), yaw: i * 0.05, jump: i % 37 === 0, speedCap: 8 });
      m.update(step);
      expect(m.pos.y).toBeGreaterThanOrEqual(-1e-6);
      expect(Number.isFinite(m.pos.x)).toBe(true);
    }
  });
});

describe('PlayerMotor — knockback', () => {
  it('applies an external shove', () => {
    const m = makeMotor();
    m.applyKnockback(1, 0, 0, 10);
    expect(m.vel.x).toBeCloseTo(10, 5);
  });

  it('scales the shove by knockback resistance', () => {
    const m = makeMotor();
    m.knockbackResist = 0.5;
    m.applyKnockback(1, 0, 0, 10);
    expect(m.vel.x).toBeCloseTo(5, 5);
  });

  it('clamps resistance so nothing is ever fully immovable', () => {
    const m = makeMotor();
    m.knockbackResist = 5;
    m.applyKnockback(1, 0, 0, 10);
    expect(m.vel.x).toBeGreaterThan(0.9);
  });
});
