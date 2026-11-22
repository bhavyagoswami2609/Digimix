import { describe, it, expect, beforeEach } from 'vitest';
import { appStore } from '../src/app/store.ts';
import { GestureController } from '../src/gesture/controller.ts';
import { TrackedHand } from '../src/vision/tracker-client.ts';
import { OneEuroPoint2D } from '../src/vision/one-euro.ts';
import { NormalizedLandmark } from '../src/vision/landmarks.ts';

function createMockLandmarks(pose: 'pinch_index' | 'open' | 'spiderman_inward' | 'spiderman_outward' | 'point' | 'fist'): NormalizedLandmark[] {
  // 21 landmarks
  // Wrist at (0.5, 0.5)
  const lms: NormalizedLandmark[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));

  // Set wrist (0) and middle knuckle (9) to define scale s
  lms[0] = { x: 0.5, y: 0.7, z: 0 };
  lms[9] = { x: 0.5, y: 0.5, z: 0 }; // distance = 0.2 * 360 = 72px

  if (pose === 'open') {
    // All fingers extended (tips far from wrist)
    lms[4] = { x: 0.35, y: 0.4, z: 0 };
    lms[8] = { x: 0.45, y: 0.2, z: 0 };
    lms[12] = { x: 0.50, y: 0.18, z: 0 };
    lms[16] = { x: 0.55, y: 0.2, z: 0 };
    lms[20] = { x: 0.60, y: 0.25, z: 0 };
  } else if (pose === 'pinch_index') {
    // Thumb tip (4) and Index tip (8) touch each other
    lms[4] = { x: 0.48, y: 0.35, z: 0 };
    lms[8] = { x: 0.48, y: 0.35, z: 0 };
    // Middle, ring, pinky extended / not curled
    lms[12] = { x: 0.50, y: 0.2, z: 0 };
    lms[16] = { x: 0.55, y: 0.2, z: 0 };
    lms[20] = { x: 0.60, y: 0.25, z: 0 };
  } else if (pose === 'point') {
    // Index extended, others curled
    lms[8] = { x: 0.48, y: 0.2, z: 0 };
    lms[4] = { x: 0.52, y: 0.55, z: 0 };
    lms[12] = { x: 0.50, y: 0.55, z: 0 };
    lms[16] = { x: 0.55, y: 0.55, z: 0 };
    lms[20] = { x: 0.60, y: 0.55, z: 0 };
  } else if (pose === 'spiderman_inward') {
    // Index and pinky extended, middle and ring curled, thumb folded inward near midBase (landmark 9)
    lms[8] = { x: 0.45, y: 0.2, z: 0 };
    lms[20] = { x: 0.60, y: 0.25, z: 0 };
    lms[12] = { x: 0.50, y: 0.55, z: 0 };
    lms[16] = { x: 0.55, y: 0.55, z: 0 };
    lms[4] = { x: 0.50, y: 0.50, z: 0 }; // close to midBase (landmark 9)
  } else if (pose === 'spiderman_outward') {
    // Index and pinky extended, middle and ring curled, thumb extended outward
    lms[8] = { x: 0.45, y: 0.2, z: 0 };
    lms[20] = { x: 0.60, y: 0.25, z: 0 };
    lms[12] = { x: 0.50, y: 0.55, z: 0 };
    lms[16] = { x: 0.55, y: 0.55, z: 0 };
    lms[4] = { x: 0.30, y: 0.40, z: 0 }; // far from midBase
  }

  return lms;
}

function createTrackedHand(
  id: number,
  deckId: 'A' | 'B',
  x: number,
  y: number,
  pose: 'pinch_index' | 'open' | 'spiderman_inward' | 'spiderman_outward' | 'point' | 'fist'
): TrackedHand {
  return {
    id,
    deckId,
    rawLandmarks: createMockLandmarks(pose),
    rawPalmCenter: { x, y },
    smoothedPalmCenter: { x, y },
    lastSeenTime: 1000,
    isInRestZone: false,
    filter: new OneEuroPoint2D(1.2, 0.5)
  };
}

