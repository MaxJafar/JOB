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
          if (e.pos.distanceTo(player.pos) < 14) { e.auditT = 6; n++; }
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
];

export const CLASS_BY_KEY = Object.fromEntries(CLASSES.map((c) => [c.key, c]));
