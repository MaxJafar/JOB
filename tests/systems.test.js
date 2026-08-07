import { describe, it, expect, beforeEach } from 'vitest';
import { Pool, PoolManager } from '../src/core/pool.js';
import { Damper, Spring, damp } from '../src/core/spring.js';
import { EnemyLOD } from '../src/ai/lod.js';
import { DirectorObservations, PressureModel } from '../src/ai/pressure.js';

describe('Pool', () => {
  let made, p;
  beforeEach(() => {
    made = 0;
    p = new Pool({ create: () => ({ id: ++made, hot: false }), reset: (o) => { o.hot = false; }, capacity: 3 });
  });

  it('reuses objects instead of allocating', () => {
    const a = p.acquire();
    p.release(a);
    const b = p.acquire();
    expect(b).toBe(a);
    expect(p.created).toBe(1);
  });

  it('resets objects on release', () => {
    const a = p.acquire();
    a.hot = true;
    p.release(a);
    expect(p.acquire().hot).toBe(false);
  });

  it('returns null at capacity and records the starve', () => {
    p.acquire(); p.acquire(); p.acquire();
    expect(p.acquire()).toBeNull();
    expect(p.stats().starved).toBe(1);
  });

  // Cosmetics should degrade, not disappear: better the oldest blood splat goes
  // than no new one appears.
  it('recycles the oldest when asked to', () => {
    const first = p.acquire();
    p.acquire(); p.acquire();
    const next = p.acquireRecycling();
    expect(next).toBe(first);
    expect(p.size).toBe(3);
  });

  it('ignores a double release', () => {
    const a = p.acquire();
    expect(p.release(a)).toBe(true);
    expect(p.release(a)).toBe(false);
    expect(p.idle).toBe(1);
  });

  it('releaseAll hands everything back without freeing buffers', () => {
    p.acquire(); p.acquire();
    p.releaseAll();
    expect(p.size).toBe(0);
    expect(p.idle).toBe(2);
    expect(p.created).toBe(2);   // no re-allocation
  });

  it('tracks the high-water mark', () => {
    const a = p.acquire(); p.acquire();
    p.release(a);
    expect(p.stats().peak).toBe(2);
  });
});

describe('PoolManager', () => {
  it('registers and totals across pools', () => {
    const pm = new PoolManager();
    const bullets = pm.register('bullets', { create: () => ({}), capacity: 10 });
    const gibs = pm.register('gibs', { create: () => ({}), capacity: 10 });
    bullets.acquire(); bullets.acquire(); gibs.acquire();
    expect(pm.totalLive).toBe(3);
    expect(pm.stats()).toHaveLength(2);
    pm.releaseAll();
    expect(pm.totalLive).toBe(0);
  });
});

describe('Damper', () => {
  it('converges on the target without overshooting', () => {
    const d = new Damper(0, 0.1);
    let overshot = false;
    for (let i = 0; i < 200; i++) {
      d.to(10, 1 / 60);
      if (d.value > 10.0001) overshot = true;
    }
    expect(d.value).toBeCloseTo(10, 2);
    expect(overshot).toBe(false);
  });

  // The whole reason to use this formulation rather than naive Euler.
  it('stays stable across an enormous frame spike', () => {
    const d = new Damper(0, 0.05);
    d.to(10, 2.0);
    expect(Number.isFinite(d.value)).toBe(true);
    expect(d.value).toBeGreaterThanOrEqual(0);
    expect(d.value).toBeLessThanOrEqual(10.001);
  });

  it('is roughly framerate independent', () => {
    const a = new Damper(0, 0.15), b = new Damper(0, 0.15);
    for (let i = 0; i < 60; i++) a.to(10, 1 / 60);
    for (let i = 0; i < 120; i++) b.to(10, 1 / 120);
    expect(Math.abs(a.value - b.value)).toBeLessThan(0.15);
  });
});

