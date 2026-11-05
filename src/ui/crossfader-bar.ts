import { appStore } from '../app/store.ts';
import { AUDIO_CONFIG } from '../config.ts';

export class CrossfaderBar {
  private container: HTMLElement;
  private trackContainer: HTMLElement;
  private handle: HTMLElement;
  private isDragging = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.trackContainer = container.querySelector('#crossfader-track-container') as HTMLElement;
    this.handle = container.querySelector('#crossfader-handle') as HTMLElement;
    this.attachEvents();
  }

  private attachEvents() {
    const onPointerDown = (e: MouseEvent) => {
      this.isDragging = true;
      appStore.setActiveCrossfader(true);
      this.updateFromPointer(e);

      const onPointerMove = (moveEvent: MouseEvent) => {
        if (!this.isDragging) return;
        this.updateFromPointer(moveEvent);
      };

      const onPointerUp = () => {
        this.isDragging = false;
        appStore.setActiveCrossfader(false);
        window.removeEventListener('mousemove', onPointerMove);
        window.removeEventListener('mouseup', onPointerUp);
      };

      window.addEventListener('mousemove', onPointerMove);
      window.addEventListener('mouseup', onPointerUp);
    };

    this.container.addEventListener('mousedown', onPointerDown);

    // Double-click resets to center
    this.container.addEventListener('dblclick', () => {
      appStore.setCrossfader(AUDIO_CONFIG.DEFAULT_U.CROSSFADER);
    });
  }

  private updateFromPointer(e: MouseEvent) {
    const rect = this.trackContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const u = Math.max(0, Math.min(1, x / rect.width));
    appStore.setCrossfader(u);
  }

  update(crossfaderU: number) {
    if (this.handle) {
      this.handle.style.left = `${crossfaderU * 100}%`;
    }
  }
}
