# Procedural Audio Research Report for Lanecraft

Comprehensive research into programmatic sound effects for browser-based games, with focus on Web Audio API techniques relevant to an RTS game.

---

## 1. Programmatic/Procedural Audio in Games

### What Is It

Procedural audio is sound generated algorithmically at runtime rather than played from pre-recorded files. The game engine drives synthesis parameters in real-time, producing sound effects that respond dynamically to gameplay state. Instead of triggering a static "sword_hit.wav", the system synthesizes a unique hit sound each time using oscillators, noise, filters, and envelopes.

### Why It Matters

- **File size**: Zero audio assets to download. Lanecraft's current `SoundManager.ts` already does this -- the entire game ships with no .wav/.mp3 files.
- **Infinite variation**: Every sound is unique, preventing the "broken record" effect that plagues sample-based games.
- **Dynamic response**: Sound parameters can map directly to game state (damage amount, unit type, distance, intensity).
- **RAM footprint**: GTA 5 used procedural audio for ambient objects (air conditioning, bicycle sounds) specifically to reclaim RAM that sample playback would consume.

### Major Approaches

**Subtractive Synthesis**
Start with a harmonically rich waveform (sawtooth, square) and use filters to carve away unwanted frequencies. Classic approach for melee impacts, UI clicks, and aggressive sounds.
- Components: oscillator -> filter (lowpass/bandpass/highpass) -> amplifier with ADSR envelope
- Best for: impacts, mechanical sounds, aggressive tones

**Additive Synthesis**
Build sounds by layering dozens of sine waves at different frequencies, amplitudes, and phases. Computationally expensive but produces very clean, controllable tones.
- Best for: bells, chimes, ethereal magic effects, UI notification tones

**FM Synthesis (Frequency Modulation)**
One oscillator modulates the frequency of another, producing complex harmonics from just two oscillators. Extremely CPU-efficient for metallic, bell-like, and evolving tones.
- Components: carrier oscillator + modulator oscillator + modulation depth gain
- Best for: metallic hits, bell tones, sci-fi effects, evolving textures

**Granular Synthesis**
Chops audio into tiny fragments ("grains", 1-50ms) that can be rearranged, stretched, layered, and pitch-shifted. Bridges the gap between synthesis and sample playback.
- Best for: ambient textures, morphing between sound states, wind/water/fire

**Physical Modeling**
Simulates actual physical properties -- string tension, body resonance, material hardness, air column length. Computationally expensive but produces the most realistic results.
- Best for: realistic instruments, collision sounds that respond to material properties
- Example: sword whoosh modeled as air turbulence along a moving edge

**Sample-Based Hybrid**
Uses tiny recorded samples as raw material, then applies procedural pitch shifting, layering, filtering, and envelope shaping at runtime. Gives the organic quality of recorded audio with the variation of procedural systems.
- Best for: when pure synthesis sounds too artificial (footsteps, voices, organic sounds)

---

## 2. Web Audio API Capabilities

The Web Audio API provides a complete audio processing graph that runs on a dedicated high-priority thread, independent of JavaScript execution. This is critical for game audio -- sounds play on time even when the main thread is busy rendering.

### Core Node Types

| Node | Purpose | Game Use |
|------|---------|----------|
| `OscillatorNode` | Generates sine, square, sawtooth, triangle waves | Tones, sweeps, FM synthesis |
| `GainNode` | Volume control with automation | ADSR envelopes, ducking, fades |
| `BiquadFilterNode` | Lowpass, highpass, bandpass, notch, allpass, peaking, lowshelf, highshelf | Sound shaping, warmth, brightness |
| `AudioBufferSourceNode` | Plays audio buffers (including generated noise) | White/pink noise, sample playback |
| `StereoPannerNode` | Simple left/right panning (-1 to 1) | Positional audio for 2D games |
| `PannerNode` | Full 3D spatialization with HRTF | 3D positional audio |
| `ConvolverNode` | Convolution reverb using impulse responses | Room/environment acoustics |
| `DynamicsCompressorNode` | Prevents clipping, levels the mix | Master bus protection (Lanecraft already uses this) |
| `WaveShaperNode` | Arbitrary nonlinear distortion curves | Overdrive, saturation, warmth |
| `DelayNode` | Delay line (0-179 seconds) | Echo, flange, chorus, comb filter |
| `AnalyserNode` | FFT analysis, waveform visualization | Debug tools, reactive visuals |
| `AudioWorkletNode` | Custom DSP in a dedicated thread | Advanced synthesis, custom effects |

### AudioParam Automation

The real power of Web Audio for game audio is `AudioParam` automation. Every node parameter (frequency, gain, filter cutoff) supports:

