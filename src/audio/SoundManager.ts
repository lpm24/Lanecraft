import { SoundEvent, Race } from '../simulation/types';
import { Camera } from '../rendering/Camera';
import { subscribeToAudioSettings, type AudioSettings } from './AudioSettings';

const TILE_SIZE = 16;

const SFX_MASTER_GAIN = 0.5;
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

  constructor() {
    this.settings = { musicVolume: 0.45, sfxVolume: 0.8 };
    this.settingsUnsub = subscribeToAudioSettings((settings) => {
      this.settings = settings;
      this.applyAudioSettings();
    });
  }

  dispose(): void {
    this.stopMusic();
    this.settingsUnsub?.();
    this.settingsUnsub = null;
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
    }
    if (this.actx.state === 'suspended') void this.actx.resume();
    return this.actx;
  }

  private applyAudioSettings(): void {
    if (this.master) this.master.gain.value = SFX_MASTER_GAIN * this.settings.sfxVolume;
    if (this.musicGain) this.musicGain.gain.value = MUSIC_MASTER_GAIN * this.settings.musicVolume;
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
    this.filteredNoise(0.04, v * 0.4, d, 1200 * p, 2);
    this.sweep(110 * p, 55, 0.05, v * 0.25, d, 'triangle');
  }

  private playRangedHit(v: number, d: GainNode): void {
    const p = this.pitchVar(0.15);
    // Pluck — high tick + filtered noise
    this.note(700 * p, 0.025, v * 0.25, d, 'square');
    this.filteredNoise(0.03, v * 0.15, d, 2000 * p, 3);
  }

  private playUnitKilled(v: number, d: GainNode): void {
    const p = this.pitchVar(0.1);
    this.sweep(260 * p, 70, 0.1, v * 0.35, d, 'square');
    this.filteredNoise(0.07, v * 0.2, d, 400, 1);
  }

  private playUnitSpawn(v: number, d: GainNode): void {
    const p = this.pitchVar(0.08);
    // Soft ascending blip — subtle "ready" feedback
    this.note(440 * p, 0.05, v * 0.2, d, 'triangle');
    this.note(660 * p, 0.07, v * 0.25, d, 'triangle', 0.04);
  }

  private playTowerFire(v: number, d: GainNode): void {
    const p = this.pitchVar(0.12);
    // Short zap — brief high-freq burst
    this.sweep(900 * p, 400 * p, 0.05, v * 0.2, d, 'sawtooth');
    this.filteredNoise(0.03, v * 0.12, d, 3000, 4);
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

  private playNukeIncoming(v: number, d: GainNode): void {
    // Slow-attack warning siren — NOT startling.
    // Soft filtered tone that swells over 0.8s, then repeats.
    // Uses sine (smooth) at mid-range (600-900 Hz) to cut through without being shrill.
    const ac = this.ctx();
    const t0 = ac.currentTime;
    for (let i = 0; i < 2; i++) {
      const offset = i * 0.7;
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, t0 + offset);
      osc.frequency.linearRampToValueAtTime(900, t0 + offset + 0.6);
      // Slow attack: ramp from 0 → peak over 100ms (prevents startle)
      g.gain.setValueAtTime(0.001, t0 + offset);
      g.gain.linearRampToValueAtTime(v * 0.3, t0 + offset + 0.1);
      g.gain.setValueAtTime(v * 0.3, t0 + offset + 0.5);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + offset + 0.65);
      osc.connect(g);
      g.connect(d);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + 0.7);
      // Sub-harmonic for body
      const sub = ac.createOscillator();
      const sg = ac.createGain();
      sub.type = 'triangle';
      sub.frequency.setValueAtTime(300, t0 + offset);
      sub.frequency.linearRampToValueAtTime(450, t0 + offset + 0.6);
      sg.gain.setValueAtTime(0.001, t0 + offset);
      sg.gain.linearRampToValueAtTime(v * 0.15, t0 + offset + 0.1);
      sg.gain.exponentialRampToValueAtTime(0.001, t0 + offset + 0.65);
      sub.connect(sg);
      sg.connect(d);
      sub.start(t0 + offset);
      sub.stop(t0 + offset + 0.7);
    }
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
        this.playMeleeHit(v, this.spatialDest(pan)); break;
      case 'ranged_hit':
        if (!this.shouldPlay('ranged', 40, 2)) return;
        this.playRangedHit(v, this.spatialDest(pan)); break;
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
      // Below: less frequent sounds — always play, still get panning
      case 'building_placed': this.playBuildingPlaced(v, this.spatialDest(pan)); break;
      case 'building_destroyed': this.playBuildingDestroyed(v, this.spatialDest(pan)); break;
      case 'upgrade_complete': this.playUpgradeComplete(v, this.spatialDest(pan)); break;
      case 'nuke_incoming': this.playNukeIncoming(v, this.spatialDest(pan)); break;
      case 'nuke_detonated': this.playNukeDetonated(v, this.spatialDest(pan)); break;
      case 'diamond_exposed': this.playDiamondExposed(v, this.spatialDest(pan)); break;
      case 'diamond_carried': this.playDiamondCarried(v, this.spatialDest(pan)); break;
      case 'hq_damaged': this.playHqDamaged(v, this.spatialDest(pan)); break;
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
