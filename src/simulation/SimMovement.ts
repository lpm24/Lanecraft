/**
 * Unit spawning, movement, pathfinding, collision, and damage/status application.
 *
 * Tick functions (called from simulateTick in GameState.ts):
 *   tickSpawners        — spawn units from buildings on cooldown
 *   tickUnitMovement    — lane following, chase/flank, melee attacks, building attacks
 *   tickUnitDiamondPickup — diamond carrier logic
 *   tickPotionPickups   — potion drop collection
 *   tickUnitCollision   — unit-vs-unit pushout
 *
 * Shared helpers (used by SimCombat, SimAbilities, SimHarvesters):
 *   dealDamage, applyStatus, applyKnockback, healUnit, trackHealing
 *   getEffectiveSpeed, getEffectiveDamage, clampToArenaBounds
 *   findTilePath, moveWithSlide, computeHarvesterPath
 */
import {
  GameState, Team, Race, Lane, MapDef,
  BuildingType, UnitState,
  StatusType, PotionType,
  TICK_RATE, MAP_WIDTH, MAP_HEIGHT, HQ_WIDTH, HQ_HEIGHT,
  DIAMOND_CENTER_X, DIAMOND_CENTER_Y, DIAMOND_HALF_W, DIAMOND_HALF_H,
  GoldCell, getMarginAtRow,
  SoundEvent,
} from './types';
import {
  UNIT_STATS, SPAWN_INTERVAL_TICKS,
  getUpgradeNodeDef,
} from './data';
import {
  genId, getUnitUpgradeMultipliers, getResearchMultipliers,
  addSound, addFloatingText, addDeathParticles, addCombatEvent,
  compactInPlace, hasStatus,
  _combatGrid, _collisionGrid, _unitById, _attackerCount,
  _spawnOrder, _moveOrder, _alleyBuildingsBottom, _alleyBuildingsTop,
  _diamondCellMapInt, _buildingIdSet,
  incStatusBurnSounds, incStatusShieldSounds, incStatusHasteSounds, incStatusSlowSounds,
  incStatusFrenzySounds, incWoundSounds, incVulnerableSounds,
} from './SimShared';
import {
  getHQPosition,
  getLanePath, interpolatePath,
  getCachedPathLength, getChokeSpreadMultiplier,
} from './SimLayout';
import { spawnDiamondChampion, resetDiamondForRespawn } from './SimAbilities';

// === Unit Spawning ===

export function tickSpawners(state: GameState): void {
  let spawnSounds = 0;
  // Shuffle spawn order to prevent first-player advantage in unit creation
  _spawnOrder.length = 0;
  for (const b of state.buildings) _spawnOrder.push(b);
  const spawnOrder = _spawnOrder;
  for (let i = spawnOrder.length - 1; i > 0; i--) {
    const j = Math.floor(state.rng() * (i + 1));
    const tmp = spawnOrder[i]; spawnOrder[i] = spawnOrder[j]; spawnOrder[j] = tmp;
  }
  for (const building of spawnOrder) {
    if (building.type === BuildingType.Tower || building.type === BuildingType.HarvesterHut || building.type === BuildingType.Research) continue;
    building.actionTimer--;
    if (building.actionTimer <= 0) {
      const player = state.players[building.playerId];
      const stats = UNIT_STATS[player.race]?.[building.type];
      if (!stats) continue;
      const upgrade = getUnitUpgradeMultipliers(building.upgradePath, player.race, building.type);
      building.actionTimer = Math.round(SPAWN_INTERVAL_TICKS * upgrade.spawnSpeed);
      const category: UnitState['category'] =
        building.type === BuildingType.CasterSpawner ? 'caster' :
        building.type === BuildingType.RangedSpawner ? 'ranged' : 'melee';
      const researchMult = getResearchMultipliers(player, category);
      // Race one-shot HP bonuses
      const bu = player.researchUpgrades;
      let raceHpMult = 1;
      let raceMoveSpeedMult = 1;
      if (category === 'melee') {
        if (bu.raceUpgrades['crown_melee_2']) raceHpMult *= 1.15;
        if (bu.raceUpgrades['horde_melee_2']) raceHpMult *= 1.25;
        if (bu.raceUpgrades['deep_melee_1']) raceHpMult *= 1.15;
        if (bu.raceUpgrades['goblins_melee_2']) raceMoveSpeedMult *= 1.35;
      }
      const count = upgrade.special.spawnCount ?? stats.spawnCount ?? 1;
      // Oozlings Mass Division: spawn 3 instead of 2 for casters
      const finalCount = (category === 'caster' && bu.raceUpgrades['oozlings_caster_2'] && count >= 2) ? 3 : count;
      for (let si = 0; si < finalCount; si++) {
        // Oozlings: random lane per unit (supports any number of lanes)
        const unitLane = (player.race === Race.Oozlings && finalCount >= 2)
          ? (state.rng() < 0.5 ? Lane.Left : Lane.Right)
          : building.lane;
        state.units.push({
          id: genId(state), type: stats.name, playerId: building.playerId, team: player.team,
          x: building.worldX + (si * 0.3), y: building.worldY,
          hp: Math.max(1, Math.round(stats.hp * upgrade.hp * raceHpMult * (player.statBonus ?? 1))),
          maxHp: Math.max(1, Math.round(stats.hp * upgrade.hp * raceHpMult * (player.statBonus ?? 1))),
          damage: Math.max(1, Math.round(stats.damage * upgrade.damage * researchMult.damageMult * (player.statBonus ?? 1))),
          attackSpeed: Math.max(0.2, stats.attackSpeed * upgrade.attackSpeed), attackTimer: 0,
          moveSpeed: Math.max(0.5, stats.moveSpeed * upgrade.moveSpeed * raceMoveSpeedMult),
          range: Math.max(1, stats.range * upgrade.range),
          targetId: null, lane: unitLane, pathProgress: -1, carryingDiamond: false,
          statusEffects: [], hitCount: 0, shieldHp: 0, category,
          upgradeTier: building.upgradePath.length - 1,
          upgradeNode: building.upgradePath[building.upgradePath.length - 1] ?? 'A',
          upgradeSpecial: upgrade.special, kills: 0, damageDone: 0, damageTaken: 0, healingDone: 0, buffsApplied: 0, lastDamagedByName: '', spawnTick: state.tick,
        });
        if (state.playerStats[building.playerId]) state.playerStats[building.playerId].unitsSpawned++;
      }
      if (spawnSounds < 2) { addSound(state, 'unit_spawn', building.worldX, building.worldY); spawnSounds++; }
    }
  }
}

// === Speed / Damage Helpers ===

export function getEffectiveSpeed(unit: UnitState, gameState?: GameState): number {
  let speed = unit.moveSpeed;
  let isSlowed = false;
  for (const eff of unit.statusEffects) {
    if (eff.type === StatusType.Slow) { speed *= Math.max(0.5, 1 - 0.1 * eff.stacks); isSlowed = true; }
    if (eff.type === StatusType.Haste) speed *= (eff.stacks >= 2 ? 1.6 : 1.3);
  }
  // Deep Freezing Depths: slowed units move 15% slower
  if (isSlowed && gameState) {
    for (const p of gameState.players) {
      if (p.isEmpty || p.race !== Race.Deep || p.team === unit.team) continue;
      if (p.researchUpgrades.raceUpgrades['deep_ability_3']) { speed *= 0.85; break; }
    }
  }
  // Wild Pack Speed: +10% global move speed for units
  if (gameState) {
    const unitPlayer = gameState.players[unit.playerId];
    if (unitPlayer?.researchUpgrades.raceUpgrades['wild_ability_3']) speed *= 1.10;
  }
  // Horde aura speed bonus
  const auraSpd = unit.upgradeSpecial?._auraSpd ?? 0;
  if (auraSpd > 0) speed *= (1 + auraSpd);
  return speed;
}

/** Get damage with status effect multipliers (Frenzy = +50% damage) + aura bonuses */
export function getEffectiveDamage(unit: UnitState, state?: GameState): number {
  let dmg = unit.damage;
  for (const eff of unit.statusEffects) {
    if (eff.type === StatusType.Frenzy) dmg = Math.round(dmg * (eff.stacks >= 2 ? 2.0 : 1.5));
  }
  // Horde aura damage bonus
  const auraDmg = unit.upgradeSpecial?._auraDmg ?? 0;
  if (auraDmg > 0) dmg += auraDmg;
  // Crown: Aegis Wrath — shielded allies deal +25% damage
  if (state && unit.shieldHp > 0) {
    const p = state.players[unit.playerId];
    if (p?.researchUpgrades.raceUpgrades['crown_ability_3']) dmg = Math.round(dmg * 1.25);
  }
  // Geists Hungering Dark: lifesteal % also increases damage by the same amount
  if (state) {
    const gp = state.players[unit.playerId];
    if (gp?.race === Race.Geists && gp.researchUpgrades.raceUpgrades['geists_ability_4']) {
      // Base lifesteal: melee 10%, ranged 10%, caster 10% (projectile)
      let lsPct = 0.10;
      // Death Grip: melee lifesteal +5%
      if (unit.category === 'melee' && gp.researchUpgrades.raceUpgrades['geists_melee_1']) lsPct += 0.05;
      // Soul Arrows: ranged lifesteal +5%
      if (unit.category === 'ranged' && gp.researchUpgrades.raceUpgrades['geists_ranged_1']) lsPct += 0.05;
      if (lsPct > 0) dmg = Math.round(dmg * (1 + lsPct));
    }
  }
  return dmg;
}

// === Unit Movement (lane following, chase, melee/building attacks) ===

