# Asset Brief: tier3-party-lobby

Status: development_candidate  
Asset families: class emblem, menu glyph, menu plate  
Intended in-game use: solo bot-party setup and self-hosted co-op lobby  
Destination: assets/ui/party/ and assets/ui/lobby/

## Authority

- Art-bible version: 1.1.0, docs/art/ASSET_ART_BIBLE.md
- Style-lock version: 1.1.0, docs/art/asset_style_lock.json
- Packet: menu-pack-v1 sections 5.4 and 5.5
- Approval scope: player slots, native-select chrome, room directory, roster, remote-name safety

## Asset contract

- Primary request: slot plates, select chrome, autofill mark, room/roster rows, status tags, inputs, and connection strips.
- Aspect ratio / dimensions: exact dimensions from the packet; class emblems are reused by derived class keys.
- Composition and safe areas: live player, host, room, role, and status text stays unobstructed.
- Subject or surface: punch-card slots, lanyard tags, org-chart snapping, network ledger rows.
- Allowed variation: you, filled, empty, hover, waiting, in-run, full, host, guest, focus, connecting, error.
- Required invariants: every remote string remains escaped before interpolation.
- Forbidden traits: remote copy baked into art, emoji as primary art, inaccessible focus states.
- Text / logo strategy: live and escaped HTML text.
- Output / alpha requirement: deterministic SVG masters and transparent RGBA PNG derivatives.

## Prompt record

No generative prompt used. Network-state plates and empty-slot affordances are
constructed from deterministic vector primitives.

## Review record

- Tool mode and provider output ID: deterministic local SVG/Pillow generator, menu-pack-v1
- Source/output paths, hashes, and dimensions: docs/art/ASSET_LEDGER.md
- Post-processing command and inputs: python scripts/generate_menu_assets.py
- Full-size and in-game inspection: party and connected/disconnected lobby passes pending owner review
- Drift check: remote strings still pass through esc()
- Promotion decision and approver: development candidate; approver pending
