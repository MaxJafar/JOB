# Character models

Drop authored GLBs here. See `docs/CHARACTER_ART_SPEC.md` for the contract.

```
<slug>.glb    mesh + skeleton, no animation   (e.g. bruiser.glb)
_anims.glb    skeleton + every clip, no mesh  (shared by the whole roster)
```

Check a delivery before wiring it up:

```bash
npm run model:check public/models/characters/bruiser.glb
```

Then add `model: '<slug>'` to that character's entry in `src/game/classes.js`
(and `height:` in metres). Until the file exists the game uses the procedural
box rig, so nothing breaks while art is in progress.
