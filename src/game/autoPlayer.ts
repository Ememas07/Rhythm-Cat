import {
  CAT_COLLISION_RADIUS,
  GRAVITY,
  JUMP_VELOCITY,
  MAX_FALL_SPEED,
  PLAYFIELD_BOTTOM,
  PLAYFIELD_TOP,
  SPINE_SEGMENTS,
  SPINE_SEGMENT_STEP,
  circleIntersectsRect,
} from './physics';
import { getBeatTimingWindows, getNearestBeatDeltaSec } from './rhythmJudge';
import type {
  BossRuntimeState,
  CatPhysicsState,
  DifficultyLevel,
  LevelChart,
} from './types';

export interface AutoPilotState {
  lastJumpedBeatIndex: number;
  lastJumpSongTime: number;
  plannedBeatIndex: number;
  plannedJumpTime: number;
  skippedBeatIndex: number;
}

export function createAutoPilotState(): AutoPilotState {
  return {
    lastJumpedBeatIndex: -999,
    lastJumpSongTime: -999,
    plannedBeatIndex: -999,
    plannedJumpTime: -999,
    skippedBeatIndex: -999,
  };
}

/**
 * Decides whether Auto Mode should trigger a jump on this frame.
 * Plans trajectory once per beat window across PERFECT/GOOD micro-offsets and
 * caches the chosen trigger timestamp so variable browser frame rates never
 * saturate the main thread or overshoot the beat cutoff.
 */
export function decideAutoPlayJump(
  pilot: AutoPilotState,
  cat: CatPhysicsState,
  catX: number,
  songTime: number,
  chart: LevelChart,
  boss: BossRuntimeState | null,
  difficulty: DifficultyLevel = 'normal',
): boolean {
  const firstGateTime = chart.gates[0]?.time ?? 2.6;
  // Wait cleanly through intro hover until ~0.85s before first gate
  if (songTime < Math.max(1.2, firstGateTime - 0.85) && cat.y < 330) {
    return false;
  }

  const { deltaSec, beatIndex } = getNearestBeatDeltaSec(
    songTime,
    chart.bpm,
    chart.firstBeatSec,
    chart.beatTimes,
  );
  const { perfectSec, goodSec } = getBeatTimingWindows(difficulty);
  const maxDelaySec = Math.max(0.072, goodSec * 0.88);
  const minEarlySec = -Math.min(0.074, perfectSec * 0.98);
  const hasBossProjectiles = Boolean(boss && !boss.isDefeated && boss.projectiles.some((p) => p.active));

  if (
    deltaSec >= minEarlySec &&
    deltaSec <= maxDelaySec &&
    beatIndex > pilot.lastJumpedBeatIndex
  ) {
    // If we already planned to skip this beat (and no sudden boss shots appeared), stay quiet
    if (!hasBossProjectiles && pilot.skippedBeatIndex === beatIndex) {
      return false;
    }

    // If we already planned a delayed trigger timestamp for this beat, wait cleanly until it arrives
    if (!hasBossProjectiles && pilot.plannedBeatIndex === beatIndex) {
      if (songTime < pilot.plannedJumpTime - 0.015) {
        return false;
      }
      // Target time reached (or within 15ms): fire cleanly inside window regardless of fps
      pilot.lastJumpedBeatIndex = beatIndex;
      pilot.lastJumpSongTime = songTime;
      pilot.plannedBeatIndex = -999;
      return true;
    }

    const decision = chooseBestBeatAction(
      beatIndex,
      deltaSec,
      perfectSec,
      maxDelaySec,
      cat,
      catX,
      songTime,
      chart,
      boss,
    );
    if (decision.kind === 'jump-now') {
      pilot.lastJumpedBeatIndex = beatIndex;
      pilot.lastJumpSongTime = songTime;
      pilot.plannedBeatIndex = -999;
      return true;
    }
    if (decision.kind === 'skip') {
      if (deltaSec >= -0.015) {
        pilot.skippedBeatIndex = beatIndex;
      }
      pilot.plannedBeatIndex = -999;
      return false;
    }
    pilot.plannedBeatIndex = beatIndex;
    pilot.plannedJumpTime = decision.targetTime;
    return false;
  }

  // Last-resort off-beat emergency save only when not inside an active beat window
  if (
    songTime - pilot.lastJumpSongTime >= 0.16 &&
    (deltaSec < -0.09 || deltaSec > maxDelaySec + 0.02)
  ) {
    if (isImminentCollisionIfCoasting(cat, catX, songTime, chart, boss)) {
      pilot.lastJumpSongTime = songTime;
      return true;
    }
  }

  return false;
}

