import { BuildingType, Race, TICK_RATE } from './types';

// Race-specific building costs
export const RACE_BUILDING_COSTS: Record<Race, Record<BuildingType, { gold: number; wood: number; stone: number; hp: number }>> = {
  // Surge: Gold-only economy. Cheap, fast to build. No wood/stone for basics.
  [Race.Surge]: {
    [BuildingType.MeleeSpawner]:  { gold: 80,  wood: 0,  stone: 5,  hp: 250 },
    [BuildingType.RangedSpawner]: { gold: 100, wood: 0,  stone: 0,  hp: 200 },
    [BuildingType.CasterSpawner]: { gold: 130, wood: 5,  stone: 0,  hp: 170 },
    [BuildingType.Tower]:         { gold: 160, wood: 0,  stone: 15, hp: 200 },
    [BuildingType.HarvesterHut]:  { gold: 50,  wood: 0,  stone: 0,  hp: 150 },
  },
  // Tide: Wood-heavy economy. Organic coral/driftwood constructs.
  [Race.Tide]: {
    [BuildingType.MeleeSpawner]:  { gold: 50,  wood: 25, stone: 0,  hp: 350 },
    [BuildingType.RangedSpawner]: { gold: 60,  wood: 30, stone: 0,  hp: 280 },
    [BuildingType.CasterSpawner]: { gold: 80,  wood: 35, stone: 10, hp: 220 },
    [BuildingType.Tower]:         { gold: 100, wood: 25, stone: 15, hp: 250 },
    [BuildingType.HarvesterHut]:  { gold: 30,  wood: 15, stone: 0,  hp: 150 },
  },
  // Ember: Wood+Stone economy (stone heavy). Powerful but fragile forged units.
  [Race.Ember]: {
    [BuildingType.MeleeSpawner]:  { gold: 0,  wood: 15, stone: 30, hp: 220 },
    [BuildingType.RangedSpawner]: { gold: 0,  wood: 20, stone: 40, hp: 180 },
    [BuildingType.CasterSpawner]: { gold: 0,  wood: 25, stone: 50, hp: 150 },
    [BuildingType.Tower]:         { gold: 0,  wood: 30, stone: 60, hp: 180 },
    [BuildingType.HarvesterHut]:  { gold: 0,  wood: 10, stone: 15, hp: 120 },
  },
  // Bastion: Stone-heavy economy. Cheap gold, expensive stone. Very durable.
  [Race.Bastion]: {
    [BuildingType.MeleeSpawner]:  { gold: 50,  wood: 0,  stone: 25, hp: 400 },
    [BuildingType.RangedSpawner]: { gold: 60,  wood: 0,  stone: 30, hp: 320 },
    [BuildingType.CasterSpawner]: { gold: 80,  wood: 0,  stone: 40, hp: 280 },
    [BuildingType.Tower]:         { gold: 80,  wood: 0,  stone: 50, hp: 350 },
    [BuildingType.HarvesterHut]:  { gold: 30,  wood: 0,  stone: 10, hp: 180 },
  },
  // Shade: Wood+Gold economy. Shadow assassins, poison, lifesteal.
  [Race.Shade]: {
    [BuildingType.MeleeSpawner]:  { gold: 70,  wood: 20, stone: 0,  hp: 220 },
    [BuildingType.RangedSpawner]: { gold: 80,  wood: 25, stone: 0,  hp: 180 },
    [BuildingType.CasterSpawner]: { gold: 110, wood: 30, stone: 0,  hp: 150 },
    [BuildingType.Tower]:         { gold: 140, wood: 35, stone: 0,  hp: 170 },
    [BuildingType.HarvesterHut]:  { gold: 40,  wood: 10, stone: 0,  hp: 130 },
  },
  // Thorn: Wood+Stone economy (wood heavy). No gold. Primal swarm, regen, thorns.
  [Race.Thorn]: {
    [BuildingType.MeleeSpawner]:  { gold: 0,  wood: 30, stone: 15, hp: 300 },
    [BuildingType.RangedSpawner]: { gold: 0,  wood: 35, stone: 20, hp: 250 },
    [BuildingType.CasterSpawner]: { gold: 0,  wood: 40, stone: 25, hp: 220 },
    [BuildingType.Tower]:         { gold: 0,  wood: 50, stone: 30, hp: 280 },
    [BuildingType.HarvesterHut]:  { gold: 0,  wood: 15, stone: 10, hp: 160 },
  },
};

