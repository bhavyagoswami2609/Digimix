import { appStore } from './store.ts';
import { TrackedHand } from '../vision/tracker-client.ts';

export class TuningPanel {
  private element: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;
  private animId: number | null = null;

  mount(container: HTMLElement): void {
    this.element = document.createElement('div');
    this.element.className = 'tuning-panel-drawer';

    this.render();
    container.appendChild(this.element);

    this.attachEvents();
    this.startDebugLoop();

    this.unsubscribe = appStore.subscribe(() => {
      this.updateView();
    });
  }

  private render() {
    if (!this.element) return;
    const { tuning, camera } = appStore.getState();

    this.element.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: var(--border-hairline); padding-bottom: var(--space-12);">
        <h3 style="font-size: 15px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em;">Tuning</h3>
        <button id="btn-tuning-close" style="padding: 4px 8px;">Close</button>
      </div>

      <!-- Sensitivity (0.5 to 2.0) -->
      <div class="tuning-row">
        <div class="tuning-row-label-val">
          <span>Sensitivity</span>
          <span id="val-sensitivity" class="mono">${tuning.sensitivity.toFixed(2)}</span>
        </div>
        <input type="range" class="tuning-slider" id="slider-sensitivity" min="0.5" max="2.0" step="0.05" value="${tuning.sensitivity}" />
      </div>

      <!-- Smoothing (maps to minCutoff: 0.5 to 5.0) -->
      <div class="tuning-row">
        <div class="tuning-row-label-val">
          <span>Smoothing</span>
          <span id="val-smoothing" class="mono">${tuning.smoothing.toFixed(1)}</span>
        </div>
        <input type="range" class="tuning-slider" id="slider-smoothing" min="0.5" max="5.0" step="0.1" value="${tuning.smoothing}" />
      </div>

      <!-- Responsiveness (maps to beta: 1 to 30) -->
      <div class="tuning-row">
        <div class="tuning-row-label-val">
          <span>Responsiveness</span>
          <span id="val-responsiveness" class="mono">${tuning.responsiveness.toFixed(1)}</span>
        </div>
        <input type="range" class="tuning-slider" id="slider-responsiveness" min="1" max="30" step="1" value="${tuning.responsiveness}" />
      </div>

      <!-- Grab distance (0.15 to 0.40) -->
      <div class="tuning-row">
        <div class="tuning-row-label-val">
          <span>Grab distance</span>
          <span id="val-grab-dist" class="mono">${tuning.grabDistance.toFixed(2)}</span>
        </div>
        <input type="range" class="tuning-slider" id="slider-grab-dist" min="0.15" max="0.40" step="0.01" value="${tuning.grabDistance}" />
      </div>

      <!-- Release distance (0.30 to 0.60) -->
      <div class="tuning-row">
        <div class="tuning-row-label-val">
          <span>Release distance</span>
          <span id="val-release-dist" class="mono">${tuning.releaseDistance.toFixed(2)}</span>
        </div>
        <input type="range" class="tuning-slider" id="slider-release-dist" min="0.30" max="0.60" step="0.01" value="${tuning.releaseDistance}" />
      </div>

      <!-- Hold time (300 to 900 ms) -->
      <div class="tuning-row">
        <div class="tuning-row-label-val">
          <span>Hold time</span>
          <span id="val-hold-time" class="mono">${tuning.holdTimeMs} ms</span>
        </div>
        <input type="range" class="tuning-slider" id="slider-hold-time" min="300" max="900" step="50" value="${tuning.holdTimeMs}" />
      </div>

      <!-- Rest zone height (10 to 30 percent) -->
      <div class="tuning-row">
        <div class="tuning-row-label-val">
          <span>Rest zone height</span>
          <span id="val-rest-zone" class="mono">${Math.round(tuning.restZoneHeight * 100)}%</span>
        </div>
        <input type="range" class="tuning-slider" id="slider-rest-zone" min="10" max="30" step="1" value="${Math.round(tuning.restZoneHeight * 100)}" />
      </div>

      <!-- Tracking latency readout -->
      <div class="tuning-row" style="background: var(--color-surface-2); padding: var(--space-8); border-radius: var(--radius-control);">
        <div class="tuning-row-label-val">
          <span>Tracking latency</span>
          <span id="val-latency" class="mono" style="color: var(--color-text);">${Math.round(camera.latencyMs)} ms</span>
        </div>
        <div class="tuning-latency-note">Excludes camera delay.</div>
      </div>

      <!-- Reset tuning button -->
      <button id="btn-reset-tuning">Reset tuning</button>

      <!-- Finger debug view -->
      <div class="tuning-row">
        <span class="label-caps">Finger debug view</span>
        <div class="finger-debug-view" id="finger-debug-view">No hand detected</div>
      </div>
    `;
  }

  private attachEvents() {
    if (!this.element) return;

    this.element.querySelector('#btn-tuning-close')?.addEventListener('click', () => {
      appStore.setTuningPanel(false);
    });

    this.bindSlider('slider-sensitivity', 'val-sensitivity', (v) => {
      appStore.updateTuning({ sensitivity: v });
      return v.toFixed(2);
    });

    this.bindSlider('slider-smoothing', 'val-smoothing', (v) => {
      appStore.updateTuning({ smoothing: v });
      return v.toFixed(1);
    });

    this.bindSlider('slider-responsiveness', 'val-responsiveness', (v) => {
      appStore.updateTuning({ responsiveness: v });
      return v.toFixed(1);
    });

    this.bindSlider('slider-grab-dist', 'val-grab-dist', (v) => {
      appStore.updateTuning({ grabDistance: v });
      return v.toFixed(2);
    });

    this.bindSlider('slider-release-dist', 'val-release-dist', (v) => {
      appStore.updateTuning({ releaseDistance: v });
      return v.toFixed(2);
    });

    this.bindSlider('slider-hold-time', 'val-hold-time', (v) => {
      const ms = Math.round(v);
      appStore.updateTuning({ holdTimeMs: ms });
      return `${ms} ms`;
    });

    this.bindSlider('slider-rest-zone', 'val-rest-zone', (v) => {
      const pct = Math.round(v);
      appStore.updateTuning({ restZoneHeight: pct / 100 });
      return `${pct}%`;
    });

    this.element.querySelector('#btn-reset-tuning')?.addEventListener('click', () => {
      appStore.resetTuning();
      this.render();
      this.attachEvents();
    });
  }

  private bindSlider(sliderId: string, valId: string, updateFn: (val: number) => string) {
    if (!this.element) return;
    const slider = this.element.querySelector(`#${sliderId}`) as HTMLInputElement | null;
    const valEl = this.element.querySelector(`#${valId}`);
    if (slider && valEl) {
      slider.addEventListener('input', () => {
        const val = parseFloat(slider.value);
        valEl.textContent = updateFn(val);
      });
    }
  }

