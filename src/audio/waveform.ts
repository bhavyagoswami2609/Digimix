import { BeatGridLine } from './beatgrid.ts';

export interface WaveformPeaks {
  mins: Float32Array;
  maxs: Float32Array;
  length: number;
}

export function computeWaveformPeaks(buffer: AudioBuffer, targetBuckets: number): WaveformPeaks {
  const buckets = Math.max(10, Math.floor(targetBuckets));
  const mins = new Float32Array(buckets);
  const maxs = new Float32Array(buckets);

  const numChannels = buffer.numberOfChannels;
  const channelData: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channelData.push(buffer.getChannelData(c));
  }

  const totalSamples = buffer.length;
  const samplesPerBucket = totalSamples / buckets;

  for (let i = 0; i < buckets; i++) {
    const startSample = Math.floor(i * samplesPerBucket);
    const endSample = Math.min(totalSamples, Math.floor((i + 1) * samplesPerBucket));

    let min = 1.0;
    let max = -1.0;

    for (let c = 0; c < numChannels; c++) {
      const data = channelData[c];
      // Sample a subset if bucket is large for performance
      const step = Math.max(1, Math.floor((endSample - startSample) / 200));
      for (let s = startSample; s < endSample; s += step) {
        const val = data[s];
        if (val < min) min = val;
        if (val > max) max = val;
      }
    }

    if (min > max) {
      min = 0;
      max = 0;
    }

    mins[i] = min;
    maxs[i] = max;
  }

  return { mins, maxs, length: buckets };
}

export function drawOverviewWaveform(
  canvas: HTMLCanvasElement,
  peaks: WaveformPeaks | null,
  progress: number, // 0 to 1
  deckColor: string
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (!peaks || peaks.length === 0) {
    // Blank state with subtle line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    return;
  }

  const playheadX = Math.max(0, Math.min(w, progress * w));
  const midY = h / 2;
  const halfH = (h / 2) * 0.95;

  const bucketScale = peaks.length / w;

  // 1. Draw played portion (solid deckColor)
  ctx.fillStyle = deckColor;
  ctx.beginPath();
  for (let x = 0; x < playheadX; x++) {
    const bucketIdx = Math.floor(x * bucketScale);
    const min = peaks.mins[bucketIdx];
    const max = peaks.maxs[bucketIdx];
    const top = midY - max * halfH;
    const bottom = midY - min * halfH;
    ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
  }

  // 2. Draw unplayed portion (35% opacity)
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = deckColor;
  for (let x = Math.floor(playheadX); x < w; x++) {
    const bucketIdx = Math.floor(x * bucketScale);
    const min = peaks.mins[bucketIdx];
    const max = peaks.maxs[bucketIdx];
    const top = midY - max * halfH;
    const bottom = midY - min * halfH;
    ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
  }
  ctx.restore();

  // 3. Playhead (2px in text color #ECE9E4)
  ctx.fillStyle = '#ECE9E4';
  ctx.fillRect(Math.floor(playheadX) - 1, 0, 2, h);
}

export function drawBeatViewWaveform(
  canvas: HTMLCanvasElement,
  buffer: AudioBuffer | null,
  currentPositionSec: number,
  windowDurationSec: number, // ~8s
  beatLines: BeatGridLine[],
  deckColor: string
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const midY = h / 2;
  const halfH = (h / 2) * 0.90;
  const centerX = w / 2;

  if (!buffer) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    // Center playhead
    ctx.fillStyle = '#ECE9E4';
    ctx.fillRect(centerX - 1, 0, 2, h);
    return;
  }

  const startTime = currentPositionSec - windowDurationSec / 2;
  const sampleRate = buffer.sampleRate;
  const totalSamples = buffer.length;
  const chData = buffer.getChannelData(0);

  // Draw waveform bars across window
  ctx.fillStyle = deckColor;
  const samplesPerPixel = (windowDurationSec * sampleRate) / w;

  for (let x = 0; x < w; x += 2) {
    const pixelTime = startTime + (x / w) * windowDurationSec;
    const sampleIdx = Math.floor(pixelTime * sampleRate);

    if (sampleIdx >= 0 && sampleIdx < totalSamples) {
      let min = 1.0;
      let max = -1.0;
      const count = Math.max(1, Math.floor(samplesPerPixel));
      const step = Math.max(1, Math.floor(count / 20));

      for (let s = 0; s < count; s += step) {
        const idx = sampleIdx + s;
        if (idx < totalSamples) {
          const val = chData[idx];
          if (val < min) min = val;
          if (val > max) max = val;
        }
      }

      if (min <= max) {
        const top = midY - max * halfH;
        const bottom = midY - min * halfH;
        ctx.fillRect(x, top, 2, Math.max(1, bottom - top));
      }
    }
  }

  // Draw beat grid lines
  for (const line of beatLines) {
    const lineX = ((line.trackTimeSec - startTime) / windowDurationSec) * w;
    if (lineX >= 0 && lineX <= w) {
      if (line.isDownbeat) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.fillRect(Math.floor(lineX) - 1, 0, 2, h);
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
        ctx.fillRect(Math.floor(lineX), 0, 1, h);
      }
    }
  }

  // Fixed center playhead (2px in text color #ECE9E4)
  ctx.fillStyle = '#ECE9E4';
  ctx.fillRect(centerX - 1, 0, 2, h);
}
