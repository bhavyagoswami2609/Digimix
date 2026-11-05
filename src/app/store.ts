import { AUDIO_CONFIG, CONTROL_CONFIG, POSE_CONFIG, VISION_CONFIG } from '../config.ts';

export type ScreenId = 'landing' | 'guide' | 'setup' | 'stage';
export type DeckId = 'A' | 'B';
export type DeckControl = 'volume' | 'bass' | 'mid' | 'treble' | 'tempo';

export interface DeckState {
  volume: number; // u in [0, 1]
  bass: number;   // u in [0, 1]
  mid: number;    // u in [0, 1]
  treble: number; // u in [0, 1]
  tempo: number;  // u in [0, 1]
  activeControl: DeckControl | null;
  isPlaying: boolean;
  isCueing: boolean;
  isNudgingSlower: boolean;
  isNudgingFaster: boolean;
  file: {
    name: string;
    durationSec: number;
    buffer: AudioBuffer | null;
  } | null;
  baseBpm: number | null;
  firstBeatOffsetSec: number;
  isAnalyzingBpm: boolean;
  bpmDetectionFailed: boolean;
  currentPositionSec: number;
}

export interface AppState {
  currentScreen: ScreenId;
  guideStep: number;
  guideSeen: boolean;
  decks: {
    A: DeckState;
    B: DeckState;
  };
  crossfader: number; // u in [0, 1]
  activeCrossfader: boolean;
  isMuted: boolean;
  recording: {
    isRecording: boolean;
    durationSec: number;
    includeVideo: boolean;
    recordedBlob: Blob | null;
    recordedMimeType: string | null;
    isSupported: boolean;
  };
  camera: {
    permission: 'prompt' | 'granted' | 'denied' | 'not-found' | 'mouse-only';
    isStreamActive: boolean;
    fps: number;
    trackingStatus: 'starting' | 'active' | 'lost' | 'failed' | 'disabled';
    latencyMs: number;
  };
  overlays: {
    showGestures: boolean;
    showTuning: boolean;
  };
  tuning: {
    sensitivity: number;
    smoothing: number; // minCutoff
    responsiveness: number; // beta
    grabDistance: number;
    releaseDistance: number;
    holdTimeMs: number;
    restZoneHeight: number;
  };
  systemMessage: string | null;
}

const STORAGE_KEY_GUIDE_SEEN = 'deckhand_guide_seen';
const STORAGE_KEY_TUNING = 'deckhand_tuning_v1';

function loadSavedTuning() {
  const defaults = {
    sensitivity: CONTROL_CONFIG.DEFAULT_SENSITIVITY,
    smoothing: VISION_CONFIG.ONE_EURO_DEFAULTS.MIN_CUTOFF,
    responsiveness: VISION_CONFIG.ONE_EURO_DEFAULTS.BETA,
    grabDistance: POSE_CONFIG.PINCH_ENGAGE_DISTANCE,
    releaseDistance: POSE_CONFIG.PINCH_RELEASE_DISTANCE,
    holdTimeMs: CONTROL_CONFIG.DEFAULT_TRIGGER_HOLD_MS,
    restZoneHeight: CONTROL_CONFIG.DEFAULT_REST_ZONE_HEIGHT
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TUNING);
    if (raw) {
      return { ...defaults, ...JSON.parse(raw) };
    }
  } catch {
    // ignore
  }
  return defaults;
}

function createInitialDeck(): DeckState {
  return {
    volume: AUDIO_CONFIG.DEFAULT_U.VOLUME,
    bass: AUDIO_CONFIG.DEFAULT_U.BASS,
    mid: AUDIO_CONFIG.DEFAULT_U.MID,
    treble: AUDIO_CONFIG.DEFAULT_U.TREBLE,
    tempo: AUDIO_CONFIG.DEFAULT_U.TEMPO,
    activeControl: null,
    isPlaying: false,
    isCueing: false,
    isNudgingSlower: false,
    isNudgingFaster: false,
    file: null,
    baseBpm: null,
    firstBeatOffsetSec: 0,
    isAnalyzingBpm: false,
    bpmDetectionFailed: false,
    currentPositionSec: 0
  };
}

export const initialState: AppState = {
  currentScreen: 'landing',
  guideStep: 0,
  guideSeen: typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY_GUIDE_SEEN) === 'true' : false,
  decks: {
    A: createInitialDeck(),
    B: createInitialDeck()
  },
  crossfader: AUDIO_CONFIG.DEFAULT_U.CROSSFADER,
  activeCrossfader: false,
  isMuted: false,
  recording: {
    isRecording: false,
    durationSec: 0,
    includeVideo: false,
    recordedBlob: null,
    recordedMimeType: null,
    isSupported: typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined'
  },
  camera: {
    permission: 'prompt',
    isStreamActive: false,
    fps: 0,
    trackingStatus: 'starting',
    latencyMs: 0
  },
  overlays: {
    showGestures: false,
    showTuning: false
  },
  tuning: loadSavedTuning(),
  systemMessage: null
};

