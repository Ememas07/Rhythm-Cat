import type {
  ClientWsMessage,
  MultiplayerTrackMeta,
  PlayerRole,
  RoomPlayerState,
  RoomSnapshot,
  ServerWsMessage,
} from './multiplayerTypes';
import type { CatSkinId } from './skins';
import type { JudgmentTier, LevelChart, PlayMode } from './types';

function getConfiguredServerBase(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const raw = env?.VITE_MULTIPLAYER_SERVER_URL?.trim() ?? '';
  return raw.replace(/\/+$/, '');
}

export function getMultiplayerWsUrl(overrideBase?: string): string {
  const configured = (overrideBase ?? getConfiguredServerBase()).trim().replace(/\/+$/, '');
  if (configured) {
    const wsBase = configured
      .replace(/^https:\/\//i, 'wss://')
      .replace(/^http:\/\//i, 'ws://');
    return wsBase.endsWith('/ws') ? wsBase : `${wsBase}/ws`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

export function getMultiplayerHttpBase(overrideBase?: string): string {
  const configured = (overrideBase ?? getConfiguredServerBase()).trim().replace(/\/+$/, '');
  if (!configured) return '';
  return configured
    .replace(/^wss:\/\//i, 'https://')
    .replace(/^ws:\/\//i, 'http://')
    .replace(/\/ws$/i, '');
}

export interface MultiplayerClientHandlers {
  onJoined: (role: PlayerRole, room: RoomSnapshot, chart: LevelChart | null) => void;
  onRoomState: (room: RoomSnapshot, chart?: LevelChart | null) => void;
  onCountdown: (countdownSec: number) => void;
  onMatchStart: (room: RoomSnapshot, chart: LevelChart) => void;
  onOpponentTelemetry: (opponent: RoomPlayerState) => void;
  onMatchResult: (room: RoomSnapshot) => void;
  onError: (message: string) => void;
  onClose?: () => void;
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private handlers: MultiplayerClientHandlers;
  private connectPromise: Promise<void> | null = null;

  constructor(handlers: MultiplayerClientHandlers) {
    this.handlers = handlers;
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  public connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const url = getMultiplayerWsUrl();
      const socket = new WebSocket(url);
      this.ws = socket;

      let settled = false;

      socket.onopen = () => {
        settled = true;
        this.connectPromise = null;
        resolve();
      };

      socket.onerror = () => {
        if (!settled) {
          settled = true;
          this.connectPromise = null;
          const isStaticGithubPages =
            !getConfiguredServerBase() && window.location.hostname.endsWith('github.io');
          const msg = isStaticGithubPages
            ? 'Could not connect: GitHub Pages only hosts static files and does not run server.ts. Deploy server.ts on Render/Railway/Fly.io and build with VITE_MULTIPLAYER_SERVER_URL, or open the Node/Cloud Run app URL.'
            : 'Could not connect to multiplayer server.';
          reject(new Error(msg));
        } else {
          this.handlers.onError('Multiplayer connection error.');
        }
      };

      socket.onclose = () => {
        if (!settled) {
          settled = true;
          this.connectPromise = null;
          reject(new Error('Connection closed before joining room.'));
        }
        if (this.ws === socket) {
          this.ws = null;
        }
        this.handlers.onClose?.();
      };

      socket.onmessage = (event) => {
        let msg: ServerWsMessage;
        try {
          msg = JSON.parse(String(event.data)) as ServerWsMessage;
        } catch {
          return;
        }
        switch (msg.type) {
          case 'room:joined':
            this.handlers.onJoined(msg.role, msg.room, msg.chart);
            break;
          case 'room:state':
            this.handlers.onRoomState(msg.room, msg.chart);
            break;
          case 'room:countdown':
            this.handlers.onCountdown(msg.countdownSec);
            break;
          case 'room:match-start':
            this.handlers.onMatchStart(msg.room, msg.chart);
            break;
          case 'room:opponent-telemetry':
            this.handlers.onOpponentTelemetry(msg.opponent);
            break;
          case 'room:match-result':
            this.handlers.onMatchResult(msg.room);
            break;
          case 'room:error':
            this.handlers.onError(msg.message);
            break;
        }
      };
    });

    return this.connectPromise;
  }

  public disconnect(): void {
    this.connectPromise = null;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore close failure
      }
      this.ws = null;
    }
  }

  private async sendMessage(msg: ClientWsMessage): Promise<void> {
    await this.connect();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Multiplayer socket is not open.');
    }
    this.ws.send(JSON.stringify(msg));
  }

  public async createRoom(params: {
    playerName: string;
    skinId: CatSkinId;
    playMode: PlayMode;
    trackMeta: MultiplayerTrackMeta;
    chart: LevelChart;
  }): Promise<void> {
    await this.sendMessage({
      type: 'room:create',
      ...params,
    });
  }

  public async joinRoom(params: {
    code: string;
    playerName: string;
    skinId: CatSkinId;
  }): Promise<void> {
    await this.sendMessage({
      type: 'room:join',
      ...params,
    });
  }

  public async updateTrack(params: {
    code: string;
    playMode: PlayMode;
    trackMeta: MultiplayerTrackMeta;
    chart: LevelChart;
  }): Promise<void> {
    await this.sendMessage({
      type: 'room:update-track',
      ...params,
    });
  }

  public async setReady(code: string, ready: boolean, skinId: CatSkinId): Promise<void> {
    await this.sendMessage({
      type: 'room:ready',
      code,
      ready,
      skinId,
    });
  }

  public async startMatch(code: string): Promise<void> {
    await this.sendMessage({
      type: 'room:start',
      code,
    });
  }

  public sendTelemetry(params: {
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
  }): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: 'player:telemetry',
        ...params,
      } satisfies ClientWsMessage),
    );
  }

  public async sendFinished(params: {
    code: string;
    score: number;
    maxCombo: number;
    accuracyPct: number;
    lives: number;
    alive: boolean;
  }): Promise<void> {
    await this.sendMessage({
      type: 'player:finished',
      ...params,
    });
  }

  public async requestRematch(code: string): Promise<void> {
    await this.sendMessage({
      type: 'room:rematch',
      code,
    });
  }
}

export async function uploadRoomAudio(
  code: string,
  buffer: ArrayBuffer,
  mimeType: string,
): Promise<void> {
  const base = getMultiplayerHttpBase();
  const res = await fetch(`${base}/api/rooms/${encodeURIComponent(code)}/audio`, {
    method: 'POST',
    headers: {
      'Content-Type': mimeType || 'audio/mpeg',
    },
    body: buffer,
  });
  if (!res.ok) {
    let errText = 'Failed to upload MP3 audio to room.';
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) errText = data.error;
    } catch {
      // ignore json parse failure
    }
    throw new Error(errText);
  }
}

export async function fetchRoomAudio(code: string): Promise<ArrayBuffer> {
  const base = getMultiplayerHttpBase();
  const res = await fetch(`${base}/api/rooms/${encodeURIComponent(code)}/audio`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error('Could not download host MP3 audio.');
  }
  return res.arrayBuffer();
}
