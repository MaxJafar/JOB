// ============ streamed audio layer (howler) ============
// The game currently synthesises everything — no audio files exist yet, and the
// procedural muzak in AudioSys is genuinely good. So this layer is the *seam*
// for when real stems land (roadmap v0.7 "Audio pass: layered music states —
// corridor / wave / elevator / boss"), not a replacement for what works today.
//
// Behaviour: if a mood has no registered stem, playback falls straight through
// to the procedural synth. Register stems in MUSIC_MANIFEST as files arrive and
// they take over one mood at a time — no flag day, no rewrite.
//
// Howler (not raw WebAudio) for this specifically because it handles the things
// that are tedious and easy to get wrong for streamed music: HTML5 streaming for
// long files so a 4MB track does not block the load, sprite maps, per-sound fade
// ramps, and the mobile/Safari unlock dance.

import { Howl, Howler } from 'howler';

/**
 * Drop entries here as stems are produced. `src` paths are relative to /public.
 * @type {Record<string, {src: string[], loop?: boolean, volume?: number}>}
 */
export const MUSIC_MANIFEST = {
  // menu:     { src: ['/audio/music/menu.webm', '/audio/music/menu.mp3'], loop: true },
  // chill:    { src: ['/audio/music/floor-loop.webm'], loop: true },
  // boss:     { src: ['/audio/music/boss.webm'], loop: true },
  // elevator: { src: ['/audio/music/elevator.webm'], loop: true },
};

const FADE_MS = 900;

export class MusicDirector {
  /**
   * @param {{setMood: (m: string) => void, volumes: {music: number}}} synth the procedural AudioSys
   */
  constructor(synth) {
    this.synth = synth;
    this.howls = new Map();      // mood -> Howl
    this.current = null;         // mood name
    this.currentHowl = null;
    this.volume = synth?.volumes?.music ?? 0.4;
    this.loaded = false;
  }

  /** Preload every registered stem. Safe to call with an empty manifest. */
  preload() {
    for (const [mood, def] of Object.entries(MUSIC_MANIFEST)) {
      if (this.howls.has(mood)) continue;
      try {
        this.howls.set(mood, new Howl({
          src: def.src,
          loop: def.loop ?? true,
          volume: 0,
          html5: true,          // stream long files instead of decoding up front
          preload: true,
        }));
      } catch (err) {
        console.warn(`[music] failed to load stem "${mood}":`, err?.message ?? err);
      }
    }
    this.loaded = true;
  }

  /**
   * Switch musical state. Streamed stem if we have one, procedural muzak if not.
   * @param {'menu'|'chill'|'boss'|'elevator'|'off'} mood
   */
  setMood(mood) {
    if (mood === this.current) return;
    const next = this.howls.get(mood);

    if (this.currentHowl) {
      const out = this.currentHowl;
      out.fade(out.volume(), 0, FADE_MS);
      out.once('fade', () => out.stop());
      this.currentHowl = null;
    }

    if (next) {
      // a streamed stem owns this mood — silence the synth's music bus
      this.synth?.setMood('off');
      next.volume(0);
      next.play();
      next.fade(0, this.volume, FADE_MS);
      this.currentHowl = next;
    } else {
      // no stem yet: the procedural muzak keeps doing its job
      this.synth?.setMood(mood);
    }
    this.current = mood;
  }

  setVolume(v) {
    this.volume = v;
    Howler.volume(1);                       // master stays at unity; we scale per-Howl
    if (this.currentHowl) this.currentHowl.volume(v);
    if (this.synth) this.synth.setVolume?.('music', v);
  }

  /** Pause/resume with the game (Esc menu, tab-out). */
  setPaused(on) {
    if (!this.currentHowl) return;
    if (on) this.currentHowl.pause();
    else this.currentHowl.play();
  }

  dispose() {
    for (const h of this.howls.values()) h.unload();
    this.howls.clear();
    this.currentHowl = null;
    this.current = null;
  }
}
