import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HudOverlay } from './components/HudOverlay';
import { StatusModal } from './components/StatusModal';
import { TitleOverlay } from './components/TitleOverlay';
import { RhythmAudioEngine } from './game/audioEngine';
import { SausageCatEngine } from './game/engine';
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
  GameMode,
  GameState,
  HudSnapshot,
  Mp3TrackConfig,
  PlayMode,
  RunStats,
  TrackConfig,
} from './game/types';

const INITIAL_HUD: HudSnapshot = {
  score: 0,
  bestScore: 0,
  combo: 0,
  multiplier: 1,
  lives: 3,
  maxLives: 3,
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

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<SausageCatEngine | null>(null);
  const audioRef = useRef<RhythmAudioEngine | null>(null);

  const [progress, setProgress] = useState<PlayerProgress>(() => loadPlayerProgress());
  const [gameState, setGameState] = useState<GameState>('title');
  const [gameMode, setGameMode] = useState<GameMode>('arcade');
  const [playMode, setPlayMode] = useState<PlayMode>('lives');
  const [bossId, setBossId] = useState<BossId>('metronome');
  const [selectedTrackId, setSelectedTrackId] = useState<string>(BUILTIN_TRACKS[0].id);

  const [importedTrack, setImportedTrack] = useState<Mp3TrackConfig | null>(null);
  const [importedAnalysis, setImportedAnalysis] = useState<AudioAnalysisResult | null>(null);
  const [mp3Importing, setMp3Importing] = useState(false);
  const [mp3Error, setMp3Error] = useState<string | null>(null);

  const [muted, setMuted] = useState(false);
  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [endStats, setEndStats] = useState<RunStats | null>(null);
  const [newlyUnlockedSkins, setNewlyUnlockedSkins] = useState<CatSkinId[]>([]);

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

  // Keep latest config values in a ref for engine callbacks without re-mounting the canvas
  const latestConfigRef = useRef({
    activeTrack,
    activeAnalysis,
    gameMode,
    playMode,
    bossId,
    progress,
  });
  latestConfigRef.current = {
    activeTrack,
    activeAnalysis,
    gameMode,
    playMode,
    bossId,
    progress,
  };

  // Sync body dataset state
  useEffect(() => {
    document.body.dataset.state = gameState;
  }, [gameState]);

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
      onGameOver: (stats) => {
        setEndStats(stats);
        const cfg = latestConfigRef.current;
        const { allUnlocked, newlyUnlocked } = evaluateSkinUnlocks(
          cfg.progress.unlockedSkins,
          stats,
          cfg.activeTrack.id,
          cfg.gameMode === 'boss' ? cfg.bossId : null,
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
        bossId: 'metronome',
        skinId: latestConfigRef.current.progress.selectedSkin,
        bestScore: latestConfigRef.current.progress.bestScore,
      });
      engine.startGame();
    }

    return () => {
      resizeObserver.disconnect();
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
      bossId,
      skinId: progress.selectedSkin,
      bestScore: progress.bestScore,
    });
    engine.startGame();
    canvasRef.current?.focus();
  }, [activeAnalysis, activeTrack, bossId, gameMode, playMode, progress.bestScore, progress.selectedSkin]);

  const handleToggleMute = useCallback(() => {
    if (!audioRef.current) return;
    const nextMuted = audioRef.current.toggleMute();
    setMuted(nextMuted);
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

  const handleImportMp3 = useCallback(async (file: File) => {
    if (!audioRef.current) return;
    setMp3Error(null);

    if (!file.type.includes('audio') && !file.name.toLowerCase().endsWith('.mp3')) {
      setMp3Error('Please choose a valid .mp3 or audio file.');
      return;
    }

    setMp3Importing(true);
    try {
      const { audioBuffer, analysis } = await audioRef.current.decodeAndAnalyzeMp3(file);
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
      setImportedTrack(track);
      setImportedAnalysis(analysis);
      setSelectedTrackId(id);
    } catch {
      setMp3Error('Could not decode this audio file. Try a standard .mp3 file.');
    } finally {
      setMp3Importing(false);
    }
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const target = e.target as HTMLElement | null;
      const isInput =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
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
        if (state === 'playing') {
          e.preventDefault();
          handlePause();
        } else if (state === 'paused') {
          e.preventDefault();
          handleResume();
        }
        return;
      }

      if (e.code === 'KeyR' && (state === 'playing' || state === 'paused' || state === 'gameover')) {
        e.preventDefault();
        startCurrentSession();
        return;
      }

      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        if (state === 'playing') {
          e.preventDefault();
          engine.triggerJump();
        } else if (state === 'title' && e.code === 'Space') {
          e.preventDefault();
          startCurrentSession();
        }
      } else if (e.code === 'Enter' && state === 'title') {
        e.preventDefault();
        startCurrentSession();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlePause, handleResume, handleToggleMute, startCurrentSession]);

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

      {gameState === 'title' && (
        <TitleOverlay
          tracks={BUILTIN_TRACKS}
          selectedTrackId={activeTrack.id}
          onSelectTrack={(id) => {
            setSelectedTrackId(id);
            const match = BUILTIN_TRACKS.find((t) => t.id === id);
            if (match) setBossId(match.recommendedBoss);
          }}
          onImportMp3={handleImportMp3}
          mp3Importing={mp3Importing}
          mp3Error={mp3Error}
          importedTrack={importedTrack}
          gameMode={gameMode}
          onSelectGameMode={setGameMode}
          playMode={playMode}
          onSelectPlayMode={setPlayMode}
          bossId={bossId}
          onSelectBoss={setBossId}
          selectedSkin={progress.selectedSkin}
          unlockedSkins={progress.unlockedSkins}
          onSelectSkin={handleSelectSkin}
          bestScore={progress.bestScore}
          onStart={startCurrentSession}
        />
      )}

      {(gameState === 'playing' || gameState === 'paused') && (
        <HudOverlay
          hud={hud}
          muted={muted}
          onToggleMute={handleToggleMute}
          onPause={handlePause}
          onRestart={startCurrentSession}
        />
      )}

      {(gameState === 'paused' || gameState === 'gameover') && (
        <StatusModal
          gameState={gameState}
          stats={endStats}
          newlyUnlockedSkins={newlyUnlockedSkins}
          onResume={handleResume}
          onRestart={startCurrentSession}
          onBackToTitle={handleBackToTitle}
        />
      )}
    </main>
  );
}
