// ============ in-run HUD ============
import { formatTime, formatMoney, clamp } from '../core/utils.js';
import { ITEM_BY_ID } from '../game/items.js';
import { UPGRADE_BY_ID } from '../game/upgrades.js';
import { THROWABLES, CONSUMABLES, describeStats } from '../game/gear.js';
import { describeModule } from '../game/modules.js';

const $ = (id) => document.getElementById(id);

function setHudRasterIcon(ability, sprite) {
  const icon = ability?.querySelector('.ability-icon');
  if (!icon) return;
  icon.textContent = '';
  icon.classList.add('raster-hud-icon');
  icon.dataset.hudIcon = sprite;
}

export class Hud {
  constructor() {
    this.root = $('hud');
    this.floorName = $('hud-floor-name');
    this.timer = $('hud-timer');
    this.money = $('hud-money');
    this.diffLabel = $('difficulty-label');
    this.diffPips = $('difficulty-pips');
    this.hpFill = $('hp-bar-fill');
    this.hpText = $('hp-text');
    this.hpBar = this.hpFill.parentElement;
    this.xpFill = $('xp-bar-fill');
    this.levelText = $('level-text');
    this.className = $('hud-class-name');
    this.bossWrap = $('boss-bar');
    this.bossName = $('boss-name');
    this.bossFill = $('boss-bar-fill');
    this.eventWrap = $('event-bar');
    this.eventLabel = $('event-label');
    this.eventFill = $('event-bar-fill');
    this.announceEl = $('announce');
    this.itemTray = $('item-tray');
    this.crosshair = $('crosshair');
    this.damageIndicator = $('damage-indicator');
    this.hitmarker = $('hitmarker');
    this.prompt = $('interact-prompt');
    this.vignette = $('damage-vignette');
    this.statusStrip = $('status-strip');
    this._statusKey = '';
    this.toastStack = $('toast-stack');
    this.teamList = $('team-list');
    this.abilities = {
      primary: $('ability-primary'),
      secondary: $('ability-secondary'),
      special: $('ability-special'),
      dash: $('ability-dash'),
    };
    this.kpiPanel = $('kpi-panel');
    this.comboMeter = $('combo-meter');
    this.comboCount = $('combo-count');
    this.comboFill = $('combo-bar-fill');
    this.draftRoot = $('draft-root');
    this.draftCards = $('draft-cards');
    this.ammoBox = $('ammo-box');
    this.ammoCount = $('ammo-count');
    this.ammoMag = $('ammo-mag');
    this.ammoNote = $('ammo-note');
    this.pocketThrow = $('pocket-throw');
    this.pocketConsume = $('pocket-consume');
    this.invRoot = $('inv-root');
    this.invSlots = $('inv-slots');
    this.invModules = $('inv-modules');
    this.invBag = $('inv-bag');
    this.budgetEl = $('hud-budget');
    this.navArrow = $('nav-arrow');
    this._lastCombo = 0;
    this._announceT = null;
    this._hitT = null;
    this._pips = [];
    for (let i = 0; i < 7; i++) {
      const pip = document.createElement('div');
      pip.className = 'pip';
      this.diffPips.appendChild(pip);
      this._pips.push(pip);
    }
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  setAbilityIcons(cls) {
    setHudRasterIcon(this.abilities.primary, `${cls.key}-primary`);
    setHudRasterIcon(this.abilities.secondary, `${cls.key}-secondary`);
    setHudRasterIcon(this.abilities.dash, 'dash');
    this.className.textContent = `${cls.name} — ${cls.title}`;
  }

  setCrosshairState(state = 'idle', style = 'reticle') {
    if (!this.crosshair) return;
    this.crosshair.dataset.style = style;
    this.crosshair.dataset.state = state;
  }

  showDamageDirection(angle = 0, duration = 0.35) {
    if (!this.damageIndicator) return;
    this.damageIndicator.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
    this.damageIndicator.classList.remove('hidden');
    clearTimeout(this._damageIndicatorT);
    this._damageIndicatorT = setTimeout(() => this.damageIndicator.classList.add('hidden'), duration * 1000);
  }

  frame(game) {
    const p = game.player;
    if (!p) return;
    this.timer.textContent = formatTime(game.runTime);
    this.money.textContent = formatMoney(p.money);
    const hpFrac = clamp(p.hp / p.stats.maxHp, 0, 1);
    this.hpFill.style.transform = `scaleX(${hpFrac})`;
    this.hpText.textContent = `${Math.ceil(p.hp)} / ${Math.round(p.stats.maxHp)}`;
    this.hpBar.classList.toggle('low', hpFrac < 0.3);
    this.vignette.classList.toggle('dying', hpFrac < 0.3 && !p.dead);
    this.xpFill.style.transform = `scaleX(${clamp(p.xp / p.xpToNext(), 0, 1)})`;
    this.levelText.textContent = `LV ${p.level}`;
    // difficulty
    const stage = game.director.stage;
    this.diffLabel.textContent = stage.label;
    const coeff = game.director.coeff;
    const frac = clamp((coeff - 1) / 5.5, 0, 1);
    this._pips.forEach((pip, i) => pip.classList.toggle('on', frac * 7 > i));
    // cooldown sweeps
    this.sweep(this.abilities.secondary, p.classDef.secondary.hold ? 0 : p.secondaryCd / (p.classDef.secondary.cd || 1));
    this.sweep(this.abilities.dash, p.dashCd / p.stats.dashCd);
    this.sweep(this.abilities.primary, 0);
    if (p.modules?.special) this.sweep(this.abilities.special, p.specialCd / (p.specialCooldown() || 1));
    // goo vignette wears off
    if (p.gooT <= 0) this.vignette.classList.remove('goo');
    // elevator nav arrow: rotates toward the exit when nothing urgent is happening
    const el = game.level?.elevator;
    if (el && game.eventState === 'idle' && !game.activeBoss && !game.lockdown && game.runTime > 8) {
      const dx = el.pos.x - p.pos.x, dz = el.pos.z - p.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 14) {
        this.navArrow.classList.remove('hidden');
        const worldAngle = Math.atan2(dx, dz);
        const rel = worldAngle - p.yaw;
        this.navArrow.style.transform = `translateX(-50%) rotate(${(-rel * 180 / Math.PI + 180).toFixed(0)}deg)`;
      } else this.navArrow.classList.add('hidden');
    } else this.navArrow.classList.add('hidden');
    // ammo / heat
    const prim = p.classDef.primary;
    if (prim.mag) {
      this.ammoBox.classList.remove('hidden');
      this.ammoCount.textContent = p.ammo;
      this.ammoMag.textContent = `/ ${prim.mag}`;
      this.ammoCount.classList.toggle('low', p.ammo <= Math.ceil(prim.mag * 0.25));
      // a charged primary needs its wind-up on screen or the whole skill demand
      // is invisible: reload still wins the line, because it is the emergency
      const charging = prim.charge && p.chargeAmt > 0;
      this.ammoNote.classList.toggle('hidden', p.reloadT <= 0 && !charging);
      this.ammoNote.textContent = p.reloadT > 0 ? 'RELOADING…'
        : p.chargeAmt >= 1 ? '◆ FULL CHARGE' : `CHARGING ${Math.round(p.chargeAmt * 100)}%`;
    } else if (prim.heat) {
      this.ammoBox.classList.remove('hidden');
      this.ammoCount.textContent = `${Math.round(p.heatGauge * 100)}°`;
      this.ammoMag.textContent = 'HEAT';
      this.ammoCount.classList.toggle('low', p.heatGauge > 0.75 || p.overheatLock > 0);
      this.ammoNote.classList.toggle('hidden', p.overheatLock <= 0);
      this.ammoNote.textContent = prim.heatNote ?? 'REBOOTING…';
    } else {
      this.ammoBox.classList.add('hidden');
    }
    // combo meter
    const combo = game.combo;
    if (combo.count >= 3) {
      this.comboMeter.classList.remove('hidden');
      if (combo.count !== this._lastCombo) {
        this.comboCount.textContent = `×${combo.count}`;
        this.comboCount.classList.add('pop');
        clearTimeout(this._comboPopT);
        this._comboPopT = setTimeout(() => this.comboCount.classList.remove('pop'), 90);
      }
      this.comboCount.classList.toggle('hot', combo.count >= 20);
      this.comboFill.style.transform = `scaleX(${clamp(combo.t / 3.5, 0, 1)})`;
    } else {
      this.comboMeter.classList.add('hidden');
    }
    this._lastCombo = combo.count;
  }