```typescript
// Instant set
param.setValueAtTime(value, time);
// Linear ramp (good for fades)
param.linearRampToValueAtTime(targetValue, endTime);
// Exponential ramp (good for natural decays -- value must be > 0)
param.exponentialRampToValueAtTime(targetValue, endTime);
// Exponential decay toward target
param.setTargetAtTime(target, startTime, timeConstant);
// Arbitrary automation curve
param.setValueCurveAtTime(Float32Array, startTime, duration);
```

These schedule on the audio thread's clock (`AudioContext.currentTime`), which is far more precise than `setTimeout` -- critical for game audio where >20ms latency is perceptible.

### AudioContext Best Practices

- **One context per document**: Creating AudioContext objects is expensive (spawns a high-priority thread). Use a singleton pattern. Lanecraft already does this correctly in `SoundManager.ctx()`.
- **Interactive latency hint**: `new AudioContext({ latencyHint: 'interactive' })` optimizes for low-latency game audio.
- **Suspended state handling**: Browsers require a user gesture before audio plays. Lanecraft handles this with the `resume()` call in `ctx()`.
- **Node disposal**: Source nodes are one-shot -- create, connect, start, let them garbage collect after `stop()`. Gain nodes and filters can be reused.

---

## 3. AI and Procedural SFX Generation

### Current State of AI SFX Tools

**ElevenLabs Sound Effects V2 (2025)**
- Text-to-SFX: describe a sound in natural language, get audio back
- Up to 30 seconds, 48kHz professional quality, seamless looping support
- API available for batch generation; all output is royalty-free
- Useful for: pre-generating sample libraries to ship with a game, NOT for runtime generation

**Stability Audio / AudioCraft (Meta)**
- Open-source models for audio generation from text prompts
- Heavyweight models requiring GPU inference
- Useful for: offline asset creation pipelines

**GameSynth (Tsugi)**
- Dedicated procedural audio middleware with specialized modules: Whoosh, Impact, Retro, Particles, Footsteps, Weather, Voice FX
- Can export to runtime parameters or baked audio
- Professional tool used by AAA studios

### Runtime AI Audio: Not Practical Yet

Current AI audio models are too computationally expensive for real-time browser synthesis. A single SFX generation call takes 1-10 seconds on a GPU. For browser games, the approach is:

1. **Design time**: Use AI tools to rapidly prototype sound ideas, or generate sample libraries
2. **Runtime**: Use Web Audio API procedural synthesis (what Lanecraft already does)
3. **Hybrid**: Pre-generate a small pool of AI samples, then apply procedural variation at runtime (pitch, filter, layering)

The practical path for Lanecraft remains pure Web Audio API synthesis, which is already implemented and ships zero audio assets.

---

## 4. Best Practices for RTS/Strategy Game Audio

### Sound Priority Hierarchy

For an RTS like Lanecraft, sounds serve distinct functions ranked by importance:

**Tier 1: Critical Feedback (must always play)**
- HQ under attack / low HP warning
- Match start / match end
- Nuke incoming / detonation
- Diamond objectives

**Tier 2: Player Action Feedback (play unless overwhelmed)**
- Building placement confirmation
- Upgrade completion
- Unit production (spawn)
- Ability activation

**Tier 3: Combat Atmosphere (throttled in large battles)**
- Melee hits
- Ranged projectile impacts
- Tower fire
- Unit death

**Tier 4: Ambient/Environmental (lowest priority)**
- Weather audio
- Background atmosphere
- Resource ticking

### RTS-Specific Audio Design Principles

1. **UI sounds are heard most**: Button clicks, menu navigation, and building placement sounds repeat thousands of times per session. They must be short, non-fatiguing, and satisfying.

2. **Combat sounds need aggressive throttling**: In a 4v4 with 200+ units, hundreds of melee hits happen per second. Without cooldowns, the mix becomes noise. Lanecraft already implements per-category cooldowns with `shouldPlay()`.

3. **Alerts must cut through**: Warning sounds (HQ damaged, nuke incoming) need to be spectrally distinct from combat -- use higher frequencies, different timbres, or brief silence before the alert.

4. **Spatial audio provides tactical information**: Hearing combat to the left tells the player which lane is under pressure without looking. Lanecraft's `spatialPan()` and `spatialGain()` already implement this.

5. **Music must duck for important events**: When a nuke detonates or the HQ is under attack, music volume should temporarily decrease so the player hears the alert clearly.

---

## 5. Procedural SFX Synthesis Recipes

Each recipe below uses only Web Audio API primitives. Parameters are starting points -- randomize them for variation (see Section 6).

### 5.1 Sword / Melee Hits

Melee impacts combine a short noise burst (the "thwack") with a brief low-frequency punch (the "weight").

