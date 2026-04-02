/**
 * InputBuildTray.ts — Build tray rendering logic extracted from InputHandler.
 *
 * Contains the BUILD_TRAY/ASSIGNMENT_LABELS constants, tray layout computation,
 * and the large drawBuildTray method that renders the bottom build bar, nuke button,
 * research button, rally buttons, ability button, toasts, and popups.
 */

import { Game } from '../game/Game';
import { Camera } from '../rendering/Camera';
import {
  BuildingType, Lane, HarvesterAssignment, Race,
  TICK_RATE, isAbilityBuilding,
} from '../simulation/types';
import {
  RACE_BUILDING_COSTS, UNIT_STATS, RACE_ABILITY_INFO,
  RACE_ABILITY_DEFS, TOWER_COST_SCALE, ABILITY_COST_MODIFIERS,
} from '../simulation/data';
import { UIAssets } from '../rendering/UIAssets';
import { SpriteLoader, drawSpriteFrame, drawGridFrame, getSpriteFrame } from '../rendering/SpriteLoader';
import { BuildingPopup } from './BuildingPopup';
import { HutPopup } from './HutPopup';
import { ResearchPopup } from './ResearchPopup';
import { SeedPopup } from './SeedPopup';
import { getSafeBottom } from './SafeArea';

// ── Build tray item type and constants ──

export interface BuildTrayItem {
  type: BuildingType;
  label: string;
  key: string;
}

export const BUILD_TRAY: BuildTrayItem[] = [
  { type: BuildingType.MeleeSpawner, label: 'Melee', key: '2' },
  { type: BuildingType.RangedSpawner, label: 'Ranged', key: '3' },
  { type: BuildingType.CasterSpawner, label: 'Caster', key: '4' },
  { type: BuildingType.Tower, label: 'Tower', key: '5' },
];

export const ASSIGNMENT_LABELS: Record<HarvesterAssignment, string> = {
  [HarvesterAssignment.BaseGold]: '* Gold',
  [HarvesterAssignment.Wood]: 'W Wood',
  [HarvesterAssignment.Meat]: 'M Meat',
  [HarvesterAssignment.Center]: 'C Center',
  [HarvesterAssignment.Mana]: '~ Mana',
};

// ── Tray layout computation ──

export interface TrayLayout {
  W: number; H: number; milH: number; milY: number; milW: number; safeBottom: number;
  nukeRect: { x: number; y: number; w: number; h: number };
  researchRect: { x: number; y: number; w: number; h: number };
  rallyLeftRect: { x: number; y: number; w: number; h: number };
  rallyRandomRect: { x: number; y: number; w: number; h: number };
  rallyRightRect: { x: number; y: number; w: number; h: number };
}

export function computeTrayLayout(canvasWidth: number, canvasHeight: number): TrayLayout {
  const W = canvasWidth;
  const H = canvasHeight;
  const safeBottom = getSafeBottom();
  const milH = 68;
  const milY = H - milH - safeBottom;
  const milW = W / 6;
  const nukeW = Math.round(milW * 0.95);
  const nukeH = 72;
  const nukeX = Math.round((milW - nukeW) / 2);
  const nukeY = milY - nukeH - 4;
  const nukeRect = { x: nukeX, y: nukeY, w: nukeW, h: nukeH };
  const researchRect = { x: Math.round(5 * milW + (milW - nukeW) / 2), y: nukeY, w: nukeW, h: nukeH };
  const rallyBtnW = nukeW;
  const rallyBtnH = nukeH;
  const rallyGap = 8;
  const rallyTotalW = rallyBtnW * 3 + rallyGap * 2;
  const rallyX0 = Math.round((W - rallyTotalW) / 2);
  const rallyY = nukeY;
  const rallyLeftRect = { x: rallyX0, y: rallyY, w: rallyBtnW, h: rallyBtnH };
  const rallyRandomRect = { x: rallyX0 + rallyBtnW + rallyGap, y: rallyY, w: rallyBtnW, h: rallyBtnH };
  const rallyRightRect = { x: rallyX0 + (rallyBtnW + rallyGap) * 2, y: rallyY, w: rallyBtnW, h: rallyBtnH };
  return { W, H, milH, milY, milW, safeBottom, nukeRect, researchRect, rallyLeftRect, rallyRandomRect, rallyRightRect };
}

// ── Dependencies for drawBuildTray ──

