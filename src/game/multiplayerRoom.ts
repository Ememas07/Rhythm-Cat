import type {
  MultiplayerTrackMeta,
  PlayerRole,
  RoomPlayerState,
  RoomSnapshot,
} from './multiplayerTypes.ts';
import type { CatSkinId } from './skins.ts';
import type { JudgmentTier, LevelChart, PlayMode } from './types.ts';

export interface ServerRoomRecord {
  snapshot: RoomSnapshot;
  chart: LevelChart;
  createdAtMs: number;
  hostSessionToken: string;
  guestSessionToken: string | null;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateSessionToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `tok_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

export function generateRoomCode(existingCodes: Set<string>): string {
  for (let attempt = 0; attempt < 40; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!existingCodes.has(code)) return code;
  }
  return `CAT${Date.now().toString(36).slice(-3).toUpperCase()}`;
}

export function createInitialPlayerState(
  role: PlayerRole,
  name: string,
  skinId: CatSkinId,
  playMode: PlayMode,
): RoomPlayerState {
  const maxLives = playMode === 'sudden-death' ? 1 : 3;
  return {
    role,
    name: sanitizePlayerName(name, role === 'host' ? 'Host Cat' : 'Guest Cat'),
    skinId,
    ready: role === 'host',
    connected: true,
    score: 0,
    combo: 0,
    maxCombo: 0,
    lives: maxLives,
    maxLives,
    accuracyPct: 100,
    songProgress: 0,
    y: 310,
    vy: 0,
    pitch: 0,
    lastJudgment: null,
    alive: true,
    finished: false,
  };
}

export function sanitizePlayerName(raw: string, fallback: string): string {
  const trimmed = (raw || '').trim().slice(0, 18);
  return trimmed.length > 0 ? trimmed : fallback;
}

export function createRoomRecord(params: {
  code: string;
  hostName: string;
  hostSkinId: CatSkinId;
  playMode: PlayMode;
  trackMeta: MultiplayerTrackMeta;
  chart: LevelChart;
  sessionToken?: string;
}): ServerRoomRecord {
  const hostSessionToken = params.sessionToken || generateSessionToken();
  return {
    snapshot: {
      code: params.code,
      status: 'waiting',
      playMode: params.playMode,
      trackMeta: params.trackMeta,
      hasChart: true,
      host: createInitialPlayerState('host', params.hostName, params.hostSkinId, params.playMode),
      guest: null,
      countdownSec: 0,
      winnerRole: null,
    },
    chart: params.chart,
    createdAtMs: Date.now(),
    hostSessionToken,
    guestSessionToken: null,
  };
}

export function joinRoomRecord(
  record: ServerRoomRecord,
  guestName: string,
  guestSkinId: CatSkinId,
  sessionToken?: string,
): { ok: true; sessionToken: string } | { ok: false; error: string } {
  if (record.snapshot.status === 'playing' || record.snapshot.status === 'countdown') {
    return { ok: false, error: 'Match is already in progress.' };
  }
  if (record.snapshot.guest && record.snapshot.guest.connected) {
    return { ok: false, error: 'Room already has 2 players.' };
  }
  const token = sessionToken || generateSessionToken();
  record.guestSessionToken = token;
  record.snapshot.guest = createInitialPlayerState(
    'guest',
    guestName,
    guestSkinId,
    record.snapshot.playMode,
  );
  return { ok: true, sessionToken: token };
}

export function reconnectRoomRecord(
  record: ServerRoomRecord,
  role: PlayerRole,
  sessionToken: string,
  playerName?: string,
  skinId?: CatSkinId,
): { ok: true } | { ok: false; error: string } {
  const expectedToken = role === 'host' ? record.hostSessionToken : record.guestSessionToken;
  if (!expectedToken || expectedToken !== sessionToken) {
    return { ok: false, error: 'Invalid or expired session token.' };
  }
  const player = role === 'host' ? record.snapshot.host : record.snapshot.guest;
  if (!player) {
    return { ok: false, error: 'Player slot not found in room.' };
  }
  player.connected = true;
  if (playerName) player.name = sanitizePlayerName(playerName, player.name);
  if (skinId) player.skinId = skinId;
  return { ok: true };
}

export function removeGuestFromRoom(record: ServerRoomRecord): void {
  record.snapshot.guest = null;
  record.guestSessionToken = null;
}

export function updateRoomTrackAndMode(
  record: ServerRoomRecord,
  playMode: PlayMode,
  trackMeta: MultiplayerTrackMeta,
  chart: LevelChart,
): void {
  record.snapshot.playMode = playMode;
  record.snapshot.trackMeta = trackMeta;
  record.snapshot.hasChart = true;
  record.chart = chart;

  const maxLives = playMode === 'sudden-death' ? 1 : 3;
  record.snapshot.host.maxLives = maxLives;
  record.snapshot.host.lives = maxLives;
  if (record.snapshot.guest) {
    record.snapshot.guest.maxLives = maxLives;
    record.snapshot.guest.lives = maxLives;
    record.snapshot.guest.ready = false;
  }
}

export function setRoomPlayerReady(
  record: ServerRoomRecord,
  role: PlayerRole,
  ready: boolean,
  skinId: CatSkinId,
): void {
  const player = role === 'host' ? record.snapshot.host : record.snapshot.guest;
  if (!player) return;
  player.ready = ready;
  player.skinId = skinId;
}

export function canStartRoomMatch(record: ServerRoomRecord): { ok: true } | { ok: false; error: string } {
  const { snapshot } = record;
  if (snapshot.status !== 'waiting') {
    return { ok: false, error: 'Match already starting or active.' };
  }
  if (!snapshot.guest || !snapshot.guest.connected) {
    return { ok: false, error: 'Waiting for a second player to join.' };
  }
  if (!snapshot.guest.ready) {
    return { ok: false, error: 'Opponent is not ready yet.' };
  }
  if (snapshot.trackMeta.kind === 'mp3' && !snapshot.trackMeta.hasAudioAsset) {
    return { ok: false, error: 'MP3 audio is still uploading to the room.' };
  }
  return { ok: true };
}

export function resetPlayersForMatchStart(record: ServerRoomRecord): void {
  const maxLives = record.snapshot.playMode === 'sudden-death' ? 1 : 3;
  const resetSlot = (p: RoomPlayerState | null) => {
    if (!p) return;
    p.score = 0;
    p.combo = 0;
    p.maxCombo = 0;
    p.lives = maxLives;
    p.maxLives = maxLives;
    p.accuracyPct = 100;
    p.songProgress = 0;
    p.y = 310;
    p.vy = 0;
    p.pitch = 0;
    p.lastJudgment = null;
    p.alive = true;
    p.finished = false;
  };
  resetSlot(record.snapshot.host);
  resetSlot(record.snapshot.guest);
  record.snapshot.winnerRole = null;
  record.snapshot.countdownSec = 0;
  record.snapshot.status = 'playing';
}

export function applyTelemetryToPlayer(
  record: ServerRoomRecord,
  role: PlayerRole,
  payload: {
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
  },
): RoomPlayerState | null {
  const player = role === 'host' ? record.snapshot.host : record.snapshot.guest;
  if (!player) return null;
  player.y = payload.y;
  player.vy = payload.vy;
  player.pitch = payload.pitch;
  player.score = payload.score;
  player.combo = payload.combo;
  player.maxCombo = Math.max(player.maxCombo, payload.maxCombo);
  player.lives = payload.lives;
  player.maxLives = payload.maxLives;
  player.accuracyPct = payload.accuracyPct;
  player.songProgress = payload.songProgress;
  player.lastJudgment = payload.lastJudgment;
  player.alive = payload.alive;
  return player;
}

export function resolveMatchWinner(
  host: RoomPlayerState,
  guest: RoomPlayerState,
): PlayerRole | 'draw' {
  if (host.alive !== guest.alive) {
    return host.alive ? 'host' : 'guest';
  }
  if (host.score !== guest.score) {
    return host.score > guest.score ? 'host' : 'guest';
  }
  if (host.accuracyPct !== guest.accuracyPct) {
    return host.accuracyPct > guest.accuracyPct ? 'host' : 'guest';
  }
  return 'draw';
}

export function markPlayerFinishedInRoom(
  record: ServerRoomRecord,
  role: PlayerRole,
  result: {
    score: number;
    maxCombo: number;
    accuracyPct: number;
    lives: number;
    alive: boolean;
  },
): { matchCompleted: boolean } {
  const player = role === 'host' ? record.snapshot.host : record.snapshot.guest;
  if (!player) return { matchCompleted: false };

  player.score = result.score;
  player.maxCombo = Math.max(player.maxCombo, result.maxCombo);
  player.accuracyPct = result.accuracyPct;
  player.lives = result.lives;
  player.alive = result.alive;
  player.finished = true;

  const { host, guest } = record.snapshot;
  if (!guest || !guest.connected) {
    record.snapshot.status = 'finished';
    record.snapshot.winnerRole = 'host';
    return { matchCompleted: true };
  }

  if (host.finished && guest.finished) {
    record.snapshot.status = 'finished';
    record.snapshot.winnerRole = resolveMatchWinner(host, guest);
    return { matchCompleted: true };
  }

  return { matchCompleted: false };
}

export function resetRoomToLobby(record: ServerRoomRecord): void {
  record.snapshot.status = 'waiting';
  record.snapshot.winnerRole = null;
  record.snapshot.countdownSec = 0;
  record.snapshot.host.ready = true;
  record.snapshot.host.finished = false;
  record.snapshot.host.alive = true;
  record.snapshot.host.score = 0;
  if (record.snapshot.guest) {
    record.snapshot.guest.ready = false;
    record.snapshot.guest.finished = false;
    record.snapshot.guest.alive = true;
    record.snapshot.guest.score = 0;
  }
}
