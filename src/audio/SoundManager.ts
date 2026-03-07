import { SoundEvent, Race } from '../simulation/types';
import { Camera } from '../rendering/Camera';

const TILE_SIZE = 16;
const MAP_TILE_W = 80;
const MAP_TILE_H = 120;

// ─── Music constants ──────────────────────────────────────────────────────────
const MUSIC_MASTER_GAIN = 0.12;

// ─── Race Music Profiles ──────────────────────────────────────────────────────
interface RaceMusicProfile {
  bpmCalm: number;
  bpmAction: number;
  bpmCritical: number;
  chordsCalm: number[][];
  chordsAction: number[][];
  chordsCritical: number[][];
  padType: OscillatorType;
  arpType: OscillatorType;
  arpOctaveCalm: number;   // arp octave multiplier at action intensity
  arpOctaveCrit: number;   // arp octave multiplier at critical
  padDetune: number;       // detune amount for warmth (0-10 cents as fraction)
  rhythmStyle: 'standard' | 'heavy' | 'sparse' | 'tribal' | 'none';
}

// Helper: frequency from note name
const N: Record<string, number> = {
  C2: 65.41, D2: 73.42, Eb2: 77.78, E2: 82.41, F2: 87.31, Gb2: 92.50, G2: 98.00, Ab2: 103.83, A2: 110, Bb2: 116.54, B2: 123.47,
  C3: 130.81, D3: 146.83, Eb3: 155.56, E3: 164.81, F3: 174.61, Gb3: 185.00, G3: 196.00, Ab3: 207.65, A3: 220, Bb3: 233.08, B3: 246.94,
  C4: 261.63, D4: 293.66, Eb4: 311.13, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440, Bb4: 466.16, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, Bb5: 932.33,
};

