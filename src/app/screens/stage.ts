import { appStore } from '../store.ts';
import { ScreenComponent } from '../router.ts';
import { APP_NAME } from '../../config.ts';
import { DeckPanelUI } from '../../ui/deck-panel.ts';
import { ControlStrip } from '../../ui/strip.ts';
import { CrossfaderBar } from '../../ui/crossfader-bar.ts';
import { MatchReadoutUI } from '../../ui/match-readout.ts';
import { HandOverlayRenderer } from '../../ui/hand-overlay.ts';
import { PoseChipRenderer } from '../../ui/pose-chip.ts';
import { HelpGesturesOverlay } from '../help-overlay.ts';
import { TuningPanel } from '../tuning-panel.ts';
import { trackerClient, TrackedHand } from '../../vision/tracker-client.ts';
import { gestureController } from '../../gesture/controller.ts';
import { cameraService } from '../../vision/camera.ts';
import { audioEngine } from '../../audio/engine.ts';
import { audioMixRecorder, formatMixFilename } from '../../audio/recorder.ts';
import { videoCompositor } from '../../export/video-compositor.ts';

export class StageScreen implements ScreenComponent {
  private element: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;

  private deckPanelA: DeckPanelUI | null = null;
  private deckPanelB: DeckPanelUI | null = null;
  private stripA: ControlStrip | null = null;
  private stripB: ControlStrip | null = null;
  private crossfaderBar: CrossfaderBar | null = null;
  private matchReadout: MatchReadoutUI | null = null;

  private handOverlay: HandOverlayRenderer | null = null;
  private poseChipRenderer: PoseChipRenderer | null = null;
  private helpOverlay: HelpGesturesOverlay | null = null;
  private tuningPanel: TuningPanel | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;

  private onKeyDownBound = this.handleKeyDown.bind(this);
  private onKeyUpBound = this.handleKeyUp.bind(this);

  mount(container: HTMLElement): void {
    this.element = document.createElement('div');
    this.element.className = 'screen screen-stage';

    this.render();
    container.appendChild(this.element);

    this.initComponents();
    this.attachHeaderEvents();
    this.attachKeyboardEvents();

    this.unsubscribe = appStore.subscribe((state) => {
      this.updateView(state);
    });

    this.updateView(appStore.getState());
  }

