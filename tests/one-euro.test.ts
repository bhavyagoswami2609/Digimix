import { describe, it, expect } from 'vitest';
import { OneEuroFilter } from '../src/vision/one-euro.ts';

describe('One Euro Filter', () => {
  it('smooths a noisy stationary series', () => {
    const filter = new OneEuroFilter(1.5, 10, 1.0);
    const dt = 1 / 60; // 60 FPS
    let t = 0;

    const baseVal = 0.5;
    const noisySamples: number[] = [];
    const filteredSamples: number[] = [];

    // 60 samples with +/- 0.05 jitter around 0.5
    for (let i = 0; i < 60; i++) {
      const noise = (Math.sin(i * 1.7) * 0.05);
      const val = baseVal + noise;
      noisySamples.push(val);
      filteredSamples.push(filter.filter(val, t));
      t += dt;
    }

    // Variance of the last 30 filtered samples should be much lower than raw noise
    const lastNoisy = noisySamples.slice(30);
    const lastFiltered = filteredSamples.slice(30);

    const varNoisy = lastNoisy.reduce((sum, v) => sum + Math.pow(v - baseVal, 2), 0) / 30;
    const varFiltered = lastFiltered.reduce((sum, v) => sum + Math.pow(v - baseVal, 2), 0) / 30;

    expect(varFiltered).toBeLessThan(varNoisy * 0.4);
  });

  it('tracks a fast step change with little lag (high responsiveness via beta)', () => {
    const filter = new OneEuroFilter(1.5, 10, 1.0);
    const dt = 1 / 60;
    let t = 0;

    // Start at 0.2 for 10 frames
    for (let i = 0; i < 10; i++) {
      filter.filter(0.2, t);
      t += dt;
    }

    // Sudden step to 0.8
    let reached90Pct = false;
    let framesToReach = 0;

    for (let i = 0; i < 15; i++) {
      const f = filter.filter(0.8, t);
      t += dt;
      framesToReach++;
      if (f >= 0.74) { // 90% of the step from 0.2 to 0.8
        reached90Pct = true;
        break;
      }
    }

    expect(reached90Pct).toBe(true);
    // Should adapt rapidly within 6 frames (< 100ms at 60fps)
    expect(framesToReach).toBeLessThanOrEqual(6);
  });
});
