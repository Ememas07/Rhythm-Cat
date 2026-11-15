import type { DifficultyLevel, JudgmentResult, JudgmentTier, PlayMode } from './types';

export const PERFECT_WINDOW_SEC = 0.095;
export const GOOD_WINDOW_SEC = 0.175;
export const INFINITE_HIT_SCORE_PENALTY = 200;
export const INFINITE_MAX_RANKED_HITS = 3;

export function getBeatTimingWindows(difficulty: DifficultyLevel = 'normal'): {
  perfectSec: number;
  goodSec: number;
} {
  if (difficulty === 'easy') {
    return { perfectSec: 0.12, goodSec: 0.21 };
  }
  if (difficulty === 'hard') {
    return { perfectSec: 0.075, goodSec: 0.14 };
  }
  return { perfectSec: PERFECT_WINDOW_SEC, goodSec: GOOD_WINDOW_SEC };
}

export function shouldCountRunScore(
  playMode: PlayMode,
  hitsTaken: number,
  autoMode: boolean,
  rhythmOnlyMode = false,
): boolean {
  if (autoMode || rhythmOnlyMode) return false;
  if (playMode === 'infinite' && hitsTaken > INFINITE_MAX_RANKED_HITS) {
    return false;
  }
  return true;
}

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
  difficulty: DifficultyLevel = 'normal',
): JudgmentResult {
  const { deltaSec } = getNearestBeatDeltaSec(songTime, bpm, firstBeatSec, beatTimes);
  const absDelta = Math.abs(deltaSec);
  const deltaMs = Math.round(deltaSec * 1000);
  const { perfectSec, goodSec } = getBeatTimingWindows(difficulty);

  let tier: JudgmentTier;
  let basePoints: number;
  let nextCombo: number;
  let boostScale: number;

  if (absDelta <= perfectSec) {
    tier = 'PERFECT';
    nextCombo = currentCombo + 1;
    basePoints = 100;
    boostScale = 1.06;
  } else if (absDelta <= goodSec) {
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

export interface RhythmTapEvaluation extends JudgmentResult {
  beatIndex: number;
  isDuplicateBeatTap: boolean;
}

export function evaluateRhythmOnlyTap(
  songTime: number,
  bpm: number,
  firstBeatSec: number,
  currentCombo: number,
  lastTappedBeatIndex: number,
  beatTimes?: number[],
  difficulty: DifficultyLevel = 'normal',
): RhythmTapEvaluation {
  const { beatIndex } = getNearestBeatDeltaSec(songTime, bpm, firstBeatSec, beatTimes);
  const result = evaluateBeatJump(
    songTime,
    bpm,
    firstBeatSec,
    currentCombo,
    beatTimes,
    difficulty,
  );

  if (result.tier !== 'OFFBEAT' && beatIndex === lastTappedBeatIndex) {
    return {
      ...result,
      tier: 'OFFBEAT',
      points: 0,
      nextCombo: 0,
      multiplier: 1,
      beatIndex,
      isDuplicateBeatTap: true,
    };
  }

  return {
    ...result,
    beatIndex,
    isDuplicateBeatTap: false,
  };
}

export function findNextMissedBeatIndex(params: {
  songTime: number;
  bpm: number;
  firstBeatSec: number;
  beatTimes?: number[];
  difficulty: DifficultyLevel;
  rhythmStartTime: number;
  lastTappedBeatIndex: number;
  lastMissedBeatIndex: number;
}): number | null {
  const {
    songTime,
    bpm,
    firstBeatSec,
    beatTimes,
    difficulty,
    rhythmStartTime,
    lastTappedBeatIndex,
    lastMissedBeatIndex,
  } = params;
  const { goodSec } = getBeatTimingWindows(difficulty);
  const cutoffTime = songTime - goodSec - 0.015;
  if (cutoffTime < rhythmStartTime) return null;

  const minCandidateIdx = Math.max(0, lastMissedBeatIndex + 1, lastTappedBeatIndex + 1);

  if (beatTimes && beatTimes.length > 0) {
    for (let i = minCandidateIdx; i < beatTimes.length; i++) {
      const bt = beatTimes[i];
      if (bt > cutoffTime) break;
      if (bt >= rhythmStartTime) {
        return i;
      }
    }
    return null;
  }

  const beatPeriod = 60 / Math.max(40, bpm);
  const minActiveIdx = Math.ceil((rhythmStartTime - firstBeatSec) / beatPeriod);
  const maxExpiredIdx = Math.floor((cutoffTime - firstBeatSec) / beatPeriod);
  const candidate = Math.max(minActiveIdx, minCandidateIdx);
  return candidate <= maxExpiredIdx ? candidate : null;
}