describe('Autonomous Two-Hand Simultaneous Mixing', () => {
  let controller: GestureController;

  beforeEach(() => {
    controller = new GestureController();
    appStore.setDeckControl('A', 'volume', 0.75);
    appStore.setDeckControl('B', 'volume', 0.75);
    appStore.setCrossfader(0.5);
    appStore.setTransportPlaying('A', false);
    appStore.setTransportPlaying('B', false);
  });

  it('allows both hands to simultaneously control Deck A and Deck B volume autonomously', () => {
    const handA = createTrackedHand(1, 'A', 0.30, 0.50, 'pinch_index');
    const handB = createTrackedHand(2, 'B', 0.70, 0.50, 'pinch_index');

    let t = 1000;

    // Frame 1: Hands appear and start pinch
    // Debounce frames (3 frames to confirm pinch pose)
    for (let f = 0; f < 3; f++) {
      controller.processFrame([handA, handB], t);
      t += 33;
    }

    // Advance past the 120ms arming period
    t += 150;
    controller.processFrame([handA, handB], t);

    // Now both hands are armed!
    // Move Hand A upward (y goes from 0.50 to 0.40 => volume increases)
    handA.smoothedPalmCenter.y = 0.40;
    // Move Hand B downward (y goes from 0.50 to 0.60 => volume decreases)
    handB.smoothedPalmCenter.y = 0.60;

    t += 33;
    controller.processFrame([handA, handB], t);

    const state = appStore.getState();
    // Deck A volume increased above 0.75
    expect(state.decks.A.volume).toBeGreaterThan(0.75);
    // Deck B volume decreased below 0.75
    expect(state.decks.B.volume).toBeLessThan(0.75);

    // Verify active arbitrations and active controls
    expect(controller.getActiveDeckForHand(1)).toBe('A');
    expect(controller.getActiveDeckForHand(2)).toBe('B');
    expect(state.decks.A.activeControl).toBe('volume');
    expect(state.decks.B.activeControl).toBe('volume');
  });

  it('allows Hand 1 to control Crossfader while Hand 2 controls Deck B Volume simultaneously', () => {
    const handA = createTrackedHand(1, 'A', 0.30, 0.50, 'point');
    const handB = createTrackedHand(2, 'B', 0.70, 0.50, 'pinch_index');

    let t = 1000;

    // Debounce 3 frames
    for (let f = 0; f < 3; f++) {
      controller.processFrame([handA, handB], t);
      t += 33;
    }

    // Advance past 120ms arming
    t += 150;
    controller.processFrame([handA, handB], t);

    // Move Hand A to the right (x from 0.30 to 0.40 => crossfader moves right)
    handA.smoothedPalmCenter.x = 0.40;
    // Move Hand B upward (y from 0.50 to 0.40 => Deck B volume increases)
    handB.smoothedPalmCenter.y = 0.40;

    t += 33;
    controller.processFrame([handA, handB], t);

    const state = appStore.getState();
    // Crossfader moved to the right (greater than 0.50)
    expect(state.crossfader).toBeGreaterThan(0.50);
    expect(state.activeCrossfader).toBe(true);

    // Deck B volume increased above 0.75
    expect(state.decks.B.volume).toBeGreaterThan(0.75);
    expect(state.decks.B.activeControl).toBe('volume');
  });

  it('allows instantaneous play and hot cue triggers on both decks independently', () => {
    const handA = createTrackedHand(1, 'A', 0.30, 0.50, 'open');
    const handB = createTrackedHand(2, 'B', 0.70, 0.50, 'spiderman_inward');

    const t = 1000;

    // Instantaneous triggers fire on frame 1 without delay
    controller.processFrame([handA, handB], t);

    const state = appStore.getState();
    // Deck A toggled play to true instantly
    expect(state.decks.A.isPlaying).toBe(true);
    // Deck B was not affected by Deck A play trigger
    expect(state.decks.B.isPlaying).toBe(false);
    // Deck B hot cue was set
    expect(state.decks.B.hotCueAction).toBe('set');
  });
});
