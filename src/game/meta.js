// ============ persistent meta-progression (localStorage) ============
// Rogue-LITE: you keep Severance between runs and buy permanent perks.

const KEY = 'job_meta_v1';

export const PERKS = [
  { id: 'vitality', icon: '❤️', name: 'DENTAL PLAN', desc: '+6% max HP per level', max: 5 },
  { id: 'hustle', icon: '💪', name: 'SIDE HUSTLE', desc: '+4% damage per level', max: 5 },
  { id: 'cardio', icon: '🏃', name: 'STANDING DESK', desc: '+3% move speed per level', max: 5 },
  { id: 'income', icon: '💰', name: 'DIRECT DEPOSIT', desc: '+8% money gain per level', max: 5 },
  { id: 'wellness', icon: '🧘', name: 'WELLNESS STIPEND', desc: '+0.4 HP/s regen per level', max: 5 },
];

export function perkCost(lvl) { return Math.round(40 * Math.pow(1.7, lvl)); }

export class Meta {
  constructor() {
    this.data = {
      severance: 0,
      perks: {},
      stats: { runs: 0, wins: 0, bestFloor: 0, kills: 0 },
    };
    this.settings = {
      sensitivity: 1.0,
      invertY: false,
      fov: 75,
      volMaster: 0.8,
      volSfx: 0.8,
      volMusic: 0.4,
      playerName: 'WAGE_SLAVE',
      // ---- engine ----
      postfx: 'high',      // 'off' | 'low' | 'high' — bloom/vignette/tone-map stack
      fixedStep: true,     // pin the sim to 60 Hz so feel is framerate-independent
      telemetry: true,     // local-only run log (never uploaded)
      physicsDebris: true, // Rapier rigid-body gibs instead of the y=0 bouncer
    };
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        Object.assign(this.data, d.data ?? {});
        Object.assign(this.settings, d.settings ?? {});
      }
    } catch { /* fresh start */ }
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify({ data: this.data, settings: this.settings })); }
    catch { /* storage unavailable */ }
  }

  perkLevel(id) { return this.data.perks[id] ?? 0; }

  buyPerk(id) {
    const lvl = this.perkLevel(id);
    const perk = PERKS.find((p) => p.id === id);
    if (!perk || lvl >= perk.max) return false;
    const cost = perkCost(lvl);
    if (this.data.severance < cost) return false;
    this.data.severance -= cost;
    this.data.perks[id] = lvl + 1;
    this.save();
    return true;
  }

  perkMods() {
    return {
      hpMult: 1 + 0.06 * this.perkLevel('vitality'),
      dmgMult: 1 + 0.04 * this.perkLevel('hustle'),
      speedMult: 1 + 0.03 * this.perkLevel('cardio'),
      moneyMult: 1 + 0.08 * this.perkLevel('income'),
      regen: 0.4 * this.perkLevel('wellness'),
    };
  }

  endOfRun({ kills, floorsCleared, bossKills, won, floorReached }) {
    const earned = Math.round(kills * 0.5 + floorsCleared * 30 + bossKills * 25 + (won ? 200 : 0));
    this.data.severance += earned;
    this.data.stats.runs++;
    this.data.stats.kills += kills;
    if (won) this.data.stats.wins++;
    this.data.stats.bestFloor = Math.max(this.data.stats.bestFloor, floorReached);
    this.save();
    return earned;
  }
}
