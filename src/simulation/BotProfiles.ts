/**
 * BotProfiles.ts — Bot difficulty presets, race personality profiles, and composition strategies.
 *
 * This module defines the difficulty system, per-race build profiles, composition strategies
 * (heavyMelee, rush, turtle, etc.), profile rankings from balance sims, and matchup-aware
 * profile selection. Also contains bot context and intelligence type definitions.
 *
 * Part of the simulation layer — must remain fully deterministic.
 */

import {
  Race, HarvesterAssignment,
} from './types';

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
  /** Multiplier applied to bot unit HP and damage at spawn (1.0 = normal).
   *  Should stay at 1.0 for all difficulties — bots should win through better
   *  decisions, not inflated stats. Kept as infrastructure but not used. */
  statBonus: number;
}

export const BOT_DIFFICULTY_PRESETS: Record<BotDifficultyLevel, BotDifficulty> = {
  // Easy: profile-based build order, slow, capped, mistake-prone
  [BotDifficultyLevel.Easy]: {
    buildSpeed: 1200,         // 60 seconds between builds
    upgradeSpeed: 1200,       // 60 seconds between upgrades
    upgradeThreshold: 4,
    nukeMinTime: 8.0,
    laneIQ: 'random',
    counterBuild: false,
    useValueFunction: false,
    useDynamicShift: false,
    useSmartUpgrades: false,
    mistakeRate: 0.75,
    maxSpawners: 99,
    maxHuts: 99,
    nukeDefensiveOnly: false,
    statBonus: 1.0,
  },
  // Medium: smart upgrades, basic lanes, fewer mistakes
  [BotDifficultyLevel.Medium]: {
    buildSpeed: 800,          // 40 seconds between builds
    upgradeSpeed: 800,        // 40 seconds between upgrades
    upgradeThreshold: 4,
    nukeMinTime: 5.0,
    laneIQ: 'basic',
    counterBuild: false,
    useValueFunction: false,
    useDynamicShift: false,
    useSmartUpgrades: true,
    mistakeRate: 0.50,
    maxSpawners: 99,
    maxHuts: 99,
    nukeDefensiveOnly: false,
    statBonus: 1.0,
  },
  // Hard: value function, dynamic shifting, threat lanes, rare mistakes
  [BotDifficultyLevel.Hard]: {
    buildSpeed: 500,          // 25 seconds between builds
    upgradeSpeed: 500,        // 25 seconds between upgrades
    upgradeThreshold: 5,
    nukeMinTime: 3.0,
    laneIQ: 'threat',
    counterBuild: false,
    useValueFunction: true,
    useDynamicShift: true,
    useSmartUpgrades: true,
    mistakeRate: 0.25,
    maxSpawners: 99,
    maxHuts: 99,
    nukeDefensiveOnly: false,
    statBonus: 1.0,
  },
  // Nightmare: same systems as hard, near-perfect, higher caps
  [BotDifficultyLevel.Nightmare]: {
    buildSpeed: 200,          // 10 seconds between builds
    upgradeSpeed: 200,        // 10 seconds between upgrades
    upgradeThreshold: 4,
    nukeMinTime: 1.5,
    laneIQ: 'threat',
    counterBuild: false,
    useValueFunction: true,
    useDynamicShift: true,
    useSmartUpgrades: true,
    mistakeRate: 0.05,
    maxSpawners: 99,
    maxHuts: 99,
    nukeDefensiveOnly: false,
    statBonus: 1.0,
  },
};

