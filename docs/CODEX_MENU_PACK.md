# CODEX MENU PACK — Tier 3: menus, player selection & meta screens

> **Task packet for Codex.** Produce every 2D asset the menu layer needs, from
> scratch, and wire it into the running game. This is Tier 3 of
> [`CODEX_ASSET_PACK.md`](CODEX_ASSET_PACK.md) — Tier 1 (HUD) shipped; Tier 3
> was specced and never produced. Every menu screen currently renders emoji
> where art should be.

**Packet version:** `menu-pack-v1`
**Generator to add:** `scripts/generate_menu_assets.py`
**Style lock:** [`docs/art/asset_style_lock.json`](art/asset_style_lock.json) `1.0.0`
**Art bible:** [`docs/art/ASSET_ART_BIBLE.md`](art/ASSET_ART_BIBLE.md) `1.0.0`

---

## 0. The job in one paragraph

`src/ui/menus.js` renders nine screens. Every one of them uses **emoji as
placeholder art** — `📎🧹🧮📁💻📇🧯🥊☕📐` for the ten playable classes,
`❤️💪🏃💰🧘` for the five Severance perks, `▶🌐💵📋⚙🚪↻🏠∞🎭🔌✖⏸➕` scattered
across buttons and slots. Emoji render differently on every platform, ignore the
palette, and break the flat-plate visual language the HUD already established.

Replace all of it with generated vector art, then update `menus.js` and
`style.css` so the new assets actually render. When you are done, a player should
be able to go title → class select → party setup → run → death screen and never
see a system emoji.

---

## 1. Non-negotiables

These come from the art bible and style lock. A deliverable that violates one is
rejected regardless of how good it looks.

**Palette — these exact values, no drift:**

| token | hex | meaning |
|---|---|---|
| money-gold | `#FFD23F` | money, primary action, selection |
| cyan | `#38E1FF` | info, event, network |
| red | `#FF4D5A` | danger, denial, termination |
| green | `#58E07C` | success, owned, affordable |
| magenta | `#FF4FA3` | rare / marketing |
| surface dark | `#101420` | plate fill |
| surface | `#2A3242` | raised fill |
| line | `#6B7483` | borders |
| text | `#EEF2F6` | primary ink |
| dim | `#9AA7B5` | secondary ink |

**Shape language:** sharp rectangles with **one clipped 45° corner** (the
paper/receipt motif), 1–2px light borders, quiet stretch-safe centres, front-on
orthographic, at most two tonal steps, no shadow deeper than 4px.

**Forbidden:** photorealism, painterly rendering, gradients heavier than 2 stops,
rounded pills, neumorphism, glassmorphism, deep drop shadows, baked text in
anything except the logo and the two verdict stamps, real-brand similarity,
AI-rendered imagery, palette drift.

**Text strategy:** live engine text everywhere. Plates have quiet centres; labels
stay in HTML. The only assets allowed to carry baked letterforms are
`stamp-fired` and `stamp-promoted` (§5.8), because they are display marks, not
labels.

**Motifs to reach for:** paperclips, staples, sticky notes, punch cards,
org-charts, elevator arrows (▲), lanyards, APPROVED/DENIED stamps, receipt paper
edges, registration marks, ledger rules, perforation lines.

---

## 2. Pipeline contract

Follow the Tier 1 pipeline exactly. Read
[`scripts/generate_hud_assets.py`](../scripts/generate_hud_assets.py) first — it
is 650 lines and it is the template for everything below.

**Create `scripts/generate_menu_assets.py`.** Do not modify the Tier 1 generator
except to extract shared helpers (see §2.2).

### 2.1 What the generator must do

1. Write an **SVG master** and a **deterministic RGBA PNG derivative** for every
   asset, via the existing `save_svg_png(rel_stem, svg, image)` pattern:
   `assets/ui/<category>/<name>.svg` + `assets/ui/<category>/<name>@1x.png`.
2. Keep PNG corners **transparent** for every overlay asset.
3. Call `sync_public_assets()` — the game loads from `/assets/ui/…`, which Vite
   serves out of `public/assets/ui/`. **An asset that is not mirrored does not
   exist at runtime.** This is the single most common way to "finish" this task
   and see nothing change on screen.
