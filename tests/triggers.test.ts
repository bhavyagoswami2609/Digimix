import { describe, it, expect } from 'vitest';
import { TriggerDetector } from '../src/gesture/triggers.ts';

describe('Trigger Detector', () => {
  it('fires trigger only after holding for full duration', () => {
    const detector = new TriggerDetector();
    let t = 1000;
    const action = { type: 'play_pause' as const, deckId: 'A' as const };

    // Start hold at t = 1000
    detector.update(true, action, t, 500);

    // Update at 200ms
    const r1 = detector.update(true, action, t + 200, 500);
    expect(r1.hasFired).toBe(false);
    expect(r1.progress).toBeCloseTo(0.4);

    // Update at 400ms
    const r2 = detector.update(true, action, t + 400, 500);
    expect(r2.hasFired).toBe(false);
    expect(r2.progress).toBeCloseTo(0.8);

    // Update at 500ms -> fires!
    const r3 = detector.update(true, action, t + 500, 500);
    expect(r3.hasFired).toBe(true);
    expect(r3.action?.type).toBe('play_pause');
    expect(r3.progress).toBe(1.0);
  });

  it('enforces 800 ms cooldown after firing and requires release', () => {
    const detector = new TriggerDetector();
    let t = 1000;
    const action = { type: 'cue' as const, deckId: 'B' as const };

    // Fire at 1500
    detector.update(true, action, t + 500, 500);

    // Immediate next frame at 1550 still holding -> should not re-fire
    const held = detector.update(true, action, t + 550, 500);
    expect(held.hasFired).toBe(false);

    // Release at 1600
    detector.update(false, action, t + 600, 500);

    // Re-engage at 2000 (only 500ms after firing, cooldown is 800ms) -> should be blocked
    const inCooldown = detector.update(true, action, t + 1000, 500);
    expect(inCooldown.hasFired).toBe(false);
    expect(inCooldown.progress).toBe(0);

    // Re-engage at 2400 (900ms after firing, cooldown expired) -> can start holding again
    const startAgain = detector.update(true, action, t + 1400, 500);
    expect(startAgain.progress).toBeGreaterThanOrEqual(0);
  });
});
