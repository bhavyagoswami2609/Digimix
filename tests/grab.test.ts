import { describe, it, expect } from 'vitest';
import { GrabController } from '../src/gesture/grab.ts';

describe('Grab Controller', () => {
  it('enforces 120 ms arming period where nothing changes', () => {
    const controller = new GrabController();
    const t0 = 1000;
    controller.startGrab({ type: 'deck', deckId: 'A', control: 'volume' }, 0.75, 0.5, 0.5, t0);

    // At 50ms (within 120ms arming), hand moves but output should be null (no value change)
    const updateEarly = controller.updateGrab(0.5, 0.4, t0 + 50);
    expect(updateEarly).toBeNull();

    // At 130ms (armed), anchor is locked at (0.5, 0.5)
    controller.updateGrab(0.5, 0.5, t0 + 130);

    // At 180ms, hand moves up by 0.1 to 0.4
    const updateArmed = controller.updateGrab(0.5, 0.4, t0 + 180);
    expect(updateArmed).not.toBeNull();
    expect(updateArmed?.hasValueChange).toBe(true);
  });

  it('calculates relative movement clamped to [0, 1]', () => {
    const controller = new GrabController();
    const t0 = 1000;
    // Volume starts at 0.5, travel is 0.35
    controller.startGrab({ type: 'deck', deckId: 'A', control: 'volume' }, 0.5, 0.5, 0.5, t0);

    // Arm it
    controller.updateGrab(0.5, 0.5, t0 + 130);

    // Move up by 0.175 (half of 0.35 travel) => +0.5 to u => u = 1.0
    const update1 = controller.updateGrab(0.5, 0.5 - 0.175, t0 + 200);
    expect(update1?.newU).toBeCloseTo(1.0);

    // Move further up by 0.30 => clamped to 1.0
    const updateClamped = controller.updateGrab(0.5, 0.5 - 0.30, t0 + 250);
    expect(updateClamped?.newU).toBe(1.0);
  });

  it('snaps to default when within 0.02 detent', () => {
    const controller = new GrabController();
    const t0 = 1000;
    // Bass default is 0.50
    controller.startGrab({ type: 'deck', deckId: 'A', control: 'bass' }, 0.40, 0.5, 0.5, t0);
    controller.updateGrab(0.5, 0.5, t0 + 130);

    // Move so calculated u is 0.51 (within 0.02 of 0.50)
    // delta = 0.11 * 0.35 = 0.0385
    const updateDetent = controller.updateGrab(0.5, 0.5 - 0.0385, t0 + 200);
    expect(updateDetent?.newU).toBe(0.50);
  });

  it('detects tap and double-tap reset', () => {
    const controller = new GrabController();
    let t = 1000;

    // First tap: lasts 100ms with movement 0.01 (< 0.03)
    controller.startGrab({ type: 'deck', deckId: 'A', control: 'volume' }, 0.8, 0.5, 0.5, t);
    controller.updateGrab(0.5, 0.505, t + 50);
    const end1 = controller.endGrab(t + 100);
    expect(end1?.isReset).toBe(false);

    // Second tap starts 200ms later (within 600ms gap)
    t = 1300;
    controller.startGrab({ type: 'deck', deckId: 'A', control: 'volume' }, 0.8, 0.5, 0.5, t);
    controller.updateGrab(0.5, 0.505, t + 50);
    const end2 = controller.endGrab(t + 100);
    expect(end2?.isReset).toBe(true);
  });
});
