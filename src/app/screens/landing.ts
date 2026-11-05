import { appStore } from '../store.ts';
import { ScreenComponent } from '../router.ts';

export class LandingScreen implements ScreenComponent {
  private element: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private animId: number | null = null;

  mount(container: HTMLElement): void {
    this.element = document.createElement('div');
    this.element.className = 'screen screen-landing';

    this.element.innerHTML = `
      <div class="landing-grid">
        <div class="landing-content">
          <h1 class="landing-headline">Mix with your hands.</h1>
          <p class="landing-body">Two decks, a crossfader and a three band EQ, played through your webcam. It runs in this tab. Your music and your video stay on your computer.</p>
          <div class="landing-actions">
            <button class="primary" id="btn-landing-start">Start</button>
            <button class="text-link" id="btn-landing-how">How it works</button>
          </div>
          <div class="landing-footnote">Needs a webcam and a desktop browser.</div>
        </div>
      </div>
      <canvas class="landing-waveforms" id="landing-waveforms"></canvas>
    `;

    container.appendChild(this.element);

    const btnStart = this.element.querySelector('#btn-landing-start') as HTMLButtonElement;
    const btnHow = this.element.querySelector('#btn-landing-how') as HTMLButtonElement;

    btnStart.addEventListener('click', () => {
      const state = appStore.getState();
      if (state.guideSeen) {
        appStore.setScreen('setup');
      } else {
        appStore.setGuideStep(0);
        appStore.setScreen('guide');
      }
    });

    btnHow.addEventListener('click', () => {
      appStore.setGuideStep(0);
      appStore.setScreen('guide');
    });

    this.canvas = this.element.querySelector('#landing-waveforms') as HTMLCanvasElement;
    this.initWaveformCanvas();
  }

  private initWaveformCanvas() {
    if (!this.canvas) return;
    const canvas = this.canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let offset = 0;
    let lastTime = performance.now();

    const resize = () => {
      if (!canvas) return;
      canvas.width = canvas.parentElement?.clientWidth || window.innerWidth;
      canvas.height = 48;
    };
    resize();
    window.addEventListener('resize', resize);

    const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const render = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      if (!isReduced) {
        offset += dt * 20; // 20 px/sec
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const w = canvas.width;
      const h = canvas.height;
      const midA = h * 0.35;
      const midB = h * 0.70;

      // Deck A line (1.5px, #E8793A)
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#E8793A';
      ctx.beginPath();
      for (let x = 0; x <= w; x += 3) {
        const t = (x + offset) * 0.02;
        const y = midA + Math.sin(t) * 8 + Math.cos(t * 2.3) * 4;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Deck B line (1.5px, #4FA3D1)
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#4FA3D1';
      ctx.beginPath();
      for (let x = 0; x <= w; x += 3) {
        const t = (x - offset * 0.8) * 0.025;
        const y = midB + Math.sin(t * 1.5) * 7 + Math.sin(t * 0.7) * 5;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      if (!isReduced) {
        this.animId = requestAnimationFrame(render);
      }
    };

    if (isReduced) {
      render(performance.now());
    } else {
      this.animId = requestAnimationFrame(render);
    }
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
    this.canvas = null;
  }
}
