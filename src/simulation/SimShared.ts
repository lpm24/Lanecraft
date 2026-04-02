/**
 * Shared simulation utilities, constants, and module-level state.
 *
 * Contains:
 *   - Common helpers: genId, canAffordCost, deductCost, addSound, addFloatingText, etc.
 *   - SpatialGrid class and shared grid instances (_combatGrid, _collisionGrid)
 *   - Per-tick lookup caches (_unitById, _attackerCount, reusable sort buffers)
 *   - Game constants: PASSIVE_INCOME, INITIAL_RESOURCES, projectile visuals
 *   - Upgrade helpers: getUnitUpgradeMultipliers, getResearchMultipliers
 *   - Diamond generation: generateDiamondCells, isDiamondExposed
 *   - Sound throttle counters (reset each tick via resetSoundThrottles)
 */
import {
  GameState, Race, MapDef, GoldCell, BuildingType,
  HarvesterAssignment, UnitState,
  StatusType, SoundEvent, CombatEvent,
  DIAMOND_CENTER_X, DIAMOND_CENTER_Y, DIAMOND_HALF_W, DIAMOND_HALF_H,
  GOLD_PER_CELL, TICK_RATE,
  type ProjectileVisual,
} from './types';
import {
  UPGRADE_TREES, RACE_UPGRADE_COSTS,
  getRaceResourceRatio, getNodeUpgradeCost, WOOD_YIELD_PER_TRIP,
} from './data';

export function genId(state: GameState): number { return state.nextEntityId++; }
export const SELL_COOLDOWN_TICKS = 5 * TICK_RATE;
export const MATCH_TIMEOUT_TICKS = 30 * 60 * TICK_RATE; // 30 minute match timeout
export const WOOD_CARRY_PER_TRIP = WOOD_YIELD_PER_TRIP;
export const WOOD_PICKUP_RADIUS = 2.35;
export const WOOD_PILE_SPREAD_RADIUS = 2.0;

// Building visibility cache — only rebuilt when building count changes
export let _buildingVisCache: boolean[][] | null = null;
export let _buildingVisCacheCount = -1;
export let _buildingVisCacheTeams = -1;

// Diamond champion: spawned when diamond is delivered to HQ
export const DIAMOND_RESPAWN_TICKS = 60 * TICK_RATE; // 60 seconds before diamond reappears
export const CHAMPION_BASE_HP = 500;
export const CHAMPION_BASE_DAMAGE = 25;
export const CHAMPION_MOVE_SPEED = 4.0;
export const CHAMPION_ATTACK_SPEED = 0.8;
export const CHAMPION_RANGE = 1.5;
export const CHAMPION_SCALE_PER_DELIVERY = 0.15; // each subsequent delivery makes champion 15% stronger

// Passive income per second per race: +1 of primary resource, +0.1 of secondary
export const PASSIVE_INCOME: Record<Race, { gold: number; wood: number; meat: number }> = {
  [Race.Crown]:    { gold: 2,   wood: 0.5, meat: 0 },    // gold primary, wood secondary
  [Race.Horde]:    { gold: 1,   wood: 0.5, meat: 0.5 },  // all 3 resources, gold-leaning
  [Race.Goblins]:  { gold: 2,   wood: 0.5, meat: 0 },    // gold primary, wood secondary
  [Race.Oozlings]: { gold: 2,   wood: 0,   meat: 0.5 },  // gold primary, meat secondary
  [Race.Demon]:    { gold: 0,   wood: 0.75, meat: 1.5 },  // meat primary, wood secondary
  [Race.Deep]:     { gold: 1,   wood: 1,   meat: 0 },    // wood primary, gold secondary
  [Race.Wild]:     { gold: 0,   wood: 1.5, meat: 0.75 }, // wood primary, meat secondary
  [Race.Geists]:   { gold: 1.5, wood: 0,   meat: 1.5 },  // meat primary, gold secondary
  [Race.Tenders]:  { gold: 1,   wood: 1,   meat: 0 },    // wood primary, gold secondary (Growth Pod huts cycle gold→wood→meat)
};

