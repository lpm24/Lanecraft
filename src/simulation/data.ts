import { BuildingType, Race, TICK_RATE } from './types';

// Race-specific building costs
export const RACE_BUILDING_COSTS: Record<Race, Record<BuildingType, { gold: number; wood: number; stone: number; hp: number }>> = {
  // Crown: Gold+Wood economy. Premium gold cost for strong units.
  [Race.Crown]: {
    [BuildingType.MeleeSpawner]:  { gold: 85,  wood: 0,  stone: 0,  hp: 280 },
    [BuildingType.RangedSpawner]: { gold: 92,  wood: 10, stone: 0,  hp: 230 },
    [BuildingType.CasterSpawner]: { gold: 101, wood: 10, stone: 0,  hp: 200 },
    [BuildingType.Tower]:         { gold: 151, wood: 0,  stone: 13, hp: 220 },
    [BuildingType.HarvesterHut]:  { gold: 50,  wood: 0,  stone: 0,  hp: 150 },
  },
  // Horde: Gold+Stone economy. Durable buildings, stone-heavy costs.
  [Race.Horde]: {
    [BuildingType.MeleeSpawner]:  { gold: 30,  wood: 0,  stone: 60, hp: 350 },
    [BuildingType.RangedSpawner]: { gold: 121, wood: 0,  stone: 16, hp: 300 },
    [BuildingType.CasterSpawner]: { gold: 124, wood: 0,  stone: 19, hp: 250 },
    [BuildingType.Tower]:         { gold: 146, wood: 0,  stone: 40, hp: 280 },
    [BuildingType.HarvesterHut]:  { gold: 50,  wood: 0,  stone: 11, hp: 180 },
  },
  // Goblins: Gold+Wood economy. Very cheap, fragile buildings.
  [Race.Goblins]: {
    [BuildingType.MeleeSpawner]:  { gold: 35,  wood: 11, stone: 0,  hp: 180 },
    [BuildingType.RangedSpawner]: { gold: 39,  wood: 14, stone: 0,  hp: 160 },
    [BuildingType.CasterSpawner]: { gold: 49,  wood: 18, stone: 0,  hp: 140 },
    [BuildingType.Tower]:         { gold: 56,  wood: 18, stone: 0,  hp: 150 },
    [BuildingType.HarvesterHut]:  { gold: 21,  wood: 7,  stone: 0,  hp: 110 },
  },
  // Oozlings: Gold+Stone economy. Cheap (swarm units).
  [Race.Oozlings]: {
    [BuildingType.MeleeSpawner]:  { gold: 60,  wood: 0,  stone: 0,  hp: 200 },
    [BuildingType.RangedSpawner]: { gold: 70,  wood: 0,  stone: 20, hp: 180 },
    [BuildingType.CasterSpawner]: { gold: 45,  wood: 0,  stone: 45, hp: 160 },
    [BuildingType.Tower]:         { gold: 100, wood: 0,  stone: 25, hp: 170 },
    [BuildingType.HarvesterHut]:  { gold: 35,  wood: 0,  stone: 10, hp: 130 },
  },
  // Demon: Stone+Wood economy. No gold. Glass cannon, reduced costs.
  [Race.Demon]: {
    [BuildingType.MeleeSpawner]:  { gold: 0,  wood: 12, stone: 27, hp: 200 },
    [BuildingType.RangedSpawner]: { gold: 0,  wood: 15, stone: 31, hp: 170 },
    [BuildingType.CasterSpawner]: { gold: 0,  wood: 20, stone: 38, hp: 140 },
    [BuildingType.Tower]:         { gold: 0,  wood: 20, stone: 43, hp: 160 },
    [BuildingType.HarvesterHut]:  { gold: 0,  wood: 8,  stone: 14, hp: 120 },
  },
  // Deep: Wood+Gold economy. Very durable buildings.
  [Race.Deep]: {
    [BuildingType.MeleeSpawner]:  { gold: 75, wood: 10, stone: 0,  hp: 380 },
    [BuildingType.RangedSpawner]: { gold: 30, wood: 55, stone: 0,  hp: 300 },
    [BuildingType.CasterSpawner]: { gold: 35, wood: 65, stone: 0,  hp: 260 },
    [BuildingType.Tower]:         { gold: 30, wood: 70, stone: 0,  hp: 280 },
    [BuildingType.HarvesterHut]:  { gold: 15, wood: 30, stone: 0,  hp: 170 },
  },
  // Wild: Wood+Stone economy. No gold. Medium buildings.
  [Race.Wild]: {
    [BuildingType.MeleeSpawner]:  { gold: 0,  wood: 30, stone: 15, hp: 250 },
    [BuildingType.RangedSpawner]: { gold: 0,  wood: 35, stone: 18, hp: 220 },
    [BuildingType.CasterSpawner]: { gold: 0,  wood: 40, stone: 22, hp: 190 },
    [BuildingType.Tower]:         { gold: 0,  wood: 45, stone: 25, hp: 200 },
    [BuildingType.HarvesterHut]:  { gold: 0,  wood: 18, stone: 8,  hp: 140 },
  },
  // Geists: Stone+Gold economy. Medium buildings.
  [Race.Geists]: {
    [BuildingType.MeleeSpawner]:  { gold: 20, wood: 0,  stone: 35, hp: 240 },
    [BuildingType.RangedSpawner]: { gold: 25, wood: 0,  stone: 40, hp: 210 },
    [BuildingType.CasterSpawner]: { gold: 30, wood: 0,  stone: 48, hp: 180 },
    [BuildingType.Tower]:         { gold: 25, wood: 0,  stone: 55, hp: 180 },
    [BuildingType.HarvesterHut]:  { gold: 12, wood: 0,  stone: 18, hp: 130 },
  },
  // Tenders: Wood+Gold economy. Durable natural buildings.
  [Race.Tenders]: {
    [BuildingType.MeleeSpawner]:  { gold: 19, wood: 38, stone: 0,  hp: 320 },
    [BuildingType.RangedSpawner]: { gold: 23, wood: 41, stone: 0,  hp: 270 },
    [BuildingType.CasterSpawner]: { gold: 26, wood: 45, stone: 0,  hp: 240 },
    [BuildingType.Tower]:         { gold: 23, wood: 49, stone: 0,  hp: 300 },
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
  [Race.Crown]:    { tier1: { gold: 60,  wood: 20, stone: 0 },  tier2: { gold: 120, wood: 40, stone: 0 } },
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
      name: 'Swordsman', hp: 70, damage: 9, attackSpeed: 1.0, moveSpeed: 3.5, range: 1, ascii: '[+]',
    },
    [BuildingType.RangedSpawner]: {
      name: 'Bowman', hp: 45, damage: 9, attackSpeed: 1.2, moveSpeed: 3.5, range: 7, ascii: '>>',
    },
    [BuildingType.CasterSpawner]: {
      name: 'Priest', hp: 40, damage: 8, attackSpeed: 2.2, moveSpeed: 3.0, range: 7, ascii: '{C}',
    },
  },
  // === HORDE (Orcs) — Brute Force ===
  [Race.Horde]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Brute', hp: 100, damage: 11, attackSpeed: 1.0, moveSpeed: 3.2, range: 1, ascii: '[#]',
    },
    [BuildingType.RangedSpawner]: {
      name: 'Bowcleaver', hp: 85, damage: 13, attackSpeed: 1.2, moveSpeed: 3.0, range: 7, ascii: '=>',
    },
    [BuildingType.CasterSpawner]: {
      name: 'War Chanter', hp: 51, damage: 13, attackSpeed: 1.8, moveSpeed: 3.2, range: 7, ascii: '{H}',
    },
  },
  // === GOBLINS — Speed & Trickery ===
  [Race.Goblins]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Sticker', hp: 50, damage: 8, attackSpeed: 0.8, moveSpeed: 5.0, range: 1, ascii: '/>',
    },
    [BuildingType.RangedSpawner]: {
      name: 'Knifer', hp: 35, damage: 7, attackSpeed: 0.9, moveSpeed: 4.5, range: 6, ascii: '~>',
    },
    [BuildingType.CasterSpawner]: {
      name: 'Hexer', hp: 28, damage: 10, attackSpeed: 2.0, moveSpeed: 3.5, range: 7, ascii: '{G}',
    },
  },
  // === OOZLINGS (Slimes) — Adaptive Swarm ===
  [Race.Oozlings]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Globule', hp: 45, damage: 7, attackSpeed: 0.7, moveSpeed: 4.2, range: 1, ascii: 'o', spawnCount: 2,
    },
    [BuildingType.RangedSpawner]: {
      name: 'Spitter', hp: 29, damage: 6, attackSpeed: 1.0, moveSpeed: 3.8, range: 6, ascii: 'O~', spawnCount: 2,
    },
    [BuildingType.CasterSpawner]: {
      name: 'Bloater', hp: 35, damage: 12, attackSpeed: 2.2, moveSpeed: 2.8, range: 6, ascii: '{O}',
    },
  },
  // === DEMON — Glass Cannon Chaos ===
  [Race.Demon]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Smasher', hp: 68, damage: 13, attackSpeed: 0.9, moveSpeed: 4.2, range: 1, ascii: '/X\\',
    },
    [BuildingType.RangedSpawner]: {
      name: 'Eye Sniper', hp: 45, damage: 11, attackSpeed: 1.3, moveSpeed: 3.5, range: 8, ascii: '@>',
    },
    [BuildingType.CasterSpawner]: {
      name: 'Overlord', hp: 36, damage: 22, attackSpeed: 2.0, moveSpeed: 2.5, range: 7, ascii: '{D}',
    },
  },
  // === DEEP (Aquatic) — Control & Attrition ===
  [Race.Deep]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Shell Guard', hp: 226, damage: 9, attackSpeed: 1.1, moveSpeed: 2.5, range: 1, ascii: '|W|',
    },
    [BuildingType.RangedSpawner]: {
      name: 'Harpooner', hp: 66, damage: 12, attackSpeed: 1.2, moveSpeed: 3.2, range: 7, ascii: '->',
    },
    [BuildingType.CasterSpawner]: {
      name: 'Tidecaller', hp: 54, damage: 15, attackSpeed: 2.2, moveSpeed: 3.0, range: 7, ascii: '{~}',
    },
  },
  // === WILD (Beasts) — Aggression & Poison ===
  [Race.Wild]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Lurker', hp: 45, damage: 5, attackSpeed: 0.9, moveSpeed: 3.0, range: 1, ascii: '%#',
    },
    [BuildingType.RangedSpawner]: {
      name: 'Bonechucker', hp: 45, damage: 7, attackSpeed: 1.0, moveSpeed: 3.6, range: 6, ascii: '.@',
    },
    [BuildingType.CasterSpawner]: {
      name: 'Scaled Sage', hp: 38, damage: 11, attackSpeed: 2.0, moveSpeed: 3.5, range: 7, ascii: '{W}',
    },
  },
  // === GEISTS (Undead) — Undying Attrition ===
  [Race.Geists]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Bone Knight', hp: 125, damage: 8, attackSpeed: 1.0, moveSpeed: 3.5, range: 1, ascii: '~^',
    },
    [BuildingType.RangedSpawner]: {
      name: 'Wraith Bow', hp: 42, damage: 10, attackSpeed: 1.1, moveSpeed: 3.8, range: 7, ascii: '~>',
    },
    [BuildingType.CasterSpawner]: {
      name: 'Necromancer', hp: 35, damage: 14, attackSpeed: 2.2, moveSpeed: 3.0, range: 7, ascii: '{V}',
    },
  },
  // === TENDERS (Nature/Fey) — Sustain & Healing ===
  [Race.Tenders]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Treant', hp: 120, damage: 9, attackSpeed: 1.1, moveSpeed: 2.8, range: 1, ascii: '|T|',
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
}