export function tickUnitMovement(state: GameState): void {
  // Pre-filter alley buildings per team once (avoids O(units × buildings) inner loop)
  _alleyBuildingsBottom.length = 0;
  _alleyBuildingsTop.length = 0;
  for (const b of state.buildings) {
    if (b.buildGrid !== 'alley' || b.hp <= 0) continue;
    const bp = state.players[b.playerId];
    if (!bp) continue;
    const entry = { x: b.worldX + 0.5, y: b.worldY + 0.5 };
    if (bp.team === Team.Bottom) _alleyBuildingsBottom.push(entry);
    else _alleyBuildingsTop.push(entry);
  }

  // Shuffle movement order to prevent first-mover positional advantage
  _moveOrder.length = 0;
  for (const u of state.units) _moveOrder.push(u);
  const moveOrder = _moveOrder;
  for (let i = moveOrder.length - 1; i > 0; i--) {
    const j = Math.floor(state.rng() * (i + 1));
    const tmp = moveOrder[i]; moveOrder[i] = moveOrder[j]; moveOrder[j] = tmp;
  }
  for (const unit of moveOrder) {
    if (unit.targetId !== null) continue;

    // Stop marching when an enemy alley building or HQ is within attack range.
    // Siege units skip this; they have their own building-targeting logic.
    if (!unit.upgradeSpecial?.isSiegeUnit) {
      const tRange = unit.range + 1.5;
      const tRange2 = tRange * tRange;
      let stopForBuilding = false;
      // Check only enemy team's alley buildings (pre-filtered)
      const enemyAlleyBuildings = unit.team === Team.Bottom ? _alleyBuildingsTop : _alleyBuildingsBottom;
      for (const ab of enemyAlleyBuildings) {
        const dx = ab.x - unit.x, dy = ab.y - unit.y;
        if (dx * dx + dy * dy <= tRange2) { stopForBuilding = true; break; }
      }
      if (!stopForBuilding) {
        // Also stop for enemy HQ
        const enemyTeam = unit.team === Team.Bottom ? Team.Top : Team.Bottom;
        const hq = getHQPosition(enemyTeam, state.mapDef);
        const hqCx = hq.x + HQ_WIDTH / 2;
        const hqCy = hq.y + HQ_HEIGHT / 2;
        const hqRadius = Math.max(HQ_WIDTH, HQ_HEIGHT) * 0.5;
        const hqDist2 = (unit.x - hqCx) ** 2 + (unit.y - hqCy) ** 2;
        const hqThresh = unit.range + hqRadius;
        if (hqDist2 <= hqThresh * hqThresh) stopForBuilding = true;
      }
      if (stopForBuilding) continue;
    }

    const speed = getEffectiveSpeed(unit, state);
    let movePerTick = speed / TICK_RATE;

    // Phase 1: Walking from building to lane path start
    if (unit.pathProgress < 0) {
      const path = getLanePath(unit.team, unit.lane, state.mapDef);
      const target = path[0]; // first waypoint
      const dx = target.x - unit.x, dy = target.y - unit.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < movePerTick * 2) {
        // Close enough — join the lane path
        unit.pathProgress = 0;
        unit.x = target.x;
        unit.y = target.y;
      } else {
        moveWithSlide(unit, target.x, target.y, movePerTick, state.diamondCells, state.mapDef);
      }
      continue;
    }

    // Phase 2: Following lane path
    const path = getLanePath(unit.team, unit.lane, state.mapDef);
    const pathLen = getCachedPathLength(unit.team, unit.lane, state.mapDef);
    const preX = unit.x, preY = unit.y;

    // Ranged + caster units prefer to stay behind nearest allied melee — but only near enemies
    if (unit.category === 'ranged' || unit.category === 'caster') {
      // Only engage formation behavior when enemies are within threat range
      const threatRange = unit.range + 6;
      let enemyNearby = false;
      const nearbyUnits = _combatGrid.getNearby(unit.x, unit.y, threatRange);
      for (const other of nearbyUnits) {
        if (other.team === unit.team) continue;
        const dx = other.x - unit.x, dy = other.y - unit.y;
        if (dx * dx + dy * dy <= threatRange * threatRange) { enemyNearby = true; break; }
      }
      if (enemyNearby) {
        let nearestMeleeProgress = -1;
        let nearestMeleeDist = Infinity;
        for (const other of nearbyUnits) {
          if (other.id === unit.id || other.team !== unit.team || other.lane !== unit.lane) continue;
          if (other.category !== 'melee' || other.pathProgress < 0) continue;
          const d = Math.abs(other.pathProgress - unit.pathProgress);
          if (d < nearestMeleeDist) { nearestMeleeDist = d; nearestMeleeProgress = other.pathProgress; }
        }
        if (nearestMeleeProgress >= 0) {
          // Casters hang further back than ranged (they have AoE, don't need to be close)
          const behind = unit.category === 'caster' ? 4.5 : 3;
          const behindOffset = behind / pathLen;
          const idealProgress = nearestMeleeProgress - behindOffset;
          if (unit.pathProgress > idealProgress + 0.005) {
            // Too far forward — slow down significantly
            movePerTick *= 0.2;
          }
        }
      }
    }

    // Slight crowd slow-down so large groups keep a front line instead of "train" behavior.
    // Reduced from original values to prevent armies from stalling into immovable blobs.
    let nearbyFriendlies = 0;
    const crowdNearby = _combatGrid.getNearby(unit.x, unit.y, 1.35);
    for (const other of crowdNearby) {
      if (other.id === unit.id || other.team !== unit.team || other.lane !== unit.lane) continue;
      if (other.pathProgress < 0 || unit.pathProgress < 0) continue;
      if (Math.abs(other.pathProgress - unit.pathProgress) > 0.04) continue;
      const d = Math.sqrt((other.x - unit.x) ** 2 + (other.y - unit.y) ** 2);
      if (d < 1.35) nearbyFriendlies++;
    }
    const crowdFactor = Math.max(0.72, 1 - nearbyFriendlies * 0.04);
    movePerTick *= crowdFactor;

    unit.pathProgress += movePerTick / pathLen;
    if (unit.pathProgress > 1) unit.pathProgress = 1;

    // Formation offset so units naturally spread into lines while following lane flow.
    // Wider spread near enemies to create envelopment opportunities.
    let enemyClose = false;
    const formNearby = _combatGrid.getNearby(unit.x, unit.y, 8);
    for (const other of formNearby) {
      if (other.team === unit.team || other.hp <= 0) continue;
      const ed = (other.x - unit.x) ** 2 + (other.y - unit.y) ** 2;
      if (ed < 64) { enemyClose = true; break; } // 8 tile radius
    }
    const slot = (unit.id % 7) - 3; // [-3..3]
    const spreadMult = enemyClose ? 0.44 : 0.34;
    const baseOffset = slot * spreadMult;
    const jitter = ((((unit.id * 73) % 1000) / 1000) - 0.5) * 0.1;

    const pos = interpolatePath(path, unit.pathProgress);
    const posAhead = interpolatePath(path, Math.min(1, unit.pathProgress + 0.01));
    const chokeSpread = getChokeSpreadMultiplier(pos.x, pos.y, state.mapDef);

    let sep = 0;
    let sepCount = 0;
    const sepNearby = _combatGrid.getNearby(pos.x, pos.y, 2.2);
    for (const other of sepNearby) {
      if (other.id === unit.id || other.lane !== unit.lane) continue;
      const ox = other.x - pos.x;
      const oy = other.y - pos.y;
      const d = Math.sqrt(ox * ox + oy * oy);
      if (d <= 0.001 || d > 2.2) continue;
      const w = (2.2 - d) / 2.2;
      // Enemies push laterally too, so marching units spread before contact
      const teamMul = other.team === unit.team ? 1.0 : 0.5;
      sep -= (ox / d) * w * teamMul;
      sepCount++;
    }
    const separationOffset = sepCount > 0 ? Math.max(-0.7, Math.min(0.7, sep * 0.18)) : 0;

    // Reduce formation spread near the diamond so units don't get pushed into cells
    const dcx = state.mapDef?.diamondCenter.x ?? DIAMOND_CENTER_X;
    const dcy = state.mapDef?.diamondCenter.y ?? DIAMOND_CENTER_Y;
    const dhw = state.mapDef?.diamondHalfW ?? DIAMOND_HALF_W;
    const dhh = state.mapDef?.diamondHalfH ?? DIAMOND_HALF_H;
    const ddx = Math.abs(pos.x - dcx) / (dhw + 4);
    const ddy = Math.abs(pos.y - dcy) / (dhh + 4);
    const diamondProximity = ddx + ddy;
    // Inside the diamond+buffer zone, shrink formation offset
    const diamondShrink = diamondProximity < 1 ? 0.3 + 0.7 * diamondProximity : 1;

    const laneOffset = (baseOffset + jitter + separationOffset) * chokeSpread * diamondShrink;
    const tx = posAhead.x - pos.x;
    const ty = posAhead.y - pos.y;
    const tLen = Math.sqrt(tx * tx + ty * ty) || 1;
    const nx = -ty / tLen;
    const ny = tx / tLen;

    const desiredX = pos.x + nx * laneOffset;
    const desiredY = pos.y + ny * laneOffset;
    const dx = desiredX - unit.x;
    const dy = desiredY - unit.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > movePerTick && dist > 0.001) {
      moveWithSlide(unit, desiredX, desiredY, movePerTick, state.diamondCells, state.mapDef);
    } else if (!isBlocked(desiredX, desiredY, 0.45, state.diamondCells)) {
      unit.x = desiredX;
      unit.y = desiredY;
    } else {
      // Formation offset is blocked — fall back to on-path position so units don't freeze
      const fpx = pos.x - unit.x;
      const fpy = pos.y - unit.y;
      const fpd = Math.sqrt(fpx * fpx + fpy * fpy);
      if (fpd > movePerTick && fpd > 0.001) {
        moveWithSlide(unit, pos.x, pos.y, movePerTick, state.diamondCells, state.mapDef);
      } else if (!isBlocked(pos.x, pos.y, 0.45, state.diamondCells)) {
        unit.x = pos.x;
        unit.y = pos.y;
      }
    }

    // Stuck detection: if the unit didn't move at all this tick despite having speed,
    // count consecutive stuck ticks and snap to the lane path after 3.
    const moved = (unit.x - preX) ** 2 + (unit.y - preY) ** 2 > 0.0001;
    if (!moved && movePerTick > 0.001 && unit.pathProgress < 1) {
      unit.stuckTicks = (unit.stuckTicks ?? 0) + 1;
      if (unit.stuckTicks >= 3) {
        // Guard: pathProgress can drift far from actual position during combat.
        // Only snap if it would be a small correction; otherwise skip the snap
        // to avoid teleporting 40+ tiles across the map.
        const snapPos = interpolatePath(path, unit.pathProgress);
        const snapDist2 = (snapPos.x - unit.x) ** 2 + (snapPos.y - unit.y) ** 2;
        if (snapDist2 <= 25) { // ≤ 5 tiles
          unit.x = snapPos.x;
          unit.y = snapPos.y;
        }
        unit.stuckTicks = 0;
      }
    } else {
      unit.stuckTicks = 0;
    }
  }
}

const POTION_PICKUP_RADIUS = 1.5;