export const INITIAL_RESOURCES: Record<Race, { gold: number; wood: number; meat: number }> = {
  [Race.Crown]:    { gold: 200, wood: 25,  meat: 0 },
  [Race.Horde]:    { gold: 100, wood: 50,  meat: 50 },  // spread across all 3
  [Race.Goblins]:  { gold: 200, wood: 25,  meat: 0 },
  [Race.Oozlings]: { gold: 200, wood: 0,   meat: 25 },
  [Race.Demon]:    { gold: 0,   wood: 50,  meat: 100 },
  [Race.Deep]:     { gold: 50,  wood: 150, meat: 0 },
  [Race.Wild]:     { gold: 0,   wood: 150, meat: 50 },
  [Race.Geists]:   { gold: 50,  wood: 0,   meat: 150 },
  [Race.Tenders]:  { gold: 50,  wood: 150, meat: 0 },
};

/** Projectile visual per race for ranged units. */
// Per-unit projectile visual lookup: (race, category, upgradeNode) → visual + optional spriteKey
export type ProjVis = { visual: ProjectileVisual; spriteKey?: string };
const S = (key: string): ProjVis => ({ visual: 'sprite', spriteKey: key });

const UNIT_PROJECTILE: Record<string, ProjVis> = {
  // --- Crown ranged ---
  [`${Race.Crown}:ranged:A`]: { visual: 'arrow' },
  [`${Race.Crown}:ranged:B`]: { visual: 'arrow' },
  [`${Race.Crown}:ranged:C`]: S('stone_ball'),    // Dwarfette Scout
  [`${Race.Crown}:ranged:D`]: { visual: 'arrow' },
  [`${Race.Crown}:ranged:E`]: { visual: 'arrow' },
  [`${Race.Crown}:ranged:F`]: S('stone_ball'),    // Dwarfette Blitzer
  [`${Race.Crown}:ranged:G`]: S('stone_ball'),    // Cannon (siege)
  // --- Crown caster ---
  [`${Race.Crown}:caster:A`]: S('holy_bolt'),     // Priest
  [`${Race.Crown}:caster:B`]: S('holy_bolt'),     // High Priest
  [`${Race.Crown}:caster:C`]: S('magic_missile'), // War Mage
  [`${Race.Crown}:caster:D`]: S('holy_bolt'),     // Arch Bishop
  [`${Race.Crown}:caster:E`]: S('holy_bolt'),     // War Cleric
  [`${Race.Crown}:caster:F`]: S('magic_missile'), // Battle Magus
  [`${Race.Crown}:caster:G`]: S('magic_missile'), // Archmage

  // --- Horde ranged ---
  [`${Race.Horde}:ranged:A`]: { visual: 'arrow' },
  [`${Race.Horde}:ranged:B`]: { visual: 'arrow' },
  [`${Race.Horde}:ranged:C`]: S('stone_ball'),    // Orc Catapult (siege)
  [`${Race.Horde}:ranged:D`]: { visual: 'arrow' },
  [`${Race.Horde}:ranged:E`]: { visual: 'arrow' },
  [`${Race.Horde}:ranged:F`]: S('stone_ball'),    // Horde Bombard (siege)
  [`${Race.Horde}:ranged:G`]: S('stone_ball'),    // Doom Catapult (siege)
  // --- Horde caster ---
  [`${Race.Horde}:caster:A`]: S('music_note'),
  [`${Race.Horde}:caster:B`]: S('music_note'),
  [`${Race.Horde}:caster:C`]: S('music_note'),
  [`${Race.Horde}:caster:D`]: S('music_note'),
  [`${Race.Horde}:caster:E`]: S('music_note'),
  [`${Race.Horde}:caster:F`]: S('music_note'),
  [`${Race.Horde}:caster:G`]: S('music_note'),

  // --- Goblins ranged ---
  [`${Race.Goblins}:ranged:A`]: S('dagger'),
  [`${Race.Goblins}:ranged:B`]: S('poison_arrow'),  // Venom Knifer
  [`${Race.Goblins}:ranged:C`]: S('dagger'),         // War Boar
  [`${Race.Goblins}:ranged:D`]: S('poison_arrow'),  // Plague Knifer
  [`${Race.Goblins}:ranged:E`]: S('dagger'),         // Fan Knifer
  [`${Race.Goblins}:ranged:F`]: S('dagger'),         // King Boar
  [`${Race.Goblins}:ranged:G`]: S('stone_ball'),    // Goblin Mortar (siege)
  // Goblins caster: keep existing green meteorite

  // --- Oozlings ranged ---
  [`${Race.Oozlings}:ranged:A`]: S('slime_missile'),
  [`${Race.Oozlings}:ranged:B`]: S('slime_missile'),
  [`${Race.Oozlings}:ranged:C`]: S('slime_missile'),
  [`${Race.Oozlings}:ranged:D`]: S('acid_spit'),      // Acid Spitter
  [`${Race.Oozlings}:ranged:E`]: S('acid_spit'),      // Burst Spitter
  [`${Race.Oozlings}:ranged:F`]: S('slime_missile'),
  [`${Race.Oozlings}:ranged:G`]: S('slime_missile'), // Glob Siege
  // Oozlings caster: keep existing purple orb/circle

  // --- Demon ranged ---
  [`${Race.Demon}:ranged:A`]: S('fire_bolt'),
  [`${Race.Demon}:ranged:B`]: S('fire_bolt'),
  [`${Race.Demon}:ranged:C`]: S('fire_bolt'),
  [`${Race.Demon}:ranged:D`]: S('fire_bolt'),
  [`${Race.Demon}:ranged:E`]: S('fire_bolt'),
  [`${Race.Demon}:ranged:F`]: S('fire_bolt'),
  [`${Race.Demon}:ranged:G`]: S('stone_ball'),      // Brimstone Cannon (siege)
  // Demon caster: keep existing orange meteorite

  // --- Deep ranged ---
  [`${Race.Deep}:ranged:A`]: S('harpoon'),
  [`${Race.Deep}:ranged:B`]: S('harpoon'),           // Reef Shark
  [`${Race.Deep}:ranged:C`]: S('water_bolt'),        // Spray Crab
  [`${Race.Deep}:ranged:D`]: S('harpoon'),           // Hammerhead
  [`${Race.Deep}:ranged:E`]: S('ice_arrow'),          // Great White (slow3)
  [`${Race.Deep}:ranged:F`]: S('stone_ball'),        // Depth Charge (siege)
  [`${Race.Deep}:ranged:G`]: S('water_bolt'),        // King Crab
  // --- Deep caster ---
  [`${Race.Deep}:caster:A`]: S('water_bolt'),
  [`${Race.Deep}:caster:B`]: S('water_bolt'),
  [`${Race.Deep}:caster:C`]: S('water_bolt'),
  [`${Race.Deep}:caster:D`]: S('water_bolt'),
  [`${Race.Deep}:caster:E`]: S('water_bolt'),
  [`${Race.Deep}:caster:F`]: S('water_bolt'),
  [`${Race.Deep}:caster:G`]: S('water_bolt'),

  // --- Wild ranged ---
  [`${Race.Wild}:ranged:A`]: { visual: 'bone' },
  [`${Race.Wild}:ranged:B`]: { visual: 'bone' },     // Chameleon
  [`${Race.Wild}:ranged:C`]: S('poison_arrow'),      // Spitting Snake
  [`${Race.Wild}:ranged:D`]: { visual: 'bone' },     // Stalker
  [`${Race.Wild}:ranged:E`]: S('stone_ball'),        // Catapult Beast (siege)
  [`${Race.Wild}:ranged:F`]: S('poison_arrow'),      // Venom Serpent
  [`${Race.Wild}:ranged:G`]: S('poison_arrow'),      // Hydra Spit
  // --- Wild caster ---
  [`${Race.Wild}:caster:A`]: S('nature_bolt'),
  [`${Race.Wild}:caster:B`]: S('nature_bolt'),
  [`${Race.Wild}:caster:C`]: S('nature_bolt'),
  [`${Race.Wild}:caster:D`]: S('nature_bolt'),
  [`${Race.Wild}:caster:E`]: S('nature_bolt'),
  [`${Race.Wild}:caster:F`]: S('nature_bolt'),
  [`${Race.Wild}:caster:G`]: S('nature_bolt'),

  // --- Geists ranged ---
  [`${Race.Geists}:ranged:A`]: S('shadow_arrow'),     // Wraith Bow
  [`${Race.Geists}:ranged:B`]: S('shadow_arrow'),     // Venom Wraith
  [`${Race.Geists}:ranged:C`]: { visual: 'bone' },   // Bone Skull
  [`${Race.Geists}:ranged:D`]: S('shadow_arrow'),     // Plague Arrow
  [`${Race.Geists}:ranged:E`]: S('shadow_arrow'),     // Hex Volley
  [`${Race.Geists}:ranged:F`]: { visual: 'bone' },   // Wailing Skull
  [`${Race.Geists}:ranged:G`]: S('stone_ball'),      // Bone Ballista (siege)
  // --- Geists caster ---
  [`${Race.Geists}:caster:A`]: S('shadow_bolt'),
  [`${Race.Geists}:caster:B`]: S('shadow_bolt'),
  [`${Race.Geists}:caster:C`]: S('shadow_bolt'),
  [`${Race.Geists}:caster:D`]: S('shadow_bolt'),
  [`${Race.Geists}:caster:E`]: S('shadow_bolt'),
  [`${Race.Geists}:caster:F`]: S('shadow_bolt'),
  [`${Race.Geists}:caster:G`]: S('shadow_bolt'),

  // --- Tenders ranged ---
  [`${Race.Tenders}:ranged:A`]: S('arrow'),
  [`${Race.Tenders}:ranged:B`]: S('arrow'),
  [`${Race.Tenders}:ranged:C`]: S('nature_bolt'),    // Thorn Thrower
  [`${Race.Tenders}:ranged:D`]: S('poison_arrow'),   // Blight Tinker
  [`${Race.Tenders}:ranged:E`]: S('nature_bolt'),    // Grand Tinker
  [`${Race.Tenders}:ranged:F`]: S('poison_arrow'),   // Toxic Hurler
  [`${Race.Tenders}:ranged:G`]: S('stone_ball'),     // Vine Siege
  // --- Tenders caster ---
  [`${Race.Tenders}:caster:A`]: S('nature_bolt'),
  [`${Race.Tenders}:caster:B`]: S('nature_bolt'),
  [`${Race.Tenders}:caster:C`]: S('nature_bolt'),
  [`${Race.Tenders}:caster:D`]: S('nature_bolt'),
  [`${Race.Tenders}:caster:E`]: S('nature_bolt'),
  [`${Race.Tenders}:caster:F`]: S('nature_bolt'),
  [`${Race.Tenders}:caster:G`]: S('nature_bolt'),
};

