# Asset Brief: tier1-plates-controls

Status: `development_candidate`  
Asset family: `ui plate`  
Intended in-game use: HUD panels, menu buttons, prompts, and interactive controls  
Destination: `assets/ui/panels/` and `assets/ui/buttons/`

## Authority

- Art-bible version: `1.0.0`, `docs/art/ASSET_ART_BIBLE.md`
- Style-lock version: `1.0.0`, `docs/art/asset_style_lock.json`
- Visual anchors and roles: `packet-style: style/material`; `hud-runtime: composition`
- Approval scope and unresolved decisions: text stays live; exact font files and screenshot approval remain open

## Asset contract

- Primary request: text-free 9-slice panel skins and button state plates with one clipped corner and quiet centers.
- Aspect ratio / dimensions: 96x96 panel tile; wide and compact button tiles; 64px square icon-button tiles.
- Composition and safe areas: protect the outer 16px on panels and buttons; keep the center visually quiet for live labels.
- Subject or surface: dark memo paper / punch-card plate with thin light border and one registration mark.
- Allowed variation: default, gold-accent, danger, hover, pressed, disabled.
- Required invariants: `#101420`, `#2A3242`, `#FFD23F`, `#38E1FF`, `#FF4D5A`, 1-2px border, no rounded pill.
- Forbidden traits: baked text, deep shadow, heavy gradient, glossy glass surface.
- Text / logo strategy: live engine text.
- Output / alpha requirement: transparent SVG and RGBA PNG suitable for 9-slice use.

## Prompt record

No generative prompt used. Vector plates are deterministic because their
geometry and stretch behavior are part of the engine contract.

## Review record

- Tool mode and provider output ID: deterministic local SVG/Pillow generator, `hud-assets-v1`
- Source/output paths, hashes, and dimensions: recorded in `docs/art/ASSET_LEDGER.md`
- Post-processing command and inputs: `python scripts/generate_hud_assets.py`
- Full-size and in-game inspection: pending owner screenshot review
- Drift check: pass against draft lock; no prohibited traits in the source
- Promotion decision and approver: development candidate; approver pending
