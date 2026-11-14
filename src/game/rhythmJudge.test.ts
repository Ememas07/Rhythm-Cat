import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAccuracyPercent,
  evaluateBeatJump,
  getMultiplierForCombo,
  getNearestBeatDeltaSec,
} from './rhythmJudge';

test('getNearestBeatDeltaSec computes signed delta to nearest beat on uniform grid', () => {
  // 120 BPM = 0.5s period, starting at 0.2s -> beats at 0.2, 0.7, 1.2, 1.7
  const resExact = getNearestBeatDeltaSec(1.2, 120, 0.2);
  assert.ok(Math.abs(resExact.deltaSec) < 1e-6);
  assert.equal(resExact.beatIndex, 2);

  const resEarly = getNearestBeatDeltaSec(1.15, 120, 0.2);
  assert.ok(Math.abs(resEarly.deltaSec - -0.05) < 1e-6);

  const resLate = getNearestBeatDeltaSec(1.26, 120, 0.2);
  assert.ok(Math.abs(resLate.deltaSec - 0.06) < 1e-6);
});

test('evaluateBeatJump awards PERFECT, GOOD, and OFFBEAT with combo progression', () => {
  // Exact beat at 0.5s (120 BPM, firstBeat=0)
  const perfect = evaluateBeatJump(0.54, 120, 0, 4);
  assert.equal(perfect.tier, 'PERFECT');
  assert.equal(perfect.nextCombo, 5);
  assert.equal(perfect.multiplier, 2);
  assert.equal(perfect.points, 200);
  assert.ok(perfect.boostScale > 1);

  const good = evaluateBeatJump(0.64, 120, 0, 11);
  assert.equal(good.tier, 'GOOD');
  assert.equal(good.nextCombo, 12);
  assert.equal(good.multiplier, 3);
  assert.equal(good.points, 150);

  const offbeat = evaluateBeatJump(0.75, 120, 0, 15);
  assert.equal(offbeat.tier, 'OFFBEAT');
  assert.equal(offbeat.nextCombo, 0);
  assert.equal(offbeat.multiplier, 1);
  assert.equal(offbeat.points, 0);
});

test('getMultiplierForCombo scales properly at thresholds', () => {
  assert.equal(getMultiplierForCombo(0), 1);
  assert.equal(getMultiplierForCombo(4), 1);
  assert.equal(getMultiplierForCombo(5), 2);
  assert.equal(getMultiplierForCombo(12), 3);
  assert.equal(getMultiplierForCombo(24), 4);
});

test('computeAccuracyPercent calculates weighted rhythm accuracy', () => {
  assert.equal(computeAccuracyPercent(0, 0, 0), 100);
  assert.equal(computeAccuracyPercent(10, 0, 0), 100);
  assert.equal(computeAccuracyPercent(0, 0, 10), 0);
  assert.equal(computeAccuracyPercent(5, 5, 0), 83);
});
