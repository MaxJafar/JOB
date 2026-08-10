# Contributing to J.O.B.

This is a hobby project. There is no release deadline, no revenue, and nobody
waiting on a milestone — which means there's room to just try things. Bug
reports, balance notes, new enemies and half-finished experiments are all
welcome.

If you're unsure whether something is wanted: open an issue and ask. The answer
is usually yes.

---

## Setup

**Requirements:** Node ≥ 20.19, a WebGL2 browser, and nothing else.

```bash
git clone https://github.com/MaxJafar/JOB.git
cd JOB
npm install
npm run dev
```

Before opening a pull request:

```bash
npm run check
```

That runs `lint → test → build`, which is exactly what CI runs. If it passes
locally it passes on GitHub.

---

## Learn the codebase in ten minutes

1. `npm run dev`, then press `` ` `` in-game to open the **debug panel**.
2. Warp between floors, spawn bosses, grant loot, drag the `TUNE` sliders.
3. Open `data/tune.json` in your editor, change `dashSpeed`, save. Your next
   dash is different — no reload, no lost run.

That loop is the fastest way to understand what any given system actually does.
Everything below is just describing it in more detail.

---

## The three rules

These are the conventions that keep the project from falling apart. A PR that
breaks one of them will get a comment asking about it.

### 1. World mutations go through `Game`

`Game` exposes `damageEnemy()`, `explode()`, `grantReward()` and friends. Every
change to the world goes through one of them, because that's where the netcode
hooks in.

```js
// ✗ works in single-player, silently breaks co-op
enemy.hp -= 25;

// ✓ replicates, triggers on-hit passives, feeds the Director, pays out
game.damageEnemy(enemy, 25, { source: player, kind: 'projectile' });
```

If you need a mutation that doesn't have a `Game` method yet, add one rather
than reaching around it.

### 2. Content is data

Enemies, classes, bosses, floors, gear, modules, waves and difficulty stages all
live in `/data/*.json`. Adding content should mean adding a row.

Write a closure in JS only when the *behaviour* is genuinely new — not to give
something different numbers.

### 3. The collider list is the single source of truth

`WorldBVH` (hitscan and line of sight), `NavMesh` (pathing) and `PhysicsWorld`
(debris, motor) are all built from the same `Level.colliders` array that
movement collision uses. Don't add a second source of geometry truth.

To enable or disable a collider at runtime, call `Level.setColliderDisabled()`.
Never assign `collider.disabled` directly — the funnel is what marks the BVH
dirty and toggles the Rapier body. Doors, arena seals and smashed furniture all
depend on it.

See [docs/ENGINE.md](docs/ENGINE.md) for the full engine contract.

---

## Adding content

### An enemy

1. **Stats** — add an entry under `defs` in `data/enemies.json`:

   ```json
   "shredder": {
     "name": "Document Shredder",
     "hp": 60, "dmg": 14, "speed": 3.2, "radius": 0.5, "centerY": 1.0,
     "xp": 5, "money": 8, "credit": 10,
     "ai": "melee", "attackRange": 1.8, "attackCd": 1.2, "windup": 0.4
   }
   ```

   Hex colours travel as `"0x8a8f98"` strings — JSON has no hex literals, and
   `parseHexData()` converts them on load.

2. **Silhouette** — if it needs a new shape, add a `case 'shredder':` to
   `buildMesh()` in `src/game/enemies.js`, composed from the `box`/`cyl`
   helpers in `props.js`. Reusing an existing body is pure JSON.

3. **Placement** — add the key to a biome roster in `data/floors.json`.

4. **Test it** — `` ` `` → spawn → fight it.

### A punch-card module

Modules are the loot that rewrites rules. Tiers, roll weights, passives and the
guaranteed per-boss cards are in `data/modules.json`; the behaviours live in
`src/game/modules.js`.

A **SPECIAL** is an activated ability on `X`. A **PASSIVE** should change *how
the game works*, not what a number is — "furniture you break detonates" is a
good passive; "+8% damage" is an item, and items go in `items.js`.

Every rarity tier scales the effect **and** cuts the cooldown. Keep that
property; it's what makes upgrades feel good rather than incremental.

### A floor

Floor composition, biome staff, lighting and generator parameters are in
`data/floors.json`. Layout generation is `src/game/floorplan.js` and
`src/game/level.js` (seeded — same seed, same floor, which is what makes
`tests/floorplan.test.js` possible).

---

## Code style

Enforced by ESLint and Prettier — run `npm run format` and `npm run lint:fix`.
Beyond that, match the surrounding code:

- **Comment the *why*, not the *what*.** The codebase is full of comments that
  explain a decision or record a bug that was expensive to find. Those are the
  valuable ones:

  > *An earlier version used a fixed 800×800 slab. At that scale Rapier's
  > shape-casts lose enough precision that `snapToGround` drags the character
  > capsule through the floor.*

  `// increment the counter` is noise. Delete it.

- **No new dependencies without a reason in the PR description.** The whole
  point of this project is that it's plain JS on a handful of libraries.
- **Pool anything spawned per frame.** Projectiles, particles and damage numbers
  all come from `src/core/pool.js`. Materials are cached.
- **Keep engine modules optional.** Rapier, recast and postprocessing must all
  fail soft. A missing WASM module costs a capability, never the boot.
- **Never break the frame budget silently.** If a change costs milliseconds, say
  so in the PR — the debug panel's perf graph gives you the number.

---

## Testing

```bash
npm test              # once
npm run test:watch    # while working
```

Tests live in `tests/` and run in Node under Vitest — no browser, no WebGL. Add
one when you touch:

- **the engine layer** (`src/core/`) — physics, navmesh, BVH, timestep, voices
- **netcode** (`src/net/`) — use `LoopbackTransport` to drive both ends of a
  co-op session in-process
- **generation** — floor plans, module rolls, anything seeded
- **data tables** — `tests/data.test.js` guards table integrity, so a typo in a
  JSON key fails CI instead of crashing at runtime

Gameplay feel doesn't need a unit test. Determinism does.

---

## Pull requests

- One logical change per PR. A new enemy and a physics refactor are two PRs.
- Say what you changed and why. Screenshots or a clip for anything visual.
- Note any frame-cost impact.
- `npm run check` must pass.
- Draft PRs are fine — open one early if you want feedback on an approach.

Commit messages: `type: short imperative summary` (`feat:`, `fix:`, `perf:`,
`docs:`, `refactor:`, `test:`). Match what's in `git log`.

---

## Reporting bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.yml). The two
things that make a report actionable:

- **The crash report.** When the game crashes it shows a copyable report instead
  of a frozen canvas — paste the whole thing. It carries the build version.
- **The seed**, if the bug is level-specific. Floors are deterministic, so a
  seed means the bug is reproducible.

Telemetry is local-only and never leaves your machine; you can export it from
the debug panel and attach it if it's relevant.

---

## A note on scope

This project was briefly aimed at a commercial release. It isn't any more, and
the parts of `docs/ROADMAP.md` about pricing, ad placements, wishlist targets
and two-SKU distribution are obsolete — ignore them. The *feature* milestones
are still a reasonable map of what's unfinished.

Contributions are MIT-licensed along with the rest of the project.
