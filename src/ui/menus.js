// ============ menu screens ============
import { CLASSES, CLASS_BY_KEY } from '../game/classes.js';
import { PERKS, perkCost } from '../game/meta.js';
import { formatTime } from '../core/utils.js';
import { defaultRelayUrl, fetchRooms } from '../net/net.js';

const root = () => document.getElementById('menu-root');

/** Player and room names arrive from other machines — never inline them raw. */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const glyph = (name, extra = '') => `<i class="g g-${name}${extra ? ` ${extra}` : ''}" aria-hidden="true"></i>`;

const fallbackScript = (className, text) => esc(
  `this.replaceWith(Object.assign(document.createElement("span"),{className:${JSON.stringify(className)},textContent:${JSON.stringify(text)}}))`,
);

const assetImage = ({ className, src, alt = '', width, height, fallbackClass, fallback = '', lazy = true }) => `
  <img class="${className}" src="${src}" alt="${esc(alt)}" width="${width}" height="${height}"
       ${lazy ? 'loading="lazy"' : ''} onerror="${fallbackScript(fallbackClass, fallback)}">`;

const emblem = (c, className = 'ci') => `
  <span class="${className} class-emblem emblem-${c.key}" role="img"
        aria-label="${esc(`${c.name} emblem`)}"></span>`;

const perkIcon = (p) => assetImage({
  className: 'perk-icon',
  src: `/assets/ui/severance/${p.id}@1x.png`,
  alt: `${p.name} icon`,
  width: 64,
  height: 64,
  fallbackClass: 'perk-icon perk-icon-fallback',
  fallback: p.icon,
});

const perkPip = (on) => assetImage({
  className: `perk-pip${on ? ' on' : ''}`,
  src: `/assets/ui/severance/perk-pip-${on ? 'filled' : 'empty'}@1x.png`,
  width: 22,
  height: 6,
  fallbackClass: `perk-pip perk-pip-fallback${on ? ' on' : ''}`,
  lazy: false,
});

const mouseKey = (button) => `<span class="mouse-key mouse-key-${button}" aria-hidden="true"></span>`;
const handbookKey = (label, kind = 'one') => `<kbd class="keycap keycap-${kind}">${label}</kbd>`;

const threatImage = (key, label, fallback) => assetImage({
  className: 'threat-thumb',
  src: `/assets/ui/handbook/threat-${key}@1x.png`,
  alt: `${label} threat emblem`,
  width: 72,
  height: 72,
  fallbackClass: 'threat-thumb threat-fallback',
  fallback,
});

const verdictStamp = (kind, text, win = false) => assetImage({
  className: `verdict-stamp${win ? ' win' : ''}`,
  src: `/assets/ui/verdict/stamp-${kind}@1x.png`,
  alt: text,
  width: 1024,
  height: 420,
  fallbackClass: `big-verdict${win ? ' win' : ''}`,
  fallback: text,
  lazy: false,
});

const jobLogo = () => assetImage({
  className: 'job-logo',
  src: '/assets/ui/logo/job-logo-home@1x.png',
  alt: 'J.O.B. — JUST OBEY BUSINESS',
  width: 720,
  height: 270,
  fallbackClass: 'job-logo job-logo-fallback',
  fallback: 'J.O.B.',
  lazy: false,
});

const statMetric = (kind, label, value, max) => `
  <span class="cstat">
    <i class="stat-glyph stat-glyph-${kind}" aria-hidden="true"></i>
    <span class="stat-copy">${label} <b>${value}</b></span>
    <span class="stat-track"><i style="width:${Math.min(100, Math.round(value / max * 100))}%"></i></span>
  </span>`;

const ROOM_WORDS = ['SYNERGY', 'ALL-HANDS', 'STANDUP', 'OFFSITE', 'QUARTERLY', 'DEADLINE', 'ONBOARDING', 'RETRO'];

export class Menus {
  constructor(game) {
    this.game = game;
    this.selectedClass = 'intern';
  }

  clear() { this.stopRoomPoll(); root().innerHTML = ''; }

  click() { this.game.audio.ensure(); this.game.audio.sfx('ui'); }