const RACE_MUSIC: Record<Race, RaceMusicProfile> = {
  // Crown: Noble/medieval, C major, balanced
  [Race.Crown]: {
    bpmCalm: 70, bpmAction: 90, bpmCritical: 120,
    chordsCalm:     [[N.C3, N.E3, N.G3], [N.F2, N.A3, N.C3], [N.G2, N.B3, N.D3], [N.A2, N.C3, N.E3]],
    chordsAction:   [[N.C3, N.E3, N.G3, N.C4], [N.F2, N.A3, N.C3, N.F3], [N.G2, N.B3, N.D3, N.G3], [N.A2, N.C3, N.E3, N.A3]],
    chordsCritical: [[N.C3, N.E3, N.G3, N.C4, N.Bb3], [N.F2, N.A3, N.C3, N.Eb3], [N.G2, N.B3, N.D3, N.G3, N.F3], [N.A2, N.C3, N.E3, N.Ab3]],
    padType: 'triangle', arpType: 'square', arpOctaveCalm: 2, arpOctaveCrit: 4, padDetune: 1.003, rhythmStyle: 'standard',
  },
  // Horde: Aggressive/primal, power chords, heavy drums
  [Race.Horde]: {
    bpmCalm: 80, bpmAction: 105, bpmCritical: 130,
    chordsCalm:     [[N.E2, N.B3], [N.G2, N.D3], [N.A2, N.E3], [N.D2, N.A3]],
    chordsAction:   [[N.E2, N.B3, N.E3], [N.G2, N.D3, N.G3], [N.A2, N.E3, N.A3], [N.D2, N.A3, N.D3]],
    chordsCritical: [[N.E2, N.B3, N.E3, N.Bb3], [N.G2, N.D3, N.G3, N.F3], [N.A2, N.E3, N.A3, N.Eb3], [N.D2, N.A3, N.D3, N.Ab3]],
    padType: 'sawtooth', arpType: 'sawtooth', arpOctaveCalm: 1, arpOctaveCrit: 2, padDetune: 1.008, rhythmStyle: 'heavy',
  },
  // Goblins: Sneaky/mischievous, minor, quick staccato
  [Race.Goblins]: {
    bpmCalm: 85, bpmAction: 110, bpmCritical: 140,
    chordsCalm:     [[N.A2, N.C3, N.E3], [N.D3, N.F3, N.A3], [N.E2, N.G3, N.B3], [N.A2, N.C3, N.E3]],
    chordsAction:   [[N.A2, N.C3, N.E3, N.A3], [N.D3, N.F3, N.A3, N.D4], [N.E2, N.G3, N.B3, N.E3], [N.F2, N.A3, N.C3, N.F3]],
    chordsCritical: [[N.A2, N.C3, N.Eb3, N.A3], [N.D3, N.F3, N.Ab3], [N.E2, N.G3, N.Bb3, N.E3], [N.F2, N.Ab3, N.C3]],
    padType: 'triangle', arpType: 'square', arpOctaveCalm: 4, arpOctaveCrit: 8, padDetune: 1.005, rhythmStyle: 'sparse',
  },
  // Oozlings: Weird/bubbly, whole-tone feel, wobbly
  [Race.Oozlings]: {
    bpmCalm: 65, bpmAction: 85, bpmCritical: 110,
    chordsCalm:     [[N.C3, N.D3, N.Gb3], [N.D3, N.E3, N.Ab3], [N.E3, N.Gb3, N.Bb3], [N.Gb3, N.Ab3, N.C4]],
    chordsAction:   [[N.C3, N.D3, N.Gb3, N.C4], [N.D3, N.E3, N.Ab3, N.D4], [N.E3, N.Gb3, N.Bb3, N.E4], [N.Gb3, N.Ab3, N.C4, N.Gb2]],
    chordsCritical: [[N.C3, N.E3, N.Ab3, N.C4], [N.D3, N.Gb3, N.Bb3], [N.Eb3, N.G3, N.B3, N.Eb4], [N.Gb3, N.Bb3, N.D4]],
    padType: 'sine', arpType: 'sine', arpOctaveCalm: 2, arpOctaveCrit: 4, padDetune: 1.012, rhythmStyle: 'sparse',
  },
  // Demon: Dark/menacing, diminished, low/slow
  [Race.Demon]: {
    bpmCalm: 55, bpmAction: 75, bpmCritical: 100,
    chordsCalm:     [[N.C2, N.Eb2, N.Gb2], [N.D2, N.F2, N.Ab2], [N.Eb2, N.Gb2, N.A2], [N.C2, N.Eb2, N.Gb2]],
    chordsAction:   [[N.C2, N.Eb2, N.Gb2, N.C3], [N.D2, N.F2, N.Ab2, N.D3], [N.Eb2, N.Gb2, N.A2, N.Eb3], [N.B2, N.D3, N.F3, N.Ab3]],
    chordsCritical: [[N.C2, N.Eb2, N.Gb2, N.A2, N.C3], [N.D2, N.F2, N.Ab2, N.B2], [N.Eb2, N.Gb2, N.A2, N.C3, N.Eb3], [N.E2, N.G3, N.Bb3, N.D3]],
    padType: 'sawtooth', arpType: 'square', arpOctaveCalm: 1, arpOctaveCrit: 2, padDetune: 1.006, rhythmStyle: 'heavy',
  },
  // Deep: Oceanic/mysterious, sus chords, slow
  [Race.Deep]: {
    bpmCalm: 55, bpmAction: 72, bpmCritical: 95,
    chordsCalm:     [[N.D2, N.G2, N.A2], [N.E2, N.A2, N.B2], [N.G2, N.C3, N.D3], [N.A2, N.D3, N.E3]],
    chordsAction:   [[N.D2, N.G2, N.A2, N.D3], [N.E2, N.A2, N.B2, N.E3], [N.G2, N.C3, N.D3, N.G3], [N.A2, N.D3, N.E3, N.A3]],
    chordsCritical: [[N.D2, N.G2, N.A2, N.D3, N.F3], [N.E2, N.A2, N.B2, N.E3, N.G3], [N.G2, N.C3, N.D3, N.G3, N.Bb3], [N.A2, N.D3, N.E3, N.A3, N.C4]],
    padType: 'sine', arpType: 'triangle', arpOctaveCalm: 2, arpOctaveCrit: 4, padDetune: 1.004, rhythmStyle: 'none',
  },
  // Wild: Tribal/nature, pentatonic, organic rhythms
  [Race.Wild]: {
    bpmCalm: 75, bpmAction: 100, bpmCritical: 125,
    chordsCalm:     [[N.A2, N.C3, N.E3], [N.G2, N.C3, N.D3], [N.E2, N.G3, N.A3], [N.D2, N.G2, N.A2]],
    chordsAction:   [[N.A2, N.C3, N.E3, N.A3], [N.G2, N.C3, N.D3, N.G3], [N.E2, N.G3, N.A3, N.E3], [N.D2, N.G2, N.A2, N.D3]],
    chordsCritical: [[N.A2, N.C3, N.E3, N.A3, N.G3], [N.G2, N.C3, N.D3, N.G3, N.E3], [N.E2, N.G3, N.A3, N.C4], [N.D2, N.G2, N.A2, N.D3, N.C3]],
    padType: 'triangle', arpType: 'triangle', arpOctaveCalm: 2, arpOctaveCrit: 4, padDetune: 1.002, rhythmStyle: 'tribal',
  },
  // Geists: Haunting/ethereal, minor with b5, sparse
  [Race.Geists]: {
    bpmCalm: 58, bpmAction: 78, bpmCritical: 105,
    chordsCalm:     [[N.B2, N.D3, N.F3], [N.E2, N.G3, N.Bb3], [N.A2, N.C3, N.Eb3], [N.D2, N.F2, N.Ab2]],
    chordsAction:   [[N.B2, N.D3, N.F3, N.B3], [N.E2, N.G3, N.Bb3, N.E3], [N.A2, N.C3, N.Eb3, N.A3], [N.D2, N.F2, N.Ab2, N.D3]],
    chordsCritical: [[N.B2, N.D3, N.F3, N.A3, N.B3], [N.E2, N.G3, N.Bb3, N.D3, N.E3], [N.A2, N.C3, N.Eb3, N.Gb3], [N.D2, N.F2, N.Ab2, N.B2, N.D3]],
    padType: 'sine', arpType: 'square', arpOctaveCalm: 4, arpOctaveCrit: 8, padDetune: 1.005, rhythmStyle: 'sparse',
  },
  // Tenders: Pastoral/gentle, major 7ths, warm
  [Race.Tenders]: {
    bpmCalm: 60, bpmAction: 80, bpmCritical: 105,
    chordsCalm:     [[N.C3, N.E3, N.G3, N.B3], [N.F2, N.A3, N.C3, N.E3], [N.G2, N.B3, N.D3, N.Gb3], [N.A2, N.C3, N.E3, N.G3]],
    chordsAction:   [[N.C3, N.E3, N.G3, N.B3, N.D4], [N.F2, N.A3, N.C3, N.E3, N.A3], [N.G2, N.B3, N.D3, N.Gb3, N.A3], [N.A2, N.C3, N.E3, N.G3, N.C4]],
    chordsCritical: [[N.C3, N.E3, N.G3, N.Bb3, N.D4], [N.F2, N.A3, N.C3, N.Eb3], [N.G2, N.B3, N.D3, N.F3, N.A3], [N.A2, N.C3, N.Eb3, N.G3]],
    padType: 'sine', arpType: 'triangle', arpOctaveCalm: 2, arpOctaveCrit: 4, padDetune: 1.002, rhythmStyle: 'none',
  },
};

