import { DeckId } from '../app/store.ts';
import { VISION_CONFIG } from '../config.ts';

export interface NormalizedLandmark {
  x: number;
  y: number;
  z?: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Maps normalized video coordinates to screen pixel coordinates
 * taking into account video mirroring (scaleX(-1)) and object-fit: cover crop.
 */
export function videoToScreen(
  normX: number,
  normY: number,
  videoWidth: number,
  videoHeight: number,
  stageWidth: number,
  stageHeight: number
): ScreenPoint {
  if (videoWidth <= 0 || videoHeight <= 0 || stageWidth <= 0 || stageHeight <= 0) {
    return { x: 0, y: 0 };
  }

  // Mirrored coordinate: x becomes 1 - x
  const mirroredX = 1 - normX;

  const containerAspect = stageWidth / stageHeight;
  const videoAspect = videoWidth / videoHeight;

  let renderedWidth: number;
  let renderedHeight: number;
  let offsetX = 0;
  let offsetY = 0;

  if (containerAspect > videoAspect) {
    // Stage is wider than video aspect: width fits, top/bottom cropped
    renderedWidth = stageWidth;
    renderedHeight = stageWidth / videoAspect;
    offsetY = (stageHeight - renderedHeight) / 2;
  } else {
    // Stage is taller than video aspect: height fits, left/right cropped
    renderedHeight = stageHeight;
    renderedWidth = stageHeight * videoAspect;
    offsetX = (stageWidth - renderedWidth) / 2;
  }

  const screenX = mirroredX * renderedWidth + offsetX;
  const screenY = normY * renderedHeight + offsetY;

  return { x: screenX, y: screenY };
}

/**
 * Calculates palm center as the average of landmarks 0, 5, 9, 13, and 17.
 * Returned in mirrored frame coordinates (x = 1 - rawX).
 */
export function calculatePalmCenter(landmarks: NormalizedLandmark[]): { x: number; y: number } {
  const palmIndices = [0, 5, 9, 13, 17];
  let sumX = 0;
  let sumY = 0;

  for (const idx of palmIndices) {
    const lm = landmarks[idx];
    if (lm) {
      sumX += 1 - lm.x; // mirrored frame X
      sumY += lm.y;
    }
  }

  const count = palmIndices.length;
  return {
    x: sumX / count,
    y: sumY / count
  };
}

/**
 * Assigns hand to Deck A or Deck B using palm centre X in mirrored frame coordinates
 * with dead band [0.47, 0.53].
 */
export function assignDeck(
  palmCenterX: number,
  currentlyAssignedDeck: DeckId | null
): DeckId {
  if (palmCenterX < VISION_CONFIG.DEADBAND_LEFT) {
    return 'A';
  }
  if (palmCenterX > VISION_CONFIG.DEADBAND_RIGHT) {
    return 'B';
  }
  // In the dead band [0.47, 0.53], keep current assignment if present, else fallback based on 0.5
  if (currentlyAssignedDeck !== null) {
    return currentlyAssignedDeck;
  }
  return palmCenterX < 0.5 ? 'A' : 'B';
}

/**
 * Standard MediaPipe Hand Connections for skeleton rendering
 */
export const HAND_CONNECTIONS: [number, number][] = [
  // Thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Index
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Middle
  [0, 9], [9, 10], [10, 11], [11, 12],
  // Ring
  [0, 13], [13, 14], [14, 15], [15, 16],
  // Pinky
  [0, 17], [17, 18], [18, 19], [19, 20],
  // Palm knuckle connections
  [5, 9], [9, 13], [13, 17]
];
