# Asset Brief: readme-cover

Status: `approved_for_generation`  
Asset family: `background`  
Intended in-game use: Repository README hero cover and open-source project presentation  
Destination: `docs/art/job-readme-cover.png`

## Authority

- Art-bible version: `1.2.0`, `docs/art/ASSET_ART_BIBLE.md`
- Style-lock version: `1.2.0`, `docs/art/asset_style_lock.json`
- Visual anchors and roles: User-supplied gameplay capture `codex-clipboard-37ce7a8c-e6a0-49b8-bcc9-9411dc690852.png` is the controlling style and rendering reference; `game-fiction` supplies office-tower subjects and tone; `packet-style` constrains palette and branding only
- Approval scope and unresolved decisions: The project owner explicitly rejected polished key art and required the README cover graphics to be identical in character to the supplied in-engine screenshot. The cover must preserve the screenshot's deliberately simple low-poly geometry, flat materials, sparse lighting, muted surfaces, and unpolished browser-game rendering.

## Asset contract

- Primary request: One new repository cover that looks like an authentic screenshot from the current browser game, using the supplied gameplay capture as the exact rendering-style reference
- Aspect ratio / dimensions: Wide 16:9 landscape; large enough for a GitHub README hero
- Composition and safe areas: Third-person gameplay camera looking through a sparse office corridor toward the elevator core; the blocky Intern in the lower foreground; hostile low-poly coworkers and office machines ahead; readable at roughly 1000px wide
- Subject or surface: An authentic-looking in-engine battle moment on the Lobby floor, with the same simple walls, wood-toned floor, rectangular fluorescent ceiling panels, cubicles, desks, blocky props, and low-detail characters visible in the supplied screenshot
- Allowed variation: New corridor layout, enemy placement, pose, and restrained projectile effects; no rendering-style variation
- Required invariants: Match the supplied screenshot's exact visual level: chunky primitive geometry, hard flat-shaded faces, minimal textures, muted gray-green walls, brown floor, black ceiling voids, simple rectangular lights, blocky faceless characters, sparse red/cyan/gold accents, basic game-engine shadows, and deliberately modest browser-game rendering
- Forbidden traits: Photoreal people; faces or celebrity likenesses; unrelated fantasy or military imagery; rounded-pill UI; glassmorphism; real-company logos; copied trade dress; readable signs, labels, slogans, watermarks, or AI-generated text; heavy bloom that obscures silhouettes; palette drift
- Text / logo strategy: No raster text and no raster logo. The existing editable J.O.B. vector/PNG wordmark remains separate in the README.
- Output / alpha requirement: Opaque RGB PNG

## Prompt record

Use case: stylized-concept
Asset type: wide GitHub README cover for a browser game

Identity block: Use the attached J.O.B. gameplay screenshot as the controlling style reference. Match its actual in-engine graphics closely: very simple chunky low-poly primitive meshes; hard flat-shaded polygon faces; sparse or absent textures; blocky faceless office-worker bodies; muted gray-green walls; brown low-detail floor; black ceiling voids; oversized rectangular fluorescent panels; simple desks, chairs, planters, cubicles, and office props; basic game-engine lighting and shadows; restrained red edge danger tint; tiny gold, cyan, and red gameplay accents. Preserve the charming roughness and modest browser-game rendering. Do not upgrade or reinterpret the art.

Asset contract: Generate a new wide third-person gameplay-style cover on the Lobby floor. View from behind the same blocky Intern archetype in a white shirt and gray vest, moving down a sparse office corridor toward a central elevator-core opening. Place several blocky hostile coworkers and one rogue office machine ahead among cubicles and desks. Add a few simple round gold projectile particles and small pieces of blocky debris. It must look like a plausible new screenshot captured from the same game and renderer as the reference, not promotional key art.

Technical block: Wide 16:9 landscape for a GitHub README hero, around the same camera height and field of view as the reference. Keep the Intern in the lower center, the corridor/elevator objective near the upper center, and the simple enemies readable ahead. Opaque background. Remove all HUD, crosshair, labels, timer, counters, signage, and typography so the separate editable README logo remains authoritative.

Avoid block: No polished cinematic key art, no high-detail materials, no realistic reflections, no dramatic volumetric lighting, no dense particles, no hand-painted finish, no glossy robots, no enhanced character anatomy, no realistic faces, no modern AAA rendering, no words, letters, numbers, captions, logos, watermarks, UI panels, or fake game title. No real-company branding, military weapons, fantasy armor, or visual elements absent from the supplied game's low-poly office world.

## Review record

- Tool mode and provider output ID: Built-in Codex ImageGen reference edit; `exec-9985af94-0285-4bea-8a76-de34e9693b95.png`
- Source/output paths, hashes, and dimensions: controlling reference `C:\Users\user\AppData\Local\Temp\codex-clipboard-37ce7a8c-e6a0-49b8-bcc9-9411dc690852.png`; generated source `C:\Users\user\.codex\generated_images\01a01023-3525-73d2-8be6-2532e006ce1a\exec-9985af94-0285-4bea-8a76-de34e9693b95.png`; repository output `docs/art/job-readme-cover.png`; `1672x941`; SHA-256 `c8a72a1e2c2bfcb1cfbffa9930318173a5143c681ba1d2e823b95959230f12cf`
- Post-processing command and inputs: Byte-for-byte copy into the repository; no crop, resize, alpha, color, or compositing changes
- Full-size and in-game inspection: Pass. The result matches the reference's flat primitive geometry, blocky character anatomy, sparse office props, basic ceiling panels, muted materials, simple shadows, and restrained projectile effects. It remains readable at README scale.
- Drift check: Pass against the owner-supplied gameplay reference. No polished key-art finish, realistic materials, typography, HUD, external branding, faces, or out-of-world objects are present.
- Promotion decision and approver: Promoted as the README development candidate following the project owner's explicit replacement request