  // ---------- title ----------
  showTitle() {
    const meta = this.game.meta;
    this.clear();
    const s = document.createElement('div');
    s.className = 'screen title-screen';
    s.innerHTML = `
      ${jobLogo()}
      <div class="tagline">a corporate roguelite — climb the tower · fire the C.E.O.</div>
      <div class="menu-btns">
        <button class="mbtn primary" data-a="start">${glyph('clock-in')} CLOCK IN (SOLO)</button>
        <button class="mbtn" data-a="mp">${glyph('network')} CO-OP SHIFT (SELF-HOSTED)</button>
        <button class="mbtn" data-a="shop">${glyph('severance')} MOTIVATION — SEVERANCE: ${meta.data.severance}</button>
        <button class="mbtn" data-a="howto">${glyph('handbook')} EMPLOYEE HANDBOOK</button>
        <button class="mbtn" data-a="settings">${glyph('settings')} SETTINGS</button>
      </div>
      <div class="menu-note">runs: ${meta.data.stats.runs} · wins: ${meta.data.stats.wins} · best floor: ${meta.data.stats.bestFloor} · v${__APP_VERSION__}</div>`;
    root().appendChild(s);
    s.addEventListener('click', (e) => {
      const a = e.target?.closest?.('[data-a]')?.dataset?.a;
      if (!a) return;
      this.click();
      if (a === 'start') this.showClassSelect(false);
      if (a === 'mp') this.showLobby();
      if (a === 'shop') this.showMotivation();
      if (a === 'howto') this.showHowTo();
      if (a === 'settings') this.showSettings(() => this.showTitle());
    });
  }

  // ---------- class select ----------
  showClassSelect(isLobby) {
    this.clear();
    const s = document.createElement('div');
    s.className = 'screen';
    const cards = CLASSES.map((c) => `
      <div class="class-card ${c.key === this.selectedClass ? 'sel' : ''}" data-k="${c.key}"
           role="button" tabindex="0" aria-pressed="${c.key === this.selectedClass}">
        ${emblem(c)}
        <h3>${c.name}</h3>
        <div class="ct">${c.title}</div>
        <p>${c.desc}</p>
        <div class="skill-line">${mouseKey('lmb')} ${c.primary.name} · ${mouseKey('rmb')} ${c.secondary.name}</div>
        <div class="skill-line skill-passive">${c.passive}</div>
        <div class="cstats">
          ${statMetric('hp', 'HP', c.hp, 240)}
          ${statMetric('spd', 'SPD', c.speed, 9)}
          ${statMetric('dmg', 'DMG', c.damage, 32)}
        </div>
      </div>`).join('');
    s.innerHTML = `
      <h2>PICK YOUR <em>ROLE</em></h2>
      <div class="class-grid">${cards}</div>
      <div class="menu-btns" style="flex-direction:row; width:auto; gap:14px;">
        <button class="mbtn" data-a="back">${glyph('back')} BACK</button>
        <button class="mbtn primary" data-a="go">${glyph('clock-in')} START SHIFT</button>
      </div>`;
    root().appendChild(s);
    s.addEventListener('click', (e) => {
      const card = e.target.closest('.class-card');
      if (card) {
        this.selectedClass = card.dataset.k;
        s.querySelectorAll('.class-card').forEach((el) => {
          const selected = el.dataset.k === this.selectedClass;
          el.classList.toggle('sel', selected);
          el.setAttribute('aria-pressed', String(selected));
        });
        this.click();
        return;
      }
      const a = e.target?.closest?.('[data-a]')?.dataset?.a;
      if (!a) return;
      this.click();
      if (a === 'back') { if (isLobby) this.showLobby(); else this.showTitle(); }
      if (a === 'go') {
        if (isLobby) this.game.lobbyPickAndStart(this.selectedClass);
        else this.showPartySetup();
      }
    });
    s.addEventListener('keydown', (e) => {
      const card = e.target.closest?.('.class-card');
      if (card && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        card.click();
      }
    });
  }

