import { BuildingType, Race, TICK_RATE, AbilityTargetMode } from './types';
import type { RaceAbilityDef } from './types';

// Race-specific building costs
export const RACE_BUILDING_COSTS: Record<Race, Record<BuildingType, { gold: number; wood: number; stone: number; hp: number }>> = {
  // Crown: Gold+Wood economy. Premium gold cost for strong units.
  [Race.Crown]: {
    [BuildingType.MeleeSpawner]:  { gold: 85,  wood: 0,  stone: 0,  hp: 280 },
    [BuildingType.RangedSpawner]: { gold: 0,   wood: 30,  stone: 0,  hp: 230 },
    [BuildingType.CasterSpawner]: { gold: 75,  wood: 10, stone: 0,  hp: 200 },
    [BuildingType.Tower]:         { gold: 113, wood: 0,  stone: 10, hp: 220 },
    [BuildingType.HarvesterHut]:  { gold: 50,  wood: 0,  stone: 0,  hp: 150 },
    [BuildingType.Research]:      { gold: 0,   wood: 0,  stone: 0,  hp: 500 },
  },
  // Horde: All 3 resources. Melee=meat, Ranged=wood, Caster=gold. Collect one of each T3 for auras.
  [Race.Horde]: {
    [BuildingType.MeleeSpawner]:  { gold: 0,   wood: 0,  stone: 40, hp: 350 },
    [BuildingType.RangedSpawner]: { gold: 0,   wood: 40, stone: 0,  hp: 300 },
    [BuildingType.CasterSpawner]: { gold: 100, wood: 0,  stone: 0,  hp: 250 },
    [BuildingType.Tower]:         { gold: 50,  wood: 30, stone: 30, hp: 280 },
    [BuildingType.HarvesterHut]:  { gold: 30,  wood: 10, stone: 10, hp: 180 },
    [BuildingType.Research]:      { gold: 0,   wood: 0,  stone: 0,  hp: 500 },
  },
  // Goblins: Gold+Wood economy. Very cheap, fragile buildings.
  [Race.Goblins]: {
    [BuildingType.MeleeSpawner]:  { gold: 0,   wood: 15, stone: 0,  hp: 180 },
    [BuildingType.RangedSpawner]: { gold: 55,  wood: 0,  stone: 0,  hp: 160 },
    [BuildingType.CasterSpawner]: { gold: 44,  wood: 13, stone: 0,  hp: 140 },
    [BuildingType.Tower]:         { gold: 36,  wood: 12, stone: 0,  hp: 150 },
    [BuildingType.HarvesterHut]:  { gold: 21,  wood: 7,  stone: 0,  hp: 110 },
    [BuildingType.Research]:      { gold: 0,   wood: 0,  stone: 0,  hp: 500 },
  },
  // Oozlings: Gold+Stone economy. Cheap (swarm units).
  [Race.Oozlings]: {
    [BuildingType.MeleeSpawner]:  { gold: 60,  wood: 0,  stone: 0,  hp: 200 },
    [BuildingType.RangedSpawner]: { gold: 70,  wood: 0,  stone: 20, hp: 180 },
    [BuildingType.CasterSpawner]: { gold: 35,  wood: 0,  stone: 35, hp: 160 },
    [BuildingType.Tower]:         { gold: 75,  wood: 0,  stone: 19, hp: 170 },
    [BuildingType.HarvesterHut]:  { gold: 35,  wood: 0,  stone: 10, hp: 130 },
    [BuildingType.Research]:      { gold: 0,   wood: 0,  stone: 0,  hp: 500 },
  },
  // Demon: Stone+Wood economy. No gold. Glass cannon, reduced costs.
  [Race.Demon]: {
    [BuildingType.MeleeSpawner]:  { gold: 0,  wood: 12, stone: 27, hp: 200 },
    [BuildingType.RangedSpawner]: { gold: 0,  wood: 15, stone: 31, hp: 170 },
    [BuildingType.CasterSpawner]: { gold: 0,  wood: 20, stone: 38, hp: 140 },
    [BuildingType.Tower]:         { gold: 0,  wood: 15, stone: 32, hp: 160 },
    [BuildingType.HarvesterHut]:  { gold: 0,  wood: 8,  stone: 14, hp: 120 },
    [BuildingType.Research]:      { gold: 0,  wood: 0,  stone: 0,  hp: 500 },
  },
  // Deep: Wood+Gold economy. Very durable buildings.
  [Race.Deep]: {
    [BuildingType.MeleeSpawner]:  { gold: 68, wood: 10, stone: 0,  hp: 380 },
    [BuildingType.RangedSpawner]: { gold: 30, wood: 55, stone: 0,  hp: 300 },
    [BuildingType.CasterSpawner]: { gold: 30, wood: 55, stone: 0,  hp: 260 },
    [BuildingType.Tower]:         { gold: 23, wood: 53, stone: 0,  hp: 280 },
    [BuildingType.HarvesterHut]:  { gold: 15, wood: 30, stone: 0,  hp: 170 },
    [BuildingType.Research]:      { gold: 0,  wood: 0,  stone: 0,  hp: 500 },
  },
  // Wild: Wood+Stone economy. No gold. Medium buildings.
  [Race.Wild]: {
    [BuildingType.MeleeSpawner]:  { gold: 0,  wood: 30, stone: 15, hp: 250 },
    [BuildingType.RangedSpawner]: { gold: 0,  wood: 35, stone: 18, hp: 220 },
    [BuildingType.CasterSpawner]: { gold: 0,  wood: 40, stone: 22, hp: 190 },
    [BuildingType.Tower]:         { gold: 0,  wood: 34, stone: 19, hp: 200 },
    [BuildingType.HarvesterHut]:  { gold: 0,  wood: 18, stone: 8,  hp: 140 },
    [BuildingType.Research]:      { gold: 0,  wood: 0,  stone: 0,  hp: 500 },
  },
  // Geists: Stone+Gold economy. Medium buildings.
  [Race.Geists]: {
    [BuildingType.MeleeSpawner]:  { gold: 20, wood: 0,  stone: 35, hp: 240 },
    [BuildingType.RangedSpawner]: { gold: 25, wood: 0,  stone: 40, hp: 210 },
    [BuildingType.CasterSpawner]: { gold: 30, wood: 0,  stone: 48, hp: 180 },
    [BuildingType.Tower]:         { gold: 19, wood: 0,  stone: 41, hp: 180 },
    [BuildingType.HarvesterHut]:  { gold: 12, wood: 0,  stone: 18, hp: 130 },
    [BuildingType.Research]:      { gold: 0,  wood: 0,  stone: 0,  hp: 500 },
  },
  // Tenders: Wood+Gold economy. Durable natural buildings.
  [Race.Tenders]: {
    [BuildingType.MeleeSpawner]:  { gold: 0,  wood: 48, stone: 0,  hp: 320 },
    [BuildingType.RangedSpawner]: { gold: 60,  wood: 0,  stone: 0,  hp: 270 },
    [BuildingType.CasterSpawner]: { gold: 26, wood: 45, stone: 0,  hp: 240 },
    [BuildingType.Tower]:         { gold: 17, wood: 37, stone: 0,  hp: 300 },
    [BuildingType.HarvesterHut]:  { gold: 11, wood: 21, stone: 0,  hp: 160 },
    [BuildingType.Research]:      { gold: 0,  wood: 0,  stone: 0,  hp: 500 },
  },
};

// Backwards-compatible helper (used by code that doesn't have race context)
export function getBuildingCost(race: Race, type: BuildingType) {
  return RACE_BUILDING_COSTS[race][type];
}

// Keep old BUILDING_COSTS as Crown defaults for any code that still uses it
export const BUILDING_COSTS = RACE_BUILDING_COSTS[Race.Crown];

// Race-specific upgrade costs
export const RACE_UPGRADE_COSTS: Record<Race, { tier1: { gold: number; wood: number; stone: number; deathEssence?: number }; tier2: { gold: number; wood: number; stone: number; deathEssence?: number } }> = {
  [Race.Crown]:    { tier1: { gold: 55,  wood: 0,  stone: 0 },  tier2: { gold: 90,  wood: 30, stone: 0 } },
  [Race.Horde]:    { tier1: { gold: 30,  wood: 20, stone: 20 }, tier2: { gold: 60,  wood: 40, stone: 40 } },
  [Race.Goblins]:  { tier1: { gold: 45,  wood: 15, stone: 0 },  tier2: { gold: 90,  wood: 30, stone: 0 } },
  [Race.Oozlings]: { tier1: { gold: 50,  wood: 0,  stone: 15 }, tier2: { gold: 100, wood: 0,  stone: 30 } },
  [Race.Demon]:    { tier1: { gold: 0,   wood: 15, stone: 35 }, tier2: { gold: 0,   wood: 30, stone: 70 } },
  [Race.Deep]:     { tier1: { gold: 20,  wood: 35, stone: 0 },  tier2: { gold: 40,  wood: 70, stone: 0 } },
  [Race.Wild]:     { tier1: { gold: 0,   wood: 25, stone: 15 }, tier2: { gold: 0,   wood: 50, stone: 30 } },
  [Race.Geists]:   { tier1: { gold: 15,  wood: 0,  stone: 35 }, tier2: { gold: 30,  wood: 0,  stone: 70 } },
  [Race.Tenders]:  { tier1: { gold: 20,  wood: 35, stone: 0 },  tier2: { gold: 40,  wood: 70, stone: 0 } },
};

// Keep old flat export for backwards compat
export const UPGRADE_COSTS = RACE_UPGRADE_COSTS[Race.Crown];

// Get upgrade cost for a specific node, respecting per-node cost overrides
export function getNodeUpgradeCost(
  race: Race, buildingType: BuildingType, currentPathLen: number, choice?: string
): { gold: number; wood: number; stone: number; deathEssence?: number } {
  const costs = RACE_UPGRADE_COSTS[race];
  // Check per-node cost override
  if (choice) {
    const nodeDef = UPGRADE_TREES[race]?.[buildingType]?.[choice as 'B'|'C'|'D'|'E'|'F'|'G'];
    if (nodeDef?.cost) return nodeDef.cost;
  }
  return currentPathLen === 1 ? costs.tier1 : costs.tier2;
}

// Which resources a race actually uses (across buildings + upgrades)
export function getRaceUsedResources(race: Race): { gold: boolean; wood: boolean; stone: boolean } {
  const costs = RACE_BUILDING_COSTS[race];
  const upgrades = RACE_UPGRADE_COSTS[race];
  let gold = false, wood = false, stone = false;
  for (const c of Object.values(costs)) {
    if (c.gold > 0) gold = true;
    if (c.wood > 0) wood = true;
    if (c.stone > 0) stone = true;
  }
  for (const t of [upgrades.tier1, upgrades.tier2]) {
    if (t.gold > 0) gold = true;
    if (t.wood > 0) wood = true;
    if (t.stone > 0) stone = true;
  }
  return { gold, wood, stone };
}

/** Compute ideal harvester ratio for a race based on total resource spending profile.
 *  Returns { gold, wood, stone } where each is 0-1 and they sum to 1. */
export function getRaceResourceRatio(race: Race): { gold: number; wood: number; stone: number } {
  const costs = RACE_BUILDING_COSTS[race];
  const upgrades = RACE_UPGRADE_COSTS[race];
  let gold = 0, wood = 0, stone = 0;
  // Sum building costs (excluding Research which is free, and HarvesterHut which is meta)
  for (const [type, c] of Object.entries(costs)) {
    if (type === String(BuildingType.Research)) continue;
    gold += c.gold; wood += c.wood; stone += c.stone;
  }
  // Add upgrade costs (weight T1 and T2 equally — players buy both)
  for (const t of [upgrades.tier1, upgrades.tier2]) {
    gold += t.gold; wood += t.wood; stone += t.stone;
  }
  const total = gold + wood + stone;
  if (total === 0) return { gold: 1, wood: 0, stone: 0 };
  return { gold: gold / total, wood: wood / total, stone: stone / total };
}

