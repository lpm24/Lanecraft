import { Camera } from '../rendering/Camera';
import { UIAssets } from '../rendering/UIAssets';
import { GameState } from '../simulation/types';
import { tileToPixel } from '../rendering/Projection';
import { getAllResearchUpgrades, getResearchUpgradeCost } from '../simulation/data';
import { getPopupSafeY } from './SafeArea';
import { drawStatVisualIcon, type StatVisualKey } from './StatBarUtils';

export type ResearchPopupAction =
  | { action: 'upgrade'; upgradeId: string }
  | { action: 'close' };

// Skill icon key for each upgrade — rendered from NhanceSpellIconsBundle with bordered frame
const SKILL_ICON_MAP: Record<string, string> = {
  // Universal attack/defense
  melee_atk: 'T_Icon_BloodCombat_13', melee_def: 'T_Icon_Gold_16',
  ranged_atk: 'T_Icon_BloodCombat_20', ranged_def: 'T_Icon_BloodCombat_01',
  caster_atk: 'T_Icon_Arcane_01', caster_def: 'T_Icon_Arcane_10',
  // Crown — golden/regal
  crown_melee_1: 'T_Icon_Fire_08', crown_melee_2: 'T_Icon_Fire_19',
  crown_ranged_1: 'T_Icon_Frost_03', crown_ranged_2: 'T_Icon_BloodCombat_04',
  crown_caster_1: 'T_Icon_Frost_20', crown_caster_2: 'T_Icon_Nature_15',
  // Horde — red/brutal
  horde_melee_1: 'T_Icon_BloodCombat_17', horde_melee_2: 'T_Icon_Gold_01',
  horde_ranged_1: 'T_Icon_BloodCombat_14', horde_ranged_2: 'T_Icon_Fire_15',
  horde_caster_1: 'T_Icon_Unholy_08', horde_caster_2: 'T_Icon_BloodCombat_12',
  // Goblins — green/fire
  goblins_melee_1: 'T_Icon_Fire_18', goblins_melee_2: 'T_Icon_Fire_16',
  goblins_ranged_1: 'T_Icon_Fire_03', goblins_ranged_2: 'T_Icon_Unholy_02',
  goblins_caster_1: 'T_Icon_Fire_02', goblins_caster_2: 'T_Icon_Nature_06',
  // Oozlings — slime/unholy
  oozlings_melee_1: 'T_Icon_Shadow_14', oozlings_melee_2: 'T_Icon_Unholy_03',
  oozlings_ranged_1: 'T_Icon_Unholy_01', oozlings_ranged_2: 'T_Icon_Nature_04',
  oozlings_caster_1: 'T_Icon_Unholy_10', oozlings_caster_2: 'T_Icon_Unholy_11',
  // Demon — fire/dark
  demon_melee_1: 'T_Icon_Fire_13', demon_melee_2: 'T_Icon_Shadow_05',
  demon_ranged_1: 'T_Icon_Fire_01', demon_ranged_2: 'T_Icon_Fire_11',
  demon_caster_1: 'T_Icon_Fire_07', demon_caster_2: 'T_Icon_Fire_14',
  // Deep — frost/ice
  deep_melee_1: 'T_Icon_Frost_13', deep_melee_2: 'T_Icon_Frost_18',
  deep_ranged_1: 'T_Icon_Frost_03', deep_ranged_2: 'T_Icon_Frost_17',
  deep_caster_1: 'T_Icon_Frost_10', deep_caster_2: 'T_Icon_Frost_20',
  // Wild — nature/beast
  wild_melee_1: 'T_Icon_Tech_14', wild_melee_2: 'T_Icon_Shadow_18',
  wild_ranged_1: 'T_Icon_Nature_13', wild_ranged_2: 'T_Icon_BloodCombat_09',
  wild_caster_1: 'T_Icon_Nature_11', wild_caster_2: 'T_Icon_Energy_06',
  // Geists — shadow/unholy undead
  geists_melee_1: 'T_Icon_Shadow_17', geists_melee_2: 'T_Icon_Shadow_11',
  geists_ranged_1: 'T_Icon_Shadow_15', geists_ranged_2: 'T_Icon_Shadow_03',
  geists_caster_1: 'T_Icon_Unholy_04', geists_caster_2: 'T_Icon_Unholy_14',
  // Tenders — nature/healing
  tenders_melee_1: 'T_Icon_Nature_02', tenders_melee_2: 'T_Icon_Nature_13',
  tenders_ranged_1: 'T_Icon_Nature_19', tenders_ranged_2: 'T_Icon_Nature_17',
  tenders_caster_1: 'T_Icon_Nature_11', tenders_caster_2: 'T_Icon_Nature_07',
  // Race ability upgrades
  crown_ability_1: 'T_Icon_Energy_14', crown_ability_2: 'T_Icon_Gold_18', crown_ability_3: 'T_Icon_Gold_06', crown_ability_4: 'T_Icon_Nature_09',
  horde_ability_1: 'T_Icon_Gold_04', horde_ability_2: 'T_Icon_Gold_19', horde_ability_3: 'T_Icon_Gold_02', horde_ability_4: 'T_Icon_Gold_05',
  goblins_ability_1: 'T_Icon_Nature_08', goblins_ability_2: 'T_Icon_Energy_01', goblins_ability_3: 'T_Icon_Frost_07', goblins_ability_4: 'T_Icon_Arcane_18',
  oozlings_ability_1: 'T_Icon_Elements_09', oozlings_ability_2: 'T_Icon_Arcane_06', oozlings_ability_3: 'T_Icon_Shadow_06', oozlings_ability_4: 'T_Icon_Nature_10',
  demon_ability_1: 'T_Icon_Fire_10', demon_ability_2: 'T_Icon_Fire_04', demon_ability_3: 'T_Icon_Tech_13', demon_ability_4: 'T_Icon_Arcane_19',
  deep_ability_1: 'T_Icon_Elements_16', deep_ability_2: 'T_Icon_Frost_15', deep_ability_3: 'T_Icon_Frost_19', deep_ability_4: 'T_Icon_Frost_08',
  wild_ability_1: 'T_Icon_Nature_20', wild_ability_2: 'T_Icon_BloodCombat_16', wild_ability_3: 'T_Icon_Nature_01', wild_ability_4: 'T_Icon_BloodCombat_19',
  geists_ability_1: 'T_Icon_Shadow_20', geists_ability_2: 'T_Icon_Unholy_19', geists_ability_3: 'T_Icon_Unholy_16', geists_ability_4: 'T_Icon_Shadow_13',
  tenders_ability_1: 'T_Icon_Nature_14', tenders_ability_2: 'T_Icon_Nature_05', tenders_ability_3: 'T_Icon_Elements_12', tenders_ability_4: 'T_Icon_Tech_01',
};

