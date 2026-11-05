import { CONTROL_CONFIG } from '../config.ts';
import { DeckId } from '../app/store.ts';

export type TriggerAction =
  | { type: 'play_pause'; deckId: DeckId }
  | { type: 'cue'; deckId: DeckId }
  | { type: 'help_toggle' };

export interface TriggerState {
  isHolding: boolean;
  holdProgress: number; // 0 to 1
  action: TriggerAction | null;
  fired: boolean;
}

export class TriggerDetector {
  private holdStartTime = 0;
  private isHolding = false;
  private fired = false;
  private cooldownUntilTime = 0;
  private activeAction: TriggerAction | null = null;

  update(
    isPoseActive: boolean,
    action: TriggerAction,
    now: number,
    requiredHoldTimeMs = CONTROL_CONFIG.DEFAULT_TRIGGER_HOLD_MS
  ): { hasFired: boolean; action: TriggerAction | null; progress: number } {
    // Check cooldown: "require the pose to end and 800 ms to pass before the next trigger"
    if (now < this.cooldownUntilTime) {
      return { hasFired: false, action: null, progress: 0 };
    }

    if (!isPoseActive) {
      if (this.isHolding) {
        this.isHolding = false;
        this.holdStartTime = 0;
      }
      this.fired = false;
      return { hasFired: false, action: null, progress: 0 };
    }

    // Pose is active
    if (!this.isHolding) {
      this.isHolding = true;
      this.holdStartTime = now;
      this.activeAction = action;
      this.fired = false;
    }

    if (this.fired) {
      return { hasFired: false, action: null, progress: 1.0 };
    }

    const elapsed = now - this.holdStartTime;
    const progress = Math.min(1.0, elapsed / requiredHoldTimeMs);

    if (elapsed >= requiredHoldTimeMs) {
      this.fired = true;
      this.cooldownUntilTime = now + CONTROL_CONFIG.TRIGGER_COOLDOWN_MS;
      return { hasFired: true, action: this.activeAction, progress: 1.0 };
    }

    return { hasFired: false, action: this.activeAction, progress };
  }

  reset() {
    this.isHolding = false;
    this.holdStartTime = 0;
    this.fired = false;
    this.activeAction = null;
  }
}
