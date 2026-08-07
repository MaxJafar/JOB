// ============ MultiplayerTransport ============
// NetSession used to own a raw WebSocket. That made the Steam migration a
// rewrite of the session layer instead of a swap of the pipe underneath it.
//
// The contract is deliberately tiny — it is a dumb envelope pipe. Everything
// that matters (host authority, snapshots, intents, roster) stays in
// NetSession and is transport-agnostic:
//
//   connect(opts) -> void        open the pipe, then fire onOpen
//   send(envelope) -> void       envelope is a plain JSON-able object
//   close() -> void
//   onOpen / onMessage / onClose / onError                (assigned by NetSession)
//   kind: 'websocket' | 'loopback' | 'steam'
//   ready: boolean
//
// Three implementations:
//   WebSocketTransport — today's self-hosted `npm run host` relay.
//   LoopbackTransport  — in-process host+guest. No server, no sockets, so co-op
//                        message flow becomes unit-testable and a designer can
//                        exercise the 2-player path solo.
//   SteamTransport     — the seam for steamworks.js. Deliberately NOT the
//                        deprecated ISteamNetworking; targets Steam Networking
//                        Messages over SDR (see STEAM.md).

/**
 * @typedef {{t: string, [k: string]: any}} Envelope
 */

export class Transport {
  constructor() {
    /** @type {(() => void)|null} */         this.onOpen = null;
    /** @type {((m: Envelope) => void)|null} */ this.onMessage = null;
    /** @type {(() => void)|null} */         this.onClose = null;
    /** @type {((e: any) => void)|null} */   this.onError = null;
    this.ready = false;
    this.kind = 'abstract';
  }

  connect(_opts) { throw new Error('Transport.connect not implemented'); }
  send(_envelope) { throw new Error('Transport.send not implemented'); }
  close() { this.ready = false; }

  /** Human-readable state for the lobby screen. */
  describe() { return this.kind; }
}

// ---------------------------------------------------------------- websocket

export class WebSocketTransport extends Transport {
  constructor() {
    super();
    this.kind = 'websocket';
    this.ws = null;
    this.url = '';
  }

  /** @param {{url: string}} opts */
  connect({ url }) {
    this.close();
    this.url = url;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      this.onError?.(err);
      this.onClose?.();
      return;
    }
    this.ws = ws;
    ws.onopen = () => { this.ready = true; this.onOpen?.(); };
    ws.onclose = () => { this.ready = false; this.onClose?.(); };
    ws.onerror = (e) => this.onError?.(e);
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this.onMessage?.(msg);
    };
  }

  send(envelope) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify(envelope));
  }

  close() {
    if (this.ws) { try { this.ws.close(); } catch { /* already gone */ } }
    this.ws = null;
    this.ready = false;
  }

  describe() { return `relay ${this.url}`; }
}

// ---------------------------------------------------------------- loopback

/**
 * A relay that lives in this process. Mirrors server.js semantics: first peer in
 * a room is host, `to` addresses a single peer, host migration on leave.
 * Useful for tests and for exercising the guest code path without a server.
 */
export class LoopbackRelay {
  constructor() {
    this.rooms = new Map(); // room -> [{ id, name, transport, host }]
    this._nextId = 1;
  }

  join(transport, room, name) {
    const peers = this.rooms.get(room) ?? [];
    const id = `L${this._nextId++}`;
    const host = peers.length === 0;
    const entry = { id, name, transport, host };
    peers.push(entry);
    this.rooms.set(room, peers);

    transport._entry = entry;
    transport._room = room;
    transport._relay = this;

    deliver(transport, {
      t: 'joined', id, host,
      peers: peers.filter((p) => p !== entry).map((p) => ({ id: p.id, name: p.name, host: p.host })),
    });
    for (const p of peers) {
      if (p === entry) continue;
      deliver(p.transport, { t: 'peer-join', id, name });
    }
  }

