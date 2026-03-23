import { Camera } from '../rendering/Camera';
import { UIAssets } from '../rendering/UIAssets';
import { GameState, HarvesterAssignment, Race, TILE_SIZE } from '../simulation/types';
import { getRaceUsedResources } from '../simulation/data';
import { getPopupSafeY } from './SafeArea';

export type HutPopupAction =
  | { action: 'assign'; assignment: HarvesterAssignment }
  | { action: 'center_builder' }
  | { action: 'close' };

// Minimum touch target (Apple HIG = 44px)
const MIN_TAP = 44;

interface AssignmentDef {
  assignment: HarvesterAssignment;
  label: string;
  desc: string;
  icon: 'gold' | 'wood' | 'meat' | 'diamond' | null;
  color: string;
}

const ASSIGNMENT_DEFS: AssignmentDef[] = [
  {
    assignment: HarvesterAssignment.BaseGold,
    label: 'Gold',
    desc: 'Mine gold from your base deposit.',
    icon: 'gold',
    color: '#ffd740',
  },
  {
    assignment: HarvesterAssignment.Wood,
    label: 'Wood',
    desc: 'Chop wood from nearby trees.',
    icon: 'wood',
    color: '#81c784',
  },
  {
    assignment: HarvesterAssignment.Stone,
    label: 'Meat',
    desc: 'Butcher creatures for meat.',
    icon: 'meat',
    color: '#e57373',
  },
  {
    assignment: HarvesterAssignment.Center,
    label: 'Diamond',
    desc: 'Mine gold cells at the center, then contest the Diamond.',
    icon: 'diamond',
    color: '#b388ff',
  },
  {
    assignment: HarvesterAssignment.Mana,
    label: 'Mana',
    desc: 'Channel demonic energy to generate Mana.',
    icon: null,
    color: '#7c4dff',
  },
];

export class HutPopup {
  private targetBuildingId: number | null = null;
  // Cached layout for hit testing (screen space)
  private rect = { x: 0, y: 0, w: 0, h: 0 };
  private assignBtnRects: { x: number; y: number; w: number; h: number; assignment: HarvesterAssignment }[] = [];
  private centerBtnRect = { x: 0, y: 0, w: 0, h: 0 };
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

  handleClick(cx: number, cy: number): HutPopupAction | null {
    if (!this.containsPoint(cx, cy)) return null;

    if (this.hitTest(cx, cy, this.closeBtnRect)) return { action: 'close' };
    if (this.hitTest(cx, cy, this.centerBtnRect)) return { action: 'center_builder' };

    for (const btn of this.assignBtnRects) {
      if (this.hitTest(cx, cy, btn)) return { action: 'assign', assignment: btn.assignment };
    }

    return null; // clicked inside popup, consume event
  }

  private hitTest(cx: number, cy: number, r: { x: number; y: number; w: number; h: number }): boolean {
    const pad = 6;
    return r.w > 0 && cx >= r.x - pad && cx < r.x + r.w + pad && cy >= r.y - pad && cy < r.y + r.h + pad;
  }

  draw(
    ctx: CanvasRenderingContext2D, camera: Camera, state: GameState,
    ui: UIAssets, canvasW: number, canvasH: number,
  ): void {
    if (this.targetBuildingId === null) return;

    const building = state.buildings.find(b => b.id === this.targetBuildingId);
    if (!building) { this.close(); return; }

    const player = state.players[building.playerId];
    if (!player) return;
    const race = player.race;

    const harvester = state.harvesters.find(h => h.hutId === building.id);
    const currentAssignment = harvester?.assignment ?? HarvesterAssignment.BaseGold;

    // Which resources this race uses
    const used = getRaceUsedResources(race);
    const isDemon = race === Race.Demon;

    // Filter available assignments
    const availableAssignments = ASSIGNMENT_DEFS.filter(a => {
      if (a.assignment === HarvesterAssignment.Mana) return isDemon;
      if (a.assignment === HarvesterAssignment.BaseGold) return used.gold;
      if (a.assignment === HarvesterAssignment.Wood) return used.wood;
      if (a.assignment === HarvesterAssignment.Stone) return used.stone;
      return true; // Center always available
    });

    // --- Responsive sizing ---
    const isMobile = canvasW < 600;
    const PAD = isMobile ? 8 : 14;
    const POPUP_W = isMobile ? Math.min(canvasW - 8, 420) : 420;
    const ASSIGN_BTN_H = isMobile ? 48 : 56;
    const FOOTER_BTN_H = isMobile ? MIN_TAP + 2 : MIN_TAP + 8;
    const HEADER_H = isMobile ? 30 : 36;
    const GAP = isMobile ? 5 : 8;

    // Calculate popup height
    const assignAreaH = availableAssignments.length * (ASSIGN_BTN_H + GAP) - GAP;
    const popupH = HEADER_H + PAD + assignAreaH + PAD + FOOTER_BTN_H + PAD * 2;
    const popupW = POPUP_W;

    // Position in screen space, anchored above building
    const worldPx = building.worldX * TILE_SIZE + TILE_SIZE / 2;
    const worldPy = building.worldY * TILE_SIZE;
    const screen = camera.worldToScreen(worldPx, worldPy);
    let px = Math.round(screen.x - popupW / 2);
    let py = Math.round(screen.y - popupH - 20);

    // Clamp within HUD-safe area
    const safeY = getPopupSafeY(canvasW, canvasH);
    px = Math.max(4, Math.min(canvasW - popupW - 4, px));
    py = Math.max(safeY.top, Math.min(safeY.bottom - popupH, py));

    this.rect = { x: px, y: py, w: popupW, h: popupH };

    // Reset button rects
    this.assignBtnRects = [];
    this.centerBtnRect = { x: 0, y: 0, w: 0, h: 0 };
    this.closeBtnRect = { x: 0, y: 0, w: 0, h: 0 };

    ctx.save();
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);

