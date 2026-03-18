import { Camera } from '../rendering/Camera';
import { UIAssets } from '../rendering/UIAssets';
import { GameState, TILE_SIZE } from '../simulation/types';
import { getAllResearchUpgrades, getResearchUpgradeCost } from '../simulation/data';

export type ResearchPopupAction =
  | { action: 'upgrade'; upgradeId: string }
  | { action: 'close' };

// Icons for each upgrade (keyed by upgrade id)
const UPGRADE_ICONS: Record<string, string> = {
  // Universal
  melee_atk: '\u2694', ranged_atk: '\u2694', caster_atk: '\u2694',
  melee_def: '\u{1F6E1}', ranged_def: '\u{1F6E1}', caster_def: '\u{1F6E1}',
  // Crown
  crown_melee_1: '\u{1F6E1}', crown_melee_2: '\u{1F451}',
  crown_ranged_1: '\u{1F3AF}', crown_ranged_2: '\u{1F3F9}',
  crown_caster_1: '\u{1F48E}', crown_caster_2: '\u2764',
  // Horde
  horde_melee_1: '\u{1F4A2}', horde_melee_2: '\u{1F9B4}',
  horde_ranged_1: '\u2744', horde_ranged_2: '\u{1F4A3}',
  horde_caster_1: '\u{1F941}', horde_caster_2: '\u{1F3BA}',
  // Goblins
  goblins_melee_1: '\u{1F5E1}', goblins_melee_2: '\u{1F3C3}',
  goblins_ranged_1: '\u{1F525}', goblins_ranged_2: '\u{1F4A5}',
  goblins_caster_1: '\u{1F52E}', goblins_caster_2: '\u2601',
  // Oozlings
  oozlings_melee_1: '\u{1F4A5}', oozlings_melee_2: '\u{1F9EC}',
  oozlings_ranged_1: '\u2620', oozlings_ranged_2: '\u{1F7E2}',
  oozlings_caster_1: '\u{1F517}', oozlings_caster_2: '\u2747',
  // Demon
  demon_melee_1: '\u{1F525}', demon_melee_2: '\u{1F47F}',
  demon_ranged_1: '\u2604', demon_ranged_2: '\u{1F441}',
  demon_caster_1: '\u{1F32B}', demon_caster_2: '\u2668',
  // Deep
  deep_melee_1: '\u{1F30A}', deep_melee_2: '\u{1F4A7}',
  deep_ranged_1: '\u2744', deep_ranged_2: '\u2693',
  deep_caster_1: '\u2728', deep_caster_2: '\u{1F6E1}',
  // Wild
  wild_melee_1: '\u26A1', wild_melee_2: '\u{1F43A}',
  wild_ranged_1: '\u2620', wild_ranged_2: '\u{1F3AF}',
  wild_caster_1: '\u{1F32A}', wild_caster_2: '\u{1F43A}',
  // Geists
  geists_melee_1: '\u270B', geists_melee_2: '\u{1F47B}',
  geists_ranged_1: '\u{1F480}', geists_ranged_2: '\u{1F47B}',
  geists_caster_1: '\u{1F4A0}', geists_caster_2: '\u{1F480}',
  // Tenders
  tenders_melee_1: '\u{1F333}', tenders_melee_2: '\u{1F335}',
  tenders_ranged_1: '\u{1F4A7}', tenders_ranged_2: '\u{1F331}',
  tenders_caster_1: '\u{1F33C}', tenders_caster_2: '\u{1F495}',
};

export class ResearchPopup {
  private targetBuildingId: number | null = null;
  private animTick = 0;
  private rect = { x: 0, y: 0, w: 0, h: 0 };
  private upgradeBtnRects: { x: number; y: number; w: number; h: number; upgradeId: string }[] = [];
  private closeBtnRect = { x: 0, y: 0, w: 0, h: 0 };

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
    playerGold: number, playerWood: number, playerStone: number, playerMana = 0,
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
    const PAD = isMobile ? 6 : 10;
    // 30% taller rows, 10% wider columns
    const COL_W = isMobile ? 121 : 141;
    const ROW_H = isMobile ? 55 : 62;
    const HEADER_H = isMobile ? 28 : 34;
    const COLS = 3;
    const ROWS = 4;
    const CLOSE_SIZE = 22;

    const popupW = PAD * 2 + COL_W * COLS + PAD * (COLS - 1);
    const popupH = HEADER_H + PAD + ROW_H * ROWS + PAD * (ROWS - 1) + PAD;
    // Background panel: 10% taller and wider on top of content size
    const panelPadW = Math.round(popupW * 0.05);
    const panelPadH = Math.round(popupH * 0.05);

    // Position above building
    const worldPx = building.worldX * TILE_SIZE + TILE_SIZE / 2;
    const worldPy = building.worldY * TILE_SIZE;
    const screen = camera.worldToScreen(worldPx, worldPy);
    let px = Math.round(screen.x - popupW / 2);
    let py = Math.round(screen.y - popupH - 20);
    px = Math.max(4, Math.min(canvasW - popupW - 4, px));
    py = Math.max(4, Math.min(canvasH - popupH - 4, py));
    this.rect = { x: px - panelPadW, y: py - panelPadH, w: popupW + panelPadW * 2, h: popupH + panelPadH * 2 };

