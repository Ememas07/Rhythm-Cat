import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCatJump,
  checkGateCollision,
  checkNoteCollect,
  createInitialCatState,
  PLAYFIELD_BOTTOM,
  resolveLivesAfterHit,
  stepCatPhysics,
} from './physics';
import type { CollectibleNote, ObstacleGate } from './types';

test('resolveLivesAfterHit preserves lives in infinite mode and ends run when depleted otherwise', () => {
  assert.deepEqual(resolveLivesAfterHit(3, 'infinite'), { nextLives: 3, isGameOver: false });
  assert.deepEqual(resolveLivesAfterHit(3, 'lives'), { nextLives: 2, isGameOver: false });
  assert.deepEqual(resolveLivesAfterHit(1, 'sudden-death'), { nextLives: 0, isGameOver: true });
});

test('sausage cat survives intro grace period without user input', () => {
  const cat = createInitialCatState(240);
  for (let i = 0; i < 180; i++) {
    const { touchedBounds } = stepCatPhysics(cat, 1 / 60, 240, 280, true);
    assert.equal(touchedBounds, null);
  }
  assert.ok(cat.y > 100 && cat.y < PLAYFIELD_BOTTOM - 40);
  assert.equal(cat.spine.length, 6);
});

test('applyCatJump propels cat upward and 4 quick beat jumps climb freely into upper sky', () => {
  const cat = createInitialCatState(240);
  const startY = cat.y;
  applyCatJump(cat, 1.06);
  assert.ok(cat.vy < -400);
  assert.ok(cat.squashY > 1);
  stepCatPhysics(cat, 1 / 60, 240, 280, false);
  assert.ok(cat.y < startY);

  // Simulate 4 quick consecutive on-beat jumps (every 0.5s at 120 BPM)
  for (let beat = 0; beat < 4; beat++) {
    applyCatJump(cat, 1.06);
    for (let f = 0; f < 30; f++) {
      const { touchedBounds } = stepCatPhysics(cat, 1 / 60, 240, 280, false);
      assert.equal(touchedBounds, null);
    }
  }
  // Should have climbed high above startY without hitting any artificial ceiling
  assert.ok(cat.y < 120, `Expected high climb, got y=${cat.y}`);
});

test('checkGateCollision detects hits on pipe pillars and allows clean pass through gap', () => {
  const cat = createInitialCatState(240);
  cat.y = 320;
  for (const node of cat.spine) {
    node.y = 320;
  }

  const clearGate: ObstacleGate = {
    id: 1,
    beatIndex: 4,
    time: 2.0,
    gapCenterY: 320,
    gapHeight: 190,
    width: 74,
    passed: false,
    hit: false,
    accented: false,
    energy: 0.5,
  };
  assert.equal(checkGateCollision(cat, clearGate, 240), false);

  const blockingGate: ObstacleGate = {
    ...clearGate,
    gapCenterY: 140,
    gapHeight: 160,
  };
  assert.equal(checkGateCollision(cat, blockingGate, 240), true);
});

test('checkNoteCollect detects sausage cat intersection with beat note', () => {
  const cat = createInitialCatState(240);
  const note: CollectibleNote = {
    id: 1,
    time: 2.5,
    y: 310,
    radius: 17,
    collected: false,
    missed: false,
    isHazard: false,
    beatIndex: 5,
  };
  assert.equal(checkNoteCollect(cat, note, 240), true);
  assert.equal(checkNoteCollect(cat, note, 420), false);
});
