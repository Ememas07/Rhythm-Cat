import React from 'react';
import { Play, RotateCcw, Sparkles, Home } from 'lucide-react';
import { getSkinById, type CatSkinId } from '../game/skins';
import type { GameState, RunStats } from '../game/types';

interface StatusModalProps {
  gameState: Extract<GameState, 'paused' | 'gameover'>;
  stats: RunStats | null;
  newlyUnlockedSkins: CatSkinId[];
  onResume: () => void;
  onRestart: () => void;
  onBackToTitle: () => void;
}

export const StatusModal: React.FC<StatusModalProps> = ({
  gameState,
  stats,
  newlyUnlockedSkins,
  onResume,
  onRestart,
  onBackToTitle,
}) => {
  if (gameState === 'paused') {
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

  if (!stats) return null;

  const headline =
    stats.victoryReason === 'boss-defeated'
      ? `${stats.bossName ?? 'Boss'} Defeated!`
      : stats.victory
        ? 'Song Cleared!'
        : 'Wiped Out!';

  const subtext =
    stats.victoryReason === 'boss-defeated'
      ? 'Purr-fect rhythm mastery!'
      : stats.victory
        ? `${stats.trackTitle} · ${stats.bpm} BPM`
        : stats.gameMode === 'boss' && stats.bossName
          ? `${stats.bossName} had ${Math.round(stats.bossHpRemaining)} HP left`
          : `Reached ${Math.round(stats.songProgress * 100)}% of ${stats.trackTitle}`;

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
        <div className="flex items-center justify-center gap-3 text-xs font-mono-num text-[#F7F2E7]/75 mb-4">
          <span>{stats.perfectCount} Perfect</span>
          <span aria-hidden="true">·</span>
          <span>{stats.goodCount} Good</span>
          <span aria-hidden="true">·</span>
          <span>{stats.offbeatCount} Offbeat</span>
        </div>

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
