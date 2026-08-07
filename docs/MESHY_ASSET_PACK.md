# MESHY ASSET PACK v2 — 3D Model Production Tasks

Prompt-ready packet for Meshy AI. Goal: replace every boxy procedural character with a
**unique faceted low-poly ("triangulated crystal") model**, rigged and animated, loaded
via GLTF into three.js.

> **v2 corrections (production review):**
> 1. **Textures are required for rigging.** Meshy's auto-rig needs textured humanoid
>    GLBs — "no texture maps" breaks the pipeline. New rule below.
> 2. **A-pose, weapons NEVER fused to hands** — bodies and weapons/gear generate as
>    separate assets and attach to sockets at runtime.
> 3. **Pilot is 3 assets** (playable humanoid + enemy humanoid + environment prop):
>    THE INTERN, THE SECURITY GUARD, and the FINANCE ELEVATOR. Nothing else generates
>    until all three pass QA in-engine.
> 4. Post-processing pipeline: `gltf-transform` (meshopt + texture compress), material
>    normalization on load (flatShading, clamped metalness), `SkeletonUtils.clone()`
>    for instances. Meshy library animations are PLACEHOLDERS — combat timing lives in
>    gameplay data; final attack clips get custom retiming.
> 5. **Licensing:** generate on a paid plan (private ownership), original concepts only
>    (no copyrighted references), archive prompt + task ID + date per asset.

## v3 prompt contract — VALIDATED 2026-08-07

> The v2 constraint block below the line failed QA on all 3 pilot assets (bleached
> white, realistic shading, hands in pockets, melted prop). Renders of both attempts
> are archived in `docs/asset-qa/`. **Prompts are code — they live in
> `scripts/meshy-manifest.js`, not in this doc.** This section explains the rules.

**Four rules, each one learned from a failed asset:**

1. **Never write "no ..." in the positive prompt.** The encoder adds what you name.
   All exclusions go in the `negative_prompt` field (see `NEGATIVE` in the manifest).
   v2 spent ~40% of its 600-char budget on "no photoreal, no floating parts" and got
   photoreal assets with floating parts.
2. **Low-poly comes from `model_type: 'lowpoly'` on `meshy-6`, not from adjectives.**
   v2 asked for "sharp triangular facets like folded paper" on meshy-5 and the API
   reported back `art_style = realistic`. No wording fixes a wrong model flag.
3. **Never write a `texture_prompt` that negates shading.** v2 used *"flat solid
   palette colors, no shading, no highlights, no grain"* and every asset came back
   bleached near-white. Omit the field; put colour in the main prompt instead.
4. **State colour positively, per garment, and lead with the dominant surface.**
   "mustard-yellow shirt, charcoal trousers, red lanyard" works. A trailing
   "gold and green palette" does not — and naming one metal twice (doors *and* trim)
   turned the elevator fully monochrome gold on the first v3 pass.

**Also required:** open the prompt with the pose — *"standing with both arms straight
out to the sides, palms open and empty"* — plus `pose_mode: 'a-pose'`. This is what
finally produced riggable A-pose meshes; on meshy-5 `pose_mode` alone was ignored.

Faceting is enforced at **render** time, not generation time: `src/game/models.js`
forces `flatShading: true`, clamps metalness ≤ 0.08 and strips normal maps, so
generated assets sit correctly next to the procedural props.

<details><summary>v2 constraint block (FAILED — kept for the record)</summary>

> low-poly faceted stylized character, sharp triangular facets like folded paper,
> flat-shaded solid colors, ONE small base-color texture (512-1024px) with flat palette
> colors — no baked highlights or shadows, no noisy surface detail, no photoreal
> texture, no normal map; maximum 2 materials; clean silhouette readable at 30 meters,
> game-ready, A-pose with arms separated from torso and legs separated, empty hands,
> humanoid proportions, tri count between 2000-4500, no floating parts, grounded feet

</details>

- **Export**: GLB (binary glTF), +Y up, real-world scale — humans ≈ 1.8 m (Bruiser 2.05 m,
  bosses per spec below).
- **Rig**: Meshy auto-rig, standard humanoid skeleton.
- **Animations per character** (Meshy animation library or auto): `idle`, `run`,
  `attack_a`, `attack_b`, `special`, `hit`, `death`, plus per-character extras listed below.
- **Palette discipline**: ≤ 6 flat colors per character; accent color must match the
  archetype color listed (this is how players read teammates at a glance).
- Naming: `assets/models/<slug>.glb`.

## 1 — Player archetypes (6, all unique silhouettes)

| Slug | Archetype | Accent | Prompt core | Extra anims |
|---|---|---|---|---|
| `bruiser` | **THE BRUISER** (melee, fists) | crimson `#C0392B` | massively muscular office worker, torn white dress shirt with rolled sleeves, loosened tie, boxing hand-wraps ("braces") on huge fists, small head huge V-torso, gym shorts + dress shoes (comedy), confident stance | `punch_combo` (L-R-uppercut), `charge` (shoulder rush), `flex_taunt` |
| `janitor` | **THE JANITOR** (melee, reach) | moss `#5B6E5F` | wiry veteran custodian, olive coveralls, flat cap, push-broom held like a halberd, trash-can lid strapped to left forearm as a buckler, key ring on belt | `sweep_wide`, `lid_block`, `mop_slam` |
| `barista` | **THE BARISTA** (short range) | espresso `#8A5A2E` + cream | energetic barista, apron over rolled henley, twin steel steam-wand gauntlet on right arm venting steam, bandolier of syrup bottles, messy bun, sneakers | `steam_blast` (cone spray), `tamp_stomp` |
| `itsupport` | **IT SUPPORT** (short range) | cyan `#38E1FF` | hunched hoodie-over-shirt tech, LED visor glasses, backpack server rack with tiny antennas and one spinning fan, ethernet cable coiled like a lasso, cargo pants | `zap_hold` (two-hand beam), `deploy_router` (throw-down) |
| `intern` | **THE INTERN** (long range) | gold `#FFD23F` | scrappy young office worker, oversized ID lanyard, sleeves too long, dual heavy chrome staplers held like pistols, satchel overflowing with paper, one sock up one down | `dual_fire`, `reload_flip` (stapler spin) |
| `analyst` | **THE ANALYST** (long range, precision) | violet `#8E6BC8` | icy sharp-suited quant, long coat like a duster, monocle-HUD over one eye, rolled blueprint tube on back used as a rifle ("ledger rifle" — telescoping pointer barrel), pencil behind ear | `aim_charge` (scope pose), `quickscope` |

