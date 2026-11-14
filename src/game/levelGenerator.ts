import { PLAYFIELD_BOTTOM, PLAYFIELD_TOP } from './physics';
import type { AudioAnalysisResult, CollectibleNote, GameMode, LevelChart, ObstacleGate } from './types';

export interface LevelGenOptions {
  leadInSec?: number;
  seed?: number;
  gameMode?: GameMode;
}

const MIN_GAP_CENTER = PLAYFIELD_TOP + 152;
const MAX_GAP_CENTER = PLAYFIELD_BOTTOM - 148;
const MAX_CONSECUTIVE_DELTA_Y = 165;

/**
 * Generates a rhythm-locked Flappy level chart from an audio analysis result.
 * Guarantees physical reachability between consecutive gates and an approachable opening lead-in.
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

  // Scroll speed scales gently with BPM so beat spacing remains readable (~150-190 world units/beat)
  const scrollSpeed = Math.round(235 + (bpm - 80) * 1.15);

  const beatTimes =
    analysis.beatTimes.length > 0
      ? analysis.beatTimes
      : buildUniformBeats(analysis.firstBeatSec, analysis.durationSec, beatPeriod);

  // Place gates every 2 beats for standard tempos, or every 3 beats at ultra-fast tempos (>=148 BPM)
  const gateBeatStep = bpm >= 148 ? 3 : 2;
  const gates: ObstacleGate[] = [];
  const notes: CollectibleNote[] = [];

  let prevGapY = 320;
  let gateId = 1;
  let noteId = 1;

  // Stop spawning new obstacles within the final 1.6s of the song so the finale feels triumphant
  const endCutoff = Math.max(leadInSec + 1, analysis.durationSec - 1.6);

  for (let b = 0; b < beatTimes.length; b++) {
    const t = beatTimes[b];
    if (t < leadInSec || t > endCutoff) continue;

    const energy = analysis.energyPerBeat[b] ?? 0.5;
    const isGateBeat = b % gateBeatStep === 0;

    // In calm low-energy intros/breakdowns (energy < 0.18), skip every other gate to give musical breathing room
    const skipForCalmVerse =
      isGateBeat && energy < 0.18 && (b / gateBeatStep) % 2 === 1 && gates.length > 1;

    if (isGateBeat && !skipForCalmVerse) {
      // Deterministic melodic target height driven by energy + harmonic sine motion + pseudo-random hash
      const wave = Math.sin(b * 0.55 + seed * 0.13) * 0.5 + 0.5; // 0..1
      const hash = pseudoRand(seed + b * 37);
      const blend = wave * 0.55 + hash * 0.3 + energy * 0.15;
      const rawTargetY = MIN_GAP_CENTER + blend * (MAX_GAP_CENTER - MIN_GAP_CENTER);

      // Clamp vertical travel between consecutive gates so the cat can always reach it smoothly
      const clampedDelta = Math.max(
        -MAX_CONSECUTIVE_DELTA_Y,
        Math.min(MAX_CONSECUTIVE_DELTA_Y, rawTargetY - prevGapY),
      );
      const gapCenterY = Math.round(
        Math.max(MIN_GAP_CENTER, Math.min(MAX_GAP_CENTER, prevGapY + clampedDelta)),
      );

      // Higher energy sections tighten gap slightly (still fair: 170..216 world units)
      const gapHeight = Math.round(214 - energy * 40);

      gates.push({
        id: gateId++,
        beatIndex: b,
        time: t,
        gapCenterY,
        gapHeight,
        width: 74,
        passed: false,
        hit: false,
        accented: energy >= 0.65 || b % 8 === 0,
        energy,
      });

      prevGapY = gapCenterY;
    } else if (b % gateBeatStep === 1 || skipForCalmVerse) {
      // Place a collectible Beat Note on intermediate beats, smoothly positioned between gates
      const offsetY = (pseudoRand(seed + b * 91) - 0.5) * 70;
      const noteY = Math.round(
        Math.max(PLAYFIELD_TOP + 70, Math.min(PLAYFIELD_BOTTOM - 70, prevGapY + offsetY)),
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
      // well separated vertically from the golden Beat Note so players must steer around incorrect notes!
      if (gameMode === 'boss' && b % 4 === 3) {
        const hazardOffset = noteY > 320 ? -125 : 125;
        const hazardY = Math.round(
          Math.max(PLAYFIELD_TOP + 62, Math.min(PLAYFIELD_BOTTOM - 62, noteY + hazardOffset)),
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
