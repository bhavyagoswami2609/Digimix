import { appStore, DeckId } from '../app/store.ts';
import { AUDIO_CONFIG, CONTROL_CONFIG } from '../config.ts';
import { DebouncedPoseDetector, DetectedPoseName } from '../vision/pose.ts';
import { TrackedHand } from '../vision/tracker-client.ts';
import { GrabController, ControlledTarget } from './grab.ts';
import { TriggerDetector } from './triggers.ts';
import { eqCurve, tempoCurve } from '../audio/curves.ts';

export interface HandGestureVisualState {
  handId: number;
  deckId: DeckId;
  wristScreenX: number;
  wristScreenY: number;
  poseName: string | null;
  valueChipText: string | null;
  triggerProgress: number; // 0 to 1 for progress ring
  engagedFingertip?: number; // 8, 12, 16, 20
}

export class GestureController {
  private handDetectors: Map<number, DebouncedPoseDetector> = new Map();
  private handGrabs: Map<number, GrabController> = new Map();
  private handTriggers: Map<number, TriggerDetector> = new Map();

  // Active control arbitration: controlKey -> handId
  private activeArbitrations: Map<string, number> = new Map();

  // Help gesture tracking
  private helpHoldStartTime = 0;
  private isHoldingHelp = false;
  private helpProgress = 0;

  // Active visual chips
  private visualStates: HandGestureVisualState[] = [];

  processFrame(
    hands: TrackedHand[],
    now: number,
    videoWidth = 640,
    videoHeight = 360,
    stageWidth = 1440,
    stageHeight = 800
  ): HandGestureVisualState[] {
    const state = appStore.getState();
    const tuning = state.tuning;
    this.visualStates = [];

    // Check help gesture first (both hands open, upper 60% of frame, held 1200ms)
    this.processHelpGesture(hands, now, tuning.holdTimeMs);

    // Clean up detectors for hands that disappeared
    const presentHandIds = new Set(hands.map((h) => h.id));
    for (const handId of this.handDetectors.keys()) {
      if (!presentHandIds.has(handId)) {
        this.releaseHand(handId);
      }
    }

    for (const hand of hands) {
      // 1. Rest zone check:
      // "Any hand whose palm centre y is in the bottom 18 percent of the frame is ignored and releases anything it held."
      if (hand.isInRestZone) {
        this.releaseHand(hand.id);
        continue;
      }

      let detector = this.handDetectors.get(hand.id);
      if (!detector) {
        detector = new DebouncedPoseDetector();
        this.handDetectors.set(hand.id, detector);
      }

      let grabCtrl = this.handGrabs.get(hand.id);
      if (!grabCtrl) {
        grabCtrl = new GrabController();
        this.handGrabs.set(hand.id, grabCtrl);
      }

      let trigger = this.handTriggers.get(hand.id);
      if (!trigger) {
        trigger = new TriggerDetector();
        this.handTriggers.set(hand.id, trigger);
      }

      // Determine active pinch if already grabbing
      let currentPinch: 'pinch_index' | 'pinch_middle' | 'pinch_ring' | 'pinch_pinky' | null = null;
      const activeGrab = grabCtrl.getActiveGrab();
      if (activeGrab && activeGrab.target.type === 'deck') {
        const c = activeGrab.target.control;
        if (c === 'volume') currentPinch = 'pinch_index';
        else if (c === 'bass') currentPinch = 'pinch_middle';
        else if (c === 'mid') currentPinch = 'pinch_ring';
        else if (c === 'treble') currentPinch = 'pinch_pinky';
      }

      // Update debounced pose
      const pose = detector.update(hand.rawLandmarks, currentPinch, videoWidth, videoHeight);

      // Process gesture
      const visual = this.handleHandPose(
        hand,
        pose,
        grabCtrl,
        trigger,
        now,
        tuning.sensitivity,
        tuning.holdTimeMs,
        videoWidth,
        videoHeight,
        stageWidth,
        stageHeight
      );

      if (visual) {
        this.visualStates.push(visual);
      }
    }

    return this.visualStates;
  }

