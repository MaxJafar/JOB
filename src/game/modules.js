// ============ PUNCH-CARD MODULES — the loot that builds your character ============
//
// Every archetype ships with a fixed SIGNATURE (LMB primary + RMB ability) that
// loot can never take away. On top of that chassis sit two slots filled purely
// by drops:
//
//   PASSIVE slot  — a rule change, not a stat stick (D 3.5: system-crossers)
//   SPECIAL slot  — an active ability on X
//
// The first ten SPECIAL modules ARE the old class kits — Tax Audit, Mandatory
// Meeting, Cold Call, Deploy Router, Staple Fan, Body Check, Full Send, the
// slip barrage — so an Intern who finds a Body Check card gets to shoulder-
// charge a crowd. Nothing that was built is wasted; it just stopped being
// welded to one character.
//
// Modules drop from SPECIALS / ELITES / KPIs / BOSSES only — never trash mobs
// (D 3.3). Bosses drop a deterministic signature card: a jackpot you can plan
// a run around.
import * as THREE from 'three';
import { clamp, dist2D } from '../core/utils.js';

const _v = new THREE.Vector3();

// ---------------------------------------------------------------------------
// rarity
// ---------------------------------------------------------------------------
// Deliberately gentler than the wearable ladder (×1 / ×1.5 / ×2.25). An ability
// at ×2.25 is not an upgrade, it is a different game; abilities also get a
// cooldown cut, which compounds. ×1.8 with a 22% shorter cooldown is already a
// ~2.3× throughput swing.
export const MODULE_TIERS = [
  { key: 'common', prefix: '', mult: 1, cdMult: 1, color: 0x9aa3b0, css: '#9aa3b0' },
  { key: 'uncommon', prefix: 'REVISED ', mult: 1.35, cdMult: 0.9, color: 0x58e07c, css: '#58e07c' },
  { key: 'rare', prefix: 'PATENTED ', mult: 1.8, cdMult: 0.78, color: 0xffd23f, css: '#ffd23f' },
];

const pct = (n) => `${Math.round(n * 100)}%`;

/**
 * Chassis-normalised ability power.
 *
 * `player.stats.damage` is a per-hit number tuned against a class's fire rate —
 * the Accountant sits at 6 because it fires at 12 Hz, the Facilities Guy at 26
 * because he swings at 3 Hz. Scaling a module off it directly would make the
 * same punch card four times stronger on one chassis than another. So we scale
 * off the player's damage GROWTH (level × items × gear × drafts) instead, and
 * anchor the magnitude to a fixed mid-tier hit. A module is worth the same to
 * everyone; what you bring to it is how far you have levelled.
 */
export function modPower(player) {
  const base = player.classDef?.damage || 14;
  return 14 * (player.stats.damage / base);
}

function rollCrit(player) { return Math.random() < player.stats.critChance; }

