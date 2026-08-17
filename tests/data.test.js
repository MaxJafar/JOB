import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TUNE, DIFF_STAGES, FLOORS, SANDBOX_FLOOR, WAVES } from '../src/game/config.js';
import { ENEMY_DEFS, ELITE_MODS } from '../src/game/enemies.js';
import { BOSS_DEFS } from '../src/game/bosses.js';
import { THROWABLES, CONSUMABLES, RARITY_TIERS, WEARABLES, GEAR_SLOTS } from '../src/game/gear.js';
import { CLASSES, CLASS_BY_KEY } from '../src/game/classes.js';
import { MODULE_TIERS, PASSIVE_MODULES } from '../src/game/modules.js';
import { deepApply, parseHexData } from '../src/game/dataUtils.js';

// v0.2 FOUNDATIONS: every table below is loaded from /data/*.json. These tests
// are the referential-integrity net — a typo'd enemy key or a palette left as
// an unparsed hex string fails here instead of as a black screen at runtime.

describe('dataUtils', () => {
  it('parseHexData converts "0x..." strings and leaves everything else alone', () => {
    const d = parseHexData({ a: '0xff', b: ['0x10', 'plain', 3], c: { d: '0x38e1ff' }, e: '#fff' });
    expect(d.a).toBe(255);
    expect(d.b).toEqual([16, 'plain', 3]);
    expect(d.c.d).toBe(0x38e1ff);
    expect(d.e).toBe('#fff');
  });

  it('deepApply mutates in place and never breaks identities or functions', () => {
    const fn = () => 42;
    const target = { keep: fn, nested: { a: 1, b: 2 }, arr: [{ x: 1 }, { x: 2 }] };
    const nestedRef = target.nested;
    const itemRef = target.arr[0];
    deepApply(target, { nested: { a: 9 }, arr: [{ x: 7 }] });
    expect(target.keep).toBe(fn);
    expect(target.nested).toBe(nestedRef);
    expect(target.nested).toEqual({ a: 9, b: 2 });
    expect(target.arr.length).toBe(1);
    expect(target.arr[0]).toBe(itemRef);
    expect(target.arr[0].x).toBe(7);
  });
});

describe('tune & difficulty', () => {
  it('TUNE is flat numbers (the tweakpane/debug contract)', () => {
    expect(Object.keys(TUNE).length).toBeGreaterThanOrEqual(30);
    for (const [k, v] of Object.entries(TUNE)) {
      expect(typeof v, `TUNE.${k}`).toBe('number');
    }
    expect(TUNE.gravity).toBe(26);
  });

  it('difficulty stages ascend', () => {
    for (let i = 1; i < DIFF_STAGES.length; i++) {
      expect(DIFF_STAGES[i].at).toBeGreaterThan(DIFF_STAGES[i - 1].at);
    }
  });
});

describe('floors', () => {
  it('is the 7-floor tower with parsed palettes and a cubicle color everywhere', () => {
    expect(FLOORS.length).toBe(7);
    expect(FLOORS[FLOORS.length - 1].isFinal).toBe(true);
    for (const f of FLOORS) {
      for (const [k, v] of Object.entries(f.palette)) {
        expect(typeof v, `${f.key}.palette.${k}`).toBe('number');
      }
      expect(typeof f.palette.cubicle, `${f.key} cubicle`).toBe('number');
    }
  });

  it('every spawn-table key and boss key exists', () => {
    for (const f of FLOORS) {
      for (const t of f.table) {
        expect(ENEMY_DEFS[t.key], `${f.key} table -> ${t.key}`).toBeTruthy();
      }
      for (const s of f.specials) {
        expect(ENEMY_DEFS[s], `${f.key} specials -> ${s}`).toBeTruthy();
      }
      expect(BOSS_DEFS[f.bossKey], `${f.key} boss -> ${f.bossKey}`).toBeTruthy();
      if (f.miniBossKey) expect(BOSS_DEFS[f.miniBossKey], `${f.key} mini -> ${f.miniBossKey}`).toBeTruthy();
    }
  });

  it('sandbox floor is well-formed and outside the rotation', () => {
    expect(SANDBOX_FLOOR.sandbox).toBe(true);
    expect(FLOORS).not.toContain(SANDBOX_FLOOR);
    expect(SANDBOX_FLOOR.size.length).toBe(2);
    expect(SANDBOX_FLOOR.dummies).toBeGreaterThan(0);
    for (const t of SANDBOX_FLOOR.table) expect(ENEMY_DEFS[t.key]).toBeTruthy();
  });
});