    // === Background panel (WoodTable 9-slice) — draw oversized for visual padding ===
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

    // === Header: SmallRibbon with "Miner Hut" ===
    const ribbonH = 28;
    const ribbonW = popupW - PAD * 2;
    ui.drawSmallRibbon(ctx, px + PAD, curY, ribbonW, ribbonH, 0);
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px monospace';
    ctx.fillStyle = '#fff';
    ctx.fillText('Miner Hut', px + popupW / 2, curY + ribbonH / 2 + 4);

    // Close button (top right)
    const closeSize = Math.max(MIN_TAP, 32);
    const closeBtnX = px + popupW - closeSize - 2;
    const closeBtnY = py + 2;
    this.closeBtnRect = { x: closeBtnX, y: closeBtnY, w: closeSize, h: closeSize };
    ui.drawSmallRedRoundButton(ctx, closeBtnX, closeBtnY, closeSize);
    ui.drawIcon(ctx, 'close', closeBtnX + closeSize / 2 - 10, closeBtnY + closeSize / 2 - 10, 20);

    curY += HEADER_H;

    // === Assignment buttons ===
    const btnW = popupW - PAD * 2;
    for (const def of availableAssignments) {
      const bx = px + PAD;
      const by = curY;
      const isActive = def.assignment === currentAssignment;

      this.assignBtnRects.push({ x: bx, y: by, w: btnW, h: ASSIGN_BTN_H, assignment: def.assignment });

      // Button background
      if (isActive) {
        ui.drawBigBlueButton(ctx, bx - 4, by - 4, btnW + 8, ASSIGN_BTN_H + 8, true);
      } else {
        ui.drawBigBlueButton(ctx, bx - 4, by - 4, btnW + 8, ASSIGN_BTN_H + 8);
      }

      // Active indicator — bright border glow
      if (isActive) {
        ctx.strokeStyle = def.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(bx - 2, by - 2, btnW + 4, ASSIGN_BTN_H + 4, 4);
        ctx.stroke();
      }

      const iconSz = isMobile ? 16 : 20;
      let textX = bx + 10;

      // Resource icon
      if (def.icon) {
        ui.drawIcon(ctx, def.icon, textX, by + (ASSIGN_BTN_H - iconSz) / 2, iconSz);
        textX += iconSz + 6;
      } else if (def.assignment === HarvesterAssignment.Mana) {
        // Draw mana swirl icon inline
        const cx2 = textX + iconSz / 2;
        const cy2 = by + ASSIGN_BTN_H / 2;
        ctx.fillStyle = '#7c4dff';
        ctx.beginPath();
        ctx.arc(cx2, cy2, iconSz * 0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#b388ff';
        ctx.beginPath();
        ctx.arc(cx2 - 2, cy2 - 2, iconSz * 0.2, 0, Math.PI * 2);
        ctx.fill();
        textX += iconSz + 6;
      }

      // Label
      ctx.textAlign = 'left';
      ctx.font = `bold ${isMobile ? 12 : 14}px monospace`;
      ctx.fillStyle = isActive ? def.color : '#fff';
      const labelY = by + (ASSIGN_BTN_H / 2) - (isMobile ? 4 : 5);
      ctx.fillText(def.label, textX, labelY);

      if (isActive) {
        // Checkmark after label
        const labelW = ctx.measureText(def.label).width;
        ctx.fillStyle = def.color;
        ctx.font = `bold ${isMobile ? 11 : 13}px monospace`;
        ctx.fillText(' ✓', textX + labelW, labelY);
      }

      // Description
      ctx.font = `${isMobile ? 10 : 11}px monospace`;
      ctx.fillStyle = isActive ? '#e0e0e0' : '#aaa';
      ctx.fillText(def.desc, textX, by + (ASSIGN_BTN_H / 2) + (isMobile ? 8 : 10));

      curY += ASSIGN_BTN_H + GAP;
    }

    // === Footer: [Center on Builder] ===
    const footerY = curY + PAD;
    const footerBtnW = popupW - PAD * 2;

    // Center on Builder button
    this.centerBtnRect = { x: px + PAD, y: footerY, w: footerBtnW, h: FOOTER_BTN_H };
    ui.drawBigBlueButton(ctx, px + PAD, footerY, footerBtnW, FOOTER_BTN_H);
    ctx.textAlign = 'center';
    ctx.font = `bold ${isMobile ? 10 : 11}px monospace`;
    ctx.fillStyle = '#fff';
    ctx.fillText('FIND', px + PAD + footerBtnW / 2, footerY + FOOTER_BTN_H / 2 - 5);
    ctx.fillText('BUILDER', px + PAD + footerBtnW / 2, footerY + FOOTER_BTN_H / 2 + 9);

    // === Pointer triangle from popup to building ===
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
