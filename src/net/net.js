// ============ co-op session: host-authoritative over a dumb relay ============
// The pipe underneath is a MultiplayerTransport (see transport.js), so the Steam
// build swaps WebSocket -> Steam Datagram Relay without touching this file.
//
// Model:
//   • every client owns its OWN player (movement + hp), broadcast at 15 Hz
//   • the HOST simulates enemies/director/loot and broadcasts snapshots at 12 Hz
//   • guests send fire/secondary intents; the host spawns the authoritative
//     projectiles and resolves damage; guests see instant cosmetic tracers

import { createTransport } from './transport.js';

/**
 * The relay is mounted on the same origin that served this page (see
 * scripts/vite-plugin-lan.js and server.js), so nobody has to type an address:
 * open the link, and the socket follows it.
 */
export function defaultRelayUrl() {
  if (typeof location === 'undefined') return 'ws://localhost:7071/ws';
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

/** Live room directory served next to the relay. */
export async function fetchRooms({ signal } = {}) {
  const res = await fetch('/api/rooms', { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`rooms ${res.status}`);
  const body = await res.json();
  return Array.isArray(body.rooms) ? body.rooms : [];
}

// Wire table for enemy kinds: the INDEX is the value on the wire, so new kinds
// must be APPENDED and existing entries must never be reordered or removed.
// An unknown index is dropped by applyEnemySnapshot rather than mis-spawned.
const ENEMY_KEYS = ['paperling', 'drone', 'printer', 'roomba', 'quad', 'copier',
  'gossip', 'complainer', 'micromanager', 'karen', 'auditor', 'cfo', 'cmo', 'vp', 'ceo', 'motivator', 'security',
  // department staff
  'hrrep', 'intake', 'mediator', 'itguy', 'pylon', 'sysadmin',
  'influencer', 'growth', 'streamer', 'closer',
  // department heads + floor leads
  'chro', 'cto', 'concierge', 'notary', 'devops', 'controller', 'evangelist', 'accountexec'];
const ELITE_KEYS = [null, 'overtime', 'synergy'];

export class NetSession {
  constructor(game, transport = null) {
    this.game = game;
    this.transport = transport;
    this.connected = false;
    this.inRun = false;
    this.id = null;
    this.isHost = false;
    this.status = '';
    this.roster = [];           // {id, name, cls, host} — includes self
    this.snapT = 0;
    this.stateT = 0;
    this.now = 0;
  }

  /**
   * @param {string} url relay URL (ignored by the loopback/Steam transports)
   * @param {string} room
   * @param {string} name
   * @param {{prefer?: 'auto'|'websocket'|'loopback'|'steam'}} opts
   */
  connect(url, room, name, { prefer = 'auto' } = {}) {
    this.disconnect();
    const t = this.transport ?? createTransport({ prefer });
    this.transport = t;
    this.status = `Connecting to ${t.kind === 'websocket' ? url : t.describe()}…`;
    this.game.menus.showLobby();

    t.onOpen = () => t.send({ t: 'join', room, name });
    t.onError = () => { /* onClose owns the UX */ };
    t.onMessage = (msg) => this.handle(msg);
    t.onClose = () => {
      const wasIn = this.connected;
      this.connected = false;
      if (this.inRun) {
        this.game.hud.toast('CONNECTION LOST', 'warn');
      } else if (wasIn) {
        this.status = 'Disconnected.';
        this.game.menus.showLobby();
      } else {
        this.status = t.kind === 'websocket'
          ? '❌ Lost the relay on this page’s server. Reload the link and try again.'
          : `❌ ${t.describe()} unavailable.`;
        this.game.menus.showLobby();
      }
    };
    t.connect({ url });
  }

  disconnect() {
    if (this.transport) {
      const t = this.transport;
      t.onClose = null;              // an explicit disconnect is not a dropped link
      try { t.close(); } catch { /* already gone */ }
    }
    this.transport = null;
    this.connected = false;
    this.inRun = false;
    this.roster = [];
  }

  send(data, to = null) {
    if (!this.transport?.ready) return;
    this.transport.send({ t: 'msg', to, data });
  }

  handle(msg) {
    const game = this.game;
    switch (msg.t) {
      case 'joined': {
        this.connected = true;
        this.id = msg.id;
        this.isHost = msg.host;
        this.roster = [
          { id: msg.id, name: game.meta.settings.playerName, cls: null, host: msg.host, self: true },
          ...msg.peers.map((p) => ({ id: p.id, name: p.name, cls: null, host: p.host })),
        ];
        this.status = this.isHost
          ? '✅ Connected. You are the HOST — pick a role to begin the shift.'
          : '✅ Connected. Waiting for the host to start…';
        game.menus.showLobby();
        break;
      }
      case 'peer-join': {
        this.roster.push({ id: msg.id, name: msg.name, cls: null, host: false });
        if (!this.inRun) game.menus.showLobby();
        // late joiners in-run: host ships them the current floor
        if (this.inRun && this.isHost) {
          this.send({ a: 'start', seed: game.floorSeed, floor: game.floorIndex, loop: game.loopCount,
            roster: this.roster.map((r) => ({ id: r.id, name: r.name, cls: r.cls })) }, msg.id);
        }
        break;
      }
      case 'peer-leave': {
        this.roster = this.roster.filter((r) => r.id !== msg.id);
        game.removeRemotePlayer(msg.id);
        if (msg.newHost) {
          const me = msg.newHost === this.id;
          if (me && !this.isHost) {
            this.isHost = true;
            if (this.inRun) game.hud.toast('HOST LEFT — you have been promoted. Enemies re-sync.', 'warn');
            game.adoptHostRole();
          }
          const r = this.roster.find((x) => x.id === msg.newHost);
          if (r) r.host = true;
        }
        if (!this.inRun) game.menus.showLobby();
        break;
      }
      case 'error': {
        this.status = `❌ ${msg.error}`;
        game.menus.showLobby();
        break;
      }
      case 'msg': this.handleData(msg.from, msg.data); break;
    }
  }

  handleData(from, d) {
    const game = this.game;
    switch (d.a) {
      case 'lobby-cls': {
        const r = this.roster.find((x) => x.id === from);
        if (r) r.cls = d.cls;
        if (!this.inRun) game.menus.showLobby();
        break;
      }
      case 'start': {
        if (this.isHost) break;
        for (const rr of d.roster) {
          const r = this.roster.find((x) => x.id === rr.id);
          if (r) r.cls = rr.cls;
        }
        const mine = d.roster.find((r) => r.id === this.id);
        game.netStartRun(mine?.cls ?? game.menus.selectedClass, d.seed, d.floor, d.loop);
        break;
      }
      case 'pstate': game.onRemoteState(from, d.s, this.now); break;
      case 'fire': if (this.isHost) game.onRemoteFire(from, d); break;
      case 'snap': if (!this.isHost) this.applySnapshot(d); break;
      case 'ev': game.onNetEvent(d.e, from); break;
    }
  }

  // ---------- lobby ----------
  pickClass(cls) {
    const me = this.roster.find((r) => r.self);
    if (me) me.cls = cls;
    this.send({ a: 'lobby-cls', cls });
  }

  hostStart(seed) {
    this.send({
      a: 'start', seed, floor: 0, loop: 0,
      roster: this.roster.map((r) => ({ id: r.id, name: r.name, cls: r.cls ?? 'intern' })),
    });
    this.setRoomState(true);
  }

  /** Flag the room WAITING vs IN PROGRESS for the LAN browser. Host-only server-side. */
  setRoomState(inRun) {
    if (!this.transport?.ready) return;
    this.transport.send({ t: 'roomstate', inRun });
  }

  // ---------- in-run ----------
  update(dt) {
    if (!this.connected || !this.inRun) return;
    this.now += dt;
    const game = this.game;
    // everyone broadcasts their own player
    this.stateT -= dt;
    if (this.stateT <= 0 && game.player) {
      this.stateT = 1 / 15;
      this.send({ a: 'pstate', s: game.player.serializeState() });
    }
    // host broadcasts the world
    if (this.isHost) {
      this.snapT -= dt;
      if (this.snapT <= 0) {
        this.snapT = 1 / 12;
        this.send({ a: 'snap', e: this.encodeEnemies(), t: this.now });
      }
    }
  }

  encodeEnemies() {
    const out = [];
    for (const e of this.game.enemies) {
      if (e.dead) continue;
      out.push([
        e.id, ENEMY_KEYS.indexOf(e.key),
        +e.pos.x.toFixed(1), +e.pos.y.toFixed(1), +e.pos.z.toFixed(1),
        +(e.mesh.rotation.y).toFixed(2),
        +(e.hp / e.maxHp).toFixed(3),
        ELITE_KEYS.indexOf(e.elite ?? null),
        e.casting ? 1 : 0,     // the Gossip mid-rumor: guests must see the tell too
      ]);
    }
    return out;
  }

  applySnapshot(d) {
    this.game.applyEnemySnapshot(d.e, ENEMY_KEYS, ELITE_KEYS);
  }

  sendEvent(e, to = null) { this.send({ a: 'ev', e }, to); }
  sendAction(_action) { /* reserved for future prediction/rollback */ }
  sendFire(payload) { this.send({ a: 'fire', ...payload }); }
}
