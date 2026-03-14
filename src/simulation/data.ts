import { BuildingType, Race, TICK_RATE } from './types';

// Race-specific building costs
export const RACE_BUILDING_COSTS: Record<Race, Record<BuildingType, { gold: number; wood: number; stone: number; hp: number }>> = {
  // Crown: Gold+Wood economy. Premium gold cost for strong units.
  [Race.Crown]: {
    [BuildingType.MeleeSpawner]:  { gold: 85,  wood: 0,  stone: 0,  hp: 280 },
    [BuildingType.RangedSpawner]: { gold: 0,   wood: 30,  stone: 0,  hp: 230 },
    [BuildingType.CasterSpawner]: { gold: 100, wood: 10, stone: 0,  hp: 200 },
    [BuildingType.Tower]:         { gold: 113, wood: 0,  stone: 10, hp: 220 },
    [BuildingType.HarvesterHut]:  { gold: 50,  wood: 0,  stone: 0,  hp: 150 },
  },
  // Horde: Gold+Stone economy. Durable buildings, stone-heavy costs.
  [Race.Horde]: {
    [BuildingType.MeleeSpawner]:  { gold: 0,   wood: 0,  stone: 75, hp: 350 },
    [BuildingType.RangedSpawner]: { gold: 125, wood: 0,  stone: 0,  hp: 300 },
    [BuildingType.CasterSpawner]: { gold: 124, wood: 0,  stone: 19, hp: 250 },
    [BuildingType.Tower]:         { gold: 110, wood: 0,  stone: 30, hp: 280 },
    [BuildingType.HarvesterHut]:  { gold: 50,  wood: 0,  stone: 11, hp: 180 },
  },
  // Goblins: Gold+Wood economy. Very cheap, fragile buildings.
  [Race.Goblins]: {
    [BuildingType.MeleeSpawner]:  { gold: 0,   wood: 15, stone: 0,  hp: 180 },
    [BuildingType.RangedSpawner]: { gold: 55,  wood: 0,  stone: 0,  hp: 160 },
    [BuildingType.CasterSpawner]: { gold: 44,  wood: 13, stone: 0,  hp: 140 },
    [BuildingType.Tower]:         { gold: 36,  wood: 12, stone: 0,  hp: 150 },
    [BuildingType.HarvesterHut]:  { gold: 21,  wood: 7,  stone: 0,  hp: 110 },
  },
  // Oozlings: Gold+Stone economy. Cheap (swarm units).
  [Race.Oozlings]: {
    [BuildingType.MeleeSpawner]:  { gold: 60,  wood: 0,  stone: 0,  hp: 200 },
    [BuildingType.RangedSpawner]: { gold: 70,  wood: 0,  stone: 20, hp: 180 },
    [BuildingType.CasterSpawner]: { gold: 35,  wood: 0,  stone: 35, hp: 160 },
    [BuildingType.Tower]:         { gold: 75,  wood: 0,  stone: 19, hp: 170 },
    [BuildingType.HarvesterHut]:  { gold: 35,  wood: 0,  stone: 10, hp: 130 },
  },
  // Demon: Stone+Wood economy. No gold. Glass cannon, reduced costs.
  [Race.Demon]: {
    [BuildingType.MeleeSpawner]:  { gold: 0,  wood: 12, stone: 27, hp: 200 },
    [BuildingType.RangedSpawner]: { gold: 0,  wood: 15, stone: 31, hp: 170 },
    [BuildingType.CasterSpawner]: { gold: 0,  wood: 20, stone: 38, hp: 140 },
    [BuildingType.Tower]:         { gold: 0,  wood: 15, stone: 32, hp: 160 },
    [BuildingType.HarvesterHut]:  { gold: 0,  wood: 8,  stone: 14, hp: 120 },
  },
  // Deep: Wood+Gold economy. Very durable buildings.
  [Race.Deep]: {
    [BuildingType.MeleeSpawner]:  { gold: 68, wood: 10, stone: 0,  hp: 380 },
    [BuildingType.RangedSpawner]: { gold: 30, wood: 55, stone: 0,  hp: 300 },
    [BuildingType.CasterSpawner]: { gold: 30, wood: 55, stone: 0,  hp: 260 },
    [BuildingType.Tower]:         { gold: 23, wood: 53, stone: 0,  hp: 280 },
    [BuildingType.HarvesterHut]:  { gold: 15, wood: 30, stone: 0,  hp: 170 },
  },
  // Wild: Wood+Stone economy. No gold. Medium buildings.
  [Race.Wild]: {
    [BuildingType.MeleeSpawner]:  { gold: 0,  wood: 30, stone: 15, hp: 250 },
    [BuildingType.RangedSpawner]: { gold: 0,  wood: 35, stone: 18, hp: 220 },
    [BuildingType.CasterSpawner]: { gold: 0,  wood: 40, stone: 22, hp: 190 },
    [BuildingType.Tower]:         { gold: 0,  wood: 34, stone: 19, hp: 200 },
    [BuildingType.HarvesterHut]:  { gold: 0,  wood: 18, stone: 8,  hp: 140 },
  },
  // Geists: Stone+Gold economy. Medium buildings.
  [Race.Geists]: {
    [BuildingType.MeleeSpawner]:  { gold: 20, wood: 0,  stone: 35, hp: 240 },
    [BuildingType.RangedSpawner]: { gold: 25, wood: 0,  stone: 40, hp: 210 },
    [BuildingType.CasterSpawner]: { gold: 30, wood: 0,  stone: 48, hp: 180 },
    [BuildingType.Tower]:         { gold: 19, wood: 0,  stone: 41, hp: 180 },
    [BuildingType.HarvesterHut]:  { gold: 12, wood: 0,  stone: 18, hp: 130 },
  },
  // Tenders: Wood+Gold economy. Durable natural buildings.
  [Race.Tenders]: {
    [BuildingType.MeleeSpawner]:  { gold: 0,  wood: 48, stone: 0,  hp: 320 },
    [BuildingType.RangedSpawner]: { gold: 60,  wood: 0,  stone: 0,  hp: 270 },
    [BuildingType.CasterSpawner]: { gold: 26, wood: 45, stone: 0,  hp: 240 },
    [BuildingType.Tower]:         { gold: 17, wood: 37, stone: 0,  hp: 300 },
    [BuildingType.HarvesterHut]:  { gold: 11, wood: 21, stone: 0,  hp: 160 },
  },
};

