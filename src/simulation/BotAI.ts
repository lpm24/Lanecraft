import {
  GameState, GameCommand, Race, BuildingType, Lane, Team,
  BUILD_GRID_COLS, BUILD_GRID_ROWS, HarvesterAssignment, HQ_HP,
  SHARED_ALLEY_COLS, SHARED_ALLEY_ROWS,
} from './types';
import { RACE_BUILDING_COSTS, RACE_UPGRADE_COSTS } from './data';

// --- Bot personality profiles per race ---
interface RaceProfile {
  earlyMelee: number;
  earlyRanged: number;
  earlyHuts: number;
  earlyTowers: number;
  midMelee: number;
  midRanged: number;
  midCasters: number;
  midTowers: number;
  midHuts: number;
  lateTowers: number;
  alleyTowers: number;
  meleeUpgradeBias: 'B' | 'C';
  rangedUpgradeBias: 'B' | 'C';
  casterUpgradeBias: 'B' | 'C';
  towerUpgradeBias: 'B' | 'C';
}

const RACE_PROFILES: Record<Race, RaceProfile> = {
  [Race.Surge]: {
    earlyMelee: 1, earlyRanged: 1, earlyHuts: 2, earlyTowers: 0,
    midMelee: 2, midRanged: 2, midCasters: 1, midTowers: 1, midHuts: 3,
    lateTowers: 2, alleyTowers: 2,
    meleeUpgradeBias: 'C', rangedUpgradeBias: 'C', casterUpgradeBias: 'C', towerUpgradeBias: 'C',
  },
  [Race.Tide]: {
    earlyMelee: 1, earlyRanged: 0, earlyHuts: 2, earlyTowers: 1,
    midMelee: 2, midRanged: 1, midCasters: 1, midTowers: 2, midHuts: 4,
    lateTowers: 2, alleyTowers: 3,
    meleeUpgradeBias: 'B', rangedUpgradeBias: 'C', casterUpgradeBias: 'C', towerUpgradeBias: 'C',
  },
  [Race.Ember]: {
    earlyMelee: 2, earlyRanged: 0, earlyHuts: 1, earlyTowers: 0,
    midMelee: 2, midRanged: 1, midCasters: 2, midTowers: 1, midHuts: 3,
    lateTowers: 1, alleyTowers: 2,
    meleeUpgradeBias: 'C', rangedUpgradeBias: 'B', casterUpgradeBias: 'B', towerUpgradeBias: 'B',
  },
  [Race.Bastion]: {
    earlyMelee: 2, earlyRanged: 0, earlyHuts: 2, earlyTowers: 0,
    midMelee: 3, midRanged: 1, midCasters: 1, midTowers: 1, midHuts: 4,
    lateTowers: 2, alleyTowers: 2,
    meleeUpgradeBias: 'B', rangedUpgradeBias: 'B', casterUpgradeBias: 'B', towerUpgradeBias: 'B',
  },
  [Race.Shade]: {
    earlyMelee: 1, earlyRanged: 1, earlyHuts: 2, earlyTowers: 0,
    midMelee: 2, midRanged: 2, midCasters: 1, midTowers: 1, midHuts: 3,
    lateTowers: 2, alleyTowers: 2,
    meleeUpgradeBias: 'C', rangedUpgradeBias: 'B', casterUpgradeBias: 'C', towerUpgradeBias: 'C',
  },
  [Race.Thorn]: {
    earlyMelee: 2, earlyRanged: 0, earlyHuts: 2, earlyTowers: 0,
    midMelee: 3, midRanged: 1, midCasters: 1, midTowers: 1, midHuts: 4,
    lateTowers: 2, alleyTowers: 3,
    meleeUpgradeBias: 'C', rangedUpgradeBias: 'C', casterUpgradeBias: 'C', towerUpgradeBias: 'C',
  },
};

export { RACE_PROFILES };
export type { RaceProfile };

