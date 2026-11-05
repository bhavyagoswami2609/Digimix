import { appStore } from '../store.ts';
import { ScreenComponent } from '../router.ts';
import { APP_NAME } from '../../config.ts';
import { DeckPanelUI } from '../../ui/deck-panel.ts';
import { ControlStrip } from '../../ui/strip.ts';
import { CrossfaderBar } from '../../ui/crossfader-bar.ts';
import { MatchReadoutUI } from '../../ui/match-readout.ts';
import { audioEngine } from '../../audio/engine.ts';

export class StageScreen implements ScreenComponent {
  private element: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;

  private deckPanelA: DeckPanelUI | null = null;
  private deckPanelB: DeckPanelUI | null = null;
  private stripA: ControlStrip | null = null;
  private stripB: ControlStrip | null = null;
  private crossfaderBar: CrossfaderBar | null = null;
  private matchReadout: MatchReadoutUI | null = null;

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
          <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--color-text-dim); cursor: pointer; user-select: none;">
            <input type="checkbox" id="chk-include-video" style="accent-color: var(--color-text);">
            <span>Include video</span>
          </label>
          <button id="btn-header-tuning">Tuning</button>
          <button id="btn-header-help">Help</button>
        </div>
      </header>

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
  }

  private attachHeaderEvents() {
    if (!this.element) return;

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