  // ---------- party setup: solo, or a squad of bots ----------
  // The reason this screen exists: playtesting 4-player pacing otherwise needs
  // three other humans. Bots fill the slots so party dynamics — aggro spread,
  // revive tension, Director team-spread — can be read solo.
  showPartySetup() {
    this.clear();
    const party = this.game.botParty;
    const picked = party.roster.map((r) => r.classKey);
    const s = document.createElement('div');
    s.className = 'screen';

    const slotCard = (i) => {
      const key = picked[i] ?? null;
      const c = key ? CLASS_BY_KEY[key] : null;
      const opts = CLASSES.map((cc) => `<option value="${cc.key}"${cc.key === key ? ' selected' : ''}>${cc.name}</option>`).join('');
      return `
        <div class="bot-slot ${c ? 'on' : 'empty'}" data-slot="${i}">
          <div class="bs-head">TEAMMATE ${i + 1}</div>
          <div class="bs-face">${c ? emblem(c, 'bs-emblem') : glyph('add', 'g-slot')}</div>
          <div class="select-wrap">
            <select class="bs-pick" data-slot="${i}">
              <option value=""${key ? '' : ' selected'}>— EMPTY —</option>
              ${opts}
            </select>
            ${glyph('caret', 'select-caret')}
          </div>
          <div class="bs-note">${c ? c.title : 'no teammate in this slot'}</div>
        </div>`;
    };

    const you = CLASS_BY_KEY[this.selectedClass];
    s.innerHTML = `
      <h2>ASSEMBLE THE <em>TEAM</em></h2>
      <p class="sub">Bots fill the empty desks so you can playtest a full shift alone.
         They fight with the real kits, take real damage, and go down until the next floor.</p>
      <div class="party-row">
        <div class="bot-slot you">
          <div class="bs-head">YOU</div>
          <div class="bs-face">${emblem(you, 'bs-emblem')}</div>
          <div class="bs-name">${you.name}</div>
          <div class="bs-note">${you.title}</div>
        </div>
        ${[0, 1, 2].map(slotCard).join('')}
      </div>
      <div class="menu-btns" style="flex-direction:row; width:auto; gap:12px; flex-wrap:wrap; justify-content:center;">
        <button class="mbtn" data-a="back">${glyph('back')} ROLE</button>
        <button class="mbtn" data-a="solo">${glyph('clock-in')} SOLO SHIFT</button>
        <button class="mbtn" data-a="fill"><i class="party-autofill" aria-hidden="true"></i> AUTO-FILL SQUAD</button>
        <button class="mbtn primary" data-a="go">${glyph('clock-in')} START SHIFT</button>
      </div>`;
    root().appendChild(s);

    const commit = () => {
      const keys = [...s.querySelectorAll('.bs-pick')].map((el) => el.value).filter(Boolean);
      party.setRoster(keys);
    };

    s.addEventListener('change', (e) => {
      if (!e.target.classList.contains('bs-pick')) return;
      this.click();
      commit();
      this.showPartySetup();       // redraw so the icon and title track the pick
    });

    s.addEventListener('click', (e) => {
      const a = e.target?.closest?.('[data-a]')?.dataset?.a;
      if (!a) return;
      this.click();
      if (a === 'back') { this.showClassSelect(false); return; }
      if (a === 'solo') { party.setRoster([]); this.game.startRun(this.selectedClass); return; }
      if (a === 'fill') {
        party.setRoster(party.suggestRoster(3, this.selectedClass));
        this.showPartySetup();
        return;
      }
      if (a === 'go') { commit(); this.game.startRun(this.selectedClass); }
    });
  }

  // ---------- motivation (meta shop) ----------
  showMotivation() {
    const meta = this.game.meta;
    this.clear();
    const s = document.createElement('div');
    s.className = 'screen';
    const rows = PERKS.map((p) => {
      const lvl = meta.perkLevel(p.id);
      const maxed = lvl >= p.max;
      const cost = perkCost(lvl);
      const affordable = meta.data.severance >= cost;
      const rowState = maxed ? 'maxed' : (affordable ? 'affordable' : 'unaffordable');
      const pips = Array.from({ length: p.max }, (_, i) => perkPip(i < lvl)).join('');
      return `<div class="perk-row ${rowState}">
        <div class="pi">${perkIcon(p)}</div>
        <div class="pmain">
          <div class="pname">${p.name}</div>
          <div class="pdesc">${p.desc}</div>
          <div class="perk-lvl">${pips}</div>
        </div>
        <button class="mbtn perk-buy" data-p="${p.id}" ${maxed || meta.data.severance < cost ? 'disabled' : ''}>
          ${maxed ? 'MAXED' : `$${cost}`}
        </button>
      </div>`;
    }).join('');
    s.innerHTML = `
      <h2>${glyph('severance')} <em>MOTIVATION</em> DEPT.</h2>
      <div class="sev-balance">SEVERANCE BALANCE: $${meta.data.severance}</div>
      <div class="shop-wrap">${rows}</div>
      <button class="mbtn" data-a="back">${glyph('back')} BACK</button>
      <div class="back-hint">Severance is earned every run: kills, floors cleared, bosses fired.</div>`;
    root().appendChild(s);
    s.addEventListener('click', (e) => {
      const target = e.target?.closest?.('[data-p], [data-a]');
      const pid = target?.dataset?.p;
      if (pid) {
        if (meta.buyPerk(pid)) { this.game.audio.sfx('buy'); this.showMotivation(); }
        return;
      }
      if (target?.dataset?.a === 'back') { this.click(); this.showTitle(); }
    });
  }