// ---------------------------------------------------------------------------
// SPECIAL modules — bound to X
// ---------------------------------------------------------------------------
export const SPECIAL_MODULES = [
  {
    id: 'taxaudit', icon: '🧾', name: 'Tax Audit', cd: 11,
    from: 'THE ACCOUNTANT',
    desc: (m) => `Mark every enemy within ${(12 * m.mult).toFixed(0)}m: they take +${pct(0.3 * m.mult)} damage for 6s.`,
    use(game, player, aim, m) {
      const r = 12 * m.mult;
      let n = 0;
      for (const e of game.enemies) {
        if (e.dead || e.pos.distanceTo(player.pos) > r) continue;
        e.auditT = 6;
        e.auditPower = 0.3 * m.mult;
        n++;
      }
      game.effects.ring(player.pos, { color: 0xffd23f, r1: r, dur: 0.5 });
      game.audio.sfx('buy');
      if (n > 0) game.hud.toast(`AUDITED ×${n}`, 'item');
      return true;
    },
  },
  {
    id: 'meeting', icon: '🪑', name: 'Mandatory Meeting', cd: 10,
    from: 'THE HR REP',
    desc: (m) => `Drop a meeting zone at your crosshair: enemies inside are slowed 60% for ${(5 * m.mult).toFixed(1)}s.`,
    use(game, player, aim, m) {
      const target = aim.point ?? player.pos;
      game.addSlowZone({
        pos: target.clone().setY(0), radius: 6.5 * m.mult, ttl: 5 * m.mult, factor: 0.4,
        dps: m.tier > 0 ? modPower(player) * 0.5 : 0, owner: player,
      });
      game.audio.sfx('phone');
      return true;
    },
  },
  {
    id: 'coldcall', icon: '📢', name: 'Cold Call', cd: 8,
    from: 'THE SALES REP',
    desc: (m) => `Deafening pitch: ${Math.round(modPowerLabel(m, 1.6))} cone damage and massive knockback.`,
    use(game, player, aim, m) {
      const hits = player.coneHit({ range: 9 * Math.min(1.3, m.mult), arcDeg: 70 });
      for (const e of hits) {
        const crit = rollCrit(player);
        game.damageEnemy(e, modPower(player) * 1.6 * m.mult * (crit ? 2 : 1), { crit, owner: player });
        e.applyKnockback(player.pos, 16);
      }
      game.effects.ring(player.pos, { color: 0xff9b2d, r1: 9, dur: 0.4 });
      game.audio.sfx('horde', { vol: 0.7 });
      game.shake(0.35);
      return true;
    },
  },
  {
    id: 'router', icon: '📡', name: 'Deploy Router', cd: 14,
    from: 'IT SUPPORT',
    desc: (m) => `Place a router turret (${Math.round(25 * m.mult)}s) that zaps nearby enemies.`,
    use(game, player, aim, m) {
      const spot = aim.point ? aim.point.clone() : player.pos.clone();
      spot.y = 0;
      if (spot.distanceTo(player.pos) > 8) spot.copy(player.pos);
      const turret = game.spawnTurret(spot, player);
      if (turret && m.mult > 1) turret.ttl = (turret.ttl ?? 25) * m.mult;
      game.audio.sfx('ui2');
      return true;
    },
  },
  {
    id: 'staplefan', icon: '📎', name: 'Staple Fan', cd: 5,
    from: 'THE INTERN',
    desc: (m) => `Fan of ${5 + (m.tier > 1 ? 2 : 0)} staples, ${Math.round(modPowerLabel(m, 1.1))} each.`,
    use(game, player, aim, m) {
      const wide = m.tier > 1;
      const half = wide ? 3 : 2;
      for (let i = -half; i <= half; i++) {
        const crit = rollCrit(player);
        const dir = _v.copy(aim.dir).applyAxisAngle(new THREE.Vector3(0, 1, 0), i * 0.07).normalize();
        game.projectiles.spawn({
          pos: aim.origin, vel: dir.clone().multiplyScalar(52), kind: 'staple',
          damage: modPower(player) * 1.1 * m.mult * (crit ? 2 : 1), crit,
          friendly: true, ttl: 2, owner: player, knockback: 3,
        });
      }
      game.audio.sfx('staple');
      game.audio.sfx('staple', { vol: 0.8 });
      return true;
    },
  },
  {
    id: 'slipstorm', icon: '📄', name: 'Pink Slip Storm', cd: 9,
    from: 'THE HR REP',
    desc: (m) => `Release ${Math.round(8 * m.mult)} homing termination notices, ${Math.round(modPowerLabel(m, 0.8))} each.`,
    use(game, player, aim, m) {
      const n = Math.round(8 * m.mult);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const crit = rollCrit(player);
        game.projectiles.spawn({
          pos: aim.origin.clone(),
          vel: new THREE.Vector3(Math.sin(a) * 22, 1.2, Math.cos(a) * 22),
          kind: 'slip', damage: modPower(player) * 0.8 * m.mult * (crit ? 2 : 1), crit,
          friendly: true, ttl: 3.4, owner: player, homing: 4.2, spin: 6,
        });
      }
      game.audio.sfx('slip');
      return true;
    },
  },
  {
    id: 'bodycheck', icon: '🪨', name: 'Body Check', cd: 9,
    from: 'THE FACILITIES GUY',
    desc: (m) => `Shoulder-charge forward, unstoppable, ending in a ground slam (${Math.round(modPowerLabel(m, 2))} on contact).`,
    use(game, player, aim, m) {
      const fwd = _v.set(Math.sin(player.yaw), 0, Math.cos(player.yaw)).clone();
      const dur = 0.65 * Math.min(1.35, m.mult);
      player.iframes = Math.max(player.iframes, dur + 0.05);
      player.chargeT = dur;
      game.audio.sfx('roar', { vol: 0.7 });
      const st = { t: dur, hit: new Set() };
      game.tickers.push({ update: (dt) => {
        st.t -= dt;
        player.vel.x = fwd.x * 22;
        player.vel.z = fwd.z * 22;
        for (const e of game.enemies) {
          if (e.dead || st.hit.has(e.id)) continue;
          if (e.pos.distanceTo(player.pos) < 2.0 + e.radius) {
            st.hit.add(e.id);
            const crit = rollCrit(player);
            game.damageEnemy(e, modPower(player) * 2 * m.mult * (crit ? 2 : 1), { crit, owner: player, melee: true });
            e.applyKnockback(player.pos, 20);
          }
        }
        if (st.t <= 0 || player.dead) {
          if (!player.dead) {
            const spot = player.pos.clone().setY(0);
            game.audio.sfx('explosion', { vol: 0.7 });
            game.shake(0.55);
            game.effects.ring(spot, { color: 0xffb36b, r1: 5, dur: 0.4 });
            game.level.kickDebris(spot, 6, 11);
            for (const e of game.enemies) {
              if (e.dead || dist2D(e.pos, spot) > 5) continue;
              const crit = rollCrit(player);
              game.damageEnemy(e, modPower(player) * 1.6 * m.mult * (crit ? 2 : 1), { crit, owner: player });
              e.applyKnockback(spot, 14);
              e.applyStun?.(0.5);
            }
          }
          return false;
        }
        return true;
      } });
      return true;
    },
  },
  {
    id: 'fullsend', icon: '💨', name: 'Full Send', cd: 7,
    from: 'THE MARKETING MANAGER',
    desc: (m) => `Ride a CO₂ boost: a long dash that runs enemies down for ${Math.round(modPowerLabel(m, 2.4))}.`,
    use(game, player, aim, m) {
      const fwd = _v.set(Math.sin(player.yaw), 0, Math.cos(player.yaw));
      player.vel.x = fwd.x * 26;
      player.vel.z = fwd.z * 26;
      player.momentumT = Math.max(player.momentumT, 0.9);
      player.iframes = Math.max(player.iframes, 0.25);
      player.boostT = 0.9;
      game.effects.ring(player.pos, { color: 0xdff2ff, r1: 2.6, dur: 0.35, opacity: 0.6 });
      game.audio.sfx('dash', { vol: 1.1 });
      game.shake(0.25);
      const ram = { hit: new Set(), t: 0.9 };
      game.tickers.push({ update: (dt) => {
        ram.t -= dt;
        for (const e of game.enemies) {
          if (e.dead || ram.hit.has(e.id)) continue;
          if (e.pos.distanceTo(player.pos) < 1.9 + e.radius) {
            ram.hit.add(e.id);
            const crit = rollCrit(player);
            game.damageEnemy(e, modPower(player) * 2.4 * m.mult * (crit ? 2 : 1), { crit, owner: player });
            e.applyKnockback(player.pos, 18);
          }
        }
        return ram.t > 0 && !player.dead;
      } });
      return true;
    },
  },
  // ---- two new cards, so the pool is not purely recycled ----
  {
    id: 'shredder', icon: '🗑️', name: 'Shredder Vortex', cd: 13,
    from: 'FACILITIES SALVAGE',
    desc: (m) => `Throw a shredder that drags everything within ${(5.5 * m.mult).toFixed(1)}m into it for 3s, grinding for ${Math.round(modPowerLabel(m, 0.55))}/s.`,
    use(game, player, aim, m) {
      const spot = (aim.point ? aim.point.clone() : player.pos.clone().addScaledVector(aim.dir, 6)).setY(0);
      const r = 5.5 * m.mult;
      const dps = modPower(player) * 0.55 * m.mult;
      game.effects.ring(spot, { color: 0x7fe7ff, r1: r, dur: 0.4 });
      game.audio.sfx('spit', { vol: 0.7 });
      const st = { t: 3, tick: 0 };
      game.tickers.push({ update: (dt) => {
        st.t -= dt;
        st.tick -= dt;
        const pulse = st.tick <= 0;
        if (pulse) st.tick = 0.25;
        for (const e of game.enemies) {
          if (e.dead) continue;
          const d = dist2D(e.pos, spot);
          if (d > r || d < 0.001) continue;
          // pull: velocity toward the centre, scaled so the far edge barely tugs
          const strength = 7 * (1 - d / r) * (e.def.big ? 0.35 : 1);
          e.pos.x += ((spot.x - e.pos.x) / d) * strength * dt;
          e.pos.z += ((spot.z - e.pos.z) / d) * strength * dt;
          if (pulse) game.damageEnemy(e, dps * 0.25, { owner: player });
        }
        if (pulse) {
          game.effects.burst(spot.clone().setY(0.4), {
            color: 0xe6ecf5, n: 5, speed: 3, size: 0.07, ttl: 0.4, gravity: 2,
          });
        }
        return st.t > 0;
      } });
      return true;
    },
  },
  {
    id: 'evacuate', icon: '🚨', name: 'Evacuation Drill', cd: 16,
    from: 'BUILDING SAFETY',
    desc: (m) => `Pull the alarm: everything within ${(11 * m.mult).toFixed(0)}m is stunned ${(1.4 * m.mult).toFixed(1)}s and takes ${Math.round(modPowerLabel(m, 1.2))}.`,
    use(game, player, aim, m) {
      const r = 11 * m.mult;
      game.effects.ring(player.pos, { color: 0xff4d4d, r1: r, dur: 0.6 });
      game.audio.sfx('alarm', { vol: 0.9 });
      game.shake(0.4);
      let n = 0;
      for (const e of game.enemies) {
        if (e.dead || e.pos.distanceTo(player.pos) > r) continue;
        const crit = rollCrit(player);
        game.damageEnemy(e, modPower(player) * 1.2 * m.mult * (crit ? 2 : 1), { crit, owner: player });
        e.applyStun?.(1.4 * m.mult);
        n++;
      }
      if (n > 0) game.hud.toast(`🚨 EVACUATE — ${n} STUNNED`, 'item');
      return true;
    },
  },
];