// Arpeggio note patterns (scale degrees relative to chord root)
const ARP_PATTERNS = [
  [0, 1, 2, 1],  // up-down
  [0, 2, 1, 2],  // skip pattern
  [2, 1, 0, 1],  // down-up
  [0, 1, 2, 0],  // climb-reset
];

export class SoundManager {
  private actx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBufferCache = new Map<number, AudioBuffer>(); // keyed by buffer size

  // ─── Music state ─────────────────────────────────────────────────────────────
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

  // Gain nodes for each layer (for crossfading)
  private padGain: GainNode | null = null;
  private rhythmGain: GainNode | null = null;
  private arpGain: GainNode | null = null;
  private warningGain: GainNode | null = null;

  // Lazily create (or resume) the AudioContext after user gesture
  private ctx(): AudioContext {
    if (!this.actx) {
      this.actx = new AudioContext();
      this.master = this.actx.createGain();
      this.master.gain.value = 0.25;
      this.master.connect(this.actx.destination);
    }
    if (this.actx.state === 'suspended') this.actx.resume();
    return this.actx;
  }

  private dest(): GainNode {
    this.ctx();
    return this.master!;
  }

  // ─── Spatial gain ────────────────────────────────────────────────────────────
  private spatialGain(
    worldTileX: number | undefined,
    worldTileY: number | undefined,
    camera: Camera,
    canvas: HTMLCanvasElement,
  ): number {
    const zoomGain = Math.min(1, camera.zoom);

    if (worldTileX === undefined || worldTileY === undefined) return zoomGain;

    const camCX = (camera.x + canvas.width  / (2 * camera.zoom)) / TILE_SIZE;
    const camCY = (camera.y + canvas.height / (2 * camera.zoom)) / TILE_SIZE;

    const dx = worldTileX - camCX;
    const dy = worldTileY - camCY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const maxDist = (Math.max(MAP_TILE_W, MAP_TILE_H) * 0.7) / camera.zoom;
    const distGain = Math.max(0, 1 - dist / maxDist);

    return zoomGain * distGain;
  }

