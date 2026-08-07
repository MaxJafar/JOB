# J.O.B — Engine layer

> The v0.35 **ENGINE HARDENING** milestone from [ROADMAP.md](ROADMAP.md) §"Adopted
> from the architecture review". This document is the contract for `src/core/`.

Everything here follows one rule: **the game must still run if any of it fails to
load.** Rapier, recast and the post-processing chain are all optional at runtime.
A missing WASM module costs a capability, never the boot.

---

## 1. What replaced what

| System | Before | Now | Why it mattered |
|---|---|---|---|
| Hitscan / line of sight | `pointBlocked()` sampled the ray every 0.7u against every collider | `WorldBVH.raycast()` / `segmentBlocked()` | The march cost `(range / 0.7) x colliders` **and** let shots tunnel through any wall thinner than the step |
| Enemy navigation | direct seek; mobs pressed into cubicle walls | `PathAgent` over a recast navmesh, engaged only when LOS is blocked | Room-graph floors made straight-line seek visibly stupid |
| Debris / Lego gibs | hand-integrated, bounced off the `y = 0` plane only | Rapier dynamic bodies against the real floor plan | Gibs sank through desks and ignored the room they died in |
| Simulation timing | raw frame delta into `update(dt)` | `FixedTimestep` at 60 Hz with sub-stepping | Dash distance, slide decay and jump apex all drifted with refresh rate |
| Audio | every call site hit the synth directly | `VoiceManager` in front of `audio.sfx` | A 40-mob horde meant 40 simultaneous voices — a wall of mud that buried hit confirms |
| Rendering | `renderer.render()` | `PostFX` composer (bloom → vignette → tone map) | Emissive ceilings and neon read as paint, not light; vignette doubles as the damage readout |
| Co-op pipe | raw `WebSocket` inside `NetSession` | `MultiplayerTransport` interface | The Steam swap was a session-layer rewrite; now it is a constructor argument |

---

## 2. The shared-truth rule

`WorldBVH`, `NavMesh` and `PhysicsWorld` are **all built from `level.colliders`** —
the same AABB list `collideCircle()` uses for movement.

This is deliberate. If bullets used render meshes while bodies used AABBs you get
"I shot through the desk I can't walk through" bugs that are miserable to chase.
Same source, three indexes over it.

The single funnel for changing a collider is `Level.setColliderDisabled()`, which
marks the BVH dirty and toggles the Rapier collider. Never assign
`collider.disabled` directly — the elevator doors, paid doors, arena seals and
smashed furniture all go through the funnel.

```
Level.colliders ──┬── collideCircle()      movement           (unchanged)
                  ├── WorldBVH             hitscan + LOS      (rebuilt per floor, refit on change)
                  ├── NavMesh              enemy pathing      (rebuilt per floor)
                  └── PhysicsWorld         debris + motor     (synced per floor)
```

---

## 3. Per-floor cost

Measured on the LOBBY floor (91 colliders, 9 rooms), paid once behind the
elevator fade — never per frame:

| Structure | Build |
|---|---|
| `WorldBVH` | ~4.6 ms |
| `NavMesh` | ~48 ms |
| Rapier collider sync | ~1 ms |

Runtime, in-browser: BVH raycast ~9 µs, navmesh path ~0.6 ms, physics step with
15 gibs ~0.3 ms. A 3-minute headless soak with 58 live enemies ran at
**0.22 ms/tick** against a 16.6 ms budget.

---

## 4. Module reference

### `core/physics.js` — Rapier
- `loadPhysics()` — one-shot async WASM init; resolves `false` instead of throwing.
- `PhysicsWorld.syncLevel(level, ceilH)` — mirrors colliders as static cuboids,
  plus a ground and ceiling **sized to the floor's own bounds**.
  > An earlier version used a fixed 800×800 slab. At that scale Rapier's
  > shape-casts lose enough precision that `snapToGround` drags the character
  > capsule *through* the floor. Keep world geometry near gameplay scale.
