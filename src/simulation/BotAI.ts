import {
  GameState, GameCommand, Race, BuildingType, Lane, Team, HQ_WIDTH, HQ_HEIGHT,
  HarvesterAssignment, HQ_HP, MapDef, TICK_RATE, NUKE_RADIUS,
  AbilityTargetMode, ResearchUpgradeState,
} from './types';
import { RACE_BUILDING_COSTS, UPGRADE_TREES, UpgradeNodeDef, UNIT_STATS, SPAWN_INTERVAL_TICKS, TOWER_STATS, getNodeUpgradeCost, HUT_COST_SCALE, TOWER_COST_SCALE, GOLD_YIELD_PER_TRIP, WOOD_YIELD_PER_TRIP, STONE_YIELD_PER_TRIP, RACE_ABILITY_DEFS, getAllResearchUpgrades, getResearchUpgradeCost } from './data';
import { getHQPosition, getUnitUpgradeMultipliers, PASSIVE_INCOME } from './GameState';

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
  /** Chance to make a suboptimal random decision (0 = perfect, 1 = fully random) */
  mistakeRate: number;
  /** Max total spawners (melee+ranged+caster) the bot will build. 99 = unlimited */
  maxSpawners: number;
  /** Max harvester huts the bot will build. 99 = unlimited */
  maxHuts: number;
  /** If true, bot holds nuke until enemies are pushing near its HQ */
  nukeDefensiveOnly: boolean;
}

