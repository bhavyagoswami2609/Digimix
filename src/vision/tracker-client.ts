import { appStore, DeckId } from '../app/store.ts';
import { VISION_CONFIG } from '../config.ts';
import { assignDeck, calculatePalmCenter, NormalizedLandmark } from './landmarks.ts';
import { OneEuroPoint2D } from './one-euro.ts';

export interface TrackedHand {
  id: number;
  rawLandmarks: NormalizedLandmark[];
  rawPalmCenter: { x: number; y: number }; // mirrored frame coords [0, 1]
  smoothedPalmCenter: { x: number; y: number }; // mirrored frame coords [0, 1]
  lastSeenTime: number;
  deckId: DeckId;
  isInRestZone: boolean;
  filter: OneEuroPoint2D;
}

type TrackingCallback = (hands: TrackedHand[], videoWidth: number, videoHeight: number) => void;

export type ActiveDeckQuery = (handId: number) => DeckId | null;

export class TrackerClient {
  private worker: Worker | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private isRunning = false;
  private isWorkerBusy = false;
  private hasPendingFrame = false;
  private nextHandId = 1;

  private activeVisibleHands: TrackedHand[] = [];
  private persistentHands: Map<number, TrackedHand> = new Map();
  private onTrackCallback: TrackingCallback | null = null;
  private activeDeckQuery: ActiveDeckQuery | null = null;

  // Latency & FPS meter
  private latencyRingBuffer: number[] = new Array(60).fill(0);
  private latencyRingIndex = 0;
  private latencySamplesCount = 0;
  private frameCount = 0;
  private lastFpsCalcTime = performance.now();
  private currentFps = 0;

  constructor() {
    this.initWorker();
  }

  private initWorker() {
    try {
      this.worker = new Worker('/tracker.worker.js');
      this.worker.onmessage = (e) => this.handleWorkerMessage(e);
      this.worker.onerror = (err) => {
        appStore.setTrackingMetrics(0, 0, 'failed');
        console.warn('Worker error:', err);
      };
    } catch {
      appStore.setTrackingMetrics(0, 0, 'failed');
    }
  }

  start(videoElement: HTMLVideoElement, onTrack: TrackingCallback) {
    this.videoEl = videoElement;
    this.onTrackCallback = onTrack;
    this.isRunning = true;
    this.hasPendingFrame = false;
    this.scheduleNextFrame();
  }

  stop() {
    this.isRunning = false;
    this.isWorkerBusy = false;
    this.hasPendingFrame = false;
    this.videoEl = null;
    this.onTrackCallback = null;
    this.activeVisibleHands = [];
    this.persistentHands.clear();
  }

  private scheduleNextFrame() {
    if (!this.isRunning || !this.videoEl) return;

    if ('requestVideoFrameCallback' in this.videoEl) {
      // Chrome / Safari modern video frame callback
      (this.videoEl as unknown as { requestVideoFrameCallback: (cb: () => void) => void }).requestVideoFrameCallback(() => {
        if (this.isWorkerBusy) {
          this.hasPendingFrame = true;
        } else {
          this.processFrame();
        }
        this.scheduleNextFrame();
      });
    } else {
      // Fallback requestAnimationFrame
      requestAnimationFrame(() => {
        if (this.isWorkerBusy) {
          this.hasPendingFrame = true;
        } else {
          this.processFrame();
        }
        this.scheduleNextFrame();
      });
    }
  }

  private async processFrame() {
    if (!this.isRunning || !this.videoEl || !this.worker || this.isWorkerBusy) {
      return;
    }

    if (this.videoEl.readyState < 2 || this.videoEl.videoWidth === 0) {
      return;
    }

    const captureTime = performance.now();
    this.isWorkerBusy = true;

    try {
      const vw = this.videoEl.videoWidth || 640;
      const vh = this.videoEl.videoHeight || 360;
      const targetWidth = Math.min(vw, 640);
      const targetHeight = Math.round((targetWidth / vw) * vh);

      const bitmap = await createImageBitmap(this.videoEl, {
        resizeWidth: targetWidth,
        resizeHeight: targetHeight,
        resizeQuality: 'low'
      });

      this.worker.postMessage(
        {
          bitmap,
          timestamp: captureTime,
          captureTime
        },
        [bitmap]
      );
    } catch {
      this.isWorkerBusy = false;
    }
  }