  // ─── Low-level primitives ─────────────────────────────────────────────────

  private note(
    freq: number,
    duration: number,
    gain: number,
    dest: GainNode,
    type: OscillatorType = 'square',
    startOffset = 0,
  ): void {
    const ac = this.ctx();
    const osc = ac.createOscillator();
    const g   = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t0 = ac.currentTime + startOffset;
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
    const g   = ac.createGain();
    osc.type = type;
    const t0 = ac.currentTime + startOffset;
    osc.frequency.setValueAtTime(freqFrom, t0);
    osc.frequency.exponentialRampToValueAtTime(freqTo, t0 + duration);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(g);
    g.connect(dest);
    osc.start(t0);
    osc.stop(t0 + duration + 0.01);
  }

  private noise(duration: number, gain: number, dest: GainNode, startOffset = 0): void {
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
    const g   = ac.createGain();
    src.buffer = buf;
    const t0 = ac.currentTime + startOffset;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    src.connect(g);
    g.connect(dest);
    src.start(t0);
    src.stop(t0 + duration + 0.01);
  }

  // ─── Music primitives ──────────────────────────────────────────────────────

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
    osc.type = type;
    osc.frequency.value = freq;
    const attack = Math.min(0.3, duration * 0.15);
    const release = Math.min(0.5, duration * 0.2);
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

  /** Deep tom hit for tribal rhythm */
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

  // ─── Music scheduling ─────────────────────────────────────────────────────

  private ensureMusicGainNodes(): void {
    const ac = this.ctx();
    if (!this.musicGain) {
      this.musicGain = ac.createGain();
      this.musicGain.gain.value = MUSIC_MASTER_GAIN;
      this.musicGain.connect(ac.destination);

      this.padGain = ac.createGain();
      this.padGain.gain.value = 1.0;
      this.padGain.connect(this.musicGain);

      this.rhythmGain = ac.createGain();
      this.rhythmGain.gain.value = 0.0;
      this.rhythmGain.connect(this.musicGain);

      this.arpGain = ac.createGain();
      this.arpGain.gain.value = 0.0;
      this.arpGain.connect(this.musicGain);

      this.warningGain = ac.createGain();
      this.warningGain.gain.value = 0.0;
      this.warningGain.connect(this.musicGain);
    }
  }

  private getBPM(): number {
    const p = this.raceProfile;
    switch (this.currentIntensity) {
      case 2: return p.bpmCritical;
      case 1: return p.bpmAction;
      default: return p.bpmCalm;
    }
  }

  private getChords(): number[][] {
    const p = this.raceProfile;
    switch (this.currentIntensity) {
      case 2: return p.chordsCritical;
      case 1: return p.chordsAction;
      default: return p.chordsCalm;
    }
  }

