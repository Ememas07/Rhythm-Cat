import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Link2,
  Loader2,
  LogOut,
  Play,
  Swords,
  Upload,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import type { PlayerRole, RoomSnapshot } from '../game/multiplayerTypes';
import { getSkinById } from '../game/skins';
import type { Mp3TrackConfig, PlayMode, TrackConfig } from '../game/types';

interface MultiplayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  playerName: string;
  onChangePlayerName: (name: string) => void;
  initialJoinCode: string;
  role: PlayerRole | null;
  room: RoomSnapshot | null;
  tracks: TrackConfig[];
  selectedTrackId: string;
  onSelectTrack: (id: string) => void;
  importedTrack: Mp3TrackConfig | null;
  onImportMp3: (file: File) => Promise<void>;
  mp3Importing: boolean;
  playMode: PlayMode;
  onSelectPlayMode: (mode: PlayMode) => void;
  busy: boolean;
  audioSyncStatus: 'idle' | 'uploading' | 'downloading' | 'ready' | 'error';
  errorMessage: string | null;
  isReconnecting?: boolean;
  reconnectAttempt?: number;
  latencyMs?: number | null;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  onToggleReady: () => void;
  onStartMatch: () => void;
  onLeaveRoom: () => void;
}

export const MultiplayerModal: React.FC<MultiplayerModalProps> = ({
  isOpen,
  onClose,
  playerName,
  onChangePlayerName,
  initialJoinCode,
  role,
  room,
  tracks,
  selectedTrackId,
  onSelectTrack,
  importedTrack,
  onImportMp3,
  mp3Importing,
  playMode,
  onSelectPlayMode,
  busy,
  audioSyncStatus,
  errorMessage,
  isReconnecting = false,
  reconnectAttempt = 0,
  latencyMs = null,
  onCreateRoom,
  onJoinRoom,
  onToggleReady,
  onStartMatch,
  onLeaveRoom,
}) => {
  const [joinCode, setJoinCode] = useState(initialJoinCode);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (initialJoinCode) {
      setJoinCode(initialJoinCode.toUpperCase());
    }
  }, [initialJoinCode]);

  if (!isOpen) return null;

  const allTracks: TrackConfig[] = importedTrack ? [...tracks, importedTrack] : tracks;

  const handleCopyText = async (text: string, which: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
      } finally {
        document.body.removeChild(textarea);
      }
    }
    if (which === 'code') {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    } else {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1800);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await onImportMp3(file);
    e.target.value = '';
  };

  const inviteUrl = room
    ? `${window.location.origin}${window.location.pathname}?room=${room.code}`
    : '';

  const playModeLabel = (mode: PlayMode) =>
    mode === 'infinite' ? 'Infinite Lives' : mode === 'sudden-death' ? '1-Hit Sudden Death' : '3 Lives';

  const canHostStart =
    Boolean(room) &&
    role === 'host' &&
    !isReconnecting &&
    Boolean(room?.guest?.connected) &&
    Boolean(room?.guest?.ready) &&
    (room?.trackMeta.kind !== 'mp3' || (room.trackMeta.hasAudioAsset && audioSyncStatus !== 'uploading'));

  const hostBlockReason = isReconnecting
    ? 'Reconnecting to server...'
    : !room?.guest
      ? 'Waiting for opponent to join...'
      : !room.guest.connected
        ? 'Opponent reconnecting...'
        : !room.guest.ready
          ? 'Waiting for opponent to Ready Up...'
          : room.trackMeta.kind === 'mp3' && (!room.trackMeta.hasAudioAsset || audioSyncStatus === 'uploading')
            ? 'Uploading your MP3 to room...'
            : null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-[#0B0E1D]/80"
      role="dialog"
      aria-modal="true"
      aria-label="1v1 Versus Lobby"
    >
      <div className="w-full max-w-lg bg-[#171C34] border border-[#343E6B] rounded-2xl p-5 sm:p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#252E58] border border-[#3B4882] flex items-center justify-center text-[#FFB830]">
              <Swords className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-display text-xl font-extrabold text-[#F7F2E7] leading-tight">
                1v1 Versus Mode
              </h2>
              <p className="text-xs text-[#F7F2E7]/65">
                Host a match with built-in beats or your own .MP3
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={room ? onLeaveRoom : onClose}
            aria-label={room ? 'Leave room' : 'Close 1v1 lobby'}
            className="w-8 h-8 rounded-lg bg-[#232B4F] hover:bg-[#2F3968] flex items-center justify-center text-[#F7F2E7]/80 cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="mb-4 px-3.5 py-2.5 rounded-xl bg-[#7F1D1D]/55 border border-[#EF4444]/65 text-xs text-[#FECACA]"
          >
            {errorMessage}
          </div>
        )}

        {isReconnecting && (
          <div
            role="status"
            className="mb-4 px-3.5 py-2.5 rounded-xl bg-[#78350F]/70 border border-[#F59E0B]/80 text-xs text-[#FEF3C7] flex items-center gap-2"
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#FBBF24]" />
            <span>
              Connection lost. Reconnecting to multiplayer room
              {reconnectAttempt > 1 ? ` (attempt ${reconnectAttempt})...` : '...'}
            </span>
          </div>
        )}

        {!room ? (
          <div className="space-y-4">
            <div>
              <label
                htmlFor="mp-player-name"
                className="block text-xs font-semibold text-[#F7F2E7]/75 mb-1.5"
              >
                Your Cat Name
              </label>
              <input
                id="mp-player-name"
                type="text"
                maxLength={18}
                value={playerName}
                onChange={(e) => onChangePlayerName(e.target.value)}
                placeholder="Enter your name"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#101428] border border-[#2C3560] focus:border-[#FFB830] outline-none text-sm text-[#F7F2E7]"
              />
            </div>

            {/* Host Card */}
            <div className="p-4 rounded-xl bg-[#11152A] border border-[#29325A] space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-bold text-[#F7F2E7]">Host a 1v1 Room</div>
                  <div className="text-xs text-[#F7F2E7]/65">
                    Share a room code or link. Custom .MP3s stream to your rival automatically.
                  </div>
                </div>
              </div>

              {/* Quick Song / MP3 picker before creating */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <select
                  aria-label="Choose song for 1v1 room"
                  value={selectedTrackId}
                  onChange={(e) => onSelectTrack(e.target.value)}
                  className="flex-1 min-w-[180px] px-3 py-2 rounded-lg bg-[#1A203E] border border-[#303B6B] text-xs font-semibold text-[#F7F2E7] outline-none cursor-pointer"
                >
                  {allTracks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title} ({t.bpm} BPM){t.kind === 'mp3' ? ' [MP3]' : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={mp3Importing}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-[#252E58] hover:bg-[#313D73] text-[#FFB830] border border-[#3B4882] transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{mp3Importing ? 'Analyzing...' : 'Use .MP3'}</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".mp3,audio/mpeg,audio/*"
                  onChange={handleFileChange}
                  className="hidden"
                  aria-label="Import MP3 for 1v1 match"
                />
              </div>

              <button
                type="button"
                disabled={busy || mp3Importing}
                onClick={onCreateRoom}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#FF6B4A] hover:bg-[#FF5733] text-white font-display font-bold text-sm transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
              >
                <Users className="w-4 h-4" aria-hidden="true" />
                <span>{busy ? 'Creating Room...' : 'Create 1v1 Room'}</span>
              </button>
            </div>

            {/* Join Card */}
            <div className="p-4 rounded-xl bg-[#11152A] border border-[#29325A] space-y-2.5">
              <div className="text-sm font-bold text-[#F7F2E7]">Join an Opponent&apos;s Room</div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  maxLength={8}
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  placeholder="ROOM CODE"
                  aria-label="Room Code"
                  className="flex-1 px-3.5 py-2.5 rounded-xl bg-[#1A203E] border border-[#303B6B] focus:border-[#38BDF8] outline-none font-mono-num text-sm font-bold tracking-widest text-[#F7F2E7] uppercase"
                />
                <button
                  type="button"
                  disabled={busy || joinCode.trim().length < 4}
                  onClick={() => onJoinRoom(joinCode.trim())}
                  className="px-4 py-2.5 rounded-xl bg-[#252E58] hover:bg-[#323E75] text-[#38BDF8] border border-[#3B4882] font-display font-bold text-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45"
                >
                  Join Room
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Room Code & Share Link Banner */}
            <div className="p-3.5 rounded-xl bg-[#101428] border border-[#2C3560] flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-[#F7F2E7]/60 uppercase tracking-wider">
                    Room Code
                  </span>
                  {latencyMs !== null && latencyMs !== undefined && (
                    <span
                      title="WebSocket Round-Trip Latency"
                      className={`text-[10px] font-mono-num font-bold px-1.5 py-0.5 rounded ${
                        latencyMs < 120
                          ? 'bg-[#064E3B]/70 text-[#34D399]'
                          : latencyMs < 250
                            ? 'bg-[#78350F]/70 text-[#FBBF24]'
                            : 'bg-[#7F1D1D]/70 text-[#F87171]'
                      }`}
                    >
                      ● {latencyMs}ms
                    </span>
                  )}
                </div>
                <div
                  data-testid="room-code-display"
                  className="font-mono-num text-2xl font-extrabold tracking-widest text-[#FFB830]"
                >
                  {room.code}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopyText(room.code, 'code')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1D2444] hover:bg-[#293362] border border-[#343F72] text-xs font-semibold text-[#F7F2E7] whitespace-nowrap cursor-pointer"
                >
                  {copiedCode ? <Check className="w-3.5 h-3.5 text-[#34D399]" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedCode ? 'Copied' : 'Copy Code'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopyText(inviteUrl, 'link')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#252E58] hover:bg-[#313D73] border border-[#3B4882] text-xs font-semibold text-[#38BDF8] whitespace-nowrap cursor-pointer"
                >
                  {copiedLink ? <Check className="w-3.5 h-3.5 text-[#34D399]" /> : <Link2 className="w-3.5 h-3.5" />}
                  <span>{copiedLink ? 'Link Copied' : 'Invite Link'}</span>
                </button>
              </div>
            </div>

            {/* Track & Lives Configuration */}
            <div className="p-3.5 rounded-xl bg-[#11152A] border border-[#29325A] space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#F7F2E7]/60">Match Track</div>
                  <div className="text-sm font-bold text-[#F7F2E7] truncate">
                    {room.trackMeta.title}
                  </div>
                  <div className="text-xs text-[#F7F2E7]/65 font-mono-num">
                    {room.trackMeta.bpm} BPM · {Math.round(room.trackMeta.durationSec)}s ·{' '}
                    {playModeLabel(room.playMode)}
                  </div>
                </div>
                {role === 'host' && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={mp3Importing}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#252E58] hover:bg-[#313D73] text-[#FFB830] border border-[#3B4882] whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{mp3Importing ? 'Analyzing...' : 'Swap .MP3'}</span>
                  </button>
                )}
              </div>

              {role === 'host' && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <select
                    aria-label="Host track selector"
                    value={selectedTrackId}
                    onChange={(e) => onSelectTrack(e.target.value)}
                    className="flex-1 min-w-[160px] px-2.5 py-1.5 rounded-lg bg-[#1A203E] border border-[#303B6B] text-xs font-semibold text-[#F7F2E7] outline-none cursor-pointer"
                  >
                    {allTracks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title} ({t.bpm} BPM){t.kind === 'mp3' ? ' [MP3]' : ''}
                      </option>
                    ))}
                  </select>
                  <div className="inline-flex items-center p-0.5 rounded-lg bg-[#1A203E] border border-[#303B6B]">
                    {(['lives', 'sudden-death', 'infinite'] as PlayMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => onSelectPlayMode(mode)}
                        className={`px-2 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap cursor-pointer ${
                          playMode === mode
                            ? 'bg-[#2B3563] text-[#FFB830]'
                            : 'text-[#F7F2E7]/65 hover:text-white'
                        }`}
                      >
                        {mode === 'lives' ? '3 Lives' : mode === 'sudden-death' ? '1-Hit' : 'Infinite'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept=".mp3,audio/mpeg,audio/*"
                onChange={handleFileChange}
                className="hidden"
                aria-label="Swap MP3 track in lobby"
              />

              {/* MP3 Sync Status */}
              {room.trackMeta.kind === 'mp3' && (
                <div className="flex items-center gap-2 text-xs pt-1">
                  {audioSyncStatus === 'uploading' || audioSyncStatus === 'downloading' ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#38BDF8]" />
                      <span className="text-[#38BDF8]">
                        {audioSyncStatus === 'uploading'
                          ? 'Uploading .MP3 audio to room...'
                          : 'Downloading & decoding Host .MP3...'}
                      </span>
                    </>
                  ) : audioSyncStatus === 'error' ? (
                    <span className="text-[#FCA5A5]">Failed to sync custom .MP3 audio.</span>
                  ) : room.trackMeta.hasAudioAsset ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[#34D399]" />
                      <span className="text-[#34D399]">
                        {role === 'host' ? 'Custom .MP3 uploaded for opponent' : 'Host .MP3 ready to play!'}
                      </span>
                    </>
                  ) : (
                    <span className="text-[#F7F2E7]/65">Preparing .MP3 stream...</span>
                  )}
                </div>
              )}
            </div>

            {/* Players Roster */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Host Slot */}
              <div className="p-3 rounded-xl bg-[#11152A] border border-[#29325A]">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[11px] font-semibold text-[#FFB830] uppercase">Host</span>
                  {room.host.connected ? (
                    <span className="text-[11px] font-semibold text-[#34D399]">Ready</span>
                  ) : (
                    <span className="text-[11px] font-semibold text-[#FBBF24] flex items-center gap-1">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                      Reconnecting...
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="w-3.5 h-3.5 rounded-full border border-black/40 shrink-0"
                    style={{ backgroundColor: getSkinById(room.host.skinId).coatColor }}
                  />
                  <span className="text-sm font-bold text-[#F7F2E7] truncate">
                    {room.host.name}
                    {role === 'host' ? ' (You)' : ''}
                  </span>
                </div>
              </div>

              {/* Guest Slot */}
              <div className="p-3 rounded-xl bg-[#11152A] border border-[#29325A]">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[11px] font-semibold text-[#38BDF8] uppercase">Challenger</span>
                  {room.guest ? (
                    !room.guest.connected ? (
                      <span className="text-[11px] font-semibold text-[#FBBF24] flex items-center gap-1">
                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
                        Reconnecting...
                      </span>
                    ) : (
                      <span
                        className={`text-[11px] font-semibold ${
                          room.guest.ready ? 'text-[#34D399]' : 'text-[#F7F2E7]/60'
                        }`}
                      >
                        {room.guest.ready ? 'Ready' : 'Not Ready'}
                      </span>
                    )
                  ) : (
                    <span className="text-[11px] text-[#F7F2E7]/45">Empty</span>
                  )}
                </div>
                {room.guest && room.guest.connected ? (
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3.5 h-3.5 rounded-full border border-black/40 shrink-0"
                      style={{ backgroundColor: getSkinById(room.guest.skinId).coatColor }}
                    />
                    <span className="text-sm font-bold text-[#F7F2E7] truncate">
                      {room.guest.name}
                      {role === 'guest' ? ' (You)' : ''}
                    </span>
                  </div>
                ) : (
                  <div className="text-xs text-[#F7F2E7]/50">Waiting for opponent...</div>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={onLeaveRoom}
                className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#232B4F] hover:bg-[#2F3968] text-[#F7F2E7] font-semibold text-sm whitespace-nowrap shrink-0 cursor-pointer"
              >
                <LogOut className="w-4 h-4" aria-hidden="true" />
                <span>Leave</span>
              </button>

              {role === 'host' ? (
                <button
                  type="button"
                  disabled={!canHostStart}
                  onClick={onStartMatch}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#FF6B4A] hover:bg-[#FF5733] text-white font-display font-bold text-sm transition-colors whitespace-nowrap cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                  <span>{hostBlockReason ?? 'Start 1v1 Match'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isReconnecting || (room.trackMeta.kind === 'mp3' && audioSyncStatus !== 'ready')}
                  onClick={onToggleReady}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-display font-bold text-sm transition-colors whitespace-nowrap cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                    room.guest?.ready
                      ? 'bg-[#10B981] hover:bg-[#059669] text-[#052E16]'
                      : 'bg-[#FF6B4A] hover:bg-[#FF5733] text-white'
                  }`}
                >
                  <UserCheck className="w-4 h-4" aria-hidden="true" />
                  <span>
                    {isReconnecting
                      ? 'Reconnecting...'
                      : room.trackMeta.kind === 'mp3' && audioSyncStatus !== 'ready'
                        ? 'Syncing Host .MP3...'
                        : room.guest?.ready
                          ? 'Ready! (Click to Unready)'
                          : 'Ready Up'}
                  </span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