// Escalating hut cost
export const HUT_COST_SCALE = 1.35;
export function HARVESTER_HUT_COST(hutIndex: number): number {
  return Math.floor(50 * Math.pow(HUT_COST_SCALE, hutIndex));
}

// Tower costs escalate faster than other slots (each subsequent tower costs more)
export const TOWER_COST_SCALE = 1.65;

// Harvester yields per trip (must match GameState.ts tickHarvesters)
export const GOLD_YIELD_PER_TRIP = 4;
export const WOOD_YIELD_PER_TRIP = 10;
export const STONE_YIELD_PER_TRIP = 10;

// Spawn interval in ticks
export const SPAWN_INTERVAL_TICKS = Math.round(16.8 * TICK_RATE); // 16.8 seconds (20% slower than 14s)

// Unit stats per race per building type
interface UnitStatDef {
  name: string;
  hp: number;
  damage: number;
  attackSpeed: number; // seconds
  moveSpeed: number; // tiles per second
  range: number; // tiles
  ascii: string; // display sprite
  spawnCount?: number; // units per spawn cycle (default 1)
}

type RaceUnits = Partial<Record<BuildingType, UnitStatDef>>;

export const UNIT_STATS: Record<Race, RaceUnits> = {
  // === CROWN (Humans) — Balanced Allrounders ===
  [Race.Crown]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Swordsman', hp: 94, damage: 11, attackSpeed: 1.1, moveSpeed: 3.5, range: 1, ascii: '[+]',
    },
    [BuildingType.RangedSpawner]: {
      name: 'Bowman', hp: 38, damage: 11, attackSpeed: 1.3, moveSpeed: 3.5, range: 7, ascii: '>>',
    },
    [BuildingType.CasterSpawner]: {
      name: 'Priest', hp: 44, damage: 13, attackSpeed: 2.2, moveSpeed: 3.0, range: 7, ascii: '{C}',
    },
  },
  // === HORDE (Orcs) — Brute Force ===
  [Race.Horde]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Brute', hp: 110, damage: 14, attackSpeed: 1.1, moveSpeed: 3.2, range: 1, ascii: '[#]',
    },
    [BuildingType.RangedSpawner]: {
      name: 'Bowcleaver', hp: 71, damage: 16, attackSpeed: 1.3, moveSpeed: 3.0, range: 7, ascii: '=>',
    },
    [BuildingType.CasterSpawner]: {
      name: 'War Chanter', hp: 56, damage: 15, attackSpeed: 2.0, moveSpeed: 3.2, range: 7, ascii: '{H}',
    },
  },
  // === GOBLINS — Speed & Trickery ===
  [Race.Goblins]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Sticker', hp: 61, damage: 9, attackSpeed: 0.9, moveSpeed: 5.0, range: 1, ascii: '/>',
    },
    [BuildingType.RangedSpawner]: {
      name: 'Knifer', hp: 29, damage: 10, attackSpeed: 1.0, moveSpeed: 4.5, range: 6, ascii: '~>',
    },
    [BuildingType.CasterSpawner]: {
      name: 'Hexer', hp: 31, damage: 10, attackSpeed: 2.2, moveSpeed: 3.5, range: 7, ascii: '{G}',
    },
  },
  // === OOZLINGS (Slimes) — Adaptive Swarm ===
  [Race.Oozlings]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Globule', hp: 46, damage: 5, attackSpeed: 0.9, moveSpeed: 4.2, range: 1, ascii: 'o', spawnCount: 2,
    },
    [BuildingType.RangedSpawner]: {
      name: 'Spitter', hp: 24, damage: 6, attackSpeed: 1.1, moveSpeed: 3.8, range: 6, ascii: 'O~', spawnCount: 2,
    },
    [BuildingType.CasterSpawner]: {
      name: 'Bloater', hp: 31, damage: 12, attackSpeed: 2.4, moveSpeed: 2.8, range: 6, ascii: '{O}', spawnCount: 2,
    },
  },
  // === DEMON — Glass Cannon Chaos ===
  [Race.Demon]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Smasher', hp: 75, damage: 10, attackSpeed: 1.0, moveSpeed: 4.2, range: 1, ascii: '/X\\',
    },
    [BuildingType.RangedSpawner]: {
      name: 'Eye Sniper', hp: 38, damage: 14, attackSpeed: 1.4, moveSpeed: 3.5, range: 8, ascii: '@>',
    },
    [BuildingType.CasterSpawner]: {
      name: 'Overlord', hp: 40, damage: 15, attackSpeed: 2.2, moveSpeed: 2.5, range: 7, ascii: '{D}',
    },
  },
  // === DEEP (Aquatic) — Control & Attrition ===
  [Race.Deep]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Shell Guard', hp: 190, damage: 8, attackSpeed: 1.2, moveSpeed: 2.5, range: 1, ascii: '|W|',
    },
    [BuildingType.RangedSpawner]: {
      name: 'Harpooner', hp: 55, damage: 16, attackSpeed: 1.3, moveSpeed: 3.2, range: 7, ascii: '->',
    },
    [BuildingType.CasterSpawner]: {
      name: 'Tidecaller', hp: 59, damage: 17, attackSpeed: 2.4, moveSpeed: 3.0, range: 7, ascii: '{~}',
    },
  },
  // === WILD (Beasts) — Aggression & Poison ===
  [Race.Wild]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Lurker', hp: 90, damage: 8, attackSpeed: 1.0, moveSpeed: 3.0, range: 1, ascii: '%#',
    },
    [BuildingType.RangedSpawner]: {
      name: 'Bonechucker', hp: 38, damage: 14, attackSpeed: 1.1, moveSpeed: 3.6, range: 6, ascii: '.@',
    },
    [BuildingType.CasterSpawner]: {
      name: 'Scaled Sage', hp: 42, damage: 13, attackSpeed: 2.2, moveSpeed: 3.5, range: 7, ascii: '{W}',
    },
  },
  // === GEISTS (Undead) — Undying Attrition ===
  [Race.Geists]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Bone Knight', hp: 115, damage: 8, attackSpeed: 1.1, moveSpeed: 3.5, range: 1, ascii: '~^',
    },
    [BuildingType.RangedSpawner]: {
      name: 'Wraith Bow', hp: 29, damage: 13, attackSpeed: 1.2, moveSpeed: 3.8, range: 7, ascii: '~>',
    },
    [BuildingType.CasterSpawner]: {
      name: 'Necromancer', hp: 32, damage: 13, attackSpeed: 2.4, moveSpeed: 3.0, range: 7, ascii: '{V}',
    },
  },
  // === TENDERS (Nature/Fey) — Sustain & Healing ===
  [Race.Tenders]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Treant', hp: 154, damage: 9, attackSpeed: 1.2, moveSpeed: 2.8, range: 1, ascii: '|T|',
    },
    [BuildingType.RangedSpawner]: {
      name: 'Tinker', hp: 33, damage: 13, attackSpeed: 1.1, moveSpeed: 4.0, range: 7, ascii: '.>',
    },
    [BuildingType.CasterSpawner]: {
      name: 'Grove Keeper', hp: 50, damage: 13, attackSpeed: 2.2, moveSpeed: 3.0, range: 7, ascii: '{Y}',
    },
  },
};

// Tower stats per race
export const TOWER_STATS: Record<Race, { hp: number; damage: number; attackSpeed: number; range: number; ascii: string }> = {
  [Race.Crown]:    { hp: 968,  damage: 10, attackSpeed: 1.5, range: 6, ascii: '[||]' },
  [Race.Horde]:    { hp: 1100, damage: 14, attackSpeed: 1.5, range: 6, ascii: '[HH]' },
  [Race.Goblins]:  { hp: 660,  damage: 10, attackSpeed: 1.1, range: 6, ascii: '[gg]' },
  [Race.Oozlings]: { hp: 748,  damage: 8,  attackSpeed: 0.9, range: 6, ascii: '[oo]' },
  [Race.Demon]:    { hp: 704,  damage: 18, attackSpeed: 2.0, range: 7, ascii: '<F>' },
  [Race.Deep]:     { hp: 1232, damage: 8,  attackSpeed: 1.1, range: 6, ascii: '(@)' },
  [Race.Wild]:     { hp: 880,  damage: 10, attackSpeed: 1.1, range: 6, ascii: '[*]' },
  [Race.Geists]:   { hp: 792,  damage: 12, attackSpeed: 1.3, range: 7, ascii: '{~}' },
  [Race.Tenders]:  { hp: 1144, damage: 8,  attackSpeed: 1.1, range: 5, ascii: '[^^]' },
};

// Race accent colors
export const RACE_COLORS: Record<Race, { primary: string; secondary: string }> = {
  [Race.Crown]:    { primary: '#ffd700', secondary: '#4a90d9' },
  [Race.Horde]:    { primary: '#c62828', secondary: '#8d6e63' },
  [Race.Goblins]:  { primary: '#2e7d32', secondary: '#aed581' },
  [Race.Oozlings]: { primary: '#00e5ff', secondary: '#7c4dff' },
  [Race.Demon]:    { primary: '#ff3d00', secondary: '#ff9100' },
  [Race.Deep]:     { primary: '#1565c0', secondary: '#00897b' },
  [Race.Wild]:     { primary: '#7b1fa2', secondary: '#ce93d8' },
  [Race.Geists]:   { primary: '#546e7a', secondary: '#b0bec5' },
  [Race.Tenders]:  { primary: '#33691e', secondary: '#a5d6a7' },
};

// Player colors: match building sprite variants (Blue/Purple/Red/Yellow)
export const PLAYER_COLORS: string[] = [
  '#2979ff',  // P0 - Blue (Blue Buildings)
  '#9c27b0',  // P1 - Purple (Purple Buildings)
  '#ff1744',  // P2 - Red (Red Buildings)
  '#fdd835',  // P3 - Yellow (Yellow Buildings)
  '#00bfa5',  // P4 - Teal (Black Buildings)
  '#ff6d00',  // P5 - Orange (shares sprite variant)
  '#4caf50',  // P6 - Green (shares sprite variant)
  '#00e5ff',  // P7 - Cyan (shares sprite variant)
];

// Harvester constants
export const HARVESTER_MOVE_SPEED = 3;           // tiles per second
export const MINE_TIME_BASE_TICKS = 2 * TICK_RATE;    // gold/wood/stone
export const MINE_TIME_DIAMOND_TICKS = 8 * TICK_RATE; // diamond extraction
export const HARVESTER_RESPAWN_TICKS = 10 * TICK_RATE;
export const HARVESTER_MIN_SEPARATION = 0.8;     // minimum tile distance between harvesters

// Tower constants
export const BASTION_TOWER_SHIELD_INTERVAL_TICKS = Math.round(8.8 * TICK_RATE); // 10% slower

// === Upgrade Tree Definitions ===

