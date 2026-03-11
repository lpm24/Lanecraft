import { Camera } from './Camera';
import { SpriteLoader, drawSpriteFrame, drawGridFrame, type SpriteDef, type GridSpriteDef } from './SpriteLoader';
import { UIAssets } from './UIAssets';
import {
  GameState, Team, MAP_WIDTH, MAP_HEIGHT, TILE_SIZE,
  ZONES,
  HQ_WIDTH, HQ_HEIGHT, HQ_HP,
  BuildingType, Lane, Vec2,
  StatusType, Race, ResourceType,
  type MapDef,
  type BuildingState, type UnitState, type HarvesterState, type ProjectileState,
} from '../simulation/types';
import { DUEL_MAP } from '../simulation/maps';
import { getHQPosition, getBuildGridOrigin, getHutGridOrigin, getTeamAlleyOrigin, getUnitUpgradeMultipliers } from '../simulation/GameState';
import { RACE_COLORS, TOWER_STATS, PLAYER_COLORS } from '../simulation/data';
import {
  getDayNight, DayNightState,
  ScreenShake, WeatherSystem, AmbientParticles,
  ProjectileTrails, ConstructionAnims, HitFlashTracker, CombatVFX, triggerHaptic,
} from './VisualEffects';

const T = TILE_SIZE;
const LANE_LEFT_COLOR = '#4fc3f7';
const LANE_RIGHT_COLOR = '#ff8a65';
const DEAD_UNIT_LIFETIME_SEC = 0.45;

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

  constructor(canvas: HTMLCanvasElement, ui?: UIAssets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.camera = new Camera(canvas);
    this.sprites = new SpriteLoader();
    this.ui = ui ?? new UIAssets();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
  }

  /** Update facing direction for an entity based on movement. Returns true if facing left. */
  private updateFacing(id: number, x: number, defaultLeft: boolean): boolean {
    const prev = this.prevX.get(id);
    if (prev !== undefined) {
      const dx = x - prev;
      if (Math.abs(dx) > 0.01) {
        this.facing.set(id, dx < 0);
      }
    }
    this.prevX.set(id, x);
    return this.facing.get(id) ?? defaultLeft;
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

    // Update visual effects
    this.dayNight = getDayNight(elapsedSec);
    this.screenShake.update(dt);
    this.weather.update(dt, elapsedSec, this.dayNight.phase);
    this.projectileTrails.update(dt);
    this.updateDeadUnits(dt);
    if (state.tick !== this.lastConsumedTick) {
      this.combatVfx.consume(state.combatEvents);
      this.lastConsumedTick = state.tick;
    }
    this.combatVfx.update(dt);

    // Detect nuke detonation for screen shake + haptic
    if (state.nukeEffects.length > this.lastNukeCount) {
      this.screenShake.trigger(8, 0.6);
      triggerHaptic(200, 1.0);
    }
    this.lastNukeCount = state.nukeEffects.length;

    // Screen shake on HQ destroyed
    if (this.lastHqHp[0] >= 0) {
      for (let t = 0; t < state.hqHp.length; t++) {
        if ((this.lastHqHp[t] ?? 0) > 0 && state.hqHp[t] <= 0) {
          this.screenShake.trigger(12, 1.0);
          triggerHaptic(300, 1.0);
        }
      }
    }
    this.lastHqHp = [...state.hqHp];

    // Gather combat zones for ambient particles
    const combatZones: { x: number; y: number }[] = [];
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

    // Weather particles (world-space)
    this.weather.drawWorld(ctx);

    // Day/night tint overlay (world-space)
    if (this.dayNight.tintAlpha > 0.005) {
      ctx.fillStyle = this.dayNight.tint;
      ctx.fillRect(
        this.camera.x - 100, this.camera.y - 100,
        this.canvas.clientWidth / this.camera.zoom + 200,
        this.canvas.clientHeight / this.camera.zoom + 200
      );
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Weather screen overlay
    this.weather.drawOverlay(ctx, this.canvas.clientWidth, this.canvas.clientHeight);
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

        if (edge) {
          tctx.drawImage(tilemap, gsx, gsy, S, S,
            x * T - OV, y * T - OV, T + OV * 2, T + OV * 2);
        } else {
          tctx.drawImage(tilemap, gsx, gsy, S, S, x * T, y * T, T, T);
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

    // 4. Scatter bush decorations on grass
    const bush1Data = this.sprites.getTerrainSprite('bush1');
    const bush2Data = this.sprites.getTerrainSprite('bush2');
    if (bush1Data || bush2Data) {
      for (let i = 0; i < 40; i++) {
        // Place bushes randomly within playable area
        const bx = Math.floor(rand() * mW);
        const by = Math.floor(rand() * mH);
        if (!mapDef.isPlayable(bx, by)) continue;
        // Ensure we're not too close to the edge
        if (!mapDef.isPlayable(bx - 2, by) || !mapDef.isPlayable(bx + 2, by)) continue;
        const x = bx, y = by;
        const bushData = (i % 2 === 0 && bush1Data) ? bush1Data : (bush2Data ?? bush1Data);
        if (!bushData) continue;
        const [bImg, bDef] = bushData;
        const frame = Math.floor(rand() * bDef.cols);
        const s = T * (1.0 + rand() * 0.6);
        const aspect = bDef.frameW / bDef.frameH;
        tctx.globalAlpha = 0.7 + rand() * 0.3;
        drawSpriteFrame(tctx, bImg, bDef, frame, x * T - s / 2, y * T - s * 0.5, s * aspect, s);
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

    const drawWoodPile = (x: number, y: number, amount: number) => {
      const px = x * T;
      const py = y * T;
      const size = Math.min(1.15, 0.58 + amount * 0.08) * T;
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.beginPath();
      ctx.ellipse(px, py + size * 0.22, size * 0.55, size * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();

      const logs = Math.max(2, Math.min(4, Math.ceil(amount / 3)));
      for (let i = 0; i < logs; i++) {
        const row = i % 2;
        const lx = px + (i - (logs - 1) / 2) * (size * 0.24) + (row === 1 ? size * 0.1 : 0);
        const ly = py - row * size * 0.12 - Math.floor(i / 2) * size * 0.06;
        ctx.fillStyle = row === 0 ? '#8d5a35' : '#a56a3f';
        ctx.fillRect(lx - size * 0.16, ly - size * 0.08, size * 0.32, size * 0.16);
        ctx.fillStyle = '#d7b083';
        ctx.beginPath();
        ctx.arc(lx - size * 0.16, ly, size * 0.08, 0, Math.PI * 2);
        ctx.arc(lx + size * 0.16, ly, size * 0.08, 0, Math.PI * 2);
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
        const angle = Math.sin(now * 1.15 + phase) * 0.032;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        drawSpriteFrame(ctx, img, def, 0, -size / 2, -size * 0.84, size, size);
        ctx.restore();
      };

      ctx.fillStyle = 'rgba(42, 88, 48, 0.18)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + T * 0.5, T * 6.8, T * 2.9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(81, 122, 63, 0.2)';
      ctx.beginPath();
      ctx.ellipse(cx - T * 1.1, cy + T * 0.2, T * 5.3, T * 2.1, 0.08, 0, Math.PI * 2);
      ctx.ellipse(cx + T * 1.6, cy + T * 0.45, T * 4.7, T * 1.9, -0.1, 0, Math.PI * 2);
      ctx.fill();

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

      anchors.sort((a, b) => a.oy - b.oy);
      for (const anchor of anchors) {
        const data = sprites[anchor.sprite % sprites.length];
        drawTree(
          data,
          cx + anchor.ox * T * 0.72,
          cy + anchor.oy * T * 0.48,
          anchor.size * T,
          anchor.sprite * 0.9 + anchor.ox * 0.2,
        );
      }

      state.woodPiles
        .filter(pile => Math.hypot(pile.x - woodNode.x, pile.y - woodNode.y) < 8)
        .sort((a, b) => a.y - b.y)
        .forEach(pile => drawWoodPile(pile.x, pile.y, pile.amount));
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
    const maxP = state.mapDef.maxPlayers;
    for (let p = 0; p < maxP; p++) {
      const origin = getBuildGridOrigin(p, state.mapDef);
      const player = state.players[p];
      if (!player) continue;

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
    const maxP = state.mapDef.maxPlayers;
    for (let p = 0; p < maxP; p++) {
      const player = state.players[p];
      if (!player) continue;
      const origin = getHutGridOrigin(p, state.mapDef);
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
    for (const team of [Team.Bottom, Team.Top]) {
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

  private drawYSorted(ctx: CanvasRenderingContext2D, state: GameState): void {
    // Collect all renderable entities with their sort Y (bottom edge)
    const items: { y: number; draw: () => void }[] = [];

    // HQs — sort by bottom edge (pos.y + HQ_HEIGHT)
    for (const team of [Team.Bottom, Team.Top] as Team[]) {
      const pos = getHQPosition(team, state.mapDef);
      const sortY = (pos.y + HQ_HEIGHT) * T;
      items.push({ y: sortY, draw: () => this.drawOneHQ(ctx, state, team) });
    }

    // Buildings — sort by bottom of tile
    for (const b of state.buildings) {
      const sortY = (b.worldY + 1) * T;
      items.push({ y: sortY, draw: () => this.drawOneBuilding(ctx, state, b) });
    }

    // Projectiles — sort by current position
    for (const p of state.projectiles) {
      const sortY = p.y * T;
      items.push({ y: sortY, draw: () => this.drawOneProjectile(ctx, state, p) });
    }

    // Units — sort by current y
    for (const u of state.units) {
      if (u.hp <= 0) continue;
      const sortY = u.y * T;
      items.push({ y: sortY, draw: () => this.drawOneUnit(ctx, state, u) });
    }

    // Dead units linger briefly so bodies can visibly finish collapsing.
    for (const dead of this.deadUnits) {
      items.push({ y: dead.y * T, draw: () => this.drawDeadUnit(ctx, dead) });
    }

    // Harvesters — sort by current y
    for (const h of state.harvesters) {
      if (h.state === 'dead') continue;
      const sortY = h.y * T;
      items.push({ y: sortY, draw: () => this.drawOneHarvester(ctx, state, h) });
    }

    // Sort by Y ascending (higher on screen drawn first, lower on screen drawn last / in front)
    items.sort((a, b) => a.y - b.y);

    for (const item of items) {
      item.draw();
    }
  }

  private updateDeadUnits(dt: number): void {
    for (let i = this.deadUnits.length - 1; i >= 0; i--) {
      const dead = this.deadUnits[i];
      dead.ageSec += dt;
      if (dead.ageSec >= DEAD_UNIT_LIFETIME_SEC) this.deadUnits.splice(i, 1);
    }
  }

  private getUnitFrame(tick: number, cols: number): number {
    const ticksPerFrame = Math.max(1, Math.round(20 / cols));
    return Math.floor(tick / ticksPerFrame) % cols;
  }

  private drawDeadUnit(ctx: CanvasRenderingContext2D, dead: DeadUnitSnapshot): void {
    const px = dead.x * T;
    const py = dead.y * T;
    const cx = px + T / 2;
    const feetY = py + T * 0.70;
    const progress = Math.min(1, dead.ageSec / DEAD_UNIT_LIFETIME_SEC);
    const alpha = 1 - progress * 0.75;
    const flatten = 1 - progress * 0.72;
    const rotation = (dead.faceLeft ? -1 : 1) * progress * 1.15;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(cx, py + T - 1, 7 + progress * 3, 2.5 + progress, 0, 0, Math.PI * 2);
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

      ctx.translate(cx, feetY);
      ctx.rotate(rotation);
      ctx.scale(dead.faceLeft ? -1 : 1, flatten);
      drawSpriteFrame(ctx, img, def, dead.frame, -drawW / 2, -drawH * groundY, drawW, drawH);
    } else {
      const radius = (dead.category === 'ranged' ? 3 : 4) * tierScale;
      ctx.translate(cx, py + T / 2);
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
        // Sprites are taller than wide, so scale by width to fit tile
        const baseDrawW = T + 4; // slightly larger than tile for visual presence
        const baseDrawH = (baseDrawW / sprite.width) * sprite.height;

        // Construction animation: scale-up bounce
        const buildScale = this.constructionAnims.getScale(b.id, state.tick);
        const drawW = baseDrawW * buildScale;
        const drawH = baseDrawH * buildScale;
        const drawX = px - drawW / 2;
        const drawY = py + half - drawH + 2; // anchor bottom to tile bottom

        // Building shadow (day/night responsive) — anchored at building base
        const bShadowLen = this.dayNight.shadowLength;
        const bShadowX = Math.cos(this.dayNight.shadowAngle) * bShadowLen * 3;
        ctx.fillStyle = `rgba(0,0,0,${this.dayNight.brightness * 0.15})`;
        ctx.beginPath();
        ctx.ellipse(px + bShadowX, py + half + 1, drawW * 0.4, drawW * 0.1, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.drawImage(sprite, drawX, drawY, drawW, drawH);

        // Tower: range indicator + ranged unit sprite on top
        if (b.type === BuildingType.Tower) {
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
            const unitSize = T * 1.5 * spriteScale;
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
        // Fallback: procedural shapes
        ctx.fillStyle = 'rgba(20, 20, 20, 0.9)';
        ctx.strokeStyle = playerColor;
        ctx.lineWidth = upgradeTier >= 2 ? 3 : 2;

        switch (b.type) {
          case BuildingType.MeleeSpawner:
            ctx.fillRect(px - half, py - half, half * 2, half * 2);
            ctx.strokeRect(px - half, py - half, half * 2, half * 2);
            break;
          case BuildingType.RangedSpawner:
            ctx.beginPath();
            ctx.moveTo(px, py - half); ctx.lineTo(px + half, py + half); ctx.lineTo(px - half, py + half);
            ctx.closePath(); ctx.fill(); ctx.stroke();
            break;
          case BuildingType.CasterSpawner:
            ctx.beginPath();
            for (let i = 0; i < 5; i++) {
              const a = (i * 2 * Math.PI / 5) - Math.PI / 2;
              const sx = px + Math.cos(a) * half, sy = py + Math.sin(a) * half;
              if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
            }
            ctx.closePath(); ctx.fill(); ctx.stroke();
            break;
          case BuildingType.Tower: {
            ctx.beginPath();
            ctx.moveTo(px, py - half); ctx.lineTo(px + half, py);
            ctx.lineTo(px, py + half); ctx.lineTo(px - half, py);
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
            ctx.beginPath(); ctx.arc(px, py, half, 0, Math.PI * 2);
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

    // Determine projectile type: caster AoE (speed 10), tower (speed 12), chain (speed 18/20), ranged (speed 15)
    const isCasterProj = p.speed <= 10 && p.aoeRadius >= 3;
    const isTowerProj = p.speed === 12 || p.speed === 18;
    const isRangedProj = !isCasterProj && !isTowerProj;

    // Animation frame — loop through the bright middle portion of the lifecycle
    // Orbs: 30 frames, circles: 48 frames. Frames ~5-15 are the brightest.
    const animFrame = 5 + Math.floor(state.tick / 2) % 10;

    // Crown ranged gets arrow sprite; everyone else gets orbs
    const usesArrow = race === Race.Crown && isRangedProj;

    let drewSprite = false;

    if (usesArrow) {
      // Arrow sprite — rotate toward target
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
    } else if (isCasterProj && race != null) {
      // Caster AoE — use circle sprite (bigger, more dramatic)
      const circData = this.sprites.getCircleSprite(race);
      if (circData) {
        const [img, def] = circData;
        const size = T * 1.6;
        drawGridFrame(ctx, img, def, animFrame, px - size / 2, py - size / 2, size, size);
        drewSprite = true;
      }
    } else if (race != null) {
      // Ranged or tower — use orb sprite
      const orbData = this.sprites.getOrbSprite(race);
      if (orbData) {
        const [img, def] = orbData;
        const size = isTowerProj ? T * 1.2 : T * 1.0;
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

      // Drop shadow — moves with day/night sun angle
      const cx = px + T / 2;
      const cy = py + T / 2;
      const shadowLen = this.dayNight.shadowLength;
      const shadowOffX = Math.cos(this.dayNight.shadowAngle) * shadowLen * 3;
      const shadowOffY = Math.sin(this.dayNight.shadowAngle) * shadowLen * 1.5 + 3;
      const shadowAlpha = this.dayNight.brightness * 0.25;
      ctx.fillStyle = `rgba(0,0,0,${shadowAlpha})`;
      ctx.beginPath();
      ctx.ellipse(cx + shadowOffX, cy + shadowOffY, 5 + shadowLen, 2.5 + shadowLen * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();

      // Try sprite first, fall back to procedural shapes
      const race = state.players[u.playerId]?.race;
      const cat = u.category as 'melee' | 'ranged' | 'caster';
      const isAttacking = u.targetId !== null && u.attackTimer <= u.attackSpeed * 0.5;
      const spriteData = race ? this.sprites.getUnitSprite(race, cat, u.playerId, isAttacking, u.upgradeNode) : null;
      const tierScale = 1.0 + (u.upgradeTier ?? 0) * 0.15; // 1.0 / 1.15 / 1.3
      if (spriteData) {
        const [img, def] = spriteData;
        const spriteScale = def.scale ?? 1.0;
        const baseH = T * 1.82 * spriteScale * tierScale;
        const aspect = def.frameW / def.frameH;
        const drawW = baseH * aspect;
        const drawH = baseH * (def.heightScale ?? 1.0);
        // Normalize animation: ~1 cycle per second (20 ticks) regardless of frame count
        const ticksPerFrame = Math.max(1, Math.round(20 / def.cols));
        const frame = Math.floor(state.tick / ticksPerFrame) % def.cols;
        // Anchor feet at consistent ground level
        const feetY = py + T * 0.70;
        const drawY = feetY - drawH * (def.groundY ?? 0.71);

        // Determine facing: track movement direction, override when attacking toward target
        let faceLeft = this.updateFacing(u.id, u.x, u.team === Team.Top);
        if (u.targetId !== null) {
          const target = state.units.find(t => t.id === u.targetId);
          if (target) {
            faceLeft = target.x < u.x;
            this.facing.set(u.id, faceLeft);
          }
        }

        if (faceLeft) {
          ctx.save();
          ctx.translate(cx, 0);
          ctx.scale(-1, 1);
          drawSpriteFrame(ctx, img, def, frame, -drawW / 2, drawY, drawW, drawH);
          ctx.restore();
        } else {
          drawSpriteFrame(ctx, img, def, frame, cx - drawW / 2, drawY, drawW, drawH);
        }
        // Hit flash: bright white tint when taking damage
        if (this.hitFlash.consume(u.id)) {
          ctx.globalAlpha = 0.55;
          ctx.globalCompositeOperation = 'lighter';
          if (faceLeft) {
            ctx.save();
            ctx.translate(cx, 0);
            ctx.scale(-1, 1);
            drawSpriteFrame(ctx, img, def, frame, -drawW / 2, drawY, drawW, drawH);
            ctx.restore();
          } else {
            drawSpriteFrame(ctx, img, def, frame, cx - drawW / 2, drawY, drawW, drawH);
          }
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
        }
        // Tier glow: subtle additive overlay for upgraded units
        const tier = u.upgradeTier ?? 0;
        if (tier >= 1) {
          ctx.globalAlpha = 0.12 + tier * 0.06;
          ctx.globalCompositeOperation = 'lighter';
          if (faceLeft) {
            ctx.save();
            ctx.translate(cx, 0);
            ctx.scale(-1, 1);
            drawSpriteFrame(ctx, img, def, frame, -drawW / 2, drawY, drawW, drawH);
            ctx.restore();
          } else {
            drawSpriteFrame(ctx, img, def, frame, cx - drawW / 2, drawY, drawW, drawH);
          }
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
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
      // Lane indicator above head: < for left, > for right
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = laneColor;
      ctx.fillText(u.lane === Lane.Left ? '<' : '>', px + T / 2, py - 1);

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

      // HP bar (only if damaged) — smooth drain with gradient
      if (u.hp < u.maxHp) {
        const barW = 12, barH = 2.5;
        const barX = ux - barW / 2, barY = py - 1;
        const targetPct = u.hp / u.maxHp;
        // Smooth HP drain
        const prevPct = this.smoothHp.get(u.id) ?? targetPct;
        const displayPct = prevPct + (targetPct - prevPct) * 0.15;
        this.smoothHp.set(u.id, displayPct);

        ctx.fillStyle = '#111';
        ctx.fillRect(barX - 0.5, barY - 0.5, barW + 1, barH + 1);
        // Gradient fill green -> yellow -> red
        const grad = ctx.createLinearGradient(barX, barY, barX + barW * displayPct, barY);
        if (displayPct > 0.5) {
          grad.addColorStop(0, '#4caf50');
          grad.addColorStop(1, '#8bc34a');
        } else if (displayPct > 0.25) {
          grad.addColorStop(0, '#ff9800');
          grad.addColorStop(1, '#ffc107');
        } else {
          grad.addColorStop(0, '#f44336');
          grad.addColorStop(1, '#ff5722');
        }
        ctx.fillStyle = grad;
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

      // Drop shadow
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
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
        const ticksPerFrame = Math.max(1, Math.round(20 / def.cols));
        const frame = Math.floor(state.tick / ticksPerFrame) % def.cols;

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
        const bundleX = px + (faceLeft ? -6 : 6);
        const bundleY = py - 4;
        for (let i = 0; i < 3; i++) {
          const offsetY = i * 2 - 2;
          ctx.fillStyle = i === 1 ? '#a56a3f' : '#8d5a35';
          ctx.fillRect(bundleX - 4, bundleY + offsetY - 1, 8, 2);
          ctx.fillStyle = '#d7b083';
          ctx.beginPath();
          ctx.arc(bundleX - 4, bundleY + offsetY, 1, 0, Math.PI * 2);
          ctx.arc(bundleX + 4, bundleY + offsetY, 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (h.carryingDiamond) {
        ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
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
      const labelText = 'MINE CENTER TO EXPOSE DIAMOND';
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

    ctx.save();
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 14 * pulse;

    ctx.beginPath();
    ctx.moveTo(px, py - size); ctx.lineTo(px + size, py);
    ctx.lineTo(px, py + size); ctx.lineTo(px - size, py);
    ctx.closePath();
    ctx.fillStyle = `rgba(255, 255, 255, ${0.8 + 0.2 * pulse})`;
    ctx.fill();
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('DIAMOND', px, py + size + 12);
    ctx.textAlign = 'start';
  }

  // === Tower Attack Lines ===

  private drawTowerAttackLines(ctx: CanvasRenderingContext2D, state: GameState): void {
    ctx.lineWidth = 0.5;
    for (const p of state.projectiles) {
      // Draw for tower projectiles (speed 12) and chain projectiles (speed 18)
      if (p.speed !== 12 && p.speed !== 18) continue;
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
    const currentUnitIds = new Set<number>();
    for (const u of state.units) {
      currentUnitIds.add(u.id);
      const faceLeft = this.facing.get(u.id) ?? (u.team === Team.Top);
      const wasAttacking = u.targetId !== null && u.attackTimer <= u.attackSpeed * 0.5;
      const category = u.category as UnitCategory;
      const race = state.players[u.playerId]?.race;
      const spriteData = race
        ? this.sprites.getUnitSprite(race, category, u.playerId, wasAttacking, u.upgradeNode)
        : null;
      const frame = spriteData ? this.getUnitFrame(state.tick, spriteData[1].cols) : 0;
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
          this.deathEffects.push({
            x: pos.x, y: pos.y, frame: 0, maxFrames: 14,
            size: T * 1.8, type: 'race_burst', race: pos.race
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
    const currentBuildingIds = new Set<number>();
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
    const currentIds = new Set(state.buildings.map(b => b.id));
    for (const id of this.knownBuildingIds) {
      if (!currentIds.has(id)) this.knownBuildingIds.delete(id);
    }
    this.constructionAnims.cleanup(currentIds);
  }

  private drawFloatingTexts(ctx: CanvasRenderingContext2D, state: GameState): void {
    for (const ft of state.floatingTexts) {
      const alpha = 1 - ft.age / ft.maxAge;
      const yOff = -(ft.age / ft.maxAge) * 20; // float upward
      ctx.globalAlpha = alpha;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      // Dark outline for readability
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 2.5;
      ctx.strokeText(ft.text, ft.x * T, ft.y * T + yOff);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x * T, ft.y * T + yOff);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'start';
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

  // === HUD ===

  private drawHUD(ctx: CanvasRenderingContext2D, state: GameState, networkLatencyMs?: number, desyncDetected?: boolean, peerDisconnected?: boolean, waitingForAllyMs?: number): void {
    const player = state.players[this.localPlayerId];
    if (!player) return;
    const W = this.canvas.clientWidth;
    const compact = W < 600;  // mobile breakpoint
    const fontSize = compact ? 11 : 14;
    const iconSz = compact ? 16 : 22;
    const hudH = compact ? 42 : 56;
    const pad = compact ? 6 : 12;

    // HUD background — oversized to hide left/right edges, taller for breathing room
    const bgOverW = Math.round(W * 0.25);
    const bgH = Math.round(hudH * 1.10);
    if (!this.ui.drawWoodTable(ctx, -bgOverW / 2, 0, W + bgOverW, bgH)) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.fillRect(0, 0, W, bgH);
    }

    ctx.font = `bold ${fontSize}px monospace`;
    const ps = state.playerStats?.[this.localPlayerId];
    const elapsed = Math.max(1, state.tick / 20);

    // Row 1: Resources + timer
    const y1 = compact ? 14 : 20;
    let x = pad;
    const iconY = y1 - iconSz / 2;

    // Resource helper
    const drawRes = (icon: 'gold' | 'wood' | 'meat', val: number, color: string, rate?: string) => {
      this.ui.drawIcon(ctx, icon, x, iconY, iconSz);
      x += iconSz + 1;
      ctx.fillStyle = color;
      const text = !compact && rate ? `${val} (+${rate}/s)` : `${val}`;
      ctx.fillText(text, x, y1 + fontSize * 0.35);
      x += ctx.measureText(text).width + (compact ? 4 : 8);
    };

    const goldRate = ps ? (ps.totalGoldEarned / elapsed).toFixed(1) : '?';
    const woodRate = ps ? (ps.totalWoodEarned / elapsed).toFixed(1) : '?';
    const stoneRate = ps ? (ps.totalStoneEarned / elapsed).toFixed(1) : '?';

    drawRes('gold', player.gold, '#ffd700', goldRate);
    drawRes('wood', player.wood, '#4caf50', woodRate);
    drawRes('meat', player.stone, '#e57373', stoneRate);

    // Timer + ping — right-aligned, left of settings/info buttons (which are ~70px from right edge)
    const hudRightEdge = networkLatencyMs !== undefined ? W - 80 : W - pad;
    const secs = Math.floor(state.tick / 20);
    const timerText = `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
    ctx.fillStyle = '#888';
    let timerX = hudRightEdge;
    // Ping indicator (to the right of timer, left of buttons)
    if (networkLatencyMs !== undefined) {
      const latText = `${networkLatencyMs}ms`;
      const latColor = networkLatencyMs < 80 ? '#4caf50' : networkLatencyMs < 200 ? '#ff9800' : '#f44336';
      const latW = ctx.measureText(latText).width;
      ctx.fillStyle = latColor;
      ctx.fillText(latText, timerX - latW, y1 + fontSize * 0.35);
      timerX -= latW + 8;
      ctx.fillStyle = '#888';
    }
    ctx.fillText(timerText, timerX - ctx.measureText(timerText).width, y1 + fontSize * 0.35);

    // Row 2: HQ bars + diamond + units
    const y2 = compact ? 32 : 42;
    const smallFont = compact ? 9 : 11;
    ctx.font = `bold ${smallFont}px monospace`;
    let x2 = pad;

    // HQ health bars
    const localTeamHud = player.team;
    const enemyTeamHud = localTeamHud === Team.Bottom ? Team.Top : Team.Bottom;
    const ourHp = state.hqHp[localTeamHud];
    const enemyHp = state.hqHp[enemyTeamHud];
    const hqBarW = compact ? 40 : 60;
    const hqBarH = compact ? 8 : 12;
    const drawHQBar = (label: string, hp: number, _color: string) => {
      ctx.fillStyle = '#ddd';
      ctx.fillText(label, x2, y2);
      x2 += ctx.measureText(label).width + 3;
      const pct = Math.max(0, hp / HQ_HP);
      if (!this.ui.drawBar(ctx, x2, y2 - hqBarH, hqBarW, hqBarH, pct)) {
        ctx.fillStyle = '#222';
        ctx.fillRect(x2, y2 - hqBarH, hqBarW, hqBarH);
        ctx.fillStyle = pct > 0.5 ? _color : pct > 0.25 ? '#ff9800' : '#f44336';
        ctx.fillRect(x2, y2 - hqBarH, hqBarW * pct, hqBarH);
      }
      x2 += hqBarW + 4;
    };
    drawHQBar('US', ourHp, '#2979ff');
    drawHQBar('EN', enemyHp, '#ff1744');

    // Diamond status
    const goldRemaining = state.diamondCells.reduce((s, c) => s + c.gold, 0);
    const totalGold = state.diamondCells.reduce((s, c) => s + c.maxGold, 0);
    const minedPct = Math.round((1 - goldRemaining / totalGold) * 100);
    if (state.diamond.exposed) {
      ctx.fillStyle = '#fff';
      ctx.fillText(compact ? 'DIAMOND!' : 'DIAMOND EXPOSED!', x2, y2);
      x2 += ctx.measureText(compact ? 'DIAMOND!' : 'DIAMOND EXPOSED!').width + 8;
    } else {
      ctx.fillStyle = '#aa8800';
      const mineText = compact ? `${minedPct}%` : `MINE ${minedPct}%`;
      ctx.fillText(mineText, x2, y2);
      x2 += ctx.measureText(mineText).width + 8;
    }

    // Right side of row 2: unit counts
    const rightItems: string[] = [];
    const rightColors: string[] = [];

    // Units
    const myUnits = state.units.filter(u => u.team === player.team).length;
    const enemyUnits = state.units.filter(u => u.team !== player.team).length;
    rightItems.push(`${myUnits}v${enemyUnits}`);
    rightColors.push('#aaa');

    let rx = W - pad;
    for (let i = rightItems.length - 1; i >= 0; i--) {
      const tw = ctx.measureText(rightItems[i]).width;
      rx -= tw;
      ctx.fillStyle = rightColors[i];
      ctx.fillText(rightItems[i], rx, y2);
      rx -= 8;
    }

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
    const compact = this.canvas.clientWidth < 600;
    const startX = 12;
    const startY = compact ? 48 : 62;
    const lineH = 18;

    for (let i = 0; i < visibleChats.length; i++) {
      const c = visibleChats[visibleChats.length - 1 - i];
      const alpha = Math.max(0.2, 1 - c.age / c.maxAge);
      const style = quickChatStyle(c.message);
      const text = `${style.icon} P${c.playerId + 1}: ${c.message}`;
      ctx.font = 'bold 12px monospace';
      const w = ctx.measureText(text).width + 12;
      const y = startY + i * lineH;
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
    const my = compact ? 46 : 60;
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
    const my = compact ? 46 : 60; // top-right, just below HUD bar
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

    // Combat glow zones on minimap — pulse where fighting is happening
    const combatClusters: { x: number; y: number; count: number }[] = [];
    for (const u of state.units) {
      if (u.targetId === null) continue;
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

    // Units as dots (player colored)
    for (const u of state.units) {
      ctx.fillStyle = PLAYER_COLORS[u.playerId] || '#888';
      ctx.fillRect(mx + u.x * scaleX - 1, my + u.y * scaleY - 1, 2, 2);
    }

    // Team-visible ping markers
    const localTeam = state.players[this.localPlayerId]?.team ?? Team.Bottom;
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

    // Harvesters as smaller dots
    for (const h of state.harvesters) {
      if (h.state === 'dead') continue;
      ctx.fillStyle = PLAYER_COLORS[h.playerId] || '#888';
      ctx.globalAlpha = 0.7;
      ctx.fillRect(mx + h.x * scaleX, my + h.y * scaleY, 1, 1);
      ctx.globalAlpha = 1;
    }

    // Buildings as slightly larger dots
    for (const b of state.buildings) {
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




