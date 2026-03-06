import { Game } from '../game/Game';
import { Camera } from '../rendering/Camera';
import { Renderer } from '../rendering/Renderer';
import {
  BuildingType, TILE_SIZE, BUILD_GRID_COLS, BUILD_GRID_ROWS, SHARED_ALLEY_COLS, SHARED_ALLEY_ROWS, Lane,
  HarvesterAssignment, Team,
} from '../simulation/types';
import { getBuildGridOrigin, getTeamAlleyOrigin } from '../simulation/GameState';
import { BUILDING_COSTS, HARVESTER_HUT_COST, UPGRADE_COSTS, UPGRADE_TREES } from '../simulation/data';

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
  private showTutorial = true;
  private abortController = new AbortController();

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
      if (this.selectedBuilding !== null) {
        const world = this.eventToWorld(e);
        this.hoveredGridSlot = this.worldToGridSlot(0, world.x, world.y);
      } else {
        this.hoveredGridSlot = null;
        // Check for building hover tooltip
        const world = this.eventToWorld(e);
        const tileX = Math.floor(world.x / TILE_SIZE);
        const tileY = Math.floor(world.y / TILE_SIZE);
        const building = this.game.state.buildings.find(b =>
          b.playerId === 0 && b.worldX === tileX && b.worldY === tileY
        );
        if (building) {
          this.hoveredBuildingId = building.id;
          let tip = `${building.type} HP:${building.hp}/${building.maxHp}`;
          if (building.type === BuildingType.HarvesterHut) {
            const h = this.game.state.harvesters.find(h => h.hutId === building.id);
            if (h) tip += ` [${ASSIGNMENT_LABELS[h.assignment]}]`;
          } else if (building.type !== BuildingType.Tower) {
            tip += ` Lane:${building.lane}`;
          }
          if (building.upgradePath.length > 0) tip += ` Up:${building.upgradePath.join('>')}`;
          const options = this.getUpgradeOptions(building);
          if (options.length > 0) tip += ` Next:${options[0].choice}/${options[1].choice}`;
          this.tooltip = { text: tip, x: e.clientX, y: e.clientY - 20 };
        }
      }
    }, sig);

    this.canvas.addEventListener('click', (e) => {
      if (Date.now() < this.suppressClicksUntil) return;
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

      // Nuke targeting
      if (this.nukeTargeting) {
        const world = this.eventToWorld(e);
        this.game.sendCommand({
          type: 'fire_nuke', playerId: 0,
          x: world.x / TILE_SIZE, y: world.y / TILE_SIZE,
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
    if (!building) return;
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
    if (building.upgradePath.length === 1 && building.upgradePath[0] === 'A') {
      return [lookup('B', UPGRADE_COSTS.tier1), lookup('C', UPGRADE_COSTS.tier1)];
    }
    if (building.upgradePath.length === 2) {
      if (building.upgradePath[1] === 'B') {
        return [lookup('D', UPGRADE_COSTS.tier2), lookup('E', UPGRADE_COSTS.tier2)];
      }
      if (building.upgradePath[1] === 'C') {
        return [lookup('F', UPGRADE_COSTS.tier2), lookup('G', UPGRADE_COSTS.tier2)];
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

    if (this.selectedBuilding !== null && this.hoveredGridSlot) {
      this.drawPlacementPreview(ctx, renderer);
    }

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
    }    // Miner button (col 0, earthy green-brown)
    const myHuts = this.game.state.buildings.filter(
      b => b.playerId === 0 && b.type === BuildingType.HarvesterHut
    );
    const hutCost = HARVESTER_HUT_COST(myHuts.length);
    const canAffordHut = player.gold >= hutCost && myHuts.length < 10;
    const mx = 0;
    ctx.fillStyle = 'rgba(40, 55, 20, 0.9)';
    ctx.fillRect(mx + 1, milY + 1, milW - 2, milH - 2);
    ctx.strokeStyle = canAffordHut ? '#8bc34a' : '#3a4a1a';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx + 1, milY + 1, milW - 2, milH - 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = canAffordHut ? '#c5e1a5' : '#555';
    ctx.font = 'bold 15px monospace';
    ctx.fillText('Miner', mx + milW / 2, milY + 22);
    ctx.fillStyle = canAffordHut ? '#ffd700' : '#553300';
    ctx.font = '13px monospace';
    ctx.fillText(myHuts.length < 10 ? `${hutCost}g` : 'MAX', mx + milW / 2, milY + 40);
    ctx.fillStyle = '#4a5a2a';
    ctx.font = '12px monospace';
    ctx.fillText('[M]', mx + milW / 2, milY + 56);    // Military buttons (cols 1-4)
    for (let i = 0; i < BUILD_TRAY.length; i++) {
      const item = BUILD_TRAY[i];
      const bx = (i + 1) * milW;
      const isSelected = this.selectedBuilding === item.type;
      const cost = BUILDING_COSTS[item.type];
      const canAfford = player.gold >= cost.gold && player.wood >= cost.wood && player.stone >= cost.stone;

      ctx.fillStyle = isSelected ? 'rgba(41, 121, 255, 0.28)' : 'rgba(28, 28, 28, 0.9)';
      ctx.fillRect(bx + 1, milY + 1, milW - 2, milH - 2);
      ctx.strokeStyle = isSelected ? '#2979ff' : (canAfford ? '#555' : '#333');
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeRect(bx + 1, milY + 1, milW - 2, milH - 2);

      ctx.textAlign = 'center';
      ctx.fillStyle = canAfford ? '#eee' : '#555';
      ctx.font = 'bold 15px monospace';
      ctx.fillText(item.label, bx + milW / 2, milY + 22);

      let costStr = `${cost.gold}g`;
      if (cost.wood > 0) costStr += ` ${cost.wood}w`;
      if (cost.stone > 0) costStr += ` ${cost.stone}s`;
      ctx.fillStyle = canAfford ? '#ffd700' : '#553300';
      ctx.font = '13px monospace';
      ctx.fillText(costStr, bx + milW / 2, milY + 40);

      ctx.fillStyle = '#555';
      ctx.font = '12px monospace';
      ctx.fillText(`[${item.key}]`, bx + milW / 2, milY + 56);
    }    // Nuke button (col 5)
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
    // Red-tinted screen overlay
    ctx.fillStyle = 'rgba(255, 0, 0, 0.05)';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Instruction text
    ctx.fillStyle = '#ff5722';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('CLICK TO FIRE NUKE  [ESC to cancel]', this.canvas.width / 2, 60);
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
