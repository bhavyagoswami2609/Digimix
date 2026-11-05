import { CONTROL_CONFIG, AUDIO_CONFIG } from '../config.ts';
import { DeckControl, DeckId } from '../app/store.ts';

export type ControlledTarget =
  | { type: 'deck'; deckId: DeckId; control: DeckControl }
  | { type: 'crossfader' };

export interface GrabState {
  target: ControlledTarget;
  startTime: number;
  isArmed: boolean;
  armedTime: number;
  anchorPalmX: number;
  anchorPalmY: number;
  anchorU: number;
  startPalmX: number;
  startPalmY: number;
  maxMovement: number;

  // Tempo match detent tracking
  isTempoMatchedSnapped: boolean;
  tempoSnapAnchorY: number;
}

export interface GrabUpdateResult {
  hasValueChange: boolean;
  newU: number;
  chipLabel?: 'Matched' | 'Reset' | null;
  target: ControlledTarget;
}

export class GrabController {
  private activeGrab: GrabState | null = null;
  private lastTapTargetKey: string | null = null;
  private lastTapEndTime = 0;

  startGrab(
    target: ControlledTarget,
    currentU: number,
    palmX: number,
    palmY: number,
    now: number
  ) {
    this.activeGrab = {
      target,
      startTime: now,
      isArmed: false,
      armedTime: 0,
      anchorPalmX: palmX,
      anchorPalmY: palmY,
      anchorU: currentU,
      startPalmX: palmX,
      startPalmY: palmY,
      maxMovement: 0,
      isTempoMatchedSnapped: false,
      tempoSnapAnchorY: palmY
    };
  }

  updateGrab(
    palmX: number,
    palmY: number,
    now: number,
    sensitivity = 1.0,
    otherDeckDisplayedBpm: number | null = null,
    thisDeckBaseBpm: number | null = null
  ): GrabUpdateResult | null {
    if (!this.activeGrab) return null;
    const grab = this.activeGrab;

    // Track total movement from start
    const distFromStart = Math.hypot(palmX - grab.startPalmX, palmY - grab.startPalmY);
    if (distFromStart > grab.maxMovement) {
      grab.maxMovement = distFromStart;
    }

    // 1. Arming period (120ms): nothing changes
    if (!grab.isArmed) {
      if (now - grab.startTime >= CONTROL_CONFIG.ARMING_PERIOD_MS) {
        grab.isArmed = true;
        grab.armedTime = now;
        grab.anchorPalmX = palmX;
        grab.anchorPalmY = palmY;
      }
      return null;
    }

    // 2. Relative movement calculation
    let travel: number;
    let delta: number;

    if (grab.target.type === 'crossfader') {
      travel = CONTROL_CONFIG.TRAVEL.CROSSFADER; // 0.40
      // Right moves toward deck B (mirrored x is positive to the right)
      delta = (palmX - grab.anchorPalmX) * sensitivity;
    } else if (grab.target.control === 'tempo') {
      travel = CONTROL_CONFIG.TRAVEL.TEMPO; // 1.40
      // Up is positive (lower Y in normalized frame coords)
      delta = (grab.anchorPalmY - palmY) * sensitivity;
    } else {
      travel = CONTROL_CONFIG.TRAVEL.VOLUME_EQ; // 0.35
      delta = (grab.anchorPalmY - palmY) * sensitivity;
    }

    let calculatedU = grab.anchorU + delta / travel;
    calculatedU = Math.max(0, Math.min(1, calculatedU));

    // 3. Detents
    // Default detent: if u is within 0.02 of its default, snap to default
    let defaultU = 0.5;
    if (grab.target.type === 'deck' && grab.target.control === 'volume') {
      defaultU = AUDIO_CONFIG.DEFAULT_U.VOLUME; // 0.75
    }

    if (Math.abs(calculatedU - defaultU) <= CONTROL_CONFIG.SNAP_DETENT_U) {
      calculatedU = defaultU;
    }

    // Tempo beat matching detent:
    let chipLabel: 'Matched' | 'Reset' | null = null;
    if (
      grab.target.type === 'deck' &&
      grab.target.control === 'tempo' &&
      otherDeckDisplayedBpm !== null &&
      thisDeckBaseBpm !== null &&
      otherDeckDisplayedBpm > 0 &&
      thisDeckBaseBpm > 0
    ) {
      const p = (calculatedU - 0.5) * 32;
      const thisDispBpm = thisDeckBaseBpm * (1 + p / 100);

      if (grab.isTempoMatchedSnapped) {
        // Hold until hand moved more than 0.02 from snap point
        const moveFromSnap = Math.abs(palmY - grab.tempoSnapAnchorY);
        if (moveFromSnap > CONTROL_CONFIG.TEMPO_SNAP_EXIT_DISTANCE) {
          grab.isTempoMatchedSnapped = false;
        } else {
          // Keep snapped to match
          chipLabel = 'Matched';
          const matchP = (otherDeckDisplayedBpm / thisDeckBaseBpm - 1) * 100;
          calculatedU = Math.max(0, Math.min(1, matchP / 32 + 0.5));
        }
      } else {
        if (Math.abs(thisDispBpm - otherDeckDisplayedBpm) <= CONTROL_CONFIG.TEMPO_SNAP_BPM_DIFF) {
          grab.isTempoMatchedSnapped = true;
          grab.tempoSnapAnchorY = palmY;
          chipLabel = 'Matched';
          const matchP = (otherDeckDisplayedBpm / thisDeckBaseBpm - 1) * 100;
          calculatedU = Math.max(0, Math.min(1, matchP / 32 + 0.5));
        }
      }
    }

    return {
      hasValueChange: true,
      newU: calculatedU,
      chipLabel,
      target: grab.target
    };
  }

  endGrab(now: number): { isReset: boolean; target: ControlledTarget } | null {
    if (!this.activeGrab) return null;
    const grab = this.activeGrab;
    const duration = now - grab.startTime;
    this.activeGrab = null;

    // Tap detection: lasts < 350 ms with movement < 0.03
    const isTap =
      duration < CONTROL_CONFIG.TAP_MAX_TIME_MS &&
      grab.maxMovement < CONTROL_CONFIG.TAP_MAX_MOVE;

    const targetKey =
      grab.target.type === 'crossfader'
        ? 'crossfader'
        : `${grab.target.deckId}_${grab.target.control}`;

    let isReset = false;
    if (isTap) {
      if (
        this.lastTapTargetKey === targetKey &&
        now - this.lastTapEndTime <= CONTROL_CONFIG.DOUBLE_TAP_MAX_GAP_MS
      ) {
        // Double tap confirmed! Reset to default
        isReset = true;
        this.lastTapTargetKey = null;
        this.lastTapEndTime = 0;
      } else {
        this.lastTapTargetKey = targetKey;
        this.lastTapEndTime = now;
      }
    } else {
      this.lastTapTargetKey = null;
      this.lastTapEndTime = 0;
    }

    return {
      isReset,
      target: grab.target
    };
  }

  getActiveGrab(): GrabState | null {
    return this.activeGrab;
  }

  release() {
    this.activeGrab = null;
  }
}