  // ---------- how to play ----------
  showHowTo() {
    this.clear();
    const s = document.createElement('div');
    s.className = 'screen';
    s.innerHTML = `
      <h2>EMPLOYEE <em>HANDBOOK</em></h2>
      <div class="howto">
        <h4>CONTROLS</h4>
        <p>${handbookKey('W A S D', 'wide')} move · ${handbookKey('Shift', 'wide')} sprint ·
        ${handbookKey('Space', 'wide')} jump · ${handbookKey('Ctrl', 'wide')}/${handbookKey('C')} slide ·
        ${handbookKey('Q')} coffee dash (i-frames) · ${handbookKey('V')} first/third person ·
        ${handbookKey('E')} interact · ${handbookKey('Esc')} pause</p>
        <p>${handbookKey('LMB', 'mouse')} primary attack · ${handbookKey('RMB', 'mouse-r')} class ability</p>
        <h4>YOUR SHIFT</h4>
        <ul>
          <li>Kill coworkers-gone-feral for <b>$</b> and XP. Buy <b>supply crates</b> for stacking items.</li>
          <li>Find the <b>elevator</b> and call it — then survive the holdout. The Department Head arrives with it.</li>
          <li>Fire the Head, board the elevator, climb toward the <b>C.E.O.</b> on Floor 101.</li>
          <li>The longer your shift runs, the angrier the office. The clock never stops.</li>
        </ul>
        <h4>KNOWN TROUBLEMAKERS</h4>
        <ul class="threat-list">
          <li>${threatImage('gossip', 'The Gossip', '🟢')}<span><b>The Gossip</b> — pops into rumor gas that marks you. The whole office comes running.</span></li>
          <li>${threatImage('complainer', 'The Complainer', '☕')}<span><b>The Complainer</b> — lobs scalding coffee. Don't stand in it.</span></li>
          <li>${threatImage('micromanager', 'The Micromanager', '👓')}<span><b>The Micromanager</b> — pounces and rides you. Mash ${handbookKey('Space', 'wide')} or dash to shake them off.</span></li>
          <li>${threatImage('karen', 'KAREN', '💇')}<span><b>KAREN</b> — minding her own business. KEEP IT THAT WAY. (Or don't. She drops big money.)</span></li>
          <li>${threatImage('auditor', 'The Auditor', '🧾')}<span><b>THE AUDITOR</b> — a walking severance package. Run, then kite.</span></li>
        </ul>
      </div>
      <button class="mbtn" data-a="back">${glyph('back')} BACK</button>`;
    root().appendChild(s);
    s.addEventListener('click', (e) => {
      if (e.target?.closest?.('[data-a]')?.dataset?.a === 'back') { this.click(); this.showTitle(); }
    });
  }

