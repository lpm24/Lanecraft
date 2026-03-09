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
  drift: number; // horizontal movement
  alpha: number;
}

export class WeatherSystem {
  type: WeatherType = 'clear';
  private drops: WeatherDrop[] = [];
  private transitionAlpha = 0;
  private targetAlpha = 0;
  private nextChangeTime = 0;
  private fogPhase = 0;

  /** Call once per frame with dt in seconds */
  update(dt: number, elapsedSec: number, dayPhase: number): void {
    // Auto-change weather every 60–120 seconds
    if (elapsedSec >= this.nextChangeTime) {
      this.pickWeather(dayPhase);
      this.nextChangeTime = elapsedSec + 60 + Math.random() * 60;
    }

    // Smooth transition
    if (this.type === 'clear') {
      this.targetAlpha = 0;
    } else {
      this.targetAlpha = 1;
    }
    this.transitionAlpha += (this.targetAlpha - this.transitionAlpha) * dt * 2;

    if (this.type === 'fog') {
      this.fogPhase += dt * 0.3;
    }

    // Update drops
    if (this.type === 'rain' || this.type === 'snow') {
      this.updateDrops(dt);
    }
  }

  private pickWeather(dayPhase: number): void {
    const rand = Math.random();
    // Night has more chance of fog
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
    // Spawn or clear drops
    if (this.type === 'rain' || this.type === 'snow') {
      this.drops = [];
      this.spawnDrops(this.type === 'rain' ? 200 : 120);
    } else {
      this.drops = [];
    }
  }

  private spawnDrops(count: number): void {
    const worldW = MAP_WIDTH * T;
    const worldH = MAP_HEIGHT * T;
    for (let i = 0; i < count; i++) {
      this.drops.push({
        x: Math.random() * worldW * 1.2 - worldW * 0.1,
        y: Math.random() * worldH,
        speed: this.type === 'rain' ? 300 + Math.random() * 200 : 20 + Math.random() * 30,
        size: this.type === 'rain' ? 1 + Math.random() * 2 : 2 + Math.random() * 2,
        drift: this.type === 'rain' ? -30 + Math.random() * 10 : -10 + Math.random() * 20,
        alpha: 0.3 + Math.random() * 0.4,
      });
    }
  }

  private updateDrops(dt: number): void {
    const worldH = MAP_HEIGHT * T;
    const worldW = MAP_WIDTH * T;
    for (const d of this.drops) {
      d.y += d.speed * dt;
      d.x += d.drift * dt;
      if (d.y > worldH) {
        d.y = -10;
        d.x = Math.random() * worldW * 1.2 - worldW * 0.1;
      }
    }
  }

