// ============ procedural audio: synth SFX + generative elevator muzak ============
// Zero external assets. Everything is oscillators and filtered noise.

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.volumes = { master: 0.8, sfx: 0.8, music: 0.4 };
    this.mood = 'off';
    this._schedTimer = null;
    this._nextBeat = 0;
    this._beatIdx = 0;
    this._noiseBuf = null;
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return true; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.connect(this.master);
      this.applyVolumes();
      // shared noise buffer
      const len = this.ctx.sampleRate * 1.5;
      this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this._noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return true;
    } catch { return false; }
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    this.sfxBus.gain.value = this.volumes.sfx;
    this.musicBus.gain.value = this.volumes.music;
  }
  setVolume(kind, v) { this.volumes[kind] = v; this.applyVolumes(); }

  // ---- low-level voices ----
  tone({ type = 'square', freq = 440, freqEnd = null, dur = 0.1, vol = 0.5, attack = 0.004, release = null, when = 0, bus = null, detune = 0 }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    if (detune) osc.detune.value = detune;
    const rel = release ?? dur * 0.6;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.setValueAtTime(vol, t0 + Math.max(attack, dur - rel));
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(bus || this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  noise({ dur = 0.2, vol = 0.4, filter = 'lowpass', freq = 1200, freqEnd = null, q = 0.8, when = 0, bus = null }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = this.ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== null) f.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f).connect(g).connect(bus || this.sfxBus);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  // ---- SFX library ----
  sfx(name, opt = {}) {
    if (!this.ctx) return;
    const v = opt.vol ?? 1;
    switch (name) {
      case 'ui': this.tone({ type: 'square', freq: 700, dur: 0.05, vol: 0.15 * v }); break;
      case 'ui2': this.tone({ type: 'square', freq: 950, dur: 0.06, vol: 0.15 * v }); break;
      case 'staple': this.tone({ type: 'square', freq: 1300, freqEnd: 300, dur: 0.07, vol: 0.22 * v }); this.noise({ dur: 0.04, vol: 0.12 * v, filter: 'highpass', freq: 3000 }); break;
      case 'smg': this.tone({ type: 'square', freq: 900 + Math.random() * 200, freqEnd: 200, dur: 0.05, vol: 0.13 * v }); break;
      case 'card': this.noise({ dur: 0.08, vol: 0.2 * v, filter: 'bandpass', freq: 2600, q: 2 }); break;
      case 'slip': this.noise({ dur: 0.14, vol: 0.16 * v, filter: 'bandpass', freq: 1500, freqEnd: 2600, q: 3 }); break;
      case 'zap': this.tone({ type: 'sawtooth', freq: 180 + Math.random() * 60, freqEnd: 90, dur: 0.06, vol: 0.1 * v }); this.noise({ dur: 0.04, vol: 0.05 * v, filter: 'highpass', freq: 4500 }); break;
      case 'swing': this.noise({ dur: 0.16, vol: 0.3 * v, filter: 'bandpass', freq: 500, freqEnd: 1500, q: 1.4 }); break;
      case 'melee-hit': this.tone({ type: 'triangle', freq: 150, freqEnd: 70, dur: 0.12, vol: 0.5 * v }); this.noise({ dur: 0.08, vol: 0.25 * v, freq: 800 }); break;
      case 'hit': this.tone({ type: 'triangle', freq: 220, freqEnd: 120, dur: 0.06, vol: 0.3 * v }); break;
      case 'crit': this.tone({ type: 'triangle', freq: 220, freqEnd: 100, dur: 0.07, vol: 0.35 * v }); this.tone({ type: 'sine', freq: 1900, dur: 0.07, vol: 0.2 * v }); break;
      case 'kill': this.tone({ type: 'triangle', freq: 300, freqEnd: 60, dur: 0.18, vol: 0.35 * v }); break;
      case 'hurt': this.noise({ dur: 0.18, vol: 0.4 * v, freq: 700, freqEnd: 200 }); this.tone({ type: 'sine', freq: 130, freqEnd: 60, dur: 0.2, vol: 0.5 * v }); break;
      case 'coin': this.tone({ type: 'sine', freq: 1300, dur: 0.05, vol: 0.12 * v }); this.tone({ type: 'sine', freq: 1800, dur: 0.08, vol: 0.1 * v, when: 0.05 }); break;
      case 'buy': this.tone({ type: 'sine', freq: 900, dur: 0.07, vol: 0.3 * v }); this.tone({ type: 'sine', freq: 1350, dur: 0.1, vol: 0.3 * v, when: 0.08 }); this.noise({ dur: 0.12, vol: 0.15 * v, filter: 'highpass', freq: 2500, when: 0.05 }); break;
      case 'chest': this.tone({ type: 'triangle', freq: 500, freqEnd: 900, dur: 0.2, vol: 0.3 * v }); break;
      case 'item': [660, 880, 1320].forEach((f, i) => this.tone({ type: 'sine', freq: f, dur: 0.12, vol: 0.25 * v, when: i * 0.07 })); break;
      case 'item-rare': [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone({ type: 'sine', freq: f, dur: 0.16, vol: 0.28 * v, when: i * 0.08 })); break;
      case 'levelup': [523, 659, 784, 1046].forEach((f, i) => this.tone({ type: 'triangle', freq: f, dur: 0.14, vol: 0.3 * v, when: i * 0.06 })); break;
      case 'jump': this.tone({ type: 'sine', freq: 300, freqEnd: 500, dur: 0.09, vol: 0.12 * v }); break;
      case 'dash': this.noise({ dur: 0.22, vol: 0.35 * v, filter: 'bandpass', freq: 800, freqEnd: 2400, q: 1.2 }); break;
      case 'slide': this.noise({ dur: 0.3, vol: 0.2 * v, freq: 500, freqEnd: 250 }); break;
      case 'explosion': this.noise({ dur: 0.5, vol: 0.7 * v, freq: 1500, freqEnd: 100 }); this.tone({ type: 'sine', freq: 120, freqEnd: 35, dur: 0.45, vol: 0.7 * v }); break;
      case 'ding': this.tone({ type: 'sine', freq: 880, dur: 0.35, vol: 0.4 * v }); this.tone({ type: 'sine', freq: 1108, dur: 0.55, vol: 0.4 * v, when: 0.28 }); break;
      case 'doors': this.noise({ dur: 0.6, vol: 0.25 * v, freq: 400, freqEnd: 900 }); break;
      case 'roar': this.tone({ type: 'sawtooth', freq: 110, freqEnd: 45, dur: 0.7, vol: 0.55 * v }); this.noise({ dur: 0.7, vol: 0.4 * v, freq: 500, freqEnd: 120 }); break;
      case 'karen-scream': this.tone({ type: 'sawtooth', freq: 800, freqEnd: 1400, dur: 0.5, vol: 0.35 * v }); this.tone({ type: 'sawtooth', freq: 790, freqEnd: 1380, dur: 0.5, vol: 0.3 * v, detune: 30 }); break;
      case 'gossip-pop': this.tone({ type: 'sine', freq: 300, freqEnd: 90, dur: 0.3, vol: 0.5 * v }); this.noise({ dur: 0.35, vol: 0.4 * v, filter: 'bandpass', freq: 900, freqEnd: 300, q: 1.5 }); break;
      case 'spit': this.noise({ dur: 0.25, vol: 0.3 * v, filter: 'bandpass', freq: 600, freqEnd: 1800, q: 2 }); break;
      case 'pounce': this.tone({ type: 'sawtooth', freq: 500, freqEnd: 1100, dur: 0.3, vol: 0.28 * v }); break;
      case 'alarm': this.tone({ type: 'square', freq: 1000, dur: 0.18, vol: 0.22 * v }); this.tone({ type: 'square', freq: 800, dur: 0.18, vol: 0.22 * v, when: 0.2 }); break;
      case 'phone': this.tone({ type: 'sine', freq: 1200, dur: 0.09, vol: 0.15 * v }); this.tone({ type: 'sine', freq: 1200, dur: 0.09, vol: 0.15 * v, when: 0.14 }); break;
      case 'horde': this.tone({ type: 'sawtooth', freq: 200, freqEnd: 400, dur: 0.5, vol: 0.2 * v }); this.tone({ type: 'sawtooth', freq: 150, freqEnd: 330, dur: 0.55, vol: 0.2 * v, when: 0.1 }); break;
      case 'turret': this.tone({ type: 'square', freq: 1500, freqEnd: 900, dur: 0.05, vol: 0.1 * v }); break;
      case 'block': this.tone({ type: 'triangle', freq: 500, freqEnd: 320, dur: 0.08, vol: 0.35 * v }); this.noise({ dur: 0.06, vol: 0.2 * v, filter: 'highpass', freq: 2000 }); break;
      case 'death': [392, 370, 349, 311].forEach((f, i) => this.tone({ type: 'sawtooth', freq: f, freqEnd: f * 0.97, dur: 0.4, vol: 0.25 * v, when: i * 0.42 })); break;
      case 'victory': [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => this.tone({ type: 'triangle', freq: f, dur: 0.22, vol: 0.3 * v, when: i * 0.13 })); break;
      case 'parachute': this.tone({ type: 'sine', freq: 400, freqEnd: 900, dur: 0.5, vol: 0.4 * v }); this.tone({ type: 'sine', freq: 600, freqEnd: 1200, dur: 0.5, vol: 0.3 * v, when: 0.1 }); break;
      case 'beep': this.tone({ type: 'square', freq: 1400, dur: 0.06, vol: 0.18 * v }); break;
    }
  }

  // ---- generative muzak ----
  // 'chill' — corporate elevator jazz. 'boss' — hostile takeover. 'menu' — slow chill.
  setMood(mood) {
    if (this.mood === mood) return;
    this.mood = mood;
    this._beatIdx = 0;
    if (!this.ctx) return;
    this._nextBeat = this.ctx.currentTime + 0.1;
    if (mood !== 'off' && !this._schedTimer) {
      this._schedTimer = setInterval(() => this._schedule(), 90);
    }
    if (mood === 'off' && this._schedTimer) { clearInterval(this._schedTimer); this._schedTimer = null; }
  }

  _schedule() {
    if (!this.ctx || this.mood === 'off') return;
    const bpm = this.mood === 'boss' ? 138 : this.mood === 'menu' ? 76 : 92;
    const beat = 60 / bpm;
    while (this._nextBeat < this.ctx.currentTime + 0.35) {
      this._playBeat(this._beatIdx, this._nextBeat, beat);
      this._beatIdx++;
      this._nextBeat += beat / 2; // schedule in eighths
    }
  }

  _playBeat(i, t, beat) {
    const when = t - this.ctx.currentTime;
    if (when < -0.05) return;
    const bus = this.musicBus;
    const eighth = i % 2, beatIdx = (i >> 1) % 4, bar = (i >> 3) % 4;

    if (this.mood === 'boss') {
      // driving minor pulse
      const roots = [98, 98, 92.5, 87.3]; // G2 G2 F#2 F2-ish menace
      const root = roots[bar];
      if (eighth === 0) {
        this.tone({ type: 'sine', freq: 70, freqEnd: 45, dur: 0.16, vol: 0.5, when, bus }); // kick
        this.tone({ type: 'sawtooth', freq: root, dur: beat * 0.45, vol: 0.12, when, bus });
      } else {
        this.noise({ dur: 0.05, vol: 0.1, filter: 'highpass', freq: 6000, when, bus }); // offbeat hat
        this.tone({ type: 'sawtooth', freq: root * 1.5, dur: beat * 0.2, vol: 0.07, when, bus });
      }
      if (beatIdx === 3 && eighth === 1) this.tone({ type: 'sawtooth', freq: root * 2, freqEnd: root * 1.98, dur: beat * 0.4, vol: 0.09, when, bus });
      return;
    }

    // chill / menu — ii-V-I-vi lounge loop: Dm7 G7 Cmaj7 Am7
    const chords = [
      [146.8, 220, 261.6, 349.2], // Dm7
      [196, 246.9, 293.7, 349.2], // G7
      [130.8, 196, 246.9, 329.6], // Cmaj7
      [110, 164.8, 261.6, 329.6], // Am7
    ];
    const ch = chords[bar];
    const swing = eighth === 1 ? beat * 0.08 : 0;
    if (eighth === 0 && beatIdx === 0) {
      // pad on the bar
      ch.forEach((f, k) => this.tone({ type: 'triangle', freq: f, dur: beat * 3.6, vol: 0.05, attack: 0.3, when, bus, detune: k * 3 }));
      this.tone({ type: 'sine', freq: ch[0] / 2, dur: beat * 3.4, vol: 0.16, attack: 0.05, when, bus }); // bass
    }
    if (eighth === 0 && beatIdx === 2) this.tone({ type: 'sine', freq: ch[0] / 2 * 1.5, dur: beat * 0.9, vol: 0.1, when, bus });
    // brushed hats with swing
    this.noise({ dur: 0.04, vol: eighth === 0 ? 0.045 : 0.028, filter: 'highpass', freq: 7000, when: when + swing, bus });
    // sparse noodle melody
    if (this.mood === 'chill' && eighth === 1 && Math.random() < 0.3) {
      const scale = [523.3, 587.3, 659.3, 784, 880, 1046.5];
      this.tone({ type: 'sine', freq: scale[(Math.random() * scale.length) | 0], dur: beat * 0.7, vol: 0.055, attack: 0.02, when: when + swing, bus });
    }
  }
}
