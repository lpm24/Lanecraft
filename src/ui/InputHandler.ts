import { Game } from '../game/Game';
import { Camera } from '../rendering/Camera';
import { Renderer } from '../rendering/Renderer';
import {
  BuildingType, TILE_SIZE, BUILD_GRID_COLS, BUILD_GRID_ROWS, SHARED_ALLEY_COLS, SHARED_ALLEY_ROWS, Lane,
  HarvesterAssignment, Team, ZONES, MAP_WIDTH, MAP_HEIGHT, Race, UnitState,
} from '../simulation/types';
import { getBuildGridOrigin, getTeamAlleyOrigin } from '../simulation/GameState';
import { UPGRADE_TREES, RACE_BUILDING_COSTS, RACE_UPGRADE_COSTS, UNIT_STATS, TOWER_STATS, RACE_COLORS } from '../simulation/data';
import { TICK_RATE } from '../simulation/types';

interface BuildTrayItem {
  type: BuildingType;
  label: string;
  key: string;
}

interface UpgradeOption {
  choice: string;
  cost: { gold: number; wood: number; stone: number };
  name?: string;
  desc?: string;
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
  [HarvesterAssignment.Stone]: 'S Stone',
  [HarvesterAssignment.Center]: 'C Center',
};

const LANE_MODE_STORAGE_KEY = 'asciiwars.laneToggleMode';
const UI_FEEDBACK_STORAGE_KEY = 'asciiwars.uiFeedbackEnabled';
const RADIAL_ARM_MS_STORAGE_KEY = 'asciiwars.radialArmMs';
const RADIAL_SIZE_STORAGE_KEY = 'asciiwars.radialSize';
const RADIAL_A11Y_STORAGE_KEY = 'asciiwars.radialA11y';
const MOBILE_HINT_SEEN_KEY = 'asciiwars.mobileHintSeen';

export class InputHandler {
  private game: Game;
  private canvas: HTMLCanvasElement;
  private camera: Camera;
  private selectedBuilding: BuildingType | null = null;
  private hoveredGridSlot: { gx: number; gy: number; isAlley: boolean } | null = null;
  private hoveredBuildingId: number | null = null;
  private selectedBuildingId: number | null = null;
  private pointerX = 0;
  private pointerY = 0;
  private quickChatRadialActive = false;
  private quickChatRadialCenter: { x: number; y: number } | null = null;
  private quickChatCooldownUntil = 0;
  private touchRadialTimer: number | null = null;
  private touchRadialArmed = false;
  private touchArmCenter: { x: number; y: number } | null = null;
  private touchArmStartAt = 0;
  private suppressClicksUntil = 0;
  private quickChatToast: { text: string; until: number } | null = null;
  private laneToast: { text: string; until: number } | null = null;
  private queuedQuickChat: { message: string; at: number } | null = null;
  private mobileHintVisible = false;
  private settingsOpen = false;
  private activeTouchPointers = new Set<number>();
  private lastSpawnerClickId: number | null = null;
  private lastSpawnerClickAt = 0;
  private laneToggleMode: 'double' | 'single' = 'double';
  private radialArmMs = 320;
  private radialSize = 74;
  private radialAccessibility = false;
  private uiFeedbackEnabled = true;
  private audioCtx: AudioContext | null = null;
  private nukeTargeting = false;
  private tooltip: { text: string; x: number; y: number } | null = null;
  private selectedUnitId: number | null = null;
  private hoveredUnitId: number | null = null;
  private showTutorial = true;
  private devOverlayOpen = false;
  private abortController = new AbortController();
  private currentRenderer: Renderer | null = null;

  constructor(game: Game, canvas: HTMLCanvasElement, camera: Camera) {
    this.game = game;
    this.canvas = canvas;
    this.camera = camera;
    this.setupKeyboard();
    this.setupMouse();
    this.loadSettings();
    this.initMobileHint();
  }

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

  private resetUiDefaults(): void {
    this.laneToggleMode = 'double';
    this.uiFeedbackEnabled = true;
    this.radialArmMs = 320;
    this.radialSize = 74;
    this.radialAccessibility = false;
    this.saveLaneMode();
    this.saveUiFeedbackEnabled();
    this.saveRadialSettings();
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
        if (this.game.state.players[0]?.nukeAvailable) {
          this.nukeTargeting = !this.nukeTargeting;
          this.selectedBuilding = null;
        }
        return;
      }

      if (e.key === 'm' || e.key === 'M') {
        this.game.sendCommand({ type: 'build_hut', playerId: 0 });
        return;
      }
      if (e.key === 'q' || e.key === 'Q') {
        if (!this.quickChatRadialActive) {
          this.quickChatRadialActive = true;
          this.quickChatRadialCenter = { x: this.canvas.width / 2, y: this.canvas.height / 2 };
          this.pointerX = this.quickChatRadialCenter.x;
          this.pointerY = this.quickChatRadialCenter.y;
        }
        return;
      }
      if (e.key === 'p' || e.key === 'P') {
        const wx = this.camera.x + this.canvas.width / (2 * this.camera.zoom);
        const wy = this.camera.y + this.canvas.height / (2 * this.camera.zoom);
        this.game.sendCommand({ type: 'ping', playerId: 0, x: wx / TILE_SIZE, y: wy / TILE_SIZE });
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
        this.selectedBuilding = this.selectedBuilding === item.type ? null : item.type;
        return;
      }
      if (e.key === 'Escape') {
        if (this.showTutorial) { this.showTutorial = false; return; }
        this.quickChatRadialActive = false;
        this.quickChatRadialCenter = null;
        this.settingsOpen = false;
        this.selectedBuilding = null;
        this.nukeTargeting = false;
        this.selectedUnitId = null;
      }
      if (e.key === 'l' || e.key === 'L') {
        const myBuildings = this.game.state.buildings.filter(b => b.playerId === 0);
        const currentLane = myBuildings.length > 0 ? myBuildings[0].lane : Lane.Left;
        this.game.sendCommand({ type: 'toggle_all_lanes', playerId: 0, lane: currentLane === Lane.Left ? Lane.Right : Lane.Left });
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
        this.hoveredGridSlot = this.worldToGridSlot(0, world.x, world.y);
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
            b.playerId === 0 && b.worldX === tileX && b.worldY === tileY
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
        const tileY = world.y / TILE_SIZE;
        const team = this.game.state.players[0]?.team ?? Team.Bottom;
        const inRange = team === Team.Bottom ? tileY >= ZONES.MID.start : tileY <= ZONES.MID.end;
        if (!inRange) return; // click in enemy zone — ignore
        this.game.sendCommand({
          type: 'fire_nuke', playerId: 0,
          x: world.x / TILE_SIZE, y: tileY,
        });
        this.nukeTargeting = false;
        return;
      }

