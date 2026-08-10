#!/usr/bin/env node
// ============ J.O.B self-hosted relay ============
// A tiny room-based WebSocket relay plus a room directory, so every machine on
// the LAN needs exactly ONE link and no typed-in server address.
//
// It runs in two places, sharing the same createRelay() core:
//   • mounted into the Vite dev server  (scripts/vite-plugin-lan.js)  → npm run dev
//   • standalone, also serving dist/    (this file's CLI path)        → npm run host
//
// Either way the page and the relay live on ONE origin, so the client derives
// the socket URL from location.host and the firewall only needs one port open.
//
//   npm run host            → http://0.0.0.0:7071  (serves dist/ + relay)
//   PORT=9000 npm run host  → custom port
//
// The relay only routes messages; the HOST PLAYER's game instance is authoritative.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { networkInterfaces } from 'node:os';
import { WebSocketServer } from 'ws';

const ROOM_CAP = 8;

/**
 * The relay core. Transport-agnostic about *how* the upgrade arrives, so the
 * Vite plugin and the standalone server can both drive it.
 *
 * @param {{log?: (msg: string) => void}} opts
 */
export function createRelay({ log = () => {} } = {}) {
  const wss = new WebSocketServer({ noServer: true });
  const rooms = new Map();  // room -> Map(id -> client)
  const state = new Map();  // room -> { inRun: boolean }
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
        if (room.size >= ROOM_CAP) { send(ws, { t: 'error', error: 'room full' }); return; }
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
        log(`[${roomName}] ${client.name}#${client.id} joined (${room.size} in room)${client.host ? ' [HOST]' : ''}`);
        return;
      }

      // The host tells the directory whether the shift has clocked in, so the
      // room browser can show WAITING vs IN PROGRESS. Only the host may set it.
      if (msg.t === 'roomstate' && client.room && client.host) {
        state.set(client.room, { inRun: !!msg.inRun });
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
      log(`[${client.room}] ${client.name}#${client.id} left (${room.size} in room)`);
      if (room.size === 0) { rooms.delete(client.room); state.delete(client.room); return; }
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

  return {
    /** Hand a raw HTTP upgrade to the relay. */
    handleUpgrade(req, socket, head) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    },

    /** Everything the LAN room browser needs, with no game state leaked. */
    listRooms() {
      return [...rooms.entries()].map(([room, members]) => {
        const players = [...members.values()];
        const host = players.find((c) => c.host) ?? players[0];
        return {
          room,
          players: players.length,
          max: ROOM_CAP,
          host: host?.name ?? '?',
          names: players.map((c) => c.name),
          inRun: !!state.get(room)?.inRun,
        };
      }).sort((a, b) => a.room.localeCompare(b.room));
    },

    close() { wss.close(); },
  };
}

/** The one path the client derives from location.host. */
export const RELAY_PATH = '/ws';

/** JSON room directory; returns true if it handled the request. */
export function serveRoomDirectory(relay, req, res) {
  const path = (req.url || '').split('?')[0];
  if (path !== '/api/rooms') return false;
  const body = JSON.stringify({ rooms: relay.listRooms() });
  res.writeHead(200, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  res.end(body);
  return true;
}

// Boxes that run VMware/VirtualBox/Hyper-V or a mesh VPN answer on a pile of
// IPv4s, and the OS order routinely puts a virtual one first. Guessing wrong
// here means telling everyone to open a link that only this machine can reach.
const VIRTUAL_IFACE = /vmware|virtualbox|vethernet|hyper-v|zerotier|radmin|tailscale|tap-|utun|docker|wsl|loopback/i;

/**
 * Every non-loopback IPv4 this box answers on, real LAN adapters first.
 * @returns {{address: string, iface: string, virtual: boolean}[]}
 */
export function lanAddresses() {
  const out = [];
  for (const [iface, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      out.push({ address: a.address, iface, virtual: VIRTUAL_IFACE.test(iface) });
    }
  }
  return out.sort((x, y) => Number(x.virtual) - Number(y.virtual));
}

// ------------------------------------------------------------------ CLI path

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.map': 'application/json',
};

async function serveStatic(rootDir, req, res) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  // normalize + containment check: never let ../ escape dist/
  const rel = normalize(urlPath).replace(/^([/\\])+/, '');
  const target = join(rootDir, rel);
  if (target !== rootDir && !target.startsWith(rootDir + sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  const candidates = extname(target) ? [target] : [join(target, 'index.html'), join(rootDir, 'index.html')];
  for (const file of candidates) {
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' });
      res.end(body);
      return;
    } catch { /* try the next candidate */ }
  }
  res.writeHead(404).end('not found');
}

function main() {
  const PORT = Number(process.env.PORT || 7071);
  const dist = fileURLToPath(new URL('./dist', import.meta.url));
  const hasBuild = existsSync(join(dist, 'index.html'));
  const relay = createRelay({ log: (m) => console.log(m) });

  const http = createServer((req, res) => {
    if (serveRoomDirectory(relay, req, res)) return;
    if (hasBuild) { serveStatic(dist, req, res); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(
      '<h1>J.O.B relay is up</h1><p>No <code>dist/</code> build found. Run <code>npm run build</code> to serve the '
      + 'game from this port too, or just use <code>npm run dev</code> — it hosts the relay itself.</p>');
  });

  // Any path upgrades, so an old client pointed at ws://ip:7071 still connects.
  http.on('upgrade', (req, socket, head) => relay.handleUpgrade(req, socket, head));

  http.listen(PORT, '0.0.0.0', () => {
    const ips = lanAddresses();
    const share = ips.length ? `http://${ips[0].address}:${PORT}` : `http://localhost:${PORT}`;
    const others = ips.slice(1)
      .map((i) => `      http://${i.address}:${PORT}${i.virtual ? `  (${i.iface} — virtual, probably not it)` : `  (${i.iface})`}`)
      .join('\n');
    console.log(`
  ╔══════════════════════════════════════════════════════════╗
  ║  J.O.B RELAY — self-hosted, zero bills                   ║
  ╚══════════════════════════════════════════════════════════╝
  ${hasBuild ? 'serving dist/ + relay' : 'relay only (no dist/ build)'} on port ${PORT}

  share this ONE link with every PC on the network:
      ${share}${ips[0] ? `  (${ips[0].iface})` : ''}
${others ? `\n  also reachable at:\n${others}` : ''}
`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
