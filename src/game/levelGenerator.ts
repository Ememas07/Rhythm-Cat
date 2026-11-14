import { GRAVITY, JUMP_VELOCITY, PLAYFIELD_BOTTOM } from './physics';
import type {
  AudioAnalysisResult,
  CollectibleNote,
  DifficultyLevel,
  GameMode,
  LevelChart,
  ObstacleGate,
} from './types';

export interface LevelGenOptions {
  leadInSec?: number;
  seed?: number;
  gameMode?: GameMode;
  difficulty?: DifficultyLevel;
}

export interface DifficultyProfile {
  scrollScale: number;
  gapBase: number;
  gapEnergyDrop: number;
  minGap: number;
  burstMaxLen: number;
  burstMinEnergy: number;
  burstMinDensity: number;
  energySwingScale: number;
  climbSafety: number;
  dropSafety: number;
  hazardEveryBeats: number;
}

export function getDifficultyProfile(difficulty: DifficultyLevel = 'normal'): DifficultyProfile {
  if (difficulty === 'easy') {
    return {
      scrollScale: 0.85,
      gapBase: 258,
      gapEnergyDrop: 22,
      minGap: 224,
      burstMaxLen: 2,
      burstMinEnergy: 0.8,
      burstMinDensity: 1.9,
      energySwingScale: 0.62,
      climbSafety: 0.58,
      dropSafety: 0.62,
      hazardEveryBeats: 8,
    };
  }
  if (difficulty === 'hard') {
    return {
      scrollScale: 1.1,
      gapBase: 214,
      gapEnergyDrop: 22,
      minGap: 190,
      burstMaxLen: 4,
      burstMinEnergy: 0.68,
      burstMinDensity: 1.5,
      energySwingScale: 0.94,
      climbSafety: 0.76,
      dropSafety: 0.8,
      hazardEveryBeats: 4,
    };
  }
  return {
    scrollScale: 1.0,
    gapBase: 228,
    gapEnergyDrop: 22,
    minGap: 200,
    burstMaxLen: 3,
    burstMinEnergy: 0.74,
    burstMinDensity: 1.7,
    energySwingScale: 0.84,
    climbSafety: 0.72,
    dropSafety: 0.76,
    hazardEveryBeats: 6,
  };
}

// Unconstrained high-sky ceiling allowing multi-beat ascending runs far above the rooftops
const HIGH_SKY_MIN_Y = -540;
const LOW_ROOF_MAX_Y = PLAYFIELD_BOTTOM - 152; // ~484

/**
 * Computes physics-verified climb/drop bounds over time `dt` using the cat's
 * gravity, jump impulse, and beat period so no gate sequence is ever unreachable.
 */
function computeReachableDeltaBounds(
  dt: number,
  beatPeriod: number,
  profile: DifficultyProfile,
): { maxClimb: number; maxDrop: number } {
  const safeDt = Math.max(0.32, dt);
  // How many clean on-beat jumps fit comfortably inside `dt`
  const numBeats = Math.max(1, Math.floor(safeDt / beatPeriod + 0.15));
  const subDt = safeDt / numBeats;

  // Net upward gain of one PERFECT jump over `subDt`: -(v0 * t + 0.5 * g * t^2)
  const jumpGainPerBeat = Math.max(
    18,
    -(JUMP_VELOCITY * 1.04 * subDt + 0.5 * GRAVITY * subDt * subDt),
  );
  // Cap per-gate climb so trailing sausage tail never clips pipe collars
  const rawMaxClimb = numBeats * jumpGainPerBeat * profile.climbSafety;
  const maxClimb = Math.min(rawMaxClimb, 114 * safeDt);

  // Comfortable drop accounting for jump-arc recovery and MAX_FALL_SPEED=330
  const rawMaxDrop = Math.min(165 * safeDt, 0.36 * GRAVITY * safeDt * safeDt + 45 * safeDt);
  const maxDrop = rawMaxDrop * profile.dropSafety;

  return { maxClimb, maxDrop };
}

/**
 * Generates a rhythm-locked Flappy level chart from an audio analysis result.
 * Pass 1 constructs physics-verified reachable gates;
 * Pass 2 places collectible golden notes exclusively along safe, reachable air corridors.
 */
