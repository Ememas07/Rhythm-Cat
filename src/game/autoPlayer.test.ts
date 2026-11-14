import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoPilotState, decideAutoPlayJump } from './autoPlayer';
import { generateLevelFromAnalysis } from './levelGenerator';
import {
  applyCatJump,
  checkGateCollision,
  createInitialCatState,
  stepCatPhysics,
} from './physics';
import { computeAccuracyPercent, evaluateBeatJump } from './rhythmJudge';
import { BUILTIN_TRACKS, buildSynthTrackAnalysis } from './tracks';
import type { AudioAnalysisResult, DifficultyLevel, LevelChart } from './types';

function simulateAutoRun(chart: LevelChart, difficulty: DifficultyLevel) {
  const catX = 240;
  const cat = createInitialCatState(catX);
  const pilot = createAutoPilotState();

  const dt = 1 / 60;
  const totalSteps = Math.floor((chart.durationSec - 0.5) / dt);
  let gateHits = 0;
  let groundTouches = 0;
  let perfect = 0;
  let good = 0;
  let offbeat = 0;
  let combo = 0;
  let hasJumped = false;

  for (let step = 1; step <= totalSteps; step++) {
    const t = step * dt;

    if (decideAutoPlayJump(pilot, cat, catX, t, chart, null, difficulty)) {
      hasJumped = true;
      const res = evaluateBeatJump(
        t,
        chart.bpm,
        chart.firstBeatSec,
        combo,
        chart.beatTimes,
        difficulty,
      );
      combo = res.nextCombo;
      if (res.tier === 'PERFECT') perfect++;
      else if (res.tier === 'GOOD') good++;
      else offbeat++;
      applyCatJump(cat, res.boostScale);
    }

    const firstGateTime = chart.gates[0]?.time ?? 2.6;
    const isIntroGrace = !hasJumped && t < firstGateTime - 0.8;
    const bounds = stepCatPhysics(cat, dt, catX, chart.scrollSpeed, isIntroGrace);
    if (bounds.touchedBounds === 'ground') {
      groundTouches++;
    }

    for (const gate of chart.gates) {
      if (gate.hit) continue;
      const gateX = catX + (gate.time - t) * chart.scrollSpeed;
      if (gateX + gate.width / 2 < catX - 90 || gateX - gate.width / 2 > catX + 40) continue;
      if (checkGateCollision(cat, gate, gateX)) {
        gate.hit = true;
        gateHits++;
      }
    }
  }

  return {
    gateHits,
    groundTouches,
    perfect,
    good,
    offbeat,
    accuracyPct: computeAccuracyPercent(perfect, good, offbeat),
  };
}

test('autoPlayer flies through all built-in tracks cleanly across all difficulties', () => {
  for (const track of BUILTIN_TRACKS) {
    const analysis = buildSynthTrackAnalysis(track);
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const chart = generateLevelFromAnalysis(analysis, {
        difficulty,
        seed: track.id.length * 97 + Math.round(track.bpm),
      });
      const res = simulateAutoRun(chart, difficulty);
      assert.equal(
        res.gateHits,
        0,
        `Expected 0 gate hits on ${track.id} (${difficulty}), got ${res.gateHits}`,
      );
      assert.equal(
        res.groundTouches,
        0,
        `Expected 0 ground touches on ${track.id} (${difficulty}), got ${res.groundTouches}`,
      );
      assert.ok(
        res.accuracyPct >= 80,
        `Expected >=80% beat accuracy on ${track.id} (${difficulty}), got ${res.accuracyPct}%`,
      );
      assert.ok(
        res.offbeat <= 1,
        `Expected <=1 offbeat jumps on ${track.id} (${difficulty}), got ${res.offbeat}`,
      );
    }
  }
});

test('autoPlayer clears high-BPM custom MP3 chart with dense onsets and staircase climbs', () => {
  const bpm = 152;
  const period = 60 / bpm;
  const beatTimes: number[] = [];
  const onsetTimes: number[] = [];
  const energyPerBeat: number[] = [];
  for (let i = 0; i < 80; i++) {
    const t = Number((0.15 + i * period).toFixed(4));
    beatTimes.push(t);
    const highEnergy = i >= 12 && i <= 44;
    energyPerBeat.push(highEnergy ? 0.9 : 0.35);
    onsetTimes.push(t);
    if (highEnergy) onsetTimes.push(Number((t + period * 0.5).toFixed(4)));
  }

  const analysis: AudioAnalysisResult = {
    bpm,
    firstBeatSec: 0.15,
    beatTimes,
    onsetTimes,
    energyPerBeat,
    durationSec: 0.15 + 80 * period,
  };

  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    const chart = generateLevelFromAnalysis(analysis, { difficulty, seed: 777 });
    const res = simulateAutoRun(chart, difficulty);
    assert.equal(
      res.gateHits,
      0,
      `Expected 0 gate hits on synthetic 152-BPM MP3 (${difficulty}), got ${res.gateHits}`,
    );
    assert.equal(res.groundTouches, 0);
  }
});
