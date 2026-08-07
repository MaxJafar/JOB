// ============ post-processing (deliberately small) ============
// Three effects, one pass, one reason each:
//   BLOOM       — the floors are already lit by emissive ceiling panels, neon
//                 signage and glowing accents. Bloom is what makes those read as
//                 *light* instead of bright paint.
//   VIGNETTE    — frames the screen and doubles as the damage/danger readout:
//                 it tightens and reddens as HP drops, so the player feels
//                 pressure without another HUD element (D 6.1 — rank by need).
//   TONE MAPPING — moved off the renderer and into the chain so it runs AFTER
//                 bloom in HDR. Tone mapping before bloom crushes the highlights
//                 bloom is supposed to find.
// SMAA only at 'high'. Everything else on the shelf stays on the shelf; a pile
// of expensive passes is how a 60fps game becomes a 40fps game.

import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass,
  BloomEffect, VignetteEffect, SMAAEffect, ToneMappingEffect,
  ToneMappingMode, KernelSize, BlendFunction,
} from 'postprocessing';

export const POSTFX_QUALITY = ['off', 'low', 'high'];

export class PostFX {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   */
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.composer = null;
    this.quality = 'off';
    this.enabled = false;
    this.bloom = null;
    this.vignette = null;
    this._baseVignette = 0.42;
    this._baseOffset = 0.32;
    this._danger = 0;      // 0..1, drives the red squeeze
    this._flash = 0;       // short spike on taking a hit
    this.stats = { renderMs: 0 };
  }

  /** @param {'off'|'low'|'high'} quality */
  setQuality(quality) {
    if (!POSTFX_QUALITY.includes(quality)) quality = 'off';
    if (quality === this.quality) return;
    this.quality = quality;
    this._teardown();
    if (quality === 'off') {
      // hand tone mapping back to the renderer
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.25;
      this.enabled = false;
      return;
    }
    try {
      this._build(quality);
      this.enabled = true;
    } catch (err) {
      console.warn('[postfx] composer unavailable, rendering direct:', err?.message ?? err);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.enabled = false;
      this.quality = 'off';
    }
  }

  _build(quality) {
    const high = quality === 'high';
    this.composer = new EffectComposer(this.renderer, {
      frameBufferType: THREE.HalfFloatType,  // HDR so bloom has real headroom
      multisampling: 0,
    });
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloom = new BloomEffect({
      blendFunction: BlendFunction.ADD,
      luminanceThreshold: 0.68,   // only genuine light sources, not white shirts
      luminanceSmoothing: 0.22,
      intensity: high ? 0.9 : 0.65,
      kernelSize: high ? KernelSize.LARGE : KernelSize.MEDIUM,
      mipmapBlur: true,
    });

    this.vignette = new VignetteEffect({
      offset: this._baseOffset,
      darkness: this._baseVignette,
    });

    const toneMapping = new ToneMappingEffect({
      mode: ToneMappingMode.ACES_FILMIC,
    });

    const effects = [this.bloom, this.vignette, toneMapping];
    if (high) effects.push(new SMAAEffect());

    this.composer.addPass(new EffectPass(this.camera, ...effects));

    // the chain owns tone mapping now
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.composer.setSize(innerWidth, innerHeight);
  }

  _teardown() {
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    this.vignette = null;
  }

  setSize(w, h) {
    this.composer?.setSize(w, h);
  }

  /** Called when the player takes damage — a brief squeeze, not a screen-wipe. */
  hitFlash(amount = 1) {
    this._flash = Math.min(1, this._flash + amount * 0.6);
  }

  /**
   * @param {number} dt
   * @param {number} hpFrac 0..1 — drives the persistent danger vignette
   */
  update(dt, hpFrac = 1) {
    if (!this.enabled || !this.vignette) return;
    const wantDanger = hpFrac < 0.45 ? (0.45 - hpFrac) / 0.45 : 0;
    this._danger += (wantDanger - this._danger) * Math.min(1, dt * 4);
    this._flash = Math.max(0, this._flash - dt * 3.2);

    const pulse = this._danger > 0.05 ? Math.sin(performance.now() * 0.005) * 0.03 * this._danger : 0;
    const d = this._baseVignette + this._danger * 0.5 + this._flash * 0.35 + pulse;
    const o = this._baseOffset - this._danger * 0.12 - this._flash * 0.08;
    this.vignette.darkness = d;
    this.vignette.offset = Math.max(0.05, o);
  }

  /**
   * @returns {boolean} true if this rendered the frame; false means the caller
   * should fall back to renderer.render()
   */
  render(dt) {
    if (!this.enabled || !this.composer) return false;
    const t0 = performance.now();
    this.composer.render(dt);
    this.stats.renderMs = performance.now() - t0;
    return true;
  }

  dispose() { this._teardown(); }
}
