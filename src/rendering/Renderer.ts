import { Camera } from './Camera';
import { SpriteLoader, drawSpriteFrame, drawGridFrame, getSpriteFrame, type SpriteDef, type GridSpriteDef } from './SpriteLoader';
import { UIAssets } from './UIAssets';
import {
  GameState, Team, MAP_WIDTH, MAP_HEIGHT, TILE_SIZE, TICK_RATE,
  ZONES,
  HQ_WIDTH, HQ_HEIGHT, HQ_HP,
  BuildingType, Lane, Vec2,
  StatusType, Race, ResourceType, HarvesterAssignment,
  type MapDef,
  type BuildingState, type UnitState, type HarvesterState, type ProjectileState,
} from '../simulation/types';
import { DUEL_MAP } from '../simulation/maps';
import { getHQPosition, getBuildGridOrigin, getHutGridOrigin, getTeamAlleyOrigin, getUnitUpgradeMultipliers } from '../simulation/GameState';
import { RACE_COLORS, TOWER_STATS, PLAYER_COLORS, getRaceUsedResources } from '../simulation/data';
import {
  getDayNight, DayNightState,
  ScreenShake, WeatherSystem, AmbientParticles,
  ProjectileTrails, ConstructionAnims, HitFlashTracker, CombatVFX, triggerHaptic,
} from './VisualEffects';
import { getSafeTop, getSafeBottom } from '../ui/SafeArea';
import { getVisualSettings } from './VisualSettings';

const T = TILE_SIZE;
const LANE_LEFT_COLOR = '#4fc3f7';
const LANE_RIGHT_COLOR = '#ff8a65';
const DEAD_UNIT_LIFETIME_SEC = 0.9;

type UnitCategory = 'melee' | 'ranged' | 'caster';

interface DeadUnitSnapshot {
  id: number;
  x: number;
  y: number;
  team: Team;
  playerId: number;
  race?: Race;
  category: UnitCategory;
  upgradeNode?: string;
  upgradeTier: number;
  lane: Lane;
  faceLeft: boolean;
  wasAttacking: boolean;
  frame: number;
  ageSec: number;
}

interface UnitRenderSnapshot {
  x: number;
  y: number;
  team: Team;
  playerId: number;
  race?: Race;
  category: UnitCategory;
  upgradeNode?: string;
  upgradeTier: number;
  lane: Lane;
  faceLeft: boolean;
  wasAttacking: boolean;
  frame: number;
}

