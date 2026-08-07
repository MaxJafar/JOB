# J.O.B. — Just Obey Business

A low-poly 3D **roguelite battle arena** set in a corporate tower.
Risk of Rain's escalation and items × Left 4 Dead's AI Director and specials —
except every biome is a department and every boss has a corner office.

**Climb the tower. Fire the C.E.O.**

![stack](https://img.shields.io/badge/three.js-r180-blue) ![stack](https://img.shields.io/badge/vite-7-purple) ![stack](https://img.shields.io/badge/physics-rapier-orange) ![stack](https://img.shields.io/badge/nav-recast-teal) ![stack](https://img.shields.io/badge/multiplayer-self--hosted-green)

## Run it

```bash
npm install
npm run dev        # → http://localhost:5173
```

Other commands:

| | |
|---|---|
| `npm test` | engine test suite (physics, navmesh, BVH, timestep, audio, netcode) |
| `npm run lint` | ESLint |
| `npm run check` | lint + test + build — the gate CI runs |
| `npm run host` | co-op relay on `:7071` |

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
| `LMB` / `RMB` | primary / class signature (the chassis — loot can never replace either) |
| `X` | **SPECIAL module** — whatever punch card is in the slot |
| `R` | reload (ranged classes run mags; IT and the Barista run heat gauges) |
| `G` / `F` | throw grenade / use consumable |
| `Tab` | inventory — install punch cards, equip looted clothing & gear |
| `V` | toggle first ↔ third person |
| `E` | interact (crates, elevator, office utilities) |
| `Esc` / `P` | pause |
| `` ` `` | **debug panel** — perf graph, director controls, spawn anything, live tuning sliders (dev builds; set `localStorage['job.debug']='1'` elsewhere) |

## Engine

The simulation sits on a small engine layer in `src/core/` — see
[docs/ENGINE.md](docs/ENGINE.md) for the full contract.

| | |
|---|---|
| **Rapier** | world colliders + rigid-body Lego gibs that land on real desks; opt-in character motor |
| **three-mesh-bvh** | exact hitscan and AI line of sight (replaced a 0.7u ray march that tunnelled through thin walls) |
| **recast-navigation** | per-floor navmesh; enemies route around cubicles instead of pressing into them |
| **postprocessing** | bloom → vignette → tone mapping in one pass; the vignette is also the low-HP readout |
| **fixed timestep** | 60 Hz sim, so dash distance and jump apex no longer depend on your monitor |
| **voice manager** | a 40-mob horde can't fire 40 simultaneous voices over your hit confirms |

The load-bearing rule: `WorldBVH`, `NavMesh` and `PhysicsWorld` are all built
from the **same** collider list movement uses, so bullets, bodies and pathing
can never disagree about what is solid. Every one of them is optional at
runtime — if a WASM module fails to load the game falls back to its original
code path rather than failing to boot.

## The loop

0. **Badge in at a fire stairwell** and fight your way to the middle of the
   floor. Every floor is a **hub**: a central ELEVATOR CORE — the only way up —
   with four wings radiating out to the stairs on each side of the plate. In
   co-op the team lands on **four different sides** and has to cut inward
   through the department to meet at the core.
   Enemies die like dropped Lego sets — every body part detaches and tumbles.
   Desks, cabinets, and machines **break for real** (colliders and all).
1. Kill feral coworkers for `$` and XP. Specials and bosses drop **briefcases**:
   wearable clothing across four slots — **HEAD / BODY / LEGS / TRINKET** — that
   every one renders on your character *and* on your teammates', with rarity
   (SENIOR / EXECUTIVE) visible as a glow; plus throwables (`G` — stapler
   grenades, tape balls, coffee molotovs) and consumables (`F`).
1b. **Building your character is the game.** Your class is a *chassis* — the LMB
   weapon and the RMB signature are fixed forever. Everything else is loot:
   two slots hold **punch-card modules**, a SPECIAL on `X` and a PASSIVE that
   quietly rewrites a rule. Specials, elites, KPIs and bosses drop them; trash
   mobs never do. The special cards are the other classes' abilities — find a
   Body Check card as the Intern and you get to shoulder-charge a crowd — and
   the passives change how the game works rather than what your numbers are
   (furniture you break detonates; every kill stuns the neighbours; a killing
   blow leaves you at 1 HP once per floor). Three rarity tiers scale the
   numbers *and* cut the cooldown, a pity timer stops a run of greys, your
   combo at the moment of the kill sweetens the roll, and every department head
   drops **the same card every time** — a jackpot you can plan a run around.
   Pick one up and the difficulty clock stops for 20 seconds, so you actually
   get to feel it.
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
7. Regroup at the core and **call the elevator** — this is the whole back half
   of a floor. Shutters slam down on all four core mouths, the department pours
   in in scripted waves, and at 45% the biome's **FLOOR LEAD** overrides the
   call: the progress bar hard-stops at 90% until you kill them. Then the
   **Department Head** rides down to meet you. Fire them. Board. Ascend.
8. LOBBY → **HUMAN RESOURCES** → **I.T.** → FINANCE → MARKETING → SALES →
   **THE PENTHOUSE**, where the C.E.O. waits (two phases, throne mech, layoff
   shockwaves, quarterly laser).
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
- **Department specials** join the roster per biome: **The Mediator** (HR),
  **The Sysadmin** (IT), **The Live-Streamer** (Marketing).
- **Rares:** **KAREN** (witch — don't provoke her; she one-taps back) and
  **THE AUDITOR** (tank — drops a guaranteed item).
- **Crescendos:** the sealed core holdout + floor lead, fire-alarm boxes
  (shoot = instant horde), exploding espresso machines, popping vending
  machines (free sodas).
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
| 🧯 THE MARKETING MANAGER | **rides an office chair** · CO₂ extinguisher cone (chills crowds) · "Full Send" rocket-boost ram · cannot slide, drifts through turns |
| 🥊 THE FACILITIES GUY | **no weapon — hands** · jab/jab/HAYMAKER combo · "Body Check" shoulder charge · 235 HP, 65% knockback resist |
| ☕ THE BARISTA | unbolted steam wand · **hard falloff cliff at 8m** · "Steam Burst" spends the entire heat gauge at once — run hot for a bigger burst, and the lockout is the price |
| 📐 THE ANALYST | **hold-to-charge** Ledger Rifle — 0.55× panicked, 3.2× fully charged and it pierces the whole line · crits pay ×3 · "Risk Assessment" flags one target for +45% · genuinely helpless in a swarm |

## Departments

Every floor is a biome with its own staff, its own floor lead, and its own way
of killing you. The mob is the mechanic:

| floor | the threat | staff |
|---|---|---|
| **THE LOBBY** | tutorial pressure | Paperlings · Cubicle Drones · Rogue Printers · Roomba-C4 |
| **HUMAN RESOURCES** | *you cannot leave* — slow, wide bodies whose hits **root** you, and each one nearby taxes your movement. Six of them is a cage. | Talent Partners · Intake Coordinators · **The Mediator** (lassos you into a mandatory 1:1 — dash to cut it) |
| **I.T.** | everything is **live** — arcs and EMP fields take your dash, grenade and ability bar offline | Field Technicians (chaining tesla arcs) · Server Racks (walking damage aura) · **The Sysadmin** (drops EMP zones) |
| **FINANCE** | attrition and elites | Copier Golems · Delivery Drones · **The Complainer** |
| **MARKETING** | paper-thin and **endless** — 13 HP each, arriving forty at a time, screaming to pull the whole floor onto you | Brand Interns (scream + throw phones) · Growth Hackers · **The Live-Streamer** (goes live, marks you, summons an audience) |
| **SALES** | commitment — telegraphed charges you have to read | Junior Closers (handshake charge) · **The Micromanager** |
| **THE PENTHOUSE** | every department at once | all of the above |

**Status effects** (chips appear above the crosshair):
📋 **IN A MEETING** — rooted, HR. Diminishing returns mean each successive stun
lands shorter, and **dash always works** — it is the one escape, and it costs
your 3.6s cooldown. ⚡ **SYSTEMS OFFLINE** — IT shock: no dash, no ability, no
grenade. 🪢 **DASH TO BREAK** — the Mediator is reeling you in.
🚧 **BOXED IN** — the crowd tax, up to −60% move speed.

## Architecture

```
src/
  core/    input (pointer-lock), synth audio + generative elevator muzak, math
  game/    game.js (orchestrator) · player (FP/TP rig) · classes (chassis) ·
           modules (punch-card loot: PASSIVE + SPECIAL slots) · enemies ·
           bosses · director · level (seeded floor gen) · items · projectiles ·
           effects · props · characters · meta (localStorage perks)
           bot/   AI teammates that drive the real class kits
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