// Backwards-compatible helper (used by code that doesn't have race context)
export function getBuildingCost(race: Race, type: BuildingType) {
  return RACE_BUILDING_COSTS[race][type];
}

// Keep old BUILDING_COSTS as Crown defaults for any code that still uses it
export const BUILDING_COSTS = RACE_BUILDING_COSTS[Race.Crown];

// Race-specific upgrade costs
export const RACE_UPGRADE_COSTS: Record<Race, { tier1: { gold: number; wood: number; stone: number }; tier2: { gold: number; wood: number; stone: number } }> = {
  [Race.Crown]:    { tier1: { gold: 80,  wood: 0,  stone: 0 },  tier2: { gold: 120, wood: 40, stone: 0 } },
  [Race.Horde]:    { tier1: { gold: 60,  wood: 0,  stone: 20 }, tier2: { gold: 120, wood: 0,  stone: 40 } },
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
): { gold: number; wood: number; stone: number } {
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

// Escalating hut cost
export function HARVESTER_HUT_COST(hutIndex: number): number {
  return Math.floor(50 * Math.pow(1.35, hutIndex));
}

// Spawn interval in ticks
export const SPAWN_INTERVAL_TICKS = 10 * TICK_RATE; // 10 seconds

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
      name: 'Swordsman', hp: 85, damage: 11, attackSpeed: 1.0, moveSpeed: 3.5, range: 1, ascii: '[+]',
    },
    [BuildingType.RangedSpawner]: {
      name: 'Bowman', hp: 45, damage: 9, attackSpeed: 1.2, moveSpeed: 3.5, range: 7, ascii: '>>',
    },
    [BuildingType.CasterSpawner]: {
      name: 'Priest', hp: 40, damage: 13, attackSpeed: 2.0, moveSpeed: 3.0, range: 7, ascii: '{C}',
    },
  },
  // === HORDE (Orcs) — Brute Force ===
  [Race.Horde]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Brute', hp: 100, damage: 14, attackSpeed: 1.0, moveSpeed: 3.2, range: 1, ascii: '[#]',
    },
    [BuildingType.RangedSpawner]: {
      name: 'Bowcleaver', hp: 85, damage: 13, attackSpeed: 1.2, moveSpeed: 3.0, range: 7, ascii: '=>',
    },
    [BuildingType.CasterSpawner]: {
      name: 'War Chanter', hp: 51, damage: 15, attackSpeed: 1.8, moveSpeed: 3.2, range: 7, ascii: '{H}',
    },
  },
  // === GOBLINS — Speed & Trickery ===
  [Race.Goblins]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Sticker', hp: 55, damage: 7, attackSpeed: 0.8, moveSpeed: 5.0, range: 1, ascii: '/>',
    },
    [BuildingType.RangedSpawner]: {
      name: 'Knifer', hp: 35, damage: 8, attackSpeed: 0.9, moveSpeed: 4.5, range: 6, ascii: '~>',
    },
    [BuildingType.CasterSpawner]: {
      name: 'Hexer', hp: 28, damage: 10, attackSpeed: 2.0, moveSpeed: 3.5, range: 7, ascii: '{G}',
    },
  },
  // === OOZLINGS (Slimes) — Adaptive Swarm ===
  [Race.Oozlings]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Globule', hp: 52, damage: 5, attackSpeed: 0.8, moveSpeed: 4.2, range: 1, ascii: 'o', spawnCount: 2,
    },
    [BuildingType.RangedSpawner]: {
      name: 'Spitter', hp: 36, damage: 5, attackSpeed: 1.0, moveSpeed: 3.8, range: 6, ascii: 'O~', spawnCount: 2,
    },
    [BuildingType.CasterSpawner]: {
      name: 'Bloater', hp: 35, damage: 12, attackSpeed: 2.2, moveSpeed: 2.8, range: 6, ascii: '{O}',
    },
  },
  // === DEMON — Glass Cannon Chaos ===
  [Race.Demon]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Smasher', hp: 68, damage: 10, attackSpeed: 0.9, moveSpeed: 4.2, range: 1, ascii: '/X\\',
    },
    [BuildingType.RangedSpawner]: {
      name: 'Eye Sniper', hp: 45, damage: 11, attackSpeed: 1.3, moveSpeed: 3.5, range: 8, ascii: '@>',
    },
    [BuildingType.CasterSpawner]: {
      name: 'Overlord', hp: 36, damage: 15, attackSpeed: 2.0, moveSpeed: 2.5, range: 7, ascii: '{D}',
    },
  },
  // === DEEP (Aquatic) — Control & Attrition ===
  [Race.Deep]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Shell Guard', hp: 200, damage: 9, attackSpeed: 1.1, moveSpeed: 2.5, range: 1, ascii: '|W|',
    },
    [BuildingType.RangedSpawner]: {
      name: 'Harpooner', hp: 66, damage: 13, attackSpeed: 1.2, moveSpeed: 3.2, range: 7, ascii: '->',
    },
    [BuildingType.CasterSpawner]: {
      name: 'Tidecaller', hp: 54, damage: 17, attackSpeed: 2.2, moveSpeed: 3.0, range: 7, ascii: '{~}',
    },
  },
  // === WILD (Beasts) — Aggression & Poison ===
  [Race.Wild]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Lurker', hp: 65, damage: 8, attackSpeed: 0.9, moveSpeed: 3.0, range: 1, ascii: '%#',
    },
    [BuildingType.RangedSpawner]: {
      name: 'Bonechucker', hp: 45, damage: 11, attackSpeed: 1.0, moveSpeed: 3.6, range: 6, ascii: '.@',
    },
    [BuildingType.CasterSpawner]: {
      name: 'Scaled Sage', hp: 38, damage: 13, attackSpeed: 2.0, moveSpeed: 3.5, range: 7, ascii: '{W}',
    },
  },
  // === GEISTS (Undead) — Undying Attrition ===
  [Race.Geists]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Bone Knight', hp: 85, damage: 8, attackSpeed: 1.0, moveSpeed: 3.5, range: 1, ascii: '~^',
    },
    [BuildingType.RangedSpawner]: {
      name: 'Wraith Bow', hp: 35, damage: 10, attackSpeed: 1.1, moveSpeed: 3.8, range: 7, ascii: '~>',
    },
    [BuildingType.CasterSpawner]: {
      name: 'Necromancer', hp: 29, damage: 13, attackSpeed: 2.2, moveSpeed: 3.0, range: 7, ascii: '{V}',
    },
  },
  // === TENDERS (Nature/Fey) — Sustain & Healing ===
  [Race.Tenders]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Treant', hp: 140, damage: 9, attackSpeed: 1.1, moveSpeed: 2.8, range: 1, ascii: '|T|',
    },
    [BuildingType.RangedSpawner]: {
      name: 'Tinker', hp: 40, damage: 10, attackSpeed: 1.0, moveSpeed: 4.0, range: 7, ascii: '.>',
    },
    [BuildingType.CasterSpawner]: {
      name: 'Grove Keeper', hp: 45, damage: 13, attackSpeed: 2.0, moveSpeed: 3.0, range: 7, ascii: '{Y}',
    },
  },
};

