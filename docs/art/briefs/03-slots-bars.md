# Asset Brief: tier1-slots-bars

Status: `development_candidate`  
Asset family: `slot frame / bar`  
Intended in-game use: ability slots, equipment slots, HP/XP/boss/event meters  
Destination: `assets/ui/slots/`, `assets/ui/equipment/`, and `assets/ui/bars/`

## Authority

- Art-bible version: `1.0.0`, `docs/art/ASSET_ART_BIBLE.md`
- Style-lock version: `1.0.0`, `docs/art/asset_style_lock.json`
- Visual anchors and roles: `packet-style: style/material`; `hud-runtime: composition`
- Approval scope and unresolved decisions: live icons and labels remain outside art; screenshot approval remains open

## Asset contract

- Primary request: transparent role-colored frames with empty centers and bar frame/fill plates with 9-slice-safe edges.
- Aspect ratio / dimensions: 128px square slots; 64px equipment silhouettes; horizontal bars sized for HUD width.
- Composition and safe areas: reserve the outer 12-16% for borders, tabs, and registration marks; center stays empty.
- Subject or surface: punch-card module frame, paperclip brackets, clipped memo edges, and shredder/tooth boss edge.
- Allowed variation: role colors, empty state, special/passive plug tabs, cooldown ring, boss tooth edge.
- Required invariants: sharp corners, 1-2px borders, live state separation, locked palette semantics.
- Forbidden traits: baked numbers, baked icons, heavy bevels, soft shadows, rounded tiles.
- Text / logo strategy: live engine text; no text in masters.
- Output / alpha requirement: transparent SVG and RGBA PNG.

## Prompt record

No generative prompt used. The source is vector-native and exported locally for
pixel-accurate HUD use.

## Review record

- Tool mode and provider output ID: deterministic local SVG/Pillow generator, `hud-assets-v1`
- Source/output paths, hashes, and dimensions: recorded in `docs/art/ASSET_LEDGER.md`
- Post-processing command and inputs: `python scripts/generate_hud_assets.py`
- Full-size and in-game inspection: pending owner screenshot review
- Drift check: pass against draft lock; no prohibited traits in the source
- Promotion decision and approver: development candidate; approver pending
