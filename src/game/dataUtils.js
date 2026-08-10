// ============ /data JSON loading helpers ============
// The tuning tables live in /data/*.json (ROADMAP v0.2 FOUNDATIONS). Two rules
// make hot reload work:
//   1. Hex colors travel as "0x..." strings, because JSON has no hex literals —
//      parseHexData converts them to the numbers the render code expects.
//   2. A reload MUTATES the existing objects in place. Every consumer holds a
//      live reference (TUNE, ENEMY_DEFS, a running enemy's def), so identity
//      must survive the swap — deepApply copies values, never replaces objects.

const HEX_RE = /^0x[0-9a-fA-F]{1,8}$/;

/** Recursively convert "0x..." strings to numbers. Mutates and returns `data`. */
export function parseHexData(data) {
  if (!data || typeof data !== 'object') return data;
  for (const k of Array.isArray(data) ? data.keys() : Object.keys(data)) {
    const v = data[k];
    if (typeof v === 'string' && HEX_RE.test(v)) data[k] = parseInt(v, 16);
    else if (v && typeof v === 'object') parseHexData(v);
  }
  return data;
}

/**
 * Copy `src` onto `target` without replacing object/array identities. Keys the
 * source lacks are left alone — functions, runtime state and the boss defs
 * injected into ENEMY_DEFS all survive a reload untouched.
 */
export function deepApply(target, src) {
  if (Array.isArray(target) && Array.isArray(src) && target.length > src.length) {
    target.length = src.length;
  }
  for (const [k, v] of Object.entries(src)) {
    if (isMergeable(target[k], v)) deepApply(target[k], v);
    else target[k] = v;
  }
  return target;
}

function isMergeable(a, b) {
  return !!a && !!b && typeof a === 'object' && typeof b === 'object'
    && Array.isArray(a) === Array.isArray(b);
}

/** Dev-only console + HUD note after a hot apply. Safe in node (no window). */
export function announceDataReload(name) {
  console.info(`[data] hot-applied ${name}`);
  if (typeof window !== 'undefined') window.game?.hud?.toast?.(`⚙ ${name} reloaded`, 'item');
}
