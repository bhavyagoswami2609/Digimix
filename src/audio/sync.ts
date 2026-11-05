import { AUDIO_CONFIG } from '../config.ts';

export interface SyncTempoResult {
  success: boolean;
  targetU?: number;
  newBaseBpm?: number;
  targetPercent?: number;
  errorMessage?: string;
}

export function computeSmartSyncTempo(
  thisDeckBaseBpm: number | null,
  otherDeckDisplayedBpm: number | null
): SyncTempoResult {
  if (thisDeckBaseBpm === null || otherDeckDisplayedBpm === null || thisDeckBaseBpm <= 0 || otherDeckDisplayedBpm <= 0) {
    return {
      success: false,
      errorMessage: 'Tempo not found. Type a BPM to enable Sync.'
    };
  }

  // Candidates: as-is, halved (base / 2), doubled (base * 2)
  const candidates = [
    thisDeckBaseBpm,
    thisDeckBaseBpm / 2,
    thisDeckBaseBpm * 2
  ];

  let bestCandidate: { baseBpm: number; p: number; u: number } | null = null;
  let minAbsP = Infinity;

  for (const base of candidates) {
    // displayed = base * (1 + p / 100) = otherDeckDisplayedBpm
    // 1 + p / 100 = otherDeckDisplayedBpm / base
    // p = (otherDeckDisplayedBpm / base - 1) * 100
    const p = (otherDeckDisplayedBpm / base - 1) * 100;
    // p = (u - 0.5) * 32 => u = p / 32 + 0.5
    const u = p / 32 + 0.5;

    if (Math.abs(p) <= AUDIO_CONFIG.TEMPO_RANGE_PCT) {
      if (Math.abs(p) < minAbsP) {
        minAbsP = Math.abs(p);
        bestCandidate = { baseBpm: base, p, u };
      }
    }
  }

  if (!bestCandidate) {
    return {
      success: false,
      errorMessage: 'These tempos are too far apart to match.'
    };
  }

  return {
    success: true,
    targetU: Math.max(0, Math.min(1, bestCandidate.u)),
    newBaseBpm: bestCandidate.baseBpm,
    targetPercent: bestCandidate.p
  };
}

export interface BeatAlignmentResult {
  positionDeltaSec: number;
}

export function computeBeatAlignment(
  thisDeckPhase: number,
  otherDeckPhase: number,
  thisDeckBeatLengthTrackSec: number
): BeatAlignmentResult {
  // Read both phases at the same instant, take difference d wrapped to [-0.5, 0.5] beats
  let d = thisDeckPhase - otherDeckPhase;
  while (d > 0.5) d -= 1.0;
  while (d < -0.5) d += 1.0;

  // Move this deck's position by -d * this deck's beat length in track seconds
  // so it never jumps more than half a beat
  const positionDeltaSec = -d * thisDeckBeatLengthTrackSec;
  return { positionDeltaSec };
}

export interface MatchReadoutData {
  isMatched: boolean;
  tempoDiffBpm: number;
  tempoDiffStr: string;
  beatOffsetMs: number;
  beatOffsetStr: string;
}

export function computeMatchReadout(
  displayedBpmA: number,
  displayedBpmB: number,
  phaseA: number,
  phaseB: number
): MatchReadoutData {
  const tempoDiffBpm = displayedBpmA - displayedBpmB;

  // Beat offset is phase of deck B minus phase of deck A, wrapped to [-0.5, 0.5] beats,
  // multiplied by deck A's beat length in real seconds (60 / displayed BPM A) in ms
  let phaseDiff = phaseB - phaseA;
  while (phaseDiff > 0.5) phaseDiff -= 1.0;
  while (phaseDiff < -0.5) phaseDiff += 1.0;

  const realBeatLengthSec = displayedBpmA > 0 ? 60 / displayedBpmA : 0;
  const beatOffsetMs = phaseDiff * realBeatLengthSec * 1000;

  const isMatched =
    Math.abs(tempoDiffBpm) <= AUDIO_CONFIG.MATCH_TOLERANCE.BPM_DIFF &&
    Math.abs(beatOffsetMs) <= AUDIO_CONFIG.MATCH_TOLERANCE.BEAT_OFFSET_MS;

  const signTempo = tempoDiffBpm >= 0 ? '+' : '';
  const tempoDiffStr = `${signTempo}${tempoDiffBpm.toFixed(1)} BPM`;

  const signOffset = beatOffsetMs >= 0 ? '+' : '';
  const beatOffsetStr = `${signOffset}${Math.round(beatOffsetMs)} ms`;

  return {
    isMatched,
    tempoDiffBpm,
    tempoDiffStr,
    beatOffsetMs,
    beatOffsetStr
  };
}
