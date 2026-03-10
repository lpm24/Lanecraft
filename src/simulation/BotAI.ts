import {
  GameState, GameCommand, Race, BuildingType, Lane, Team, HQ_WIDTH, HQ_HEIGHT,
  BUILD_GRID_COLS, BUILD_GRID_ROWS, HarvesterAssignment, HQ_HP,
  SHARED_ALLEY_COLS, SHARED_ALLEY_ROWS,
} from './types';
import { RACE_BUILDING_COSTS, RACE_UPGRADE_COSTS, UPGRADE_TREES, UpgradeNodeDef, UNIT_STATS } from './data';
import { getHQPosition } from './GameState';

// --- Bot Difficulty System ---

export enum BotDifficultyLevel {
  Easy = 'easy',
  Medium = 'medium',
  Hard = 'hard',
  Nightmare = 'nightmare',
}

export interface BotDifficulty {
  /** Ticks between build decisions. All difficulties use same baseline (25). */
  buildSpeed: number;
  /** Ticks between upgrade checks. All difficulties use same baseline (30). */
  upgradeSpeed: number;
  /** Min spawner count before considering upgrades. 99 = never */
  upgradeThreshold: number;
  /** Min game minutes before bot will fire nuke. 99 = never */
  nukeMinTime: number;
  /** Lane IQ: 'random' = random picks, 'basic' = defend only, 'threat' = full analysis */
  laneIQ: 'random' | 'basic' | 'threat';
  /** Whether bot adapts build order to enemy race archetypes */
  counterBuild: boolean;
  /** Whether bot uses value function to decide build vs upgrade vs hut */
  useValueFunction: boolean;
  /** Whether bot dynamically shifts build ratios based on combat telemetry */
  useDynamicShift: boolean;
  /** Whether bot uses matchup-aware upgrade scoring (vs fixed race bias) */
  useSmartUpgrades: boolean;
  /** Whether to use per-race optimized nightmare profiles */
  useNightmareProfiles: boolean;
  /** Chance to make a suboptimal random decision (0 = perfect, 1 = fully random) */
  mistakeRate: number;
  /** Max total spawners (melee+ranged+caster) the bot will build. 99 = unlimited */
  maxSpawners: number;
  /** Max harvester huts the bot will build. 99 = unlimited */
  maxHuts: number;
}

