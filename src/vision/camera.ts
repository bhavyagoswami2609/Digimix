import { VISION_CONFIG } from '../config.ts';

export class CameraService {
  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;

  async startCamera(videoElement: HTMLVideoElement): Promise<MediaStream> {
    this.videoEl = videoElement;

    if (this.stream) {
      this.stopCamera();
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: VISION_CONFIG.IDEAL_WIDTH },
        height: { ideal: VISION_CONFIG.IDEAL_HEIGHT },
        frameRate: { ideal: VISION_CONFIG.IDEAL_FPS },
        facingMode: 'user'
      },
      audio: false
    });

    this.stream = stream;
    videoElement.srcObject = stream;
    await videoElement.play().catch(() => {});

    // Ensure tracks stop when closing tab
    window.addEventListener('beforeunload', () => {
      this.stopCamera();
    });

    return stream;
  }

  getStream(): MediaStream | null {
    return this.stream;
  }

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.videoEl) {
      this.videoEl.srcObject = null;
      this.videoEl = null;
    }
  }
}

export const cameraService = new CameraService();