// Persistent per-bot state (chat cooldowns etc.)
export interface BotContext {
  lastChatTick: Record<number, number>;
}

export function createBotContext(): BotContext {
  return { lastChatTick: {} };
}

// --- Helpers ---

function botTeam(playerId: number): Team {
  return playerId < 2 ? Team.Bottom : Team.Top;
}

function botEnemyTeam(playerId: number): Team {
  return playerId < 2 ? Team.Top : Team.Bottom;
}

function botCanAfford(state: GameState, playerId: number, type: BuildingType): boolean {
  const player = state.players[playerId];
  const cost = RACE_BUILDING_COSTS[player.race][type];
  return player.gold >= cost.gold && player.wood >= cost.wood && player.stone >= cost.stone;
}

function botCanAffordHut(state: GameState, playerId: number, hutCount: number): boolean {
  const player = state.players[playerId];
  const hutRes = RACE_BUILDING_COSTS[player.race][BuildingType.HarvesterHut];
  const mult = Math.pow(1.35, Math.max(0, hutCount - 1));
  return player.gold >= Math.floor(hutRes.gold * mult)
    && player.wood >= Math.floor(hutRes.wood * mult)
    && player.stone >= Math.floor(hutRes.stone * mult);
}

function unitStrength(u: GameState['units'][0]): number {
  return (u.hp / u.maxHp) * u.damage + 1;
}

// --- Command emitter type ---
type Emit = (cmd: GameCommand) => void;

// --- Main entry point ---

export function runAllBotAI(state: GameState, ctx: BotContext, emit: Emit): void {
  for (const player of state.players) {
    if (!player.isBot) continue;
    if (state.matchPhase !== 'playing') continue;
    runSingleBotAI(state, ctx, player.id, emit);
  }
}

function runSingleBotAI(state: GameState, ctx: BotContext, playerId: number, emit: Emit): void {
  const player = state.players[playerId];
  const profile = RACE_PROFILES[player.race];
  const myBuildings = state.buildings.filter(b => b.playerId === playerId);
  const meleeCount = myBuildings.filter(b => b.type === BuildingType.MeleeSpawner).length;
  const rangedCount = myBuildings.filter(b => b.type === BuildingType.RangedSpawner).length;
  const casterCount = myBuildings.filter(b => b.type === BuildingType.CasterSpawner).length;
  const towerCount = myBuildings.filter(b => b.type === BuildingType.Tower && b.buildGrid === 'military').length;
  const alleyTowerCount = myBuildings.filter(b => b.type === BuildingType.Tower && b.buildGrid === 'alley').length;
  const hutCount = myBuildings.filter(b => b.type === BuildingType.HarvesterHut).length;

  const interval = 80 + playerId * 15;
  if (state.tick % interval !== 0) return;

  const gameMinutes = state.tick / (20 * 60);
  const myTeam = botTeam(playerId);
  const myHqHp = state.hqHp[myTeam];
  const enemyHqHp = state.hqHp[botEnemyTeam(playerId)];

  // 0. Place free tower immediately if we have none
  const totalTowers = towerCount + alleyTowerCount;
  if (totalTowers === 0) {
    botPlaceAlleyTower(state, playerId, emit);
  }

  // 1. Build order + emergency rebuilds
  const totalSpawners = meleeCount + rangedCount + casterCount;
  if (totalSpawners === 0 && gameMinutes > 0.5 && botCanAfford(state, playerId, BuildingType.MeleeSpawner)) {
    botPlaceBuilding(state, playerId, BuildingType.MeleeSpawner, myBuildings, emit);
  } else if (hutCount === 0 && gameMinutes > 0.5 && botCanAffordHut(state, playerId, hutCount)) {
    emit({ type: 'build_hut', playerId });
  } else {
    botDoBuildOrder(state, playerId, profile, myBuildings,
      meleeCount, rangedCount, casterCount, towerCount, alleyTowerCount, hutCount,
      gameMinutes, emit);
  }

  // 2. Upgrades
  botUpgradeBuildings(state, playerId, player.race, profile, myBuildings, emit);

  // 3. Lane pressure
  botEvaluateLanes(state, playerId, myTeam, myBuildings, emit);

  // 4. Harvesters
  botManageHarvesters(state, playerId, player, gameMinutes, emit);

  // 5. Nuke
  const nukeMinTime = myHqHp < HQ_HP * 0.5 ? 1 : 2;
  if (player.nukeAvailable && gameMinutes > nukeMinTime) {
    botFireNuke(state, playerId, myTeam, myHqHp, emit);
  }

  // 6. Quick chat
  botQuickChat(state, ctx, playerId, myHqHp, enemyHqHp, gameMinutes, emit);
}

