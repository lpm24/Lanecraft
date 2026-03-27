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

export type WeatherType = 'clear' | 'rain' | 'snow' | 'fog';

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

export class WeatherSystem {
  type: WeatherType = 'clear';
  private drops: WeatherDrop[] = [];
  private fadingDrops: WeatherDrop[] = []; // old drops fading out during transitions
  private fadingType: WeatherType = 'clear'; // what the fading drops were
  private fadingAlpha = 0; // 1→0 fade for old particles
  private splashes: RainSplash[] = [];
  private transitionAlpha = 0;
  private targetAlpha = 0;
  private nextChangeTime = 0;
  private fogPhase = 0;
  private windStrength = 0;
  private windTarget = 0;
  private lightningFlash = 0; // 0-1 flash intensity, decays rapidly
  private lightningCooldown = 0;
  private brightness = 1; // current ambient brightness from day/night
  /** Set by Renderer to match current map dimensions (in tiles). */
  mapW = MAP_WIDTH;
  mapH = MAP_HEIGHT;
  /** Callback for lightning screen shake — set by Renderer */
  onLightning: (() => void) | null = null;

  // Fog gradient cache
  private fogGradCache: CanvasGradient[] = [];
  private fogGradMapW = 0;
  private fogGradMapH = 0;
  private fogGradBandYs: number[] = [];

