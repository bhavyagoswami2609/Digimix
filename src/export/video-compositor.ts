import { appStore } from '../app/store.ts';
import { trackerClient } from '../vision/tracker-client.ts';
import { HAND_CONNECTIONS, videoToScreen } from '../vision/landmarks.ts';
import { eqCurve, tempoCurve } from '../audio/curves.ts';

export function getSupportedVideoMimeType(): { mimeType: string; extension: string } | null {
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') {
    return null;
  }

  const candidates = [
    { mimeType: 'video/mp4;codecs=avc1,mp4a.40.2', extension: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' }
  ];

  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mimeType)) {
      return c;
    }
  }

  return null;
}

export class VideoCompositor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private mediaRecorder: MediaRecorder | null = null;
  private animId: number | null = null;
  private recordedChunks: Blob[] = [];
  private currentMimeType = '';
  private currentExtension = '';
  private startTime = 0;
  private timerInterval: number | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.ctx = this.canvas.getContext('2d');
  }

  start(videoEl: HTMLVideoElement | null, audioStream: MediaStream): boolean {
    const supported = getSupportedVideoMimeType();
    if (!supported || !this.ctx) {
      appStore.setIncludeVideo(false);
      appStore.setSystemMessage('Recording is not supported in this browser.');
      return false;
    }

    this.currentMimeType = supported.mimeType;
    this.currentExtension = supported.extension;
    this.recordedChunks = [];

    try {
      // Capture 30fps canvas stream
      const canvasStream = (this.canvas as unknown as { captureStream: (fps: number) => MediaStream }).captureStream(30);

      // Add audio track from master destination
      const audioTracks = audioStream.getAudioTracks();
      if (audioTracks.length > 0) {
        canvasStream.addTrack(audioTracks[0]);
      }

      this.mediaRecorder = new MediaRecorder(canvasStream, { mimeType: this.currentMimeType });

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.recordedChunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        const fullBlob = new Blob(this.recordedChunks, { type: this.currentMimeType });
        this.recordedChunks = [];
        appStore.setRecordedBlob(fullBlob, this.currentMimeType);
      };

      this.mediaRecorder.start(250);
      this.startTime = performance.now();
      appStore.setRecording(true);

      this.timerInterval = window.setInterval(() => {
        const durSec = (performance.now() - this.startTime) / 1000;
        appStore.setRecordingDuration(durSec);
      }, 500);

      this.startRenderLoop(videoEl);
      return true;
    } catch {
      appStore.setIncludeVideo(false);
      appStore.setSystemMessage('Recording is not supported in this browser.');
      return false;
    }
  }

  private startRenderLoop(videoEl: HTMLVideoElement | null) {
    const loop = () => {
      this.drawFrame(videoEl);
      this.animId = requestAnimationFrame(loop);
    };
    this.animId = requestAnimationFrame(loop);
  }

  private drawFrame(videoEl: HTMLVideoElement | null) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const w = 1280;
    const h = 720;

    // 1. Clear background
    ctx.fillStyle = '#0A0A0B';
    ctx.fillRect(0, 0, w, h);

    // 2. Draw mirrored video
    if (videoEl && videoEl.readyState >= 2) {
      ctx.save();
      // Mirrored video
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      // Darkened filter simulation
      ctx.filter = 'grayscale(0.4) brightness(0.55)';
      ctx.drawImage(videoEl, 0, 0, w, h);
      ctx.restore();
    }

    // 3. Draw Hand Skeleton from tracker
    const hands = trackerClient.getTrackedHands();
    const vw = videoEl ? videoEl.videoWidth || 640 : 640;
    const vh = videoEl ? videoEl.videoHeight || 360 : 360;

    for (const hand of hands) {
      const lms = hand.rawLandmarks;
      if (lms.length < 21) continue;

      const screenPts = lms.map((lm) => videoToScreen(lm.x, lm.y, vw, vh, w, h));
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.beginPath();
      for (const [fromIdx, toIdx] of HAND_CONNECTIONS) {
        ctx.moveTo(screenPts[fromIdx].x, screenPts[fromIdx].y);
        ctx.lineTo(screenPts[toIdx].x, screenPts[toIdx].y);
      }
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      for (const pt of screenPts) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 4. Draw Deck Names & Playheads from store state
    const state = appStore.getState();

    // Top Header bar
    ctx.fillStyle = 'rgba(17, 17, 19, 0.9)';
    ctx.fillRect(0, 0, w, 48);
    ctx.fillStyle = '#ECE9E4';
    ctx.font = '600 15px sans-serif';
    ctx.fillText('Deckhand', 24, 29);

    // Deck A overview bar (left)
    ctx.fillStyle = 'rgba(17, 17, 19, 0.85)';
    ctx.fillRect(24, 64, 590, 70);
    ctx.fillStyle = '#E8793A';
    ctx.font = '600 13px monospace';
    ctx.fillText('A', 36, 84);
    ctx.fillStyle = '#ECE9E4';
    ctx.font = '500 13px sans-serif';
    ctx.fillText(state.decks.A.file?.name || 'No track loaded', 56, 84);

    // Deck A playhead progress
    const durA = state.decks.A.file?.durationSec || 1;
    const progA = Math.max(0, Math.min(1, state.decks.A.currentPositionSec / durA));
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(36, 96, 560, 24);
    ctx.fillStyle = '#E8793A';
    ctx.fillRect(36, 96, 560 * progA, 24);

    // Deck B overview bar (right)
    ctx.fillStyle = 'rgba(17, 17, 19, 0.85)';
    ctx.fillRect(666, 64, 590, 70);
    ctx.fillStyle = '#4FA3D1';
    ctx.font = '600 13px monospace';
    ctx.fillText('B', 678, 84);
    ctx.fillStyle = '#ECE9E4';
    ctx.font = '500 13px sans-serif';
    ctx.fillText(state.decks.B.file?.name || 'No track loaded', 698, 84);

    const durB = state.decks.B.file?.durationSec || 1;
    const progB = Math.max(0, Math.min(1, state.decks.B.currentPositionSec / durB));
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(678, 96, 560, 24);
    ctx.fillStyle = '#4FA3D1';
    ctx.fillRect(678, 96, 560 * progB, 24);

    // 5. Draw Two Control Readouts
    this.drawReadoutBox(ctx, 24, 150, 'A', state.decks.A);
    this.drawReadoutBox(ctx, 1056, 150, 'B', state.decks.B);

    // 6. Draw Crossfader
    const xfaderX = 460;
    const xfaderY = 620;
    ctx.fillStyle = 'rgba(17, 17, 19, 0.9)';
    ctx.fillRect(xfaderX, xfaderY, 360, 48);
    ctx.fillStyle = '#E8793A';
    ctx.font = '600 13px monospace';
    ctx.fillText('A', xfaderX + 16, xfaderY + 28);
    ctx.fillStyle = '#4FA3D1';
    ctx.fillText('B', xfaderX + 332, xfaderY + 28);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.beginPath();
    ctx.moveTo(xfaderX + 40, xfaderY + 24);
    ctx.lineTo(xfaderX + 320, xfaderY + 24);
    ctx.stroke();

    const handlePos = xfaderX + 40 + state.crossfader * 280;
    ctx.fillStyle = '#ECE9E4';
    ctx.fillRect(handlePos - 5, xfaderY + 16, 10, 16);
  }

  private drawReadoutBox(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    deckId: 'A' | 'B',
    deckState: ReturnType<typeof appStore.getState>['decks']['A']
  ) {
    ctx.fillStyle = 'rgba(17, 17, 19, 0.9)';
    ctx.fillRect(x, y, 200, 150);

    const controls = [
      { name: 'VOL', u: deckState.volume, text: `${Math.round(deckState.volume * 100)}` },
      { name: 'BASS', u: deckState.bass, text: eqCurve(deckState.bass).displayStr },
      { name: 'MID', u: deckState.mid, text: eqCurve(deckState.mid).displayStr },
      { name: 'TREBLE', u: deckState.treble, text: eqCurve(deckState.treble).displayStr },
      { name: 'TEMPO', u: deckState.tempo, text: tempoCurve(deckState.tempo).displayStr }
    ];

    ctx.font = '11px monospace';
    controls.forEach((c, idx) => {
      const rowY = y + 24 + idx * 26;
      ctx.fillStyle = '#8F8C86';
      ctx.fillText(c.name, x + 10, rowY);

      // Track
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.fillRect(x + 60, rowY - 5, 80, 2);

      // Fill
      ctx.fillStyle = deckId === 'A' ? '#E8793A' : '#4FA3D1';
      ctx.fillRect(x + 60, rowY - 6, 80 * c.u, 4);

      ctx.fillStyle = '#ECE9E4';
      ctx.fillText(c.text, x + 148, rowY);
    });
  }

  stop() {
    if (this.timerInterval !== null) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.animId !== null) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.mediaRecorder = null;
    appStore.setRecording(false);
  }

  getExtension(): string {
    return this.currentExtension;
  }
}

export const videoCompositor = new VideoCompositor();