```typescript
function playMeleeHit(volume: number, dest: GainNode) {
  const ac = ctx();
  const t = ac.currentTime;

  // Layer 1: Noise burst (the impact texture)
  // Short bandpass-filtered noise, 800-2000Hz
  const noiseDur = 0.06 + Math.random() * 0.03;
  filteredNoise(noiseDur, volume * 0.4, dest, 1200 + Math.random() * 600, 2);

  // Layer 2: Low thump (the weight)
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120 + Math.random() * 40, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.08);
  g.gain.setValueAtTime(volume * 0.3, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  osc.connect(g); g.connect(dest);
  osc.start(t); osc.stop(t + 0.12);

  // Layer 3: High transient click (optional, for metallic weapons)
  const click = ac.createOscillator();
  const cg = ac.createGain();
  click.type = 'square';
  click.frequency.value = 3000 + Math.random() * 1500;
  cg.gain.setValueAtTime(volume * 0.15, t);
  cg.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
  click.connect(cg); cg.connect(dest);
  click.start(t); click.stop(t + 0.03);
}
```

**Variations by race:**
- Crown: Add metallic high click (square wave ~3-5kHz, 20ms)
- Horde: Heavier low thump (start freq 80Hz, longer decay 0.15s)
- Wild: Shorter, sharper (noise at higher Q, shorter duration)
- Oozlings: Wet squelch (lowpass filter on noise, lower freq center 600Hz)

### 5.2 Arrow / Projectile Sounds

Projectile sounds have two parts: launch (twang/whoosh) and impact (thud). In an RTS, usually only the impact matters since individual launch sounds are lost in the mix.

```typescript
function playRangedHit(volume: number, dest: GainNode) {
  const ac = ctx();
  const t = ac.currentTime;

  // Whoosh: descending bandpass noise
  const noiseDur = 0.08;
  // Use a frequency sweep on the filter for "incoming" feel
  filteredNoise(noiseDur, volume * 0.25, dest, 2500, 3);

  // Impact: short mid-frequency thud
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(200, t + 0.02);
  osc.frequency.exponentialRampToValueAtTime(60, t + 0.08);
  g.gain.setValueAtTime(volume * 0.2, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  osc.connect(g); g.connect(dest);
  osc.start(t + 0.02); osc.stop(t + 0.12);
}
```

### 5.3 Explosions / Impacts

Explosions layer low-frequency oscillator punch with shaped noise. Larger explosions use longer durations and lower frequencies.

```typescript
function playExplosion(volume: number, dest: GainNode, size: 'small' | 'medium' | 'large') {
  const ac = ctx();
  const t = ac.currentTime;
  const sizeMult = size === 'large' ? 1.5 : size === 'medium' ? 1.0 : 0.6;

  // Layer 1: Sub-bass punch
  const sub = ac.createOscillator();
  const sg = ac.createGain();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(80 * sizeMult, t);
  sub.frequency.exponentialRampToValueAtTime(20, t + 0.3 * sizeMult);
  sg.gain.setValueAtTime(volume * 0.5, t);
  sg.gain.exponentialRampToValueAtTime(0.001, t + 0.4 * sizeMult);
  sub.connect(sg); sg.connect(dest);
  sub.start(t); sub.stop(t + 0.5 * sizeMult);

  // Layer 2: Midrange body (sawtooth for harmonic richness)
  const body = ac.createOscillator();
  const bg = ac.createGain();
  const bf = ac.createBiquadFilter();
  body.type = 'sawtooth';
  body.frequency.setValueAtTime(120, t);
  body.frequency.exponentialRampToValueAtTime(30, t + 0.2 * sizeMult);
  bf.type = 'lowpass';
  bf.frequency.value = 600;
  bg.gain.setValueAtTime(volume * 0.3, t);
  bg.gain.exponentialRampToValueAtTime(0.001, t + 0.3 * sizeMult);
  body.connect(bf); bf.connect(bg); bg.connect(dest);
  body.start(t); body.stop(t + 0.4 * sizeMult);

  // Layer 3: Noise crackle (the debris/shrapnel texture)
  filteredNoise(0.25 * sizeMult, volume * 0.35, dest, 1500, 0.8);

  // Layer 4: High transient (the initial "crack")
  filteredNoise(0.02, volume * 0.5, dest, 5000, 4);
}
```

### 5.4 Building Construction / Placement

Construction sounds combine a satisfying "thunk" with a brief harmonic confirmation tone.

