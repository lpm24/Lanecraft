/**
 * BotAI.ts — Thin orchestrator for the bot AI subsystem.
 *
 * Creates bot context, runs per-tick AI for all bot players, and re-exports
 * all public types/functions so external consumers can import from this single module.
 *
 * Part of the simulation layer — must remain fully deterministic.
 */

import {
  GameState, BuildingType, HQ_HP, HQ_WIDTH, HQ_HEIGHT, TICK_RATE,
  isAbilityBuilding,
} from './types';
import {
  BotDifficultyLevel, BOT_DIFFICULTY_PRESETS,
  BotContext, RACE_PROFILES,
  Emit, selectCompositionProfile,
} from './BotProfiles';
import {
  getEnemyRaces, botTeam, botEnemyTeam,
  botCanAffordTower, botCanAffordHut,
  createBotIntelligence, botUpdateIntelligence, botPlanResources,
} from './BotIntelligence';
import {
  botBuildAffordable, botValueBasedBuild, botDoBuildOrder,
  botPlaceAlleyTower, botUpgradeBuildings, botEvaluateLanes,
  botManageHarvesters, botNukeWithTelegraph, botQuickChat,
  botUseAbility, botManageResearch,
} from './BotDecisions';
import { getHQPosition } from './SimLayout';

export function createBotContext(
  difficulty: BotDifficultyLevel = BotDifficultyLevel.Medium,
): BotContext {
  return {
    lastChatTick: {}, currentLane: {}, lastPushTick: {},
    lastBuildTick: {}, lastUpgradeTick: {}, lastHarvesterTick: {},
    lastLaneTick: {}, nukeIntentTick: {}, lastResearchTick: {},
    difficulty: {},
    defaultDifficulty: BOT_DIFFICULTY_PRESETS[difficulty],
    intelligence: {},
    selectedProfile: {},
  };
}

// --- Main entry point ---

export function runAllBotAI(state: GameState, ctx: BotContext, emit: Emit): void {
  for (const player of state.players) {
    if (!player.isBot) continue;
    if (state.matchPhase !== 'playing') continue;
    runSingleBotAI(state, ctx, player.id, emit);
  }
}

