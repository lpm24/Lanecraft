import { SoundEvent, Race, BuildingType } from '../simulation/types';
import { Camera } from '../rendering/Camera';
import { subscribeToAudioSettings, type AudioSettings } from './AudioSettings';
import type { WeatherType } from '../rendering/VisualEffects';
import rainLoopUrl from '../assets/audio/Weather/freesound-soft-rain-loop-preview.mp3?url';

const TILE_SIZE = 16;

const SFX_MASTER_GAIN = 0.7;
const MUSIC_MASTER_GAIN = 0.075;

type RhythmStyle = 'standard' | 'heavy' | 'sparse' | 'tribal' | 'none';
type MusicMode = 'menu' | 'raceSelect' | 'battle';

interface RaceMusicProfile {
  bpmCalm: number;
  bpmAction: number;
  bpmCritical: number;
  chordsCalm: number[][];
  chordsAction: number[][];
  chordsCritical: number[][];
  padType: OscillatorType;
  arpType: OscillatorType;
  arpOctaveCalm: number;
  arpOctaveCrit: number;
  padDetune: number;
  rhythmStyle: RhythmStyle;
}

const N: Record<string, number> = {
  C2: 65.41, D2: 73.42, Eb2: 77.78, E2: 82.41, F2: 87.31, Gb2: 92.50, G2: 98.00, Ab2: 103.83, A2: 110, Bb2: 116.54, B2: 123.47,
  C3: 130.81, D3: 146.83, Eb3: 155.56, E3: 164.81, F3: 174.61, Gb3: 185.00, G3: 196.00, Ab3: 207.65, A3: 220, Bb3: 233.08, B3: 246.94,
  C4: 261.63, D4: 293.66, Eb4: 311.13, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440, Bb4: 466.16, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, Bb5: 932.33,
};

const RACE_MUSIC: Record<Race, RaceMusicProfile> = {
  [Race.Crown]: {
    bpmCalm: 70, bpmAction: 90, bpmCritical: 120,
    chordsCalm: [[N.C3, N.E3, N.G3], [N.F2, N.A3, N.C3], [N.G2, N.B3, N.D3], [N.A2, N.C3, N.E3]],
    chordsAction: [[N.C3, N.E3, N.G3, N.C4], [N.F2, N.A3, N.C3, N.F3], [N.G2, N.B3, N.D3, N.G3], [N.A2, N.C3, N.E3, N.A3]],
    chordsCritical: [[N.C3, N.E3, N.G3, N.C4, N.Bb3], [N.F2, N.A3, N.C3, N.Eb3], [N.G2, N.B3, N.D3, N.G3, N.F3], [N.A2, N.C3, N.E3, N.Ab3]],
    padType: 'triangle', arpType: 'square', arpOctaveCalm: 2, arpOctaveCrit: 4, padDetune: 1.003, rhythmStyle: 'standard',
  },
  [Race.Horde]: {
    bpmCalm: 80, bpmAction: 105, bpmCritical: 130,
    chordsCalm: [[N.E2, N.B3], [N.G2, N.D3], [N.A2, N.E3], [N.D2, N.A3]],
    chordsAction: [[N.E2, N.B3, N.E3], [N.G2, N.D3, N.G3], [N.A2, N.E3, N.A3], [N.D2, N.A3, N.D3]],
    chordsCritical: [[N.E2, N.B3, N.E3, N.Bb3], [N.G2, N.D3, N.G3, N.F3], [N.A2, N.E3, N.A3, N.Eb3], [N.D2, N.A3, N.D3, N.Ab3]],
    padType: 'sawtooth', arpType: 'sawtooth', arpOctaveCalm: 1, arpOctaveCrit: 2, padDetune: 1.008, rhythmStyle: 'heavy',
  },
  [Race.Goblins]: {
    bpmCalm: 85, bpmAction: 110, bpmCritical: 140,
    chordsCalm: [[N.A2, N.C3, N.E3], [N.D3, N.F3, N.A3], [N.E2, N.G3, N.B3], [N.A2, N.C3, N.E3]],
    chordsAction: [[N.A2, N.C3, N.E3, N.A3], [N.D3, N.F3, N.A3, N.D4], [N.E2, N.G3, N.B3, N.E3], [N.F2, N.A3, N.C3, N.F3]],
    chordsCritical: [[N.A2, N.C3, N.Eb3, N.A3], [N.D3, N.F3, N.Ab3], [N.E2, N.G3, N.Bb3, N.E3], [N.F2, N.Ab3, N.C3]],
    padType: 'triangle', arpType: 'square', arpOctaveCalm: 4, arpOctaveCrit: 8, padDetune: 1.005, rhythmStyle: 'sparse',
  },
  [Race.Oozlings]: {
    bpmCalm: 65, bpmAction: 85, bpmCritical: 110,
    chordsCalm: [[N.C3, N.D3, N.Gb3], [N.D3, N.E3, N.Ab3], [N.E3, N.Gb3, N.Bb3], [N.Gb3, N.Ab3, N.C4]],
    chordsAction: [[N.C3, N.D3, N.Gb3, N.C4], [N.D3, N.E3, N.Ab3, N.D4], [N.E3, N.Gb3, N.Bb3, N.E4], [N.Gb3, N.Ab3, N.C4, N.Gb2]],
    chordsCritical: [[N.C3, N.E3, N.Ab3, N.C4], [N.D3, N.Gb3, N.Bb3], [N.Eb3, N.G3, N.B3, N.Eb4], [N.Gb3, N.Bb3, N.D4]],
    padType: 'sine', arpType: 'sine', arpOctaveCalm: 2, arpOctaveCrit: 4, padDetune: 1.012, rhythmStyle: 'sparse',
  },
  [Race.Demon]: {
    bpmCalm: 55, bpmAction: 75, bpmCritical: 100,
    chordsCalm: [[N.C2, N.Eb2, N.Gb2], [N.D2, N.F2, N.Ab2], [N.Eb2, N.Gb2, N.A2], [N.C2, N.Eb2, N.Gb2]],
    chordsAction: [[N.C2, N.Eb2, N.Gb2, N.C3], [N.D2, N.F2, N.Ab2, N.D3], [N.Eb2, N.Gb2, N.A2, N.Eb3], [N.B2, N.D3, N.F3, N.Ab3]],
    chordsCritical: [[N.C2, N.Eb2, N.Gb2, N.A2, N.C3], [N.D2, N.F2, N.Ab2, N.B2], [N.Eb2, N.Gb2, N.A2, N.C3, N.Eb3], [N.E2, N.G3, N.Bb3, N.D3]],
    padType: 'sawtooth', arpType: 'square', arpOctaveCalm: 1, arpOctaveCrit: 2, padDetune: 1.006, rhythmStyle: 'heavy',
  },
  [Race.Deep]: {
    bpmCalm: 55, bpmAction: 72, bpmCritical: 95,
    chordsCalm: [[N.D2, N.G2, N.A2], [N.E2, N.A2, N.B2], [N.G2, N.C3, N.D3], [N.A2, N.D3, N.E3]],
    chordsAction: [[N.D2, N.G2, N.A2, N.D3], [N.E2, N.A2, N.B2, N.E3], [N.G2, N.C3, N.D3, N.G3], [N.A2, N.D3, N.E3, N.A3]],
    chordsCritical: [[N.D2, N.G2, N.A2, N.D3, N.F3], [N.E2, N.A2, N.B2, N.E3, N.G3], [N.G2, N.C3, N.D3, N.G3, N.Bb3], [N.A2, N.D3, N.E3, N.A3, N.C4]],
    padType: 'sine', arpType: 'triangle', arpOctaveCalm: 2, arpOctaveCrit: 4, padDetune: 1.004, rhythmStyle: 'none',
  },
  [Race.Wild]: {
    bpmCalm: 75, bpmAction: 100, bpmCritical: 125,
    chordsCalm: [[N.A2, N.C3, N.E3], [N.G2, N.C3, N.D3], [N.E2, N.G3, N.A3], [N.D2, N.G2, N.A2]],
    chordsAction: [[N.A2, N.C3, N.E3, N.A3], [N.G2, N.C3, N.D3, N.G3], [N.E2, N.G3, N.A3, N.E3], [N.D2, N.G2, N.A2, N.D3]],
    chordsCritical: [[N.A2, N.C3, N.E3, N.A3, N.G3], [N.G2, N.C3, N.D3, N.G3, N.E3], [N.E2, N.G3, N.A3, N.C4], [N.D2, N.G2, N.A2, N.D3, N.C3]],
    padType: 'triangle', arpType: 'triangle', arpOctaveCalm: 2, arpOctaveCrit: 4, padDetune: 1.002, rhythmStyle: 'tribal',
  },
  [Race.Geists]: {
    bpmCalm: 58, bpmAction: 78, bpmCritical: 105,
    chordsCalm: [[N.B2, N.D3, N.F3], [N.E2, N.G3, N.Bb3], [N.A2, N.C3, N.Eb3], [N.D2, N.F2, N.Ab2]],
    chordsAction: [[N.B2, N.D3, N.F3, N.B3], [N.E2, N.G3, N.Bb3, N.E3], [N.A2, N.C3, N.Eb3, N.A3], [N.D2, N.F2, N.Ab2, N.D3]],
    chordsCritical: [[N.B2, N.D3, N.F3, N.A3, N.B3], [N.E2, N.G3, N.Bb3, N.D3, N.E3], [N.A2, N.C3, N.Eb3, N.Gb3], [N.D2, N.F2, N.Ab2, N.B2, N.D3]],
    padType: 'sine', arpType: 'square', arpOctaveCalm: 4, arpOctaveCrit: 8, padDetune: 1.005, rhythmStyle: 'sparse',
  },
  [Race.Tenders]: {
    bpmCalm: 60, bpmAction: 80, bpmCritical: 105,
    chordsCalm: [[N.C3, N.E3, N.G3, N.B3], [N.F2, N.A3, N.C3, N.E3], [N.G2, N.B3, N.D3, N.Gb3], [N.A2, N.C3, N.E3, N.G3]],
    chordsAction: [[N.C3, N.E3, N.G3, N.B3, N.D4], [N.F2, N.A3, N.C3, N.E3, N.A3], [N.G2, N.B3, N.D3, N.Gb3, N.A3], [N.A2, N.C3, N.E3, N.G3, N.C4]],
    chordsCritical: [[N.C3, N.E3, N.G3, N.Bb3, N.D4], [N.F2, N.A3, N.C3, N.Eb3], [N.G2, N.B3, N.D3, N.F3, N.A3], [N.A2, N.C3, N.Eb3, N.G3]],
    padType: 'sine', arpType: 'triangle', arpOctaveCalm: 2, arpOctaveCrit: 4, padDetune: 1.002, rhythmStyle: 'none',
  },
};