  /** Call once per frame with dt in seconds */
  update(dt: number, elapsedSec: number, dayPhase: number, brightness = 1): void {
    this.brightness = brightness;

    // Auto-change weather every 60–120 seconds
    if (elapsedSec >= this.nextChangeTime) {
      this.pickWeather(dayPhase);
      this.nextChangeTime = elapsedSec + 60 + Math.random() * 60;
    }

    // Smooth transition
    this.targetAlpha = this.type === 'clear' ? 0 : 1;
    this.transitionAlpha += (this.targetAlpha - this.transitionAlpha) * dt * 2;

    // Fade out old drops during transitions
    if (this.fadingAlpha > 0.01) {
      this.fadingAlpha = Math.max(0, this.fadingAlpha - dt * 0.4); // ~2.5s fade
      this.updateDropList(this.fadingDrops, dt, this.fadingType === 'rain');
      if (this.fadingAlpha <= 0.01) {
        this.fadingDrops = [];
        this.fadingAlpha = 0;
      }
    }

    // Wind gusts — slowly drift toward random targets
    if (Math.random() < dt * 0.3) this.windTarget = (Math.random() - 0.5) * 60;
    this.windStrength += (this.windTarget - this.windStrength) * dt * 0.8;

    if (this.type === 'fog') this.fogPhase += dt * 0.3;
    if (this.type === 'rain' || this.type === 'snow') this.updateDropList(this.drops, dt, this.type === 'rain');

    // Lightning during rain
    if (this.type === 'rain') {
      this.lightningCooldown -= dt;
      if (this.lightningCooldown <= 0 && Math.random() < dt * 0.08) {
        this.lightningFlash = 0.8 + Math.random() * 0.2;
        this.lightningCooldown = 3 + Math.random() * 8;
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
    const rand = Math.random();
    if (dayPhase > 0.5 && dayPhase < 0.95) {
      if (rand < 0.3) this.type = 'fog';
      else if (rand < 0.5) this.type = 'rain';
      else this.type = 'clear';
    } else {
      if (rand < 0.15) this.type = 'rain';
      else if (rand < 0.22) this.type = 'snow';
      else if (rand < 0.28) this.type = 'fog';
      else this.type = 'clear';
    }

    // Graduated transition: move old drops to fading list instead of deleting
    if (this.drops.length > 0 && (prevType === 'rain' || prevType === 'snow')) {
      this.fadingDrops = this.drops;
      this.fadingType = prevType;
      this.fadingAlpha = this.transitionAlpha; // start fading from current opacity
    }

    if (this.type === 'rain' || this.type === 'snow') {
      this.drops = [];
      this.splashes = [];
      this.spawnDrops(this.type === 'rain' ? 600 : 300);
    } else {
      this.drops = [];
      this.splashes = [];
    }
  }

  private spawnDrops(count: number): void {
    const worldW = this.mapW * T;
    const worldH = this.mapH * T;
    const isRain = this.type === 'rain';
    for (let i = 0; i < count; i++) {
      const layer = i < count * 0.3 ? 0 : i < count * 0.7 ? 1 : 2;
      const depthScale = 0.5 + layer * 0.25; // 0.5, 0.75, 1.0
      this.drops.push({
        x: Math.random() * worldW * 1.3 - worldW * 0.15,
        y: Math.random() * worldH,
        speed: isRain
          ? (250 + Math.random() * 200) * depthScale
          : (15 + Math.random() * 25) * depthScale,
        size: isRain
          ? (0.8 + Math.random() * 1.5) * depthScale
          : (1.5 + Math.random() * 2.5) * depthScale,
        drift: isRain
          ? -40 + Math.random() * 15
          : (Math.random() - 0.5) * 15,
        alpha: (0.2 + Math.random() * 0.4) * depthScale,
        layer,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  /** Shared drop update for both active and fading drop lists */
  private updateDropList(drops: WeatherDrop[], dt: number, isRain: boolean): void {
    const worldH = this.mapH * T;
    const worldW = this.mapW * T;
    for (const d of drops) {
      d.y += d.speed * dt;
      const windEffect = this.windStrength * (0.5 + d.layer * 0.25);
      d.x += (d.drift + windEffect) * dt;
      if (!isRain) {
        d.x += Math.sin(d.phase + d.y * 0.008) * 12 * dt;
      }
      if (d.y > worldH) {
        if (isRain && d.layer >= 1 && Math.random() < 0.3) {
          this.splashes.push({
            x: d.x, y: worldH - Math.random() * 20,
            age: 0, maxAge: 0.15 + Math.random() * 0.1,
            size: d.size * 1.5,
          });
        }
        d.y = -10 - Math.random() * 40;
        d.x = Math.random() * worldW * 1.3 - worldW * 0.15;
      }
    }
  }

  /** Get brightness-adjusted rain color per layer */
  private rainColor(layer: number): string {
    const br = this.brightness;
    if (br > 0.7) {
      // Day rain: blue-white
      return `rgba(180, 200, 255, ${[0.4, 0.5, 0.7][layer]})`;
    }
    // Night rain: darker blue-grey, less contrast so it doesn't obscure
    const f = Math.max(0.3, br);
    const r = Math.round(100 * f);
    const g = Math.round(130 * f);
    const b = Math.round(200 * f);
    return `rgba(${r}, ${g}, ${b}, ${[0.35, 0.45, 0.6][layer]})`;
  }

  /** Get brightness-adjusted snow color per layer */
  private snowColor(layer: number): string {
    if (this.brightness > 0.7) {
      return layer < 2 ? 'rgba(220, 230, 245, 0.8)' : '#fff';
    }
    // Night snow: blue-tinted
    const f = Math.max(0.5, this.brightness);
    const r = Math.round(180 * f + 20);
    const g = Math.round(190 * f + 20);
    const b = Math.round(220 * f + 30);
    return `rgba(${r}, ${g}, ${b}, ${layer < 2 ? 0.7 : 0.85})`;
  }

  /** Draw a set of rain drops */
  private drawRainDrops(ctx: CanvasRenderingContext2D, drops: WeatherDrop[], alpha: number): void {
    for (let layer = 0; layer < 3; layer++) {
      const layerAlpha = [0.2, 0.35, 0.5][layer];
      ctx.globalAlpha = alpha * layerAlpha;
      ctx.lineWidth = [0.5, 1, 1.5][layer];
      ctx.strokeStyle = this.rainColor(layer);
      ctx.beginPath();
      for (const d of drops) {
        if (d.layer !== layer) continue;
        const len = d.size * [4, 6, 8][layer];
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + (d.drift + this.windStrength) * 0.025, d.y - len);
      }
      ctx.stroke();
    }
  }

  /** Draw a set of snow drops */
  private drawSnowDrops(ctx: CanvasRenderingContext2D, drops: WeatherDrop[], alpha: number): void {
    for (let layer = 0; layer < 3; layer++) {
      const layerAlpha = [0.3, 0.5, 0.7][layer];
      ctx.globalAlpha = alpha * layerAlpha;
      ctx.fillStyle = this.snowColor(layer);
      ctx.beginPath();
      for (const d of drops) {
        if (d.layer !== layer) continue;
        ctx.moveTo(d.x + d.size, d.y);
        ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }

  /** Draw weather effects onto the world-space canvas (camera-transformed) */
  drawWorld(ctx: CanvasRenderingContext2D): void {
    // Draw fading-out old particles first (behind new ones)
    if (this.fadingAlpha > 0.01 && this.fadingDrops.length > 0) {
      if (this.fadingType === 'rain') this.drawRainDrops(ctx, this.fadingDrops, this.fadingAlpha);
      else if (this.fadingType === 'snow') this.drawSnowDrops(ctx, this.fadingDrops, this.fadingAlpha);
      ctx.globalAlpha = 1;
    }

    if (this.transitionAlpha < 0.01) return;
    const ta = this.transitionAlpha;

    if (this.type === 'rain') {
      this.drawRainDrops(ctx, this.drops, ta);
      // Splashes
      if (this.splashes.length > 0) {
        ctx.globalAlpha = ta * 0.4;
        ctx.strokeStyle = 'rgba(200, 220, 255, 0.6)';
        ctx.lineWidth = 0.5;
        for (const s of this.splashes) {
          const t = s.age / s.maxAge;
          const r = s.size * (1 + t * 3);
          ctx.beginPath();
          ctx.arc(s.x, s.y, r, Math.PI * 1.15, Math.PI * 1.85);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    if (this.type === 'snow') {
      this.drawSnowDrops(ctx, this.drops, ta);
      ctx.globalAlpha = 1;
    }

    if (this.type === 'fog') {
      const worldW = this.mapW * T;
      const worldH = this.mapH * T;
      const FOG_SPEEDS = [0.07, -0.05, 0.09, -0.04, 0.06, -0.08, 0.03, -0.06];
      const FOG_ALPHAS = [0.08, 0.12, 0.06, 0.1, 0.09, 0.07, 0.11, 0.05];
      const needsRebuild = this.fogGradMapW !== worldW || this.fogGradMapH !== worldH;

      for (let i = 0; i < 8; i++) {
        const baseY = worldH * (i * 0.13 + 0.02);
        const wrapH = worldH * 1.2;
        const bandY = ((baseY + this.fogPhase * worldH * FOG_SPEEDS[i]) % wrapH + wrapH) % wrapH - worldH * 0.1;
        const bandH = worldH * (0.1 + (i % 3) * 0.04);
        const layerAlpha = ta * FOG_ALPHAS[i];
        ctx.globalAlpha = layerAlpha;

        // Cache gradients — only rebuild when map size changes or band moves
        if (needsRebuild || !this.fogGradCache[i] || Math.abs(this.fogGradBandYs[i] - bandY) > 2) {
          const grad = ctx.createLinearGradient(0, bandY, 0, bandY + bandH);
          grad.addColorStop(0, 'rgba(190, 200, 215, 0)');
          grad.addColorStop(0.3, 'rgba(200, 210, 220, 1)');
          grad.addColorStop(0.7, 'rgba(195, 205, 218, 1)');
          grad.addColorStop(1, 'rgba(190, 200, 215, 0)');
          this.fogGradCache[i] = grad;
          this.fogGradBandYs[i] = bandY;
        }
        ctx.fillStyle = this.fogGradCache[i];
        ctx.fillRect(0, bandY, worldW, bandH);
      }
      if (needsRebuild) { this.fogGradMapW = worldW; this.fogGradMapH = worldH; }
      ctx.globalAlpha = 1;
    }
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
    if (this.type === 'rain' && ta > 0.1) {
      // Night rain: lighter overlay to avoid stacking with night tint
      const rainAlpha = br < 0.6 ? 0.03 * ta : 0.07 * ta;
      ctx.fillStyle = `rgba(80, 100, 130, ${rainAlpha})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (this.type === 'snow' && ta > 0.1) {
      ctx.fillStyle = `rgba(200, 210, 230, ${0.04 * ta})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (this.type === 'fog' && ta > 0.1) {
      ctx.fillStyle = `rgba(180, 190, 210, ${0.06 * ta})`;
      ctx.fillRect(0, 0, w, h);
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
    this.trails.push({ x: px, y: py, age: 0, color });
    if (this.trails.length > 500) this.trails.shift();
  }

  update(dt: number): void {
    for (let i = this.trails.length - 1; i >= 0; i--) {
      this.trails[i].age += dt;
      if (this.trails[i].age > 0.3) this.trails.splice(i, 1);
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
