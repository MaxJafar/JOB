// ============ in-game debug panel (tweakpane) ============
// ROADMAP v0.2 FOUNDATIONS: "In-game debug panel (` key): floor select, grant
// loot, force events, spawn any enemy, time-scale override, god mode, telemetry
// overlay." The roadmap calls this the single highest-leverage step of the whole
// EA period, because a balance change should be a slider drag, not a rebuild.
//
// Available automatically in `npm run dev`. In a release build it stays dormant
// until someone sets localStorage['job.debug'] = '1', so shipping players never
// see it but a playtester can be talked into enabling it over a call.

import { Pane } from 'tweakpane';
import { TUNE, FLOORS } from '../game/config.js';
import { ENEMY_DEFS } from '../game/enemies.js';
import { BOSS_DEFS } from '../game/bosses.js';
import { ITEMS } from '../game/items.js';
import { CLASSES } from '../game/classes.js';
import { POSTFX_QUALITY } from '../core/postfx.js';

export { debugEnabled } from './enabled.js';

export class DebugPanel {
  /** @param {import('../game/game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.pane = null;
    this.visible = false;
    // live-bound scratch state; tweakpane needs plain objects to bind to
    this.state = {
      fps: 0, frameMs: 0, p99: 0,
      entities: 0, enemies: 0, gibs: 0, drawCalls: 0, tris: 0,
      physMs: 0, postMs: 0, simSteps: 0,
      intensity: 0, pacing: '—', credits: 0, coeff: 0, stage: '—',
      pressure: 0, fatigue: 0, spawnBudget: 0, specialChance: 0, lootGen: 1, restDur: 0,
      qualityTier: '—', lodTiers: '—', aiSkipped: 0, instances: 0, callsSaved: 0,
      timeScale: 1, god: false, noclipSpeed: 1,
      spawnEnemy: Object.keys(ENEMY_DEFS)[0],
      spawnCount: 1,
      spawnBoss: Object.keys(BOSS_DEFS)[0],
      giveItem: ITEMS[0]?.id ?? '',
      gotoFloor: 0,
      asClass: CLASSES[0]?.key ?? '',
      postfx: 'off',
      fixedStep: true,
      simHz: 60,
      showNav: false, showColliders: false, showBvh: false, gpuStats: false,
      voicesPlayed: 0, voicesDropped: 0,
      budget: 0,
    };

    addEventListener('keydown', (e) => {
      if (e.code !== 'Backquote') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      this.toggle();
    });
  }

  toggle() { this.visible ? this.hide() : this.show(); }

  hide() {
    this.visible = false;
    if (this.pane) this.pane.element.parentElement.style.display = 'none';
    this.game.input?.lock?.();
  }

  show() {
    if (!this.pane) this.build();
    this.visible = true;
    this.pane.element.parentElement.style.display = '';
    this.game.input?.unlock?.();
  }

  // ---------------------------------------------------------------- build

  build() {
    const host = document.createElement('div');
    host.className = 'debug-pane-host';
    document.body.appendChild(host);

    const pane = new Pane({ title: 'J.O.B DEBUG  ( ` )', container: host, expanded: true });
    this.pane = pane;
    const g = this.game;
    const s = this.state;

    // ---- perf ----
    const perf = pane.addFolder({ title: '📈 Performance', expanded: true });
    perf.addBinding(s, 'fps', { readonly: true, view: 'graph', min: 0, max: 200, label: 'fps' });
    perf.addBinding(s, 'frameMs', { readonly: true, label: 'frame ms' });
    perf.addBinding(s, 'p99', { readonly: true, label: '1% low ms' });
    perf.addBinding(s, 'simSteps', { readonly: true, label: 'sim steps' });
    perf.addBinding(s, 'physMs', { readonly: true, label: 'physics ms' });
    perf.addBinding(s, 'postMs', { readonly: true, label: 'postfx ms' });
    perf.addBinding(s, 'drawCalls', { readonly: true, label: 'draw calls' });
    perf.addBinding(s, 'tris', { readonly: true, label: 'triangles' });
    perf.addBinding(s, 'enemies', { readonly: true, label: 'enemies' });
    perf.addBinding(s, 'gibs', { readonly: true, label: 'gibs' });
    perf.addBinding(s, 'voicesPlayed', { readonly: true, label: 'voices/s' });
    perf.addBinding(s, 'voicesDropped', { readonly: true, label: 'voices cut' });
    perf.addBinding(s, 'qualityTier', { readonly: true, label: 'quality tier' });
    perf.addBinding(s, 'lodTiers', { readonly: true, label: 'AI LOD n/m/f/d' });
    perf.addBinding(s, 'aiSkipped', { readonly: true, label: 'AI ticks saved' });
    perf.addBinding(s, 'instances', { readonly: true, label: 'instances' });
    perf.addBinding(s, 'callsSaved', { readonly: true, label: 'calls saved' });

    // ---- director ----
    const dir = pane.addFolder({ title: '🎬 Director', expanded: true });
    dir.addBinding(s, 'intensity', { readonly: true, view: 'graph', min: 0, max: 100 });
    dir.addBinding(s, 'pacing', { readonly: true });
    dir.addBinding(s, 'credits', { readonly: true });
    dir.addBinding(s, 'coeff', { readonly: true, label: 'difficulty' });
    dir.addBinding(s, 'stage', { readonly: true });
    // Director 2.0 — a pacing engine you cannot watch is a pacing engine you
    // cannot tune.
    dir.addBinding(s, 'pressure', { readonly: true, view: 'graph', min: 0, max: 1 });
    dir.addBinding(s, 'fatigue', { readonly: true, view: 'graph', min: 0, max: 1 });
    dir.addBinding(s, 'spawnBudget', { readonly: true, label: 'pop budget' });
    dir.addBinding(s, 'specialChance', { readonly: true, label: 'special %' });
    dir.addBinding(s, 'lootGen', { readonly: true, label: 'loot generosity' });
    dir.addBinding(s, 'restDur', { readonly: true, label: 'rest (s)' });
    for (const [label, fn] of [
      ['Force horde', () => g.director?.triggerAlarmHorde(null)],
      ['Force PEAK', () => g.director?.setPacing('PEAK', 25)],
      ['Force RELAX', () => g.director?.setPacing('RELAX', 25)],
      ['Spawn AUDITOR', () => g.director?.spawnAuditor()],
      ['+250 credits', () => { if (g.director) g.director.credits += 250; }],
      ['Kill all enemies', () => this.killAll()],
    ]) dir.addButton({ title: label }).on('click', fn);

    // ---- spawning ----
    const spawn = pane.addFolder({ title: '👔 Spawn', expanded: false });
    spawn.addBinding(s, 'spawnEnemy', {
      label: 'enemy',
      options: listOptions(Object.keys(ENEMY_DEFS)),
    });
    spawn.addBinding(s, 'spawnCount', { label: 'count', min: 1, max: 30, step: 1 });
    spawn.addButton({ title: 'Spawn at crosshair' }).on('click', () => this.spawnAtAim(s.spawnEnemy, s.spawnCount, {}));
    spawn.addButton({ title: 'Spawn ELITE' }).on('click', () => this.spawnAtAim(s.spawnEnemy, s.spawnCount, { elite: 'overtime' }));
    spawn.addBinding(s, 'spawnBoss', { label: 'boss', options: listOptions(Object.keys(BOSS_DEFS)) });
    spawn.addButton({ title: 'Spawn boss' }).on('click', () => this.spawnAtAim(s.spawnBoss, 1, {}));

    // ---- loot ----
    const loot = pane.addFolder({ title: '💼 Loot', expanded: false });
    loot.addBinding(s, 'giveItem', {
      label: 'item',
      options: listOptions(ITEMS.map((i) => i.id)),
    });
    loot.addButton({ title: 'Grant item' }).on('click', () => {
      const item = ITEMS.find((i) => i.id === s.giveItem);
      if (item && g.player) g.grantItem(g.player, item);
    });
    loot.addButton({ title: 'Grant 5 random items' }).on('click', () => {
      for (let i = 0; i < 5; i++) {
        const item = ITEMS[(Math.random() * ITEMS.length) | 0];
        if (g.player) g.grantItem(g.player, item);
      }
    });
    loot.addButton({ title: 'Open a draft' }).on('click', () => g.openDraft?.());
    loot.addButton({ title: '+1000 budget' }).on('click', () => { g.budget += 1000; g.hud?.setBudget?.(g.budget); });
    loot.addButton({ title: '+1000 money' }).on('click', () => { if (g.player) g.player.money += 1000; });

    // ---- flow ----
    const flow = pane.addFolder({ title: '🛗 Run flow', expanded: false });
    flow.addBinding(s, 'gotoFloor', {
      label: 'floor',
      options: FLOORS.map((f, i) => ({ text: `${i}: ${f.name}`, value: i })),
    });
    flow.addButton({ title: 'Warp to floor' }).on('click', () => this.warpToFloor(s.gotoFloor));
    flow.addButton({ title: 'Enter SANDBOX floor' }).on('click', () => g.enterSandbox?.());
    flow.addBinding(s, 'asClass', {
      label: 'class',
      options: CLASSES.map((c) => ({ text: c.name ?? c.key, value: c.key })),
    });
    flow.addButton({ title: 'Restart run as class' }).on('click', () => g.startRun(s.asClass, {}));
    flow.addButton({ title: 'Force LIGHTS OUT' }).on('click', () => g.startFloorEvent?.('lightsout'));
    flow.addButton({ title: 'Force FIRE DRILL' }).on('click', () => g.startFloorEvent?.('firedrill'));
    flow.addButton({ title: 'Win run' }).on('click', () => g.endRun?.(true));

    // ---- cheats ----
    const cheat = pane.addFolder({ title: '😇 Cheats', expanded: false });
    cheat.addBinding(s, 'god', { label: 'god mode' }).on('change', (e) => {
      if (g.player) g.player.godMode = e.value;
    });
    cheat.addBinding(s, 'timeScale', { label: 'time scale', min: 0.05, max: 3, step: 0.05 })
      .on('change', (e) => { g.timeScale = e.value; });
    cheat.addButton({ title: 'Heal to full' }).on('click', () => g.player?.heal(99999, true));
    cheat.addButton({ title: 'Refill ammo' }).on('click', () => {
      if (g.player) { g.player.ammo = g.player.classDef?.primary?.mag ?? 99; g.player.heatGauge = 0; }
    });

    // ---- engine ----
    const eng = pane.addFolder({ title: '⚙️ Engine', expanded: false });
    eng.addBinding(s, 'postfx', { label: 'post FX', options: listOptions(POSTFX_QUALITY) })
      .on('change', (e) => g.postfx?.setQuality(e.value));
    eng.addBinding(s, 'fixedStep', { label: 'fixed timestep' })
      .on('change', (e) => { g.useFixedStep = e.value; });
    eng.addBinding(s, 'simHz', { label: 'sim Hz', min: 30, max: 144, step: 1 })
      .on('change', (e) => g.timestep?.setRate(e.value));
    eng.addBinding(s, 'showNav', { label: 'draw navmesh' })
      .on('change', (e) => this.toggleNavDraw(e.value));
    eng.addButton({ title: 'Rebuild navmesh' }).on('click', () => {
      if (g.nav && g.level) console.info('[nav] rebuild →', g.nav.build(g.level), g.nav.stats);
    });
    eng.addButton({ title: 'Clear gibs' }).on('click', () => g.physics?.clearGibs());
    eng.addBinding(s, 'gpuStats', { label: 'GPU timer overlay' }).on('change', async (e) => {
      // real GPU timer queries — resolves a slow frame into CPU vs GPU, which is
      // the difference between "too many enemies" and "post-FX is too expensive"
      if (!this._gpu) {
        const { GpuStats } = await import('./gpuStats.js');
        this._gpu = new GpuStats();
        await this._gpu.attach(g.renderer);
        g.gpuStats = this._gpu;
      }
      this._gpu.setVisible(e.value);
    });

    // ---- tuning (hot values, no rebuild) ----
    const tune = pane.addFolder({ title: '🎚️ Tuning (live)', expanded: false });
    const tuneKeys = [
      ['gravity', 5, 60], ['playerJump', 3, 20], ['groundAccel', 10, 200],
      ['groundFriction', 1, 30], ['sprintMult', 1, 3], ['dashSpeed', 5, 40],
      ['dashCd', 0.2, 10], ['slideBoost', 1, 3], ['diffPerMinute', 0, 0.5],
      ['diffPerFloor', 0, 1.5], ['enemyHpScale', 0, 1], ['enemyDmgScale', 0, 1],
      ['maxAlive', 5, 120], ['hordeCap', 5, 140], ['comboWindow', 0.5, 12],
    ];
    for (const [key, min, max] of tuneKeys) {
      if (TUNE[key] === undefined) continue;
      tune.addBinding(TUNE, key, { min, max, step: (max - min) / 200 });
    }
    tune.addButton({ title: 'Copy TUNE as JSON' }).on('click', () => {
      navigator.clipboard?.writeText(JSON.stringify(TUNE, null, 2));
      g.hud?.toast?.('TUNE copied to clipboard', 'item');
    });

    // ---- telemetry ----
    const tel = pane.addFolder({ title: '📊 Telemetry', expanded: false });
    tel.addButton({ title: 'Log summary' }).on('click', () => console.table(g.telemetry?.summary?.() ?? {}));
    tel.addButton({ title: 'Export JSON' }).on('click', () => g.telemetry?.export?.());
    tel.addButton({ title: 'Clear history' }).on('click', () => g.telemetry?.clear?.());

    pane.addButton({ title: 'Close  ( ` )' }).on('click', () => this.hide());
  }

  // ---------------------------------------------------------------- actions

  aimPoint(dist = 8) {
    const g = this.game;
    const p = g.player;
    if (!p) return null;
    const dir = { x: Math.sin(p.yaw), z: Math.cos(p.yaw) };
    return g.level?.findSpawnPoint(p.pos, dist * 0.6, dist * 1.4)
      ?? { x: p.pos.x + dir.x * dist, y: 0, z: p.pos.z + dir.z * dist };
  }

  spawnAtAim(key, count, opts) {
    const g = this.game;
    for (let i = 0; i < count; i++) {
      const pos = this.aimPoint(7 + Math.random() * 6);
      if (pos) g.spawnEnemy(key, pos, opts);
    }
  }

  killAll() {
    const g = this.game;
    for (const e of [...g.enemies]) {
      if (!e.dead) g.damageEnemy(e, 1e9, { owner: g.player });
    }
  }

  warpToFloor(idx) {
    const g = this.game;
    if (!g.player) return;
    g.floorIndex = Math.max(0, idx - 1);
    g.nextFloor?.();
  }

  toggleNavDraw(on) {
    const g = this.game;
    if (!on) {
      if (this._navHelper) { g.scene.remove(this._navHelper); this._navHelper = null; }
      return;
    }
    // draws the geometry recast actually consumed — the fastest way to see why
    // a navmesh came out wrong is to look at what it was fed
    import('../core/navmesh.js').then(({ buildSourceMesh }) => {
      import('three').then((THREE) => {
        if (!g.level) return;
        const mesh = buildSourceMesh(g.level);
        mesh.material = new THREE.MeshBasicMaterial({
          color: 0x38e1ff, wireframe: true, transparent: true, opacity: 0.35, depthTest: false,
        });
        mesh.position.y = 0.05;
        mesh.renderOrder = 999;
        g.scene.add(mesh);
        this._navHelper = mesh;
      });
    });
  }

  // ---------------------------------------------------------------- tick

  /** Cheap enough to call every frame; tweakpane only repaints visible bindings. */
  update() {
    if (!this.visible || !this.pane) return;
    const g = this.game;
    const s = this.state;
    const info = g.renderer?.info;

    s.fps = Math.round(g.frameStats?.fps ?? 0);
    s.frameMs = +(g.frameStats?.avgMs ?? 0).toFixed(2);
    s.p99 = +(g.frameStats?.p99Ms ?? 0).toFixed(2);
    s.simSteps = g.timestep?.stepsLastFrame ?? 1;
    s.physMs = +(g.physics?.stats.stepMs ?? 0).toFixed(2);
    s.postMs = +(g.postfx?.stats.renderMs ?? 0).toFixed(2);
    s.drawCalls = info?.render.calls ?? 0;
    s.tris = info?.render.triangles ?? 0;
    s.enemies = g.enemies?.length ?? 0;
    s.gibs = g.physics?.stats.bodies ?? g.effects?.gibs?.length ?? 0;
    s.voicesPlayed = g.voices?.stats.played ?? 0;
    s.voicesDropped = g.voices?.stats.dropped ?? 0;

    const lod = g.enemyLOD?.summary();
    if (lod) {
      s.lodTiers = `${lod.near}/${lod.mid}/${lod.far}/${lod.distant}`;
      s.aiSkipped = lod.skipped;
    }
    const inst = g.instancing?.stats();
    if (inst) { s.instances = inst.instances; s.callsSaved = inst.drawCallsSaved; }
    s.qualityTier = g.perf?.tier ?? '—';

    const d = g.director;
    if (d) {
      s.intensity = Math.round(d.intensity);
      s.pacing = d.eventMode ? `${d.pacing} (EVENT)` : d.pacing;
      s.credits = Math.round(d.credits);
      s.coeff = +d.coeff.toFixed(2);
      s.stage = d.stage.label;
      const sig = d.signals ?? {};
      s.pressure = +(d.model?.pressure ?? 0).toFixed(2);
      s.fatigue = +(d.model?.fatigue ?? 0).toFixed(2);
      s.spawnBudget = sig.spawnBudget ?? 0;
      s.specialChance = +(sig.specialChance ?? 0).toFixed(3);
      s.lootGen = sig.lootGenerosity ?? 1;
      s.restDur = sig.restDuration ?? 0;
    }
    s.budget = g.budget ?? 0;
    this.pane.refresh();
  }

  dispose() {
    this.pane?.dispose();
    this.pane?.element?.parentElement?.remove();
    this.pane = null;
  }
}

function listOptions(keys) {
  return keys.map((k) => ({ text: k, value: k }));
}
