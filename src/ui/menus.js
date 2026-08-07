// ============ menu screens ============
import { CLASSES } from '../game/classes.js';
import { PERKS, perkCost } from '../game/meta.js';
import { formatTime } from '../core/utils.js';

const root = () => document.getElementById('menu-root');

export class Menus {
  constructor(game) {
    this.game = game;
    this.selectedClass = 'intern';
  }

  clear() { root().innerHTML = ''; }

  click() { this.game.audio.ensure(); this.game.audio.sfx('ui'); }

  // ---------- title ----------
  showTitle() {
    const meta = this.game.meta;
    this.clear();
    const s = document.createElement('div');
    s.className = 'screen';
    s.innerHTML = `
      <img class="job-logo" src="/assets/ui/logo/job-logo-full@1x.png" alt="J.O.B. — JUST OBEY BUSINESS" width="720" height="270">
      <div class="tagline">a corporate roguelite — climb the tower · fire the C.E.O.</div>
      <div class="menu-btns">
        <button class="mbtn primary" data-a="start">▶ CLOCK IN (SOLO)</button>
        <button class="mbtn" data-a="mp">🌐 CO-OP SHIFT (SELF-HOSTED)</button>
        <button class="mbtn" data-a="shop">💵 MOTIVATION — SEVERANCE: ${meta.data.severance}</button>
        <button class="mbtn" data-a="howto">📋 EMPLOYEE HANDBOOK</button>
        <button class="mbtn" data-a="settings">⚙ SETTINGS</button>
      </div>
      <div class="menu-note">runs: ${meta.data.stats.runs} · wins: ${meta.data.stats.wins} · best floor: ${meta.data.stats.bestFloor} · v0.1 prototype</div>`;
    root().appendChild(s);
    s.addEventListener('click', (e) => {
      const a = e.target?.dataset?.a;
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
      <div class="class-card ${c.key === this.selectedClass ? 'sel' : ''}" data-k="${c.key}">
        <span class="ci">${c.icon}</span>
        <h3>${c.name}</h3>
        <div class="ct">${c.title}</div>
        <p>${c.desc}</p>
        <div class="skill-line"><b>LMB</b> ${c.primary.name} · <b>RMB</b> ${c.secondary.name}</div>
        <div class="skill-line" style="color:#8fa0b3">${c.passive}</div>
        <div class="cstats"><span>HP <b>${c.hp}</b></span><span>SPD <b>${c.speed}</b></span><span>DMG <b>${c.damage}</b></span></div>
      </div>`).join('');
    s.innerHTML = `
      <h2>PICK YOUR <em>ROLE</em></h2>
      <div class="class-grid">${cards}</div>
      <div class="menu-btns" style="flex-direction:row; width:auto; gap:14px;">
        <button class="mbtn" data-a="back">← BACK</button>
        <button class="mbtn primary" data-a="go">START SHIFT →</button>
      </div>`;
    root().appendChild(s);
    s.addEventListener('click', (e) => {
      const card = e.target.closest('.class-card');
      if (card) {
        this.selectedClass = card.dataset.k;
        s.querySelectorAll('.class-card').forEach((el) => el.classList.toggle('sel', el.dataset.k === this.selectedClass));
        this.click();
        return;
      }
      const a = e.target?.dataset?.a;
      if (!a) return;
      this.click();
      if (a === 'back') { if (isLobby) this.showLobby(); else this.showTitle(); }
      if (a === 'go') {
        if (isLobby) this.game.lobbyPickAndStart(this.selectedClass);
        else this.game.startRun(this.selectedClass);
      }
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
      const pips = Array.from({ length: p.max }, (_, i) => `<span class="${i < lvl ? 'on' : ''}"></span>`).join('');
      return `<div class="perk-row">
        <div class="pi">${p.icon}</div>
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
      <h2>💵 <em>MOTIVATION</em> DEPT.</h2>
      <div class="sev-balance">SEVERANCE BALANCE: $${meta.data.severance}</div>
      <div class="shop-wrap">${rows}</div>
      <button class="mbtn" data-a="back">← BACK</button>
      <div class="back-hint">Severance is earned every run: kills, floors cleared, bosses fired.</div>`;
    root().appendChild(s);
    s.addEventListener('click', (e) => {
      const pid = e.target?.dataset?.p;
      if (pid) {
        if (meta.buyPerk(pid)) { this.game.audio.sfx('buy'); this.showMotivation(); }
        return;
      }
      if (e.target?.dataset?.a === 'back') { this.click(); this.showTitle(); }
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
        <p><kbd>W A S D</kbd> move · <kbd>Shift</kbd> sprint · <kbd>Space</kbd> jump · <kbd>Ctrl</kbd>/<kbd>C</kbd> slide ·
        <kbd>Q</kbd> coffee dash (i-frames) · <kbd>V</kbd> first/third person · <kbd>E</kbd> interact · <kbd>Esc</kbd> pause</p>
        <p><kbd>LMB</kbd> primary attack · <kbd>RMB</kbd> class ability</p>
        <h4>YOUR SHIFT</h4>
        <ul>
          <li>Kill coworkers-gone-feral for <b>$</b> and XP. Buy <b>supply crates</b> for stacking items.</li>
          <li>Find the <b>elevator</b> and call it — then survive the holdout. The Department Head arrives with it.</li>
          <li>Fire the Head, board the elevator, climb toward the <b>C.E.O.</b> on Floor 101.</li>
          <li>The longer your shift runs, the angrier the office. The clock never stops.</li>
        </ul>
        <h4>KNOWN TROUBLEMAKERS</h4>
        <ul>
          <li><b>The Gossip</b> 🟢 — pops into rumor gas that marks you. The whole office comes running.</li>
          <li><b>The Complainer</b> ☕ — lobs scalding coffee. Don't stand in it.</li>
          <li><b>The Micromanager</b> 👓 — pounces and rides you. Mash <kbd>Space</kbd> or dash to shake them off.</li>
          <li><b>KAREN</b> 💇 — minding her own business. KEEP IT THAT WAY. (Or don't. She drops big money.)</li>
          <li><b>THE AUDITOR</b> 🧾 — a walking severance package. Run, then kite.</li>
        </ul>
      </div>
      <button class="mbtn" data-a="back">← BACK</button>`;
    root().appendChild(s);
    s.addEventListener('click', (e) => {
      if (e.target?.dataset?.a === 'back') { this.click(); this.showTitle(); }
    });
  }

  // ---------- settings ----------
  showSettings(onBack) {
    const st = this.game.meta.settings;
    this.clear();
    const s = document.createElement('div');
    s.className = 'screen overlay';
    s.innerHTML = `
      <h2>⚙ <em>SETTINGS</em></h2>
      <div class="set-row"><label>Mouse sensitivity</label><input type="range" id="set-sens" min="0.2" max="3" step="0.05" value="${st.sensitivity}"><span class="set-val" id="v-sens">${st.sensitivity.toFixed(2)}</span></div>
      <div class="set-row"><label>Invert Y</label><input type="checkbox" id="set-inv" ${st.invertY ? 'checked' : ''}></div>
      <div class="set-row"><label>Field of view</label><input type="range" id="set-fov" min="60" max="110" step="1" value="${st.fov}"><span class="set-val" id="v-fov">${st.fov}</span></div>
      <div class="set-row"><label>Master volume</label><input type="range" id="set-vm" min="0" max="1" step="0.05" value="${st.volMaster}"><span class="set-val" id="v-vm">${Math.round(st.volMaster * 100)}%</span></div>
      <div class="set-row"><label>SFX volume</label><input type="range" id="set-vs" min="0" max="1" step="0.05" value="${st.volSfx}"><span class="set-val" id="v-vs">${Math.round(st.volSfx * 100)}%</span></div>
      <div class="set-row"><label>Music volume</label><input type="range" id="set-vmu" min="0" max="1" step="0.05" value="${st.volMusic}"><span class="set-val" id="v-vmu">${Math.round(st.volMusic * 100)}%</span></div>
      <div style="height:16px"></div>
      <button class="mbtn" data-a="back">← DONE</button>`;
    root().appendChild(s);
    const bind = (id, key, fmt, apply) => {
      const el = s.querySelector('#' + id);
      el.addEventListener('input', () => {
        const v = el.type === 'checkbox' ? el.checked : parseFloat(el.value);
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
      if (e.target?.dataset?.a === 'back') { this.click(); this.clear(); onBack(); }
    });
  }

  // ---------- pause ----------
  showPause() {
    this.clear();
    const s = document.createElement('div');
    s.className = 'screen overlay';
    s.innerHTML = `
      <h2>⏸ ON <em>BREAK</em></h2>
      <div class="menu-btns">
        <button class="mbtn primary" data-a="resume">▶ BACK TO WORK</button>
        <button class="mbtn" data-a="settings">⚙ SETTINGS</button>
        <button class="mbtn danger" data-a="quit">🚪 RAGE QUIT (ABANDON RUN)</button>
      </div>`;
    root().appendChild(s);
    s.addEventListener('click', (e) => {
      const a = e.target?.dataset?.a;
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
      <div class="big-verdict">YOU'RE FIRED.</div>
      <div class="verdict-sub">cause of termination: ${stats.cause}</div>
      <div class="run-stats">
        <div><div class="rs-v">${formatTime(stats.time)}</div><div class="rs-k">shift length</div></div>
        <div><div class="rs-v">${stats.kills}</div><div class="rs-k">downsized</div></div>
        <div><div class="rs-v">${stats.floorName}</div><div class="rs-k">reached</div></div>
        <div><div class="rs-v">$${Math.floor(stats.money)}</div><div class="rs-k">unspent budget</div></div>
      </div>
      <div class="sev-earn">+$${stats.severance} SEVERANCE DEPOSITED</div>
      <div class="menu-btns">
        <button class="mbtn primary" data-a="retry">↻ RE-APPLY (SAME ROLE)</button>
        <button class="mbtn" data-a="menu">🏠 MAIN MENU</button>
      </div>`;
    root().appendChild(s);
    s.addEventListener('click', (e) => {
      const a = e.target?.dataset?.a;
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
      <div class="big-verdict win">PROMOTED.</div>
      <div class="verdict-sub">the C.E.O. has been… restructured. the tower is yours.<br>…so who's going to do all the work now?</div>
      <div class="run-stats">
        <div><div class="rs-v">${formatTime(stats.time)}</div><div class="rs-k">shift length</div></div>
        <div><div class="rs-v">${stats.kills}</div><div class="rs-k">downsized</div></div>
        <div><div class="rs-v">${stats.loops + 1}</div><div class="rs-k">tower loops</div></div>
        <div><div class="rs-v">$${Math.floor(stats.money)}</div><div class="rs-k">war chest</div></div>
      </div>
      <div class="sev-earn">+$${stats.severance} SEVERANCE DEPOSITED</div>
      <div class="menu-btns">
        <button class="mbtn primary" data-a="endless">∞ KEEP GRINDING (LOOP — HARDER)</button>
        <button class="mbtn" data-a="menu">🏠 RETIRE TO MENU</button>
      </div>`;
    root().appendChild(s);
    s.addEventListener('click', (e) => {
      const a = e.target?.dataset?.a;
      if (!a) return;
      this.click();
      if (a === 'endless') this.game.continueEndless();
      if (a === 'menu') this.game.toTitle();
    });
  }

  // ---------- multiplayer lobby ----------
  showLobby() {
    const g = this.game;
    this.clear();
    const s = document.createElement('div');
    s.className = 'screen';
    const st = g.meta.settings;
    const roster = g.net?.roster ?? [];
    const inLobby = !!g.net?.connected;
    const rosterHtml = roster.map((r) => `
      <div class="lr"><span>${r.name} ${r.cls ? `· ${r.cls.toUpperCase()}` : ''}</span><span class="tag">${r.host ? 'HOST' : 'GUEST'}</span></div>`).join('')
      || '<div class="lr"><span>— empty —</span></div>';
    s.innerHTML = `
      <h2>🌐 CO-OP <em>SHIFT</em></h2>
      <div class="mp-status">${g.net?.status ?? 'Not connected. Run the relay: <b>npm run host</b> (default ws://localhost:7071)'}</div>
      ${inLobby ? `
        <div class="lobby-roster">${rosterHtml}</div>
        <div class="menu-btns">
          <button class="mbtn primary" data-a="pick">🎭 PICK ROLE ${g.net.isHost ? '& START' : '(READY UP)'}</button>
          <button class="mbtn" data-a="leave">✖ LEAVE LOBBY</button>
        </div>` : `
        <div class="mp-box">
          <input type="text" id="mp-name" placeholder="YOUR NAME" maxlength="14" value="${st.playerName}">
          <input type="text" id="mp-url" placeholder="relay url (ws://host-ip:7071)" value="${g.lastRelayUrl ?? 'ws://localhost:7071'}">
          <input type="text" id="mp-room" placeholder="ROOM CODE (e.g. SYNERGY)" maxlength="12" value="${g.lastRoom ?? 'SYNERGY'}">
        </div>
        <div class="menu-btns">
          <button class="mbtn primary" data-a="join">🔌 CONNECT</button>
          <button class="mbtn" data-a="back">← BACK</button>
        </div>
        <div class="back-hint">One player runs <b>npm run host</b> and shares their IP (LAN or port-forward). Zero server bills.</div>`}
    `;
    root().appendChild(s);
    s.addEventListener('click', (e) => {
      const a = e.target?.dataset?.a;
      if (!a) return;
      this.click();
      if (a === 'back') this.showTitle();
      if (a === 'join') {
        const name = s.querySelector('#mp-name').value.trim() || 'WAGE_SLAVE';
        const url = s.querySelector('#mp-url').value.trim();
        const room = s.querySelector('#mp-room').value.trim().toUpperCase() || 'SYNERGY';
        st.playerName = name;
        g.meta.save();
        g.netConnect(url, room, name);
      }
      if (a === 'leave') { g.netDisconnect(); this.showLobby(); }
      if (a === 'pick') this.showClassSelect(true);
    });
  }
}