  private render() {
    if (!this.element) return;
    this.element.innerHTML = `
      <!-- Header (48px) -->
      <header class="stage-header">
        <div class="wordmark">${APP_NAME}</div>
        <div class="stage-header-actions">
          <div class="recording-indicator" id="rec-indicator" style="display: none;">
            <span class="rec-dot"></span>
            <span class="rec-timer mono" id="rec-timer">00:00</span>
          </div>
          <button id="btn-header-mute">Mute</button>
          <button id="btn-header-rec">Rec</button>
          <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--color-text-dim); cursor: pointer; user-select: none;" title="Can add lag on slower machines.">
            <input type="checkbox" id="chk-include-video" style="accent-color: var(--color-text);">
            <span>Include video</span>
          </label>
          <button id="btn-header-tuning">Tuning</button>
          <button id="btn-header-help">Help</button>
        </div>
      </header>

      <!-- System Message Toast -->
      <div id="stage-system-message" style="display: none; position: absolute; top: 56px; left: 50%; transform: translateX(-50%); background: var(--color-surface-1); border: var(--border-hairline-strong); border-radius: var(--radius-control); padding: 8px 16px; font-size: 13px; color: var(--color-text); z-index: 50;"></div>

      <!-- Viewport area with camera & UI overlay -->
      <main class="stage-viewport" id="stage-viewport">
        <!-- Mirrored video background -->
        <video class="camera-stage-video" id="stage-video" playsinline muted autoplay></video>
        
        <!-- Centre vertical line -->
        <div class="camera-center-line"></div>

        <!-- Rest zone marker -->
        <div class="rest-zone-line">
          <span class="rest-zone-label">Rest zone</span>
        </div>

        <!-- Hand skeleton canvas -->
        <canvas class="hand-overlay-canvas" id="stage-hand-canvas"></canvas>

        <!-- Dynamic Pose Chips Container -->
        <div id="pose-chips-layer"></div>

        <!-- Control Readouts Layer (Vol, Bass, Mid, Treble, Tempo) -->
        <div class="control-readouts-layer">
          <div class="control-readout" id="control-readout-a">
            <div class="control-row" data-control="volume">
              <span class="control-label">VOL</span>
              <div class="control-track-wrapper"><div class="control-track"><div class="control-tick" style="left: 75%;"></div><div class="control-fill" id="fill-vol-a" style="left: 0; width: 75%;"></div></div></div>
              <span class="control-value mono" id="val-vol-a">75</span>
            </div>
            <div class="control-row" data-control="bass">
              <span class="control-label">BASS</span>
              <div class="control-track-wrapper"><div class="control-track"><div class="control-tick" style="left: 50%;"></div><div class="control-fill" id="fill-bass-a" style="left: 50%; width: 0%;"></div></div></div>
              <span class="control-value mono" id="val-bass-a">0.0 dB</span>
            </div>
            <div class="control-row" data-control="mid">
              <span class="control-label">MID</span>
              <div class="control-track-wrapper"><div class="control-track"><div class="control-tick" style="left: 50%;"></div><div class="control-fill" id="fill-mid-a" style="left: 50%; width: 0%;"></div></div></div>
              <span class="control-value mono" id="val-mid-a">0.0 dB</span>
            </div>
            <div class="control-row" data-control="treble">
              <span class="control-label">TREBLE</span>
              <div class="control-track-wrapper"><div class="control-track"><div class="control-tick" style="left: 50%;"></div><div class="control-fill" id="fill-treble-a" style="left: 50%; width: 0%;"></div></div></div>
              <span class="control-value mono" id="val-treble-a">0.0 dB</span>
            </div>
            <div class="control-row" data-control="tempo">
              <span class="control-label">TEMPO</span>
              <div class="control-track-wrapper"><div class="control-track"><div class="control-tick" style="left: 50%;"></div><div class="control-fill" id="fill-tempo-a" style="left: 50%; width: 0%;"></div></div></div>
              <span class="control-value mono" id="val-tempo-a">+0.0%</span>
            </div>
          </div>

          <div class="control-readout" id="control-readout-b">
            <div class="control-row" data-control="volume">
              <span class="control-label">VOL</span>
              <div class="control-track-wrapper"><div class="control-track"><div class="control-tick" style="left: 75%;"></div><div class="control-fill" id="fill-vol-b" style="left: 0; width: 75%;"></div></div></div>
              <span class="control-value mono" id="val-vol-b">75</span>
            </div>
            <div class="control-row" data-control="bass">
              <span class="control-label">BASS</span>
              <div class="control-track-wrapper"><div class="control-track"><div class="control-tick" style="left: 50%;"></div><div class="control-fill" id="fill-bass-b" style="left: 50%; width: 0%;"></div></div></div>
              <span class="control-value mono" id="val-bass-b">0.0 dB</span>
            </div>
            <div class="control-row" data-control="mid">
              <span class="control-label">MID</span>
              <div class="control-track-wrapper"><div class="control-track"><div class="control-tick" style="left: 50%;"></div><div class="control-fill" id="fill-mid-b" style="left: 50%; width: 0%;"></div></div></div>
              <span class="control-value mono" id="val-mid-b">0.0 dB</span>
            </div>
            <div class="control-row" data-control="treble">
              <span class="control-label">TREBLE</span>
              <div class="control-track-wrapper"><div class="control-track"><div class="control-tick" style="left: 50%;"></div><div class="control-fill" id="fill-treble-b" style="left: 50%; width: 0%;"></div></div></div>
              <span class="control-value mono" id="val-treble-b">0.0 dB</span>
            </div>
            <div class="control-row" data-control="tempo">
              <span class="control-label">TEMPO</span>
              <div class="control-track-wrapper"><div class="control-track"><div class="control-tick" style="left: 50%;"></div><div class="control-fill" id="fill-tempo-b" style="left: 50%; width: 0%;"></div></div></div>
              <span class="control-value mono" id="val-tempo-b">+0.0%</span>
            </div>
          </div>
        </div>

        <!-- Main UI Layer: Decks Band & Center Dock -->
        <div class="stage-ui-layer">
          <!-- Deck Panels Band (~300px) -->
          <div class="deck-band">
            <!-- Deck A Panel -->
            <div class="deck-panel" id="deck-panel-a">
              <div class="deck-panel-top">
                <div class="deck-header-left">
                  <span class="deck-tag deck-tag-a">A</span>
                  <span class="deck-filename" id="filename-a">No track loaded</span>
                </div>
                <div class="deck-remaining-time mono" id="remaining-time-a">-00:00</div>
              </div>
              <canvas class="deck-overview-canvas" id="overview-canvas-a"></canvas>
              <canvas class="deck-beatview-canvas" id="beatview-canvas-a"></canvas>
              <div class="deck-panel-bottom">
                <div class="deck-bpm-group" id="bpm-group-a">
                  <span class="deck-bpm-val" id="bpm-val-a">--.-</span>
                  <span class="deck-bpm-label">BPM</span>
                  <span class="deck-tempo-pct" id="tempo-pct-a">+0.0%</span>
                </div>
                <div class="deck-controls-row">
                  <button class="btn-play-a" id="btn-play-a">Play</button>
                  <button id="btn-cue-a">Cue</button>
                  <button id="btn-sync-a">Sync</button>
                  <button id="btn-half-a">Half</button>
                  <button id="btn-double-a">Double</button>
                  <button id="btn-slower-a">Slower</button>
                  <button id="btn-faster-a">Faster</button>
                </div>
              </div>
            </div>

            <!-- Deck B Panel -->
            <div class="deck-panel" id="deck-panel-b">
              <div class="deck-panel-top">
                <div class="deck-header-left">
                  <span class="deck-tag deck-tag-b">B</span>
                  <span class="deck-filename" id="filename-b">No track loaded</span>
                </div>
                <div class="deck-remaining-time mono" id="remaining-time-b">-00:00</div>
              </div>
              <canvas class="deck-overview-canvas" id="overview-canvas-b"></canvas>
              <canvas class="deck-beatview-canvas" id="beatview-canvas-b"></canvas>
              <div class="deck-panel-bottom">
                <div class="deck-bpm-group" id="bpm-group-b">
                  <span class="deck-bpm-val" id="bpm-val-b">--.-</span>
                  <span class="deck-bpm-label">BPM</span>
                  <span class="deck-tempo-pct" id="tempo-pct-b">+0.0%</span>
                </div>
                <div class="deck-controls-row">
                  <button class="btn-play-b" id="btn-play-b">Play</button>
                  <button id="btn-cue-b">Cue</button>
                  <button id="btn-sync-b">Sync</button>
                  <button id="btn-half-b">Half</button>
                  <button id="btn-double-b">Double</button>
                  <button id="btn-slower-b">Slower</button>
                  <button id="btn-faster-b">Faster</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Match Readout & Crossfader Bar (Bottom Center) -->
          <div class="stage-center-dock">
            <div class="match-readout" id="match-readout">
              <span id="match-tempo-diff">Tempo diff --</span>
              <span id="match-beat-offset">Beat offset --</span>
            </div>
            <div class="crossfader-bar" id="crossfader-bar">
              <span class="crossfader-label-a">A</span>
              <div class="crossfader-track-container" id="crossfader-track-container">
                <div class="crossfader-track-line"></div>
                <div class="crossfader-tick"></div>
                <div class="crossfader-handle" id="crossfader-handle" style="left: 50%;"></div>
              </div>
              <span class="crossfader-label-b">B</span>
            </div>
          </div>
        </div>
      </main>

      <!-- Footer (32px) -->
      <footer class="stage-footer">
        <div class="stage-footer-hint">Raise both palms and hold for gestures</div>
        <div class="stage-footer-status mono" id="stage-footer-status">60 FPS | 0 ms</div>
      </footer>
    `;
  }