export function applyPotionBuff(state: GameState, unit: GameState['units'][0], type: PotionType): void {
  const unitPlayer = state.players[unit.playerId];
  const isPermanent = unitPlayer?.race === Race.Goblins && unitPlayer.researchUpgrades.raceUpgrades['goblins_ability_4'];
  // Goblins Potent Potions: 100% stronger effects (stacks=2 for haste/frenzy, double shield HP)
  const isPotent = unitPlayer?.race === Race.Goblins && unitPlayer.researchUpgrades.raceUpgrades['goblins_ability_3'];
  const dur = isPermanent ? 999 * TICK_RATE : 6 * TICK_RATE;
  const potentStacks = isPotent ? 2 : 1;
  if (type === 'speed') {
    const haste = unit.statusEffects.find(s => s.type === StatusType.Haste);
    if (haste) { haste.duration = dur; haste.stacks = potentStacks; }
    else unit.statusEffects.push({ type: StatusType.Haste, stacks: potentStacks, duration: dur });
    const speedLabel = isPermanent ? 'SPEED!' : 'SPEED';
    addFloatingText(state, unit.x, unit.y, speedLabel, '#69f0ae', undefined, undefined,
      { ftType: 'status', miniIcon: 'potion_blue' });
  } else if (type === 'rage') {
    const frenzy = unit.statusEffects.find(s => s.type === StatusType.Frenzy);
    if (frenzy) { frenzy.duration = dur; frenzy.stacks = potentStacks; }
    else unit.statusEffects.push({ type: StatusType.Frenzy, stacks: potentStacks, duration: dur });
    const rageLabel = isPermanent ? 'RAGE!' : 'RAGE';
    addFloatingText(state, unit.x, unit.y, rageLabel, '#ff5722', undefined, undefined,
      { ftType: 'status', miniIcon: 'potion_red' });
  } else {
    const shieldHp = isPotent ? 40 : 20;
    const shield = unit.statusEffects.find(s => s.type === StatusType.Shield);
    if (shield) { shield.duration = dur; shield.stacks = shieldHp; }
    else unit.statusEffects.push({ type: StatusType.Shield, stacks: shieldHp, duration: dur });
    unit.shieldHp = Math.max(unit.shieldHp, shieldHp);
    const shieldLabel = isPermanent ? 'SHIELD!' : 'SHIELD';
    addFloatingText(state, unit.x, unit.y, shieldLabel, '#42a5f5', undefined, undefined,
      { ftType: 'status', miniIcon: 'potion_green' });
  }
  addSound(state, 'ability_potion', unit.x, unit.y);
}

export function tickPotionPickups(state: GameState): void {
  if (state.potionDrops.length === 0) return;
  const toRemove = new Set<number>();

  for (let i = 0; i < state.potionDrops.length; i++) {
    const potion = state.potionDrops[i];

    // Advance flight arc
    if (potion.flightProgress < potion.flightTicks) {
      potion.flightProgress++;
      if (potion.flightProgress >= potion.flightTicks) {
        // Just landed — play sound
        addSound(state, 'ability_potion', potion.x, potion.y);
      }
      continue; // can't be picked up while in flight
    }

    potion.remainingTicks--;
    if (potion.remainingTicks <= 0) { toRemove.add(i); continue; }

    // Goblins Quick Brew: potions attract toward nearby allies within 4 tiles
    const potTeamPlayers = state.players.filter(p => p.team === potion.team && p.race === Race.Goblins);
    if (potTeamPlayers.some(p => p.researchUpgrades.raceUpgrades['goblins_ability_1'])) {
      let closestDist = 16; // 4 tiles squared
      let closestUnit: UnitState | null = null;
      const potNearby = _combatGrid.getNearby(potion.x, potion.y, 4);
      for (const u of potNearby) {
        if (u.hp <= 0 || u.team !== potion.team) continue;
        const d2 = (u.x - potion.x) ** 2 + (u.y - potion.y) ** 2;
        if (d2 < closestDist || (d2 === closestDist && closestUnit && u.id < closestUnit.id)) { closestDist = d2; closestUnit = u; }
      }
      if (closestUnit) {
        const adx = closestUnit.x - potion.x, ady = closestUnit.y - potion.y;
        const ad = Math.sqrt(adx * adx + ady * ady);
        if (ad > 0.1) {
          const attractSpeed = 0.08; // tiles per tick
          potion.x += (adx / ad) * attractSpeed;
          potion.y += (ady / ad) * attractSpeed;
        }
      }
    }

    // Check if any allied unit walks over this potion (spatial grid lookup)
    // Sort candidates by distance+ID for deterministic pickup when multiple units overlap
    const pickupNearby = _combatGrid.getNearby(potion.x, potion.y, POTION_PICKUP_RADIUS);
    let closestPickup: UnitState | null = null;
    let closestPickupD2 = Infinity;
    for (const u of pickupNearby) {
      if (u.hp <= 0 || u.team !== potion.team) continue;
      const d2 = (u.x - potion.x) ** 2 + (u.y - potion.y) ** 2;
      if (d2 <= POTION_PICKUP_RADIUS * POTION_PICKUP_RADIUS &&
          (d2 < closestPickupD2 || (d2 === closestPickupD2 && closestPickup && u.id < closestPickup.id))) {
        closestPickup = u;
        closestPickupD2 = d2;
      }
    }
    if (closestPickup) {
      applyPotionBuff(state, closestPickup, potion.type);
      toRemove.add(i);
    }
  }

  if (toRemove.size > 0) {
    state.potionDrops = state.potionDrops.filter((_, i) => !toRemove.has(i));
  }
}

export function tickUnitDiamondPickup(state: GameState): void {
  // Check if any unit carrying diamond reached own HQ → spawn champion
  for (const unit of state.units) {
    if (!unit.carryingDiamond || unit.hp <= 0) continue;
    const hq = getHQPosition(unit.team, state.mapDef);
    const hqCx = hq.x + HQ_WIDTH / 2, hqCy = hq.y + HQ_HEIGHT / 2;
    const dx = unit.x - hqCx, dy = unit.y - hqCy;
    if (dx * dx + dy * dy <= 9) { // 3 tile deposit radius
      unit.carryingDiamond = false;
      spawnDiamondChampion(state, unit.team, unit.x, unit.y, unit.playerId);
      resetDiamondForRespawn(state);
      if (state.playerStats[unit.playerId]) state.playerStats[unit.playerId].diamondPickups++;
      return;
    }
  }

  // Diamond respawn timer
  if (state.diamond.state === 'respawning') {
    state.diamond.respawnTimer--;
    if (state.diamond.respawnTimer <= 0) {
      // Diamond reappears as dropped (immediately pickable) since gold cells are already mined
      state.diamond.state = 'dropped';
      addSound(state, 'diamond_exposed', state.diamond.x, state.diamond.y);
      addFloatingText(state, state.diamond.x, state.diamond.y, 'DIAMOND RESPAWNED!', '#00ffff');
    }
    return;
  }

  if (state.diamond.state !== 'dropped') return;
  for (const unit of state.units) {
    if (unit.hp <= 0 || unit.carryingDiamond) continue;
    const dx = unit.x - state.diamond.x;
    const dy = unit.y - state.diamond.y;
    if (dx * dx + dy * dy > 2.25) continue; // 1.5 tile radius
    unit.carryingDiamond = true;
    state.diamond.state = 'carried';
    state.diamond.carrierId = unit.id;
    state.diamond.carrierType = 'unit';
    if (state.playerStats[unit.playerId]) state.playerStats[unit.playerId].diamondPickups++;
    addSound(state, 'diamond_carried', unit.x, unit.y);
    addFloatingText(state, unit.x, unit.y, 'DIAMOND!', '#00ffff');
    break;
  }
}

// Throttle counters for status effect sounds — reset each tick in simulateTick
// (imported from SimShared as live bindings; incremented via inc*() functions)

const STATUS_SOUND_MAP: Partial<Record<StatusType, SoundEvent['type']>> = {
  [StatusType.Burn]: 'status_burn',
  [StatusType.Shield]: 'status_shield',
  [StatusType.Haste]: 'status_haste',
  [StatusType.Slow]: 'status_slow',
  [StatusType.Frenzy]: 'status_frenzy',
  [StatusType.Wound]: 'status_wound',
  [StatusType.Vulnerable]: 'status_vulnerable',
};

// === Status Effects, Damage, and Healing ===

export function applyStatus(target: UnitState, type: StatusType, stacks: number, state?: GameState): void {
  const existing = target.statusEffects.find(e => e.type === type);
  const maxStacks = type === StatusType.Slow || type === StatusType.Burn ? 5 : 1;
  const duration = type === StatusType.Burn ? 3 * TICK_RATE :
                   type === StatusType.Slow ? 3 * TICK_RATE :
                   type === StatusType.Haste ? 3 * TICK_RATE :
                   type === StatusType.Frenzy ? 4 * TICK_RATE :
                   4 * TICK_RATE; // Shield
  const isNew = !existing;
  if (existing) {
    existing.stacks = Math.min(existing.stacks + stacks, maxStacks);
    existing.duration = duration; // refresh
  } else {
    target.statusEffects.push({ type, stacks: Math.min(stacks, maxStacks), duration });
  }
  if (type === StatusType.Shield && target.shieldHp <= 0) target.shieldHp = 12;

  // Emit sound only for new applications (not refreshes), heavily throttled
  if (state && isNew) {
    const soundType = STATUS_SOUND_MAP[type];
    if (soundType) {
      const canPlay =
        (type === StatusType.Burn && incStatusBurnSounds() <= 2) ||
        (type === StatusType.Shield && incStatusShieldSounds() <= 1) ||
        (type === StatusType.Haste && incStatusHasteSounds() <= 1) ||
        (type === StatusType.Slow && incStatusSlowSounds() <= 2) ||
        (type === StatusType.Frenzy && incStatusFrenzySounds() <= 1) ||
        (type === StatusType.Wound && incWoundSounds() <= 1) ||
        (type === StatusType.Vulnerable && incVulnerableSounds() <= 1);
      if (canPlay) addSound(state, soundType, target.x, target.y);
    }
  }
}

export function applyKnockback(unit: UnitState, amount: number, mapDef?: MapDef): void {
  if (unit.pathProgress < 0) return; // not on path yet
  const path = getLanePath(unit.team, unit.lane, mapDef);
  const pathLen = getCachedPathLength(unit.team, unit.lane, mapDef);
  const prevProgress = unit.pathProgress;
  unit.pathProgress = Math.max(0, unit.pathProgress - amount);
  const knockDist = (prevProgress - unit.pathProgress) * pathLen;
  if (knockDist <= 0) return;
  // Get backward direction from path tangent at current progress — then
  // move from the unit's ACTUAL position, not the path position.
  // (pathProgress can diverge from x/y during combat chase; snapping to
  //  interpolatePath(pathProgress) would teleport units across the map.)
  const p0 = interpolatePath(path, Math.max(0, prevProgress - 0.02));
  const p1 = interpolatePath(path, prevProgress);
  const fwdX = p1.x - p0.x, fwdY = p1.y - p0.y;
  const fwdLen = Math.sqrt(fwdX * fwdX + fwdY * fwdY) || 1;
  unit.x -= (fwdX / fwdLen) * knockDist;
  unit.y -= (fwdY / fwdLen) * knockDist;
}