  private scheduleBar(): void {
    this.ctx();
    if (!this.musicPlaying) return;

    const p = this.raceProfile;
    const bpm = this.getBPM();
    const beatDur = 60 / bpm;
    const barDur = beatDur * 4;
    const chords = this.getChords();
    const chord = chords[this.currentChordIndex % chords.length];
    const barStart = this.nextBarTime;

    // ─── Pad layer (always on) ───────────────────────────────────────────────
    const padVol = this.currentIntensity === 0 ? 0.35 : 0.25;
    for (const freq of chord) {
      this.padTone(freq, barDur, padVol, this.padGain!, barStart, p.padType);
      // Detuned layer for warmth
      this.padTone(freq * p.padDetune, barDur, padVol * 0.5, this.padGain!, barStart, 'sine');
    }

    // ─── Rhythm layer (intensity >= 1) ───────────────────────────────────────
    if (this.currentIntensity >= 1) {
      switch (p.rhythmStyle) {
        case 'heavy':
          // Double kicks, aggressive
          for (let beat = 0; beat < 4; beat++) {
            const t = barStart + beat * beatDur;
            this.kick(t, 0.6, this.rhythmGain!);
            this.kick(t + beatDur * 0.5, 0.3, this.rhythmGain!);
            this.noiseAt(0.04, 0.25, this.rhythmGain!, t + beatDur * 0.25);
          }
          if (this.currentIntensity === 2) {
            for (let eighth = 0; eighth < 8; eighth++) {
              this.kick(barStart + eighth * beatDur * 0.5, 0.35, this.rhythmGain!);
            }
          }
          break;

        case 'tribal':
          // Syncopated toms + shaker
          for (let beat = 0; beat < 4; beat++) {
            const t = barStart + beat * beatDur;
            this.tom(t, 0.5, this.rhythmGain!, 100);
            if (beat === 1 || beat === 3) {
              this.tom(t + beatDur * 0.33, 0.35, this.rhythmGain!, 130);
            }
            if (beat === 2) {
              this.tom(t + beatDur * 0.66, 0.25, this.rhythmGain!, 80);
            }
            // Shaker on every eighth
            this.noiseAt(0.015, 0.12, this.rhythmGain!, t);
            this.noiseAt(0.015, 0.08, this.rhythmGain!, t + beatDur * 0.5);
          }
          if (this.currentIntensity === 2) {
            for (let sixteenth = 0; sixteenth < 16; sixteenth++) {
              this.noiseAt(0.01, 0.1, this.rhythmGain!, barStart + sixteenth * beatDur * 0.25);
            }
          }
          break;

        case 'sparse':
          // Minimal: kick on 1 and 3, hi-hat on 2 and 4
          this.kick(barStart, 0.45, this.rhythmGain!);
          this.kick(barStart + beatDur * 2, 0.4, this.rhythmGain!);
          this.noiseAt(0.025, 0.18, this.rhythmGain!, barStart + beatDur);
          this.noiseAt(0.025, 0.18, this.rhythmGain!, barStart + beatDur * 3);
          if (this.currentIntensity === 2) {
            this.kick(barStart + beatDur, 0.3, this.rhythmGain!);
            this.kick(barStart + beatDur * 3, 0.3, this.rhythmGain!);
            for (let eighth = 0; eighth < 8; eighth++) {
              this.noiseAt(0.02, 0.12, this.rhythmGain!, barStart + eighth * beatDur * 0.5);
            }
          }
          break;

        case 'standard':
          for (let beat = 0; beat < 4; beat++) {
            const t = barStart + beat * beatDur;
            this.kick(t, 0.5, this.rhythmGain!);
            if (beat % 2 === 1 || this.currentIntensity === 2) {
              this.noiseAt(0.03, 0.2, this.rhythmGain!, t + beatDur * 0.5);
            }
          }
          if (this.currentIntensity === 2) {
            for (let eighth = 0; eighth < 8; eighth++) {
              if (eighth % 2 === 1) {
                this.kick(barStart + eighth * beatDur * 0.5, 0.3, this.rhythmGain!);
              }
            }
          }
          break;

        case 'none':
          // No drums — Deep and Tenders stay atmospheric
          // Just a subtle pulse in critical mode
          if (this.currentIntensity === 2) {
            for (let beat = 0; beat < 4; beat++) {
              this.noiseAt(0.04, 0.15, this.rhythmGain!, barStart + beat * beatDur);
            }
          }
          break;
      }
    }

    // ─── Arpeggio layer (intensity >= 1) ─────────────────────────────────────
    if (this.currentIntensity >= 1) {
      const arpPattern = ARP_PATTERNS[this.currentChordIndex % ARP_PATTERNS.length];
      const arpOctave = this.currentIntensity === 2 ? p.arpOctaveCrit : p.arpOctaveCalm;
      const subdivisions = this.currentIntensity === 2 ? 8 : 4;
      const subDur = barDur / subdivisions;

      for (let i = 0; i < subdivisions; i++) {
        const noteIndex = arpPattern[i % arpPattern.length];
        const freq = chord[Math.min(noteIndex, chord.length - 1)] * arpOctave;
        const t = barStart + i * subDur;
        const noteDur = subDur * 0.7;
        this.musicNote(freq, noteDur, 0.3, this.arpGain!, t, p.arpType);
      }
    }

    // ─── Warning tones (intensity === 2) ─────────────────────────────────────
    if (this.currentIntensity === 2) {
      for (let beat = 0; beat < 4; beat++) {
        const t = barStart + beat * beatDur;
        // Use chord's highest note as warning base for race flavor
        const warnFreq = chord[chord.length - 1] * 4;
        this.musicNote(warnFreq, 0.06, 0.4, this.warningGain!, t, 'square');
        this.musicNote(warnFreq * 1.06, 0.06, 0.3, this.warningGain!, t + beatDur * 0.25, 'square');
      }
    }

    // Advance to next chord/bar
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
    const fadeTime = 1.0;

    if (this.padGain) {
      this.padGain.gain.cancelScheduledValues(now);
      this.padGain.gain.setValueAtTime(this.padGain.gain.value, now);
      this.padGain.gain.linearRampToValueAtTime(1.0, now + fadeTime);
    }

    if (this.rhythmGain) {
      const target = this.currentIntensity >= 1 ? 1.0 : 0.0;
      this.rhythmGain.gain.cancelScheduledValues(now);
      this.rhythmGain.gain.setValueAtTime(this.rhythmGain.gain.value, now);
      this.rhythmGain.gain.linearRampToValueAtTime(target, now + fadeTime);
    }

    if (this.arpGain) {
      const target = this.currentIntensity >= 1 ? 0.7 : 0.0;
      this.arpGain.gain.cancelScheduledValues(now);
      this.arpGain.gain.setValueAtTime(this.arpGain.gain.value, now);
      this.arpGain.gain.linearRampToValueAtTime(target, now + fadeTime);
    }

    if (this.warningGain) {
      const target = this.currentIntensity >= 2 ? 0.8 : 0.0;
      this.warningGain.gain.cancelScheduledValues(now);
      this.warningGain.gain.setValueAtTime(this.warningGain.gain.value, now);
      this.warningGain.gain.linearRampToValueAtTime(target, now + fadeTime);
    }
  }