// desc() runs at draft/tooltip time, outside a run's player context, so it
// cannot call modPower(). Label the numbers against the reference hit instead.
function modPowerLabel(m, mult) { return 14 * mult * m.mult; }

// ---------------------------------------------------------------------------
// PASSIVE modules — rule changes, not stat sticks
// ---------------------------------------------------------------------------
// `v` is the tuned value set; every number in it is multiplied by the tier
// multiplier when the card is rolled. Player.passive(key) reads them back, so a
// hook site is one lookup and never has to know which card is equipped.
export const PASSIVE_MODULES = [
  {
    id: 'ergochair', icon: '🪑', name: 'Ergonomic Chair',
    v: { specialCdMult: 0.18 },
    desc: (v) => `Your SPECIAL module recharges ${pct(v.specialCdMult)} faster.`,
  },
  {
    id: 'caffeinedrip', icon: '☕', name: 'Caffeine Drip',
    v: { dashCdMult: 0.2, dashBurn: 0.9 },
    desc: (v) => `Dash cooldown −${pct(v.dashCdMult)}, and your dash leaves a scalding trail.`,
  },
  {
    id: 'openplan', icon: '🏢', name: 'Open Floor Plan',
    v: { crowdDamage: 0.04 },
    desc: (v) => `+${pct(v.crowdDamage)} damage for every enemy within 9m (max 6).`,
  },
  {
    id: 'standingdesk', icon: '🧍', name: 'Standing Desk',
    v: { fullHpMove: 0.12 },
    desc: (v) => `+${pct(v.fullHpMove)} move speed while at full health.`,
  },
  {
    id: 'backupserver', icon: '💾', name: 'Backup Server',
    v: { restoreIframes: 2 },
    desc: (v) => `Once per floor, a killing blow leaves you at 1 HP with ${v.restoreIframes.toFixed(1)}s of invulnerability.`,
  },
  {
    id: 'noisecomplaint', icon: '📣', name: 'Noise Complaint',
    v: { killStunRadius: 3.5, killStun: 0.35 },
    desc: (v) => `Every kill stuns enemies within ${v.killStunRadius.toFixed(1)}m for ${v.killStun.toFixed(2)}s.`,
  },
  {
    id: 'overtimepay', icon: '💸', name: 'Overtime Pay',
    v: { comboMoney: 0.5, comboLoot: 0.18 },
    desc: (v) => `At combo ×10+, kills pay +${pct(v.comboMoney)} and drop noticeably better loot.`,
  },
  {
    id: 'eotm', icon: '🏆', name: 'Employee of the Month',
    v: { eliteBuff: 0.25, eliteBuffTime: 8 },
    desc: (v) => `Killing a special or elite grants +${pct(v.eliteBuff)} damage for ${v.eliteBuffTime.toFixed(0)}s.`,
  },
  {
    id: 'papertrail', icon: '📋', name: 'Paper Trail',
    v: { snackEvery: 12 },
    desc: (v) => `Every ${Math.round(v.snackEvery)} kills, someone leaves a snack behind.`,
  },
  {
    id: 'firemarshal', icon: '🧯', name: 'Fire Marshal',
    v: { furnitureBlast: 1.6, furnitureRadius: 3.4 },
    desc: (v) => `Furniture you break detonates for ${Math.round(14 * v.furnitureBlast)} in ${v.furnitureRadius.toFixed(1)}m.`,
  },
];

