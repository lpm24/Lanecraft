/**
 * VisualEffects — day/night cycle, weather, ambient particles, screen shake, shadows.
 * Pure rendering state — no simulation dependency. Driven by elapsed real time + match tick.
 */

import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE, Race, CombatEvent } from '../simulation/types';

const T = TILE_SIZE;

// ─── Day / Night Cycle ───────────────────────────────────────

/** Full day cycle = 4 real-time minutes */
const DAY_CYCLE_SECONDS = 240;

export interface DayNightState {
  /** 0–1 progress through cycle: 0=dawn, 0.25=noon, 0.5=dusk, 0.75=midnight */
  phase: number;
  /** Overlay tint rgba string */
  tint: string;
  /** Tint alpha (0 = no tint) */
  tintAlpha: number;
  /** Shadow angle in radians (sun position) */
  shadowAngle: number;
  /** Shadow length multiplier (0 at noon, 1.5 at dawn/dusk) */
  shadowLength: number;
  /** Ambient brightness 0–1 */
  brightness: number;
}

export function getDayNight(elapsedSec: number): DayNightState {
  const phase = (elapsedSec % DAY_CYCLE_SECONDS) / DAY_CYCLE_SECONDS;

  // Sun angle: sweeps from left (dawn) to overhead (noon) to right (dusk)
  // phase 0=dawn(left), 0.25=noon(overhead), 0.5=dusk(right), 0.75=midnight
  const sunAngle = Math.PI * (phase * 2 - 0.5); // -π/2 at dawn, π/2 at dusk
  const shadowAngle = sunAngle + Math.PI; // opposite of sun

  // Shadow length: longest at dawn/dusk, shortest at noon
  const noonDist = Math.abs(phase < 0.5 ? phase - 0.25 : 0.75 - phase);
  const shadowLength = phase >= 0.5 ? 1.2 : Math.min(1.5, noonDist * 6);

  // Brightness curve: bright during day, dim at night
  let brightness: number;
  if (phase < 0.05) brightness = 0.6 + phase * 8; // dawn transition
  else if (phase < 0.45) brightness = 1.0;         // day
  else if (phase < 0.55) brightness = 1.0 - (phase - 0.45) * 6; // dusk transition
  else if (phase < 0.95) brightness = 0.4;         // night
  else brightness = 0.4 + (phase - 0.95) * 12;     // pre-dawn

  // Tint color based on time of day
  let r: number, g: number, b: number, a: number;
  if (phase < 0.05) {
    // Dawn: warm orange
    r = 255; g = 180; b = 100; a = 0.15 * (1 - phase / 0.05);
  } else if (phase < 0.2) {
    // Morning: slight warm
    r = 255; g = 240; b = 200; a = 0.05;
  } else if (phase < 0.35) {
    // Midday: neutral
    r = 0; g = 0; b = 0; a = 0;
  } else if (phase < 0.5) {
    // Afternoon/dusk: warm orange-red
    const t = (phase - 0.35) / 0.15;
    r = 255; g = 140; b = 60; a = t * 0.2;
  } else if (phase < 0.55) {
    // Dusk transition: blue-purple
    const t = (phase - 0.5) / 0.05;
    r = 40; g = 30; b = 80; a = t * 0.35;
  } else if (phase < 0.95) {
    // Night: dark blue
    r = 15; g = 15; b = 50; a = 0.35;
  } else {
    // Pre-dawn
    const t = (phase - 0.95) / 0.05;
    r = Math.round(15 + 240 * t); g = Math.round(15 + 165 * t); b = Math.round(50 + 50 * t);
    a = 0.35 * (1 - t) + 0.15 * t;
  }

  return {
    phase,
    tint: `rgba(${r},${g},${b},${a})`,
    tintAlpha: a,
    shadowAngle,
    shadowLength,
    brightness,
  };
}

// ─── Screen Shake ────────────────────────────────────────────

export class ScreenShake {
  private intensity = 0;
  private decay = 0;
  private elapsed = 0;
  offsetX = 0;
  offsetY = 0;

  trigger(intensity: number, durationSec: number): void {
    this.intensity = intensity;
    this.decay = intensity / durationSec;
    this.elapsed = 0;
  }

  update(dt: number): void {
    if (this.intensity <= 0) {
      this.offsetX = 0;
      this.offsetY = 0;
      return;
    }
    this.elapsed += dt;
    this.intensity = Math.max(0, this.intensity - this.decay * dt);
    // High-frequency shake with decaying amplitude
    const freq = 30;
    this.offsetX = Math.sin(this.elapsed * freq * 2 * Math.PI) * this.intensity;
    this.offsetY = Math.cos(this.elapsed * freq * 1.7 * Math.PI) * this.intensity * 0.7;
  }

  get active(): boolean { return this.intensity > 0; }
}

// ─── Weather System ──────────────────────────────────────────

export type WeatherType = 'clear' | 'overcast' | 'rain' | 'storm' | 'snow' | 'blizzard' | 'fog' | 'sandstorm';

/** Biome determines which weather types a map can produce */
export type WeatherBiome = 'temperate' | 'arctic' | 'desert' | 'swamp' | 'volcanic';

/** Valid transitions — weather can only move to adjacent states */
const WEATHER_TRANSITIONS: Record<WeatherType, WeatherType[]> = {
  'clear':     ['clear', 'overcast', 'fog'],
  'overcast':  ['clear', 'rain', 'snow', 'fog', 'overcast'],
  'rain':      ['overcast', 'storm', 'rain'],
  'storm':     ['rain', 'overcast'],
  'snow':      ['overcast', 'blizzard', 'snow'],
  'blizzard':  ['snow', 'overcast'],
  'fog':       ['clear', 'overcast'],
  'sandstorm': ['clear', 'overcast', 'sandstorm'],
};

/** Biome-specific weather weights — higher = more likely */
const BIOME_WEIGHTS: Record<WeatherBiome, Partial<Record<WeatherType, number>>> = {
  temperate: { clear: 5, overcast: 3, rain: 2, storm: 1, snow: 1, fog: 2 },
  arctic:    { clear: 1, overcast: 3, snow: 4, blizzard: 2, fog: 2 },
  desert:    { clear: 6, overcast: 1, sandstorm: 3 },
  swamp:     { clear: 1, overcast: 2, rain: 3, fog: 4, storm: 1 },
  volcanic:  { clear: 2, overcast: 4, storm: 2, fog: 1 },
};

interface WeatherDrop {
  x: number;
  y: number;
  speed: number;
  size: number;
  drift: number;
  alpha: number;
  layer: number; // 0=far, 1=mid, 2=near (depth)
  phase: number; // per-drop phase for snow flutter
}

interface RainSplash {
  x: number;
  y: number;
  age: number;
  maxAge: number;
  size: number;
}