  // ─── Named sound effects ──────────────────────────────────────────────────

  private playBuildingPlaced(v: number): void {
    const d = this.dest();
    this.note(330, 0.06, v * 0.4, d, 'square', 0);
    this.note(494, 0.06, v * 0.4, d, 'square', 0.065);
    this.note(659, 0.10, v * 0.5, d, 'square', 0.13);
  }

  private playBuildingDestroyed(v: number): void {
    const d = this.dest();
    this.sweep(400, 50, 0.28, v * 0.5, d, 'sawtooth');
    this.noise(0.25, v * 0.3, d);
  }

  private playUnitKilled(v: number): void {
    const d = this.dest();
    this.sweep(280, 80, 0.09, v * 0.25, d, 'square');
  }

  private playNukeIncoming(v: number): void {
    const d = this.dest();
    this.sweep(220, 880, 0.8, v * 0.5, d, 'sawtooth', 0);
    this.sweep(220, 880, 0.8, v * 0.4, d, 'sawtooth', 0.85);
  }

  private playNukeDetonated(v: number): void {
    const d = this.dest();
    this.note(60, 0.5, v * 0.6, d, 'sine');
    this.note(40, 0.4, v * 0.5, d, 'sine', 0.05);
    this.noise(0.55, v * 0.6, d);
    this.sweep(300, 30, 0.5, v * 0.4, d, 'sawtooth');
  }