- `addGib(mesh, {vel, angVel, ttl})` — pooled dynamic box, cap 140, recycled oldest-first.
- `kick(pos, radius, force)` — explosion impulse over live gibs.
- `createMotor()` → `CharacterMotor`. **Opt-in** (`settings.physicsMotor`): the
  dash/slide/momentum feel in `TUNE` is hand-tuned and shipping, so Rapier is
  available as a motor to drive, not a controller to obey.

`CharacterMotor.move()` follows the canonical kinematic flow — read the body's
current translation, `computeColliderMovement`, write `setNextKinematicTranslation`
— and requires `PhysicsWorld.update()` to step the world each frame. Never write
to an attached collider's transform: `setTranslation` on a body-attached collider
is parent-relative and silently desyncs the shape.

### `core/worldbvh.js` — three-mesh-bvh
One merged box-soup geometry, 24 verts per collider. A disabled collider collapses
to a degenerate point so `refit()` stays valid without rebuilding. `flush()` folds
pending changes once per frame; `markDirty()` is cheap and idempotent.

### `core/navmesh.js` — recast-navigation
Built from synthesised geometry (room floor quads + obstacle boxes), never from
the render scene — decorative ceiling panels and signage must not confuse the
walkable surface. `PathAgent` repaths on a stagger timer, only when the direct
line is blocked, and returns `null` to mean "just beeline". Flyers get no agent.

### `core/timestep.js`
`FixedTimestep.advance(dt, fn)` sub-steps up to 5 times then **drops** the
backlog rather than trying to catch up. `fn(step, first)` — `first` gates
edge-triggered input via `Input.beginSubstep()` so two steps in one frame cannot
double-consume a keypress or double-apply mouse look.

`FrameStats.p99Ms` is the *mean of the worst 1%* of frames, not the value at the
99th-percentile index — the index form steps straight over a lone 90 ms hitch.

### `core/voices.js`
Distance cull → cooldown → polyphony cap → frame budget, ties broken by priority.
The polyphony cap is enforced **inside `flush()`**, not only at `play()`: forty
enemies firing in one frame all queue before any flush runs, so a play-time-only
check sees an empty table and waves every one of them through.

### `core/postfx.js`
Three effects, one pass. Tone mapping moved off the renderer into the chain so it
runs *after* bloom in HDR. Quality `off` falls back to `renderer.render()` and
hands tone mapping back. Vignette is driven by player HP — pressure without
another HUD element.

### `core/telemetry.js` / `core/errors.js`
Local-only run log (ROADMAP v0.2) with a summary keyed to the digest's funnel
targets. `CrashHandler` shows a copyable report instead of a frozen canvas, and
its watchdog ignores `document.hidden` — a backgrounded tab pauses `rAF` and is
not a crash.

### `net/transport.js`
`WebSocketTransport` (today), `LoopbackTransport` (in-process; makes co-op
message flow unit-testable), `SteamTransport` (stub for Steam Networking Messages
over SDR — deliberately **not** the deprecated `ISteamNetworking`).

---

## 5. Debug panel

Backtick (`` ` ``) opens the Tweakpane panel: live perf graph, director state and
overrides, spawn any enemy or boss, grant loot, warp floors, god mode, time scale,
post-FX quality, sim rate, live `TUNE` sliders with "copy as JSON", telemetry
export.

Always on in `npm run dev`. In a release build it stays dormant until
`localStorage['job.debug'] = '1'`, and the panel is a dynamic import so it never
enters the main bundle.

---

## 6. Settings that change engine behaviour

`meta.settings` (persisted):

| Key | Default | Effect |
|---|---|---|
| `postfx` | `'high'` | `off` \| `low` \| `high` |
| `fixedStep` | `true` | 60 Hz fixed sim vs raw frame delta |
| `telemetry` | `true` | local run log |
| `physicsDebris` | `true` | Rapier gibs vs the legacy bouncer |
