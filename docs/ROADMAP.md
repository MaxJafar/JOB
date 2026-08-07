# J.O.B — ROADMAP: v0.1 prototype → v1.0.0 Early Access

> **Pitch handle:** *Risk of Rain meets Left 4 Dead — in an office tower.*
> **Four-word goal on the title screen:** FIRE THE C.E.O.
>
> Grounded in [DESIGN_DIGEST.md](DESIGN_DIGEST.md) — 195 principles mined from
> Schell's *The Art of Game Design* and Killick's *Game Design: How Games Are Made*,
> distilled to 9 workstreams. Digest references below look like *(D 3.2)*.
> Asset production runs in parallel via [CODEX_ASSET_PACK.md](CODEX_ASSET_PACK.md) (2D/UI)
> and [MESHY_ASSET_PACK.md](MESHY_ASSET_PACK.md) (3D).

---

## 0. Design pillars (every feature must serve one)

1. **The toy comes first** — movement + hitting things must be fun with zero objectives *(D 5.1: Toy Test)*.
2. **Building your character IS the game** — archetype chassis + loot-filled slots + drafts = the core loop.
3. **The office is alive** — director pacing, destructibility, satire; everything wears the corporate skin *(D 9.6: theme unity)*.
4. **No unfair deaths, no hafta** — telegraphs + death recaps *(D 8.2)*; aspiration-only retention *(D 8.3)*.

**Cut-safe v1.0 definition** *(D 9.3 — decide now, not in a crunch)*:
4 floors, **4 of 6** archetypes, equipment system with 2 module slots + 3 gear slots,
2 new specials, HUD 2.0, Finance at vertical-slice quality, Steam co-op. Everything
beyond that is upside, not promise.

---

## 1. Version plan

Effort: S = days, M = 1–2 weeks, L = 2–4 weeks (part-time adjusted). Each version ends
with a tagged playable build + a written playtest question list *(D 9.4)*.