  private handleHandPose(
    hand: TrackedHand,
    pose: DetectedPoseName,
    grabCtrl: GrabController,
    trigger: TriggerDetector,
    now: number,
    sensitivity: number,
    holdTimeMs: number,
    videoWidth: number,
    videoHeight: number,
    stageWidth: number,
    stageHeight: number
  ): HandGestureVisualState | null {
    const deckId = hand.deckId;
    const target = this.getTargetForPose(pose, deckId);

    // Compute wrist screen position for pose chip
    const wristRaw = hand.rawLandmarks[0];
    const mirroredWristX = 1 - wristRaw.x;
    const containerAspect = stageWidth / stageHeight;
    const videoAspect = videoWidth / videoHeight;
    let rw = stageWidth;
    let rh = stageHeight;
    let ox = 0;
    let oy = 0;
    if (containerAspect > videoAspect) {
      rh = stageWidth / videoAspect;
      oy = (stageHeight - rh) / 2;
    } else {
      rw = stageHeight * videoAspect;
      ox = (stageWidth - rw) / 2;
    }
    const wristScreenX = mirroredWristX * rw + ox;
    const wristScreenY = wristRaw.y * rh + oy;

    let poseNameLabel: string | null = null;
    let valueChipText: string | null = null;
    let triggerProgress = 0;
    let engagedFingertip: number | undefined;

    // A. Grabbing poses (Pinch, Peace, Point)
    if (target) {
      const targetKey = target.type === 'crossfader' ? 'crossfader' : `${target.deckId}_${target.control}`;
      const existingGrab = grabCtrl.getActiveGrab();

      // Arbitration check:
      const currentHolder = this.activeArbitrations.get(targetKey);
      if (currentHolder !== undefined && currentHolder !== hand.id) {
        // Ignored until first releases
        return null;
      }

      if (!existingGrab) {
        // Start new grab
        const currentU = this.getCurrentTargetU(target);
        grabCtrl.startGrab(target, currentU, hand.smoothedPalmCenter.x, hand.smoothedPalmCenter.y, now);
        this.activeArbitrations.set(targetKey, hand.id);
        if (target.type === 'crossfader') {
          appStore.setActiveCrossfader(true);
        } else {
          appStore.setActiveControl(target.deckId, target.control);
        }
      }

      // Update grab
      const otherDeckId = deckId === 'A' ? 'B' : 'A';
      const otherState = appStore.getState().decks[otherDeckId];
      const thisState = appStore.getState().decks[deckId];

      const updateRes = grabCtrl.updateGrab(
        hand.smoothedPalmCenter.x,
        hand.smoothedPalmCenter.y,
        now,
        sensitivity,
        otherState.baseBpm,
        thisState.baseBpm
      );

      if (updateRes && updateRes.hasValueChange) {
        if (target.type === 'crossfader') {
          appStore.setCrossfader(updateRes.newU);
        } else {
          appStore.setDeckControl(target.deckId, target.control, updateRes.newU);
        }

        // Format live value chip
        valueChipText = this.formatValueChip(target, updateRes.newU);
      }

      // Set pose name label & engaged fingertip
      if (target.type === 'crossfader') {
        poseNameLabel = 'Crossfader';
        engagedFingertip = 8;
      } else {
        const c = target.control;
        if (c === 'volume') { poseNameLabel = 'Volume'; engagedFingertip = 8; }
        else if (c === 'bass') { poseNameLabel = 'Bass'; engagedFingertip = 12; }
        else if (c === 'mid') { poseNameLabel = 'Mid'; engagedFingertip = 16; }
        else if (c === 'treble') { poseNameLabel = 'Treble'; engagedFingertip = 20; }
        else if (c === 'tempo') {
          poseNameLabel = updateRes?.chipLabel === 'Matched' ? 'Matched' : 'Tempo';
          engagedFingertip = 12;
        }
      }
    } else {
      // Not a grab pose currently
      if (grabCtrl.getActiveGrab()) {
        const endRes = grabCtrl.endGrab(now);
        if (endRes) {
          const targetKey = endRes.target.type === 'crossfader' ? 'crossfader' : `${endRes.target.deckId}_${endRes.target.control}`;
          this.activeArbitrations.delete(targetKey);
          if (endRes.target.type === 'crossfader') {
            appStore.setActiveCrossfader(false);
          } else {
            appStore.setActiveControl(endRes.target.deckId, null);
          }

          if (endRes.isReset) {
            // Animate to default over 250ms
            this.animateReset(endRes.target);
            poseNameLabel = 'Reset';
          }
        }
      }
    }

    // B. Triggers (Thumbs up & Fist)
    if (pose === 'thumbs_up') {
      poseNameLabel = appStore.getState().decks[deckId].isPlaying ? 'Pause' : 'Play';
      const trRes = trigger.update(true, { type: 'play_pause', deckId }, now, holdTimeMs);
      triggerProgress = trRes.progress;
      if (trRes.hasFired) {
        const isPlaying = appStore.getState().decks[deckId].isPlaying;
        appStore.setTransportPlaying(deckId, !isPlaying);
      }
    } else if (pose === 'fist') {
      poseNameLabel = 'Cue';
      const trRes = trigger.update(true, { type: 'cue', deckId }, now, holdTimeMs);
      triggerProgress = trRes.progress;
      if (trRes.hasFired) {
        appStore.triggerCue(deckId);
      }
    } else {
      // Neither trigger pose
      trigger.update(false, { type: 'cue', deckId }, now, holdTimeMs);
    }

    if (!poseNameLabel && pose === 'open') {
      poseNameLabel = null;
    }

    if (!poseNameLabel && !valueChipText) {
      return null;
    }

    return {
      handId: hand.id,
      deckId,
      wristScreenX,
      wristScreenY,
      poseName: poseNameLabel,
      valueChipText,
      triggerProgress,
      engagedFingertip
    };
  }

