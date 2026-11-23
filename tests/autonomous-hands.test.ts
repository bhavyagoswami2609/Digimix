import { describe, it, expect, beforeEach } from 'vitest';
import { appStore } from '../src/app/store.ts';
import { GestureController } from '../src/gesture/controller.ts';
import { TrackedHand } from '../src/vision/tracker-client.ts';
import { OneEuroPoint2D } from '../src/vision/one-euro.ts';
import { NormalizedLandmark, assignDeck } from '../src/vision/landmarks.ts';

function createMockLandmarks(
  pose: 'pinch_index' | 'pinch_middle' | 'peace' | 'open' | 'spiderman_inward' | 'spiderman_outward' | 'point' | 'fist' | 'rotate_left' | 'rotate_right'
): NormalizedLandmark[] {
  // 21 landmarks
  // Wrist at (0.5, 0.5)
  const lms: NormalizedLandmark[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));

  // Set wrist (0) and middle knuckle (9) to define scale s
  lms[0] = { x: 0.5, y: 0.7, z: 0 };
  lms[9] = { x: 0.5, y: 0.5, z: 0 }; // distance = 0.2 * 360 = 72px

  if (pose === 'rotate_left') {
    // Hand rotated towards the left: knuckles and tips point to the left of wrist in mirrored space
    lms[0] = { x: 0.5, y: 0.7, z: 0 }; // mirrored x = 0.5
    lms[9] = { x: 0.75, y: 0.65, z: 0 }; // mirrored x = 0.25 (to the left of 0.5)
    lms[8] = { x: 0.85, y: 0.60, z: 0 }; // mirrored x = 0.15
    lms[12] = { x: 0.90, y: 0.65, z: 0 }; // mirrored x = 0.10
    lms[4] = { x: 0.65, y: 0.60, z: 0 };
  } else if (pose === 'rotate_right') {
    // Hand rotated towards the right: knuckles and tips point to the right of wrist in mirrored space
    lms[0] = { x: 0.5, y: 0.7, z: 0 }; // mirrored x = 0.5
    lms[9] = { x: 0.25, y: 0.65, z: 0 }; // mirrored x = 0.75 (to the right of 0.5)
    lms[8] = { x: 0.15, y: 0.60, z: 0 }; // mirrored x = 0.85
    lms[12] = { x: 0.10, y: 0.65, z: 0 }; // mirrored x = 0.90
    lms[4] = { x: 0.35, y: 0.60, z: 0 };
  } else if (pose === 'open') {
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
  } else if (pose === 'pinch_middle') {
    // Thumb tip (4) and Middle tip (12) touch each other (Bass EQ)
    lms[4] = { x: 0.50, y: 0.35, z: 0 };
    lms[12] = { x: 0.50, y: 0.35, z: 0 };
    // Index, ring, pinky extended
    lms[8] = { x: 0.45, y: 0.2, z: 0 };
    lms[16] = { x: 0.55, y: 0.2, z: 0 };
    lms[20] = { x: 0.60, y: 0.25, z: 0 };
  } else if (pose === 'peace') {
    // Index and middle extended, ring and pinky curled (Tempo)
    lms[8] = { x: 0.45, y: 0.2, z: 0 };
    lms[12] = { x: 0.50, y: 0.18, z: 0 };
    lms[16] = { x: 0.55, y: 0.55, z: 0 };
    lms[20] = { x: 0.60, y: 0.55, z: 0 };
    lms[4] = { x: 0.55, y: 0.55, z: 0 };
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
  pose: 'pinch_index' | 'pinch_middle' | 'peace' | 'open' | 'spiderman_inward' | 'spiderman_outward' | 'point' | 'fist' | 'rotate_left' | 'rotate_right'
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
    appStore.setDeckControl('A', 'bass', 0.5);
    appStore.setDeckControl('B', 'bass', 0.5);
    appStore.setActiveControl('A', null);
    appStore.setActiveControl('B', null);
    appStore.setCrossfader(0.5);
    appStore.setActiveCrossfader(false);
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

  it('while paused, rotates hand towards the left to restart song from the beginning and play', () => {
    // Set position to 45 seconds and paused
    appStore.setDeckPosition('A', 45);
    appStore.setTransportPlaying('A', false);

    const handA = createTrackedHand(1, 'A', 0.30, 0.50, 'rotate_left');
    controller.processFrame([handA], 1000);

    const state = appStore.getState();
    // Restarted to 0 and playing
    expect(state.decks.A.currentPositionSec).toBe(0);
    expect(state.decks.A.isPlaying).toBe(true);
  });

  it('while paused, rotates hand towards the right to jump to hot cue point while remaining paused', () => {
    // Deck is paused at 45 seconds, with a hot cue set at 15 seconds
    appStore.setDeckPosition('A', 45);
    appStore.setHotCuePosition('A', 15);
    appStore.setTransportPlaying('A', false);

    const handA = createTrackedHand(1, 'A', 0.30, 0.50, 'rotate_right');
    controller.processFrame([handA], 1000);

    const state = appStore.getState();
    // Jumped to hot cue 15s and remains paused
    expect(state.decks.A.currentPositionSec).toBe(15);
    expect(state.decks.A.isPlaying).toBe(false);
  });

  it('while playing, rotations do not trigger restart or cue jump', () => {
    // Deck is playing at 45 seconds
    appStore.setDeckPosition('A', 45);
    appStore.setTransportPlaying('A', true);

    const handA = createTrackedHand(1, 'A', 0.30, 0.50, 'rotate_left');
    controller.processFrame([handA], 1000);

    const state = appStore.getState();
    // Position remains 45 and continues playing
    expect(state.decks.A.currentPositionSec).toBe(45);
    expect(state.decks.A.isPlaying).toBe(true);
  });

  it('keeps playback position when paused and resumed with open hand', () => {
    // Deck starts at 30 seconds
    appStore.setDeckPosition('A', 30);
    appStore.setTransportPlaying('A', false);

    const handA = createTrackedHand(1, 'A', 0.30, 0.50, 'open');
    controller.processFrame([handA], 1000);

    const state = appStore.getState();
    // Starts playing from 30 seconds, does NOT reset to 0
    expect(state.decks.A.isPlaying).toBe(true);
    expect(state.decks.A.currentPositionSec).toBe(30);
  });

  it('pauses playback when playing and open hand gesture is performed', () => {
    // Deck starts at 50 seconds and is playing
    appStore.setDeckPosition('A', 50);
    appStore.setTransportPlaying('A', true);

    const handA = createTrackedHand(1, 'A', 0.30, 0.50, 'open');
    controller.processFrame([handA], 1000);

    const state = appStore.getState();
    // Pauses playback and keeps position at 50 seconds
    expect(state.decks.A.isPlaying).toBe(false);
    expect(state.decks.A.currentPositionSec).toBe(50);
  });

  it('while playing, rotate_right does not trigger hot cue jump and keeps playing', () => {
    // Deck is playing at 50 seconds with hot cue at 15 seconds
    appStore.setDeckPosition('A', 50);
    appStore.setHotCuePosition('A', 15);
    appStore.setTransportPlaying('A', true);

    const handA = createTrackedHand(1, 'A', 0.30, 0.50, 'rotate_right');
    controller.processFrame([handA], 1000);

    const state = appStore.getState();
    // Position remains 50 (did not jump to 15) and continues playing
    expect(state.decks.A.currentPositionSec).toBe(50);
    expect(state.decks.A.isPlaying).toBe(true);
  });

  it('two hands on the left side of the screen strictly control Deck A without misassigning Deck B', () => {
    // Two hands both on the left side of the camera view (x = 0.20 and x = 0.35)
    const hand1 = createTrackedHand(1, 'A', 0.20, 0.50, 'pinch_index'); // Volume
    const hand2 = createTrackedHand(2, 'A', 0.35, 0.50, 'pinch_middle'); // Bass

    let t = 1000;
    // Debounce 3 frames
    for (let f = 0; f < 3; f++) {
      controller.processFrame([hand1, hand2], t);
      t += 33;
    }

    // Advance past 120ms arming period
    t += 150;
    controller.processFrame([hand1, hand2], t);

    // Hand 1 moves up -> Deck A volume increases
    hand1.smoothedPalmCenter.y = 0.40;
    // Hand 2 moves down -> Deck A bass decreases
    hand2.smoothedPalmCenter.y = 0.60;

    t += 33;
    controller.processFrame([hand1, hand2], t);

    const state = appStore.getState();
    // Deck A volume increased above 0.75
    expect(state.decks.A.volume).toBeGreaterThan(0.75);
    // Deck A bass decreased below 0.50
    expect(state.decks.A.bass).toBeLessThan(0.50);

    // Deck B controls are completely untouched
    expect(state.decks.B.volume).toBe(0.75);
    expect(state.decks.B.bass).toBe(0.50);
    expect(state.decks.B.activeControl).toBeNull();
  });

  it('two hands on the left side arbitrate identical control grabs cleanly', () => {
    // Hand 1 and Hand 2 both on left side trying to grab Volume (pinch_index)
    const hand1 = createTrackedHand(1, 'A', 0.20, 0.50, 'pinch_index');
    const hand2 = createTrackedHand(2, 'A', 0.35, 0.50, 'pinch_index');

    let t = 1000;
    // Debounce
    for (let f = 0; f < 3; f++) {
      controller.processFrame([hand1, hand2], t);
      t += 33;
    }
    t += 150;
    controller.processFrame([hand1, hand2], t);

    // Hand 1 owns the arbitration for A_volume
    expect(controller.getActiveDeckForHand(1)).toBe('A');

    // Hand 1 moves up
    hand1.smoothedPalmCenter.y = 0.40;
    // Hand 2 moves down (should be ignored by arbitration)
    hand2.smoothedPalmCenter.y = 0.70;

    t += 33;
    controller.processFrame([hand1, hand2], t);

    const state = appStore.getState();
    // Controlled by Hand 1
    expect(state.decks.A.volume).toBeGreaterThan(0.75);
  });

  it('two hands on the right side of the screen strictly control Deck B without affecting Deck A', () => {
    // Both hands on right side of camera view (x = 0.65 and x = 0.80)
    appStore.setDeckPosition('B', 40);
    appStore.setTransportPlaying('B', false);
    appStore.setDeckPosition('A', 25);
    appStore.setTransportPlaying('A', false);

    const hand1 = createTrackedHand(1, 'B', 0.65, 0.50, 'rotate_left');
    controller.processFrame([hand1], 1000);

    const state = appStore.getState();
    // Deck B restarted to 0 and is playing
    expect(state.decks.B.currentPositionSec).toBe(0);
    expect(state.decks.B.isPlaying).toBe(true);

    // Deck A remains completely untouched
    expect(state.decks.A.currentPositionSec).toBe(25);
    expect(state.decks.A.isPlaying).toBe(false);
  });

  it('spatial boundary hysteresis prevents toggling when moving near the center deadband', () => {
    // Test boundary hysteresis progression across deadband [0.47, 0.53]
    let currentDeck: 'A' | 'B' | null = null;

    // Start clearly on the left
    currentDeck = assignDeck(0.30, currentDeck);
    expect(currentDeck).toBe('A');

    // Move into the deadband at 0.48
    currentDeck = assignDeck(0.48, currentDeck);
    expect(currentDeck).toBe('A');

    // Move further into deadband near right edge at 0.52
    currentDeck = assignDeck(0.52, currentDeck);
    expect(currentDeck).toBe('A'); // Hysteresis preserves Deck A!

    // Cross boundary past 0.53 to 0.55
    currentDeck = assignDeck(0.55, currentDeck);
    expect(currentDeck).toBe('B'); // Now switches to Deck B!

    // Move back into deadband at 0.51
    currentDeck = assignDeck(0.51, currentDeck);
    expect(currentDeck).toBe('B'); // Hysteresis preserves Deck B!

    // Move further into deadband near left edge at 0.48
    currentDeck = assignDeck(0.48, currentDeck);
    expect(currentDeck).toBe('B'); // Still preserves Deck B!

    // Cross boundary past 0.47 to 0.44
    currentDeck = assignDeck(0.44, currentDeck);
    expect(currentDeck).toBe('A'); // Now switches back to Deck A!
  });
});
