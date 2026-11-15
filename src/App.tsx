import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HudOverlay } from './components/HudOverlay';
import { MultiplayerModal } from './components/MultiplayerModal';
import { StatusModal } from './components/StatusModal';
import { TitleOverlay } from './components/TitleOverlay';
import { RhythmAudioEngine } from './game/audioEngine';
import { SausageCatEngine } from './game/engine';
import { generateLevelFromAnalysis } from './game/levelGenerator';
import {
  fetchRoomAudio,
  MultiplayerClient,
  uploadRoomAudio,
} from './game/multiplayerClient';
import type {
  MultiplayerTrackMeta,
  PlayerRole,
  RoomPlayerState,
  RoomSnapshot,
} from './game/multiplayerTypes';
import {
  evaluateSkinUnlocks,
  loadPlayerProgress,
  savePlayerProgress,
  type CatSkinId,
  type PlayerProgress,
} from './game/skins';
import { buildSynthTrackAnalysis, BUILTIN_TRACKS } from './game/tracks';
import type {
  AudioAnalysisResult,
  BossId,
  ControlMode,
  DifficultyLevel,
  GameMode,
  GameState,
  HudSnapshot,
  LevelChart,
  Mp3TrackConfig,
  PlayMode,
  RunStats,
  TrackConfig,
} from './game/types';

const PLAYER_NAME_STORAGE_KEY = 'sausage-cat-player-name';

function loadPlayerName(): string {
  try {
    const saved = localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
    if (saved && saved.trim()) return saved.trim().slice(0, 18);
  } catch {
    // ignore storage restrictions
  }
  return 'SausageCat';
}

const INITIAL_HUD: HudSnapshot = {
  score: 0,
  bestScore: 0,
  combo: 0,
  multiplier: 1,
  lives: 3,
  maxLives: 3,
  infiniteLives: false,
  hitsTaken: 0,
  scoreCounted: true,
  difficulty: 'normal',
  autoMode: false,
  rhythmOnlyMode: false,
  accuracyPct: 100,
  songProgress: 0,
  lastJudgment: null,
  lastJudgmentSeq: 0,
  bpm: BUILTIN_TRACKS[0].bpm,
  trackTitle: BUILTIN_TRACKS[0].title,
  gameMode: 'arcade',
  bossName: null,
  bossHp: 0,
  bossMaxHp: 0,
  bossGhostHp: 0,
  bossAttackLabel: null,
};

