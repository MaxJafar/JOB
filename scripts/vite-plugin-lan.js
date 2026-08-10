// ============ LAN party plugin ============
// Mounts the co-op relay INTO the dev server so a playtest needs one process,
// one port, and one link. Without this the guest had to be told a page URL and
// a separate ws:// address, and two firewall holes had to be open.
//
//   page      http://<lan-ip>:5173
//   sockets   ws://<lan-ip>:5173/ws        <- derived from location.host
//   directory http://<lan-ip>:5173/api/rooms
//
// Vite's own HMR socket shares this httpServer. It only claims upgrades whose
// sec-websocket-protocol is 'vite-hmr', and we only claim path /ws, so the two
// listeners never fight over the same request.

import { createRelay, serveRoomDirectory, lanAddresses, RELAY_PATH } from '../server.js';

export function lanRelay() {
  return {
    name: 'job-lan-relay',
    apply: 'serve',

    configureServer(server) {
      const relay = createRelay({ log: (m) => server.config.logger.info(`  \x1b[35m[co-op]\x1b[0m ${m}`) });

      server.middlewares.use((req, res, next) => {
        if (!serveRoomDirectory(relay, req, res)) next();
      });

      // middlewareMode has no httpServer of its own; nothing to upgrade.
      server.httpServer?.on('upgrade', (req, socket, head) => {
        const path = (req.url || '').split('?')[0];
        if (path !== RELAY_PATH) return;
        relay.handleUpgrade(req, socket, head);
      });

      server.httpServer?.on('close', () => relay.close());

      server.printUrls = ((inner) => () => {
        inner();
        const port = server.config.server.port;
        const ips = lanAddresses();
        const line = (s) => server.config.logger.info(s);
        line('');
        line('  \x1b[35m➜\x1b[0m  \x1b[1mLAN PARTY\x1b[0m — relay mounted on this port, share ONE link:');
        if (!ips.length) line('     (no LAN interface found)');
        for (const i of ips) {
          const note = i.virtual ? `\x1b[2m  ${i.iface} — virtual, probably not it\x1b[0m` : `\x1b[2m  ${i.iface}\x1b[0m`;
          line(`     \x1b[36mhttp://${i.address}:${port}\x1b[0m${note}`);
        }
        line('     every PC opens that, then CO-OP SHIFT — hosted shifts appear on their own.');
        line('');
      })(server.printUrls.bind(server));
    },
  };
}