// papertrail counts DOWN, so a bigger card must trigger sooner, not later.
const INVERTED_PASSIVE_KEYS = new Set(['snackEvery']);

export const MODULE_BY_ID = Object.fromEntries(
  [...SPECIAL_MODULES, ...PASSIVE_MODULES].map((m) => [m.id, m]),
);

// ---------------------------------------------------------------------------
// rolling
// ---------------------------------------------------------------------------
function pickTier(rng, rarityBoost) {
  const r = rng() * 100;
  if (r < 8 + rarityBoost * 26) return 2;
  if (r < 36 + rarityBoost * 34) return 1;
  return 0;
}

/**
 * @param {() => number} rng
 * @param {{rarityBoost?: number, kind?: 'special'|'passive', id?: string, tier?: number}} opts
 */
export function rollModule(rng = Math.random, opts = {}) {
  const kind = opts.kind ?? (rng() < 0.5 ? 'special' : 'passive');
  const pool = kind === 'special' ? SPECIAL_MODULES : PASSIVE_MODULES;
  const def = opts.id ? MODULE_BY_ID[opts.id] : pool[(rng() * pool.length) | 0];
  const isSpecial = SPECIAL_MODULES.includes(def);
  const tierIdx = opts.tier ?? pickTier(rng, opts.rarityBoost ?? 0);
  const tier = MODULE_TIERS[clamp(tierIdx, 0, 2)];
  const inst = {
    uid: Math.floor(rng() * 1e9),
    id: def.id,
    kind: isSpecial ? 'special' : 'passive',
    icon: def.icon,
    name: tier.prefix + def.name,
    from: def.from ?? null,
    rarity: tier.key,
    tier: MODULE_TIERS.indexOf(tier),
    mult: tier.mult,
    color: tier.color,
    css: tier.css,
  };
  if (isSpecial) {
    inst.cd = +(def.cd * tier.cdMult).toFixed(2);
    inst.desc = def.desc(inst);
  } else {
    inst.v = {};
    for (const [k, val] of Object.entries(def.v)) {
      inst.v[k] = +(INVERTED_PASSIVE_KEYS.has(k) ? val / tier.mult : val * tier.mult).toFixed(3);
    }
    inst.desc = def.desc(inst.v);
  }
  return inst;
}