  setBudget(n) {
    this.budgetEl.innerHTML = `⬛ ${Math.floor(n)} <small>DEPT BUDGET</small>`;
  }

  setKpi(text) {
    if (!text) { this.kpiPanel.classList.add('hidden'); return; }
    this.kpiPanel.classList.remove('hidden');
    this.kpiPanel.textContent = text;
  }

  showDraft(picks, level) {
    this.draftRoot.classList.remove('hidden');
    document.getElementById('draft-title').innerHTML = `📋 PERFORMANCE REVIEW — LV ${level} — <em>pick a perk</em>`;
    this.draftCards.innerHTML = '';
    picks.forEach((u, i) => {
      const el = document.createElement('div');
      el.className = `draft-card ${u.kind === 'evolution' ? 'evolution' : ''}`;
      el.innerHTML = `
        <div class="dc-icon">${u.icon}</div>
        <h3>${u.name}</h3>
        <div class="dc-kind">${u.kind === 'evolution' ? '★ CLASS EVOLUTION' : 'STANDARD RAISE'}</div>
        <p>${u.desc}</p>
        <div class="dc-key">[ ${i + 1} ]</div>`;
      el.addEventListener('click', () => window.game?.pickDraft(i));
      this.draftCards.appendChild(el);
    });
  }