// ==================== BUILD ORDER ====================

function botDoBuildOrder(
  state: GameState, playerId: number, profile: RaceProfile,
  myBuildings: GameState['buildings'],
  meleeCount: number, rangedCount: number, casterCount: number,
  towerCount: number, alleyTowerCount: number, hutCount: number,
  gameMinutes: number, emit: Emit,
): boolean {
  if (gameMinutes < 1.5) {
    if (meleeCount < profile.earlyMelee && botCanAfford(state, playerId, BuildingType.MeleeSpawner)) {
      botPlaceBuilding(state, playerId, BuildingType.MeleeSpawner, myBuildings, emit); return true;
    }
    if (rangedCount < profile.earlyRanged && botCanAfford(state, playerId, BuildingType.RangedSpawner)) {
      botPlaceBuilding(state, playerId, BuildingType.RangedSpawner, myBuildings, emit); return true;
    }
    if (hutCount < profile.earlyHuts && botCanAffordHut(state, playerId, hutCount)) {
      emit({ type: 'build_hut', playerId }); return true;
    }
    if (towerCount < profile.earlyTowers && botCanAfford(state, playerId, BuildingType.Tower)) {
      botPlaceBuilding(state, playerId, BuildingType.Tower, myBuildings, emit); return true;
    }
    return false;
  }

  if (gameMinutes < 5) {
    if (meleeCount < profile.midMelee && botCanAfford(state, playerId, BuildingType.MeleeSpawner)) {
      botPlaceBuilding(state, playerId, BuildingType.MeleeSpawner, myBuildings, emit); return true;
    }
    if (rangedCount < profile.midRanged && botCanAfford(state, playerId, BuildingType.RangedSpawner)) {
      botPlaceBuilding(state, playerId, BuildingType.RangedSpawner, myBuildings, emit); return true;
    }
    if (casterCount < profile.midCasters && botCanAfford(state, playerId, BuildingType.CasterSpawner)) {
      botPlaceBuilding(state, playerId, BuildingType.CasterSpawner, myBuildings, emit); return true;
    }
    if (hutCount < profile.midHuts && botCanAffordHut(state, playerId, hutCount)) {
      emit({ type: 'build_hut', playerId }); return true;
    }
    if (towerCount < profile.midTowers && botCanAfford(state, playerId, BuildingType.Tower)) {
      botPlaceBuilding(state, playerId, BuildingType.Tower, myBuildings, emit); return true;
    }
    if (profile.alleyTowers >= 3 && alleyTowerCount < 1 && botCanAfford(state, playerId, BuildingType.Tower)) {
      if (botPlaceAlleyTower(state, playerId, emit)) return true;
    }
    return false;
  }

  // Late game
  if (alleyTowerCount < profile.alleyTowers && botCanAfford(state, playerId, BuildingType.Tower)) {
    if (botPlaceAlleyTower(state, playerId, emit)) return true;
  }
  if (towerCount < profile.lateTowers && botCanAfford(state, playerId, BuildingType.Tower)) {
    botPlaceBuilding(state, playerId, BuildingType.Tower, myBuildings, emit); return true;
  }
  if (hutCount < 6 && botCanAffordHut(state, playerId, hutCount)) {
    emit({ type: 'build_hut', playerId }); return true;
  }
  const totalMilitary = meleeCount + rangedCount + casterCount + towerCount;
  if (totalMilitary < BUILD_GRID_COLS * BUILD_GRID_ROWS) {
    if (casterCount < 2 && botCanAfford(state, playerId, BuildingType.CasterSpawner)) {
      botPlaceBuilding(state, playerId, BuildingType.CasterSpawner, myBuildings, emit); return true;
    }
    const preferMelee = meleeCount <= rangedCount || Math.random() < 0.4;
    const type = preferMelee ? BuildingType.MeleeSpawner : BuildingType.RangedSpawner;
    if (botCanAfford(state, playerId, type)) {
      botPlaceBuilding(state, playerId, type, myBuildings, emit); return true;
    }
  }
  if (gameMinutes > 8 && alleyTowerCount < SHARED_ALLEY_COLS * SHARED_ALLEY_ROWS
      && botCanAfford(state, playerId, BuildingType.Tower)) {
    if (botPlaceAlleyTower(state, playerId, emit)) return true;
  }
  return false;
}