  private initComponents() {
    if (!this.element) return;

    this.videoEl = this.element.querySelector('#stage-video') as HTMLVideoElement;
    this.canvasEl = this.element.querySelector('#stage-hand-canvas') as HTMLCanvasElement;

    if (this.canvasEl) {
      this.handOverlay = new HandOverlayRenderer(this.canvasEl);
      this.resizeCanvas();
      window.addEventListener('resize', this.onResizeBound);
    }

    const poseChipsLayer = this.element.querySelector('#pose-chips-layer') as HTMLElement;
    if (poseChipsLayer) {
      this.poseChipRenderer = new PoseChipRenderer(poseChipsLayer);
    }

    const panelElA = this.element.querySelector('#deck-panel-a') as HTMLElement;
    const panelElB = this.element.querySelector('#deck-panel-b') as HTMLElement;
    this.deckPanelA = new DeckPanelUI(panelElA, 'A');
    this.deckPanelB = new DeckPanelUI(panelElB, 'B');

    const readoutElA = this.element.querySelector('#control-readout-a') as HTMLElement;
    const readoutElB = this.element.querySelector('#control-readout-b') as HTMLElement;
    this.stripA = new ControlStrip(readoutElA, 'A');
    this.stripB = new ControlStrip(readoutElB, 'B');

    const xfaderEl = this.element.querySelector('#crossfader-bar') as HTMLElement;
    this.crossfaderBar = new CrossfaderBar(xfaderEl);

    const matchEl = this.element.querySelector('#match-readout') as HTMLElement;
    this.matchReadout = new MatchReadoutUI(matchEl);

    this.initVisionPipeline();
  }