/** Convert a #rrggbb hex color to an `rgba(r,g,b,` prefix string for use as `hexToRgba(c) + '0.5)'` */
function hexToRgba(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},`;
}

function quickChatStyle(message: string): { icon: string; color: string } {
  if (message === 'Attack Left') return { icon: '<', color: '#4fc3f7' };
  if (message === 'Attack Right') return { icon: '>', color: '#ff8a65' };
  if (message === 'Get Diamond') return { icon: 'D', color: '#ffe082' };
  if (message === 'Nuking Now!') return { icon: 'N', color: '#ff1744' };
  return { icon: '!', color: '#ffcc80' };
}

// Seeded random for deterministic decoration placement
function seededRand(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; };
}

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  camera: Camera;
  sprites: SpriteLoader;
  ui: UIAssets;
  /** Which player slot the local user controls (0 = host/solo, 1 = guest). */
  localPlayerId = 0;
  /** Set by InputHandler — the building type the player is currently placing, or null. */
  placingBuilding: BuildingType | null = null;
  private terrainCache: HTMLCanvasElement | null = null;
  private waterCache: HTMLCanvasElement | null = null;
  private terrainReady = false;
  private waterEdges: { x: number; y: number; dirs: number }[] = [];
  // Track previous x per entity for facing direction
  private prevX = new Map<number, number>();
  private facing = new Map<number, boolean>(); // true = face left
  // Death effects: client-side animated sprites at death locations
  private deathEffects: { x: number; y: number; frame: number; maxFrames: number; size: number; type: 'dust' | 'explosion' | 'race_burst'; race?: Race }[] = [];
  private deadUnits: DeadUnitSnapshot[] = [];
  // Track unit/building IDs from last frame to detect removals
  private lastUnitIds = new Set<number>();
  private lastUnitPositions = new Map<number, { x: number; y: number; team: number; race?: Race }>();
  private lastUnitRenders = new Map<number, UnitRenderSnapshot>();
  private lastBuildingIds = new Set<number>();
  private lastBuildingPositions = new Map<number, { x: number; y: number; hpPct: number }>();
  // Pooled sets to avoid per-frame allocations
  private _pooledUnitIds = new Set<number>();
  private _pooledBuildingIds = new Set<number>();
  private _pooledBuildingIds2 = new Set<number>();
  private _pooledCombatZones: { x: number; y: number }[] = [];

  // Visual effects systems
  private dayNight: DayNightState = getDayNight(0);
  screenShake = new ScreenShake();
  private weather = new WeatherSystem();
  private ambientParticles = new AmbientParticles();
  private projectileTrails = new ProjectileTrails();
  private constructionAnims = new ConstructionAnims();
  private hitFlash = new HitFlashTracker();
  private combatVfx = new CombatVFX();
  private lastConsumedTick = -1;
  private unitHpTracker = new Map<number, number>();
  private matchStartTime = Date.now();
  private lastFrameTime = Date.now();
  // Track known building IDs for construction anim detection
  private knownBuildingIds = new Set<number>();
  // Smooth HP bars: unitId -> displayed HP fraction
  private smoothHp = new Map<number, number>();
  // Track previous nuke effect count to detect new nukes
  private lastNukeCount = 0;
  // Track previous HQ HP values to detect destruction
  private lastHqHp: number[] = [-1, -1];
  // Map dimensions & definition — set from state.mapDef on first render, used throughout rendering
  private mapW = MAP_WIDTH;
  private mapH = MAP_HEIGHT;
  private mapDef: MapDef = DUEL_MAP;
  // Fog of war
  private fogCache: HTMLCanvasElement | null = null;
  private fogImageData: ImageData | null = null;
  /** Per-tile linger timer (seconds remaining of visibility after losing actual vision) */
  private fogLinger: Float32Array | null = null;
  private static readonly FOG_LINGER_DURATION = 2.0; // seconds
  // Resize listener cleanup
  private resizeHandler = () => this.resize();

  constructor(canvas: HTMLCanvasElement, ui?: UIAssets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.camera = new Camera(canvas);
    this.sprites = new SpriteLoader();
    this.ui = ui ?? new UIAssets();
    this.resize();
    window.addEventListener('resize', this.resizeHandler);
    // Lightning triggers a subtle screen shake
    this.weather.onLightning = () => {
      if (getVisualSettings().screenShake) this.screenShake.trigger(1.5, 0.15);
    };
  }

  destroy(): void {
    window.removeEventListener('resize', this.resizeHandler);
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
  }

  /** Update facing direction for an entity based on movement. Returns true if facing left.
   *  Only updates when horizontal movement is significant (> 0.15 tiles/frame) to prevent
   *  minor path curves from flipping asymmetric sprites. */
  private updateFacing(id: number, x: number, defaultLeft: boolean): boolean {
    const prev = this.prevX.get(id);
    if (prev !== undefined) {
      const dx = x - prev;
      if (Math.abs(dx) > 0.15) {
        this.facing.set(id, dx < 0);
      }
    }
    this.prevX.set(id, x);
    return this.facing.get(id) ?? defaultLeft;
  }

  /** Check if a world-tile position is visible to the local player's team (includes linger) */
  private isTileVisible(state: GameState, tileX: number, tileY: number): boolean {
    if (!state.fogOfWar) return true;
    const team = state.players[this.localPlayerId]?.team ?? 0;
    const vis = state.visibility[team];
    if (!vis) return true;
    const ix = Math.floor(tileX);
    const iy = Math.floor(tileY);
    if (ix < 0 || ix >= state.mapDef.width || iy < 0 || iy >= state.mapDef.height) return false;
    const idx = iy * state.mapDef.width + ix;
    return vis[idx] || (this.fogLinger !== null && this.fogLinger[idx] > 0);
  }

  /** Draw fog of war overlay — dark tiles where the team has no vision */
  private drawFogOfWar(ctx: CanvasRenderingContext2D, state: GameState, dt: number): void {
    const team = state.players[this.localPlayerId]?.team ?? 0;
    const vis = state.visibility[team];
    if (!vis) return;

    const mw = state.mapDef.width;
    const mh = state.mapDef.height;
    const totalTiles = mw * mh;

    // Init or resize linger array
    if (!this.fogLinger || this.fogLinger.length !== totalTiles) {
      this.fogLinger = new Float32Array(totalTiles);
    }

    // Update linger timers
    const linger = this.fogLinger;
    const LINGER = Renderer.FOG_LINGER_DURATION;
    for (let i = 0; i < totalTiles; i++) {
      if (vis[i]) {
        // Currently visible — reset linger to full
        linger[i] = LINGER;
      } else if (linger[i] > 0) {
        // Was visible, now fading out
        linger[i] = Math.max(0, linger[i] - dt);
      }
    }

    // Rebuild fog cache every frame (linger fades continuously)
    if (!this.fogCache) {
      this.fogCache = document.createElement('canvas');
    }
    {
      this.fogCache.width = mw;
      this.fogCache.height = mh;
      const fctx = this.fogCache.getContext('2d')!;
      // Draw black pixels for hidden tiles using ImageData for speed
      if (!this.fogImageData || this.fogImageData.width !== mw || this.fogImageData.height !== mh) {
        this.fogImageData = fctx.createImageData(mw, mh);
      }
      const imgData = this.fogImageData;
      const d = imgData.data;
      // Clear the data buffer since we're reusing it
      d.fill(0);
      const FOG_ALPHA = 180;
      for (let i = 0; i < totalTiles; i++) {
        if (vis[i]) continue; // fully visible — no fog
        const p = i * 4;
        if (linger[i] > 0) {
          // Lingering — fade from transparent to full fog
          const t = 1 - linger[i] / LINGER;
          d[p + 3] = Math.round(FOG_ALPHA * t);
        } else {
          d[p + 3] = FOG_ALPHA; // fully fogged
        }
      }
      fctx.putImageData(imgData, 0, 0);
    }

    // Draw fog cache scaled to world coordinates (bilinear smoothing for soft edges)
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.fogCache, 0, 0, mw * T, mh * T);
    ctx.imageSmoothingEnabled = false;
  }

  render(state: GameState, networkLatencyMs?: number, desyncDetected?: boolean, peerDisconnected?: boolean, waitingForAllyMs?: number): void {
    // Update map dimensions from state (supports different map sizes)
    this.mapDef = state.mapDef;
    this.mapW = state.mapDef.width;
    this.mapH = state.mapDef.height;
    this.weather.mapW = this.mapW;
    this.weather.mapH = this.mapH;

    const now = Date.now();
    const dt = Math.min((now - this.lastFrameTime) / 1000, 0.1);
    this.lastFrameTime = now;
    const elapsedSec = (now - this.matchStartTime) / 1000;

    // Detect deaths: compare current IDs to last frame
    this.detectDeaths(state);
    // Detect new buildings for construction animation
    this.detectNewBuildings(state);
    // Track HP changes for hit flash
    this.hitFlash.updateFromState(this.unitHpTracker, state.units);

    // Update visual effects (respect user preferences)
    const vfxPrefs = getVisualSettings();
    this.dayNight = vfxPrefs.dayNight ? getDayNight(elapsedSec) : getDayNight(0.25 * 240); // noon
    if (vfxPrefs.screenShake) this.screenShake.update(dt); else { this.screenShake.offsetX = 0; this.screenShake.offsetY = 0; }
    if (vfxPrefs.weather) this.weather.update(dt, elapsedSec, this.dayNight.phase, this.dayNight.brightness);
    // Force heavy rain during Deep deluge ability
    const hasDeluge = state.abilityEffects.some(e => e.type === 'deep_rain');
    if (hasDeluge && this.weather.type !== 'rain') {
      this.weather.type = 'rain';
    }
    // Screen shake for fireball impact
    const hasFireball = state.abilityEffects.some(e => e.type === 'demon_fireball' && e.duration > 0.6 * TICK_RATE);
    if (hasFireball && vfxPrefs.screenShake) {
      this.screenShake.trigger(6, 0.4);
    }
    this.projectileTrails.update(dt);
    this.updateDeadUnits(dt);
    if (state.tick !== this.lastConsumedTick) {
      this.combatVfx.consume(state.combatEvents);
      this.lastConsumedTick = state.tick;
    }
    this.combatVfx.update(dt);

    // Detect nuke detonation for screen shake + haptic
    if (state.nukeEffects.length > this.lastNukeCount) {
      if (vfxPrefs.screenShake) this.screenShake.trigger(8, 0.6);
      triggerHaptic(200, 1.0);
    }
    this.lastNukeCount = state.nukeEffects.length;

    // Screen shake on HQ destroyed
    if (this.lastHqHp[0] >= 0) {
      for (let t = 0; t < state.hqHp.length; t++) {
        if ((this.lastHqHp[t] ?? 0) > 0 && state.hqHp[t] <= 0) {
          if (vfxPrefs.screenShake) this.screenShake.trigger(12, 1.0);
          triggerHaptic(300, 1.0);
        }
      }
    }
    this.lastHqHp = [...state.hqHp];

    // Gather combat zones for ambient particles
    const combatZones = this._pooledCombatZones;
    combatZones.length = 0;
    for (const u of state.units) {
      if (u.targetId !== null) combatZones.push({ x: u.x, y: u.y });
    }
    this.ambientParticles.update(dt, combatZones);

    // Spawn race-themed ambient particles near units
    for (const u of state.units) {
      const race = state.players[u.playerId]?.race;
      if (race) this.ambientParticles.spawnRaceParticle(u.x, u.y, race);
    }

    // Record projectile trail points (every 3rd frame to limit volume)
    if (state.tick % 3 === 0) {
      for (const p of state.projectiles) {
        const race = state.players[p.sourcePlayerId]?.race;
        const color = race ? (RACE_COLORS[race]?.primary ?? '#fff') : '#fff';
        this.projectileTrails.addPoint(p.x, p.y, color);
      }
    }

    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#4a8a7b';
    ctx.fillRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);

    // Apply camera + screen shake
    this.camera.applyTransform(ctx);
    if (this.screenShake.active) {
      ctx.translate(this.screenShake.offsetX, this.screenShake.offsetY);
    }

    this.drawZones(ctx, state.tick);
    this.drawLanePaths(ctx);
    this.drawDiamondCells(ctx, state);
    this.drawResourceNodes(ctx, state);
    this.drawBuildGrids(ctx, state);
    this.drawHutZones(ctx, state);
    this.drawTowerAlleys(ctx, state);
    this.drawYSorted(ctx, state);
    this.drawDiamondObjective(ctx, state);
    this.drawNukeTelegraphs(ctx, state);
    this.drawPings(ctx, state);
    this.drawTowerAttackLines(ctx, state);
    this.projectileTrails.draw(ctx);
    this.combatVfx.draw(ctx);
    this.drawParticles(ctx, state);
    this.ambientParticles.draw(ctx);
    this.drawDeathEffects(ctx);
    this.drawFloatingTexts(ctx, state);
    this.drawNukeEffects(ctx, state);
    this.drawAbilityEffects(ctx, state);

    // Fog of war overlay (world-space, after entities, before day/night)
    if (state.fogOfWar) {
      this.drawFogOfWar(ctx, state, dt);
    }

    // Weather particles (world-space)
    if (vfxPrefs.weather) this.weather.drawWorld(ctx);

    // Day/night tint overlay (world-space)
    if (vfxPrefs.dayNight && this.dayNight.tintAlpha > 0.005) {
      ctx.fillStyle = this.dayNight.tint;
      ctx.fillRect(
        this.camera.x - 100, this.camera.y - 100,
        this.canvas.clientWidth / this.camera.zoom + 200,
        this.canvas.clientHeight / this.camera.zoom + 200
      );
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Weather screen overlay
    if (vfxPrefs.weather) this.weather.drawOverlay(ctx, this.canvas.clientWidth, this.canvas.clientHeight);
    this.drawHUD(ctx, state, networkLatencyMs, desyncDetected, peerDisconnected, waitingForAllyMs);
    this.drawQuickChats(ctx, state);
    this.drawMinimap(ctx, state);
  }

  // === Terrain (Pre-rendered) ===

  private buildTerrainCache(): void {
    const tilemapData = this.sprites.getTerrainSprite('tilemap');
    if (!tilemapData) return; // tilemap not loaded yet

    const [tilemap] = tilemapData;

    const mapDef = this.mapDef;
    const mW = this.mapW;
    const mH = this.mapH;

    // Helper: is tile at (tx,ty) land (within the map shape)?
    const isLand = (tx: number, ty: number): boolean => {
      return mapDef.isPlayable(tx, ty);
    };

    // ---- Build static water cache (water bg + rocks + clouds) ----
    const wc = document.createElement('canvas');
    wc.width = mW * T;
    wc.height = mH * T;
    const wctx = wc.getContext('2d')!;

    const waterBgData = this.sprites.getTerrainSprite('waterBg');
    if (waterBgData) {
      const [waterImg] = waterBgData;
      for (let y = 0; y < wc.height; y += T) {
        for (let x = 0; x < wc.width; x += T) {
          wctx.drawImage(waterImg, x, y, T, T);
        }
      }
    } else {
      wctx.fillStyle = '#5b9a8b';
      wctx.fillRect(0, 0, wc.width, wc.height);
    }

    const rand = seededRand(42);
    const waterRock1Data = this.sprites.getTerrainSprite('waterRock1');
    const waterRock2Data = this.sprites.getTerrainSprite('waterRock2');
    if (waterRock1Data || waterRock2Data) {
      for (let i = 0; i < 20; i++) {
        // For landscape maps, scatter rocks in the margin areas
        const axisPos = mapDef.shapeAxis === 'x'
          ? Math.floor(rand() * mW)  // iterate columns for landscape
          : Math.floor(rand() * mH); // iterate rows for portrait
        const range = mapDef.getPlayableRange(axisPos);
        const marginSize = range.min; // margin at start
        const endMargin = (mapDef.shapeAxis === 'x' ? mH : mW) - range.max;
        const side = rand() < 0.5 ? 'left' : 'right';
        let x: number, y: number;
        if (mapDef.shapeAxis === 'x') {
          // Landscape: margins are top/bottom (y-axis), axisPos is x
          x = axisPos;
          if (side === 'left') {
            if (marginSize < 2) { rand(); continue; }
            y = Math.floor(rand() * marginSize);
          } else {
            if (endMargin < 2) { rand(); continue; }
            y = range.max + Math.floor(rand() * endMargin);
          }
        } else {
          // Portrait: margins are left/right (x-axis), axisPos is y
          y = axisPos;
          if (side === 'left') {
            if (marginSize < 2) { rand(); continue; }
            x = Math.floor(rand() * marginSize);
          } else {
            if (endMargin < 2) { rand(); continue; }
            x = range.max + Math.floor(rand() * endMargin);
          }
        }
        const rockData = (i % 2 === 0 && waterRock1Data) ? waterRock1Data : (waterRock2Data ?? waterRock1Data);
        if (!rockData) continue;
        const [rImg, rDef] = rockData;
        const frame = Math.floor(rand() * rDef.cols);
        const s = T * (1.5 + rand() * 1.0);
        const aspect = rDef.frameW / rDef.frameH;
        drawSpriteFrame(wctx, rImg, rDef, frame, x * T - s / 2, y * T - s * 0.5, s * aspect, s);
      }
    }

    const cloud1Data = this.sprites.getTerrainSprite('cloud1');
    const cloud2Data = this.sprites.getTerrainSprite('cloud2');
    const cloud3Data = this.sprites.getTerrainSprite('cloud3');
    const clouds = [cloud1Data, cloud2Data, cloud3Data].filter(Boolean) as [HTMLImageElement, SpriteDef][];
    if (clouds.length > 0) {
      for (let i = 0; i < 12; i++) {
        const axisPos2 = mapDef.shapeAxis === 'x'
          ? Math.floor(rand() * mW)
          : Math.floor(rand() * mH);
        const range2 = mapDef.getPlayableRange(axisPos2);
        const cMargin = range2.min;
        const cEndMargin = (mapDef.shapeAxis === 'x' ? mH : mW) - range2.max;
        const side = rand() < 0.5 ? 'left' : 'right';
        let x: number, y: number;
        if (mapDef.shapeAxis === 'x') {
          x = axisPos2;
          if (side === 'left') {
            if (cMargin < 3) { rand(); continue; }
            y = Math.floor(rand() * cMargin);
          } else {
            if (cEndMargin < 2) { rand(); continue; }
            y = range2.max + Math.floor(rand() * cEndMargin);
          }
        } else {
          y = axisPos2;
          if (side === 'left') {
            if (cMargin < 3) { rand(); continue; }
            x = Math.floor(rand() * cMargin);
          } else {
            if (cEndMargin < 2) { rand(); continue; }
            x = range2.max + Math.floor(rand() * cEndMargin);
          }
        }
        const [cImg, cDef] = clouds[Math.floor(rand() * clouds.length)];
        const cw = T * (4 + rand() * 3);
        const ch = cw * (cDef.frameH / cDef.frameW);
        wctx.globalAlpha = 0.5 + rand() * 0.3;
        wctx.drawImage(cImg, x * T - cw / 2, y * T - ch / 2, cw, ch);
      }
      wctx.globalAlpha = 1;
    }

    // Water depth: darken tiles far from land for sense of depth
    for (let y = 0; y < mH; y++) {
      for (let x = 0; x < mW; x++) {
        if (isLand(x, y)) continue;
        // Find minimum distance to any land tile (cheap taxicab check)
        let minDist = 99;
        for (let d = 1; d <= 5; d++) {
          if (isLand(x - d, y) || isLand(x + d, y) || isLand(x, y - d) || isLand(x, y + d)) {
            minDist = d; break;
          }
        }
        if (minDist > 1) {
          // Shallow near coast (dist 2), deep far out (dist 5+)
          const depth = Math.min(1, (minDist - 1) / 4);
          wctx.fillStyle = `rgba(0,15,30,${(depth * 0.15).toFixed(3)})`;
          wctx.fillRect(x * T, y * T, T, T);
        }
      }
    }

    this.waterCache = wc;

    // ---- Build land terrain cache (cliff faces + grass + decorations) ----
    const tc = document.createElement('canvas');
    tc.width = mW * T;
    tc.height = mH * T;
    const tctx = tc.getContext('2d')!;

    // Tilemap source tile size
    const S = 64;

    // Pre-compute and store water edge tiles for per-frame foam animation
    this.waterEdges = [];
    for (let y = 0; y < mH; y++) {
      for (let x = 0; x < mW; x++) {
        if (isLand(x, y)) continue;
        const n = isLand(x, y - 1) ? 1 : 0;
        const s = isLand(x, y + 1) ? 2 : 0;
        const w = isLand(x - 1, y) ? 4 : 0;
        const e = isLand(x + 1, y) ? 8 : 0;
        const dirs = n | s | w | e;
        if (dirs) this.waterEdges.push({ x, y, dirs });
      }
    }

    // 1. Cliff faces (programmatic stone gradient below grass edges)
    for (const edge of this.waterEdges) {
      if (!(edge.dirs & 1)) continue; // only south-facing cliffs (land to north)
      const px = edge.x * T;
      const py = edge.y * T;
      // Stone cliff face gradient
      const grad = tctx.createLinearGradient(px, py, px, py + T);
      grad.addColorStop(0, '#6b8a7a');
      grad.addColorStop(0.3, '#5a7868');
      grad.addColorStop(1, '#4a6858');
      tctx.fillStyle = grad;
      tctx.fillRect(px, py, T, T);
      // Vertical stone line detail
      tctx.fillStyle = 'rgba(0,0,0,0.12)';
      for (let lx = 3; lx < T; lx += 5) {
        tctx.fillRect(px + lx, py, 1, T);
      }
    }
    // Second row of cliff (extends depth)
    for (let y = 0; y < mH; y++) {
      for (let x = 0; x < mW; x++) {
        if (isLand(x, y)) continue;
        if (isLand(x, y - 1)) continue; // skip first row (already drawn above)
        if (!isLand(x, y - 2)) continue; // need land 2 rows up
        const px = x * T;
        const py = y * T;
        const grad = tctx.createLinearGradient(px, py, px, py + T);
        grad.addColorStop(0, '#4a6858');
        grad.addColorStop(1, '#3a5848');
        tctx.fillStyle = grad;
        tctx.fillRect(px, py, T, T);
        tctx.fillStyle = 'rgba(0,0,0,0.08)';
        for (let lx = 3; lx < T; lx += 5) {
          tctx.fillRect(px + lx, py, 1, T);
        }
      }
    }

    // 2. Autotiled grass with proper edge tiles (9-patch from tilemap)
    //    Uses tilemap2 for ~25% of center tiles to create organic grass patches
    const tilemap2Data = this.sprites.getTerrainSprite('tilemap2');
    const tilemap2Img = tilemap2Data ? tilemap2Data[0] : null;
    const OV = 3; // pixel overhang for edge tiles
    for (let y = 0; y < mH; y++) {
      for (let x = 0; x < mW; x++) {
        if (!isLand(x, y)) continue;

        const n = isLand(x, y - 1);
        const s = isLand(x, y + 1);
        const e = isLand(x + 1, y);
        const w = isLand(x - 1, y);

        let gsx: number, gsy: number;
        let edge = true;

        if      (!n && !w) { gsx = 0;     gsy = 0; }      // TL corner
        else if (!n && !e) { gsx = 2 * S; gsy = 0; }      // TR corner
        else if (!s && !w) { gsx = 0;     gsy = 2 * S; }  // BL corner
        else if (!s && !e) { gsx = 2 * S; gsy = 2 * S; }  // BR corner
        else if (!n)       { gsx = S;     gsy = 0; }      // top edge
        else if (!s)       { gsx = S;     gsy = 2 * S; }  // bottom edge
        else if (!w)       { gsx = 0;     gsy = S; }      // left edge
        else if (!e)       { gsx = 2 * S; gsy = S; }      // right edge
        else               { gsx = S;     gsy = S; edge = false; } // center

        // For center tiles, use tilemap2 for clustered color patches (~25%)
        const hash = ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1 + 1) % 1;
        const useAlt = !edge && tilemap2Img && hash < 0.25;
        const srcImg = useAlt ? tilemap2Img : tilemap;

        if (edge) {
          tctx.drawImage(srcImg, gsx, gsy, S, S,
            x * T - OV, y * T - OV, T + OV * 2, T + OV * 2);
        } else {
          tctx.drawImage(srcImg, gsx, gsy, S, S, x * T, y * T, T, T);
        }
      }
    }

    // 2b. Low-frequency warm/cool color zones (sampled every 4 tiles, then per-tile noise)
    for (let y = 0; y < mH; y++) {
      for (let x = 0; x < mW; x++) {
        if (!isLand(x, y)) continue;
        // Low-freq zone color: smooth sine-based field sampled at ~4-tile scale
        const zoneVal = Math.sin(x * 0.25 + 1.7) * Math.sin(y * 0.19 + 0.3)
                      + Math.sin(x * 0.13 - y * 0.11 + 2.5) * 0.5;
        if (zoneVal > 0.3) {
          // Warm sunlit zone (slight golden tint)
          tctx.fillStyle = `rgba(255,230,140,${(0.025 * Math.min(1, (zoneVal - 0.3) / 0.7)).toFixed(4)})`;
          tctx.fillRect(x * T, y * T, T, T);
        } else if (zoneVal < -0.3) {
          // Cool shaded zone (slight blue-green tint)
          tctx.fillStyle = `rgba(100,180,160,${(0.03 * Math.min(1, (-zoneVal - 0.3) / 0.7)).toFixed(4)})`;
          tctx.fillRect(x * T, y * T, T, T);
        }
        // Per-tile noise on top
        const h = ((Math.sin(x * 7.137 + y * 11.921) * 23421.631) % 1 + 1) % 1;
        if (h < 0.15) {
          tctx.fillStyle = 'rgba(0,0,0,0.04)';
          tctx.fillRect(x * T, y * T, T, T);
        } else if (h > 0.85) {
          tctx.fillStyle = 'rgba(255,255,200,0.03)';
          tctx.fillRect(x * T, y * T, T, T);
        }
      }
    }

    // 2c. Cliff-edge shadow on grass tiles above south-facing cliffs
    //     + light highlight on grass tiles above north-facing water (top-left light)
    for (let y = 0; y < mH; y++) {
      for (let x = 0; x < mW; x++) {
        if (!isLand(x, y)) continue;
        const px = x * T;
        const py = y * T;
        if (!isLand(x, y + 1)) {
          // South cliff shadow
          const grad = tctx.createLinearGradient(px, py + T * 0.5, px, py + T);
          grad.addColorStop(0, 'rgba(0,0,0,0)');
          grad.addColorStop(1, 'rgba(0,30,20,0.15)');
          tctx.fillStyle = grad;
          tctx.fillRect(px, py + T * 0.5, T, T * 0.5);
        }
        if (!isLand(x, y - 1)) {
          // North edge highlight (light from above)
          const grad = tctx.createLinearGradient(px, py, px, py + T * 0.4);
          grad.addColorStop(0, 'rgba(255,255,220,0.06)');
          grad.addColorStop(1, 'rgba(255,255,220,0)');
          tctx.fillStyle = grad;
          tctx.fillRect(px, py, T, T * 0.4);
        }
        if (!isLand(x - 1, y)) {
          // West edge highlight (light from left)
          const grad = tctx.createLinearGradient(px, py, px + T * 0.3, py);
          grad.addColorStop(0, 'rgba(255,255,220,0.04)');
          grad.addColorStop(1, 'rgba(255,255,220,0)');
          tctx.fillStyle = grad;
          tctx.fillRect(px, py, T * 0.3, T);
        }
      }
    }

    // 3. Subtle zone tinting over grass (team base areas)
    if (mapDef.shapeAxis === 'y') {
      // Portrait map: horizontal bands for top/bottom bases
      const drawZoneTint = (startRow: number, endRow: number, color: string) => {
        tctx.fillStyle = color;
        for (let y = startRow; y < endRow; y++) {
          const range = mapDef.getPlayableRange(y);
          tctx.fillRect(range.min * T, y * T, (range.max - range.min) * T, T);
        }
      };
      drawZoneTint(ZONES.TOP_BASE.start, ZONES.TOP_BASE.end, 'rgba(200, 0, 0, 0.06)');
      drawZoneTint(ZONES.BOTTOM_BASE.start, ZONES.BOTTOM_BASE.end, 'rgba(0, 80, 200, 0.06)');
    } else {
      // Landscape map: vertical bands for left/right bases
      const baseDepth = 18; // matches SK_BASE_DEPTH
      const teamColors = ['rgba(0, 80, 200, 0.06)', 'rgba(200, 0, 0, 0.06)'];
      const xRanges = [[0, baseDepth], [mW - baseDepth, mW]];
      for (let t = 0; t < 2; t++) {
        tctx.fillStyle = teamColors[t];
        for (let x = xRanges[t][0]; x < xRanges[t][1]; x++) {
          const range = mapDef.getPlayableRange(x);
          tctx.fillRect(x * T, range.min * T, T, (range.max - range.min) * T);
        }
      }
    }

    // Helper: distance to nearest water (cardinal, max 6)
    const distToWater = (tx: number, ty: number): number => {
      for (let d = 1; d <= 6; d++) {
        if (!isLand(tx - d, ty) || !isLand(tx + d, ty) || !isLand(tx, ty - d) || !isLand(tx, ty + d)) return d;
      }
      return 7;
    };

    // 4. Scatter bush decorations on grass (4 varieties, biased toward coastlines)
    const bushes = [
      this.sprites.getTerrainSprite('bush1'),
      this.sprites.getTerrainSprite('bush2'),
      this.sprites.getTerrainSprite('bush3'),
      this.sprites.getTerrainSprite('bush4'),
    ].filter(Boolean) as [HTMLImageElement, SpriteDef][];
    if (bushes.length > 0) {
      for (let i = 0; i < 70; i++) {
        const bx = Math.floor(rand() * mW);
        const by = Math.floor(rand() * mH);
        if (!mapDef.isPlayable(bx, by)) continue;
        if (!mapDef.isPlayable(bx - 2, by) || !mapDef.isPlayable(bx + 2, by)) continue;
        // Density gradient: 80% chance near coast (dist 2-4), 30% chance deep inland
        const dist = distToWater(bx, by);
        const placePct = dist <= 4 ? 0.8 : 0.3;
        if (rand() > placePct) continue;
        const [bImg, bDef] = bushes[Math.floor(rand() * bushes.length)];
        const frame = Math.floor(rand() * bDef.cols);
        const s = T * (1.0 + rand() * 0.6);
        const aspect = bDef.frameW / bDef.frameH;
        tctx.globalAlpha = 0.7 + rand() * 0.3;
        drawSpriteFrame(tctx, bImg, bDef, frame, bx * T - s / 2, by * T - s * 0.5, s * aspect, s);
      }
      tctx.globalAlpha = 1;
    }

    // 5. Scatter small land rocks on grass (biased toward coastlines)
    const rocks = [
      this.sprites.getTerrainSprite('rock2'),
      this.sprites.getTerrainSprite('rock3'),
      this.sprites.getTerrainSprite('rock4'),
    ].filter(Boolean) as [HTMLImageElement, SpriteDef][];
    if (rocks.length > 0) {
      for (let i = 0; i < 45; i++) {
        const rx = Math.floor(rand() * mW);
        const ry = Math.floor(rand() * mH);
        if (!mapDef.isPlayable(rx, ry)) continue;
        if (!mapDef.isPlayable(rx - 1, ry) || !mapDef.isPlayable(rx + 1, ry)) continue;
        const dist = distToWater(rx, ry);
        const placePct = dist <= 3 ? 0.7 : 0.25;
        if (rand() > placePct) continue;
        const [rImg] = rocks[Math.floor(rand() * rocks.length)];
        const s = T * (0.5 + rand() * 0.4);
        tctx.globalAlpha = 0.5 + rand() * 0.3;
        tctx.drawImage(rImg, rx * T - s / 2 + rand() * T * 0.3, ry * T - s / 2 + rand() * T * 0.3, s, s);
      }
      tctx.globalAlpha = 1;
    }

    this.terrainCache = tc;
    this.terrainReady = true;
  }

  private drawWaterAnimation(ctx: CanvasRenderingContext2D, tick: number): void {
    // Visible tile range (camera-based culling)
    const cam = this.camera;
    const invZoom = 1 / cam.zoom;
    const sx = Math.max(0, Math.floor(cam.x / T) - 1);
    const sy = Math.max(0, Math.floor(cam.y / T) - 1);
    const ex = Math.min(this.mapW, Math.ceil((cam.x + ctx.canvas.clientWidth * invZoom) / T) + 1);
    const ey = Math.min(this.mapH, Math.ceil((cam.y + ctx.canvas.clientHeight * invZoom) / T) + 1);

    // 1. Broad water wave bands (covers all visible water, cheap)
    const waveCount = 6;
    for (let i = 0; i < waveCount; i++) {
      // Each wave band sweeps across the map diagonally
      const phase = tick * 0.03 + i * (Math.PI * 2 / waveCount);
      const bandY = ((Math.sin(phase) * 0.5 + 0.5) * this.mapH * T);
      const bandH = T * 3;
      const alpha = 0.025 + Math.sin(tick * 0.05 + i) * 0.015;
      if (alpha <= 0) continue;
      ctx.fillStyle = `rgba(180,240,255,${alpha.toFixed(3)})`;
      ctx.fillRect(0, bandY - bandH / 2, this.mapW * T, bandH);
    }

    // 1b. Specular highlights: drifting bright spots on open water
    for (let y = sy; y < ey; y++) {
      for (let x = sx; x < ex; x++) {
        if (this.mapDef.isPlayable(x, y)) continue;
        // Only on tiles away from shore (open water)
        const nearShore = this.mapDef.isPlayable(x - 1, y) || this.mapDef.isPlayable(x + 1, y)
          || this.mapDef.isPlayable(x, y - 1) || this.mapDef.isPlayable(x, y + 1);
        if (nearShore) continue;
        // Two overlapping sine fields create drifting highlights
        const s1 = Math.sin(tick * 0.025 + x * 0.7 + y * 0.4);
        const s2 = Math.sin(tick * 0.018 - x * 0.3 + y * 0.65 + 1.5);
        const bright = s1 * s2; // peaks when both sines align
        if (bright > 0.6) {
          const a = (bright - 0.6) * 0.2; // max ~0.08 alpha
          ctx.fillStyle = `rgba(220,245,255,${a.toFixed(3)})`;
          ctx.fillRect(x * T + T * 0.2, y * T + T * 0.2, T * 0.6, T * 0.6);
        }
      }
    }

    // 2. Per-tile shimmer on water edge tiles
    for (const edge of this.waterEdges) {
      if (edge.x < sx || edge.x >= ex || edge.y < sy || edge.y >= ey) continue;
      const wave1 = Math.sin(tick * 0.07 + edge.x * 0.8 + edge.y * 0.5);
      const wave2 = Math.sin(tick * 0.04 - edge.x * 0.3 + edge.y * 0.9);
      const shimmer = wave1 * 0.04 + wave2 * 0.03;
      if (shimmer > 0) {
        ctx.fillStyle = `rgba(180,235,245,${shimmer.toFixed(3)})`;
      } else {
        ctx.fillStyle = `rgba(0,30,50,${(-shimmer).toFixed(3)})`;
      }
      ctx.fillRect(edge.x * T, edge.y * T, T, T);
    }

    // 2. Foam at land-water edges
    const foamData = this.sprites.getTerrainSprite('waterFoam');
    if (foamData) {
      const [foamImg, foamDef] = foamData;
      const totalFrames = foamDef.cols;
      const fw = foamDef.frameW;
      const fh = foamDef.frameH;

      ctx.globalAlpha = 0.45;
      for (const edge of this.waterEdges) {
        if (edge.x < sx || edge.x >= ex || edge.y < sy || edge.y >= ey) continue;
        // Stagger foam animation per tile for organic look
        const frame = Math.floor((tick * 0.12 + edge.x * 3.7 + edge.y * 2.3) % totalFrames);
        const srcX = frame * fw;

        // Draw directional foam strips (only on sides facing land)
        const px = edge.x * T;
        const py = edge.y * T;
        const stripDepth = Math.ceil(T * 0.4);

        if (edge.dirs & 1) { // land to north — foam on top edge
          ctx.drawImage(foamImg, srcX, 0, fw, fh * 0.3, px - 2, py - 1, T + 4, stripDepth);
        }
        if (edge.dirs & 2) { // land to south — foam on bottom edge
          ctx.drawImage(foamImg, srcX, fh * 0.7, fw, fh * 0.3,
            px - 2, py + T - stripDepth + 1, T + 4, stripDepth);
        }
        if (edge.dirs & 4) { // land to west — foam on left edge
          ctx.drawImage(foamImg, srcX, 0, fw * 0.3, fh, px - 1, py - 2, stripDepth, T + 4);
        }
        if (edge.dirs & 8) { // land to east — foam on right edge
          ctx.drawImage(foamImg, srcX + fw * 0.7, 0, fw * 0.3, fh,
            px + T - stripDepth + 1, py - 2, stripDepth, T + 4);
        }
      }
      ctx.globalAlpha = 1;
    } else {
      // Programmatic foam fallback (white lines at edges)
      for (const edge of this.waterEdges) {
        if (edge.x < sx || edge.x >= ex || edge.y < sy || edge.y >= ey) continue;
        const px = edge.x * T;
        const py = edge.y * T;
        const foamAlpha = 0.12 + Math.sin(tick * 0.1 + edge.x * 1.5 + edge.y * 0.8) * 0.08;
        ctx.fillStyle = `rgba(200,240,250,${foamAlpha.toFixed(3)})`;
        if (edge.dirs & 1) ctx.fillRect(px, py, T, 3);
        if (edge.dirs & 2) ctx.fillRect(px, py + T - 3, T, 3);
        if (edge.dirs & 4) ctx.fillRect(px, py, 3, T);
        if (edge.dirs & 8) ctx.fillRect(px + T - 3, py, 3, T);
      }
    }
  }

  private drawZones(ctx: CanvasRenderingContext2D, tick: number): void {
    // Try to build terrain cache if not ready
    if (!this.terrainReady) {
      this.buildTerrainCache();
    }

    if (this.waterCache && this.terrainCache) {
      // Draw water background (static cache)
      ctx.drawImage(this.waterCache, 0, 0);
      // Draw animated water effects (shimmer + foam)
      this.drawWaterAnimation(ctx, tick);
      // Draw land terrain on top (grass + cliff + decorations, transparent water areas)
      ctx.drawImage(this.terrainCache, 0, 0);
    } else {
      // Fallback: simple water + grass colors
      ctx.fillStyle = '#5b9a8b';
      ctx.fillRect(0, 0, this.mapW * T, this.mapH * T);
      ctx.fillStyle = '#3a6b3a';
      for (let y = 0; y < this.mapH; y++) {
        for (let x = 0; x < this.mapW; x++) {
          if (this.mapDef.isPlayable(x, y)) {
            ctx.fillRect(x * T, y * T, T, T);
          }
        }
      }
    }
  }

  // === Lane Paths ===

  private drawLanePaths(ctx: CanvasRenderingContext2D): void {
    const drawPath = (points: readonly Vec2[], color: string) => {
      ctx.beginPath();
      ctx.moveTo(points[0].x * T, points[0].y * T);
      for (let i = 1; i < points.length; i++) {
        if (i < points.length - 1) {
          const mx = (points[i].x + points[i + 1].x) / 2 * T;
          const my = (points[i].y + points[i + 1].y) / 2 * T;
          ctx.quadraticCurveTo(points[i].x * T, points[i].y * T, mx, my);
        } else {
          ctx.lineTo(points[i].x * T, points[i].y * T);
        }
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 5;
      ctx.globalAlpha = 0.45;
      ctx.stroke();

      ctx.setLineDash([8, 12]);
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(points[0].x * T, points[0].y * T);
      for (let i = 1; i < points.length; i++) {
        if (i < points.length - 1) {
          const mx = (points[i].x + points[i + 1].x) / 2 * T;
          const my = (points[i].y + points[i + 1].y) / 2 * T;
          ctx.quadraticCurveTo(points[i].x * T, points[i].y * T, mx, my);
        } else ctx.lineTo(points[i].x * T, points[i].y * T);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    };

    // Draw lane paths for local player's team (team 0 by default for solo)
    const teamPaths = this.mapDef.lanePaths[0]; // team 0's lanes (both teams share same visual paths)
    drawPath(teamPaths.left, LANE_LEFT_COLOR);
    drawPath(teamPaths.right, LANE_RIGHT_COLOR);

    // Lane labels near diamond center
    const dc = this.mapDef.diamondCenter;
    ctx.font = 'bold 14px monospace';
    ctx.globalAlpha = 0.7;
    ctx.textAlign = 'center';
    if (this.mapDef.shapeAxis === 'y') {
      // Portrait: L on left, R on right (relative to diamond center)
      ctx.fillStyle = LANE_LEFT_COLOR;
      ctx.fillText('L', (dc.x - 20) * T, dc.y * T);
      ctx.fillStyle = LANE_RIGHT_COLOR;
      ctx.fillText('R', (dc.x + 20) * T, dc.y * T);
    } else {
      // Landscape: L on top, R on bottom
      ctx.fillStyle = LANE_LEFT_COLOR;
      ctx.fillText('L', dc.x * T, (dc.y - 14) * T);
      ctx.fillStyle = LANE_RIGHT_COLOR;
      ctx.fillText('R', dc.x * T, (dc.y + 14) * T);
    }
    ctx.textAlign = 'start';
    ctx.globalAlpha = 1;
  }

  // === Diamond Gold Cells ===

  private drawDiamondCells(ctx: CanvasRenderingContext2D, state: GameState): void {
    const goldStoneData = this.sprites.getResourceSprite('goldStone');

    for (const cell of state.diamondCells) {
      const px = cell.tileX * T;
      const py = cell.tileY * T;

      if (cell.gold > 0) {
        if (goldStoneData) {
          const [img, def] = goldStoneData;
          const pct = cell.gold / cell.maxGold;
          ctx.globalAlpha = 0.4 + pct * 0.6;
          const stoneSize = T * 3;
          const offset = (stoneSize - T) / 2;
          drawSpriteFrame(ctx, img, def, 0, px - offset, py - offset, stoneSize, stoneSize);
          ctx.globalAlpha = 1;
        } else {
          const pct = cell.gold / cell.maxGold;
          const brightness = 0.3 + pct * 0.7;
          const r = Math.round(200 * brightness);
          const g = Math.round(170 * brightness);
          const b = Math.round(20 * brightness);
          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
          ctx.fillRect(px, py, T, T);
          ctx.strokeStyle = `rgba(255, 215, 0, ${0.2 + pct * 0.3})`;
          ctx.lineWidth = 0.5;
          ctx.strokeRect(px, py, T, T);
        }
      } else {
        ctx.fillStyle = 'rgba(15, 12, 8, 0.6)';
        ctx.fillRect(px, py, T, T);
        ctx.fillStyle = 'rgba(100, 80, 20, 0.15)';
        ctx.fillRect(px + 3, py + 5, 2, 2);
        ctx.fillRect(px + 9, py + 10, 2, 2);
      }
    }

    const cx = state.mapDef.diamondCenter.x * T;
    const cy = state.mapDef.diamondCenter.y * T;
    if (!state.diamond.exposed) {
      ctx.fillStyle = 'rgba(40, 35, 10, 0.8)';
      ctx.fillRect(cx, cy, T, T);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx, cy, T, T);
    }
  }

  // === Resource Nodes ===

  private drawResourceNodes(ctx: CanvasRenderingContext2D, state: GameState): void {
    const drawNodeFallback = (x: number, y: number, label: string, color: string) => {
      const px = x * T, py = y * T;
      ctx.beginPath();
      ctx.arc(px, py, T * 1.2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.fillStyle = '#bbb';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(label, px, py + 4);
      ctx.textAlign = 'start';
    };

    const woodResData = this.sprites.getResourceSprite('woodResource');
    const drawWoodPile = (x: number, y: number, amount: number) => {
      const px = x * T;
      const py = y * T;
      const size = Math.min(1.0, 0.5 + amount * 0.05) * T;
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.14)';
      ctx.beginPath();
      ctx.ellipse(px, py + size * 0.15, size * 0.5, size * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
      if (woodResData) {
        const [img, def] = woodResData;
        drawSpriteFrame(ctx, img, def, 0, px - size * 0.5, py - size * 0.5, size, size);
      } else {
        // Fallback: simple brown circle
        ctx.fillStyle = '#8d5a35';
        ctx.beginPath();
        ctx.arc(px, py - size * 0.1, size * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    // Wood node — larger stitched forest cluster with visible chopped wood piles.
    const woodNode = state.mapDef.resourceNodes.find(n => n.type === ResourceType.Wood);
    const stoneNode = state.mapDef.resourceNodes.find(n => n.type === ResourceType.Stone);
    const tree1Data = this.sprites.getResourceSprite('tree');
    const tree2Data = this.sprites.getResourceSprite('tree2');
    const tree3Data = this.sprites.getResourceSprite('tree3');
    if (tree1Data && woodNode) {
      const cx = woodNode.x * T;
      const cy = woodNode.y * T;
      const now = Date.now() / 1000;
      const forestSeed = Math.floor(woodNode.x * 97 + woodNode.y * 131 + state.mapDef.width * 17);
      const rand = seededRand(forestSeed);
      const sprites = [tree1Data, tree2Data ?? tree1Data, tree3Data ?? tree1Data];
      const anchors = [
        { ox: -5.8, oy: -2.0, size: 2.15, sprite: 1 },
        { ox: -3.9, oy: -2.5, size: 2.25, sprite: 2 },
        { ox: -1.7, oy: -2.7, size: 2.45, sprite: 0 },
        { ox: 0.5, oy: -2.5, size: 2.5, sprite: 1 },
        { ox: 2.8, oy: -2.3, size: 2.3, sprite: 2 },
        { ox: 5.1, oy: -1.8, size: 2.15, sprite: 0 },
        { ox: -6.2, oy: 0.4, size: 2.45, sprite: 2 },
        { ox: -3.7, oy: 0.1, size: 2.75, sprite: 0 },
        { ox: -1.0, oy: -0.1, size: 2.95, sprite: 1 },
        { ox: 1.8, oy: 0.0, size: 3.05, sprite: 0 },
        { ox: 4.5, oy: 0.3, size: 2.8, sprite: 2 },
        { ox: 6.8, oy: 0.7, size: 2.35, sprite: 1 },
        { ox: -4.7, oy: 2.3, size: 2.25, sprite: 1 },
        { ox: -1.9, oy: 2.5, size: 2.4, sprite: 2 },
        { ox: 1.0, oy: 2.6, size: 2.35, sprite: 1 },
        { ox: 4.0, oy: 2.3, size: 2.15, sprite: 0 },
      ].map(anchor => ({
        ...anchor,
        ox: anchor.ox + (rand() - 0.5) * 0.55,
        oy: anchor.oy + (rand() - 0.5) * 0.4,
      }));
      const drawTree = (data: [HTMLImageElement, { frameW: number; frameH: number; cols: number; url: string }], x: number, y: number, size: number, phase: number) => {
        const [img, def] = data;
        const aspect = def.frameW / def.frameH; // <1 for tall trees
        const drawW = size * aspect;
        const drawH = size;
        const angle = Math.sin(now * 1.15 + phase) * 0.032;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        drawSpriteFrame(ctx, img, def, 0, -drawW / 2, -drawH * 0.84, drawW, drawH);
        ctx.restore();
      };

      // Ground shadow ellipses
      ctx.fillStyle = 'rgba(42, 88, 48, 0.18)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + T * 0.5, T * 6.8, T * 2.9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(81, 122, 63, 0.2)';
      ctx.beginPath();
      ctx.ellipse(cx - T * 1.1, cy + T * 0.2, T * 5.3, T * 2.1, 0.08, 0, Math.PI * 2);
      ctx.ellipse(cx + T * 1.6, cy + T * 0.45, T * 4.7, T * 1.9, -0.1, 0, Math.PI * 2);
      ctx.fill();

      // Per-tree shadows
      for (const anchor of anchors) {
        ctx.fillStyle = 'rgba(0,0,0,0.13)';
        ctx.beginPath();
        ctx.ellipse(
          cx + anchor.ox * T * 0.72,
          cy + anchor.oy * T * 0.48 + T * 0.42,
          anchor.size * T * 0.23,
          anchor.size * T * 0.1,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }

      // Interleave trees and wood piles by Y for proper depth
      const nearbyPiles = state.woodPiles
        .filter(pile => Math.hypot(pile.x - woodNode.x, pile.y - woodNode.y) < 8);
      type DrawItem = { sortY: number; draw: () => void };
      const items: DrawItem[] = [];
      for (const anchor of anchors) {
        const data = sprites[anchor.sprite % sprites.length];
        const ay = cy + anchor.oy * T * 0.48;
        items.push({ sortY: ay, draw: () => drawTree(
          data,
          cx + anchor.ox * T * 0.72,
          ay,
          anchor.size * T,
          anchor.sprite * 0.9 + anchor.ox * 0.2,
        )});
      }
      for (const pile of nearbyPiles) {
        items.push({ sortY: pile.y * T, draw: () => drawWoodPile(pile.x, pile.y, pile.amount) });
      }
      items.sort((a, b) => a.sortY - b.sortY);
      for (const item of items) item.draw();
    } else if (woodNode) {
      drawNodeFallback(woodNode.x, woodNode.y, 'WOOD', 'rgba(76, 175, 80, 0.2)');
      state.woodPiles
        .filter(pile => Math.hypot(pile.x - woodNode.x, pile.y - woodNode.y) < 8)
        .sort((a, b) => a.y - b.y)
        .forEach(pile => drawWoodPile(pile.x, pile.y, pile.amount));
    }

    // Stone node — herd of sheep
    const sheepData = this.sprites.getResourceSprite('sheep');
    const sheepGrassData = this.sprites.getResourceSprite('sheepGrass');
    if (sheepData && stoneNode) {
      const cx = stoneNode.x * T, cy = stoneNode.y * T;
      const drawSize = T * 1.8;
      const tick = Math.floor(Date.now() / 200);
      const [img, def] = sheepData;
      // Draw 4-5 sheep in a cluster, each with slightly offset animation
      const positions = [
        { x: cx - T * 2, y: cy - T * 1.2 },
        { x: cx + T * 1.5, y: cy - T * 1 },
        { x: cx - T * 0.5, y: cy + T * 0.3 },
        { x: cx + T * 2.5, y: cy + T * 0.5 },
        { x: cx - T * 2.5, y: cy + T * 0.8 },
      ];
      for (let i = 0; i < positions.length; i++) {
        const p = positions[i];
        // Alternate between idle and grazing animations
        const useGrass = sheepGrassData && (i % 2 === 1);
        const [sImg, sDef] = useGrass ? sheepGrassData! : [img, def];
        const frame = (tick + i * 2) % sDef.cols;
        drawSpriteFrame(ctx, sImg, sDef, frame, p.x - drawSize / 2, p.y - drawSize / 2, drawSize, drawSize);
      }
    } else if (stoneNode) {
      drawNodeFallback(stoneNode.x, stoneNode.y, 'STONE', 'rgba(158, 158, 158, 0.2)');
    }

    // Stray wood piles (dropped by killed/interrupted harvesters far from the forest)
    const strayPiles = woodNode
      ? state.woodPiles.filter(pile => Math.hypot(pile.x - woodNode.x, pile.y - woodNode.y) >= 8)
      : state.woodPiles;
    for (const pile of strayPiles) drawWoodPile(pile.x, pile.y, pile.amount);

    // Gold nodes near HQs — bigger gold resource sprite
    const goldData = this.sprites.getResourceSprite('goldResource');
    const bHQ = getHQPosition(Team.Bottom, state.mapDef);
    const tHQ = getHQPosition(Team.Top, state.mapDef);
    if (goldData) {
      const [img, def] = goldData;
      const drawSize = T * 5;
      let bx: number, by: number, tx: number, ty: number;
      if (state.mapDef.shapeAxis === 'x') {
        // Landscape: gold mines offset horizontally from HQ
        bx = (bHQ.x + HQ_WIDTH + 6) * T; by = (bHQ.y + HQ_HEIGHT / 2) * T;
        tx = (tHQ.x - 6) * T; ty = (tHQ.y + HQ_HEIGHT / 2) * T;
      } else {
        // Portrait: gold mines offset vertically from HQ
        bx = (bHQ.x + HQ_WIDTH / 2) * T; by = (bHQ.y - 6) * T;
        tx = (tHQ.x + HQ_WIDTH / 2) * T; ty = (tHQ.y + HQ_HEIGHT + 6) * T;
      }
      drawSpriteFrame(ctx, img, def, 0, bx - drawSize / 2, by - drawSize / 2, drawSize, drawSize);
      drawSpriteFrame(ctx, img, def, 0, tx - drawSize / 2, ty - drawSize / 2, drawSize, drawSize);
    } else {
      const goldOffset = state.mapDef.shapeAxis === 'x' ? 6 : 6;
      if (state.mapDef.shapeAxis === 'x') {
        drawNodeFallback(bHQ.x + HQ_WIDTH + goldOffset, bHQ.y + HQ_HEIGHT / 2, 'GOLD', 'rgba(255, 215, 0, 0.2)');
        drawNodeFallback(tHQ.x - goldOffset, tHQ.y + HQ_HEIGHT / 2, 'GOLD', 'rgba(255, 215, 0, 0.2)');
      } else {
        drawNodeFallback(bHQ.x + HQ_WIDTH / 2, bHQ.y - goldOffset, 'GOLD', 'rgba(255, 215, 0, 0.2)');
        drawNodeFallback(tHQ.x + HQ_WIDTH / 2, tHQ.y + HQ_HEIGHT + goldOffset, 'GOLD', 'rgba(255, 215, 0, 0.2)');
      }
    }
  }

  // === Build Grids ===

  private drawBuildGrids(ctx: CanvasRenderingContext2D, state: GameState): void {
    const earlyReveal = state.tick < 200; // first 10 seconds
    const placingMilitary = this.placingBuilding !== null
      && this.placingBuilding !== BuildingType.HarvesterHut
      && this.placingBuilding !== BuildingType.Tower;
    if (!earlyReveal && !placingMilitary) return;

    const maxP = state.mapDef.maxPlayers;
    for (let p = 0; p < maxP; p++) {
      // After early reveal, only show the local player's grid
      if (!earlyReveal && p !== this.localPlayerId) continue;
      const origin = getBuildGridOrigin(p, state.mapDef, state.players);
      const player = state.players[p];
      if (!player || player.isEmpty) continue;

      const pc = PLAYER_COLORS[p % PLAYER_COLORS.length];
      const tc = hexToRgba(pc);

      ctx.fillStyle = tc + '0.18)';
      const bgCols = state.mapDef.buildGridCols;
      const bgRows = state.mapDef.buildGridRows;
      ctx.fillRect(origin.x * T, origin.y * T, bgCols * T, bgRows * T);

      ctx.strokeStyle = tc + '0.35)';
      ctx.lineWidth = 0.5;
      for (let gx = 0; gx <= bgCols; gx++) {
        ctx.beginPath();
        ctx.moveTo((origin.x + gx) * T, origin.y * T);
        ctx.lineTo((origin.x + gx) * T, (origin.y + bgRows) * T);
        ctx.stroke();
      }
      for (let gy = 0; gy <= bgRows; gy++) {
        ctx.beginPath();
        ctx.moveTo(origin.x * T, (origin.y + gy) * T);
        ctx.lineTo((origin.x + bgCols) * T, (origin.y + gy) * T);
        ctx.stroke();
      }

      ctx.strokeStyle = tc + '0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(origin.x * T, origin.y * T, bgCols * T, bgRows * T);

      ctx.fillStyle = tc + '0.85)';
      ctx.font = 'bold 11px monospace';
      // Label position: below for bottom/left team, above for top/right team
      const teamIdx = state.mapDef.playerSlots[p]?.teamIndex ?? (p < 2 ? 0 : 1);
      const labelBelow = teamIdx === 0;
      const ly = labelBelow ? (origin.y + bgRows + 1.2) * T : (origin.y - 0.5) * T;
      ctx.fillText(`P${p + 1} [${player.race}]`, origin.x * T, ly);
    }
  }

  // === Hut Zones ===

  private drawHutZones(ctx: CanvasRenderingContext2D, state: GameState): void {
    const earlyReveal = state.tick < 200;
    const placingHut = this.placingBuilding === BuildingType.HarvesterHut;
    if (!earlyReveal && !placingHut) return;

    const maxP = state.mapDef.maxPlayers;
    for (let p = 0; p < maxP; p++) {
      if (!earlyReveal && p !== this.localPlayerId) continue;
      const player = state.players[p];
      if (!player || player.isEmpty) continue;
      const origin = getHutGridOrigin(p, state.mapDef, state.players);
      const pc = PLAYER_COLORS[p % PLAYER_COLORS.length];
      const tc = hexToRgba(pc);

      const hCols = state.mapDef.hutGridCols;
      const hRows = state.mapDef.hutGridRows;
      ctx.fillStyle = tc + '0.15)';
      ctx.fillRect(origin.x * T, origin.y * T, hCols * T, hRows * T);
      ctx.strokeStyle = tc + '0.4)';
      ctx.lineWidth = 1;
      for (let gx = 0; gx <= hCols; gx++) {
        ctx.beginPath();
        ctx.moveTo((origin.x + gx) * T, origin.y * T);
        ctx.lineTo((origin.x + gx) * T, (origin.y + hRows) * T);
        ctx.stroke();
      }
      for (let gy = 0; gy <= hRows; gy++) {
        ctx.beginPath();
        ctx.moveTo(origin.x * T, (origin.y + gy) * T);
        ctx.lineTo((origin.x + hCols) * T, (origin.y + gy) * T);
        ctx.stroke();
      }
      ctx.strokeStyle = tc + '0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(origin.x * T, origin.y * T, hCols * T, hRows * T);

      ctx.fillStyle = tc + '0.8)';
      ctx.font = 'bold 9px monospace';
      const teamIdx = state.mapDef.playerSlots[p]?.teamIndex ?? (p < 2 ? 0 : 1);
      const labelBelow = teamIdx === 0;
      const ly = labelBelow ? (origin.y + hRows + 0.8) * T : (origin.y - 0.4) * T;
      ctx.fillText(`P${p + 1} HUTS`, origin.x * T, ly);
    }
  }

  // === Tower Alleys ===

  private drawTowerAlleys(ctx: CanvasRenderingContext2D, state: GameState): void {
    const earlyReveal = state.tick < 200;
    const placingTower = this.placingBuilding === BuildingType.Tower;
    if (!earlyReveal && !placingTower) return;

    const localTeam = state.players[this.localPlayerId]?.team ?? Team.Bottom;
    for (const team of [Team.Bottom, Team.Top]) {
      if (!earlyReveal && team !== localTeam) continue;
      const origin = getTeamAlleyOrigin(team, state.mapDef);
      const color = team === Team.Bottom ? '41,121,255' : '255,23,68';

      const aCols = state.mapDef.towerAlleyCols;
      const aRows = state.mapDef.towerAlleyRows;
      ctx.fillStyle = `rgba(${color},0.15)`;
      ctx.fillRect(origin.x * T, origin.y * T, aCols * T, aRows * T);

      ctx.strokeStyle = `rgba(${color},0.35)`;
      ctx.lineWidth = 0.5;
      for (let gx = 0; gx <= aCols; gx++) {
        ctx.beginPath();
        ctx.moveTo((origin.x + gx) * T, origin.y * T);
        ctx.lineTo((origin.x + gx) * T, (origin.y + aRows) * T);
        ctx.stroke();
      }
      for (let gy = 0; gy <= aRows; gy++) {
        ctx.beginPath();
        ctx.moveTo(origin.x * T, (origin.y + gy) * T);
        ctx.lineTo((origin.x + aCols) * T, (origin.y + gy) * T);
        ctx.stroke();
      }

      ctx.strokeStyle = `rgba(${color},0.65)`;
      ctx.lineWidth = 2;
      ctx.strokeRect(origin.x * T, origin.y * T, aCols * T, aRows * T);

      ctx.fillStyle = `rgba(${color},0.8)`;
      ctx.font = 'bold 9px monospace';
      const isBottom = team === Team.Bottom;
      const ly = isBottom ? (origin.y + aRows + 1.2) * T : (origin.y - 0.4) * T;
      ctx.fillText('TOWER ALLEY', origin.x * T, ly);
    }
  }

  // === Y-Sorted Rendering (depth ordering) ===

  // Reusable sort buffer to avoid per-frame allocations (GC pressure)
  // kind: 0=hq, 1=building, 2=projectile, 3=unit, 4=dead, 5=harvester
  private sortBuf: { y: number; kind: number; idx: number }[] = [];

  private drawYSorted(ctx: CanvasRenderingContext2D, state: GameState): void {
    // Viewport culling bounds (world pixels, with sprite margin)
    const margin = T * 3;
    const vpX0 = this.camera.x - margin;
    const vpY0 = this.camera.y - margin;
    const vpX1 = this.camera.x + this.canvas.clientWidth / this.camera.zoom + margin;
    const vpY1 = this.camera.y + this.canvas.clientHeight / this.camera.zoom + margin;
    const fog = state.fogOfWar;
    const localTeam = state.players[this.localPlayerId]?.team ?? 0;

    // Reuse sort buffer — reset length without reallocating
    const buf = this.sortBuf;
    let n = 0;

    // HQs — always draw (only 2)
    for (let ti = 0; ti < 2; ti++) {
      const pos = getHQPosition(ti as Team, state.mapDef);
      const sy = (pos.y + HQ_HEIGHT) * T;
      if (n < buf.length) { buf[n].y = sy; buf[n].kind = 0; buf[n].idx = ti; }
      else buf.push({ y: sy, kind: 0, idx: ti });
      n++;
    }

    // Buildings — cull off-screen + fog filter
    for (let i = 0; i < state.buildings.length; i++) {
      const b = state.buildings[i];
      const px = b.worldX * T, py = b.worldY * T;
      if (px < vpX0 || px > vpX1 || py < vpY0 || py > vpY1) continue;
      // Fog: hide enemy buildings in unseen tiles
      if (fog && state.players[b.playerId]?.team !== localTeam && !this.isTileVisible(state, b.worldX, b.worldY)) continue;
      const sy = (b.worldY + 1) * T;
      if (n < buf.length) { buf[n].y = sy; buf[n].kind = 1; buf[n].idx = i; }
      else buf.push({ y: sy, kind: 1, idx: i });
      n++;
    }

    // Projectiles — cull off-screen + fog filter
    for (let i = 0; i < state.projectiles.length; i++) {
      const p = state.projectiles[i];
      const px = p.x * T, py = p.y * T;
      if (px < vpX0 || px > vpX1 || py < vpY0 || py > vpY1) continue;
      if (fog && !this.isTileVisible(state, p.x, p.y)) continue;
      if (n < buf.length) { buf[n].y = py; buf[n].kind = 2; buf[n].idx = i; }
      else buf.push({ y: py, kind: 2, idx: i });
      n++;
    }

    // Units — cull off-screen + fog filter
    for (let i = 0; i < state.units.length; i++) {
      const u = state.units[i];
      if (u.hp <= 0) continue;
      const px = u.x * T, py = u.y * T;
      if (px < vpX0 || px > vpX1 || py < vpY0 || py > vpY1) continue;
      // Fog: hide enemy units in unseen tiles
      if (fog && u.team !== localTeam && !this.isTileVisible(state, u.x, u.y)) continue;
      if (n < buf.length) { buf[n].y = py; buf[n].kind = 3; buf[n].idx = i; }
      else buf.push({ y: py, kind: 3, idx: i });
      n++;
    }

    // Dead units — cull off-screen + fog filter
    for (let i = 0; i < this.deadUnits.length; i++) {
      const d = this.deadUnits[i];
      const px = d.x * T, py = d.y * T;
      if (px < vpX0 || px > vpX1 || py < vpY0 || py > vpY1) continue;
      if (fog && d.team !== localTeam && !this.isTileVisible(state, d.x, d.y)) continue;
      if (n < buf.length) { buf[n].y = py; buf[n].kind = 4; buf[n].idx = i; }
      else buf.push({ y: py, kind: 4, idx: i });
      n++;
    }

    // Harvesters — cull off-screen + fog filter
    for (let i = 0; i < state.harvesters.length; i++) {
      const h = state.harvesters[i];
      if (h.state === 'dead') continue;
      const px = h.x * T, py = h.y * T;
      if (px < vpX0 || px > vpX1 || py < vpY0 || py > vpY1) continue;
      if (fog && state.players[h.playerId]?.team !== localTeam && !this.isTileVisible(state, h.x, h.y)) continue;
      if (n < buf.length) { buf[n].y = py; buf[n].kind = 5; buf[n].idx = i; }
      else buf.push({ y: py, kind: 5, idx: i });
      n++;
    }

    // Sort only the active portion by Y ascending
    const active = buf.length > n ? buf.slice(0, n) : buf;
    if (buf.length > n) buf.length = n; // trim excess from prior frames
    active.sort((a, b) => a.y - b.y);

    // Dispatch draws without closures
    for (let i = 0; i < n; i++) {
      const item = active[i];
      switch (item.kind) {
        case 0: this.drawOneHQ(ctx, state, item.idx as Team); break;
        case 1: this.drawOneBuilding(ctx, state, state.buildings[item.idx]); break;
        case 2: this.drawOneProjectile(ctx, state, state.projectiles[item.idx]); break;
        case 3: this.drawOneUnit(ctx, state, state.units[item.idx]); break;
        case 4: this.drawDeadUnit(ctx, this.deadUnits[item.idx]); break;
        case 5: this.drawOneHarvester(ctx, state, state.harvesters[item.idx]); break;
      }
    }
  }

  private updateDeadUnits(dt: number): void {
    for (let i = this.deadUnits.length - 1; i >= 0; i--) {
      const dead = this.deadUnits[i];
      const prevProgress = dead.ageSec / DEAD_UNIT_LIFETIME_SEC;
      dead.ageSec += dt;
      const newProgress = dead.ageSec / DEAD_UNIT_LIFETIME_SEC;
      // Spawn small dust puff when corpse hits the ground (at ~60% progress)
      if (prevProgress < 0.6 && newProgress >= 0.6) {
        this.deathEffects.push({
          x: dead.x, y: dead.y + 0.3, frame: 0, maxFrames: 10,
          size: T * 0.9, type: 'dust',
        });
      }
      if (dead.ageSec >= DEAD_UNIT_LIFETIME_SEC) this.deadUnits.splice(i, 1);
    }
  }


  private drawDeadUnit(ctx: CanvasRenderingContext2D, dead: DeadUnitSnapshot): void {
    const px = dead.x * T;
    const py = dead.y * T;
    const cx = px + T / 2;
    const feetY = py + T * 0.70;
    const progress = Math.min(1, dead.ageSec / DEAD_UNIT_LIFETIME_SEC);

    // Phase 1: red flash + upward pop (first 15% of animation)
    // Phase 2: tip-over fall (15%-60%)
    // Phase 3: hold corpse + fade (60%-100%)
    const flashPhase = Math.min(1, progress / 0.15);
    const fallPhase = progress < 0.15 ? 0 : Math.min(1, (progress - 0.15) / 0.45);
    const fadePhase = progress < 0.6 ? 0 : (progress - 0.6) / 0.4;

    // Upward pop: small bounce on death then settle
    const popY = flashPhase < 1 ? -Math.sin(flashPhase * Math.PI) * 4 : 0;

    // Opacity: full during flash+fall, then fade out
    const alpha = fadePhase > 0 ? 1 - fadePhase * 0.85 : 1;

    // Tip-over with ease-out
    const fallEased = 1 - (1 - fallPhase) * (1 - fallPhase);
    const deadFlip = dead.faceLeft; // rotation dir based on movement facing
    const rotation = (deadFlip ? -1 : 1) * fallEased * 1.4;
    const flatten = 1 - fallEased * 0.72;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Shadow: grows as unit falls, responds to day/night
    ctx.fillStyle = `rgba(0,0,0,${this.dayNight.brightness * 0.2})`;
    ctx.beginPath();
    ctx.ellipse(cx, py + T * 0.70, 7 + fallEased * 4, 2.5 + fallEased * 1.5, 0, 0, Math.PI * 2);
    ctx.fill();

    const spriteData = dead.race
      ? this.sprites.getUnitSprite(dead.race, dead.category, dead.playerId, dead.wasAttacking, dead.upgradeNode)
      : null;
    const tierScale = 1.0 + (dead.upgradeTier ?? 0) * 0.15;

    if (spriteData) {
      const [img, def] = spriteData;
      const spriteScale = def.scale ?? 1.0;
      const baseH = T * 1.82 * spriteScale * tierScale;
      const aspect = def.frameW / def.frameH;
      const drawW = baseH * aspect;
      const drawH = baseH * (def.heightScale ?? 1.0);
      const groundY = def.groundY ?? 0.71;
      const drawFaceLeft = dead.faceLeft;

      ctx.translate(cx, feetY + popY);
      ctx.rotate(rotation);
      ctx.scale(drawFaceLeft ? -1 : 1, flatten);

      const deadAx = def.anchorX ?? 0.5;
      drawSpriteFrame(ctx, img, def, dead.frame, -drawW * deadAx, -drawH * groundY, drawW, drawH);
      // Bright flash overlay during initial hit reaction (same as hit flash style)
      if (flashPhase < 1) {
        ctx.globalAlpha = (1 - flashPhase) * 0.55;
        ctx.globalCompositeOperation = 'lighter';
        drawSpriteFrame(ctx, img, def, dead.frame, -drawW * deadAx, -drawH * groundY, drawW, drawH);
        ctx.globalCompositeOperation = 'source-over';
      }
    } else {
      const radius = (dead.category === 'ranged' ? 3 : 4) * tierScale;
      ctx.translate(cx, py + T / 2 + popY);
      ctx.rotate(rotation);
      ctx.scale(1, flatten);
      this.drawUnitShape(ctx, 0, 0, radius, dead.race, dead.category, dead.team, PLAYER_COLORS[dead.playerId] || '#888');
    }

    ctx.restore();
  }

  // === HQs ===

  private drawOneHQ(ctx: CanvasRenderingContext2D, state: GameState, team: Team): void {
    const pos = getHQPosition(team, state.mapDef);
    const hp = state.hqHp[team];
    const color = team === Team.Bottom ? '#2979ff' : '#ff1744';
    const bg = team === Team.Bottom ? 'rgba(41, 121, 255, 0.15)' : 'rgba(255, 23, 68, 0.15)';

    const px = pos.x * T, py = pos.y * T;
    const w = HQ_WIDTH * T, h = HQ_HEIGHT * T;

    // Map team to a player on that team for sprite lookup
    const hqPlayerId = state.players.find(p => p.team === team)?.id ?? (team === Team.Bottom ? 0 : 2);
    const sprite = this.sprites.getHQSprite(hqPlayerId);
    if (sprite) {
      const drawW = w + T * 2;
      const drawH = (drawW / sprite.width) * sprite.height;
      const drawX = px - T;
      const drawY = py + h - drawH;

      // HQ shadow — anchored at visual base (groundY ~0.71 for Tiny Swords)
      const hqGroundY = drawY + drawH * 0.71;
      const hqShadowLen = this.dayNight.shadowLength;
      const hqShadowX = Math.cos(this.dayNight.shadowAngle) * hqShadowLen * 4;
      ctx.fillStyle = `rgba(0,0,0,${this.dayNight.brightness * 0.15})`;
      ctx.beginPath();
      ctx.ellipse(px + w / 2 + hqShadowX, hqGroundY, drawW * 0.38, drawW * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.drawImage(sprite, drawX, drawY, drawW, drawH);
    } else {
      ctx.fillStyle = bg;
      ctx.fillRect(px, py, w, h);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(px, py, w, h);

      const cx = px + w / 2, cy = py + h / 2;
      ctx.beginPath();
      ctx.arc(cx, cy - 2, 12, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(team === Team.Bottom ? 'B' : 'T', cx, cy + 3);
    }

    if (hp < HQ_HP) {
      const cx = px + w / 2;
      const barW = w - 8, barH = 5;
      const barX = px + 4;
      const barY = team === Team.Bottom ? py - 10 : py + h + 4;
      const hpPct = Math.max(0, hp / HQ_HP);

      ctx.fillStyle = '#222';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = hpPct > 0.5 ? '#4caf50' : hpPct > 0.25 ? '#ff9800' : '#f44336';
      ctx.fillRect(barX, barY, barW * hpPct, barH);

      ctx.fillStyle = '#999';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${hp}`, cx, barY + barH + 10);
      ctx.textAlign = 'start';
    }
  }

  // === Buildings ===

  private drawOneBuilding(ctx: CanvasRenderingContext2D, state: GameState, b: BuildingState): void {
    {
      const player = state.players[b.playerId];
      const rc = RACE_COLORS[player.race];
      const playerColor = PLAYER_COLORS[b.playerId] || '#888';
      const px = b.worldX * T + T / 2;
      const py = b.worldY * T + T / 2;
      const half = T / 2 - 2;

      const upgradeTier = b.upgradePath.length - 1; // 0=base, 1=tier1, 2=tier2
      const sprite = this.sprites.getBuildingSprite(b.type, b.playerId);

      if (sprite) {
        // Draw sprite scaled to fit one tile, anchored at bottom-center
        // Scale up slightly per upgrade tier to show leveling
        // Research: 2x size
        const researchScale = b.type === BuildingType.Research ? 2.0 : 1.0;
        const tierScale = 1.0 + upgradeTier * 0.08;
        const baseDrawW = (T + 4) * tierScale * researchScale;
        const baseDrawH = (baseDrawW / sprite.width) * sprite.height;

        // Construction animation: scale-up bounce
        const buildScale = this.constructionAnims.getScale(b.id, state.tick);
        const drawW = baseDrawW * buildScale;
        const drawH = baseDrawH * buildScale;
        const drawX = px - drawW / 2;
        const drawY = py + half - drawH + 2; // anchor bottom to tile bottom

        // Building shadow (day/night responsive) — anchored at building visual base
        // Tiny Swords sprites have ~29% transparent padding below the building (groundY=0.71)
        const bGroundY = drawY + drawH * 0.71;
        const bShadowLen = this.dayNight.shadowLength;
        const bShadowX = Math.cos(this.dayNight.shadowAngle) * bShadowLen * 3;
        ctx.fillStyle = `rgba(0,0,0,${this.dayNight.brightness * 0.15})`;
        ctx.beginPath();
        ctx.ellipse(px + bShadowX, bGroundY, drawW * 0.4, drawW * 0.1, 0, 0, Math.PI * 2);
        ctx.fill();

        // Seed buildings: draw plant sprite instead of normal building
        if (b.isSeed) {
          const seedData = this.sprites.getSeedSprite();
          if (seedData) {
            const [seedImg, seedDef] = seedData;
            const seedSize = T * 1.8 * buildScale;
            const seedAspect = seedDef.frameW / seedDef.frameH;
            const seedW = seedSize * seedAspect;
            const seedH = seedSize;
            const seedFeetY = py + half + 2;
            const seedDrawY = seedFeetY - seedH * (seedDef.groundY ?? 0.95);
            const seedFrame = getSpriteFrame(state.tick, seedDef);
            drawSpriteFrame(ctx, seedImg, seedDef, seedFrame, px - seedW / 2, seedDrawY, seedW, seedH);
          } else {
            ctx.drawImage(sprite, drawX, drawY, drawW, drawH);
          }
          // Seed progress bar
          if (b.seedTimer != null) {
            const maxTime = 15 * TICK_RATE;
            const pct = 1 - b.seedTimer / maxTime;
            const barW = drawW * 0.8;
            const barH = 3;
            const barX = px - barW / 2;
            const barY = bGroundY - drawH * 0.5;
            ctx.fillStyle = '#333';
            ctx.fillRect(barX, barY, barW, barH);
            ctx.fillStyle = '#81c784';
            ctx.fillRect(barX, barY, barW * pct, barH);
          }
        } else if (b.type !== BuildingType.Research) {
          ctx.drawImage(sprite, drawX, drawY, drawW, drawH);
        } else {
          ctx.drawImage(sprite, drawX, drawY, drawW, drawH);
        }

        // Tenders huts: green tint to indicate passive resource generation
        if (b.type === BuildingType.HarvesterHut && player.race === Race.Tenders) {
          ctx.globalAlpha = 0.2;
          ctx.fillStyle = '#4caf50';
          ctx.fillRect(drawX, drawY, drawW, drawH);
          ctx.globalAlpha = 1;
        }

        // Special ability buildings (non-seed) — tint overlay only, no floating label
        if (b.isFoundry || b.isPotionShop || b.isGlobule) {
          const tint = b.isFoundry ? '#ffd700' : b.isPotionShop ? '#69f0ae' : '#7c4dff';
          ctx.globalAlpha = 0.25;
          ctx.fillStyle = tint;
          ctx.fillRect(drawX, drawY, drawW, drawH);
          ctx.globalAlpha = 1;
        } else if (b.type === BuildingType.Tower) {
          const towerStats = TOWER_STATS[player.race];
          const towerUpgrade = getUnitUpgradeMultipliers(b.upgradePath, player.race, BuildingType.Tower);
          const towerRangeBonus = towerUpgrade.special.towerRangeBonus ?? 0;
          const effectiveRange = Math.max(1, towerStats.range * towerUpgrade.range) + towerRangeBonus;
          ctx.beginPath();
          ctx.arc(px, py, effectiveRange * T, 0, Math.PI * 2);
          ctx.strokeStyle = `${rc.primary}33`;
          ctx.lineWidth = 1;
          ctx.stroke();

          // Draw race's ranged unit on top of tower for identification
          // Show attack animation while tower is on cooldown (just fired), idle otherwise
          const towerFiring = b.actionTimer > 0;
          const unitData = this.sprites.getUnitSprite(player.race, 'ranged', b.playerId, towerFiring);
          if (unitData) {
            const [unitImg, unitDef] = unitData;
            const spriteScale = unitDef.scale ?? 1.0;
            const unitSize = T * 1.5 * spriteScale * tierScale;
            const aspect = unitDef.frameW / unitDef.frameH;
            const uW = unitSize * aspect;
            const uH = unitSize * (unitDef.heightScale ?? 1.0);
            const gY = unitDef.groundY ?? 0.71;
            // Position unit's feet at ~40% down the tower sprite
            const feetY = drawY + drawH * 0.4;
            const unitX = px - uW / 2;
            const unitY = feetY - uH * gY;
            let frame: number;
            if (towerFiring) {
              // Play attack animation once through during cooldown
              const cooldownTotal = Math.round(towerStats.attackSpeed * 20); // ticks
              const elapsed = cooldownTotal - b.actionTimer;
              const atkProgress = Math.min(1, elapsed / Math.max(1, unitDef.cols));
              frame = Math.min(Math.floor(atkProgress * unitDef.cols), unitDef.cols - 1);
            } else {
              // Idle: hold frame 0
              frame = 0;
            }
            drawSpriteFrame(ctx, unitImg, unitDef, frame, unitX, unitY, uW, uH);
          }
        }

        // Harvester hut assignment icon overlay — top-right of building
        if (b.type === BuildingType.HarvesterHut) {
          const harv = state.harvesters.find(h => h.hutId === b.id);
          if (harv) {
            const iconSz = Math.max(8, half * 0.9);
            const iconX = px + half - iconSz * 0.2;
            const iconY2 = py - half - iconSz * 0.6;
            if (harv.assignment === 'center') {
              const diamondSprite = this.sprites.getResourceSprite('goldResource');
              const dSz = iconSz * 1.8;
              const dOff = (dSz - iconSz) / 2;
              if (diamondSprite) ctx.drawImage(diamondSprite[0], iconX - dOff, iconY2 - dOff, dSz, dSz);
            } else {
              const iconMap: Record<string, 'gold' | 'wood' | 'meat'> = { base_gold: 'gold', wood: 'wood', stone: 'meat' };
              this.ui.drawIcon(ctx, iconMap[harv.assignment] || 'gold', iconX, iconY2, iconSz);
            }
          }
        }
      } else {
        // Fallback: procedural shapes (scale up per tier)
        const tierScale = 1.0 + upgradeTier * 0.08;
        const h2 = half * tierScale;
        ctx.fillStyle = 'rgba(20, 20, 20, 0.9)';
        ctx.strokeStyle = playerColor;
        ctx.lineWidth = upgradeTier >= 2 ? 3 : 2;

        switch (b.type) {
          case BuildingType.MeleeSpawner:
            ctx.fillRect(px - h2, py - h2, h2 * 2, h2 * 2);
            ctx.strokeRect(px - h2, py - h2, h2 * 2, h2 * 2);
            break;
          case BuildingType.RangedSpawner:
            ctx.beginPath();
            ctx.moveTo(px, py - h2); ctx.lineTo(px + h2, py + h2); ctx.lineTo(px - h2, py + h2);
            ctx.closePath(); ctx.fill(); ctx.stroke();
            break;
          case BuildingType.CasterSpawner:
            ctx.beginPath();
            for (let i = 0; i < 5; i++) {
              const a = (i * 2 * Math.PI / 5) - Math.PI / 2;
              const sx = px + Math.cos(a) * h2, sy = py + Math.sin(a) * h2;
              if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
            }
            ctx.closePath(); ctx.fill(); ctx.stroke();
            break;
          case BuildingType.Tower: {
            ctx.beginPath();
            ctx.moveTo(px, py - h2); ctx.lineTo(px + h2, py);
            ctx.lineTo(px, py + h2); ctx.lineTo(px - h2, py);
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = rc.primary;
            ctx.stroke();
            const towerStats = TOWER_STATS[player.race];
            const towerUpgrade = getUnitUpgradeMultipliers(b.upgradePath, player.race, BuildingType.Tower);
            const towerRangeBonus = towerUpgrade.special.towerRangeBonus ?? 0;
            const effectiveRange = Math.max(1, towerStats.range * towerUpgrade.range) + towerRangeBonus;
            ctx.beginPath();
            ctx.arc(px, py, effectiveRange * T, 0, Math.PI * 2);
            ctx.strokeStyle = `${rc.primary}33`;
            ctx.lineWidth = 1;
            ctx.stroke();
            break;
          }
          case BuildingType.HarvesterHut: {
            ctx.beginPath(); ctx.arc(px, py, h2, 0, Math.PI * 2);
            ctx.fill(); ctx.strokeStyle = '#ffd700'; ctx.stroke();
            const harv = state.harvesters.find(h => h.hutId === b.id);
            if (harv) {
              const iconSz = Math.max(8, half * 0.9);
              const iconX = px + half - iconSz * 0.2;
              const iconY2 = py - half - iconSz * 0.6;
              if (harv.assignment === 'center') {
                const diamondSprite = this.sprites.getResourceSprite('goldResource');
                if (diamondSprite) ctx.drawImage(diamondSprite[0], iconX, iconY2, iconSz, iconSz);
              } else {
                const iconMap: Record<string, 'gold' | 'wood' | 'meat'> = { base_gold: 'gold', wood: 'wood', stone: 'meat' };
                this.ui.drawIcon(ctx, iconMap[harv.assignment] || 'gold', iconX, iconY2, iconSz);
              }
            }
            break;
          }
          case BuildingType.Research: {
            // Fallback if sprite not loaded: simple box with "R"
            const bh = h2 * 1.4;
            ctx.fillRect(px - bh, py - bh * 0.8, bh * 2, bh * 1.6);
            ctx.strokeStyle = '#c0a060';
            ctx.lineWidth = 2;
            ctx.strokeRect(px - bh, py - bh * 0.8, bh * 2, bh * 1.6);
            ctx.fillStyle = '#e8d5b7';
            ctx.font = `bold ${Math.max(9, Math.round(half * 0.8))}px monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('R', px, py);
            ctx.textBaseline = 'alphabetic';
            break;
          }
        }
      }

      // Race color dot
      ctx.fillStyle = rc.primary;
      ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.arc(px, py - half + 2, 2, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      // Upgrade tier pips below building
      if (upgradeTier >= 1) {
        ctx.fillStyle = rc.primary;
        ctx.globalAlpha = 0.85;
        if (upgradeTier === 1) {
          ctx.beginPath(); ctx.arc(px, py + half + 2, 1.5, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.beginPath(); ctx.arc(px - 3, py + half + 2, 1.5, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(px + 3, py + half + 2, 1.5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;

        if (upgradeTier >= 2) {
          ctx.strokeStyle = rc.primary;
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = 1;
          ctx.strokeRect(px - half - 1, py - half - 1, (half + 1) * 2, (half + 1) * 2);
          ctx.globalAlpha = 1;
        }
      }

      // Building damage fire overlay when HP < 50%
      const bHpPct = b.hp / b.maxHp;
      if (bHpPct < 0.5) {
        const fireData = this.sprites.getFxSprite('buildingFire');
        if (fireData) {
          const [fireImg, fireDef] = fireData;
          const fireSize = T * 1.2;
          const fireTick = Math.floor(Date.now() / 80) + b.id;
          ctx.globalAlpha = bHpPct < 0.25 ? 0.9 : 0.5;
          drawGridFrame(ctx, fireImg, fireDef as GridSpriteDef, fireTick, px - fireSize / 2, py - half - fireSize * 0.6, fireSize, fireSize);
          ctx.globalAlpha = 1;
        }
      }

      // (fire overlay alone communicates damage — no dark tint rect needed)

      // HP bar (only if damaged)
      if (b.hp < b.maxHp) {
        const barW = T - 4, barH = 2;
        const barX = px - barW / 2, barY = py + half + 3;
        const pct = b.hp / b.maxHp;
        ctx.fillStyle = '#222';
        ctx.fillRect(barX, barY, barW, barH);
        ctx.fillStyle = pct > 0.5 ? '#4caf50' : pct > 0.25 ? '#ff9800' : '#f44336';
        ctx.fillRect(barX, barY, barW * pct, barH);
      }
    }
  }

  // === Projectiles ===

  private drawOneProjectile(ctx: CanvasRenderingContext2D, state: GameState, p: ProjectileState): void {
    const isBottom = p.team === Team.Bottom;
    const teamIdx = isBottom ? 0 : 1;
    const race = state.players[p.sourcePlayerId]?.race;

    // Calculate Y offset based on source unit's sprite to fire from visual center
    let pyOffset = T * 0.45; // default fallback
    if (race && p.sourceUnitId != null) {
      const srcUnit = state.units.find(u => u.id === p.sourceUnitId);
      const cat = srcUnit?.category;
      if (cat) {
        const sprData = this.sprites.getUnitSprite(race, cat, p.sourcePlayerId, false, srcUnit?.upgradeNode);
        if (sprData) {
          const [, def] = sprData;
          const scale = def.scale ?? 1.0;
          const tier = srcUnit?.upgradeTier ?? 0;
          const tierScale = 1.0 + tier * 0.15;
          const drawH = T * 1.82 * scale * tierScale * (def.heightScale ?? 1.0);
          const groundY = def.groundY ?? 0.71;
          // feetY = T * 0.70, sprite top = feetY - drawH * groundY
          // visual center = sprite top + drawH / 2 = feetY - drawH * groundY + drawH / 2
          pyOffset = T * 0.70 - drawH * groundY + drawH * 0.5;
        }
      }
    }
    const px = p.x * T + T / 2, py = p.y * T + pyOffset;

    // Animation frame — loop through the bright middle portion of the lifecycle
    // Orbs: 30 frames, circles: 48 frames. Frames ~5-15 are the brightest.
    const animFrame = 5 + Math.floor(state.tick / 2) % 10;

    let drewSprite = false;

    if (p.visual === 'arrow') {
      // Arrow sprite — rotate toward target (all ranged units)
      const arrowData = this.sprites.getArrowSprite(teamIdx);
      if (arrowData) {
        const [img] = arrowData;
        const target = state.units.find(u => u.id === p.targetId);
        const angle = target
          ? Math.atan2((target.y - p.y), (target.x - p.x))
          : isBottom ? -Math.PI / 2 : Math.PI / 2;
        const size = T * 1.2;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(angle);
        ctx.drawImage(img, -size / 2, -size / 2, size, size);
        ctx.restore();
        drewSprite = true;
      }
    } else if (p.visual === 'bone') {
      // Bone projectile — rotate toward target, use first frame of spritesheet
      const boneData = this.sprites.getBoneSprite();
      if (boneData) {
        const [img] = boneData;
        const target = state.units.find(u => u.id === p.targetId);
        const angle = target
          ? Math.atan2((target.y - p.y), (target.x - p.x))
          : isBottom ? -Math.PI / 2 : Math.PI / 2;
        // Spin the bone as it flies (add rotation over time)
        const spin = (state.tick * 0.4) % (Math.PI * 2);
        const size = T * 1.0;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(angle + spin);
        ctx.drawImage(img, 0, 0, 64, 64, -size / 2, -size / 2, size, size);
        ctx.restore();
        drewSprite = true;
      }
    } else if (p.visual === 'circle') {
      // Caster AoE — use circle sprite (bigger, more dramatic)
      const circRace = race ?? Race.Crown;
      const circData = this.sprites.getCircleSprite(circRace);
      if (circData) {
        const [img, def] = circData;
        const size = T * 1.6;
        drawGridFrame(ctx, img, def, animFrame, px - size / 2, py - size / 2, size, size);
        drewSprite = true;
      }
    } else if (p.visual === 'cannonball') {
      // HQ cannonball or siege cannonball — large dark sphere with fiery trail
      const r = T * 0.5;
      const cbTarget = state.units.find(u => u.id === p.targetId);
      // Position-targeted siege cannonballs use targetX/targetY for angle
      const cbAngle = p.targetX !== undefined && p.targetY !== undefined
        ? Math.atan2(p.targetY - p.y, p.targetX - p.x)
        : cbTarget
          ? Math.atan2(cbTarget.y - p.y, cbTarget.x - p.x)
          : isBottom ? -Math.PI / 2 : Math.PI / 2;
      const tdx = Math.cos(cbAngle);
      const tdy = Math.sin(cbAngle);
      // Trail (behind the projectile)
      ctx.beginPath();
      ctx.arc(px - tdx * T * 1.2, py - tdy * T * 1.2, r * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 100, 0, 0.3)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px - tdx * T * 0.6, py - tdy * T * 0.6, r * 0.85, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 150, 0, 0.4)';
      ctx.fill();
      // Main ball
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      const grad = ctx.createRadialGradient(px - r * 0.3, py - r * 0.3, 0, px, py, r);
      grad.addColorStop(0, '#555');
      grad.addColorStop(0.6, '#222');
      grad.addColorStop(1, '#000');
      ctx.fillStyle = grad;
      ctx.fill();
      // Highlight
      ctx.beginPath();
      ctx.arc(px - r * 0.25, py - r * 0.25, r * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.fill();
      drewSprite = true;
    } else if (p.visual === 'bolt') {
      // Tower bolt — use orb sprite, slightly larger
      const boltRace = race ?? Race.Crown;
      const orbData = this.sprites.getOrbSprite(boltRace);
      if (orbData) {
        const [img, def] = orbData;
        const size = T * 1.2;
        drawGridFrame(ctx, img, def, animFrame, px - size / 2, py - size / 2, size, size);
        drewSprite = true;
      }
    } else if (p.visual === 'orb') {
      // Chain / misc — use orb sprite, standard size
      const orbRace = race ?? Race.Crown;
      const orbData = this.sprites.getOrbSprite(orbRace);
      if (orbData) {
        const [img, def] = orbData;
        const size = T * 1.0;
        drawGridFrame(ctx, img, def, animFrame, px - size / 2, py - size / 2, size, size);
        drewSprite = true;
      }
    }

    // Fallback: colored circles if sprite not loaded
    if (!drewSprite) {
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = isBottom ? '#4fc3f7' : '#ff8a65';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px, py, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }
  }

  // === Units ===

  private drawOneUnit(ctx: CanvasRenderingContext2D, state: GameState, u: UnitState): void {
    {
      const playerColor = PLAYER_COLORS[u.playerId] || '#888';
      const px = u.x * T, py = u.y * T;
      const laneColor = u.lane === Lane.Left ? LANE_LEFT_COLOR : LANE_RIGHT_COLOR;
      const r = u.range > 2 ? 3 : 4;
      const cx = px + T / 2;
      const tierScale = u.isChampion ? 3.0 : 1.0 + (u.upgradeTier ?? 0) * 0.15;

      // Drop shadow — ellipse at feet level
      const shadowAlpha = this.dayNight.brightness * 0.2;
      ctx.fillStyle = `rgba(0,0,0,${shadowAlpha})`;
      ctx.beginPath();
      ctx.ellipse(cx, py + T * 0.70, 5 * tierScale, 2, 0, 0, Math.PI * 2);
      ctx.fill();

      // Champion glow aura
      if (u.isChampion) {
        const glowPulse = 0.5 + 0.5 * Math.sin(state.tick * 0.15);
        const glowR = T * 1.2 + glowPulse * T * 0.3;
        ctx.save();
        ctx.globalAlpha = 0.25 + glowPulse * 0.15;
        ctx.fillStyle = '#00ffff';
        ctx.beginPath();
        ctx.arc(cx, py + T * 0.5, glowR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Try sprite first, fall back to procedural shapes
      const race = u.spriteRace ?? state.players[u.playerId]?.race;
      const cat = u.category as 'melee' | 'ranged' | 'caster';
      const attackCooldownTicks = Math.round(u.attackSpeed * TICK_RATE);
      const justFired = u.attackTimer > attackCooldownTicks * 0.5;
      const isAttacking = u.targetId !== null && justFired;
      // Ranged/caster on cooldown but past attack anim window — idle, don't walk
      const isRangedOnCooldown = u.targetId !== null && u.attackTimer > 0 && !justFired
        && (cat === 'ranged' || cat === 'caster');
      const spriteData = race ? this.sprites.getUnitSprite(race, cat, u.playerId, isAttacking, u.upgradeNode) : null;
      if (spriteData) {
        const [img, def] = spriteData;
        const spriteScale = def.scale ?? 1.0;
        const baseH = T * 1.82 * spriteScale * tierScale;
        const aspect = def.frameW / def.frameH;
        const drawW = baseH * aspect;
        const drawH = baseH * (def.heightScale ?? 1.0);
        // Ranged/caster units stand still when attacking without a dedicated attack sprite
        const idleWhileAttacking = isAttacking && (cat === 'ranged' || cat === 'caster')
          && race != null && !this.sprites.hasAttackSprite(race, cat, u.upgradeNode);
        // Check if unit is actually moving (compare to last frame position)
        const lastPos = this.lastUnitPositions.get(u.id);
        const isStationary = lastPos != null
          && Math.abs(u.x - lastPos.x) < 0.05 && Math.abs(u.y - lastPos.y) < 0.05;
        // Normalize animation: ~1 cycle per second (20 ticks) regardless of frame count
        const frame = (idleWhileAttacking || isRangedOnCooldown || (isStationary && !isAttacking)) ? 0 : getSpriteFrame(state.tick, def);
        // Anchor feet at consistent ground level
        const feetY = py + T * 0.70;
        const drawY = feetY - drawH * (def.groundY ?? 0.71);

        // Determine facing: track movement direction, override when attacking toward target
        let faceLeft = this.updateFacing(u.id, u.x, u.team === Team.Top);
        if (u.targetId !== null) {
          const target = state.units.find(t => t.id === u.targetId);
          if (target) {
            const dx = target.x - u.x;
            if (Math.abs(dx) > 0.5) {
              // Target has meaningful horizontal offset — face toward it
              faceLeft = dx < 0;
            } else {
              // Target is mostly vertical — use team default facing
              faceLeft = u.team === Team.Top;
            }
            this.facing.set(u.id, faceLeft);
          }
        }
        const ax = def.anchorX ?? 0.5;
        if (faceLeft) {
          ctx.save();
          ctx.translate(cx, 0);
          ctx.scale(-1, 1);
          drawSpriteFrame(ctx, img, def, frame, -drawW * (1 - ax), drawY, drawW, drawH);
          ctx.restore();
        } else {
          drawSpriteFrame(ctx, img, def, frame, cx - drawW * ax, drawY, drawW, drawH);
        }
        // Hit flash: bright white tint when taking damage
        if (this.hitFlash.consume(u.id)) {
          ctx.globalAlpha = 0.55;
          ctx.globalCompositeOperation = 'lighter';
          if (faceLeft) {
            ctx.save();
            ctx.translate(cx, 0);
            ctx.scale(-1, 1);
            drawSpriteFrame(ctx, img, def, frame, -drawW * (1 - ax), drawY, drawW, drawH);
            ctx.restore();
          } else {
            drawSpriteFrame(ctx, img, def, frame, cx - drawW * ax, drawY, drawW, drawH);
          }
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
        }
        // Tier indicator: small colored dot above unit (cheap alternative to full sprite redraw)
        const tier = u.upgradeTier ?? 0;
        if (tier >= 1) {
          ctx.fillStyle = tier >= 2 ? '#ffd740' : '#90caf9';
          ctx.fillRect(cx - 1, drawY - 2, 2 + tier, 2);
        }
      } else {
        // Procedural fallback: scale by tier
        const scaledR = r * tierScale;
        this.drawUnitShape(ctx, px + T / 2, py + T / 2, scaledR, race, u.category, u.team, playerColor);
        // Tier ring for procedural units
        const tier = u.upgradeTier ?? 0;
        if (tier >= 1) {
          ctx.strokeStyle = playerColor;
          ctx.lineWidth = tier;
          ctx.globalAlpha = 0.4;
          ctx.beginPath();
          ctx.arc(px + T / 2, py + T / 2, scaledR + 2, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      // Lane indicator: small colored tick (cheaper than fillText per unit)
      ctx.fillStyle = laneColor;
      ctx.fillRect(cx - 1, py - 2, 2, 2);

      // Unit center for effects (tile-centered)
      const ux = px + T / 2, uy = py + T / 2;

      // Status effect visuals — sprite-based VFX overlays
      const fxTick = Math.floor(Date.now() / 100);
      const fxSize = r * 3.5;  // effect overlay size relative to unit

      for (const eff of u.statusEffects) {
        if (eff.type === StatusType.Burn) {
          const fxData = this.sprites.getFxSprite('burn');
          if (fxData) {
            const [fxImg, fxDef] = fxData;
            ctx.globalAlpha = Math.min(0.5 + 0.15 * eff.stacks, 1);
            drawSpriteFrame(ctx, fxImg, fxDef as SpriteDef, fxTick + u.id, ux - fxSize / 2, uy - fxSize * 0.8, fxSize, fxSize);
            ctx.globalAlpha = 1;
          }
        }
        if (eff.type === StatusType.Slow) {
          const fxData = this.sprites.getFxSprite('slow');
          if (fxData) {
            const [fxImg, fxDef] = fxData;
            ctx.globalAlpha = Math.min(0.4 + 0.15 * eff.stacks, 0.9);
            drawSpriteFrame(ctx, fxImg, fxDef as SpriteDef, fxTick + u.id * 3, ux - fxSize / 2, uy - fxSize * 0.6, fxSize, fxSize);
            ctx.globalAlpha = 1;
          }
        }
        if (eff.type === StatusType.Haste) {
          const fxData = this.sprites.getFxSprite('haste');
          if (fxData) {
            const [fxImg, fxDef] = fxData;
            ctx.globalAlpha = 0.6;
            drawSpriteFrame(ctx, fxImg, fxDef as SpriteDef, fxTick + u.id * 2, ux - fxSize / 2, uy - fxSize * 0.7, fxSize, fxSize);
            ctx.globalAlpha = 1;
          }
        }
        if (eff.type === StatusType.Wound) {
          // Anti-heal indicator: small pulsing purple-green cross
          ctx.globalAlpha = 0.5 + 0.2 * Math.sin(Date.now() / 200 + u.id);
          const ws = r * 1.8;
          const wcx = ux, wcy = uy - r * 2;
          ctx.strokeStyle = '#9c27b0';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(wcx - ws / 2, wcy - ws / 2);
          ctx.lineTo(wcx + ws / 2, wcy + ws / 2);
          ctx.moveTo(wcx + ws / 2, wcy - ws / 2);
          ctx.lineTo(wcx - ws / 2, wcy + ws / 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        if (eff.type === StatusType.Shield) {
          const fxData = this.sprites.getFxSprite('shield');
          if (fxData) {
            const [fxImg, fxDef] = fxData;
            const shieldSize = fxSize * 1.3;
            ctx.globalAlpha = 0.5;
            drawGridFrame(ctx, fxImg, fxDef as GridSpriteDef, fxTick + u.id, ux - shieldSize / 2, uy - shieldSize / 2, shieldSize, shieldSize);
            ctx.globalAlpha = 1;
          }
        }
      }

      // HP bar (only if damaged, always for champions) — smooth drain with gradient
      if (u.hp < u.maxHp || u.isChampion) {
        const barW = 12, barH = 2.5;
        const barX = ux - barW / 2, barY = py - 1;
        const targetPct = u.hp / u.maxHp;
        // Smooth HP drain
        const prevPct = this.smoothHp.get(u.id) ?? targetPct;
        const displayPct = prevPct + (targetPct - prevPct) * 0.15;
        this.smoothHp.set(u.id, displayPct);

        ctx.fillStyle = '#111';
        ctx.fillRect(barX - 0.5, barY - 0.5, barW + 1, barH + 1);
        // Flat color fill (avoids expensive per-unit gradient creation)
        ctx.fillStyle = u.isChampion ? '#00e5ff'
          : displayPct > 0.5 ? '#66bb6a'
          : displayPct > 0.25 ? '#ffa726'
          : '#ef5350';
        ctx.fillRect(barX, barY, barW * displayPct, barH);
        // Delayed damage indicator (red ghost bar)
        if (displayPct > targetPct + 0.01) {
          ctx.fillStyle = 'rgba(255, 50, 50, 0.5)';
          ctx.fillRect(barX + barW * targetPct, barY, barW * (displayPct - targetPct), barH);
        }
      } else {
        this.smoothHp.delete(u.id);
      }

      // Shield bar (below HP bar)
      if (u.shieldHp > 0) {
        const barW = 12, barH = 1.5;
        const barX = ux - barW / 2, barY = py + 2;
        ctx.fillStyle = 'rgba(100, 181, 246, 0.7)';
        ctx.fillRect(barX, barY, barW * Math.min(1, u.shieldHp / 12), barH);
      }

      if (u.carryingDiamond) {
        ctx.beginPath(); ctx.arc(ux, uy, 7, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      }

      // Attack flash
      if (u.attackTimer > 0 && u.attackTimer > Math.round(u.attackSpeed * 20) - 3) {
        ctx.beginPath(); ctx.arc(ux, uy, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  // === Unit Shape Helper ===

  drawUnitShape(
    ctx: CanvasRenderingContext2D,
    px: number, py: number, r: number,
    race: Race | undefined, category: string, team: Team, playerColor: string
  ): void {
    ctx.fillStyle = playerColor;

    switch (race) {
      // ─── CROWN: shield + balanced, regal ───
      case Race.Crown:
        if (category === 'melee') {
          // Shield / rounded rect
          const rr = r * 0.3;
          ctx.beginPath();
          ctx.moveTo(px - r + rr, py - r);
          ctx.lineTo(px + r - rr, py - r);
          ctx.quadraticCurveTo(px + r, py - r, px + r, py - r + rr);
          ctx.lineTo(px + r, py + r * 0.5);
          ctx.lineTo(px, py + r);
          ctx.lineTo(px - r, py + r * 0.5);
          ctx.lineTo(px - r, py - r + rr);
          ctx.quadraticCurveTo(px - r, py - r, px - r + rr, py - r);
          ctx.closePath();
          ctx.fill();
        } else if (category === 'ranged') {
          // Chevron/arrow pointing in move direction
          const dir = team === Team.Bottom ? -1 : 1;
          ctx.beginPath();
          ctx.moveTo(px - r, py + r * 0.5 * dir);
          ctx.lineTo(px, py - r * dir);
          ctx.lineTo(px + r, py + r * 0.5 * dir);
          ctx.lineTo(px + r * 0.5, py + r * 0.5 * dir);
          ctx.lineTo(px, py - r * 0.3 * dir);
          ctx.lineTo(px - r * 0.5, py + r * 0.5 * dir);
          ctx.closePath();
          ctx.fill();
        } else {
          // 4-pointed star (holy)
          ctx.beginPath();
          const inner = r * 0.35;
          for (let i = 0; i < 8; i++) {
            const a = (i * Math.PI / 4) - Math.PI / 2;
            const rad = i % 2 === 0 ? r : inner;
            const sx = px + Math.cos(a) * rad;
            const sy = py + Math.sin(a) * rad;
            if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
          }
          ctx.closePath();
          ctx.fill();
        }
        break;

      // ─── HORDE: heavy, brutish ───
      case Race.Horde:
        if (category === 'melee') {
          // Cross/plus (heavy)
          const arm = r * 0.4;
          ctx.beginPath();
          ctx.moveTo(px - arm, py - r);
          ctx.lineTo(px + arm, py - r);
          ctx.lineTo(px + arm, py - arm);
          ctx.lineTo(px + r, py - arm);
          ctx.lineTo(px + r, py + arm);
          ctx.lineTo(px + arm, py + arm);
          ctx.lineTo(px + arm, py + r);
          ctx.lineTo(px - arm, py + r);
          ctx.lineTo(px - arm, py + arm);
          ctx.lineTo(px - r, py + arm);
          ctx.lineTo(px - r, py - arm);
          ctx.lineTo(px - arm, py - arm);
          ctx.closePath();
          ctx.fill();
        } else if (category === 'ranged') {
          // Hexagon
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (i * Math.PI / 3) - Math.PI / 6;
            const sx = px + Math.cos(a) * r;
            const sy = py + Math.sin(a) * r;
            if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
          }
          ctx.closePath();
          ctx.fill();
        } else {
          // Crystal: tall narrow diamond
          ctx.beginPath();
          ctx.moveTo(px, py - r * 1.1);
          ctx.lineTo(px + r * 0.5, py);
          ctx.lineTo(px, py + r * 1.1);
          ctx.lineTo(px - r * 0.5, py);
          ctx.closePath();
          ctx.fill();
        }
        break;

      // ─── GOBLINS: fast, pointy ───
      case Race.Goblins:
        if (category === 'melee') {
          // Narrow dagger
          ctx.beginPath();
          ctx.moveTo(px, py - r);
          ctx.lineTo(px + r * 0.4, py + r * 0.3);
          ctx.lineTo(px + r * 0.2, py + r);
          ctx.lineTo(px - r * 0.2, py + r);
          ctx.lineTo(px - r * 0.4, py + r * 0.3);
          ctx.closePath();
          ctx.fill();
        } else if (category === 'ranged') {
          // Narrow kite
          ctx.beginPath();
          ctx.moveTo(px, py - r * 1.2);
          ctx.lineTo(px + r * 0.5, py);
          ctx.lineTo(px, py + r * 0.6);
          ctx.lineTo(px - r * 0.5, py);
          ctx.closePath();
          ctx.fill();
        } else {
          // Hexing eye
          ctx.beginPath();
          ctx.moveTo(px - r, py);
          ctx.quadraticCurveTo(px, py - r * 1.1, px + r, py);
          ctx.quadraticCurveTo(px, py + r * 1.1, px - r, py);
          ctx.closePath();
          ctx.fill();
        }
        break;

      // ─── OOZLINGS: blobby, round ───
      case Race.Oozlings:
        if (category === 'melee') {
          // Small circle blob
          ctx.beginPath();
          ctx.arc(px, py, r * 0.8, 0, Math.PI * 2);
          ctx.fill();
        } else if (category === 'ranged') {
          // Spore: 3-lobed trefoil
          for (let i = 0; i < 3; i++) {
            const a = (i * Math.PI * 2 / 3) - Math.PI / 2;
            ctx.beginPath();
            ctx.arc(px + Math.cos(a) * r * 0.35, py + Math.sin(a) * r * 0.35, r * 0.45, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          // Wave/pulse ring
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#0a0a0a';
          ctx.beginPath();
          ctx.arc(px, py, r * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        break;

      // ─── DEMON: sharp, aggressive ───
      case Race.Demon:
        if (category === 'melee') {
          // Flame: triangle with notch
          ctx.beginPath();
          ctx.moveTo(px, py - r);
          ctx.lineTo(px + r, py + r);
          ctx.lineTo(px + r * 0.2, py + r * 0.3);
          ctx.lineTo(px, py + r * 0.7);
          ctx.lineTo(px - r * 0.2, py + r * 0.3);
          ctx.lineTo(px - r, py + r);
          ctx.closePath();
          ctx.fill();
        } else if (category === 'ranged') {
          // Narrow kite (firebolt)
          ctx.beginPath();
          ctx.moveTo(px, py - r * 1.2);
          ctx.lineTo(px + r * 0.5, py);
          ctx.lineTo(px, py + r * 0.6);
          ctx.lineTo(px - r * 0.5, py);
          ctx.closePath();
          ctx.fill();
        } else {
          // Sunburst: small circle + 6 rays
          ctx.beginPath();
          ctx.arc(px, py, r * 0.4, 0, Math.PI * 2);
          ctx.fill();
          for (let i = 0; i < 6; i++) {
            const a = i * Math.PI / 3;
            ctx.beginPath();
            ctx.moveTo(px + Math.cos(a - 0.2) * r * 0.35, py + Math.sin(a - 0.2) * r * 0.35);
            ctx.lineTo(px + Math.cos(a) * r, py + Math.sin(a) * r);
            ctx.lineTo(px + Math.cos(a + 0.2) * r * 0.35, py + Math.sin(a + 0.2) * r * 0.35);
            ctx.fill();
          }
        }
        break;

      // ─── DEEP: rounded, control ───
      case Race.Deep:
        if (category === 'melee') {
          // Shell: rounded shield
          ctx.beginPath();
          ctx.arc(px, py - r * 0.1, r, Math.PI, 0);
          ctx.lineTo(px + r * 0.5, py + r);
          ctx.lineTo(px - r * 0.5, py + r);
          ctx.closePath();
          ctx.fill();
        } else if (category === 'ranged') {
          // Circle (bubble)
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Wave/crescent
          ctx.beginPath();
          ctx.arc(px, py, r, 0.3 * Math.PI, 1.7 * Math.PI);
          ctx.arc(px + r * 0.3, py, r * 0.7, 1.7 * Math.PI, 0.3 * Math.PI, true);
          ctx.closePath();
          ctx.fill();
        }
        break;

      // ─── WILD: organic, spiky ───
      case Race.Wild:
        if (category === 'melee') {
          // Thorny pentagon with spikes
          ctx.beginPath();
          for (let i = 0; i < 5; i++) {
            const a = (i * Math.PI * 2 / 5) - Math.PI / 2;
            const outerR = r * 1.1;
            const midA = a + Math.PI / 5;
            const innerR = r * 0.55;
            const sx = px + Math.cos(a) * outerR;
            const sy = py + Math.sin(a) * outerR;
            const mx = px + Math.cos(midA) * innerR;
            const my = py + Math.sin(midA) * innerR;
            if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
            ctx.lineTo(mx, my);
          }
          ctx.closePath();
          ctx.fill();
        } else if (category === 'ranged') {
          // Spore: 3-lobed trefoil
          for (let i = 0; i < 3; i++) {
            const a = (i * Math.PI * 2 / 3) - Math.PI / 2;
            ctx.beginPath();
            ctx.arc(px + Math.cos(a) * r * 0.4, py + Math.sin(a) * r * 0.4, r * 0.5, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          // Root: Y-shape / trident
          const armW = r * 0.25;
          ctx.beginPath();
          ctx.moveTo(px - armW, py + r);
          ctx.lineTo(px - armW, py);
          ctx.lineTo(px - r, py - r * 0.8);
          ctx.lineTo(px - r * 0.5, py - r);
          ctx.lineTo(px, py - r * 0.3);
          ctx.lineTo(px + r * 0.5, py - r);
          ctx.lineTo(px + r, py - r * 0.8);
          ctx.lineTo(px + armW, py);
          ctx.lineTo(px + armW, py + r);
          ctx.closePath();
          ctx.fill();
        }
        break;

      // ─── GEISTS: wispy, sinister ───
      case Race.Geists:
        if (category === 'melee') {
          // Curved dagger / fang shape
          ctx.beginPath();
          ctx.moveTo(px, py - r);
          ctx.quadraticCurveTo(px + r * 1.2, py - r * 0.2, px + r * 0.3, py + r);
          ctx.lineTo(px, py + r * 0.4);
          ctx.lineTo(px - r * 0.3, py + r);
          ctx.quadraticCurveTo(px - r * 1.2, py - r * 0.2, px, py - r);
          ctx.closePath();
          ctx.fill();
        } else if (category === 'ranged') {
          // Eye/slit shape
          ctx.beginPath();
          ctx.moveTo(px - r, py);
          ctx.quadraticCurveTo(px, py - r * 1.1, px + r, py);
          ctx.quadraticCurveTo(px, py + r * 1.1, px - r, py);
          ctx.closePath();
          ctx.fill();
        } else {
          // Void portal: ring with gap
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#0a0a0a';
          ctx.beginPath();
          ctx.arc(px, py, r * 0.55, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = playerColor;
          ctx.beginPath();
          ctx.arc(px, py, r * 0.2, 0, Math.PI * 2);
          ctx.fill();
        }
        break;

      // ─── TENDERS: organic, gentle ───
      case Race.Tenders:
        if (category === 'melee') {
          // Treant: wide rounded
          ctx.beginPath();
          ctx.arc(px, py - r * 0.2, r * 0.7, Math.PI, 0);
          ctx.lineTo(px + r, py + r);
          ctx.lineTo(px - r, py + r);
          ctx.closePath();
          ctx.fill();
        } else if (category === 'ranged') {
          // Seed/teardrop
          ctx.beginPath();
          ctx.moveTo(px, py - r);
          ctx.quadraticCurveTo(px + r, py, px, py + r);
          ctx.quadraticCurveTo(px - r, py, px, py - r);
          ctx.closePath();
          ctx.fill();
        } else {
          // Flower: circle + 4 petals
          ctx.beginPath();
          ctx.arc(px, py, r * 0.35, 0, Math.PI * 2);
          ctx.fill();
          for (let i = 0; i < 4; i++) {
            const a = (i * Math.PI / 2) - Math.PI / 4;
            ctx.beginPath();
            ctx.arc(px + Math.cos(a) * r * 0.5, py + Math.sin(a) * r * 0.5, r * 0.35, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        break;

      // ─── FALLBACK: original shapes ───
      default:
        if (category === 'melee') {
          ctx.fillRect(px - r, py - r, r * 2, r * 2);
        } else if (category === 'ranged') {
          const dir = team === Team.Bottom ? -1 : 1;
          ctx.beginPath();
          ctx.moveTo(px, py - r * dir);
          ctx.lineTo(px + r, py + r * dir);
          ctx.lineTo(px - r, py + r * dir);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(px, py - r);
          ctx.lineTo(px + r * 0.7, py);
          ctx.lineTo(px, py + r);
          ctx.lineTo(px - r * 0.7, py);
          ctx.closePath();
          ctx.fill();
        }
        break;
    }
  }

  // === Harvesters ===

  private drawOneHarvester(ctx: CanvasRenderingContext2D, state: GameState, h: HarvesterState): void {
    {
      const px = h.x * T, py = h.y * T;

      // Drop shadow (day/night responsive)
      ctx.fillStyle = `rgba(0,0,0,${this.dayNight.brightness * 0.18})`;
      ctx.beginPath();
      ctx.ellipse(px, py + 2, 4, 2, 0, 0, Math.PI * 2);
      ctx.fill();

      const spriteData = this.sprites.getHarvesterSprite(h.playerId, h.state, h.carryingResource, h.assignment);
      if (spriteData) {
        const [img, def] = spriteData;
        const hScale = def.scale ?? 1.0;
        const drawH = T * 1.56 * hScale;
        const aspect = def.frameW / def.frameH;
        const drawW = drawH * aspect;
        const frame = getSpriteFrame(state.tick, def);

        // Use negative id space for harvesters to avoid collision with unit ids
        const faceLeft = this.updateFacing(-h.id, h.x, h.team === Team.Top);
        const hFeetY = py + T * 0.17;
        const hDrawY = hFeetY - drawH * (def.groundY ?? 0.71);

        if (faceLeft) {
          ctx.save();
          ctx.translate(px, 0);
          ctx.scale(-1, 1);
          drawSpriteFrame(ctx, img, def, frame, -drawW / 2, hDrawY, drawW, drawH);
          ctx.restore();
        } else {
          drawSpriteFrame(ctx, img, def, frame, px - drawW / 2, hDrawY, drawW, drawH);
        }
      } else {
        // Fallback procedural
        let color = PLAYER_COLORS[h.playerId] || (h.team === Team.Bottom ? '#64b5f6' : '#ef9a9a');
        if (h.state === 'fighting') color = '#ff5722';
        ctx.beginPath();
        ctx.moveTo(px, py - 4); ctx.lineTo(px + 4, py + 4); ctx.lineTo(px - 4, py + 4);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      }

      if (h.carryingResource === ResourceType.Wood && h.carryAmount > 0 && h.state === 'walking_home') {
        const faceLeft = this.updateFacing(-h.id, h.x, h.team === Team.Top);
        const bundleX = px + (faceLeft ? -7 : 7);
        const bundleY = py - 5;
        const logData = this.sprites.getResourceSprite('woodResource');
        if (logData) {
          const [img, def] = logData;
          const sz = 10;
          drawSpriteFrame(ctx, img, def, 0, bundleX - sz / 2, bundleY - sz / 2, sz, sz);
        } else {
          ctx.fillStyle = '#8d5a35';
          ctx.fillRect(bundleX - 4, bundleY - 2, 8, 4);
        }
      }

      if (h.carryingDiamond) {
        ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      }

      // Frightened indicator: slow VFX when enemies nearby
      let frightened = false;
      for (const u of state.units) {
        if (u.team === h.team || u.hp <= 0) continue;
        const edx = u.x - h.x, edy = u.y - h.y;
        if (edx * edx + edy * edy <= 25) { frightened = true; break; }
      }
      if (frightened) {
        const fxData = this.sprites.getFxSprite('slow');
        if (fxData) {
          const [fxImg, fxDef] = fxData;
          const fxSize = T * 0.7;
          const fxTick = Math.floor(state.tick / 4) % fxDef.cols;
          ctx.globalAlpha = 0.55;
          drawSpriteFrame(ctx, fxImg, fxDef as SpriteDef, fxTick + h.id * 3, px - fxSize / 2, py - fxSize * 0.6, fxSize, fxSize);
          ctx.globalAlpha = 1;
        }
      }

      // Mana harvester glow (Demon)
      if (h.assignment === HarvesterAssignment.Mana) {
        const glowPulse = 0.4 + 0.3 * Math.sin(state.tick * 0.15 + h.id);
        ctx.beginPath();
        ctx.arc(px, py - 2, 6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(124, 77, 255, ${glowPulse})`;
        ctx.fill();
      }

      // HP bar
      if (h.hp < h.maxHp) {
        const barW = 8, barH = 2;
        const barX = px - barW / 2, barY = py - 8;
        const pct = h.hp / h.maxHp;
        ctx.fillStyle = '#111';
        ctx.fillRect(barX, barY, barW, barH);
        ctx.fillStyle = pct > 0.5 ? '#4caf50' : '#f44336';
        ctx.fillRect(barX, barY, barW * pct, barH);
      }
    }
  }

  // === Diamond Objective ===

  private drawDiamondObjective(ctx: CanvasRenderingContext2D, state: GameState): void {
    const d = state.diamond;
    if (d.state === 'carried') return;

    // Respawning: show a faded timer at center
    if (d.state === 'respawning') {
      const px = d.x * T + T / 2;
      const py = d.y * T + T / 2;
      const secs = Math.ceil(d.respawnTimer / 20);
      ctx.save();
      ctx.globalAlpha = 0.4 + 0.2 * Math.sin(Date.now() / 500);
      ctx.beginPath();
      ctx.arc(px, py, 14, 0, Math.PI * 2);
      ctx.strokeStyle = '#00ffff';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#00ffff';
      ctx.fillText(`${secs}s`, px, py + 4);
      ctx.textAlign = 'start';
      ctx.restore();
      return;
    }

    const px = d.x * T + T / 2;
    const py = d.y * T + T / 2;
    const size = 10;
    const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 300);

    if (d.state === 'hidden') {
      // Always show a center beacon while hidden so players learn
      // "mid control + mining unlocks the diamond win path".
      const r = 18 + 4 * pulse;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 230, 120, 0.45)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 230, 150, 0.55)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 220, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      const labelText = 'MINE TO UNLOCK CHAMPION';
      const labelY = py - r - 10;
      const labelW = ctx.measureText(labelText).width;
      // Dark background pill for readability
      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
      const pillPadX = 6, pillPadY = 4;
      ctx.beginPath();
      const pillR = pillPadY + 5;
      ctx.roundRect(px - labelW / 2 - pillPadX, labelY - pillPadY - 5, labelW + pillPadX * 2, pillPadY * 2 + 10, pillR);
      ctx.fill();
      // White text for contrast
      ctx.fillStyle = '#fff';
      ctx.fillText(labelText, px, labelY);
      ctx.textAlign = 'start';
      return;
    }

    // Glow ring (cheap replacement for expensive shadowBlur)
    ctx.fillStyle = `rgba(255, 255, 255, ${0.15 * pulse})`;
    ctx.beginPath();
    ctx.arc(px, py, size * 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(px, py - size); ctx.lineTo(px + size, py);
    ctx.lineTo(px, py + size); ctx.lineTo(px - size, py);
    ctx.closePath();
    ctx.fillStyle = `rgba(255, 255, 255, ${0.8 + 0.2 * pulse})`;
    ctx.fill();
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('CHAMPION', px, py + size + 12);
    ctx.textAlign = 'start';
  }

  // === Tower Attack Lines ===

  private drawTowerAttackLines(ctx: CanvasRenderingContext2D, state: GameState): void {
    ctx.lineWidth = 0.5;
    for (const p of state.projectiles) {
      // Draw faint lines for tower/HQ bolts only
      if (p.visual !== 'bolt') continue;
      // Fog: skip if projectile is in unseen tile
      if (state.fogOfWar && !this.isTileVisible(state, p.x, p.y)) continue;
      const target = state.units.find(u => u.id === p.targetId);
      if (!target) continue;
      const race = state.players[p.sourcePlayerId]?.race;
      const color = race ? (RACE_COLORS[race]?.primary ?? '#fff') : '#fff';
      ctx.strokeStyle = color + '30';
      ctx.beginPath();
      ctx.moveTo(p.x * T + T / 2, p.y * T + T / 2);
      ctx.lineTo(target.x * T + T / 2, target.y * T + T / 2);
      ctx.stroke();
    }
  }

  // === Nuke Telegraph ===

  private drawNukeTelegraphs(ctx: CanvasRenderingContext2D, state: GameState): void {
    for (const tel of state.nukeTelegraphs) {
      const px = tel.x * T, py = tel.y * T;
      const r = tel.radius * T;
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 100);
      const progress = 1 - tel.timer / Math.round(1.25 * 20); // 0 -> 1 as it nears detonation

      // Warning circle - gets more intense as it approaches detonation
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 50, 0, ${0.05 + 0.15 * progress})`;
      ctx.fill();

      // Pulsing ring
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 50, 0, ${0.3 + 0.4 * pulse * progress})`;
      ctx.lineWidth = 2 + progress * 3;
      ctx.setLineDash([8, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Inner concentric ring
      ctx.beginPath();
      ctx.arc(px, py, r * 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 100, 0, ${0.2 + 0.3 * pulse * progress})`;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Warning text
      ctx.fillStyle = `rgba(255, 50, 0, ${0.7 + 0.3 * pulse})`;
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('NUKE INCOMING', px, py - r - 8);
      ctx.textAlign = 'start';
    }
  }

  private drawPings(ctx: CanvasRenderingContext2D, state: GameState): void {
    const localTeam = state.players[this.localPlayerId]?.team ?? Team.Bottom;
    for (const p of state.pings) {
      if (p.team !== localTeam) continue;
      const progress = p.age / p.maxAge;
      const alpha = Math.max(0, 1 - progress);
      const px = p.x * T;
      const py = p.y * T;
      const baseR = 10 + progress * 16;

      ctx.beginPath();
      ctx.arc(px, py, baseR, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 235, 59, ${0.7 * alpha})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 235, 59, ${0.9 * alpha})`;
      ctx.fill();

      ctx.fillStyle = `rgba(255, 235, 59, ${alpha})`;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`PING P${p.playerId + 1}`, px, py - baseR - 6);
      ctx.textAlign = 'start';
    }
  }

  // === Visual Effects ===

  private drawParticles(ctx: CanvasRenderingContext2D, state: GameState): void {
    for (const p of state.particles) {
      const progress = p.age / p.maxAge;
      const alpha = 1 - progress;
      // Shrink slightly as they age
      const size = p.size * (1 - progress * 0.4);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x * T, p.y * T, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawDeathEffects(ctx: CanvasRenderingContext2D): void {
    for (let i = this.deathEffects.length - 1; i >= 0; i--) {
      const d = this.deathEffects[i];
      const progress = d.frame / d.maxFrames;

      if (d.type === 'race_burst' && d.race != null) {
        // Race-colored OVERBURN circle burst on unit death
        const circData = this.sprites.getCircleSprite(d.race);
        if (circData) {
          const [img, def] = circData;
          // Play through the circle animation (48 frames mapped to our maxFrames)
          const sprFrame = Math.min(Math.floor(progress * def.totalFrames), def.totalFrames - 1);
          const alpha = 1 - progress * 0.6;
          const scale = 1 + progress * 0.5; // expand slightly
          const s = d.size * scale;
          ctx.globalAlpha = alpha;
          drawGridFrame(ctx, img, def, sprFrame, d.x * T - s / 2, d.y * T - s / 2, s, s);
          ctx.globalAlpha = 1;
        } else {
          // Fallback to dust if sprite not loaded
          const fxData = this.sprites.getFxSprite('dust');
          if (fxData) {
            const [img, def] = fxData;
            const sprFrame = Math.min(Math.floor(progress * def.cols), def.cols - 1);
            ctx.globalAlpha = 1 - progress * 0.5;
            drawSpriteFrame(ctx, img, def as SpriteDef, sprFrame, d.x * T - d.size / 2, d.y * T - d.size / 2, d.size, d.size);
            ctx.globalAlpha = 1;
          }
        }
      } else {
        // Original explosion/dust effects for buildings
        const fxKey = d.type === 'explosion' ? 'explosion' : 'dust';
        const fxData = this.sprites.getFxSprite(fxKey);
        if (fxData) {
          const [img, def] = fxData;
          const totalFrames = def.cols;
          const sprFrame = Math.min(Math.floor(progress * totalFrames), totalFrames - 1);
          const alpha = 1 - progress * 0.5;
          ctx.globalAlpha = alpha;
          const s = d.size;
          drawSpriteFrame(ctx, img, def as SpriteDef, sprFrame, d.x * T - s / 2, d.y * T - s / 2, s, s);
          ctx.globalAlpha = 1;
        }
      }

      d.frame++;
      if (d.frame >= d.maxFrames) this.deathEffects.splice(i, 1);
    }
  }

  private detectDeaths(state: GameState): void {
    // Unit deaths
    const currentUnitIds = this._pooledUnitIds;
    currentUnitIds.clear();
    for (const u of state.units) {
      currentUnitIds.add(u.id);
      const faceLeft = this.facing.get(u.id) ?? (u.team === Team.Top);
      const wasAttacking = u.targetId !== null && u.attackTimer <= u.attackSpeed * 0.5;
      const category = u.category as UnitCategory;
      const race = state.players[u.playerId]?.race;
      const spriteData = race
        ? this.sprites.getUnitSprite(race, category, u.playerId, wasAttacking, u.upgradeNode)
        : null;
      const frame = spriteData ? getSpriteFrame(state.tick, spriteData[1]) : 0;
      this.lastUnitPositions.set(u.id, { x: u.x, y: u.y, team: u.team, race });
      this.lastUnitRenders.set(u.id, {
        x: u.x,
        y: u.y,
        team: u.team,
        playerId: u.playerId,
        race,
        category,
        upgradeNode: u.upgradeNode,
        upgradeTier: u.upgradeTier ?? 0,
        lane: u.lane,
        faceLeft,
        wasAttacking,
        frame,
      });
    }
    for (const id of this.lastUnitIds) {
      if (!currentUnitIds.has(id)) {
        const pos = this.lastUnitPositions.get(id);
        const render = this.lastUnitRenders.get(id);
        if (pos) {
          // Scale burst by unit tier — bigger units get bigger death effects
          const tier = render?.upgradeTier ?? 0;
          const burstScale = 1.0 + tier * 0.15;
          this.deathEffects.push({
            x: pos.x, y: pos.y, frame: 0, maxFrames: 16,
            size: T * 1.8 * burstScale, type: 'race_burst', race: pos.race
          });
        }
        if (render) {
          this.deadUnits.push({
            id,
            ...render,
            ageSec: 0,
          });
        }
        this.lastUnitPositions.delete(id);
        this.lastUnitRenders.delete(id);
        this.prevX.delete(id);
        this.facing.delete(id);
        this.smoothHp.delete(id);
      }
    }
    this.lastUnitIds = currentUnitIds;

    // Building deaths — explosion for destroyed (low HP), dust puff for sold (high HP)
    const currentBuildingIds = this._pooledBuildingIds;
    currentBuildingIds.clear();
    for (const b of state.buildings) {
      currentBuildingIds.add(b.id);
      this.lastBuildingPositions.set(b.id, { x: b.worldX + 0.5, y: b.worldY + 0.5, hpPct: b.hp / b.maxHp });
    }
    for (const id of this.lastBuildingIds) {
      if (!currentBuildingIds.has(id)) {
        const pos = this.lastBuildingPositions.get(id);
        if (pos) {
          const wasDestroyed = pos.hpPct <= 0.15;
          this.deathEffects.push({
            x: pos.x, y: pos.y, frame: 0,
            maxFrames: wasDestroyed ? 16 : 10,
            size: wasDestroyed ? T * 2.5 : T * 1.5,
            type: wasDestroyed ? 'explosion' : 'dust',
          });
        }
        this.lastBuildingPositions.delete(id);
      }
    }
    this.lastBuildingIds = currentBuildingIds;
  }

  private detectNewBuildings(state: GameState): void {
    for (const b of state.buildings) {
      if (!this.knownBuildingIds.has(b.id)) {
        this.knownBuildingIds.add(b.id);
        this.constructionAnims.register(b.id, state.tick);
      }
    }
    // Cleanup removed buildings
    const currentIds = this._pooledBuildingIds2;
    currentIds.clear();
    for (const b of state.buildings) currentIds.add(b.id);
    for (const id of this.knownBuildingIds) {
      if (!currentIds.has(id)) this.knownBuildingIds.delete(id);
    }
    this.constructionAnims.cleanup(currentIds);
  }

  private drawFloatingTexts(ctx: CanvasRenderingContext2D, state: GameState): void {
    for (const ft of state.floatingTexts) {
      const t = ft.age / ft.maxAge; // 0→1 progress
      const isDmg = ft.ftType === 'damage';
      const isHeal = ft.ftType === 'heal';

      // Alpha: hold full opacity longer, then quick fade out
      const alpha = t < 0.6 ? 1 : 1 - ((t - 0.6) / 0.4) * ((t - 0.6) / 0.4);

      // Movement depends on type
      let xOff: number, yOff: number;
      if (isDmg && ft.vx) {
        // Arc trajectory: horizontal drift + gravity curve
        xOff = ft.vx * ft.age * T * 1.5;
        const initVy = ft.vy ?? -0.12;
        yOff = (initVy * ft.age + 0.004 * ft.age * ft.age) * T; // gravity arc
      } else if (isHeal) {
        // Healing floats gently upward
        xOff = ft.xOff * T;
        yOff = -(1 - (1 - t) * (1 - t)) * 30;
      } else {
        // Default: easeOut rise
        xOff = ft.xOff * T;
        yOff = -(1 - (1 - t) * (1 - t)) * 24;
      }

      // Scale: magnitude-based for damage, pop-in for big/status
      let scale = 1;
      if (isDmg && ft.magnitude) {
        // Damage scales: 5→1.0x, 20→1.2x, 50+→1.5x
        const magScale = Math.min(1.5, 1 + (ft.magnitude - 5) * 0.011);
        // Pop on spawn then settle
        const popT = Math.min(t / 0.1, 1);
        scale = magScale * (1 + 0.4 * (1 - popT));
      } else if (ft.big) {
        scale = t < 0.15 ? 1.6 - (t / 0.15) * 0.6 : 1;
      }

      // Font size: base 10, big 14, damage magnitude-adjusted
      let fontSize = ft.big ? 14 : 10;
      if (isDmg && ft.magnitude) {
        fontSize = Math.min(16, 9 + Math.floor(ft.magnitude / 10));
      }

      ctx.globalAlpha = Math.max(0, alpha);
      ctx.font = `bold ${fontSize}px monospace`;
      ctx.textAlign = 'center';
      const px = ft.x * T + xOff;
      const py = ft.y * T + yOff;

      ctx.save();
      if (scale !== 1) {
        ctx.translate(px, py);
        ctx.scale(scale, scale);
        ctx.translate(-px, -py);
      }

      // Dark outline for readability
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 2.5;

      // Determine if we have a mini icon to draw
      const mi = ft.miniIcon;
      const hasText = ft.text.length > 0;

      if (mi && !ft.icon) {
        // Draw mini icon + text (icon on left, text on right)
        const iconSz = fontSize + 2;
        const textW = hasText ? ctx.measureText(ft.text).width : 0;
        const gap = hasText ? 2 : 0;
        const totalW = iconSz + gap + textW;
        const iconX = px - totalW / 2;
        const iconCy = py - iconSz / 2 - 1;

        // Draw the mini icon
        this.drawMiniIcon(ctx, mi, iconX, iconCy, iconSz, ft.color);

        // Draw text to the right of icon
        if (hasText) {
          const textX = iconX + iconSz + gap + textW / 2;
          ctx.strokeText(ft.text, textX, py);
          ctx.fillStyle = ft.color;
          ctx.fillText(ft.text, textX, py);
        }
      } else if (ft.icon) {
        // Resource icon (gold, wood, etc.) - existing behavior
        const textW = ctx.measureText(ft.text).width;
        const iconSz = fontSize;
        const totalW = textW + iconSz + 1;
        const textX = px - totalW / 2 + textW / 2;
        ctx.strokeText(ft.text, textX, py);
        ctx.fillStyle = ft.color;
        ctx.fillText(ft.text, textX, py);
        const iconX = textX + textW / 2 + 1;
        const iconCy = py - iconSz / 2 - 1;
        if (!this.ui.drawIcon(ctx, ft.icon as any, iconX, iconCy, iconSz)) {
          const icx = iconX + iconSz / 2, icy = iconCy + iconSz / 2;
          const ihr = iconSz * 0.4;
          if (ft.icon === 'mana') {
            ctx.fillStyle = '#7c4dff';
            ctx.beginPath();
            ctx.moveTo(icx, icy - ihr); ctx.lineTo(icx + ihr * 0.7, icy);
            ctx.lineTo(icx, icy + ihr); ctx.lineTo(icx - ihr * 0.7, icy);
            ctx.closePath(); ctx.fill();
          } else if (ft.icon === 'soul') {
            ctx.fillStyle = '#ce93d8';
            ctx.beginPath(); ctx.arc(icx, icy - ihr * 0.2, ihr * 0.55, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath();
            ctx.moveTo(icx - ihr * 0.3, icy + ihr * 0.2);
            ctx.quadraticCurveTo(icx + ihr * 0.2, icy + ihr * 0.4, icx - ihr * 0.1, icy + ihr * 0.8);
            ctx.strokeStyle = '#ce93d8'; ctx.lineWidth = 1.5; ctx.stroke();
          } else if (ft.icon === 'ooze') {
            ctx.fillStyle = '#69f0ae';
            ctx.beginPath();
            ctx.moveTo(icx, icy - ihr);
            ctx.quadraticCurveTo(icx + ihr * 0.8, icy + ihr * 0.3, icx, icy + ihr);
            ctx.quadraticCurveTo(icx - ihr * 0.8, icy + ihr * 0.3, icx, icy - ihr);
            ctx.fill();
          }
        }
      } else {
        ctx.strokeText(ft.text, px, py);
        ctx.fillStyle = ft.color;
        ctx.fillText(ft.text, px, py);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'start';
  }

  /** Draw a small canvas icon for floating text (sword, arrow, fire, etc.) */
  private drawMiniIcon(ctx: CanvasRenderingContext2D, icon: string, x: number, y: number, sz: number, color: string): void {
    const cx = x + sz / 2, cy = y + sz / 2;
    const r = sz * 0.4;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';

    switch (icon) {
      case 'sword': {
        // Simple sword: blade line + crossguard
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.7, cy + r * 0.7);
        ctx.lineTo(cx + r * 0.7, cy - r * 0.7);
        ctx.stroke();
        // Crossguard
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.4, cy - r * 0.2);
        ctx.lineTo(cx + r * 0.2, cy + r * 0.4);
        ctx.stroke();
        // Pommel dot
        ctx.beginPath();
        ctx.arc(cx - r * 0.7, cy + r * 0.7, r * 0.15, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'arrow': {
        // Arrow pointing down-right
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.7, cy - r * 0.5);
        ctx.lineTo(cx + r * 0.7, cy + r * 0.5);
        ctx.stroke();
        // Arrowhead
        ctx.beginPath();
        ctx.moveTo(cx + r * 0.7, cy + r * 0.5);
        ctx.lineTo(cx + r * 0.2, cy + r * 0.3);
        ctx.moveTo(cx + r * 0.7, cy + r * 0.5);
        ctx.lineTo(cx + r * 0.5, cy);
        ctx.stroke();
        break;
      }
      case 'fire': {
        // Flame shape
        ctx.fillStyle = '#ff8c00';
        ctx.beginPath();
        ctx.moveTo(cx, cy - r);
        ctx.quadraticCurveTo(cx + r * 0.8, cy - r * 0.2, cx + r * 0.4, cy + r * 0.6);
        ctx.quadraticCurveTo(cx, cy + r * 0.2, cx - r * 0.4, cy + r * 0.6);
        ctx.quadraticCurveTo(cx - r * 0.8, cy - r * 0.2, cx, cy - r);
        ctx.fill();
        // Inner flame
        ctx.fillStyle = '#ffeb3b';
        ctx.beginPath();
        ctx.moveTo(cx, cy - r * 0.4);
        ctx.quadraticCurveTo(cx + r * 0.35, cy + r * 0.1, cx + r * 0.15, cy + r * 0.5);
        ctx.quadraticCurveTo(cx, cy + r * 0.3, cx - r * 0.15, cy + r * 0.5);
        ctx.quadraticCurveTo(cx - r * 0.35, cy + r * 0.1, cx, cy - r * 0.4);
        ctx.fill();
        break;
      }
      case 'skull': {
        // Mini skull
        ctx.beginPath();
        ctx.arc(cx, cy - r * 0.15, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
        // Eyes (dark)
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.beginPath();
        ctx.arc(cx - r * 0.2, cy - r * 0.2, r * 0.12, 0, Math.PI * 2);
        ctx.arc(cx + r * 0.2, cy - r * 0.2, r * 0.12, 0, Math.PI * 2);
        ctx.fill();
        // Jaw
        ctx.fillStyle = color;
        ctx.fillRect(cx - r * 0.3, cy + r * 0.3, r * 0.6, r * 0.25);
        break;
      }
      case 'shield_icon': {
        // Shield shape
        ctx.beginPath();
        ctx.moveTo(cx, cy - r * 0.7);
        ctx.lineTo(cx + r * 0.6, cy - r * 0.3);
        ctx.lineTo(cx + r * 0.5, cy + r * 0.4);
        ctx.lineTo(cx, cy + r * 0.7);
        ctx.lineTo(cx - r * 0.5, cy + r * 0.4);
        ctx.lineTo(cx - r * 0.6, cy - r * 0.3);
        ctx.closePath();
        ctx.fill();
        // Inner highlight
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.beginPath();
        ctx.moveTo(cx, cy - r * 0.4);
        ctx.lineTo(cx + r * 0.3, cy - r * 0.1);
        ctx.lineTo(cx + r * 0.25, cy + r * 0.2);
        ctx.lineTo(cx, cy + r * 0.4);
        ctx.lineTo(cx - r * 0.25, cy + r * 0.2);
        ctx.lineTo(cx - r * 0.3, cy - r * 0.1);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'lightning': {
        // Lightning bolt
        ctx.fillStyle = '#ffeb3b';
        ctx.beginPath();
        ctx.moveTo(cx + r * 0.1, cy - r * 0.8);
        ctx.lineTo(cx - r * 0.3, cy + r * 0.05);
        ctx.lineTo(cx + r * 0.05, cy + r * 0.05);
        ctx.lineTo(cx - r * 0.15, cy + r * 0.8);
        ctx.lineTo(cx + r * 0.4, cy - r * 0.1);
        ctx.lineTo(cx + r * 0.05, cy - r * 0.1);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'poison': {
        // Poison drop
        ctx.fillStyle = '#9c27b0';
        ctx.beginPath();
        ctx.moveTo(cx, cy - r * 0.6);
        ctx.quadraticCurveTo(cx + r * 0.7, cy + r * 0.2, cx, cy + r * 0.7);
        ctx.quadraticCurveTo(cx - r * 0.7, cy + r * 0.2, cx, cy - r * 0.6);
        ctx.fill();
        // Skull dots inside
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        ctx.arc(cx - r * 0.15, cy + r * 0.1, r * 0.08, 0, Math.PI * 2);
        ctx.arc(cx + r * 0.15, cy + r * 0.1, r * 0.08, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'heart': {
        // Heart shape
        ctx.fillStyle = '#44ff44';
        ctx.beginPath();
        ctx.moveTo(cx, cy + r * 0.5);
        ctx.quadraticCurveTo(cx - r * 0.8, cy - r * 0.1, cx - r * 0.4, cy - r * 0.5);
        ctx.quadraticCurveTo(cx, cy - r * 0.8, cx, cy - r * 0.2);
        ctx.quadraticCurveTo(cx, cy - r * 0.8, cx + r * 0.4, cy - r * 0.5);
        ctx.quadraticCurveTo(cx + r * 0.8, cy - r * 0.1, cx, cy + r * 0.5);
        ctx.fill();
        break;
      }
    }
    ctx.lineCap = 'butt';
  }

  private drawNukeEffects(ctx: CanvasRenderingContext2D, state: GameState): void {
    for (const n of state.nukeEffects) {
      const progress = n.age / n.maxAge;
      const px = n.x * T, py = n.y * T;
      const r = n.radius * T;

      // Scorched ground (persists throughout)
      const ringAlpha = Math.max(0, 1 - progress);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(50, 20, 0, ${ringAlpha * 0.3})`;
      ctx.fill();

      if (progress < 0.4) {
        // Shockwave sprite expanding outward
        const shockData = this.sprites.getFxSprite('nukeShockwave');
        if (shockData) {
          const [shockImg, shockDef] = shockData;
          const expandPct = progress / 0.4;
          const shockSize = r * 2 * expandPct;
          ctx.globalAlpha = 0.8 * (1 - expandPct);
          drawGridFrame(ctx, shockImg, shockDef as GridSpriteDef,
            Math.floor(expandPct * (shockDef as GridSpriteDef).totalFrames),
            px - shockSize / 2, py - shockSize / 2, shockSize, shockSize);
          ctx.globalAlpha = 1;
        }

        // Explosion sprites at center
        const explData = this.sprites.getFxSprite('explosion');
        if (explData) {
          const [explImg, explDef] = explData;
          const explSize = r * 1.2;
          const explFrame = Math.floor((progress / 0.4) * explDef.cols);
          ctx.globalAlpha = 0.9 * (1 - progress / 0.4);
          drawSpriteFrame(ctx, explImg, explDef as SpriteDef, explFrame, px - explSize / 2, py - explSize / 2, explSize, explSize);
          ctx.globalAlpha = 1;
        }
      }

      // Fading ring
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 80, 0, ${ringAlpha * 0.5})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  private drawAbilityEffects(ctx: CanvasRenderingContext2D, state: GameState): void {
    const tick = state.tick;
    for (const eff of state.abilityEffects) {
      // Fade in/out multiplier
      const maxDur = eff.type === 'deep_rain' ? 8 * TICK_RATE : 6 * TICK_RATE;
      const fadeIn = Math.min(1, (maxDur - eff.duration) / TICK_RATE);
      const fadeOut = Math.min(1, eff.duration / TICK_RATE);
      const fade = Math.min(fadeIn, fadeOut);

      if (eff.type === 'deep_rain') {
        const md = state.mapDef;
        const mapW = md.width * T, mapH = md.height * T;
        // Dark blue-grey overlay
        ctx.fillStyle = `rgba(40, 60, 90, ${fade * 0.12})`;
        ctx.fillRect(0, 0, mapW, mapH);
        // Dense rain lines falling at an angle
        const lineCount = 120;
        ctx.strokeStyle = `rgba(160, 190, 230, ${fade * 0.3})`;
        ctx.lineWidth = 0.8;
        for (let i = 0; i < lineCount; i++) {
          const seed = i * 7919 + 13;
          const rx = ((tick * 2.5 + seed) % mapW);
          const ry = ((tick * 9 + seed * 3) % mapH);
          const len = 8 + (seed % 8);
          ctx.beginPath();
          ctx.moveTo(rx, ry);
          ctx.lineTo(rx - 2, ry + len);
          ctx.stroke();
        }
        // Occasional lightning flash
        if (eff.duration % (3 * TICK_RATE) < 2) {
          ctx.fillStyle = `rgba(200, 220, 255, ${fade * 0.06})`;
          ctx.fillRect(0, 0, mapW, mapH);
        }
      } else if (eff.type === 'wild_frenzy' && eff.x != null && eff.y != null && eff.radius != null) {
        const px = eff.x * T, py = eff.y * T;
        const r = eff.radius * T;
        const pulse = 0.6 + 0.4 * Math.sin(tick * 0.25);

        // Radial gradient fill
        const grad = ctx.createRadialGradient(px, py, 0, px, py, r);
        grad.addColorStop(0, `rgba(255, 80, 0, ${fade * 0.15 * pulse})`);
        grad.addColorStop(0.7, `rgba(255, 130, 30, ${fade * 0.08 * pulse})`);
        grad.addColorStop(1, `rgba(255, 60, 0, 0)`);
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        // Rotating dashed ring
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(tick * 0.05);
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2);
        ctx.setLineDash([8, 12]);
        ctx.strokeStyle = `rgba(255, 200, 50, ${fade * 0.4})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        // Inner sparks
        for (let i = 0; i < 6; i++) {
          const a = (tick * 0.08 + i * Math.PI / 3) % (Math.PI * 2);
          const sr = r * (0.3 + 0.5 * ((i * 31 + tick) % 20) / 20);
          const sx = px + Math.cos(a) * sr;
          const sy = py + Math.sin(a) * sr;
          ctx.beginPath();
          ctx.arc(sx, sy, 2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 220, 100, ${fade * 0.5})`;
          ctx.fill();
        }
      } else if (eff.type === 'demon_fireball' && eff.x != null && eff.y != null && eff.radius != null) {
        const maxDurFB = Math.round(0.8 * TICK_RATE);
        const progress = 1 - eff.duration / maxDurFB;
        const px = eff.x * T, py = eff.y * T;
        const r = eff.radius * T;

        // Expanding fire ring
        const ringR = r * (0.3 + progress * 0.7);
        const ringAlpha = Math.max(0, 1 - progress);
        ctx.beginPath();
        ctx.arc(px, py, ringR, 0, Math.PI * 2);
        const fireGrad = ctx.createRadialGradient(px, py, 0, px, py, ringR);
        fireGrad.addColorStop(0, `rgba(255, 220, 50, ${ringAlpha * 0.4})`);
        fireGrad.addColorStop(0.4, `rgba(255, 120, 0, ${ringAlpha * 0.3})`);
        fireGrad.addColorStop(1, `rgba(200, 30, 0, 0)`);
        ctx.fillStyle = fireGrad;
        ctx.fill();

        // Explosion sprite if available
        const explData = this.sprites.getFxSprite('explosion');
        if (explData && progress < 0.6) {
          const [explImg, explDef] = explData;
          const explSize = r * 1.5;
          const explFrame = Math.min(Math.floor(progress / 0.6 * explDef.cols), explDef.cols - 1);
          ctx.globalAlpha = 0.8 * (1 - progress / 0.6);
          drawSpriteFrame(ctx, explImg, explDef as SpriteDef, explFrame, px - explSize / 2, py - explSize / 2, explSize, explSize);
          ctx.globalAlpha = 1;
        }

        // Scorched ground
        ctx.beginPath();
        ctx.arc(px, py, r * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(40, 10, 0, ${ringAlpha * 0.2})`;
        ctx.fill();

        // Ember particles
        for (let i = 0; i < 8; i++) {
          const a = (tick * 0.15 + i * Math.PI / 4) % (Math.PI * 2);
          const er = ringR * (0.5 + 0.5 * ((i * 17 + tick * 2) % 30) / 30);
          const ex = px + Math.cos(a) * er;
          const ey = py + Math.sin(a) * er - progress * 15;
          ctx.beginPath();
          ctx.arc(ex, ey, 1.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, ${150 + i * 10}, 0, ${ringAlpha * 0.6})`;
          ctx.fill();
        }
      }
    }

    // Draw fleeing goblin indicator (exclamation mark above head)
    for (const u of state.units) {
      if (u.fleeTimer != null && u.fleeTimer > 0) {
        const px = u.x * T, py = u.y * T;
        ctx.fillStyle = '#ffeb3b';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('!!', px + T / 2, py - 4);
        ctx.textAlign = 'start';
      }
    }
  }

  // === HUD ===

  private drawHUD(ctx: CanvasRenderingContext2D, state: GameState, _networkLatencyMs?: number, desyncDetected?: boolean, peerDisconnected?: boolean, waitingForAllyMs?: number): void {
    const player = state.players[this.localPlayerId];
    if (!player) return;
    const W = this.canvas.clientWidth;
    const compact = W < 600;  // mobile breakpoint
    const fontSize = compact ? 11 : 14;
    const iconSz = compact ? 16 : 22;
    const hudH = compact ? 42 : 56;
    const pad = compact ? 6 : 12;
    const safeTop = getSafeTop();

    // Safe area fill above HUD for notch/rounded corners
    if (safeTop > 0) {
      ctx.fillStyle = '#1a1008';
      ctx.fillRect(0, 0, W, safeTop);
    }

    // HUD background — oversized to hide left/right edges, taller for breathing room
    const bgOverW = Math.round(W * 0.25);
    const bgH = Math.round(hudH * 1.10);
    if (!this.ui.drawWoodTable(ctx, -bgOverW / 2, safeTop, W + bgOverW, bgH)) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.fillRect(0, safeTop, W, bgH);
    }

    ctx.font = `bold ${fontSize}px monospace`;
    const ps = state.playerStats?.[this.localPlayerId];
    const elapsed = Math.max(1, state.tick / 20);

    // Row 1: Resources + timer
    const y1 = safeTop + (compact ? 14 : 20);
    let x = pad;
    const iconY = y1 - iconSz / 2;

    // Resource helper
    const drawRes = (icon: 'gold' | 'wood' | 'meat', val: number, color: string, rate?: string) => {
      this.ui.drawIcon(ctx, icon, x, iconY, iconSz);
      x += iconSz + 1;
      ctx.fillStyle = color;
      const text = rate ? `${val} (+${rate}/s)` : `${val}`;
      ctx.fillText(text, x, y1 + fontSize * 0.35);
      x += ctx.measureText(text).width + (compact ? 4 : 8);
    };

    const goldRate = ps ? (ps.totalGoldEarned / elapsed).toFixed(1) : '?';
    const woodRate = ps ? (ps.totalWoodEarned / elapsed).toFixed(1) : '?';
    const stoneRate = ps ? (ps.totalStoneEarned / elapsed).toFixed(1) : '?';

    const used = getRaceUsedResources(player.race);
    if (used.gold) drawRes('gold', player.gold, '#ffd700', goldRate);
    if (used.wood) drawRes('wood', player.wood, '#4caf50', woodRate);
    if (used.stone) drawRes('meat', player.stone, '#e57373', stoneRate);

    // Race-specific special resources with canvas-drawn icons
    const drawSpecialRes = (val: number, color: string, drawIcon: () => void) => {
      drawIcon();
      x += iconSz + 1;
      ctx.fillStyle = color;
      ctx.fillText(`${val}`, x, y1 + fontSize * 0.35);
      x += ctx.measureText(`${val}`).width + (compact ? 4 : 8);
    };
    if (player.race === Race.Demon) drawSpecialRes(player.mana, '#7c4dff', () => {
      // Mana crystal icon
      const cx_ = x + iconSz / 2, cy_ = iconY + iconSz / 2;
      ctx.fillStyle = '#7c4dff';
      ctx.beginPath();
      ctx.moveTo(cx_, cy_ - iconSz * 0.45);
      ctx.lineTo(cx_ + iconSz * 0.3, cy_);
      ctx.lineTo(cx_, cy_ + iconSz * 0.45);
      ctx.lineTo(cx_ - iconSz * 0.3, cy_);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#b388ff';
      ctx.beginPath();
      ctx.moveTo(cx_, cy_ - iconSz * 0.25);
      ctx.lineTo(cx_ + iconSz * 0.12, cy_);
      ctx.lineTo(cx_, cy_ + iconSz * 0.1);
      ctx.closePath();
      ctx.fill();
    });
    if (player.race === Race.Geists) drawSpecialRes(player.souls, '#ce93d8', () => {
      // Soul wisp icon
      const cx_ = x + iconSz / 2, cy_ = iconY + iconSz / 2;
      ctx.fillStyle = '#ce93d8';
      ctx.beginPath();
      ctx.arc(cx_, cy_ - iconSz * 0.1, iconSz * 0.25, 0, Math.PI * 2);
      ctx.fill();
      // Wisp tail
      ctx.beginPath();
      ctx.moveTo(cx_ - iconSz * 0.15, cy_ + iconSz * 0.1);
      ctx.quadraticCurveTo(cx_ + iconSz * 0.1, cy_ + iconSz * 0.2, cx_ - iconSz * 0.05, cy_ + iconSz * 0.4);
      ctx.strokeStyle = '#ce93d8';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
    if (player.race === Race.Oozlings) drawSpecialRes(player.deathEssence, '#69f0ae', () => {
      // Ooze droplet icon
      const cx_ = x + iconSz / 2, cy_ = iconY + iconSz / 2;
      ctx.fillStyle = '#69f0ae';
      ctx.beginPath();
      ctx.moveTo(cx_, cy_ - iconSz * 0.4);
      ctx.quadraticCurveTo(cx_ + iconSz * 0.35, cy_ + iconSz * 0.1, cx_, cy_ + iconSz * 0.4);
      ctx.quadraticCurveTo(cx_ - iconSz * 0.35, cy_ + iconSz * 0.1, cx_, cy_ - iconSz * 0.4);
      ctx.fill();
    });

    // Timer — right-aligned but leaving room for top-right buttons (ping + info + settings ~120px)
    const hudRightEdge = W - 120;
    const secs = Math.floor(state.tick / 20);
    const timerText = `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
    ctx.fillStyle = '#888';
    ctx.fillText(timerText, hudRightEdge - ctx.measureText(timerText).width, y1 + fontSize * 0.35);

    // Row 2: HQ bars (centered horizontally) + diamond + units
    const y2 = safeTop + (compact ? 32 : 42);
    const smallFont = compact ? 9 : 11;
    ctx.font = `bold ${smallFont}px monospace`;

    // HQ health bars — centered horizontally, with labels inside
    const localTeamHud = player.team;
    const enemyTeamHud = localTeamHud === Team.Bottom ? Team.Top : Team.Bottom;
    const ourHp = state.hqHp[localTeamHud];
    const enemyHp = state.hqHp[enemyTeamHud];
    const hqBarW = compact ? 70 : 100;
    const hqBarH = compact ? 14 : 16;
    const hqGap = compact ? 6 : 10;

    // Diamond status text (measured for centering)
    const goldRemaining = state.diamondCells.reduce((s, c) => s + c.gold, 0);
    const totalGold = state.diamondCells.reduce((s, c) => s + c.maxGold, 0);
    const minedPct = Math.round((1 - goldRemaining / totalGold) * 100);
    const diamondText = state.diamond.exposed
      ? (compact ? 'DIAMOND!' : 'DIAMOND EXPOSED!')
      : (compact ? `${minedPct}%` : `MINE ${minedPct}%`);
    ctx.font = `bold ${smallFont}px monospace`;
    const diamondTextW = ctx.measureText(diamondText).width;

    // Total width: [US bar] [gap] [diamond] [gap] [EN bar]
    const totalRow2W = hqBarW + hqGap + diamondTextW + hqGap + hqBarW;
    let x2 = (W - totalRow2W) / 2;
    const barY = y2 - hqBarH / 2;
    const barLabelFont = compact ? 9 : 11;

    // "Us" bar
    const drawHQBar = (label: string, hp: number, _color: string, bx: number) => {
      const pct = Math.max(0, hp / HQ_HP);
      if (!this.ui.drawBar(ctx, bx, barY, hqBarW, hqBarH, pct)) {
        ctx.fillStyle = '#222';
        ctx.fillRect(bx, barY, hqBarW, hqBarH);
        ctx.fillStyle = pct > 0.5 ? _color : pct > 0.25 ? '#ff9800' : '#f44336';
        ctx.fillRect(bx, barY, hqBarW * pct, hqBarH);
      }
      // Label centered inside bar
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${barLabelFont}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(label, bx + hqBarW / 2, barY + hqBarH / 2 + barLabelFont * 0.35);
      ctx.textAlign = 'start';
    };
    drawHQBar('Us', ourHp, '#2979ff', x2);
    x2 += hqBarW + hqGap;

    // Diamond status (centered between bars)
    ctx.font = `bold ${smallFont}px monospace`;
    ctx.fillStyle = state.diamond.exposed ? '#fff' : '#aa8800';
    ctx.fillText(diamondText, x2, y2);
    x2 += diamondTextW + hqGap;

    // "Them" bar
    drawHQBar('Them', enemyHp, '#ff1744', x2);
    x2 += hqBarW;

    // Right side of row 2: unit counts
    ctx.font = `bold ${smallFont}px monospace`;
    const myUnits = state.units.filter(u => u.team === player.team).length;
    const enemyUnits = state.units.filter(u => u.team !== player.team).length;
    const unitText = `${myUnits}v${enemyUnits}`;
    const unitTextW = ctx.measureText(unitText).width;
    ctx.fillStyle = '#aaa';
    ctx.fillText(unitText, W - pad - unitTextW, y2);

    // WC3-style network status panel
    if (peerDisconnected) {
      this.drawNetPanel(ctx, W, this.canvas.clientHeight, 'PLAYER DISCONNECTED', 'Game continues locally', -1, fontSize);
    } else if (desyncDetected) {
      this.drawNetPanel(ctx, W, this.canvas.clientHeight, 'DESYNC DETECTED', 'Game state mismatch', -1, fontSize);
    } else if (waitingForAllyMs && waitingForAllyMs > 1500) {
      // Only show after 1.5s — normal Firebase round-trips are ~200-500ms
      const timeoutMs = 5000; // matches CommandSync waitForTurn timeout
      const remaining = Math.max(0, Math.ceil((timeoutMs - waitingForAllyMs) / 1000));
      this.drawNetPanel(ctx, W, this.canvas.clientHeight, 'WAITING FOR ALLY', `Dropping in ${remaining}s...`, waitingForAllyMs / timeoutMs, fontSize);
    }

    // Prematch
    if (state.matchPhase === 'prematch') {
      const pmFont = compact ? 22 : 32;
      ctx.fillStyle = '#fff'; ctx.font = `bold ${pmFont}px monospace`; ctx.textAlign = 'center';
      ctx.fillText(`Match starts in ${Math.ceil(state.prematchTimer / 20)}`, W / 2, this.canvas.clientHeight / 2);
      ctx.textAlign = 'start';
    }

    // Win
    if (state.matchPhase === 'ended' && state.winner !== null) {
      const winFont = compact ? 20 : 36;
      const localTeamWin = player.team;
      const won = state.winner === localTeamWin;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(0, this.canvas.clientHeight / 2 - 40, W, 80);
      ctx.fillStyle = won ? '#4caf50' : '#f44336';
      ctx.font = `bold ${winFont}px monospace`; ctx.textAlign = 'center';
      const winText = won
        ? (compact ? 'VICTORY!' : `VICTORY! (${state.winCondition})`)
        : (compact ? 'DEFEAT!' : `DEFEAT! (${state.winCondition})`);
      ctx.fillText(winText, W / 2, this.canvas.clientHeight / 2 + 12);
      ctx.textAlign = 'start';
    }
  }

  /** WC3-style network status drop panel with countdown bar. progress < 0 = no bar. */
  private drawNetPanel(ctx: CanvasRenderingContext2D, W: number, H: number, title: string, subtitle: string, progress: number, fontSize: number): void {
    const panelW = Math.min(320, W * 0.6);
    const panelH = progress >= 0 ? 72 : 56;
    const px = (W - panelW) / 2;
    const py = H * 0.12;

    // Dark semi-transparent background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.beginPath();
    const r = 6;
    ctx.moveTo(px + r, py);
    ctx.lineTo(px + panelW - r, py);
    ctx.quadraticCurveTo(px + panelW, py, px + panelW, py + r);
    ctx.lineTo(px + panelW, py + panelH - r);
    ctx.quadraticCurveTo(px + panelW, py + panelH, px + panelW - r, py + panelH);
    ctx.lineTo(px + r, py + panelH);
    ctx.quadraticCurveTo(px, py + panelH, px, py + panelH - r);
    ctx.lineTo(px, py + r);
    ctx.quadraticCurveTo(px, py, px + r, py);
    ctx.fill();

    // Border
    ctx.strokeStyle = 'rgba(255, 160, 0, 0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Title
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff9800';
    ctx.fillText(title, W / 2, py + 22);

    // Subtitle
    ctx.font = `${fontSize - 2}px monospace`;
    ctx.fillStyle = '#ccc';
    ctx.fillText(subtitle, W / 2, py + 40);

    // Countdown bar
    if (progress >= 0) {
      const barX = px + 16;
      const barW = panelW - 32;
      const barH = 10;
      const barY = py + 52;
      const fill = Math.min(1, progress);

      // Bar background
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.fillRect(barX, barY, barW, barH);

      // Bar fill (green → yellow → red as it fills up)
      const g = Math.round(255 * (1 - fill));
      const rr = Math.round(255 * Math.min(1, fill * 2));
      ctx.fillStyle = `rgb(${rr}, ${g}, 0)`;
      ctx.fillRect(barX, barY, barW * fill, barH);
    }

    ctx.textAlign = 'start';
  }

  private drawQuickChats(ctx: CanvasRenderingContext2D, state: GameState): void {
    if (state.quickChats.length === 0) return;
    const localTeam = state.players[this.localPlayerId]?.team ?? Team.Bottom;
    const visibleChats = state.quickChats.filter(c => c.team === localTeam);
    if (visibleChats.length === 0) return;
    const H = this.canvas.clientHeight;
    const lineH = 18;
    const trayH = 68;
    const safeBottom = getSafeBottom();
    // Position above the bottom build tray, like a WoW chat channel
    const bottomY = H - trayH - safeBottom - 8;
    const startX = 12;

    for (let i = 0; i < visibleChats.length; i++) {
      const c = visibleChats[visibleChats.length - 1 - i];
      const alpha = Math.max(0.2, 1 - c.age / c.maxAge);
      const style = quickChatStyle(c.message);
      const text = `${style.icon} P${c.playerId + 1}: ${c.message}`;
      ctx.font = 'bold 12px monospace';
      const w = ctx.measureText(text).width + 12;
      // Stack upward from bottom (newest at bottom)
      const y = bottomY - (visibleChats.length - 1 - i) * lineH;
      const rgb = hexToRgba(style.color);
      ctx.fillStyle = `${rgb}${0.18 * alpha})`;
      ctx.fillRect(startX, y - 12, w, 15);
      ctx.fillStyle = `${rgb}${0.95 * alpha})`;
      ctx.fillText(text, startX + 6, y);
    }
  }

  // === Minimap ===

  /** If screen coords (sx, sy) are inside the minimap, return world-pixel coords. */
  minimapHitTest(sx: number, sy: number): { worldX: number; worldY: number } | null {
    const compact = this.canvas.clientWidth < 600;
    const aspect = this.mapW / this.mapH;
    let mmW: number, mmH: number;
    if (aspect >= 1) {
      mmW = compact ? 120 : 180;
      mmH = Math.round(mmW / aspect);
    } else {
      mmH = compact ? 120 : 180;
      mmW = Math.round(mmH * aspect);
    }
    const mx = this.canvas.clientWidth - mmW - 10;
    const my = (compact ? 46 : 60) + getSafeTop();
    if (sx < mx || sx > mx + mmW || sy < my || sy > my + mmH) return null;
    const tileX = ((sx - mx) / mmW) * this.mapW;
    const tileY = ((sy - my) / mmH) * this.mapH;
    return { worldX: tileX * TILE_SIZE, worldY: tileY * TILE_SIZE };
  }

  private drawMinimap(ctx: CanvasRenderingContext2D, state: GameState): void {
    const compact = this.canvas.clientWidth < 600;
    const mW = this.mapW;
    const mH = this.mapH;
    // Minimap aspect ratio matches the actual map
    const aspect = mW / mH;
    let mmW: number, mmH: number;
    if (aspect >= 1) {
      // Landscape map: wider minimap
      mmW = compact ? 120 : 180;
      mmH = Math.round(mmW / aspect);
    } else {
      // Portrait map: taller minimap
      mmH = compact ? 120 : 180;
      mmW = Math.round(mmH * aspect);
    }
    const mx = this.canvas.clientWidth - mmW - 10;
    const my = (compact ? 46 : 60) + getSafeTop(); // top-right, just below HUD bar
    const scaleX = mmW / mW;
    const scaleY = mmH / mH;

    // Background — water color
    ctx.fillStyle = 'rgba(60, 110, 100, 0.9)';
    ctx.fillRect(mx - 2, my - 2, mmW + 4, mmH + 4);

    // Map shape — grass fill (trace the map outline)
    ctx.strokeStyle = '#2a5a2a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (state.mapDef.shapeAxis === 'y') {
      // Portrait: trace along y-axis, margins on x
      for (let y = 0; y <= mH; y += 4) {
        const range = state.mapDef.getPlayableRange(y);
        if (y === 0) ctx.moveTo(mx + range.min * scaleX, my + y * scaleY);
        else ctx.lineTo(mx + range.min * scaleX, my + y * scaleY);
      }
      for (let y = mH; y >= 0; y -= 4) {
        const range = state.mapDef.getPlayableRange(y);
        ctx.lineTo(mx + range.max * scaleX, my + y * scaleY);
      }
    } else {
      // Landscape: trace along x-axis, margins on y
      for (let x = 0; x <= mW; x += 4) {
        const range = state.mapDef.getPlayableRange(x);
        if (x === 0) ctx.moveTo(mx + x * scaleX, my + range.min * scaleY);
        else ctx.lineTo(mx + x * scaleX, my + range.min * scaleY);
      }
      for (let x = mW; x >= 0; x -= 4) {
        const range = state.mapDef.getPlayableRange(x);
        ctx.lineTo(mx + x * scaleX, my + range.max * scaleY);
      }
    }
    ctx.closePath();
    ctx.fillStyle = '#3a6b3a';
    ctx.fill();
    ctx.stroke();

    // Diamond cells (gold blob)
    const dc = state.mapDef.diamondCenter;
    const goldRemaining = state.diamondCells.some(c => c.gold > 0);
    if (goldRemaining) {
      ctx.fillStyle = 'rgba(200, 170, 20, 0.6)';
      const cx = mx + dc.x * scaleX;
      const cy = my + dc.y * scaleY;
      const dHW = state.mapDef.diamondHalfW;
      const dHH = state.mapDef.diamondHalfH;
      const rw = dHW * scaleX;
      const rh = dHH * scaleY;
      ctx.beginPath();
      ctx.moveTo(cx, cy - rh);
      ctx.lineTo(cx + rw, cy);
      ctx.lineTo(cx, cy + rh);
      ctx.lineTo(cx - rw, cy);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 220, 120, 0.85)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Fog of war state for minimap filtering
    const fog = state.fogOfWar;
    const localTeam = state.players[this.localPlayerId]?.team ?? Team.Bottom;

    // Combat glow zones on minimap — pulse where fighting is happening (fog-filtered)
    const combatClusters: { x: number; y: number; count: number }[] = [];
    for (const u of state.units) {
      if (u.targetId === null) continue;
      if (fog && u.team !== localTeam && !this.isTileVisible(state, u.x, u.y)) continue;
      let added = false;
      for (const c of combatClusters) {
        if (Math.abs(c.x - u.x) < 8 && Math.abs(c.y - u.y) < 8) {
          c.x = (c.x * c.count + u.x) / (c.count + 1);
          c.y = (c.y * c.count + u.y) / (c.count + 1);
          c.count++;
          added = true;
          break;
        }
      }
      if (!added) combatClusters.push({ x: u.x, y: u.y, count: 1 });
    }
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 200);
    for (const c of combatClusters) {
      if (c.count < 2) continue;
      const intensity = Math.min(1, c.count / 8);
      const r = 3 + intensity * 4;
      ctx.beginPath();
      ctx.arc(mx + c.x * scaleX, my + c.y * scaleY, r * (0.8 + pulse * 0.4), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 100, 50, ${intensity * 0.3 * (0.6 + pulse * 0.4)})`;
      ctx.fill();
    }

    // Fog of war: draw fog overlay on minimap
    if (fog) {
      const vis = state.visibility[localTeam];
      if (vis) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        // Draw fogged regions in coarse blocks for performance
        const step = 4;
        for (let ty = 0; ty < mH; ty += step) {
          for (let tx = 0; tx < mW; tx += step) {
            if (!vis[ty * mW + tx]) {
              ctx.fillRect(mx + tx * scaleX, my + ty * scaleY, step * scaleX + 1, step * scaleY + 1);
            }
          }
        }
      }
    }

    // Units as dots (player colored) — fog-filtered
    for (const u of state.units) {
      if (fog && u.team !== localTeam && !this.isTileVisible(state, u.x, u.y)) continue;
      ctx.fillStyle = PLAYER_COLORS[u.playerId] || '#888';
      ctx.fillRect(mx + u.x * scaleX - 1, my + u.y * scaleY - 1, 2, 2);
    }

    // Team-visible ping markers
    for (const p of state.pings) {
      if (p.team !== localTeam) continue;
      const pp = p.age / p.maxAge;
      const pr = 2 + 4 * pp;
      const px = mx + p.x * scaleX;
      const py = my + p.y * scaleY;
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,235,59,${0.9 - 0.7 * pp})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Harvesters as smaller dots — fog-filtered
    for (const h of state.harvesters) {
      if (h.state === 'dead') continue;
      if (fog && state.players[h.playerId]?.team !== localTeam && !this.isTileVisible(state, h.x, h.y)) continue;
      ctx.fillStyle = PLAYER_COLORS[h.playerId] || '#888';
      ctx.globalAlpha = 0.7;
      ctx.fillRect(mx + h.x * scaleX, my + h.y * scaleY, 1, 1);
      ctx.globalAlpha = 1;
    }

    // Buildings as slightly larger dots — fog-filtered
    for (const b of state.buildings) {
      if (fog && state.players[b.playerId]?.team !== localTeam && !this.isTileVisible(state, b.worldX, b.worldY)) continue;
      ctx.fillStyle = PLAYER_COLORS[b.playerId] || '#888';
      ctx.fillRect(mx + b.worldX * scaleX - 1, my + b.worldY * scaleY - 1, 3, 2);
    }

    // HQs
    for (const team of [Team.Bottom, Team.Top]) {
      const hq = getHQPosition(team, state.mapDef);
      ctx.fillStyle = team === Team.Bottom ? '#2979ff' : '#ff1744';
      ctx.fillRect(mx + hq.x * scaleX, my + hq.y * scaleY, HQ_WIDTH * scaleX, HQ_HEIGHT * scaleY);
    }

    // Recent quick-chat badges near team HQ
    const recentChats = state.quickChats.filter(c => c.team === localTeam && c.age < 20);
    for (const c of recentChats) {
      const hq = getHQPosition(c.team, state.mapDef);
      // Offset each chat badge slightly so multiple players' badges don't overlap
      const chatOffset = (c.playerId % 3 - 1) * 4; // -4, 0, +4
      const bx = mx + (hq.x + HQ_WIDTH / 2 + chatOffset) * scaleX;
      const by = my + (hq.y + HQ_HEIGHT / 2) * scaleY;
      const style = quickChatStyle(c.message);
      ctx.fillStyle = style.color;
      ctx.beginPath();
      ctx.arc(bx, by, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Camera viewport box
    const vx = this.camera.x, vy = this.camera.y;
    const vw = this.canvas.clientWidth / this.camera.zoom;
    const vh = this.canvas.clientHeight / this.camera.zoom;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      mx + (vx / T) * scaleX,
      my + (vy / T) * scaleY,
      (vw / T) * scaleX,
      (vh / T) * scaleY
    );

    // Minimap label intentionally omitted for a cleaner HUD.
  }
}