// Fallback visuals for races without per-node entries
const DEFAULT_RANGED_VISUAL: Record<Race, ProjVis> = {
  [Race.Crown]:    { visual: 'arrow' },
  [Race.Horde]:    { visual: 'arrow' },
  [Race.Goblins]:  S('dagger'),
  [Race.Oozlings]: S('slime_missile'),
  [Race.Demon]:    S('fire_bolt'),
  [Race.Deep]:     S('harpoon'),
  [Race.Wild]:     { visual: 'bone' },
  [Race.Geists]:   S('shadow_arrow'),
  [Race.Tenders]:  S('arrow'),
};

/** Get the projectile visual for a specific unit. Returns visual + optional spriteKey. */
export function getProjectileVisual(race: Race, category: string, upgradeNode: string): ProjVis {
  const key = `${race}:${category}:${upgradeNode}`;
  return UNIT_PROJECTILE[key] ?? DEFAULT_RANGED_VISUAL[race] ?? { visual: 'arrow' };
}

/** Check if a player can afford a cost (gold/wood/meat + optional special resources). */
export function canAffordCost(player: { gold: number; wood: number; meat: number; mana: number; deathEssence: number; souls: number },
  cost: { gold: number; wood: number; meat: number; mana?: number; deathEssence?: number; souls?: number }): boolean {
  if (player.gold < cost.gold || player.wood < cost.wood || player.meat < cost.meat) return false;
  if (cost.mana !== undefined && player.mana < cost.mana) return false;
  if ((cost.deathEssence ?? 0) > 0 && player.deathEssence < (cost.deathEssence ?? 0)) return false;
  if ((cost.souls ?? 0) > 0 && player.souls < (cost.souls ?? 0)) return false;
  return true;
}