### v0.2 — "FOUNDATIONS" (engineering multiplier) — M
*The single highest-leverage step of the whole EA period (D Top-10 #1).*
- [ ] Externalize ALL tuning to hot-reloadable JSON: spawn tables, director curves,
      class stats, item/module tables, wave compositions (`/data/*.json`).
- [ ] In-game debug panel (` key): floor select, grant loot, force events, spawn any
      enemy, time-scale override, god mode, telemetry overlay.
- [ ] Local telemetry from day one *(D 9.5)*: per-run JSON log — class, drafts offered/
      taken, per-floor time, death cause+position, combo peaks, KPIs. Ship-ready for
      opt-in upload later.
- [ ] Toy-test sandbox floor (no objectives, dense destructibles, respawning dummies).
- **Gate:** balance change = JSON edit + hot reload, no rebuild. 10-minute sandbox
  session is genuinely fun or v0.3 waits for a feel pass.

### ✅ v0.2.5 — "PHYSICS & POCKETS" (shipped early, pulled forward from v0.5/v0.7)
- [x] **Lego death physics**: every enemy/boss/player shatters into tumbling body
      parts with bounce physics (capped gib pool). *(user request; D 5.3/5.6 eventful deaths)*
- [x] **Breakable environment**: desks, cabinets, copiers, machines shatter and their
      colliders die with them; breaking pays (sodas/cash) *(D 2.6 — no empty dead ends)*.
- [x] **Reload & magazine mechanics** for ranged classes + IT overheat gauge; ammo HUD.
- [x] **Throwables (G)** — Stapler Grenade / Tape Ball / Coffee Molotov; **consumables
      (F)**; **Tab inventory** with 3 wearable slots (head/body/trinket) — looted
      clothing renders on the character with rarity-scaled stats *(v0.5 seed)*.
- [x] **THE LOBBY** ground floor + GUS DUTY (Head of Security) boss — the run now
      starts at street level and climbs: LOBBY → FINANCE → MARKETING → SALES → PENTHOUSE.
- [x] Melee feel pass 1: slash arc trails + forward lunge on every swing.

### ✅ v0.3 — "FLOOR PLAN + FLOOR ECONOMY" (shipped core; polish ongoing)
- [x] Room-graph floors replace the open box: ENTRY → corridor → BULLPEN → corridor →
      **sealed WAVE ARENA** → corridor → ELEVATOR HALL, plus paid side rooms
      (VAULT / FACILITIES / BREAK ROOM) behind **Department-Budget** security doors.
- [x] **Department Budget** — shared team currency from kills; buys doors + the
      **FLOOR BREAKER** switch (+40% money, office aggression up) *(Zombies-style
      spatial economy per advisor doc)*.
- [x] **SECURITY LOCKDOWN** — entering the arena seals it: 3 escalating waves that
      spawn inside, specials from wave 2, panic rule on stragglers, then loot + budget
      + protected rest valley.
- [x] Visual redesign pass 1: real ceilings with glowing panel grids, doorway headers
      + room signs, accent trim strips, per-room-type accent lights, dimmer moodier
      base lighting, elevator nav arrow + room-discovery announcements.
- [ ] Still open (v0.3.x): corridor hazards variety, fast/risky vs slow/safe dual
      routes, per-floor utility themes, greybox metrics audit vs co-op widths.

**Adopted from the architecture review (tracked for v0.35 "ENGINE HARDENING"):**
fixed-timestep simulation loop with interpolation; Rapier character capsule;
three-mesh-bvh raycasts; attack-token crowd choreography; AI update-frequency tiers;
recast-navigation for specials; postprocessing (small stack); tweakpane debug panel;
howler audio voice manager; MultiplayerTransport interface (WebSocket / loopback /
Steam Networking Messages — NOT deprecated ISteamNetworking); Electron context
isolation for steamworks bridge; roster freeze (Bruiser/Janitor/Barista/IT/Intern/
Analyst); reduced always-on HUD.

### ~~v0.3 — "FLOOR PLAN" (corridor + wave level design)~~ — merged above
*User request: corridors + waves so we have arena AND level design.*
- [ ] Room-graph floor generator replacing single-box arenas: **lobby → corridor →
      mini-arena → corridor → wave arena → corridor → elevator arena**, built from
      greyboxed room prefabs *(D 2.5: metrics kit first — 1u=1m, interiors 1.25–1.5×
      real scale, corridor width ≥ 3 player-widths for co-op)*.
- [ ] Spatial contract *(D 2.1)*: open bullpens = hordes; tight server rooms = exactly
      one special; thresholds marked by door frames + lighting shift + music layer.
- [ ] Corridors carry tension, never transit *(D 2.2)*: vaultable desks, hazards, mob
      trickles feeding combo, loot closets; any 10-dead-second stretch gets cut.
- [ ] **Wave arenas**: enter → doors seal → 2–3 scripted wave beats with the panic rule
      (last 20% of a wave gains speed/aggression — auto-crescendo, D 1.5) → loot shower
      + 30–60s protected rest valley *(D 1.3)*.
- [ ] Navigation: one weenie landmark per floor (stock ticker / neon logo / golden
      elevator glow), carpet guide-lines, unique landmark props per chunk *(D 2.3)*.
- [ ] Asymmetric routes: fast/risky vs slow/safe; paid dead ends (elite-guarded chest
      closets); near-cleared specials retreat toward the next arena to pull players
      forward *(D 2.6)*.
- **Gate:** greybox Finance floor beats the v0.1 box arena in blind A/B playtest;
  time-to-elevator within budget (8–12 min).

### v0.4 — "NEW HIRES" (archetype + slot system rework) — L
*User request: 2 melee / 2 short / 2 long, passive + special slots filled by loot.*
- [ ] Archetype chassis system (see §2 spec): fixed signature ability loot can never
      replace, three-word identity, one designed weakness *(D 4.2, 4.3)*.
- [ ] **Module slots**: PASSIVE slot + SPECIAL-ATTACK slot, filled by dropped
      punch-card modules; old class abilities (Pink Slips, Cold Call, Tax Audit,
      Router Turret, Mandatory Meeting…) become the first 10 SPECIAL modules —
      full content reuse.
- [ ] Drop rules *(D 3.3, 3.4)*: modules drop from specials/elites/KPIs/bosses only —
      never trash mobs; rarity tiers upgrade module numbers; pity timer on rare+;
      boss signature modules are deterministic jackpots.
- [ ] Sawtooth protection *(D 1.2)*: difficulty tick suppressed 20s after module
      pickup/draft so every power spike gets tasted.
- [ ] Combo → loot wiring *(D 3.1 detour test)*: combo tier at kill raises drop-rarity
      roll; KPI completion pays rerolls/module slots/elevator discounts.
- **Gate:** telemetry shows every archetype picked ≥10% and no module >50% pick-rate
  *(D 3.5)*; "patch my weakness vs amplify my strength" visibly drives draft choices.

### v0.5 — "DRESS CODE" (equipment & visible gear) — M
*User request: equipment, loot, clothing with effects.*
- [ ] Gear slots: HEAD / BODY / HANDS / FEET / TRINKET — stat + behavior effects,
      system-crossers not stat-sticks *(D 3.5)*; 2-dice stat rolls *(D 3.3)*.
- [ ] **Everything renders on the character** with rarity-tier visual escalation
      *(D 3.6 — trophies, social proof, free HUD)*. Bruiser's braces are gear tier 1→3.
- [ ] Set bonuses (Gym Set, C-Suite Set, Facilities Set) + one "contraband" trade-off
      tier extending v0.2's badge/legacy/crypto line.
- [ ] Equipment screen (Tab) + compare tooltips; gear drops use gift-wrap ritual:
      rarity-colored briefcase + reveal *(D 3.4)*.
- **Gate:** a teammate's build is readable at a glance in co-op from 15m.

### v0.6 — "SECURITY ALERT" (specials + director 2.0) — M
*User request: more special mobs (Tank-likes etc.).*
- [ ] New specials: **SECURITY GUARD** (Charger: grab-carry-slam), **THE LITIGATOR**
      (Smoker: red-tape pull), **THE STAKEHOLDER** (roaming mini-tank). Each hardest
      for one range band, easiest for another *(D 4.4 rock-paper-scissors)*.
- [ ] Signature audio BEFORE visual per special *(D 5.4 — the L4D clicker pattern)*.
- [ ] Director 2.0 *(D 1.1–1.6)*: fractal interest curve (wave < floor < run);
      composition-first scaling — count → speed → tier mix, HARD CAP on HP multipliers,
      guard-bars past the cap *(D 1.4)*; **security purge** forced climax at ~40 min
      so no run flabs out *(D 1.6)*.
- [ ] Death recap ("Terminated by: THE LITIGATOR — red tape") + telegraph audit: every
      special attack escapable with one dash *(D 5.6, 8.2)*.
- **Gate:** deaths-over-time telemetry graphs as a rising sawtooth peaking at Penthouse;
  zero "that felt unfair" in exit interviews.

### v0.7 — "GLOW UP" (art, animation, juice) — L
*User request: unique triangular low-poly characters, fluid animations, hit effects, SFX, vibrant arenas.*
- [ ] **Meshy pipeline** (see MESHY_ASSET_PACK): 6 archetypes + 9 specials + 4 bosses,
      faceted triangular style, auto-rigged GLB → `GLTFLoader` + `AnimationMixer`
      state machine (idle↔run blend, attack interrupts, 80–140ms crossfades).
- [ ] Animation law *(D 5.2, 5.5)*: input→response <100ms, basic attacks fire frame-1,
      snappy exaggerated poses (never mocap-smooth), elites strut / interns scurry.
- [ ] Hit feedback stack *(D 5.3)*: hitstop + flash + flinch + particles + number +
      tiered SFX + shake on EVERY hit; slow-mo on wave-enders; weapon trails; paper
      confetti physics everywhere.
- [ ] Arena vibrancy pass: hero props per floor (aquarium, ticker wall, neon signage),
      color-graded lighting per floor, exterior window life; readability law — style
      never costs silhouette clarity *(D 5.5)*.
- [ ] Audio pass: hit-confirm first, combo pitch-escalation second, special signatures
      third *(D 5.4)*; layered music states (corridor/wave/elevator/boss).
- **Gate:** the Toy Test again, post-art: 10 grinning minutes in the sandbox.

### v0.8 — "FIRST DAY" (onboarding + HUD 2.0) — M
*User request: improved HUD. Digest: the first 15 minutes decide refunds (D Top-10 #6).*
- [ ] 60-second hook: cold-open lobby brawl before any menu *(D 7.1)*.
- [ ] Floor-1 invisible tutorial *(D 7.2)*: corridor teaches movement on harmless
      drones; mini-arena force-teaches combo; first special appears alone; scripted
      lighter first elevator; director near-flat for 5 minutes *(D 7.3)*.
- [ ] HUD 2.0 with Codex assets: info ranked by need *(D 6.1)*, gradual element
      introduction *(D 6.2)*, corporate-software theming — Excel KPI panel, Outlook
      toasts *(D 6.3)*, unmistakable mode banners *(D 6.4)*, degrading class portrait +
      directional damage *(D 6.5)*.
- [ ] Funnel targets wired into telemetry: 60% of first-timers reach Floor 2; 25%
      ever beat the CEO *(D 7.3)*.
- [ ] In-world special intros: HR memos, PA warnings, hazard posters *(D 7.6)*.

### v0.9 — "IPO PREP" (retention, Steam, hardening) — L
- [ ] **Performance Review end screen** *(D 8.1, 8.2 — the retention engine and our
      theme's perfect feature)*: letter grades vs personal bests, near-miss framing
      ("87% to the Sales elevator"), banked Severance, one unlock progressed, tease of
      what was missed, suggested next archetype, shareable run card *(D 8.4)*.
- [ ] Elder game *(D 8.5)*: post-win stacking modifiers (Overtime → Crunch → Death
      March), weekly seeded run, per-archetype mastery tracks with earned-only cosmetics.
- [ ] Co-op glue *(D 8.6)*: instanced loot, contribution-scaled boss bonuses, revive
      credit, per-player post-run awards, one-click rematch, persistent lobby codes.
- [ ] Steam: Electron packaging Win+Mac, steamworks.js — achievements, cloud saves,
      rich presence, SDR lobbies replacing the WS relay (STEAM.md plan).
- [ ] Perf hardening: 60fps at max wave density in 4-player co-op *(D 9.2 risk #2)*;
      crash telemetry; soak tests.
- [ ] Closed playtest via Steam Playtest: two cohorts (RoR/L4D veterans + novices) with
      separate funnels, standing repeat cohort for run-#20 truth *(D 9.4)*.

### v1.0.0 — "GRAND OPENING" (EA launch) — M
- [ ] Finance floor at TRUE ship quality first (vertical slice), then propagate
      *(D 9.3 — learn cost-per-floor before promising content cadence)*.
- [ ] Content complete vs cut-safe list; balance from playtest telemetry only.
- [ ] Store page: capsules + trailer opening on 10 seconds of raw wave combat with the
      pitch handle *(D 9.6)*; achievements live; press/creator kit.
- [ ] Launch gate = Schell's Eight Filters pass *(D 9.6)* + funnel targets met + zero
      known unfair-death reports in final playtest round.
- [ ] Post-launch cadence commitment: one patch per 2–4 weeks, each answering ONE
      measured churn point, public "problem heard → change made" changelog *(D 9.5, 9.6)*.

---

## 2. Archetype spec (v0.4) — the six new hires

Function-first grid *(D 4.1)*; each: signature ability (never replaced by loot),
three-word identity, one designed weakness, distinct demanded skill *(D 4.2, 4.3)*.
Old HR/Sales/Accountant kits become loot modules — nothing is wasted.

| | Archetype | Range | Signature (fixed) | Identity | Weakness | Skill demanded |
|---|---|---|---|---|---|---|
| 🥊 | **THE BRUISER** — jacked, fists only, wrap "braces" as tiered gear | Melee | *Haymaker combo* — L-L-uppercut chain; shoulder-charge gap closer | Loud, unstoppable, close | No answer to flyers | commitment & spacing |
| 🧹 | **THE JANITOR** | Melee | *Clean Sweep + Lid Block* (kept — beloved) | Patient, immovable, wide | Single-target DPS | crowd positioning |
| ☕ | **THE BARISTA** | Short | *Steam Burst* — scalding cone; overheat management | Hot, hissing, hazardous | Damage falls off past 8m | risk management |
| 💻 | **IT SUPPORT** | Short | *Bandwidth Beam* — chain lightning (kept) | Precise, tethered, humming | Must stand still-ish to ramp | target priority |
| 📎 | **THE INTERN** | Long | *Dual Staplers* — balanced burst pistols | Eager, scrappy, everywhere | Jack of all, master of none | kiting rhythm |
| 📐 | **THE ANALYST** | Long | *Ledger Rifle* — charged piercing shots, crit scaling | Cold, patient, surgical | Helpless in swarm range | aim & patience |

**Support note** *(D 4.5)*: one true ally-only support belongs in the roster long-term.
v1.0 compromise: BARISTA's overheat vents as an ally speed/heal aura in co-op —
promoted to a full 7th support archetype post-EA if co-op data supports it.

**Slots per archetype:** 1 PASSIVE module + 1 SPECIAL-ATTACK module (loot punch-cards),
5 gear slots (head/body/hands/feet/trinket), plus level-up drafts. Build identity =
chassis × modules × gear × drafts.

---

## 3. Production tracks (run in parallel with versions)

| Track | Owner | Packet | Feeds |
|---|---|---|---|
| 2D/UI assets (logo, HUD kit, icons, capsules) | **Codex** | [CODEX_ASSET_PACK.md](CODEX_ASSET_PACK.md) | v0.8 HUD, v1.0 store |
| 3D characters/gear/props | **Meshy** (user triggers generation, we integrate) | [MESHY_ASSET_PACK.md](MESHY_ASSET_PACK.md) | v0.7 |
| Design tuning & balance | Claude + telemetry | /data JSON + digest | every version |
| Playtests | User + cohorts | question lists per version | gates |

**Meshy note:** the packet is ready — say the word and we start with the BRUISER +
one special (SECURITY GUARD) as pipeline pilots before batch-generating the rest.

---

## 4. Risk register *(D 9.2 — greybox-test each before art money)*

| # | Risk | Test | Fallback |
|---|---|---|---|
| 1 | Corridor+wave isn't more fun than the box arena | v0.3 blind A/B | keep arenas, add wave events only |
| 2 | three.js can't hold 60fps at max density in netcode co-op | v0.2 stress scene | lower caps, instanced meshes, simplify shadows |
| 3 | 6 archetypes × modules × gear produces broken/boring builds | v0.4 telemetry + card-mock the economy in an afternoon | shrink module pool, curate combos |
| 4 | Self-hosted co-op friction kills session starts | measure lobby completion rate | prioritize Steam SDR earlier |
| 5 | Meshy rigs fail QA / animations feel mushy | v0.7 pilot (2 models) | keep upgraded procedural rigs; Meshy for statics only |
| 6 | Solo dev bandwidth | 50% rule already applied | cut-safe list is the contract |

---

## 5. Immediate next actions (this week)

1. **v0.2 FOUNDATIONS build** — JSON tuning + debug panel + telemetry + sandbox floor.
2. Codex starts **Tier 1** of the asset pack (logo + HUD kit).
3. Meshy pilot: **BRUISER** + **SECURITY GUARD** prompts from the packet → user runs
   generation → we integrate via GLTF pipeline spike.
4. Beat-chart one full run on paper (enemies/loot/mood per floor) to spot progression
   clumps before v0.3 *(Killick's beat chart)*.
5. First scripted playtest with the question list: "Do players detour for KPIs?
   Does anyone pick melee and survive? Which death felt unfair?"
