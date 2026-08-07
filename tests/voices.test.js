import { describe, it, expect, beforeEach } from 'vitest';
import { VoiceManager, VOICE_RULES } from '../src/core/voices.js';

function makeStub() {
  const played = [];
  return { played, sfx: (name, opt) => played.push({ name, vol: opt?.vol ?? 1 }) };
}

describe('VoiceManager', () => {
  let audio, vm;
  beforeEach(() => {
    audio = makeStub();
    vm = new VoiceManager(audio);
    vm.setListener({ x: 0, y: 0, z: 0 });
  });

  it('does not play anything until the queue is flushed', () => {
    vm.play('hit');
    expect(audio.played.length).toBe(0);
    vm.flush();
    expect(audio.played.length).toBe(1);
  });

  // The headline case: a 40-strong horde all firing in one frame.
  it('caps a crowd cue far below the number of requests', () => {
    for (let i = 0; i < 40; i++) vm.play('smg', { pos: { x: 1, y: 0, z: 1 } });
    vm.flush();
    expect(audio.played.length).toBeLessThanOrEqual(VOICE_RULES.smg.limit);
    expect(vm.stats.dropped).toBeGreaterThan(30);
  });

  it('still lets player feedback through in the same frame as that horde', () => {
    for (let i = 0; i < 40; i++) vm.play('smg', { pos: { x: 1, y: 0, z: 1 } });
    vm.play('hurt');
    vm.flush();
    expect(audio.played.some((p) => p.name === 'hurt')).toBe(true);
  });

  it('orders the flush by priority, so critical cues win the budget', () => {
    vm.frameBudget = 2;
    vm.play('phone');        // priority 8
    vm.play('crit');         // priority 0
    vm.play('turret');       // priority 7
    vm.play('karen-scream'); // priority 0
    vm.flush();
    const names = audio.played.map((p) => p.name);
    expect(names).toHaveLength(2);
    expect(names).toContain('crit');
    expect(names).toContain('karen-scream');
  });

  it('culls positional sounds beyond their max distance', () => {
    vm.play('smg', { pos: { x: 500, y: 0, z: 500 } });
    vm.flush();
    expect(audio.played.length).toBe(0);
    expect(vm.stats.culled).toBe(1);
  });

  it('attenuates with distance but keeps a full-volume bubble near the listener', () => {
    vm.play('zap', { pos: { x: 2, y: 0, z: 0 } });
    vm.flush();
    const near = audio.played[0].vol;
    expect(near).toBeCloseTo(1, 5);

    vm.update(1);   // clear the cooldown
    audio.played.length = 0;
    vm.play('zap', { pos: { x: 25, y: 0, z: 0 } });
    vm.flush();
    expect(audio.played[0].vol).toBeLessThan(near);
    expect(audio.played[0].vol).toBeGreaterThan(0);
  });

  it('never culls non-positional cues', () => {
    vm.play('levelup');
    vm.flush();
    expect(audio.played.length).toBe(1);
  });

  it('honours the per-cue cooldown across frames', () => {
    vm.play('karen-scream');
    vm.flush();
    expect(audio.played.length).toBe(1);
    vm.play('karen-scream');   // cooldown is 0.8s
    vm.flush();
    expect(audio.played.length).toBe(1);
    vm.update(1.0);            // wait it out
    vm.play('karen-scream');
    vm.flush();
    expect(audio.played.length).toBe(2);
  });

  it('recovers polyphony headroom over time', () => {
    for (let i = 0; i < 10; i++) vm.play('smg', { pos: { x: 0, y: 0, z: 0 } });
    vm.flush();
    const first = audio.played.length;
    expect(first).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) vm.update(1 / 60);
    audio.played.length = 0;
    for (let i = 0; i < 10; i++) vm.play('smg', { pos: { x: 0, y: 0, z: 0 } });
    vm.flush();
    expect(audio.played.length).toBeGreaterThan(0);
  });

  it('passes everything straight through when disabled', () => {
    vm.enabled = false;
    for (let i = 0; i < 40; i++) vm.play('smg', { pos: { x: 1, y: 0, z: 1 } });
    expect(audio.played.length).toBe(40);
  });

  it('falls back to sane defaults for an unknown cue name', () => {
    vm.play('brand-new-sound-effect');
    vm.flush();
    expect(audio.played.map((p) => p.name)).toContain('brand-new-sound-effect');
  });
});
