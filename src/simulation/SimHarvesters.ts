/**
 * Harvester AI: mining, resource delivery, and pathfinding.
 *
 * Tick function (called from simulateTick in GameState.ts):
 *   tickHarvesters — runs all harvester state machines each tick:
 *     1. Soft collision pushout between harvesters
 *     2. Orphan cleanup (hut destroyed)
 *     3. Respawn timer for dead harvesters
 *     4. Per-harvester state: walking_to_node → mining → walking_home → delivering
 *     5. Center/diamond harvesters (separate sub-state machine)
 *     6. Tenders Growth Pod passive resource cycling
 */
import {
  GameState, Race,
  BuildingType, HarvesterState, ResourceType,
  HarvesterAssignment,
  TICK_RATE, HQ_WIDTH, HQ_HEIGHT,
} from './types';
import {
  HARVESTER_MOVE_SPEED, MINE_TIME_BASE_TICKS, MINE_TIME_DIAMOND_TICKS,
  HARVESTER_MIN_SEPARATION,
  GOLD_YIELD_PER_TRIP, MEAT_YIELD_PER_TRIP, DIAMOND_CELLS_PER_TRIP,
} from './data';
import {
  addSound, addFloatingText,
  compactInPlace,
  _unitById, _diamondCellMapInt, _combatGrid, _buildingIdSet,
  WOOD_CARRY_PER_TRIP,
  resourceDeliverySounds, incResourceDeliverySounds,
} from './SimShared';
import {
  getHQPosition, getResourceNodePosition,
} from './SimLayout';
import {
  moveWithSlide, computeHarvesterPath,
  clampToArenaBounds,
} from './SimMovement';
import {
  dropDiamond, collectWoodPiles, spillCarriedWood, killHarvester, dropWoodPile,
  spawnDiamondChampion, resetDiamondForRespawn,
} from './SimAbilities';
import { isInsideAnyHQ } from './SimMovement';

// === Harvesters ===

export function findOpenMiningSpot(state: GameState, h: HarvesterState, target: { x: number; y: number }): { x: number; y: number } {
  // Check if any other harvester is already mining within 1.2 tiles of target
  const otherMiners = state.harvesters.filter(o =>
    o.id !== h.id && o.state === 'mining' && o.assignment === h.assignment &&
    Math.sqrt((o.x - target.x) ** 2 + (o.y - target.y) ** 2) < 1.2
  );
  if (otherMiners.length === 0) return target;

  // Wood nodes read better with a wider ring so the forest feels broader and less pinched.
  const baseRing = h.assignment === HarvesterAssignment.Wood ? 1.8 : 1.0;
  const ringDist = baseRing + otherMiners.length * 0.75;
  const angleStep = (Math.PI * 2) / 8;
  const baseAngle = (h.id * 137.508) % (Math.PI * 2); // golden angle spread
  let bestSpot = target;
  let bestOccupied = Infinity;

  for (let i = 0; i < 8; i++) {
    const a = baseAngle + i * angleStep;
    const cx = target.x + Math.cos(a) * ringDist;
    const cy = target.y + Math.sin(a) * ringDist;
    // Count how many miners are near this spot
    let occupied = 0;
    for (const o of otherMiners) {
      if (Math.sqrt((o.x - cx) ** 2 + (o.y - cy) ** 2) < 1.0) occupied++;
    }
    if (occupied < bestOccupied) {
      bestOccupied = occupied;
      bestSpot = { x: cx, y: cy };
    }
  }
  return bestSpot;
}

