import { guess } from 'web-audio-beat-detector';

export interface BpmGuessResult {
  baseBpm: number;
  firstBeatOffsetSec: number;
}

export async function detectBpmAndOffset(buffer: AudioBuffer): Promise<BpmGuessResult> {
  try {
    const result = await guess(buffer);
    // Use unrounded tempo if available, otherwise bpm
    const rawBpm = (result as { tempo?: number; bpm?: number }).tempo ?? result.bpm;
    const offset = result.offset ?? 0;

    if (!rawBpm || isNaN(rawBpm) || rawBpm <= 0) {
      throw new Error('Invalid BPM result');
    }

    return {
      baseBpm: rawBpm,
      firstBeatOffsetSec: offset
    };
  } catch (err) {
    console.warn('BPM detection failed:', err);
    throw err;
  }
}