```typescript
function playBuildingPlaced(volume: number, dest: GainNode) {
  const ac = ctx();
  const t = ac.currentTime;

  // Wooden thunk
  const thunk = ac.createOscillator();
  const tg = ac.createGain();
  thunk.type = 'triangle';
  thunk.frequency.setValueAtTime(180, t);
  thunk.frequency.exponentialRampToValueAtTime(80, t + 0.1);
  tg.gain.setValueAtTime(volume * 0.3, t);
  tg.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  thunk.connect(tg); tg.connect(dest);
  thunk.start(t); thunk.stop(t + 0.2);

  // Confirmation chime (ascending two-note)
  note(440, 0.08, volume * 0.12, dest, 'triangle', 0.05);
  note(554, 0.1, volume * 0.1, dest, 'triangle', 0.1);

  // Subtle noise texture (construction dust)
  filteredNoise(0.12, volume * 0.08, dest, 3000, 1.5, 0.0);
}
```

### 5.5 UI Clicks / Confirms

UI sounds must be very short (20-60ms), clean, and non-fatiguing since players hear them hundreds of times.

```typescript
// Simple click: single short tone with fast decay
function playUIClick(volume: number, dest: GainNode) {
  const ac = ctx();
  const t = ac.currentTime;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'triangle';
  osc.frequency.value = 800 + Math.random() * 200;
  g.gain.setValueAtTime(volume * 0.15, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  osc.connect(g); g.connect(dest);
  osc.start(t); osc.stop(t + 0.05);
}

// Confirm: ascending two-tone with slight delay
function playUIConfirm(volume: number, dest: GainNode) {
  note(660, 0.06, volume * 0.12, dest, 'triangle', 0);
  note(880, 0.08, volume * 0.1, dest, 'triangle', 0.04);
}

// Cancel/back: descending two-tone
function playUICancel(volume: number, dest: GainNode) {
  note(660, 0.06, volume * 0.12, dest, 'triangle', 0);
  note(440, 0.08, volume * 0.1, dest, 'triangle', 0.04);
}
```

### 5.6 Magic / Spell Effects

Magic effects use FM synthesis and sweeps for otherworldly tones. Different spell schools use different frequency ranges and waveforms.

```typescript
// Fire spell: rising sweep + noise crackle
function playFireSpell(volume: number, dest: GainNode) {
  const ac = ctx();
  const t = ac.currentTime;

  // Whoosh: rising frequency sweep
  sweep(200, 1200, 0.2, volume * 0.2, dest, 'sawtooth');

  // Crackle: highpass noise burst
  filteredNoise(0.3, volume * 0.25, dest, 3000, 1.2);

  // Sub-thump on impact
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(100, t + 0.15);
  osc.frequency.exponentialRampToValueAtTime(30, t + 0.35);
  g.gain.setValueAtTime(0, t); // silent until impact
  g.gain.linearRampToValueAtTime(volume * 0.3, t + 0.15);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
  osc.connect(g); g.connect(dest);
  osc.start(t); osc.stop(t + 0.45);
}

// Ice/frost spell: descending shimmer + high sine cluster
function playFrostSpell(volume: number, dest: GainNode) {
  sweep(2000, 400, 0.25, volume * 0.15, dest, 'sine');
  sweep(2200, 500, 0.22, volume * 0.1, dest, 'sine', 0.02);
  filteredNoise(0.15, volume * 0.12, dest, 6000, 5);  // sparkle
}

// Heal/nature spell: warm ascending chord
function playHealSpell(volume: number, dest: GainNode) {
  note(262, 0.3, volume * 0.1, dest, 'sine', 0);     // C4
  note(330, 0.25, volume * 0.08, dest, 'sine', 0.05); // E4
  note(392, 0.2, volume * 0.08, dest, 'sine', 0.1);   // G4
  note(523, 0.15, volume * 0.06, dest, 'sine', 0.15); // C5
}

// Shadow/death spell: dissonant low tones + noise
function playShadowSpell(volume: number, dest: GainNode) {
  sweep(300, 80, 0.3, volume * 0.2, dest, 'sawtooth');
  sweep(310, 85, 0.28, volume * 0.15, dest, 'sawtooth', 0.01); // detune for dissonance
  filteredNoise(0.2, volume * 0.2, dest, 500, 0.5);
}
```

### 5.7 Death / Destruction

Unit death uses a brief descending tone + noise. Building destruction is a longer, heavier version.

```typescript
function playUnitDeath(volume: number, dest: GainNode) {
  const ac = ctx();
  const t = ac.currentTime;

  // Descending pitch = "falling"
  sweep(400, 100, 0.15, volume * 0.2, dest, 'triangle');

  // Soft noise puff
  filteredNoise(0.1, volume * 0.15, dest, 1000, 1.5);
}

function playBuildingDestroyed(volume: number, dest: GainNode) {
  const ac = ctx();
  const t = ac.currentTime;

  // Heavy crunch: layered noise at different bands
  filteredNoise(0.3, volume * 0.3, dest, 400, 0.5);   // low rumble
  filteredNoise(0.2, volume * 0.25, dest, 2000, 1.5);  // midrange crackle
  filteredNoise(0.1, volume * 0.15, dest, 5000, 3);    // high debris

  // Descending bass
  sweep(120, 30, 0.4, volume * 0.3, dest, 'sine');

  // Structural groan
  sweep(200, 60, 0.35, volume * 0.15, dest, 'sawtooth');
}
```

