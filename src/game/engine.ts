import { RhythmAudioEngine } from './audioEngine';
import {
  createBossState,
  spawnPlayerRhythmBolt,
  stepBossBattle,
  triggerBossAttack,
} from './bosses';
import { generateLevelFromAnalysis } from './levelGenerator';
import {
  applyCatJump,
  checkGateCollision,
  checkNoteCollect,
  createInitialCatState,
  stepCatPhysics,
  WORLD_HEIGHT,
} from './physics';
import { GameRenderer } from './renderer';
import { computeAccuracyPercent, evaluateBeatJump, getNearestBeatDeltaSec } from './rhythmJudge';
import { getSkinById, type CatSkinId } from './skins';
import { buildSynthTrackAnalysis } from './tracks';
import type {
  AudioAnalysisResult,
  BossId,
  BossRuntimeState,
  CatPhysicsState,
  GameMode,
  GameState,
  HudSnapshot,
  LevelChart,
  PlayMode,
  RunStats,
  TrackConfig,
} from './types';

export interface EngineCallbacks {
  onHudUpdate: (hud: HudSnapshot) => void;
  onGameOver: (stats: RunStats) => void;
  onStateChange: (state: GameState) => void;
}

export class SausageCatEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private audio: RhythmAudioEngine;
  private renderer: GameRenderer;
  private callbacks: EngineCallbacks;

  private rafId: number | null = null;
  private lastTimestamp = 0;

  private state: GameState = 'title';
  private gameMode: GameMode = 'arcade';
  private playMode: PlayMode = 'lives';
  private bossId: BossId = 'metronome';
  private skinId: CatSkinId = 'marmalade';
  private bestScore = 0;

  private track: TrackConfig;
  private analysis: AudioAnalysisResult;
  private chart: LevelChart;

  private worldWidth = 1152;
  private catX = 240;
  private cat: CatPhysicsState;
  private boss: BossRuntimeState | null = null;

  private hitstopTimer = 0;
  private shakeTrauma = 0;
  private deathDelayTimer = 0;
  private pendingGameOverStats: RunStats | null = null;

  // Run counters
  private score = 0;
  private combo = 0;
  private maxCombo = 0;
  private multiplier = 1;
  private perfectCount = 0;
  private goodCount = 0;
  private offbeatCount = 0;
  private notesCollected = 0;
  private gatesCleared = 0;
  private lives = 3;
  private maxLives = 3;
  private lastJudgmentSeq = 0;
  private lastJudgment: HudSnapshot['lastJudgment'] = null;
  private hasJumpedYet = false;

  // Input buffer for snappy jump responsiveness
  private jumpBufferTimer = 0;
  private lastHudPushTime = 0;

  constructor(
    canvas: HTMLCanvasElement,
    audio: RhythmAudioEngine,
    initialTrack: TrackConfig,
    initialAnalysis: AudioAnalysisResult,
    callbacks: EngineCallbacks,
  ) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2D canvas context unavailable');
    }
    this.ctx = ctx;
    this.audio = audio;
    this.renderer = new GameRenderer();
    this.callbacks = callbacks;

    this.track = initialTrack;
    this.analysis = initialAnalysis;
    this.chart = generateLevelFromAnalysis(initialAnalysis, { gameMode: this.gameMode });
    this.cat = createInitialCatState(this.catX);

    this.handleResize();
    this.startLoop();
  }

  public destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.audio.stop();
  }

  public handleResize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(320, Math.round(rect.width));
    const h = Math.max(320, Math.round(rect.height));

    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);

    this.worldWidth = Math.max(580, Math.round(WORLD_HEIGHT * (w / h)));
    this.catX = Math.min(250, Math.round(this.worldWidth * 0.25));
  }

  public configureSession(opts: {
    track: TrackConfig;
    analysis: AudioAnalysisResult;
    gameMode: GameMode;
    playMode: PlayMode;
    bossId: BossId;
    skinId: CatSkinId;
    bestScore: number;
  }): void {
    this.track = opts.track;
    this.analysis = opts.analysis;
    this.gameMode = opts.gameMode;
    this.playMode = opts.playMode;
    this.bossId = opts.bossId;
    this.skinId = opts.skinId;
    this.bestScore = opts.bestScore;
  }

  public setSkin(skinId: CatSkinId): void {
    this.skinId = skinId;
  }

  public getState(): GameState {
    return this.state;
  }

  public startGame(): void {
    this.chart = generateLevelFromAnalysis(this.analysis, {
      gameMode: this.gameMode,
      seed: this.track.id.length * 97 + Math.round(this.track.bpm),
    });

    this.cat = createInitialCatState(this.catX);
    this.renderer.clearEffects();

    this.maxLives = this.playMode === 'sudden-death' ? 1 : 3;
    this.lives = this.maxLives;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.multiplier = 1;
    this.perfectCount = 0;
    this.goodCount = 0;
    this.offbeatCount = 0;
    this.notesCollected = 0;
    this.gatesCleared = 0;
    this.lastJudgment = null;
    this.hasJumpedYet = false;
    this.jumpBufferTimer = 0;
    this.hitstopTimer = 0;
    this.shakeTrauma = 0;
    this.deathDelayTimer = 0;
    this.pendingGameOverStats = null;

    this.boss =
      this.gameMode === 'boss'
        ? createBossState(this.bossId, this.worldWidth, this.chart.durationSec)
        : null;

    this.state = 'playing';
    this.callbacks.onStateChange('playing');
    this.audio.startTrack(this.track, this.chart.firstBeatSec);
    this.pushHud(true);
  }

  public pauseGame(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.audio.pause();
    this.callbacks.onStateChange('paused');
  }

  public resumeGame(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.audio.resume();
    this.callbacks.onStateChange('playing');
  }

  public returnToTitle(): void {
    this.audio.stop();
    this.boss = null;
    this.pendingGameOverStats = null;
    this.deathDelayTimer = 0;
    this.cat = createInitialCatState(this.catX);
    this.state = 'title';
    this.callbacks.onStateChange('title');
  }

  public triggerJump(): void {
    if (this.state !== 'playing' || this.pendingGameOverStats) return;
    this.jumpBufferTimer = 0.12;
  }

  private executeJump(songTime: number): void {
    this.hasJumpedYet = true;
    const result = evaluateBeatJump(
      songTime,
      this.chart.bpm,
      this.chart.firstBeatSec,
      this.chart.beatTimes ? this.combo : this.combo,
      this.chart.beatTimes,
    );

    this.combo = result.nextCombo;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.multiplier = result.multiplier;
    this.score += result.points;
    this.lastJudgment = result.tier;
    this.lastJudgmentSeq++;

    if (result.tier === 'PERFECT') {
      this.perfectCount++;
      this.renderer.spawnBurst(this.catX, this.cat.y + 10, '#FDE047', 10, 210, 5);
      this.renderer.spawnPop(this.catX + 18, this.cat.y - 34, `PERFECT +${result.points}`, '#FDE047', 1.05);
    } else if (result.tier === 'GOOD') {
      this.goodCount++;
      this.renderer.spawnBurst(this.catX, this.cat.y + 10, '#38BDF8', 6, 160, 4);
      this.renderer.spawnPop(this.catX + 18, this.cat.y - 30, `GOOD +${result.points}`, '#7DD3FC', 0.92);
    } else {
      this.offbeatCount++;
      this.renderer.spawnBurst(this.catX, this.cat.y + 10, '#94A3B8', 4, 110, 3);
      this.renderer.spawnPop(this.catX + 12, this.cat.y - 26, 'OFFBEAT', '#CBD5E1', 0.82);

      // In Boss Battle mode, jumping off-beat after intro grace triggers a boss attack!
      if (this.boss && !this.boss.isDefeated && songTime >= 2.2) {
        const atk = triggerBossAttack(this.boss, this.cat.y, 'offbeat');
        if (atk) {
          this.audio.playBossTelegraphSfx();
        }
      }
    }

    if (this.boss && !this.boss.isDefeated && result.tier !== 'OFFBEAT') {
      spawnPlayerRhythmBolt(this.boss, this.catX, this.cat.y, result.tier, result.multiplier, false);
    }

    applyCatJump(this.cat, result.boostScale);
    this.audio.playJumpSfx(result.tier);
    this.pushHud(true);
  }

  private startLoop(): void {
    const tick = (now: number) => {
      if (this.lastTimestamp === 0) this.lastTimestamp = now;
      const rawDt = (now - this.lastTimestamp) / 1000;
      this.lastTimestamp = now;
      const dt = Math.min(rawDt, 0.05);

      this.update(dt, now);
      this.render();

      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private update(dt: number, nowMs: number): void {
    this.renderer.updateEffects(dt);
    if (this.shakeTrauma > 0) {
      this.shakeTrauma = Math.max(0, this.shakeTrauma - 2.4 * dt);
    }

    if (this.state === 'title') {
      // Gentle idle hover for sausage cat on title screen (higher on narrow mobile viewports)
      const t = nowMs / 1000;
      const baseHoverY = this.worldWidth < 680 ? 200 : 295;
      this.cat.y = baseHoverY + Math.sin(t * 2.4) * 16;
      this.cat.pitch = Math.cos(t * 2.4) * 0.08;
      for (let i = 0; i < this.cat.spine.length; i++) {
        this.cat.spine[i].x = this.catX - i * 14;
        this.cat.spine[i].y = baseHoverY + Math.sin(t * 2.4 - i * 0.35) * 16;
      }
      return;
    }

    if (this.state !== 'playing') {
      return;
    }

    // Delayed defeat/victory final beat so KO animation / impact flash reads cleanly
    if (this.pendingGameOverStats) {
      this.deathDelayTimer -= dt;
      if (this.boss && this.boss.isDefeated) {
        stepBossBattle(this.boss, this.cat, dt, this.audio.getSongTime(), this.worldWidth);
      }
      if (this.deathDelayTimer <= 0) {
        const finalStats = this.pendingGameOverStats;
        this.pendingGameOverStats = null;
        this.audio.stop();
        this.state = 'gameover';
        this.callbacks.onStateChange('gameover');
        this.callbacks.onGameOver(finalStats);
      }
      return;
    }

    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
      return;
    }

    const songTime = this.audio.getSongTime();

    // Process buffered jump input
    if (this.jumpBufferTimer > 0) {
      this.jumpBufferTimer = 0;
      this.executeJump(songTime);
    }

    // Opening grace period (~2.1s or until first jump) guarantees survival without instant input
    const isIntroGrace = !this.hasJumpedYet && songTime < 2.2;
    stepCatPhysics(this.cat, dt, this.catX, this.chart.scrollSpeed, isIntroGrace);

    // Check gate passes & collisions
    for (const gate of this.chart.gates) {
      const gx = this.catX + (gate.time - songTime) * this.chart.scrollSpeed;
      if (gx < -120 || gx > this.worldWidth + 120) continue;

      if (!gate.passed && gx + gate.width / 2 < this.catX - 10) {
        gate.passed = true;
        this.gatesCleared++;
        this.score += 100 * this.multiplier;
        this.pushHud(true);
      }

      if (!gate.hit && this.cat.invulnTimer <= 0 && checkGateCollision(this.cat, gate, gx)) {
        gate.hit = true;
        this.handlePlayerHurt('Bonk!');
        if (this.pendingGameOverStats) return;
      }
    }

    // Check collectible beat notes & Boss Battle wrong/hazard notes
    for (const note of this.chart.notes) {
      const nx = this.catX + (note.time - songTime) * this.chart.scrollSpeed;

      if (!note.collected && !note.missed && nx < this.catX - 55) {
        note.missed = true;
        // Missing a golden note in Boss Battle triggers a boss attack occasionally
        if (this.boss && !this.boss.isDefeated && !note.isHazard && note.beatIndex % 3 === 1) {
          const atk = triggerBossAttack(this.boss, this.cat.y, 'missed-note');
          if (atk) this.audio.playBossTelegraphSfx();
        }
      }

      if (note.collected || nx < -60 || nx > this.worldWidth + 60) continue;

      if (checkNoteCollect(this.cat, note, nx)) {
        note.collected = true;
        if (note.isHazard) {
          this.audio.playNoteSfx(true);
          this.combo = 0;
          this.multiplier = 1;
          this.renderer.spawnBurst(nx, note.y, '#EF4444', 14, 220, 5);
          this.renderer.spawnPop(nx, note.y - 20, 'WRONG NOTE!', '#FCA5A5', 1.0);
          if (this.boss && !this.boss.isDefeated) {
            const atk = triggerBossAttack(this.boss, this.cat.y, 'wrong-note');
            if (atk) this.audio.playBossTelegraphSfx();
          }
          this.handlePlayerHurt('Sour Note!');
          if (this.pendingGameOverStats) return;
        } else {
          this.notesCollected++;
          const pts = 150 * this.multiplier;
          this.score += pts;
          this.audio.playNoteSfx(false);
          this.renderer.spawnBurst(nx, note.y, '#FFB830', 12, 200, 4.5);
          this.renderer.spawnPop(nx, note.y - 18, `+${pts}`, '#FDE68A', 0.95);
          if (this.boss && !this.boss.isDefeated) {
            spawnPlayerRhythmBolt(this.boss, this.catX, this.cat.y, 'PERFECT', this.multiplier, true);
          }
          this.pushHud(true);
        }
      }
    }

    // Step Boss Battle combat
    if (this.boss) {
      const bossRes = stepBossBattle(this.boss, this.cat, dt, songTime, this.worldWidth);
      if (bossRes.bossDamagedThisFrame > 0) {
        this.score += bossRes.bossDamagedThisFrame * 5;
        this.renderer.spawnBurst(this.boss.x - 24, this.boss.y, '#FDE047', 8, 220, 4.5);
        this.renderer.spawnPop(
          this.boss.x - 10,
          this.boss.y - 46,
          `-${bossRes.bossDamagedThisFrame}`,
          '#FDE047',
          1.05,
        );
        this.pushHud(true);
      }

      if (bossRes.playerHitByProjectile) {
        this.handlePlayerHurt('Boss Hit!');
        if (this.pendingGameOverStats) return;
      }

      if (bossRes.bossJustDefeated) {
        this.score += 1000;
        this.hitstopTimer = 0.06;
        this.shakeTrauma = 0.85;
        this.renderer.spawnBurst(this.boss.x, this.boss.y, '#FDE047', 28, 320, 6.5);
        this.audio.playVictorySfx();
        this.pendingGameOverStats = this.buildRunStats(true, 'boss-defeated', songTime);
        this.deathDelayTimer = 0.65;
        this.pushHud(true);
        return;
      }
    }

    // Check song completion (Victory in Arcade, or Boss survival clear/end)
    if (songTime >= this.chart.durationSec) {
      const bossDefeated = !this.boss || this.boss.isDefeated;
      if (bossDefeated) {
        this.audio.playVictorySfx();
      }
      this.pendingGameOverStats = this.buildRunStats(
        bossDefeated,
        bossDefeated ? 'song-cleared' : 'defeat',
        this.chart.durationSec,
      );
      this.deathDelayTimer = 0.45;
      this.pushHud(true);
      return;
    }

    if (nowMs - this.lastHudPushTime > 120) {
      this.pushHud(false);
    }
  }

  private handlePlayerHurt(label: string): void {
    this.lives = Math.max(0, this.lives - 1);
    this.combo = 0;
    this.multiplier = 1;
    this.cat.invulnTimer = 1.25;
    this.cat.hitFlashTimer = 0.18;
    this.hitstopTimer = 0.045;
    this.shakeTrauma = 0.72;
    this.audio.playDamageSfx();
    this.renderer.spawnBurst(this.catX, this.cat.y, '#FB7185', 16, 250, 5.5);
    this.renderer.spawnPop(this.catX, this.cat.y - 36, label, '#FCA5A5', 1.1);
    this.pushHud(true);

    if (this.lives <= 0) {
      const songTime = this.audio.getSongTime();
      this.pendingGameOverStats = this.buildRunStats(false, 'defeat', songTime);
      this.deathDelayTimer = 0.52;
    }
  }

  private buildRunStats(
    victory: boolean,
    victoryReason: RunStats['victoryReason'],
    songTime: number,
  ): RunStats {
    const accuracyPct = computeAccuracyPercent(
      this.perfectCount,
      this.goodCount,
      this.offbeatCount,
    );
    const bestScore = Math.max(this.bestScore, this.score);
    return {
      score: Math.round(this.score),
      bestScore: Math.round(bestScore),
      combo: this.combo,
      maxCombo: this.maxCombo,
      multiplier: this.multiplier,
      perfectCount: this.perfectCount,
      goodCount: this.goodCount,
      offbeatCount: this.offbeatCount,
      notesCollected: this.notesCollected,
      gatesCleared: this.gatesCleared,
      totalGates: this.chart.gates.length,
      lives: this.lives,
      maxLives: this.maxLives,
      accuracyPct,
      victory,
      victoryReason,
      trackTitle: this.track.title,
      bpm: this.chart.bpm,
      songProgress: Math.min(1, songTime / Math.max(1, this.chart.durationSec)),
      gameMode: this.gameMode,
      bossName: this.boss ? this.boss.name : null,
      bossHpRemaining: this.boss ? this.boss.hp : 0,
      bossMaxHp: this.boss ? this.boss.maxHp : 0,
    };
  }

  private pushHud(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastHudPushTime < 100) return;
    this.lastHudPushTime = now;

    const songTime = this.audio.getSongTime();
    const accuracyPct = computeAccuracyPercent(
      this.perfectCount,
      this.goodCount,
      this.offbeatCount,
    );

    this.callbacks.onHudUpdate({
      score: Math.round(this.score),
      bestScore: Math.round(Math.max(this.bestScore, this.score)),
      combo: this.combo,
      multiplier: this.multiplier,
      lives: this.lives,
      maxLives: this.maxLives,
      accuracyPct,
      songProgress: Math.min(1, songTime / Math.max(1, this.chart.durationSec)),
      lastJudgment: this.lastJudgment,
      lastJudgmentSeq: this.lastJudgmentSeq,
      bpm: this.chart.bpm,
      trackTitle: this.track.title,
      gameMode: this.gameMode,
      bossName: this.boss ? this.boss.name : null,
      bossHp: this.boss ? this.boss.hp : 0,
      bossMaxHp: this.boss ? this.boss.maxHp : 0,
      bossGhostHp: this.boss ? this.boss.ghostHp : 0,
      bossAttackLabel: this.boss ? this.boss.currentAttackLabel : null,
    });
  }

  private render(): void {
    const songTime =
      this.state === 'title' ? performance.now() / 1000 : this.audio.getSongTime();
    const { beatProgress } = getNearestBeatDeltaSec(
      songTime,
      this.chart.bpm,
      this.chart.firstBeatSec,
      this.state === 'playing' ? this.chart.beatTimes : undefined,
    );

    const shakeMag = this.shakeTrauma * this.shakeTrauma * 14;
    const shakeX = shakeMag > 0.1 ? (Math.random() * 2 - 1) * shakeMag : 0;
    const shakeY = shakeMag > 0.1 ? (Math.random() * 2 - 1) * shakeMag : 0;

    this.renderer.renderFrame(this.ctx, this.canvas.width, this.canvas.height, {
      worldWidth: this.worldWidth,
      songTime,
      scrollSpeed: this.chart.scrollSpeed,
      beatProgress,
      catX: this.catX,
      cat: this.cat,
      skin: getSkinById(this.skinId),
      gates: this.chart.gates,
      notes: this.chart.notes,
      boss: this.boss,
      shakeX,
      shakeY,
      isPlaying: this.state === 'playing' || this.state === 'paused',
      accentColor: this.track.accentColor,
    });
  }
}

export function createInitialTrackSetup(track: TrackConfig) {
  if (track.kind === 'synth') {
    return buildSynthTrackAnalysis(track);
  }
  throw new Error('Expected synth track for initial setup');
}
