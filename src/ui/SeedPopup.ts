import { Camera } from '../rendering/Camera';
import { UIAssets } from '../rendering/UIAssets';
import { GameState, TILE_SIZE, TICK_RATE, Race } from '../simulation/types';
import { SEED_GROW_TIMES } from '../simulation/GameState';
import { getPopupSafeY } from './SafeArea';

export type SeedPopupAction =
  | { action: 'upgrade'; buildingId: number; gridX: number; gridY: number }
  | { action: 'close' };

const MIN_TAP = 44;

const TIER_LABELS = ['Seedling', 'Sapling', 'Ancient'];
const TIER_COLORS = ['#81c784', '#ffd740', '#ff8a65'];

export class SeedPopup {
  private targetBuildingId: number | null = null;
  private rect = { x: 0, y: 0, w: 0, h: 0 };
  private upgradeBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  private closeBtnRect = { x: 0, y: 0, w: 0, h: 0 };

  open(buildingId: number): void {
    this.targetBuildingId = buildingId;
  }

  close(): void {
    this.targetBuildingId = null;
  }

  isOpen(): boolean {
    return this.targetBuildingId !== null;
  }

  getBuildingId(): number | null {
    return this.targetBuildingId;
  }

  containsPoint(cx: number, cy: number): boolean {
    const r = this.rect;
    return cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h;
  }

  handleClickWithState(cx: number, cy: number, state: GameState, playerId: number): SeedPopupAction | null {
    if (!this.containsPoint(cx, cy)) return null;
    if (this.hitTest(cx, cy, this.closeBtnRect)) return { action: 'close' };

    if (this.targetBuildingId !== null && this.upgradeBtnRect.w > 0 && this.hitTest(cx, cy, this.upgradeBtnRect)) {
      const building = state.buildings.find(b => b.id === this.targetBuildingId);
      if (building && building.isSeed) {
        const tier = building.seedTier ?? 0;
        const player = state.players[playerId];
        if (tier < 2 && player && player.race === Race.Tenders && player.abilityStacks > 0) {
          return { action: 'upgrade', buildingId: building.id, gridX: building.gridX, gridY: building.gridY };
        }
      }
    }

    return null; // clicked inside popup, consume event
  }

  private hitTest(cx: number, cy: number, r: { x: number; y: number; w: number; h: number }): boolean {
    const pad = 6;
    return r.w > 0 && cx >= r.x - pad && cx < r.x + r.w + pad && cy >= r.y - pad && cy < r.y + r.h + pad;
  }

  draw(
    ctx: CanvasRenderingContext2D, camera: Camera, state: GameState,
    ui: UIAssets, canvasW: number, canvasH: number, playerId: number,
  ): void {
    if (this.targetBuildingId === null) return;

    const building = state.buildings.find(b => b.id === this.targetBuildingId);
    if (!building || !building.isSeed) { this.close(); return; }

    const player = state.players[playerId];
    if (!player) return;

    const tier = building.seedTier ?? 0;
    const seedTimer = building.seedTimer ?? 0;
    const maxTime = SEED_GROW_TIMES[tier];
    const elapsed = maxTime - seedTimer;
    const pct = Math.min(1, elapsed / maxTime);
    const secsLeft = Math.ceil(seedTimer / TICK_RATE);
    const canUpgrade = tier < 2 && player.race === Race.Tenders && player.abilityStacks > 0;

    // --- Responsive sizing ---
    const isMobile = canvasW < 600;
    const PAD = isMobile ? 8 : 14;
    const POPUP_W = isMobile ? Math.min(canvasW - 8, 280) : 280;
    const HEADER_H = isMobile ? 30 : 36;
    const PROGRESS_H = 36;
    const UPGRADE_BTN_H = canUpgrade ? (isMobile ? MIN_TAP : MIN_TAP + 4) : 0;
    const UPGRADE_GAP = canUpgrade ? 8 : 0;

    const popupH = HEADER_H + PAD + PROGRESS_H + UPGRADE_GAP + UPGRADE_BTN_H + PAD * 2;
    const popupW = POPUP_W;

    // Position above building
    const worldPx = building.worldX * TILE_SIZE + TILE_SIZE / 2;
    const worldPy = building.worldY * TILE_SIZE;
    const screen = camera.worldToScreen(worldPx, worldPy);
    let px = Math.round(screen.x - popupW / 2);
    let py = Math.round(screen.y - popupH - 20);

    const safeY = getPopupSafeY(canvasW, canvasH);
    px = Math.max(4, Math.min(canvasW - popupW - 4, px));
    py = Math.max(safeY.top, Math.min(safeY.bottom - popupH, py));

    this.rect = { x: px, y: py, w: popupW, h: popupH };
    this.upgradeBtnRect = { x: 0, y: 0, w: 0, h: 0 };

    ctx.save();
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);