  /** Draw weather effects onto the world-space canvas (camera-transformed) */
  drawWorld(ctx: CanvasRenderingContext2D): void {
    if (this.transitionAlpha < 0.01) return;

    if (this.type === 'rain') {
      ctx.globalAlpha = this.transitionAlpha * 0.5;
      ctx.strokeStyle = 'rgba(180, 200, 255, 0.6)';
      ctx.lineWidth = 1;
      for (const d of this.drops) {
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + d.drift * 0.03, d.y - d.size * 6);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    if (this.type === 'snow') {
      ctx.globalAlpha = this.transitionAlpha * 0.7;
      ctx.fillStyle = '#fff';
      for (const d of this.drops) {
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    if (this.type === 'fog') {
      // Sweeping fog bands across the map
      const worldW = MAP_WIDTH * T;
      const worldH = MAP_HEIGHT * T;
      ctx.globalAlpha = this.transitionAlpha * 0.15;
      for (let i = 0; i < 5; i++) {
        const bandY = (worldH * 0.15 * i + this.fogPhase * worldH * 0.1) % worldH;
        const bandH = worldH * 0.08;
        const grad = ctx.createLinearGradient(0, bandY, 0, bandY + bandH);
        grad.addColorStop(0, 'rgba(200, 210, 220, 0)');
        grad.addColorStop(0.5, 'rgba(200, 210, 220, 1)');
        grad.addColorStop(1, 'rgba(200, 210, 220, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, bandY, worldW, bandH);
      }
      ctx.globalAlpha = 1;
    }
  }

  /** Draw screen-space weather overlay (rain splatter on "lens") */
  drawOverlay(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (this.type === 'rain' && this.transitionAlpha > 0.1) {
      // Subtle blue-grey wash
      ctx.fillStyle = `rgba(100, 120, 150, ${0.04 * this.transitionAlpha})`;
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
  type: 'dust' | 'ember' | 'leaf' | 'sparkle';
}

export class AmbientParticles {
  private particles: AmbientParticle[] = [];
  private spawnAcc = 0;

  /** Spawn ambient particles near combat areas, resource nodes, and bases */
  update(dt: number, combatZones: { x: number; y: number }[]): void {
    this.spawnAcc += dt;

    // Spawn dust near combat
    if (this.spawnAcc > 0.15 && combatZones.length > 0) {
      this.spawnAcc = 0;
      const zone = combatZones[Math.floor(Math.random() * combatZones.length)];
      this.particles.push({
        x: zone.x * T + (Math.random() - 0.5) * T * 3,
        y: zone.y * T + (Math.random() - 0.5) * T * 2,
        vx: (Math.random() - 0.5) * 15,
        vy: -5 - Math.random() * 15,
        size: 1 + Math.random() * 1.5,
        alpha: 0, maxAlpha: 0.3 + Math.random() * 0.3,
        age: 0, maxAge: 0.8 + Math.random() * 0.6,
        color: '#c8b090',
        type: 'dust',
      });
    }

    // Update
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.maxAge) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // Fade in then out
      const life = p.age / p.maxAge;
      p.alpha = life < 0.2 ? (life / 0.2) * p.maxAlpha
        : p.maxAlpha * (1 - (life - 0.2) / 0.8);
    }

    // Cap
    if (this.particles.length > 150) this.particles.length = 150;
  }

  /** Spawn embers for Demon race, leaves for Wild/Tenders */
  spawnRaceParticle(x: number, y: number, race: Race): void {
    if (this.particles.length > 120) return;
    if (Math.random() > 0.008) return; // ~0.8% chance per unit per frame

    let color: string;
    let type: AmbientParticle['type'];
    let vy: number;

    switch (race) {
      case Race.Demon:
        color = Math.random() > 0.5 ? '#ff6600' : '#ff3300';
        type = 'ember';
        vy = -20 - Math.random() * 30;
        break;
      case Race.Wild:
      case Race.Tenders:
        color = Math.random() > 0.5 ? '#4a7a2a' : '#6a9a3a';
        type = 'leaf';
        vy = 5 + Math.random() * 10;
        break;
      case Race.Deep:
        color = 'rgba(100, 180, 255, 0.7)';
        type = 'sparkle';
        vy = -5 - Math.random() * 10;
        break;
      case Race.Geists:
        color = 'rgba(180, 160, 255, 0.6)';
        type = 'sparkle';
        vy = -10 - Math.random() * 15;
        break;
      default:
        return;
    }

    this.particles.push({
      x: x * T + (Math.random() - 0.5) * T * 2,
      y: y * T,
      vx: (Math.random() - 0.5) * 20,
      vy,
      size: 1 + Math.random() * 1.5,
      alpha: 0, maxAlpha: 0.4 + Math.random() * 0.3,
      age: 0, maxAge: 0.5 + Math.random() * 0.8,
      color,
      type,
    });
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      if (p.type === 'sparkle') {
        // Small diamond shape
        const s = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - s);
        ctx.lineTo(p.x + s * 0.6, p.y);
        ctx.lineTo(p.x, p.y + s);
        ctx.lineTo(p.x - s * 0.6, p.y);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
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

  addPoint(x: number, y: number, color: string): void {
    this.trails.push({ x: x * T + T / 2, y: y * T + T / 2, age: 0, color });
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

  /** Feed in combat events from the simulation tick */
  consume(events: CombatEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'splash':
          this.rings.push({
            x: e.x * T, y: e.y * T,
            maxRadius: (e.radius ?? 3) * T,
            color: e.color, age: 0, maxAge: 0.4,
          });
          break;
        case 'pulse':
          this.rings.push({
            x: e.x * T, y: e.y * T,
            maxRadius: (e.radius ?? 6) * T,
            color: e.color, age: 0, maxAge: 0.5,
          });
          break;
        case 'chain':
          this.arcs.push({
            x1: e.x * T, y1: e.y * T,
            x2: (e.x2 ?? e.x) * T, y2: (e.y2 ?? e.y) * T,
            color: e.color, age: 0, maxAge: 0.3,
          });
          break;
        case 'lifesteal':
          this.sparkles.push({
            x: e.x * T, y: e.y * T, color: e.color,
            x2: (e.x2 ?? e.x) * T, y2: (e.y2 ?? e.y) * T,
            age: 0, maxAge: 0.35, type: 'lifesteal',
          });
          break;
        case 'heal':
          this.sparkles.push({
            x: e.x * T, y: e.y * T, color: e.color,
            age: 0, maxAge: 0.5, type: 'heal',
          });
          break;
        case 'dodge':
          this.sparkles.push({
            x: e.x * T, y: e.y * T, color: e.color,
            age: 0, maxAge: 0.25, type: 'dodge',
          });
          break;
        case 'revive':
          this.rings.push({
            x: e.x * T, y: e.y * T, maxRadius: T * 2.5,
            color: e.color, age: 0, maxAge: 0.5,
          });
          this.sparkles.push({
            x: e.x * T, y: e.y * T, color: e.color,
            age: 0, maxAge: 0.5, type: 'revive',
          });
          break;
        case 'cleanse':
          this.sparkles.push({
            x: e.x * T, y: e.y * T, color: e.color,
            age: 0, maxAge: 0.4, type: 'cleanse',
          });
          break;
        case 'knockback':
          this.sparkles.push({
            x: e.x * T, y: e.y * T, color: e.color,
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
