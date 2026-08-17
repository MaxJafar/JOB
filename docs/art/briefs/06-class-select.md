# Asset Brief: tier3-class-select

Status: development_candidate  
Asset families: class emblem, menu plate, keycap  
Intended in-game use: ten-role class-select grid and class skill/stat rows  
Destination: assets/ui/classes/

## Authority

- Art-bible version: 1.1.0, docs/art/ASSET_ART_BIBLE.md
- Style-lock version: 1.1.0, docs/art/asset_style_lock.json
- Packet: menu-pack-v1 section 5.3
- Approval scope: role readability at 32-64px and responsive 4/3/2-column grids

## Asset contract

- Primary request: ten geometric department emblems, three class-card states, stat glyphs/tracks, mouse keycaps, and role tag.
- Aspect ratio / dimensions: 128px emblem masters with 64px PNGs; 232x320 card masters; supporting dimensions follow the packet.
- Composition and safe areas: no face or character portrait; emblem body stays light on dark with class accent at the border.
- Stretch safety: card masters contain frame art only; section dividers belong to the live `p` and `.cstats` flow so variable-height copy can never cross baked rules.
- Subject or surface: each role uses its specified office-object badge subject.
- Allowed variation: locked economy, tech, aggression, sustain, and barista accents.
- Required invariants: live names/descriptions/stats; selected card carries only an approval registration mark.
- Forbidden traits: baked class names, portraits, emoji as primary art, accent fill takeover.
- Text / logo strategy: all copy remains HTML.
- Output / alpha requirement: deterministic SVG masters and transparent RGBA PNG derivatives.

## Prompt record

No generative prompt used. Badge silhouettes and card geometry are deterministic
because target-size readability and CSS state behavior are engine contracts.

## Review record

- Tool mode and provider output ID: deterministic local SVG/Pillow generator, menu-pack-v1
- Source/output paths, hashes, and dimensions: docs/art/ASSET_LEDGER.md
- Post-processing command and inputs: python scripts/generate_menu_assets.py
- Full-size and in-game inspection: 1920x1080 class-select capture required
- Drift check: no faces, baked labels, or palette drift
- Promotion decision and approver: development candidate; approver pending
