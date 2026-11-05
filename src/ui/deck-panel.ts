import { appStore, DeckId, DeckState } from '../app/store.ts';
import { audioEngine } from '../audio/engine.ts';
import { tempoCurve } from '../audio/curves.ts';
import { drawOverviewWaveform, drawBeatViewWaveform } from '../audio/waveform.ts';
import { getVisibleBeatLines } from '../audio/beatgrid.ts';

export class DeckPanelUI {
  private container: HTMLElement;
  private deckId: DeckId;
  private deckColor: string;

  private overviewCanvas: HTMLCanvasElement;
  private beatviewCanvas: HTMLCanvasElement;
  private animId: number | null = null;

  constructor(container: HTMLElement, deckId: DeckId) {
    this.container = container;
    this.deckId = deckId;
    this.deckColor = deckId === 'A' ? '#E8793A' : '#4FA3D1';

    this.overviewCanvas = container.querySelector(`.deck-overview-canvas`) as HTMLCanvasElement;
    this.beatviewCanvas = container.querySelector(`.deck-beatview-canvas`) as HTMLCanvasElement;

    this.initCanvasDpi();
    this.attachEvents();
    this.startRenderLoop();
  }

  private initCanvasDpi() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.overviewCanvas.clientWidth || 500;

    this.overviewCanvas.width = w * dpr;
    this.overviewCanvas.height = 72 * dpr;

