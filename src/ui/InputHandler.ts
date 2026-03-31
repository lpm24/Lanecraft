import { Game } from '../game/Game';
import { Camera } from '../rendering/Camera';
import { Renderer } from '../rendering/Renderer';
import {
  BuildingType, TILE_SIZE, Lane,
  HarvesterAssignment, Team, Race, UnitState, NUKE_RADIUS,
  AbilityTargetMode, HQ_WIDTH, HQ_HEIGHT, StatusEffect, StatusType,
  ResearchUpgradeState, isAbilityBuilding,
} from '../simulation/types';
import { getBuildGridOrigin, getTeamAlleyOrigin, getHutGridOrigin, getHQPosition, getBaseGoldPosition } from '../simulation/GameState';
import { RACE_BUILDING_COSTS, UNIT_STATS, TOWER_STATS, RACE_COLORS, RACE_ABILITY_INFO, RACE_ABILITY_DEFS, TOWER_COST_SCALE, getUpgradeNodeDef, ABILITY_COST_MODIFIERS } from '../simulation/data';
import { TICK_RATE } from '../simulation/types';
import { UIAssets } from '../rendering/UIAssets';
import { SpriteLoader, drawSpriteFrame, drawGridFrame, getSpriteFrame } from '../rendering/SpriteLoader';
import { BuildingPopup, getRaceBuildingName } from './BuildingPopup';
import { HutPopup } from './HutPopup';
import { ResearchPopup } from './ResearchPopup';
import { SeedPopup } from './SeedPopup';
import { getSafeBottom, getSafeTop, getPopupSafeY } from './SafeArea';
import { getAudioSettings, updateAudioSettings } from '../audio/AudioSettings';
import { getVisualSettings, updateVisualSettings, type TouchControlsMode } from '../rendering/VisualSettings';
import { tileToPixel, pixelToTile } from '../rendering/Projection';
import { drawStatVisualIcon, type StatVisualKey } from './StatBarUtils';
import {
  getTutorialStep, advanceTutorial, skipTutorial,
  isMatchTutorial, getMatchPopupInfo, TUTORIAL_TIMEOUT_MS,
  refreshTutorialCache,
} from './TutorialManager';

interface BuildTrayItem {
  type: BuildingType;
  label: string;
  key: string;
}

const BUILD_TRAY: BuildTrayItem[] = [
  { type: BuildingType.MeleeSpawner, label: 'Melee', key: '2' },
  { type: BuildingType.RangedSpawner, label: 'Ranged', key: '3' },
  { type: BuildingType.CasterSpawner, label: 'Caster', key: '4' },
  { type: BuildingType.Tower, label: 'Tower', key: '5' },
];

const ASSIGNMENT_LABELS: Record<HarvesterAssignment, string> = {
  [HarvesterAssignment.BaseGold]: '* Gold',
  [HarvesterAssignment.Wood]: 'W Wood',
  [HarvesterAssignment.Meat]: 'M Meat',
  [HarvesterAssignment.Center]: 'C Center',
  [HarvesterAssignment.Mana]: '~ Mana',
};

// Buff/debuff icon metadata for the WoW-style status bar
const BUFF_ICON_META: Record<StatusType, { key: StatVisualKey; isDebuff: boolean; maxDur: number }> = {
  [StatusType.Burn]:       { key: 'burn', isDebuff: true,  maxDur: 3 },
  [StatusType.Slow]:       { key: 'slow', isDebuff: true,  maxDur: 3 },
  [StatusType.Wound]:      { key: 'wound', isDebuff: true,  maxDur: 6 },
  [StatusType.Vulnerable]: { key: 'vulnerable', isDebuff: true,  maxDur: 3 },
  [StatusType.Haste]:      { key: 'haste', isDebuff: false, maxDur: 3 },
  [StatusType.Shield]:     { key: 'shield', isDebuff: false, maxDur: 4 },
  [StatusType.Frenzy]:     { key: 'frenzy', isDebuff: false, maxDur: 4 },
};

function statLineToken(key: StatVisualKey, text: string): string {
  return `__stat__:${key}:${text}`;
}

function displayLineText(line: string): string {
  if (line.startsWith('__stat__:')) {
    const parts = line.split(':');
    return parts.slice(2).join(':');
  }
  if (line.startsWith('__research__:')) return 'Research';
  return line;
}

const LANE_MODE_STORAGE_KEY = 'lanecraft.laneToggleMode';
const UI_FEEDBACK_STORAGE_KEY = 'lanecraft.uiFeedbackEnabled';
const RADIAL_ARM_MS_STORAGE_KEY = 'lanecraft.radialArmMs';
const RADIAL_SIZE_STORAGE_KEY = 'lanecraft.radialSize';
const RADIAL_A11Y_STORAGE_KEY = 'lanecraft.radialA11y';
const CAMERA_SNAP_STORAGE_KEY = 'lanecraft.cameraSnapOnSelect';
const MINIMAP_PAN_STORAGE_KEY = 'lanecraft.minimapPanEnabled';
const STICKY_BUILD_STORAGE_KEY = 'lanecraft.stickyBuildMode';
const MOBILE_HINT_SEEN_KEY = 'lanecraft.mobileHintSeen';
const NUKE_LOCKOUT_SECONDS = 60;

export class InputHandler {
  private game: Game;
  private canvas: HTMLCanvasElement;
  private camera: Camera;
  private selectedBuilding: BuildingType | null = null;
  /** Expose selected building for Renderer grid visibility. */
  get placingBuilding(): BuildingType | null { return this.selectedBuilding; }
  private hoveredGridSlot: { gx: number; gy: number; isAlley: boolean; isHut?: boolean; hutSlot?: number } | null = null;
  private hoveredBuildingId: number | null = null;
  private selectedBuildingId: number | null = null;
  private pointerX = 0;
  private pointerY = 0;
  private quickChatRadialActive = false;
  private quickChatRadialCenter: { x: number; y: number } | null = null;
  private quickChatCooldownUntil = 0;
  private suppressClicksUntil = 0;
  private quickChatToast: { text: string; until: number } | null = null;
  private laneToast: { text: string; until: number } | null = null;
  private queuedQuickChat: { message: string; at: number } | null = null;
  private mobileHintVisible = false;
  private settingsOpen = false;
  private settingsSliderDrag: 'music' | 'sfx' | null = null;
  private activeTouchPointers = new Set<number>();
  private touchHoldTimer: ReturnType<typeof setTimeout> | null = null;
  private touchHoldStart: { x: number; y: number; id: number } | null = null;
  private laneToggleMode: 'double' | 'single' = 'double';
  private radialArmMs = 320;
  private radialSize = 74;
  private radialAccessibility = false;
  private uiFeedbackEnabled = true;
  private cameraSnapOnSelect = true;
  private minimapPanEnabled = true;
  private stickyBuildMode = false;
  private audioCtx: AudioContext | null = null;
  private nukeTargeting = false;
  private abilityTargeting = false;
  private abilityPlacing = false;  // BuildSlot ability: player is choosing an alley slot
  private tooltip: { text: string; x: number; y: number } | null = null;
  private selectedUnitId: number | null = null;
  private selectedHarvesterId: number | null = null;
  private cameraFollowing = false;
  private followBtnRect: { x: number; y: number; w: number; h: number } | null = null;
  private hoveredUnitId: number | null = null;
  private showTutorial = false;
  private hideTutorialOnStart = localStorage.getItem('lanecraft.hideTutorial') === 'true';
  // Guided tutorial state — re-derived from TutorialManager each frame
  private matchTutorialActive = false;
  private tutorialStepStartTime = performance.now();
  private tutorialSkipRect: { x: number; y: number; w: number; h: number } | null = null;
  private tutorialSkipAllRect: { x: number; y: number; w: number; h: number } | null = null;
  private tutorialCheckboxRect: { x: number; y: number; w: number; h: number } | null = null;
  private tutorialCloseRect: { x: number; y: number; w: number; h: number } | null = null;
  private devOverlayOpen = false;
  private abortController = new AbortController();
  private currentRenderer: Renderer | null = null;
  private networkLatencyMs: number | undefined = undefined;
  private ui: UIAssets;
  private sprites: SpriteLoader | null = null;
  private buildingPopup = new BuildingPopup();
  private hutPopup = new HutPopup();
  private researchPopup = new ResearchPopup();
  private seedPopup = new SeedPopup();
  private trayTick = 0;
  private trayBldgSpriteCache = new Map<string, HTMLImageElement | null>();
  /** Last observed input type — updated via pointerType on pointermove/pointerdown events. */
  private lastInputType: 'mouse' | 'touch' = ('ontouchstart' in window || navigator.maxTouchPoints > 0) ? 'touch' : 'mouse';
  /** Whether to use touch interaction mode (tap-to-confirm, no hover tooltips, hide key hints). */
  private get isTouchDevice(): boolean {
    const mode: TouchControlsMode = getVisualSettings().touchControls;
    if (mode === 'on') return true;
    if (mode === 'off') return false;
    return this.lastInputType === 'touch';
  }
  /** Active rally override — all spawners send to this lane while set. 'random' = each spawner gets a random lane. */
  private rallyOverride: Lane | 'random' | null = null;
  /** Saved per-building lane assignments before rally override was activated. */
  private rallyPrevLanes: Map<number, Lane> = new Map();

  /** Called when the player taps "Quit Game" in the settings panel. */
  onQuitGame: (() => void) | null = null;
  /** Called when the player taps "Concede" in the settings panel. */
  onConcede: (() => void) | null = null;

  /** "Now Playing" track name + timing for fade */
  private nowPlayingName = '';
  private nowPlayingStart = 0;
  private static readonly NP_SHOW_MS = 10_000;
  private static readonly NP_FADE_MS = 600;

  setNowPlaying(name: string): void {
    this.nowPlayingName = name;
    this.nowPlayingStart = performance.now();
  }

  constructor(game: Game, canvas: HTMLCanvasElement, camera: Camera, ui?: UIAssets, sprites?: SpriteLoader) {
    this.game = game;
    this.canvas = canvas;
    this.camera = camera;
    this.ui = ui ?? new UIAssets();
    this.sprites = sprites ?? null;
    this.setupKeyboard();
    this.setupMouse();
    this.loadSettings();
    this.initMobileHint();
  }

  /** Local player's slot index (0 = host/solo, 1 = guest). */
  private get pid(): number { return this.game.playerSlot; }
  /** Local player's team. */
  private get myTeam(): Team { return this.game.state.players[this.pid]?.team ?? Team.Bottom; }
  /** Whether isometric rendering is active. */
  private get iso(): boolean { return this.currentRenderer?.isometric ?? false; }
  /** Convert world-pixel coords to tile coords (isometric-aware). */
  private worldToTile(wpx: number, wpy: number): { tileX: number; tileY: number } {
    return pixelToTile(wpx, wpy, this.iso);
  }
  /** Convert tile coords to world-pixel coords (isometric-aware). */
  private tp(tileX: number, tileY: number): { px: number; py: number } {
    return tileToPixel(tileX, tileY, this.iso);
  }

  /** Draw a single tile cell as a filled + stroked highlight.
   *  In iso mode draws a diamond; in ortho draws a rectangle. */
  private drawCellHighlight(ctx: CanvasRenderingContext2D, tx: number, ty: number, fillStyle: string, strokeStyle: string, lineWidth: number): void {
    ctx.fillStyle = fillStyle;
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    if (this.iso) {
      // Extract immediately — tp() returns shared object
      let p = this.tp(tx, ty);         const ax = p.px, ay = p.py;
      p = this.tp(tx + 1, ty);         const bx = p.px, by = p.py;
      p = this.tp(tx + 1, ty + 1);     const cx = p.px, cy = p.py;
      p = this.tp(tx, ty + 1);         const dx = p.px, dy = p.py;
      ctx.beginPath();
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.lineTo(dx, dy);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    } else {
      const { px: wx, py: wy } = this.tp(tx, ty);
      ctx.fillRect(wx, wy, TILE_SIZE, TILE_SIZE);
      ctx.strokeRect(wx, wy, TILE_SIZE, TILE_SIZE);
    }
  }

  destroy(): void {
    this.cancelTouchHold();
    this.abortController.abort();
  }

  private loadSettings(): void {
    try {
      const raw = window.localStorage.getItem(LANE_MODE_STORAGE_KEY);
      if (raw === 'single' || raw === 'double') this.laneToggleMode = raw;
      const feedback = window.localStorage.getItem(UI_FEEDBACK_STORAGE_KEY);
      if (feedback === '0') this.uiFeedbackEnabled = false;
      const armMs = Number(window.localStorage.getItem(RADIAL_ARM_MS_STORAGE_KEY));
      if (Number.isFinite(armMs) && armMs >= 220 && armMs <= 700) this.radialArmMs = Math.round(armMs);
      const radialSize = Number(window.localStorage.getItem(RADIAL_SIZE_STORAGE_KEY));
      if (Number.isFinite(radialSize) && radialSize >= 56 && radialSize <= 120) this.radialSize = Math.round(radialSize);
      this.radialAccessibility = window.localStorage.getItem(RADIAL_A11Y_STORAGE_KEY) === '1';
      const cameraSnap = window.localStorage.getItem(CAMERA_SNAP_STORAGE_KEY);
      if (cameraSnap === '0') this.cameraSnapOnSelect = false;
      const minimapPan = window.localStorage.getItem(MINIMAP_PAN_STORAGE_KEY);
      if (minimapPan === '0') this.minimapPanEnabled = false;
      this.stickyBuildMode = window.localStorage.getItem(STICKY_BUILD_STORAGE_KEY) === '1';
    } catch { /* ignore storage errors */ }
  }

  private saveLaneMode(): void {
    try { window.localStorage.setItem(LANE_MODE_STORAGE_KEY, this.laneToggleMode); }
    catch { /* ignore storage errors */ }
  }

  private saveUiFeedbackEnabled(): void {
    try { window.localStorage.setItem(UI_FEEDBACK_STORAGE_KEY, this.uiFeedbackEnabled ? '1' : '0'); }
    catch { /* ignore storage errors */ }
  }

  private saveRadialSettings(): void {
    try {
      window.localStorage.setItem(RADIAL_ARM_MS_STORAGE_KEY, `${this.radialArmMs}`);
      window.localStorage.setItem(RADIAL_SIZE_STORAGE_KEY, `${this.radialSize}`);
      window.localStorage.setItem(RADIAL_A11Y_STORAGE_KEY, this.radialAccessibility ? '1' : '0');
    } catch { /* ignore storage errors */ }
  }

  private saveGameplaySettings(): void {
    try {
      window.localStorage.setItem(CAMERA_SNAP_STORAGE_KEY, this.cameraSnapOnSelect ? '1' : '0');
      window.localStorage.setItem(MINIMAP_PAN_STORAGE_KEY, this.minimapPanEnabled ? '1' : '0');
      window.localStorage.setItem(STICKY_BUILD_STORAGE_KEY, this.stickyBuildMode ? '1' : '0');
    } catch { /* ignore storage errors */ }
  }

  private resetUiDefaults(): void {
    this.laneToggleMode = 'double';
    this.uiFeedbackEnabled = true;
    this.radialArmMs = 320;
    this.radialSize = 74;
    this.radialAccessibility = false;
    this.cameraSnapOnSelect = true;
    this.minimapPanEnabled = true;
    this.stickyBuildMode = false;
    this.saveLaneMode();
    this.saveUiFeedbackEnabled();
    this.saveRadialSettings();
    this.saveGameplaySettings();
    updateVisualSettings({ screenShake: true, weather: true, dayNight: true, touchControls: 'auto' });
  }

  private initMobileHint(): void {
    try {
      const seen = window.localStorage.getItem(MOBILE_HINT_SEEN_KEY) === '1';
      const touchCapable = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      this.mobileHintVisible = touchCapable && !seen && !isMatchTutorial();
    } catch {
      this.mobileHintVisible = false;
    }
  }

  private dismissMobileHint(): void {
    this.mobileHintVisible = false;
    try { window.localStorage.setItem(MOBILE_HINT_SEEN_KEY, '1'); }
    catch { /* ignore */ }
  }

  private laneModeLabel(): string {
    return this.laneToggleMode === 'single' ? 'Fast Toggle' : 'Safe Select';
  }

  /** Compute the in-game settings panel layout. Row Y positions are relative to panel top. */
  private getSettingsPanelLayout() {
    const sr = this.getSettingsButtonRect();
    const sx = sr.x + sr.w - 200;
    const sy = sr.y + sr.h + 4;
    const pw = 200;
    const rowH = 22;
    const gap = 2;
    const pad = 8;

    let y = 24; // after title row

    // Audio section
    const audioHeaderY = y; y += 14;
    const musicRowY = y; y += rowH + gap;
    const sfxRowY = y; y += rowH + gap + 4;

    // Visual section
    const visualHeaderY = y; y += 14;
    const shakeRowY = y; y += rowH + gap;
    const weatherRowY = y; y += rowH + gap;
    const dayNightRowY = y; y += rowH + gap + 4;

    // Controls section
    const controlsHeaderY = y; y += 14;
    const touchControlsRowY = y; y += rowH + gap;
    const laneRowY = y; y += rowH + gap;
    const feedbackRowY = y; y += rowH + gap;
    const cameraSnapRowY = y; y += rowH + gap;
    const minimapRowY = y; y += rowH + gap;
    const stickyRowY = y; y += rowH + gap;
    const holdDelayRowY = y; y += rowH + gap;
    const radialSizeRowY = y; y += rowH + gap;
    const radialA11yRowY = y; y += rowH + gap + 4;

    // Actions
    const helpRowY = -1;
    const resetRowY = y; y += rowH + gap + 8;
    let concedeRowY = -1;
    if (this.onConcede) { concedeRowY = y; y += rowH + gap + 8; }
    const quitRowY = y; y += rowH + pad;

    const panelH = y;

    return {
      sx, sy, pw, panelH, pad, rowH,
      audioHeaderY, musicRowY, sfxRowY,
      visualHeaderY, shakeRowY, weatherRowY, dayNightRowY,
      controlsHeaderY, touchControlsRowY, laneRowY, feedbackRowY, cameraSnapRowY, minimapRowY,
      stickyRowY, holdDelayRowY, radialSizeRowY, radialA11yRowY,
      helpRowY, resetRowY, concedeRowY, quitRowY,
    };
  }

  private drawSettingsPanel(ctx: CanvasRenderingContext2D): void {
    const L = this.getSettingsPanelLayout();
    const { sx, sy, pw, panelH, pad, rowH } = L;
    const rw = pw - pad * 2;
    const rx = sx + pad;
    const audio = getAudioSettings();
    const vis = getVisualSettings();

    // Panel background — draw oversized to account for 9-slice dead space
    const bgPadX = pw * 0.15;
    const bgPadY = panelH * 0.15;
    if (!this.ui.drawWoodTable(ctx, sx - bgPadX, sy - bgPadY, pw + bgPadX * 2, panelH + bgPadY * 2)) {
      ctx.fillStyle = 'rgba(0,0,0,0.92)';
      ctx.fillRect(sx, sy, pw, panelH);
    }

    // Title + close
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('Settings', sx + pad, sy + 16);
    this.ui.drawIcon(ctx, 'close', sx + pw - 22, sy + 4, 16);

    // ── Helper: section header ──
    const drawHeader = (yOff: number, label: string) => {
      ctx.fillStyle = '#8fa7bf';
      ctx.font = 'bold 11px monospace';
      const tw = ctx.measureText(label).width;
      ctx.fillText(label, rx, sy + yOff + 10);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(rx + tw + 4, sy + yOff + 6, rw - tw - 4, 1);
    };

    // ── Helper: toggle row ──
    const drawToggle = (yOff: number, label: string, on: boolean, color: string) => {
      ctx.fillStyle = 'rgba(20,20,20,0.9)';
      ctx.fillRect(rx, sy + yOff, rw, rowH);
      ctx.strokeStyle = on ? color : '#555';
      ctx.strokeRect(rx, sy + yOff, rw, rowH);
      ctx.fillStyle = on ? color : '#888';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(`${label}: ${on ? 'on' : 'off'}`, rx + 8, sy + yOff + 15);
      // Mini toggle switch
      const tX = rx + rw - 32;
      const tY = sy + yOff + 5;
      ctx.fillStyle = on ? color : '#444';
      ctx.fillRect(tX, tY, 24, 12);
      ctx.fillStyle = '#fff';
      ctx.fillRect(on ? tX + 12 : tX, tY, 12, 12);
    };

    // ── Helper: slider row ──
    const drawSlider = (yOff: number, label: string, value: number, color: string) => {
      ctx.fillStyle = 'rgba(20,20,20,0.9)';
      ctx.fillRect(rx, sy + yOff, rw, rowH);
      ctx.strokeStyle = color;
      ctx.strokeRect(rx, sy + yOff, rw, rowH);
      ctx.fillStyle = color;
      ctx.font = 'bold 11px monospace';
      ctx.fillText(`${label}: ${Math.round(value * 100)}%`, rx + 8, sy + yOff + 15);
      // Slider track
      const trackX = rx + 92;
      const trackY = sy + yOff + 8;
      const trackW = rw - 100;
      const trackH = 6;
      const fillW = Math.max(0, Math.min(trackW, trackW * value));
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(trackX, trackY, trackW, trackH);
      ctx.fillStyle = color;
      ctx.fillRect(trackX, trackY, fillW, trackH);
      ctx.strokeStyle = color;
      ctx.strokeRect(trackX, trackY, trackW, trackH);
      const knobX = trackX + fillW;
      ctx.fillStyle = '#fff';
      ctx.fillRect(Math.max(trackX - 2, Math.min(trackX + trackW - 4, knobX - 2)), trackY - 2, 4, trackH + 4);
    };

    // ── Helper: action row ──
    const drawAction = (yOff: number, label: string, color: string, bgColor: string) => {
      ctx.fillStyle = bgColor;
      ctx.fillRect(rx, sy + yOff, rw, rowH);
      ctx.strokeStyle = color;
      ctx.strokeRect(rx, sy + yOff, rw, rowH);
      ctx.fillStyle = color;
      ctx.font = 'bold 11px monospace';
      ctx.fillText(label, rx + 8, sy + yOff + 15);
    };

    // ── AUDIO ──
    drawHeader(L.audioHeaderY, 'AUDIO');
    drawSlider(L.musicRowY, 'Music', audio.musicVolume, '#90caf9');
    drawSlider(L.sfxRowY, 'SFX', audio.sfxVolume, '#ffcc80');

    // ── VISUAL ──
    drawHeader(L.visualHeaderY, 'VISUAL');
    drawToggle(L.shakeRowY, 'Screen Shake', vis.screenShake, '#a5d6a7');
    drawToggle(L.weatherRowY, 'Weather', vis.weather, '#a5d6a7');
    drawToggle(L.dayNightRowY, 'Day/Night', vis.dayNight, '#a5d6a7');

    // ── CONTROLS ──
    drawHeader(L.controlsHeaderY, 'CONTROLS');
    // Touch controls: 3-state cycle (auto / on / off)
    {
      const tc = vis.touchControls;
      ctx.fillStyle = 'rgba(20,20,20,0.9)';
      ctx.fillRect(rx, sy + L.touchControlsRowY, rw, rowH);
      ctx.strokeStyle = '#b39ddb';
      ctx.strokeRect(rx, sy + L.touchControlsRowY, rw, rowH);
      ctx.fillStyle = '#b39ddb';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(`Touch: ${tc}`, rx + 8, sy + L.touchControlsRowY + 15);
      const states: Array<'auto' | 'on' | 'off'> = ['auto', 'on', 'off'];
      const btnW = 22; const bGap = 2;
      const totalW = btnW * 3 + bGap * 2;
      const bx = rx + rw - totalW - 4;
      const by = sy + L.touchControlsRowY + 4;
      const bh = 14;
      for (let i = 0; i < states.length; i++) {
        const bsx = bx + i * (btnW + bGap);
        const active = tc === states[i];
        ctx.fillStyle = active ? '#b39ddb' : '#333';
        ctx.fillRect(bsx, by, btnW, bh);
        ctx.fillStyle = active ? '#000' : '#888';
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'center';
        const lbl = states[i] === 'auto' ? 'A' : states[i] === 'on' ? '1' : '0';
        ctx.fillText(lbl, bsx + btnW / 2, by + 10);
        ctx.textAlign = 'start';
      }
    }
    // Lane tap: special value-cycle row (not a simple on/off toggle)
    ctx.fillStyle = 'rgba(20,20,20,0.9)';
    ctx.fillRect(rx, sy + L.laneRowY, rw, rowH);
    ctx.strokeStyle = '#9bb7ff';
    ctx.strokeRect(rx, sy + L.laneRowY, rw, rowH);
    ctx.fillStyle = '#9bb7ff';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(`Lane Tap: ${this.laneModeLabel()}`, rx + 8, sy + L.laneRowY + 15);
    drawToggle(L.feedbackRowY, 'UI Feedback', this.uiFeedbackEnabled, '#90caf9');
    drawToggle(L.cameraSnapRowY, 'Camera Snap', this.cameraSnapOnSelect, '#90caf9');
    drawToggle(L.minimapRowY, 'Minimap Pan', this.minimapPanEnabled, '#90caf9');
    drawToggle(L.stickyRowY, 'Sticky Build', this.stickyBuildMode, '#90caf9');

    // Hold delay and radial size as value-cycle rows
    ctx.fillStyle = 'rgba(20,20,20,0.9)';
    ctx.fillRect(rx, sy + L.holdDelayRowY, rw, rowH);
    ctx.strokeStyle = '#90caf9';
    ctx.strokeRect(rx, sy + L.holdDelayRowY, rw, rowH);
    ctx.fillStyle = '#90caf9';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(`Hold Delay: ${this.radialArmMs}ms`, rx + 8, sy + L.holdDelayRowY + 15);

    ctx.fillStyle = 'rgba(20,20,20,0.9)';
    ctx.fillRect(rx, sy + L.radialSizeRowY, rw, rowH);
    ctx.strokeStyle = '#90caf9';
    ctx.strokeRect(rx, sy + L.radialSizeRowY, rw, rowH);
    ctx.fillStyle = '#90caf9';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(`Radial Size: ${this.radialSize}`, rx + 8, sy + L.radialSizeRowY + 15);

    drawToggle(L.radialA11yRowY, 'Radial A11y', this.radialAccessibility, '#90caf9');

    // ── ACTIONS ──
    drawAction(L.resetRowY, 'Reset Defaults', '#ffcc80', 'rgba(20,20,20,0.9)');
    if (this.onConcede && L.concedeRowY >= 0) {
      drawAction(L.concedeRowY, 'Concede Match', '#ffa726', 'rgba(80,60,10,0.9)');
    }
    drawAction(L.quitRowY, 'Quit Game', '#ff5252', 'rgba(80,20,20,0.9)');
  }

