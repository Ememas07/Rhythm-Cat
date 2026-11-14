import React, { useRef, useState } from 'react';
import { Lock, Music, Play, Shield, Sparkles, Swords, Upload, Check } from 'lucide-react';
import { BOSS_ROSTER } from '../game/bosses';
import { CAT_SKINS, type CatSkinId } from '../game/skins';
import type { BossId, GameMode, Mp3TrackConfig, PlayMode, TrackConfig } from '../game/types';

interface TitleOverlayProps {
  tracks: TrackConfig[];
  selectedTrackId: string;
  onSelectTrack: (id: string) => void;
  onImportMp3: (file: File) => Promise<void>;
  mp3Importing: boolean;
  mp3Error: string | null;
  importedTrack: Mp3TrackConfig | null;
  gameMode: GameMode;
  onSelectGameMode: (mode: GameMode) => void;
  playMode: PlayMode;
  onSelectPlayMode: (mode: PlayMode) => void;
  bossId: BossId;
  onSelectBoss: (id: BossId) => void;
  selectedSkin: CatSkinId;
  unlockedSkins: CatSkinId[];
  onSelectSkin: (id: CatSkinId) => void;
  bestScore: number;
  onStart: () => void;
}

export const TitleOverlay: React.FC<TitleOverlayProps> = ({
  tracks,
  selectedTrackId,
  onSelectTrack,
  onImportMp3,
  mp3Importing,
  mp3Error,
  importedTrack,
  gameMode,
  onSelectGameMode,
  playMode,
  onSelectPlayMode,
  bossId,
  onSelectBoss,
  selectedSkin,
  unlockedSkins,
  onSelectSkin,
  bestScore,
  onStart,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showWardrobe, setShowWardrobe] = useState(false);

  const allTracks: TrackConfig[] = importedTrack ? [...tracks, importedTrack] : tracks;
  const activeSkinDef = CAT_SKINS.find((s) => s.id === selectedSkin) ?? CAT_SKINS[0];

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await onImportMp3(file);
    e.target.value = '';
  };

  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-between p-5 sm:p-8 pointer-events-none">
      {/* Top-Left Bespoke Inline SVG Title Emblem over Calm Negative Space */}
      <div className="flex items-start justify-between gap-4">
        <div className="pointer-events-auto">
          <svg
            viewBox="0 0 360 92"
            className="w-[260px] sm:w-[340px] h-auto drop-shadow-[0_4px_12px_rgba(0,0,0,0.45)]"
            role="img"
            aria-label="Sausage Cat Beat"
          >
            {/* Cat-ear musical crest */}
            <path
              d="M22 44 L14 14 L38 28 L56 28 L80 14 L72 44 C78 58 70 76 47 76 C24 76 16 58 22 44 Z"
              fill="#F2994A"
              stroke="#0F1326"
              strokeWidth="4"
              strokeLinejoin="round"
            />
            <path d="M24 34 L20 21 L33 29 Z" fill="#FDA4AF" />
            <path d="M70 34 L74 21 L61 29 Z" fill="#FDA4AF" />
            <circle cx="38" cy="48" r="3.5" fill="#1E1B2E" />
            <circle cx="56" cy="48" r="3.5" fill="#1E1B2E" />
            <circle cx="47" cy="54" r="2.6" fill="#FB7185" />
            {/* Eighth note accent */}
            <path
              d="M86 30 L86 12 L102 8 L102 24"
              fill="none"
              stroke="#FFB830"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="82" cy="31" r="5" fill="#FFB830" />
            <circle cx="98" cy="25" r="5" fill="#FFB830" />

            {/* Display Title Text */}
            <text
              x="114"
              y="44"
              fill="#F7F2E7"
              stroke="#0F1326"
              strokeWidth="5"
              paintOrder="stroke fill"
              fontFamily="'Bricolage Grotesque', system-ui, sans-serif"
              fontWeight="800"
              fontSize="30"
              letterSpacing="-0.5"
            >
              SAUSAGE CAT
            </text>
            <text
              x="116"
              y="74"
              fill="#FFB830"
              stroke="#0F1326"
              strokeWidth="4.5"
              paintOrder="stroke fill"
              fontFamily="'Bricolage Grotesque', system-ui, sans-serif"
              fontWeight="800"
              fontSize="24"
              letterSpacing="1.5"
            >
              BEAT FLIGHT
            </text>
          </svg>
        </div>

        {bestScore > 0 && (
          <div className="hidden sm:flex items-center gap-2 text-sm text-[#F7F2E7]/85 font-mono-num">
            <span>Best</span>
            <span className="text-[#FFB830] font-bold">{bestScore.toLocaleString()}</span>
          </div>
        )}
      </div>

      {/* Main Control Console anchored on the right half so the floating Sausage Cat on left stays visible */}
      <div className="w-full max-w-[500px] lg:ml-auto lg:mr-6 mt-auto mb-2 lg:my-auto bg-[#171C34]/95 border border-[#343E6B] rounded-2xl p-4 sm:p-6 shadow-2xl pointer-events-auto max-h-[62vh] lg:max-h-[76vh] overflow-y-auto">
        {showWardrobe ? (
          <div>
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <h2 className="font-display text-xl font-bold text-[#F7F2E7]">
                  Cat Wardrobe
                </h2>
                <p className="text-xs text-[#F7F2E7]/65">
                  {unlockedSkins.length} of {CAT_SKINS.length} skins unlocked
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowWardrobe(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#252D52] text-[#F7F2E7] hover:bg-[#323C6B] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Back to Tracks
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {CAT_SKINS.map((skin) => {
                const isUnlocked = unlockedSkins.includes(skin.id);
                const isSelected = selectedSkin === skin.id;
                return (
                  <button
                    key={skin.id}
                    type="button"
                    disabled={!isUnlocked}
                    onClick={() => onSelectSkin(skin.id)}
                    aria-label={`Select skin ${skin.name}`}
                    className={`text-left p-3 rounded-xl border transition-all ${
                      isSelected
                        ? 'bg-[#262F59] border-[#FFB830]'
                        : isUnlocked
                          ? 'bg-[#1D2444] border-[#2E3863] hover:border-[#64748B] cursor-pointer'
                          : 'bg-[#14182E]/70 border-[#242B4D] opacity-65 cursor-not-allowed'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-4 h-4 rounded-full border border-black/40 shrink-0"
                          style={{ backgroundColor: skin.coatColor }}
                          aria-hidden="true"
                        />
                        <span className="text-sm font-semibold text-[#F7F2E7] truncate">
                          {skin.name}
                        </span>
                      </div>
                      {isSelected ? (
                        <Check className="w-4 h-4 text-[#FFB830] shrink-0" aria-hidden="true" />
                      ) : !isUnlocked ? (
                        <Lock className="w-3.5 h-3.5 text-[#94A3B8] shrink-0" aria-hidden="true" />
                      ) : null}
                    </div>
                    <p className="text-xs text-[#F7F2E7]/70 leading-snug">
                      {isUnlocked ? skin.tagline : `Unlock: ${skin.unlockRuleText}`}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Mode Switcher + Lives Selector */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div
                className="inline-flex items-center p-1 rounded-xl bg-[#101428] border border-[#28315A]"
                role="group"
                aria-label="Game Mode"
              >
                <button
                  type="button"
                  onClick={() => onSelectGameMode('arcade')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    gameMode === 'arcade'
                      ? 'bg-[#FF6B4A] text-white'
                      : 'text-[#F7F2E7]/70 hover:text-white'
                  }`}
                >
                  <Music className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Arcade Flight</span>
                </button>
                <button
                  type="button"
                  onClick={() => onSelectGameMode('boss')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    gameMode === 'boss'
                      ? 'bg-[#FF6B4A] text-white'
                      : 'text-[#F7F2E7]/70 hover:text-white'
                  }`}
                >
                  <Swords className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Boss Battle</span>
                </button>
              </div>

              <div
                className="inline-flex items-center p-1 rounded-xl bg-[#101428] border border-[#28315A]"
                role="group"
                aria-label="Difficulty Lives"
              >
                <button
                  type="button"
                  onClick={() => onSelectPlayMode('lives')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    playMode === 'lives'
                      ? 'bg-[#2B3563] text-[#FFB830]'
                      : 'text-[#F7F2E7]/65 hover:text-white'
                  }`}
                >
                  3 Lives
                </button>
                <button
                  type="button"
                  onClick={() => onSelectPlayMode('sudden-death')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    playMode === 'sudden-death'
                      ? 'bg-[#2B3563] text-[#FB7185]'
                      : 'text-[#F7F2E7]/65 hover:text-white'
                  }`}
                >
                  1-Hit
                </button>
              </div>
            </div>

            {/* Track List */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[#F7F2E7]/75">
                  Select Song or Import .MP3
                </span>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={mp3Importing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#252E58] hover:bg-[#313D73] text-[#FFB830] border border-[#3B4882] transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{mp3Importing ? 'Analyzing...' : 'Import .MP3'}</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".mp3,audio/mpeg,audio/*"
                  onChange={handleFileChange}
                  className="hidden"
                  aria-label="Import MP3 audio file"
                />
              </div>

              {mp3Error && (
                <div
                  role="alert"
                  className="mb-2 px-3 py-2 rounded-lg bg-[#7F1D1D]/50 border border-[#EF4444]/60 text-xs text-[#FECACA]"
                >
                  {mp3Error}
                </div>
              )}

              <div className="space-y-1.5">
                {allTracks.map((t) => {
                  const active = t.id === selectedTrackId;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onSelectTrack(t.id)}
                      className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#252E58] border-[#FFB830]'
                          : 'bg-[#1D2444]/85 border-[#2C3560] hover:border-[#4B5894]'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[#F7F2E7] truncate">
                          {t.title}
                        </div>
                        <div className="text-xs text-[#F7F2E7]/65 truncate">
                          {t.subtitle}
                          {t.kind === 'mp3' ? ` · ${t.detectedOnsets} beats detected` : ''}
                        </div>
                      </div>
                      <div className="text-xs font-mono-num text-[#FFB830] whitespace-nowrap shrink-0">
                        {t.bpm} BPM · {Math.round(t.durationSec)}s
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Boss Roster when Boss Battle is active */}
            {gameMode === 'boss' && (
              <div>
                <div className="text-xs font-semibold text-[#F7F2E7]/75 mb-1.5">
                  Choose Boss Challenger
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {Object.values(BOSS_ROSTER).map((b) => {
                    const active = b.id === bossId;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => onSelectBoss(b.id)}
                        className={`px-2.5 py-2 rounded-xl border text-left transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#2D2554] border-[#FF6B4A]'
                            : 'bg-[#1B203D] border-[#2C3560] hover:border-[#4B5894]'
                        }`}
                      >
                        <div className="text-xs font-bold text-[#F7F2E7] truncate">{b.name}</div>
                        <div className="text-[11px] text-[#F7F2E7]/60 truncate">{b.title}</div>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[11px] text-[#F7F2E7]/65 leading-snug">
                  <Shield className="w-3 h-3 inline mr-1 text-[#FFB830]" aria-hidden="true" />
                  Jump on the beat to fire Harmonic Bolts. Off-beat jumps & wrong red notes trigger{' '}
                  {BOSS_ROSTER[bossId].name}&apos;s attacks!
                </p>
              </div>
            )}

            {/* Skin Preview Bar + Start CTA */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setShowWardrobe(true)}
                className="flex items-center justify-center sm:justify-start gap-2 px-3.5 py-2.5 rounded-xl bg-[#1E2548] hover:bg-[#293362] border border-[#343F72] text-xs font-semibold text-[#F7F2E7] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-[#FFB830]" aria-hidden="true" />
                <span>
                  {activeSkinDef.name} ({unlockedSkins.length}/{CAT_SKINS.length})
                </span>
              </button>

              <button
                type="button"
                data-start="true"
                onClick={onStart}
                className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#FF6B4A] hover:bg-[#FF5733] text-white font-display font-bold text-base shadow-lg transition-transform active:scale-[0.98] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                <span>Start Game</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Safe Margin Single-Line Control Hint */}
      <div className="text-center text-xs text-[#F7F2E7]/65 tracking-wide">
        Space / Click Jump on Beat · P Pause · M Mute
      </div>
    </div>
  );
};
