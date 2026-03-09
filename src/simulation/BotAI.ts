import {
  GameState, GameCommand, Race, BuildingType, Lane, Team,
  BUILD_GRID_COLS, BUILD_GRID_ROWS, HarvesterAssignment, HQ_HP,
  SHARED_ALLEY_COLS, SHARED_ALLEY_ROWS,
} from './types';
import { RACE_BUILDING_COSTS, RACE_UPGRADE_COSTS } from './data';

// --- Bot Difficulty System ---

export enum BotDifficultyLevel {
  Easy = 'easy',
  Medium = 'medium',
  Hard = 'hard',
  Nightmare = 'nightmare',
}

export interface BotDifficulty {
  /** Ticks between build decisions (higher = slower). Medium baseline: ~40 */
  buildSpeed: number;
  /** Ticks between upgrade checks (higher = slower). Medium baseline: ~60 */
  upgradeSpeed: number;
  /** Min spawner count before considering upgrades. 99 = never */
  upgradeThreshold: number;
  /** Min game minutes before bot will fire nuke */
  nukeMinTime: number;
  /** Lane IQ: 'random' = random picks, 'basic' = defend only, 'threat' = full analysis */
  laneIQ: 'random' | 'basic' | 'threat';
  /** Whether bot adapts build order to enemy race archetypes */
  counterBuild: boolean;
  /** Multiplier on urgency scaling (0 = no urgency, 1 = current, 2 = hyper-reactive) */
  urgencyMultiplier: number;
  /** Whether to use per-race optimized nightmare profiles */
  useNightmareProfiles: boolean;
}

export const BOT_DIFFICULTY_PRESETS: Record<BotDifficultyLevel, BotDifficulty> = {
  [BotDifficultyLevel.Easy]: {
    buildSpeed: 80,
    upgradeSpeed: 999999,
    upgradeThreshold: 99,
    nukeMinTime: 4.0,
    laneIQ: 'random',
    counterBuild: false,
    urgencyMultiplier: 0,
    useNightmareProfiles: false,
  },
  [BotDifficultyLevel.Medium]: {
    buildSpeed: 40,
    upgradeSpeed: 60,
    upgradeThreshold: 2,
    nukeMinTime: 1.5,
    laneIQ: 'threat',
    counterBuild: true,
    urgencyMultiplier: 1,
    useNightmareProfiles: false,
  },
  [BotDifficultyLevel.Hard]: {
    buildSpeed: 25,
    upgradeSpeed: 40,
    upgradeThreshold: 3,
    nukeMinTime: 1.0,
    laneIQ: 'threat',
    counterBuild: true,
    urgencyMultiplier: 1.5,
    useNightmareProfiles: false,
  },
  [BotDifficultyLevel.Nightmare]: {
    buildSpeed: 15,
    upgradeSpeed: 25,
    upgradeThreshold: 2,
    nukeMinTime: 0.5,
    laneIQ: 'threat',
    counterBuild: true,
    urgencyMultiplier: 2,
    useNightmareProfiles: true,
  },
};

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
  vsSwarmExtraCasters: number;
  vsTankExtraRanged: number;
  vsGlassCannonExtraMelee: number;
  maxHuts: number;
  pushThreshold: number;
}

// ======================================================================
// RACE STRATEGY ANALYSIS (DPS/cost, economy, optimal openers):
//
// CROWN (Gold economy, 200g start, 20g/s passive)
//   Expensive units (131g melee). Shield support is power spike.
//   Strategy: Econ-first, get 2 huts, then melee+caster. Shields win fights.
//   Don't rush — units too expensive. Invest in upgrades mid-game.
//   Diamond: YES (gold harvesters can pivot to center easily)
//
// HORDE (Gold+Stone, 200g/25s start, 20g/2s passive)
//   Best DPS/cost in game (Brute 12dps @ 60 total cost = 0.20 dps/$).
//   Strategy: Rush 2 melee immediately (20g+40s each), overwhelm early.
//   Minimal econ — just 1 hut, spend everything on melee pressure.
//   Diamond: YES (gold harvesters natural)
//
// GOBLINS (Gold+Wood, 200g/25w start, 20g/2w passive)
//   Cheap everything (46g melee, 53g ranged). Fast units (5.0 move).
//   Strategy: Spam buildings fast — 2 melee + 1 ranged before first hut.
//   Flood with quantity. Poison stacks from volume.
//   Diamond: YES (gold-based economy)
//
// OOZLINGS (Gold+Stone, 200g/25s start, 20g/2s passive)
//   Melee spawns 2 at 60g (0.33 dps/cost!). Pure swarm.
//   Strategy: Rush 3 melee spawners for 6 units/wave. Huts later.
//   Overwhelm with bodies, bloater caster for AOE support.
//   Diamond: SKIP until late (stone-needy, harvesters better on resources)
//
// DEMON (Stone+Wood, 0g/50w/150s start, 2w/20s passive)
//   Glass cannon: 15.6 dps melee @ 46 cost. Burns everything.
//   Strategy: Rush melee (14w+32s, very cheap with stone start).
//   Build 2 melee + 1 ranged fast, hut after. Pure aggression.
//   Diamond: SKIP (no gold economy, harvesters wasted on center gold)
//
// DEEP (Wood+Gold, 50g/150w start, 2g/20w passive)
//   Tankiest units (226hp melee) but slow (2.5 move). Wood-rich.
//   Strategy: Ranged first (30g+55w, affordable). Econ-heavy — 3 huts.
//   Build tower early for defense while economy ramps. Slow push late.
//   Diamond: SKIP (gold-poor, harvesters should gather wood)
//
// WILD (Wood+Stone, 0g/150w/50s start, 20w/2s passive)
//   Poison + aggression. Ranged decent (7dps @ 53 cost). No gold.
//   Strategy: Melee + ranged early (both cheap in wood). 2 huts.
//   Push early while poison stacks. Caster for AOE poison mid.
//   Diamond: SKIP (no gold economy)
//
// GEISTS (Stone+Gold, 50g/0w/150s start, 2g/20s passive)
//   Undying melee (125hp + lifesteal). Stone-heavy costs.
//   Strategy: Rush melee (20g+35s, cheap). Lifesteal = sustain.
//   2 melee early, 1 hut, ranged mid. Grind enemies down.
//   Diamond: SKIP until late (stone economy, center gives gold)
//
// TENDERS (Wood+Gold, 50g/150w start, 2g/20w passive)
//   Tanky healers (120hp melee + regen). Expensive (75 total melee).
//   Strategy: Econ-first — 2 huts then melee. Sustain = win long fights.
//   Push aggressively once army built. Regen means attrition favors you.
//   Diamond: SKIP (wood-based, gold-poor)
// ======================================================================

