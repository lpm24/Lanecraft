import { Camera } from './Camera';
import {
  GameState, Team, MAP_WIDTH, MAP_HEIGHT, TILE_SIZE,
  DIAMOND_CENTER_X, DIAMOND_CENTER_Y,
  WOOD_NODE_X, STONE_NODE_X,
  ZONES, BUILD_GRID_COLS, BUILD_GRID_ROWS, HUT_GRID_COLS, SHARED_ALLEY_COLS, SHARED_ALLEY_ROWS,
  HQ_WIDTH, HQ_HEIGHT, HQ_HP,
  getMarginAtRow,
  BuildingType, Lane, LANE_PATHS, Vec2,
  StatusType, Race,
} from '../simulation/types';
import { getHQPosition, getBuildGridOrigin, getHutGridOrigin, getTeamAlleyOrigin, getUnitUpgradeMultipliers } from '../simulation/GameState';
import { RACE_COLORS, TOWER_STATS, PLAYER_COLORS } from '../simulation/data';

const T = TILE_SIZE;
const LANE_LEFT_COLOR = '#4fc3f7';
const LANE_RIGHT_COLOR = '#ff8a65';

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
  return { icon: '!', color: '#ffcc80' };
}

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  camera: Camera;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.camera = new Camera(canvas);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resize(): void {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  render(state: GameState): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.camera.applyTransform(ctx);

    this.drawZones(ctx);
    this.drawLanePaths(ctx);
    this.drawDiamondCells(ctx, state);
    this.drawResourceNodes(ctx);
    this.drawBuildGrids(ctx, state);
    this.drawHutZones(ctx, state);
    this.drawTowerAlleys(ctx, state);
    this.drawHQs(ctx, state);
    this.drawBuildings(ctx, state);
    this.drawProjectiles(ctx, state);
    this.drawUnits(ctx, state);
    this.drawHarvesters(ctx, state);
    this.drawDiamondObjective(ctx, state);
    this.drawNukeTelegraphs(ctx, state);
    this.drawPings(ctx, state);
    this.drawParticles(ctx, state);
    this.drawFloatingTexts(ctx, state);
    this.drawNukeEffects(ctx, state);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawHUD(ctx, state);
    this.drawQuickChats(ctx, state);
    this.drawMinimap(ctx, state);
  }

  // === Map Shape ===

  private drawZones(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, MAP_WIDTH * T, MAP_HEIGHT * T);

    const leftEdge: { x: number; y: number }[] = [];
    const rightEdge: { x: number; y: number }[] = [];
    for (let y = 0; y <= MAP_HEIGHT; y++) {
      const m = getMarginAtRow(y);
      leftEdge.push({ x: m, y });
      rightEdge.push({ x: MAP_WIDTH - m, y });
    }

    this.fillZoneRows(ctx, leftEdge, rightEdge, ZONES.TOP_BASE.start, ZONES.TOP_BASE.end, 'rgba(200, 0, 0, 0.08)');
    this.fillZoneRows(ctx, leftEdge, rightEdge, ZONES.BOTTOM_BASE.start, ZONES.BOTTOM_BASE.end, 'rgba(0, 80, 200, 0.08)');
    this.fillZoneRows(ctx, leftEdge, rightEdge, ZONES.TOP_TERRITORY.start, ZONES.TOP_TERRITORY.end, 'rgba(0, 100, 50, 0.04)');
    this.fillZoneRows(ctx, leftEdge, rightEdge, ZONES.BOTTOM_TERRITORY.start, ZONES.BOTTOM_TERRITORY.end, 'rgba(0, 100, 50, 0.04)');
    this.fillZoneRows(ctx, leftEdge, rightEdge, ZONES.MID.start, ZONES.MID.end, 'rgba(80, 50, 0, 0.04)');

    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(leftEdge[0].x * T, leftEdge[0].y * T);
    for (let i = 1; i < leftEdge.length; i++) {
      ctx.lineTo(leftEdge[i].x * T, leftEdge[i].y * T);
    }
    ctx.lineTo(rightEdge[rightEdge.length - 1].x * T, rightEdge[rightEdge.length - 1].y * T);
    for (let i = rightEdge.length - 2; i >= 0; i--) {
      ctx.lineTo(rightEdge[i].x * T, rightEdge[i].y * T);
    }
    ctx.closePath();
    ctx.stroke();
  }

  private fillZoneRows(
    ctx: CanvasRenderingContext2D,
    leftEdge: { x: number; y: number }[],
    rightEdge: { x: number; y: number }[],
    startRow: number, endRow: number, color: string
  ): void {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(leftEdge[startRow].x * T, leftEdge[startRow].y * T);
    for (let y = startRow + 1; y <= endRow; y++) {
      ctx.lineTo(leftEdge[y].x * T, leftEdge[y].y * T);
    }
    ctx.lineTo(rightEdge[endRow].x * T, rightEdge[endRow].y * T);
    for (let y = endRow - 1; y >= startRow; y--) {
      ctx.lineTo(rightEdge[y].x * T, rightEdge[y].y * T);
    }
    ctx.closePath();
    ctx.fill();
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
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.2;
      ctx.stroke();

      ctx.setLineDash([8, 12]);
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.35;
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

    drawPath(LANE_PATHS.bottom.left, LANE_LEFT_COLOR);
    drawPath(LANE_PATHS.bottom.right, LANE_RIGHT_COLOR);

    ctx.font = 'bold 12px monospace';
    ctx.globalAlpha = 0.4;
    ctx.textAlign = 'center';
    ctx.fillStyle = LANE_LEFT_COLOR;
    ctx.fillText('L', 20 * T, DIAMOND_CENTER_Y * T);
    ctx.fillStyle = LANE_RIGHT_COLOR;
    ctx.fillText('R', 60 * T, DIAMOND_CENTER_Y * T);
    ctx.textAlign = 'start';
    ctx.globalAlpha = 1;
  }

  // === Diamond Gold Cells ===

  private drawDiamondCells(ctx: CanvasRenderingContext2D, state: GameState): void {
    for (const cell of state.diamondCells) {
      const px = cell.tileX * T;
      const py = cell.tileY * T;

      if (cell.gold > 0) {
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

        if (pct > 0.8 && (cell.tileX + cell.tileY) % 3 === 0) {
          ctx.fillStyle = 'rgba(255, 255, 200, 0.4)';
          ctx.fillRect(px + T / 2 - 1, py + T / 2 - 1, 2, 2);
        }
      } else {
        ctx.fillStyle = 'rgba(15, 12, 8, 0.6)';
        ctx.fillRect(px, py, T, T);
        ctx.fillStyle = 'rgba(100, 80, 20, 0.15)';
        ctx.fillRect(px + 3, py + 5, 2, 2);
        ctx.fillRect(px + 9, py + 10, 2, 2);
      }
    }

    const cx = DIAMOND_CENTER_X * T;
    const cy = DIAMOND_CENTER_Y * T;
    if (!state.diamond.exposed) {
      ctx.fillStyle = 'rgba(40, 35, 10, 0.8)';
      ctx.fillRect(cx, cy, T, T);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx, cy, T, T);
    }
  }

  // === Resource Nodes ===

  private drawResourceNodes(ctx: CanvasRenderingContext2D): void {
    const drawNode = (x: number, y: number, label: string, color: string) => {
      const px = x * T, py = y * T;
      ctx.beginPath();
      ctx.arc(px, py, T * 1.2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = color.replace('0.2', '0.5');
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#bbb';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(label, px, py + 4);
      ctx.textAlign = 'start';
    };

    drawNode(WOOD_NODE_X, DIAMOND_CENTER_Y, 'WOOD', 'rgba(76, 175, 80, 0.2)');
    drawNode(STONE_NODE_X, DIAMOND_CENTER_Y, 'STONE', 'rgba(158, 158, 158, 0.2)');

    const bHQ = getHQPosition(Team.Bottom);
    const tHQ = getHQPosition(Team.Top);
    drawNode(bHQ.x + HQ_WIDTH / 2, bHQ.y - 6, 'GOLD', 'rgba(255, 215, 0, 0.2)');
    drawNode(tHQ.x + HQ_WIDTH / 2, tHQ.y + HQ_HEIGHT + 6, 'GOLD', 'rgba(255, 215, 0, 0.2)');
  }

  // === Build Grids ===

  private drawBuildGrids(ctx: CanvasRenderingContext2D, state: GameState): void {
    for (let p = 0; p < 4; p++) {
      const origin = getBuildGridOrigin(p);
      const player = state.players[p];
      if (!player) continue;

      const pc = PLAYER_COLORS[p];
      const tc = hexToRgba(pc);

      ctx.fillStyle = tc + '0.08)';
      ctx.fillRect(origin.x * T, origin.y * T, BUILD_GRID_COLS * T, BUILD_GRID_ROWS * T);

      ctx.strokeStyle = tc + '0.2)';
      ctx.lineWidth = 0.5;
      for (let gx = 0; gx <= BUILD_GRID_COLS; gx++) {
        ctx.beginPath();
        ctx.moveTo((origin.x + gx) * T, origin.y * T);
        ctx.lineTo((origin.x + gx) * T, (origin.y + BUILD_GRID_ROWS) * T);
        ctx.stroke();
      }
      for (let gy = 0; gy <= BUILD_GRID_ROWS; gy++) {
        ctx.beginPath();
        ctx.moveTo(origin.x * T, (origin.y + gy) * T);
        ctx.lineTo((origin.x + BUILD_GRID_COLS) * T, (origin.y + gy) * T);
        ctx.stroke();
      }

      ctx.strokeStyle = tc + '0.35)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(origin.x * T, origin.y * T, BUILD_GRID_COLS * T, BUILD_GRID_ROWS * T);

      ctx.fillStyle = tc + '0.7)';
      ctx.font = 'bold 11px monospace';
      const ly = p < 2 ? (origin.y + BUILD_GRID_ROWS + 1.2) * T : (origin.y - 0.5) * T;
      ctx.fillText(`P${p + 1} [${player.race}]`, origin.x * T, ly);
    }
  }

  // === Hut Zones ===

  private drawHutZones(ctx: CanvasRenderingContext2D, state: GameState): void {
    for (let p = 0; p < 4; p++) {
      const player = state.players[p];
      if (!player) continue;
      const origin = getHutGridOrigin(p);
      const pc = PLAYER_COLORS[p];
      const tc = hexToRgba(pc);

      ctx.fillStyle = tc + '0.06)';
      ctx.fillRect(origin.x * T, origin.y * T, HUT_GRID_COLS * T, T);
      ctx.strokeStyle = tc + '0.3)';
      ctx.lineWidth = 1;
      for (let gx = 0; gx <= HUT_GRID_COLS; gx++) {
        ctx.beginPath();
        ctx.moveTo((origin.x + gx) * T, origin.y * T);
        ctx.lineTo((origin.x + gx) * T, (origin.y + 1) * T);
        ctx.stroke();
      }
      ctx.strokeStyle = tc + '0.4)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(origin.x * T, origin.y * T, HUT_GRID_COLS * T, T);

      ctx.fillStyle = tc + '0.5)';
      ctx.font = 'bold 9px monospace';
      const ly = p < 2 ? (origin.y + 1.8) * T : (origin.y - 0.4) * T;
      ctx.fillText(`P${p + 1} HUTS`, origin.x * T, ly);
    }
  }

  // === Tower Alleys ===

  private drawTowerAlleys(ctx: CanvasRenderingContext2D, _state: GameState): void {
    for (const team of [Team.Bottom, Team.Top]) {
      const origin = getTeamAlleyOrigin(team);
      const color = team === Team.Bottom ? '41,121,255' : '255,23,68';

      ctx.fillStyle = `rgba(${color},0.06)`;
      ctx.fillRect(origin.x * T, origin.y * T, SHARED_ALLEY_COLS * T, SHARED_ALLEY_ROWS * T);

      ctx.strokeStyle = `rgba(${color},0.22)`;
      ctx.lineWidth = 0.5;
      for (let gx = 0; gx <= SHARED_ALLEY_COLS; gx++) {
        ctx.beginPath();
        ctx.moveTo((origin.x + gx) * T, origin.y * T);
        ctx.lineTo((origin.x + gx) * T, (origin.y + SHARED_ALLEY_ROWS) * T);
        ctx.stroke();
      }
      for (let gy = 0; gy <= SHARED_ALLEY_ROWS; gy++) {
        ctx.beginPath();
        ctx.moveTo(origin.x * T, (origin.y + gy) * T);
        ctx.lineTo((origin.x + SHARED_ALLEY_COLS) * T, (origin.y + gy) * T);
        ctx.stroke();
      }

      ctx.strokeStyle = `rgba(${color},0.45)`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(origin.x * T, origin.y * T, SHARED_ALLEY_COLS * T, SHARED_ALLEY_ROWS * T);

      ctx.fillStyle = `rgba(${color},0.55)`;
      ctx.font = 'bold 9px monospace';
      const isBottom = team === Team.Bottom;
      const ly = isBottom ? (origin.y + SHARED_ALLEY_ROWS + 1.2) * T : (origin.y - 0.4) * T;
      ctx.fillText('TOWER ALLEY', origin.x * T, ly);
    }
  }

  // === HQs ===

  private drawHQs(ctx: CanvasRenderingContext2D, state: GameState): void {
    for (const team of [Team.Bottom, Team.Top]) {
      const pos = getHQPosition(team);
      const hp = state.hqHp[team];
      const color = team === Team.Bottom ? '#2979ff' : '#ff1744';
      const bg = team === Team.Bottom ? 'rgba(41, 121, 255, 0.15)' : 'rgba(255, 23, 68, 0.15)';

      const px = pos.x * T, py = pos.y * T;
      const w = HQ_WIDTH * T, h = HQ_HEIGHT * T;

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
      ctx.fillText(`${hp}`, cx, barY + barH + 10);
      ctx.textAlign = 'start';
    }
  }

  // === Buildings ===

  private drawBuildings(ctx: CanvasRenderingContext2D, state: GameState): void {
    for (const b of state.buildings) {
      const player = state.players[b.playerId];
      const rc = RACE_COLORS[player.race];
      const playerColor = PLAYER_COLORS[b.playerId] || '#888';
      const px = b.worldX * T + T / 2;
      const py = b.worldY * T + T / 2;
      const half = T / 2 - 2;

      const upgradeTier = b.upgradePath.length - 1; // 0=base, 1=tier1, 2=tier2
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
          // Tower range indicator (subtle) — reflects upgrades
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
          // Show assignment icon
          const harv = state.harvesters.find(h => h.hutId === b.id);
          if (harv) {
            const icons: Record<string, string> = { base_gold: '★', wood: '♣', stone: '▪', center: '◆' };
            const colors: Record<string, string> = { base_gold: '#ffd700', wood: '#4caf50', stone: '#9e9e9e', center: '#fff' };
            ctx.fillStyle = colors[harv.assignment] || '#ffd700';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(icons[harv.assignment] || '?', px, py + 3);
            ctx.textAlign = 'start';
          }
          break;
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
          // Single pip centered
          ctx.beginPath(); ctx.arc(px, py + half + 2, 1.5, 0, Math.PI * 2); ctx.fill();
        } else {
          // Two pips side by side
          ctx.beginPath(); ctx.arc(px - 3, py + half + 2, 1.5, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(px + 3, py + half + 2, 1.5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;

        // Tier 2: brighter border highlight
        if (upgradeTier >= 2) {
          ctx.strokeStyle = rc.primary;
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = 1;
          ctx.strokeRect(px - half - 1, py - half - 1, (half + 1) * 2, (half + 1) * 2);
          ctx.globalAlpha = 1;
        }
      }

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

  private drawProjectiles(ctx: CanvasRenderingContext2D, state: GameState): void {
    for (const p of state.projectiles) {
      const px = p.x * T, py = p.y * T;

      // Glowing dot
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fillStyle = p.team === Team.Bottom ? '#4fc3f7' : '#ff8a65';
      ctx.fill();

      // Trail
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fillStyle = p.team === Team.Bottom ? 'rgba(79, 195, 247, 0.3)' : 'rgba(255, 138, 101, 0.3)';
      ctx.fill();
    }
  }

  // === Units ===

  private drawUnits(ctx: CanvasRenderingContext2D, state: GameState): void {
    for (const u of state.units) {
      const playerColor = PLAYER_COLORS[u.playerId] || '#888';
      const px = u.x * T, py = u.y * T;
      const laneColor = u.lane === Lane.Left ? LANE_LEFT_COLOR : LANE_RIGHT_COLOR;
      const r = u.range > 2 ? 3 : 4;

      // Shape by race + unit category
      const race = state.players[u.playerId]?.race;
      this.drawUnitShape(ctx, px, py, r, race, u.category, u.team, playerColor);
      // Lane color center dot
      ctx.beginPath(); ctx.arc(px, py, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = laneColor; ctx.fill();

      // Status effect visuals
      const hasSlow = u.statusEffects.find(e => e.type === StatusType.Slow);
      const hasBurn = u.statusEffects.find(e => e.type === StatusType.Burn);
      const isSeared = hasSlow && hasBurn; // combo: slow + burn
      const isBlighted = hasBurn && hasBurn.stacks >= 3; // high burn = regen disabled

      for (const eff of u.statusEffects) {
        if (eff.type === StatusType.Slow) {
          ctx.beginPath(); ctx.arc(px, py, r + 2, 0, Math.PI * 2);
          ctx.strokeStyle = isSeared
            ? `rgba(255, 140, 0, ${0.5 + 0.1 * eff.stacks})` // orange for seared combo
            : `rgba(41, 121, 255, ${0.3 + 0.1 * eff.stacks})`;
          ctx.lineWidth = isSeared ? 2 : 1; ctx.stroke();
        }
        if (eff.type === StatusType.Burn) {
          ctx.beginPath(); ctx.arc(px, py, r + 2, 0, Math.PI * 2);
          ctx.strokeStyle = isBlighted
            ? `rgba(100, 0, 100, ${0.5 + 0.1 * eff.stacks})` // dark purple for blight
            : `rgba(255, 87, 34, ${0.3 + 0.1 * eff.stacks})`;
          ctx.lineWidth = isBlighted ? 2 : 1; ctx.stroke();
        }
        if (eff.type === StatusType.Haste) {
          ctx.beginPath(); ctx.arc(px, py, r + 3, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(0, 229, 255, 0.5)';
          ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.stroke(); ctx.setLineDash([]);
        }
        if (eff.type === StatusType.Shield) {
          ctx.beginPath(); ctx.arc(px, py, r + 3, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(100, 181, 246, 0.7)';
          ctx.lineWidth = 2; ctx.stroke();
        }
      }

      // Seared combo indicator: pulsing orange-blue double ring
      if (isSeared) {
        const pulse = 0.5 + 0.3 * Math.sin(Date.now() / 150);
        ctx.beginPath(); ctx.arc(px, py, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 100, 0, ${pulse})`;
        ctx.lineWidth = 1; ctx.setLineDash([2, 2]); ctx.stroke(); ctx.setLineDash([]);
      }

      // Blight indicator: skull-like X mark
      if (isBlighted) {
        ctx.strokeStyle = 'rgba(180, 0, 180, 0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px - 2, py - r - 5); ctx.lineTo(px + 2, py - r - 1);
        ctx.moveTo(px + 2, py - r - 5); ctx.lineTo(px - 2, py - r - 1);
        ctx.stroke();
      }

      // HP bar (only if damaged)
      if (u.hp < u.maxHp) {
        const barW = 10, barH = 2;
        const barX = px - barW / 2, barY = py - r - 4;
        const pct = u.hp / u.maxHp;
        ctx.fillStyle = '#111';
        ctx.fillRect(barX, barY, barW, barH);
        ctx.fillStyle = pct > 0.5 ? '#4caf50' : pct > 0.25 ? '#ff9800' : '#f44336';
        ctx.fillRect(barX, barY, barW * pct, barH);
      }

      // Shield bar (below HP bar)
      if (u.shieldHp > 0) {
        const barW = 10, barH = 1.5;
        const barX = px - barW / 2, barY = py - r - 1;
        ctx.fillStyle = 'rgba(100, 181, 246, 0.7)';
        ctx.fillRect(barX, barY, barW * (u.shieldHp / 20), barH);
      }

      if (u.carryingDiamond) {
        ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      }

      // Attack flash
      if (u.attackTimer > 0 && u.attackTimer > Math.round(u.attackSpeed * 20) - 3) {
        ctx.beginPath(); ctx.arc(px, py, r + 3, 0, Math.PI * 2);
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
      // ─── SURGE: angular, electric ───
      case Race.Surge:
        if (category === 'melee') {
          // Lightning bolt zigzag
          ctx.beginPath();
          ctx.moveTo(px - 1, py - r);
          ctx.lineTo(px + r * 0.5, py - r * 0.3);
          ctx.lineTo(px - r * 0.2, py + r * 0.1);
          ctx.lineTo(px + r * 0.3, py + r);
          ctx.lineTo(px - r * 0.3, py + r * 0.3);
          ctx.lineTo(px + r * 0.2, py - r * 0.1);
          ctx.lineTo(px - r * 0.5, py - r * 0.3);
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
          // 4-pointed star/spark
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

      // ─── TIDE: rounded, organic ───
      case Race.Tide:
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

      // ─── EMBER: sharp, aggressive ───
      case Race.Ember:
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
          // Narrow kite
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

      // ─── BASTION: heavy, geometric ───
      case Race.Bastion:
        if (category === 'melee') {
          // Cross/plus
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

      // ─── SHADE: wispy, sinister ───
      case Race.Shade:
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
          // Inner dot
          ctx.beginPath();
          ctx.arc(px, py, r * 0.2, 0, Math.PI * 2);
          ctx.fill();
        }
        break;

      // ─── THORN: organic, spiky ───
      case Race.Thorn:
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

  private drawHarvesters(ctx: CanvasRenderingContext2D, state: GameState): void {
    for (const h of state.harvesters) {
      if (h.state === 'dead') continue;
      const px = h.x * T, py = h.y * T;

      let color = PLAYER_COLORS[h.playerId] || (h.team === Team.Bottom ? '#64b5f6' : '#ef9a9a');
      if (h.state === 'fighting') color = '#ff5722';

      ctx.beginPath();
      ctx.moveTo(px, py - 4); ctx.lineTo(px + 4, py + 4); ctx.lineTo(px - 4, py + 4);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();

      if (h.state === 'mining') {
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.stroke();
      }

      if (h.carryingResource || h.carryingDiamond) {
        ctx.fillStyle = h.carryingDiamond ? '#fff' : '#ffd700';
        ctx.beginPath(); ctx.arc(px, py - 6, 2.5, 0, Math.PI * 2); ctx.fill();
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

      ctx.fillStyle = '#ffe082';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('MINE CENTER TO EXPOSE DIAMOND', px, py - r - 10);
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
    const localTeam = state.players[0]?.team ?? Team.Bottom;
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
      const alpha = 1 - p.age / p.maxAge;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x * T - p.size / 2, p.y * T - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  private drawFloatingTexts(ctx: CanvasRenderingContext2D, state: GameState): void {
    for (const ft of state.floatingTexts) {
      const alpha = 1 - ft.age / ft.maxAge;
      const yOff = -(ft.age / ft.maxAge) * 20; // float upward
      ctx.globalAlpha = alpha;
      ctx.fillStyle = ft.color;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
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

      if (progress < 0.3) {
        // Expanding flash
        const expandPct = progress / 0.3;
        ctx.beginPath();
        ctx.arc(px, py, r * expandPct, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 100, 0, ${0.8 * (1 - expandPct)})`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(px, py, r * expandPct * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 200, ${0.9 * (1 - expandPct)})`;
        ctx.fill();
      }

      // Fading ring
      const ringAlpha = Math.max(0, 1 - progress);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 80, 0, ${ringAlpha * 0.5})`;
      ctx.lineWidth = 3;
      ctx.stroke();

      // Scorched ground
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(50, 20, 0, ${ringAlpha * 0.3})`;
      ctx.fill();
    }
  }

  // === HUD ===

  private drawHUD(ctx: CanvasRenderingContext2D, state: GameState): void {
    const player = state.players[0];
    if (!player) return;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(0, 0, this.canvas.width, 56);

    ctx.font = 'bold 14px monospace';
    let x = 12;
    const y = 30;

    const ps = state.playerStats?.[0];
    const elapsed = Math.max(1, state.tick / 20); // seconds since match start
    const goldRate = ps ? (ps.totalGoldEarned / elapsed).toFixed(1) : '?';
    const woodRate = ps ? (ps.totalWoodEarned / elapsed).toFixed(1) : '?';
    const stoneRate = ps ? (ps.totalStoneEarned / elapsed).toFixed(1) : '?';
    ctx.fillStyle = '#ffd700'; ctx.fillText(`Gold: ${player.gold} (+${goldRate}/s)`, x, y); x += 160;
    ctx.fillStyle = '#4caf50'; ctx.fillText(`Wood: ${player.wood} (+${woodRate}/s)`, x, y); x += 150;
    ctx.fillStyle = '#9e9e9e'; ctx.fillText(`Stone: ${player.stone} (+${stoneRate}/s)`, x, y); x += 150;
    ctx.fillStyle = player.nukeAvailable ? '#ff5722' : '#555';
    ctx.fillText(`Nuke: ${player.nukeAvailable ? 'READY [N]' : 'USED'}`, x, y); x += 160;

    ctx.fillStyle = '#888';
    const secs = Math.floor(state.tick / 20);
    ctx.fillText(`${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`, x, y);
    x += 80;

    const goldRemaining = state.diamondCells.reduce((s, c) => s + c.gold, 0);
    const totalGold = state.diamondCells.reduce((s, c) => s + c.maxGold, 0);
    const minedPct = Math.round((1 - goldRemaining / totalGold) * 100);
    ctx.fillStyle = state.diamond.exposed ? '#fff' : '#aa8800';
    ctx.fillText(state.diamond.exposed ? 'DIAMOND EXPOSED!' : `CENTER: MINE ${minedPct}%`, x, y);
    x += 160;

    // Unit counts
    const myUnits = state.units.filter(u => u.team === player.team).length;
    const enemyUnits = state.units.filter(u => u.team !== player.team).length;
    ctx.fillStyle = '#4fc3f7';
    ctx.fillText(`Units: ${myUnits}`, x, y);
    x += 80;
    ctx.fillStyle = '#ff8a65';
    ctx.fillText(`vs ${enemyUnits}`, x, y);

    // === Second HUD row: HQ health + building count ===
    const y2 = 48;
    let x2 = 12;
    ctx.font = 'bold 11px monospace';

    // HQ health bars
    const btmHp = state.hqHp[Team.Bottom];
    const topHp = state.hqHp[Team.Top];
    const hqBarW = 60;
    const hqBarH = 6;
    const drawHQBar = (label: string, hp: number, color: string, xPos: number) => {
      ctx.fillStyle = '#999';
      ctx.fillText(label, xPos, y2);
      const barX = xPos + ctx.measureText(label).width + 4;
      ctx.fillStyle = '#222';
      ctx.fillRect(barX, y2 - hqBarH, hqBarW, hqBarH);
      const pct = Math.max(0, hp / HQ_HP);
      ctx.fillStyle = pct > 0.5 ? color : pct > 0.25 ? '#ff9800' : '#f44336';
      ctx.fillRect(barX, y2 - hqBarH, hqBarW * pct, hqBarH);
      ctx.fillStyle = '#ccc';
      ctx.font = '9px monospace';
      ctx.fillText(`${hp}`, barX + hqBarW + 4, y2);
      ctx.font = 'bold 11px monospace';
      return barX + hqBarW + ctx.measureText(`${hp}`).width + 14;
    };
    x2 = drawHQBar('BTM', btmHp, '#2979ff', x2);
    x2 = drawHQBar('TOP', topHp, '#ff1744', x2);

    // Building count
    const myBuildings = state.buildings.filter(b => b.playerId === 0).length;
    const maxBuildings = BUILD_GRID_COLS * BUILD_GRID_ROWS;
    ctx.fillStyle = '#aaa';
    ctx.fillText(`Bldgs: ${myBuildings}/${maxBuildings}`, x2, y2);

    // Prematch
    if (state.matchPhase === 'prematch') {
      ctx.fillStyle = '#fff'; ctx.font = 'bold 32px monospace'; ctx.textAlign = 'center';
      ctx.fillText(`Match starts in ${Math.ceil(state.prematchTimer / 20)}`, this.canvas.width / 2, this.canvas.height / 2);
      ctx.textAlign = 'start';
    }

    // Win
    if (state.matchPhase === 'ended' && state.winner !== null) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(0, this.canvas.height / 2 - 40, this.canvas.width, 80);
      ctx.fillStyle = state.winner === Team.Bottom ? '#2979ff' : '#ff1744';
      ctx.font = 'bold 36px monospace'; ctx.textAlign = 'center';
      ctx.fillText(`${state.winner === Team.Bottom ? 'BOTTOM' : 'TOP'} TEAM WINS! (${state.winCondition})`,
        this.canvas.width / 2, this.canvas.height / 2 + 12);
      ctx.textAlign = 'start';
    }

  }

  private drawQuickChats(ctx: CanvasRenderingContext2D, state: GameState): void {
    if (state.quickChats.length === 0) return;
    const localTeam = state.players[0]?.team ?? Team.Bottom;
    const visibleChats = state.quickChats.filter(c => c.team === localTeam);
    if (visibleChats.length === 0) return;
    const startX = 12;
    const startY = 62;
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

  private drawMinimap(ctx: CanvasRenderingContext2D, state: GameState): void {
    const mmW = 120, mmH = 180;
    const mx = this.canvas.width - mmW - 10;
    const my = 60; // top-right, just below HUD bar
    const scaleX = mmW / MAP_WIDTH;
    const scaleY = mmH / MAP_HEIGHT;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(mx - 2, my - 2, mmW + 4, mmH + 4);

    // Map shape outline
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = 0; y <= MAP_HEIGHT; y += 4) {
      const m = getMarginAtRow(y);
      if (y === 0) ctx.moveTo(mx + m * scaleX, my + y * scaleY);
      else ctx.lineTo(mx + m * scaleX, my + y * scaleY);
    }
    for (let y = MAP_HEIGHT; y >= 0; y -= 4) {
      const m = getMarginAtRow(y);
      ctx.lineTo(mx + (MAP_WIDTH - m) * scaleX, my + y * scaleY);
    }
    ctx.closePath();
    ctx.fillStyle = '#111';
    ctx.fill();
    ctx.stroke();

    // Diamond cells (gold blob)
    const goldRemaining = state.diamondCells.some(c => c.gold > 0);
    if (goldRemaining) {
      ctx.fillStyle = 'rgba(200, 170, 20, 0.6)';
      const cx = mx + DIAMOND_CENTER_X * scaleX;
      const cy = my + DIAMOND_CENTER_Y * scaleY;
      const rw = 10 * scaleX;
      const rh = 12 * scaleY;
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

    // Units as dots (player colored)
    for (const u of state.units) {
      ctx.fillStyle = PLAYER_COLORS[u.playerId] || '#888';
      ctx.fillRect(mx + u.x * scaleX - 1, my + u.y * scaleY - 1, 2, 2);
    }

    // Team-visible ping markers
    const localTeam = state.players[0]?.team ?? Team.Bottom;
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
      const hq = getHQPosition(team);
      ctx.fillStyle = team === Team.Bottom ? '#2979ff' : '#ff1744';
      ctx.fillRect(mx + hq.x * scaleX, my + hq.y * scaleY, HQ_WIDTH * scaleX, HQ_HEIGHT * scaleY);
    }

    // Recent quick-chat badges near team HQ
    const recentChats = state.quickChats.filter(c => c.team === localTeam && c.age < 20);
    for (const c of recentChats) {
      const hq = getHQPosition(c.team);
      const bx = mx + (hq.x + HQ_WIDTH / 2 + (c.playerId % 2 === 0 ? -4 : 4)) * scaleX;
      const by = my + (hq.y + HQ_HEIGHT / 2) * scaleY;
      const style = quickChatStyle(c.message);
      ctx.fillStyle = style.color;
      ctx.beginPath();
      ctx.arc(bx, by, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Camera viewport box
    const vx = this.camera.x, vy = this.camera.y;
    const vw = this.canvas.width / this.camera.zoom;
    const vh = this.canvas.height / this.camera.zoom;
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