export const BOT_DIFFICULTY_PRESETS: Record<BotDifficultyLevel, BotDifficulty> = {
  // Easy: capped army, slow builds, no upgrades/nukes — clearly inferior economy & army
  [BotDifficultyLevel.Easy]: {
    buildSpeed: 60,           // 3 seconds between builds
    upgradeSpeed: 999999,     // never upgrades
    upgradeThreshold: 99,
    nukeMinTime: 99,          // never nukes
    laneIQ: 'random',
    counterBuild: false,
    useValueFunction: false,
    useDynamicShift: false,
    useSmartUpgrades: false,
    useNightmareProfiles: false,
    mistakeRate: 0.10,
    maxSpawners: 3,           // hard cap: only 3 spawners total
    maxHuts: 2,               // hard cap: only 2 huts
  },
  // Medium: moderate caps, moderate speed, no upgrades
  [BotDifficultyLevel.Medium]: {
    buildSpeed: 35,           // 1.75 seconds between builds
    upgradeSpeed: 999999,     // no upgrades — army mass wins over upgrades
    upgradeThreshold: 99,
    nukeMinTime: 4.0,
    laneIQ: 'basic',
    counterBuild: false,
    useValueFunction: false,
    useDynamicShift: false,
    useSmartUpgrades: false,
    useNightmareProfiles: false,
    mistakeRate: 0.03,
    maxSpawners: 5,           // moderate cap: 5 spawners
    maxHuts: 4,               // moderate cap: 4 huts
  },
  // Hard: moderate caps, fast builds, no upgrades, nukes
  [BotDifficultyLevel.Hard]: {
    buildSpeed: 25,           // 1.25 seconds between builds
    upgradeSpeed: 999999,     // no upgrades — pure army advantage
    upgradeThreshold: 99,
    nukeMinTime: 2.0,
    laneIQ: 'threat',
    counterBuild: false,
    useValueFunction: false,
    useDynamicShift: false,
    useSmartUpgrades: false,
    useNightmareProfiles: false,
    mistakeRate: 0,
    maxSpawners: 6,           // high cap: 6 spawners
    maxHuts: 5,               // high cap: 5 huts
  },
  // Nightmare: unlimited, fastest builds, massive economy, no upgrades
  [BotDifficultyLevel.Nightmare]: {
    buildSpeed: 10,           // 0.5 seconds between builds — relentless
    upgradeSpeed: 999999,     // no upgrades — pure army mass
    upgradeThreshold: 99,
    nukeMinTime: 1.0,
    laneIQ: 'threat',
    counterBuild: false,
    useValueFunction: false,
    useDynamicShift: false,
    useSmartUpgrades: false,
    useNightmareProfiles: false,  // standard profiles — nightmare profiles hurt in testing
    mistakeRate: 0,
    maxSpawners: 99,          // unlimited
    maxHuts: 8,               // more huts = economy advantage over hard
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
  // Track last action ticks for decisions
  lastBuildTick: Record<number, number>;
  lastUpgradeTick: Record<number, number>;
  lastHarvesterTick: Record<number, number>;
  lastLaneTick: Record<number, number>;
  // Nuke coordination: tick when bot declared "Nuking Now!", 0 = none
  nukeIntentTick: Record<number, number>;
  // Difficulty settings
  difficulty: Record<number, BotDifficulty>;
  defaultDifficulty: BotDifficulty;
  // Intelligence system
  intelligence: Record<number, BotIntelligence>;
}

// ==================== BOT INTELLIGENCE SYSTEM ====================

/** Per-category combat performance snapshot */
interface CategoryPerf {
  alive: number;
  avgHpPct: number;
  totalKills: number;
  buildingCount: number;
}

/** Forward-looking resource projection */
interface ResourceProjection {
  totalGoldNeeded: number;
  totalWoodNeeded: number;
  totalStoneNeeded: number;
  goldIncome: number;
  woodIncome: number;
  stoneIncome: number;
  goldSecsToTarget: number;
  woodSecsToTarget: number;
  stoneSecsToTarget: number;
  bottleneck: HarvesterAssignment;
  /** Ideal harvester split: [gold, wood, stone, center] */
  idealSplit: [number, number, number, number];
}

/** Threat profile of enemy team — drives counter-building and upgrade selection */
interface ThreatProfile {
  hasSwarm: boolean;    // Oozlings, Goblins
  hasTanks: boolean;    // Deep, Tenders, Crown
  hasBurst: boolean;    // Demon, Horde
  hasBurn: boolean;     // Demon, Wild, Goblins
  hasSustain: boolean;  // Geists, Tenders
  hasControl: boolean;  // Deep, Wild (slow)
  primaryThreat: 'swarm' | 'tank' | 'burst' | 'burn' | 'sustain' | 'control';
  // Counter recommendations for upgrade selection
  wantAoE: boolean;       // vs swarm: splash, multishot, cleave
  wantBurn: boolean;      // vs tanks/sustain: burn through HP, blight disables regen
  wantTank: boolean;      // vs burst: survive the alpha strike
  wantDPS: boolean;       // vs tanks: raw damage to chew through HP
  wantRange: boolean;     // vs melee-heavy or slow: kite and outrange
  wantShields: boolean;   // vs burn: shields absorb before HP
  wantCleanse: boolean;   // vs burn/slow: remove debuffs
  wantSpeed: boolean;     // vs slow/control: dodge the cc
}

/** Real-time intelligence state per bot */
export interface BotIntelligence {
  // Combat telemetry per unit category
  myPerf: Record<'melee' | 'ranged' | 'caster', CategoryPerf>;
  enemyPerf: Record<'melee' | 'ranged' | 'caster', CategoryPerf>;

  // Dynamic build ratio adjustments (-2 to +2 per category)
  buildShift: { melee: number; ranged: number; caster: number };

  // Threat assessment
  threats: ThreatProfile;

  // Resource planning
  resourcePlan: ResourceProjection | null;

  // Strategic state
  armyAdvantage: number;     // >1 = we outmatch them, <1 = they outmatch us
  armyValueMy: number;       // total army value (hp * dps)
  armyValueEnemy: number;
  gamePhase: 'opening' | 'early' | 'mid' | 'late';
  strategy: 'rush' | 'balanced' | 'turtle' | 'greed';
  effectiveCategory: 'melee' | 'ranged' | 'caster' | null; // what's working best
  weakCategory: 'melee' | 'ranged' | 'caster' | null;      // what's dying fastest

  // Enemy scouting
  enemyBuildingCounts: { melee: number; ranged: number; caster: number; tower: number; hut: number };
  enemyAvgUpgradeTier: number;

  // Analysis timing
  lastAnalysisTick: number;
  lastResourcePlanTick: number;

  // Death tracking between snapshots
  prevMyUnitIds: Set<number>;
  categoryDeaths: Record<'melee' | 'ranged' | 'caster', number>;
  categorySpawned: Record<'melee' | 'ranged' | 'caster', number>;
}

function emptyPerf(): Record<'melee' | 'ranged' | 'caster', CategoryPerf> {
  return {
    melee: { alive: 0, avgHpPct: 1, totalKills: 0, buildingCount: 0 },
    ranged: { alive: 0, avgHpPct: 1, totalKills: 0, buildingCount: 0 },
    caster: { alive: 0, avgHpPct: 1, totalKills: 0, buildingCount: 0 },
  };
}

function createBotIntelligence(enemyRaces: Race[]): BotIntelligence {
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
    lastAnalysisTick: 0,
    lastResourcePlanTick: 0,
    prevMyUnitIds: new Set(),
    categoryDeaths: { melee: 0, ranged: 0, caster: 0 },
    categorySpawned: { melee: 0, ranged: 0, caster: 0 },
  };
}

// --- Passive income rates per race (per second) ---
const PASSIVE_RATES: Record<Race, { gold: number; wood: number; stone: number }> = {
  [Race.Crown]:    { gold: 1,   wood: 0.1, stone: 0 },
  [Race.Horde]:    { gold: 1,   wood: 0,   stone: 0.1 },
  [Race.Goblins]:  { gold: 1,   wood: 0.1, stone: 0 },
  [Race.Oozlings]: { gold: 1,   wood: 0,   stone: 0.1 },
  [Race.Demon]:    { gold: 0,   wood: 0.1, stone: 1 },
  [Race.Deep]:     { gold: 0.1, wood: 1,   stone: 0 },
  [Race.Wild]:     { gold: 0,   wood: 1,   stone: 0.1 },
  [Race.Geists]:   { gold: 0.1, wood: 0,   stone: 1 },
  [Race.Tenders]:  { gold: 0.1, wood: 1,   stone: 0 },
};