  private onResizeBound = () => this.resizeCanvas();

  private resizeCanvas() {
    if (!this.canvasEl || !this.element) return;
    const viewport = this.element.querySelector('#stage-viewport') as HTMLElement | null;
    if (viewport) {
      this.handOverlay?.resize(viewport.clientWidth, viewport.clientHeight);
    }
  }

  private async initVisionPipeline() {
    const state = appStore.getState();
    if (state.camera.permission !== 'granted' || !this.videoEl) {
      return;
    }

    try {
      const stream = cameraService.getStream() || (await cameraService.startCamera(this.videoEl));
      if (this.videoEl.srcObject !== stream) {
        this.videoEl.srcObject = stream;
        await this.videoEl.play().catch(() => {});
      }

      trackerClient.start(this.videoEl, (hands, vw, vh) => {
        this.onHandsTracked(hands, vw, vh);
      });
    } catch {
      appStore.setTrackingMetrics(0, 0, 'failed');
      appStore.setSystemMessage('Hand tracking could not start. You can keep going with the mouse.');
    }
  }

  private onHandsTracked(hands: TrackedHand[], vw: number, vh: number) {
    if (!this.canvasEl) return;
    const viewport = this.element?.querySelector('#stage-viewport') as HTMLElement | null;
    const sw = viewport ? viewport.clientWidth : 1440;
    const sh = viewport ? viewport.clientHeight : 800;

    const now = performance.now();
    const visuals = gestureController.processFrame(hands, now, vw, vh, sw, sh);

    // Build engaged fingertips map
    const engagedTips: { [handId: number]: number } = {};
    for (const v of visuals) {
      if (v.engagedFingertip !== undefined) {
        engagedTips[v.handId] = v.engagedFingertip;
      }
    }

    this.handOverlay?.render(hands, vw, vh, sw, sh, engagedTips);
    this.poseChipRenderer?.render(visuals, gestureController.getHelpProgress(), sw, sh);

    if (this.helpOverlay) {
      this.helpOverlay.updateLiveHighlighting(visuals);
    }

    if (this.tuningPanel) {
      this.tuningPanel.updateFingerDebug(hands, vw, vh);
    }
  }

  private attachHeaderEvents() {
    if (!this.element) return;

    const btnRec = this.element.querySelector('#btn-header-rec') as HTMLButtonElement | null;
    if (btnRec) {
      btnRec.addEventListener('click', () => this.toggleRecording());
    }

    this.element.querySelector('#btn-header-mute')?.addEventListener('click', () => {
      appStore.toggleMute();
    });
    this.element.querySelector('#btn-header-tuning')?.addEventListener('click', () => {
      appStore.toggleTuningPanel();
    });
    this.element.querySelector('#btn-header-help')?.addEventListener('click', () => {
      appStore.toggleGesturesOverlay();
    });

    const chkVideo = this.element.querySelector('#chk-include-video') as HTMLInputElement | null;
    if (chkVideo) {
      chkVideo.addEventListener('change', () => {
        appStore.setIncludeVideo(chkVideo.checked);
      });
    }
  }