    this.beatviewCanvas.width = w * dpr;
    this.beatviewCanvas.height = 56 * dpr;
  }

  private attachEvents() {
    // 1. Play / Pause
    const btnPlay = this.container.querySelector(`#btn-play-${this.deckId.toLowerCase()}`) as HTMLButtonElement;
    btnPlay.addEventListener('click', () => {
      const state = appStore.getState().decks[this.deckId];
      appStore.setTransportPlaying(this.deckId, !state.isPlaying);
    });

    // 2. Cue
    const btnCue = this.container.querySelector(`#btn-cue-${this.deckId.toLowerCase()}`) as HTMLButtonElement;
    btnCue.addEventListener('click', () => {
      appStore.triggerCue(this.deckId);
    });

    // 3. Sync
    const btnSync = this.container.querySelector(`#btn-sync-${this.deckId.toLowerCase()}`) as HTMLButtonElement;
    btnSync.addEventListener('click', () => {
      audioEngine.performSync(this.deckId);
    });

    // 4. Half & Double BPM
    const btnHalf = this.container.querySelector(`#btn-half-${this.deckId.toLowerCase()}`) as HTMLButtonElement;
    btnHalf.addEventListener('click', () => {
      const state = appStore.getState().decks[this.deckId];
      if (state.baseBpm) {
        appStore.setDeckBpm(this.deckId, state.baseBpm / 2, state.firstBeatOffsetSec);
      }
    });

    const btnDouble = this.container.querySelector(`#btn-double-${this.deckId.toLowerCase()}`) as HTMLButtonElement;
    btnDouble.addEventListener('click', () => {
      const state = appStore.getState().decks[this.deckId];
      if (state.baseBpm) {
        appStore.setDeckBpm(this.deckId, state.baseBpm * 2, state.firstBeatOffsetSec);
      }
    });

    // 5. Nudge Slower / Faster (active while held)
    const btnSlower = this.container.querySelector(`#btn-slower-${this.deckId.toLowerCase()}`) as HTMLButtonElement;
    const btnFaster = this.container.querySelector(`#btn-faster-${this.deckId.toLowerCase()}`) as HTMLButtonElement;

    const setupNudgeHold = (btn: HTMLButtonElement, direction: 'slower' | 'faster') => {
      const start = () => appStore.setNudge(this.deckId, direction, true);
      const stop = () => appStore.setNudge(this.deckId, direction, false);

      btn.addEventListener('mousedown', start);
      btn.addEventListener('mouseup', stop);
      btn.addEventListener('mouseleave', stop);
    };
    setupNudgeHold(btnSlower, 'slower');
    setupNudgeHold(btnFaster, 'faster');

    // 6. Clickable BPM to type value
    const bpmGroup = this.container.querySelector(`#bpm-group-${this.deckId.toLowerCase()}`) as HTMLElement;
    bpmGroup.addEventListener('click', () => {
      const state = appStore.getState().decks[this.deckId];
      const current = state.baseBpm ? Math.round(state.baseBpm) : 120;
      const input = prompt('Enter BPM:', String(current));
      if (input !== null) {
        const parsed = parseFloat(input);
        if (!isNaN(parsed) && parsed > 20 && parsed < 300) {
          appStore.setDeckBpm(this.deckId, parsed, state.firstBeatOffsetSec);
        }
      }
    });

    // 7. Click Overview Waveform to Seek
    this.overviewCanvas.addEventListener('click', (e) => {
      const node = audioEngine.getDeck(this.deckId);
      const buffer = node?.getBuffer();
      if (!buffer) return;

      const rect = this.overviewCanvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const progress = Math.max(0, Math.min(1, clickX / rect.width));
      const targetSec = progress * buffer.duration;

      if (node) {
        node.seek(targetSec);
        appStore.setDeckPosition(this.deckId, targetSec);
      }
    });

    // 8. Drag and drop file onto deck panel
    this.container.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.container.classList.add('drag-over');
    });
    this.container.addEventListener('dragleave', () => {
      this.container.classList.remove('drag-over');
    });
    this.container.addEventListener('drop', (e) => {
      e.preventDefault();
      this.container.classList.remove('drag-over');
      const file = e.dataTransfer?.files?.[0];
      if (file) {
        audioEngine.loadTrackFile(this.deckId, file);
      }
    });
  }

  private startRenderLoop() {
    const loop = () => {
      this.renderWaveforms();
      this.animId = requestAnimationFrame(loop);
    };
    this.animId = requestAnimationFrame(loop);
  }

  private renderWaveforms() {
    const node = audioEngine.getDeck(this.deckId);
    if (!node) return;

    const buffer = node.getBuffer();
    const peaks = node.getPeaks();
    const duration = buffer ? buffer.duration : 0;
    const currentPos = node.getCurrentPosition();
    const progress = duration > 0 ? currentPos / duration : 0;

    // Draw overview waveform
    drawOverviewWaveform(this.overviewCanvas, peaks, progress, this.deckColor);

    // Draw beat view waveform (~8s window)
    const state = appStore.getState().decks[this.deckId];
    const beatLines = state.baseBpm
      ? getVisibleBeatLines(currentPos, 8.0, state.baseBpm, state.firstBeatOffsetSec)
      : [];

    drawBeatViewWaveform(this.beatviewCanvas, buffer, currentPos, 8.0, beatLines, this.deckColor);
  }

  update(deckState: DeckState) {
    // 1. Filename
    const fnEl = this.container.querySelector(`#filename-${this.deckId.toLowerCase()}`);
    if (fnEl) fnEl.textContent = deckState.file?.name || 'No track loaded';

    // 2. Remaining time (-mm:ss)
    const timeEl = this.container.querySelector(`#remaining-time-${this.deckId.toLowerCase()}`);
    if (timeEl) {
      const node = audioEngine.getDeck(this.deckId);
      const remainingSec = node ? node.getRemainingTime() : 0;
      const mins = Math.floor(remainingSec / 60);
      const secs = Math.floor(remainingSec % 60);
      timeEl.textContent = `-${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    // 3. Play button text
    const btnPlay = this.container.querySelector(`#btn-play-${this.deckId.toLowerCase()}`) as HTMLButtonElement | null;
    if (btnPlay) {
      btnPlay.textContent = deckState.isPlaying ? 'Pause' : 'Play';
    }

    // 4. BPM & Tempo display
    const bpmValEl = this.container.querySelector(`#bpm-val-${this.deckId.toLowerCase()}`);
    const tempoPctEl = this.container.querySelector(`#tempo-pct-${this.deckId.toLowerCase()}`);
    const node = audioEngine.getDeck(this.deckId);

    const actualRate = node ? node.getActualPlaybackRate() : 1.0;
    const tempoInfo = tempoCurve(deckState.tempo);

    if (tempoPctEl) {
      tempoPctEl.textContent = tempoInfo.displayStr;
    }

    if (bpmValEl) {
      if (deckState.isAnalyzingBpm) {
        bpmValEl.textContent = '...';
      } else if (deckState.baseBpm !== null) {
        const dispBpm = deckState.baseBpm * actualRate;
        bpmValEl.textContent = dispBpm.toFixed(1);
      } else {
        bpmValEl.textContent = '--.-';
      }
    }
  }

  destroy() {
    if (this.animId !== null) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  }
}