// Whether a race should send harvesters to mine diamond center
const RACE_LIKES_DIAMOND: Record<Race, boolean> = {
  [Race.Crown]: true,     // gold-based, diamond center = more gold
  [Race.Horde]: true,     // gold-based
  [Race.Goblins]: true,   // gold-based
  [Race.Oozlings]: false, // needs stone more than center gold
  [Race.Demon]: false,    // no gold economy at all
  [Race.Deep]: false,     // wood-primary, gold is secondary
  [Race.Wild]: false,     // no gold economy
  [Race.Geists]: false,   // stone-primary, gold is secondary
  [Race.Tenders]: false,  // wood-primary, gold is secondary
};

const RACE_PROFILES: Record<Race, RaceProfile> = {
  // CROWN: Econ-first, shields are the power spike. Expensive so invest in upgrades.
  [Race.Crown]: {
    earlyMelee: 1, earlyRanged: 0, earlyHuts: 2, earlyTowers: 0,
    midMelee: 2, midRanged: 1, midCasters: 2, midTowers: 1, midHuts: 4,
    lateTowers: 2, alleyTowers: 2,
    meleeUpgradeBias: 'B', rangedUpgradeBias: 'C', casterUpgradeBias: 'B', towerUpgradeBias: 'C',
    vsSwarmExtraCasters: 1, vsTankExtraRanged: 1, vsGlassCannonExtraMelee: 1,
    maxHuts: 5, pushThreshold: 1.3,
  },
  // HORDE: All-in rush. Brute is best DPS/cost in game. Minimal econ, max pressure.
  [Race.Horde]: {
    earlyMelee: 2, earlyRanged: 0, earlyHuts: 1, earlyTowers: 0,
    midMelee: 3, midRanged: 1, midCasters: 1, midTowers: 1, midHuts: 2,
    lateTowers: 2, alleyTowers: 2,
    meleeUpgradeBias: 'B', rangedUpgradeBias: 'C', casterUpgradeBias: 'C', towerUpgradeBias: 'B',
    vsSwarmExtraCasters: 1, vsTankExtraRanged: 1, vsGlassCannonExtraMelee: 0,
    maxHuts: 3, pushThreshold: 1.0,
  },
  // GOBLINS: Spam cheap buildings. Flood with quantity, poison from volume.
  [Race.Goblins]: {
    earlyMelee: 2, earlyRanged: 1, earlyHuts: 1, earlyTowers: 0,
    midMelee: 3, midRanged: 3, midCasters: 1, midTowers: 0, midHuts: 3,
    lateTowers: 1, alleyTowers: 2,
    meleeUpgradeBias: 'C', rangedUpgradeBias: 'C', casterUpgradeBias: 'C', towerUpgradeBias: 'C',
    vsSwarmExtraCasters: 0, vsTankExtraRanged: 1, vsGlassCannonExtraMelee: 1,
    maxHuts: 4, pushThreshold: 1.0,
  },
  // OOZLINGS: Rush 3 melee for 6 units/wave. Pure swarm, huts later.
  [Race.Oozlings]: {
    earlyMelee: 3, earlyRanged: 0, earlyHuts: 1, earlyTowers: 0,
    midMelee: 3, midRanged: 2, midCasters: 1, midTowers: 0, midHuts: 2,
    lateTowers: 1, alleyTowers: 2,
    meleeUpgradeBias: 'C', rangedUpgradeBias: 'C', casterUpgradeBias: 'C', towerUpgradeBias: 'C',
    vsSwarmExtraCasters: 0, vsTankExtraRanged: 1, vsGlassCannonExtraMelee: 0,
    maxHuts: 3, pushThreshold: 0.9,
  },
  // DEMON: Glass cannon rush. 2 melee + 1 ranged fast, burn everything down.
  [Race.Demon]: {
    earlyMelee: 2, earlyRanged: 1, earlyHuts: 1, earlyTowers: 0,
    midMelee: 2, midRanged: 2, midCasters: 1, midTowers: 1, midHuts: 2,
    lateTowers: 1, alleyTowers: 2,
    meleeUpgradeBias: 'C', rangedUpgradeBias: 'B', casterUpgradeBias: 'B', towerUpgradeBias: 'B',
    vsSwarmExtraCasters: 1, vsTankExtraRanged: 1, vsGlassCannonExtraMelee: 0,
    maxHuts: 3, pushThreshold: 1.0,
  },
  // DEEP: Econ-heavy, tower defense, slow push. Ranged first (wood-affordable).
  [Race.Deep]: {
    earlyMelee: 0, earlyRanged: 1, earlyHuts: 2, earlyTowers: 1,
    midMelee: 1, midRanged: 2, midCasters: 1, midTowers: 2, midHuts: 4,
    lateTowers: 3, alleyTowers: 3,
    meleeUpgradeBias: 'B', rangedUpgradeBias: 'C', casterUpgradeBias: 'C', towerUpgradeBias: 'C',
    vsSwarmExtraCasters: 1, vsTankExtraRanged: 1, vsGlassCannonExtraMelee: 0,
    maxHuts: 5, pushThreshold: 1.1,
  },
  // WILD: Aggressive poison. Push early while stacks accumulate. Caster mid.
  [Race.Wild]: {
    earlyMelee: 1, earlyRanged: 1, earlyHuts: 1, earlyTowers: 0,
    midMelee: 2, midRanged: 2, midCasters: 2, midTowers: 1, midHuts: 3,
    lateTowers: 2, alleyTowers: 2,
    meleeUpgradeBias: 'C', rangedUpgradeBias: 'B', casterUpgradeBias: 'C', towerUpgradeBias: 'C',
    vsSwarmExtraCasters: 1, vsTankExtraRanged: 0, vsGlassCannonExtraMelee: 1,
    maxHuts: 3, pushThreshold: 1.1,
  },
  // GEISTS: Rush cheap melee (lifesteal = sustain). Grind enemies down.
  [Race.Geists]: {
    earlyMelee: 2, earlyRanged: 0, earlyHuts: 1, earlyTowers: 0,
    midMelee: 3, midRanged: 1, midCasters: 1, midTowers: 1, midHuts: 3,
    lateTowers: 2, alleyTowers: 2,
    meleeUpgradeBias: 'B', rangedUpgradeBias: 'B', casterUpgradeBias: 'B', towerUpgradeBias: 'B',
    vsSwarmExtraCasters: 1, vsTankExtraRanged: 1, vsGlassCannonExtraMelee: 0,
    maxHuts: 3, pushThreshold: 1.1,
  },
  // TENDERS: Econ-first, tanky regen army. Push aggressively once built — sustain wins.
  [Race.Tenders]: {
    earlyMelee: 1, earlyRanged: 0, earlyHuts: 2, earlyTowers: 0,
    midMelee: 2, midRanged: 1, midCasters: 2, midTowers: 1, midHuts: 4,
    lateTowers: 2, alleyTowers: 3,
    meleeUpgradeBias: 'B', rangedUpgradeBias: 'C', casterUpgradeBias: 'B', towerUpgradeBias: 'C',
    vsSwarmExtraCasters: 1, vsTankExtraRanged: 1, vsGlassCannonExtraMelee: 0,
    maxHuts: 5, pushThreshold: 1.0,
  },
};