const MENU_PROFILE: RaceMusicProfile = {
  bpmCalm: 68,
  bpmAction: 76,
  bpmCritical: 84,
  chordsCalm: [[N.C3, N.G3, N.B3], [N.A2, N.E3, N.G3], [N.F2, N.C3, N.E3], [N.G2, N.D3, N.B3]],
  chordsAction: [[N.C3, N.E3, N.G3, N.B3], [N.A2, N.C3, N.E3, N.G3], [N.F2, N.A3, N.C3, N.E3], [N.G2, N.B3, N.D3, N.G3]],
  chordsCritical: [[N.C3, N.E3, N.G3, N.B3], [N.A2, N.C3, N.E3, N.G3], [N.F2, N.A3, N.C3, N.E3], [N.G2, N.B3, N.D3, N.G3]],
  padType: 'sine',
  arpType: 'triangle',
  arpOctaveCalm: 2,
  arpOctaveCrit: 2,
  padDetune: 1.002,
  rhythmStyle: 'none',
};

const ARP_PATTERNS = [
  [0, 1, 2, 1],
  [0, 2, 1, 2],
  [2, 1, 0, 1],
  [0, 1, 2, 0],
];

function cloneProfile(profile: RaceMusicProfile): RaceMusicProfile {
  return {
    ...profile,
    chordsCalm: profile.chordsCalm.map(chord => [...chord]),
    chordsAction: profile.chordsAction.map(chord => [...chord]),
    chordsCritical: profile.chordsCritical.map(chord => [...chord]),
  };
}

function createRaceSelectProfile(race: Race): RaceMusicProfile {
  const base = cloneProfile(RACE_MUSIC[race] ?? RACE_MUSIC[Race.Crown]);
  base.bpmCalm = Math.max(52, Math.round(base.bpmCalm * 0.82));
  base.bpmAction = Math.max(base.bpmCalm + 6, Math.round(base.bpmAction * 0.84));
  base.bpmCritical = Math.max(base.bpmAction + 8, Math.round(base.bpmCritical * 0.84));
  return base;
}

export class SoundManager {
  private actx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBufferCache = new Map<number, AudioBuffer>();
  private settings: AudioSettings;
  private settingsUnsub: (() => void) | null = null;
  // Per-category cooldowns — prevent audio spam in large battles
  private lastPlayTime = new Map<string, number>();
  private playCounts = new Map<string, number>();
  private lastPlayReset = 0;

  private musicGain: GainNode | null = null;
  private musicPlaying = false;
  private musicSchedulerId: ReturnType<typeof setInterval> | null = null;
  private currentChordIndex = 0;
  private nextBarTime = 0;
  private currentIntensity = 0;
  private targetIntensity = 0;
  private lastIntensityChange = 0;
  private intensityDebounceMs = 500;
  private raceProfile: RaceMusicProfile = RACE_MUSIC[Race.Crown];
  private musicMode: MusicMode = 'battle';

  private padGain: GainNode | null = null;
  private rhythmGain: GainNode | null = null;
  private arpGain: GainNode | null = null;
  private warningGain: GainNode | null = null;

  // Weather audio
  private weatherGain: GainNode | null = null;
  private weatherNoiseSource: AudioBufferSourceNode | null = null;
  private weatherNoiseFilter: BiquadFilterNode | null = null;
  private weatherRainSource: AudioBufferSourceNode | null = null;
  private weatherRainGain: GainNode | null = null;
  private weatherRainBuffer: AudioBuffer | null = null;
  private weatherRainLoad: Promise<AudioBuffer> | null = null;
  private weatherRainRequested = false;
  private weatherWindOsc: OscillatorNode | null = null;
  private weatherWindLfo: OscillatorNode | null = null;
  private weatherWindGain: GainNode | null = null;
  private weatherThunderArmed = true; // false while flash is active, prevents duplicate thunder
  private weatherLastType: string = '';
  private weatherLastWindStr = 0;
  private weatherNoiseBuffer: AudioBuffer | null = null;

  constructor() {
    this.settings = { musicVolume: 0.2, sfxVolume: 0.5 };
    this.settingsUnsub = subscribeToAudioSettings((settings) => {
      this.settings = settings;
      this.applyAudioSettings();
    });
  }

  dispose(): void {
    this.stopMusic();
    this.stopWeatherAudio();
    this.disableTabSuspend();
    this.settingsUnsub?.();
    this.settingsUnsub = null;
    if (this.actx) {
      this.actx.close().catch(() => {});
      this.actx = null;
      this.master = null;
    }
  }

  private ctx(): AudioContext {
    if (!this.actx) {
      this.actx = new AudioContext();
      // Master compressor prevents clipping when many sounds play in 4v4
      const comp = this.actx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 12;
      comp.ratio.value = 8;
      comp.attack.value = 0.005;
      comp.release.value = 0.15;
      comp.connect(this.actx.destination);
      this.master = this.actx.createGain();
      this.master.connect(comp);
      this.applyAudioSettings();
      // Ramp master gain from 0 over ~50ms to avoid the compressor
      // producing an audible thud/knock on the very first real sound.
      this.master.gain.setValueAtTime(0, this.actx.currentTime);
      this.master.gain.linearRampToValueAtTime(
        this._muted ? 0 : SFX_MASTER_GAIN * this.settings.sfxVolume,
        this.actx.currentTime + 0.05
      );
    }
    if (this.actx.state === 'suspended') void this.actx.resume();
    return this.actx;
  }

  private applyAudioSettings(): void {
    if (this.master) this.master.gain.value = this._muted ? 0 : SFX_MASTER_GAIN * this.settings.sfxVolume;
    if (this.musicGain) this.musicGain.gain.value = this._muted ? 0 : MUSIC_MASTER_GAIN * this.settings.musicVolume;
  }

  private dest(): GainNode {
    this.ctx();
    return this.master!;
  }

  private spatialGain(
    worldTileX: number | undefined,
    worldTileY: number | undefined,
    camera: Camera,
    canvas: HTMLCanvasElement,
  ): number {
    // Global events (no position) always play at full volume
    if (worldTileX === undefined || worldTileY === undefined) return 1;

    // Camera center in world-tile coordinates
    const camCX = (camera.x + (canvas.clientWidth || canvas.width) / (2 * camera.zoom)) / TILE_SIZE;
    const camCY = (camera.y + (canvas.clientHeight || canvas.height) / (2 * camera.zoom)) / TILE_SIZE;
    const dx = worldTileX - camCX;
    const dy = worldTileY - camCY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Visible radius in tiles — how much of the map the camera can see
    const visW = (canvas.clientWidth || canvas.width) / (camera.zoom * TILE_SIZE);
    const visH = (canvas.clientHeight || canvas.height) / (camera.zoom * TILE_SIZE);
    const visRadius = Math.sqrt(visW * visW + visH * visH) / 2;

    // Sounds within the viewport are full volume, then fade over another 50%
    const fadeStart = visRadius;
    const fadeEnd = visRadius * 1.5;

    if (dist <= fadeStart) return 1;
    if (dist >= fadeEnd) return 0;
    return 1 - (dist - fadeStart) / (fadeEnd - fadeStart);
  }