function botPlaceBuilding(
  _state: GameState, playerId: number, type: BuildingType,
  myBuildings: GameState['buildings'], emit: Emit,
): void {
  const occupied = new Set(
    myBuildings.filter(b => b.buildGrid === 'military').map(b => `${b.gridX},${b.gridY}`)
  );
  const freeSlots: { gx: number; gy: number }[] = [];
  for (let gy = 0; gy < BUILD_GRID_ROWS; gy++) {
    for (let gx = 0; gx < BUILD_GRID_COLS; gx++) {
      if (!occupied.has(`${gx},${gy}`)) freeSlots.push({ gx, gy });
    }
  }
  if (freeSlots.length === 0) return;

  let slot: { gx: number; gy: number };
  if (type === BuildingType.Tower) {
    const centerX = Math.floor(BUILD_GRID_COLS / 2);
    freeSlots.sort((a, b) => Math.abs(a.gx - centerX) - Math.abs(b.gx - centerX));
    slot = freeSlots[0];
  } else {
    slot = freeSlots[Math.floor(Math.random() * freeSlots.length)];
  }
  emit({ type: 'place_building', playerId, buildingType: type, gridX: slot.gx, gridY: slot.gy });
}

function botPlaceAlleyTower(state: GameState, playerId: number, emit: Emit): boolean {
  const myTeam = botTeam(playerId);
  const teamAlleyBuildings = state.buildings.filter(
    b => b.buildGrid === 'alley' && botTeam(b.playerId) === myTeam
  );
  const occupied = new Set(teamAlleyBuildings.map(b => `${b.gridX},${b.gridY}`));
  const freeSlots: { gx: number; gy: number }[] = [];
  for (let gy = 0; gy < SHARED_ALLEY_ROWS; gy++) {
    for (let gx = 0; gx < SHARED_ALLEY_COLS; gx++) {
      if (!occupied.has(`${gx},${gy}`)) freeSlots.push({ gx, gy });
    }
  }
  if (freeSlots.length === 0) return false;
  const centerX = Math.floor(SHARED_ALLEY_COLS / 2);
  freeSlots.sort((a, b) => Math.abs(a.gx - centerX) - Math.abs(b.gx - centerX));
  const idx = Math.min(Math.floor(Math.random() * 3), freeSlots.length - 1);
  const slot = freeSlots[idx];
  emit({ type: 'place_building', playerId, buildingType: BuildingType.Tower, gridX: slot.gx, gridY: slot.gy, gridType: 'alley' });
  return true;
}

// ==================== UPGRADES ====================

