/**
 * BotIntelligence.ts — Bot intelligence analysis, resource planning, and shared helper functions.
 *
 * Contains the intelligence update loop (combat telemetry, army assessment, game phase,
 * strategy selection), forward-looking resource planning, threat profiling, and all
 * utility functions shared across the bot subsystem.
 *
 * Part of the simulation layer — must remain fully deterministic.
 */

import {
  GameState, Race, BuildingType, Team, HarvesterAssignment,
  HQ_HP, isAbilityBuilding,
} from './types';
import {
  RACE_BUILDING_COSTS, UNIT_STATS,
  GOLD_YIELD_PER_TRIP, WOOD_YIELD_PER_TRIP, MEAT_YIELD_PER_TRIP,
  HUT_COST_SCALE, TOWER_COST_SCALE,
} from './data';
import { PASSIVE_INCOME } from './SimShared';
import {
  BotContext, BotIntelligence, CategoryPerf, ResourceProjection, ThreatProfile,
  RaceProfile, RACE_LIKES_DIAMOND,
} from './BotProfiles';

// Re-export types that other modules need from here
export type { ThreatProfile, CategoryPerf, ResourceProjection };

export function emptyPerf(): Record<'melee' | 'ranged' | 'caster', CategoryPerf> {
  return {
    melee: { alive: 0, avgHpPct: 1, totalKills: 0, buildingCount: 0 },
    ranged: { alive: 0, avgHpPct: 1, totalKills: 0, buildingCount: 0 },
    caster: { alive: 0, avgHpPct: 1, totalKills: 0, buildingCount: 0 },
  };
}

export function createBotIntelligence(enemyRaces: Race[]): BotIntelligence {
  return {
    myPerf: emptyPerf(),
    enemyPerf: emptyPerf(),
    buildShift: { melee: 0, ranged: 0, caster: 0 },
    threats: assessThreatProfile(enemyRaces),
    resourcePlan: null,
    armyAdvantage: 1,
    armyValueMy: 0,
    armyValueEnemy: 0,
    gamePhase: 'opening',
    strategy: 'balanced',
    effectiveCategory: null,
    weakCategory: null,
    enemyBuildingCounts: { melee: 0, ranged: 0, caster: 0, tower: 0, hut: 0 },
    enemyAvgUpgradeTier: 0,
    enemyMeleeRatio: 0.33,
    enemyRangedRatio: 0.33,
    enemyCasterRatio: 0.34,
    enemyQuantityVsQuality: 1,
    lastAnalysisTick: 0,
    lastResourcePlanTick: 0,
    prevMyUnitIds: new Set(),
    categoryDeaths: { melee: 0, ranged: 0, caster: 0 },
    categorySpawned: { melee: 0, ranged: 0, caster: 0 },
  };
}

// Passive income rates — owned by SimShared.ts and re-exported by GameState.ts.
export const PASSIVE_RATES = PASSIVE_INCOME;

// --- Race threat classifications ---
export const RACE_TRAITS: Record<Race, { archetype: string[]; appliesBurn: boolean; appliesSlow: boolean }> = {
  [Race.Crown]:    { archetype: ['tank', 'balanced'], appliesBurn: false, appliesSlow: false },
  [Race.Horde]:    { archetype: ['burst', 'tank'],    appliesBurn: false, appliesSlow: false },
  [Race.Goblins]:  { archetype: ['swarm', 'burn'],    appliesBurn: true,  appliesSlow: true },
  [Race.Oozlings]: { archetype: ['swarm'],            appliesBurn: false, appliesSlow: false },
  [Race.Demon]:    { archetype: ['burst', 'burn'],    appliesBurn: true,  appliesSlow: false },
  [Race.Deep]:     { archetype: ['tank', 'control'],  appliesBurn: false, appliesSlow: true },
  [Race.Wild]:     { archetype: ['burn', 'burst'],    appliesBurn: true,  appliesSlow: false },
  [Race.Geists]:   { archetype: ['sustain'],          appliesBurn: true,  appliesSlow: false },
  [Race.Tenders]:  { archetype: ['sustain', 'tank'],  appliesBurn: false, appliesSlow: true },
};

export function assessThreatProfile(enemyRaces: Race[]): ThreatProfile {
  const traits = enemyRaces.map(r => RACE_TRAITS[r]);
  const archetypes = traits.flatMap(t => t.archetype);

  const hasSwarm = archetypes.includes('swarm');
  const hasTanks = archetypes.includes('tank');
  const hasBurst = archetypes.includes('burst');
  const hasBurn = traits.some(t => t.appliesBurn);
  const hasSustain = archetypes.includes('sustain');
  const hasControl = archetypes.includes('control');

  // Determine primary threat — what's most dangerous?
  // Priority: burn (blight disables regen) > burst > swarm > tank > sustain > control
  let primaryThreat: ThreatProfile['primaryThreat'] = 'tank';
  if (hasControl) primaryThreat = 'control';
  if (hasSustain) primaryThreat = 'sustain';
  if (hasTanks) primaryThreat = 'tank';
  if (hasSwarm) primaryThreat = 'swarm';
  if (hasBurst) primaryThreat = 'burst';
  if (hasBurn) primaryThreat = 'burn';

  return {
    hasSwarm, hasTanks, hasBurst, hasBurn, hasSustain, hasControl,
    primaryThreat,
    wantAoE: hasSwarm,
    wantBurn: hasTanks || hasSustain,        // burn through regen/HP, blight disables regen
    wantTank: hasBurst || hasBurn,           // survive alpha strikes and DoT
    wantDPS: hasTanks,                       // need raw damage vs high HP
    wantRange: hasControl || hasTanks,       // kite slow/tanky units
    wantShields: hasBurn || hasBurst,        // absorb burst and DoT
    wantCleanse: hasBurn || hasControl,      // remove burn/slow stacks
    wantSpeed: hasControl,                   // dodge slow/CC
    wantSiege: hasTanks,                     // tank races build lots of towers — need siege to crack them
  };
}