/** Deduct a cost from a player's resources. Caller must check canAffordCost first. */
export function deductCost(player: { gold: number; wood: number; meat: number; mana: number; deathEssence: number; souls: number },
  cost: { gold: number; wood: number; meat: number; mana?: number; deathEssence?: number; souls?: number }): void {
  player.gold -= cost.gold;
  player.wood -= cost.wood;
  player.meat -= cost.meat;
  if (cost.mana !== undefined) player.mana -= cost.mana;
  if (cost.deathEssence !== undefined) player.deathEssence -= cost.deathEssence;
  if (cost.souls !== undefined) player.souls -= cost.souls;
}

/** Return the smartest harvester assignment for a new hut based on the race's
 *  spending profile and existing harvester distribution. */
export function getSmartHarvesterAssignment(race: Race, state: GameState, playerId: number): HarvesterAssignment {
  const ratio = getRaceResourceRatio(race);
  // Build list of assignable resources (exclude zero-ratio ones)
  type Res = { assignment: HarvesterAssignment; ratio: number };
  const candidates: Res[] = [];
  if (ratio.gold > 0) candidates.push({ assignment: HarvesterAssignment.BaseGold, ratio: ratio.gold });
  if (ratio.wood > 0) candidates.push({ assignment: HarvesterAssignment.Wood, ratio: ratio.wood });
  if (ratio.meat > 0) candidates.push({ assignment: HarvesterAssignment.Meat, ratio: ratio.meat });
  if (candidates.length <= 1) return candidates[0]?.assignment ?? HarvesterAssignment.BaseGold;

  // Count existing harvesters per resource (exclude mana, center, dead)
  const counts = new Map<HarvesterAssignment, number>();
  for (const c of candidates) counts.set(c.assignment, 0);
  for (const h of state.harvesters) {
    if (h.playerId !== playerId) continue;
    if (counts.has(h.assignment)) counts.set(h.assignment, (counts.get(h.assignment) ?? 0) + 1);
  }
  const totalHarvesters = Array.from(counts.values()).reduce((a, b) => a + b, 0) + 1; // +1 for the one being placed

  // Pick the resource that is most under-represented relative to its ideal ratio
  let bestAssignment = candidates[0].assignment;
  let bestDeficit = -Infinity;
  for (const c of candidates) {
    const currentCount = counts.get(c.assignment) ?? 0;
    const idealCount = c.ratio * totalHarvesters;
    const deficit = idealCount - currentCount; // higher = more under-served
    if (deficit > bestDeficit) {
      bestDeficit = deficit;
      bestAssignment = c.assignment;
    }
  }
  return bestAssignment;
}

