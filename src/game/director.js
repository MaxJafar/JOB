// ============ THE DIRECTOR ============
// Left 4 Dead-style pacing engine layered on Risk of Rain difficulty scaling.
// Tracks player stress (intensity), cycles RELAX → BUILDUP → PEAK → FADE,
// spends spawn credits on mobs, meters out specials, and calls hordes.
import { TUNE, DIFF_STAGES, ANNOUNCER } from './config.js';
import { ENEMY_DEFS, ELITE_MODS } from './enemies.js';
import { weightedChoose, rand, chance, choose, clamp, dist2D } from '../core/utils.js';
import { DirectorObservations, PressureModel } from '../ai/pressure.js';

export class Director {
  constructor(game) {
    this.game = game;
    // Director 2.0: the pacing state machine below is unchanged and still tuned,
    // but what it SPENDS is now derived from a measured pressure signal rather
    // than from the clock alone. See src/ai/pressure.js.
    this.obs = new DirectorObservations();
    this.model = new PressureModel();
    this.signals = this.model.outputs;
    this.resetFloor(0);
    this.lastStageIdx = 0;
  }

  resetFloor(floorIndex) {
    this.obs?.reset();
    this.model?.reset();
    // Sawtooth protection (D 1.2). Difficulty is a function of elapsed time, so
    // without this a power spike is instantly eaten by the curve that was going
    // to arrive anyway and the player never gets to FEEL stronger. Time spent
    // under grace is subtracted from the difficulty clock — the run keeps
    // ticking, the pressure does not.
    this.spikeGraceT = 0;
    if (floorIndex === 0) this.diffFrozen = 0;   // run-scoped, like game.runTime
    this.floorIndex = floorIndex;
    this.credits = 8;
    this.spawnTimer = 2;
    this.intensity = 0;
    this.lastStressT = 0;
    this.pacing = 'BUILDUP';
    this.pacingT = 0;
    this.pacingDur = 20;
    this.hordeQueue = [];
    this.hordeTickT = 0;
    this.eventMode = false;
    this.eventHordeT = 0;
    this.auditorSpawned = false;
    this.floorEventFired = false;
    this.floorTime = 0;
    this.specials = {
      gossip: { nextAt: 45, cap: 1, cd: 42, minDiff: 1.15 },
      complainer: { nextAt: 30, cap: 2, cd: 30, minDiff: 1.05 },
      micromanager: { nextAt: 60, cap: 1, cd: 48, minDiff: 1.3 },
    };
  }

  // Risk of Rain style difficulty coefficient
  get coeff() {
    const g = this.game;
    const t = Math.max(0, g.runTime - (this.diffFrozen ?? 0));
    return (1 + (t / 60) * TUNE.diffPerMinute)
      * (1 + this.floorIndex * TUNE.diffPerFloor)
      * (1 + g.loopCount * TUNE.diffPerLoop);
  }

  /**
   * Hold the difficulty curve for `secs` after a power spike — a module pickup
   * or a draft — so the spike is tasted before the tower answers it. Grace
   * never stacks; it extends.
   */
  grantSpikeGrace(secs = 20) {
    this.spikeGraceT = Math.max(this.spikeGraceT ?? 0, secs);
  }

  /** Bank the time the difficulty curve is not allowed to spend. */
  tickSpikeGrace(dt) {
    if (this.spikeGraceT <= 0) return;
    // only bank the part of dt that is actually still under grace, or a huge
    // frame at the tail end would freeze more time than was ever granted
    const used = Math.min(dt, this.spikeGraceT);
    this.spikeGraceT -= dt;
    this.diffFrozen = (this.diffFrozen ?? 0) + used;
  }

  get stage() {
    let s = DIFF_STAGES[0];
    for (const st of DIFF_STAGES) if (this.coeff >= st.at) s = st;
    return s;
  }

  hpMult() { return 1 + (this.coeff - 1) * TUNE.enemyHpScale; }
  dmgMult() { return 1 + (this.coeff - 1) * TUNE.enemyDmgScale; }
  moneyMult() { return 1 + (this.coeff - 1) * TUNE.moneyScale; }

  onPlayerDamaged(amount) {
    this.intensity = clamp(this.intensity + amount * 0.9, 0, 100);
    this.lastStressT = this.game.runTime;
    this.obs.onDamage(amount);
  }
  onKillNear(pos) {
    this.obs.onKill();
    const p = this.game.player;
    if (p && dist2D(p.pos, pos) < 11) {
      this.intensity = clamp(this.intensity + 3.2, 0, 100);
      this.lastStressT = this.game.runTime;
    }
  }
  onPlayerDeath() { this.obs.onDeath(); }
  onGossipPop(targets) {
    this.game.hud.announce('THE GOSSIP SPREAD THE WORD', 2, true);
    this.game.audio.sfx('horde');
    this.queueHorde(Math.round(7 + this.coeff * 3), targets);
  }

  queueHorde(n, _targets) {
    n = Math.min(n, 26);
    const table = [
      { key: 'paperling', w: 6 },
      { key: 'drone', w: 3 },
      { key: 'roomba', w: this.coeff > 1.8 ? 1.5 : 0.4 },
    ];
    for (let i = 0; i < n; i++) this.hordeQueue.push(weightedChoose(table).key);
  }

