import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLevelFromAnalysis } from './levelGenerator';
import type { AudioAnalysisResult } from './types';

test('generateLevelFromAnalysis creates reachable gates synced to beats after lead-in', () => {
  const bpm = 120;
  const beatTimes: number[] = [];
  const energyPerBeat: number[] = [];
  const onsetTimes: number[] = [];
  for (let i = 0; i < 60; i++) {
    const t = Number((0.2 + i * 0.5).toFixed(4));
    beatTimes.push(t);
    const e = i >= 16 && i <= 36 ? 0.85 : 0.25;
    energyPerBeat.push(e);
    onsetTimes.push(t);
    if (i >= 16 && i <= 36) {
      onsetTimes.push(Number((t + 0.25).toFixed(4)));
    }
  }

  const analysis: AudioAnalysisResult = {
    bpm,
    firstBeatSec: 0.2,
    beatTimes,
    onsetTimes,
    energyPerBeat,
    durationSec: 30,
  };

  const chart = generateLevelFromAnalysis(analysis, { leadInSec: 2.6, seed: 42 });
  assert.ok(chart.gates.length >= 10);
  assert.ok(chart.notes.length >= 5);

  // Lead-in guarantee
  assert.ok(chart.gates[0].time >= 2.6);

  // High-energy / dense-onset chorus should allow gates to spawn higher up in unconstrained sky
  const minGapY = Math.min(...chart.gates.map((g) => g.gapCenterY));
  assert.ok(minGapY < 100, `Expected high-sky gates (<100), got minGapY=${minGapY}`);

  // Reachability guarantee proportional to dt between consecutive gates
  for (let i = 1; i < chart.gates.length; i++) {
    const dt = chart.gates[i].time - chart.gates[i - 1].time;
    const dy = chart.gates[i].gapCenterY - chart.gates[i - 1].gapCenterY; // negative = climb
    assert.ok(dy >= -140 * dt - 5, `Climb too steep: dy=${dy} in dt=${dt}`);
    assert.ok(dy <= 240 * dt + 5, `Drop too steep: dy=${dy} in dt=${dt}`);
    assert.ok(chart.gates[i].gapHeight >= 168 && chart.gates[i].gapHeight <= 225);
  }
});