export type UpgradeChoice = 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

export function isValidUpgradeChoice(path: string[], choice: string): choice is UpgradeChoice {
  if (path.length === 1) return choice === 'B' || choice === 'C';
  if (path.length !== 2) return false;
  if (path[1] === 'B') return choice === 'D' || choice === 'E';
  if (path[1] === 'C') return choice === 'F' || choice === 'G';
  return false;
}

export function getUpgradeCost(path: string[], race: Race, buildingType?: BuildingType, choice?: string): { gold: number; wood: number; meat: number; deathEssence?: number; souls?: number } | null {
  if (path.length === 1 || path.length === 2) {
    if (buildingType != null) return getNodeUpgradeCost(race, buildingType, path.length, choice);
    const costs = RACE_UPGRADE_COSTS[race];
    return path.length === 1 ? costs.tier1 : costs.tier2;
  }
  return null;
}

export interface UpgradeResult {
  hp: number; damage: number; attackSpeed: number; moveSpeed: number; range: number;
  spawnSpeed: number;  // <1 = faster spawns
  special: import('./data').UpgradeSpecial;
}

export function getUnitUpgradeMultipliers(path: string[], race?: Race, buildingType?: BuildingType): UpgradeResult {
  let hp = 1, damage = 1, attackSpeed = 1, moveSpeed = 1, range = 1, spawnSpeed = 1;
  const special: import('./data').UpgradeSpecial = {};

  const tree = race && buildingType ? UPGRADE_TREES[race]?.[buildingType] : undefined;

  for (const node of path) {
    if (node === 'A') continue;
    const def = tree?.[node as keyof typeof tree];
    if (def) {
      if (def.hpMult) hp *= def.hpMult;
      if (def.damageMult) damage *= def.damageMult;
      if (def.attackSpeedMult) attackSpeed *= def.attackSpeedMult;
      if (def.moveSpeedMult) moveSpeed *= def.moveSpeedMult;
      if (def.rangeMult) range *= def.rangeMult;
      if (def.spawnSpeedMult) spawnSpeed *= def.spawnSpeedMult;
      if (def.special) {
        // Merge specials (later nodes override/stack)
        Object.assign(special, def.special);
      }
    } else {
      // Fallback: generic multipliers for missing tree data
      switch (node) {
        case 'B': hp *= 1.2; damage *= 1.1; break;
        case 'C': moveSpeed *= 1.15; attackSpeed *= 0.9; break;
        case 'D': hp *= 1.35; damage *= 1.2; break;
        case 'E': damage *= 1.35; attackSpeed *= 0.9; break;
        case 'F': moveSpeed *= 1.3; attackSpeed *= 0.85; break;
        case 'G': damage *= 1.15; range *= 1.15; break;
      }
    }
  }
  return { hp, damage, attackSpeed, moveSpeed, range, spawnSpeed, special };
}

