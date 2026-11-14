import { PLAYFIELD_BOTTOM } from './physics';
import type {
  AudioAnalysisResult,
  CollectibleNote,
  GameMode,
  LevelChart,
  ObstacleGate,
} from './types';

export interface LevelGenOptions {
  leadInSec?: number;
  seed?: number;
  gameMode?: GameMode;
}

// Unconstrained high-sky ceiling allowing multi-beat ascending runs far above the rooftops
const HIGH_SKY_MIN_Y = -560;
const LOW_ROOF_MAX_Y = PLAYFIELD_BOTTOM - 148; // ~488

/**
 * Generates a rhythm-locked Flappy level chart from an audio analysis result.
 * Follows the song's energy contour and onset density so quick consecutive beat phrases
 * climb cleanly upward through the expanded sky instead of forcing constant up-down bobbing.
 */
export function generateLevelFromAnalysis(
  analysis: AudioAnalysisResult,
  options: LevelGenOptions = {},
): LevelChart {
  const leadInSec = options.leadInSec ?? 2.6;
  const seed = options.seed ?? 1337;
  const gameMode = options.gameMode ?? 'arcade';

  const bpm = Math.max(70, Math.min(180, analysis.bpm || 110));
  const beatPeriod = 60 / bpm;

  // Scroll speed scales gently with BPM so beat spacing remains readable
  const scrollSpeed = Math.round(235 + (bpm - 80) * 1.15);

  const beatTimes =
    analysis.beatTimes.length > 0
      ? analysis.beatTimes
      : buildUniformBeats(analysis.firstBeatSec, analysis.durationSec, beatPeriod);

  // Count how many audio onsets occur near each beat so dense musical phrases trigger quick beat runs
  const onsetDensityPerBeat = computeOnsetDensityPerBeat(
    beatTimes,
    analysis.onsetTimes,
    beatPeriod,
  );

  // Smooth the local energy curve across 4-beat musical bars so altitude tracks song phrasing (verse vs chorus)
  const smoothedEnergy = smoothEnergyCurve(analysis.energyPerBeat, beatTimes.length);

  const gates: ObstacleGate[] = [];
  const notes: CollectibleNote[] = [];

  let prevGapY = 315;
  let prevGateTime = leadInSec - beatPeriod * 2;
  let gateId = 1;
  let noteId = 1;
  let quickBurstRemaining = 0;

  // Stop spawning new obstacles within the final 1.6s of the song
  const endCutoff = Math.max(leadInSec + 1, analysis.durationSec - 1.6);

  // Base gate cadence: normally every 2 beats, or 1-beat staircases during rapid onset bursts!
  const defaultBeatStep = bpm >= 152 ? 3 : 2;

  for (let b = 0; b < beatTimes.length; b++) {
    const t = beatTimes[b];
    if (t < leadInSec || t > endCutoff) continue;

    const energy = smoothedEnergy[b] ?? 0.45;
    const rawEnergy = analysis.energyPerBeat[b] ?? energy;
    const onsetDensity = onsetDensityPerBeat[b] ?? 1;

    // Trigger a 4-beat rapid climbing phrase when onset density & energy spike (e.g. drum fill / drop)
    const canStartBurst =
      quickBurstRemaining === 0 &&
      gates.length >= 2 &&
      b % 4 === 0 &&
      (onsetDensity >= 1.6 || rawEnergy >= 0.72);

    if (canStartBurst) {
      quickBurstRemaining = 4;
    }

    const isQuickBurstBeat = quickBurstRemaining > 0;
    const isRegularGateBeat = b % defaultBeatStep === 0;

    // In calm low-energy verses, give extra breathing room between gates
    const skipForCalmVerse =
      !isQuickBurstBeat &&
      isRegularGateBeat &&
      energy < 0.2 &&
      (b / defaultBeatStep) % 2 === 1 &&
      gates.length > 1;

    if ((isQuickBurstBeat || isRegularGateBeat) && !skipForCalmVerse) {
      const dt = Math.max(0.28, t - prevGateTime);
      let gapCenterY: number;

      if (isQuickBurstBeat) {
        // 4-beat quick sequence: step steadily UPWARD on each beat so the player can tap 4 beats cleanly without falling!
        const climbStep = Math.round(Math.min(72, Math.max(44, dt * 115)));
        gapCenterY = Math.max(HIGH_SKY_MIN_Y, prevGapY - climbStep);
        quickBurstRemaining--;
      } else {
        // Map smoothed song energy directly to vertical altitude:
        // Low energy -> cozy rooftop level (~320..440)
        // High energy -> soaring high sky (-360..140)
        const baseAltitude = LOW_ROOF_MAX_Y - 70 - energy * 560;
        const phraseWave = Math.sin(b * 0.42 + seed * 0.11) * 95;
        const microVar = (pseudoRand(seed + b * 31) - 0.5) * 65;
        const desiredY = Math.max(
          HIGH_SKY_MIN_Y,
          Math.min(LOW_ROOF_MAX_Y, baseAltitude + phraseWave + microVar),
        );

        // Reachability clamping proportional to elapsed time `dt` between gates
        const maxClimb = 135 * dt;
        const maxDrop = 235 * dt;
        const delta = Math.max(-maxClimb, Math.min(maxDrop, desiredY - prevGapY));
        gapCenterY = Math.round(
          Math.max(HIGH_SKY_MIN_Y, Math.min(LOW_ROOF_MAX_Y, prevGapY + delta)),
        );
      }

      // Generous gap during fast bursts or low-energy sections; tighter only on sustained high-energy choruses
      const gapHeight = isQuickBurstBeat
        ? Math.round(218 - energy * 18)
        : Math.round(216 - energy * 38);

      gates.push({
        id: gateId++,
        beatIndex: b,
        time: t,
        gapCenterY,
        gapHeight,
        width: 74,
        passed: false,
        hit: false,
        accented: isQuickBurstBeat || rawEnergy >= 0.65 || b % 8 === 0,
        energy,
      });

      prevGapY = gapCenterY;
      prevGateTime = t;
    } else {
      // Place collectible Beat Notes aligned with intermediate beats / detected onsets along the flight path
      const noteY = Math.round(
        Math.max(HIGH_SKY_MIN_Y + 40, Math.min(PLAYFIELD_BOTTOM - 70, prevGapY - 12)),
      );
      notes.push({
        id: noteId++,
        time: t,
        y: noteY,
        radius: 17,
        collected: false,
        missed: false,
        isHazard: false,
        beatIndex: b,
      });

      // In Boss Battle mode, periodically place a clearly marked discordant red "Wrong Note"
      if (gameMode === 'boss' && b % 4 === 3) {
        const hazardOffset = noteY > 180 ? -125 : 125;
        const hazardY = Math.round(
          Math.max(HIGH_SKY_MIN_Y + 35, Math.min(PLAYFIELD_BOTTOM - 62, noteY + hazardOffset)),
        );
        notes.push({
          id: noteId++,
          time: t,
          y: hazardY,
          radius: 16,
          collected: false,
          missed: false,
          isHazard: true,
          beatIndex: b,
        });
      }
    }
  }

  // Also add extra onset-synced golden Beat Notes for imported MP3s when a strong onset sits between gates
  if (analysis.onsetTimes.length > 0 && gates.length >= 2) {
    let gIdx = 0;
    for (const onsetT of analysis.onsetTimes) {
      if (onsetT < leadInSec + 0.2 || onsetT > endCutoff - 0.3) continue;
      while (gIdx < gates.length - 1 && gates[gIdx + 1].time < onsetT) {
        gIdx++;
      }
      const g0 = gates[gIdx];
      const g1 = gates[Math.min(gates.length - 1, gIdx + 1)];
      // Skip if onset is right inside a gate pillar or already has a note nearby
      if (Math.abs(onsetT - g0.time) < 0.16 || Math.abs(onsetT - g1.time) < 0.16) continue;
      const alreadyHasNote = notes.some((n) => Math.abs(n.time - onsetT) < 0.22);
      if (alreadyHasNote) continue;

      const span = Math.max(0.01, g1.time - g0.time);
      const frac = Math.max(0, Math.min(1, (onsetT - g0.time) / span));
      const interpY = Math.round(g0.gapCenterY + (g1.gapCenterY - g0.gapCenterY) * frac);
      notes.push({
        id: noteId++,
        time: onsetT,
        y: Math.max(HIGH_SKY_MIN_Y + 40, Math.min(PLAYFIELD_BOTTOM - 70, interpY)),
        radius: 15,
        collected: false,
        missed: false,
        isHazard: false,
        beatIndex: g0.beatIndex,
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