// Tower stats per race
export const TOWER_STATS: Record<Race, { hp: number; damage: number; attackSpeed: number; range: number; ascii: string }> = {
  [Race.Crown]:    { hp: 220, damage: 10, attackSpeed: 1.4, range: 7, ascii: '[||]' },
  [Race.Horde]:    { hp: 250, damage: 14, attackSpeed: 1.4, range: 7, ascii: '[HH]' },
  [Race.Goblins]:  { hp: 150, damage: 10, attackSpeed: 1.0, range: 7, ascii: '[gg]' },
  [Race.Oozlings]: { hp: 170, damage: 8,  attackSpeed: 0.8, range: 7, ascii: '[oo]' },
  [Race.Demon]:    { hp: 160, damage: 18, attackSpeed: 1.8, range: 8, ascii: '<F>' },
  [Race.Deep]:     { hp: 280, damage: 8,  attackSpeed: 1.0, range: 7, ascii: '(@)' },
  [Race.Wild]:     { hp: 200, damage: 10, attackSpeed: 1.0, range: 6, ascii: '[*]' },
  [Race.Geists]:   { hp: 180, damage: 12, attackSpeed: 1.2, range: 8, ascii: '{~}' },
  [Race.Tenders]:  { hp: 260, damage: 8,  attackSpeed: 1.0, range: 5, ascii: '[^^]' },
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
export const BASTION_TOWER_SHIELD_INTERVAL_TICKS = 8 * TICK_RATE;

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
      G: { name: 'Dwarfette Vanguard', desc: 'Fires 2 projectiles', special: { multishotCount: 1, multishotDamagePct: 0.75 }, spawnSpeedMult: 0.82 },
    },
    [BuildingType.CasterSpawner]: {
      B: { name: 'High Priest', desc: '+30% HP, shield +2 targets', hpMult: 1.30, special: { shieldTargetBonus: 2 }, spawnSpeedMult: 0.88 },
      C: { name: 'Battle Priest', desc: 'Faster atk, +25% range', attackSpeedMult: 0.80, rangeMult: 1.25, spawnSpeedMult: 0.88 },
      D: { name: 'Arch Bishop', desc: '+40% HP, shield +3 targets', hpMult: 1.40, special: { shieldTargetBonus: 3 }, spawnSpeedMult: 0.82 },
      E: { name: 'War Cleric', desc: '+35% dmg, shield +20 absorb', damageMult: 1.35, special: { shieldAbsorbBonus: 20 }, spawnSpeedMult: 0.82 },
      F: { name: 'Swift Healer', desc: 'Very fast, shield +25 absorb', attackSpeedMult: 0.65, special: { shieldAbsorbBonus: 25 }, spawnSpeedMult: 0.82 },
      G: { name: 'Holy Avenger', desc: '+50% dmg, +30% range', damageMult: 1.50, rangeMult: 1.30, spawnSpeedMult: 0.82 },
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
  // ============ HORDE (Orcs) — Knockback & Power [HYBRID] ============
  [Race.Horde]: {
    [BuildingType.MeleeSpawner]: {
      B: { name: 'Iron Brute', desc: '+45% HP, +20% dmg', hpMult: 1.45, damageMult: 1.20, spawnSpeedMult: 0.88 },
      C: { name: 'Raging Brute', desc: '+30% dmg, faster atk', damageMult: 1.30, attackSpeedMult: 0.85, spawnSpeedMult: 0.88 },
      D: { name: 'Warchief', desc: '+70% HP, 20% dmg reduction', hpMult: 1.70, special: { damageReductionPct: 0.20 }, spawnSpeedMult: 0.82 },
      E: { name: 'Berserker', desc: '+55% dmg, knockback/hit', damageMult: 1.55, special: { knockbackEveryN: 1 }, spawnSpeedMult: 0.82 },
      F: { name: 'Bloodrager', desc: '+50% dmg, guaranteed haste', damageMult: 1.50, special: { guaranteedHaste: true }, spawnSpeedMult: 0.82 },
      G: { name: 'Skull Crusher', desc: '+60% dmg, faster atk', damageMult: 1.60, attackSpeedMult: 0.80, spawnSpeedMult: 0.82 },
    },
    [BuildingType.RangedSpawner]: {
      B: { name: 'Heavy Cleaver', desc: '+30% HP, +30% dmg', hpMult: 1.30, damageMult: 1.30, spawnSpeedMult: 0.88 },
      C: { name: 'Quick Cleaver', desc: 'Faster atk, +15% speed', attackSpeedMult: 0.80, moveSpeedMult: 1.15, spawnSpeedMult: 0.88 },
      D: { name: 'War Thrower', desc: '+45% dmg, knockback/2', damageMult: 1.45, special: { knockbackEveryN: 2 }, spawnSpeedMult: 0.82 },
      E: { name: 'Siege Cleaver', desc: '+40% dmg, splash 2t', damageMult: 1.40, special: { splashRadius: 2, splashDamagePct: 0.55 }, spawnSpeedMult: 0.82 },
      F: { name: 'Rapid Thrower', desc: 'Much faster, +20% speed', attackSpeedMult: 0.70, moveSpeedMult: 1.20, spawnSpeedMult: 0.82 },
      G: { name: 'Twin Cleaver', desc: 'Fires 2 projectiles', special: { multishotCount: 1, multishotDamagePct: 0.80 }, spawnSpeedMult: 0.82 },
    },
    [BuildingType.CasterSpawner]: {
      B: { name: 'Battle Chanter', desc: '+30% HP, +5 heal', hpMult: 1.30, special: { healBonus: 5 }, spawnSpeedMult: 0.88 },
      C: { name: 'War Drummer', desc: 'Faster atk, +25% range', attackSpeedMult: 0.80, rangeMult: 1.25, spawnSpeedMult: 0.88 },
      D: { name: 'Blood Chanter', desc: '+40% dmg, +8 heal', damageMult: 1.40, special: { healBonus: 8 }, spawnSpeedMult: 0.82 },
      E: { name: 'Rage Shaman', desc: '+45% dmg, +2 AoE', damageMult: 1.45, special: { aoeRadiusBonus: 2 }, spawnSpeedMult: 0.82 },
      F: { name: 'Swift Chanter', desc: 'Very fast, +5 heal', attackSpeedMult: 0.65, special: { healBonus: 5 }, spawnSpeedMult: 0.82 },
      G: { name: 'Doom Chanter', desc: '+55% dmg, +30% range', damageMult: 1.55, rangeMult: 1.30, spawnSpeedMult: 0.82 },
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
      G: { name: 'Pig Warlord', desc: '+40% dmg, +25% range', damageMult: 1.40, rangeMult: 1.25 },
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
      C: { name: 'Quick Glob', desc: '+25% speed, faster atk', moveSpeedMult: 1.25, attackSpeedMult: 0.85, spawnSpeedMult: 0.80 },
      D: { name: 'Armored Glob', desc: '+55% HP, 15% dmg reduction', hpMult: 1.55, special: { damageReductionPct: 0.15 }, spawnSpeedMult: 0.70 },
      E: { name: 'Acid Glob', desc: '+40% dmg, +2 burn', damageMult: 1.40, special: { extraBurnStacks: 2 } },
      F: { name: 'Hyper Glob', desc: '+35% speed, guaranteed haste', moveSpeedMult: 1.35, special: { guaranteedHaste: true }, spawnSpeedMult: 0.70 },
      G: { name: 'Chain Glob', desc: '+35% dmg, chain 2 targets', damageMult: 1.35, special: { extraChainTargets: 2, chainDamagePct: 0.60 } },
    },
    [BuildingType.RangedSpawner]: {
      B: { name: 'Thick Spitter', desc: '+30% HP, +25% dmg', hpMult: 1.30, damageMult: 1.25, spawnSpeedMult: 0.80 },
      C: { name: 'Rapid Spitter', desc: 'Faster atk, +15% speed', attackSpeedMult: 0.80, moveSpeedMult: 1.15, spawnSpeedMult: 0.80 },
      D: { name: 'Acid Spitter', desc: '+35% dmg, +2 slow', damageMult: 1.35, special: { extraSlowStacks: 2 }, spawnSpeedMult: 0.70 },
      E: { name: 'Burst Spitter', desc: '+30% dmg, splash 2t', damageMult: 1.30, special: { splashRadius: 2, splashDamagePct: 0.50 } },
      F: { name: 'Hyper Spitter', desc: 'Much faster, +25% range', attackSpeedMult: 0.70, rangeMult: 1.25, spawnSpeedMult: 0.70 },
      G: { name: 'Storm Spitter', desc: 'Fires 2 projectiles', special: { multishotCount: 1, multishotDamagePct: 0.75 } },
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
      E: { name: 'Firestorm', desc: '+60% dmg, faster atk', damageMult: 1.60, attackSpeedMult: 0.80, spawnSpeedMult: 0.82 },
      F: { name: 'Phoenix Blade', desc: '+20% dmg, +30% speed, revive 60%', damageMult: 1.20, moveSpeedMult: 1.30, special: { reviveHpPct: 0.60 }, spawnSpeedMult: 0.82 },
      G: { name: 'Magma Smasher', desc: '+55% dmg, +3 burn', damageMult: 1.55, special: { extraBurnStacks: 3 }, spawnSpeedMult: 0.82 },
    },
    [BuildingType.RangedSpawner]: {
      B: { name: 'Flame Sniper', desc: '+35% dmg, +20% range', damageMult: 1.35, rangeMult: 1.20, spawnSpeedMult: 0.88 },
      C: { name: 'Rapid Eye', desc: 'Faster atk, +15% speed', attackSpeedMult: 0.80, moveSpeedMult: 1.15, spawnSpeedMult: 0.88 },
      D: { name: 'Meteor Eye', desc: '+45% dmg, splash 2t', damageMult: 1.45, special: { splashRadius: 2, splashDamagePct: 0.60 }, spawnSpeedMult: 0.82 },
      E: { name: 'Scorch Eye', desc: '+40% dmg, +2 burn', damageMult: 1.40, special: { extraBurnStacks: 2 }, spawnSpeedMult: 0.82 },
      F: { name: 'Blitz Eye', desc: 'Very fast, +30% range', attackSpeedMult: 0.70, rangeMult: 1.30, spawnSpeedMult: 0.82 },
      G: { name: 'Inferno Volley', desc: 'Fires 2 projectiles', special: { multishotCount: 1, multishotDamagePct: 0.80 }, spawnSpeedMult: 0.82 },
    },
    [BuildingType.CasterSpawner]: {
      B: { name: 'Hellfire Lord', desc: '+25% HP, +40% dmg', hpMult: 1.25, damageMult: 1.40, spawnSpeedMult: 0.88 },
      C: { name: 'Pyro Lord', desc: 'Faster atk, +25% range', attackSpeedMult: 0.80, rangeMult: 1.25, spawnSpeedMult: 0.88 },
      D: { name: 'Apocalypse Lord', desc: '+50% dmg, +3 burn', damageMult: 1.50, special: { extraBurnStacks: 3 }, spawnSpeedMult: 0.82 },
      E: { name: 'Eruption Lord', desc: '+45% dmg, +1 AoE', damageMult: 1.45, special: { aoeRadiusBonus: 1 }, spawnSpeedMult: 0.82 },
      F: { name: 'Flame Conduit', desc: 'Very fast, +1 AoE', attackSpeedMult: 0.65, special: { aoeRadiusBonus: 1 }, spawnSpeedMult: 0.82 },
      G: { name: 'Phoenix Lord', desc: '+60% dmg, +30% range', damageMult: 1.60, rangeMult: 1.30, spawnSpeedMult: 0.82 },
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
      F: { name: 'Snapper Crab', desc: 'Much faster, +25% range', attackSpeedMult: 0.70, rangeMult: 1.25, spawnSpeedMult: 0.85 },
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
      C: { name: 'Spider Brood', desc: 'Spawn 3 small spiders, +25% speed', hpMult: 0.40, damageMult: 0.40, moveSpeedMult: 1.25, attackSpeedMult: 0.85, special: { spawnCount: 3 }, spawnSpeedMult: 0.88 },
      D: { name: 'Minotaur', desc: '+55% HP, +40% dmg, cleave 2', hpMult: 1.55, damageMult: 1.40, special: { cleaveTargets: 2 }, spawnSpeedMult: 0.82 },
      E: { name: 'Dire Bear', desc: '+65% HP, +35% dmg, 20% dmg reduction', hpMult: 1.65, damageMult: 1.35, special: { damageReductionPct: 0.20 }, spawnSpeedMult: 0.82 },
      F: { name: 'Viper Nest', desc: 'Spawn 3 snakes, +35% speed, +2 slow', hpMult: 0.45, damageMult: 0.45, moveSpeedMult: 1.35, special: { spawnCount: 3, extraSlowStacks: 2 }, spawnSpeedMult: 0.82 },
      G: { name: 'Spider Swarm', desc: 'Spawn 5 spiders, faster atk, +2 slow', attackSpeedMult: 0.80, damageMult: 0.45, hpMult: 0.30, special: { spawnCount: 5, extraSlowStacks: 2 }, spawnSpeedMult: 0.82 },
    },
    [BuildingType.RangedSpawner]: {
      B: { name: 'Chameleon', desc: '+30% HP, +30% dmg', hpMult: 1.30, damageMult: 1.30, spawnSpeedMult: 0.88 },
      C: { name: 'Spitting Snake', desc: 'Faster atk, +2 slow', attackSpeedMult: 0.80, special: { extraSlowStacks: 2 }, spawnSpeedMult: 0.88 },
      D: { name: 'Stalker', desc: '+40% dmg, splash 2t', damageMult: 1.40, special: { splashRadius: 2, splashDamagePct: 0.50 }, spawnSpeedMult: 0.82 },
      E: { name: 'Predator', desc: '+35% dmg, +2 burn', damageMult: 1.35, special: { extraBurnStacks: 2 }, spawnSpeedMult: 0.82 },
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
      G: { name: 'Devourer', desc: '+55% dmg, faster atk', damageMult: 1.55, attackSpeedMult: 0.80, spawnSpeedMult: 0.85 },
    },
    [BuildingType.RangedSpawner]: {
      B: { name: 'Venom Wraith', desc: '+35% dmg, +2 burn', damageMult: 1.35, special: { extraBurnStacks: 2 }, spawnSpeedMult: 0.90 },
      C: { name: 'Bone Skull', desc: 'Faster atk, +25% range', attackSpeedMult: 0.80, rangeMult: 1.25, spawnSpeedMult: 0.90 },
      D: { name: 'Plague Arrow', desc: '+45% dmg, +3 burn', damageMult: 1.45, special: { extraBurnStacks: 3 }, spawnSpeedMult: 0.85 },
      E: { name: 'Hex Volley', desc: 'Fires 2 projectiles', special: { multishotCount: 1, multishotDamagePct: 0.75 }, spawnSpeedMult: 0.85 },
      F: { name: 'Wailing Skull', desc: '+20% dmg, +30% speed, 25% dodge', damageMult: 1.20, moveSpeedMult: 1.30, special: { dodgeChance: 0.25 }, spawnSpeedMult: 0.85 },
      G: { name: 'Death Skull', desc: '+50% dmg, +30% range', damageMult: 1.50, rangeMult: 1.30, spawnSpeedMult: 0.85 },
    },
    [BuildingType.CasterSpawner]: {
      B: { name: 'Plague Mage', desc: '+30% HP, +5 heal', hpMult: 1.30, special: { healBonus: 5 }, spawnSpeedMult: 0.90 },
      C: { name: 'Dark Sorcerer', desc: 'Faster atk, +25% range', attackSpeedMult: 0.80, rangeMult: 1.25, spawnSpeedMult: 0.90 },
      D: { name: 'Pestilence', desc: '+40% dmg, +7 heal, +2 burn', damageMult: 1.40, special: { healBonus: 7, extraBurnStacks: 2 }, spawnSpeedMult: 0.85 },
      E: { name: 'Soul Siphon', desc: '+45% dmg, +2 AoE', damageMult: 1.45, special: { aoeRadiusBonus: 2 }, spawnSpeedMult: 0.85 },
      F: { name: 'Shadow Sorcerer', desc: 'Very fast, +5 heal', attackSpeedMult: 0.65, special: { healBonus: 5 }, spawnSpeedMult: 0.85 },
      G: { name: 'Arch Sorcerer', desc: '+55% dmg, +30% range', damageMult: 1.55, rangeMult: 1.30, spawnSpeedMult: 0.85 },
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
      B: { name: 'Young Ent', desc: '+55% HP, +20% dmg', hpMult: 1.55, damageMult: 1.20, spawnSpeedMult: 0.90, cost: { gold: 0, wood: 45, stone: 0 } },
      C: { name: 'Wild Radish', desc: '+35% HP, regen 3/s', hpMult: 1.35, special: { regenPerSec: 3 }, spawnSpeedMult: 0.90, cost: { gold: 90, wood: 0, stone: 0 } },
      D: { name: 'Elder Ent', desc: '+75% HP, 20% dmg reduction', hpMult: 1.75, special: { damageReductionPct: 0.20 }, spawnSpeedMult: 0.85, cost: { gold: 0, wood: 90, stone: 0 } },
      E: { name: 'Ancient Ent', desc: '+50% dmg, knockback/2', damageMult: 1.50, special: { knockbackEveryN: 2 }, spawnSpeedMult: 0.85, cost: { gold: 0, wood: 90, stone: 0 } },
      F: { name: 'Radish Brute', desc: '+25% dmg, +50% HP, regen 5/s', damageMult: 1.25, hpMult: 1.50, special: { regenPerSec: 5 }, spawnSpeedMult: 0.85, cost: { gold: 180, wood: 0, stone: 0 } },
      G: { name: 'Radish King', desc: '+40% dmg, +20% speed, +2 slow', damageMult: 1.40, moveSpeedMult: 1.20, special: { extraSlowStacks: 2 }, spawnSpeedMult: 0.85, cost: { gold: 180, wood: 0, stone: 0 } },
    },
    [BuildingType.RangedSpawner]: {
      B: { name: 'Heavy Tinker', desc: '+35% HP, +30% dmg', hpMult: 1.35, damageMult: 1.30, spawnSpeedMult: 0.90 },
      C: { name: 'Rapid Tinker', desc: 'Faster atk, +2 slow', attackSpeedMult: 0.80, special: { extraSlowStacks: 2 }, spawnSpeedMult: 0.90 },
      D: { name: 'Blight Tinker', desc: '+40% dmg, splash 2t', damageMult: 1.40, special: { splashRadius: 2, splashDamagePct: 0.50 }, spawnSpeedMult: 0.85 },
      E: { name: 'Toxic Tinker', desc: '+35% dmg, +2 burn', damageMult: 1.35, special: { extraBurnStacks: 2 }, spawnSpeedMult: 0.85 },
      F: { name: 'Swift Tinker', desc: 'Much faster, +25% range', attackSpeedMult: 0.70, rangeMult: 1.25, spawnSpeedMult: 0.85 },
      G: { name: 'Grand Tinker', desc: '+45% dmg, splash 3t', damageMult: 1.45, special: { splashRadius: 3, splashDamagePct: 0.45 }, spawnSpeedMult: 0.85 },
    },
    [BuildingType.CasterSpawner]: {
      B: { name: 'Deep Root', desc: '+35% HP, +5 heal', hpMult: 1.35, special: { healBonus: 5 }, spawnSpeedMult: 0.90 },
      C: { name: 'Spore Weaver', desc: 'Faster atk, +3 slow', attackSpeedMult: 0.80, special: { extraSlowStacks: 3 }, spawnSpeedMult: 0.90 },
      D: { name: 'Ancient Root', desc: '+35% dmg, +8 heal, +2 slow', damageMult: 1.35, special: { healBonus: 8, extraSlowStacks: 2 }, spawnSpeedMult: 0.85 },
      E: { name: 'Bloom Shaper', desc: '+40% dmg, +2 AoE', damageMult: 1.40, special: { aoeRadiusBonus: 2 }, spawnSpeedMult: 0.85 },
      F: { name: 'Mycelium Sage', desc: 'Very fast, +7 heal', attackSpeedMult: 0.65, special: { healBonus: 7 }, spawnSpeedMult: 0.85 },
      G: { name: 'Fungal Lord', desc: '+50% dmg, +35% range', damageMult: 1.50, rangeMult: 1.35, spawnSpeedMult: 0.85 },
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
