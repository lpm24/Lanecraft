/**
 * RendererEntities.ts — Entity drawing functions (units, buildings, projectiles, harvesters, dead units).
 * Extracted from Renderer.ts. All functions are standalone and receive their dependencies via context objects.
 */

import { SpriteLoader, drawSpriteFrame, drawGridFrame, getSpriteFrame, type SpriteDef, type GridSpriteDef } from './SpriteLoader';
import { UIAssets } from './UIAssets';
import {
  GameState, Team, TILE_SIZE, TICK_RATE,
  BuildingType, Lane, StatusType, Race, ResourceType, HarvesterAssignment,
  type BuildingState, type UnitState, type HarvesterState, type ProjectileState,
} from '../simulation/types';
import { getHQPosition, getUnitUpgradeMultipliers, SEED_GROW_TIMES } from '../simulation/GameState';
import { RACE_COLORS, TOWER_STATS, PLAYER_COLORS } from '../simulation/data';
import { ConstructionAnims, HitFlashTracker } from './VisualEffects';
import { tileToPixel, isoArc, ISO_TILE_W, ISO_TILE_H } from './Projection';
import { drawUnitShape } from './RendererShapes';
import { LANE_LEFT_COLOR, LANE_RIGHT_COLOR, DEAD_UNIT_LIFETIME_SEC, type DeadUnitSnapshot } from './RendererShapes';

const T = TILE_SIZE;

/** Shared per-frame rendering context passed to all entity drawing functions. */
export interface EntityDrawContext {
  sprites: SpriteLoader;
  ui: UIAssets;
  isometric: boolean;
  frameNow: number;
  /** Cached pixel coords from drawYSorted — set before each drawOne* call. */
  cachedPx: number;
  cachedPy: number;
  /** Cached shadow style string, responsive to day/night brightness. */
  shadowStyle: string;
  harvShadowStyle: string;
  /** Day/night brightness value (0-1). */
  dayNightBrightness: number;
  /** Map of unit ID -> whether unit moved this tick. */
  movedThisTick: Set<number>;
  /** Smooth HP bar tracker: unitId -> displayed HP fraction. */
  smoothHp: Map<number, number>;
  /** Construction animation tracker. */
  constructionAnims: ConstructionAnims;
  /** Hit flash tracker. */
  hitFlash: HitFlashTracker;
  /** Per-entity facing direction tracker: true = face left. */
  facing: Map<number, boolean>;
  /** Previous X positions for facing direction detection. */
  prevX: Map<number, number>;
  /** Dead units list (for updateDeadUnits to modify). */
  deadUnits: DeadUnitSnapshot[];
  /** Death effects list (for adding dust puffs). */
  deathEffects: { x: number; y: number; frame: number; maxFrames: number; size: number; type: 'dust' | 'explosion' | 'race_burst'; race?: Race }[];
  /** Reusable unit-by-ID map (rebuilt once per frame). */
  renderUnitById: Map<number, UnitState>;
  /** Reusable harvester-by-hutId map (rebuilt once per frame). */
  renderHarvByHut: Map<number, import('../simulation/types').HarvesterState>;
  /** Cached enemy alley buildings for siege facing. */
  enemyAlleyBuildings: { team: Team; x: number; y: number }[];
  /** Cached frightened state per harvester. */
  harvesterFrightened: Map<number, boolean>;
}

/** Update facing direction for an entity based on movement. Returns true if facing left. */
function updateFacing(ectx: EntityDrawContext, id: number, x: number, defaultLeft: boolean): boolean {
  const prev = ectx.prevX.get(id);
  if (prev !== undefined) {
    const dx = x - prev;
    if (Math.abs(dx) > 0.15) {
      ectx.facing.set(id, dx < 0);
    }
  }
  ectx.prevX.set(id, x);
  return ectx.facing.get(id) ?? defaultLeft;
}

function tp(tileX: number, tileY: number, isometric: boolean): { px: number; py: number } {
  return tileToPixel(tileX, tileY, isometric);
}

function projAngle(ax: number, ay: number, bx: number, by: number, isometric: boolean): number {
  const from = tp(ax, ay, isometric);
  const to = tp(bx, by, isometric);
  return Math.atan2(to.py - from.py, to.px - from.px);
}

// ── updateDeadUnits ──

export function updateDeadUnits(dt: number, ectx: EntityDrawContext): void {
  for (let i = ectx.deadUnits.length - 1; i >= 0; i--) {
    const dead = ectx.deadUnits[i];
    const prevProgress = dead.ageSec / DEAD_UNIT_LIFETIME_SEC;
    dead.ageSec += dt;
    const newProgress = dead.ageSec / DEAD_UNIT_LIFETIME_SEC;
    // Spawn small dust puff when corpse hits the ground (at ~60% progress)
    if (prevProgress < 0.6 && newProgress >= 0.6) {
      ectx.deathEffects.push({
        x: dead.x, y: dead.y + 0.3, frame: 0, maxFrames: 10,
        size: T * 0.9, type: 'dust',
      });
    }
    if (dead.ageSec >= DEAD_UNIT_LIFETIME_SEC) ectx.deadUnits.splice(i, 1);
  }
}

// ── drawDeadUnit ──

