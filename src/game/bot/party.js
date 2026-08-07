// ============ bot party management ============
// Owns the roster of AI teammates for a run: spawning them beside the human on
// every floor, retiring them on teardown, and persisting the party you picked so
// the mode selector remembers it between runs.
//
// Bots live in game.remotePlayers alongside real peers. That is what makes them
// first-class teammates for free (see bot.js), but it means two rules:
//   1. Bot ids are namespaced 'bot:N' so they can never collide with a
//      relay-assigned peer id and get clobbered by onRemoteState.
//   2. In a REAL co-op session only the HOST may own bots, and today they are
//      host-local — a guest never sees them. Mixing bots into a live session
//      would need them broadcast through the pstate path; until that exists,
//      spawning is refused with an explanation rather than desyncing the party.

import { BotPlayer } from './bot.js';
import { CLASSES, CLASS_BY_KEY } from '../classes.js';

const STORE_KEY = 'job.botparty.v1';
export const MAX_BOTS = 3;   // 3 bots + you = the 4-player party we are testing

/** Distinct personalities so four bots do not move as one organism. */
const PERSONALITY = [0.35, 0.65, 0.5];

export class BotParty {
  /** @param {import('../game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.bots = [];
    /** @type {Array<{classKey: string}>} the configured roster, not the live one */
    this.roster = this.load();
    this.enabled = this.roster.length > 0;
  }

  // ------------------------------------------------------------- persistence

  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return [];
      const r = JSON.parse(raw);
      if (!Array.isArray(r)) return [];
      return r.filter((e) => e && CLASS_BY_KEY[e.classKey]).slice(0, MAX_BOTS);
    } catch { return []; }
  }

  save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.roster)); }
    catch { /* private mode — the party just won't persist */ }
  }

  /** @param {Array<string>} classKeys */
  setRoster(classKeys) {
    this.roster = (classKeys ?? [])
      .filter((k) => CLASS_BY_KEY[k])
      .slice(0, MAX_BOTS)
      .map((classKey) => ({ classKey }));
    this.enabled = this.roster.length > 0;
    this.save();
    return this.roster;
  }

  /** Fill the party with a sensible spread rather than three of the same class. */
  suggestRoster(n = MAX_BOTS, avoid = null) {
    // One melee body, one mid, one long — the composition a human party
    // gravitates to anyway, so the playtest reads like a real group.
    const wanted = ['janitor', 'it', 'accountant'];
    const pool = CLASSES.map((c) => c.key).filter((k) => k !== avoid);
    const out = [];
    for (const w of wanted) {
      if (out.length >= n) break;
      if (w !== avoid && pool.includes(w)) out.push(w);
    }
    for (const k of pool) {
      if (out.length >= n) break;
      if (!out.includes(k)) out.push(k);
    }
    return out.slice(0, n);
  }

  // ------------------------------------------------------------- lifecycle

  /** @returns {{ok: boolean, reason?: string}} */
  canSpawn() {
    const net = this.game.net;
    if (net?.connected && !net.isHost) {
      return { ok: false, reason: 'Only the host can add bots.' };
    }
    if (net?.connected) {
      // Honest refusal beats a silent desync: guests would never receive them.
      return { ok: false, reason: 'Bots are local-only for now — not visible to other players.' };
    }
    return { ok: true };
  }

  /** Called from buildFloor, after the level and the player spawn point exist. */
  spawnForFloor() {
    this.despawn();
    if (!this.enabled || !this.roster.length) return;
    const gate = this.canSpawn();
    if (!gate.ok) return;

    const spawns = this.resolveSpawns();
    if (!spawns.length) return;
    const mySeat = this.game.netSeat?.() ?? 0;

    this.roster.forEach((entry, i) => {
      const bot = new BotPlayer(this.game, {
        classKey: entry.classKey,
        slot: i,
        skill: 0.7,
        personality: PERSONALITY[i % PERSONALITY.length],
      });
      // Take the stairwells the human did NOT. The floor is authored so four
      // players land on four sides and cut inward to meet at the core — putting
      // bots beside you would skip exactly the part of the 4-player opening this
      // is meant to playtest, and would never exercise squad pathing.
      const seat = spawns[(mySeat + 1 + i) % spawns.length];
      const p = seat.pos ?? seat;
      bot.motor.teleport(p.x + (i % 2 ? 1.2 : -1.2), p.y ?? 0, p.z + (i > 1 ? 1.2 : -1.2));
      bot.yaw = Number.isFinite(seat.yaw) ? seat.yaw : Math.PI;
      this.bots.push(bot);
      this.game.remotePlayers.set(bot.id, bot);
    });
  }

  /**
   * Spawn points, tolerant of both level shapes: the wing stairwells
   * ({label,pos,wing,yaw}) and the penthouse's flat offsets. Falls back to the
   * player's own position so a level variant that publishes neither still gets
   * a party rather than silently getting none.
   */
  resolveSpawns() {
    const L = this.game.level;
    if (Array.isArray(L?.playerSpawns) && L.playerSpawns.length) return L.playerSpawns;
    if (L?.playerSpawn) return [{ pos: L.playerSpawn, yaw: Math.PI }];
    const p = this.game.player;
    return p ? [{ pos: p.pos, yaw: p.yaw }] : [];
  }

  /** Downed bots come back with the elevator, same rule the humans get. */
  respawnAll() {
    const spawns = this.resolveSpawns();
    if (!spawns.length) return;
    const mySeat = this.game.netSeat?.() ?? 0;
    this.bots.forEach((b, i) => {
      if (!b.dead) return;
      const seat = spawns[(mySeat + 1 + i) % spawns.length];
      const p = seat.pos ?? seat;
      b.respawn({ x: p.x, y: p.y ?? 0, z: p.z });
    });
  }

  despawn() {
    for (const b of this.bots) {
      this.game.remotePlayers.delete(b.id);
      b.dispose();
    }
    this.bots.length = 0;
  }

  get aliveCount() {
    let n = 0;
    for (const b of this.bots) if (!b.dead) n++;
    return n;
  }

  /** Debug-panel readout for the whole squad. */
  explain() { return this.bots.map((b) => b.explain()); }
}