/** Track healing for a unit's owner. */
export function trackHealing(state: GameState, unit: UnitState, amount: number): void {
  const ps = state.playerStats[unit.playerId];
  if (ps) ps.totalHealing += amount;
  unit.healingDone += amount;
}

const WOUND_DURATION_TICKS = 6 * TICK_RATE;
export function applyWound(target: UnitState, state?: GameState): void {
  const existing = target.statusEffects.find(e => e.type === StatusType.Wound);
  if (existing) { existing.duration = WOUND_DURATION_TICKS; }
  else {
    target.statusEffects.push({ type: StatusType.Wound, stacks: 1, duration: WOUND_DURATION_TICKS });
    if (state && incWoundSounds() <= 1) addSound(state, 'status_wound', target.x, target.y);
  }
}

const VULNERABLE_DURATION_TICKS = 3 * TICK_RATE;
export function applyVulnerable(target: UnitState, state?: GameState): void {
  const existing = target.statusEffects.find(e => e.type === StatusType.Vulnerable);
  if (existing) { existing.duration = VULNERABLE_DURATION_TICKS; }
  else {
    target.statusEffects.push({ type: StatusType.Vulnerable, stacks: 1, duration: VULNERABLE_DURATION_TICKS });
    if (state && incVulnerableSounds() <= 1) addSound(state, 'status_vulnerable', target.x, target.y);
  }
}

/** Heal a unit, respecting Wound status (-50% healing). Returns actual HP healed. */
export function healUnit(unit: UnitState, amount: number): number {
  if (amount <= 0 || unit.hp >= unit.maxHp) return 0;
  const wounded = hasStatus(unit.statusEffects, StatusType.Wound);
  const effective = wounded ? Math.round(amount * 0.5) : amount;
  if (effective <= 0) return 0;
  const actual = Math.min(unit.maxHp - unit.hp, effective);
  unit.hp = Math.min(unit.maxHp, unit.hp + effective);
  return actual;
}



export function dealDamage(state: GameState, target: UnitState, amount: number, showFloat: boolean, sourcePlayerId?: number, sourceUnitId?: number, isTowerShot?: boolean): void {
  // Dodge check (including Horde aura dodge bonus)
  let dodge = (target.upgradeSpecial?.dodgeChance ?? 0) + (target.upgradeSpecial?._auraDodge ?? 0);
  // Goblins innate: melee units have 15% dodge
  if (target.category === 'melee') {
    const tgtP = state.players[target.playerId];
    if (tgtP?.race === Race.Goblins) dodge = Math.min(1, dodge + 0.15);
  }
  // Goblins Cower Reflexes: +25% dodge when below 50% HP
  if (target.hp < target.maxHp * 0.5) {
    const tgtPlayer = state.players[target.playerId];
    if (tgtPlayer?.race === Race.Goblins && tgtPlayer.researchUpgrades.raceUpgrades['goblins_ability_2']) {
      dodge = Math.min(1, dodge + 0.25);
    }
  }
  // Geists Death Defiance: 2% chance to avoid lethal damage
  if (target.hp > 0 && target.hp <= amount) {
    const deathPlayer = state.players[target.playerId];
    if (deathPlayer?.researchUpgrades.raceUpgrades['geists_ability_3']) {
      dodge = Math.min(1, dodge + 0.05);
    }
  }
  if (dodge > 0) {
    // Always consume 2 RNG values to keep sequence stable
    const dodgeRoll = state.rng(), dodgeTextRoll = state.rng();
    if (dodgeRoll < dodge) {
      if (dodgeTextRoll < 0.3) addFloatingText(state, target.x, target.y, 'DODGE', '#ffffff', undefined, true,
        { ftType: 'status', miniIcon: 'dodge' });
      addCombatEvent(state, { type: 'dodge', x: target.x, y: target.y, color: '#ffffff' });
      return;
    }
  }
  // Damage reduction (upgrade tree)
  const reduction = target.upgradeSpecial?.damageReductionPct ?? 0;
  if (reduction > 0) amount = Math.max(1, Math.round(amount * (1 - reduction)));
  // Horde aura armor bonus
  const auraArmor = target.upgradeSpecial?._auraArmor ?? 0;
  if (auraArmor > 0) amount = Math.max(1, Math.round(amount * (1 - auraArmor)));
  // Research defense reduction
  const targetPlayer = state.players[target.playerId];
  if (targetPlayer) {
    const bMult = getResearchMultipliers(targetPlayer, target.category);
    if (bMult.damageReduction > 0) amount = Math.max(1, Math.round(amount * (1 - bMult.damageReduction)));
    // Race one-shot defensive effects
    const tbu = targetPlayer.researchUpgrades;
    // Crown Defend Stance: melee units take -25% ranged dmg
    if (target.category === 'melee' && tbu.raceUpgrades['crown_melee_1'] && sourceUnitId !== undefined) {
      const srcUnit = _unitById.get(sourceUnitId);
      if (srcUnit && srcUnit.category === 'ranged') amount = Math.max(1, Math.round(amount * 0.75));
    }
    // Deep Tidal Guard: +5% DR for melee (stacks with research def)
    if (target.category === 'melee' && tbu.raceUpgrades['deep_melee_1']) {
      amount = Math.max(1, Math.round(amount * 0.95));
    }
    // Geists Spectral Armor: +5% DR per 25% missing HP for melee
    if (target.category === 'melee' && tbu.raceUpgrades['geists_melee_2']) {
      const missingPct = 1 - target.hp / target.maxHp;
      const drBonus = Math.floor(missingPct / 0.25) * 0.05;
      if (drBonus > 0) amount = Math.max(1, Math.round(amount * (1 - drBonus)));
    }
    // Vulnerable: target takes +20% damage from all sources
    if (hasStatus(target.statusEffects, StatusType.Vulnerable))
      amount = Math.max(1, Math.round(amount * 1.20));
    // Goblins Jinx Cloud: slowed targets receive Wound (anti-heal) from Goblin team hits
    if (sourcePlayerId !== undefined) {
      const srcPlayer = state.players[sourcePlayerId];
      if (srcPlayer && srcPlayer.researchUpgrades.raceUpgrades['goblins_caster_2'] && hasStatus(target.statusEffects, StatusType.Slow)) {
        applyWound(target);
      }
    }
    // Tenders Thorned Vines: reflect 3 dmg to melee attackers
    if (target.category === 'melee' && tbu.raceUpgrades['tenders_melee_2'] && sourceUnitId !== undefined) {
      const srcUnit = _unitById.get(sourceUnitId);
      if (srcUnit && srcUnit.range <= 2 && srcUnit.hp > 0) {
        srcUnit.hp = Math.max(1, srcUnit.hp - 3);
      }
    }
  }
  // Shield absorbs damage first
  if (target.shieldHp > 0) {
    const absorbed = Math.min(target.shieldHp, amount);
    target.shieldHp -= absorbed;
    amount -= absorbed;
    if (target.shieldHp <= 0) {
      compactInPlace(target.statusEffects, e => e.type !== StatusType.Shield);
    }
    if (absorbed > 0 && showFloat) {
      addFloatingText(state, target.x, target.y, `${absorbed}`, '#64b5f6', undefined, undefined,
        { ftType: 'damage', magnitude: absorbed, miniIcon: 'shield_icon' });
    }
  }
  if (amount > 0) {
    target.hp -= amount;
    if (showFloat && amount >= 5) {
      let miniIcon = 'sword';
      if (isTowerShot) {
        miniIcon = 'arrow';
      } else if (sourceUnitId !== undefined) {
        const src = _unitById.get(sourceUnitId);
        if (src && src.range > 2) miniIcon = 'arrow';
      }
      addFloatingText(state, target.x, target.y, `${amount}`, '#ffffff', undefined, undefined,
        { ftType: 'damage', magnitude: amount, miniIcon });
    }
    // Track damage stats
    target.damageTaken += amount;
    const targetPs = state.playerStats[target.playerId];
    if (targetPs) targetPs.totalDamageTaken += amount;
    if (sourceUnitId !== undefined) {
      const srcUnit = _unitById.get(sourceUnitId);
      if (srcUnit) srcUnit.damageDone += amount;
    }
    if (sourcePlayerId !== undefined && state.playerStats[sourcePlayerId]) {
      state.playerStats[sourcePlayerId].totalDamageDealt += amount;
      if (isTowerShot) state.playerStats[sourcePlayerId].towerDamageDealt += amount;
      // Credit kill when no unit ID is present (tower, explosion, AoE death effects)
      // Unit-kill credit is handled separately in the sourceUnitId block below
      if (target.hp <= 0 && sourceUnitId === undefined) state.playerStats[sourcePlayerId].enemyUnitsKilled++;
      // Check if near own HQ (within 20 tiles)
      const team = state.players[sourcePlayerId].team;
      const hq = getHQPosition(team, state.mapDef);
      const hqCx = hq.x + HQ_WIDTH / 2, hqCy = hq.y + HQ_HEIGHT / 2;
      const dx = target.x - hqCx, dy = target.y - hqCy;
      if (dx * dx + dy * dy <= 400) { // 20 tile radius
        state.playerStats[sourcePlayerId].totalDamageNearHQ += amount;
      }
    }
    // Track killer name and credit kill
    if (sourceUnitId !== undefined) {
      const killer = _unitById.get(sourceUnitId);
      if (killer) {
        const killerRace = state.players[killer.playerId]?.race;
        const killerBldg = `${killer.category}_spawner` as BuildingType;
        target.lastDamagedByName = (killerRace != null ? getUpgradeNodeDef(killerRace, killerBldg, killer.upgradeNode)?.name : undefined) ?? killer.type;
        if (target.hp <= 0) {
          killer.kills++;
          if (state.playerStats[killer.playerId]) state.playerStats[killer.playerId].enemyUnitsKilled++;
          // Gold on kill (Crown Buccaneer upgrade path)
          const gok = killer.upgradeSpecial?.goldOnKill ?? 0;
          if (gok > 0) {
            const kp = state.players[killer.playerId];
            if (kp) { kp.gold += gok; addFloatingText(state, killer.x, killer.y - 0.3, `+${gok}g`, '#ffd700'); }
          }
          // Research: Crown Royal Guard — +2g on melee kill
          const killPlayer = state.players[killer.playerId];
          if (killPlayer && killer.category === 'melee' && killPlayer.researchUpgrades.raceUpgrades['crown_melee_2']) {
            killPlayer.gold += 2;
            addFloatingText(state, killer.x, killer.y - 0.3, '+2g', '#ffd700');
          }
          // Research: Demon Soul Siphon — +2 mana on melee kill
          if (killPlayer && killer.category === 'melee' && killPlayer.researchUpgrades.raceUpgrades['demon_melee_2']) {
            killPlayer.mana += 2;
          }
          // Demon kill-scaling: +dmg per kill (Bloodfire Berserker, Inferno Reaper, Soul Pyre)
          if (killer.upgradeSpecial?.killScaling) {
            const maxKillStacks = killer.upgradeSpecial.killMaxStacks ?? 10;
            if (killer.kills <= maxKillStacks) {
              // Store original base damage on first kill (avoids rounding drift)
              if (killer.kills === 1) {
                killer.upgradeSpecial = { ...killer.upgradeSpecial, _baseDmg: killer.damage };
              }
              const pct = killer.upgradeSpecial.killDmgPct ?? 0.05;
              const baseDmg = killer.upgradeSpecial._baseDmg ?? killer.damage;
              killer.damage = Math.round(baseDmg * (1 + pct * killer.kills));
              addFloatingText(state, killer.x, killer.y - 0.5, `+DMG`, '#ff6600', undefined, undefined,
                { ftType: 'status', miniIcon: 'sword' });
            }
          }
          // Horde Trophy Hunter: War Troll gains +2% HP/dmg per kill, carries over between trolls
          if (killer.type === 'War Troll' && killPlayer?.researchUpgrades.raceUpgrades['horde_ability_4']) {
            killPlayer.trollKills = Math.min((killPlayer.trollKills ?? 0) + 1, 100);
            if (!killer.upgradeSpecial._trollBaseDmg) {
              killer.upgradeSpecial = { ...killer.upgradeSpecial, _trollBaseDmg: killer.damage, _trollBaseHp: killer.maxHp };
            }
            const tBaseDmg = killer.upgradeSpecial._trollBaseDmg;
            const tBaseHp = killer.upgradeSpecial._trollBaseHp;
            const newDmg = Math.round(tBaseDmg * (1 + 0.02 * killPlayer.trollKills));
            const newMax = Math.round(tBaseHp * (1 + 0.02 * killPlayer.trollKills));
            const dmgGain = newDmg - killer.damage;
            const hpGain = newMax - killer.maxHp;
            killer.damage = newDmg;
            killer.hp += hpGain;
            killer.maxHp = newMax;
            addFloatingText(state, killer.x, killer.y - 0.5, `+${dmgGain} DMG +${hpGain} HP`, '#ff9800', undefined, undefined,
              { ftType: 'status' });
          }
          // Wild Kill Frenzy: on kill, heal 15% maxHP, nearby Wild allies gain Frenzy (+50% dmg) and Haste
          const killerRace = state.players[killer.playerId]?.race;
          if (killerRace === Race.Wild) {
            const wildPlayer = state.players[killer.playerId];
            // Meat Harvest: 30% chance to gain +3 meat on kill
            if (wildPlayer?.researchUpgrades.raceUpgrades['wild_ability_1'] && state.rng() < 0.3) {
              wildPlayer.meat += 3;
              if (state.playerStats[killer.playerId]) state.playerStats[killer.playerId].totalMeatEarned += 3;
              addFloatingText(state, killer.x, killer.y - 0.3, '+3', '#e57373', 'meat');
            }
            // Heal killer on kill (bloodthirst)
            const healAmt = Math.round(killer.maxHp * 0.15);
            const actualHeal = healUnit(killer, healAmt);
            if (actualHeal > 0) trackHealing(state, killer, actualHeal);
            // Blood Frenzy: double frenzy radius
            const frenzyRadius = wildPlayer?.researchUpgrades.raceUpgrades['wild_ability_2'] ? 12 : 6;
            applyStatus(killer, StatusType.Frenzy, 1, state);
            applyStatus(killer, StatusType.Haste, 1, state);
            const frenzyNearby = _combatGrid.getNearby(killer.x, killer.y, frenzyRadius);
            for (const ally of frenzyNearby) {
              if (ally.team !== killer.team || ally.id === killer.id || ally.hp <= 0) continue;
              if (state.players[ally.playerId]?.race !== Race.Wild) continue;
              const dx = ally.x - killer.x, dy = ally.y - killer.y;
              if (dx * dx + dy * dy <= frenzyRadius * frenzyRadius) {
                applyStatus(ally, StatusType.Frenzy, 1, state);
                applyStatus(ally, StatusType.Haste, 1, state);
              }
            }
            if (state.rng() < 0.25) {
              addFloatingText(state, killer.x, killer.y - 0.3, '', '#ff4400', undefined, true,
                { ftType: 'status', miniIcon: 'lightning' });
            }
          }
        }
      }
    } else if (sourcePlayerId !== undefined) {
      target.lastDamagedByName = 'Tower';
    } else {
      target.lastDamagedByName = 'HQ';
    }
  }
}

