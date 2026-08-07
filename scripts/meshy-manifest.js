// ============ J.O.B — Meshy asset manifest ============
// Single source of truth for every 3D asset we generate.
// Derived from docs/MESHY_ASSET_PACK.md v2. Edit prompts HERE, not in the CLI.
//
// Waves gate spend: `pilot` must pass in-engine QA before `wave1` runs.
//   node scripts/meshy.mjs gen --wave pilot

// ---- prompt contract v3 ----
// v2 produced washed-out realistic blobs. Three fixes, all learned the hard way
// (renders archived in docs/asset-qa/, v2 originals in .meshy-cache/):
//   1. NEVER put "no ..." clauses in the positive prompt — the encoder adds what
//      you name. They belong in `negative_prompt`.
//   2. Low-poly comes from `model_type: 'lowpoly'` on meshy-6, not from adjectives.
//   3. A `texture_prompt` saying "no shading, no highlights" bleaches everything
//      to white. State colours positively instead and let the texturer shade.
// Keep the positive suffix SHORT — the 600-char budget belongs to the subject.

export const STYLE_CHARACTER =
  'stylized low-poly game character, chunky faceted planes, bold saturated flat colour blocking, strong readable silhouette';

export const STYLE_PROP =
  'stylized low-poly game prop, chunky faceted planes, bold saturated flat colour blocking, strong readable silhouette';

// Everything we do NOT want goes here, where it actually helps.
export const NEGATIVE = [
  'photorealistic, realistic skin, subsurface scattering',
  'noisy texture, grain, speckles, dirt, scratches',
  'baked shadows, ambient occlusion, specular highlights',
  'washed out, desaturated, pale, white, monochrome, pastel',
  'smooth organic blob, melted, featureless, deformed, blurry',
  'extra limbs, extra fingers, hands in pockets, crossed arms',
  'held weapon, tool in hand, floating parts',
].join(', ');

// Meshy animation-library action ids (docs.meshy.ai animation library reference).
// Keyed by the clip name the engine's AnimationMixer state machine asks for.
export const ANIM_ACTIONS = {
  idle: 0,
  run: 15,          // RunFast
  attack_a: 4,      // Attack
  attack_b: 105,    // Triple_Combo_Attack
  hit: 180,         // Hit_Reaction_1
  death: 8,         // Dead
  taunt: 88,        // Chest_Pound_Taunt
  punch_combo: 96,  // Kung_Fu_Punch
  charge: 112,      // Monster_Walk (heavy forward rush base)
  walk: 30,         // Casual_Walk
};

// The clip set every playable/enemy humanoid ships with. Extra clips are opt-in
// per asset via `anims:` so we don't pay for animations nothing plays yet.
const CORE_ANIMS = ['idle', 'run', 'attack_a', 'hit', 'death'];

