import { HandGestureVisualState } from '../gesture/controller.ts';

export class PoseChipRenderer {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  render(visuals: HandGestureVisualState[], helpProgress = 0, screenWidth = 1440, screenHeight = 800) {
    let html = '';

    // 1. Hand wrist pose chips
    for (const v of visuals) {
      if (!v.poseName && !v.valueChipText) continue;

      const progressSvg = v.triggerProgress > 0 ? `
        <svg style="position: absolute; inset: -4px; width: calc(100% + 8px); height: calc(100% + 8px); pointer-events: none;">
          <circle cx="50%" cy="50%" r="45%" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="2" />
          <circle cx="50%" cy="50%" r="45%" fill="none" stroke="var(--color-deck-${v.deckId.toLowerCase()})" stroke-width="2"
            stroke-dasharray="100" stroke-dashoffset="${(1 - v.triggerProgress) * 100}" stroke-linecap="round" />
        </svg>
      ` : '';

      html += `
        <div class="pose-chip-container" style="left: ${Math.round(v.wristScreenX)}px; top: ${Math.round(v.wristScreenY)}px;">
          ${v.poseName ? `<div class="pose-chip" style="position: relative;">${v.poseName}${progressSvg}</div>` : ''}
          ${v.valueChipText ? `<div class="value-chip">${v.valueChipText}</div>` : ''}
        </div>
      `;
    }

    // 2. Help gesture progress ring between hands
    if (helpProgress > 0) {
      const centerX = screenWidth / 2;
      const centerY = screenHeight * 0.35;
      const r = 24;
      const circ = 2 * Math.PI * r;
      const dashoffset = (1 - helpProgress) * circ;

      html += `
        <div style="position: absolute; left: ${centerX}px; top: ${centerY}px; transform: translate(-50%, -50%); z-index: 25; pointer-events: none; display: flex; flex-direction: column; align-items: center; gap: 4px;">
          <svg width="60" height="60" viewBox="0 0 60 60">
            <circle cx="30" cy="30" r="${r}" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="3" />
            <circle cx="30" cy="30" r="${r}" fill="none" stroke="var(--color-text)" stroke-width="3"
              stroke-dasharray="${circ}" stroke-dashoffset="${dashoffset}" stroke-linecap="round" />
          </svg>
          <span class="label-caps" style="background: var(--color-surface-1); padding: 2px 6px; border-radius: 2px;">Gestures</span>
        </div>
      `;
    }

    this.container.innerHTML = html;
  }

  clear() {
    this.container.innerHTML = '';
  }
}
