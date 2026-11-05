import { describe, it, expect } from 'vitest';
import { assignDeck, calculatePalmCenter, videoToScreen } from '../src/vision/landmarks.ts';

describe('Landmarks and Coordinate Mapping', () => {
  it('correctly maps normalized video coordinates to screen with cover crop and mirroring', () => {
    // 16:9 video in 16:9 screen (no crop)
    const pt = videoToScreen(0.2, 0.5, 1280, 720, 1280, 720);
    // normX=0.2 mirrored is 0.8 => 0.8 * 1280 = 1024
    expect(pt.x).toBeCloseTo(1024);
    expect(pt.y).toBeCloseTo(360);
  });

  it('calculates mirrored palm center from landmarks 0, 5, 9, 13, 17', () => {
    const mockLandmarks = Array.from({ length: 21 }, () => ({ x: 0.3, y: 0.4 }));
    const palm = calculatePalmCenter(mockLandmarks);
    // raw x = 0.3 => mirrored x = 0.7
    expect(palm.x).toBeCloseTo(0.7);
    expect(palm.y).toBeCloseTo(0.4);
  });

  it('assigns deck A and B with dead band [0.47, 0.53]', () => {
    // Clear left
    expect(assignDeck(0.3, null)).toBe('A');
    // Clear right
    expect(assignDeck(0.7, null)).toBe('B');

    // Inside dead band: 0.50
    // If currently A, stays A
    expect(assignDeck(0.50, 'A')).toBe('A');
    // If currently B, stays B
    expect(assignDeck(0.50, 'B')).toBe('B');
    // If unassigned inside dead band, splits at 0.5
    expect(assignDeck(0.48, null)).toBe('A');
    expect(assignDeck(0.52, null)).toBe('B');
  });
});