  private updateView() {
    if (!this.element) return;
    const { camera } = appStore.getState();
    const latEl = this.element.querySelector('#val-latency');
    if (latEl) {
      latEl.textContent = `${Math.round(camera.latencyMs)} ms`;
    }
  }

  updateFingerDebug(hands: TrackedHand[], videoWidth = 640, videoHeight = 360) {
    if (!this.element) return;
    const debugBox = this.element.querySelector('#finger-debug-view');
    if (!debugBox) return;

    if (hands.length === 0) {
      debugBox.textContent = 'No hands in frame';
      return;
    }

    let text = '';
    for (const hand of hands) {
      const lms = hand.rawLandmarks;
      if (lms.length < 21) continue;

      // Pixel coords
      const pts = lms.map((lm) => ({
        x: (1 - lm.x) * videoWidth, // mirrored
        y: lm.y * videoHeight
      }));

      const wrist = pts[0];
      const midBase = pts[9];
      const s = Math.hypot(wrist.x - midBase.x, wrist.y - midBase.y);

      const fingers = [
        { name: 'Index', base: pts[5], tip: pts[8] },
        { name: 'Middle', base: pts[9], tip: pts[12] },
        { name: 'Ring', base: pts[13], tip: pts[16] },
        { name: 'Pinky', base: pts[17], tip: pts[20] }
      ];

      const thumbTip = pts[4];

      text += `Hand ${hand.deckId} (s=${Math.round(s)}px):\n`;
      for (const f of fingers) {
        const distWristTip = Math.hypot(wrist.x - f.tip.x, wrist.y - f.tip.y);
        const distWristBase = Math.hypot(wrist.x - f.base.x, wrist.y - f.base.y);
        const r = distWristBase > 0 ? distWristTip / distWristBase : 0;
        const d = s > 0 ? Math.hypot(thumbTip.x - f.tip.x, thumbTip.y - f.tip.y) / s : 0;

        const state = r > 1.6 ? 'EXT' : r < 1.3 ? 'CURL' : 'MID';
        text += `  ${f.name.padEnd(6)}: r=${r.toFixed(2)} (${state}), d=${d.toFixed(2)}\n`;
      }
      text += '\n';
    }

    debugBox.textContent = text.trimEnd();
  }

  private startDebugLoop() {
    // Loop updates finger debug view when panel is visible
  }

  unmount(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
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