  private handleSettingsPanelClick(cx: number, cy: number): boolean {
    const L = this.getSettingsPanelLayout();
    const { sx, sy, pw, panelH, pad, rowH } = L;
    const rx = sx + pad;
    const rw = pw - pad * 2;

    // Click outside panel → close
    if (cx < sx || cx >= sx + pw || cy < sy || cy >= sy + panelH) {
      this.settingsOpen = false;
      this.settingsSliderDrag = null;
      this.game.sfx.playUIClose();
      return true;
    }
    // Close button
    if (cx >= sx + pw - 22 && cx < sx + pw - 6 && cy >= sy + 4 && cy < sy + 20) {
      this.settingsOpen = false;
      this.game.sfx.playUIClose();
      return true;
    }

    const inRow = (rowY: number) => cx >= rx && cx < rx + rw && cy >= sy + rowY && cy < sy + rowY + rowH;

    // Audio sliders (click sets value)
    if (inRow(L.musicRowY)) {
      const trackX = rx + 92;
      const trackW = rw - 100;
      const v = Math.max(0, Math.min(1, (cx - trackX) / trackW));
      updateAudioSettings({ musicVolume: v });
      this.game.sfx.playUISlider();
      return true;
    }
    if (inRow(L.sfxRowY)) {
      const trackX = rx + 92;
      const trackW = rw - 100;
      const v = Math.max(0, Math.min(1, (cx - trackX) / trackW));
      updateAudioSettings({ sfxVolume: v });
      this.game.sfx.playUISlider();
      return true;
    }

    // Visual toggles
    if (inRow(L.shakeRowY)) {
      const vis = getVisualSettings();
      updateVisualSettings({ screenShake: !vis.screenShake });
      this.game.sfx.playUIToggle();
      return true;
    }
    if (inRow(L.weatherRowY)) {
      const vis = getVisualSettings();
      updateVisualSettings({ weather: !vis.weather });
      this.game.sfx.playUIToggle();
      return true;
    }
    if (inRow(L.dayNightRowY)) {
      const vis = getVisualSettings();
      updateVisualSettings({ dayNight: !vis.dayNight });
      this.game.sfx.playUIToggle();
      return true;
    }

    // Controls toggles
    if (inRow(L.touchControlsRowY)) {
      const vis = getVisualSettings();
      const cycle: Record<string, 'auto' | 'on' | 'off'> = { auto: 'on', on: 'off', off: 'auto' };
      updateVisualSettings({ touchControls: cycle[vis.touchControls] });
      this.game.sfx.playUIToggle();
      return true;
    }
    if (inRow(L.laneRowY)) {
      this.laneToggleMode = this.laneToggleMode === 'double' ? 'single' : 'double';
      this.saveLaneMode();
      this.game.sfx.playUIToggle();
      return true;
    }
    if (inRow(L.feedbackRowY)) {
      this.uiFeedbackEnabled = !this.uiFeedbackEnabled;
      this.saveUiFeedbackEnabled();
      this.game.sfx.playUIToggle();
      return true;
    }
    if (inRow(L.cameraSnapRowY)) {
      this.cameraSnapOnSelect = !this.cameraSnapOnSelect;
      this.saveGameplaySettings();
      this.game.sfx.playUIToggle();
      return true;
    }
    if (inRow(L.minimapRowY)) {
      this.minimapPanEnabled = !this.minimapPanEnabled;
      this.saveGameplaySettings();
      this.game.sfx.playUIToggle();
      return true;
    }
    if (inRow(L.stickyRowY)) {
      this.stickyBuildMode = !this.stickyBuildMode;
      this.saveGameplaySettings();
      this.game.sfx.playUIToggle();
      return true;
    }
    if (inRow(L.holdDelayRowY)) {
      this.radialArmMs = this.radialArmMs >= 500 ? 240 : this.radialArmMs + 40;
      this.saveRadialSettings();
      this.game.sfx.playUIToggle();
      return true;
    }
    if (inRow(L.radialSizeRowY)) {
      this.radialSize = this.radialSize >= 110 ? 60 : this.radialSize + 8;
      this.saveRadialSettings();
      this.game.sfx.playUIToggle();
      return true;
    }
    if (inRow(L.radialA11yRowY)) {
      this.radialAccessibility = !this.radialAccessibility;
      this.saveRadialSettings();
      this.game.sfx.playUIToggle();
      return true;
    }

    // Actions
    if (inRow(L.resetRowY)) {
      this.resetUiDefaults();
      return true;
    }
    if (this.onConcede && L.concedeRowY >= 0 && inRow(L.concedeRowY)) {
      this.settingsOpen = false;
      this.onConcede();
      return true;
    }
    if (inRow(L.quitRowY)) {
      this.settingsOpen = false;
      this.onQuitGame?.();
      return true;
    }

    return true; // consume click inside panel
  }

  private applySettingsSlider(cx: number, L: ReturnType<typeof InputHandler.prototype.getSettingsPanelLayout>): void {
    const rx = L.sx + L.pad;
    const rw = L.pw - L.pad * 2;
    const trackX = rx + 92;
    const trackW = rw - 100;
    const v = Math.max(0, Math.min(1, (cx - trackX) / trackW));
    if (this.settingsSliderDrag === 'music') {
      updateAudioSettings({ musicVolume: v });
      this.game.sfx.playUISlider();
    } else if (this.settingsSliderDrag === 'sfx') {
      updateAudioSettings({ sfxVolume: v });
      this.game.sfx.playUISlider();
    }
  }

  private eventToWorld(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    return this.camera.screenToWorld(canvasX, canvasY);
  }

  private setupKeyboard(): void {
    const sig = { signal: this.abortController.signal };
    window.addEventListener('keydown', (e) => {
      // During guided tutorial, block all keyboard shortcuts except Escape (settings)
      if (this.matchTutorialActive && e.key !== 'Escape') return;

      // Dev overlay
      if (e.key === '`') {
        this.devOverlayOpen = !this.devOverlayOpen;
        if (this.devOverlayOpen) this.devBalanceCache.lastRefresh = 0; // force refresh
        return;
      }
      // Nuke mode
      if (e.key === 'n' || e.key === 'N') {
        if (this.game.state.players[this.pid]?.nukeAvailable && !this.isNukeLocked()) {
          this.nukeTargeting = !this.nukeTargeting;
          this.selectedBuilding = null;
        }
        return;
      }

      if (e.key === '1') {
        this.nukeTargeting = false;
        this.abilityTargeting = false;
        this.abilityPlacing = false;
        this.clearSelection();
        if (this.selectedBuilding === BuildingType.HarvesterHut) {
          this.selectedBuilding = null;
        } else {
          this.selectedBuilding = BuildingType.HarvesterHut;
          if (this.cameraSnapOnSelect) this.panToHutArea();
        }
        return;
      }
      if (e.key === 'q' || e.key === 'Q') {
        if (!this.quickChatRadialActive) {
          this.quickChatRadialActive = true;
          this.quickChatRadialCenter = { x: this.canvas.clientWidth / 2, y: this.canvas.clientHeight / 2 };
          this.pointerX = this.quickChatRadialCenter.x;
          this.pointerY = this.quickChatRadialCenter.y;
        }
        return;
      }
      if (e.key === 'p' || e.key === 'P') {
        const wx = this.camera.x + this.canvas.clientWidth / (2 * this.camera.zoom);
        const wy = this.camera.y + this.canvas.clientHeight / (2 * this.camera.zoom);
        const pingTile = this.worldToTile(wx, wy);
        this.game.sendCommand({ type: 'ping', playerId: this.pid, x: pingTile.tileX, y: pingTile.tileY });
        return;
      }
      if (e.key === 'k' || e.key === 'K') {
        this.laneToggleMode = this.laneToggleMode === 'double' ? 'single' : 'double';
        this.saveLaneMode();
        return;
      }
      if (e.key === 'z' || e.key === 'Z') { this.sendQuickChat('Attack Left'); return; }
      if (e.key === 'x' || e.key === 'X') { this.sendQuickChat('Attack Right'); return; }
      if (e.key === 'c' || e.key === 'C') { this.sendQuickChat('Defend'); return; }
      if (e.key === 'v' || e.key === 'V') { this.sendQuickChat('Get Diamond'); return; }
      if (e.key === 'u' || e.key === 'U') {
        this.tryUpgradeHovered(false);
        return;
      }
      if (e.key === 'i' || e.key === 'I') {
        this.tryUpgradeHovered(true);
        return;
      }

      const item = BUILD_TRAY.find(b => b.key === e.key);
      if (item) {
        this.nukeTargeting = false;
        this.abilityTargeting = false;
        this.abilityPlacing = false;
        this.clearSelection();
        if (this.selectedBuilding === item.type) {
          this.selectedBuilding = null;
        } else {
          this.selectedBuilding = item.type;
          if (this.cameraSnapOnSelect) this.panToBuildArea(item.type);
        }
        return;
      }
      // Race ability key
      if (e.key === '6') {
        this.nukeTargeting = false;
        this.selectedBuilding = null;
        this.clearSelection();
        const player = this.game.state.players[this.pid];
        if (player) this.activateAbility(player);
        return;
      }
      // Research shortcut
      if (e.key === 'r' || e.key === 'R') {
        const st = this.game.state;
        const resBuilding = st.buildings.find(b => b.playerId === this.pid && b.type === BuildingType.Research);
        if (resBuilding) {
          if (this.researchPopup.isOpen()) { this.researchPopup.close(); }
          else { this.buildingPopup.close(); this.hutPopup.close(); this.seedPopup.close(); this.researchPopup.open(resBuilding.id); this.selectedBuildingId = resBuilding.id; }
        }
        return;
      }
      if (e.key === 'Escape') {
        if (this.researchPopup.isOpen()) { this.researchPopup.close(); return; }
        if (this.hutPopup.isOpen()) { this.hutPopup.close(); return; }
        if (this.seedPopup.isOpen()) { this.seedPopup.close(); return; }
        if (this.buildingPopup.isOpen()) { this.buildingPopup.close(); return; }
        if (this.showTutorial) { this.showTutorial = false; return; }
        this.quickChatRadialActive = false;
        this.quickChatRadialCenter = null;
        this.camera.dragDisabled = false;
        this.settingsOpen = false;
        this.settingsSliderDrag = null;
        this.selectedBuilding = null;
        this.nukeTargeting = false;
        this.abilityTargeting = false;
        this.abilityPlacing = false;
        this.clearSelection();
      }
      if (e.key === 'l' || e.key === 'L') {
        // Cancel any active rally override
        this.rallyOverride = null;
        this.rallyPrevLanes.clear();
        const myBuildings = this.game.state.buildings.filter(b => b.playerId === this.pid);
        const currentLane = myBuildings.length > 0 ? myBuildings[0].lane : Lane.Left;
        this.game.sendCommand({ type: 'toggle_all_lanes', playerId: this.pid, lane: currentLane === Lane.Left ? Lane.Right : Lane.Left });
      }
    }, sig);
    window.addEventListener('keyup', (e) => {
      if (e.key !== 'q' && e.key !== 'Q') return;
      if (!this.quickChatRadialActive) return;
      const msg = this.getQuickChatChoiceFromPointer();
      const radialCenter = this.quickChatRadialCenter;
      this.quickChatRadialActive = false;
      this.quickChatRadialCenter = null;
      this.camera.dragDisabled = false;
      if (msg) {
        if (msg === 'Ping') {
          const wp = radialCenter
            ? this.camera.screenToWorld(radialCenter.x, radialCenter.y)
            : { x: this.camera.x + this.canvas.clientWidth / (2 * this.camera.zoom),
                y: this.camera.y + this.canvas.clientHeight / (2 * this.camera.zoom) };
          const pingTile = this.worldToTile(wp.x, wp.y);
          this.game.sendCommand({ type: 'ping', playerId: this.pid, x: pingTile.tileX, y: pingTile.tileY });
          this.quickChatToast = { text: 'Sent: Ping', until: Date.now() + 700 };
        } else {
          this.sendQuickChat(msg);
        }
      }
    }, sig);
  }

