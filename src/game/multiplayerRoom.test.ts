import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canStartRoomMatch,
  createRoomRecord,
  generateRoomCode,
  joinRoomRecord,
  markPlayerFinishedInRoom,
  resetPlayersForMatchStart,
  resetRoomToLobby,
  resolveMatchWinner,
  setRoomPlayerReady,
} from './multiplayerRoom.ts';
import { getMultiplayerHttpBase, getMultiplayerWsUrl } from './multiplayerClient.ts';
import type { LevelChart } from './types.ts';

const SAMPLE_CHART: LevelChart = {
  bpm: 120,
  firstBeatSec: 0.25,
  durationSec: 40,
  scrollSpeed: 280,
  gates: [],
  notes: [],
  beatTimes: [0.25, 0.75, 1.25],
};

test('1v1 room lifecycle: create, join, ready, MP3 audio check, start, finish, and rematch', () => {
  const code = generateRoomCode(new Set());
  assert.equal(code.length, 6);

  const record = createRoomRecord({
    code,
    hostName: 'HostLoaf',
    hostSkinId: 'marmalade',
    playMode: 'lives',
    trackMeta: {
      kind: 'mp3',
      trackId: 'mp3-1',
      title: 'Custom Jam',
      subtitle: 'Auto-Generated Level',
      bpm: 120,
      durationSec: 40,
      accentColor: '#38BDF8',
      hasAudioAsset: false,
    },
    chart: SAMPLE_CHART,
  });

  // Cannot start without guest
  assert.equal(canStartRoomMatch(record).ok, false);

  // Guest joins
  const joined = joinRoomRecord(record, 'RivalCat', 'tuxedo');
  assert.equal(joined.ok, true);
  assert.equal(record.snapshot.guest?.name, 'RivalCat');

  // Cannot join a 3rd player
  const third = joinRoomRecord(record, 'ExtraCat', 'royal');
  assert.equal(third.ok, false);

  // Guest readies up, but MP3 audio hasn't uploaded yet
  setRoomPlayerReady(record, 'guest', true, 'tuxedo');
  assert.equal(canStartRoomMatch(record).ok, false);

  // Mark MP3 uploaded -> ready to start
  record.snapshot.trackMeta.hasAudioAsset = true;
  assert.equal(canStartRoomMatch(record).ok, true);

  resetPlayersForMatchStart(record);
  assert.equal(record.snapshot.status, 'playing');

  // Host finishes alive with 1800 pts, guest wiped out
  const res1 = markPlayerFinishedInRoom(record, 'host', {
    score: 1800,
    maxCombo: 12,
    accuracyPct: 90,
    lives: 2,
    alive: true,
  });
  assert.equal(res1.matchCompleted, false);

  const res2 = markPlayerFinishedInRoom(record, 'guest', {
    score: 2100,
    maxCombo: 9,
    accuracyPct: 75,
    lives: 0,
    alive: false,
  });
  assert.equal(res2.matchCompleted, true);
  assert.equal(record.snapshot.winnerRole, 'host');

  // Rematch resets back to waiting lobby
  resetRoomToLobby(record);
  assert.equal(record.snapshot.status, 'waiting');
  assert.equal(record.snapshot.winnerRole, null);
});

test('resolveMatchWinner compares survival first, then score, then accuracy', () => {
  const base = createRoomRecord({
    code: 'CAT123',
    hostName: 'A',
    hostSkinId: 'marmalade',
    playMode: 'lives',
    trackMeta: {
      kind: 'synth',
      trackId: 'midnight-loaf',
      title: 'Midnight Loaf',
      subtitle: 'Chill',
      bpm: 96,
      durationSec: 46,
      accentColor: '#FFB830',
      hasAudioAsset: false,
    },
    chart: SAMPLE_CHART,
  });
  joinRoomRecord(base, 'B', 'tuxedo');
  const h = base.snapshot.host;
  const g = base.snapshot.guest!;
  h.alive = true;
  g.alive = true;
  h.score = 1500;
  g.score = 1750;
  assert.equal(resolveMatchWinner(h, g), 'guest');

  g.score = 1500;
  h.accuracyPct = 92;
  g.accuracyPct = 88;
  assert.equal(resolveMatchWinner(h, g), 'host');
});

test('getMultiplayerWsUrl and getMultiplayerHttpBase map external backend URLs cleanly', () => {
  assert.equal(
    getMultiplayerWsUrl('https://rhythm-cat-server.onrender.com/'),
    'wss://rhythm-cat-server.onrender.com/ws',
  );
  assert.equal(
    getMultiplayerHttpBase('wss://rhythm-cat-server.onrender.com/ws'),
    'https://rhythm-cat-server.onrender.com',
  );
  assert.equal(getMultiplayerHttpBase(''), '');
});