    // Background panel
    const bgPadX = Math.round(popupW * (isMobile ? 0.08 : 0.15));
    const bgPadY = Math.round(popupH * (isMobile ? 0.06 : 0.10));
    if (!ui.drawWoodTable(ctx, px - bgPadX, py - bgPadY, popupW + bgPadX * 2, popupH + bgPadY * 2)) {
      ctx.fillStyle = 'rgba(30,20,10,0.92)';
      ctx.fillRect(px - bgPadX, py - bgPadY, popupW + bgPadX * 2, popupH + bgPadY * 2);
      ctx.strokeStyle = '#8d6e63';
      ctx.lineWidth = 2;
      ctx.strokeRect(px - bgPadX, py - bgPadY, popupW + bgPadX * 2, popupH + bgPadY * 2);
    }

    let curY = py + PAD;

    // Header ribbon
    const ribbonH = 28;
    const ribbonW = popupW - PAD * 2;
    ui.drawSmallRibbon(ctx, px + PAD, curY, ribbonW, ribbonH, 0);
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px monospace';
    ctx.fillStyle = TIER_COLORS[tier];
    const tierNum = tier + 1;
    ctx.fillText(`${TIER_LABELS[tier]} (T${tierNum})`, px + popupW / 2, curY + ribbonH / 2 + 4);

    // Close button
    const closeSize = Math.max(MIN_TAP, 32);
    const closeBtnX = px + popupW - closeSize - 2;
    const closeBtnY = py + 2;
    this.closeBtnRect = { x: closeBtnX, y: closeBtnY, w: closeSize, h: closeSize };
    ui.drawSmallRedRoundButton(ctx, closeBtnX, closeBtnY, closeSize);
    ui.drawIcon(ctx, 'close', closeBtnX + closeSize / 2 - 10, closeBtnY + closeSize / 2 - 10, 20);

    curY += HEADER_H;

    // --- Progress bar section ---
    const barX = px + PAD;
    const barW = popupW - PAD * 2;
    const barH = 14;
    const barY = curY + 4;

    // Background
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, 4);
    ctx.fill();

    // Fill
    ctx.fillStyle = TIER_COLORS[tier];
    if (pct > 0) {
      ctx.beginPath();
      ctx.roundRect(barX, barY, barW * pct, barH, 4);
      ctx.fill();
    }

    // Border
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, 4);
    ctx.stroke();

    // Progress text
    ctx.textAlign = 'center';
    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = '#fff';
    const pctText = pct >= 1 ? 'READY' : `${Math.floor(pct * 100)}% — ${secsLeft}s left`;
    ctx.fillText(pctText, px + popupW / 2, barY + barH - 3);

    // Tier grow time label
    curY = barY + barH + 4;
    ctx.font = '10px monospace';
    ctx.fillStyle = '#aaa';
    const totalSecs = Math.round(maxTime / TICK_RATE);
    ctx.fillText(`Grow time: ${totalSecs}s`, px + popupW / 2, curY + 10);

    curY += 16;

    // --- Upgrade button ---
    if (canUpgrade) {
      const btnX = px + PAD;
      const btnY = curY;
      const btnW = popupW - PAD * 2;
      this.upgradeBtnRect = { x: btnX, y: btnY, w: btnW, h: UPGRADE_BTN_H };

      ui.drawBigBlueButton(ctx, btnX - 4, btnY - 4, btnW + 8, UPGRADE_BTN_H + 8);

      // Show what upgrading costs and what it does
      const nextTier = tier + 1;
      const nextGrowSecs = Math.round(SEED_GROW_TIMES[nextTier] / TICK_RATE);
      // Calculate what the new timer would be (elapsed carries over)
      const newTimer = Math.max(0, SEED_GROW_TIMES[nextTier] - elapsed);
      const newSecsLeft = Math.ceil(newTimer / TICK_RATE);

      ctx.textAlign = 'center';
      ctx.font = `bold ${isMobile ? 11 : 12}px monospace`;
      ctx.fillStyle = TIER_COLORS[nextTier];
      ctx.fillText(`Upgrade to ${TIER_LABELS[nextTier]} (T${nextTier + 1})`, px + popupW / 2, btnY + UPGRADE_BTN_H / 2 - 6);

      ctx.font = `${isMobile ? 9 : 10}px monospace`;
      ctx.fillStyle = '#ccc';
      ctx.fillText(`1 seed charge — ${nextGrowSecs}s grow (${newSecsLeft}s left)`, px + popupW / 2, btnY + UPGRADE_BTN_H / 2 + 8);

      // Stack count indicator
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = '#81c784';
      ctx.textAlign = 'right';
      ctx.fillText(`${player.abilityStacks} seeds`, px + popupW - PAD, btnY + UPGRADE_BTN_H / 2 + 22);
    } else if (tier >= 2) {
      // Max tier label
      ctx.textAlign = 'center';
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#ff8a65';
      ctx.fillText('Max Tier', px + popupW / 2, curY + 14);
    }

    // Pointer triangle from popup to building
    if (screen.y > py + popupH - 4) {
      const triX = Math.max(px + 12, Math.min(px + popupW - 12, screen.x));
      const triY = py + popupH;
      const tipY = Math.min(triY + 16, screen.y);
      ctx.fillStyle = 'rgba(60,40,20,0.85)';
      ctx.beginPath();
      ctx.moveTo(triX - 10, triY);
      ctx.lineTo(triX + 10, triY);
      ctx.lineTo(screen.x, tipY);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }
}
