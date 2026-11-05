import { TrackedHand } from '../vision/tracker-client.ts';
import { HAND_CONNECTIONS, videoToScreen } from '../vision/landmarks.ts';

export class HandOverlayRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  resize(width: number, height: number) {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.ctx?.scale(dpr, dpr);
  }

  render(
    hands: TrackedHand[],
    videoWidth: number,
    videoHeight: number,
    stageWidth: number,
    stageHeight: number,
    engagedFingertips?: { [handId: number]: number } // handId -> fingertip landmark index (8, 12, 16, 20)
  ) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, stageWidth, stageHeight);

    if (hands.length === 0 || videoWidth <= 0 || videoHeight <= 0) return;

    for (const hand of hands) {
      const lms = hand.rawLandmarks;
      if (!lms || lms.length < 21) continue;

      const deckColor = hand.deckId === 'A' ? '#E8793A' : '#4FA3D1';
      const screenPoints = lms.map((lm) =>
        videoToScreen(lm.x, lm.y, videoWidth, videoHeight, stageWidth, stageHeight)
      );

      // 1. Draw skeleton connections (1.5px white at 80%)
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.beginPath();
      for (const [fromIdx, toIdx] of HAND_CONNECTIONS) {
        const pt1 = screenPoints[fromIdx];
        const pt2 = screenPoints[toIdx];
        ctx.moveTo(pt1.x, pt1.y);
        ctx.lineTo(pt2.x, pt2.y);
      }
      ctx.stroke();

      // 2. Draw joints (3px)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      for (let i = 0; i < 21; i++) {
        // Skip fingertips here, drawn in step 3
        if (i === 4 || i === 8 || i === 12 || i === 16 || i === 20) continue;
        const pt = screenPoints[i];
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // 3. Draw fingertips (joints 3px, colored in deck color if engaged)
      const fingertips = [4, 8, 12, 16, 20];
      const engagedTip = engagedFingertips ? engagedFingertips[hand.id] : undefined;

      for (const tipIdx of fingertips) {
        const pt = screenPoints[tipIdx];
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
        if (engagedTip === tipIdx || (engagedTip !== undefined && tipIdx === 4)) {
          ctx.fillStyle = deckColor;
        } else {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        }
        ctx.fill();
      }
    }
  }

  clear() {
    if (this.ctx) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }
}
