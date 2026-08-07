// ============ THE GAME — orchestrator & state machine ============
import * as THREE from 'three';
import { Input } from '../core/input.js';
import { AudioSys } from '../core/audio.js';
import { Meta } from './meta.js';
import { Hud } from '../ui/hud.js';
import { Menus } from '../ui/menus.js';
import { Effects } from './effects.js';
import { Projectiles } from './projectiles.js';
import { Level, CEIL_H } from './level.js';
import { Player, RemotePlayer } from './player.js';
import { Enemy, ENEMY_DEFS } from './enemies.js';
import { Boss, BOSS_DEFS } from './bosses.js';
import { Director } from './director.js';
import { NetSession } from '../net/net.js';
import { PhysicsWorld, loadPhysics } from '../core/physics.js';
import { WorldBVH } from '../core/worldbvh.js';
import { NavMesh, loadNav } from '../core/navmesh.js';
import { PostFX } from '../core/postfx.js';
import { VoiceManager } from '../core/voices.js';
import { MusicDirector } from '../core/music.js';
import { FixedTimestep, FrameStats } from '../core/timestep.js';
import { PoolManager } from '../core/pool.js';
import { CombatQueries } from '../combat/queries.js';
import { EnemyLOD } from '../ai/lod.js';
import { PerformanceGovernor } from '../render/governor.js';
import { InstancingManager } from '../render/instancing.js';
import { DecalSystem } from '../render/decals.js';
import { Telemetry } from '../core/telemetry.js';
import { crashHandler } from '../core/errors.js';
import { debugEnabled } from '../dev/enabled.js';
import { FLOORS, TUNE, ANNOUNCER } from './config.js';
import { rollItem, ITEM_BY_ID, ITEMS } from './items.js';
import { rollDraft } from './upgrades.js';
import { KpiTracker } from './kpis.js';
import { THROWABLES, CONSUMABLES, rollWearable } from './gear.js';
import { clamp, chance, rand, choose, dist2D } from '../core/utils.js';
import { cyl, box } from './props.js';
import { preloadModels, updateMixers, reapRigs, loadedModels } from './models.js';
import { makePerson } from './characters.js';
import { CLASSES } from './classes.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;

    this.scene = new THREE.Scene();
    this.meta = new Meta();
    this.camera = new THREE.PerspectiveCamera(this.meta.settings.fov, innerWidth / innerHeight, 0.08, 300);
    this.scene.add(this.camera);
    this.baseFov = this.meta.settings.fov;

    this.input = new Input(canvas);
    this.audio = new AudioSys();
    this.audio.volumes = { master: this.meta.settings.volMaster, sfx: this.meta.settings.volSfx, music: this.meta.settings.volMusic };
    this.hud = new Hud();
    this.menus = new Menus(this);
    this.effects = new Effects(this.scene);
    this.projectiles = new Projectiles(this.scene, this);
    this.net = new NetSession(this);

    // ---- engine services (see docs/ENGINE.md) ----
    this.physics = new PhysicsWorld();     // Rapier: world colliders + debris
    this.bvh = new WorldBVH();             // three-mesh-bvh: hitscan & line of sight
    this.nav = new NavMesh();              // recast: enemy pathing
    this.postfx = new PostFX(this.renderer, this.scene, this.camera);
    this.pools = new PoolManager();        // bullets, particles, gibs, decals
    this.combat = new CombatQueries(this); // the ONE hit-detection API
    this.enemyLOD = new EnemyLOD(this);    // 60/20/5/1 Hz AI tiers
    this.instancing = new InstancingManager(this.scene);
    this.decals = new DecalSystem(this.instancing);  // 150 blood splats = 1 draw call
    this.perf = new PerformanceGovernor(this);
    this.timestep = new FixedTimestep({ hz: 60, maxSubSteps: 5 });
    this.frameStats = new FrameStats();
    this.telemetry = new Telemetry({ enabled: this.meta.settings.telemetry !== false });
    this.useFixedStep = this.meta.settings.fixedStep !== false;
    this.realDt = 1 / 60;                  // unscaled — audio and UI ignore slow-mo

    // Voice management wraps the synth in place, so all ~130 existing
    // audio.sfx() call sites become polyphony-limited and distance-culled
    // without touching a single one of them.
    const rawSfx = this.audio.sfx.bind(this.audio);
    this.voices = new VoiceManager({ sfx: rawSfx });
    this.audio.sfx = (name, opt = {}) => {
      this.voices.play(name, { pos: opt.pos ?? null, vol: opt.vol ?? 1, priority: opt.priority });
    };
    this.audio.sfxRaw = rawSfx;

    // Same decorator trick for music: every setMood() call site now goes through
    // the director, which plays a streamed stem if one exists for that mood and
    // otherwise falls back to the procedural muzak.
    const rawMood = this.audio.setMood.bind(this.audio);
    this.music = new MusicDirector({
      setMood: rawMood,
      setVolume: this.audio.setVolume.bind(this.audio),
      volumes: this.audio.volumes,
    });
    this.audio.setMood = (mood) => this.music.setMood(mood);
    this.audio.setMoodRaw = rawMood;

    this._bootEngine();

    this.state = 'title';
    this.paused = false;
    this.runOver = false;
    this.runTime = 0;
    this.dtLast = 0.016;
    this.floorIndex = 0;
    this.loopCount = 0;
    this.floorSeed = 1;
    this.camShakeAmt = 0;
    this.fovKick = 0;

    this.player = null;
    this.remotePlayers = new Map();
    this.enemies = [];
    this.enemyById = new Map();
    this.turrets = [];
    this.hazards = [];
    this.slowZones = [];
    this.shockRings = [];
    this.tickers = [];
    this.delayedQ = [];
    this.level = null;
    this.director = new Director(this);
    this.kpi = new KpiTracker(this);
    this.combo = { count: 0, t: 0, best: 0, lastBonus: 0 };
    this.timeScale = 1;
    this.hitstopT = 0;
    this.draftQueue = 0;
    this.draftOpen = false;
    this.draftPicks = null;
    this.inventoryOpen = false;
    this.floorEvent = null;   // {kind, t}
    this.gearDrops = [];      // world pickups: briefcases with wearables/throwables/consumables
    this.budget = 0;          // DEPARTMENT BUDGET — shared team currency for doors & floor systems
    this.floorBuff = null;    // active floor-breaker effect
    this.lockdown = null;     // wave-arena lockdown state {wave, pending, t}
    this.currentRoom = null;
    this.activeBoss = null;
    this.eventState = 'idle';   // idle | charging | boss | open
    this.eventProgress = 0;
    this.eventZoneMesh = null;
    this.evSyncT = 0;

    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
      this.postfx.setSize(innerWidth, innerHeight);
    });
    this.renderer.setSize(innerWidth, innerHeight);

    this.input.onLockLost = () => {
      if (this.draftOpen || this.inventoryOpen) return; // overlay owns the cursor
      if (this.state === 'run' && !this.paused && !this.runOver) this.togglePause(true);
    };
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.state === 'run' && !this.runOver) {
        // pointer lock exit fires onLockLost; handle direct Esc when not locked
        if (!this.input.locked && !this.paused) this.togglePause(true);
      }
      if (e.code === 'KeyP' && this.state === 'run') this.togglePause(!this.paused);
    });
    canvas.addEventListener('mousedown', () => {
      this.audio.ensure();
      if (this.state === 'run' && !this.paused && !this.input.locked && !this.runOver) this.input.lock();
    });

    // Authored character GLBs stream in behind the title screen. Any class whose
    // model hasn't been delivered yet just spawns as its procedural box version.
    this.modelsReady = preloadModels(CLASSES.filter((c) => c.model).map((c) => ({ slug: c.model, height: c.height })))
      .then(() => { this.loadedModels = loadedModels(); });

    this._last = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
    this.toTitle();
  }

  /**
   * Bring up the async engine services. Every one of them is optional: if a WASM
   * module fails to load the game keeps running on its original code paths, it
   * just loses that capability. A missing physics engine must never be the
   * difference between "the game starts" and "a black screen".
   */
  async _bootEngine() {
    this.postfx.setQuality(this.meta.settings.postfx ?? 'high');
    this.music.preload();

    // GPU string in the crash report turns "it crashes for one player" into
    // "it crashes on Intel UHD 620" without a support round-trip.
    try {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      crashHandler.noteGpu(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    } catch { /* extension blocked — not worth failing boot over */ }

    // Classify the machine BEFORE the first floor, so a weak GPU never has to
    // discover its limits by dropping frames for ten seconds first.
    await this.perf.detect();

    const [physOk, navOk] = await Promise.all([loadPhysics(), loadNav()]);
    if (physOk) {
      this.physics.init();
      // adopt the floor that may already have been built while WASM loaded
      if (this.level) this.physics.syncLevel(this.level, this.level.ceilHeight ?? 4.3);
      this.effects.physics = this.physics;
    }
    if (navOk && this.level) this.nav.build(this.level);

    console.info(
      `[engine] physics=${physOk ? 'rapier' : 'legacy'} nav=${navOk ? 'recast' : 'direct-seek'} ` +
      `bvh=three-mesh-bvh postfx=${this.postfx.quality} sim=${this.useFixedStep ? `${this.timestep.hz}Hz fixed` : 'variable'} ` +
      `quality=${this.perf.tier} lod=on`,
    );

    if (debugEnabled()) {
      const { DebugPanel } = await import('../dev/debugPanel.js');
      this.debug = new DebugPanel(this);
    }
  }

  /**
   * Build every spatial acceleration structure for the freshly generated floor.
   * All three read the SAME collider list the movement code uses, so hitscan,
   * pathing and physics can never disagree about what is solid.
   *
   * Budget on a 70x58 floor: BVH ~2ms, navmesh ~25ms, Rapier sync ~1ms. That is
   * paid once, behind the elevator fade, not per frame.
   */
  buildFloorAcceleration() {
    if (!this.level) return;
    const t0 = performance.now();
    this.bvh.build(this.level);
    if (this.physics.ready) {
      this.physics.clearGibs();
      this.physics.syncLevel(this.level, CEIL_H);
      this.effects.physics = this.physics;
    }
    this.nav.build(this.level);   // no-ops and returns false if recast is absent
    console.info(
      `[engine] floor "${this.floorDef?.key}" accel built in ${(performance.now() - t0).toFixed(1)}ms ` +
      `(bvh ${this.bvh.stats.boxes} boxes / ${this.bvh.stats.buildMs.toFixed(1)}ms, nav ${this.nav.ready ? `${this.nav.stats.buildMs}ms` : 'unavailable'})`,
    );
  }

  /** Snapshot handed to the crash reporter so a stack trace has game context. */
  crashState() {
    return {
      state: this.state,
      floor: this.floorDef?.key ?? null,
      floorIndex: this.floorIndex,
      seed: this.floorSeed,
      runTime: +this.runTime.toFixed(1),
      classKey: this.player?.classDef?.key ?? null,
      hp: this.player ? Math.round(this.player.hp) : null,
      enemies: this.enemies.length,
      gibs: this.physics?.stats.bodies ?? 0,
      difficulty: +(this.director?.coeff ?? 0).toFixed(2),
      pacing: this.director?.pacing ?? null,
      coop: this.net.connected ? { host: this.net.isHost, peers: this.net.roster.length } : false,
      fps: Math.round(this.frameStats.fps),
    };
  }

  // ================= state transitions =================
  toTitle() {
    this.teardownRun();
    this.state = 'title';
    this.hud.hide();
    this.menus.showTitle();
    this.audio.ensure();
    this.audio.setMood('menu');
    this.input.unlock();
  }

  startRun(classKey, { seed = null, floorIndex = 0, loop = 0 } = {}) {
    this.teardownRun();
    this.menus.clear();
    this.state = 'run';
    this.runOver = false;
    this.paused = false;
    this.victoryLap = false;
    this.timeScale = 1;
    this.hitstopT = 0;
    this.draftOpen = false;
    this.draftQueue = 0;
    this.combo = { count: 0, t: 0, best: 0, lastBonus: 0 };
    this.hud.hideDraft();
    this.runTime = 0;
    this.loopCount = loop;
    this.stats = { kills: 0, bossKills: 0, floorsCleared: 0, moneyEarned: 0, cause: 'overwork' };
    this.floorSeed = seed ?? ((Math.random() * 1e9) | 0);
    this.player = new Player(this, classKey, this.meta.settings.playerName);
    this.budget = 0;
    this.hud.reset();
    this.hud.setAbilityIcons(this.player.classDef);
    this.hud.refreshPockets(this.player);
    this.hud.setBudget(0);
    this.hud.show();
    this.telemetry.startRun({
      classKey, seed: this.floorSeed, loop,
      coop: this.net.connected,
      players: this.net.connected ? this.net.roster.length : 1,
    });
    this.buildFloor(floorIndex, this.floorSeed);
    this.audio.ensure();
    this.audio.setMood('chill');
    this.input.lock();
    if (this.net.connected) this.net.inRun = true;
  }

  // co-op entry points
  netConnect(url, room, name) {
    this.lastRelayUrl = url;
    this.lastRoom = room;
    this.net.connect(url, room, name);
  }
  netDisconnect() { this.net.disconnect(); }

  lobbyPickAndStart(cls) {
    this.net.pickClass(cls);
    if (this.net.isHost) {
      const seed = (Math.random() * 1e9) | 0;
      this.net.hostStart(seed);
      this.startRun(cls, { seed });
    } else {
      this.menus.showLobby();
      this.net.status = '✅ Role picked. Waiting for host to start…';
    }
  }
  netStartRun(cls, seed, floorIndex, loop) {
    this.startRun(cls, { seed, floorIndex, loop });
  }
  adoptHostRole() {
    // promoted mid-run: enemies we know become real (puppets start thinking)
    for (const e of this.enemies) e.netPuppet = false;
  }

  teardownRun() {
    this.audio.setMood('off');
    for (const e of this.enemies) e.disposeMesh();
    this.enemies.length = 0;
    this.enemyById.clear();
    for (const [, r] of this.remotePlayers) r.dispose();
    this.remotePlayers.clear();
    this.projectiles.clear();
    for (const t of this.turrets) this.scene.remove(t.mesh);
    this.turrets.length = 0;
    for (const h of this.hazards) this.scene.remove(h.mesh);
    this.hazards.length = 0;
    for (const z of this.slowZones) this.scene.remove(z.mesh);
    this.slowZones.length = 0;
    for (const r of this.shockRings) this.scene.remove(r.mesh);
    this.shockRings.length = 0;
    this.tickers.length = 0;
    this.delayedQ.length = 0;
    for (const d of this.gearDrops) this.scene.remove(d.group);
    this.gearDrops.length = 0;
    this.effects.dispose();
    this.inventoryOpen = false;
    this.hud.hideInventory();
    if (this.eventZoneMesh) { this.scene.remove(this.eventZoneMesh); this.eventZoneMesh = null; }
    if (this.level) { this.level.dispose(this.scene); this.level = null; }
    if (this.player) { this.player.dispose(); this.player = null; }
    // spatial structures belong to a floor — never let a dead floor's geometry
    // answer queries for the next one
    this.physics.clearGibs();
    this.physics.clearLevel();
    this.bvh.dispose();
    this.nav.dispose();
    this.decals.clear();
    this.instancing.clear();
    this.pools.releaseAll();   // hand objects back, keep the buffers
    this.timestep.reset();
    this.activeBoss = null;
    this.eventState = 'idle';
    reapRigs();   // drop AnimationMixers whose meshes just left the scene
    this.hud.reset();
    this.hud.hideBoss();
  }

  // ---- character art QA (docs/CHARACTER_ART_SPEC.md §8) ----
  // Drop a delivered model in front of the camera and drive its clips:
  //   game.previewCharacter('bruiser')          → spawn + list clips
  //   game.previewCharacter('bruiser', 'run')   → play one clip
  //   game.previewCharacter(null)               → clear
  async previewCharacter(slug, clip = null, height = null) {
    if (this._previewRig) {
      this.scene.remove(this._previewRig.root);
      this._previewRig.rig?.dispose();
      this._previewRig = null;
    }
    if (!slug) return 'cleared';

    // Load on demand so a freshly-exported GLB can be inspected without first
    // wiring it into classes.js.
    await preloadModels([{ slug, height }]);
    const built = makePerson({ model: slug });
    if (!built.rig) {
      return `'${slug}' failed to load — expected public/models/characters/${slug}.glb `
        + `(loaded: ${loadedModels().join(', ') || 'none'})`;
    }
    this._previewRig = built;
    const root = built.root;
    root.position.copy(this.camera.position).add(this.camera.getWorldDirection(_v1).multiplyScalar(4));
    root.position.y = 0;
    root.lookAt(this.camera.position.x, 0, this.camera.position.z);
    this.scene.add(root);
    if (clip && !built.rig.play(clip, 0.1, { restart: true })) {
      return `no clip '${clip}' — has: ${[...built.rig.actions.keys()].join(', ')}`;
    }
    return `${slug} — clips: ${[...built.rig.actions.keys()].join(', ') || '(none)'}`;
  }

  buildFloor(idx, seed) {
    if (this.level) this.level.dispose(this.scene);
    this.projectiles.clear();
    for (const e of this.enemies) e.disposeMesh();
    this.enemies.length = 0;
    this.enemyById.clear();
    for (const h of this.hazards) this.scene.remove(h.mesh);
    this.hazards.length = 0;
    for (const z of this.slowZones) this.scene.remove(z.mesh);
    this.slowZones.length = 0;
    for (const r of this.shockRings) this.scene.remove(r.mesh);
    this.shockRings.length = 0;
    for (const t of this.turrets) this.scene.remove(t.mesh);
    this.turrets.length = 0;
    this.tickers.length = 0;
    this.delayedQ.length = 0;
    for (const d of this.gearDrops) this.scene.remove(d.group);
    this.gearDrops.length = 0;
    this.activeBoss = null;
    this.eventState = 'idle';
    this.eventProgress = 0;
    if (this.eventZoneMesh) { this.scene.remove(this.eventZoneMesh); this.eventZoneMesh = null; }
    this.hud.hideBoss();
    this.hud.hideEvent();

    this.floorIndex = idx;
    this.floorSeed = seed;
    this.floorDef = FLOORS[idx];
    this.kpi.resetFloor();
    this.hud.setKpi(null);
    this.combo.count = 0;
    this.combo.t = 0;
    this.floorEvent = null;
    this.floorBuff = null;
    this.lockdown = null;
    this.lockdownDone = false;
    this.currentRoom = null;
    if (this.player) this.player.hydratedThisFloor = false;
    this.level = new Level(this, this.floorDef, seed);
    this.scene.add(this.level.group);
    this.scene.fog = new THREE.Fog(this.floorDef.palette.fog, 30, 95);
    this.scene.background = new THREE.Color(this.floorDef.palette.fog);
    this.buildFloorAcceleration();

    // spawn players at the arrival elevator
    const sp = this.level.playerSpawn;
    if (this.player) {
      // teleport (not a position write) so the motor's interpolation history
      // resets too — otherwise the first frame on a new floor lerps across the
      // whole building
      this.player.motor.teleport(sp.x + rand(-1.5, 1.5), sp.y, sp.z);
      this.player.yaw = Math.PI;          // face into the room (toward -z)
      this.player.parachuteUsed = false;
      if (this.player.dead) { this.player.dead = false; this.player.hp = this.player.stats.maxHp * 0.5; this.player.mesh.visible = true; }
    }
    this.telemetry.floorEntered(idx, this.floorDef.key, this.runTime);
    this.hud.setFloor(this.floorDef, this.loopCount);
    this.hud.announce(`${this.floorDef.name} — ${this.floorDef.sub}`, 3);
    this.audio.sfx('ding');
    this.director.resetFloor(idx);

    const isHost = !this.net.connected || this.net.isHost;
    if (isHost) {
      this.director.spawnKarenIfAny();
      if (this.floorDef.isFinal) {
        // the C.E.O. is waiting behind his desk
        this.delayed(2.5, () => this.spawnFloorBoss());
      }
    }
    this.fadeIn();
  }

  nextFloor() {
    const isHost = !this.net.connected || this.net.isHost;
    this.stats.floorsCleared++;
    let idx = this.floorIndex + 1;
    let loop = this.loopCount;
    if (idx >= FLOORS.length) { idx = 0; loop++; }
    const seed = (Math.random() * 1e9) | 0;
    if (isHost && this.net.connected) {
      this.net.sendEvent({ k: 'floor', idx, seed, loop });
    }
    this.loopCount = loop;
    this.fadeOut(() => {
      this.buildFloor(idx, seed);
    });
  }

  continueEndless() {
    this.menus.clear();
    this.state = 'run';
    this.runOver = false;
    this.victoryLap = false;
    if (this.player) this.player.iframes = 0;
    this.loopCount++;
    const seed = (Math.random() * 1e9) | 0;
    this.buildFloor(0, seed);
    this.hud.show();
    this.input.lock();
    this.audio.setMood('chill');
  }

  abandonRun() {
    this.stats.cause = 'voluntary resignation';
    this.endRun(false);
  }

  onPlayerDeath(p) {
    if (p !== this.player || this.victoryLap) return;
    // co-op: if a teammate lives, wait for next floor
    if (this.net.connected && this.net.inRun) {
      const anyAlive = [...this.remotePlayers.values()].some((r) => !r.dead);
      if (anyAlive) {
        this.hud.toast('YOU ARE DOWN — respawning next floor', 'warn');
        this.player.mesh.visible = false;
        return;
      }
    }
    this.endRun(false);
  }

  endRun(won) {
    if (this.runOver) return;
    this.runOver = true;
    this.state = won ? 'victory' : 'dead';
    this.timeScale = 1;
    this.hitstopT = 0;
    this.draftOpen = false;
    this.draftQueue = 0;
    this.hud.hideDraft();
    this.input.unlock();
    this.audio.setMood('off');
    this.audio.sfx(won ? 'victory' : 'death');

    if (!won) {
      // Death recap data — the single most actionable balance signal we collect.
      this.telemetry.death({
        cause: this.stats.cause,
        enemyKey: this.player?.lastDamagedBy ?? null,
        pos: this.player?.pos ?? null,
        floorIndex: this.floorIndex,
        hpBefore: 0,
        difficulty: this.director?.coeff,
      }, this.runTime);
    }
    this.telemetry.perfSample(this.frameStats.avgMs, this.frameStats.p99Ms);
    this.telemetry.endRun(won ? 'won' : (this.stats.cause === 'voluntary resignation' ? 'abandoned' : 'died'),
      this.runTime, {
        kills: this.stats.kills,
        bossKills: this.stats.bossKills,
        floorsCleared: this.stats.floorsCleared,
        bestCombo: this.combo.best,
        difficulty: +(this.director?.coeff ?? 0).toFixed(2),
      });
    const severance = this.meta.endOfRun({
      kills: this.stats.kills,
      floorsCleared: this.stats.floorsCleared,
      bossKills: this.stats.bossKills,
      won,
      floorReached: this.floorIndex + 1 + this.loopCount * FLOORS.length,
    });
    const statPack = {
      time: this.runTime,
      kills: this.stats.kills,
      money: this.player?.money ?? 0,
      floorName: this.floorDef?.name ?? '—',
      severance,
      cause: this.stats.cause,
      loops: this.loopCount,
    };
    this.hud.hide();
    setTimeout(() => {
      if (won) this.menus.showVictory(statPack);
      else this.menus.showDeath(statPack);
    }, won ? 1500 : 700);
  }

  togglePause(on) {
    if (this.state !== 'run') return;
    this.paused = on;
    if (on) {
      this.input.unlock();
      this.menus.showPause();
    } else {
      this.menus.clear();
      this.input.lock();
    }
  }

  setFov(v) {
    this.baseFov = v;
  }

  fadeOut(cb) {
    const el = document.getElementById('fade-screen');
    el.classList.add('on');
    setTimeout(() => { cb(); }, 520);
  }
  fadeIn() {
    const el = document.getElementById('fade-screen');
    setTimeout(() => el.classList.remove('on'), 80);
  }

  // ================= main loop =================
  frame() {
    const now = performance.now();
    const dt = clamp((now - this._last) / 1000, 0, 0.05);
    this._last = now;
    this.realDt = dt;
    this.frameStats.push(dt * 1000);
    crashHandler.heartbeat();

    // hit-stop & slow-mo scale SIM time only — audio, UI and the crash watchdog
    // keep running on the real clock.
    let sdt = dt * this.timeScale;
    if (this.hitstopT > 0) { this.hitstopT -= dt; sdt = dt * 0.12; }
    this.dtLast = sdt;

    const draftPausesWorld = this.draftOpen && !(this.net.connected && this.net.inRun);
    const simRunning = this.state === 'run' && !draftPausesWorld
      && (!this.paused || (this.net.connected && this.net.inRun));

    if (simRunning) {
      if (this.useFixedStep) {
        // Constant-rate simulation: dash distance, slide decay and jump apex stop
        // depending on the player's refresh rate. `first` gates edge-triggered
        // input so two steps in one frame cannot double-consume a keypress.
        this.timestep.advance(sdt, (step, first) => {
          this.input.beginSubstep(first);
          this.update(step);
        });
        this.input.beginSubstep(true);
      } else {
        this.update(sdt);
      }
    } else {
      this.timestep.reset();
    }

    if (this.draftOpen && this.state === 'run') this.handleDraftKeys();

    this.effects.update(sdt);
    updateMixers(sdt);   // skinned rigs share the hit-stop / slow-mo clock
    this.physics.update(sdt);
    this.bvh.flush();
    this.voices.setListener(this.player?.pos ?? this.camera.position);
    this.voices.update(dt);

    const hpFrac = this.player && !this.player.dead
      ? this.player.hp / Math.max(1, this.player.stats.maxHp)
      : 1;
    this.postfx.update(dt, hpFrac);
    if (!this.postfx.render(dt)) this.renderer.render(this.scene, this.camera);

    // Closed loop last: it reads this frame's cost and adjusts the next one.
    this.perf.update(dt);
    this.debug?.update();
    this.input.endFrame();
  }

  handleDraftKeys() {
    for (let i = 0; i < 3; i++) {
      if (this.input.pressed(`Digit${i + 1}`) || this.input.pressed(`Numpad${i + 1}`)) this.pickDraft(i);
    }
  }

  update(dt) {
    this.runTime += dt;
    const isHost = !this.net.connected || this.net.isHost;

    // delayed callbacks
    for (let i = this.delayedQ.length - 1; i >= 0; i--) {
      const d = this.delayedQ[i];
      d.t -= dt;
      if (d.t <= 0) { this.delayedQ.splice(i, 1); d.fn(); }
    }
    // tickers (boss jump arcs etc.)
    for (let i = this.tickers.length - 1; i >= 0; i--) {
      if (!this.tickers[i].update(dt)) this.tickers.splice(i, 1);
    }

    this.level.update(dt, this);
    if (isHost) this.director.update(dt);
    if (isHost) this.kpi.update(dt);

    // combo decay
    if (this.combo.count > 0) {
      this.combo.t -= dt;
      if (this.combo.t <= 0) {
        this.combo.count = 0;
        this.player?.recomputeStats();
      }
    }
    // floor event timer
    if (this.floorEvent) {
      this.floorEvent.t -= dt;
      if (this.floorEvent.kind === 'firedrill') {
        // the whole floor stays rallied while the drill runs
        for (const e of this.enemies) if (!e.dead && !e.def.boss) e.rallyT = Math.max(e.rallyT ?? 0, 0.5);
      }
      if (this.floorEvent.t <= 0) this.endFloorEvent();
    }

    if (this.player && !this.runOver) this.player.update(dt);

    // slow zones: reset factors then apply
    for (const e of this.enemies) e.slowFactor = 1;
    for (let i = this.slowZones.length - 1; i >= 0; i--) {
      const z = this.slowZones[i];
      z.ttl -= dt;
      z.mesh.rotation.z += dt * 0.6;
      z.mesh.material.opacity = Math.min(0.35, z.ttl);
      if (z.ttl <= 0) { this.scene.remove(z.mesh); this.slowZones.splice(i, 1); continue; }
      z.tick = (z.tick ?? 0) - dt;
      const doTick = z.dps > 0 && z.tick <= 0;
      if (doTick) z.tick = 0.5;
      for (const e of this.enemies) {
        if (!e.dead && dist2D(e.pos, z.pos) < z.radius) {
          e.slowFactor = Math.min(e.slowFactor, z.factor);
          if (doTick) this.damageEnemy(e, z.dps * 0.5, { owner: z.owner ?? this.player, dot: true });
        }
      }
    }

    // Enemies, through the LOD scheduler. Distant mobs think at 5 Hz or 1 Hz
    // with the accumulated dt, so they cover the same ground for a fraction of
    // the cost — this is what makes 100+ enemies affordable.
    const reaped = this.enemyLOD.update(dt, (e, edt) => (
      e.netPuppet ? this.updatePuppet(e, edt) : e.update(edt)
    ));
    for (const e of reaped) {
      const i = this.enemies.indexOf(e);
      if (i >= 0) this.enemies.splice(i, 1);
      e.disposeMesh();
      this.enemyById.delete(e.id);
    }

    // projectiles & hazards
    this.projectiles.update(dt);
    this.updateHazards(dt);
    this.updateShockRings(dt);
    this.updateTurrets(dt);
    this.updateGearDrops(dt);

    // inventory toggle
    if (this.input.pressed('Tab') && !this.runOver) this.toggleInventory();

    // remote teammates
    for (const [, r] of this.remotePlayers) r.update(dt, this.net.now);
    if (this.net.connected) {
      this.hud.renderTeam(this.remotePlayers);
      this.net.update(dt);
      // guests sync event/boss bars from events; host pushes periodic status
      if (this.net.isHost) {
        this.evSyncT -= dt;
        if (this.evSyncT <= 0) {
          this.evSyncT = 0.25;
          if (this.eventState === 'charging') this.net.sendEvent({ k: 'evp', f: this.eventProgress });
          if (this.activeBoss && !this.activeBoss.dead) this.net.sendEvent({ k: 'bosshp', f: this.activeBoss.hp / this.activeBoss.maxHp });
        }
      }
    }

    // elevator event
    if (isHost) this.updateElevatorEvent(dt);

    // ---- room tracking: discovery + arena lockdown trigger ----
    if (this.player && !this.player.dead && this.level.rooms?.length) {
      const room = this.level.roomAt(this.player.pos.x, this.player.pos.z);
      if (room && room !== this.currentRoom) {
        this.currentRoom = room;
        if (!room.discovered) {
          room.discovered = true;
          const names = { entry: 'RECEPTION', corridor: null, bullpen: 'THE OPEN OFFICE', arena: 'CONFERENCE CENTER', elevatorHall: 'ELEVATOR BANK', vault: '💰 THE VAULT', utility: 'FACILITIES', breakroom: 'BREAK ROOM' };
          if (names[room.type]) this.hud.announce(names[room.type], 1.6, true);
          if (room.type === 'vault') {
            this.audio.sfx('item-rare');
            this.grantReward(this.player, 40 * this.director.moneyMult(), 10, this.player.pos);
            this.addBudget(20);
          }
          if (isHost && room.type === 'arena' && !this.lockdownDone && this.eventState === 'idle') {
            this.startLockdown();
          }
        }
      }
    }
    if (isHost) this.updateLockdown(dt);

    // camera & music & fov
    this.player?.updateCamera(dt);
    this.camShakeAmt = Math.max(0, this.camShakeAmt - dt * 2.2);
    const sprinting = this.input.isDown('ShiftLeft') && this.player && !this.player.dead;
    const targetKick = (sprinting ? 5 : 0) + (this.player?.dashT > 0 ? 5 : 0);
    this.fovKick += (targetKick - this.fovKick) * Math.min(1, dt * 8);
    const wantFov = this.baseFov + this.fovKick;
    if (Math.abs(this.camera.fov - wantFov) > 0.1) {
      this.camera.fov = wantFov;
      this.camera.updateProjectionMatrix();
    }
    const tense = (this.activeBoss && !this.activeBoss.dead) || this.eventState === 'charging';
    this.audio.setMood(tense ? 'boss' : 'chill');

    this.hud.frame(this);
  }

  updatePuppet(e, dt) {
    // guests: dead-simple interpolation toward the last snapshot
    if (e.dead) {
      e.deathT += dt;
      return e.deathT < 0.05;
    }
    if (e.netTarget) {
      e.pos.lerp(e.netTarget, Math.min(1, dt * 10));
      e.mesh.position.copy(e.pos);
      const dy = e.netYaw - e.mesh.rotation.y;
      e.mesh.rotation.y += Math.atan2(Math.sin(dy), Math.cos(dy)) * Math.min(1, dt * 8);
    }
    e.animT += dt;
    e.updateVisual(dt);
    return true;
  }

  // ================= combat plumbing =================
  livePlayers() {
    const out = [];
    if (this.player && !this.player.dead) out.push(this.player);
    for (const [, r] of this.remotePlayers) if (!r.dead) out.push(r);
    return out;
  }
  allPlayerTargets() { return this.livePlayers(); }

  nearestEnemy(pos, maxD = 1e9) {
    let best = null, bd = maxD;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = dist2D(e.pos, pos);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  nearestPlayer(pos) {
    let best = null, bd = 1e9;
    for (const p of this.livePlayers()) {
      const d = dist2D(p.pos, pos);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  raycastAim(origin, dir, range) {
    // enemies: analytic sphere hits (few dozen at most — a linear scan wins here)
    let bestT = range, hitEnemy = null;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const oc = _v1.copy(e.center).sub(origin);
      const t = oc.dot(dir);
      if (t < 0 || t > bestT) continue;
      const d2 = oc.lengthSq() - t * t;
      const r = e.radius + 0.25;
      if (d2 < r * r) { bestT = t; hitEnemy = e; }
    }

    // world: exact BVH hit. The old version marched the ray in 0.7u steps, which
    // both cost (range / 0.7) x colliders and let shots tunnel through thin
    // cubicle walls when the sample points happened to straddle them.
    const wall = this.bvh.raycast(origin, dir, bestT);
    if (wall) { bestT = wall.distance; hitEnemy = null; }

    // floor plane — the BVH ground box only covers the building footprint
    if (dir.y < -1e-4) {
      const tFloor = -origin.y / dir.y;
      if (tFloor > 0 && tFloor < bestT) { bestT = tFloor; hitEnemy = null; }
    }
    return { point: origin.clone().addScaledVector(dir, bestT), enemy: hitEnemy, dist: bestT };
  }

  filterProjectile(opts) {
    // guests: friendly projectiles become cosmetic; the host spawns the real one
    if (this.net.connected && this.net.inRun && !this.net.isHost && opts.friendly && !opts.fromNet) {
      this.net.sendFire({
        p: {
          pos: [opts.pos.x, opts.pos.y, opts.pos.z],
          vel: [opts.vel.x, opts.vel.y, opts.vel.z],
          kind: opts.kind, damage: opts.damage, crit: opts.crit, pierce: opts.pierce ?? 0,
          homing: opts.homing ?? 0, aoe: opts.aoe ?? 0, gravity: opts.gravity ?? 0, spin: opts.spin ?? 0,
        },
      });
      opts.cosmetic = true;
    }
    return opts;
  }

  onRemoteFire(from, d) {
    const owner = this.remotePlayers.get(from) ?? null;
    if (d.p) {
      const p = d.p;
      this.projectiles.spawn({
        pos: new THREE.Vector3(...p.pos), vel: new THREE.Vector3(...p.vel),
        kind: p.kind, damage: p.damage, crit: p.crit, pierce: p.pierce, homing: p.homing,
        aoe: p.aoe, gravity: p.gravity, spin: p.spin, friendly: true, fromNet: true, owner,
      });
    }
    if (d.hit) {
      const e = this.enemyById.get(d.hit.id);
      if (e && !e.dead) this.damageEnemy(e, d.hit.v, { crit: d.hit.crit, owner, silent: true });
    }
    if (d.chest) {
      const ch = this.level?.chests.find((c) => c.id === d.chest.id);
      if (ch && !ch.opened) this.openChest(ch, owner ?? this.player, 0);
    }
    if (d.callElev) this.startElevatorEvent();
    if (d.board && this.eventState === 'open') {
      this.hud.announce('GOING UP ⬆', 1.6);
      this.nextFloor();
    }
  }

  projectileHitEnemy(p, e) {
    this.damageEnemy(e, p.damage, { crit: p.crit, owner: p.owner, projectile: true, kind: p.kind });
    if (p.knockback) e.applyKnockback(p.pos, p.knockback);
    // RICOCHET CLIPS: staples bounce to a nearby enemy
    if (p.kind === 'staple' && !p.fromRicochet && p.owner?.upgrades?.get('ricochet')) {
      let tgt = null, bd = 9;
      for (const o of this.enemies) {
        if (o.dead || o === e || p.hitSet.has(o.id)) continue;
        const d = dist2D(o.pos, e.pos);
        if (d < bd) { bd = d; tgt = o; }
      }
      if (tgt) {
        const dir = tgt.center.clone().sub(e.center).normalize();
        this.projectiles.spawn({
          pos: e.center.clone().addScaledVector(dir, e.radius + 0.2), vel: dir.multiplyScalar(48),
          kind: 'staple', damage: p.damage * 0.6, crit: p.crit, friendly: true, ttl: 1,
          owner: p.owner, fromRicochet: true,
        });
      }
    }
  }

  projectileHitPlayer(p, t) {
    if (t instanceof RemotePlayer) return; // their own client resolves damage (host relays via enemy AI only)
    t.damage(p.damage, p.pos, { from: p.owner?.key ?? p.kind ?? null });
  }

  damageEnemy(e, amount, opts = {}) {
    if (e.dead) return;
    const isHost = !this.net.connected || this.net.isHost;
    const owner = opts.owner ?? this.player;
    // guests: request the hit, render feedback optimistically
    if (!isHost) {
      this.net.sendFire({ hit: { id: e.id, v: amount, crit: !!opts.crit } });
      if (!opts.silent) {
        this.effects.number(e.center.clone(), amount, { crit: opts.crit });
        this.hud.hit(opts.crit);
      }
      return;
    }
    if (e.auditT > 0) amount *= 1.3;
    // COMPOUND INTEREST: accountant ramps damage on a focused target
    if (owner === this.player && owner.upgrades?.get('compound') && !opts.dot) {
      if (owner._cmpId === e.id) owner._cmpStacks = Math.min(10, (owner._cmpStacks ?? 0) + 1);
      else { owner._cmpId = e.id; owner._cmpStacks = 0; }
      amount *= 1 + 0.04 * owner._cmpStacks;
    }
    // crit damage bonus from upgrades (crit already doubled at source)
    if (opts.crit && owner === this.player && this.player.stats.critDamageBonus > 0) {
      amount *= 1 + this.player.stats.critDamageBonus * 0.5;
    }
    e.hp -= amount;
    e.lastHitBy = owner;
    if (!opts.silent) {
      this.effects.number(e.center.clone(), amount, { crit: opts.crit, color: opts.dot ? '#ff8a7a' : null });
      if (owner === this.player) this.hud.hit(opts.crit);
      else if (owner instanceof RemotePlayer) this.net.sendEvent({ k: 'dmg', v: Math.round(amount), crit: !!opts.crit, x: e.pos.x, y: e.center.y, z: e.pos.z }, owner.id);
      this.audio.sfx(opts.crit ? 'crit' : 'hit', { vol: 0.5 });
    }
    // procs (only for real players with stats)
    if (owner === this.player && !opts.dot) {
      const s = this.player.stats;
      if (s.bleedChance && chance(s.bleedChance)) {
        e.bleeds.push({ dps: (amount * s.bleedPower) / 3, t: 3, owner });
      }
      if (s.chainChance && chance(s.chainChance) && !opts.chained) {
        let jumps = 0;
        let src = e;
        const hitSet = new Set([e.id]);
        while (jumps < s.chainCount) {
          let tgt = null, bd = 8;
          for (const o of this.enemies) {
            if (o.dead || hitSet.has(o.id)) continue;
            const d = dist2D(o.pos, src.pos);
            if (d < bd) { bd = d; tgt = o; }
          }
          if (!tgt) break;
          hitSet.add(tgt.id);
          this.effects.beam(src.center.clone(), tgt.center.clone(), { color: 0xffe08a });
          this.damageEnemy(tgt, amount * 0.5, { owner, chained: true, silent: false });
          src = tgt;
          jumps++;
        }
        this.audio.sfx('zap');
      }
      if (opts.crit && s.critExplode) {
        this.explode(e.center.clone(), 4, amount * s.critExplodePower, { friendly: true, owner, noSelfHit: e.id });
      }
    }
    // karen: damage = provocation
    if (e.key === 'karen' && e.state === 'idle') {
      e.provoke(owner ?? this.player);
    }
    // FINAL NOTICE: slips execute weakened staff
    if (e.hp > 0 && opts.kind === 'slip' && owner === this.player && owner.upgrades?.get('finalnotice')
      && !e.def.boss && !e.def.rare && e.hp < e.maxHp * 0.15) {
      this.effects.number(e.center.clone().add(_v1.set(0, 0.5, 0)), e.hp, { crit: true, color: '#ff9ec4' });
      this.effects.burst(e.center.clone(), { color: 0xff9ec4, n: 10, speed: 5, ttl: 0.5 });
      e.hp = 0;
    }
    if (e.hp <= 0) e.die();
    else if (e.parts?.person && !opts.dot) {
      // flinch
      e.mesh.position.y += 0.02;
    }
  }

  onEnemyDied(e, noDrops) {
    const isHost = !this.net.connected || this.net.isHost;
    this.telemetry.kill(this.runTime, e.key, !!e.elite);
    this.director.onKillNear(e.pos);
    // a floor that has been fought over should look like it
    this.decals.spawn('blood', _v1.set(e.pos.x, 0.01, e.pos.z), _up, {
      size: e.def.big ? 1.4 : null,
    });
    this.effects.burst(e.center.clone(), { color: e.elite ? 0xffb36b : 0xd8dde6, n: e.def.big ? 26 : 12, speed: e.def.big ? 8 : 5, ttl: 0.7 });
    if (this.floorDef.key === 'marketing') this.effects.confetti(e.center.clone(), 8);

    // ---- world drops (briefcases: gear/throwables/consumables) ----
    if (isHost && !noDrops) this.rollWorldDrops(e);

    // ---- combo momentum ----
    if (!noDrops) {
      this.combo.count++;
      this.combo.t = TUNE.comboWindow;
      this.combo.best = Math.max(this.combo.best, this.combo.count);
      this.telemetry.combo(this.combo.count, this.runTime);
      const line = ANNOUNCER.comboLines[this.combo.count];
      if (line) {
        this.hud.announce(`×${this.combo.count} ${line}`, 1.6, true);
        this.audio.sfx('crit', { vol: 0.8 });
        this.player?.recomputeStats();
      }
      if (this.combo.count % 5 === 0) { this.hitstopT = Math.max(this.hitstopT, 0.045); this.player?.recomputeStats(); }
    }
    if (!isHost || noDrops) return;
    this.kpi.onKill(e);

    // shared Department Budget trickles in from every kill
    this.addBudget(e.def.boss ? 25 : e.def.special || e.elite ? 4 : 1);

    const dm = this.director.moneyMult() * (this.floorEvent?.kind === 'firedrill' ? 2 : 1) * (this.floorBuff?.moneyMult ?? 1);
    let money = e.def.money * dm * (e.elite ? 4 : 1);
    const xp = e.def.xp * (e.elite ? 3 : 1);
    const killer = e.lastHitBy ?? this.player;
    // CREATIVE WRITE-OFFS: audited enemies pay out more
    if (e.auditT > 0 && killer === this.player && killer.upgrades?.get('writeoff')) money *= 1.6;
    // COMMISSION: sales get paid per combo
    if (killer === this.player && killer.upgrades?.get('commission')) money += this.combo.count;
    // CC: EVERYONE — kills with slips release more slips
    if (killer === this.player && killer.upgrades?.get('fork') && killer.classKey === 'hr') {
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * Math.PI * 2;
        this.projectiles.spawn({
          pos: e.center.clone(), vel: new THREE.Vector3(Math.sin(a) * 20, 1.5, Math.cos(a) * 20),
          kind: 'slip', damage: killer.stats.damage * 0.5, friendly: true, ttl: 2.2,
          owner: killer, homing: 4.5, spin: 6, fromRicochet: true,
        });
      }
    }
    this.grantReward(killer, money, xp, e.center);

    if (e.key === 'auditor') {
      const item = rollItem(Math.random, 0.6);
      this.grantItem(killer, item);
      this.hud.announce('AUDIT PASSED — SEIZED ASSETS', 2.4, true);
    }
    if (e.key === 'karen') {
      this.grantReward(killer, 220 * dm, 40, e.center);
      this.hud.toast('Karen has been… de-escalated. Permanently.', 'item');
    }
    // synergy elites detonate
    if (e.elite === 'synergy') {
      this.delayed(0.05, () => this.explode(e.center.clone(), 3.6, 16, { friendly: false, color: 0x38e1ff }));
    }
    this.stats.kills++;
    if (this.player?.stats.espresso && killer === this.player) {
      const es = this.player.espresso;
      es.stacks = Math.min(5, es.stacks + 1);
      es.t = 4;
      this.player.recomputeStats();
    }
  }

  grantReward(killer, money, xp, pos) {
    // coin flight visual
    this.effects.burst(pos.clone(), { color: 0xffd23f, n: 5, speed: 4, size: 0.09, ttl: 0.5, gravity: 10 });
    if (killer === this.player || !(killer instanceof RemotePlayer)) {
      this.player.addMoney(money);
      this.player.addXp(xp);
      this.audio.sfx('coin', { vol: 0.4 });
      // co-op: split the wealth — teammates get 60%
      if (this.net.connected) this.net.sendEvent({ k: 'grant', money: money * 0.6, xp: xp * 0.6 });
    } else {
      this.net.sendEvent({ k: 'grant', money, xp }, killer.id);
      this.player.addMoney(money * 0.6);
      this.player.addXp(xp * 0.6);
    }
  }

  grantItem(killer, item) {
    if (killer === this.player || !(killer instanceof RemotePlayer)) {
      this.telemetry.itemPicked(item.id, item.rarity, this.runTime);
      this.player.addItem(item);
    } else {
      this.net.sendEvent({ k: 'item', id: item.id }, killer.id);
    }
  }

  damagePlayerless() { /* reserved */ }

  explode(pos, radius, dmg, { friendly = true, crit = false, owner = null, knockback = 8, noSelfHit = null, color = 0xffb36b } = {}) {
    this.effects.ring(pos, { color, r1: radius, dur: 0.35 });
    this.effects.burst(pos, { color, n: 18, speed: 7, ttl: 0.6, size: 0.14 });
    this.audio.sfx('explosion', { vol: Math.min(1, radius / 4) });
    this.shake(Math.min(0.7, radius / 8));
    this.level.kickDebris(pos, radius + 1.5, 8);
    this.physics.kick(pos, radius + 2.5, 9);   // blow the Lego gibs around too
    if (friendly) {
      for (const e of this.enemies) {
        if (e.dead || e.id === noSelfHit) continue;
        const d = dist2D(e.pos, pos);
        if (d < radius + e.radius) {
          this.damageEnemy(e, dmg * (1 - (d / (radius + e.radius)) * 0.5), { crit, owner, silent: false });
          e.applyKnockback(pos, knockback);
        }
      }
      for (const d of this.level.destructibles) {
        if (!d.dead && dist2D(d.pos, pos) < radius + d.radius) this.damageDestructible(d, dmg);
      }
    } else {
      for (const p of this.livePlayers()) {
        const d = dist2D(p.pos, pos);
        if (d < radius) {
          if (p === this.player) p.damage(dmg * (1 - (d / radius) * 0.5), pos);
          else this.net.sendEvent({ k: 'pdmg', v: dmg * (1 - (d / radius) * 0.5), x: pos.x, z: pos.z }, p.id);
          if (p.vel) p.vel.add(_v2.set(p.pos.x - pos.x, 0.4, p.pos.z - pos.z).normalize().multiplyScalar(knockback));
        }
      }
      for (const d of this.level.destructibles) {
        if (!d.dead && dist2D(d.pos, pos) < radius + d.radius) this.damageDestructible(d, dmg);
      }
    }
  }

  damageDestructible(d, dmg) {
    if (d.dead) return;
    d.hp -= dmg;
    this.effects.burst(d.pos.clone(), { color: 0xd8dde6, n: 3, speed: 2.5, size: 0.08, ttl: 0.3 });
    if (d.hp > 0) return;
    d.dead = true;
    if (d.collider) {
      d.collider.disabled = true;                 // rubble is walkable
      this.bvh.markDirty();                       // …and shootable through
      this.physics.setColliderEnabled(d.collider, false);
    }
    const shatterIt = () => {
      this.effects.shatter(d.group, { center: d.pos.clone(), power: 5, upPower: 4.5, maxPieces: 18 });
      d.group.visible = false;
      this.audio.sfx('melee-hit', { vol: 0.7 });
    };
    switch (d.kind) {
      case 'furniture': {
        shatterIt();
        this.kpi?.onAppliance();
        this.level.kickDebris(d.pos, 2.5, 5);
        // breaking things pays — sometimes
        if (chance(0.18)) this.level.dropSoda(d.pos);
        else if (chance(0.2)) {
          this.effects.burst(d.pos.clone(), { color: 0xffd23f, n: 6, speed: 4, ttl: 0.5 });
          this.player?.addMoney(rand(3, 8));
          this.audio.sfx('coin', { vol: 0.4 });
        }
        break;
      }
      case 'coffee':
        this.explode(d.pos.clone(), 3.6, 30, { friendly: true, color: 0x6b4423 });
        this.explode(d.pos.clone(), 3.2, 18, { friendly: false, color: 0x6b4423 });
        this.addHazard({ pos: d.pos.clone().setY(0), radius: 2.6, dps: 8, ttl: 4, kind: 'coffee', hurtsEnemies: true });
        shatterIt();
        this.kpi?.onAppliance();
        this.hud.toast('☕ THE ESPRESSO MACHINE HAS DETONATED', 'warn');
        break;
      case 'vending':
        this.audio.sfx('chest');
        this.effects.burst(d.pos.clone(), { color: 0x77c4ff, n: 14, speed: 5, ttl: 0.6 });
        for (let i = 0; i < 3; i++) this.level.dropSoda(d.pos);
        shatterIt();
        this.kpi?.onAppliance();
        break;
      case 'cooler': {
        this.audio.sfx('doors', { vol: 0.6 });
        this.effects.burst(d.pos.clone(), { color: 0x7fd4ff, n: 20, speed: 5, ttl: 0.8 });
        this.addSlowZone({ pos: d.pos.clone().setY(0), radius: 3.4, ttl: 5, factor: 0.6, color: 0x7fd4ff });
        shatterIt();
        this.kpi?.onAppliance();
        break;
      }
      case 'alarm':
        this.effects.burst(d.pos.clone(), { color: 0xff4d5a, n: 10, speed: 4, ttl: 0.5 });
        d.group.visible = false;
        this.director.triggerAlarmHorde(d.pos);
        break;
    }
  }

  onSodaPickup(_s) {
    this.audio.sfx('coin');
    this.player.heal(12);
    this.hud.toast('🥤 +12', '');
  }

  addHazard(h) {
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(h.radius, 20),
      new THREE.MeshBasicMaterial({ color: h.kind === 'coffee' ? 0x6b4423 : 0x86d86b, transparent: true, opacity: 0.5, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(h.pos.x, 0.05, h.pos.z);
    this.scene.add(mesh);
    this.hazards.push({ ...h, mesh, tick: 0 });
  }

  updateHazards(dt) {
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.ttl -= dt;
      if (h.ttl <= 0) { this.scene.remove(h.mesh); this.hazards.splice(i, 1); continue; }
      h.mesh.material.opacity = Math.min(0.5, h.ttl * 0.8);
      h.tick -= dt;
      if (h.tick <= 0) {
        h.tick = 0.5;
        const p = this.player;
        if (p && !p.dead && p.pos.y < 0.5 && dist2D(p.pos, h.pos) < h.radius) {
          p.damage(h.dps * 0.5, null);
          p.slowT = Math.max(p.slowT, 0.4);
        }
        if (h.hurtsEnemies) {
          for (const e of this.enemies) {
            if (!e.dead && e.pos.y < 0.5 && dist2D(e.pos, h.pos) < h.radius) {
              this.damageEnemy(e, h.dps * 0.5, { silent: true, dot: true });
            }
          }
        }
      }
    }
  }

  addSlowZone(z) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(z.radius * 0.2, z.radius, 24),
      new THREE.MeshBasicMaterial({ color: z.color ?? 0xff9ec4, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(z.pos.x, 0.04, z.pos.z);
    this.scene.add(mesh);
    this.slowZones.push({ ...z, mesh });
    if (!z.quiet) this.audio.sfx('slip', { vol: 0.5 });
  }

  spawnShockRing(pos, { speed, width, dmg, color, maxR }) {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(1, 0.18, 8, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(pos.x, 0.35, pos.z);
    this.scene.add(mesh);
    this.shockRings.push({ pos, r: 0.5, speed, width, dmg, color, maxR, mesh, hit: new Set() });
    this.audio.sfx('roar', { vol: 0.3 });
  }

  updateShockRings(dt) {
    for (let i = this.shockRings.length - 1; i >= 0; i--) {
      const r = this.shockRings[i];
      r.r += r.speed * dt;
      r.mesh.scale.setScalar(r.r);
      r.mesh.material.opacity = clamp(1.2 - r.r / r.maxR, 0, 1);
      if (r.r > r.maxR) { this.scene.remove(r.mesh); this.shockRings.splice(i, 1); continue; }
      for (const p of this.livePlayers()) {
        if (r.hit.has(p.id)) continue;
        const d = dist2D(p.pos, r.pos);
        if (Math.abs(d - r.r) < r.width && p.pos.y < 1.1) {
          r.hit.add(p.id);
          if (p === this.player) p.damage(r.dmg, r.pos);
          else this.net.sendEvent({ k: 'pdmg', v: r.dmg, x: r.pos.x, z: r.pos.z }, p.id);
        }
      }
    }
  }

  spawnTurret(pos, owner) {
    const mesh = new THREE.Group();
    const base = cyl(0.3, 0.38, 0.5, 0x33383f, 8);
    base.position.y = 0.25;
    const dish = box(0.34, 0.2, 0.34, 0xd9dde3);
    dish.position.y = 0.62;
    const antenna = cyl(0.02, 0.02, 0.5, 0x9aa3b0, 4);
    antenna.position.y = 0.95;
    const lamp = box(0.08, 0.08, 0.08, 0x38e1ff, { emissive: 0x1899b4, emissiveIntensity: 2 });
    lamp.position.y = 1.2;
    mesh.add(base, dish, antenna, lamp);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.turrets.push({ pos: pos.clone(), mesh, ttl: 25, cd: 0, owner, dish });
    this.effects.ring(pos, { color: 0x38e1ff, r1: 2, dur: 0.4 });
  }

  updateTurrets(dt) {
    for (let i = this.turrets.length - 1; i >= 0; i--) {
      const t = this.turrets[i];
      t.ttl -= dt;
      if (t.ttl <= 0) {
        // THERMAL RUNAWAY: routers go out with a bang
        if (t.owner?.upgrades?.get('hotrouter')) {
          this.explode(t.pos.clone().setY(0.6), 4.2, (t.owner.stats?.damage ?? 10) * 4, { friendly: true, owner: t.owner, color: 0x38e1ff });
        } else {
          this.effects.burst(t.pos.clone().setY(0.5), { color: 0x38e1ff, n: 8, speed: 3, ttl: 0.4 });
        }
        this.scene.remove(t.mesh);
        this.turrets.splice(i, 1);
        continue;
      }
      t.cd -= dt;
      t.mesh.rotation.y += dt * 1.4;
      if (t.cd <= 0) {
        const e = this.nearestEnemy(t.pos, 12);
        if (e) {
          t.cd = 0.5;
          const from = t.pos.clone().setY(0.9);
          this.effects.beam(from, e.center.clone(), { color: 0x38e1ff, jitter: 0.3 });
          this.damageEnemy(e, 8 + this.director.coeff * 2, { owner: t.owner ?? this.player });
          this.audio.sfx('turret', { vol: 0.5 });
        }
      }
    }
  }

  delayed(t, fn) { this.delayedQ.push({ t, fn }); }
  shake(amt) { this.camShakeAmt = Math.min(1, this.camShakeAmt + amt); }

  // ================= spawning =================
  spawnEnemy(key, pos, { elite = null, fromBoss = false } = {}) {
    const isBoss = !!BOSS_DEFS[key];
    const aliveCount = this.enemies.filter((e) => !e.dead).length;
    if (!isBoss && !fromBoss && aliveCount >= TUNE.hordeCap) return null;
    const opts = { elite, hpMult: this.director.hpMult(), dmgMult: this.director.dmgMult() };
    const e = isBoss ? new Boss(this, key, pos, opts) : new Enemy(this, key, pos, opts);
    this.enemies.push(e);
    this.enemyById.set(e.id, e);
    this.enemyLOD.register(e);   // starts hot, then settles into its tier
    if (!isBoss) {
      this.effects.ring(pos, { color: 0xffffff, r0: 0.2, r1: 1.4, dur: 0.35, opacity: 0.4 });
    }
    return e;
  }

  spawnFloorBoss() {
    const key = this.floorDef.bossKey;
    const def = BOSS_DEFS[key];
    let pos;
    if (this.floorDef.isFinal) {
      pos = new THREE.Vector3(0, 0, -6);
    } else {
      pos = this.level.elevator.innerPos.clone();
    }
    const boss = this.spawnEnemy(key, pos, {});
    this.activeBoss = boss;
    this.hud.showBoss(def.name, def.title);
    this.hud.announce(`${def.name} — ${def.title}`, 3.4);
    this.audio.sfx('roar');
    this.shake(0.6);
    if (this.net.connected && this.net.isHost) this.net.sendEvent({ k: 'boss', key });
    // walk out of the elevator
    if (!this.floorDef.isFinal) {
      this.level.setDoors(this.level.elevator, true);
      this.delayed(2.2, () => this.level.setDoors(this.level.elevator, false));
    }
    return boss;
  }

  onBossDefeated(boss) {
    this.stats.bossKills++;
    this.hud.hideBoss();
    this.activeBoss = null;
    this.effects.confetti(boss.center.clone(), 40);
    this.shake(0.8);
    const isHost = !this.net.connected || this.net.isHost;
    if (isHost) {
      const killer = boss.lastHitBy ?? this.player;
      this.grantReward(killer, BOSS_DEFS[boss.key].money, BOSS_DEFS[boss.key].xp, boss.center);
      const item = rollItem(Math.random, 0.35);
      this.grantItem(killer, item);
      if (this.net.connected) this.net.sendEvent({ k: 'bossdead' });
    }
    if (boss.key === 'ceo') {
      this.hud.announce('THE C.E.O. HAS BEEN TERMINATED', 4);
      // victory lap: nothing can kill you between the killshot and the credits
      this.victoryLap = true;
      this.timeScale = 0.35;   // savour the moment
      if (this.player) this.player.iframes = 999;
      if (this.net.connected && this.net.isHost) this.net.sendEvent({ k: 'win' });
      this.delayed(0.8, () => this.endRun(true));
    } else {
      this.hud.announce('DEPARTMENT HEAD — TERMINATED', 3);
      this.eventState = 'open';
      this.level.setDoors(this.level.elevator, true);
      this.audio.sfx('ding');
      this.hud.toast('ELEVATOR READY — board to ascend', 'item');
    }
  }

  // ================= department budget =================
  addBudget(n) {
    this.budget += n;
    this.hud.setBudget(this.budget);
  }

  // ================= wave-arena lockdown =================
  startLockdown() {
    this.lockdown = { wave: 0, waves: 3, t: 1.6, betweenT: 0 };
    this.lockdownDone = true;
    this.level.setArenaSealed(true);
    this.hud.announce('🚨 SECURITY LOCKDOWN — CLEAR ALL WAVES', 2.8);
    this.audio.sfx('alarm');
    this.audio.setMood('boss');
    this.director.setEventMode(false);
    this.director.setPacing('RELAX', 999); // lockdown owns the spawns
    if (this.net.connected && this.net.isHost) this.net.sendEvent({ k: 'lockdown', on: 1 });
  }

  updateLockdown(dt) {
    const L = this.lockdown;
    if (!L) return;
    L.t -= dt;
    // only enemies INSIDE the sealed arena block the clear — outside stragglers can't stall it
    const aliveHorde = this.enemies.filter((e) =>
      !e.dead && !e.def.boss && this.level.roomAt(e.pos.x, e.pos.z) === this.level.arenaRoom).length;
    if (L.t <= 0 && L.wave < L.waves) {
      L.wave++;
      const size = Math.round((5 + this.director.coeff * 3) * (1 + L.wave * 0.35));
      this.hud.announce(`WAVE ${L.wave} / ${L.waves}`, 1.6, true);
      this.audio.sfx('horde', { vol: 0.7 });
      this.director.queueHorde(size);
      // specials join later waves
      if (L.wave >= 2) {
        const sp = this.level.findSpawnPoint(this.player.pos, 7, 22, null, this.level.arenaRoom);
        this.spawnEnemy(choose(['gossip', 'complainer', 'micromanager', 'motivator']), sp, {});
      }
      if (L.wave === L.waves && this.director.coeff > 2.2) {
        const sp = this.level.findSpawnPoint(this.player.pos, 8, 24, null, this.level.arenaRoom);
        this.spawnEnemy('copier', sp, { elite: chance(0.5) ? 'overtime' : 'synergy' });
      }
      L.t = 20; // fallback timer if the wave stalls
    } else if (L.wave >= L.waves && aliveHorde === 0 && this.director.hordeQueue.length === 0) {
      // CLEARED
      this.lockdown = null;
      this.level.setArenaSealed(false);
      this.hud.announce('✅ LOCKDOWN CLEARED — BONUS APPROVED', 2.6);
      this.audio.sfx('victory', { vol: 0.6 });
      this.audio.setMood('chill');
      this.addBudget(40);
      this.grantReward(this.player, 60 * this.director.moneyMult(), 25, this.player.pos);
      const room = this.level.arenaRoom;
      if (room) this.level.spawnChestIn(room, chance(0.4));
      this.director.setPacing('RELAX', 14); // protected rest valley
      this.director.intensity = 20;
      if (this.net.connected && this.net.isHost) this.net.sendEvent({ k: 'lockdown', on: 0 });
    } else if (L.wave >= L.waves && aliveHorde > 0) {
      // panic rule: last stragglers speed up so waves end with a crescendo, not a mop
      if (aliveHorde <= 4) {
        for (const e of this.enemies) if (!e.dead && !e.def.boss) e.rallyT = Math.max(e.rallyT ?? 0, 0.4);
      }
    }
  }

  // ================= elevator crescendo =================
  startElevatorEvent() {
    if (this.eventState !== 'idle') return;
    this.eventState = 'charging';
    this.eventProgress = 0;
    this.director.setEventMode(true);
    this.hud.showEvent('CALLING THE ELEVATOR — HOLD THE ZONE');
    this.audio.sfx('alarm');
    this.hud.announce('☎ THE ELEVATOR IS COMING — SO IS EVERYONE ELSE', 3);
    // zone marker
    const zone = new THREE.Mesh(new THREE.RingGeometry(TUNE.eventZoneRadius - 0.35, TUNE.eventZoneRadius, 48),
      new THREE.MeshBasicMaterial({ color: 0x38e1ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
    zone.rotation.x = -Math.PI / 2;
    zone.position.set(this.level.elevator.pos.x, 0.06, this.level.elevator.pos.z);
    this.scene.add(zone);
    this.eventZoneMesh = zone;
    if (this.net.connected && this.net.isHost) this.net.sendEvent({ k: 'evstart' });
  }

  updateElevatorEvent(dt) {
    if (this.eventState !== 'charging') return;
    const zonePos = this.level.elevator.pos;
    let inZone = false;
    for (const p of this.livePlayers()) {
      if (dist2D(p.pos, zonePos) < TUNE.eventZoneRadius) { inZone = true; break; }
    }
    if (inZone) {
      this.eventProgress += dt / TUNE.eventDuration;
      this.eventZoneMesh.material.color.setHex(0x38e1ff);
    } else {
      this.eventZoneMesh.material.color.setHex(0xff4d5a);
    }
    this.eventZoneMesh.material.opacity = 0.35 + Math.sin(this.runTime * 4) * 0.15;
    this.hud.updateEvent(this.eventProgress, inZone ? 'CALLING THE ELEVATOR — HOLD THE ZONE' : '⚠ RETURN TO THE ZONE — SIGNAL LOST');
    if (this.eventProgress >= 1) {
      this.eventState = 'boss';
      this.hud.hideEvent();
      this.director.setEventMode(false);
      this.audio.sfx('ding');
      this.hud.announce('🛎 MANAGEMENT HAS ARRIVED', 2.6);
      if (this.net.connected && this.net.isHost) this.net.sendEvent({ k: 'evboss' });
      this.delayed(1.2, () => this.spawnFloorBoss());
    }
  }

  // ================= interaction =================
  chestCost(gold) {
    const c = Math.round(TUNE.chestBase * (1 + (this.director.coeff - 1) * TUNE.chestScale));
    return gold ? Math.round(c * 2.6) : c;
  }

  checkInteract(player, pressed) {
    let best = null, bd = 3.4, prompt = null;
    // chests
    for (const ch of this.level.chests) {
      if (ch.opened) continue;
      const d = dist2D(player.pos, ch.pos);
      if (d < bd) {
        const cost = this.chestCost(ch.gold);
        best = { type: 'chest', ch, cost };
        prompt = `<b>E</b> — ${ch.gold ? 'EXEC STASH' : 'SUPPLY CRATE'} · <b>$${cost}</b>${player.money < cost ? ' (broke)' : ''}`;
        bd = d;
      }
    }
    // paid security doors (Department Budget)
    for (const dr of this.level.paidDoors ?? []) {
      if (dr.open) continue;
      const d = dist2D(player.pos, dr.pos);
      if (d < bd && d < dr.radius) {
        best = { type: 'paidDoor', dr };
        prompt = `<b>E</b> — AUTHORIZE ACCESS: ${dr.label} · <b>⬛ ${dr.cost} BUDGET</b>${this.budget < dr.cost ? ' (insufficient)' : ''}`;
        bd = d;
      }
    }
    // floor breaker switch
    const sw = this.level.utilitySwitch;
    if (sw && !sw.used) {
      const d = dist2D(player.pos, sw.pos);
      if (d < bd && d < sw.radius) {
        best = { type: 'floorSwitch', sw };
        prompt = `<b>E</b> — THROW THE FLOOR BREAKER · <b>⬛ 25 BUDGET</b> <small>(+40% money this floor… but the office will notice)</small>${this.budget < 25 ? ' (insufficient)' : ''}`;
        bd = d;
      }
    }
    // office utilities
    for (const u of this.level.utilities) {
      if (u.uses <= 0) continue;
      const d = dist2D(player.pos, u.pos);
      if (d < bd && d < u.radius) {
        const info = this.utilityInfo(u, player);
        if (info) {
          best = { type: 'utility', u };
          prompt = info.prompt;
          bd = d;
        }
      }
    }
    // elevator
    const el = this.level.elevator;
    if (el && !this.floorDef.isFinal) {
      const d = dist2D(player.pos, el.pos);
      if (d < 3.2) {
        if (this.eventState === 'idle' && !this.activeBoss) {
          best = { type: 'callElevator' };
          prompt = '<b>E</b> — CALL THE ELEVATOR <small>(this will upset the entire floor)</small>';
        } else if (this.eventState === 'open') {
          best = { type: 'board' };
          prompt = '<b>E</b> — BOARD THE ELEVATOR ▲';
        }
      }
    }
    this.hud.setPrompt(prompt);
    if (!pressed || !best) return;

    const isHost = !this.net.connected || this.net.isHost;
    if (best.type === 'chest') {
      const { ch, cost } = best;
      if (player.money < cost) { this.audio.sfx('ui'); this.hud.toast('INSUFFICIENT BUDGET', 'warn'); return; }
      if (!isHost) { this.net.sendFire({ chest: { id: ch.id } }); player.money -= cost; return; }
      this.openChest(ch, player, cost);
    } else if (best.type === 'paidDoor') {
      const dr = best.dr;
      if (this.budget < dr.cost) { this.audio.sfx('ui'); this.hud.toast('INSUFFICIENT DEPARTMENT BUDGET', 'warn'); return; }
      this.addBudget(-dr.cost);
      this.level.openPaidDoor(dr);
      this.audio.sfx('doors');
      this.audio.sfx('buy');
      this.hud.toast(`🔓 ${dr.label} — ACCESS GRANTED`, 'item');
      this.effects.ring(dr.pos, { color: 0x58e07c, r1: 3, dur: 0.5 });
      if (this.net.connected && this.net.isHost) this.net.sendEvent({ k: 'door', id: dr.id });
    } else if (best.type === 'floorSwitch') {
      const sw = best.sw;
      if (this.budget < 25) { this.audio.sfx('ui'); this.hud.toast('INSUFFICIENT DEPARTMENT BUDGET', 'warn'); return; }
      this.addBudget(-25);
      sw.used = true;
      sw.lever.rotation.x = -0.5;
      sw.lever.material = sw.lever.material.clone();
      sw.lever.material.color.setHex(0x58e07c);
      sw.lever.material.emissive.setHex(0x1d7a34);
      this.floorBuff = { moneyMult: 1.4, dirMult: 1.18 };
      this.hud.announce('⚡ FLOOR SYSTEMS ONLINE — +40% MONEY · THE OFFICE KNOWS', 3);
      this.audio.sfx('alarm', { vol: 0.5 });
      this.audio.sfx('buy');
      this.director.intensity = Math.min(100, this.director.intensity + 20);
    } else if (best.type === 'utility') {
      this.useUtility(best.u, player);
    } else if (best.type === 'callElevator') {
      if (!isHost) { this.net.sendFire({ callElev: 1 }); return; }
      this.startElevatorEvent();
    } else if (best.type === 'board') {
      if (!isHost) { this.net.sendFire({ board: 1 }); return; }
      this.hud.announce('GOING UP ⬆', 1.6);
      this.audio.sfx('doors');
      this.nextFloor();
    }
  }

  // ================= office utilities =================
  utilityInfo(u, player) {
    const coeff = this.director.coeff;
    switch (u.type) {
      case 'printer3d': {
        const cost = Math.round(this.chestCost(false) * 1.4 * u.priceMult);
        return { cost, prompt: `<b>E</b> — 3D PRINT: duplicate a random item · <b>$${cost}</b> (${u.uses} left)${player.money < cost ? ' (broke)' : ''}` };
      }
      case 'coffeestation': {
        const cost = Math.round(18 * (1 + (coeff - 1) * 0.4));
        return { cost, prompt: `<b>E</b> — FRESH POT: +25% atk & +12% move for 45s · <b>$${cost}</b>${player.money < cost ? ' (broke)' : ''}` };
      }
      case 'shredder': {
        const commons = [...player.items.entries()].filter(([id]) => ITEM_BY_ID[id]?.rarity === 'common' && player.items.get(id) > 0);
        if (!commons.length) return { prompt: `<b>E</b> — SHREDDER: feeds on COMMON items (you have none)` };
        const pay = Math.round(this.chestCost(false) * 0.8);
        return { pay, prompt: `<b>E</b> — SHRED a random common item → <b>$${pay}</b>` };
      }
      case 'hydration': {
        if (player.hydratedThisFloor) return { prompt: `<b>E</b> — HYDRATION STATION <small>(already hydrated this floor)</small>` };
        return { prompt: `<b>E</b> — HYDRATE: restore 35% HP · <b>FREE</b> (once per floor)` };
      }
    }
    return null;
  }

  useUtility(u, player) {
    const info = this.utilityInfo(u, player);
    if (!info) return;
    switch (u.type) {
      case 'printer3d': {
        if (player.money < info.cost) { this.hud.toast('INSUFFICIENT BUDGET', 'warn'); return; }
        const owned = [...player.items.keys()];
        const pick = owned.length ? ITEM_BY_ID[owned[(Math.random() * owned.length) | 0]] : ITEMS.find((i) => i.id === 'coffee');
        player.money -= info.cost;
        u.uses--;
        u.priceMult *= 1.6;
        this.audio.sfx('chest');
        this.effects.burst(u.pos.clone().setY(1), { color: 0x58e07c, n: 12, speed: 4, ttl: 0.6 });
        this.delayed(0.4, () => player.addItem(pick));
        break;
      }
      case 'coffeestation': {
        if (player.money < info.cost) { this.hud.toast('INSUFFICIENT BUDGET', 'warn'); return; }
        player.money -= info.cost;
        player.coffeeBuffT = 45;
        player.recomputeStats();
        this.audio.sfx('buy');
        this.hud.toast('☕ FRESH POT — you are WIRED', 'item');
        this.effects.ring(u.pos, { color: 0xffd23f, r1: 2.5, dur: 0.4 });
        break;
      }
      case 'shredder': {
        const commons = [...player.items.entries()].filter(([id]) => ITEM_BY_ID[id]?.rarity === 'common' && player.items.get(id) > 0);
        if (!commons.length) { this.audio.sfx('ui'); return; }
        const [id] = commons[(Math.random() * commons.length) | 0];
        const item = ITEM_BY_ID[id];
        const left = player.items.get(id) - 1;
        if (left <= 0) player.items.delete(id); else player.items.set(id, left);
        player.recomputeStats();
        player.addMoney(info.pay / player.stats.moneyMult); // flat payout, unaffected by money mults
        this.hud.renderItems(player.items, player.upgrades);
        this.hud.toast(`🗞️ SHREDDED ${item.icon} ${item.name} → $${info.pay}`, 'warn');
        this.audio.sfx('card');
        this.audio.sfx('coin');
        this.effects.burst(u.pos.clone().setY(1), { color: 0xffffff, n: 16, speed: 5, ttl: 0.7 });
        break;
      }
      case 'hydration': {
        if (player.hydratedThisFloor) { this.audio.sfx('ui'); return; }
        player.hydratedThisFloor = true;
        player.heal(player.stats.maxHp * 0.35);
        this.audio.sfx('item');
        this.effects.ring(u.pos, { color: 0x38e1ff, r1: 2.5, dur: 0.5 });
        this.hud.toast('💧 HYDRATED', 'item');
        break;
      }
    }
  }

  // ================= floor events =================
  startFloorEvent(kind) {
    if (this.floorEvent) return;
    if (kind === 'lightsout') {
      this.floorEvent = { kind, t: 18 };
      const L = this.level.lights;
      L.hemi.userData.base = L.hemi.intensity;
      L.sun.userData.base = L.sun.intensity;
      L.hemi.intensity = 0.18;
      L.sun.intensity = 0.25;
      this.scene.fog.near = 8;
      this.scene.fog.far = 40;
      this.hud.announce('💡 LIGHTS OUT — POWER SAVING MODE', 3);
      this.audio.sfx('gossip-pop', { vol: 0.6 });
    } else if (kind === 'firedrill') {
      this.floorEvent = { kind, t: 20 };
      this.hud.announce('🚨 FIRE DRILL — EVERYONE IS VERY MOTIVATED (2× MONEY)', 3);
      this.audio.sfx('alarm');
      this.audio.sfx('horde', { vol: 0.6 });
    }
    if (this.net.connected && this.net.isHost) this.net.sendEvent({ k: 'floorev', kind });
  }

  endFloorEvent() {
    if (!this.floorEvent) return;
    if (this.floorEvent.kind === 'lightsout') {
      const L = this.level.lights;
      L.hemi.intensity = L.hemi.userData.base ?? 1.0;
      L.sun.intensity = L.sun.userData.base ?? 1.7;
      this.scene.fog.near = 30;
      this.scene.fog.far = 95;
      this.hud.toast('💡 power restored', '');
    } else {
      this.hud.toast('🚨 drill complete — back to work', '');
    }
    this.floorEvent = null;
  }

  // ================= pockets: throwables, consumables, gear drops =================
  throwGrenade(player, aim) {
    const def = THROWABLES[player.throwable.id];
    if (!def) return;
    player.throwable.count--;
    if (player.throwable.count <= 0) player.throwable = null;
    const kind = def.id === 'grenade' ? 'grenade' : def.id === 'tapeball' ? 'tape' : 'carafe';
    const opts = {
      pos: aim.origin.clone(), vel: aim.dir.clone().multiplyScalar(19).setY(aim.dir.y * 19 + 5.5),
      gravity: 20, kind, friendly: true, owner: player, damage: 0, ttl: def.fuse > 0 ? def.fuse : 1.2, spin: 7, radius: 0.22,
    };
    if (def.id === 'grenade') {
      opts.damage = def.dmgBase + this.director.coeff * def.dmgPerCoeff;
      opts.aoe = def.radius;
      opts.knockback = def.knockback;
    } else if (def.id === 'tapeball') {
      opts.slowSplat = { radius: def.radius, factor: def.slowFactor, ttl: def.slowTtl, color: 0xd9d2b8 };
    } else if (def.id === 'molotov') {
      opts.puddle = { radius: def.radius, dps: def.dps, ttl: def.ttl, kind: 'coffee', hurtsEnemies: true };
      opts.aoe = 1.8;
      opts.damage = 12;
    }
    this.projectiles.spawn(opts);
    this.audio.sfx('swing', { vol: 0.7 });
    this.hud.refreshPockets(player);
  }

  useConsumable(player, idx) {
    const c = player.consumables[idx];
    if (!c) return;
    const def = CONSUMABLES[c.id];
    player.consumables.splice(idx, 1);
    if (def.heal) player.heal(def.heal);
    if (def.hot) { player.hotT = def.hotTime; player.hotRate = def.hot / def.hotTime; }
    if (def.wiredTime) { player.coffeeBuffT = Math.max(player.coffeeBuffT, def.wiredTime); player.recomputeStats(); }
    this.audio.sfx('item');
    this.hud.toast(`${def.icon} ${def.name}`, 'item');
    this.hud.refreshPockets(player);
  }

  spawnGearDrop(pos, payload) {
    // payload: {type:'wearable', gear} | {type:'throwable', id} | {type:'consumable', id}
    const g = new THREE.Group();
    const color = payload.type === 'wearable' ? payload.gear.color : payload.type === 'throwable' ? 0xc0392b : 0x58e07c;
    const briefcase = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: 0.7, flatShading: true }));
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x3a2417, flatShading: true }));
    handle.position.y = 0.24;
    const glow = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.52, 18),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -0.4;
    g.add(briefcase, handle, glow);
    briefcase.castShadow = true;
    g.position.set(pos.x, 0.55, pos.z);
    this.scene.add(g);
    this.gearDrops.push({ group: g, payload, phase: Math.random() * 6 });
  }

  updateGearDrops(dt) {
    const p = this.player;
    for (let i = this.gearDrops.length - 1; i >= 0; i--) {
      const d = this.gearDrops[i];
      d.group.rotation.y += dt * 2;
      d.group.position.y = 0.55 + Math.sin(this.runTime * 3 + d.phase) * 0.1;
      if (!p || p.dead) continue;
      const dd = dist2D(d.group.position, p.pos);
      if (dd < 3.5) {
        const dir = _v1.set(p.pos.x - d.group.position.x, 0, p.pos.z - d.group.position.z).normalize();
        d.group.position.addScaledVector(dir, dt * 8);
      }
      if (dd < 0.9) {
        const pl = d.payload;
        if (pl.type === 'wearable') {
          p.pickupGear(pl.gear);
        } else if (pl.type === 'throwable') {
          const def = THROWABLES[pl.id];
          if (p.throwable?.id === pl.id) p.throwable.count = Math.min(def.max, p.throwable.count + 1);
          else p.throwable = { id: pl.id, count: 1 };
          this.hud.toast(`${def.icon} ${def.name} (${p.throwable.count}) — press G`, 'item');
          this.audio.sfx('item');
        } else {
          const def = CONSUMABLES[pl.id];
          if (p.consumables.length < 2) {
            p.consumables.push({ id: pl.id });
            this.hud.toast(`${def.icon} ${def.name} — press F`, 'item');
            this.audio.sfx('item');
          } else {
            p.addMoney(10);
            this.hud.toast(`${def.icon} pockets full — pawned for $10`, '');
          }
        }
        this.hud.refreshPockets(p);
        this.scene.remove(d.group);
        this.gearDrops.splice(i, 1);
      }
    }
  }

  rollWorldDrops(e) {
    // called on enemy death (host/solo): specials & elites drop the good stuff
    const pos = e.pos;
    if (e.def.special || e.elite) {
      if (chance(0.4)) this.spawnGearDrop(pos, { type: 'wearable', gear: rollWearable(Math.random, e.elite ? 0.3 : 0.15) });
      else if (chance(0.5)) this.spawnGearDrop(pos, { type: 'throwable', id: choose(Object.keys(THROWABLES)) });
    } else if (e.def.boss) {
      this.spawnGearDrop(pos, { type: 'wearable', gear: rollWearable(Math.random, 0.6) });
      this.spawnGearDrop(pos, { type: 'throwable', id: choose(Object.keys(THROWABLES)) });
    } else {
      if (chance(0.025)) this.spawnGearDrop(pos, { type: 'throwable', id: choose(Object.keys(THROWABLES)) });
      else if (chance(0.03)) this.spawnGearDrop(pos, { type: 'consumable', id: choose(Object.keys(CONSUMABLES)) });
    }
  }

  // ================= inventory (Tab) =================
  toggleInventory(open) {
    if (this.state !== 'run' || this.draftOpen) return;
    this.inventoryOpen = open ?? !this.inventoryOpen;
    if (this.inventoryOpen) {
      this.hud.showInventory(this.player);
      this.input.unlock();
    } else {
      this.hud.hideInventory();
      if (!this.paused && !this.runOver) this.input.lock();
    }
  }

  // ================= PERFORMANCE REVIEW (upgrade drafts) =================
  queueDraft() {
    this.draftQueue++;
    if (!this.draftOpen) this.openDraft();
  }

  openDraft() {
    if (this.draftQueue <= 0 || !this.player || this.runOver) return;
    this.draftPicks = rollDraft(this.player);
    if (!this.draftPicks.length) { this.draftQueue = 0; return; }
    this.draftOpen = true;
    this.hud.showDraft(this.draftPicks, this.player.level);
    this.audio.sfx('levelup');
    this.input.unlock();
  }

  pickDraft(i) {
    if (!this.draftOpen || !this.draftPicks?.[i]) return;
    // offered-vs-taken is what proves no module sits above a 50% pick rate
    this.telemetry.draft({
      offered: this.draftPicks.map((d) => d.id),
      taken: this.draftPicks[i].id,
      level: this.player.level,
    });
    this.player.applyUpgrade(this.draftPicks[i]);
    this.draftQueue--;
    this.draftOpen = false;
    this.draftPicks = null;
    this.hud.hideDraft();
    if (this.draftQueue > 0) {
      this.openDraft();
    } else if (this.state === 'run' && !this.paused) {
      this.input.lock();
    }
  }

  openChest(ch, player, cost) {
    if (ch.opened) return;
    ch.opened = true;
    if (player === this.player) player.money -= cost;
    this.audio.sfx('chest');
    this.audio.sfx('buy');
    const item = rollItem(Math.random, ch.gold ? 0.5 : 0);
    this.effects.burst(ch.pos.clone().setY(0.7), { color: ch.gold ? 0xffd23f : 0x9fd8ff, n: 12, speed: 4, ttl: 0.6 });
    this.delayed(0.35, () => this.grantItem(player, item));
    if (this.net.connected && this.net.isHost) this.net.sendEvent({ k: 'chestopen', id: ch.id });
  }

  // ================= net receive =================
  onRemoteState(id, s, now) {
    let r = this.remotePlayers.get(id);
    if (!r && this.state === 'run') {
      r = new RemotePlayer(this, id, s);
      this.remotePlayers.set(id, r);
    }
    if (r) {
      if (r.classKey !== s.cls) { r.dispose(); this.remotePlayers.delete(id); return; } // rebuilt next state
      r.pushState(s, now);
    }
  }

  removeRemotePlayer(id) {
    const r = this.remotePlayers.get(id);
    if (r) { r.dispose(); this.remotePlayers.delete(id); }
  }

  onNetEvent(e, from) {
    switch (e.k) {
      case 'floor': this.fadeOut(() => this.buildFloor(e.idx, e.seed)); this.loopCount = e.loop; break;
      case 'grant': this.player?.addMoney(e.money); this.player?.addXp(e.xp); break;
      case 'item': { const item = ITEM_BY_ID[e.id]; if (item) this.player?.addItem(item); break; }
      case 'dmg': this.effects.number(_v1.set(e.x, e.y, e.z).clone(), e.v, { crit: e.crit }); this.hud.hit(e.crit); break;
      case 'pdmg': this.player?.damage(e.v, _v1.set(e.x, 0, e.z)); break;
      case 'latch': this.hud.setLatch(!!e.on); break;
      case 'boss': { const d = BOSS_DEFS[e.key]; if (d) { this.hud.showBoss(d.name, d.title); this.audio.sfx('roar'); } break; }
      case 'bosshp': this.hud.updateBoss(e.f); break;
      case 'bossdead': this.hud.hideBoss(); this.eventState = 'open'; this.level?.setDoors(this.level.elevator, true); break;
      case 'evstart': this.eventState = 'charging'; this.hud.showEvent('CALLING THE ELEVATOR — HOLD THE ZONE'); break;
      case 'evp': this.hud.updateEvent(e.f); break;
      case 'evboss': this.eventState = 'boss'; this.hud.hideEvent(); break;
      case 'chestopen': { const ch = this.level?.chests.find((c) => c.id === e.id); if (ch) ch.opened = true; break; }
      case 'floorev': this.startFloorEvent(e.kind); break;
      case 'lockdown': this.level?.setArenaSealed(!!e.on); if (e.on) { this.hud.announce('🚨 SECURITY LOCKDOWN', 2.4); this.audio.sfx('alarm'); } break;
      case 'door': { const dr = this.level?.paidDoors.find((d) => d.id === e.id); if (dr && !dr.open) this.level.openPaidDoor(dr); break; }
      case 'win': this.delayed(1.5, () => this.endRun(true)); break;
    }
    // host-side guest intents arrive via 'fire' payloads
    if (this.net.isHost && from) {
      if (e.k === 'hitreq') { /* handled in onRemoteFire */ }
    }
  }

  applyEnemySnapshot(list, KEYS, ELITES) {
    const seen = new Set();
    for (const rec of list) {
      const [id, keyIdx, x, y, z, yaw, hpFrac, eliteIdx] = rec;
      seen.add(id);
      let e = this.enemyById.get(id);
      if (!e) {
        const key = KEYS[keyIdx];
        if (!key || !ENEMY_DEFS[key]) continue;
        const isBoss = !!BOSS_DEFS[key];
        e = isBoss
          ? new Boss(this, key, _v1.set(x, y, z))
          : new Enemy(this, key, _v1.set(x, y, z), { elite: ELITES[eliteIdx] ?? null });
        e.id = id;
        e.netPuppet = true;
        this.enemies.push(e);
        this.enemyById.set(id, e);
        this.enemyLOD.register(e);
      }
      e.netTarget = e.netTarget ?? new THREE.Vector3();
      e.netTarget.set(x, y, z);
      e.netYaw = yaw;
      e.hp = hpFrac * e.maxHp;
    }
    // anything we have that the host doesn't → it died
    for (const e of this.enemies) {
      if (!e.dead && e.netPuppet && !seen.has(e.id)) {
        e.dead = true;
        e.deathT = 0;
        this.effects.shatter(e.mesh, { center: e.center.clone(), power: 6, upPower: 5 });
        e.mesh.visible = false;
      }
    }
  }
}