// --- Race threat classifications ---
const RACE_TRAITS: Record<Race, { archetype: string[]; appliesBurn: boolean; appliesSlow: boolean }> = {
  [Race.Crown]:    { archetype: ['tank', 'balanced'], appliesBurn: false, appliesSlow: false },
  [Race.Horde]:    { archetype: ['burst', 'tank'],    appliesBurn: false, appliesSlow: false },
  [Race.Goblins]:  { archetype: ['swarm', 'burn'],    appliesBurn: true,  appliesSlow: true },
  [Race.Oozlings]: { archetype: ['swarm'],            appliesBurn: false, appliesSlow: false },
  [Race.Demon]:    { archetype: ['burst', 'burn'],    appliesBurn: true,  appliesSlow: false },
  [Race.Deep]:     { archetype: ['tank', 'control'],  appliesBurn: false, appliesSlow: true },
  [Race.Wild]:     { archetype: ['burn', 'burst'],    appliesBurn: true,  appliesSlow: true },
  [Race.Geists]:   { archetype: ['sustain'],          appliesBurn: true,  appliesSlow: false },
  [Race.Tenders]:  { archetype: ['sustain', 'tank'],  appliesBurn: false, appliesSlow: true },
};

function assessThreatProfile(enemyRaces: Race[]): ThreatProfile {
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
  };
}

// ==================== INTELLIGENCE ANALYSIS ====================