  // ---------- settings ----------
  showSettings(onBack) {
    const st = this.game.meta.settings;
    this.clear();
    const s = document.createElement('div');
    s.className = 'screen overlay';
    s.innerHTML = `
      <h2>${glyph('settings')} <em>SETTINGS</em></h2>
      <div class="set-row"><label>Mouse sensitivity</label><input type="range" id="set-sens" min="0.2" max="3" step="0.05" value="${st.sensitivity}"><span class="set-val" id="v-sens">${st.sensitivity.toFixed(2)}</span></div>
      <div class="set-row"><label>Invert Y</label><input type="checkbox" id="set-inv" ${st.invertY ? 'checked' : ''}></div>
      <div class="set-row"><label>Field of view</label><input type="range" id="set-fov" min="60" max="110" step="1" value="${st.fov}"><span class="set-val" id="v-fov">${st.fov}</span></div>
      <div class="set-row"><label>Master volume</label><input type="range" id="set-vm" min="0" max="1" step="0.05" value="${st.volMaster}"><span class="set-val" id="v-vm">${Math.round(st.volMaster * 100)}%</span></div>
      <div class="set-row"><label>SFX volume</label><input type="range" id="set-vs" min="0" max="1" step="0.05" value="${st.volSfx}"><span class="set-val" id="v-vs">${Math.round(st.volSfx * 100)}%</span></div>
      <div class="set-row"><label>Music volume</label><input type="range" id="set-vmu" min="0" max="1" step="0.05" value="${st.volMusic}"><span class="set-val" id="v-vmu">${Math.round(st.volMusic * 100)}%</span></div>
      <div style="height:16px"></div>
      <button class="mbtn" data-a="back">${glyph('back')} DONE</button>`;
    root().appendChild(s);
    const bind = (id, key, fmt, apply) => {
      const el = s.querySelector('#' + id);
      const syncRange = () => {
        if (el.type !== 'range') return;
        const min = Number(el.min);
        const max = Number(el.max);
        const percent = max === min ? 0 : (Number(el.value) - min) / (max - min) * 100;
        el.style.setProperty('--range-fill', `${percent}%`);
      };
      syncRange();
      el.addEventListener('input', () => {
        const v = el.type === 'checkbox' ? el.checked : parseFloat(el.value);
        syncRange();
        st[key] = v;
        if (fmt) fmt(v);
        if (apply) apply(v);
        this.game.meta.save();
      });
    };
    bind('set-sens', 'sensitivity', (v) => s.querySelector('#v-sens').textContent = v.toFixed(2));
    bind('set-inv', 'invertY');
    bind('set-fov', 'fov', (v) => s.querySelector('#v-fov').textContent = v, (v) => this.game.setFov(v));
    bind('set-vm', 'volMaster', (v) => s.querySelector('#v-vm').textContent = Math.round(v * 100) + '%', (v) => this.game.audio.setVolume('master', v));
    bind('set-vs', 'volSfx', (v) => s.querySelector('#v-vs').textContent = Math.round(v * 100) + '%', (v) => { this.game.audio.setVolume('sfx', v); this.game.audio.sfx('coin'); });
    bind('set-vmu', 'volMusic', (v) => s.querySelector('#v-vmu').textContent = Math.round(v * 100) + '%', (v) => this.game.audio.setVolume('music', v));
    s.addEventListener('click', (e) => {
      if (e.target?.closest?.('[data-a]')?.dataset?.a === 'back') { this.click(); this.clear(); onBack(); }
    });
  }

  // ---------- pause ----------
  showPause() {
    this.clear();
    const s = document.createElement('div');
    s.className = 'screen overlay';
    s.innerHTML = `
      <h2 class="pause-title">ON <em>BREAK</em></h2>
      <div class="menu-btns">
        <button class="mbtn primary" data-a="resume">${glyph('clock-in')} BACK TO WORK</button>
        <button class="mbtn" data-a="settings">${glyph('settings')} SETTINGS</button>
        <button class="mbtn danger" data-a="quit">${glyph('quit')} RAGE QUIT (ABANDON RUN)</button>
      </div>`;
    root().appendChild(s);
    s.addEventListener('click', (e) => {
      const a = e.target?.closest?.('[data-a]')?.dataset?.a;
      if (!a) return;
      this.click();
      if (a === 'resume') this.game.togglePause(false);
      if (a === 'settings') this.showSettings(() => this.showPause());
      if (a === 'quit') this.game.abandonRun();
    });
  }