// ==================== INTELLIGENCE ANALYSIS ====================

/** Runs every ~2 seconds. Updates combat telemetry, army assessment, game phase, strategy. */
export function botUpdateIntelligence(
  state: GameState, ctx: BotContext, playerId: number,
): void {
  const myTeam = botTeam(playerId, state);
  const intel = ctx.intelligence[playerId];
  const gameMinutes = state.tick / (20 * 60);

  // --- Game phase ---
  if (gameMinutes < 0.5) intel.gamePhase = 'opening';
  else if (gameMinutes < 2) intel.gamePhase = 'early';
  else if (gameMinutes < 5) intel.gamePhase = 'mid';
  else intel.gamePhase = 'late';

  // --- Combat telemetry + army value: single pass over all units ---
  const myPerf = emptyPerf();
  const enemyPerf = emptyPerf();
  const currentMyIds = new Set<number>();
  let myValue = 0, enemyValue = 0;

  for (const u of state.units) {
    const cat = u.category as 'melee' | 'ranged' | 'caster';
    const dps = u.damage / Math.max(0.5, u.attackSpeed);
    const value = u.hp * dps;
    if (u.team === myTeam) {
      const p = myPerf[cat];
      p.alive++;
      p.avgHpPct += u.hp / u.maxHp;
      p.totalKills += u.kills;
      currentMyIds.add(u.id);
      myValue += value;
    } else {
      const p = enemyPerf[cat];
      p.alive++;
      p.avgHpPct += u.hp / u.maxHp;
      p.totalKills += u.kills;
      enemyValue += value;
    }
  }

  // Finalize averages
  for (const cat of ['melee', 'ranged', 'caster'] as const) {
    if (myPerf[cat].alive > 0) myPerf[cat].avgHpPct /= myPerf[cat].alive;
    else myPerf[cat].avgHpPct = 0;
    if (enemyPerf[cat].alive > 0) enemyPerf[cat].avgHpPct /= enemyPerf[cat].alive;
    else enemyPerf[cat].avgHpPct = 0;
  }

  // Track deaths: units that were in prevMyUnitIds but no longer exist
  if (intel.prevMyUnitIds.size > 0) {
    for (const id of intel.prevMyUnitIds) {
      if (!currentMyIds.has(id)) {
        // Unit died — find its category from recent memory
        // We can't look it up anymore, but we can infer from building counts
        // This is imperfect — better to track unit IDs with categories
        // For now, distribute deaths proportionally
        const totalAlive = myPerf.melee.alive + myPerf.ranged.alive + myPerf.caster.alive;
        if (totalAlive > 0) {
          // Weight toward categories with fewer alive (they're the ones dying)
          if (myPerf.melee.avgHpPct <= myPerf.ranged.avgHpPct && myPerf.melee.avgHpPct <= myPerf.caster.avgHpPct) {
            intel.categoryDeaths.melee++;
          } else if (myPerf.ranged.avgHpPct <= myPerf.caster.avgHpPct) {
            intel.categoryDeaths.ranged++;
          } else {
            intel.categoryDeaths.caster++;
          }
        }
      }
    }
  }
  intel.prevMyUnitIds = currentMyIds;

  // Building counts for my side + enemy scouting (single pass)
  const enemyTeam = botEnemyTeam(playerId, state);
  let myMelee = 0, myRanged = 0, myCaster = 0;
  let eMelee = 0, eRanged = 0, eCaster = 0, eTower = 0, eHut = 0;
  const enemyBuildings: typeof state.buildings = [];
  for (const b of state.buildings) {
    if (b.playerId === playerId) {
      if (b.type === BuildingType.MeleeSpawner) myMelee++;
      else if (b.type === BuildingType.RangedSpawner) myRanged++;
      else if (b.type === BuildingType.CasterSpawner) myCaster++;
    } else if (botTeam(b.playerId, state) === enemyTeam) {
      enemyBuildings.push(b);
      if (b.type === BuildingType.MeleeSpawner) eMelee++;
      else if (b.type === BuildingType.RangedSpawner) eRanged++;
      else if (b.type === BuildingType.CasterSpawner) eCaster++;
      else if (b.type === BuildingType.Tower) eTower++;
      else if (b.type === BuildingType.HarvesterHut) eHut++;
    }
  }
  myPerf.melee.buildingCount = myMelee;
  myPerf.ranged.buildingCount = myRanged;
  myPerf.caster.buildingCount = myCaster;
  intel.enemyBuildingCounts = { melee: eMelee, ranged: eRanged, caster: eCaster, tower: eTower, hut: eHut };
  // Dynamically enable siege if enemy is turtling with towers
  if (intel.enemyBuildingCounts.tower >= 2) intel.threats.wantSiege = true;
  const upgTiers = enemyBuildings
    .filter(b => b.type !== BuildingType.HarvesterHut)
    .map(b => Math.max(0, b.upgradePath.length - 1));
  intel.enemyAvgUpgradeTier = upgTiers.length > 0 ? upgTiers.reduce((a, b) => a + b, 0) / upgTiers.length : 0;

  // Real-time enemy unit composition ratios
  const enemyUnitTotal = enemyPerf.melee.alive + enemyPerf.ranged.alive + enemyPerf.caster.alive;
  if (enemyUnitTotal > 0) {
    intel.enemyMeleeRatio = enemyPerf.melee.alive / enemyUnitTotal;
    intel.enemyRangedRatio = enemyPerf.ranged.alive / enemyUnitTotal;
    intel.enemyCasterRatio = enemyPerf.caster.alive / enemyUnitTotal;
  }

  // Quantity vs quality assessment
  const enemySpawnerTotal = intel.enemyBuildingCounts.melee + intel.enemyBuildingCounts.ranged + intel.enemyBuildingCounts.caster;
  intel.enemyQuantityVsQuality = enemySpawnerTotal > 0
    ? (intel.enemyAvgUpgradeTier + 0.5) / (enemySpawnerTotal / 4)
    : 1;

  intel.myPerf = myPerf;
  intel.enemyPerf = enemyPerf;

  // --- Army advantage (computed in single pass above) ---
  intel.armyValueMy = myValue;
  intel.armyValueEnemy = enemyValue;
  intel.armyAdvantage = enemyValue > 0 ? myValue / enemyValue : (myValue > 0 ? 5 : 1);

  // --- Determine what's working and what's failing ---
  // Effectiveness = kills per building (higher = more productive)
  const effectiveness: Record<string, number> = {};
  for (const cat of ['melee', 'ranged', 'caster'] as const) {
    const bc = myPerf[cat].buildingCount;
    if (bc > 0) {
      effectiveness[cat] = myPerf[cat].totalKills / bc;
    } else {
      effectiveness[cat] = 0;
    }
  }

  // Best performing category
  let bestCat: 'melee' | 'ranged' | 'caster' | null = null;
  let bestEff = 0;
  let worstCat: 'melee' | 'ranged' | 'caster' | null = null;
  let worstHp = 2;
  for (const cat of ['melee', 'ranged', 'caster'] as const) {
    if (myPerf[cat].buildingCount > 0) {
      if (effectiveness[cat] > bestEff) { bestEff = effectiveness[cat]; bestCat = cat; }
      if (myPerf[cat].avgHpPct < worstHp && myPerf[cat].alive > 0) {
        worstHp = myPerf[cat].avgHpPct; worstCat = cat;
      }
    }
  }
  intel.effectiveCategory = bestCat;
  intel.weakCategory = worstCat;

  // --- Dynamic build shift ---
  // Positive = build more, Negative = build fewer
  const shift = { melee: 0, ranged: 0, caster: 0 };

  if (gameMinutes > 1.5) {
    // If a category is dying fast (low avgHpPct), reduce it OR boost support
    if (worstCat === 'melee' && myPerf.melee.avgHpPct < 0.4) {
      // Melee dying → need more ranged to soften enemies, or more casters for support
      shift.ranged += 1;
      shift.caster += 1;
    }
    if (worstCat === 'ranged' && myPerf.ranged.avgHpPct < 0.4) {
      // Ranged dying → enemy is reaching backline, need more melee/towers
      shift.melee += 1;
    }

    // If a category is very effective, double down
    if (bestCat && effectiveness[bestCat] > 3) {
      shift[bestCat] += 1;
    }

    // Counter enemy composition — use real unit ratios (more accurate than building counts)
    if (enemyUnitTotal > 3) {
      // Enemy melee-heavy → ranged shreds them from distance
      if (intel.enemyMeleeRatio > 0.55) shift.ranged += 2;
      else if (intel.enemyMeleeRatio > 0.4) shift.ranged += 1;
      // Enemy ranged-heavy → melee to dive or casters for support
      if (intel.enemyRangedRatio > 0.55) { shift.melee += 2; }
      else if (intel.enemyRangedRatio > 0.4) shift.melee += 1;
      // Enemy caster-heavy → melee assassins to reach backline
      if (intel.enemyCasterRatio > 0.35) shift.melee += 1;
    } else {
      // Fallback to building counts early game
      const ec = intel.enemyBuildingCounts;
      const enemyBldgTotal = ec.melee + ec.ranged + ec.caster;
      if (enemyBldgTotal > 0) {
        if (ec.melee / enemyBldgTotal > 0.5) shift.ranged += 1;
        if (ec.ranged / enemyBldgTotal > 0.5) shift.melee += 1;
      }
    }

    // Enemy has lots of towers → ranged/caster to outrange, don't feed melee
    if (intel.enemyBuildingCounts.tower >= 3) { shift.ranged += 1; shift.melee -= 1; }

    // Quantity vs quality counter-play
    if (intel.enemyQuantityVsQuality > 1.5) {
      // Enemy invests in quality (few high-tier units) → overwhelm with numbers
      shift.melee += 1; // cheap bodies
    } else if (intel.enemyQuantityVsQuality < 0.5) {
      // Enemy spams quantity (many low-tier units) → AoE/casters shine
      shift.caster += 1;
    }

    // If losing badly, prioritize what's working and add towers (handled in build order)
    if (intel.armyAdvantage < 0.5) {
      if (bestCat) shift[bestCat] += 1;
    }
  }

  // Clamp shifts to [-2, +2]
  for (const cat of ['melee', 'ranged', 'caster'] as const) {
    shift[cat] = Math.max(-2, Math.min(2, shift[cat]));
  }
  intel.buildShift = shift;

  // --- Strategy selection ---
  const race = state.players[playerId].race;
  const myHqHp = state.hqHp[myTeam];

  if (intel.gamePhase === 'opening') {
    // Opening: follow race profile
    const rushRaces = new Set([Race.Horde, Race.Demon, Race.Goblins, Race.Oozlings]);
    intel.strategy = rushRaces.has(race) ? 'rush' : 'balanced';
  } else if (myHqHp < HQ_HP * 0.4) {
    // Desperate: turtle up
    intel.strategy = 'turtle';
  } else if (intel.armyAdvantage > 1.5) {
    // Winning: press advantage
    intel.strategy = 'rush';
  } else if (intel.armyAdvantage < 0.6) {
    // Losing: play safe, build economy
    const lateRaces = new Set([Race.Deep, Race.Tenders, Race.Crown]);
    intel.strategy = lateRaces.has(race) ? 'turtle' : 'balanced';
  } else {
    // Even: build economy for advantage
    const greedyRaces = new Set([Race.Deep, Race.Tenders, Race.Crown]);
    intel.strategy = greedyRaces.has(race) ? 'greed' : 'balanced';
  }

  // --- Dynamic threat re-assessment based on actual enemy composition ---
  // Override race-based threats with real battlefield data when we have enough info
  if (enemyUnitTotal >= 5) {
    const threats = intel.threats;
    // Detect actual swarm: many low-tier units (high count, low avg upgrade)
    const actualSwarm = enemyUnitTotal > 15 || (intel.enemyQuantityVsQuality < 0.6);
    // Detect actual tank: enemy melee-heavy with high HP units
    const actualTank = intel.enemyMeleeRatio > 0.5 && enemyPerf.melee.avgHpPct > 0.6;
    // Detect actual burst: enemy ranged/caster heavy
    const actualBurst = intel.enemyRangedRatio + intel.enemyCasterRatio > 0.65;

    if (actualSwarm && !threats.hasSwarm) {
      threats.hasSwarm = true;
      threats.wantAoE = true;
    }
    if (actualTank && !threats.hasTanks) {
      threats.hasTanks = true;
      threats.wantDPS = true;
      threats.wantRange = true;
    }
    if (actualBurst && !threats.hasBurst) {
      threats.hasBurst = true;
      threats.wantTank = true;
      threats.wantShields = true;
    }

    // Re-evaluate primary threat based on what's actually dominating
    if (actualSwarm && intel.armyAdvantage < 0.8) threats.primaryThreat = 'swarm';
    else if (actualBurst && intel.armyAdvantage < 0.8) threats.primaryThreat = 'burst';
    else if (actualTank && intel.armyAdvantage < 0.8) threats.primaryThreat = 'tank';
  }

  intel.lastAnalysisTick = state.tick;
}

