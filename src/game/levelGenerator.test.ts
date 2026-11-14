import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLevelFromAnalysis } from './levelGenerator';
import { PLAYFIELD_BOTTOM } from './physics';
import type { AudioAnalysisResult } from './types';

function makeSyntheticAnalysis(bpm = 120, beats = 60): AudioAnalysisResult {
  const period = 60 / bpm;
  const beatTimes: number[] = [];
  const energyPerBeat: number[] = [];
  const onsetTimes: number[] = [];
  for (let i = 0; i < beats; i++) {
    const t = Number((0.2 + i * period).toFixed(4));
    beatTimes.push(t);
    const e = i >= 16 && i <= 36 ? 0.85 : 0.25;
    energyPerBeat.push(e);
    onsetTimes.push(t);
    if (i >= 16 && i <= 36) {
      onsetTimes.push(Number((t + period * 0.5).toFixed(4)));
    }
  }
  return {
    bpm,
    firstBeatSec: 0.2,
    beatTimes,
    onsetTimes,
    energyPerBeat,
    durationSec: 0.2 + beats * period,
  };
}

test('generateLevelFromAnalysis creates reachable gates synced to beats after lead-in', () => {
  const analysis = makeSyntheticAnalysis(120, 60);
  const chart = generateLevelFromAnalysis(analysis, {
    leadInSec: 2.6,
    seed: 42,
    difficulty: 'normal',
  });
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
    assert.ok(dy >= -130 * dt - 4, `Climb too steep: dy=${dy} in dt=${dt}`);
    assert.ok(dy <= 210 * dt + 4, `Drop too steep: dy=${dy} in dt=${dt}`);
    assert.ok(chart.gates[i].gapHeight >= 192 && chart.gates[i].gapHeight <= 246);
  }
});

test('difficulty levels scale gap width, scroll speed, and cadence cleanly', () => {
  const analysis = makeSyntheticAnalysis(145, 72);
  const easy = generateLevelFromAnalysis(analysis, { difficulty: 'easy', seed: 9 });
  const normal = generateLevelFromAnalysis(analysis, { difficulty: 'normal', seed: 9 });
  const hard = generateLevelFromAnalysis(analysis, { difficulty: 'hard', seed: 9 });

  assert.ok(easy.scrollSpeed < normal.scrollSpeed);
  assert.ok(normal.scrollSpeed < hard.scrollSpeed);

  const avgGap = (c: typeof easy) =>
    c.gates.reduce((s, g) => s + g.gapHeight, 0) / Math.max(1, c.gates.length);
  assert.ok(avgGap(easy) > avgGap(normal));
  assert.ok(avgGap(normal) > avgGap(hard));
});

test('collectible golden notes never spawn inside pipe walls or unreachable corridors', () => {
  const analysis = makeSyntheticAnalysis(152, 80);
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    const chart = generateLevelFromAnalysis(analysis, {
      difficulty,
      gameMode: 'boss',
      seed: 123,
    });
    const golden = chart.notes.filter((n) => !n.isHazard);
    assert.ok(golden.length > 0);

    for (const note of golden) {
      assert.ok(note.y >= -520 && note.y <= PLAYFIELD_BOTTOM - 64);
      for (const gate of chart.gates) {
        const horizDistPx = Math.abs(note.time - gate.time) * chart.scrollSpeed;
        assert.ok(
          horizDistPx >= 96,
          `Golden note too close horizontally (${horizDistPx.toFixed(1)}px) to gate on ${difficulty}`,
        );
      }
    }
  }
});
