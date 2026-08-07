// ============ central tuning & content tables ============

export const TUNE = {
  gravity: 26,
  playerJump: 8.8,
  coyoteTime: 0.12,
  jumpBuffer: 0.12,
  groundAccel: 72,
  airAccel: 24,
  groundFriction: 10.5,
  sprintMult: 1.55,
  dashSpeed: 18,
  dashTime: 0.2,
  dashIFrames: 0.26,
  dashCd: 3.6,
  slideBoost: 1.45,
  slideTime: 0.5,
  slideJumpBoost: 1.22,   // slide-to-jump keeps momentum (skill tech)
  momentumTime: 0.55,     // seconds of uncapped speed after a slide-jump
  baseCrit: 0.01,
  // difficulty (Risk of Rain style coefficient)
  diffPerMinute: 0.11,
  diffPerFloor: 0.34,
  diffPerLoop: 0.85,
  enemyHpScale: 0.30,   // per +1 coeff
  enemyDmgScale: 0.16,
  moneyScale: 0.22,
  chestBase: 24,
  chestScale: 0.5,      // price multiplier growth per +1 coeff
  eventDuration: 55,
  eventZoneRadius: 15,
  maxAlive: 42,
  hordeCap: 58,
  levelXpBase: 24,
  levelXpGrowth: 1.30,
  comboWindow: 3.5,     // seconds between kills to keep the combo alive
};

export const DIFF_STAGES = [
  { at: 0.0, label: 'PROBATION' },
  { at: 1.45, label: 'EMPLOYEE OF THE MONTH' },
  { at: 2.0, label: 'MIDDLE MANAGEMENT' },
  { at: 2.7, label: 'CRUNCH TIME' },
  { at: 3.5, label: 'HOSTILE WORKPLACE' },
  { at: 4.5, label: 'SHAREHOLDER MELTDOWN' },
  { at: 6.0, label: 'MARKET COLLAPSE' },
];

