/**
 * Beat grid and phase calculations according to Section 4
 */

export function calculateBeatLengthSec(baseBpm: number): number {
  if (baseBpm <= 0) return 0;
  return 60 / baseBpm;
}

export function calculateBeatPhase(
  trackPositionSec: number,
  baseBpm: number,
  firstBeatOffsetSec: number
): number {
  if (baseBpm <= 0) return 0;
  const beatLength = calculateBeatLengthSec(baseBpm);
  if (beatLength <= 0) return 0;

  const rawBeats = (trackPositionSec - firstBeatOffsetSec) / beatLength;
  const phase = rawBeats - Math.floor(rawBeats);
  return (phase + 1) % 1; // normalize to [0, 1)
}

export interface BeatGridLine {
  trackTimeSec: number;
  beatIndex: number; // 0 is first beat, every 4th is downbeat
  isDownbeat: boolean;
}

export function getVisibleBeatLines(
  centerTimeSec: number,
  windowDurationSec: number,
  baseBpm: number,
  firstBeatOffsetSec: number
): BeatGridLine[] {
  if (baseBpm <= 0) return [];
  const beatLength = calculateBeatLengthSec(baseBpm);
  if (beatLength <= 0) return [];

  const startTime = centerTimeSec - windowDurationSec / 2;
  const endTime = centerTimeSec + windowDurationSec / 2;

  // Find index of first beat before or at startTime
  const startBeatIndex = Math.floor((startTime - firstBeatOffsetSec) / beatLength);
  const endBeatIndex = Math.ceil((endTime - firstBeatOffsetSec) / beatLength);

  const lines: BeatGridLine[] = [];
  for (let i = startBeatIndex; i <= endBeatIndex; i++) {
    const time = firstBeatOffsetSec + i * beatLength;
    if (time >= startTime && time <= endTime) {
      // Every 4th beat from the first beat offset is stronger
      const isDownbeat = ((i % 4) + 4) % 4 === 0;
      lines.push({
        trackTimeSec: time,
        beatIndex: i,
        isDownbeat
      });
    }
  }

  return lines;
}