type TabCategory = 'melee' | 'ranged' | 'caster' | 'ability';

const TABS: { label: string; category: TabCategory }[] = [
  { label: 'MELEE', category: 'melee' },
  { label: 'RANGED', category: 'ranged' },
  { label: 'CASTER', category: 'caster' },
  { label: 'RACE', category: 'ability' },
];

export class ResearchPopup {
  private targetBuildingId: number | null = null;
  private animTick = 0;
  private rect = { x: 0, y: 0, w: 0, h: 0 };
  private upgradeBtnRects: { x: number; y: number; w: number; h: number; upgradeId: string }[] = [];
  private tabBtnRects: { x: number; y: number; w: number; h: number; index: number }[] = [];
  private closeBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  private activeTab = 0; // persists across open/close

  open(buildingId: number): void {
    this.targetBuildingId = buildingId;
    this.animTick = 0;
  }

  close(): void { this.targetBuildingId = null; }
  isOpen(): boolean { return this.targetBuildingId !== null; }
  getBuildingId(): number | null { return this.targetBuildingId; }

  containsPoint(cx: number, cy: number): boolean {
    const r = this.rect;
    return cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h;
  }

  handleClick(cx: number, cy: number): ResearchPopupAction | null {
    if (!this.containsPoint(cx, cy)) return null;
    if (this.hitTest(cx, cy, this.closeBtnRect)) return { action: 'close' };
    // Tab clicks
    for (const tab of this.tabBtnRects) {
      if (this.hitTest(cx, cy, tab)) {
        this.activeTab = tab.index;
        return null; // consumed click, no action to emit
      }
    }
    for (const btn of this.upgradeBtnRects) {
      if (this.hitTest(cx, cy, btn)) return { action: 'upgrade', upgradeId: btn.upgradeId };
    }
    return null;
  }