// ---- floors ----
// The run starts at street level and climbs the tower to the C.E.O.
export const FLOORS = [
  {
    key: 'lobby', name: 'THE LOBBY', sub: 'GROUND FLOOR — RECEPTION', size: [58, 46],
    palette: {
      floor: 0x8f887b, carpet: 0x7d7669, wall: 0xb3ac9e, accent: 0xc59d45,
      trim: 0x3a362f, fog: 0x35322c, sky: 0xcfe0ee, light: 0xfff4e0, desk: 0x6e5a3f,
    },
    cubicleClusters: 1, deskRows: 6, plants: 12, coolers: 2, vendors: 2, coffeeMachines: 2, alarms: 2,
    chests: 4, karenChance: 0.25,
    bossKey: 'security',
    table: [
      { key: 'paperling', w: 42 },
      { key: 'drone', w: 30 },
      { key: 'printer', w: 10 },
      { key: 'roomba', w: 10 },
      { key: 'quad', w: 5, minDiff: 1.5 },
      { key: 'motivator', w: 3, minDiff: 1.3 },
    ],
  },
  {
    key: 'finance', name: 'FINANCE', sub: 'FLOOR 12', size: [66, 54],
    palette: {
      floor: 0x39414f, carpet: 0x2e3542, wall: 0x8a94a6, accent: 0x27ae60,
      trim: 0x1f2530, fog: 0x232a36, sky: 0x87a6c4, light: 0xfff2d9, desk: 0x8c6b4f,
    },
    cubicleClusters: 7, deskRows: 10, plants: 8, coolers: 3, vendors: 2, coffeeMachines: 3, alarms: 2,
    chests: 5, karenChance: 0.35,
    bossKey: 'cfo',
    table: [
      { key: 'paperling', w: 34 },
      { key: 'drone', w: 30 },
      { key: 'printer', w: 14 },
      { key: 'roomba', w: 12 },
      { key: 'quad', w: 6, minDiff: 1.4 },
      { key: 'copier', w: 4, minDiff: 1.6 },
      { key: 'motivator', w: 5, minDiff: 1.25 },
    ],
  },
  {
    key: 'marketing', name: 'MARKETING', sub: 'FLOOR 23', size: [70, 58],
    palette: {
      floor: 0x3a2f4d, carpet: 0x312647, wall: 0x7e6ba8, accent: 0xff4fa3,
      trim: 0x241c38, fog: 0x2b2140, sky: 0xc98ad1, light: 0xffe0f5, desk: 0x6e4f8c,
    },
    cubicleClusters: 5, deskRows: 8, plants: 12, coolers: 2, vendors: 3, coffeeMachines: 3, alarms: 3,
    chests: 5, karenChance: 0.6,
    bossKey: 'cmo',
    table: [
      { key: 'paperling', w: 26 },
      { key: 'drone', w: 26 },
      { key: 'quad', w: 16 },
      { key: 'printer', w: 12 },
      { key: 'roomba', w: 12 },
      { key: 'copier', w: 8, minDiff: 1.8 },
      { key: 'motivator', w: 7, minDiff: 1.2 },
    ],
  },
  {
    key: 'sales', name: 'SALES', sub: 'FLOOR 38', size: [62, 62],
    palette: {
      floor: 0x1f3242, carpet: 0x1a2a38, wall: 0x5a7d99, accent: 0xff9b2d,
      trim: 0x152230, fog: 0x1b2733, sky: 0xffb36b, light: 0xffe9c9, desk: 0x4f6f8c,
    },
    cubicleClusters: 8, deskRows: 12, plants: 6, coolers: 3, vendors: 2, coffeeMachines: 4, alarms: 3,
    chests: 6, karenChance: 0.75,
    bossKey: 'vp',
    table: [
      { key: 'drone', w: 30 },
      { key: 'paperling', w: 22 },
      { key: 'printer', w: 14 },
      { key: 'quad', w: 14 },
      { key: 'roomba', w: 12 },
      { key: 'copier', w: 10, minDiff: 2.0 },
      { key: 'motivator', w: 8, minDiff: 1.2 },
    ],
  },
  {
    key: 'penthouse', name: 'THE PENTHOUSE', sub: 'FLOOR 101 — EXECUTIVE SUITE', size: [50, 50],
    palette: {
      floor: 0x2b2b33, carpet: 0x3d2f1f, wall: 0x4a4351, accent: 0xffd23f,
      trim: 0x181419, fog: 0x1d1a24, sky: 0x2c2340, light: 0xffe9b0, desk: 0x3a2c1c,
    },
    cubicleClusters: 0, deskRows: 0, plants: 8, coolers: 1, vendors: 1, coffeeMachines: 2, alarms: 0,
    chests: 3, karenChance: 0,
    bossKey: 'ceo', isFinal: true,
    table: [
      { key: 'drone', w: 30 },
      { key: 'paperling', w: 24 },
      { key: 'quad', w: 20 },
      { key: 'printer', w: 12 },
      { key: 'roomba', w: 14 },
      { key: 'copier', w: 12 },
      { key: 'motivator', w: 8 },
    ],
  },
];

// cubicle wall colors per floor
FLOORS[0].palette.cubicle = 0x9a9284;
FLOORS[1].palette.cubicle = 0x5d6b80;
FLOORS[2].palette.cubicle = 0x584a75;
FLOORS[3].palette.cubicle = 0x3e5a73;
FLOORS[4].palette.cubicle = 0x3a3542;

export const ANNOUNCER = {
  hordeLines: ['📠 CONFERENCE CALL INCOMING', '📎 ALL-HANDS MEETING — MANDATORY', '🖨️ THE PRINTERS ARE UNIONIZING', '📋 SURPRISE TEAM-BUILDING EXERCISE'],
  peakLines: ['MANAGEMENT IS WATCHING', 'PRODUCTIVITY REVIEW IN PROGRESS'],
  auditorLine: '🧾 THE AUDITOR HAS ENTERED THE FLOOR',
  karenLine: '⚠️ KAREN PROVOKED — SHE WANTS THE MANAGER',
  eliteTag: { overtime: 'OVERTIME', synergy: 'SYNERGIZED' },
  comboLines: { 5: 'SYNERGY!', 10: 'DOWNSIZING SPREE!', 20: 'RESTRUCTURING!!', 35: 'HOSTILE TAKEOVER!!!', 50: 'MARKET DOMINANCE!!!!' },
};