// ==================== FORWARD-LOOKING RESOURCE PLANNING ====================

/** Build a shopping list of upcoming purchases and project resource needs vs income. */
export function botPlanResources(
  state: GameState, playerId: number, profile: RaceProfile,
  myBuildings: GameState['buildings'], gameMinutes: number,
  intel: BotIntelligence,
): ResourceProjection {
  const player = state.players[playerId];
  const race = player.race;
  const costs = RACE_BUILDING_COSTS[race];
  let meleeCount = 0, rangedCount = 0, casterCount = 0, hutCount = 0, towerCount = 0;
  for (const b of myBuildings) {
    if (b.type === BuildingType.MeleeSpawner) meleeCount++;
    else if (b.type === BuildingType.RangedSpawner) rangedCount++;
    else if (b.type === BuildingType.CasterSpawner) casterCount++;
    else if (b.type === BuildingType.HarvesterHut) hutCount++;
    else if (b.type === BuildingType.Tower && !isAbilityBuilding(b)) towerCount++;
  }

  // --- Build shopping list: next 3-4 purchases ---
  const list: { gold: number; wood: number; meat: number }[] = [];

  // Determine phase-appropriate targets (with build shift applied)
  let meleeTarget: number, rangedTarget: number, casterTarget: number, hutTarget: number;
  if (gameMinutes < 1.5) {
    meleeTarget = profile.earlyMelee;
    rangedTarget = profile.earlyRanged;
    casterTarget = 0;
    hutTarget = profile.earlyHuts;
  } else if (gameMinutes < 5) {
    meleeTarget = profile.midMelee + intel.buildShift.melee;
    rangedTarget = profile.midRanged + intel.buildShift.ranged;
    casterTarget = profile.midCasters + intel.buildShift.caster;
    hutTarget = profile.midHuts;
  } else {
    meleeTarget = profile.midMelee + 1 + intel.buildShift.melee;
    rangedTarget = profile.midRanged + 1 + intel.buildShift.ranged;
    casterTarget = profile.midCasters + 1 + intel.buildShift.caster;
    hutTarget = profile.maxHuts;
  }

  // Clamp targets to at least 0
  meleeTarget = Math.max(0, meleeTarget);
  rangedTarget = Math.max(0, rangedTarget);
  casterTarget = Math.max(0, casterTarget);

  // Queue buildings we still need (in priority order)
  if (meleeCount < meleeTarget) list.push(costs[BuildingType.MeleeSpawner]);
  if (rangedCount < rangedTarget) list.push(costs[BuildingType.RangedSpawner]);
  if (casterCount < casterTarget) list.push(costs[BuildingType.CasterSpawner]);
  if (hutCount < hutTarget && hutCount < profile.maxHuts) {
    const mult = Math.pow(HUT_COST_SCALE, Math.max(0, hutCount - 1));
    const hutCost = costs[BuildingType.HarvesterHut];
    list.push({
      gold: Math.floor(hutCost.gold * mult),
      wood: Math.floor(hutCost.wood * mult),
      meat: Math.floor(hutCost.meat * mult),
    });
  }

  // Queue upgrade costs for next 1-2 upgradeable buildings
  const upgradeable = myBuildings
    .filter(b => b.type !== BuildingType.HarvesterHut && b.upgradePath.length > 0 && b.upgradePath.length < 3);
  for (let i = 0; i < Math.min(2, upgradeable.length); i++) {
    const b = upgradeable[i];
    list.push(getNodeUpgradeCost(race, b.type, b.upgradePath.length));
  }

  // Tower if strategy calls for it
  if (intel.strategy === 'turtle' && towerCount < profile.lateTowers) {
    list.push(costs[BuildingType.Tower]);
  }

  // Sum next 3-4 items on list
  let totalGold = 0, totalWood = 0, totalMeat = 0;
  const lookahead = Math.min(4, list.length);
  for (let i = 0; i < lookahead; i++) {
    totalGold += list[i].gold;
    totalWood += list[i].wood;
    totalMeat += list[i].meat;
  }

  // Deficits (what we need minus what we have)
  const goldNeeded = Math.max(0, totalGold - player.gold);
  const woodNeeded = Math.max(0, totalWood - player.wood);
  const meatNeeded = Math.max(0, totalMeat - player.meat);

  // --- Estimate income ---
  const passive = PASSIVE_RATES[race];
  // Harvester rates: yield / estimated round-trip time (~8.5s for nearby nodes)
  const GOLD_HARVEST_RATE = GOLD_YIELD_PER_TRIP / 8.5;   // ~0.59/sec
  const WOOD_HARVEST_RATE = WOOD_YIELD_PER_TRIP / 8.5;   // ~1.18/sec
  const MEAT_HARVEST_RATE = MEAT_YIELD_PER_TRIP / 8.5;  // ~1.18/sec
  const harvesters = state.harvesters.filter(h => h.playerId === playerId);
  let goldH = 0, woodH = 0, meatH = 0;
  for (const h of harvesters) {
    if (h.assignment === HarvesterAssignment.BaseGold || h.assignment === HarvesterAssignment.Center) goldH++;
    else if (h.assignment === HarvesterAssignment.Wood) woodH++;
    else meatH++;
  }

  const goldIncome = passive.gold + goldH * GOLD_HARVEST_RATE;
  const woodIncome = passive.wood + woodH * WOOD_HARVEST_RATE;
  const meatIncome = passive.meat + meatH * MEAT_HARVEST_RATE;

  // Time to afford each resource
  const goldSecs = goldIncome > 0.01 ? goldNeeded / goldIncome : (goldNeeded > 0 ? 999 : 0);
  const woodSecs = woodIncome > 0.01 ? woodNeeded / woodIncome : (woodNeeded > 0 ? 999 : 0);
  const meatSecs = meatIncome > 0.01 ? meatNeeded / meatIncome : (meatNeeded > 0 ? 999 : 0);

  // Bottleneck = resource with longest time-to-afford
  // No-gold races default to wood instead of gold
  const noGold = race === Race.Demon || race === Race.Wild;
  let bottleneck = noGold ? HarvesterAssignment.Wood : HarvesterAssignment.BaseGold;
  let maxTime = noGold ? woodSecs : goldSecs;
  if (woodSecs > maxTime) { bottleneck = HarvesterAssignment.Wood; maxTime = woodSecs; }
  if (meatSecs > maxTime) { bottleneck = HarvesterAssignment.Meat; maxTime = meatSecs; }

  // --- Calculate ideal harvester split ---
  // Distribute harvesters proportional to resource deficit, not current stockpiles
  const totalDeficit = goldNeeded + woodNeeded + meatNeeded;
  const totalHarvesters = harvesters.length;
  let idealGold = 0, idealWood = 0, idealMeat = 0, idealCenter = 0;

  if (totalDeficit > 0 && totalHarvesters > 0) {
    const goldPct = goldNeeded / totalDeficit;
    const woodPct = woodNeeded / totalDeficit;
    const meatPct = meatNeeded / totalDeficit;

    // Assign harvesters proportionally, minimum 1 per needed resource
    // No-gold races (Demon, Wild) never assign gold workers — they can't harvest gold
    const noGoldRace = race === Race.Demon || race === Race.Wild;
    idealGold = noGoldRace ? 0 : Math.max(goldNeeded > 10 ? 1 : 0, Math.round(goldPct * totalHarvesters));
    idealWood = Math.max(woodNeeded > 10 ? 1 : 0, Math.round(woodPct * totalHarvesters));
    idealMeat = Math.max(meatNeeded > 10 ? 1 : 0, Math.round(meatPct * totalHarvesters));

    // If race likes diamond and game is late enough, dedicate 2 to center (or none)
    // Sending 1 worker alone to diamond is wasteful — they need to contest it
    if (RACE_LIKES_DIAMOND[race] && gameMinutes > 3 && totalHarvesters >= 5) {
      idealCenter = 2;
    }

    // Normalize to total harvesters
    const total = idealGold + idealWood + idealMeat + idealCenter;
    if (total > totalHarvesters) {
      // Scale down proportionally, keep center if assigned
      const scale = (totalHarvesters - idealCenter) / Math.max(1, idealGold + idealWood + idealMeat);
      idealGold = Math.round(idealGold * scale);
      idealWood = Math.round(idealWood * scale);
      idealMeat = totalHarvesters - idealGold - idealWood - idealCenter;
    } else if (total < totalHarvesters) {
      // Extra harvesters go to bottleneck
      const extra = totalHarvesters - total;
      if (bottleneck === HarvesterAssignment.Wood) idealWood += extra;
      else if (bottleneck === HarvesterAssignment.Meat) idealMeat += extra;
      else idealGold += extra;
    }
  } else if (totalHarvesters > 0) {
    // No deficit — distribute based on what race needs most (from building costs)
    const totalCosts = costs[BuildingType.MeleeSpawner];
    const costTotal = totalCosts.gold + totalCosts.wood + totalCosts.meat;
    if (costTotal > 0) {
      idealGold = Math.max(1, Math.round((totalCosts.gold / costTotal) * totalHarvesters));
      idealWood = Math.max(totalCosts.wood > 0 ? 1 : 0, Math.round((totalCosts.wood / costTotal) * totalHarvesters));
      idealMeat = totalHarvesters - idealGold - idealWood;
    } else {
      idealGold = totalHarvesters;
    }
  }

  return {
    totalGoldNeeded: totalGold, totalWoodNeeded: totalWood, totalMeatNeeded: totalMeat,
    goldIncome, woodIncome, meatIncome,
    goldSecsToTarget: goldSecs, woodSecsToTarget: woodSecs, meatSecsToTarget: meatSecs,
    bottleneck,
    idealSplit: [idealGold, idealWood, idealMeat, idealCenter],
  };
}

