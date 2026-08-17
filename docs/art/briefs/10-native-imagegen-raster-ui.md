# Native Imagegen Raster UI

Status: `development candidate`  
Style lock: `docs/art/asset_style_lock.json` version `1.2.0`  
Generated: `2026-08-11` with the built-in Codex `image_gen` tool

## Scope

Replace procedural menu/HUD SVG chrome at runtime with painted PNG game assets
while keeping every label, mutable value, focus state, and accessibility name
live in HTML/CSS.

Runtime files live in `assets/ui/raster/` and are mirrored to
`public/assets/ui/raster/`. Files ending in `-key.png` are preserved source
sheets. Matching files without `-key` are soft-matted RGBA runtime atlases.

## Prompt set

- **Backdrop:** stylized 16:9 dystopian corporate night office, empty center for
  menu UI, dark navy/charcoal surfaces, cyan practical light, restrained gold
  and warning-red accents, no people, logo, or text.
- **Buttons:** exactly eight empty horizontal button frames in a 4x2 sprite
  sheet: default, cyan hover, gold primary, red danger, pressed, disabled,
  compact cyan, compact gold. Flat chroma-green background; no text.
- **Actions:** exactly 21 readable office-action symbols in a 7x3 sheet:
  clock-in, network, severance, handbook, settings, back, pause; quit, retry,
  home, loop, role, connect, close; add, check, lock, live, caret, host, guest.
  Flat chroma-green background; no text.
- **Classes:** exactly ten painted desk-object emblems in a 5x2 sheet, ordered
  intern, janitor, accountant, HR, IT; sales, marketing, facilities, barista,
  analyst. Flat chroma-green background; no text or portraits.
- **Menu panels:** exactly six empty frames in a 3x2 sheet: class default,
  hover, selected; party slot, perk row, lobby row. Flat chroma-green
  background; no text.
- **HUD:** exactly eight empty frames in a 4x2 sheet: HP, XP, boss, event;
  primary, secondary, dash, module. Flat chroma-green background; no text.
- **HUD abilities:** exactly 25 frameless action icons in a 5x5 sheet: each
  class primary/secondary pair in runtime class order, followed by throwable,
  consumable, dash, module, and empty-slot symbols. Flat chroma-green
  background; no text.

All prompts lock the project palette: `#101420`, `#2A3242`, `#EEF2F6`,
`#38E1FF`, `#FFD23F`, `#FF4D5A`, `#58E07C`, and `#FF4FA3`.

## Processing and wiring

Chroma-key sheets were converted with the imagegen skill helper
`remove_chroma_key.py` using border auto-key, soft matte, threshold `12`, opaque
threshold `220`, and despill. CSS uses recorded atlas crop regions; DOM text is
rendered above the PNG layers. The class selector uses the class atlas through
`.class-emblem`, buttons/actions through `.mbtn` and `.g`, menu rows/cards
through the panel atlas, gameplay bars/slots through the HUD-frame atlas, and
ability-row symbols through the 5x5 HUD-ability atlas.