### 5.8 Resource Collection

Short, pleasant, non-intrusive confirmations.

```typescript
// Gold collected: metallic chime
function playGoldCollect(volume: number, dest: GainNode) {
  note(1047, 0.06, volume * 0.08, dest, 'triangle', 0);    // C6
  note(1319, 0.08, volume * 0.06, dest, 'triangle', 0.03); // E6
}

// Wood collected: soft thunk
function playWoodCollect(volume: number, dest: GainNode) {
  const ac = ctx();
  const t = ac.currentTime;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(250, t);
  osc.frequency.exponentialRampToValueAtTime(120, t + 0.06);
  g.gain.setValueAtTime(volume * 0.1, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  osc.connect(g); g.connect(dest);
  osc.start(t); osc.stop(t + 0.1);
}

// Meat collected: wet slap
function playMeatCollect(volume: number, dest: GainNode) {
  filteredNoise(0.05, volume * 0.1, dest, 800, 2);
  note(180, 0.04, volume * 0.06, dest, 'sine');
}
```

### 5.9 Ambient / Environmental

Ambient sounds use looping noise buffers shaped by filters and modulated by LFOs.

```typescript
// Wind: lowpass-filtered noise with LFO modulating the cutoff
function createWindAmbient(volume: number, dest: GainNode) {
  const ac = ctx();
  const noiseBuffer = createWhiteNoiseBuffer(ac, 2); // 2 seconds, looped
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;

  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 400;
  filter.Q.value = 0.5;

  // LFO modulates filter cutoff for "gusting" effect
  const lfo = ac.createOscillator();
  const lfoGain = ac.createGain();
  lfo.type = 'sine';
  lfo.frequency.value = 0.15; // slow modulation
  lfoGain.gain.value = 300;   // sweep range in Hz
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);

  const g = ac.createGain();
  g.gain.value = volume * 0.05;

  src.connect(filter);
  filter.connect(g);
  g.connect(dest);
  src.start();
  lfo.start();

  return { stop: () => { src.stop(); lfo.stop(); } };
}

// Rain: bandpass noise at ~2500Hz
// Already implemented in Lanecraft's SoundManager.startWeatherNoise()
```

### 5.10 Alert / Notification Sounds

Alerts must be spectrally distinct from combat sounds. Use higher frequencies, clear tones, and recognizable patterns.

```typescript
// Urgent warning (HQ under attack): rapid alternating high tones
function playUrgentAlert(volume: number, dest: GainNode) {
  for (let i = 0; i < 3; i++) {
    note(880, 0.06, volume * 0.2, dest, 'square', i * 0.12);
    note(1100, 0.06, volume * 0.15, dest, 'square', i * 0.12 + 0.06);
  }
}

// Upgrade complete: triumphant ascending triad
function playUpgradeComplete(volume: number, dest: GainNode) {
  note(523, 0.12, volume * 0.15, dest, 'triangle', 0);    // C5
  note(659, 0.12, volume * 0.12, dest, 'triangle', 0.08); // E5
  note(784, 0.15, volume * 0.12, dest, 'triangle', 0.16); // G5
  // Shimmer
  filteredNoise(0.15, volume * 0.05, dest, 6000, 8, 0.16);
}

// Nuke incoming: descending siren
function playNukeSiren(volume: number, dest: GainNode) {
  sweep(1200, 400, 0.6, volume * 0.3, dest, 'sawtooth');
  sweep(1100, 350, 0.6, volume * 0.2, dest, 'sawtooth', 0.05); // slight detune
}
```

---

## 6. Variation and Anti-Repetition

### The Problem

Players are extremely sensitive to repeated identical sounds -- it breaks immersion immediately. In real life, no two sword strikes sound the same. The human ear detects repetition after just 2-3 identical playbacks.

### Techniques

**1. Pitch Randomization**
The simplest and most effective technique. Vary the base frequency by +/- 3-8%.

```typescript
// Lanecraft already implements this:
private pitchVar(range = 0.06): number {
  return 1 + (Math.random() - 0.5) * range * 2;
}

// Usage: multiply base frequencies by pitchVar()
osc.frequency.value = 120 * this.pitchVar();
```

**2. Duration Variation**
Randomize envelope timings by 10-20%:

