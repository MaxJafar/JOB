// ============ the six employees of the month ============
import * as THREE from 'three';
import { chance, rand } from '../core/utils.js';

const _v = new THREE.Vector3();

function rollCrit(player) { return chance(player.stats.critChance); }
function dmgOf(player, mult, crit) { return (player.stats.damage * mult + player.stats.flatDamage) * (crit ? 2 : 1); }

export const CLASSES = [
  {
    key: 'intern', icon: '📎', name: 'THE INTERN', title: 'Stapler Specialist',
    desc: 'Unpaid, over-caffeinated, weaponized. Balanced starter kit with a trusty office sidearm.',
    hp: 115, speed: 7.4, damage: 13,
    weapon: 'stapler',
    passive: 'Eager To Learn — +15% XP gain.',
    xpBonus: 1.15,
    look: { shirt: 0xd9dde3, pants: 0x51586b, tie: 0xc03030, accessories: [] },
    primary: {
      name: 'Staple Shot', icon: '📎', desc: 'Snappy semi-auto staples.', cd: 0.21, mag: 14, reload: 1.0,
      fire(game, player, aim) {
        const shots = player.upgrades.get('doublestapler') ? 2 : 1;
        for (let i = 0; i < shots; i++) {
          const crit = rollCrit(player);
          const dir = _v.copy(aim.dir);
          if (shots > 1) dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), (i - 0.5) * 0.06);
          game.projectiles.spawn({
            pos: aim.origin, vel: dir.clone().multiplyScalar(56), kind: 'staple',
            damage: dmgOf(player, 1, crit), crit, friendly: true, ttl: 2, owner: player, knockback: 2,
          });
        }
        game.audio.sfx('staple');
        return true;
      },
    },
    secondary: {
      name: 'Performance Sprint', icon: '📄', desc: 'Burst of 5 staples in a fan.', cd: 5,
      use(game, player, aim) {
        for (let i = -2; i <= 2; i++) {
          const crit = rollCrit(player);
          const dir = _v.copy(aim.dir).applyAxisAngle(new THREE.Vector3(0, 1, 0), i * 0.07).normalize();
          game.projectiles.spawn({
            pos: aim.origin, vel: dir.clone().multiplyScalar(52), kind: 'staple',
            damage: dmgOf(player, 1.1, crit), crit, friendly: true, ttl: 2, owner: player, knockback: 3,
          });
        }
        game.audio.sfx('staple'); game.audio.sfx('staple', { vol: 0.8 });
        return true;
      },
    },
  },
  {
    key: 'janitor', icon: '🧹', name: 'THE JANITOR', title: 'Custodial Enforcer',
    desc: 'Broom in one hand, trash-can lid in the other. Slow, tanky, sweeps entire crowds.',
    hp: 170, speed: 6.8, damage: 30,
    weapon: 'broom', offhand: 'lid',
    passive: 'Union Rules — heavy knockback on swings; blocking with the lid negates 75% frontal damage.',
    look: { shirt: 0x5b6e5f, pants: 0x3a4038, tie: null, accessories: ['cap'] },
    primary: {
      name: 'Clean Sweep', icon: '🧹', desc: 'Wide melee arc. Hits everything in front.', cd: 0.52,
      fire(game, player, aim) {
        player.meleeSwing({ range: 3.0, arcDeg: 140, mult: 1, knockback: 9 });
        return true;
      },
    },
    secondary: {
      name: 'Lid Up', icon: '🛡️', desc: 'HOLD: raise the trash-can lid. Blocks 75% of frontal damage, slows you.', cd: 0, hold: true,
      use() { return true; },
    },
  },
  {
    key: 'accountant', icon: '🧮', name: 'THE ACCOUNTANT', title: 'Forensic Number-Cruncher',
    desc: 'A calculator with the fire rate of an expense report deadline. Shreds single targets.',
    hp: 100, speed: 7.2, damage: 6,
    weapon: 'calculator',
    passive: 'Expense It — +25% money from kills.',
    moneyBonus: 1.25,
    look: { shirt: 0xbfd0e2, pants: 0x33445c, tie: 0x274a75, accessories: ['glasses'] },
    primary: {
      name: 'Crunch Numbers', icon: '🔢', desc: 'Full-auto digit stream.', cd: 0.08, mag: 48, reload: 1.45,
      fire(game, player, aim) {
        const crit = rollCrit(player);
        const dir = _v.copy(aim.dir);
        dir.x += rand(-0.02, 0.02); dir.y += rand(-0.015, 0.015); dir.z += rand(-0.02, 0.02);
        player.shotCounter = (player.shotCounter || 0) + 1;
        const bomb = player.upgrades.get('taxbomb') && player.shotCounter % 25 === 0;
        game.projectiles.spawn({
          pos: aim.origin, vel: dir.normalize().multiplyScalar(62), kind: bomb ? 'orb' : 'calcshot',
          damage: dmgOf(player, bomb ? 3 : 1, crit), crit, friendly: true, ttl: 1.6, owner: player,
          knockback: bomb ? 8 : 1, aoe: bomb ? 3.2 : 0,
        });
        game.audio.sfx(bomb ? 'chest' : 'smg');
        return true;
      },
    },
    secondary: {
      name: 'Tax Audit', icon: '🧾', desc: 'Mark every enemy within 14m: they take +30% damage for 6s.', cd: 11,
      use(game, player) {
        let n = 0;
        for (const e of game.enemies) {
          if (e.dead) continue;
          if (e.pos.distanceTo(player.pos) < 14) { e.auditT = 6; e.auditPower = 0.3; n++; }
        }
        game.effects.ring(player.pos, { color: 0xffd23f, r1: 14, dur: 0.5 });
        game.audio.sfx('buy');
        if (n > 0) game.hud.toast(`AUDITED ×${n}`, 'item');
        return true;
      },
    },
  },
  {
    key: 'hr', icon: '📁', name: 'THE HR REP', title: 'Chief Vibes Officer',
    desc: 'Pink slips that hunt down their recipient. Crowd control through mandatory meetings.',
    hp: 105, speed: 7.3, damage: 12,
    weapon: 'folder',
    passive: 'De-escalation Training — take 10% less damage.',
    damageTakenMult: 0.9,
    look: { shirt: 0xe8c8d8, pants: 0x5c3346, tie: null, accessories: ['bun'], hair: 0x743a20 },
    primary: {
      name: 'Pink Slip', icon: '📄', desc: 'Homing termination notices.', cd: 0.3, mag: 9, reload: 1.2,
      fire(game, player, aim) {
        const crit = rollCrit(player);
        game.projectiles.spawn({
          pos: aim.origin, vel: _v.copy(aim.dir).multiplyScalar(34), kind: 'slip',
          damage: dmgOf(player, 1, crit), crit, friendly: true, ttl: 3.2, owner: player, homing: 3.4, spin: 6,
        });
        game.audio.sfx('slip');
        return true;
      },
    },
    secondary: {
      name: 'Mandatory Meeting', icon: '🪑', desc: 'Drop a meeting zone at your crosshair: enemies inside are slowed 60% for 5s.', cd: 10,
      use(game, player, aim) {
        const target = aim.point ?? player.pos;
        const big = player.upgrades.get('bigmeeting');
        game.addSlowZone({
          pos: target.clone().setY(0), radius: big ? 8.5 : 6.5, ttl: big ? 6 : 5, factor: 0.4,
          dps: big ? player.stats.damage * 0.8 : 0, owner: player,
        });
        game.audio.sfx('phone');
        return true;
      },
    },
  },
  {
    key: 'it', icon: '💻', name: 'IT SUPPORT', title: 'Have You Tried Rebooting',
    desc: 'A continuous ethernet arc that jumps between machines… and coworkers. Deploys router turrets.',
    hp: 115, speed: 7.1, damage: 5.5,
    weapon: 'taser',
    passive: 'Hotfix — +1.2 HP/s baseline regen.',
    regenBonus: 1.2,
    look: { shirt: 0x3d4451, pants: 0x23272f, tie: null, accessories: ['glasses'], hair: 0x1d1508 },
    primary: {
      name: 'Bandwidth Beam', icon: '⚡', desc: 'HOLD: zap beam, chains to a second target. Overheats — manage the gauge.', cd: 0.09, beam: true, heat: true,
      fire(game, player, aim) {
        // beam logic lives in player.updateBeam — this is the tick
        return player.beamTick(aim);
      },
    },
    secondary: {
      name: 'Deploy Router', icon: '📡', desc: 'Place a router turret (25s) that zaps nearby enemies.', cd: 14,
      use(game, player, aim) {
        const spot = aim.point ? aim.point.clone() : player.pos.clone();
        spot.y = 0;
        if (spot.distanceTo(player.pos) > 8) spot.copy(player.pos);
        game.spawnTurret(spot, player);
        game.audio.sfx('ui2');
        return true;
      },
    },
  },
  {
    key: 'sales', icon: '📇', name: 'THE SALES REP', title: 'Always Be Closing',
    desc: 'Business cards with razor-thin margins. Fastest employee on the floor.',
    hp: 108, speed: 8.0, damage: 12,
    weapon: 'cards',
    passive: 'Hustle Culture — fastest employee on the floor. Sprint is 8% faster.',
    sprintBonus: 1.08,
    look: { shirt: 0x3a5f8a, pants: 0x22334a, tie: 0xff9b2d, accessories: ['headset'] },
    primary: {
      name: 'Card Toss', icon: '📇', desc: 'Piercing business cards (up to 4 targets).', cd: 0.27, mag: 16, reload: 1.1,
      fire(game, player, aim) {
        const crit = rollCrit(player);
        game.projectiles.spawn({
          pos: aim.origin, vel: _v.copy(aim.dir).multiplyScalar(48), kind: 'card',
          damage: dmgOf(player, 1, crit), crit, friendly: true, ttl: 2.4, owner: player, pierce: 3, spin: 18,
          boomerang: !!player.upgrades.get('boomerang'),
        });
        game.audio.sfx('card');
        return true;
      },
    },
    secondary: {
      name: 'Cold Call', icon: '📢', desc: 'Deafening pitch: cone damage + massive knockback.', cd: 8,
      use(game, player, aim) {
        const hits = player.coneHit({ range: 9, arcDeg: 70 });
        for (const e of hits) {
          const crit = rollCrit(player);
          game.damageEnemy(e, dmgOf(player, 1.6, crit), { crit, owner: player });
          e.applyKnockback(player.pos, 16);
        }
        if (hits.length && player.upgrades.get('networking')) {
          player.dashCd = 0;
          game.hud.toast('🤝 NETWORKING — dash reset', '');
        }
        game.effects.ring(player.pos, { color: 0xff9b2d, r1: 9, dur: 0.4 });
        game.audio.sfx('horde', { vol: 0.7 });
        game.shake(0.35);
        return true;
      },
    },
  },
  {
    key: 'marketing', icon: '🧯', name: 'THE MARKETING MANAGER', title: 'Never Left The Chair',
    desc: 'Has not stood up since the rebrand. Rides a task chair at terrifying speed and puts out fires — and people — with a CO₂ extinguisher.',
    hp: 96, speed: 8.6, damage: 8,
    weapon: 'extinguisher',
    mount: 'chair',
    passive: 'Ergonomic Momentum — you roll instead of walk: top speed is high and turns drift, but you cannot slide.',
    look: {
      shirt: 0xff4fa3, pants: 0x2b2038, tie: null, accessories: ['sunglasses', 'ponytail', 'lanyard'],
      hair: 0xe0559a, build: 'petite', chairColor: 0xff4fa3,
    },
    primary: {
      name: 'Discharge', icon: '🧯', desc: 'HOLD: a CO₂ cone. Chews through crowds and CHILLS what it touches (slow + no rally).', cd: 0.055,
      fire(game, player, aim) {
        // a cone of short-lived cosmetic puffs, resolved as an arc query rather
        // than as projectiles — a held cone at 18 Hz would flood the sim
        const crit = rollCrit(player);
        const hits = game.combat.meleeArc({
          origin: player.pos,
          direction: _v.set(Math.sin(player.yaw), 0, Math.cos(player.yaw)),
          radius: 7.5, angle: 42, maxTargets: 10,
        });
        const deep = player.upgrades.get('deepfreeze');
        for (const e of hits) {
          game.damageEnemy(e, dmgOf(player, 1, crit), { crit, owner: player });
          e.applyKnockback(player.pos, 1.6);
          // CHILL: the extinguisher's real job is crowd shaping
          e.slowFactor = Math.min(e.slowFactor ?? 1, 0.45);
          e.chillT = Math.max(e.chillT ?? 0, deep ? 2.4 : 1.2);
          if (deep) e.chillVuln = Math.max(e.chillVuln ?? 0, 2.4);
          e.rallyT = 0;
        }
        const muzzle = player.muzzleWorldFx();
        const fwd = _v.set(Math.sin(player.yaw), 0, Math.cos(player.yaw));
        game.effects.burst(muzzle.clone().addScaledVector(fwd, 0.8), {
          color: 0xdff2ff, n: 3, speed: 9, size: 0.16, ttl: 0.28, gravity: -1.5, up: 0.4,
        });
        game.audio.sfx('spit', { vol: 0.28 });
        return true;
      },
    },
    secondary: {
      name: 'Full Send', icon: '💨', desc: 'Point the extinguisher backwards and ride the thrust: a long boost that runs enemies down.', cd: 7,
      use(game, player) {
        const fwd = _v.set(Math.sin(player.yaw), 0, Math.cos(player.yaw));
        player.vel.x = fwd.x * 26;
        player.vel.z = fwd.z * 26;
        player.momentumT = Math.max(player.momentumT, 0.9);
        player.iframes = Math.max(player.iframes, 0.25);
        player.boostT = 0.9;
        game.effects.ring(player.pos, { color: 0xdff2ff, r1: 2.6, dur: 0.35, opacity: 0.6 });
        game.effects.burst(player.pos.clone().setY(0.5), { color: 0xdff2ff, n: 16, speed: 7, ttl: 0.5, gravity: -1 });
        game.audio.sfx('dash', { vol: 1.1 });
        game.shake(0.25);
        // anything you plough through gets launched
        const trail = player.upgrades.get('crashcart');
        const refund = player.upgrades.get('flooritsafloor');
        const ram = { hit: new Set(), t: 0.9, puff: 0 };
        game.tickers.push({ update: (dt) => {
          ram.t -= dt;
          if (trail) {
            ram.puff -= dt;
            if (ram.puff <= 0) {
              ram.puff = 0.12;
              game.addSlowZone({
                pos: player.pos.clone().setY(0), radius: 2.4, ttl: 2.2,
                factor: 0.45, color: 0xdff2ff, quiet: true,
              });
            }
          }
          for (const e of game.enemies) {
            if (e.dead || ram.hit.has(e.id)) continue;
            if (e.pos.distanceTo(player.pos) < 1.9 + e.radius) {
              ram.hit.add(e.id);
              const crit = rollCrit(player);
              game.damageEnemy(e, dmgOf(player, 2.4, crit), { crit, owner: player });
              e.applyKnockback(player.pos, 18);
              if (refund) player.secondaryCd = Math.max(0, player.secondaryCd - 2.5);
            }
          }
          return ram.t > 0 && !player.dead;
        } });
        return true;
      },
    },
  },
  {
    key: 'brawler', icon: '🥊', name: 'THE FACILITIES GUY', title: 'Built Like A Vending Machine',
    desc: 'Six foot six of loading-dock muscle in a hi-vis vest. No weapon, no ammo, no reload — just hands. Walks through knockback and hits like a forklift.',
    hp: 235, speed: 6.2, damage: 26,
    weapon: null, gloves: true,
    knockbackResist: 0.65,
    passive: 'Load-Bearing — 65% knockback resistance, and every third punch is a HAYMAKER that launches whatever it touches.',
    look: {
      shirt: 0x2f3540, pants: 0x22262c, tie: null, accessories: ['hardhat'],
      hair: 0x1a1a1a, build: 'bulky', skin: 0xC68863,
    },
    primary: {
      name: 'Combo', icon: '🥊', desc: 'Alternating jabs. Every third lands a HAYMAKER — bigger arc, huge knockback, small shockwave.', cd: 0.34,
      fire(game, player) {
        player.punchCount = (player.punchCount || 0) + 1;
        const every = player.upgrades.get('southpaw') ? 2 : 3;
        const haymaker = player.punchCount % every === 0;
        player.swingSide *= -1;
        player.attackAnimT = 0.26;
        game.audio.sfx('swing', { vol: haymaker ? 1.2 : 0.7 });
        game.effects.slash(player.pos, player.yaw, haymaker ? 3.6 : 2.6, player.swingSide, haymaker ? 0xffb36b : 0xf2f6ff);
        const hits = player.coneHit({ range: haymaker ? 3.6 : 2.6, arcDeg: haymaker ? 130 : 85 });
        for (const e of hits) {
          const crit = rollCrit(player);
          game.damageEnemy(e, dmgOf(player, haymaker ? 2.6 : 1, crit), { crit, owner: player, melee: true });
          e.applyKnockback(player.pos, haymaker ? 22 : 6);
          if (haymaker) e.applyStun?.(0.4);
        }
        if (hits.length) game.audio.sfx('melee-hit', { vol: haymaker ? 1.3 : 0.8 });
        if (haymaker) {
          game.shake(0.3);
          const spot = player.pos.clone().addScaledVector(_v.set(Math.sin(player.yaw), 0, Math.cos(player.yaw)), 2.2);
          game.effects.ring(spot, { color: 0xffb36b, r1: 2.6, dur: 0.3 });
          game.level.kickDebris(spot, 3, 8);
          // IRON JAW: connecting buys you a moment of armour
          if (hits.length && player.upgrades.get('ironjaw')) player.shieldT = 3;
        }
        return true;
      },
    },
    secondary: {
      name: 'Body Check', icon: '🪨', desc: 'Shoulder-charge forward. Unstoppable through crowds, ends in a ground slam.', cd: 9,
      use(game, player) {
        const fwd = _v.set(Math.sin(player.yaw), 0, Math.cos(player.yaw)).clone();
        const wrecking = player.upgrades.get('wrecking');
        const dur = wrecking ? 1.0 : 0.65;
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
              game.damageEnemy(e, dmgOf(player, 2.0, crit), { crit, owner: player, melee: true });
              e.applyKnockback(player.pos, 20);
            }
          }
          // WRECKING BALL: the furniture is not a suggestion
          if (wrecking) {
            for (const d of game.level.destructibles) {
              if (d.dead || dist(d.pos, player.pos) > 2.4) continue;
              game.damageDestructible(d, player.stats.damage * 4);
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
                if (e.dead || dist(e.pos, spot) > 5) continue;
                const crit = rollCrit(player);
                game.damageEnemy(e, dmgOf(player, 1.6, crit), { crit, owner: player });
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
  },
  // ---- the two hires that complete the range grid: 2 melee / 2 short / 2 long ----
  {
    key: 'barista', icon: '☕', name: 'THE BARISTA', title: 'Third Wave, Second Shift',
    desc: 'Unbolted the steam arm off the machine and brought it to the floor. Everything within arm\'s reach cooks; nothing past 8 metres notices.',
    hp: 118, speed: 7.3, damage: 9,
    weapon: 'steamwand',
    passive: 'Third-Wave Discipline — heat is not a penalty, it is ammunition: STEAM BURST hits for whatever the gauge has built. Vent before it locks.',
    look: {
      shirt: 0x4a5f52, pants: 0x2b3038, tie: null,
      accessories: ['apron', 'cap'], hair: 0x2a1c12,
    },
    primary: {
      name: 'Steam Wand', icon: '♨️', desc: 'HOLD: a scalding cone. Brutal inside 8m, useless past it. Builds heat.', cd: 0.06, heat: true,
      overheatMsg: '♨️ WAND SCALDED — LET IT COOL',
      heatNote: 'COOLING…',
      fire(game, player) {
        const crit = rollCrit(player);
        const fwd = _v.set(Math.sin(player.yaw), 0, Math.cos(player.yaw));
        // 8m is the designed cliff — this is a short-range chassis and the
        // falloff is the weakness the whole kit is balanced around
        const hits = game.combat.meleeArc({
          origin: player.pos, direction: fwd, radius: 8, angle: 34, maxTargets: 8,
        });
        for (const e of hits) {
          const d = e.pos.distanceTo(player.pos);
          const falloff = d < 4 ? 1 : Math.max(0.25, 1 - (d - 4) / 4);
          game.damageEnemy(e, dmgOf(player, falloff, crit), { crit, owner: player });
          // scalding leaves a mark: a short burn that stacks with the cone
          e.bleeds?.push({ t: 2, dps: player.stats.damage * 0.5, owner: player });
        }
        const muzzle = player.muzzleWorldFx();
        game.effects.burst(muzzle.clone().addScaledVector(fwd, 0.7), {
          color: 0xf2f6ff, n: 3, speed: 8, size: 0.14, ttl: 0.3, gravity: 1.6, up: 0.8,
        });
        game.audio.sfx('spit', { vol: 0.22 });
        return true;
      },
    },
    secondary: {
      name: 'Steam Burst', icon: '💥', desc: 'Dump the whole gauge at once: a shockwave that scales with how hot you let it run, and vents you back to zero.', cd: 6,
      use(game, player) {
        // The signature IS the risk-management loop: the burst is worth what
        // the gauge holds, and the gauge is what locks you out if it fills.
        const heat = player.heatGauge;
        const scale = 0.6 + heat * 2.6;
        const radius = 4 + heat * 3.5;
        player.heatGauge = 0;
        player.overheatLock = 0;
        game.effects.ring(player.pos, { color: 0xf2f6ff, r1: radius, dur: 0.4 });
        game.effects.burst(player.pos.clone().setY(1), {
          color: 0xf2f6ff, n: Math.round(10 + heat * 24), speed: 9, ttl: 0.55, gravity: 1.2,
        });
        game.audio.sfx('explosion', { vol: 0.4 + heat * 0.5 });
        game.shake(0.2 + heat * 0.4);
        for (const e of game.enemies) {
          if (e.dead || dist(e.pos, player.pos) > radius) continue;
          const crit = rollCrit(player);
          game.damageEnemy(e, dmgOf(player, scale, crit), { crit, owner: player });
          e.applyKnockback(player.pos, 8 + heat * 12);
          e.chillT = 0;
          e.bleeds?.push({ t: 3, dps: player.stats.damage * heat, owner: player });
        }
        if (heat > 0.7) game.hud.toast('♨️ FULL PRESSURE', 'item');
        return true;
      },
    },
  },
  {
    key: 'analyst', icon: '📐', name: 'THE ANALYST', title: 'Cold, Patient, Surgical',
    desc: 'Reads the room as a spreadsheet and the room as a firing line. Charged shots that go through a whole column of coworkers — provided nothing is close enough to touch her.',
    hp: 92, speed: 7.0, damage: 22,
    weapon: 'ledgerrifle',
    passive: 'Due Diligence — your crits pay ×3 instead of ×2, and a fully charged shot pierces everything in the line.',
    critDamageBonus: 1,
    look: {
      shirt: 0x2f3a4a, pants: 0x232a35, tie: 0x7fe7ff,
      accessories: ['glasses', 'bun'], hair: 0x4a3524, build: 'petite',
    },
    primary: {
      name: 'Ledger Rifle', icon: '📐', desc: 'HOLD to charge, release to fire. A full charge pierces the whole line; a panic shot barely dents.', cd: 0.18, mag: 6, reload: 1.6,
      charge: 0.75,
      fire(game, player, aim, charge = 1) {
        const crit = rollCrit(player);
        const full = charge > 0.97;
        // 0.55× on a flinch shot up to 3.2× on a held one: the charge bar IS
        // the skill check, and standing still to fill it is the cost
        const mult = 0.55 + charge * 2.65;
        game.projectiles.spawn({
          pos: aim.origin, vel: _v.copy(aim.dir).multiplyScalar(72 + charge * 40), kind: 'card',
          damage: dmgOf(player, mult, crit), crit, friendly: true, ttl: 2.6, owner: player,
          pierce: full ? 99 : Math.floor(charge * 3), knockback: 2 + charge * 6, spin: 4,
        });
        game.audio.sfx(full ? 'crit' : 'card', { vol: 0.6 + charge * 0.5 });
        if (full) {
          game.shake(0.18);
          game.effects.burst(player.muzzleWorldFx(), { color: 0xffd23f, n: 8, speed: 5, size: 0.08, ttl: 0.3 });
        }
        return true;
      },
    },
    secondary: {
      name: 'Risk Assessment', icon: '🎯', desc: 'Flag what you are aiming at. The flagged target takes +45% damage from you and stays lit through a crowd.', cd: 9,
      use(game, player, aim) {
        // Deliberately single-target: the swarm weakness is the design, and
        // patching it is what the SPECIAL module slot is for.
        let best = null, bestD = Infinity;
        const fwd = _v.copy(aim.dir);
        for (const e of game.enemies) {
          if (e.dead) continue;
          const to = e.pos.clone().sub(player.pos);
          const d = to.length();
          if (d > 40) continue;
          if (to.normalize().dot(fwd) < 0.9) continue;
          if (d < bestD) { bestD = d; best = e; }
        }
        if (!best) {
          game.hud.toast('🎯 nothing in the sights', '');
          return false;
        }
        best.auditT = 9;
        best.auditPower = 0.45;
        game.effects.ring(best.pos, { color: 0xffd23f, r1: 1.8, dur: 0.6 });
        game.audio.sfx('ui2');
        game.hud.toast(`🎯 FLAGGED: ${best.def.name ?? 'TARGET'}`, 'item');
        return true;
      },
    },
  },
];

function dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

export const CLASS_BY_KEY = Object.fromEntries(CLASSES.map((c) => [c.key, c]));
