// ============ Director observation model ============
// The difference between "spawn rate goes up over time" and a Director that
// makes the game breathe is that a Director OBSERVES before it decides.
//
//   observe  →  pressure  →  outputs
//
// Observations (what is actually happening to the player right now):
//   health, damage received recently, ammo, recent kills, time since combat,
//   enemy population, elite population, room type, player speed, team
//   separation, recent deaths, difficulty coefficient, run duration
//
// Outputs (what the spawner is allowed to do about it):
//   pressure, spawnBudget, allowedEnemies, specialChance, lootGenerosity,
//   restDuration, ambushChance
//
// The pacing cycle stays where it was — BUILDUP → ATTACK → PEAK → RELIEF — but
// it is now driven by a measured pressure signal instead of a timer alone.
//
// The key insight from L4D that a naive implementation misses: the Director's
// job is not to maximise difficulty, it is to maximise the DERIVATIVE. A player
// held at constant high pressure stops feeling it within ninety seconds.

import { clamp } from '../core/utils.js';

/** Rolling window, in seconds, for "recent" anything. */
const WINDOW = 12;

export class DirectorObservations {
  constructor() {
    this.reset();
  }

  reset() {
    this.hpFrac = 1;
    this.hpLow = 1;              // worst HP seen in the window — near-death memory
    this.damageTaken = 0;        // in the window
    this.ammoFrac = 1;
    this.kills = 0;              // in the window
    this.timeSinceCombat = 0;
    this.timeSinceDamage = 99;
    this.enemyCount = 0;
    this.eliteCount = 0;
    this.specialCount = 0;
    this.roomType = 'corridor';
    this.roomArea = 200;
    this.playerSpeed = 0;
    this.teamSpread = 0;
    this.downedTeammates = 0;
    this.recentDeaths = 0;
    this.difficulty = 1;
    this.runTime = 0;
    this.floorTime = 0;
    this._decay = 0;
  }

  /** @param {import('../game/game.js').Game} game */
  sample(game, dt) {
    const p = game.player;
    this.runTime = game.runTime;
    this.difficulty = game.director?.coeff ?? 1;

    if (p && !p.dead) {
      this.hpFrac = clamp(p.hp / Math.max(1, p.stats.maxHp), 0, 1);
      this.hpLow = Math.min(this.hpLow, this.hpFrac);
      const mag = p.classDef?.primary?.mag;
      this.ammoFrac = mag ? clamp(p.ammo / mag, 0, 1) : 1;
      this.playerSpeed = p.motor?.speed ?? 0;
    }

    this.timeSinceDamage += dt;
    this.timeSinceCombat += dt;

    let alive = 0, elites = 0, specials = 0;
    for (const e of game.enemies) {
      if (e.dead || e.def?.boss) continue;
      alive++;
      if (e.elite) elites++;
      if (e.def?.special) specials++;
    }
    this.enemyCount = alive;
    this.eliteCount = elites;
    this.specialCount = specials;

    const room = game.currentRoom;
    this.roomType = room?.type ?? 'corridor';
    this.roomArea = room ? Math.abs((room.x1 - room.x0) * (room.z1 - room.z0)) : 200;

    // co-op: separation is a first-class pacing input. A split team is a team
    // that can be picked apart, so the Director should ease off — or lean in.
    const team = game.livePlayers();
    if (team.length > 1) {
      let maxD = 0;
      for (let i = 0; i < team.length; i++) {
        for (let j = i + 1; j < team.length; j++) {
          const dx = team[i].pos.x - team[j].pos.x;
          const dz = team[i].pos.z - team[j].pos.z;
          maxD = Math.max(maxD, Math.hypot(dx, dz));
        }
      }
      this.teamSpread = maxD;
    } else this.teamSpread = 0;

    // decay the rolling window
    this._decay += dt;
    if (this._decay >= 1) {
      const k = this._decay / WINDOW;
      this.damageTaken *= Math.max(0, 1 - k);
      this.kills *= Math.max(0, 1 - k);
      this.recentDeaths *= Math.max(0, 1 - k * 0.5);
      this.hpLow += (this.hpFrac - this.hpLow) * Math.min(1, k * 0.7);
      this._decay = 0;
    }
  }

  onDamage(amount) {
    this.damageTaken += amount;
    this.timeSinceDamage = 0;
    this.timeSinceCombat = 0;
  }

  onKill() {
    this.kills++;
    this.timeSinceCombat = 0;
  }

  onDeath() { this.recentDeaths++; }
}

/**
 * Turn observations into the numbers the spawner acts on.
 * Everything is bounded and explainable — a Director you cannot debug is a
 * Director you cannot tune.
 */
export class PressureModel {
  constructor() {
    this.pressure = 0;        // 0..1 — how hard the player is being pressed NOW
    this.fatigue = 0;         // 0..1 — how long they have been pressed
    this.outputs = {
      pressure: 0,
      spawnBudget: 0,
      allowedEnemies: [],
      specialChance: 0,
      lootGenerosity: 1,
      restDuration: 10,
      ambushChance: 0,
      wantRelief: false,
    };
  }

