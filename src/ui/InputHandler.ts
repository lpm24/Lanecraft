import { Game } from '../game/Game';
import { Camera } from '../rendering/Camera';
import { Renderer } from '../rendering/Renderer';
import {
  BuildingType, TILE_SIZE, Lane,
  HarvesterAssignment, Team, Race, UnitState, NUKE_RADIUS,
} from '../simulation/types';
import { getBuildGridOrigin, getTeamAlleyOrigin, getHutGridOrigin } from '../simulation/GameState';
import { RACE_BUILDING_COSTS, UNIT_STATS, TOWER_STATS, RACE_COLORS, getRaceUsedResources, UPGRADE_TREES } from '../simulation/data';
import { TICK_RATE } from '../simulation/types';
import { UIAssets } from '../rendering/UIAssets';
import { SpriteLoader, drawSpriteFrame, getSpriteFrame } from '../rendering/SpriteLoader';
import { BuildingPopup } from './BuildingPopup';
import { getSafeBottom, getSafeTop } from './SafeArea';
import { getAudioSettings, updateAudioSettings } from '../audio/AudioSettings';
import { getVisualSettings, updateVisualSettings } from '../rendering/VisualSettings';

interface BuildTrayItem {
  type: BuildingType;
  label: string;
  key: string;
}

const BUILD_TRAY: BuildTrayItem[] = [
  { type: BuildingType.MeleeSpawner, label: 'Melee', key: '1' },
  { type: BuildingType.RangedSpawner, label: 'Ranged', key: '2' },
  { type: BuildingType.CasterSpawner, label: 'Caster', key: '3' },
  { type: BuildingType.Tower, label: 'Tower', key: '4' },
];

const ASSIGNMENT_CYCLE: HarvesterAssignment[] = [
  HarvesterAssignment.BaseGold,
  HarvesterAssignment.Wood,
  HarvesterAssignment.Stone,
  HarvesterAssignment.Center,
];

const ASSIGNMENT_LABELS: Record<HarvesterAssignment, string> = {
  [HarvesterAssignment.BaseGold]: '* Gold',
  [HarvesterAssignment.Wood]: 'W Wood',
  [HarvesterAssignment.Stone]: 'M Meat',
  [HarvesterAssignment.Center]: 'C Center',
};

const LANE_MODE_STORAGE_KEY = 'spawnwars.laneToggleMode';
const UI_FEEDBACK_STORAGE_KEY = 'spawnwars.uiFeedbackEnabled';
const RADIAL_ARM_MS_STORAGE_KEY = 'spawnwars.radialArmMs';
const RADIAL_SIZE_STORAGE_KEY = 'spawnwars.radialSize';
const RADIAL_A11Y_STORAGE_KEY = 'spawnwars.radialA11y';
const CAMERA_SNAP_STORAGE_KEY = 'spawnwars.cameraSnapOnSelect';
const MINIMAP_PAN_STORAGE_KEY = 'spawnwars.minimapPanEnabled';
const STICKY_BUILD_STORAGE_KEY = 'spawnwars.stickyBuildMode';
const MOBILE_HINT_SEEN_KEY = 'spawnwars.mobileHintSeen';
const NUKE_LOCKOUT_SECONDS = 60;

export class InputHandler {
  private game: Game;
  private canvas: HTMLCanvasElement;
  private camera: Camera;
  private selectedBuilding: BuildingType | null = null;
  /** Expose selected building for Renderer grid visibility. */
  get placingBuilding(): BuildingType | null { return this.selectedBuilding; }
  private hoveredGridSlot: { gx: number; gy: number; isAlley: boolean } | null = null;
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
  private activeTouchPointers = new Set<number>();
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
  private tooltip: { text: string; x: number; y: number } | null = null;
  private selectedUnitId: number | null = null;
  private hoveredUnitId: number | null = null;
  private showTutorial = true;
  private devOverlayOpen = false;
  private abortController = new AbortController();
  private currentRenderer: Renderer | null = null;
  private ui: UIAssets;
  private sprites: SpriteLoader | null = null;
  private buildingPopup = new BuildingPopup();
  private trayTick = 0;

  /** Called when the player taps "Quit Game" in the settings panel. */
  onQuitGame: (() => void) | null = null;
  /** Called when the player taps "Concede" in the settings panel (solo only). */
  onConcede: (() => void) | null = null;

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

  destroy(): void {
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
    updateVisualSettings({ screenShake: true, weather: true, dayNight: true });
  }

