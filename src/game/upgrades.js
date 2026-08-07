// ============ PERFORMANCE REVIEW — level-up upgrade drafts ============
// Every level-up offers 3 cards: generic raises + class-specific evolutions.
// Generic upgrades stack forever; evolutions are tiered and change behavior
// via flags checked in the combat pipeline.

export const GENERIC_UPGRADES = [
  { id: 'raise', icon: '💵', name: 'A Raise', desc: '+14% damage', max: 99, w: 10 },
  { id: 'caffeine', icon: '☕', name: 'Caffeine Drip', desc: '+12% attack speed', max: 99, w: 10 },
  { id: 'cardio', icon: '👟', name: 'Lunchtime Cardio', desc: '+8% move speed', max: 99, w: 9 },
  { id: 'insurance', icon: '🏥', name: 'Health Insurance', desc: '+25 max HP, heal 50%', max: 99, w: 9 },
  { id: 'sharp', icon: '✂️', name: 'Sharpened Pencils', desc: '+8% crit chance', max: 6, w: 8 },
  { id: 'recovery', icon: '🛌', name: 'Work-Life Balance', desc: '+1.1 HP/s regen', max: 6, w: 8 },
  { id: 'learner', icon: '📚', name: 'LinkedIn Course', desc: '+18% XP gain', max: 5, w: 6 },
  { id: 'headstart', icon: '⚡', name: 'Head Start', desc: 'Dash cooldown −16%', max: 4, w: 7 },
];

export const CLASS_EVOLUTIONS = {
  intern: [
    { id: 'doublestapler', icon: '📎', name: 'DUAL WIELD STAPLERS', desc: 'Fire a second staple in a slight spread.', max: 1, w: 6 },
    { id: 'ricochet', icon: '🎯', name: 'RICOCHET CLIPS', desc: 'Staples bounce to a nearby enemy for 60% damage.', max: 1, w: 6 },
    { id: 'redrage', icon: '🔴', name: 'STAPLER ENVY', desc: 'Crits deal +60% bonus damage.', max: 2, w: 5 },
  ],
  janitor: [
    { id: 'wetfloor', icon: '⚠️', name: 'WET FLOOR', desc: 'Swings leave a slowing puddle.', max: 1, w: 6 },
    { id: 'broomwave', icon: '🌊', name: 'DUST STORM', desc: 'Swings launch a piercing shockwave.', max: 1, w: 6 },
    { id: 'riotlid', icon: '🛡️', name: 'RIOT LID', desc: 'Blocking a hit slams attackers back for 150% damage.', max: 1, w: 5 },
  ],
  accountant: [
    { id: 'compound', icon: '📈', name: 'COMPOUND INTEREST', desc: 'Consecutive hits on one target: +4% damage, stacks ×10.', max: 1, w: 6 },
    { id: 'taxbomb', icon: '💣', name: 'TAX BOMB', desc: 'Every 25th shot explodes for 300% damage.', max: 1, w: 6 },
    { id: 'writeoff', icon: '🧾', name: 'CREATIVE WRITE-OFFS', desc: 'Audited enemies drop +60% money.', max: 1, w: 5 },
  ],
  hr: [
    { id: 'fork', icon: '🔱', name: 'CC: EVERYONE', desc: 'Kills with slips release 2 new slips.', max: 1, w: 6 },
    { id: 'bigmeeting', icon: '📅', name: 'ALL-DAY MEETING', desc: 'Meeting zone is larger and damages enemies inside.', max: 1, w: 6 },
    { id: 'finalnotice', icon: '⚰️', name: 'FINAL NOTICE', desc: 'Slips instantly terminate enemies below 15% HP.', max: 1, w: 5 },
  ],
  it: [
    { id: 'bandwidth', icon: '🔌', name: 'EXTRA BANDWIDTH', desc: 'Beam chains to +1 additional target.', max: 2, w: 6 },
    { id: 'hotrouter', icon: '📡', name: 'THERMAL RUNAWAY', desc: 'Routers explode violently when they expire.', max: 1, w: 6 },
    { id: 'overclock', icon: '🔥', name: 'OVERCLOCK', desc: 'Beam ramps up to +100% damage the longer you hold it.', max: 1, w: 5 },
  ],
  sales: [
    { id: 'boomerang', icon: '🪃', name: 'FOLLOW-UP CALL', desc: 'Cards return to you, hitting everything again.', max: 1, w: 6 },
    { id: 'networking', icon: '🤝', name: 'NETWORKING', desc: 'Cold Call hits reset your dash.', max: 1, w: 6 },
    { id: 'commission', icon: '💰', name: 'COMMISSION', desc: 'Kills pay +$1 per current combo count.', max: 1, w: 5 },
  ],
};

export const UPGRADE_BY_ID = (() => {
  const map = {};
  for (const u of GENERIC_UPGRADES) map[u.id] = { ...u, kind: 'generic' };
  for (const list of Object.values(CLASS_EVOLUTIONS)) for (const u of list) map[u.id] = { ...u, kind: 'evolution' };
  return map;
})();

// fold stacked generics into stat modifiers
export function upgradeMods(counts) {
  const c = (id) => counts.get(id) || 0;
  return {
    damageMult: 1 + 0.14 * c('raise'),
    atkSpeedMult: 1 + 0.12 * c('caffeine'),
    moveMult: 1 + 0.08 * c('cardio'),
    maxHpBonus: 25 * c('insurance'),
    critChance: 0.08 * c('sharp'),
    regen: 1.1 * c('recovery'),
    xpMult: 1 + 0.18 * c('learner'),
    dashCdMult: Math.pow(0.84, c('headstart')),
    critDamageBonus: 0.6 * c('redrage'),
  };
}

// draw 3 distinct options for this player
export function rollDraft(player) {
  const counts = player.upgrades;
  const pool = [];
  for (const u of GENERIC_UPGRADES) {
    if ((counts.get(u.id) || 0) < u.max) pool.push({ ...u, kind: 'generic' });
  }
  for (const u of (CLASS_EVOLUTIONS[player.classKey] ?? [])) {
    if ((counts.get(u.id) || 0) < u.max) pool.push({ ...u, kind: 'evolution', w: u.w * 1.15 });
  }
  const picks = [];
  for (let i = 0; i < 3 && pool.length; i++) {
    let total = 0;
    for (const p of pool) total += p.w;
    let r = Math.random() * total;
    let idx = pool.length - 1;
    for (let j = 0; j < pool.length; j++) { r -= pool[j].w; if (r <= 0) { idx = j; break; } }
    picks.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picks;
}