// Backwards-compatible helper (used by code that doesn't have race context)
export function getBuildingCost(race: Race, type: BuildingType) {
  return RACE_BUILDING_COSTS[race][type];
}

// Keep old BUILDING_COSTS as Surge defaults for any code that still uses it
export const BUILDING_COSTS = RACE_BUILDING_COSTS[Race.Surge];

// Race-specific upgrade costs
export const RACE_UPGRADE_COSTS: Record<Race, { tier1: { gold: number; wood: number; stone: number }; tier2: { gold: number; wood: number; stone: number } }> = {
  [Race.Surge]:   { tier1: { gold: 80,  wood: 10, stone: 0 },  tier2: { gold: 160, wood: 20, stone: 0 } },
  [Race.Tide]:    { tier1: { gold: 50,  wood: 25, stone: 5 },  tier2: { gold: 100, wood: 50, stone: 10 } },
  [Race.Ember]:   { tier1: { gold: 0,  wood: 15, stone: 30 }, tier2: { gold: 0,  wood: 30, stone: 60 } },
  [Race.Bastion]: { tier1: { gold: 50,  wood: 0,  stone: 30 }, tier2: { gold: 100, wood: 0,  stone: 60 } },
  [Race.Shade]:   { tier1: { gold: 60,  wood: 20, stone: 0 },  tier2: { gold: 120, wood: 40, stone: 0 } },
  [Race.Thorn]:   { tier1: { gold: 0,  wood: 25, stone: 15 }, tier2: { gold: 0,  wood: 50, stone: 30 } },
};

// Keep old flat export for backwards compat
export const UPGRADE_COSTS = RACE_UPGRADE_COSTS[Race.Surge];

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
  [Race.Surge]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Volt Runner', hp: 20, damage: 3, attackSpeed: 0.8, moveSpeed: 5, range: 1, ascii: '/>', spawnCount: 2,
    },
    [BuildingType.RangedSpawner]: {
      name: 'Arc Lancer', hp: 13, damage: 3, attackSpeed: 1.2, moveSpeed: 4, range: 8, ascii: '~>', spawnCount: 2,
    },
    [BuildingType.CasterSpawner]: {
      name: 'Tesla Weaver', hp: 10, damage: 5, attackSpeed: 2.0, moveSpeed: 3, range: 7, ascii: '{S}', spawnCount: 2,
    },
  },
  [Race.Tide]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Coral Warden', hp: 110, damage: 8, attackSpeed: 1.0, moveSpeed: 3.5, range: 1, ascii: '|W|',
    },
    [BuildingType.RangedSpawner]: {
      name: 'Spume Spitter', hp: 55, damage: 9, attackSpeed: 1.3, moveSpeed: 3.5, range: 7, ascii: 'o~',
    },
    [BuildingType.CasterSpawner]: {
      name: 'Riptide Shaper', hp: 45, damage: 14, attackSpeed: 2.2, moveSpeed: 3, range: 7, ascii: '{T}',
    },
  },
  [Race.Ember]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Cinderblade', hp: 70, damage: 15, attackSpeed: 0.9, moveSpeed: 4.5, range: 1, ascii: '/F\\',
    },
    [BuildingType.RangedSpawner]: {
      name: 'Flare Hawk', hp: 45, damage: 13, attackSpeed: 1.1, moveSpeed: 4, range: 8, ascii: '>>',
    },
    [BuildingType.CasterSpawner]: {
      name: 'Magma Caller', hp: 35, damage: 22, attackSpeed: 2.5, moveSpeed: 3, range: 6, ascii: '{I}',
    },
  },
  [Race.Bastion]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Rampart', hp: 150, damage: 6, attackSpeed: 1.2, moveSpeed: 2.5, range: 1, ascii: '[#]',
    },
    [BuildingType.RangedSpawner]: {
      name: 'Siege Boulder', hp: 60, damage: 11, attackSpeed: 1.4, moveSpeed: 3, range: 7, ascii: '.o',
    },
    [BuildingType.CasterSpawner]: {
      name: 'Geomancer', hp: 50, damage: 10, attackSpeed: 2.0, moveSpeed: 3, range: 6, ascii: '{E}',
    },
  },
  [Race.Shade]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Phantom', hp: 65, damage: 14, attackSpeed: 0.85, moveSpeed: 4.8, range: 1, ascii: '~^',
    },
    [BuildingType.RangedSpawner]: {
      name: 'Hex Fang', hp: 42, damage: 11, attackSpeed: 1.1, moveSpeed: 4.2, range: 8, ascii: '~>',
    },
    [BuildingType.CasterSpawner]: {
      name: 'Blight Weaver', hp: 38, damage: 16, attackSpeed: 2.2, moveSpeed: 3, range: 7, ascii: '{V}',
    },
  },
  [Race.Thorn]: {
    [BuildingType.MeleeSpawner]: {
      name: 'Briarguard', hp: 120, damage: 7, attackSpeed: 1.1, moveSpeed: 3.2, range: 1, ascii: '%#',
    },
    [BuildingType.RangedSpawner]: {
      name: 'Spore Launcher', hp: 55, damage: 9, attackSpeed: 1.3, moveSpeed: 3.5, range: 6, ascii: '.@',
    },
    [BuildingType.CasterSpawner]: {
      name: 'Root Shaper', hp: 48, damage: 12, attackSpeed: 2.0, moveSpeed: 3, range: 7, ascii: '{Y}',
    },
  },
};