export function tickHarvesters(state: GameState): void {
  // Soft collision between harvesters: push apart
  for (let i = 0; i < state.harvesters.length; i++) {
    const a = state.harvesters[i];
    if (a.state === 'dead') continue;
    for (let j = i + 1; j < state.harvesters.length; j++) {
      const b = state.harvesters[j];
      if (b.state === 'dead') continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minDist = HARVESTER_MIN_SEPARATION;
      if (dist < minDist && dist > 0.01) {
        const push = (minDist - dist) * 0.3;
        const nx = dx / dist, ny = dy / dist;
        // Don't push miners who are actively mining
        if (a.state !== 'mining') { a.x -= nx * push; a.y -= ny * push; }
        if (b.state !== 'mining') { b.x += nx * push; b.y += ny * push; }
      }
    }
  }
  for (const h of state.harvesters) {
    if (h.state === 'dead') continue;
    clampToArenaBounds(h, 0.3, state.mapDef);
  }

  // Remove orphaned harvesters whose huts were destroyed
  // Build a Set of building IDs once — O(buildings + harvesters) instead of O(buildings * harvesters)
  _buildingIdSet.clear();
  for (const b of state.buildings) _buildingIdSet.add(b.id);
  compactInPlace(state.harvesters, h => {
    if (!_buildingIdSet.has(h.hutId)) {
      if (h.carryingDiamond) dropDiamond(state, h.x, h.y);
      spillCarriedWood(state, h);
      return false;
    }
    return true;
  });

  // Pre-compute shared context for center harvesters (once per tick, not per harvester)
  const centerCtx = buildCenterHarvesterContext(state);

  for (const h of state.harvesters) {
    if (h.state === 'dead') {
      h.respawnTimer--;
      if (h.respawnTimer <= 0) {
        const hut = state.buildings.find(b => b.id === h.hutId);
        if (hut) {
          h.x = hut.worldX; h.y = hut.worldY;
          h.hp = h.maxHp; h.state = 'walking_to_node';
          h.carryingDiamond = false; h.carryingResource = null; h.carryAmount = 0;
          h.queuedWoodAmount = 0; h.woodCarryTarget = 0; h.woodDropsCreated = 0;
          h.targetCellIdx = -1; h.diamondCellsMinedThisTrip = 0; h.fightTargetId = null; h.damage = 0;
          h.path = [];
        }
      }
      continue;
    }

    // Frightened: 50% slower when enemies within 5 tiles
    let frightened = false;
    const harvNearby = _combatGrid.getNearby(h.x, h.y, 5);
    for (const u of harvNearby) {
      if (u.team === h.team || u.hp <= 0) continue;
      const dx = u.x - h.x, dy = u.y - h.y;
      if (dx * dx + dy * dy <= 25) { frightened = true; break; }
    }
    let workerSpeedMult = 1.0;
    const hPlayer = state.players[h.playerId];
    // Crown: Swift Workers (+40% move speed)
    if (hPlayer?.researchUpgrades.raceUpgrades['crown_ability_1']) workerSpeedMult *= 1.4;
    // Wild: Pack Speed (+15% global move speed for workers too)
    if (hPlayer?.researchUpgrades.raceUpgrades['wild_ability_3']) workerSpeedMult *= 1.10;
    const movePerTick = (HARVESTER_MOVE_SPEED / TICK_RATE) * (frightened ? 0.5 : 1.0) * workerSpeedMult;

    if (h.assignment === HarvesterAssignment.Center) {
      tickCenterHarvester(state, h, movePerTick, centerCtx);
      clampToArenaBounds(h, 0.3, state.mapDef);
      continue;
    }

    // Demon mana assignment: harvester walks to Research building and channels there permanently
    if (h.assignment === HarvesterAssignment.Mana) {
      const MANA_CHANNEL_TICKS = 4 * TICK_RATE; // 2 mana every 4s per channeling worker
      const research = state.buildings.find(b => b.type === BuildingType.Research && b.playerId === h.playerId);
      if (!research) {
        // No research building yet — idle in place
        h.state = 'mining'; h.miningTimer = MANA_CHANNEL_TICKS;
        clampToArenaBounds(h, 0.3, state.mapDef);
        continue;
      }
      const targetX = research.worldX + 0.5;
      const targetY = research.worldY + 0.5;
      if (h.state === 'walking_to_node' || h.state === 'walking_home') {
        const dx = targetX - h.x, dy = targetY - h.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1.5) {
          h.state = 'mining';
          h.miningTimer = MANA_CHANNEL_TICKS;
          h.carryingResource = null;
          h.carryAmount = 0;
        } else {
          h.x += (dx / dist) * movePerTick;
          h.y += (dy / dist) * movePerTick;
        }
      } else if (h.state === 'mining') {
        h.miningTimer = Math.max(0, h.miningTimer - 1);
        if (h.miningTimer <= 0) {
          const manaOwner = state.players[h.playerId];
          if (manaOwner) {
            // Demon Mana Siphon: +50% mana from channeling
            const manaAmt = manaOwner.researchUpgrades.raceUpgrades['demon_ability_4'] ? 3 : 2;
            manaOwner.mana += manaAmt;
            addFloatingText(state, h.x, h.y - 0.3, `+${manaAmt}`, '#7c4dff', 'mana', undefined, { ownerOnly: h.playerId });
          }
          h.miningTimer = MANA_CHANNEL_TICKS;
        }
      }
      clampToArenaBounds(h, 0.3, state.mapDef);
      continue;
    }

    const baseTarget = getResourceNodePosition(h, state.mapDef);
    if (h.state === 'walking_to_node') {
      const target = findOpenMiningSpot(state, h, baseTarget);
      const dx = target.x - h.x, dy = target.y - h.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) {
        if (h.assignment === HarvesterAssignment.Wood) {
          const gathered = collectWoodPiles(state, baseTarget.x, baseTarget.y, WOOD_CARRY_PER_TRIP);
          if (gathered >= WOOD_CARRY_PER_TRIP) {
            h.carryingResource = ResourceType.Wood;
            h.carryAmount = gathered;
            h.state = 'walking_home';
            h.queuedWoodAmount = 0;
            h.woodCarryTarget = 0;
            h.woodDropsCreated = 0;
          } else {
            h.queuedWoodAmount = gathered;
            h.woodCarryTarget = WOOD_CARRY_PER_TRIP;
            h.woodDropsCreated = 0;
            h.state = 'mining';
            h.miningTimer = MINE_TIME_BASE_TICKS;
          }
        } else {
          h.state = 'mining';
          h.miningTimer = MINE_TIME_BASE_TICKS;
        }
      } else {
        // Follow A* path if one exists, otherwise compute or move direct
        if (h.path.length > 0) {
          // Validate: discard stale path if endpoint is far from current target
          const last = h.path[h.path.length - 1];
          if ((last.x - baseTarget.x) ** 2 + (last.y - baseTarget.y) ** 2 > 9) h.path = [];
        }
        if (h.path.length > 0) {
          const wp = h.path[0];
          const wdx = wp.x - h.x, wdy = wp.y - h.y;
          if (wdx * wdx + wdy * wdy < 2.25) h.path.shift(); // reached waypoint (< 1.5 tiles)
          if (h.path.length > 0) {
            moveWithSlide(h, h.path[0].x, h.path[0].y, movePerTick, state.diamondCells, state.mapDef);
          } else {
            moveWithSlide(h, target.x, target.y, movePerTick, state.diamondCells, state.mapDef);
          }
        } else {
          // No path — check if we need one
          const newPath = computeHarvesterPath(h.x, h.y, baseTarget.x, baseTarget.y, state.diamondCells, state.mapDef);
          if (newPath.length > 0) {
            h.path = newPath;
            moveWithSlide(h, h.path[0].x, h.path[0].y, movePerTick, state.diamondCells, state.mapDef);
          } else {
            moveWithSlide(h, target.x, target.y, movePerTick, state.diamondCells, state.mapDef);
          }
        }
      }
    } else if (h.state === 'mining') {
      h.miningTimer--;
      if (h.assignment === HarvesterAssignment.Wood) {
        const missingWood = Math.max(0, h.woodCarryTarget - h.queuedWoodAmount);
        const batchCount = 1;
        const progress = Math.max(0, MINE_TIME_BASE_TICKS - h.miningTimer);
        const desiredDrops = Math.min(batchCount, Math.floor((progress / MINE_TIME_BASE_TICKS) * batchCount));
        while (h.woodDropsCreated < desiredDrops) {
          const batchIndex = h.woodDropsCreated;
          const amount = Math.floor(missingWood / batchCount) + (batchIndex < (missingWood % batchCount) ? 1 : 0);
          if (amount > 0) dropWoodPile(state, baseTarget.x, baseTarget.y, amount, h.id * 17 + batchIndex * 29);
          h.woodDropsCreated++;
        }
      }
      if (h.miningTimer <= 0) {
        switch (h.assignment) {
          case HarvesterAssignment.BaseGold: {
            // Crown foundry bonus: +1 gold per trip per foundry
            const foundryBonus = state.players[h.playerId]?.race === Race.Crown
              ? state.buildings.filter(fb => fb.isFoundry && fb.playerId === h.playerId && fb.hp > 0).length
              : 0;
            h.carryingResource = ResourceType.Gold; h.carryAmount = GOLD_YIELD_PER_TRIP + foundryBonus; break;
          }
          case HarvesterAssignment.Wood: {
            const missingWood = Math.max(0, h.woodCarryTarget - h.queuedWoodAmount);
            h.queuedWoodAmount += collectWoodPiles(state, baseTarget.x, baseTarget.y, missingWood);
            h.carryingResource = ResourceType.Wood;
            h.carryAmount = h.queuedWoodAmount;
            h.queuedWoodAmount = 0;
            h.woodCarryTarget = 0;
            h.woodDropsCreated = 0;
            break;
          }
          case HarvesterAssignment.Meat:
            h.carryingResource = ResourceType.Meat; h.carryAmount = MEAT_YIELD_PER_TRIP; break;
        }
        h.state = h.carryAmount > 0 ? 'walking_home' : 'walking_to_node';
      }
    } else if (h.state === 'walking_home') {
      walkHome(state, h, movePerTick);
    }

    clampToArenaBounds(h, 0.3, state.mapDef);
  }
}