function getBeatTimestamp(chart: LevelChart, beatIndex: number): number {
  if (chart.beatTimes.length > 0 && beatIndex >= 0 && beatIndex < chart.beatTimes.length) {
    return chart.beatTimes[beatIndex];
  }
  const period = 60 / Math.max(40, chart.bpm);
  return chart.firstBeatSec + beatIndex * period;
}

type BeatDecision =
  | { kind: 'jump-now' }
  | { kind: 'skip' }
  | { kind: 'wait'; targetTime: number };

function chooseBestBeatAction(
  currentBeatIdx: number,
  deltaSec: number,
  perfectSec: number,
  maxDelaySec: number,
  cat: CatPhysicsState,
  catX: number,
  songTime: number,
  chart: LevelChart,
  boss: BossRuntimeState | null,
): BeatDecision {
  const horizonBeats = chart.bpm >= 115 ? 6 : 5;
  const beatSchedule: number[] = [];
  for (let k = 0; k < horizonBeats; k++) {
    beatSchedule.push(getBeatTimestamp(chart, currentBeatIdx + k));
  }
  const lastScheduledBeat = beatSchedule[horizonBeats - 1];
  const horizonEnd = lastScheduledBeat + Math.min(0.45, 60 / Math.max(40, chart.bpm));
  const simDt = 1 / 60;

  const nearbyGates = chart.gates.filter(
    (g) => g.time >= songTime - 0.3 && g.time <= horizonEnd + 0.35,
  );
  const nearbyNotes = chart.notes.filter(
    (n) => !n.collected && n.time >= songTime - 0.12 && n.time <= horizonEnd + 0.12,
  );
  const activeProjectiles =
    boss && !boss.isDefeated ? boss.projectiles.filter((p) => p.active) : [];

  const totalPlans = 1 << horizonBeats;
  let bestJumpNowScore = -Infinity;
  let bestSkipScore = -Infinity;
  const beat0JumpBoost = Math.abs(deltaSec) <= perfectSec ? 1.06 : 1.02;
  // Slight preference for crisp on-beat timing over extreme early edge (-65ms) unless needed for safety
  const immediateOffsetPenalty = Math.abs(deltaSec) > 0.025 ? -Math.abs(deltaSec) * 180 : 0;

  // 1) Evaluate immediate jump (bit 0 = 1) vs skipping beat 0 (bit 0 = 0)
  for (let mask = 0; mask < totalPlans; mask++) {
    const score = simulatePlan(
      mask,
      0,
      beat0JumpBoost,
      1.06,
      beatSchedule,
      horizonEnd,
      simDt,
      cat,
      catX,
      songTime,
      chart.scrollSpeed,
      nearbyGates,
      nearbyNotes,
      activeProjectiles,
    );
    if ((mask & 1) !== 0) {
      const adj = score + immediateOffsetPenalty;
      if (adj > bestJumpNowScore) bestJumpNowScore = adj;
    } else {
      if (score > bestSkipScore) bestSkipScore = score;
    }
  }

  // 2) Evaluate micro-delayed jumps inside beat 0's remaining PERFECT/GOOD window
  let bestDelayedScore = -Infinity;
  let bestTargetTime = songTime;
  const candidateDelays: { delay: number; boost: number; penalty: number }[] = [];
  if (deltaSec < -0.012) {
    // Wait until right on the beat center (0ms) for tighter rhythm when safe
    candidateDelays.push({
      delay: -deltaSec,
      boost: 1.06,
      penalty: 0,
    });
  }
  if (deltaSec < perfectSec * 0.65) {
    candidateDelays.push({
      delay: Math.max(0.03, perfectSec * 0.65 - deltaSec),
      boost: 1.06,
      penalty: -12,
    });
  }
  const targetDelay2 = Math.max(0.055, maxDelaySec * (0.76 / 0.88));
  if (deltaSec < targetDelay2 - 0.01) {
    candidateDelays.push({
      delay: targetDelay2 - deltaSec,
      boost: 1.02,
      penalty: -115,
    });
  }

  for (const cand of candidateDelays) {
    const rhythmPenalty = cand.penalty;
    for (let mask = 1; mask < totalPlans; mask += 2) {
      // Prefer PERFECT timing; take late GOOD delay when needed to clear tight pipe lips safely
      const score =
        simulatePlan(
          mask,
          cand.delay,
          cand.boost,
          1.06,
          beatSchedule,
          horizonEnd,
          simDt,
          cat,
          catX,
          songTime,
          chart.scrollSpeed,
          nearbyGates,
          nearbyNotes,
          activeProjectiles,
        ) + rhythmPenalty;
      if (score > bestDelayedScore) {
        bestDelayedScore = score;
        bestTargetTime = songTime + cand.delay;
      }
    }
  }

  if (bestJumpNowScore >= bestSkipScore && bestJumpNowScore >= bestDelayedScore - 15) {
    return { kind: 'jump-now' };
  }
  if (bestSkipScore > bestDelayedScore) {
    return { kind: 'skip' };
  }
  return { kind: 'wait', targetTime: bestTargetTime };
}