// Tower stats per race
export const TOWER_STATS: Record<Race, { hp: number; damage: number; attackSpeed: number; range: number; ascii: string }> = {
  [Race.Surge]: { hp: 200, damage: 15, attackSpeed: 1.5, range: 9, ascii: '[Z]' },
  [Race.Tide]: { hp: 250, damage: 8, attackSpeed: 1.0, range: 7, ascii: '(@)' },
  [Race.Ember]: { hp: 180, damage: 20, attackSpeed: 1.8, range: 8, ascii: '<F>' },
  [Race.Bastion]: { hp: 350, damage: 10, attackSpeed: 1.5, range: 6, ascii: '[||]' },
  [Race.Shade]:   { hp: 170, damage: 12, attackSpeed: 1.2, range: 8, ascii: '{~}' },
  [Race.Thorn]:   { hp: 280, damage: 8,  attackSpeed: 1.0, range: 5, ascii: '[*]' },
};

// Race accent colors
export const RACE_COLORS: Record<Race, { primary: string; secondary: string }> = {
  [Race.Surge]: { primary: '#00e5ff', secondary: '#7c4dff' },
  [Race.Tide]: { primary: '#2979ff', secondary: '#00e676' },
  [Race.Ember]: { primary: '#ff5722', secondary: '#ffab00' },
  [Race.Bastion]: { primary: '#8d6e63', secondary: '#bdbdbd' },
  [Race.Shade]:   { primary: '#9c27b0', secondary: '#ce93d8' },
  [Race.Thorn]:   { primary: '#4caf50', secondary: '#a5d6a7' },
};

