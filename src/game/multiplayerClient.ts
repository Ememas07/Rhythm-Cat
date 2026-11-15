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
  onJoined: (
    role: PlayerRole,
    room: RoomSnapshot,
    chart: LevelChart | null,
    sessionToken: string,
  ) => void;
  onReconnected?: (
    role: PlayerRole,
    room: RoomSnapshot,
    chart: LevelChart | null,
  ) => void;
  onRoomState: (room: RoomSnapshot, chart?: LevelChart | null) => void;
  onCountdown: (countdownSec: number) => void;
  onMatchStart: (room: RoomSnapshot, chart: LevelChart) => void;
  onOpponentTelemetry: (opponent: RoomPlayerState) => void;
  onMatchResult: (room: RoomSnapshot) => void;
  onError: (message: string) => void;
  onClose?: () => void;
  onReconnecting?: (attempt: number) => void;
  onLatencyUpdate?: (rttMs: number) => void;
}

interface ClientSessionInfo {
  code: string;
  role: PlayerRole;
  sessionToken: string;
  playerName: string;
  skinId: CatSkinId;
}

const HEARTBEAT_INTERVAL_MS = 10000;
const HEARTBEAT_TIMEOUT_MS = 25000;

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private handlers: MultiplayerClientHandlers;
  private connectPromise: Promise<void> | null = null;
  private session: ClientSessionInfo | null = null;
  private explicitDisconnect = false;
  private reconnecting = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastPongTimestamp = 0;

  constructor(handlers: MultiplayerClientHandlers) {
    this.handlers = handlers;
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  public isReconnecting(): boolean {
    return this.reconnecting;
  }

  public getSession(): ClientSessionInfo | null {
    return this.session;
  }

  public connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.explicitDisconnect = false;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const url = getMultiplayerWsUrl();
      const socket = new WebSocket(url);
      this.ws = socket;

      let settled = false;

      socket.onopen = () => {
        settled = true;
        this.connectPromise = null;
        this.reconnecting = false;
        this.reconnectAttempt = 0;
        this.lastPongTimestamp = Date.now();
        this.startHeartbeat();
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
        this.stopHeartbeat();
        if (!settled) {
          settled = true;
          this.connectPromise = null;
          reject(new Error('Connection closed before joining room.'));
        }
        if (this.ws === socket) {
          this.ws = null;
        }

        if (!this.explicitDisconnect && this.session) {
          this.scheduleReconnect();
        } else {
          this.handlers.onClose?.();
        }
      };

      socket.onmessage = (event) => {
        let msg: ServerWsMessage;
        try {
          msg = JSON.parse(String(event.data)) as ServerWsMessage;
        } catch {
          return;
        }
        switch (msg.type) {
          case 'pong':
            this.lastPongTimestamp = Date.now();
            if (typeof msg.timestamp === 'number') {
              const rtt = Math.max(0, Date.now() - msg.timestamp);
              this.handlers.onLatencyUpdate?.(rtt);
            }
            break;
          case 'room:joined':
            this.session = {
              code: msg.room.code,
              role: msg.role,
              sessionToken: msg.sessionToken,
              playerName: msg.role === 'host' ? msg.room.host.name : (msg.room.guest?.name ?? ''),
              skinId: msg.role === 'host' ? msg.room.host.skinId : (msg.room.guest?.skinId ?? 'marmalade'),
            };
            this.reconnecting = false;
            this.reconnectAttempt = 0;
            this.handlers.onJoined(msg.role, msg.room, msg.chart, msg.sessionToken);
            break;
          case 'room:reconnected':
            if (this.session) {
              this.session.sessionToken = msg.sessionToken;
              this.session.role = msg.role;
            }
            this.reconnecting = false;
            this.reconnectAttempt = 0;
            this.handlers.onReconnected?.(msg.role, msg.room, msg.chart);
            this.handlers.onRoomState(msg.room, msg.chart);
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
            if (this.reconnecting) {
              this.reconnecting = false;
              this.session = null;
              this.clearReconnectTimer();
            }
            this.handlers.onError(msg.message);
            break;
        }
      };
    });

    return this.connectPromise;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastPongTimestamp = Date.now();
    this.heartbeatTimer = setInterval(() => {
      if (!this.isConnected()) return;

      const now = Date.now();
      if (this.lastPongTimestamp > 0 && now - this.lastPongTimestamp > HEARTBEAT_TIMEOUT_MS) {
        console.warn('[WS] Heartbeat timeout detected, forcing reconnect...');
        try {
          this.ws?.close();
        } catch {
          // ignore close error
        }
        return;
      }

      try {
        this.ws?.send(JSON.stringify({ type: 'ping', timestamp: now } satisfies ClientWsMessage));
      } catch {
        // ignore send error
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.explicitDisconnect || !this.session) return;

    this.reconnecting = true;
    this.reconnectAttempt++;
    this.handlers.onReconnecting?.(this.reconnectAttempt);

    const delay = Math.min(1000 * Math.pow(1.3, this.reconnectAttempt - 1), 5000);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.explicitDisconnect || !this.session) return;

      try {
        await this.connect();
        if (this.session && this.isConnected()) {
          const reconnectMsg: ClientWsMessage = {
            type: 'room:reconnect',
            code: this.session.code,
            role: this.session.role,
            sessionToken: this.session.sessionToken,
            playerName: this.session.playerName,
            skinId: this.session.skinId,
          };
          this.ws?.send(JSON.stringify(reconnectMsg));
        }
      } catch {
        // If reconnect failed, schedule next retry
        if (!this.explicitDisconnect && this.session) {
          this.scheduleReconnect();
        }
      }
    }, delay);
  }

  public leaveRoom(code?: string): void {
    const targetCode = code || this.session?.code;
    this.explicitDisconnect = true;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.reconnecting = false;
    this.reconnectAttempt = 0;

    if (targetCode && this.isConnected()) {
      try {
        this.ws?.send(JSON.stringify({ type: 'room:leave', code: targetCode } satisfies ClientWsMessage));
      } catch {
        // ignore send failure
      }
    }
    this.session = null;
    this.disconnect();
  }

  public disconnect(): void {
    this.explicitDisconnect = true;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.reconnecting = false;
    this.reconnectAttempt = 0;
    this.session = null;
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
    try {
      this.ws.send(
        JSON.stringify({
          type: 'player:telemetry',
          ...params,
        } satisfies ClientWsMessage),
      );
    } catch {
      // ignore transient telemetry write failure
    }
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
