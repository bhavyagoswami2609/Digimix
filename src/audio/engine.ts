import { AUDIO_CONFIG } from '../config.ts';
import { appStore, AppState } from '../app/store.ts';
import { DeckAudioNode } from './deck.ts';
import { crossfaderEqualPower } from './curves.ts';
import { detectBpmAndOffset } from './bpm.ts';
import { computeBeatAlignment, computeSmartSyncTempo } from './sync.ts';
import { calculateBeatLengthSec, calculateBeatPhase } from './beatgrid.ts';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private recorderStreamNode: MediaStreamAudioDestinationNode | null = null;
  private speakerGainNode: GainNode | null = null;

  private deckA: DeckAudioNode | null = null;
  private deckB: DeckAudioNode | null = null;

  private hasPlayedFirstTime = false;
  private isMuted = false;
  private prevState: AppState | null = null;
  private timerId: number | null = null;

  constructor() {
    // AudioContext will be initialized upon user gesture (e.g. Start button or interaction)
  }

  initContext(): AudioContext {
    if (this.ctx) return this.ctx;

    const ctx = new AudioContext({
      latencyHint: AUDIO_CONFIG.LATENCY_HINT
    });
    this.ctx = ctx;

    // Master chain:
    // masterGain -> limiter -> recorderStreamNode
    //                       -> speakerGain -> destination
    const masterGain = ctx.createGain();
    masterGain.gain.value = 1.0;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = AUDIO_CONFIG.LIMITER.THRESHOLD_DB;
    limiter.knee.value = AUDIO_CONFIG.LIMITER.KNEE;
    limiter.ratio.value = AUDIO_CONFIG.LIMITER.RATIO;
    limiter.attack.value = AUDIO_CONFIG.LIMITER.ATTACK_SEC;
    limiter.release.value = AUDIO_CONFIG.LIMITER.RELEASE_SEC;

    masterGain.connect(limiter);

    // MediaStream tap for recording
    this.recorderStreamNode = ctx.createMediaStreamDestination();
    limiter.connect(this.recorderStreamNode);

    // Speaker gain (with mute & 300ms startup ramp)
    const speakerGain = ctx.createGain();
    speakerGain.gain.value = 0.0; // starts at 0 until first play startup ramp
    this.speakerGainNode = speakerGain;

    limiter.connect(speakerGain);
    speakerGain.connect(ctx.destination);

    // Create deck chains
    this.deckA = new DeckAudioNode(ctx, 'A', masterGain);
    this.deckB = new DeckAudioNode(ctx, 'B', masterGain);

    this.deckA.setOnEnded(() => {
      appStore.setTransportPlaying('A', false);
    });
    this.deckB.setOnEnded(() => {
      appStore.setTransportPlaying('B', false);
    });

    this.startPositionTimer();
    return ctx;
  }

  getContext(): AudioContext | null {
    return this.ctx;
  }

  getRecorderStream(): MediaStream | null {
    return this.recorderStreamNode ? this.recorderStreamNode.stream : null;
  }

  getDeck(id: 'A' | 'B'): DeckAudioNode | null {
    return id === 'A' ? this.deckA : this.deckB;
  }

  // --- Track Loading and Decoding ---

  async loadTrackFile(deckId: 'A' | 'B', file: File): Promise<AudioBuffer> {
    const ctx = this.initContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

    const deckNode = deckId === 'A' ? this.deckA : this.deckB;
    if (deckNode) {
      deckNode.setBuffer(audioBuffer);
    }

    appStore.setDeckFile(deckId, {
      name: file.name,
      durationSec: audioBuffer.duration,
      buffer: audioBuffer
    });

    // Start BPM detection in background
    appStore.setBpmAnalysisState(deckId, true);
    detectBpmAndOffset(audioBuffer)
      .then((res) => {
        appStore.setDeckBpm(deckId, res.baseBpm, res.firstBeatOffsetSec);
      })
      .catch(() => {
        appStore.setDeckBpm(deckId, null, 0);
      });

    return audioBuffer;
  }

  // --- Hearing Safety Startup Ramp & Mute ---

  private ensureStartupRamp() {
    if (!this.ctx || !this.speakerGainNode) return;
    if (!this.hasPlayedFirstTime) {
      this.hasPlayedFirstTime = true;
      const now = this.ctx.currentTime;
      // "on first play, ramp the speaker output from 0 to full over 300 ms"
      this.speakerGainNode.gain.cancelScheduledValues(now);
      this.speakerGainNode.gain.setValueAtTime(0, now);
      this.speakerGainNode.gain.linearRampToValueAtTime(
        this.isMuted ? 0.0 : 1.0,
        now + AUDIO_CONFIG.STARTUP_RAMP_SEC
      );
    }
  }

  private setMuted(muted: boolean) {
    this.isMuted = muted;
    if (!this.ctx || !this.speakerGainNode) return;
    if (!this.hasPlayedFirstTime) return; // will ramp upon first play

    const now = this.ctx.currentTime;
    this.speakerGainNode.gain.cancelScheduledValues(now);
    this.speakerGainNode.gain.setTargetAtTime(
      muted ? 0.0 : 1.0,
      now,
      AUDIO_CONFIG.PARAM_TIME_CONSTANT
    );
  }

  // --- Position & Match Readout Update Loop ---

  private startPositionTimer() {
    if (this.timerId !== null) return;

    // Run at ~30-60 Hz for smooth playhead and match calculations
    const loop = () => {
      if (this.deckA && this.deckB) {
        const posA = this.deckA.getCurrentPosition();
        const posB = this.deckB.getCurrentPosition();

        if (this.deckA.getIsPlaying()) {
          appStore.setDeckPosition('A', posA);
        }
        if (this.deckB.getIsPlaying()) {
          appStore.setDeckPosition('B', posB);
        }
      }
      this.timerId = requestAnimationFrame(loop);
    };

    this.timerId = requestAnimationFrame(loop);
  }

  // --- Sync Trigger Logic ---

  performSync(deckToSyncId: 'A' | 'B') {
    const otherDeckId = deckToSyncId === 'A' ? 'B' : 'A';
    const state = appStore.getState();
    const thisDeck = state.decks[deckToSyncId];
    const otherDeck = state.decks[otherDeckId];

    if (!thisDeck.baseBpm || !otherDeck.baseBpm) {
      appStore.setSystemMessage('Tempo not found. Type a BPM to enable Sync.');
      return;
    }

    const otherNode = otherDeckId === 'A' ? this.deckA : this.deckB;
    const thisNode = deckToSyncId === 'A' ? this.deckA : this.deckB;
    if (!otherNode || !thisNode) return;

    const otherDisplayedBpm = otherDeck.baseBpm * otherNode.getActualPlaybackRate();

    // 1. Match tempo
    const tempoRes = computeSmartSyncTempo(thisDeck.baseBpm, otherDisplayedBpm);
    if (!tempoRes.success) {
      appStore.setSystemMessage(tempoRes.errorMessage || 'These tempos are too far apart to match.');
      return;
    }

    if (tempoRes.newBaseBpm && tempoRes.newBaseBpm !== thisDeck.baseBpm) {
      appStore.setDeckBpm(deckToSyncId, tempoRes.newBaseBpm, thisDeck.firstBeatOffsetSec);
    }
    if (tempoRes.targetU !== undefined) {
      appStore.setDeckControl(deckToSyncId, 'tempo', tempoRes.targetU);
    }

    // 2. Align beats only if both decks are playing
    if (thisDeck.isPlaying && otherDeck.isPlaying && state.decks.A.baseBpm !== null && state.decks.B.baseBpm !== null) {
      const posA = this.deckA!.getCurrentPosition();
      const posB = this.deckB!.getCurrentPosition();

      const phaseA = calculateBeatPhase(posA, state.decks.A.baseBpm, state.decks.A.firstBeatOffsetSec);
      const phaseB = calculateBeatPhase(posB, state.decks.B.baseBpm, state.decks.B.firstBeatOffsetSec);

      const thisPhase = deckToSyncId === 'A' ? phaseA : phaseB;
      const otherPhase = deckToSyncId === 'A' ? phaseB : phaseA;

      const beatLenTrack = calculateBeatLengthSec(thisDeck.baseBpm);
      const align = computeBeatAlignment(thisPhase, otherPhase, beatLenTrack);

      const curPos = thisNode.getCurrentPosition();
      thisNode.jumpToPositionSmooth(curPos + align.positionDeltaSec);
    }
  }

  // --- Store Sync (Subscribes to AppState) ---

  syncWithStore(state: AppState) {
    this.initContext();

    const prev = this.prevState;
    this.prevState = state;

    if (!prev) return;

    // Mute
    if (state.isMuted !== prev.isMuted) {
      this.setMuted(state.isMuted);
    }

    // Crossfader
    if (state.crossfader !== prev.crossfader) {
      const { gainA, gainB } = crossfaderEqualPower(state.crossfader);
      this.deckA?.setCrossfaderGain(gainA);
      this.deckB?.setCrossfaderGain(gainB);
    }

    // Deck A
    this.syncDeck('A', state.decks.A, prev.decks.A);
    // Deck B
    this.syncDeck('B', state.decks.B, prev.decks.B);
  }

  private syncDeck(id: 'A' | 'B', deck: AppState['decks']['A'], prevDeck: AppState['decks']['A']) {
    const node = id === 'A' ? this.deckA : this.deckB;
    if (!node) return;

    if (deck.volume !== prevDeck.volume) node.setVolumeU(deck.volume);
    if (deck.bass !== prevDeck.bass) node.setBassU(deck.bass);
    if (deck.mid !== prevDeck.mid) node.setMidU(deck.mid);
    if (deck.treble !== prevDeck.treble) node.setTrebleU(deck.treble);
    if (deck.tempo !== prevDeck.tempo) node.setTempoU(deck.tempo);

    if (deck.isNudgingSlower !== prevDeck.isNudgingSlower) {
      node.setNudge('slower', deck.isNudgingSlower);
    }
    if (deck.isNudgingFaster !== prevDeck.isNudgingFaster) {
      node.setNudge('faster', deck.isNudgingFaster);
    }

    if (deck.isPlaying !== prevDeck.isPlaying) {
      if (deck.isPlaying) {
        this.ensureStartupRamp();
        node.play();
      } else {
        node.pause();
      }
    }

    if (deck.isCueing && !prevDeck.isCueing) {
      node.cue();
    }
  }

  destroy() {
    if (this.timerId !== null) {
      cancelAnimationFrame(this.timerId);
      this.timerId = null;
    }
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}

export const audioEngine = new AudioEngine();
