// Tiny module on purpose: game.js needs the flag at boot, but must NOT pull the
// whole tweakpane panel (and its transitive content-table imports) into the main
// bundle. The panel itself is dynamic-imported only when this returns true.

export function debugEnabled() {
  try {
    return !!import.meta.env?.DEV || localStorage.getItem('job.debug') === '1';
  } catch {
    return !!import.meta.env?.DEV;
  }
}