/**
 * The deterministic jackpot every department head owes you (D 3.4). Keyed by
 * BOSS_DEFS key, and each head hands over the card that matches how they fight:
 * Security gives you the charge that ran you over, HR gives you the meeting.
 */
export const BOSS_MODULES = {
  security: 'bodycheck',   // GUS DUTY — head of security
  chro: 'meeting',         // CHRO — human resources
  cto: 'router',           // CTO — I.T.
  cfo: 'taxaudit',         // CFO — finance
  cmo: 'fullsend',         // CMO — marketing
  vp: 'coldcall',          // VP — sales
  ceo: 'evacuate',         // the penthouse
};

/**
 * Pity timer. Drop rarity is not memoryless: every module that rolls common
 * raises the floor for the next one, so a run cannot hand you nine grey cards
 * and call it variance (D 3.3).
 */
export class ModuleLuck {
  constructor() { this.reset(); }
  reset() { this.dry = 0; }

  /** @returns {number} rarityBoost to feed rollModule */
  boost(extra = 0) { return clamp(extra + this.dry * 0.14, 0, 1.2); }

  observe(mod) {
    if (mod.tier >= 1) this.dry = 0;
    else this.dry++;
  }
}

/** Shared with the HUD and the inventory panel. */
export function describeModule(mod) {
  if (!mod) return '';
  return mod.kind === 'special' ? `${mod.desc} · ${mod.cd}s cooldown` : mod.desc;
}