  triggerAlarmHorde(pos) {
    this.game.hud.announce(choose(ANNOUNCER.hordeLines), 2.4, true);
    this.game.audio.sfx('alarm');
    this.game.audio.sfx('horde');
    this.queueHorde(Math.round(9 + this.coeff * 3.5));
    this.intensity = clamp(this.intensity + 15, 0, 100);
  }

  setEventMode(on) {
    this.eventMode = on;
    this.eventHordeT = 4;
    if (on) this.pacing = 'PEAK';
  }

  aliveCount() {
    let n = 0;
    for (const e of this.game.enemies) if (!e.dead && !e.def.boss) n++;
    return n;
  }

  aliveOf(key) {
    let n = 0;
    for (const e of this.game.enemies) if (!e.dead && e.key === key) n++;
    return n;
  }

  pacingMult() {
    if (this.eventMode) return 2.3;
    switch (this.pacing) {
      case 'RELAX': return 0.22;
      case 'BUILDUP': return 1.0;
      case 'PEAK': return 1.75;
      case 'FADE': return 0.35;
    }
    return 1;
  }

  update(dt) {
    const game = this.game;
    this.floorTime += dt;

    this.tickSpikeGrace(dt);

    // ---- observe → pressure → outputs (Director 2.0) ----
    this.obs.sample(game, dt);
    this.signals = this.model.update(this.obs, dt, {
      table: game.floorDef?.table ?? [],
      pacing: this.pacing,
      coeff: this.coeff,
    });
    // Fatigue override: a player held at high pressure stops registering it, so
    // force the relief valley rather than waiting for the pacing timer.
    if (this.signals.wantRelief && this.pacing !== 'RELAX' && !this.eventMode && !game.lockdown) {
      this.setPacing('RELAX', this.signals.restDuration);
      this.model.fatigue = 0.35;
    }

    // ---- intensity decay after a calm spell ----
    if (game.runTime - this.lastStressT > 3.2) {
      this.intensity = Math.max(0, this.intensity - 8 * dt);
    }

    // ---- pacing state machine (suspended during boss fights) ----
    const bossActive = game.activeBoss && !game.activeBoss.dead;
    if (!this.eventMode && !bossActive) {
      this.pacingT += dt;
      switch (this.pacing) {
        case 'RELAX':
          if (this.pacingT > this.pacingDur) this.setPacing('BUILDUP', 30);
          break;
        case 'BUILDUP':
          if (this.intensity > 55 || this.pacingT > this.pacingDur) this.setPacing('PEAK', 22);
          break;
        case 'PEAK':
          if ((this.pacingT > 6 && this.intensity > 90) || this.pacingT > this.pacingDur) this.setPacing('FADE', 12);
          if (this.pacingT > 3 && chance(dt * 0.02)) {
            // occasional spontaneous conference call at peak stress
            this.triggerAlarmHorde(null);
            this.setPacing('FADE', 10);
          }
          // rare floor-wide chaos events, once per floor, only after things heat up
          if (!this.floorEventFired && this.floorTime > 55 && this.coeff > 1.3 && chance(dt * 0.025)) {
            this.floorEventFired = true;
            game.startFloorEvent(chance(0.5) ? 'lightsout' : 'firedrill');
          }
          break;
        case 'FADE':
          if (this.alivedropped === undefined) this.alivedropped = 0;
          if (this.aliveCount() < 6 || this.pacingT > this.pacingDur) {
            const relaxLen = rand(7, 13) * clamp(1.5 - this.coeff * 0.1, 0.45, 1);
            this.setPacing('RELAX', relaxLen);
          }
          break;
      }
    }

    // ---- difficulty stage announcements ----
    const stageIdx = DIFF_STAGES.indexOf(this.stage);
    if (stageIdx > this.lastStageIdx) {
      this.lastStageIdx = stageIdx;
      game.hud.announce(`☠ ${this.stage.label}`, 2.6, true);
      game.audio.sfx('alarm', { vol: 0.6 });
    }

    // ---- credit income & spending ----
    // during an arena lockdown the scripted waves own ALL spawning
    const lockdownMute = game.lockdown ? 0 : 1;
    const mult = this.pacingMult() * (bossActive && !this.eventMode ? 0.15 : 1) * (game.floorBuff?.dirMult ?? 1) * lockdownMute;
    this.credits += dt * (1.5 + 0.9 * this.coeff) * mult;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && !game.lockdown) {
      this.spawnTimer = rand(1.1, 2.2) / Math.max(0.4, mult);
      this.trySpawnBatch();
    }

    // ---- specials ----
    if (!bossActive || this.eventMode) this.updateSpecials();

    // ---- auditor (tank) window ----
    if (!this.auditorSpawned && this.floorIndex >= 1 && !bossActive) {
      const ready = (this.floorTime > 130 && this.coeff > 2.0) || (this.eventMode && this.coeff > 2.6);
      if (ready && chance(dt * 0.02)) this.spawnAuditor();
    }

