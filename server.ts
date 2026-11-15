import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import {
  applyTelemetryToPlayer,
  canStartRoomMatch,
  createRoomRecord,
  generateRoomCode,
  joinRoomRecord,
  markPlayerFinishedInRoom,
  reconnectRoomRecord,
  removeGuestFromRoom,
  resetPlayersForMatchStart,
  resetRoomToLobby,
  setRoomPlayerReady,
  updateRoomTrackAndMode,
  type ServerRoomRecord,
} from './src/game/multiplayerRoom.ts';
import type {
  ClientWsMessage,
  PlayerRole,
  ServerWsMessage,
} from './src/game/multiplayerTypes.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

interface RoomSockets {
  host: WebSocket | null;
  guest: WebSocket | null;
  countdownTimer: ReturnType<typeof setInterval> | null;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  forfeitTimers: {
    host: ReturnType<typeof setTimeout> | null;
    guest: ReturnType<typeof setTimeout> | null;
  };
}

const rooms = new Map<string, ServerRoomRecord>();
const roomSockets = new Map<string, RoomSockets>();
const roomAudioAssets = new Map<string, { buffer: Buffer; mimeType: string }>();
const socketMeta = new Map<WebSocket, { code: string; role: PlayerRole; sessionToken: string }>();

function sendWs(ws: WebSocket | null | undefined, msg: ServerWsMessage): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(msg), (err) => {
      if (err) {
        console.warn('[WS] Send callback error:', err.message);
      }
    });
  } catch (err) {
    console.warn('[WS] Send exception:', err);
  }
}

function broadcastRoomState(code: string, includeChart = false): void {
  const record = rooms.get(code);
  const socks = roomSockets.get(code);
  if (!record || !socks) return;
  const msg: ServerWsMessage = {
    type: 'room:state',
    room: record.snapshot,
    ...(includeChart ? { chart: record.chart } : {}),
  };
  sendWs(socks.host, msg);
  sendWs(socks.guest, msg);
}

function cleanupRoomImmediate(code: string): void {
  const socks = roomSockets.get(code);
  if (socks) {
    if (socks.countdownTimer) clearInterval(socks.countdownTimer);
    if (socks.cleanupTimer) clearTimeout(socks.cleanupTimer);
    if (socks.forfeitTimers.host) clearTimeout(socks.forfeitTimers.host);
    if (socks.forfeitTimers.guest) clearTimeout(socks.forfeitTimers.guest);
    roomSockets.delete(code);
  }
  rooms.delete(code);
  roomAudioAssets.delete(code);
}

function scheduleEmptyRoomCleanup(code: string, delayMs = 60000): void {
  const socks = roomSockets.get(code);
  const record = rooms.get(code);
  if (!socks || !record) return;

  const hostOpen = socks.host && socks.host.readyState === WebSocket.OPEN;
  const guestOpen = socks.guest && socks.guest.readyState === WebSocket.OPEN;
  if (!hostOpen && !guestOpen) {
    if (!socks.cleanupTimer) {
      socks.cleanupTimer = setTimeout(() => {
        const s = roomSockets.get(code);
        if (!s) return;
        const h = s.host && s.host.readyState === WebSocket.OPEN;
        const g = s.guest && s.guest.readyState === WebSocket.OPEN;
        if (!h && !g) {
          cleanupRoomImmediate(code);
          console.log(`[Room ${code}] Cleaned up after ${Math.round(delayMs / 1000)}s idle grace period.`);
        }
      }, delayMs);
    }
  } else {
    if (socks.cleanupTimer) {
      clearTimeout(socks.cleanupTimer);
      socks.cleanupTimer = null;
    }
  }
}