const CARDINAL_DIRS: ReadonlyArray<readonly [number, number]> = [[0, -1], [0, 1], [-1, 0], [1, 0]];

/** Pre-compute shared data for center harvesters (once per tick). */
export function buildCenterHarvesterContext(state: GameState): { taken: Set<number> } {
  const taken = new Set<number>();
  for (const oh of state.harvesters) {
    if (oh.state === 'dead') continue;
    if (oh.assignment === HarvesterAssignment.Center && oh.targetCellIdx >= 0) {
      taken.add(oh.targetCellIdx);
    }
  }
  return { taken };
}

/** Find an unmined diamond cell the harvester can reach (has a passable adjacent tile). */
export function findMinableDiamondCell(
  state: GameState,
  h: HarvesterState,
  taken: Set<number>,
): { cellIdx: number; minePos: { x: number; y: number } } | null {
  const cells = state.diamondCells;
  let bestIdx = -1;
  let bestPos = { x: 0, y: 0 };
  let bestDist = Infinity;

  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c.gold <= 0) continue;
    if (taken.has(i)) continue;

    // Find a passable adjacent position (cardinal directions)
    let adjBest: { x: number; y: number } | null = null;
    let adjBestDist = Infinity;
    for (const [ox, oy] of CARDINAL_DIRS) {
      const ax = c.tileX + ox;
      const ay = c.tileY + oy;
      // Adjacent cell must not be unmined (O(1) integer-key lookup instead of string Set)
      const adjCell = _diamondCellMapInt.get(ax * 10000 + ay);
      if (adjCell && adjCell.gold > 0) continue;
      // Must not be inside an HQ
      if (isInsideAnyHQ(ax + 0.5, ay + 0.5, 0.3)) continue;
      const dx = (ax + 0.5) - h.x, dy = (ay + 0.5) - h.y;
      const d = dx * dx + dy * dy;
      if (d < adjBestDist) {
        adjBestDist = d;
        adjBest = { x: ax + 0.5, y: ay + 0.5 };
      }
    }
    if (!adjBest) continue; // no accessible side

    const dx = adjBest.x - h.x, dy = adjBest.y - h.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist || (d === bestDist && i < bestIdx)) {
      bestDist = d;
      bestIdx = i;
      bestPos = adjBest;
    }
  }

  return bestIdx >= 0 ? { cellIdx: bestIdx, minePos: bestPos } : null;
}