// --- Helper function to import getNodeUpgradeCost without circular dep ---
import { getNodeUpgradeCost } from './data';

// ==================== UNIT ABILITY VALUE MULTIPLIERS ====================

/**
 * Unit ability value multipliers — captures combat effects that raw stats miss.
 * Each unit type gets TWO multipliers:
 *   survMult: effective HP multiplier (lifesteal, regen, shields, dodge, knockback)
 *   dmgMult:  effective DPS multiplier (burn DoT, slow debuff, AoE, haste, wound)
 *
 * The value function uses: unitPower = sqrt(DPS * dmgMult * HP * survMult)
 * This means a 1.5x dmgMult is like having 1.5x base DPS — huge for "weak" casters.
 */
export const UNIT_ABILITY_VALUE: Record<Race, Record<string, { survMult: number; dmgMult: number }>> = {
  [Race.Crown]: {
    // Swordsman: no on-hit effects. Tanky base stats, benefits from Priest shields.
    melee:  { survMult: 1.10, dmgMult: 1.00 },
    // Bowman: no specials. Cheap (25w), solid ranged DPS.
    ranged: { survMult: 1.00, dmgMult: 1.00 },
    // Priest: shields 2-3 allies for 12 absorb each cast. Team-wide EHP boost.
    // With Fortified Shields research: +8 absorb = 20 absorb per ally = massive.
    caster: { survMult: 1.10, dmgMult: 2.0 },
  },
  [Race.Horde]: {
    // Brute: knockback every 3rd hit + 10% melee lifesteal. 130 HP tank.
    melee:  { survMult: 1.20, dmgMult: 1.05 },
    // Bowcleaver: 18 dmg, split shot path (2→3 projectiles). High volume damage.
    ranged: { survMult: 1.00, dmgMult: 1.15 },
    // War Chanter: haste pulse + chain heal (B-path). +25% dmg with Berserker Howl.
    // Chain heal gives Horde sustain they desperately need.
    caster: { survMult: 1.00, dmgMult: 2.2 },
  },
  [Race.Goblins]: {
    // Sticker: all Goblin attacks apply Wound (-50% healing). Fast (5.0 move).
    // With Coated Blades research: +1 burn on melee. Burns stack with volume.
    melee:  { survMult: 0.85, dmgMult: 1.30 },
    // Knifer: burn on ranged hit (via projectile), wound on hit. Fast attack speed.
    ranged: { survMult: 0.85, dmgMult: 1.40 },
    // Hexer: AoE slow to enemies. With Potent Hex: +1 burn AoE.
    // Slow + Burn = Seared combo (+50% burn dmg). Multiplicative with burn army.
    caster: { survMult: 0.85, dmgMult: 2.2 },
  },
  [Race.Oozlings]: {
    // Globule x2: 15% chance haste on melee hit. Death fuels ooze economy.
    // With Volatile Membrane: explode on death. With Mitosis: 10% spawn on death.
    melee:  { survMult: 1.15, dmgMult: 1.10 },
    // Spitter x2: ranged bodies. With Corrosive Spit: vulnerable (+20% dmg taken).
    ranged: { survMult: 1.00, dmgMult: 1.15 },
    // Bloater x2: haste pulse to 3 allies. C-path = chain lightning (2-3 bounces).
    // With Symbiotic Link: heal during haste. Chain lightning adds real DPS.
    caster: { survMult: 1.00, dmgMult: 2.0 },
  },
  [Race.Demon]: {
    // Smasher: burn on every melee hit + Wound. Glass cannon (90 HP, 12 dmg, 4.62 speed).
    // With Infernal Rage: +25% vs burning. Core burn synergy.
    melee:  { survMult: 0.92, dmgMult: 1.45 },
    // Eye Sniper: burn on ranged hit, long range (8), 20% crit at 1.75x.
    // With Hellfire Arrows: +1 burn +10% dmg. Crit identity = burst damage.
    ranged: { survMult: 0.85, dmgMult: 1.50 },
    // Overlord: tankiest caster (65 HP, 20 dmg). AoE attacks.
    // With Flame Conduit: +1 burn on AoE. With Immolation: 2-tile burn aura.
    caster: { survMult: 0.95, dmgMult: 1.7 },
  },
  [Race.Deep]: {
    // Shell Guard: slow on melee hit. 190 HP tank wall.
    melee:  { survMult: 1.25, dmgMult: 1.10 },
    // Harpooner: 2 slow stacks on ranged hit. Shark path = fast single-target slow machine.
    // With Frozen Harpoons + Crushing Depths (+50% vs slowed) = devastating combo.
    ranged: { survMult: 1.10, dmgMult: 1.30 },
    // Tidecaller: cleanses burn + haste allies (Purifying Tide). Star side = support, Clam side = DPS AoE.
    caster: { survMult: 1.10, dmgMult: 1.9 },
  },
  [Race.Wild]: {
    // Lurker: burn (poison) on melee hit. On kill: heal 15% maxHP, frenzy+haste to nearby allies.
    // Kill trigger is MASSIVE — snowballs fights. With Pack Hunter: +5% dmg per nearby ally.
    melee:  { survMult: 1.15, dmgMult: 1.40 },
    // Bonechucker: burn + wound via projectile. Anti-sustain.
    // With Venomous Fangs: +1 burn + wound. With Slowing Shots: +1 slow on hit.
    ranged: { survMult: 1.00, dmgMult: 1.35 },
    // Scaled Sage: haste pulse to 3 allies. With Alpha Howl: also grants Frenzy (+50% dmg).
    // Frenzy is the biggest DPS buff in the game — caster is a force multiplier.
    caster: { survMult: 1.00, dmgMult: 2.2 },
  },
  [Race.Geists]: {
    // Bone Knight: 10% melee lifesteal + burn + wound on hit. With Death Grip: 15% lifesteal.
    // Lifesteal sustain on 88 HP body — still effective but squishier now.
    melee:  { survMult: 1.25, dmgMult: 1.20 },
    // Wraith Bow: 10% ranged lifesteal + burn on hit (via projectile). 25 HP, fragile.
    // Lifesteal helps but low HP means they die fast to AoE.
    ranged: { survMult: 1.10, dmgMult: 1.20 },
    // Necromancer: with Necrotic Burst research: heals 2 HP to 3 allies.
    // With Undying Will: skeleton summon chance. Decent support.
    caster: { survMult: 1.10, dmgMult: 1.8 },
  },
  [Race.Tenders]: {
    // Treant: innate 1 HP/s regen. 135 HP = regen is ~0.7%/s sustained healing.
    // With Bark Skin: regen doubles to 2 HP/s. Massive in long fights.
    melee:  { survMult: 1.30, dmgMult: 1.00 },
    // Tinker: with Healing Sap: heals ally 15% of dmg dealt. With Root Snare: 20% slow.
    ranged: { survMult: 1.05, dmgMult: 1.10 },
    // Grove Keeper: focused heal on most injured ally. Core sustain engine.
    // With Bloom Burst: +2 heal. With Life Link: double heal <30% HP.
    caster: { survMult: 1.10, dmgMult: 2.0 },
  },
};

