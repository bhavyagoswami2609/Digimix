/**
 * One Euro Filter implementation in normalized frame units per second
 * Based on Casiez et al., 2012: "1 € Filter: A Simple Speed-based Low-pass Filter for Noisy Input in Human-Computer Interaction"
 */

function smoothingFactor(te: number, cutoff: number): number {
  const r = 2 * Math.PI * cutoff * te;
  return r / (r + 1);
}

function exponentialSmoothing(a: number, x: number, xPrev: number): number {
  return a * x + (1 - a) * xPrev;
}

export class LowPassFilter {
  private y: number | null = null;
  private s: number | null = null;

  filter(value: number, alpha: number): number {
    if (this.y === null) {
      this.s = value;
      this.y = value;
      return value;
    }
    this.s = exponentialSmoothing(alpha, value, this.s!);
    this.y = this.s;
    return this.y;
  }

  filterWithAlpha(value: number, alpha: number): number {
    return this.filter(value, alpha);
  }

  hasLast(): boolean {
    return this.y !== null;
  }

  last(): number {
    return this.y ?? 0;
  }

  reset() {
    this.y = null;
    this.s = null;
  }
}

export class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;

  private xFilter = new LowPassFilter();
  private dxFilter = new LowPassFilter();
  private lastTime: number | null = null;

  constructor(minCutoff = 1.5, beta = 10, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  setParams(minCutoff: number, beta: number, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  filter(value: number, timestampSec: number): number {
    if (this.lastTime === null) {
      this.lastTime = timestampSec;
      return this.xFilter.filter(value, 1.0);
    }

    const te = Math.max(1e-4, timestampSec - this.lastTime);
    this.lastTime = timestampSec;

    // Estimate derivative
    const prevX = this.xFilter.hasLast() ? this.xFilter.last() : value;
    const dx = (value - prevX) / te;
    const edx = this.dxFilter.filter(dx, smoothingFactor(te, this.dCutoff));

    // Dynamic cutoff frequency
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.xFilter.filter(value, smoothingFactor(te, cutoff));
  }

  reset() {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.lastTime = null;
  }
}

export class OneEuroPoint2D {
  private filterX: OneEuroFilter;
  private filterY: OneEuroFilter;

  constructor(minCutoff = 1.5, beta = 10, dCutoff = 1.0) {
    this.filterX = new OneEuroFilter(minCutoff, beta, dCutoff);
    this.filterY = new OneEuroFilter(minCutoff, beta, dCutoff);
  }

  setParams(minCutoff: number, beta: number) {
    this.filterX.setParams(minCutoff, beta);
    this.filterY.setParams(minCutoff, beta);
  }

  filter(x: number, y: number, timestampSec: number): { x: number; y: number } {
    return {
      x: this.filterX.filter(x, timestampSec),
      y: this.filterY.filter(y, timestampSec)
    };
  }

  reset() {
    this.filterX.reset();
    this.filterY.reset();
  }
}