  /** Stereo pan value [-1, 1] based on horizontal position relative to camera */
  private spatialPan(
    worldTileX: number | undefined,
    camera: Camera,
    canvas: HTMLCanvasElement,
  ): number {
    if (worldTileX === undefined) return 0;
    const camCX = (camera.x + (canvas.clientWidth || canvas.width) / (2 * camera.zoom)) / TILE_SIZE;
    const visW = (canvas.clientWidth || canvas.width) / (camera.zoom * TILE_SIZE);
    const offset = (worldTileX - camCX) / (visW / 2);
    return Math.max(-0.7, Math.min(0.7, offset)); // cap at 0.7 to keep sounds from going full left/right
  }

  /** Create a gain node with optional stereo panning for spatial SFX */
  private spatialDest(pan: number): GainNode {
    const ac = this.ctx();
    const d = this.dest();
    if (Math.abs(pan) < 0.05) return d; // no panning needed
    const panner = ac.createStereoPanner();
    panner.pan.value = pan;
    const g = ac.createGain();
    g.gain.value = 1;
    g.connect(panner);
    panner.connect(d);
    return g;
  }

  /** Per-category cooldown — returns false if this sound type should be skipped.
   *  maxPerBatch limits how many can play per postTick batch (~50ms).
   *  minIntervalMs prevents rapid-fire across consecutive ticks. */
  private shouldPlay(category: string, minIntervalMs: number, maxPerBatch: number): boolean {
    const now = performance.now();
    // Reset batch counts when a new tick batch starts (>5ms gap between calls)
    if (now - this.lastPlayReset > 5) {
      this.playCounts.clear();
      this.lastPlayReset = now;
    }
    const count = this.playCounts.get(category) ?? 0;
    if (count >= maxPerBatch) return false;
    // minInterval only blocks if we're in a DIFFERENT batch (prevents cross-tick spam)
    if (count === 0) {
      const last = this.lastPlayTime.get(category) ?? 0;
      if (now - last < minIntervalMs) return false;
    }
    this.lastPlayTime.set(category, now);
    this.playCounts.set(category, count + 1);
    return true;
  }

  /** Pitch randomization — returns a multiplier near 1.0 */
  private pitchVar(range = 0.06): number {
    return 1 + (Math.random() - 0.5) * range * 2;
  }

  private note(freq: number, duration: number, gain: number, dest: GainNode, type: OscillatorType = 'square', startOffset = 0): void {
    const ac = this.ctx();
    const osc = ac.createOscillator();
    const g = ac.createGain();
    const t0 = ac.currentTime + startOffset;
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(g);
    g.connect(dest);
    osc.start(t0);
    osc.stop(t0 + duration + 0.01);
  }