export interface UpgradeSpecial {
  dodgeChance?: number;         // 0-1, chance to avoid damage
  extraChainTargets?: number;   // additional chain targets on attack
  chainDamagePct?: number;      // chain damage multiplier (default 0.5)
  extraBurnStacks?: number;     // extra burn stacks on hit
  extraSlowStacks?: number;     // extra slow stacks on hit
  knockbackEveryN?: number;     // knockback every Nth hit (0=none)
  guaranteedHaste?: boolean;    // guaranteed haste on melee hit
  aoeRadiusBonus?: number;      // extra AoE radius for casters
  splashRadius?: number;        // ranged attack splash radius
  splashDamagePct?: number;     // splash damage multiplier
  shieldTargetBonus?: number;   // extra shield targets (Crown caster)
  shieldAbsorbBonus?: number;   // extra shield absorb amount
  regenPerSec?: number;         // HP regen per second
  damageReductionPct?: number;  // % damage reduction
  reviveHpPct?: number;         // revive once at this % HP
  multishotCount?: number;      // extra projectiles per attack
  multishotDamagePct?: number;  // damage per extra projectile
  towerRangeBonus?: number;     // extra tower range
  towerShieldIntervalMult?: number; // multiply shield interval (lower = faster)
  healBonus?: number;           // extra heal amount for support casters
  cleaveTargets?: number;       // melee hits N additional adjacent enemies (Minotaur)
  hopAttack?: boolean;          // unit leaps to target, AoE slow on landing (Frogs)
  spawnCount?: number;          // override base spawnCount (e.g. Spider Brood=3, Spider Swarm=5)
  goldOnKill?: number;          // earn N gold when this unit kills an enemy
  goldOnDeath?: number;         // earn N gold when this unit dies
  explodeOnDeath?: boolean;     // Oozlings baneling: explode on death dealing AoE damage
  explodeDamage?: number;       // damage dealt by explosion
  explodeRadius?: number;       // explosion radius in tiles
  skeletonSummonChance?: number; // Geists caster: chance (0-1) to summon mini-skeleton on nearby death
  crownMage?: boolean;           // Crown caster mage branch: fire AoE damage instead of shielding
  // Siege unit properties
  isSiegeUnit?: boolean;         // marks this as a siege unit (targets buildings, slow, long range, AoE)
  buildingDamageMult?: number;   // damage multiplier vs buildings on projectile impact (e.g. 4.0 = 4x)
  // Horde auras (affect nearby allies within ~5 tiles)
  auraDamageBonus?: number;      // +flat damage to nearby allies
  auraSpeedBonus?: number;       // +% move speed to nearby allies (0.1 = +10%)
  auraArmorBonus?: number;       // +% damage reduction to nearby allies (0.1 = 10%)
  // Geist Soul Gorger: grows stronger from nearby deaths
  soulHarvest?: boolean;           // enable soul harvest mechanic
  soulHarvestRadius?: number;      // radius to detect deaths (default 8)
  soulMaxStacks?: number;          // max stacks (default 20)
  // Demon kill-scaling: damage increases per kill
  killScaling?: boolean;           // enable kill-scaling mechanic
  killDmgPct?: number;            // +dmg% per kill (default 0.05 = 5%)
  killMaxStacks?: number;         // max kills that count (default 10)
}

export interface UpgradeNodeDef {
  name: string;
  desc: string;
  hpMult?: number;
  damageMult?: number;
  attackSpeedMult?: number;   // <1 = faster
  moveSpeedMult?: number;
  rangeMult?: number;
  spawnSpeedMult?: number;    // <1 = faster spawns (e.g. 0.85 = 15% faster). Stacks across tiers.
  special?: UpgradeSpecial;
  cost?: { gold: number; wood: number; stone: number };  // per-node cost override (replaces race tier default)
}

type UpgradeNode = 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