export function drawDeadUnit(ctx: CanvasRenderingContext2D, dead: DeadUnitSnapshot, ectx: EntityDrawContext): void {
  const px = ectx.cachedPx, py = ectx.cachedPy;
  const cx = px + T / 2;
  const feetY = py + T * 0.70;
  const progress = Math.min(1, dead.ageSec / DEAD_UNIT_LIFETIME_SEC);

  const flashPhase = Math.min(1, progress / 0.15);
  const fallPhase = progress < 0.15 ? 0 : Math.min(1, (progress - 0.15) / 0.45);
  const fadePhase = progress < 0.6 ? 0 : (progress - 0.6) / 0.4;

  const popY = flashPhase < 1 ? -Math.sin(flashPhase * Math.PI) * 4 : 0;
  const alpha = fadePhase > 0 ? 1 - fadePhase * 0.85 : 1;
  const fallEased = 1 - (1 - fallPhase) * (1 - fallPhase);
  const deadFlip = dead.faceLeft;
  const rotation = (deadFlip ? -1 : 1) * fallEased * 1.4;
  const flatten = 1 - fallEased * 0.72;

  ctx.save();
  ctx.globalAlpha = alpha;

  ctx.fillStyle = ectx.shadowStyle;
  ctx.beginPath();
  ctx.ellipse(cx, py + T * 0.70, 7 + fallEased * 4, 2.5 + fallEased * 1.5, 0, 0, Math.PI * 2);
  ctx.fill();

  const spriteData = dead.race
    ? ectx.sprites.getUnitSprite(dead.race, dead.category, dead.playerId, dead.wasAttacking, dead.upgradeNode)
    : null;
  const tierScale = 1.0 + (dead.upgradeTier ?? 0) * 0.15;

  if (spriteData) {
    const [img, def] = spriteData;
    const spriteScale = def.scale ?? 1.0;
    const baseH = T * 1.82 * spriteScale * tierScale;
    const aspect = def.frameW / def.frameH;
    const drawW = baseH * aspect;
    const drawH = baseH * (def.heightScale ?? 1.0);
    const groundY = def.groundY ?? 0.71;
    const drawFaceLeft = def.flipX ? !dead.faceLeft : dead.faceLeft;

    ctx.translate(cx, feetY + popY);
    ctx.rotate(rotation);
    ctx.scale(drawFaceLeft ? -1 : 1, flatten);

    const deadAx = def.anchorX ?? 0.5;
    drawSpriteFrame(ctx, img, def, dead.frame, -drawW * deadAx, -drawH * groundY, drawW, drawH);
    if (flashPhase < 1) {
      ctx.globalAlpha = (1 - flashPhase) * 0.55;
      ctx.globalCompositeOperation = 'lighter';
      drawSpriteFrame(ctx, img, def, dead.frame, -drawW * deadAx, -drawH * groundY, drawW, drawH);
      ctx.globalCompositeOperation = 'source-over';
    }
  } else {
    const radius = (dead.category === 'ranged' ? 3 : 4) * tierScale;
    ctx.translate(cx, py + T / 2 + popY);
    ctx.rotate(rotation);
    ctx.scale(1, flatten);
    drawUnitShape(ctx, 0, 0, radius, dead.race, dead.category, dead.team, PLAYER_COLORS[dead.playerId % PLAYER_COLORS.length]);
  }

  ctx.restore();
}

// ── drawOneBuilding ──

