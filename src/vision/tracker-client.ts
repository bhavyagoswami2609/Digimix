import { appStore, DeckId } from '../app/store.ts';
import { VISION_CONFIG } from '../config.ts';
import { calculatePalmCenter, assignDeck, NormalizedLandmark } from './landmarks.ts';
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

export class TrackerClient {
  private worker: Worker | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private isRunning = false;
  private isWorkerBusy = false;
  private nextHandId = 1;

  private trackedHands: TrackedHand[] = [];
  private onTrackCallback: TrackingCallback | null = null;

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
    this.scheduleNextFrame();
  }

  stop() {
    this.isRunning = false;
    this.isWorkerBusy = false;
    this.videoEl = null;
    this.onTrackCallback = null;
    this.trackedHands = [];
  }

  private scheduleNextFrame() {
    if (!this.isRunning || !this.videoEl) return;

    if ('requestVideoFrameCallback' in this.videoEl) {
      // Chrome / Safari modern video frame callback
      (this.videoEl as unknown as { requestVideoFrameCallback: (cb: () => void) => void }).requestVideoFrameCallback(() => {
        this.processFrame();
        this.scheduleNextFrame();
      });
    } else {
      // Fallback requestAnimationFrame
      requestAnimationFrame(() => {
        this.processFrame();
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
      const bitmap = await createImageBitmap(this.videoEl);
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
      this.updateTrackedHands(rawHandsLandmarks, now);

      if (this.onTrackCallback && this.videoEl) {
        this.onTrackCallback(this.trackedHands, this.videoEl.videoWidth, this.videoEl.videoHeight);
      }
    }
  }

  private calculateMedianLatency(): number {
    if (this.latencySamplesCount === 0) return 0;
    const sorted = this.latencyRingBuffer.slice(0, this.latencySamplesCount).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  private updateTrackedHands(rawHandsLandmarks: NormalizedLandmark[][], now: number) {
    const tuning = appStore.getState().tuning;
    const restZoneThresholdY = 1.0 - tuning.restZoneHeight;

    // 1. Remove expired hands (> 250 ms)
    this.trackedHands = this.trackedHands.filter((h) => now - h.lastSeenTime <= VISION_CONFIG.HAND_LOST_TIMEOUT_MS);

    // 2. Match newly detected hands to existing hands by nearest palm center
    const unmatchedNew = rawHandsLandmarks.map((lms) => ({
      landmarks: lms,
      palmCenter: calculatePalmCenter(lms)
    }));

    const matchedHands: TrackedHand[] = [];

    for (const newHand of unmatchedNew) {
      let nearestDist = Infinity;
      let matchedIdx = -1;

      for (let i = 0; i < this.trackedHands.length; i++) {
        const existing = this.trackedHands[i];
        const dx = newHand.palmCenter.x - existing.smoothedPalmCenter.x;
        const dy = newHand.palmCenter.y - existing.smoothedPalmCenter.y;
        const dist = Math.hypot(dx, dy);

        if (dist < nearestDist && dist < 0.35) {
          nearestDist = dist;
          matchedIdx = i;
        }
      }

      if (matchedIdx !== -1) {
        const existing = this.trackedHands.splice(matchedIdx, 1)[0];
        existing.rawLandmarks = newHand.landmarks;
        existing.rawPalmCenter = newHand.palmCenter;
        existing.lastSeenTime = now;

        // Apply One Euro filter in frame fractions per second
        existing.filter.setParams(tuning.smoothing, tuning.responsiveness);
        const smoothed = existing.filter.filter(newHand.palmCenter.x, newHand.palmCenter.y, now / 1000);
        existing.smoothedPalmCenter = smoothed;

        // Deck assignment with dead band
        existing.deckId = assignDeck(smoothed.x, existing.deckId);
        existing.isInRestZone = smoothed.y >= restZoneThresholdY;

        matchedHands.push(existing);
      } else {
        // New hand
        const filter = new OneEuroPoint2D(tuning.smoothing, tuning.responsiveness);
        const smoothed = filter.filter(newHand.palmCenter.x, newHand.palmCenter.y, now / 1000);
        const deckId = assignDeck(smoothed.x, null);
        const isInRestZone = smoothed.y >= restZoneThresholdY;

        matchedHands.push({
          id: this.nextHandId++,
          rawLandmarks: newHand.landmarks,
          rawPalmCenter: newHand.palmCenter,
          smoothedPalmCenter: smoothed,
          lastSeenTime: now,
          deckId,
          isInRestZone,
          filter
        });
      }
    }

    // Keep active hands (plus any hands still within 250ms disappearance grace window)
    this.trackedHands = [...matchedHands, ...this.trackedHands];
  }

  getTrackedHands(): TrackedHand[] {
    return this.trackedHands;
  }
}

export const trackerClient = new TrackerClient();