// === Caster Support Abilities ===
// Each race's caster has a secondary support effect on nearby allies when they cast

export function applyCasterSupport(state: GameState, caster: UnitState, race: Race, sp: Record<string, any> | undefined): void {
  const supportRange = 6;
  const nearby = _combatGrid.getNearby(caster.x, caster.y, supportRange);
  const allies: UnitState[] = [];
  for (const u of nearby) {
    if (u.team === caster.team && u.id !== caster.id &&
        (u.x - caster.x) ** 2 + (u.y - caster.y) ** 2 <= supportRange * supportRange) {
      allies.push(u);
    }
  }
  // Sort allies by distance then ID for deterministic first-N selection
  allies.sort((a, b) => {
    const da = (a.x - caster.x) ** 2 + (a.y - caster.y) ** 2;
    const db = (b.x - caster.x) ** 2 + (b.y - caster.y) ** 2;
    return da - db || a.id - b.id;
  });
  const healBonus = sp?.healBonus ?? 0;

  switch (race) {
    case Race.Crown: {
      // Shield nearby allies (Crown caster ability)
      const shieldCount = 2 + (sp?.shieldTargetBonus ?? 0);
      const sorted = allies.slice().sort((a, b) => {
        const da = (a.x - caster.x) ** 2 + (a.y - caster.y) ** 2;
        const db = (b.x - caster.x) ** 2 + (b.y - caster.y) ** 2;
        return da !== db ? da - db : a.id - b.id;
      });
      let absorbBonus = sp?.shieldAbsorbBonus ?? 0;
      // Research: Fortified Shields +8 absorb
      const casterPlayer = state.players[caster.playerId];
      if (casterPlayer?.researchUpgrades.raceUpgrades['crown_caster_1']) absorbBonus += 8;
      const crownShielded = Math.min(shieldCount, sorted.length);
      for (let i = 0; i < crownShielded; i++) {
        applyStatus(sorted[i], StatusType.Shield, 1, state);
        if (absorbBonus > 0) sorted[i].shieldHp += absorbBonus;
        caster.buffsApplied++;
        if (state.playerStats[caster.playerId]) state.playerStats[caster.playerId].totalBuffsApplied++;
      }
      // Research: Healing Aura — 1 HP/s to 2 nearest allies
      if (casterPlayer?.researchUpgrades.raceUpgrades['crown_caster_2']) {
        let healed = 0;
        for (const a of sorted) {
          if (healed >= 2) break;
          if (a.hp < a.maxHp) {
            const ah = healUnit(a, 1);
            if (ah > 0) trackHealing(state, caster, ah);
            healed++;
          }
        }
      }
      if (crownShielded > 0) addCombatEvent(state, { type: 'pulse', x: caster.x, y: caster.y, radius: supportRange, color: '#64b5f6' });
      break;
    }
    case Race.Horde: {
      // Haste pulse: nearby allies get haste (5 base — Horde's War Chanter is a force multiplier)
      let hordeHasteCount = 0;
      const hordeP = state.players[caster.playerId];
      for (const a of allies) {
        if (!hasStatus(a.statusEffects, StatusType.Haste)) {
          applyStatus(a, StatusType.Haste, 1, state);
          // Research: War Drums — +2s haste duration
          if (hordeP?.researchUpgrades.raceUpgrades['horde_caster_1']) {
            const hasteEff = a.statusEffects.find(e => e.type === StatusType.Haste);
            if (hasteEff) hasteEff.duration += 2 * TICK_RATE;
          }
          hordeHasteCount++;
          caster.buffsApplied++;
          if (state.playerStats[caster.playerId]) state.playerStats[caster.playerId].totalBuffsApplied++;
          if (hordeHasteCount >= 5 + healBonus) break;
        }
      }
      // Chain heal: heal most injured allies (Battle Chanter B-path upgrade)
      const chainHealCount = sp?.chainHeal ?? 0;
      if (chainHealCount > 0) {
        const injured = allies.filter(a => a.hp < a.maxHp).sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp) || a.id - b.id);
        let healed = 0;
        const healAmt = caster.damage; // heal amount = caster damage stat
        for (const a of injured) {
          if (healed >= chainHealCount) break;
          const ah = healUnit(a, healAmt);
          if (ah > 0) { trackHealing(state, caster, ah); healed++; }
        }
        if (healed > 0) addCombatEvent(state, { type: 'pulse', x: caster.x, y: caster.y, radius: supportRange, color: '#66bb6a' });
      }
      if (hordeHasteCount > 0) addCombatEvent(state, { type: 'pulse', x: caster.x, y: caster.y, radius: supportRange, color: '#ffab40' });
      break;
    }
    case Race.Oozlings: {
      // Haste pulse: nearby allies get brief haste
      let oozHasteCount = 0;
      for (const a of allies) {
        if (!hasStatus(a.statusEffects, StatusType.Haste)) {
          applyStatus(a, StatusType.Haste, 1, state);
          oozHasteCount++;
          caster.buffsApplied++;
          if (state.playerStats[caster.playerId]) state.playerStats[caster.playerId].totalBuffsApplied++;
          if (oozHasteCount >= 3 + healBonus) break;
        }
      }
      if (oozHasteCount > 0) addCombatEvent(state, { type: 'pulse', x: caster.x, y: caster.y, radius: supportRange, color: '#76ff03' });
      break;
    }
    case Race.Goblins: {
      // Hex debuff: slow enemies near the caster instead of buffing allies
      // Use spatial grid instead of full array scan
      const nearbyGob = _combatGrid.getNearby(caster.x, caster.y, supportRange);
      const enemies: UnitState[] = [];
      for (const u of nearbyGob) {
        if (u.team === caster.team || u.hp <= 0) continue;
        const gdx = u.x - caster.x, gdy = u.y - caster.y;
        if (gdx * gdx + gdy * gdy <= supportRange * supportRange) enemies.push(u);
      }
      const gobP = state.players[caster.playerId];
      for (const e of enemies) {
        applyStatus(e, StatusType.Slow, 1 + (sp?.extraSlowStacks ?? 0), state);
        // Burn from upgrade path (extraBurnStacks) + Potent Hex research (+1 Burn)
        const burnFromUpgrade = sp?.extraBurnStacks ?? 0;
        const burnFromResearch = gobP?.researchUpgrades.raceUpgrades['goblins_caster_1'] ? 1 : 0;
        if (burnFromUpgrade + burnFromResearch > 0) applyStatus(e, StatusType.Burn, burnFromUpgrade + burnFromResearch, state);
      }
      if (enemies.length > 0) {
        addFloatingText(state, caster.x, caster.y - 0.5, '', '#2e7d32', undefined, true,
          { ftType: 'heal', miniIcon: 'heart' });
        addCombatEvent(state, { type: 'pulse', x: caster.x, y: caster.y, radius: supportRange, color: '#2e7d32' });
      }
      break;
    }
    case Race.Demon: {
      // No support — pure damage caster, does nothing extra for allies
      break;
    }
    case Race.Deep: {
      // Cleanse: remove burn stacks from nearby allies
      const deepP = state.players[caster.playerId];
      const extraCleanse = deepP?.researchUpgrades.raceUpgrades['deep_caster_1'] ? 1 : 0;
      let cleansed = 0;
      for (const a of allies) {
        const burnIdx = a.statusEffects.findIndex(e => e.type === StatusType.Burn);
        if (burnIdx >= 0) {
          const burn = a.statusEffects[burnIdx];
          burn.stacks = Math.max(0, burn.stacks - (2 + healBonus + extraCleanse));
          if (burn.stacks <= 0) a.statusEffects.splice(burnIdx, 1);
          addDeathParticles(state, a.x, a.y, '#1565c0', 1);
          addCombatEvent(state, { type: 'cleanse', x: a.x, y: a.y, color: '#1565c0' });
          cleansed++;
        }
      }
      // Research: Purifying Tide — also grant +25% move speed via haste to cleansed/nearby allies
      if (extraCleanse > 0) {
        for (const a of allies.slice(0, 5)) {
          if (!hasStatus(a.statusEffects, StatusType.Haste)) {
            applyStatus(a, StatusType.Haste, 1, state);
          }
        }
      }
      // Research: Abyssal Ward — shield 3 HP to nearby allies
      if (deepP?.researchUpgrades.raceUpgrades['deep_caster_2']) {
        for (const a of allies.slice(0, 3)) {
          applyStatus(a, StatusType.Shield, 1, state);
          a.shieldHp += 3;
          caster.buffsApplied++;
          if (state.playerStats[caster.playerId]) state.playerStats[caster.playerId].totalBuffsApplied++;
        }
      }
      if (cleansed > 0) {
        addFloatingText(state, caster.x, caster.y - 0.5, '', '#1565c0', undefined, true,
          { ftType: 'heal', miniIcon: 'cleanse' });
      }
      break;
    }
    case Race.Wild: {
      // Haste pulse: nearby allies get brief haste
      let hasteCount = 0;
      for (const a of allies) {
        if (!hasStatus(a.statusEffects, StatusType.Haste)) {
          applyStatus(a, StatusType.Haste, 1, state);
          hasteCount++;
          caster.buffsApplied++;
          if (state.playerStats[caster.playerId]) state.playerStats[caster.playerId].totalBuffsApplied++;
          if (hasteCount >= 3 + healBonus) break;
        }
      }
      // Research: Alpha Howl — casters grant Frenzy to 2 nearby allies
      const wildP = state.players[caster.playerId];
      if (wildP?.researchUpgrades.raceUpgrades['wild_caster_2']) {
        let frenzied = 0;
        for (const a of allies) {
          if (frenzied >= 2) break;
          applyStatus(a, StatusType.Frenzy, 1, state);
          frenzied++;
          caster.buffsApplied++;
          if (state.playerStats[caster.playerId]) state.playerStats[caster.playerId].totalBuffsApplied++;
        }
      }
      if (hasteCount > 0) addCombatEvent(state, { type: 'pulse', x: caster.x, y: caster.y, radius: supportRange, color: '#4caf50' });
      break;
    }
    case Race.Geists: {
      // Geist caster: no AoE, no heal — single-target attacker with skeleton summon on nearby death
      // Research: Necrotic Burst — heal 2 HP to 3 lowest allies
      const geistsP = state.players[caster.playerId];
      if (geistsP?.researchUpgrades.raceUpgrades['geists_caster_1']) {
        const sorted = allies.slice().sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp) || a.id - b.id);
        let healedCount = 0;
        for (const a of sorted) {
          if (healedCount >= 3) break;
          if (a.hp < a.maxHp) {
            const ah = healUnit(a, 2);
            if (ah > 0) trackHealing(state, caster, ah);
            healedCount++;
          }
        }
      }
      break;
    }
    case Race.Tenders: {
      // Focused heal: restore the most-injured ally
      let tenderHealAmt = 1 + healBonus;
      // Research: Bloom Burst +2 heal amount
      const tendersP = state.players[caster.playerId];
      if (tendersP?.researchUpgrades.raceUpgrades['tenders_caster_1']) tenderHealAmt += 2;
      const injured = allies
        .filter(a => a.hp < a.maxHp)
        .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp) || a.id - b.id);
      const target = injured[0];
      if (target) {
        // Research: Life Link — double heal if target <30% HP
        let thisHeal = tenderHealAmt;
        if (tendersP?.researchUpgrades.raceUpgrades['tenders_caster_2'] && target.hp < target.maxHp * 0.30) thisHeal *= 2;
        const ah = healUnit(target, thisHeal);
        if (ah > 0) trackHealing(state, caster, ah);
        addDeathParticles(state, target.x, target.y, '#33691e', 1);
        addCombatEvent(state, { type: 'heal', x: target.x, y: target.y, color: '#66bb6a' });
        addFloatingText(state, caster.x, caster.y - 0.5, `+${thisHeal}`, '#33691e', undefined, undefined,
          { ftType: 'heal', miniIcon: 'heart' });
        addCombatEvent(state, { type: 'pulse', x: caster.x, y: caster.y, radius: supportRange, color: '#66bb6a' });
      }
      break;
    }
  }
}