  private playDiamondExposed(v: number): void {
    const d = this.dest();
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => this.note(f, 0.15, v * 0.45, d, 'square', i * 0.13));
  }

  private playDiamondCarried(v: number): void {
    const d = this.dest();
    this.note(1047, 0.07, v * 0.4, d, 'square', 0);
    this.note(1319, 0.10, v * 0.5, d, 'square', 0.08);
  }

  private playHqDamaged(v: number): void {
    const d = this.dest();
    this.sweep(150, 50, 0.22, v * 0.55, d, 'square');
    this.noise(0.18, v * 0.25, d);
  }

  private playMatchStart(v: number): void {
    const d = this.dest();
    const notes = [262, 330, 392, 523];
    notes.forEach((f, i) => this.note(f, 0.12, v * 0.5, d, 'square', i * 0.11));
  }

  private playMatchEndWin(v: number): void {
    const d = this.dest();
    const notes = [523, 659, 784, 1047, 1047];
    notes.forEach((f, i) => {
      const dur = i === notes.length - 1 ? 0.4 : 0.13;
      this.note(f, dur, v * 0.5, d, 'square', i * 0.14);
    });
  }

  private playMatchEndLose(v: number): void {
    const d = this.dest();
    const notes = [392, 330, 262, 220];
    notes.forEach((f, i) => this.note(f, 0.18, v * 0.45, d, 'square', i * 0.16));
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  play(event: SoundEvent, camera: Camera, canvas: HTMLCanvasElement): void {
    const v = this.spatialGain(event.x, event.y, camera, canvas);
    if (v < 0.01) return;

    switch (event.type) {
      case 'building_placed':    this.playBuildingPlaced(v);   break;
      case 'building_destroyed': this.playBuildingDestroyed(v); break;
      case 'unit_killed':        this.playUnitKilled(v);        break;
      case 'nuke_incoming':      this.playNukeIncoming(v);      break;
      case 'nuke_detonated':     this.playNukeDetonated(v);     break;
      case 'diamond_exposed':    this.playDiamondExposed(v);    break;
      case 'diamond_carried':    this.playDiamondCarried(v);    break;
      case 'hq_damaged':         this.playHqDamaged(v);         break;
      case 'match_start':        this.playMatchStart(v);        break;
      case 'match_end_win':      this.playMatchEndWin(v);       break;
      case 'match_end_lose':     this.playMatchEndLose(v);      break;
    }
  }

  // ─── Music public API ──────────────────────────────────────────────────────

  startMusic(race: Race = Race.Crown): void {
    if (this.musicPlaying) return;

    this.raceProfile = RACE_MUSIC[race] ?? RACE_MUSIC[Race.Crown];

    const ac = this.ctx();
    this.ensureMusicGainNodes();
    this.musicGain!.gain.cancelScheduledValues(ac.currentTime);
    this.musicGain!.gain.setValueAtTime(MUSIC_MASTER_GAIN, ac.currentTime);
    this.musicPlaying = true;
    this.currentChordIndex = 0;
    this.currentIntensity = 0;
    this.targetIntensity = 0;
    this.nextBarTime = ac.currentTime + 0.1;

    this.updateLayerGains();

    this.scheduleBar();
    this.scheduleBar();

    this.musicSchedulerId = setInterval(() => {
      if (!this.musicPlaying) return;
      const ac = this.ctx();
      const bpm = this.getBPM();
      const barDur = (60 / bpm) * 4;
      while (this.nextBarTime < ac.currentTime + barDur * 2) {
        this.scheduleBar();
      }

      if (this.targetIntensity !== this.currentIntensity) {
        const now = Date.now();
        if (now - this.lastIntensityChange >= this.intensityDebounceMs) {
          this.currentIntensity = this.targetIntensity;
          this.lastIntensityChange = now;
          this.updateLayerGains();
        }
      }
    }, 200);
  }

  stopMusic(): void {
    this.musicPlaying = false;

    if (this.musicSchedulerId !== null) {
      clearInterval(this.musicSchedulerId);
      this.musicSchedulerId = null;
    }

    if (this.musicGain) {
      const ac = this.ctx();
      const now = ac.currentTime;
      this.musicGain.gain.cancelScheduledValues(now);
      this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, now);
      this.musicGain.gain.linearRampToValueAtTime(0.001, now + 0.5);
    }
  }

  setIntensity(level: number): void {
    this.targetIntensity = Math.max(0, Math.min(2, Math.floor(level)));
  }
}
