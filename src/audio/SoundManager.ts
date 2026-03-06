import { SoundEvent } from '../simulation/types';
import { Camera } from '../rendering/Camera';

const TILE_SIZE = 16;
const MAP_TILE_W = 80;
const MAP_TILE_H = 120;

// ─── Music constants ──────────────────────────────────────────────────────────
const MUSIC_MASTER_GAIN = 0.12;
const BPM_CALM = 70;
const BPM_ACTION = 90;
const BPM_CRITICAL = 120;

// Chord progression: Am - F - C - G  (4 chords, each 1 bar of 4 beats)
// Represented as arrays of frequencies for root + intervals
const CHORDS_CALM: number[][] = [
  [110, 165, 220],        // Am  (A2, E3, A3)
  [87.31, 130.81, 174.61], // F   (F2, C3, F3)
  [130.81, 164.81, 196],  // C   (C3, E3, G3)
  [98, 146.83, 196],      // G   (G2, D3, G3)
];

// Action: same roots but add 5ths and octaves for richness
const CHORDS_ACTION: number[][] = [
  [110, 165, 220, 330],
  [87.31, 130.81, 174.61, 261.63],
  [130.81, 164.81, 196, 261.63],
  [98, 146.83, 196, 293.66],
];

// Critical: dissonant additions (b5, b9)
const CHORDS_CRITICAL: number[][] = [
  [110, 155.56, 220, 330, 233.08],    // Am + b5(Eb) + b9(Bb)
  [87.31, 130.81, 174.61, 123.47],    // F + b5(B)
  [130.81, 164.81, 196, 185.00],      // C + b5(Gb)
  [98, 146.83, 196, 138.59, 207.65],  // G + b5(Db) + b9(Ab)
];

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
  private intensityDebounceMs = 500; // don't change intensity more than every 500ms

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
  // Returns 0..1 based on distance from camera center and zoom level.
  private spatialGain(
    worldTileX: number | undefined,
    worldTileY: number | undefined,
    camera: Camera,
    canvas: HTMLCanvasElement,
  ): number {
    // Zoom multiplier: louder when zoomed in, quieter when zoomed out
    const zoomGain = Math.min(1, camera.zoom);

    if (worldTileX === undefined || worldTileY === undefined) return zoomGain;

    // Camera centre in world tiles
    const camCX = (camera.x + canvas.width  / (2 * camera.zoom)) / TILE_SIZE;
    const camCY = (camera.y + canvas.height / (2 * camera.zoom)) / TILE_SIZE;

    const dx = worldTileX - camCX;
    const dy = worldTileY - camCY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Max audible radius scales with zoom (zoomed out = hear more of the map)
    const maxDist = (Math.max(MAP_TILE_W, MAP_TILE_H) * 0.7) / camera.zoom;
    const distGain = Math.max(0, 1 - dist / maxDist);

    return zoomGain * distGain;
  }

  // ─── Low-level primitives ─────────────────────────────────────────────────

  /** Single square-wave note with exponential decay */
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

  /** Frequency sweep (portamento) */
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

  /** White noise burst — reuses a cached buffer per duration bucket to reduce GC pressure */
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

  /** Sustained pad tone (sine/triangle) with slow attack and release */
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
    // Slow attack, sustain, slow release
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

  /** Short percussive kick using low-freq oscillator */
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
    // Add a tiny noise click for attack
    this.noiseAt(0.02, gain * 0.4, dest, startTime);
  }

  /** Noise burst at a precise time (for music scheduling) */
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
    switch (this.currentIntensity) {
      case 2: return BPM_CRITICAL;
      case 1: return BPM_ACTION;
      default: return BPM_CALM;
    }
  }

  private getChords(): number[][] {
    switch (this.currentIntensity) {
      case 2: return CHORDS_CRITICAL;
      case 1: return CHORDS_ACTION;
      default: return CHORDS_CALM;
    }
  }

  private scheduleBar(): void {
    this.ctx(); // ensure AudioContext is initialized
    if (!this.musicPlaying) return;

    const bpm = this.getBPM();
    const beatDur = 60 / bpm;
    const barDur = beatDur * 4;
    const chords = this.getChords();
    const chord = chords[this.currentChordIndex % chords.length];
    const barStart = this.nextBarTime;

    // ─── Pad layer (always on) ───────────────────────────────────────────────
    const padVol = this.currentIntensity === 0 ? 0.35 : 0.25;
    for (const freq of chord) {
      this.padTone(freq, barDur, padVol, this.padGain!, barStart, 'triangle');
      // Add a detuned sine for warmth
      this.padTone(freq * 1.003, barDur, padVol * 0.5, this.padGain!, barStart, 'sine');
    }

    // ─── Rhythm layer (intensity >= 1) ───────────────────────────────────────
    if (this.currentIntensity >= 1) {
      for (let beat = 0; beat < 4; beat++) {
        const t = barStart + beat * beatDur;
        this.kick(t, 0.5, this.rhythmGain!);
        // Hi-hat on off-beats
        if (beat % 2 === 1 || this.currentIntensity === 2) {
          this.noiseAt(0.03, 0.2, this.rhythmGain!, t + beatDur * 0.5);
        }
      }
      // Extra 8th-note kicks in critical mode
      if (this.currentIntensity === 2) {
        for (let eighth = 0; eighth < 8; eighth++) {
          if (eighth % 2 === 1) {
            this.kick(barStart + eighth * beatDur * 0.5, 0.3, this.rhythmGain!);
          }
        }
      }
    }

    // ─── Arpeggio layer (intensity >= 1) ─────────────────────────────────────
    if (this.currentIntensity >= 1) {
      const arpPattern = ARP_PATTERNS[this.currentChordIndex % ARP_PATTERNS.length];
      const arpOctave = this.currentIntensity === 2 ? 4 : 2; // higher octave when critical
      const subdivisions = this.currentIntensity === 2 ? 8 : 4;
      const subDur = barDur / subdivisions;

      for (let i = 0; i < subdivisions; i++) {
        const noteIndex = arpPattern[i % arpPattern.length];
        const freq = chord[Math.min(noteIndex, chord.length - 1)] * arpOctave;
        const t = barStart + i * subDur;
        const noteDur = subDur * 0.7;
        this.musicNote(freq, noteDur, 0.3, this.arpGain!, t, 'square');
      }
    }

    // ─── Warning tones (intensity === 2) ─────────────────────────────────────
    if (this.currentIntensity === 2) {
      // Pulsing high-pitch warning
      for (let beat = 0; beat < 4; beat++) {
        const t = barStart + beat * beatDur;
        this.musicNote(880, 0.06, 0.4, this.warningGain!, t, 'square');
        this.musicNote(932.33, 0.06, 0.3, this.warningGain!, t + beatDur * 0.25, 'square'); // Bb5 - dissonant
      }
    }

    // Advance to next chord/bar
    this.nextBarTime = barStart + barDur;
    this.currentChordIndex = (this.currentChordIndex + 1) % 4;
  }

  /** Short note for music scheduling (uses absolute start time) */
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
    const fadeTime = 1.0; // 1 second crossfade

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
    // Rising siren in two waves
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
    const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
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
    const notes = [262, 330, 392, 523]; // C4 E4 G4 C5
    notes.forEach((f, i) => this.note(f, 0.12, v * 0.5, d, 'square', i * 0.11));
  }

  private playMatchEndWin(v: number): void {
    const d = this.dest();
    const notes = [523, 659, 784, 1047, 1047]; // C5 E5 G5 C6 C6
    notes.forEach((f, i) => {
      const dur = i === notes.length - 1 ? 0.4 : 0.13;
      this.note(f, dur, v * 0.5, d, 'square', i * 0.14);
    });
  }

  private playMatchEndLose(v: number): void {
    const d = this.dest();
    const notes = [392, 330, 262, 220]; // G4 E4 C4 A3
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

  startMusic(): void {
    if (this.musicPlaying) return;

    const ac = this.ctx();
    this.ensureMusicGainNodes();
    // Reset music master gain in case stopMusic() faded it out
    this.musicGain!.gain.cancelScheduledValues(ac.currentTime);
    this.musicGain!.gain.setValueAtTime(MUSIC_MASTER_GAIN, ac.currentTime);
    this.musicPlaying = true;
    this.currentChordIndex = 0;
    this.currentIntensity = 0;
    this.targetIntensity = 0;
    this.nextBarTime = ac.currentTime + 0.1; // slight delay to avoid glitches

    this.updateLayerGains();

    // Schedule first two bars immediately
    this.scheduleBar();
    this.scheduleBar();

    // Use setInterval to keep scheduling bars ahead of time
    // Check every 200ms if we need to schedule the next bar
    this.musicSchedulerId = setInterval(() => {
      if (!this.musicPlaying) return;
      const ac = this.ctx();
      // Schedule bars until we're at least 2 bars ahead
      const bpm = this.getBPM();
      const barDur = (60 / bpm) * 4;
      while (this.nextBarTime < ac.currentTime + barDur * 2) {
        this.scheduleBar();
      }

      // Apply intensity changes
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

    // Fade out music gain
    if (this.musicGain) {
      const ac = this.ctx();
      const now = ac.currentTime;
      this.musicGain.gain.cancelScheduledValues(now);
      this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, now);
      this.musicGain.gain.linearRampToValueAtTime(0.001, now + 0.5);
    }
  }

  setIntensity(level: number): void {
    // Clamp to 0-2
    this.targetIntensity = Math.max(0, Math.min(2, Math.floor(level)));
  }
}
