# Asset Brief: tier3-verdict-handbook

Status: development_candidate  
Asset families: verdict stamp, keycap, menu plate  
Intended in-game use: death/victory bookends and Employee Handbook  
Destination: assets/ui/verdict/ and assets/ui/handbook/

## Authority

- Art-bible version: 1.1.0, docs/art/ASSET_ART_BIBLE.md
- Style-lock version: 1.1.0, docs/art/asset_style_lock.json
- Packet: menu-pack-v1 sections 5.8 and 5.9
- Approval scope: exact verdict marks, run stats, severance receipt, live key labels, five threat silhouettes

## Asset contract

- Primary request: two exact distressed verdict stamps, run-stat/receipt plates, three keycap forms, section rule, five threat thumbnails.
- Aspect ratio / dimensions: verdict marks 1024x420; all supporting dimensions follow the packet.
- Composition and safe areas: stamp text stays within double registration border; handbook copy stays live beside thumbnails.
- Subject or surface: ink-starved termination/promotion stamps, ledger grid, receipt perforation, geometric enemy silhouettes.
- Allowed variation: fired red at -4 degrees; promoted gold at +3 degrees; deterministic distress only.
- Required invariants: resolved display font recorded in ledger; meaningful stamp alt text and image fallbacks.
- Forbidden traits: any additional baked copy, mutable stats in art, emoji as primary threat art.
- Text / logo strategy: only the two exact verdict phrases are baked display marks.
- Output / alpha requirement: deterministic SVG masters and transparent RGBA PNG derivatives.

## Prompt record

No generative prompt used. Exact typography, distress seed, and silhouettes are
produced by the deterministic local SVG/Pillow pipeline.

## Review record

- Tool mode and provider output ID: deterministic local SVG/Pillow generator, menu-pack-v1
- Source/output paths, hashes, and dimensions: docs/art/ASSET_LEDGER.md
- Post-processing command and inputs: python scripts/generate_menu_assets.py
- Full-size and in-game inspection: death, victory, and handbook passes pending owner review
- Drift check: exact verdict copy and locked colors verified
- Promotion decision and approver: development candidate; approver pending
