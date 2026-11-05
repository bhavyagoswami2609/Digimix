import { AUDIO_CONFIG } from '../config.ts';
import { volumeCurve, eqCurve, tempoCurve } from './curves.ts';
import { computeWaveformPeaks, WaveformPeaks } from './waveform.ts';

export type DeckIdentifier = 'A' | 'B';

export class DeckAudioNode {
  private ctx: AudioContext;
  readonly id: DeckIdentifier;

  // Signal chain nodes
  private sourceNode: AudioBufferSourceNode | null = null;
  private trimGainNode: GainNode;
  private lowShelfNode: BiquadFilterNode;
  private midPeakingNode: BiquadFilterNode;
  private highShelfNode: BiquadFilterNode;
  private channelGainNode: GainNode;
  private jumpGainNode: GainNode;
  private crossfaderGainNode: GainNode;

  // State
  private buffer: AudioBuffer | null = null;
  private peaks: WaveformPeaks | null = null;
  private isPlaying = false;
  private offset = 0; // track seconds at last reference point
  private startTime = 0; // context time at last reference point
  private rate = 1.0; // actual playback rate (including tempo and nudge)
  private baseRate = 1.0; // playback rate from tempo curve without nudge
  private cuePoint = 0; // cue point track seconds
  private isNudgingSlower = false;
  private isNudgingFaster = false;

  private onEndedCallback: (() => void) | null = null;

  constructor(ctx: AudioContext, id: DeckIdentifier, destination: AudioNode) {
    this.ctx = ctx;
    this.id = id;

    // Create signal chain:
    // source -> trim -> lowShelf -> midPeaking -> highShelf -> channelGain -> jumpGain -> crossfaderGain -> destination
    this.trimGainNode = ctx.createGain();
    this.trimGainNode.gain.value = AUDIO_CONFIG.TRIM_GAIN;

    // Low shelf at 250 Hz
    this.lowShelfNode = ctx.createBiquadFilter();
    this.lowShelfNode.type = 'lowshelf';
    this.lowShelfNode.frequency.value = 250;
    this.lowShelfNode.gain.value = 0;

    // Mid peaking at 1000 Hz, Q 0.7
    this.midPeakingNode = ctx.createBiquadFilter();
    this.midPeakingNode.type = 'peaking';
    this.midPeakingNode.frequency.value = 1000;
    this.midPeakingNode.Q.value = 0.7;
    this.midPeakingNode.gain.value = 0;

    // High shelf at 3500 Hz
    this.highShelfNode = ctx.createBiquadFilter();
    this.highShelfNode.type = 'highshelf';
    this.highShelfNode.frequency.value = 3500;
    this.highShelfNode.gain.value = 0;

    // Channel gain (volume)
    this.channelGainNode = ctx.createGain();
    this.channelGainNode.gain.value = volumeCurve(AUDIO_CONFIG.DEFAULT_U.VOLUME);

    // Jump gain (normally 1.0, used only by Smart Sync)
    this.jumpGainNode = ctx.createGain();
    this.jumpGainNode.gain.value = 1.0;

    // Crossfader gain
    this.crossfaderGainNode = ctx.createGain();
    this.crossfaderGainNode.gain.value = id === 'A' ? Math.cos(Math.PI / 4) : Math.sin(Math.PI / 4);

    // Wire chain
    this.trimGainNode.connect(this.lowShelfNode);
    this.lowShelfNode.connect(this.midPeakingNode);
    this.midPeakingNode.connect(this.highShelfNode);
    this.highShelfNode.connect(this.channelGainNode);
    this.channelGainNode.connect(this.jumpGainNode);
    this.jumpGainNode.connect(this.crossfaderGainNode);
    this.crossfaderGainNode.connect(destination);
  }

  setBuffer(buffer: AudioBuffer | null, targetBuckets = 800) {
    this.stopInternal();
    this.buffer = buffer;
    this.offset = 0;
    this.cuePoint = 0;
    this.startTime = 0;
    if (buffer) {
      this.peaks = computeWaveformPeaks(buffer, targetBuckets);
    } else {
      this.peaks = null;
    }
  }

  getBuffer(): AudioBuffer | null {
    return this.buffer;
  }

  getPeaks(): WaveformPeaks | null {
    return this.peaks;
  }

  getCurrentPosition(): number {
    if (!this.buffer) return 0;
    if (!this.isPlaying) return this.offset;
    const now = this.ctx.currentTime;
    const pos = this.offset + (now - this.startTime) * this.rate;
    if (pos >= this.buffer.duration) {
      return this.buffer.duration;
    }
    return Math.max(0, pos);
  }

  getRemainingTime(): number {
    if (!this.buffer) return 0;
    return Math.max(0, this.buffer.duration - this.getCurrentPosition());
  }

  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  // --- Transport Controls ---

  play() {
    if (!this.buffer || this.isPlaying) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    // "The cue point is the offset where playback last started from a stopped deck or from a seek."
    // If deck was at 0 or after cue, offset is cue point
    const currentPos = this.offset;
    if (currentPos >= this.buffer.duration) {
      this.offset = 0;
    }

    this.startSourceAt(this.offset);
    this.isPlaying = true;
  }

  pause() {
    if (!this.isPlaying || !this.buffer) return;
    this.offset = this.getCurrentPosition();
    this.stopInternal();
    this.isPlaying = false;
    // "Pause keeps the offset and does not move the cue point."
  }

  cue() {
    // "Cue stops playback and returns to the cue point."
    this.stopInternal();
    this.isPlaying = false;
    this.offset = this.cuePoint;
  }

