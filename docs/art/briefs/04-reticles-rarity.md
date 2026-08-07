# Asset Brief: tier1-reticles-rarity

Status: `development_candidate`  
Asset family: `crosshair / directional indicator / rarity frame`  
Intended in-game use: combat reticle, damage telegraph, item/card rarity language  
Destination: `assets/ui/crosshairs/`, `assets/ui/indicators/`, and `assets/ui/rarity/`

## Authority

- Art-bible version: `1.0.0`, `docs/art/ASSET_ART_BIBLE.md`
- Style-lock version: `1.0.0`, `docs/art/asset_style_lock.json`
- Visual anchors and roles: `packet-style: style/material`; `hud-runtime: composition`
- Approval scope and unresolved decisions: no copied FPS reticle or real-brand treatment; screenshot approval remains open

## Asset contract

- Primary request: 4 readable reticle styles across idle/fire/hit-confirm, one radial damage arc sprite, and five rarity frame/gem pairs.
- Aspect ratio / dimensions: 64px reticles, 256px damage indicator, 128px frames, 24px gems.
- Composition and safe areas: transparent backgrounds; retain a clean center for crosshair target and item content.
- Subject or surface: thin ink geometry with color-coded stamped state.
- Allowed variation: state color, rotation driven by runtime, rarity color.
- Required invariants: 1.5px-equivalent strokes, crisp silhouettes, no screen-covering opaque fill.
- Forbidden traits: micro-detail, baked direction, text, glossy gemstones, unbounded glow.
- Text / logo strategy: no text.
- Output / alpha requirement: transparent SVG and RGBA PNG.

## Prompt record

No generative prompt used. These are simple vector-native UI symbols and are
kept deterministic for target-size readability.

## Review record

- Tool mode and provider output ID: deterministic local SVG/Pillow generator, `hud-assets-v1`
- Source/output paths, hashes, and dimensions: recorded in `docs/art/ASSET_LEDGER.md`
- Post-processing command and inputs: `python scripts/generate_hud_assets.py`
- Full-size and in-game inspection: pending owner screenshot review
- Drift check: pass against draft lock; no prohibited traits in the source
- Promotion decision and approver: development candidate; approver pending