describe('Spring', () => {
  it('overshoots when underdamped — that is the point', () => {
    const s = new Spring(0, { stiffness: 300, damping: 0.3 });
    let peak = 0;
    for (let i = 0; i < 60; i++) { s.update(1 / 60, 1); peak = Math.max(peak, s.value); }
    expect(peak).toBeGreaterThan(1);
  });

  it('settles back to rest after an impulse', () => {
    const s = new Spring(0, { stiffness: 300, damping: 0.7 });
    s.impulse(12);
    for (let i = 0; i < 400; i++) s.update(1 / 60, 0);
    expect(Math.abs(s.value)).toBeLessThan(0.01);
    expect(s.settled).toBe(true);
  });

  it('does not diverge on a long frame', () => {
    const s = new Spring(0, { stiffness: 400, damping: 0.5 });
    s.impulse(20);
    for (let i = 0; i < 20; i++) s.update(0.05, 0);   // 20fps
    expect(Number.isFinite(s.value)).toBe(true);
    expect(Math.abs(s.value)).toBeLessThan(50);
  });
});

describe('damp()', () => {
  it('is framerate independent', () => {
    let a = 0, b = 0;
    for (let i = 0; i < 60; i++) a = damp(a, 10, 8, 1 / 60);
    for (let i = 0; i < 240; i++) b = damp(b, 10, 8, 1 / 240);
    expect(Math.abs(a - b)).toBeLessThan(0.01);
  });
});

// ---------------------------------------------------------------- enemy LOD

function fakeGame(enemies) {
  return {
    enemies,
    player: { pos: { x: 0, y: 0, z: 0 } },
    level: { losBlocked: () => false },
  };
}
const mob = (x, extra = {}) => ({
  pos: { x, y: 0, z: 0 }, dead: false, def: {}, state: 'seek', windupT: 0, ...extra,
});

describe('EnemyLOD', () => {
  it('tiers enemies by distance', () => {
    const enemies = [mob(5), mob(30), mob(60), mob(120)];
    const lod = new EnemyLOD(fakeGame(enemies));
    enemies.forEach((e) => lod.register(e));
    enemies.forEach((e) => lod._classify(e, 0, 0));
    expect(enemies[0].lodTier).toBe(0);
    expect(enemies[1].lodTier).toBe(1);
    expect(enemies[2].lodTier).toBe(2);
    expect(enemies[3].lodTier).toBe(3);
  });

  it('keeps anything in melee range hot regardless of tier maths', () => {
    const e = mob(3);
    const lod = new EnemyLOD(fakeGame([e]));
    lod.register(e);
    lod.bias = 5;                 // even under the harshest bias
    lod._classify(e, 0, 0);
    expect(e.lodTier).toBe(0);
    expect(e.lodInterval).toBe(0);
  });

  it('skips distant ticks but never loses the elapsed time', () => {
    const far = mob(120);
    const lod = new EnemyLOD(fakeGame([far]));
    lod.register(far);
    lod._classify(far, 0, 0);
    let calls = 0, totalDt = 0, maxStep = 0;
    for (let i = 0; i < 120; i++) {
      lod.update(1 / 60, (e, edt) => {
        calls++; totalDt += edt; maxStep = Math.max(maxStep, edt); return true;
      });
    }
    expect(calls).toBeLessThan(20);                     // far cheaper than 120 ticks
    expect(maxStep).toBeLessThanOrEqual(0.25 + 1e-9);   // bounded per integration
    // The invariant that matters: every second of elapsed time is either
    // already simulated or still banked — none of it is silently discarded.
    expect(totalDt + far.lodAccum).toBeCloseTo(2, 4);
    expect(totalDt).toBeGreaterThan(1.5);
  });

  it('never lets a boss or a winding-up attacker run cold', () => {
    const boss = mob(200, { def: { boss: true } });
    const winding = mob(200, { windupT: 0.3 });
    const lod = new EnemyLOD(fakeGame([boss, winding]));
    [boss, winding].forEach((e) => { lod.register(e); lod._classify(e, 0, 0); });
    let calls = 0;
    for (let i = 0; i < 60; i++) lod.update(1 / 60, () => { calls++; return true; });
    expect(calls).toBe(120);   // both, every tick
  });

  it('reaps enemies whose tick returns false', () => {
    const enemies = [mob(2), mob(3)];
    const lod = new EnemyLOD(fakeGame(enemies));
    enemies.forEach((e) => lod.register(e));
    const dead = lod.update(1 / 60, (e) => e !== enemies[0]);
    expect(dead).toEqual([enemies[0]]);
  });

  it('runs everything hot when disabled', () => {
    const enemies = [mob(500), mob(500)];
    const lod = new EnemyLOD(fakeGame(enemies));
    enemies.forEach((e) => { lod.register(e); lod._classify(e, 0, 0); });
    lod.enabled = false;
    let calls = 0;
    lod.update(1 / 60, () => { calls++; return true; });
    expect(calls).toBe(2);
  });
});

