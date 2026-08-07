import { describe, it, expect } from 'vitest';
import { FixedTimestep, FrameStats } from '../src/core/timestep.js';

describe('FixedTimestep', () => {
  it('runs exactly one step for one step of accumulated time', () => {
    const ts = new FixedTimestep({ hz: 60 });
    const steps = [];
    ts.advance(1 / 60, (s) => steps.push(s));
    expect(steps).toEqual([1 / 60]);
  });

  it('runs nothing until a whole step has accumulated', () => {
    const ts = new FixedTimestep({ hz: 60 });
    let n = 0;
    ts.advance(1 / 240, () => n++);   // 240Hz display, 60Hz sim
    expect(n).toBe(0);
    ts.advance(1 / 240, () => n++);
    ts.advance(1 / 240, () => n++);
    expect(n).toBe(0);
    ts.advance(1 / 240, () => n++);   // fourth quarter completes the step
    expect(n).toBe(1);
  });

  it('sub-steps a slow frame so the sim never runs long', () => {
    const ts = new FixedTimestep({ hz: 60 });
    let n = 0;
    ts.advance(3.5 / 60, () => n++);
    expect(n).toBe(3);
  });

  it('flags only the first sub-step, so edge input is consumed once', () => {
    const ts = new FixedTimestep({ hz: 60 });
    const flags = [];
    ts.advance(3.5 / 60, (s, first) => flags.push(first));
    expect(flags).toEqual([true, false, false]);
  });

  // The classic death spiral: a 2-second hitch tries to catch up with 120 steps,
  // which takes longer than 2 seconds, which makes the next hitch bigger.
  it('drops the backlog after a long stall instead of spiralling', () => {
    const ts = new FixedTimestep({ hz: 60, maxSubSteps: 5 });
    let n = 0;
    ts.advance(2.0, () => n++);
    expect(n).toBe(5);
    expect(ts.droppedTime).toBeGreaterThan(1.9 - 5 / 60);
    // next frame starts clean, not still catching up
    n = 0;
    ts.advance(1 / 60, () => n++);
    expect(n).toBe(1);
  });

  it('reports an interpolation alpha inside [0, 1)', () => {
    const ts = new FixedTimestep({ hz: 60 });
    ts.advance(1.5 / 60, () => {});
    expect(ts.alpha).toBeGreaterThanOrEqual(0);
    expect(ts.alpha).toBeLessThan(1);
    expect(ts.alpha).toBeCloseTo(0.5, 5);
  });

  it('slows the sim without special-casing when fed scaled time', () => {
    const ts = new FixedTimestep({ hz: 60 });
    let n = 0;
    for (let i = 0; i < 10; i++) ts.advance((1 / 60) * 0.12, () => n++);  // hit-stop
    expect(n).toBe(1);
  });

  it('changes rate on the fly', () => {
    const ts = new FixedTimestep({ hz: 60 });
    ts.setRate(120);
    expect(ts.step).toBeCloseTo(1 / 120, 9);
    let n = 0;
    ts.advance(1 / 60, () => n++);
    expect(n).toBe(2);
  });

  it('reset() clears the accumulator so a paused game does not bank time', () => {
    const ts = new FixedTimestep({ hz: 60 });
    ts.advance(0.9 / 60, () => {});
    ts.reset();
    let n = 0;
    ts.advance(0.5 / 60, () => n++);
    expect(n).toBe(0);
  });
});

describe('FrameStats', () => {
  it('tracks fps and the 1% low', () => {
    const fs = new FrameStats(120);
    for (let i = 0; i < 120; i++) fs.push(i === 60 ? 90 : 16.6);  // one bad hitch
    expect(fs.fps).toBeGreaterThan(50);
    expect(fs.fps).toBeLessThan(70);
    // the hitch must surface in p99 — averaging it away is how stutter hides
    expect(fs.p99Ms).toBeGreaterThan(50);
  });

  it('survives being read before a full window of samples', () => {
    const fs = new FrameStats(180);
    for (let i = 0; i < 20; i++) fs.push(16);
    expect(Number.isFinite(fs.avgMs)).toBe(true);
    expect(Number.isFinite(fs.p99Ms)).toBe(true);
  });
});