## 2 — Special enemies

| Slug | Name | Height | Prompt core |
|---|---|---|---|
| `gossip` | THE GOSSIP | 1.7 m | bloated green-tinged office worker about to burst, phone glued to ear, bubbling speech-bubble boils on shoulders |
| `complainer` | THE COMPLAINER | 1.8 m | sour hunched worker hugging a giant leaking coffee thermos, drip stains, permanent scowl |
| `micromanager` | THE MICROMANAGER | 1.4 m | small crouched predatory manager, huge glasses, red tie flying, clipboard talons, coiled to pounce |
| `motivator` | THE MOTIVATOR | 1.9 m | grinning sales-guru with golden megaphone, headset mic, blazer with rolled sleeves, standing on invisible stage energy |
| `securityguard` | THE SECURITY GUARD (new, Charger) | 2.2 m | asymmetric hulking mall-cop, one gigantic tackling shoulder with riot pad, utility belt, aviators, one small arm holding walkie-talkie |
| `litigator` | THE LITIGATOR (new, Smoker) | 1.9 m | gaunt lawyer with impossibly long red-tape ribbon coiled around forearm like a whip, briefcase shield, measuring-tape tongue motif |
| `stakeholder` | THE STAKEHOLDER (new, roaming mini-tank) | 2.6 m | bull-shaped brute in a pinstripe suit, literal bull horns fused with a briefcase-knuckle fists, ticker-tape breath |
| `karen` | KAREN | 1.75 m | asymmetric power-bob haircut monument, cardigan cape, crossed arms, "I demand" pointing pose ready, sunglasses on head |
| `auditor` | THE AUDITOR | 3.0 m | colossal grey IRS golem, suit stretched over stone-slab muscles, red ledger under one arm, calculator watch, glowing red reading glasses |

Base mobs (paperling, cubicle drone, printer, roomba, quad-drone, copier golem) keep
procedural bodies until v0.7, then optional Meshy pass with the same constraints.

## 3 — Bosses

| Slug | Boss | Height | Prompt core | Extra anims |
|---|---|---|---|---|
| `cfo` | DEREK KROHN — Head of Finance | 2.8 m | granite-faced CFO, armor made of stacked gold ledgers, abacus spine, coin-roll knuckles | `ledger_throw`, `coin_storm`, `slam` |
| `cmo` | BRANDI SPARK — Head of Marketing | 2.6 m | dazzling marketing exec, holographic gradient blazer, megaphone staff, sunglasses crown, confetti aura fins | `blink_pose`, `brand_blast`, `summon` |
| `vp` | CHAD MAVERICK — Head of Sales | 2.9 m | ex-linebacker sales VP, blazer over polo, bluetooth earpiece, golden phone brick, trophy shelf shoulder pads | `charge`, `cold_call_roar`, `summon` |
| `ceo` | THE C.E.O. | 3.4 m | ancient terrifying executive, obsidian suit with gold pinstripes as circuit lines, floating golden crown, cufflink gauntlets; SEPARATE PROP: rocket-thruster executive throne (`ceo_throne.glb`) he rides in phase 1 | `throne_ride`, `beam_sweep`, `parachute_slam`, `phase2_rage` |

## 4 — Equipment (visible gear, attaches to bone sockets)

Small props, 150-600 tris each, same faceted style, GLB each:
hand-wraps/braces (Bruiser upgrade tiers ×3), hard hat, propeller cap, golden crown,
noise-cancelling headphones, tactical vest, blazer variants ×3, sneakers/dress shoes/boots,
watches ×2, backpack, messenger bag, lanyard tiers ×3, knuckle staplers, katana-ruler,
riot lid (janitor upgrade), golden briefcase.

## 5 — Environment hero props (arena vibrancy pass, v0.7)

Elevator bank (ornate, penthouse variant), reception desk with logo wall, vending machine
v2, arcade-style coffee machine, server rack aisle, neon "SALES LEADERBOARD" sign,
office plants ×3 exotic, water cooler v2, photocopier v2, CEO desk v2, gold statue of the
CEO, breakroom booth set, whiteboard with charts, ceiling light clusters, window-washer
platform (exterior visible through windows).

## Integration pipeline (engineering side, tracked in ROADMAP v0.6)

1. Import GLB → `GLTFLoader`; validate scale/orientation; `flatShading: true` enforced
   on materials; palette-swap via vertex colors or per-material color overrides.
2. `AnimationMixer` state machine per entity (idle ↔ run blend, attack interrupts,
   death is terminal); crossfade 80-140 ms.
3. Socket map: `hand_R`, `hand_L`, `head`, `back`, `chest` for equipment attach.
4. Budget: whole battle scene ≤ 150k tris, ≤ 120 draw calls for characters.
5. Fallback: if a Meshy rig fails QA, the procedural rig from `characters.js` stays —
   ship blocker is silhouettes, not perfection.