export function addSound(state: GameState, type: SoundEvent['type'], x?: number, y?: number, extra?: Partial<SoundEvent>): void {
  state.soundEvents.push({ type, x, y, ...extra });
}

// === Generate diamond-shaped gold cell grid ===

export function generateDiamondCells(mapDef?: MapDef): GoldCell[] {
  const cells: GoldCell[] = [];
  const cx = mapDef?.diamondCenter.x ?? DIAMOND_CENTER_X;
  const cy = mapDef?.diamondCenter.y ?? DIAMOND_CENTER_Y;
  const hw = mapDef?.diamondHalfW ?? DIAMOND_HALF_W;
  const hh = mapDef?.diamondHalfH ?? DIAMOND_HALF_H;

  for (let dy = -hh; dy <= hh; dy++) {
    const rowWidth = Math.round(hw * (1 - Math.abs(dy) / hh));
    for (let dx = -rowWidth; dx <= rowWidth; dx++) {
      const tx = cx + dx;
      const ty = cy + dy;
      if (dx === 0 && dy === 0) continue;
      cells.push({
        tileX: tx,
        tileY: ty,
        gold: GOLD_PER_CELL,
        maxGold: GOLD_PER_CELL,
      });
    }
  }
  return cells;
}

export function isDiamondExposed(cellMap: Map<number, GoldCell>, state: GameState): boolean {
  const cx = state.diamond.x, cy = state.diamond.y;
  const neighbors = [
    { x: cx - 1, y: cy },
    { x: cx + 1, y: cy },
    { x: cx, y: cy - 1 },
    { x: cx, y: cy + 1 },
  ];
  for (const n of neighbors) {
    const cell = cellMap.get(n.x * 10000 + n.y);
    if (!cell || cell.gold <= 0) {
      if (hasPathToEdge(cellMap, n.x, n.y, state)) return true;
    }
  }
  return false;
}