export function drawOneBuilding(ctx: CanvasRenderingContext2D, state: GameState, b: BuildingState, ectx: EntityDrawContext): void {
  {
    const player = state.players[b.playerId];
    const rc = RACE_COLORS[player.race];
    const playerColor = PLAYER_COLORS[b.playerId % PLAYER_COLORS.length];
    const { px: _bpx, py: _bpy } = tp(b.worldX + 0.5, b.worldY + 0.5, ectx.isometric);
    const px = _bpx;
    const py = _bpy;
    const half = T / 2 - 2;

    const upgradeTier = Math.max(0, b.upgradePath.length - 1);
    const sprite = b.isGlobule
      ? ectx.sprites.getGlobuleSprite()
      : b.isFoundry
        ? (ectx.sprites.getRaceBuildingSprite(player.race, 'foundry') ?? ectx.sprites.getBuildingSprite(b.type, b.playerId, ectx.isometric, player.race, b.upgradePath))
        : b.isPotionShop
          ? (ectx.sprites.getRaceBuildingSprite(player.race, 'potionshop') ?? ectx.sprites.getBuildingSprite(BuildingType.CasterSpawner, b.playerId, ectx.isometric, player.race, b.upgradePath))
          : ectx.sprites.getBuildingSprite(b.type, b.playerId, ectx.isometric, player.race, b.upgradePath);

    if (sprite) {
      const researchScale = b.type === BuildingType.Research ? 2.0 : 1.0;
      const globuleScale = 1.0;
      const tierScale = ectx.isometric
        ? [0.85, 1.0, 1.15][Math.min(upgradeTier, 2)]
        : 1.0 + upgradeTier * 0.08;
      const isNewPack = !b.isGlobule && ectx.sprites.isRacePackSprite(b.type, player.race, b.upgradePath);
      const tileScale = (!ectx.isometric && isNewPack && researchScale < 2.0) ? 0.8 : 1.0;
      const baseTileW = ectx.isometric ? ISO_TILE_W * 0.85 : (T + 4);
      const baseDrawW = baseTileW * tierScale * researchScale * globuleScale * tileScale;
      const baseDrawH = (baseDrawW / sprite.width) * sprite.height;

      const buildScale = ectx.constructionAnims.getScale(b.id, state.tick);
      const maxTileW = ectx.isometric ? ISO_TILE_W : (T + 4);
      const unclampedW = baseDrawW * buildScale;
      const drawW = (researchScale >= 2.0) ? unclampedW : Math.min(unclampedW, maxTileW);
      const drawH = baseDrawH * buildScale * (drawW / unclampedW);
      const drawX = px - drawW / 2;
      const drawY = ectx.isometric
        ? py + ISO_TILE_H / 2 - drawH
        : py + half - drawH + 2;

      // Seed buildings
      if (b.isSeed) {
        const tier = b.seedTier ?? 0;
        const seedTierScale = [1, 1.4, 1.9][tier];
        const seedData = ectx.sprites.getSeedSprite();
        if (seedData) {
          const [seedImg, seedDef] = seedData;
          const seedSize = T * 1.8 * buildScale * seedTierScale;
          const seedAspect = seedDef.frameW / seedDef.frameH;
          const seedW = seedSize * seedAspect;
          const seedH = seedSize;
          const seedFeetY = py + half + 2;
          const seedDrawY = seedFeetY - seedH * (seedDef.groundY ?? 0.95);
          const seedFrame = getSpriteFrame(state.tick, seedDef);
          drawSpriteFrame(ctx, seedImg, seedDef, seedFrame, px - seedW / 2, seedDrawY, seedW, seedH);
        } else {
          ctx.drawImage(sprite, drawX, drawY, drawW, drawH);
        }
        const seedStarImg = ectx.sprites.getStarShineSprite('pink');
        if (seedStarImg && b.seedTimer != null) {
          const starCols = 13;
          const starFW = seedStarImg.width / starCols;
          const starFH = seedStarImg.height;
          const starFrame = Math.floor(state.tick * 0.15 + b.id * 5) % starCols;
          const starSize = T * 1.5 * seedTierScale;
          const starAspect = starFW / starFH;
          ctx.globalAlpha = 0.45;
          ctx.drawImage(seedStarImg, starFrame * starFW, 0, starFW, starFH,
            px - starSize * starAspect / 2, py - starSize * 0.3, starSize * starAspect, starSize);
          ctx.globalAlpha = 1;
        }
        if (b.seedTimer != null) {
          const seedGrowTimes = SEED_GROW_TIMES;
          const maxTime = seedGrowTimes[tier];
          const pct = 1 - b.seedTimer / maxTime;
          const barW2 = drawW * 0.8;
          const barH2 = 3;
          const barX2 = px - barW2 / 2;
          const barY2 = drawY;
          ctx.fillStyle = '#333';
          ctx.fillRect(barX2, barY2, barW2, barH2);
          const tierColors = ['#81c784', '#ffd740', '#ff8a65'];
          ctx.fillStyle = tierColors[tier];
          ctx.fillRect(barX2, barY2, barW2 * pct, barH2);
        }
      } else if (b.isGlobule) {
        const WIGGLE_DURATION = 22;
        const timer = b.actionTimer ?? 0;
        const justSpawned = timer < WIGGLE_DURATION;
        const atkData = justSpawned ? ectx.sprites.getGlobuleAtkSprite() : null;
        const idleData = ectx.sprites.getGlobuleIdleSprite();
        if (atkData) {
          const [aImg, aDef] = atkData;
          const frame = Math.floor(timer / 2) % aDef.cols;
          const aspect = aDef.frameW / aDef.frameH;
          const gH = drawH;
          const gW = gH * aspect;
          const gFeetY = py + half + 2;
          const gDrawY = gFeetY - gH * (aDef.groundY ?? 0.93);
          drawSpriteFrame(ctx, aImg, aDef, frame, px - gW / 2, gDrawY, gW, gH);
        } else if (idleData) {
          const [iImg, iDef] = idleData;
          const frame = Math.floor(state.tick / 5) % iDef.cols;
          const aspect = iDef.frameW / iDef.frameH;
          const gH = drawH;
          const gW = gH * aspect;
          const gFeetY = py + half + 2;
          const gDrawY = gFeetY - gH * (iDef.groundY ?? 0.93);
          drawSpriteFrame(ctx, iImg, iDef, frame, px - gW / 2, gDrawY, gW, gH);
        } else {
          ctx.drawImage(sprite!, drawX, drawY, drawW, drawH);
        }
      } else {
        ctx.drawImage(sprite, drawX, drawY, drawW, drawH);
      }

      // Special ability buildings (non-seed)
      if (b.isFoundry) {
        // Crown Foundry — new AI sprite includes the foundry visual, no overlay needed
      } else if (b.isGlobule) {
        const pulse = 0.1 + 0.06 * Math.sin(state.tick * 0.08);
        ctx.globalAlpha = pulse;
        ctx.fillStyle = '#69f0ae';
        const glowR = drawW * 0.4;
        ctx.beginPath();
        ctx.ellipse(px, drawY + drawH * 0.85, glowR, glowR * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else if (b.isPotionShop) {
        const casterData = ectx.sprites.getUnitSprite(Race.Goblins, 'caster', b.playerId, false);
        if (casterData) {
          const [cImg, cDef] = casterData;
          const cScale = cDef.scale ?? 1.0;
          const cSize = T * 1.5 * cScale * buildScale;
          const cAspect = cDef.frameW / cDef.frameH;
          const cW = cSize * cAspect;
          const cH = cSize * (cDef.heightScale ?? 1.0);
          const cGY = cDef.groundY ?? 0.95;
          const cFeetY = drawY + drawH * 0.4;
          const cUnitY = cFeetY - cH * cGY;
          if (player.team === Team.Top) {
            ctx.save();
            ctx.translate(px, 0);
            ctx.scale(-1, 1);
            drawSpriteFrame(ctx, cImg, cDef, 0, -cW / 2, cUnitY, cW, cH);
            ctx.restore();
          } else {
            drawSpriteFrame(ctx, cImg, cDef, 0, px - cW / 2, cUnitY, cW, cH);
          }
        }
      } else if (b.type === BuildingType.Tower) {
        const towerStats = TOWER_STATS[player.race];
        const towerUpgrade = getUnitUpgradeMultipliers(b.upgradePath, player.race, BuildingType.Tower);
        const towerRangeBonus = towerUpgrade.special.towerRangeBonus ?? 0;
        const effectiveRange = Math.max(1, towerStats.range * towerUpgrade.range) + towerRangeBonus;
        ctx.beginPath();
        isoArc(ctx, px, py, effectiveRange * T, ectx.isometric);
        ctx.strokeStyle = `${rc.primary}33`;
        ctx.lineWidth = 1;
        ctx.stroke();

        const towerCooldownTicks = Math.max(1, Math.round(towerStats.attackSpeed * TICK_RATE));
        const towerHasAttackSprite = ectx.sprites.hasAttackSprite(player.race, 'ranged', b.upgradePath[b.upgradePath.length - 1] ?? 'A');
        const towerFiring = b.actionTimer > 0;
        const towerShowingAttack = towerHasAttackSprite ? towerFiring : b.actionTimer > towerCooldownTicks * 0.5;
        const unitData = ectx.sprites.getUnitSprite(player.race, 'ranged', b.playerId, towerShowingAttack, b.upgradePath[b.upgradePath.length - 1] ?? 'A');
        if (unitData) {
          const [unitImg, unitDef] = unitData;
          const spriteScale = unitDef.scale ?? 1.0;
          const unitSize = T * 1.5 * spriteScale * tierScale;
          const aspect = unitDef.frameW / unitDef.frameH;
          const uW = unitSize * aspect;
          const uH = unitSize * (unitDef.heightScale ?? 1.0);
          const gY = unitDef.groundY ?? 0.71;
          const feetY2 = drawY + drawH * 0.4;
          const unitX = px - uW / 2;
          const unitY = feetY2 - uH * gY;
          let frame: number;
          if (towerShowingAttack && towerHasAttackSprite) {
            const elapsed = towerCooldownTicks - b.actionTimer;
            const totalFrames = unitDef.cols * (unitDef.rows ?? 1);
            frame = Math.min(totalFrames - 1, Math.floor(elapsed * totalFrames / towerCooldownTicks));
          } else if (towerShowingAttack) {
            frame = 0;
          } else {
            frame = 0;
          }
          if (player.team === Team.Top) {
            ctx.save();
            ctx.translate(px, 0);
            ctx.scale(-1, 1);
            drawSpriteFrame(ctx, unitImg, unitDef, frame, -uW / 2, unitY, uW, uH);
            ctx.restore();
          } else {
            drawSpriteFrame(ctx, unitImg, unitDef, frame, unitX, unitY, uW, uH);
          }
        }
      }

      // Harvester hut assignment icon overlay
      if (b.type === BuildingType.HarvesterHut) {
        const harv = ectx.renderHarvByHut.get(b.id);
        if (harv) {
          const iconSz = Math.max(8, half * 0.9);
          const iconX = px + half - iconSz * 0.2;
          const iconY2 = py - half - iconSz * 0.6;
          if (harv.assignment === 'center') {
            const diamondSprite = ectx.sprites.getResourceSprite('goldResource');
            const dSz = iconSz * 1.8;
            const dOff = (dSz - iconSz) / 2;
            if (diamondSprite) ctx.drawImage(diamondSprite[0], iconX - dOff, iconY2 - dOff, dSz, dSz);
          } else if (harv.assignment === HarvesterAssignment.Mana || (harv.assignment === 'base_gold' && player.race === Race.Demon)) {
            ectx.ui.drawIcon(ctx, 'mana', iconX, iconY2, iconSz);
          } else {
            const iconMap: Record<string, 'gold' | 'wood' | 'meat'> = { base_gold: 'gold', wood: 'wood', meat: 'meat' };
            ectx.ui.drawIcon(ctx, iconMap[harv.assignment] || 'gold', iconX, iconY2, iconSz);
          }
        }
      }
    } else {
      // Fallback: procedural shapes
      const tierScale = 1.0 + upgradeTier * 0.08;
      const h2 = half * tierScale;
      ctx.fillStyle = 'rgba(20, 20, 20, 0.9)';
      ctx.strokeStyle = playerColor;
      ctx.lineWidth = upgradeTier >= 2 ? 3 : 2;

      switch (b.type) {
        case BuildingType.MeleeSpawner:
          ctx.fillRect(px - h2, py - h2, h2 * 2, h2 * 2);
          ctx.strokeRect(px - h2, py - h2, h2 * 2, h2 * 2);
          break;
        case BuildingType.RangedSpawner:
          ctx.beginPath();
          ctx.moveTo(px, py - h2); ctx.lineTo(px + h2, py + h2); ctx.lineTo(px - h2, py + h2);
          ctx.closePath(); ctx.fill(); ctx.stroke();
          break;
        case BuildingType.CasterSpawner:
          ctx.beginPath();
          for (let i = 0; i < 5; i++) {
            const a = (i * 2 * Math.PI / 5) - Math.PI / 2;
            const sx = px + Math.cos(a) * h2, sy = py + Math.sin(a) * h2;
            if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
          }
          ctx.closePath(); ctx.fill(); ctx.stroke();
          break;
        case BuildingType.Tower: {
          ctx.beginPath();
          ctx.moveTo(px, py - h2); ctx.lineTo(px + h2, py);
          ctx.lineTo(px, py + h2); ctx.lineTo(px - h2, py);
          ctx.closePath(); ctx.fill();
          ctx.strokeStyle = rc.primary;
          ctx.stroke();
          const towerStats = TOWER_STATS[player.race];
          const towerUpgrade = getUnitUpgradeMultipliers(b.upgradePath, player.race, BuildingType.Tower);
          const towerRangeBonus = towerUpgrade.special.towerRangeBonus ?? 0;
          const effectiveRange = Math.max(1, towerStats.range * towerUpgrade.range) + towerRangeBonus;
          ctx.beginPath();
          isoArc(ctx, px, py, effectiveRange * T, ectx.isometric);
          ctx.strokeStyle = `${rc.primary}33`;
          ctx.lineWidth = 1;
          ctx.stroke();
          break;
        }
        case BuildingType.HarvesterHut: {
          ctx.beginPath(); ctx.arc(px, py, h2, 0, Math.PI * 2);
          ctx.fill(); ctx.strokeStyle = '#ffd700'; ctx.stroke();
          const harv = ectx.renderHarvByHut.get(b.id);
          if (harv) {
            const iconSz = Math.max(8, half * 0.9);
            const iconX = px + half - iconSz * 0.2;
            const iconY2 = py - half - iconSz * 0.6;
            if (harv.assignment === 'center') {
              const diamondSprite = ectx.sprites.getResourceSprite('goldResource');
              if (diamondSprite) ctx.drawImage(diamondSprite[0], iconX, iconY2, iconSz, iconSz);
            } else if (harv.assignment === HarvesterAssignment.Mana) {
              ectx.ui.drawIcon(ctx, 'mana', iconX, iconY2, iconSz);
            } else {
              const iconMap: Record<string, 'gold' | 'wood' | 'meat'> = { base_gold: 'gold', wood: 'wood', meat: 'meat' };
              ectx.ui.drawIcon(ctx, iconMap[harv.assignment] || 'gold', iconX, iconY2, iconSz);
            }
          }
          break;
        }
        case BuildingType.Research: {
          const bh = h2 * 1.4;
          ctx.fillRect(px - bh, py - bh * 0.8, bh * 2, bh * 1.6);
          ctx.strokeStyle = '#c0a060';
          ctx.lineWidth = 2;
          ctx.strokeRect(px - bh, py - bh * 0.8, bh * 2, bh * 1.6);
          ctx.fillStyle = '#e8d5b7';
          ctx.font = `bold ${Math.max(11, Math.round(half * 0.8))}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('R', px, py);
          ctx.textBaseline = 'alphabetic';
          break;
        }
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
        ctx.beginPath(); ctx.arc(px, py + half + 2, 1.5, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(px - 3, py + half + 2, 1.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(px + 3, py + half + 2, 1.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Building damage fire overlay when HP < 50%
    const bHpPct = b.hp / b.maxHp;
    if (bHpPct < 0.5) {
      const fireData = ectx.sprites.getFxSprite('buildingFire');
      if (fireData) {
        const [fireImg, fireDef] = fireData;
        const fireSize = T * 1.2;
        const fireTick = Math.floor(ectx.frameNow / 80) + b.id;
        ctx.globalAlpha = bHpPct < 0.25 ? 0.9 : 0.5;
        drawGridFrame(ctx, fireImg, fireDef as GridSpriteDef, fireTick, px - fireSize / 2, py - half - fireSize * 0.6, fireSize, fireSize);
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

// ── drawOneProjectile ──

export function drawOneProjectile(ctx: CanvasRenderingContext2D, state: GameState, p: ProjectileState, ectx: EntityDrawContext): void {
  const isBottom = p.team === Team.Bottom;
  const teamIdx = isBottom ? 0 : 1;
  const race = state.players[p.sourcePlayerId]?.race;

  let pyOffset = T * 0.45;
  if (race && p.sourceUnitId != null) {
    const srcUnit = ectx.renderUnitById.get(p.sourceUnitId);
    const cat = srcUnit?.category;
    if (cat) {
      const sprData = ectx.sprites.getUnitSprite(race, cat, p.sourcePlayerId, false, srcUnit?.upgradeNode);
      if (sprData) {
        const [, def] = sprData;
        const scale = def.scale ?? 1.0;
        const tier = srcUnit?.upgradeTier ?? 0;
        const tierScale = 1.0 + tier * 0.15;
        const drawH = T * 1.82 * scale * tierScale * (def.heightScale ?? 1.0);
        const groundY = def.groundY ?? 0.71;
        pyOffset = T * 0.70 - drawH * groundY + drawH * 0.5;
      }
    }
  }
  const { px: _ppx, py: _ppy } = tp(p.x + 0.5, p.y, ectx.isometric);
  const px = _ppx, py = _ppy + pyOffset;

  const animFrame = 5 + Math.floor(state.tick / 2) % 10;

  let drewSprite = false;

  if (p.visual === 'sprite' && p.spriteKey) {
    const sprData = ectx.sprites.getProjectileSprite(p.spriteKey);
    if (sprData) {
      const [img] = sprData;
      const target = p.targetId != null ? ectx.renderUnitById.get(p.targetId) : undefined;
      const angle = p.targetX !== undefined && p.targetY !== undefined
        ? projAngle(p.x, p.y, p.targetX, p.targetY, ectx.isometric)
        : target
          ? projAngle(p.x, p.y, target.x, target.y, ectx.isometric)
          : isBottom ? -Math.PI / 2 : Math.PI / 2;
      const spin = ectx.sprites.isSpinningProjectile(p.spriteKey)
        ? (state.tick * 0.4) % (Math.PI * 2) : 0;
      const size = p.aoeRadius > 0 ? T * 1.4 : T * 1.1;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(angle + spin);
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
      ctx.restore();
      drewSprite = true;
    }
  } else if (p.visual === 'arrow') {
    const arrowData = ectx.sprites.getArrowSprite(teamIdx);
    if (arrowData) {
      const [img] = arrowData;
      const target = p.targetId != null ? ectx.renderUnitById.get(p.targetId) : undefined;
      const angle = target
        ? projAngle(p.x, p.y, target.x, target.y, ectx.isometric)
        : isBottom ? -Math.PI / 2 : Math.PI / 2;
      const size = T * 1.2;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(angle);
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
      ctx.restore();
      drewSprite = true;
    }
  } else if (p.visual === 'bone') {
    const boneData = ectx.sprites.getBoneSprite();
    if (boneData) {
      const [img] = boneData;
      const target = p.targetId != null ? ectx.renderUnitById.get(p.targetId) : undefined;
      const angle = target
        ? projAngle(p.x, p.y, target.x, target.y, ectx.isometric)
        : isBottom ? -Math.PI / 2 : Math.PI / 2;
      const spin = (state.tick * 0.4) % (Math.PI * 2);
      const size = T * 1.0;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(angle + spin);
      ctx.drawImage(img, 0, 0, 64, 64, -size / 2, -size / 2, size, size);
      ctx.restore();
      drewSprite = true;
    }
  } else if (p.visual === 'circle') {
    const meteorColor = race === Race.Goblins ? 'green' as const
      : race === Race.Demon ? 'orange' as const
      : race === Race.Geists ? 'purple' as const
      : null;
    const meteorImg = meteorColor ? ectx.sprites.getMeteoriteSprite(meteorColor) : null;
    if (meteorImg) {
      const cols = 10, rows = 6;
      const frameW = meteorImg.width / cols;
      const frameH = meteorImg.height / rows;
      const target = p.targetId != null ? ectx.renderUnitById.get(p.targetId) : undefined;
      const angle = target
        ? projAngle(p.x, p.y, target.x, target.y, ectx.isometric)
        : p.team === Team.Bottom ? -Math.PI / 2 : Math.PI / 2;
      const col = Math.floor(state.tick * 0.4) % cols;
      const drawSize = T * 1.8;
      const aspect = frameW / frameH;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(angle);
      ctx.drawImage(meteorImg, col * frameW, 0, frameW, frameH,
        -drawSize * aspect / 2, -drawSize / 2, drawSize * aspect, drawSize);
      ctx.restore();
      drewSprite = true;
    } else {
      const circRace = race ?? Race.Crown;
      const circData = ectx.sprites.getCircleSprite(circRace);
      if (circData) {
        const [img, def] = circData;
        const size = T * 1.6;
        drawGridFrame(ctx, img, def, animFrame, px - size / 2, py - size / 2, size, size);
        drewSprite = true;
      }
    }
  } else if (p.visual === 'cannonball') {
    const r = T * 0.5;
    const cbTarget = p.targetId != null ? ectx.renderUnitById.get(p.targetId) : undefined;
    const cbAngle = p.targetX !== undefined && p.targetY !== undefined
      ? projAngle(p.x, p.y, p.targetX, p.targetY, ectx.isometric)
      : cbTarget
        ? projAngle(p.x, p.y, cbTarget.x, cbTarget.y, ectx.isometric)
        : isBottom ? -Math.PI / 2 : Math.PI / 2;
    const tdx = Math.cos(cbAngle);
    const tdy = Math.sin(cbAngle);
    ctx.beginPath();
    ctx.arc(px - tdx * T * 1.2, py - tdy * T * 1.2, r * 0.7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 100, 0, 0.3)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px - tdx * T * 0.6, py - tdy * T * 0.6, r * 0.85, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 150, 0, 0.4)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(px - r * 0.3, py - r * 0.3, 0, px, py, r);
    grad.addColorStop(0, '#555');
    grad.addColorStop(0.6, '#222');
    grad.addColorStop(1, '#000');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px - r * 0.25, py - r * 0.25, r * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.fill();
    drewSprite = true;
  } else if (p.visual === 'bolt') {
    const boltRace = race ?? Race.Crown;
    const orbData = ectx.sprites.getOrbSprite(boltRace);
    if (orbData) {
      const [img, def] = orbData;
      const size = T * 1.2;
      drawGridFrame(ctx, img, def, animFrame, px - size / 2, py - size / 2, size, size);
      drewSprite = true;
    }
  } else if (p.visual === 'orb') {
    const orbRace = race ?? Race.Crown;
    const orbData = ectx.sprites.getOrbSprite(orbRace);
    if (orbData) {
      const [img, def] = orbData;
      const size = T * 1.0;
      drawGridFrame(ctx, img, def, animFrame, px - size / 2, py - size / 2, size, size);
      drewSprite = true;
    }
  }

  if (!drewSprite) {
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fillStyle = isBottom ? '#4fc3f7' : '#ff8a65';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px, py, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }
}

// ── drawOneUnit ──

export function drawOneUnit(ctx: CanvasRenderingContext2D, state: GameState, u: UnitState, ectx: EntityDrawContext): void {
  {
    const playerColor = PLAYER_COLORS[u.playerId % PLAYER_COLORS.length];
    const px = ectx.cachedPx, py = ectx.cachedPy;
    const laneColor = u.lane === Lane.Left ? LANE_LEFT_COLOR : LANE_RIGHT_COLOR;
    const r = u.range > 2 ? 3 : 4;
    const cx = px + T / 2;
    const soulScale = (u.soulStacks ?? 0) > 0 ? 1 + Math.min(u.soulStacks!, 20) * (0.4 / 20) : 1;
    const tierScale = (u.isChampion ? 3.0 : 1.0 + (u.upgradeTier ?? 0) * 0.15) * soulScale;

    const shadowAlpha = ectx.dayNightBrightness * 0.2;
    ctx.fillStyle = `rgba(0,0,0,${shadowAlpha})`;
    ctx.beginPath();
    ctx.ellipse(cx, py + T * 0.70, 5 * tierScale, 2, 0, 0, Math.PI * 2);
    ctx.fill();

    if (u.isChampion) {
      const glowPulse = 0.5 + 0.5 * Math.sin(state.tick * 0.15);
      const glowR = T * 1.2 + glowPulse * T * 0.3;
      ctx.save();
      ctx.globalAlpha = 0.25 + glowPulse * 0.15;
      ctx.fillStyle = '#00ffff';
      ctx.beginPath();
      isoArc(ctx, cx, py + T * 0.5, glowR, ectx.isometric);
      ctx.fill();
      ctx.restore();
    }

    // Horde aura visuals
    const sp = u.upgradeSpecial;
    const hasSourceAura = sp && (
      (sp.auraDamageBonus ?? 0) > 0 || (sp.auraSpeedBonus ?? 0) > 0 ||
      (sp.auraArmorBonus ?? 0) > 0 || (sp.auraAttackSpeedBonus ?? 0) > 0 ||
      (sp.auraHealPerSec ?? 0) > 0 || (sp.auraDodgeBonus ?? 0) > 0
    );
    if (hasSourceAura) {
      let auraColor = '#ff9800';
      if ((sp.auraDamageBonus ?? 0) > 0) auraColor = '#ff5722';
      else if ((sp.auraArmorBonus ?? 0) > 0) auraColor = '#42a5f5';
      else if ((sp.auraSpeedBonus ?? 0) > 0) auraColor = '#66bb6a';
      else if ((sp.auraAttackSpeedBonus ?? 0) > 0) auraColor = '#ffd740';
      else if ((sp.auraHealPerSec ?? 0) > 0) auraColor = '#81c784';
      else if ((sp.auraDodgeBonus ?? 0) > 0) auraColor = '#ce93d8';

      const auraPulse = 0.6 + 0.4 * Math.sin(state.tick * 0.08);
      const auraRadius = T * 0.9;
      const feetY = py + T * 0.70;
      ctx.save();
      ctx.globalAlpha = 0.18 * auraPulse;
      ctx.strokeStyle = auraColor;
      ctx.lineWidth = 1.5;
      const rot = state.tick * 0.03;
      ctx.beginPath();
      ctx.ellipse(cx, feetY, auraRadius, auraRadius * 0.35, rot, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.06 * auraPulse;
      ctx.fillStyle = auraColor;
      ctx.beginPath();
      ctx.ellipse(cx, feetY, auraRadius * 0.7, auraRadius * 0.25, rot, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const hasReceivedAura = sp && (
      (sp._auraDmg ?? 0) > 0 || (sp._auraSpd ?? 0) > 0 ||
      (sp._auraArmor ?? 0) > 0 || (sp._auraAtkSpd ?? 0) > 0 ||
      (sp._auraHeal ?? 0) > 0 || (sp._auraDodge ?? 0) > 0
    );
    if (hasReceivedAura && !hasSourceAura) {
      let buffColor = '#ff9800';
      const bestAura = Math.max(sp._auraDmg ?? 0, sp._auraSpd ?? 0, sp._auraArmor ?? 0,
        sp._auraAtkSpd ?? 0, sp._auraHeal ?? 0, sp._auraDodge ?? 0);
      if (bestAura === (sp._auraDmg ?? 0) && bestAura > 0) buffColor = '#ff5722';
      else if (bestAura === (sp._auraArmor ?? 0) && bestAura > 0) buffColor = '#42a5f5';
      else if (bestAura === (sp._auraSpd ?? 0) && bestAura > 0) buffColor = '#66bb6a';
      else if (bestAura === (sp._auraAtkSpd ?? 0) && bestAura > 0) buffColor = '#ffd740';
      else if (bestAura === (sp._auraHeal ?? 0) && bestAura > 0) buffColor = '#81c784';
      else if (bestAura === (sp._auraDodge ?? 0) && bestAura > 0) buffColor = '#ce93d8';

      const buffPulse = 0.5 + 0.5 * Math.sin(state.tick * 0.12 + u.id * 0.7);
      ctx.save();
      ctx.globalAlpha = 0.15 + buffPulse * 0.1;
      ctx.fillStyle = buffColor;
      ctx.beginPath();
      ctx.arc(cx, py + T * 0.70, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const race = u.spriteRace ?? state.players[u.playerId]?.race;
    const cat = u.category as 'melee' | 'ranged' | 'caster';
    const attackCooldownTicks = Math.max(1, Math.round(u.attackSpeed * TICK_RATE));
    const attackingBuilding = u._attackBuildingIdx !== undefined;
    const attackActive = u.attackTimer > 0 && (u.targetId !== null || attackingBuilding);
    const hasDedicatedAttackSprite = race != null && ectx.sprites.hasAttackSprite(race, cat, u.upgradeNode);
    const justFired = u.attackTimer > attackCooldownTicks * 0.5;
    const isAttacking = hasDedicatedAttackSprite ? attackActive : (justFired && attackActive);
    const isRangedOnCooldown = u.attackTimer > 0 && !justFired
      && (u.targetId !== null || attackingBuilding) && (cat === 'ranged' || cat === 'caster');
    const isStationary = !ectx.movedThisTick.has(u.id);
    const preferIdleSprite = !isAttacking && isStationary;
    const spriteData = race ? ectx.sprites.getUnitSprite(race, cat, u.playerId, isAttacking, u.upgradeNode, preferIdleSprite) : null;
    if (spriteData) {
      const [img, def] = spriteData;
      const spriteScale = def.scale ?? 1.0;
      const unitVisScale = u.visualScale ?? 1.0;
      const baseH = T * 1.82 * spriteScale * tierScale * unitVisScale;
      const aspect = def.frameW / def.frameH;
      const drawW2 = baseH * aspect;
      const drawH2 = baseH * (def.heightScale ?? 1.0);
      const hasAtkSprite = isAttacking && hasDedicatedAttackSprite;
      const hasIdleSprite = !isAttacking && race != null && ectx.sprites.hasIdleSprite(race, cat, u.upgradeNode);
      const idleWhileAttacking = isAttacking && (cat === 'ranged' || cat === 'caster') && !hasAtkSprite;
      let frame: number;
      if (idleWhileAttacking || isRangedOnCooldown || (isStationary && !isAttacking && !hasIdleSprite)) {
        frame = 0;
      } else if (hasIdleSprite && isStationary && !isAttacking) {
        frame = getSpriteFrame(state.tick, def);
      } else if (hasAtkSprite) {
        const elapsed = attackCooldownTicks - u.attackTimer;
        const totalFrames = def.cols * (def.rows ?? 1);
        frame = Math.min(totalFrames - 1, Math.floor(elapsed * totalFrames / attackCooldownTicks));
      } else {
        frame = getSpriteFrame(state.tick, def);
      }
      const feetY = py + T * 0.70;
      const drawY2 = feetY - drawH2 * (def.groundY ?? 0.71);

      let faceLeft = updateFacing(ectx, u.id, u.x, u.team === Team.Top);
      if (u.targetId !== null) {
        const target = ectx.renderUnitById.get(u.targetId!);
        if (target) {
          const dx = target.x - u.x;
          if (Math.abs(dx) > 0.5) {
            faceLeft = dx < 0;
          } else {
            faceLeft = u.team === Team.Top;
          }
          ectx.facing.set(u.id, faceLeft);
        }
      } else if (attackingBuilding) {
        if (u._attackBuildingIdx! >= 0) {
          const b = state.buildings[u._attackBuildingIdx!];
          if (b) {
            const bx = b.worldX + 0.5 - u.x;
            faceLeft = Math.abs(bx) > 0.5 ? bx < 0 : u.team === Team.Top;
            ectx.facing.set(u.id, faceLeft);
          }
        } else {
          const enemyTeam = u.team === Team.Bottom ? Team.Top : Team.Bottom;
          const hq = getHQPosition(enemyTeam, state.mapDef);
          const bx = hq.x + 2 - u.x;
          faceLeft = Math.abs(bx) > 0.5 ? bx < 0 : u.team === Team.Top;
          ectx.facing.set(u.id, faceLeft);
        }
      }
      const ax = def.anchorX ?? 0.5;
      const effectiveFaceLeft = def.flipX ? !faceLeft : faceLeft;
      if (effectiveFaceLeft) {
        ctx.save();
        ctx.translate(cx, 0);
        ctx.scale(-1, 1);
        drawSpriteFrame(ctx, img, def, frame, -drawW2 * (1 - ax), drawY2, drawW2, drawH2);
        ctx.restore();
      } else {
        drawSpriteFrame(ctx, img, def, frame, cx - drawW2 * ax, drawY2, drawW2, drawH2);
      }
      if (ectx.hitFlash.consume(u.id)) {
        ctx.globalAlpha = 0.55;
        ctx.globalCompositeOperation = 'lighter';
        if (effectiveFaceLeft) {
          ctx.save();
          ctx.translate(cx, 0);
          ctx.scale(-1, 1);
          drawSpriteFrame(ctx, img, def, frame, -drawW2 * (1 - ax), drawY2, drawW2, drawH2);
          ctx.restore();
        } else {
          drawSpriteFrame(ctx, img, def, frame, cx - drawW2 * ax, drawY2, drawW2, drawH2);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
      const tier = u.upgradeTier ?? 0;
      if (tier >= 1) {
        ctx.fillStyle = tier >= 2 ? '#ffd740' : '#90caf9';
        ctx.fillRect(cx - 1, drawY2 - 2, 2 + tier, 2);
      }
    } else {
      const scaledR = r * tierScale;
      drawUnitShape(ctx, px + T / 2, py + T / 2, scaledR, race, u.category, u.team, playerColor);
      const tier = u.upgradeTier ?? 0;
      if (tier >= 1) {
        ctx.strokeStyle = playerColor;
        ctx.lineWidth = tier;
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        isoArc(ctx, px + T / 2, py + T / 2, scaledR + 2, ectx.isometric);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    ctx.fillStyle = laneColor;
    ctx.fillRect(cx - 1, py - 2, 2, 2);

    const ux = px + T / 2, uy = py + T / 2;

    const fxTick = Math.floor(ectx.frameNow / 100);
    const fxSize = r * 3.5;

    for (const eff of u.statusEffects) {
      if (eff.type === StatusType.Burn) {
        const fxData = ectx.sprites.getFxSprite('burn');
        if (fxData) {
          const [fxImg, fxDef] = fxData;
          ctx.globalAlpha = Math.min(0.5 + 0.15 * eff.stacks, 1);
          drawSpriteFrame(ctx, fxImg, fxDef as SpriteDef, fxTick + u.id, ux - fxSize / 2, uy - fxSize * 0.8, fxSize, fxSize);
          ctx.globalAlpha = 1;
        }
      }
      if (eff.type === StatusType.Slow) {
        const fxData = ectx.sprites.getFxSprite('slow');
        if (fxData) {
          const [fxImg, fxDef] = fxData;
          ctx.globalAlpha = Math.min(0.4 + 0.15 * eff.stacks, 0.9);
          drawSpriteFrame(ctx, fxImg, fxDef as SpriteDef, fxTick + u.id * 3, ux - fxSize / 2, uy - fxSize * 0.6, fxSize, fxSize);
          ctx.globalAlpha = 1;
        }
      }
      if (eff.type === StatusType.Haste) {
        const fxData = ectx.sprites.getFxSprite('haste');
        if (fxData) {
          const [fxImg, fxDef] = fxData;
          ctx.globalAlpha = 0.6;
          drawSpriteFrame(ctx, fxImg, fxDef as SpriteDef, fxTick + u.id * 2, ux - fxSize / 2, uy - fxSize * 0.7, fxSize, fxSize);
          ctx.globalAlpha = 1;
        }
      }
      if (eff.type === StatusType.Wound) {
        ctx.globalAlpha = 0.5 + 0.2 * Math.sin(ectx.frameNow / 200 + u.id);
        const ws = r * 1.8;
        const wcx = ux, wcy = uy - r * 2;
        ctx.strokeStyle = '#9c27b0';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(wcx - ws / 2, wcy - ws / 2);
        ctx.lineTo(wcx + ws / 2, wcy + ws / 2);
        ctx.moveTo(wcx + ws / 2, wcy - ws / 2);
        ctx.lineTo(wcx - ws / 2, wcy + ws / 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (eff.type === StatusType.Stun) {
        // Spinning yellow stars above stunned unit
        ctx.globalAlpha = 0.7 + 0.2 * Math.sin(ectx.frameNow / 150 + u.id);
        const starR = r * 1.5;
        const starY = uy - r * 2.5;
        const starCount = 3;
        ctx.fillStyle = '#ffeb3b';
        ctx.strokeStyle = '#f57f17';
        ctx.lineWidth = 0.8;
        for (let si = 0; si < starCount; si++) {
          const angle = (ectx.frameNow / 300 + u.id) + (si * Math.PI * 2 / starCount);
          const sx = ux + Math.cos(angle) * starR;
          const sy = starY + Math.sin(angle) * starR * 0.4;
          const ss = r * 0.6;
          // 4-point star
          ctx.beginPath();
          ctx.moveTo(sx, sy - ss); ctx.lineTo(sx + ss * 0.3, sy);
          ctx.lineTo(sx, sy + ss); ctx.lineTo(sx - ss * 0.3, sy);
          ctx.closePath();
          ctx.fill(); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      if (eff.type === StatusType.Shield) {
        const fxData = ectx.sprites.getFxSprite('shield');
        if (fxData) {
          const [fxImg, fxDef] = fxData;
          const shieldSize = fxSize * 1.3;
          ctx.globalAlpha = 0.5;
          drawGridFrame(ctx, fxImg, fxDef as GridSpriteDef, fxTick + u.id, ux - shieldSize / 2, uy - shieldSize / 2, shieldSize, shieldSize);
          ctx.globalAlpha = 1;
        }
        const starImg = ectx.sprites.getStarShineSprite('blue');
        if (starImg) {
          const starCols = 13;
          const starFW = starImg.width / starCols;
          const starFH = starImg.height;
          const starFrame = (fxTick + u.id * 3) % starCols;
          const starSize = fxSize * 1.1;
          const starAspect = starFW / starFH;
          ctx.globalAlpha = 0.55;
          ctx.drawImage(starImg, starFrame * starFW, 0, starFW, starFH,
            ux - starSize * starAspect / 2, uy - starSize * 0.8, starSize * starAspect, starSize);
          ctx.globalAlpha = 1;
        }
      }
    }

    if (u.hp < u.maxHp || u.isChampion) {
      const barW = 12, barH = 2.5;
      const barX = ux - barW / 2, barY = py - 1;
      const targetPct = u.hp / u.maxHp;
      const prevPct = ectx.smoothHp.get(u.id) ?? targetPct;
      const displayPct = prevPct + (targetPct - prevPct) * 0.15;
      ectx.smoothHp.set(u.id, displayPct);

      ctx.fillStyle = '#111';
      ctx.fillRect(barX - 0.5, barY - 0.5, barW + 1, barH + 1);
      ctx.fillStyle = u.isChampion ? '#00e5ff'
        : displayPct > 0.5 ? '#66bb6a'
        : displayPct > 0.25 ? '#ffa726'
        : '#ef5350';
      ctx.fillRect(barX, barY, barW * displayPct, barH);
      if (displayPct > targetPct + 0.01) {
        ctx.fillStyle = 'rgba(255, 50, 50, 0.5)';
        ctx.fillRect(barX + barW * targetPct, barY, barW * (displayPct - targetPct), barH);
      }
    } else {
      ectx.smoothHp.delete(u.id);
    }

    if (u.shieldHp > 0) {
      const barW = 12, barH = 1.5;
      const barX = ux - barW / 2, barY = py + 2;
      ctx.fillStyle = 'rgba(100, 181, 246, 0.7)';
      ctx.fillRect(barX, barY, barW * Math.min(1, u.shieldHp / 12), barH);
    }

    if (u.carryingDiamond) {
      ctx.beginPath(); ctx.arc(ux, uy, 7, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    }

    if (u.attackTimer > 0 && u.attackTimer > Math.round(u.attackSpeed * 20) - 3) {
      ctx.beginPath(); ctx.arc(ux, uy, r + 3, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

// ── drawOneHarvester ──

export function drawOneHarvester(ctx: CanvasRenderingContext2D, state: GameState, h: HarvesterState, ectx: EntityDrawContext): void {
  {
    const px = ectx.cachedPx, py = ectx.cachedPy;

    ctx.fillStyle = ectx.harvShadowStyle;
    ctx.beginPath();
    ctx.ellipse(px, py + 2, 4, 2, 0, 0, Math.PI * 2);
    ctx.fill();

    const spriteData = ectx.sprites.getHarvesterSprite(h.playerId, h.state, h.carryingResource, h.assignment);
    if (spriteData) {
      const [img, def] = spriteData;
      const hScale = def.scale ?? 1.0;
      const drawH = T * 1.56 * hScale;
      const aspect = def.frameW / def.frameH;
      const drawW = drawH * aspect;
      const frame = getSpriteFrame(state.tick, def);

      const faceLeft = updateFacing(ectx, -h.id, h.x, h.team === Team.Top);
      const hFeetY = py + T * 0.17;
      const hDrawY = hFeetY - drawH * (def.groundY ?? 0.71);

      if (faceLeft) {
        ctx.save();
        ctx.translate(px, 0);
        ctx.scale(-1, 1);
        drawSpriteFrame(ctx, img, def, frame, -drawW / 2, hDrawY, drawW, drawH);
        ctx.restore();
      } else {
        drawSpriteFrame(ctx, img, def, frame, px - drawW / 2, hDrawY, drawW, drawH);
      }
    } else {
      let color = PLAYER_COLORS[h.playerId % PLAYER_COLORS.length];
      if (h.state === 'fighting') color = '#ff5722';
      ctx.beginPath();
      ctx.moveTo(px, py - 4); ctx.lineTo(px + 4, py + 4); ctx.lineTo(px - 4, py + 4);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }

    if (h.carryingResource === ResourceType.Wood && h.carryAmount > 0 && h.state === 'walking_home') {
      const faceLeft = updateFacing(ectx, -h.id, h.x, h.team === Team.Top);
      const bundleX = px + (faceLeft ? -7 : 7);
      const bundleY = py - 5;
      const logData = ectx.sprites.getResourceSprite('woodResource');
      if (logData) {
        const [img, def] = logData;
        const sz = 10;
        drawSpriteFrame(ctx, img, def, 0, bundleX - sz / 2, bundleY - sz / 2, sz, sz);
      } else {
        ctx.fillStyle = '#8d5a35';
        ctx.fillRect(bundleX - 4, bundleY - 2, 8, 4);
      }
    }

    if (h.carryingDiamond) {
      ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    }

    let frightened = ectx.harvesterFrightened.get(h.id) ?? false;
    if (state.tick % 10 === 0 || !ectx.harvesterFrightened.has(h.id)) {
      frightened = false;
      for (const u of state.units) {
        if (u.team === h.team || u.hp <= 0) continue;
        const edx = u.x - h.x, edy = u.y - h.y;
        if (edx * edx + edy * edy <= 25) { frightened = true; break; }
      }
      ectx.harvesterFrightened.set(h.id, frightened);
    }
    if (frightened) {
      const fxData = ectx.sprites.getFxSprite('slow');
      if (fxData) {
        const [fxImg, fxDef] = fxData;
        const fxSize = T * 0.7;
        const fxTick = Math.floor(state.tick / 4) % fxDef.cols;
        ctx.globalAlpha = 0.55;
        drawSpriteFrame(ctx, fxImg, fxDef as SpriteDef, fxTick + h.id * 3, px - fxSize / 2, py - fxSize * 0.6, fxSize, fxSize);
        ctx.globalAlpha = 1;
      }
    }

    if (h.assignment === HarvesterAssignment.Mana) {
      const glowPulse = 0.4 + 0.3 * Math.sin(state.tick * 0.15 + h.id);
      ctx.beginPath();
      ctx.arc(px, py - 2, 6, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(124, 77, 255, ${glowPulse})`;
      ctx.fill();
    }

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