function botUpgradeBuildings(
  state: GameState, playerId: number, race: Race, profile: RaceProfile,
  myBuildings: GameState['buildings'], emit: Emit,
): void {
  const player = state.players[playerId];
  const upgradeable = myBuildings
    .filter(b => b.type !== BuildingType.HarvesterHut && b.upgradePath.length < 3)
    .sort((a, b) => {
      const aPri = a.type === BuildingType.Tower ? 100 : 0;
      const bPri = b.type === BuildingType.Tower ? 100 : 0;
      if (aPri !== bPri) return bPri - aPri;
      return a.placedTick - b.placedTick;
    });

  for (const b of upgradeable) {
    const raceCosts = RACE_UPGRADE_COSTS[player.race];
    const cost = b.upgradePath.length === 1 ? raceCosts.tier1 : raceCosts.tier2;
    if (player.gold < cost.gold || player.wood < cost.wood || player.stone < cost.stone) continue;
    const choice = botPickUpgrade(b, profile, race);
    emit({ type: 'purchase_upgrade', playerId, buildingId: b.id, choice });
    return;
  }
}

function botPickUpgrade(
  building: GameState['buildings'][0], profile: RaceProfile, race: Race,
): string {
  const deviate = Math.random() < 0.1;
  if (building.upgradePath.length === 1) {
    let bias: 'B' | 'C';
    switch (building.type) {
      case BuildingType.MeleeSpawner:  bias = profile.meleeUpgradeBias; break;
      case BuildingType.RangedSpawner: bias = profile.rangedUpgradeBias; break;
      case BuildingType.CasterSpawner: bias = profile.casterUpgradeBias; break;
      case BuildingType.Tower:         bias = profile.towerUpgradeBias; break;
      default: bias = 'B';
    }
    if (deviate) bias = bias === 'B' ? 'C' : 'B';
    return bias;
  }
  if (building.upgradePath[1] === 'B') {
    const preferOffense = race === Race.Surge || race === Race.Ember || race === Race.Shade;
    let choice = preferOffense ? 'E' : 'D';
    if (deviate) choice = choice === 'D' ? 'E' : 'D';
    return choice;
  } else {
    const preferUtility = race === Race.Surge || race === Race.Tide || race === Race.Thorn;
    let choice = preferUtility ? 'F' : 'G';
    if (deviate) choice = choice === 'F' ? 'G' : 'F';
    return choice;
  }
}

// ==================== LANE PRESSURE ====================

function botEvaluateLanes(
  state: GameState, playerId: number, myTeam: Team,
  myBuildings: GameState['buildings'], emit: Emit,
): void {
  const laneInterval = 200 + playerId * 30;
  if (state.tick % laneInterval !== 0) return;

  let myLeftStr = 1, myRightStr = 1, enemyLeftStr = 1, enemyRightStr = 1;
  for (const u of state.units) {
    const s = unitStrength(u);
    if (u.team === myTeam) {
      if (u.lane === Lane.Left) myLeftStr += s; else myRightStr += s;
    } else {
      if (u.lane === Lane.Left) enemyLeftStr += s; else enemyRightStr += s;
    }
  }

  const leftPressure = enemyLeftStr / myLeftStr;
  const rightPressure = enemyRightStr / myRightStr;

  const teammateId = playerId < 2 ? (playerId === 0 ? 1 : 0) : (playerId === 2 ? 3 : 2);
  const teammateSpawners = state.buildings.filter(b =>
    b.playerId === teammateId &&
    b.type !== BuildingType.Tower && b.type !== BuildingType.HarvesterHut
  );
  const teammateLane = teammateSpawners.length > 0 ? teammateSpawners[0].lane : null;

  let targetLane: Lane | null = null;
  if (leftPressure > 2.0 && leftPressure > rightPressure * 1.3) {
    targetLane = Lane.Left;
  } else if (rightPressure > 2.0 && rightPressure > leftPressure * 1.3) {
    targetLane = Lane.Right;
  } else if (Math.abs(leftPressure - rightPressure) < 0.3) {
    if (teammateLane === Lane.Left) targetLane = Lane.Right;
    else if (teammateLane === Lane.Right) targetLane = Lane.Left;
  } else if (leftPressure > rightPressure + 0.3) {
    targetLane = Lane.Left;
  } else if (rightPressure > leftPressure + 0.3) {
    targetLane = Lane.Right;
  }

  if (targetLane !== null) {
    const spawners = myBuildings.filter(b =>
      b.type === BuildingType.MeleeSpawner ||
      b.type === BuildingType.RangedSpawner ||
      b.type === BuildingType.CasterSpawner
    );
    if (spawners.length > 0 && spawners[0].lane !== targetLane) {
      emit({ type: 'toggle_all_lanes', playerId, lane: targetLane });
    }
  }
}

