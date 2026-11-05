import { appStore, DeckId } from '../store.ts';
import { ScreenComponent } from '../router.ts';
import { AUDIO_CONFIG } from '../../config.ts';

export class SetupScreen implements ScreenComponent {
  private element: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;
  private cameraStream: MediaStream | null = null;

  mount(container: HTMLElement): void {
    this.element = document.createElement('div');
    this.element.className = 'screen screen-setup';

    this.render();
    container.appendChild(this.element);

    this.unsubscribe = appStore.subscribe(() => {
      this.updateView();
    });
  }

  private render() {
    if (!this.element) return;
    this.element.innerHTML = `
      <div class="setup-container">
        <h2 class="setup-heading">Set up.</h2>
        <div class="setup-panels">
          <!-- Left Panel: Camera -->
          <div class="setup-panel" id="camera-panel">
            <h3 class="setup-panel-title">Camera</h3>
            <div class="camera-preview-box" id="camera-preview-box">
              <video class="camera-preview-video" id="camera-video" playsinline muted autoplay></video>
              <canvas class="camera-preview-canvas" id="camera-canvas"></canvas>
              <div class="camera-status-msg" id="camera-status-msg">
                Deckhand needs your webcam to see your hands. Video is processed here and never uploaded.
              </div>
            </div>
            <div class="camera-actions" id="camera-actions">
              <button class="primary" id="btn-allow-camera">Allow camera</button>
            </div>
          </div>

          <!-- Right Panel: Tracks -->
          <div class="setup-panel" id="tracks-panel">
            <h3 class="setup-panel-title">Tracks</h3>
            <div class="track-drop-areas">
              <!-- Deck A Box -->
              <div class="track-drop-box" id="drop-box-a">
                <div class="track-box-header">
                  <span class="deck-tag deck-tag-a">A</span>
                  <div class="track-box-actions" id="track-actions-a">
                    <button id="btn-choose-file-a">Choose file</button>
                    <input type="file" id="file-input-a" accept="audio/*,.mp3,.wav,.m4a" style="display: none;">
                  </div>
                </div>
                <div class="track-content" id="track-content-a">
                  <span class="camera-status-msg">Drop a file or choose one</span>
                </div>
              </div>

              <!-- Deck B Box -->
              <div class="track-drop-box" id="drop-box-b">
                <div class="track-box-header">
                  <span class="deck-tag deck-tag-b">B</span>
                  <div class="track-box-actions" id="track-actions-b">
                    <button id="btn-choose-file-b">Choose file</button>
                    <input type="file" id="file-input-b" accept="audio/*,.mp3,.wav,.m4a" style="display: none;">
                  </div>
                </div>
                <div class="track-content" id="track-content-b">
                  <span class="camera-status-msg">Drop a file or choose one</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer & Open Mixer button -->
        <div class="setup-footer">
          <button class="primary" id="btn-open-mixer" disabled style="min-width: 200px; height: 38px;">Open the mixer</button>
          <div class="setup-missing-text" id="setup-missing-lines"></div>
        </div>
      </div>
    `;

    this.attachEvents();
    this.updateView();
  }

  private attachEvents() {
    if (!this.element) return;

    // Camera button
    const btnAllowCamera = this.element.querySelector('#btn-allow-camera') as HTMLButtonElement | null;
    if (btnAllowCamera) {
      btnAllowCamera.addEventListener('click', () => this.handleRequestCamera());
    }

    // Open Mixer button
    const btnOpenMixer = this.element.querySelector('#btn-open-mixer') as HTMLButtonElement;
    btnOpenMixer.addEventListener('click', () => {
      if (!btnOpenMixer.disabled) {
        appStore.setScreen('stage');
      }
    });

    // Deck file inputs & drop targets
    this.setupFileSelection('A');
    this.setupFileSelection('B');
  }

