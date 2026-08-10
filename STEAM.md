# Shipping J.O.B on Steam (Windows + macOS)

The game is pure web tech (Three.js + Vite), shipped inside **Electron** with
**steamworks.js** for the Steam SDK. This is the proven path for web-tech games
on Steam (Vampire Survivors et al.).

## One-time setup

```bash
npm i -D electron electron-builder
npm i steamworks.js
```

Create `steam_appid.txt` in the project root containing your AppID (use `480`
— Spacewar — for testing before you have your own).

Uncomment the steamworks block in `electron/main.cjs` and set your AppID.

## Build pipeline

```bash
npm run build                 # vite → dist/
npx electron electron/main.cjs   # smoke-test the shell locally
npx electron-builder --win nsis --mac dmg   # installers (see config below)
```

Add to `package.json`:

```json
"build": {
  "appId": "com.yourstudio.job",
  "productName": "J.O.B",
  "files": ["dist/**", "electron/**", "server.js", "node_modules/ws/**"],
  "win": { "target": "nsis" },
  "mac": { "target": ["dmg", "zip"], "category": "public.app-category.games" }
}
```

Steam depot layout: one Windows depot (nsis-unpacked or portable dir), one
macOS depot (the .app). Upload with `steamcmd` + `app_build.vdf` scripts as per
Valve's docs. macOS builds must be signed + notarized with an Apple Developer
ID for Gatekeeper; Windows benefits from Authenticode signing but doesn't
require it.

## Multiplayer without server bills

Three transports, same message layer (`src/net/net.js`):

1. **Today (dev / LAN / DIY):** the relay (`server.js`) is served from the same
   origin as the game — mounted into Vite for `npm run dev`, or standalone next
   to `dist/` for `npm run host`. One player shares one link; the client derives
   the socket URL from `location` and discovers rooms over `/api/rooms`, so a
   LAN party needs no typed addresses and one open port. The relay only routes
   packets — the host player's game instance is authoritative.
2. **Steam build:** swap the WebSocket transport for **Steam networking** via
   steamworks.js — lobbies + `networking_sockets` P2P. Valve's Steam Datagram
   Relay carries the traffic for free, gives NAT traversal, and hides IPs.
   Because `NetSession` isolates the transport (connect / send / onmessage),
   this is a contained change:
   - lobby create/join ⇒ `client.matchmaking`
   - `send(data, to)` ⇒ `client.networking_messages.sendMessageToUser`
   - keep the exact same JSON payloads
3. **Web SKU (itch/portals — docs/ROADMAP.md §1, v0.85):** WebRTC
   `RTCDataChannel` P2P with public STUN and a free-tier signaling channel for
   room codes. No TURN, no dedicated servers, no port forwarding. Same JSON
   payloads over a third transport; the relay and Steam paths are untouched.

In Electron the relay can also be spawned automatically from the main process
(`fork('server.js')`) when the player clicks "Host" — zero terminal usage.

## Steam feature roadmap

- Achievements: "FIRED THE CEO", "Karen Slayer", "Employee of the Month" (win
  before 20:00), class-mastery achievements.
- Rich presence: floor + difficulty stage.
- Lobby invites via overlay (`steam://joinlobby/...`).
- Cloud saves: `job_meta_v1` localStorage blob → Steam Cloud file.