// ==================== HARVESTER MANAGEMENT ====================

function botManageHarvesters(
  state: GameState, playerId: number, player: GameState['players'][0],
  gameMinutes: number, emit: Emit,
): void {
  const myHarvesters = state.harvesters.filter(h => h.playerId === playerId);
  if (myHarvesters.length === 0) return;

  const diamondExposed = state.diamond.exposed;
  const goldCellsRemaining = state.diamondCells.filter(c => c.gold > 0).length;
  const goldMostlyMined = goldCellsRemaining < state.diamondCells.length * 0.3;

  const race = player.race;
  let primaryRes: HarvesterAssignment;
  let secondaryRes: HarvesterAssignment;
  switch (race) {
    case Race.Surge:   primaryRes = HarvesterAssignment.BaseGold; secondaryRes = HarvesterAssignment.Stone; break;
    case Race.Shade:   primaryRes = HarvesterAssignment.BaseGold; secondaryRes = HarvesterAssignment.Wood; break;
    case Race.Tide:    primaryRes = HarvesterAssignment.Wood;     secondaryRes = HarvesterAssignment.BaseGold; break;
    case Race.Bastion: primaryRes = HarvesterAssignment.Stone;    secondaryRes = HarvesterAssignment.BaseGold; break;
    case Race.Thorn:   primaryRes = HarvesterAssignment.Wood;     secondaryRes = HarvesterAssignment.Stone; break;
    case Race.Ember:   primaryRes = HarvesterAssignment.Stone;    secondaryRes = HarvesterAssignment.Wood; break;
    default:           primaryRes = HarvesterAssignment.BaseGold; secondaryRes = HarvesterAssignment.Wood; break;
  }
  const primaryWeight = (race === Race.Surge) ? 3 : 2;

  const resForAssignment = (a: HarvesterAssignment): number => {
    if (a === HarvesterAssignment.BaseGold || a === HarvesterAssignment.Center) return player.gold;
    if (a === HarvesterAssignment.Wood) return player.wood;
    return player.stone;
  };

  const primaryStarved = resForAssignment(primaryRes) < 20 && resForAssignment(secondaryRes) > 80;
  const secondaryStarved = resForAssignment(secondaryRes) < 20 && resForAssignment(primaryRes) > 80;

  for (let i = 0; i < myHarvesters.length; i++) {
    const h = myHarvesters[i];
    let desired: HarvesterAssignment;

    if (i < primaryWeight) {
      desired = primaryStarved ? secondaryRes : primaryRes;
    } else if (i < 3) {
      desired = secondaryStarved ? primaryRes : secondaryRes;
    } else if (i === 3) {
      if (gameMinutes > 3) {
        desired = HarvesterAssignment.Center;
      } else {
        desired = resForAssignment(primaryRes) <= resForAssignment(secondaryRes) ? primaryRes : secondaryRes;
      }
    } else {
      if (diamondExposed || gameMinutes > 5) {
        desired = HarvesterAssignment.Center;
      } else if (goldMostlyMined) {
        desired = i % 2 === 0 ? primaryRes : secondaryRes;
      } else {
        desired = HarvesterAssignment.Center;
      }
    }

    if (h.assignment !== desired) {
      const hut = state.buildings.find(b => b.id === h.hutId);
      if (hut) {
        emit({ type: 'set_hut_assignment', playerId, hutId: hut.id, assignment: desired });
      }
    }
  }
}

