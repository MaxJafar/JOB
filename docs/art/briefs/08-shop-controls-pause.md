# Asset Brief: tier3-shop-controls-pause

Status: development_candidate  
Asset families: perk icon, menu plate, menu glyph  
Intended in-game use: Motivation shop, settings controls, and pause overlay  
Destination: assets/ui/severance/ and assets/ui/controls/

## Authority

- Art-bible version: 1.1.0, docs/art/ASSET_ART_BIBLE.md
- Style-lock version: 1.1.0, docs/art/asset_style_lock.json
- Packet: menu-pack-v1 sections 5.6 and 5.7
- Approval scope: perk affordability, permanent-level pips, cross-browser range/checkbox skins, pause header

## Asset contract

- Primary request: five ID-derived benefit icons, perk rows/pips/balance plate, slider and checkbox kit, setting rows, pause header.
- Aspect ratio / dimensions: perk masters 128px with 64px PNGs; controls follow exact packet dimensions.
- Composition and safe areas: shop labels and prices stay live; pause header contains no words.
- Subject or surface: insurance forms, charts, standing desk, direct deposit, wellness abstraction, punch-card controls.
- Allowed variation: affordable, unaffordable, maxed, active, on, off.
- Required invariants: WebKit and Mozilla slider thumbs; visible keyboard focus.
- Forbidden traits: baked perk names or values, native emoji, rounded consumer-control styling.
- Text / logo strategy: live engine text.
- Output / alpha requirement: deterministic SVG masters and transparent RGBA PNG derivatives.

## Prompt record

No generative prompt used. Perk and control marks use deterministic geometric
construction so IDs, states, and vendor styling cannot drift.

## Review record

- Tool mode and provider output ID: deterministic local SVG/Pillow generator, menu-pack-v1
- Source/output paths, hashes, and dimensions: docs/art/ASSET_LEDGER.md
- Post-processing command and inputs: python scripts/generate_menu_assets.py
- Full-size and in-game inspection: Chromium pass required; Firefox pseudo-element rules reviewed in source
- Drift check: live prices, values, and labels preserved
- Promotion decision and approver: development candidate; approver pending
