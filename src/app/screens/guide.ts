import { appStore } from '../store.ts';
import { ScreenComponent } from '../router.ts';

const GUIDE_STEPS = [
  {
    num: '01 / 04',
    heading: 'Two hands, two decks.',
    body: 'Your left hand controls the left deck and your right hand controls the right deck. Hands resting in the bottom strip are ignored, so you can put them down whenever you like.',
    highlight: 'decks'
  },
  {
    num: '02 / 04',
    heading: 'Pinch, then move.',
    body: 'Touch your thumb to a fingertip to pick a control. Index finger is volume, middle is bass, ring is mid, pinky is treble. Move your hand up to raise it and down to lower it. Let go to reposition. The next pinch continues from where you left off. Pinch the same finger twice, quickly and without moving, to reset that control.',
    highlight: 'vol-bass'
  },
  {
    num: '03 / 04',
    heading: 'Crossfader, tempo and playback.',
    body: 'Point with one finger and slide left or right for the crossfader. Hold up two fingers like a peace sign and move up or down to change that deck\'s tempo. When the Match readout says Matched, the two decks are in time. Hold a thumbs up for half a second to play or pause. Hold a fist for half a second to return to the cue point.',
    highlight: 'crossfader'
  },
  {
    num: '04 / 04',
    heading: 'Keep it small.',
    body: 'Rest your elbows. Small movements are enough, and you can lower your hands to the rest zone between moves. Raise both open palms and hold to bring up the gesture list at any time.',
    highlight: 'rest-zone'
  }
];

export class GuideScreen implements ScreenComponent {
  private element: HTMLElement | null = null;
  private animId: number | null = null;
  private step = 0;

  mount(container: HTMLElement): void {
    this.step = appStore.getState().guideStep;
    this.element = document.createElement('div');
    this.element.className = 'screen screen-guide';

    this.render();
    container.appendChild(this.element);
    this.startMiniatureLoop();
  }

