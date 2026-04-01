/**
 * Player input handling — keyboard, mouse/touch events, and in-game UI rendering.
 *
 * Manages building placement, unit selection, ability targeting, and all
 * screen-space UI elements (build tray, settings panel, tooltips, tutorials).
 * All player actions are converted to GameCommand objects via Game.ts.
 *
 * Sub-modules:
 *   InputBuildTray  — build tray layout and rendering (~700 lines)
 *   InputSettings   — settings panel drawing and persistence (~500 lines)
 *   InputTutorial   — tutorial overlay rendering and state (~480 lines)
 *   InputAbilities  — ability icons, nuke overlay, unit selection (~970 lines)
 */
import { Game } from '../game/Game';
import { Camera } from '../rendering/Camera';
import { Renderer } from '../rendering/Renderer';
import {
  BuildingType, TILE_SIZE, Lane,
  Team, Race, UnitState,
} from '../simulation/types';
import { getBuildGridOrigin, getTeamAlleyOrigin, getHutGridOrigin, getBaseGoldPosition } from '../simulation/GameState';
import { UNIT_STATS, TOWER_STATS, RACE_COLORS, RACE_ABILITY_INFO } from '../simulation/data';
import { TICK_RATE } from '../simulation/types';
import { UIAssets } from '../rendering/UIAssets';
import { SpriteLoader } from '../rendering/SpriteLoader';
import { BuildingPopup } from './BuildingPopup';
import { HutPopup } from './HutPopup';
import { ResearchPopup } from './ResearchPopup';
import { SeedPopup } from './SeedPopup';
import { getSafeTop } from './SafeArea';
import { getVisualSettings, type TouchControlsMode } from '../rendering/VisualSettings';
import { tileToPixel, pixelToTile } from '../rendering/Projection';
import {
  isMatchTutorial,
  refreshTutorialCache,
} from './TutorialManager';
import * as Settings from './InputSettings';
import { BUILD_TRAY, computeTrayLayout, drawBuildTray as _drawBuildTray } from './InputBuildTray';
import type { BuildTrayDeps } from './InputBuildTray';
import * as Tutorial from './InputTutorial';
import * as Abilities from './InputAbilities';

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
  /** Cached canvas bounding rect — invalidated on resize to avoid getBoundingClientRect() per mousemove. */
  private _cachedRect: DOMRect | null = null;
  private getCanvasRect(): DOMRect {
    if (!this._cachedRect) this._cachedRect = this.canvas.getBoundingClientRect();
    return this._cachedRect;
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

  private get _settingsState(): Settings.SettingsState {
    // Return a live view of the settings properties so delegate functions can read/mutate them.
    // Using a proxy-like pattern so TS sees the field accesses.
    const self = this;
    return {
      get laneToggleMode() { return self.laneToggleMode; }, set laneToggleMode(v) { self.laneToggleMode = v; },
      get uiFeedbackEnabled() { return self.uiFeedbackEnabled; }, set uiFeedbackEnabled(v) { self.uiFeedbackEnabled = v; },
      get radialArmMs() { return self.radialArmMs; }, set radialArmMs(v) { self.radialArmMs = v; },
      get radialSize() { return self.radialSize; }, set radialSize(v) { self.radialSize = v; },
      get radialAccessibility() { return self.radialAccessibility; }, set radialAccessibility(v) { self.radialAccessibility = v; },
      get cameraSnapOnSelect() { return self.cameraSnapOnSelect; }, set cameraSnapOnSelect(v) { self.cameraSnapOnSelect = v; },
      get minimapPanEnabled() { return self.minimapPanEnabled; }, set minimapPanEnabled(v) { self.minimapPanEnabled = v; },
      get stickyBuildMode() { return self.stickyBuildMode; }, set stickyBuildMode(v) { self.stickyBuildMode = v; },
      get mobileHintVisible() { return self.mobileHintVisible; }, set mobileHintVisible(v) { self.mobileHintVisible = v; },
      get settingsOpen() { return self.settingsOpen; }, set settingsOpen(v) { self.settingsOpen = v; },
      get settingsSliderDrag() { return self.settingsSliderDrag; }, set settingsSliderDrag(v) { self.settingsSliderDrag = v; },
    };
  }

  private get _settingsDeps(): Settings.SettingsPanelDeps {
    return {
      getSettingsButtonRect: () => this.getSettingsButtonRect(),
      ui: this.ui,
      onConcede: this.onConcede,
      onQuitGame: this.onQuitGame,
      playSfx: this.game.sfx,
    };
  }

  private get _tutorialState(): Tutorial.TutorialState {
    const self = this;
    return {
      get showTutorial() { return self.showTutorial; }, set showTutorial(v) { self.showTutorial = v; },
      get hideTutorialOnStart() { return self.hideTutorialOnStart; }, set hideTutorialOnStart(v) { self.hideTutorialOnStart = v; },
      get matchTutorialActive() { return self.matchTutorialActive; }, set matchTutorialActive(v) { self.matchTutorialActive = v; },
      get tutorialStepStartTime() { return self.tutorialStepStartTime; }, set tutorialStepStartTime(v) { self.tutorialStepStartTime = v; },
      get tutorialSkipRect() { return self.tutorialSkipRect; }, set tutorialSkipRect(v) { self.tutorialSkipRect = v; },
      get tutorialSkipAllRect() { return self.tutorialSkipAllRect; }, set tutorialSkipAllRect(v) { self.tutorialSkipAllRect = v; },
      get tutorialCheckboxRect() { return self.tutorialCheckboxRect; }, set tutorialCheckboxRect(v) { self.tutorialCheckboxRect = v; },
      get tutorialCloseRect() { return self.tutorialCloseRect; }, set tutorialCloseRect(v) { self.tutorialCloseRect = v; },
      get selectedBuilding() { return self.selectedBuilding; }, set selectedBuilding(v) { self.selectedBuilding = v; },
    };
  }

  private get _tutorialDeps(): Tutorial.TutorialDeps {
    return {
      canvas: this.canvas,
      ui: this.ui,
      isTouchDevice: this.isTouchDevice,
      getCanvasRect: () => this.getCanvasRect(),
      getTrayLayout: () => this.getTrayLayout(),
      getSettingsButtonRect: () => this.getSettingsButtonRect(),
    };
  }

  private get _buildTrayDeps(): BuildTrayDeps {
    return {
      game: this.game,
      camera: this.camera,
      canvas: this.canvas,
      ui: this.ui,
      sprites: this.sprites,
      pid: this.pid,
      isTouchDevice: this.isTouchDevice,
      selectedBuilding: this.selectedBuilding,
      abilityTargeting: this.abilityTargeting,
      abilityPlacing: this.abilityPlacing,
      nukeTargeting: this.nukeTargeting,
      trayTick: this.trayTick,
      trayBldgSpriteCache: this.trayBldgSpriteCache,
      quickChatCooldownUntil: this.quickChatCooldownUntil,
      quickChatToast: this.quickChatToast,
      laneToast: this.laneToast,
      mobileHintVisible: this.mobileHintVisible,
      settingsOpen: this.settingsOpen,
      rallyOverride: this.rallyOverride,
      rallyPrevLanes: this.rallyPrevLanes,
      nowPlayingName: this.nowPlayingName,
      nowPlayingStart: this.nowPlayingStart,
      NP_SHOW_MS: InputHandler.NP_SHOW_MS,
      NP_FADE_MS: InputHandler.NP_FADE_MS,
      pointerX: this.pointerX,
      pointerY: this.pointerY,
      drawAbilityIcon: (ctx, race, cx, cy, size) => this.drawAbilityIcon(ctx, race, cx, cy, size),
      isNukeLocked: () => this.isNukeLocked(),
      drawSettingsPanel: (ctx) => this.drawSettingsPanel(ctx),
      buildingPopup: this.buildingPopup,
      hutPopup: this.hutPopup,
      researchPopup: this.researchPopup,
      seedPopup: this.seedPopup,
      getTrayLayout: () => this.getTrayLayout(),
      myTeam: this.myTeam,
    };
  }

  private get _selectedUnitDeps(): Abilities.SelectedUnitDeps {
    return {
      game: this.game,
      canvas: this.canvas,
      camera: this.camera,
      ui: this.ui,
      sprites: this.sprites,
      currentRenderer: this.currentRenderer,
      pid: this.pid,
      myTeam: this.myTeam,
      selectedUnitId: this.selectedUnitId,
      selectedHarvesterId: this.selectedHarvesterId,
      cameraFollowing: this.cameraFollowing,
      followBtnRect: this.followBtnRect,
      tp: (tx, ty) => this.tp(tx, ty),
    };
  }

  private loadSettings(): void {
    Settings.loadSettings(this._settingsState);
  }

  private saveLaneMode(): void {
    Settings.saveLaneMode(this._settingsState);
  }

  private initMobileHint(): void {
    Settings.initMobileHint(this._settingsState);
  }

  private dismissMobileHint(): void {
    Settings.dismissMobileHint(this._settingsState);
  }

  /** Compute the in-game settings panel layout. Row Y positions are relative to panel top. */
  private getSettingsPanelLayout() {
    return Settings.getSettingsPanelLayout(this._settingsDeps);
  }

  private drawSettingsPanel(ctx: CanvasRenderingContext2D): void {
    Settings.drawSettingsPanel(ctx, this._settingsState, this._settingsDeps);
  }

  private handleSettingsPanelClick(cx: number, cy: number): boolean {
    return Settings.handleSettingsPanelClick(cx, cy, this._settingsState, this._settingsDeps);
  }

  private applySettingsSlider(cx: number, L: ReturnType<typeof InputHandler.prototype.getSettingsPanelLayout>): void {
    Settings.applySettingsSlider(cx, L, this._settingsState, this.game.sfx);
  }

  private eventToWorld(e: MouseEvent): { x: number; y: number } {
    const rect = this.getCanvasRect();
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
      const rect = this.getCanvasRect();
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
      const rect = this.getCanvasRect();
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
      // Keep pointer position in sync for mouse — some devices/browsers only fire
      // pointermove (not mousemove) on touch-capable screens using a mouse.
      if (e.pointerType === 'mouse') {
        const rect = this.getCanvasRect();
        this.pointerX = e.clientX - rect.left;
        this.pointerY = e.clientY - rect.top;
      }
      if (!this.settingsSliderDrag) return;
      const rect = this.getCanvasRect();
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
          const sr = this.getCanvasRect();
          const scx = e.clientX - sr.left;
          const scy = e.clientY - sr.top;
          if (this.handleSettingsPanelClick(scx, scy)) return;
        }
        const trect = this.getCanvasRect();
        const tcx = e.clientX - trect.left;
        const tcy = e.clientY - trect.top;
        if (this.handleMatchTutorialClick(tcx, tcy)) return;
      }

      // UI panels consume click first (before minimap, so popups overlapping minimap work)
      if (this.handleUIClick(e)) return;

      // Minimap click → pan camera to that world position (blocked during tutorial)
      if (this.currentRenderer && !this.matchTutorialActive) {
        const rect = this.getCanvasRect();
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
      const rect = this.getCanvasRect();
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
    Tutorial.drawTutorial(ctx, this._tutorialState, this._tutorialDeps);
  }

  private handleTutorialClick(e: MouseEvent): void {
    Tutorial.handleTutorialClick(e, this._tutorialState, this._tutorialDeps);
  }

  // ── Guided match tutorial (step-by-step overlay) ──

  private updateMatchTutorial(): void {
    Tutorial.updateMatchTutorial(this._tutorialState);
  }

  private drawMatchTutorial(ctx: CanvasRenderingContext2D): void {
    Tutorial.drawMatchTutorial(ctx, this._tutorialState, this._tutorialDeps);
  }

  private handleMatchTutorialClick(cx: number, cy: number): boolean {
    return Tutorial.handleMatchTutorialClick(cx, cy, this._tutorialState, this._tutorialDeps);
  }

  /** Called after a tray button is successfully clicked during tutorial. */
  /** Called after a tray button is successfully clicked during tutorial. */
  private checkTutorialTrayAdvance(): void {
    Tutorial.checkTutorialTrayAdvance(this._tutorialState);
  }

  /** Called after a building is successfully placed during tutorial. */
  /** Called after a building is successfully placed during tutorial. */
  private checkTutorialPlaceAdvance(): void {
    Tutorial.checkTutorialPlaceAdvance(this._tutorialState);
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
    const rect = this.getCanvasRect();
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
    const rect = this.getCanvasRect();
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

  private _trayLayoutCache: ReturnType<InputHandler['_computeTrayLayout']> | null = null;
  private getTrayLayout() {
    if (this._trayLayoutCache) return this._trayLayoutCache;
    return (this._trayLayoutCache = this._computeTrayLayout());
  }
  private _computeTrayLayout() {
    return computeTrayLayout(this.canvas.clientWidth, this.canvas.clientHeight);
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
    const rect = this.getCanvasRect();
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
    this._cachedRect = null; // invalidate once per frame so resize is picked up
    this._trayLayoutCache = null; // recompute tray geometry at most once per frame
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
    _drawBuildTray(ctx, this._buildTrayDeps);
  }

  private clearSelection(): void {
    const r = Abilities.clearSelection(this._selectedUnitDeps, this.camera);
    this.selectedUnitId = r.selectedUnitId;
    this.selectedHarvesterId = r.selectedHarvesterId;
    this.cameraFollowing = r.cameraFollowing;
    this.followBtnRect = r.followBtnRect;
  }

  /** Select and pan to the friendly unit with the most kills. Tiebreak: furthest from HQ. */
  /** Select and pan to the friendly unit with the most kills. */
  private selectMvpUnit(): void {
    const r = Abilities.selectMvpUnit(this._selectedUnitDeps);
    if (r) {
      this.selectedUnitId = r.selectedUnitId;
      this.selectedHarvesterId = r.selectedHarvesterId;
      this.cameraFollowing = r.cameraFollowing;
      this.settingsOpen = false;
      this.showTutorial = false;
    }
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
    const r = Abilities.drawSelectedUnit(ctx, renderer, this._selectedUnitDeps);
    this.selectedUnitId = r.selectedUnitId;
    this.selectedHarvesterId = r.selectedHarvesterId;
    this.cameraFollowing = r.cameraFollowing;
    this.followBtnRect = r.followBtnRect;
  }

  private findUnitNear(wx: number, wy: number, radius: number): UnitState | null {
    return Abilities.findUnitNear(this.game.state.units, wx, wy, radius);
  }

  private getBuildingTooltip(building: { type: BuildingType; hp: number; maxHp: number; lane: Lane; upgradePath: string[]; id: number; playerId: number }): string {
    return Abilities.getBuildingTooltip(building, this.game, this.pid, this.myTeam);
  }

  private getUnitTooltip(u: UnitState): string {
    return Abilities.getUnitTooltip(u, this.game, this.myTeam);
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
    const result = Abilities.activateAbility(player, {
      game: this.game, pid: this.pid, cameraSnapOnSelect: this.cameraSnapOnSelect,
      laneToast: this.laneToast, abilityTargeting: this.abilityTargeting,
      abilityPlacing: this.abilityPlacing, selectedBuilding: this.selectedBuilding,
      panToBuildArea: (t) => this.panToBuildArea(t),
    });
    this.abilityTargeting = result.abilityTargeting;
    this.abilityPlacing = result.abilityPlacing;
    this.selectedBuilding = result.selectedBuilding;
    this.laneToast = result.laneToast;
  }

  /** Draw a canvas-rendered icon for each race's ability. */
  private drawAbilityIcon(ctx: CanvasRenderingContext2D, race: Race, cx: number, cy: number, size: number): void {
    Abilities.drawAbilityIcon(ctx, race, cx, cy, size);
  }

  private drawAbilityOverlay(ctx: CanvasRenderingContext2D): void {
    Abilities.drawAbilityOverlay(ctx, {
      game: this.game, camera: this.camera, canvas: this.canvas,
      pid: this.pid, isTouchDevice: this.isTouchDevice,
      pointerX: this.pointerX, pointerY: this.pointerY,
    });
  }

  private isNukeLocked(): boolean {
    return Abilities.isNukeLocked(this.game.state);
  }

  private drawNukeOverlay(ctx: CanvasRenderingContext2D): void {
    Abilities.drawNukeOverlay(ctx, {
      game: this.game, camera: this.camera, canvas: this.canvas,
      pid: this.pid, isTouchDevice: this.isTouchDevice,
      pointerX: this.pointerX, pointerY: this.pointerY,
      tp: (tx, ty) => this.tp(tx, ty),
    });
  }

  private drawQuickChatRadial(ctx: CanvasRenderingContext2D): void {
    Abilities.drawQuickChatRadial(ctx, {
      quickChatRadialCenter: this.quickChatRadialCenter,
      pointerX: this.pointerX, pointerY: this.pointerY,
      radialSize: this.radialSize, radialAccessibility: this.radialAccessibility,
      isTouchDevice: this.isTouchDevice, canvas: this.canvas,
      getQuickChatChoiceFromPointer: () => this.getQuickChatChoiceFromPointer(),
    });
  }

  private quickChatFeedback(success: boolean): void {
    this.audioCtx = Abilities.quickChatFeedback(success, this.uiFeedbackEnabled, this.audioCtx);
  }
}
