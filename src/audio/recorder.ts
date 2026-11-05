import { appStore } from '../app/store.ts';

export function getSupportedAudioMimeType(): { mimeType: string; extension: string } | null {
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') {
    return null;
  }

  const candidates = [
    { mimeType: 'audio/webm;codecs=opus', extension: 'webm' },
    { mimeType: 'audio/mp4', extension: 'mp4' },
    { mimeType: 'audio/ogg;codecs=opus', extension: 'ogg' },
    { mimeType: 'audio/webm', extension: 'webm' }
  ];

  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mimeType)) {
      return c;
    }
  }

  return null;
}

export function formatMixFilename(extension: string): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const minute = String(d.getMinutes()).padStart(2, '0');

  return `deckhand-mix-${year}${month}${day}-${hour}${minute}.${extension}`;
}

export class AudioMixRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private startTime = 0;
  private timerInterval: number | null = null;
  private currentMimeType = '';
  private currentExtension = '';

  start(stream: MediaStream): boolean {
    const supported = getSupportedAudioMimeType();
    if (!supported) {
      appStore.setSystemMessage('Recording is not supported in this browser.');
      return false;
    }

    this.currentMimeType = supported.mimeType;
    this.currentExtension = supported.extension;
    this.recordedChunks = [];

    try {
      this.mediaRecorder = new MediaRecorder(stream, { mimeType: this.currentMimeType });

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

      this.mediaRecorder.start(250); // 250ms chunks
      this.startTime = performance.now();
      appStore.setRecording(true);

      this.timerInterval = window.setInterval(() => {
        const durSec = (performance.now() - this.startTime) / 1000;
        appStore.setRecordingDuration(durSec);
      }, 500);

      return true;
    } catch {
      appStore.setSystemMessage('Recording is not supported in this browser.');
      return false;
    }
  }

  stop() {
    if (this.timerInterval !== null) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
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

export const audioMixRecorder = new AudioMixRecorder();
