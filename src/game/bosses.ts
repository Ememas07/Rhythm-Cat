import { CAT_COLLISION_RADIUS, PLAYFIELD_BOTTOM, PLAYFIELD_TOP, circleIntersectsRect } from './physics';
import type {
  BossAttackKind,
  BossDefinition,
  BossId,
  BossProjectile,
  BossRuntimeState,
  CatPhysicsState,
  JudgmentTier,
} from './types';

export const BOSS_ROSTER: Record<BossId, BossDefinition> = {
  metronome: {
    id: 'metronome',
    name: 'Sir Metronome',
    title: 'Clockwork Tempo Owl',
    description: 'Fires pendulum weights and discordant notes when you drift off-beat.',
    baseHp: 180,
    primaryColor: '#D97706',
    accentColor: '#FDE68A',
    attackNames: ['Pendulum Sweep', 'Clockwork Tick'],
  },
  hairball: {
    id: 'hairball',
    name: 'DJ Hairball',
    title: 'Turntable Alley Phantom',
    description: 'Launches spinning vinyl discs and bass-drop waves on missed beats.',
    baseHp: 220,
    primaryColor: '#EC4899',
    accentColor: '#FBCFE8',
    attackNames: ['Vinyl Volley', 'Bass Drop Wave'],
  },
  maestro: {
    id: 'maestro',
    name: 'Maestro Pipe-Organ',
    title: 'Grand Brass Kraken',
    description: 'Blasts telegraphed steam lanes and cacophony spreads on wrong hits.',
    baseHp: 260,
    primaryColor: '#8B5CF6',
    accentColor: '#DDD6FE',
    attackNames: ['Organ Steam Jet', 'Cacophony Spread'],
  },
};

export function createBossState(
  bossId: BossId,
  worldWidth: number,
  songDurationSec: number,
): BossRuntimeState {
  const def = BOSS_ROSTER[bossId];
  // Scale boss HP gently with song length so 45s tracks and 2m+ MP3s both feel balanced
  const durationScale = Math.max(0.85, Math.min(2.2, songDurationSec / 52));
  const maxHp = Math.round((def.baseHp * durationScale) / 10) * 10;

  return {
    id: bossId,
    name: def.name,
    hp: maxHp,
    maxHp,
    ghostHp: maxHp,
    x: Math.max(540, worldWidth - 135),
    y: 310,
    baseY: 310,
    hitFlashTimer: 0,
    koTimer: 0,
    isDefeated: false,
    attackCooldown: 0,
    currentAttackLabel: null,
    attackLabelTimer: 0,
    projectiles: [],
    playerBolts: [],
    nextId: 1,
  };
}

export function spawnPlayerRhythmBolt(
  boss: BossRuntimeState,
  catX: number,
  catY: number,
  tier: JudgmentTier,
  multiplier: number,
  isSuperNote = false,
): void {
  if (boss.isDefeated) return;
  if (tier === 'OFFBEAT' && !isSuperNote) return;

  const baseDamage = isSuperNote ? 20 : tier === 'PERFECT' ? 11 : 6;
  const bonus = Math.min(6, (multiplier - 1) * 2);
  const damage = baseDamage + bonus;

  const dx = boss.x - (catX + 24);
  const dy = boss.y - catY;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const speed = isSuperNote ? 920 : 820;

  boss.playerBolts.push({
    id: boss.nextId++,
    x: catX + 24,
    y: catY,
    targetX: boss.x,
    targetY: boss.y,
    vx: (dx / dist) * speed,
    vy: (dy / dist) * speed,
    damage,
    isSuper: isSuperNote || tier === 'PERFECT',
    active: true,
  });
}