```typescript
const baseDuration = 0.1;
const duration = baseDuration * (0.9 + Math.random() * 0.2);
```

**3. Layer Selection**
With 3 layers per sound, randomly omitting or attenuating one layer creates variation:

```typescript
// 70% chance to include the metallic click layer
if (Math.random() > 0.3) {
  filteredNoise(0.02, volume * 0.15, dest, 4000, 5);
}
```

**4. Filter Variation**
Randomize filter cutoff and Q to change timbre:

```typescript
filter.frequency.value = 1200 + Math.random() * 800; // 1200-2000Hz
filter.Q.value = 1.5 + Math.random() * 2;            // 1.5-3.5
```

**5. Gain Variation**
Subtle volume differences (5-15%) prevent the "machine gun" effect:

```typescript
const gainVar = 0.85 + Math.random() * 0.3; // 0.85 to 1.15
g.gain.setValueAtTime(volume * 0.3 * gainVar, t);
```

**6. Start Time Jitter**
Offset layers by 0-10ms for a less "perfect" attack:

```typescript
const jitter = Math.random() * 0.01; // 0-10ms
osc.start(t + jitter);
```

### Combinatorial Explosion

With just 5 varied parameters (pitch, duration, layer selection, filter, gain), even 3 discrete values per parameter yields 3^5 = 243 unique combinations. This is more than enough to prevent perceptible repetition.

### Round-Robin for Heavier Sounds

For sounds that benefit from more dramatic variation (building destruction, large explosions), maintain a small rotation:

```typescript
private explosionVariant = 0;

playExplosion(volume: number, dest: GainNode) {
  this.explosionVariant = (this.explosionVariant + 1) % 3;
  switch (this.explosionVariant) {
    case 0: // More bass-heavy
      // emphasize sub layer, reduce crackle
      break;
    case 1: // More debris-heavy
      // emphasize noise layers, reduce bass
      break;
    case 2: // Balanced
      // standard recipe
      break;
  }
}
```

---

## 7. Performance Considerations

### CPU Budget

Web Audio runs on a separate thread from JavaScript, so synthesis does not block rendering or simulation. However, each active `OscillatorNode` or `AudioBufferSourceNode` consumes audio thread CPU. Guidelines:

| Concurrent Sources | Impact |
|---|---|
| 1-20 | Negligible |
| 20-50 | Fine on modern hardware |
| 50-100 | May cause glitches on mobile |
| 100+ | Likely to cause dropouts |

### Optimization Strategies

**1. Throttle concurrent sounds** (already implemented in Lanecraft)
```typescript
// Per-category cooldowns prevent audio spam
private shouldPlay(category: string, minIntervalMs: number, maxPerBatch: number): boolean
```

**2. Cache noise buffers** (already implemented in Lanecraft)
Generating white noise buffers is O(n) per sample. Cache by buffer size:
```typescript
private noiseBufferCache = new Map<number, AudioBuffer>();
```

**3. Short durations**
Keep SFX under 500ms. Shorter sounds = nodes get garbage collected sooner = fewer concurrent sources.

**4. Spatial culling** (already implemented in Lanecraft)
Don't play sounds that are off-screen or too far from the camera:
```typescript
const v = this.spatialGain(event.x, event.y, camera, canvas);
if (v < 0.01) return; // too far away, skip entirely
```

**5. Avoid AudioWorklet for simple SFX**
AudioWorkletNode gives full DSP control but has higher overhead than built-in nodes. Use built-in nodes (Oscillator, BiquadFilter, Gain) whenever possible.

**6. Disconnect and release nodes**
Nodes that have stopped playing should be disconnected. Calling `stop()` on an OscillatorNode automatically marks it for GC, but intermediate nodes (GainNode, BiquadFilter) connected only to stopped sources should also be disconnected or will leak.

For Lanecraft's architecture where gain nodes are created per-sound with `spatialDest()`: these chain to the master bus, and once all sources feeding them stop, they become eligible for GC. The pattern is already correct.

**7. Use DynamicsCompressor on master bus** (already implemented)
This prevents clipping when many sounds play simultaneously without needing to carefully manage individual volumes:
```typescript
const comp = this.actx.createDynamicsCompressor();
comp.threshold.value = -18;
comp.knee.value = 12;
comp.ratio.value = 8;
```

**8. Limit weather/ambient to minimal node count**
Lanecraft's weather audio uses a single looping noise buffer + filter + LFO, which is efficient (3-4 active nodes regardless of weather intensity).

### Mobile Considerations

- iOS Safari limits concurrent audio sources more aggressively
- AudioContext must be created/resumed from a user gesture (tap handler)
- Keep total concurrent source count under 30 on mobile
- Prefer shorter durations (under 200ms for combat SFX)

---

## 8. Spatial Audio

