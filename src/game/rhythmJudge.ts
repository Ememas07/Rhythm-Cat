import type { JudgmentResult, JudgmentTier } from './types';

export const PERFECT_WINDOW_SEC = 0.095;
export const GOOD_WINDOW_SEC = 0.175;

/**
 * Finds the signed distance in seconds from `songTime` to the nearest beat
 * on a uniform grid starting at `firstBeatSec` with period `60 / bpm`,
 * or to the closest entry in `beatTimes` when provided.
 */
export function getNearestBeatDeltaSec(
  songTime: number,
  bpm: number,
  firstBeatSec: number,
  beatTimes?: number[],
): { deltaSec: number; beatIndex: number; beatProgress: number } {
  const beatPeriod = 60 / Math.max(40, bpm);

  if (beatTimes && beatTimes.length > 0) {
    // Binary search for closest beat timestamp
    let lo = 0;
    let hi = beatTimes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (beatTimes[mid] < songTime) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    let bestIdx = lo;
    if (lo > 0 && Math.abs(beatTimes[lo - 1] - songTime) < Math.abs(beatTimes[lo] - songTime)) {
      bestIdx = lo - 1;
    }
    const deltaSec = songTime - beatTimes[bestIdx];
    const phase = (((songTime - firstBeatSec) / beatPeriod) % 1 + 1) % 1;
    return { deltaSec, beatIndex: bestIdx, beatProgress: phase };
  }

  const relativeBeats = (songTime - firstBeatSec) / beatPeriod;
  const nearestBeatIndex = Math.round(relativeBeats);
  const nearestBeatTime = firstBeatSec + nearestBeatIndex * beatPeriod;
  const deltaSec = songTime - nearestBeatTime;
  const phase = ((relativeBeats % 1) + 1) % 1;
  return { deltaSec, beatIndex: nearestBeatIndex, beatProgress: phase };
}

export function getMultiplierForCombo(combo: number): number {
  if (combo >= 24) return 4;
  if (combo >= 12) return 3;
  if (combo >= 5) return 2;
  return 1;
}

export function evaluateBeatJump(
  songTime: number,
  bpm: number,
  firstBeatSec: number,
  currentCombo: number,
  beatTimes?: number[],
): JudgmentResult {
  const { deltaSec } = getNearestBeatDeltaSec(songTime, bpm, firstBeatSec, beatTimes);
  const absDelta = Math.abs(deltaSec);
  const deltaMs = Math.round(deltaSec * 1000);

  let tier: JudgmentTier;
  let basePoints: number;
  let nextCombo: number;
  let boostScale: number;

  if (absDelta <= PERFECT_WINDOW_SEC) {
    tier = 'PERFECT';
    nextCombo = currentCombo + 1;
    basePoints = 100;
    boostScale = 1.06;
  } else if (absDelta <= GOOD_WINDOW_SEC) {
    tier = 'GOOD';
    nextCombo = currentCombo + 1;
    basePoints = 50;
    boostScale = 1.02;
  } else {
    tier = 'OFFBEAT';
    nextCombo = 0;
    basePoints = 0;
    boostScale = 0.96;
  }

  const multiplier = getMultiplierForCombo(nextCombo);
  return {
    tier,
    deltaMs,
    points: basePoints * multiplier,
    nextCombo,
    multiplier,
    boostScale,
  };
}

export function computeAccuracyPercent(
  perfectCount: number,
  goodCount: number,
  offbeatCount: number,
): number {
  const total = perfectCount + goodCount + offbeatCount;
  if (total === 0) return 100;
  const weighted = perfectCount * 1.0 + goodCount * 0.65;
  return Math.round((weighted / total) * 100);
}
