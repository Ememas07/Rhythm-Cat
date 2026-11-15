import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import {
  createRoomRecord,
  generateRoomCode,
  joinRoomRecord,
  reconnectRoomRecord,
  type ServerRoomRecord,
} from './multiplayerRoom.ts';
import type { ClientWsMessage, ServerWsMessage } from './multiplayerTypes.ts';

test('WebSocket server heartbeat ping-pong, auto-reconnect, and session recovery', async () => {
  const server = http.createServer();
  const wss = new WebSocketServer({ server });

  const rooms = new Map<string, ServerRoomRecord>();
  const roomSockets = new Map<string, { host: WebSocket | null; guest: WebSocket | null }>();
  const socketMeta = new Map<WebSocket, { code: string; role: 'host' | 'guest'; sessionToken: string }>();

  wss.on('connection', (ws) => {
    (ws as WebSocket & { isAlive?: boolean }).isAlive = true;

    ws.on('pong', () => {
      (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as ClientWsMessage;

      switch (msg.type) {
        case 'ping': {
          (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
          ws.send(JSON.stringify({ type: 'pong', timestamp: msg.timestamp } satisfies ServerWsMessage));
          break;
        }

        case 'room:create': {
          const code = generateRoomCode(new Set(rooms.keys()));
          const record = createRoomRecord({
            code,
            hostName: msg.playerName,
            hostSkinId: msg.skinId,
            playMode: msg.playMode,
            trackMeta: msg.trackMeta,
            chart: msg.chart,
          });
          rooms.set(code, record);
          roomSockets.set(code, { host: ws, guest: null });
          socketMeta.set(ws, { code, role: 'host', sessionToken: record.hostSessionToken });
          ws.send(
            JSON.stringify({
              type: 'room:joined',
              role: 'host',
              sessionToken: record.hostSessionToken,
              room: record.snapshot,
              chart: record.chart,
            } satisfies ServerWsMessage),
          );
          break;
        }

        case 'room:reconnect': {
          const record = rooms.get(msg.code);
          const socks = roomSockets.get(msg.code);
          if (!record || !socks) {
            ws.send(JSON.stringify({ type: 'room:error', message: 'Room not found' } satisfies ServerWsMessage));
            return;
          }
          const restored = reconnectRoomRecord(record, msg.role, msg.sessionToken, msg.playerName, msg.skinId);
          if (!restored.ok) {
            ws.send(JSON.stringify({ type: 'room:error', message: restored.error } satisfies ServerWsMessage));
            return;
          }
          socks[msg.role] = ws;
          socketMeta.set(ws, { code: msg.code, role: msg.role, sessionToken: msg.sessionToken });
          ws.send(
            JSON.stringify({
              type: 'room:reconnected',
              role: msg.role,
              sessionToken: msg.sessionToken,
              room: record.snapshot,
              chart: record.chart,
            } satisfies ServerWsMessage),
          );
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
      } else {
        socks.guest = null;
        if (record.snapshot.guest) record.snapshot.guest.connected = false;
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const wsUrl = `ws://127.0.0.1:${port}`;

  try {
    // 1. Connect client 1 and verify heartbeat ping-pong
    const ws1 = new WebSocket(wsUrl);
    await new Promise<void>((resolve) => ws1.on('open', resolve));

    const pingPromise = new Promise<ServerWsMessage>((resolve) => {
      ws1.on('message', (raw) => {
        const parsed = JSON.parse(String(raw)) as ServerWsMessage;
        if (parsed.type === 'pong') resolve(parsed);
      });
    });

    const sendTime = 998877;
    ws1.send(JSON.stringify({ type: 'ping', timestamp: sendTime } satisfies ClientWsMessage));
    const pongMsg = (await pingPromise) as { type: 'pong'; timestamp: number };
    assert.equal(pongMsg.type, 'pong');
    assert.equal(pongMsg.timestamp, sendTime);

    // 2. Create room and save sessionToken
    const joinPromise = new Promise<ServerWsMessage>((resolve) => {
      ws1.on('message', (raw) => {
        const parsed = JSON.parse(String(raw)) as ServerWsMessage;
        if (parsed.type === 'room:joined') resolve(parsed);
      });
    });

    ws1.send(
      JSON.stringify({
        type: 'room:create',
        playerName: 'SuperHost',
        skinId: 'marmalade',
        playMode: 'lives',
        trackMeta: {
          kind: 'synth',
          trackId: 'track-1',
          title: 'Track 1',
          subtitle: 'Chill',
          bpm: 120,
          durationSec: 30,
          accentColor: '#FFF',
          hasAudioAsset: false,
        },
        chart: {
          bpm: 120,
          firstBeatSec: 0.5,
          durationSec: 30,
          scrollSpeed: 280,
          gates: [],
          notes: [],
          beatTimes: [0.5, 1.0],
        },
      } satisfies ClientWsMessage),
    );

    const joined = (await joinPromise) as {
      type: 'room:joined';
      role: 'host';
      sessionToken: string;
      room: { code: string };
    };
    assert.equal(joined.role, 'host');
    assert.ok(joined.sessionToken);
    const roomCode = joined.room.code;

    // 3. Simulate unexpected socket close (e.g. idle timeout / WiFi drop)
    ws1.close();
    await new Promise((r) => setTimeout(r, 50));

    const roomRecord = rooms.get(roomCode);
    assert.ok(roomRecord);
    // Host should be marked disconnected, but room NOT destroyed
    assert.equal(roomRecord.snapshot.host.connected, false);

    // 4. Reconnect with new socket and sessionToken
    const ws2 = new WebSocket(wsUrl);
    await new Promise<void>((resolve) => ws2.on('open', resolve));

    const reconnectPromise = new Promise<ServerWsMessage>((resolve) => {
      ws2.on('message', (raw) => {
        const parsed = JSON.parse(String(raw)) as ServerWsMessage;
        if (parsed.type === 'room:reconnected') resolve(parsed);
      });
    });

    ws2.send(
      JSON.stringify({
        type: 'room:reconnect',
        code: roomCode,
        role: 'host',
        sessionToken: joined.sessionToken,
        playerName: 'SuperHost',
        skinId: 'marmalade',
      } satisfies ClientWsMessage),
    );

    const reconnected = (await reconnectPromise) as {
      type: 'room:reconnected';
      role: 'host';
      sessionToken: string;
      room: { code: string; host: { connected: boolean } };
    };

    assert.equal(reconnected.type, 'room:reconnected');
    assert.equal(reconnected.room.code, roomCode);
    assert.equal(reconnected.room.host.connected, true);
    assert.equal(roomRecord.snapshot.host.connected, true);

    ws2.close();
  } finally {
    wss.close();
    server.close();
  }
});