/** Camera viewport for particle culling */
interface WeatherViewport {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Returns true if a drop uses particles (not just overlay) */
function isParticleWeather(type: WeatherType): boolean {
  return type === 'rain' || type === 'snow' || type === 'storm' || type === 'blizzard' || type === 'sandstorm';
}

export class WeatherSystem {
  type: WeatherType = 'clear';
  /** Current biome — set by Renderer from map definition */
  biome: WeatherBiome = 'temperate';
  private drops: WeatherDrop[] = [];
  private fadingDrops: WeatherDrop[] = []; // old drops fading out during transitions
  private fadingType: WeatherType = 'clear'; // what the fading drops were
  private fadingAlpha = 0; // 1→0 fade for old particles
  private splashes: RainSplash[] = [];
  private transitionAlpha = 0;
  private targetAlpha = 0;
  private nextChangeTime = 0;
  private fogPhase = 0;
  windStrength = 0;
  private windTarget = 0;
  private preWeatherWindTimer = 0; // seconds remaining for pre-weather wind cue
  lightningFlash = 0; // 0-1 flash intensity, decays rapidly
  private lightningCooldown = 0;
  private brightness = 1;
  mapW = MAP_WIDTH;
  mapH = MAP_HEIGHT;
  onLightning: (() => void) | null = null;
  private readonly _viewport: WeatherViewport = { x: 0, y: 0, w: 0, h: 0 };
  private viewportSet = false;

  /** Update camera viewport for particle culling (mutates in place) */
  setViewport(x: number, y: number, w: number, h: number): void {
    this._viewport.x = x; this._viewport.y = y;
    this._viewport.w = w; this._viewport.h = h;
    this.viewportSet = true;
  }

  // Fog gradient cache
  private fogGradCache: CanvasGradient[] = [];
  private fogGradMapW = 0;
  private fogGradMapH = 0;
  private fogGradBandYs: number[] = [];
  private fogGradType: WeatherType = 'clear'; // track type for cache invalidation

  // Vignette gradient cache
  private vignetteCache: CanvasGradient | null = null;
  private vignetteCacheW = 0;
  private vignetteCacheH = 0;
  private vignetteCacheType: WeatherType = 'clear';

  /** Call once per frame with dt in seconds */
  update(dt: number, elapsedSec: number, dayPhase: number, brightness = 1): void {
    this.brightness = brightness;

    // Auto-change weather every 45–100 seconds
    if (elapsedSec >= this.nextChangeTime) {
      this.pickWeather(dayPhase);
      this.nextChangeTime = elapsedSec + 45 + Math.random() * 55;
    }

    // Smooth transition — slower for more gradual feel
    this.targetAlpha = this.type === 'clear' ? 0 : (this.type === 'overcast' ? 0.6 : 1);
    this.transitionAlpha += (this.targetAlpha - this.transitionAlpha) * dt * 0.3;
    // Snap when very close
    if (Math.abs(this.transitionAlpha - this.targetAlpha) < 0.005) this.transitionAlpha = this.targetAlpha;

    // Fade out old drops during transitions
    if (this.fadingAlpha > 0.01) {
      this.fadingAlpha = Math.max(0, this.fadingAlpha - dt * 0.3);
      this.updateDropList(this.fadingDrops, dt, this.fadingType);
      if (this.fadingAlpha <= 0.01) {
        this.fadingDrops = [];
        this.fadingAlpha = 0;
      }
    }

    // Count down pre-weather wind timer
    if (this.preWeatherWindTimer > 0) this.preWeatherWindTimer = Math.max(0, this.preWeatherWindTimer - dt);

    // Wind gusts — slowly drift toward random targets
    if (this.preWeatherWindTimer > 0) {
      this.windTarget = (Math.random() > 0.5 ? 1 : -1) * (40 + Math.random() * 30);
    } else if (this.type === 'storm' || this.type === 'blizzard') {
      // Strong sustained wind during heavy weather
      if (Math.random() < dt * 0.5) this.windTarget = (Math.random() - 0.5) * 120;
    } else if (this.type === 'sandstorm') {
      // Very strong lateral wind for sandstorms
      if (Math.random() < dt * 0.4) this.windTarget = 60 + Math.random() * 80; // always blows right
    } else {
      if (Math.random() < dt * 0.3) this.windTarget = (Math.random() - 0.5) * 60;
    }
    this.windStrength += (this.windTarget - this.windStrength) * dt * 0.8;

    if (this.type === 'fog') this.fogPhase += dt * 0.3;
    if (isParticleWeather(this.type)) this.updateDropList(this.drops, dt, this.type);

    // Lightning during rain/storm (more frequent in storms)
    if (this.type === 'rain' || this.type === 'storm') {
      this.lightningCooldown -= dt;
      const lightningRate = this.type === 'storm' ? 0.2 : 0.08;
      const minCooldown = this.type === 'storm' ? 1.5 : 3;
      const cooldownRange = this.type === 'storm' ? 4 : 8;
      if (this.lightningCooldown <= 0 && Math.random() < dt * lightningRate) {
        this.lightningFlash = 0.8 + Math.random() * 0.2;
        this.lightningCooldown = minCooldown + Math.random() * cooldownRange;
        this.onLightning?.();
      }
    }
    if (this.lightningFlash > 0) this.lightningFlash = Math.max(0, this.lightningFlash - dt * 6);

    // Update splashes
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      this.splashes[i].age += dt;
      if (this.splashes[i].age >= this.splashes[i].maxAge) this.splashes.splice(i, 1);
    }
    if (this.splashes.length > 200) this.splashes.length = 200;
  }

  private pickWeather(dayPhase: number): void {
    const prevType = this.type;

    // Get valid transitions from current state
    const candidates = WEATHER_TRANSITIONS[this.type] || ['clear'];

    // Get biome weights
    const weights = BIOME_WEIGHTS[this.biome];

    // Night bias: prefer fog/snow over rain during night
    const nightBias = (dayPhase > 0.5 && dayPhase < 0.95) ? true : false;

    // Build weighted candidate list
    let totalWeight = 0;
    const weightedCandidates: { type: WeatherType; weight: number }[] = [];
    for (const c of candidates) {
      let w = weights[c] ?? 0;
      if (w <= 0) continue;
      // Night adjustments
      if (nightBias) {
        if (c === 'fog' || c === 'snow' || c === 'blizzard') w *= 1.5;
        if (c === 'clear') w *= 0.5;
      }
      weightedCandidates.push({ type: c, weight: w });
      totalWeight += w;
    }

    // Fallback if no valid candidates
    if (weightedCandidates.length === 0 || totalWeight <= 0) {
      this.type = 'clear';
    } else {
      // Weighted random pick
      let roll = Math.random() * totalWeight;
      this.type = weightedCandidates[weightedCandidates.length - 1].type;
      for (const wc of weightedCandidates) {
        roll -= wc.weight;
        if (roll <= 0) { this.type = wc.type; break; }
      }
    }

    // Pre-weather wind cue: if transitioning TO precipitation, start wind early
    if (!isParticleWeather(prevType) && isParticleWeather(this.type)) {
      this.preWeatherWindTimer = 3; // 3 seconds of wind buildup
    }

    // Graduated transition: move old drops to fading list instead of deleting
    if (this.drops.length > 0 && isParticleWeather(prevType)) {
      this.fadingDrops = this.drops;
      this.fadingType = prevType;
      this.fadingAlpha = this.transitionAlpha;
    }

    this.drops = [];
    this.splashes = [];
    if (isParticleWeather(this.type)) {
      this.spawnDrops(this.type);
    }
  }

