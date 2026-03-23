import { Camera } from '../rendering/Camera';
import { UIAssets } from '../rendering/UIAssets';
import { SpriteLoader, drawSpriteFrame, getSpriteFrame } from '../rendering/SpriteLoader';
import { GameState, BuildingType, BuildingState, TILE_SIZE, Race } from '../simulation/types';
import { UPGRADE_TREES, UNIT_STATS, TOWER_STATS, getBuildingCost, getNodeUpgradeCost, type UpgradeNodeDef } from '../simulation/data';
import { getUnitUpgradeMultipliers } from '../simulation/GameState';
import { getPopupSafeY } from './SafeArea';

export interface UpgradeOption {
  choice: string;
  cost: { gold: number; wood: number; stone: number; deathEssence?: number; souls?: number };
  name?: string;
  desc?: string;
}

export type PopupAction =
  | { action: 'upgrade'; choice: string }
  | { action: 'sell' }
  | { action: 'toggle_lane' }
  | { action: 'close' };

// Minimum touch target (Apple HIG = 44px)
const MIN_TAP = 44;

// Building type → unit category for sprite lookup
const BUILDING_CATEGORY: Partial<Record<BuildingType, 'melee' | 'ranged' | 'caster'>> = {
  [BuildingType.MeleeSpawner]: 'melee',
  [BuildingType.RangedSpawner]: 'ranged',
  [BuildingType.CasterSpawner]: 'caster',
};

const TYPE_LABELS: Record<string, string> = {
  [BuildingType.MeleeSpawner]: 'Melee Spawner',
  [BuildingType.RangedSpawner]: 'Ranged Spawner',
  [BuildingType.CasterSpawner]: 'Caster Spawner',
  [BuildingType.Tower]: 'Tower',
  [BuildingType.HarvesterHut]: 'Harvester Hut',
};

// Per-race caster support ability descriptions
const CASTER_SUPPORT_DESC: Record<Race, string> = {
  [Race.Crown]: 'Shields 2 nearby allies, absorbing 12 dmg each.',
  [Race.Horde]: 'Hastes up to 5 nearby allies, boosting attack speed.',
  [Race.Goblins]: 'Hexes nearby enemies, slowing their movement.',
  [Race.Oozlings]: 'Hastes up to 3 nearby allies.',
  [Race.Demon]: 'Pure damage. Fires AoE blasts at enemies.',
  [Race.Deep]: 'Cleanses burn from nearby allies. Fires AoE.',
  [Race.Wild]: 'Hastes up to 3 nearby allies. Fires AoE.',
  [Race.Geists]: 'Heals 2 HP to 3 lowest-HP allies. Fires AoE.',
  [Race.Tenders]: 'Heals 3 HP to all nearby allies. Fires AoE.',
};

// Per-race melee on-hit descriptions
const MELEE_ONHIT_DESC: Record<Race, string> = {
  [Race.Crown]: '10% damage reduction.',
  [Race.Horde]: 'Knockback every 3rd hit. 10% lifesteal.',
  [Race.Goblins]: '15% dodge chance.',
  [Race.Oozlings]: '15% chance to self-haste on hit. Spawns 2 at half power.',
  [Race.Demon]: 'Burns enemies on every melee hit.',
  [Race.Deep]: 'Slows enemies on hit.',
  [Race.Wild]: 'Poisons enemies on hit (burn).',
  [Race.Geists]: 'Burns enemies on hit. 15% lifesteal.',
  [Race.Tenders]: 'Regenerates 1 HP/s passively.',
};

// Per-race ranged on-hit descriptions
const RANGED_ONHIT_DESC: Record<Race, string> = {
  [Race.Crown]: 'Balanced ranged attacker.',
  [Race.Horde]: 'Heavy damage ranged cleaver.',
  [Race.Goblins]: 'Burns enemies on hit.',
  [Race.Oozlings]: 'Spawns 2 at half power.',
  [Race.Demon]: 'High damage, long range sniper.',
  [Race.Deep]: 'Slows enemies on hit.',
  [Race.Wild]: 'Poisons enemies on hit (burn).',
  [Race.Geists]: 'Burns enemies on hit.',
  [Race.Tenders]: 'Balanced ranged attacker.',
};