export { RACE_PROFILES };
export type { RaceProfile };

// --- Nightmare-optimized profiles (exploit best strategies per race) ---
const NIGHTMARE_PROFILES: Record<Race, RaceProfile> = {
  // Oozlings: all-in melee swarm, skip econ
  [Race.Oozlings]: {
    ...RACE_PROFILES[Race.Oozlings],
    earlyMelee: 4, earlyRanged: 0, earlyHuts: 0, earlyTowers: 0,
    midMelee: 4, midRanged: 2, midCasters: 1, midTowers: 0, midHuts: 1,
    maxHuts: 2, pushThreshold: 0.7,
  },
  // Horde: rush melee + ranged, minimal econ
  [Race.Horde]: {
    ...RACE_PROFILES[Race.Horde],
    earlyMelee: 3, earlyRanged: 1, earlyHuts: 0, earlyTowers: 0,
    midMelee: 4, midRanged: 2, midCasters: 1, midTowers: 0, midHuts: 1,
    maxHuts: 2, pushThreshold: 0.8,
  },
  // Demon: rush cheap melee + ranged, pure aggression
  [Race.Demon]: {
    ...RACE_PROFILES[Race.Demon],
    earlyMelee: 3, earlyRanged: 1, earlyHuts: 0, earlyTowers: 0,
    midMelee: 3, midRanged: 3, midCasters: 1, midTowers: 0, midHuts: 1,
    maxHuts: 2, pushThreshold: 0.8,
  },
  // Goblins: mass cheap spawners, flood with bodies
  [Race.Goblins]: {
    ...RACE_PROFILES[Race.Goblins],
    earlyMelee: 3, earlyRanged: 1, earlyHuts: 0, earlyTowers: 0,
    midMelee: 4, midRanged: 3, midCasters: 1, midTowers: 0, midHuts: 1,
    maxHuts: 2, pushThreshold: 0.8,
  },
  // Crown: balanced but invest in shield casters, upgrade for shields
  [Race.Crown]: {
    ...RACE_PROFILES[Race.Crown],
    earlyMelee: 2, earlyRanged: 0, earlyHuts: 1, earlyTowers: 0,
    midMelee: 3, midRanged: 2, midCasters: 2, midTowers: 1, midHuts: 3,
    maxHuts: 4, pushThreshold: 1.1,
  },
  // Geists: rush melee for lifesteal, then upgrade
  [Race.Geists]: {
    ...RACE_PROFILES[Race.Geists],
    earlyMelee: 3, earlyRanged: 0, earlyHuts: 1, earlyTowers: 0,
    midMelee: 3, midRanged: 2, midCasters: 1, midTowers: 1, midHuts: 2,
    maxHuts: 3, pushThreshold: 1.0,
  },
  // Deep: early tower + ranged, commit lanes at 5min
  [Race.Deep]: {
    ...RACE_PROFILES[Race.Deep],
    earlyMelee: 1, earlyRanged: 1, earlyHuts: 1, earlyTowers: 1,
    midMelee: 2, midRanged: 2, midCasters: 1, midTowers: 2, midHuts: 3,
    lateTowers: 3, alleyTowers: 4, maxHuts: 4, pushThreshold: 0.9,
  },
  // Wild: aggressive poison, commit lanes early
  [Race.Wild]: {
    ...RACE_PROFILES[Race.Wild],
    earlyMelee: 2, earlyRanged: 1, earlyHuts: 0, earlyTowers: 0,
    midMelee: 3, midRanged: 3, midCasters: 2, midTowers: 1, midHuts: 2,
    maxHuts: 3, pushThreshold: 0.8,
  },
  // Tenders: invest in upgrades, regen scales with quality
  [Race.Tenders]: {
    ...RACE_PROFILES[Race.Tenders],
    earlyMelee: 1, earlyRanged: 0, earlyHuts: 2, earlyTowers: 0,
    midMelee: 2, midRanged: 1, midCasters: 2, midTowers: 1, midHuts: 4,
    lateTowers: 3, alleyTowers: 3, maxHuts: 5, pushThreshold: 0.9,
  },
};

