# J.O.B. Asset Art Bible

Status: `draft`
Version: `1.1.0`
Owner / approval record: `Project owner review pending`
Machine companion: [`asset_style_lock.json`](asset_style_lock.json)

## Authority and scope

The visual system is grounded in the explicit direction in
[`docs/CODEX_ASSET_PACK.md`](../CODEX_ASSET_PACK.md), with the current HUD
implementation in [`src/style.css`](../../src/style.css) used only as a
development reference. The asset packet is the authority for palette, shape
language, motifs, formats, and target sizes. The current CSS is not an
approved visual reference where it conflicts with the packet.

Reference roles:

| Source | Role | Permitted scope |
| --- | --- | --- |
| `docs/CODEX_ASSET_PACK.md` | style, material, typography, delivery | All 2D/UI families listed in the packet |
| `src/style.css` | composition, runtime context | Existing HUD placement and readable scale only |
| `README.md` | composition, fiction | Corporate-office satire, classes, floors, and gameplay nouns |

No external brand, logo, game, or character reference is approved. Do not
infer copied trade dress from the words "corporate" or "arcade neon".

## Brand promise

J.O.B. makes sterile office bureaucracy feel like an arcade scoreboard: every
form, stamp, and receipt is a readable combat signal. The visual voice is
brutalist corporate memo meets neon escalation, with humor carried by mundane
desk objects and aggressive status language. Assets must remain legible in a
busy 1080p battle and on Steam's dark blue-gray surface.

## Locked visual signature

- **Medium and materials:** flat graphic UI built from paper forms, punch
  cards, thin ink lines, stamped status marks, and restrained metal/plastic
  desk-object cues; no photoreal surfaces.
- **Shape language and layout:** sharp rectangles with one clipped 45-degree
  corner, 1-2px light borders, quiet stretch-safe centers, explicit hierarchy,
  and visible registration/ledger details.
- **Lighting and depth:** front-on, orthographic, mostly flat; use at most two
  tonal steps and no shadow deeper than 4px.
- **Palette:** `#FFD23F` money-gold, `#38E1FF` cyan, `#FF4D5A` red,
  `#58E07C` green, `#FF4FA3` magenta, surfaces `#101420` to `#2A3242`,
  text `#EEF2F6`, dim text `#9AA7B5`.
- **Texture and motion cues:** optional low-opacity scanline or paper grain;
  texture must never reduce small-size readability. State changes use crisp
  color/scale/line changes rather than soft bloom.
- **Typography behavior:** headline uses a heavy condensed grotesk; body and
  numeric readouts use a mono/ledger face. UI copy stays live in the engine;
  the logo is an editable SVG master. Recommended fonts and licenses are in
  [`FONTS.md`](FONTS.md).
- **Brand-mark behavior:** the J.O.B. wordmark is a vector master with full,
  mono-light, mono-dark, and badge-stamp variants. Do not redraw it in raster
  generation or bake it into gameplay panels.

## Visual anchors

| ID | Path or source | Role | Permitted use | Immutable traits |
| --- | --- | --- | --- | --- |
| `packet-style` | `docs/CODEX_ASSET_PACK.md` | style / material / delivery | All UI and store families | Palette, clipped-corner motif, office-satire motifs, no photorealism |
| `hud-runtime` | `src/style.css` and `index.html` | composition | HUD placement and target read size | Center of screen stays clear; HUD remains readable at 1080p |
| `game-fiction` | `README.md` | composition / tone | Office objects, roles, floors, and terminology | Corporate workplace satire; no real-company references |

## Asset-family contracts

| Family | Purpose | Text strategy | Delivery |
| --- | --- | --- | --- |
| Logo | J.O.B. wordmark and badge | Editable vector letterforms | SVG master + transparent PNG |
| UI plate | Tier 1 HUD plates and controls | Live engine text | SVG + 9-slice RGBA PNG |
| Slot, bar, reticle, rarity | Tier 1 combat readability | No baked mutable text | Dimensioned SVG + RGBA PNG |
| Menu glyph | Buttons, labels, statuses, empty slots | No text; SVG `currentColor` masks | 24px SVG + 48px RGBA PNG |
| Class emblem | Ten role/department identities | No faces and no text | 128px SVG + 64px RGBA PNG |
| Menu plate | Menus, cards, rows, fields, controls | Live engine text | Dimensioned SVG + 9-slice RGBA PNG |
| Perk icon | Five Severance benefit identities | No text; path derived from perk ID | 128px SVG + 64px RGBA PNG |
| Verdict stamp | Fired/promoted run bookends | Locked baked display-mark exception | 1024x420 SVG + RGBA PNG |
| Keycap | Handbook and class input prompts | Live engine key labels | Stretch-safe SVG + RGBA PNG |