  leave(transport) {
    const room = transport._room;
    const entry = transport._entry;
    if (!room || !entry) return;
    const peers = this.rooms.get(room) ?? [];
    const i = peers.indexOf(entry);
    if (i >= 0) peers.splice(i, 1);

    let newHost = null;
    if (entry.host && peers.length) {
      peers[0].host = true;
      newHost = peers[0].id;
    }
    for (const p of peers) deliver(p.transport, { t: 'peer-leave', id: entry.id, newHost });
    if (!peers.length) this.rooms.delete(room);
    transport._entry = null;
    transport._room = null;
  }

  relay(transport, envelope) {
    const entry = transport._entry;
    const peers = this.rooms.get(transport._room) ?? [];
    if (!entry) return;
    const out = { t: 'msg', from: entry.id, data: envelope.data };
    for (const p of peers) {
      if (p === entry) continue;
      if (envelope.to && p.id !== envelope.to) continue;
      deliver(p.transport, out);
    }
  }
}

function deliver(transport, msg) {
  // async so callers never see re-entrant delivery, matching real socket timing
  queueMicrotask(() => transport.onMessage?.(msg));
}

export class LoopbackTransport extends Transport {
  /** @param {LoopbackRelay} relay */
  constructor(relay) {
    super();
    this.kind = 'loopback';
    this.relay = relay;
    this._pendingJoin = null;
  }

  connect() {
    this.ready = true;
    queueMicrotask(() => this.onOpen?.());
  }

  send(envelope) {
    if (!this.ready) return;
    if (envelope.t === 'join') {
      this.relay.join(this, envelope.room, envelope.name);
      return;
    }
    if (envelope.t === 'msg') this.relay.relay(this, envelope);
  }

  close() {
    if (this.ready) this.relay.leave(this);
    this.ready = false;
    queueMicrotask(() => this.onClose?.());
  }

  describe() { return 'loopback (in-process)'; }
}

// ---------------------------------------------------------------- steam

/**
 * Steam Datagram Relay P2P. Not wired yet — see STEAM.md.
 *
 * Shape it will take (steamworks.js, main process, bridged over the contextIsolated
 * preload so the renderer never touches node):
 *   client.matchmaking.createLobby / joinLobby        -> room identity
 *   client.networkingMessages.sendMessageToUser(...)  -> send()
 *   client.networkingMessages.receiveMessagesOnChannel -> polled -> onMessage
 *   lobby chat/metadata                               -> joined / peer-join / peer-leave
 *
 * Deliberately NOT ISteamNetworking (deprecated). Envelopes stay identical to the
 * WebSocket path, so NetSession does not change at all when this lands.
 */
export class SteamTransport extends Transport {
  constructor(bridge = globalThis.steamBridge) {
    super();
    this.kind = 'steam';
    this.bridge = bridge;
    this._poll = null;
  }

  static available() {
    return !!globalThis.steamBridge?.networkingReady;
  }

  connect({ lobbyId = null } = {}) {
    if (!SteamTransport.available()) {
      const err = new Error('Steam networking bridge not present — run the Electron/Steam build.');
      this.onError?.(err);
      queueMicrotask(() => this.onClose?.());
      return;
    }
    this.bridge.connect({ lobbyId })
      .then(() => {
        this.ready = true;
        this._poll = setInterval(() => {
          for (const m of this.bridge.receive()) this.onMessage?.(m);
        }, 16);
        this.onOpen?.();
      })
      .catch((err) => { this.onError?.(err); this.onClose?.(); });
  }

  send(envelope) {
    if (!this.ready) return;
    this.bridge.send(envelope);
  }

  close() {
    clearInterval(this._poll);
    this._poll = null;
    if (this.ready) this.bridge?.disconnect?.();
    this.ready = false;
    this.onClose?.();
  }

  describe() { return 'Steam SDR P2P'; }
}

/**
 * Pick the best transport for the current build.
 * @param {{prefer?: 'auto'|'websocket'|'loopback'|'steam', relay?: LoopbackRelay}} opts
 */
export function createTransport({ prefer = 'auto', relay = null } = {}) {
  if (prefer === 'loopback') return new LoopbackTransport(relay ?? new LoopbackRelay());
  if (prefer === 'steam') return new SteamTransport();
  if (prefer === 'auto' && SteamTransport.available()) return new SteamTransport();
  return new WebSocketTransport();
}
