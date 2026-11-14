import type { AudioAnalysisResult } from './types';

const MIN_BPM = 72;
const MAX_BPM = 172;
const FRAME_RATE_HZ = 86; // ~11.6ms per frame

/**
 * Pure PCM audio analyzer that extracts BPM, beat phase, beat timestamps,
 * local energy contour, and prominent onset peaks from raw audio samples.
 */
export function analyzeAudioSamples(
  samples: Float32Array,
  sampleRate: number,
): AudioAnalysisResult {
  const safeSampleRate = Math.max(8000, sampleRate);
  const durationSec = samples.length / safeSampleRate;

  if (samples.length === 0 || durationSec < 1.0) {
    return createFallbackAnalysis(Math.max(1, durationSec));
  }

  const hopSize = Math.max(64, Math.round(safeSampleRate / FRAME_RATE_HZ));
  const frameCount = Math.floor(samples.length / hopSize);
  if (frameCount < 16) {
    return createFallbackAnalysis(durationSec);
  }

  // 1-pole low-pass filter (~180 Hz) to emphasize kick/bass pulses
  const dt = 1 / safeSampleRate;
  const rc = 1 / (2 * Math.PI * 180);
  const alpha = dt / (rc + dt);

  const energy = new Float32Array(frameCount);
  let lp = 0;
  let maxEnergy = 0;

  for (let f = 0; f < frameCount; f++) {
    const start = f * hopSize;
    const end = Math.min(samples.length, start + hopSize);
    let sumFull = 0;
    let sumBass = 0;
    const len = end - start;
    for (let i = start; i < end; i++) {
      const s = samples[i];
      lp = lp + alpha * (s - lp);
      sumFull += s * s;
      sumBass += lp * lp;
    }
    const rmsFull = Math.sqrt(sumFull / len);
    const rmsBass = Math.sqrt(sumBass / len);
    const combined = rmsBass * 0.65 + rmsFull * 0.35;
    energy[f] = combined;
    if (combined > maxEnergy) maxEnergy = combined;
  }

  if (maxEnergy < 1e-5) {
    return createFallbackAnalysis(durationSec);
  }

  // Normalize energy 0..1
  for (let f = 0; f < frameCount; f++) {
    energy[f] /= maxEnergy;
  }

  // Log-compressed positive spectral/energy flux (onset strength envelope)
  const flux = new Float32Array(frameCount);
  let meanFlux = 0;
  for (let f = 1; f < frameCount; f++) {
    const diff = Math.log1p(14 * energy[f]) - Math.log1p(14 * energy[f - 1]);
    const pos = diff > 0 ? diff : 0;
    flux[f] = pos;
    meanFlux += pos;
  }
  meanFlux /= frameCount;

  // Subtract local moving average to sharpen transient peaks
  const onset = new Float32Array(frameCount);
  const halfWin = 6;
  let maxOnset = 0;
  for (let f = 0; f < frameCount; f++) {
    let localSum = 0;
    let count = 0;
    const lo = Math.max(0, f - halfWin);
    const hi = Math.min(frameCount - 1, f + halfWin);
    for (let k = lo; k <= hi; k++) {
      localSum += flux[k];
      count++;
    }
    const val = Math.max(0, flux[f] - (localSum / count) * 1.05 - meanFlux * 0.15);
    onset[f] = val;
    if (val > maxOnset) maxOnset = val;
  }

  if (maxOnset < 1e-6) {
    return createFallbackAnalysis(durationSec);
  }
  for (let f = 0; f < frameCount; f++) {
    onset[f] /= maxOnset;
  }

  // Autocorrelation over BPM range [MIN_BPM, MAX_BPM]
  const effectiveFrameRate = safeSampleRate / hopSize;
  const minLag = Math.max(4, Math.floor((60 * effectiveFrameRate) / MAX_BPM));
  const maxLag = Math.min(
    Math.floor(frameCount / 2),
    Math.ceil((60 * effectiveFrameRate) / MIN_BPM),
  );

  if (maxLag <= minLag) {
    return createFallbackAnalysis(durationSec);
  }

  let bestLag = Math.round((60 * effectiveFrameRate) / 115);
  let bestScore = -1;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    const n = frameCount - lag;
    for (let i = 0; i < n; i++) {
      corr += onset[i] * onset[i + lag];
    }
    corr /= Math.max(1, n);

    // Check harmonic reinforcement (2x lag = half-tempo / bar confirmation)
    const doubleLag = lag * 2;
    let harmonic = 0;
    if (doubleLag < frameCount - 8) {
      const m = frameCount - doubleLag;
      for (let i = 0; i < m; i++) {
        harmonic += onset[i] * onset[i + doubleLag];
      }
      harmonic /= Math.max(1, m);
    }

    const candidateBpm = (60 * effectiveFrameRate) / lag;
    // Gentle Gaussian prior around 116 BPM to avoid octave-doubling/halving bias
    const octaveBias = Math.exp(-Math.pow(Math.log2(candidateBpm / 116), 2) / (2 * 0.45 * 0.45));
    const score = (corr * 0.78 + harmonic * 0.22) * (0.72 + 0.28 * octaveBias);

    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  const rawBpm = (60 * effectiveFrameRate) / bestLag;
  const bpm = Math.round(Math.max(MIN_BPM, Math.min(MAX_BPM, rawBpm)));
  const beatPeriodSec = 60 / bpm;
  const refinedLag = Math.max(2, Math.round(beatPeriodSec * effectiveFrameRate));

  // Phase alignment: fold onset envelope modulo refinedLag to find strongest downbeat phase
  const phaseHistogram = new Float32Array(refinedLag);
  for (let f = 0; f < frameCount; f++) {
    phaseHistogram[f % refinedLag] += onset[f];
  }
  let bestPhaseBin = 0;
  let bestPhaseWeight = -1;
  for (let b = 0; b < refinedLag; b++) {
    // Small 3-bin smooth for robustness
    const prev = phaseHistogram[(b - 1 + refinedLag) % refinedLag];
    const curr = phaseHistogram[b];
    const next = phaseHistogram[(b + 1) % refinedLag];
    const w = prev * 0.25 + curr * 0.5 + next * 0.25;
    if (w > bestPhaseWeight) {
      bestPhaseWeight = w;
      bestPhaseBin = b;
    }
  }

  const firstBeatSec = (bestPhaseBin / effectiveFrameRate) % beatPeriodSec;

  // Build beat timestamps + per-beat normalized energy
  const beatTimes: number[] = [];
  const energyPerBeat: number[] = [];
  const halfBeatFrames = Math.max(2, Math.round(refinedLag * 0.45));

  for (let t = firstBeatSec; t < durationSec - 0.1; t += beatPeriodSec) {
    beatTimes.push(Number(t.toFixed(4)));
    const centerFrame = Math.round(t * effectiveFrameRate);
    const lo = Math.max(0, centerFrame - halfBeatFrames);
    const hi = Math.min(frameCount - 1, centerFrame + halfBeatFrames);
    let eSum = 0;
    let count = 0;
    for (let k = lo; k <= hi; k++) {
      eSum += energy[k];
      count++;
    }
    energyPerBeat.push(count > 0 ? Math.min(1, eSum / count) : 0.4);
  }

  // Extract prominent onset peaks for bonus note placement
  const onsetTimes: number[] = [];
  const minPeakGapFrames = Math.max(4, Math.round(effectiveFrameRate * 0.16));
  let lastPeakFrame = -minPeakGapFrames;
  for (let f = 1; f < frameCount - 1; f++) {
    if (
      onset[f] > 0.28 &&
      onset[f] >= onset[f - 1] &&
      onset[f] >= onset[f + 1] &&
      f - lastPeakFrame >= minPeakGapFrames
    ) {
      onsetTimes.push(Number((f / effectiveFrameRate).toFixed(4)));
      lastPeakFrame = f;
    }
  }

  return {
    bpm,
    firstBeatSec: Number(firstBeatSec.toFixed(4)),
    beatTimes,
    onsetTimes,
    energyPerBeat,
    durationSec,
  };
}

export function mixAudioBufferToMono(audioBuffer: AudioBuffer): Float32Array {
  const { numberOfChannels, length } = audioBuffer;
  if (numberOfChannels === 1) {
    return audioBuffer.getChannelData(0);
  }
  const mono = new Float32Array(length);
  const inv = 1 / numberOfChannels;
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      mono[i] += channelData[i] * inv;
    }
  }
  return mono;
}

function createFallbackAnalysis(durationSec: number): AudioAnalysisResult {
  const bpm = 110;
  const period = 60 / bpm;
  const beatTimes: number[] = [];
  const energyPerBeat: number[] = [];
  for (let t = 0.25; t < durationSec - 0.1; t += period) {
    beatTimes.push(Number(t.toFixed(4)));
    energyPerBeat.push(0.45);
  }
  return {
    bpm,
    firstBeatSec: 0.25,
    beatTimes,
    onsetTimes: beatTimes,
    energyPerBeat,
    durationSec,
  };
}
