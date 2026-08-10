// ============ pocket loot: throwables, consumables, wearable gear ============
// Wearables occupy HEAD / BODY / LEGS / TRINKET slots, render on the character,
// and roll a rarity that scales their stats (SENIOR ×1.5, EXECUTIVE ×2.25).
// Every wearable has a `visual` — if you can equip it, you (and your
// teammates) can see it. All four tables live in /data/gear.json (v0.2
// FOUNDATIONS — hot-reloadable in dev).
import gearData from '../../data/gear.json';
import { parseHexData, deepApply, announceDataReload } from './dataUtils.js';

parseHexData(gearData);
export const THROWABLES = gearData.throwables;
export const CONSUMABLES = gearData.consumables;
export const RARITY_TIERS = gearData.rarityTiers;
export const WEARABLES = gearData.wearables;

if (import.meta.hot) {
  import.meta.hot.accept(['../../data/gear.json'], ([mod]) => {
    if (!mod) return;
    const fresh = parseHexData(mod.default);
    deepApply(THROWABLES, fresh.throwables);
    deepApply(CONSUMABLES, fresh.consumables);
    deepApply(RARITY_TIERS, fresh.rarityTiers);
    deepApply(WEARABLES, fresh.wearables);
    announceDataReload('gear.json');
  });
}

export const GEAR_SLOTS = ['head', 'body', 'legs', 'trinket'];

export const WEARABLE_BY_ID = Object.fromEntries(WEARABLES.map((w) => [w.id, w]));

export function rollWearable(rng = Math.random, rarityBoost = 0) {
  const def = WEARABLES[(rng() * WEARABLES.length) | 0];
  const r = rng() * 100;
  let tier;
  if (r < 6 + rarityBoost * 20) tier = RARITY_TIERS[2];
  else if (r < 34 + rarityBoost * 30) tier = RARITY_TIERS[1];
  else tier = RARITY_TIERS[0];
  const stats = {};
  for (const [k, v] of Object.entries(def.stats)) stats[k] = +(v * tier.mult).toFixed(3);
  return {
    uid: Math.floor(rng() * 1e9),
    id: def.id, slot: def.slot, icon: def.icon,
    name: tier.prefix + def.name, desc: def.desc,
    rarity: tier.key, color: tier.color, css: tier.css,
    stats, visual: def.visual, gooResist: def.gooResist ?? false,
  };
}

export function describeStats(stats) {
  const L = [];
  if (stats.damageMult) L.push(`+${Math.round(stats.damageMult * 100)}% dmg`);
  if (stats.maxHpBonus) L.push(`+${Math.round(stats.maxHpBonus)} HP`);
  if (stats.moveMult) L.push(`+${Math.round(stats.moveMult * 100)}% speed`);
  if (stats.critChance) L.push(`+${Math.round(stats.critChance * 100)}% crit`);
  if (stats.regen) L.push(`+${stats.regen}/s regen`);
  if (stats.moneyMult) L.push(`+${Math.round(stats.moneyMult * 100)}% money`);
  if (stats.xpMult) L.push(`+${Math.round(stats.xpMult * 100)}% XP`);
  if (stats.damageTakenMult) L.push(`${Math.round(stats.damageTakenMult * 100)}% dmg taken`);
  if (stats.knockbackResist) L.push(`+${Math.round(stats.knockbackResist * 100)}% knockback resist`);
  return L.join(' · ');
}
