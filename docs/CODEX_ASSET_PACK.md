# CODEX ASSET PACK — 2D / UI Production Tasks

Task packet for Codex: every 2D asset J.O.B needs for the HUD 2.0, menus, and the
Steam store page. Work through the tasks in order — Tier 1 unblocks the HUD rework.

## Style guide (applies to every task)

- **Fiction**: corporate office satire. Think "brutalist corporate memo meets arcade
  neon" — sterile business forms that glow like a scoreboard.
- **Palette** (from the game):
  `#FFD23F` money-gold (primary accent) · `#38E1FF` cyan (info/event) ·
  `#FF4D5A` red (danger) · `#58E07C` green (success) · `#FF4FA3` magenta (rare/marketing)
  · surfaces `#101420 → #2A3242` · text `#EEF2F6` / dim `#9AA7B5`.
- **Shape language**: sharp corners with one clipped 45° corner (paper/receipt motif),
  thin 1-2px light borders, subtle scanline/paper-grain texture allowed. NO photoreal,
  NO gradients heavier than 2 stops, NO drop shadows deeper than 4px.
- **Motifs to reuse**: paperclips, staples, sticky notes, punch-cards, org-charts,
  elevator arrows (▲), lanyards, "APPROVED/DENIED" stamps, receipt paper edges.
- **Type**: headline = heavy condensed grotesk (e.g. Archivo Black / Anton, OFL-licensed);
  body/mono = ledger feel (e.g. IBM Plex Mono, OFL). Deliver font choices + license notes.
- **Formats**: SVG masters wherever vector is natural; PNG exports at listed sizes,
  transparent background unless stated. Naming: `assets/ui/<category>/<name>@<scale>.png`.

## Tier 1 — HUD 2.0 (blocks development)

| # | Asset | Spec |
|---|---|---|
| 1.1 | **Game logo** "J.O.B." + tagline "JUST OBEY BUSINESS" | SVG + PNG 2048w; variants: full color, mono-light, mono-dark; badge-only "J.O.B" stamp version |
| 1.2 | **Panel 9-slice set** | 3 skins (default dark, gold-accent, danger) as 9-slice PNG 96×96, corner-clip motif |
| 1.3 | **Button set** | default/hover/pressed/disabled, 9-slice, 2 sizes; plus icon-button square 64px |
| 1.4 | **Ability slot frames** | 128px: primary, secondary, dash, SPECIAL-module slot (distinct plug-in look), PASSIVE-module slot; empty-state + cooldown-overlay ring |
| 1.5 | **Equipment slot icons** | 64px silhouettes: head, body, hands, feet, trinket, passive-chip, special-chip |
| 1.6 | **HP/XP/boss/event bar kit** | caps + fill + frame, horizontal, 9-slice-able; boss bar with tooth-edge "shredder" styling |
| 1.7 | **Combo counter numerals** | 0-9 + "×" in display face, 3 heat states (white/gold/red-hot), PNG sheet |
| 1.8 | **Crosshairs** | 4 styles × 3 states (idle/fire/hit-confirm), 64px, 1.5px strokes |
| 1.9 | **Damage direction indicator** | radial arc sprite, 256px |
| 1.10 | **Rarity frames + gems** | common/uncommon/rare/exec(gold)/contraband(red), 128px frame + 24px gem |

## Tier 2 — Icons (items, modules, upgrades)

All 128px PNG on transparency + SVG master, consistent 3/4 "desk object" angle, thick outline.

- **Item icons (19)**: Lukewarm Coffee, Break Room Donuts, Gym Membership, Instant
  Noodles, Aggressive Paperclips, Motivational Poster, Stock Options, Unpaid Overtime,
  Company Card, Pocket Shredder, Frayed Ethernet Cable, Zoomer Energy, Middle Management
  Badge, Legacy Codebase, Golden Parachute, The Red Stapler, CEO's Fountain Pen,
  Espresso Machine, Crypto Portfolio.
- **Special-attack module icons (10)**: Pink Slip Volley, Cold Call, Tax Audit, Router
  Turret, Mandatory Meeting, Paper Storm, Stapler Airstrike, Golden Handshake,
  Fire Drill Whistle, Reply-All Storm. (Modules read as "punch-card cartridges".)
- **Passive module icons (10)**: Union Rep, Overtime Clause, Remote Worker, Standing
  Desk, Noise-Cancelling Headphones, Corner Office, Two-Weeks-Notice, Team Player,
  Caffeine Tolerance, Golden Handcuffs.
- **Status icons (8)**: wired/haste, slowed, bleeding, marked (gossip goo), latched,
  audited, rallied, shielded.

## Tier 3 — Menus & meta

| # | Asset | Spec |
|---|---|---|
| 3.1 | Archetype portraits ×6 | 512×640 half-body illustrations matching the low-poly triangular 3D style (Bruiser, Janitor, Barista, IT, Intern, Analyst) |
| 3.2 | Floor cards ×4 | 640×360: Finance, Marketing, Sales, Penthouse — used in loading/level-select |
| 3.3 | "PERFORMANCE REVIEW" draft card frames | generic + evolution(★) variants, 480×640 |
| 3.4 | Death/victory stamps | "YOU'RE FIRED." / "PROMOTED." grunge stamp PNGs 1024w |
| 3.5 | Severance shop icons ×5 + frame | Dental Plan, Side Hustle, Standing Desk, Direct Deposit, Wellness Stipend |
| 3.6 | Settings/pause glyph set | 24px line icons: audio, video, mouse, gamepad, back, quit |

## Tier 4 — Steam store page

| # | Asset | Size |
|---|---|---|
| 4.1 | Key art (hero illustration: 6 archetypes riding an elevator into chaos) | 3840×2160 master |
| 4.2 | Header capsule | 460×215 |
| 4.3 | Small capsule | 231×87 |
| 4.4 | Main capsule | 616×353 |
| 4.5 | Vertical/library capsule | 600×900 |
| 4.6 | Library hero + logo overlay | 3840×1240 + logo PNG |
| 4.7 | Page background | 1438×810, darkened |
| 4.8 | Achievement icon template + 10 concretes | 256px: "FIRED THE CEO", "Karen Whisperer", "Employee of the Month", "×50 Combo", "Full Wardrobe", "Speedrun <25:00", "Untouchable Floor", "Shredder Economy", "Team Player (co-op win)", "Loop 3" |
| 4.9 | Animated GIF templates for description | 616×260 frames/borders |

## Acceptance checklist per asset

1. Reads at target size on a 1080p screenshot of the actual game (we'll supply screenshots).
2. Works on both dark game background AND Steam's #1b2838.
3. Source file (SVG/layered) + flattened export both delivered.
4. No copyrighted/trademarked references (no real brand parodies close enough to sue).