// Player colors: Blue and Teal (bottom team) vs Red and Orange (top team)
export const PLAYER_COLORS: string[] = [
  '#2979ff',  // P0 - Blue
  '#00bfa5',  // P1 - Teal
  '#ff1744',  // P2 - Red
  '#ff9100',  // P3 - Orange
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
  shieldTargetBonus?: number;   // extra shield targets (Bastion caster)
  shieldAbsorbBonus?: number;   // extra shield absorb amount
  regenPerSec?: number;         // HP regen per second
  damageReductionPct?: number;  // % damage reduction
  reviveHpPct?: number;         // revive once at this % HP
  multishotCount?: number;      // extra projectiles per attack
  multishotDamagePct?: number;  // damage per extra projectile
  towerRangeBonus?: number;     // extra tower range
  towerShieldIntervalMult?: number; // multiply shield interval (lower = faster)
  healBonus?: number;           // extra heal amount for support casters
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
  // ============ SURGE (Electric) — Speed & Chain ============
  [Race.Surge]: {
    [BuildingType.MeleeSpawner]: {
      B: { name: 'Hardened Blade', desc: '+20% HP, +10% dmg', hpMult: 1.2, damageMult: 1.1 },
      C: { name: 'Swift Blade', desc: '+15% speed, faster atk', moveSpeedMult: 1.15, attackSpeedMult: 0.9 },
      D: { name: 'Iron Spark', desc: '+35% HP, +20% dmg, knockback', hpMult: 1.35, damageMult: 1.2, special: { knockbackEveryN: 3 } },
      E: { name: 'Berserker', desc: '+35% dmg, guaranteed haste', damageMult: 1.35, special: { guaranteedHaste: true } },
      F: { name: 'Phantom Blade', desc: '+30% speed, 25% dodge', moveSpeedMult: 1.3, special: { dodgeChance: 0.25 } },
      G: { name: 'Chain Striker', desc: '+15% dmg, chain attack', damageMult: 1.15, special: { extraChainTargets: 1, chainDamagePct: 0.5 } },
    },
    [BuildingType.RangedSpawner]: {
      B: { name: 'Heavy Arc', desc: '+20% HP, +15% dmg', hpMult: 1.2, damageMult: 1.15 },
      C: { name: 'Quick Shot', desc: '+10% speed, faster atk', moveSpeedMult: 1.1, attackSpeedMult: 0.85 },
      D: { name: 'Thunder Bolt', desc: '+25% dmg, chain to 2', damageMult: 1.25, special: { extraChainTargets: 2, chainDamagePct: 0.4 } },
      E: { name: 'Overcharge', desc: '+20% dmg, applies slow', damageMult: 1.2, special: { extraSlowStacks: 1 } },
      F: { name: 'Flash Archer', desc: '+25% speed, +15% range', moveSpeedMult: 1.25, rangeMult: 1.15 },
      G: { name: 'Storm Volley', desc: 'Fires 2 projectiles', special: { multishotCount: 1, multishotDamagePct: 0.6 } },
    },
    [BuildingType.CasterSpawner]: {
      B: { name: 'Tempest Mage', desc: '+15% HP, haste +1', hpMult: 1.15, special: { healBonus: 1 } },
      C: { name: 'Conduit Mage', desc: 'Faster atk, +15% range', attackSpeedMult: 0.85, rangeMult: 1.15 },
      D: { name: 'Hurricane Mage', desc: '+20% dmg, +2 slow', damageMult: 1.2, special: { extraSlowStacks: 2 } },
      E: { name: 'Overcharge', desc: '+15% dmg, haste +2', damageMult: 1.15, special: { healBonus: 2 } },
      F: { name: 'Lightning Weave', desc: 'Much faster, +range', attackSpeedMult: 0.75, rangeMult: 1.2 },
      G: { name: 'Surge Amplifier', desc: '+30% dmg, +25% range', damageMult: 1.3, rangeMult: 1.25 },
    },
    [BuildingType.Tower]: {
      B: { name: 'Reinforced Coil', desc: '+50% HP, +20% dmg', hpMult: 1.5, damageMult: 1.2 },
      C: { name: 'Rapid Coil', desc: 'Faster atk, +1 chain', attackSpeedMult: 0.8, special: { extraChainTargets: 1 } },
      D: { name: 'Fortress Coil', desc: '+100% HP, +30% dmg', hpMult: 2.0, damageMult: 1.3, special: { towerRangeBonus: 2 } },
      E: { name: 'Overload Coil', desc: '+40% dmg, stronger chains', damageMult: 1.4, special: { chainDamagePct: 0.8 } },
      F: { name: 'Tesla Array', desc: '+2 chains, faster atk', attackSpeedMult: 0.75, special: { extraChainTargets: 2 } },
      G: { name: 'Arc Beacon', desc: '+35% dmg, +range', damageMult: 1.35, special: { towerRangeBonus: 3 } },
    },
  },
  // ============ TIDE (Water) — Control & Attrition ============
  [Race.Tide]: {
    [BuildingType.MeleeSpawner]: {
      B: { name: 'Coral Guard', desc: '+30% HP, +15% dmg', hpMult: 1.3, damageMult: 1.15 },
      C: { name: 'Current Blade', desc: '+15% speed, +1 slow', moveSpeedMult: 1.15, special: { extraSlowStacks: 1 } },
      D: { name: 'Reef Wall', desc: '+50% HP, 15% dmg reduction', hpMult: 1.5, special: { damageReductionPct: 0.15 } },
      E: { name: 'Tidal Crusher', desc: '+25% dmg, knockback', damageMult: 1.25, special: { knockbackEveryN: 2 } },
      F: { name: 'Riptide', desc: '+20% speed, +2 slow stacks', moveSpeedMult: 1.2, special: { extraSlowStacks: 2 } },
      G: { name: 'Undertow Guard', desc: '+15% dmg, regen 2/s', damageMult: 1.15, special: { regenPerSec: 2 } },
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
      B: { name: 'Reinforced Pool', desc: '+40% HP, +25% dmg', hpMult: 1.4, damageMult: 1.25 },
      C: { name: 'Vortex Pool', desc: '+2 slow stacks, +range', special: { extraSlowStacks: 1, towerRangeBonus: 1 } },
      D: { name: 'Abyssal Pool', desc: '+80% HP, +30% dmg, +range', hpMult: 1.8, damageMult: 1.3, special: { towerRangeBonus: 1 } },
      E: { name: 'Crushing Tide', desc: '+40% dmg, +2 slow', damageMult: 1.4, special: { extraSlowStacks: 2 } },
      F: { name: 'Tsunami Tower', desc: '+range, +3 slow stacks', special: { towerRangeBonus: 2, extraSlowStacks: 2 } },
      G: { name: 'Frozen Pool', desc: '+35% dmg, +range', damageMult: 1.35, special: { towerRangeBonus: 2 } },
    },
  },
  // ============ EMBER (Fire) — Burst Damage ============
  [Race.Ember]: {
    [BuildingType.MeleeSpawner]: {
      B: { name: 'Inferno Knight', desc: '+20% HP, +20% dmg', hpMult: 1.2, damageMult: 1.2 },
      C: { name: 'Blaze Runner', desc: '+20% speed, faster atk', moveSpeedMult: 1.2, attackSpeedMult: 0.9 },
      D: { name: 'Volcano Knight', desc: '+30% dmg, +1 burn', damageMult: 1.3, special: { extraBurnStacks: 1 } },
      E: { name: 'Firestorm', desc: '+40% dmg, faster atk', damageMult: 1.4, attackSpeedMult: 0.85 },
      F: { name: 'Phoenix Blade', desc: '+25% speed, revive once', moveSpeedMult: 1.25, special: { reviveHpPct: 0.5 } },
      G: { name: 'Magma Striker', desc: '+35% dmg, +2 burn', damageMult: 1.35, special: { extraBurnStacks: 2 } },
    },
    [BuildingType.RangedSpawner]: {
      B: { name: 'Flame Sniper', desc: '+25% dmg, +15% range', damageMult: 1.25, rangeMult: 1.15 },
      C: { name: 'Rapid Fire', desc: 'Faster atk, +10% speed', attackSpeedMult: 0.85, moveSpeedMult: 1.1 },
      D: { name: 'Meteor Archer', desc: '+30% dmg, splash 2t', damageMult: 1.3, special: { splashRadius: 2, splashDamagePct: 0.5 } },
      E: { name: 'Scorch Archer', desc: '+25% dmg, +1 burn', damageMult: 1.25, special: { extraBurnStacks: 1 } },
      F: { name: 'Blitz Archer', desc: 'Very fast, +20% range', attackSpeedMult: 0.75, rangeMult: 1.2 },
      G: { name: 'Inferno Volley', desc: 'Fires 2 projectiles', special: { multishotCount: 1, multishotDamagePct: 0.7 } },
    },
    [BuildingType.CasterSpawner]: {
      B: { name: 'Hellfire Mage', desc: '+15% HP, +30% dmg', hpMult: 1.15, damageMult: 1.3 },
      C: { name: 'Pyro Mage', desc: 'Faster atk, +15% range', attackSpeedMult: 0.85, rangeMult: 1.15 },
      D: { name: 'Apocalypse Mage', desc: '+35% dmg, +2 burn', damageMult: 1.35, special: { extraBurnStacks: 2 } },
      E: { name: 'Eruption Mage', desc: '+25% dmg, +1 AoE', damageMult: 1.25, special: { aoeRadiusBonus: 1 } },
      F: { name: 'Flame Conduit', desc: 'Very fast, +1 AoE', attackSpeedMult: 0.7, special: { aoeRadiusBonus: 1 } },
      G: { name: 'Phoenix Mage', desc: '+40% dmg, +range', damageMult: 1.4, rangeMult: 1.2 },
    },
    [BuildingType.Tower]: {
      B: { name: 'Reinforced Turret', desc: '+35% HP, +30% dmg', hpMult: 1.35, damageMult: 1.3 },
      C: { name: 'Rapid Turret', desc: 'Faster atk, +1 burn', attackSpeedMult: 0.8, special: { extraBurnStacks: 1 } },
      D: { name: 'Inferno Turret', desc: '+60% HP, +50% dmg', hpMult: 1.6, damageMult: 1.5 },
      E: { name: 'Napalm Turret', desc: '+35% dmg, +2 burn', damageMult: 1.35, special: { extraBurnStacks: 2 } },
      F: { name: 'Gatling Turret', desc: 'Very fast, +range', attackSpeedMult: 0.65, special: { towerRangeBonus: 2 } },
      G: { name: 'Dragon Turret', desc: '+45% dmg, +range', damageMult: 1.45, special: { towerRangeBonus: 2 } },
    },
  },
  // ============ BASTION (Stone) — Durability & Defense ============
  [Race.Bastion]: {
    [BuildingType.MeleeSpawner]: {
      B: { name: 'Iron Wall', desc: '+40% HP, +10% dmg', hpMult: 1.4, damageMult: 1.1 },
      C: { name: 'Granite Fist', desc: '+15% HP, knockback/2nd', hpMult: 1.15, special: { knockbackEveryN: 2 } },
      D: { name: 'Fortress Wall', desc: '+60% HP, 15% dmg reduction', hpMult: 1.6, special: { damageReductionPct: 0.15 } },
      E: { name: 'Seismic Wall', desc: '+25% dmg, knockback/hit', damageMult: 1.25, special: { knockbackEveryN: 1 } },
      F: { name: 'Boulder Warrior', desc: '+25% HP/dmg, +speed', hpMult: 1.25, damageMult: 1.25, moveSpeedMult: 1.15 },
      G: { name: 'Living Wall', desc: '+20% dmg, regen 3/s', damageMult: 1.2, special: { regenPerSec: 3 } },
    },
    [BuildingType.RangedSpawner]: {
      B: { name: 'Boulder Thrower', desc: '+20% HP, +20% dmg', hpMult: 1.2, damageMult: 1.2 },
      C: { name: 'Sling Master', desc: 'Faster atk, +15% range', attackSpeedMult: 0.85, rangeMult: 1.15 },
      D: { name: 'Siege Thrower', desc: '+30% dmg, 35% knockback', damageMult: 1.3, special: { knockbackEveryN: 3 } },
      E: { name: 'Crystal Thrower', desc: '+20% dmg, shields ally', damageMult: 1.2, special: { shieldTargetBonus: 1 } },
      F: { name: 'Quick Slinger', desc: 'Much faster, +speed', attackSpeedMult: 0.75, moveSpeedMult: 1.15 },
      G: { name: 'Avalanche', desc: '+20% dmg, splash 2t', damageMult: 1.2, special: { splashRadius: 2, splashDamagePct: 0.5 } },
    },
    [BuildingType.CasterSpawner]: {
      B: { name: 'Stone Shaman', desc: '+15% HP, shield +1 target', hpMult: 1.15, special: { shieldTargetBonus: 1 } },
      C: { name: 'Crystal Shaman', desc: 'Faster atk, shield +10 absorb', attackSpeedMult: 0.85, special: { shieldAbsorbBonus: 10 } },
      D: { name: 'Mountain Shaman', desc: '+20% HP, shield +2 targets', hpMult: 1.2, special: { shieldTargetBonus: 2 } },
      E: { name: 'Geode Shaman', desc: '+15% dmg, shield +15 absorb', damageMult: 1.15, special: { shieldAbsorbBonus: 15 } },
      F: { name: 'Diamond Shaman', desc: 'Very fast, shield +20 absorb', attackSpeedMult: 0.7, special: { shieldAbsorbBonus: 20 } },
      G: { name: 'Quake Shaman', desc: '+25% dmg, +25% range', damageMult: 1.25, rangeMult: 1.25 },
    },
    [BuildingType.Tower]: {
      B: { name: 'Reinforced Pillar', desc: '+50% HP, shield +1 range', hpMult: 1.5, special: { towerRangeBonus: 1 } },
      C: { name: 'Crystal Pillar', desc: '+20% dmg, shield +10 absorb', damageMult: 1.2, special: { shieldAbsorbBonus: 10 } },
      D: { name: 'Mountain Pillar', desc: '+100% HP, shield +2 range', hpMult: 2.0, special: { towerRangeBonus: 2 } },
      E: { name: 'Fortress Pillar', desc: '+30% dmg, shield +15 absorb', damageMult: 1.3, special: { shieldAbsorbBonus: 15 } },
      F: { name: 'Diamond Pillar', desc: 'Shield +20 absorb, faster cycle', special: { shieldAbsorbBonus: 20, towerShieldIntervalMult: 0.7 } },
      G: { name: 'Obelisk', desc: '+40% dmg, +range, slow enemies', damageMult: 1.4, special: { towerRangeBonus: 2, extraSlowStacks: 1 } },
    },
  },
  // ============ SHADE (Shadow) — Poison & Lifesteal ============
  [Race.Shade]: {
    [BuildingType.MeleeSpawner]: {
      B: { name: 'Shadow Blade', desc: '+20% HP, +15% dmg', hpMult: 1.2, damageMult: 1.15 },
      C: { name: 'Ghost Step', desc: '+20% speed, 20% dodge', moveSpeedMult: 1.2, special: { dodgeChance: 0.2 } },
      D: { name: 'Void Reaper', desc: '+30% dmg, +1 burn', damageMult: 1.3, special: { extraBurnStacks: 1 } },
      E: { name: 'Soul Eater', desc: '+25% HP/dmg, regen 2/s', hpMult: 1.25, damageMult: 1.25, special: { regenPerSec: 2 } },
      F: { name: 'Wraith', desc: '+30% speed, 30% dodge', moveSpeedMult: 1.3, special: { dodgeChance: 0.3 } },
      G: { name: 'Nightblade', desc: '+35% dmg, faster atk', damageMult: 1.35, attackSpeedMult: 0.85 },
    },
    [BuildingType.RangedSpawner]: {
      B: { name: 'Venom Shot', desc: '+20% dmg, +1 burn', damageMult: 1.2, special: { extraBurnStacks: 1 } },
      C: { name: 'Shadow Arrow', desc: 'Faster atk, +15% range', attackSpeedMult: 0.85, rangeMult: 1.15 },
      D: { name: 'Plague Arrow', desc: '+25% dmg, +2 burn', damageMult: 1.25, special: { extraBurnStacks: 2 } },
      E: { name: 'Hex Volley', desc: 'Fires 2 projectiles', special: { multishotCount: 1, multishotDamagePct: 0.6 } },
      F: { name: 'Ghost Archer', desc: '+25% speed, 15% dodge', moveSpeedMult: 1.25, special: { dodgeChance: 0.15 } },
      G: { name: 'Blight Bow', desc: '+30% dmg, +range', damageMult: 1.3, rangeMult: 1.2 },
    },
    [BuildingType.CasterSpawner]: {
      B: { name: 'Plague Mage', desc: '+15% HP, +3 heal', hpMult: 1.15, special: { healBonus: 3 } },
      C: { name: 'Drain Mage', desc: 'Faster atk, +15% range', attackSpeedMult: 0.85, rangeMult: 1.15 },
      D: { name: 'Pestilence Mage', desc: '+20% dmg, +5 heal', damageMult: 1.2, special: { healBonus: 5, extraBurnStacks: 1 } },
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
  // ============ THORN (Nature) — Regen & Swarm ============
  [Race.Thorn]: {
    [BuildingType.MeleeSpawner]: {
      B: { name: 'Ironbark', desc: '+35% HP, +10% dmg', hpMult: 1.35, damageMult: 1.1 },
      C: { name: 'Thornhide', desc: '+20% HP, regen 2/s', hpMult: 1.2, special: { regenPerSec: 2 } },
      D: { name: 'Ancient Oak', desc: '+50% HP, 15% dmg reduction', hpMult: 1.5, special: { damageReductionPct: 0.15 } },
      E: { name: 'Barkbreaker', desc: '+30% dmg, knockback', damageMult: 1.3, special: { knockbackEveryN: 2 } },
      F: { name: 'Mossheart', desc: '+30% HP, regen 3/s', hpMult: 1.3, special: { regenPerSec: 3 } },
      G: { name: 'Wildroot', desc: '+20% dmg/speed, +1 slow', damageMult: 1.2, moveSpeedMult: 1.15, special: { extraSlowStacks: 1 } },
    },
    [BuildingType.RangedSpawner]: {
      B: { name: 'Spore Cloud', desc: '+20% HP, +20% dmg', hpMult: 1.2, damageMult: 1.2 },
      C: { name: 'Rapid Spore', desc: 'Faster atk, +1 slow', attackSpeedMult: 0.85, special: { extraSlowStacks: 1 } },
      D: { name: 'Blight Spore', desc: '+25% dmg, splash 2t', damageMult: 1.25, special: { splashRadius: 2, splashDamagePct: 0.4 } },
      E: { name: 'Toxic Spore', desc: '+20% dmg, +1 burn', damageMult: 1.2, special: { extraBurnStacks: 1 } },
      F: { name: 'Swift Spore', desc: 'Much faster, +range', attackSpeedMult: 0.75, rangeMult: 1.15 },
      G: { name: 'Fungal Blast', desc: '+25% dmg, splash 2.5t', damageMult: 1.25, special: { splashRadius: 2.5, splashDamagePct: 0.35 } },
    },
    [BuildingType.CasterSpawner]: {
      B: { name: 'Deep Root', desc: '+20% HP, +3 heal', hpMult: 1.2, special: { healBonus: 3 } },
      C: { name: 'Vine Weaver', desc: 'Faster atk, +2 slow', attackSpeedMult: 0.85, special: { extraSlowStacks: 2 } },
      D: { name: 'Ancient Root', desc: '+15% dmg, +5 heal', damageMult: 1.15, special: { healBonus: 5, extraSlowStacks: 1 } },
      E: { name: 'Bloom Shaper', desc: '+20% dmg, +1 AoE', damageMult: 1.2, special: { aoeRadiusBonus: 1 } },
      F: { name: 'Grove Keeper', desc: 'Very fast, +4 heal', attackSpeedMult: 0.7, special: { healBonus: 4 } },
      G: { name: 'World Tree', desc: '+30% dmg, +25% range', damageMult: 1.3, rangeMult: 1.25 },
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