  // ---------- death / victory ----------
  showDeath(stats) {
    this.clear();
    const s = document.createElement('div');
    s.className = 'screen';
    s.innerHTML = `
      ${verdictStamp('fired', "YOU'RE FIRED.")}
      <div class="verdict-sub">cause of termination: ${esc(stats.cause)}</div>
      <div class="run-stats">
        <div><div class="rs-v">${formatTime(stats.time)}</div><div class="rs-k">shift length</div></div>
        <div><div class="rs-v">${stats.kills}</div><div class="rs-k">downsized</div></div>
        <div><div class="rs-v">${esc(stats.floorName)}</div><div class="rs-k">reached</div></div>
        <div><div class="rs-v">$${Math.floor(stats.money)}</div><div class="rs-k">unspent budget</div></div>
      </div>
      <div class="sev-earn">+$${stats.severance} SEVERANCE DEPOSITED</div>
      <div class="menu-btns">
        <button class="mbtn primary" data-a="retry">${glyph('retry')} RE-APPLY (SAME ROLE)</button>
        <button class="mbtn" data-a="menu">${glyph('home')} MAIN MENU</button>
      </div>`;
    root().appendChild(s);
    s.addEventListener('click', (e) => {
      const a = e.target?.closest?.('[data-a]')?.dataset?.a;
      if (!a) return;
      this.click();
      if (a === 'retry') this.game.startRun(this.selectedClass);
      if (a === 'menu') this.game.toTitle();
    });
  }

  showVictory(stats) {
    this.clear();
    const s = document.createElement('div');
    s.className = 'screen';
    s.innerHTML = `
      ${verdictStamp('promoted', 'PROMOTED.', true)}
      <div class="verdict-sub">the C.E.O. has been… restructured. the tower is yours.<br>…so who's going to do all the work now?</div>
      <div class="run-stats">
        <div><div class="rs-v">${formatTime(stats.time)}</div><div class="rs-k">shift length</div></div>
        <div><div class="rs-v">${stats.kills}</div><div class="rs-k">downsized</div></div>
        <div><div class="rs-v">${stats.loops + 1}</div><div class="rs-k">tower loops</div></div>
        <div><div class="rs-v">$${Math.floor(stats.money)}</div><div class="rs-k">war chest</div></div>
      </div>
      <div class="sev-earn">+$${stats.severance} SEVERANCE DEPOSITED</div>
      <div class="menu-btns">
        <button class="mbtn primary" data-a="endless">${glyph('loop')} KEEP GRINDING (LOOP — HARDER)</button>
        <button class="mbtn" data-a="menu">${glyph('home')} RETIRE TO MENU</button>
      </div>`;
    root().appendChild(s);
    s.addEventListener('click', (e) => {
      const a = e.target?.closest?.('[data-a]')?.dataset?.a;
      if (!a) return;
      this.click();
      if (a === 'endless') this.game.continueEndless();
      if (a === 'menu') this.game.toTitle();
    });
  }

  // ---------- multiplayer lobby ----------
  /** Poll the relay's directory so hosted shifts show up without anyone typing an IP. */
  startRoomPoll() {
    this.stopRoomPoll();
    const tick = async () => {
      try {
        this.rooms = await fetchRooms();
        this.roomsErr = null;
      } catch {
        this.rooms = [];
        this.roomsErr = 'No relay on this address. Open the link the host shared — not a file:// or a stale tab.';
      }
      this.renderRoomList();
    };
    tick();
    this._roomPoll = setInterval(tick, 2000);
  }

  stopRoomPoll() {
    if (this._roomPoll) clearInterval(this._roomPoll);
    this._roomPoll = null;
  }

  /** Repaint only the list, so polling never steals focus from the name field. */
  renderRoomList() {
    const box = document.getElementById('room-list');
    if (!box) { this.stopRoomPoll(); return; }
    const rooms = this.rooms ?? [];
    if (this.roomsErr) { box.innerHTML = `<div class="lr empty roster-row"><span>${esc(this.roomsErr)}</span></div>`; return; }
    if (!rooms.length) {
      box.innerHTML = '<div class="lr empty roster-row"><span>— no shifts running on this network —</span></div>';
      return;
    }
    box.innerHTML = rooms.map((r) => {
      const full = r.players >= r.max;
      const label = r.inRun ? 'IN PROGRESS' : 'WAITING';
      const state = full ? 'full' : (r.inRun ? 'in-run' : 'waiting');
      return `
        <div class="lr room room-${state} ${full ? 'full' : ''}" ${full ? '' : `data-a="joinroom" data-room="${esc(r.room)}"`}>
          <span class="rn">${esc(r.room)}</span>
          <span class="rh">hosted by ${esc(r.host)}</span>
          <span class="rp">${esc(r.players)}/${esc(r.max)}</span>
          <span class="tag tag-${full ? 'full' : (r.inRun ? 'run' : 'waiting')}">${glyph('live')} ${full ? 'FULL' : label}</span>
        </div>`;
    }).join('');
  }