  private setupMouse(): void {
    const sig = { signal: this.abortController.signal };
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.pointerX = e.clientX - rect.left;
      this.pointerY = e.clientY - rect.top;
      this.tooltip = null;
      this.hoveredBuildingId = null;
      this.hoveredUnitId = null;
      if (this.selectedBuilding !== null) {
        const world = this.eventToWorld(e);
        this.hoveredGridSlot = this.worldToGridSlot(this.pid, world.x, world.y);
      } else {
        this.hoveredGridSlot = null;
        const world = this.eventToWorld(e);
        const { tileX: wx, tileY: wy } = this.worldToTile(world.x, world.y);

        // Check for unit hover (closest within 1.2 tiles)
        const unit = this.findUnitNear(wx, wy, 1.2);
        if (unit) {
          this.hoveredUnitId = unit.id;
          // Skip tooltips on touch — synthetic mousemove before tap causes 1-frame flash
          if (!this.isTouchDevice) {
            this.tooltip = { text: this.getUnitTooltip(unit), x: e.clientX, y: e.clientY - 20 };
          }
        } else {
          // Check for building hover
          const tileX = Math.floor(wx);
          const tileY = Math.floor(wy);
          const building = this.game.state.buildings.find((b: { playerId: number; worldX: number; worldY: number }) =>
            b.playerId === this.pid && b.worldX === tileX && b.worldY === tileY
          );
          if (building) {
            this.hoveredBuildingId = building.id;
            if (!this.isTouchDevice) {
              this.tooltip = { text: this.getBuildingTooltip(building), x: e.clientX, y: e.clientY - 20 };
            }
          }
        }
      }
    }, sig);

    // Slider drag support for settings panel
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.settingsOpen) return;
      const rect = this.canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const L = this.getSettingsPanelLayout();
      const rx = L.sx + L.pad;
      const rw = L.pw - L.pad * 2;
      const inRow = (rowY: number) => cx >= rx && cx < rx + rw && cy >= L.sy + rowY && cy < L.sy + rowY + L.rowH;
      if (inRow(L.musicRowY)) {
        this.settingsSliderDrag = 'music';
        this.applySettingsSlider(cx, L);
        e.preventDefault();
      } else if (inRow(L.sfxRowY)) {
        this.settingsSliderDrag = 'sfx';
        this.applySettingsSlider(cx, L);
        e.preventDefault();
      }
    }, sig);

    this.canvas.addEventListener('pointermove', (e) => {
      // pointerType reliably distinguishes real mouse from touch-generated events
      if (e.pointerType === 'mouse') this.lastInputType = 'mouse';
      else if (e.pointerType === 'touch') this.lastInputType = 'touch';
      if (!this.settingsSliderDrag) return;
      const rect = this.canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      this.applySettingsSlider(cx, this.getSettingsPanelLayout());
      e.preventDefault();
    }, sig);

    this.canvas.addEventListener('pointerup', () => {
      if (this.settingsSliderDrag) {
        this.settingsSliderDrag = null;
        // Suppress the click event that fires after pointer up on a drag
        this.suppressClicksUntil = Date.now() + 50;
      }
    }, sig);

    this.canvas.addEventListener('pointercancel', () => {
      this.settingsSliderDrag = null;
    }, sig);

    this.canvas.addEventListener('click', (e) => {
      if (Date.now() < this.suppressClicksUntil) return;
      if (this.devOverlayOpen) { this.devOverlayOpen = false; return; }
      if (this.handleHelpButtonClick(e)) return;
      if (this.handleFollowBtnClick(e)) return;
      if (this.showTutorial) { this.handleTutorialClick(e); return; }
      if (this.mobileHintVisible) this.dismissMobileHint();

      // Guided tutorial click gate — blocks non-tutorial clicks.
      // Settings panel is exempt: always process settings clicks first.
      if (this.matchTutorialActive && isMatchTutorial()) {
        if (this.settingsOpen) {
          const sr = this.canvas.getBoundingClientRect();
          const scx = e.clientX - sr.left;
          const scy = e.clientY - sr.top;
          if (this.handleSettingsPanelClick(scx, scy)) return;
        }
        const trect = this.canvas.getBoundingClientRect();
        const tcx = e.clientX - trect.left;
        const tcy = e.clientY - trect.top;
        if (this.handleMatchTutorialClick(tcx, tcy)) return;
      }

      // UI panels consume click first (before minimap, so popups overlapping minimap work)
      if (this.handleUIClick(e)) return;

      // Minimap click → pan camera to that world position (blocked during tutorial)
      if (this.currentRenderer && !this.matchTutorialActive) {
        const rect = this.canvas.getBoundingClientRect();
        const hit = this.currentRenderer.minimapHitTest(e.clientX - rect.left, e.clientY - rect.top);
        if (hit) {
          if (this.minimapPanEnabled) this.camera.panTo(hit.worldX, hit.worldY);
          return;
        }
      }

      if (this.quickChatRadialActive) {
        const msg = this.getQuickChatChoiceFromPointer();
        this.quickChatRadialActive = false;
        this.quickChatRadialCenter = null;
        this.camera.dragDisabled = false;
        if (msg) {
          if (msg === 'Ping') {
            const wx = this.camera.x + this.canvas.clientWidth / (2 * this.camera.zoom);
            const wy = this.camera.y + this.canvas.clientHeight / (2 * this.camera.zoom);
            const pingTile = this.worldToTile(wx, wy);
            this.game.sendCommand({ type: 'ping', playerId: this.pid, x: pingTile.tileX, y: pingTile.tileY });
            this.quickChatToast = { text: 'Sent: Ping', until: Date.now() + 700 };
          } else {
            this.sendQuickChat(msg);
          }
        }
        return;
      }

      // Nuke targeting — restricted to own half + mid
      if (this.nukeTargeting) {
        const world = this.eventToWorld(e);
        const { tileX, tileY } = this.worldToTile(world.x, world.y);
        const team = this.game.state.players[this.pid]?.team ?? Team.Bottom;
        const md = this.game.state.mapDef;
        const nukeZone = md.nukeZone[team];
        const nukeAxis = md.shapeAxis === 'x' ? tileX : tileY;
        if (nukeAxis < nukeZone.min || nukeAxis > nukeZone.max) return; // click outside nuke zone — ignore
        this.game.sendCommand({
          type: 'fire_nuke', playerId: this.pid,
          x: tileX, y: tileY,
        });
        this.nukeTargeting = false;
        return;
      }

      // Ability targeting — targeted abilities (fireball, frenzy, summon)
      if (this.abilityTargeting) {
        const world = this.eventToWorld(e);
        const { tileX, tileY } = this.worldToTile(world.x, world.y);
        this.game.sendCommand({
          type: 'use_ability', playerId: this.pid,
          x: tileX, y: tileY,
        });
        this.abilityTargeting = false;
        return;
      }

      if (this.selectedBuilding === null) {
        this.handleBuildingClick(e);
        return;
      }

      const world = this.eventToWorld(e);
      const slot = this.worldToGridSlot(this.pid, world.x, world.y);
      if (slot) {
        if (this.abilityPlacing && slot.isAlley) {
          // BuildSlot ability: place ability building at chosen alley slot
          this.game.sendCommand({
            type: 'use_ability', playerId: this.pid,
            gridX: slot.gx, gridY: slot.gy,
          });
          if (!e.shiftKey && !this.stickyBuildMode) {
            this.abilityPlacing = false;
            this.selectedBuilding = null;
          }
        } else if (!this.abilityPlacing && slot.isHut && slot.hutSlot != null) {
          this.game.sendCommand({ type: 'build_hut', playerId: this.pid, hutSlot: slot.hutSlot });
          this.checkTutorialPlaceAdvance();
          if (!e.shiftKey && !this.stickyBuildMode) {
            this.selectedBuilding = null;
          }
        } else if (!this.abilityPlacing) {
          this.game.sendCommand({
            type: 'place_building', playerId: this.pid,
            buildingType: this.selectedBuilding, gridX: slot.gx, gridY: slot.gy,
            ...(slot.isAlley ? { gridType: 'alley' as const } : {}),
          });
          this.checkTutorialPlaceAdvance();
          if (!e.shiftKey && !this.stickyBuildMode) {
            this.selectedBuilding = null;
          }
        }
      }
    }, sig);

    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();

      // Block right-click during tutorial (prevents deselecting buildings)
      if (this.matchTutorialActive) return;

      if (this.quickChatRadialActive) {
        this.quickChatRadialActive = false;
        this.quickChatRadialCenter = null;
        this.camera.dragDisabled = false;
        return;
      }

      // If building mode, just deselect
      if (this.selectedBuilding !== null || this.nukeTargeting || this.abilityTargeting || this.abilityPlacing) {
        this.selectedBuilding = null;
        this.nukeTargeting = false;
        this.abilityTargeting = false;
        this.abilityPlacing = false;
        return;
      }
    }, sig);

    this.canvas.addEventListener('auxclick', (e) => {
      if (e.button !== 1 || this.showTutorial || this.matchTutorialActive) return;
      e.preventDefault();
      const world = this.eventToWorld(e as unknown as MouseEvent);
      const auxTile = this.worldToTile(world.x, world.y);
      this.game.sendCommand({
        type: 'ping', playerId: this.pid,
        x: auxTile.tileX, y: auxTile.tileY,
      });
    }, sig);

    // Touch long-press opens quick-chat radial on mobile.
    // Cancelled if finger moves (drag) or second finger arrives (pinch).
    const TOUCH_HOLD_MS = 400;
    const TOUCH_MOVE_THRESHOLD = 12; // px — cancel if finger drifts further

    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      this.lastInputType = 'touch';
      this.activeTouchPointers.add(e.pointerId);

      // Only start hold timer for single-finger touch, and not during UI interactions
      // Skip if touch is in the bottom tray area (build buttons, nuke, research, rally)
      const rect = this.canvas.getBoundingClientRect();
      const touchY = e.clientY - rect.top;
      const { milY: trayTop, nukeRect: nr } = this.getTrayLayout();
      const uiTop = Math.min(trayTop, nr.y); // top of nuke/research buttons
      const touchInUI = touchY >= uiTop;
      if (this.activeTouchPointers.size === 1 && !this.quickChatRadialActive
        && !touchInUI
        && !this.nukeTargeting && !this.abilityTargeting && !this.abilityPlacing
        && !this.settingsOpen && !this.showTutorial && !this.matchTutorialActive
        && !this.buildingPopup.isOpen() && !this.hutPopup.isOpen()
        && !this.researchPopup.isOpen() && !this.seedPopup.isOpen()) {
        this.touchHoldStart = { x: e.clientX, y: e.clientY, id: e.pointerId };
        this.touchHoldTimer = setTimeout(() => {
          if (this.touchHoldStart && this.activeTouchPointers.size === 1) {
            this.quickChatRadialActive = true;
            // Clamp radial center so all 8 labels stay on screen
            const margin = this.radialSize + (this.radialAccessibility ? 50 : 66);
            const cw = this.canvas.clientWidth;
            const ch = this.canvas.clientHeight;
            const clampedX = Math.max(margin, Math.min(cw - margin, this.touchHoldStart.x));
            const clampedY = Math.max(margin, Math.min(ch - margin, this.touchHoldStart.y));
            this.quickChatRadialCenter = { x: clampedX, y: clampedY };
            this.pointerX = clampedX;
            this.pointerY = clampedY;
            this.camera.dragDisabled = true;
            // Suppress the click that would fire on release
            this.suppressClicksUntil = Date.now() + 300;
            this.quickChatFeedback(true);
          }
          this.touchHoldTimer = null;
        }, TOUCH_HOLD_MS);
      } else {
        // Second finger = pinch, cancel hold and dismiss radial if open
        this.cancelTouchHold();
        if (this.quickChatRadialActive) {
          this.quickChatRadialActive = false;
          this.quickChatRadialCenter = null;
          this.camera.dragDisabled = false;
        }
      }
    }, sig);

    this.canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch') return;
      // If radial is open, update pointer for selection tracking
      if (this.quickChatRadialActive && this.quickChatRadialCenter) {
        this.pointerX = e.clientX;
        this.pointerY = e.clientY;
        return;
      }
      // Cancel hold timer if finger drifts
      if (this.touchHoldStart && e.pointerId === this.touchHoldStart.id) {
        const dx = e.clientX - this.touchHoldStart.x;
        const dy = e.clientY - this.touchHoldStart.y;
        if (Math.abs(dx) > TOUCH_MOVE_THRESHOLD || Math.abs(dy) > TOUCH_MOVE_THRESHOLD) {
          this.cancelTouchHold();
        }
      }
    }, sig);

    this.canvas.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'touch') return;
      this.activeTouchPointers.delete(e.pointerId);
      this.cancelTouchHold();
      // If radial is open, send the selected message on release
      if (this.quickChatRadialActive) {
        const msg = this.getQuickChatChoiceFromPointer();
        const radialCenter = this.quickChatRadialCenter;
        this.quickChatRadialActive = false;
        this.quickChatRadialCenter = null;
        this.camera.dragDisabled = false;
        // Suppress the synthetic click that mobile browsers fire after touchend
        this.suppressClicksUntil = Date.now() + 400;
        if (msg) {
          if (msg === 'Ping') {
            const wp = radialCenter
              ? this.camera.screenToWorld(radialCenter.x, radialCenter.y)
              : { x: this.camera.x + this.canvas.clientWidth / (2 * this.camera.zoom),
                  y: this.camera.y + this.canvas.clientHeight / (2 * this.camera.zoom) };
            const pingTile = this.worldToTile(wp.x, wp.y);
            this.game.sendCommand({ type: 'ping', playerId: this.pid, x: pingTile.tileX, y: pingTile.tileY });
            this.quickChatToast = { text: 'Sent: Ping', until: Date.now() + 700 };
          } else {
            this.sendQuickChat(msg);
          }
        }
      }
    }, sig);

    this.canvas.addEventListener('pointercancel', () => {
      this.activeTouchPointers.clear();
      this.cancelTouchHold();
      if (this.quickChatRadialActive) {
        this.quickChatRadialActive = false;
        this.quickChatRadialCenter = null;
        this.camera.dragDisabled = false;
      }
    }, sig);
  }

  /** Pan camera to the build area for a given building type */
  private panToBuildArea(type: BuildingType): void {
    if (type === BuildingType.Tower) {
      const team = this.game.state.players[this.pid]?.team ?? Team.Bottom;
      const alley = getTeamAlleyOrigin(team, this.game.state.mapDef);
      const { px: cx, py: cy } = this.tp(alley.x + this.game.state.mapDef.towerAlleyCols / 2, alley.y + this.game.state.mapDef.towerAlleyRows / 2);
      this.camera.panTo(cx, cy, 1.8);
    } else {
      const origin = getBuildGridOrigin(this.pid, this.game.state.mapDef, this.game.state.players);
      const { px: cx, py: cy } = this.tp(origin.x + this.game.state.mapDef.buildGridCols / 2, origin.y + this.game.state.mapDef.buildGridRows / 2);
      this.camera.panTo(cx, cy, 1.8);
    }
  }

  /** Pan camera to the harvester hut area */
  private panToHutArea(): void {
    const origin = getHutGridOrigin(this.pid, this.game.state.mapDef, this.game.state.players);
    const { px: cx, py: cy } = this.tp(origin.x + this.game.state.mapDef.hutGridCols / 2, origin.y + this.game.state.mapDef.hutGridRows / 2);
    this.camera.panTo(cx, cy, 1.8);
  }

  private worldToGridSlot(playerId: number, worldPixelX: number, worldPixelY: number): { gx: number; gy: number; isAlley: boolean; isHut?: boolean; hutSlot?: number } | null {
    const { tileX: txF, tileY: tyF } = this.worldToTile(worldPixelX, worldPixelY);
    const tx = Math.floor(txF);
    const ty = Math.floor(tyF);

    // Check shared tower alley first (for Tower type or ability BuildSlot placement)
    if (this.selectedBuilding === BuildingType.Tower || this.abilityPlacing) {
      const team = this.game.state.players[playerId]?.team ?? Team.Bottom;
      const alley = getTeamAlleyOrigin(team, this.game.state.mapDef);
      const agx = tx - alley.x, agy = ty - alley.y;
      if (agx >= 0 && agx < this.game.state.mapDef.towerAlleyCols && agy >= 0 && agy < this.game.state.mapDef.towerAlleyRows) {
        return { gx: agx, gy: agy, isAlley: true };
      }
    }

    // Hut grid
    if (this.selectedBuilding === BuildingType.HarvesterHut) {
      const origin = getHutGridOrigin(playerId, this.game.state.mapDef, this.game.state.players);
      const hgx = tx - origin.x, hgy = ty - origin.y;
      const hutCols = this.game.state.mapDef.hutGridCols;
      const hutRows = this.game.state.mapDef.hutGridRows;
      if (hgx >= 0 && hgx < hutCols && hgy >= 0 && hgy < hutRows) {
        const hutSlot = hgy * hutCols + hgx;
        return { gx: hgx, gy: hgy, isAlley: false, isHut: true, hutSlot };
      }
      return null;
    }

    // Military grid
    const origin = getBuildGridOrigin(playerId, this.game.state.mapDef, this.game.state.players);
    const gx = tx - origin.x, gy = ty - origin.y;
    if (gx < 0 || gx >= this.game.state.mapDef.buildGridCols || gy < 0 || gy >= this.game.state.mapDef.buildGridRows) return null;
    return { gx, gy, isAlley: false };
  }

  private handleBuildingClick(e: MouseEvent): void {
    const world = this.eventToWorld(e);
    const { tileX: tileXf, tileY: tileYf } = this.worldToTile(world.x, world.y);
    const tileX = Math.floor(tileXf);
    const tileY = Math.floor(tileYf);
    let building = this.game.state.buildings.find(b =>
      b.playerId === this.pid && b.worldX === tileX && b.worldY === tileY
    );
    // Research is 2x size — expand click area
    if (!building) {
      building = this.game.state.buildings.find(b =>
        b.playerId === this.pid && b.type === BuildingType.Research &&
        Math.abs(b.worldX - tileX) <= 1 && Math.abs(b.worldY - tileY) <= 1
      ) ?? undefined;
    }
    if (!building) {
      // Click outside building: close popup if open, try selecting a unit
      if (this.researchPopup.isOpen()) {
        this.researchPopup.close();
      }
      if (this.buildingPopup.isOpen()) {
        this.buildingPopup.close();
      }
      if (this.hutPopup.isOpen()) {
        this.hutPopup.close();
      }
      if (this.seedPopup.isOpen()) {
        this.seedPopup.close();
      }
      const wx = tileXf;
      const wy = tileYf;
      const unit = this.findUnitNear(wx, wy, 1.2);
      this.selectedUnitId = unit ? unit.id : null;
      this.selectedHarvesterId = null;
      if (unit) {
        this.cameraFollowing = true;
        const { px: upx, py: upy } = this.tp(unit.x, unit.y);
        this.camera.followTargetX = upx;
        this.camera.followTargetY = upy;
      } else {
        this.cameraFollowing = false;
        this.camera.followTargetX = null;
        this.camera.followTargetY = null;
      }
      return;
    }
    this.clearSelection();
    this.selectedBuildingId = building.id;

    // Click on research: open research popup
    if (building.type === BuildingType.Research) {
      this.buildingPopup.close();
      this.researchPopup.open(building.id);
      this.game.sfx.playUIOpen();
      return;
    }

    // Click on hut: open hut popup
    if (building.type === BuildingType.HarvesterHut) {
      this.buildingPopup.close();
      this.researchPopup.close();
      this.hutPopup.open(building.id);
      this.game.sfx.playUIOpen();
      return;
    }

    // Click on seed: open seed popup
    if (building.isSeed) {
      this.buildingPopup.close();
      this.researchPopup.close();
      this.hutPopup.close();
      this.seedPopup.open(building.id);
      this.game.sfx.playUIOpen();
      return;
    }

    // Skip popup for special ability buildings (no upgrades)
    if (building.isFoundry || building.isPotionShop || building.isGlobule) return;

    // Open building popup for spawners and towers
    this.hutPopup.close();
    this.seedPopup.close();
    this.buildingPopup.open(building.id, this.isTouchDevice);
    this.game.sfx.playUIOpen();
  }

  private getUpgradeChoice(building: { type: BuildingType; upgradePath: string[] }, alternate: boolean): string | null {
    if (building.type === BuildingType.HarvesterHut) return null;
    if (building.upgradePath.length === 1 && building.upgradePath[0] === 'A') {
      return alternate ? 'C' : 'B';
    }
    if (building.upgradePath.length === 2) {
      if (building.upgradePath[1] === 'B') return alternate ? 'E' : 'D';
      if (building.upgradePath[1] === 'C') return alternate ? 'G' : 'F';
    }
    return null;
  }

  private tryUpgradeHovered(alternate: boolean): void {
    const panelBuilding = this.getPanelBuilding();
    const building = panelBuilding ?? (this.hoveredBuildingId === null ? null :
      this.game.state.buildings.find(b => b.id === this.hoveredBuildingId && b.playerId === this.pid) ?? null);
    if (!building) return;
    const choice = this.getUpgradeChoice(building, alternate);
    if (!choice) return;
    this.game.sendCommand({
      type: 'purchase_upgrade', playerId: this.pid, buildingId: building.id, choice,
    });
  }

  private getQuickChatChoiceFromPointer(): string | null {
    if (!this.quickChatRadialCenter) return null;
    const dx = this.pointerX - this.quickChatRadialCenter.x;
    const dy = this.pointerY - this.quickChatRadialCenter.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 18) return 'Defend';
    // 8-sector radial: use angle to determine sector
    const angle = Math.atan2(dy, dx); // -PI to PI
    // Sectors: right=0, down-right=PI/4, down=PI/2, etc.
    // Normalize to 0..2PI
    const a = angle < 0 ? angle + Math.PI * 2 : angle;
    const sector = Math.round(a / (Math.PI / 4)) % 8;
    // 0=right, 1=down-right, 2=down, 3=down-left, 4=left, 5=up-left, 6=up, 7=up-right
    switch (sector) {
      case 0: return 'Attack Right';
      case 1: return 'Sending Now';
      case 2: return 'Defend';
      case 3: return 'Save Us';
      case 4: return 'Attack Left';
      case 5: return 'Random';
      case 6: return 'Get Diamond';
      case 7: return 'Ping';
      default: return 'Defend';
    }
  }

  private sendQuickChat(message: string): boolean {
    const now = Date.now();
    if (now < this.quickChatCooldownUntil) {
      this.quickChatFeedback(false);
      this.quickChatToast = { text: `Chat ready in ${((this.quickChatCooldownUntil - now) / 1000).toFixed(1)}s`, until: now + 900 };
      return false;
    }
    this.quickChatCooldownUntil = now + 1200;
    this.quickChatFeedback(true);
    this.quickChatToast = { text: `Sent: ${message}`, until: now + 700 };
    this.game.sendCommand({ type: 'quick_chat', playerId: this.pid, message });
    return true;
  }

  private drawTutorial(ctx: CanvasRenderingContext2D): void {
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    const compact = W < 920 || H < 760;

    // Dim background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.82)';
    ctx.fillRect(0, 0, W, H);

    const pw = Math.min(W - 12, 800);
    const ph = Math.min(H - 12, compact ? 700 : 800);
    const px = (W - pw) / 2;
    const py = (H - ph) / 2 - 20;

    // Panel background - SpecialPaper 9-slice
    if (!this.ui.drawSpecialPaper(ctx, px, py, pw, ph)) {
      ctx.fillStyle = 'rgba(10, 12, 18, 0.97)';
      ctx.fillRect(px, py, pw, ph);
      ctx.strokeStyle = '#2979ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(px, py, pw, ph);
    }

    // Inset past the 9-slice decorative corner borders
    const inset = Math.max(28, Math.min(pw, ph) * 0.07);
    const lp = px + inset;
    const rp = px + pw - inset;
    let y = py + inset + (compact ? 4 : 8);
    const lh = compact ? 17 : 20;
    const headingSize = compact ? 14 : 16;
    const bodySize = compact ? 12 : 14;
    const closeSize = compact ? 28 : 32;

    const maxTextW = rp - lp;
    const heading = (label: string, color = '#2979ff') => {
      ctx.fillStyle = color;
      ctx.font = `bold ${headingSize}px monospace`;
      ctx.fillText(label, lp, y);
      y += lh + (compact ? 1 : 3);
    };
    const line = (body: string, color = '#aaa') => {
      ctx.fillStyle = color;
      ctx.font = `${bodySize}px monospace`;
      // Word-wrap if text exceeds available width
      if (ctx.measureText(body).width <= maxTextW) {
        ctx.fillText(body, lp, y);
        y += lh;
      } else {
        const words = body.split(' ');
        let cur = '';
        for (const word of words) {
          const test = cur ? cur + ' ' + word : word;
          if (ctx.measureText(test).width > maxTextW && cur) {
            ctx.fillText(cur, lp, y);
            y += lh;
            cur = word;
          } else {
            cur = test;
          }
        }
        if (cur) { ctx.fillText(cur, lp, y); y += lh; }
      }
    };
    const rule = () => {
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(lp, y - 4);
      ctx.lineTo(rp, y - 4);
      ctx.stroke();
      y += compact ? 2 : 4;
    };

    const touch = this.isTouchDevice;

    heading('LANECRAFT', '#fff');
    line('Destroy enemy HQ or bring the Diamond home to win.', '#ccc');
    y += compact ? 0 : 2;
    rule();

    heading('THE MAP');
    line('Bottom base is yours, top base is enemy.');
    line('Lanes merge, split around center, then merge again.');
    line('Gold near HQ; wood left tip; meat right tip.');
    y += compact ? 0 : 2;
    rule();

    heading('BUILD');
    if (touch) {
      line('Tap build buttons at bottom to place buildings.', '#eee');
      line('Long-press own building to sell after cooldown.', '#eee');
      line('Tap a building to open upgrades.', '#eee');
    } else {
      line('[1] miner hut, [2-5] buildings, [6] ability.', '#eee');
      line('Right-click own building to sell after cooldown.', '#eee');
      line('[U]/[I] upgrades selected or hovered building.', '#eee');
    }
    y += compact ? 0 : 2;
    rule();

    heading('COMBAT & LANES');
    line('Units auto-aggro nearby enemies and fight.');
    if (touch) {
      line('Tap a spawner to toggle its lane.', '#eee');
    } else {
      line('Click spawner toggles lane (Fast or Safe tap mode).');
      line('[L] flips all spawners; [N] arms nuke; [5] race ability.');
    }
    y += compact ? 0 : 2;
    rule();

    heading('CENTER');
    line('Mine center cells to expose the Diamond.');
    line('Carry Diamond to your HQ for instant win.');
    y += compact ? 0 : 2;
    rule();

    heading(touch ? 'CONTROLS' : 'HOTKEYS', '#ff9800');
    if (touch) {
      line('Drag to pan, pinch to zoom.');
      line('Hold map to open chat wheel.');
      line('Tap nuke/ability buttons in the HUD.');
    } else {
      line('[P/MMB] ping  [Q] chat wheel  [Z/X/C/V] quick chat');
      line('[WASD/drag] pan  [Scroll] zoom  [Esc] cancel');
      line('[L] flip all lanes  [N] arm nuke  [5] race ability');
    }
    line('Press [H] to toggle controls overlay.', '#9bb7ff');

    // "Don't show on game start" checkbox
    y += compact ? 4 : 8;
    const cbSize = compact ? 14 : 16;
    const cbX = lp;
    const cbY = y - cbSize + 2;
    ctx.strokeStyle = '#9bb7ff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cbX, cbY, cbSize, cbSize);
    if (this.hideTutorialOnStart) {
      ctx.fillStyle = '#2979ff';
      ctx.fillRect(cbX + 2, cbY + 2, cbSize - 4, cbSize - 4);
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${cbSize - 2}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('✓', cbX + cbSize / 2, cbY + cbSize - 2);
      ctx.textAlign = 'start';
    }
    ctx.fillStyle = '#aaa';
    ctx.font = `${bodySize}px monospace`;
    ctx.fillText("Don't show on game start", cbX + cbSize + 8, y);
    this.tutorialCheckboxRect = { x: cbX, y: cbY, w: ctx.measureText("Don't show on game start").width + cbSize + 8, h: cbSize };

    const btnX = px + pw - closeSize - inset;
    const btnY = py + inset;
    // Close button — red round button with icon_09
    this.ui.drawSmallRedRoundButton(ctx, btnX, btnY, closeSize);
    this.ui.drawIcon(ctx, 'close', btnX + closeSize / 2 - 10, btnY + closeSize / 2 - 10, 20);
    this.tutorialCloseRect = { x: btnX, y: btnY, w: closeSize, h: closeSize };

  }

  private handleTutorialClick(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const cb = this.tutorialCheckboxRect;
    if (cb && cx >= cb.x && cx <= cb.x + cb.w && cy >= cb.y && cy <= cb.y + cb.h) {
      this.hideTutorialOnStart = !this.hideTutorialOnStart;
      localStorage.setItem('lanecraft.hideTutorial', this.hideTutorialOnStart ? 'true' : 'false');
      return;
    }
    const cl = this.tutorialCloseRect;
    if (cl && cx >= cl.x && cx <= cl.x + cl.w && cy >= cl.y && cy <= cl.y + cl.h) {
      this.showTutorial = false;
    }
  }

  // ── Guided match tutorial (step-by-step overlay) ──

  private getMatchTutorialHighlightRect(): { x: number; y: number; w: number; h: number } | null {
    const info = getMatchPopupInfo();
    if (!info) return null;
    const { milY, milH, milW, nukeRect, researchRect } = this.getTrayLayout();

    // Tray column highlight
    if (info.trayCol >= 0) {
      return { x: info.trayCol * milW, y: milY, w: milW, h: milH };
    }
    // Floating button highlight
    if (info.floatingButton === 'nuke') return nukeRect;
    if (info.floatingButton === 'research') return researchRect;
    // Settings button highlight
    if (info.arrowToSettings) {
      return this.getSettingsButtonRect();
    }
    return null;
  }

  /** Per-frame tutorial state update — handles timeout auto-advance.
   *  Called once at the start of render(), before any drawing. */
  private updateMatchTutorial(): void {
    if (!this.matchTutorialActive) return;
    // Auto-advance after timeout so players can't get stuck
    if (performance.now() - this.tutorialStepStartTime > TUTORIAL_TIMEOUT_MS) {
      advanceTutorial();
      this.tutorialStepStartTime = performance.now();
      // Re-derive active state after advance
      this.matchTutorialActive = isMatchTutorial();
    }
  }

  private drawMatchTutorial(ctx: CanvasRenderingContext2D): void {
    if (!this.matchTutorialActive) return;

    const info = getMatchPopupInfo();
    if (!info) return;

    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    const highlightRect = this.getMatchTutorialHighlightRect();
    const isPlacementStep = info.highlightGrid !== 'none';
    const pad = 6;

    // During placement steps (place_builder/melee/tower), skip the dark overlay
    // so the player can see the game world and grid slots.
    // For UI-targeted steps (click_builder/melee/tower, match_done), spotlight the element.
    if (!isPlacementStep) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
      if (highlightRect) {
        const hx = highlightRect.x - pad;
        const hy = highlightRect.y - pad;
        const hw = highlightRect.w + pad * 2;
        const hh = highlightRect.h + pad * 2;
        if (hy > 0) ctx.fillRect(0, 0, W, hy);
        if (hy + hh < H) ctx.fillRect(0, hy + hh, W, H - (hy + hh));
        if (hx > 0) ctx.fillRect(0, hy, hx, hh);
        if (hx + hw < W) ctx.fillRect(hx + hw, hy, W - (hx + hw), hh);
        const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 400);
        ctx.strokeStyle = `rgba(100, 200, 255, ${pulse})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        (ctx as any).roundRect(hx, hy, hw, hh, 8);
        ctx.stroke();
      } else {
        ctx.fillRect(0, 0, W, H);
      }
    }

    // Popup bubble — anchored at top during placement so it doesn't cover the build grid
    const bodyLines = info.body.split('\n');
    const popupW = Math.min(300, W - 40);
    // Dynamic height: title + body lines + skip link + padding
    const popupH = isPlacementStep
      ? 22 + bodyLines.length * 15 + 18
      : 28 + 10 + bodyLines.length * 18 + 10 + 16 + 10;
    let popupX = (W - popupW) / 2;
    let popupY: number;
    if (isPlacementStep) {
      popupY = getSafeTop() + 8;
    } else if (highlightRect && highlightRect.y > H / 2) {
      popupY = highlightRect.y - popupH - 30;
    } else if (highlightRect) {
      popupY = highlightRect.y + highlightRect.h + 20;
    } else {
      popupY = H * 0.35;
    }
    popupY = Math.max(getSafeTop() + 4, Math.min(popupY, H - popupH - 10));

    // Draw popup background
    ctx.fillStyle = 'rgba(20, 15, 10, 0.92)';
    ctx.beginPath();
    (ctx as any).roundRect(popupX, popupY, popupW, popupH, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(180, 150, 100, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    (ctx as any).roundRect(popupX, popupY, popupW, popupH, 10);
    ctx.stroke();

    // Arrow pointing to highlight (not during placement steps)
    if (highlightRect && !isPlacementStep) {
      const arrowX = Math.max(popupX + 20, Math.min(highlightRect.x + highlightRect.w / 2, popupX + popupW - 20));
      const arrowY = highlightRect.y > H / 2 ? popupY + popupH : popupY;
      const arrowDir = highlightRect.y > H / 2 ? 1 : -1;
      ctx.fillStyle = 'rgba(20, 15, 10, 0.92)';
      ctx.beginPath();
      ctx.moveTo(arrowX - 10, arrowY);
      ctx.lineTo(arrowX, arrowY + 12 * arrowDir);
      ctx.lineTo(arrowX + 10, arrowY);
      ctx.closePath();
      ctx.fill();
    }

    // Title + body — compact layout for placement steps
    const titleY = isPlacementStep ? popupY + 22 : popupY + 28;
    const bodyStartY = isPlacementStep ? popupY + 40 : popupY + 52;
    const bodyLineH = isPlacementStep ? 15 : 18;

    ctx.fillStyle = '#ffd740';
    ctx.font = isPlacementStep ? 'bold 15px monospace' : 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(info.title, popupX + popupW / 2, titleY);

    ctx.fillStyle = '#e0e0e0';
    ctx.font = isPlacementStep ? '12px monospace' : '14px monospace';
    const lines = info.body.split('\n');
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], popupX + popupW / 2, bodyStartY + i * bodyLineH);
    }

    // Skip button (top-right of popup)
    const skipW = 50;
    const skipH = 22;
    const skipX = popupX + popupW - skipW - 8;
    const skipY = popupY + 6;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.beginPath();
    (ctx as any).roundRect(skipX, skipY, skipW, skipH, 4);
    ctx.fill();
    ctx.fillStyle = '#aaa';
    ctx.font = '12px monospace';
    ctx.fillText('Skip', skipX + skipW / 2, skipY + 15);
    this.tutorialSkipRect = { x: skipX, y: skipY, w: skipW, h: skipH };

    // Skip Tutorial link (bottom of popup)
    ctx.fillStyle = '#777';
    ctx.font = '11px monospace';
    ctx.fillText('Skip Tutorial', popupX + popupW / 2, popupY + popupH - 8);
    const skipAllTextW = ctx.measureText('Skip Tutorial').width;
    this.tutorialSkipAllRect = {
      x: popupX + popupW / 2 - skipAllTextW / 2,
      y: popupY + popupH - 20,
      w: skipAllTextW,
      h: 16,
    };

    ctx.textAlign = 'start';
  }

  private handleMatchTutorialClick(cx: number, cy: number): boolean {
    if (!this.matchTutorialActive || !isMatchTutorial()) return false;
    const step = getTutorialStep();

    // Skip button
    if (this.tutorialSkipRect) {
      const r = this.tutorialSkipRect;
      if (cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h) {
        advanceTutorial();
        this.tutorialStepStartTime = performance.now();
        this.matchTutorialActive = isMatchTutorial();
        return true;
      }
    }
    // Skip Tutorial link
    if (this.tutorialSkipAllRect) {
      const r = this.tutorialSkipAllRect;
      if (cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h) {
        skipTutorial();
        this.matchTutorialActive = false;
        return true;
      }
    }

    // Info steps (show_research, show_nuke, match_done): any click dismisses
    if (step === 'show_research' || step === 'show_nuke' || step === 'match_done') {
      advanceTutorial();
      this.tutorialStepStartTime = performance.now();
      this.matchTutorialActive = isMatchTutorial();
      return true;
    }

    // For click_* steps: only allow clicking the highlighted tray button
    // For place_* steps: allow clicking the grid + tray
    const info = getMatchPopupInfo();
    if (!info) return false;

    if (info.trayCol >= 0) {
      // Only allow clicking the highlighted tray column
      const { milY, milH, milW } = this.getTrayLayout();
      const colX = info.trayCol * milW;
      if (cx >= colX && cx < colX + milW && cy >= milY && cy < milY + milH) {
        return false; // Let normal tray click handler process it
      }
      return true; // Block all other clicks
    }

    if (info.highlightGrid !== 'none') {
      // During placement steps, allow ONLY:
      // 1. Build tray clicks (to re-select building type)
      // 2. World area clicks (for grid placement)
      // Block floating buttons (nuke, research, rally), minimap, popups.
      const { milY, milH } = this.getTrayLayout();
      if (cy >= milY && cy < milY + milH) {
        return false; // Tray click — allow
      }
      if (cy < milY) {
        // World area — but block floating buttons above tray.
        // Floating buttons sit at milY - 76 to milY. Nuke/research/rally are all there.
        const { nukeRect, researchRect, rallyLeftRect, rallyRandomRect, rallyRightRect } = this.getTrayLayout();
        const inRect = (r: { x: number; y: number; w: number; h: number }) =>
          cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h;
        if (inRect(nukeRect) || inRect(researchRect) ||
            inRect(rallyLeftRect) || inRect(rallyRandomRect) || inRect(rallyRightRect)) {
          return true; // Block floating button clicks
        }
        return false; // World click — allow for grid placement
      }
      return true; // Below tray (safe area) — block
    }

    return true; // Block by default
  }

  /** Called after a tray button is successfully clicked during tutorial. */
  private checkTutorialTrayAdvance(): void {
    if (!this.matchTutorialActive) return;
    const step = getTutorialStep();
    if (step === 'click_builder' && this.selectedBuilding === BuildingType.HarvesterHut) {
      advanceTutorial();
      this.tutorialStepStartTime = performance.now();
    } else if (step === 'click_melee' && this.selectedBuilding === BuildingType.MeleeSpawner) {
      advanceTutorial();
      this.tutorialStepStartTime = performance.now();
    } else if (step === 'click_tower' && this.selectedBuilding === BuildingType.Tower) {
      advanceTutorial();
      this.tutorialStepStartTime = performance.now();
    }
  }

  /** Called after a building is successfully placed during tutorial. */
  private checkTutorialPlaceAdvance(): void {
    if (!this.matchTutorialActive) return;
    const step = getTutorialStep();
    if (step === 'place_builder' || step === 'place_melee' || step === 'place_tower') {
      advanceTutorial();
      this.tutorialStepStartTime = performance.now();
      if (!isMatchTutorial()) this.matchTutorialActive = false;
    }
  }

  // Top-right layout (right to left): [⚙ settings] [ℹ info] [★ mvp] [ping]
  // Gap between buttons: 8px. Ping displayed as text to the left of mvp button.
  private getSettingsButtonRect(): { x: number; y: number; w: number; h: number } {
    const size = 30;
    return { x: this.canvas.clientWidth - size - 10, y: 10 + getSafeTop(), w: size, h: size };
  }

  private getMvpButtonRect(): { x: number; y: number; w: number; h: number } {
    const size = 30;
    const sr = this.getSettingsButtonRect();
    return { x: sr.x - size - 12, y: sr.y, w: size, h: size };
  }

  private handleFollowBtnClick(e: MouseEvent): boolean {
    if (!this.followBtnRect) return false;
    if (this.selectedUnitId === null && this.selectedHarvesterId === null) return false;
    const rect = this.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const b = this.followBtnRect;
    if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) {
      this.cameraFollowing = !this.cameraFollowing;
      if (this.cameraFollowing) {
        let wx: number | null = null, wy: number | null = null;
        if (this.selectedUnitId !== null) {
          const u = this.game.state.units.find(u => u.id === this.selectedUnitId);
          if (u) { wx = u.x; wy = u.y; }
        } else if (this.selectedHarvesterId !== null) {
          const h = this.game.state.harvesters.find(h => h.id === this.selectedHarvesterId);
          if (h) { wx = h.x; wy = h.y; }
        }
        if (wx !== null && wy !== null) {
          const { px: fpx, py: fpy } = this.tp(wx, wy);
          this.camera.followTargetX = fpx;
          this.camera.followTargetY = fpy;
          this.camera.panTo(fpx, fpy);
        }
      } else {
        this.camera.followTargetX = null;
        this.camera.followTargetY = null;
      }
      return true;
    }
    return false;
  }

  private handleHelpButtonClick(e: MouseEvent): boolean {
    const rect = this.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    // Settings button (far-right corner)
    const sr = this.getSettingsButtonRect();
    if (cx >= sr.x && cx <= sr.x + sr.w && cy >= sr.y && cy <= sr.y + sr.h) {
      this.settingsOpen = !this.settingsOpen;
      this.showTutorial = false;
      if (this.settingsOpen) this.game.sfx.playUIOpen();
      else this.game.sfx.playUIClose();
      return true;
    }

    // MVP button (to the left of settings) — select unit with most kills
    const mr = this.getMvpButtonRect();
    if (cx >= mr.x && cx <= mr.x + mr.w && cy >= mr.y && cy <= mr.y + mr.h) {
      this.selectMvpUnit();
      return true;
    }

    return false;
  }

  private drawHelpButton(ctx: CanvasRenderingContext2D): void {
    // Settings button (far-right corner)
    const sr = this.getSettingsButtonRect();
    if (this.settingsOpen) {
      ctx.fillStyle = 'rgba(41,121,255,0.35)';
      ctx.fillRect(sr.x, sr.y, sr.w, sr.h);
    }
    if (!this.ui.drawIcon(ctx, 'settings', sr.x, sr.y, sr.w)) {
      ctx.fillStyle = 'rgba(18,18,18,0.92)';
      ctx.fillRect(sr.x, sr.y, sr.w, sr.h);
      ctx.strokeStyle = '#9bb7ff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sr.x, sr.y, sr.w, sr.h);
      ctx.fillStyle = '#e3f2fd';
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('⚙', sr.x + sr.w / 2, sr.y + 21);
      ctx.textAlign = 'start';
    }

    // MVP button (to the left of settings) — select top killer
    const mr = this.getMvpButtonRect();
    const hasKiller = this.game.state.units.some(u => u.team === this.myTeam && u.kills > 0);
    if (!hasKiller) {
      ctx.globalAlpha = 0.4;
    }
    if (!this.ui.drawIcon(ctx, 'star', mr.x, mr.y, mr.w)) {
      ctx.fillStyle = 'rgba(18,18,18,0.92)';
      ctx.fillRect(mr.x, mr.y, mr.w, mr.h);
      ctx.strokeStyle = hasKiller ? '#ffd700' : '#555';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(mr.x, mr.y, mr.w, mr.h);
      ctx.fillStyle = hasKiller ? '#ffd700' : '#666';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('★', mr.x + mr.w / 2, mr.y + 20);
      ctx.textAlign = 'start';
    }
    ctx.globalAlpha = 1.0;

    // Ping display (to the left of mvp button, right-aligned)
    if (this.networkLatencyMs !== undefined) {
      const latText = `${this.networkLatencyMs}ms`;
      const latColor = this.networkLatencyMs < 80 ? '#4caf50' : this.networkLatencyMs < 200 ? '#ff9800' : '#f44336';
      ctx.font = 'bold 12px monospace';
      const latW = ctx.measureText(latText).width;
      const pingX = mr.x - latW - 12;
      const pingY = mr.y + mr.h / 2 + 4;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(pingX - 4, mr.y + 4, latW + 8, mr.h - 8);
      ctx.fillStyle = latColor;
      ctx.fillText(latText, pingX, pingY);
    }
  }

  private getTrayLayout() {
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    const safeBottom = getSafeBottom();
    const milH = 68;
    const milY = H - milH - safeBottom;
    // Miner button + 4 military + race ability = 6 buttons total
    const milW = W / 6;
    // Floating nuke button above miner (col 0)
    const nukeW = Math.round(milW * 0.95);
    const nukeH = 72;
    const nukeX = Math.round((milW - nukeW) / 2);
    const nukeY = milY - nukeH - 4;
    const nukeRect = { x: nukeX, y: nukeY, w: nukeW, h: nukeH };
    // Floating research button above ability (col 5) — mirrors nuke
    const researchRect = { x: Math.round(5 * milW + (milW - nukeW) / 2), y: nukeY, w: nukeW, h: nukeH };
    // Rally buttons — centered above tray, same size as research/nuke buttons
    const rallyBtnW = nukeW;
    const rallyBtnH = nukeH;
    const rallyGap = 8;
    const rallyTotalW = rallyBtnW * 3 + rallyGap * 2;
    const rallyX0 = Math.round((W - rallyTotalW) / 2);
    const rallyY = nukeY;
    const rallyLeftRect = { x: rallyX0, y: rallyY, w: rallyBtnW, h: rallyBtnH };
    const rallyRandomRect = { x: rallyX0 + rallyBtnW + rallyGap, y: rallyY, w: rallyBtnW, h: rallyBtnH };
    const rallyRightRect = { x: rallyX0 + (rallyBtnW + rallyGap) * 2, y: rallyY, w: rallyBtnW, h: rallyBtnH };
    return { W, H, milH, milY, milW, safeBottom, nukeRect, researchRect, rallyLeftRect, rallyRandomRect, rallyRightRect };
  }

  private cancelTouchHold(): void {
    if (this.touchHoldTimer !== null) {
      clearTimeout(this.touchHoldTimer);
      this.touchHoldTimer = null;
    }
    this.touchHoldStart = null;
  }

  private processQueuedQuickChat(): void {
    if (!this.queuedQuickChat) return;
    const now = Date.now();
    if (now < this.queuedQuickChat.at) return;
    if (now < this.quickChatCooldownUntil) {
      this.queuedQuickChat.at = this.quickChatCooldownUntil + 20;
      return;
    }
    const msg = this.queuedQuickChat.message;
    if (this.sendQuickChat(msg)) {
      this.queuedQuickChat = null;
    } else {
      this.queuedQuickChat.at = this.quickChatCooldownUntil + 20;
    }
  }

  private getHoveredOwnedBuilding() {
    if (this.hoveredBuildingId === null) return null;
    return this.game.state.buildings.find(b => b.id === this.hoveredBuildingId && b.playerId === this.pid) ?? null;
  }

  private getSelectedOwnedBuilding() {
    if (this.selectedBuildingId === null) return null;
    const found = this.game.state.buildings.find(b => b.id === this.selectedBuildingId && b.playerId === this.pid) ?? null;
    if (!found) this.selectedBuildingId = null;
    return found;
  }

  private getPanelBuilding() {
    return this.getSelectedOwnedBuilding() ?? this.getHoveredOwnedBuilding();
  }

  // Returns true if click was consumed by a UI panel
  private handleUIClick(e: MouseEvent): boolean {
    const { milH, milY, milW } = this.getTrayLayout();
    const rect = this.canvas.getBoundingClientRect();
    const popupCx = e.clientX - rect.left;
    const popupCy = e.clientY - rect.top;

    // Research popup takes priority
    if (this.researchPopup.isOpen()) {
      const result = this.researchPopup.handleClick(popupCx, popupCy);
      if (result) {
        if (result.action === 'upgrade') {
          this.game.sendCommand({ type: 'research_upgrade', playerId: this.pid, upgradeId: result.upgradeId });
          this.game.sfx.playUIConfirm();
        } else if (result.action === 'close') {
          this.researchPopup.close();
          this.game.sfx.playUIClose();
        }
        return true;
      }
      if (this.researchPopup.containsPoint(popupCx, popupCy)) {
        this.game.sfx.playUITab(); // tab switch or consumed click inside popup
        return true;
      }
      this.researchPopup.close();
      this.game.sfx.playUIClose();
    }

    // Building popup takes priority
    if (this.buildingPopup.isOpen()) {
      const result = this.buildingPopup.handleClick(popupCx, popupCy, this.isTouchDevice);
      if (result) {
        const bId = this.buildingPopup.getBuildingId();
        if (bId !== null) {
          if (result.action === 'upgrade') {
            this.game.sendCommand({ type: 'purchase_upgrade', playerId: this.pid, buildingId: bId, choice: result.choice });
            this.game.sfx.playUIConfirm();
          } else if (result.action === 'sell') {
            this.game.sendCommand({ type: 'sell_building', playerId: this.pid, buildingId: bId });
            this.buildingPopup.close();
            this.game.sfx.playUIClick();
          } else if (result.action === 'toggle_lane') {
            const b = this.game.state.buildings.find(b => b.id === bId);
            if (b) {
              if (this.game.state.players[this.pid]?.race === Race.Oozlings) {
                this.laneToast = { text: 'Ooze Must Ooze', until: Date.now() + 1500 };
              } else {
                // Cancel rally override when manually toggling a building
                this.rallyOverride = null;
                this.rallyPrevLanes.clear();
                const nextLane = b.lane === Lane.Left ? Lane.Right : Lane.Left;
                this.game.sendCommand({ type: 'toggle_lane', playerId: this.pid, buildingId: bId, lane: nextLane });
                this.game.sfx.playUIToggle();
              }
            }
          } else if (result.action === 'close') {
            this.buildingPopup.close();
            this.game.sfx.playUIClose();
          }
        }
        return true;
      }
      // Click inside popup but not on a button
      if (this.buildingPopup.containsPoint(popupCx, popupCy)) return true;
      // Click outside popup — close it
      this.buildingPopup.close();
      this.game.sfx.playUIClose();
    }

    // Hut popup takes priority
    if (this.hutPopup.isOpen()) {
      const result = this.hutPopup.handleClick(popupCx, popupCy);
      if (result) {
        const bId = this.hutPopup.getBuildingId();
        if (bId !== null) {
          if (result.action === 'assign') {
            this.game.sendCommand({
              type: 'set_hut_assignment', playerId: this.pid,
              hutId: bId, assignment: result.assignment,
            });
            this.game.sfx.playUIClick();
          } else if (result.action === 'center_builder') {
            const h = this.game.state.harvesters.find(h => h.hutId === bId);
            if (h) {
              this.selectedUnitId = null;
              this.selectedHarvesterId = h.id;
              this.cameraFollowing = true;
              const { px: hpx, py: hpy } = this.tp(h.x, h.y);
              this.camera.panTo(hpx, hpy);
              this.camera.followTargetX = hpx;
              this.camera.followTargetY = hpy;
            }
            this.hutPopup.close();
            this.game.sfx.playUIClick();
          } else if (result.action === 'close') {
            this.hutPopup.close();
            this.game.sfx.playUIClose();
          }
        }
        return true;
      }
      // Click inside popup but not on a button
      if (this.hutPopup.containsPoint(popupCx, popupCy)) return true;
      // Click outside popup — close it
      this.hutPopup.close();
      this.game.sfx.playUIClose();
    }

    // Seed popup
    if (this.seedPopup.isOpen()) {
      const result = this.seedPopup.handleClickWithState(popupCx, popupCy, this.game.state, this.pid);
      if (result) {
        if (result.action === 'upgrade') {
          this.game.sendCommand({
            type: 'use_ability', playerId: this.pid,
            gridX: result.gridX, gridY: result.gridY,
          });
          this.game.sfx.playUIConfirm();
        } else if (result.action === 'close') {
          this.seedPopup.close();
          this.game.sfx.playUIClose();
        }
        return true;
      }
      if (this.seedPopup.containsPoint(popupCx, popupCy)) return true;
      this.seedPopup.close();
      this.game.sfx.playUIClose();
    }
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const player = this.game.state.players[this.pid];

    // (PING/CHAT utility button hit tests removed)

    if (this.mobileHintVisible) {
      const hx = 10;
      const hy = milY - 56;
      const hw = 280;
      const hh = 22;
      if (cx >= hx && cx < hx + hw && cy >= hy && cy < hy + hh) {
        this.dismissMobileHint();
        return true;
      }
    }

    if (this.settingsOpen) {
      if (this.handleSettingsPanelClick(cx, cy)) return true;
    }

    // Consume taps in safe area bar below tray (rounded phone corners)
    if (cy >= milY + milH) return true;

    // Floating nuke button (above miner)
    const { nukeRect, researchRect, rallyLeftRect, rallyRandomRect, rallyRightRect } = this.getTrayLayout();
    if (cx >= nukeRect.x && cx < nukeRect.x + nukeRect.w &&
        cy >= nukeRect.y && cy < nukeRect.y + nukeRect.h) {
      if (player.nukeAvailable && !this.isNukeLocked()) {
        this.selectedBuilding = null;
        this.nukeTargeting = !this.nukeTargeting;
        this.game.sfx.playUIClick();
      }
      return true;
    }

    // Floating research button (above ability)
    if (cx >= researchRect.x && cx < researchRect.x + researchRect.w &&
        cy >= researchRect.y && cy < researchRect.y + researchRect.h) {
      const resBuilding = this.game.state.buildings.find(
        b => b.playerId === this.pid && b.type === BuildingType.Research
      );
      if (resBuilding) {
        if (this.researchPopup.isOpen()) {
          this.researchPopup.close();
        } else {
          this.buildingPopup.close();
          this.hutPopup.close();
          this.seedPopup.close();
          this.researchPopup.open(resBuilding.id);
          this.selectedBuildingId = resBuilding.id;
          this.game.sfx.playUIOpen();
        }
      }
      return true;
    }

    // Rally override buttons (above tray, centered)
    if (player.race !== Race.Oozlings) {
      const hitRect = (r: { x: number; y: number; w: number; h: number }) =>
        cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h;
      const hitLeft = hitRect(rallyLeftRect);
      const hitRandom = hitRect(rallyRandomRect);
      const hitRight = hitRect(rallyRightRect);
      if (hitLeft || hitRight || hitRandom) {
        this.game.sfx.playUIClick();
        const target: Lane | 'random' = hitLeft ? Lane.Left : hitRight ? Lane.Right : 'random';
        if (this.rallyOverride === target) {
          // Cancel — restore previous lanes
          for (const b of this.game.state.buildings) {
            if (b.playerId === this.pid && b.type !== BuildingType.Tower) {
              const prev = this.rallyPrevLanes.get(b.id);
              if (prev !== undefined) {
                this.game.sendCommand({ type: 'toggle_lane', playerId: this.pid, buildingId: b.id, lane: prev });
              }
            }
          }
          this.rallyOverride = null;
          this.rallyPrevLanes.clear();
        } else {
          // Activate — save current lanes then override all
          this.rallyPrevLanes.clear();
          for (const b of this.game.state.buildings) {
            if (b.playerId === this.pid && b.type !== BuildingType.Tower) {
              this.rallyPrevLanes.set(b.id, b.lane);
            }
          }
          this.rallyOverride = target;
          if (target === 'random') {
            // Randomly assign each spawner to left or right
            for (const b of this.game.state.buildings) {
              if (b.playerId === this.pid && b.type !== BuildingType.Tower) {
                const lane = Math.random() < 0.5 ? Lane.Left : Lane.Right;
                this.game.sendCommand({ type: 'toggle_lane', playerId: this.pid, buildingId: b.id, lane });
              }
            }
          } else {
            this.game.sendCommand({ type: 'toggle_all_lanes', playerId: this.pid, lane: target });
          }
        }
        return true;
      }
    }

    if (cy >= milY && cy < milY + milH) {
      const colIdx = Math.floor(cx / milW);
      if (colIdx === 0) {
        // Miner button — select-then-place flow
        this.nukeTargeting = false;
        this.abilityTargeting = false;
        this.abilityPlacing = false;
        this.clearSelection();
        if (this.selectedBuilding === BuildingType.HarvesterHut) {
          this.selectedBuilding = null;
        } else {
          this.selectedBuilding = BuildingType.HarvesterHut;
          if (this.cameraSnapOnSelect) this.panToHutArea();
        }
      } else if (colIdx >= 1 && colIdx <= BUILD_TRAY.length) {
        const item = BUILD_TRAY[colIdx - 1];
        this.nukeTargeting = false;
        this.abilityTargeting = false;
        this.abilityPlacing = false;
        this.clearSelection();
        if (this.selectedBuilding === item.type) {
          this.selectedBuilding = null;
        } else {
          this.selectedBuilding = item.type;
          if (this.cameraSnapOnSelect) this.panToBuildArea(item.type);
        }
      } else if (colIdx === BUILD_TRAY.length + 1) {
        // Race ability button
        this.nukeTargeting = false;
        this.selectedBuilding = null;
        this.clearSelection();
        this.activateAbility(player);
      }
      this.game.sfx.playUIClick();
      this.checkTutorialTrayAdvance();
      return true;
    }

    return false;
  }

  render(renderer: Renderer, networkLatencyMs?: number): void {
    this.currentRenderer = renderer;
    this.networkLatencyMs = networkLatencyMs;
    if (!this.sprites) this.sprites = renderer.sprites;
    this.trayTick++;
    this.processQueuedQuickChat();

    // Snapshot tutorial state once per frame to avoid mid-frame inconsistency
    refreshTutorialCache();
    this.matchTutorialActive = isMatchTutorial();
    this.updateMatchTutorial();
    // Suppress old tutorial popup when guided tutorial is active
    if (this.matchTutorialActive) this.showTutorial = false;

    const ctx = renderer.ctx;
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    this.drawBuildTray(ctx);
    this.drawHelpButton(ctx);

    if (this.showTutorial) {
      this.drawTutorial(ctx);
      return; // don't draw other overlays while tutorial is open
    }

    // Guided match tutorial overlay (drawn on top of tray, below other popups)
    if (this.matchTutorialActive) {
      this.drawMatchTutorial(ctx);
    }

    if (this.quickChatRadialActive) {
      this.drawQuickChatRadial(ctx);
    }

    if (this.selectedBuilding !== null) {
      this.drawPlacementHighlight(ctx, renderer);
      if (this.hoveredGridSlot) {
        this.drawPlacementPreview(ctx, renderer);
      }
      this.drawBuildTooltip(ctx, renderer);
    } else if (this.abilityTargeting) {
      this.drawBuildTooltip(ctx, renderer);
    }

    // Hovered unit highlight ring
    if (this.hoveredUnitId !== null && this.hoveredUnitId !== this.selectedUnitId) {
      const hu = this.game.state.units.find(u => u.id === this.hoveredUnitId);
      if (hu) {
        ctx.save();
        renderer.camera.applyTransform(ctx);
        const { px: hpx0, py: hpy0 } = this.tp(hu.x, hu.y);
        const hpx = hpx0 + TILE_SIZE / 2;
        const hpy = hpy0 + TILE_SIZE / 2;
        ctx.beginPath();
        ctx.arc(hpx, hpy, TILE_SIZE * 0.55, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
        ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
      }
    }

    // Selected unit highlight + info panel
    this.drawSelectedUnit(ctx, renderer);

    if (this.nukeTargeting) {
      this.drawNukeOverlay(ctx);
    }

    if (this.abilityTargeting) {
      this.drawAbilityOverlay(ctx);
    }

    if (this.tooltip) {
      // Hide tooltip when any popup is open — it overlaps menus
      const anyPopupOpen = this.buildingPopup.isOpen() || this.hutPopup.isOpen()
        || this.seedPopup.isOpen() || this.researchPopup.isOpen();
      if (!anyPopupOpen) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
        ctx.font = '14px monospace';
        const w = ctx.measureText(this.tooltip.text).width + 16;
        ctx.fillRect(this.tooltip.x - w / 2, this.tooltip.y - 18, w, 24);
        ctx.fillStyle = '#ddd';
        ctx.textAlign = 'center';
        ctx.fillText(this.tooltip.text, this.tooltip.x, this.tooltip.y);
        ctx.textAlign = 'start';
      }
    }

    if (this.devOverlayOpen) {
      this.drawDevOverlay(ctx);
    }
  }

  private drawBuildTray(ctx: CanvasRenderingContext2D): void {
    const { W, milH, milY, milW, safeBottom, nukeRect, researchRect } = this.getTrayLayout();
    const player = this.game.state.players[this.pid];
    const quickChatCdMs = Math.max(0, this.quickChatCooldownUntil - Date.now());

    // Safe area bar below tray for rounded phone corners
    if (safeBottom > 0) {
      ctx.fillStyle = '#1a1008';
      ctx.fillRect(0, milY + milH, W, safeBottom);
    }

    // Build tray background - WoodTable 9-slice (30% wider to hide edge dead space)
    const trayOverW = Math.round(W * 0.15);
    if (!this.ui.drawWoodTable(ctx, -trayOverW, milY, W + trayOverW * 2, milH)) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
      ctx.fillRect(0, milY, W, milH);
    }

    // (PING/CHAT utility buttons removed — accessible via Q key / radial on desktop)
    // --- Helper: draw colorized cost parts with resource icons ---
    const costIconSize = 14;
    const drawCost = (parts: { val: number; type: 'g' | 'w' | 's' }[], cx: number, cy: number, affordable: boolean) => {
      const goldColor = affordable ? '#ffd740' : '#665500';
      const woodColor = affordable ? '#81c784' : '#2e5530';
      const meatColor = affordable ? '#e57373' : '#6d2828';
      ctx.font = 'bold 11px monospace';
      const gap = 4;
      // Calculate total width: icon + number for each part
      let totalW = 0;
      const valStrs = parts.map(p => `${p.val}`);
      for (let j = 0; j < parts.length; j++) {
        totalW += costIconSize + 1 + ctx.measureText(valStrs[j]).width;
        if (j < parts.length - 1) totalW += gap;
      }
      let drawX = cx - totalW / 2;
      for (let j = 0; j < parts.length; j++) {
        const iconName = parts[j].type === 'g' ? 'gold' : parts[j].type === 'w' ? 'wood' : 'meat';
        const iconAlpha = affordable ? 1 : 0.4;
        ctx.globalAlpha = iconAlpha;
        this.ui.drawIcon(ctx, iconName as any, drawX, cy - costIconSize + 2, costIconSize);
        ctx.globalAlpha = 1;
        drawX += costIconSize + 1;
        ctx.fillStyle = parts[j].type === 'g' ? goldColor : parts[j].type === 'w' ? woodColor : meatColor;
        ctx.textAlign = 'left';
        ctx.fillText(valStrs[j], drawX, cy);
        drawX += ctx.measureText(valStrs[j]).width + gap;
      }
    };

    // === Shared cell drawing helper ===
    const race = player.race;
    const spriteSize = Math.round(milH * 0.52); // sprite fits in top portion
    const spriteBaseY = milY + spriteSize + 2; // shared ground line for bottom-anchoring
    const selectedRaise = 6; // pixels to raise selected cell

    const drawCell = (
      cellX: number, isSelected: boolean, canAfford: boolean,
      name: string, spriteCategory: 'melee' | 'ranged' | 'caster' | 'tower' | 'miner',
      costParts: { val: number; type: 'g' | 'w' | 's' }[] | null,
      freeText: string | null,
      keyHint: string,
    ) => {
      const cellY = isSelected ? milY - selectedRaise : milY;
      const cellH = isSelected ? milH + selectedRaise : milH;

      // Cell background
      ctx.fillStyle = isSelected ? 'rgba(41, 121, 255, 0.28)' : 'rgba(28, 28, 28, 0.9)';
      ctx.fillRect(cellX + 1, cellY + 1, milW - 2, cellH - 2);
      ctx.strokeStyle = isSelected ? '#2979ff' : (canAfford ? '#555' : '#333');
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeRect(cellX + 1, cellY + 1, milW - 2, cellH - 2);

      // Sprite (centered horizontally, bottom-anchored)
      const cellCx = cellX + milW / 2;
      const adjBaseY = isSelected ? spriteBaseY - selectedRaise : spriteBaseY;

      if (spriteCategory === 'tower') {
        // Use race-specific building sprite for tower (cached to avoid per-frame table walk)
        const cacheKey = `tower:${race}`;
        let towerImg = this.trayBldgSpriteCache.get(cacheKey);
        if (towerImg === undefined) { towerImg = this.sprites?.getBuildingSprite(BuildingType.Tower, 0, false, race) ?? null; if (towerImg) this.trayBldgSpriteCache.set(cacheKey, towerImg); }
        if (towerImg) {
          const aspect = towerImg.width / towerImg.height;
          const dh = spriteSize;
          const dw = dh * aspect;
          ctx.drawImage(towerImg, Math.round(cellCx - dw / 2), Math.round(adjBaseY - dh), dw, dh);
        }
      } else if (spriteCategory === 'miner') {
        // Use race-specific building sprite for harvester hut (cached)
        const cacheKey = `hut:${race}`;
        let hutImg = this.trayBldgSpriteCache.get(cacheKey);
        if (hutImg === undefined) { hutImg = this.sprites?.getBuildingSprite(BuildingType.HarvesterHut, 0, true, race) ?? null; if (hutImg) this.trayBldgSpriteCache.set(cacheKey, hutImg); }
        if (hutImg) {
          const aspect = hutImg.width / hutImg.height;
          const dh = spriteSize;
          const dw = dh * aspect;
          ctx.drawImage(hutImg, Math.round(cellCx - dw / 2), Math.round(adjBaseY - dh), dw, dh);
        }
      } else {
        // Unit character sprite
        const sprData = this.sprites?.getUnitSprite(race, spriteCategory, 0);
        if (sprData) {
          const [img, def] = sprData;
          const frame = isSelected ? getSpriteFrame(Math.floor(this.trayTick / 3), def) : 0;
          const aspect = def.frameW / def.frameH;
          const dh = spriteSize;
          const dw = dh * aspect;
          drawSpriteFrame(ctx, img, def, frame, Math.round(cellCx - dw / 2), Math.round(adjBaseY - dh * (def.groundY ?? 0.71)), dw, dh);
        }
      }

      // Name (truncate with ellipsis if too wide for cell)
      const textY = adjBaseY + 3;
      ctx.textAlign = 'center';
      ctx.fillStyle = canAfford ? '#eee' : '#666';
      ctx.font = 'bold 11px monospace';
      let displayName = name;
      const maxNameW = milW - 4;
      if (ctx.measureText(displayName).width > maxNameW) {
        while (displayName.length > 1 && ctx.measureText(displayName + '…').width > maxNameW) {
          displayName = displayName.slice(0, -1);
        }
        displayName += '…';
      }
      ctx.fillText(displayName, cellCx, textY + 10);

      // Cost or free text
      if (freeText) {
        ctx.fillStyle = '#4caf50'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
        ctx.fillText(freeText, cellCx, textY + 24);
      } else if (costParts && costParts.length > 0) {
        drawCost(costParts, cellCx, textY + 24, canAfford);
      }

      // Key hint — bottom-right of cell (hidden on touch devices)
      if (!this.isTouchDevice) {
        ctx.fillStyle = '#444'; ctx.font = '11px monospace'; ctx.textAlign = 'right';
        ctx.fillText(`[${keyHint}]`, cellX + milW - 4, cellY + cellH - 4);
      }
    };

    // === Miner button (col 0) ===
    const myHuts = this.game.state.buildings.filter(
      b => b.playerId === this.pid && b.type === BuildingType.HarvesterHut
    );
    const hutBase = RACE_BUILDING_COSTS[player.race][BuildingType.HarvesterHut];
    const hutMult = Math.pow(1.35, Math.max(0, myHuts.length - 1));
    const hutGold = Math.floor(hutBase.gold * hutMult);
    const hutWood = Math.floor(hutBase.wood * hutMult);
    const hutMeat = Math.floor(hutBase.meat * hutMult);
    const canAffordHut = player.gold >= hutGold && player.wood >= hutWood && player.meat >= hutMeat && myHuts.length < 10;
    const hutCostItems: { val: number; type: 'g' | 'w' | 's' }[] = [];
    if (hutGold > 0) hutCostItems.push({ val: hutGold, type: 'g' });
    if (hutWood > 0) hutCostItems.push({ val: hutWood, type: 'w' });
    if (hutMeat > 0) hutCostItems.push({ val: hutMeat, type: 's' });
    const hutSelected = this.selectedBuilding === BuildingType.HarvesterHut;
    drawCell(0, hutSelected, canAffordHut, 'Miner', 'miner',
      myHuts.length < 10 ? hutCostItems : null,
      myHuts.length >= 10 ? 'MAX' : null, '1');

    // === Military buttons (cols 1-4) ===
    for (let i = 0; i < BUILD_TRAY.length; i++) {
      const item = BUILD_TRAY[i];
      const bx = (i + 1) * milW;
      const isSelected = this.selectedBuilding === item.type && !this.abilityPlacing;
      const baseCost = RACE_BUILDING_COSTS[race][item.type];
      const isFirstTowerFree = item.type === BuildingType.Tower && !player.hasBuiltTower;

      // Escalating tower cost: each tower after the first costs TOWER_COST_SCALE more
      let cost = baseCost;
      if (item.type === BuildingType.Tower && !isFirstTowerFree) {
        const myTowers = this.game.state.buildings.filter(b => b.playerId === this.pid && b.type === BuildingType.Tower && !isAbilityBuilding(b)).length;
        const mult = Math.pow(TOWER_COST_SCALE, Math.max(0, myTowers - 1));
        cost = {
          gold: Math.floor(baseCost.gold * mult),
          wood: Math.floor(baseCost.wood * mult),
          meat: Math.floor(baseCost.meat * mult),
          hp: baseCost.hp,
        };
      }

      const canAfford = isFirstTowerFree || (player.gold >= cost.gold && player.wood >= cost.wood && player.meat >= cost.meat);

      let unitName: string;
      let category: 'melee' | 'ranged' | 'caster' | 'tower';
      if (item.type === BuildingType.Tower) {
        unitName = 'Tower'; category = 'tower';
      } else {
        const stats = UNIT_STATS[race]?.[item.type];
        unitName = stats?.name ?? item.label;
        category = item.type === BuildingType.MeleeSpawner ? 'melee'
          : item.type === BuildingType.RangedSpawner ? 'ranged' : 'caster';
      }

      const costItems: { val: number; type: 'g' | 'w' | 's' }[] = [];
      if (!isFirstTowerFree) {
        if (cost.gold > 0) costItems.push({ val: cost.gold, type: 'g' });
        if (cost.wood > 0) costItems.push({ val: cost.wood, type: 'w' });
        if (cost.meat > 0) costItems.push({ val: cost.meat, type: 's' });
      }

      drawCell(bx, isSelected, canAfford, unitName, category,
        isFirstTowerFree ? null : costItems,
        isFirstTowerFree ? 'FREE' : null, item.key);
    }

    // === Race Ability button (col 5) ===
    {
      const abilityInfo = RACE_ABILITY_INFO[race];
      const abDef = RACE_ABILITY_DEFS[race];
      const abX = (BUILD_TRAY.length + 1) * milW;
      const isTendersSeeds = race === Race.Tenders;
      const seedStacks = player.abilityStacks ?? 0;
      const onCooldown = isTendersSeeds ? seedStacks <= 0 : player.abilityCooldown > 0;
      const isActive = this.abilityTargeting || this.abilityPlacing;

      // Calculate current cost for display (non-Tenders)
      const growMult = abDef.costGrowthFactor ? Math.pow(abDef.costGrowthFactor, player.abilityUseCount) : 1;
      // Apply ability cost modifiers from research upgrades (centralised in data.ts)
      const abMod = ABILITY_COST_MODIFIERS[race];
      const abHasMod = abMod && player.researchUpgrades.raceUpgrades[abMod.upgradeId];
      const abGoldMult = abHasMod && (abMod.field === 'gold' || abMod.field === 'all') ? abMod.mult : 1;
      const abWoodMult = abHasMod && (abMod.field === 'wood' || abMod.field === 'all') ? abMod.mult : 1;
      const abMeatMult = abHasMod && (abMod.field === 'meat' || abMod.field === 'all') ? abMod.mult : 1;
      const abCostGold = Math.floor((abDef.baseCost.gold ?? 0) * growMult * abGoldMult);
      const abCostWood = Math.floor((abDef.baseCost.wood ?? 0) * growMult * abWoodMult);
      const abCostMeat = Math.floor((abDef.baseCost.meat ?? 0) * growMult * abMeatMult);
      const abCostMana = Math.floor((abDef.baseCost.mana ?? 0) * growMult);
      const abCostSouls = player.race === Race.Geists
        ? (abDef.baseCost.souls ?? 0) + 5 * player.abilityUseCount
        : Math.floor((abDef.baseCost.souls ?? 0) * growMult);
      const abCostEssence = Math.floor((abDef.baseCost.deathEssence ?? 0) * growMult);
      const canAffordAbility = isTendersSeeds ? seedStacks > 0 : (!onCooldown &&
        player.gold >= abCostGold && player.wood >= abCostWood && player.meat >= abCostMeat &&
        player.mana >= abCostMana && player.souls >= abCostSouls && player.deathEssence >= abCostEssence);

      const cellY = isActive ? milY - 6 : milY;
      const cellH = isActive ? milH + 6 : milH;

      // Cell background
      ctx.fillStyle = isActive ? 'rgba(126, 87, 194, 0.35)' : (onCooldown ? 'rgba(28, 28, 28, 0.6)' : 'rgba(28, 28, 28, 0.9)');
      ctx.fillRect(abX + 1, cellY + 1, milW - 2, cellH - 2);
      ctx.strokeStyle = isActive ? '#b39ddb' : (canAffordAbility ? '#7e57c2' : '#444');
      ctx.lineWidth = isActive ? 2 : 1;
      ctx.strokeRect(abX + 1, cellY + 1, milW - 2, cellH - 2);

      const abCx = abX + milW / 2;
      const adjY = isActive ? milY - 6 : milY;
      const abBaseY = isActive ? spriteBaseY - 6 : spriteBaseY;
      const abTextY = abBaseY + 3;

      // Ability icon — try unit sprite for Horde troll, else canvas-drawn
      ctx.globalAlpha = (onCooldown || !canAffordAbility) ? 0.4 : 1;
      ctx.textAlign = 'center';
      let drewSprite = false;
      if (this.sprites) {
        if (race === Race.Crown) {
          // Draw foundry building sprite
          const foundryImg = this.sprites.getRaceBuildingSprite(Race.Crown, 'foundry') ?? this.sprites.getFoundrySprite();
          if (foundryImg) {
            const aspect = foundryImg.width / foundryImg.height;
            const dh = spriteSize;
            const dw = dh * aspect;
            ctx.drawImage(foundryImg, Math.round(abCx - dw / 2), Math.round(abBaseY - dh), dw, dh);
            drewSprite = true;
          }
        } else if (race === Race.Horde) {
          // Draw troll sprite (Goblin melee E = Troll Warlord)
          const trollData = this.sprites.getUnitSprite(Race.Goblins, 'melee', 0, isActive, 'E');
          if (trollData) {
            const [img, def] = trollData;
            const frame = isActive ? getSpriteFrame(Math.floor(this.trayTick / 3), def) : 0;
            const iconH = spriteSize;
            const aspect = def.frameW / def.frameH;
            const iconW = iconH * aspect;
            drawSpriteFrame(ctx, img, def, frame, Math.round(abCx - iconW / 2), Math.round(abBaseY - iconH * (def.groundY ?? 0.71)), iconW, iconH);
            drewSprite = true;
          }
        } else if (race === Race.Goblins) {
          // Draw potion shop building sprite
          const potionShopImg = this.sprites.getRaceBuildingSprite(Race.Goblins, 'potionshop');
          if (potionShopImg) {
            const aspect = potionShopImg.width / potionShopImg.height;
            const dh = spriteSize;
            const dw = dh * aspect;
            ctx.drawImage(potionShopImg, Math.round(abCx - dw / 2), Math.round(abBaseY - dh), dw, dh);
            drewSprite = true;
          } else {
            // Fallback: green potion sprite
            const potionData = this.sprites.getPotionSprite('green');
            if (potionData) {
              const [img, def] = potionData;
              const frame = isActive ? getSpriteFrame(Math.floor(this.trayTick / 3), def) : 0;
              const dh = spriteSize;
              const aspect = def.frameW / def.frameH;
              const dw = dh * aspect;
              drawSpriteFrame(ctx, img, def, frame, Math.round(abCx - dw / 2), Math.round(abBaseY - dh * (def.groundY ?? 0.9)), dw, dh);
              drewSprite = true;
            }
          }
        } else if (race === Race.Oozlings) {
          // Draw ooze mound sprite (Lvl05 Move animation)
          const globData = this.sprites.getGlobuleIdleSprite();
          if (globData) {
            const [img, def] = globData;
            const frame = isActive ? getSpriteFrame(Math.floor(this.trayTick / 4), def) : 0;
            const dh = spriteSize;
            const aspect = def.frameW / def.frameH;
            const dw = dh * aspect;
            drawSpriteFrame(ctx, img, def, frame, Math.round(abCx - dw / 2), Math.round(abBaseY - dh * (def.groundY ?? 0.93)), dw, dh);
            drewSprite = true;
          }
        } else if (race === Race.Demon) {
          // Draw fireball orb sprite (yellow/orange)
          const orbData = this.sprites.getOrbSprite(Race.Demon);
          if (orbData) {
            const [img, def] = orbData;
            const frame = isActive ? Math.floor(this.trayTick / 2) % def.totalFrames : 0;
            const dh = spriteSize;
            const dw = dh;
            drawGridFrame(ctx, img, def, frame, Math.round(abCx - dw / 2), Math.round(abBaseY - dh), dw, dh);
            drewSprite = true;
          }
        } else if (race === Race.Tenders) {
          // Draw seed plant sprite
          const seedData = this.sprites.getSeedSprite();
          if (seedData) {
            const [img, def] = seedData;
            const frame = isActive ? getSpriteFrame(Math.floor(this.trayTick / 3), def) : 0;
            const dh = spriteSize;
            const aspect = def.frameW / def.frameH;
            const dw = dh * aspect;
            drawSpriteFrame(ctx, img, def, frame, Math.round(abCx - dw / 2), Math.round(abBaseY - dh * (def.groundY ?? 0.9)), dw, dh);
            drewSprite = true;
          }
        }
      }
      if (!drewSprite) {
        this.drawAbilityIcon(ctx, race, abCx, adjY + 4, 20);
      }
      // Ability name (truncate with ellipsis if too wide for cell)
      ctx.fillStyle = (onCooldown || !canAffordAbility) ? '#888' : '#e1bee7';
      ctx.font = 'bold 11px monospace';
      let abDisplayName = abilityInfo.name;
      const maxAbNameW = milW - 4;
      if (ctx.measureText(abDisplayName).width > maxAbNameW) {
        while (abDisplayName.length > 1 && ctx.measureText(abDisplayName + '…').width > maxAbNameW) {
          abDisplayName = abDisplayName.slice(0, -1);
        }
        abDisplayName += '…';
      }
      ctx.fillText(abDisplayName, abCx, abTextY + 10);
      ctx.globalAlpha = 1;

      // Tenders: show stack count in bottom-left, cooldown timer when 0 stacks
      if (isTendersSeeds) {
        if (seedStacks > 0) {
          // Stack count in bottom-left corner
          ctx.textAlign = 'left';
          ctx.font = 'bold 11px monospace';
          ctx.fillStyle = seedStacks >= 10 ? '#ffd740' : '#81c784';
          ctx.fillText(`${seedStacks}`, abX + 4, adjY + cellH - 4);
          ctx.textAlign = 'center';
          // Key hint in bottom-right (hidden on touch devices)
          if (!this.isTouchDevice) {
            ctx.fillStyle = '#666';
            ctx.font = '11px monospace'; ctx.textAlign = 'right';
            ctx.fillText(`[${abilityInfo.key}]`, abX + milW - 4, adjY + cellH - 4);
          }
        } else {
          // No stacks — show countdown timer (like cooldown)
          const secsLeft = Math.ceil(player.abilityCooldown / TICK_RATE);
          ctx.fillStyle = '#ff9800';
          ctx.font = 'bold 11px monospace';
          ctx.fillText(`${secsLeft}s`, abCx, adjY + cellH - 4);
          // Stack count "0" in bottom-left
          ctx.textAlign = 'left';
          ctx.font = 'bold 11px monospace';
          ctx.fillStyle = '#666';
          ctx.fillText('0', abX + 4, adjY + cellH - 4);
        }
        ctx.textAlign = 'center';
      } else {
        // Cost display — icons + numbers, no letter abbreviations
        if (!onCooldown) {
          type AbCostEntry = { val: number; canAf: boolean; drawIcon: (ix: number, iy: number, sz: number) => void };
          const abCostEntries: AbCostEntry[] = [];
          if (abCostGold > 0) abCostEntries.push({ val: abCostGold, canAf: player.gold >= abCostGold,
            drawIcon: (ix, iy, sz) => { this.ui.drawIcon(ctx, 'gold', ix, iy, sz) || (ctx.fillStyle = '#ffd700', ctx.beginPath(), ctx.arc(ix + sz / 2, iy + sz / 2, sz / 2, 0, Math.PI * 2), ctx.fill()); } });
          if (abCostWood > 0) abCostEntries.push({ val: abCostWood, canAf: player.wood >= abCostWood,
            drawIcon: (ix, iy, sz) => { this.ui.drawIcon(ctx, 'wood', ix, iy, sz) || (ctx.fillStyle = '#8bc34a', ctx.beginPath(), ctx.arc(ix + sz / 2, iy + sz / 2, sz / 2, 0, Math.PI * 2), ctx.fill()); } });
          if (abCostMeat > 0) abCostEntries.push({ val: abCostMeat, canAf: player.meat >= abCostMeat,
            drawIcon: (ix, iy, sz) => { this.ui.drawIcon(ctx, 'meat', ix, iy, sz) || (ctx.fillStyle = '#ef9a9a', ctx.beginPath(), ctx.arc(ix + sz / 2, iy + sz / 2, sz / 2, 0, Math.PI * 2), ctx.fill()); } });
          if (abCostMana > 0) {
            const manaDisplay = race === Race.Demon && player.mana >= abCostMana ? player.mana : abCostMana;
            abCostEntries.push({ val: manaDisplay, canAf: player.mana >= abCostMana,
              drawIcon: (ix, iy, sz) => { this.ui.drawIcon(ctx, 'mana', ix, iy, sz); } });
          }
          if (abCostSouls > 0) abCostEntries.push({ val: abCostSouls, canAf: player.souls >= abCostSouls,
            drawIcon: (ix, iy, sz) => { this.ui.drawIcon(ctx, 'souls', ix, iy, sz); } });
          if (abCostEssence > 0) abCostEntries.push({ val: abCostEssence, canAf: player.deathEssence >= abCostEssence,
            drawIcon: (ix, iy, sz) => { this.ui.drawIcon(ctx, 'ooze', ix, iy, sz); } });
          if (abCostEntries.length > 0) {
            const iconSz = 10;
            const gap = 3;
            ctx.font = 'bold 11px monospace';
            const valStrs = abCostEntries.map(e => `${e.val}`);
            let totalW = 0;
            for (let i = 0; i < abCostEntries.length; i++) {
              totalW += iconSz + 1 + ctx.measureText(valStrs[i]).width;
              if (i < abCostEntries.length - 1) totalW += gap;
            }
            let dx = abCx - totalW / 2;
            const dy = abTextY + 24;
            for (let i = 0; i < abCostEntries.length; i++) {
              const e = abCostEntries[i];
              ctx.globalAlpha = canAffordAbility ? 1 : 0.45;
              e.drawIcon(dx, dy - iconSz, iconSz);
              ctx.globalAlpha = 1;
              dx += iconSz + 1;
              ctx.fillStyle = e.canAf ? '#ccc' : '#ff6666';
              ctx.textAlign = 'left';
              ctx.fillText(valStrs[i], dx, dy);
              dx += ctx.measureText(valStrs[i]).width + gap;
            }
            ctx.textAlign = 'center';
          }
        }

        // Cooldown timer or key hint
        if (onCooldown) {
          const secsLeft = Math.ceil(player.abilityCooldown / TICK_RATE);
          ctx.fillStyle = '#ff9800';
          ctx.font = 'bold 11px monospace';
          ctx.fillText(`${secsLeft}s`, abCx, adjY + cellH - 4);
        } else if (!this.isTouchDevice) {
          ctx.fillStyle = '#666';
          ctx.font = '11px monospace'; ctx.textAlign = 'right';
          ctx.fillText(`[${abilityInfo.key}]`, abX + milW - 4, adjY + cellH - 4);
        }
      }
    }

    // === Floating Nuke button (above miner) ===
    {
      const nukeAvail = player.nukeAvailable;
      const nukeLocked = this.isNukeLocked();
      const nukeReady = nukeAvail && !nukeLocked;
      const nr = nukeRect;
      const nukePad = 2;
      if (nukeReady) {
        this.ui.drawBigRedButton(ctx, nr.x + nukePad, nr.y + nukePad, nr.w - nukePad * 2, nr.h - nukePad * 2, this.nukeTargeting);
      } else if (nukeAvail) {
        ctx.globalAlpha = 0.3;
        this.ui.drawBigRedButton(ctx, nr.x + nukePad, nr.y + nukePad, nr.w - nukePad * 2, nr.h - nukePad * 2);
        ctx.globalAlpha = 1;
      } else {
        // Nuke already used — dim it out
        ctx.globalAlpha = 0.15;
        this.ui.drawBigRedButton(ctx, nr.x + nukePad, nr.y + nukePad, nr.w - nukePad * 2, nr.h - nukePad * 2);
        ctx.globalAlpha = 1;
      }
      // Nuke icon centered in button
      ctx.textAlign = 'center';
      {
        const iconS = Math.min(nr.w, nr.h) * 0.55;
        ctx.globalAlpha = nukeReady ? 1 : 0.5;
        if (!this.ui.drawIcon(ctx, 'nuke', nr.x + (nr.w - iconS) / 2, nr.y + (nr.h - iconS) / 2 - 2, iconS)) {
          ctx.fillStyle = nukeReady ? '#fff' : '#888';
          ctx.font = 'bold 11px monospace';
          ctx.fillText('NUKE', nr.x + nr.w / 2, nr.y + nr.h / 2 + 2);
        }
        ctx.globalAlpha = 1;
      }
      if (nukeLocked && nukeAvail) {
        const secsLeft = Math.ceil(NUKE_LOCKOUT_SECONDS - this.game.state.tick / TICK_RATE);
        ctx.fillStyle = '#ff5722';
        ctx.font = 'bold 11px monospace';
        ctx.fillText(`${secsLeft}s`, nr.x + nr.w / 2, nr.y + nr.h - 2);
      } else if (nukeAvail && !this.isTouchDevice) {
        ctx.fillStyle = '#888';
        ctx.font = '11px monospace';
        ctx.fillText('[N]', nr.x + nr.w / 2, nr.y + nr.h - 2);
      }
    }

    // === "Now Playing" track name above nuke button ===
    if (this.nowPlayingName) {
      const elapsed = performance.now() - this.nowPlayingStart;
      const total = InputHandler.NP_SHOW_MS + InputHandler.NP_FADE_MS;
      if (elapsed < total) {
        const alpha = elapsed < InputHandler.NP_SHOW_MS
          ? 1
          : 1 - (elapsed - InputHandler.NP_SHOW_MS) / InputHandler.NP_FADE_MS;
        ctx.save();
        ctx.globalAlpha = alpha * 0.85;
        ctx.font = '11px monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#fff';
        ctx.fillText(`♪ ${this.nowPlayingName}`, nukeRect.x + 2, nukeRect.y - 6);
        ctx.restore();
      }
    }

    // === Floating Research button (above ability, col 5) ===
    {
      const rr = researchRect;
      const pad = 2;
      const hasResearch = this.game.state.buildings.some(
        b => b.playerId === this.pid && b.type === BuildingType.Research
      );
      const isOpen = this.researchPopup.isOpen();
      ctx.globalAlpha = hasResearch ? 1 : 0.35;
      if (!this.ui.drawBigBlueButton(ctx, rr.x + pad, rr.y + pad, rr.w - pad * 2, rr.h - pad * 2, isOpen)) {
        // Fallback: teal-filled rect
        ctx.fillStyle = isOpen ? '#00bcd4' : '#006064';
        ctx.fillRect(rr.x + pad, rr.y + pad, rr.w - pad * 2, rr.h - pad * 2);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = 'center';
      // Research icon centered in button
      {
        const iconS = Math.min(rr.w, rr.h) * 0.55;
        ctx.globalAlpha = hasResearch ? 1 : 0.5;
        if (!this.ui.drawIcon(ctx, 'research', rr.x + (rr.w - iconS) / 2, rr.y + (rr.h - iconS) / 2 - 2, iconS)) {
          ctx.fillStyle = hasResearch ? '#fff' : '#888';
          ctx.font = 'bold 11px monospace';
          ctx.fillText('RESEARCH', rr.x + rr.w / 2, rr.y + rr.h / 2 + 2);
        }
        ctx.globalAlpha = 1;
      }
      if (!this.isTouchDevice) {
        ctx.fillStyle = '#888';
        ctx.font = '11px monospace';
        ctx.fillText('[R]', rr.x + rr.w / 2, rr.y + rr.h - 2);
      }
    }

    // === Rally override buttons (centered above tray) ===
    if (player.race !== Race.Oozlings) {
      const { rallyLeftRect: rl, rallyRandomRect: rm, rallyRightRect: rr2 } = this.getTrayLayout();
      const isLandscape = this.game.state.mapDef.shapeAxis === 'x';
      const leftLabel = isLandscape ? 'ALL TOP' : 'ALL LEFT';
      const rightLabel = isLandscape ? 'ALL BOT' : 'ALL RIGHT';
      const isLeftActive = this.rallyOverride === Lane.Left;
      const isRandomActive = this.rallyOverride === 'random';
      const isRightActive = this.rallyOverride === Lane.Right;
      const anyActive = this.rallyOverride !== null;

      // Sync: if rally is active, ensure any new buildings are also overridden
      if (this.rallyOverride !== null && this.rallyOverride !== 'random') {
        for (const b of this.game.state.buildings) {
          if (b.playerId === this.pid && b.type !== BuildingType.Tower && b.lane !== this.rallyOverride) {
            if (!this.rallyPrevLanes.has(b.id)) {
              this.rallyPrevLanes.set(b.id, b.lane);
            }
            this.game.sendCommand({ type: 'toggle_lane', playerId: this.pid, buildingId: b.id, lane: this.rallyOverride });
          }
        }
      } else if (this.rallyOverride === 'random') {
        // Random: assign new buildings a random lane
        for (const b of this.game.state.buildings) {
          if (b.playerId === this.pid && b.type !== BuildingType.Tower && !this.rallyPrevLanes.has(b.id)) {
            this.rallyPrevLanes.set(b.id, b.lane);
            const lane = Math.random() < 0.5 ? Lane.Left : Lane.Right;
            this.game.sendCommand({ type: 'toggle_lane', playerId: this.pid, buildingId: b.id, lane });
          }
        }
      }

      // Draw rally buttons (same style as research/nuke)
      const pad = 2;
      const drawRallyBtn = (rect: { x: number; y: number; w: number; h: number }, label: string, active: boolean, disabled: boolean) => {
        ctx.globalAlpha = disabled ? 0.35 : 1;
        if (active) {
          this.ui.drawBigRedButton(ctx, rect.x + pad, rect.y + pad, rect.w - pad * 2, rect.h - pad * 2, true);
        } else {
          this.ui.drawBigBlueButton(ctx, rect.x + pad, rect.y + pad, rect.w - pad * 2, rect.h - pad * 2);
        }
        ctx.globalAlpha = 1;
        ctx.textAlign = 'center';
        ctx.fillStyle = disabled ? '#888' : '#fff';
        ctx.font = 'bold 11px monospace';
        if (active) {
          ctx.fillText('CANCEL', rect.x + rect.w / 2, rect.y + rect.h / 2 + 2);
        } else {
          // Line break label on mobile for better fit
          const parts = label.split(' ');
          if (this.isTouchDevice && parts.length === 2) {
            ctx.fillText(parts[0], rect.x + rect.w / 2, rect.y + rect.h / 2 - 4);
            ctx.fillText(parts[1], rect.x + rect.w / 2, rect.y + rect.h / 2 + 10);
          } else {
            ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 2);
          }
        }
        if (!active && !this.isTouchDevice) {
          ctx.fillStyle = '#888';
          ctx.font = '11px monospace';
          ctx.fillText('[L]', rect.x + rect.w / 2, rect.y + rect.h - 2);
        }
      };
      drawRallyBtn(rl, leftLabel, isLeftActive, anyActive && !isLeftActive);
      drawRallyBtn(rm, 'RANDOM', isRandomActive, anyActive && !isRandomActive);
      drawRallyBtn(rr2, rightLabel, isRightActive, anyActive && !isRightActive);
    }

    if (quickChatCdMs > 0) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffcc80';
      ctx.font = '11px monospace';
      ctx.fillText(`Chat CD ${(quickChatCdMs / 1000).toFixed(1)}s`, 10, milY - 8);
    }
    // Toast messages — positioned above rally buttons
    const toastBaseY = milY - 76 - 4; // above rally/nuke row
    if (this.quickChatToast && Date.now() < this.quickChatToast.until) {
      ctx.fillStyle = 'rgba(20,20,20,0.9)';
      ctx.fillRect(W / 2 - 120, toastBaseY - 4, 240, 22);
      ctx.strokeStyle = '#ffcc80';
      ctx.strokeRect(W / 2 - 120, toastBaseY - 4, 240, 22);
      ctx.fillStyle = '#ffcc80';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(this.quickChatToast.text, W / 2, toastBaseY + 11);
    }
    if (this.laneToast && Date.now() < this.laneToast.until) {
      ctx.fillStyle = 'rgba(20,20,20,0.9)';
      ctx.fillRect(W / 2 - 160, toastBaseY - 28, 320, 20);
      ctx.strokeStyle = '#9bb7ff';
      ctx.strokeRect(W / 2 - 160, toastBaseY - 28, 320, 20);
      ctx.fillStyle = '#9bb7ff';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(this.laneToast.text, W / 2, toastBaseY - 14);
    }

    if (this.mobileHintVisible) {
      const hx = 10;
      const hy = milY - 56;
      const hw = 280;
      const hh = 22;
      ctx.fillStyle = 'rgba(0,0,0,0.88)';
      ctx.fillRect(hx, hy, hw, hh);
      ctx.strokeStyle = '#90caf9';
      ctx.strokeRect(hx, hy, hw, hh);
      ctx.fillStyle = '#90caf9';
      ctx.font = '11px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('Tip: hold anywhere to open quick-chat radial (tap to dismiss)', hx + 8, hy + 15);
    }

    if (this.settingsOpen) {
      this.drawSettingsPanel(ctx);
    }

    // Building popup (in-world)
    if (this.buildingPopup.isOpen()) {
      this.buildingPopup.draw(ctx, this.camera, this.game.state, this.ui,
        W, this.canvas.clientHeight, player.gold, player.wood, player.meat, this.sprites,
        this.pointerX, this.pointerY, this.isTouchDevice);
    }

    // Hut popup (in-world)
    if (this.hutPopup.isOpen()) {
      this.hutPopup.draw(ctx, this.camera, this.game.state, this.ui,
        W, this.canvas.clientHeight);
    }

    // Research popup
    if (this.researchPopup.isOpen()) {
      this.researchPopup.draw(ctx, this.camera, this.game.state, this.ui,
        W, this.canvas.clientHeight, player.gold, player.wood, player.meat, player.mana);
    }

    // Seed popup (in-world)
    if (this.seedPopup.isOpen()) {
      this.seedPopup.draw(ctx, this.camera, this.game.state, this.ui,
        W, this.canvas.clientHeight, this.pid);
    }

    ctx.textAlign = 'start';
  }

  private clearSelection(): void {
    this.selectedUnitId = null;
    this.selectedHarvesterId = null;
    this.cameraFollowing = false;
    this.camera.followTargetX = null;
    this.camera.followTargetY = null;
    this.followBtnRect = null;
  }

  /** Select and pan to the friendly unit with the most kills. Tiebreak: furthest from HQ. */
  private selectMvpUnit(): void {
    const state = this.game.state;
    const myTeam = this.myTeam;
    const teamUnits = state.units.filter(u => u.team === myTeam && u.kills > 0);
    if (teamUnits.length === 0) return;

    const hq = getHQPosition(myTeam, state.mapDef);
    const hqCx = hq.x + HQ_WIDTH / 2;
    const hqCy = hq.y + HQ_HEIGHT / 2;

    teamUnits.sort((a, b) => {
      if (b.kills !== a.kills) return b.kills - a.kills;
      // Tiebreak: furthest from base
      const distA = (a.x - hqCx) ** 2 + (a.y - hqCy) ** 2;
      const distB = (b.x - hqCx) ** 2 + (b.y - hqCy) ** 2;
      return distB - distA;
    });

    const mvp = teamUnits[0];
    this.selectedUnitId = mvp.id;
    this.selectedHarvesterId = null;
    this.cameraFollowing = true;
    const { px: mpx, py: mpy } = this.tp(mvp.x, mvp.y);
    this.camera.followTargetX = mpx;
    this.camera.followTargetY = mpy;
    this.camera.panTo(mpx, mpy);
    this.settingsOpen = false;
    this.showTutorial = false;
  }

  updateCameraFollow(): void {
    // Detect if camera cancelled follow via manual input
    if (this.cameraFollowing && this.camera.followTargetX === null) {
      this.cameraFollowing = false;
    }
    if (!this.cameraFollowing) return;

    if (this.selectedUnitId !== null) {
      const u = this.game.state.units.find(u => u.id === this.selectedUnitId);
      if (u) {
        const { px: ux, py: uy } = this.tp(u.x, u.y);
        this.camera.followTargetX = ux;
        this.camera.followTargetY = uy;
      } else {
        this.cameraFollowing = false;
        this.camera.followTargetX = null;
        this.camera.followTargetY = null;
      }
    } else if (this.selectedHarvesterId !== null) {
      const h = this.game.state.harvesters.find(h => h.id === this.selectedHarvesterId);
      if (h && h.state !== 'dead') {
        const { px: hx, py: hy } = this.tp(h.x, h.y);
        this.camera.followTargetX = hx;
        this.camera.followTargetY = hy;
      } else {
        this.cameraFollowing = false;
        this.camera.followTargetX = null;
        this.camera.followTargetY = null;
      }
    }
  }

  private drawSelectedUnit(ctx: CanvasRenderingContext2D, renderer: Renderer): void {
    let worldX: number | null = null;
    let worldY: number | null = null;
    let lines: string[] = [];
    let raceColor = '#fff';
    let unitShape: { race: Race; category: 'melee' | 'ranged' | 'caster'; team: Team; playerId: number; upgradeNode?: string } | null = null;
    let statusEffects: StatusEffect[] = [];

    // Unit selection
    if (this.selectedUnitId !== null) {
      const u = this.game.state.units.find(u => u.id === this.selectedUnitId);
      if (!u) { this.clearSelection(); return; }
      worldX = u.x;
      worldY = u.y;
      const player = this.game.state.players[u.playerId];
      const race = player?.race;
      raceColor = race ? (RACE_COLORS[race]?.primary ?? '#fff') : '#fff';
      const teamLabel = u.team === this.myTeam ? 'Ally' : 'Enemy';
      const bldType = `${u.category}_spawner` as BuildingType;
      const upgradeName = race ? getUpgradeNodeDef(race, bldType, u.upgradeNode)?.name : undefined;
      lines.push(upgradeName ?? u.type);
      lines.push(`${teamLabel} ${u.category}`);
      lines.push(statLineToken('health', `HP ${u.hp}/${u.maxHp}${u.shieldHp > 0 ? `  +${u.shieldHp} shield` : ''}`));
      lines.push(statLineToken('damage', `DMG ${u.damage}  SPD ${u.attackSpeed.toFixed(1)}s  RNG ${u.range}  Move ${u.moveSpeed.toFixed(1)}`));
      // Research upgrade levels for this unit's category
      const research = player?.researchUpgrades;
      if (research) {
        const atkKey = `${u.category}AtkLevel` as keyof ResearchUpgradeState;
        const defKey = `${u.category}DefLevel` as keyof ResearchUpgradeState;
        const atkLvl = research[atkKey] as number;
        const defLvl = research[defKey] as number;
        if (atkLvl > 0 || defLvl > 0) {
          lines.push(`__research__:${atkLvl}:${defLvl}`);
        }
      }
      if (u.kills > 0) lines.push(`Kills: ${u.kills}`);
      statusEffects = u.statusEffects;
      if (race) unitShape = { race, category: u.category, team: u.team, playerId: u.playerId, upgradeNode: u.upgradeNode };
    }
    // Harvester selection
    else if (this.selectedHarvesterId !== null) {
      const h = this.game.state.harvesters.find(h => h.id === this.selectedHarvesterId);
      if (!h || h.state === 'dead') { this.clearSelection(); return; }
      worldX = h.x;
      worldY = h.y;
      const player = this.game.state.players[h.playerId];
      const race = player?.race;
      raceColor = race ? (RACE_COLORS[race]?.primary ?? '#fff') : '#fff';
      const assignLabel = ASSIGNMENT_LABELS[h.assignment] ?? h.assignment;
      lines.push('Miner');
      lines.push(statLineToken('health', `HP ${h.hp}/${h.maxHp}  Task ${assignLabel}`));
      lines.push(`State: ${h.state}${h.carryingDiamond ? '  Carrying diamond' : ''}${h.carryingResource ? `  Carrying ${h.carryingResource}` : ''}`);
    }

    if (worldX === null || worldY === null) { this.followBtnRect = null; return; }

    const cam = renderer.camera;

    // Draw selection ring in world space
    ctx.save();
    cam.applyTransform(ctx);
    const { px: upx0, py: upy0 } = this.tp(worldX, worldY);
    const px = upx0 + TILE_SIZE / 2;
    const py = upy0 + TILE_SIZE / 2;
    const ringR = TILE_SIZE * 0.6;
    ctx.beginPath();
    ctx.arc(px, py, ringR, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);

    // Draw info panel at top of screen
    const lineH = 16;
    const padX = 14;
    const padY = 8;

    // Measure follow button
    ctx.font = '11px monospace';
    const followLabel = this.cameraFollowing ? '[Following]' : '[Follow]';
    const followW = ctx.measureText(followLabel).width + 12;
    const followH = 18;

    // Status effect buff bar sizing
    const buffIconSize = 20;
    const buffIconGap = 3;
    const buffPadY = 4;

    const textH = lines.length * lineH + padY * 2;

    ctx.font = '12px monospace';
    let maxW = 0;
    for (const line of lines) {
      const lineText = displayLineText(line);
      const iconPad = line.startsWith('__stat__:') || line.startsWith('__research__:') ? 18 : 0;
      const m = ctx.measureText(lineText).width + iconPad;
      if (m > maxW) maxW = m;
    }
    const boxW = Math.max(maxW + padX * 2, followW + padX * 2 + 38);

    // Calculate buff bar rows (one icon per effect type, stack count shown on icon)
    const buffAreaW = boxW - padX * 2;
    const iconsPerRow = Math.max(1, Math.floor((buffAreaW + buffIconGap) / (buffIconSize + buffIconGap)));
    const buffRows = statusEffects.length > 0 ? Math.ceil(statusEffects.length / iconsPerRow) : 0;
    const buffBarH = buffRows > 0 ? buffRows * (buffIconSize + buffIconGap) + buffPadY : 0;

    const boxH = textH + buffBarH + followH + 2;

    const boxX = (this.canvas.clientWidth - boxW) / 2;
    const safeY = getPopupSafeY(this.canvas.clientWidth, this.canvas.clientHeight);
    const boxY = safeY.top;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.92)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = raceColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    // Draw unit art in the panel
    if (unitShape && this.sprites) {
      const sprData = this.sprites.getUnitSprite(unitShape.race, unitShape.category, unitShape.playerId, false, unitShape.upgradeNode);
      if (sprData) {
        const [img, def] = sprData;
        const drawH = textH - 6;
        const aspect = def.frameW / def.frameH;
        const drawW = drawH * aspect;
        const drawX = boxX + 20 - drawW / 2;
        const drawY = boxY + (textH - drawH) / 2;
        if (def.flipX) {
          ctx.save();
          ctx.translate(boxX + 20, 0);
          ctx.scale(-1, 1);
          ctx.translate(-(boxX + 20), 0);
        }
        drawSpriteFrame(ctx, img, def, 0, drawX, drawY, drawW, drawH);
        if (def.flipX) ctx.restore();
      } else if (this.currentRenderer) {
        this.currentRenderer.drawUnitShape(ctx, boxX + 20, boxY + textH / 2, 10, unitShape.race, unitShape.category, unitShape.team, raceColor);
      }
    }

    ctx.textAlign = 'left';
    const textStartX = boxX + 38;
    for (let i = 0; i < lines.length; i++) {
      const lineY = boxY + padY + (i + 1) * lineH - 3;
      if (lines[i].startsWith('__stat__:')) {
        const parts = lines[i].split(':');
        const key = parts[1] as StatVisualKey;
        const text = parts.slice(2).join(':');
        drawStatVisualIcon(ctx, this.ui, key, textStartX, lineY - 10, 14);
        ctx.fillStyle = '#ccc';
        ctx.font = '12px monospace';
        ctx.fillText(text, textStartX + 18, lineY);
        continue;
      }
      // Special research upgrade line: draw sword/shield icons with levels
      if (lines[i].startsWith('__research__:')) {
        const parts = lines[i].split(':');
        const atkLvl = parseInt(parts[1]);
        const defLvl = parseInt(parts[2]);
        const iconSz = 14;
        let cx = textStartX;
        if (atkLvl > 0) {
          this.ui.drawIcon(ctx, 'sword', cx, lineY - iconSz + 3, iconSz);
          cx += iconSz + 2;
          ctx.fillStyle = '#ff9944';
          ctx.font = 'bold 12px monospace';
          ctx.fillText(`${atkLvl}`, cx, lineY);
          cx += ctx.measureText(`${atkLvl}`).width + 8;
        }
        if (defLvl > 0) {
          this.ui.drawIcon(ctx, 'shield', cx, lineY - iconSz + 3, iconSz);
          cx += iconSz + 2;
          ctx.fillStyle = '#44aaff';
          ctx.font = 'bold 12px monospace';
          ctx.fillText(`${defLvl}`, cx, lineY);
        }
        continue;
      }
      if (i === 0) {
        ctx.fillStyle = raceColor;
        ctx.font = 'bold 13px monospace';
      } else {
        ctx.fillStyle = '#ccc';
        ctx.font = '12px monospace';
      }
      ctx.fillText(lines[i], textStartX, lineY);
    }

    // === Buff/debuff icon bar (WoW-style) ===
    if (statusEffects.length > 0) {
      const buffStartY = boxY + textH + buffPadY;
      const buffStartX = boxX + padX;
      const tick = this.game.state.tick;

      for (let i = 0; i < statusEffects.length; i++) {
        const eff = statusEffects[i];
        const col = i % iconsPerRow;
        const row = Math.floor(i / iconsPerRow);
        const ix = buffStartX + col * (buffIconSize + buffIconGap);
        const iy = buffStartY + row * (buffIconSize + buffIconGap);

        const meta = BUFF_ICON_META[eff.type];
        const maxDuration = meta.maxDur * TICK_RATE;
        const durFrac = Math.min(1, eff.duration / maxDuration);

        // Icon background
        ctx.fillStyle = meta.isDebuff ? 'rgba(80, 0, 0, 0.7)' : 'rgba(0, 50, 80, 0.7)';
        ctx.fillRect(ix, iy, buffIconSize, buffIconSize);

        // Icon symbol
        ctx.globalAlpha = 1;
        drawStatVisualIcon(ctx, this.ui, meta.key, ix + 2, iy + 2, buffIconSize - 4);

        // Duration sweep: dark overlay that winds clockwise like a cooldown clock
        // Covers the portion of time that has elapsed, clipped to icon bounds
        const elapsed = 1 - durFrac;
        if (elapsed > 0.01) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(ix, iy, buffIconSize, buffIconSize);
          ctx.clip();
          ctx.beginPath();
          const cx = ix + buffIconSize / 2;
          const cy = iy + buffIconSize / 2;
          const r = buffIconSize;
          ctx.moveTo(cx, cy);
          const startAngle = -Math.PI / 2;
          const endAngle = startAngle + elapsed * Math.PI * 2;
          ctx.arc(cx, cy, r, startAngle, endAngle);
          ctx.closePath();
          ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
          ctx.fill();
          ctx.restore();
        }

        // Border (colored by buff/debuff, pulses when nearly expired)
        const nearExpiry = durFrac < 0.25;
        const pulse = nearExpiry ? 0.5 + 0.5 * Math.sin(tick * 0.3) : 1;
        ctx.globalAlpha = pulse;
        ctx.strokeStyle = meta.isDebuff ? '#ff4444' : '#44aaff';
        ctx.lineWidth = 1;
        ctx.strokeRect(ix, iy, buffIconSize, buffIconSize);
        ctx.globalAlpha = 1;

        // Stack count (bottom-right corner, only if > 1 total stacks)
        if (eff.stacks > 1) {
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 9px monospace';
          ctx.textAlign = 'right';
          ctx.fillText(`${eff.stacks}`, ix + buffIconSize - 1, iy + buffIconSize - 2);
        }
      }
    }

    // Follow toggle button (right side of panel)
    const fbx = boxX + boxW - followW - 6;
    const fby = boxY + boxH - followH - 4;
    this.followBtnRect = { x: fbx, y: fby, w: followW, h: followH };

    ctx.fillStyle = this.cameraFollowing ? 'rgba(80, 200, 120, 0.3)' : 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(fbx, fby, followW, followH);
    ctx.strokeStyle = this.cameraFollowing ? '#50c878' : '#888';
    ctx.lineWidth = 1;
    ctx.strokeRect(fbx, fby, followW, followH);
    ctx.fillStyle = this.cameraFollowing ? '#50c878' : '#aaa';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(followLabel, fbx + followW / 2, fby + 13);

    ctx.textAlign = 'start';
  }

  private findUnitNear(wx: number, wy: number, radius: number): UnitState | null {
    let best: UnitState | null = null;
    let bestDist = radius * radius;
    for (const u of this.game.state.units) {
      const dx = u.x - wx;
      const dy = u.y - wy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) {
        bestDist = d2;
        best = u;
      }
    }
    return best;
  }

  private getBuildingLabel(type: BuildingType, race?: Race, upgradePath?: string[]): string {
    return getRaceBuildingName(race, type, upgradePath);
  }

  private getBuildingTooltip(building: { type: BuildingType; hp: number; maxHp: number; lane: Lane; upgradePath: string[]; id: number; playerId: number }): string {
    const race = this.game.state.players[building.playerId]?.race;
    let tip = this.getBuildingLabel(building.type, race, building.upgradePath);
    // Only show HP for towers (spawners, huts, and research are invincible)
    if (building.type === BuildingType.Tower) {
      tip += `  HP: ${building.hp}/${building.maxHp}`;
    }
    if (building.type === BuildingType.HarvesterHut) {
      const h = this.game.state.harvesters.find(h => h.hutId === building.id);
      if (h) tip += `  [${ASSIGNMENT_LABELS[h.assignment]}]`;
    } else if (building.type !== BuildingType.Tower && building.type !== BuildingType.Research) {
      const isOozlings = race === Race.Oozlings;
      if (isOozlings) {
        tip += `  Lane: RANDOM`;
      } else {
        const isPortrait = this.game.state.mapDef.shapeAxis === 'y';
        const laneLabel = building.lane === Lane.Left
          ? (isPortrait ? 'LEFT' : 'TOP')
          : (isPortrait ? 'RIGHT' : 'BOT');
        tip += `  Lane: ${laneLabel}`;
      }
    }
    return tip;
  }

  private getUnitTooltip(u: UnitState): string {
    const teamLabel = u.team === this.myTeam ? 'Ally' : 'Enemy';
    // Look up upgrade node name if unit has been upgraded
    let name = u.type;
    if (u.upgradeNode && u.upgradeNode !== 'A') {
      const race = this.game.state.players[u.playerId]?.race;
      if (race != null) {
        const catToBld: Record<string, BuildingType> = {
          melee: BuildingType.MeleeSpawner,
          ranged: BuildingType.RangedSpawner,
          caster: BuildingType.CasterSpawner,
        };
        const bld = catToBld[u.category];
        const tree = bld && getUpgradeNodeDef(race, bld, u.upgradeNode ?? '');
        const nodeName = tree?.name;
        if (nodeName) name = nodeName;
      }
    }
    let tip = `${name} (${teamLabel} ${u.category})  HP: ${u.hp}/${u.maxHp}`;
    if (u.shieldHp > 0) tip += ` +${u.shieldHp} shield`;
    return tip;
  }

  private devBalanceCache: { data: any[] | null; lastRefresh: number } = { data: null, lastRefresh: 0 };

  private drawDevOverlay(ctx: CanvasRenderingContext2D): void {
    const state = this.game.state;
    const W = this.canvas.clientWidth;

    // Semi-transparent background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(0, 0, W, this.canvas.clientHeight);

    const lh = 16;
    const col1 = 20;
    let y = 30;

    // Title
    ctx.fillStyle = '#ffd740';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('DEV PANEL  [` to close]', col1, y);
    y += lh + 8;

    // --- LIVE MATCH STATS ---
    ctx.fillStyle = '#81c784';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('LIVE MATCH', col1, y);
    y += lh;

    const tickSec = Math.floor(state.tick / TICK_RATE);
    const mins = Math.floor(tickSec / 60);
    const secs = tickSec % 60;
    ctx.fillStyle = '#ccc';
    ctx.font = '12px monospace';
    ctx.fillText(`Time: ${mins}:${secs.toString().padStart(2, '0')}  Phase: ${state.matchPhase}  Winner: ${state.winner ?? 'none'}`, col1, y);
    y += lh;
    ctx.fillText(`HQ HP: ${state.hqHp.map((hp, i) => `T${i}:${hp}`).join(' | ')}`, col1, y);
    y += lh + 4;

    // Per-player live stats table
    const headers = ['P#', 'Race', 'Team', 'Gold', 'Wood', 'Meat', 'DMG', 'Spawn', 'Lost', 'Bld'];
    const colWidths = [28, 65, 45, 90, 90, 90, 55, 50, 40, 35];

    ctx.fillStyle = '#90caf9';
    ctx.font = 'bold 11px monospace';
    let hx = col1;
    for (let i = 0; i < headers.length; i++) {
      ctx.fillText(headers[i], hx, y);
      hx += colWidths[i];
    }
    y += lh;

    for (let pi = 0; pi < state.players.length; pi++) {
      const p = state.players[pi];
      const s = state.playerStats[pi];
      const bcount = state.buildings.filter(b => b.playerId === pi).length;
      const vals = [
        `${pi}${p.isBot ? 'b' : ''}`,
        p.race,
        p.team === Team.Bottom ? 'Bot' : 'Top',
        `${p.gold}(+${s.totalGoldEarned})`,
        `${p.wood}(+${s.totalWoodEarned})`,
        `${p.meat}(+${s.totalMeatEarned})`,
        `${s.totalDamageDealt}`,
        `${s.unitsSpawned}`,
        `${s.unitsLost}`,
        `${bcount}`,
      ];
      ctx.fillStyle = pi === 0 ? '#e8f5e9' : '#fafafa';
      ctx.font = '11px monospace';
      let vx = col1;
      for (let i = 0; i < vals.length; i++) {
        ctx.fillText(vals[i], vx, y);
        vx += colWidths[i];
      }
      y += lh;
    }
    y += 8;

    // Unit counts per team
    ctx.fillStyle = '#81c784';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('UNIT COUNTS', col1, y);
    y += lh;
    const botUnits = state.units.filter(u => u.team === Team.Bottom);
    const topUnits = state.units.filter(u => u.team === Team.Top);
    const botMelee = botUnits.filter(u => u.category === 'melee').length;
    const botRanged = botUnits.filter(u => u.category === 'ranged').length;
    const botCaster = botUnits.filter(u => u.category === 'caster').length;
    const topMelee = topUnits.filter(u => u.category === 'melee').length;
    const topRanged = topUnits.filter(u => u.category === 'ranged').length;
    const topCaster = topUnits.filter(u => u.category === 'caster').length;
    ctx.fillStyle = '#ccc';
    ctx.font = '11px monospace';
    ctx.fillText(`Bottom: ${botUnits.length} total (${botMelee}m ${botRanged}r ${botCaster}c)  Harvesters: ${state.harvesters.filter(h => h.team === Team.Bottom).length}`, col1, y);
    y += lh;
    ctx.fillText(`Top:    ${topUnits.length} total (${topMelee}m ${topRanged}r ${topCaster}c)  Harvesters: ${state.harvesters.filter(h => h.team === Team.Top).length}`, col1, y);
    y += lh + 8;

    // --- HISTORICAL BALANCE (from localStorage) ---
    ctx.fillStyle = '#ffd740';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('BALANCE HISTORY', col1, y);
    y += lh;

    const now = Date.now();
    if (!this.devBalanceCache.data || now - this.devBalanceCache.lastRefresh > 2000) {
      try {
        const raw = localStorage.getItem('lanecraft.balanceLog');
        this.devBalanceCache.data = raw ? JSON.parse(raw) : [];
      } catch { this.devBalanceCache.data = []; }
      this.devBalanceCache.lastRefresh = now;
    }
    const records = this.devBalanceCache.data!;

    if (records.length === 0) {
      ctx.fillStyle = '#888';
      ctx.font = '11px monospace';
      ctx.fillText('No completed matches yet.', col1, y);
      y += lh;
    } else {
      // Aggregate by race
      const byRace: Record<string, { wins: number; games: number; dmg: number; res: number; spawned: number; lost: number }> = {};
      for (const r of records) {
        for (const p of r.players) {
          if (!byRace[p.race]) byRace[p.race] = { wins: 0, games: 0, dmg: 0, res: 0, spawned: 0, lost: 0 };
          const a = byRace[p.race];
          a.games++;
          if (p.won) a.wins++;
          a.dmg += p.damageDealt;
          a.res += p.goldEarned + p.woodEarned + p.meatEarned;
          a.spawned += p.unitsSpawned;
          a.lost += p.unitsLost;
        }
      }

      ctx.fillStyle = '#888';
      ctx.font = '11px monospace';
      ctx.fillText(`${records.length} matches recorded`, col1, y);
      y += lh + 2;

      const rHeaders = ['Race', 'Games', 'Win%', 'Avg DMG', 'Avg Res', 'Avg Spawn', 'Avg Lost'];
      const rWidths = [70, 50, 50, 70, 70, 75, 65];
      ctx.fillStyle = '#90caf9';
      ctx.font = 'bold 11px monospace';
      let rx = col1;
      for (let i = 0; i < rHeaders.length; i++) {
        ctx.fillText(rHeaders[i], rx, y);
        rx += rWidths[i];
      }
      y += lh;

      for (const [race, a] of Object.entries(byRace)) {
        const winPct = a.games > 0 ? Math.round(100 * a.wins / a.games) : 0;
        const vals = [
          race,
          `${a.games}`,
          `${winPct}%`,
          `${a.games > 0 ? Math.round(a.dmg / a.games) : 0}`,
          `${a.games > 0 ? Math.round(a.res / a.games) : 0}`,
          `${a.games > 0 ? Math.round(a.spawned / a.games) : 0}`,
          `${a.games > 0 ? Math.round(a.lost / a.games) : 0}`,
        ];
        // Color win% — green if >55%, red if <45%, white otherwise
        ctx.font = '11px monospace';
        let vx = col1;
        for (let i = 0; i < vals.length; i++) {
          if (i === 2) {
            ctx.fillStyle = winPct > 55 ? '#81c784' : winPct < 45 ? '#ef9a9a' : '#ccc';
          } else if (i === 0) {
            ctx.fillStyle = RACE_COLORS[race as Race]?.primary ?? '#ccc';
          } else {
            ctx.fillStyle = '#ccc';
          }
          ctx.fillText(vals[i], vx, y);
          vx += rWidths[i];
        }
        y += lh;
      }
    }

    // Income rate display
    y += 8;
    ctx.fillStyle = '#ffd740';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('ECONOMY (current rates)', col1, y);
    y += lh;
    ctx.fillStyle = '#ccc';
    ctx.font = '11px monospace';
    for (let pi = 0; pi < state.players.length; pi++) {
      const p = state.players[pi];
      const s = state.playerStats[pi];
      const elapsed = Math.max(1, state.tick / TICK_RATE);
      const gps = (s.totalGoldEarned / elapsed).toFixed(1);
      const wps = (s.totalWoodEarned / elapsed).toFixed(1);
      const sps = (s.totalMeatEarned / elapsed).toFixed(1);
      ctx.fillStyle = pi === 0 ? '#e8f5e9' : '#fafafa';
      ctx.fillText(`P${pi} ${p.race}: ${gps}g/s  ${wps}w/s  ${sps}m/s  total: ${s.totalGoldEarned + s.totalWoodEarned + s.totalMeatEarned}`, col1, y);
      y += lh;
    }

    ctx.textAlign = 'start';
  }

  private getSpecialDesc(race: Race, type: BuildingType): string {
    if (type === BuildingType.Tower) {
      const descs: Record<Race, string> = {
        [Race.Crown]: 'Shield allies',
        [Race.Horde]: 'Knockback blast',
        [Race.Goblins]: 'Poison splash',
        [Race.Oozlings]: 'Chain lightning',
        [Race.Demon]: 'Burn splash',
        [Race.Deep]: 'AoE slow',
        [Race.Wild]: 'Poison on hit',
        [Race.Geists]: 'Lifesteal bolt',
        [Race.Tenders]: 'Regen aura',
      };
      return descs[race] ?? '';
    }
    if (type === BuildingType.CasterSpawner) {
      const descs: Record<Race, string> = {
        [Race.Crown]: 'Shield allies',
        [Race.Horde]: 'Haste pulse + AoE',
        [Race.Goblins]: 'Hex slow + AoE',
        [Race.Oozlings]: 'Haste pulse + AoE',
        [Race.Demon]: 'Pure burst AoE',
        [Race.Deep]: 'Cleanse + AoE slow',
        [Race.Wild]: 'Haste pulse + AoE',
        [Race.Geists]: 'Lifesteal heal + AoE',
        [Race.Tenders]: 'Heal aura + AoE',
      };
      return descs[race] ?? '';
    }
    if (type === BuildingType.MeleeSpawner) {
      const descs: Record<Race, string> = {
        [Race.Crown]: 'Dmg reduction',
        [Race.Horde]: 'Knockback',
        [Race.Goblins]: 'Fast + cheap',
        [Race.Oozlings]: 'Swarm (x2)',
        [Race.Demon]: 'Glass cannon + burn',
        [Race.Deep]: 'Slow on hit + tank',
        [Race.Wild]: 'Poison on hit',
        [Race.Geists]: 'Burn + lifesteal',
        [Race.Tenders]: 'Regen + slow',
      };
      return descs[race] ?? '';
    }
    if (type === BuildingType.RangedSpawner) {
      const descs: Record<Race, string> = {
        [Race.Crown]: 'Balanced archer',
        [Race.Horde]: 'Heavy shot',
        [Race.Goblins]: 'Burn projectile',
        [Race.Oozlings]: 'Swarm spitter (x2)',
        [Race.Demon]: 'High dmg, fragile',
        [Race.Deep]: 'Slow projectile',
        [Race.Wild]: 'Poison projectile',
        [Race.Geists]: 'Lifesteal shot',
        [Race.Tenders]: 'Slow projectile',
      };
      return descs[race] ?? '';
    }
    return '';
  }

  private drawPlacementHighlight(ctx: CanvasRenderingContext2D, renderer: Renderer): void {
    if (!this.selectedBuilding) return;
    const cam = renderer.camera;
    const isTower = this.selectedBuilding === BuildingType.Tower;
    const isHut = this.selectedBuilding === BuildingType.HarvesterHut;
    const myTeam = this.myTeam;

    ctx.save();
    cam.applyTransform(ctx);

    // Highlight hut grid for miner
    if (isHut) {
      const origin = getHutGridOrigin(this.pid, this.game.state.mapDef, this.game.state.players);
      const myHuts = this.game.state.buildings.filter(b => b.playerId === this.pid && b.type === BuildingType.HarvesterHut);
      const occupiedSlots = new Set(myHuts.map(b => b.gridX));
      const hutCols = this.game.state.mapDef.hutGridCols;
      const hutRows = this.game.state.mapDef.hutGridRows;
      const totalSlots = hutCols * hutRows;
      const hoveredHutSlot = this.hoveredGridSlot?.isHut ? this.hoveredGridSlot.hutSlot : null;
      for (let slot = 0; slot < totalSlots; slot++) {
        const sgx = slot % hutCols;
        const sgy = Math.floor(slot / hutCols);
        const occupied = occupiedSlots.has(slot);
        const isHovered = hoveredHutSlot === slot && !occupied;
        const cellTx = origin.x + sgx, cellTy = origin.y + sgy;
        if (isHovered) {
          const pulse = 0.5 + 0.3 * Math.sin(Date.now() / 200);
          this.drawCellHighlight(ctx, cellTx, cellTy, `rgba(60, 255, 60, ${pulse * 0.3})`, `rgba(60, 255, 60, ${pulse})`, 2);
        } else {
          this.drawCellHighlight(ctx, cellTx, cellTy,
            occupied ? 'rgba(255, 200, 60, 0.15)' : 'rgba(60, 255, 60, 0.08)',
            occupied ? 'rgba(255, 200, 60, 0.3)' : 'rgba(60, 255, 60, 0.15)', 1);
        }
      }
    }

    // Highlight military grid slots (for non-tower, non-hut types)
    if (!isTower && !isHut) {
      const origin = getBuildGridOrigin(this.pid, this.game.state.mapDef, this.game.state.players);
      for (let gy = 0; gy < this.game.state.mapDef.buildGridRows; gy++) {
        for (let gx = 0; gx < this.game.state.mapDef.buildGridCols; gx++) {
          const occupied = this.game.state.buildings.some(
            b => b.buildGrid === 'military' && b.gridX === gx && b.gridY === gy && b.playerId === this.pid
          );
          this.drawCellHighlight(ctx, origin.x + gx, origin.y + gy,
            occupied ? 'rgba(255, 60, 60, 0.15)' : 'rgba(60, 255, 60, 0.15)',
            occupied ? 'rgba(255, 60, 60, 0.3)' : 'rgba(60, 255, 60, 0.3)', 1);
        }
      }
    }

    // Highlight tower alley slots (for towers)
    if (isTower) {
      const alley = getTeamAlleyOrigin(myTeam, this.game.state.mapDef);
      // Gold mine exclusion zone for landscape maps
      let exGX = -999, exGY = -999;
      if (this.game.state.mapDef.shapeAxis === 'x') {
        const goldPos = getBaseGoldPosition(myTeam, this.game.state.mapDef);
        exGX = Math.round(goldPos.x - alley.x);
        exGY = Math.round(goldPos.y - alley.y);
      }
      for (let gy = 0; gy < this.game.state.mapDef.towerAlleyRows; gy++) {
        for (let gx = 0; gx < this.game.state.mapDef.towerAlleyCols; gx++) {
          if (gx >= exGX - 3 && gx < exGX + 3 && gy >= exGY - 3 && gy < exGY + 3) continue;
          const occupied = this.game.state.buildings.some(
            b => {
              if (b.buildGrid !== 'alley' || b.gridX !== gx || b.gridY !== gy) return false;
              const bTeam = this.game.state.players[b.playerId]?.team ?? Team.Bottom;
              return bTeam === myTeam;
            }
          );
          this.drawCellHighlight(ctx, alley.x + gx, alley.y + gy,
            occupied ? 'rgba(255, 60, 60, 0.15)' : 'rgba(60, 255, 60, 0.15)',
            occupied ? 'rgba(255, 60, 60, 0.3)' : 'rgba(60, 255, 60, 0.3)', 1);
        }
      }
    }

    ctx.restore();
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
  }

  private drawBuildTooltip(ctx: CanvasRenderingContext2D, _renderer: Renderer): void {
    if (!this.selectedBuilding && !this.abilityTargeting) return;
    const player = this.game.state.players[this.pid];
    const race = player.race;

    // Ability tooltip (targeting or placing)
    if (this.abilityTargeting || this.abilityPlacing) {
      const abilityInfo = RACE_ABILITY_INFO[race];
      const raceColor = RACE_COLORS[race]?.primary ?? '#fff';
      const { milY } = this.getTrayLayout();
      const lines = [abilityInfo.name, abilityInfo.desc];

      const lineH = 16;
      const padX = 12;
      const padY = 8;
      const boxH = lines.length * lineH + padY * 2;
      ctx.font = '12px monospace';
      let maxW = 0;
      for (const line of lines) { const m = ctx.measureText(line).width; if (m > maxW) maxW = m; }
      const boxW = maxW + padX * 2;
      const boxX = (this.canvas.clientWidth - boxW) / 2;
      const boxY = milY - boxH - 8;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.92)';
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.strokeStyle = raceColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(boxX, boxY, boxW, boxH);
      ctx.textAlign = 'center';
      const centerX = boxX + boxW / 2;
      ctx.fillStyle = raceColor;
      ctx.font = 'bold 13px monospace';
      ctx.fillText(lines[0], centerX, boxY + padY + lineH - 3);
      ctx.fillStyle = '#ccc';
      ctx.font = '12px monospace';
      ctx.fillText(lines[1], centerX, boxY + padY + lineH * 2 - 3);
      ctx.textAlign = 'start';
      return;
    }

    if (!this.selectedBuilding) return;
    const type = this.selectedBuilding;

    let name: string;
    let hp: number;
    let damage: number;
    let atkSpd: number;
    let range: number;

    if (type === BuildingType.HarvesterHut) {
      // Simple tooltip for miners — no combat stats
      name = 'Miner Hut';
      hp = 0; damage = 0; atkSpd = 0; range = 0;
    } else if (type === BuildingType.Tower) {
      const ts = TOWER_STATS[race];
      name = 'Tower';
      hp = ts.hp;
      damage = ts.damage;
      atkSpd = ts.attackSpeed;
      range = ts.range;
    } else {
      const us = UNIT_STATS[race]?.[type];
      if (!us) return;
      name = us.name;
      hp = us.hp;
      damage = us.damage;
      atkSpd = us.attackSpeed;
      range = us.range;
    }

    const raceColor = RACE_COLORS[race]?.primary ?? '#fff';
    const { milY } = this.getTrayLayout();

    // Tooltip box above the build tray
    const lines = [name];
    if (hp > 0) lines.push(`HP:${hp}  DMG:${damage}  SPD:${atkSpd.toFixed(1)}s  RNG:${range}`);
    const special = type !== BuildingType.HarvesterHut ? this.getSpecialDesc(race, type) : 'Click a slot to place';
    if (special) lines.push(special);

    const lineH = 16;
    const padX = 12;
    const padY = 8;
    const boxH = lines.length * lineH + padY * 2;

    ctx.font = '12px monospace';
    let maxW = 0;
    for (const line of lines) {
      const m = ctx.measureText(line).width;
      if (m > maxW) maxW = m;
    }
    const boxW = maxW + padX * 2;
    const boxX = (this.canvas.clientWidth - boxW) / 2;
    const boxY = milY - boxH - 8;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.92)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = raceColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    // Text
    ctx.textAlign = 'center';
    const centerX = boxX + boxW / 2;
    for (let i = 0; i < lines.length; i++) {
      if (i === 0) {
        ctx.fillStyle = raceColor;
        ctx.font = 'bold 13px monospace';
      } else if (i === lines.length - 1 && special) {
        ctx.fillStyle = '#aaa';
        ctx.font = 'italic 11px monospace';
      } else {
        ctx.fillStyle = '#ccc';
        ctx.font = '12px monospace';
      }
      ctx.fillText(lines[i], centerX, boxY + padY + (i + 1) * lineH - 3);
    }
    ctx.textAlign = 'start';
  }

  private drawPlacementPreview(ctx: CanvasRenderingContext2D, renderer: Renderer): void {
    if (!this.hoveredGridSlot) return;
    const slot = this.hoveredGridSlot;

    // Hut preview is handled inside drawPlacementHighlight
    if (slot.isHut) return;

    const origin = slot.isAlley ? getTeamAlleyOrigin(this.myTeam, this.game.state.mapDef) : getBuildGridOrigin(this.pid, this.game.state.mapDef, this.game.state.players);

    const grid = slot.isAlley ? 'alley' : 'military';
    const myTeam = this.myTeam;
    const occupied = this.game.state.buildings.some(
      b => {
        if (b.buildGrid !== grid || b.gridX !== slot.gx || b.gridY !== slot.gy) return false;
        if (!slot.isAlley) return b.playerId === this.pid;
        const buildingTeam = this.game.state.players[b.playerId]?.team ?? Team.Bottom;
        return buildingTeam === myTeam;
      }
    );

    renderer.camera.applyTransform(ctx);

    const cellTx = origin.x + slot.gx, cellTy = origin.y + slot.gy;
    this.drawCellHighlight(ctx, cellTx, cellTy,
      occupied ? 'rgba(255, 0, 0, 0.3)' : 'rgba(0, 255, 0, 0.3)',
      occupied ? '#f44336' : '#4caf50', 2);

    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
  }

  /** True when the nuke is locked out (first 60s of the match). */
  private activateAbility(player: { race: Race; abilityCooldown: number; abilityStacks?: number }): void {
    const def = RACE_ABILITY_DEFS[player.race];
    if (player.race === Race.Tenders) {
      if ((player.abilityStacks ?? 0) <= 0) {
        const secsLeft = Math.ceil(player.abilityCooldown / TICK_RATE);
        this.laneToast = { text: `${def.name} — ${secsLeft}s`, until: Date.now() + 1500 };
        return;
      }
    } else if (player.abilityCooldown > 0) {
      const secsLeft = Math.ceil(player.abilityCooldown / TICK_RATE);
      this.laneToast = { text: `${def.name} — ${secsLeft}s cooldown`, until: Date.now() + 1500 };
      return;
    }
    if (def.targetMode === AbilityTargetMode.Instant) {
      this.game.sendCommand({ type: 'use_ability', playerId: this.pid });
      this.abilityTargeting = false;
      this.abilityPlacing = false;
    } else if (def.targetMode === AbilityTargetMode.Targeted) {
      this.abilityTargeting = !this.abilityTargeting;
      this.abilityPlacing = false;
    } else {
      // BuildSlot — enter placement mode (reuse tower alley grid selection)
      if (this.abilityPlacing) {
        // Toggle off
        this.abilityPlacing = false;
        this.selectedBuilding = null;
      } else {
        this.abilityPlacing = true;
        this.selectedBuilding = BuildingType.Tower; // reuse tower placement grid
        if (this.cameraSnapOnSelect) this.panToBuildArea(BuildingType.Tower);
      }
      this.abilityTargeting = false;
    }
  }

  /** Draw a canvas-rendered icon for each race's ability. */
  private drawAbilityIcon(ctx: CanvasRenderingContext2D, race: Race, cx: number, cy: number, size: number): void {
    const s = size;
    const hs = s / 2;
    ctx.save();
    ctx.translate(cx, cy + hs);

    switch (race) {
      case Race.Crown: {
        // Gold coin with $ symbol
        ctx.beginPath();
        ctx.arc(0, 0, hs * 0.85, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd700';
        ctx.fill();
        ctx.strokeStyle = '#b8860b';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#8b6914';
        ctx.font = `bold ${Math.round(s * 0.6)}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillText('$', 0, s * 0.22);
        break;
      }
      case Race.Horde: {
        // War axe
        ctx.fillStyle = '#8d6e63';
        ctx.fillRect(-1.5, -hs * 0.7, 3, s * 0.85); // handle
        ctx.beginPath();
        ctx.moveTo(-hs * 0.7, -hs * 0.65);
        ctx.quadraticCurveTo(-hs * 0.8, -hs * 0.1, -hs * 0.15, hs * 0.1);
        ctx.lineTo(hs * 0.15, hs * 0.1);
        ctx.quadraticCurveTo(hs * 0.8, -hs * 0.1, hs * 0.7, -hs * 0.65);
        ctx.closePath();
        ctx.fillStyle = '#9e9e9e';
        ctx.fill();
        ctx.strokeStyle = '#616161';
        ctx.lineWidth = 1;
        ctx.stroke();
        break;
      }
      case Race.Goblins: {
        // Potion bottle
        ctx.fillStyle = '#69f0ae';
        ctx.beginPath();
        ctx.moveTo(-hs * 0.2, -hs * 0.5);
        ctx.lineTo(hs * 0.2, -hs * 0.5);
        ctx.lineTo(hs * 0.2, -hs * 0.3);
        ctx.lineTo(hs * 0.55, hs * 0.05);
        ctx.quadraticCurveTo(hs * 0.65, hs * 0.7, 0, hs * 0.8);
        ctx.quadraticCurveTo(-hs * 0.65, hs * 0.7, -hs * 0.55, hs * 0.05);
        ctx.lineTo(-hs * 0.2, -hs * 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#2e7d32';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        // Cork
        ctx.fillStyle = '#8d6e63';
        ctx.fillRect(-hs * 0.25, -hs * 0.7, hs * 0.5, hs * 0.25);
        break;
      }
      case Race.Oozlings: {
        // Ooze blob
        ctx.beginPath();
        ctx.moveTo(-hs * 0.6, hs * 0.2);
        ctx.quadraticCurveTo(-hs * 0.7, -hs * 0.5, 0, -hs * 0.6);
        ctx.quadraticCurveTo(hs * 0.7, -hs * 0.5, hs * 0.5, hs * 0.2);
        ctx.quadraticCurveTo(hs * 0.3, hs * 0.7, 0, hs * 0.6);
        ctx.quadraticCurveTo(-hs * 0.4, hs * 0.7, -hs * 0.6, hs * 0.2);
        ctx.fillStyle = '#7c4dff';
        ctx.fill();
        ctx.strokeStyle = '#4a148c';
        ctx.lineWidth = 1;
        ctx.stroke();
        // Eye
        ctx.beginPath();
        ctx.arc(hs * 0.1, -hs * 0.05, hs * 0.18, 0, Math.PI * 2);
        ctx.fillStyle = '#e8eaf6';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(hs * 0.13, -hs * 0.05, hs * 0.08, 0, Math.PI * 2);
        ctx.fillStyle = '#1a237e';
        ctx.fill();
        break;
      }
      case Race.Demon: {
        // Fireball
        ctx.beginPath();
        ctx.arc(0, 0, hs * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = '#ff6600';
        ctx.fill();
        // Outer flame tongues
        const flames = 6;
        for (let i = 0; i < flames; i++) {
          const a = (i / flames) * Math.PI * 2 - Math.PI / 2;
          const fx = Math.cos(a) * hs * 0.5;
          const fy = Math.sin(a) * hs * 0.5;
          const tx = Math.cos(a) * hs * 0.95;
          const ty = Math.sin(a) * hs * 0.95;
          ctx.beginPath();
          ctx.moveTo(fx - Math.sin(a) * 3, fy + Math.cos(a) * 3);
          ctx.lineTo(tx, ty);
          ctx.lineTo(fx + Math.sin(a) * 3, fy - Math.cos(a) * 3);
          ctx.fillStyle = i % 2 === 0 ? '#ff9800' : '#ffeb3b';
          ctx.fill();
        }
        // Inner glow
        ctx.beginPath();
        ctx.arc(0, 0, hs * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = '#ffeb3b';
        ctx.fill();
        break;
      }
      case Race.Deep: {
        // Raindrop / wave
        // Three raindrops
        for (let i = -1; i <= 1; i++) {
          const dx = i * hs * 0.45;
          const dy = i === 0 ? -hs * 0.15 : hs * 0.15;
          ctx.beginPath();
          ctx.moveTo(dx, dy - hs * 0.4);
          ctx.quadraticCurveTo(dx + hs * 0.25, dy + hs * 0.1, dx, dy + hs * 0.35);
          ctx.quadraticCurveTo(dx - hs * 0.25, dy + hs * 0.1, dx, dy - hs * 0.4);
          ctx.fillStyle = i === 0 ? '#4fc3f7' : '#81d4fa';
          ctx.fill();
        }
        break;
      }
      case Race.Wild: {
        // Claw marks (3 diagonal slashes)
        ctx.strokeStyle = '#ff5722';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        for (let i = -1; i <= 1; i++) {
          const dx = i * hs * 0.35;
          ctx.beginPath();
          ctx.moveTo(dx - hs * 0.2, -hs * 0.6);
          ctx.lineTo(dx + hs * 0.2, hs * 0.6);
          ctx.stroke();
        }
        ctx.lineCap = 'butt';
        break;
      }
      case Race.Geists: {
        // Skull
        ctx.beginPath();
        ctx.arc(0, -hs * 0.1, hs * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = '#e0e0e0';
        ctx.fill();
        // Jaw
        ctx.beginPath();
        ctx.moveTo(-hs * 0.35, hs * 0.2);
        ctx.quadraticCurveTo(0, hs * 0.75, hs * 0.35, hs * 0.2);
        ctx.fillStyle = '#bdbdbd';
        ctx.fill();
        // Eyes
        ctx.fillStyle = '#4a148c';
        ctx.beginPath();
        ctx.ellipse(-hs * 0.2, -hs * 0.15, hs * 0.14, hs * 0.18, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(hs * 0.2, -hs * 0.15, hs * 0.14, hs * 0.18, 0, 0, Math.PI * 2);
        ctx.fill();
        // Nose
        ctx.beginPath();
        ctx.moveTo(-hs * 0.06, hs * 0.05);
        ctx.lineTo(hs * 0.06, hs * 0.05);
        ctx.lineTo(0, hs * 0.18);
        ctx.closePath();
        ctx.fillStyle = '#616161';
        ctx.fill();
        break;
      }
      case Race.Tenders: {
        // Seed / sprout
        // Seed body
        ctx.beginPath();
        ctx.ellipse(0, hs * 0.15, hs * 0.4, hs * 0.35, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#8d6e63';
        ctx.fill();
        ctx.strokeStyle = '#5d4037';
        ctx.lineWidth = 1;
        ctx.stroke();
        // Sprout
        ctx.beginPath();
        ctx.moveTo(0, -hs * 0.15);
        ctx.quadraticCurveTo(-hs * 0.3, -hs * 0.6, -hs * 0.15, -hs * 0.8);
        ctx.strokeStyle = '#4caf50';
        ctx.lineWidth = 2;
        ctx.stroke();
        // Leaf
        ctx.beginPath();
        ctx.moveTo(-hs * 0.15, -hs * 0.7);
        ctx.quadraticCurveTo(-hs * 0.5, -hs * 0.9, -hs * 0.1, -hs * 0.55);
        ctx.fillStyle = '#66bb6a';
        ctx.fill();
        // Second leaf
        ctx.beginPath();
        ctx.moveTo(-hs * 0.05, -hs * 0.45);
        ctx.quadraticCurveTo(hs * 0.35, -hs * 0.7, hs * 0.05, -hs * 0.35);
        ctx.fillStyle = '#81c784';
        ctx.fill();
        break;
      }
    }

    ctx.restore();
  }

  private drawAbilityOverlay(ctx: CanvasRenderingContext2D): void {
    const cam = this.camera;
    const player = this.game.state.players[this.pid];
    if (!player) return;
    const def = RACE_ABILITY_DEFS[player.race];
    const cw = this.canvas.clientWidth;

    // Race-specific targeting colors
    const colors: Record<Race, { fill: string; stroke: string; text: string }> = {
      [Race.Demon]:  { fill: 'rgba(255, 80, 0, 0.15)',  stroke: 'rgba(255, 120, 0, 0.7)',  text: '#ff8a65' },
      [Race.Wild]:   { fill: 'rgba(255, 100, 30, 0.12)', stroke: 'rgba(255, 150, 50, 0.6)', text: '#ffab91' },
      [Race.Geists]: { fill: 'rgba(160, 80, 220, 0.15)', stroke: 'rgba(180, 130, 255, 0.6)', text: '#ce93d8' },
      [Race.Crown]:  { fill: 'rgba(180, 120, 255, 0.15)', stroke: 'rgba(180, 120, 255, 0.6)', text: '#e1bee7' },
      [Race.Horde]:  { fill: 'rgba(180, 120, 255, 0.15)', stroke: 'rgba(180, 120, 255, 0.6)', text: '#e1bee7' },
      [Race.Goblins]: { fill: 'rgba(180, 120, 255, 0.15)', stroke: 'rgba(180, 120, 255, 0.6)', text: '#e1bee7' },
      [Race.Oozlings]: { fill: 'rgba(180, 120, 255, 0.15)', stroke: 'rgba(180, 120, 255, 0.6)', text: '#e1bee7' },
      [Race.Deep]:   { fill: 'rgba(80, 150, 220, 0.15)', stroke: 'rgba(100, 180, 255, 0.6)', text: '#81d4fa' },
      [Race.Tenders]: { fill: 'rgba(100, 180, 100, 0.15)', stroke: 'rgba(130, 200, 130, 0.6)', text: '#a5d6a7' },
    };
    const c = colors[player.race];

    // Draw radius circle at cursor
    if (def.aoeRadius) {
      const radiusScreen = def.aoeRadius * TILE_SIZE * cam.zoom;
      // Pulsing ring
      const pulse = 0.7 + 0.3 * Math.sin(Date.now() * 0.005);
      ctx.beginPath();
      ctx.arc(this.pointerX, this.pointerY, radiusScreen, 0, Math.PI * 2);
      ctx.fillStyle = c.fill;
      ctx.fill();
      ctx.strokeStyle = c.stroke;
      ctx.lineWidth = 2 * pulse;
      ctx.stroke();
      // Inner crosshair
      ctx.strokeStyle = c.stroke;
      ctx.lineWidth = 1;
      const cross = 6;
      ctx.beginPath();
      ctx.moveTo(this.pointerX - cross, this.pointerY);
      ctx.lineTo(this.pointerX + cross, this.pointerY);
      ctx.moveTo(this.pointerX, this.pointerY - cross);
      ctx.lineTo(this.pointerX, this.pointerY + cross);
      ctx.stroke();
    }

    // Instruction banner with icon
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(0, 38, cw, 52);
    // Draw ability icon in the banner
    this.drawAbilityIcon(ctx, player.race, cw / 2 - 100, 50, 16);
    ctx.fillStyle = c.text;
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`CAST ${def.name.toUpperCase()}`, cw / 2, 60);
    ctx.fillStyle = '#999';
    ctx.font = '11px monospace';
    ctx.fillText(this.isTouchDevice ? 'Tap to cast' : 'Click to cast  •  ESC / Right-click to cancel', cw / 2, 78);
    if (def.requiresVision) {
      ctx.fillStyle = '#ff8a65';
      ctx.font = 'italic 11px monospace';
      ctx.fillText('(requires vision)', cw / 2 + 120, 78);
    }
    ctx.textAlign = 'start';
  }

  private isNukeLocked(): boolean {
    const state = this.game.state;
    return state.tick < NUKE_LOCKOUT_SECONDS * TICK_RATE;
  }

  private drawNukeOverlay(ctx: CanvasRenderingContext2D): void {
    const cam = this.camera;
    const team = this.game.state.players[this.pid]?.team ?? Team.Bottom;

    // Draw red blocked zone over enemy half (can't nuke there)
    const mapDef = this.game.state.mapDef;
    let forbidScreenX1: number, forbidScreenY1: number, forbidScreenX2: number, forbidScreenY2: number;
    // Forbidden = everything outside the team's nukeZone
    const nukeZone = mapDef.nukeZone[team];
    if (mapDef.shapeAxis === 'y') {
      // Portrait: forbidden zone along y-axis
      const forbidMinY = nukeZone.min > 0 ? 0 : nukeZone.max;
      const forbidMaxY = nukeZone.min > 0 ? nukeZone.min : mapDef.height;
      const { px: fx1, py: fy1 } = this.tp(0, forbidMinY);
      const { px: fx2, py: fy2 } = this.tp(mapDef.width, forbidMaxY);
      forbidScreenX1 = (fx1 - cam.x) * cam.zoom;
      forbidScreenY1 = (fy1 - cam.y) * cam.zoom;
      forbidScreenX2 = (fx2 - cam.x) * cam.zoom;
      forbidScreenY2 = (fy2 - cam.y) * cam.zoom;
    } else {
      // Landscape: forbidden zone along x-axis
      const forbidMinX = nukeZone.min > 0 ? 0 : nukeZone.max;
      const forbidMaxX = nukeZone.min > 0 ? nukeZone.min : mapDef.width;
      const { px: fx1, py: fy1 } = this.tp(forbidMinX, 0);
      const { px: fx2, py: fy2 } = this.tp(forbidMaxX, mapDef.height);
      forbidScreenX1 = (fx1 - cam.x) * cam.zoom;
      forbidScreenY1 = (fy1 - cam.y) * cam.zoom;
      forbidScreenX2 = (fx2 - cam.x) * cam.zoom;
      forbidScreenY2 = (fy2 - cam.y) * cam.zoom;
    }
    ctx.fillStyle = 'rgba(255, 0, 0, 0.15)';
    ctx.fillRect(forbidScreenX1, forbidScreenY1, forbidScreenX2 - forbidScreenX1, forbidScreenY2 - forbidScreenY1);

    // Striped forbidden border
    ctx.strokeStyle = 'rgba(255, 50, 0, 0.6)';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 6]);
    if (mapDef.shapeAxis === 'y') {
      // Border at the edge between forbidden and allowed zones
      const borderY = nukeZone.min > 0 ? forbidScreenY2 : forbidScreenY1;
      ctx.beginPath();
      ctx.moveTo(forbidScreenX1, borderY);
      ctx.lineTo(forbidScreenX2, borderY);
      ctx.stroke();
    } else {
      const borderX = nukeZone.min > 0 ? forbidScreenX2 : forbidScreenX1;
      ctx.beginPath();
      ctx.moveTo(borderX, forbidScreenY1);
      ctx.lineTo(borderX, forbidScreenY2);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Light valid zone tint
    ctx.fillStyle = 'rgba(255, 100, 0, 0.04)';
    ctx.fillRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);

    // Radius preview circle at mouse position (PC only)
    if (this.pointerX > 0 && this.pointerY > 0) {
      const radiusScreen = NUKE_RADIUS * TILE_SIZE * cam.zoom;
      const pulse = 0.6 + 0.4 * Math.sin(Date.now() / 300);
      ctx.beginPath();
      ctx.arc(this.pointerX, this.pointerY, radiusScreen, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 60, 0, ${0.08 * pulse})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(255, 80, 0, ${0.5 * pulse})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Instruction text + warning
    const cw = this.canvas.clientWidth;
    ctx.fillStyle = '#ff5722';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(this.isTouchDevice ? 'TAP TO FIRE NUKE (own half only)' : 'CLICK TO FIRE NUKE (own half only)  [ESC to cancel]', cw / 2, 60);
    ctx.fillStyle = '#ffab40';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('YOU ONLY GET 1 NUKE PER MATCH', cw / 2, 80);
    ctx.textAlign = 'start';
  }

  private drawQuickChatRadial(ctx: CanvasRenderingContext2D): void {
    if (!this.quickChatRadialCenter) return;
    const cx = this.quickChatRadialCenter.x;
    const cy = this.quickChatRadialCenter.y;
    const selected = this.getQuickChatChoiceFromPointer();

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
    ctx.fillStyle = this.radialAccessibility ? 'rgba(0,0,0,0.95)' : 'rgba(10,10,10,0.9)';
    const radius = this.radialSize + (this.radialAccessibility ? 16 : 0);
    const optionOffset = radius + (this.radialAccessibility ? 34 : 22);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = this.radialAccessibility ? '#ffffff' : '#666';
    ctx.lineWidth = this.radialAccessibility ? 2 : 1;
    ctx.stroke();

    const drawOption = (x: number, y: number, label: string, active: boolean) => {
      const w = this.radialAccessibility ? 112 : 88;
      const h = this.radialAccessibility ? 30 : 24;
      ctx.fillStyle = active
        ? (this.radialAccessibility ? '#0d47a1' : 'rgba(41,121,255,0.28)')
        : (this.radialAccessibility ? '#212121' : 'rgba(40,40,40,0.8)');
      ctx.fillRect(x - w / 2, y - h / 2, w, h);
      ctx.strokeStyle = active ? '#ffffff' : (this.radialAccessibility ? '#cfd8dc' : '#555');
      ctx.strokeRect(x - w / 2, y - h / 2, w, h);
      ctx.fillStyle = active ? '#ffffff' : (this.radialAccessibility ? '#eceff1' : '#ddd');
      ctx.font = this.radialAccessibility ? 'bold 14px monospace' : 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(label, x, y + (this.radialAccessibility ? 5 : 4));
    };

    // 8 directions: cardinal + diagonal
    const diag = optionOffset * 0.707; // cos(45°)
    drawOption(cx - optionOffset, cy, 'Atk Left', selected === 'Attack Left');        // left
    drawOption(cx + optionOffset, cy, 'Atk Right', selected === 'Attack Right');       // right
    drawOption(cx, cy - optionOffset, 'Diamond', selected === 'Get Diamond');           // up
    drawOption(cx, cy + optionOffset, 'Defend', selected === 'Defend');                 // down
    drawOption(cx + diag, cy + diag, 'Sending', selected === 'Sending Now');            // down-right
    drawOption(cx - diag, cy + diag, 'Save Us', selected === 'Save Us');                // down-left
    drawOption(cx - diag, cy - diag, 'Random', selected === 'Random');                  // up-left
    drawOption(cx + diag, cy - diag, 'Ping', selected === 'Ping');                      // up-right

    // Pointer indicator
    ctx.beginPath();
    ctx.arc(this.pointerX, this.pointerY, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();

    // Center label
    ctx.fillStyle = this.radialAccessibility ? '#ffffff' : '#aaa';
    ctx.font = this.radialAccessibility ? 'bold 12px monospace' : '10px monospace';
    ctx.textAlign = 'center';
    if (this.isTouchDevice) {
      ctx.fillText('Drag & release', cx, cy + 4);
    } else {
      ctx.fillText('Hold Q, aim, release', cx, cy + 4);
    }
    ctx.textAlign = 'start';
  }

  private quickChatFeedback(success: boolean): void {
    if (!this.uiFeedbackEnabled) return;
    try {
      if (navigator.vibrate) navigator.vibrate(success ? 20 : [20, 20, 20]);
    } catch { /* ignore */ }
    try {
      if (!this.audioCtx) this.audioCtx = new AudioContext();
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = success ? 880 : 220;
      gain.gain.value = success ? 0.03 : 0.04;
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      const now = this.audioCtx.currentTime;
      osc.start(now);
      osc.stop(now + (success ? 0.06 : 0.09));
    } catch { /* ignore */ }
  }
}
