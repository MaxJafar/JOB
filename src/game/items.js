// ============ stacking items (Risk of Rain style) ============
// Items are pure data; Player.recomputeStats() folds stacks into multipliers,
// and combat code checks proc fields on the computed stats object.

export const RARITY = { COMMON: 'common', UNCOMMON: 'uncommon', RARE: 'rare' };

export const ITEMS = [
  // ---- common ----
  { id: 'coffee', icon: '☕', name: 'Lukewarm Coffee', rarity: 'common',
    desc: '+10% attack speed per stack.', },
  { id: 'donuts', icon: '🍩', name: 'Break Room Donuts', rarity: 'common',
    desc: '+25 max HP per stack.', },
  { id: 'gym', icon: '👟', name: 'Gym Membership', rarity: 'common',
    desc: '+8% movement speed per stack. You actually go.', },
  { id: 'noodles', icon: '🍜', name: 'Instant Noodles', rarity: 'common',
    desc: '+0.9 HP/s regeneration per stack.', },
  { id: 'clips', icon: '📎', name: 'Aggressive Paperclips', rarity: 'common',
    desc: '+2 flat damage per stack.', },
  { id: 'poster', icon: '🖼️', name: 'Motivational Poster', rarity: 'common',
    desc: '+15% XP gain per stack. Hang in there.', },
  // ---- uncommon ----
  { id: 'stocks', icon: '📈', name: 'Stock Options', rarity: 'uncommon',
    desc: '+8% crit chance per stack.', },
  { id: 'overtime', icon: '⏰', name: 'Unpaid Overtime', rarity: 'uncommon',
    desc: '+18% damage per stack. It builds character.', },
  { id: 'card', icon: '💳', name: 'Company Card', rarity: 'uncommon',
    desc: '+25% money from kills per stack.', },
  { id: 'shredder', icon: '🗞️', name: 'Pocket Shredder', rarity: 'uncommon',
    desc: '20% chance to SHRED: bleed for 60% damage over 3s. +60% bleed per extra stack.', },
  { id: 'ethernet', icon: '🔌', name: 'Frayed Ethernet Cable', rarity: 'uncommon',
    desc: '12% chance on hit to zap a chain to 2 nearby enemies (+1 per stack).', },
  { id: 'energy', icon: '🥤', name: 'Zoomer Energy', rarity: 'uncommon',
    desc: 'Dash cooldown -18% per stack.', },
  { id: 'badge', icon: '📛', name: 'Middle Management Badge', rarity: 'uncommon',
    desc: '+25% damage per stack, but −7% move speed. Power has a price.', },
  { id: 'legacy', icon: '💾', name: 'Legacy Codebase', rarity: 'uncommon',
    desc: '+40% max HP per stack, but −10% attack speed. It runs on COBOL.', },
  // ---- rare ----
  { id: 'parachute', icon: '🪂', name: 'Golden Parachute', rarity: 'rare',
    desc: 'Cheat death once per floor and land with 40% HP.', },
  { id: 'redstapler', icon: '🔴', name: 'The Red Stapler', rarity: 'rare',
    desc: 'Crits explode for 120% damage in 4m. Someone set us up the stapler.', },
  { id: 'pen', icon: '🖊️', name: "CEO's Fountain Pen", rarity: 'rare',
    desc: 'All stats +10% per stack. Sign here.', },
  { id: 'espresso', icon: '⚡', name: 'Espresso Machine', rarity: 'rare',
    desc: 'Kills grant +25% attack & move speed for 4s (stacks 5 times).', },
  { id: 'crypto', icon: '🪙', name: 'Crypto Portfolio', rarity: 'rare',
    desc: 'DOUBLE money from kills… but getting hit dumps 10% of your wallet.', },
];

export const ITEM_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

export function rollItem(rng = Math.random, rarityBoost = 0) {
  // 79 / 20 / 1 with optional boost toward better tiers
  const r = rng() * 100;
  const rareCut = 1 + rarityBoost * 4;
  const uncCut = rareCut + 20 + rarityBoost * 16;
  let tier;
  if (r < rareCut) tier = 'rare';
  else if (r < uncCut) tier = 'uncommon';
  else tier = 'common';
  const pool = ITEMS.filter((i) => i.rarity === tier);
  return pool[(rng() * pool.length) | 0];
}

// fold an inventory Map(id -> count) into stat modifiers
export function computeItemMods(counts) {
  const c = (id) => counts.get(id) || 0;
  const penMult = 1 + 0.10 * c('pen');
  return {
    atkSpeedMult: (1 + 0.10 * c('coffee')) * penMult * Math.pow(0.9, c('legacy')),
    damageMult: (1 + 0.18 * c('overtime')) * (1 + 0.25 * c('badge')) * penMult,
    flatDamage: 2 * c('clips'),
    moveMult: (1 + 0.08 * c('gym')) * (1 + (penMult - 1) * 0.5) * Math.pow(0.93, c('badge')),
    maxHpBonus: 25 * c('donuts'),
    hpMult: penMult * (1 + 0.4 * c('legacy')),
    regen: 0.9 * c('noodles'),
    critChance: 0.08 * c('stocks') + (penMult - 1) * 0.3,
    moneyMult: (1 + 0.25 * c('card')) * (c('crypto') > 0 ? 2 : 1),
    xpMult: 1 + 0.15 * c('poster'),
    dashCdMult: Math.pow(0.82, c('energy')),
    bleedChance: c('shredder') > 0 ? 0.2 : 0,
    bleedPower: 0.6 * c('shredder'),
    chainChance: c('ethernet') > 0 ? 0.12 : 0,
    chainCount: c('ethernet') > 0 ? 1 + c('ethernet') : 0,
    critExplode: c('redstapler') > 0,
    critExplodePower: 1.2 * c('redstapler'),
    parachute: c('parachute') > 0,
    espresso: c('espresso') > 0,
    cryptoPortfolio: c('crypto') > 0,
  };
}
