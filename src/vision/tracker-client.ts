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
  private hasPendingFrame = false;
  private nextHandId = 1;

  private activeVisibleHands: TrackedHand[] = [];
  private persistentHands: Map<number, TrackedHand> = new Map();
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

  private updateTrackedHands(rawHandsLandmarks: NormalizedLandmark[][], now: number): TrackedHand[] {
    const tuning = appStore.getState().tuning;
    const restZoneThresholdY = 1.0 - tuning.restZoneHeight;

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

    const matchedThisFrame: TrackedHand[] = [];
    const availablePersistent = Array.from(this.persistentHands.values());

    for (const newHand of unmatchedNew) {
      let nearestDist = Infinity;
      let matchedHand: TrackedHand | null = null;
      let matchedIdx = -1;

      for (let i = 0; i < availablePersistent.length; i++) {
        const existing = availablePersistent[i];
        const dx = newHand.palmCenter.x - existing.smoothedPalmCenter.x;
        const dy = newHand.palmCenter.y - existing.smoothedPalmCenter.y;
        const dist = Math.hypot(dx, dy);

        if (dist < nearestDist && dist < 0.45) {
          nearestDist = dist;
          matchedHand = existing;
          matchedIdx = i;
        }
      }

      if (matchedHand && matchedIdx !== -1) {
        availablePersistent.splice(matchedIdx, 1);
        matchedHand.rawLandmarks = newHand.landmarks;
        matchedHand.rawPalmCenter = newHand.palmCenter;
        matchedHand.lastSeenTime = now;

        // Apply One Euro filter in frame fractions per second
        matchedHand.filter.setParams(tuning.smoothing, tuning.responsiveness);
        const smoothed = matchedHand.filter.filter(newHand.palmCenter.x, newHand.palmCenter.y, now / 1000);
        matchedHand.smoothedPalmCenter = smoothed;

        // Deck assignment with dead band
        matchedHand.deckId = assignDeck(smoothed.x, matchedHand.deckId);
        matchedHand.isInRestZone = smoothed.y >= restZoneThresholdY;

        this.persistentHands.set(matchedHand.id, matchedHand);
        matchedThisFrame.push(matchedHand);
      } else {
        // New hand
        const filter = new OneEuroPoint2D(tuning.smoothing, tuning.responsiveness);
        const smoothed = filter.filter(newHand.palmCenter.x, newHand.palmCenter.y, now / 1000);
        const deckId = assignDeck(smoothed.x, null);
        const isInRestZone = smoothed.y >= restZoneThresholdY;

        const newTrackedHand: TrackedHand = {
          id: this.nextHandId++,
          rawLandmarks: newHand.landmarks,
          rawPalmCenter: newHand.palmCenter,
          smoothedPalmCenter: smoothed,
          lastSeenTime: now,
          deckId,
          isInRestZone,
          filter
        };

        this.persistentHands.set(newTrackedHand.id, newTrackedHand);
        matchedThisFrame.push(newTrackedHand);
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
