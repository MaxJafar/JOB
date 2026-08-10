# Asset Brief: tier3-menu-glyphs-plates

Status: development_candidate  
Asset families: menu glyph, menu plate  
Intended in-game use: title, shared menu buttons, screen backgrounds, headers, dividers, and overlay scrims  
Destination: assets/ui/glyphs/ and assets/ui/menuplates/

## Authority

- Art-bible version: 1.1.0, docs/art/ASSET_ART_BIBLE.md
- Style-lock version: 1.1.0, docs/art/asset_style_lock.json
- Packet: menu-pack-v1 sections 5.1 and 5.2
- Approval scope: live labels, platform-stable symbols, and quiet stretch-safe centers

## Asset contract

- Primary request: replace menu emoji with monochrome corporate glyph masks and clipped receipt plates.
- Aspect ratio / dimensions: 24px SVG glyphs with 48px PNGs; plate dimensions follow the packet inventory.
- Composition and safe areas: preserve outer 16px plate edges and keep centers quiet for live copy.
- Subject or surface: punch cards, lanyards, org charts, ledger rules, registration marks, and elevator cues.
- Allowed variation: semantic silhouette; default, gold, dim, interaction, primary, danger, and disabled states.
- Required invariants: locked palette, one clipped corner, 1-2px borders, transparent canvas.
- Forbidden traits: baked labels, system emoji as primary art, rounded pills, gradients, deep shadow.
- Text / logo strategy: live engine text; no glyph letterforms.
- Output / alpha requirement: deterministic SVG masters and RGBA PNG derivatives mirrored into public assets.

## Prompt record

No generative prompt used. The image-generation routing rules select
deterministic repo-native vector construction for this established UI system.

## Review record

- Tool mode and provider output ID: deterministic local SVG/Pillow generator, menu-pack-v1
- Source/output paths, hashes, and dimensions: docs/art/ASSET_LEDGER.md
- Post-processing command and inputs: python scripts/generate_menu_assets.py
- Full-size and in-game inspection: development pass complete; owner screenshot approval pending
- Drift check: locked palette and vector-native geometry
- Promotion decision and approver: development candidate; approver pending