export function applyOnHitEffects(state: GameState, attacker: UnitState, target: UnitState): void {
  const race = state.players[attacker.playerId].race;
  const isMelee = attacker.range <= 2;
  const sp = attacker.upgradeSpecial;

  switch (race) {
    case Race.Crown:
      break;
    case Race.Horde:
      // Brute: knockback every 3rd hit + 10% lifesteal
      if (isMelee) {
        attacker.hitCount++;
        const knockN = sp?.knockbackEveryN ?? 3;
        if (knockN > 0 && attacker.hitCount % knockN === 0) {
          applyKnockback(target, 0.02, state.mapDef);
          addDeathParticles(state, target.x, target.y, '#ffab40', 3);
          addCombatEvent(state, { type: 'knockback', x: target.x, y: target.y, color: '#ffab40' });
          addSound(state, 'combat_knockback', target.x, target.y);
          if (state.rng() < 0.3) addFloatingText(state, target.x, target.y - 0.3, 'KNOCK', '#ffab40', undefined, true,
            { ftType: 'status', miniIcon: 'knockback' });
        }
        const hordeSteal = Math.round(attacker.damage * 0.10);
        if (hordeSteal > 0) {
          const ah = healUnit(attacker, hordeSteal);
          if (ah > 0) trackHealing(state, attacker, ah);
          addCombatEvent(state, { type: 'lifesteal', x: target.x, y: target.y, x2: attacker.x, y2: attacker.y, color: '#66bb6a' });
          addSound(state, 'combat_lifesteal', attacker.x, attacker.y);
        }
      }
      break;
    case Race.Goblins:
      // Knifer burn is applied via projectile hit logic (tickProjectiles)
      applyWound(target, state); // all Goblin attacks apply Wound
      break;
    case Race.Oozlings:
      // Globule: 15% chance haste on melee hit
      if (isMelee) {
        if (sp?.guaranteedHaste) applyStatus(attacker, StatusType.Haste, 1);
        else if (state.rng() < 0.15) applyStatus(attacker, StatusType.Haste, 1);
      }
      break;
    case Race.Demon:
      // Smasher: burn on every hit (melee)
      if (isMelee) {
        applyStatus(target, StatusType.Burn, 1 + (sp?.extraBurnStacks ?? 0));
        applyWound(target, state); // Demon melee applies Wound
      }
      break;
    case Race.Deep:
      // Shell Guard: slow on melee hit
      // Harpooner ranged +2 slow is applied via projectile hit logic (tickProjectiles)
      if (isMelee) applyStatus(target, StatusType.Slow, 1 + (sp?.extraSlowStacks ?? 0));
      break;
    case Race.Wild:
      // Lurker: burn (poison) on melee hit
      if (isMelee) applyStatus(target, StatusType.Burn, 1 + (sp?.extraBurnStacks ?? 0));
      // Savage Instinct: frenzied Wild units gain 15% lifesteal
      if (isMelee && state.players[attacker.playerId]?.researchUpgrades.raceUpgrades['wild_ability_4'] && hasStatus(attacker.statusEffects, StatusType.Frenzy)) {
        const wildSteal = Math.round(attacker.damage * 0.15);
        if (wildSteal > 0) {
          const wah = healUnit(attacker, wildSteal);
          if (wah > 0) trackHealing(state, attacker, wah);
          addCombatEvent(state, { type: 'lifesteal', x: target.x, y: target.y, x2: attacker.x, y2: attacker.y, color: '#66bb6a' });
          addSound(state, 'combat_lifesteal', attacker.x, attacker.y);
        }
      }
      break;
    case Race.Geists:
      // Bone Knight: burn (soul drain) on melee hit + lifesteal 10% + Wound
      if (isMelee) {
        applyStatus(target, StatusType.Burn, 1 + (sp?.extraBurnStacks ?? 0));
        applyWound(target, state); // Geists melee applies Wound
        const geistMeleeSteal = Math.round(attacker.damage * 0.10);
        const geistAh = healUnit(attacker, geistMeleeSteal);
        if (geistAh > 0) trackHealing(state, attacker, geistAh);
        if (geistMeleeSteal > 0) {
          addCombatEvent(state, { type: 'lifesteal', x: target.x, y: target.y, x2: attacker.x, y2: attacker.y, color: '#b39ddb' });
          addSound(state, 'combat_lifesteal', attacker.x, attacker.y);
        }
      }
      // Wraith Bow: 10% ranged lifesteal is applied via projectile hit logic (tickProjectiles)
      break;
    case Race.Tenders:
      // Treant: slow on melee hit only when upgraded (entangling roots — Radish King G-tier)
      if (isMelee && (sp?.extraSlowStacks ?? 0) > 0) applyStatus(target, StatusType.Slow, sp!.extraSlowStacks!);
      break;
  }

  // === Research race one-shot on-hit effects ===
  const atkPlayer = state.players[attacker.playerId];
  if (atkPlayer) {
    const bu = atkPlayer.researchUpgrades;
    // Goblins Coated Blades: +1 Burn on melee
    if (isMelee && bu.raceUpgrades['goblins_melee_1']) applyStatus(target, StatusType.Burn, 1);
    // Demon Infernal Rage: +25% vs burning targets (melee)
    // (handled as bonus damage in combat tick — not here, since dealDamage already called)
    // Horde Blood Rage: +20% dmg when <50% HP (handled at damage calc time)
    // Deep Crushing Depths: +20% vs slowed (handled at damage calc time)
    // Crown Royal Guard: +2g on kill (handled in dealDamage kill section)
    // Wild Slowing Shots: +1 Slow on ranged hit
    if (bu.raceUpgrades['wild_ranged_2'] && attacker.category === 'ranged') {
      applyStatus(target, StatusType.Slow, 1);
    }
    // Horde Heavy Bolts: Wound on ranged hit
    if (!isMelee && bu.raceUpgrades['horde_ranged_1']) applyWound(target);
    // Deep Frozen Harpoons: +1 Slow on ranged hit
    if (!isMelee && bu.raceUpgrades['deep_ranged_1']) applyStatus(target, StatusType.Slow, 1);
    // Wild Venomous Fangs: +1 Burn + Wound on ranged hit
    if (!isMelee && bu.raceUpgrades['wild_ranged_1']) { applyStatus(target, StatusType.Burn, 1); applyWound(target); }
    // Tenders Root Snare: 20% chance +1 Slow on ranged hit (applied in tickProjectiles, not here)
    // Geists Death Grip: lifesteal 10->15% (melee)
    if (isMelee && bu.raceUpgrades['geists_melee_1']) {
      // Extra 5% lifesteal (10% base already applied above)
      const extraSteal = Math.round(attacker.damage * 0.05);
      if (extraSteal > 0) {
        const eah = healUnit(attacker, extraSteal);
        if (eah > 0) trackHealing(state, attacker, eah);
      }
    }
    // Geists Soul Arrows: +10% lifesteal on ranged (handled via projectile)
  }
}