export function hasPathToEdge(cellMap: Map<number, GoldCell>, sx: number, sy: number, state: GameState): boolean {
  const cx = state.diamond.x, cy = state.diamond.y;
  const hw = state.mapDef.diamondHalfW, hh = state.mapDef.diamondHalfH;
  const visited = new Set<number>();
  const queue: { x: number; y: number }[] = [{ x: sx, y: sy }];
  visited.add(sx * 10000 + sy);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const dx = Math.abs(cur.x - cx);
    const dy = Math.abs(cur.y - cy);
    if (dx > hw || dy > hh) return true;

    for (const [nx, ny] of [[cur.x-1,cur.y],[cur.x+1,cur.y],[cur.x,cur.y-1],[cur.x,cur.y+1]]) {
      const key = nx * 10000 + ny;
      if (visited.has(key)) continue;
      visited.add(key);
      const cell = cellMap.get(key);
      if (!cell || cell.gold <= 0) {
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return false;
}

// === Spatial grid for O(1) nearby-unit lookups in combat ===

export class SpatialGrid {
  private cellSize: number;
  private stride: number;   // row stride for hash key — must exceed max column count
  private cells = new Map<number, UnitState[]>();
  private bucketPool: UnitState[][] = [];
  private activeBuckets: UnitState[][] = [];

  constructor(cellSize: number, maxWorldDimension = 200) {
    this.cellSize = cellSize;
    this.stride = Math.ceil(maxWorldDimension / cellSize) + 2;
  }

  build(units: UnitState[]): void {
    // Return active buckets to pool (clear but reuse arrays)
    for (const b of this.activeBuckets) { b.length = 0; this.bucketPool.push(b); }
    this.activeBuckets.length = 0;
    this.cells.clear();
    const s = this.stride;
    for (const u of units) {
      if (u.hp <= 0) continue;
      const key = Math.floor(u.x / this.cellSize) * s + Math.floor(u.y / this.cellSize);
      const bucket = this.cells.get(key);
      if (bucket) { bucket.push(u); }
      else {
        const b = this.bucketPool.pop() ?? [];
        b.push(u);
        this.cells.set(key, b);
        this.activeBuckets.push(b);
      }
    }
  }

  private _result: UnitState[] = [];

  /** Returns a reusable array — contents are only valid until the next getNearby call. */
  getNearby(x: number, y: number, radius: number): UnitState[] {
    const cs = this.cellSize;
    const s = this.stride;
    const minCX = Math.floor((x - radius) / cs);
    const maxCX = Math.floor((x + radius) / cs);
    const minCY = Math.floor((y - radius) / cs);
    const maxCY = Math.floor((y + radius) / cs);
    this._result.length = 0;
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const bucket = this.cells.get(cx * s + cy);
        if (bucket) {
          for (const u of bucket) this._result.push(u);
        }
      }
    }
    return this._result;
  }
}

export const _combatGrid = new SpatialGrid(8);
export const _collisionGrid = new SpatialGrid(2); // finer grid for unit-vs-unit collision pushout

// Module-level reusable structures (avoid per-tick allocations)
export const _unitById = new Map<number, UnitState>();
export const _attackerCount = new Map<number, number>();
export const _combatOrder: UnitState[] = [];
export const _spawnOrder: GameState['buildings'] = [];
export const _moveOrder: UnitState[] = [];
export const _projectileRemoveSet = new Set<number>();
export const _buildingIdSet = new Set<number>();
// Cached alley buildings per team — rebuilt once per tick for unit movement stop check
export const _alleyBuildingsBottom: Array<{ x: number; y: number }> = [];
export const _alleyBuildingsTop: Array<{ x: number; y: number }> = [];

// Diamond cell map — rebuilt once per tick in simulateTick, integer keys for hot-path collision lookups
export let _diamondCellMapInt = new Map<number, GoldCell>();

/** In-place compact: remove elements where predicate returns false, preserving order. No allocation. */
export function compactInPlace<T>(arr: T[], keep: (item: T) => boolean): void {
  let write = 0;
  for (let read = 0; read < arr.length; read++) {
    if (keep(arr[read])) {
      if (write !== read) arr[write] = arr[read];
      write++;
    }
  }
  arr.length = write;
}

/** Check if a unit has a specific status effect — no closure allocation unlike .some(). */
export function hasStatus(effects: { type: StatusType }[], type: StatusType): boolean {
  for (let i = 0; i < effects.length; i++) if (effects[i].type === type) return true;
  return false;
}

// === Visual effect helpers ===