  private attachKeyboardEvents() {
    window.addEventListener('keydown', this.onKeyDownBound);
    window.addEventListener('keyup', this.onKeyUpBound);
  }

  private toggleRecording() {
    const state = appStore.getState();
    const isRecording = state.recording.isRecording;

    if (isRecording) {
      if (state.recording.includeVideo) {
        videoCompositor.stop();
      } else {
        audioMixRecorder.stop();
      }
    } else {
      const audioStream = audioEngine.getRecorderStream();
      if (!audioStream) return;

      if (state.recording.includeVideo) {
        videoCompositor.start(this.videoEl, audioStream);
      } else {
        audioMixRecorder.start(audioStream);
      }
    }
  }

  private showMixRecordedModal(blob: Blob) {
    if (!this.element) return;
    const existing = this.element.querySelector('#mix-recorded-modal');
    if (existing) existing.remove();

    const state = appStore.getState();
    const isVideo = state.recording.includeVideo;
    const ext = isVideo ? videoCompositor.getExtension() : audioMixRecorder.getExtension();

    const modal = document.createElement('div');
    modal.id = 'mix-recorded-modal';
    modal.className = 'overlay-backdrop';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';

    modal.innerHTML = `
      <div style="background-color: var(--color-surface-1); border: var(--border-hairline-strong); border-radius: var(--radius-panel); padding: var(--space-24); display: flex; flex-direction: column; gap: var(--space-16); min-width: 320px; text-align: center;">
        <h3 style="font-size: 15px; font-weight: 500;">Mix recorded.</h3>
        <div style="display: flex; justify-content: center; gap: var(--space-12);">
          <button class="primary" id="btn-modal-save">Save</button>
          <button id="btn-modal-discard">Discard</button>
        </div>
      </div>
    `;

    this.element.appendChild(modal);

    const btnSave = modal.querySelector('#btn-modal-save') as HTMLButtonElement;
    const btnDiscard = modal.querySelector('#btn-modal-discard') as HTMLButtonElement;

    btnSave.addEventListener('click', () => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = formatMixFilename(ext || (isVideo ? 'webm' : 'webm'));
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      modal.remove();
      appStore.setRecordedBlob(null, null);
    });

    btnDiscard.addEventListener('click', () => {
      modal.remove();
      appStore.setRecordedBlob(null, null);
    });
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (e.repeat) return;
    const key = e.key.toUpperCase();