  private sweep(
    freqFrom: number,
    freqTo: number,
    duration: number,
    gain: number,
    dest: GainNode,
    type: OscillatorType = 'square',
    startOffset = 0,
  ): void {
    const ac = this.ctx();
    const osc = ac.createOscillator();
    const g = ac.createGain();
    const t0 = ac.currentTime + startOffset;
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, t0);
    osc.frequency.exponentialRampToValueAtTime(freqTo, t0 + duration);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(g);
    g.connect(dest);
    osc.start(t0);
    osc.stop(t0 + duration + 0.01);
  }

  /** Bandpass-filtered noise for shaped impact/whoosh sounds */
  private filteredNoise(duration: number, gain: number, dest: GainNode, freq: number, q: number, startOffset = 0): void {
    const ac = this.ctx();
    const bufSize = Math.floor(ac.sampleRate * duration);
    let buf = this.noiseBufferCache.get(bufSize);
    if (!buf) {
      buf = ac.createBuffer(1, bufSize, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBufferCache.set(bufSize, buf);
    }
    const src = ac.createBufferSource();
    const filter = ac.createBiquadFilter();
    const g = ac.createGain();
    const t0 = ac.currentTime + startOffset;
    src.buffer = buf;
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(dest);
    src.start(t0);
    src.stop(t0 + duration + 0.01);
  }

  private padTone(
    freq: number,
    duration: number,
    gain: number,
    dest: GainNode,
    startTime: number,
    type: OscillatorType = 'sine',
  ): void {
    const ac = this.ctx();
    const osc = ac.createOscillator();
    const g = ac.createGain();
    const attack = Math.min(0.3, duration * 0.15);
    const release = Math.min(0.5, duration * 0.2);
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.001, startTime);
    g.gain.linearRampToValueAtTime(gain, startTime + attack);
    g.gain.setValueAtTime(gain, startTime + duration - release);
    g.gain.linearRampToValueAtTime(0.001, startTime + duration);
    osc.connect(g);
    g.connect(dest);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
  }

  private kick(startTime: number, gain: number, dest: GainNode): void {
    const ac = this.ctx();
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, startTime);
    osc.frequency.exponentialRampToValueAtTime(30, startTime + 0.08);
    g.gain.setValueAtTime(gain, startTime);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + 0.12);
    osc.connect(g);
    g.connect(dest);
    osc.start(startTime);
    osc.stop(startTime + 0.15);
    this.noiseAt(0.02, gain * 0.4, dest, startTime);
  }

  private tom(startTime: number, gain: number, dest: GainNode, pitch = 90): void {
    const ac = this.ctx();
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(pitch, startTime);
    osc.frequency.exponentialRampToValueAtTime(pitch * 0.4, startTime + 0.15);
    g.gain.setValueAtTime(gain, startTime);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + 0.2);
    osc.connect(g);
    g.connect(dest);
    osc.start(startTime);
    osc.stop(startTime + 0.25);
  }

  private noiseAt(duration: number, gain: number, dest: GainNode, startTime: number): void {
    const ac = this.ctx();
    const bufSize = Math.floor(ac.sampleRate * duration);
    let buf = this.noiseBufferCache.get(bufSize);
    if (!buf) {
      buf = ac.createBuffer(1, bufSize, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBufferCache.set(bufSize, buf);
    }
    const src = ac.createBufferSource();
    const g = ac.createGain();
    src.buffer = buf;
    g.gain.setValueAtTime(gain, startTime);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    src.connect(g);
    g.connect(dest);
    src.start(startTime);
    src.stop(startTime + duration + 0.01);
  }

  private ensureMusicGainNodes(): void {
    const ac = this.ctx();
    if (!this.musicGain) {
      this.musicGain = ac.createGain();
      this.musicGain.connect(ac.destination);

      this.padGain = ac.createGain();
      this.padGain.connect(this.musicGain);

      this.rhythmGain = ac.createGain();
      this.rhythmGain.connect(this.musicGain);

      this.arpGain = ac.createGain();
      this.arpGain.connect(this.musicGain);

      this.warningGain = ac.createGain();
      this.warningGain.connect(this.musicGain);
    }
    this.applyAudioSettings();
  }

  private effectiveIntensity(): number {
    return this.musicMode === 'battle' ? this.currentIntensity : 0;
  }

  private getBPM(): number {
    const p = this.raceProfile;
    switch (this.effectiveIntensity()) {
      case 2: return p.bpmCritical;
      case 1: return p.bpmAction;
      default: return p.bpmCalm;
    }
  }

  private getChords(): number[][] {
    const p = this.raceProfile;
    switch (this.effectiveIntensity()) {
      case 2: return p.chordsCritical;
      case 1: return p.chordsAction;
      default: return p.chordsCalm;
    }
  }

  private scheduleBar(): void {
    this.ctx();
    if (!this.musicPlaying) return;

    const profile = this.raceProfile;
    const intensity = this.effectiveIntensity();
    const bpm = this.getBPM();
    const beatDur = 60 / bpm;
    const barDur = beatDur * 4;
    const chords = this.getChords();
    const chord = chords[this.currentChordIndex % chords.length];
    const barStart = this.nextBarTime;
    const isMenu = this.musicMode === 'menu';
    const isRaceSelect = this.musicMode === 'raceSelect';

    const padVol = isMenu ? 0.17 : isRaceSelect ? 0.2 : intensity === 0 ? 0.24 : 0.18;
    for (const freq of chord) {
      this.padTone(freq, barDur, padVol, this.padGain!, barStart, profile.padType);
      this.padTone(freq * profile.padDetune, barDur, padVol * 0.4, this.padGain!, barStart, 'sine');
    }

    if (this.musicMode === 'battle' && intensity >= 1) {
      switch (profile.rhythmStyle) {
        case 'heavy':
          for (let beat = 0; beat < 4; beat++) {
            const t = barStart + beat * beatDur;
            this.kick(t, 0.42, this.rhythmGain!);
            this.kick(t + beatDur * 0.5, 0.18, this.rhythmGain!);
            this.noiseAt(0.04, 0.16, this.rhythmGain!, t + beatDur * 0.25);
          }
          if (intensity === 2) {
            for (let eighth = 0; eighth < 8; eighth++) {
              this.kick(barStart + eighth * beatDur * 0.5, 0.2, this.rhythmGain!);
            }
          }
          break;
        case 'tribal':
          for (let beat = 0; beat < 4; beat++) {
            const t = barStart + beat * beatDur;
            this.tom(t, 0.34, this.rhythmGain!, 100);
            if (beat === 1 || beat === 3) this.tom(t + beatDur * 0.33, 0.22, this.rhythmGain!, 130);
            if (beat === 2) this.tom(t + beatDur * 0.66, 0.18, this.rhythmGain!, 80);
            this.noiseAt(0.015, 0.08, this.rhythmGain!, t);
            this.noiseAt(0.015, 0.05, this.rhythmGain!, t + beatDur * 0.5);
          }
          break;
        case 'sparse':
          this.kick(barStart, 0.3, this.rhythmGain!);
          this.kick(barStart + beatDur * 2, 0.28, this.rhythmGain!);
          this.noiseAt(0.025, 0.12, this.rhythmGain!, barStart + beatDur);
          this.noiseAt(0.025, 0.12, this.rhythmGain!, barStart + beatDur * 3);
          break;
        case 'standard':
          for (let beat = 0; beat < 4; beat++) {
            const t = barStart + beat * beatDur;
            this.kick(t, 0.32, this.rhythmGain!);
            if (beat % 2 === 1 || intensity === 2) this.noiseAt(0.03, 0.12, this.rhythmGain!, t + beatDur * 0.5);
          }
          break;
        case 'none':
          if (intensity === 2) {
            for (let beat = 0; beat < 4; beat++) {
              this.noiseAt(0.04, 0.08, this.rhythmGain!, barStart + beat * beatDur);
            }
          }
          break;
      }
    }

    const shouldArp = isMenu || isRaceSelect || intensity >= 1;
    if (shouldArp) {
      const arpPattern = ARP_PATTERNS[this.currentChordIndex % ARP_PATTERNS.length];
      const arpOctave = intensity === 2 ? profile.arpOctaveCrit : profile.arpOctaveCalm;
      const subdivisions = isMenu ? 4 : isRaceSelect ? 4 : intensity === 2 ? 8 : 4;
      const subDur = barDur / subdivisions;
      const arpGain = isMenu ? 0.12 : isRaceSelect ? 0.16 : intensity === 2 ? 0.18 : 0.14;
      for (let i = 0; i < subdivisions; i++) {
        if (isMenu && i % 2 === 1) continue;
        const noteIndex = arpPattern[i % arpPattern.length];
        const freq = chord[Math.min(noteIndex, chord.length - 1)] * arpOctave;
        this.musicNote(freq, subDur * 0.65, arpGain, this.arpGain!, barStart + i * subDur, profile.arpType);
      }
    }

    if (this.musicMode === 'battle' && intensity === 2) {
      for (let beat = 0; beat < 4; beat++) {
        const t = barStart + beat * beatDur;
        const warnFreq = chord[chord.length - 1] * 4;
        this.musicNote(warnFreq, 0.05, 0.18, this.warningGain!, t, 'square');
        this.musicNote(warnFreq * 1.06, 0.05, 0.12, this.warningGain!, t + beatDur * 0.25, 'square');
      }
    }

    this.nextBarTime = barStart + barDur;
    this.currentChordIndex = (this.currentChordIndex + 1) % 4;
  }

  private musicNote(
    freq: number,
    duration: number,
    gain: number,
    dest: GainNode,
    startTime: number,
    type: OscillatorType = 'square',
  ): void {
    const ac = this.ctx();
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, startTime);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.connect(g);
    g.connect(dest);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
  }

  private updateLayerGains(): void {
    const ac = this.ctx();
    const now = ac.currentTime;
    const fadeTime = 0.8;
    const intensity = this.effectiveIntensity();

    const padTarget = this.musicMode === 'menu' ? 0.85 : this.musicMode === 'raceSelect' ? 0.9 : 1.0;
    const rhythmTarget = this.musicMode === 'battle' && intensity >= 1 ? (intensity === 2 ? 0.5 : 0.35) : 0;
    const arpTarget = this.musicMode === 'menu' ? 0.42 : this.musicMode === 'raceSelect' ? 0.5 : intensity >= 1 ? (intensity === 2 ? 0.45 : 0.34) : 0;
    const warningTarget = this.musicMode === 'battle' && intensity >= 2 ? 0.2 : 0;

    if (this.padGain) {
      this.padGain.gain.cancelScheduledValues(now);
      this.padGain.gain.setValueAtTime(this.padGain.gain.value, now);
      this.padGain.gain.linearRampToValueAtTime(padTarget, now + fadeTime);
    }
    if (this.rhythmGain) {
      this.rhythmGain.gain.cancelScheduledValues(now);
      this.rhythmGain.gain.setValueAtTime(this.rhythmGain.gain.value, now);
      this.rhythmGain.gain.linearRampToValueAtTime(rhythmTarget, now + fadeTime);
    }
    if (this.arpGain) {
      this.arpGain.gain.cancelScheduledValues(now);
      this.arpGain.gain.setValueAtTime(this.arpGain.gain.value, now);
      this.arpGain.gain.linearRampToValueAtTime(arpTarget, now + fadeTime);
    }
    if (this.warningGain) {
      this.warningGain.gain.cancelScheduledValues(now);
      this.warningGain.gain.setValueAtTime(this.warningGain.gain.value, now);
      this.warningGain.gain.linearRampToValueAtTime(warningTarget, now + fadeTime);
    }
  }

  private beginMusic(mode: MusicMode, profile: RaceMusicProfile): void {
    if (this.musicPlaying && this.musicMode === mode) {
      this.raceProfile = profile;
      this.updateLayerGains();
      return;
    }
    this.stopMusic();

    const ac = this.ctx();
    this.ensureMusicGainNodes();
    this.musicMode = mode;
    this.raceProfile = profile;
    this.musicPlaying = true;
    this.currentChordIndex = 0;
    this.currentIntensity = 0;
    this.targetIntensity = 0;
    this.nextBarTime = ac.currentTime + 0.1;
    this.musicGain!.gain.cancelScheduledValues(ac.currentTime);
    this.musicGain!.gain.setValueAtTime(MUSIC_MASTER_GAIN * this.settings.musicVolume, ac.currentTime);

    this.updateLayerGains();
    this.scheduleBar();
    this.scheduleBar();

    this.musicSchedulerId = setInterval(() => {
      if (!this.musicPlaying) return;
      const audio = this.ctx();
      const barDur = (60 / this.getBPM()) * 4;
      while (this.nextBarTime < audio.currentTime + barDur * 2) {
        this.scheduleBar();
      }

      if (this.musicMode === 'battle' && this.targetIntensity !== this.currentIntensity) {
        const now = Date.now();
        if (now - this.lastIntensityChange >= this.intensityDebounceMs) {
          this.currentIntensity = this.targetIntensity;
          this.lastIntensityChange = now;
          this.updateLayerGains();
        }
      }
    }, 200);
  }

  // ═══════════════════════════════════════════════
  // SFX Generators — all use pitch randomization
  // ═══════════════════════════════════════════════

  private playBuildingPlaced(v: number, d: GainNode): void {
    const p = this.pitchVar(0.04);
    this.note(330 * p, 0.06, v * 0.35, d, 'square', 0);
    this.note(494 * p, 0.06, v * 0.35, d, 'square', 0.065);
    this.note(659 * p, 0.10, v * 0.4, d, 'square', 0.13);
  }

  private playBuildingDestroyed(v: number, d: GainNode): void {
    const p = this.pitchVar(0.08);
    this.sweep(380 * p, 50, 0.25, v * 0.35, d, 'sawtooth');
    this.filteredNoise(0.2, v * 0.25, d, 600, 1.5);
  }

  private playMeleeHit(v: number, d: GainNode): void {
    const p = this.pitchVar(0.12);
    // Percussive thwack: filtered noise burst + low body thud
    this.filteredNoise(0.05, v * 0.55, d, 1200 * p, 2);
    this.sweep(110 * p, 55, 0.06, v * 0.35, d, 'triangle');
  }

  private playRangedHit(v: number, d: GainNode): void {
    const p = this.pitchVar(0.15);
    // Pluck — high tick + filtered noise
    this.note(700 * p, 0.03, v * 0.35, d, 'square');
    this.filteredNoise(0.04, v * 0.25, d, 2000 * p, 3);
  }

  private playUnitKilled(v: number, d: GainNode): void {
    const p = this.pitchVar(0.1);
    this.sweep(260 * p, 70, 0.12, v * 0.45, d, 'square');
    this.filteredNoise(0.08, v * 0.3, d, 400, 1);
  }

  private playUnitSpawn(v: number, d: GainNode): void {
    const p = this.pitchVar(0.08);
    // Soft ascending blip — subtle "ready" feedback
    this.note(440 * p, 0.05, v * 0.25, d, 'triangle');
    this.note(660 * p, 0.07, v * 0.3, d, 'triangle', 0.04);
  }

  private playTowerFire(v: number, d: GainNode): void {
    const p = this.pitchVar(0.12);
    // Short zap — brief high-freq burst
    this.sweep(900 * p, 400 * p, 0.06, v * 0.3, d, 'sawtooth');
    this.filteredNoise(0.04, v * 0.2, d, 3000, 4);
  }

  private playUpgradeComplete(v: number, d: GainNode): void {
    const p = this.pitchVar(0.04);
    // Bright chime — 2-note ascending with shimmer
    this.note(523 * p, 0.1, v * 0.3, d, 'triangle');
    this.note(784 * p, 0.15, v * 0.35, d, 'triangle', 0.08);
    this.note(1568 * p, 0.1, v * 0.12, d, 'sine', 0.1); // shimmer overtone
  }

  private playAbilityLeap(v: number, d: GainNode): void {
    const p = this.pitchVar(0.06);
    // Whoosh + impact thud
    this.sweep(200 * p, 600 * p, 0.08, v * 0.35, d, 'triangle');
    this.filteredNoise(0.06, v * 0.25, d, 800, 2);
    this.sweep(120 * p, 40, 0.06, v * 0.2, d, 'sine', 0.07);
  }

  private playAbilityCleave(v: number, d: GainNode): void {
    const p = this.pitchVar(0.08);
    // Wide metallic slash
    this.sweep(500 * p, 150, 0.07, v * 0.3, d, 'sawtooth');
    this.filteredNoise(0.05, v * 0.2, d, 1500, 2.5);
  }

  private playAbilityFireball(v: number, d: GainNode): void {
    // Deep boom + crackling fire burst
    this.note(60, 0.4, v * 0.4, d, 'sine');
    this.sweep(300, 800, 0.12, v * 0.35, d, 'sawtooth');
    this.filteredNoise(0.3, v * 0.3, d, 2500, 2);
    this.sweep(150, 30, 0.4, v * 0.2, d, 'triangle', 0.05);
  }

  private playAbilityDeluge(v: number, d: GainNode): void {
    // Deluge uses the shared storm/rain loop instead of a separate one-shot.
    // Intentionally silent here to avoid layering a fake rain sound on top.
    void v;
    void d;
  }

  private playAbilityFrenzy(v: number, d: GainNode): void {
    // War horn + rising energy
    this.sweep(200, 500, 0.2, v * 0.3, d, 'sawtooth');
    this.note(300, 0.15, v * 0.25, d, 'triangle');
    this.note(450, 0.1, v * 0.2, d, 'triangle', 0.08);
  }

  private playAbilitySummon(v: number, d: GainNode): void {
    // Eerie ghostly rise
    this.sweep(150, 400, 0.3, v * 0.25, d, 'sine');
    this.sweep(200, 600, 0.25, v * 0.2, d, 'triangle', 0.05);
    this.filteredNoise(0.2, v * 0.15, d, 800, 3);
  }

  private playAbilityTroll(v: number, d: GainNode): void {
    // Heavy footstep + roar
    this.note(50, 0.3, v * 0.4, d, 'sine');
    this.sweep(100, 250, 0.15, v * 0.3, d, 'sawtooth', 0.05);
    this.filteredNoise(0.2, v * 0.25, d, 600, 1.5);
  }

  private playAbilityPotion(v: number, d: GainNode): void {
    // Bubbly pop + sparkle
    this.note(800, 0.06, v * 0.25, d, 'sine');
    this.note(1200, 0.04, v * 0.2, d, 'sine', 0.04);
    this.note(600, 0.05, v * 0.15, d, 'triangle', 0.06);
  }

  private playNukeIncoming(v: number, d: GainNode): void {
    // Short low warning pulse — readable without sounding like a siren.
    const ac = this.ctx();
    const t0 = ac.currentTime;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, t0);
    osc.frequency.linearRampToValueAtTime(300, t0 + 0.28);
    g.gain.setValueAtTime(0.001, t0);
    g.gain.linearRampToValueAtTime(v * 0.16, t0 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.32);
    osc.connect(g);
    g.connect(d);
    osc.start(t0);
    osc.stop(t0 + 0.34);

    // Small filtered-noise tail so it reads as "warning" not "tone".
    this.filteredNoise(0.07, v * 0.06, d, 700, 1.2, 0.06);
  }

  private playNukeDetonated(v: number, d: GainNode): void {
    // Deep rumble + filtered noise burst — feels massive but not harsh
    this.note(50, 0.6, v * 0.4, d, 'sine');
    this.note(35, 0.5, v * 0.3, d, 'sine', 0.03);
    this.filteredNoise(0.5, v * 0.35, d, 200, 0.8);
    this.sweep(250, 25, 0.5, v * 0.25, d, 'triangle');
  }

  private playDiamondExposed(v: number, d: GainNode): void {
    const p = this.pitchVar(0.03);
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => {
      this.note(f * p, 0.15, v * 0.35, d, 'triangle', i * 0.12);
      this.note(f * p * 2, 0.08, v * 0.1, d, 'sine', i * 0.12 + 0.02); // octave shimmer
    });
  }

  private playDiamondCarried(v: number, d: GainNode): void {
    const p = this.pitchVar(0.04);
    this.note(1047 * p, 0.07, v * 0.3, d, 'triangle', 0);
    this.note(1319 * p, 0.10, v * 0.35, d, 'triangle', 0.07);
  }

  private playHqDamaged(v: number, d: GainNode): void {
    const p = this.pitchVar(0.06);
    // Low warning pulse — urgent but not piercing
    this.sweep(140 * p, 50, 0.2, v * 0.35, d, 'triangle');
    this.filteredNoise(0.15, v * 0.15, d, 300, 1.2);
  }

  private playMatchStart(v: number, d: GainNode): void {
    const notes = [262, 330, 392, 523];
    notes.forEach((f, i) => this.note(f, 0.12, v * 0.4, d, 'triangle', i * 0.11));
  }

  private playMatchEndWin(v: number, d: GainNode): void {
    const notes = [523, 659, 784, 1047, 1047];
    notes.forEach((f, i) => {
      const dur = i === notes.length - 1 ? 0.4 : 0.13;
      this.note(f, dur, v * 0.4, d, 'triangle', i * 0.14);
    });
  }

  private playMatchEndLose(v: number, d: GainNode): void {
    const notes = [392, 330, 262, 220];
    notes.forEach((f, i) => this.note(f, 0.18, v * 0.35, d, 'triangle', i * 0.16));
  }

  // ─── Race-Contextual Building Placement ────────────────────────

  /** Race-aware pitch/timbre shift for building_placed */
  private raceFreqShift(race?: Race): { base: number; type: OscillatorType; noiseFreq: number } {
    switch (race) {
      case Race.Deep:    return { base: 0.7,  type: 'sine',     noiseFreq: 400 };   // deep, watery
      case Race.Demon:   return { base: 1.2,  type: 'sawtooth', noiseFreq: 1800 };  // harsh, fiery
      case Race.Goblins: return { base: 1.35, type: 'square',   noiseFreq: 2200 };  // tinny, quick
      case Race.Oozlings:return { base: 0.8,  type: 'sine',     noiseFreq: 500 };   // bubbly, wet
      case Race.Wild:    return { base: 0.9,  type: 'triangle', noiseFreq: 800 };   // woody, natural
      case Race.Geists:  return { base: 1.1,  type: 'sine',     noiseFreq: 1600 };  // ethereal
      case Race.Tenders: return { base: 0.85, type: 'triangle', noiseFreq: 700 };   // organic, gentle
      case Race.Horde:   return { base: 0.75, type: 'sawtooth', noiseFreq: 600 };   // heavy, drum-like
      case Race.Crown:   // fallthrough
      default:           return { base: 1.0,  type: 'triangle', noiseFreq: 1000 };  // balanced, noble
    }
  }

  private playBuildingPlacedRace(v: number, d: GainNode, race?: Race, buildingType?: BuildingType): void {
    const p = this.pitchVar(0.05);
    const r = this.raceFreqShift(race);
    // Building type pitch offset: towers=low, huts=gentle, spawners=mid
    const typeShift = buildingType === BuildingType.Tower ? 0.85 :
                      buildingType === BuildingType.HarvesterHut ? 1.1 : 1.0;
    const base = r.base * typeShift;
    // Ascending 3-note chime with race timbre
    this.note(330 * base * p, 0.06, v * 0.3, d, r.type);
    this.note(440 * base * p, 0.07, v * 0.35, d, r.type, 0.05);
    this.note(550 * base * p, 0.09, v * 0.3, d, r.type, 0.1);
    this.filteredNoise(0.04, v * 0.12, d, r.noiseFreq, 2, 0.08);
  }

  private playUpgradeCompleteRace(v: number, d: GainNode, race?: Race, buildingType?: BuildingType): void {
    const p = this.pitchVar(0.04);
    const r = this.raceFreqShift(race);
    // Building category shifts the timbre slightly
    const catShift = buildingType === BuildingType.CasterSpawner ? 1.15 :
                     buildingType === BuildingType.RangedSpawner ? 1.05 : 1.0;
    const base = r.base * catShift;
    // Bright 2-note ascending chime with shimmer
    this.note(523 * base * p, 0.1, v * 0.3, d, r.type);
    this.note(784 * base * p, 0.15, v * 0.35, d, r.type, 0.08);
    this.note(1568 * base * p, 0.1, v * 0.12, d, 'sine', 0.1); // shimmer overtone
  }

  // ─── Status Effect Sounds ──────────────────────────────────────

  private playStatusBurn(v: number, d: GainNode): void {
    const p = this.pitchVar(0.1);
    // Soft crackle — filtered noise with high freq + brief warm sweep
    this.filteredNoise(0.06, v * 0.15, d, 2500 * p, 3);
    this.sweep(200 * p, 400 * p, 0.04, v * 0.1, d, 'sawtooth');
  }

  private playStatusShield(v: number, d: GainNode): void {
    const p = this.pitchVar(0.06);
    // Gentle shimmer — ascending sine + soft overtone
    this.note(800 * p, 0.08, v * 0.15, d, 'sine');
    this.note(1200 * p, 0.06, v * 0.1, d, 'sine', 0.03);
    this.note(1600 * p, 0.04, v * 0.06, d, 'sine', 0.05);
  }

  private playStatusHaste(v: number, d: GainNode): void {
    const p = this.pitchVar(0.08);
    // Quick ascending whoosh
    this.sweep(300 * p, 800 * p, 0.06, v * 0.12, d, 'triangle');
  }

  private playStatusSlow(v: number, d: GainNode): void {
    const p = this.pitchVar(0.1);
    // Low descending tone — brief heaviness
    this.sweep(250 * p, 120, 0.07, v * 0.12, d, 'triangle');
  }

  private playStatusFrenzy(v: number, d: GainNode): void {
    const p = this.pitchVar(0.08);
    // Quick growl — short sawtooth burst
    this.sweep(150 * p, 300 * p, 0.06, v * 0.15, d, 'sawtooth');
    this.filteredNoise(0.03, v * 0.08, d, 800, 2, 0.02);
  }

  private playStatusWound(v: number, d: GainNode): void {
    const p = this.pitchVar(0.1);
    // Dull thud + brief low buzz — suppressive feel
    this.sweep(180 * p, 90, 0.05, v * 0.12, d, 'sawtooth');
    this.filteredNoise(0.03, v * 0.06, d, 400, 1.5);
  }

  private playStatusVulnerable(v: number, d: GainNode): void {
    const p = this.pitchVar(0.1);
    // Brief cracking/fracture — armor breaking feel
    this.filteredNoise(0.04, v * 0.12, d, 1800 * p, 3);
    this.note(500 * p, 0.03, v * 0.08, d, 'square');
  }

  // ─── Race-Aware Combat Hits ────────────────────────────────────

  private playMeleeHitRace(v: number, d: GainNode, race?: Race): void {
    const p = this.pitchVar(0.12);
    const r = this.raceFreqShift(race);
    // Percussive thwack shaped by race: noise freq + body thud pitch
    this.filteredNoise(0.05, v * 0.55, d, r.noiseFreq * p, 2);
    this.sweep(110 * r.base * p, 55 * r.base, 0.06, v * 0.35, d, r.type);
  }

  private playRangedHitRace(v: number, d: GainNode, race?: Race): void {
    const p = this.pitchVar(0.15);
    const r = this.raceFreqShift(race);
    // Impact pluck shaped by race timbre
    this.note(700 * r.base * p, 0.03, v * 0.35, d, r.type);
    this.filteredNoise(0.04, v * 0.25, d, r.noiseFreq * p, 3);
  }

  // ─── Combat Event Sounds ───────────────────────────────────────

  private playKnockback(v: number, d: GainNode): void {
    const p = this.pitchVar(0.1);
    // Punchy whoosh + low thud — impact pushback feel
    this.sweep(300 * p, 100, 0.06, v * 0.2, d, 'triangle');
    this.filteredNoise(0.04, v * 0.15, d, 600, 1.5);
  }

  private playLifesteal(v: number, d: GainNode): void {
    const p = this.pitchVar(0.08);
    // Quick ethereal drain — ascending sine with soft noise
    this.sweep(200 * p, 500 * p, 0.06, v * 0.12, d, 'sine');
    this.note(600 * p, 0.04, v * 0.06, d, 'sine', 0.03);
  }

  // ─── Resource Delivery ─────────────────────────────────────────

  private playResourceDelivered(v: number, d: GainNode, race?: Race): void {
    const p = this.pitchVar(0.08);
    // Quiet, satisfying little "clink" — barely noticeable but adds texture
    const r = this.raceFreqShift(race);
    const base = r.base;
    this.note(1100 * base * p, 0.03, v * 0.1, d, 'triangle');
    this.note(1400 * base * p, 0.025, v * 0.08, d, 'sine', 0.025);
  }

  // ─── UI Sounds (non-spatial, direct to master) ─────────────────

  /** Soft click for general button presses */
  playUIClick(): void {
    const d = this.dest();
    const v = 0.25 * this.settings.sfxVolume;
    const p = this.pitchVar(0.06);
    this.note(900 * p, 0.02, v, d, 'triangle');
  }

  /** Gentle open — popup/panel appearance */
  playUIOpen(): void {
    const d = this.dest();
    const v = 0.2 * this.settings.sfxVolume;
    const p = this.pitchVar(0.04);
    this.note(500 * p, 0.04, v, d, 'sine');
    this.note(700 * p, 0.05, v * 0.8, d, 'sine', 0.03);
  }

  /** Gentle close — popup dismiss */
  playUIClose(): void {
    const d = this.dest();
    const v = 0.18 * this.settings.sfxVolume;
    const p = this.pitchVar(0.04);
    this.note(600 * p, 0.04, v, d, 'sine');
    this.note(450 * p, 0.05, v * 0.7, d, 'sine', 0.03);
  }

  /** Tab switch — light tick */
  playUITab(): void {
    const d = this.dest();
    const v = 0.2 * this.settings.sfxVolume;
    const p = this.pitchVar(0.08);
    this.note(1000 * p, 0.015, v, d, 'triangle');
  }

  /** Confirm action — build, upgrade, start */
  playUIConfirm(): void {
    const d = this.dest();
    const v = 0.25 * this.settings.sfxVolume;
    const p = this.pitchVar(0.04);
    this.note(600 * p, 0.04, v, d, 'triangle');
    this.note(800 * p, 0.06, v * 0.9, d, 'triangle', 0.03);
  }

  /** Back/cancel — descending */
  playUIBack(): void {
    const d = this.dest();
    const v = 0.18 * this.settings.sfxVolume;
    const p = this.pitchVar(0.04);
    this.note(700 * p, 0.04, v, d, 'sine');
    this.note(500 * p, 0.05, v * 0.7, d, 'sine', 0.03);
  }

  /** Toggle on/off — quick blip */
  playUIToggle(): void {
    const d = this.dest();
    const v = 0.18 * this.settings.sfxVolume;
    this.note(850, 0.02, v, d, 'triangle');
  }

  /** Subtle slider tick with built-in throttling for drag feedback */
  playUISlider(): void {
    if (!this.shouldPlay('ui_slider', 90, 1)) return;
    const d = this.dest();
    const v = 0.12 * this.settings.sfxVolume;
    const p = this.pitchVar(0.03);
    this.note(720 * p, 0.015, v, d, 'sine');
  }

  // ─── Mute toggle ───────────────────────────────────────────────

  private _muted = false;

  get muted(): boolean { return this._muted; }

  toggleMute(): boolean {
    this._muted = !this._muted;
    this.applyAudioSettings();
    return this._muted;
  }

  // ─── Tab visibility handling ───────────────────────────────────

  private _visibilityHandler: (() => void) | null = null;

  /** Call once after construction to enable tab-suspend behavior */
  enableTabSuspend(): void {
    if (this._visibilityHandler) return;
    this._visibilityHandler = () => {
      if (!this.actx) return;
      if (document.hidden) {
        void this.actx.suspend();
      } else {
        void this.actx.resume();
      }
    };
    document.addEventListener('visibilitychange', this._visibilityHandler);
  }

  disableTabSuspend(): void {
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }
  }

  play(event: SoundEvent, camera: Camera, canvas: HTMLCanvasElement): void {
    const v = this.spatialGain(event.x, event.y, camera, canvas);
    if (v < 0.01) return;

    const pan = this.spatialPan(event.x, camera, canvas);
    const t = event.type;

    // Per-category cooldowns: (minIntervalMs, maxPerFrame)
    // Frequent combat sounds get strict limits; rare/important sounds always play
    switch (t) {
      case 'melee_hit':
        if (!this.shouldPlay('melee', 30, 3)) return;
        if (event.race) this.playMeleeHitRace(v, this.spatialDest(pan), event.race);
        else this.playMeleeHit(v, this.spatialDest(pan));
        break;
      case 'ranged_hit':
        if (!this.shouldPlay('ranged', 40, 2)) return;
        if (event.race) this.playRangedHitRace(v, this.spatialDest(pan), event.race);
        else this.playRangedHit(v, this.spatialDest(pan));
        break;
      case 'unit_killed':
        if (!this.shouldPlay('killed', 40, 3)) return;
        this.playUnitKilled(v, this.spatialDest(pan)); break;
      case 'unit_spawn':
        if (!this.shouldPlay('spawn', 80, 2)) return;
        this.playUnitSpawn(v, this.spatialDest(pan)); break;
      case 'tower_fire':
        if (!this.shouldPlay('tower', 60, 2)) return;
        this.playTowerFire(v, this.spatialDest(pan)); break;
      case 'ability_leap':
        if (!this.shouldPlay('leap', 100, 2)) return;
        this.playAbilityLeap(v, this.spatialDest(pan)); break;
      case 'ability_cleave':
        if (!this.shouldPlay('cleave', 80, 2)) return;
        this.playAbilityCleave(v, this.spatialDest(pan)); break;
      case 'ability_fireball': this.playAbilityFireball(v, this.spatialDest(pan)); break;
      case 'ability_deluge':
        if (!this.shouldPlay('deluge', 200, 1)) return;
        this.playAbilityDeluge(v, this.spatialDest(pan)); break;
      case 'ability_frenzy': this.playAbilityFrenzy(v, this.spatialDest(pan)); break;
      case 'ability_summon': this.playAbilitySummon(v, this.spatialDest(pan)); break;
      case 'ability_troll': this.playAbilityTroll(v, this.spatialDest(pan)); break;
      case 'ability_potion': this.playAbilityPotion(v, this.spatialDest(pan)); break;
      // Below: less frequent sounds — always play, still get panning
      case 'building_placed':
        if (event.race) this.playBuildingPlacedRace(v, this.spatialDest(pan), event.race, event.buildingType);
        else this.playBuildingPlaced(v, this.spatialDest(pan));
        break;
      case 'building_destroyed': this.playBuildingDestroyed(v, this.spatialDest(pan)); break;
      case 'upgrade_complete':
        if (event.race) this.playUpgradeCompleteRace(v, this.spatialDest(pan), event.race, event.buildingType);
        else this.playUpgradeComplete(v, this.spatialDest(pan));
        break;
      case 'nuke_incoming': this.playNukeIncoming(v, this.spatialDest(pan)); break;
      case 'nuke_detonated': this.playNukeDetonated(v, this.spatialDest(pan)); break;
      case 'diamond_exposed': this.playDiamondExposed(v, this.spatialDest(pan)); break;
      case 'diamond_carried': this.playDiamondCarried(v, this.spatialDest(pan)); break;
      case 'hq_damaged': this.playHqDamaged(v, this.spatialDest(pan)); break;
      // Status effect sounds — already throttled in simulation, light cooldown here
      case 'status_burn':
        if (!this.shouldPlay('status_burn', 800, 1)) return;
        this.playStatusBurn(v, this.spatialDest(pan)); break;
      case 'status_shield':
        if (!this.shouldPlay('status_shield', 1000, 1)) return;
        this.playStatusShield(v, this.spatialDest(pan)); break;
      case 'status_haste':
        if (!this.shouldPlay('status_haste', 1500, 1)) return;
        this.playStatusHaste(v, this.spatialDest(pan)); break;
      case 'status_slow':
        if (!this.shouldPlay('status_slow', 800, 1)) return;
        this.playStatusSlow(v, this.spatialDest(pan)); break;
      case 'status_frenzy':
        if (!this.shouldPlay('status_frenzy', 1500, 1)) return;
        this.playStatusFrenzy(v, this.spatialDest(pan)); break;
      case 'status_wound':
        if (!this.shouldPlay('status_wound', 1000, 1)) return;
        this.playStatusWound(v, this.spatialDest(pan)); break;
      case 'status_vulnerable':
        if (!this.shouldPlay('status_vulnerable', 1000, 1)) return;
        this.playStatusVulnerable(v, this.spatialDest(pan)); break;
      // Combat events — knockback and lifesteal
      case 'combat_knockback':
        if (!this.shouldPlay('knockback', 200, 1)) return;
        this.playKnockback(v, this.spatialDest(pan)); break;
      case 'combat_lifesteal':
        if (!this.shouldPlay('lifesteal', 300, 1)) return;
        this.playLifesteal(v, this.spatialDest(pan)); break;
      // Resource delivery — very subtle
      case 'resource_delivered':
        if (!this.shouldPlay('resource', 300, 1)) return;
        this.playResourceDelivered(v, this.spatialDest(pan), event.race); break;
      // Global sounds — no panning
      case 'match_start': this.playMatchStart(v, this.dest()); break;
      case 'match_end_win': this.playMatchEndWin(v, this.dest()); break;
      case 'match_end_lose': this.playMatchEndLose(v, this.dest()); break;
    }
  }

  startMenuMusic(): void {
    this.beginMusic('menu', cloneProfile(MENU_PROFILE));
  }

  startRaceSelectMusic(race: Race): void {
    this.beginMusic('raceSelect', createRaceSelectProfile(race));
  }

  previewRaceSelection(race: Race): void {
    this.raceProfile = createRaceSelectProfile(race);
    if (!this.musicPlaying) this.startRaceSelectMusic(race);
  }

  startMusic(race: Race = Race.Crown): void {
    this.beginMusic('battle', cloneProfile(RACE_MUSIC[race] ?? RACE_MUSIC[Race.Crown]));
  }

  stopMusic(): void {
    this.musicPlaying = false;
    if (this.musicSchedulerId !== null) {
      clearInterval(this.musicSchedulerId);
      this.musicSchedulerId = null;
    }
    if (this.musicGain && this.actx) {
      const now = this.actx.currentTime;
      this.musicGain.gain.cancelScheduledValues(now);
      this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, now);
      this.musicGain.gain.linearRampToValueAtTime(0.001, now + 0.35);
    }
  }

  setIntensity(level: number): void {
    if (this.musicMode !== 'battle') return;
    this.targetIntensity = Math.max(0, Math.min(2, Math.floor(level)));
  }

  // ─── Weather Audio ─────────────────────────────────────────────

  /** Update weather ambient audio — call each frame with current weather type.
   *  Smoothly crossfades between weather states. */
  updateWeatherAudio(weatherType: WeatherType, lightningFlash: number, windStrength: number): void {
    if (!this.actx) return;

    const ac = this.actx;
    const now = ac.currentTime;

    // Create weather gain chain if needed
    if (!this.weatherGain) {
      this.weatherGain = ac.createGain();
      this.weatherGain.gain.value = 0;
      this.weatherGain.connect(this.master!);
    }

    const isRain = weatherType === 'rain' || weatherType === 'storm';
    const isSnow = weatherType === 'snow' || weatherType === 'blizzard';
    const isSand = weatherType === 'sandstorm';
    const isWindy = weatherType === 'storm' || weatherType === 'blizzard' || isSand;

    const needsNoise = isSnow || isSand;
    const needsWind = isWindy || weatherType === 'overcast';

    if (isRain) {
      this.startWeatherRain(ac);
    } else {
      this.stopWeatherRain(now);
    }

    // Start/stop noise source
    if (needsNoise && !this.weatherNoiseSource) {
      this.startWeatherNoise(ac, isRain, isSand);
    } else if (!needsNoise && this.weatherNoiseSource) {
      this.stopWeatherNoise(now);
    }

    // Start/stop wind
    if (needsWind && !this.weatherWindOsc) {
      this.startWeatherWind(ac);
    } else if (!needsWind && this.weatherWindOsc) {
      this.stopWeatherWind(now);
    }

    // Only reschedule audio ramps when weather type or wind changes significantly
    const windChanged = Math.abs(windStrength - this.weatherLastWindStr) > 2;
    const typeChanged = weatherType !== this.weatherLastType;

    if (typeChanged) {
      const sfxVol = this.settings.sfxVolume;
      let targetNoiseGain = 0;
      let targetRainGain = 0;
      if (weatherType === 'rain') targetRainGain = 0.08 * sfxVol;
      else if (weatherType === 'storm') targetRainGain = 0.14 * sfxVol;
      else if (weatherType === 'snow') targetNoiseGain = 0.02 * sfxVol;
      else if (weatherType === 'blizzard') targetNoiseGain = 0.08 * sfxVol;
      else if (weatherType === 'sandstorm') targetNoiseGain = 0.07 * sfxVol;

      if (this.weatherGain) {
        this.weatherGain.gain.cancelScheduledValues(now);
        this.weatherGain.gain.setValueAtTime(this.weatherGain.gain.value, now);
        this.weatherGain.gain.linearRampToValueAtTime(targetNoiseGain, now + 3);
      }
      if (this.weatherRainGain) {
        this.weatherRainGain.gain.cancelScheduledValues(now);
        this.weatherRainGain.gain.setValueAtTime(this.weatherRainGain.gain.value, now);
        this.weatherRainGain.gain.linearRampToValueAtTime(targetRainGain, now + 3);
      }
      this.weatherLastType = weatherType;
    }

    if (windChanged && this.weatherWindOsc && this.weatherWindGain) {
      const sfxVol = this.settings.sfxVolume;
      const windVol = Math.min(0.04, Math.abs(windStrength) * 0.0005) * sfxVol;
      this.weatherWindGain.gain.cancelScheduledValues(now);
      this.weatherWindGain.gain.setValueAtTime(this.weatherWindGain.gain.value, now);
      this.weatherWindGain.gain.linearRampToValueAtTime(windVol, now + 0.5);
      const baseFreq = isSand ? 120 : 80;
      this.weatherWindOsc.frequency.setValueAtTime(baseFreq + Math.abs(windStrength) * 0.5, now);
      this.weatherLastWindStr = windStrength;
    }

    // Lightning thunder — arm on flash start, fire once
    if (lightningFlash > 0.7 && this.weatherThunderArmed) {
      this.playThunder(this.settings.sfxVolume);
      this.weatherThunderArmed = false;
    }
    if (lightningFlash < 0.1) {
      this.weatherThunderArmed = true;
    }
  }

  private async loadWeatherRainBuffer(ac: AudioContext): Promise<AudioBuffer> {
    if (this.weatherRainBuffer) return this.weatherRainBuffer;
    if (!this.weatherRainLoad) {
      this.weatherRainLoad = fetch(rainLoopUrl)
        .then((response) => response.arrayBuffer())
        .then((arrayBuffer) => ac.decodeAudioData(arrayBuffer.slice(0)))
        .then((buffer) => {
          this.weatherRainBuffer = buffer;
          return buffer;
        })
        .finally(() => {
          this.weatherRainLoad = null;
        });
    }
    return this.weatherRainLoad;
  }

  private startWeatherRain(ac: AudioContext): void {
    this.weatherRainRequested = true;
    if (!this.weatherRainGain) {
      this.weatherRainGain = ac.createGain();
      this.weatherRainGain.gain.value = 0;
      this.weatherRainGain.connect(this.master!);
    }
    if (this.weatherRainSource) return;

    void this.loadWeatherRainBuffer(ac).then((buffer) => {
      if (!this.weatherRainRequested || this.weatherRainSource || ac !== this.actx) return;
      const src = ac.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.connect(this.weatherRainGain!);
      src.onended = () => {
        if (this.weatherRainSource === src) {
          this.weatherRainSource = null;
        }
        try { src.disconnect(); } catch {}
      };
      src.start();
      this.weatherRainSource = src;
    }).catch(() => {});
  }

  private stopWeatherRain(now: number): void {
    this.weatherRainRequested = false;
    if (this.weatherRainGain && this.actx) {
      this.weatherRainGain.gain.cancelScheduledValues(now);
      this.weatherRainGain.gain.setValueAtTime(this.weatherRainGain.gain.value, now);
      this.weatherRainGain.gain.linearRampToValueAtTime(0, now + 2);
    }
    if (this.weatherRainSource) {
      const src = this.weatherRainSource;
      this.weatherRainSource = null;
      try { src.stop(now + 2.1); } catch {}
    }
  }

  private startWeatherNoise(ac: AudioContext, isRain: boolean, isSand: boolean): void {
    // Create a 2-second looping noise buffer
    const bufLen = ac.sampleRate * 2;
    if (!this.weatherNoiseBuffer) {
      this.weatherNoiseBuffer = ac.createBuffer(1, bufLen, ac.sampleRate);
      const data = this.weatherNoiseBuffer.getChannelData(0);
      for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    }

    const src = ac.createBufferSource();
    src.buffer = this.weatherNoiseBuffer;
    src.loop = true;

    // Shape the noise: bandpass for rain, lowpass for sand, highpass for snow
    const filter = ac.createBiquadFilter();
    if (isRain) {
      filter.type = 'bandpass';
      filter.frequency.value = 1800;
      filter.Q.value = 0.2;
    } else if (isSand) {
      filter.type = 'lowpass';
      filter.frequency.value = 800;
      filter.Q.value = 0.3;
    } else {
      // Snow/blizzard: high-pass whisper
      filter.type = 'highpass';
      filter.frequency.value = 4000;
      filter.Q.value = 0.3;
    }

    src.connect(filter);
    filter.connect(this.weatherGain!);
    src.start();
    this.weatherNoiseSource = src;
    this.weatherNoiseFilter = filter;
  }

  private stopWeatherNoise(now: number): void {
    if (this.weatherNoiseSource) {
      try { this.weatherNoiseSource.stop(now + 3); } catch { /* already stopped */ }
      this.weatherNoiseSource.disconnect();
      this.weatherNoiseSource = null;
    }
    if (this.weatherNoiseFilter) {
      this.weatherNoiseFilter.disconnect();
      this.weatherNoiseFilter = null;
    }
  }

  private startWeatherWind(ac: AudioContext): void {
    // Low-frequency rumble for wind — avoid pitched whine.
    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 36;

    // LFO for wind modulation
    const lfo = ac.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.08; // extremely slow modulation
    const lfoGain = ac.createGain();
    lfoGain.gain.value = 5; // tiny wobble range

    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    const windGain = ac.createGain();
    windGain.gain.value = 0;

    // Low-pass to remove harshness
    const lpf = ac.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = 110;
    lpf.Q.value = 0.7;

    osc.connect(lpf);
    lpf.connect(windGain);
    windGain.connect(this.master!);

    osc.start();
    lfo.start();

    this.weatherWindOsc = osc;
    this.weatherWindLfo = lfo;
    this.weatherWindGain = windGain;
  }

  private stopWeatherWind(now: number): void {
    if (this.weatherWindOsc) {
      try { this.weatherWindOsc.stop(now + 2); } catch { /* already stopped */ }
      this.weatherWindOsc.disconnect();
      this.weatherWindOsc = null;
    }
    if (this.weatherWindLfo) {
      try { this.weatherWindLfo.stop(now + 2); } catch { /* already stopped */ }
      this.weatherWindLfo.disconnect();
      this.weatherWindLfo = null;
    }
    if (this.weatherWindGain) {
      this.weatherWindGain.gain.cancelScheduledValues(now);
      this.weatherWindGain.gain.setValueAtTime(this.weatherWindGain.gain.value, now);
      this.weatherWindGain.gain.linearRampToValueAtTime(0, now + 2);
      this.weatherWindGain = null;
    }
  }

  private playThunder(sfxVol: number): void {
    const d = this.dest();
    const vol = 0.15 * sfxVol;

    // Delay 0.5-2s after flash (speed of sound)
    const delay = 0.5 + Math.random() * 1.5;

    // Low rumble: frequency sweep 80Hz → 30Hz
    this.sweep(80, 30, 2, vol, d, 'sine', delay);
    // Noise crack at the start
    this.filteredNoise(0.4, vol * 0.6, d, 150, 0.5, delay);
    // Second rumble (echo) with more delay
    const echoDelay = delay + 0.8 + Math.random() * 0.5;
    this.sweep(50, 25, 1.5, vol * 0.5, d, 'sine', echoDelay);
  }

  /** Stop all weather audio — call when match ends */
  stopWeatherAudio(): void {
    if (!this.actx) return;
    const now = this.actx.currentTime;
    this.stopWeatherRain(now);
    this.stopWeatherNoise(now);
    this.stopWeatherWind(now);
    if (this.weatherGain) {
      this.weatherGain.gain.cancelScheduledValues(now);
      this.weatherGain.gain.setValueAtTime(0, now);
    }
    if (this.weatherRainGain) {
      this.weatherRainGain.gain.cancelScheduledValues(now);
      this.weatherRainGain.gain.setValueAtTime(0, now);
    }
  }

  /** Non-spatial achievement fanfare — bright ascending arpeggio with shimmer */
  playAchievement(): void {
    const d = this.dest();
    const v = 0.4 * this.settings.sfxVolume;
    // Ascending major arpeggio: C5 E5 G5 C6 — triumphant
    const arp = [523, 659, 784, 1047];
    arp.forEach((f, i) => {
      this.note(f, 0.2, v * 0.55, d, 'square', i * 0.1);
      // Shimmer: octave-up triangle layer
      this.note(f * 2, 0.15, v * 0.2, d, 'triangle', i * 0.1 + 0.02);
    });
    // Final sustained chord
    this.note(1047, 0.6, v * 0.5, d, 'triangle', 0.42);
    this.note(1319, 0.5, v * 0.3, d, 'triangle', 0.44);
    this.note(1568, 0.45, v * 0.2, d, 'sine', 0.46);
    // Sparkle sweep
    this.sweep(2000, 4000, 0.3, v * 0.1, d, 'sine', 0.35);
  }
}
