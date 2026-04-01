/**
 * Main canvas renderer — orchestrates all visual output each frame.
 *
 * Owns the canvas, camera, sprite/UI asset references, and all per-frame
 * visual state (day/night, weather, fog of war, screen shake, etc.).
 * The render() method drives the frame pipeline:
 *   1. Terrain + static layers (via RendererTerrain)
 *   2. Y-sorted entities: units, buildings, projectiles, HQ (via RendererEntities)
 *   3. Effects, floating text, ability visuals (via RendererOverlays)
 *   4. HUD, minimap, fog of war (via RendererOverlays)
 *
 * Sub-modules:
 *   RendererTerrain  — terrain cache building, water animation, resource nodes
 *   RendererEntities — drawOneUnit/Building/Projectile/Harvester, dead units
 *   RendererOverlays — HUD, minimap, fog, floating text, ability/nuke effects
 *   RendererShapes   — drawUnitShape (pure geometry), type definitions
 */
import { Camera } from './Camera';
import { SpriteLoader, drawSpriteFrame, drawGridFrame, getSpriteFrame, type SpriteDef } from './SpriteLoader';
import { UIAssets } from './UIAssets';
import {
  GameState, Team, MAP_WIDTH, MAP_HEIGHT, TILE_SIZE, TICK_RATE,
  HQ_WIDTH, HQ_HEIGHT, HQ_HP,
  BuildingType, Vec2,
  Race,
  type MapDef,
  type BuildingState, type UnitState, type HarvesterState, type ProjectileState,
} from '../simulation/types';
import { DUEL_MAP } from '../simulation/maps';
import { getHQPosition, getBuildGridOrigin, getHutGridOrigin, getTeamAlleyOrigin, getBaseGoldPosition } from '../simulation/GameState';
import { RACE_COLORS, PLAYER_COLORS } from '../simulation/data';
import {
  getDayNight, DayNightState,
  ScreenShake, WeatherSystem, AmbientParticles,
  ProjectileTrails, ConstructionAnims, HitFlashTracker, CombatVFX, triggerHaptic,
} from './VisualEffects';
import { getSafeTop } from '../ui/SafeArea';
import { getVisualSettings } from './VisualSettings';
import { tileToPixel, isoWorldBounds, ISO_TILE_W, ISO_TILE_H } from './Projection';
// Extracted modules
import { hexToRgba, type DeadUnitSnapshot, type UnitRenderSnapshot, type UnitCategory, drawUnitShape as _drawUnitShapeStandalone } from './RendererShapes';
import * as Entities from './RendererEntities';
import type { EntityDrawContext } from './RendererEntities';
import * as Overlays from './RendererOverlays';
import * as Terrain from './RendererTerrain';

