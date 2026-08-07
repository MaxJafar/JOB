# CHARACTER ART SPEC — Blender → GLB

The contract for every playable/enemy character in J.O.B. Model to this and the
model drops into the game with no code changes.

**Look:** Final Fantasy VII × Risk of Rain 2. Chunky low-poly, **tapered angular
volumes** — never axis-aligned boxes. Flat colour regions, no gradients, no
photoreal texture. Silhouette carries the character; a player must recognise it
as a solid black shape at 30 m.

**Detail comes from geometry and colour blocking, not texture painting.**
Faces are minimal or absent (RoR2 has none). If a character needs a face, keep it
to flat colour shapes, not painted shading.

---

## 1. The contract at a glance

| | |
|---|---|
| Format | `.glb` (binary glTF 2.0), one file per character |
| Units | 1 Blender unit = 1 metre |
| Up axis | +Y up, **-Z forward** (character faces -Z) — the exporter handles this |
| Origin | between the feet, on the floor — **feet at y = 0**, centred on x/z |
| Pose | **T-pose** — arms straight out sideways, palms down, legs straight, feet flat |
| Topology | triangles only |
| Tri budget | 1 500–3 000 players/specials · up to 6 000 bosses |
| Materials | ≤ 2 per character (see §5) |
| Skeleton | the shared rig in §3 — **identical bone names on every character** |
| Animation | **not in the character file** (see §6) |

Heights are per character and matter — the game reads threat by size:

| | m | | m |
|---|---|---|---|
| Intern / Analyst / Barista | 1.75–1.85 | Micromanager | 1.40 |
| Bruiser | 2.05 | Security Guard | 2.20 |
| Janitor / IT Support | 1.80 | Stakeholder | 2.60 |
| Gossip / Complainer | 1.70–1.80 | Auditor | 3.00 |

---

## 2. Modelling the style

The thing that makes low-poly read as *Minecraft* instead of *FF7* is uniform
axis-aligned boxes. Avoid that specifically:

- **Taper every limb.** An upper arm is wider than a wrist. Build limbs as
  5–8 sided tubes whose radius changes along the length, not as constant boxes.
- **Angle the volumes.** Chest wider at the shoulders than the waist, thighs
  angling inward toward the knee. Rotate forms off the world axes.
- **Bevel the silhouette, not the surface.** One cut on a shoulder or jaw reads
  from far away; interior detail does not.
- **Spend polys on the outline.** Anything that only shows as an interior line is
  wasted — put the budget into shapes that break the silhouette (shoulder pad,
  coat tail, backpack, hair mass).
- **Shade Flat everything.** No smooth shading, no normal maps. The engine forces
  flat shading on load anyway, so model expecting hard facets.
- **Hands can be mittens.** FF7 did it at this budget. Fingers are not worth polys.

---

## 3. The shared skeleton

**Every character uses the same bones with the same names.** That is what lets one
animation set drive the whole roster — it is the single biggest cost saver in the
pipeline, so it is not optional.

Names follow the Mixamo convention, because it means you can rig with Mixamo's
free auto-rigger and pull from its free animation library rather than hand-keying
every clip. The loader accepts names with or without the `mixamorig:` prefix.

```
Hips
├─ Spine → Spine1 → Spine2
│   ├─ Neck → Head
│   ├─ LeftShoulder  → LeftArm  → LeftForeArm  → LeftHand
│   └─ RightShoulder → RightArm → RightForeArm → RightHand
├─ LeftUpLeg  → LeftLeg  → LeftFoot  → LeftToeBase
└─ RightUpLeg → RightLeg → RightFoot → RightToeBase
```

21 bones. Do not add extras for gameplay attachment — use the sockets in §4.

**Weighting:** max 4 influences per vertex. At this poly count, rigid weighting
(1 bone per vertex) is fine and often looks better — it keeps facets crisp.

> **Rigging via Mixamo:** export your T-pose model as FBX → upload to
> mixamo.com → auto-rig → download animations as FBX → import to Blender →
> export the clip-only GLB per §6. Mixamo does not generate models; it fits a
> skeleton to yours and gives you hand-authored mocap. If you'd rather stay in
> Blender, Rigify works too — just rename the bones to match the list above.

---

## 4. Sockets (weapon & gear attachment)

The game attaches held items and visible gear at runtime. Add these as **empty
bones**, children of the bone named, zeroed to the attachment point:

| Socket bone | Parent | Where |
|---|---|---|
| `socket_hand_R` | `RightHand` | inside the closed fist, grip axis along -Z |
| `socket_hand_L` | `LeftHand` | same, mirrored |
| `socket_head` | `Head` | crown of the head |
| `socket_back` | `Spine2` | between the shoulder blades |
| `socket_chest` | `Spine2` | centre chest, facing -Z |