  private handleWorkerMessage(e: MessageEvent) {
    const data = e.data;
    if (!data) return;

    if (data.type === 'ready') {
      appStore.setTrackingMetrics(0, 0, 'active');
      return;
    }

    if (data.type === 'result') {
      this.isWorkerBusy = false;
      const now = performance.now();
      const captureTime = data.captureTime;
      const latency = now - captureTime;

      // Update latency ring buffer
      this.latencyRingBuffer[this.latencyRingIndex] = latency;
      this.latencyRingIndex = (this.latencyRingIndex + 1) % 60;
      if (this.latencySamplesCount < 60) this.latencySamplesCount++;

      // Update FPS calculation
      this.frameCount++;
      if (now - this.lastFpsCalcTime >= 1000) {
        this.currentFps = Math.round((this.frameCount * 1000) / (now - this.lastFpsCalcTime));
        this.frameCount = 0;
        this.lastFpsCalcTime = now;

        const medianLatency = this.calculateMedianLatency();
        appStore.setTrackingMetrics(this.currentFps, medianLatency, 'active');
      }

      // Process hands
      const rawHandsLandmarks: NormalizedLandmark[][] = data.landmarks || [];
      const visibleHands = this.updateTrackedHands(rawHandsLandmarks, now);

      if (this.onTrackCallback && this.videoEl) {
        this.onTrackCallback(visibleHands, this.videoEl.videoWidth, this.videoEl.videoHeight);
      }

      // If a frame arrived while worker was busy, immediately process the latest frame
      if (this.hasPendingFrame && this.isRunning && this.videoEl && this.videoEl.readyState >= 2) {
        this.hasPendingFrame = false;
        this.processFrame();
      }
    }
  }