4. Rewrite the table in [`docs/art/ASSET_LEDGER.md`](art/ASSET_LEDGER.md) between
   the `<!-- GENERATED_LEDGER_START -->` / `<!-- GENERATED_LEDGER_END -->`
   markers — path, dimensions, first 12 chars of SHA-256, review state
   `development_candidate`. Preserve the markers. Merge with the Tier 1 rows
   rather than replacing them; the ledger is one table for all families.
5. Be **byte-for-byte reproducible.** Running it twice must produce identical
   hashes. No timestamps, no RNG without a fixed seed, no dict-ordering
   dependence.

Run it with:

```bash
python scripts/generate_menu_assets.py
```

### 2.2 Shared helpers

`rgb`, `rgba`, `ensure`, `write_text`, `svg_doc`, `poly`, `clipped_points`,
`save_svg_png`, `sync_public_assets`, `font`, `fit_font` and the colour
constants all already exist in `generate_hud_assets.py`. Extract them into
`scripts/_asset_lib.py` and import from both generators. Keep the Tier 1 output
hashes **unchanged** by that refactor — verify by regenerating and diffing the
ledger. If a hash moves, the refactor changed behaviour and is wrong.

### 2.3 Fix the font resolution while you are in there

The Tier 1 generator hardcodes Windows paths:

```python
fit_font("J.O.B.", 800, 300, "C:/Windows/Fonts/arialbd.ttf")
font("C:/Windows/Fonts/consolab.ttf", 54)
```

This crashes on Linux and macOS, so the asset pipeline cannot run in CI or for
any contributor on another OS. Add a `resolve_font(role)` helper to
`_asset_lib.py` that tries, in order:

1. A project-local font directory (`assets/fonts/`) if present.
2. Per-platform system paths for the display face (Archivo Black → Bahnschrift →
   Arial Black → DejaVu Sans Bold) and ledger face (IBM Plex Mono → Cascadia
   Mono → Consolas → DejaVu Sans Mono).
3. `ImageFont.load_default()` as a last resort, with a printed warning.

Record whatever it resolved to in the ledger header so a hash mismatch between
two machines is explainable. See [`docs/art/FONTS.md`](art/FONTS.md) for the
licensing intent.

---

## 3. Screen-by-screen inventory

Every screen below is a real function in
[`src/ui/menus.js`](../src/ui/menus.js). Line references are current as of
`menu-pack-v1`.

| screen | function | current placeholder art |
|---|---|---|
| Title | `showTitle()` :26 | 5 emoji buttons, no backdrop |
| **Class select** | `showClassSelect()` :56 | **10 emoji at 34px** |
| Party setup | `showPartySetup()` :101 | emoji faces, native `<select>` |
| Motivation shop | `showMotivation()` :174 | 5 emoji, CSS pips |
| Handbook | `showHowTo()` :214 | bare `<kbd>`, 5 emoji in prose |
| Settings | `showSettings()` :249 | native range/checkbox |
| Pause | `showPause()` :287 | 3 emoji buttons |
| Death / Victory | `showDeath()` :310 / `showVictory()` :338 | CSS text-shadow only |
| Co-op lobby | `showLobby()` :422 | emoji buttons, CSS tags |

---

## 4. Milestones

Land these in order. Each is independently reviewable and leaves the game in a
working state. Do not open one PR for all five.

| # | milestone | unblocks |
|---|---|---|
| **M1** | Glyph set + menu plates (§5.1, §5.2) | everything else |
| **M2** | **Class select** — emblems, cards, stat glyphs (§5.3) | the headline screen |
| **M3** | Party setup + lobby (§5.4, §5.5) | co-op flow |
| **M4** | Shop + settings + pause (§5.6, §5.7) | meta flow |
| **M5** | Verdict stamps + handbook (§5.8, §5.9) | run bookends |

---

## 5. Asset specifications

Dimensions are the SVG master viewBox and the `@1x` PNG size unless stated.
`state` variants each get their own file: `<name>-<state>.svg`.

### 5.1 Menu glyph set → `assets/ui/glyphs/`

Replaces every emoji in a button or label. **24×24 master** (line weight 2px)
plus a **48×48** derivative for slot faces and empty states.