    this.upgradeBtnRects = [];

    // Scale-in animation
    const t = Math.min(1, this.animTick / 6);
    const sc = 0.8 + 0.2 * t;
    ctx.save();
    ctx.globalAlpha = t;
    ctx.translate(px + popupW / 2, py + popupH / 2);
    ctx.scale(sc, sc);
    ctx.translate(-(px + popupW / 2), -(py + popupH / 2));

    // Background panel (10% oversized)
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

    // Close X button — top-right corner
    const closeX = px + popupW - CLOSE_SIZE + 2;
    const closeY = py - 2;
    ctx.fillStyle = 'rgba(180, 40, 40, 0.7)';
    ctx.beginPath();
    ctx.arc(closeX + CLOSE_SIZE / 2, closeY + CLOSE_SIZE / 2, CLOSE_SIZE / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ff6b6b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const cx0 = closeX + CLOSE_SIZE / 2, cy0 = closeY + CLOSE_SIZE / 2;
    const xr = 5;
    ctx.moveTo(cx0 - xr, cy0 - xr); ctx.lineTo(cx0 + xr, cy0 + xr);
    ctx.moveTo(cx0 + xr, cy0 - xr); ctx.lineTo(cx0 - xr, cy0 + xr);
    ctx.stroke();
    this.closeBtnRect = { x: closeX, y: closeY, w: CLOSE_SIZE, h: CLOSE_SIZE };

    // Column headers
    const colLabels = ['MELEE', 'RANGED', 'CASTER'];
    ctx.font = `bold ${isMobile ? 9 : 10}px monospace`;
    for (let c = 0; c < COLS; c++) {
      const colCx = px + PAD + c * (COL_W + PAD) + COL_W / 2;
      ctx.fillStyle = '#d4a574';
      ctx.fillText(colLabels[c], colCx, py + HEADER_H + 8);
    }

    const gridY = py + HEADER_H + PAD + 12;
    const categories: ('melee' | 'ranged' | 'caster')[] = ['melee', 'ranged', 'caster'];
    const fontSize = isMobile ? 8 : 9;
    const smallFont = isMobile ? 7 : 8;
    const iconSize = isMobile ? 11 : 13;
    const iconFont = `${iconSize}px sans-serif`;
    const costIconSz = isMobile ? 8 : 9;

    for (let c = 0; c < COLS; c++) {
      const cat = categories[c];
      const catDefs = allDefs.filter(d => d.category === cat);
      const atkDef = catDefs.find(d => d.type === 'attack');
      const defDef = catDefs.find(d => d.type === 'defense');
      const raceSpecials = catDefs.filter(d => d.type === 'race_special');
      const colX = px + PAD + c * (COL_W + PAD);
      const rowItems = [atkDef, defDef, raceSpecials[0], raceSpecials[1]];

      for (let r = 0; r < ROWS; r++) {
        const def = rowItems[r];
        if (!def) continue;

        const bx = colX;
        const by = gridY + r * (ROW_H + PAD);
        const bw = COL_W;
        const bh = ROW_H;

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
        const canAfford = playerGold >= cost.gold && playerWood >= cost.wood && playerStone >= cost.stone
          && (cost.mana === undefined || playerMana >= cost.mana)
          && ((cost.deathEssence ?? 0) <= 0 || playerEssence >= (cost.deathEssence ?? 0));

        // Button background
        ctx.fillStyle = isOwned ? 'rgba(76, 175, 80, 0.3)' : canAfford ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.25)';
        ctx.beginPath();
        ctx.roundRect(bx, by, bw, bh, 4);
        ctx.fill();
        ctx.strokeStyle = isOwned ? '#66bb6a' : canAfford ? '#e8d5b7' : '#666';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Row 1: Icon + Name (no "Melee"/"Ranged" prefix — column says it) + Level/checkmark
        const icon = UPGRADE_ICONS[def.id] ?? '';
        const textColor = isOwned ? '#66bb6a' : canAfford ? '#fff' : '#999';
        let nameX = bx + 4;
        if (icon) {
          ctx.font = iconFont;
          ctx.textAlign = 'left';
          ctx.fillStyle = textColor;
          ctx.fillText(icon, bx + 3, by + 14);
          nameX = bx + iconSize + 6;
        }
        // Strip category prefix from name (e.g. "Melee Attack" → "Attack", "Ranged Defense" → "Defense")
        let displayName = def.name;
        for (const prefix of ['Melee ', 'Ranged ', 'Caster ']) {
          if (displayName.startsWith(prefix)) { displayName = displayName.slice(prefix.length); break; }
        }
        ctx.fillStyle = textColor;
        ctx.font = `bold ${fontSize}px monospace`;
        ctx.textAlign = 'left';
        const maxName = bw - (nameX - bx) - 30;
        const charW = fontSize * 0.6;
        const maxChars = Math.floor(maxName / charW);
        const nameText = displayName.length > maxChars ? displayName.slice(0, maxChars - 1) + '..' : displayName;
        ctx.fillText(nameText, nameX, by + 13);

        // Level or checkmark (right-aligned)
        if (def.oneShot) {
          if (isOwned) {
            ctx.fillStyle = '#66bb6a';
            ctx.font = `bold ${fontSize + 2}px monospace`;
            ctx.textAlign = 'right';
            ctx.fillText('\u2713', bx + bw - 4, by + 13);
          }
        } else {
          ctx.fillStyle = '#ffd54f';
          ctx.font = `${smallFont}px monospace`;
          ctx.textAlign = 'right';
          ctx.fillText(`Lv${level}`, bx + bw - 4, by + 13);
        }

        // Row 2: Description (more space now with taller tiles)
        ctx.fillStyle = '#c8b898';
        ctx.font = `${smallFont}px monospace`;
        ctx.textAlign = 'left';
        const descCharW = smallFont * 0.6;
        const descMaxChars = Math.floor((bw - 8) / descCharW);
        const desc = def.desc;
        if (desc.length <= descMaxChars) {
          ctx.fillText(desc, bx + 4, by + 26);
        } else {
          // Word-wrap to 2 lines
          const line1 = desc.slice(0, descMaxChars);
          const breakAt = line1.lastIndexOf(' ');
          const l1 = breakAt > 0 ? desc.slice(0, breakAt) : line1;
          const l2raw = desc.slice(l1.length).trimStart();
          const l2 = l2raw.length > descMaxChars ? l2raw.slice(0, descMaxChars - 1) + '..' : l2raw;
          ctx.fillText(l1, bx + 4, by + 26);
          ctx.fillText(l2, bx + 4, by + 26 + smallFont + 2);
        }

        // Row 3: Cost with icons (bottom of tile)
        if (!isOwned) {
          const costY = by + bh - 6;
          let costX = bx + 4;
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
          if (cost.stone > 0) {
            if (!ui.drawIcon(ctx, 'meat', costX, costY - costIconSz + 1, costIconSz)) {
              ctx.fillStyle = '#ef9a9a';
              ctx.beginPath(); ctx.arc(costX + costIconSz / 2, costY - costIconSz / 2, costIconSz / 2, 0, Math.PI * 2); ctx.fill();
            }
            costX += costIconSz + 1;
            ctx.fillStyle = canAfford || playerStone >= cost.stone ? '#ef9a9a' : '#ff6666';
            ctx.textAlign = 'left';
            ctx.fillText(`${cost.stone}`, costX, costY);
            costX += ctx.measureText(`${cost.stone}`).width + 4;
          }
          if (cost.mana !== undefined && cost.mana > 0) {
            // Mana diamond icon (canvas-drawn)
            const icx = costX + costIconSz / 2, icy = costY - costIconSz / 2, r = costIconSz * 0.42;
            ctx.fillStyle = '#7c4dff';
            ctx.beginPath(); ctx.moveTo(icx, icy - r); ctx.lineTo(icx + r * 0.65, icy);
            ctx.lineTo(icx, icy + r); ctx.lineTo(icx - r * 0.65, icy); ctx.closePath(); ctx.fill();
            costX += costIconSz + 1;
            ctx.fillStyle = canAfford || playerMana >= cost.mana ? '#b39ddb' : '#ff6666';
            ctx.textAlign = 'left';
            ctx.fillText(`${cost.mana}`, costX, costY);
          }
          if ((cost.deathEssence ?? 0) > 0) {
            // Ooze droplet icon (canvas-drawn)
            const ocx = costX + costIconSz / 2, ocy = costY - costIconSz / 2;
            ctx.fillStyle = '#69f0ae';
            ctx.beginPath();
            ctx.moveTo(ocx, ocy - costIconSz * 0.4);
            ctx.quadraticCurveTo(ocx + costIconSz * 0.35, ocy + costIconSz * 0.1, ocx, ocy + costIconSz * 0.4);
            ctx.quadraticCurveTo(ocx - costIconSz * 0.35, ocy + costIconSz * 0.1, ocx, ocy - costIconSz * 0.4);
            ctx.fill();
            costX += costIconSz + 1;
            ctx.fillStyle = canAfford || playerEssence >= cost.deathEssence! ? '#69f0ae' : '#ff6666';
            ctx.textAlign = 'left';
            ctx.fillText(`${cost.deathEssence}`, costX, costY);
          }

          // Effect preview for scaling upgrades (right-aligned on cost row)
          if (!def.oneShot) {
            ctx.fillStyle = '#aaa';
            ctx.font = `${smallFont}px monospace`;
            ctx.textAlign = 'right';
            if (def.type === 'attack') {
              ctx.fillText(`\u2192 ${Math.round(Math.pow(1.12, level + 1) * 100)}%`, bx + bw - 4, costY);
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
    }

    ctx.restore();
  }
}