// Upgrade trees: Race -> BuildingType -> Node -> Definition
// Tree shape: A (base) -> B or C (tier 1) -> D/E (under B) or F/G (under C)
export const UPGRADE_TREES: Record<Race, Partial<Record<BuildingType, Record<UpgradeNode, UpgradeNodeDef>>>> = {
  // ============ CROWN (Humans) — Shield & Balance [HYBRID] ============
  [Race.Crown]: {
    [BuildingType.MeleeSpawner]: {
      B: { name: 'Buccaneer', desc: '+20% dmg, +3 gold/kill', damageMult: 1.20, special: { goldOnKill: 3 }, spawnSpeedMult: 0.88 },
      C: { name: 'Noble', desc: '+20% speed, faster atk', moveSpeedMult: 1.20, attackSpeedMult: 0.85, spawnSpeedMult: 0.88 },
      D: { name: 'Corsair Captain', desc: '+40% HP, +5 gold/death', hpMult: 1.40, special: { goldOnDeath: 5, goldOnKill: 3 }, spawnSpeedMult: 0.82 },
      E: { name: 'Pirate King', desc: '+35% dmg, +6 gold/kill', damageMult: 1.35, special: { goldOnKill: 6, goldOnDeath: 8 }, spawnSpeedMult: 0.82 },
      F: { name: 'King', desc: '+15% dmg, +30% speed, 30% dodge', damageMult: 1.15, moveSpeedMult: 1.30, special: { dodgeChance: 0.30 }, spawnSpeedMult: 0.82 },
      G: { name: 'Champion', desc: '+50% dmg, faster atk', damageMult: 1.50, attackSpeedMult: 0.80, spawnSpeedMult: 0.82 },
    },
    [BuildingType.RangedSpawner]: {
      B: { name: 'Heavy Bow', desc: '+30% HP, +25% dmg', hpMult: 1.30, damageMult: 1.25, spawnSpeedMult: 0.88 },
      C: { name: 'Dwarfette Scout', desc: '+15% speed, faster atk', moveSpeedMult: 1.15, attackSpeedMult: 0.80, spawnSpeedMult: 0.88 },
      D: { name: 'Longbow', desc: '+40% dmg, +25% range', damageMult: 1.40, rangeMult: 1.25, spawnSpeedMult: 0.82 },
      E: { name: 'War Bow', desc: '+35% dmg, splash 2t', damageMult: 1.35, special: { splashRadius: 2, splashDamagePct: 0.50 }, spawnSpeedMult: 0.82 },
      F: { name: 'Dwarfette Blitzer', desc: 'Much faster, +25% range', attackSpeedMult: 0.70, rangeMult: 1.25, spawnSpeedMult: 0.82 },
      G: { name: 'Trebuchet', desc: 'SIEGE: 13 range, slow, fragile, devastating vs buildings', hpMult: 0.50, damageMult: 2.16, attackSpeedMult: 3.40, moveSpeedMult: 0.38, rangeMult: 1.85, spawnSpeedMult: 0.82, special: { isSiegeUnit: true, buildingDamageMult: 4.0, splashRadius: 3, splashDamagePct: 0.65 } },
    },
    [BuildingType.CasterSpawner]: {
      B: { name: 'High Priest', desc: '+30% HP, shield +2 targets', hpMult: 1.30, special: { shieldTargetBonus: 2 }, spawnSpeedMult: 0.88 },
      C: { name: 'War Mage', desc: 'AoE damage, +40% dmg', damageMult: 1.40, special: { crownMage: true, aoeRadiusBonus: 1 }, spawnSpeedMult: 0.88 },
      D: { name: 'Arch Bishop', desc: '+40% HP, shield +3 targets', hpMult: 1.40, special: { shieldTargetBonus: 3 }, spawnSpeedMult: 0.82 },
      E: { name: 'War Cleric', desc: '+35% dmg, shield +20 absorb', damageMult: 1.35, special: { shieldAbsorbBonus: 20 }, spawnSpeedMult: 0.82 },
      F: { name: 'Battle Magus', desc: '+50% dmg, burn on hit', damageMult: 1.50, special: { crownMage: true, aoeRadiusBonus: 2, extraBurnStacks: 1 }, spawnSpeedMult: 0.82 },
      G: { name: 'Archmage', desc: '+80% dmg, large AoE, burn', damageMult: 1.80, rangeMult: 1.25, special: { crownMage: true, aoeRadiusBonus: 3, extraBurnStacks: 2 }, spawnSpeedMult: 0.82 },
    },
    [BuildingType.Tower]: {
      B: { name: 'Reinforced Tower', desc: '+60% HP, +30% dmg', hpMult: 1.60, damageMult: 1.30 },
      C: { name: 'Rapid Tower', desc: 'Faster atk, +range', attackSpeedMult: 0.75, special: { towerRangeBonus: 1 } },
      D: { name: 'Fortress Tower', desc: '+150% HP, +range', hpMult: 2.50, special: { towerRangeBonus: 2 } },
      E: { name: 'War Tower', desc: '+50% dmg, +2 range', damageMult: 1.50, special: { towerRangeBonus: 2 } },
      F: { name: 'Gatling Tower', desc: 'Very fast, +range', attackSpeedMult: 0.60, special: { towerRangeBonus: 2 } },
      G: { name: 'Siege Tower', desc: '+60% dmg, +3 range', damageMult: 1.60, special: { towerRangeBonus: 3 } },
    },
  },
  // ============ HORDE (Orcs) — All 3 Resources, Aura T3 Units [HYBRID] ============
  // Melee costs meat (B=meat path, C=gold path). Ranged costs wood (B=wood, C=meat). Caster costs gold (B=gold, C=wood).
  // T3 units grant auras — collect one of each for a powerful combined army.
  [Race.Horde]: {
    [BuildingType.MeleeSpawner]: {
      // B path = meat (stays on starting resource)
      B: { name: 'Iron Brute', desc: '+45% HP, +20% dmg', hpMult: 1.45, damageMult: 1.20, spawnSpeedMult: 0.88, cost: { gold: 0, wood: 0, stone: 45 } },
      // C path = gold (switches resource)
      C: { name: 'Raging Brute', desc: '+30% dmg, faster atk', damageMult: 1.30, attackSpeedMult: 0.85, spawnSpeedMult: 0.88, cost: { gold: 45, wood: 0, stone: 0 } },
      // D,E under B (meat)
      D: { name: 'Warchief', desc: '+70% HP, AURA: +10% armor', hpMult: 1.70, special: { damageReductionPct: 0.15, auraArmorBonus: 0.10 }, spawnSpeedMult: 0.82, cost: { gold: 0, wood: 0, stone: 90 } },
      E: { name: 'Berserker', desc: '+55% dmg, AURA: +3 dmg', damageMult: 1.55, special: { knockbackEveryN: 2, auraDamageBonus: 3 }, spawnSpeedMult: 0.82, cost: { gold: 0, wood: 0, stone: 90 } },
      // F,G under C (gold)
      F: { name: 'Bloodrager', desc: '+50% dmg, AURA: +10% speed', damageMult: 1.50, special: { guaranteedHaste: true, auraSpeedBonus: 0.10 }, spawnSpeedMult: 0.82, cost: { gold: 90, wood: 0, stone: 0 } },
      G: { name: 'Skull Crusher', desc: '+60% dmg, AURA: +4 dmg', damageMult: 1.60, attackSpeedMult: 0.80, special: { auraDamageBonus: 4 }, spawnSpeedMult: 0.82, cost: { gold: 90, wood: 0, stone: 0 } },
    },
    [BuildingType.RangedSpawner]: {
      // B path = wood (stays on starting resource)
      B: { name: 'Heavy Cleaver', desc: '+30% HP, +30% dmg', hpMult: 1.30, damageMult: 1.30, spawnSpeedMult: 0.88, cost: { gold: 0, wood: 45, stone: 0 } },
      // C path = full SIEGE path (all 3 nodes are siege)
      C: { name: 'Orc Catapult', desc: 'SIEGE: 11 range, slow, devastating vs buildings', hpMult: 0.65, damageMult: 1.68, attackSpeedMult: 2.00, moveSpeedMult: 0.55, rangeMult: 1.57, spawnSpeedMult: 0.88, cost: { gold: 0, wood: 0, stone: 45 }, special: { isSiegeUnit: true, buildingDamageMult: 3.0, splashRadius: 2.5, splashDamagePct: 0.55, auraDamageBonus: 2 } },
      // D,E under B (wood) — normal ranged
      D: { name: 'War Thrower', desc: '+45% dmg, AURA: +10% speed', damageMult: 1.45, special: { knockbackEveryN: 2, auraSpeedBonus: 0.10 }, spawnSpeedMult: 0.82, cost: { gold: 0, wood: 90, stone: 0 } },
      E: { name: 'Battle Cleaver', desc: '+40% dmg, splash, AURA: +2 dmg', damageMult: 1.40, special: { splashRadius: 2, splashDamagePct: 0.55, auraDamageBonus: 2 }, spawnSpeedMult: 0.82, cost: { gold: 0, wood: 90, stone: 0 } },
      // F,G under C (siege T3s)
      F: { name: 'Horde Bombard', desc: 'SIEGE: 13 range, AURA: +10% armor', hpMult: 0.76, damageMult: 1.72, attackSpeedMult: 1.35, moveSpeedMult: 0.79, rangeMult: 1.18, spawnSpeedMult: 0.82, cost: { gold: 0, wood: 0, stone: 90 }, special: { isSiegeUnit: true, buildingDamageMult: 4.0, splashRadius: 3.5, splashDamagePct: 0.65, auraArmorBonus: 0.10 } },
      G: { name: 'Doom Catapult', desc: 'SIEGE: 14 range, massive AoE, AURA: +4 dmg', hpMult: 0.87, damageMult: 2.04, attackSpeedMult: 1.46, moveSpeedMult: 0.73, rangeMult: 1.27, spawnSpeedMult: 0.82, cost: { gold: 0, wood: 0, stone: 90 }, special: { isSiegeUnit: true, buildingDamageMult: 5.0, splashRadius: 4, splashDamagePct: 0.70, auraDamageBonus: 4 } },
    },
    [BuildingType.CasterSpawner]: {
      // B path = gold (stays on starting resource)
      B: { name: 'Battle Chanter', desc: '+30% HP, +5 haste targets', hpMult: 1.30, special: { healBonus: 5 }, spawnSpeedMult: 0.88, cost: { gold: 45, wood: 0, stone: 0 } },
      // C path = wood (switches resource)
      C: { name: 'War Drummer', desc: 'Faster atk, +25% range', attackSpeedMult: 0.80, rangeMult: 1.25, spawnSpeedMult: 0.88, cost: { gold: 0, wood: 45, stone: 0 } },
      // D,E under B (gold)
      D: { name: 'Blood Chanter', desc: '+40% dmg, AURA: +3 dmg', damageMult: 1.40, special: { healBonus: 8, auraDamageBonus: 3 }, spawnSpeedMult: 0.82, cost: { gold: 90, wood: 0, stone: 0 } },
      E: { name: 'Rage Shaman', desc: '+45% dmg, AURA: +15% speed', damageMult: 1.45, special: { aoeRadiusBonus: 2, auraSpeedBonus: 0.15 }, spawnSpeedMult: 0.82, cost: { gold: 90, wood: 0, stone: 0 } },
      // F,G under C (wood)
      F: { name: 'Swift Chanter', desc: 'Very fast, AURA: +10% armor', attackSpeedMult: 0.65, special: { healBonus: 5, auraArmorBonus: 0.10 }, spawnSpeedMult: 0.82, cost: { gold: 0, wood: 90, stone: 0 } },
      G: { name: 'Doom Chanter', desc: '+55% dmg, AURA: +4 dmg', damageMult: 1.55, rangeMult: 1.30, special: { auraDamageBonus: 4 }, spawnSpeedMult: 0.82, cost: { gold: 0, wood: 90, stone: 0 } },
    },
    [BuildingType.Tower]: {
      B: { name: 'Orc Palisade', desc: '+60% HP, +35% dmg', hpMult: 1.60, damageMult: 1.35 },
      C: { name: 'Spiked Palisade', desc: 'Faster atk, +range', attackSpeedMult: 0.75, special: { towerRangeBonus: 1 } },
      D: { name: 'War Palisade', desc: '+150% HP, +range', hpMult: 2.50, special: { towerRangeBonus: 2 } },
      E: { name: 'Siege Palisade', desc: '+55% dmg, +2 range', damageMult: 1.55, special: { towerRangeBonus: 2 } },
      F: { name: 'Rapid Palisade', desc: 'Very fast, +range', attackSpeedMult: 0.60, special: { towerRangeBonus: 2 } },
      G: { name: 'Doom Palisade', desc: '+65% dmg, +3 range', damageMult: 1.65, special: { towerRangeBonus: 3 } },
    },
  },
  // ============ GOBLINS — Dodge & Poison [WIDE] ============
  [Race.Goblins]: {
    [BuildingType.MeleeSpawner]: {
      B: { name: 'Troll Brute', desc: '+30% HP, +15% dmg', hpMult: 1.30, damageMult: 1.15, spawnSpeedMult: 0.80 },
      C: { name: 'Quick Sticker', desc: '+25% speed, faster atk', moveSpeedMult: 1.25, attackSpeedMult: 0.85, spawnSpeedMult: 0.80 },
      D: { name: 'Troll Smasher', desc: '+30% dmg, +2 burn', damageMult: 1.30, special: { extraBurnStacks: 2 }, spawnSpeedMult: 0.70 },
      E: { name: 'Troll Warlord', desc: '+40% dmg, +2 slow', damageMult: 1.40, special: { extraSlowStacks: 2 } },
      F: { name: 'Shadow Sticker', desc: '+35% speed, 30% dodge', moveSpeedMult: 1.35, special: { dodgeChance: 0.30 }, spawnSpeedMult: 0.70 },
      G: { name: 'Goblin Ace', desc: '+45% dmg, faster atk', damageMult: 1.45, attackSpeedMult: 0.80 },
    },
    [BuildingType.RangedSpawner]: {
      B: { name: 'Venom Knifer', desc: '+25% dmg, +2 burn', damageMult: 1.25, special: { extraBurnStacks: 2 }, spawnSpeedMult: 0.80 },
      C: { name: 'War Pig', desc: 'Faster atk, +20% range', attackSpeedMult: 0.80, rangeMult: 1.20, spawnSpeedMult: 0.80 },
      D: { name: 'Plague Knifer', desc: '+35% dmg, +3 burn', damageMult: 1.35, special: { extraBurnStacks: 3 }, spawnSpeedMult: 0.70 },
      E: { name: 'Fan Knifer', desc: 'Fires 2 projectiles', special: { multishotCount: 1, multishotDamagePct: 0.70 } },
      F: { name: 'King Pig', desc: '+30% speed, 25% dodge', moveSpeedMult: 1.30, special: { dodgeChance: 0.25 }, spawnSpeedMult: 0.70 },
      G: { name: 'Goblin Mortar', desc: 'SIEGE: 13 range, slow, devastating vs buildings', hpMult: 0.50, damageMult: 2.40, attackSpeedMult: 3.20, moveSpeedMult: 0.38, rangeMult: 1.88, spawnSpeedMult: 0.82, special: { isSiegeUnit: true, buildingDamageMult: 4.0, splashRadius: 3, splashDamagePct: 0.65, extraBurnStacks: 1 } },
    },
    [BuildingType.CasterSpawner]: {
      B: { name: 'Hex Master', desc: '+25% HP, +3 slow', hpMult: 1.25, special: { extraSlowStacks: 3 }, spawnSpeedMult: 0.80 },
      C: { name: 'Curse Weaver', desc: 'Faster atk, +20% range', attackSpeedMult: 0.80, rangeMult: 1.20, spawnSpeedMult: 0.80 },
      D: { name: 'Grand Hexer', desc: '+35% dmg, +4 slow', damageMult: 1.35, special: { extraSlowStacks: 4 }, spawnSpeedMult: 0.70 },
      E: { name: 'Plague Hexer', desc: '+40% dmg, +2 AoE', damageMult: 1.40, special: { aoeRadiusBonus: 2 } },
      F: { name: 'Rapid Hexer', desc: 'Very fast, +25% range', attackSpeedMult: 0.65, rangeMult: 1.25, spawnSpeedMult: 0.70 },
      G: { name: 'Doom Hexer', desc: '+50% dmg, +30% range', damageMult: 1.50, rangeMult: 1.30 },
    },
    [BuildingType.Tower]: {
      B: { name: 'Goblin Fort', desc: '+50% HP, +30% dmg', hpMult: 1.50, damageMult: 1.30 },
      C: { name: 'Rapid Fort', desc: 'Much faster, +range', attackSpeedMult: 0.70, special: { towerRangeBonus: 1 } },
      D: { name: 'Poison Fort', desc: '+80% HP, +2 burn', hpMult: 1.80, special: { extraBurnStacks: 2 } },
      E: { name: 'Venom Fort', desc: '+40% dmg, +3 burn', damageMult: 1.40, special: { extraBurnStacks: 3 } },
      F: { name: 'Blitz Fort', desc: 'Very fast, +2 range', attackSpeedMult: 0.55, special: { towerRangeBonus: 2 } },
      G: { name: 'Plague Fort', desc: '+55% dmg, +3 range', damageMult: 1.55, special: { towerRangeBonus: 3 } },
    },
  },
  // ============ OOZLINGS (Slimes) — Swarm & Haste [WIDE] ============
  [Race.Oozlings]: {
    [BuildingType.MeleeSpawner]: {
      B: { name: 'Tough Glob', desc: '+35% HP, +20% dmg', hpMult: 1.35, damageMult: 1.20, spawnSpeedMult: 0.80 },
      C: { name: 'Baneling', desc: '+40% speed, explodes on death', moveSpeedMult: 1.40, spawnSpeedMult: 0.80, special: { explodeOnDeath: true, explodeDamage: 35, explodeRadius: 3 } },
      D: { name: 'Armored Glob', desc: '+55% HP, 15% dmg reduction', hpMult: 1.55, special: { damageReductionPct: 0.15 }, spawnSpeedMult: 0.70 },
      E: { name: 'Acid Glob', desc: '+40% dmg, +2 burn', damageMult: 1.40, special: { extraBurnStacks: 2 } },
      F: { name: 'Volatile', desc: '+50% speed, big explosion', moveSpeedMult: 1.50, spawnSpeedMult: 0.70, special: { explodeOnDeath: true, explodeDamage: 60, explodeRadius: 4 } },
      G: { name: 'Detonator', desc: 'Huge explosion, +3 burn', moveSpeedMult: 1.30, spawnSpeedMult: 0.70, special: { explodeOnDeath: true, explodeDamage: 90, explodeRadius: 5, extraBurnStacks: 3 } },
    },
    [BuildingType.RangedSpawner]: {
      B: { name: 'Thick Spitter', desc: '+30% HP, +25% dmg', hpMult: 1.30, damageMult: 1.25, spawnSpeedMult: 0.80 },
      C: { name: 'Rapid Spitter', desc: 'Faster atk, +15% speed', attackSpeedMult: 0.80, moveSpeedMult: 1.15, spawnSpeedMult: 0.80 },
      D: { name: 'Acid Spitter', desc: '+35% dmg, +2 slow', damageMult: 1.35, special: { extraSlowStacks: 2 }, spawnSpeedMult: 0.70 },
      E: { name: 'Burst Spitter', desc: '+30% dmg, splash 2t', damageMult: 1.30, special: { splashRadius: 2, splashDamagePct: 0.50 } },
      F: { name: 'Hyper Spitter', desc: 'Much faster, +25% range', attackSpeedMult: 0.70, rangeMult: 1.25, spawnSpeedMult: 0.70 },
      G: { name: 'Glob Siege', desc: 'SIEGE: 1 giant glob, 12 range, slow, devastating vs buildings', hpMult: 2.20, damageMult: 4.56, attackSpeedMult: 3.20, moveSpeedMult: 0.35, rangeMult: 1.95, spawnSpeedMult: 0.82, special: { isSiegeUnit: true, buildingDamageMult: 4.0, splashRadius: 3, splashDamagePct: 0.65, spawnCount: 1, extraSlowStacks: 2 } },
    },
    [BuildingType.CasterSpawner]: {
      B: { name: 'Big Bloater', desc: '+30% HP, +1 AoE', hpMult: 1.30, special: { aoeRadiusBonus: 1 }, spawnSpeedMult: 0.80 },
      C: { name: 'Quick Bloater', desc: 'Faster atk, +20% range', attackSpeedMult: 0.80, rangeMult: 1.20, spawnSpeedMult: 0.80 },
      D: { name: 'Mega Bloater', desc: '+40% dmg, +1 AoE', damageMult: 1.40, special: { aoeRadiusBonus: 1 }, spawnSpeedMult: 0.70 },
      E: { name: 'Acid Bloater', desc: '+35% dmg, +3 slow', damageMult: 1.35, special: { extraSlowStacks: 3 } },
      F: { name: 'Hyper Bloater', desc: 'Very fast, +25% range', attackSpeedMult: 0.65, rangeMult: 1.25, spawnSpeedMult: 0.70 },
      G: { name: 'Ooze Lord', desc: '+50% dmg, +30% range', damageMult: 1.50, rangeMult: 1.30 },
    },
    [BuildingType.Tower]: {
      B: { name: 'Slime Pillar', desc: '+50% HP, +30% dmg', hpMult: 1.50, damageMult: 1.30 },
      C: { name: 'Rapid Pillar', desc: 'Much faster, +2 chain', attackSpeedMult: 0.70, special: { extraChainTargets: 2 } },
      D: { name: 'Grand Pillar', desc: '+100% HP, +range', hpMult: 2.00, special: { towerRangeBonus: 2 } },
      E: { name: 'Acid Pillar', desc: '+45% dmg, +2 slow', damageMult: 1.45, special: { extraSlowStacks: 2 } },
      F: { name: 'Storm Pillar', desc: '+3 chains, faster', attackSpeedMult: 0.60, special: { extraChainTargets: 3 } },
      G: { name: 'Ooze Beacon', desc: '+55% dmg, +3 range', damageMult: 1.55, special: { towerRangeBonus: 3 } },
    },
  },
  // ============ DEMON — Burn & Burst [HYBRID] ============
  [Race.Demon]: {
    [BuildingType.MeleeSpawner]: {
      B: { name: 'Inferno Smasher', desc: '+30% HP, +35% dmg', hpMult: 1.30, damageMult: 1.35, spawnSpeedMult: 0.88 },
      C: { name: 'Blaze Smasher', desc: '+25% speed, faster atk', moveSpeedMult: 1.25, attackSpeedMult: 0.85, spawnSpeedMult: 0.88 },
      D: { name: 'Doom Smasher', desc: '+50% dmg, +2 burn', damageMult: 1.50, special: { extraBurnStacks: 2 }, spawnSpeedMult: 0.82 },
      E: { name: 'Bloodfire Berserker', desc: '+20% dmg, +5% dmg per kill (max 10)', damageMult: 1.20, spawnSpeedMult: 0.82, special: { killScaling: true, killDmgPct: 0.05, killMaxStacks: 10 } },
      F: { name: 'Phoenix Blade', desc: '+20% dmg, +30% speed, revive 60%', damageMult: 1.20, moveSpeedMult: 1.30, special: { reviveHpPct: 0.60 }, spawnSpeedMult: 0.82 },
      G: { name: 'Magma Smasher', desc: '+55% dmg, +3 burn', damageMult: 1.55, special: { extraBurnStacks: 3 }, spawnSpeedMult: 0.82 },
    },
    [BuildingType.RangedSpawner]: {
      B: { name: 'Flame Sniper', desc: '+35% dmg, +20% range', damageMult: 1.35, rangeMult: 1.20, spawnSpeedMult: 0.88 },
      C: { name: 'Rapid Eye', desc: 'Faster atk, +15% speed', attackSpeedMult: 0.80, moveSpeedMult: 1.15, spawnSpeedMult: 0.88 },
      D: { name: 'Meteor Eye', desc: '+45% dmg, splash 2t', damageMult: 1.45, special: { splashRadius: 2, splashDamagePct: 0.60 }, spawnSpeedMult: 0.82 },
      E: { name: 'Inferno Reaper', desc: '+20% dmg, +5% dmg per kill (max 10)', damageMult: 1.20, spawnSpeedMult: 0.82, special: { killScaling: true, killDmgPct: 0.05, killMaxStacks: 10 } },
      F: { name: 'Blitz Eye', desc: 'Very fast, +30% range', attackSpeedMult: 0.70, rangeMult: 1.30, spawnSpeedMult: 0.82 },
      G: { name: 'Brimstone Cannon', desc: 'SIEGE: 14 range, slow, devastating vs buildings + burns', hpMult: 0.50, damageMult: 2.16, attackSpeedMult: 3.20, moveSpeedMult: 0.35, rangeMult: 1.75, spawnSpeedMult: 0.82, special: { isSiegeUnit: true, buildingDamageMult: 4.0, splashRadius: 3.5, splashDamagePct: 0.65, extraBurnStacks: 2 } },
    },
    [BuildingType.CasterSpawner]: {
      B: { name: 'Hellfire Lord', desc: '+25% HP, +40% dmg', hpMult: 1.25, damageMult: 1.40, spawnSpeedMult: 0.88 },
      C: { name: 'Pyro Lord', desc: 'Faster atk, +25% range', attackSpeedMult: 0.80, rangeMult: 1.25, spawnSpeedMult: 0.88 },
      D: { name: 'Apocalypse Lord', desc: '+50% dmg, +3 burn', damageMult: 1.50, special: { extraBurnStacks: 3 }, spawnSpeedMult: 0.82 },
      E: { name: 'Eruption Lord', desc: '+45% dmg, +1 AoE', damageMult: 1.45, special: { aoeRadiusBonus: 1 }, spawnSpeedMult: 0.82 },
      F: { name: 'Flame Conduit', desc: 'Very fast, +1 AoE', attackSpeedMult: 0.65, special: { aoeRadiusBonus: 1 }, spawnSpeedMult: 0.82 },
      G: { name: 'Soul Pyre', desc: '+20% dmg, +5% dmg per kill (max 10)', damageMult: 1.20, spawnSpeedMult: 0.82, special: { killScaling: true, killDmgPct: 0.05, killMaxStacks: 10 } },
    },
    [BuildingType.Tower]: {
      B: { name: 'Demon Turret', desc: '+45% HP, +40% dmg', hpMult: 1.45, damageMult: 1.40 },
      C: { name: 'Rapid Turret', desc: 'Faster atk, +2 burn', attackSpeedMult: 0.75, special: { extraBurnStacks: 2 } },
      D: { name: 'Inferno Turret', desc: '+80% HP, +60% dmg', hpMult: 1.80, damageMult: 1.60 },
      E: { name: 'Napalm Turret', desc: '+50% dmg, +3 burn', damageMult: 1.50, special: { extraBurnStacks: 3 } },
      F: { name: 'Gatling Turret', desc: 'Very fast, +2 range', attackSpeedMult: 0.55, special: { towerRangeBonus: 2 } },
      G: { name: 'Dragon Turret', desc: '+65% dmg, +3 range', damageMult: 1.65, special: { towerRangeBonus: 3 } },
    },
  },
  // ============ DEEP (Aquatic) — Slow & Control [TALL] ============
  [Race.Deep]: {
    [BuildingType.MeleeSpawner]: {
      B: { name: 'Bull Whale', desc: '+50% HP, +25% dmg', hpMult: 1.50, damageMult: 1.25, spawnSpeedMult: 0.90 },
      C: { name: 'Frog Scout', desc: '+20% speed, +2 slow', moveSpeedMult: 1.20, special: { extraSlowStacks: 2 }, spawnSpeedMult: 0.90 },
      D: { name: 'Armored Whale', desc: '+70% HP, 20% dmg reduction', hpMult: 1.70, special: { damageReductionPct: 0.20 }, spawnSpeedMult: 0.85 },
      E: { name: 'Leviathan', desc: '+45% dmg, knockback/2', damageMult: 1.45, special: { knockbackEveryN: 2 }, spawnSpeedMult: 0.85 },
      F: { name: 'Leapfrog', desc: '+20% dmg, +25% speed, hop attack, +3 slow', damageMult: 1.20, moveSpeedMult: 1.25, special: { extraSlowStacks: 3, hopAttack: true }, spawnSpeedMult: 0.85 },
      G: { name: 'Frog Titan', desc: '+50% dmg, regen 3/s, hop attack', damageMult: 1.50, special: { regenPerSec: 3, hopAttack: true }, spawnSpeedMult: 0.85 },
    },
    [BuildingType.RangedSpawner]: {
      B: { name: 'Reef Shark', desc: '+30% HP, +30% dmg', hpMult: 1.30, damageMult: 1.30, spawnSpeedMult: 0.90 },
      C: { name: 'Spray Crab', desc: 'Faster atk, +2 slow', attackSpeedMult: 0.80, special: { extraSlowStacks: 2 }, spawnSpeedMult: 0.90 },
      D: { name: 'Hammerhead', desc: '+45% dmg, splash 2t', damageMult: 1.45, special: { splashRadius: 2, splashDamagePct: 0.50 }, spawnSpeedMult: 0.85 },
      E: { name: 'Great White', desc: '+35% dmg, +3 slow', damageMult: 1.35, special: { extraSlowStacks: 3 }, spawnSpeedMult: 0.85 },
      F: { name: 'Depth Charge', desc: 'SIEGE: 13 range, slow, devastating vs buildings + slows', hpMult: 0.50, damageMult: 2.04, attackSpeedMult: 3.40, moveSpeedMult: 0.40, rangeMult: 1.85, spawnSpeedMult: 0.85, special: { isSiegeUnit: true, buildingDamageMult: 4.0, splashRadius: 3.5, splashDamagePct: 0.65, extraSlowStacks: 3 } },
      G: { name: 'King Crab', desc: '+35% dmg, splash 3t', damageMult: 1.35, special: { splashRadius: 3, splashDamagePct: 0.45 }, spawnSpeedMult: 0.85 },
    },
    [BuildingType.CasterSpawner]: {
      B: { name: 'Sea Star', desc: '+30% HP, cleanse +3', hpMult: 1.30, special: { healBonus: 3 }, spawnSpeedMult: 0.90 },
      C: { name: 'Snap Clam', desc: '+1 AoE, faster atk', special: { aoeRadiusBonus: 1 }, attackSpeedMult: 0.80, spawnSpeedMult: 0.90 },
      D: { name: 'Crown Star', desc: '+35% dmg, cleanse +4, +2 slow', damageMult: 1.35, special: { healBonus: 4, extraSlowStacks: 2 }, spawnSpeedMult: 0.85 },
      E: { name: 'Star Lord', desc: '+45% dmg, +2 AoE', damageMult: 1.45, special: { aoeRadiusBonus: 2 }, spawnSpeedMult: 0.85 },
      F: { name: 'Giant Clam', desc: 'Very fast, cleanse +4', attackSpeedMult: 0.65, special: { healBonus: 4 }, spawnSpeedMult: 0.85 },
      G: { name: 'Pearl Maw', desc: '+40% dmg, +35% range', damageMult: 1.40, rangeMult: 1.35, spawnSpeedMult: 0.85 },
    },
    [BuildingType.Tower]: {
      B: { name: 'Tidal Pool', desc: '+50% HP, +35% dmg', hpMult: 1.50, damageMult: 1.35 },
      C: { name: 'Vortex Pool', desc: '+2 slow stacks, +range', special: { extraSlowStacks: 2, towerRangeBonus: 1 } },
      D: { name: 'Abyssal Pool', desc: '+100% HP, +40% dmg, +range', hpMult: 2.00, damageMult: 1.40, special: { towerRangeBonus: 2 } },
      E: { name: 'Crushing Tide', desc: '+55% dmg, +3 slow', damageMult: 1.55, special: { extraSlowStacks: 3 } },
      F: { name: 'Tsunami Tower', desc: '+2 range, +4 slow stacks', special: { towerRangeBonus: 2, extraSlowStacks: 4 } },
      G: { name: 'Frozen Pool', desc: '+50% dmg, +3 range', damageMult: 1.50, special: { towerRangeBonus: 3 } },
    },
  },
  // ============ WILD (Beasts) — Poison & Speed [HYBRID] ============
  [Race.Wild]: {
    [BuildingType.MeleeSpawner]: {
      B: { name: 'Cave Bear', desc: '+40% HP, +25% dmg', hpMult: 1.40, damageMult: 1.25, spawnSpeedMult: 0.88 },
      C: { name: 'Spider Brood', desc: 'Spawn 3 spiders, +25% speed', hpMult: 0.65, damageMult: 0.60, moveSpeedMult: 1.25, attackSpeedMult: 0.85, special: { spawnCount: 3 }, spawnSpeedMult: 0.88 },
      D: { name: 'Minotaur', desc: '+55% HP, +40% dmg, cleave 2', hpMult: 1.55, damageMult: 1.40, special: { cleaveTargets: 2 }, spawnSpeedMult: 0.82 },
      E: { name: 'Dire Bear', desc: '+65% HP, +35% dmg, 20% dmg reduction', hpMult: 1.65, damageMult: 1.35, special: { damageReductionPct: 0.20 }, spawnSpeedMult: 0.82 },
      F: { name: 'Viper Nest', desc: 'Spawn 3 snakes, +35% speed, +2 slow', hpMult: 0.65, damageMult: 0.65, moveSpeedMult: 1.35, special: { spawnCount: 3, extraSlowStacks: 2 }, spawnSpeedMult: 0.82 },
      G: { name: 'Spider Swarm', desc: 'Spawn 5 spiders, faster atk, +2 slow', attackSpeedMult: 0.80, damageMult: 0.65, hpMult: 0.50, special: { spawnCount: 5, extraSlowStacks: 2 }, spawnSpeedMult: 0.82 },
    },
    [BuildingType.RangedSpawner]: {
      B: { name: 'Chameleon', desc: '+30% HP, +30% dmg', hpMult: 1.30, damageMult: 1.30, spawnSpeedMult: 0.88 },
      C: { name: 'Spitting Snake', desc: 'Faster atk, +2 slow', attackSpeedMult: 0.80, special: { extraSlowStacks: 2 }, spawnSpeedMult: 0.88 },
      D: { name: 'Stalker', desc: '+40% dmg, splash 2t', damageMult: 1.40, special: { splashRadius: 2, splashDamagePct: 0.50 }, spawnSpeedMult: 0.82 },
      E: { name: 'Catapult Beast', desc: 'SIEGE: 10 range, slow, devastating vs buildings + burns', hpMult: 0.70, damageMult: 1.92, attackSpeedMult: 3.00, moveSpeedMult: 0.40, rangeMult: 1.66, spawnSpeedMult: 0.82, special: { isSiegeUnit: true, buildingDamageMult: 3.5, splashRadius: 3, splashDamagePct: 0.60, extraBurnStacks: 1 } },
      F: { name: 'Venom Serpent', desc: 'Much faster, +25% range, +2 burn', attackSpeedMult: 0.70, rangeMult: 1.25, special: { extraBurnStacks: 2 }, spawnSpeedMult: 0.82 },
      G: { name: 'Hydra Spit', desc: '+45% dmg, splash 3t, +2 slow', damageMult: 1.45, special: { splashRadius: 3, splashDamagePct: 0.50, extraSlowStacks: 2 }, spawnSpeedMult: 0.82 },
    },
    [BuildingType.CasterSpawner]: {
      B: { name: 'Elder Sage', desc: '+30% HP, +5 heal', hpMult: 1.30, special: { healBonus: 5 }, spawnSpeedMult: 0.88 },
      C: { name: 'Swift Sage', desc: 'Faster atk, +25% range', attackSpeedMult: 0.80, rangeMult: 1.25, spawnSpeedMult: 0.88 },
      D: { name: 'Primal Sage', desc: '+40% dmg, +8 heal', damageMult: 1.40, special: { healBonus: 8 }, spawnSpeedMult: 0.82 },
      E: { name: 'Storm Sage', desc: '+45% dmg, +2 AoE', damageMult: 1.45, special: { aoeRadiusBonus: 2 }, spawnSpeedMult: 0.82 },
      F: { name: 'Feral Sage', desc: 'Very fast, +6 heal', attackSpeedMult: 0.65, special: { healBonus: 6 }, spawnSpeedMult: 0.82 },
      G: { name: 'Alpha Sage', desc: '+50% dmg, +35% range', damageMult: 1.50, rangeMult: 1.35, spawnSpeedMult: 0.82 },
    },
    [BuildingType.Tower]: {
      B: { name: 'Thorn Nest', desc: '+60% HP, +30% dmg', hpMult: 1.60, damageMult: 1.30 },
      C: { name: 'Venom Nest', desc: '+2 burn, +range', special: { extraBurnStacks: 2, towerRangeBonus: 1 } },
      D: { name: 'Great Nest', desc: '+120% HP, +2 range', hpMult: 2.20, special: { towerRangeBonus: 2 } },
      E: { name: 'Poison Nest', desc: '+45% dmg, +3 burn', damageMult: 1.45, special: { extraBurnStacks: 3 } },
      F: { name: 'Web Nest', desc: '+4 slow, +2 range', special: { extraSlowStacks: 4, towerRangeBonus: 2 } },
      G: { name: 'Alpha Nest', desc: '+55% dmg, +3 range', damageMult: 1.55, special: { towerRangeBonus: 3 } },
    },
  },
  // ============ GEISTS (Undead) — Lifesteal & Revive [TALL] ============
  [Race.Geists]: {
    [BuildingType.MeleeSpawner]: {
      B: { name: 'Iron Bones', desc: '+40% HP, +25% dmg', hpMult: 1.40, damageMult: 1.25, spawnSpeedMult: 0.90 },
      C: { name: 'Ambush Chest', desc: '+25% speed, 25% dodge', moveSpeedMult: 1.25, special: { dodgeChance: 0.25 }, spawnSpeedMult: 0.90 },
      D: { name: 'Death Knight', desc: '+50% dmg, +2 burn', damageMult: 1.50, special: { extraBurnStacks: 2 }, spawnSpeedMult: 0.85 },
      E: { name: 'Soul Eater', desc: '+45% HP/40% dmg, regen 3/s', hpMult: 1.45, damageMult: 1.40, special: { regenPerSec: 3 }, spawnSpeedMult: 0.85 },
      F: { name: 'Snapping Mimic', desc: '+25% dmg, +35% speed, 35% dodge', damageMult: 1.25, moveSpeedMult: 1.35, special: { dodgeChance: 0.35 }, spawnSpeedMult: 0.85 },
      G: { name: 'Soul Gorger', desc: 'Grows stronger from nearby deaths (max 20)', damageMult: 1.20, hpMult: 1.30, spawnSpeedMult: 0.85, special: { soulHarvest: true, soulHarvestRadius: 8, soulMaxStacks: 20 } },
    },
    [BuildingType.RangedSpawner]: {
      B: { name: 'Venom Wraith', desc: '+35% dmg, +2 burn', damageMult: 1.35, special: { extraBurnStacks: 2 }, spawnSpeedMult: 0.90 },
      C: { name: 'Bone Skull', desc: 'Faster atk, +25% range', attackSpeedMult: 0.80, rangeMult: 1.25, spawnSpeedMult: 0.90 },
      D: { name: 'Plague Arrow', desc: '+45% dmg, +3 burn', damageMult: 1.45, special: { extraBurnStacks: 3 }, spawnSpeedMult: 0.85 },
      E: { name: 'Hex Volley', desc: 'Fires 2 projectiles', special: { multishotCount: 1, multishotDamagePct: 0.75 }, spawnSpeedMult: 0.85 },
      F: { name: 'Wailing Skull', desc: '+20% dmg, +30% speed, 25% dodge', damageMult: 1.20, moveSpeedMult: 1.30, special: { dodgeChance: 0.25 }, spawnSpeedMult: 0.85 },
      G: { name: 'Bone Ballista', desc: 'SIEGE: 13 range, slow, devastating vs buildings', hpMult: 0.50, damageMult: 2.04, attackSpeedMult: 3.20, moveSpeedMult: 0.38, rangeMult: 1.50, spawnSpeedMult: 0.85, special: { isSiegeUnit: true, buildingDamageMult: 4.0, splashRadius: 3, splashDamagePct: 0.65, extraBurnStacks: 1 } },
    },
    [BuildingType.CasterSpawner]: {
      B: { name: 'Plague Mage', desc: '+30% HP, 15% summon chance', hpMult: 1.30, special: { skeletonSummonChance: 0.15 }, spawnSpeedMult: 0.90 },
      C: { name: 'Dark Sorcerer', desc: 'Faster atk, +25% range', attackSpeedMult: 0.80, rangeMult: 1.25, spawnSpeedMult: 0.90 },
      D: { name: 'Necromancer', desc: '+40% dmg, 25% summon chance', damageMult: 1.40, special: { skeletonSummonChance: 0.25 }, spawnSpeedMult: 0.85 },
      E: { name: 'Soul Harvester', desc: '+45% dmg, +2 burn', damageMult: 1.45, special: { extraBurnStacks: 2 }, spawnSpeedMult: 0.85 },
      F: { name: 'Shadow Sorcerer', desc: 'Very fast, 20% summon', attackSpeedMult: 0.65, special: { skeletonSummonChance: 0.20 }, spawnSpeedMult: 0.85 },
      G: { name: 'Arch Lich', desc: '+55% dmg, 30% summon', damageMult: 1.55, special: { skeletonSummonChance: 0.30 }, spawnSpeedMult: 0.85 },
    },
    [BuildingType.Tower]: {
      B: { name: 'Shadow Spire', desc: '+50% HP, +35% dmg', hpMult: 1.50, damageMult: 1.35 },
      C: { name: 'Wither Spire', desc: '+2 burn, +range', special: { extraBurnStacks: 2, towerRangeBonus: 1 } },
      D: { name: 'Void Spire', desc: '+90% HP, +50% dmg', hpMult: 1.90, damageMult: 1.50 },
      E: { name: 'Blight Spire', desc: '+45% dmg, +3 burn', damageMult: 1.45, special: { extraBurnStacks: 3 } },
      F: { name: 'Nightmare Spire', desc: 'Very fast, +2 range', attackSpeedMult: 0.60, special: { towerRangeBonus: 2 } },
      G: { name: 'Death Spire', desc: '+60% dmg, +3 range', damageMult: 1.60, special: { towerRangeBonus: 3 } },
    },
  },
  // ============ TENDERS (Nature) — Regen & Heal [TALL] ============
  [Race.Tenders]: {
    [BuildingType.MeleeSpawner]: {
      B: { name: 'Young Ent', desc: '+35% HP, +20% dmg', hpMult: 1.35, damageMult: 1.20, spawnSpeedMult: 0.90, cost: { gold: 0, wood: 45, stone: 0 } },
      C: { name: 'Wild Radish', desc: '+20% HP, regen 2/s', hpMult: 1.20, special: { regenPerSec: 2 }, spawnSpeedMult: 0.90, cost: { gold: 90, wood: 0, stone: 0 } },
      D: { name: 'Elder Ent', desc: '+45% HP, +20% dmg', hpMult: 1.45, damageMult: 1.20, spawnSpeedMult: 0.85, cost: { gold: 0, wood: 90, stone: 0 } },
      E: { name: 'Ancient Ent', desc: '+50% dmg, knockback/2', damageMult: 1.50, special: { knockbackEveryN: 2 }, spawnSpeedMult: 0.85, cost: { gold: 0, wood: 90, stone: 0 } },
      F: { name: 'Radish Brute', desc: '+25% dmg, +20% HP, regen 3/s', damageMult: 1.25, hpMult: 1.20, special: { regenPerSec: 3 }, spawnSpeedMult: 0.85, cost: { gold: 180, wood: 0, stone: 0 } },
      G: { name: 'Radish King', desc: '+40% dmg, +20% speed, +2 slow', damageMult: 1.40, moveSpeedMult: 1.20, special: { extraSlowStacks: 2 }, spawnSpeedMult: 0.85, cost: { gold: 180, wood: 0, stone: 0 } },
    },
    [BuildingType.RangedSpawner]: {
      B: { name: 'Heavy Tinker', desc: '+35% HP, +30% dmg', hpMult: 1.35, damageMult: 1.30, spawnSpeedMult: 0.90, cost: { gold: 45, wood: 0, stone: 0 } },
      C: { name: 'Thorn Thrower', desc: 'Faster atk, +2 slow', attackSpeedMult: 0.80, special: { extraSlowStacks: 2 }, spawnSpeedMult: 0.90, cost: { gold: 0, wood: 0, stone: 45 } },
      D: { name: 'Blight Tinker', desc: '+40% dmg, splash 2t', damageMult: 1.40, special: { splashRadius: 2, splashDamagePct: 0.50 }, spawnSpeedMult: 0.85, cost: { gold: 90, wood: 0, stone: 0 } },
      E: { name: 'Grand Tinker', desc: '+45% dmg, splash 3t', damageMult: 1.45, special: { splashRadius: 3, splashDamagePct: 0.45 }, spawnSpeedMult: 0.85, cost: { gold: 90, wood: 0, stone: 0 } },
      F: { name: 'Toxic Hurler', desc: '+35% dmg, +2 burn', damageMult: 1.35, special: { extraBurnStacks: 2 }, spawnSpeedMult: 0.85, cost: { gold: 0, wood: 0, stone: 90 } },
      G: { name: 'Vine Siege', desc: 'SIEGE: 10 range, slow, devastating vs buildings + slows', hpMult: 0.50, damageMult: 2.16, attackSpeedMult: 3.20, moveSpeedMult: 0.38, rangeMult: 1.42, spawnSpeedMult: 0.85, cost: { gold: 0, wood: 0, stone: 90 }, special: { isSiegeUnit: true, buildingDamageMult: 3.0, splashRadius: 3, splashDamagePct: 0.65, extraSlowStacks: 2 } },
    },
    [BuildingType.CasterSpawner]: {
      B: { name: 'Deep Root', desc: '+35% HP, +5 heal', hpMult: 1.35, special: { healBonus: 5 }, spawnSpeedMult: 0.90, cost: { gold: 0, wood: 0, stone: 45 } },
      C: { name: 'Spore Weaver', desc: 'Faster atk, +3 slow', attackSpeedMult: 0.80, special: { extraSlowStacks: 3 }, spawnSpeedMult: 0.90, cost: { gold: 0, wood: 45, stone: 0 } },
      D: { name: 'Fungal Hulk', desc: '+35% dmg, +8 heal, +2 slow', damageMult: 1.35, special: { healBonus: 8, extraSlowStacks: 2 }, spawnSpeedMult: 0.85, cost: { gold: 0, wood: 0, stone: 90 } },
      E: { name: 'Bloom Shaper', desc: '+40% dmg, +2 AoE', damageMult: 1.40, special: { aoeRadiusBonus: 2 }, spawnSpeedMult: 0.85, cost: { gold: 0, wood: 0, stone: 90 } },
      F: { name: 'Mycelium Sage', desc: 'Very fast, +6 heal', attackSpeedMult: 0.65, special: { healBonus: 6 }, spawnSpeedMult: 0.85, cost: { gold: 0, wood: 90, stone: 0 } },
      G: { name: 'Fungal Lord', desc: '+50% dmg, +35% range', damageMult: 1.50, rangeMult: 1.35, spawnSpeedMult: 0.85, cost: { gold: 0, wood: 90, stone: 0 } },
    },
    [BuildingType.Tower]: {
      B: { name: 'Thorn Wall', desc: '+60% HP, +30% dmg', hpMult: 1.60, damageMult: 1.30 },
      C: { name: 'Vine Tower', desc: '+3 slow, +range', special: { extraSlowStacks: 3, towerRangeBonus: 1 } },
      D: { name: 'Great Thorn', desc: '+120% HP, +2 range', hpMult: 2.20, special: { towerRangeBonus: 2 } },
      E: { name: 'Poison Thorn', desc: '+45% dmg, +2 burn', damageMult: 1.45, special: { extraBurnStacks: 2 } },
      F: { name: 'Entangle Tower', desc: '+4 slow, +2 range', special: { extraSlowStacks: 4, towerRangeBonus: 2 } },
      G: { name: 'Nature Spire', desc: '+50% dmg, +3 range', damageMult: 1.50, special: { towerRangeBonus: 3 } },
    },
  },
};

