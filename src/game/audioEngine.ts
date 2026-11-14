import { analyzeAudioSamples, mixAudioBufferToMono } from './beatAnalyzer';
import type { AudioAnalysisResult, JudgmentTier, SynthTrackConfig, TrackConfig } from './types';

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export class RhythmAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private muted = false;
  private isPlaying = false;
  private currentTrack: TrackConfig | null = null;
  private mp3Source: AudioBufferSourceNode | null = null;

  private songStartCtxTime = 0;
  private pausedSongTime = 0;
  private wallStartMs = 0;

  private synthSchedulerId: number | null = null;
  private nextSubBeatIdx = 0;
  private firstBeatSec = 0.25;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.85;
      this.masterGain.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.65;
      this.musicGain.connect(this.masterGain);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.85;
      this.sfxGain.connect(this.masterGain);

      // Reusable white noise buffer for snare/hi-hat/steam SFX
      const sr = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, Math.floor(sr * 0.25), sr);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = buf;
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().then(() => {
        if (this.ctx && this.isPlaying && this.wallStartMs > 0) {
          const elapsed = (performance.now() - this.wallStartMs) / 1000;
          this.songStartCtxTime = this.ctx.currentTime - elapsed;
        }
      });
    }
    return this.ctx;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.85, this.ctx.currentTime, 0.02);
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  public async decodeAndAnalyzeMp3(file: File): Promise<{
    audioBuffer: AudioBuffer;
    analysis: AudioAnalysisResult;
  }> {
    const ctx = this.ensureContext();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const mono = mixAudioBufferToMono(audioBuffer);
    const analysis = analyzeAudioSamples(mono, audioBuffer.sampleRate);
    return { audioBuffer, analysis };
  }

  public startTrack(track: TrackConfig, firstBeatSec = 0.25): void {
    this.stop();
    const ctx = this.ensureContext();
    this.currentTrack = track;
    this.firstBeatSec = firstBeatSec;
    this.pausedSongTime = 0;
    this.isPlaying = true;
    this.wallStartMs = performance.now();
    this.songStartCtxTime = ctx.currentTime + 0.04;

    if (track.kind === 'mp3') {
      this.startMp3Buffer(track.audioBuffer, 0, this.songStartCtxTime);
    } else {
      this.nextSubBeatIdx = 0;
      this.startSynthLoop(track);
    }
  }

  public pause(): void {
    if (!this.isPlaying || !this.ctx) return;
    this.pausedSongTime = this.getSongTime();
    this.isPlaying = false;
    this.stopSourceNodes();
  }

  public resume(): void {
    if (this.isPlaying || !this.currentTrack) return;
    const ctx = this.ensureContext();
    this.isPlaying = true;
    this.wallStartMs = performance.now() - this.pausedSongTime * 1000;
    this.songStartCtxTime = ctx.currentTime - this.pausedSongTime;

    if (this.currentTrack.kind === 'mp3') {
      this.startMp3Buffer(this.currentTrack.audioBuffer, this.pausedSongTime, ctx.currentTime);
    } else {
      const subBeatSec = 60 / this.currentTrack.bpm / 2;
      this.nextSubBeatIdx = Math.max(
        0,
        Math.ceil((this.pausedSongTime - this.firstBeatSec) / subBeatSec),
      );
      this.startSynthLoop(this.currentTrack);
    }
  }

  public stop(): void {
    this.isPlaying = false;
    this.pausedSongTime = 0;
    this.wallStartMs = 0;
    this.stopSourceNodes();
  }

  public getSongTime(): number {
    if (!this.ctx || !this.isPlaying) {
      return this.pausedSongTime;
    }
    if (this.ctx.state !== 'running') {
      return Math.max(0, (performance.now() - this.wallStartMs) / 1000);
    }
    return Math.max(0, this.ctx.currentTime - this.songStartCtxTime);
  }

  private stopSourceNodes(): void {
    if (this.mp3Source) {
      try {
        this.mp3Source.stop();
        this.mp3Source.disconnect();
      } catch {
        // already stopped
      }
      this.mp3Source = null;
    }
    if (this.synthSchedulerId !== null) {
      window.clearInterval(this.synthSchedulerId);
      this.synthSchedulerId = null;
    }
  }

  private startMp3Buffer(buffer: AudioBuffer, offsetSec: number, startAtCtxTime: number): void {
    if (!this.ctx || !this.musicGain) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.musicGain);
    const delay = Math.max(0, startAtCtxTime - this.ctx.currentTime);
    src.start(this.ctx.currentTime + delay, Math.max(0, offsetSec));
    this.mp3Source = src;
  }

  private startSynthLoop(track: SynthTrackConfig): void {
    const schedule = () => {
      if (!this.isPlaying || !this.ctx || !this.musicGain) return;
      const subBeatSec = 60 / track.bpm / 2; // 8th-note grid
      const lookaheadSec = 0.14;
      const nowSong = this.getSongTime();

      while (true) {
        const subBeatTime = this.firstBeatSec + this.nextSubBeatIdx * subBeatSec;
        if (subBeatTime > nowSong + lookaheadSec || subBeatTime > track.durationSec) {
          break;
        }
        const ctxTime = this.songStartCtxTime + subBeatTime;
        if (ctxTime >= this.ctx.currentTime - 0.02) {
          this.scheduleSynthStep(track, this.nextSubBeatIdx, Math.max(this.ctx.currentTime, ctxTime));
        }
        this.nextSubBeatIdx++;
      }
    };

    schedule();
    this.synthSchedulerId = window.setInterval(schedule, 35);
  }

  private scheduleSynthStep(track: SynthTrackConfig, stepIdx: number, when: number): void {
    if (!this.ctx || !this.musicGain) return;
    const stepInBar = stepIdx % 8; // 8 eighth-notes per bar (4/4)
    const barIdx = Math.floor(stepIdx / 8);

    // Kick on beats 1 and 3 (steps 0 and 4)
    if (stepInBar === 0 || stepInBar === 4) {
      this.triggerKick(when);
    }
    // Snare on beats 2 and 4 (steps 2 and 6)
    if (stepInBar === 2 || stepInBar === 6) {
      this.triggerSnare(when);
    }
    // Crisp hi-hat on all 8th notes after intro bar
    if (barIdx >= 1) {
      this.triggerHiHat(when, stepInBar % 2 === 1 ? 0.11 : 0.06);
    }

    // Bass groove
    const bassDeg = track.bassPattern[stepInBar];
    if (bassDeg >= 0) {
      const interval = track.scaleIntervals[bassDeg % track.scaleIntervals.length];
      const freq = midiToFreq(track.keyRootMidi + interval);
      this.triggerBassNote(when, freq, 0.22);
    }

    // Lead melody on off-beats / bars >= 1
    if (barIdx >= 1 && (stepInBar % 2 === 0 || barIdx % 2 === 1)) {
      const leadDeg = track.leadPattern[(stepInBar + barIdx) % track.leadPattern.length];
      if (leadDeg >= 0) {
        const interval = track.scaleIntervals[leadDeg % track.scaleIntervals.length];
        const freq = midiToFreq(track.keyRootMidi + 24 + interval);
        this.triggerLeadNote(when, freq, 0.14);
      }
    }
  }

  private triggerKick(when: number): void {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(145, when);
    osc.frequency.exponentialRampToValueAtTime(42, when + 0.11);
    gain.gain.setValueAtTime(0.55, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.18);
    osc.connect(gain);
    gain.connect(this.musicGain);
    osc.start(when);
    osc.stop(when + 0.2);
  }

  private triggerSnare(when: number): void {
    if (!this.ctx || !this.musicGain || !this.noiseBuffer) return;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1850, when);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.24, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.12);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);
    noise.start(when);
    noise.stop(when + 0.14);
  }

  private triggerHiHat(when: number, level: number): void {
    if (!this.ctx || !this.musicGain || !this.noiseBuffer) return;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(6500, when);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(level, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.045);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);
    noise.start(when);
    noise.stop(when + 0.05);
  }

  private triggerBassNote(when: number, freq: number, dur: number): void {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, when);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(620, when);
    gain.gain.setValueAtTime(0.28, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + dur);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }

  private triggerLeadNote(when: number, freq: number, dur: number): void {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, when);
    gain.gain.setValueAtTime(0.12, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + dur);
    osc.connect(gain);
    gain.connect(this.musicGain);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }

  // --- Gameplay SFX ---

  public playJumpSfx(tier: JudgmentTier): void {
    const ctx = this.ensureContext();
    if (!this.sfxGain) return;
    const now = ctx.currentTime;
    const pitchVar = 0.94 + Math.random() * 0.12;

    if (tier === 'PERFECT') {
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc2.type = 'sine';
      osc.frequency.setValueAtTime(520 * pitchVar, now);
      osc.frequency.exponentialRampToValueAtTime(780 * pitchVar, now + 0.09);
      osc2.frequency.setValueAtTime(780 * pitchVar, now);
      osc2.frequency.exponentialRampToValueAtTime(1040 * pitchVar, now + 0.11);
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      osc.connect(gain);
      osc2.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now);
      osc2.start(now);
      osc.stop(now + 0.15);
      osc2.stop(now + 0.15);
    } else if (tier === 'GOOD') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(420 * pitchVar, now);
      osc.frequency.exponentialRampToValueAtTime(580 * pitchVar, now + 0.08);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.11);
    } else {
      // Soft offbeat thump
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(210 * pitchVar, now);
      osc.frequency.exponentialRampToValueAtTime(125, now + 0.08);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.1);
    }
  }

  public playNoteSfx(isHazard: boolean): void {
    const ctx = this.ensureContext();
    if (!this.sfxGain) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    if (isHazard) {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.linearRampToValueAtTime(105, now + 0.18);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.21);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1174, now + 0.05);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.19);
    }
  }

  public playBossTelegraphSfx(): void {
    const ctx = this.ensureContext();
    if (!this.sfxGain) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(480, now + 0.32);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.36);
  }

  public playDamageSfx(): void {
    const ctx = this.ensureContext();
    if (!this.sfxGain) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(75, now + 0.22);
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  public playVictorySfx(): void {
    const ctx = this.ensureContext();
    if (!this.sfxGain) return;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      if (!this.sfxGain) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = now + idx * 0.09;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.3);
    });
  }
}