function buildTrackMeta(track: TrackConfig, hasAudioAsset: boolean): MultiplayerTrackMeta {
  return {
    kind: track.kind,
    trackId: track.id,
    title: track.title,
    subtitle: track.subtitle,
    bpm: track.bpm,
    durationSec: track.durationSec,
    accentColor: track.accentColor,
    hasAudioAsset,
  };
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<SausageCatEngine | null>(null);
  const audioRef = useRef<RhythmAudioEngine | null>(null);

  const [progress, setProgress] = useState<PlayerProgress>(() => loadPlayerProgress());
  const [gameState, setGameState] = useState<GameState>('title');
  const [gameMode, setGameMode] = useState<GameMode>('arcade');
  const [playMode, setPlayMode] = useState<PlayMode>('lives');
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('normal');
  const [controlMode, setControlMode] = useState<ControlMode>('manual');
  const [bossId, setBossId] = useState<BossId>('metronome');
  const [selectedTrackId, setSelectedTrackId] = useState<string>(BUILTIN_TRACKS[0].id);

  const [importedTrack, setImportedTrack] = useState<Mp3TrackConfig | null>(null);
  const [importedAnalysis, setImportedAnalysis] = useState<AudioAnalysisResult | null>(null);
  const importedMp3RawRef = useRef<{
    trackId: string;
    rawBuffer: ArrayBuffer;
    mimeType: string;
  } | null>(null);
  const [mp3Importing, setMp3Importing] = useState(false);
  const [mp3Error, setMp3Error] = useState<string | null>(null);

  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.85);
  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [endStats, setEndStats] = useState<RunStats | null>(null);
  const [newlyUnlockedSkins, setNewlyUnlockedSkins] = useState<CatSkinId[]>([]);

  // 1v1 Multiplayer State
  const [playerName, setPlayerName] = useState<string>(() => loadPlayerName());
  const [initialJoinCode] = useState<string>(() => {
    const code = new URLSearchParams(window.location.search).get('room');
    return code ? code.trim().toUpperCase() : '';
  });
  const [mpModalOpen, setMpModalOpen] = useState<boolean>(() => {
    const code = new URLSearchParams(window.location.search).get('room');
    return Boolean(code && code.trim().length > 0);
  });
  const [mpRole, setMpRole] = useState<PlayerRole | null>(null);
  const [mpRoom, setMpRoom] = useState<RoomSnapshot | null>(null);
  const [mpOpponent, setMpOpponent] = useState<RoomPlayerState | null>(null);
  const [mpBusy, setMpBusy] = useState(false);
  const [mpError, setMpError] = useState<string | null>(null);
  const [mpCountdown, setMpCountdown] = useState(0);
  const [mpAudioSyncStatus, setMpAudioSyncStatus] = useState<
    'idle' | 'uploading' | 'downloading' | 'ready' | 'error'
  >('idle');

  const mpClientRef = useRef<MultiplayerClient | null>(null);
  const mpRoomRef = useRef<RoomSnapshot | null>(null);
  const mpRoleRef = useRef<PlayerRole | null>(null);
  const guestMp3TrackRef = useRef<{
    trackId: string;
    audioBuffer: AudioBuffer;
  } | null>(null);
  const syncedGuestAudioKeyRef = useRef<string | null>(null);

  mpRoomRef.current = mpRoom;
  mpRoleRef.current = mpRole;

  const synthAnalyses = useMemo(() => {
    const map = new Map<string, AudioAnalysisResult>();
    for (const t of BUILTIN_TRACKS) {
      map.set(t.id, buildSynthTrackAnalysis(t));
    }
    return map;
  }, []);

  const activeTrack: TrackConfig = useMemo(() => {
    if (importedTrack && selectedTrackId === importedTrack.id) {
      return importedTrack;
    }
    return BUILTIN_TRACKS.find((t) => t.id === selectedTrackId) ?? BUILTIN_TRACKS[0];
  }, [importedTrack, selectedTrackId]);

  const activeAnalysis: AudioAnalysisResult = useMemo(() => {
    if (importedTrack && importedAnalysis && selectedTrackId === importedTrack.id) {
      return importedAnalysis;
    }
    return synthAnalyses.get(activeTrack.id) ?? buildSynthTrackAnalysis(BUILTIN_TRACKS[0]);
  }, [activeTrack.id, importedAnalysis, importedTrack, selectedTrackId, synthAnalyses]);

  // Keep latest config values in a ref for engine & WebSocket callbacks without re-mounting
  const latestConfigRef = useRef({
    activeTrack,
    activeAnalysis,
    gameMode,
    playMode,
    difficulty,
    controlMode,
    bossId,
    progress,
    importedTrack,
  });
  latestConfigRef.current = {
    activeTrack,
    activeAnalysis,
    gameMode,
    playMode,
    difficulty,
    controlMode,
    bossId,
    progress,
    importedTrack,
  };

  // Sync body dataset state
  useEffect(() => {
    document.body.dataset.state = gameState;
  }, [gameState]);

  // Helper to download and decode Host MP3 for Guest when needed
  const syncGuestAudioIfNeeded = useCallback(async (role: PlayerRole | null, room: RoomSnapshot) => {
    if (role !== 'guest') return;
    if (room.trackMeta.kind !== 'mp3') {
      setMpAudioSyncStatus('ready');
      return;
    }
    if (!room.trackMeta.hasAudioAsset) {
      setMpAudioSyncStatus('idle');
      return;
    }

    const syncKey = `${room.code}:${room.trackMeta.trackId}`;
    if (
      syncedGuestAudioKeyRef.current === syncKey &&
      guestMp3TrackRef.current?.trackId === room.trackMeta.trackId
    ) {
      setMpAudioSyncStatus('ready');
      return;
    }

    setMpAudioSyncStatus('downloading');
    try {
      const buf = await fetchRoomAudio(room.code);
      if (!audioRef.current) return;
      const decoded = await audioRef.current.decodeMp3ArrayBuffer(buf);
      guestMp3TrackRef.current = {
        trackId: room.trackMeta.trackId,
        audioBuffer: decoded,
      };
      syncedGuestAudioKeyRef.current = syncKey;
      setMpAudioSyncStatus('ready');
    } catch {
      setMpAudioSyncStatus('error');
      setMpError('Failed to download or decode Host MP3 track.');
    }
  }, []);

  // Upload Host MP3 bytes when Host creates/updates a room with an MP3 track
  const uploadHostAudioIfNeeded = useCallback(async (code: string, track: TrackConfig) => {
    if (track.kind !== 'mp3') {
      setMpAudioSyncStatus('ready');
      return;
    }
    const raw = importedMp3RawRef.current;
    if (!raw || raw.trackId !== track.id) {
      setMpAudioSyncStatus('error');
      setMpError('Please re-import your .MP3 file before hosting.');
      return;
    }
    setMpAudioSyncStatus('uploading');
    try {
      await uploadRoomAudio(code, raw.rawBuffer, raw.mimeType);
      setMpAudioSyncStatus('ready');
    } catch (err) {
      setMpAudioSyncStatus('error');
      setMpError(err instanceof Error ? err.message : 'Failed to upload .MP3.');
    }
  }, []);

  // Initialize persistent WebSocket MultiplayerClient
  const ensureMpClient = useCallback(() => {
    if (mpClientRef.current) return mpClientRef.current;

    const client = new MultiplayerClient({
      onJoined: (role, room) => {
        setMpBusy(false);
        setMpError(null);
        setMpRole(role);
        setMpRoom(room);
        setMpOpponent(role === 'host' ? room.guest : room.host);
        if (role === 'host') {
          const track = latestConfigRef.current.activeTrack;
          void uploadHostAudioIfNeeded(room.code, track);
        } else {
          void syncGuestAudioIfNeeded(role, room);
        }
      },
      onRoomState: (room) => {
        const role = mpRoleRef.current;
        setMpRoom(room);
        setMpOpponent(role === 'host' ? room.guest : room.host);

        if (room.status === 'waiting') {
          setMpCountdown(0);
          // On rematch reset, return engine cleanly to title lobby while keeping room open
          if (engineRef.current && engineRef.current.getState() !== 'title') {
            setEndStats(null);
            engineRef.current.returnToTitle();
            setMpModalOpen(true);
          }
          if (role === 'guest') {
            void syncGuestAudioIfNeeded(role, room);
          }
        }
      },
      onCountdown: (countdownSec) => {
        setMpModalOpen(false);
        setMpCountdown(countdownSec);
      },
      onMatchStart: (room, chart) => {
        const engine = engineRef.current;
        const role = mpRoleRef.current;
        if (!engine || !role) return;

        setMpCountdown(0);
        setMpModalOpen(false);
        setEndStats(null);
        setNewlyUnlockedSkins([]);
        setMpRoom(room);

        const opponent = role === 'host' ? room.guest : room.host;
        setMpOpponent(opponent);

        let trackToPlay: TrackConfig;
        if (room.trackMeta.kind === 'mp3') {
          const hostImp = latestConfigRef.current.importedTrack;
          const guestAudio = guestMp3TrackRef.current;
          const buffer =
            hostImp && hostImp.id === room.trackMeta.trackId
              ? hostImp.audioBuffer
              : guestAudio && guestAudio.trackId === room.trackMeta.trackId
                ? guestAudio.audioBuffer
                : null;
          if (!buffer) {
            setMpError('Custom MP3 audio is not ready yet.');
            return;
          }
          trackToPlay = {
            kind: 'mp3',
            id: room.trackMeta.trackId,
            title: room.trackMeta.title,
            subtitle: room.trackMeta.subtitle,
            bpm: room.trackMeta.bpm,
            durationSec: room.trackMeta.durationSec,
            accentColor: room.trackMeta.accentColor,
            audioBuffer: buffer,
            fileName: room.trackMeta.title,
            detectedOnsets: chart.beatTimes.length,
          };
        } else {
          trackToPlay =
            BUILTIN_TRACKS.find((t) => t.id === room.trackMeta.trackId) ?? BUILTIN_TRACKS[0];
        }

        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        engine.startMultiplayerMatch({
          track: trackToPlay,
          chart,
          playMode: room.playMode,
          skinId: latestConfigRef.current.progress.selectedSkin,
          bestScore: latestConfigRef.current.progress.bestScore,
          opponent,
        });
        canvasRef.current?.focus();
      },
      onOpponentTelemetry: (opponent) => {
        setMpOpponent(opponent);
        engineRef.current?.setOpponentState(opponent);
      },
      onMatchResult: (room) => {
        const role = mpRoleRef.current;
        setMpRoom(room);
        setMpOpponent(role === 'host' ? room.guest : room.host);
      },
      onError: (message) => {
        setMpBusy(false);
        setMpError(message);
      },
      onClose: () => {
        setMpBusy(false);
      },
    });

    mpClientRef.current = client;
    return client;
  }, [syncGuestAudioIfNeeded, uploadHostAudioIfNeeded]);

  // Mount Canvas & Simulation Engine once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const audio = new RhythmAudioEngine();
    audioRef.current = audio;

    const firstTrack = BUILTIN_TRACKS[0];
    const firstAnalysis = buildSynthTrackAnalysis(firstTrack);

    const engine = new SausageCatEngine(canvas, audio, firstTrack, firstAnalysis, {
      onHudUpdate: (snapshot) => {
        setHud(snapshot);
      },
      onStateChange: (next) => {
        setGameState(next);
        document.body.dataset.state = next;
      },
      onMultiplayerTelemetry: (telemetry) => {
        const room = mpRoomRef.current;
        if (!room) return;
        mpClientRef.current?.sendTelemetry({
          code: room.code,
          ...telemetry,
        });
      },
      onGameOver: (stats) => {
        setEndStats(stats);

        const activeMpRoom = mpRoomRef.current;
        if (activeMpRoom) {
          void mpClientRef.current?.sendFinished({
            code: activeMpRoom.code,
            score: stats.score,
            maxCombo: stats.maxCombo,
            accuracyPct: stats.accuracyPct,
            lives: stats.lives,
            alive: stats.victory,
          });
        }

        const cfg = latestConfigRef.current;
        if (!stats.scoreCounted) {
          setNewlyUnlockedSkins([]);
          return;
        }

        const { allUnlocked, newlyUnlocked } = evaluateSkinUnlocks(
          cfg.progress.unlockedSkins,
          stats,
          cfg.activeTrack.id,
          !activeMpRoom && cfg.gameMode === 'boss' ? cfg.bossId : null,
        );
        const nextProgress: PlayerProgress = {
          ...cfg.progress,
          bestScore: Math.max(cfg.progress.bestScore, stats.score),
          unlockedSkins: allUnlocked,
          clearedTrackIds:
            stats.victory && !cfg.progress.clearedTrackIds.includes(cfg.activeTrack.id)
              ? [...cfg.progress.clearedTrackIds, cfg.activeTrack.id]
              : cfg.progress.clearedTrackIds,
          defeatedBossIds:
            !activeMpRoom &&
            stats.victory &&
            stats.victoryReason === 'boss-defeated' &&
            !cfg.progress.defeatedBossIds.includes(cfg.bossId)
              ? [...cfg.progress.defeatedBossIds, cfg.bossId]
              : cfg.progress.defeatedBossIds,
        };
        setNewlyUnlockedSkins(newlyUnlocked);
        setProgress(nextProgress);
        savePlayerProgress(nextProgress);
      },
    });
    engineRef.current = engine;

    const resizeObserver = new ResizeObserver(() => {
      engine.handleResize();
    });
    resizeObserver.observe(canvas);

    // Support ?autostart=1 for automated testing / instant entry
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      engine.configureSession({
        track: firstTrack,
        analysis: firstAnalysis,
        gameMode: 'arcade',
        playMode: 'lives',
        difficulty: 'normal',
        autoMode: false,
        rhythmOnlyMode: false,
        bossId: 'metronome',
        skinId: latestConfigRef.current.progress.selectedSkin,
        bestScore: latestConfigRef.current.progress.bestScore,
      });
      engine.startGame();
    }

    return () => {
      resizeObserver.disconnect();
      mpClientRef.current?.disconnect();
      mpClientRef.current = null;
      engine.destroy();
      engineRef.current = null;
      audioRef.current = null;
    };
  }, []);

  // Push skin preview updates immediately to title-screen cat
  useEffect(() => {
    engineRef.current?.setSkin(progress.selectedSkin);
  }, [progress.selectedSkin]);

  const startCurrentSession = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setEndStats(null);
    setNewlyUnlockedSkins([]);
    engine.configureSession({
      track: activeTrack,
      analysis: activeAnalysis,
      gameMode,
      playMode,
      difficulty,
      autoMode: controlMode === 'auto',
      rhythmOnlyMode: controlMode === 'rhythm-only',
      bossId,
      skinId: progress.selectedSkin,
      bestScore: progress.bestScore,
    });
    engine.startGame();
    canvasRef.current?.focus();
  }, [activeAnalysis, activeTrack, bossId, controlMode, difficulty, gameMode, playMode, progress.bestScore, progress.selectedSkin]);

  const handleToggleMute = useCallback(() => {
    if (!audioRef.current) return;
    const nextMuted = audioRef.current.toggleMute();
    setMuted(nextMuted);
  }, []);

  const handleVolumeChange = useCallback((nextVolume: number) => {
    setVolume(nextVolume);
    if (!audioRef.current) return;
    audioRef.current.setVolume(nextVolume);
    if (nextVolume === 0) {
      audioRef.current.setMuted(true);
      setMuted(true);
    } else {
      setMuted(false);
    }
  }, []);

  const handlePause = useCallback(() => {
    engineRef.current?.pauseGame();
  }, []);

  const handleResume = useCallback(() => {
    engineRef.current?.resumeGame();
    canvasRef.current?.focus();
  }, []);

  const handleBackToTitle = useCallback(() => {
    setEndStats(null);
    setNewlyUnlockedSkins([]);
    engineRef.current?.returnToTitle();
  }, []);

  const handleSelectSkin = useCallback(
    (skinId: CatSkinId) => {
      if (!progress.unlockedSkins.includes(skinId)) return;
      const next = { ...progress, selectedSkin: skinId };
      setProgress(next);
      savePlayerProgress(next);
    },
    [progress],
  );

  const syncHostRoomTrackUpdate = useCallback(
    async (track: TrackConfig, analysis: AudioAnalysisResult, nextPlayMode: PlayMode) => {
      const room = mpRoomRef.current;
      const role = mpRoleRef.current;
      if (!room || role !== 'host' || room.status !== 'waiting') return;

      const chart: LevelChart = generateLevelFromAnalysis(analysis, {
        gameMode: 'arcade',
        difficulty: latestConfigRef.current.difficulty,
        seed: track.id.length * 97 + Math.round(track.bpm),
      });
      const meta = buildTrackMeta(track, false);
      try {
        await mpClientRef.current?.updateTrack({
          code: room.code,
          playMode: nextPlayMode,
          trackMeta: meta,
          chart,
        });
        await uploadHostAudioIfNeeded(room.code, track);
      } catch (err) {
        setMpError(err instanceof Error ? err.message : 'Failed to update room track.');
      }
    },
    [uploadHostAudioIfNeeded],
  );

  const handleSelectTrack = useCallback(
    (id: string) => {
      setSelectedTrackId(id);
      const match = BUILTIN_TRACKS.find((t) => t.id === id);
      if (match) setBossId(match.recommendedBoss);

      if (mpRoomRef.current && mpRoleRef.current === 'host') {
        const track =
          importedTrack && id === importedTrack.id
            ? importedTrack
            : match ?? BUILTIN_TRACKS[0];
        const analysis =
          importedTrack && importedAnalysis && id === importedTrack.id
            ? importedAnalysis
            : synthAnalyses.get(track.id) ?? buildSynthTrackAnalysis(BUILTIN_TRACKS[0]);
        void syncHostRoomTrackUpdate(track, analysis, playMode);
      }
    },
    [importedAnalysis, importedTrack, playMode, syncHostRoomTrackUpdate, synthAnalyses],
  );

  const handleSelectPlayMode = useCallback(
    (nextMode: PlayMode) => {
      setPlayMode(nextMode);
      if (mpRoomRef.current && mpRoleRef.current === 'host') {
        void syncHostRoomTrackUpdate(activeTrack, activeAnalysis, nextMode);
      }
    },
    [activeAnalysis, activeTrack, syncHostRoomTrackUpdate],
  );

  const handleImportMp3 = useCallback(
    async (file: File) => {
      if (!audioRef.current) return;
      setMp3Error(null);
      setMpError(null);

      if (!file.type.includes('audio') && !file.name.toLowerCase().endsWith('.mp3')) {
        const msg = 'Please choose a valid .mp3 or audio file.';
        setMp3Error(msg);
        setMpError(msg);
        return;
      }

      setMp3Importing(true);
      try {
        const { audioBuffer, analysis, rawBuffer, mimeType } =
          await audioRef.current.decodeAndAnalyzeMp3(file);
        const cleanName = file.name.replace(/\.[^/.]+$/, '');
        const id = `mp3-${Date.now()}`;
        const track: Mp3TrackConfig = {
          kind: 'mp3',
          id,
          title: cleanName || 'Imported MP3',
          subtitle: 'Auto-Generated Level',
          bpm: analysis.bpm,
          durationSec: analysis.durationSec,
          accentColor: '#38BDF8',
          audioBuffer,
          fileName: file.name,
          detectedOnsets: analysis.beatTimes.length,
        };
        importedMp3RawRef.current = { trackId: id, rawBuffer, mimeType };
        setImportedTrack(track);
        setImportedAnalysis(analysis);
        setSelectedTrackId(id);

        if (mpRoomRef.current && mpRoleRef.current === 'host') {
          await syncHostRoomTrackUpdate(track, analysis, playMode);
        }
      } catch {
        const msg = 'Could not decode this audio file. Try a standard .mp3 file.';
        setMp3Error(msg);
        setMpError(msg);
      } finally {
        setMp3Importing(false);
      }
    },
    [playMode, syncHostRoomTrackUpdate],
  );

  const handleChangePlayerName = useCallback((name: string) => {
    setPlayerName(name);
    try {
      localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name);
    } catch {
      // ignore storage errors
    }
  }, []);

  const handleCreateRoom = useCallback(async () => {
    setMpError(null);
    setMpBusy(true);
    try {
      const client = ensureMpClient();
      const chart = generateLevelFromAnalysis(activeAnalysis, {
        gameMode: 'arcade',
        difficulty,
        seed: activeTrack.id.length * 97 + Math.round(activeTrack.bpm),
      });
      await client.createRoom({
        playerName,
        skinId: progress.selectedSkin,
        playMode,
        trackMeta: buildTrackMeta(activeTrack, false),
        chart,
      });
    } catch (err) {
      setMpBusy(false);
      setMpError(err instanceof Error ? err.message : 'Failed to create 1v1 room.');
    }
  }, [activeAnalysis, activeTrack, difficulty, ensureMpClient, playMode, playerName, progress.selectedSkin]);

  const handleJoinRoom = useCallback(
    async (code: string) => {
      setMpError(null);
      setMpBusy(true);
      syncedGuestAudioKeyRef.current = null;
      guestMp3TrackRef.current = null;
      setMpAudioSyncStatus('idle');
      try {
        const client = ensureMpClient();
        await client.joinRoom({
          code,
          playerName,
          skinId: progress.selectedSkin,
        });
      } catch (err) {
        setMpBusy(false);
        setMpError(err instanceof Error ? err.message : 'Failed to join 1v1 room.');
      }
    },
    [ensureMpClient, playerName, progress.selectedSkin],
  );

  const handleToggleReady = useCallback(async () => {
    const room = mpRoomRef.current;
    if (!room || !room.guest) return;
    try {
      await mpClientRef.current?.setReady(room.code, !room.guest.ready, progress.selectedSkin);
    } catch (err) {
      setMpError(err instanceof Error ? err.message : 'Could not update ready state.');
    }
  }, [progress.selectedSkin]);

  const handleStartMpMatch = useCallback(async () => {
    const room = mpRoomRef.current;
    if (!room) return;
    setMpError(null);
    try {
      await mpClientRef.current?.startMatch(room.code);
    } catch (err) {
      setMpError(err instanceof Error ? err.message : 'Could not start match.');
    }
  }, []);

  const handleLeaveMultiplayer = useCallback(() => {
    mpClientRef.current?.disconnect();
    mpClientRef.current = null;
    setMpRole(null);
    setMpRoom(null);
    setMpOpponent(null);
    setMpCountdown(0);
    setMpBusy(false);
    setMpError(null);
    setMpAudioSyncStatus('idle');
    setMpModalOpen(false);
    syncedGuestAudioKeyRef.current = null;
    guestMp3TrackRef.current = null;
    setEndStats(null);
    engineRef.current?.returnToTitle();
  }, []);

  const handleMultiplayerRematch = useCallback(async () => {
    const room = mpRoomRef.current;
    if (!room) return;
    try {
      await mpClientRef.current?.requestRematch(room.code);
    } catch (err) {
      setMpError(err instanceof Error ? err.message : 'Could not request rematch.');
    }
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
      if (isInput) return;

      const engine = engineRef.current;
      if (!engine) return;
      const state = engine.getState();

      if (e.code === 'KeyM') {
        e.preventDefault();
        handleToggleMute();
        return;
      }

      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (state === 'playing' && !engine.isMultiplayer()) {
          e.preventDefault();
          handlePause();
        } else if (state === 'paused') {
          e.preventDefault();
          handleResume();
        }
        return;
      }

      if (
        e.code === 'KeyR' &&
        !engine.isMultiplayer() &&
        (state === 'playing' || state === 'paused' || state === 'gameover')
      ) {
        e.preventDefault();
        startCurrentSession();
        return;
      }

      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        if (state === 'playing') {
          e.preventDefault();
          engine.triggerJump();
        } else if (state === 'title' && e.code === 'Space' && !mpModalOpen && mpCountdown === 0) {
          e.preventDefault();
          startCurrentSession();
        }
      } else if (e.code === 'Enter' && state === 'title' && !mpModalOpen && mpCountdown === 0) {
        e.preventDefault();
        startCurrentSession();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlePause, handleResume, handleToggleMute, mpCountdown, mpModalOpen, startCurrentSession]);

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#121629]">
      {/* Isolated Canvas Mount */}
      <div className="absolute inset-0">
        <canvas
          ref={canvasRef}
          data-testid="game-canvas"
          tabIndex={0}
          onPointerDown={() => {
            if (gameState === 'playing') {
              engineRef.current?.triggerJump();
            }
          }}
          className="block w-full h-full outline-none cursor-pointer"
          aria-label="Sausage Cat Beat Game Canvas"
        />
      </div>

      {gameState === 'title' && mpCountdown === 0 && (
        <TitleOverlay
          tracks={BUILTIN_TRACKS}
          selectedTrackId={activeTrack.id}
          onSelectTrack={handleSelectTrack}
          onImportMp3={handleImportMp3}
          mp3Importing={mp3Importing}
          mp3Error={mp3Error}
          importedTrack={importedTrack}
          gameMode={gameMode}
          onSelectGameMode={setGameMode}
          playMode={playMode}
          onSelectPlayMode={handleSelectPlayMode}
          difficulty={difficulty}
          onSelectDifficulty={setDifficulty}
          controlMode={controlMode}
          onSelectControlMode={setControlMode}
          bossId={bossId}
          onSelectBoss={setBossId}
          selectedSkin={progress.selectedSkin}
          unlockedSkins={progress.unlockedSkins}
          onSelectSkin={handleSelectSkin}
          bestScore={progress.bestScore}
          onStart={startCurrentSession}
          onOpenMultiplayer={() => {
            setMpError(null);
            setMpModalOpen(true);
          }}
        />
      )}

      {/* 1v1 Multiplayer Lobby Modal */}
      <MultiplayerModal
        isOpen={mpModalOpen && gameState === 'title' && mpCountdown === 0}
        onClose={() => setMpModalOpen(false)}
        playerName={playerName}
        onChangePlayerName={handleChangePlayerName}
        initialJoinCode={initialJoinCode}
        role={mpRole}
        room={mpRoom}
        tracks={BUILTIN_TRACKS}
        selectedTrackId={activeTrack.id}
        onSelectTrack={handleSelectTrack}
        importedTrack={importedTrack}
        onImportMp3={handleImportMp3}
        mp3Importing={mp3Importing}
        playMode={playMode}
        onSelectPlayMode={handleSelectPlayMode}
        busy={mpBusy}
        audioSyncStatus={mpAudioSyncStatus}
        errorMessage={mpError}
        onCreateRoom={() => void handleCreateRoom()}
        onJoinRoom={(code) => void handleJoinRoom(code)}
        onToggleReady={() => void handleToggleReady()}
        onStartMatch={() => void handleStartMpMatch()}
        onLeaveRoom={handleLeaveMultiplayer}
      />

      {/* Synchronized 3-2-1 Countdown Overlay */}
      {mpCountdown > 0 && (
        <div
          className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-[#0B0E1D]/65 pointer-events-none"
          aria-live="assertive"
        >
          <div className="text-xs font-bold uppercase tracking-widest text-[#38BDF8] mb-2">
            1v1 Match Starting
          </div>
          <div
            className="font-display text-7xl sm:text-8xl font-extrabold text-[#FFB830]"
            style={{ textShadow: '0 6px 0 #0B0E1D, 0 12px 24px rgba(0,0,0,0.6)' }}
          >
            {mpCountdown}
          </div>
          {mpRoom && (
            <div className="mt-3 text-sm font-semibold text-[#F7F2E7]/85">
              {mpRoom.trackMeta.title} · {mpRoom.trackMeta.bpm} BPM
            </div>
          )}
        </div>
      )}

      {(gameState === 'playing' || gameState === 'paused') && (
        <HudOverlay
          hud={hud}
          muted={muted}
          onToggleMute={handleToggleMute}
          onPause={handlePause}
          onRestart={startCurrentSession}
          multiplayerOpponent={mpRoom ? mpOpponent : null}
          onLeaveMultiplayer={handleLeaveMultiplayer}
        />
      )}

      {(gameState === 'paused' || gameState === 'gameover') && (
        <StatusModal
          gameState={gameState}
          stats={endStats}
          newlyUnlockedSkins={newlyUnlockedSkins}
          volume={volume}
          muted={muted}
          onVolumeChange={handleVolumeChange}
          onResume={handleResume}
          onRestart={startCurrentSession}
          onBackToTitle={handleBackToTitle}
          multiplayerRoom={mpRoom}
          multiplayerRole={mpRole}
          onMultiplayerRematch={() => void handleMultiplayerRematch()}
          onLeaveMultiplayer={handleLeaveMultiplayer}
        />
      )}
    </main>
  );
}