  seek(positionSec: number) {
    if (!this.buffer) return;
    const clamped = Math.max(0, Math.min(this.buffer.duration, positionSec));
    this.offset = clamped;
    this.cuePoint = clamped; // "or from a seek"

    if (this.isPlaying) {
      this.stopInternal();
      this.startSourceAt(clamped);
    }
  }

  private startSourceAt(trackTimeSec: number) {
    if (!this.buffer) return;

    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    // "The one exception is playbackRate, which must never be ramped: set it directly"
    source.playbackRate.value = this.rate;
    source.connect(this.trimGainNode);

    this.startTime = this.ctx.currentTime;
    this.offset = trackTimeSec;

    source.onended = () => {
      if (this.sourceNode === source) {
        // Track naturally finished
        const currentPos = this.getCurrentPosition();
        if (this.buffer && currentPos >= this.buffer.duration - 0.05) {
          this.offset = 0;
          this.isPlaying = false;
          this.sourceNode = null;
          if (this.onEndedCallback) {
            this.onEndedCallback();
          }
        }
      }
    };

    source.start(0, trackTimeSec);
    this.sourceNode = source;
  }

  private stopInternal() {
    if (this.sourceNode) {
      try {
        this.sourceNode.onended = null;
        this.sourceNode.stop();
        this.sourceNode.disconnect();
      } catch {
        // ignore already stopped
      }
      this.sourceNode = null;
    }
  }

  setOnEnded(cb: () => void) {
    this.onEndedCallback = cb;
  }

  // --- Controls & Rate Changes ---

  setVolumeU(u: number) {
    const gainVal = volumeCurve(u);
    this.channelGainNode.gain.setTargetAtTime(
      gainVal,
      this.ctx.currentTime,
      AUDIO_CONFIG.PARAM_TIME_CONSTANT
    );
  }

  setBassU(u: number) {
    const { db } = eqCurve(u);
    this.lowShelfNode.gain.setTargetAtTime(
      db,
      this.ctx.currentTime,
      AUDIO_CONFIG.PARAM_TIME_CONSTANT
    );
  }

  setMidU(u: number) {
    const { db } = eqCurve(u);
    this.midPeakingNode.gain.setTargetAtTime(
      db,
      this.ctx.currentTime,
      AUDIO_CONFIG.PARAM_TIME_CONSTANT
    );
  }

  setTrebleU(u: number) {
    const { db } = eqCurve(u);
    this.highShelfNode.gain.setTargetAtTime(
      db,
      this.ctx.currentTime,
      AUDIO_CONFIG.PARAM_TIME_CONSTANT
    );
  }

  setCrossfaderGain(gainVal: number) {
    this.crossfaderGainNode.gain.setTargetAtTime(
      gainVal,
      this.ctx.currentTime,
      AUDIO_CONFIG.PARAM_TIME_CONSTANT
    );
  }

  setTempoU(u: number) {
    const { playbackRate } = tempoCurve(u);
    this.baseRate = playbackRate;
    this.applyNewRate();
  }

  setNudge(direction: 'slower' | 'faster', active: boolean) {
    if (direction === 'slower') this.isNudgingSlower = active;
    if (direction === 'faster') this.isNudgingFaster = active;
    this.applyNewRate();
  }

  private applyNewRate() {
    let targetRate = this.baseRate;
    if (this.isNudgingSlower) targetRate *= AUDIO_CONFIG.NUDGE_MULTIPLIER_SLOWER;
    if (this.isNudgingFaster) targetRate *= AUDIO_CONFIG.NUDGE_MULTIPLIER_FASTER;

    if (this.rate === targetRate) return;

    if (this.isPlaying && this.sourceNode) {
      // "Whenever the rate changes, first compute the current position with the old rate,
      // store it as the new offset, set startTime to the current context time,
      // then set playbackRate.value directly with no ramp."
      const now = this.ctx.currentTime;
      this.offset = this.offset + (now - this.startTime) * this.rate;
      this.startTime = now;
      this.rate = targetRate;
      this.sourceNode.playbackRate.value = targetRate;
    } else {
      this.rate = targetRate;
    }
  }

  getActualPlaybackRate(): number {
    return this.rate;
  }

  getBasePlaybackRate(): number {
    return this.baseRate;
  }

  // --- Smart Sync Beat Jump ---

  jumpToPositionSmooth(newTrackTimeSec: number) {
    if (!this.buffer) return;
    const clamped = Math.max(0, Math.min(this.buffer.duration, newTrackTimeSec));

    if (!this.isPlaying) {
      this.offset = clamped;
      return;
    }

    // "To avoid a click, dip the jump gain to 0 over 4 ms, restart the source at the new position,
    // then bring the jump gain back to 1 over 4 ms."
    const now = this.ctx.currentTime;
    const rampSec = AUDIO_CONFIG.SMART_SYNC_RAMP_SEC; // 0.004s

    this.jumpGainNode.gain.cancelScheduledValues(now);
    this.jumpGainNode.gain.setValueAtTime(this.jumpGainNode.gain.value, now);
    this.jumpGainNode.gain.linearRampToValueAtTime(0, now + rampSec);

    setTimeout(() => {
      this.stopInternal();
      this.startSourceAt(clamped);

      const resumeTime = this.ctx.currentTime;
      this.jumpGainNode.gain.cancelScheduledValues(resumeTime);
      this.jumpGainNode.gain.setValueAtTime(0, resumeTime);
      this.jumpGainNode.gain.linearRampToValueAtTime(1.0, resumeTime + rampSec);
    }, rampSec * 1000);
  }
}