export function tickCenterHarvester(state: GameState, h: HarvesterState, movePerTick: number, centerCtx: { taken: Set<number> }): void {
  if (h.carryingDiamond) {
    if (h.state !== 'walking_home') h.state = 'walking_home';
    walkHome(state, h, movePerTick);
    return;
  }

  const enemyCarrier = state.harvesters.find(
    eh => eh.team !== h.team && eh.carryingDiamond && eh.state !== 'dead'
  );
  if (enemyCarrier) {
    h.damage = 5;
    const dx = enemyCarrier.x - h.x, dy = enemyCarrier.y - h.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1.5) {
      if (h.state !== 'fighting') h.state = 'fighting';
      h.fightTargetId = enemyCarrier.id;
      if (state.tick % TICK_RATE === 0) {
        enemyCarrier.hp -= h.damage;
        addFloatingText(state, enemyCarrier.x, enemyCarrier.y, `${h.damage}`, '#ffffff', undefined, undefined,
          { ftType: 'damage', magnitude: h.damage, miniIcon: 'sword' });
        if (enemyCarrier.hp <= 0) {
          killHarvester(state, enemyCarrier);
        }
      }
    } else {
      h.state = 'walking_to_node';
      moveWithSlide(h, enemyCarrier.x, enemyCarrier.y, movePerTick, [], state.mapDef);
    }
    return;
  }

  h.damage = 0;

  if (state.diamond.exposed && (state.diamond.state === 'exposed' || state.diamond.state === 'dropped')) {
    const targetX = state.diamond.x;
    const targetY = state.diamond.y;
    const dx = targetX - h.x, dy = targetY - h.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 1.5) {
      if (state.diamond.state === 'dropped') {
        h.carryingDiamond = true;
        state.diamond.state = 'carried';
        state.diamond.carrierId = h.id;
        state.diamond.carrierType = 'harvester';
        h.state = 'walking_home';
        addSound(state, 'diamond_carried', h.x, h.y);
      } else if (h.state !== 'mining') {
        h.state = 'mining';
        h.miningTimer = MINE_TIME_DIAMOND_TICKS;
      } else {
        h.miningTimer--;
        if (h.miningTimer <= 0) {
          h.carryingDiamond = true;
          state.diamond.state = 'carried';
          state.diamond.carrierId = h.id;
          state.diamond.carrierType = 'harvester';
          h.state = 'walking_home';
        }
      }
    } else {
      h.state = 'walking_to_node';
      moveWithSlide(h, targetX, targetY, movePerTick, [], state.mapDef);
    }
    return;
  }

  // Diamond not yet exposed — mine diamond gold cells to clear a path and expose it.
  if (h.state === 'walking_home') {
    walkHome(state, h, movePerTick);
    return;
  }
  if (h.state === 'mining') {
    h.miningTimer--;
    if (h.miningTimer <= 0) {
      const cell = h.targetCellIdx >= 0 ? state.diamondCells[h.targetCellIdx] : null;
      if (cell && cell.gold > 0) {
        // Crown foundry bonus: +1 gold per trip per foundry
        const cFoundryBonus = state.players[h.playerId]?.race === Race.Crown
          ? state.buildings.filter(fb => fb.isFoundry && fb.playerId === h.playerId && fb.hp > 0).length
          : 0;
        const yield_ = Math.min(GOLD_YIELD_PER_TRIP + cFoundryBonus, cell.gold);
        cell.gold -= yield_;
        h.carryingResource = ResourceType.Gold;
        h.carryAmount += yield_;
        if (cell.gold > 0) {
          // Cell not yet cleared — keep mining same cell
          h.miningTimer = MINE_TIME_BASE_TICKS;
        } else {
          // Cell fully cleared
          h.diamondCellsMinedThisTrip++;
          if (h.diamondCellsMinedThisTrip < DIAMOND_CELLS_PER_TRIP) {
            // Mine more cells before heading home
            h.targetCellIdx = -1;
            h.state = 'walking_to_node';
          } else {
            // Hit limit — head home with accumulated gold
            h.diamondCellsMinedThisTrip = 0;
            h.state = 'walking_home';
            h.targetCellIdx = -1;
          }
        }
      } else {
        h.state = 'walking_to_node';
        h.targetCellIdx = -1;
      }
    }
    return;
  }
  // Find nearest unmined cell reachable from outside the diamond
  const cellTarget = findMinableDiamondCell(state, h, centerCtx.taken);
  if (!cellTarget) {
    // All cells mined — idle near diamond center waiting for exposure check
    const dc = state.mapDef.diamondCenter;
    const dx = dc.x - h.x, dy = dc.y - h.y;
    if (dx * dx + dy * dy > 4) {
      h.state = 'walking_to_node';
      moveWithSlide(h, dc.x, dc.y, movePerTick, state.diamondCells, state.mapDef);
    }
    return;
  }
  // Walk to position adjacent to the target cell
  const adjPos = cellTarget.minePos;
  const dx = adjPos.x - h.x, dy = adjPos.y - h.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) {
    h.state = 'mining';
    h.miningTimer = MINE_TIME_BASE_TICKS;
    h.targetCellIdx = cellTarget.cellIdx;
  } else {
    h.state = 'walking_to_node';
    moveWithSlide(h, adjPos.x, adjPos.y, movePerTick, state.diamondCells, state.mapDef);
  }
}