const COLLISION_BUILDING_RADIUS = 0.8;
const COLLISION_GOLD_CELL_RADIUS = 0.58;
const UNIT_COLLISION_RADIUS = 0.45; // hard collision circle per unit
const UNIT_COLLISION_PUSH_STRENGTH = 0.5; // how aggressively units push apart (0-1)
// 8-direction unit vectors for deterministic overlap push (avoids platform-dependent trig)
const INV_SQRT2 = 0.7071067811865476; // 1/√2, exact IEEE 754 double
const PUSH_DIR_X = [1, INV_SQRT2, 0, -INV_SQRT2, -1, -INV_SQRT2, 0, INV_SQRT2] as const;
const PUSH_DIR_Y = [0, INV_SQRT2, 1, INV_SQRT2, 0, -INV_SQRT2, -1, -INV_SQRT2] as const;

// === Spatial Helpers (bounds, collision, obstruction) ===

export function pushOutFromPoint(unit: UnitState, cx: number, cy: number, radius: number): void {
  const dx = unit.x - cx;
  const dy = unit.y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist >= radius) return;
  if (dist < 0.0001) {
    unit.x += radius;
    return;
  }
  const push = radius - dist;
  unit.x += (dx / dist) * push;
  unit.y += (dy / dist) * push;
}

export function clampToArenaBounds(pos: { x: number; y: number }, radius: number, mapDef?: MapDef): void {
  const mw = mapDef?.width ?? MAP_WIDTH;
  const mh = mapDef?.height ?? MAP_HEIGHT;
  pos.x = Math.max(radius, Math.min(mw - radius, pos.x));
  pos.y = Math.max(radius, Math.min(mh - radius, pos.y));
  if (mapDef) {
    // Use map's playable range along the shape axis
    if (mapDef.shapeAxis === 'x') {
      const range = mapDef.getPlayableRange(pos.x);
      pos.y = Math.max(range.min + radius, Math.min(range.max - radius, pos.y));
    } else {
      const range = mapDef.getPlayableRange(pos.y);
      pos.x = Math.max(range.min + radius, Math.min(range.max - radius, pos.x));
    }
  } else {
    const margin = getMarginAtRow(pos.y);
    pos.x = Math.max(margin + radius, Math.min(mw - margin - radius, pos.x));
  }
}

/** Check if a point is inside an HQ ellipse (with padding). */
export function isInsideHQEllipse(x: number, y: number, rx: number, ry: number, rw: number, rh: number, pad: number): boolean {
  const cx = rx + rw / 2;
  const cy = ry + rh / 2;
  const a = rw / 2 + pad;  // horizontal semi-axis
  const b = rh / 2 + pad;  // vertical semi-axis
  const dx = (x - cx) / a;
  const dy = (y - cy) / b;
  return dx * dx + dy * dy < 1;
}

/** Check if a point is inside either HQ ellipse. (Currently disabled) */
export function isInsideAnyHQ(_x: number, _y: number, _pad: number): boolean {
  return false;
}

/** Check if a point is inside an unmined gold cell in the diamond. */
export function isInsideUnminedDiamond(x: number, y: number, pad: number, _cells: GoldCell[], mapDef?: MapDef): boolean {
  // Quick bounding diamond check first
  const dcx = mapDef?.diamondCenter.x ?? DIAMOND_CENTER_X;
  const dcy = mapDef?.diamondCenter.y ?? DIAMOND_CENTER_Y;
  const dhw = mapDef?.diamondHalfW ?? DIAMOND_HALF_W;
  const dhh = mapDef?.diamondHalfH ?? DIAMOND_HALF_H;
  const dx = Math.abs(x - dcx) / (dhw + pad);
  const dy = Math.abs(y - dcy) / (dhh + pad);
  if (dx + dy > 1.1) return false; // outside diamond shape entirely

  // O(1) lookup via cell map when available
  const tileX = Math.floor(x);
  const tileY = Math.floor(y);
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = tileX + ox;
      const cy = tileY + oy;
      const cell = _diamondCellMapInt.get(cx * 10000 + cy);
      if (cell && cell.gold > 0) {
        const cellCx = cell.tileX + 0.5;
        const cellCy = cell.tileY + 0.5;
        const d = Math.sqrt((x - cellCx) ** 2 + (y - cellCy) ** 2);
        if (d < COLLISION_GOLD_CELL_RADIUS + pad) return true;
      }
    }
  }
  return false;
}

/** Check if a position is blocked by any solid obstacle (HQ or unmined diamond cells). */
export function isBlocked(x: number, y: number, pad: number, cells: GoldCell[], mapDef?: MapDef): boolean {
  return isInsideAnyHQ(x, y, pad) || isInsideUnminedDiamond(x, y, pad, cells, mapDef);
}

// ---- A* Tile Pathfinding ----

const SQRT2 = Math.sqrt(2);
const ASTAR_DIRS = [
  { dx: 1, dy: 0, cost: 1 },  { dx: -1, dy: 0, cost: 1 },
  { dx: 0, dy: 1, cost: 1 },  { dx: 0, dy: -1, cost: 1 },
  { dx: 1, dy: 1, cost: SQRT2 },  { dx: -1, dy: 1, cost: SQRT2 },
  { dx: 1, dy: -1, cost: SQRT2 }, { dx: -1, dy: -1, cost: SQRT2 },
];

/** Is a tile center blocked by unmined diamond cells or outside the playable area? */
export function isTileWalkable(tx: number, ty: number, cells: GoldCell[], mapDef?: MapDef): boolean {
  const w = mapDef?.width ?? MAP_WIDTH;
  const h = mapDef?.height ?? MAP_HEIGHT;
  if (tx < 0 || ty < 0 || tx >= w || ty >= h) return false;
  if (mapDef && !mapDef.isPlayable(tx, ty)) return false;
  return !isInsideUnminedDiamond(tx + 0.5, ty + 0.5, 0.45, cells, mapDef);
}

/** Octile distance heuristic (admissible for 8-directional movement). */
// === Pathfinding (A*, line-of-sight, smoothing) ===

export function octileH(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
  return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
}

/**
 * Check if a straight line between two world positions is unobstructed
 * by unmined diamond cells and stays within the playable area.
 * Samples every ~0.5 tiles.
 */
export function hasLineOfSight(ax: number, ay: number, bx: number, by: number, cells: GoldCell[], mapDef?: MapDef): boolean {
  const dx = bx - ax, dy = by - ay;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.5) return true;
  const steps = Math.max(4, Math.ceil(dist * 2));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = ax + dx * t, py = ay + dy * t;
    if (isInsideUnminedDiamond(px, py, 0.45, cells, mapDef)) return false;
    if (mapDef && !mapDef.isPlayable(Math.floor(px), Math.floor(py))) return false;
  }
  return true;
}

/**
 * A* pathfinding on the tile grid. Returns world-coordinate waypoints
 * (tile centers) from start to goal, or null if no path exists.
 * Max 3000 node expansions to bound cost on large maps.
 */