// Remember whether the user has closed the info panel
let infoPanelPreference: 'open' | 'closed' = 'open';

export class BuildingPopup {
  private targetBuildingId: number | null = null;
  private showStats = true; // default to open
  private animTick = 0;
  // Cached layout for hit testing (screen space)
  private rect = { x: 0, y: 0, w: 0, h: 0 };
  private upgradeBtnRects: { x: number; y: number; w: number; h: number; choice: string }[] = [];
  private sellBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  private closeBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  private laneBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  private statsBtnRect = { x: 0, y: 0, w: 0, h: 0 };

  open(buildingId: number, isMobile = false): void {
    this.targetBuildingId = buildingId;
    // Default stats closed on mobile to save space
    this.showStats = isMobile ? false : infoPanelPreference === 'open';
    this.animTick = 0;
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

  handleClick(cx: number, cy: number): PopupAction | null {
    if (!this.containsPoint(cx, cy)) return null;

    if (this.hitTest(cx, cy, this.closeBtnRect)) return { action: 'close' };
    if (this.hitTest(cx, cy, this.sellBtnRect)) return { action: 'sell' };
    if (this.hitTest(cx, cy, this.laneBtnRect)) return { action: 'toggle_lane' };

    if (this.hitTest(cx, cy, this.statsBtnRect)) {
      this.showStats = !this.showStats;
      infoPanelPreference = this.showStats ? 'open' : 'closed';
      return null;
    }

    for (const btn of this.upgradeBtnRects) {
      if (this.hitTest(cx, cy, btn)) return { action: 'upgrade', choice: btn.choice };
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
    playerGold: number, playerWood: number, playerStone: number,
    sprites?: SpriteLoader | null,
  ): void {
    if (this.targetBuildingId === null) return;

    const building = state.buildings.find(b => b.id === this.targetBuildingId);
    if (!building) { this.close(); return; }

    const race = state.players[building.playerId]?.race;
    if (!race) return;

    this.animTick++;

    const options = this.getUpgradeOptions(building, race);
    const isSpawner = building.type !== BuildingType.Tower && building.type !== BuildingType.HarvesterHut;
    const category = BUILDING_CATEGORY[building.type];

    // --- Responsive sizing ---
    const isMobile = canvasW < 600;
    const PAD = isMobile ? 8 : 14;
    const POPUP_W = isMobile ? Math.min(canvasW - 8, 510) : 510;
    const UPGRADE_BTN_H = isMobile ? 96 : 132;
    const SPRITE_SIZE = isMobile ? 30 : 44;
    const FOOTER_BTN_H = isMobile ? MIN_TAP + 2 : MIN_TAP + 8;
    const HEADER_H = isMobile ? 30 : 36;
    const ICON_SIZE = isMobile ? 13 : 16;
    const GAP = isMobile ? 6 : 10;

    // Calculate popup height
    const upgradeRowH = options.length > 0 ? UPGRADE_BTN_H + GAP : 0;
    const fullyUpgradedH = options.length === 0 && building.upgradePath.length >= 3 ? 24 : 0;
    const statsH = this.showStats ? this.measureStatsHeight(building, race, isMobile) : 0;
    const popupH = HEADER_H + statsH + upgradeRowH + fullyUpgradedH + FOOTER_BTN_H + PAD * 3;
    const popupW = POPUP_W;

    // Position in screen space, anchored above building
    const worldPx = building.worldX * TILE_SIZE + TILE_SIZE / 2;
    const worldPy = building.worldY * TILE_SIZE;
    const screen = camera.worldToScreen(worldPx, worldPy);
    let px = Math.round(screen.x - popupW / 2);
    let py = Math.round(screen.y - popupH - 20);

    // Clamp within HUD-safe area (below top bar, above bottom tray + floating buttons)
    const safeY = getPopupSafeY(canvasW, canvasH);
    px = Math.max(4, Math.min(canvasW - popupW - 4, px));
    py = Math.max(safeY.top, Math.min(safeY.bottom - popupH, py));

    this.rect = { x: px, y: py, w: popupW, h: popupH };

    // Reset button rects
    this.upgradeBtnRects = [];
    this.sellBtnRect = { x: 0, y: 0, w: 0, h: 0 };
    this.closeBtnRect = { x: 0, y: 0, w: 0, h: 0 };
    this.laneBtnRect = { x: 0, y: 0, w: 0, h: 0 };
    this.statsBtnRect = { x: 0, y: 0, w: 0, h: 0 };

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

    // === Header: SmallRibbon with building name + tier ===
    const tier = building.upgradePath.length - 1;
    const tierStr = tier > 0 ? ` T${tier}` : '';
    const label = (TYPE_LABELS[building.type] ?? building.type) + tierStr;
    const ribbonH = 28;
    const ribbonW = popupW - PAD * 2;
    ui.drawSmallRibbon(ctx, px + PAD, curY, ribbonW, ribbonH, 0);
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px monospace';
    ctx.fillStyle = '#fff';
    ctx.fillText(label, px + popupW / 2, curY + ribbonH / 2 + 4);

    // Close button (top right, inside popup) — red round button
    const closeSize = Math.max(MIN_TAP, 32);
    const closeBtnX = px + popupW - closeSize - 2;
    const closeBtnY = py + 2;
    this.closeBtnRect = { x: closeBtnX, y: closeBtnY, w: closeSize, h: closeSize };
    ui.drawSmallRedRoundButton(ctx, closeBtnX, closeBtnY, closeSize);
    ui.drawIcon(ctx, 'close', closeBtnX + closeSize / 2 - 10, closeBtnY + closeSize / 2 - 10, 20);

    curY += HEADER_H;

    // === Stats panel (open by default, collapsible) ===
    if (this.showStats) {
      this.drawStatsPanel(ctx, px + PAD, curY, popupW - PAD * 2, statsH, building, race, ui, isMobile);
      curY += statsH;
    }

    // === Upgrade buttons ===
    if (options.length > 0) {
      const btnW = options.length === 2
        ? Math.floor((popupW - PAD * 2 - GAP) / 2)
        : popupW - PAD * 2;

      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        const bx = px + PAD + (i > 0 ? btnW + GAP : 0);
        const by = curY;
        const essenceCost = opt.cost.deathEssence ?? 0;
        const soulsCost = opt.cost.souls ?? 0;
        const playerEssence = state.players[building.playerId]?.deathEssence ?? 0;
        const playerSouls = state.players[building.playerId]?.souls ?? 0;
        const canAfford = playerGold >= opt.cost.gold && playerWood >= opt.cost.wood && playerStone >= opt.cost.stone
          && (essenceCost <= 0 || playerEssence >= essenceCost)
          && (soulsCost <= 0 || playerSouls >= soulsCost);

        this.upgradeBtnRects.push({ x: bx, y: by, w: btnW, h: UPGRADE_BTN_H, choice: opt.choice });
        this.drawUpgradeButton(ctx, ui, bx, by, btnW, UPGRADE_BTN_H, opt, canAfford,
          building, race, category, sprites ?? null, SPRITE_SIZE, ICON_SIZE, isMobile);
      }
      curY += UPGRADE_BTN_H + GAP;
    } else if (building.upgradePath.length >= 3) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 12px monospace';
      ctx.fillStyle = '#81c784';
      ctx.fillText('MAX LEVEL', px + popupW / 2, curY + 16);
      curY += 24;
    }

    // === Footer buttons: [Stats] [Lane] [Sell] ===
    const footerY = curY + PAD;
    const footerBtnCount = isSpawner ? 3 : 2; // non-spawners skip Lane
    const footerBtnW = Math.floor((popupW - PAD * 2 - GAP * (footerBtnCount - 1)) / footerBtnCount);

    let footerX = px + PAD;

    // Info toggle button
    this.statsBtnRect = { x: footerX, y: footerY, w: footerBtnW, h: FOOTER_BTN_H };
    ui.drawBigBlueButton(ctx, footerX, footerY, footerBtnW, FOOTER_BTN_H, this.showStats);
    const infoIconSz = 22;
    ui.drawIcon(ctx, 'info', footerX + footerBtnW / 2 - infoIconSz / 2, footerY + FOOTER_BTN_H / 2 - infoIconSz / 2, infoIconSz);
    footerX += footerBtnW + GAP;

    // Lane toggle button (only for spawners)
    if (isSpawner) {
      this.laneBtnRect = { x: footerX, y: footerY, w: footerBtnW, h: FOOTER_BTN_H };
      ui.drawBigBlueButton(ctx, footerX, footerY, footerBtnW, FOOTER_BTN_H);
      const isOozlings = race === Race.Oozlings;
      const isHorizontal = state.mapDef.shapeAxis === 'x';
      let laneLabel: string;
      let laneColor: string;
      if (isOozlings) {
        laneLabel = 'RANDOM';
        laneColor = '#b39ddb';
      } else if (building.lane === 'left') {
        laneLabel = isHorizontal ? 'TOP' : 'LEFT';
        laneColor = '#4fc3f7';
      } else {
        laneLabel = isHorizontal ? 'BOT' : 'RIGHT';
        laneColor = '#ff8a65';
      }
      ctx.textAlign = 'center';
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = laneColor;
      ctx.fillText(laneLabel, footerX + footerBtnW / 2, footerY + FOOTER_BTN_H / 2 - 5);
      ctx.fillText('LANE', footerX + footerBtnW / 2, footerY + FOOTER_BTN_H / 2 + 9);
      footerX += footerBtnW + GAP;
    }

    // Sell button (red) — text fully inside button
    const cost = getBuildingCost(race, building.type);
    const refund = cost ? Math.floor(cost.gold * 0.5) : 0;
    this.sellBtnRect = { x: footerX, y: footerY, w: footerBtnW, h: FOOTER_BTN_H };
    ui.drawBigRedButton(ctx, footerX, footerY, footerBtnW, FOOTER_BTN_H);
    ctx.textAlign = 'center';
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = '#fff';
    const sellTextY = footerY + FOOTER_BTN_H * 0.38;
    ctx.fillText('SELL', footerX + footerBtnW / 2, sellTextY);
    if (refund > 0) {
      ctx.font = 'bold 11px monospace';
      const refundStr = `+${refund}`;
      const refundTotalW = ICON_SIZE + 2 + ctx.measureText(refundStr).width;
      const rx = footerX + footerBtnW / 2 - refundTotalW / 2;
      const refundY = sellTextY + 14;
      ui.drawIcon(ctx, 'gold', rx, refundY - ICON_SIZE + 3, ICON_SIZE - 2);
      ctx.fillStyle = '#ffd740';
      ctx.textAlign = 'left';
      ctx.fillText(refundStr, rx + ICON_SIZE, refundY);
    }

    // === Pointer triangle from popup to building ===
    // Only draw when building is below the popup (normal case)
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

  private measureStatsHeight(building: BuildingState, _race: Race, _isMobile: boolean): number {
    const lineH = 16;
    // Start offset: lineH + 2
    let h = lineH + 4;

    if (building.type === BuildingType.Tower) {
      h += lineH * 4;
    } else if (building.type !== BuildingType.HarvesterHut) {
      // Name + HP/dmg icons + Spd/Atk/Rng + gap + description (up to 3 lines)
      h += lineH + lineH + (lineH + 2) + 3 * (lineH - 1);
    }

    // Upgrade path
    if (building.upgradePath.length > 1) h += lineH + 4;

    return Math.max(50, h);
  }

  private drawUpgradeButton(
    ctx: CanvasRenderingContext2D, ui: UIAssets,
    x: number, y: number, w: number, h: number,
    opt: UpgradeOption, canAfford: boolean,
    building: BuildingState, race: Race,
    category: 'melee' | 'ranged' | 'caster' | undefined,
    sprites: SpriteLoader | null,
    spriteSize: number, iconSize: number, isMobile: boolean,
  ): void {
    // 9-slice button background — draw oversized so text sits well inside the visual border
    const btnPad = 8;
    if (canAfford) {
      ui.drawBigBlueButton(ctx, x - btnPad, y - btnPad, w + btnPad * 2, h + btnPad * 2);
    } else {
      ctx.globalAlpha = 0.45;
      ui.drawBigBlueButton(ctx, x - btnPad, y - btnPad, w + btnPad * 2, h + btnPad * 2);
      ctx.globalAlpha = 1;
    }

    // Content inset — keep all text/sprites inside the button's visible region
    const insetX = isMobile ? 6 : 14;
    const insetY = isMobile ? 6 : 14;
    const cx = x + insetX;
    const cy = y + insetY;
    const cw = w - insetX * 2;
    const ch = h - insetY * 2;

    // Layout: [sprite] [name + desc + cost] inside content area
    const sprX = cx;
    const sprY = cy + (ch - spriteSize) / 2;

    // Preview shows what the unit will look like AFTER this upgrade
    const nextTier = building.upgradePath.length; // base=1→tier1, tier1=2→tier2
    const tierScale = 1.0 + nextTier * 0.15;

    let drewSprite = false;
    if (category && sprites) {
      const sprData = sprites.getUnitSprite(race, category, building.playerId, false, opt.choice);
      if (sprData) {
        const [img, def] = sprData;
        const frame = getSpriteFrame(Math.floor(this.animTick / 3), def);
        const spriteScale = def.scale ?? 1.0;
        const aspect = def.frameW / def.frameH;
        const dh = spriteSize * spriteScale * tierScale * (def.heightScale ?? 1.0);
        const dw = spriteSize * spriteScale * tierScale * aspect;
        // Anchor horizontally using anchorX (0=left, 0.5=center, 1=right)
        const ax = def.anchorX ?? 0.5;
        const spriteCenterX = sprX + spriteSize / 2;
        const drawX = spriteCenterX - dw * ax;
        // Ground using groundY — feet sit at bottom of sprite area
        const feetY = sprY + spriteSize;
        const drawY = feetY - dh * (def.groundY ?? 0.71);
        drawSpriteFrame(ctx, img, def, frame, drawX, drawY, dw, dh);
        if (nextTier >= 1) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.12 + nextTier * 0.06;
          drawSpriteFrame(ctx, img, def, frame, drawX, drawY, dw, dh);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
        }
        drewSprite = true;
      }
    } else if (building.type === BuildingType.Tower && sprites) {
      const towerImg = sprites.getBuildingSprite(BuildingType.Tower, building.playerId);
      if (towerImg) {
        const aspect = towerImg.width / towerImg.height;
        const dh = spriteSize * tierScale;
        const dw = dh * aspect;
        const drawX = sprX + (spriteSize - dw) / 2;
        const drawY = sprY + (spriteSize - dh);
        ctx.drawImage(towerImg, drawX, drawY, dw, dh);
        drewSprite = true;
      }
    }

    // Text area — to the right of sprite, or full width if no sprite
    const textLeft = drewSprite ? cx + spriteSize + 6 : cx;
    const textW = drewSprite ? cw - spriteSize - 6 : cw;

    // Helper: draw text with dark shadow for contrast on blue button
    const shadowText = (text: string, tx: number, ty: number) => {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(text, tx + 1, ty + 1);
    };

    // Upgrade name (prominent, word-wrap to 2 lines) — pushed down into blue area
    ctx.textAlign = 'left';
    const nameFontSize = isMobile ? 12 : 14;
    ctx.font = `bold ${nameFontSize}px monospace`;
    const name = opt.name ?? opt.choice;
    const nameLines = this.wordWrap(ctx, name, textW, isMobile ? 1 : 2);
    let textY = cy + (isMobile ? 12 : 16);
    for (const line of nameLines) {
      shadowText(line, textLeft, textY);
      ctx.fillStyle = canAfford ? '#fff' : '#aaa';
      ctx.fillText(line, textLeft, textY);
      textY += nameFontSize + 2;
    }

    // Description — wrap to fit, normalize Y so both buttons align
    const descFontSize = isMobile ? 10 : 12;
    ctx.font = `${descFontSize}px monospace`;
    const desc = opt.desc ?? '';
    const descLines = this.wordWrap(ctx, desc, textW, 2);
    // Fixed Y for description — account for wrapped names
    const descY = cy + (isMobile ? 12 : 16) + (nameFontSize + 2) * (isMobile ? 1 : 2) + 2;
    let descLineY = descY;
    for (const line of descLines) {
      shadowText(line, textLeft, descLineY);
      ctx.fillStyle = canAfford ? '#e0e0e0' : '#888';
      ctx.fillText(line, textLeft, descLineY);
      descLineY += descFontSize + 2;
    }

    // Cost with resource icons — pulled up into blue area (above bottom edge)
    const costY = cy + ch - (isMobile ? 8 : 14);
    let costX = textLeft;
    ctx.font = `bold ${isMobile ? 11 : 12}px monospace`;

    const drawCostItem = (icon: 'gold' | 'wood' | 'meat', val: number, color: string, dimColor: string) => {
      ctx.globalAlpha = canAfford ? 1 : 0.4;
      ui.drawIcon(ctx, icon, costX, costY - iconSize + 1, iconSize);
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
      shadowText(`${val}`, costX + iconSize + 1, costY);
      ctx.fillStyle = canAfford ? color : dimColor;
      ctx.fillText(`${val}`, costX + iconSize + 1, costY);
      costX += iconSize + ctx.measureText(`${val}`).width + 6;
    };

    if (opt.cost.gold > 0) drawCostItem('gold', opt.cost.gold, '#ffd740', '#665500');
    if (opt.cost.wood > 0) drawCostItem('wood', opt.cost.wood, '#81c784', '#2e5530');
    if (opt.cost.stone > 0) drawCostItem('meat', opt.cost.stone, '#e57373', '#6d2828');
    if ((opt.cost.deathEssence ?? 0) > 0) {
      // Ooze droplet icon (drawn inline, no sprite)
      const oozeSz = iconSize;
      const oozeCx = costX + oozeSz / 2, oozeCy = costY - oozeSz / 2 + 1;
      ctx.globalAlpha = canAfford ? 1 : 0.4;
      ctx.fillStyle = '#69f0ae';
      ctx.beginPath();
      ctx.moveTo(oozeCx, oozeCy - oozeSz * 0.4);
      ctx.quadraticCurveTo(oozeCx + oozeSz * 0.35, oozeCy + oozeSz * 0.1, oozeCx, oozeCy + oozeSz * 0.4);
      ctx.quadraticCurveTo(oozeCx - oozeSz * 0.35, oozeCy + oozeSz * 0.1, oozeCx, oozeCy - oozeSz * 0.4);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
      shadowText(`${opt.cost.deathEssence}`, costX + oozeSz + 1, costY);
      ctx.fillStyle = canAfford ? '#69f0ae' : '#1b5e20';
      ctx.fillText(`${opt.cost.deathEssence}`, costX + oozeSz + 1, costY);
      costX += oozeSz + ctx.measureText(`${opt.cost.deathEssence}`).width + 6;
    }
    if ((opt.cost.souls ?? 0) > 0) {
      // Soul icon (small skull-like circle)
      const soulSz = iconSize;
      const soulCx = costX + soulSz / 2, soulCy = costY - soulSz / 2 + 1;
      ctx.globalAlpha = canAfford ? 1 : 0.4;
      ctx.fillStyle = '#ce93d8';
      ctx.beginPath();
      ctx.arc(soulCx, soulCy, soulSz * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
      shadowText(`${opt.cost.souls}`, costX + soulSz + 1, costY);
      ctx.fillStyle = canAfford ? '#ce93d8' : '#4a148c';
      ctx.fillText(`${opt.cost.souls}`, costX + soulSz + 1, costY);
      costX += soulSz + ctx.measureText(`${opt.cost.souls}`).width + 6;
    }
  }

  private drawStatsPanel(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number,
    building: BuildingState, race: Race,
    ui: UIAssets, isMobile: boolean,
  ): void {
    // Dark inset background
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 4);
    ctx.fill();

    ctx.textAlign = 'left';
    const mainFont = isMobile ? 13 : 14;
    const smallFont = 13;
    const iconSz = 14;
    const lineH = 16;
    const col1 = x + 6;
    const descW = w - 12;
    let ly = y + lineH + 2;

    const upgrade = getUnitUpgradeMultipliers(building.upgradePath, race, building.type);

    if (building.type === BuildingType.Tower) {
      const base = TOWER_STATS[race];
      if (base) {
        const dmg = Math.max(1, Math.round(base.damage * upgrade.damage));
        const atkSpd = Math.max(0.2, +(base.attackSpeed * upgrade.attackSpeed).toFixed(2));
        const rng = Math.max(1, +(base.range * upgrade.range).toFixed(1)) + (upgrade.special.towerRangeBonus ?? 0);

        // Name + stats on one line
        ctx.fillStyle = '#ffd740';
        ctx.font = `bold ${mainFont}px monospace`;
        ctx.fillText(`Tower`, col1, ly);
        ly += lineH;

        ctx.font = `${smallFont}px monospace`;
        ctx.fillStyle = '#ddd';
        ui.drawIcon(ctx, 'shield', col1 - 2, ly - iconSz + 1, iconSz);
        ctx.fillText(`${building.hp}/${building.maxHp}`, col1 + iconSz + 2, ly);
        const col2 = col1 + w / 2 - 4;
        ui.drawIcon(ctx, 'sword', col2 - 2, ly - iconSz + 1, iconSz);
        ctx.fillText(`${dmg}`, col2 + iconSz + 2, ly);
        ly += lineH;

        ctx.fillStyle = '#aaa';
        ctx.fillText(`Atk: ${atkSpd}s  Rng: ${rng}`, col1, ly);
        ly += lineH;

        // Description
        ctx.fillStyle = '#b0bec5';
        ctx.font = `${smallFont}px monospace`;
        ctx.fillText('Attacks nearest enemy in range.', col1, ly);
      }
    } else if (building.type !== BuildingType.HarvesterHut) {
      const base = UNIT_STATS[race]?.[building.type];
      if (base) {
        const hp = Math.max(1, Math.round(base.hp * upgrade.hp));
        const dmg = Math.max(1, Math.round(base.damage * upgrade.damage));
        const spd = Math.max(0.5, +(base.moveSpeed * upgrade.moveSpeed).toFixed(1));
        const atkSpd = Math.max(0.2, +(base.attackSpeed * upgrade.attackSpeed).toFixed(2));
        const rng = Math.max(1, +(base.range * upgrade.range).toFixed(1));

        // Unit name
        ctx.fillStyle = '#ffd740';
        ctx.font = `bold ${mainFont}px monospace`;
        ctx.fillText(base.name, col1, ly);
        ly += lineH;

        // Stats row with icons
        ctx.font = `${smallFont}px monospace`;
        ctx.fillStyle = '#ddd';
        ui.drawIcon(ctx, 'shield', col1 - 2, ly - iconSz + 1, iconSz);
        ctx.fillText(`${hp}`, col1 + iconSz + 2, ly);
        const col2 = col1 + w / 2 - 4;
        ui.drawIcon(ctx, 'sword', col2 - 2, ly - iconSz + 1, iconSz);
        ctx.fillText(`${dmg}`, col2 + iconSz + 2, ly);
        ly += lineH;

        ctx.fillStyle = '#aaa';
        ctx.fillText(`Spd: ${spd}  Atk: ${atkSpd}s  Rng: ${rng}`, col1, ly);
        ly += lineH + 2;

        // Description — explain what this unit does, with numbers
        ctx.fillStyle = '#b0bec5';
        ctx.font = `${smallFont}px monospace`;
        let desc = '';
        const category = building.type === BuildingType.CasterSpawner ? 'caster'
          : building.type === BuildingType.MeleeSpawner ? 'melee' : 'ranged';
        if (category === 'caster') {
          desc = CASTER_SUPPORT_DESC[race] ?? 'Support caster.';
        } else if (category === 'melee') {
          desc = MELEE_ONHIT_DESC[race] ?? '';
        } else if (category === 'ranged') {
          desc = RANGED_ONHIT_DESC[race] ?? '';
        }
        if (base.spawnCount && base.spawnCount > 1) {
          if (!desc.includes('Spawn')) desc += ` Spawns ${base.spawnCount} per cycle.`;
        }
        // Word wrap the description
        const descLines = this.wordWrap(ctx, desc, descW, 3);
        for (const line of descLines) {
          ctx.fillText(line, col1, ly);
          ly += lineH - 1;
        }
      }
    }

    // Upgrade path — show names
    const pathTier = building.upgradePath.length - 1;
    if (pathTier > 0) {
      ly += 2;
      ctx.fillStyle = '#81c784';
      ctx.font = `${smallFont}px monospace`;
      const tree = UPGRADE_TREES[race]?.[building.type];
      const names = building.upgradePath.slice(1).map(node => {
        const def = tree?.[node as keyof typeof tree] as UpgradeNodeDef | undefined;
        return def?.name ?? node;
      });
      const pathText = names.join(' > ');
      const pathLines = this.wordWrap(ctx, pathText, descW, 1);
      ctx.fillText(pathLines[0], col1, ly);
    }
  }