export const BOT_DIFFICULTY_PRESETS: Record<BotDifficultyLevel, BotDifficulty> = {
  // Easy: all systems active but slow, capped, and very mistake-prone
  [BotDifficultyLevel.Easy]: {
    buildSpeed: 60,           // 3 seconds between builds
    upgradeSpeed: 150,        // upgrades every 7.5 seconds — slow but present
    upgradeThreshold: 4,      // start upgrading after 4 spawners
    nukeMinTime: 8.0,         // nukes late and rarely
    laneIQ: 'random',
    counterBuild: false,
    useValueFunction: false,
    useDynamicShift: false,
    useSmartUpgrades: false,  // random upgrade picks (high mistake rate covers randomness)
    mistakeRate: 0.30,        // 30% chance to make a wrong decision
    maxSpawners: 4,
    maxHuts: 3,
    nukeDefensiveOnly: false,
  },
  // Medium: all systems active, moderate pace, some mistakes
  [BotDifficultyLevel.Medium]: {
    buildSpeed: 35,           // 1.75 seconds between builds
    upgradeSpeed: 80,         // upgrades every 4 seconds
    upgradeThreshold: 5,      // start upgrading after 5 spawners
    nukeMinTime: 4.0,
    laneIQ: 'basic',
    counterBuild: false,
    useValueFunction: false,
    useDynamicShift: false,
    useSmartUpgrades: true,   // uses matchup-aware upgrades, but mistake rate blunts it
    mistakeRate: 0.12,        // 12% mistake rate — noticeably imperfect
    maxSpawners: 5,
    maxHuts: 4,
    nukeDefensiveOnly: false,
  },
  // Hard: all systems active, fast, few mistakes
  [BotDifficultyLevel.Hard]: {
    buildSpeed: 25,           // 1.25 seconds between builds
    upgradeSpeed: 40,         // upgrades every 2 seconds
    upgradeThreshold: 5,      // start upgrading after 5 spawners
    nukeMinTime: 2.0,
    laneIQ: 'threat',
    counterBuild: false,
    useValueFunction: true,
    useDynamicShift: true,
    useSmartUpgrades: true,
    mistakeRate: 0.05,        // 5% mistake rate — nearly optimal
    maxSpawners: 7,
    maxHuts: 6,
    nukeDefensiveOnly: false,
  },
  // Nightmare: all systems, fastest, perfect decisions, counter-builds
  [BotDifficultyLevel.Nightmare]: {
    buildSpeed: 10,           // 0.5 seconds between builds — relentless
    upgradeSpeed: 20,         // upgrades every 1.0 seconds — aggressive upgrade tempo
    upgradeThreshold: 5,      // start upgrading after 5 spawners — need army mass before multiplying it
    nukeMinTime: 1.0,
    laneIQ: 'threat',
    counterBuild: true,
    useValueFunction: true,
    useDynamicShift: true,
    useSmartUpgrades: true,
    mistakeRate: 0,
    maxSpawners: 99,          // unlimited
    maxHuts: 8,
    nukeDefensiveOnly: true,  // hold nuke until enemies push near HQ
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

// ==================== COMPOSITION PROFILES ====================
// Each race has multiple composition strategies ranked by effectiveness.
// Bots randomly select from this pool, gated by difficulty:
//   Easy: any profile    Medium: exclude worst    Hard: exclude bottom 2    Nightmare: top 3 + matchup-aware
//
// Rankings derived from `npm run profile-sim` (damage dealt across all matchups).
// Re-run profile-sim after balance changes and update rankings accordingly.

export type ProfileId = 'default' | 'heavyMelee' | 'heavyRanged' | 'heavyCaster' | 'meleeCaster' | 'rangedCaster' | 'rush' | 'turtle';

interface CompositionProfile {
  id: ProfileId;
  profile: RaceProfile;
}

/** Build a composition profile by overriding specific fields on the race's base profile */
function compProfile(base: RaceProfile, id: ProfileId, overrides: Partial<RaceProfile>): CompositionProfile {
  return { id, profile: { ...base, ...overrides } };
}

function buildCompositionProfiles(race: Race): CompositionProfile[] {
  const base = RACE_PROFILES[race];
  return [
    compProfile(base, 'default', {}),
    compProfile(base, 'heavyMelee', {
      earlyMelee: 2, earlyRanged: 0, earlyHuts: 1, earlyTowers: 0,
      midMelee: 4, midRanged: 1, midCasters: 0, midTowers: 1, midHuts: 3,
      lateTowers: 2, alleyTowers: 2, maxHuts: 4, pushThreshold: 1.0,
    }),
    compProfile(base, 'heavyRanged', {
      earlyMelee: 1, earlyRanged: 1, earlyHuts: 1, earlyTowers: 0,
      midMelee: 1, midRanged: 4, midCasters: 0, midTowers: 1, midHuts: 3,
      lateTowers: 2, alleyTowers: 2, maxHuts: 4, pushThreshold: 1.1,
    }),
    compProfile(base, 'heavyCaster', {
      earlyMelee: 1, earlyRanged: 0, earlyHuts: 1, earlyTowers: 0,
      midMelee: 2, midRanged: 0, midCasters: 3, midTowers: 1, midHuts: 3,
      lateTowers: 2, alleyTowers: 2, maxHuts: 4, pushThreshold: 1.1,
    }),
    compProfile(base, 'meleeCaster', {
      earlyMelee: 2, earlyRanged: 0, earlyHuts: 1, earlyTowers: 0,
      midMelee: 3, midRanged: 0, midCasters: 2, midTowers: 1, midHuts: 3,
      lateTowers: 2, alleyTowers: 2, maxHuts: 4, pushThreshold: 1.0,
    }),
    compProfile(base, 'rangedCaster', {
      earlyMelee: 1, earlyRanged: 1, earlyHuts: 1, earlyTowers: 0,
      midMelee: 1, midRanged: 3, midCasters: 2, midTowers: 1, midHuts: 3,
      lateTowers: 2, alleyTowers: 2, maxHuts: 4, pushThreshold: 1.1,
    }),
    compProfile(base, 'rush', {
      earlyMelee: 2, earlyRanged: 1, earlyHuts: 0, earlyTowers: 0,
      midMelee: 3, midRanged: 2, midCasters: 1, midTowers: 0, midHuts: 1,
      lateTowers: 1, alleyTowers: 1, maxHuts: 2, pushThreshold: 0.8,
    }),
    compProfile(base, 'turtle', {
      earlyMelee: 0, earlyRanged: 0, earlyHuts: 2, earlyTowers: 1,
      midMelee: 2, midRanged: 1, midCasters: 1, midTowers: 2, midHuts: 5,
      lateTowers: 3, alleyTowers: 3, maxHuts: 6, pushThreshold: 1.3,
    }),
  ];
}

// Lazy-built profile lookup (race -> profileId -> CompositionProfile)
let _compositionProfiles: Record<Race, CompositionProfile[]> | null = null;
export function getCompositionProfiles(race: Race): CompositionProfile[] {
  if (!_compositionProfiles) {
    _compositionProfiles = {} as Record<Race, CompositionProfile[]>;
    for (const r of Object.values(Race)) {
      _compositionProfiles[r] = buildCompositionProfiles(r);
    }
  }
  return _compositionProfiles[race];
}

// --- Profile rankings per race (best→worst, from profile-sim data) ---
// Re-generate with: npm run profile-sim -- --race=<name> --matches=3 --difficulty=hard
// Then update this table with the ranking order.
const PROFILE_RANKINGS: Record<Race, ProfileId[]> = {
  //                    #1              #2            #3              #4            #5              #6              #7            #8
  [Race.Crown]:    ['heavyMelee',  'rush',       'default',      'turtle',     'heavyRanged',  'meleeCaster',  'heavyCaster', 'rangedCaster'],
  [Race.Horde]:    ['heavyMelee',  'meleeCaster','rush',         'turtle',     'default',      'rangedCaster', 'heavyRanged', 'heavyCaster'],
  [Race.Goblins]:  ['rush',        'turtle',     'heavyRanged',  'rangedCaster','heavyCaster', 'heavyMelee',   'default',     'meleeCaster'],
  [Race.Oozlings]: ['heavyCaster', 'turtle',     'rush',         'heavyRanged','rangedCaster', 'default',      'heavyMelee',  'meleeCaster'],
  [Race.Demon]:    ['default',     'rush',       'turtle',       'heavyMelee', 'heavyCaster',  'rangedCaster', 'heavyRanged', 'meleeCaster'],
  [Race.Deep]:     ['heavyMelee',  'rush',       'meleeCaster',  'turtle',     'default',      'heavyRanged',  'rangedCaster','heavyCaster'],
  [Race.Wild]:     ['heavyMelee',  'rangedCaster','turtle',      'heavyCaster','heavyRanged',  'default',      'meleeCaster', 'rush'],
  [Race.Geists]:   ['rangedCaster','rush',       'heavyMelee',   'turtle',     'heavyRanged',  'default',      'heavyCaster', 'meleeCaster'],
  [Race.Tenders]:  ['rush',        'rangedCaster','heavyRanged', 'default',    'meleeCaster',  'heavyCaster',  'heavyMelee',  'turtle'],
};

// --- Nightmare matchup-aware: best profile per enemy archetype ---
// From profile-sim "BEST PROFILE PER MATCHUP" data.
// Key = attacker race, value = map of enemy race → best profileId.
// Only entries whose profile is in that race's top 3 ranking will actually be used;
// other entries serve as documentation for future ranking updates.
const MATCHUP_PROFILES: Record<Race, Partial<Record<Race, ProfileId>>> = {
  // Crown top3: heavyMelee, rush, default
  [Race.Crown]:    { [Race.Horde]: 'heavyMelee', [Race.Demon]: 'rush', [Race.Deep]: 'heavyMelee', [Race.Tenders]: 'rush' },
  // Horde top3: heavyMelee, meleeCaster, rush
  [Race.Horde]:    { [Race.Deep]: 'heavyMelee', [Race.Wild]: 'heavyMelee', [Race.Tenders]: 'rush', [Race.Geists]: 'meleeCaster' },
  // Goblins top3: rush, turtle, heavyRanged
  [Race.Goblins]:  { [Race.Horde]: 'heavyRanged', [Race.Demon]: 'turtle', [Race.Deep]: 'rush', [Race.Wild]: 'rush' },
  // Oozlings top3: heavyCaster, turtle, rush
  [Race.Oozlings]: { [Race.Crown]: 'heavyCaster', [Race.Goblins]: 'rush', [Race.Wild]: 'rush', [Race.Geists]: 'heavyCaster', [Race.Tenders]: 'heavyCaster' },
  // Demon top3: default, rush, turtle
  [Race.Demon]:    { [Race.Deep]: 'turtle', [Race.Tenders]: 'turtle' },
  // Deep top3: heavyMelee, rush, meleeCaster
  [Race.Deep]:     { [Race.Horde]: 'rush', [Race.Oozlings]: 'rush', [Race.Demon]: 'heavyMelee', [Race.Tenders]: 'meleeCaster' },
  // Wild top3: heavyMelee, rangedCaster, turtle
  [Race.Wild]:     { [Race.Oozlings]: 'rangedCaster', [Race.Demon]: 'heavyMelee', [Race.Geists]: 'rangedCaster', [Race.Goblins]: 'turtle' },
  // Geists top3: rangedCaster, rush, heavyMelee
  [Race.Geists]:   { [Race.Goblins]: 'rangedCaster', [Race.Oozlings]: 'rush', [Race.Demon]: 'heavyMelee' },
  // Tenders top3: rush, rangedCaster, heavyRanged
  [Race.Tenders]:  { [Race.Horde]: 'rangedCaster', [Race.Crown]: 'heavyRanged' },
};

/**
 * Select a composition profile for a bot based on difficulty and matchup.
 * Called once per bot at game start, result is cached in BotContext.
 */
function selectCompositionProfile(
  race: Race, difficulty: BotDifficulty, enemyRaces: Race[], rng: () => number,
): RaceProfile {
  const rankings = PROFILE_RANKINGS[race];
  const allProfiles = getCompositionProfiles(race);
  const profileById = new Map(allProfiles.map(p => [p.id, p]));

  // Nightmare with matchup awareness: pick best counter from top 3
  if (difficulty.mistakeRate === 0 && enemyRaces.length > 0) {
    const matchups = MATCHUP_PROFILES[race];
    // Find the best matchup profile that's in our top 3
    const top3 = new Set(rankings.slice(0, 3));
    for (const enemy of enemyRaces) {
      const best = matchups?.[enemy];
      if (best && top3.has(best)) {
        const entry = profileById.get(best);
        if (entry) return entry.profile;
      }
    }
    // No specific matchup counter in top 3 — pick randomly from top 3
    const idx = Math.floor(rng() * 3);
    const fallback = profileById.get(rankings[idx]);
    if (fallback) return fallback.profile;
  }

  // Determine pool size based on difficulty
  let poolSize: number;
  if (difficulty.mistakeRate >= 0.25) {
    // Easy: all profiles
    poolSize = rankings.length;
  } else if (difficulty.mistakeRate >= 0.10) {
    // Medium: exclude worst 1
    poolSize = rankings.length - 1;
  } else if (difficulty.mistakeRate >= 0.03) {
    // Hard: exclude worst 2
    poolSize = rankings.length - 2;
  } else {
    // Nightmare (no matchup hit above): top 3
    poolSize = 3;
  }

  const pool = rankings.slice(0, poolSize);
  const pick = pool[Math.floor(rng() * pool.length)];
  const selected = profileById.get(pick);
  if (selected) return selected.profile;

  // Fallback: return first available profile (should never reach here)
  return allProfiles[0].profile;
}

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
  // Research upgrade timing
  lastResearchTick: Record<number, number>;
  // Difficulty settings
  difficulty: Record<number, BotDifficulty>;
  defaultDifficulty: BotDifficulty;
  // Intelligence system
  intelligence: Record<number, BotIntelligence>;
  // Per-player composition profile (selected once at game start based on difficulty)
  selectedProfile: Record<number, RaceProfile>;
  // Optional per-player profile overrides (for testing composition strategies via profile-sim)
  profileOverride?: Record<number, RaceProfile>;
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
  wantSiege: boolean;     // vs turtling/towers: siege units to crack defenses
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
  /** Real-time enemy unit composition ratios (0-1) */
  enemyMeleeRatio: number;
  enemyRangedRatio: number;
  enemyCasterRatio: number;
  /** >1 = enemy investing in quality (upgrades), <1 = investing in quantity (spawners) */
  enemyQuantityVsQuality: number;

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

// Passive income rates — imported from GameState.ts (single source of truth)
const PASSIVE_RATES = PASSIVE_INCOME;

// --- Race threat classifications ---
const RACE_TRAITS: Record<Race, { archetype: string[]; appliesBurn: boolean; appliesSlow: boolean }> = {
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
    wantSiege: hasTanks,                     // tank races build lots of towers — need siege to crack them
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

  // Building counts for my side + enemy scouting (single pass)
  const enemyTeam = botEnemyTeam(playerId, state);
  let myMelee = 0, myRanged = 0, myCaster = 0;
  let eMelee = 0, eRanged = 0, eCaster = 0, eTower = 0, eHut = 0;
  const myBuildings: typeof state.buildings = [];
  const enemyBuildings: typeof state.buildings = [];
  for (const b of state.buildings) {
    if (b.playerId === playerId) {
      myBuildings.push(b);
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
function botPlanResources(
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
    else if (b.type === BuildingType.Tower) towerCount++;
  }

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
    const mult = Math.pow(HUT_COST_SCALE, Math.max(0, hutCount - 1));
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
    const b = upgradeable[i];
    list.push(getNodeUpgradeCost(race, b.type, b.upgradePath.length));
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
  // Harvester rates: yield / estimated round-trip time (~8.5s for nearby nodes)
  const GOLD_HARVEST_RATE = GOLD_YIELD_PER_TRIP / 8.5;   // ~0.59/sec
  const WOOD_HARVEST_RATE = WOOD_YIELD_PER_TRIP / 8.5;   // ~1.18/sec
  const STONE_HARVEST_RATE = STONE_YIELD_PER_TRIP / 8.5;  // ~1.18/sec
  const harvesters = state.harvesters.filter(h => h.playerId === playerId);
  let goldH = 0, woodH = 0, stoneH = 0;
  for (const h of harvesters) {
    if (h.assignment === HarvesterAssignment.BaseGold || h.assignment === HarvesterAssignment.Center) goldH++;
    else if (h.assignment === HarvesterAssignment.Wood) woodH++;
    else stoneH++;
  }

  const goldIncome = passive.gold + goldH * GOLD_HARVEST_RATE;
  const woodIncome = passive.wood + woodH * WOOD_HARVEST_RATE;
  const stoneIncome = passive.stone + stoneH * STONE_HARVEST_RATE;

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

  // Siege units vs turtling/towers
  if (threats.wantSiege) {
    if (s.isSiegeUnit) score += 18;  // overcome negative hp/speed penalty, siege is exactly what we want
    if (s.buildingDamageMult) score += (s.buildingDamageMult - 1) * 6;
  }

  return score;
}

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

// --- Enemy analysis ---

const SWARM_RACES: ReadonlySet<Race> = new Set([Race.Oozlings, Race.Goblins]);
const TANK_RACES: ReadonlySet<Race> = new Set([Race.Deep, Race.Tenders, Race.Crown]);
const GLASS_CANNON_RACES: ReadonlySet<Race> = new Set([Race.Demon, Race.Wild]);

function getEnemyRaces(state: GameState, playerId: number): Race[] {
  const myTeam = botTeam(playerId, state);
  return state.players
    .filter(p => p.team !== myTeam && !p.isEmpty)
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

function botCanAffordTower(state: GameState, playerId: number, towerCount: number): boolean {
  const player = state.players[playerId];
  if (!player.hasBuiltTower) return true; // first tower is free
  const baseCost = RACE_BUILDING_COSTS[player.race][BuildingType.Tower];
  const mult = Math.pow(TOWER_COST_SCALE, Math.max(0, towerCount - 1));
  return player.gold >= Math.floor(baseCost.gold * mult)
    && player.wood >= Math.floor(baseCost.wood * mult)
    && player.stone >= Math.floor(baseCost.stone * mult);
}

function botCanAffordHut(state: GameState, playerId: number, hutCount: number): boolean {
  const player = state.players[playerId];
  const hutRes = RACE_BUILDING_COSTS[player.race][BuildingType.HarvesterHut];
  const mult = Math.pow(HUT_COST_SCALE, Math.max(0, hutCount - 1));
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
      .filter(p => p.team === myTeam && p.id !== playerId && !p.isEmpty)
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

function resourceBundleTotal(cost: { gold: number; wood: number; stone: number; deathEssence?: number; souls?: number }): number {
  return cost.gold + cost.wood + cost.stone + (cost.deathEssence ?? 0) + (cost.souls ?? 0);
}

function buildingCategory(type: BuildingType): 'melee' | 'ranged' | 'caster' | null {
  switch (type) {
    case BuildingType.MeleeSpawner: return 'melee';
    case BuildingType.RangedSpawner: return 'ranged';
    case BuildingType.CasterSpawner: return 'caster';
    default: return null;
  }
}

function getSpawnerPower(race: Race, type: BuildingType): number {
  const stats = UNIT_STATS[race]?.[type];
  if (!stats) return 0;
  const count = stats.spawnCount ?? 1;
  const dps = (stats.damage / Math.max(0.5, stats.attackSpeed)) * count;
  const hp = stats.hp * count;
  return dps + hp / 10;
}

// ==================== THROUGHPUT-BASED VALUATION (Nightmare) ====================

/** Race-specific survivability multiplier reflecting passive effects (lifesteal, regen, shields, etc.) */
const RACE_SURVIVABILITY: Record<Race, { melee: number; ranged: number; caster: number }> = {
  [Race.Crown]:    { melee: 1.15, ranged: 1.05, caster: 1.10 },  // shields buff whole army
  [Race.Horde]:    { melee: 1.15, ranged: 1.05, caster: 1.05 },  // knockback buys time
  [Race.Goblins]:  { melee: 1.00, ranged: 1.05, caster: 1.05 },  // fast but fragile
  [Race.Oozlings]: { melee: 1.10, ranged: 1.05, caster: 1.00 },  // haste helps dodge
  [Race.Demon]:    { melee: 0.90, ranged: 0.95, caster: 0.90 },  // glass cannon penalty
  [Race.Deep]:     { melee: 1.25, ranged: 1.10, caster: 1.10 },  // very tanky + slow debuff
  [Race.Wild]:     { melee: 1.05, ranged: 1.05, caster: 1.05 },  // poison adds over time
  [Race.Geists]:   { melee: 1.25, ranged: 1.10, caster: 1.10 },  // lifesteal + revive
  [Race.Tenders]:  { melee: 1.20, ranged: 1.10, caster: 1.15 },  // regen + healing
};

/**
 * Compute sustained combat throughput for a spawner type.
 * Returns power produced per minute, factoring in spawn rate, unit count, DPS, and survivability.
 * Optionally accepts an upgrade path to compute post-upgrade throughput.
 */
function getSpawnerThroughput(race: Race, type: BuildingType, upgradePath?: string[]): number {
  const stats = UNIT_STATS[race]?.[type];
  if (!stats) return 0;

  let hp = stats.hp;
  let damage = stats.damage;
  let attackSpeed = stats.attackSpeed;
  let spawnSpeed = 1;
  let count = stats.spawnCount ?? 1;

  // Apply upgrade multipliers if path provided
  if (upgradePath && upgradePath.length > 1) {
    const mults = getUnitUpgradeMultipliers(upgradePath, race, type);
    hp *= mults.hp;
    damage *= mults.damage;
    attackSpeed *= mults.attackSpeed;
    spawnSpeed = mults.spawnSpeed;
    if (mults.special.spawnCount) count = mults.special.spawnCount;
  }

  // Spawns per minute
  const spawnInterval = SPAWN_INTERVAL_TICKS * spawnSpeed;
  const spawnsPerMinute = (60 * TICK_RATE) / Math.max(1, spawnInterval);
  const unitsPerMinute = spawnsPerMinute * count;

  // Unit combat value: geometric mean of offense and survival
  const dps = damage / Math.max(0.2, attackSpeed);
  const cat = type === BuildingType.MeleeSpawner ? 'melee'
    : type === BuildingType.RangedSpawner ? 'ranged' : 'caster';
  const survMult = RACE_SURVIVABILITY[race][cat];
  const effectiveHp = hp * survMult;

  // Power = sqrt(DPS * effectiveHP) — rewards balanced offense/defense
  const unitPower = Math.sqrt(dps * effectiveHp);

  return unitPower * unitsPerMinute;
}

/**
 * Detect if an upgrade creates a disproportionate power spike.
 * Returns a bonus multiplier (0 = no spike, 0.4 = massive spike).
 */
function detectPowerSpike(
  race: Race, type: BuildingType, choice: string, threats: ThreatProfile,
): number {
  const tree = UPGRADE_TREES[race]?.[type];
  if (!tree) return 0;
  const node = tree[choice as keyof typeof tree] as UpgradeNodeDef | undefined;
  if (!node?.special) return 0;
  const s = node.special;

  // Multishot / cleave / splash = multiplicative DPS gains
  if (s.multishotCount) return 0.35;
  if (s.cleaveTargets && threats.wantAoE) return 0.30;
  if (s.splashRadius && threats.wantAoE) return 0.25;
  // Crown shields = massive team-wide spike
  if (race === Race.Crown && type === BuildingType.CasterSpawner && (s.shieldTargetBonus || s.shieldAbsorbBonus)) {
    return threats.wantShields ? 0.40 : 0.20;
  }
  // Haste = big mobility spike for swarm
  if (s.guaranteedHaste) return 0.20;
  // Revive = effectively doubles unit life
  if (s.reviveHpPct) return 0.25;
  // Dodge = effective HP multiplier
  if (s.dodgeChance && s.dodgeChance >= 0.25) return 0.20;
  return 0;
}

/**
 * Compute time-to-afford a cost bundle given current resources and income.
 * Returns seconds. 0 = can afford now. 999 = can never afford.
 */
function timeToAfford(
  player: GameState['players'][0], cost: { gold: number; wood: number; stone: number },
  plan: ResourceProjection | null,
): number {
  const goldNeed = Math.max(0, cost.gold - player.gold);
  const woodNeed = Math.max(0, cost.wood - player.wood);
  const stoneNeed = Math.max(0, cost.stone - player.stone);
  if (goldNeed === 0 && woodNeed === 0 && stoneNeed === 0) return 0;
  if (!plan) return 999;
  const goldSecs = plan.goldIncome > 0.01 ? goldNeed / plan.goldIncome : (goldNeed > 0 ? 999 : 0);
  const woodSecs = plan.woodIncome > 0.01 ? woodNeed / plan.woodIncome : (woodNeed > 0 ? 999 : 0);
  const stoneSecs = plan.stoneIncome > 0.01 ? stoneNeed / plan.stoneIncome : (stoneNeed > 0 ? 999 : 0);
  return Math.max(goldSecs, woodSecs, stoneSecs);
}

function estimateSpawnerValue(
  state: GameState, ctx: BotContext, playerId: number, type: BuildingType,
): number {
  const race = state.players[playerId].race;
  const cost = RACE_BUILDING_COSTS[race][type];
  const totalCost = resourceBundleTotal(cost);
  if (totalCost <= 0) return 0;

  const diff = ctx.difficulty[playerId] ?? ctx.defaultDifficulty;
  const intel = ctx.intelligence[playerId];

  // Nightmare: use throughput-based valuation with resource bottleneck awareness
  let value: number;
  if (diff.useValueFunction) {
    const throughput = getSpawnerThroughput(race, type);
    value = throughput / totalCost;
    // Penalize spawners that bottleneck on scarce resources
    const plan = intel?.resourcePlan;
    if (plan) {
      const waitTime = timeToAfford(state.players[playerId], cost, plan);
      if (waitTime > 8) value *= 0.85; // long wait = resource mismatch
    }
  } else {
    value = getSpawnerPower(race, type) / totalCost;
  }

  const cat = buildingCategory(type);
  if (cat && intel) {
    // Build shift: stronger influence for nightmare bots
    const shiftWeight = diff.useValueFunction ? 0.12 : 0.08;
    value *= 1 + Math.max(0, intel.buildShift[cat]) * shiftWeight;
    if (intel.effectiveCategory === cat) value *= 1.15;
    if (intel.weakCategory === cat && intel.armyAdvantage < 0.9) value *= 0.88;
  }
  return value;
}

function estimateUpgradeValue(
  state: GameState, ctx: BotContext, playerId: number, building: GameState['buildings'][0],
  profile: RaceProfile, enemyRaces: Race[], diff: BotDifficulty,
): { value: number; choice: string } {
  const player = state.players[playerId];
  const race = player.race;
  const choice = botPickUpgrade(state, ctx, building, profile, race, enemyRaces, diff);
  const tier = getNodeUpgradeCost(race, building.type, building.upgradePath.length, choice);
  const totalCost = resourceBundleTotal(tier);
  if (totalCost <= 0 && !(tier.deathEssence ?? 0) && !(tier.souls ?? 0)) return { value: 0, choice: 'B' };
  if (player.gold < tier.gold || player.wood < tier.wood || player.stone < tier.stone) {
    return { value: 0, choice };
  }
  if ((tier.deathEssence ?? 0) > 0 && player.deathEssence < (tier.deathEssence ?? 0)) {
    return { value: 0, choice };
  }
  if ((tier.souls ?? 0) > 0 && player.souls < (tier.souls ?? 0)) {
    return { value: 0, choice };
  }

  const tree = UPGRADE_TREES[race]?.[building.type];
  if (!tree) return { value: 0, choice };
  const nodeDef = tree[choice as keyof typeof tree] as UpgradeNodeDef | undefined;
  if (!nodeDef) return { value: 0, choice };

  const intel = ctx.intelligence[playerId];
  const threats = intel?.threats ?? assessThreatProfile(enemyRaces);
  let value: number;

  if (diff.useValueFunction && building.type !== BuildingType.Tower) {
    // Throughput-based: compute actual power delta from this upgrade
    const currentTP = getSpawnerThroughput(race, building.type, building.upgradePath);
    const newPath = [...building.upgradePath, choice];
    const newTP = getSpawnerThroughput(race, building.type, newPath);
    const throughputDelta = newTP - currentTP;

    // Power spike detection: some upgrades have disproportionate impact
    const spikeBonus = detectPowerSpike(race, building.type, choice, threats);
    const matchupBonus = scoreUpgradeNode(race, building.type, choice, threats) / 40;

    // Count how many buildings of this type share the upgrade (upgrades apply to the spawner type)
    const sameTypeCount = state.buildings.filter(
      b => b.playerId === player.id && b.type === building.type
    ).length;
    // More buildings of same type = upgrade benefits more production
    const volumeBonus = Math.max(1, sameTypeCount * 0.6);

    value = (throughputDelta * (1 + spikeBonus + matchupBonus) * volumeBonus) / totalCost;
  } else {
    // Stat-based (non-nightmare or towers)
    const hpGain = (nodeDef.hpMult ?? 1) - 1;
    const dmgGain = (nodeDef.damageMult ?? 1) - 1;
    const spdGain = nodeDef.attackSpeedMult ? (1 - nodeDef.attackSpeedMult) : 0;
    const moveGain = (nodeDef.moveSpeedMult ?? 1) - 1;
    const rangeGain = (nodeDef.rangeMult ?? 1) - 1;
    const matchupBonus = scoreUpgradeNode(race, building.type, choice, threats) / 25;
    const specialBonus = nodeDef.special ? 0.12 : 0;
    const totalGain = hpGain * 0.35 + dmgGain * 0.9 + spdGain * 1.1 + moveGain * 0.2 + rangeGain * 0.5 + specialBonus + matchupBonus;

    const basePower = building.type === BuildingType.Tower ? 10 : getSpawnerPower(race, building.type);
    value = (basePower * totalGain) / totalCost;
  }

  const cat = buildingCategory(building.type);
  if (intel && cat) {
    if (intel.effectiveCategory === cat) value *= 1.18;
    if (intel.armyAdvantage < 0.75 && intel.weakCategory === cat) value *= 0.88;
  }
  if (building.type === BuildingType.Tower && (intel?.strategy === 'turtle' || (intel?.armyAdvantage ?? 1) < 0.8)) {
    value *= 1.15;
  }

  return { value, choice };
}

// ==================== RESEARCH VALUE ESTIMATION ====================

/** Synergy scores for race one-shot research upgrades, keyed by upgrade id */
function getOneShotSynergyScore(id: string, threats: ThreatProfile): number {
  switch (id) {
    // Crown
    case 'crown_melee_1': return threats.hasBurst ? 3.0 : 1.0;
    case 'crown_melee_2': return 2.0;
    case 'crown_ranged_1': return threats.hasTanks ? 2.5 : 1.2;
    case 'crown_ranged_2': return 2.5;
    case 'crown_caster_1': return threats.hasBurn ? 3.0 : 1.5;
    case 'crown_caster_2': return 1.5;
    // Horde
    case 'horde_melee_1': return 2.0;
    case 'horde_melee_2': return threats.hasBurst ? 2.5 : 1.5;
    case 'horde_ranged_1': return threats.hasControl ? 1.0 : 2.0;
    case 'horde_ranged_2': return threats.hasSwarm ? 3.0 : 1.5;
    case 'horde_caster_1': return 2.0;
    case 'horde_caster_2': return 2.0;
    // Goblins
    case 'goblins_melee_1': return (threats.hasTanks || threats.hasSustain) ? 2.5 : 1.5;
    case 'goblins_melee_2': return threats.hasControl ? 2.5 : 1.5;
    case 'goblins_ranged_1': return threats.hasTanks ? 2.5 : 1.5;
    case 'goblins_ranged_2': return 2.0;
    case 'goblins_caster_1': return 2.0;
    case 'goblins_caster_2': return 2.5;
    // Oozlings
    case 'oozlings_melee_1': return threats.hasSwarm ? 1.5 : 2.0;
    case 'oozlings_melee_2': return 2.5;
    case 'oozlings_ranged_1': return 1.5;
    case 'oozlings_ranged_2': return 1.5;
    case 'oozlings_caster_1': return 1.5;
    case 'oozlings_caster_2': return 3.0;
    // Demon
    case 'demon_melee_1': return 2.5;
    case 'demon_melee_2': return 2.0;
    case 'demon_ranged_1': return 2.5;
    case 'demon_ranged_2': return threats.hasSwarm ? 3.0 : 2.0;
    case 'demon_caster_1': return 2.0;
    case 'demon_caster_2': return 2.5;
    // Deep
    case 'deep_melee_1': return threats.hasBurst ? 2.5 : 1.5;
    case 'deep_melee_2': return 2.5;
    case 'deep_ranged_1': return 2.0;
    case 'deep_ranged_2': return 2.0;
    case 'deep_caster_1': return threats.hasBurn ? 3.0 : 1.0;
    case 'deep_caster_2': return threats.hasBurn ? 2.5 : 1.5;
    // Wild
    case 'wild_melee_1': return 2.5;
    case 'wild_melee_2': return 2.0;
    case 'wild_ranged_1': return threats.hasTanks ? 2.5 : 1.5;
    case 'wild_ranged_2': return 2.0;
    case 'wild_caster_1': return threats.hasSwarm ? 3.0 : 1.5;
    case 'wild_caster_2': return 2.5;
    // Geists
    case 'geists_melee_1': return 2.5;
    case 'geists_melee_2': return threats.hasBurst ? 3.0 : 1.5;
    case 'geists_ranged_1': return 2.0;
    case 'geists_ranged_2': return 2.0;
    case 'geists_caster_1': return 2.0;
    case 'geists_caster_2': return 2.5;
    // Tenders
    case 'tenders_melee_1': return 2.0;
    case 'tenders_melee_2': return threats.hasSwarm ? 2.5 : 1.5;
    case 'tenders_ranged_1': return 2.0;
    case 'tenders_ranged_2': return 1.5;
    case 'tenders_caster_1': return 2.5;
    case 'tenders_caster_2': return 2.0;
    default: return 1.0;
  }
}

/**
 * Estimate value of a research upgrade in comparable power-per-cost units.
 * Used by Nightmare (botValueBasedBuild) and Hard (botUpgradeBuildings) bots.
 */
function estimateResearchValue(
  _state: GameState, _ctx: BotContext, playerId: number,
  upgradeId: string, race: Race, bu: ResearchUpgradeState,
  intel: BotIntelligence, myBuildings: GameState['buildings'],
): number {
  const def = getAllResearchUpgrades(race).find(d => d.id === upgradeId);
  if (!def) return 0;

  // Skip already-owned one-shots
  if (def.oneShot && bu.raceUpgrades[def.id]) return 0;

  // Get level for scaling upgrades
  let level = 0;
  if (upgradeId === 'melee_atk') level = bu.meleeAtkLevel;
  else if (upgradeId === 'melee_def') level = bu.meleeDefLevel;
  else if (upgradeId === 'ranged_atk') level = bu.rangedAtkLevel;
  else if (upgradeId === 'ranged_def') level = bu.rangedDefLevel;
  else if (upgradeId === 'caster_atk') level = bu.casterAtkLevel;
  else if (upgradeId === 'caster_def') level = bu.casterDefLevel;

  const cost = getResearchUpgradeCost(upgradeId, level, race);
  const totalCost = cost.gold + cost.wood + cost.stone + (cost.deathEssence ?? 0) + (cost.souls ?? 0);
  if (totalCost <= 0) return 0;

  // Get category counts
  const cat = def.category;
  const catType = cat === 'melee' ? BuildingType.MeleeSpawner
    : cat === 'ranged' ? BuildingType.RangedSpawner
    : BuildingType.CasterSpawner;
  const spawnerCount = myBuildings.filter(b => b.playerId === playerId && b.type === catType).length;
  const aliveCount = intel.myPerf[cat].alive;
  const unitStats = UNIT_STATS[race]?.[catType];
  if (!unitStats) return 0;
  const avgDamage = unitStats.damage;
  const avgHP = unitStats.hp;

  const threats = intel.threats;
  const armyAdvantage = intel.armyAdvantage;

  // --- Race one-shot upgrades ---
  if (def.oneShot) {
    if (spawnerCount === 0) return 0; // no spawners of this category
    const synergyScore = getOneShotSynergyScore(upgradeId, threats);
    return synergyScore * spawnerCount * 0.4 / totalCost;
  }

  // --- Attack upgrades (melee_atk, ranged_atk, caster_atk) ---
  if (def.type === 'attack') {
    // Marginal multiplier gain: 1.25^(level+1) - 1.25^level = 1.25^level * 0.25
    const marginalMult = Math.pow(1.25, level) * 0.25;
    let value = marginalMult * (aliveCount + spawnerCount * 3) * avgDamage / totalCost;

    // Boost if this is the effective category
    if (intel.effectiveCategory === cat) value *= 1.3;
    // If losing, attack upgrades get +20% (need to punch through)
    if (armyAdvantage < 0.8) value *= 1.2;

    return value;
  }

  // --- Defense upgrades (melee_def, ranged_def, caster_def) ---
  if (def.type === 'defense') {
    // Marginal DR gain: 1/(1+0.06*level) - 1/(1+0.06*(level+1))
    const oldDR = 1 - 1 / (1 + 0.06 * level);
    const newDR = 1 - 1 / (1 + 0.06 * (level + 1));
    // Effective HP multiplier increase
    const ehpGain = (newDR > 0.99 ? 100 : 1 / (1 - newDR)) - (oldDR > 0.99 ? 100 : 1 / (1 - oldDR));
    let value = ehpGain * (aliveCount + spawnerCount * 3) * avgHP / totalCost;

    // If losing badly, defense gets +50%
    if (armyAdvantage < 0.6) value *= 1.5;
    // If weak category matches, multiply by 1.5
    if (intel.weakCategory === cat) value *= 1.5;

    return value;
  }

  return 0;
}

function estimateHutPaybackSeconds(
  state: GameState, ctx: BotContext, playerId: number, hutCount: number,
): number {
  const race = state.players[playerId].race;
  const hutBase = RACE_BUILDING_COSTS[race][BuildingType.HarvesterHut];
  const mult = Math.pow(HUT_COST_SCALE, Math.max(0, hutCount - 1));
  const totalCost = Math.floor(hutBase.gold * mult) + Math.floor(hutBase.wood * mult) + Math.floor(hutBase.stone * mult);
  if (totalCost <= 0) return 999;

  const plan = ctx.intelligence[playerId]?.resourcePlan;
  const passive = PASSIVE_RATES[race];
  const harvesters = state.harvesters.filter(h => h.playerId === playerId);
  let goldH = 0, woodH = 0, stoneH = 0;
  for (const h of harvesters) {
    if (h.assignment === HarvesterAssignment.BaseGold || h.assignment === HarvesterAssignment.Center) goldH++;
    else if (h.assignment === HarvesterAssignment.Wood) woodH++;
    else stoneH++;
  }

  const goldIncome = plan?.goldIncome ?? (passive.gold + goldH * (GOLD_YIELD_PER_TRIP / 8.5));
  const woodIncome = plan?.woodIncome ?? (passive.wood + woodH * (WOOD_YIELD_PER_TRIP / 8.5));
  const stoneIncome = plan?.stoneIncome ?? (passive.stone + stoneH * (STONE_YIELD_PER_TRIP / 8.5));

  const costTime = Math.max(
    hutBase.gold > 0 ? Math.floor(hutBase.gold * mult) / Math.max(0.1, goldIncome) : 0,
    hutBase.wood > 0 ? Math.floor(hutBase.wood * mult) / Math.max(0.1, woodIncome) : 0,
    hutBase.stone > 0 ? Math.floor(hutBase.stone * mult) / Math.max(0.1, stoneIncome) : 0
  );

  // Avg harvester income: weighted by resource types the race uses
  const avgHarvestRate = (GOLD_YIELD_PER_TRIP + WOOD_YIELD_PER_TRIP + STONE_YIELD_PER_TRIP) / 3 / 8.5;
  const directPayback = totalCost / avgHarvestRate;
  return Math.max(directPayback, costTime * 1.2);
}

function shouldBuildHutNow(
  state: GameState, ctx: BotContext, playerId: number, profile: RaceProfile,
  hutCount: number, gameMinutes: number,
): boolean {
  // Nightmare bots use difficulty maxHuts (higher cap); others use profile cap
  const diff = ctx.difficulty[playerId] ?? ctx.defaultDifficulty;
  const hutCap = diff.useValueFunction ? diff.maxHuts : profile.maxHuts;
  if (hutCount >= hutCap) return false;

  const intel = ctx.intelligence[playerId];
  const armyAdvantage = intel?.armyAdvantage ?? 1;
  const myHqHp = state.hqHp[botTeam(playerId, state)];
  const canAfford = botCanAffordHut(state, playerId, hutCount);

  // Dynamic max huts: adjust based on game state
  const dynamicMax = computeDynamicHutTarget(intel, gameMinutes, profile, hutCount, armyAdvantage, diff);
  if (hutCount >= dynamicMax) return false;

  // Can't afford — return false (save-for logic handles this at the build level)
  if (!canAfford) return false;

  const payback = estimateHutPaybackSeconds(state, ctx, playerId, hutCount);
  const bottleneckWait = intel?.resourcePlan
    ? Math.max(intel.resourcePlan.goldSecsToTarget, intel.resourcePlan.woodSecsToTarget, intel.resourcePlan.stoneSecsToTarget)
    : 0;

  // When behind hard: never invest in economy, spend on army
  if (myHqHp < HQ_HP * 0.35 && armyAdvantage < 0.85) return false;
  // When behind moderately: only if we have army parity
  if (myHqHp < HQ_HP * 0.45 && armyAdvantage < 0.95) return false;

  // Nightmare bot: more aggressive economy when safe
  if (diff.useValueFunction) {
    // Early game: always invest in economy (huts pay for themselves quickly)
    if (gameMinutes < 1.5) return payback <= 45;
    if (gameMinutes < 2.5) return payback <= 55;
    // When winning: expand economy for snowball
    if (armyAdvantage > 1.3 && payback <= 100) return true;
    // When even: invest if payback is reasonable
    if (gameMinutes < 5) return payback <= 70 && armyAdvantage >= 0.85;
    // Greed strategy or resource-starved — keep investing in economy
    if ((intel?.strategy === 'greed' || bottleneckWait > 15) && payback <= 85 && armyAdvantage >= 0.85) return true;
    // Late game: still invest if payback is reasonable (no hard cutoff for nightmare)
    if (gameMinutes < 10) return payback <= 60 && armyAdvantage >= 0.9;
    // Very late game: only if payback is quick and we're not losing
    return payback <= 45 && armyAdvantage >= 0.95;
  }

  // Non-nightmare logic (unchanged)
  if (gameMinutes < 2.25) return payback <= 55;
  if (gameMinutes < 4.5) return payback <= 75 && armyAdvantage >= 0.9;
  if ((intel?.strategy === 'greed' || bottleneckWait > 20) && payback <= 90 && armyAdvantage >= 0.85) return true;
  if (gameMinutes > 7) return false;
  return payback <= 65 && armyAdvantage >= 1.05;
}

/** Compute dynamic max hut target based on game state */
function computeDynamicHutTarget(
  intel: BotIntelligence | undefined, gameMinutes: number,
  profile: RaceProfile, hutCount: number, armyAdvantage: number,
  diff?: BotDifficulty,
): number {
  const isNightmare = diff?.useValueFunction ?? false;
  let target = isNightmare ? (diff?.maxHuts ?? profile.maxHuts) : profile.maxHuts;
  // When losing badly: freeze hut building
  if (armyAdvantage < 0.65 && gameMinutes > 2) target = Math.min(target, hutCount);
  // When winning big: allow one extra hut for snowball
  if (armyAdvantage > 1.4) target = Math.min(target + 1, 10);
  // Very late game: non-nightmare stops expanding; nightmare only slows down
  if (gameMinutes > 7 && !isNightmare) target = Math.min(target, hutCount);
  // Turtle strategy: allow more econ
  if (intel?.strategy === 'turtle' && armyAdvantage >= 0.8) target = Math.min(target + 1, 10);
  // Greed strategy (nightmare): allow full econ investment
  if (isNightmare && intel?.strategy === 'greed') target = Math.min(target + 1, 10);
  return target;
}

interface NukeStrikePlan {
  x: number;
  y: number;
  score: number;
  victims: number;
  nearHqVictims: number;
  upgradedVictims: number;
  reason: 'diamond' | 'defense' | 'cluster';
}

function isLegalNukeTarget(myTeam: Team, mapDef: MapDef, x: number, y: number): boolean {
  const zone = mapDef.nukeZone[myTeam];
  const axis = mapDef.shapeAxis === 'x' ? x : y;
  return axis >= zone.min && axis <= zone.max;
}

function evaluateBestNukePlan(
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

  const myBuildings = state.buildings.filter(b => b.playerId === playerId);
  const meleeCount = myBuildings.filter(b => b.type === BuildingType.MeleeSpawner).length;
  const rangedCount = myBuildings.filter(b => b.type === BuildingType.RangedSpawner).length;
  const casterCount = myBuildings.filter(b => b.type === BuildingType.CasterSpawner).length;
  const towerCount = myBuildings.filter(b => b.type === BuildingType.Tower && b.buildGrid === 'military').length;
  const alleyTowerCount = myBuildings.filter(b => b.type === BuildingType.Tower && b.buildGrid === 'alley').length;
  const hutCount = myBuildings.filter(b => b.type === BuildingType.HarvesterHut).length;

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
  if (!diff.useValueFunction && diff.upgradeThreshold >= 99) {
    // Medium only (upgradeThreshold >= 99 means no building upgrades, i.e. Medium)
    const researchInterval = diff.laneIQ === 'random' ? 999999 : 45 * TICK_RATE;
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
  const plan = intel?.resourcePlan ?? null;

  // Score all options — including unaffordable ones for save-for logic
  interface BuildOption {
    action: 'spawner' | 'upgrade' | 'hut' | 'tower' | 'alley_tower' | 'research';
    value: number;
    affordable: boolean;
    waitSecs: number;  // seconds to afford (0 if affordable now)
    resourceTypes: number; // how many distinct resource types this costs (1, 2, or 3)
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

    // Profile steering: boost value if below target, penalize if above
    const currentCount = type === BuildingType.MeleeSpawner ? meleeCount
      : type === BuildingType.RangedSpawner ? rangedCount : casterCount;
    const target = profileTarget(type);
    let profileMult = 1.0;
    if (currentCount < target) profileMult = 1.25; // want more of this
    else if (target === 0 && currentCount > 0) profileMult = 0.6; // profile says skip this
    else if (currentCount > target) profileMult = 0.85; // already have enough

    const cost = costs[type];
    const canAfford = botCanAfford(state, playerId, type);
    const wait = canAfford ? 0 : timeToAfford(player, cost, plan);
    const spRT = (cost.gold > 0 ? 1 : 0) + (cost.wood > 0 ? 1 : 0) + (cost.stone > 0 ? 1 : 0);
    options.push({ action: 'spawner', value: (sv + shiftBonus) * profileMult, affordable: canAfford, waitSecs: wait, resourceTypes: spRT, type });
  }

  // --- Upgrade options (both affordable and unaffordable) ---
  const spawnerCount = meleeCount + rangedCount + casterCount;
  if (spawnerCount >= diff.upgradeThreshold) {
    const upgradeable = myBuildings
      .filter(b => b.type !== BuildingType.HarvesterHut && b.upgradePath.length > 0 && b.upgradePath.length < 3);
    for (const b of upgradeable) {
      const choice = botPickUpgrade(state, ctx, b, profile, race, enemyRaces, diff);
      const tier = getNodeUpgradeCost(race, b.type, b.upgradePath.length, choice);
      const canAfford = player.gold >= tier.gold && player.wood >= tier.wood && player.stone >= tier.stone
        && ((tier.deathEssence ?? 0) <= 0 || player.deathEssence >= (tier.deathEssence ?? 0));

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
        const sameTypeCount = state.buildings.filter(
          sb => sb.playerId === playerId && sb.type === b.type
        ).length;
        const volumeBonus = Math.max(1, sameTypeCount * 0.6);

        uv = (throughputDelta * (1 + spikeBonus + matchupBonus) * volumeBonus) / totalCost;

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
        const upRT = (tier.gold > 0 ? 1 : 0) + (tier.wood > 0 ? 1 : 0) + (tier.stone > 0 ? 1 : 0);
        options.push({
          action: 'upgrade', value: uv, affordable: canAfford, waitSecs: wait, resourceTypes: upRT,
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
      const additionalIncome = (GOLD_YIELD_PER_TRIP + WOOD_YIELD_PER_TRIP + STONE_YIELD_PER_TRIP) / 3 / 8.5;
      const enabledThroughput = avgSpawnerCost > 0
        ? (additionalIncome * timeHorizon / avgSpawnerCost) * avgThroughput
        : 0;
      const hutBase = costs[BuildingType.HarvesterHut];
      const mult = Math.pow(HUT_COST_SCALE, Math.max(0, hutCount - 1));
      const hutTotalCost = Math.floor(hutBase.gold * mult) + Math.floor(hutBase.wood * mult) + Math.floor(hutBase.stone * mult);
      let hv = hutTotalCost > 0 ? enabledThroughput / hutTotalCost : 0;
      // Scale down if payback is long
      if (payback > 60) hv *= 60 / payback;
      // Pressure bonus when resource-starved
      const pressureBonus = plan
        ? Math.min(0.15, Math.max(0, Math.max(
          plan.goldSecsToTarget, plan.woodSecsToTarget, plan.stoneSecsToTarget,
        ) - 15) * 0.005)
        : 0;
      hv += pressureBonus;
      if (hv > 0) {
        const canAffordHut = botCanAffordHut(state, playerId, hutCount);
        const hutBase2 = costs[BuildingType.HarvesterHut];
        const hutRT = (hutBase2.gold > 0 ? 1 : 0) + (hutBase2.wood > 0 ? 1 : 0) + (hutBase2.stone > 0 ? 1 : 0);
        options.push({ action: 'hut', value: hv, affordable: canAffordHut, waitSecs: 0, resourceTypes: hutRT });
      }
    }
  }

  // --- Tower options ---
  const totalTowers = towerCount + alleyTowerCount;
  if (totalTowers < profile.lateTowers + profile.alleyTowers) {
    const ts = TOWER_STATS[race];
    const towerBaseCost = costs[BuildingType.Tower];
    const towerMult = totalTowers > 0 ? Math.pow(TOWER_COST_SCALE, Math.max(0, totalTowers - 1)) : 1;
    const towerCost = { gold: Math.floor(towerBaseCost.gold * towerMult), wood: Math.floor(towerBaseCost.wood * towerMult), stone: Math.floor(towerBaseCost.stone * towerMult) };
    const totalCostT = towerCost.gold + towerCost.wood + towerCost.stone;
    const towerDPS = ts.damage / ts.attackSpeed;
    let towerVal = totalCostT > 0 ? (towerDPS + ts.hp * 0.005) / totalCostT : 0;
    // Towers more valuable when losing
    const armyAdv = intel?.armyAdvantage ?? 1;
    if (armyAdv < 0.7) towerVal *= 1.6;
    else if (armyAdv < 0.9) towerVal *= 1.2;
    // First tower is free — massive value
    if (totalTowers === 0) towerVal *= 5;
    const canAffordTower = botCanAffordTower(state, playerId, totalTowers);
    if (alleyTowerCount < profile.alleyTowers) {
      const twRT = (towerCost.gold > 0 ? 1 : 0) + (towerCost.wood > 0 ? 1 : 0) + (towerCost.stone > 0 ? 1 : 0);
      options.push({ action: 'alley_tower', value: towerVal, affordable: canAffordTower, waitSecs: 0, resourceTypes: twRT });
    } else if (towerCount < profile.lateTowers) {
      const twRT2 = (towerCost.gold > 0 ? 1 : 0) + (towerCost.wood > 0 ? 1 : 0) + (towerCost.stone > 0 ? 1 : 0);
      options.push({ action: 'tower', value: towerVal, affordable: canAffordTower, waitSecs: 0, resourceTypes: twRT2, type: BuildingType.Tower });
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
      const rTotalCost = rCost.gold + rCost.wood + rCost.stone + (rCost.souls ?? 0);
      if (rTotalCost <= 0) continue;

      const canAffordR = player.gold >= rCost.gold && player.wood >= rCost.wood && player.stone >= rCost.stone
        && ((rCost.souls ?? 0) <= 0 || player.souls >= (rCost.souls ?? 0));
      const rv = estimateResearchValue(state, ctx, playerId, rDef.id, race, bu, intel, myBuildings);
      if (rv > 0) {
        const waitR = canAffordR ? 0 : timeToAfford(player, rCost, plan);
        const rRT = (rCost.gold > 0 ? 1 : 0) + (rCost.wood > 0 ? 1 : 0) + (rCost.stone > 0 ? 1 : 0) + ((rCost.souls ?? 0) > 0 ? 1 : 0);
        options.push({
          action: 'research', value: rv, affordable: canAffordR, waitSecs: waitR, resourceTypes: rRT,
          researchId: rDef.id,
        });
      }
    }
  }

  if (options.length === 0) return false;

  // --- Save-for logic: should we skip buying cheap now to afford something better soon? ---
  const affordableOptions = options.filter(o => o.affordable);
  const unaffordableOptions = options.filter(o => !o.affordable && o.waitSecs < 20 && o.waitSecs > 0);

  // Sort both by value (deterministic tie-break by action name, then type, then building id)
  // NOTE: use < > instead of localeCompare to avoid locale-dependent sort order (desync risk)
  const cmpStr = (x: string, y: string) => x < y ? -1 : x > y ? 1 : 0;
  const optionSort = (a: BuildOption, b: BuildOption) =>
    b.value - a.value
    || cmpStr(a.action, b.action)
    || cmpStr(a.type ?? '', b.type ?? '')
    || (a.building?.id ?? 0) - (b.building?.id ?? 0)
    || cmpStr(a.researchId ?? '', b.researchId ?? '');
  affordableOptions.sort(optionSort);
  unaffordableOptions.sort(optionSort);

  const bestAffordable = affordableOptions[0];
  const bestUnaffordable = unaffordableOptions[0];

  // If a much better option is almost affordable, save for it.
  // Only applies to single-resource targets — multi-resource costs (e.g. Horde upgrades at 30g+20w+20s)
  // drain all channels simultaneously and can't be meaningfully "saved for" without starving spawners.
  if (bestUnaffordable && bestAffordable && bestUnaffordable.resourceTypes <= 1) {
    const valueRatio = bestUnaffordable.value / Math.max(0.001, bestAffordable.value);
    // Save if: unaffordable is 80%+ better AND we can afford it within 6 seconds
    if (valueRatio > 1.8 && bestUnaffordable.waitSecs <= 6) {
      return false; // skip building — save resources
    }
    // Also save if: upgrade is 50%+ better AND almost ready (< 4 seconds)
    if (bestUnaffordable.action === 'upgrade' && valueRatio > 1.5 && bestUnaffordable.waitSecs <= 4) {
      return false;
    }
  }

  // If nothing affordable, skip
  if (!bestAffordable) return false;

  // Mistake: occasionally pick 2nd or 3rd best
  let pick = bestAffordable;
  if (diff.mistakeRate > 0 && affordableOptions.length > 1 && state.rng() < diff.mistakeRate) {
    pick = affordableOptions[Math.min(1, affordableOptions.length - 1)];
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

function botPlaceBuilding(
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

function botPlaceAlleyTower(state: GameState, playerId: number, emit: Emit): boolean {
  const myTeam = botTeam(playerId, state);
  const teamAlleyBuildings = state.buildings.filter(
    b => b.buildGrid === 'alley' && botTeam(b.playerId, state) === myTeam
  );
  const occupied = new Set(teamAlleyBuildings.map(b => `${b.gridX},${b.gridY}`));
  const freeSlots: { gx: number; gy: number }[] = [];
  for (let gy = 0; gy < state.mapDef.towerAlleyRows; gy++) {
    for (let gx = 0; gx < state.mapDef.towerAlleyCols; gx++) {
      if (!occupied.has(`${gx},${gy}`)) freeSlots.push({ gx, gy });
    }
  }
  if (freeSlots.length === 0) return false;
  // Place near lane paths (center columns) for maximum coverage
  const centerX = Math.floor(state.mapDef.towerAlleyCols / 2);
  freeSlots.sort((a, b) => Math.abs(a.gx - centerX) - Math.abs(b.gx - centerX) || a.gy - b.gy);
  const idx = Math.min(Math.floor(state.rng() * 3), freeSlots.length - 1);
  const slot = freeSlots[idx];
  emit({ type: 'place_building', playerId, buildingType: BuildingType.Tower, gridX: slot.gx, gridY: slot.gy, gridType: 'alley' });
  return true;
}

// ==================== UPGRADES ====================

function botUpgradeBuildings(
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
    if (player.gold < cost.gold || player.wood < cost.wood || player.stone < cost.stone) continue;
    if ((cost.deathEssence ?? 0) > 0 && player.deathEssence < (cost.deathEssence ?? 0)) continue;

    // Don't spend all resources on upgrades if we need buildings
    const resAfter = (player.gold - cost.gold) + (player.wood - cost.wood) + (player.stone - cost.stone);
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
      if (player.gold < rCost.gold || player.wood < rCost.wood || player.stone < rCost.stone) continue;
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

  // --- Demon: assign at least one harvester to Mana if we have 2+ harvesters ---
  if (player.race === Race.Demon && myHarvesters.length >= 2) {
    const manaCount = assignments.filter(a => a === HarvesterAssignment.Mana).length;
    if (manaCount === 0) {
      // Replace the last non-center assignment with Mana
      for (let i = assignments.length - 1; i >= 0; i--) {
        if (assignments[i] !== HarvesterAssignment.Center) {
          assignments[i] = HarvesterAssignment.Mana;
          break;
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
  return evaluateBestNukePlan(state, playerId, myTeam, myHqHp) !== null;
}

function botFireNuke(state: GameState, playerId: number, myTeam: Team, myHqHp: number, emit: Emit): void {
  const plan = evaluateBestNukePlan(state, playerId, myTeam, myHqHp);
  if (!plan) return;
  emit({ type: 'fire_nuke', playerId, x: plan.x, y: plan.y });
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

// ==================== RACE ABILITY ====================

function botUseAbility(state: GameState, playerId: number, emit: Emit): void {
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
    const stoneCost = Math.floor((def.baseCost.stone ?? 0) * growthMult);
    const manaCost = Math.floor((def.baseCost.mana ?? 0) * growthMult);
    const soulsCost = player.race === Race.Geists
      ? (def.baseCost.souls ?? 0) + 5 * player.abilityUseCount
      : Math.floor((def.baseCost.souls ?? 0) * growthMult);
    const essenceCost = Math.floor((def.baseCost.deathEssence ?? 0) * growthMult);

    if (player.gold < goldCost || player.wood < woodCost || player.stone < stoneCost) return;
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
    const targets = isAllyTarget
      ? state.units.filter(u => u.team === player.team && u.hp > 0)
      : state.units.filter(u => u.team === enemyTeam && u.hp > 0);
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

    if (bestScore >= 2) {
      emit({ type: 'use_ability', playerId, x: bestX, y: bestY });
    }
  } else if (def.targetMode === AbilityTargetMode.BuildSlot) {
    // BuildSlot abilities: use when affordable and there are open slots
    emit({ type: 'use_ability', playerId });
  }
}

// === Research Upgrade Bot Logic ===

/**
 * Simple timer-based research for Medium bots only.
 * Only buys attack upgrades. Skips if a spawner or hut is affordable (army/econ first).
 */
function botManageResearch(
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

  type UpgradeCandidate = { id: string; score: number; cost: { gold: number; wood: number; stone: number } };
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
    if (player.gold < cost.gold || player.wood < cost.wood || player.stone < cost.stone) continue;
    if ((cost.deathEssence ?? 0) > 0 && player.deathEssence < (cost.deathEssence ?? 0)) continue;
    if ((cost.souls ?? 0) > 0 && player.souls < (cost.souls ?? 0)) continue;

    // Score based on how many spawners of this category we have
    let categoryWeight = 0;
    if (def.category === 'melee') categoryWeight = meleeCount;
    else if (def.category === 'ranged') categoryWeight = rangedCount;
    else categoryWeight = casterCount;
    if (categoryWeight === 0) continue;

    let score = categoryWeight * 2; // attack multiplier
    const totalCost = cost.gold + cost.wood + cost.stone + (cost.deathEssence ?? 0) + (cost.souls ?? 0);
    score /= Math.max(1, totalCost / 100);

    candidates.push({ id: def.id, score, cost });
  }

  if (candidates.length === 0) return;

  // Sort by score descending — deterministic tie-break by id string comparison (no localeCompare)
  candidates.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const best = candidates[0];
  emit({ type: 'research_upgrade', playerId, upgradeId: best.id });
}