export function triggerBossAttack(
  boss: BossRuntimeState,
  catY: number,
  reason: 'offbeat' | 'missed-note' | 'wrong-note',
): BossAttackKind | null {
  if (boss.isDefeated || boss.attackCooldown > 0) return null;

  // Cap active boss projectiles so screen stays readable & fair
  if (boss.projectiles.length >= 6) return null;

  const clampedCatY = Math.max(PLAYFIELD_TOP + 65, Math.min(PLAYFIELD_BOTTOM - 65, catY));
  let kind: BossAttackKind;

  if (boss.id === 'metronome') {
    kind = reason === 'wrong-note' || boss.nextId % 2 === 0 ? 'pendulum-sweep' : 'cacophony-spread';
    boss.currentAttackLabel = kind === 'pendulum-sweep' ? 'Pendulum Sweep!' : 'Discordant Chime!';
    if (kind === 'pendulum-sweep') {
      boss.projectiles.push({
        id: boss.nextId++,
        kind,
        phase: 'windup',
        windupTimer: 0.45,
        windupDuration: 0.45,
        x: boss.x - 45,
        y: clampedCatY,
        startY: clampedCatY,
        vx: -390,
        vy: 0,
        radius: 20,
        height: 40,
        age: 0,
        amp: 78,
        freq: 4.5,
        active: true,
      });
    } else {
      spawnFanProjectiles(boss, clampedCatY, 2, 360);
    }
  } else if (boss.id === 'hairball') {
    kind = reason === 'missed-note' ? 'bass-wave' : 'vinyl-volley';
    boss.currentAttackLabel = kind === 'bass-wave' ? 'Bass Drop Wave!' : 'Vinyl Saw Volley!';
    if (kind === 'vinyl-volley') {
      const offsets = [-68, 68];
      for (const off of offsets) {
        const py = Math.max(PLAYFIELD_TOP + 55, Math.min(PLAYFIELD_BOTTOM - 55, clampedCatY + off));
        boss.projectiles.push({
          id: boss.nextId++,
          kind: 'vinyl-volley',
          phase: 'windup',
          windupTimer: 0.48,
          windupDuration: 0.48,
          x: boss.x - 42,
          y: py,
          startY: py,
          vx: -430,
          vy: 0,
          radius: 19,
          height: 38,
          age: 0,
          amp: 0,
          freq: 0,
          active: true,
        });
      }
    } else {
      boss.projectiles.push({
        id: boss.nextId++,
        kind: 'bass-wave',
        phase: 'windup',
        windupTimer: 0.52,
        windupDuration: 0.52,
        x: boss.x - 50,
        y: PLAYFIELD_BOTTOM - 68,
        startY: PLAYFIELD_BOTTOM - 68,
        vx: -410,
        vy: 0,
        radius: 26,
        height: 120,
        age: 0,
        amp: 0,
        freq: 0,
        active: true,
      });
    }
  } else {
    kind = reason === 'offbeat' ? 'organ-beam' : 'cacophony-spread';
    boss.currentAttackLabel = kind === 'organ-beam' ? 'Organ Steam Jet!' : 'Cacophony Spread!';
    if (kind === 'organ-beam') {
      boss.projectiles.push({
        id: boss.nextId++,
        kind: 'organ-beam',
        phase: 'windup',
        windupTimer: 0.55,
        windupDuration: 0.55,
        x: boss.x - 40,
        y: clampedCatY,
        startY: clampedCatY,
        vx: -540,
        vy: 0,
        radius: 18,
        height: 44,
        age: 0,
        amp: 0,
        freq: 0,
        active: true,
      });
    } else {
      spawnFanProjectiles(boss, clampedCatY, 3, 405);
    }
  }

  boss.attackCooldown = 1.05;
  boss.attackLabelTimer = 1.4;
  return kind;
}

function spawnFanProjectiles(
  boss: BossRuntimeState,
  targetY: number,
  count: number,
  speed: number,
): void {
  const spread = count === 3 ? [-110, 0, 110] : [-75, 75];
  for (const vy of spread) {
    boss.projectiles.push({
      id: boss.nextId++,
      kind: 'cacophony-spread',
      phase: 'windup',
      windupTimer: 0.45,
      windupDuration: 0.45,
      x: boss.x - 44,
      y: targetY,
      startY: targetY,
      vx: -speed,
      vy,
      radius: 15,
      height: 30,
      age: 0,
      amp: 0,
      freq: 0,
      active: true,
    });
  }
}

