/**
 * Audio control curves according to Section 4
 */

export function volumeCurve(u: number): number {
  const clamped = Math.max(0, Math.min(1, u));
  return clamped * clamped;
}

export function crossfaderEqualPower(u: number): { gainA: number; gainB: number } {
  const clamped = Math.max(0, Math.min(1, u));
  const angle = clamped * (Math.PI / 2);
  return {
    gainA: Math.cos(angle),
    gainB: Math.sin(angle)
  };
}

export function eqCurve(u: number): { db: number; isOff: boolean; displayStr: string } {
  const clamped = Math.max(0, Math.min(1, u));
  const v = (clamped - 0.5) * 2;
  let db: number;
  if (v >= 0) {
    db = v * 6; // 0 to +6 dB
  } else {
    db = v * 26; // -26 to 0 dB
  }

  const isOff = db <= -25;
  let displayStr: string;
  if (isOff) {
    displayStr = 'Off';
  } else if (db > 0) {
    displayStr = `+${db.toFixed(1)} dB`;
  } else {
    displayStr = `${db.toFixed(1)} dB`;
  }

  return { db, isOff, displayStr };
}

export function tempoCurve(u: number): { percent: number; playbackRate: number; displayStr: string } {
  const clamped = Math.max(0, Math.min(1, u));
  const percent = (clamped - 0.5) * 32; // -16% to +16%
  const playbackRate = 1 + percent / 100;
  const sign = percent >= 0 ? '+' : '';
  const displayStr = `${sign}${percent.toFixed(1)}%`;
  return { percent, playbackRate, displayStr };
}