// Persistent per-bot state
export interface BotContext {
  lastChatTick: Record<number, number>;
  currentLane: Record<number, Lane>;
  lastPushTick: Record<number, number>;
  // Track last action ticks for staggered decisions
  lastBuildTick: Record<number, number>;
  lastUpgradeTick: Record<number, number>;
  lastHarvesterTick: Record<number, number>;
  // Nuke coordination: tick when bot declared "Nuking Now!", 0 = none
  nukeIntentTick: Record<number, number>;
  // Difficulty settings
  difficulty: Record<number, BotDifficulty>;
  defaultDifficulty: BotDifficulty;
}

export function createBotContext(
  difficulty: BotDifficultyLevel = BotDifficultyLevel.Medium,
): BotContext {
  return {
    lastChatTick: {}, currentLane: {}, lastPushTick: {},
    lastBuildTick: {}, lastUpgradeTick: {}, lastHarvesterTick: {},
    nukeIntentTick: {},
    difficulty: {},
    defaultDifficulty: BOT_DIFFICULTY_PRESETS[difficulty],
  };
}

// --- Enemy analysis ---

const SWARM_RACES: ReadonlySet<Race> = new Set([Race.Oozlings, Race.Goblins]);
const TANK_RACES: ReadonlySet<Race> = new Set([Race.Deep, Race.Tenders, Race.Crown]);
const GLASS_CANNON_RACES: ReadonlySet<Race> = new Set([Race.Demon, Race.Wild]);

function getEnemyRaces(state: GameState, playerId: number): Race[] {
  const myTeam = botTeam(playerId);
  return state.players
    .filter(p => p.team !== myTeam)
    .map(p => p.race);
}

