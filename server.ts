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
}

const rooms = new Map<string, ServerRoomRecord>();
const roomSockets = new Map<string, RoomSockets>();
const roomAudioAssets = new Map<string, { buffer: Buffer; mimeType: string }>();
const socketMeta = new Map<WebSocket, { code: string; role: PlayerRole }>();

function sendWs(ws: WebSocket | null | undefined, msg: ServerWsMessage): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
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

function cleanupRoomIfEmpty(code: string): void {
  const socks = roomSockets.get(code);
  const record = rooms.get(code);
  if (!socks || !record) return;
  const hostOpen = socks.host && socks.host.readyState === WebSocket.OPEN;
  const guestOpen = socks.guest && socks.guest.readyState === WebSocket.OPEN;
  if (!hostOpen && !guestOpen) {
    if (socks.countdownTimer) clearInterval(socks.countdownTimer);
    roomSockets.delete(code);
    rooms.delete(code);
    roomAudioAssets.delete(code);
  }
}

async function startServer() {
  const app = express();

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

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg: ClientWsMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientWsMessage;
      } catch {
        sendWs(ws, { type: 'room:error', message: 'Invalid message payload.' });
        return;
      }

      switch (msg.type) {
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
          roomSockets.set(code, { host: ws, guest: null, countdownTimer: null });
          socketMeta.set(ws, { code, role: 'host' });
          sendWs(ws, {
            type: 'room:joined',
            role: 'host',
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
          socks.guest = ws;
          socketMeta.set(ws, { code, role: 'guest' });
          sendWs(ws, {
            type: 'room:joined',
            role: 'guest',
            room: record.snapshot,
            chart: record.chart,
          });
          broadcastRoomState(code, true);
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
          markPlayerFinishedInRoom(record, 'host', {
            score: record.snapshot.host.score,
            maxCombo: record.snapshot.host.maxCombo,
            accuracyPct: record.snapshot.host.accuracyPct,
            lives: 0,
            alive: false,
          });
        }
      } else {
        socks.guest = null;
        if (record.snapshot.guest) {
          record.snapshot.guest.connected = false;
          record.snapshot.guest.ready = false;
          if (record.snapshot.status === 'playing') {
            markPlayerFinishedInRoom(record, 'guest', {
              score: record.snapshot.guest.score,
              maxCombo: record.snapshot.guest.maxCombo,
              accuracyPct: record.snapshot.guest.accuracyPct,
              lives: 0,
              alive: false,
            });
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
      cleanupRoomIfEmpty(meta.code);
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
