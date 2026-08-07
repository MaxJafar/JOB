// ============ QUARTERLY KPIs — optional per-floor objectives ============
import { rand, choose } from '../core/utils.js';
import { rollItem } from './items.js';

const TEMPLATES = [
  {
    id: 'rush',
    make(game) {
      const n = Math.round(10 + game.director.coeff * 4);
      return {
        text: (s) => `DOWNSIZE ${s.count}/${n} STAFF — ${Math.ceil(s.t)}s`,
        state: { count: 0, t: 45, started: false },
        onKill(s) { s.count++; if (!s.started) s.started = true; return s.count >= n; },
        tick(s, dt) { if (s.started) { s.t -= dt; return s.t <= 0 ? 'fail' : null; } return null; },
      };
    },
  },
  {
    id: 'spotless',
    make() {
      return {
        text: (s) => `SPOTLESS RECORD — no damage for ${Math.ceil(s.t)}s`,
        state: { t: 40 },
        onPlayerHurt(s) { s.t = 40; return false; },
        tick(s, dt) { s.t -= dt; return s.t <= 0 ? 'done' : null; },
      };
    },
  },
  {
    id: 'demolition',
    make() {
      return {
        text: (s) => `OSHA VIOLATION — destroy office appliances ${s.count}/3`,
        state: { count: 0 },
        onAppliance(s) { s.count++; return s.count >= 3; },
        tick() { return null; },
      };
    },
  },
  {
    id: 'headhunter',
    make() {
      return {
        text: () => `HEADHUNT — eliminate a SPECIAL problem employee`,
        state: {},
        onKill(s, enemy) { return !!enemy?.def.special; },
        tick() { return null; },
      };
    },
  },
];

export class KpiTracker {
  constructor(game) {
    this.game = game;
    this.active = null;
    this.assignT = 0;
    this.completedThisFloor = 0;
  }

  resetFloor() {
    this.active = null;
    this.assignT = 9;
    this.completedThisFloor = 0;
  }

  assign() {
    const t = choose(TEMPLATES);
    const built = t.make(this.game);
    this.active = { id: t.id, ...built };
    this.game.hud.setKpi(this.active.text(this.active.state));
    this.game.hud.toast('📊 NEW KPI ASSIGNED', 'item');
    this.game.audio.sfx('phone', { vol: 0.7 });
  }

  complete() {
    const game = this.game;
    game.hud.setKpi(null);
    game.hud.announce('✅ KPI MET — BONUS APPROVED', 2.4, true);
    game.audio.sfx('item-rare');
    const coeff = game.director.coeff;
    // A KPI is an optional detour, so it has to pay in the currency detours are
    // worth taking for — a punch card, not another $70 (D 3.1).
    if (Math.random() < 0.35) {
      game.dropModule(game.player.pos.clone(), 0.3);
      game.hud.toast('🗃️ BONUS: PUNCH CARD FILED TO YOUR DESK', 'item');
    } else if (Math.random() < 0.45) {
      game.grantItem(game.player, rollItem(Math.random, 0.25));
    } else {
      const money = Math.round(70 * (1 + (coeff - 1) * 0.5));
      game.player.addMoney(money);
      game.hud.toast(`💵 KPI BONUS: $${money}`, 'item');
    }
    this.active = null;
    this.completedThisFloor++;
    if (this.completedThisFloor < 2) this.assignT = rand(20, 30);
  }

  fail() {
    this.game.hud.setKpi(null);
    this.game.hud.toast('📉 KPI MISSED — noted in your file', 'warn');
    this.game.audio.sfx('ui');
    this.active = null;
    if (this.completedThisFloor < 2) this.assignT = rand(25, 35);
  }

  update(dt) {
    const game = this.game;
    if (!this.active) {
      if (this.assignT > 0 && !game.activeBoss && game.eventState === 'idle') {
        this.assignT -= dt;
        if (this.assignT <= 0) this.assign();
      }
      return;
    }
    const res = this.active.tick(this.active.state, dt);
    if (res === 'done') { this.complete(); return; }
    if (res === 'fail') { this.fail(); return; }
    game.hud.setKpi(this.active.text(this.active.state));
  }

  onKill(enemy) {
    if (this.active?.onKill && this.active.onKill(this.active.state, enemy)) this.complete();
  }
  onPlayerHurt() {
    if (this.active?.onPlayerHurt && this.active.onPlayerHurt(this.active.state)) this.complete();
  }
  onAppliance() {
    if (this.active?.onAppliance && this.active.onAppliance(this.active.state)) this.complete();
  }
}