function enemyHasArchetype(enemyRaces: Race[], archetype: ReadonlySet<Race>): boolean {
  return enemyRaces.some(r => archetype.has(r));
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

function getTeammateId(playerId: number): number {
  return playerId < 2 ? (playerId === 0 ? 1 : 0) : (playerId === 2 ? 3 : 2);
}

/** Total resource value available to spend */
function totalResources(state: GameState, playerId: number): number {
  const p = state.players[playerId];
  return p.gold + p.wood + p.stone;
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
  const diff = ctx.difficulty[playerId] ?? ctx.defaultDifficulty;
  const player = state.players[playerId];
  const profile = diff.useNightmareProfiles
    ? NIGHTMARE_PROFILES[player.race]
    : RACE_PROFILES[player.race];
  const myBuildings = state.buildings.filter(b => b.playerId === playerId);
  const meleeCount = myBuildings.filter(b => b.type === BuildingType.MeleeSpawner).length;
  const rangedCount = myBuildings.filter(b => b.type === BuildingType.RangedSpawner).length;
  const casterCount = myBuildings.filter(b => b.type === BuildingType.CasterSpawner).length;
  const towerCount = myBuildings.filter(b => b.type === BuildingType.Tower && b.buildGrid === 'military').length;
  const alleyTowerCount = myBuildings.filter(b => b.type === BuildingType.Tower && b.buildGrid === 'alley').length;
  const hutCount = myBuildings.filter(b => b.type === BuildingType.HarvesterHut).length;
  const enemyRaces = getEnemyRaces(state, playerId);

  const gameMinutes = state.tick / (20 * 60);
  const myTeam = botTeam(playerId);
  const myHqHp = state.hqHp[myTeam];
  const enemyHqHp = state.hqHp[botEnemyTeam(playerId)];

  // Urgency: faster decisions when losing or late game, scaled by difficulty
  const rawUrgency = myHqHp < HQ_HP * 0.4 ? 2 : gameMinutes > 5 ? 1.5 : 1;
  const urgency = 1 + (rawUrgency - 1) * diff.urgencyMultiplier;

  // 0. Place free tower immediately if we have none (every tick until placed)
  const totalTowers = towerCount + alleyTowerCount;
  if (totalTowers === 0) {
    botPlaceAlleyTower(state, playerId, emit);
  }

  // 1. Build order — interval scaled by difficulty
  const buildInterval = Math.max(15, Math.floor((diff.buildSpeed + playerId * 5) / urgency));
  if (state.tick - (ctx.lastBuildTick[playerId] ?? 0) >= buildInterval) {
    const totalSpawners = meleeCount + rangedCount + casterCount;
    let built = false;
    if (totalSpawners === 0 && gameMinutes > 0.3) {
      built = botBuildAffordable(state, playerId, [BuildingType.MeleeSpawner, BuildingType.RangedSpawner, BuildingType.CasterSpawner], myBuildings, emit);
    } else if (hutCount === 0 && gameMinutes > 0.3 && botCanAffordHut(state, playerId, hutCount)) {
      emit({ type: 'build_hut', playerId }); built = true;
    } else {
      built = botDoBuildOrder(state, playerId, profile, myBuildings,
        meleeCount, rangedCount, casterCount, towerCount, alleyTowerCount, hutCount,
        gameMinutes, enemyRaces, diff, emit);
    }
    if (built) ctx.lastBuildTick[playerId] = state.tick;
  }

  // 2. Upgrades — gated by difficulty threshold
  const upgradeInterval = Math.max(20, Math.floor((diff.upgradeSpeed + playerId * 8) / urgency));
  if (state.tick - (ctx.lastUpgradeTick[playerId] ?? 0) >= upgradeInterval) {
    if (botUpgradeBuildings(state, playerId, player.race, profile, myBuildings, enemyRaces, gameMinutes, diff, emit)) {
      ctx.lastUpgradeTick[playerId] = state.tick;
    }
  }

  // 3. Lane management — quality scaled by difficulty
  botEvaluateLanes(state, ctx, playerId, myTeam, profile, myBuildings, gameMinutes, diff, emit);

  // 4. Harvesters — check every ~3 seconds
  const harvInterval = Math.max(40, Math.floor(60 / urgency));
  if (state.tick - (ctx.lastHarvesterTick[playerId] ?? 0) >= harvInterval) {
    botManageHarvesters(state, playerId, player, gameMinutes, emit);
    ctx.lastHarvesterTick[playerId] = state.tick;
  }

  // 5. Nuke — telegraph with "Nuking Now!" then fire after a half-beat
  if (state.tick % 20 === playerId * 5) {
    const nukeMinTime = myHqHp < HQ_HP * 0.5 ? Math.min(0.5, diff.nukeMinTime) : diff.nukeMinTime;
    if (player.nukeAvailable && gameMinutes > nukeMinTime) {
      botNukeWithTelegraph(state, ctx, playerId, myTeam, myHqHp, emit);
    } else {
      // Clear stale intent if nuke is no longer available
      ctx.nukeIntentTick[playerId] = 0;
    }
  }

  // 6. Quick chat
  botQuickChat(state, ctx, playerId, myHqHp, enemyHqHp, gameMinutes, emit);
}

// ==================== BUILD ORDER ====================

/** Try to build any of the given types that are affordable */
function botBuildAffordable(
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

function botDoBuildOrder(
  state: GameState, playerId: number, profile: RaceProfile,
  myBuildings: GameState['buildings'],
  meleeCount: number, rangedCount: number, casterCount: number,
  towerCount: number, alleyTowerCount: number, hutCount: number,
  gameMinutes: number, enemyRaces: Race[], diff: BotDifficulty, emit: Emit,
): boolean {
  const vsSwarm = diff.counterBuild && enemyHasArchetype(enemyRaces, SWARM_RACES);
  const vsTank = diff.counterBuild && enemyHasArchetype(enemyRaces, TANK_RACES);
  const vsGlass = diff.counterBuild && enemyHasArchetype(enemyRaces, GLASS_CANNON_RACES);

  const extraCasters = vsSwarm ? profile.vsSwarmExtraCasters : 0;
  const extraRanged = vsTank ? profile.vsTankExtraRanged : 0;
  const extraMelee = vsGlass ? profile.vsGlassCannonExtraMelee : 0;

  // Resource-aware: try multiple options, pick the one we can actually afford
  const tryBuild = (type: BuildingType): boolean => {
    if (botCanAfford(state, playerId, type)) {
      botPlaceBuilding(state, playerId, type, myBuildings, emit);
      return true;
    }
    return false;
  };

  const tryHut = (): boolean => {
    if (botCanAffordHut(state, playerId, hutCount)) {
      emit({ type: 'build_hut', playerId });
      return true;
    }
    return false;
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
    // If we need spawners but can't afford the preferred type, try any spawner
    const totalSpawnersNow = meleeCount + rangedCount + casterCount;
    if (totalSpawnersNow < 2) {
      for (const [type, ,] of needs) {
        if (tryBuild(type)) return true;
      }
    }

    if (hutCount < profile.midHuts && hutCount < profile.maxHuts && tryHut()) return true;
    if (towerCount < profile.midTowers && tryBuild(BuildingType.Tower)) return true;
    if (alleyTowerCount < 1 && botCanAfford(state, playerId, BuildingType.Tower)) {
      if (botPlaceAlleyTower(state, playerId, emit)) return true;
    }
    return false;
  }

  // Late game
  if (alleyTowerCount < profile.alleyTowers && botCanAfford(state, playerId, BuildingType.Tower)) {
    if (botPlaceAlleyTower(state, playerId, emit)) return true;
  }
  if (towerCount < profile.lateTowers && tryBuild(BuildingType.Tower)) return true;
  if (hutCount < profile.maxHuts && tryHut()) return true;

  const totalMilitary = meleeCount + rangedCount + casterCount + towerCount;
  if (totalMilitary < BUILD_GRID_COLS * BUILD_GRID_ROWS) {
    const lateCasterTarget = 2 + extraCasters;
    if (casterCount < lateCasterTarget && tryBuild(BuildingType.CasterSpawner)) return true;

    // Pick based on ratio and enemy
    let preferType: BuildingType;
    if (vsTank && rangedCount <= meleeCount) {
      preferType = BuildingType.RangedSpawner;
    } else if (vsGlass && meleeCount <= rangedCount) {
      preferType = BuildingType.MeleeSpawner;
    } else {
      preferType = meleeCount <= rangedCount ? BuildingType.MeleeSpawner : BuildingType.RangedSpawner;
    }
    if (tryBuild(preferType)) return true;
    const altType = preferType === BuildingType.MeleeSpawner ? BuildingType.RangedSpawner : BuildingType.MeleeSpawner;
    if (tryBuild(altType)) return true;
    // If we have resources but can't afford melee/ranged, try caster
    if (totalResources(state, playerId) > 50 && tryBuild(BuildingType.CasterSpawner)) return true;
  }

  // Very late: fill alley with towers
  if (gameMinutes > 7 && alleyTowerCount < SHARED_ALLEY_COLS * SHARED_ALLEY_ROWS
      && botCanAfford(state, playerId, BuildingType.Tower)) {
    if (botPlaceAlleyTower(state, playerId, emit)) return true;
  }
  return false;
}

function botPlaceBuilding(
  state: GameState, playerId: number, type: BuildingType,
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
    // Towers in center for coverage
    const centerX = Math.floor(BUILD_GRID_COLS / 2);
    freeSlots.sort((a, b) => Math.abs(a.gx - centerX) - Math.abs(b.gx - centerX) || a.gy - b.gy);
    slot = freeSlots[0];
  } else {
    // Spawners: spread across grid for resilience
    slot = freeSlots[Math.floor(state.rng() * freeSlots.length)];
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
  // Place near lane paths (center columns) for maximum coverage
  const centerX = Math.floor(SHARED_ALLEY_COLS / 2);
  freeSlots.sort((a, b) => Math.abs(a.gx - centerX) - Math.abs(b.gx - centerX) || a.gy - b.gy);
  const idx = Math.min(Math.floor(state.rng() * 3), freeSlots.length - 1);
  const slot = freeSlots[idx];
  emit({ type: 'place_building', playerId, buildingType: BuildingType.Tower, gridX: slot.gx, gridY: slot.gy, gridType: 'alley' });
  return true;
}

// ==================== UPGRADES ====================

function botUpgradeBuildings(
  state: GameState, playerId: number, race: Race, profile: RaceProfile,
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
      const isSpawnerA = a.type !== BuildingType.Tower;
      const isSpawnerB = b.type !== BuildingType.Tower;
      if (gameMinutes < 6 && isSpawnerA !== isSpawnerB) return isSpawnerA ? -1 : 1;
      if (isSpawnerA && isSpawnerB && a.type !== b.type) {
        const countA = typeCounts[a.type] ?? 0;
        const countB = typeCounts[b.type] ?? 0;
        if (countA !== countB) return countB - countA;
      }
      if (a.upgradePath.length !== b.upgradePath.length) return a.upgradePath.length - b.upgradePath.length;
      return a.placedTick - b.placedTick;
    });

  for (const b of upgradeable) {
    const raceCosts = RACE_UPGRADE_COSTS[player.race];
    const cost = b.upgradePath.length === 1 ? raceCosts.tier1 : raceCosts.tier2;
    if (player.gold < cost.gold || player.wood < cost.wood || player.stone < cost.stone) continue;

    // Don't spend all resources on upgrades if we need buildings
    const resAfter = (player.gold - cost.gold) + (player.wood - cost.wood) + (player.stone - cost.stone);
    if (gameMinutes < 3 && resAfter < 30 && spawnerCount < 3) continue;

    const choice = botPickUpgrade(state, b, profile, race, enemyRaces);
    emit({ type: 'purchase_upgrade', playerId, buildingId: b.id, choice });
    return true;
  }
  return false;
}