  private getTargetForPose(pose: DetectedPoseName, deckId: DeckId): ControlledTarget | null {
    if (pose === 'pinch_index') return { type: 'deck', deckId, control: 'volume' };
    if (pose === 'pinch_middle') return { type: 'deck', deckId, control: 'bass' };
    if (pose === 'pinch_ring') return { type: 'deck', deckId, control: 'mid' };
    if (pose === 'pinch_pinky') return { type: 'deck', deckId, control: 'treble' };
    if (pose === 'peace') return { type: 'deck', deckId, control: 'tempo' };
    if (pose === 'point') return { type: 'crossfader' };
    return null;
  }

  private getCurrentTargetU(target: ControlledTarget): number {
    const state = appStore.getState();
    if (target.type === 'crossfader') {
      return state.crossfader;
    }
    return state.decks[target.deckId][target.control];
  }

  private formatValueChip(target: ControlledTarget, u: number): string {
    if (target.type === 'crossfader') {
      const pct = Math.round(u * 100);
      return `${pct}`;
    }
    const c = target.control;
    if (c === 'volume') {
      return `Vol ${Math.round(u * 100)}`;
    }
    if (c === 'tempo') {
      const { displayStr } = tempoCurve(u);
      return `Tempo ${displayStr}`;
    }
    const eqName = c.charAt(0).toUpperCase() + c.slice(1);
    const { displayStr } = eqCurve(u);
    return `${eqName} ${displayStr}`;
  }

  private animateReset(target: ControlledTarget) {
    const startU = this.getCurrentTargetU(target);
    const targetU = target.type === 'deck' && target.control === 'volume'
      ? AUDIO_CONFIG.DEFAULT_U.VOLUME
      : 0.5;

    const startTime = performance.now();
    const duration = CONTROL_CONFIG.RESET_ANIMATION_MS; // 250ms

    const anim = (t: number) => {
      const elapsed = t - startTime;
      const p = Math.min(1.0, elapsed / duration);
      // easeOutQuad
      const eased = 1 - (1 - p) * (1 - p);
      const current = startU + (targetU - startU) * eased;

      if (target.type === 'crossfader') {
        appStore.setCrossfader(current);
      } else {
        appStore.setDeckControl(target.deckId, target.control, current);
      }

      if (p < 1.0) {
        requestAnimationFrame(anim);
      }
    };
    requestAnimationFrame(anim);
  }

  private processHelpGesture(hands: TrackedHand[], now: number, _holdTimeMs: number) {
    // "Help gesture. Both hands open, both palm centres in the upper 60 percent of the frame (y below 0.6, counted from the top), held for 1200 ms, toggles the gestures overlay. Disabled while any control is engaged."
    if (this.activeArbitrations.size > 0 || hands.length < 2) {
      this.isHoldingHelp = false;
      this.helpHoldStartTime = 0;
      this.helpProgress = 0;
      return;
    }

    const hand1 = hands[0];
    const hand2 = hands[1];
    const isBothInUpper60 = hand1.smoothedPalmCenter.y < CONTROL_CONFIG.HELP_GESTURE_MAX_Y &&
                           hand2.smoothedPalmCenter.y < CONTROL_CONFIG.HELP_GESTURE_MAX_Y;

    const detector1 = this.handDetectors.get(hand1.id);
    const detector2 = this.handDetectors.get(hand2.id);
    const isBothOpen = detector1?.getActivePose() === 'open' && detector2?.getActivePose() === 'open';

    if (isBothInUpper60 && isBothOpen) {
      if (!this.isHoldingHelp) {
        this.isHoldingHelp = true;
        this.helpHoldStartTime = now;
      }
      const elapsed = now - this.helpHoldStartTime;
      this.helpProgress = Math.min(1.0, elapsed / CONTROL_CONFIG.HELP_GESTURE_HOLD_MS);

      if (elapsed >= CONTROL_CONFIG.HELP_GESTURE_HOLD_MS) {
        appStore.toggleGesturesOverlay();
        this.isHoldingHelp = false;
        this.helpHoldStartTime = 0;
        this.helpProgress = 0;
      }
    } else {
      this.isHoldingHelp = false;
      this.helpHoldStartTime = 0;
      this.helpProgress = 0;
    }
  }

  private releaseHand(handId: number) {
    this.handDetectors.delete(handId);
    this.handTriggers.delete(handId);
    const grab = this.handGrabs.get(handId);
    if (grab) {
      const active = grab.getActiveGrab();
      if (active) {
        const targetKey = active.target.type === 'crossfader' ? 'crossfader' : `${active.target.deckId}_${active.target.control}`;
        this.activeArbitrations.delete(targetKey);
        if (active.target.type === 'crossfader') {
          appStore.setActiveCrossfader(false);
        } else {
          appStore.setActiveControl(active.target.deckId, null);
        }
      }
      this.handGrabs.delete(handId);
    }
  }

  getHelpProgress(): number {
    return this.helpProgress;
  }
}

export const gestureController = new GestureController();
