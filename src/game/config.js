// ============ central tuning & content tables ============
// v0.2 FOUNDATIONS: the numbers live in /data/*.json — edit a file while
// `npm run dev` runs and the hot-reload block at the bottom of this module
// applies it in place, no rebuild. Everything exported here keeps a stable
// object identity (consumers hold live references), so JSON is parsed INTO
// these exports rather than replacing them. Hex colors travel as "0x..."
// strings (JSON has no hex literals); parseHexData turns them into numbers.
import tuneData from '../../data/tune.json';
import difficultyData from '../../data/difficulty.json';
import floorsData from '../../data/floors.json';
import wavesData from '../../data/waves.json';
import { parseHexData, deepApply, announceDataReload } from './dataUtils.js';

// Flat on purpose: the debug panel binds tweakpane sliders straight onto these
// keys, and 8 modules read TUNE.x at call time — the flat shape is the contract.
export const TUNE = { ...tuneData };

export const DIFF_STAGES = difficultyData.stages;

// ---- floors ----
// The run starts at street level and climbs the tower to the C.E.O. Every floor
// is a biome: its own palette, its own staff, its own floor lead. `table` is
// the director's spawn menu, `specials` is what joins the core holdout, and
// `miniBossKey` is who overrides the elevator halfway through the call.
// Floor design notes that used to live inline: HR is a corridor problem, not a
// damage problem (slow, wide, can't walk away); IT makes standing still cost
// your dash/grenade/abilities; MARKETING is paper-thin and endless (a
// crowd-control exam); the PENTHOUSE gets a delegate from every department.
parseHexData(floorsData);
export const FLOORS = floorsData.floors;

// The toy-test floor (v0.2, D 5.1): NOT in the tower rotation — reached via the
// debug panel's "Enter SANDBOX floor" or game.enterSandbox(). `sandbox: true`
// switches off the director, KPIs and the elevator; dummies respawn instead.
export const SANDBOX_FLOOR = floorsData.sandbox;

// Scripted wave compositions: the core-lockdown waves and the horde menu.
export const WAVES = wavesData;

export const ANNOUNCER = {
  hordeLines: ['📠 CONFERENCE CALL INCOMING', '📎 ALL-HANDS MEETING — MANDATORY', '🖨️ THE PRINTERS ARE UNIONIZING', '📋 SURPRISE TEAM-BUILDING EXERCISE'],
  peakLines: ['MANAGEMENT IS WATCHING', 'PRODUCTIVITY REVIEW IN PROGRESS'],
  auditorLine: '🧾 THE AUDITOR HAS ENTERED THE FLOOR',
  karenLine: '⚠️ KAREN PROVOKED — SHE WANTS THE MANAGER',
  eliteTag: { overtime: 'OVERTIME', synergy: 'SYNERGIZED' },
  comboLines: { 5: 'SYNERGY!', 10: 'DOWNSIZING SPREE!', 20: 'RESTRUCTURING!!', 35: 'HOSTILE TAKEOVER!!!', 50: 'MARKET DOMINANCE!!!!' },
};

// ---- hot reload (dev server only; inert in prod and in node tests) ----
if (import.meta.hot) {
  import.meta.hot.accept(
    ['../../data/tune.json', '../../data/difficulty.json', '../../data/floors.json', '../../data/waves.json'],
    ([tune, difficulty, floors, waves]) => {
      if (tune) { deepApply(TUNE, tune.default); announceDataReload('tune.json'); }
      if (difficulty) { deepApply(DIFF_STAGES, difficulty.default.stages); announceDataReload('difficulty.json'); }
      if (floors) {
        const fresh = parseHexData(floors.default);
        deepApply(FLOORS, fresh.floors);
        deepApply(SANDBOX_FLOOR, fresh.sandbox);
        announceDataReload('floors.json — warp or rebuild the floor to see layout changes');
      }
      if (waves) { deepApply(WAVES, waves.default); announceDataReload('waves.json'); }
    },
  );
}