function botPickUpgrade(
  state: GameState, building: GameState['buildings'][0], profile: RaceProfile, race: Race,
  enemyRaces: Race[],
): string {
  const deviate = state.rng() < 0.1;
  const vsTank = enemyHasArchetype(enemyRaces, TANK_RACES);
  const vsSwarm = enemyHasArchetype(enemyRaces, SWARM_RACES);

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

  // Tier 2
  if (building.upgradePath[1] === 'B') {
    let choice: string;
    if (vsTank) choice = 'E';
    else if (vsSwarm) choice = 'D';
    else {
      const preferOffense = race === Race.Demon || race === Race.Wild || race === Race.Goblins || race === Race.Oozlings;
      choice = preferOffense ? 'E' : 'D';
    }
    if (deviate) choice = choice === 'D' ? 'E' : 'D';
    return choice;
  } else {
    let choice: string;
    if (vsTank) choice = 'G';
    else if (vsSwarm) choice = 'F';
    else {
      const preferUtility = race === Race.Crown || race === Race.Deep || race === Race.Tenders;
      choice = preferUtility ? 'F' : 'G';
    }
    if (deviate) choice = choice === 'F' ? 'G' : 'F';
    return choice;
  }
}

// ==================== LANE MANAGEMENT ====================

function botEvaluateLanes(
  state: GameState, ctx: BotContext, playerId: number, myTeam: Team,
  profile: RaceProfile, myBuildings: GameState['buildings'],
  gameMinutes: number, diff: BotDifficulty, emit: Emit,
): void {
  // Faster lane checks (every ~4-5 seconds, urgency-scaled)
  const myHqHp = state.hqHp[myTeam];
  const urgency = myHqHp < HQ_HP * 0.4 ? 2 : 1;
  const laneInterval = Math.max(40, Math.floor((80 + playerId * 10) / urgency));
  if (state.tick % laneInterval !== 0) return;

  // Random lane IQ: just pick a random lane occasionally
  if (diff.laneIQ === 'random') {
    const spawners = myBuildings.filter(b =>
      b.type === BuildingType.MeleeSpawner ||
      b.type === BuildingType.RangedSpawner ||
      b.type === BuildingType.CasterSpawner
    );
    if (spawners.length === 0) return;
    if (state.rng() < 0.15) {
      const lane = state.rng() < 0.5 ? Lane.Left : Lane.Right;
      if (lane !== spawners[0].lane) {
        emit({ type: 'toggle_all_lanes', playerId, lane });
        ctx.currentLane[playerId] = lane;
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

  const teammateId = getTeammateId(playerId);
  const teammateLane = ctx.currentLane[teammateId] ?? null;

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

  // PROACTIVE: push weaker lane when strong enough
  if (targetLane === null && totalMyUnits >= 3) {
    const overallRatio = (myTotalStr + 1) / (enemyTotalStr + 1);

    if (overallRatio > profile.pushThreshold) {
      const lastPush = ctx.lastPushTick[playerId] ?? 0;
      const pushCooldown = 200; // 10 seconds cooldown

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

  // STALL-BREAKER: after 7 min, both teammates commit to same lane to force a win
  if (targetLane === null && gameMinutes > 7) {
    const enemyHqHp = state.hqHp[botEnemyTeam(playerId)];
    if (enemyHqHp > HQ_HP * 0.3) {
      // Pick the lane with less enemy resistance
      const commitLane = enemyLeftStr <= enemyRightStr ? Lane.Left : Lane.Right;
      if (currentLane !== commitLane) targetLane = commitLane;
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

function botManageHarvesters(
  state: GameState, playerId: number, player: GameState['players'][0],
  gameMinutes: number, emit: Emit,
): void {
  const myHarvesters = state.harvesters.filter(h => h.playerId === playerId);
  if (myHarvesters.length === 0) return;

  const diamondExposed = state.diamond.exposed;
  const goldCellsRemaining = state.diamondCells.filter(c => c.gold > 0).length;
  const goldMostlyMined = goldCellsRemaining < state.diamondCells.length * 0.3;

  // Determine primary/secondary resource based on actual building costs
  const race = player.race;
  const costs = RACE_BUILDING_COSTS[race];
  let totalGoldNeed = 0, totalWoodNeed = 0, totalStoneNeed = 0;
  for (const type of [BuildingType.MeleeSpawner, BuildingType.RangedSpawner, BuildingType.CasterSpawner, BuildingType.Tower]) {
    const c = costs[type];
    totalGoldNeed += c.gold;
    totalWoodNeed += c.wood;
    totalStoneNeed += c.stone;
  }
  // Rank resources by total need across building types
  const resNeeds: [HarvesterAssignment, number][] = [
    [HarvesterAssignment.BaseGold, totalGoldNeed],
    [HarvesterAssignment.Wood, totalWoodNeed],
    [HarvesterAssignment.Stone, totalStoneNeed],
  ];
  resNeeds.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  // Primary = most needed, secondary = second most needed (skip zero-need resources)
  const primaryRes = resNeeds[0][1] > 0 ? resNeeds[0][0] : HarvesterAssignment.BaseGold;
  const secondaryRes = resNeeds[1][1] > 0 ? resNeeds[1][0] : resNeeds[0][0];

  const resOf = (a: HarvesterAssignment): number => {
    if (a === HarvesterAssignment.BaseGold || a === HarvesterAssignment.Center) return player.gold;
    if (a === HarvesterAssignment.Wood) return player.wood;
    return player.stone;
  };

  const primaryAmt = resOf(primaryRes);
  const secondaryAmt = resOf(secondaryRes);
  // Dynamic rebalancing: if one resource is overflowing, shift harvesters
  const primaryStarved = primaryAmt < 30 && secondaryAmt > 60;
  const secondaryStarved = secondaryAmt < 30 && primaryAmt > 60;
  const primaryOverflow = primaryAmt > 200 && secondaryAmt < 50;
  const secondaryOverflow = secondaryAmt > 200 && primaryAmt < 50;

  for (let i = 0; i < myHarvesters.length; i++) {
    const h = myHarvesters[i];
    let desired: HarvesterAssignment;

    if (i < 2) {
      // First two harvesters: primary resource (or secondary if starved/overflowing)
      if (primaryStarved || primaryOverflow) desired = secondaryRes;
      else desired = primaryRes;
    } else if (i < 3) {
      // Third: secondary resource (or primary if secondary starved/overflowing)
      if (secondaryStarved || secondaryOverflow) desired = primaryRes;
      else desired = secondaryRes;
    } else if (i === 3) {
      // Fourth: balance or diamond (only if race wants diamond)
      const likesDiamond = RACE_LIKES_DIAMOND[race];
      if (likesDiamond && gameMinutes > 3 && !diamondExposed) {
        desired = HarvesterAssignment.Center;
      } else if (primaryAmt <= secondaryAmt) {
        desired = primaryRes;
      } else {
        desired = secondaryRes;
      }
    } else {
      // Fifth+: diamond focus (only if race likes diamond, otherwise alternate resources)
      const likesDiamond = RACE_LIKES_DIAMOND[race];
      if (likesDiamond && (diamondExposed || gameMinutes > 4)) {
        desired = HarvesterAssignment.Center;
      } else if (goldMostlyMined || !likesDiamond) {
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

/** Telegraph "Nuking Now!" then fire after a delay. Coordinates with teammate to avoid double-nuke. */
function botNukeWithTelegraph(
  state: GameState, ctx: BotContext, playerId: number, myTeam: Team, myHqHp: number, emit: Emit,
): void {
  const TELEGRAPH_DELAY = 10; // ~0.5s at 20 tps

  const intentTick = ctx.nukeIntentTick[playerId] ?? 0;

  if (intentTick === 0) {
    // Phase 1: Announce intent — check if we actually have a target first
    if (!botHasNukeTarget(state, playerId, myTeam, myHqHp)) return;

    // Check if teammate already declared intent recently
    const teammate = getTeammateId(playerId);
    const teammateIntent = ctx.nukeIntentTick[teammate] ?? 0;
    if (teammateIntent > 0 && state.tick - teammateIntent < TELEGRAPH_DELAY + 20) {
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

  // Check if teammate declared intent AFTER us — if so, we yield
  const teammate = getTeammateId(playerId);
  const teammateIntent = ctx.nukeIntentTick[teammate] ?? 0;
  if (teammateIntent > 0 && teammateIntent > intentTick) {
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
function botHasNukeTarget(state: GameState, playerId: number, myTeam: Team, myHqHp: number): boolean {
  const enemyTeam = botEnemyTeam(playerId);
  const minY = myTeam === Team.Bottom ? 35 : 0;
  const maxY = myTeam === Team.Bottom ? 120 : 85;
  const enemyUnits = state.units.filter(u => u.team === enemyTeam && u.y >= minY && u.y <= maxY);

  // Diamond carrier is always worth nuking
  if (state.units.some(u => u.team === enemyTeam && u.carryingDiamond)) return true;
  if (state.harvesters.some(h => h.team === enemyTeam && h.carryingDiamond)) return true;

  if (enemyUnits.length < 2) return false;

  // HQ defense
  const hqX = 40;
  const hqY = myTeam === Team.Bottom ? 105 : 12;
  if (myHqHp < HQ_HP * 0.5) {
    const nearHq = enemyUnits.filter(u => {
      const dx = u.x - hqX; const dy = u.y - hqY;
      return dx * dx + dy * dy < 25 * 25;
    });
    if (nearHq.length >= 2) return true;
  }

  // Large cluster
  if (enemyUnits.length >= 4) return true;

  return false;
}

function botFireNuke(state: GameState, playerId: number, myTeam: Team, myHqHp: number, emit: Emit): void {
  const enemyTeam = botEnemyTeam(playerId);
  const minY = myTeam === Team.Bottom ? 35 : 0;
  const maxY = myTeam === Team.Bottom ? 120 : 85;
  const enemyUnits = state.units.filter(
    u => u.team === enemyTeam && u.y >= minY && u.y <= maxY
  );

  // Priority 1: Nuke diamond carriers
  const carrier = state.units.find(u => u.team === enemyTeam && u.carryingDiamond);
  if (carrier) {
    emit({ type: 'fire_nuke', playerId, x: carrier.x, y: carrier.y });
    return;
  }
  const harvCarrier = state.harvesters.find(h => h.team === enemyTeam && h.carryingDiamond);
  if (harvCarrier) {
    emit({ type: 'fire_nuke', playerId, x: harvCarrier.x, y: harvCarrier.y });
    return;
  }

  if (enemyUnits.length < 2) return;

  // Priority 2: HQ defense
  const hqX = 40;
  const hqY = myTeam === Team.Bottom ? 105 : 12;
  const hqInDanger = myHqHp < HQ_HP * 0.5;

  const nearHqEnemies = enemyUnits.filter(u => {
    const dx = u.x - hqX;
    const dy = u.y - hqY;
    return dx * dx + dy * dy < 25 * 25;
  });

  if (hqInDanger && nearHqEnemies.length >= 2) {
    const target = findBestNukeTarget(nearHqEnemies);
    if (target) { emit({ type: 'fire_nuke', playerId, x: target.x, y: target.y }); return; }
  }

  // Priority 3: Large cluster
  if (enemyUnits.length >= 4) {
    const target = findBestNukeTarget(enemyUnits);
    if (target) { emit({ type: 'fire_nuke', playerId, x: target.x, y: target.y }); }
  }
}

function findBestNukeTarget(units: GameState['units']): { x: number; y: number } | null {
  if (units.length < 2) return null;
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
    let totalHp = 0;
    for (const u of units) {
      const dx = u.x - anchor.x;
      const dy = u.y - anchor.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > radiusSq) continue;
      count++;
      weightedDist += Math.sqrt(d2);
      sumX += u.x;
      sumY += u.y;
      totalHp += u.hp;
    }
    if (count === 0) continue;
    // Score: value = units killed * their HP (high-value targets), penalize spread
    const score = count * 50 + totalHp * 0.5 - weightedDist;
    if (score > bestScore) {
      bestScore = score;
      bestCount = count;
      bestX = sumX / count;
      bestY = sumY / count;
    }
  }
  if (bestCount < 2) return null;
  return { x: bestX, y: bestY };
}

// ==================== QUICK CHAT ====================

function botQuickChat(
  state: GameState, ctx: BotContext, playerId: number,
  myHqHp: number, _enemyHqHp: number, gameMinutes: number, emit: Emit,
): void {
  const lastChat = ctx.lastChatTick[playerId] ?? 0;
  if (state.tick - lastChat < 600) return;
  if (state.rng() > 0.2) return;

  let message: string | null = null;
  if (myHqHp < HQ_HP * 0.5) {
    message = 'Defend';
  } else if (state.diamond.exposed && state.diamond.state === 'exposed' && gameMinutes > 3) {
    message = 'Get Diamond';
  } else if (state.rng() < 0.3) {
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