// Race ability display info for the bottom-bar ability button
export const RACE_ABILITY_INFO: Record<Race, { name: string; key: string; desc: string }> = {
  [Race.Crown]:    { name: 'Foundry',   key: '5', desc: 'Build a Gold Foundry. +1 gold per miner trip.' },
  [Race.Horde]:    { name: 'War Troll', key: '5', desc: 'Summon a mighty troll from your citadel.' },
  [Race.Goblins]:  { name: 'Potions',   key: '5', desc: 'Build a Potion Shop. Buffs nearby allies.' },
  [Race.Oozlings]: { name: 'Globule',   key: '5', desc: 'Build a Globule. Spawns extra oozlings.' },
  [Race.Demon]:    { name: 'Fireball',  key: '5', desc: 'Hurl a fireball. Consumes ALL mana.' },
  [Race.Deep]:     { name: 'Deluge',    key: '5', desc: 'Unleash a storm. Slows all enemies.' },
  [Race.Wild]:     { name: 'Frenzy',    key: '5', desc: 'Enrage allies in an area. +Speed +Damage.' },
  [Race.Geists]:   { name: 'Summon',    key: '5', desc: 'Summon 5 skeleton warriors at target.' },
  [Race.Tenders]:  { name: 'Seeds',     key: '5', desc: 'Plant a seed. Grows into a random unit.' },
};

