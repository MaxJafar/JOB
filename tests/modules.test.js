import { describe, it, expect, beforeEach } from 'vitest';
import {
  rollModule, modPower, describeModule, ModuleLuck,
  SPECIAL_MODULES, PASSIVE_MODULES, MODULE_BY_ID, MODULE_TIERS, BOSS_MODULES,
} from '../src/game/modules.js';
import { Director } from '../src/game/director.js';

// A deterministic stand-in for Math.random: hand it the sequence you want.
function seq(...values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

describe('module tables', () => {
  it('every card has a unique id', () => {
    const ids = [...SPECIAL_MODULES, ...PASSIVE_MODULES].map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every special is usable and every passive has tuned values', () => {
    for (const m of SPECIAL_MODULES) {
      expect(typeof m.use, m.id).toBe('function');
      expect(m.cd, m.id).toBeGreaterThan(0);
    }
    for (const m of PASSIVE_MODULES) {
      expect(Object.keys(m.v).length, m.id).toBeGreaterThan(0);
    }
  });

  // Every department head owes a card, and it has to be a card that exists.
  it('boss signature cards all resolve to real specials', () => {
    for (const [boss, id] of Object.entries(BOSS_MODULES)) {
      expect(MODULE_BY_ID[id], `${boss} -> ${id}`).toBeDefined();
      expect(SPECIAL_MODULES.some((m) => m.id === id), id).toBe(true);
    }
  });
});

describe('rollModule', () => {
  it('scales special damage numbers and shortens the cooldown with rarity', () => {
    const common = rollModule(Math.random, { id: 'coldcall', kind: 'special', tier: 0 });
    const rare = rollModule(Math.random, { id: 'coldcall', kind: 'special', tier: 2 });
    expect(rare.mult).toBeGreaterThan(common.mult);
    expect(rare.cd).toBeLessThan(common.cd);
  });

  it('scales passive values with rarity', () => {
    const common = rollModule(Math.random, { id: 'ergochair', kind: 'passive', tier: 0 });
    const rare = rollModule(Math.random, { id: 'ergochair', kind: 'passive', tier: 2 });
    expect(rare.v.specialCdMult).toBeGreaterThan(common.v.specialCdMult);
  });

  // PAPER TRAIL counts kills DOWN to a drop, so a better card has to fire
  // SOONER. Multiplying it like every other number would make the rare version
  // strictly worse than the common one.
  it('inverts count-down passives so a rarer card is not a downgrade', () => {
    const common = rollModule(Math.random, { id: 'papertrail', kind: 'passive', tier: 0 });
    const rare = rollModule(Math.random, { id: 'papertrail', kind: 'passive', tier: 2 });
    expect(rare.v.snackEvery).toBeLessThan(common.v.snackEvery);
  });

  it('honours an explicit id and marks the right slot', () => {
    const m = rollModule(Math.random, { id: 'bodycheck' });
    expect(m.id).toBe('bodycheck');
    expect(m.kind).toBe('special');
    expect(rollModule(Math.random, { id: 'openplan' }).kind).toBe('passive');
  });

  it('a rarity boost can only push rarity up', () => {
    // 0.30 lands in the uncommon band unboosted, and in the rare band boosted.
    const plain = rollModule(seq(0, 0.3), { kind: 'special' });
    const boosted = rollModule(seq(0, 0.3), { kind: 'special', rarityBoost: 1 });
    expect(boosted.tier).toBeGreaterThanOrEqual(plain.tier);
    expect(boosted.tier).toBe(2);
  });

  it('describes itself without a live player', () => {
    for (const def of [...SPECIAL_MODULES, ...PASSIVE_MODULES]) {
      const m = rollModule(Math.random, { id: def.id });
      expect(describeModule(m), def.id).toBeTruthy();
      expect(describeModule(m), def.id).not.toContain('NaN');
      expect(describeModule(m), def.id).not.toContain('undefined');
    }
  });

  it('clamps a tier index that is out of range', () => {
    expect(rollModule(Math.random, { id: 'coldcall', tier: 9 }).tier).toBe(MODULE_TIERS.length - 1);
    expect(rollModule(Math.random, { id: 'coldcall', tier: -3 }).tier).toBe(0);
  });
});

describe('modPower', () => {
  // The whole point: a card is worth the same on every chassis. Two players at
  // the same damage GROWTH get the same ability, even though the Accountant's
  // per-hit stat is a quarter of the Facilities Guy's.
  it('normalises out the chassis per-hit damage', () => {
    const accountant = { classDef: { damage: 6 }, stats: { damage: 6 } };
    const brawler = { classDef: { damage: 26 }, stats: { damage: 26 } };
    expect(modPower(accountant)).toBeCloseTo(modPower(brawler), 5);
  });

  it('still rewards the damage you actually earned', () => {
    const base = { classDef: { damage: 10 }, stats: { damage: 10 } };
    const geared = { classDef: { damage: 10 }, stats: { damage: 30 } };
    expect(modPower(geared)).toBeCloseTo(modPower(base) * 3, 5);
  });

  it('survives a chassis with no damage stat', () => {
    expect(modPower({ classDef: null, stats: { damage: 14 } })).toBeGreaterThan(0);
  });
});

describe('ModuleLuck (pity timer)', () => {
  let luck;
  beforeEach(() => { luck = new ModuleLuck(); });

  it('raises the floor after a run of commons', () => {
    const before = luck.boost();
    luck.observe({ tier: 0 });
    luck.observe({ tier: 0 });
    expect(luck.boost()).toBeGreaterThan(before);
  });

  it('resets the moment something good drops', () => {
    luck.observe({ tier: 0 });
    luck.observe({ tier: 0 });
    luck.observe({ tier: 2 });
    expect(luck.boost()).toBe(0);
  });

  it('never runs away — a long dry spell is bounded', () => {
    for (let i = 0; i < 200; i++) luck.observe({ tier: 0 });
    expect(luck.boost()).toBeLessThanOrEqual(1.2);
  });

  it('a fresh run starts with no banked pity', () => {
    luck.observe({ tier: 0 });
    luck.reset();
    expect(luck.boost()).toBe(0);
  });
});

// D 1.2 — a power spike the difficulty curve eats on arrival was never a spike.
describe('Director sawtooth protection', () => {
  let game, dir;
  beforeEach(() => {
    game = { runTime: 0, loopCount: 0 };
    dir = new Director(game);
  });

  const run = (secs, step = 0.1) => {
    for (let t = 0; t < secs; t += step) {
      game.runTime += step;
      dir.tickSpikeGrace(step);
    }
  };

  it('holds the coefficient flat for the grace window', () => {
    dir.grantSpikeGrace(20);
    const before = dir.coeff;
    run(15);
    expect(dir.coeff).toBeCloseTo(before, 5);
  });

  it('resumes climbing once the grace expires', () => {
    dir.grantSpikeGrace(5);
    run(5);
    const held = dir.coeff;
    run(30);
    expect(dir.coeff).toBeGreaterThan(held);
  });

  it('grace extends rather than stacking', () => {
    dir.grantSpikeGrace(20);
    run(10);
    dir.grantSpikeGrace(20);          // second card mid-window
    expect(dir.spikeGraceT).toBeCloseTo(20, 5);
  });

  // Freezing more time than was granted would let a single slow frame at the
  // tail of a window rewind the whole run's difficulty.
  it('never banks more time than it granted, even on a huge frame', () => {
    dir.grantSpikeGrace(2);
    dir.tickSpikeGrace(30);
    expect(dir.diffFrozen).toBeCloseTo(2, 5);
  });

  it('cannot push the difficulty clock below zero', () => {
    dir.grantSpikeGrace(60);
    dir.tickSpikeGrace(60);
    game.runTime = 5;
    expect(dir.coeff).toBeGreaterThanOrEqual(1);
  });

  it('a new run clears banked grace, a new floor does not', () => {
    dir.grantSpikeGrace(20);
    dir.tickSpikeGrace(10);
    dir.resetFloor(3);
    expect(dir.diffFrozen).toBeCloseTo(10, 5);
    dir.resetFloor(0);
    expect(dir.diffFrozen).toBe(0);
  });
});
