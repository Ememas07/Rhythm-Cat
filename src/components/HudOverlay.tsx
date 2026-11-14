import React from 'react';
import { Pause, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import type { HudSnapshot } from '../game/types';

interface HudOverlayProps {
  hud: HudSnapshot;
  muted: boolean;
  onToggleMute: () => void;
  onPause: () => void;
  onRestart: () => void;
}

export const HudOverlay: React.FC<HudOverlayProps> = ({
  hud,
  muted,
  onToggleMute,
  onPause,
  onRestart,
}) => {
  const bossPct = hud.bossMaxHp > 0 ? Math.max(0, Math.min(100, (hud.bossHp / hud.bossMaxHp) * 100)) : 0;
  const bossGhostPct =
    hud.bossMaxHp > 0 ? Math.max(0, Math.min(100, (hud.bossGhostHp / hud.bossMaxHp) * 100)) : 0;

  return (
    <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between">
      {/* Top 3px Song Progress Track */}
      <div className="w-full h-1 bg-[#0B0E1E]">
        <div
          className="h-full bg-[#FFB830] transition-[width] duration-150"
          style={{ width: `${Math.round(hud.songProgress * 100)}%` }}
        />
      </div>

      {/* Perimeter Top HUD Cluster */}
      <div className="flex items-start justify-between gap-4 px-5 pt-4 mb-auto">
        {/* Top-Left: Score, Combo, Accuracy & Vitality Cat-Heart Pips */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-3">
            <div
              className="font-display text-3xl sm:text-4xl font-extrabold text-[#F7F2E7] font-mono-num leading-none"
              style={{ textShadow: '0 2px 0 #0F1326, 0 4px 10px rgba(0,0,0,0.45)' }}
              aria-label={`Score ${hud.score}`}
            >
              {hud.score.toLocaleString()}
            </div>

            {/* 3-State Vitality Cat Hearts */}
            <div className="flex items-center gap-1" aria-label={`Lives ${hud.lives} of ${hud.maxLives}`}>
              {Array.from({ length: hud.maxLives }).map((_, idx) => {
                const filled = idx < hud.lives;
                return (
                  <svg
                    key={idx}
                    viewBox="0 0 24 24"
                    className="w-6 h-6 drop-shadow-[0_2px_3px_rgba(0,0,0,0.5)]"
                    aria-hidden="true"
                  >
                    <path
                      d="M12 20.5s-7.5-4.7-9.2-9.2C1.7 8.3 3.7 5 6.8 5c1.8 0 3.3.9 4.2 2.2L12 8.6l1-1.4C13.9 5.9 15.4 5 17.2 5c3.1 0 5.1 3.3 4 6.3-1.7 4.5-9.2 9.2-9.2 9.2z"
                      fill={filled ? '#FF6B4A' : '#1E2544'}
                      stroke="#0F1326"
                      strokeWidth="2"
                    />
                  </svg>
                );
              })}
            </div>
          </div>

          <div
            className="flex items-center gap-2 text-xs font-semibold text-[#F7F2E7]/85 font-mono-num"
            style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}
          >
            <span>Combo {hud.combo}</span>
            <span aria-hidden="true">·</span>
            <span className="text-[#FFB830]">{hud.multiplier}x</span>
            <span aria-hidden="true">·</span>
            <span>{hud.accuracyPct}% Acc</span>
            <span aria-hidden="true">·</span>
            <span className="hidden sm:inline text-[#F7F2E7]/70">
              {hud.trackTitle} ({hud.bpm} BPM)
            </span>
          </div>
        </div>

        {/* Top-Center: Boss Battle Health Bar (only in Boss mode) */}
        {hud.gameMode === 'boss' && hud.bossName && (
          <div className="w-56 sm:w-80 flex flex-col items-center">
            <div className="w-full flex items-baseline justify-between gap-2 mb-1">
              <span
                className="font-display text-sm font-bold text-[#F7F2E7] truncate"
                style={{ textShadow: '0 2px 4px rgba(0,0,0,0.8)' }}
              >
                {hud.bossName}
              </span>
              <span className="text-xs font-mono-num text-[#FDE68A]">
                {Math.round(hud.bossHp)} / {hud.bossMaxHp}
              </span>
            </div>
            <div className="relative w-full h-3.5 rounded-md bg-[#121629] border-2 border-[#0B0E1D] overflow-hidden shadow-md">
              {/* Delayed trailing ghost damage bar */}
              <div
                className="absolute inset-y-0 left-0 bg-[#FDE68A]/70 transition-[width] duration-75"
                style={{ width: `${bossGhostPct}%` }}
              />
              {/* Live Boss HP bar */}
              <div
                className="absolute inset-y-0 left-0 bg-[#EF4444] transition-[width] duration-75"
                style={{ width: `${bossPct}%` }}
              />
            </div>
            {hud.bossAttackLabel && (
              <div
                className="mt-1 text-xs font-bold text-[#FCA5A5] tracking-wide"
                style={{ textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}
              >
                {hud.bossAttackLabel}
              </div>
            )}
          </div>
        )}

        {/* Top-Right: Utility Icon Buttons (Mute [M], Pause [P], Restart [R]) */}
        <div className="flex items-center gap-2 pointer-events-auto">
          <button
            type="button"
            tabIndex={-1}
            aria-label={muted ? 'Unmute audio (M)' : 'Mute audio (M)'}
            title="Mute (M)"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-[#1A213F]/90 hover:bg-[#263059] border border-[#343F72] text-[#F7F2E7] transition-colors cursor-pointer"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Restart song (R)"
            title="Restart (R)"
            onClick={(e) => {
              e.currentTarget.blur();
              onRestart();
            }}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-[#1A213F]/90 hover:bg-[#263059] border border-[#343F72] text-[#F7F2E7] transition-colors cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Pause game (P)"
            title="Pause (P)"
            onClick={(e) => {
              e.currentTarget.blur();
              onPause();
            }}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-[#1A213F]/90 hover:bg-[#263059] border border-[#343F72] text-[#F7F2E7] transition-colors cursor-pointer"
          >
            <Pause className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