describe('enemies & bosses', () => {
  it('the crash-test dummy is harmless, stationary and worthless', () => {
    const d = ENEMY_DEFS.dummy;
    expect(d).toBeTruthy();
    expect(d.dmg).toBe(0);
    expect(d.speed).toBe(0);
    expect(d.xp).toBe(0);
    expect(d.money).toBe(0);
    expect(d.credit).toBe(0);
  });

  it('elite mods parsed their tints', () => {
    expect(typeof ELITE_MODS.overtime.tint).toBe('number');
    expect(typeof ELITE_MODS.synergy.tint).toBe('number');
  });

  it('bosses are projected into ENEMY_DEFS', () => {
    for (const [k, d] of Object.entries(BOSS_DEFS)) {
      const e = ENEMY_DEFS[k];
      expect(e, `projection of ${k}`).toBeTruthy();
      expect(e.boss).toBe(true);
      expect(e.hp).toBe(d.hp);
      expect(e.mini).toBe(!!d.mini);
      expect(typeof d.look.skin, `${k} look.skin`).toBe('number');
    }
  });
});

describe('gear', () => {
  it('rarity tiers have parsed colors and css strings', () => {
    expect(RARITY_TIERS.length).toBe(3);
    for (const t of RARITY_TIERS) {
      expect(typeof t.color).toBe('number');
      expect(t.css.startsWith('#')).toBe(true);
    }
  });

  it('wearables have unique ids and known slots', () => {
    const ids = new Set(WEARABLES.map((w) => w.id));
    expect(ids.size).toBe(WEARABLES.length);
    for (const w of WEARABLES) expect(GEAR_SLOTS).toContain(w.slot);
    expect(Object.keys(THROWABLES).length).toBe(3);
    expect(Object.keys(CONSUMABLES).length).toBe(3);
  });
});

describe('classes & modules', () => {
  it('classes.json applied onto every chassis', () => {
    expect(CLASSES.length).toBe(10);
    for (const c of CLASSES) {
      expect(typeof c.hp, `${c.key}.hp`).toBe('number');
      expect(typeof c.speed, `${c.key}.speed`).toBe('number');
      expect(typeof c.damage, `${c.key}.damage`).toBe('number');
      expect(typeof c.primary.fire, `${c.key} primary.fire survives`).toBe('function');
    }
    expect(CLASS_BY_KEY.intern.hp).toBe(115);
    expect(CLASS_BY_KEY.analyst.primary.charge).toBe(0.75);
  });

  it('dual-wield staplers fire one projectile from each weapon', () => {
    const spawned = [];
    const game = {
      projectiles: { spawn: (shot) => spawned.push(shot) },
      audio: { sfx: () => {} },
    };
    const player = {
      upgrades: new Map([['doublestapler', 1]]),
      stats: { damage: 13, flatDamage: 0, critChance: 0 },
    };
    const aim = {
      origin: new THREE.Vector3(),
      dir: new THREE.Vector3(0, 0, -1),
    };

    expect(CLASS_BY_KEY.intern.primary.fire(game, player, aim)).toBe(true);
    expect(spawned).toHaveLength(2);
    expect(spawned[0].vel.x * spawned[1].vel.x).toBeLessThan(0);
  });

  it('module tiers parsed and every passive has values', () => {
    expect(MODULE_TIERS.length).toBe(3);
    for (const t of MODULE_TIERS) expect(typeof t.color).toBe('number');
    for (const m of PASSIVE_MODULES) {
      expect(Object.keys(m.v).length, `${m.id}.v`).toBeGreaterThan(0);
      expect(typeof m.desc).toBe('function');
    }
  });
});

describe('waves', () => {
  it('lockdown and horde compositions reference real enemies', () => {
    expect(WAVES.lockdown.waves).toBeGreaterThan(0);
    expect(WAVES.horde.cap).toBeGreaterThan(0);
    for (const t of WAVES.horde.table) {
      expect(ENEMY_DEFS[t.key], `horde -> ${t.key}`).toBeTruthy();
      if (t.highAt != null) {
        expect(typeof t.wLow).toBe('number');
        expect(typeof t.wHigh).toBe('number');
      } else {
        expect(typeof t.w).toBe('number');
      }
    }
  });
});