export interface UpgradeNodeDef {
  name: string;
  desc: string;
  hpMult?: number;
  damageMult?: number;
  attackSpeedMult?: number;   // <1 = faster
  moveSpeedMult?: number;
  rangeMult?: number;
  special?: UpgradeSpecial;
}

type UpgradeNode = 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

// Upgrade trees: Race -> BuildingType -> Node -> Definition
// Tree shape: A (base) -> B or C (tier 1) -> D/E (under B) or F/G (under C)
export const UPGRADE_TREES: Record<Race, Partial<Record<BuildingType, Record<UpgradeNode, UpgradeNodeDef>>>> = {
  // ============ CROWN (Humans) — Shield & Balance ============
  [Race.Crown]: {
    [BuildingType.MeleeSpawner]: {
      B: { name: 'Iron Guard', desc: '+25% HP, +10% dmg', hpMult: 1.25, damageMult: 1.1 },
      C: { name: 'Swift Blade', desc: '+15% speed, faster atk', moveSpeedMult: 1.15, attackSpeedMult: 0.9 },
      D: { name: 'Royal Knight', desc: '+40% HP, 15% dmg reduction', hpMult: 1.4, special: { damageReductionPct: 0.15 } },
      E: { name: 'Crusader', desc: '+25% dmg, knockback', damageMult: 1.25, special: { knockbackEveryN: 3 } },
      F: { name: 'Duelist', desc: '+25% speed, 20% dodge', moveSpeedMult: 1.25, special: { dodgeChance: 0.2 } },
      G: { name: 'Champion', desc: '+30% dmg, faster atk', damageMult: 1.3, attackSpeedMult: 0.85 },
    },
    [BuildingType.RangedSpawner]: {
      B: { name: 'Heavy Bow', desc: '+20% HP, +15% dmg', hpMult: 1.2, damageMult: 1.15 },
      C: { name: 'Dwarfette Scout', desc: '+10% speed, faster atk', moveSpeedMult: 1.1, attackSpeedMult: 0.85 },
      D: { name: 'Longbow', desc: '+25% dmg, +15% range', damageMult: 1.25, rangeMult: 1.15 },
      E: { name: 'War Bow', desc: '+20% dmg, splash 2t', damageMult: 1.2, special: { splashRadius: 2, splashDamagePct: 0.4 } },
      F: { name: 'Dwarfette Blitzer', desc: 'Much faster, +range', attackSpeedMult: 0.75, rangeMult: 1.15 },
      G: { name: 'Dwarfette Vanguard', desc: 'Fires 2 projectiles', special: { multishotCount: 1, multishotDamagePct: 0.6 } },
    },
    [BuildingType.CasterSpawner]: {
      B: { name: 'High Priest', desc: '+15% HP, shield +1 target', hpMult: 1.15, special: { shieldTargetBonus: 1 } },
      C: { name: 'Battle Priest', desc: 'Faster atk, +15% range', attackSpeedMult: 0.85, rangeMult: 1.15 },
      D: { name: 'Arch Bishop', desc: '+20% HP, shield +2 targets', hpMult: 1.2, special: { shieldTargetBonus: 2 } },
      E: { name: 'War Cleric', desc: '+15% dmg, shield +10 absorb', damageMult: 1.15, special: { shieldAbsorbBonus: 10 } },
      F: { name: 'Swift Healer', desc: 'Very fast, shield +15 absorb', attackSpeedMult: 0.7, special: { shieldAbsorbBonus: 15 } },
      G: { name: 'Holy Avenger', desc: '+30% dmg, +25% range', damageMult: 1.3, rangeMult: 1.25 },
    },
    [BuildingType.Tower]: {
      B: { name: 'Reinforced Tower', desc: '+50% HP, +20% dmg', hpMult: 1.5, damageMult: 1.2 },
      C: { name: 'Rapid Tower', desc: 'Faster atk, +range', attackSpeedMult: 0.8, special: { towerRangeBonus: 1 } },
      D: { name: 'Fortress Tower', desc: '+100% HP, +range', hpMult: 2.0, special: { towerRangeBonus: 2 } },
      E: { name: 'War Tower', desc: '+35% dmg, +range', damageMult: 1.35, special: { towerRangeBonus: 1 } },
      F: { name: 'Gatling Tower', desc: 'Very fast, +range', attackSpeedMult: 0.7, special: { towerRangeBonus: 2 } },
      G: { name: 'Siege Tower', desc: '+40% dmg, +range', damageMult: 1.4, special: { towerRangeBonus: 2 } },
    },
  },
  // ============ HORDE (Orcs) — Knockback & Power ============
  [Race.Horde]: {
    [BuildingType.MeleeSpawner]: {
      B: { name: 'Iron Brute', desc: '+30% HP, +10% dmg', hpMult: 1.3, damageMult: 1.1 },
      C: { name: 'Raging Brute', desc: '+20% dmg, faster atk', damageMult: 1.2, attackSpeedMult: 0.9 },
      D: { name: 'Warchief', desc: '+50% HP, 15% dmg reduction', hpMult: 1.5, special: { damageReductionPct: 0.15 } },
      E: { name: 'Berserker', desc: '+35% dmg, knockback/hit', damageMult: 1.35, special: { knockbackEveryN: 1 } },
      F: { name: 'Bloodrager', desc: '+30% dmg, guaranteed haste', damageMult: 1.3, special: { guaranteedHaste: true } },
      G: { name: 'Skull Crusher', desc: '+40% dmg, faster atk', damageMult: 1.4, attackSpeedMult: 0.85 },
    },
    [BuildingType.RangedSpawner]: {
      B: { name: 'Heavy Cleaver', desc: '+20% HP, +20% dmg', hpMult: 1.2, damageMult: 1.2 },
      C: { name: 'Quick Cleaver', desc: 'Faster atk, +10% speed', attackSpeedMult: 0.85, moveSpeedMult: 1.1 },
      D: { name: 'War Thrower', desc: '+30% dmg, knockback', damageMult: 1.3, special: { knockbackEveryN: 3 } },
      E: { name: 'Siege Cleaver', desc: '+25% dmg, splash 2t', damageMult: 1.25, special: { splashRadius: 2, splashDamagePct: 0.45 } },
      F: { name: 'Rapid Thrower', desc: 'Much faster, +speed', attackSpeedMult: 0.75, moveSpeedMult: 1.15 },
      G: { name: 'Twin Cleaver', desc: 'Fires 2 projectiles', special: { multishotCount: 1, multishotDamagePct: 0.65 } },
    },
    [BuildingType.CasterSpawner]: {
      B: { name: 'Battle Chanter', desc: '+15% HP, +3 heal', hpMult: 1.15, special: { healBonus: 3 } },
      C: { name: 'War Drummer', desc: 'Faster atk, +15% range', attackSpeedMult: 0.85, rangeMult: 1.15 },
      D: { name: 'Blood Chanter', desc: '+20% dmg, +5 heal', damageMult: 1.2, special: { healBonus: 5 } },
      E: { name: 'Rage Shaman', desc: '+25% dmg, +1 AoE', damageMult: 1.25, special: { aoeRadiusBonus: 1 } },
      F: { name: 'Swift Chanter', desc: 'Very fast, +3 heal', attackSpeedMult: 0.7, special: { healBonus: 3 } },
      G: { name: 'Doom Chanter', desc: '+35% dmg, +25% range', damageMult: 1.35, rangeMult: 1.25 },
    },
    [BuildingType.Tower]: {
      B: { name: 'Orc Palisade', desc: '+50% HP, +25% dmg', hpMult: 1.5, damageMult: 1.25 },
      C: { name: 'Spiked Palisade', desc: 'Faster atk, +range', attackSpeedMult: 0.8, special: { towerRangeBonus: 1 } },
      D: { name: 'War Palisade', desc: '+100% HP, +range', hpMult: 2.0, special: { towerRangeBonus: 2 } },
      E: { name: 'Siege Palisade', desc: '+40% dmg, +range', damageMult: 1.4, special: { towerRangeBonus: 1 } },
      F: { name: 'Rapid Palisade', desc: 'Very fast, +range', attackSpeedMult: 0.7, special: { towerRangeBonus: 2 } },
      G: { name: 'Doom Palisade', desc: '+45% dmg, +range', damageMult: 1.45, special: { towerRangeBonus: 2 } },
    },
  },
  // ============ GOBLINS — Dodge & Poison ============
  [Race.Goblins]: {
    [BuildingType.MeleeSpawner]: {
      B: { name: 'Armored Sticker', desc: '+25% HP, +10% dmg', hpMult: 1.25, damageMult: 1.1 },
      C: { name: 'Quick Sticker', desc: '+20% speed, faster atk', moveSpeedMult: 1.2, attackSpeedMult: 0.9 },
      D: { name: 'Poison Lancer', desc: '+20% dmg, +1 burn', damageMult: 1.2, special: { extraBurnStacks: 1 } },
      E: { name: 'Dirty Fighter', desc: '+30% dmg, +1 slow', damageMult: 1.3, special: { extraSlowStacks: 1 } },
      F: { name: 'Shadow Sticker', desc: '+30% speed, 25% dodge', moveSpeedMult: 1.3, special: { dodgeChance: 0.25 } },
      G: { name: 'Goblin Ace', desc: '+35% dmg, faster atk', damageMult: 1.35, attackSpeedMult: 0.85 },
    },
    [BuildingType.RangedSpawner]: {
      B: { name: 'Venom Knifer', desc: '+20% dmg, +1 burn', damageMult: 1.2, special: { extraBurnStacks: 1 } },
      C: { name: 'Quick Knifer', desc: 'Faster atk, +15% range', attackSpeedMult: 0.85, rangeMult: 1.15 },
      D: { name: 'Plague Knifer', desc: '+25% dmg, +2 burn', damageMult: 1.25, special: { extraBurnStacks: 2 } },
      E: { name: 'Fan Knifer', desc: 'Fires 2 projectiles', special: { multishotCount: 1, multishotDamagePct: 0.6 } },
      F: { name: 'Ghost Knifer', desc: '+25% speed, 15% dodge', moveSpeedMult: 1.25, special: { dodgeChance: 0.15 } },
      G: { name: 'Blight Knifer', desc: '+30% dmg, +range', damageMult: 1.3, rangeMult: 1.2 },
    },
    [BuildingType.CasterSpawner]: {
      B: { name: 'Hex Master', desc: '+15% HP, +2 slow', hpMult: 1.15, special: { extraSlowStacks: 2 } },
      C: { name: 'Curse Weaver', desc: 'Faster atk, +15% range', attackSpeedMult: 0.85, rangeMult: 1.15 },
      D: { name: 'Grand Hexer', desc: '+20% dmg, +3 slow', damageMult: 1.2, special: { extraSlowStacks: 3 } },
      E: { name: 'Plague Hexer', desc: '+25% dmg, +1 AoE', damageMult: 1.25, special: { aoeRadiusBonus: 1 } },
      F: { name: 'Rapid Hexer', desc: 'Very fast, +range', attackSpeedMult: 0.7, rangeMult: 1.2 },
      G: { name: 'Doom Hexer', desc: '+35% dmg, +25% range', damageMult: 1.35, rangeMult: 1.25 },
    },
    [BuildingType.Tower]: {
      B: { name: 'Goblin Fort', desc: '+40% HP, +20% dmg', hpMult: 1.4, damageMult: 1.2 },
      C: { name: 'Rapid Fort', desc: 'Much faster, +range', attackSpeedMult: 0.75, special: { towerRangeBonus: 1 } },
      D: { name: 'Poison Fort', desc: '+60% HP, +1 burn', hpMult: 1.6, special: { extraBurnStacks: 1 } },
      E: { name: 'Venom Fort', desc: '+30% dmg, +2 burn', damageMult: 1.3, special: { extraBurnStacks: 2 } },
      F: { name: 'Blitz Fort', desc: 'Very fast, +2 range', attackSpeedMult: 0.65, special: { towerRangeBonus: 2 } },
      G: { name: 'Plague Fort', desc: '+40% dmg, +range', damageMult: 1.4, special: { towerRangeBonus: 2 } },
    },
  },
  // ============ OOZLINGS (Slimes) — Swarm & Haste ============
  [Race.Oozlings]: {
    [BuildingType.MeleeSpawner]: {
      B: { name: 'Tough Glob', desc: '+30% HP, +10% dmg', hpMult: 1.3, damageMult: 1.1 },
      C: { name: 'Quick Glob', desc: '+20% speed, faster atk', moveSpeedMult: 1.2, attackSpeedMult: 0.9 },
      D: { name: 'Armored Glob', desc: '+50% HP, 10% dmg reduction', hpMult: 1.5, special: { damageReductionPct: 0.1 } },
      E: { name: 'Acid Glob', desc: '+30% dmg, +1 burn', damageMult: 1.3, special: { extraBurnStacks: 1 } },
      F: { name: 'Hyper Glob', desc: '+30% speed, guaranteed haste', moveSpeedMult: 1.3, special: { guaranteedHaste: true } },
      G: { name: 'Chain Glob', desc: '+20% dmg, chain attack', damageMult: 1.2, special: { extraChainTargets: 1, chainDamagePct: 0.5 } },
    },
    [BuildingType.RangedSpawner]: {
      B: { name: 'Thick Spitter', desc: '+25% HP, +15% dmg', hpMult: 1.25, damageMult: 1.15 },
      C: { name: 'Rapid Spitter', desc: 'Faster atk, +10% speed', attackSpeedMult: 0.85, moveSpeedMult: 1.1 },
      D: { name: 'Acid Spitter', desc: '+25% dmg, +1 slow', damageMult: 1.25, special: { extraSlowStacks: 1 } },
      E: { name: 'Burst Spitter', desc: '+20% dmg, splash 2t', damageMult: 1.2, special: { splashRadius: 2, splashDamagePct: 0.4 } },
      F: { name: 'Hyper Spitter', desc: 'Much faster, +range', attackSpeedMult: 0.75, rangeMult: 1.15 },
      G: { name: 'Storm Spitter', desc: 'Fires 2 projectiles', special: { multishotCount: 1, multishotDamagePct: 0.6 } },
    },
    [BuildingType.CasterSpawner]: {
      B: { name: 'Big Bloater', desc: '+20% HP, +1 AoE', hpMult: 1.2, special: { aoeRadiusBonus: 1 } },
      C: { name: 'Quick Bloater', desc: 'Faster atk, +15% range', attackSpeedMult: 0.85, rangeMult: 1.15 },
      D: { name: 'Mega Bloater', desc: '+30% dmg, +1 AoE', damageMult: 1.3, special: { aoeRadiusBonus: 1 } },
      E: { name: 'Acid Bloater', desc: '+20% dmg, +2 slow', damageMult: 1.2, special: { extraSlowStacks: 2 } },
      F: { name: 'Hyper Bloater', desc: 'Very fast, +range', attackSpeedMult: 0.7, rangeMult: 1.2 },
      G: { name: 'Ooze Lord', desc: '+35% dmg, +25% range', damageMult: 1.35, rangeMult: 1.25 },
    },
    [BuildingType.Tower]: {
      B: { name: 'Slime Pillar', desc: '+40% HP, +20% dmg', hpMult: 1.4, damageMult: 1.2 },
      C: { name: 'Rapid Pillar', desc: 'Much faster, +chain', attackSpeedMult: 0.75, special: { extraChainTargets: 1 } },
      D: { name: 'Grand Pillar', desc: '+80% HP, +range', hpMult: 1.8, special: { towerRangeBonus: 2 } },
      E: { name: 'Acid Pillar', desc: '+35% dmg, +1 slow', damageMult: 1.35, special: { extraSlowStacks: 1 } },
      F: { name: 'Storm Pillar', desc: '+2 chains, faster', attackSpeedMult: 0.7, special: { extraChainTargets: 2 } },
      G: { name: 'Ooze Beacon', desc: '+40% dmg, +range', damageMult: 1.4, special: { towerRangeBonus: 2 } },
    },
  },
  // ============ DEMON — Burn & Burst ============
  [Race.Demon]: {
    [BuildingType.MeleeSpawner]: {
      B: { name: 'Inferno Smasher', desc: '+20% HP, +20% dmg', hpMult: 1.2, damageMult: 1.2 },
      C: { name: 'Blaze Smasher', desc: '+20% speed, faster atk', moveSpeedMult: 1.2, attackSpeedMult: 0.9 },
      D: { name: 'Doom Smasher', desc: '+30% dmg, +1 burn', damageMult: 1.3, special: { extraBurnStacks: 1 } },
      E: { name: 'Firestorm', desc: '+40% dmg, faster atk', damageMult: 1.4, attackSpeedMult: 0.85 },
      F: { name: 'Phoenix Blade', desc: '+25% speed, revive once', moveSpeedMult: 1.25, special: { reviveHpPct: 0.5 } },
      G: { name: 'Magma Smasher', desc: '+35% dmg, +2 burn', damageMult: 1.35, special: { extraBurnStacks: 2 } },
    },
    [BuildingType.RangedSpawner]: {
      B: { name: 'Flame Sniper', desc: '+25% dmg, +15% range', damageMult: 1.25, rangeMult: 1.15 },
      C: { name: 'Rapid Eye', desc: 'Faster atk, +10% speed', attackSpeedMult: 0.85, moveSpeedMult: 1.1 },
      D: { name: 'Meteor Eye', desc: '+30% dmg, splash 2t', damageMult: 1.3, special: { splashRadius: 2, splashDamagePct: 0.5 } },
      E: { name: 'Scorch Eye', desc: '+25% dmg, +1 burn', damageMult: 1.25, special: { extraBurnStacks: 1 } },
      F: { name: 'Blitz Eye', desc: 'Very fast, +20% range', attackSpeedMult: 0.75, rangeMult: 1.2 },
      G: { name: 'Inferno Volley', desc: 'Fires 2 projectiles', special: { multishotCount: 1, multishotDamagePct: 0.7 } },
    },
    [BuildingType.CasterSpawner]: {
      B: { name: 'Hellfire Lord', desc: '+15% HP, +30% dmg', hpMult: 1.15, damageMult: 1.3 },
      C: { name: 'Pyro Lord', desc: 'Faster atk, +15% range', attackSpeedMult: 0.85, rangeMult: 1.15 },
      D: { name: 'Apocalypse Lord', desc: '+35% dmg, +2 burn', damageMult: 1.35, special: { extraBurnStacks: 2 } },
      E: { name: 'Eruption Lord', desc: '+25% dmg, +1 AoE', damageMult: 1.25, special: { aoeRadiusBonus: 1 } },
      F: { name: 'Flame Conduit', desc: 'Very fast, +1 AoE', attackSpeedMult: 0.7, special: { aoeRadiusBonus: 1 } },
      G: { name: 'Phoenix Lord', desc: '+40% dmg, +range', damageMult: 1.4, rangeMult: 1.2 },
    },
    [BuildingType.Tower]: {
      B: { name: 'Demon Turret', desc: '+35% HP, +30% dmg', hpMult: 1.35, damageMult: 1.3 },
      C: { name: 'Rapid Turret', desc: 'Faster atk, +1 burn', attackSpeedMult: 0.8, special: { extraBurnStacks: 1 } },
      D: { name: 'Inferno Turret', desc: '+60% HP, +50% dmg', hpMult: 1.6, damageMult: 1.5 },
      E: { name: 'Napalm Turret', desc: '+35% dmg, +2 burn', damageMult: 1.35, special: { extraBurnStacks: 2 } },
      F: { name: 'Gatling Turret', desc: 'Very fast, +range', attackSpeedMult: 0.65, special: { towerRangeBonus: 2 } },
      G: { name: 'Dragon Turret', desc: '+45% dmg, +range', damageMult: 1.45, special: { towerRangeBonus: 2 } },
    },
  },
  // ============ DEEP (Aquatic) — Slow & Control ============
  [Race.Deep]: {
    [BuildingType.MeleeSpawner]: {
      B: { name: 'Coral Guard', desc: '+30% HP, +15% dmg', hpMult: 1.3, damageMult: 1.15 },
      C: { name: 'Frog Scout', desc: '+15% speed, +1 slow', moveSpeedMult: 1.15, special: { extraSlowStacks: 1 } },
      D: { name: 'Reef Wall', desc: '+50% HP, 15% dmg reduction', hpMult: 1.5, special: { damageReductionPct: 0.15 } },
      E: { name: 'Tidal Crusher', desc: '+25% dmg, knockback', damageMult: 1.25, special: { knockbackEveryN: 2 } },
      F: { name: 'Leapfrog', desc: '+20% speed, hop attack, +2 slow', moveSpeedMult: 1.2, special: { extraSlowStacks: 2, hopAttack: true } },
      G: { name: 'Frog Titan', desc: '+15% dmg, regen 2/s, hop attack', damageMult: 1.15, special: { regenPerSec: 2, hopAttack: true } },
    },
    [BuildingType.RangedSpawner]: {
      B: { name: 'Deep Shot', desc: '+15% HP, +20% dmg', hpMult: 1.15, damageMult: 1.2 },
      C: { name: 'Spray Shot', desc: 'Faster atk, +1 slow', attackSpeedMult: 0.85, special: { extraSlowStacks: 1 } },
      D: { name: 'Hydro Cannon', desc: '+30% dmg, splash 2t', damageMult: 1.3, special: { splashRadius: 2, splashDamagePct: 0.4 } },
      E: { name: 'Pressure Burst', desc: '+20% dmg, +2 slow', damageMult: 1.2, special: { extraSlowStacks: 2 } },
      F: { name: 'Rapid Bubbles', desc: 'Much faster, +range', attackSpeedMult: 0.75, rangeMult: 1.15 },
      G: { name: 'Torrent Shot', desc: '+15% dmg, splash 2.5t', damageMult: 1.15, special: { splashRadius: 2.5, splashDamagePct: 0.35 } },
    },
    [BuildingType.CasterSpawner]: {
      B: { name: 'Tsunami Caller', desc: '+15% HP, cleanse +1', hpMult: 1.15, special: { healBonus: 1 } },
      C: { name: 'Whirlpool Caller', desc: '+1 AoE, faster atk', special: { aoeRadiusBonus: 1 }, attackSpeedMult: 0.85 },
      D: { name: 'Purifier', desc: '+20% dmg, cleanse +2', damageMult: 1.2, special: { healBonus: 2, extraSlowStacks: 1 } },
      E: { name: 'Maelstrom Mage', desc: '+30% dmg, +1 AoE', damageMult: 1.3, special: { aoeRadiusBonus: 1 } },
      F: { name: 'Purge Weaver', desc: 'Very fast, cleanse +2', attackSpeedMult: 0.7, special: { healBonus: 2 } },
      G: { name: 'Deep Current', desc: '+20% dmg, +30% range', damageMult: 1.2, rangeMult: 1.3 },
    },
    [BuildingType.Tower]: {
      B: { name: 'Tidal Pool', desc: '+40% HP, +25% dmg', hpMult: 1.4, damageMult: 1.25 },
      C: { name: 'Vortex Pool', desc: '+2 slow stacks, +range', special: { extraSlowStacks: 1, towerRangeBonus: 1 } },
      D: { name: 'Abyssal Pool', desc: '+80% HP, +30% dmg, +range', hpMult: 1.8, damageMult: 1.3, special: { towerRangeBonus: 1 } },
      E: { name: 'Crushing Tide', desc: '+40% dmg, +2 slow', damageMult: 1.4, special: { extraSlowStacks: 2 } },
      F: { name: 'Tsunami Tower', desc: '+range, +3 slow stacks', special: { towerRangeBonus: 2, extraSlowStacks: 2 } },
      G: { name: 'Frozen Pool', desc: '+35% dmg, +range', damageMult: 1.35, special: { towerRangeBonus: 2 } },
    },
  },
  // ============ WILD (Beasts) — Poison & Speed ============
  [Race.Wild]: {
    [BuildingType.MeleeSpawner]: {
      B: { name: 'Armored Lurker', desc: '+25% HP, +15% dmg', hpMult: 1.25, damageMult: 1.15 },
      C: { name: 'Minotaur', desc: '+20% speed, faster atk', moveSpeedMult: 1.2, attackSpeedMult: 0.9 },
      D: { name: 'Venom Lurker', desc: '+20% dmg, +1 burn', damageMult: 1.2, special: { extraBurnStacks: 1 } },
      E: { name: 'Pack Alpha', desc: '+30% dmg, +1 slow', damageMult: 1.3, special: { extraSlowStacks: 1 } },
      F: { name: 'Raging Bull', desc: '+30% speed, cleave 2', moveSpeedMult: 1.3, special: { dodgeChance: 0.25, cleaveTargets: 2 } },
      G: { name: 'Stampede', desc: '+35% dmg, cleave 2, +2 burn', damageMult: 1.35, special: { extraBurnStacks: 2, cleaveTargets: 2 } },
    },
    [BuildingType.RangedSpawner]: {
      B: { name: 'Heavy Chucker', desc: '+20% HP, +20% dmg', hpMult: 1.2, damageMult: 1.2 },
      C: { name: 'Rapid Chucker', desc: 'Faster atk, +1 slow', attackSpeedMult: 0.85, special: { extraSlowStacks: 1 } },
      D: { name: 'Blight Chucker', desc: '+25% dmg, splash 2t', damageMult: 1.25, special: { splashRadius: 2, splashDamagePct: 0.4 } },
      E: { name: 'Toxic Chucker', desc: '+20% dmg, +1 burn', damageMult: 1.2, special: { extraBurnStacks: 1 } },
      F: { name: 'Swift Chucker', desc: 'Much faster, +range', attackSpeedMult: 0.75, rangeMult: 1.15 },
      G: { name: 'Pack Chucker', desc: '+25% dmg, splash 2.5t', damageMult: 1.25, special: { splashRadius: 2.5, splashDamagePct: 0.35 } },
    },
    [BuildingType.CasterSpawner]: {
      B: { name: 'Elder Sage', desc: '+20% HP, +3 heal', hpMult: 1.2, special: { healBonus: 3 } },
      C: { name: 'Swift Sage', desc: 'Faster atk, +15% range', attackSpeedMult: 0.85, rangeMult: 1.15 },
      D: { name: 'Primal Sage', desc: '+20% dmg, +5 heal', damageMult: 1.2, special: { healBonus: 5 } },
      E: { name: 'Storm Sage', desc: '+25% dmg, +1 AoE', damageMult: 1.25, special: { aoeRadiusBonus: 1 } },
      F: { name: 'Feral Sage', desc: 'Very fast, +3 heal', attackSpeedMult: 0.7, special: { healBonus: 3 } },
      G: { name: 'Alpha Sage', desc: '+30% dmg, +25% range', damageMult: 1.3, rangeMult: 1.25 },
    },
    [BuildingType.Tower]: {
      B: { name: 'Thorn Nest', desc: '+50% HP, +20% dmg', hpMult: 1.5, damageMult: 1.2 },
      C: { name: 'Venom Nest', desc: '+1 burn, +range', special: { extraBurnStacks: 1, towerRangeBonus: 1 } },
      D: { name: 'Great Nest', desc: '+100% HP, +range', hpMult: 2.0, special: { towerRangeBonus: 2 } },
      E: { name: 'Poison Nest', desc: '+30% dmg, +2 burn', damageMult: 1.3, special: { extraBurnStacks: 2 } },
      F: { name: 'Web Nest', desc: '+3 slow, +range', special: { extraSlowStacks: 3, towerRangeBonus: 1 } },
      G: { name: 'Alpha Nest', desc: '+35% dmg, +range', damageMult: 1.35, special: { towerRangeBonus: 2 } },
    },
  },
  // ============ GEISTS (Undead) — Lifesteal & Revive ============
  [Race.Geists]: {
    [BuildingType.MeleeSpawner]: {
      B: { name: 'Iron Bones', desc: '+20% HP, +15% dmg', hpMult: 1.2, damageMult: 1.15 },
      C: { name: 'Ambush Chest', desc: '+20% speed, 20% dodge', moveSpeedMult: 1.2, special: { dodgeChance: 0.2 } },
      D: { name: 'Death Knight', desc: '+30% dmg, +1 burn', damageMult: 1.3, special: { extraBurnStacks: 1 } },
      E: { name: 'Soul Eater', desc: '+25% HP/dmg, regen 2/s', hpMult: 1.25, damageMult: 1.25, special: { regenPerSec: 2 } },
      F: { name: 'Snapping Mimic', desc: '+30% speed, 30% dodge', moveSpeedMult: 1.3, special: { dodgeChance: 0.3 } },
      G: { name: 'Devourer', desc: '+35% dmg, faster atk', damageMult: 1.35, attackSpeedMult: 0.85 },
    },
    [BuildingType.RangedSpawner]: {
      B: { name: 'Venom Wraith', desc: '+20% dmg, +1 burn', damageMult: 1.2, special: { extraBurnStacks: 1 } },
      C: { name: 'Shadow Arrow', desc: 'Faster atk, +15% range', attackSpeedMult: 0.85, rangeMult: 1.15 },
      D: { name: 'Plague Arrow', desc: '+25% dmg, +2 burn', damageMult: 1.25, special: { extraBurnStacks: 2 } },
      E: { name: 'Hex Volley', desc: 'Fires 2 projectiles', special: { multishotCount: 1, multishotDamagePct: 0.6 } },
      F: { name: 'Ghost Archer', desc: '+25% speed, 15% dodge', moveSpeedMult: 1.25, special: { dodgeChance: 0.15 } },
      G: { name: 'Blight Bow', desc: '+30% dmg, +range', damageMult: 1.3, rangeMult: 1.2 },
    },
    [BuildingType.CasterSpawner]: {
      B: { name: 'Plague Mage', desc: '+15% HP, +3 heal', hpMult: 1.15, special: { healBonus: 3 } },
      C: { name: 'Drain Mage', desc: 'Faster atk, +15% range', attackSpeedMult: 0.85, rangeMult: 1.15 },
      D: { name: 'Pestilence', desc: '+20% dmg, +5 heal', damageMult: 1.2, special: { healBonus: 5, extraBurnStacks: 1 } },
      E: { name: 'Soul Siphon', desc: '+25% dmg, +1 AoE', damageMult: 1.25, special: { aoeRadiusBonus: 1 } },
      F: { name: 'Void Weaver', desc: 'Very fast, +3 heal', attackSpeedMult: 0.7, special: { healBonus: 3 } },
      G: { name: 'Death Caller', desc: '+35% dmg, +25% range', damageMult: 1.35, rangeMult: 1.25 },
    },
    [BuildingType.Tower]: {
      B: { name: 'Shadow Spire', desc: '+40% HP, +25% dmg', hpMult: 1.4, damageMult: 1.25 },
      C: { name: 'Wither Spire', desc: '+1 burn, +range', special: { extraBurnStacks: 1, towerRangeBonus: 1 } },
      D: { name: 'Void Spire', desc: '+70% HP, +35% dmg', hpMult: 1.7, damageMult: 1.35 },
      E: { name: 'Blight Spire', desc: '+30% dmg, +2 burn', damageMult: 1.3, special: { extraBurnStacks: 2 } },
      F: { name: 'Nightmare Spire', desc: 'Very fast, +range', attackSpeedMult: 0.7, special: { towerRangeBonus: 2 } },
      G: { name: 'Death Spire', desc: '+40% dmg, +range', damageMult: 1.4, special: { towerRangeBonus: 2 } },
    },
  },
  // ============ TENDERS (Nature) — Regen & Heal ============
  [Race.Tenders]: {
    [BuildingType.MeleeSpawner]: {
      B: { name: 'Ironbark', desc: '+35% HP, +10% dmg', hpMult: 1.35, damageMult: 1.1 },
      C: { name: 'Thornhide', desc: '+20% HP, regen 2/s', hpMult: 1.2, special: { regenPerSec: 2 } },
      D: { name: 'Ancient Oak', desc: '+50% HP, 15% dmg reduction', hpMult: 1.5, special: { damageReductionPct: 0.15 } },
      E: { name: 'Barkbreaker', desc: '+30% dmg, knockback', damageMult: 1.3, special: { knockbackEveryN: 2 } },
      F: { name: 'Mossheart', desc: '+30% HP, regen 3/s', hpMult: 1.3, special: { regenPerSec: 3 } },
      G: { name: 'Wildroot', desc: '+20% dmg/speed, +1 slow', damageMult: 1.2, moveSpeedMult: 1.15, special: { extraSlowStacks: 1 } },
    },
    [BuildingType.RangedSpawner]: {
      B: { name: 'Heavy Tinker', desc: '+20% HP, +20% dmg', hpMult: 1.2, damageMult: 1.2 },
      C: { name: 'Rapid Tinker', desc: 'Faster atk, +1 slow', attackSpeedMult: 0.85, special: { extraSlowStacks: 1 } },
      D: { name: 'Blight Tinker', desc: '+25% dmg, splash 2t', damageMult: 1.25, special: { splashRadius: 2, splashDamagePct: 0.4 } },
      E: { name: 'Toxic Tinker', desc: '+20% dmg, +1 burn', damageMult: 1.2, special: { extraBurnStacks: 1 } },
      F: { name: 'Swift Tinker', desc: 'Much faster, +range', attackSpeedMult: 0.75, rangeMult: 1.15 },
      G: { name: 'Grand Tinker', desc: '+25% dmg, splash 2.5t', damageMult: 1.25, special: { splashRadius: 2.5, splashDamagePct: 0.35 } },
    },
    [BuildingType.CasterSpawner]: {
      B: { name: 'Deep Root', desc: '+20% HP, +3 heal', hpMult: 1.2, special: { healBonus: 3 } },
      C: { name: 'Spore Weaver', desc: 'Faster atk, +2 slow', attackSpeedMult: 0.85, special: { extraSlowStacks: 2 } },
      D: { name: 'Ancient Root', desc: '+15% dmg, +5 heal', damageMult: 1.15, special: { healBonus: 5, extraSlowStacks: 1 } },
      E: { name: 'Bloom Shaper', desc: '+20% dmg, +1 AoE', damageMult: 1.2, special: { aoeRadiusBonus: 1 } },
      F: { name: 'Mycelium Sage', desc: 'Very fast, +4 heal', attackSpeedMult: 0.7, special: { healBonus: 4 } },
      G: { name: 'Fungal Lord', desc: '+30% dmg, +25% range', damageMult: 1.3, rangeMult: 1.25 },
    },
    [BuildingType.Tower]: {
      B: { name: 'Thorn Wall', desc: '+50% HP, +20% dmg', hpMult: 1.5, damageMult: 1.2 },
      C: { name: 'Vine Tower', desc: '+2 slow, +range', special: { extraSlowStacks: 2, towerRangeBonus: 1 } },
      D: { name: 'Great Thorn', desc: '+100% HP, +range', hpMult: 2.0, special: { towerRangeBonus: 2 } },
      E: { name: 'Poison Thorn', desc: '+30% dmg, +1 burn', damageMult: 1.3, special: { extraBurnStacks: 1 } },
      F: { name: 'Entangle Tower', desc: '+3 slow, +range', special: { extraSlowStacks: 3, towerRangeBonus: 1 } },
      G: { name: 'Nature Spire', desc: '+35% dmg, +range', damageMult: 1.35, special: { towerRangeBonus: 2 } },
    },
  },
};