  private hitTest(cx: number, cy: number, r: { x: number; y: number; w: number; h: number }): boolean {
    const pad = 6;
    return r.w > 0 && cx >= r.x - pad && cx < r.x + r.w + pad && cy >= r.y - pad && cy < r.y + r.h + pad;
  }

  draw(
    ctx: CanvasRenderingContext2D, camera: Camera, state: GameState,
    ui: UIAssets, canvasW: number, canvasH: number,
    playerGold: number, playerWood: number, playerMeat: number, playerMana = 0,
  ): void {
    if (this.targetBuildingId === null) return;
    const building = state.buildings.find(b => b.id === this.targetBuildingId);
    if (!building) { this.close(); return; }
    const player = state.players[building.playerId];
    if (!player) return;

    this.animTick++;
    const race = player.race;
    const bu = player.researchUpgrades;
    const allDefs = getAllResearchUpgrades(race);

    const isMobile = canvasW < 600;
    const PAD = isMobile ? 8 : 10;
    const CARD_W = Math.min(canvasW - 24, isMobile ? 300 : 320);
    const CARD_H = isMobile ? 72 : 80;
    const HEADER_H = isMobile ? 28 : 32;
    const TAB_H = isMobile ? 28 : 32;
    const ROWS = 4;
    const CLOSE_SIZE = 22;

    const popupW = PAD * 2 + CARD_W;
    const popupH = HEADER_H + TAB_H + PAD + CARD_H * ROWS + PAD * (ROWS - 1) + PAD;
    const panelPadW = Math.round(popupW * 0.05);
    const panelPadH = Math.round(popupH * 0.05);

    // Position above building
    const { px: worldPx, py: worldPy } = tileToPixel(building.worldX + 0.5, building.worldY, camera.isometric);
    const screen = camera.worldToScreen(worldPx, worldPy);
    let px = Math.round(screen.x - popupW / 2);
    let py = Math.round(screen.y - popupH - 20);
    const safeY = getPopupSafeY(canvasW, canvasH);
    px = Math.max(4, Math.min(canvasW - popupW - 4, px));
    py = Math.max(safeY.top, Math.min(safeY.bottom - popupH, py));
    this.rect = { x: px - panelPadW, y: py - panelPadH, w: popupW + panelPadW * 2, h: popupH + panelPadH * 2 };

    this.upgradeBtnRects = [];
    this.tabBtnRects = [];

    // Scale-in animation
    const t = Math.min(1, this.animTick / 6);
    const sc = 0.8 + 0.2 * t;
    ctx.save();
    ctx.globalAlpha = t;
    ctx.translate(px + popupW / 2, py + popupH / 2);
    ctx.scale(sc, sc);
    ctx.translate(-(px + popupW / 2), -(py + popupH / 2));

    // Background panel (oversized per 9-slice convention)
    if (!ui.drawWoodTable(ctx, px - panelPadW - 6, py - panelPadH - 6, popupW + panelPadW * 2 + 12, popupH + panelPadH * 2 + 12)) {
      ctx.fillStyle = 'rgba(30, 20, 10, 0.92)';
      ctx.beginPath();
      ctx.roundRect(px - panelPadW, py - panelPadH, popupW + panelPadW * 2, popupH + panelPadH * 2, 8);
      ctx.fill();
      ctx.strokeStyle = '#8b6914';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Header
    ctx.fillStyle = '#e8d5b7';
    ctx.font = `bold ${isMobile ? 12 : 14}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('RESEARCH', px + popupW / 2, py + HEADER_H - 6);

    // Close button (top right, inside popup) — red round button with icon_09
    const closeSize = Math.max(32, CLOSE_SIZE);
    const closeBtnX = px + popupW - closeSize - 2;
    const closeBtnY = py + 2;
    this.closeBtnRect = { x: closeBtnX, y: closeBtnY, w: closeSize, h: closeSize };
    ui.drawSmallRedRoundButton(ctx, closeBtnX, closeBtnY, closeSize);
    ui.drawIcon(ctx, 'close', closeBtnX + closeSize / 2 - 10, closeBtnY + closeSize / 2 - 10, 20);

    // --- Tab bar ---
    const tabY = py + HEADER_H;
    const tabCount = TABS.length;
    const tabW = Math.floor((popupW - PAD * 2) / tabCount);
    const tabFontSize = isMobile ? 9 : 11;
    for (let i = 0; i < tabCount; i++) {
      const tx = px + PAD + i * tabW;
      const isActive = i === this.activeTab;

      // Tab background
      ctx.fillStyle = isActive ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.2)';
      ctx.beginPath();
      ctx.roundRect(tx, tabY, tabW - 2, TAB_H, [4, 4, 0, 0]);
      ctx.fill();

      // Active indicator line
      if (isActive) {
        ctx.fillStyle = '#ffd54f';
        ctx.fillRect(tx + 4, tabY + TAB_H - 3, tabW - 10, 3);
      }

      // Tab label
      ctx.fillStyle = isActive ? '#ffd54f' : '#999';
      ctx.font = `bold ${tabFontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(TABS[i].label, tx + tabW / 2, tabY + TAB_H / 2 + tabFontSize / 3);

      this.tabBtnRects.push({ x: tx, y: tabY, w: tabW - 2, h: TAB_H, index: i });
    }

    // --- Upgrade cards for active tab ---
    const cat = TABS[this.activeTab].category;
    const catDefs = allDefs.filter(d => d.category === cat);
    let rowItems: (typeof catDefs[0] | undefined)[];
    if (cat === 'ability') {
      // Race ability tab: up to 4 one-shot upgrades
      rowItems = catDefs.filter(d => d.type === 'race_ability');
    } else {
      const atkDef = catDefs.find(d => d.type === 'attack');
      const defDef = catDefs.find(d => d.type === 'defense');
      const raceSpecials = catDefs.filter(d => d.type === 'race_special');
      rowItems = [atkDef, defDef, raceSpecials[0], raceSpecials[1]];
    }

    const gridY = tabY + TAB_H + PAD;
    const fontSize = isMobile ? 11 : 12;
    const smallFont = isMobile ? 10 : 11;
    const costIconSz = isMobile ? 8 : 9;
    const frameSize = isMobile ? 30 : 40;
    const framePad = 3;

    for (let r = 0; r < ROWS; r++) {
      const def = rowItems[r];
      if (!def) continue;

      const bx = px + PAD;
      const by = gridY + r * (CARD_H + PAD);
      const bw = CARD_W;
      const bh = CARD_H;

      // Get current level
      let level = 0;
      if (def.id === 'melee_atk') level = bu.meleeAtkLevel;
      else if (def.id === 'melee_def') level = bu.meleeDefLevel;
      else if (def.id === 'ranged_atk') level = bu.rangedAtkLevel;
      else if (def.id === 'ranged_def') level = bu.rangedDefLevel;
      else if (def.id === 'caster_atk') level = bu.casterAtkLevel;
      else if (def.id === 'caster_def') level = bu.casterDefLevel;

      const isOwned = def.oneShot && bu.raceUpgrades[def.id];
      const cost = getResearchUpgradeCost(def.id, level, race);
      const playerEssence = player.deathEssence ?? 0;
      const playerSouls = player.souls ?? 0;
      const canAfford = playerGold >= cost.gold && playerWood >= cost.wood && playerMeat >= cost.meat
        && (cost.mana === undefined || playerMana >= cost.mana)
        && ((cost.deathEssence ?? 0) <= 0 || playerEssence >= (cost.deathEssence ?? 0))
        && ((cost.souls ?? 0) <= 0 || playerSouls >= (cost.souls ?? 0));

      // Card background
      ctx.fillStyle = isOwned ? 'rgba(76, 175, 80, 0.3)' : canAfford ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.25)';
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, 4);
      ctx.fill();
      ctx.strokeStyle = isOwned ? '#66bb6a' : canAfford ? '#e8d5b7' : '#666';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Skill icon with bordered frame
      const skillKey = SKILL_ICON_MAP[def.id];
      const frameX = bx + 6;
      const frameY = by + Math.round((bh - frameSize) / 2);
      const textColor = isOwned ? '#66bb6a' : canAfford ? '#fff' : '#999';

      {
        // Dark rounded background + clipped icon (with fallback "?" if key missing)
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(frameX, frameY, frameSize, frameSize, 5);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fill();
        ctx.clip();
        ctx.globalAlpha = isOwned ? 1 : canAfford ? 1 : 0.4;
        if (!skillKey || !ui.drawSkillIcon(ctx, skillKey, frameX + framePad, frameY + framePad, frameSize - framePad * 2)) {
          // Fallback: draw "?" glyph
          ctx.fillStyle = '#888';
          ctx.font = `bold ${frameSize * 0.6}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('?', frameX + frameSize / 2, frameY + frameSize / 2);
          ctx.textBaseline = 'alphabetic';
        }
        ctx.restore();
        ctx.globalAlpha = 1;
        // Border
        ctx.strokeStyle = isOwned ? '#66bb6a' : canAfford ? '#c8a84e' : '#555';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(frameX, frameY, frameSize, frameSize, 5);
        ctx.stroke();
      }

      const textX = skillKey ? frameX + frameSize + 8 : bx + 4;
      // Strip category prefix from name
      let displayName = def.name;
      for (const prefix of ['Melee ', 'Ranged ', 'Caster ']) {
        if (displayName.startsWith(prefix)) { displayName = displayName.slice(prefix.length); break; }
      }
      ctx.fillStyle = textColor;
      ctx.font = `bold ${fontSize}px monospace`;
      ctx.textAlign = 'left';
      ctx.fillText(displayName, textX, by + 16);

      // Level or checkmark (right-aligned)
      if (def.oneShot) {
        if (isOwned) {
          ctx.fillStyle = '#66bb6a';
          ctx.font = `bold ${fontSize + 2}px monospace`;
          ctx.textAlign = 'right';
          ctx.fillText('\u2713', bx + bw - 4, by + 14);
        }
      } else {
        ctx.fillStyle = '#ffd54f';
        ctx.font = `${fontSize}px monospace`;
        ctx.textAlign = 'right';
        ctx.fillText(`Lv${level}`, bx + bw - 4, by + 14);
      }

      // Row 2-3: Description with word-wrap (up to 3 lines with wider cards)
      ctx.fillStyle = '#c8b898';
      ctx.font = `${smallFont}px monospace`;
      ctx.textAlign = 'left';
      const descCharW = smallFont * 0.6;
      const descMaxW = bw - (textX - bx) - 4;
      const descMaxChars = Math.floor(descMaxW / descCharW);
      const desc = def.desc;
      const descLines = this.wrapText(desc, descMaxChars, 3);
      for (let li = 0; li < descLines.length; li++) {
        this.drawRichLine(ctx, ui, descLines[li], textX, by + 30 + li * (smallFont + 2), smallFont);
      }

      // Bottom row: Cost with icons
      if (!isOwned) {
        const costY = by + bh - 6;
        let costX = textX;
        ctx.font = `${smallFont}px monospace`;

        if (cost.gold > 0) {
          if (!ui.drawIcon(ctx, 'gold', costX, costY - costIconSz + 1, costIconSz)) {
            ctx.fillStyle = '#ffd700';
            ctx.beginPath(); ctx.arc(costX + costIconSz / 2, costY - costIconSz / 2, costIconSz / 2, 0, Math.PI * 2); ctx.fill();
          }
          costX += costIconSz + 1;
          ctx.fillStyle = canAfford || playerGold >= cost.gold ? '#ffd54f' : '#ff6666';
          ctx.textAlign = 'left';
          ctx.fillText(`${cost.gold}`, costX, costY);
          costX += ctx.measureText(`${cost.gold}`).width + 4;
        }
        if (cost.wood > 0) {
          if (!ui.drawIcon(ctx, 'wood', costX, costY - costIconSz + 1, costIconSz)) {
            ctx.fillStyle = '#8bc34a';
            ctx.beginPath(); ctx.arc(costX + costIconSz / 2, costY - costIconSz / 2, costIconSz / 2, 0, Math.PI * 2); ctx.fill();
          }
          costX += costIconSz + 1;
          ctx.fillStyle = canAfford || playerWood >= cost.wood ? '#a5d6a7' : '#ff6666';
          ctx.textAlign = 'left';
          ctx.fillText(`${cost.wood}`, costX, costY);
          costX += ctx.measureText(`${cost.wood}`).width + 4;
        }
        if (cost.meat > 0) {
          if (!ui.drawIcon(ctx, 'meat', costX, costY - costIconSz + 1, costIconSz)) {
            ctx.fillStyle = '#ef9a9a';
            ctx.beginPath(); ctx.arc(costX + costIconSz / 2, costY - costIconSz / 2, costIconSz / 2, 0, Math.PI * 2); ctx.fill();
          }
          costX += costIconSz + 1;
          ctx.fillStyle = canAfford || playerMeat >= cost.meat ? '#ef9a9a' : '#ff6666';
          ctx.textAlign = 'left';
          ctx.fillText(`${cost.meat}`, costX, costY);
          costX += ctx.measureText(`${cost.meat}`).width + 4;
        }
        if (cost.mana !== undefined && cost.mana > 0) {
          ui.drawIcon(ctx, 'mana', costX, costY - costIconSz + 1, costIconSz);
          costX += costIconSz + 1;
          ctx.fillStyle = canAfford || playerMana >= cost.mana ? '#b39ddb' : '#ff6666';
          ctx.textAlign = 'left';
          ctx.fillText(`${cost.mana}`, costX, costY);
          costX += ctx.measureText(`${cost.mana}`).width + 4;
        }
        if ((cost.deathEssence ?? 0) > 0) {
          ui.drawIcon(ctx, 'ooze', costX, costY - costIconSz + 1, costIconSz);
          costX += costIconSz + 1;
          ctx.fillStyle = canAfford || playerEssence >= cost.deathEssence! ? '#69f0ae' : '#ff6666';
          ctx.textAlign = 'left';
          ctx.fillText(`${cost.deathEssence}`, costX, costY);
          costX += ctx.measureText(`${cost.deathEssence}`).width + 4;
        }
        if ((cost.souls ?? 0) > 0) {
          ui.drawIcon(ctx, 'souls', costX, costY - costIconSz + 1, costIconSz);
          costX += costIconSz + 1;
          ctx.fillStyle = canAfford || playerSouls >= cost.souls! ? '#ce93d8' : '#ff6666';
          ctx.textAlign = 'left';
          ctx.fillText(`${cost.souls}`, costX, costY);
        }

        // Effect preview for scaling upgrades (right-aligned on cost row)
        if (!def.oneShot) {
          ctx.fillStyle = '#aaa';
          ctx.font = `${smallFont}px monospace`;
          ctx.textAlign = 'right';
          if (def.type === 'attack') {
            ctx.fillText(`\u2192 ${Math.round(Math.pow(1.25, level + 1) * 100)}%`, bx + bw - 4, costY);
          } else if (def.type === 'defense') {
            const dr = 1 - 1 / (1 + 0.06 * (level + 1));
            ctx.fillText(`\u2192 ${Math.round(dr * 100)}%`, bx + bw - 4, costY);
          }
        }
      }

      // Register hit area
      if (!isOwned) {
        this.upgradeBtnRects.push({ x: bx, y: by, w: bw, h: bh, upgradeId: def.id });
      }
    }

    ctx.restore();
  }

  /** Draw a line of text that may contain {icon} markers inline. */
  private drawRichLine(ctx: CanvasRenderingContext2D, ui: UIAssets, line: string, x: number, y: number, fontSize: number): void {
    const iconSize = fontSize;
    const parts = line.split(/(\{[a-z-]+\})/);
    let cx = x;
    for (const part of parts) {
      const iconMatch = part.match(/^\{([a-z-]+)\}$/);
      if (iconMatch) {
        const key = iconMatch[1] as StatVisualKey;
        drawStatVisualIcon(ctx, ui, key, cx, y - fontSize + 2, iconSize);
        cx += iconSize + 2;
      } else if (part) {
        ctx.fillStyle = '#c8b898';
        ctx.fillText(part, cx, y);
        cx += ctx.measureText(part).width;
      }
    }
  }

  private wrapText(text: string, maxChars: number, maxLines: number): string[] {
    if (text.length <= maxChars) return [text];
    const lines: string[] = [];
    let remaining = text;
    for (let i = 0; i < maxLines && remaining.length > 0; i++) {
      if (remaining.length <= maxChars || i === maxLines - 1) {
        const line = remaining.length > maxChars ? remaining.slice(0, maxChars - 2) + '..' : remaining;
        lines.push(line);
        break;
      }
      const chunk = remaining.slice(0, maxChars);
      const breakAt = chunk.lastIndexOf(' ');
      const cut = breakAt > 0 ? breakAt : maxChars;
      lines.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut).trimStart();
    }
    return lines;
  }
}