| file stem | replaces | drawing |
|---|---|---|
| `clock-in` | ▶ | elevator ▲ inside a punched time-card notch |
| `network` | 🌐 | three org-chart nodes joined by rules |
| `severance` | 💵 | banded banknote with a clipped corner |
| `handbook` | 📋 | clipboard with two ledger rules |
| `settings` | ⚙ | 6-tooth square-cut gear, flat |
| `back` | ← | left chevron with a tail rule |
| `pause` | ⏸ | two bars in a clipped plate |
| `quit` | 🚪 | door with a directional arrow |
| `retry` | ↻ | rotary arrow, square corners |
| `home` | 🏠 | building silhouette, not a house |
| `loop` | ∞ | two linked rectangles |
| `role` | 🎭 | lanyard badge on a clip |
| `connect` | 🔌 | ethernet plug end-on |
| `close` | ✖ | 45° cross |
| `add` | ➕ | plus in a dashed empty-slot square |
| `check` | ✓ | stamped tick |
| `lock` | — | padlock, square shackle |
| `live` | ● | filled dot + concentric ring (static; CSS animates) |
| `caret` | ▾ | down chevron for `<details>` / select |
| `host` / `guest` | — | two lanyard tags, gold and dim |

**States:** each glyph in `default` (`#EEF2F6`), plus `gold` and `dim` variants
for `clock-in`, `severance`, `check`, `live`, `host`. Everything else takes
colour from CSS via `currentColor` in the SVG — set `fill="currentColor"` on the
master so a single file serves all tints, and only emit tinted PNGs where the
`<img>` path is used.

### 5.2 Menu plates → `assets/ui/menuplates/`

| file stem | size | states | notes |
|---|---|---|---|
| `menu-button-wide` | 420×72 | default · hover · pressed · disabled · primary · danger | 9-slice, 16px clipped corner, quiet centre; the existing `buttons/` set is HUD-scale and too small for menu rows |
| `screen-backdrop` | 1920×1080 | — | tower/elevator-shaft silhouette at ≤8% opacity, ledger rules, perforation edge. Must not compete with foreground text |
| `screen-header-rule` | 960×24 | — | section rule with registration marks, for `<h2>` |
| `stat-strip` | 720×48 | — | thin receipt strip for the title screen's runs/wins/version line |
| `overlay-scrim` | 512×512 | — | tileable low-opacity scanline for `.screen.overlay` |
| `divider` | 640×8 | — | perforated tear line |

### 5.3 Class select — the headline screen → `assets/ui/classes/`

This is the screen the packet exists for. Ten classes, currently ten emoji.

**Emblems.** `emblem-<key>.svg` at **128×128**, plus a **64×64** PNG derivative.
Constructed geometric badge marks — flat, front-on, two tonal steps, readable at
32px. Each sits on the clipped-corner plate motif with the class accent as the
border. **No faces, no characters** — these are department badges, not portraits.

| key | class | title | emblem subject |
|---|---|---|---|
| `intern` | THE INTERN | Stapler Specialist | stapler, jaws open, one staple ejected |
| `janitor` | THE JANITOR | Custodial Enforcer | broom head crossed with a trash lid |
| `accountant` | THE ACCOUNTANT | Forensic Number-Cruncher | calculator keypad grid, one key lit gold |
| `hr` | THE HR REP | Chief Vibes Officer | manila folder, corner clipped, pink slip edge |
| `it` | IT SUPPORT | Have You Tried Rebooting | RJ45 plug with a chaining arc |
| `sales` | THE SALES REP | Always Be Closing | business card fan, three cards, motion rules |
| `marketing` | THE MARKETING MANAGER | Never Left The Chair | office chair castor + extinguisher nozzle cone |
| `brawler` | THE FACILITIES GUY | Built Like A Vending Machine | clenched fist as a bolted plate, knuckle rivets |
| `barista` | THE BARISTA | Third Wave, Second Shift | steam wand with three steam rules + heat gauge arc |
| `analyst` | THE ANALYST | Cold, Patient, Surgical | ruler edge crossed with a scope reticle |

Accent assignment: gold for `intern` / `accountant` / `sales` (economy kits),
cyan for `it` / `analyst` (tech kits), red for `brawler` / `marketing`
(aggression kits), green for `janitor` / `hr` (sustain kits), magenta for
`barista`. Border only — the emblem body stays `#EEF2F6` on `#101420`.

**Card frame.** `class-card-<state>.svg`, **232×320**, 9-slice, states
`default` · `hover` · `selected`. The grid is `repeat(4, 232px)` at
[`style.css:235`](../src/style.css:235), so 232 is fixed — do not change it
without changing the grid. Selected state carries a gold border plus a corner
`APPROVED` registration mark (mark only, no word).

