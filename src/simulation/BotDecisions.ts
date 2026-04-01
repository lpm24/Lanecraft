/**
 * BotDecisions.ts — Bot action execution: building, upgrading, lane management, nukes, abilities, research.
 *
 * Contains all the functions that emit GameCommands: build order logic (profile-based and
 * value-based), building placement, tower placement, upgrade execution, lane evaluation,
 * harvester management, nuke targeting and firing, quick chat, ability usage, and research.
 *
 * Part of the simulation layer — must remain fully deterministic.
 */

import {
  GameState, Race, BuildingType, Lane, Team,
  HarvesterAssignment, HQ_HP, HQ_WIDTH, HQ_HEIGHT, MapDef,
  TICK_RATE, NUKE_RADIUS, AbilityTargetMode,
} from './types';
import {
  RACE_BUILDING_COSTS, UPGRADE_TREES, SPAWN_INTERVAL_TICKS,
  TOWER_STATS, getNodeUpgradeCost, HUT_COST_SCALE, TOWER_COST_SCALE,
  GOLD_YIELD_PER_TRIP, WOOD_YIELD_PER_TRIP, MEAT_YIELD_PER_TRIP,
  RACE_ABILITY_DEFS, getAllResearchUpgrades, getResearchUpgradeCost,
} from './data';
import { getHQPosition, getTeamAlleyOrigin, getBaseGoldPosition } from './GameState';
import {
  BotContext, BotDifficulty, RaceProfile,
  Emit,
} from './BotProfiles';
import {
  assessThreatProfile, botTeam, botEnemyTeam, botCanAfford, botCanAffordTower,
  botCanAffordHut, unitStrength, getTeammateIds, totalResources,
  resourceBundleTotal, buildingCategory,
  SWARM_RACES, TANK_RACES, GLASS_CANNON_RACES, enemyHasArchetype,
} from './BotIntelligence';
import {
  scoreUpgradeNode, getSpawnerThroughput, detectPowerSpike, timeToAfford,
  estimateSpawnerValue, estimateUpgradeValue, estimateResearchValue,
  estimateHutPaybackSeconds, shouldBuildHutNow,
  botPickUpgrade,
} from './BotValuation';

// ==================== NUKE ====================

export interface NukeStrikePlan {
  x: number;
  y: number;
  score: number;
  victims: number;
  nearHqVictims: number;
  upgradedVictims: number;
  reason: 'diamond' | 'defense' | 'cluster';
}

export function isLegalNukeTarget(myTeam: Team, mapDef: MapDef, x: number, y: number): boolean {
  const zone = mapDef.nukeZone[myTeam];
  const axis = mapDef.shapeAxis === 'x' ? x : y;
  return axis >= zone.min && axis <= zone.max;
}

export function evaluateBestNukePlan(
  state: GameState, playerId: number, myTeam: Team, myHqHp: number,
): NukeStrikePlan | null {
  const enemyTeam = botEnemyTeam(playerId, state);
  const legalEnemyUnits = state.units.filter(u => u.team === enemyTeam && isLegalNukeTarget(myTeam, state.mapDef, u.x, u.y));
  const legalEnemyHarvesters = state.harvesters.filter(h => h.team === enemyTeam && h.state !== 'dead' && isLegalNukeTarget(myTeam, state.mapDef, h.x, h.y));

  const carrier = legalEnemyUnits.find(u => u.carryingDiamond);
  if (carrier) return { x: carrier.x, y: carrier.y, score: 999, victims: 1, nearHqVictims: 0, upgradedVictims: 1, reason: 'diamond' };
  const harvCarrier = legalEnemyHarvesters.find(h => h.carryingDiamond);
  if (harvCarrier) return { x: harvCarrier.x, y: harvCarrier.y, score: 999, victims: 1, nearHqVictims: 0, upgradedVictims: 0, reason: 'diamond' };

  const targets: Array<{ x: number; y: number; score: number; nearHq: boolean; upgraded: boolean }> = [];
  const hq = getHQPosition(myTeam, state.mapDef);
  const hqX = hq.x + HQ_WIDTH / 2;
  const hqY = hq.y + HQ_HEIGHT / 2;

  for (const u of legalEnemyUnits) {
    const nearHq = (u.x - hqX) ** 2 + (u.y - hqY) ** 2 <= 24 * 24;
    const power = (u.damage / Math.max(0.5, u.attackSpeed)) * (u.hp / Math.max(1, u.maxHp));
    let score = 1.8 + Math.min(4.5, power / 3.5);
    if (u.category === 'caster') score += 1.2;
    if (u.upgradeTier > 0) score += 1 + u.upgradeTier * 1.2;
    if (nearHq) score += 2.5;
    if (state.diamond.exposed && Math.abs(u.x - state.diamond.x) <= 10 && Math.abs(u.y - state.diamond.y) <= 10) score += 1;
    targets.push({ x: u.x, y: u.y, score, nearHq, upgraded: u.upgradeTier > 0 });
  }
  for (const h of legalEnemyHarvesters) {
    const nearHq = (h.x - hqX) ** 2 + (h.y - hqY) ** 2 <= 24 * 24;
    let score = h.assignment === HarvesterAssignment.Center ? 1.5 : 0.8;
    if (nearHq) score += 1.5;
    targets.push({ x: h.x, y: h.y, score, nearHq, upgraded: false });
  }

  if (targets.length < 3) return null;

  const radius = NUKE_RADIUS;
  const radiusSq = radius * radius;
  let best: NukeStrikePlan | null = null;

  for (const anchor of targets) {
    let totalScore = 0;
    let victims = 0;
    let nearHqVictims = 0;
    let upgradedVictims = 0;
    let sumX = 0;
    let sumY = 0;

    for (const target of targets) {
      const d2 = (target.x - anchor.x) ** 2 + (target.y - anchor.y) ** 2;
      if (d2 > radiusSq) continue;
      totalScore += target.score;
      victims++;
      sumX += target.x;
      sumY += target.y;
      if (target.nearHq) nearHqVictims++;
      if (target.upgraded) upgradedVictims++;
    }

    if (victims < 3) continue;
    const defensive = myHqHp < HQ_HP * 0.6 && nearHqVictims >= 2 && totalScore >= 8;
    const eliteCluster = upgradedVictims >= 2 && totalScore >= 10;
    const hugeCluster = victims >= 5 && totalScore >= 11.5;
    if (!defensive && !eliteCluster && !hugeCluster) continue;

    const plan: NukeStrikePlan = {
      x: sumX / victims,
      y: sumY / victims,
      score: totalScore,
      victims,
      nearHqVictims,
      upgradedVictims,
      reason: defensive ? 'defense' : 'cluster',
    };
    if (!best || plan.score > best.score) best = plan;
  }

  return best;
}

// ==================== BUILD ORDER ====================

/** Try to build any of the given types that are affordable */
export function botBuildAffordable(
  state: GameState, playerId: number, types: BuildingType[],
  myBuildings: GameState['buildings'], emit: Emit,
): boolean {
  for (const t of types) {
    if (botCanAfford(state, playerId, t)) {
      botPlaceBuilding(state, playerId, t, myBuildings, emit);
      return true;
    }
  }
  return false;
}

// ==================== VALUE-BASED BUILD (Oracle) ====================

/**
 * Value function: computes the expected "power per resource" of each possible action.
 * The oracle bot always picks the highest-value action it can afford.
 *
 * Actions considered:
 * 1. Build a new spawner → adds DPS/HP stream over time
 * 2. Upgrade an existing building → multiplies existing stream
 * 3. Build a hut → adds economic throughput
 * 4. Build a tower → adds defensive DPS
 */