export interface BuildTrayDeps {
  game: Game;
  camera: Camera;
  canvas: HTMLCanvasElement;
  ui: UIAssets;
  sprites: SpriteLoader | null;
  pid: number;
  isTouchDevice: boolean;
  selectedBuilding: BuildingType | null;
  abilityTargeting: boolean;
  abilityPlacing: boolean;
  nukeTargeting: boolean;
  trayTick: number;
  trayBldgSpriteCache: Map<string, HTMLImageElement | null>;
  quickChatCooldownUntil: number;
  quickChatToast: { text: string; until: number } | null;
  laneToast: { text: string; until: number } | null;
  mobileHintVisible: boolean;
  settingsOpen: boolean;
  rallyOverride: Lane | 'random' | null;
  rallyPrevLanes: Map<number, Lane>;
  nowPlayingName: string;
  nowPlayingStart: number;
  NP_SHOW_MS: number;
  NP_FADE_MS: number;
  pointerX: number;
  pointerY: number;
  drawAbilityIcon: (ctx: CanvasRenderingContext2D, race: Race, cx: number, cy: number, size: number) => void;
  isNukeLocked: () => boolean;
  drawSettingsPanel: (ctx: CanvasRenderingContext2D) => void;
  buildingPopup: BuildingPopup;
  hutPopup: HutPopup;
  researchPopup: ResearchPopup;
  seedPopup: SeedPopup;
  getTrayLayout: () => TrayLayout;
  myTeam: number;
}