**Supporting:**

| file stem | size | notes |
|---|---|---|
| `stat-glyph-hp` / `-spd` / `-dmg` | 16×16 | ledger-style micro icons for the `.cstats` row |
| `stat-track` + `stat-fill` | 64×6 | micro bar for stat comparison; fill is a separate file so CSS can scale it |
| `keycap-lmb` / `-rmb` | 32×24 | mouse-button caps for the `.skill-line` row |
| `role-tag` | 96×22 | small chip plate behind the class `title` |

### 5.4 Party setup → `assets/ui/party/`

| file stem | size | states | notes |
|---|---|---|---|
| `slot-plate` | 200×260 | `you` · `filled` · `empty` · `hover` | `you` is gold-bordered; `empty` is a dashed punch-card outline |
| `slot-badge-you` | 88×28 | — | lanyard tag reading position for live "YOU" text (no baked word) |
| `select-chrome` | 168×32 | default · open | plate behind the native `<select>`; pair with `glyphs/caret` |
| `autofill` | 48×48 | — | three org-chart nodes snapping into a row |

The empty slot currently shows `➕` at [`menus.js:115`](../src/ui/menus.js:115) —
that becomes `glyphs/add` at 48px centred in `slot-plate-empty`.

### 5.5 Co-op lobby → `assets/ui/lobby/`

| file stem | size | states | notes |
|---|---|---|---|
| `room-row` | 640×56 | `waiting` · `in-run` · `full` | full is dimmed and non-interactive |
| `roster-row` | 640×40 | — | quieter plate for the connected-player list |
| `tag` | 96×22 | `waiting` · `run` · `full` · `host` · `guest` | status chips; live text on top |
| `input-field` | 320×44 | default · focus | plate behind `#mp-name`, `#mp-url`, `#mp-room` |
| `status-strip` | 720×36 | `idle` · `connecting` · `error` | behind `.mp-status` |

### 5.6 Motivation shop → `assets/ui/severance/`

Perk icons at **128×128** + 64px derivative. IDs are from
[`src/game/meta.js:6`](../src/game/meta.js:6) — the filename must match the perk
`id`, not the display name.

| id | display name | icon subject |
|---|---|---|
| `vitality` | DENTAL PLAN | molar on an insurance-form grid |
| `hustle` | SIDE HUSTLE | two-arrow upward chart on a moonlit desk plate |
| `cardio` | STANDING DESK | desk raised on a piston, height rules |
| `income` | DIRECT DEPOSIT | banknote entering a slot, arrow down |
| `wellness` | WELLNESS STIPEND | seated figure abstracted to three stacked rects |

| file stem | size | states | notes |
|---|---|---|---|
| `perk-row` | 560×84 | `affordable` · `unaffordable` · `maxed` | maxed gets a green edge; unaffordable dims to `#6B7483` |
| `perk-pip` | 22×6 | `empty` · `filled` | replaces the CSS pips at [`style.css:259`](../src/style.css:259) |
| `balance-plate` | 400×56 | — | receipt strip for `SEVERANCE BALANCE` |

### 5.7 Settings & pause → `assets/ui/controls/`

| file stem | size | states | notes |
|---|---|---|---|
| `slider-track` | 240×8 | — | ledger rule with tick marks |
| `slider-fill` | 240×8 | — | gold, separate file so CSS scales width |
| `slider-thumb` | 20×28 | default · active | punch-card tab, clipped corner |
| `checkbox` | 24×24 | `off` · `on` | `on` uses `glyphs/check` in gold |
| `setting-row` | 560×48 | — | quiet plate |
| `pause-header` | 480×96 | — | ON BREAK plate with perforated edges (no baked word) |

Native `<input type="range">` and `<input type="checkbox">` need
`appearance: none` plus `::-webkit-slider-thumb` / `::-moz-range-thumb` rules to
accept these. Style **both** vendor prefixes — Firefox silently ignores the
WebKit pseudo-element and you will ship a half-skinned slider.

### 5.8 Verdict stamps → `assets/ui/verdict/`

The two assets allowed baked letterforms.

| file stem | size | notes |
|---|---|---|
| `stamp-fired` | 1024×420 | `YOU'RE FIRED.` — red `#FF4D5A`, rotated −4°, distressed edge via deterministic mask (fixed seed), ink-starved corners |
| `stamp-promoted` | 1024×420 | `PROMOTED.` — gold `#FFD23F`, rotated +3°, same treatment |
| `run-stats-plate` | 720×140 | 4-cell ledger grid, quiet cells |
| `severance-receipt` | 480×64 | perforated deposit strip |