export function findTilePath(
  startX: number, startY: number, goalX: number, goalY: number,
  cells: GoldCell[], mapDef?: MapDef,
): { x: number; y: number }[] | null {
  const w = mapDef?.width ?? MAP_WIDTH;
  const h = mapDef?.height ?? MAP_HEIGHT;

  const sx = Math.max(0, Math.min(w - 1, Math.floor(startX)));
  const sy = Math.max(0, Math.min(h - 1, Math.floor(startY)));
  const gx = Math.max(0, Math.min(w - 1, Math.floor(goalX)));
  const gy = Math.max(0, Math.min(h - 1, Math.floor(goalY)));
  if (sx === gx && sy === gy) return [];

  // If goal tile is blocked, bail — caller will fall back to moveWithSlide
  if (!isTileWalkable(gx, gy, cells, mapDef)) return null;

  const idx = (x: number, y: number) => y * w + x;
  const size = w * h;

  const gScore = new Float32Array(size).fill(Infinity);
  const fArr = new Float32Array(size).fill(Infinity);
  const parentIdx = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);

  // Binary min-heap storing tile indices, ordered by fArr
  const heap: number[] = [];

  function heapPush(ti: number): void {
    heap.push(ti);
    let i = heap.length - 1;
    while (i > 0) {
      const pi = (i - 1) >> 1;
      if (fArr[heap[pi]] <= fArr[heap[i]]) break;
      const tmp = heap[pi]; heap[pi] = heap[i]; heap[i] = tmp;
      i = pi;
    }
  }
  function heapPop(): number {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        let min = i;
        const l = 2 * i + 1, r = 2 * i + 2;
        if (l < heap.length && fArr[heap[l]] < fArr[heap[min]]) min = l;
        if (r < heap.length && fArr[heap[r]] < fArr[heap[min]]) min = r;
        if (min === i) break;
        const tmp = heap[i]; heap[i] = heap[min]; heap[min] = tmp;
        i = min;
      }
    }
    return top;
  }

  const si = idx(sx, sy);
  gScore[si] = 0;
  fArr[si] = octileH(sx, sy, gx, gy);
  heapPush(si);

  let expansions = 0;
  const gi = idx(gx, gy);

  while (heap.length > 0) {
    const cur = heapPop();
    if (cur === gi) {
      // Reconstruct path (tile centers as world coords)
      const path: { x: number; y: number }[] = [];
      let ci = cur;
      while (ci !== si) {
        const cx = ci % w, cy = (ci - cx) / w;
        path.push({ x: cx + 0.5, y: cy + 0.5 });
        ci = parentIdx[ci];
      }
      path.reverse();
      return path;
    }

    if (closed[cur]) continue;
    closed[cur] = 1;
    if (++expansions > 3000) return null; // safety cap

    const cx = cur % w, cy = (cur - cx) / w;

    for (let d = 0; d < 8; d++) {
      const dir = ASTAR_DIRS[d];
      const nx = cx + dir.dx, ny = cy + dir.dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = idx(nx, ny);
      if (closed[ni]) continue;
      if (!isTileWalkable(nx, ny, cells, mapDef)) continue;

      // Prevent diagonal corner-cutting through blocked tiles
      if (dir.dx !== 0 && dir.dy !== 0) {
        if (!isTileWalkable(cx + dir.dx, cy, cells, mapDef) ||
            !isTileWalkable(cx, cy + dir.dy, cells, mapDef)) continue;
      }

      const ng = gScore[cur] + dir.cost;
      if (ng < gScore[ni]) {
        parentIdx[ni] = cur;
        gScore[ni] = ng;
        fArr[ni] = ng + octileH(nx, ny, gx, gy);
        heapPush(ni);
      }
    }
  }
  return null; // no path
}

/**
 * Simplify an A* tile path by removing waypoints that have
 * clear line-of-sight to later waypoints.
 */
export function smoothPath(path: { x: number; y: number }[], cells: GoldCell[], mapDef?: MapDef): { x: number; y: number }[] {
  if (path.length <= 2) return path;
  const result: { x: number; y: number }[] = [path[0]];
  let cur = 0;
  while (cur < path.length - 1) {
    // Greedily skip to the furthest visible waypoint
    let furthest = cur + 1;
    for (let i = path.length - 1; i > cur + 1; i--) {
      if (hasLineOfSight(path[cur].x, path[cur].y, path[i].x, path[i].y, cells, mapDef)) {
        furthest = i;
        break;
      }
    }
    result.push(path[furthest]);
    cur = furthest;
  }
  return result;
}

/**
 * Compute a smoothed A* path for a harvester, or return [] if direct
 * movement is fine (no diamond in the way).
 */
export function computeHarvesterPath(sx: number, sy: number, tx: number, ty: number, cells: GoldCell[], mapDef?: MapDef): { x: number; y: number }[] {
  if (hasLineOfSight(sx, sy, tx, ty, cells, mapDef)) return [];
  const raw = findTilePath(sx, sy, tx, ty, cells, mapDef);
  if (!raw || raw.length === 0) return [];
  return smoothPath(raw, cells, mapDef);
}

/**
 * Returns the center of the nearest blocking obstacle, or null if none.
 * Used for steering around obstacles.
 */
export function getNearestObstacleCenter(x: number, y: number, pad: number, cells: GoldCell[], mapDef?: MapDef): { cx: number; cy: number } | null {
  // Check HQs
  const hqB = getHQPosition(Team.Bottom, mapDef);
  const hqT = getHQPosition(Team.Top, mapDef);
  if (isInsideHQEllipse(x, y, hqB.x, hqB.y, HQ_WIDTH, HQ_HEIGHT, pad)) {
    return { cx: hqB.x + HQ_WIDTH / 2, cy: hqB.y + HQ_HEIGHT / 2 };
  }
  if (isInsideHQEllipse(x, y, hqT.x, hqT.y, HQ_WIDTH, HQ_HEIGHT, pad)) {
    return { cx: hqT.x + HQ_WIDTH / 2, cy: hqT.y + HQ_HEIGHT / 2 };
  }
  // Check diamond — treat entire diamond shape as one obstacle with its center
  const dcx = mapDef?.diamondCenter.x ?? DIAMOND_CENTER_X;
  const dcy = mapDef?.diamondCenter.y ?? DIAMOND_CENTER_Y;
  const dhw = mapDef?.diamondHalfW ?? DIAMOND_HALF_W;
  const dhh = mapDef?.diamondHalfH ?? DIAMOND_HALF_H;
  const ddx = Math.abs(x - dcx) / (dhw + pad);
  const ddy = Math.abs(y - dcy) / (dhh + pad);
  if (ddx + ddy < 1.2) {
    // Near the diamond — check if actually blocked by unmined cells
    if (isInsideUnminedDiamond(x, y, pad, cells, mapDef)) {
      return { cx: dcx, cy: dcy };
    }
  }
  return null;
}

/**
 * Move pos toward (tx, ty) by up to `step` tiles, steering around obstacles.
 * If direct path is blocked, steers tangent to the obstacle surface.
 */
export function moveWithSlide(pos: { x: number; y: number }, tx: number, ty: number, step: number, diamondCells: GoldCell[] = [], mapDef?: MapDef): void {
  const dx = tx - pos.x;
  const dy = ty - pos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.001) return;
  const dirX = dx / dist;
  const dirY = dy / dist;
  const mx = dirX * step;
  const my = dirY * step;
  const pad = 0.45;

  // Try full move
  const nx = pos.x + mx;
  const ny = pos.y + my;
  if (!isBlocked(nx, ny, pad, diamondCells, mapDef)) {
    pos.x = nx;
    pos.y = ny;
    return;
  }

  // Blocked — find obstacle center and steer tangent to it
  const obstacle = getNearestObstacleCenter(nx, ny, pad, diamondCells, mapDef);
  if (obstacle) {
    // Vector from obstacle center to unit
    const fromCx = pos.x - obstacle.cx;
    const fromCy = pos.y - obstacle.cy;
    const fromLen = Math.sqrt(fromCx * fromCx + fromCy * fromCy);
    if (fromLen > 0.01) {
      // Two tangent directions (perpendicular to radius)
      const perpX1 = -fromCy / fromLen;
      const perpY1 = fromCx / fromLen;
      // Pick the tangent that's more aligned with our desired direction
      const dot1 = perpX1 * dirX + perpY1 * dirY;
      const steerX = dot1 >= 0 ? perpX1 : -perpX1;
      const steerY = dot1 >= 0 ? perpY1 : -perpY1;
      const sx = pos.x + steerX * step;
      const sy = pos.y + steerY * step;
      if (!isBlocked(sx, sy, pad, diamondCells, mapDef)) {
        pos.x = sx;
        pos.y = sy;
        return;
      }
      // Try half-steer (blend forward + tangent) for tighter corners
      const blendX = (dirX + steerX * 2) / 3;
      const blendY = (dirY + steerY * 2) / 3;
      const bLen = Math.sqrt(blendX * blendX + blendY * blendY) || 1;
      const bx = pos.x + (blendX / bLen) * step;
      const by = pos.y + (blendY / bLen) * step;
      if (!isBlocked(bx, by, pad, diamondCells, mapDef)) {
        pos.x = bx;
        pos.y = by;
        return;
      }
    }
  }

  // Fallback: try X-only slide
  if (!isBlocked(pos.x + mx, pos.y, pad, diamondCells, mapDef)) {
    pos.x += mx;
    return;
  }
  // Fallback: try Y-only slide
  if (!isBlocked(pos.x, pos.y + my, pad, diamondCells, mapDef)) {
    pos.y += my;
    return;
  }
  // Fully blocked — pushOut will fix next tick
}


// === Unit Collision ===

export function tickUnitCollision(state: GameState): void {
  const units = state.units;
  const minSep = UNIT_COLLISION_RADIUS * 2; // two radii = minimum distance between centers

  // Unit-vs-unit hard collision — creates battle lines.
  // Reuse module-level _collisionGrid (cell size 2) to avoid per-tick Map allocation.
  _collisionGrid.build(units);

  for (const u of units) {
    if (u.hp <= 0) continue;
    const nearby = _collisionGrid.getNearby(u.x, u.y, minSep);
    for (let ni = 0; ni < nearby.length; ni++) {
      const o = nearby[ni];
          if (o.id <= u.id || o.hp <= 0) continue; // process each pair once
          let dx = o.x - u.x;
          let dy = o.y - u.y;
          let dist = Math.sqrt(dx * dx + dy * dy);
          if (dist >= minSep) continue;

          // Exact overlap — push apart in deterministic direction based on IDs
          // Uses 8-direction lookup to avoid platform-dependent Math.cos/sin
          if (dist < 0.0001) {
            const dir = (u.id * 7 + o.id * 13) & 7; // 0-7
            dx = PUSH_DIR_X[dir];
            dy = PUSH_DIR_Y[dir];
            dist = 1; // dx,dy are already a unit vector — don't re-normalize
          }

          const overlap = minSep - dist;
          const nx = dx / dist;
          const ny = dy / dist;

          // Enemies push harder (forms solid front line), allies push laterally
          const sameTeam = u.team === o.team;
          const strength = sameTeam ? UNIT_COLLISION_PUSH_STRENGTH * 0.65 : UNIT_COLLISION_PUSH_STRENGTH;
          const push = overlap * strength * 0.5; // half to each unit

          u.x -= nx * push;
          u.y -= ny * push;
          o.x += nx * push;
          o.y += ny * push;
    }
  }

  for (const unit of units) {
    // Unit-vs-building blocking (skip spawners — units spawn on them)
    for (const building of state.buildings) {
      if (building.type === BuildingType.MeleeSpawner || building.type === BuildingType.RangedSpawner || building.type === BuildingType.CasterSpawner || building.type === BuildingType.HarvesterHut) continue;
      pushOutFromPoint(unit, building.worldX + 0.5, building.worldY + 0.5, COLLISION_BUILDING_RADIUS);
    }

    // Unit-vs-resource blocking (unmined gold cells are obstacles).
    // Use _diamondCellMapInt neighborhood lookup instead of iterating all cells (O(9) vs O(300+))
    const ux = Math.floor(unit.x), uy = Math.floor(unit.y);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cell = _diamondCellMapInt.get((ux + dx) * 10000 + (uy + dy));
        if (cell && cell.gold > 0) {
          pushOutFromPoint(unit, cell.tileX + 0.5, cell.tileY + 0.5, COLLISION_GOLD_CELL_RADIUS);
        }
      }
    }

    clampToArenaBounds(unit, 0.35, state.mapDef);
  }
}
