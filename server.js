#!/usr/bin/env node
// ============ J.O.B self-hosted relay ============
// A tiny room-based WebSocket relay. One player runs this (LAN or port-forwarded),
// everyone connects from the main menu. No accounts, no database, no bills.
//
//   npm run host            → listens on ws://0.0.0.0:7071
//   PORT=9000 npm run host  → custom port
//
// The relay only routes messages; the HOST PLAYER's game instance is authoritative.

import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 7071;
const wss = new WebSocketServer({ port: PORT });

const rooms = new Map(); // room -> Map(id -> client)
let nextId = 1;

const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };

wss.on('connection', (ws) => {
  const client = { id: String(nextId++), ws, room: null, name: '?', host: false };

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.t === 'join') {
      const roomName = String(msg.room || 'SYNERGY').slice(0, 16).toUpperCase();
      client.name = String(msg.name || 'WAGE_SLAVE').slice(0, 14);
      let room = rooms.get(roomName);
      if (!room) { room = new Map(); rooms.set(roomName, room); }
      if (room.size >= 8) { send(ws, { t: 'error', error: 'room full' }); return; }
      client.room = roomName;
      client.host = room.size === 0;
      room.set(client.id, client);
      send(ws, {
        t: 'joined', id: client.id, host: client.host,
        peers: [...room.values()].filter((c) => c !== client).map((c) => ({ id: c.id, name: c.name, host: c.host })),
      });
      for (const c of room.values()) {
        if (c !== client) send(c.ws, { t: 'peer-join', id: client.id, name: client.name });
      }
      console.log(`[${roomName}] ${client.name}#${client.id} joined (${room.size} in room)${client.host ? ' [HOST]' : ''}`);
      return;
    }

    if (msg.t === 'msg' && client.room) {
      const room = rooms.get(client.room);
      if (!room) return;
      const payload = { t: 'msg', from: client.id, data: msg.data };
      if (msg.to) {
        const target = room.get(msg.to);
        if (target) send(target.ws, payload);
      } else {
        for (const c of room.values()) if (c !== client) send(c.ws, payload);
      }
    }
  });

  ws.on('close', () => {
    if (!client.room) return;
    const room = rooms.get(client.room);
    if (!room) return;
    room.delete(client.id);
    console.log(`[${client.room}] ${client.name}#${client.id} left (${room.size} in room)`);
    if (room.size === 0) { rooms.delete(client.room); return; }
    // promote the oldest remaining client if the host left
    let newHost = null;
    if (client.host) {
      newHost = [...room.values()][0];
      newHost.host = true;
    }
    for (const c of room.values()) {
      send(c.ws, { t: 'peer-leave', id: client.id, newHost: newHost?.id ?? null });
    }
  });
});

console.log(`
  ╔══════════════════════════════════════════╗
  ║  J.O.B RELAY — self-hosted, zero bills   ║
  ║  listening on ws://0.0.0.0:${String(PORT).padEnd(5)}         ║
  ║  share:  ws://<your-ip>:${String(PORT).padEnd(5)}            ║
  ╚══════════════════════════════════════════╝
`);