export function stepBossBattle(
  boss: BossRuntimeState,
  cat: CatPhysicsState,
  dt: number,
  songTime: number,
  worldWidth: number,
): {
  bossDamagedThisFrame: number;
  bossJustDefeated: boolean;
  playerHitByProjectile: boolean;
} {
  let bossDamagedThisFrame = 0;
  let bossJustDefeated = false;
  let playerHitByProjectile = false;

  // Keep boss anchored near right side on resize
  boss.x = Math.max(520, worldWidth - 135);

  if (boss.attackCooldown > 0) boss.attackCooldown = Math.max(0, boss.attackCooldown - dt);
  if (boss.hitFlashTimer > 0) boss.hitFlashTimer = Math.max(0, boss.hitFlashTimer - dt);
  if (boss.attackLabelTimer > 0) {
    boss.attackLabelTimer = Math.max(0, boss.attackLabelTimer - dt);
    if (boss.attackLabelTimer === 0) boss.currentAttackLabel = null;
  }

  // Delayed trailing ghost HP bar
  if (boss.ghostHp > boss.hp) {
    boss.ghostHp = Math.max(boss.hp, boss.ghostHp - Math.max(25, (boss.ghostHp - boss.hp) * 3.5) * dt);
  }

  if (boss.isDefeated) {
    boss.koTimer += dt;
    boss.y += 180 * dt;
    return { bossDamagedThisFrame, bossJustDefeated, playerHitByProjectile };
  }

  // Distinct boss movement rhythms
  if (boss.id === 'metronome') {
    boss.y = boss.baseY + Math.sin(songTime * 2.1) * 85;
  } else if (boss.id === 'hairball') {
    boss.y = boss.baseY + Math.sin(songTime * 3.2) * 105 + Math.cos(songTime * 1.6) * 28;
  } else {
    boss.y = boss.baseY + Math.sin(songTime * 2.6) * 95;
  }

  // Advance player bolts toward boss
  for (let i = boss.playerBolts.length - 1; i >= 0; i--) {
    const bolt = boss.playerBolts[i];
    // Gentle homing toward live boss Y
    const dx = boss.x - bolt.x;
    const dy = boss.y - bolt.y;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const speed = Math.hypot(bolt.vx, bolt.vy);
    bolt.vx = (dx / dist) * speed;
    bolt.vy = (dy / dist) * speed;
    bolt.x += bolt.vx * dt;
    bolt.y += bolt.vy * dt;

    if (dist < 46) {
      boss.hp = Math.max(0, boss.hp - bolt.damage);
      bossDamagedThisFrame += bolt.damage;
      boss.hitFlashTimer = 0.08;
      bolt.active = false;
      if (boss.hp <= 0 && !boss.isDefeated) {
        boss.isDefeated = true;
        boss.projectiles = [];
        bossJustDefeated = true;
      }
    }

    if (!bolt.active || bolt.x > worldWidth + 100) {
      boss.playerBolts.splice(i, 1);
    }
  }

  // Advance boss projectiles (windup -> active) and test cat collision
  for (let i = boss.projectiles.length - 1; i >= 0; i--) {
    const p = boss.projectiles[i];
    if (p.phase === 'windup') {
      p.windupTimer -= dt;
      p.x = boss.x - 42;
      if (p.windupTimer <= 0) {
        p.phase = 'active';
      }
      continue;
    }

    p.age += dt;
    p.x += p.vx * dt;
    if (p.kind === 'pendulum-sweep') {
      p.y = p.startY + Math.sin(p.age * p.freq) * p.amp;
    } else {
      p.y += p.vy * dt;
    }

    // Check collision against sausage cat spine if cat is not invulnerable
    if (cat.invulnTimer <= 0) {
      let hit = false;
      for (let s = 0; s < cat.spine.length; s += 2) {
        const node = cat.spine[s];
        if (p.kind === 'organ-beam' || p.kind === 'bass-wave') {
          const halfH = p.height / 2;
          if (
            circleIntersectsRect(
              node.x,
              node.y,
              CAT_COLLISION_RADIUS - 2,
              p.x - p.radius,
              p.y - halfH,
              p.radius * 2,
              p.height,
            )
          ) {
            hit = true;
            break;
          }
        } else {
          const d2 = (node.x - p.x) * (node.x - p.x) + (node.y - p.y) * (node.y - p.y);
          const rr = CAT_COLLISION_RADIUS + p.radius - 3;
          if (d2 < rr * rr) {
            hit = true;
            break;
          }
        }
      }
      if (hit) {
        playerHitByProjectile = true;
        p.active = false;
      }
    }

    if (!p.active || p.x < -120 || p.y < -120 || p.y > PLAYFIELD_BOTTOM + 120) {
      boss.projectiles.splice(i, 1);
    }
  }

  return { bossDamagedThisFrame, bossJustDefeated, playerHitByProjectile };
}
