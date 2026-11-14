import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLevelFromAnalysis } from './levelGenerator';
import type { AudioAnalysisResult } from './types';

test('generateLevelFromAnalysis creates reachable gates synced to beats after lead-in', () => {
  const bpm = 120;
  const beatTimes: number[] = [];
  const energyPerBeat: number[] = [];
  for (let i = 0; i < 60; i++) {
    beatTimes.push(Number((0.2 + i * 0.5).toFixed(4)));
    energyPerBeat.push((i % 8) / 7);
  }

  const analysis: AudioAnalysisResult = {
    bpm,
    firstBeatSec: 0.2,
    beatTimes,
    onsetTimes: beatTimes,
    energyPerBeat,
    durationSec: 30,
  };

  const chart = generateLevelFromAnalysis(analysis, { leadInSec: 2.6, seed: 42 });
  assert.ok(chart.gates.length >= 10);
  assert.ok(chart.notes.length >= 5);

  // Lead-in guarantee
  assert.ok(chart.gates[0].time >= 2.6);

  // Reachability guarantee between consecutive gates
  for (let i = 1; i < chart.gates.length; i++) {
    const dy = Math.abs(chart.gates[i].gapCenterY - chart.gates[i - 1].gapCenterY);
    assert.ok(dy <= 165, `Consecutive gate gap jump too large: ${dy}`);
    assert.ok(chart.gates[i].gapHeight >= 168 && chart.gates[i].gapHeight <= 220);
  }
});
