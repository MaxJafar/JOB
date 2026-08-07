# J.O.B. — Just Obey Business

A low-poly 3D **roguelite battle arena** set in a corporate tower.
Risk of Rain's escalation and items × Left 4 Dead's AI Director and specials —
except every biome is a department and every boss has a corner office.

**Climb the tower. Fire the C.E.O.**

![stack](https://img.shields.io/badge/three.js-r180-blue) ![stack](https://img.shields.io/badge/vite-7-purple) ![stack](https://img.shields.io/badge/multiplayer-self--hosted-green)

## Run it

```bash
npm install
npm run dev        # → http://localhost:5173
```

Co-op (self-hosted, zero server costs):

```bash
npm run host       # one player runs the relay (ws://<their-ip>:7071)
```

then everyone: **CO-OP SHIFT** → enter the relay URL + a room code → pick roles
→ host starts. The host player's game simulates the world; the relay only
routes messages. LAN or port-forward. Steam release swaps this transport for
Steam Datagram Relay P2P — see [STEAM.md](STEAM.md).

## Controls

| | |
|---|---|
| `WASD` / `Shift` / `Space` | move / sprint / jump |
| `Ctrl` or `C` while sprinting | slide (slide→jump keeps momentum) |
| `Q` | coffee dash (i-frames) |
| `LMB` / `RMB` | primary / class ability |
| `R` | reload (ranged classes run mags; IT manages a heat gauge) |
| `G` / `F` | throw grenade / use consumable |
| `Tab` | inventory — equip looted clothing & gear |
| `V` | toggle first ↔ third person |
| `E` | interact (crates, elevator, office utilities) |
| `Esc` / `P` | pause |

## The loop

0. **Badge in at THE LOBBY** (ground floor) and fight your way UP the tower.
   Enemies die like dropped Lego sets — every body part detaches and tumbles.
   Desks, cabinets, and machines **break for real** (colliders and all).
1. Kill feral coworkers for `$` and XP. Specials and bosses drop **briefcases**:
   wearable clothing (visible on your character, real stats), throwables
   (`G` — stapler grenades, tape balls, coffee molotovs), and consumables (`F`).
2. Every level-up triggers a **PERFORMANCE REVIEW**: draft 1 of 3 perks,
   including **class evolutions** (ricochet staples, dust-storm broom waves,
   tax bombs, forking pink slips, overclocked beams, boomerang cards…).
3. Chain kills to build **COMBO** — speed and attack rate climb with the meter
   (×5 SYNERGY! … ×35 HOSTILE TAKEOVER!!!).
4. Buy **supply crates** → 19 stacking items, including trade-offs
   (📛 +25% damage / −7% speed, 🪙 double money but getting hit dumps your wallet).
5. Work the **office utilities**: 3D-print a duplicate item, chug a fresh pot,
   shred a common for cash, hydrate for a free heal.
6. Chase optional **QUARTERLY KPIs** (kill sprints, spotless streaks,
   appliance demolition) for bonus budget and items.
7. Find the **elevator** and call it → holdout crescendo → the **Department Head**
   arrives *in the elevator*. Fire them. Board. Ascend.
8. FINANCE → MARKETING → SALES → **THE PENTHOUSE**, where the C.E.O. waits
   (two phases, throne mech, layoff shockwaves, quarterly laser).
9. Difficulty scales with **time**, not floors: PROBATION → CRUNCH TIME →
   HOSTILE WORKPLACE → MARKET COLLAPSE. Watch for floor-wide chaos —
   **LIGHTS OUT** and **FIRE DRILL** (frenzy, but 2× money). Post-win endless
   mode loops the tower harder.
10. Death pays **Severance** → permanent perks in the MOTIVATION dept (rogue-*lite*).

**Movement tech:** sprint → slide (`Ctrl`) → jump keeps your momentum.
Dash (`Q`) has i-frames and shakes off the Micromanager.

## The Director

`src/game/director.js` is a Left 4 Dead-style pacing engine:

- **Intensity tracking** per player (damage taken, kills nearby) drives
  RELAX → BUILD-UP → PEAK → FADE cycles — quiet lulls, then murder.
- Spawns are placed **out of sight** (behind occluders / outside your view cone).
- **Specials** on token cooldowns: **The Gossip** (pops into rumor gas → horde
  targets you), **The Complainer** (scalding coffee pools), **The Micromanager**
  (pounces and rides you — mash `Space` or dash), **The Motivator** (rallies
  nearby mobs +30% speed — kill it first).
- **Rares:** **KAREN** (witch — don't provoke her; she one-taps back) and
  **THE AUDITOR** (tank — drops a guaranteed item).
- **Crescendos:** the elevator holdout, fire-alarm boxes (shoot = instant
  horde), exploding espresso machines, popping vending machines (free sodas).
- Underneath it all: a Risk-of-Rain difficulty coefficient scaling enemy HP,
  damage, money, spawn caps, and **elite** rolls (OVERTIME / SYNERGIZED).

## The cast

| class | kit |
|---|---|
| 📎 THE INTERN | stapler sidearm · staple fan burst · +XP |
| 🧹 THE JANITOR | broom sweeps · trash-lid block (hold RMB) · tanky |
| 🧮 THE ACCOUNTANT | calculator SMG · AoE "Tax Audit" vuln mark · +money |
| 📁 THE HR REP | homing pink slips · slow-field "Mandatory Meeting" · -10% damage taken |
| 💻 IT SUPPORT | chaining ethernet beam · router turrets · regen |
| 📇 THE SALES REP | piercing business cards · "Cold Call" knockback cone · fastest |

## Architecture

```
src/
  core/    input (pointer-lock), synth audio + generative elevator muzak, math
  game/    game.js (orchestrator) · player (FP/TP rig) · classes · enemies ·
           bosses · director · level (seeded floor gen) · items · projectiles ·
           effects · props · characters · meta (localStorage perks)
  net/     net.js — host-authoritative co-op over a pluggable transport
  ui/      hud.js · menus.js
server.js  self-hosted WebSocket relay (rooms, host promotion)
electron/  Steam shell (see STEAM.md)
```

Design notes for contributors:

- **All world mutations flow through `Game` methods** (`damageEnemy`,
  `explode`, `grantReward`…) so netcode hooks in one place.
- Enemies/floors/items/classes are **data tables** — adding content means
  adding an entry, not a system.
- Everything is procedural primitives (no asset pipeline); materials are
  cached, projectiles/particles/numbers pooled.

## Known co-op v1 limits (honest list)

- Guests see host-simulated enemies at 12 Hz with interpolation; hit feedback
  is optimistic, damage is host-resolved (fine for co-op, not for esports).
- Destructible props & debris are not state-synced (cosmetic desync only).
- Host migration mid-run promotes a guest but enemies re-sync from scratch.
- No rollback/prediction on guest projectiles — tracers are cosmetic.

## Roadmap

**Full plan: [docs/ROADMAP.md](docs/ROADMAP.md)** — v0.1 prototype → v1.0.0 Early Access
in 9 versions (FOUNDATIONS → FLOOR PLAN → NEW HIRES → DRESS CODE → SECURITY ALERT →
GLOW UP → FIRST DAY → IPO PREP → GRAND OPENING), grounded in
[docs/DESIGN_DIGEST.md](docs/DESIGN_DIGEST.md) (195 principles mined from Schell &
Killick). Asset production packets: [docs/CODEX_ASSET_PACK.md](docs/CODEX_ASSET_PACK.md)
(2D/UI) and [docs/MESHY_ASSET_PACK.md](docs/MESHY_ASSET_PACK.md) (3D characters/props).