If a socket is missing the loader falls back to the parent bone, so a partial
delivery still works — it just aims worse.

**Do not model weapons into the character.** Staplers, brooms, mugs and gear are
separate assets attached at runtime.

---

## 5. Materials & colour

Flat colour only. Two accepted setups:

**A — Shared palette atlas (preferred).** One `palette.png` shared by every
character; each face is UV'd onto a flat colour swatch.
- Principled BSDF → Base Color ← Image Texture (`palette.png`)
- **Image Texture Interpolation = `Closest`** (or swatches blend at the seams)
- Metallic `0`, Roughness `1`, no normal/AO/emission maps
- One material for the whole roster → one draw call for all characters

**B — Plain base colours.** A material per colour region, Base Color set directly,
no texture. Simpler to author, but every material is another draw call — keep it
to ≤ 2 per character.

Either way: **no baked lighting, no ambient occlusion, no painted shadows.** The
scene lights the model. Baked shading is what made the last attempt look muddy.

Palette discipline: **≤ 6 colours per character**, and one must be the archetype
accent colour, since that is how players tell teammates apart at a glance.

---

## 6. Animation

Because the skeleton is shared, clips are authored **once for the whole roster**
and delivered separately from the characters:

```
public/models/characters/<slug>.glb     ← mesh + skeleton, NO animation
public/models/characters/_anims.glb      ← skeleton + every clip, NO mesh
```

A character may also ship its own signature clips inside its own file; those
override the shared set by name.

Clips the game drives today:

| Clip | Loop | ~Length | Used for |
|---|---|---|---|
| `idle` | yes | 2–4 s | standing |
| `run` | yes | 0.6–0.9 s | moving |
| `walk` | yes | 1.0 s | slow/aim movement *(optional)* |
| `attack_a` | no | **0.28 s** | melee swing, right side |
| `attack_b` | no | **0.28 s** | melee swing, left side (alternates) |
| `shoot` | no | 0.15 s | ranged fire, upper body only |
| `block` | yes | — | held guard (Janitor lid) |
| `dash` | no | 0.25 s | dash burst |
| `slide` | yes | — | slide, torso low |
| `jump` | no | 0.5 s | airborne |
| `hit` | no | 0.3 s | damage reaction |
| `death` | no | 1.2–1.8 s | terminal, ends lying down |

`attack_a`/`attack_b` timings are not stylistic — the melee swing window is
0.28 s in `player.js`. Author to that length or the hit won't land on the pose.

Keep the root bone in place (in-place animation). The game moves the character;
the clip must not translate it.

---

## 7. Blender export settings

`File → Export → glTF 2.0 (.glb)`

- **Format:** glTF Binary (.glb)
- **Include:** Selected Objects (mesh + armature only — no cameras, no lights)
- **Transform:** +Y Up ✔
- **Data → Mesh:** Apply Modifiers ✔, UVs ✔, Normals ✔, Vertex Colors ✔ (setup B only), Tangents ✘
- **Data → Material:** Export (Placeholder if using the shared atlas)
- **Data → Skinning:** ✔, Include All Bone Influences ✘ (cap at 4)
- **Animation:** ✘ for character files, ✔ for `_anims.glb`
- **Compression:** ✘ (the repo's `gltf-transform` pass handles optimisation)

Before exporting: apply all transforms (`Ctrl+A → All Transforms`), triangulate
(Triangulate modifier or `Ctrl+T`), and confirm the origin sits between the feet.

---

## 8. Check your work

```bash
npm run model:check public/models/characters/bruiser.glb
```

It reports height, tri count, bone names, missing sockets, material count and
whether the pose looks like a T-pose — everything in this document that can be
checked mechanically. Fix warnings before modelling the next character; a
skeleton mistake caught on character one is cheap, on character six it isn't.

To look at it in-game, from the browser console:

```js
game.previewCharacter('bruiser')            // spawn in front of the camera
game.previewCharacter('bruiser', 'run')     // play a clip
game.previewCharacter(null)                 // clear
```

---

## 9. Failure modes to avoid

| Symptom | Cause |
|---|---|
| Character sunk into or floating above the floor | origin not at the feet |
| Faces the wrong way when running | modelled facing +Z instead of -Z |
| Limbs stretch to a point when animated | bone names don't match §3 |
| Looks smooth and soft, not faceted | smooth shading, or a normal map |
| Muddy / washed out under scene lights | baked AO or painted shading in the texture |
| Weapon floats beside the hand | missing or mis-oriented `socket_hand_R` |
| Colours blur into each other | palette texture not set to `Closest` |
| Reads as a grey blob at distance | silhouette too smooth, palette too low-contrast |