export function botValueBasedBuild(
  state: GameState, ctx: BotContext, playerId: number, profile: RaceProfile,
  myBuildings: GameState['buildings'],
  meleeCount: number, rangedCount: number, casterCount: number,
  towerCount: number, alleyTowerCount: number, hutCount: number,
  gameMinutes: number, enemyRaces: Race[], diff: BotDifficulty, emit: Emit,
): boolean {
  const player = state.players[playerId];
  const race = player.race;
  const costs = RACE_BUILDING_COSTS[race];
  const intel = ctx.intelligence[playerId];
  const plan = intel?.resourcePlan ?? null;

  // Score all options — including unaffordable ones for goal-oriented saving
  interface BuildOption {
    action: 'spawner' | 'upgrade' | 'hut' | 'tower' | 'alley_tower' | 'research';
    value: number;
    affordable: boolean;
    waitSecs: number;  // seconds to afford (0 if affordable now)
    resourceTypes: number; // how many distinct resource types this costs (1, 2, or 3)
    cost: { gold: number; wood: number; meat: number; souls?: number; deathEssence?: number };
    type?: BuildingType;
    building?: GameState['buildings'][0];
    upgradeChoice?: string;
    researchId?: string;
  }

  const options: BuildOption[] = [];

  // --- Spawner options (both affordable and unaffordable) ---
  const spawnerTypes = [BuildingType.MeleeSpawner, BuildingType.RangedSpawner, BuildingType.CasterSpawner];
  const shift = (diff.useDynamicShift && intel?.buildShift) ? intel.buildShift : { melee: 0, ranged: 0, caster: 0 };

  // Profile-based target for current game phase (used to steer value function)
  const profileTarget = (type: BuildingType): number => {
    if (gameMinutes < 1.5) {
      if (type === BuildingType.MeleeSpawner) return profile.earlyMelee;
      if (type === BuildingType.RangedSpawner) return profile.earlyRanged;
      return 0;
    } else if (gameMinutes < 5) {
      if (type === BuildingType.MeleeSpawner) return profile.midMelee;
      if (type === BuildingType.RangedSpawner) return profile.midRanged;
      return profile.midCasters;
    } else {
      if (type === BuildingType.MeleeSpawner) return profile.midMelee + 1;
      if (type === BuildingType.RangedSpawner) return profile.midRanged + 1;
      return profile.midCasters + 1;
    }
  };

  for (const type of spawnerTypes) {
    const sv = estimateSpawnerValue(state, ctx, playerId, type);
    const cat = type === BuildingType.MeleeSpawner ? 'melee' : type === BuildingType.RangedSpawner ? 'ranged' : 'caster';
    const shiftBonus = Math.max(0, shift[cat]) * 0.02;

    // Profile steering: strongly boost value if below target, penalize if above
    const currentCount = type === BuildingType.MeleeSpawner ? meleeCount
      : type === BuildingType.RangedSpawner ? rangedCount : casterCount;
    const target = profileTarget(type);
    let profileMult = 1.0;
    if (currentCount < target) {
      profileMult = 1.5 + (target - currentCount) * 0.2;
      if (currentCount === 0) profileMult *= 1.5; // first of this type is extra valuable
    } else if (target === 0 && currentCount > 0) {
      profileMult = 0.3; // profile says skip
    } else if (currentCount > target) {
      profileMult = 0.6 / Math.max(1, currentCount - target + 1); // diminishing returns
    }

    // Even if profile says 0 casters, build at least 1 after army is established
    if (currentCount === 0 && type === BuildingType.CasterSpawner && target === 0 && meleeCount + rangedCount >= 3 && gameMinutes > 1.5) {
      profileMult = 2.5;
    }

    const cost = costs[type];
    const canAfford = botCanAfford(state, playerId, type);
    const wait = canAfford ? 0 : timeToAfford(player, cost, plan);
    const spRT = (cost.gold > 0 ? 1 : 0) + (cost.wood > 0 ? 1 : 0) + (cost.meat > 0 ? 1 : 0);
    options.push({ action: 'spawner', value: (sv + shiftBonus) * profileMult, affordable: canAfford, waitSecs: wait, resourceTypes: spRT, cost, type });
  }

  // --- Upgrade options (both affordable and unaffordable) ---
  const spawnerCount = meleeCount + rangedCount + casterCount;
  if (spawnerCount >= diff.upgradeThreshold) {
    const upgradeable = myBuildings
      .filter(b => b.type !== BuildingType.HarvesterHut && b.upgradePath.length > 0 && b.upgradePath.length < 3);
    for (const b of upgradeable) {
      const choice = botPickUpgrade(state, ctx, b, profile, race, enemyRaces, diff);
      const tier = getNodeUpgradeCost(race, b.type, b.upgradePath.length, choice);
      const canAfford = player.gold >= tier.gold && player.wood >= tier.wood && player.meat >= tier.meat
        && ((tier.deathEssence ?? 0) <= 0 || player.deathEssence >= (tier.deathEssence ?? 0))
        && ((tier.souls ?? 0) <= 0 || player.souls >= (tier.souls ?? 0));

      // Compute value even if can't afford (for save-for comparison)
      let uv: number;
      if (diff.useValueFunction && b.type !== BuildingType.Tower) {
        const totalCost = resourceBundleTotal(tier);
        if (totalCost <= 0) continue;
        const currentTP = getSpawnerThroughput(race, b.type, b.upgradePath);
        const newPath = [...b.upgradePath, choice];
        const newTP = getSpawnerThroughput(race, b.type, newPath);
        const throughputDelta = newTP - currentTP;
        const threats = intel?.threats ?? assessThreatProfile(enemyRaces);
        const spikeBonus = detectPowerSpike(race, b.type, choice, threats);
        const matchupBonus = scoreUpgradeNode(race, b.type, choice, threats) / 40;

        // Volume bonus: more buildings of this type = upgrade benefits more production
        const sameTypeCount = b.type === BuildingType.MeleeSpawner ? meleeCount
          : b.type === BuildingType.RangedSpawner ? rangedCount
          : b.type === BuildingType.CasterSpawner ? casterCount : 1;
        const volumeBonus = Math.max(1, sameTypeCount * 0.6);

        uv = (throughputDelta * (1 + spikeBonus + matchupBonus) * volumeBonus) / totalCost;

        // Siege penalty: avoid siege upgrades until late game
        const nodeDef2 = UPGRADE_TREES[race]?.[b.type]?.[choice as 'B'|'C'|'D'|'E'|'F'|'G'];
        if (nodeDef2?.special?.isSiegeUnit) {
          const gameMin2 = state.tick / TICK_RATE / 60;
          if (gameMin2 < 8) uv *= 0.1;
          else uv *= 0.4;
        }

        // Boost for effective category
        const cat = buildingCategory(b.type);
        if (intel && cat) {
          if (intel.effectiveCategory === cat) uv *= 1.18;
          if (intel.armyAdvantage < 0.75 && intel.weakCategory === cat) uv *= 0.88;
        }
      } else {
        const fullUv = estimateUpgradeValue(state, ctx, playerId, b, profile, enemyRaces, diff);
        uv = fullUv.value;
      }

      if (uv > 0) {
        const wait = canAfford ? 0 : timeToAfford(player, tier, plan);
        const upRT = (tier.gold > 0 ? 1 : 0) + (tier.wood > 0 ? 1 : 0) + (tier.meat > 0 ? 1 : 0);
        options.push({
          action: 'upgrade', value: uv, affordable: canAfford, waitSecs: wait, resourceTypes: upRT,
          cost: { gold: tier.gold, wood: tier.wood, meat: tier.meat, deathEssence: tier.deathEssence, souls: tier.souls },
          building: b, upgradeChoice: choice,
        });
      }
    }
  }

  // --- Hut option ---
  const hutCap = diff.useValueFunction ? diff.maxHuts : profile.maxHuts;
  if (hutCount < hutCap) {
    const shouldBuild = shouldBuildHutNow(state, ctx, playerId, profile, hutCount, gameMinutes);
    if (shouldBuild) {
      const payback = estimateHutPaybackSeconds(state, ctx, playerId, hutCount);
      // Convert hut value to comparable throughput units:
      // hut enables (income * timeHorizon / avgSpawnerCost) additional spawners worth of throughput
      const timeHorizon = Math.max(60, 300 - gameMinutes * 30);
      const avgSpawnerCost = spawnerTypes.reduce((sum, t) => sum + resourceBundleTotal(costs[t]), 0) / 3;
      const avgThroughput = spawnerTypes.reduce((sum, t) => sum + getSpawnerThroughput(race, t), 0) / 3;
      const additionalIncome = (GOLD_YIELD_PER_TRIP + WOOD_YIELD_PER_TRIP + MEAT_YIELD_PER_TRIP) / 3 / 8.5;
      const enabledThroughput = avgSpawnerCost > 0
        ? (additionalIncome * timeHorizon / avgSpawnerCost) * avgThroughput
        : 0;
      const hutBase = costs[BuildingType.HarvesterHut];
      const mult = Math.pow(HUT_COST_SCALE, Math.max(0, hutCount - 1));
      const hutTotalCost = Math.floor(hutBase.gold * mult) + Math.floor(hutBase.wood * mult) + Math.floor(hutBase.meat * mult);
      let hv = hutTotalCost > 0 ? enabledThroughput / hutTotalCost : 0;
      // Early game: first 2-3 huts are critical for economy
      if (hutCount < 2 && gameMinutes < 2) hv *= 1.8;
      else if (hutCount < 3 && gameMinutes < 3) hv *= 1.3;
      // Scale down if payback is long
      if (payback > 60) hv *= 60 / payback;
      // Pressure bonus when resource-starved
      const pressureBonus = plan
        ? Math.min(0.15, Math.max(0, Math.max(
          plan.goldSecsToTarget, plan.woodSecsToTarget, plan.meatSecsToTarget,
        ) - 15) * 0.005)
        : 0;
      hv += pressureBonus;
      if (hv > 0) {
        const canAffordHut = botCanAffordHut(state, playerId, hutCount);
        const hutBase2 = costs[BuildingType.HarvesterHut];
        const hutRT = (hutBase2.gold > 0 ? 1 : 0) + (hutBase2.wood > 0 ? 1 : 0) + (hutBase2.meat > 0 ? 1 : 0);
        const hutCostActual = { gold: Math.floor(hutBase2.gold * mult), wood: Math.floor(hutBase2.wood * mult), meat: Math.floor(hutBase2.meat * mult) };
        options.push({ action: 'hut', value: hv, affordable: canAffordHut, waitSecs: 0, resourceTypes: hutRT, cost: hutCostActual });
      }
    }
  }

  // --- Tower options (hard cap at profile target or 6, whichever is lower) ---
  const totalTowers = towerCount + alleyTowerCount;
  const towerCap = Math.min(profile.lateTowers + profile.alleyTowers, 6);
  if (totalTowers < towerCap) {
    const ts = TOWER_STATS[race];
    const towerBaseCost = costs[BuildingType.Tower];
    const towerMult = totalTowers > 0 ? Math.pow(TOWER_COST_SCALE, Math.max(0, totalTowers - 1)) : 1;
    const towerCost = { gold: Math.floor(towerBaseCost.gold * towerMult), wood: Math.floor(towerBaseCost.wood * towerMult), meat: Math.floor(towerBaseCost.meat * towerMult) };
    const totalCostT = towerCost.gold + towerCost.wood + towerCost.meat;
    const towerDPS = ts.damage / ts.attackSpeed;
    let towerVal = totalCostT > 0 ? (towerDPS + ts.hp * 0.005) / totalCostT * 0.5 : 0; // towers are low priority
    // Towers more valuable when losing
    const armyAdv = intel?.armyAdvantage ?? 1;
    if (armyAdv < 0.7) towerVal *= 1.4;
    else if (armyAdv < 0.9) towerVal *= 1.1;
    // First tower is free — good value
    if (totalTowers === 0) towerVal *= 5;
    const canAffordTower = botCanAffordTower(state, playerId, totalTowers);
    if (alleyTowerCount < profile.alleyTowers) {
      const twRT = (towerCost.gold > 0 ? 1 : 0) + (towerCost.wood > 0 ? 1 : 0) + (towerCost.meat > 0 ? 1 : 0);
      options.push({ action: 'alley_tower', value: towerVal, affordable: canAffordTower, waitSecs: 0, resourceTypes: twRT, cost: towerCost });
    } else if (towerCount < profile.lateTowers) {
      const twRT2 = (towerCost.gold > 0 ? 1 : 0) + (towerCost.wood > 0 ? 1 : 0) + (towerCost.meat > 0 ? 1 : 0);
      options.push({ action: 'tower', value: towerVal, affordable: canAffordTower, waitSecs: 0, resourceTypes: twRT2, cost: towerCost, type: BuildingType.Tower });
    }
  }

  // --- Research upgrades (Nightmare: integrated into value function) ---
  if (intel) {
    const bu = player.researchUpgrades;
    const allResearch = getAllResearchUpgrades(race);
    for (const rDef of allResearch) {
      if (rDef.oneShot && bu.raceUpgrades[rDef.id]) continue;

      let rLevel = 0;
      if (rDef.id === 'melee_atk') rLevel = bu.meleeAtkLevel;
      else if (rDef.id === 'melee_def') rLevel = bu.meleeDefLevel;
      else if (rDef.id === 'ranged_atk') rLevel = bu.rangedAtkLevel;
      else if (rDef.id === 'ranged_def') rLevel = bu.rangedDefLevel;
      else if (rDef.id === 'caster_atk') rLevel = bu.casterAtkLevel;
      else if (rDef.id === 'caster_def') rLevel = bu.casterDefLevel;

      const rCost = getResearchUpgradeCost(rDef.id, rLevel, race);
      const rTotalCost = rCost.gold + rCost.wood + rCost.meat + (rCost.souls ?? 0);
      if (rTotalCost <= 0) continue;

      const canAffordR = player.gold >= rCost.gold && player.wood >= rCost.wood && player.meat >= rCost.meat
        && ((rCost.souls ?? 0) <= 0 || player.souls >= (rCost.souls ?? 0));
      const rv = estimateResearchValue(state, ctx, playerId, rDef.id, race, bu, intel, myBuildings);
      if (rv > 0) {
        const waitR = canAffordR ? 0 : timeToAfford(player, rCost, plan);
        const rRT = (rCost.gold > 0 ? 1 : 0) + (rCost.wood > 0 ? 1 : 0) + (rCost.meat > 0 ? 1 : 0) + ((rCost.souls ?? 0) > 0 ? 1 : 0);
        options.push({
          action: 'research', value: rv, affordable: canAffordR, waitSecs: waitR, resourceTypes: rRT,
          cost: { gold: rCost.gold, wood: rCost.wood, meat: rCost.meat, souls: rCost.souls, deathEssence: rCost.deathEssence },
          researchId: rDef.id,
        });
      }
    }
  }

  if (options.length === 0) return false;

  // --- Pick best affordable option, with save-for logic ---
  const cmpStr = (x: string, y: string) => x < y ? -1 : x > y ? 1 : 0;
  const optionSort = (a: BuildOption, b: BuildOption) =>
    b.value - a.value
    || cmpStr(a.action, b.action)
    || cmpStr(a.type ?? '', b.type ?? '')
    || (a.building?.id ?? 0) - (b.building?.id ?? 0)
    || cmpStr(a.researchId ?? '', b.researchId ?? '');

  const affordableOptions = options.filter(o => o.affordable);
  const unaffordableOptions = options.filter(o => !o.affordable && o.waitSecs < 20 && o.waitSecs > 0);
  affordableOptions.sort(optionSort);
  unaffordableOptions.sort(optionSort);

  const bestAffordable = affordableOptions[0];
  const bestUnaffordable = unaffordableOptions[0];

  // Save-for logic: skip buying cheap now to afford something better soon
  if (bestUnaffordable && bestAffordable && bestUnaffordable.resourceTypes <= 1) {
    const valueRatio = bestUnaffordable.value / Math.max(0.001, bestAffordable.value);
    if (valueRatio > 1.8 && bestUnaffordable.waitSecs <= 6) return false;
    if (bestUnaffordable.action === 'upgrade' && valueRatio > 1.5 && bestUnaffordable.waitSecs <= 4) return false;
  }

  if (!bestAffordable) return false;

  // Mistake: occasionally pick 2nd or 3rd best
  // Always consume 2 RNG values to keep sequence stable
  let pick = bestAffordable;
  { const roll = state.rng(), idx = state.rng();
    if (diff.mistakeRate > 0 && affordableOptions.length > 1 && roll < diff.mistakeRate) {
      pick = affordableOptions[Math.min(1 + Math.floor(idx * 2), affordableOptions.length - 1)];
    }
  }

  switch (pick.action) {
    case 'spawner':
      botPlaceBuilding(state, playerId, pick.type!, myBuildings, emit);
      return true;
    case 'upgrade':
      emit({ type: 'purchase_upgrade', playerId, buildingId: pick.building!.id, choice: pick.upgradeChoice! });
      return true;
    case 'hut':
      emit({ type: 'build_hut', playerId });
      return true;
    case 'research':
      emit({ type: 'research_upgrade', playerId, upgradeId: pick.researchId! });
      return true;
    case 'tower':
    case 'alley_tower':
      return botPlaceAlleyTower(state, playerId, emit);
  }
  return false;
}



