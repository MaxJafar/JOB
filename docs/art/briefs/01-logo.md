# Asset Brief: tier1-logo

Status: `development_candidate`  
Asset family: `logo`  
Intended in-game use: title menu, pause/death/victory surfaces, Steam logo overlay  
Destination: `assets/ui/logo/`

## Authority

- Art-bible version: `1.0.0`, `docs/art/ASSET_ART_BIBLE.md`
- Style-lock version: `1.0.0`, `docs/art/asset_style_lock.json`
- Visual anchors and roles: `packet-style: style/material`; `game-fiction: tone`; `hud-runtime: composition`
- Approval scope and unresolved decisions: draft candidate; final font files and screenshot approval remain open

## Asset contract

- Primary request: editable J.O.B. wordmark with the exact tagline `JUST OBEY BUSINESS`, plus full-color, mono-light, mono-dark, and badge-only stamp variants.
- Aspect ratio / dimensions: full wordmark 2048px wide with transparent canvas; badge 1024x1024.
- Composition and safe areas: 8% transparent breathing room; badge text stays inside the stamp border.
- Subject or surface: flat corporate stamp / memo mark with a clipped paper corner and thin registration lines.
- Allowed variation: locked palette variants only.
- Required invariants: clipped-corner paper motif, gold/cyan hierarchy, editable vector text, no real-brand reference.
- Forbidden traits: photoreal embossing, bevels, gradients over two stops, baked gameplay copy.
- Text / logo strategy: editable SVG master; PNGs are deterministic derivatives.
- Output / alpha requirement: transparent SVG and RGBA PNG.

## Prompt record

No generative prompt used. This bounded deliverable is vector-native and was
authored from the locked brief to preserve exact letterforms and copy.

## Review record

- Tool mode and provider output ID: deterministic local SVG/Pillow generator, `hud-assets-v1`
- Source/output paths, hashes, and dimensions: recorded in `docs/art/ASSET_LEDGER.md`
- Post-processing command and inputs: `python scripts/generate_hud_assets.py`
- Full-size and in-game inspection: pending owner screenshot review
- Drift check: pass against draft lock; no prohibited traits in the source
- Promotion decision and approver: development candidate; approver pending
