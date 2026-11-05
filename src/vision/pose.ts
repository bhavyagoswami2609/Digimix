import { POSE_CONFIG } from '../config.ts';
import { NormalizedLandmark } from './landmarks.ts';

export type DetectedPoseName =
  | 'thumbs_up'
  | 'fist'
  | 'point'
  | 'peace'
  | 'pinch_index'
  | 'pinch_middle'
  | 'pinch_ring'
  | 'pinch_pinky'
  | 'open'
  | 'none';

export interface FingerMetrics {
  r: { index: number; middle: number; ring: number; pinky: number };
  d: { index: number; middle: number; ring: number; pinky: number };
  extended: { index: boolean; middle: boolean; ring: boolean; pinky: boolean };
  curled: { index: boolean; middle: boolean; ring: boolean; pinky: boolean };
}

/**
 * Computes r and d metrics for hand landmarks in pixel units according to Section 6.
 */
export function computeFingerMetrics(
  landmarks: NormalizedLandmark[],
  videoWidth = 640,
  videoHeight = 360
): FingerMetrics | null {
  if (!landmarks || landmarks.length < 21) return null;

  // Convert to pixel units (mirrored X)
  const pts = landmarks.map((lm) => ({
    x: (1 - lm.x) * videoWidth,
    y: lm.y * videoHeight
  }));

  const wrist = pts[0];
  const midBase = pts[9];
  const s = Math.hypot(wrist.x - midBase.x, wrist.y - midBase.y);
  if (s <= 0) return null;

  const thumbTip = pts[4];

  const fingers = [
    { key: 'index', base: pts[5], tip: pts[8] },
    { key: 'middle', base: pts[9], tip: pts[12] },
    { key: 'ring', base: pts[13], tip: pts[16] },
    { key: 'pinky', base: pts[17], tip: pts[20] }
  ] as const;

  const rObj: Record<string, number> = {};
  const dObj: Record<string, number> = {};
  const extObj: Record<string, boolean> = {};
  const curlObj: Record<string, boolean> = {};

  for (const f of fingers) {
    const distTip = Math.hypot(wrist.x - f.tip.x, wrist.y - f.tip.y);
    const distBase = Math.hypot(wrist.x - f.base.x, wrist.y - f.base.y);
    const r = distBase > 0 ? distTip / distBase : 0;
    const d = Math.hypot(thumbTip.x - f.tip.x, thumbTip.y - f.tip.y) / s;

    rObj[f.key] = r;
    dObj[f.key] = d;
    extObj[f.key] = r > POSE_CONFIG.FINGER_EXTENDED_RATIO;
    curlObj[f.key] = r < POSE_CONFIG.FINGER_CURLED_RATIO;
  }

  return {
    r: rObj as FingerMetrics['r'],
    d: dObj as FingerMetrics['d'],
    extended: extObj as FingerMetrics['extended'],
    curled: curlObj as FingerMetrics['curled']
  };
}

/**
 * Classifies a single frame pose according to Section 6 rules.
 */