### UI plates and controls

Front-on, text-free masters with protected edges and a quiet stretch-safe
center. Labels, focus state, tooltips, and interaction semantics remain live in
HTML/CSS. Deliver editable SVG masters plus deterministic RGBA PNG derivatives.
The 9-slice source is a 96x96 tile for panels and an equivalent plate for
buttons; preserve a 16px corner-safe zone when scaling.

### Slot frames, bars, and indicators

Transparent, front-on vector plates with no baked gameplay state. Use the
locked color to identify the role, keep the center empty for live icons/text,
and reserve the outer 12-16% for borders, clips, and registration marks.
Deliver SVG masters and PNGs at the packet size; state overlays remain live.

### Logos and typography

The logo is a vector/code-native master and may include exact text. Use the
licensed font strategy in `FONTS.md`. Raster exports are delivery derivatives
only. Gameplay/UI labels are never generated into bitmap art.

### Icons and motifs

Simple silhouettes and desk-object symbols are vector-native where possible.
Keep a consistent 3/4 desk-object angle for item families, but Tier 1 slot and
status glyphs stay front-on and immediately readable.

### Tier 3 menus and meta screens

Menu art stays front-on and uses the same clipped receipt corner as Tier 1.
Button glyphs are monochrome SVG masks so focus and hover colors remain live.
Class and perk identities are geometric department badges, never portraits or
emoji. Card, row, input, slider, checkbox, keycap, lobby, and handbook surfaces
keep their centers quiet for HTML labels and remote strings.

Only `stamp-fired` and `stamp-promoted` may bake menu copy. Their exact phrases,
angles, palette roles, deterministic distress, and resolved display font are
part of the provenance record. All run stats and explanatory copy remain live.

## Non-negotiable prohibitions

- No photorealism, painterly rendering, 3D bevels, or heavy gradients.
- No rounded-pill UI, deep drop shadows, glassmorphism, or soft neumorphic
  surfaces.
- No real-company logos, copied trade dress, recognizable brand slogans, or
  close parodies that could be mistaken for a real mark.
- No AI-rendered final UI copy, localized gameplay text, or mutable stats.
- No palette drift outside the locked colors except neutral tints required for
  contrast and documented in the asset ledger.
- No texture, glow, or particle treatment that obscures the silhouette at its
  target size.

## Production and provenance rules

Source masters live under `assets/ui/<family>/` as SVG. PNG derivatives follow
`assets/ui/<category>/<name>@<scale>.png`; Tier 1 is generated by
`scripts/generate_hud_assets.py` and Tier 3 by
`scripts/generate_menu_assets.py`. The generated assets are deterministic and
must be regenerated rather than hand-painted over. All RGBA exports must have
transparent corners unless a surface is explicitly opaque. Record source,
dimensions, hashes, generator version, resolved fonts, review result, and
intended use in [`ASSET_LEDGER.md`](ASSET_LEDGER.md).

Promote a candidate from draft only after owner review on a 1080p game capture
and against Steam `#1B2838`. Keep gameplay state, labels, and localization
outside the art.

## Open decisions

- Confirm the bundled production font files and whether Archivo Black / IBM
  Plex Mono should be shipped locally or resolved through platform fallbacks.
- Approve the first HUD screenshot pass at 1080p and Steam `#1B2838`.
- Confirm whether Tier 2 item icons should use the same border weight as the
  Tier 1 slot frames or a separate icon-specific weight.
- Approve the Tier 3 class-select screenshot at 1080p.

## Change control

Any locked-invariant change requires a versioned amendment naming the decision
owner, rationale, affected asset families, migration plan, and review date.
Regenerate affected asset briefs after an amendment; do not silently reinterpret
existing prompts or masters.