// --- Enemy analysis ---

export const SWARM_RACES: ReadonlySet<Race> = new Set([Race.Oozlings, Race.Goblins]);
export const TANK_RACES: ReadonlySet<Race> = new Set([Race.Deep, Race.Tenders, Race.Crown]);
export const GLASS_CANNON_RACES: ReadonlySet<Race> = new Set([Race.Demon, Race.Wild]);

export function getEnemyRaces(state: GameState, playerId: number): Race[] {
  const myTeam = botTeam(playerId, state);
  return state.players
    .filter(p => p.team !== myTeam && !p.isEmpty)
    .map(p => p.race);
}

export function enemyHasArchetype(enemyRaces: Race[], archetype: ReadonlySet<Race>): boolean {
  return enemyRaces.some(r => archetype.has(r));
}

// --- Helpers ---

export function botTeam(playerId: number, state?: GameState): Team {
  if (state?.mapDef) {
    const slot = state.mapDef.playerSlots[playerId];
    if (slot) return slot.teamIndex as Team;
  }
  return playerId < 2 ? Team.Bottom : Team.Top;
}

export function botEnemyTeam(playerId: number, state?: GameState): Team {
  const myTeam = botTeam(playerId, state);
  return myTeam === Team.Bottom ? Team.Top : Team.Bottom;
}