      if (this.selectedBuilding === null) {
        this.handleBuildingClick(e);
        return;
      }
      const world = this.eventToWorld(e);
      const slot = this.worldToGridSlot(0, world.x, world.y);
      if (slot) {
        this.game.sendCommand({
          type: 'place_building', playerId: 0,
          buildingType: this.selectedBuilding, gridX: slot.gx, gridY: slot.gy,
          ...(slot.isAlley ? { gridType: 'alley' as const } : {}),
        });
        if (!e.shiftKey) {
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

      // Right-click on own building to sell
      const world = this.eventToWorld(e);
      const tileX = Math.floor(world.x / TILE_SIZE);
      const tileY = Math.floor(world.y / TILE_SIZE);
      const building = this.game.state.buildings.find(b =>
        b.playerId === 0 && b.worldX === tileX && b.worldY === tileY
      );
      if (building) {
        this.game.sendCommand({ type: 'sell_building', playerId: 0, buildingId: building.id });
      }
    }, sig);

    this.canvas.addEventListener('auxclick', (e) => {
      if (e.button !== 1 || this.showTutorial) return;
      e.preventDefault();
      const world = this.eventToWorld(e as unknown as MouseEvent);
      this.game.sendCommand({
        type: 'ping', playerId: 0,
        x: world.x / TILE_SIZE, y: world.y / TILE_SIZE,
      });
    }, sig);

    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || this.showTutorial) return;
      this.activeTouchPointers.add(e.pointerId);
      if (this.activeTouchPointers.size > 1) {
        this.touchRadialArmed = false;
        if (this.touchRadialTimer !== null) {
          window.clearTimeout(this.touchRadialTimer);
          this.touchRadialTimer = null;
        }
        return;
      }
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { milY } = this.getTrayLayout();
      if (sy >= milY - 64) return; // don't arm radial from tray/overlay region
      if (this.touchRadialTimer !== null) window.clearTimeout(this.touchRadialTimer);
      this.touchRadialArmed = true;
      this.pointerX = sx;
      this.pointerY = sy;
      this.touchArmCenter = { x: sx, y: sy };
      this.touchArmStartAt = Date.now();
      this.touchRadialTimer = window.setTimeout(() => {
        if (!this.touchRadialArmed) return;
        this.quickChatRadialActive = true;
        this.quickChatRadialCenter = this.getClampedRadialCenter(sx, sy);
        this.touchArmCenter = null;
      }, this.radialArmMs);
    }, sig);

    this.canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch') return;
      const rect = this.canvas.getBoundingClientRect();
      this.pointerX = e.clientX - rect.left;
      this.pointerY = e.clientY - rect.top;
    }, sig);

    this.canvas.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'touch') return;
      this.activeTouchPointers.delete(e.pointerId);
      this.touchRadialArmed = false;
      if (this.touchRadialTimer !== null) {
        window.clearTimeout(this.touchRadialTimer);
        this.touchRadialTimer = null;
      }
      this.touchArmCenter = null;
      if (!this.quickChatRadialActive) return;
      const msg = this.getQuickChatChoiceFromPointer();
      this.quickChatRadialActive = false;
      this.quickChatRadialCenter = null;
      if (msg) this.sendQuickChat(msg);
      this.suppressClicksUntil = Date.now() + 220;
      e.preventDefault();
    }, sig);

    this.canvas.addEventListener('pointercancel', () => {
      this.activeTouchPointers.clear();
      this.touchRadialArmed = false;
      if (this.touchRadialTimer !== null) {
        window.clearTimeout(this.touchRadialTimer);
        this.touchRadialTimer = null;
      }
      this.quickChatRadialActive = false;
      this.quickChatRadialCenter = null;
      this.touchArmCenter = null;
    }, sig);
  }

  private getClampedRadialCenter(x: number, y: number): { x: number; y: number } {
    const pad = this.radialSize + (this.radialAccessibility ? 64 : 36);
    return {
      x: Math.max(pad, Math.min(this.canvas.width - pad, x)),
      y: Math.max(pad, Math.min(this.canvas.height - pad, y)),
    };
  }

  private worldToGridSlot(playerId: number, worldPixelX: number, worldPixelY: number): { gx: number; gy: number; isAlley: boolean } | null {
    const tx = Math.floor(worldPixelX / TILE_SIZE);
    const ty = Math.floor(worldPixelY / TILE_SIZE);

    // Check shared tower alley first (only for Tower type)
    if (this.selectedBuilding === BuildingType.Tower) {
      const team = playerId < 2 ? Team.Bottom : Team.Top;
      const alley = getTeamAlleyOrigin(team);
      const agx = tx - alley.x, agy = ty - alley.y;
      if (agx >= 0 && agx < SHARED_ALLEY_COLS && agy >= 0 && agy < SHARED_ALLEY_ROWS) {
        return { gx: agx, gy: agy, isAlley: true };
      }
    }

    // Military grid
    const origin = getBuildGridOrigin(playerId);
    const gx = tx - origin.x, gy = ty - origin.y;
    if (gx < 0 || gx >= BUILD_GRID_COLS || gy < 0 || gy >= BUILD_GRID_ROWS) return null;
    return { gx, gy, isAlley: false };
  }

  private handleBuildingClick(e: MouseEvent): void {
    const world = this.eventToWorld(e);
    const tileX = Math.floor(world.x / TILE_SIZE);
    const tileY = Math.floor(world.y / TILE_SIZE);
    const building = this.game.state.buildings.find(b =>
      b.playerId === 0 && b.worldX === tileX && b.worldY === tileY
    );
    if (!building) {
      // Try selecting a unit
      const wx = world.x / TILE_SIZE;
      const wy = world.y / TILE_SIZE;
      const unit = this.findUnitNear(wx, wy, 1.2);
      this.selectedUnitId = unit ? unit.id : null;
      return;
    }
    this.selectedUnitId = null;
    this.selectedBuildingId = building.id;

    // Click on hut: cycle harvester assignment
    if (building.type === BuildingType.HarvesterHut) {
      const h = this.game.state.harvesters.find(h => h.hutId === building.id);
      if (h) {
        const curIdx = ASSIGNMENT_CYCLE.indexOf(h.assignment);
        const nextAssignment = ASSIGNMENT_CYCLE[(curIdx + 1) % ASSIGNMENT_CYCLE.length];
        this.game.sendCommand({
          type: 'set_hut_assignment', playerId: 0,
          hutId: building.id, assignment: nextAssignment,
        });
      }
      return;
    }

    if (e.shiftKey) {
      const choice = this.getUpgradeChoice(building, false);
      if (choice) {
        this.game.sendCommand({
          type: 'purchase_upgrade', playerId: 0, buildingId: building.id, choice,
        });
        return;
      }
    }

    // Click-safe lane toggle: single or double mode.
    if (building.type !== BuildingType.Tower) {
      if (this.laneToggleMode === 'single') {
        const nextLane = building.lane === Lane.Left ? Lane.Right : Lane.Left;
        this.game.sendCommand({
          type: 'toggle_lane', playerId: 0, buildingId: building.id,
          lane: nextLane,
        });
        this.laneToast = { text: `Lane switched to ${nextLane}`, until: Date.now() + 900 };
        return;
      }
      const now = Date.now();
      const isDoubleClick = this.lastSpawnerClickId === building.id && (now - this.lastSpawnerClickAt) <= 350;
      this.lastSpawnerClickId = building.id;
      this.lastSpawnerClickAt = now;
      if (isDoubleClick) {
        const nextLane = building.lane === Lane.Left ? Lane.Right : Lane.Left;
        this.game.sendCommand({
          type: 'toggle_lane', playerId: 0, buildingId: building.id,
          lane: nextLane,
        });
        this.laneToast = { text: `Lane switched to ${nextLane}`, until: now + 900 };
      } else {
        this.laneToast = { text: 'Selected. Tap again quickly to switch lane.', until: now + 1000 };
      }
    }
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
      this.game.state.buildings.find(b => b.id === this.hoveredBuildingId && b.playerId === 0) ?? null);
    if (!building) return;
    const choice = this.getUpgradeChoice(building, alternate);
    if (!choice) return;
    this.game.sendCommand({
      type: 'purchase_upgrade', playerId: 0, buildingId: building.id, choice,
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
    this.game.sendCommand({ type: 'quick_chat', playerId: 0, message });
    return true;
  }

  private drawTutorial(ctx: CanvasRenderingContext2D): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const compact = W < 920 || H < 760;

    // Dim background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.82)';
    ctx.fillRect(0, 0, W, H);

    const pw = Math.min(W - 24, 760);
    const ph = Math.min(H - 24, compact ? 560 : 640);
    const px = (W - pw) / 2;
    const py = (H - ph) / 2;

    // Panel background
    ctx.fillStyle = 'rgba(10, 12, 18, 0.97)';
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = '#2979ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(px, py, pw, ph);

    const lp = px + 16;
    const rp = px + pw - 16;
    let y = py + (compact ? 24 : 28);
    const lh = compact ? 17 : 20;
    const headingSize = compact ? 14 : 16;
    const bodySize = compact ? 12 : 14;
    const closeSize = compact ? 28 : 32;

    const heading = (label: string, color = '#2979ff') => {
      ctx.fillStyle = color;
      ctx.font = `bold ${headingSize}px monospace`;
      ctx.fillText(label, lp, y);
      y += lh + (compact ? 1 : 3);
    };
    const line = (body: string, color = '#aaa') => {
      ctx.fillStyle = color;
      ctx.font = `${bodySize}px monospace`;
      ctx.fillText(body, lp, y);
      y += lh;
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

    heading('ASCII WARS', '#fff');
    line('2v2 RTS: destroy enemy HQ or bring Diamond home to win.', '#ccc');
    y += compact ? 0 : 2;
    rule();

    heading('THE MAP');
    line('Bottom base is yours, top base is enemy.');
    line('Lanes merge, split around center, then merge again.');
    line('Gold near HQ; wood left tip; stone right tip.');
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
    line('[P/MMB] ping   [Q hold] chat wheel   [Z/X/C/V] quick chat');
    line('[WASD/drag] pan   [Scroll] zoom   [Esc] cancel modes');
    line('Mobile: hold map for chat wheel, use PING/SETTINGS/CHAT above tray');
    line('Use ? (top-right) anytime to reopen this help.', '#9bb7ff');

    const btnX = px + pw - closeSize - 8;
    const btnY = py + 8;
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

  private getHelpButtonRect(): { x: number; y: number; w: number; h: number } {
    const size = 30;
    return { x: this.canvas.width - size - 10, y: 10, w: size, h: size };
  }

  private handleHelpButtonClick(e: MouseEvent): boolean {
    const rect = this.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const r = this.getHelpButtonRect();
    if (cx < r.x || cx > r.x + r.w || cy < r.y || cy > r.y + r.h) return false;
    this.showTutorial = !this.showTutorial;
    this.quickChatRadialActive = false;
    this.quickChatRadialCenter = null;
    this.settingsOpen = false;
    return true;
  }

  private drawHelpButton(ctx: CanvasRenderingContext2D): void {
    const r = this.getHelpButtonRect();
    ctx.fillStyle = this.showTutorial ? 'rgba(41,121,255,0.35)' : 'rgba(18,18,18,0.92)';
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

  private getTrayLayout() {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const milH = 68;
    const milY = H - milH;
    // Miner button + 4 military + nuke = 6 buttons total
    const milW = W / 6;
    return { W, H, milH, milY, milW };
  }

  private getUtilityLayout(milY: number) {
    const W = this.canvas.width;
    const utilY = milY - 30;
    const utilH = 24;
    const gap = 10;
    const pad = 10;
    const maxW = 100;
    const minW = 82;
    const total = W - (pad * 2) - (gap * 2);
    const utilW = Math.max(minW, Math.min(maxW, Math.floor(total / 3)));
    const used = utilW * 3 + gap * 2;
    const startX = Math.max(pad, Math.floor((W - used) / 2));
    return {
      utilY,
      utilH,
      pingX: startX,
      settingsX: startX + utilW + gap,
      chatX: startX + (utilW + gap) * 2,
      utilW,
    };
  }

  private queueQuickChatFallback(message: string): void {
    const now = Date.now();
    const at = Math.max(now + 20, this.quickChatCooldownUntil + 20);
    this.queuedQuickChat = { message, at };
    this.quickChatToast = { text: `Queued: ${message}`, until: now + 900 };
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
    return this.game.state.buildings.find(b => b.id === this.hoveredBuildingId && b.playerId === 0) ?? null;
  }

  private getSelectedOwnedBuilding() {
    if (this.selectedBuildingId === null) return null;
    const found = this.game.state.buildings.find(b => b.id === this.selectedBuildingId && b.playerId === 0) ?? null;
    if (!found) this.selectedBuildingId = null;
    return found;
  }

  private getPanelBuilding() {
    return this.getSelectedOwnedBuilding() ?? this.getHoveredOwnedBuilding();
  }

  private getUpgradeOptions(building: { type: BuildingType; upgradePath: string[]; playerId: number }): UpgradeOption[] {
    if (building.type === BuildingType.HarvesterHut) return [];
    const race = this.game.state.players[building.playerId]?.race;
    const tree = race ? UPGRADE_TREES[race]?.[building.type] : undefined;
    const lookup = (choice: string, cost: { gold: number; wood: number; stone: number }): UpgradeOption => {
      const def = tree?.[choice as keyof typeof tree];
      return { choice, cost, name: def?.name, desc: def?.desc };
    };
    const raceCosts = RACE_UPGRADE_COSTS[race];
    if (building.upgradePath.length === 1 && building.upgradePath[0] === 'A') {
      return [lookup('B', raceCosts.tier1), lookup('C', raceCosts.tier1)];
    }
    if (building.upgradePath.length === 2) {
      if (building.upgradePath[1] === 'B') {
        return [lookup('D', raceCosts.tier2), lookup('E', raceCosts.tier2)];
      }
      if (building.upgradePath[1] === 'C') {
        return [lookup('F', raceCosts.tier2), lookup('G', raceCosts.tier2)];
      }
    }
    return [];
  }

  // Returns true if click was consumed by a UI panel
  private handleUIClick(e: MouseEvent): boolean {
    const { W, milH, milY, milW } = this.getTrayLayout();
    const rect = this.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const player = this.game.state.players[0];

    // Compact utility buttons above tray (mobile-friendly)
    const util = this.getUtilityLayout(milY);
    if (cy >= util.utilY && cy < util.utilY + util.utilH) {
      if (cx >= util.pingX && cx < util.pingX + util.utilW) {
        const wx = this.camera.x + this.canvas.width / (2 * this.camera.zoom);
        const wy = this.camera.y + this.canvas.height / (2 * this.camera.zoom);
        this.game.sendCommand({ type: 'ping', playerId: 0, x: wx / TILE_SIZE, y: wy / TILE_SIZE });
        return true;
      }
      if (cx >= util.settingsX && cx < util.settingsX + util.utilW) {
        this.settingsOpen = !this.settingsOpen;
        return true;
      }
      if (cx >= util.chatX && cx < util.chatX + util.utilW) {
        const chatCoolingDown = Date.now() < this.quickChatCooldownUntil;
        if (chatCoolingDown) {
          if (this.queuedQuickChat) {
            this.queuedQuickChat = null;
            this.quickChatToast = { text: 'Canceled queued Defend', until: Date.now() + 900 };
            return true;
          }
          this.queueQuickChatFallback('Defend');
          return true;
        }
        this.quickChatRadialActive = true;
        this.quickChatRadialCenter = this.getClampedRadialCenter(this.canvas.width / 2, this.canvas.height / 2);
        this.pointerX = this.quickChatRadialCenter.x;
        this.pointerY = this.quickChatRadialCenter.y;
        return true;
      }
    }

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
      const sx = W - 220;
      const sy = milY - 124;
      if (cx < sx || cx >= sx + 200 || cy < sy || cy >= sy + 226) {
        this.settingsOpen = false;
        return true;
      }
      // close button
      if (cx >= sx + 176 && cx < sx + 196 && cy >= sy + 4 && cy < sy + 20) {
        this.settingsOpen = false;
        return true;
      }
      if (cx >= sx && cx < sx + 200 && cy >= sy && cy < sy + 226) {
        // lane mode row button
        if (cy >= sy + 34 && cy < sy + 58) {
          this.laneToggleMode = this.laneToggleMode === 'double' ? 'single' : 'double';
          this.saveLaneMode();
        }
        if (cy >= sy + 66 && cy < sy + 90) {
          this.uiFeedbackEnabled = !this.uiFeedbackEnabled;
          this.saveUiFeedbackEnabled();
        }
        if (cy >= sy + 98 && cy < sy + 122) {
          this.radialArmMs = this.radialArmMs >= 500 ? 240 : this.radialArmMs + 40;
          this.saveRadialSettings();
        }
        if (cy >= sy + 130 && cy < sy + 154) {
          this.radialSize = this.radialSize >= 110 ? 60 : this.radialSize + 8;
          this.saveRadialSettings();
        }
        if (cy >= sy + 162 && cy < sy + 186) {
          this.radialAccessibility = !this.radialAccessibility;
          this.saveRadialSettings();
        }
        if (cy >= sy + 194 && cy < sy + 218) {
          this.resetUiDefaults();
        }
        return true;
      }
    }

    // Upgrade panel (selected building first, hover fallback)
    const panelBuilding = this.getPanelBuilding();
    if (panelBuilding) {
      const options = this.getUpgradeOptions(panelBuilding);
      if (options.length > 0) {
        const panelW = 220;
        const panelX = W - panelW - 12;
        const panelY = milY - 60;
        if (cy >= panelY && cy < panelY + 48 && cx >= panelX && cx < panelX + panelW) {
          const halfW = Math.floor((panelW - 6) / 2);
          const left = { x: panelX + 2, w: halfW, opt: options[0] };
          const right = { x: panelX + 4 + halfW, w: halfW, opt: options[1] };
          const slot = cx < right.x ? left : right;
          this.game.sendCommand({
            type: 'purchase_upgrade', playerId: 0, buildingId: panelBuilding.id, choice: slot.opt.choice,
          });
          return true;
        }
      }
    }

    if (cy >= milY && cy < milY + milH) {
      const colIdx = Math.floor(cx / milW);
      if (colIdx === 0) {
        // Miner button
        this.game.sendCommand({ type: 'build_hut', playerId: 0 });
      } else if (colIdx >= 1 && colIdx <= BUILD_TRAY.length) {
        const item = BUILD_TRAY[colIdx - 1];
        this.nukeTargeting = false;
        this.selectedBuilding = this.selectedBuilding === item.type ? null : item.type;
      } else if (colIdx === BUILD_TRAY.length + 1) {
        if (player.nukeAvailable) {
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
    this.processQueuedQuickChat();
    const ctx = renderer.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawBuildTray(ctx);
    this.drawHelpButton(ctx);

    if (this.showTutorial) {
      this.drawTutorial(ctx);
      return; // don't draw other overlays while tutorial is open
    }

    if (this.touchRadialArmed && !this.quickChatRadialActive && this.touchArmCenter) {
      this.drawQuickChatArmCue(ctx);
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
        ctx.setTransform(1, 0, 0, 1, 0, 0);
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
    const { W, milH, milY, milW } = this.getTrayLayout();
    const player = this.game.state.players[0];
    const quickChatCdMs = Math.max(0, this.quickChatCooldownUntil - Date.now());

    ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
    ctx.fillRect(0, milY, W, milH);

    // Utility buttons above tray
    const util = this.getUtilityLayout(milY);
    const utilY = util.utilY;
    const compact = W < 430;
    ctx.fillStyle = 'rgba(20,20,20,0.88)';
    ctx.fillRect(util.pingX, utilY, util.utilW, util.utilH);
    ctx.strokeStyle = '#ffe082';
    ctx.strokeRect(util.pingX, utilY, util.utilW, util.utilH);
    ctx.fillStyle = '#ffe082';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('PING', util.pingX + util.utilW / 2, utilY + 16);

    ctx.fillStyle = this.settingsOpen ? 'rgba(41,121,255,0.22)' : 'rgba(20,20,20,0.88)';
    ctx.fillRect(util.settingsX, utilY, util.utilW, util.utilH);
    ctx.strokeStyle = '#9bb7ff';
    ctx.strokeRect(util.settingsX, utilY, util.utilW, util.utilH);
    ctx.fillStyle = '#9bb7ff';
    ctx.fillText(compact ? 'SET' : 'SETTINGS', util.settingsX + util.utilW / 2, utilY + 16);
    if (compact) {
      ctx.fillStyle = '#bbdefb';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(this.laneToggleMode === 'single' ? 'FAST' : 'SAFE', util.settingsX + util.utilW - 6, utilY + 16);
    }

    const chatCoolingDown = quickChatCdMs > 0;
    const chatIsQueued = this.queuedQuickChat !== null;
    ctx.fillStyle = this.quickChatRadialActive
      ? 'rgba(41,121,255,0.22)'
      : (chatCoolingDown ? 'rgba(255,152,0,0.22)' : 'rgba(20,20,20,0.88)');
    ctx.fillRect(util.chatX, utilY, util.utilW, util.utilH);
    ctx.strokeStyle = '#90caf9';
    ctx.strokeRect(util.chatX, utilY, util.utilW, util.utilH);
    ctx.fillStyle = chatCoolingDown ? '#ffcc80' : '#90caf9';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(chatCoolingDown ? 'DEFEND' : 'CHAT', util.chatX + util.utilW / 2, utilY + 16);
    if (chatIsQueued) {
      ctx.fillStyle = '#ffcc80';
      ctx.font = 'bold 10px monospace';
      ctx.fillText('QUEUED', util.chatX + util.utilW / 2, utilY + 24);
    } else if (chatCoolingDown) {
      ctx.fillStyle = '#ffcc80';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Tap = queue Defend', util.chatX + util.utilW / 2, utilY - 4);
    }
    // --- Helper: draw colorized cost parts at a position ---
    const drawCost = (parts: { val: number; type: 'g' | 'w' | 's' }[], cx: number, cy: number, affordable: boolean) => {
      const goldColor = affordable ? '#ffd740' : '#665500';
      const woodColor = affordable ? '#81c784' : '#2e5530';
      const stoneColor = affordable ? '#b0bec5' : '#4a5058';
      ctx.font = 'bold 12px monospace';
      const strs = parts.map(p => `${p.val}${p.type}`);
      const gap = 5;
      let totalW = 0;
      for (let j = 0; j < strs.length; j++) {
        totalW += ctx.measureText(strs[j]).width;
        if (j < strs.length - 1) totalW += gap;
      }
      let drawX = cx - totalW / 2;
      for (let j = 0; j < parts.length; j++) {
        ctx.fillStyle = parts[j].type === 'g' ? goldColor : parts[j].type === 'w' ? woodColor : stoneColor;
        ctx.textAlign = 'left';
        ctx.fillText(strs[j], drawX, cy);
        drawX += ctx.measureText(strs[j]).width + gap;
      }
    };

    // Cell layout: icon square on left (~22%), text column on right (~78%)
    const iconColW = Math.min(Math.floor(milW * 0.22), 34);
    const cellTextX = (cellX: number) => cellX + iconColW + (milW - iconColW) / 2;

    // === Miner button (col 0) ===
    const myHuts = this.game.state.buildings.filter(
      b => b.playerId === 0 && b.type === BuildingType.HarvesterHut
    );
    const hutBase = RACE_BUILDING_COSTS[player.race][BuildingType.HarvesterHut];
    const hutMult = Math.pow(1.35, Math.max(0, myHuts.length - 1));
    const hutGold = Math.floor(hutBase.gold * hutMult);
    const hutWood = Math.floor(hutBase.wood * hutMult);
    const hutStone = Math.floor(hutBase.stone * hutMult);
    const canAffordHut = player.gold >= hutGold && player.wood >= hutWood && player.stone >= hutStone && myHuts.length < 10;
    const mx = 0;
    ctx.fillStyle = 'rgba(40, 55, 20, 0.9)';
    ctx.fillRect(mx + 1, milY + 1, milW - 2, milH - 2);
    ctx.strokeStyle = canAffordHut ? '#8bc34a' : '#3a4a1a';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx + 1, milY + 1, milW - 2, milH - 2);

    // Miner icon (pickaxe) in left column, scaled to cell
    const mIcX = mx + iconColW / 2;
    const mIcY = milY + milH / 2;
    const ps = Math.min(iconColW * 0.4, milH * 0.28, 12);
    ctx.strokeStyle = canAffordHut ? '#c5e1a5' : '#555';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(mIcX - ps, mIcY + ps);
    ctx.lineTo(mIcX + ps * 0.65, mIcY - ps * 0.65);
    ctx.lineTo(mIcX + ps, mIcY - ps * 0.15);
    ctx.moveTo(mIcX + ps * 0.65, mIcY - ps * 0.65);
    ctx.lineTo(mIcX + ps * 0.15, mIcY - ps);
    ctx.stroke();
    ctx.strokeStyle = canAffordHut ? '#8d6e63' : '#444';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(mIcX - ps, mIcY + ps);
    ctx.lineTo(mIcX - ps * 0.2, mIcY + ps * 0.2);
    ctx.stroke();

    // Miner text in right column
    const mTx = cellTextX(mx);
    ctx.textAlign = 'center';
    ctx.fillStyle = canAffordHut ? '#c5e1a5' : '#555';
    ctx.font = 'bold 12px monospace';
    ctx.fillText('Miner', mTx, milY + 20);
    const hutCostItems: { val: number; type: 'g' | 'w' | 's' }[] = [];
    if (hutGold > 0) hutCostItems.push({ val: hutGold, type: 'g' });
    if (hutWood > 0) hutCostItems.push({ val: hutWood, type: 'w' });
    if (hutStone > 0) hutCostItems.push({ val: hutStone, type: 's' });
    if (myHuts.length < 10) {
      drawCost(hutCostItems, mTx, milY + 42, canAffordHut);
    } else {
      ctx.fillStyle = '#555'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
      ctx.fillText('MAX', mTx, milY + 42);
    }
    ctx.fillStyle = '#4a5a2a'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
    ctx.fillText('[M]', mTx, milY + 56);

    // === Military buttons (cols 1-4) ===
    const race = player.race;
    const raceColor = RACE_COLORS[race]?.primary ?? '#fff';
    for (let i = 0; i < BUILD_TRAY.length; i++) {
      const item = BUILD_TRAY[i];
      const bx = (i + 1) * milW;
      const isSelected = this.selectedBuilding === item.type;
      const cost = RACE_BUILDING_COSTS[race][item.type];
      const isFirstTowerFree = item.type === BuildingType.Tower &&
        !this.game.state.buildings.some(b => b.playerId === 0 && b.type === BuildingType.Tower);
      const canAfford = isFirstTowerFree || (player.gold >= cost.gold && player.wood >= cost.wood && player.stone >= cost.stone);

      let unitName: string;
      let category: 'melee' | 'ranged' | 'caster' | 'tower';
      if (item.type === BuildingType.Tower) {
        unitName = 'Tower';
        category = 'tower';
      } else {
        const stats = UNIT_STATS[race]?.[item.type];
        unitName = stats?.name ?? item.label;
        category = item.type === BuildingType.MeleeSpawner ? 'melee'
          : item.type === BuildingType.RangedSpawner ? 'ranged' : 'caster';
      }

      // Cell background & border
      ctx.fillStyle = isSelected ? 'rgba(41, 121, 255, 0.28)' : 'rgba(28, 28, 28, 0.9)';
      ctx.fillRect(bx + 1, milY + 1, milW - 2, milH - 2);
      ctx.strokeStyle = isSelected ? '#2979ff' : (canAfford ? '#555' : '#333');
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeRect(bx + 1, milY + 1, milW - 2, milH - 2);

      // Icon in left column (vertically centered, scaled to cell size)
      const sX = bx + iconColW / 2;
      const sY = milY + milH / 2;
      const iconR = Math.min(iconColW * 0.45, milH * 0.3, 14);
      if (category !== 'tower' && this.currentRenderer) {
        this.currentRenderer.drawUnitShape(ctx, sX, sY, iconR, race, category, Team.Bottom, raceColor);
      } else {
        // Tower icon
        const tw = iconR * 1.2;
        const th = iconR * 1.8;
        ctx.fillStyle = raceColor;
        ctx.fillRect(sX - tw / 2, sY - th / 2, tw, th);
        ctx.fillRect(sX - tw / 2 - 2, sY - th / 2 - 2, tw + 4, 3);
        ctx.strokeStyle = canAfford ? '#888' : '#444';
        ctx.lineWidth = 1;
        ctx.strokeRect(sX - tw / 2, sY - th / 2, tw, th);
      }

      // Text in right column
      const tx = cellTextX(bx);
      ctx.textAlign = 'center';

      // Unit name (only wrap if too wide for text column)
      ctx.fillStyle = canAfford ? '#eee' : '#555';
      const textColW = milW - iconColW - 6;
      ctx.font = 'bold 12px monospace';
      const nameW = ctx.measureText(unitName).width;
      if (nameW > textColW && unitName.includes(' ')) {
        const parts = unitName.split(' ');
        ctx.font = 'bold 10px monospace';
        ctx.fillText(parts[0], tx, milY + 15);
        ctx.fillText(parts.slice(1).join(' '), tx, milY + 26);
      } else {
        ctx.fillText(unitName, tx, milY + 20);
      }

      // Cost (colorized per resource, same Y)
      if (isFirstTowerFree) {
        ctx.fillStyle = '#4caf50'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
        ctx.fillText('FREE', tx, milY + 42);
      } else {
        const costItems: { val: number; type: 'g' | 'w' | 's' }[] = [];
        if (cost.gold > 0) costItems.push({ val: cost.gold, type: 'g' });
        if (cost.wood > 0) costItems.push({ val: cost.wood, type: 'w' });
        if (cost.stone > 0) costItems.push({ val: cost.stone, type: 's' });
        drawCost(costItems, tx, milY + 42, canAfford);
      }

      // Key hint
      ctx.fillStyle = '#444'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
      ctx.fillText(`[${item.key}]`, tx, milY + 56);
    }
    // Nuke button (col 5)
    const nukeAvail = player.nukeAvailable;
    const nukeX = (BUILD_TRAY.length + 1) * milW;
    ctx.fillStyle = this.nukeTargeting ? 'rgba(255, 50, 0, 0.35)' : 'rgba(28, 28, 28, 0.9)';
    ctx.fillRect(nukeX + 1, milY + 1, milW - 2, milH - 2);
    ctx.strokeStyle = this.nukeTargeting ? '#ff5722' : (nukeAvail ? '#ff5722' : '#333');
    ctx.lineWidth = this.nukeTargeting ? 2 : 1;
    ctx.strokeRect(nukeX + 1, milY + 1, milW - 2, milH - 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = nukeAvail ? '#ff5722' : '#555';
    ctx.font = 'bold 17px monospace';
    ctx.fillText('NUKE', nukeX + milW / 2, milY + 26);
    ctx.fillStyle = '#555';
    ctx.font = '12px monospace';
    ctx.fillText('[N]', nukeX + milW / 2, milY + 50);

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
      const sx = W - 220;
      const sy = milY - 124;
      ctx.fillStyle = 'rgba(0,0,0,0.88)';
      ctx.fillRect(sx, sy, 200, 226);
      ctx.strokeStyle = '#2979ff';
      ctx.strokeRect(sx, sy, 200, 226);
      ctx.fillStyle = '#bbdefb';
      ctx.font = 'bold 12px monospace';
      ctx.fillText('Settings', sx + 8, sy + 16);
      ctx.fillStyle = 'rgba(20,20,20,0.9)';
      ctx.fillRect(sx + 176, sy + 4, 20, 16);
      ctx.strokeStyle = '#9bb7ff';
      ctx.strokeRect(sx + 176, sy + 4, 20, 16);
      ctx.fillStyle = '#9bb7ff';
      ctx.fillText('X', sx + 183, sy + 16);
      ctx.fillStyle = 'rgba(20,20,20,0.9)';
      ctx.fillRect(sx + 8, sy + 34, 184, 24);
      ctx.strokeStyle = '#9bb7ff';
      ctx.strokeRect(sx + 8, sy + 34, 184, 24);
      ctx.fillStyle = '#9bb7ff';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`Lane Tap: ${this.laneModeLabel()}`, sx + 16, sy + 50);
      ctx.fillStyle = '#8fa7bf';
      ctx.font = '10px monospace';
      ctx.fillText('Fast = single tap, Safe = double tap', sx + 8, sy + 63);

      ctx.fillStyle = 'rgba(20,20,20,0.9)';
      ctx.fillRect(sx + 8, sy + 66, 184, 24);
      ctx.strokeStyle = '#90caf9';
      ctx.strokeRect(sx + 8, sy + 66, 184, 24);
      ctx.fillStyle = '#90caf9';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`UI Feedback: ${this.uiFeedbackEnabled ? 'on' : 'off'}`, sx + 16, sy + 82);
      ctx.fillStyle = '#8fa7bf';
      ctx.font = '10px monospace';
      ctx.fillText('Haptics + short beep for chat actions', sx + 8, sy + 95);

      ctx.fillStyle = 'rgba(20,20,20,0.9)';
      ctx.fillRect(sx + 8, sy + 98, 184, 24);
      ctx.strokeStyle = '#90caf9';
      ctx.strokeRect(sx + 8, sy + 98, 184, 24);
      ctx.fillStyle = '#90caf9';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`Hold Delay: ${this.radialArmMs}ms`, sx + 16, sy + 114);
      ctx.fillStyle = '#8fa7bf';
      ctx.font = '10px monospace';
      ctx.fillText('Long-press time before radial opens', sx + 8, sy + 127);

      ctx.fillStyle = 'rgba(20,20,20,0.9)';
      ctx.fillRect(sx + 8, sy + 130, 184, 24);
      ctx.strokeStyle = '#90caf9';
      ctx.strokeRect(sx + 8, sy + 130, 184, 24);
      ctx.fillStyle = '#90caf9';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`Radial Size: ${this.radialSize}`, sx + 16, sy + 146);
      ctx.fillStyle = '#8fa7bf';
      ctx.font = '10px monospace';
      ctx.fillText('Bigger ring + farther option labels', sx + 8, sy + 159);

      ctx.fillStyle = 'rgba(20,20,20,0.9)';
      ctx.fillRect(sx + 8, sy + 162, 184, 24);
      ctx.strokeStyle = '#90caf9';
      ctx.strokeRect(sx + 8, sy + 162, 184, 24);
      ctx.fillStyle = '#90caf9';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`Radial A11y: ${this.radialAccessibility ? 'on' : 'off'}`, sx + 16, sy + 178);
      ctx.fillStyle = '#8fa7bf';
      ctx.font = '10px monospace';
      ctx.fillText('High contrast + larger chat labels', sx + 8, sy + 191);

      ctx.fillStyle = 'rgba(20,20,20,0.9)';
      ctx.fillRect(sx + 8, sy + 194, 184, 24);
      ctx.strokeStyle = '#ffcc80';
      ctx.strokeRect(sx + 8, sy + 194, 184, 24);
      ctx.fillStyle = '#ffcc80';
      ctx.font = 'bold 12px monospace';
      ctx.fillText('Reset Defaults', sx + 16, sy + 210);
    }

    const panelBuilding = this.getPanelBuilding();
    if (panelBuilding) {
      const options = this.getUpgradeOptions(panelBuilding);
      if (options.length > 0) {
        const panelW = 260;
        const panelX = W - panelW - 12;
        const panelH = 64;
        const panelY = milY - panelH - 12;
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.fillRect(panelX, panelY, panelW, panelH);
        ctx.strokeStyle = '#2979ff';
        ctx.lineWidth = 1;
        ctx.strokeRect(panelX, panelY, panelW, panelH);

        const drawUpgradeBtn = (x: number, w: number, opt: UpgradeOption) => {
          const canAfford = player.gold >= opt.cost.gold && player.wood >= opt.cost.wood && player.stone >= opt.cost.stone;
          ctx.fillStyle = canAfford ? 'rgba(41,121,255,0.22)' : 'rgba(80,80,80,0.25)';
          ctx.fillRect(x, panelY + 2, w, panelH - 4);
          ctx.strokeStyle = canAfford ? '#64b5f6' : '#555';
          ctx.strokeRect(x, panelY + 2, w, panelH - 4);
          ctx.textAlign = 'center';
          ctx.fillStyle = canAfford ? '#bbdefb' : '#777';
          ctx.font = 'bold 11px monospace';
          ctx.fillText(opt.name ?? opt.choice, x + w / 2, panelY + 16);
          ctx.fillStyle = canAfford ? '#aaa' : '#555';
          ctx.font = '9px monospace';
          ctx.fillText(opt.desc ?? '', x + w / 2, panelY + 30);
          ctx.fillStyle = canAfford ? '#ffd700' : '#666';
          ctx.font = '10px monospace';
          ctx.fillText(`${opt.cost.gold}g ${opt.cost.wood}w ${opt.cost.stone}s`, x + w / 2, panelY + 44);
          ctx.fillStyle = canAfford ? '#64b5f6' : '#555';
          ctx.font = '9px monospace';
          ctx.fillText(`[${opt.choice === options[0].choice ? 'U' : 'I'}]`, x + w / 2, panelY + 56);
        };

        const halfW = Math.floor((panelW - 6) / 2);
        drawUpgradeBtn(panelX + 2, halfW, options[0]);
        drawUpgradeBtn(panelX + 4 + halfW, halfW, options[1]);

        ctx.fillStyle = '#9bb7ff';
        ctx.font = '11px monospace';
        ctx.textAlign = 'left';
        const selected = this.getSelectedOwnedBuilding();
        ctx.fillText(selected ? 'Selected building upgrades' : 'Hovered building upgrades', panelX + 6, panelY - 4);
      }
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
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      // Draw info panel at top of screen
      const player = this.game.state.players[u.playerId];
      const race = player?.race;
      const raceColor = race ? (RACE_COLORS[race]?.primary ?? '#fff') : '#fff';
      const teamLabel = u.team === Team.Bottom ? 'Ally' : 'Enemy';

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
      const boxX = (this.canvas.width - boxW) / 2;
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
    const teamLabel = u.team === Team.Bottom ? 'Ally' : 'Enemy';
    let tip = `${u.type} (${teamLabel} ${u.category})  HP: ${u.hp}/${u.maxHp}`;
    if (u.shieldHp > 0) tip += ` +${u.shieldHp} shield`;
    return tip;
  }

  private devBalanceCache: { data: any[] | null; lastRefresh: number } = { data: null, lastRefresh: 0 };

  private drawDevOverlay(ctx: CanvasRenderingContext2D): void {
    const state = this.game.state;
    const W = this.canvas.width;

    // Semi-transparent background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(0, 0, W, this.canvas.height);

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
    ctx.fillText(`HQ HP: Bottom ${state.hqHp[0]} | Top ${state.hqHp[1]}`, col1, y);
    y += lh + 4;

    // Per-player live stats table
    const headers = ['P#', 'Race', 'Team', 'Gold', 'Wood', 'Stone', 'DMG', 'Spawn', 'Lost', 'Bld'];
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
    ctx.fillText(`Bottom: ${botUnits.length} total (${botMelee}m ${botRanged}r ${botCaster}c)  Harvesters: ${state.harvesters.filter(h => h.playerId < 2).length}`, col1, y);
    y += lh;
    ctx.fillText(`Top:    ${topUnits.length} total (${topMelee}m ${topRanged}r ${topCaster}c)  Harvesters: ${state.harvesters.filter(h => h.playerId >= 2).length}`, col1, y);
    y += lh + 8;

    // --- HISTORICAL BALANCE (from localStorage) ---
    ctx.fillStyle = '#ffd740';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('BALANCE HISTORY', col1, y);
    y += lh;

    const now = Date.now();
    if (!this.devBalanceCache.data || now - this.devBalanceCache.lastRefresh > 2000) {
      try {
        const raw = localStorage.getItem('asciiwars.balanceLog');
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
      ctx.fillText(`P${pi} ${p.race}: ${gps}g/s  ${wps}w/s  ${sps}s/s  total: ${s.totalGoldEarned + s.totalWoodEarned + s.totalStoneEarned}`, col1, y);
      y += lh;
    }

    ctx.textAlign = 'start';
  }

  private getSpecialDesc(race: Race, type: BuildingType): string {
    if (type === BuildingType.Tower) {
      const descs: Record<Race, string> = {
        [Race.Surge]: 'Chain lightning',
        [Race.Tide]: 'AoE slow',
        [Race.Ember]: 'Burn splash',
        [Race.Bastion]: 'Shield allies',
        [Race.Shade]: 'Poison on hit',
        [Race.Thorn]: 'Regen aura',
      };
      return descs[race] ?? '';
    }
    if (type === BuildingType.CasterSpawner) {
      const descs: Record<Race, string> = {
        [Race.Surge]: 'Haste pulse + AoE',
        [Race.Tide]: 'Cleanse + AoE slow',
        [Race.Ember]: 'Pure burst AoE',
        [Race.Bastion]: 'Shield allies',
        [Race.Shade]: 'Lifesteal heal + AoE',
        [Race.Thorn]: 'Heal aura + AoE',
      };
      return descs[race] ?? '';
    }
    if (type === BuildingType.MeleeSpawner) {
      const descs: Record<Race, string> = {
        [Race.Surge]: 'Fast attack',
        [Race.Tide]: 'Slow on hit',
        [Race.Ember]: 'High damage',
        [Race.Bastion]: 'High HP tank',
        [Race.Shade]: 'Poison + lifesteal',
        [Race.Thorn]: 'Slow on hit + tanky',
      };
      return descs[race] ?? '';
    }
    if (type === BuildingType.RangedSpawner) {
      const descs: Record<Race, string> = {
        [Race.Surge]: 'Long range',
        [Race.Tide]: 'Slow projectile',
        [Race.Ember]: 'Burn projectile',
        [Race.Bastion]: 'Siege range',
        [Race.Shade]: 'Poison projectile',
        [Race.Thorn]: 'Slow projectile',
      };
      return descs[race] ?? '';
    }
    return '';
  }

  private drawPlacementHighlight(ctx: CanvasRenderingContext2D, renderer: Renderer): void {
    if (!this.selectedBuilding) return;
    const cam = renderer.camera;
    const isTower = this.selectedBuilding === BuildingType.Tower;
    const myTeam = Team.Bottom;

    ctx.save();
    cam.applyTransform(ctx);

    // Highlight military grid slots (for non-tower or all types)
    if (!isTower) {
      const origin = getBuildGridOrigin(0);
      for (let gy = 0; gy < BUILD_GRID_ROWS; gy++) {
        for (let gx = 0; gx < BUILD_GRID_COLS; gx++) {
          const wx = (origin.x + gx) * TILE_SIZE;
          const wy = (origin.y + gy) * TILE_SIZE;
          const occupied = this.game.state.buildings.some(
            b => b.buildGrid === 'military' && b.gridX === gx && b.gridY === gy && b.playerId === 0
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
      const alley = getTeamAlleyOrigin(myTeam);
      for (let gy = 0; gy < SHARED_ALLEY_ROWS; gy++) {
        for (let gx = 0; gx < SHARED_ALLEY_COLS; gx++) {
          const wx = (alley.x + gx) * TILE_SIZE;
          const wy = (alley.y + gy) * TILE_SIZE;
          const occupied = this.game.state.buildings.some(
            b => {
              if (b.buildGrid !== 'alley' || b.gridX !== gx || b.gridY !== gy) return false;
              const bTeam = b.playerId < 2 ? Team.Bottom : Team.Top;
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
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private drawBuildTooltip(ctx: CanvasRenderingContext2D, _renderer: Renderer): void {
    if (!this.selectedBuilding) return;
    const player = this.game.state.players[0];
    const race = player.race;
    const type = this.selectedBuilding;

    let name: string;
    let hp: number;
    let damage: number;
    let atkSpd: number;
    let range: number;

    if (type === BuildingType.Tower) {
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

    const special = this.getSpecialDesc(race, type);
    const raceColor = RACE_COLORS[race]?.primary ?? '#fff';
    const { milY } = this.getTrayLayout();

    // Tooltip box above the build tray
    const lines = [
      name,
      `HP:${hp}  DMG:${damage}  SPD:${atkSpd.toFixed(1)}s  RNG:${range}`,
    ];
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
    const boxX = (this.canvas.width - boxW) / 2;
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

    const origin = slot.isAlley ? getTeamAlleyOrigin(Team.Bottom) : getBuildGridOrigin(0);
    const worldX = (origin.x + slot.gx) * TILE_SIZE;
    const worldY = (origin.y + slot.gy) * TILE_SIZE;

    const grid = slot.isAlley ? 'alley' : 'military';
    const myTeam = Team.Bottom;
    const occupied = this.game.state.buildings.some(
      b => {
        if (b.buildGrid !== grid || b.gridX !== slot.gx || b.gridY !== slot.gy) return false;
        if (!slot.isAlley) return b.playerId === 0;
        const buildingTeam = b.playerId < 2 ? Team.Bottom : Team.Top;
        return buildingTeam === myTeam;
      }
    );

    renderer.camera.applyTransform(ctx);

    ctx.fillStyle = occupied ? 'rgba(255, 0, 0, 0.3)' : 'rgba(0, 255, 0, 0.3)';
    ctx.fillRect(worldX, worldY, TILE_SIZE, TILE_SIZE);
    ctx.strokeStyle = occupied ? '#f44336' : '#4caf50';
    ctx.lineWidth = 2;
    ctx.strokeRect(worldX, worldY, TILE_SIZE, TILE_SIZE);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private drawNukeOverlay(ctx: CanvasRenderingContext2D): void {
    const cam = this.camera;
    const team = this.game.state.players[0]?.team ?? Team.Bottom;

    // Draw red blocked zone over enemy half (can't nuke there)
    const forbiddenMinY = team === Team.Bottom ? 0 : ZONES.MID.end;
    const forbiddenMaxY = team === Team.Bottom ? ZONES.MID.start : MAP_HEIGHT;
    const screenX1 = (0 - cam.x) * cam.zoom;
    const screenY1 = (forbiddenMinY * TILE_SIZE - cam.y) * cam.zoom;
    const screenX2 = (MAP_WIDTH * TILE_SIZE - cam.x) * cam.zoom;
    const screenY2 = (forbiddenMaxY * TILE_SIZE - cam.y) * cam.zoom;

    ctx.fillStyle = 'rgba(255, 0, 0, 0.15)';
    ctx.fillRect(screenX1, screenY1, screenX2 - screenX1, screenY2 - screenY1);

    // Striped forbidden border
    ctx.strokeStyle = 'rgba(255, 50, 0, 0.6)';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 6]);
    const borderY = team === Team.Bottom ? screenY1 + (screenY2 - screenY1) : screenY1;
    ctx.beginPath();
    ctx.moveTo(screenX1, borderY);
    ctx.lineTo(screenX2, borderY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Light valid zone tint
    ctx.fillStyle = 'rgba(255, 100, 0, 0.04)';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Instruction text
    ctx.fillStyle = '#ff5722';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('CLICK TO FIRE NUKE (own half only)  [ESC to cancel]', this.canvas.width / 2, 60);
    ctx.textAlign = 'start';
  }

  private drawQuickChatRadial(ctx: CanvasRenderingContext2D): void {
    if (!this.quickChatRadialCenter) return;
    const cx = this.quickChatRadialCenter.x;
    const cy = this.quickChatRadialCenter.y;
    const selected = this.getQuickChatChoiceFromPointer();

    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
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

  private drawQuickChatArmCue(ctx: CanvasRenderingContext2D): void {
    if (!this.touchArmCenter) return;
    const elapsed = Date.now() - this.touchArmStartAt;
    const t = Math.max(0, Math.min(1, elapsed / this.radialArmMs));
    const cx = this.touchArmCenter.x;
    const cy = this.touchArmCenter.y;
    const cueR = this.radialAccessibility ? 24 : 20;
    ctx.beginPath();
    ctx.arc(cx, cy, cueR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, cueR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
    ctx.strokeStyle = 'rgba(144,202,249,0.9)';
    ctx.lineWidth = 3;
    ctx.stroke();
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
