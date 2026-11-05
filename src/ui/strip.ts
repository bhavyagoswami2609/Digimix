import { appStore, DeckControl, DeckId } from '../app/store.ts';
import { AUDIO_CONFIG } from '../config.ts';
import { eqCurve, tempoCurve } from '../audio/curves.ts';

export class ControlStrip {
  private container: HTMLElement;
  private deckId: DeckId;
  private isDragging = false;

  constructor(container: HTMLElement, deckId: DeckId) {
    this.container = container;
    this.deckId = deckId;
    this.attachMouseEvents();
  }

  private attachMouseEvents() {
    const rows = this.container.querySelectorAll('.control-row');
    rows.forEach((rowEl) => {
      const row = rowEl as HTMLElement;
      const controlName = row.dataset.control as DeckControl;
      if (!controlName) return;

      const trackWrapper = row.querySelector('.control-track-wrapper') as HTMLElement;

      const onPointerDown = (e: MouseEvent) => {
        this.isDragging = true;
        appStore.setActiveControl(this.deckId, controlName);
        this.updateValueFromPointer(e, trackWrapper, controlName);

        const onPointerMove = (moveEvent: MouseEvent) => {
          if (!this.isDragging) return;
          this.updateValueFromPointer(moveEvent, trackWrapper, controlName);
        };

        const onPointerUp = () => {
          this.isDragging = false;
          appStore.setActiveControl(this.deckId, null);
          window.removeEventListener('mousemove', onPointerMove);
          window.removeEventListener('mouseup', onPointerUp);
        };

        window.addEventListener('mousemove', onPointerMove);
        window.addEventListener('mouseup', onPointerUp);
      };

      row.addEventListener('mousedown', onPointerDown);

      // "Mouse equivalents. Every control row (Tempo included)... operable by mouse (drag, double click to reset)."
      row.addEventListener('dblclick', () => {
        let defU = 0.5;
        if (controlName === 'volume') defU = AUDIO_CONFIG.DEFAULT_U.VOLUME;
        appStore.setDeckControl(this.deckId, controlName, defU);
      });
    });
  }

  private updateValueFromPointer(e: MouseEvent, trackWrapper: HTMLElement, control: DeckControl) {
    const rect = trackWrapper.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const u = Math.max(0, Math.min(1, x / rect.width));
    appStore.setDeckControl(this.deckId, control, u);
  }

  update(deckState: ReturnType<typeof appStore.getState>['decks']['A']) {
    const controls: DeckControl[] = ['volume', 'bass', 'mid', 'treble', 'tempo'];
    const activeClass = this.deckId === 'A' ? 'active-deck-a' : 'active-deck-b';

    for (const ctrl of controls) {
      const row = this.container.querySelector(`[data-control="${ctrl}"]`) as HTMLElement | null;
      if (!row) continue;

      const isActive = deckState.activeControl === ctrl;
      row.classList.toggle(activeClass, isActive);

      const fill = row.querySelector('.control-fill') as HTMLElement | null;
      const val = row.querySelector('.control-value') as HTMLElement | null;

      const u = deckState[ctrl];
      if (ctrl === 'volume') {
        const pct = Math.round(u * 100);
        if (val) val.textContent = String(pct);
        if (fill) {
          fill.style.left = '0%';
          fill.style.width = `${u * 100}%`;
        }
      } else if (ctrl === 'tempo') {
        const t = tempoCurve(u);
        if (val) val.textContent = t.displayStr;
        if (fill) {
          const left = Math.min(0.5, u) * 100;
          const width = Math.abs(u - 0.5) * 100;
          fill.style.left = `${left}%`;
          fill.style.width = `${width}%`;
        }
      } else {
        // Bass, Mid, Treble EQ
        const eq = eqCurve(u);
        if (val) val.textContent = eq.displayStr;
        if (fill) {
          const left = Math.min(0.5, u) * 100;
          const width = Math.abs(u - 0.5) * 100;
          fill.style.left = `${left}%`;
          fill.style.width = `${width}%`;
        }
      }
    }
  }
}
