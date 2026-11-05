import { describe, it, expect } from 'vitest';
import { volumeCurve, crossfaderEqualPower, eqCurve, tempoCurve } from '../src/audio/curves.ts';

describe('Audio curves', () => {
  it('volume curve squares u and clamps', () => {
    expect(volumeCurve(0)).toBe(0);
    expect(volumeCurve(1)).toBe(1);
    expect(volumeCurve(0.5)).toBeCloseTo(0.25);
    expect(volumeCurve(0.75)).toBeCloseTo(0.5625);
    expect(volumeCurve(-0.5)).toBe(0);
    expect(volumeCurve(1.5)).toBe(1);
  });

  it('equal power crossfader at 0, 0.5, 1', () => {
    const at0 = crossfaderEqualPower(0);
    expect(at0.gainA).toBeCloseTo(1);
    expect(at0.gainB).toBeCloseTo(0);

    const atHalf = crossfaderEqualPower(0.5);
    expect(atHalf.gainA).toBeCloseTo(Math.cos(Math.PI / 4));
    expect(atHalf.gainB).toBeCloseTo(Math.sin(Math.PI / 4));
    // Equal power sum of squares equals 1
    expect(atHalf.gainA * atHalf.gainA + atHalf.gainB * atHalf.gainB).toBeCloseTo(1);

    const at1 = crossfaderEqualPower(1);
    expect(at1.gainA).toBeCloseTo(0);
    expect(at1.gainB).toBeCloseTo(1);
  });

  it('EQ mapping handles positive, negative and off display', () => {
    const mid = eqCurve(0.5);
    expect(mid.db).toBeCloseTo(0);
    expect(mid.isOff).toBe(false);
    expect(mid.displayStr).toBe('0.0 dB');

    const max = eqCurve(1.0);
    expect(max.db).toBeCloseTo(6);
    expect(max.displayStr).toBe('+6.0 dB');

    const min = eqCurve(0.0);
    expect(min.db).toBeCloseTo(-26);
    expect(min.isOff).toBe(true);
    expect(min.displayStr).toBe('Off');
  });

  it('tempo curve calculates percent and playback rate', () => {
    const neutral = tempoCurve(0.5);
    expect(neutral.percent).toBeCloseTo(0);
    expect(neutral.playbackRate).toBeCloseTo(1.0);
    expect(neutral.displayStr).toBe('+0.0%');

    const fast = tempoCurve(1.0);
    expect(fast.percent).toBeCloseTo(16);
    expect(fast.playbackRate).toBeCloseTo(1.16);
    expect(fast.displayStr).toBe('+16.0%');

    const slow = tempoCurve(0.0);
    expect(slow.percent).toBeCloseTo(-16);
    expect(slow.playbackRate).toBeCloseTo(0.84);
    expect(slow.displayStr).toBe('-16.0%');
  });
});
