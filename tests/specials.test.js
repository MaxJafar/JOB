import { describe, it, expect } from 'vitest';
import { ENEMY_DEFS } from '../src/game/enemies.js';
import { FLOORS } from '../src/game/config.js';

// v0.38 STAFF REBRAND. These lock in the DESIGN, not just the numbers: the
// three specials that used to be 1:1 L4D ports must stay counter-playable in
// the specific way each rework promises, and the borrowed mechanics must stay
// gone. A regression here means a special quietly became a Jockey again.

const specials = ['gossip', 'complainer', 'micromanager', 'motivator', 'mediator', 'sysadmin', 'streamer'];

describe('the specials are no longer L4D ports', () => {
  it('no enemy uses a borrowed AI kernel', () => {
    const banned = new Set(['jockey', 'spitter']);
    for (const [key, def] of Object.entries(ENEMY_DEFS)) {
      expect(banned.has(def.ai), `${key} still runs the '${def.ai}' AI`).toBe(false);
    }
  });

  it('THE GOSSIP is an interruptible broadcast, not a contact explosion', () => {
    const g = ENEMY_DEFS.gossip;
    expect(g.ai).toBe('rumor');
    // the whole counterplay is that the cast takes long enough to answer
    expect(g.castTime).toBeGreaterThanOrEqual(3);
    expect(g.castRange).toBeGreaterThan(6);      // she never walks into you
    expect(g.rumorRadius).toBeGreaterThan(0);
    expect(g.popRange, 'contact-pop range must be gone').toBeUndefined();
  });

  it('THE COMPLAINER files destructible tickets instead of spitting acid', () => {
    const c = ENEMY_DEFS.complainer;
    expect(c.ai).toBe('ticketer');
    expect(c.ticketRadius).toBeGreaterThan(0);
    expect(c.ticketTtl).toBeGreaterThan(0);
    // a hard cap is what keeps zone denial from becoming zone removal
    expect(c.ticketCap).toBeGreaterThanOrEqual(1);
    expect(c.ticketCap).toBeLessThanOrEqual(4);
  });

  it('THE MICROMANAGER books a beatable countdown instead of riding you', () => {
    const m = ENEMY_DEFS.micromanager;
    expect(m.ai).toBe('scheduler');
    expect(m.scheduleTime).toBeGreaterThanOrEqual(2);   // time to break line of sight
    // he must be able to lose you: the cancel range has to exceed his reach
    expect(m.cancelRange).toBeGreaterThan(m.scheduleRange);
    // and the punishment is a moment, not a sentence
    expect(m.bookTime).toBeLessThanOrEqual(2);
  });

  it('KAREN is provoked by being filmed, on a timer you can leave', () => {
    const k = ENEMY_DEFS.karen;
    expect(k.filmRange).toBeGreaterThan(0);
    expect(k.filmTime).toBeGreaterThan(1);
  });

  it('THE AUDITOR escalates through findings, with a cap', () => {
    const a = ENEMY_DEFS.auditor;
    expect(a.demandEvery).toBeGreaterThan(0);
    expect(a.demandKills).toBeGreaterThan(0);
    expect(a.maxFindings).toBeGreaterThan(0);
    expect(a.maxFindings).toBeLessThanOrEqual(6);   // a hard ceiling, per D 1.4
    expect(a.findingDmg).toBeGreaterThan(0);
  });

  it('basic mobs got behaviour of their own', () => {
    // paperlings scatter in bursts; drones stop to read their phone
    expect(ENEMY_DEFS.paperling.burst.run).toBeGreaterThan(0);
    expect(ENEMY_DEFS.paperling.burst.boost).toBeGreaterThan(1);
    expect(ENEMY_DEFS.drone.lull.dur).toBeGreaterThan(0);
    expect(ENEMY_DEFS.drone.lull.every).toBeGreaterThan(ENEMY_DEFS.drone.lull.dur);
  });

  it('every special still has an AI implementation and stays spawnable', () => {
    for (const key of specials) {
      const def = ENEMY_DEFS[key];
      expect(def, key).toBeTruthy();
      expect(def.special, `${key} must stay flagged special`).toBe(true);
      expect(typeof def.ai).toBe('string');
    }
    // and the floors still reference only specials that exist
    for (const f of FLOORS) {
      for (const s of f.specials) expect(ENEMY_DEFS[s], `${f.key} -> ${s}`).toBeTruthy();
    }
  });
});