  hideDraft() {
    this.draftRoot.classList.add('hidden');
  }

  /**
   * The SPECIAL chip only exists once a card fills the slot — an empty slot on
   * the bar for the first ten minutes of every run is a permanent reminder of
   * something you do not have (D 6.2: introduce elements as they are earned).
   */
  setModules(p) {
    const s = p.modules?.special;
    this.abilities.special.classList.toggle('hidden', !s);
    if (s) {
      setHudRasterIcon(this.abilities.special, 'module');
      this.abilities.special.title = `${s.name} — ${describeModule(s)}`;
      this.abilities.special.style.borderColor = `${s.css}66`;
    }
    this.renderItems(p.items, p.upgrades, p.modules);
  }

  refreshPockets(p) {
    const th = p.throwable ? THROWABLES[p.throwable.id] : null;
    this.pocketThrow.classList.toggle('filled', !!th);
    setHudRasterIcon(this.pocketThrow, 'throwable');
    this.pocketThrow.querySelector('.pocket-count').textContent = th ? `×${p.throwable.count}` : '';
    const c = p.consumables[0] ? CONSUMABLES[p.consumables[0].id] : null;
    this.pocketConsume.classList.toggle('filled', !!c);
    setHudRasterIcon(this.pocketConsume, 'consumable');
    this.pocketConsume.querySelector('.pocket-count').textContent = p.consumables.length > 1 ? `×${p.consumables.length}` : '';
  }

