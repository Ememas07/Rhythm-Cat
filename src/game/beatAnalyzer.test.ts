import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAudioSamples } from './beatAnalyzer';

function createSyntheticBeatBuffer(bpm: number, durationSec: number, sampleRate: number): Float32Array {
  const totalSamples = Math.floor(durationSec * sampleRate);
  const buf = new Float32Array(totalSamples);
  const beatPeriod = 60 / bpm;

  for (let t = 0.2; t < durationSec - 0.1; t += beatPeriod) {
    const startSample = Math.floor(t * sampleRate);
    const pulseSamples = Math.floor(0.08 * sampleRate);
    for (let i = 0; i < pulseSamples && startSample + i < totalSamples; i++) {
      const env = Math.exp(-i / (0.02 * sampleRate));
      const freq = 90 - 40 * (i / pulseSamples);
      buf[startSample + i] += env * Math.sin((2 * Math.PI * freq * i) / sampleRate);
    }
  }
  return buf;
}

test('analyzeAudioSamples detects 120 BPM from synthetic pulse train', () => {
  const sampleRate = 22050;
  const samples = createSyntheticBeatBuffer(120, 12, sampleRate);
  const result = analyzeAudioSamples(samples, sampleRate);

  assert.ok(Math.abs(result.bpm - 120) <= 2, `Expected ~120 BPM, got ${result.bpm}`);
  assert.ok(result.beatTimes.length >= 20);
  assert.ok(result.onsetTimes.length >= 10);
  assert.equal(result.beatTimes.length, result.energyPerBeat.length);
});

test('analyzeAudioSamples detects 96 BPM from synthetic pulse train', () => {
  const sampleRate = 22050;
  const samples = createSyntheticBeatBuffer(96, 14, sampleRate);
  const result = analyzeAudioSamples(samples, sampleRate);

  assert.ok(Math.abs(result.bpm - 96) <= 3, `Expected ~96 BPM, got ${result.bpm}`);
});

test('analyzeAudioSamples handles silent audio safely without NaN', () => {
  const silent = new Float32Array(44100 * 5);
  const result = analyzeAudioSamples(silent, 44100);
  assert.equal(Number.isFinite(result.bpm), true);
  assert.ok(result.beatTimes.length > 0);
});