// ------------------------------------------------------------- director 2.0

describe('PressureModel', () => {
  const ctx = { table: [{ key: 'paperling' }, { key: 'drone', minDiff: 3 }], pacing: 'BUILDUP', coeff: 1.5 };

  it('rises when the player is hurt and crowded', () => {
    const obs = new DirectorObservations();
    const m = new PressureModel();
    obs.hpFrac = 0.3; obs.damageTaken = 60; obs.enemyCount = 20;
    for (let i = 0; i < 60; i++) m.update(obs, 1 / 60, ctx);
    expect(m.pressure).toBeGreaterThan(0.4);
  });

  it('stays low when the player is healthy and alone', () => {
    const obs = new DirectorObservations();
    const m = new PressureModel();
    for (let i = 0; i < 60; i++) m.update(obs, 1 / 60, ctx);
    expect(m.pressure).toBeLessThan(0.1);
  });

  it('spikes faster than it decays', () => {
    const obs = new DirectorObservations();
    const m = new PressureModel();
    obs.hpFrac = 0.2; obs.damageTaken = 90; obs.enemyCount = 25;
    for (let i = 0; i < 30; i++) m.update(obs, 1 / 60, ctx);
    const rise = m.pressure;
    obs.hpFrac = 1; obs.damageTaken = 0; obs.enemyCount = 0;
    for (let i = 0; i < 30; i++) m.update(obs, 1 / 60, ctx);
    expect(m.pressure).toBeGreaterThan(rise * 0.5);   // still bleeding off
  });

  it('asks for relief once fatigue saturates', () => {
    const obs = new DirectorObservations();
    const m = new PressureModel();
    obs.hpFrac = 0.25; obs.damageTaken = 90; obs.enemyCount = 30; obs.eliteCount = 3;
    for (let i = 0; i < 60 * 90; i++) m.update(obs, 1 / 60, ctx);
    expect(m.fatigue).toBeGreaterThan(0.8);
    expect(m.outputs.wantRelief).toBe(true);
  });

  // The anti-death-spiral valve.
  it('is more generous with loot when the player is struggling', () => {
    const easy = new DirectorObservations();
    const hard = new DirectorObservations();
    hard.hpLow = 0.15; hard.hpFrac = 0.2; hard.recentDeaths = 1;
    const a = new PressureModel(), b = new PressureModel();
    a.update(easy, 1 / 60, ctx);
    b.update(hard, 1 / 60, ctx);
    expect(b.outputs.lootGenerosity).toBeGreaterThan(a.outputs.lootGenerosity);
  });

  it('gates enemy composition on the difficulty coefficient', () => {
    const obs = new DirectorObservations();
    const m = new PressureModel();
    m.update(obs, 1 / 60, { ...ctx, coeff: 1 });
    expect(m.outputs.allowedEnemies).toEqual(['paperling']);
    m.update(obs, 1 / 60, { ...ctx, coeff: 4 });
    expect(m.outputs.allowedEnemies).toContain('drone');
  });

  // Rate and population must stay separate levers; compounding them made RELAX
  // refuse to spawn anything at all.
  it('keeps the population budget independent of the pacing phase', () => {
    const obs = new DirectorObservations();
    const m = new PressureModel();
    m.update(obs, 1 / 60, { ...ctx, pacing: 'RELAX' });
    const relax = m.outputs.spawnBudget;
    m.update(obs, 1 / 60, { ...ctx, pacing: 'PEAK' });
    expect(m.outputs.spawnBudget).toBe(relax);
    expect(relax).toBeGreaterThanOrEqual(6);
  });

  it('never ambushes a player who is already in trouble', () => {
    const obs = new DirectorObservations();
    obs.hpFrac = 0.2; obs.roomType = 'arena'; obs.timeSinceCombat = 30;
    const m = new PressureModel();
    m.update(obs, 1 / 60, ctx);
    expect(m.outputs.ambushChance).toBe(0);
  });

  it('will ambush a comfortable player in an open room', () => {
    const obs = new DirectorObservations();
    obs.hpFrac = 1; obs.roomType = 'bullpen'; obs.timeSinceCombat = 20;
    const m = new PressureModel();
    m.update(obs, 1 / 60, ctx);
    expect(m.outputs.ambushChance).toBeGreaterThan(0);
  });
});
