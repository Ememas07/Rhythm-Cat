import type { CatSkinId } from './skins';
import type { JudgmentTier, LevelChart, PlayMode } from './types';

export type PlayerRole = 'host' | 'guest';

export type RoomStatus = 'waiting' | 'countdown' | 'playing' | 'finished';

export interface MultiplayerTrackMeta {
  kind: 'synth' | 'mp3';
  trackId: string;
  title: string;
  subtitle: string;
  bpm: number;
  durationSec: number;
  accentColor: string;
  hasAudioAsset: boolean;
}

export interface RoomPlayerState {
  role: PlayerRole;
  name: string;
  skinId: CatSkinId;
  ready: boolean;
  connected: boolean;
  score: number;
  combo: number;
  maxCombo: number;
  lives: number;
  maxLives: number;
  accuracyPct: number;
  songProgress: number;
  y: number;
  vy: number;
  pitch: number;
  lastJudgment: JudgmentTier | null;
  alive: boolean;
  finished: boolean;
}

export interface RoomSnapshot {
  code: string;
  status: RoomStatus;
  playMode: PlayMode;
  trackMeta: MultiplayerTrackMeta;
  hasChart: boolean;
  host: RoomPlayerState;
  guest: RoomPlayerState | null;
  countdownSec: number;
  winnerRole: PlayerRole | 'draw' | null;
}

export type ClientWsMessage =
  | {
      type: 'room:create';
      playerName: string;
      skinId: CatSkinId;
      playMode: PlayMode;
      trackMeta: MultiplayerTrackMeta;
      chart: LevelChart;
    }
  | {
      type: 'room:join';
      code: string;
      playerName: string;
      skinId: CatSkinId;
    }
  | {
      type: 'room:update-track';
      code: string;
      playMode: PlayMode;
      trackMeta: MultiplayerTrackMeta;
      chart: LevelChart;
    }
  | {
      type: 'room:ready';
      code: string;
      ready: boolean;
      skinId: CatSkinId;
    }
  | {
      type: 'room:start';
      code: string;
    }
  | {
      type: 'player:telemetry';
      code: string;
      y: number;
      vy: number;
      pitch: number;
      score: number;
      combo: number;
      maxCombo: number;
      lives: number;
      maxLives: number;
      accuracyPct: number;
      songProgress: number;
      lastJudgment: JudgmentTier | null;
      alive: boolean;
    }
  | {
      type: 'player:finished';
      code: string;
      score: number;
      maxCombo: number;
      accuracyPct: number;
      lives: number;
      alive: boolean;
    }
  | {
      type: 'room:rematch';
      code: string;
    };

export type ServerWsMessage =
  | {
      type: 'room:joined';
      role: PlayerRole;
      room: RoomSnapshot;
      chart: LevelChart | null;
    }
  | {
      type: 'room:state';
      room: RoomSnapshot;
      chart?: LevelChart | null;
    }
  | {
      type: 'room:countdown';
      countdownSec: number;
    }
  | {
      type: 'room:match-start';
      room: RoomSnapshot;
      chart: LevelChart;
    }
  | {
      type: 'room:opponent-telemetry';
      opponent: RoomPlayerState;
    }
  | {
      type: 'room:match-result';
      room: RoomSnapshot;
    }
  | {
      type: 'room:error';
      message: string;
    };