    // ---- event-mode periodic hordes ----
    if (this.eventMode) {
      this.eventHordeT -= dt;
      if (this.eventHordeT <= 0) {
        this.eventHordeT = rand(16, 24);
        this.queueHorde(Math.round(6 + this.coeff * 2.5));
        game.hud.announce(choose(ANNOUNCER.hordeLines), 2, true);
        game.audio.sfx('horde', { vol: 0.7 });
      }
    }

    // ---- stream horde spawns ----
    this.hordeTickT -= dt;
    if (this.hordeQueue.length && this.hordeTickT <= 0) {
      this.hordeTickT = 0.22;
      if (this.aliveCount() < TUNE.hordeCap) {
        const key = this.hordeQueue.shift();
        const p = this.pickSpawnPos();
        if (p) {
          const e = game.spawnEnemy(key, p, this.rollElite(key));
          if (e) e.isHorde = true;
        }
      }
    }
  }

  setPacing(state, dur) {
    this.pacing = state;
    this.pacingT = 0;
    this.pacingDur = dur;
  }

  pickSpawnPos() {
    const game = this.game;
    const p = game.player;
    if (!p) return null;
    const viewDir = { x: Math.sin(p.yaw), z: Math.cos(p.yaw) };
    // during an arena lockdown everything must materialize INSIDE the seal
    const onlyRoom = game.lockdown ? game.level.arenaRoom : null;
    return game.level.findSpawnPoint(p.pos, onlyRoom ? 7 : 13, 27, viewDir, onlyRoom);
  }

  rollElite(key) {
    const def = ENEMY_DEFS[key];
    if (def.special || def.rare) return {};
    const p = clamp((this.coeff - 1.55) * 0.09, 0, 0.32);
    if (!chance(p)) return {};
    const elite = chance(0.5) ? 'overtime' : 'synergy';
    return { elite };
  }

  trySpawnBatch() {
    const game = this.game;
    // Composition-first: the pressure model sets how much the floor may HOLD,
    // the pacing multiplier still sets how fast it fills, TUNE.maxAlive is the
    // hard ceiling.
    const cap = Math.min(
      TUNE.maxAlive,
      Math.round(this.signals.spawnBudget * clamp(this.pacingMult(), 0.55, 1.75)),
    );
    let spawned = 0;
    const allowed = this.signals.allowedEnemies;
    const table = game.floorDef.table
      .filter((t) => (allowed.length ? allowed.includes(t.key) : (!t.minDiff || this.coeff >= t.minDiff)))
      .map((t) => ({ ...t, cost: ENEMY_DEFS[t.key].credit }));
    if (!table.length) return;
    const cheapest = Math.min(...table.map((t) => t.cost));
    while (this.credits >= cheapest && spawned < 5 && this.aliveCount() < cap) {
      const affordable = table.filter((t) => t.cost <= this.credits);
      if (!affordable.length) break;
      const pick = weightedChoose(affordable);
      const eliteRoll = this.rollElite(pick.key);
      const costMult = eliteRoll.elite ? ELITE_MODS[eliteRoll.elite].costMult : 1;
      if (pick.cost * costMult > this.credits) { this.credits -= 0.5; break; }
      const pos = this.pickSpawnPos();
      if (!pos) break;
      this.credits -= pick.cost * costMult;
      game.spawnEnemy(pick.key, pos, eliteRoll);
      spawned++;
    }
  }

  updateSpecials() {
    const game = this.game;
    const t = game.runTime;
    for (const [key, s] of Object.entries(this.specials)) {
      if (t < s.nextAt || this.coeff < s.minDiff) continue;
      if (this.aliveOf(key) >= s.cap) continue;
      if (this.pacing === 'RELAX' && !this.eventMode) continue;
      // pressure model gets a veto: no piling a special onto someone already
      // drowning, and no special at all during a forced relief valley
      if (this.signals.specialChance <= 0.01) continue;
      if (!this.eventMode && !chance(clamp(this.signals.specialChance * 4, 0.15, 1))) continue;
      s.nextAt = t + s.cd * rand(0.8, 1.25) * (this.eventMode ? 0.55 : 1);
      const pos = this.pickSpawnPos();
      if (!pos) continue;
      game.spawnEnemy(key, pos, {});
      // audio tell, L4D style — you HEAR the special before you see it
      if (key === 'gossip') game.audio.sfx('phone', { vol: 1.1 });
      if (key === 'complainer') game.audio.sfx('spit', { vol: 0.9 });
      if (key === 'micromanager') game.audio.sfx('pounce', { vol: 0.5 });
    }
  }

  spawnAuditor() {
    const game = this.game;
    this.auditorSpawned = true;
    const pos = this.pickSpawnPos();
    if (!pos) return;
    const a = game.spawnEnemy('auditor', pos, {});
    if (a) {
      game.hud.announce(ANNOUNCER.auditorLine, 3, true);
      game.audio.sfx('roar');
      game.shake(0.5);
    }
  }

  spawnKarenIfAny() {
    const game = this.game;
    if (game.level.karenSpot) {
      game.spawnEnemy('karen', game.level.karenSpot, {});
    }
  }
}