export function classifyInstantPose(
  landmarks: NormalizedLandmark[],
  currentEngagedPinch: 'pinch_index' | 'pinch_middle' | 'pinch_ring' | 'pinch_pinky' | null = null,
  videoWidth = 640,
  videoHeight = 360
): DetectedPoseName {
  const metrics = computeFingerMetrics(landmarks, videoWidth, videoHeight);
  if (!metrics) return 'none';

  const { extended, curled, d } = metrics;

  // Convert landmarks to pixel coords for thumb position
  const pts = landmarks.map((lm) => ({
    x: (1 - lm.x) * videoWidth,
    y: lm.y * videoHeight
  }));
  const wrist = pts[0];
  const midBase = pts[9];
  const s = Math.hypot(wrist.x - midBase.x, wrist.y - midBase.y);

  const allFourCurled = curled.index && curled.middle && curled.ring && curled.pinky;
  const allFourExtended = extended.index && extended.middle && extended.ring && extended.pinky;

  // 1. Thumbs up:
  // "All four fingers curled, and the thumb tip is above landmark 2 on screen by more than 0.3 times s"
  // On screen / in image space: lower y means higher on screen. So (pts[2].y - pts[4].y) > 0.3 * s
  const thumbTip = pts[4];
  const thumbJoint2 = pts[2];
  const thumbIsAbove = thumbJoint2.y - thumbTip.y > 0.3 * s;

  if (allFourCurled && thumbIsAbove) {
    return 'thumbs_up';
  }

  // 2. Fist:
  // "All four fingers curled and not thumbs up"
  if (allFourCurled) {
    return 'fist';
  }

  // 3. Point:
  // "Index extended, middle, ring and pinky curled, and d(index) above the pinch release value. The thumb may rest against the curled fingers"
  if (
    extended.index &&
    curled.middle &&
    curled.ring &&
    curled.pinky &&
    d.index > POSE_CONFIG.PINCH_RELEASE_DISTANCE
  ) {
    return 'point';
  }

  // 4. Peace:
  // "Index and middle extended, ring and pinky curled. The thumb may rest on the ring and pinky"
  if (extended.index && extended.middle && curled.ring && curled.pinky) {
    return 'peace';
  }

  // 5. Pinch (index, middle, ring or pinky):
  // "The nearest fingertip to the thumb tip has d below 0.28 to engage and stays engaged until d rises above 0.45.
  // The second nearest fingertip must be at least 0.15 farther away. At least two of the other three fingers must not be curled"
  const pinchCandidates = [
    { name: 'pinch_index' as const, key: 'index' as const, d: d.index },
    { name: 'pinch_middle' as const, key: 'middle' as const, d: d.middle },
    { name: 'pinch_ring' as const, key: 'ring' as const, d: d.ring },
    { name: 'pinch_pinky' as const, key: 'pinky' as const, d: d.pinky }
  ];

  pinchCandidates.sort((a, b) => a.d - b.d);
  const nearest = pinchCandidates[0];
  const secondNearest = pinchCandidates[1];

  const engageThreshold = POSE_CONFIG.PINCH_ENGAGE_DISTANCE; // 0.28
  const releaseThreshold = POSE_CONFIG.PINCH_RELEASE_DISTANCE; // 0.45

  const isCurrentPinch = currentEngagedPinch === nearest.name;
  const satisfiesDistance = isCurrentPinch ? nearest.d <= releaseThreshold : nearest.d <= engageThreshold;
  const satisfiesMargin = secondNearest.d - nearest.d >= POSE_CONFIG.PINCH_MARGIN; // 0.15

  // "At least two of the other three fingers must not be curled"
  let otherNotCurledCount = 0;
  for (const c of pinchCandidates) {
    if (c.key !== nearest.key) {
      if (!curled[c.key]) otherNotCurledCount++;
    }
  }

  if (satisfiesDistance && satisfiesMargin && otherNotCurledCount >= 2) {
    return nearest.name;
  }

  // 6. Open:
  // "All four fingers extended"
  if (allFourExtended) {
    return 'open';
  }

  return 'none';
}

/**
 * Debounces pose detection over 3 consecutive frames as specified in Section 6:
 * "A pose must be seen for 3 consecutive frames before it counts, and must be absent for 3 consecutive frames before it ends."
 */
export class DebouncedPoseDetector {
  private activePose: DetectedPoseName = 'none';
  private candidatePose: DetectedPoseName = 'none';
  private candidateCount = 0;
  private absentCount = 0;

  update(
    landmarks: NormalizedLandmark[],
    currentPinch: 'pinch_index' | 'pinch_middle' | 'pinch_ring' | 'pinch_pinky' | null = null,
    videoWidth = 640,
    videoHeight = 360
  ): DetectedPoseName {
    const raw = classifyInstantPose(landmarks, currentPinch, videoWidth, videoHeight);

    if (raw === this.activePose) {
      this.absentCount = 0;
      this.candidateCount = 0;
      return this.activePose;
    }

    // Hand pose is absent/different from activePose
    if (this.activePose !== 'none') {
      this.absentCount++;
      if (this.absentCount >= POSE_CONFIG.POSE_END_FRAMES) {
        this.activePose = 'none';
        this.absentCount = 0;
      }
    }

    if (raw === this.candidatePose) {
      this.candidateCount++;
      if (this.candidateCount >= POSE_CONFIG.POSE_CONFIRM_FRAMES) {
        this.activePose = raw;
        this.candidateCount = 0;
        this.absentCount = 0;
      }
    } else {
      this.candidatePose = raw;
      this.candidateCount = 1;
    }

    return this.activePose;
  }

  getActivePose(): DetectedPoseName {
    return this.activePose;
  }

  reset() {
    this.activePose = 'none';
    this.candidatePose = 'none';
    this.candidateCount = 0;
    this.absentCount = 0;
  }
}
