import { appStore } from './store.ts';
import { HandGestureVisualState } from '../gesture/controller.ts';

export class HelpGesturesOverlay {
  private element: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;

  mount(container: HTMLElement): void {
    this.element = document.createElement('div');
    this.element.className = 'overlay-backdrop';

    this.render();
    container.appendChild(this.element);

    this.attachEvents();
    this.unsubscribe = appStore.subscribe(() => {
      // Re-check overlay visibility
    });
  }

  private render() {
    if (!this.element) return;

    this.element.innerHTML = `
      <div class="gestures-overlay-panel">
        <div class="overlay-header">
          <h2 class="overlay-title">Gestures</h2>
          <button id="btn-overlay-close">Close</button>
        </div>

        <table class="gestures-table" id="gestures-table">
          <thead>
            <tr>
              <th>Gesture</th>
              <th>How</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            <tr data-gesture="Volume">
              <td>Volume</td>
              <td>Thumb touches index fingertip</td>
              <td>Move up or down</td>
            </tr>
            <tr data-gesture="Bass">
              <td>Bass</td>
              <td>Thumb touches middle fingertip</td>
              <td>Move up or down</td>
            </tr>
            <tr data-gesture="Mid">
              <td>Mid</td>
              <td>Thumb touches ring fingertip</td>
              <td>Move up or down</td>
            </tr>
            <tr data-gesture="Treble">
              <td>Treble</td>
              <td>Thumb touches pinky fingertip</td>
              <td>Move up or down</td>
            </tr>
            <tr data-gesture="Tempo">
              <td>Tempo</td>
              <td>Peace sign, index and middle fingers up</td>
              <td>Move up to speed up, down to slow down</td>
            </tr>
            <tr data-gesture="Crossfader">
              <td>Crossfader</td>
              <td>Point with one finger, either hand</td>
              <td>Slide left or right</td>
            </tr>
            <tr data-gesture="Play_Pause">
              <td>Play or pause</td>
              <td>Thumbs up, hold half a second</td>
              <td>Toggles the deck</td>
            </tr>
            <tr data-gesture="Cue">
              <td>Cue</td>
              <td>Fist, hold half a second</td>
              <td>Returns to the cue point</td>
            </tr>
            <tr data-gesture="Reset">
              <td>Reset</td>
              <td>Make the same pose twice, quickly, without moving</td>
              <td>That control returns to its default</td>
            </tr>
            <tr data-gesture="This list">
              <td>This list</td>
              <td>Raise both open palms, hold</td>
              <td>Shows or hides it</td>
            </tr>
          </tbody>
        </table>

        <div class="overlay-notes">
          <div>Sync matches tempo and lines up the beats. It works best on steady electronic tracks.</div>
          <div>Changing tempo also changes pitch.</div>
        </div>

        <div style="margin-top: var(--space-8);">
          <h3 style="font-size: 15px; font-weight: 500; margin-bottom: var(--space-12);">Keyboard</h3>
          <table class="gestures-table" style="max-width: 600px;">
            <thead>
              <tr>
                <th style="width: 80px;">Key</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr><td class="mono">1</td><td>Sync deck A</td></tr>
              <tr><td class="mono">2</td><td>Sync deck B</td></tr>
              <tr><td class="mono">Q</td><td>Deck A slower</td></tr>
              <tr><td class="mono">W</td><td>Deck A faster</td></tr>
              <tr><td class="mono">O</td><td>Deck B slower</td></tr>
              <tr><td class="mono">P</td><td>Deck B faster</td></tr>
              <tr><td class="mono">M</td><td>Mute or unmute</td></tr>
              <tr><td class="mono">R</td><td>Start or stop recording</td></tr>
              <tr><td class="mono">T</td><td>Tuning</td></tr>
              <tr><td class="mono">H</td><td>This list</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  private attachEvents() {
    if (!this.element) return;
    this.element.querySelector('#btn-overlay-close')?.addEventListener('click', () => {
      appStore.setGesturesOverlay(false);
    });

    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) {
        appStore.setGesturesOverlay(false);
      }
    });
  }

  updateLiveHighlighting(visuals: HandGestureVisualState[]) {
    if (!this.element) return;
    const rows = this.element.querySelectorAll('#gestures-table tbody tr');

    rows.forEach((r) => {
      r.classList.remove('active-deck-a', 'active-deck-b');
    });

    for (const v of visuals) {
      if (!v.poseName) continue;
      let targetAttr = v.poseName;
      if (v.poseName === 'Play' || v.poseName === 'Pause') targetAttr = 'Play_Pause';

      const row = this.element.querySelector(`[data-gesture="${targetAttr}"]`);
      if (row) {
        row.classList.add(v.deckId === 'A' ? 'active-deck-a' : 'active-deck-b');
      }
    }
  }

  unmount(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.element && this.element.parentElement) {
      this.element.parentElement.removeChild(this.element);
    }
    this.element = null;
  }
}