  private spawnDrops(weatherType: WeatherType): void {
    const worldW = this.mapW * T;
    const worldH = this.mapH * T;

    let count: number;
    switch (weatherType) {
      case 'rain':      count = 600; break;
      case 'storm':     count = 900; break;
      case 'snow':      count = 300; break;
      case 'blizzard':  count = 700; break;
      case 'sandstorm': count = 500; break;
      default:          count = 300;
    }

    for (let i = 0; i < count; i++) {
      const layer = i < count * 0.3 ? 0 : i < count * 0.7 ? 1 : 2;
      const depthScale = 0.5 + layer * 0.25;

      let speed: number, size: number, drift: number;

      switch (weatherType) {
        case 'rain':
          speed = (250 + Math.random() * 200) * depthScale;
          size = (0.8 + Math.random() * 1.5) * depthScale;
          drift = -40 + Math.random() * 15;
          break;
        case 'storm':
          speed = (350 + Math.random() * 250) * depthScale;
          size = (1.0 + Math.random() * 2.0) * depthScale;
          drift = -60 + Math.random() * 20;
          break;
        case 'snow':
          speed = (15 + Math.random() * 25) * depthScale;
          size = (1.5 + Math.random() * 2.5) * depthScale;
          drift = (Math.random() - 0.5) * 15;
          break;
        case 'blizzard':
          speed = (30 + Math.random() * 45) * depthScale;
          size = (2.0 + Math.random() * 3.0) * depthScale;
          drift = -50 + Math.random() * 20; // strong diagonal
          break;
        case 'sandstorm':
          speed = (20 + Math.random() * 40) * depthScale; // slow fall
          size = (1.5 + Math.random() * 3.5) * depthScale;
          drift = 80 + Math.random() * 60; // strong horizontal
          break;
        default:
          speed = (15 + Math.random() * 25) * depthScale;
          size = (1.5 + Math.random() * 2.5) * depthScale;
          drift = (Math.random() - 0.5) * 15;
      }

      this.drops.push({
        x: Math.random() * worldW * 1.3 - worldW * 0.15,
        y: Math.random() * worldH,
        speed, size, drift,
        alpha: (0.2 + Math.random() * 0.4) * depthScale,
        layer,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  /** Shared drop update for both active and fading drop lists */
  private updateDropList(drops: WeatherDrop[], dt: number, weatherType: WeatherType): void {
    const worldH = this.mapH * T;
    const worldW = this.mapW * T;
    const isRainLike = weatherType === 'rain' || weatherType === 'storm';
    const isSand = weatherType === 'sandstorm';

    for (const d of drops) {
      d.y += d.speed * dt;
      const windEffect = this.windStrength * (0.5 + d.layer * 0.25);
      d.x += (d.drift + windEffect) * dt;

      // Snow/blizzard flutter
      if (!isRainLike && !isSand) {
        d.x += Math.sin(d.phase + d.y * 0.008) * 12 * dt;
      }
      // Sand flutter — horizontal wobble
      if (isSand) {
        d.y += Math.sin(d.phase + d.x * 0.005) * 8 * dt;
      }

      if (d.y > worldH) {
        if (isRainLike && d.layer >= 1 && Math.random() < 0.3) {
          this.splashes.push({
            x: d.x, y: worldH - Math.random() * 20,
            age: 0, maxAge: 0.15 + Math.random() * 0.1,
            size: d.size * 1.5,
          });
        }
        d.y = -10 - Math.random() * 40;
        d.x = Math.random() * worldW * 1.3 - worldW * 0.15;
      }
      // Sandstorm: wrap horizontally too
      if (isSand && d.x > worldW * 1.2) {
        d.x = -worldW * 0.15;
        d.y = Math.random() * worldH;
      }
    }
  }

  /** Get brightness-adjusted rain color per layer */
  private rainColor(layer: number, isStorm = false): string {
    const br = this.brightness;
    if (br > 0.7) {
      const a = isStorm ? [0.5, 0.6, 0.8][layer] : [0.4, 0.5, 0.7][layer];
      return `rgba(180, 200, 255, ${a})`;
    }
    const f = Math.max(0.3, br);
    const r = Math.round(100 * f);
    const g = Math.round(130 * f);
    const b = Math.round(200 * f);
    const a = isStorm ? [0.45, 0.55, 0.7][layer] : [0.35, 0.45, 0.6][layer];
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  /** Get brightness-adjusted snow color per layer */
  private snowColor(layer: number, isBlizzard = false): string {
    if (this.brightness > 0.7) {
      if (isBlizzard) return layer < 2 ? 'rgba(230, 235, 250, 0.85)' : '#fff';
      return layer < 2 ? 'rgba(220, 230, 245, 0.8)' : '#fff';
    }
    const f = Math.max(0.5, this.brightness);
    const r = Math.round(180 * f + 20);
    const g = Math.round(190 * f + 20);
    const b = Math.round(220 * f + 30);
    const a = isBlizzard ? (layer < 2 ? 0.8 : 0.9) : (layer < 2 ? 0.7 : 0.85);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  /** Sand particle color per layer */
  private sandColor(layer: number): string {
    const br = Math.max(0.4, this.brightness);
    const r = Math.round(200 * br + 20);
    const g = Math.round(160 * br + 15);
    const b = Math.round(80 * br + 10);
    const a = [0.3, 0.45, 0.6][layer];
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  private isVisible(d: { x: number; y: number }, margin = 100): boolean {
    if (!this.viewportSet) return true;
    const v = this._viewport;
    return d.x > v.x - margin && d.x < v.x + v.w + margin &&
           d.y > v.y - margin && d.y < v.y + v.h + margin;
  }

  /** Draw a set of rain/storm drops — only specified layers */
  private drawRainDrops(ctx: CanvasRenderingContext2D, drops: WeatherDrop[], alpha: number, isStorm: boolean, layerFilter?: number[]): void {
    const layers = layerFilter ?? [0, 1, 2];
    for (const layer of layers) {
      const layerAlpha = [0.2, 0.35, 0.5][layer];
      ctx.globalAlpha = alpha * layerAlpha;
      ctx.lineWidth = isStorm ? [0.7, 1.2, 2.0][layer] : [0.5, 1, 1.5][layer];
      ctx.strokeStyle = this.rainColor(layer, isStorm);
      ctx.beginPath();
      for (const d of drops) {
        if (d.layer !== layer) continue;
        if (!this.isVisible(d)) continue;
        const len = d.size * [4, 6, 8][layer];
        const dx = d.x | 0;
        const dy = d.y | 0;
        ctx.moveTo(dx, dy);
        ctx.lineTo(dx + ((d.drift + this.windStrength) * 0.025) | 0, dy - len);
      }
      ctx.stroke();
    }
  }

  /** Draw a set of snow/blizzard drops — only specified layers */
  private drawSnowDrops(ctx: CanvasRenderingContext2D, drops: WeatherDrop[], alpha: number, isBlizzard: boolean, layerFilter?: number[]): void {
    const layers = layerFilter ?? [0, 1, 2];
    for (const layer of layers) {
      const layerAlpha = isBlizzard ? [0.4, 0.6, 0.8][layer] : [0.3, 0.5, 0.7][layer];
      ctx.globalAlpha = alpha * layerAlpha;
      ctx.fillStyle = this.snowColor(layer, isBlizzard);
      ctx.beginPath();
      for (const d of drops) {
        if (d.layer !== layer) continue;
        if (!this.isVisible(d)) continue;
        const dx = d.x | 0;
        const dy = d.y | 0;
        ctx.moveTo(dx + d.size, dy);
        ctx.arc(dx, dy, d.size, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }

  /** Draw sandstorm particles — horizontal streaks — only specified layers */
  private drawSandDrops(ctx: CanvasRenderingContext2D, drops: WeatherDrop[], alpha: number, layerFilter?: number[]): void {
    const layers = layerFilter ?? [0, 1, 2];
    for (const layer of layers) {
      const layerAlpha = [0.25, 0.4, 0.55][layer];
      ctx.globalAlpha = alpha * layerAlpha;
      ctx.strokeStyle = this.sandColor(layer);
      ctx.lineWidth = [1, 1.5, 2.5][layer];
      ctx.beginPath();
      for (const d of drops) {
        if (d.layer !== layer) continue;
        if (!this.isVisible(d)) continue;
        const len = d.size * [3, 5, 7][layer];
        const dx = d.x | 0;
        const dy = d.y | 0;
        // Horizontal streaks instead of vertical
        ctx.moveTo(dx, dy);
        ctx.lineTo(dx - len, dy + (d.speed * 0.01) | 0);
      }
      ctx.stroke();
    }
  }

  /** Draw drops of any type for a specified layer range */
  private drawDropsByType(ctx: CanvasRenderingContext2D, drops: WeatherDrop[], alpha: number, weatherType: WeatherType, layerFilter?: number[]): void {
    switch (weatherType) {
      case 'rain':       this.drawRainDrops(ctx, drops, alpha, false, layerFilter); break;
      case 'storm':      this.drawRainDrops(ctx, drops, alpha, true, layerFilter); break;
      case 'snow':       this.drawSnowDrops(ctx, drops, alpha, false, layerFilter); break;
      case 'blizzard':   this.drawSnowDrops(ctx, drops, alpha, true, layerFilter); break;
      case 'sandstorm':  this.drawSandDrops(ctx, drops, alpha, layerFilter); break;
    }
  }

  /** Draw far/mid weather particles (layers 0-1) — call BEFORE units for depth */
  drawWorldBehind(ctx: CanvasRenderingContext2D): void {
    // Fading particles behind
    if (this.fadingAlpha > 0.01 && this.fadingDrops.length > 0) {
      this.drawDropsByType(ctx, this.fadingDrops, this.fadingAlpha, this.fadingType, [0, 1]);
      ctx.globalAlpha = 1;
    }
    if (this.transitionAlpha < 0.01) return;

    if (isParticleWeather(this.type)) {
      this.drawDropsByType(ctx, this.drops, this.transitionAlpha, this.type, [0, 1]);
      ctx.globalAlpha = 1;
    }

    // Fog draws entirely in behind pass (it's background atmosphere)
    if (this.type === 'fog' || this.type === 'overcast') {
      this.drawFogBands(ctx);
    }
  }

  /** Draw near weather particles (layer 2) + splashes — call AFTER units for depth */
  drawWorldFront(ctx: CanvasRenderingContext2D): void {
    // Fading particles in front
    if (this.fadingAlpha > 0.01 && this.fadingDrops.length > 0) {
      this.drawDropsByType(ctx, this.fadingDrops, this.fadingAlpha, this.fadingType, [2]);
      ctx.globalAlpha = 1;
    }
    if (this.transitionAlpha < 0.01) return;
    const ta = this.transitionAlpha;

    if (isParticleWeather(this.type)) {
      this.drawDropsByType(ctx, this.drops, ta, this.type, [2]);

      // Splashes for rain/storm
      if ((this.type === 'rain' || this.type === 'storm') && this.splashes.length > 0) {
        ctx.globalAlpha = ta * 0.4;
        ctx.strokeStyle = 'rgba(200, 220, 255, 0.6)';
        ctx.lineWidth = 0.5;
        for (const s of this.splashes) {
          if (!this.isVisible(s, 50)) continue;
          const t = s.age / s.maxAge;
          const r = s.size * (1 + t * 3);
          ctx.beginPath();
          ctx.arc(s.x | 0, s.y | 0, r, Math.PI * 1.15, Math.PI * 1.85);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  /** Legacy single-pass draw — still works if Renderer doesn't use split calls */
  drawWorld(ctx: CanvasRenderingContext2D): void {
    this.drawWorldBehind(ctx);
    this.drawWorldFront(ctx);
  }

  /** Draw fog gradient bands (used by both fog and overcast) */
  private drawFogBands(ctx: CanvasRenderingContext2D): void {
    const worldW = this.mapW * T;
    const worldH = this.mapH * T;
    const ta = this.transitionAlpha;
    const isOvercast = this.type === 'overcast';
    const bandCount = isOvercast ? 4 : 8;
    const FOG_SPEEDS = [0.07, -0.05, 0.09, -0.04, 0.06, -0.08, 0.03, -0.06];
    const FOG_ALPHAS_NORMAL = [0.08, 0.12, 0.06, 0.1, 0.09, 0.07, 0.11, 0.05];
    const FOG_ALPHAS_OVERCAST = [0.04, 0.06, 0.03, 0.05]; // lighter for overcast
    const typeChanged = this.fogGradType !== this.type;
    const needsRebuild = this.fogGradMapW !== worldW || this.fogGradMapH !== worldH || typeChanged;

    const fogAlphas = isOvercast ? FOG_ALPHAS_OVERCAST : FOG_ALPHAS_NORMAL;
    // Overcast fog color: greyer, less blue
    const fogR = isOvercast ? 170 : 190;
    const fogG = isOvercast ? 175 : 200;
    const fogB = isOvercast ? 185 : 215;

    for (let i = 0; i < bandCount; i++) {
      const baseY = worldH * (i * 0.13 + 0.02);
      const wrapH = worldH * 1.2;
      const speed = FOG_SPEEDS[i % FOG_SPEEDS.length];
      const bandY = ((baseY + this.fogPhase * worldH * speed) % wrapH + wrapH) % wrapH - worldH * 0.1;
      const bandH = worldH * (0.1 + (i % 3) * 0.04);
      const layerAlpha = ta * fogAlphas[i];
      ctx.globalAlpha = layerAlpha;

      if (needsRebuild || !this.fogGradCache[i] || Math.abs(this.fogGradBandYs[i] - bandY) > 2) {
        const grad = ctx.createLinearGradient(0, bandY, 0, bandY + bandH);
        grad.addColorStop(0, `rgba(${fogR}, ${fogG}, ${fogB}, 0)`);
        grad.addColorStop(0.3, `rgba(${fogR + 10}, ${fogG + 10}, ${fogB + 5}, 1)`);
        grad.addColorStop(0.7, `rgba(${fogR + 5}, ${fogG + 5}, ${fogB + 3}, 1)`);
        grad.addColorStop(1, `rgba(${fogR}, ${fogG}, ${fogB}, 0)`);
        this.fogGradCache[i] = grad;
        this.fogGradBandYs[i] = bandY;
      }
      ctx.fillStyle = this.fogGradCache[i];
      ctx.fillRect(0, bandY, worldW, bandH);
    }
    if (needsRebuild) { this.fogGradMapW = worldW; this.fogGradMapH = worldH; this.fogGradType = this.type; }
    ctx.globalAlpha = 1;
  }

  /** Get or create a cached vignette gradient */
  private getVignetteGrad(ctx: CanvasRenderingContext2D, w: number, h: number): CanvasGradient {
    if (this.vignetteCache && this.vignetteCacheW === w && this.vignetteCacheH === h && this.vignetteCacheType === this.type) {
      return this.vignetteCache;
    }
    let innerR: number, outerR: number, r: number, g: number, b: number;
    switch (this.type) {
      case 'storm':     innerR = 0.3; outerR = 0.7; r = 20; g = 20; b = 40; break;
      case 'blizzard':  innerR = 0.25; outerR = 0.65; r = 200; g = 210; b = 230; break;
      case 'sandstorm': innerR = 0.3; outerR = 0.6; r = 100; g = 70; b = 20; break;
      default:          innerR = 0.3; outerR = 0.7; r = 0; g = 0; b = 0;
    }
    const grad = ctx.createRadialGradient(
      w / 2, h / 2, Math.min(w, h) * innerR,
      w / 2, h / 2, Math.max(w, h) * outerR
    );
    grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},1)`);
    this.vignetteCache = grad;
    this.vignetteCacheW = w;
    this.vignetteCacheH = h;
    this.vignetteCacheType = this.type;
    return grad;
  }

  /** Draw screen-space weather overlay */
  drawOverlay(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const ta = this.transitionAlpha;
    const br = this.brightness;

    // Lightning flash — brighter at night for more contrast
    if (this.lightningFlash > 0.01) {
      const flashAlpha = this.lightningFlash * (br < 0.6 ? 0.35 : 0.25);
      ctx.fillStyle = `rgba(220, 230, 255, ${flashAlpha})`;
      ctx.fillRect(0, 0, w, h);
    }

    if (ta <= 0.1) return;

    switch (this.type) {
      case 'rain': {
        const rainAlpha = br < 0.6 ? 0.03 * ta : 0.07 * ta;
        ctx.fillStyle = `rgba(80, 100, 130, ${rainAlpha})`;
        ctx.fillRect(0, 0, w, h);
        break;
      }
      case 'storm': {
        const stormAlpha = br < 0.6 ? 0.06 * ta : 0.12 * ta;
        ctx.fillStyle = `rgba(50, 60, 90, ${stormAlpha})`;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 0.15 * ta;
        ctx.fillStyle = this.getVignetteGrad(ctx, w, h);
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
        break;
      }
      case 'snow': {
        ctx.fillStyle = `rgba(200, 210, 230, ${0.04 * ta})`;
        ctx.fillRect(0, 0, w, h);
        break;
      }
      case 'blizzard': {
        ctx.fillStyle = `rgba(220, 225, 240, ${0.1 * ta})`;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 0.12 * ta;
        ctx.fillStyle = this.getVignetteGrad(ctx, w, h);
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
        break;
      }
      case 'fog': {
        ctx.fillStyle = `rgba(180, 190, 210, ${0.06 * ta})`;
        ctx.fillRect(0, 0, w, h);
        break;
      }
      case 'overcast': {
        // Subtle grey dimming
        ctx.fillStyle = `rgba(140, 145, 155, ${0.04 * ta})`;
        ctx.fillRect(0, 0, w, h);
        break;
      }
      case 'sandstorm': {
        ctx.fillStyle = `rgba(180, 140, 70, ${0.08 * ta})`;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 0.12 * ta;
        ctx.fillStyle = this.getVignetteGrad(ctx, w, h);
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
        break;
      }
    }
  }
}

// ─── Ambient Particle System ─────────────────────────────────

interface AmbientParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  maxAlpha: number;
  age: number;
  maxAge: number;
  color: string;
  color2?: string; // secondary color for glow/shimmer
  type: 'dust' | 'ember' | 'leaf' | 'sparkle' | 'mote' | 'wisp' | 'bubble';
  phase: number; // per-particle phase for wobble/shimmer
  spin: number;  // rotation speed for leaves
}

export class AmbientParticles {
  private particles: AmbientParticle[] = [];
  private spawnAcc = 0;

  /** Spawn ambient particles near combat areas.
   *  Optional `proj` converts tile coords to world pixels (for isometric). */
  update(dt: number, combatZones: { x: number; y: number }[], proj?: (x: number, y: number) => { px: number; py: number }): void {
    this.spawnAcc += dt;

    // Spawn dust near combat — more frequently, bigger clouds
    if (this.spawnAcc > 0.08 && combatZones.length > 0) {
      this.spawnAcc = 0;
      const zone = combatZones[Math.floor(Math.random() * combatZones.length)];
      let zx: number, zy: number;
      if (proj) { const p = proj(zone.x, zone.y); zx = p.px; zy = p.py; }
      else { zx = zone.x * T; zy = zone.y * T; }
      // Spawn 2-3 dust motes per burst
      const count = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < count; i++) {
        this.particles.push({
          x: zx + (Math.random() - 0.5) * T * 4,
          y: zy + (Math.random() - 0.5) * T * 2,
          vx: (Math.random() - 0.5) * 20,
          vy: -8 - Math.random() * 18,
          size: 1.5 + Math.random() * 2,
          alpha: 0, maxAlpha: 0.25 + Math.random() * 0.2,
          age: 0, maxAge: 0.6 + Math.random() * 0.6,
          color: Math.random() > 0.5 ? '#c8b090' : '#b8a078',
          type: 'dust', phase: 0, spin: 0,
        });
      }
    }

    // Update
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.maxAge) { this.particles.splice(i, 1); continue; }

      // Type-specific movement
      if (p.type === 'leaf') {
        // Flutter: sinusoidal drift + slow spin
        p.x += (p.vx + Math.sin(p.phase + p.age * 3.5) * 18) * dt;
        p.y += (p.vy + Math.cos(p.phase + p.age * 2.1) * 5) * dt;
      } else if (p.type === 'bubble') {
        // Rise with wobble
        p.x += (p.vx + Math.sin(p.phase + p.age * 4) * 10) * dt;
        p.y += p.vy * dt;
      } else if (p.type === 'wisp') {
        // Erratic drift
        p.x += (p.vx + Math.sin(p.phase + p.age * 5) * 15) * dt;
        p.y += (p.vy + Math.cos(p.phase + p.age * 3) * 8) * dt;
      } else {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }

      // Fade in then out
      const life = p.age / p.maxAge;
      p.alpha = life < 0.15 ? (life / 0.15) * p.maxAlpha
        : p.maxAlpha * (1 - (life - 0.15) / 0.85);
    }

    // Cap
    if (this.particles.length > 200) this.particles.length = 200;
  }

  /** Spawn race-themed ambient particles near units — all 9 races */
  /** Spawn a race-themed particle at world-pixel coordinates. ~1.2% chance per call. */
  spawnRaceParticlePx(wpx: number, wpy: number, race: Race): void {
    if (this.particles.length > 160) return;
    if (Math.random() > 0.012) return;
    this._doSpawnRaceParticle(wpx + (Math.random() - 0.5) * T * 2, wpy, race);
  }

  /** Spawn a race-themed particle at tile coordinates (orthographic). */
  spawnRaceParticle(x: number, y: number, race: Race): void {
    this.spawnRaceParticlePx(x * T, y * T, race);
  }

  private _doSpawnRaceParticle(px: number, py: number, race: Race): void {
    const base = {
      x: px, y: py,
      vx: (Math.random() - 0.5) * 20,
      alpha: 0, maxAlpha: 0.5 + Math.random() * 0.3,
      age: 0, maxAge: 0.6 + Math.random() * 0.8,
      phase: Math.random() * Math.PI * 2,
      spin: 0,
    };

    switch (race) {
      case Race.Demon:
        this.particles.push({
          ...base,
          vy: -25 - Math.random() * 30,
          size: 1.5 + Math.random() * 2,
          color: Math.random() > 0.5 ? '#ff6600' : '#ff3300',
          color2: '#ff990044',
          type: 'ember',
        });
        break;
      case Race.Wild:
        this.particles.push({
          ...base,
          vy: 8 + Math.random() * 12,
          vx: (Math.random() - 0.5) * 25,
          size: 2 + Math.random() * 2,
          color: ['#4a7a2a', '#6a9a3a', '#5a8a30', '#3a6a22'][Math.floor(Math.random() * 4)],
          type: 'leaf', spin: (Math.random() - 0.5) * 4,
          maxAge: 1.0 + Math.random() * 1.0,
        });
        break;
      case Race.Tenders:
        this.particles.push({
          ...base,
          vy: 6 + Math.random() * 8,
          vx: (Math.random() - 0.5) * 15,
          size: 1.5 + Math.random() * 1.5,
          color: Math.random() > 0.6 ? '#88cc55' : '#a8e070',
          type: 'leaf', spin: (Math.random() - 0.5) * 3,
          maxAge: 0.8 + Math.random() * 0.8,
        });
        break;
      case Race.Deep:
        this.particles.push({
          ...base,
          vy: -8 - Math.random() * 12,
          size: 1.5 + Math.random() * 1.5,
          color: '#64b5f6',
          color2: '#90caf9',
          type: 'sparkle',
        });
        break;
      case Race.Geists:
        this.particles.push({
          ...base,
          vy: -12 - Math.random() * 18,
          size: 1.5 + Math.random() * 2,
          color: '#b39ddb',
          color2: '#d1c4e9',
          type: 'sparkle',
        });
        break;
      case Race.Crown:
        // Golden motes — drift upward slowly
        this.particles.push({
          ...base,
          vy: -6 - Math.random() * 8,
          size: 1 + Math.random() * 1.5,
          color: '#ffd54f',
          color2: '#fff8e1',
          type: 'mote',
          maxAlpha: 0.4 + Math.random() * 0.3,
        });
        break;
      case Race.Horde:
        // Dust and sparks — kicked up from heavy footsteps
        this.particles.push({
          ...base,
          vy: -10 - Math.random() * 15,
          vx: (Math.random() - 0.5) * 30,
          size: 1.5 + Math.random() * 2,
          color: Math.random() > 0.6 ? '#ff8a65' : '#a1887f',
          type: 'dust',
          maxAlpha: 0.35 + Math.random() * 0.2,
        });
        break;
      case Race.Goblins:
        // Toxic green wisps — erratic movement
        this.particles.push({
          ...base,
          vy: -8 - Math.random() * 12,
          size: 1 + Math.random() * 1.5,
          color: Math.random() > 0.5 ? '#76ff03' : '#ccff90',
          color2: '#69f0ae44',
          type: 'wisp',
          maxAge: 0.5 + Math.random() * 0.5,
        });
        break;
      case Race.Oozlings:
        // Bubbles — rise and pop
        this.particles.push({
          ...base,
          vy: -15 - Math.random() * 20,
          vx: (Math.random() - 0.5) * 10,
          size: 2 + Math.random() * 3,
          color: Math.random() > 0.5 ? '#80deea' : '#b2ebf2',
          type: 'bubble',
          maxAlpha: 0.35 + Math.random() * 0.25,
          maxAge: 0.5 + Math.random() * 0.6,
        });
        break;
      default:
        return;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      ctx.globalAlpha = p.alpha;

      switch (p.type) {
        case 'sparkle': {
          // Diamond with subtle glow
          const s = p.size * (0.8 + Math.sin(p.phase + p.age * 8) * 0.2);
          if (p.color2) {
            ctx.fillStyle = p.color2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, s * 1.8, 0, Math.PI * 2);
            ctx.globalAlpha = p.alpha * 0.2;
            ctx.fill();
            ctx.globalAlpha = p.alpha;
          }
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - s);
          ctx.lineTo(p.x + s * 0.6, p.y);
          ctx.lineTo(p.x, p.y + s);
          ctx.lineTo(p.x - s * 0.6, p.y);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case 'ember': {
          // Glowing ember — soft halo behind bright core
          const s = p.size;
          if (p.color2) {
            ctx.fillStyle = p.color2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, s * 2.5, 0, Math.PI * 2);
            ctx.globalAlpha = p.alpha * 0.15;
            ctx.fill();
            ctx.globalAlpha = p.alpha;
          }
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
          ctx.fill();
          // Bright core
          ctx.fillStyle = '#ffcc00';
          ctx.globalAlpha = p.alpha * 0.6;
          ctx.beginPath();
          ctx.arc(p.x, p.y, s * 0.4, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'leaf': {
          // Rotated oval — simulates a tumbling leaf
          const s = p.size;
          const rot = p.phase + p.age * p.spin;
          ctx.fillStyle = p.color;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(rot);
          // Squash x based on rotation for 3D tumble illusion
          const squash = 0.4 + Math.abs(Math.cos(rot * 1.5)) * 0.6;
          ctx.scale(squash, 1);
          ctx.beginPath();
          ctx.ellipse(0, 0, s * 0.5, s, 0, 0, Math.PI * 2);
          ctx.fill();
          // Leaf vein
          ctx.strokeStyle = p.color;
          ctx.globalAlpha = p.alpha * 0.4;
          ctx.lineWidth = 0.3;
          ctx.beginPath();
          ctx.moveTo(0, -s * 0.7);
          ctx.lineTo(0, s * 0.7);
          ctx.stroke();
          ctx.restore();
          break;
        }
        case 'mote': {
          // Gentle golden shimmer — pulsing size
          const s = p.size * (0.7 + Math.sin(p.phase + p.age * 6) * 0.3);
          if (p.color2) {
            ctx.fillStyle = p.color2;
            ctx.globalAlpha = p.alpha * 0.25;
            ctx.beginPath();
            ctx.arc(p.x, p.y, s * 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = p.alpha;
          }
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'wisp': {
          // Erratic toxic wisp — stretched in movement direction
          const s = p.size;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, s * 1.5, s * 0.8, p.phase + p.age * 2, 0, Math.PI * 2);
          ctx.fill();
          if (p.color2) {
            ctx.fillStyle = p.color2;
            ctx.globalAlpha = p.alpha * 0.3;
            ctx.beginPath();
            ctx.arc(p.x, p.y, s * 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }
        case 'bubble': {
          // Hollow circle with highlight
          const s = p.size;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
          ctx.stroke();
          // Specular highlight
          ctx.fillStyle = '#fff';
          ctx.globalAlpha = p.alpha * 0.5;
          ctx.beginPath();
          ctx.arc(p.x - s * 0.3, p.y - s * 0.3, s * 0.25, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        default: {
          // Dust — simple circle
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}

// ─── Projectile Trail System ─────────────────────────────────

interface TrailPoint {
  x: number;
  y: number;
  age: number;
  color: string;
}

export class ProjectileTrails {
  private trails: TrailPoint[] = [];

  /** Add a trail point at world-pixel coordinates. */
  addPointPx(px: number, py: number, color: string): void {
    if (this.trails.length >= 500) {
      // Reuse oldest slot instead of shift() which is O(n)
      // Find oldest trail point and overwrite it
      let oldestIdx = 0, oldestAge = 0;
      for (let i = 0; i < this.trails.length; i++) {
        if (this.trails[i].age > oldestAge) { oldestAge = this.trails[i].age; oldestIdx = i; }
      }
      const t = this.trails[oldestIdx];
      t.x = px; t.y = py; t.age = 0; t.color = color;
    } else {
      this.trails.push({ x: px, y: py, age: 0, color });
    }
  }

  update(dt: number): void {
    // Swap-and-pop removal to avoid O(n) splice per removal
    let i = 0;
    while (i < this.trails.length) {
      this.trails[i].age += dt;
      if (this.trails[i].age > 0.3) {
        this.trails[i] = this.trails[this.trails.length - 1];
        this.trails.length--;
      } else {
        i++;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const t of this.trails) {
      const alpha = 1 - t.age / 0.3;
      const size = 1.5 * alpha;
      ctx.globalAlpha = alpha * 0.5;
      ctx.fillStyle = t.color;
      ctx.beginPath();
      ctx.arc(t.x, t.y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

// ─── Building Construction Animation ─────────────────────────

export class ConstructionAnims {
  /** buildingId -> { startTick, duration } */
  private anims = new Map<number, { startTick: number; duration: number }>();

  register(buildingId: number, tick: number): void {
    this.anims.set(buildingId, { startTick: tick, duration: 15 }); // 15 ticks = 0.75s
  }

  /** Returns scale multiplier (0→1 bounce) or 1 if done */
  getScale(buildingId: number, tick: number): number {
    const anim = this.anims.get(buildingId);
    if (!anim) return 1;
    const elapsed = tick - anim.startTick;
    if (elapsed >= anim.duration) {
      this.anims.delete(buildingId);
      return 1;
    }
    const t = elapsed / anim.duration;
    // Elastic bounce: overshoot then settle
    return 1 - Math.pow(1 - t, 2) * Math.cos(t * Math.PI * 2.5) * (1 - t);
  }

  cleanup(existingIds: Set<number>): void {
    for (const id of this.anims.keys()) {
      if (!existingIds.has(id)) this.anims.delete(id);
    }
  }
}

// ─── Hit Flash Tracker ───────────────────────────────────────

export class HitFlashTracker {
  /** unitId -> remaining flash frames */
  private flashes = new Map<number, number>();

  trigger(unitId: number): void {
    this.flashes.set(unitId, 3); // 3 render frames of white flash
  }

  /** Returns true if unit should be drawn with white flash */
  consume(unitId: number): boolean {
    const remaining = this.flashes.get(unitId);
    if (!remaining) return false;
    if (remaining <= 1) {
      this.flashes.delete(unitId);
    } else {
      this.flashes.set(unitId, remaining - 1);
    }
    return true;
  }

  /** Track HP changes to detect hits */
  updateFromState(unitHps: Map<number, number>, currentUnits: { id: number; hp: number }[]): void {
    for (const u of currentUnits) {
      const prevHp = unitHps.get(u.id);
      if (prevHp !== undefined && u.hp < prevHp) {
        this.trigger(u.id);
      }
      unitHps.set(u.id, u.hp);
    }
    // Cleanup removed units
    for (const id of unitHps.keys()) {
      if (!currentUnits.find(u => u.id === id)) unitHps.delete(id);
    }
  }
}

// ─── Combat VFX (rings, arcs, lifesteal, heal sparkles) ─────

interface RingEffect {
  x: number; y: number;
  maxRadius: number;
  color: string;
  age: number;
  maxAge: number;
}

interface ArcEffect {
  x1: number; y1: number;
  x2: number; y2: number;
  color: string;
  age: number;
  maxAge: number;
}

interface SparkleEffect {
  x: number; y: number;
  color: string;
  age: number;
  maxAge: number;
  type: 'heal' | 'cleanse' | 'dodge' | 'revive' | 'knockback' | 'lifesteal';
  // for lifesteal: target position
  x2?: number; y2?: number;
}

export class CombatVFX {
  private rings: RingEffect[] = [];
  private arcs: ArcEffect[] = [];
  private sparkles: SparkleEffect[] = [];

  /** Feed in combat events from the simulation tick.
   *  Optional `proj` converts tile coords to world pixels (for isometric). */
  consume(events: CombatEvent[], proj?: (x: number, y: number) => { px: number; py: number }): void {
    const wp = proj
      ? (x: number, y: number) => { const p = proj(x, y); return { x: p.px, y: p.py }; }
      : (x: number, y: number) => ({ x: x * T, y: y * T });
    for (const e of events) {
      const { x: ex, y: ey } = wp(e.x, e.y);
      switch (e.type) {
        case 'splash':
          this.rings.push({
            x: ex, y: ey,
            maxRadius: (e.radius ?? 3) * T,
            color: e.color, age: 0, maxAge: 0.4,
          });
          break;
        case 'pulse':
          this.rings.push({
            x: ex, y: ey,
            maxRadius: (e.radius ?? 6) * T,
            color: e.color, age: 0, maxAge: 0.5,
          });
          break;
        case 'chain': {
          const { x: ex2, y: ey2 } = wp(e.x2 ?? e.x, e.y2 ?? e.y);
          this.arcs.push({
            x1: ex, y1: ey, x2: ex2, y2: ey2,
            color: e.color, age: 0, maxAge: 0.3,
          });
          break;
        }
        case 'lifesteal': {
          const { x: lx2, y: ly2 } = wp(e.x2 ?? e.x, e.y2 ?? e.y);
          this.sparkles.push({
            x: ex, y: ey, color: e.color,
            x2: lx2, y2: ly2,
            age: 0, maxAge: 0.35, type: 'lifesteal',
          });
          break;
        }
        case 'heal':
          this.sparkles.push({
            x: ex, y: ey, color: e.color,
            age: 0, maxAge: 0.5, type: 'heal',
          });
          break;
        case 'dodge':
          this.sparkles.push({
            x: ex, y: ey, color: e.color,
            age: 0, maxAge: 0.25, type: 'dodge',
          });
          break;
        case 'revive':
          this.rings.push({
            x: ex, y: ey, maxRadius: T * 2.5,
            color: e.color, age: 0, maxAge: 0.5,
          });
          this.sparkles.push({
            x: ex, y: ey, color: e.color,
            age: 0, maxAge: 0.5, type: 'revive',
          });
          break;
        case 'cleanse':
          this.sparkles.push({
            x: ex, y: ey, color: e.color,
            age: 0, maxAge: 0.4, type: 'cleanse',
          });
          break;
        case 'knockback':
          this.sparkles.push({
            x: ex, y: ey, color: e.color,
            age: 0, maxAge: 0.3, type: 'knockback',
          });
          break;
      }
    }
  }

  update(dt: number): void {
    // Update rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      this.rings[i].age += dt;
      if (this.rings[i].age >= this.rings[i].maxAge) this.rings.splice(i, 1);
    }
    // Update arcs
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      this.arcs[i].age += dt;
      if (this.arcs[i].age >= this.arcs[i].maxAge) this.arcs.splice(i, 1);
    }
    // Update sparkles
    for (let i = this.sparkles.length - 1; i >= 0; i--) {
      this.sparkles[i].age += dt;
      if (this.sparkles[i].age >= this.sparkles[i].maxAge) this.sparkles.splice(i, 1);
    }
    // Cap
    if (this.rings.length > 60) this.rings.length = 60;
    if (this.arcs.length > 80) this.arcs.length = 80;
    if (this.sparkles.length > 100) this.sparkles.length = 100;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    // Expanding rings (splash / pulse)
    for (const r of this.rings) {
      const t = r.age / r.maxAge;
      const radius = r.maxRadius * t;
      const alpha = (1 - t) * 0.6;
      ctx.beginPath();
      ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = Math.max(1, 2.5 * (1 - t));
      ctx.globalAlpha = alpha;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Chain lightning arcs
    for (const a of this.arcs) {
      const t = a.age / a.maxAge;
      const alpha = (1 - t) * 0.8;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = a.color;
      ctx.lineWidth = Math.max(1, 3 * (1 - t));
      // Jagged arc: 3 midpoints with random offset
      const dx = a.x2 - a.x1, dy = a.y2 - a.y1;
      const perpX = -dy * 0.15, perpY = dx * 0.15;
      ctx.beginPath();
      ctx.moveTo(a.x1, a.y1);
      // Use deterministic "random" based on position
      const s1 = Math.sin(a.x1 * 7 + a.age * 50) * 0.8;
      const s2 = Math.sin(a.y1 * 11 + a.age * 70) * 0.8;
      const s3 = Math.sin((a.x1 + a.y1) * 5 + a.age * 90) * 0.6;
      ctx.lineTo(a.x1 + dx * 0.25 + perpX * s1, a.y1 + dy * 0.25 + perpY * s1);
      ctx.lineTo(a.x1 + dx * 0.50 + perpX * s2, a.y1 + dy * 0.50 + perpY * s2);
      ctx.lineTo(a.x1 + dx * 0.75 + perpX * s3, a.y1 + dy * 0.75 + perpY * s3);
      ctx.lineTo(a.x2, a.y2);
      ctx.stroke();
      // Glow
      ctx.lineWidth = Math.max(1, 6 * (1 - t));
      ctx.globalAlpha = alpha * 0.3;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Sparkle effects
    for (const s of this.sparkles) {
      const t = s.age / s.maxAge;
      const alpha = (1 - t);

      switch (s.type) {
        case 'heal': {
          // Rising green crosses / sparkles
          ctx.globalAlpha = alpha * 0.7;
          ctx.fillStyle = s.color;
          const rise = t * T * 1.5;
          const sz = 3 * (1 - t * 0.5);
          // Cross shape
          ctx.fillRect(s.x - sz / 2, s.y - rise - sz * 1.5, sz, sz * 3);
          ctx.fillRect(s.x - sz * 1.5, s.y - rise - sz / 2, sz * 3, sz);
          ctx.globalAlpha = 1;
          break;
        }
        case 'lifesteal': {
          // Particles streaming from target to attacker
          ctx.globalAlpha = alpha * 0.7;
          ctx.fillStyle = s.color;
          const x2 = s.x2 ?? s.x, y2 = s.y2 ?? s.y;
          // 3 particles at different progress along the path
          for (let i = 0; i < 3; i++) {
            const p = (t + i * 0.15) % 1;
            const px = s.x + (x2 - s.x) * p;
            const py = s.y + (y2 - s.y) * p - Math.sin(p * Math.PI) * T * 0.5;
            ctx.beginPath();
            ctx.arc(px, py, 2 * (1 - p * 0.5), 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          break;
        }
        case 'dodge': {
          // Ghost afterimage: fading duplicate offset
          ctx.globalAlpha = alpha * 0.4;
          ctx.fillStyle = s.color;
          const offset = t * T * 0.8;
          // Two ghost circles offset left and right
          ctx.beginPath();
          ctx.arc(s.x - offset, s.y, 4 * (1 - t), 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(s.x + offset, s.y, 3 * (1 - t), 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          break;
        }
        case 'revive': {
          // Bright flash + upward sparkles
          ctx.globalAlpha = alpha * 0.8;
          ctx.fillStyle = s.color;
          // Flash circle
          const flashR = T * (0.5 + t * 1.5);
          ctx.beginPath();
          ctx.arc(s.x, s.y, flashR, 0, Math.PI * 2);
          ctx.globalAlpha = alpha * 0.3;
          ctx.fill();
          // Rising sparkle dots
          ctx.globalAlpha = alpha * 0.8;
          for (let i = 0; i < 5; i++) {
            const angle = (i / 5) * Math.PI * 2 + t * 3;
            const r = T * (0.5 + t);
            const px = s.x + Math.cos(angle) * r;
            const py = s.y + Math.sin(angle) * r - t * T;
            ctx.beginPath();
            ctx.arc(px, py, 2, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          break;
        }
        case 'cleanse': {
          // Blue sparkle burst expanding outward
          ctx.globalAlpha = alpha * 0.7;
          ctx.fillStyle = s.color;
          for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const r = t * T * 1.2;
            const px = s.x + Math.cos(angle) * r;
            const py = s.y + Math.sin(angle) * r;
            const sz = 2.5 * (1 - t);
            // Diamond sparkle
            ctx.beginPath();
            ctx.moveTo(px, py - sz);
            ctx.lineTo(px + sz * 0.6, py);
            ctx.lineTo(px, py + sz);
            ctx.lineTo(px - sz * 0.6, py);
            ctx.closePath();
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          break;
        }
        case 'knockback': {
          // Impact starburst
          ctx.globalAlpha = alpha * 0.7;
          ctx.strokeStyle = s.color;
          ctx.lineWidth = 2 * (1 - t);
          for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const innerR = t * T * 0.3;
            const outerR = T * (0.3 + t * 0.8);
            ctx.beginPath();
            ctx.moveTo(s.x + Math.cos(angle) * innerR, s.y + Math.sin(angle) * innerR);
            ctx.lineTo(s.x + Math.cos(angle) * outerR, s.y + Math.sin(angle) * outerR);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
          break;
        }
      }
    }
  }
}

// ─── Haptic Feedback ─────────────────────────────────────────

export function triggerHaptic(durationMs = 50, intensity = 1.0): void {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(Math.round(durationMs * intensity));
    }
  } catch { /* not supported */ }
}