  /** A room code nobody has to invent, and that will not collide with a live one. */
  freeRoomCode() {
    const taken = new Set((this.rooms ?? []).map((r) => r.room));
    for (const w of ROOM_WORDS) if (!taken.has(w)) return w;
    for (let i = 2; ; i++) {
      const c = `${ROOM_WORDS[0]}-${i}`;
      if (!taken.has(c)) return c;
    }
  }

  showLobby() {
    const g = this.game;
    this.clear();
    const s = document.createElement('div');
    s.className = 'screen';
    const st = g.meta.settings;
    const roster = g.net?.roster ?? [];
    const inLobby = !!g.net?.connected;
    const rosterHtml = roster.map((r) => `
      <div class="lr roster-row"><span>${esc(r.name)} ${r.cls ? `· ${esc(r.cls.toUpperCase())}` : ''}</span><span class="tag tag-${r.host ? 'host' : 'guest'}">${glyph(r.host ? 'host' : 'guest')} ${r.host ? 'HOST' : 'GUEST'}</span></div>`).join('')
      || '<div class="lr roster-row"><span>— empty —</span></div>';
    const statusText = g.net?.status || 'Pick a shift below, or start one and let the others walk in.';
    const statusState = /error|failed|closed|lost/i.test(statusText) ? 'error' : (inLobby ? 'connecting' : 'idle');
    s.innerHTML = `
      <h2>${glyph('network')} CO-OP <em>SHIFT</em></h2>
      <div class="mp-status status-${statusState}">${esc(statusText)}</div>
      ${inLobby ? `
        <div class="lobby-roster">${rosterHtml}</div>
        <div class="menu-btns">
          <button class="mbtn primary" data-a="pick">${glyph('role')} PICK ROLE ${g.net.isHost ? '& START' : '(READY UP)'}</button>
          <button class="mbtn" data-a="leave">${glyph('close')} LEAVE LOBBY</button>
        </div>` : `
        <div class="mp-box">
          <input type="text" id="mp-name" placeholder="YOUR NAME" maxlength="14" value="${esc(st.playerName)}">
        </div>
        <div class="room-head">OPEN SHIFTS ON THIS NETWORK <span class="live">${glyph('live')} live</span></div>
        <div class="lobby-roster room-list" id="room-list"></div>
        <div class="menu-btns">
          <button class="mbtn primary" data-a="host">${glyph('network')} START A NEW SHIFT</button>
          <button class="mbtn" data-a="back">${glyph('back')} BACK</button>
        </div>
        <details class="mp-adv">
          <summary>${glyph('caret')} advanced — connect to a relay somewhere else</summary>
          <div class="mp-box">
            <input type="text" id="mp-url" placeholder="relay url" value="${esc(g.lastRelayUrl ?? defaultRelayUrl())}">
            <input type="text" id="mp-room" placeholder="ROOM CODE" maxlength="12" value="${esc(g.lastRoom ?? 'SYNERGY')}">
            <button class="mbtn" data-a="join">${glyph('connect')} CONNECT MANUALLY</button>
          </div>
        </details>
        <div class="back-hint">Everyone opens the same link the host shared. Shifts appear here on their own.</div>`}
    `;
    root().appendChild(s);
    if (!inLobby) this.startRoomPoll();

    const myName = () => {
      const name = s.querySelector('#mp-name')?.value.trim() || 'WAGE_SLAVE';
      st.playerName = name;
      g.meta.save();
      return name;
    };

    s.addEventListener('click', (e) => {
      const el = e.target?.closest?.('[data-a]');
      const a = el?.dataset?.a;
      if (!a) return;
      this.click();
      if (a === 'back') this.showTitle();
      if (a === 'joinroom') g.netConnect(defaultRelayUrl(), el.dataset.room, myName());
      if (a === 'host') g.netConnect(defaultRelayUrl(), this.freeRoomCode(), myName());
      if (a === 'join') {
        const url = s.querySelector('#mp-url').value.trim() || defaultRelayUrl();
        const room = s.querySelector('#mp-room').value.trim().toUpperCase() || 'SYNERGY';
        g.netConnect(url, room, myName());
      }
      if (a === 'leave') { g.netDisconnect(); this.showLobby(); }
      if (a === 'pick') this.showClassSelect(true);
    });
  }
}