  private setupFileSelection(deckId: DeckId) {
    if (!this.element) return;
    const dropBox = this.element.querySelector(`#drop-box-${deckId.toLowerCase()}`) as HTMLElement;
    const btnChoose = this.element.querySelector(`#btn-choose-file-${deckId.toLowerCase()}`) as HTMLButtonElement;
    const fileInput = this.element.querySelector(`#file-input-${deckId.toLowerCase()}`) as HTMLInputElement;

    btnChoose.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) {
        this.processFile(deckId, file);
      }
    });

    dropBox.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropBox.classList.add('drag-over');
    });

    dropBox.addEventListener('dragleave', () => {
      dropBox.classList.remove('drag-over');
    });

    dropBox.addEventListener('drop', (e) => {
      e.preventDefault();
      dropBox.classList.remove('drag-over');
      const file = e.dataTransfer?.files?.[0];
      if (file) {
        this.processFile(deckId, file);
      }
    });
  }

  private async processFile(deckId: DeckId, file: File) {
    // Safety check 1: Reject > 200MB
    if (file.size > AUDIO_CONFIG.MAX_FILE_SIZE_BYTES) {
      this.showFileError(deckId);
      return;
    }

    // Safety check 2: audio type
    const isAudio = file.type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|aac|flac)$/i.test(file.name);
    if (!isAudio) {
      this.showFileError(deckId);
      return;
    }

    // Store file info with temporary duration 0 while decoding in Phase B audio engine
    try {
      appStore.setDeckFile(deckId, {
        name: file.name,
        durationSec: 0,
        buffer: null
      });
      appStore.setBpmAnalysisState(deckId, true);
    } catch {
      this.showFileError(deckId);
    }
  }

  private showFileError(deckId: DeckId) {
    const content = this.element?.querySelector(`#track-content-${deckId.toLowerCase()}`);
    if (content) {
      content.innerHTML = `<span class="camera-status-msg" style="color: var(--color-record);">This file could not be read. Try an MP3, WAV or M4A.</span>`;
    }
  }

  private async handleRequestCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 360 },
          frameRate: { ideal: 60 },
          facingMode: 'user'
        },
        audio: false
      });
      this.cameraStream = stream;
      appStore.setCameraPermission('granted');
      appStore.setCameraStreamActive(true);

      const video = this.element?.querySelector('#camera-video') as HTMLVideoElement | null;
      if (video) {
        video.srcObject = stream;
        video.style.display = 'block';
        video.play().catch(() => {});
      }
    } catch (err: unknown) {
      const error = err as { name?: string };
      if (error && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError')) {
        appStore.setCameraPermission('denied');
      } else if (error && (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError')) {
        appStore.setCameraPermission('not-found');
      } else {
        appStore.setCameraPermission('denied');
      }
    }
  }

  private updateView() {
    if (!this.element) return;
    const state = appStore.getState();

    // Camera panel update
    const camStatusMsg = this.element.querySelector('#camera-status-msg') as HTMLElement;
    const camActions = this.element.querySelector('#camera-actions') as HTMLElement;
    const camVideo = this.element.querySelector('#camera-video') as HTMLVideoElement;

    if (state.camera.permission === 'granted') {
      camStatusMsg.style.display = 'none';
      camActions.innerHTML = `<span class="mono" style="font-size: 13px; color: var(--color-text-dim);">Camera on.</span>`;
    } else if (state.camera.permission === 'denied') {
      camVideo.style.display = 'none';
      camStatusMsg.style.display = 'block';
      camStatusMsg.textContent = "The camera is blocked. Allow it in your browser's site settings, or continue with the mouse.";
      camActions.innerHTML = `
        <button id="btn-camera-try-again">Try again</button>
        <button id="btn-camera-mouse-instead">Use the mouse instead</button>
      `;
      this.element.querySelector('#btn-camera-try-again')?.addEventListener('click', () => this.handleRequestCamera());
      this.element.querySelector('#btn-camera-mouse-instead')?.addEventListener('click', () => {
        appStore.setCameraPermission('mouse-only');
      });
    } else if (state.camera.permission === 'not-found') {
      camVideo.style.display = 'none';
      camStatusMsg.style.display = 'block';
      camStatusMsg.textContent = 'No camera found.';
      camActions.innerHTML = `<button id="btn-camera-mouse-instead">Use the mouse instead</button>`;
      this.element.querySelector('#btn-camera-mouse-instead')?.addEventListener('click', () => {
        appStore.setCameraPermission('mouse-only');
      });
    } else if (state.camera.permission === 'mouse-only') {
      camVideo.style.display = 'none';
      camStatusMsg.style.display = 'block';
      camStatusMsg.textContent = 'Operating with mouse controls.';
      camActions.innerHTML = `<button id="btn-camera-try-again">Allow camera</button>`;
      this.element.querySelector('#btn-camera-try-again')?.addEventListener('click', () => this.handleRequestCamera());
    } else {
      // prompt state
      camVideo.style.display = 'none';
      camStatusMsg.style.display = 'block';
      camStatusMsg.textContent = 'Deckhand needs your webcam to see your hands. Video is processed here and never uploaded.';
      camActions.innerHTML = `<button class="primary" id="btn-allow-camera">Allow camera</button>`;
      this.element.querySelector('#btn-allow-camera')?.addEventListener('click', () => this.handleRequestCamera());
    }

    // Tracks panel update
    this.updateTrackBox('A');
    this.updateTrackBox('B');

    // Missing requirements & Open Mixer button
    const hasCamera = state.camera.permission === 'granted' || state.camera.permission === 'mouse-only';
    const hasTracks = !!state.decks.A.file && !!state.decks.B.file;

    const btnOpenMixer = this.element.querySelector('#btn-open-mixer') as HTMLButtonElement;
    const missingLines = this.element.querySelector('#setup-missing-lines') as HTMLElement;

    const missing: string[] = [];
    if (!hasTracks) {
      missing.push('Load both tracks to continue.');
    }
    if (!hasCamera) {
      missing.push('Allow the camera or choose the mouse to continue.');
    }

    if (missing.length === 0) {
      btnOpenMixer.disabled = false;
      missingLines.textContent = '';
    } else {
      btnOpenMixer.disabled = true;
      missingLines.innerHTML = missing.map(m => `<div>${m}</div>`).join('');
    }
  }

  private updateTrackBox(deckId: DeckId) {
    if (!this.element) return;
    const state = appStore.getState();
    const deck = state.decks[deckId];
    const content = this.element.querySelector(`#track-content-${deckId.toLowerCase()}`) as HTMLElement;
    if (!content) return;

    if (deck.file) {
      const mins = Math.floor(deck.file.durationSec / 60);
      const secs = Math.floor(deck.file.durationSec % 60);
      const durStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

      let tempoStr = '';
      if (deck.isAnalyzingBpm) {
        tempoStr = 'Analyzing tempo';
      } else if (deck.baseBpm !== null) {
        tempoStr = `${Math.round(deck.baseBpm)} BPM`;
      } else if (deck.bpmDetectionFailed) {
        tempoStr = 'Tempo not found. Type a BPM to enable Sync.';
      }

      content.innerHTML = `
        <div class="track-file-info">
          <div class="track-name">${deck.file.name}</div>
          <div class="track-meta">
            ${deck.file.durationSec > 0 ? `<span>${durStr}</span>` : ''}
            <span>${tempoStr}</span>
          </div>
        </div>
      `;
    }
  }

  unmount(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.cameraStream) {
      // Keep camera stream active if moving to Stage, or stop if unmounting completely
      // Runtime safety rule: "Stop every track when leaving the Stage or closing the tab."
      // Moving from Setup to Stage keeps the track alive, but if navigating away from setup back to landing/guide, stop it:
      const nextScreen = appStore.getState().currentScreen;
      if (nextScreen !== 'stage') {
        this.cameraStream.getTracks().forEach(t => t.stop());
        this.cameraStream = null;
        appStore.setCameraStreamActive(false);
      }
    }
    if (this.element && this.element.parentElement) {
      this.element.parentElement.removeChild(this.element);
    }
    this.element = null;
  }
}