export function generateLevelFromAnalysis(
  analysis: AudioAnalysisResult,
  options: LevelGenOptions = {},
): LevelChart {
  const leadInSec = options.leadInSec ?? 2.6;
  const seed = options.seed ?? 1337;
  const gameMode = options.gameMode ?? 'arcade';
  const difficulty = options.difficulty ?? 'normal';
  const profile = getDifficultyProfile(difficulty);

  const bpm = Math.max(70, Math.min(180, analysis.bpm || 110));
  const beatPeriod = 60 / bpm;

  // Scroll speed scales gently with BPM and difficulty so spacing stays readable
  const baseScroll = 232 + (bpm - 80) * 1.08;
  const scrollSpeed = Math.round(baseScroll * profile.scrollScale);

  const beatTimes =
    analysis.beatTimes.length > 0
      ? analysis.beatTimes
      : buildUniformBeats(analysis.firstBeatSec, analysis.durationSec, beatPeriod);

  const onsetDensityPerBeat = computeOnsetDensityPerBeat(
    beatTimes,
    analysis.onsetTimes,
    beatPeriod,
  );
  const smoothedEnergy = smoothEnergyCurve(analysis.energyPerBeat, beatTimes.length);

  const gates: ObstacleGate[] = [];
  const notes: CollectibleNote[] = [];

  let prevGapY = 315;
  let prevGateTime = leadInSec - beatPeriod * 2;
  let gateId = 1;
  let noteId = 1;
  let quickBurstRemaining = 0;

  const endCutoff = Math.max(leadInSec + 1, analysis.durationSec - 1.6);

  // Base gate cadence scaled by BPM & difficulty so fast MP3s stay readable and fair
  const defaultBeatStep =
    difficulty === 'easy'
      ? bpm >= 115
        ? 3
        : 2
      : difficulty === 'normal'
        ? bpm >= 142
          ? 3
          : 2
        : bpm >= 158
          ? 3
          : 2;

  // Minimum time spacing between consecutive gates so the 100px-long cat always has room
  const minGateSpacingSec = difficulty === 'easy' ? 0.56 : difficulty === 'normal' ? 0.44 : 0.36;

  // --- PASS 1: Generate reachable rhythm-locked gates ---
  const candidateNoteBeats: { time: number; beatIndex: number }[] = [];

  for (let b = 0; b < beatTimes.length; b++) {
    const t = beatTimes[b];
    if (t < leadInSec || t > endCutoff) continue;

    const energy = smoothedEnergy[b] ?? 0.45;
    const rawEnergy = analysis.energyPerBeat[b] ?? energy;
    const onsetDensity = onsetDensityPerBeat[b] ?? 1;

    const canStartBurst =
      quickBurstRemaining === 0 &&
      gates.length >= 2 &&
      b % 4 === 0 &&
      t - prevGateTime >= minGateSpacingSec * 1.5 &&
      (onsetDensity >= profile.burstMinDensity || rawEnergy >= profile.burstMinEnergy);

    if (canStartBurst) {
      quickBurstRemaining = profile.burstMaxLen;
    }

    const isQuickBurstBeat = quickBurstRemaining > 0;
    const isRegularGateBeat = b % defaultBeatStep === 0;

    // On Easy or calm low-energy verses, give extra breathing room between gates
    const skipForCalmVerse =
      !isQuickBurstBeat &&
      isRegularGateBeat &&
      (difficulty === 'easy' ? energy < 0.35 : energy < 0.22) &&
      (b / defaultBeatStep) % 2 === 1 &&
      gates.length > 1;

    const enoughTimeGap = t - prevGateTime >= minGateSpacingSec;

    if ((isQuickBurstBeat || isRegularGateBeat) && !skipForCalmVerse && enoughTimeGap) {
      const dt = Math.max(0.32, t - prevGateTime);
      const { maxClimb, maxDrop } = computeReachableDeltaBounds(dt, beatPeriod, profile);
      let gapCenterY: number;

      if (isQuickBurstBeat) {
        // Ascending staircase: step UP strictly within the physics-guaranteed climb per beat
        const desiredStep = Math.min(maxClimb, Math.max(10, maxClimb * 0.86));
        gapCenterY = Math.round(Math.max(HIGH_SKY_MIN_Y, prevGapY - desiredStep));
        quickBurstRemaining--;
      } else {
        const baseAltitude = LOW_ROOF_MAX_Y - 68 - energy * 510 * profile.energySwingScale;
        const phraseWave = Math.sin(b * 0.4 + seed * 0.11) * 78 * profile.energySwingScale;
        const microVar = (pseudoRand(seed + b * 31) - 0.5) * 48 * profile.energySwingScale;
        const desiredY = Math.max(
          HIGH_SKY_MIN_Y,
          Math.min(LOW_ROOF_MAX_Y, baseAltitude + phraseWave + microVar),
        );

        const delta = Math.max(-maxClimb, Math.min(maxDrop, desiredY - prevGapY));
        gapCenterY = Math.round(
          Math.max(HIGH_SKY_MIN_Y, Math.min(LOW_ROOF_MAX_Y, prevGapY + delta)),
        );
      }

      const rawGap = profile.gapBase - energy * profile.gapEnergyDrop;
      const burstBonus = isQuickBurstBeat ? 18 : 0;
      const gapHeight = Math.round(Math.max(profile.minGap, rawGap + burstBonus));

      gates.push({
        id: gateId++,
        beatIndex: b,
        time: t,
        gapCenterY,
        gapHeight,
        width: 70,
        passed: false,
        hit: false,
        accented: isQuickBurstBeat || rawEnergy >= 0.65 || b % 8 === 0,
        energy,
      });

      prevGapY = gapCenterY;
      prevGateTime = t;
    } else {
      candidateNoteBeats.push({ time: t, beatIndex: b });
    }
  }

  // --- PASS 2: Place collectible notes strictly in safe flight corridors ---
  const gateHorizontalClearancePx = 98; // Half-gate (35px) + cat body clearance (63px)

  const computeSafeCorridor = (t: number): { corridorY: number; safeMinY: number; safeMaxY: number } => {
    if (gates.length === 0) {
      return { corridorY: 310, safeMinY: 160, safeMaxY: PLAYFIELD_BOTTOM - 80 };
    }

    let prevIdx = -1;
    for (let i = 0; i < gates.length; i++) {
      if (gates[i].time <= t) prevIdx = i;
      else break;
    }

    const gPrev = prevIdx >= 0 ? gates[prevIdx] : null;
    const gNext = prevIdx + 1 < gates.length ? gates[prevIdx + 1] : null;

    let corridorY: number;
    let safeMinY = HIGH_SKY_MIN_Y + 55;
    let safeMaxY = PLAYFIELD_BOTTOM - 76;

    if (gPrev && gNext) {
      const span = Math.max(0.01, gNext.time - gPrev.time);
      const frac = Math.max(0, Math.min(1, (t - gPrev.time) / span));
      corridorY = gPrev.gapCenterY + (gNext.gapCenterY - gPrev.gapCenterY) * frac;

      // Near either gate, stay strictly inside the overlap of the safe gap window
      const prevPad = gPrev.gapHeight / 2 - 42;
      const nextPad = gNext.gapHeight / 2 - 42;
      if (frac < 0.35) {
        safeMinY = Math.max(safeMinY, gPrev.gapCenterY - prevPad);
        safeMaxY = Math.min(safeMaxY, gPrev.gapCenterY + prevPad);
      } else if (frac > 0.65) {
        safeMinY = Math.max(safeMinY, gNext.gapCenterY - nextPad);
        safeMaxY = Math.min(safeMaxY, gNext.gapCenterY + nextPad);
      } else {
        const minC = Math.min(gPrev.gapCenterY, gNext.gapCenterY) - 24;
        const maxC = Math.max(gPrev.gapCenterY, gNext.gapCenterY) + 24;
        safeMinY = Math.max(safeMinY, minC);
        safeMaxY = Math.min(safeMaxY, maxC);
      }
    } else if (gNext) {
      const frac = Math.max(0, Math.min(1, t / Math.max(0.5, gNext.time)));
      corridorY = 310 + (gNext.gapCenterY - 310) * frac;
      const nextPad = gNext.gapHeight / 2 - 42;
      safeMinY = Math.max(safeMinY, Math.min(310, gNext.gapCenterY) - nextPad);
      safeMaxY = Math.min(safeMaxY, Math.max(310, gNext.gapCenterY) + nextPad);
    } else if (gPrev) {
      corridorY = gPrev.gapCenterY;
      const prevPad = gPrev.gapHeight / 2 - 42;
      safeMinY = Math.max(safeMinY, gPrev.gapCenterY - prevPad);
      safeMaxY = Math.min(safeMaxY, gPrev.gapCenterY + prevPad);
    } else {
      corridorY = 310;
    }

    if (safeMinY > safeMaxY) {
      const mid = (safeMinY + safeMaxY) / 2;
      safeMinY = mid - 12;
      safeMaxY = mid + 12;
    }

    return {
      corridorY: Math.max(safeMinY, Math.min(safeMaxY, corridorY)),
      safeMinY,
      safeMaxY,
    };
  };

  const hasGateHorizontalClearance = (t: number): boolean => {
    for (const g of gates) {
      if (Math.abs(t - g.time) * scrollSpeed < gateHorizontalClearancePx) {
        return false;
      }
    }
    return true;
  };

  for (const cand of candidateNoteBeats) {
    if (!hasGateHorizontalClearance(cand.time)) continue;

    const { corridorY, safeMinY, safeMaxY } = computeSafeCorridor(cand.time);
    const noteY = Math.round(Math.max(safeMinY, Math.min(safeMaxY, corridorY)));

    notes.push({
      id: noteId++,
      time: cand.time,
      y: noteY,
      radius: 17,
      collected: false,
      missed: false,
      isHazard: false,
      beatIndex: cand.beatIndex,
    });

    // In Boss Battle mode, periodically place a clearly separated discordant red "Wrong Note"
    if (gameMode === 'boss' && cand.beatIndex % profile.hazardEveryBeats === 3) {
      const hazardOffset = noteY > 180 ? -128 : 128;
      const hazardY = Math.round(
        Math.max(HIGH_SKY_MIN_Y + 40, Math.min(PLAYFIELD_BOTTOM - 64, noteY + hazardOffset)),
      );
      if (Math.abs(hazardY - noteY) >= 105) {
        notes.push({
          id: noteId++,
          time: cand.time,
          y: hazardY,
          radius: 16,
          collected: false,
          missed: false,
          isHazard: true,
          beatIndex: cand.beatIndex,
        });
      }
    }
  }

  // Extra onset-synced golden Beat Notes for imported MP3s strictly inside safe corridors
  if (analysis.onsetTimes.length > 0 && gates.length >= 2) {
    for (const onsetT of analysis.onsetTimes) {
      if (onsetT < leadInSec + 0.25 || onsetT > endCutoff - 0.35) continue;
      if (!hasGateHorizontalClearance(onsetT)) continue;
      const alreadyHasNote = notes.some((n) => Math.abs(n.time - onsetT) < 0.24);
      if (alreadyHasNote) continue;

      const { corridorY, safeMinY, safeMaxY } = computeSafeCorridor(onsetT);
      const onsetNoteY = Math.round(Math.max(safeMinY, Math.min(safeMaxY, corridorY)));

      notes.push({
        id: noteId++,
        time: onsetT,
        y: onsetNoteY,
        radius: 15,
        collected: false,
        missed: false,
        isHazard: false,
        beatIndex: 0,
      });
    }
    notes.sort((a, b) => a.time - b.time);
  }

  return {
    bpm,
    firstBeatSec: analysis.firstBeatSec,
    durationSec: analysis.durationSec,
    scrollSpeed,
    gates,
    notes,
    beatTimes,
  };
}