// ==================== NUKE ====================

function botFireNuke(state: GameState, playerId: number, myTeam: Team, myHqHp: number, emit: Emit): void {
  const enemyTeam = botEnemyTeam(playerId);
  const minY = myTeam === Team.Bottom ? 35 : 0;
  const maxY = myTeam === Team.Bottom ? 120 : 85;
  const enemyUnits = state.units.filter(
    u => u.team === enemyTeam && u.y >= minY && u.y <= maxY
  );
  if (enemyUnits.length < 3) return;

  const hqX = 40;
  const hqY = myTeam === Team.Bottom ? 105 : 12;
  const hqInDanger = myHqHp < HQ_HP * 0.5;

  const nearHqEnemies = enemyUnits.filter(u => {
    const dx = u.x - hqX;
    const dy = u.y - hqY;
    return dx * dx + dy * dy < 25 * 25;
  });

  if (hqInDanger && nearHqEnemies.length >= 3) {
    const target = findBestNukeTarget(nearHqEnemies);
    if (target) { emit({ type: 'fire_nuke', playerId, x: target.x, y: target.y }); return; }
  }

  if (enemyUnits.length >= 5) {
    const target = findBestNukeTarget(enemyUnits);
    if (target) { emit({ type: 'fire_nuke', playerId, x: target.x, y: target.y }); }
  }
}

function findBestNukeTarget(units: GameState['units']): { x: number; y: number } | null {
  if (units.length < 3) return null;
  const radius = 16;
  const radiusSq = radius * radius;
  let bestScore = -Infinity;
  let bestCount = 0;
  let bestX = units[0].x;
  let bestY = units[0].y;

  for (const anchor of units) {
    let count = 0;
    let weightedDist = 0;
    let sumX = 0;
    let sumY = 0;
    for (const u of units) {
      const dx = u.x - anchor.x;
      const dy = u.y - anchor.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > radiusSq) continue;
      count++;
      weightedDist += Math.sqrt(d2);
      sumX += u.x;
      sumY += u.y;
    }
    if (count === 0) continue;
    const score = count * 100 - weightedDist;
    if (score > bestScore) {
      bestScore = score;
      bestCount = count;
      bestX = sumX / count;
      bestY = sumY / count;
    }
  }
  if (bestCount < 3) return null;
  return { x: bestX, y: bestY };
}

// ==================== QUICK CHAT ====================

function botQuickChat(
  state: GameState, ctx: BotContext, playerId: number,
  myHqHp: number, _enemyHqHp: number, gameMinutes: number, emit: Emit,
): void {
  const lastChat = ctx.lastChatTick[playerId] ?? 0;
  if (state.tick - lastChat < 600) return;
  if (Math.random() > 0.2) return;

  let message: string | null = null;
  if (myHqHp < HQ_HP * 0.5) {
    message = 'Defend';
  } else if (state.diamond.exposed && state.diamond.state === 'exposed' && gameMinutes > 3) {
    message = 'Get Diamond';
  } else if (Math.random() < 0.3) {
    const mySpawners = state.buildings.filter(b =>
      b.playerId === playerId &&
      b.type !== BuildingType.Tower &&
      b.type !== BuildingType.HarvesterHut
    );
    if (mySpawners.length > 0) {
      const lane = mySpawners[0].lane;
      message = lane === Lane.Left ? 'Attack Left' : 'Attack Right';
    }
  }

  if (message) {
    emit({ type: 'quick_chat', playerId, message });
    ctx.lastChatTick[playerId] = state.tick;
  }
}
