import { describe, it, expect } from 'vitest';
import { LoopbackRelay, LoopbackTransport, SteamTransport, createTransport } from '../src/net/transport.js';

// Drain the microtask queue — the loopback relay delivers asynchronously on
// purpose, to match real socket timing rather than re-entering the caller.
const settle = () => new Promise((r) => setTimeout(r, 0));

function connect(relay, room, name) {
  const t = new LoopbackTransport(relay);
  const inbox = [];
  t.onMessage = (m) => inbox.push(m);
  t.onOpen = () => t.send({ t: 'join', room, name });
  t.connect();
  return { t, inbox };
}

describe('LoopbackTransport', () => {
  it('makes the first peer in a room the host', async () => {
    const relay = new LoopbackRelay();
    const a = connect(relay, 'office', 'ALICE');
    await settle();
    const joined = a.inbox.find((m) => m.t === 'joined');
    expect(joined).toBeTruthy();
    expect(joined.host).toBe(true);
    expect(joined.peers).toEqual([]);
  });

  it('makes later peers guests and tells the host they arrived', async () => {
    const relay = new LoopbackRelay();
    const a = connect(relay, 'office', 'ALICE');
    await settle();
    const b = connect(relay, 'office', 'BOB');
    await settle();

    expect(b.inbox.find((m) => m.t === 'joined').host).toBe(false);
    expect(b.inbox.find((m) => m.t === 'joined').peers).toHaveLength(1);
    expect(a.inbox.find((m) => m.t === 'peer-join')?.name).toBe('BOB');
  });

  it('broadcasts a message to everyone but the sender', async () => {
    const relay = new LoopbackRelay();
    const a = connect(relay, 'office', 'ALICE');
    await settle();
    const b = connect(relay, 'office', 'BOB');
    const c = connect(relay, 'office', 'CARA');
    await settle();

    a.inbox.length = 0; b.inbox.length = 0; c.inbox.length = 0;
    a.t.send({ t: 'msg', to: null, data: { a: 'snap', e: [] } });
    await settle();

    expect(a.inbox).toHaveLength(0);
    expect(b.inbox[0].data.a).toBe('snap');
    expect(c.inbox[0].data.a).toBe('snap');
    expect(b.inbox[0].from).toBeTruthy();
  });

  it('delivers a directed message to exactly one peer', async () => {
    const relay = new LoopbackRelay();
    const a = connect(relay, 'office', 'ALICE');
    await settle();
    const b = connect(relay, 'office', 'BOB');
    const c = connect(relay, 'office', 'CARA');
    await settle();
    const bId = b.inbox.find((m) => m.t === 'joined').id;

    b.inbox.length = 0; c.inbox.length = 0;
    a.t.send({ t: 'msg', to: bId, data: { a: 'start' } });
    await settle();

    expect(b.inbox).toHaveLength(1);
    expect(c.inbox).toHaveLength(0);
  });

  it('keeps rooms isolated from each other', async () => {
    const relay = new LoopbackRelay();
    const a = connect(relay, 'floor-12', 'ALICE');
    const b = connect(relay, 'floor-38', 'BOB');
    await settle();
    b.inbox.length = 0;
    a.t.send({ t: 'msg', to: null, data: { a: 'snap' } });
    await settle();
    expect(b.inbox).toHaveLength(0);
  });

  // Host migration is the thing that breaks silently and ruins a co-op session.
  it('promotes a new host when the host leaves', async () => {
    const relay = new LoopbackRelay();
    const a = connect(relay, 'office', 'ALICE');
    await settle();
    const b = connect(relay, 'office', 'BOB');
    await settle();
    const bId = b.inbox.find((m) => m.t === 'joined').id;

    b.inbox.length = 0;
    a.t.close();
    await settle();

    const left = b.inbox.find((m) => m.t === 'peer-leave');
    expect(left).toBeTruthy();
    expect(left.newHost).toBe(bId);
  });

  it('does not promote anyone when a guest leaves', async () => {
    const relay = new LoopbackRelay();
    const a = connect(relay, 'office', 'ALICE');
    await settle();
    const b = connect(relay, 'office', 'BOB');
    await settle();
    a.inbox.length = 0;
    b.t.close();
    await settle();
    expect(a.inbox.find((m) => m.t === 'peer-leave').newHost).toBeNull();
  });

  it('drops sends after close instead of throwing', async () => {
    const relay = new LoopbackRelay();
    const a = connect(relay, 'office', 'ALICE');
    await settle();
    a.t.close();
    await settle();
    expect(() => a.t.send({ t: 'msg', data: {} })).not.toThrow();
  });
});

describe('SteamTransport', () => {
  it('reports unavailable without the Electron bridge', () => {
    expect(SteamTransport.available()).toBe(false);
  });

  it('fails loudly through onError rather than silently hanging', async () => {
    const t = new SteamTransport();
    let err = null, closed = false;
    t.onError = (e) => { err = e; };
    t.onClose = () => { closed = true; };
    t.connect({});
    await settle();
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/bridge not present/i);
    expect(closed).toBe(true);
  });
});

describe('createTransport', () => {
  it('picks loopback on request', () => {
    expect(createTransport({ prefer: 'loopback' }).kind).toBe('loopback');
  });
  it('falls back to websocket when Steam is absent', () => {
    expect(createTransport({ prefer: 'auto' }).kind).toBe('websocket');
  });
});