  private wordWrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const test = current ? current + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = word;
        if (lines.length >= maxLines) break;
      } else {
        current = test;
      }
    }
    if (current && lines.length < maxLines) {
      lines.push(current);
    } else if (current && lines.length === maxLines) {
      const last = lines[maxLines - 1] + ' ' + current;
      if (ctx.measureText(last).width > maxWidth) {
        let prev = lines[maxLines - 1];
        let truncated = prev;
        while (truncated.length < last.length) {
          const next = last.slice(0, truncated.length + 1);
          if (ctx.measureText(next + '..').width >= maxWidth) break;
          prev = next;
          truncated = next;
        }
        lines[maxLines - 1] = prev.trimEnd() + '..';
      } else {
        lines[maxLines - 1] = last;
      }
    }
    return lines.length > 0 ? lines : [text.slice(0, 10)];
  }

  private getUpgradeOptions(building: BuildingState, race: Race): UpgradeOption[] {
    if (building.type === BuildingType.HarvesterHut) return [];
    const tree = UPGRADE_TREES[race]?.[building.type];
    const lookup = (choice: string): UpgradeOption => {
      const cost = getNodeUpgradeCost(race, building.type, building.upgradePath.length, choice);
      const def = tree?.[choice as keyof typeof tree];
      return { choice, cost, name: def?.name, desc: def?.desc };
    };
    if (building.upgradePath.length === 1 && building.upgradePath[0] === 'A') {
      return [lookup('B'), lookup('C')];
    }
    if (building.upgradePath.length === 2) {
      if (building.upgradePath[1] === 'B') return [lookup('D'), lookup('E')];
      if (building.upgradePath[1] === 'C') return [lookup('F'), lookup('G')];
    }
    return [];
  }
}