function runSingleBotAI(state: GameState, ctx: BotContext, playerId: number, emit: Emit): void {
  const diff = ctx.difficulty[playerId] ?? ctx.defaultDifficulty;
  const player = state.players[playerId];
  const enemyRaces = getEnemyRaces(state, playerId);

  // Select composition profile once per bot (first tick), then cache it
  if (!ctx.selectedProfile[playerId] && !ctx.profileOverride?.[playerId]) {
    ctx.selectedProfile[playerId] = selectCompositionProfile(
      player.race, diff, enemyRaces, () => state.rng(),
    );
  }
  const profile = ctx.profileOverride?.[playerId]
    ?? ctx.selectedProfile[playerId]
    ?? RACE_PROFILES[player.race];

  // Single-pass building count (replaces 7 separate .filter() calls)
  const myBuildings: typeof state.buildings = [];
  let meleeCount = 0, rangedCount = 0, casterCount = 0;
  let towerCount = 0, alleyTowerCount = 0, hutCount = 0;
  for (const b of state.buildings) {
    if (b.playerId !== playerId) continue;
    myBuildings.push(b);
    switch (b.type) {
      case BuildingType.MeleeSpawner: meleeCount++; break;
      case BuildingType.RangedSpawner: rangedCount++; break;
      case BuildingType.CasterSpawner: casterCount++; break;
      case BuildingType.Tower:
        if (isAbilityBuilding(b)) break;
        if (b.buildGrid === 'military') towerCount++;
        else if (b.buildGrid === 'alley' && !b.isSeed) alleyTowerCount++;
        break;
      case BuildingType.HarvesterHut: hutCount++; break;
    }
  }

  const gameMinutes = state.tick / (20 * 60);
  const myTeam = botTeam(playerId, state);
  const myHqHp = state.hqHp[myTeam];
  const enemyHqHp = state.hqHp[botEnemyTeam(playerId, state)];

  // --- Intelligence system: initialize and update ---
  if (!ctx.intelligence[playerId]) {
    ctx.intelligence[playerId] = createBotIntelligence(enemyRaces);
    // Stagger initial ticks per bot so 7 bots don't all fire analysis on the same tick
    ctx.intelligence[playerId].lastAnalysisTick = -(playerId * 6);
    ctx.intelligence[playerId].lastResourcePlanTick = -(playerId * 6);
  }
  const intel = ctx.intelligence[playerId];

  // Run analysis every ~2 seconds (40 ticks), staggered per bot to spread CPU load.
  // Each bot still runs at the same frequency — the offset just prevents all 7 bots
  // from firing on the same tick. State is identical at any point within a tick.
  const analysisInterval = 40;
  if (state.tick - intel.lastAnalysisTick >= analysisInterval) {
    botUpdateIntelligence(state, ctx, playerId);
  }

  // Update resource plan every ~2-3 seconds (faster for nightmare)
  const resourcePlanInterval = diff.useValueFunction ? 40 : 60;
  if (state.tick - intel.lastResourcePlanTick >= resourcePlanInterval) {
    intel.resourcePlan = botPlanResources(state, playerId, profile, myBuildings, gameMinutes, intel);
    intel.lastResourcePlanTick = state.tick;
  }

  // Urgency: faster decisions when losing or late game
  const urgency = myHqHp < HQ_HP * 0.4 ? 2 : gameMinutes > 5 ? 1.5 : 1;

  // 0. Place free tower immediately if we have none (every tick until placed)
  const totalTowers = towerCount + alleyTowerCount;
  if (totalTowers === 0) {
    botPlaceAlleyTower(state, playerId, emit);
  }

  // 1. Build order — speed and caps differ by difficulty
  const buildInterval = Math.max(15, Math.floor(diff.buildSpeed / urgency));
  if (state.tick - (ctx.lastBuildTick[playerId] ?? 0) >= buildInterval) {
    const totalSpawners = meleeCount + rangedCount + casterCount;
    const atSpawnerCap = totalSpawners >= diff.maxSpawners;
    const atHutCap = hutCount >= diff.maxHuts;
    let built = false;

    // Mistake rate: occasionally skip build decisions entirely
    if (diff.mistakeRate > 0 && state.rng() < diff.mistakeRate * 0.5) {
      // Do nothing — simulates inattention
    } else if (atSpawnerCap && atHutCap) {
      // At all caps — only towers possible
      if (towerCount + alleyTowerCount < 3 && botCanAffordTower(state, playerId, towerCount + alleyTowerCount)) {
        built = botPlaceAlleyTower(state, playerId, emit);
      }
    } else if (totalSpawners === 0 && gameMinutes > 0.3) {
      built = botBuildAffordable(state, playerId, [BuildingType.MeleeSpawner, BuildingType.RangedSpawner, BuildingType.CasterSpawner], myBuildings, emit);
    } else if (hutCount === 0 && gameMinutes > 0.3 && !atHutCap && botCanAffordHut(state, playerId, hutCount)) {
      emit({ type: 'build_hut', playerId }); built = true;
    } else if (diff.useValueFunction) {
      built = botValueBasedBuild(state, ctx, playerId, profile, myBuildings,
        meleeCount, rangedCount, casterCount, towerCount, alleyTowerCount, hutCount,
        gameMinutes, enemyRaces, diff, emit);
    } else {
      built = botDoBuildOrder(state, ctx, playerId, profile, myBuildings,
        meleeCount, rangedCount, casterCount, towerCount, alleyTowerCount, hutCount,
        gameMinutes, enemyRaces, diff, emit);
    }
    if (built) ctx.lastBuildTick[playerId] = state.tick;
  }

  // 2. Upgrades — gated by difficulty threshold
  // When useValueFunction is true, upgrades are already competed inside botValueBasedBuild.
  // Running botUpgradeBuildings separately would double-drain resources (especially bad for
  // multi-resource races like Horde where upgrades cost all 3 resources simultaneously).
  if (!diff.useValueFunction) {
    const upgradeInterval = Math.max(20, Math.floor(diff.upgradeSpeed / urgency));
    if (state.tick - (ctx.lastUpgradeTick[playerId] ?? 0) >= upgradeInterval) {
      if (botUpgradeBuildings(state, ctx, playerId, profile, myBuildings, enemyRaces, gameMinutes, diff, emit)) {
        ctx.lastUpgradeTick[playerId] = state.tick;
      }
    }
  }

  // 3. Lane management — quality scaled by difficulty
  botEvaluateLanes(state, ctx, playerId, myTeam, profile, myBuildings, gameMinutes, diff, emit);

  // 3.5. Race ability — check every 2 seconds (Easy bots skip)
  if (diff.laneIQ !== 'random' && state.tick % 40 === 0) {
    botUseAbility(state, playerId, emit);
  }

  // 3.6. Research upgrades
  // Nightmare: handled inside botValueBasedBuild (unified value function)
  // Hard: handled inside botUpgradeBuildings (compared against building upgrades)
  // Medium: simple timer-based (45s, attack only, army/econ first)
  // Easy: never
  if (!diff.useValueFunction && diff.laneIQ !== 'random') {
    // Medium only: no value function yet, but still allowed to buy timer-based research.
    const researchInterval = 45 * TICK_RATE;
    if (state.tick - (ctx.lastResearchTick[playerId] ?? 0) >= researchInterval) {
      botManageResearch(state, ctx, playerId, player, diff, emit);
      ctx.lastResearchTick[playerId] = state.tick;
    }
  }

  // 4. Harvesters — check every ~2-3 seconds (faster for nightmare)
  const baseHarvInterval = diff.useValueFunction ? 40 : 60;
  const harvInterval = Math.max(30, Math.floor(baseHarvInterval / urgency));
  if (state.tick - (ctx.lastHarvesterTick[playerId] ?? 0) >= harvInterval) {
    botManageHarvesters(state, ctx, playerId, player, myBuildings, gameMinutes, emit);
    ctx.lastHarvesterTick[playerId] = state.tick;
  }

  // 5. Nuke — telegraph with "Nuking Now!" then fire after a half-beat
  if (state.tick % 20 === 0) {
    const nukeMinTime = myHqHp < HQ_HP * 0.5 ? Math.min(0.5, diff.nukeMinTime) : diff.nukeMinTime;
    // Defensive-only bots hold nuke until enemies are pushing near their HQ
    let nukeAllowed = true;
    if (diff.nukeDefensiveOnly && myHqHp >= HQ_HP * 0.6) {
      const hq = getHQPosition(myTeam, state.mapDef);
      const hqCX = hq.x + HQ_WIDTH / 2;
      const hqCY = hq.y + HQ_HEIGHT / 2;
      const pushRadius = 28;
      const pushRadiusSq = pushRadius * pushRadius;
      const enemyTeam = botEnemyTeam(playerId, state);
      const enemiesNearHQ = state.units.filter(u =>
        u.team === enemyTeam && (u.x - hqCX) ** 2 + (u.y - hqCY) ** 2 <= pushRadiusSq
      ).length;
      nukeAllowed = enemiesNearHQ >= 3;
    }
    if (nukeAllowed && player.nukeAvailable && gameMinutes > nukeMinTime) {
      botNukeWithTelegraph(state, ctx, playerId, myTeam, myHqHp, emit);
    } else {
      // Clear stale intent if nuke is no longer available
      ctx.nukeIntentTick[playerId] = 0;
    }
  }

  // 6. Quick chat
  botQuickChat(state, ctx, playerId, myHqHp, enemyHqHp, gameMinutes, emit);
}

// ==================== RE-EXPORTS FOR BACKWARD COMPATIBILITY ====================
// External consumers import from BotAI.ts — these re-exports ensure no import changes needed.

export {
  BotDifficultyLevel, BOT_DIFFICULTY_PRESETS,
  RACE_PROFILES, getCompositionProfiles,
  selectCompositionProfile,
} from './BotProfiles';
export type {
  BotDifficulty, BotContext, BotIntelligence, RaceProfile, ProfileId, Emit,
} from './BotProfiles';
export { UNIT_ABILITY_VALUE } from './BotIntelligence';
