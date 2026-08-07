// ============ local run telemetry ============
// ROADMAP v0.2 FOUNDATIONS: "Local telemetry from day one — per-run JSON log:
// class, drafts offered/taken, per-floor time, death cause+position, combo
// peaks, KPIs. Ship-ready for opt-in upload later."
//
// Everything stays on the machine (localStorage + manual export). There is no
// network call in this file and there should not be one until there is a real
// consent flow; the balance questions this answers do not need a server:
//   * which archetype is picked, and which actually survives   (D 3.5 gate)
//   * where runs end, and to what                              (D 8.2 recap)
//   * which drafts are offered vs taken                        (module pick-rate)
//   * how long a floor takes vs the 8-12 min budget            (D 2.5 gate)

const STORE_KEY = 'job.telemetry.v1';
const MAX_RUNS = 200;

export class Telemetry {
  constructor({ enabled = true } = {}) {
    this.enabled = enabled;
    this.run = null;
    this.sessionId = randomId();
  }

  // ---------- run lifecycle ----------

  startRun({ classKey, seed, loop = 0, coop = false, players = 1 }) {
    if (!this.enabled) return;
    this.run = {
      id: randomId(),
      session: this.sessionId,
      startedAt: new Date().toISOString(),
      version: __APP_VERSION__,
      classKey, seed, loop, coop, players,
      floors: [],
      drafts: [],
      items: [],
      kpis: [],
      events: [],
      combo: { best: 0, bestAt: 0 },
      damage: { dealt: 0, taken: 0, crits: 0 },
      kills: 0,
      perf: { samples: 0, avgMs: 0, worstMs: 0 },
      outcome: null,
    };
    this._floorStart = 0;
  }

  floorEntered(index, key, runTime) {
    if (!this.run) return;
    const prev = this.run.floors[this.run.floors.length - 1];
    if (prev && prev.exitedAt == null) {
      prev.exitedAt = runTime;
      prev.duration = +(runTime - prev.enteredAt).toFixed(2);
    }
    this.run.floors.push({
      index, key,
      enteredAt: +runTime.toFixed(2),
      exitedAt: null, duration: null,
      kills: 0, budgetEarned: 0, deaths: 0,
    });
  }

  /** @param {{offered: string[], taken: string|null, level: number}} d */
  draft(d) {
    if (!this.run) return;
    this.run.drafts.push(d);
  }

  itemPicked(id, rarity, runTime) {
    if (!this.run) return;
    this.run.items.push({ id, rarity, at: +runTime.toFixed(2) });
  }

  kill(runTime, enemyKey, elite) {
    if (!this.run) return;
    this.run.kills++;
    const f = this.run.floors[this.run.floors.length - 1];
    if (f) f.kills++;
    if (elite) this.event('elite_kill', { enemyKey }, runTime);
  }

  damageDealt(n, crit) {
    if (!this.run) return;
    this.run.damage.dealt += n;
    if (crit) this.run.damage.crits++;
  }

  damageTaken(n) {
    if (!this.run) return;
    this.run.damage.taken += n;
  }

  combo(count, runTime) {
    if (!this.run || count <= this.run.combo.best) return;
    this.run.combo.best = count;
    this.run.combo.bestAt = +runTime.toFixed(2);
  }

  kpi(name, completed, runTime) {
    if (!this.run) return;
    this.run.kpis.push({ name, completed, at: +runTime.toFixed(2) });
  }

  /** Death recap data — the single most actionable balance signal we collect. */
  death({ cause, enemyKey, pos, floorIndex, hpBefore, difficulty }, runTime) {
    if (!this.run) return;
    const f = this.run.floors[this.run.floors.length - 1];
    if (f) f.deaths++;
    this.event('death', {
      cause, enemyKey, floorIndex, hpBefore,
      difficulty: +(difficulty ?? 0).toFixed(2),
      pos: pos ? [+pos.x.toFixed(1), +pos.y.toFixed(1), +pos.z.toFixed(1)] : null,
    }, runTime);
  }

  event(kind, data, runTime = 0) {
    if (!this.run) return;
    if (this.run.events.length > 800) return; // keep a run log bounded
    this.run.events.push({ kind, at: +runTime.toFixed(2), ...data });
  }

  perfSample(avgMs, worstMs) {
    if (!this.run) return;
    const p = this.run.perf;
    p.samples++;
    p.avgMs = +(p.avgMs + (avgMs - p.avgMs) / p.samples).toFixed(3);
    p.worstMs = Math.max(p.worstMs, +worstMs.toFixed(2));
  }

  /** @param {'won'|'died'|'abandoned'} outcome */
  endRun(outcome, runTime, extra = {}) {
    if (!this.run) return null;
    const f = this.run.floors[this.run.floors.length - 1];
    if (f && f.exitedAt == null) {
      f.exitedAt = runTime;
      f.duration = +(runTime - f.enteredAt).toFixed(2);
    }
    this.run.outcome = outcome;
    this.run.durationSec = +runTime.toFixed(2);
    this.run.endedAt = new Date().toISOString();
    Object.assign(this.run, extra);
    const done = this.run;
    this._persist(done);
    this.run = null;
    return done;
  }

  // ---------- storage & export ----------

  _persist(run) {
    try {
      const all = this.history();
      all.push(run);
      while (all.length > MAX_RUNS) all.shift();
      localStorage.setItem(STORE_KEY, JSON.stringify(all));
    } catch (err) {
      console.warn('[telemetry] persist failed:', err?.message ?? err);
    }
  }

  /** @returns {Array<any>} */
  history() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  clear() {
    try { localStorage.removeItem(STORE_KEY); } catch { /* private mode */ }
  }

  /** Aggregate view — what the balance gates in the roadmap actually ask for. */
  summary() {
    const runs = this.history();
    if (!runs.length) return { runs: 0 };
    const byClass = {};
    const deathsBy = {};
    let wins = 0, totalSec = 0;
    for (const r of runs) {
      byClass[r.classKey] = (byClass[r.classKey] ?? 0) + 1;
      if (r.outcome === 'won') wins++;
      totalSec += r.durationSec ?? 0;
      for (const e of r.events ?? []) {
        if (e.kind !== 'death') continue;
        const k = e.enemyKey ?? e.cause ?? 'unknown';
        deathsBy[k] = (deathsBy[k] ?? 0) + 1;
      }
    }
    const reachedFloor2 = runs.filter((r) => (r.floors?.length ?? 0) >= 2).length;
    return {
      runs: runs.length,
      winRate: +(wins / runs.length).toFixed(3),
      avgRunMin: +(totalSec / runs.length / 60).toFixed(1),
      // D 7.3 funnel targets: 60% reach floor 2, 25% ever beat the CEO
      floor2Rate: +(reachedFloor2 / runs.length).toFixed(3),
      pickRate: Object.fromEntries(
        Object.entries(byClass).map(([k, v]) => [k, +(v / runs.length).toFixed(3)]),
      ),
      deathsBy,
    };
  }

  /** Download the full log as JSON — the manual "upload" until consent exists. */
  export() {
    const blob = new Blob([JSON.stringify({
      exportedAt: new Date().toISOString(),
      summary: this.summary(),
      runs: this.history(),
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `job-telemetry-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

function randomId() {
  return (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)).slice(0, 8);
}