Both stamps use the display face via `resolve_font('display')`. Because they
bake text, note the resolved font in the ledger — a font substitution changes
the hash and that must be explainable, not mysterious.

`.big-verdict` at [`style.css:265`](../src/style.css:265) is currently an 84px
text node with a text-shadow. Replace the text node with the stamp image and keep
the text as the `alt` attribute.

### 5.9 Handbook → `assets/ui/handbook/`

| file stem | size | notes |
|---|---|---|
| `keycap-1u` | 40×40 | 9-sliceable so `Shift` / `Space` stretch from one master |
| `keycap-wide` | 80×40 | for `Space`, `Ctrl` |
| `keycap-mouse` | 40×52 | LMB/RMB body with the active button highlighted |
| `section-rule` | 640×20 | between `<h4>` blocks |

**Troublemaker thumbnails**, 96×96, `threat-<key>.svg` — geometric, matching the
enemy silhouettes, replacing the emoji at
[`menus.js:234-238`](../src/ui/menus.js:234): `gossip` (speech-bubble cloud),
`complainer` (cup with spill arc), `micromanager` (spectacles over a clipboard),
`karen` (asymmetric bob silhouette), `auditor` (receipt column with a seal).

---

## 6. Wiring tasks

Assets that nothing renders are not done. Three files change.

### 6.1 `src/ui/menus.js`

Replace every emoji with an asset reference. Two mechanisms:

**Glyphs in buttons** — inline `<span>` with a CSS mask so the glyph inherits
button colour and hover state:

```js
const glyph = (name) => `<i class="g g-${name}" aria-hidden="true"></i>`;
// <button class="mbtn primary" data-a="start">${glyph('clock-in')} CLOCK IN (SOLO)</button>
```

**Emblems and icons in cards** — real `<img>` with a lazy attribute and an emoji
fallback:

```js
const emblem = (c) =>
  `<img class="ci" src="/assets/ui/classes/emblem-${c.key}@1x.png"
        alt="" width="64" height="64" loading="lazy"
        onerror="this.replaceWith(Object.assign(document.createElement('span'),
                 {className:'ci ci-fallback',textContent:${JSON.stringify(c.icon)}}))">`;