function simulatePlan(
  mask: number,
  beat0DelaySec: number,
  beat0Boost: number,
  futureBoost: number,
  beatSchedule: number[],
  horizonEnd: number,
  dt: number,
  cat: CatPhysicsState,
  catX: number,
  songTime: number,
  scrollSpeed: number,
  nearbyGates: LevelChart['gates'],
  nearbyNotes: LevelChart['notes'],
  projectiles: NonNullable<BossRuntimeState['projectiles']>,
): number {
  let y = cat.y;
  let vy = cat.vy;
  let beat0Fired = false;
  if ((mask & 1) !== 0 && beat0DelaySec <= 0.001) {
    vy = JUMP_VELOCITY * beat0Boost;
    beat0Fired = true;
  }
  const beat0TargetTime = songTime + beat0DelaySec;
  let nextBeatSlot = 1;

  const spineYs = cat.spine.map((s) => s.y);
  const followRate = 1 - Math.exp(-18 * dt);
  const skyTop = PLAYFIELD_TOP - 1000;

  let score = 0;
  let t = songTime;
  let elapsed = 0;

  while (t < horizonEnd) {
    if (!beat0Fired && (mask & 1) !== 0 && t >= beat0TargetTime - dt * 0.5) {
      vy = JUMP_VELOCITY * beat0Boost;
      beat0Fired = true;
    }

    while (nextBeatSlot < beatSchedule.length && t >= beatSchedule[nextBeatSlot] - dt * 0.5) {
      if ((mask & (1 << nextBeatSlot)) !== 0) {
        vy = JUMP_VELOCITY * futureBoost;
      }
      nextBeatSlot++;
    }

    t += dt;
    elapsed += dt;

    vy = Math.min(MAX_FALL_SPEED, vy + GRAVITY * dt);
    y += vy * dt;

    spineYs[0] = y;
    const lagScale = (vy * (SPINE_SEGMENT_STEP / Math.max(180, scrollSpeed))) * 0.38;
    for (let i = 1; i < SPINE_SEGMENTS; i++) {
      const lagY = spineYs[i - 1] + lagScale;
      spineYs[i] += (lagY - spineYs[i]) * followRate;
    }

    // Discount far-future collisions smoothly so imminent obstacles always take priority
    const urgency = Math.max(0.2, 6.0 * Math.exp(-elapsed * 1.4));

    // Hard bounds penalties
    if (y + CAT_COLLISION_RADIUS >= PLAYFIELD_BOTTOM - 6) {
      score -= 15000 * urgency;
    }
    if (y - CAT_COLLISION_RADIUS <= PLAYFIELD_TOP + 20) {
      score -= 15000 * urgency;
    }

    // Gate collision & centering
    for (let gIdx = 0; gIdx < nearbyGates.length; gIdx++) {
      const gate = nearbyGates[gIdx];
      const gx = catX + (gate.time - t) * scrollSpeed;
      if (gx + gate.width / 2 < catX - 88 || gx - gate.width / 2 > catX + 26) continue;

      const left = gx - gate.width / 2;
      const gapTop = gate.gapCenterY - gate.gapHeight / 2;
      const gapBottom = gate.gapCenterY + gate.gapHeight / 2;

      for (let i = 0; i < SPINE_SEGMENTS; i += 2) {
        const sx = catX - i * SPINE_SEGMENT_STEP;
        const sy = spineYs[i];
        const r = CAT_COLLISION_RADIUS + 2;
        if (
          circleIntersectsRect(sx, sy, r, left, skyTop, gate.width, gapTop - skyTop) ||
          circleIntersectsRect(sx, sy, r, left, gapBottom, gate.width, PLAYFIELD_BOTTOM - gapBottom)
        ) {
          score -= 20000 * urgency;
        }
      }

      // Soft margin penalty to stay well clear of upper/lower pipe lips
      const topClearance = y - CAT_COLLISION_RADIUS - gapTop;
      const bottomClearance = gapBottom - (y + CAT_COLLISION_RADIUS);
      if (topClearance < 18) score -= (18 - topClearance) * 18;
      if (bottomClearance < 18) score -= (18 - bottomClearance) * 18;

      score -= Math.abs(y - gate.gapCenterY) * 0.45;
    }

    // Notes
    for (let nIdx = 0; nIdx < nearbyNotes.length; nIdx++) {
      const n = nearbyNotes[nIdx];
      const nx = catX + (n.time - t) * scrollSpeed;
      if (Math.abs(nx - catX) > 22) continue;
      const dy = Math.abs(y - n.y);
      if (n.isHazard && dy < n.radius + CAT_COLLISION_RADIUS + 14) {
        score -= 9000;
      } else if (!n.isHazard && dy < n.radius + CAT_COLLISION_RADIUS + 6) {
        score += 40;
      }
    }

    // Boss projectiles
    for (let pIdx = 0; pIdx < projectiles.length; pIdx++) {
      const p = projectiles[pIdx];
      const activeDt = p.phase === 'windup' ? Math.max(0, elapsed - p.windupTimer) : elapsed;
      const px = p.x + p.vx * activeDt;
      if (Math.abs(px - catX) > 46) continue;
      const py = p.y + p.vy * activeDt;
      const halfH = p.height > 0 ? p.height / 2 : p.radius;
      if (Math.abs(y - py) < halfH + CAT_COLLISION_RADIUS + 14) {
        score -= 10000;
      }
    }
  }

  let nextGate = nearbyGates[nearbyGates.length - 1] ?? null;
  for (const g of nearbyGates) {
    if (g.time >= t - 0.1) {
      nextGate = g;
      break;
    }
  }
  const endTargetY = nextGate ? nextGate.gapCenterY : 295;
  score -= Math.abs(y - endTargetY) * 1.2;

  return score;
}

function isImminentCollisionIfCoasting(
  cat: CatPhysicsState,
  catX: number,
  _songTime: number,
  _chart: LevelChart,
  boss: BossRuntimeState | null,
): boolean {
  const dt = 0.11;
  const coastY = cat.y + cat.vy * dt + 0.5 * GRAVITY * dt * dt;
  const jumpY = cat.y + JUMP_VELOCITY * dt + 0.5 * GRAVITY * dt * dt;

  if (coastY + CAT_COLLISION_RADIUS >= PLAYFIELD_BOTTOM - 16 && jumpY < coastY) {
    return true;
  }

  if (boss && !boss.isDefeated) {
    for (const p of boss.projectiles) {
      if (p.phase !== 'active') continue;
      const px = p.x + p.vx * dt;
      if (Math.abs(px - catX) < p.radius + 30) {
        const py = p.y + p.vy * dt;
        const halfH = p.height > 0 ? p.height / 2 : p.radius;
        if (Math.abs(coastY - py) < halfH + CAT_COLLISION_RADIUS + 8 && py >= coastY - 10) {
          return true;
        }
      }
    }
  }

  return false;
}