  private initMobileHint(): void {
    try {
      const seen = window.localStorage.getItem(MOBILE_HINT_SEEN_KEY) === '1';
      const touchCapable = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      this.mobileHintVisible = touchCapable && !seen;
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
    const laneRowY = y; y += rowH + gap;
    const feedbackRowY = y; y += rowH + gap;
    const cameraSnapRowY = y; y += rowH + gap;
    const minimapRowY = y; y += rowH + gap;
    const stickyRowY = y; y += rowH + gap;
    const holdDelayRowY = y; y += rowH + gap;
    const radialSizeRowY = y; y += rowH + gap;
    const radialA11yRowY = y; y += rowH + gap + 4;

    // Actions
    const resetRowY = y; y += rowH + gap + 8;
    let concedeRowY = -1;
    if (this.onConcede) { concedeRowY = y; y += rowH + gap + 8; }
    const quitRowY = y; y += rowH + pad;

    const panelH = y;

    return {
      sx, sy, pw, panelH, pad, rowH,
      audioHeaderY, musicRowY, sfxRowY,
      visualHeaderY, shakeRowY, weatherRowY, dayNightRowY,
      controlsHeaderY, laneRowY, feedbackRowY, cameraSnapRowY, minimapRowY,
      stickyRowY, holdDelayRowY, radialSizeRowY, radialA11yRowY,
      resetRowY, concedeRowY, quitRowY,
    };
  }

  private drawSettingsPanel(ctx: CanvasRenderingContext2D): void {
    const L = this.getSettingsPanelLayout();
    const { sx, sy, pw, panelH, pad, rowH } = L;
    const rw = pw - pad * 2;
    const rx = sx + pad;
    const audio = getAudioSettings();
    const vis = getVisualSettings();

    // Panel background
    if (!this.ui.drawWoodTable(ctx, sx, sy, pw, panelH)) {
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
      ctx.font = 'bold 9px monospace';
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
      return true;
    }
    // Close button
    if (cx >= sx + pw - 22 && cx < sx + pw - 6 && cy >= sy + 4 && cy < sy + 20) {
      this.settingsOpen = false;
      return true;
    }

    const inRow = (rowY: number) => cx >= rx && cx < rx + rw && cy >= sy + rowY && cy < sy + rowY + rowH;

    // Audio sliders (click sets value)
    if (inRow(L.musicRowY)) {
      const trackX = rx + 92;
      const trackW = rw - 100;
      const v = Math.max(0, Math.min(1, (cx - trackX) / trackW));
      updateAudioSettings({ musicVolume: v });
      return true;
    }
    if (inRow(L.sfxRowY)) {
      const trackX = rx + 92;
      const trackW = rw - 100;
      const v = Math.max(0, Math.min(1, (cx - trackX) / trackW));
      updateAudioSettings({ sfxVolume: v });
      return true;
    }

    // Visual toggles
    if (inRow(L.shakeRowY)) {
      const vis = getVisualSettings();
      updateVisualSettings({ screenShake: !vis.screenShake });
      return true;
    }
    if (inRow(L.weatherRowY)) {
      const vis = getVisualSettings();
      updateVisualSettings({ weather: !vis.weather });
      return true;
    }
    if (inRow(L.dayNightRowY)) {
      const vis = getVisualSettings();
      updateVisualSettings({ dayNight: !vis.dayNight });
      return true;
    }

    // Controls toggles
    if (inRow(L.laneRowY)) {
      this.laneToggleMode = this.laneToggleMode === 'double' ? 'single' : 'double';
      this.saveLaneMode();
      return true;
    }
    if (inRow(L.feedbackRowY)) {
      this.uiFeedbackEnabled = !this.uiFeedbackEnabled;
      this.saveUiFeedbackEnabled();
      return true;
    }
    if (inRow(L.cameraSnapRowY)) {
      this.cameraSnapOnSelect = !this.cameraSnapOnSelect;
      this.saveGameplaySettings();
      return true;
    }
    if (inRow(L.minimapRowY)) {
      this.minimapPanEnabled = !this.minimapPanEnabled;
      this.saveGameplaySettings();
      return true;
    }
    if (inRow(L.stickyRowY)) {
      this.stickyBuildMode = !this.stickyBuildMode;
      this.saveGameplaySettings();
      return true;
    }
    if (inRow(L.holdDelayRowY)) {
      this.radialArmMs = this.radialArmMs >= 500 ? 240 : this.radialArmMs + 40;
      this.saveRadialSettings();
      return true;
    }
    if (inRow(L.radialSizeRowY)) {
      this.radialSize = this.radialSize >= 110 ? 60 : this.radialSize + 8;
      this.saveRadialSettings();
      return true;
    }
    if (inRow(L.radialA11yRowY)) {
      this.radialAccessibility = !this.radialAccessibility;
      this.saveRadialSettings();
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

  private eventToWorld(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    return this.camera.screenToWorld(canvasX, canvasY);
  }

  private setupKeyboard(): void {
    const sig = { signal: this.abortController.signal };
    window.addEventListener('keydown', (e) => {
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

      if (e.key === 'm' || e.key === 'M') {
        this.nukeTargeting = false;
        this.selectedUnitId = null;
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
        this.game.sendCommand({ type: 'ping', playerId: this.pid, x: wx / TILE_SIZE, y: wy / TILE_SIZE });
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
        this.selectedUnitId = null;
        if (this.selectedBuilding === item.type) {
          this.selectedBuilding = null;
        } else {
          this.selectedBuilding = item.type;
          if (this.cameraSnapOnSelect) this.panToBuildArea(item.type);
        }
        return;
      }
      if (e.key === 'Escape') {
        if (this.buildingPopup.isOpen()) { this.buildingPopup.close(); return; }
        if (this.showTutorial) { this.showTutorial = false; return; }
        this.quickChatRadialActive = false;
        this.quickChatRadialCenter = null;
        this.settingsOpen = false;
        this.selectedBuilding = null;
        this.nukeTargeting = false;
        this.selectedUnitId = null;
      }
      if (e.key === 'l' || e.key === 'L') {
        const myBuildings = this.game.state.buildings.filter(b => b.playerId === this.pid);
        const currentLane = myBuildings.length > 0 ? myBuildings[0].lane : Lane.Left;
        this.game.sendCommand({ type: 'toggle_all_lanes', playerId: this.pid, lane: currentLane === Lane.Left ? Lane.Right : Lane.Left });
      }
    }, sig);
    window.addEventListener('keyup', (e) => {
      if (e.key !== 'q' && e.key !== 'Q') return;
      if (!this.quickChatRadialActive) return;
      const msg = this.getQuickChatChoiceFromPointer();
      this.quickChatRadialActive = false;
      this.quickChatRadialCenter = null;
      if (msg) this.sendQuickChat(msg);
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
        const wx = world.x / TILE_SIZE;
        const wy = world.y / TILE_SIZE;

        // Check for unit hover (closest within 1.2 tiles)
        const unit = this.findUnitNear(wx, wy, 1.2);
        if (unit) {
          this.hoveredUnitId = unit.id;
          this.tooltip = { text: this.getUnitTooltip(unit), x: e.clientX, y: e.clientY - 20 };
        } else {
          // Check for building hover
          const tileX = Math.floor(wx);
          const tileY = Math.floor(wy);
          const building = this.game.state.buildings.find(b =>
            b.playerId === this.pid && b.worldX === tileX && b.worldY === tileY
          );
          if (building) {
            this.hoveredBuildingId = building.id;
            this.tooltip = { text: this.getBuildingTooltip(building), x: e.clientX, y: e.clientY - 20 };
          }
        }
      }
    }, sig);

    this.canvas.addEventListener('click', (e) => {
      if (Date.now() < this.suppressClicksUntil) return;
      if (this.devOverlayOpen) { this.devOverlayOpen = false; return; }
      if (this.handleHelpButtonClick(e)) return;
      if (this.showTutorial) { this.showTutorial = false; return; }
      if (this.mobileHintVisible) this.dismissMobileHint();

      // Minimap click → pan camera to that world position
      if (this.currentRenderer) {
        const rect = this.canvas.getBoundingClientRect();
        const hit = this.currentRenderer.minimapHitTest(e.clientX - rect.left, e.clientY - rect.top);
        if (hit) {
          if (this.minimapPanEnabled) this.camera.panTo(hit.worldX, hit.worldY);
          return;
        }
      }

      // UI panels consume click first
      if (this.handleUIClick(e)) return;

      if (this.quickChatRadialActive) {
        const msg = this.getQuickChatChoiceFromPointer();
        this.quickChatRadialActive = false;
        this.quickChatRadialCenter = null;
        if (msg) this.sendQuickChat(msg);
        return;
      }

      // Nuke targeting — restricted to own half + mid
      if (this.nukeTargeting) {
        const world = this.eventToWorld(e);
        const tileX = world.x / TILE_SIZE;
        const tileY = world.y / TILE_SIZE;
        const team = this.game.state.players[this.pid]?.team ?? Team.Bottom;
        const md = this.game.state.mapDef;
        const nukeZone = md.nukeZone[team];
        const nukeAxis = md.shapeAxis === 'x' ? tileX : tileY;
        if (nukeAxis < nukeZone.min || nukeAxis > nukeZone.max) return; // click outside nuke zone — ignore
        this.game.sendCommand({
          type: 'fire_nuke', playerId: this.pid,
          x: world.x / TILE_SIZE, y: tileY,
        });
        this.nukeTargeting = false;
        return;
      }

      if (this.selectedBuilding === null) {
        this.handleBuildingClick(e);
        return;
      }

      // Miner hut: click anywhere on map to confirm auto-placement
      if (this.selectedBuilding === BuildingType.HarvesterHut) {
        this.game.sendCommand({ type: 'build_hut', playerId: this.pid });
        if (!e.shiftKey && !this.stickyBuildMode) {
          this.selectedBuilding = null;
        }
        return;
      }

      const world = this.eventToWorld(e);
      const slot = this.worldToGridSlot(this.pid, world.x, world.y);
      if (slot) {
        this.game.sendCommand({
          type: 'place_building', playerId: this.pid,
          buildingType: this.selectedBuilding, gridX: slot.gx, gridY: slot.gy,
          ...(slot.isAlley ? { gridType: 'alley' as const } : {}),
        });
        if (!e.shiftKey && !this.stickyBuildMode) {
          this.selectedBuilding = null;
        }
      }
    }, sig);

    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();

      if (this.quickChatRadialActive) {
        this.quickChatRadialActive = false;
        this.quickChatRadialCenter = null;
        return;
      }

      // If building mode, just deselect
      if (this.selectedBuilding !== null || this.nukeTargeting) {
        this.selectedBuilding = null;
        this.nukeTargeting = false;
        return;
      }
    }, sig);

    this.canvas.addEventListener('auxclick', (e) => {
      if (e.button !== 1 || this.showTutorial) return;
      e.preventDefault();
      const world = this.eventToWorld(e as unknown as MouseEvent);
      this.game.sendCommand({
        type: 'ping', playerId: this.pid,
        x: world.x / TILE_SIZE, y: world.y / TILE_SIZE,
      });
    }, sig);

    // Touch radial (emote wheel) disabled on mobile — was conflicting with map drag.
    // Quick chat still accessible via Q key on desktop.
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      this.activeTouchPointers.add(e.pointerId);
    }, sig);

    this.canvas.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'touch') return;
      this.activeTouchPointers.delete(e.pointerId);
    }, sig);

    this.canvas.addEventListener('pointercancel', () => {
      this.activeTouchPointers.clear();
    }, sig);
  }

  /** Pan camera to the build area for a given building type */
  private panToBuildArea(type: BuildingType): void {
    if (type === BuildingType.Tower) {
      const team = this.game.state.players[this.pid]?.team ?? Team.Bottom;
      const alley = getTeamAlleyOrigin(team, this.game.state.mapDef);
      const cx = (alley.x + this.game.state.mapDef.towerAlleyCols / 2) * TILE_SIZE;
      const cy = (alley.y + this.game.state.mapDef.towerAlleyRows / 2) * TILE_SIZE;
      this.camera.panTo(cx, cy, 1.8);
    } else {
      const origin = getBuildGridOrigin(this.pid, this.game.state.mapDef, this.game.state.players);
      const cx = (origin.x + this.game.state.mapDef.buildGridCols / 2) * TILE_SIZE;
      const cy = (origin.y + this.game.state.mapDef.buildGridRows / 2) * TILE_SIZE;
      this.camera.panTo(cx, cy, 1.8);
    }
  }

  /** Pan camera to the harvester hut area */
  private panToHutArea(): void {
    const origin = getHutGridOrigin(this.pid, this.game.state.mapDef, this.game.state.players);
    const cx = (origin.x + this.game.state.mapDef.hutGridCols / 2) * TILE_SIZE;
    const cy = (origin.y + this.game.state.mapDef.hutGridRows / 2) * TILE_SIZE;
    this.camera.panTo(cx, cy, 1.8);
  }

  private worldToGridSlot(playerId: number, worldPixelX: number, worldPixelY: number): { gx: number; gy: number; isAlley: boolean } | null {
    const tx = Math.floor(worldPixelX / TILE_SIZE);
    const ty = Math.floor(worldPixelY / TILE_SIZE);

    // Check shared tower alley first (only for Tower type)
    if (this.selectedBuilding === BuildingType.Tower) {
      const team = this.game.state.players[playerId]?.team ?? Team.Bottom;
      const alley = getTeamAlleyOrigin(team, this.game.state.mapDef);
      const agx = tx - alley.x, agy = ty - alley.y;
      if (agx >= 0 && agx < this.game.state.mapDef.towerAlleyCols && agy >= 0 && agy < this.game.state.mapDef.towerAlleyRows) {
        return { gx: agx, gy: agy, isAlley: true };
      }
    }

    // Military grid
    const origin = getBuildGridOrigin(playerId, this.game.state.mapDef, this.game.state.players);
    const gx = tx - origin.x, gy = ty - origin.y;
    if (gx < 0 || gx >= this.game.state.mapDef.buildGridCols || gy < 0 || gy >= this.game.state.mapDef.buildGridRows) return null;
    return { gx, gy, isAlley: false };
  }

  private handleBuildingClick(e: MouseEvent): void {
    const world = this.eventToWorld(e);
    const tileX = Math.floor(world.x / TILE_SIZE);
    const tileY = Math.floor(world.y / TILE_SIZE);
    const building = this.game.state.buildings.find(b =>
      b.playerId === this.pid && b.worldX === tileX && b.worldY === tileY
    );
    if (!building) {
      // Click outside building: close popup if open, try selecting a unit
      if (this.buildingPopup.isOpen()) {
        this.buildingPopup.close();
      }
      const wx = world.x / TILE_SIZE;
      const wy = world.y / TILE_SIZE;
      const unit = this.findUnitNear(wx, wy, 1.2);
      this.selectedUnitId = unit ? unit.id : null;
      return;
    }
    this.selectedUnitId = null;
    this.selectedBuildingId = building.id;

    // Click on hut: cycle harvester assignment (skip resources the race doesn't use)
    if (building.type === BuildingType.HarvesterHut) {
      const h = this.game.state.harvesters.find(h => h.hutId === building.id);
      if (h) {
        const player = this.game.state.players[this.pid];
        const used = player ? getRaceUsedResources(player.race) : { gold: true, wood: true, stone: true };
        const cycle = ASSIGNMENT_CYCLE.filter(a =>
          a === HarvesterAssignment.Center ||
          (a === HarvesterAssignment.BaseGold && used.gold) ||
          (a === HarvesterAssignment.Wood && used.wood) ||
          (a === HarvesterAssignment.Stone && used.stone)
        );
        const curIdx = cycle.indexOf(h.assignment);
        const nextAssignment = cycle[(curIdx + 1) % cycle.length];
        this.game.sendCommand({
          type: 'set_hut_assignment', playerId: this.pid,
          hutId: building.id, assignment: nextAssignment,
        });
      }
      return;
    }

    // Open building popup for spawners and towers
    this.buildingPopup.open(building.id);
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
    if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'Attack Left' : 'Attack Right';
    return dy < 0 ? 'Get Diamond' : 'Defend';
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

    const pw = Math.min(W - 24, 760);
    const ph = Math.min(H - 24, compact ? 560 : 640);
    const px = (W - pw) / 2;
    const py = (H - ph) / 2;

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

    heading('LANECRAFT', '#fff');
    line('2v2 RTS: destroy enemy HQ or bring Diamond home to win.', '#ccc');
    y += compact ? 0 : 2;
    rule();

    heading('THE MAP');
    line('Bottom base is yours, top base is enemy.');
    line('Lanes merge, split around center, then merge again.');
    line('Gold near HQ; wood left tip; meat right tip.');
    y += compact ? 0 : 2;
    rule();

    heading('BUILD');
    line('[1-4] place buildings, [M] add miner hut.', '#eee');
    line('Right-click own building to sell after cooldown.', '#eee');
    line('[U]/[I] upgrades selected or hovered building.', '#eee');
    y += compact ? 0 : 2;
    rule();

    heading('COMBAT & LANES');
    line('Units auto-aggro nearby enemies and fight.');
    line('Click spawner toggles lane (Fast or Safe tap mode).');
    line('[L] flips all spawners; [N] arms nuke targeting.');
    y += compact ? 0 : 2;
    rule();

    heading('CENTER');
    line('Mine center cells to expose the Diamond.');
    line('Carry Diamond to your HQ for instant win.');
    y += compact ? 0 : 2;
    rule();

    heading('HOTKEYS', '#ff9800');
    line('[P/MMB] ping  [Q] chat wheel  [Z/X/C/V] quick chat');
    line('[WASD/drag] pan  [Scroll] zoom  [Esc] cancel');
    line('Mobile: hold map for chat wheel.');
    line('Use ? (top-right) to reopen this help.', '#9bb7ff');

    const btnX = px + pw - closeSize - inset;
    const btnY = py + inset;
    // Close button - X icon sprite
    if (!this.ui.drawIcon(ctx, 'close', btnX, btnY, closeSize)) {
      ctx.fillStyle = 'rgba(41,121,255,0.15)';
      ctx.fillRect(btnX, btnY, closeSize, closeSize);
      ctx.strokeStyle = '#2979ff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(btnX, btnY, closeSize, closeSize);
      ctx.fillStyle = '#aaa';
      ctx.font = `bold ${headingSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('X', btnX + closeSize / 2, btnY + (compact ? 19 : 22));
      ctx.textAlign = 'start';
    }
  }

  private getHelpButtonRect(): { x: number; y: number; w: number; h: number } {
    const size = 30;
    return { x: this.canvas.clientWidth - size - 10, y: 10 + getSafeTop(), w: size, h: size };
  }

  private getSettingsButtonRect(): { x: number; y: number; w: number; h: number } {
    const size = 30;
    return { x: this.canvas.clientWidth - size * 2 - 18, y: 10 + getSafeTop(), w: size, h: size };
  }

  private handleHelpButtonClick(e: MouseEvent): boolean {
    const rect = this.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    // Settings button (top-right, left of info)
    const sr = this.getSettingsButtonRect();
    if (cx >= sr.x && cx <= sr.x + sr.w && cy >= sr.y && cy <= sr.y + sr.h) {
      this.settingsOpen = !this.settingsOpen;
      this.showTutorial = false;
      return true;
    }

    const r = this.getHelpButtonRect();
    if (cx < r.x || cx > r.x + r.w || cy < r.y || cy > r.y + r.h) return false;
    this.showTutorial = !this.showTutorial;
    this.quickChatRadialActive = false;
    this.quickChatRadialCenter = null;
    this.settingsOpen = false;
    return true;
  }

  private drawHelpButton(ctx: CanvasRenderingContext2D): void {
    // Settings button (left of info)
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

    // Info button
    const r = this.getHelpButtonRect();
    if (this.showTutorial) {
      ctx.fillStyle = 'rgba(41,121,255,0.35)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    // Use info icon sprite
    if (!this.ui.drawIcon(ctx, 'info', r.x, r.y, r.w)) {
      ctx.fillStyle = 'rgba(18,18,18,0.92)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = '#9bb7ff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = '#e3f2fd';
      ctx.font = 'bold 18px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('?', r.x + r.w / 2, r.y + 21);
      ctx.textAlign = 'start';
    }
  }

  private getTrayLayout() {
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    const safeBottom = getSafeBottom();
    const milH = 68;
    const milY = H - milH - safeBottom;
    // Miner button + 4 military + nuke = 6 buttons total
    const milW = W / 6;
    return { W, H, milH, milY, milW, safeBottom };
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

    // Building popup takes priority
    if (this.buildingPopup.isOpen()) {
      const result = this.buildingPopup.handleClick(popupCx, popupCy);
      if (result) {
        const bId = this.buildingPopup.getBuildingId();
        if (bId !== null) {
          if (result.action === 'upgrade') {
            this.game.sendCommand({ type: 'purchase_upgrade', playerId: this.pid, buildingId: bId, choice: result.choice });
          } else if (result.action === 'sell') {
            this.game.sendCommand({ type: 'sell_building', playerId: this.pid, buildingId: bId });
            this.buildingPopup.close();
          } else if (result.action === 'toggle_lane') {
            const b = this.game.state.buildings.find(b => b.id === bId);
            if (b) {
              const nextLane = b.lane === Lane.Left ? Lane.Right : Lane.Left;
              this.game.sendCommand({ type: 'toggle_lane', playerId: this.pid, buildingId: bId, lane: nextLane });
            }
          } else if (result.action === 'close') {
            this.buildingPopup.close();
          }
        }
        return true;
      }
      // Click inside popup but not on a button
      if (this.buildingPopup.containsPoint(popupCx, popupCy)) return true;
      // Click outside popup — close it
      this.buildingPopup.close();
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

    if (cy >= milY && cy < milY + milH) {
      const colIdx = Math.floor(cx / milW);
      if (colIdx === 0) {
        // Miner button — select-then-place flow
        this.nukeTargeting = false;
        this.selectedUnitId = null;
        if (this.selectedBuilding === BuildingType.HarvesterHut) {
          this.selectedBuilding = null;
        } else {
          this.selectedBuilding = BuildingType.HarvesterHut;
          if (this.cameraSnapOnSelect) this.panToHutArea();
        }
      } else if (colIdx >= 1 && colIdx <= BUILD_TRAY.length) {
        const item = BUILD_TRAY[colIdx - 1];
        this.nukeTargeting = false;
        this.selectedUnitId = null;
        if (this.selectedBuilding === item.type) {
          this.selectedBuilding = null;
        } else {
          this.selectedBuilding = item.type;
          if (this.cameraSnapOnSelect) this.panToBuildArea(item.type);
        }
      } else if (colIdx === BUILD_TRAY.length + 1) {
        if (player.nukeAvailable && !this.isNukeLocked()) {
          this.selectedBuilding = null;
          this.nukeTargeting = !this.nukeTargeting;
        }
      }
      return true;
    }

    return false;
  }

  render(renderer: Renderer): void {
    this.currentRenderer = renderer;
    if (!this.sprites) this.sprites = renderer.sprites;
    this.trayTick++;
    this.processQueuedQuickChat();
    const ctx = renderer.ctx;
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    this.drawBuildTray(ctx);
    this.drawHelpButton(ctx);

    if (this.showTutorial) {
      this.drawTutorial(ctx);
      return; // don't draw other overlays while tutorial is open
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
    }

    // Hovered unit highlight ring
    if (this.hoveredUnitId !== null && this.hoveredUnitId !== this.selectedUnitId) {
      const hu = this.game.state.units.find(u => u.id === this.hoveredUnitId);
      if (hu) {
        ctx.save();
        renderer.camera.applyTransform(ctx);
        const hpx = hu.x * TILE_SIZE + TILE_SIZE / 2;
        const hpy = hu.y * TILE_SIZE + TILE_SIZE / 2;
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

    if (this.tooltip) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
      ctx.font = '14px monospace';
      const w = ctx.measureText(this.tooltip.text).width + 16;
      ctx.fillRect(this.tooltip.x - w / 2, this.tooltip.y - 18, w, 24);
      ctx.fillStyle = '#ddd';
      ctx.textAlign = 'center';
      ctx.fillText(this.tooltip.text, this.tooltip.x, this.tooltip.y);
      ctx.textAlign = 'start';
    }

    if (this.devOverlayOpen) {
      this.drawDevOverlay(ctx);
    }
  }

  private drawBuildTray(ctx: CanvasRenderingContext2D): void {
    const { W, milH, milY, milW, safeBottom } = this.getTrayLayout();
    const player = this.game.state.players[this.pid];
    const quickChatCdMs = Math.max(0, this.quickChatCooldownUntil - Date.now());

    // Safe area bar below tray for rounded phone corners
    if (safeBottom > 0) {
      ctx.fillStyle = '#1a1008';
      ctx.fillRect(0, milY + milH, W, safeBottom);
    }

    // Build tray background - WoodTable 9-slice
    if (!this.ui.drawWoodTable(ctx, 0, milY, W, milH)) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
      ctx.fillRect(0, milY, W, milH);
    }

    // (PING/CHAT utility buttons removed — accessible via Q key / radial on desktop)
    // --- Helper: draw colorized cost parts with resource icons ---
    const costIconSize = 14;
    const drawCost = (parts: { val: number; type: 'g' | 'w' | 's' }[], cx: number, cy: number, affordable: boolean) => {
      const goldColor = affordable ? '#ffd740' : '#665500';
      const woodColor = affordable ? '#81c784' : '#2e5530';
      const stoneColor = affordable ? '#e57373' : '#6d2828';
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
        ctx.fillStyle = parts[j].type === 'g' ? goldColor : parts[j].type === 'w' ? woodColor : stoneColor;
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
        // Use building sprite for tower
        const towerImg = this.sprites?.getBuildingSprite(BuildingType.Tower, 0);
        if (towerImg) {
          const aspect = towerImg.width / towerImg.height;
          const dh = spriteSize;
          const dw = dh * aspect;
          ctx.drawImage(towerImg, Math.round(cellCx - dw / 2), Math.round(adjBaseY - dh), dw, dh);
        }
      } else if (spriteCategory === 'miner') {
        // Use building sprite for harvester hut
        const hutImg = this.sprites?.getBuildingSprite(BuildingType.HarvesterHut, 0);
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

      // Name
      const textY = adjBaseY + 3;
      ctx.textAlign = 'center';
      ctx.fillStyle = canAfford ? '#eee' : '#666';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(name, cellCx, textY + 10);

      // Cost or free text
      if (freeText) {
        ctx.fillStyle = '#4caf50'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
        ctx.fillText(freeText, cellCx, textY + 24);
      } else if (costParts && costParts.length > 0) {
        drawCost(costParts, cellCx, textY + 24, canAfford);
      }

      // Key hint
      ctx.fillStyle = '#444'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
      ctx.fillText(`[${keyHint}]`, cellCx, cellY + cellH - 4);
    };

    // === Miner button (col 0) ===
    const myHuts = this.game.state.buildings.filter(
      b => b.playerId === this.pid && b.type === BuildingType.HarvesterHut
    );
    const hutBase = RACE_BUILDING_COSTS[player.race][BuildingType.HarvesterHut];
    const hutMult = Math.pow(1.35, Math.max(0, myHuts.length - 1));
    const hutGold = Math.floor(hutBase.gold * hutMult);
    const hutWood = Math.floor(hutBase.wood * hutMult);
    const hutStone = Math.floor(hutBase.stone * hutMult);
    const canAffordHut = player.gold >= hutGold && player.wood >= hutWood && player.stone >= hutStone && myHuts.length < 10;
    const hutCostItems: { val: number; type: 'g' | 'w' | 's' }[] = [];
    if (hutGold > 0) hutCostItems.push({ val: hutGold, type: 'g' });
    if (hutWood > 0) hutCostItems.push({ val: hutWood, type: 'w' });
    if (hutStone > 0) hutCostItems.push({ val: hutStone, type: 's' });
    const hutSelected = this.selectedBuilding === BuildingType.HarvesterHut;
    drawCell(0, hutSelected, canAffordHut, 'Miner', 'miner',
      myHuts.length < 10 ? hutCostItems : null,
      myHuts.length >= 10 ? 'MAX' : null, 'M');

    // === Military buttons (cols 1-4) ===
    for (let i = 0; i < BUILD_TRAY.length; i++) {
      const item = BUILD_TRAY[i];
      const bx = (i + 1) * milW;
      const isSelected = this.selectedBuilding === item.type;
      const cost = RACE_BUILDING_COSTS[race][item.type];
      const isFirstTowerFree = item.type === BuildingType.Tower && !player.hasBuiltTower;
      const canAfford = isFirstTowerFree || (player.gold >= cost.gold && player.wood >= cost.wood && player.stone >= cost.stone);

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
        if (cost.stone > 0) costItems.push({ val: cost.stone, type: 's' });
      }

      drawCell(bx, isSelected, canAfford, unitName, category,
        isFirstTowerFree ? null : costItems,
        isFirstTowerFree ? 'FREE' : null, item.key);
    }

    // === Nuke button (col 5) — 9-slice BigRedButton filling the cell ===
    const nukeAvail = player.nukeAvailable;
    const nukeLocked = this.isNukeLocked();
    const nukeReady = nukeAvail && !nukeLocked;
    const nukeX = (BUILD_TRAY.length + 1) * milW;
    const nukePad = 2;
    if (nukeReady) {
      this.ui.drawBigRedButton(ctx, nukeX + nukePad, milY + nukePad, milW - nukePad * 2, milH - nukePad * 2, this.nukeTargeting);
    } else {
      ctx.globalAlpha = 0.3;
      this.ui.drawBigRedButton(ctx, nukeX + nukePad, milY + nukePad, milW - nukePad * 2, milH - nukePad * 2);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = nukeReady ? '#fff' : '#888';
    ctx.font = 'bold 12px monospace';
    ctx.fillText('NUKE', nukeX + milW / 2, milY + milH / 2 + 4);
    if (nukeLocked && nukeAvail) {
      // Show countdown timer
      const secsLeft = Math.ceil(NUKE_LOCKOUT_SECONDS - this.game.state.tick / TICK_RATE);
      ctx.fillStyle = '#ff5722';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(`${secsLeft}s`, nukeX + milW / 2, milY + milH - 6);
    } else {
      ctx.fillStyle = '#888';
      ctx.font = '9px monospace';
      ctx.fillText('[N]', nukeX + milW / 2, milY + milH - 6);
    }

    if (quickChatCdMs > 0) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffcc80';
      ctx.font = '11px monospace';
      ctx.fillText(`Chat CD ${(quickChatCdMs / 1000).toFixed(1)}s`, 10, milY - 8);
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9bb7ff';
    ctx.font = '11px monospace';
    ctx.fillText(`Lane tap: ${this.laneModeLabel()}`, 120, milY - 8);
    if (this.quickChatToast && Date.now() < this.quickChatToast.until) {
      ctx.fillStyle = 'rgba(20,20,20,0.9)';
      ctx.fillRect(W / 2 - 120, milY - 30, 240, 22);
      ctx.strokeStyle = '#ffcc80';
      ctx.strokeRect(W / 2 - 120, milY - 30, 240, 22);
      ctx.fillStyle = '#ffcc80';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(this.quickChatToast.text, W / 2, milY - 15);
    }
    if (this.laneToast && Date.now() < this.laneToast.until) {
      ctx.fillStyle = 'rgba(20,20,20,0.9)';
      ctx.fillRect(W / 2 - 160, milY - 54, 320, 20);
      ctx.strokeStyle = '#9bb7ff';
      ctx.strokeRect(W / 2 - 160, milY - 54, 320, 20);
      ctx.fillStyle = '#9bb7ff';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(this.laneToast.text, W / 2, milY - 40);
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
        W, this.canvas.clientHeight, player.gold, player.wood, player.stone, this.sprites);
    }

    ctx.textAlign = 'start';
  }

  private drawSelectedUnit(ctx: CanvasRenderingContext2D, renderer: Renderer): void {
    // Clean up stale selection
    if (this.selectedUnitId !== null) {
      const u = this.game.state.units.find(u => u.id === this.selectedUnitId);
      if (!u) { this.selectedUnitId = null; return; }

      const cam = renderer.camera;

      // Draw selection ring on the unit in world space
      ctx.save();
      cam.applyTransform(ctx);
      const px = u.x * TILE_SIZE + TILE_SIZE / 2;
      const py = u.y * TILE_SIZE + TILE_SIZE / 2;
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
      const player = this.game.state.players[u.playerId];
      const race = player?.race;
      const raceColor = race ? (RACE_COLORS[race]?.primary ?? '#fff') : '#fff';
      const teamLabel = u.team === this.myTeam ? 'Ally' : 'Enemy';

      const lines: string[] = [];
      lines.push(`${u.type}`);
      lines.push(`${teamLabel} ${u.category}  HP: ${u.hp}/${u.maxHp}${u.shieldHp > 0 ? ` +${u.shieldHp} shield` : ''}`);
      lines.push(`DMG: ${u.damage}  SPD: ${u.attackSpeed.toFixed(1)}s  RNG: ${u.range}  Move: ${u.moveSpeed.toFixed(1)}`);

      // Status effects
      if (u.statusEffects.length > 0) {
        const effs = u.statusEffects.map(e => `${e.type}x${e.stacks}`).join('  ');
        lines.push(`Status: ${effs}`);
      }

      // Kills
      if (u.kills > 0) lines.push(`Kills: ${u.kills}`);

      const lineH = 16;
      const padX = 14;
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
      const boxY = 8;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.92)';
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.strokeStyle = raceColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(boxX, boxY, boxW, boxH);

      // Draw unit shape in the panel
      if (this.currentRenderer && race) {
        this.currentRenderer.drawUnitShape(ctx, boxX + 20, boxY + boxH / 2, 10, race, u.category, u.team, raceColor);
      }

      ctx.textAlign = 'left';
      const textStartX = boxX + 38;
      for (let i = 0; i < lines.length; i++) {
        if (i === 0) {
          ctx.fillStyle = raceColor;
          ctx.font = 'bold 13px monospace';
        } else if (lines[i].startsWith('Status:')) {
          ctx.fillStyle = '#ffcc80';
          ctx.font = '11px monospace';
        } else {
          ctx.fillStyle = '#ccc';
          ctx.font = '12px monospace';
        }
        ctx.fillText(lines[i], textStartX, boxY + padY + (i + 1) * lineH - 3);
      }
      ctx.textAlign = 'start';
    }
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

  private getBuildingLabel(type: BuildingType): string {
    switch (type) {
      case BuildingType.HarvesterHut: return 'Miner Hut';
      case BuildingType.MeleeSpawner: return 'Melee Barracks';
      case BuildingType.RangedSpawner: return 'Ranged Barracks';
      case BuildingType.CasterSpawner: return 'Caster Barracks';
      case BuildingType.Tower: return 'Tower';
      default: return type;
    }
  }

  private getBuildingTooltip(building: { type: BuildingType; hp: number; maxHp: number; lane: Lane; upgradePath: string[]; id: number }): string {
    let tip = `${this.getBuildingLabel(building.type)}  HP: ${building.hp}/${building.maxHp}`;
    if (building.type === BuildingType.HarvesterHut) {
      const h = this.game.state.harvesters.find(h => h.hutId === building.id);
      if (h) tip += `  [${ASSIGNMENT_LABELS[h.assignment]}]`;
    } else if (building.type !== BuildingType.Tower) {
      tip += `  Lane: ${building.lane}`;
    }
    if (building.upgradePath.length > 1) {
      tip += `  Tier ${building.upgradePath.length - 1}`;
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
        const tree = bld && (UPGRADE_TREES as any)[race]?.[bld]?.[u.upgradeNode];
        const nodeName = tree?.name as string | undefined;
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
        `${p.stone}(+${s.totalStoneEarned})`,
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
        const raw = localStorage.getItem('spawnwars.balanceLog');
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
          a.res += p.goldEarned + p.woodEarned + p.stoneEarned;
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
      const sps = (s.totalStoneEarned / elapsed).toFixed(1);
      ctx.fillStyle = pi === 0 ? '#e8f5e9' : '#fafafa';
      ctx.fillText(`P${pi} ${p.race}: ${gps}g/s  ${wps}w/s  ${sps}m/s  total: ${s.totalGoldEarned + s.totalWoodEarned + s.totalStoneEarned}`, col1, y);
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
      // Build center-out order
      const CENTER_OUT: number[] = [];
      for (let d = 0; d <= Math.floor(totalSlots / 2); d++) {
        const mid = Math.floor(totalSlots / 2);
        if (mid + d < totalSlots) CENTER_OUT.push(mid + d);
        if (d > 0 && mid - d >= 0) CENTER_OUT.push(mid - d);
      }
      const nextSlot = CENTER_OUT.find(s => !occupiedSlots.has(s));
      for (let slot = 0; slot < totalSlots; slot++) {
        const sgx = slot % hutCols;
        const sgy = Math.floor(slot / hutCols);
        const wx = (origin.x + sgx) * TILE_SIZE;
        const wy = (origin.y + sgy) * TILE_SIZE;
        const occupied = occupiedSlots.has(slot);
        const isNext = slot === nextSlot;
        if (isNext) {
          const pulse = 0.5 + 0.3 * Math.sin(Date.now() / 200);
          ctx.fillStyle = `rgba(60, 255, 60, ${pulse * 0.3})`;
          ctx.fillRect(wx, wy, TILE_SIZE, TILE_SIZE);
          ctx.strokeStyle = `rgba(60, 255, 60, ${pulse})`;
          ctx.lineWidth = 2;
          ctx.strokeRect(wx, wy, TILE_SIZE, TILE_SIZE);
        } else {
          ctx.fillStyle = occupied ? 'rgba(255, 200, 60, 0.15)' : 'rgba(60, 255, 60, 0.08)';
          ctx.fillRect(wx, wy, TILE_SIZE, TILE_SIZE);
          ctx.strokeStyle = occupied ? 'rgba(255, 200, 60, 0.3)' : 'rgba(60, 255, 60, 0.15)';
          ctx.lineWidth = 1;
          ctx.strokeRect(wx, wy, TILE_SIZE, TILE_SIZE);
        }
      }
    }

    // Highlight military grid slots (for non-tower, non-hut types)
    if (!isTower && !isHut) {
      const origin = getBuildGridOrigin(this.pid, this.game.state.mapDef, this.game.state.players);
      for (let gy = 0; gy < this.game.state.mapDef.buildGridRows; gy++) {
        for (let gx = 0; gx < this.game.state.mapDef.buildGridCols; gx++) {
          const wx = (origin.x + gx) * TILE_SIZE;
          const wy = (origin.y + gy) * TILE_SIZE;
          const occupied = this.game.state.buildings.some(
            b => b.buildGrid === 'military' && b.gridX === gx && b.gridY === gy && b.playerId === this.pid
          );
          ctx.fillStyle = occupied ? 'rgba(255, 60, 60, 0.15)' : 'rgba(60, 255, 60, 0.15)';
          ctx.fillRect(wx, wy, TILE_SIZE, TILE_SIZE);
          ctx.strokeStyle = occupied ? 'rgba(255, 60, 60, 0.3)' : 'rgba(60, 255, 60, 0.3)';
          ctx.lineWidth = 1;
          ctx.strokeRect(wx, wy, TILE_SIZE, TILE_SIZE);
        }
      }
    }

    // Highlight tower alley slots (for towers)
    if (isTower) {
      const alley = getTeamAlleyOrigin(myTeam, this.game.state.mapDef);
      for (let gy = 0; gy < this.game.state.mapDef.towerAlleyRows; gy++) {
        for (let gx = 0; gx < this.game.state.mapDef.towerAlleyCols; gx++) {
          const wx = (alley.x + gx) * TILE_SIZE;
          const wy = (alley.y + gy) * TILE_SIZE;
          const occupied = this.game.state.buildings.some(
            b => {
              if (b.buildGrid !== 'alley' || b.gridX !== gx || b.gridY !== gy) return false;
              const bTeam = this.game.state.players[b.playerId]?.team ?? Team.Bottom;
              return bTeam === myTeam;
            }
          );
          ctx.fillStyle = occupied ? 'rgba(255, 60, 60, 0.15)' : 'rgba(60, 255, 60, 0.15)';
          ctx.fillRect(wx, wy, TILE_SIZE, TILE_SIZE);
          ctx.strokeStyle = occupied ? 'rgba(255, 60, 60, 0.3)' : 'rgba(60, 255, 60, 0.3)';
          ctx.lineWidth = 1;
          ctx.strokeRect(wx, wy, TILE_SIZE, TILE_SIZE);
        }
      }
    }

    ctx.restore();
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
  }

  private drawBuildTooltip(ctx: CanvasRenderingContext2D, _renderer: Renderer): void {
    if (!this.selectedBuilding) return;
    const player = this.game.state.players[this.pid];
    const race = player.race;
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
    const special = type !== BuildingType.HarvesterHut ? this.getSpecialDesc(race, type) : 'Click to place (auto-fills center-out)';
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

    const origin = slot.isAlley ? getTeamAlleyOrigin(this.myTeam, this.game.state.mapDef) : getBuildGridOrigin(this.pid, this.game.state.mapDef, this.game.state.players);
    const worldX = (origin.x + slot.gx) * TILE_SIZE;
    const worldY = (origin.y + slot.gy) * TILE_SIZE;

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

    ctx.fillStyle = occupied ? 'rgba(255, 0, 0, 0.3)' : 'rgba(0, 255, 0, 0.3)';
    ctx.fillRect(worldX, worldY, TILE_SIZE, TILE_SIZE);
    ctx.strokeStyle = occupied ? '#f44336' : '#4caf50';
    ctx.lineWidth = 2;
    ctx.strokeRect(worldX, worldY, TILE_SIZE, TILE_SIZE);

    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
  }

  /** True when the nuke is locked out (first 60s of the match). */
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
      forbidScreenX1 = (0 - cam.x) * cam.zoom;
      forbidScreenY1 = (forbidMinY * TILE_SIZE - cam.y) * cam.zoom;
      forbidScreenX2 = (mapDef.width * TILE_SIZE - cam.x) * cam.zoom;
      forbidScreenY2 = (forbidMaxY * TILE_SIZE - cam.y) * cam.zoom;
    } else {
      // Landscape: forbidden zone along x-axis
      const forbidMinX = nukeZone.min > 0 ? 0 : nukeZone.max;
      const forbidMaxX = nukeZone.min > 0 ? nukeZone.min : mapDef.width;
      forbidScreenX1 = (forbidMinX * TILE_SIZE - cam.x) * cam.zoom;
      forbidScreenY1 = (0 - cam.y) * cam.zoom;
      forbidScreenX2 = (forbidMaxX * TILE_SIZE - cam.x) * cam.zoom;
      forbidScreenY2 = (mapDef.height * TILE_SIZE - cam.y) * cam.zoom;
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
    ctx.fillText('CLICK TO FIRE NUKE (own half only)  [ESC to cancel]', cw / 2, 60);
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

    ctx.fillStyle = 'rgba(0,0,0,0.2)';
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

    drawOption(cx - optionOffset, cy, 'Left', selected === 'Attack Left');
    drawOption(cx + optionOffset, cy, 'Right', selected === 'Attack Right');
    drawOption(cx, cy - optionOffset, 'Diamond', selected === 'Get Diamond');
    drawOption(cx, cy + optionOffset, 'Defend', selected === 'Defend');

    ctx.beginPath();
    ctx.arc(this.pointerX, this.pointerY, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();

    ctx.fillStyle = this.radialAccessibility ? '#ffffff' : '#ccc';
    ctx.font = this.radialAccessibility ? 'bold 12px monospace' : '11px monospace';
    ctx.fillText('Hold Q, aim, release (tap Q = Defend)', cx, cy + 4);
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
