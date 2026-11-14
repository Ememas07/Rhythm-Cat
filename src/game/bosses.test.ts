import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBossState,
  spawnPlayerRhythmBolt,
  stepBossBattle,
  triggerBossAttack,
} from './bosses';
import { createInitialCatState } from './physics';

test('on-beat rhythm bolts damage and defeat a boss', () => {
  const boss = createBossState('metronome', 1200, 48);
  const cat = createInitialCatState(240);
  boss.hp = 20;
  boss.ghostHp = 20;

  spawnPlayerRhythmBolt(boss, 240, cat.y, 'PERFECT', 2, true);
  assert.equal(boss.playerBolts.length, 1);

  let defeated = false;
  for (let i = 0; i < 120; i++) {
    const res = stepBossBattle(boss, cat, 1 / 60, i / 60, 1200);
    if (res.bossJustDefeated) {
      defeated = true;
      break;
    }
  }
  assert.equal(defeated, true);
  assert.equal(boss.isDefeated, true);
  assert.equal(boss.hp, 0);
});

test('offbeat triggers boss attack that enters windup then active phase and hits player', () => {
  const boss = createBossState('hairball', 1000, 56);
  const cat = createInitialCatState(240);
  cat.y = 310;
  for (const n of cat.spine) n.y = 310;

  const attack = triggerBossAttack(boss, cat.y, 'offbeat');
  assert.ok(attack !== null);
  assert.ok(boss.projectiles.length >= 1);
  assert.equal(boss.projectiles[0].phase, 'windup');

  // Step through windup
  for (let i = 0; i < 40; i++) {
    stepBossBattle(boss, cat, 1 / 60, i / 60, 1000);
  }
  assert.equal(boss.projectiles[0].phase, 'active');
});

test('offbeat jump without super note does not fire player bolt', () => {
  const boss = createBossState('maestro', 1000, 60);
  spawnPlayerRhythmBolt(boss, 240, 310, 'OFFBEAT', 1, false);
  assert.equal(boss.playerBolts.length, 0);
});