export function getDropOffTarget(state: GameState, h: HarvesterState): { x: number; y: number } {
  const hq = getHQPosition(h.team, state.mapDef);
  let tx = hq.x + HQ_WIDTH / 2, ty = hq.y + HQ_HEIGHT / 2;
  // Diamond must go to HQ (spawns champion)
  if (h.carryingDiamond) return { x: tx, y: ty };
  // Crown foundries act as drop-off points — pick nearest
  const player = state.players[h.playerId];
  if (player?.race === Race.Crown) {
    let bestDist = (tx - h.x) ** 2 + (ty - h.y) ** 2;
    for (const b of state.buildings) {
      if (!b.isFoundry || b.playerId !== h.playerId || b.hp <= 0) continue;
      const fx = b.worldX + 0.5, fy = b.worldY + 0.5;
      const fd = (fx - h.x) ** 2 + (fy - h.y) ** 2;
      if (fd < bestDist) { bestDist = fd; tx = fx; ty = fy; }
    }
  }
  return { x: tx, y: ty };
}

export function walkHome(state: GameState, h: HarvesterState, movePerTick: number): void {
  const target = getDropOffTarget(state, h);
  const tx = target.x, ty = target.y;
  const dx = tx - h.x, dy = ty - h.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 2) {
    const player = state.players[h.playerId];
    if (h.carryingDiamond) {
      h.carryingDiamond = false;
      spawnDiamondChampion(state, h.team, h.x, h.y, h.playerId);
      resetDiamondForRespawn(state);
      h.state = 'walking_to_node';
      h.targetCellIdx = -1;
      return;
    }
    const ps = state.playerStats[h.playerId];
    // Apply map resource yield multiplier for wood/meat (not gold — gold has its own economy)
    const yieldMul = (h.carryingResource !== ResourceType.Gold) ? (state.mapDef?.resourceYield ?? 1) : 1;
    const amt = h.carryAmount * yieldMul;
    if (h.carryingResource === ResourceType.Gold) {
      player.gold += amt;
      if (ps) ps.totalGoldEarned += amt;
      addFloatingText(state, h.x, h.y, `+${amt}`, '#ffd700', 'gold');
    } else if (h.carryingResource === ResourceType.Wood) {
      // Crown Timber Surplus: +40% wood returned
      const woodAmt = (player.race === Race.Crown && player.researchUpgrades.raceUpgrades['crown_ability_4'])
        ? Math.round(amt * 1.4) : amt;
      player.wood += woodAmt;
      if (ps) ps.totalWoodEarned += woodAmt;
      addFloatingText(state, h.x, h.y, `+${woodAmt}`, '#8d6e63', 'wood');
    } else if (h.carryingResource === ResourceType.Meat) {
      player.meat += amt;
      if (ps) ps.totalMeatEarned += amt;
      addFloatingText(state, h.x, h.y, `+${amt}`, '#ff5252', 'meat');
    }
    if (resourceDeliverySounds < 1) {
      addSound(state, 'resource_delivered', h.x, h.y, { race: player.race });
      incResourceDeliverySounds();
    }
    h.carryingResource = null;
    h.carryAmount = 0;
    h.queuedWoodAmount = 0;
    h.woodCarryTarget = 0;
    h.woodDropsCreated = 0;
    h.state = 'walking_to_node';
    h.path = [];
  } else {
    // Follow A* path or compute one
    if (h.path.length > 0) {
      const last = h.path[h.path.length - 1];
      if ((last.x - tx) ** 2 + (last.y - ty) ** 2 > 9) h.path = [];
    }
    if (h.path.length > 0) {
      const wp = h.path[0];
      const wdx = wp.x - h.x, wdy = wp.y - h.y;
      if (wdx * wdx + wdy * wdy < 2.25) h.path.shift();
      if (h.path.length > 0) {
        moveWithSlide(h, h.path[0].x, h.path[0].y, movePerTick, state.diamondCells, state.mapDef);
      } else {
        moveWithSlide(h, tx, ty, movePerTick, state.diamondCells, state.mapDef);
      }
    } else {
      const newPath = computeHarvesterPath(h.x, h.y, tx, ty, state.diamondCells, state.mapDef);
      if (newPath.length > 0) {
        h.path = newPath;
        moveWithSlide(h, h.path[0].x, h.path[0].y, movePerTick, state.diamondCells, state.mapDef);
      } else {
        moveWithSlide(h, tx, ty, movePerTick, state.diamondCells, state.mapDef);
      }
    }
  }
}
