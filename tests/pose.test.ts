import { describe, it, expect } from 'vitest';
import { classifyInstantPose, DebouncedPoseDetector } from '../src/vision/pose.ts';
import { NormalizedLandmark } from '../src/vision/landmarks.ts';

/**
 * Creates synthetic 21 landmarks for testing poses
 */
function createSyntheticLandmarks(config: {
  thumbTip: { x: number; y: number };
  thumbJoint2?: { x: number; y: number };
  fingers: {
    index: { ext: boolean; tipX?: number; tipY?: number };
    middle: { ext: boolean; tipX?: number; tipY?: number };
    ring: { ext: boolean; tipX?: number; tipY?: number };
    pinky: { ext: boolean; tipX?: number; tipY?: number };
  };
}): NormalizedLandmark[] {
  const lms: NormalizedLandmark[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  // Wrist at (0.5, 0.8)
  lms[0] = { x: 0.5, y: 0.8 };

  // Middle base (landmark 9) at (0.5, 0.5) => s = 0.3 * 360 = 108px
  lms[9] = { x: 0.5, y: 0.5 };

  // Bases
  lms[5] = { x: 0.45, y: 0.52 }; // index base
  lms[13] = { x: 0.55, y: 0.52 }; // ring base
  lms[17] = { x: 0.60, y: 0.55 }; // pinky base

  // Thumb
  lms[2] = config.thumbJoint2 || { x: 0.40, y: 0.65 };
  lms[4] = config.thumbTip;

  // Finger tips: extended (tip far from wrist, r > 1.6) vs curled (tip close to base, r < 1.3)
  // Index (tip 8)
  if (config.fingers.index.ext) {
    lms[8] = { x: config.fingers.index.tipX ?? 0.45, y: config.fingers.index.tipY ?? 0.2 };
  } else {
    lms[8] = { x: config.fingers.index.tipX ?? 0.45, y: config.fingers.index.tipY ?? 0.56 };
  }

  // Middle (tip 12)
  if (config.fingers.middle.ext) {
    lms[12] = { x: config.fingers.middle.tipX ?? 0.50, y: config.fingers.middle.tipY ?? 0.18 };
  } else {
    lms[12] = { x: config.fingers.middle.tipX ?? 0.50, y: config.fingers.middle.tipY ?? 0.55 };
  }

  // Ring (tip 16)
  if (config.fingers.ring.ext) {
    lms[16] = { x: config.fingers.ring.tipX ?? 0.55, y: config.fingers.ring.tipY ?? 0.20 };
  } else {
    lms[16] = { x: config.fingers.ring.tipX ?? 0.55, y: config.fingers.ring.tipY ?? 0.56 };
  }

  // Pinky (tip 20)
  if (config.fingers.pinky.ext) {
    lms[20] = { x: config.fingers.pinky.tipX ?? 0.60, y: config.fingers.pinky.tipY ?? 0.24 };
  } else {
    lms[20] = { x: config.fingers.pinky.tipX ?? 0.60, y: config.fingers.pinky.tipY ?? 0.58 };
  }

  return lms;
}

describe('Pose Recognition', () => {
  it('recognizes Thumbs Up when all 4 fingers curled and thumb tip is high', () => {
    const lms = createSyntheticLandmarks({
      thumbTip: { x: 0.40, y: 0.30 }, // High above landmark 2 (y=0.65)
      thumbJoint2: { x: 0.40, y: 0.65 },
      fingers: {
        index: { ext: false },
        middle: { ext: false },
        ring: { ext: false },
        pinky: { ext: false }
      }
    });

    expect(classifyInstantPose(lms)).toBe('thumbs_up');
  });

  it('recognizes Fist when all 4 fingers curled and not thumbs up', () => {
    const lms = createSyntheticLandmarks({
      thumbTip: { x: 0.42, y: 0.60 }, // Rested against fingers, not high
      thumbJoint2: { x: 0.40, y: 0.62 },
      fingers: {
        index: { ext: false },
        middle: { ext: false },
        ring: { ext: false },
        pinky: { ext: false }
      }
    });

    expect(classifyInstantPose(lms)).toBe('fist');
  });

  it('recognizes Point when index extended and other 3 curled and d(index) > 0.45', () => {
    const lms = createSyntheticLandmarks({
      thumbTip: { x: 0.50, y: 0.60 }, // thumb tucked
      fingers: {
        index: { ext: true, tipX: 0.45, tipY: 0.15 }, // extended forward
        middle: { ext: false },
        ring: { ext: false },
        pinky: { ext: false }
      }
    });

    expect(classifyInstantPose(lms)).toBe('point');
  });

  it('recognizes Peace when index and middle extended, ring and pinky curled', () => {
    const lms = createSyntheticLandmarks({
      thumbTip: { x: 0.55, y: 0.60 },
      fingers: {
        index: { ext: true },
        middle: { ext: true },
        ring: { ext: false },
        pinky: { ext: false }
      }
    });

    expect(classifyInstantPose(lms)).toBe('peace');
  });

  it('recognizes Index Pinch when thumb touches index and other fingers extended', () => {
    const lms = createSyntheticLandmarks({
      thumbTip: { x: 0.45, y: 0.30 },
      fingers: {
        index: { ext: true, tipX: 0.45, tipY: 0.31 }, // d < 0.28
        middle: { ext: true, tipX: 0.50, tipY: 0.15 }, // far away
        ring: { ext: true, tipX: 0.55, tipY: 0.18 },
        pinky: { ext: true, tipX: 0.60, tipY: 0.22 }
      }
    });

    expect(classifyInstantPose(lms)).toBe('pinch_index');
  });

  it('distinguishes near misses: fist vs pinch', () => {
    // If middle, ring, pinky are curled, pinch requires at least 2 other fingers NOT curled
    const lms = createSyntheticLandmarks({
      thumbTip: { x: 0.45, y: 0.64 },
      thumbJoint2: { x: 0.40, y: 0.62 },
      fingers: {
        index: { ext: false, tipX: 0.45, tipY: 0.64 },
        middle: { ext: false },
        ring: { ext: false },
        pinky: { ext: false }
      }
    });

    // Should classify as fist, NOT pinch, because other fingers are curled
    expect(classifyInstantPose(lms)).toBe('fist');
  });

  it('debounces pose detection over 3 consecutive frames', () => {
    const detector = new DebouncedPoseDetector();
    const peaceLms = createSyntheticLandmarks({
      thumbTip: { x: 0.55, y: 0.60 },
      fingers: { index: { ext: true }, middle: { ext: true }, ring: { ext: false }, pinky: { ext: false } }
    });

    // Frame 1: not yet active
    expect(detector.update(peaceLms)).toBe('none');
    // Frame 2: not yet active
    expect(detector.update(peaceLms)).toBe('none');
    // Frame 3: confirmed!
    expect(detector.update(peaceLms)).toBe('peace');
  });
});
