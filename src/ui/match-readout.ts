import { appStore } from '../app/store.ts';
import { audioEngine } from '../audio/engine.ts';
import { calculateBeatPhase } from '../audio/beatgrid.ts';
import { computeMatchReadout } from '../audio/sync.ts';

export class MatchReadoutUI {
  private container: HTMLElement;
  private intervalId: number | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.startLoop();
  }

  private startLoop() {
    // 15 Hz is every ~66.6 ms
    this.intervalId = window.setInterval(() => {
      this.render();
    }, 1000 / 15);
  }

  private render() {
    const state = appStore.getState();
    const isBothPlaying = state.decks.A.isPlaying && state.decks.B.isPlaying;

    if (!isBothPlaying || !state.decks.A.baseBpm || !state.decks.B.baseBpm) {
      this.container.innerHTML = `
        <span id="match-tempo-diff">Tempo diff --</span>
        <span id="match-beat-offset">Beat offset --</span>
      `;
      return;
    }

    const nodeA = audioEngine.getDeck('A');
    const nodeB = audioEngine.getDeck('B');
    if (!nodeA || !nodeB) return;

    const displayedBpmA = state.decks.A.baseBpm * nodeA.getActualPlaybackRate();
    const displayedBpmB = state.decks.B.baseBpm * nodeB.getActualPlaybackRate();

    const posA = nodeA.getCurrentPosition();
    const posB = nodeB.getCurrentPosition();

    const phaseA = calculateBeatPhase(posA, state.decks.A.baseBpm, state.decks.A.firstBeatOffsetSec);
    const phaseB = calculateBeatPhase(posB, state.decks.B.baseBpm, state.decks.B.firstBeatOffsetSec);

    const match = computeMatchReadout(displayedBpmA, displayedBpmB, phaseA, phaseB);

    if (match.isMatched) {
      this.container.innerHTML = `<span class="match-matched">Matched</span>`;
    } else {
      this.container.innerHTML = `
        <span id="match-tempo-diff">Tempo diff ${match.tempoDiffStr}</span>
        <span id="match-beat-offset">Beat offset ${match.beatOffsetStr}</span>
      `;
    }
  }

  destroy() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