type Listener = (state: AppState) => void;

class Store {
  private state: AppState = { ...initialState };
  private listeners: Set<Listener> = new Set();

  getState(): AppState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  // --- Screen State Machine ---
  setScreen(screen: ScreenId) {
    if (this.state.currentScreen === screen) return;
    this.state = {
      ...this.state,
      currentScreen: screen
    };
    this.notify();
  }

  setGuideStep(step: number) {
    this.state = {
      ...this.state,
      guideStep: Math.max(0, Math.min(3, step))
    };
    this.notify();
  }

  markGuideSeen() {
    try {
      localStorage.setItem(STORAGE_KEY_GUIDE_SEEN, 'true');
    } catch {
      // ignore
    }
    this.state = {
      ...this.state,
      guideSeen: true
    };
    this.notify();
  }

  // --- Deck Setters ---
  setDeckControl(deckId: DeckId, control: DeckControl, valueU: number) {
    const clamped = Math.max(0, Math.min(1, valueU));
    const deck = this.state.decks[deckId];
    if (deck[control] === clamped) return;

    this.state = {
      ...this.state,
      decks: {
        ...this.state.decks,
        [deckId]: {
          ...deck,
          [control]: clamped
        }
      }
    };
    this.notify();
  }

  setActiveControl(deckId: DeckId, control: DeckControl | null) {
    const deck = this.state.decks[deckId];
    if (deck.activeControl === control) return;
    this.state = {
      ...this.state,
      decks: {
        ...this.state.decks,
        [deckId]: {
          ...deck,
          activeControl: control
        }
      }
    };
    this.notify();
  }

  setTransportPlaying(deckId: DeckId, isPlaying: boolean) {
    const deck = this.state.decks[deckId];
    if (deck.isPlaying === isPlaying) return;
    this.state = {
      ...this.state,
      decks: {
        ...this.state.decks,
        [deckId]: {
          ...deck,
          isPlaying
        }
      }
    };
    this.notify();
  }

  triggerCue(deckId: DeckId) {
    const deck = this.state.decks[deckId];
    this.state = {
      ...this.state,
      decks: {
        ...this.state.decks,
        [deckId]: {
          ...deck,
          isPlaying: false,
          isCueing: true
        }
      }
    };
    this.notify();
    // Reset cueing pulse flag after 100ms
    setTimeout(() => {
      this.state = {
        ...this.state,
        decks: {
          ...this.state.decks,
          [deckId]: {
            ...this.state.decks[deckId],
            isCueing: false
          }
        }
      };
      this.notify();
    }, 100);
  }

  setDeckFile(deckId: DeckId, file: { name: string; durationSec: number; buffer: AudioBuffer | null } | null) {
    const deck = this.state.decks[deckId];
    this.state = {
      ...this.state,
      decks: {
        ...this.state.decks,
        [deckId]: {
          ...deck,
          file,
          baseBpm: null,
          bpmDetectionFailed: false,
          isAnalyzingBpm: false,
          currentPositionSec: 0
        }
      }
    };
    this.notify();
  }

  setBpmAnalysisState(deckId: DeckId, isAnalyzing: boolean, failed = false) {
    const deck = this.state.decks[deckId];
    this.state = {
      ...this.state,
      decks: {
        ...this.state.decks,
        [deckId]: {
          ...deck,
          isAnalyzingBpm: isAnalyzing,
          bpmDetectionFailed: failed
        }
      }
    };
    this.notify();
  }

  setDeckBpm(deckId: DeckId, baseBpm: number | null, firstBeatOffsetSec = 0) {
    const deck = this.state.decks[deckId];
    this.state = {
      ...this.state,
      decks: {
        ...this.state.decks,
        [deckId]: {
          ...deck,
          baseBpm,
          firstBeatOffsetSec,
          isAnalyzingBpm: false,
          bpmDetectionFailed: baseBpm === null
        }
      }
    };
    this.notify();
  }

  setDeckPosition(deckId: DeckId, positionSec: number) {
    const deck = this.state.decks[deckId];
    this.state = {
      ...this.state,
      decks: {
        ...this.state.decks,
        [deckId]: {
          ...deck,
          currentPositionSec: positionSec
        }
      }
    };
    this.notify();
  }

  setNudge(deckId: DeckId, direction: 'slower' | 'faster', active: boolean) {
    const deck = this.state.decks[deckId];
    this.state = {
      ...this.state,
      decks: {
        ...this.state.decks,
        [deckId]: {
          ...deck,
          isNudgingSlower: direction === 'slower' ? active : deck.isNudgingSlower,
          isNudgingFaster: direction === 'faster' ? active : deck.isNudgingFaster
        }
      }
    };
    this.notify();
  }

