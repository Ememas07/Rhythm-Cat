import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAccuracyPercent,
  evaluateBeatJump,
  evaluateRhythmOnlyTap,
  findNextMissedBeatIndex,
  getBeatTimingWindows,
  getMultiplierForCombo,
  getNearestBeatDeltaSec,
  shouldCountRunScore,
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

test('getBeatTimingWindows and evaluateBeatJump scale across easy, normal, hard', () => {
  const easyWin = getBeatTimingWindows('easy');
  const normalWin = getBeatTimingWindows('normal');
  const hardWin = getBeatTimingWindows('hard');
  assert.ok(easyWin.perfectSec > normalWin.perfectSec && normalWin.perfectSec > hardWin.perfectSec);
  assert.ok(easyWin.goodSec > normalWin.goodSec && normalWin.goodSec > hardWin.goodSec);

  // 110ms offset is PERFECT on Easy, GOOD on Normal, GOOD on Hard
  assert.equal(evaluateBeatJump(0.61, 120, 0, 0, undefined, 'easy').tier, 'PERFECT');
  assert.equal(evaluateBeatJump(0.61, 120, 0, 0, undefined, 'normal').tier, 'GOOD');
  // 155ms offset is GOOD on Normal, OFFBEAT on Hard
  assert.equal(evaluateBeatJump(0.655, 120, 0, 0, undefined, 'normal').tier, 'GOOD');
  assert.equal(evaluateBeatJump(0.655, 120, 0, 0, undefined, 'hard').tier, 'OFFBEAT');
});

test('shouldCountRunScore enforces infinite hit limit and excludes Auto Mode', () => {
  assert.equal(shouldCountRunScore('lives', 2, false), true);
  assert.equal(shouldCountRunScore('sudden-death', 1, false), true);
  assert.equal(shouldCountRunScore('infinite', 0, false), true);
  assert.equal(shouldCountRunScore('infinite', 3, false), true);
  assert.equal(shouldCountRunScore('infinite', 4, false), false);
  assert.equal(shouldCountRunScore('lives', 0, true), false);
  assert.equal(shouldCountRunScore('infinite', 0, true), false);
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

test('shouldCountRunScore excludes Rhythm-Only mode alongside Auto mode', () => {
  assert.equal(shouldCountRunScore('lives', 0, false, true), false);
  assert.equal(shouldCountRunScore('infinite', 0, false, true), false);
  assert.equal(shouldCountRunScore('lives', 0, false, false), true);
});

test('evaluateRhythmOnlyTap judges beats accurately and prevents double-tapping the same beat', () => {
  // 120 BPM = 0.5s period, beat 2 at 1.0s
  const firstTap = evaluateRhythmOnlyTap(1.02, 120, 0, 4, 1, undefined, 'normal');
  assert.equal(firstTap.tier, 'PERFECT');
  assert.equal(firstTap.beatIndex, 2);
  assert.equal(firstTap.isDuplicateBeatTap, false);
  assert.equal(firstTap.nextCombo, 5);
  assert.equal(firstTap.points, 200);

  // Tapping again inside beat 2's window should register as duplicate OFFBEAT
  const doubleTap = evaluateRhythmOnlyTap(1.06, 120, 0, 5, firstTap.beatIndex, undefined, 'normal');
  assert.equal(doubleTap.tier, 'OFFBEAT');
  assert.equal(doubleTap.isDuplicateBeatTap, true);
  assert.equal(doubleTap.nextCombo, 0);
  assert.equal(doubleTap.points, 0);
});

test('findNextMissedBeatIndex detects unclicked expired beats after intro grace and skips tapped beats', () => {
  // 120 BPM (beats every 0.5s starting at 0): beats at 0, 0.5, 1.0, 1.5, 2.0, 2.5
  // rhythmStartTime = 1.4 -> first active beat is index 3 (t = 1.5s)
  // normal goodSec = 0.175s, cutoff margin 0.015s -> beat 3 expires after 1.69s
  assert.equal(
    findNextMissedBeatIndex({
      songTime: 1.65,
      bpm: 120,
      firstBeatSec: 0,
      difficulty: 'normal',
      rhythmStartTime: 1.4,
      lastTappedBeatIndex: -999,
      lastMissedBeatIndex: -999,
    }),
    null,
  );

  // At t = 1.72s, beat 3 (1.5s) has expired without a tap
  assert.equal(
    findNextMissedBeatIndex({
      songTime: 1.72,
      bpm: 120,
      firstBeatSec: 0,
      difficulty: 'normal',
      rhythmStartTime: 1.4,
      lastTappedBeatIndex: -999,
      lastMissedBeatIndex: -999,
    }),
    3,
  );

  // If beat 3 was tapped, it is not reported as missed
  assert.equal(
    findNextMissedBeatIndex({
      songTime: 1.72,
      bpm: 120,
      firstBeatSec: 0,
      difficulty: 'normal',
      rhythmStartTime: 1.4,
      lastTappedBeatIndex: 3,
      lastMissedBeatIndex: -999,
    }),
    null,
  );

  // Works with explicit beatTimes array too
  const beatTimes = [0.2, 0.7, 1.2, 1.7, 2.2];
  assert.equal(
    findNextMissedBeatIndex({
      songTime: 1.95,
      bpm: 120,
      firstBeatSec: 0.2,
      beatTimes,
      difficulty: 'normal',
      rhythmStartTime: 1.1,
      lastTappedBeatIndex: 2,
      lastMissedBeatIndex: -999,
    }),
    3,
  );
});
