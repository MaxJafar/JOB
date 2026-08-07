// ============ pocket loot: throwables, consumables, wearable gear ============
// Wearables occupy HEAD / BODY / TRINKET slots, render on the character,
// and roll a rarity that scales their stats (SENIOR ×1.5, EXECUTIVE ×2.25).

export const THROWABLES = {
  grenade: {
    id: 'grenade', name: 'Stapler Grenade', icon: '🧨',
    desc: 'Cooked office ordnance. Bounces, then shreds.',
    fuse: 1.5, radius: 4.6, dmgBase: 55, dmgPerCoeff: 12, knockback: 12, max: 3,
  },
  tapeball: {
    id: 'tapeball', name: 'Tape Ball', icon: '🕸️',
    desc: 'Sticky mass of packing tape. Slows everything it splats.',
    fuse: 0, radius: 5.5, slowFactor: 0.35, slowTtl: 5, max: 3,
  },
  molotov: {
    id: 'molotov', name: 'Coffee Molotov', icon: '🔥',
    desc: 'Scalding dark roast in a carafe. Area denial, barista-style.',
    fuse: 0, radius: 3.4, dps: 14, ttl: 6, max: 3,
  },
};

export const CONSUMABLES = {
  energydrink: {
    id: 'energydrink', name: 'GRIND Energy', icon: '🥫',
    desc: 'Heal 35 HP instantly.', heal: 35,
  },
  sandwich: {
    id: 'sandwich', name: 'Fridge Sandwich', icon: '🥪',
    desc: 'Someone\'s lunch. Regenerate 45 HP over 8s.', hot: 45, hotTime: 8,
  },
  espresso: {
    id: 'espresso', name: 'Quad Espresso', icon: '☕',
    desc: '+25% attack & +12% move speed for 10s.', wiredTime: 10,
  },
};

export const RARITY_TIERS = [
  { key: 'common', prefix: '', mult: 1, color: 0x9aa3b0, css: '#9aa3b0' },
  { key: 'uncommon', prefix: 'SENIOR ', mult: 1.5, color: 0x58e07c, css: '#58e07c' },
  { key: 'rare', prefix: 'EXECUTIVE ', mult: 2.25, color: 0xffd23f, css: '#ffd23f' },
];

// stats use the same keys player.recomputeStats folds in
export const WEARABLES = [
  { id: 'hardhat', slot: 'head', icon: '⛑️', name: 'Hard Hat', visual: 'hardhat',
    desc: 'OSHA-approved.', stats: { damageTakenMult: -0.08 } },
  { id: 'propcap', slot: 'head', icon: '🧢', name: 'Propeller Cap', visual: 'propcap',
    desc: 'Casual Friday forever.', stats: { moveMult: 0.08 } },
  { id: 'headphones', slot: 'head', icon: '🎧', name: 'Noise-Cancelling Cans', visual: 'headphones',
    desc: 'Blocks gossip (mark duration halved) and sharpens focus.', stats: { critChance: 0.05 }, gooResist: true },
  { id: 'crown', slot: 'head', icon: '👑', name: 'Team-Player Crown', visual: 'crown',
    desc: 'Everyone agreed you earned this.', stats: { xpMult: 0.15 } },
  { id: 'vest', slot: 'body', icon: '🦺', name: 'Hi-Vis Vest', visual: 'vest',
    desc: 'Impossible to ignore. +HP, +to-be-seen.', stats: { maxHpBonus: 30 } },
  { id: 'blazer', slot: 'body', icon: '🧥', name: 'Power Blazer', visual: 'blazer',
    desc: 'Shoulders that negotiate.', stats: { damageMult: 0.12 } },
  { id: 'apron', slot: 'body', icon: '🥼', name: 'Battle Apron', visual: 'apron',
    desc: 'Pockets full of possibility.', stats: { regen: 0.8 } },
  { id: 'watch', slot: 'trinket', icon: '⌚', name: 'Gold Watch', visual: 'watch',
    desc: '25 years of loyal service.', stats: { moneyMult: 0.25 } },
  { id: 'tracker', slot: 'trinket', icon: '📟', name: 'Fitness Tracker', visual: null,
    desc: '10,000 steps of violence.', stats: { moveMult: 0.05, regen: 0.5 } },
  { id: 'lanyard', slot: 'trinket', icon: '🪪', name: 'Lucky Lanyard', visual: null,
    desc: 'All-access, somehow.', stats: { critChance: 0.06 } },
];

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
  return L.join(' · ');
}
