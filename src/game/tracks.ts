import type { AudioAnalysisResult, SynthTrackConfig } from './types';

export const BUILTIN_TRACKS: SynthTrackConfig[] = [
  {
    kind: 'synth',
    id: 'midnight-loaf',
    title: 'Midnight Loaf',
    subtitle: 'Chill Rooftop Groove',
    bpm: 96,
    durationSec: 46,
    accentColor: '#FFB830',
    keyRootMidi: 48, // C3
    scaleIntervals: [0, 2, 4, 7, 9, 12, 14, 16],
    bassPattern: [0, -1, 3, -1, 4, -1, 2, -1],
    leadPattern: [4, 5, 6, 4, 7, 6, 5, 2],
    recommendedBoss: 'metronome',
  },
  {
    kind: 'synth',
    id: 'alley-strut',
    title: 'Alley Strut',
    subtitle: 'Funky Midnight Bounce',
    bpm: 116,
    durationSec: 54,
    accentColor: '#FF6B4A',
    keyRootMidi: 45, // A2
    scaleIntervals: [0, 3, 5, 7, 10, 12, 15, 17],
    bassPattern: [0, 0, 2, -1, 3, 4, 2, -1],
    leadPattern: [5, 7, 6, 4, 5, 3, 4, 2],
    recommendedBoss: 'hairball',
  },
  {
    kind: 'synth',
    id: 'zoomies-3am',
    title: 'Zoomies at 3AM',
    subtitle: 'Fast Arcade Dash',
    bpm: 136,
    durationSec: 58,
    accentColor: '#38BDF8',
    keyRootMidi: 50, // D3
    scaleIntervals: [0, 2, 3, 5, 7, 10, 12, 14],
    bassPattern: [0, 0, 4, 4, 3, 3, 5, 2],
    leadPattern: [7, 5, 6, 4, 7, 6, 5, 4],
    recommendedBoss: 'maestro',
  },
];

export function buildSynthTrackAnalysis(track: SynthTrackConfig): AudioAnalysisResult {
  const period = 60 / track.bpm;
  const firstBeatSec = 0.25;
  const beatTimes: number[] = [];
  const energyPerBeat: number[] = [];

  let idx = 0;
  for (let t = firstBeatSec; t < track.durationSec - 0.1; t += period) {
    beatTimes.push(Number(t.toFixed(4)));
    // Dynamic phrasing: intro (0..7) is calm, middle builds, chorus sections peak
    const bar = Math.floor(idx / 4);
    let energy = 0.45;
    if (bar < 2) energy = 0.22;
    else if (bar % 4 === 2 || bar % 4 === 3) energy = 0.78;
    else energy = 0.48;
    if (idx % 4 === 0) energy = Math.min(1, energy + 0.12);
    energyPerBeat.push(energy);
    idx++;
  }

  return {
    bpm: track.bpm,
    firstBeatSec,
    beatTimes,
    onsetTimes: beatTimes,
    energyPerBeat,
    durationSec: track.durationSec,
  };
}