  // --- Crossfader ---
  setCrossfader(valueU: number) {
    const clamped = Math.max(0, Math.min(1, valueU));
    if (this.state.crossfader === clamped) return;
    this.state = {
      ...this.state,
      crossfader: clamped
    };
    this.notify();
  }

  setActiveCrossfader(active: boolean) {
    if (this.state.activeCrossfader === active) return;
    this.state = {
      ...this.state,
      activeCrossfader: active
    };
    this.notify();
  }

  // --- Master & Mute ---
  toggleMute() {
    this.state = {
      ...this.state,
      isMuted: !this.state.isMuted
    };
    this.notify();
  }

  setMute(isMuted: boolean) {
    if (this.state.isMuted === isMuted) return;
    this.state = {
      ...this.state,
      isMuted
    };
    this.notify();
  }

  // --- Recording ---
  setRecording(isRecording: boolean) {
    this.state = {
      ...this.state,
      recording: {
        ...this.state.recording,
        isRecording,
        durationSec: isRecording ? this.state.recording.durationSec : 0
      }
    };
    this.notify();
  }

  setRecordingDuration(durationSec: number) {
    this.state = {
      ...this.state,
      recording: {
        ...this.state.recording,
        durationSec
      }
    };
    this.notify();
  }

  setIncludeVideo(includeVideo: boolean) {
    this.state = {
      ...this.state,
      recording: {
        ...this.state.recording,
        includeVideo
      }
    };
    this.notify();
  }

  setRecordedBlob(blob: Blob | null, mimeType: string | null) {
    this.state = {
      ...this.state,
      recording: {
        ...this.state.recording,
        recordedBlob: blob,
        recordedMimeType: mimeType
      }
    };
    this.notify();
  }

  // --- Camera & Tracking ---
  setCameraPermission(permission: AppState['camera']['permission']) {
    this.state = {
      ...this.state,
      camera: {
        ...this.state.camera,
        permission
      }
    };
    this.notify();
  }

  setCameraStreamActive(isStreamActive: boolean) {
    this.state = {
      ...this.state,
      camera: {
        ...this.state.camera,
        isStreamActive
      }
    };
    this.notify();
  }

  setTrackingMetrics(fps: number, latencyMs: number, status: AppState['camera']['trackingStatus']) {
    this.state = {
      ...this.state,
      camera: {
        ...this.state.camera,
        fps,
        latencyMs,
        trackingStatus: status
      }
    };
    this.notify();
  }

  // --- Overlays ---
  toggleGesturesOverlay() {
    this.state = {
      ...this.state,
      overlays: {
        ...this.state.overlays,
        showGestures: !this.state.overlays.showGestures
      }
    };
    this.notify();
  }

  setGesturesOverlay(show: boolean) {
    if (this.state.overlays.showGestures === show) return;
    this.state = {
      ...this.state,
      overlays: {
        ...this.state.overlays,
        showGestures: show
      }
    };
    this.notify();
  }

  toggleTuningPanel() {
    this.state = {
      ...this.state,
      overlays: {
        ...this.state.overlays,
        showTuning: !this.state.overlays.showTuning
      }
    };
    this.notify();
  }

  setTuningPanel(show: boolean) {
    if (this.state.overlays.showTuning === show) return;
    this.state = {
      ...this.state,
      overlays: {
        ...this.state.overlays,
        showTuning: show
      }
    };
    this.notify();
  }

  // --- Tuning settings ---
  updateTuning(partial: Partial<AppState['tuning']>) {
    const updated = {
      ...this.state.tuning,
      ...partial
    };
    this.state = {
      ...this.state,
      tuning: updated
    };
    try {
      localStorage.setItem(STORAGE_KEY_TUNING, JSON.stringify(updated));
    } catch {
      // ignore
    }
    this.notify();
  }

  resetTuning() {
    const defaults = {
      sensitivity: CONTROL_CONFIG.DEFAULT_SENSITIVITY,
      smoothing: VISION_CONFIG.ONE_EURO_DEFAULTS.MIN_CUTOFF,
      responsiveness: VISION_CONFIG.ONE_EURO_DEFAULTS.BETA,
      grabDistance: POSE_CONFIG.PINCH_ENGAGE_DISTANCE,
      releaseDistance: POSE_CONFIG.PINCH_RELEASE_DISTANCE,
      holdTimeMs: CONTROL_CONFIG.DEFAULT_TRIGGER_HOLD_MS,
      restZoneHeight: CONTROL_CONFIG.DEFAULT_REST_ZONE_HEIGHT
    };
    this.state = {
      ...this.state,
      tuning: defaults
    };
    try {
      localStorage.removeItem(STORAGE_KEY_TUNING);
    } catch {
      // ignore
    }
    this.notify();
  }

  setSystemMessage(msg: string | null) {
    this.state = {
      ...this.state,
      systemMessage: msg
    };
    this.notify();
  }
}

export const appStore = new Store();