async function startServer() {
  const app = express();

  app.use('/api', (_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (_req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Room MP3 upload endpoint (raw binary stream up to 25MB)
  app.post(
    '/api/rooms/:code/audio',
    express.raw({ type: '*/*', limit: '25mb' }),
    (req, res) => {
      const code = String(req.params.code || '').toUpperCase();
      const record = rooms.get(code);
      if (!record) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ error: 'Empty audio upload' });
        return;
      }
      const mimeType =
        typeof req.headers['content-type'] === 'string' &&
        req.headers['content-type'].startsWith('audio/')
          ? req.headers['content-type']
          : 'audio/mpeg';
      roomAudioAssets.set(code, { buffer: body, mimeType });
      record.snapshot.trackMeta.hasAudioAsset = true;
      broadcastRoomState(code, true);
      res.json({ ok: true, bytes: body.length });
    },
  );

  // Guest MP3 download endpoint
  app.get('/api/rooms/:code/audio', (req, res) => {
    const code = String(req.params.code || '').toUpperCase();
    const asset = roomAudioAssets.get(code);
    if (!asset) {
      res.status(404).json({ error: 'Audio not found for room' });
      return;
    }
    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Cache-Control', 'no-store');
    res.send(asset.buffer);
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, activeRooms: rooms.size });
  });

  const server = http.createServer(app);

  // WebSocket server on /ws sharing port 3000
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('error', (err) => {
    console.warn('[WSS Server Error]:', err.message);
  });

  // Periodic RFC 6455 transport-level heartbeat to keep proxies alive and detect dead sockets
  const pingInterval = setInterval(() => {
    wss.clients.forEach((client: WebSocket) => {
      const socket = client as WebSocket & { isAlive?: boolean };
      if (socket.isAlive === false) {
        return socket.terminate();
      }
      socket.isAlive = false;
      try {
        socket.ping();
      } catch {
        socket.terminate();
      }
    });
  }, 20000);

  wss.on('close', () => {
    clearInterval(pingInterval);
  });

  wss.on('connection', (ws) => {
    const sock = ws as WebSocket & { isAlive?: boolean };
    sock.isAlive = true;

    ws.on('pong', () => {
      sock.isAlive = true;
    });

    ws.on('error', (err) => {
      console.warn('[WS Client Error]:', err.message);
    });

    ws.on('message', (raw) => {
      let msg: ClientWsMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientWsMessage;
      } catch {
        sendWs(ws, { type: 'room:error', message: 'Invalid message payload.' });
        return;
      }

      switch (msg.type) {
        case 'ping': {
          sock.isAlive = true;
          sendWs(ws, { type: 'pong', timestamp: msg.timestamp });
          break;
        }

        case 'room:create': {
          const existing = new Set(rooms.keys());
          const code = generateRoomCode(existing);
          const record = createRoomRecord({
            code,
            hostName: msg.playerName,
            hostSkinId: msg.skinId,
            playMode: msg.playMode,
            trackMeta: msg.trackMeta,
            chart: msg.chart,
          });
          rooms.set(code, record);
          roomSockets.set(code, {
            host: ws,
            guest: null,
            countdownTimer: null,
            cleanupTimer: null,
            forfeitTimers: { host: null, guest: null },
          });
          socketMeta.set(ws, { code, role: 'host', sessionToken: record.hostSessionToken });
          sendWs(ws, {
            type: 'room:joined',
            role: 'host',
            sessionToken: record.hostSessionToken,
            room: record.snapshot,
            chart: record.chart,
          });
          break;
        }

        case 'room:join': {
          const code = String(msg.code || '').trim().toUpperCase();
          const record = rooms.get(code);
          const socks = roomSockets.get(code);
          if (!record || !socks) {
            sendWs(ws, { type: 'room:error', message: `Room "${code}" not found.` });
            return;
          }
          const joined = joinRoomRecord(record, msg.playerName, msg.skinId);
          if (!joined.ok) {
            sendWs(ws, { type: 'room:error', message: joined.error });
            return;
          }
          if (socks.cleanupTimer) {
            clearTimeout(socks.cleanupTimer);
            socks.cleanupTimer = null;
          }
          socks.guest = ws;
          socketMeta.set(ws, { code, role: 'guest', sessionToken: joined.sessionToken });
          sendWs(ws, {
            type: 'room:joined',
            role: 'guest',
            sessionToken: joined.sessionToken,
            room: record.snapshot,
            chart: record.chart,
          });
          broadcastRoomState(code, true);
          break;
        }

        case 'room:reconnect': {
          const code = String(msg.code || '').trim().toUpperCase();
          const record = rooms.get(code);
          const socks = roomSockets.get(code);
          if (!record || !socks) {
            sendWs(ws, { type: 'room:error', message: `Room "${code}" is no longer active.` });
            return;
          }
          const restored = reconnectRoomRecord(
            record,
            msg.role,
            msg.sessionToken,
            msg.playerName,
            msg.skinId,
          );
          if (!restored.ok) {
            sendWs(ws, { type: 'room:error', message: restored.error });
            return;
          }

          if (socks.cleanupTimer) {
            clearTimeout(socks.cleanupTimer);
            socks.cleanupTimer = null;
          }
          const activeRoleTimer = socks.forfeitTimers[msg.role];
          if (activeRoleTimer) {
            clearTimeout(activeRoleTimer);
            socks.forfeitTimers[msg.role] = null;
          }

          socks[msg.role] = ws;
          socketMeta.set(ws, { code, role: msg.role, sessionToken: msg.sessionToken });

          sendWs(ws, {
            type: 'room:reconnected',
            role: msg.role,
            sessionToken: msg.sessionToken,
            room: record.snapshot,
            chart: record.chart,
          });
          broadcastRoomState(code, true);
          break;
        }

        case 'room:leave': {
          const meta = socketMeta.get(ws);
          if (!meta) return;
          const record = rooms.get(meta.code);
          const socks = roomSockets.get(meta.code);
          socketMeta.delete(ws);
          if (!record || !socks) return;

          if (meta.role === 'host') {
            socks.host = null;
            record.snapshot.host.connected = false;
            if (socks.countdownTimer) {
              clearInterval(socks.countdownTimer);
              socks.countdownTimer = null;
            }
            if (record.snapshot.status === 'playing') {
              markPlayerFinishedInRoom(record, 'host', {
                score: record.snapshot.host.score,
                maxCombo: record.snapshot.host.maxCombo,
                accuracyPct: record.snapshot.host.accuracyPct,
                lives: 0,
                alive: false,
              });
              broadcastRoomState(meta.code);
            } else {
              sendWs(socks.guest, { type: 'room:error', message: 'Host has closed the room.' });
              cleanupRoomImmediate(meta.code);
              return;
            }
          } else {
            socks.guest = null;
            if (record.snapshot.guest) {
              if (record.snapshot.status === 'playing') {
                markPlayerFinishedInRoom(record, 'guest', {
                  score: record.snapshot.guest.score,
                  maxCombo: record.snapshot.guest.maxCombo,
                  accuracyPct: record.snapshot.guest.accuracyPct,
                  lives: 0,
                  alive: false,
                });
                broadcastRoomState(meta.code);
              } else {
                removeGuestFromRoom(record);
                broadcastRoomState(meta.code, true);
              }
            }
          }
          scheduleEmptyRoomCleanup(meta.code, 15000);
          break;
        }

        case 'room:update-track': {
          const meta = socketMeta.get(ws);
          if (!meta || meta.role !== 'host') return;
          const record = rooms.get(meta.code);
          if (!record) return;
          if (msg.trackMeta.kind !== 'mp3') {
            roomAudioAssets.delete(meta.code);
          }
          updateRoomTrackAndMode(record, msg.playMode, msg.trackMeta, msg.chart);
          broadcastRoomState(meta.code, true);
          break;
        }

        case 'room:ready': {
          const meta = socketMeta.get(ws);
          if (!meta) return;
          const record = rooms.get(meta.code);
          if (!record) return;
          setRoomPlayerReady(record, meta.role, msg.ready, msg.skinId);
          broadcastRoomState(meta.code);
          break;
        }

        case 'room:start': {
          const meta = socketMeta.get(ws);
          if (!meta || meta.role !== 'host') return;
          const record = rooms.get(meta.code);
          const socks = roomSockets.get(meta.code);
          if (!record || !socks) return;

          const check = canStartRoomMatch(record);
          if (!check.ok) {
            sendWs(ws, { type: 'room:error', message: check.error });
            return;
          }

          record.snapshot.status = 'countdown';
          record.snapshot.countdownSec = 3;
          broadcastRoomState(meta.code, true);

          if (socks.countdownTimer) clearInterval(socks.countdownTimer);
          let remaining = 3;
          sendWs(socks.host, { type: 'room:countdown', countdownSec: remaining });
          sendWs(socks.guest, { type: 'room:countdown', countdownSec: remaining });

          socks.countdownTimer = setInterval(() => {
            remaining--;
            if (remaining > 0) {
              record.snapshot.countdownSec = remaining;
              sendWs(socks.host, { type: 'room:countdown', countdownSec: remaining });
              sendWs(socks.guest, { type: 'room:countdown', countdownSec: remaining });
            } else {
              if (socks.countdownTimer) {
                clearInterval(socks.countdownTimer);
                socks.countdownTimer = null;
              }
              resetPlayersForMatchStart(record);
              const startMsg: ServerWsMessage = {
                type: 'room:match-start',
                room: record.snapshot,
                chart: record.chart,
              };
              sendWs(socks.host, startMsg);
              sendWs(socks.guest, startMsg);
            }
          }, 900);
          break;
        }

        case 'player:telemetry': {
          const meta = socketMeta.get(ws);
          if (!meta) return;
          const record = rooms.get(meta.code);
          const socks = roomSockets.get(meta.code);
          if (!record || !socks || record.snapshot.status !== 'playing') return;

          const updated = applyTelemetryToPlayer(record, meta.role, msg);
          if (!updated) return;
          const peer = meta.role === 'host' ? socks.guest : socks.host;
          sendWs(peer, { type: 'room:opponent-telemetry', opponent: updated });
          break;
        }

        case 'player:finished': {
          const meta = socketMeta.get(ws);
          if (!meta) return;
          const record = rooms.get(meta.code);
          const socks = roomSockets.get(meta.code);
          if (!record || !socks) return;

          const { matchCompleted } = markPlayerFinishedInRoom(record, meta.role, msg);
          if (matchCompleted) {
            const resMsg: ServerWsMessage = {
              type: 'room:match-result',
              room: record.snapshot,
            };
            sendWs(socks.host, resMsg);
            sendWs(socks.guest, resMsg);
          } else {
            broadcastRoomState(meta.code);
          }
          break;
        }

        case 'room:rematch': {
          const meta = socketMeta.get(ws);
          if (!meta) return;
          const record = rooms.get(meta.code);
          if (!record) return;
          resetRoomToLobby(record);
          broadcastRoomState(meta.code, true);
          break;
        }
      }
    });

    ws.on('close', () => {
      const meta = socketMeta.get(ws);
      if (!meta) return;
      socketMeta.delete(ws);

      const record = rooms.get(meta.code);
      const socks = roomSockets.get(meta.code);
      if (!record || !socks) return;

      if (meta.role === 'host') {
        socks.host = null;
        record.snapshot.host.connected = false;
        if (record.snapshot.status === 'playing') {
          // 15-second grace period before auto-forfeiting in active match
          if (socks.forfeitTimers.host) clearTimeout(socks.forfeitTimers.host);
          socks.forfeitTimers.host = setTimeout(() => {
            const s = roomSockets.get(meta.code);
            const r = rooms.get(meta.code);
            if (s && r && r.snapshot.status === 'playing' && !r.snapshot.host.connected) {
              const { matchCompleted } = markPlayerFinishedInRoom(r, 'host', {
                score: r.snapshot.host.score,
                maxCombo: r.snapshot.host.maxCombo,
                accuracyPct: r.snapshot.host.accuracyPct,
                lives: 0,
                alive: false,
              });
              if (matchCompleted) {
                const resMsg: ServerWsMessage = {
                  type: 'room:match-result',
                  room: r.snapshot,
                };
                sendWs(s.host, resMsg);
                sendWs(s.guest, resMsg);
              } else {
                broadcastRoomState(meta.code);
              }
            }
          }, 15000);
        }
      } else {
        socks.guest = null;
        if (record.snapshot.guest) {
          record.snapshot.guest.connected = false;
          record.snapshot.guest.ready = false;
          if (record.snapshot.status === 'playing') {
            // 15-second grace period before auto-forfeiting in active match
            if (socks.forfeitTimers.guest) clearTimeout(socks.forfeitTimers.guest);
            socks.forfeitTimers.guest = setTimeout(() => {
              const s = roomSockets.get(meta.code);
              const r = rooms.get(meta.code);
              if (s && r && r.snapshot.status === 'playing' && r.snapshot.guest && !r.snapshot.guest.connected) {
                const { matchCompleted } = markPlayerFinishedInRoom(r, 'guest', {
                  score: r.snapshot.guest.score,
                  maxCombo: r.snapshot.guest.maxCombo,
                  accuracyPct: r.snapshot.guest.accuracyPct,
                  lives: 0,
                  alive: false,
                });
                if (matchCompleted) {
                  const resMsg: ServerWsMessage = {
                    type: 'room:match-result',
                    room: r.snapshot,
                  };
                  sendWs(s.host, resMsg);
                  sendWs(s.guest, resMsg);
                } else {
                  broadcastRoomState(meta.code);
                }
              }
            }, 15000);
          }
        }
      }

      if (record.snapshot.status === 'finished') {
        const resMsg: ServerWsMessage = {
          type: 'room:match-result',
          room: record.snapshot,
        };
        sendWs(socks.host, resMsg);
        sendWs(socks.guest, resMsg);
      } else {
        broadcastRoomState(meta.code);
      }
      scheduleEmptyRoomCleanup(meta.code, 60000);
    });
  });

  if (IS_PROD) {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Sausage Cat Beat server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