// --- Bot personality profiles per race ---
export interface RaceProfile {
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
// HORDE (Gold+Meat+Wood, 100g/50w/50m start, all 3 passive)
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
// OOZLINGS (Gold+Meat, 200g/25s start, 20g/2s passive)
//   Melee spawns 2 at 60g (0.33 dps/cost!). Pure swarm.
//   Strategy: Rush 3 melee spawners for 6 units/wave. Huts later.
//   Overwhelm with bodies, bloater caster for AOE support.
//   Diamond: SKIP until late (meat-needy, harvesters better on resources)
//
// DEMON (Meat+Wood, 0g/50w/150s start, 2w/20s passive)
//   Glass cannon: 15.6 dps melee @ 46 cost. Burns everything.
//   Strategy: Rush melee (14w+32s, very cheap with meat start).
//   Build 2 melee + 1 ranged fast, hut after. Pure aggression.
//   Diamond: SKIP (no gold economy, harvesters wasted on center gold)
//
// DEEP (Wood+Gold, 50g/150w start, 2g/20w passive)
//   Tankiest units (226hp melee) but slow (2.5 move). Wood-rich.
//   Strategy: Ranged first (30g+55w, affordable). Econ-heavy — 3 huts.
//   Build tower early for defense while economy ramps. Slow push late.
//   Diamond: SKIP (gold-poor, harvesters should gather wood)
//
// WILD (Wood+Meat, 0g/150w/50s start, 20w/2s passive)
//   Poison + aggression. Ranged decent (7dps @ 53 cost). No gold.
//   Strategy: Melee + ranged early (both cheap in wood). 2 huts.
//   Push early while poison stacks. Caster for AOE poison mid.
//   Diamond: SKIP (no gold economy)
//
// GEISTS (Meat+Gold, 50g/0w/150s start, 2g/20s passive)
//   Undying melee (125hp + lifesteal). Meat-heavy costs.
//   Strategy: Rush melee (20g+35s, cheap). Lifesteal = sustain.
//   2 melee early, 1 hut, ranged mid. Grind enemies down.
//   Diamond: SKIP until late (meat economy, center gives gold)
//
// TENDERS (Wood+Gold+Meat, 50g/150w start, 2g/20w passive, huts generate all 3)
//   Tanky healers (120hp melee + regen). Expensive (75 total melee).
//   Strategy: Econ-first — 2 huts then melee. Sustain = win long fights.
//   Push aggressively once army built. Regen means attrition favors you.
//   Diamond: SKIP (wood-based, gold-poor)
// ======================================================================

// Whether a race should send harvesters to mine diamond center
export const RACE_LIKES_DIAMOND: Record<Race, boolean> = {
  [Race.Crown]: true,     // gold-based, diamond center = more gold
  [Race.Horde]: true,     // gold-based
  [Race.Goblins]: true,   // gold-based
  [Race.Oozlings]: false, // needs meat more than center gold
  [Race.Demon]: false,    // no gold economy at all
  [Race.Deep]: false,     // wood-primary, gold is secondary
  [Race.Wild]: false,     // no gold economy
  [Race.Geists]: false,   // meat-primary, gold is secondary
  [Race.Tenders]: false,  // wood-primary, gold is secondary
};

export const RACE_PROFILES: Record<Race, RaceProfile> = {
  // CROWN (Gold+Wood): Bowman is cheap (25w), Swordsman expensive (72g).
  // Get huts early for gold income, mix melee wall + ranged, Priests mid for shields.
  [Race.Crown]: {
    earlyMelee: 1, earlyRanged: 1, earlyHuts: 2, earlyTowers: 0,
    midMelee: 2, midRanged: 3, midCasters: 1, midTowers: 0, midHuts: 4,
    lateTowers: 1, alleyTowers: 2,
    meleeUpgradeBias: 'B', rangedUpgradeBias: 'C', casterUpgradeBias: 'B', towerUpgradeBias: 'C',
    vsSwarmExtraCasters: 1, vsTankExtraRanged: 1, vsGlassCannonExtraMelee: 1,
    maxHuts: 5, pushThreshold: 1.2,
  },
  // HORDE (Gold+Meat+Wood): Brute is best DPS/cost. 3-resource economy needs huts.
  // Diversify early for aura collection — melee wall + ranged + caster support.
  [Race.Horde]: {
    earlyMelee: 2, earlyRanged: 1, earlyHuts: 2, earlyTowers: 0,
    midMelee: 3, midRanged: 2, midCasters: 2, midTowers: 0, midHuts: 4,
    lateTowers: 1, alleyTowers: 2,
    meleeUpgradeBias: 'B', rangedUpgradeBias: 'B', casterUpgradeBias: 'B', towerUpgradeBias: 'B',
    vsSwarmExtraCasters: 1, vsTankExtraRanged: 1, vsGlassCannonExtraMelee: 0,
    maxHuts: 5, pushThreshold: 1.0,
  },
  // GOBLINS (Gold+Wood): Everything is cheap. Huts are 17.5 eff — go wide on economy first.
  // Cheap T0 units (Sticker 15 eff, Knifer 27.5 eff) mean early spawners pay off fast.
  // Flood with miners, then swarm melee+ranged, mix in Hexer casters for burn/slow.
  [Race.Goblins]: {
    earlyMelee: 2, earlyRanged: 2, earlyHuts: 3, earlyTowers: 0,
    midMelee: 5, midRanged: 4, midCasters: 1, midTowers: 0, midHuts: 5,
    lateTowers: 1, alleyTowers: 1,
    meleeUpgradeBias: 'C', rangedUpgradeBias: 'C', casterUpgradeBias: 'C', towerUpgradeBias: 'C',
    vsSwarmExtraCasters: 1, vsTankExtraRanged: 1, vsGlassCannonExtraMelee: 1,
    maxHuts: 6, pushThreshold: 0.9,
  },
  // OOZLINGS (Gold+Meat): x2 swarm on everything. Go super wide, deaths fuel ooze economy.
  // Lots of melee, some ranged/caster. Split ooze between upgrades and more spawners.
  [Race.Oozlings]: {
    earlyMelee: 3, earlyRanged: 0, earlyHuts: 1, earlyTowers: 0,
    midMelee: 5, midRanged: 1, midCasters: 1, midTowers: 0, midHuts: 3,
    lateTowers: 1, alleyTowers: 1,
    meleeUpgradeBias: 'C', rangedUpgradeBias: 'C', casterUpgradeBias: 'C', towerUpgradeBias: 'C',
    vsSwarmExtraCasters: 0, vsTankExtraRanged: 1, vsGlassCannonExtraMelee: 0,
    maxHuts: 4, pushThreshold: 0.9,
  },
  // DEMON (Meat+Wood): Glass cannon. Smasher melee + Eye Sniper ranged are both strong.
  // Rush melee+ranged, huts for wood/meat income. Overlord (caster) weak — skip early.
  // Save mana for big fireballs, upgrades last longer than fireballs.
  [Race.Demon]: {
    earlyMelee: 2, earlyRanged: 1, earlyHuts: 2, earlyTowers: 0,
    midMelee: 3, midRanged: 3, midCasters: 0, midTowers: 0, midHuts: 4,
    lateTowers: 1, alleyTowers: 1,
    meleeUpgradeBias: 'C', rangedUpgradeBias: 'B', casterUpgradeBias: 'B', towerUpgradeBias: 'B',
    vsSwarmExtraCasters: 1, vsTankExtraRanged: 1, vsGlassCannonExtraMelee: 0,
    maxHuts: 5, pushThreshold: 1.0,
  },
  // DEEP (Wood+Gold): Shell Guard tank (190 HP!) is the identity. Lead with melee wall.
  // Harpooner ranged is great DPS. Tidecaller mid for slow stacking. Econ-heavy.
  [Race.Deep]: {
    earlyMelee: 1, earlyRanged: 1, earlyHuts: 2, earlyTowers: 0,
    midMelee: 3, midRanged: 2, midCasters: 1, midTowers: 0, midHuts: 4,
    lateTowers: 1, alleyTowers: 2,
    meleeUpgradeBias: 'B', rangedUpgradeBias: 'C', casterUpgradeBias: 'C', towerUpgradeBias: 'C',
    vsSwarmExtraCasters: 1, vsTankExtraRanged: 1, vsGlassCannonExtraMelee: 0,
    maxHuts: 5, pushThreshold: 1.1,
  },
  // WILD (Wood+Meat): Heavy spiders (melee), meat-on-kill upgrades. Diversify casters.
  // Bonechucker ranged supports. Scaled Sage casters for AoE poison.
  [Race.Wild]: {
    earlyMelee: 2, earlyRanged: 1, earlyHuts: 2, earlyTowers: 0,
    midMelee: 3, midRanged: 2, midCasters: 1, midTowers: 0, midHuts: 4,
    lateTowers: 1, alleyTowers: 1,
    meleeUpgradeBias: 'C', rangedUpgradeBias: 'B', casterUpgradeBias: 'C', towerUpgradeBias: 'C',
    vsSwarmExtraCasters: 1, vsTankExtraRanged: 0, vsGlassCannonExtraMelee: 1,
    maxHuts: 5, pushThreshold: 1.0,
  },
  // GEISTS (Meat+Gold): Bone Knight melee (lifesteal sustain) + Wraith Bow ranged (cheap lifesteal).
  // Go taller on melee+ranged, Necromancer caster for summons. Use summon ability whenever up.
  [Race.Geists]: {
    earlyMelee: 1, earlyRanged: 1, earlyHuts: 2, earlyTowers: 0,
    midMelee: 2, midRanged: 3, midCasters: 1, midTowers: 0, midHuts: 4,
    lateTowers: 1, alleyTowers: 1,
    meleeUpgradeBias: 'B', rangedUpgradeBias: 'B', casterUpgradeBias: 'B', towerUpgradeBias: 'B',
    vsSwarmExtraCasters: 1, vsTankExtraRanged: 1, vsGlassCannonExtraMelee: 0,
    maxHuts: 5, pushThreshold: 1.0,
  },
  // TENDERS (Wood+Gold+Meat): Spread of units. Treant melee wall + Tinker ranged + Grove Keeper healer.
  // Econ-heavy to sustain expensive units. Spawn seeds, time them to pop together.
  [Race.Tenders]: {
    earlyMelee: 1, earlyRanged: 1, earlyHuts: 2, earlyTowers: 0,
    midMelee: 2, midRanged: 2, midCasters: 1, midTowers: 0, midHuts: 4,
    lateTowers: 1, alleyTowers: 2,
    meleeUpgradeBias: 'B', rangedUpgradeBias: 'C', casterUpgradeBias: 'B', towerUpgradeBias: 'C',
    vsSwarmExtraCasters: 1, vsTankExtraRanged: 1, vsGlassCannonExtraMelee: 0,
    maxHuts: 5, pushThreshold: 1.0,
  },
};

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
export const PROFILE_RANKINGS: Record<Race, ProfileId[]> = {
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
export const MATCHUP_PROFILES: Record<Race, Partial<Record<Race, ProfileId>>> = {
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
export function selectCompositionProfile(
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
  currentLane: Record<number, import('./types').Lane>;
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
export interface CategoryPerf {
  alive: number;
  avgHpPct: number;
  totalKills: number;
  buildingCount: number;
}

/** Forward-looking resource projection */
export interface ResourceProjection {
  totalGoldNeeded: number;
  totalWoodNeeded: number;
  totalMeatNeeded: number;
  goldIncome: number;
  woodIncome: number;
  meatIncome: number;
  goldSecsToTarget: number;
  woodSecsToTarget: number;
  meatSecsToTarget: number;
  bottleneck: HarvesterAssignment;
  /** Ideal harvester split: [gold, wood, meat, center] */
  idealSplit: [number, number, number, number];
}

/** Threat profile of enemy team — drives counter-building and upgrade selection */
export interface ThreatProfile {
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

/** Command emitter type */
export type Emit = (cmd: import('./types').GameCommand) => void;