export function botCanAfford(state: GameState, playerId: number, type: BuildingType): boolean {
  const player = state.players[playerId];
  const cost = RACE_BUILDING_COSTS[player.race][type];
  return player.gold >= cost.gold && player.wood >= cost.wood && player.meat >= cost.meat;
}

export function botCanAffordTower(state: GameState, playerId: number, towerCount: number): boolean {
  const player = state.players[playerId];
  if (!player.hasBuiltTower) return true; // first tower is free
  const baseCost = RACE_BUILDING_COSTS[player.race][BuildingType.Tower];
  const mult = Math.pow(TOWER_COST_SCALE, Math.max(0, towerCount - 1));
  return player.gold >= Math.floor(baseCost.gold * mult)
    && player.wood >= Math.floor(baseCost.wood * mult)
    && player.meat >= Math.floor(baseCost.meat * mult);
}

export function botCanAffordHut(state: GameState, playerId: number, hutCount: number): boolean {
  const player = state.players[playerId];
  const hutRes = RACE_BUILDING_COSTS[player.race][BuildingType.HarvesterHut];
  const mult = Math.pow(HUT_COST_SCALE, Math.max(0, hutCount - 1));
  return player.gold >= Math.floor(hutRes.gold * mult)
    && player.wood >= Math.floor(hutRes.wood * mult)
    && player.meat >= Math.floor(hutRes.meat * mult);
}