// Race ability definitions — costs, cooldowns, targeting, etc.
export const RACE_ABILITY_DEFS: Record<Race, RaceAbilityDef> = {
  [Race.Crown]: {
    race: Race.Crown, name: 'Gold Foundry',
    targetMode: AbilityTargetMode.BuildSlot,
    baseCooldownTicks: 0,
    baseCost: { gold: 50, wood: 50 },
    costGrowthFactor: 1.4,
  },
  [Race.Horde]: {
    race: Race.Horde, name: 'War Troll',
    targetMode: AbilityTargetMode.Instant,
    baseCooldownTicks: 60 * TICK_RATE,
    baseCost: { gold: 100, wood: 50, stone: 50 },
    costGrowthFactor: 1.5,
  },
  [Race.Goblins]: {
    race: Race.Goblins, name: 'Potion Shop',
    targetMode: AbilityTargetMode.BuildSlot,
    baseCooldownTicks: 0,
    baseCost: { gold: 80, wood: 30 },
  },
  [Race.Oozlings]: {
    race: Race.Oozlings, name: 'Globule',
    targetMode: AbilityTargetMode.BuildSlot,
    baseCooldownTicks: 0,
    baseCost: { deathEssence: 50 },
  },
  [Race.Demon]: {
    race: Race.Demon, name: 'Fireball',
    targetMode: AbilityTargetMode.Targeted,
    baseCooldownTicks: 30 * TICK_RATE,
    baseCost: { mana: 50 },
    requiresVision: true,
    aoeRadius: 6,
  },
  [Race.Deep]: {
    race: Race.Deep, name: 'Deluge',
    targetMode: AbilityTargetMode.Instant,
    baseCooldownTicks: 45 * TICK_RATE,
    baseCost: { wood: 100, gold: 50 },
    costGrowthFactor: 1.3,
  },
  [Race.Wild]: {
    race: Race.Wild, name: 'Frenzy',
    targetMode: AbilityTargetMode.Targeted,
    baseCooldownTicks: 40 * TICK_RATE,
    baseCost: { stone: 80 },
    costGrowthFactor: 1.3,
    aoeRadius: 8,
  },
  [Race.Geists]: {
    race: Race.Geists, name: 'Summon Skeletons',
    targetMode: AbilityTargetMode.Targeted,
    baseCooldownTicks: 35 * TICK_RATE,
    baseCost: { souls: 30 },
    requiresVision: true,
    aoeRadius: 4,
  },
  [Race.Tenders]: {
    race: Race.Tenders, name: 'Plant Seed',
    targetMode: AbilityTargetMode.BuildSlot,
    baseCooldownTicks: 15 * TICK_RATE,
    baseCost: {},
  },
};

