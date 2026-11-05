import { describe, it, expect } from 'vitest';
import { calculateBeatLengthSec, calculateBeatPhase, getVisibleBeatLines } from '../src/audio/beatgrid.ts';
import { computeSmartSyncTempo, computeBeatAlignment, computeMatchReadout } from '../src/audio/sync.ts';

describe('Beatgrid and Phase', () => {
  it('calculates beat length accurately', () => {
    expect(calculateBeatLengthSec(120)).toBe(0.5);
    expect(calculateBeatLengthSec(60)).toBe(1.0);
    expect(calculateBeatLengthSec(0)).toBe(0);
  });

  it('calculates beat phase normalized to [0, 1)', () => {
    // 120 BPM => 0.5s beat length, first beat at 0.0s
    expect(calculateBeatPhase(0.0, 120, 0.0)).toBeCloseTo(0.0);
    expect(calculateBeatPhase(0.25, 120, 0.0)).toBeCloseTo(0.5);
    expect(calculateBeatPhase(0.5, 120, 0.0)).toBeCloseTo(0.0);
    expect(calculateBeatPhase(0.75, 120, 0.0)).toBeCloseTo(0.5);
  });

  it('generates visible beat lines with downbeats every 4th beat', () => {
    // 120 BPM => 0.5s beat length
    const lines = getVisibleBeatLines(2.0, 2.0, 120, 0.0);
    // Window is 1.0 to 3.0s => beats at 1.0, 1.5, 2.0, 2.5, 3.0
    expect(lines.length).toBeGreaterThanOrEqual(4);
    const downbeats = lines.filter(l => l.isDownbeat);
    expect(downbeats.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Smart Sync', () => {
  it('matches tempo within +/-16% range', () => {
    // Deck A is 120 BPM, Deck B wants to match Deck A (other displayed 120)
    // Deck B has base 124 BPM
    const res = computeSmartSyncTempo(124, 120);
    expect(res.success).toBe(true);
    expect(res.targetPercent).toBeCloseTo(-3.2258, 2);
  });

  it('handles half and double candidates', () => {
    // Deck B has base 60 BPM, other deck displayed is 120 BPM.
    // Doubled base is 120 BPM, requires p = 0%
    const res = computeSmartSyncTempo(60, 120);
    expect(res.success).toBe(true);
    expect(res.newBaseBpm).toBe(120);
    expect(res.targetPercent).toBeCloseTo(0);
  });

  it('fails gracefully when tempos are too far apart', () => {
    // Base 100, target 140 (closest candidate is 40% away, > 16%)
    const res = computeSmartSyncTempo(100, 140);
    expect(res.success).toBe(false);
    expect(res.errorMessage).toBe('These tempos are too far apart to match.');
  });

  it('aligns beat phases without jumping more than half a beat', () => {
    // Deck A phase 0.2, Deck B phase 0.8 => diff = 0.6 => wrapped d = -0.4
    // position delta should be -d * beatLength = -(0.4) * 0.5 = -0.2s
    const align = computeBeatAlignment(0.2, 0.8, 0.5);
    expect(align.positionDeltaSec).toBeCloseTo(-0.2);
  });

  it('computes match readout and detects matched state', () => {
    const unaligned = computeMatchReadout(120.0, 120.5, 0.1, 0.3);
    expect(unaligned.isMatched).toBe(false);
    expect(unaligned.tempoDiffStr).toBe('-0.5 BPM');

    const aligned = computeMatchReadout(124.0, 124.05, 0.5, 0.505);
    expect(aligned.isMatched).toBe(true);
  });
});
