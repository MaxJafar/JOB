# What this changes

<!-- One or two sentences. Link the issue if there is one: Fixes #12 -->

## Why

<!-- The reasoning. If it's a bug fix, what was actually wrong? -->

## How to check it

<!--
  Steps for someone reviewing. The debug panel (`) makes most things
  one-click reproducible — say which floor to warp to and what to spawn.
-->

## Screenshots / clip

<!-- Required for anything visual. Before/after if you changed existing art or VFX. -->

---

## Checklist

- [ ] `npm run check` passes (lint + test + build)
- [ ] New content is a `/data/*.json` table entry where it could be
- [ ] World mutations go through `Game` methods (`damageEnemy`, `explode`, `grantReward`…), not direct field writes
- [ ] Collider changes go through `Level.setColliderDisabled()`, not `collider.disabled`
- [ ] Any new engine dependency fails soft — the game still boots if it doesn't load
- [ ] Tests added for engine / netcode / seeded-generation changes
- [ ] No new npm dependency, or the PR explains why one was needed

## Frame cost

<!--
  Delete if not applicable. If this runs per frame, give a number from the
  debug panel's perf graph — "+0.3 ms/tick with 40 enemies" is enough.
-->

Not applicable.