  private render() {
    if (!this.element) return;
    const current = GUIDE_STEPS[this.step];
    const isLast = this.step === GUIDE_STEPS.length - 1;

    this.element.innerHTML = `
      <div class="guide-container">
        <div class="guide-left">
          <div class="guide-step-num mono">${current.num}</div>
          <h2 class="guide-heading">${current.heading}</h2>
          <p class="guide-body">${current.body}</p>
          <div class="guide-actions">
            ${this.step > 0 ? '<button id="btn-guide-back">Back</button>' : ''}
            <button class="primary" id="btn-guide-next">${isLast ? 'Continue' : 'Next'}</button>
            <button class="text-link" id="btn-guide-skip">Skip</button>
          </div>
        </div>
        <div class="guide-right">
          <div class="guide-miniature" id="guide-miniature" style="transform: scale(0.8); transform-origin: center center; width: 440px;">
            <!-- Miniature representation of the stage components -->
            <div style="background-color: var(--color-surface-2); border: var(--border-hairline); border-radius: var(--radius-panel); padding: 12px; display: flex; flex-direction: column; gap: 12px;">
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div style="background-color: var(--color-surface-1); border: var(--border-hairline); border-radius: 4px; padding: 8px; ${current.highlight === 'decks' ? 'outline: 2px solid var(--color-deck-a);' : ''}">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <span class="deck-tag deck-tag-a">A</span>
                    <span class="mono" style="font-size: 11px; color: var(--color-text-dim);">-03:42</span>
                  </div>
                  <div style="height: 24px; background: var(--color-surface-2); margin-bottom: 4px;"></div>
                  <div style="font-size: 13px; font-family: var(--font-mono); color: var(--color-text);">124.0 <span style="font-size: 9px; color: var(--color-text-dim);">BPM</span></div>
                </div>
                <div style="background-color: var(--color-surface-1); border: var(--border-hairline); border-radius: 4px; padding: 8px; ${current.highlight === 'decks' ? 'outline: 2px solid var(--color-deck-b);' : ''}">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <span class="deck-tag deck-tag-b">B</span>
                    <span class="mono" style="font-size: 11px; color: var(--color-text-dim);">-04:15</span>
                  </div>
                  <div style="height: 24px; background: var(--color-surface-2); margin-bottom: 4px;"></div>
                  <div style="font-size: 13px; font-family: var(--font-mono); color: var(--color-text);">126.0 <span style="font-size: 9px; color: var(--color-text-dim);">BPM</span></div>
                </div>
              </div>

              <!-- Strip rows preview -->
              <div style="background-color: var(--color-surface-1); border: var(--border-hairline); border-radius: 4px; padding: 6px 10px; display: flex; flex-direction: column; gap: 4px;">
                <div class="control-row ${current.highlight === 'vol-bass' ? 'active-deck-a' : ''}" style="height: 22px; padding: 0 4px;">
                  <span class="control-label" style="font-size: 9px; width: 32px;">VOL</span>
                  <div class="control-track-wrapper"><div class="control-track"><div id="mini-vol-fill" class="control-fill" style="left: 0; width: 75%;"></div></div></div>
                  <span id="mini-vol-val" class="control-value mono" style="font-size: 11px; width: 36px;">75</span>
                </div>
                <div class="control-row ${current.highlight === 'vol-bass' ? 'active-deck-a' : ''}" style="height: 22px; padding: 0 4px;">
                  <span class="control-label" style="font-size: 9px; width: 32px;">BASS</span>
                  <div class="control-track-wrapper"><div class="control-track"><div id="mini-bass-fill" class="control-fill" style="left: 50%; width: 0%;"></div></div></div>
                  <span id="mini-bass-val" class="control-value mono" style="font-size: 11px; width: 36px;">0.0</span>
                </div>
              </div>

              <!-- Crossfader preview -->
              <div style="background-color: var(--color-surface-1); border: var(--border-hairline); border-radius: 4px; padding: 8px 12px; ${current.highlight === 'crossfader' ? 'outline: 2px solid var(--color-text);' : ''}">
                <div class="crossfader-bar" style="height: 16px;">
                  <span class="crossfader-label-a" style="font-size: 11px;">A</span>
                  <div class="crossfader-track-container">
                    <div class="crossfader-track-line"></div>
                    <div class="crossfader-tick"></div>
                    <div id="mini-xfader-handle" class="crossfader-handle" style="left: 50%;"></div>
                  </div>
                  <span class="crossfader-label-b" style="font-size: 11px;">B</span>
                </div>
              </div>

              <!-- Rest zone preview -->
              <div style="height: 28px; border-top: 1px dotted var(--color-line-strong); display: flex; align-items: center; justify-content: flex-end; padding: 0 8px; ${current.highlight === 'rest-zone' ? 'background: rgba(255,255,255,0.05);' : ''}">
                <span class="label-caps" style="font-size: 9px;">Rest zone</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    const btnBack = this.element.querySelector('#btn-guide-back') as HTMLButtonElement | null;
    const btnNext = this.element.querySelector('#btn-guide-next') as HTMLButtonElement;
    const btnSkip = this.element.querySelector('#btn-guide-skip') as HTMLButtonElement;

    if (btnBack) {
      btnBack.addEventListener('click', () => {
        if (this.step > 0) {
          this.step--;
          appStore.setGuideStep(this.step);
          this.render();
        }
      });
    }

    btnNext.addEventListener('click', () => {
      if (this.step < GUIDE_STEPS.length - 1) {
        this.step++;
        appStore.setGuideStep(this.step);
        this.render();
      } else {
        appStore.markGuideSeen();
        appStore.setScreen('setup');
      }
    });

    btnSkip.addEventListener('click', () => {
      appStore.markGuideSeen();
      appStore.setScreen('setup');
    });
  }

  private startMiniatureLoop() {
    const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (isReduced) return;

    let startTime = performance.now();

    const loop = (now: number) => {
      const elapsed = (now - startTime) % 3000;
      const progress = elapsed / 3000; // 0 to 1 over 3s loop
      // Sine wave between 0 and 1
      const wave = (Math.sin(progress * Math.PI * 2 - Math.PI / 2) + 1) / 2;

      const current = GUIDE_STEPS[this.step];
      if (current.highlight === 'vol-bass') {
        const volVal = Math.round(50 + wave * 40);
        const elVal = document.getElementById('mini-vol-val');
        const elFill = document.getElementById('mini-vol-fill');
        if (elVal && elFill) {
          elVal.textContent = String(volVal);
          elFill.style.width = `${volVal}%`;
        }
      } else if (current.highlight === 'crossfader') {
        const xPos = 20 + wave * 60; // 20% to 80%
        const elHandle = document.getElementById('mini-xfader-handle');
        if (elHandle) {
          elHandle.style.left = `${xPos}%`;
        }
      }

      this.animId = requestAnimationFrame(loop);
    };

    this.animId = requestAnimationFrame(loop);
  }

  unmount(): void {
    if (this.animId !== null) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
    if (this.element && this.element.parentElement) {
      this.element.parentElement.removeChild(this.element);
    }
    this.element = null;
  }
}