export function unitStrength(u: GameState['units'][0]): number {
  return (u.hp / u.maxHp) * u.damage + 1;
}

export function getTeammateIds(playerId: number, state?: GameState): number[] {
  if (state?.mapDef) {
    const myTeam = botTeam(playerId, state);
    return state.players
      .filter(p => p.team === myTeam && p.id !== playerId && !p.isEmpty)
      .map(p => p.id);
  }
  // Legacy 4-player fallback
  return [playerId < 2 ? (playerId === 0 ? 1 : 0) : (playerId === 2 ? 3 : 2)];
}

/** Total resource value available to spend */
export function totalResources(state: GameState, playerId: number): number {
  const p = state.players[playerId];
  return p.gold + p.wood + p.meat;
}

export function resourceBundleTotal(cost: { gold: number; wood: number; meat: number; deathEssence?: number; souls?: number }): number {
  return cost.gold + cost.wood + cost.meat + (cost.deathEssence ?? 0) + (cost.souls ?? 0);
}

export function buildingCategory(type: BuildingType): 'melee' | 'ranged' | 'caster' | null {
  switch (type) {
    case BuildingType.MeleeSpawner: return 'melee';
    case BuildingType.RangedSpawner: return 'ranged';
    case BuildingType.CasterSpawner: return 'caster';
    default: return null;
  }
}

export function getSpawnerPower(race: Race, type: BuildingType): number {
  const stats = UNIT_STATS[race]?.[type];
  if (!stats) return 0;
  const count = stats.spawnCount ?? 1;
  const dps = (stats.damage / Math.max(0.5, stats.attackSpeed)) * count;
  const hp = stats.hp * count;
  const cat = type === BuildingType.MeleeSpawner ? 'melee'
    : type === BuildingType.RangedSpawner ? 'ranged' : 'caster';
  const abilityMult = UNIT_ABILITY_VALUE[race]?.[cat] ?? { survMult: 1, dmgMult: 1 };
  return (dps * abilityMult.dmgMult) + (hp * abilityMult.survMult) / 10;
}