  showInventory(p) {
    this.invRoot.classList.remove('hidden');
    // the shipped glyph set names the leg slot "feet"
    const GLYPH = { HEAD: 'head', BODY: 'body', LEGS: 'feet', TRINKET: 'trinket' };
    const slotRow = (type, g) => `
      <div class="inv-slot ${g ? '' : 'empty'}" ${g ? `style="border-color:${g.css}55"` : ''}>
        <div class="is-type">${type}</div>
        <img class="equipment-glyph" src="/assets/ui/equipment/${GLYPH[type]}@1x.png" alt="">
        <div>
          <div class="is-name" ${g ? `style="color:${g.css}"` : ''}>${g ? g.name : 'nothing equipped'}</div>
          ${g ? `<div class="is-stats">${describeStats(g.stats)}</div>` : ''}
        </div>
      </div>`;
    this.invSlots.innerHTML =
      slotRow('HEAD', p.gearSlots.head) +
      slotRow('BODY', p.gearSlots.body) +
      slotRow('LEGS', p.gearSlots.legs) +
      slotRow('TRINKET', p.gearSlots.trinket);
    // ---- punch-card modules: the two slots that decide how you fight ----
    const modRow = (type, m, key) => `
      <div class="inv-slot ${m ? '' : 'empty'}" ${m ? `style="border-color:${m.css}55"` : ''}>
        <div class="is-type">${type}${key ? ` <small>[${key}]</small>` : ''}</div>
        <div class="is-icon">${m ? m.icon : '🗃️'}</div>
        <div>
          <div class="is-name" ${m ? `style="color:${m.css}"` : ''}>${m ? m.name : 'slot empty — specials, KPIs and bosses drop cards'}</div>
          ${m ? `<div class="is-stats">${describeModule(m)}${m.from ? ` <em>· from ${m.from}</em>` : ''}</div>` : ''}
        </div>
      </div>`;
    this.invModules.innerHTML =
      modRow('SPECIAL', p.modules.special, 'X') +
      modRow('PASSIVE', p.modules.passive, '') +
      (p.moduleBag.length
        ? p.moduleBag.map((m, i) => `
          <div class="inv-bag-row">
            <div class="is-icon">${m.icon}</div>
            <div class="is-name" style="color:${m.css}">${m.name}</div>
            <div class="is-stats">${describeModule(m)}</div>
            <button data-mod="${i}">INSTALL</button>
          </div>`).join('')
        : '');
    this.invModules.querySelectorAll('button[data-mod]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const m = p.moduleBag[parseInt(btn.dataset.mod, 10)];
        if (m) { p.equipModule(m); this.showInventory(p); }
      });
    });

    this.invBag.innerHTML = p.gearBag.length
      ? p.gearBag.map((g, i) => `
        <div class="inv-bag-row">
          <div class="is-icon">${g.icon}</div>
          <div class="is-name" style="color:${g.css}">${g.name}</div>
          <div class="is-stats">${describeStats(g.stats)}</div>
          <button data-eq="${i}">EQUIP</button>
        </div>`).join('')
      : '<div class="inv-bag-row"><div class="is-stats">empty — specials and bosses drop briefcases</div></div>';
    this.invBag.querySelectorAll('button[data-eq]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const g = p.gearBag[parseInt(btn.dataset.eq, 10)];
        if (g) { p.equipGear(g); this.showInventory(p); }
      });
    });
  }

  hideInventory() {
    this.invRoot.classList.add('hidden');
  }

  sweep(el, frac) {
    el.querySelector('.cd-sweep').style.transform = `scaleY(${clamp(frac, 0, 1)})`;
  }

  setFloor(def, loopCount) {
    const loop = loopCount > 0 ? ` — LOOP ${loopCount + 1}` : '';
    this.floorName.textContent = `${def.name} · ${def.sub}${loop}`;
  }

  showBoss(name, title) {
    this.bossWrap.classList.remove('hidden');
    this.bossName.textContent = `${name} — ${title}`;
    this.updateBoss(1);
  }
  updateBoss(frac) { this.bossFill.style.transform = `scaleX(${clamp(frac, 0, 1)})`; }
  hideBoss() { this.bossWrap.classList.add('hidden'); }

  showEvent(label) {
    this.eventWrap.classList.remove('hidden');
    this.eventLabel.textContent = label;
    this.updateEvent(0);
  }
  updateEvent(frac, label) {
    this.eventFill.style.transform = `scaleX(${clamp(frac, 0, 1)})`;
    if (label) this.eventLabel.textContent = label;
  }
  hideEvent() { this.eventWrap.classList.add('hidden'); }

  announce(text, dur = 2.2, minor = false) {
    this.announceEl.textContent = text;
    this.announceEl.style.fontSize = minor ? '20px' : '26px';
    this.announceEl.classList.add('on');
    clearTimeout(this._announceT);
    this._announceT = setTimeout(() => this.announceEl.classList.remove('on'), dur * 1000);
  }

  toast(text, cls = '') {
    const el = document.createElement('div');
    el.className = `toast ${cls}`;
    el.textContent = text;
    this.toastStack.appendChild(el);
    while (this.toastStack.children.length > 4) this.toastStack.firstChild.remove();
    setTimeout(() => el.classList.add('fade'), 2600);
    setTimeout(() => el.remove(), 3200);
  }

  renderItems(items, upgrades = null, modules = null) {
    this.itemTray.innerHTML = '';
    // the passive card has no key and no cooldown, so the tray is where it lives
    if (modules?.passive) {
      const m = modules.passive;
      const chip = document.createElement('div');
      chip.className = 'item-chip rare';
      chip.style.borderColor = `${m.css}88`;
      chip.title = `${m.name} — ${describeModule(m)}`;
      chip.innerHTML = m.icon;
      this.itemTray.appendChild(chip);
    }
    for (const [id, count] of items) {
      const item = ITEM_BY_ID[id];
      if (!item) continue;
      const chip = document.createElement('div');
      chip.className = `item-chip ${item.rarity}`;
      chip.title = `${item.name} — ${item.desc}`;
      chip.innerHTML = `${item.icon}${count > 1 ? `<small>×${count}</small>` : ''}`;
      this.itemTray.appendChild(chip);
    }
    if (upgrades) {
      for (const [id, count] of upgrades) {
        const up = UPGRADE_BY_ID[id];
        if (!up || up.kind !== 'evolution') continue; // generics are stats, evolutions get chips
        const chip = document.createElement('div');
        chip.className = 'item-chip rare';
        chip.title = `${up.name} — ${up.desc}`;
        chip.innerHTML = `${up.icon}${count > 1 ? `<small>×${count}</small>` : ''}`;
        this.itemTray.appendChild(chip);
      }
    }
  }

  hit(crit) {
    this.setCrosshairState('hit-confirm');
    this.hitmarker.classList.add('on');
    this.hitmarker.classList.toggle('crit', !!crit);
    clearTimeout(this._hitT);
    this._hitT = setTimeout(() => {
      this.hitmarker.classList.remove('on');
      this.setCrosshairState('idle');
    }, 70);
  }

  hurt() {
    this.vignette.classList.add('hurt');
    clearTimeout(this._hurtT);
    this._hurtT = setTimeout(() => this.vignette.classList.remove('hurt'), 200);
  }

  setGoo(on) { this.vignette.classList.toggle('goo', on); }

  /**
   * Status chips. Only re-renders when the active statuses actually change —
   * these tick every frame and rewriting innerHTML at 60 Hz for an unchanged
   * list is exactly the kind of thing that shows up in a frame graph. The key
   * includes the label so a live countdown ("MEETING IN 3") still repaints.
   */
  setStatuses(list) {
    if (!this.statusStrip) return;
    const key = list.map((s) => `${s.k}${s.label}`).join('|');
    if (key !== this._statusKey) {
      this._statusKey = key;
      this.statusStrip.innerHTML = list.map((s) =>
        `<div class="status-chip" data-k="${s.k}"><span class="sc-ico">${s.icon}</span>${s.label}</div>`).join('');
    }
    this.vignette.classList.toggle('stun', list.some((s) => s.k === 'stun'));
    this.vignette.classList.toggle('shock', list.some((s) => s.k === 'shock'));
  }

  setPrompt(text) {
    if (!text) { this.prompt.classList.add('hidden'); return; }
    this.prompt.classList.remove('hidden');
    this.prompt.innerHTML = text;
  }

  renderTeam(remotes) {
    this.teamList.innerHTML = '';
    for (const r of remotes.values()) {
      const el = document.createElement('div');
      el.className = 'teammate';
      const frac = clamp(r.hp / Math.max(1, r.maxHp), 0, 1);
      el.innerHTML = `<div class="tm-name">${r.name}${r.dead ? ' — DOWN' : ''}</div>
        <div class="bar hp"><div class="bar-fill" style="transform:scaleX(${frac})"></div></div>`;
      this.teamList.appendChild(el);
    }
  }

  reset() {
    this.hideBoss();
    this.hideEvent();
    this.hideDraft();
    this.hideInventory();
    this.setKpi(null);
    this.pocketThrow?.classList.remove('filled');
    this.pocketConsume?.classList.remove('filled');
    this.abilities.special?.classList.add('hidden');
    this.navArrow?.classList.add('hidden');
    this.comboMeter.classList.add('hidden');
    this.itemTray.innerHTML = '';
    this.teamList.innerHTML = '';
    this.toastStack.innerHTML = '';
    this.setGoo(false);
    this.setStatuses([]);
    this.setPrompt(null);
  }
}