  private calculateMedianLatency(): number {
    if (this.latencySamplesCount === 0) return 0;
    const sorted = this.latencyRingBuffer.slice(0, this.latencySamplesCount).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  setActiveDeckQuery(fn: ActiveDeckQuery) {
    this.activeDeckQuery = fn;
  }

  private updateTrackedHands(rawHandsLandmarks: NormalizedLandmark[][], now: number): TrackedHand[] {
    const tuning = appStore.getState().tuning;
    const restZoneThresholdY = 1.0 - tuning.restZoneHeight;
    const MAX_MATCH_DIST = 0.28;

    // 1. Remove expired hands from persistent storage (> 250 ms)
    for (const [id, hand] of this.persistentHands.entries()) {
      if (now - hand.lastSeenTime > VISION_CONFIG.HAND_LOST_TIMEOUT_MS) {
        this.persistentHands.delete(id);
      }
    }

    // 2. Prepare candidate new detections
    const unmatchedNew = rawHandsLandmarks.map((lms) => ({
      landmarks: lms,
      palmCenter: calculatePalmCenter(lms)
    }));

    const availablePersistent = Array.from(this.persistentHands.values());
    const matchedPairs: Array<{ newHand: (typeof unmatchedNew)[0]; existing: TrackedHand | null }> = [];

    // Optimal bipartite matching
    if (unmatchedNew.length === 2 && availablePersistent.length >= 2) {
      const n0 = unmatchedNew[0];
      const n1 = unmatchedNew[1];
      const p0 = availablePersistent[0];
      const p1 = availablePersistent[1];

      const d00 = Math.hypot(n0.palmCenter.x - p0.smoothedPalmCenter.x, n0.palmCenter.y - p0.smoothedPalmCenter.y);
      const d11 = Math.hypot(n1.palmCenter.x - p1.smoothedPalmCenter.x, n1.palmCenter.y - p1.smoothedPalmCenter.y);

      const d01 = Math.hypot(n0.palmCenter.x - p1.smoothedPalmCenter.x, n0.palmCenter.y - p1.smoothedPalmCenter.y);
      const d10 = Math.hypot(n1.palmCenter.x - p0.smoothedPalmCenter.x, n1.palmCenter.y - p0.smoothedPalmCenter.y);

      const costA = d00 * d00 + d11 * d11;
      const costB = d01 * d01 + d10 * d10;

      if (costA <= costB) {
        matchedPairs.push({ newHand: n0, existing: d00 <= MAX_MATCH_DIST ? p0 : null });
        matchedPairs.push({ newHand: n1, existing: d11 <= MAX_MATCH_DIST ? p1 : null });
      } else {
        matchedPairs.push({ newHand: n0, existing: d01 <= MAX_MATCH_DIST ? p1 : null });
        matchedPairs.push({ newHand: n1, existing: d10 <= MAX_MATCH_DIST ? p0 : null });
      }
    } else if (unmatchedNew.length === 2 && availablePersistent.length === 1) {
      const p0 = availablePersistent[0];
      const d0 = Math.hypot(unmatchedNew[0].palmCenter.x - p0.smoothedPalmCenter.x, unmatchedNew[0].palmCenter.y - p0.smoothedPalmCenter.y);
      const d1 = Math.hypot(unmatchedNew[1].palmCenter.x - p0.smoothedPalmCenter.x, unmatchedNew[1].palmCenter.y - p0.smoothedPalmCenter.y);

      if (d0 <= d1) {
        matchedPairs.push({ newHand: unmatchedNew[0], existing: d0 <= MAX_MATCH_DIST ? p0 : null });
        matchedPairs.push({ newHand: unmatchedNew[1], existing: null });
      } else {
        matchedPairs.push({ newHand: unmatchedNew[0], existing: null });
        matchedPairs.push({ newHand: unmatchedNew[1], existing: d1 <= MAX_MATCH_DIST ? p0 : null });
      }
    } else if (unmatchedNew.length === 1 && availablePersistent.length >= 1) {
      const n0 = unmatchedNew[0];
      let nearestDist = Infinity;
      let bestP: TrackedHand | null = null;
      for (const p of availablePersistent) {
        const d = Math.hypot(n0.palmCenter.x - p.smoothedPalmCenter.x, n0.palmCenter.y - p.smoothedPalmCenter.y);
        if (d < nearestDist) {
          nearestDist = d;
          bestP = p;
        }
      }
      matchedPairs.push({ newHand: n0, existing: nearestDist <= MAX_MATCH_DIST ? bestP : null });
    } else {
      // 0 or more new hands with 0 persistent hands
      for (const n of unmatchedNew) {
        matchedPairs.push({ newHand: n, existing: null });
      }
    }

    const matchedThisFrame: TrackedHand[] = [];

    for (const pair of matchedPairs) {
      const newHand = pair.newHand;
      const existing = pair.existing;

      if (existing) {
        existing.rawLandmarks = newHand.landmarks;
        existing.rawPalmCenter = newHand.palmCenter;
        existing.lastSeenTime = now;

        // Apply One Euro filter
        existing.filter.setParams(tuning.smoothing, tuning.responsiveness);
        const smoothed = existing.filter.filter(newHand.palmCenter.x, newHand.palmCenter.y, now / 1000);
        existing.smoothedPalmCenter = smoothed;
        existing.isInRestZone = smoothed.y >= restZoneThresholdY;

        this.persistentHands.set(existing.id, existing);
        matchedThisFrame.push(existing);
      } else {
        // New hand
        const filter = new OneEuroPoint2D(tuning.smoothing, tuning.responsiveness);
        const smoothed = filter.filter(newHand.palmCenter.x, newHand.palmCenter.y, now / 1000);
        const isInRestZone = smoothed.y >= restZoneThresholdY;

        const newTrackedHand: TrackedHand = {
          id: this.nextHandId++,
          rawLandmarks: newHand.landmarks,
          rawPalmCenter: newHand.palmCenter,
          smoothedPalmCenter: smoothed,
          lastSeenTime: now,
          deckId: smoothed.x < 0.5 ? 'A' : 'B',
          isInRestZone,
          filter
        };

        this.persistentHands.set(newTrackedHand.id, newTrackedHand);
        matchedThisFrame.push(newTrackedHand);
      }
    }

    // 3. Autonomous Deck Assignment with center split & deadband:
    // Left side of frame (x < 0.47) strictly controls Deck A (left track).
    // Right side of frame (x > 0.53) strictly controls Deck B (right track).
    // Center deadband [0.47, 0.53] retains previous assignment (or splits at 0.50) to prevent jitter.
    for (const h of matchedThisFrame) {
      const activeDeck = this.activeDeckQuery ? this.activeDeckQuery(h.id) : null;
      if (activeDeck) {
        // While actively grabbing a control, retain the grabbed deck
        h.deckId = activeDeck;
      } else {
        h.deckId = assignDeck(h.smoothedPalmCenter.x, h.deckId);
      }
    }

    this.activeVisibleHands = matchedThisFrame;
    return this.activeVisibleHands;
  }

  getTrackedHands(): TrackedHand[] {
    return this.activeVisibleHands;
  }
}

export const trackerClient = new TrackerClient();
