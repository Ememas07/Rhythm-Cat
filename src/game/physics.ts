import type { CatPhysicsState, CollectibleNote, ObstacleGate, PlayMode, SpineNode } from './types';

export function resolveLivesAfterHit(
  currentLives: number,
  playMode: PlayMode,
): { nextLives: number; isGameOver: boolean } {
  if (playMode === 'infinite') {
    return { nextLives: currentLives, isGameOver: false };
  }
  const nextLives = Math.max(0, currentLives - 1);
  return { nextLives, isGameOver: nextLives <= 0 };
}

export const WORLD_HEIGHT = 720;
export const GROUND_HEIGHT = 84;
// Unconstrained upper sky headroom so ascending beat runs can climb freely without ceiling bonks
export const PLAYFIELD_TOP = -1400;
export const PLAYFIELD_BOTTOM = WORLD_HEIGHT - GROUND_HEIGHT;

export const GRAVITY = 1120;
export const JUMP_VELOCITY = -410;
export const MAX_FALL_SPEED = 600;
export const SPINE_SEGMENTS = 6;
export const SPINE_SEGMENT_STEP = 14;
export const CAT_COLLISION_RADIUS = 16;

export function createInitialCatState(catX: number): CatPhysicsState {
  const startY = 310;
  const spine: SpineNode[] = [];
  for (let i = 0; i < SPINE_SEGMENTS; i++) {
    spine.push({ x: catX - i * SPINE_SEGMENT_STEP, y: startY });
  }
  return {
    y: startY,
    vy: 0,
    pitch: 0,
    squashX: 1,
    squashY: 1,
    invulnTimer: 0,
    hitFlashTimer: 0,
    happyTimer: 0,
    spine,
  };
}

export function applyCatJump(cat: CatPhysicsState, boostScale: number): void {
  cat.vy = JUMP_VELOCITY * boostScale;
  cat.squashX = 0.84;
  cat.squashY = 1.2;
  cat.pitch = -0.34;
  if (boostScale >= 1.0) {
    cat.happyTimer = 0.35;
  }
}

export function stepCatPhysics(
  cat: CatPhysicsState,
  dt: number,
  catX: number,
  scrollSpeed: number,
  isIntroGrace: boolean,
): { touchedBounds: 'ceiling' | 'ground' | null } {
  if (cat.invulnTimer > 0) cat.invulnTimer = Math.max(0, cat.invulnTimer - dt);
  if (cat.hitFlashTimer > 0) cat.hitFlashTimer = Math.max(0, cat.hitFlashTimer - dt);
  if (cat.happyTimer > 0) cat.happyTimer = Math.max(0, cat.happyTimer - dt);

  // Relax squash & stretch smoothly back to 1
  const relax = 1 - Math.exp(-14 * dt);
  cat.squashX += (1 - cat.squashX) * relax;
  cat.squashY += (1 - cat.squashY) * relax;

  if (isIntroGrace) {
    // During opening grace beats before the first jump/obstacle, hover gently so the player survives without instant input
    const targetHoverY = 310;
    cat.vy += (targetHoverY - cat.y) * 9 * dt;
    cat.vy *= Math.exp(-5 * dt);
    cat.y += cat.vy * dt;
  } else {
    cat.vy = Math.min(MAX_FALL_SPEED, cat.vy + GRAVITY * dt);
    cat.y += cat.vy * dt;
  }

  // Target pitch tracks vertical velocity
  const targetPitch = Math.max(-0.42, Math.min(0.55, cat.vy / 820));
  cat.pitch += (targetPitch - cat.pitch) * (1 - Math.exp(-12 * dt));

  // Update trailing sausage spine nodes so the long body undulates behind the head
  if (cat.spine.length > 0) {
    cat.spine[0].x = catX;
    cat.spine[0].y = cat.y;
    const horizontalLead = Math.max(180, scrollSpeed);
    const followRate = 1 - Math.exp(-18 * dt);
    for (let i = 1; i < cat.spine.length; i++) {
      const prev = cat.spine[i - 1];
      const curr = cat.spine[i];
      const targetX = prev.x - SPINE_SEGMENT_STEP;
      const lagY = prev.y + (cat.vy * (SPINE_SEGMENT_STEP / horizontalLead)) * 0.38;
      curr.x = targetX;
      curr.y += (lagY - curr.y) * followRate;
    }
  }

  let touchedBounds: 'ceiling' | 'ground' | null = null;
  if (cat.y - CAT_COLLISION_RADIUS < PLAYFIELD_TOP) {
    cat.y = PLAYFIELD_TOP + CAT_COLLISION_RADIUS;
    cat.vy = Math.max(0, cat.vy * 0.25);
    touchedBounds = 'ceiling';
  } else if (cat.y + CAT_COLLISION_RADIUS > PLAYFIELD_BOTTOM) {
    cat.y = PLAYFIELD_BOTTOM - CAT_COLLISION_RADIUS;
    cat.vy = -240; // small bounce cushion
    cat.squashX = 1.24;
    cat.squashY = 0.76;
    touchedBounds = 'ground';
  }

  return { touchedBounds };
}

export function circleIntersectsRect(
  cx: number,
  cy: number,
  r: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): boolean {
  const closestX = Math.max(rx, Math.min(cx, rx + rw));
  const closestY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < r * r;
}

export function checkGateCollision(
  cat: CatPhysicsState,
  gate: ObstacleGate,
  gateX: number,
): boolean {
  const left = gateX - gate.width / 2;
  const gapTop = gate.gapCenterY - gate.gapHeight / 2;
  const gapBottom = gate.gapCenterY + gate.gapHeight / 2;
  const skyTop = PLAYFIELD_TOP - 1000;

  // Check head and key spine segments along the sausage cat body
  for (let i = 0; i < cat.spine.length; i += 2) {
    const node = cat.spine[i];
    const radius = i === 0 ? CAT_COLLISION_RADIUS : CAT_COLLISION_RADIUS - 2;
    if (
      circleIntersectsRect(node.x, node.y, radius, left, skyTop, gate.width, gapTop - skyTop) ||
      circleIntersectsRect(
        node.x,
        node.y,
        radius,
        left,
        gapBottom,
        gate.width,
        PLAYFIELD_BOTTOM - gapBottom,
      )
    ) {
      return true;
    }
  }
  return false;
}

export function checkNoteCollect(
  cat: CatPhysicsState,
  note: CollectibleNote,
  noteX: number,
): boolean {
  if (note.collected) return false;
  const pickupRadius = note.radius + CAT_COLLISION_RADIUS + 4;
  const r2 = pickupRadius * pickupRadius;
  for (let i = 0; i < cat.spine.length; i += 2) {
    const node = cat.spine[i];
    const dx = node.x - noteX;
    const dy = node.y - note.y;
    if (dx * dx + dy * dy <= r2) {
      return true;
    }
  }
  return false;
}