/** Runs every ~2 seconds. Updates combat telemetry, army assessment, game phase, strategy. */
function botUpdateIntelligence(
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

  // --- Combat telemetry: scan all units ---
  const myPerf = emptyPerf();
  const enemyPerf = emptyPerf();
  const currentMyIds = new Set<number>();

  for (const u of state.units) {
    const cat = u.category as 'melee' | 'ranged' | 'caster';
    if (u.team === myTeam) {
      const p = myPerf[cat];
      p.alive++;
      p.avgHpPct += u.hp / u.maxHp;
      p.totalKills += u.kills;
      currentMyIds.add(u.id);
    } else {
      const p = enemyPerf[cat];
      p.alive++;
      p.avgHpPct += u.hp / u.maxHp;
      p.totalKills += u.kills;
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

  // Building counts for my side
  const myBuildings = state.buildings.filter(b => b.playerId === playerId);
  myPerf.melee.buildingCount = myBuildings.filter(b => b.type === BuildingType.MeleeSpawner).length;
  myPerf.ranged.buildingCount = myBuildings.filter(b => b.type === BuildingType.RangedSpawner).length;
  myPerf.caster.buildingCount = myBuildings.filter(b => b.type === BuildingType.CasterSpawner).length;

  // Enemy building scouting
  const enemyTeam = botEnemyTeam(playerId, state);
  const enemyBuildings = state.buildings.filter(b => botTeam(b.playerId, state) === enemyTeam);
  intel.enemyBuildingCounts = {
    melee: enemyBuildings.filter(b => b.type === BuildingType.MeleeSpawner).length,
    ranged: enemyBuildings.filter(b => b.type === BuildingType.RangedSpawner).length,
    caster: enemyBuildings.filter(b => b.type === BuildingType.CasterSpawner).length,
    tower: enemyBuildings.filter(b => b.type === BuildingType.Tower).length,
    hut: enemyBuildings.filter(b => b.type === BuildingType.HarvesterHut).length,
  };
  const upgTiers = enemyBuildings
    .filter(b => b.type !== BuildingType.HarvesterHut)
    .map(b => Math.max(0, b.upgradePath.length - 1));
  intel.enemyAvgUpgradeTier = upgTiers.length > 0 ? upgTiers.reduce((a, b) => a + b, 0) / upgTiers.length : 0;

  intel.myPerf = myPerf;
  intel.enemyPerf = enemyPerf;

  // --- Army advantage ---
  // Army value = sum of (hp * dps) for all units, where dps = damage / attackSpeed
  let myValue = 0, enemyValue = 0;
  for (const u of state.units) {
    const dps = u.damage / Math.max(0.5, u.attackSpeed);
    const value = u.hp * dps;
    if (u.team === myTeam) myValue += value;
    else enemyValue += value;
  }
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

    // Counter enemy composition
    const ec = intel.enemyBuildingCounts;
    const enemyTotal = ec.melee + ec.ranged + ec.caster;
    if (enemyTotal > 0) {
      // Enemy is melee-heavy → ranged is strong
      if (ec.melee / enemyTotal > 0.5) shift.ranged += 1;
      // Enemy is ranged-heavy → melee to rush or towers to tank
      if (ec.ranged / enemyTotal > 0.5) shift.melee += 1;
      // Enemy has lots of towers → don't feed units into them, go ranged/caster
      if (ec.tower >= 3) { shift.ranged += 1; shift.melee -= 1; }
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

  intel.lastAnalysisTick = state.tick;
}

// ==================== FORWARD-LOOKING RESOURCE PLANNING ====================

/** Build a shopping list of upcoming purchases and project resource needs vs income. */
function botPlanResources(
  state: GameState, playerId: number, profile: RaceProfile,
  myBuildings: GameState['buildings'], gameMinutes: number,
  intel: BotIntelligence,
): ResourceProjection {
  const player = state.players[playerId];
  const race = player.race;
  const costs = RACE_BUILDING_COSTS[race];
  const upgCosts = RACE_UPGRADE_COSTS[race];

  const meleeCount = myBuildings.filter(b => b.type === BuildingType.MeleeSpawner).length;
  const rangedCount = myBuildings.filter(b => b.type === BuildingType.RangedSpawner).length;
  const casterCount = myBuildings.filter(b => b.type === BuildingType.CasterSpawner).length;
  const hutCount = myBuildings.filter(b => b.type === BuildingType.HarvesterHut).length;
  const towerCount = myBuildings.filter(b => b.type === BuildingType.Tower).length;

  // --- Build shopping list: next 3-4 purchases ---
  const list: { gold: number; wood: number; stone: number }[] = [];

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
    const mult = Math.pow(1.35, Math.max(0, hutCount));
    const hutCost = costs[BuildingType.HarvesterHut];
    list.push({
      gold: Math.floor(hutCost.gold * mult),
      wood: Math.floor(hutCost.wood * mult),
      stone: Math.floor(hutCost.stone * mult),
    });
  }

  // Queue upgrade costs for next 1-2 upgradeable buildings
  const upgradeable = myBuildings
    .filter(b => b.type !== BuildingType.HarvesterHut && b.upgradePath.length > 0 && b.upgradePath.length < 3);
  for (let i = 0; i < Math.min(2, upgradeable.length); i++) {
    const tier = upgradeable[i].upgradePath.length === 1 ? upgCosts.tier1 : upgCosts.tier2;
    list.push(tier);
  }

  // Tower if strategy calls for it
  if (intel.strategy === 'turtle' && towerCount < profile.lateTowers) {
    list.push(costs[BuildingType.Tower]);
  }

  // Sum next 3-4 items on list
  let totalGold = 0, totalWood = 0, totalStone = 0;
  const lookahead = Math.min(4, list.length);
  for (let i = 0; i < lookahead; i++) {
    totalGold += list[i].gold;
    totalWood += list[i].wood;
    totalStone += list[i].stone;
  }

  // Deficits (what we need minus what we have)
  const goldNeeded = Math.max(0, totalGold - player.gold);
  const woodNeeded = Math.max(0, totalWood - player.wood);
  const stoneNeeded = Math.max(0, totalStone - player.stone);

  // --- Estimate income ---
  const passive = PASSIVE_RATES[race];
  const HARVESTER_RATE = 1.6; // ~8 resources per trip, ~5s round trip
  const harvesters = state.harvesters.filter(h => h.playerId === playerId);
  let goldH = 0, woodH = 0, stoneH = 0;
  for (const h of harvesters) {
    if (h.assignment === HarvesterAssignment.BaseGold || h.assignment === HarvesterAssignment.Center) goldH++;
    else if (h.assignment === HarvesterAssignment.Wood) woodH++;
    else stoneH++;
  }

  const goldIncome = passive.gold + goldH * HARVESTER_RATE;
  const woodIncome = passive.wood + woodH * HARVESTER_RATE;
  const stoneIncome = passive.stone + stoneH * HARVESTER_RATE;

  // Time to afford each resource
  const goldSecs = goldIncome > 0.01 ? goldNeeded / goldIncome : (goldNeeded > 0 ? 999 : 0);
  const woodSecs = woodIncome > 0.01 ? woodNeeded / woodIncome : (woodNeeded > 0 ? 999 : 0);
  const stoneSecs = stoneIncome > 0.01 ? stoneNeeded / stoneIncome : (stoneNeeded > 0 ? 999 : 0);

  // Bottleneck = resource with longest time-to-afford
  let bottleneck = HarvesterAssignment.BaseGold;
  let maxTime = goldSecs;
  if (woodSecs > maxTime) { bottleneck = HarvesterAssignment.Wood; maxTime = woodSecs; }
  if (stoneSecs > maxTime) { bottleneck = HarvesterAssignment.Stone; maxTime = stoneSecs; }

  // --- Calculate ideal harvester split ---
  // Distribute harvesters proportional to resource deficit, not current stockpiles
  const totalDeficit = goldNeeded + woodNeeded + stoneNeeded;
  const totalHarvesters = harvesters.length;
  let idealGold = 0, idealWood = 0, idealStone = 0, idealCenter = 0;

  if (totalDeficit > 0 && totalHarvesters > 0) {
    const goldPct = goldNeeded / totalDeficit;
    const woodPct = woodNeeded / totalDeficit;
    const stonePct = stoneNeeded / totalDeficit;

    // Assign harvesters proportionally, minimum 1 per needed resource
    idealGold = Math.max(goldNeeded > 10 ? 1 : 0, Math.round(goldPct * totalHarvesters));
    idealWood = Math.max(woodNeeded > 10 ? 1 : 0, Math.round(woodPct * totalHarvesters));
    idealStone = Math.max(stoneNeeded > 10 ? 1 : 0, Math.round(stonePct * totalHarvesters));

    // If race likes diamond and game is late enough, dedicate 1 to center
    if (RACE_LIKES_DIAMOND[race] && gameMinutes > 3 && totalHarvesters >= 3) {
      idealCenter = 1;
    }

    // Normalize to total harvesters
    const total = idealGold + idealWood + idealStone + idealCenter;
    if (total > totalHarvesters) {
      // Scale down proportionally, keep center if assigned
      const scale = (totalHarvesters - idealCenter) / Math.max(1, idealGold + idealWood + idealStone);
      idealGold = Math.round(idealGold * scale);
      idealWood = Math.round(idealWood * scale);
      idealStone = totalHarvesters - idealGold - idealWood - idealCenter;
    } else if (total < totalHarvesters) {
      // Extra harvesters go to bottleneck
      const extra = totalHarvesters - total;
      if (bottleneck === HarvesterAssignment.Wood) idealWood += extra;
      else if (bottleneck === HarvesterAssignment.Stone) idealStone += extra;
      else idealGold += extra;
    }
  } else if (totalHarvesters > 0) {
    // No deficit — distribute based on what race needs most (from building costs)
    const totalCosts = costs[BuildingType.MeleeSpawner];
    const costTotal = totalCosts.gold + totalCosts.wood + totalCosts.stone;
    if (costTotal > 0) {
      idealGold = Math.max(1, Math.round((totalCosts.gold / costTotal) * totalHarvesters));
      idealWood = Math.max(totalCosts.wood > 0 ? 1 : 0, Math.round((totalCosts.wood / costTotal) * totalHarvesters));
      idealStone = totalHarvesters - idealGold - idealWood;
    } else {
      idealGold = totalHarvesters;
    }
  }

  return {
    totalGoldNeeded: totalGold, totalWoodNeeded: totalWood, totalStoneNeeded: totalStone,
    goldIncome, woodIncome, stoneIncome,
    goldSecsToTarget: goldSecs, woodSecsToTarget: woodSecs, stoneSecsToTarget: stoneSecs,
    bottleneck,
    idealSplit: [idealGold, idealWood, idealStone, idealCenter],
  };
}

// ==================== UPGRADE INTELLIGENCE ====================

/** Score an upgrade node based on how well its mechanics counter the enemy. */
function scoreUpgradeNode(
  race: Race, buildingType: BuildingType, node: string, threats: ThreatProfile,
): number {
  const tree = UPGRADE_TREES[race]?.[buildingType];
  if (!tree) return 0;
  const nodeDef = tree[node as keyof typeof tree] as UpgradeNodeDef | undefined;
  if (!nodeDef) return 0;

  let score = 5; // base score — all upgrades have some value
  const s = nodeDef.special;

  // Raw stat multipliers always have value
  if (nodeDef.hpMult) score += (nodeDef.hpMult - 1) * 10;
  if (nodeDef.damageMult) score += (nodeDef.damageMult - 1) * 10;
  if (nodeDef.attackSpeedMult && nodeDef.attackSpeedMult < 1) score += (1 - nodeDef.attackSpeedMult) * 15;
  if (nodeDef.moveSpeedMult) score += (nodeDef.moveSpeedMult - 1) * 5;
  if (nodeDef.rangeMult) score += (nodeDef.rangeMult - 1) * 8;

  if (!s) return score;

  // Score specials based on what we WANT vs enemy composition
  // AoE mechanics are gold vs swarm
  if (threats.wantAoE) {
    if (s.splashRadius) score += 8;
    if (s.multishotCount) score += 6 * s.multishotCount;
    if (s.cleaveTargets) score += 7 * s.cleaveTargets;
    if (s.aoeRadiusBonus) score += 5;
    if (s.extraChainTargets) score += 5 * s.extraChainTargets;
  }

  // Burn is excellent vs tanks and sustain (blight disables regen)
  if (threats.wantBurn) {
    if (s.extraBurnStacks) score += 6 * s.extraBurnStacks;
  }

  // Tankiness vs burst and burn
  if (threats.wantTank) {
    if (s.damageReductionPct) score += s.damageReductionPct * 30;
    if (s.regenPerSec) score += s.regenPerSec * 3;
    if (s.reviveHpPct) score += 8;
    if (s.dodgeChance) score += s.dodgeChance * 20;
  }

  // DPS vs tanks
  if (threats.wantDPS) {
    if (s.knockbackEveryN) score += 3; // disruption has value
    if (s.guaranteedHaste) score += 4;
  }

  // Range vs control/tanks
  if (threats.wantRange) {
    if (s.towerRangeBonus) score += s.towerRangeBonus * 3;
  }

  // Shields vs burn/burst
  if (threats.wantShields) {
    if (s.shieldTargetBonus) score += 5 * s.shieldTargetBonus;
    if (s.shieldAbsorbBonus) score += 3;
  }

  // Cleanse vs burn/slow
  if (threats.wantCleanse) {
    if (s.healBonus) score += s.healBonus * 2;
  }

  // Speed vs slow/control
  if (threats.wantSpeed) {
    if (s.guaranteedHaste) score += 6;
    if (s.hopAttack) score += 5; // leap past slow zones
  }

  // Slow is always valuable for control (extra slow stacks)
  if (s.extraSlowStacks) score += 3 * s.extraSlowStacks;

  // Lifesteal / heal is always decent
  if (s.healBonus) score += 2;

  return score;
}

export function createBotContext(
  difficulty: BotDifficultyLevel = BotDifficultyLevel.Medium,
): BotContext {
  return {
    lastChatTick: {}, currentLane: {}, lastPushTick: {},
    lastBuildTick: {}, lastUpgradeTick: {}, lastHarvesterTick: {},
    lastLaneTick: {}, nukeIntentTick: {},
    difficulty: {},
    defaultDifficulty: BOT_DIFFICULTY_PRESETS[difficulty],
    intelligence: {},
  };
}

// --- Enemy analysis ---

const SWARM_RACES: ReadonlySet<Race> = new Set([Race.Oozlings, Race.Goblins]);
const TANK_RACES: ReadonlySet<Race> = new Set([Race.Deep, Race.Tenders, Race.Crown]);
const GLASS_CANNON_RACES: ReadonlySet<Race> = new Set([Race.Demon, Race.Wild]);

function getEnemyRaces(state: GameState, playerId: number): Race[] {
  const myTeam = botTeam(playerId, state);
  return state.players
    .filter(p => p.team !== myTeam)
    .map(p => p.race);
}

function enemyHasArchetype(enemyRaces: Race[], archetype: ReadonlySet<Race>): boolean {
  return enemyRaces.some(r => archetype.has(r));
}

// --- Helpers ---

function botTeam(playerId: number, state?: GameState): Team {
  if (state?.mapDef) {
    const slot = state.mapDef.playerSlots[playerId];
    if (slot) return slot.teamIndex as Team;
  }
  return playerId < 2 ? Team.Bottom : Team.Top;
}

function botEnemyTeam(playerId: number, state?: GameState): Team {
  const myTeam = botTeam(playerId, state);
  return myTeam === Team.Bottom ? Team.Top : Team.Bottom;
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

function getTeammateIds(playerId: number, state?: GameState): number[] {
  if (state?.mapDef) {
    const myTeam = botTeam(playerId, state);
    return state.players
      .filter(p => p.team === myTeam && p.id !== playerId)
      .map(p => p.id);
  }
  // Legacy 4-player fallback
  return [playerId < 2 ? (playerId === 0 ? 1 : 0) : (playerId === 2 ? 3 : 2)];
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
  const myTeam = botTeam(playerId, state);
  const myHqHp = state.hqHp[myTeam];
  const enemyHqHp = state.hqHp[botEnemyTeam(playerId, state)];

  // --- Intelligence system: initialize and update ---
  if (!ctx.intelligence[playerId]) {
    ctx.intelligence[playerId] = createBotIntelligence(enemyRaces);
  }
  const intel = ctx.intelligence[playerId];

  // Run analysis every ~2 seconds (40 ticks) — no per-player stagger to avoid asymmetry
  const analysisInterval = 40;
  if (state.tick - intel.lastAnalysisTick >= analysisInterval) {
    botUpdateIntelligence(state, ctx, playerId);
  }

  // Update resource plan every ~3 seconds (60 ticks)
  const resourcePlanInterval = 60;
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
      if (towerCount + alleyTowerCount < 3 && botCanAfford(state, playerId, BuildingType.Tower)) {
        botPlaceBuilding(state, playerId, BuildingType.Tower, myBuildings, emit);
        built = true;
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
  const upgradeInterval = Math.max(20, Math.floor(diff.upgradeSpeed / urgency));
  if (state.tick - (ctx.lastUpgradeTick[playerId] ?? 0) >= upgradeInterval) {
    if (botUpgradeBuildings(state, ctx, playerId, player.race, profile, myBuildings, enemyRaces, gameMinutes, diff, emit)) {
      ctx.lastUpgradeTick[playerId] = state.tick;
    }
  }

  // 3. Lane management — quality scaled by difficulty
  botEvaluateLanes(state, ctx, playerId, myTeam, profile, myBuildings, gameMinutes, diff, emit);

  // 4. Harvesters — check every ~3 seconds
  const harvInterval = Math.max(40, Math.floor(60 / urgency));
  if (state.tick - (ctx.lastHarvesterTick[playerId] ?? 0) >= harvInterval) {
    botManageHarvesters(state, ctx, playerId, player, myBuildings, gameMinutes, emit);
    ctx.lastHarvesterTick[playerId] = state.tick;
  }

  // 5. Nuke — telegraph with "Nuking Now!" then fire after a half-beat
  if (state.tick % 20 === 0) {
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
function botValueBasedBuild(
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

  // Calculate DPS value per spawner type
  const spawnerValue = (type: BuildingType): number => {
    const stats = UNIT_STATS[race]?.[type];
    if (!stats) return 0;
    const dps = (stats.damage / stats.attackSpeed) * (stats.spawnCount ?? 1);
    const hp = stats.hp * (stats.spawnCount ?? 1);
    const cost = costs[type];
    const totalCost = cost.gold + cost.wood + cost.stone;
    if (totalCost === 0) return 0;
    // Value = combat power per resource. hp/10 normalizes HP contribution.
    return (dps + hp / 10) / totalCost;
  };

  // Calculate upgrade value: how much does this upgrade multiply existing output?
  const upgradeValue = (building: GameState['buildings'][0]): { value: number; choice: string } => {
    const raceCosts = RACE_UPGRADE_COSTS[race];
    const tier = building.upgradePath.length === 1 ? raceCosts.tier1 : raceCosts.tier2;
    const totalCost = tier.gold + tier.wood + tier.stone;
    if (totalCost === 0) return { value: 0, choice: 'B' };
    if (player.gold < tier.gold || player.wood < tier.wood || player.stone < tier.stone) {
      return { value: 0, choice: 'B' };
    }

    const choice = botPickUpgrade(state, ctx, building, profile, race, enemyRaces, diff);
    const tree = UPGRADE_TREES[race]?.[building.type];
    if (!tree) return { value: 0, choice };
    const nodeDef = tree[choice as keyof typeof tree] as UpgradeNodeDef | undefined;
    if (!nodeDef) return { value: 0, choice };

    // Upgrade value = total multiplier improvement normalized by cost
    const hpGain = (nodeDef.hpMult ?? 1) - 1;
    const dmgGain = (nodeDef.damageMult ?? 1) - 1;
    const spdGain = nodeDef.attackSpeedMult ? (1 - nodeDef.attackSpeedMult) : 0;
    const specialBonus = nodeDef.special ? 0.15 : 0; // specials have inherent value
    const totalGain = hpGain * 0.4 + dmgGain * 0.8 + spdGain * 1.0 + specialBonus;

    return { value: totalGain * 10 / totalCost, choice };
  };

  // Calculate hut value: economic ROI diminished by escalating cost
  const hutValue = (): number => {
    if (hutCount >= profile.maxHuts) return 0;
    if (!botCanAffordHut(state, playerId, hutCount)) return 0;
    const hutCost = costs[BuildingType.HarvesterHut];
    const mult = Math.pow(1.35, Math.max(0, hutCount));
    const totalCost = Math.floor(hutCost.gold * mult) + Math.floor(hutCost.wood * mult) + Math.floor(hutCost.stone * mult);
    if (totalCost === 0) return 0;
    // Hut value = income per resource invested, decays with game time (less time to ROI)
    const timeMultiplier = Math.max(0.2, 1 - gameMinutes / 10);
    return (1.6 * timeMultiplier) / totalCost * 100;
  };

  // Score all options
  interface BuildOption {
    action: 'spawner' | 'upgrade' | 'hut' | 'tower' | 'alley_tower';
    value: number;
    type?: BuildingType;
    building?: GameState['buildings'][0];
    upgradeChoice?: string;
  }

  const options: BuildOption[] = [];

  // Spawner options
  const spawnerTypes = [BuildingType.MeleeSpawner, BuildingType.RangedSpawner, BuildingType.CasterSpawner];
  for (const type of spawnerTypes) {
    if (botCanAfford(state, playerId, type)) {
      const sv = spawnerValue(type);
      // Apply dynamic shift bonus
      const shift = (diff.useDynamicShift && intel?.buildShift) ? intel.buildShift : { melee: 0, ranged: 0, caster: 0 };
      const cat = type === BuildingType.MeleeSpawner ? 'melee' : type === BuildingType.RangedSpawner ? 'ranged' : 'caster';
      const shiftBonus = Math.max(0, shift[cat]) * 0.02;
      options.push({ action: 'spawner', value: sv + shiftBonus, type });
    }
  }

  // Upgrade options (only if we have enough spawners)
  const spawnerCount = meleeCount + rangedCount + casterCount;
  if (spawnerCount >= diff.upgradeThreshold) {
    const upgradeable = myBuildings
      .filter(b => b.type !== BuildingType.HarvesterHut && b.upgradePath.length > 0 && b.upgradePath.length < 3);
    for (const b of upgradeable) {
      const uv = upgradeValue(b);
      if (uv.value > 0) {
        options.push({ action: 'upgrade', value: uv.value, building: b, upgradeChoice: uv.choice });
      }
    }
  }

  // Hut option
  const hv = hutValue();
  if (hv > 0) {
    options.push({ action: 'hut', value: hv });
  }

  // Tower options
  const totalTowers = towerCount + alleyTowerCount;
  if (totalTowers < profile.lateTowers + profile.alleyTowers && botCanAfford(state, playerId, BuildingType.Tower)) {
    const towerCost = costs[BuildingType.Tower];
    const totalCost = towerCost.gold + towerCost.wood + towerCost.stone;
    const towerVal = totalCost > 0 ? 5 / totalCost : 0;
    // Towers more valuable when losing
    const defenseBonus = (intel?.armyAdvantage ?? 1) < 0.7 ? towerVal * 0.5 : 0;
    if (alleyTowerCount < profile.alleyTowers) {
      options.push({ action: 'alley_tower', value: towerVal + defenseBonus });
    } else if (towerCount < profile.lateTowers) {
      options.push({ action: 'tower', value: towerVal + defenseBonus, type: BuildingType.Tower });
    }
  }

  if (options.length === 0) return false;

  // Sort by value, pick best
  options.sort((a, b) => b.value - a.value);

  // Mistake: occasionally pick 2nd or 3rd best
  let pick = options[0];
  if (diff.mistakeRate > 0 && options.length > 1 && state.rng() < diff.mistakeRate) {
    pick = options[Math.min(1, options.length - 1)];
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
    case 'tower':
      botPlaceBuilding(state, playerId, BuildingType.Tower, myBuildings, emit);
      return true;
    case 'alley_tower':
      return botPlaceAlleyTower(state, playerId, emit);
  }
}

// ==================== PROFILE-BASED BUILD ORDER ====================

function botDoBuildOrder(
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
    // Keep building spawners beyond profile targets if we haven't hit our cap
    if (!atSpawnerCap) {
      const preferType = meleeCount <= rangedCount ? BuildingType.MeleeSpawner : BuildingType.RangedSpawner;
      if (tryBuild(preferType)) return true;
      const altType = preferType === BuildingType.MeleeSpawner ? BuildingType.RangedSpawner : BuildingType.MeleeSpawner;
      if (tryBuild(altType)) return true;
    }
    // Keep building huts beyond profile targets if we haven't hit our cap
    if (!atHutCap && tryHut()) return true;
    return false;
  }

  // Late game — use intelligence to decide what to build
  const strategy = intel?.strategy ?? 'balanced';

  // Turtle strategy: prioritize towers
  if (strategy === 'turtle') {
    if (alleyTowerCount < profile.alleyTowers + 1 && botCanAfford(state, playerId, BuildingType.Tower)) {
      if (botPlaceAlleyTower(state, playerId, emit)) return true;
    }
    if (towerCount < profile.lateTowers + 1 && tryBuild(BuildingType.Tower)) return true;
  } else {
    if (alleyTowerCount < profile.alleyTowers && botCanAfford(state, playerId, BuildingType.Tower)) {
      if (botPlaceAlleyTower(state, playerId, emit)) return true;
    }
    if (towerCount < profile.lateTowers && tryBuild(BuildingType.Tower)) return true;
  }

  // Greed strategy: prioritize economy
  if (strategy === 'greed' && hutCount < profile.maxHuts && tryHut()) return true;
  if (hutCount < profile.maxHuts && tryHut()) return true;

  const totalMilitary = meleeCount + rangedCount + casterCount + towerCount;
  if (totalMilitary < BUILD_GRID_COLS * BUILD_GRID_ROWS) {
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
  const myTeam = botTeam(playerId, state);
  const teamAlleyBuildings = state.buildings.filter(
    b => b.buildGrid === 'alley' && botTeam(b.playerId, state) === myTeam
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
  state: GameState, ctx: BotContext, playerId: number, race: Race, profile: RaceProfile,
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

    // Intelligence-driven: prioritize upgrading the most effective unit type
    const intel = ctx.intelligence[playerId];
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

    const choice = botPickUpgrade(state, ctx, b, profile, race, enemyRaces, diff);
    emit({ type: 'purchase_upgrade', playerId, buildingId: b.id, choice });
    return true;
  }
  return false;
}

/** Matchup-aware upgrade selection: scores each option by how well it counters the enemy. */
function botPickUpgrade(
  state: GameState, ctx: BotContext, building: GameState['buildings'][0], profile: RaceProfile, race: Race,
  enemyRaces: Race[], diff: BotDifficulty,
): string {
  const intel = ctx.intelligence[building.playerId];
  const threats = intel?.threats ?? assessThreatProfile(enemyRaces);

  if (building.upgradePath.length === 1) {
    // Tier 1: choose B or C
    let bias: 'B' | 'C';
    switch (building.type) {
      case BuildingType.MeleeSpawner:  bias = profile.meleeUpgradeBias; break;
      case BuildingType.RangedSpawner: bias = profile.rangedUpgradeBias; break;
      case BuildingType.CasterSpawner: bias = profile.casterUpgradeBias; break;
      case BuildingType.Tower:         bias = profile.towerUpgradeBias; break;
      default: bias = 'B';
    }

    if (!diff.useSmartUpgrades) {
      // Non-smart: just follow race bias with occasional random
      if (diff.mistakeRate > 0 && state.rng() < diff.mistakeRate) return bias === 'B' ? 'C' : 'B';
      return bias;
    }

    const scoreB = scoreUpgradeNode(race, building.type, 'B', threats);
    const scoreC = scoreUpgradeNode(race, building.type, 'C', threats);
    const biasBonus = 2;
    const adjustedB = scoreB + (bias === 'B' ? biasBonus : 0);
    const adjustedC = scoreC + (bias === 'C' ? biasBonus : 0);
    if (diff.mistakeRate > 0 && state.rng() < diff.mistakeRate) return state.rng() < 0.5 ? 'B' : 'C';
    return adjustedB >= adjustedC ? 'B' : 'C';
  }

  // Tier 2: choose D/E (under B) or F/G (under C)
  const isBranch = building.upgradePath[1] === 'B';
  const opt1 = isBranch ? 'D' : 'F';
  const opt2 = isBranch ? 'E' : 'G';

  if (!diff.useSmartUpgrades) {
    // Non-smart: random choice within branch
    return state.rng() < 0.5 ? opt1 : opt2;
  }

  const score1 = scoreUpgradeNode(race, building.type, opt1, threats);
  const score2 = scoreUpgradeNode(race, building.type, opt2, threats);
  const offenseBonus = (intel?.armyAdvantage ?? 1) > 1.3 ? 2 : 0;
  const defenseBonus = (intel?.armyAdvantage ?? 1) < 0.7 ? 2 : 0;
  const adj1 = score1 + defenseBonus;
  const adj2 = score2 + offenseBonus;
  if (diff.mistakeRate > 0 && state.rng() < diff.mistakeRate) return state.rng() < 0.5 ? opt1 : opt2;
  return adj1 >= adj2 ? opt1 : opt2;
}

// ==================== LANE MANAGEMENT ====================

function botEvaluateLanes(
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
    const enemyHqHp = state.hqHp[botEnemyTeam(playerId, state)];
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

/** Forward-looking harvester management using intelligence resource projections. */
function botManageHarvesters(
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
    const [idealGold, idealWood, idealStone, idealCenter] = plan.idealSplit;
    for (let i = 0; i < idealGold; i++) assignments.push(HarvesterAssignment.BaseGold);
    for (let i = 0; i < idealWood; i++) assignments.push(HarvesterAssignment.Wood);
    for (let i = 0; i < idealStone; i++) assignments.push(HarvesterAssignment.Stone);
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
    let totalGoldNeed = 0, totalWoodNeed = 0, totalStoneNeed = 0;
    for (const type of [BuildingType.MeleeSpawner, BuildingType.RangedSpawner, BuildingType.CasterSpawner, BuildingType.Tower]) {
      const c = costs[type];
      totalGoldNeed += c.gold;
      totalWoodNeed += c.wood;
      totalStoneNeed += c.stone;
    }
    const resNeeds: [HarvesterAssignment, number][] = [
      [HarvesterAssignment.BaseGold, totalGoldNeed],
      [HarvesterAssignment.Wood, totalWoodNeed],
      [HarvesterAssignment.Stone, totalStoneNeed],
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

  // --- Apply assignments, respecting active harvesters ---
  for (let i = 0; i < myHarvesters.length; i++) {
    const h = myHarvesters[i];

    // Don't interrupt harvesters that are actively mining or carrying resources home
    if (h.state === 'mining' || h.state === 'walking_home') continue;

    const desired = assignments[i];
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
function botNukeWithTelegraph(
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
function botHasNukeTarget(state: GameState, playerId: number, myTeam: Team, myHqHp: number): boolean {
  const enemyTeam = botEnemyTeam(playerId, state);
  const enemyUnits = state.units.filter(u => u.team === enemyTeam);

  // Diamond carrier is always worth nuking
  if (state.units.some(u => u.team === enemyTeam && u.carryingDiamond)) return true;
  if (state.harvesters.some(h => h.team === enemyTeam && h.carryingDiamond)) return true;

  if (enemyUnits.length < 2) return false;

  // HQ defense
  const hq = getHQPosition(myTeam, state.mapDef);
  const hqX = hq.x + HQ_WIDTH / 2;
  const hqY = hq.y + HQ_HEIGHT / 2;
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
  const enemyTeam = botEnemyTeam(playerId, state);
  const enemyUnits = state.units.filter(u => u.team === enemyTeam);

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
  const hq = getHQPosition(myTeam, state.mapDef);
  const hqX = hq.x + HQ_WIDTH / 2;
  const hqY = hq.y + HQ_HEIGHT / 2;
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