// === Research Upgrade System ===

export type ResearchCategory = 'melee' | 'ranged' | 'caster';

export interface ResearchUpgradeDef {
  id: string;
  category: ResearchCategory;
  type: 'attack' | 'defense' | 'race_special';
  name: string;
  desc: string;
  /** One-shot upgrades are purchased once; attack/defense are infinite */
  oneShot: boolean;
}

// 6 universal upgrades: melee/ranged/caster x atk/def
export const RESEARCH_UPGRADES: ResearchUpgradeDef[] = [
  { id: 'melee_atk', category: 'melee', type: 'attack', name: 'Melee Attack', desc: '+25% melee damage per level', oneShot: false },
  { id: 'melee_def', category: 'melee', type: 'defense', name: 'Melee Defense', desc: 'Melee damage reduction (diminishing)', oneShot: false },
  { id: 'ranged_atk', category: 'ranged', type: 'attack', name: 'Ranged Attack', desc: '+25% ranged damage per level', oneShot: false },
  { id: 'ranged_def', category: 'ranged', type: 'defense', name: 'Ranged Defense', desc: 'Ranged damage reduction (diminishing)', oneShot: false },
  { id: 'caster_atk', category: 'caster', type: 'attack', name: 'Caster Attack', desc: '+25% caster damage per level', oneShot: false },
  { id: 'caster_def', category: 'caster', type: 'defense', name: 'Caster Defense', desc: 'Caster damage reduction (diminishing)', oneShot: false },
];