const T = TILE_SIZE;
const LANE_LEFT_COLOR = '#4fc3f7';
const LANE_RIGHT_COLOR = '#ff8a65';

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
  /** Isometric rendering mode */
  isometric = false;
  /** Cached pixel coords from drawYSorted — avoids redundant tp() in drawOne* functions.
   *  Only valid during the dispatch loop; drawOne* can use these instead of calling tp(). */
  private _cachedPx = 0;
  private _cachedPy = 0;
  private isoTerrainCache: HTMLCanvasElement | null = null;
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
  // Per-game-tick position snapshot for walk/idle detection (compare across ticks, not render frames)
  private prevTickUnitPos = new Map<number, { x: number; y: number }>();
  private movedThisTick = new Set<number>();
  private prevTickSeen = -1;
  private lastUnitRenders = new Map<number, UnitRenderSnapshot>();
  private lastBuildingIds = new Set<number>();
  private lastBuildingPositions = new Map<number, { x: number; y: number; hpPct: number }>();
  // Cached per-team enemy alley buildings for unit facing (rebuilt once per frame in drawYSorted)
  private _enemyAlleyBuildings: { team: Team; x: number; y: number }[] = [];
  // Cached frightened state per harvester (recomputed every 10 game ticks)
  private _harvesterFrightened = new Map<number, boolean>();
  private _ectx!: EntityDrawContext;
  // Pooled sets to avoid per-frame allocations
  private _pooledUnitIds = new Set<number>();
  private _pooledBuildingIds = new Set<number>();
  private _pooledBuildingIds2 = new Set<number>();
  private _pooledCombatZones: { x: number; y: number }[] = [];

  // Visual effects systems
  private dayNight: DayNightState = getDayNight(0);
  screenShake = new ScreenShake();
  weather = new WeatherSystem();
  private ambientParticles = new AmbientParticles();
  private projectileTrails = new ProjectileTrails();
  private constructionAnims = new ConstructionAnims();
  private hitFlash = new HitFlashTracker();
  private combatVfx = new CombatVFX();
  private lastConsumedTick = -1;
  private unitHpTracker = new Map<number, number>();
  // Reusable harvester-by-hutId map — rebuilt once per render frame, avoids O(n) find() per hut draw
  private _renderHarvByHut = new Map<number, HarvesterState>();
  // Reusable unit-by-ID map — rebuilt once per render frame, avoids O(n) find() per projectile/unit draw
  private _renderUnitById = new Map<number, UnitState>();
  private matchStartTime = Date.now();
  private lastFrameTime = Date.now();
  // Cached Date.now() for current render frame — avoids ~14 syscalls per frame
  private frameNow = Date.now();
  // Track known building IDs for construction anim detection
  private knownBuildingIds = new Set<number>();
  // Smooth HP bars: unitId -> displayed HP fraction
  private smoothHp = new Map<number, number>();
  // Track previous nuke effect count to detect new nukes
  private lastNukeCount = 0;
  // Track previous HQ HP values to detect destruction
  private lastHqHp: number[] = [-1, -1];
  // Smooth deluge vignette alpha (0 = hidden, 1 = fully visible)
  private delugeVignetteAlpha = 0;
  private _delugeGrad: CanvasGradient | null = null;
  private _delugeGradW = 0;
  private _delugeGradH = 0;
  // Cached shadow style strings — rebuilt when dayNight changes
  private _shadowStyle = 'rgba(0,0,0,0.2)';
  private _harvShadowStyle = 'rgba(0,0,0,0.18)';
  // Minimap offscreen cache — entity content redrawn only on tick change
  private minimapCache: HTMLCanvasElement | null = null;
  private minimapCacheTick = -1;
  private minimapCacheW = 0;
  private minimapCacheH = 0;
  // Map dimensions & definition — set from state.mapDef on first render, used throughout rendering
  private mapW = MAP_WIDTH;
  private mapH = MAP_HEIGHT;
  private mapDef: MapDef = DUEL_MAP;
  // Fog of war
  private fogCache: HTMLCanvasElement | null = null;
  private fogImageData: ImageData | null = null;
  /** Per-tile linger timer (seconds remaining of visibility after losing actual vision) */
  private fogLinger: Float32Array | null = null;
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
    this.isoTerrainCache = null;
    this.terrainCache = null;
    this.waterCache = null;
  }

  /** Convert tile coordinates to world-pixel coordinates (isometric-aware) */
  tp(tileX: number, tileY: number): { px: number; py: number } {
    return tileToPixel(tileX, tileY, this.isometric);
  }

  /** Draw a filled isometric diamond tile centered at (cx, cy). */
  private drawIsoDiamond(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    ctx.beginPath();
    ctx.moveTo(cx, cy - ISO_TILE_H / 2);
    ctx.lineTo(cx + ISO_TILE_W / 2, cy);
    ctx.lineTo(cx, cy + ISO_TILE_H / 2);
    ctx.lineTo(cx - ISO_TILE_W / 2, cy);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * Draw an isometric parallelogram region (fill or stroke) for a tile-aligned grid area.
   * Connects the 4 projected corners of a rectangle from (ox,oy) to (ox+cols, oy+rows).
   */
  private drawIsoQuad(ctx: CanvasRenderingContext2D, ox: number, oy: number, cols: number, rows: number, mode: 'fill' | 'stroke'): void {
    const { px: x0, py: y0 } = this.tp(ox, oy);
    const { px: x1, py: y1 } = this.tp(ox + cols, oy);
    const { px: x2, py: y2 } = this.tp(ox + cols, oy + rows);
    const { px: x3, py: y3 } = this.tp(ox, oy + rows);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.closePath();
    if (mode === 'fill') ctx.fill(); else ctx.stroke();
  }


  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
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
    const result = Overlays.drawFogOfWar(
      ctx, state, dt, this.localPlayerId, this.isometric, this.camera, this.canvas,
      this.fogLinger, this.fogCache, this.fogImageData,
      (c, cx, cy) => this.drawIsoDiamond(c, cx, cy),
    );
    this.fogLinger = result.fogLinger;
    this.fogCache = result.fogCache;
    this.fogImageData = result.fogImageData;
  }

  render(state: GameState, networkLatencyMs?: number, desyncDetected?: boolean, peerDisconnected?: boolean, waitingForAllyMs?: number): void {
    // Update map dimensions from state (supports different map sizes)
    this.mapDef = state.mapDef;
    this.mapW = state.mapDef.width;
    this.mapH = state.mapDef.height;
    this.weather.mapW = this.mapW;
    this.weather.mapH = this.mapH;
    this.weather.biome = state.mapDef.biome ?? 'temperate';

    const now = Date.now();
    this.frameNow = now;
    const dt = Math.min((now - this.lastFrameTime) / 1000, 0.1);
    this.lastFrameTime = now;
    const elapsedSec = (now - this.matchStartTime) / 1000;

    // Build unit-by-ID map once per frame (used by drawOneProjectile, drawOneUnit, drawTowerAttackLines)
    this._renderUnitById.clear();
    for (const u of state.units) this._renderUnitById.set(u.id, u);
    // Build harvester-by-hutId map once per frame (used by drawOneBuilding for hut icons)
    this._renderHarvByHut.clear();
    for (const h of state.harvesters) this._renderHarvByHut.set(h.hutId, h);

    // Build EntityDrawContext for this frame (shared by all entity draw calls)
    this._ectx = {
      sprites: this.sprites,
      ui: this.ui,
      isometric: this.isometric,
      frameNow: this.frameNow,
      cachedPx: 0,
      cachedPy: 0,
      shadowStyle: this._shadowStyle,
      harvShadowStyle: this._harvShadowStyle,
      dayNightBrightness: this.dayNight.brightness,
      movedThisTick: this.movedThisTick,
      smoothHp: this.smoothHp,
      constructionAnims: this.constructionAnims,
      hitFlash: this.hitFlash,
      facing: this.facing,
      prevX: this.prevX,
      deadUnits: this.deadUnits,
      deathEffects: this.deathEffects,
      renderUnitById: this._renderUnitById,
      renderHarvByHut: this._renderHarvByHut,
      enemyAlleyBuildings: this._enemyAlleyBuildings,
      harvesterFrightened: this._harvesterFrightened,
    };

    // Detect deaths: compare current IDs to last frame
    this.detectDeaths(state);
    // Detect new buildings for construction animation
    this.detectNewBuildings(state);
    // Track HP changes for hit flash
    this.hitFlash.updateFromState(this.unitHpTracker, state.units);

    // Update visual effects (respect user preferences)
    const vfxPrefs = getVisualSettings();
    // Cache day/night — only recompute when phase changes meaningfully (~4x/sec instead of 60)
    const dnInput = vfxPrefs.dayNight ? elapsedSec : 0.25 * 240;
    const newPhase = (dnInput % 240) / 240;
    if (!this.dayNight || Math.abs(newPhase - this.dayNight.phase) > 0.004) {
      this.dayNight = getDayNight(dnInput);
      this._shadowStyle = `rgba(0,0,0,${this.dayNight.brightness * 0.2})`;
      this._harvShadowStyle = `rgba(0,0,0,${this.dayNight.brightness * 0.18})`;
    }
    if (vfxPrefs.screenShake) this.screenShake.update(dt); else { this.screenShake.offsetX = 0; this.screenShake.offsetY = 0; }
    if (vfxPrefs.weather) {
      this.weather.setViewport(
        this.camera.x, this.camera.y,
        this.canvas.clientWidth / this.camera.zoom,
        this.canvas.clientHeight / this.camera.zoom,
      );
      this.weather.update(dt, elapsedSec, this.dayNight.phase, this.dayNight.brightness);
    }
    // Force heavy rain during Deep deluge ability
    const hasDeluge = state.abilityEffects.some(e => e.type === 'deep_rain');
    if (hasDeluge && this.weather.type !== 'storm') {
      this.weather.type = 'storm';
    }
    // Screen shake for fireball impact
    const hasFireball = state.abilityEffects.some(e => e.type === 'demon_fireball' && e.duration > 0.6 * TICK_RATE);
    if (hasFireball && vfxPrefs.screenShake) {
      this.screenShake.trigger(6, 0.4);
    }
    this.projectileTrails.update(dt);
    this.updateDeadUnits(dt);
    if (state.tick !== this.lastConsumedTick) {
      this.combatVfx.consume(state.combatEvents, this.isometric ? (x, y) => this.tp(x, y) : undefined);
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
    this.lastHqHp[0] = state.hqHp[0];
    this.lastHqHp[1] = state.hqHp[1];

    // Gather combat zones for ambient particles
    const combatZones = this._pooledCombatZones;
    combatZones.length = 0;
    for (const u of state.units) {
      if (u.targetId !== null) combatZones.push({ x: u.x, y: u.y });
    }
    this.ambientParticles.update(dt, combatZones, this.isometric ? (x, y) => this.tp(x, y) : undefined);

    // Spawn race-themed ambient particles near visible units only
    {
      const pMargin = T * 2;
      const pVpX0 = this.camera.x - pMargin;
      const pVpY0 = this.camera.y - pMargin;
      const pVpX1 = this.camera.x + this.canvas.clientWidth / this.camera.zoom + pMargin;
      const pVpY1 = this.camera.y + this.canvas.clientHeight / this.camera.zoom + pMargin;
      const iso = this.isometric;
      const isoHW = ISO_TILE_W / 2;
      const isoHH = ISO_TILE_H / 2;
      for (const u of state.units) {
        const race = state.players[u.playerId]?.race;
        if (!race) continue;
        // Inline iso projection to avoid tp() call per unit
        let rpx: number, rpy: number;
        if (iso) {
          rpx = (u.x - u.y) * isoHW;
          rpy = (u.x + u.y) * isoHH;
        } else {
          rpx = u.x * T;
          rpy = u.y * T;
        }
        // Skip off-screen units
        if (rpx < pVpX0 || rpx > pVpX1 || rpy < pVpY0 || rpy > pVpY1) continue;
        if (iso) {
          this.ambientParticles.spawnRaceParticlePx(rpx, rpy, race);
        } else {
          this.ambientParticles.spawnRaceParticle(u.x, u.y, race);
        }
      }
    }

    // Record projectile trail points (every 3rd frame to limit volume)
    if (state.tick % 3 === 0) {
      for (const p of state.projectiles) {
        const race = state.players[p.sourcePlayerId]?.race;
        const color = race ? (RACE_COLORS[race]?.primary ?? '#fff') : '#fff';
        const { px: tpx, py: tpy } = this.tp(p.x + 0.5, p.y + 0.5);
        this.projectileTrails.addPointPx(tpx, tpy, color);
      }
    }

    // Snapshot unit positions once per tick — compute which units moved
    // before overwriting, so ALL renders within the same tick see consistent results.
    if (state.tick !== this.prevTickSeen) {
      this.movedThisTick.clear();
      for (const u of state.units) {
        const prev = this.prevTickUnitPos.get(u.id);
        if (prev) {
          if (Math.abs(u.x - prev.x) >= 0.04 || Math.abs(u.y - prev.y) >= 0.04) {
            this.movedThisTick.add(u.id);
          }
          prev.x = u.x; prev.y = u.y;
        } else {
          this.prevTickUnitPos.set(u.id, { x: u.x, y: u.y });
        }
      }
      this.prevTickSeen = state.tick;
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

    // Weather far/mid particles (layers 0-1) — behind units for depth
    if (vfxPrefs.weather) this.weather.drawWorldBehind(ctx);

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

    // Weather near particles (layer 2) — in front of units for depth
    if (vfxPrefs.weather) this.weather.drawWorldFront(ctx);

    // Fog of war overlay (world-space, after entities, before day/night)
    if (state.fogOfWar) {
      this.drawFogOfWar(ctx, state, dt);
    }

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

    // Deep deluge blue vignette (screen-space)
    {
      const target = hasDeluge ? 1 : 0;
      const fadeSpeed = hasDeluge ? 3 : 2; // fade in faster than fade out
      this.delugeVignetteAlpha += (target - this.delugeVignetteAlpha) * Math.min(1, fadeSpeed * dt);
      if (this.delugeVignetteAlpha > 0.005) {
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        // Cache gradient — only rebuild on canvas resize
        if (!this._delugeGrad || this._delugeGradW !== w || this._delugeGradH !== h) {
          const cx = w / 2, cy = h / 2, r = Math.max(w, h) * 0.7;
          const grad = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r);
          grad.addColorStop(0, 'rgba(30, 80, 160, 0)');
          grad.addColorStop(0.6, 'rgba(20, 60, 140, 0.12)');
          grad.addColorStop(1, 'rgba(10, 30, 80, 0.35)');
          this._delugeGrad = grad;
          this._delugeGradW = w;
          this._delugeGradH = h;
        }
        ctx.globalAlpha = this.delugeVignetteAlpha;
        ctx.fillStyle = this._delugeGrad;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
      }
    }

    this.drawHUD(ctx, state, networkLatencyMs, desyncDetected, peerDisconnected, waitingForAllyMs);
    this.drawQuickChats(ctx, state);
    this.drawMinimap(ctx, state);
  }

  // === Terrain (Pre-rendered) ===

  private doBuildTerrainCache(): void {
    const result = Terrain.buildTerrainCache(this.sprites, this.mapDef, this.mapW, this.mapH);
    if (!result) return;
    this.terrainCache = result.terrainCanvas;
    this.waterCache = result.waterCanvas;
    this.waterEdges = result.waterEdges;
    this.terrainReady = true;
  }

  private drawWaterAnimation(ctx: CanvasRenderingContext2D, tick: number): void {
    Terrain.drawWaterAnimation(ctx, tick, this.camera, this.sprites, this.mapDef, this.mapW, this.mapH, this.waterEdges);
  }

  private drawZones(ctx: CanvasRenderingContext2D, tick: number): void {
    if (this.isometric) {
      // Isometric mode: build terrain cache on first frame, then blit
      if (!this.isoTerrainCache) {
        const bounds = isoWorldBounds(this.mapW, this.mapH);
        const pad = T;
        const cw = Math.ceil(bounds.width + pad * 2);
        const ch = Math.ceil(bounds.height + pad * 2);
        const offscreen = document.createElement('canvas');
        offscreen.width = cw;
        offscreen.height = ch;
        const oc = offscreen.getContext('2d')!;
        // Offset so bounds.minX maps to pad
        oc.translate(-bounds.minX + pad, -bounds.minY + pad);
        // Water background
        oc.fillStyle = '#5b9a8b';
        oc.fillRect(bounds.minX - pad, bounds.minY - pad, cw, ch);
        // Playable tiles as green diamonds (slightly oversized to eliminate seam gaps)
        oc.fillStyle = '#3a6b3a';
        const seamPad = 0.5; // extra half-pixel per edge to cover anti-aliasing seams
        for (let ty = 0; ty < this.mapH; ty++) {
          for (let tx = 0; tx < this.mapW; tx++) {
            if (!this.mapDef.isPlayable(tx, ty)) continue;
            const { px: cx, py: cy } = this.tp(tx + 0.5, ty + 0.5);
            oc.beginPath();
            oc.moveTo(cx, cy - ISO_TILE_H / 2 - seamPad);
            oc.lineTo(cx + ISO_TILE_W / 2 + seamPad, cy);
            oc.lineTo(cx, cy + ISO_TILE_H / 2 + seamPad);
            oc.lineTo(cx - ISO_TILE_W / 2 - seamPad, cy);
            oc.closePath();
            oc.fill();
          }
        }
        this.isoTerrainCache = offscreen;
      }
      const bounds = isoWorldBounds(this.mapW, this.mapH);
      ctx.drawImage(this.isoTerrainCache, bounds.minX - T, bounds.minY - T);
      return;
    }

    // Try to build terrain cache if not ready
    if (!this.terrainReady) {
      this.doBuildTerrainCache();
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
    // Helper that extracts values immediately (tp returns a shared object)
    const tpx = (x: number, y: number) => { const r = this.tp(x, y); return [r.px, r.py]; };
    const drawCurvedPath = (points: readonly Vec2[], ctx: CanvasRenderingContext2D) => {
      const [sx, sy] = tpx(points[0].x, points[0].y);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      for (let i = 1; i < points.length; i++) {
        const [piX, piY] = tpx(points[i].x, points[i].y);
        if (i < points.length - 1) {
          const [midX, midY] = tpx((points[i].x + points[i + 1].x) / 2, (points[i].y + points[i + 1].y) / 2);
          ctx.quadraticCurveTo(piX, piY, midX, midY);
        } else {
          ctx.lineTo(piX, piY);
        }
      }
    };
    const drawPath = (points: readonly Vec2[], color: string) => {
      drawCurvedPath(points, ctx);
      ctx.strokeStyle = color;
      ctx.lineWidth = 5;
      ctx.globalAlpha = 0.45;
      ctx.stroke();

      ctx.setLineDash([8, 12]);
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.6;
      drawCurvedPath(points, ctx);
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
      const [llPx, llPy] = tpx(dc.x - 20, dc.y);
      const [lrPx, lrPy] = tpx(dc.x + 20, dc.y);
      ctx.fillStyle = LANE_LEFT_COLOR;
      ctx.fillText('L', llPx, llPy);
      ctx.fillStyle = LANE_RIGHT_COLOR;
      ctx.fillText('R', lrPx, lrPy);
    } else {
      // Landscape: L on top, R on bottom
      const [ltPx, ltPy] = tpx(dc.x, dc.y - 14);
      const [lbPx, lbPy] = tpx(dc.x, dc.y + 14);
      ctx.fillStyle = LANE_LEFT_COLOR;
      ctx.fillText('L', ltPx, ltPy);
      ctx.fillStyle = LANE_RIGHT_COLOR;
      ctx.fillText('R', lbPx, lbPy);
    }
    ctx.textAlign = 'start';
    ctx.globalAlpha = 1;
  }

  // === Diamond Gold Cells ===

  private drawDiamondCells(ctx: CanvasRenderingContext2D, state: GameState): void {
    const goldStoneData = this.sprites.getResourceSprite('goldStone');

    for (const cell of state.diamondCells) {
      const { px, py } = this.tp(cell.tileX, cell.tileY);

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

    const { px: dcx, py: dcy } = this.tp(state.mapDef.diamondCenter.x, state.mapDef.diamondCenter.y);
    if (!state.diamond.exposed) {
      ctx.fillStyle = 'rgba(40, 35, 10, 0.8)';
      ctx.fillRect(dcx, dcy, T, T);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;
      ctx.strokeRect(dcx, dcy, T, T);
    }
  }

  // === Resource Nodes ===

  private drawResourceNodes(ctx: CanvasRenderingContext2D, state: GameState): void {
    Terrain.drawResourceNodes(ctx, state, this.sprites, this.isometric, this.frameNow);
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

      const bgCols = state.mapDef.buildGridCols;
      const bgRows = state.mapDef.buildGridRows;
      const { px: ogPx } = this.tp(origin.x, origin.y);

      // Background fill
      ctx.fillStyle = tc + '0.18)';
      if (this.isometric) {
        this.drawIsoQuad(ctx, origin.x, origin.y, bgCols, bgRows, 'fill');
      } else {
        const { px: ogPx, py: ogPy } = this.tp(origin.x, origin.y);
        const { px: ogPx2, py: ogPy2 } = this.tp(origin.x + bgCols, origin.y + bgRows);
        ctx.fillRect(ogPx, ogPy, ogPx2 - ogPx, ogPy2 - ogPy);
      }

      // Grid lines
      ctx.strokeStyle = tc + '0.35)';
      ctx.lineWidth = 0.5;
      for (let gx = 0; gx <= bgCols; gx++) {
        const { px: lx1, py: ly1 } = this.tp(origin.x + gx, origin.y);
        const { px: lx2, py: ly2 } = this.tp(origin.x + gx, origin.y + bgRows);
        ctx.beginPath(); ctx.moveTo(lx1, ly1); ctx.lineTo(lx2, ly2); ctx.stroke();
      }
      for (let gy = 0; gy <= bgRows; gy++) {
        const { px: lx1, py: ly1 } = this.tp(origin.x, origin.y + gy);
        const { px: lx2, py: ly2 } = this.tp(origin.x + bgCols, origin.y + gy);
        ctx.beginPath(); ctx.moveTo(lx1, ly1); ctx.lineTo(lx2, ly2); ctx.stroke();
      }

      // Border
      ctx.strokeStyle = tc + '0.6)';
      ctx.lineWidth = 2;
      if (this.isometric) {
        this.drawIsoQuad(ctx, origin.x, origin.y, bgCols, bgRows, 'stroke');
      } else {
        const { px: ogPx, py: ogPy } = this.tp(origin.x, origin.y);
        const { px: ogPx2, py: ogPy2 } = this.tp(origin.x + bgCols, origin.y + bgRows);
        ctx.strokeRect(ogPx, ogPy, ogPx2 - ogPx, ogPy2 - ogPy);
      }

      ctx.fillStyle = tc + '0.85)';
      ctx.font = 'bold 11px monospace';
      // Label position: below for bottom/left team, above for top/right team
      const teamIdx = state.mapDef.playerSlots[p]?.teamIndex ?? (p < 2 ? 0 : 1);
      const labelBelow = teamIdx === 0;
      const { py: lyVal } = labelBelow ? this.tp(origin.x, origin.y + bgRows + 1.2) : this.tp(origin.x, origin.y - 0.5);
      ctx.fillText(`P${p + 1} [${player.race}]`, ogPx, lyVal);
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
      const { px: hOgPx } = this.tp(origin.x, origin.y);
      ctx.fillStyle = tc + '0.15)';
      if (this.isometric) {
        this.drawIsoQuad(ctx, origin.x, origin.y, hCols, hRows, 'fill');
      } else {
        const { py: hOgPy } = this.tp(origin.x, origin.y);
        const { px: hOgPx2, py: hOgPy2 } = this.tp(origin.x + hCols, origin.y + hRows);
        ctx.fillRect(hOgPx, hOgPy, hOgPx2 - hOgPx, hOgPy2 - hOgPy);
      }
      ctx.strokeStyle = tc + '0.4)';
      ctx.lineWidth = 1;
      for (let gx = 0; gx <= hCols; gx++) {
        const { px: lx1, py: ly1 } = this.tp(origin.x + gx, origin.y);
        const { px: lx2, py: ly2 } = this.tp(origin.x + gx, origin.y + hRows);
        ctx.beginPath();
        ctx.moveTo(lx1, ly1);
        ctx.lineTo(lx2, ly2);
        ctx.stroke();
      }
      for (let gy = 0; gy <= hRows; gy++) {
        const { px: lx1, py: ly1 } = this.tp(origin.x, origin.y + gy);
        const { px: lx2, py: ly2 } = this.tp(origin.x + hCols, origin.y + gy);
        ctx.beginPath();
        ctx.moveTo(lx1, ly1);
        ctx.lineTo(lx2, ly2);
        ctx.stroke();
      }
      ctx.strokeStyle = tc + '0.6)';
      ctx.lineWidth = 2;
      if (this.isometric) {
        this.drawIsoQuad(ctx, origin.x, origin.y, hCols, hRows, 'stroke');
      } else {
        const { py: hOgPy } = this.tp(origin.x, origin.y);
        const { px: hOgPx2, py: hOgPy2 } = this.tp(origin.x + hCols, origin.y + hRows);
        ctx.strokeRect(hOgPx, hOgPy, hOgPx2 - hOgPx, hOgPy2 - hOgPy);
      }

      ctx.fillStyle = tc + '0.8)';
      ctx.font = 'bold 11px monospace';
      const teamIdx = state.mapDef.playerSlots[p]?.teamIndex ?? (p < 2 ? 0 : 1);
      const labelBelow = teamIdx === 0;
      const { py: hLy } = labelBelow ? this.tp(origin.x, origin.y + hRows + 0.8) : this.tp(origin.x, origin.y - 0.4);
      ctx.fillText(`P${p + 1} HUTS`, hOgPx, hLy);
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
      const { px: aOgPx } = this.tp(origin.x, origin.y);
      ctx.fillStyle = `rgba(${color},0.15)`;
      if (this.isometric) {
        this.drawIsoQuad(ctx, origin.x, origin.y, aCols, aRows, 'fill');
      } else {
        const { py: aOgPy } = this.tp(origin.x, origin.y);
        const { px: aOgPx2, py: aOgPy2 } = this.tp(origin.x + aCols, origin.y + aRows);
        ctx.fillRect(aOgPx, aOgPy, aOgPx2 - aOgPx, aOgPy2 - aOgPy);
      }

      ctx.strokeStyle = `rgba(${color},0.35)`;
      ctx.lineWidth = 0.5;
      for (let gx = 0; gx <= aCols; gx++) {
        const { px: lx1, py: ly1 } = this.tp(origin.x + gx, origin.y);
        const { px: lx2, py: ly2 } = this.tp(origin.x + gx, origin.y + aRows);
        ctx.beginPath();
        ctx.moveTo(lx1, ly1);
        ctx.lineTo(lx2, ly2);
        ctx.stroke();
      }
      for (let gy = 0; gy <= aRows; gy++) {
        const { px: lx1, py: ly1 } = this.tp(origin.x, origin.y + gy);
        const { px: lx2, py: ly2 } = this.tp(origin.x + aCols, origin.y + gy);
        ctx.beginPath();
        ctx.moveTo(lx1, ly1);
        ctx.lineTo(lx2, ly2);
        ctx.stroke();
      }

      // Gold mine exclusion zone (landscape maps only)
      if (state.mapDef.shapeAxis === 'x') {
        const goldPos = getBaseGoldPosition(team, state.mapDef);
        const mineGX = Math.round(goldPos.x - origin.x);
        const mineGY = Math.round(goldPos.y - origin.y);
        const R = 3; // must match GOLD_MINE_EXCLUSION_HALF
        const exX = origin.x + mineGX - R;
        const exY = origin.y + mineGY - R;
        const exW = R * 2;
        const exH = R * 2;
        ctx.fillStyle = 'rgba(180,40,40,0.25)';
        if (this.isometric) {
          this.drawIsoQuad(ctx, exX, exY, exW, exH, 'fill');
        } else {
          const { px: ex1, py: ey1 } = this.tp(exX, exY);
          const { px: ex2, py: ey2 } = this.tp(exX + exW, exY + exH);
          ctx.fillRect(ex1, ey1, ex2 - ex1, ey2 - ey1);
        }
        ctx.strokeStyle = 'rgba(180,40,40,0.5)';
        ctx.lineWidth = 1;
        if (this.isometric) {
          this.drawIsoQuad(ctx, exX, exY, exW, exH, 'stroke');
        } else {
          const { px: ex1, py: ey1 } = this.tp(exX, exY);
          const { px: ex2, py: ey2 } = this.tp(exX + exW, exY + exH);
          ctx.strokeRect(ex1, ey1, ex2 - ex1, ey2 - ey1);
        }
      }

      ctx.strokeStyle = `rgba(${color},0.65)`;
      ctx.lineWidth = 2;
      if (this.isometric) {
        this.drawIsoQuad(ctx, origin.x, origin.y, aCols, aRows, 'stroke');
      } else {
        const { py: aOgPy } = this.tp(origin.x, origin.y);
        const { px: aOgPx2, py: aOgPy2 } = this.tp(origin.x + aCols, origin.y + aRows);
        ctx.strokeRect(aOgPx, aOgPy, aOgPx2 - aOgPx, aOgPy2 - aOgPy);
      }

      ctx.fillStyle = `rgba(${color},0.8)`;
      ctx.font = 'bold 11px monospace';
      const isBottom = team === Team.Bottom;
      const { py: aLy } = isBottom ? this.tp(origin.x, origin.y + aRows + 1.2) : this.tp(origin.x, origin.y - 0.4);
      ctx.fillText('TOWER ALLEY', aOgPx, aLy);
    }
  }

  // === Y-Sorted Rendering (depth ordering) ===

  // Reusable sort buffer to avoid per-frame allocations (GC pressure)
  // kind: 0=hq, 1=building, 2=projectile, 3=unit, 4=dead, 5=harvester
  // px/py cache the projected pixel coords so drawOne* functions don't re-call tp()
  private sortBuf: { y: number; kind: number; idx: number; px: number; py: number }[] = [];

  private drawYSorted(ctx: CanvasRenderingContext2D, state: GameState): void {
    // Cache alive enemy alley buildings once per frame (used by drawOneUnit for siege facing)
    const eab = this._enemyAlleyBuildings;
    eab.length = 0;
    for (const b of state.buildings) {
      if (b.buildGrid !== 'alley' || b.hp <= 0) continue;
      const bp = state.players[b.playerId];
      if (!bp) continue;
      eab.push({ team: bp.team, x: b.worldX + 0.5, y: b.worldY + 0.5 });
    }
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
      const { px: hqPx, py: hqPy } = this.tp(pos.x, pos.y + HQ_HEIGHT);
      if (n < buf.length) { buf[n].y = hqPy; buf[n].kind = 0; buf[n].idx = ti; buf[n].px = hqPx; buf[n].py = hqPy; }
      else buf.push({ y: hqPy, kind: 0, idx: ti, px: hqPx, py: hqPy });
      n++;
    }

    // Buildings — cull off-screen + fog filter
    for (let i = 0; i < state.buildings.length; i++) {
      const b = state.buildings[i];
      const { px: bpx, py: bpy } = this.tp(b.worldX, b.worldY);
      if (bpx < vpX0 || bpx > vpX1 || bpy < vpY0 || bpy > vpY1) continue;
      // Fog: hide enemy buildings in unseen tiles
      if (fog && state.players[b.playerId]?.team !== localTeam && !this.isTileVisible(state, b.worldX, b.worldY)) continue;
      const { py: bsy } = this.tp(b.worldX, b.worldY + 1);
      if (n < buf.length) { buf[n].y = bsy; buf[n].kind = 1; buf[n].idx = i; buf[n].px = bpx; buf[n].py = bpy; }
      else buf.push({ y: bsy, kind: 1, idx: i, px: bpx, py: bpy });
      n++;
    }

    // Projectiles — cull off-screen + fog filter
    for (let i = 0; i < state.projectiles.length; i++) {
      const p = state.projectiles[i];
      const { px: ppx, py: ppy } = this.tp(p.x, p.y);
      if (ppx < vpX0 || ppx > vpX1 || ppy < vpY0 || ppy > vpY1) continue;
      if (fog && !this.isTileVisible(state, p.x, p.y)) continue;
      if (n < buf.length) { buf[n].y = ppy; buf[n].kind = 2; buf[n].idx = i; buf[n].px = ppx; buf[n].py = ppy; }
      else buf.push({ y: ppy, kind: 2, idx: i, px: ppx, py: ppy });
      n++;
    }

    // Units — cull off-screen + fog filter
    for (let i = 0; i < state.units.length; i++) {
      const u = state.units[i];
      if (u.hp <= 0) continue;
      const { px: upx, py: upy } = this.tp(u.x, u.y);
      if (upx < vpX0 || upx > vpX1 || upy < vpY0 || upy > vpY1) continue;
      // Fog: hide enemy units in unseen tiles
      if (fog && u.team !== localTeam && !this.isTileVisible(state, u.x, u.y)) continue;
      if (n < buf.length) { buf[n].y = upy; buf[n].kind = 3; buf[n].idx = i; buf[n].px = upx; buf[n].py = upy; }
      else buf.push({ y: upy, kind: 3, idx: i, px: upx, py: upy });
      n++;
    }

    // Dead units — cull off-screen + fog filter
    for (let i = 0; i < this.deadUnits.length; i++) {
      const d = this.deadUnits[i];
      const { px: dpx, py: dpy } = this.tp(d.x, d.y);
      if (dpx < vpX0 || dpx > vpX1 || dpy < vpY0 || dpy > vpY1) continue;
      if (fog && d.team !== localTeam && !this.isTileVisible(state, d.x, d.y)) continue;
      if (n < buf.length) { buf[n].y = dpy; buf[n].kind = 4; buf[n].idx = i; buf[n].px = dpx; buf[n].py = dpy; }
      else buf.push({ y: dpy, kind: 4, idx: i, px: dpx, py: dpy });
      n++;
    }

    // Harvesters — cull off-screen + fog filter
    for (let i = 0; i < state.harvesters.length; i++) {
      const h = state.harvesters[i];
      if (h.state === 'dead') continue;
      const { px: hpx, py: hpy } = this.tp(h.x, h.y);
      if (hpx < vpX0 || hpx > vpX1 || hpy < vpY0 || hpy > vpY1) continue;
      if (fog && state.players[h.playerId]?.team !== localTeam && !this.isTileVisible(state, h.x, h.y)) continue;
      if (n < buf.length) { buf[n].y = hpy; buf[n].kind = 5; buf[n].idx = i; buf[n].px = hpx; buf[n].py = hpy; }
      else buf.push({ y: hpy, kind: 5, idx: i, px: hpx, py: hpy });
      n++;
    }

    // Sort only the active portion by Y ascending (in-place, no allocation)
    if (buf.length > n) buf.length = n; // trim excess from prior frames
    buf.sort((a, b) => a.y - b.y);

    // Dispatch draws — pass cached pixel coords to avoid redundant tp() calls
    for (let i = 0; i < n; i++) {
      const item = buf[i];
      this._cachedPx = item.px;
      this._cachedPy = item.py;
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
    Entities.updateDeadUnits(dt, this._ectx);
  }


  private drawDeadUnit(ctx: CanvasRenderingContext2D, dead: DeadUnitSnapshot): void {
    this._ectx.cachedPx = this._cachedPx;
    this._ectx.cachedPy = this._cachedPy;
    Entities.drawDeadUnit(ctx, dead, this._ectx);
  }

  // === HQs ===

  private drawOneHQ(ctx: CanvasRenderingContext2D, state: GameState, team: Team): void {
    const pos = getHQPosition(team, state.mapDef);
    const hp = state.hqHp[team];
    const color = team === Team.Bottom ? '#2979ff' : '#ff1744';
    const bg = team === Team.Bottom ? 'rgba(41, 121, 255, 0.15)' : 'rgba(255, 23, 68, 0.15)';

    const { px, py } = this.tp(pos.x, pos.y);
    const w = HQ_WIDTH * T, h = HQ_HEIGHT * T;

    // Map team to a player on that team for sprite lookup
    const hqPlayerId = state.players.find(p => p.team === team)?.id ?? (team === Team.Bottom ? 0 : 2);
    const sprite = this.sprites.getHQSprite(hqPlayerId);
    if (sprite) {
      const drawW = w + T * 2;
      const drawH = (drawW / sprite.width) * sprite.height;
      const drawX = px - T;
      const drawY = py + h - drawH;

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
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${hp}`, cx, barY + barH + 10);
      ctx.textAlign = 'start';
    }
  }

  // === Buildings ===

  private drawOneBuilding(ctx: CanvasRenderingContext2D, state: GameState, b: BuildingState): void {
    this._ectx.cachedPx = this._cachedPx;
    this._ectx.cachedPy = this._cachedPy;
    Entities.drawOneBuilding(ctx, state, b, this._ectx);
  }

  // === Projectiles ===

  private drawOneProjectile(ctx: CanvasRenderingContext2D, state: GameState, p: ProjectileState): void {
    this._ectx.cachedPx = this._cachedPx;
    this._ectx.cachedPy = this._cachedPy;
    Entities.drawOneProjectile(ctx, state, p, this._ectx);
  }

  // === Units ===

  private drawOneUnit(ctx: CanvasRenderingContext2D, state: GameState, u: UnitState): void {
    this._ectx.cachedPx = this._cachedPx;
    this._ectx.cachedPy = this._cachedPy;
    Entities.drawOneUnit(ctx, state, u, this._ectx);
  }

  // === Unit Shape Helper ===

  drawUnitShape(
    ctx: CanvasRenderingContext2D,
    px: number, py: number, r: number,
    race: Race | undefined, category: string, team: Team, playerColor: string
  ): void {
    _drawUnitShapeStandalone(ctx, px, py, r, race, category, team, playerColor);
  }
  // === Harvesters ===

  private drawOneHarvester(ctx: CanvasRenderingContext2D, state: GameState, h: HarvesterState): void {
    this._ectx.cachedPx = this._cachedPx;
    this._ectx.cachedPy = this._cachedPy;
    Entities.drawOneHarvester(ctx, state, h, this._ectx);
  }

  // === Diamond Objective ===

  private drawDiamondObjective(ctx: CanvasRenderingContext2D, state: GameState): void {
    const d = state.diamond;
    if (d.state === 'carried') return;

    // Respawning: show a faded timer at center
    if (d.state === 'respawning') {
      const { px, py } = this.tp(d.x + 0.5, d.y + 0.5);
      const secs = Math.ceil(d.respawnTimer / 20);
      ctx.save();
      ctx.globalAlpha = 0.4 + 0.2 * Math.sin(this.frameNow / 500);
      ctx.beginPath();
      ctx.arc(px, py, 14, 0, Math.PI * 2);
      ctx.strokeStyle = '#00ffff';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#00ffff';
      ctx.fillText(`${secs}s`, px, py + 4);
      ctx.textAlign = 'start';
      ctx.restore();
      return;
    }

    const { px, py } = this.tp(d.x + 0.5, d.y + 0.5);
    const size = 10;
    const pulse = 0.7 + 0.3 * Math.sin(this.frameNow / 300);

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

      ctx.font = 'bold 11px monospace';
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
    ctx.font = 'bold 11px monospace';
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
      const target = p.targetId != null ? this._renderUnitById.get(p.targetId) : undefined;
      if (!target) continue;
      const race = state.players[p.sourcePlayerId]?.race;
      const color = race ? (RACE_COLORS[race]?.primary ?? '#fff') : '#fff';
      ctx.strokeStyle = color + '30';
      const { px: talPx1, py: talPy1 } = this.tp(p.x + 0.5, p.y + 0.5);
      const { px: talPx2, py: talPy2 } = this.tp(target.x + 0.5, target.y + 0.5);
      ctx.beginPath();
      ctx.moveTo(talPx1, talPy1);
      ctx.lineTo(talPx2, talPy2);
      ctx.stroke();
    }
  }

  // === Nuke Telegraph ===

  private drawNukeTelegraphs(ctx: CanvasRenderingContext2D, state: GameState): void {
    for (const tel of state.nukeTelegraphs) {
      const { px, py } = this.tp(tel.x, tel.y);
      const r = tel.radius * T;
      const pulse = 0.5 + 0.5 * Math.sin(this.frameNow / 100);
      const progress = 1 - tel.timer / Math.round(1.25 * 20); // 0 -> 1 as it nears detonation

      // Player-color tinted warning (each player's nuke is visually distinct)
      const pc = hexToRgba(PLAYER_COLORS[tel.playerId % PLAYER_COLORS.length]);

      // Warning circle - gets more intense as it approaches detonation
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = `${pc}${(0.05 + 0.15 * progress).toFixed(2)})`;
      ctx.fill();

      // Pulsing ring
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.strokeStyle = `${pc}${(0.3 + 0.4 * pulse * progress).toFixed(2)})`;
      ctx.lineWidth = 2 + progress * 3;
      ctx.setLineDash([8, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Inner concentric ring
      ctx.beginPath();
      ctx.arc(px, py, r * 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = `${pc}${(0.2 + 0.3 * pulse * progress).toFixed(2)})`;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Warning text (keep white for readability across all player colors)
      ctx.fillStyle = `rgba(255, 255, 255, ${0.7 + 0.3 * pulse})`;
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
      const { px, py } = this.tp(p.x, p.y);
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
      ctx.font = 'bold 11px monospace';
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
      const { px: partPx, py: partPy } = this.tp(p.x, p.y);
      ctx.arc(partPx, partPy, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawDeathEffects(ctx: CanvasRenderingContext2D): void {
    for (let i = this.deathEffects.length - 1; i >= 0; i--) {
      const d = this.deathEffects[i];
      const progress = d.frame / d.maxFrames;
      const { px: dePx, py: dePy } = this.tp(d.x, d.y);

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
          drawGridFrame(ctx, img, def, sprFrame, dePx - s / 2, dePy - s / 2, s, s);
          ctx.globalAlpha = 1;
        } else {
          // Fallback to dust if sprite not loaded
          const fxData = this.sprites.getFxSprite('dust');
          if (fxData) {
            const [img, def] = fxData;
            const sprFrame = Math.min(Math.floor(progress * def.cols), def.cols - 1);
            ctx.globalAlpha = 1 - progress * 0.5;
            drawSpriteFrame(ctx, img, def as SpriteDef, sprFrame, dePx - d.size / 2, dePy - d.size / 2, d.size, d.size);
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
          drawSpriteFrame(ctx, img, def as SpriteDef, sprFrame, dePx - s / 2, dePy - s / 2, s, s);
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
      const wasAttacking = (u.targetId !== null || u._attackBuildingIdx !== undefined) && u.attackTimer > 0;
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
        this.prevTickUnitPos.delete(id);
        this.movedThisTick.delete(id);
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
    Overlays.drawFloatingTexts(ctx, state, this.sprites, this.ui, this.isometric, this.localPlayerId, this.frameNow);
  }

  private drawNukeEffects(ctx: CanvasRenderingContext2D, state: GameState): void {
    Overlays.drawNukeEffects(ctx, state, this.sprites, this.isometric);
  }

  private drawAbilityEffects(ctx: CanvasRenderingContext2D, state: GameState): void {
    Overlays.drawAbilityEffects(ctx, state, this.sprites, this.isometric, this.frameNow);
  }

  // === HUD ===

  private drawHUD(ctx: CanvasRenderingContext2D, state: GameState, _networkLatencyMs?: number, desyncDetected?: boolean, peerDisconnected?: boolean, waitingForAllyMs?: number): void {
    Overlays.drawHUD(ctx, state, this.ui, this.canvas, this.localPlayerId, _networkLatencyMs, desyncDetected, peerDisconnected, waitingForAllyMs);
  }

  private drawQuickChats(ctx: CanvasRenderingContext2D, state: GameState): void {
    Overlays.drawQuickChats(ctx, state, this.canvas, this.localPlayerId);
  }

  // === Minimap ===

  /** If screen coords (sx, sy) are inside the minimap, return world-pixel coords. */
  minimapHitTest(sx: number, sy: number): { worldX: number; worldY: number } | null {
    const compact = this.canvas.clientWidth < 600;
    if (this.isometric) {
      const bounds = isoWorldBounds(this.mapW, this.mapH);
      const isoW = bounds.maxX - bounds.minX;
      const isoH = bounds.maxY - bounds.minY;
      const isoAspect = isoW / isoH;
      let mmW: number, mmH: number;
      if (isoAspect >= 1) { mmW = compact ? 120 : 180; mmH = Math.round(mmW / isoAspect); }
      else { mmH = compact ? 120 : 180; mmW = Math.round(mmH * isoAspect); }
      const mmx = this.canvas.clientWidth - mmW - 10;
      const mmy = (compact ? 46 : 60) + getSafeTop();
      if (sx < mmx || sx > mmx + mmW || sy < mmy || sy > mmy + mmH) return null;
      const worldPx = bounds.minX + ((sx - mmx) / mmW) * isoW;
      const worldPy = bounds.minY + ((sy - mmy) / mmH) * isoH;
      return { worldX: worldPx, worldY: worldPy };
    }
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
    const result = Overlays.drawMinimap(
      ctx, state, this.sprites, this.camera, this.canvas, this.isometric,
      this.localPlayerId, this.mapW, this.mapH, this.frameNow,
      this.minimapCacheTick, this.minimapCache, this.minimapCacheW, this.minimapCacheH,
      (s, tx, ty) => this.isTileVisible(s, tx, ty),
      (tx, ty) => this.tp(tx, ty),
    );
    this.minimapCacheTick = result.minimapCacheTick;
    this.minimapCache = result.minimapCache;
    this.minimapCacheW = result.minimapCacheW;
    this.minimapCacheH = result.minimapCacheH;
  }
}