```

**Keep the emoji as the fallback path.** This matches the engine's load-bearing
rule — *a missing asset costs a capability, never the boot*. Do not delete the
`icon` fields from `classes.js` or `meta.js`; they become the degraded path.

Derive asset paths from the existing `key` / `id` fields. **Do not add path
fields to `data/*.json`** — a derived path cannot fall out of sync with the
table, and the data files stay about design values.

Screens to update: all nine. Specifically:
- `showTitle()` — 5 button glyphs, `stat-strip` behind `.menu-note`,
  `screen-backdrop` on `.screen`
- `showClassSelect()` — emblems, card frames, stat glyphs, LMB/RMB keycaps
- `showPartySetup()` — slot plates, `bs-face` → emblem, select chrome, autofill glyph
- `showMotivation()` — perk icons, row states, pip images, balance plate
- `showHowTo()` — keycaps for every `<kbd>`, threat thumbnails
- `showSettings()` — slider/checkbox skinning (CSS-only; markup unchanged)
- `showPause()` — 3 glyphs + `pause-header`
- `showDeath()` / `showVictory()` — verdict stamps, stats plate, receipt
- `showLobby()` — row plates, tags, input fields, live dot, caret

**`esc()` at [`menus.js:10`](../src/ui/menus.js:10) still governs everything
interpolated from the network.** Room names, host names and player names arrive
from other machines. If you build a new template that interpolates one, it goes
through `esc()`. No exceptions, and no putting remote strings into an attribute
without escaping.

### 6.2 `src/style.css`

**Trap:** there are **two `:root` blocks**. The original is at the top; the
Tier 1 art-pack block at [`style.css:332`](../src/style.css:332) redefines the
same tokens and wins by cascade order. Add new variables to the **Tier 1 block**
and add new rules **after** the `ART PACK: TIER 1 HUD KIT` banner. Adding to the
first block produces changes that appear to do nothing.

Add a `ART PACK: TIER 3 MENU KIT` section containing:
- `.g` glyph base class using `mask-image` + `background: currentColor`, with
  one `.g-<name>` rule per glyph
- 9-slice `border-image` rules for the plate families
- Class-card state rules keyed off the existing `.class-card.sel`
- Range/checkbox `appearance: none` skinning with **both** vendor prefixes
- `.ci-fallback` sized to match the emblem so the degraded path is not jarring

Respect the existing responsive breakpoints at
[`style.css:236`](../src/style.css:236) and `:329` — the class grid drops to 3
and 2 columns. Emblems and cards must survive both.

### 6.3 `docs/art/` — documentation deliverables

Not optional; the Tier 1 work set this precedent and the ledger is the
provenance record.

1. **Five new briefs** in `docs/art/briefs/`, numbered `05`–`09`, one per
   milestone, following the exact structure of
   [`02-plates-controls.md`](art/briefs/02-plates-controls.md): Authority /
   Asset contract / Prompt record / Review record.
2. **Extend `asset_style_lock.json`** with the new families under
   `asset_families`: `menu_glyph`, `class_emblem`, `menu_plate`, `perk_icon`,
   `verdict_stamp`, `keycap`. Each needs `purpose`, `text_strategy`,
   `output_contract`, `allowed_variation`, `prohibited`. Bump the lock to
   `1.1.0` and record the trigger in `change_control`.
3. **Update `ASSET_ART_BIBLE.md`** — add Tier 3 families to the family table,
   bump to `1.1.0`.
4. **Regenerate the ledger** with all Tier 1 + Tier 3 rows.

---

## 7. Acceptance criteria

A milestone is done when every box is true.

**Art**
- [ ] Every asset exists as SVG master + `@1x` RGBA PNG with transparent corners
- [ ] Every asset is mirrored into `public/assets/ui/` by `sync_public_assets()`
- [ ] Running the generator twice produces **identical hashes**
- [ ] Tier 1 hashes are **unchanged** by the `_asset_lib.py` refactor
- [ ] Palette contains no colour outside the §1 table
- [ ] No baked text except `stamp-fired` and `stamp-promoted`
- [ ] Every asset carries the clipped-corner motif or is explicitly exempt in its brief
- [ ] Readable at target size against `#101420` **and** against the game's 3D scene
- [ ] The generator runs on Linux and macOS (no hardcoded `C:/Windows/Fonts`)

**Wiring**
- [ ] No system emoji visible on any of the nine screens at 1920×1080
- [ ] Every `<img>` has a working `onerror` fallback to its original emoji
- [ ] Remote-sourced strings still pass through `esc()`
- [ ] Class grid renders correctly at 4, 3 and 2 columns
- [ ] Sliders and checkboxes are skinned in **both** Chromium and Firefox
- [ ] Keyboard focus states remain visible on every interactive element
- [ ] `alt=""` on decorative images; meaningful `alt` on stamps and emblems

**Repo**
- [ ] `npm run check` passes (lint + test + build)
- [ ] Five briefs written; style lock at `1.1.0`; art bible at `1.1.0`
- [ ] Ledger regenerated with Tier 1 + Tier 3 rows between the markers
- [ ] One PR per milestone

---

## 8. Verification

```bash
python scripts/generate_menu_assets.py
```

```bash
npm run check
```

Then confirm determinism — this must print nothing:

```bash
python scripts/generate_menu_assets.py && git diff --stat -- assets/ public/assets/
```

Then look at it. Run `npm run dev`, open `http://localhost:5173`, and walk
title → class select → party setup → pause → death. Capture a 1920×1080
screenshot of the class-select screen and attach it to the M2 PR; that is the
screen this packet is for, and the art bible has an open decision recording that
owner screenshot approval is still pending.

Also verify the degraded path deliberately: rename `public/assets/ui/classes/`
and reload. The screen must fall back to emoji and stay usable, not break.

---

## 9. Out of scope

Do not do these in this packet:

- Tier 2 item / module / status icons — separate packet, `CODEX_ASSET_PACK.md` §2
- Steam store art (Tier 4) — **cancelled**; the project is now MIT open source
  with no commercial release. Ignore Tier 4 entirely.
- 3D character portraits or any generative-service art — explicitly rejected in
  [`ROADMAP.md`](ROADMAP.md); emblems are the approved substitute
- Restructuring the menu screens' layout or flow — replace the art, keep the
  information architecture
- Changing gameplay values in `data/*.json`
