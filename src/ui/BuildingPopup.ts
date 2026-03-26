import { Camera } from '../rendering/Camera';
import { UIAssets, IconName } from '../rendering/UIAssets';
import { SpriteLoader, drawSpriteFrame, getSpriteFrame } from '../rendering/SpriteLoader';
import { GameState, BuildingType, BuildingState, Race } from '../simulation/types';
import { tileToPixel } from '../rendering/Projection';
import { UPGRADE_TREES, UNIT_STATS, TOWER_STATS, getBuildingCost, getNodeUpgradeCost, getUpgradeNodeDef, type UpgradeNodeDef } from '../simulation/data';
import { getUnitUpgradeMultipliers } from '../simulation/GameState';
import { getPopupSafeY } from './SafeArea';

export interface UpgradeOption {
  choice: string;
  cost: { gold: number; wood: number; meat: number; deathEssence?: number; souls?: number };
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

// Per-race building suffixes: [melee, ranged, caster]
const RACE_BUILDING_SUFFIX: Record<Race, [string, string, string]> = {
  [Race.Crown]:    ['Barracks', 'Range', 'Chapel'],
  [Race.Horde]:    ['Camp', 'Post', 'Drum Pit'],
  [Race.Goblins]:  ['Hut', 'Shack', 'Den'],
  [Race.Oozlings]: ['Vat', 'Vat', 'Vat'],
  [Race.Demon]:    ['Pit', 'Spire', 'Shrine'],
  [Race.Deep]:     ['Grotto', 'Reef', 'Shrine'],
  [Race.Wild]:     ['Den', 'Nest', 'Hollow'],
  [Race.Geists]:   ['Crypt', 'Tomb', 'Sanctum'],
  [Race.Tenders]:  ['Grove', 'Bower', 'Garden'],
};

/** Get race-flavored building name, optionally reflecting the current upgrade tier.
 *  e.g. base Crown melee = "Swordsman Barracks", after T1 B upgrade = "Buccaneer Barracks" */
export function getRaceBuildingName(race: Race | undefined, type: BuildingType, upgradePath?: string[]): string {
  if (race != null) {
    const suffixes = RACE_BUILDING_SUFFIX[race];
    const spawnerTypes = [BuildingType.MeleeSpawner, BuildingType.RangedSpawner, BuildingType.CasterSpawner] as const;
    const spawnerIdx = spawnerTypes.indexOf(type as typeof spawnerTypes[number]);
    if (spawnerIdx >= 0 && suffixes) {
      const suffix = suffixes[spawnerIdx];
      // Use upgrade node name if upgraded, otherwise base unit name
      let unitName: string | undefined;
      if (upgradePath && upgradePath.length >= 2) {
        const lastNode = upgradePath[upgradePath.length - 1];
        const nodeDef = getUpgradeNodeDef(race, type, lastNode);
        if (nodeDef?.name) unitName = nodeDef.name;
      }
      if (!unitName) {
        unitName = UNIT_STATS[race]?.[type as typeof spawnerTypes[number]]?.name;
      }
      return unitName ? `${unitName} ${suffix}` : `${suffix}`;
    }
    // Tower upgrades have their own names
    if (type === BuildingType.Tower && upgradePath && upgradePath.length >= 2) {
      const lastNode = upgradePath[upgradePath.length - 1];
      const nodeDef = getUpgradeNodeDef(race, BuildingType.Tower, lastNode);
      if (nodeDef?.name) return nodeDef.name;
    }
  }
  switch (type) {
    case BuildingType.MeleeSpawner: return 'Melee Hut';
    case BuildingType.RangedSpawner: return 'Ranged Hut';
    case BuildingType.CasterSpawner: return 'Caster Hut';
    case BuildingType.Tower: return 'Tower';
    case BuildingType.HarvesterHut: return 'Harvester Hut';
    case BuildingType.Research: return 'Research';
    default: return type;
  }
}

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
    playerGold: number, playerWood: number, playerMeat: number,
    sprites?: SpriteLoader | null,
  ): void {
    if (this.targetBuildingId === null) return;

    const building = state.buildings.find(b => b.id === this.targetBuildingId);
    if (!building) { this.close(); return; }

    const race = state.players[building.playerId]?.race;
    if (!race) return;

    this.animTick++;

    const options = this.getUpgradeOptions(building, race, state);
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
    const { px: worldPx, py: worldPy } = tileToPixel(building.worldX + 0.5, building.worldY, camera.isometric);
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
    const label = getRaceBuildingName(race, building.type, building.upgradePath);
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
        const canAfford = playerGold >= opt.cost.gold && playerWood >= opt.cost.wood && playerMeat >= opt.cost.meat
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

    // Sell button (red) — show 50% refund of total invested resources
    const baseCost = getBuildingCost(race, building.type);
    let totalGold = baseCost.gold, totalWood = baseCost.wood, totalMeat = baseCost.meat;
    if (building.upgradePath.length >= 2) {
      const t1 = getNodeUpgradeCost(race, building.type, 1, building.upgradePath[1]);
      if (t1) { totalGold += t1.gold; totalWood += t1.wood; totalMeat += t1.meat; }
    }
    if (building.upgradePath.length >= 3) {
      const t2 = getNodeUpgradeCost(race, building.type, 2, building.upgradePath[2]);
      if (t2) { totalGold += t2.gold; totalWood += t2.wood; totalMeat += t2.meat; }
    }
    const refundGold = Math.floor(totalGold * 0.5);
    const refundWood = Math.floor(totalWood * 0.5);
    const refundMeat = Math.floor(totalMeat * 0.5);

    this.sellBtnRect = { x: footerX, y: footerY, w: footerBtnW, h: FOOTER_BTN_H };
    ui.drawBigRedButton(ctx, footerX, footerY, footerBtnW, FOOTER_BTN_H);
    ctx.textAlign = 'center';
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = '#fff';
    const sellTextY = footerY + FOOTER_BTN_H * 0.35;
    ctx.fillText('SELL', footerX + footerBtnW / 2, sellTextY);

    // Show refund amounts for each resource
    const refundItems: { icon: IconName; val: number; color: string }[] = [];
    if (refundGold > 0) refundItems.push({ icon: 'gold', val: refundGold, color: '#ffd740' });
    if (refundWood > 0) refundItems.push({ icon: 'wood', val: refundWood, color: '#81c784' });
    if (refundMeat > 0) refundItems.push({ icon: 'meat', val: refundMeat, color: '#e57373' });

    if (refundItems.length > 0) {
      ctx.font = 'bold 10px monospace';
      const iconSz = ICON_SIZE - 2;
      let refundTotalW = 0;
      for (const item of refundItems) {
        refundTotalW += iconSz + 1 + ctx.measureText(`+${item.val}`).width + 4;
      }
      refundTotalW -= 4;
      let rx = footerX + footerBtnW / 2 - refundTotalW / 2;
      const refundY = sellTextY + 13;
      for (const item of refundItems) {
        ui.drawIcon(ctx, item.icon, rx, refundY - iconSz + 2, iconSz);
        ctx.fillStyle = item.color;
        ctx.textAlign = 'left';
        ctx.fillText(`+${item.val}`, rx + iconSz + 1, refundY);
        rx += iconSz + 1 + ctx.measureText(`+${item.val}`).width + 4;
      }
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
    _spriteSize: number, iconSize: number, isMobile: boolean,
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
    const insetX = isMobile ? 8 : 16;
    const insetY = isMobile ? 8 : 14;
    const cx = x + insetX;
    const cy = y + insetY;
    const cw = w - insetX * 2;
    const ch = h - insetY * 2;

    // 4x4 grid layout:
    //   Col 0 (sprite col): ~25% width, rows 0-2
    //   Cols 1-3: name (row 0), description (rows 1-2), cost (row 3 full width centered)
    const rowH = Math.floor(ch / 4);
    const sprColW = isMobile ? Math.floor(cw * 0.20) : Math.floor(cw * 0.25);
    const textLeft = cx + sprColW + 4;
    const textW = cw - sprColW - 4;

    // Sprite area: left column, top 3 rows
    const sprAreaH = rowH * 3;
    const sprX = cx;
    const sprY = cy;
    const actualSprSize = Math.min(sprColW - 2, sprAreaH - 4);

    // Preview shows what the unit will look like AFTER this upgrade
    const nextTier = building.upgradePath.length; // base=1→tier1, tier1=2→tier2
    const tierScale = 1.0 + nextTier * 0.15;

    if (category && sprites) {
      const sprData = sprites.getUnitSprite(race, category, building.playerId, false, opt.choice);
      if (sprData) {
        const [img, def] = sprData;
        const frame = getSpriteFrame(Math.floor(this.animTick / 3), def);
        const spriteScale = def.scale ?? 1.0;
        const aspect = def.frameW / def.frameH;
        const dh = actualSprSize * spriteScale * tierScale * (def.heightScale ?? 1.0);
        const dw = actualSprSize * spriteScale * tierScale * aspect;
        const ax = def.anchorX ?? 0.5;
        const spriteCenterX = sprX + sprColW / 2;
        const drawX = spriteCenterX - dw * ax;
        const feetY = sprY + sprAreaH - 2;
        const drawY = feetY - dh * (def.groundY ?? 0.71);
        drawSpriteFrame(ctx, img, def, frame, drawX, drawY, dw, dh);
        if (nextTier >= 1) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.12 + nextTier * 0.06;
          drawSpriteFrame(ctx, img, def, frame, drawX, drawY, dw, dh);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
        }
      }
    } else if (building.type === BuildingType.Tower && sprites) {
      const nextPath = [...building.upgradePath, opt.choice];
      const towerImg = sprites.getBuildingSprite(BuildingType.Tower, building.playerId, false, race, nextPath);
      if (towerImg) {
        const aspect = towerImg.width / towerImg.height;
        const dh = actualSprSize * tierScale;
        const dw = dh * aspect;
        const drawX = sprX + (sprColW - dw) / 2;
        const drawY = sprY + (sprAreaH - dh);
        ctx.drawImage(towerImg, drawX, drawY, dw, dh);
      }
    }

    // Helper: draw text with dark shadow for contrast on blue button
    const shadowText = (text: string, tx: number, ty: number) => {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(text, tx + 1, ty + 1);
    };

    // Row 0: Name (top-right 3 cells)
    ctx.textAlign = 'left';
    const nameFontSize = isMobile ? 12 : 14;
    ctx.font = `bold ${nameFontSize}px monospace`;
    const name = opt.name ?? opt.choice;
    const nameLines = this.wordWrap(ctx, name, textW, 1);
    const nameY = cy + Math.round(rowH / 2) + Math.round(nameFontSize / 3);
    for (const line of nameLines) {
      shadowText(line, textLeft, nameY);
      ctx.fillStyle = canAfford ? '#fff' : '#aaa';
      ctx.fillText(line, textLeft, nameY);
    }

    // Rows 1-2: Description (right 3 cells, rows 1 and 2)
    const descFontSize = isMobile ? 10 : 12;
    ctx.font = `${descFontSize}px monospace`;
    const desc = opt.desc ?? '';
    const descLineH = descFontSize + 2;
    const descStartY = cy + rowH + Math.round(descFontSize * 0.9);
    const descAvailH = rowH * 2 - Math.round(descFontSize * 0.9) - 2; // space before cost row
    const maxDescLines = Math.min(3, Math.max(1, Math.floor(descAvailH / descLineH)));
    const descLines = this.wordWrap(ctx, desc, textW, maxDescLines);
    for (let i = 0; i < descLines.length; i++) {
      const lineY = descStartY + i * descLineH;
      shadowText(descLines[i], textLeft, lineY);
      ctx.fillStyle = canAfford ? '#e0e0e0' : '#888';
      ctx.fillText(descLines[i], textLeft, lineY);
    }

    // Row 3: Cost centered across full width
    const costFontSize = isMobile ? 11 : 12;
    ctx.font = `bold ${costFontSize}px monospace`;

    // Measure total cost width first for centering
    const costItems: { icon: IconName; val: number; color: string; dimColor: string }[] = [];
    if (opt.cost.gold > 0) costItems.push({ icon: 'gold', val: opt.cost.gold, color: '#ffd740', dimColor: '#665500' });
    if (opt.cost.wood > 0) costItems.push({ icon: 'wood', val: opt.cost.wood, color: '#81c784', dimColor: '#2e5530' });
    if (opt.cost.meat > 0) costItems.push({ icon: 'meat', val: opt.cost.meat, color: '#e57373', dimColor: '#6d2828' });
    if ((opt.cost.deathEssence ?? 0) > 0) costItems.push({ icon: 'ooze', val: opt.cost.deathEssence!, color: '#69f0ae', dimColor: '#1b5e20' });
    if ((opt.cost.souls ?? 0) > 0) costItems.push({ icon: 'souls', val: opt.cost.souls!, color: '#ce93d8', dimColor: '#4a148c' });

    let totalCostW = 0;
    for (const item of costItems) {
      totalCostW += iconSize + 1 + ctx.measureText(`${item.val}`).width + 6;
    }
    if (totalCostW > 0) totalCostW -= 6; // remove trailing gap

    const costRowY = cy + rowH * 3 + Math.round(rowH / 2) + Math.round(costFontSize / 3);
    let costX = cx + Math.round((cw - totalCostW) / 2);

    for (const item of costItems) {
      ctx.globalAlpha = canAfford ? 1 : 0.4;
      ui.drawIcon(ctx, item.icon, costX, costRowY - iconSize + 1, iconSize);
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
      shadowText(`${item.val}`, costX + iconSize + 1, costRowY);
      ctx.fillStyle = canAfford ? item.color : item.dimColor;
      ctx.fillText(`${item.val}`, costX + iconSize + 1, costRowY);
      costX += iconSize + ctx.measureText(`${item.val}`).width + 6;
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

  private getUpgradeOptions(building: BuildingState, race: Race, state?: GameState): UpgradeOption[] {
    if (building.type === BuildingType.HarvesterHut) return [];
    const tree = UPGRADE_TREES[race]?.[building.type];
    // Tenders Ironwood: tower upgrade costs shown at 50% discount
    const tendersTowerDiscount = building.type === BuildingType.Tower && race === Race.Tenders
      && state?.players[building.playerId]?.researchUpgrades.raceUpgrades['tenders_ability_4'];
    const lookup = (choice: string): UpgradeOption => {
      let cost = getNodeUpgradeCost(race, building.type, building.upgradePath.length, choice);
      if (tendersTowerDiscount) {
        cost = { gold: Math.floor(cost.gold * 0.5), wood: Math.floor(cost.wood * 0.5), meat: Math.floor(cost.meat * 0.5) };
      }
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