export function drawBuildTray(ctx: CanvasRenderingContext2D, d: BuildTrayDeps): void {
  const { W, milH, milY, milW, safeBottom, nukeRect, researchRect } = d.getTrayLayout();
  const player = d.game.state.players[d.pid];
  const quickChatCdMs = Math.max(0, d.quickChatCooldownUntil - Date.now());

  // Safe area bar below tray for rounded phone corners
  if (safeBottom > 0) {
    ctx.fillStyle = '#1a1008';
    ctx.fillRect(0, milY + milH, W, safeBottom);
  }

  // Build tray background - WoodTable 9-slice (30% wider to hide edge dead space)
  const trayOverW = Math.round(W * 0.15);
  if (!d.ui.drawWoodTable(ctx, -trayOverW, milY, W + trayOverW * 2, milH)) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
    ctx.fillRect(0, milY, W, milH);
  }

  // --- Helper: draw colorized cost parts with resource icons ---
  const costIconSize = 14;
  const drawCost = (parts: { val: number; type: 'g' | 'w' | 's' }[], cx: number, cy: number, affordable: boolean) => {
    const goldColor = affordable ? '#ffd740' : '#665500';
    const woodColor = affordable ? '#81c784' : '#2e5530';
    const meatColor = affordable ? '#e57373' : '#6d2828';
    ctx.font = 'bold 11px monospace';
    const gap = 4;
    let totalW = 0;
    const valStrs = parts.map(p => `${p.val}`);
    for (let j = 0; j < parts.length; j++) {
      totalW += costIconSize + 1 + ctx.measureText(valStrs[j]).width;
      if (j < parts.length - 1) totalW += gap;
    }
    let drawX = cx - totalW / 2;
    for (let j = 0; j < parts.length; j++) {
      const iconName = parts[j].type === 'g' ? 'gold' : parts[j].type === 'w' ? 'wood' : 'meat';
      const iconAlpha = affordable ? 1 : 0.4;
      ctx.globalAlpha = iconAlpha;
      d.ui.drawIcon(ctx, iconName as any, drawX, cy - costIconSize + 2, costIconSize);
      ctx.globalAlpha = 1;
      drawX += costIconSize + 1;
      ctx.fillStyle = parts[j].type === 'g' ? goldColor : parts[j].type === 'w' ? woodColor : meatColor;
      ctx.textAlign = 'left';
      ctx.fillText(valStrs[j], drawX, cy);
      drawX += ctx.measureText(valStrs[j]).width + gap;
    }
  };

  // === Shared cell drawing helper ===
  const race = player.race;
  const spriteSize = Math.round(milH * 0.52);
  const spriteBaseY = milY + spriteSize + 2;
  const selectedRaise = 6;

  const drawCell = (
    cellX: number, isSelected: boolean, canAfford: boolean,
    name: string, spriteCategory: 'melee' | 'ranged' | 'caster' | 'tower' | 'miner',
    costParts: { val: number; type: 'g' | 'w' | 's' }[] | null,
    freeText: string | null,
    keyHint: string,
  ) => {
    const cellY = isSelected ? milY - selectedRaise : milY;
    const cellH = isSelected ? milH + selectedRaise : milH;

    ctx.fillStyle = isSelected ? 'rgba(41, 121, 255, 0.28)' : 'rgba(28, 28, 28, 0.9)';
    ctx.fillRect(cellX + 1, cellY + 1, milW - 2, cellH - 2);
    ctx.strokeStyle = isSelected ? '#2979ff' : (canAfford ? '#555' : '#333');
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.strokeRect(cellX + 1, cellY + 1, milW - 2, cellH - 2);

    const cellCx = cellX + milW / 2;
    const adjBaseY = isSelected ? spriteBaseY - selectedRaise : spriteBaseY;

    if (spriteCategory === 'tower') {
      const cacheKey = `tower:${race}`;
      let towerImg = d.trayBldgSpriteCache.get(cacheKey);
      if (towerImg === undefined) { towerImg = d.sprites?.getBuildingSprite(BuildingType.Tower, 0, false, race) ?? null; if (towerImg) d.trayBldgSpriteCache.set(cacheKey, towerImg); }
      if (towerImg) {
        const aspect = towerImg.width / towerImg.height;
        const dh = spriteSize;
        const dw = dh * aspect;
        ctx.drawImage(towerImg, Math.round(cellCx - dw / 2), Math.round(adjBaseY - dh), dw, dh);
      }
    } else if (spriteCategory === 'miner') {
      const cacheKey = `hut:${race}`;
      let hutImg = d.trayBldgSpriteCache.get(cacheKey);
      if (hutImg === undefined) { hutImg = d.sprites?.getBuildingSprite(BuildingType.HarvesterHut, 0, true, race) ?? null; if (hutImg) d.trayBldgSpriteCache.set(cacheKey, hutImg); }
      if (hutImg) {
        const aspect = hutImg.width / hutImg.height;
        const dh = spriteSize;
        const dw = dh * aspect;
        ctx.drawImage(hutImg, Math.round(cellCx - dw / 2), Math.round(adjBaseY - dh), dw, dh);
      }
    } else {
      const sprData = d.sprites?.getUnitSprite(race, spriteCategory, 0);
      if (sprData) {
        const [img, def] = sprData;
        const frame = isSelected ? getSpriteFrame(Math.floor(d.trayTick / 3), def) : 0;
        const aspect = def.frameW / def.frameH;
        const dh = spriteSize;
        const dw = dh * aspect;
        drawSpriteFrame(ctx, img, def, frame, Math.round(cellCx - dw / 2), Math.round(adjBaseY - dh * (def.groundY ?? 0.71)), dw, dh);
      }
    }

    // Name (truncate with ellipsis if too wide for cell)
    const textY = adjBaseY + 3;
    ctx.textAlign = 'center';
    ctx.fillStyle = canAfford ? '#eee' : '#666';
    ctx.font = 'bold 11px monospace';
    let displayName = name;
    const maxNameW = milW - 4;
    if (ctx.measureText(displayName).width > maxNameW) {
      while (displayName.length > 1 && ctx.measureText(displayName + '\u2026').width > maxNameW) {
        displayName = displayName.slice(0, -1);
      }
      displayName += '\u2026';
    }
    ctx.fillText(displayName, cellCx, textY + 10);

    // Cost or free text
    if (freeText) {
      ctx.fillStyle = '#4caf50'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
      ctx.fillText(freeText, cellCx, textY + 24);
    } else if (costParts && costParts.length > 0) {
      drawCost(costParts, cellCx, textY + 24, canAfford);
    }

    // Key hint
    if (!d.isTouchDevice) {
      ctx.fillStyle = '#444'; ctx.font = '11px monospace'; ctx.textAlign = 'right';
      ctx.fillText(`[${keyHint}]`, cellX + milW - 4, cellY + cellH - 4);
    }
  };

  // === Miner button (col 0) ===
  const myHuts = d.game.state.buildings.filter(
    b => b.playerId === d.pid && b.type === BuildingType.HarvesterHut
  );
  const hutBase = RACE_BUILDING_COSTS[player.race][BuildingType.HarvesterHut];
  const hutMult = Math.pow(1.35, Math.max(0, myHuts.length - 1));
  const hutGold = Math.floor(hutBase.gold * hutMult);
  const hutWood = Math.floor(hutBase.wood * hutMult);
  const hutMeat = Math.floor(hutBase.meat * hutMult);
  const canAffordHut = player.gold >= hutGold && player.wood >= hutWood && player.meat >= hutMeat && myHuts.length < 10;
  const hutCostItems: { val: number; type: 'g' | 'w' | 's' }[] = [];
  if (hutGold > 0) hutCostItems.push({ val: hutGold, type: 'g' });
  if (hutWood > 0) hutCostItems.push({ val: hutWood, type: 'w' });
  if (hutMeat > 0) hutCostItems.push({ val: hutMeat, type: 's' });
  const hutSelected = d.selectedBuilding === BuildingType.HarvesterHut;
  drawCell(0, hutSelected, canAffordHut, 'Miner', 'miner',
    myHuts.length < 10 ? hutCostItems : null,
    myHuts.length >= 10 ? 'MAX' : null, '1');

  // === Military buttons (cols 1-4) ===
  for (let i = 0; i < BUILD_TRAY.length; i++) {
    const item = BUILD_TRAY[i];
    const bx = (i + 1) * milW;
    const isSelected = d.selectedBuilding === item.type && !d.abilityPlacing;
    const baseCost = RACE_BUILDING_COSTS[race][item.type];
    const isFirstTowerFree = item.type === BuildingType.Tower && !player.hasBuiltTower;

    let cost = baseCost;
    if (item.type === BuildingType.Tower && !isFirstTowerFree) {
      const myTowers = d.game.state.buildings.filter(b => b.playerId === d.pid && b.type === BuildingType.Tower && !isAbilityBuilding(b)).length;
      const mult = Math.pow(TOWER_COST_SCALE, Math.max(0, myTowers - 1));
      cost = {
        gold: Math.floor(baseCost.gold * mult),
        wood: Math.floor(baseCost.wood * mult),
        meat: Math.floor(baseCost.meat * mult),
        hp: baseCost.hp,
      };
    }

    const canAfford = isFirstTowerFree || (player.gold >= cost.gold && player.wood >= cost.wood && player.meat >= cost.meat);

    let unitName: string;
    let category: 'melee' | 'ranged' | 'caster' | 'tower';
    if (item.type === BuildingType.Tower) {
      unitName = 'Tower'; category = 'tower';
    } else {
      const stats = UNIT_STATS[race]?.[item.type];
      unitName = stats?.name ?? item.label;
      category = item.type === BuildingType.MeleeSpawner ? 'melee'
        : item.type === BuildingType.RangedSpawner ? 'ranged' : 'caster';
    }

    const costItems: { val: number; type: 'g' | 'w' | 's' }[] = [];
    if (!isFirstTowerFree) {
      if (cost.gold > 0) costItems.push({ val: cost.gold, type: 'g' });
      if (cost.wood > 0) costItems.push({ val: cost.wood, type: 'w' });
      if (cost.meat > 0) costItems.push({ val: cost.meat, type: 's' });
    }

    drawCell(bx, isSelected, canAfford, unitName, category,
      isFirstTowerFree ? null : costItems,
      isFirstTowerFree ? 'FREE' : null, item.key);
  }

  // === Race Ability button (col 5) ===
  {
    const abilityInfo = RACE_ABILITY_INFO[race];
    const abDef = RACE_ABILITY_DEFS[race];
    const abX = (BUILD_TRAY.length + 1) * milW;
    const isTendersSeeds = race === Race.Tenders;
    const seedStacks = player.abilityStacks ?? 0;
    const onCooldown = isTendersSeeds ? seedStacks <= 0 : player.abilityCooldown > 0;
    const isActive = d.abilityTargeting || d.abilityPlacing;

    const growMult = abDef.costGrowthFactor ? Math.pow(abDef.costGrowthFactor, player.abilityUseCount) : 1;
    const abMod = ABILITY_COST_MODIFIERS[race];
    const abHasMod = abMod && player.researchUpgrades.raceUpgrades[abMod.upgradeId];
    const abGoldMult = abHasMod && (abMod.field === 'gold' || abMod.field === 'all') ? abMod.mult : 1;
    const abWoodMult = abHasMod && (abMod.field === 'wood' || abMod.field === 'all') ? abMod.mult : 1;
    const abMeatMult = abHasMod && (abMod.field === 'meat' || abMod.field === 'all') ? abMod.mult : 1;
    const abCostGold = Math.floor((abDef.baseCost.gold ?? 0) * growMult * abGoldMult);
    const abCostWood = Math.floor((abDef.baseCost.wood ?? 0) * growMult * abWoodMult);
    const abCostMeat = Math.floor((abDef.baseCost.meat ?? 0) * growMult * abMeatMult);
    const abCostMana = Math.floor((abDef.baseCost.mana ?? 0) * growMult);
    const abCostSouls = player.race === Race.Geists
      ? (abDef.baseCost.souls ?? 0) + 5 * player.abilityUseCount
      : Math.floor((abDef.baseCost.souls ?? 0) * growMult);
    const abCostEssence = Math.floor((abDef.baseCost.deathEssence ?? 0) * growMult);
    const canAffordAbility = isTendersSeeds ? seedStacks > 0 : (!onCooldown &&
      player.gold >= abCostGold && player.wood >= abCostWood && player.meat >= abCostMeat &&
      player.mana >= abCostMana && player.souls >= abCostSouls && player.deathEssence >= abCostEssence);

    const cellY = isActive ? milY - 6 : milY;
    const cellH = isActive ? milH + 6 : milH;

    ctx.fillStyle = isActive ? 'rgba(126, 87, 194, 0.35)' : (onCooldown ? 'rgba(28, 28, 28, 0.6)' : 'rgba(28, 28, 28, 0.9)');
    ctx.fillRect(abX + 1, cellY + 1, milW - 2, cellH - 2);
    ctx.strokeStyle = isActive ? '#b39ddb' : (canAffordAbility ? '#7e57c2' : '#444');
    ctx.lineWidth = isActive ? 2 : 1;
    ctx.strokeRect(abX + 1, cellY + 1, milW - 2, cellH - 2);

    const abCx = abX + milW / 2;
    const adjY = isActive ? milY - 6 : milY;
    const abBaseY = isActive ? spriteBaseY - 6 : spriteBaseY;
    const abTextY = abBaseY + 3;

    // Ability icon
    ctx.globalAlpha = (onCooldown || !canAffordAbility) ? 0.4 : 1;
    ctx.textAlign = 'center';
    let drewSprite = false;
    if (d.sprites) {
      if (race === Race.Crown) {
        const foundryImg = d.sprites.getRaceBuildingSprite(Race.Crown, 'foundry') ?? d.sprites.getFoundrySprite();
        if (foundryImg) {
          const aspect = foundryImg.width / foundryImg.height;
          const dh = spriteSize;
          const dw = dh * aspect;
          ctx.drawImage(foundryImg, Math.round(abCx - dw / 2), Math.round(abBaseY - dh), dw, dh);
          drewSprite = true;
        }
      } else if (race === Race.Horde) {
        const trollData = d.sprites.getUnitSprite(Race.Goblins, 'melee', 0, isActive, 'E');
        if (trollData) {
          const [img, def] = trollData;
          const frame = isActive ? getSpriteFrame(Math.floor(d.trayTick / 3), def) : 0;
          const iconH = spriteSize;
          const aspect = def.frameW / def.frameH;
          const iconW = iconH * aspect;
          drawSpriteFrame(ctx, img, def, frame, Math.round(abCx - iconW / 2), Math.round(abBaseY - iconH * (def.groundY ?? 0.71)), iconW, iconH);
          drewSprite = true;
        }
      } else if (race === Race.Goblins) {
        const potionShopImg = d.sprites.getRaceBuildingSprite(Race.Goblins, 'potionshop');
        if (potionShopImg) {
          const aspect = potionShopImg.width / potionShopImg.height;
          const dh = spriteSize;
          const dw = dh * aspect;
          ctx.drawImage(potionShopImg, Math.round(abCx - dw / 2), Math.round(abBaseY - dh), dw, dh);
          drewSprite = true;
        } else {
          const potionData = d.sprites.getPotionSprite('green');
          if (potionData) {
            const [img, def] = potionData;
            const frame = isActive ? getSpriteFrame(Math.floor(d.trayTick / 3), def) : 0;
            const dh = spriteSize;
            const aspect = def.frameW / def.frameH;
            const dw = dh * aspect;
            drawSpriteFrame(ctx, img, def, frame, Math.round(abCx - dw / 2), Math.round(abBaseY - dh * (def.groundY ?? 0.9)), dw, dh);
            drewSprite = true;
          }
        }
      } else if (race === Race.Oozlings) {
        const globData = d.sprites.getGlobuleIdleSprite();
        if (globData) {
          const [img, def] = globData;
          const frame = isActive ? getSpriteFrame(Math.floor(d.trayTick / 4), def) : 0;
          const dh = spriteSize;
          const aspect = def.frameW / def.frameH;
          const dw = dh * aspect;
          drawSpriteFrame(ctx, img, def, frame, Math.round(abCx - dw / 2), Math.round(abBaseY - dh * (def.groundY ?? 0.93)), dw, dh);
          drewSprite = true;
        }
      } else if (race === Race.Demon) {
        const orbData = d.sprites.getOrbSprite(Race.Demon);
        if (orbData) {
          const [img, def] = orbData;
          const frame = isActive ? Math.floor(d.trayTick / 2) % def.totalFrames : 0;
          const dh = spriteSize;
          const dw = dh;
          drawGridFrame(ctx, img, def, frame, Math.round(abCx - dw / 2), Math.round(abBaseY - dh), dw, dh);
          drewSprite = true;
        }
      } else if (race === Race.Tenders) {
        const seedData = d.sprites.getSeedSprite();
        if (seedData) {
          const [img, def] = seedData;
          const frame = isActive ? getSpriteFrame(Math.floor(d.trayTick / 3), def) : 0;
          const dh = spriteSize;
          const aspect = def.frameW / def.frameH;
          const dw = dh * aspect;
          drawSpriteFrame(ctx, img, def, frame, Math.round(abCx - dw / 2), Math.round(abBaseY - dh * (def.groundY ?? 0.9)), dw, dh);
          drewSprite = true;
        }
      }
    }
    if (!drewSprite) {
      d.drawAbilityIcon(ctx, race, abCx, adjY + 4, 20);
    }
    // Ability name
    ctx.fillStyle = (onCooldown || !canAffordAbility) ? '#888' : '#e1bee7';
    ctx.font = 'bold 11px monospace';
    let abDisplayName = abilityInfo.name;
    const maxAbNameW = milW - 4;
    if (ctx.measureText(abDisplayName).width > maxAbNameW) {
      while (abDisplayName.length > 1 && ctx.measureText(abDisplayName + '\u2026').width > maxAbNameW) {
        abDisplayName = abDisplayName.slice(0, -1);
      }
      abDisplayName += '\u2026';
    }
    ctx.fillText(abDisplayName, abCx, abTextY + 10);
    ctx.globalAlpha = 1;

    // Tenders: show stack count
    if (isTendersSeeds) {
      if (seedStacks > 0) {
        ctx.textAlign = 'left';
        ctx.font = 'bold 11px monospace';
        ctx.fillStyle = seedStacks >= 10 ? '#ffd740' : '#81c784';
        ctx.fillText(`${seedStacks}`, abX + 4, adjY + cellH - 4);
        ctx.textAlign = 'center';
        if (!d.isTouchDevice) {
          ctx.fillStyle = '#666';
          ctx.font = '11px monospace'; ctx.textAlign = 'right';
          ctx.fillText(`[${abilityInfo.key}]`, abX + milW - 4, adjY + cellH - 4);
        }
      } else {
        const secsLeft = Math.ceil(player.abilityCooldown / TICK_RATE);
        ctx.fillStyle = '#ff9800';
        ctx.font = 'bold 11px monospace';
        ctx.fillText(`${secsLeft}s`, abCx, adjY + cellH - 4);
        ctx.textAlign = 'left';
        ctx.font = 'bold 11px monospace';
        ctx.fillStyle = '#666';
        ctx.fillText('0', abX + 4, adjY + cellH - 4);
      }
      ctx.textAlign = 'center';
    } else {
      // Cost display
      if (!onCooldown) {
        type AbCostEntry = { val: number; canAf: boolean; drawIcon: (ix: number, iy: number, sz: number) => void };
        const abCostEntries: AbCostEntry[] = [];
        if (abCostGold > 0) abCostEntries.push({ val: abCostGold, canAf: player.gold >= abCostGold,
          drawIcon: (ix, iy, sz) => { d.ui.drawIcon(ctx, 'gold', ix, iy, sz) || (ctx.fillStyle = '#ffd700', ctx.beginPath(), ctx.arc(ix + sz / 2, iy + sz / 2, sz / 2, 0, Math.PI * 2), ctx.fill()); } });
        if (abCostWood > 0) abCostEntries.push({ val: abCostWood, canAf: player.wood >= abCostWood,
          drawIcon: (ix, iy, sz) => { d.ui.drawIcon(ctx, 'wood', ix, iy, sz) || (ctx.fillStyle = '#8bc34a', ctx.beginPath(), ctx.arc(ix + sz / 2, iy + sz / 2, sz / 2, 0, Math.PI * 2), ctx.fill()); } });
        if (abCostMeat > 0) abCostEntries.push({ val: abCostMeat, canAf: player.meat >= abCostMeat,
          drawIcon: (ix, iy, sz) => { d.ui.drawIcon(ctx, 'meat', ix, iy, sz) || (ctx.fillStyle = '#ef9a9a', ctx.beginPath(), ctx.arc(ix + sz / 2, iy + sz / 2, sz / 2, 0, Math.PI * 2), ctx.fill()); } });
        if (abCostMana > 0) {
          const manaDisplay = race === Race.Demon && player.mana >= abCostMana ? player.mana : abCostMana;
          abCostEntries.push({ val: manaDisplay, canAf: player.mana >= abCostMana,
            drawIcon: (ix, iy, sz) => { d.ui.drawIcon(ctx, 'mana', ix, iy, sz); } });
        }
        if (abCostSouls > 0) abCostEntries.push({ val: abCostSouls, canAf: player.souls >= abCostSouls,
          drawIcon: (ix, iy, sz) => { d.ui.drawIcon(ctx, 'souls', ix, iy, sz); } });
        if (abCostEssence > 0) abCostEntries.push({ val: abCostEssence, canAf: player.deathEssence >= abCostEssence,
          drawIcon: (ix, iy, sz) => { d.ui.drawIcon(ctx, 'ooze', ix, iy, sz); } });
        if (abCostEntries.length > 0) {
          const iconSz = 10;
          const gap = 3;
          ctx.font = 'bold 11px monospace';
          const valStrs = abCostEntries.map(e => `${e.val}`);
          let totalW = 0;
          for (let i = 0; i < abCostEntries.length; i++) {
            totalW += iconSz + 1 + ctx.measureText(valStrs[i]).width;
            if (i < abCostEntries.length - 1) totalW += gap;
          }
          let dx = abCx - totalW / 2;
          const dy = abTextY + 24;
          for (let i = 0; i < abCostEntries.length; i++) {
            const e = abCostEntries[i];
            ctx.globalAlpha = canAffordAbility ? 1 : 0.45;
            e.drawIcon(dx, dy - iconSz, iconSz);
            ctx.globalAlpha = 1;
            dx += iconSz + 1;
            ctx.fillStyle = e.canAf ? '#ccc' : '#ff6666';
            ctx.textAlign = 'left';
            ctx.fillText(valStrs[i], dx, dy);
            dx += ctx.measureText(valStrs[i]).width + gap;
          }
          ctx.textAlign = 'center';
        }
      }

      // Cooldown timer or key hint
      if (onCooldown) {
        const secsLeft = Math.ceil(player.abilityCooldown / TICK_RATE);
        ctx.fillStyle = '#ff9800';
        ctx.font = 'bold 11px monospace';
        ctx.fillText(`${secsLeft}s`, abCx, adjY + cellH - 4);
      } else if (!d.isTouchDevice) {
        ctx.fillStyle = '#666';
        ctx.font = '11px monospace'; ctx.textAlign = 'right';
        ctx.fillText(`[${abilityInfo.key}]`, abX + milW - 4, adjY + cellH - 4);
      }
    }
  }

  // === Floating Nuke button (above miner) ===
  {
    const nukeAvail = player.nukeAvailable;
    const nukeLocked = d.isNukeLocked();
    const nukeReady = nukeAvail && !nukeLocked;
    const nr = nukeRect;
    const nukePad = 2;
    if (nukeReady) {
      d.ui.drawBigRedButton(ctx, nr.x + nukePad, nr.y + nukePad, nr.w - nukePad * 2, nr.h - nukePad * 2, d.nukeTargeting);
    } else if (nukeAvail) {
      ctx.globalAlpha = 0.3;
      d.ui.drawBigRedButton(ctx, nr.x + nukePad, nr.y + nukePad, nr.w - nukePad * 2, nr.h - nukePad * 2);
      ctx.globalAlpha = 1;
    } else {
      ctx.globalAlpha = 0.15;
      d.ui.drawBigRedButton(ctx, nr.x + nukePad, nr.y + nukePad, nr.w - nukePad * 2, nr.h - nukePad * 2);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'center';
    {
      const iconS = Math.min(nr.w, nr.h) * 0.55;
      ctx.globalAlpha = nukeReady ? 1 : 0.5;
      if (!d.ui.drawIcon(ctx, 'nuke', nr.x + (nr.w - iconS) / 2, nr.y + (nr.h - iconS) / 2 - 2, iconS)) {
        ctx.fillStyle = nukeReady ? '#fff' : '#888';
        ctx.font = 'bold 11px monospace';
        ctx.fillText('NUKE', nr.x + nr.w / 2, nr.y + nr.h / 2 + 2);
      }
      ctx.globalAlpha = 1;
    }
    if (nukeLocked && nukeAvail) {
      const secsLeft = Math.ceil(NUKE_LOCKOUT_SECONDS - d.game.state.tick / TICK_RATE);
      ctx.fillStyle = '#ff5722';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(`${secsLeft}s`, nr.x + nr.w / 2, nr.y + nr.h - 2);
    } else if (nukeAvail && !d.isTouchDevice) {
      ctx.fillStyle = '#888';
      ctx.font = '11px monospace';
      ctx.fillText('[N]', nr.x + nr.w / 2, nr.y + nr.h - 2);
    }
  }

  // === "Now Playing" track name above nuke button ===
  if (d.nowPlayingName) {
    const elapsed = performance.now() - d.nowPlayingStart;
    const total = d.NP_SHOW_MS + d.NP_FADE_MS;
    if (elapsed < total) {
      const alpha = elapsed < d.NP_SHOW_MS
        ? 1
        : 1 - (elapsed - d.NP_SHOW_MS) / d.NP_FADE_MS;
      ctx.save();
      ctx.globalAlpha = alpha * 0.85;
      ctx.font = '11px monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#fff';
      ctx.fillText(`\u266A ${d.nowPlayingName}`, nukeRect.x + 2, nukeRect.y - 6);
      ctx.restore();
    }
  }

  // === Floating Research button (above ability, col 5) ===
  {
    const rr = researchRect;
    const pad = 2;
    const hasResearch = d.game.state.buildings.some(
      b => b.playerId === d.pid && b.type === BuildingType.Research
    );
    const isOpen = d.researchPopup.isOpen();
    ctx.globalAlpha = hasResearch ? 1 : 0.35;
    if (!d.ui.drawBigBlueButton(ctx, rr.x + pad, rr.y + pad, rr.w - pad * 2, rr.h - pad * 2, isOpen)) {
      ctx.fillStyle = isOpen ? '#00bcd4' : '#006064';
      ctx.fillRect(rr.x + pad, rr.y + pad, rr.w - pad * 2, rr.h - pad * 2);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    {
      const iconS = Math.min(rr.w, rr.h) * 0.55;
      ctx.globalAlpha = hasResearch ? 1 : 0.5;
      if (!d.ui.drawIcon(ctx, 'research', rr.x + (rr.w - iconS) / 2, rr.y + (rr.h - iconS) / 2 - 2, iconS)) {
        ctx.fillStyle = hasResearch ? '#fff' : '#888';
        ctx.font = 'bold 11px monospace';
        ctx.fillText('RESEARCH', rr.x + rr.w / 2, rr.y + rr.h / 2 + 2);
      }
      ctx.globalAlpha = 1;
    }
    if (!d.isTouchDevice) {
      ctx.fillStyle = '#888';
      ctx.font = '11px monospace';
      ctx.fillText('[R]', rr.x + rr.w / 2, rr.y + rr.h - 2);
    }
  }

  // === Rally override buttons (centered above tray) ===
  if (player.race !== Race.Oozlings) {
    const { rallyLeftRect: rl, rallyRandomRect: rm, rallyRightRect: rr2 } = d.getTrayLayout();
    const isLandscape = d.game.state.mapDef.shapeAxis === 'x';
    const leftLabel = isLandscape ? 'ALL TOP' : 'ALL LEFT';
    const rightLabel = isLandscape ? 'ALL BOT' : 'ALL RIGHT';
    const isLeftActive = d.rallyOverride === Lane.Left;
    const isRandomActive = d.rallyOverride === 'random';
    const isRightActive = d.rallyOverride === Lane.Right;
    const anyActive = d.rallyOverride !== null;

    // Sync: if rally is active, ensure any new buildings are also overridden
    if (d.rallyOverride !== null && d.rallyOverride !== 'random') {
      for (const b of d.game.state.buildings) {
        if (b.playerId === d.pid && b.type !== BuildingType.Tower && b.lane !== d.rallyOverride) {
          if (!d.rallyPrevLanes.has(b.id)) {
            d.rallyPrevLanes.set(b.id, b.lane);
          }
          d.game.sendCommand({ type: 'toggle_lane', playerId: d.pid, buildingId: b.id, lane: d.rallyOverride });
        }
      }
    } else if (d.rallyOverride === 'random') {
      for (const b of d.game.state.buildings) {
        if (b.playerId === d.pid && b.type !== BuildingType.Tower && !d.rallyPrevLanes.has(b.id)) {
          d.rallyPrevLanes.set(b.id, b.lane);
          const lane = Math.random() < 0.5 ? Lane.Left : Lane.Right;
          d.game.sendCommand({ type: 'toggle_lane', playerId: d.pid, buildingId: b.id, lane });
        }
      }
    }

    const pad = 2;
    const drawRallyBtn = (rect: { x: number; y: number; w: number; h: number }, label: string, active: boolean, disabled: boolean) => {
      ctx.globalAlpha = disabled ? 0.35 : 1;
      if (active) {
        d.ui.drawBigRedButton(ctx, rect.x + pad, rect.y + pad, rect.w - pad * 2, rect.h - pad * 2, true);
      } else {
        d.ui.drawBigBlueButton(ctx, rect.x + pad, rect.y + pad, rect.w - pad * 2, rect.h - pad * 2);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = 'center';
      ctx.fillStyle = disabled ? '#888' : '#fff';
      ctx.font = 'bold 11px monospace';
      if (active) {
        ctx.fillText('CANCEL', rect.x + rect.w / 2, rect.y + rect.h / 2 + 2);
      } else {
        const parts = label.split(' ');
        if (d.isTouchDevice && parts.length === 2) {
          ctx.fillText(parts[0], rect.x + rect.w / 2, rect.y + rect.h / 2 - 4);
          ctx.fillText(parts[1], rect.x + rect.w / 2, rect.y + rect.h / 2 + 10);
        } else {
          ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 2);
        }
      }
      if (!active && !d.isTouchDevice) {
        ctx.fillStyle = '#888';
        ctx.font = '11px monospace';
        ctx.fillText('[L]', rect.x + rect.w / 2, rect.y + rect.h - 2);
      }
    };
    drawRallyBtn(rl, leftLabel, isLeftActive, anyActive && !isLeftActive);
    drawRallyBtn(rm, 'RANDOM', isRandomActive, anyActive && !isRandomActive);
    drawRallyBtn(rr2, rightLabel, isRightActive, anyActive && !isRightActive);
  }

  if (quickChatCdMs > 0) {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffcc80';
    ctx.font = '11px monospace';
    ctx.fillText(`Chat CD ${(quickChatCdMs / 1000).toFixed(1)}s`, 10, milY - 8);
  }
  // Toast messages
  const toastBaseY = milY - 76 - 4;
  if (d.quickChatToast && Date.now() < d.quickChatToast.until) {
    ctx.fillStyle = 'rgba(20,20,20,0.9)';
    ctx.fillRect(W / 2 - 120, toastBaseY - 4, 240, 22);
    ctx.strokeStyle = '#ffcc80';
    ctx.strokeRect(W / 2 - 120, toastBaseY - 4, 240, 22);
    ctx.fillStyle = '#ffcc80';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(d.quickChatToast.text, W / 2, toastBaseY + 11);
  }
  if (d.laneToast && Date.now() < d.laneToast.until) {
    ctx.fillStyle = 'rgba(20,20,20,0.9)';
    ctx.fillRect(W / 2 - 160, toastBaseY - 28, 320, 20);
    ctx.strokeStyle = '#9bb7ff';
    ctx.strokeRect(W / 2 - 160, toastBaseY - 28, 320, 20);
    ctx.fillStyle = '#9bb7ff';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(d.laneToast.text, W / 2, toastBaseY - 14);
  }

  if (d.mobileHintVisible) {
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

  if (d.settingsOpen) {
    d.drawSettingsPanel(ctx);
  }

  // Building popup (in-world)
  if (d.buildingPopup.isOpen()) {
    d.buildingPopup.draw(ctx, d.camera, d.game.state, d.ui,
      W, d.canvas.clientHeight, player.gold, player.wood, player.meat, d.sprites,
      d.pointerX, d.pointerY, d.isTouchDevice);
  }

  // Hut popup (in-world)
  if (d.hutPopup.isOpen()) {
    d.hutPopup.draw(ctx, d.camera, d.game.state, d.ui,
      W, d.canvas.clientHeight);
  }

  // Research popup
  if (d.researchPopup.isOpen()) {
    d.researchPopup.draw(ctx, d.camera, d.game.state, d.ui,
      W, d.canvas.clientHeight, player.gold, player.wood, player.meat, player.mana);
  }

  // Seed popup (in-world)
  if (d.seedPopup.isOpen()) {
    d.seedPopup.draw(ctx, d.camera, d.game.state, d.ui,
      W, d.canvas.clientHeight, d.pid);
  }

  ctx.textAlign = 'start';
}

const NUKE_LOCKOUT_SECONDS = 60;
export { NUKE_LOCKOUT_SECONDS };
