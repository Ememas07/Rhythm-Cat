import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSkinUnlocks, getSkinById } from './skins';
import type { RunStats } from './types';

function makeStats(overrides: Partial<RunStats> = {}): RunStats {
  return {
    score: 0,
    bestScore: 0,
    combo: 0,
    maxCombo: 0,
    multiplier: 1,
    perfectCount: 0,
    goodCount: 0,
    offbeatCount: 0,
    notesCollected: 0,
    gatesCleared: 0,
    totalGates: 20,
    lives: 3,
    maxLives: 3,
    infiniteLives: false,
    hitsTaken: 0,
    scoreCounted: true,
    difficulty: 'normal',
    autoMode: false,
    rhythmOnlyMode: false,
    accuracyPct: 70,
    victory: false,
    victoryReason: 'defeat',
    trackTitle: 'Midnight Loaf',
    bpm: 96,
    songProgress: 0.5,
    gameMode: 'arcade',
    bossName: null,
    bossHpRemaining: 0,
    bossMaxHp: 0,
    ...overrides,
  };
}

test('evaluateSkinUnlocks grants score, combo, accuracy, and boss skins accurately', () => {
  const res1 = evaluateSkinUnlocks(
    ['marmalade'],
    makeStats({ score: 1200, maxCombo: 12, victory: true, accuracyPct: 88, victoryReason: 'boss-defeated' }),
    'midnight-loaf',
    'metronome',
  );
  assert.ok(res1.newlyUnlocked.includes('tuxedo'));
  assert.ok(res1.newlyUnlocked.includes('calico'));
  assert.ok(res1.newlyUnlocked.includes('mint-choco'));
  assert.ok(res1.newlyUnlocked.includes('baguette'));
  assert.ok(res1.newlyUnlocked.includes('royal'));
  assert.equal(res1.newlyUnlocked.includes('cosmic'), false);

  const res2 = evaluateSkinUnlocks(
    res1.allUnlocked,
    makeStats({ score: 5000, victory: true, victoryReason: 'boss-defeated' }),
    'zoomies-3am',
    'maestro',
  );
  assert.ok(res2.newlyUnlocked.includes('cosmic'));
});

test('evaluateSkinUnlocks grants no skins when scoreCounted is false', () => {
  const res = evaluateSkinUnlocks(
    ['marmalade'],
    makeStats({
      score: 9999,
      maxCombo: 40,
      victory: true,
      accuracyPct: 100,
      victoryReason: 'boss-defeated',
      scoreCounted: false,
      autoMode: true,
    }),
    'zoomies-3am',
    'maestro',
  );
  assert.deepEqual(res.newlyUnlocked, []);
  assert.deepEqual(res.allUnlocked, ['marmalade']);
});

test('getSkinById returns fallback starter skin for unknown ids', () => {
  assert.equal(getSkinById('baguette').accessory, 'butter');
  assert.equal(getSkinById('marmalade').id, 'marmalade');
});