// Per-race one-shot upgrades (2 per category = 6 per race)
export const RACE_RESEARCH_UPGRADES: Record<Race, ResearchUpgradeDef[]> = {
  [Race.Crown]: [
    { id: 'crown_melee_1', category: 'melee', type: 'race_special', name: 'Defend Stance', desc: '-25% ranged dmg taken', oneShot: true },
    { id: 'crown_melee_2', category: 'melee', type: 'race_special', name: 'Royal Guard', desc: '+15% HP, +2g on kill', oneShot: true },
    { id: 'crown_ranged_1', category: 'ranged', type: 'race_special', name: 'Piercing Arrows', desc: 'Ignore 20% def, +4% max HP dmg', oneShot: true },
    { id: 'crown_ranged_2', category: 'ranged', type: 'race_special', name: 'Crown Volley', desc: '+1 proj at 40% dmg', oneShot: true },
    { id: 'crown_caster_1', category: 'caster', type: 'race_special', name: 'Fortified Shields', desc: '+8 shield absorb', oneShot: true },
    { id: 'crown_caster_2', category: 'caster', type: 'race_special', name: 'Healing Aura', desc: '1 HP/s to 2 allies', oneShot: true },
  ],
  [Race.Horde]: [
    { id: 'horde_melee_1', category: 'melee', type: 'race_special', name: 'Blood Rage', desc: '+20% dmg <50% HP, +4% max HP dmg', oneShot: true },
    { id: 'horde_melee_2', category: 'melee', type: 'race_special', name: 'Thick Skin', desc: '+20% HP', oneShot: true },
    { id: 'horde_ranged_1', category: 'ranged', type: 'race_special', name: 'Heavy Bolts', desc: 'Wound on hit: -50% healing, 6s', oneShot: true },
    { id: 'horde_ranged_2', category: 'ranged', type: 'race_special', name: 'Bombardier', desc: 'Splash 2.5t at 30%', oneShot: true },
    { id: 'horde_caster_1', category: 'caster', type: 'race_special', name: 'War Drums', desc: 'Haste 3s->5s', oneShot: true },
    { id: 'horde_caster_2', category: 'caster', type: 'race_special', name: 'Berserker Howl', desc: 'Haste gives +15% dmg', oneShot: true },
  ],
  [Race.Goblins]: [
    { id: 'goblins_melee_1', category: 'melee', type: 'race_special', name: 'Coated Blades', desc: '+1 Burn on melee', oneShot: true },
    { id: 'goblins_melee_2', category: 'melee', type: 'race_special', name: 'Scurry', desc: '+35% move speed', oneShot: true },
    { id: 'goblins_ranged_1', category: 'ranged', type: 'race_special', name: 'Incendiary Tips', desc: '+1 Burn on ranged', oneShot: true },
    { id: 'goblins_ranged_2', category: 'ranged', type: 'race_special', name: 'Acid Bolts', desc: '+4% target max HP dmg', oneShot: true },
    { id: 'goblins_caster_1', category: 'caster', type: 'race_special', name: 'Potent Hex', desc: '+1 Burn on caster AoE', oneShot: true },
    { id: 'goblins_caster_2', category: 'caster', type: 'race_special', name: 'Jinx Cloud', desc: 'Slowed targets get Wound: -50% healing', oneShot: true },
  ],
  [Race.Oozlings]: [
    { id: 'oozlings_melee_1', category: 'melee', type: 'race_special', name: 'Volatile Membrane', desc: 'Explode on death', oneShot: true },
    { id: 'oozlings_melee_2', category: 'melee', type: 'race_special', name: 'Mitosis', desc: '10% spawn copy on death', oneShot: true },
    { id: 'oozlings_ranged_1', category: 'ranged', type: 'race_special', name: 'Corrosive Spit', desc: 'Vulnerable on hit: +20% dmg taken, 3s', oneShot: true },
    { id: 'oozlings_ranged_2', category: 'ranged', type: 'race_special', name: 'Acid Pool', desc: 'Kill leaves dmg pool', oneShot: true },
    { id: 'oozlings_caster_1', category: 'caster', type: 'race_special', name: 'Symbiotic Link', desc: 'Heal during haste', oneShot: true },
    { id: 'oozlings_caster_2', category: 'caster', type: 'race_special', name: 'Mass Division', desc: 'Caster AoE applies Wound: -50% healing, 6s', oneShot: true },
  ],
  [Race.Demon]: [
    { id: 'demon_melee_1', category: 'melee', type: 'race_special', name: 'Infernal Rage', desc: '+25% vs burning', oneShot: true },
    { id: 'demon_melee_2', category: 'melee', type: 'race_special', name: 'Soul Siphon', desc: '+2 mana on kill', oneShot: true },
    { id: 'demon_ranged_1', category: 'ranged', type: 'race_special', name: 'Hellfire Arrows', desc: '+1 Burn, +10% dmg', oneShot: true },
    { id: 'demon_ranged_2', category: 'ranged', type: 'race_special', name: 'Eye of Destruction', desc: '+1.5 splash radius', oneShot: true },
    { id: 'demon_caster_1', category: 'caster', type: 'race_special', name: 'Flame Conduit', desc: '+1 AoE burn', oneShot: true },
    { id: 'demon_caster_2', category: 'caster', type: 'race_special', name: 'Immolation', desc: '2t burn aura', oneShot: true },
  ],
  [Race.Deep]: [
    { id: 'deep_melee_1', category: 'melee', type: 'race_special', name: 'Tidal Guard', desc: '+15% HP, +5% DR', oneShot: true },
    { id: 'deep_melee_2', category: 'melee', type: 'race_special', name: 'Crushing Depths', desc: '+20% vs slowed', oneShot: true },
    { id: 'deep_ranged_1', category: 'ranged', type: 'race_special', name: 'Frozen Harpoons', desc: '+1 Slow', oneShot: true },
    { id: 'deep_ranged_2', category: 'ranged', type: 'race_special', name: 'Anchor Shot', desc: '+50% siege dmg', oneShot: true },
    { id: 'deep_caster_1', category: 'caster', type: 'race_special', name: 'Purifying Tide', desc: 'Cleanse 1 burn ally', oneShot: true },
    { id: 'deep_caster_2', category: 'caster', type: 'race_special', name: 'Abyssal Ward', desc: '3 shield/5s allies', oneShot: true },
  ],
  [Race.Wild]: [
    { id: 'wild_melee_1', category: 'melee', type: 'race_special', name: 'Savage Frenzy', desc: 'Frenzy +2s, +10% dmg', oneShot: true },
    { id: 'wild_melee_2', category: 'melee', type: 'race_special', name: 'Pack Hunter', desc: '+5%/ally max +40% dmg', oneShot: true },
    { id: 'wild_ranged_1', category: 'ranged', type: 'race_special', name: 'Venomous Fangs', desc: '+1 Burn + Wound on hit', oneShot: true },
    { id: 'wild_ranged_2', category: 'ranged', type: 'race_special', name: "Predator's Mark", desc: 'Marked +15% dmg taken', oneShot: true },
    { id: 'wild_caster_1', category: 'caster', type: 'race_special', name: "Nature's Wrath", desc: '+1 AoE radius', oneShot: true },
    { id: 'wild_caster_2', category: 'caster', type: 'race_special', name: 'Alpha Howl', desc: 'Casters grant Frenzy', oneShot: true },
  ],
  [Race.Geists]: [
    { id: 'geists_melee_1', category: 'melee', type: 'race_special', name: 'Death Grip', desc: 'Lifesteal 15->25%', oneShot: true },
    { id: 'geists_melee_2', category: 'melee', type: 'race_special', name: 'Spectral Armor', desc: '+5% DR per 25% missing HP', oneShot: true },
    { id: 'geists_ranged_1', category: 'ranged', type: 'race_special', name: 'Soul Arrows', desc: '+10% lifesteal', oneShot: true },
    { id: 'geists_ranged_2', category: 'ranged', type: 'race_special', name: 'Phantom Volley', desc: '15% pass-through', oneShot: true },
    { id: 'geists_caster_1', category: 'caster', type: 'race_special', name: 'Necrotic Burst', desc: '+2 heal amount', oneShot: true },
    { id: 'geists_caster_2', category: 'caster', type: 'race_special', name: 'Undying Will', desc: 'Skeleton summon chance', oneShot: true },
  ],
  [Race.Tenders]: [
    { id: 'tenders_melee_1', category: 'melee', type: 'race_special', name: 'Bark Skin', desc: 'Regen 1->2 HP/s', oneShot: true },
    { id: 'tenders_melee_2', category: 'melee', type: 'race_special', name: 'Thorned Vines', desc: 'Reflect 3 dmg', oneShot: true },
    { id: 'tenders_ranged_1', category: 'ranged', type: 'race_special', name: 'Healing Sap', desc: 'Heal ally 15% of dmg', oneShot: true },
    { id: 'tenders_ranged_2', category: 'ranged', type: 'race_special', name: 'Root Snare', desc: '20% chance +1 Slow', oneShot: true },
    { id: 'tenders_caster_1', category: 'caster', type: 'race_special', name: 'Bloom Burst', desc: '+2 heal amount', oneShot: true },
    { id: 'tenders_caster_2', category: 'caster', type: 'race_special', name: 'Life Link', desc: 'Double heal <30% HP', oneShot: true },
  ],
};

/** Get all research upgrades for a race (6 universal + 6 race-specific) */
export function getAllResearchUpgrades(race: Race): ResearchUpgradeDef[] {
  return [...RESEARCH_UPGRADES, ...RACE_RESEARCH_UPGRADES[race]];
}

/** Get cost for a research upgrade. Attack/defense: 80g base x 1.5^level. One-shots: 150g flat. */
export function getResearchUpgradeCost(id: string, level: number, race: Race): { gold: number; wood: number; stone: number; mana?: number; deathEssence?: number } {
  const allDefs = getAllResearchUpgrades(race);
  const def = allDefs.find(d => d.id === id);
  if (!def) return { gold: 999, wood: 999, stone: 999 };
  // Oozlings: all research costs ooze (deathEssence) instead of resources
  if (race === Race.Oozlings) {
    if (def.oneShot) return { gold: 0, wood: 0, stone: 0, deathEssence: 50 };
    const cost = Math.round(30 * Math.pow(1.4, level));
    return { gold: 0, wood: 0, stone: 0, deathEssence: cost };
  }
  if (def.oneShot) {
    // Demon racial one-shots cost mana instead of resources
    if (race === Race.Demon && id.startsWith('demon_')) {
      const demonManaCosts: Record<string, number> = {
        demon_melee_1: 60,   // Infernal Rage
        demon_melee_2: 150,  // Soul Siphon
        demon_ranged_1: 100, // Hellfire Arrows
        demon_ranged_2: 120, // Eye of Destruction
        demon_caster_1: 140, // Flame Conduit
        demon_caster_2: 140, // Immolation
      };
      return { gold: 0, wood: 0, stone: 0, mana: demonManaCosts[id] ?? 120 };
    }
    // One-shot: flat cost scaled to race economy
    // Non-gold races pay half raw amounts since wood/stone are worth 2× gold
    const used = getRaceUsedResources(race);
    if (!used.gold && used.stone && used.wood) return { gold: 0, wood: 40, stone: 35 };
    if (!used.gold && used.stone) return { gold: 0, wood: 0, stone: 75 };
    if (!used.gold && used.wood) return { gold: 0, wood: 75, stone: 0 };
    return { gold: 150, wood: 0, stone: 0 };
  }
  // Infinite scaling: 80 base x 1.5^level
  // Gold races pay in gold (80g = 40 eff). Non-gold races pay half raw in wood/stone
  // so effective cost is equal (e.g. 20w+20s = 40 eff ≈ 80g/2 = 40 eff).
  const cost = Math.round(80 * Math.pow(1.5, level));
  const used = getRaceUsedResources(race);
  const half = Math.round(cost / 2); // non-gold races pay half raw (wood/stone worth 2× gold)
  if (!used.gold && used.stone && used.wood) return { gold: 0, wood: Math.round(half * 0.5), stone: Math.round(half * 0.5) };
  if (!used.gold && used.stone) return { gold: 0, wood: 0, stone: half };
  if (!used.gold && used.wood) return { gold: 0, wood: half, stone: 0 };
  return { gold: cost, wood: 0, stone: 0 };
}