// ==================== PROFILE-BASED BUILD ORDER ====================

export function botDoBuildOrder(
  state: GameState, ctx: BotContext, playerId: number, profile: RaceProfile,
  myBuildings: GameState['buildings'],
  meleeCount: number, rangedCount: number, casterCount: number,
  towerCount: number, alleyTowerCount: number, hutCount: number,
  gameMinutes: number, enemyRaces: Race[], diff: BotDifficulty, emit: Emit,
): boolean {
  const vsSwarm = diff.counterBuild && enemyHasArchetype(enemyRaces, SWARM_RACES);
  const vsTank = diff.counterBuild && enemyHasArchetype(enemyRaces, TANK_RACES);
  const vsGlass = diff.counterBuild && enemyHasArchetype(enemyRaces, GLASS_CANNON_RACES);

  // Intelligence-driven build adjustments (layered on top of profile + counter-build)
  const intel = ctx.intelligence[playerId];
  const shift = (diff.useDynamicShift && intel?.buildShift) ? intel.buildShift : { melee: 0, ranged: 0, caster: 0 };

  const extraCasters = (vsSwarm ? profile.vsSwarmExtraCasters : 0) + Math.max(0, shift.caster);
  const extraRanged = (vsTank ? profile.vsTankExtraRanged : 0) + Math.max(0, shift.ranged);
  const extraMelee = (vsGlass ? profile.vsGlassCannonExtraMelee : 0) + Math.max(0, shift.melee);

  // Resource-aware: try multiple options, pick the one we can actually afford
  const totalSpawnersAll = meleeCount + rangedCount + casterCount;
  const atSpawnerCap = totalSpawnersAll >= diff.maxSpawners;
  const atHutCap = hutCount >= diff.maxHuts;

  const tryBuild = (type: BuildingType): boolean => {
    // Towers must go in the tower alley, not the military grid
    if (type === BuildingType.Tower) {
      if (botCanAffordTower(state, playerId, towerCount + alleyTowerCount)) return botPlaceAlleyTower(state, playerId, emit);
      return false;
    }
    // Enforce spawner cap for spawner types
    const isSpawner = type === BuildingType.MeleeSpawner || type === BuildingType.RangedSpawner || type === BuildingType.CasterSpawner;
    if (isSpawner && atSpawnerCap) return false;
    if (botCanAfford(state, playerId, type)) {
      botPlaceBuilding(state, playerId, type, myBuildings, emit);
      return true;
    }
    return false;
  };

  const tryHut = (): boolean => {
    if (atHutCap) return false;
    if (!shouldBuildHutNow(state, ctx, playerId, profile, hutCount, gameMinutes)) return false;
    emit({ type: 'build_hut', playerId });
    return true;
  };

  if (gameMinutes < 1.5) {
    // Early game: get spawners online fast, be flexible about order
    const totalSpawners = meleeCount + rangedCount + casterCount;
    if (meleeCount < profile.earlyMelee && tryBuild(BuildingType.MeleeSpawner)) return true;
    if (rangedCount < profile.earlyRanged && tryBuild(BuildingType.RangedSpawner)) return true;
    // Interleave huts with spawners for early economy
    if (hutCount < Math.min(profile.earlyHuts, 1 + totalSpawners) && tryHut()) return true;
    if (hutCount < profile.earlyHuts && tryHut()) return true;
    if (towerCount < profile.earlyTowers && tryBuild(BuildingType.Tower)) return true;
    // If we can't afford our preferred early build, try ANY spawner we can afford
    if (totalSpawners < 2) {
      if (tryBuild(BuildingType.RangedSpawner)) return true;
      if (tryBuild(BuildingType.CasterSpawner)) return true;
      if (tryBuild(BuildingType.MeleeSpawner)) return true;
    }
    // Resource-starved: can't afford any spawner — build a hut to accelerate income
    if (!atHutCap && hutCount < profile.maxHuts && botCanAffordHut(state, playerId, hutCount)) {
      emit({ type: 'build_hut', playerId });
      return true;
    }
    return false;
  }

  if (gameMinutes < 5) {
    const midMeleeTarget = profile.midMelee + extraMelee;
    const midRangedTarget = profile.midRanged + extraRanged;
    const midCasterTarget = profile.midCasters + extraCasters;

    // Build what we need AND can afford, trying priority order
    const needs: [BuildingType, number, number][] = [
      [BuildingType.MeleeSpawner, meleeCount, midMeleeTarget],
      [BuildingType.RangedSpawner, rangedCount, midRangedTarget],
      [BuildingType.CasterSpawner, casterCount, midCasterTarget],
    ];
    // Sort by deficit (most needed first)
    needs.sort((a, b) => (b[2] - b[1]) - (a[2] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const [type, count, target] of needs) {
      if (count < target && tryBuild(type)) return true;
    }
    // If we can't afford the preferred type, try any spawner we can afford
    if (!atSpawnerCap) {
      for (const [type, ,] of needs) {
        if (tryBuild(type)) return true;
      }
    }

    if (hutCount < profile.midHuts && hutCount < profile.maxHuts && tryHut()) return true;
    if (towerCount < profile.midTowers && tryBuild(BuildingType.Tower)) return true;
    if (alleyTowerCount < 1 && botCanAffordTower(state, playerId, towerCount + alleyTowerCount)) {
      if (botPlaceAlleyTower(state, playerId, emit)) return true;
    }
    // Keep building spawners beyond profile targets if we haven't hit our cap
    if (!atSpawnerCap) {
      const preferType = meleeCount <= rangedCount ? BuildingType.MeleeSpawner : BuildingType.RangedSpawner;
      if (tryBuild(preferType)) return true;
      const altType = preferType === BuildingType.MeleeSpawner ? BuildingType.RangedSpawner : BuildingType.MeleeSpawner;
      if (tryBuild(altType)) return true;
    }
    // Keep building huts beyond profile targets if we haven't hit our cap
    if (!atHutCap && tryHut()) return true;
    // Resource-starved: nothing else affordable — build a hut for economy
    if (!atHutCap && hutCount < diff.maxHuts && botCanAffordHut(state, playerId, hutCount)) {
      emit({ type: 'build_hut', playerId });
      return true;
    }
    return false;
  }

  // Late game — use intelligence to decide what to build
  const strategy = intel?.strategy ?? 'balanced';

  // Turtle strategy: prioritize towers
  if (strategy === 'turtle') {
    if (alleyTowerCount < profile.alleyTowers + 1 && botCanAffordTower(state, playerId, towerCount + alleyTowerCount)) {
      if (botPlaceAlleyTower(state, playerId, emit)) return true;
    }
    if (towerCount < profile.lateTowers + 1 && tryBuild(BuildingType.Tower)) return true;
  } else {
    if (alleyTowerCount < profile.alleyTowers && botCanAffordTower(state, playerId, towerCount + alleyTowerCount)) {
      if (botPlaceAlleyTower(state, playerId, emit)) return true;
    }
    if (towerCount < profile.lateTowers && tryBuild(BuildingType.Tower)) return true;
  }

  // Greed strategy: prioritize economy
  if (strategy === 'greed' && hutCount < profile.maxHuts && tryHut()) return true;
  if (hutCount < profile.maxHuts && tryHut()) return true;

  const totalMilitary = meleeCount + rangedCount + casterCount + towerCount;
  if (totalMilitary < state.mapDef.buildGridCols * state.mapDef.buildGridRows) {
    const lateCasterTarget = 2 + extraCasters;
    if (casterCount < lateCasterTarget && tryBuild(BuildingType.CasterSpawner)) return true;

    // Intelligence-driven: build more of what's effective
    const effective = intel?.effectiveCategory;
    let preferType: BuildingType;

    if (effective === 'melee' && meleeCount <= rangedCount + 2) {
      preferType = BuildingType.MeleeSpawner;
    } else if (effective === 'ranged' && rangedCount <= meleeCount + 2) {
      preferType = BuildingType.RangedSpawner;
    } else if (effective === 'caster') {
      preferType = BuildingType.CasterSpawner;
    } else if (vsTank && rangedCount <= meleeCount) {
      preferType = BuildingType.RangedSpawner;
    } else if (vsGlass && meleeCount <= rangedCount) {
      preferType = BuildingType.MeleeSpawner;
    } else {
      preferType = meleeCount <= rangedCount ? BuildingType.MeleeSpawner : BuildingType.RangedSpawner;
    }
    if (tryBuild(preferType)) return true;
    const altType = preferType === BuildingType.MeleeSpawner ? BuildingType.RangedSpawner : BuildingType.MeleeSpawner;
    if (tryBuild(altType)) return true;
    if (totalResources(state, playerId) > 50 && tryBuild(BuildingType.CasterSpawner)) return true;
  }

  // Very late: fill alley with towers
  if (gameMinutes > 7 && alleyTowerCount < state.mapDef.towerAlleyCols * state.mapDef.towerAlleyRows
      && botCanAffordTower(state, playerId, towerCount + alleyTowerCount)) {
    if (botPlaceAlleyTower(state, playerId, emit)) return true;
  }
  return false;
}

export function botPlaceBuilding(
  state: GameState, playerId: number, type: BuildingType,
  myBuildings: GameState['buildings'], emit: Emit,
): void {
  const occupied = new Set(
    myBuildings.filter(b => b.buildGrid === 'military').map(b => `${b.gridX},${b.gridY}`)
  );
  const freeSlots: { gx: number; gy: number }[] = [];
  for (let gy = 0; gy < state.mapDef.buildGridRows; gy++) {
    for (let gx = 0; gx < state.mapDef.buildGridCols; gx++) {
      if (!occupied.has(`${gx},${gy}`)) freeSlots.push({ gx, gy });
    }
  }
  if (freeSlots.length === 0) return;

  // Spawners: spread across grid for resilience
  const slot = freeSlots[Math.floor(state.rng() * freeSlots.length)];
  emit({ type: 'place_building', playerId, buildingType: type, gridX: slot.gx, gridY: slot.gy });
}

export function botPlaceAlleyTower(state: GameState, playerId: number, emit: Emit): boolean {
  const myTeam = botTeam(playerId, state);
  const teamAlleyBuildings = state.buildings.filter(
    b => b.buildGrid === 'alley' && botTeam(b.playerId, state) === myTeam
  );
  // Hard cap: max 6 towers per team regardless of profile
  if (teamAlleyBuildings.length >= 6) return false;
  const occupied = new Set(teamAlleyBuildings.map(b => `${b.gridX},${b.gridY}`));
  const freeSlots: { gx: number; gy: number }[] = [];
  // Compute gold mine exclusion zone for landscape maps
  let exGX = -999, exGY = -999;
  if (state.mapDef.shapeAxis === 'x') {
    const origin = getTeamAlleyOrigin(myTeam, state.mapDef);
    const goldPos = getBaseGoldPosition(myTeam, state.mapDef);
    exGX = Math.round(goldPos.x - origin.x);
    exGY = Math.round(goldPos.y - origin.y);
  }
  for (let gy = 0; gy < state.mapDef.towerAlleyRows; gy++) {
    for (let gx = 0; gx < state.mapDef.towerAlleyCols; gx++) {
      if (gx >= exGX - 3 && gx < exGX + 3 && gy >= exGY - 3 && gy < exGY + 3) continue;
      if (!occupied.has(`${gx},${gy}`)) freeSlots.push({ gx, gy });
    }
  }
  if (freeSlots.length === 0) return false;
  // Place near lane paths (center columns) for maximum coverage
  const centerX = Math.floor(state.mapDef.towerAlleyCols / 2);
  freeSlots.sort((a, b) => Math.abs(a.gx - centerX) - Math.abs(b.gx - centerX) || a.gy - b.gy || a.gx - b.gx);
  const idx = Math.min(Math.floor(state.rng() * 3), freeSlots.length - 1);
  const slot = freeSlots[idx];
  emit({ type: 'place_building', playerId, buildingType: BuildingType.Tower, gridX: slot.gx, gridY: slot.gy, gridType: 'alley' });
  return true;
}

// ==================== UPGRADES ====================

export function botUpgradeBuildings(
  state: GameState, ctx: BotContext, playerId: number, profile: RaceProfile,
  myBuildings: GameState['buildings'], enemyRaces: Race[],
  gameMinutes: number, diff: BotDifficulty, emit: Emit,
): boolean {
  const player = state.players[playerId];

  // Don't upgrade until we have enough spawners (controlled by difficulty)
  const spawnerCount = myBuildings.filter(b =>
    b.type === BuildingType.MeleeSpawner || b.type === BuildingType.RangedSpawner || b.type === BuildingType.CasterSpawner
  ).length;
  if (spawnerCount < diff.upgradeThreshold) return false;

  // Priority: spawners first, towers later; most-owned type first; lowest tier first
  const typeCounts: Record<string, number> = {};
  for (const b of myBuildings) typeCounts[b.type] = (typeCounts[b.type] ?? 0) + 1;

  const upgradeable = myBuildings
    .filter(b => b.type !== BuildingType.HarvesterHut && b.upgradePath.length < 3)
    .sort((a, b) => {
      // Nightmare: sort by throughput value (best bang for buck first)
      if (diff.useValueFunction && a.type !== BuildingType.Tower && b.type !== BuildingType.Tower) {
        const uvA = estimateUpgradeValue(state, ctx, playerId, a, profile, enemyRaces, diff);
        const uvB = estimateUpgradeValue(state, ctx, playerId, b, profile, enemyRaces, diff);
        if (Math.abs(uvA.value - uvB.value) > 0.001) return uvB.value - uvA.value;
      }
      const isSpawnerA = a.type !== BuildingType.Tower;
      const isSpawnerB = b.type !== BuildingType.Tower;
      if (gameMinutes < 6 && isSpawnerA !== isSpawnerB) return isSpawnerA ? -1 : 1;
      if (isSpawnerA && isSpawnerB && a.type !== b.type) {
        const countA = typeCounts[a.type] ?? 0;
        const countB = typeCounts[b.type] ?? 0;
        if (countA !== countB) return countB - countA;
      }
      if (a.upgradePath.length !== b.upgradePath.length) return a.upgradePath.length - b.upgradePath.length;
      return a.placedTick - b.placedTick || a.id - b.id;
    });

  const intel = ctx.intelligence[playerId];
  const bestWideValue = [BuildingType.MeleeSpawner, BuildingType.RangedSpawner, BuildingType.CasterSpawner]
    .filter(type => botCanAfford(state, playerId, type))
    .reduce((best, type) => Math.max(best, estimateSpawnerValue(state, ctx, playerId, type)), 0);

  for (const b of upgradeable) {
    const uv = estimateUpgradeValue(state, ctx, playerId, b, profile, enemyRaces, diff);
    const cost = getNodeUpgradeCost(player.race, b.type, b.upgradePath.length, uv.choice);
    if (player.gold < cost.gold || player.wood < cost.wood || player.meat < cost.meat) continue;
    if ((cost.deathEssence ?? 0) > 0 && player.deathEssence < (cost.deathEssence ?? 0)) continue;

    // Don't spend all resources on upgrades if we need buildings
    const resAfter = (player.gold - cost.gold) + (player.wood - cost.wood) + (player.meat - cost.meat);
    if (gameMinutes < 3 && resAfter < 30 && spawnerCount < 3) continue;
    if (uv.value <= 0) continue;

    // Intelligence-driven: prioritize upgrading the most effective unit type
    const effective = intel?.effectiveCategory;
    const effectiveType =
      effective === 'melee' ? BuildingType.MeleeSpawner :
      effective === 'ranged' ? BuildingType.RangedSpawner :
      effective === 'caster' ? BuildingType.CasterSpawner : null;

    // If this building isn't the effective type and an effective building is available to upgrade, skip
    if (effectiveType && b.type !== effectiveType && gameMinutes > 3) {
      const betterTarget = upgradeable.find(ub =>
        ub.type === effectiveType && ub.upgradePath.length <= b.upgradePath.length
      );
      if (betterTarget && betterTarget !== b) continue;
    }

    const armyAdvantage = intel?.armyAdvantage ?? 1;
    const atEffectiveCap = spawnerCount >= diff.maxSpawners || bestWideValue <= 0;
    const upgradeBias = atEffectiveCap ? 0.8 : armyAdvantage > 1.15 ? 0.95 : armyAdvantage < 0.9 ? 1.2 : 1.05;
    if (!atEffectiveCap && bestWideValue > uv.value * upgradeBias) continue;

    emit({ type: 'purchase_upgrade', playerId, buildingId: b.id, choice: uv.choice });
    return true;
  }

  // --- Hard bots: evaluate research upgrades alongside building upgrades ---
  // (Nightmare bots handle this in botValueBasedBuild instead)
  if (!diff.useValueFunction && intel) {
    const bu = player.researchUpgrades;
    const allResearch = getAllResearchUpgrades(player.race);
    let bestResearchValue = 0;
    let bestResearchId: string | null = null;

    for (const rDef of allResearch) {
      if (rDef.oneShot && bu.raceUpgrades[rDef.id]) continue;

      let rLevel = 0;
      if (rDef.id === 'melee_atk') rLevel = bu.meleeAtkLevel;
      else if (rDef.id === 'melee_def') rLevel = bu.meleeDefLevel;
      else if (rDef.id === 'ranged_atk') rLevel = bu.rangedAtkLevel;
      else if (rDef.id === 'ranged_def') rLevel = bu.rangedDefLevel;
      else if (rDef.id === 'caster_atk') rLevel = bu.casterAtkLevel;
      else if (rDef.id === 'caster_def') rLevel = bu.casterDefLevel;

      const rCost = getResearchUpgradeCost(rDef.id, rLevel, player.race);
      if (player.gold < rCost.gold || player.wood < rCost.wood || player.meat < rCost.meat) continue;
      if ((rCost.souls ?? 0) > 0 && player.souls < (rCost.souls ?? 0)) continue;

      const rv = estimateResearchValue(state, ctx, playerId, rDef.id, player.race, bu, intel, myBuildings);
      // Hard bots slightly undervalue research (0.8x) to prefer army investment
      const adjustedRv = rv * 0.8;
      if (adjustedRv > bestResearchValue) {
        bestResearchValue = adjustedRv;
        bestResearchId = rDef.id;
      }
    }

    if (bestResearchId && bestResearchValue > 0) {
      emit({ type: 'research_upgrade', playerId, upgradeId: bestResearchId });
      return true;
    }
  }

  return false;
}

// ==================== LANE MANAGEMENT ====================

export function botEvaluateLanes(
  state: GameState, ctx: BotContext, playerId: number, myTeam: Team,
  profile: RaceProfile, myBuildings: GameState['buildings'],
  gameMinutes: number, diff: BotDifficulty, emit: Emit,
): void {
  // Lane checks every ~4 seconds, urgency-scaled
  const myHqHp = state.hqHp[myTeam];
  const laneUrgency = myHqHp < HQ_HP * 0.4 ? 2 : 1;
  const laneInterval = Math.max(40, Math.floor(80 / laneUrgency));
  if (state.tick - (ctx.lastLaneTick[playerId] ?? 0) < laneInterval) return;
  ctx.lastLaneTick[playerId] = state.tick;

  // Random lane IQ: just pick a random lane occasionally
  if (diff.laneIQ === 'random') {
    const spawners = myBuildings.filter(b =>
      b.type === BuildingType.MeleeSpawner ||
      b.type === BuildingType.RangedSpawner ||
      b.type === BuildingType.CasterSpawner
    );
    if (spawners.length === 0) return;
    { // Always consume 2 RNG values to keep sequence stable
      const roll = state.rng(), flip = state.rng();
      if (roll < 0.15) {
        const lane = flip < 0.5 ? Lane.Left : Lane.Right;
        if (lane !== spawners[0].lane) {
          emit({ type: 'toggle_all_lanes', playerId, lane });
          ctx.currentLane[playerId] = lane;
        }
      }
    }
    return;
  }

  let myLeftStr = 0, myRightStr = 0, enemyLeftStr = 0, enemyRightStr = 0;
  let myLeftCount = 0, myRightCount = 0;
  for (const u of state.units) {
    const s = unitStrength(u);
    if (u.team === myTeam) {
      if (u.lane === Lane.Left) { myLeftStr += s; myLeftCount++; }
      else { myRightStr += s; myRightCount++; }
    } else {
      if (u.lane === Lane.Left) { enemyLeftStr += s; }
      else { enemyRightStr += s; }
    }
  }

  const myTotalStr = myLeftStr + myRightStr;
  const enemyTotalStr = enemyLeftStr + enemyRightStr;
  const totalMyUnits = myLeftCount + myRightCount;

  const teammateIds = getTeammateIds(playerId, state);
  // Use first teammate's lane for balancing (works for 2v2; 3v3 may need refinement)
  const teammateLane = teammateIds.length > 0 ? (ctx.currentLane[teammateIds[0]] ?? null) : null;

  const spawners = myBuildings.filter(b =>
    b.type === BuildingType.MeleeSpawner ||
    b.type === BuildingType.RangedSpawner ||
    b.type === BuildingType.CasterSpawner
  );
  if (spawners.length === 0) return;
  const currentLane = spawners[0].lane;

  let targetLane: Lane | null = null;

  // DEFENSIVE: respond to threats proportionally
  const leftThreat = (enemyLeftStr + 1) / (myLeftStr + 1);
  const rightThreat = (enemyRightStr + 1) / (myRightStr + 1);

  if (myHqHp < HQ_HP * 0.4) {
    if (leftThreat > rightThreat && leftThreat > 1.3) {
      targetLane = Lane.Left;
    } else if (rightThreat > leftThreat && rightThreat > 1.3) {
      targetLane = Lane.Right;
    }
  }

  // Basic lane IQ: only defend, skip proactive/coordination/stall-breaker
  if (diff.laneIQ === 'basic') {
    // Only do reactive defense (check below)
    if (targetLane === null) {
      if (leftThreat > 1.8 && leftThreat > rightThreat * 1.2) {
        targetLane = Lane.Left;
      } else if (rightThreat > 1.8 && rightThreat > leftThreat * 1.2) {
        targetLane = Lane.Right;
      }
    }
    if (targetLane !== null && targetLane !== currentLane) {
      emit({ type: 'toggle_all_lanes', playerId, lane: targetLane });
      ctx.currentLane[playerId] = targetLane;
    } else {
      ctx.currentLane[playerId] = currentLane;
    }
    return;
  }

  // ALL-IN PUSH: when dominating, commit to weakest enemy lane (nightmare only)
  const intel = ctx.intelligence[playerId];
  if (targetLane === null && diff.useValueFunction && intel && intel.armyAdvantage > 1.8 && gameMinutes > 2) {
    const weakerLane = enemyLeftStr <= enemyRightStr ? Lane.Left : Lane.Right;
    if (currentLane !== weakerLane) {
      targetLane = weakerLane;
      // Coordinate with team via chat
      if (state.tick - (ctx.lastChatTick[playerId] ?? 0) > 10 * TICK_RATE) {
        const msg = weakerLane === Lane.Left ? 'Attack Left' : 'Attack Right';
        emit({ type: 'quick_chat', playerId, message: msg });
        ctx.lastChatTick[playerId] = state.tick;
      }
    }
  }

  // PROACTIVE: push weaker lane when strong enough
  if (targetLane === null && totalMyUnits >= 3) {
    const overallRatio = (myTotalStr + 1) / (enemyTotalStr + 1);
    // Nightmare: lower push threshold → commit earlier when any advantage exists
    const effectivePushThreshold = diff.useValueFunction
      ? Math.min(profile.pushThreshold, 0.85) : profile.pushThreshold;

    if (overallRatio > effectivePushThreshold) {
      const lastPush = ctx.lastPushTick[playerId] ?? 0;
      const pushCooldown = 10 * TICK_RATE; // 10 seconds cooldown

      if (state.tick - lastPush > pushCooldown) {
        if (enemyLeftStr < enemyRightStr) {
          targetLane = Lane.Left;
        } else if (enemyRightStr < enemyLeftStr) {
          targetLane = Lane.Right;
        } else {
          if (teammateLane === Lane.Left) targetLane = Lane.Right;
          else if (teammateLane === Lane.Right) targetLane = Lane.Left;
        }

        if (targetLane !== null && targetLane !== currentLane) {
          ctx.lastPushTick[playerId] = state.tick;
        }
      }
    }
  }

  // COORDINATION: split with teammate
  if (targetLane === null && gameMinutes > 0.5) {
    if (teammateLane === Lane.Left && currentLane === Lane.Left) {
      targetLane = Lane.Right;
    } else if (teammateLane === Lane.Right && currentLane === Lane.Right) {
      targetLane = Lane.Left;
    }
  }

  // REACTIVE: respond to big pressure
  if (targetLane === null) {
    if (leftThreat > 1.8 && leftThreat > rightThreat * 1.2) {
      targetLane = Lane.Left;
    } else if (rightThreat > 1.8 && rightThreat > leftThreat * 1.2) {
      targetLane = Lane.Right;
    }
  }

  // STALL-BREAKER: commit to same lane to force a win (earlier for nightmare)
  const stallTime = diff.useValueFunction ? 5 : 7;
  if (targetLane === null && gameMinutes > stallTime) {
    const enemyHqHp = state.hqHp[botEnemyTeam(playerId, state)];
    if (enemyHqHp > HQ_HP * 0.3) {
      // Pick the lane with less enemy resistance
      const commitLane = enemyLeftStr <= enemyRightStr ? Lane.Left : Lane.Right;
      if (currentLane !== commitLane) targetLane = commitLane;
    }
  }

  // SPAWN WAVE TIMING: defer lane switch to align with spawn waves (nightmare only)
  if (targetLane !== null && targetLane !== currentLane && diff.useValueFunction) {
    // Find nearest spawn wave from our spawners
    let nearestSpawn = SPAWN_INTERVAL_TICKS; // default if no spawners
    for (const s of spawners) {
      if (s.actionTimer < nearestSpawn) nearestSpawn = s.actionTimer;
    }
    // If wave is 3-8 seconds away, defer the switch so units deploy in the new lane
    // (If wave is imminent (<60 ticks) or far away (>160 ticks), switch now)
    if (nearestSpawn > 60 && nearestSpawn < 160) {
      targetLane = null; // defer — will switch on next check when wave is closer
    }
  }

  if (targetLane !== null && targetLane !== currentLane) {
    emit({ type: 'toggle_all_lanes', playerId, lane: targetLane });
    ctx.currentLane[playerId] = targetLane;
  } else {
    ctx.currentLane[playerId] = currentLane;
  }
}

// ==================== HARVESTER MANAGEMENT ====================

/** Forward-looking harvester management using intelligence resource projections. */
export function botManageHarvesters(
  state: GameState, ctx: BotContext, playerId: number, player: GameState['players'][0],
  _myBuildings: GameState['buildings'],
  _gameMinutes: number, emit: Emit,
): void {
  const myHarvesters = state.harvesters.filter(h => h.playerId === playerId);
  if (myHarvesters.length === 0) return;

  const intel = ctx.intelligence[playerId];
  const plan = intel?.resourcePlan;

  // --- Build assignment plan ---
  // Each harvester gets a desired assignment based on the forward-looking resource plan
  const assignments: HarvesterAssignment[] = [];

  if (plan) {
    // Use the ideal split calculated by resource planner
    const [idealGold, idealWood, idealMeat, idealCenter] = plan.idealSplit;
    for (let i = 0; i < idealGold; i++) assignments.push(HarvesterAssignment.BaseGold);
    for (let i = 0; i < idealWood; i++) assignments.push(HarvesterAssignment.Wood);
    for (let i = 0; i < idealMeat; i++) assignments.push(HarvesterAssignment.Meat);
    for (let i = 0; i < idealCenter; i++) assignments.push(HarvesterAssignment.Center);

    // Pad or trim to match actual harvester count
    while (assignments.length < myHarvesters.length) {
      assignments.push(plan.bottleneck);
    }
    while (assignments.length > myHarvesters.length) {
      assignments.pop();
    }
  } else {
    // Fallback: use legacy primary/secondary resource logic
    const race = player.race;
    const costs = RACE_BUILDING_COSTS[race];
    let totalGoldNeed = 0, totalWoodNeed = 0, totalMeatNeed = 0;
    for (const type of [BuildingType.MeleeSpawner, BuildingType.RangedSpawner, BuildingType.CasterSpawner, BuildingType.Tower]) {
      const c = costs[type];
      totalGoldNeed += c.gold;
      totalWoodNeed += c.wood;
      totalMeatNeed += c.meat;
    }
    const resNeeds: [HarvesterAssignment, number][] = [
      [HarvesterAssignment.BaseGold, totalGoldNeed],
      [HarvesterAssignment.Wood, totalWoodNeed],
      [HarvesterAssignment.Meat, totalMeatNeed],
    ];
    resNeeds.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const primaryRes = resNeeds[0][1] > 0 ? resNeeds[0][0] : HarvesterAssignment.BaseGold;
    const secondaryRes = resNeeds[1][1] > 0 ? resNeeds[1][0] : resNeeds[0][0];

    for (let i = 0; i < myHarvesters.length; i++) {
      if (i < 2) assignments.push(primaryRes);
      else if (i < 3) assignments.push(secondaryRes);
      else assignments.push(primaryRes);
    }
  }

  // --- Demon: assign exactly 1 harvester to Mana (never more) if we have 3+ harvesters ---
  // With only 2 harvesters, 50% on mana starves wood/meat economy too hard
  if (player.race === Race.Demon && myHarvesters.length >= 3) {
    const manaCount = assignments.filter(a => a === HarvesterAssignment.Mana).length;
    if (manaCount === 0) {
      // Replace the last non-center assignment with Mana
      for (let i = assignments.length - 1; i >= 0; i--) {
        if (assignments[i] !== HarvesterAssignment.Center) {
          assignments[i] = HarvesterAssignment.Mana;
          break;
        }
      }
    } else if (manaCount > 1) {
      // Cap at 1 mana worker — convert extras back to bottleneck resource
      let found = 0;
      for (let i = 0; i < assignments.length; i++) {
        if (assignments[i] === HarvesterAssignment.Mana) {
          found++;
          if (found > 1) assignments[i] = plan?.bottleneck ?? HarvesterAssignment.Wood;
        }
      }
    }
  }

  // --- Apply assignments, respecting active harvesters ---
  for (let i = 0; i < myHarvesters.length; i++) {
    const h = myHarvesters[i];

    // Don't interrupt harvesters that are actively mining or carrying resources home
    if (h.state === 'mining' || h.state === 'walking_home') continue;

    const desired = assignments[i];

    // Hysteresis: don't reassign if harvester was recently assigned (prevent toggling)
    if (h.assignment === desired) continue;
    const lastAssignTick = (ctx as any)._harvAssignTick?.[h.id] ?? 0;
    if (state.tick - lastAssignTick < 10 * TICK_RATE) continue;  // 10s cooldown between reassignments
    if (!(ctx as any)._harvAssignTick) (ctx as any)._harvAssignTick = {};
    (ctx as any)._harvAssignTick[h.id] = state.tick;
    if (desired !== undefined && h.assignment !== desired) {
      const hut = state.buildings.find(b => b.id === h.hutId);
      if (hut) {
        emit({ type: 'set_hut_assignment', playerId, hutId: hut.id, assignment: desired });
      }
    }
  }
}

// ==================== NUKE ====================

/** Telegraph "Nuking Now!" then fire after a delay. Coordinates with teammate to avoid double-nuke. */
export function botNukeWithTelegraph(
  state: GameState, ctx: BotContext, playerId: number, myTeam: Team, myHqHp: number, emit: Emit,
): void {
  const TELEGRAPH_DELAY = 10; // ~0.5s at 20 tps

  const intentTick = ctx.nukeIntentTick[playerId] ?? 0;

  if (intentTick === 0) {
    // Phase 1: Announce intent — check if we actually have a target first
    if (!botHasNukeTarget(state, playerId, myTeam, myHqHp)) return;

    // Check if any teammate already declared intent recently
    const teammates = getTeammateIds(playerId, state);
    const anyTeammateNuking = teammates.some(tid => {
      const tIntent = ctx.nukeIntentTick[tid] ?? 0;
      return tIntent > 0 && state.tick - tIntent < TELEGRAPH_DELAY + 20;
    });
    if (anyTeammateNuking) {
      // Teammate is nuking — hold off
      return;
    }

    // Announce "Nuking Now!" and record intent
    emit({ type: 'quick_chat', playerId, message: 'Nuking Now!' });
    ctx.lastChatTick[playerId] = state.tick;
    ctx.nukeIntentTick[playerId] = state.tick;
    return;
  }

  // Phase 2: After half-beat delay, fire the nuke
  if (state.tick - intentTick < TELEGRAPH_DELAY) return;

  // Clear intent
  ctx.nukeIntentTick[playerId] = 0;

  // Check if any teammate declared intent AFTER us — if so, we yield
  const teammatesForNuke = getTeammateIds(playerId, state);
  const teammateNukedAfterUs = teammatesForNuke.some(tid => {
    const tIntent = ctx.nukeIntentTick[tid] ?? 0;
    return tIntent > 0 && tIntent > intentTick;
  });
  if (teammateNukedAfterUs) {
    // Teammate declared after us — let them have it
    return;
  }

  // Also check if a teammate's "Nuking Now!" quick chat appeared — respect human ally too
  const recentTeammateNukeChat = state.quickChats.some(
    c => c.playerId !== playerId && c.team === myTeam && c.message === 'Nuking Now!' && c.age < TELEGRAPH_DELAY + 10
  );
  if (recentTeammateNukeChat) return;

  botFireNuke(state, playerId, myTeam, myHqHp, emit);
}

/** Check if there's a worthwhile nuke target without actually firing. */
export function botHasNukeTarget(state: GameState, playerId: number, myTeam: Team, myHqHp: number): boolean {
  return evaluateBestNukePlan(state, playerId, myTeam, myHqHp) !== null;
}

export function botFireNuke(state: GameState, playerId: number, myTeam: Team, myHqHp: number, emit: Emit): void {
  const plan = evaluateBestNukePlan(state, playerId, myTeam, myHqHp);
  if (!plan) return;
  emit({ type: 'fire_nuke', playerId, x: plan.x, y: plan.y });
}

// ==================== QUICK CHAT ====================

export function botQuickChat(
  state: GameState, ctx: BotContext, playerId: number,
  myHqHp: number, _enemyHqHp: number, gameMinutes: number, emit: Emit,
): void {
  const lastChat = ctx.lastChatTick[playerId] ?? 0;
  if (state.tick - lastChat < 600) return;
  // Always consume 2 RNG values to keep sequence stable
  const chatRoll = state.rng(), chatRoll2 = state.rng();
  if (chatRoll > 0.2) return;

  let message: string | null = null;
  if (myHqHp < HQ_HP * 0.5) {
    message = 'Defend';
  } else if (state.diamond.exposed && state.diamond.state === 'exposed' && gameMinutes > 3) {
    message = 'Get Diamond';
  } else if (chatRoll2 < 0.3) {
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

// ==================== RACE ABILITY ====================

export function botUseAbility(state: GameState, playerId: number, emit: Emit): void {
  const player = state.players[playerId];
  if (!player || player.isEmpty) return;

  const def = RACE_ABILITY_DEFS[player.race];
  if (!def) return;

  // Tenders uses stack-based system
  if (player.race === Race.Tenders) {
    if (player.abilityStacks <= 0) return;
  } else {
    if (player.abilityCooldown > 0) return;
    // Check if we can afford it
    const growthMult = def.costGrowthFactor ? Math.pow(def.costGrowthFactor, player.abilityUseCount) : 1;
    const goldCost = Math.floor((def.baseCost.gold ?? 0) * growthMult);
    const woodCost = Math.floor((def.baseCost.wood ?? 0) * growthMult);
    const meatCost = Math.floor((def.baseCost.meat ?? 0) * growthMult);
    const manaCost = Math.floor((def.baseCost.mana ?? 0) * growthMult);
    const soulsCost = player.race === Race.Geists
      ? (def.baseCost.souls ?? 0) + 10 * player.abilityUseCount
      : Math.floor((def.baseCost.souls ?? 0) * growthMult);
    const essenceCost = Math.floor((def.baseCost.deathEssence ?? 0) * growthMult);

    if (player.gold < goldCost || player.wood < woodCost || player.meat < meatCost) return;
    if (player.mana < manaCost || player.souls < soulsCost || player.deathEssence < essenceCost) return;
  }

  const enemyTeam = botEnemyTeam(playerId, state);

  if (def.targetMode === AbilityTargetMode.Instant) {
    // Instant abilities: use when there are enemy units on the field
    const enemyCount = state.units.filter(u => u.team === enemyTeam && u.hp > 0).length;
    if (enemyCount >= 3 || state.tick > 3 * 60 * TICK_RATE) {
      emit({ type: 'use_ability', playerId });
    }
  } else if (def.targetMode === AbilityTargetMode.Targeted) {
    const radius = def.aoeRadius ?? 6;
    const r2 = radius * radius;

    // Wild targets allies (buff), others target enemies (damage/summon)
    const isAllyTarget = player.race === Race.Wild;
    const enemies = state.units.filter(u => u.team === enemyTeam && u.hp > 0);
    let targets: GameState['units'];

    if (isAllyTarget) {
      // Wild frenzy: only consider allies that are near enemy units (in combat)
      const combatRange = 12 * 12; // 12 tiles — units actively fighting or about to fight
      const alliesInCombat = state.units.filter(u => u.team === player.team && u.hp > 0 &&
        enemies.some(e => (e.x - u.x) ** 2 + (e.y - u.y) ** 2 <= combatRange));
      targets = alliesInCombat.length >= 2 ? alliesInCombat : state.units.filter(u => u.team === player.team && u.hp > 0);
    } else {
      targets = enemies;
    }
    if (targets.length < 2) return;

    // Find densest cluster center
    let bestX = 0, bestY = 0, bestScore = 0;
    for (const t of targets) {
      let score = 0;
      for (const o of targets) {
        if ((t.x - o.x) ** 2 + (t.y - o.y) ** 2 <= r2) score++;
      }
      if (score > bestScore) { bestScore = score; bestX = t.x; bestY = t.y; }
    }

    // Wild frenzy needs a real cluster (3+) to be worth the meat cost; others just need 2
    const minCluster = isAllyTarget ? 3 : 2;
    if (bestScore >= minCluster) {
      emit({ type: 'use_ability', playerId, x: bestX, y: bestY });
    }
  } else if (def.targetMode === AbilityTargetMode.BuildSlot) {
    // BuildSlot abilities: race-specific timing
    const racialCount = state.buildings.filter(b => b.playerId === playerId && b.isGlobule).length;
    const gameMin = state.tick / TICK_RATE / 60;

    // Goblins: potion shops are mid-game buildings — need army first, potions scale with research
    // Don't build any before 3 min, max 1 before 5 min, max 2 before 7 min
    if (player.race === Race.Goblins) {
      if (gameMin < 3) return;
      const potionShopCount = state.buildings.filter(b => b.playerId === playerId && b.isPotionShop).length;
      if (gameMin < 5 && potionShopCount >= 1) return;
      if (gameMin < 7 && potionShopCount >= 2) return;
    }

    // After 6+ Ooze Mounds, alternate: save some deathEssence for research upgrades
    if (racialCount >= 6 && player.race === Race.Oozlings) {
      // Only build if we have enough deathEssence to cover both the mound AND a research
      const nextResearchCost = 30 * Math.pow(1.4, Math.max(
        player.researchUpgrades.meleeAtkLevel,
        player.researchUpgrades.meleeDefLevel,
      ));
      const essenceCost = Math.floor((def.baseCost.deathEssence ?? 0) * (def.costGrowthFactor ? Math.pow(def.costGrowthFactor, player.abilityUseCount) : 1));
      if (player.deathEssence < essenceCost + nextResearchCost) return; // save for research
    }
    emit({ type: 'use_ability', playerId });
  }
}

// === Research Upgrade Bot Logic ===

/**
 * Simple timer-based research for Medium bots only.
 * Only buys attack upgrades. Skips if a spawner or hut is affordable (army/econ first).
 */
export function botManageResearch(
  state: GameState, _ctx: BotContext, playerId: number,
  player: GameState['players'][0], diff: BotDifficulty, emit: Emit,
): void {
  const bu = player.researchUpgrades;
  const race = player.race;
  const myBuildings = state.buildings.filter(b => b.playerId === playerId);
  const meleeCount = myBuildings.filter(b => b.type === BuildingType.MeleeSpawner).length;
  const rangedCount = myBuildings.filter(b => b.type === BuildingType.RangedSpawner).length;
  const casterCount = myBuildings.filter(b => b.type === BuildingType.CasterSpawner).length;
  const hutCount = myBuildings.filter(b => b.type === BuildingType.HarvesterHut).length;
  const totalSpawners = meleeCount + rangedCount + casterCount;

  // Army/econ first: skip research if we can afford a spawner or hut instead
  if (totalSpawners < diff.maxSpawners) {
    const spawnerTypes = [BuildingType.MeleeSpawner, BuildingType.RangedSpawner, BuildingType.CasterSpawner];
    for (const t of spawnerTypes) {
      if (botCanAfford(state, playerId, t)) return;
    }
  }
  if (hutCount < diff.maxHuts && botCanAffordHut(state, playerId, hutCount)) return;

  // Medium: only attack upgrades
  const allDefs = getAllResearchUpgrades(race);

  type UpgradeCandidate = { id: string; score: number; cost: { gold: number; wood: number; meat: number } };
  const candidates: UpgradeCandidate[] = [];

  for (const def of allDefs) {
    if (def.oneShot && bu.raceUpgrades[def.id]) continue;
    // Medium: only attack upgrades
    if (def.type !== 'attack') continue;

    let level = 0;
    if (def.id === 'melee_atk') level = bu.meleeAtkLevel;
    else if (def.id === 'ranged_atk') level = bu.rangedAtkLevel;
    else if (def.id === 'caster_atk') level = bu.casterAtkLevel;

    const cost = getResearchUpgradeCost(def.id, level, race);
    if (player.gold < cost.gold || player.wood < cost.wood || player.meat < cost.meat) continue;
    if ((cost.deathEssence ?? 0) > 0 && player.deathEssence < (cost.deathEssence ?? 0)) continue;
    if ((cost.souls ?? 0) > 0 && player.souls < (cost.souls ?? 0)) continue;

    // Score based on how many spawners of this category we have
    let categoryWeight = 0;
    if (def.category === 'melee') categoryWeight = meleeCount;
    else if (def.category === 'ranged') categoryWeight = rangedCount;
    else categoryWeight = casterCount;
    if (categoryWeight === 0) continue;

    let score = categoryWeight * 2; // attack multiplier
    const totalCost = cost.gold + cost.wood + cost.meat + (cost.deathEssence ?? 0) + (cost.souls ?? 0);
    score /= Math.max(1, totalCost / 100);

    candidates.push({ id: def.id, score, cost });
  }

  if (candidates.length === 0) return;

  // Sort by score descending — deterministic tie-break by id string comparison (no localeCompare)
  candidates.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const best = candidates[0];
  emit({ type: 'research_upgrade', playerId, upgradeId: best.id });
}