### For 2D Strategy Games

Full 3D spatialization (PannerNode with HRTF) is overkill for a top-down RTS. Lanecraft's current approach is correct:

**StereoPannerNode for left/right panning**
```typescript
// Map world X position to [-0.7, 0.7] pan range
// Capped at 0.7 to avoid hard left/right which sounds unnatural
private spatialPan(worldTileX: number | undefined, camera: Camera, canvas: HTMLCanvasElement): number {
  const camCX = (camera.x + canvas.clientWidth / (2 * camera.zoom)) / TILE_SIZE;
  const visW = canvas.clientWidth / (camera.zoom * TILE_SIZE);
  const offset = (worldTileX - camCX) / (visW / 2);
  return Math.max(-0.7, Math.min(0.7, offset));
}
```

**Distance-based volume attenuation**
```typescript
// Full volume within viewport, linear fade to silence at 1.5x viewport radius
if (dist <= fadeStart) return 1;
if (dist >= fadeEnd) return 0;
return 1 - (dist - fadeStart) / (fadeEnd - fadeStart);
```

### Enhancement Opportunities

**1. Vertical panning for portrait maps**
On Duel maps (portrait orientation), top-of-map events could have slightly different EQ (higher frequencies attenuated for "farther" feel) even though they're not panned left/right.

**2. Combat density detection**
When many combat sounds come from one area, slightly boost that area's volume and pan it more distinctly to draw attention.

**3. Minimap click audio cue**
When the player clicks the minimap to jump camera, a brief spatial "whoosh" in the direction of travel helps orient.

---

## 9. Music + SFX Integration

### Bus Architecture

Lanecraft already has a good bus structure:

```
AudioContext
  └── DynamicsCompressor (master limiter)
       ├── masterGain (SFX bus)
       │    ├── per-sound spatialDest nodes
       │    └── weatherGain (ambient sub-bus)
       └── musicGain (music bus)
            ├── padGain
            ├── arpGain
            ├── rhythmGain
            └── warningGain
```

### Ducking Implementation

When critical events occur, temporarily lower music volume so alerts cut through:

```typescript
// Ducking pattern: reduce music by 50% for 1 second on critical events
function duckMusic(musicGain: GainNode, duckAmount = 0.5, duckDuration = 1.0) {
  const ac = musicGain.context;
  const t = ac.currentTime;
  const currentVol = musicGain.gain.value;

  musicGain.gain.cancelScheduledValues(t);
  musicGain.gain.setValueAtTime(currentVol, t);
  musicGain.gain.linearRampToValueAtTime(currentVol * duckAmount, t + 0.05); // fast duck
  musicGain.gain.setValueAtTime(currentVol * duckAmount, t + duckDuration);
  musicGain.gain.linearRampToValueAtTime(currentVol, t + duckDuration + 0.3); // slow restore
}
```

**When to duck:**
- Nuke incoming / detonation: heavy duck (30% music volume, 2 seconds)
- HQ under attack: moderate duck (50%, 1 second)
- Match start/end: full duck (10%, 3 seconds)
- Building destroyed: light duck (70%, 0.5 seconds)

### Intensity-Based Mixing

Lanecraft's music system already responds to combat intensity (calm/action/critical). The SFX layer should complement this:

- **Calm**: SFX at full volume, they're sparse and each one matters
- **Action**: SFX throttled more aggressively, music louder
- **Critical**: Warning sounds boosted, combat SFX heavily throttled, music at maximum intensity

### Frequency Separation

Music and SFX should occupy different frequency bands to avoid masking:

| Element | Primary Frequency Range |
|---------|------------------------|
| Music pads | 100-400 Hz |
| Music arps | 400-2000 Hz |
| Music rhythm | 60-200 Hz (kick), 2000-8000 Hz (hi-hat) |
| Combat SFX | 100-3000 Hz |
| UI SFX | 600-2000 Hz |
| Alerts | 800-1200 Hz (distinct from combat) |
| Ambient weather | 200-5000 Hz (broadband but quiet) |

When designing new SFX, check that their primary energy doesn't collide with the music pads (which are always playing). Using triangle waves instead of sawtooth for SFX reduces harmonic overlap with sawtooth-heavy music (Horde, Demon races).

---

## Appendix A: Lanecraft's Current Audio Architecture

Lanecraft already implements a sophisticated procedural audio system in `src/audio/SoundManager.ts` (~1100 lines). Key features already in place:

- **Singleton AudioContext** with DynamicsCompressor on master bus
- **Per-race procedural music** with 9 unique profiles (chord progressions, BPM, instrument types)
- **Adaptive music intensity** (calm/action/critical) driven by game state
- **20+ procedural SFX** for combat, abilities, buildings, objectives, match events
- **Spatial audio**: distance-based attenuation + stereo panning
- **Per-category throttling**: prevents audio spam in large battles
- **Weather audio system**: procedural rain, wind, snow, sandstorm, thunder
- **Noise buffer caching**: avoids redundant buffer generation
- **Pitch randomization**: `pitchVar()` utility for natural variation
- **Helper methods**: `note()`, `sweep()`, `filteredNoise()`, `padTone()`, `kick()`, `tom()`, `noiseAt()`

## Appendix B: Recommended Libraries

| Library | Size | Use Case |
|---------|------|----------|
| **None (raw Web Audio)** | 0 KB | Lanecraft's current approach. Maximum control, zero dependencies. |
| **Tone.js** | ~150 KB | Full DAW-like framework. Overkill for SFX but excellent for complex music. |
| **jsfxr** | ~10 KB | Retro 8-bit sound presets. Good for prototyping, too lo-fi for Lanecraft's aesthetic. |
| **Pizzicato.js** | ~15 KB | Simplified Web Audio wrapper. Useful if raw API is too verbose. |
| **Howler.js** | ~30 KB | Sample playback manager (NOT synthesis). Would only help if Lanecraft switches to pre-recorded samples. |

**Recommendation**: Continue with raw Web Audio API. The existing `SoundManager.ts` already has the correct architecture and helper abstractions (`note()`, `sweep()`, `filteredNoise()`). Adding a library would increase bundle size without meaningful benefit.

---

## Sources

- [Procedural Sound Effects in Games - Sonorous Arts](https://www.sonorousarts.com/blog/procedural-sound-effects-in-games/)
- [Procedural Audio in Video Games - Splice](https://splice.com/blog/procedural-audio-video-games/)
- [Procedural Audio Effects in JavaScript with Web Audio API - DEV Community](https://dev.to/hexshift/how-to-create-procedural-audio-effects-in-javascript-with-web-audio-api-199e)
- [Procedural Audio Textures in the Browser - DEV Community](https://dev.to/hexshift/how-to-generate-procedural-audio-textures-in-the-browser-no-samples-needed-332l)
- [Web Audio API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [Web Audio API Best Practices - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)
- [Audio for Web Games - MDN](https://developer.mozilla.org/en-US/docs/Games/Techniques/Audio_for_Web_Games)
- [Web Audio Spatialization Basics - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Web_audio_spatialization_basics)
- [Developing Game Audio with Web Audio API - web.dev](https://web.dev/articles/webaudio-games)
- [Synthesising Sounds with Web Audio API - Sonoport](https://sonoport.github.io/synthesising-sounds-webaudio.html)
- [Generate Sounds Programmatically with JavaScript - marcgg](https://marcgg.com/blog/2016/11/01/javascript-audio/)
- [Web Audio API for TypeScript Games - GameMug](https://gamemug.com/typescript-games/web-audio-api.html)
- [Procedural Audio Generation Explained - SFXEngine](https://sfxengine.com/blog/procedural-audio-generation-explained)
- [Procedural Audio Guide for Game Developers - Creator Sounds Pro](https://creatorsoundspro.com/understanding-procedural-audio-a-simple-deep-guide-for-modern-game-developers/)
- [Sound Design for Strategy Games - Number Analytics](https://www.numberanalytics.com/blog/ultimate-guide-to-sound-for-strategy-games)
- [Game Audio Theory: Ducking - Gamedeveloper](https://www.gamedeveloper.com/audio/game-audio-theory-ducking)
- [Dynamic Game Audio Mix - Splice](https://splice.com/blog/dynamic-game-audio-mix/)
- [ElevenLabs Sound Effects](https://elevenlabs.io/sound-effects)
- [ElevenLabs Game Audio Tools](https://elevenlabs.io/blog/best-aaa-video-game-sound-effects-tools-2024-enhance-your-game-design)
- [jsfxr - 8-bit Sound Maker](https://sfxr.me/)
- [Tone.js - Web Audio Framework](https://tonejs.github.io/)
- [GameSynth - Procedural Audio Middleware](https://tsugi-studio.com/web/en/products-gamesynth.html)
- [GDC Vault - Procedural Audio for Video Games](https://www.gdcvault.com/play/1012645)
- [Procedural Sound Now! - Gamedeveloper](https://www.gamedeveloper.com/audio/procedural-sound-now-)
- [Web Audio API Performance Notes - Paul Adenot](https://padenot.github.io/web-audio-perf/)
- [Web Audio API Book - Boris Smus](https://webaudioapi.com/book/Web_Audio_API_Boris_Smus_html/ch06.html)
- [Noise Generation with Web Audio API - Noisehack](https://noisehack.com/generate-noise-web-audio-api/)
