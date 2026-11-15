import React from 'react';
import {
  Play,
  RotateCcw,
  Sparkles,
  Home,
  Volume2,
  VolumeX,
  Trophy,
  Loader2,
  LogOut,
} from 'lucide-react';
import type { PlayerRole, RoomSnapshot } from '../game/multiplayerTypes';
import { getSkinById, type CatSkinId } from '../game/skins';
import type { GameState, RunStats } from '../game/types';

interface StatusModalProps {
  gameState: Extract<GameState, 'paused' | 'gameover'>;
  stats: RunStats | null;
  newlyUnlockedSkins: CatSkinId[];
  volume: number;
  muted: boolean;
  onVolumeChange: (volume: number) => void;
  onResume: () => void;
  onRestart: () => void;
  onBackToTitle: () => void;
  multiplayerRoom?: RoomSnapshot | null;
  multiplayerRole?: PlayerRole | null;
  onMultiplayerRematch?: () => void;
  onLeaveMultiplayer?: () => void;
}

export const StatusModal: React.FC<StatusModalProps> = ({
  gameState,
  stats,
  newlyUnlockedSkins,
  volume,
  muted,
  onVolumeChange,
  onResume,
  onRestart,
  onBackToTitle,
  multiplayerRoom = null,
  multiplayerRole = null,
  onMultiplayerRematch,
  onLeaveMultiplayer,
}) => {
  if (gameState === 'paused') {
    const displayPct = muted ? 0 : Math.round(volume * 100);
    return (
      <div
        className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-[#0B0E1D]/70"
        role="dialog"
        aria-modal="true"
        aria-label="Game Paused"
      >
        <div className="w-full max-w-sm bg-[#171C34] border border-[#343E6B] rounded-2xl p-6 shadow-2xl text-center">
          <h2 className="font-display text-2xl font-extrabold text-[#F7F2E7] mb-1">
            Paused
          </h2>
          <p className="text-xs text-[#F7F2E7]/65 mb-5">
            Catch your breath, sausage cat.
          </p>

          {/* Master Volume Slider */}
          <div className="mb-5 p-3.5 rounded-xl bg-[#11152A] border border-[#262F55] text-left">
            <div className="flex items-center justify-between gap-2 mb-2">
              <label
                htmlFor="pause-volume-slider"
                className="flex items-center gap-1.5 text-xs font-semibold text-[#F7F2E7]"
              >
                {displayPct === 0 ? (
                  <VolumeX className="w-3.5 h-3.5 text-[#94A3B8]" aria-hidden="true" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5 text-[#FFB830]" aria-hidden="true" />
                )}
                <span>Volume</span>
              </label>
              <span className="font-mono-num text-xs font-bold text-[#FFB830]">
                {displayPct}%
              </span>
            </div>
            <input
              id="pause-volume-slider"
              type="range"
              min={0}
              max={100}
              step={1}
              value={displayPct}
              onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
              aria-label="Master Volume"
              className="w-full accent-[#FF6B4A] cursor-pointer"
            />
          </div>

          <div className="space-y-2.5">
            <button
              type="button"
              onClick={onResume}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#FF6B4A] hover:bg-[#FF5733] text-white font-display font-bold text-sm transition-colors cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" aria-hidden="true" />
              <span>Resume</span>
            </button>
            <button
              type="button"
              onClick={onRestart}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#252E58] hover:bg-[#313D73] text-[#F7F2E7] font-semibold text-sm transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
              <span>Restart Song</span>
            </button>
            <button
              type="button"
              onClick={onBackToTitle}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#1D2444] hover:bg-[#27305A] text-[#F7F2E7]/85 font-semibold text-sm transition-colors cursor-pointer"
            >
              <Home className="w-4 h-4" aria-hidden="true" />
              <span>Change Song</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (multiplayerRoom && multiplayerRole && gameState === 'gameover') {
    const me = multiplayerRole === 'host' ? multiplayerRoom.host : multiplayerRoom.guest;
    const opp = multiplayerRole === 'host' ? multiplayerRoom.guest : multiplayerRoom.host;
    const isFinished = multiplayerRoom.status === 'finished';
    const winnerRole = multiplayerRoom.winnerRole;
    const iWon = winnerRole === multiplayerRole;
    const isDraw = winnerRole === 'draw';

    const mpHeadline = !isFinished
      ? 'Run Complete!'
      : isDraw
        ? "It's a Draw!"
        : iWon
          ? 'You Win the 1v1!'
          : `${opp?.name ?? 'Opponent'} Wins!`;

    return (
      <div
        className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-[#0B0E1D]/78"
        role="dialog"
        aria-modal="true"
        aria-label={mpHeadline}
      >
        <div className="w-full max-w-md bg-[#171C34] border border-[#343E6B] rounded-2xl p-6 shadow-2xl">
          <div className="text-center mb-5">
            {isFinished && (
              <div className="inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-[#252E58] border border-[#3B4882] text-[#FFB830] mb-2">
                <Trophy className="w-5 h-5" aria-hidden="true" />
              </div>
            )}
            <h2
              className={`font-display text-3xl font-extrabold mb-1 ${
                !isFinished
                  ? 'text-[#38BDF8]'
                  : isDraw
                    ? 'text-[#FDE047]'
                    : iWon
                      ? 'text-[#34D399]'
                      : 'text-[#FB7185]'
              }`}
            >
              {mpHeadline}
            </h2>
            <p className="text-xs text-[#F7F2E7]/70">
              {multiplayerRoom.trackMeta.title} · {multiplayerRoom.trackMeta.bpm} BPM
            </p>
          </div>

          {!isFinished && opp && (
            <div className="mb-4 p-3.5 rounded-xl bg-[#11152A] border border-[#262F55] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-[#38BDF8] font-semibold">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Waiting for {opp.name} to finish...
                </span>
                <span className="font-mono-num text-[#F7F2E7]/80">
                  {Math.round(opp.songProgress * 100)}%
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-[#0B0E1D] overflow-hidden">
                <div
                  className="h-full bg-[#38BDF8] transition-[width] duration-100"
                  style={{ width: `${Math.round(opp.songProgress * 100)}%` }}
                />
              </div>
              <div className="text-xs text-[#F7F2E7]/65 font-mono-num">
                Live Rival Score: {opp.score.toLocaleString()}
              </div>
            </div>
          )}

          {/* Side-by-side Player Comparison Cards */}
          <div className="grid grid-cols-2 gap-2.5 mb-5">
            {[
              { label: 'You', slot: me, highlight: isFinished && iWon },
              {
                label: opp?.name ?? 'Opponent',
                slot: opp,
                highlight: isFinished && winnerRole !== null && winnerRole !== multiplayerRole && !isDraw,
              },
            ].map(({ label, slot, highlight }, idx) => (
              <div
                key={idx}
                className={`p-3.5 rounded-xl border ${
                  highlight
                    ? 'bg-[#1D2B4D] border-[#FFB830]'
                    : 'bg-[#11152A] border-[#262F55]'
                }`}
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="text-xs font-bold text-[#F7F2E7] truncate">{label}</span>
                  {slot && (
                    <span
                      className={`text-[10px] font-bold uppercase ${
                        slot.alive ? 'text-[#34D399]' : 'text-[#FB7185]'
                      }`}
                    >
                      {slot.alive ? 'Cleared' : 'KO'}
                    </span>
                  )}
                </div>
                <div className="font-mono-num text-xl font-extrabold text-[#FFB830] mb-1">
                  {(slot?.score ?? 0).toLocaleString()}
                </div>
                <div className="text-[11px] font-mono-num text-[#F7F2E7]/70 space-y-0.5">
                  <div>{slot?.accuracyPct ?? 100}% Accuracy</div>
                  <div>{slot?.maxCombo ?? 0}x Max Combo</div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onLeaveMultiplayer}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#232B4F] hover:bg-[#2F3968] text-[#F7F2E7] font-semibold text-sm transition-colors whitespace-nowrap cursor-pointer"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
              <span>Leave Room</span>
            </button>
            {isFinished && (
              <button
                type="button"
                onClick={onMultiplayerRematch}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#FF6B4A] hover:bg-[#FF5733] text-white font-display font-bold text-sm transition-colors whitespace-nowrap cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" aria-hidden="true" />
                <span>Rematch</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const headline =
    stats.victoryReason === 'boss-defeated'
      ? `${stats.bossName ?? 'Boss'} Defeated!`
      : stats.victory
        ? 'Song Cleared!'
        : 'Wiped Out!';

  const difficultyLabel =
    stats.difficulty.charAt(0).toUpperCase() + stats.difficulty.slice(1);

  const subtext =
    stats.victoryReason === 'boss-defeated'
      ? `Purr-fect rhythm mastery! · ${difficultyLabel}`
      : stats.victory
        ? `${stats.trackTitle} · ${stats.bpm} BPM · ${difficultyLabel}`
        : stats.gameMode === 'boss' && stats.bossName
          ? `${stats.bossName} had ${Math.round(stats.bossHpRemaining)} HP left · ${difficultyLabel}`
          : `Reached ${Math.round(stats.songProgress * 100)}% of ${stats.trackTitle} · ${difficultyLabel}`;

  const unrankedReason = !stats.scoreCounted
    ? stats.autoMode
      ? 'Auto Mode Run — Score & skin unlocks were not saved.'
      : stats.rhythmOnlyMode
        ? 'Rhythm-Only Mode — Auto-steered flight (Best Score & unlocks not saved).'
        : stats.infiniteLives && stats.hitsTaken > 3
          ? `Infinite Mode: ${stats.hitsTaken} hits taken (max 3 allowed) — Score not counted.`
          : 'Score not counted for this run.'
    : null;

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-[#0B0E1D]/75"
      role="dialog"
      aria-modal="true"
      aria-label={headline}
    >
      <div className="w-full max-w-md bg-[#171C34] border border-[#343E6B] rounded-2xl p-6 shadow-2xl">
        <div className="text-center mb-5">
          <h2
            className={`font-display text-3xl font-extrabold mb-1 ${
              stats.victory ? 'text-[#FFB830]' : 'text-[#FB7185]'
            }`}
          >
            {headline}
          </h2>
          <p className="text-xs text-[#F7F2E7]/70">{subtext}</p>
        </div>

        {/* 4 Key Tabular Metric Tiles */}
        <div className="grid grid-cols-2 gap-2.5 mb-4">
          <div className="bg-[#11152A] border border-[#262F55] rounded-xl p-3">
            <div className="text-[11px] text-[#F7F2E7]/60">Score</div>
            <div className="font-mono-num text-xl font-bold text-[#F7F2E7]">
              {stats.score.toLocaleString()}
            </div>
          </div>
          <div className="bg-[#11152A] border border-[#262F55] rounded-xl p-3">
            <div className="text-[11px] text-[#F7F2E7]/60">Best</div>
            <div className="font-mono-num text-xl font-bold text-[#FFB830]">
              {stats.bestScore.toLocaleString()}
            </div>
          </div>
          <div className="bg-[#11152A] border border-[#262F55] rounded-xl p-3">
            <div className="text-[11px] text-[#F7F2E7]/60">Max Combo</div>
            <div className="font-mono-num text-xl font-bold text-[#F7F2E7]">
              {stats.maxCombo}x
            </div>
          </div>
          <div className="bg-[#11152A] border border-[#262F55] rounded-xl p-3">
            <div className="text-[11px] text-[#F7F2E7]/60">Beat Accuracy</div>
            <div className="font-mono-num text-xl font-bold text-[#38BDF8]">
              {stats.accuracyPct}%
            </div>
          </div>
        </div>

        {/* Breakdown line */}
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs font-mono-num text-[#F7F2E7]/75 mb-4">
          <span>{stats.perfectCount} Perfect</span>
          <span aria-hidden="true">·</span>
          <span>{stats.goodCount} Good</span>
          <span aria-hidden="true">·</span>
          <span>{stats.offbeatCount} Offbeat</span>
          {stats.infiniteLives && (
            <>
              <span aria-hidden="true">·</span>
              <span className={stats.hitsTaken > 3 ? 'text-[#FB7185] font-semibold' : 'text-[#34D399]'}>
                {stats.hitsTaken} {stats.hitsTaken === 1 ? 'Hit' : 'Hits'}
              </span>
            </>
          )}
        </div>

        {/* Unranked Notice (Auto Mode or Infinite > 3 hits) */}
        {unrankedReason && (
          <div
            data-testid="unranked-notice"
            className="mb-4 px-3 py-2.5 rounded-xl bg-[#2B1726] border border-[#FB7185]/45 text-xs text-[#FECDD3] text-center"
          >
            {unrankedReason}
          </div>
        )}

        {/* Newly Unlocked Cat Skins */}
        {newlyUnlockedSkins.length > 0 && (
          <div className="mb-4 p-3 rounded-xl bg-[#252D52] border border-[#FFB830]/60">
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#FFB830] mb-1">
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              <span>New Cat Skin Unlocked!</span>
            </div>
            <div className="text-xs text-[#F7F2E7]">
              {newlyUnlockedSkins.map((id) => getSkinById(id).name).join(', ')}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onBackToTitle}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#232B4F] hover:bg-[#2F3968] text-[#F7F2E7] font-semibold text-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Home className="w-4 h-4" aria-hidden="true" />
            <span>Change Song</span>
          </button>
          <button
            type="button"
            data-start="true"
            onClick={onRestart}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#FF6B4A] hover:bg-[#FF5733] text-white font-display font-bold text-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
            <span>Play Again</span>
          </button>
        </div>
      </div>
    </div>
  );
};