export function addFloatingText(state: GameState, x: number, y: number, text: string, color: string, icon?: string, big?: boolean,
  opts?: { ftType?: 'damage' | 'heal' | 'resource' | 'status' | 'ability'; magnitude?: number; miniIcon?: string; ownerOnly?: number }
): void {
  const rng1 = state.rng();
  const isDmg = opts?.ftType === 'damage';
  // Damage texts arc to left or right; others use small random spread
  let vx: number | undefined;
  let vy: number | undefined;
  let xOff: number;
  if (isDmg) {
    const rng2 = state.rng(); // consume 2nd rng for damage velocity spread
    vx = (rng1 < 0.5 ? -1 : 1) * (0.04 + rng2 * 0.04);
    vy = -0.12;
    xOff = 0;
  } else {
    xOff = (rng1 - 0.5) * 1.2;
  }
  state.floatingTexts.push({
    x, y, text, color, icon, age: 0, maxAge: TICK_RATE * 1.5, xOff, big,
    vx, vy,
    ftType: opts?.ftType,
    magnitude: opts?.magnitude,
    miniIcon: opts?.miniIcon,
    ownerOnly: opts?.ownerOnly,
  });
}

export function addDeathParticles(state: GameState, x: number, y: number, color: string, count: number): void {
  for (let i = 0; i < count; i++) {
    const angle = state.rng() * Math.PI * 2;
    const speed = 0.5 + state.rng() * 2;
    state.particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      age: 0,
      maxAge: TICK_RATE * (0.5 + state.rng() * 0.8),
      size: 1 + state.rng() * 2,
    });
  }
}

export function addCombatEvent(state: GameState, evt: CombatEvent): void {
  state.combatEvents.push(evt);
}

/** Get research attack/defense multipliers for a player's unit category */
export function getResearchMultipliers(player: { researchUpgrades: import('./types').ResearchUpgradeState }, category: 'melee' | 'ranged' | 'caster'): { damageMult: number; damageReduction: number } {
  const bu = player.researchUpgrades;
  let atkLevel = 0, defLevel = 0;
  if (category === 'melee') { atkLevel = bu.meleeAtkLevel; defLevel = bu.meleeDefLevel; }
  else if (category === 'ranged') { atkLevel = bu.rangedAtkLevel; defLevel = bu.rangedDefLevel; }
  else { atkLevel = bu.casterAtkLevel; defLevel = bu.casterDefLevel; }
  return {
    damageMult: Math.pow(1.25, atkLevel),
    damageReduction: 1 - 1 / (1 + 0.06 * defLevel),
  };
}

// Throttle counters for status effect sounds — reset each tick in simulateTick
export let statusBurnSounds = 0;
export let statusShieldSounds = 0;
export let statusHasteSounds = 0;
export let statusSlowSounds = 0;
export let statusFrenzySounds = 0;
export let resourceDeliverySounds = 0;

export let woundSounds = 0;
export let vulnerableSounds = 0;
export let stunSounds = 0;

// Setters for sound throttle counters (needed because `export let` bindings are read-only from importers)
export function resetSoundThrottles(): void {
  statusBurnSounds = 0;
  statusShieldSounds = 0;
  statusHasteSounds = 0;
  statusSlowSounds = 0;
  statusFrenzySounds = 0;
  resourceDeliverySounds = 0;
  woundSounds = 0;
  vulnerableSounds = 0;
  stunSounds = 0;
}

export function incStatusBurnSounds(): number { return ++statusBurnSounds; }
export function incStatusShieldSounds(): number { return ++statusShieldSounds; }
export function incStatusHasteSounds(): number { return ++statusHasteSounds; }
export function incStatusSlowSounds(): number { return ++statusSlowSounds; }
export function incStatusFrenzySounds(): number { return ++statusFrenzySounds; }
export function incResourceDeliverySounds(): number { return ++resourceDeliverySounds; }
export function incWoundSounds(): number { return ++woundSounds; }
export function incVulnerableSounds(): number { return ++vulnerableSounds; }
export function incStunSounds(): number { return ++stunSounds; }

// Setters for module-level mutable state that importers need to write
export function set_diamondCellMapInt(m: Map<number, GoldCell>): void { _diamondCellMapInt = m; }
export function set_buildingVisCache(v: boolean[][] | null): void { _buildingVisCache = v; }
export function set_buildingVisCacheCount(n: number): void { _buildingVisCacheCount = n; }
export function set_buildingVisCacheTeams(n: number): void { _buildingVisCacheTeams = n; }