    // 1: Sync deck A
    if (key === '1') {
      audioEngine.performSync('A');
    }
    // 2: Sync deck B
    else if (key === '2') {
      audioEngine.performSync('B');
    }
    // Q: Deck A slower
    else if (key === 'Q') {
      appStore.setNudge('A', 'slower', true);
    }
    // W: Deck A faster
    else if (key === 'W') {
      appStore.setNudge('A', 'faster', true);
    }
    // O: Deck B slower
    else if (key === 'O') {
      appStore.setNudge('B', 'slower', true);
    }
    // P: Deck B faster
    else if (key === 'P') {
      appStore.setNudge('B', 'faster', true);
    }
    // R: Start or stop recording
    else if (key === 'R') {
      this.toggleRecording();
    }
    // M: Mute or unmute
    else if (key === 'M') {
      appStore.toggleMute();
    }
    // T: Tuning
    else if (key === 'T') {
      appStore.toggleTuningPanel();
    }
    // H: This list (help gestures overlay)
    else if (key === 'H') {
      appStore.toggleGesturesOverlay();
    }
  }

  private handleKeyUp(e: KeyboardEvent) {
    const key = e.key.toUpperCase();
    if (key === 'Q') {
      appStore.setNudge('A', 'slower', false);
    } else if (key === 'W') {
      appStore.setNudge('A', 'faster', false);
    } else if (key === 'O') {
      appStore.setNudge('B', 'slower', false);
    } else if (key === 'P') {
      appStore.setNudge('B', 'faster', false);
    }
  }

  private updateView(state: ReturnType<typeof appStore.getState>) {
    if (!this.element) return;

    // Header buttons
    const btnMute = this.element.querySelector('#btn-header-mute') as HTMLButtonElement | null;
    if (btnMute) {
      btnMute.textContent = state.isMuted ? 'Unmute' : 'Mute';
    }

    const sysMsgEl = this.element.querySelector('#stage-system-message') as HTMLElement | null;
    if (sysMsgEl) {
      if (state.systemMessage) {
        sysMsgEl.textContent = state.systemMessage;
        sysMsgEl.style.display = 'block';
      } else {
        sysMsgEl.style.display = 'none';
      }
    }

    const btnRec = this.element.querySelector('#btn-header-rec') as HTMLButtonElement | null;
    const recIndicator = this.element.querySelector('#rec-indicator') as HTMLElement | null;
    const recTimer = this.element.querySelector('#rec-timer') as HTMLElement | null;

    if (btnRec) {
      btnRec.textContent = state.recording.isRecording ? 'Stop' : 'Rec';
    }

    if (recIndicator) {
      recIndicator.style.display = state.recording.isRecording ? 'inline-flex' : 'none';
      if (recTimer && state.recording.isRecording) {
        const mins = Math.floor(state.recording.durationSec / 60);
        const secs = Math.floor(state.recording.durationSec % 60);
        recTimer.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      }
    }

    // Modal when recording is ready
    if (state.recording.recordedBlob && !this.element.querySelector('#mix-recorded-modal')) {
      this.showMixRecordedModal(state.recording.recordedBlob);
    }

    // Gestures Help Overlay toggle
    if (state.overlays.showGestures && !this.helpOverlay) {
      this.helpOverlay = new HelpGesturesOverlay();
      this.helpOverlay.mount(this.element);
    } else if (!state.overlays.showGestures && this.helpOverlay) {
      this.helpOverlay.unmount();
      this.helpOverlay = null;
    }

    // Tuning Panel drawer toggle
    if (state.overlays.showTuning && !this.tuningPanel) {
      this.tuningPanel = new TuningPanel();
      this.tuningPanel.mount(this.element);
    } else if (!state.overlays.showTuning && this.tuningPanel) {
      this.tuningPanel.unmount();
      this.tuningPanel = null;
    }

    // Update Rest Zone line according to tuning setting
    const restZoneLine = this.element.querySelector('.rest-zone-line') as HTMLElement | null;
    if (restZoneLine) {
      const pct = (state.tuning.restZoneHeight * 100).toFixed(1);
      restZoneLine.style.bottom = `${pct}%`;
    }

    // Update Deck Panels
    if (this.deckPanelA) this.deckPanelA.update(state.decks.A);
    if (this.deckPanelB) this.deckPanelB.update(state.decks.B);

    // Update Strips
    if (this.stripA) this.stripA.update(state.decks.A);
    if (this.stripB) this.stripB.update(state.decks.B);

    // Update Crossfader
    if (this.crossfaderBar) this.crossfaderBar.update(state.crossfader);

    // Footer metrics
    const statusEl = this.element.querySelector('#stage-footer-status');
    if (statusEl) {
      statusEl.textContent = `${state.camera.fps} FPS | ${Math.round(state.camera.latencyMs)} ms`;
    }
  }

  unmount(): void {
    window.removeEventListener('keydown', this.onKeyDownBound);
    window.removeEventListener('keyup', this.onKeyUpBound);
    window.removeEventListener('resize', this.onResizeBound);

    trackerClient.stop();
    cameraService.stopCamera();

    if (this.helpOverlay) {
      this.helpOverlay.unmount();
      this.helpOverlay = null;
    }
    if (this.tuningPanel) {
      this.tuningPanel.unmount();
      this.tuningPanel = null;
    }
    if (this.poseChipRenderer) {
      this.poseChipRenderer.clear();
      this.poseChipRenderer = null;
    }
    if (this.handOverlay) {
      this.handOverlay.clear();
      this.handOverlay = null;
    }

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.deckPanelA) {
      this.deckPanelA.destroy();
      this.deckPanelA = null;
    }
    if (this.deckPanelB) {
      this.deckPanelB.destroy();
      this.deckPanelB = null;
    }
    if (this.matchReadout) {
      this.matchReadout.destroy();
      this.matchReadout = null;
    }

    if (this.element && this.element.parentElement) {
      this.element.parentElement.removeChild(this.element);
    }
    this.element = null;
  }
}
