import { CONTROL_CONFIG } from '../config.ts';
import { DeckId } from '../app/store.ts';

export type TriggerAction =
  | { type: 'play_pause'; deckId: DeckId }
  | { type: 'restart'; deckId: DeckId }
  | { type: 'cue'; deckId: DeckId }
  | { type: 'set_hotcue'; deckId: DeckId }
  | { type: 'jump_hotcue'; deckId: DeckId }
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
  private absentStartTime = 0;

  update(
    isPoseActive: boolean,
    action: TriggerAction,
    now: number,
    requiredHoldTimeMs = CONTROL_CONFIG.DEFAULT_TRIGGER_HOLD_MS
  ): { hasFired: boolean; action: TriggerAction | null; progress: number } {
    if (!isPoseActive) {
      if (this.isHolding) {
        this.isHolding = false;
        this.holdStartTime = 0;
      }
      // Require the pose to be absent for at least 300 ms before resetting the fired latch
      // This prevents single-frame tracking flutter from re-firing instant triggers
      if (this.absentStartTime === 0) {
        this.absentStartTime = now;
      } else if (now - this.absentStartTime >= 300) {
        this.fired = false;
        this.activeAction = null;
      }
      return { hasFired: false, action: null, progress: 0 };
    }

    // Pose is active
    if (this.absentStartTime > 0 && now - this.absentStartTime >= 300) {
      this.fired = false;
      this.activeAction = null;
    }
    this.absentStartTime = 0;

    // Check if the user transitioned to a different action type (e.g. play_pause -> restart, or set_hotcue)
    const isDifferentActionType = this.activeAction !== null && action.type !== this.activeAction.type;
    if (isDifferentActionType) {
      // Switching to a distinct gesture resets the latch and cooldown immediately
      this.fired = false;
      this.isHolding = false;
      this.cooldownUntilTime = 0;
      this.activeAction = null;
    }

    // Check cooldown: "require the pose to end and 800 ms to pass before the next trigger"
    if (now < this.cooldownUntilTime) {
      return { hasFired: false, action: null, progress: 0 };
    }

    if (!this.isHolding) {
      this.isHolding = true;
      this.holdStartTime = now;
      this.activeAction = action;
    }

    if (this.fired) {
      return { hasFired: false, action: null, progress: 1.0 };
    }

    const elapsed = now - this.holdStartTime;
    const progress = requiredHoldTimeMs === 0 ? 1.0 : Math.min(1.0, elapsed / requiredHoldTimeMs);

    if (requiredHoldTimeMs === 0 || elapsed >= requiredHoldTimeMs) {
      this.fired = true;
      this.cooldownUntilTime = now + (requiredHoldTimeMs === 0 ? 350 : CONTROL_CONFIG.TRIGGER_COOLDOWN_MS);
      return { hasFired: true, action: this.activeAction, progress: 1.0 };
    }

    return { hasFired: false, action: this.activeAction, progress };
  }

  reset() {
    this.isHolding = false;
    this.holdStartTime = 0;
    this.fired = false;
    this.activeAction = null;
    this.absentStartTime = 0;
  }
}