function computeOnsetDensityPerBeat(
  beatTimes: number[],
  onsetTimes: number[],
  beatPeriod: number,
): number[] {
  if (!onsetTimes || onsetTimes.length === 0) {
    return beatTimes.map(() => 1);
  }
  const halfWin = beatPeriod * 0.55;
  const counts: number[] = [];
  let oIdx = 0;
  for (let b = 0; b < beatTimes.length; b++) {
    const t = beatTimes[b];
    while (oIdx < onsetTimes.length && onsetTimes[oIdx] < t - halfWin) {
      oIdx++;
    }
    let c = 0;
    let j = oIdx;
    while (j < onsetTimes.length && onsetTimes[j] <= t + halfWin) {
      c++;
      j++;
    }
    counts.push(c);
  }
  return counts;
}

function smoothEnergyCurve(energyPerBeat: number[], length: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < length; i++) {
    let sum = 0;
    let cnt = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(length - 1, i + 2); k++) {
      sum += energyPerBeat[k] ?? 0.45;
      cnt++;
    }
    out.push(cnt > 0 ? sum / cnt : 0.45);
  }
  return out;
}

function buildUniformBeats(firstBeatSec: number, durationSec: number, period: number): number[] {
  const beats: number[] = [];
  for (let t = firstBeatSec; t < durationSec - 0.1; t += period) {
    beats.push(Number(t.toFixed(4)));
  }
  return beats;
}

function pseudoRand(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}
