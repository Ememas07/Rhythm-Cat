export type GameState = 'title' | 'playing' | 'paused' | 'gameover';

export type PlayMode = 'lives' | 'sudden-death' | 'infinite';

export type GameMode = 'arcade' | 'boss';

export type BossId = 'metronome' | 'hairball' | 'maestro';

export type JudgmentTier = 'PERFECT' | 'GOOD' | 'OFFBEAT';

export interface JudgmentResult {
  tier: JudgmentTier;
  deltaMs: number;
  points: number;
  nextCombo: number;
  multiplier: number;
  boostScale: number;
}

export interface SynthTrackConfig {
  kind: 'synth';
  id: string;
  title: string;
  subtitle: string;
  bpm: number;
  durationSec: number;
  accentColor: string;
  keyRootMidi: number;
  scaleIntervals: number[];
  bassPattern: number[];
  leadPattern: number[];
  recommendedBoss: BossId;
}

export interface Mp3TrackConfig {
  kind: 'mp3';
  id: string;
  title: string;
  subtitle: string;
  bpm: number;
  durationSec: number;
  accentColor: string;
  audioBuffer: AudioBuffer;
  fileName: string;
  detectedOnsets: number;
}

export type TrackConfig = SynthTrackConfig | Mp3TrackConfig;

export interface ObstacleGate {
  id: number;
  beatIndex: number;
  time: number;
  gapCenterY: number;
  gapHeight: number;
  width: number;
  passed: boolean;
  hit: boolean;
  accented: boolean;
  energy: number;
}

export interface CollectibleNote {
  id: number;
  time: number;
  y: number;
  radius: number;
  collected: boolean;
  missed: boolean;
  isHazard: boolean; // Wrong/discordant red note in Boss Battle mode
  beatIndex: number;
}

export interface LevelChart {
  bpm: number;
  firstBeatSec: number;
  durationSec: number;
  scrollSpeed: number;
  gates: ObstacleGate[];
  notes: CollectibleNote[];
  beatTimes: number[];
}

export interface SpineNode {
  x: number;
  y: number;
}

export interface CatPhysicsState {
  y: number;
  vy: number;
  pitch: number;
  squashX: number;
  squashY: number;
  invulnTimer: number;
  hitFlashTimer: number;
  happyTimer: number;
  spine: SpineNode[];
}

export type BossAttackKind =
  | 'pendulum-sweep'
  | 'vinyl-volley'
  | 'bass-wave'
  | 'organ-beam'
  | 'cacophony-spread';

export interface BossProjectile {
  id: number;
  kind: BossAttackKind;
  phase: 'windup' | 'active';
  windupTimer: number;
  windupDuration: number;
  x: number;
  y: number;
  startY: number;
  vx: number;
  vy: number;
  radius: number;
  height: number; // used for beam height
  age: number;
  amp: number;
  freq: number;
  active: boolean;
}

export interface PlayerBolt {
  id: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  vx: number;
  vy: number;
  damage: number;
  isSuper: boolean;
  active: boolean;
}

export interface BossDefinition {
  id: BossId;
  name: string;
  title: string;
  description: string;
  baseHp: number;
  primaryColor: string;
  accentColor: string;
  attackNames: [string, string];
}

export interface BossRuntimeState {
  id: BossId;
  name: string;
  hp: number;
  maxHp: number;
  ghostHp: number;
  x: number;
  y: number;
  baseY: number;
  hitFlashTimer: number;
  koTimer: number;
  isDefeated: boolean;
  attackCooldown: number;
  currentAttackLabel: string | null;
  attackLabelTimer: number;
  projectiles: BossProjectile[];
  playerBolts: PlayerBolt[];
  nextId: number;
}

export interface RunStats {
  score: number;
  bestScore: number;
  combo: number;
  maxCombo: number;
  multiplier: number;
  perfectCount: number;
  goodCount: number;
  offbeatCount: number;
  notesCollected: number;
  gatesCleared: number;
  totalGates: number;
  lives: number;
  maxLives: number;
  infiniteLives: boolean;
  accuracyPct: number;
  victory: boolean;
  victoryReason: 'song-cleared' | 'boss-defeated' | 'defeat';
  trackTitle: string;
  bpm: number;
  songProgress: number;
  gameMode: GameMode;
  bossName: string | null;
  bossHpRemaining: number;
  bossMaxHp: number;
}

export interface HudSnapshot {
  score: number;
  bestScore: number;
  combo: number;
  multiplier: number;
  lives: number;
  maxLives: number;
  infiniteLives: boolean;
  accuracyPct: number;
  songProgress: number;
  lastJudgment: JudgmentTier | null;
  lastJudgmentSeq: number;
  bpm: number;
  trackTitle: string;
  gameMode: GameMode;
  bossName: string | null;
  bossHp: number;
  bossMaxHp: number;
  bossGhostHp: number;
  bossAttackLabel: string | null;
}

export interface AudioAnalysisResult {
  bpm: number;
  firstBeatSec: number;
  beatTimes: number[];
  onsetTimes: number[];
  energyPerBeat: number[];
  durationSec: number;
}