  /**
   * @param {DirectorObservations} obs
   * @param {number} dt
   * @param {{table: Array<{key: string, minDiff?: number}>, pacing: string, coeff: number}} ctx
   */
  update(obs, dt, ctx) {
    // ---- pressure: what is happening TO the player ----
    const hpTerm = (1 - obs.hpFrac) * 0.42;
    const dmgTerm = clamp(obs.damageTaken / 90, 0, 1) * 0.24;
    const crowdTerm = clamp(obs.enemyCount / 26, 0, 1) * 0.18;
    const eliteTerm = clamp((obs.eliteCount * 2 + obs.specialCount) / 5, 0, 1) * 0.12;
    const ammoTerm = (1 - obs.ammoFrac) * 0.06;
    const splitTerm = clamp(obs.teamSpread / 40, 0, 1) * 0.08;
    const raw = hpTerm + dmgTerm + crowdTerm + eliteTerm + ammoTerm + splitTerm;

    // asymmetric smoothing: pressure spikes fast and bleeds off slowly, which is
    // how it actually feels to be ambushed and then survive
    const rate = raw > this.pressure ? 3.2 : 0.55;
    this.pressure += (raw - this.pressure) * Math.min(1, rate * dt);
    this.pressure = clamp(this.pressure, 0, 1);

    // fatigue: sustained pressure stops registering, so track it separately and
    // force relief before the player goes numb (D 1.3 rest valleys)
    if (this.pressure > 0.55) this.fatigue = clamp(this.fatigue + dt / 45, 0, 1);
    else this.fatigue = clamp(this.fatigue - dt / 25, 0, 1);

    const o = this.outputs;
    o.pressure = +this.pressure.toFixed(3);
    o.wantRelief = this.fatigue > 0.8 || (this.pressure > 0.85 && obs.hpFrac < 0.3);

    // ---- spawn budget: the POPULATION cap, inverse of pressure ----
    // Deliberately NOT multiplied by the pacing scale. Pacing already throttles
    // spawn *rate* through credit income and the spawn timer; applying it here
    // as well compounds, and a RELAX phase ends up refusing to spawn at all.
    // Rate and population are separate levers and must stay that way.
    const relief = o.wantRelief ? 0.45 : 1;
    const headroom = 1 - this.pressure * 0.5;
    o.spawnBudget = Math.round(clamp((9 + ctx.coeff * 7) * headroom * relief, 6, 60));

    // ---- composition BEFORE numbers (D 1.4: cap HP multipliers, vary the mix)
    o.allowedEnemies = (ctx.table ?? [])
      .filter((t) => !t.minDiff || ctx.coeff >= t.minDiff)
      .map((t) => t.key);

    // ---- specials: gate on breathing room, not just a timer ----
    const calm = clamp(obs.timeSinceDamage / 8, 0, 1);
    o.specialChance = clamp(
      0.06 + ctx.coeff * 0.04 + calm * 0.08 - this.pressure * 0.1,
      0, 0.35,
    ) * (o.wantRelief ? 0.15 : 1);

    // ---- loot: pay out when they are struggling, not when they are cruising.
    // This is the anti-death-spiral valve.
    o.lootGenerosity = +clamp(
      1 + (1 - obs.hpLow) * 0.5 + clamp(obs.recentDeaths, 0, 2) * 0.25 - (obs.hpFrac > 0.9 ? 0.15 : 0),
      0.8, 2,
    ).toFixed(2);

    // ---- rest: longer when they have earned it ----
    o.restDuration = +clamp(
      7 + this.fatigue * 14 + (1 - obs.hpFrac) * 6 - ctx.coeff * 0.9,
      4, 26,
    ).toFixed(1);

    // ---- ambush: only when they are calm, comfortable and in a big room.
    // Ambushing a player at 15% HP in a corridor is not tension, it is a cheap
    // shot, and it is where "that felt unfair" comes from.
    const roomOk = obs.roomType === 'bullpen' || obs.roomType === 'arena' || obs.roomArea > 260;
    o.ambushChance = (roomOk && obs.hpFrac > 0.6 && this.pressure < 0.3 && obs.timeSinceCombat > 6)
      ? clamp(0.05 + obs.timeSinceCombat * 0.01, 0, 0.25)
      : 0;

    return o;
  }

  _pacingScale(pacing) {
    switch (pacing) {
      case 'RELAX': return 0.22;
      case 'BUILDUP': return 1.0;
      case 'PEAK': return 1.75;
      case 'FADE': return 0.35;
      default: return 1;
    }
  }

  reset() {
    this.pressure = 0;
    this.fatigue = 0;
  }

  /** Human-readable dump for the debug panel — a Director you can watch. */
  explain(obs) {
    return {
      pressure: +this.pressure.toFixed(2),
      fatigue: +this.fatigue.toFixed(2),
      hp: +obs.hpFrac.toFixed(2),
      dmgWindow: Math.round(obs.damageTaken),
      enemies: obs.enemyCount,
      elites: obs.eliteCount,
      specials: obs.specialCount,
      room: obs.roomType,
      spread: Math.round(obs.teamSpread),
      ...this.outputs,
      allowedEnemies: this.outputs.allowedEnemies.join(','),
    };
  }
}