export const ASSETS = [
  // ---------- PILOT (3 assets: playable humanoid + enemy humanoid + prop) ----------
  {
    slug: 'intern',
    wave: 'pilot',
    kind: 'character',
    name: 'THE INTERN',
    role: 'player archetype — long range, dual staplers',
    accent: '#FFD23F',
    height: 1.8,
    polycount: 4000,
    prompt: [
      'a skinny young male office intern standing with both arms straight out',
      'to the sides, palms open and empty. Bright mustard-yellow dress shirt',
      'with sleeves rolled past the elbow, dark charcoal trousers, brown shoes.',
      'A large white ID badge hangs from a wide red lanyard on his chest.',
      'A brown satchel bag on his hip stuffed with white paper sheets.',
      'Messy dark brown hair.',
    ].join(' '),
    anims: [...CORE_ANIMS, 'taunt'],
  },
  {
    slug: 'securityguard',
    wave: 'pilot',
    kind: 'character',
    name: 'THE SECURITY GUARD',
    role: 'special enemy — Charger archetype',
    accent: '#2E4A7D',
    height: 2.2,
    polycount: 4500,
    prompt: [
      'a huge burly male security guard standing with both arms straight out to',
      'the sides, palms open and empty. Dark navy-blue uniform shirt with short',
      'sleeves and a gold star badge on the chest, black cargo trousers, black',
      'combat boots. One shoulder is much bigger, capped with a thick black',
      'riot shoulder pad. Black leather utility belt with pouches.',
      'Black mirrored aviator sunglasses, blonde buzzcut hair, square jaw.',
    ].join(' '),
    anims: [...CORE_ANIMS, 'charge'],
  },
  {
    slug: 'elevator_finance',
    wave: 'pilot',
    kind: 'prop',
    name: 'FINANCE ELEVATOR',
    role: 'environment hero prop — floor transition',
    height: 3.2,
    polycount: 5000,
    // v3.1: naming gold for both doors AND trim made the whole prop monochrome
    // gold. Lead with the dominant surface colour, keep gold to named details.
    prompt: [
      'a dark green marble wall panel containing an art-deco elevator entrance.',
      'The wall is deep forest green with cream stone edges. In the centre are',
      'two tall closed silver steel elevator doors, split down the middle.',
      'A small brass semicircle dial sits above the doors. A brass call-button',
      'plate is on the green wall to the right. Green wall, silver doors.',
    ].join(' '),
  },

  // ---------- WAVE 1 — remaining player archetypes ----------
  {
    slug: 'bruiser',
    wave: 'wave1',
    kind: 'character',
    name: 'THE BRUISER',
    role: 'player archetype — melee, fists',
    accent: '#C0392B',
    height: 2.05,
    polycount: 4500,
    prompt: [
      'a massively muscular office worker with a huge V-shaped torso and a small head,',
      'torn white dress shirt with sleeves rolled over enormous forearms,',
      'necktie loosened and hanging crooked, cloth boxing hand-wraps on both fists,',
      'gym shorts worn with formal dress shoes, confident heavy stance,',
      'crimson red and white palette with charcoal accents',
    ].join(' '),
    anims: [...CORE_ANIMS, 'punch_combo', 'charge', 'taunt'],
  },
  {
    slug: 'janitor',
    wave: 'wave1',
    kind: 'character',
    name: 'THE JANITOR',
    role: 'player archetype — melee, reach',
    accent: '#5B6E5F',
    height: 1.8,
    polycount: 4000,
    prompt: [
      'a wiry weathered veteran custodian in olive-green coveralls,',
      'a flat cap, a heavy ring of keys clipped to the belt,',
      'a rolled rag tucked in a pocket, worn work boots,',
      'a round trash-can lid strapped to the left forearm like a buckler shield,',
      'moss green and faded grey palette with dull steel accents',
    ].join(' '),
    anims: CORE_ANIMS,
  },
  {
    slug: 'barista',
    wave: 'wave1',
    kind: 'character',
    name: 'THE BARISTA',
    role: 'player archetype — short range',
    accent: '#8A5A2E',
    height: 1.75,
    polycount: 4000,
    prompt: [
      'an energetic cafe barista, canvas apron over a rolled-sleeve henley shirt,',
      'a steel steam-wand gauntlet clamped over the right forearm with small vent nozzles,',
      'a bandolier of syrup bottles across the chest, messy bun hairstyle, sneakers,',
      'espresso brown and cream palette with polished steel accents',
    ].join(' '),
    anims: CORE_ANIMS,
  },
  {
    slug: 'itsupport',
    wave: 'wave1',
    kind: 'character',
    name: 'IT SUPPORT',
    role: 'player archetype — short range',
    accent: '#38E1FF',
    height: 1.78,
    polycount: 4500,
    prompt: [
      'a hunched tech-support worker in a hoodie worn over a collared shirt,',
      'a wide LED visor strip across the eyes, a backpack-mounted server rack',
      'with tiny antennas and one fan grille, an ethernet cable coiled at the hip,',
      'cargo pants and worn trainers,',
      'cyan and slate grey palette with dark charcoal accents',
    ].join(' '),
    anims: CORE_ANIMS,
  },
  {
    slug: 'analyst',
    wave: 'wave1',
    kind: 'character',
    name: 'THE ANALYST',
    role: 'player archetype — long range, precision',
    accent: '#8E6BC8',
    height: 1.85,
    polycount: 4000,
    prompt: [
      'an icy sharp-suited financial quant in a long tailored duster coat,',
      'a monocle heads-up lens over one eye, a rolled blueprint tube slung on the back,',
      'a pencil tucked behind the ear, narrow tie, polished shoes,',
      'violet and deep charcoal palette with pale silver accents',
    ].join(' '),
    anims: CORE_ANIMS,
  },

  // ---------- WAVE 2 — special enemies ----------
  {
    slug: 'gossip',
    wave: 'wave2',
    kind: 'character',
    name: 'THE GOSSIP',
    height: 1.7,
    polycount: 4000,
    prompt: [
      'a bloated sickly-green office worker swollen to bursting,',
      'a phone permanently pressed to one ear, round blister-like boils',
      'clustered on the shoulders and back, a stretched blouse,',
      'sallow green and dull mauve palette',
    ].join(' '),
    anims: CORE_ANIMS,
  },
  {
    slug: 'complainer',
    wave: 'wave2',
    kind: 'character',
    name: 'THE COMPLAINER',
    height: 1.8,
    polycount: 4000,
    prompt: [
      'a sour hunched office worker clutching an oversized leaking coffee thermos,',
      'dark drip stains down the front of a rumpled cardigan,',
      'a permanent deep scowl, drooping posture,',
      'muddy brown and drab olive palette',
    ].join(' '),
    anims: CORE_ANIMS,
  },
  {
    slug: 'micromanager',
    wave: 'wave2',
    kind: 'character',
    name: 'THE MICROMANAGER',
    height: 1.4,
    polycount: 3500,
    prompt: [
      'a small crouched predatory middle manager coiled to pounce,',
      'enormous round glasses, a red necktie flaring outward,',
      'long clipboard-shaped talon hands, a too-tight waistcoat,',
      'grey and blood red palette',
    ].join(' '),
    anims: CORE_ANIMS,
  },
  {
    slug: 'motivator',
    wave: 'wave2',
    kind: 'character',
    name: 'THE MOTIVATOR',
    height: 1.9,
    polycount: 4000,
    prompt: [
      'a grinning sales-guru motivational speaker with a golden megaphone,',
      'a thin headset microphone, a blazer with sleeves pushed up,',
      'arms flung wide in a rallying pose energy, slick hair,',
      'hot orange and gold palette with white accents',
    ].join(' '),
    anims: [...CORE_ANIMS, 'taunt'],
  },
  {
    slug: 'litigator',
    wave: 'wave2',
    kind: 'character',
    name: 'THE LITIGATOR',
    height: 1.9,
    polycount: 4000,
    prompt: [
      'a gaunt skeletal corporate lawyer, a long red ribbon of bureaucratic tape',
      'coiled in loops around one forearm like a whip, a battered briefcase',
      'held like a shield in the other hand, sunken cheeks, slicked black hair,',
      'black and crimson palette with yellowed paper accents',
    ].join(' '),
    anims: CORE_ANIMS,
  },
  {
    slug: 'stakeholder',
    wave: 'wave2',
    kind: 'character',
    name: 'THE STAKEHOLDER',
    height: 2.6,
    polycount: 4500,
    prompt: [
      'a bull-shaped brute in a pinstripe suit, broad bull horns curving from the skull,',
      'immense hunched shoulders, blocky briefcase-shaped knuckle fists,',
      'a snorting flared muzzle, tiny angry eyes,',
      'charcoal pinstripe and oxblood palette with brass accents',
    ].join(' '),
    anims: [...CORE_ANIMS, 'charge'],
  },
  {
    slug: 'karen',
    wave: 'wave2',
    kind: 'character',
    name: 'KAREN',
    height: 1.75,
    polycount: 4000,
    prompt: [
      'an imposing woman with a towering asymmetric power-bob haircut like a monument,',
      'a cardigan draped over the shoulders like a cape, sunglasses pushed up on the head,',
      'a rigid outraged posture with one arm raised mid-demand,',
      'bleached blonde and pastel teal palette with sharp white accents',
    ].join(' '),
    anims: CORE_ANIMS,
  },
  {
    slug: 'auditor',
    wave: 'wave2',
    kind: 'character',
    name: 'THE AUDITOR',
    height: 3.0,
    polycount: 5000,
    prompt: [
      'a colossal grey stone golem in the shape of a tax auditor,',
      'a business suit stretched over slab-like rock muscles, a thick red ledger',
      'clamped under one arm, a calculator strapped to the wrist,',
      'glowing red reading glasses, a blank granite face,',
      'ash grey and blood red palette',
    ].join(' '),
    anims: CORE_ANIMS,
  },

  // ---------- WAVE 3 — bosses ----------
  {
    slug: 'cfo',
    wave: 'wave3',
    kind: 'character',
    name: 'DEREK KROHN — Head of Finance',
    height: 2.8,
    polycount: 6000,
    prompt: [
      'a towering granite-faced chief financial officer wearing armor built from',
      'stacked gold ledger books, an abacus running down the spine like vertebrae,',
      'knuckles made of rolled coin stacks, a heavy brow, no neck,',
      'gold and dark green palette with granite grey accents',
    ].join(' '),
    anims: [...CORE_ANIMS, 'attack_b', 'taunt'],
  },
  {
    slug: 'cmo',
    wave: 'wave3',
    kind: 'character',
    name: 'BRANDI SPARK — Head of Marketing',
    height: 2.6,
    polycount: 6000,
    prompt: [
      'a dazzling marketing executive in a holographic gradient blazer,',
      'a tall megaphone staff held upright, oversized sunglasses worn as a crown,',
      'angular confetti-shaped fins radiating from the shoulders, sharp heels,',
      'magenta and cyan gradient palette with white accents',
    ].join(' '),
    anims: [...CORE_ANIMS, 'attack_b', 'taunt'],
  },
  {
    slug: 'vp',
    wave: 'wave3',
    kind: 'character',
    name: 'CHAD MAVERICK — Head of Sales',
    height: 2.9,
    polycount: 6000,
    prompt: [
      'a former linebacker turned sales vice president, a blazer stretched over a polo shirt,',
      'a bluetooth earpiece, a chunky gold phone handset gripped in one fist,',
      'shoulder pads built from stacked sales trophies, a square jaw and gelled hair,',
      'royal blue and gold palette with white accents',
    ].join(' '),
    anims: [...CORE_ANIMS, 'charge', 'taunt'],
  },
  {
    slug: 'ceo',
    wave: 'wave3',
    kind: 'character',
    name: 'THE C.E.O.',
    height: 3.4,
    polycount: 8000,
    prompt: [
      'an ancient terrifying corporate executive in an obsidian black suit whose',
      'gold pinstripes trace glowing circuit lines, a floating segmented golden crown,',
      'oversized angular cufflink gauntlets on both wrists, a hollow shadowed face,',
      'obsidian black and gold palette',
    ].join(' '),
    anims: [...CORE_ANIMS, 'attack_b', 'taunt'],
  },
  {
    slug: 'ceo_throne',
    wave: 'wave3',
    kind: 'prop',
    name: 'CEO THRONE',
    height: 2.4,
    polycount: 5000,
    prompt: [
      'an executive office throne mounted on rocket thrusters, a high winged backrest',
      'of black leather panels with gold trim, armrests studded with control levers,',
      'three angular thruster nozzles beneath the seat, a heavy gold base,',
      'obsidian black and gold palette',
    ].join(' '),
  },
];

export const WAVES = ['pilot', 'wave1', 'wave2', 'wave3'];

export function bySlug(slug) {
  return ASSETS.find((a) => a.slug === slug);
}

export function buildPrompt(asset) {
  const style = asset.kind === 'prop' ? STYLE_PROP : STYLE_CHARACTER;
  const full = `${asset.prompt}, ${style}`;
  if (full.length > 600) console.warn(`[manifest] ${asset.slug}: prompt is ${full.length} chars, Meshy caps at 600`);
  return full.slice(0, 600);
}

export function buildNegative(asset) {
  return asset.kind === 'prop'
    ? NEGATIVE.replace('extra limbs, extra fingers, hands in pockets, crossed arms, ', '')
    : NEGATIVE;
}
