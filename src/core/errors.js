// ============ crash handling ============
// A WebGL game that throws inside requestAnimationFrame dies silently: the
// canvas freezes on the last frame and the player has no idea whether the game
// crashed, hung, or is loading. On Steam that is a refund.
//
// This does three things:
//   1. Catches uncaught errors and rejections and shows a readable panel with a
//      one-click copyable report instead of a frozen screen.
//   2. Keeps a ring buffer of the last console lines so the report has context.
//   3. Detects a stalled render loop (watchdog) — the case where nothing threw
//      but the loop stopped ticking, e.g. a WebGL context loss.
//
// Reports are local-only. Nothing leaves the machine.

const LOG_RING = 120;

export class CrashHandler {
  constructor() {
    this.log = [];
    this.shown = false;
    this.version = 'dev';
    this._gpu = null;
    this.buildInfo = {};
    this.getState = null;      // injected: () => ({...}) game snapshot for the report
    this._lastBeat = performance.now();
    this._watchdog = null;
  }

  /** @param {{version?: string, getState?: () => any}} opts */
  install({ version = 'dev', getState = null } = {}) {
    this.version = version;
    this.getState = getState;

    this._patchConsole();

    // A hidden tab has its rAF loop throttled or stopped entirely, which is not
    // a crash. Treat becoming visible as a fresh heartbeat so the watchdog does
    // not fire on the frame after an alt-tab.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this._lastBeat = performance.now();
    });

    addEventListener('error', (e) => {
      // resource load failures have no `error` object and are not fatal
      if (!e.error) return;
      this.report(e.error, 'uncaught error');
    });
    addEventListener('unhandledrejection', (e) => {
      this.report(e.reason, 'unhandled promise rejection');
    });

    const canvas = document.getElementById('game-canvas');
    canvas?.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.report(new Error('WebGL context lost — the GPU driver reset or ran out of memory.'), 'gpu');
    });
  }

  _patchConsole() {
    for (const level of ['warn', 'error']) {
      const orig = console[level].bind(console);
      console[level] = (...args) => {
        this.push(level, args);
        orig(...args);
      };
    }
  }

  push(level, args) {
    this.log.push({
      t: +(performance.now() / 1000).toFixed(2),
      level,
      msg: args.map((a) => {
        if (a instanceof Error) return `${a.name}: ${a.message}`;
        if (typeof a === 'object') { try { return JSON.stringify(a).slice(0, 200); } catch { return '[object]'; } }
        return String(a);
      }).join(' '),
    });
    if (this.log.length > LOG_RING) this.log.shift();
  }

  /** Call once per rendered frame; the watchdog uses it to detect a dead loop. */
  heartbeat() { this._lastBeat = performance.now(); }

  startWatchdog(timeoutMs = 10000) {
    clearInterval(this._watchdog);
    this._watchdog = setInterval(() => {
      if (this.shown || document.hidden) return;
      const stalled = performance.now() - this._lastBeat;
      if (stalled > timeoutMs) {
        this.report(
          new Error(`Render loop stalled for ${(stalled / 1000).toFixed(1)}s.`),
          'watchdog',
        );
      }
    }, 2000);
  }

  /** Environment is read at REPORT time — at install time the canvas may be 0x0. */
  environment() {
    return {
      version: this.version ?? 'dev',
      ua: navigator.userAgent,
      lang: navigator.language,
      screen: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
      cores: navigator.hardwareConcurrency ?? '?',
      memory: navigator.deviceMemory ? `${navigator.deviceMemory}GB` : '?',
      renderer: this._gpu ?? '?',
    };
  }

  /** Called once by the game with the live WebGL renderer info. */
  noteGpu(rendererInfo) { this._gpu = rendererInfo; }

  buildReport(err, kind) {
    this.buildInfo = this.environment();
    return {
      kind,
      when: new Date().toISOString(),
      error: {
        name: err?.name ?? 'Error',
        message: err?.message ?? String(err),
        stack: (err?.stack ?? '').split('\n').slice(0, 24).join('\n'),
      },
      build: this.buildInfo,
      state: safeCall(this.getState),
      log: this.log.slice(-40),
    };
  }

  report(err, kind = 'error') {
    this.push('error', [err]);
    if (this.shown) return;              // first crash wins; don't stack panels
    this.shown = true;
    const report = this.buildReport(err, kind);
    console.error('[crash]', report);
    try { this._render(report); } catch { /* the overlay itself failed; nothing more we can do */ }
  }

  _render(report) {
    document.exitPointerLock?.();
    const el = document.createElement('div');
    el.className = 'crash-overlay';
    el.innerHTML = `
      <div class="crash-card">
        <h1>THE OFFICE HAS CRASHED</h1>
        <p class="crash-sub">An unexpected error stopped the game. Your meta-progress is saved.</p>
        <pre class="crash-stack"></pre>
        <div class="crash-actions">
          <button data-act="copy">Copy report</button>
          <button data-act="reload">Reload</button>
          <button data-act="dismiss">Try to continue</button>
        </div>
        <p class="crash-foot">v${escapeHtml(report.build.version)} · ${escapeHtml(report.build.screen)} · ${escapeHtml(report.build.renderer)}</p>
      </div>`;
    el.querySelector('.crash-stack').textContent =
      `${report.error.name}: ${report.error.message}\n\n${report.error.stack}`;

    el.addEventListener('click', (e) => {
      const act = e.target?.dataset?.act;
      if (act === 'copy') {
        navigator.clipboard?.writeText(JSON.stringify(report, null, 2));
        e.target.textContent = 'Copied ✓';
      } else if (act === 'reload') {
        location.reload();
      } else if (act === 'dismiss') {
        el.remove();
        this.shown = false;
        this._lastBeat = performance.now();
      }
    });
    document.body.appendChild(el);
  }
}

function safeCall(fn) {
  if (typeof fn !== 'function') return null;
  try { return fn(); } catch (err) { return { stateError: String(err?.message ?? err) }; }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export const crashHandler = new CrashHandler();
