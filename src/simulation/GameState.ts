import {
  GameState, PlayerState, DiamondState, Team, Race, Lane, MapDef, createPlayerStats,
  MAP_WIDTH, MAP_HEIGHT, HQ_HP, HQ_WIDTH, HQ_HEIGHT, NUKE_RADIUS,
  BUILD_GRID_COLS, BUILD_GRID_ROWS, ZONES, TICK_RATE,
  DIAMOND_CENTER_X, DIAMOND_CENTER_Y, DIAMOND_HALF_W, DIAMOND_HALF_H,
  WOOD_NODE_X, STONE_NODE_X,
  GOLD_PER_CELL, GoldCell, CROSS_BASE_MARGIN, CROSS_BASE_WIDTH,
  getMarginAtRow,
  LANE_PATHS, Vec2,
  GameCommand, BuildingType, BuildingState, ResourceType,
  HarvesterAssignment, HarvesterState, UnitState, WarHero, WoodPileState, PotionType,
  StatusType, SoundEvent, CombatEvent, AbilityEffect, createSeededRng, createResearchUpgradeState,
  type ProjectileVisual,
} from './types';
import { DUEL_MAP } from './maps';
import {
  SPAWN_INTERVAL_TICKS, UNIT_STATS, TOWER_STATS,
  HARVESTER_MOVE_SPEED, MINE_TIME_BASE_TICKS, MINE_TIME_DIAMOND_TICKS,
  HARVESTER_RESPAWN_TICKS, HARVESTER_MIN_SEPARATION,
  UPGRADE_TREES, RACE_UPGRADE_COSTS, getBuildingCost,
  getRaceResourceRatio, getNodeUpgradeCost, getUpgradeNodeDef,
  HUT_COST_SCALE, TOWER_COST_SCALE, GOLD_YIELD_PER_TRIP, WOOD_YIELD_PER_TRIP, STONE_YIELD_PER_TRIP, DIAMOND_CELLS_PER_TRIP,
  RACE_ABILITY_DEFS,
  getAllResearchUpgrades, getResearchUpgradeCost,
} from './data';

function genId(state: GameState): number { return state.nextEntityId++; }
const SELL_COOLDOWN_TICKS = 5 * TICK_RATE;
const MATCH_TIMEOUT_TICKS = 30 * 60 * TICK_RATE; // 30 minute match timeout
const WOOD_CARRY_PER_TRIP = WOOD_YIELD_PER_TRIP;
const WOOD_PICKUP_RADIUS = 2.35;
const WOOD_PILE_SPREAD_RADIUS = 2.0;

// Building visibility cache — only rebuilt when building count changes
let _buildingVisCache: boolean[][] | null = null;
let _buildingVisCacheCount = -1;
let _buildingVisCacheTeams = -1;

// Diamond champion: spawned when diamond is delivered to HQ
const DIAMOND_RESPAWN_TICKS = 60 * TICK_RATE; // 60 seconds before diamond reappears
const CHAMPION_BASE_HP = 500;
const CHAMPION_BASE_DAMAGE = 25;
const CHAMPION_MOVE_SPEED = 4.0;
const CHAMPION_ATTACK_SPEED = 0.8;
const CHAMPION_RANGE = 1.5;
const CHAMPION_SCALE_PER_DELIVERY = 0.15; // each subsequent delivery makes champion 15% stronger

// Passive income per second per race: +1 of primary resource, +0.1 of secondary
export const PASSIVE_INCOME: Record<Race, { gold: number; wood: number; stone: number }> = {
  [Race.Crown]:    { gold: 2,   wood: 0.5, stone: 0 },    // gold primary, wood secondary
  [Race.Horde]:    { gold: 1,   wood: 0.5, stone: 0.5 },  // all 3 resources, gold-leaning
  [Race.Goblins]:  { gold: 2,   wood: 0.5, stone: 0 },    // gold primary, wood secondary
  [Race.Oozlings]: { gold: 2,   wood: 0,   stone: 0.5 },  // gold primary, stone secondary
  [Race.Demon]:    { gold: 0,   wood: 0.75, stone: 1.5 },  // stone primary, wood secondary
  [Race.Deep]:     { gold: 1,   wood: 1,   stone: 0 },    // wood primary, gold secondary
  [Race.Wild]:     { gold: 0,   wood: 1.5, stone: 0.75 }, // wood primary, stone secondary
  [Race.Geists]:   { gold: 1.5, wood: 0,   stone: 1.5 },  // stone primary, gold secondary
  [Race.Tenders]:  { gold: 1,   wood: 1,   stone: 0 },    // wood primary, gold secondary
};

const INITIAL_RESOURCES: Record<Race, { gold: number; wood: number; stone: number }> = {
  [Race.Crown]:    { gold: 200, wood: 25,  stone: 0 },
  [Race.Horde]:    { gold: 100, wood: 50,  stone: 50 },  // spread across all 3
  [Race.Goblins]:  { gold: 200, wood: 25,  stone: 0 },
  [Race.Oozlings]: { gold: 200, wood: 0,   stone: 25 },
  [Race.Demon]:    { gold: 0,   wood: 50,  stone: 100 },
  [Race.Deep]:     { gold: 50,  wood: 150, stone: 0 },
  [Race.Wild]:     { gold: 0,   wood: 150, stone: 50 },
  [Race.Geists]:   { gold: 50,  wood: 0,   stone: 150 },
  [Race.Tenders]:  { gold: 50,  wood: 150, stone: 0 },
};

/** Projectile visual per race for ranged units. */
const RANGED_VISUAL: Record<Race, ProjectileVisual> = {
  [Race.Crown]:    'arrow',  // Bowman
  [Race.Horde]:    'arrow',  // Bowcleaver
  [Race.Goblins]:  'arrow',  // Knifer (thrown blade)
  [Race.Oozlings]: 'orb',    // Spitter (acid spit)
  [Race.Demon]:    'orb',    // Eye Sniper (eye beam)
  [Race.Deep]:     'arrow',  // Harpooner (harpoon)
  [Race.Wild]:     'bone',   // Bonechucker
  [Race.Geists]:   'arrow',  // Wraith Bow
  [Race.Tenders]:  'arrow',  // Tinker
};

/** Check if a player can afford a cost (gold/wood/stone + optional special resources). */
function canAffordCost(player: { gold: number; wood: number; stone: number; mana: number; deathEssence: number; souls: number },
  cost: { gold: number; wood: number; stone: number; mana?: number; deathEssence?: number; souls?: number }): boolean {
  if (player.gold < cost.gold || player.wood < cost.wood || player.stone < cost.stone) return false;
  if (cost.mana !== undefined && player.mana < cost.mana) return false;
  if ((cost.deathEssence ?? 0) > 0 && player.deathEssence < (cost.deathEssence ?? 0)) return false;
  if ((cost.souls ?? 0) > 0 && player.souls < (cost.souls ?? 0)) return false;
  return true;
}

/** Deduct a cost from a player's resources. Caller must check canAffordCost first. */
function deductCost(player: { gold: number; wood: number; stone: number; mana: number; deathEssence: number; souls: number },
  cost: { gold: number; wood: number; stone: number; mana?: number; deathEssence?: number; souls?: number }): void {
  player.gold -= cost.gold;
  player.wood -= cost.wood;
  player.stone -= cost.stone;
  if (cost.mana !== undefined) player.mana -= cost.mana;
  if (cost.deathEssence !== undefined) player.deathEssence -= cost.deathEssence;
  if (cost.souls !== undefined) player.souls -= cost.souls;
}

/** Return the smartest harvester assignment for a new hut based on the race's
 *  spending profile and existing harvester distribution. */
function getSmartHarvesterAssignment(race: Race, state: GameState, playerId: number): HarvesterAssignment {
  const ratio = getRaceResourceRatio(race);
  // Build list of assignable resources (exclude zero-ratio ones)
  type Res = { assignment: HarvesterAssignment; ratio: number };
  const candidates: Res[] = [];
  if (ratio.gold > 0) candidates.push({ assignment: HarvesterAssignment.BaseGold, ratio: ratio.gold });
  if (ratio.wood > 0) candidates.push({ assignment: HarvesterAssignment.Wood, ratio: ratio.wood });
  if (ratio.stone > 0) candidates.push({ assignment: HarvesterAssignment.Stone, ratio: ratio.stone });
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

type UpgradeChoice = 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

function isValidUpgradeChoice(path: string[], choice: string): choice is UpgradeChoice {
  if (path.length === 1) return choice === 'B' || choice === 'C';
  if (path.length !== 2) return false;
  if (path[1] === 'B') return choice === 'D' || choice === 'E';
  if (path[1] === 'C') return choice === 'F' || choice === 'G';
  return false;
}

function getUpgradeCost(path: string[], race: Race, buildingType?: BuildingType, choice?: string): { gold: number; wood: number; stone: number; deathEssence?: number; souls?: number } | null {
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

function addSound(state: GameState, type: SoundEvent['type'], x?: number, y?: number): void {
  state.soundEvents.push({ type, x, y });
}

// === Generate diamond-shaped gold cell grid ===

function generateDiamondCells(mapDef?: MapDef): GoldCell[] {
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

function isDiamondExposed(cellMap: Map<number, GoldCell>, state: GameState): boolean {
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

function hasPathToEdge(cellMap: Map<number, GoldCell>, sx: number, sy: number, state: GameState): boolean {
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

class SpatialGrid {
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

const _combatGrid = new SpatialGrid(8);

// Module-level reusable structures (avoid per-tick allocations)
const _unitById = new Map<number, UnitState>();
const _attackerCount = new Map<number, number>();
const _combatOrder: UnitState[] = [];
const _spawnOrder: GameState['buildings'] = [];
const _moveOrder: UnitState[] = [];

// Diamond cell map — rebuilt once per tick in simulateTick, integer keys for hot-path collision lookups
let _diamondCellMapInt = new Map<number, GoldCell>();

// === Visual effect helpers ===

function addFloatingText(state: GameState, x: number, y: number, text: string, color: string, icon?: string, big?: boolean,
  opts?: { ftType?: 'damage' | 'heal' | 'resource' | 'status' | 'ability'; magnitude?: number; miniIcon?: string; ownerOnly?: number }
): void {
  const rng1 = state.rng();
  const isDmg = opts?.ftType === 'damage';
  // Damage texts arc to left or right; others use small random spread
  let vx: number | undefined;
  let vy: number | undefined;
  let xOff: number;
  if (isDmg) {
    const rng2 = state.rng(); // only consume 2nd rng for damage (preserves old sequence for non-damage)
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

function addDeathParticles(state: GameState, x: number, y: number, color: string, count: number): void {
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

function addCombatEvent(state: GameState, evt: CombatEvent): void {
  state.combatEvents.push(evt);
}

// === State Creation ===

export function createInitialState(
  players: { race: Race; isBot: boolean; isEmpty?: boolean }[],
  seed?: number,
  mapDef?: MapDef,
  fogOfWar = false,
): GameState {
  _debugPrevPositions.clear(); // prevent stale ID collisions from previous games
  _buildingVisCache = null; // reset building visibility cache for new game
  const map = mapDef ?? DUEL_MAP;
  const rngSeed = seed ?? (Date.now() ^ (Math.random() * 0xffffffff));
  const rng = createSeededRng(rngSeed);
  const playerStates: PlayerState[] = players.map((p, i) => ({
    id: i,
    team: (map.playerSlots[i]?.teamIndex ?? (i < 2 ? 0 : 1)) as Team,
    race: p.race,
    gold: p.isEmpty ? 0 : INITIAL_RESOURCES[p.race].gold,
    wood: p.isEmpty ? 0 : INITIAL_RESOURCES[p.race].wood,
    stone: p.isEmpty ? 0 : INITIAL_RESOURCES[p.race].stone,
    nukeAvailable: !p.isEmpty,
    connected: !p.isEmpty,
    isBot: p.isBot,
    isEmpty: !!p.isEmpty,
    hasBuiltTower: false,
    abilityCooldown: 0,
    abilityUseCount: 0,
    abilityStacks: 0,
    mana: 0,
    souls: 0,
    deathEssence: 0,
    researchUpgrades: createResearchUpgradeState(),
  }));

  const diamond: DiamondState = {
    x: map.diamondCenter.x,
    y: map.diamondCenter.y,
    exposed: false,
    state: 'hidden',
    carrierId: null,
    carrierType: null,
    mineProgress: 0,
    respawnTimer: 0,
    deliveries: 0,
  };

  const state: GameState = {
    tick: 0,
    rng,
    rngSeed,
    mapDef: map,
    players: playerStates,
    buildings: [],
    units: [],
    harvesters: [],
    woodPiles: [],
    potionDrops: [],
    projectiles: [],
    diamond,
    diamondCells: generateDiamondCells(map),
    hqHp: map.teams.map(() => HQ_HP),
    hqAttackTimer: map.teams.map(() => 0),
    winner: null,
    winCondition: null,
    matchPhase: 'prematch',
    prematchTimer: 10 * TICK_RATE,
    floatingTexts: [],
    particles: [],
    nukeEffects: [],
    nukeTelegraphs: [],
    nukeTeamCooldown: map.teams.map(() => 0),
    abilityEffects: [],
    pings: [],
    quickChats: [],
    soundEvents: [],
    combatEvents: [],
    nextEntityId: 1,
    playerStats: players.map(() => createPlayerStats()),
    warHeroes: [],
    supportHeroes: [],
    fallenHeroes: [],
    fogOfWar,
    visibility: map.teams.map(() => new Array(map.width * map.height).fill(false)),
  };

  // Give each player a free starter hut + harvester (skip empty slots)
  for (let i = 0; i < playerStates.length; i++) {
    const p = playerStates[i];
    if (p.isEmpty) continue;
    const origin = getHutGridOrigin(i, map, playerStates);
    const totalSlots = map.hutGridCols * map.hutGridRows;
    const centerSlot = Math.floor(totalSlots / 2);
    const slotGx = centerSlot % map.hutGridCols;
    const slotGy = Math.floor(centerSlot / map.hutGridCols);
    const world = { x: origin.x + slotGx, y: origin.y + slotGy };
    const hutHp = getBuildingCost(p.race, BuildingType.HarvesterHut).hp;
    const building: BuildingState = {
      id: genId(state), type: BuildingType.HarvesterHut, playerId: i, buildGrid: 'hut',
      gridX: centerSlot, gridY: 0, worldX: world.x, worldY: world.y,
      lane: Lane.Left, hp: hutHp, maxHp: hutHp, actionTimer: 0, placedTick: 0, upgradePath: [],
    };
    state.buildings.push(building);
    // Tenders: no harvester workers — huts passively generate resources
    if (p.race !== Race.Tenders) {
      const startAssignment = getSmartHarvesterAssignment(p.race, state, i);
      state.harvesters.push({
        id: genId(state), hutId: building.id, playerId: i, team: p.team,
        x: world.x, y: world.y, hp: 30, maxHp: 30, damage: 0,
        assignment: startAssignment,
        state: 'walking_to_node', miningTimer: 0, respawnTimer: 0,
        carryingDiamond: false, carryingResource: null, carryAmount: 0,
        queuedWoodAmount: 0, woodCarryTarget: 0, woodDropsCreated: 0,
        targetCellIdx: -1, diamondCellsMinedThisTrip: 0, fightTargetId: null, path: [],
      });
    }
  }


  // Place one Research per non-empty player, between war units (build grid) and miners (hut grid)
  for (let i = 0; i < playerStates.length; i++) {
    const p = playerStates[i];
    if (p.isEmpty) continue;
    const buildOrigin = getBuildGridOrigin(i, map, playerStates);
    const hutOrigin = getHutGridOrigin(i, map, playerStates);
    const isLandscape = map.shapeAxis === 'x';
    // Place research at the midpoint between hut grid and build grid
    const bx = isLandscape
      ? Math.round((buildOrigin.x + hutOrigin.x) / 2)
      : buildOrigin.x + Math.floor(map.buildGridCols / 2); // center across build grid columns
    const by = isLandscape ? buildOrigin.y : Math.round((buildOrigin.y + hutOrigin.y) / 2);
    const researchHp = 500;
    state.buildings.push({
      id: genId(state), type: BuildingType.Research, playerId: i, buildGrid: 'military',
      gridX: -1, gridY: -1, worldX: bx, worldY: by,
      lane: Lane.Left, hp: researchHp, maxHp: researchHp, actionTimer: 0, placedTick: 0, upgradePath: [],
    });
  }

  // Compute initial visibility so first frame isn't all dark
  if (fogOfWar) updateVisibility(state);

  return state;
}

// === Layout helpers ===
// All layout functions accept an optional MapDef. When omitted, they use DUEL_MAP
// (backward-compatible with all existing callers).

export function getBuildGridOrigin(playerId: number, mapDef?: MapDef, players?: { isEmpty: boolean }[]): { x: number; y: number } {
  if (mapDef) {
    const slot = mapDef.playerSlots[playerId];
    if (slot) {
      const origin = { ...slot.buildGridOrigin };
      // Center build grid when teammate is empty (1v1 on a 2v2+ portrait map)
      if (players && mapDef.playersPerTeam >= 2 && mapDef.shapeAxis === 'y') {
        const ppt = mapDef.playersPerTeam;
        const teamStart = Math.floor(playerId / ppt) * ppt;
        const allTeammatesEmpty = Array.from({ length: ppt }, (_, s) => teamStart + s)
          .filter(s => s !== playerId)
          .every(s => players[s]?.isEmpty);
        if (allTeammatesEmpty) {
          origin.x = CROSS_BASE_MARGIN + Math.floor((CROSS_BASE_WIDTH - mapDef.buildGridCols) / 2);
        }
      }
      return origin;
    }
  }
  // Legacy duel map fallback
  const team = playerId < 2 ? Team.Bottom : Team.Top;
  const isLeft = playerId === 0 || playerId === 2;

  const gap = 2;
  const totalW = BUILD_GRID_COLS * 2 + gap;
  const baseLeft = CROSS_BASE_MARGIN;
  const startX = baseLeft + Math.floor((CROSS_BASE_WIDTH - totalW) / 2);
  const x = isLeft
    ? startX
    : startX + BUILD_GRID_COLS + gap;

  const zoneStart = team === Team.Bottom ? ZONES.BOTTOM_BASE.start : ZONES.TOP_BASE.start;
  const zoneH = (team === Team.Bottom ? ZONES.BOTTOM_BASE.end : ZONES.TOP_BASE.end) - zoneStart;
  const y = zoneStart + Math.floor((zoneH - BUILD_GRID_ROWS) / 2);

  return { x, y };
}

export function getHutGridOrigin(playerId: number, mapDef?: MapDef, players?: { isEmpty: boolean }[]): { x: number; y: number } {
  if (mapDef) {
    const slot = mapDef.playerSlots[playerId];
    if (slot) {
      const origin = { ...slot.hutGridOrigin };
      // Center hut grid when teammate is empty (1v1 on a 2v2+ portrait map)
      if (players && mapDef.playersPerTeam >= 2 && mapDef.shapeAxis === 'y') {
        const ppt = mapDef.playersPerTeam;
        const teamStart = Math.floor(playerId / ppt) * ppt;
        const allTeammatesEmpty = Array.from({ length: ppt }, (_, s) => teamStart + s)
          .filter(s => s !== playerId)
          .every(s => players[s]?.isEmpty);
        if (allTeammatesEmpty) {
          origin.x = CROSS_BASE_MARGIN + Math.floor((CROSS_BASE_WIDTH - mapDef.hutGridCols) / 2);
        }
      }
      return origin;
    }
  }
  // Legacy duel map fallback
  const team = playerId < 2 ? Team.Bottom : Team.Top;
  const x = (playerId === 0 || playerId === 2) ? 29 : 41;
  const y = team === Team.Bottom ? ZONES.BOTTOM_BASE.end - 2 : ZONES.TOP_BASE.start + 1;
  return { x, y };
}

export function getTeamAlleyOrigin(team: Team, mapDef?: MapDef): { x: number; y: number } {
  if (mapDef) {
    const teamDef = mapDef.teams[team];
    if (teamDef) return { ...teamDef.towerAlleyOrigin };
  }
  // Legacy duel map fallback
  return { x: 30, y: team === Team.Bottom ? 82 : 26 };
}

export function getHQPosition(team: Team, mapDef?: MapDef): { x: number; y: number } {
  if (mapDef) {
    const teamDef = mapDef.teams[team];
    if (teamDef) return { ...teamDef.hqPosition };
  }
  // Legacy duel map fallback
  const centerX = Math.floor(MAP_WIDTH / 2) - Math.floor(HQ_WIDTH / 2);
  return team === Team.Bottom
    ? { x: centerX, y: ZONES.BOTTOM_BASE.start + 1 }
    : { x: centerX, y: ZONES.TOP_BASE.end - HQ_HEIGHT - 1 };
}

export function gridSlotToWorld(playerId: number, gridX: number, gridY: number, mapDef?: MapDef, players?: { isEmpty: boolean }[]): { x: number; y: number } {
  const origin = getBuildGridOrigin(playerId, mapDef, players);
  return { x: origin.x + gridX, y: origin.y + gridY };
}

// === Lane path helpers ===

function getLanePath(team: Team, lane: Lane, mapDef?: MapDef): readonly Vec2[] {
  if (mapDef) {
    const paths = mapDef.lanePaths[team];
    return lane === Lane.Left ? paths.left : paths.right;
  }
  return team === Team.Bottom
    ? (lane === Lane.Left ? LANE_PATHS.bottom.left : LANE_PATHS.bottom.right)
    : (lane === Lane.Left ? LANE_PATHS.top.left : LANE_PATHS.top.right);
}

function interpolatePath(path: readonly Vec2[], t: number): Vec2 {
  const ct = Math.max(0, Math.min(1, t));
  const segs = path.length - 1;
  const seg = ct * segs;
  const idx = Math.min(Math.floor(seg), segs - 1);
  const lt = seg - idx;
  const a = path[idx], b = path[idx + 1];
  return { x: a.x + (b.x - a.x) * lt, y: a.y + (b.y - a.y) * lt };
}

/** Find the normalized path progress (0-1) of the point on the path closest to (px, py). */
function findNearestPathProgress(path: readonly Vec2[], px: number, py: number): number {
  let bestDist = Infinity;
  let bestT = 0;
  const pathLen = getPathLength(path);
  // Sample along the path at reasonable intervals
  const steps = Math.max(20, Math.ceil(pathLen / 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const pos = interpolatePath(path, t);
    const d = (pos.x - px) ** 2 + (pos.y - py) ** 2;
    if (d < bestDist) { bestDist = d; bestT = t; }
  }
  return bestT;
}

function getPathLength(path: readonly Vec2[]): number {
  let len = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const dx = path[i + 1].x - path[i].x, dy = path[i + 1].y - path[i].y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

// Precomputed path lengths — cached per map on first access
const PATH_LENGTH_CACHE = new Map<string, Record<string, number>>();
function getCachedPathLength(team: Team, lane: Lane, mapDef?: MapDef): number {
  const mapId = mapDef?.id ?? 'duel';
  let cache = PATH_LENGTH_CACHE.get(mapId);
  if (!cache) {
    cache = {};
    if (mapDef) {
      for (let t = 0; t < mapDef.lanePaths.length; t++) {
        const paths = mapDef.lanePaths[t];
        cache[`${t}_left`] = getPathLength(paths.left);
        cache[`${t}_right`] = getPathLength(paths.right);
      }
    } else {
      cache['0_left'] = getPathLength(LANE_PATHS.bottom.left);
      cache['0_right'] = getPathLength(LANE_PATHS.bottom.right);
      cache['1_left'] = getPathLength(LANE_PATHS.top.left);
      cache['1_right'] = getPathLength(LANE_PATHS.top.right);
    }
    PATH_LENGTH_CACHE.set(mapId, cache);
  }
  return cache[`${team}_${lane}`] ?? cache['0_left'] ?? 100;
}

// Choke points: where units bunch up (necks of the peanut shape)
function getChokePoints(mapDef?: MapDef): readonly Vec2[] {
  if (mapDef && mapDef.shapeAxis === 'x') {
    // Landscape: chokes at the neck columns (x ≈ 45 and x ≈ 115)
    const midY = Math.floor(mapDef.height / 2);
    return [
      { x: 45, y: midY }, { x: 45, y: midY - 15 }, { x: 45, y: midY + 15 },
      { x: 115, y: midY }, { x: 115, y: midY - 15 }, { x: 115, y: midY + 15 },
    ];
  }
  // Portrait (duel): hardcoded vertical chokes
  return [
    { x: 40, y: 95 },
    { x: 40, y: 82 },
    { x: 40, y: 38 },
    { x: 40, y: 25 },
  ];
}

function getChokeSpreadMultiplier(x: number, y: number, mapDef?: MapDef): number {
  const chokePoints = getChokePoints(mapDef);
  let best = Infinity;
  for (const p of chokePoints) {
    const d = Math.sqrt((x - p.x) ** 2 + (y - p.y) ** 2);
    if (d < best) best = d;
  }
  // Strongest spread near chokepoints, fades out by ~18 tiles.
  const t = Math.max(0, 1 - best / 18);
  return 1 + t * 1.2;
}

function buildDiamondCellMap(cells: GoldCell[]): Map<number, GoldCell> {
  const m = new Map<number, GoldCell>();
  for (const c of cells) m.set(c.tileX * 10000 + c.tileY, c);
  return m;
}

// === Debug: catch units teleporting or ending up at bad positions ===
const DEBUG_POSITIONS = false; // Set true locally to enable position debugging
const _debugPrevPositions = new Map<number, { x: number; y: number }>();
// Max tiles a unit can legitimately move in one tick (fastest unit ~6 tiles/s / 20 ticks + hopAttack leaps ~15 tiles)
const _MAX_LEGIT_JUMP = 20;
function debugCheckUnitPositions(state: GameState, phase: string): void {
  if (!DEBUG_POSITIONS) return;
  const mapW = state.mapDef?.width ?? MAP_WIDTH;
  const mapH = state.mapDef?.height ?? MAP_HEIGHT;
  for (const u of state.units) {
    if (u.hp <= 0) continue;
    const prev = _debugPrevPositions.get(u.id);
    const px = prev?.x ?? u.x, py = prev?.y ?? u.y;

    // Detect jump teleport — unit moved an implausible distance in one tick
    if (prev !== undefined) {
      const jd = Math.sqrt((u.x - px) ** 2 + (u.y - py) ** 2);
      if (jd > _MAX_LEGIT_JUMP) {
        console.error(
          `[BUG] Unit teleported ${jd.toFixed(1)} tiles after ${phase}! tick=${state.tick} id=${u.id} type="${u.type}" ` +
          `pos=(${u.x.toFixed(2)},${u.y.toFixed(2)}) prev=(${px.toFixed(2)},${py.toFixed(2)}) ` +
          `team=${u.team} lane=${u.lane} pathProgress=${u.pathProgress.toFixed(4)} ` +
          `targetId=${u.targetId} hp=${u.hp}/${u.maxHp} category=${u.category} siege=${!!u.upgradeSpecial?.isSiegeUnit}`
        );
      }
    }

    // Detect units clearly off the map
    if (u.x < 0 || u.y < 0 || u.x > mapW || u.y > mapH) {
      console.warn(
        `[BUG] Unit off map after ${phase}! tick=${state.tick} id=${u.id} type="${u.type}" ` +
        `pos=(${u.x.toFixed(2)},${u.y.toFixed(2)}) map=(${mapW},${mapH}) ` +
        `team=${u.team} lane=${u.lane} pathProgress=${u.pathProgress.toFixed(4)} targetId=${u.targetId}`
      );
      clampToArenaBounds(u, 0.35, state.mapDef);
    }

    // Detect units at or very near origin (no valid gameplay position is < 3 tiles from both edges)
    if (u.x < 3 && u.y < 3) {
      console.warn(
        `[BUG] Unit at origin after ${phase}! tick=${state.tick} id=${u.id} type="${u.type}" ` +
        `pos=(${u.x.toFixed(2)},${u.y.toFixed(2)}) prev=(${px.toFixed(2)},${py.toFixed(2)}) ` +
        `team=${u.team} lane=${u.lane} pathProgress=${u.pathProgress.toFixed(4)} ` +
        `targetId=${u.targetId} hp=${u.hp}/${u.maxHp} category=${u.category}`
      );
      clampToArenaBounds(u, 0.35, state.mapDef);
    }

    // Detect NaN positions
    if (isNaN(u.x) || isNaN(u.y)) {
      console.error(
        `[BUG] Unit has NaN position after ${phase}! tick=${state.tick} id=${u.id} type="${u.type}" ` +
        `pos=(${u.x},${u.y}) prev=(${px},${py}) ` +
        `team=${u.team} lane=${u.lane} pathProgress=${u.pathProgress}`
      );
      // Fix: snap to lane path start
      const path = getLanePath(u.team, u.lane, state.mapDef);
      u.x = path[0].x;
      u.y = path[0].y;
      u.pathProgress = 0;
    }

    _debugPrevPositions.set(u.id, { x: u.x, y: u.y });
  }
  // Clean up stale entries
  if (state.tick % 100 === 0) {
    const liveIds = new Set<number>();
    for (const u of state.units) liveIds.add(u.id);
    for (const id of _debugPrevPositions.keys()) {
      if (!liveIds.has(id)) _debugPrevPositions.delete(id);
    }
  }
}

// === Simulation Tick ===

export function simulateTick(state: GameState, commands: GameCommand[]): void {
  state.soundEvents = [];
  state.combatEvents = [];
  for (const cmd of commands) processCommand(state, cmd);

  if (state.matchPhase === 'prematch') {
    state.prematchTimer--;
    if (state.prematchTimer <= 0) {
      state.matchPhase = 'playing';
      addSound(state, 'match_start');
    }
    tickEffects(state);
    state.tick++;
    return;
  }
  if (state.matchPhase === 'ended') {
    // Compute war heroes once on first ended tick
    if (state.warHeroes.length === 0) computeWarHeroes(state);
    // Clean up any units that died on the tick the match ended
    // (projectiles/burn DoT can kill after tickCombat's filter ran)
    state.units = state.units.filter(u => u.hp > 0);
    tickEffects(state);
    state.tick++;
    return;
  }

  // Passive income: +1/sec of primary resource, +0.1/sec of secondary resource
  // Primary = most-used resource in building costs; secondary = other needed resource
  if (state.tick % TICK_RATE === 0) {
    for (const p of state.players) {
      if (p.isEmpty) continue;
      const inc = PASSIVE_INCOME[p.race];
      const ps = state.playerStats[p.id];
      if (inc.gold >= 1) { p.gold += Math.floor(inc.gold); if (ps) ps.totalGoldEarned += Math.floor(inc.gold); }
      else if (inc.gold > 0) { p.goldFrac = (p.goldFrac ?? 0) + inc.gold; if (p.goldFrac >= 1) { p.goldFrac -= 1; p.gold += 1; if (ps) ps.totalGoldEarned += 1; } }
      if (inc.wood >= 1) { p.wood += Math.floor(inc.wood); if (ps) ps.totalWoodEarned += Math.floor(inc.wood); }
      else if (inc.wood > 0) { p.woodFrac = (p.woodFrac ?? 0) + inc.wood; if (p.woodFrac >= 1) { p.woodFrac -= 1; p.wood += 1; if (ps) ps.totalWoodEarned += 1; } }
      if (inc.stone >= 1) { p.stone += Math.floor(inc.stone); if (ps) ps.totalStoneEarned += Math.floor(inc.stone); }
      else if (inc.stone > 0) { p.stoneFrac = (p.stoneFrac ?? 0) + inc.stone; if (p.stoneFrac >= 1) { p.stoneFrac -= 1; p.stone += 1; if (ps) ps.totalStoneEarned += 1; } }
      // Demon: passive mana generation (+1/sec)
      if (p.race === Race.Demon) {
        p.mana += 1;
        // Show floating text at research building every 5 seconds to avoid spam
        if (state.tick % (5 * TICK_RATE) === 0) {
          const research = state.buildings.find(b => b.type === BuildingType.Research && b.playerId === p.id);
          if (research) {
            addFloatingText(state, research.worldX, research.worldY, '+5', '#7c4dff', 'mana', undefined, { ownerOnly: p.id });
          }
        }
      }
    }
  }

  // Tick race ability cooldowns and active effects
  tickAbilityEffects(state);

  // Build diamond cell map once per tick (reused by harvesters, exposure check, and isBlocked)
  const diamondCellMap = buildDiamondCellMap(state.diamondCells);
  _diamondCellMapInt = diamondCellMap;

  // Update diamond exposed state (check every second, not every tick — BFS is expensive)
  if (state.diamond.state === 'hidden' && state.tick % TICK_RATE === 0) {
    if (isDiamondExposed(diamondCellMap, state)) {
      state.diamond.exposed = true;
      state.diamond.state = 'exposed';
      addSound(state, 'diamond_exposed', state.diamond.x, state.diamond.y);
    }
  }

  // Build spatial grid early — reused by tickUnitMovement and tickCombat
  _combatGrid.build(state.units);

  tickSpawners(state);
  debugCheckUnitPositions(state, 'tickSpawners');
  tickUnitMovement(state);
  debugCheckUnitPositions(state, 'tickUnitMovement');
  tickUnitDiamondPickup(state);
  tickPotionPickups(state);
  tickUnitCollision(state);
  debugCheckUnitPositions(state, 'tickUnitCollision');
  tickCombat(state);
  debugCheckUnitPositions(state, 'tickCombat');
  tickTowers(state);
  tickHQDefense(state);
  tickProjectiles(state);
  debugCheckUnitPositions(state, 'tickProjectiles');
  tickStatusEffects(state);
  debugCheckUnitPositions(state, 'tickStatusEffects');
  tickNukeTelegraphs(state);
  tickHarvesters(state);
  debugCheckUnitPositions(state, 'tickHarvesters');
  tickEffects(state);
  checkWinConditions(state);

  // Track diamond hold time
  if (state.diamond.state === 'carried' && state.diamond.carrierId !== null) {
    if (state.diamond.carrierType === 'unit') {
      const u = state.units.find(u => u.id === state.diamond.carrierId);
      if (u && state.playerStats[u.playerId]) state.playerStats[u.playerId].diamondTimeHeld++;
    } else if (state.diamond.carrierType === 'harvester') {
      const h = state.harvesters.find(h => h.id === state.diamond.carrierId);
      if (h && state.playerStats[h.playerId]) state.playerStats[h.playerId].diamondTimeHeld++;
    }
  }

  if (state.tick >= MATCH_TIMEOUT_TICKS) {
    state.matchPhase = 'ended';
    // Timeout: team with most HP wins
    let bestTeam: Team | null = null;
    let bestHp = -1;
    for (let t = 0; t < state.hqHp.length; t++) {
      if (state.hqHp[t] > bestHp) { bestHp = state.hqHp[t]; bestTeam = t as Team; }
    }
    if (bestTeam !== null) {
      // Only set winner if one team is strictly ahead
      const tied = state.hqHp.filter(hp => hp === bestHp).length > 1;
      if (!tied) state.winner = bestTeam;
    }
    state.winCondition = 'timeout';
  }

  // Update fog of war visibility every tick for immediate response
  if (state.fogOfWar) {
    updateVisibility(state);
  }

  state.tick++;
}

// === Fog of War Visibility ===

const UNIT_VISION = 10;      // tiles
const BUILDING_VISION = 8;
const TOWER_VISION = 12;
const HQ_VISION = 14;
const HARVESTER_VISION = 6;

function revealCircle(vis: boolean[], cx: number, cy: number, radius: number, mapW: number, mapH: number): void {
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(mapW - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(mapH - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    const dy2 = dy * dy;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      if (dx * dx + dy2 <= r2) {
        vis[y * mapW + x] = true;
      }
    }
  }
}

export function updateVisibility(state: GameState): void {
  const mapW = state.mapDef.width;
  const mapH = state.mapDef.height;
  const teamCount = state.mapDef.teams.length;
  const totalTiles = mapW * mapH;

  // Cache building visibility — only rebuild when building count changes
  const bCount = state.buildings.length;
  if (!_buildingVisCache || _buildingVisCacheCount !== bCount || _buildingVisCacheTeams !== teamCount) {
    _buildingVisCache = [];
    for (let t = 0; t < teamCount; t++) {
      const bvis = new Array<boolean>(totalTiles).fill(false);
      // HQ vision
      const hqPos = getHQPosition(t as Team, state.mapDef);
      revealCircle(bvis, hqPos.x + HQ_WIDTH / 2, hqPos.y + HQ_HEIGHT / 2, HQ_VISION, mapW, mapH);
      // Building vision
      for (const b of state.buildings) {
        if (state.players[b.playerId]?.team !== t) continue;
        const r = b.type === BuildingType.Tower ? TOWER_VISION : BUILDING_VISION;
        revealCircle(bvis, b.worldX, b.worldY, r, mapW, mapH);
      }
      _buildingVisCache.push(bvis);
    }
    _buildingVisCacheCount = bCount;
    _buildingVisCacheTeams = teamCount;
  }

  for (let t = 0; t < teamCount; t++) {
    const vis = state.visibility[t];
    // Start from cached building visibility
    const bvis = _buildingVisCache[t];
    for (let i = 0; i < totalTiles; i++) vis[i] = bvis[i];

    // Units
    for (const u of state.units) {
      if (u.hp <= 0 || u.team !== t) continue;
      revealCircle(vis, u.x, u.y, UNIT_VISION, mapW, mapH);
    }
    // Harvesters
    for (const h of state.harvesters) {
      if (h.state === 'dead') continue;
      if (state.players[h.playerId]?.team !== t) continue;
      revealCircle(vis, h.x, h.y, HARVESTER_VISION, mapW, mapH);
    }
  }
}

// === Commands ===

function processCommand(state: GameState, cmd: GameCommand): void {
  switch (cmd.type) {
    case 'place_building': placeBuilding(state, cmd); break;
    case 'sell_building': sellBuilding(state, cmd); break;
    case 'purchase_upgrade': purchaseUpgrade(state, cmd); break;
    case 'toggle_lane': toggleLane(state, cmd); break;
    case 'toggle_all_lanes': toggleAllLanes(state, cmd); break;
    case 'build_hut': buildHut(state, cmd); break;
    case 'set_hut_assignment': setHutAssignment(state, cmd); break;
    case 'fire_nuke': fireNuke(state, cmd); break;
    case 'ping': addPing(state, cmd); break;
    case 'quick_chat': addQuickChat(state, cmd); break;
    case 'concede': concedeMatch(state, cmd); break;
    case 'use_ability': useAbility(state, cmd); break;
    case 'research_upgrade': processResearchUpgrade(state, cmd); break;
  }
}

function purchaseUpgrade(state: GameState, cmd: Extract<GameCommand, { type: 'purchase_upgrade' }>): void {
  const building = state.buildings.find(b => b.id === cmd.buildingId && b.playerId === cmd.playerId);
  if (!building) return;
  if (building.type === BuildingType.HarvesterHut) return;
  if (building.upgradePath.length >= 3) return;
  if (!isValidUpgradeChoice(building.upgradePath, cmd.choice)) return;

  const player = state.players[cmd.playerId];
  const cost = getUpgradeCost(building.upgradePath, player.race, building.type, cmd.choice);
  if (!cost) return;
  if (!canAffordCost(player, cost)) return;

  deductCost(player, cost);
  building.upgradePath.push(cmd.choice);

  // Apply HP upgrade to tower (scales maxHp, preserves ratio, then heals 30%)
  if (building.type === BuildingType.Tower) {
    const upgrade = getUnitUpgradeMultipliers(building.upgradePath, player.race, BuildingType.Tower);
    const baseCost = getBuildingCost(player.race, BuildingType.Tower);
    if (baseCost) {
      const newMax = Math.max(1, Math.round(baseCost.hp * upgrade.hp));
      const hpRatio = building.hp / building.maxHp;
      building.maxHp = newMax;
      building.hp = Math.min(newMax, Math.round(newMax * hpRatio) + Math.round(newMax * 0.3));
    }
  }

  // Show upgrade name if available
  const treeDef = getUpgradeNodeDef(player.race, building.type, cmd.choice);
  const label = treeDef ? treeDef.name : `UP ${cmd.choice}`;
  addFloatingText(state, building.worldX + 0.5, building.worldY, label, '#90caf9');
  addSound(state, 'upgrade_complete', building.worldX, building.worldY);
}

function processResearchUpgrade(state: GameState, cmd: Extract<GameCommand, { type: 'research_upgrade' }>): void {
  const player = state.players[cmd.playerId];
  if (!player) return;
  // Verify player owns a research
  const research = state.buildings.find(b => b.type === BuildingType.Research && b.playerId === cmd.playerId);
  if (!research) return;

  const allDefs = getAllResearchUpgrades(player.race);
  const def = allDefs.find(d => d.id === cmd.upgradeId);
  if (!def) return;

  const bu = player.researchUpgrades;

  // Get current level for cost calculation
  let currentLevel = 0;
  if (cmd.upgradeId === 'melee_atk') currentLevel = bu.meleeAtkLevel;
  else if (cmd.upgradeId === 'melee_def') currentLevel = bu.meleeDefLevel;
  else if (cmd.upgradeId === 'ranged_atk') currentLevel = bu.rangedAtkLevel;
  else if (cmd.upgradeId === 'ranged_def') currentLevel = bu.rangedDefLevel;
  else if (cmd.upgradeId === 'caster_atk') currentLevel = bu.casterAtkLevel;
  else if (cmd.upgradeId === 'caster_def') currentLevel = bu.casterDefLevel;

  // One-shot: check if already purchased
  if (def.oneShot && bu.raceUpgrades[cmd.upgradeId]) return;

  const cost = getResearchUpgradeCost(cmd.upgradeId, currentLevel, player.race);
  if (!canAffordCost(player, cost)) return;

  deductCost(player, cost);

  // Apply upgrade
  if (def.oneShot) {
    bu.raceUpgrades[cmd.upgradeId] = true;
  } else {
    if (cmd.upgradeId === 'melee_atk') bu.meleeAtkLevel++;
    else if (cmd.upgradeId === 'melee_def') bu.meleeDefLevel++;
    else if (cmd.upgradeId === 'ranged_atk') bu.rangedAtkLevel++;
    else if (cmd.upgradeId === 'ranged_def') bu.rangedDefLevel++;
    else if (cmd.upgradeId === 'caster_atk') bu.casterAtkLevel++;
    else if (cmd.upgradeId === 'caster_def') bu.casterDefLevel++;
  }

  addFloatingText(state, research.worldX + 0.5, research.worldY, def.name, '#90caf9');
  addSound(state, 'upgrade_complete', research.worldX, research.worldY);
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

function placeBuilding(state: GameState, cmd: Extract<GameCommand, { type: 'place_building' }>): void {
  const player = state.players[cmd.playerId];
  if (!player) return;
  if (cmd.buildingType === BuildingType.Research) return;
  if (cmd.buildingType === BuildingType.HarvesterHut) return; // huts use build_hut command
  const cost = getBuildingCost(player.race, cmd.buildingType);
  if (!cost) return;

  // First tower is free for each player (one-time only)
  const isFirstTower = cmd.buildingType === BuildingType.Tower && !player.hasBuiltTower;

  // Towers escalate faster than other slots — each additional tower after the first costs more
  let effectiveCost = cost;
  if (cmd.buildingType === BuildingType.Tower && !isFirstTower) {
    const myTowers = state.buildings.filter(b => b.playerId === cmd.playerId && b.type === BuildingType.Tower).length;
    const mult = Math.pow(TOWER_COST_SCALE, Math.max(0, myTowers - 1));
    effectiveCost = {
      gold: Math.floor(cost.gold * mult),
      wood: Math.floor(cost.wood * mult),
      stone: Math.floor(cost.stone * mult),
      hp: cost.hp,
    };
  }

  if (!isFirstTower) {
    if (player.gold < effectiveCost.gold || player.wood < effectiveCost.wood || player.stone < effectiveCost.stone) return;
  }

  const isAlley = cmd.gridType === 'alley';
  // Determine default lane from map slot override, or fallback to alternating by position in team
  const slot = state.mapDef?.playerSlots[cmd.playerId];
  let isLeft: boolean;
  if (slot?.defaultLane != null) {
    isLeft = slot.defaultLane === Lane.Left;
  } else {
    const myTeamIdx = slot?.teamIndex ?? (cmd.playerId < 2 ? 0 : 1);
    let posInTeam = 0;
    for (let i = 0; i < cmd.playerId; i++) {
      const otherTeam = state.mapDef?.playerSlots[i]?.teamIndex ?? (i < 2 ? 0 : 1);
      if (otherTeam === myTeamIdx) posInTeam++;
    }
    isLeft = posInTeam % 2 === 0;
  }

  if (isAlley) {
    // Shared tower alley: only towers allowed; occupancy is team-wide
    if (cmd.buildingType !== BuildingType.Tower) return;
    if (cmd.gridX < 0 || cmd.gridX >= state.mapDef.towerAlleyCols || cmd.gridY < 0 || cmd.gridY >= state.mapDef.towerAlleyRows) return;
    const playerTeam = state.players[cmd.playerId]?.team ?? (cmd.playerId < 2 ? Team.Bottom : Team.Top);
    if (state.buildings.some(b => b.buildGrid === 'alley' &&
        (state.players[b.playerId]?.team ?? (b.playerId < 2 ? Team.Bottom : Team.Top)) === playerTeam &&
        b.gridX === cmd.gridX && b.gridY === cmd.gridY)) return;
    const origin = getTeamAlleyOrigin(playerTeam, state.mapDef);
    const world = { x: origin.x + cmd.gridX, y: origin.y + cmd.gridY };
    if (!isFirstTower) { player.gold -= effectiveCost.gold; player.wood -= effectiveCost.wood; player.stone -= effectiveCost.stone; }
    state.buildings.push({
      id: genId(state), type: cmd.buildingType, playerId: cmd.playerId, buildGrid: 'alley',
      gridX: cmd.gridX, gridY: cmd.gridY, worldX: world.x, worldY: world.y,
      lane: isLeft ? Lane.Left : Lane.Right,
      hp: cost.hp, maxHp: cost.hp, actionTimer: 0, placedTick: state.tick, upgradePath: ['A'],
    });
    addSound(state, 'building_placed', world.x, world.y);
    if (isFirstTower) player.hasBuiltTower = true;
  } else {
    // Military grid — towers not allowed here (must use tower alley)
    if (cmd.buildingType === BuildingType.Tower) return;
    if (cmd.gridX < 0 || cmd.gridX >= state.mapDef.buildGridCols || cmd.gridY < 0 || cmd.gridY >= state.mapDef.buildGridRows) return;
    if (state.buildings.some(b => b.buildGrid === 'military' && b.playerId === cmd.playerId && b.gridX === cmd.gridX && b.gridY === cmd.gridY)) return;
    player.gold -= cost.gold; player.wood -= cost.wood; player.stone -= cost.stone;
    const world = gridSlotToWorld(cmd.playerId, cmd.gridX, cmd.gridY, state.mapDef, state.players);
    state.buildings.push({
      id: genId(state), type: cmd.buildingType, playerId: cmd.playerId, buildGrid: 'military',
      gridX: cmd.gridX, gridY: cmd.gridY, worldX: world.x, worldY: world.y,
      lane: isLeft ? Lane.Left : Lane.Right,
      hp: cost.hp, maxHp: cost.hp, actionTimer: SPAWN_INTERVAL_TICKS, placedTick: state.tick, upgradePath: ['A'],
    });
    addSound(state, 'building_placed', world.x, world.y);
  }
}

function sellBuilding(state: GameState, cmd: Extract<GameCommand, { type: 'sell_building' }>): void {
  const idx = state.buildings.findIndex(b => b.id === cmd.buildingId && b.playerId === cmd.playerId);
  if (idx === -1) return;
  const building = state.buildings[idx];
  // Cannot sell research
  if (building.type === BuildingType.Research) return;
  if (state.tick - building.placedTick < SELL_COOLDOWN_TICKS) {
    const remainingTicks = SELL_COOLDOWN_TICKS - (state.tick - building.placedTick);
    const remainingSeconds = (remainingTicks / TICK_RATE).toFixed(1);
    addFloatingText(state, building.worldX + 0.5, building.worldY, `Sell in ${remainingSeconds}s`, '#ff6b6b');
    return;
  }
  const player = state.players[cmd.playerId];
  const cost = getBuildingCost(player.race, building.type);

  // Calculate total invested: base cost + upgrade costs (respecting per-node overrides)
  let totalGold = cost.gold, totalWood = cost.wood, totalStone = cost.stone, totalEssence = 0, totalSouls = 0;
  if (building.upgradePath.length >= 2) {
    const t1Cost = getUpgradeCost(['A'], player.race, building.type, building.upgradePath[1]);
    if (t1Cost) { totalGold += t1Cost.gold; totalWood += t1Cost.wood; totalStone += t1Cost.stone; totalEssence += t1Cost.deathEssence ?? 0; totalSouls += t1Cost.souls ?? 0; }
  }
  if (building.upgradePath.length >= 3) {
    const t2Cost = getUpgradeCost(['A', building.upgradePath[1]], player.race, building.type, building.upgradePath[2]);
    if (t2Cost) { totalGold += t2Cost.gold; totalWood += t2Cost.wood; totalStone += t2Cost.stone; totalEssence += t2Cost.deathEssence ?? 0; totalSouls += t2Cost.souls ?? 0; }
  }

  // Refund 50% of total invested resources
  const refundGold = Math.floor(totalGold * 0.5);
  const refundWood = Math.floor(totalWood * 0.5);
  const refundStone = Math.floor(totalStone * 0.5);
  player.gold += refundGold;
  player.wood += refundWood;
  player.stone += refundStone;
  if (totalEssence > 0) player.deathEssence += Math.floor(totalEssence * 0.5);
  if (totalSouls > 0) player.souls += Math.floor(totalSouls * 0.5);

  // If it's a hut, remove the associated harvester
  if (building.type === BuildingType.HarvesterHut) {
    const hIdx = state.harvesters.findIndex(h => h.hutId === building.id);
    if (hIdx !== -1) state.harvesters.splice(hIdx, 1);
  }

  // Show refund floating texts for each resource returned
  const bx = building.worldX, by = building.worldY;
  if (refundGold > 0) addFloatingText(state, bx, by, `+${refundGold}`, '#ffd700', 'gold');
  if (refundWood > 0) addFloatingText(state, bx, by - 0.5, `+${refundWood}`, '#8B4513', 'wood');
  if (refundStone > 0) addFloatingText(state, bx, by - 1.0, `+${refundStone}`, '#aaaaaa', 'stone');
  addSound(state, 'building_destroyed', bx, by);
  state.buildings.splice(idx, 1);
}

function toggleLane(state: GameState, cmd: Extract<GameCommand, { type: 'toggle_lane' }>): void {
  // Oozlings can't toggle lanes — random assignment at spawn
  if (state.players[cmd.playerId]?.race === Race.Oozlings) return;
  const b = state.buildings.find(b => b.id === cmd.buildingId && b.playerId === cmd.playerId);
  if (b) b.lane = cmd.lane;
}

function toggleAllLanes(state: GameState, cmd: Extract<GameCommand, { type: 'toggle_all_lanes' }>): void {
  // Oozlings can't toggle lanes — random assignment at spawn
  if (state.players[cmd.playerId]?.race === Race.Oozlings) return;
  for (const b of state.buildings) {
    if (b.playerId === cmd.playerId && b.type !== BuildingType.Tower) b.lane = cmd.lane;
  }
}

function buildHut(state: GameState, cmd: Extract<GameCommand, { type: 'build_hut' }>): void {
  const player = state.players[cmd.playerId];
  const myHuts = state.buildings.filter(b => b.playerId === cmd.playerId && b.type === BuildingType.HarvesterHut);
  if (myHuts.length >= state.mapDef.hutGridCols * state.mapDef.hutGridRows) return;
  const hutRes = getBuildingCost(player.race, BuildingType.HarvesterHut);
  const mult = Math.pow(HUT_COST_SCALE, Math.max(0, myHuts.length - 1));
  const goldCost = Math.floor(hutRes.gold * mult);
  const woodCost = Math.floor(hutRes.wood * mult);
  const stoneCost = Math.floor(hutRes.stone * mult);
  if (player.gold < goldCost || player.wood < woodCost || player.stone < stoneCost) return;
  player.gold -= goldCost;
  player.wood -= woodCost;
  player.stone -= stoneCost;

  const origin = getHutGridOrigin(cmd.playerId, state.mapDef, state.players);
  const hCols = state.mapDef.hutGridCols;
  const totalSlots = hCols * state.mapDef.hutGridRows;
  const occupiedHuts = new Set(myHuts.map(b => b.gridX));
  // Fill from center outward (slot is linear index across cols then rows)
  const CENTER_OUT: number[] = [];
  for (let d = 0; d <= Math.floor(totalSlots / 2); d++) {
    const mid = Math.floor(totalSlots / 2);
    if (mid + d < totalSlots) CENTER_OUT.push(mid + d);
    if (d > 0 && mid - d >= 0) CENTER_OUT.push(mid - d);
  }
  for (const slot of CENTER_OUT) {
    if (!occupiedHuts.has(slot)) {
      const gx = slot % hCols;
      const gy = Math.floor(slot / hCols);
      const world = { x: origin.x + gx, y: origin.y + gy };
      const building: BuildingState = {
        id: genId(state), type: BuildingType.HarvesterHut, playerId: cmd.playerId, buildGrid: 'hut',
        gridX: slot, gridY: 0, worldX: world.x, worldY: world.y,
        lane: Lane.Left, hp: getBuildingCost(player.race, BuildingType.HarvesterHut).hp, maxHp: getBuildingCost(player.race, BuildingType.HarvesterHut).hp, actionTimer: 0, placedTick: state.tick, upgradePath: [],
      };
      state.buildings.push(building);
      // Tenders: no harvester workers — huts passively generate resources
      if (player.race !== Race.Tenders) {
        state.harvesters.push({
          id: genId(state), hutId: building.id, playerId: cmd.playerId, team: player.team,
          x: world.x, y: world.y, hp: 30, maxHp: 30, damage: 0,
          assignment: getSmartHarvesterAssignment(player.race, state, cmd.playerId),
          state: 'walking_to_node', miningTimer: 0, respawnTimer: 0,
          carryingDiamond: false, carryingResource: null, carryAmount: 0,
          queuedWoodAmount: 0, woodCarryTarget: 0, woodDropsCreated: 0,
          targetCellIdx: -1, diamondCellsMinedThisTrip: 0, fightTargetId: null, path: [],
        });
      }
      addSound(state, 'building_placed', world.x, world.y);
      return;
    }
  }
}

function setHutAssignment(state: GameState, cmd: Extract<GameCommand, { type: 'set_hut_assignment' }>): void {
  const h = state.harvesters.find(h => h.hutId === cmd.hutId && h.playerId === cmd.playerId);
  if (!h) return;
  // Only Demon can assign harvesters to Mana
  if (cmd.assignment === HarvesterAssignment.Mana && state.players[cmd.playerId]?.race !== Race.Demon) return;
  h.assignment = cmd.assignment;
  if (h.assignment !== HarvesterAssignment.Wood) {
    spillCarriedWood(state, h);
  }
  h.path = [];
  if (h.state === 'walking_to_node' || h.state === 'mining') {
    h.state = 'walking_to_node';
    h.miningTimer = 0;
    h.targetCellIdx = -1;
    h.diamondCellsMinedThisTrip = 0;
    h.woodDropsCreated = 0;
    h.woodCarryTarget = 0;
  }
}

// === Race Abilities ===

function useAbility(state: GameState, cmd: Extract<GameCommand, { type: 'use_ability' }>): void {
  if (state.matchPhase !== 'playing') return;
  const player = state.players[cmd.playerId];
  if (!player || player.isEmpty) return;
  const def = RACE_ABILITY_DEFS[player.race];
  if (!def) return;

  // Tenders uses stack-based system (no cost, no cooldown — needs stacks)
  const isTendersSeeds = player.race === Race.Tenders;

  // Calculate growing cost (non-Tenders)
  const growthMult = def.costGrowthFactor ? Math.pow(def.costGrowthFactor, player.abilityUseCount) : 1;
  // Geists: additive soul cost scaling (+5 per cast)
  const soulsCostAdditive = player.race === Race.Geists ? (def.baseCost.souls ?? 0) + 5 * player.abilityUseCount : 0;
  let woodCostMult = 1;
  // Crown: Royal Forge — foundry costs no wood
  if (player.race === Race.Crown && player.researchUpgrades.raceUpgrades['crown_ability_2']) woodCostMult = 0;
  // Horde: Troll Discount — War Troll costs 30% less
  const hordeCostMult = (player.race === Race.Horde && player.researchUpgrades.raceUpgrades['horde_ability_2']) ? 0.7 : 1;
  const cost = {
    gold: Math.floor((def.baseCost.gold ?? 0) * growthMult * hordeCostMult),
    wood: Math.floor((def.baseCost.wood ?? 0) * growthMult * woodCostMult * hordeCostMult),
    stone: Math.floor((def.baseCost.stone ?? 0) * growthMult * hordeCostMult),
    mana: Math.floor((def.baseCost.mana ?? 0) * growthMult),
    souls: player.race === Race.Geists ? soulsCostAdditive : Math.floor((def.baseCost.souls ?? 0) * growthMult),
    deathEssence: Math.floor((def.baseCost.deathEssence ?? 0) * growthMult),
  };

  if (isTendersSeeds) {
    if (player.abilityStacks <= 0) return;
  } else {
    // Validate cooldown
    if (player.abilityCooldown > 0) return;
    // Validate resources
    if (player.gold < cost.gold) return;
    if (player.wood < cost.wood) return;
    if (player.stone < cost.stone) return;
    if (player.mana < cost.mana) return;
    if (player.souls < cost.souls) return;
    if (player.deathEssence < cost.deathEssence) return;
  }

  // Vision check for targeted abilities that require it
  if (def.requiresVision && state.fogOfWar && cmd.x != null && cmd.y != null) {
    const tx = Math.floor(cmd.x);
    const ty = Math.floor(cmd.y);
    const mapW = state.mapDef.width;
    if (tx >= 0 && ty >= 0 && tx < mapW && ty < state.mapDef.height) {
      if (!state.visibility[player.team][ty * mapW + tx]) return; // can't see target
    }
  }

  // Validate BuildSlot abilities have an open slot
  if (def.targetMode === 'build_slot') {
    if (cmd.gridX != null && cmd.gridY != null) {
      // Specific slot requested — validate it's open and in bounds
      if (cmd.gridX < 0 || cmd.gridX >= state.mapDef.towerAlleyCols || cmd.gridY < 0 || cmd.gridY >= state.mapDef.towerAlleyRows) return;
      const teamBuildings = state.buildings.filter(b =>
        b.buildGrid === 'alley' && (state.players[b.playerId]?.team ?? -1) === player.team
      );
      const occupant = teamBuildings.find(b => b.gridX === cmd.gridX && b.gridY === cmd.gridY);
      if (occupant) {
        // Tenders can stack seeds on existing seeds (up to T3)
        if (isTendersSeeds && occupant.isSeed && (occupant.seedTier ?? 0) < 2) {
          // Allow — will be upgraded in tendersAbility
        } else {
          return; // slot occupied by non-seed or already T3
        }
      }
    } else {
      // No slot specified (bot or fallback) — find first open
      if (!findOpenAlleySlot(state, player)) return;
    }
  }

  // Deduct resources / stacks
  if (isTendersSeeds) {
    player.abilityStacks--;
  } else {
    player.gold -= cost.gold;
    player.wood -= cost.wood;
    player.stone -= cost.stone;
    player.mana -= cost.mana;
    player.souls -= cost.souls;
    player.deathEssence -= cost.deathEssence;
    let cd = def.baseCooldownTicks;
    // Demon Rapid Fire: -40% fireball cooldown
    if (player.race === Race.Demon && player.researchUpgrades.raceUpgrades['demon_ability_1']) cd = Math.round(cd * 0.75);
    player.abilityCooldown = cd;
  }
  player.abilityUseCount++;

  // Dispatch to race-specific handler
  switch (player.race) {
    case Race.Deep: deepAbility(state, player); break;
    case Race.Horde: hordeAbility(state, player); break;
    case Race.Crown: crownAbility(state, player, cmd); break;
    case Race.Wild: wildAbility(state, player, cmd); break;
    case Race.Demon: demonAbility(state, player, cmd); break;
    case Race.Geists: geistsAbility(state, player, cmd); break;
    case Race.Goblins: goblinsAbility(state, player, cmd); break;
    case Race.Oozlings: oozlingsAbility(state, player, cmd); break;
    case Race.Tenders: tendersAbility(state, player, cmd); break;
  }

}

// --- Per-race ability handlers ---
function deepAbility(state: GameState, player: PlayerState): void {
  // Global slow all enemies for a duration
  state.abilityEffects.push({
    id: genId(state), type: 'deep_rain',
    playerId: player.id, team: player.team,
    duration: 8 * TICK_RATE,
  });
  addSound(state, 'ability_deluge');
}

function hordeAbility(state: GameState, player: PlayerState): void {
  // Spawn a big troll from the HQ that joins the nearest lane point
  const hq = getHQPosition(player.team, state.mapDef);
  const lane = state.rng() < 0.5 ? Lane.Left : Lane.Right;
  const scaleFactor = 1 + 0.15 * (player.abilityUseCount - 1); // gets slightly stronger each cast
  const trollX = hq.x + 2, trollY = hq.y + 1;
  const trollPath = getLanePath(player.team, lane, state.mapDef);
  const trollProgress = findNearestPathProgress(trollPath, trollX, trollY);
  state.units.push({
    id: genId(state), type: 'War Troll', playerId: player.id, team: player.team,
    x: trollX, y: trollY,
    hp: Math.round(4500 * scaleFactor), maxHp: Math.round(4500 * scaleFactor),
    damage: Math.round(82 * scaleFactor),
    attackSpeed: 1.8, attackTimer: 0,
    moveSpeed: 2.7, range: 1.5,
    targetId: null, lane, pathProgress: trollProgress, carryingDiamond: false,
    statusEffects: [], hitCount: 0, shieldHp: 0,
    category: 'melee', upgradeTier: 0, upgradeNode: 'E', // Goblin troll warlord art
    spriteRace: Race.Goblins, visualScale: 2.0,
    upgradeSpecial: { knockbackChance: 0.3 }, kills: 0, damageDone: 0, healingDone: 0, buffsApplied: 0, lastDamagedByName: '', spawnTick: state.tick,
  });
  addFloatingText(state, trollX, trollY, 'WAR TROLL!', '#ff6600');
  addSound(state, 'ability_troll', trollX, trollY);
}

/** Find first open alley slot for the player's team. */
function findOpenAlleySlot(state: GameState, player: PlayerState): { gx: number; gy: number } | null {
  const teamAlleyBuildings = state.buildings.filter(b =>
    b.buildGrid === 'alley' && (state.players[b.playerId]?.team ?? -1) === player.team
  );
  for (let gy = 0; gy < state.mapDef.towerAlleyRows; gy++) {
    for (let gx = 0; gx < state.mapDef.towerAlleyCols; gx++) {
      if (!teamAlleyBuildings.some(b => b.gridX === gx && b.gridY === gy)) {
        return { gx, gy };
      }
    }
  }
  return null;
}

function crownAbility(state: GameState, player: PlayerState, cmd: Extract<GameCommand, { type: 'use_ability' }>): void {
  // Place a Gold Foundry in the tower alley (+1 gold per miner tick per foundry)
  const slot = (cmd.gridX != null && cmd.gridY != null) ? { gx: cmd.gridX, gy: cmd.gridY } : findOpenAlleySlot(state, player);
  if (!slot) return;
  const origin = getTeamAlleyOrigin(player.team, state.mapDef);
  const world = { x: origin.x + slot.gx, y: origin.y + slot.gy };
  state.buildings.push({
    id: genId(state), type: BuildingType.Tower, playerId: player.id, buildGrid: 'alley',
    gridX: slot.gx, gridY: slot.gy, worldX: world.x, worldY: world.y,
    lane: Lane.Left,
    hp: 120, maxHp: 120, actionTimer: 0, placedTick: state.tick, upgradePath: [],
    isFoundry: true, // marker for gold yield bonus
  });
  addFloatingText(state, world.x, world.y, 'FOUNDRY', '#ffd700');
  addSound(state, 'building_placed', world.x, world.y);
}

function wildAbility(state: GameState, player: PlayerState, cmd: Extract<GameCommand, { type: 'use_ability' }>): void {
  if (cmd.x == null || cmd.y == null) return;
  const def = RACE_ABILITY_DEFS[player.race];
  state.abilityEffects.push({
    id: genId(state), type: 'wild_frenzy',
    playerId: player.id, team: player.team,
    x: cmd.x, y: cmd.y, radius: def.aoeRadius ?? 8,
    duration: 6 * TICK_RATE,
  });
  addSound(state, 'ability_frenzy', cmd.x, cmd.y);
  addCombatEvent(state, { type: 'pulse', x: cmd.x, y: cmd.y, radius: def.aoeRadius ?? 8, color: '#ff6600' });
}

const FIREBALL_SPEED = 1.2; // tiles per tick (24 tiles/sec)

function demonAbility(state: GameState, player: PlayerState, cmd: Extract<GameCommand, { type: 'use_ability' }>): void {
  if (cmd.x == null || cmd.y == null) return;
  // Fireball — consumes ALL mana, damage scales with mana spent
  // The base cost was already deducted in useAbility; now consume the remaining mana too
  const extraMana = player.mana;
  player.mana = 0;
  const def = RACE_ABILITY_DEFS[player.race];
  const totalMana = (def.baseCost.mana ?? 50) + extraMana;
  const radius = def.aoeRadius ?? 6;
  const baseDamage = 25;
  const bonusMana = Math.max(0, totalMana - (def.baseCost.mana ?? 50));
  const totalDamage = Math.round(baseDamage + bonusMana * 0.5);

  // Find Research building as the launch point
  const research = state.buildings.find(b => b.type === BuildingType.Research && b.playerId === player.id);
  const srcX = research ? research.worldX + 0.5 : cmd.x;
  const srcY = research ? research.worldY + 0.5 : cmd.y;

  // Calculate travel time based on distance
  const dx = cmd.x - srcX, dy = cmd.y - srcY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const travelTicks = Math.max(1, Math.ceil(dist / FIREBALL_SPEED));

  // AoE telegraph ring at target — visible to all, lasts until impact
  state.abilityEffects.push({
    id: genId(state), type: 'demon_fireball_telegraph',
    playerId: player.id, team: player.team,
    x: cmd.x, y: cmd.y, radius,
    duration: travelTicks,
    data: { damage: totalDamage },
  });

  // In-flight fireball projectile
  state.abilityEffects.push({
    id: genId(state), type: 'demon_fireball_inbound',
    playerId: player.id, team: player.team,
    x: cmd.x, y: cmd.y, radius,
    duration: travelTicks + 2, // small buffer so explosion tick runs
    data: { curX: srcX, curY: srcY, damage: totalDamage, arrived: 0 },
  });

  addSound(state, 'ability_fireball', srcX, srcY);
}

function explodeFireball(state: GameState, eff: { playerId: number; team: Team; x?: number; y?: number; radius?: number; data?: Record<string, number> }): void {
  const targetX = eff.x!, targetY = eff.y!, radius = eff.radius ?? 6;
  const totalDamage = eff.data?.damage ?? 20;
  const fbPlayer = state.players[eff.playerId];
  const fbUpgrades = fbPlayer?.researchUpgrades;
  // Demon Siege Fire: +100% building damage
  const buildingDamageReduction = fbUpgrades?.raceUpgrades['demon_ability_3'] ? 0.45 : 0.3;
  const r2 = radius * radius;

  for (const u of state.units) {
    if (u.team === eff.team) continue;
    if ((u.x - targetX) ** 2 + (u.y - targetY) ** 2 > r2) continue;
    dealDamage(state, u, totalDamage, true, eff.playerId);
    const existing = u.statusEffects.find(s => s.type === StatusType.Burn);
    if (existing) { existing.stacks = Math.min(5, existing.stacks + 2); existing.duration = 3 * TICK_RATE; }
    else u.statusEffects.push({ type: StatusType.Burn, stacks: 2, duration: 3 * TICK_RATE });
  }

  for (const b of state.buildings) {
    if (b.buildGrid !== 'alley') continue;
    if (state.players[b.playerId]?.team === eff.team) continue;
    if ((b.worldX - targetX) ** 2 + (b.worldY - targetY) ** 2 > r2) continue;
    b.hp -= Math.round(totalDamage * buildingDamageReduction);
  }

  addFloatingText(state, targetX, targetY, `FIREBALL! (${totalDamage} dmg)`, '#ff4400');
  addSound(state, 'ability_fireball', targetX, targetY);
  addDeathParticles(state, targetX, targetY, '#ff4400', 12);
  addCombatEvent(state, { type: 'splash', x: targetX, y: targetY, radius, color: '#ff6600' });
  state.abilityEffects.push({
    id: genId(state), type: 'demon_fireball',
    playerId: eff.playerId, team: eff.team,
    x: targetX, y: targetY, radius,
    duration: Math.round(0.8 * TICK_RATE),
  });

  // Demon Scorched Earth: leave a burn area on the ground
  if (fbUpgrades?.raceUpgrades['demon_ability_2']) {
    state.abilityEffects.push({
      id: genId(state), type: 'demon_scorched_earth',
      playerId: eff.playerId, team: eff.team,
      x: targetX, y: targetY, radius: Math.round(radius * 0.6),
      duration: 6 * TICK_RATE,
      data: { damage: Math.max(3, Math.round(totalDamage * 0.08)) },
    });
  }
}

const SKULL_SPEED = 0.8; // tiles per tick (16 tiles/sec) — slower than fireball for dramatic effect

function geistsAbility(state: GameState, player: PlayerState, cmd: Extract<GameCommand, { type: 'use_ability' }>): void {
  if (cmd.x == null || cmd.y == null) return;
  const skeletonCount = 4 + player.abilityUseCount;
  const skeletonDuration = 15 * TICK_RATE;
  const lane = state.rng() < 0.5 ? Lane.Left : Lane.Right;
  const skelPath = getLanePath(player.team, lane, state.mapDef);
  const skelProgress = findNearestPathProgress(skelPath, cmd.x, cmd.y);

  // Launch skull projectile from HQ toward target
  const hq = getHQPosition(player.team, state.mapDef);
  const dx = cmd.x - hq.x, dy = cmd.y - hq.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const travelTicks = Math.max(1, Math.ceil(dist / SKULL_SPEED));

  // Black hole telegraph at target — visible to all
  state.abilityEffects.push({
    id: genId(state), type: 'geist_summon_telegraph',
    playerId: player.id, team: player.team,
    x: cmd.x, y: cmd.y, radius: 2,
    duration: travelTicks,
  });

  // In-flight skull projectile
  state.abilityEffects.push({
    id: genId(state), type: 'geist_summon_inbound',
    playerId: player.id, team: player.team,
    x: cmd.x, y: cmd.y, radius: 2,
    duration: travelTicks + 2,
    data: {
      curX: hq.x, curY: hq.y, arrived: 0,
      skeletonCount, skeletonDuration, laneIsLeft: lane === Lane.Left ? 1 : 0, pathProgress: skelProgress,
    },
  });

  addSound(state, 'ability_summon', hq.x, hq.y);
}

function spawnGeistSkeletons(state: GameState, eff: AbilityEffect): void {
  if (eff.x == null || eff.y == null || eff.data == null) return;
  const player = state.players[eff.playerId];
  const { skeletonCount, skeletonDuration, laneIsLeft, pathProgress } = eff.data;
  const lane = laneIsLeft ? Lane.Left : Lane.Right;
  const circleRadius = 2;

  for (let i = 0; i < skeletonCount; i++) {
    const angle = (i / skeletonCount) * Math.PI * 2;
    const sx = eff.x + Math.cos(angle) * circleRadius;
    const sy = eff.y + Math.sin(angle) * circleRadius;
    state.units.push({
      id: genId(state), type: 'Skeleton', playerId: player.id, team: player.team,
      x: sx, y: sy,
      hp: 60, maxHp: 60, damage: 18,
      attackSpeed: 1.2, attackTimer: 0, moveSpeed: 2.8, range: 1.5,
      targetId: null, lane, pathProgress, carryingDiamond: false,
      statusEffects: [], hitCount: 0, shieldHp: 0,
      category: 'melee', upgradeTier: 0, upgradeNode: 'A',
      upgradeSpecial: { lifestealPct: 0.15 }, kills: 0, damageDone: 0, healingDone: 0, buffsApplied: 0, lastDamagedByName: '', spawnTick: state.tick,
      summonDuration: skeletonDuration,
    });
  }
  // Geists Bone Archers: also spawn 3 skeleton archers
  if (player.researchUpgrades.raceUpgrades['geists_ability_1']) {
    for (let ai = 0; ai < 3; ai++) {
      const aAngle = (ai / 3) * Math.PI * 2 + Math.PI / 6;
      const ax = eff.x + Math.cos(aAngle) * (circleRadius + 0.5);
      const ay = eff.y + Math.sin(aAngle) * (circleRadius + 0.5);
      state.units.push({
        id: genId(state), type: 'Skeleton Archer', playerId: player.id, team: player.team,
        x: ax, y: ay,
        hp: 40, maxHp: 40, damage: 14,
        attackSpeed: 1.4, attackTimer: 0, moveSpeed: 2.5, range: 6,
        targetId: null, lane, pathProgress, carryingDiamond: false,
        statusEffects: [], hitCount: 0, shieldHp: 0,
        category: 'ranged', upgradeTier: 0, upgradeNode: 'A',
        upgradeSpecial: { lifestealPct: 0.10 }, kills: 0, damageDone: 0, healingDone: 0, buffsApplied: 0, lastDamagedByName: '', spawnTick: state.tick,
        summonDuration: skeletonDuration,
      });
    }
  }
  addFloatingText(state, eff.x, eff.y, 'RISE!', '#ce93d8');
  addSound(state, 'ability_summon', eff.x, eff.y);
  addCombatEvent(state, { type: 'pulse', x: eff.x, y: eff.y, radius: circleRadius, color: '#ce93d8' });
}

function goblinsAbility(state: GameState, player: PlayerState, cmd: Extract<GameCommand, { type: 'use_ability' }>): void {
  // Place a potion shop in the tower alley
  const slot = (cmd.gridX != null && cmd.gridY != null) ? { gx: cmd.gridX, gy: cmd.gridY } : findOpenAlleySlot(state, player);
  if (!slot) return;
  const origin = getTeamAlleyOrigin(player.team, state.mapDef);
  const world = { x: origin.x + slot.gx, y: origin.y + slot.gy };
  state.buildings.push({
    id: genId(state), type: BuildingType.Tower, playerId: player.id, buildGrid: 'alley',
    gridX: slot.gx, gridY: slot.gy, worldX: world.x, worldY: world.y,
    lane: Lane.Left,
    hp: 100, maxHp: 100, actionTimer: 10 * TICK_RATE, placedTick: state.tick, upgradePath: [],
    isPotionShop: true,
  });
  addFloatingText(state, world.x, world.y, 'POTION SHOP', '#69f0ae');
  addSound(state, 'building_placed', world.x, world.y);
}

function oozlingsAbility(state: GameState, player: PlayerState, cmd: Extract<GameCommand, { type: 'use_ability' }>): void {
  // Place a globule building in the tower alley (spawns extra oozlings)
  const slot = (cmd.gridX != null && cmd.gridY != null) ? { gx: cmd.gridX, gy: cmd.gridY } : findOpenAlleySlot(state, player);
  if (!slot) return;
  const origin = getTeamAlleyOrigin(player.team, state.mapDef);
  const world = { x: origin.x + slot.gx, y: origin.y + slot.gy };
  state.buildings.push({
    id: genId(state), type: BuildingType.Tower, playerId: player.id, buildGrid: 'alley',
    gridX: slot.gx, gridY: slot.gy, worldX: world.x, worldY: world.y,
    lane: Lane.Left,
    hp: 150, maxHp: 150, actionTimer: 0, placedTick: state.tick, upgradePath: [],
    isGlobule: true,
  });
  addFloatingText(state, world.x, world.y, 'GLOBULE', '#69f0ae');
  addSound(state, 'building_placed', world.x, world.y);
}

export const SEED_GROW_TIMES = [30 * TICK_RATE, 60 * TICK_RATE, 120 * TICK_RATE]; // T1=30s, T2=60s, T3=120s

function tendersAbility(state: GameState, player: PlayerState, cmd: Extract<GameCommand, { type: 'use_ability' }>): void {
  const slot = (cmd.gridX != null && cmd.gridY != null) ? { gx: cmd.gridX, gy: cmd.gridY } : findOpenAlleySlot(state, player);
  if (!slot) return;

  // Check for existing seed to upgrade
  const existing = state.buildings.find(b =>
    b.isSeed && b.buildGrid === 'alley' && b.gridX === slot.gx && b.gridY === slot.gy &&
    (state.players[b.playerId]?.team ?? -1) === player.team
  );

  if (existing) {
    // Upgrade existing seed to next tier, preserving elapsed time
    const oldTier = existing.seedTier ?? 0;
    const newTier = oldTier + 1;
    if (newTier > 2) return; // already T3
    const elapsed = SEED_GROW_TIMES[oldTier] - (existing.seedTimer ?? 0);
    existing.seedTier = newTier;
    existing.seedTimer = Math.max(0, SEED_GROW_TIMES[newTier] - elapsed);
    const tierLabel = ['T2', 'T3'][newTier - 1];
    addFloatingText(state, existing.worldX, existing.worldY, `SEED → ${tierLabel}`, '#ffd740');
    addSound(state, 'building_placed', existing.worldX, existing.worldY);
  } else {
    // Plant a new T1 seed
    const origin = getTeamAlleyOrigin(player.team, state.mapDef);
    const world = { x: origin.x + slot.gx, y: origin.y + slot.gy };
    const growTime = SEED_GROW_TIMES[0];
    state.buildings.push({
      id: genId(state), type: BuildingType.Tower, playerId: player.id, buildGrid: 'alley',
      gridX: slot.gx, gridY: slot.gy, worldX: world.x, worldY: world.y,
      lane: Lane.Left,
      hp: 50, maxHp: 50, actionTimer: growTime, placedTick: state.tick, upgradePath: [],
      isSeed: true, seedTimer: growTime, seedTier: 0,
    });
    addFloatingText(state, world.x, world.y, 'SEED PLANTED', '#81c784');
    addSound(state, 'building_placed', world.x, world.y);
  }
}

function tickAbilityEffects(state: GameState): void {
  // Tick cooldowns + Tenders seed stack accumulation
  for (const p of state.players) {
    if (p.isEmpty) continue;
    if (p.race === Race.Tenders) {
      // Stack-based: accumulate seeds on cooldown (max 10)
      if (p.abilityStacks < 10) {
        if (p.abilityCooldown > 0) {
          p.abilityCooldown--;
        } else {
          // Grant a stack and reset cooldown
          p.abilityStacks++;
          if (p.abilityStacks < 10) {
            let seedCd = RACE_ABILITY_DEFS[Race.Tenders].baseCooldownTicks;
            // Tenders Quick Seeds: -40% cooldown
            if (p.researchUpgrades.raceUpgrades['tenders_ability_2']) seedCd = Math.round(seedCd * 0.7);
            p.abilityCooldown = seedCd;
          }
        }
      }
    } else {
      if (p.abilityCooldown > 0) p.abilityCooldown--;
    }
  }

  // Clear aura bonuses each tick (recalculated below)
  for (const u of state.units) {
    if (u.hp <= 0) continue;
    u.upgradeSpecial._auraDmg = 0;
    u.upgradeSpecial._auraSpd = 0;
    u.upgradeSpecial._auraArmor = 0;
  }

  // Tick summon durations (temporary units like Geist skeletons)
  for (const u of state.units) {
    if (u.summonDuration != null) {
      u.summonDuration--;
      if (u.summonDuration <= 0) {
        u.hp = 0; // kill the summon
        addDeathParticles(state, u.x, u.y, '#ce93d8', 3);
      }
    }
    // Horde auras: apply buffs to nearby allies (within 5 tiles)
    // Same aura type doesn't stack — uses Math.max so only the strongest applies
    // Different aura types DO combine (damage + speed + armor from different units)
    const sp = u.upgradeSpecial;
    if (u.hp > 0 && (sp?.auraDamageBonus || sp?.auraSpeedBonus || sp?.auraArmorBonus)) {
      // Horde: Wide Aura — double aura range
      const auraOwner = state.players[u.playerId];
      const auraRange = (auraOwner?.researchUpgrades.raceUpgrades['horde_ability_3']) ? 10 : 5;
      const ar2 = auraRange * auraRange;
      for (const ally of state.units) {
        if (ally.id === u.id || ally.team !== u.team || ally.hp <= 0) continue;
        if ((ally.x - u.x) ** 2 + (ally.y - u.y) ** 2 > ar2) continue;
        ally.upgradeSpecial._auraDmg = Math.max(ally.upgradeSpecial._auraDmg ?? 0, sp.auraDamageBonus ?? 0);
        ally.upgradeSpecial._auraSpd = Math.max(ally.upgradeSpecial._auraSpd ?? 0, sp.auraSpeedBonus ?? 0);
        ally.upgradeSpecial._auraArmor = Math.max(ally.upgradeSpecial._auraArmor ?? 0, sp.auraArmorBonus ?? 0);
      }
    }
  }

  // Tick special buildings (foundries, potion shops, seeds)
  if (state.tick % TICK_RATE === 0) {
    for (const b of state.buildings) {
      if (b.hp <= 0) continue;

      // Crown foundry: +1 gold per second per foundry
      if (b.isFoundry) {
        const owner = state.players[b.playerId];
        if (owner && !owner.isEmpty) {
          owner.gold += 1;
          if (state.playerStats[b.playerId]) state.playerStats[b.playerId].totalGoldEarned += 1;
        }
      }

      // Tenders passive hut: cycle through gold → wood → meat, +1 each on a timer
      if (b.type === BuildingType.HarvesterHut) {
        const owner = state.players[b.playerId];
        if (owner && !owner.isEmpty && owner.race === Race.Tenders) {
          // Deliver resources every 3 seconds, cycling gold → wood → meat
          // Each delivery gives +3 of one resource type, then rotates
          // Rate: ~1/sec of each type across the cycle (comparable to a harvester)
          const deliveryInterval = 3 * TICK_RATE;
          const elapsed = state.tick - b.placedTick;
          if (elapsed > 0 && elapsed % deliveryInterval === 0) {
            const deliveryNum = Math.floor(elapsed / deliveryInterval);
            const cycle = deliveryNum % 3;
            const amt = 3;
            if (cycle === 0) {
              owner.gold += amt;
              if (state.playerStats[b.playerId]) state.playerStats[b.playerId].totalGoldEarned += amt;
              addFloatingText(state, b.worldX, b.worldY - 0.3, `+${amt}`, '#ffd700', 'gold');
            } else if (cycle === 1) {
              owner.wood += amt;
              if (state.playerStats[b.playerId]) state.playerStats[b.playerId].totalWoodEarned += amt;
              addFloatingText(state, b.worldX, b.worldY - 0.3, `+${amt}`, '#4caf50', 'wood');
            } else {
              owner.stone += amt;
              if (state.playerStats[b.playerId]) state.playerStats[b.playerId].totalStoneEarned += amt;
              addFloatingText(state, b.worldX, b.worldY - 0.3, `+${amt}`, '#e57373', 'meat');
            }
          }
        }
      }

      // Goblin potion shop: periodically toss a random potion onto a nearby empty tile
      if (b.isPotionShop) {
        b.actionTimer = (b.actionTimer ?? 0) - TICK_RATE;
        if (b.actionTimer <= 0) {
          const potionOwner = state.players[b.playerId];
          const quickBrew = potionOwner?.researchUpgrades.raceUpgrades['goblins_ability_1'];
          b.actionTimer = quickBrew ? 6 * TICK_RATE : 8 * TICK_RATE; // Quick Brew: 33% faster
          const owner = state.players[b.playerId];
          if (owner && !owner.isEmpty) {
            // Pick random tile within 3-6 tiles of the shop
            const angle = state.rng() * Math.PI * 2;
            const dist = 3 + state.rng() * 3;
            const dropX = b.worldX + Math.cos(angle) * dist;
            const dropY = b.worldY + Math.sin(angle) * dist;
            // Pick random potion type
            const roll = state.rng();
            const potionType: PotionType = roll < 0.33 ? 'speed' : roll < 0.66 ? 'rage' : 'shield';
            const flightDist = Math.hypot(dropX - b.worldX, dropY - b.worldY);
            const flightTicks = Math.round(Math.max(8, flightDist * 2.5)); // ~0.4-0.75s arc
            state.potionDrops.push({
              id: genId(state),
              x: dropX, y: dropY,
              srcX: b.worldX + 0.5, srcY: b.worldY,
              type: potionType,
              team: owner.team,
              flightTicks,
              flightProgress: 0,
              remainingTicks: 30 * TICK_RATE, // despawn after 30 seconds
            });
          }
        }
      }

      // Oozlings globule: periodically spawn an extra oozling
      if (b.isGlobule) {
        b.actionTimer = (b.actionTimer ?? 0) + TICK_RATE;
        if (b.actionTimer >= 12 * TICK_RATE) { // every 12 seconds
          b.actionTimer = 0;
          const owner = state.players[b.playerId];
          if (owner && !owner.isEmpty) {
            // Determine spawn type based on upgrades
            const gbu = owner.researchUpgrades;
            let spawnType: BuildingType = BuildingType.MeleeSpawner;
            let spawnCat: 'melee' | 'ranged' | 'caster' = 'melee';
            const roll = state.rng();
            if (gbu.raceUpgrades['oozlings_ability_1'] && gbu.raceUpgrades['oozlings_ability_2']) {
              // Both: 25% ranged, 25% caster, 50% melee
              if (roll < 0.25) { spawnType = BuildingType.RangedSpawner; spawnCat = 'ranged'; }
              else if (roll < 0.50) { spawnType = BuildingType.CasterSpawner; spawnCat = 'caster'; }
            } else if (gbu.raceUpgrades['oozlings_ability_1']) {
              if (roll < 0.25) { spawnType = BuildingType.RangedSpawner; spawnCat = 'ranged'; }
            } else if (gbu.raceUpgrades['oozlings_ability_2']) {
              if (roll < 0.25) { spawnType = BuildingType.CasterSpawner; spawnCat = 'caster'; }
            }
            const stats = UNIT_STATS[owner.race]?.[spawnType];
            if (stats) {
              for (let si = 0; si < 2; si++) {
                const lane = si === 0 ? Lane.Left : Lane.Right;
                const gPath = getLanePath(owner.team, lane, state.mapDef);
                const gProg = findNearestPathProgress(gPath, b.worldX, b.worldY);
                state.units.push({
                  id: genId(state), type: stats.name, playerId: b.playerId, team: owner.team,
                  x: b.worldX + (si * 0.3), y: b.worldY,
                  hp: stats.hp, maxHp: stats.hp, damage: stats.damage,
                  attackSpeed: stats.attackSpeed, attackTimer: 0, moveSpeed: stats.moveSpeed, range: stats.range,
                  targetId: null, lane, pathProgress: gProg, carryingDiamond: false,
                  statusEffects: [], hitCount: 0, shieldHp: 0, category: spawnCat,
                  upgradeTier: 0, upgradeNode: 'A', upgradeSpecial: {},
                  kills: 0, damageDone: 0, healingDone: 0, buffsApplied: 0, lastDamagedByName: '', spawnTick: state.tick,
                });
              }
              addSound(state, 'unit_spawn', b.worldX, b.worldY);
            }
          }
        }
      }

      // Tenders seed: count down and spawn a random unit when ready
      if (b.isSeed && b.seedTimer != null) {
        // Tenders Fast Growth: seeds grow 40% faster
        const seedOwner = state.players[b.playerId];
        const growthRate = (seedOwner?.researchUpgrades.raceUpgrades['tenders_ability_1']) ? Math.round(TICK_RATE * 1.4) : TICK_RATE;
        b.seedTimer -= growthRate;
        if (b.seedTimer <= 0) {
          const owner = seedOwner;
          if (owner && !owner.isEmpty) {
            // Pop into a random unit from any race
            const allRaces = [Race.Crown, Race.Horde, Race.Goblins, Race.Oozlings, Race.Demon, Race.Deep, Race.Wild, Race.Geists, Race.Tenders];
            const categories: ('melee' | 'ranged' | 'caster')[] = ['melee', 'ranged', 'caster'];
            const cat = categories[Math.floor(state.rng() * categories.length)];
            const seedRace = allRaces[Math.floor(state.rng() * allRaces.length)];
            const btMap: Record<string, BuildingType> = { melee: BuildingType.MeleeSpawner, ranged: BuildingType.RangedSpawner, caster: BuildingType.CasterSpawner };
            const stats = UNIT_STATS[seedRace]?.[btMap[cat]];
            if (stats) {
              const tier = b.seedTier ?? 0;
              // Stat multiplier per tier: T1=1x, T2=1.5x, T3=2.2x
              const tierMult = [1, 1.5, 2.2][tier];
              const lane = state.rng() < 0.5 ? Lane.Left : Lane.Right;
              const seedPath = getLanePath(owner.team, lane, state.mapDef);
              const seedProg = findNearestPathProgress(seedPath, b.worldX, b.worldY);
              state.units.push({
                id: genId(state), type: stats.name, playerId: b.playerId, team: owner.team,
                x: b.worldX, y: b.worldY,
                hp: Math.max(1, Math.round(stats.hp * tierMult)),
                maxHp: Math.max(1, Math.round(stats.hp * tierMult)),
                damage: Math.max(1, Math.round(stats.damage * tierMult)),
                attackSpeed: stats.attackSpeed, attackTimer: 0, moveSpeed: stats.moveSpeed, range: stats.range,
                targetId: null, lane, pathProgress: seedProg, carryingDiamond: false,
                statusEffects: [], hitCount: 0, shieldHp: 0, category: cat,
                upgradeTier: tier, upgradeNode: 'A', upgradeSpecial: {},
                kills: 0, damageDone: 0, healingDone: 0, buffsApplied: 0, lastDamagedByName: '', spawnTick: state.tick,
              });
              const tierLabel = tier > 0 ? ` T${tier + 1}` : '';
              addFloatingText(state, b.worldX, b.worldY, `${stats.name}${tierLabel}!`, '#81c784');
              addSound(state, 'unit_spawn', b.worldX, b.worldY);
            }
            // Tenders Reseed: 30% chance to replant a T1 seed when one pops
            if (owner.researchUpgrades.raceUpgrades['tenders_ability_3'] && state.rng() < 0.3) {
              b.seedTimer = SEED_GROW_TIMES[0];
              b.seedTier = 0;
              b.hp = 50;
              b.maxHp = 50;
              addFloatingText(state, b.worldX, b.worldY, 'RESEED!', '#a5d6a7');
            } else {
              // Remove the seed building
              b.hp = 0;
            }
          } else {
            b.hp = 0;
          }
        }
      }
    }
  }

  // Tick active effects
  for (let i = state.abilityEffects.length - 1; i >= 0; i--) {
    const eff = state.abilityEffects[i];
    eff.duration--;

    // Per-tick effect logic
    if (eff.type === 'deep_rain') {
      const deepPlayer = state.players[eff.playerId];
      const deepBu = deepPlayer?.researchUpgrades;
      const crushingRain = deepBu?.raceUpgrades['deep_ability_1'];
      const healingRain = deepBu?.raceUpgrades['deep_ability_2'];
      const isSecondTick = state.tick % TICK_RATE === 0; // once per second for damage/heal
      for (const u of state.units) {
        if (u.hp <= 0) continue;
        const unitRace = state.players[u.playerId]?.race;
        if (u.team === eff.team && unitRace === Race.Deep) {
          // Deep allies: Haste (move faster)
          const haste = u.statusEffects.find(s => s.type === StatusType.Haste);
          if (haste) { haste.duration = Math.max(haste.duration, TICK_RATE); }
          else u.statusEffects.push({ type: StatusType.Haste, stacks: 1, duration: TICK_RATE });
          // Healing Rain: heal Deep allies 5 HP/sec
          if (healingRain && isSecondTick) {
            const healed = healUnit(u, 5);
            if (healed > 0) trackHealing(state, u, healed);
          }
        } else if (unitRace !== Race.Deep) {
          // Non-Deep units: Slow (move slower)
          const slow = u.statusEffects.find(s => s.type === StatusType.Slow);
          if (slow) { slow.duration = Math.max(slow.duration, TICK_RATE); }
          else u.statusEffects.push({ type: StatusType.Slow, stacks: 1, duration: TICK_RATE });
          // Crushing Rain: deal 3 dmg/sec to enemies
          if (crushingRain && isSecondTick && u.team !== eff.team) {
            dealDamage(state, u, 3, false, eff.playerId);
          }
        }
      }
    } else if (eff.type === 'demon_fireball_inbound' && eff.x != null && eff.y != null && eff.data != null) {
      if (eff.data.arrived === 0) {
        const curX = eff.data.curX, curY = eff.data.curY;
        const dx = eff.x - curX, dy = eff.y - curY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= FIREBALL_SPEED) {
          // Arrived — trigger explosion
          eff.data.arrived = 1;
          explodeFireball(state, eff);
          eff.duration = 0;
        } else {
          // Advance toward target
          const f = FIREBALL_SPEED / dist;
          eff.data.curX = curX + dx * f;
          eff.data.curY = curY + dy * f;
        }
      }
    } else if (eff.type === 'geist_summon_inbound' && eff.x != null && eff.y != null && eff.data != null) {
      if (eff.data.arrived === 0) {
        const curX = eff.data.curX, curY = eff.data.curY;
        const dx = eff.x - curX, dy = eff.y - curY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= SKULL_SPEED) {
          eff.data.arrived = 1;
          spawnGeistSkeletons(state, eff);
          eff.duration = 0;
        } else {
          const f = SKULL_SPEED / dist;
          eff.data.curX = curX + dx * f;
          eff.data.curY = curY + dy * f;
        }
      }
    } else if (eff.type === 'wild_frenzy') {
      // Apply haste + frenzy (damage buff) to allies in radius
      if (eff.x != null && eff.y != null && eff.radius != null) {
        const r2 = eff.radius * eff.radius;
        for (const u of state.units) {
          if (u.team !== eff.team) continue;
          if ((u.x - eff.x) ** 2 + (u.y - eff.y) ** 2 > r2) continue;
          // Haste
          const haste = u.statusEffects.find(s => s.type === StatusType.Haste);
          if (haste) { haste.duration = Math.max(haste.duration, TICK_RATE); }
          else u.statusEffects.push({ type: StatusType.Haste, stacks: 1, duration: TICK_RATE });
          // Frenzy (+50% damage)
          const frenzy = u.statusEffects.find(s => s.type === StatusType.Frenzy);
          if (frenzy) { frenzy.duration = Math.max(frenzy.duration, TICK_RATE); }
          else u.statusEffects.push({ type: StatusType.Frenzy, stacks: 1, duration: TICK_RATE });
        }
      }
    } else if (eff.type === 'demon_scorched_earth') {
      // Burn ground: deal damage every second to enemies in area
      if (eff.x != null && eff.y != null && eff.radius != null && state.tick % TICK_RATE === 0) {
        const seR2 = (eff.radius ?? 3) * (eff.radius ?? 3);
        const seDmg = eff.data?.damage ?? 3;
        for (const u of state.units) {
          if (u.team === eff.team || u.hp <= 0) continue;
          if ((u.x - eff.x) ** 2 + (u.y - eff.y) ** 2 > seR2) continue;
          dealDamage(state, u, seDmg, false, eff.playerId);
          const burn = u.statusEffects.find(s => s.type === StatusType.Burn);
          if (burn) { burn.duration = Math.max(burn.duration, TICK_RATE); }
          else u.statusEffects.push({ type: StatusType.Burn, stacks: 1, duration: TICK_RATE });
        }
      }
    }

    if (eff.duration <= 0) {
      state.abilityEffects.splice(i, 1);
    }
  }
}

// === Death resource tracking (called from combat cleanup) ===

function trackDeathResources(state: GameState, deadUnit: UnitState): void {
  // Geists: souls from ANY death, with probability scaling for higher player counts.
  // In 1v1 (2 players): 100% chance per death. In 4v4 (8 players): ~38% chance per death.
  // Net effect: soul income scales ~1.5x from 1v1 to 4v4 instead of 4x.
  const activePlayers = state.players.reduce((c, pl) => c + (pl.isEmpty ? 0 : 1), 0);
  const soulChance = activePlayers <= 2 ? 1 : 2 * (1 + (activePlayers - 2) / 12) / activePlayers;
  for (const p of state.players) {
    if (p.isEmpty || p.race !== Race.Geists) continue;
    if (soulChance < 1 && state.rng() >= soulChance) continue;
    p.souls++;
    // Show floating text at death location (throttle: only every 3rd soul to reduce spam)
    if (p.souls % 3 === 0) {
      addFloatingText(state, deadUnit.x, deadUnit.y - 0.5, '+3', '#ce93d8', 'souls', undefined, { ownerOnly: p.id });
    }
  }

  // Oozlings: death essence from own oozling deaths
  const owner = state.players[deadUnit.playerId];
  if (owner && owner.race === Race.Oozlings) {
    owner.deathEssence++;
    addFloatingText(state, deadUnit.x, deadUnit.y - 0.5, '+1', '#69f0ae', 'ooze', undefined, { ownerOnly: deadUnit.playerId });
  }

  // Geists caster: chance to summon mini-skeleton from nearby deaths
  const summonRange = 8;
  for (const caster of state.units) {
    if (caster.hp <= 0 || caster.category !== 'caster') continue;
    if (state.players[caster.playerId]?.race !== Race.Geists) continue;
    let chance = caster.upgradeSpecial?.skeletonSummonChance ?? 0;
    // Research: Undying Will — +15% skeleton summon chance
    const geistsResearch = state.players[caster.playerId]?.researchUpgrades;
    if (geistsResearch?.raceUpgrades['geists_caster_2']) chance += 0.15;
    if (chance <= 0) continue;
    const dx = deadUnit.x - caster.x, dy = deadUnit.y - caster.y;
    if (dx * dx + dy * dy > summonRange * summonRange) continue;
    if (state.rng() < chance) {
      const lane = state.rng() < 0.5 ? Lane.Left : Lane.Right;
      const msPath = getLanePath(caster.team, lane, state.mapDef);
      const msProg = findNearestPathProgress(msPath, deadUnit.x, deadUnit.y);
      // Geists Empowered Minions: +5 damage, +25% move speed
      const empowered = geistsResearch?.raceUpgrades['geists_ability_2'];
      const miniDmg = empowered ? 13 : 8;
      const miniSpd = empowered ? 4.0 : 3.2;
      state.units.push({
        id: genId(state), type: 'Mini Skeleton', playerId: caster.playerId, team: caster.team,
        x: deadUnit.x, y: deadUnit.y,
        hp: 30, maxHp: 30, damage: miniDmg,
        attackSpeed: 1.0, attackTimer: 0, moveSpeed: miniSpd, range: 1.5,
        targetId: null, lane, pathProgress: msProg, carryingDiamond: false,
        statusEffects: [], hitCount: 0, shieldHp: 0,
        category: 'melee', upgradeTier: 0, upgradeNode: 'A',
        upgradeSpecial: {}, kills: 0, damageDone: 0, healingDone: 0, buffsApplied: 0, lastDamagedByName: '', spawnTick: state.tick,
        summonDuration: 10 * TICK_RATE,
      });
      addDeathParticles(state, deadUnit.x, deadUnit.y, '#b39ddb', 2);
    }
  }

  // Geist Soul Gorger: gain soul stacks from any nearby death (friend or foe)
  for (const gorger of state.units) {
    if (gorger.hp <= 0 || gorger.id === deadUnit.id) continue;
    if (!gorger.upgradeSpecial?.soulHarvest) continue;
    const maxStacks = gorger.upgradeSpecial.soulMaxStacks ?? 20;
    const stacks = gorger.soulStacks ?? 0;
    if (stacks >= maxStacks) continue;
    const harvestR = gorger.upgradeSpecial.soulHarvestRadius ?? 8;
    const dx = deadUnit.x - gorger.x, dy = deadUnit.y - gorger.y;
    if (dx * dx + dy * dy > harvestR * harvestR) continue;
    gorger.soulStacks = stacks + 1;
    // Store original base stats on first stack (avoids rounding drift)
    if (stacks === 0) {
      gorger.upgradeSpecial = { ...gorger.upgradeSpecial, _baseDmg: gorger.damage, _baseMaxHp: gorger.maxHp };
    }
    // +4% damage and +4% maxHP per stack, computed from original base
    const baseDmg = gorger.upgradeSpecial._baseDmg ?? gorger.damage;
    gorger.damage = Math.round(baseDmg * (1 + 0.04 * (stacks + 1)));
    const baseMaxHp = gorger.upgradeSpecial._baseMaxHp ?? gorger.maxHp;
    const newMaxHp = Math.round(baseMaxHp * (1 + 0.04 * (stacks + 1)));
    const hpGain = newMaxHp - gorger.maxHp;
    gorger.maxHp = newMaxHp;
    gorger.hp = Math.min(gorger.maxHp, gorger.hp + hpGain); // heal the gained HP
    addFloatingText(state, gorger.x, gorger.y - 0.5, `Soul ${stacks + 1}`, '#ce93d8', undefined, undefined,
      { ftType: 'status' });
    addDeathParticles(state, gorger.x, gorger.y, '#ce93d8', 2);
  }

  // Oozlings baneling: explode on death dealing AoE damage
  if (deadUnit.upgradeSpecial?.explodeOnDeath) {
    const dmg = deadUnit.upgradeSpecial.explodeDamage ?? 30;
    const radius = deadUnit.upgradeSpecial.explodeRadius ?? 3;
    const r2 = radius * radius;
    const burnStacks = deadUnit.upgradeSpecial.extraBurnStacks ?? 0;
    for (const u of state.units) {
      if (u.team === deadUnit.team || u.hp <= 0) continue;
      if ((u.x - deadUnit.x) ** 2 + (u.y - deadUnit.y) ** 2 > r2) continue;
      dealDamage(state, u, dmg, true, deadUnit.playerId);
      if (burnStacks > 0) applyStatus(u, StatusType.Burn, burnStacks);
    }
    addDeathParticles(state, deadUnit.x, deadUnit.y, '#7c4dff', 8);
    addFloatingText(state, deadUnit.x, deadUnit.y, `${dmg}`, '#7c4dff', undefined, undefined,
      { ftType: 'damage', magnitude: dmg, miniIcon: 'fire' });
    addSound(state, 'nuke_detonated', deadUnit.x, deadUnit.y);
  }
}

const NUKE_TEAM_COOLDOWN_TICKS = 11 * TICK_RATE; // 11s team-wide cooldown between nukes (10% slower)

function fireNuke(state: GameState, cmd: Extract<GameCommand, { type: 'fire_nuke' }>): void {
  const player = state.players[cmd.playerId];
  if (!player.nukeAvailable) return;

  // 60-second match lockout — nukes disabled for the first minute
  if (state.tick < 60 * TICK_RATE) return;

  // Team-wide nuke cooldown — prevent stacking
  const team = player.team;
  if (state.nukeTeamCooldown[team] > 0) return;

  // Nukes can only land within your team's allowed nuke zone (own 40% of map)
  const nukeZone = state.mapDef.nukeZone[team];
  const nukeAxis = state.mapDef.shapeAxis === 'x' ? cmd.x : cmd.y;
  if (nukeAxis < nukeZone.min || nukeAxis > nukeZone.max) return;

  player.nukeAvailable = false;
  state.nukeTeamCooldown[team] = NUKE_TEAM_COOLDOWN_TICKS;

  // 1.25 second telegraph before detonation.
  // Radius intentionally set to 16 for large-teamfight impact.
  state.nukeTelegraphs.push({
    x: cmd.x, y: cmd.y,
    radius: NUKE_RADIUS,
    playerId: cmd.playerId,
    timer: Math.round(1.25 * TICK_RATE),
  });
  addSound(state, 'nuke_incoming', cmd.x, cmd.y);
}

function addPing(state: GameState, cmd: Extract<GameCommand, { type: 'ping' }>): void {
  const player = state.players[cmd.playerId];
  if (!player) return;
  state.pings.push({
    id: genId(state),
    playerId: cmd.playerId,
    team: player.team,
    x: cmd.x,
    y: cmd.y,
    age: 0,
    maxAge: 3 * TICK_RATE,
  });
}

function addQuickChat(state: GameState, cmd: Extract<GameCommand, { type: 'quick_chat' }>): void {
  const player = state.players[cmd.playerId];
  if (!player) return;
  const text = cmd.message.trim();
  if (!text) return;
  state.quickChats.push({
    id: genId(state),
    playerId: cmd.playerId,
    team: player.team,
    message: text.slice(0, 36),
    age: 0,
    maxAge: 4 * TICK_RATE,
  });
  if (state.quickChats.length > 6) state.quickChats.shift();
}

function concedeMatch(state: GameState, cmd: Extract<GameCommand, { type: 'concede' }>): void {
  if (state.matchPhase === 'ended') return;
  const player = state.players[cmd.playerId];
  if (!player) return;
  const enemyTeam = player.team === Team.Bottom ? Team.Top : Team.Bottom;
  state.winner = enemyTeam;
  state.winCondition = 'concede';
  state.matchPhase = 'ended';
  const humanPlayer = state.players.find(p => !p.isBot);
  const humanTeam = humanPlayer?.team ?? Team.Bottom;
  addSound(state, humanTeam === enemyTeam ? 'match_end_win' : 'match_end_lose');
}

function dropDiamond(state: GameState, x: number, y: number): void {
  state.diamond.state = 'dropped';
  state.diamond.x = x;
  state.diamond.y = y;
  state.diamond.carrierId = null;
  state.diamond.carrierType = null;
}

function resetDiamondForRespawn(state: GameState): void {
  state.diamond.state = 'respawning';
  state.diamond.x = state.mapDef.diamondCenter.x;
  state.diamond.y = state.mapDef.diamondCenter.y;
  state.diamond.carrierId = null;
  state.diamond.carrierType = null;
  state.diamond.mineProgress = 0;
  state.diamond.respawnTimer = DIAMOND_RESPAWN_TICKS;
  state.diamond.deliveries++;
}

// Race-specific champion sprite: category + upgradeNode to look up the right sprite
const CHAMPION_SPRITE: Record<Race, { category: UnitState['category']; node: string }> = {
  [Race.Crown]:    { category: 'melee',  node: 'G' },  // Champion (King Human)
  [Race.Horde]:    { category: 'melee',  node: 'A' },  // Brute (base melee)
  [Race.Goblins]:  { category: 'melee',  node: 'E' },  // Troll Warlord
  [Race.Oozlings]: { category: 'caster', node: 'A' },  // Bloater (base caster)
  [Race.Demon]:    { category: 'caster', node: 'A' },  // Overlord (base caster)
  [Race.Deep]:     { category: 'melee',  node: 'A' },  // Shell Guard (base melee)
  [Race.Wild]:     { category: 'melee',  node: 'D' },  // Minotaur
  [Race.Geists]:   { category: 'melee',  node: 'D' },  // Death Knight (base melee at D)
  [Race.Tenders]:  { category: 'melee',  node: 'D' },  // Elder Ent
};

function spawnDiamondChampion(state: GameState, team: Team, x: number, y: number, playerId: number): void {
  const scale = 1 + CHAMPION_SCALE_PER_DELIVERY * state.diamond.deliveries;
  const hp = Math.round(CHAMPION_BASE_HP * scale);
  const dmg = Math.round(CHAMPION_BASE_DAMAGE * scale);
  const lane = state.rng() < 0.5 ? Lane.Left : Lane.Right;
  const race = state.players[playerId].race;
  const champ = CHAMPION_SPRITE[race];
  state.units.push({
    id: genId(state),
    type: 'Diamond Champion',
    playerId,
    team,
    x, y,
    hp, maxHp: hp,
    damage: dmg,
    attackSpeed: CHAMPION_ATTACK_SPEED,
    attackTimer: 0,
    moveSpeed: CHAMPION_MOVE_SPEED,
    range: CHAMPION_RANGE,
    targetId: null,
    lane,
    pathProgress: -1,
    carryingDiamond: false,
    statusEffects: [],
    hitCount: 0,
    shieldHp: 0,
    category: champ.category,
    upgradeTier: 0,
    upgradeNode: champ.node,
    upgradeSpecial: {},
    kills: 0, damageDone: 0, healingDone: 0, buffsApplied: 0,
    lastDamagedByName: '',
    spawnTick: state.tick,
    nukeImmune: true,
    isChampion: true,
  });
  addSound(state, 'diamond_carried', x, y);
  addFloatingText(state, x, y, 'CHAMPION!', '#00ffff');
}

function dropWoodPile(state: GameState, x: number, y: number, amount: number, angleSeed = 0): void {
  if (amount <= 0) return;
  const angle = (angleSeed * 1.61803398875 + state.tick * 0.11) % (Math.PI * 2);
  const ring = 1.2 + ((angleSeed * 0.73) % 1) * WOOD_PILE_SPREAD_RADIUS;
  const pile = {
    id: genId(state),
    x: x + Math.cos(angle) * ring,
    y: y + Math.sin(angle) * ring * 0.65,
    amount,
  };
  clampToArenaBounds(pile, 0.35, state.mapDef);
  state.woodPiles.push(pile);
}

// Scratch buffer for collectWoodPiles — avoids per-call allocations
const _woodScratch: { pile: WoodPileState; index: number; dist: number }[] = [];
function collectWoodPiles(state: GameState, x: number, y: number, desiredAmount: number): number {
  if (desiredAmount <= 0) return 0;
  _woodScratch.length = 0;
  for (let i = 0; i < state.woodPiles.length; i++) {
    const pile = state.woodPiles[i];
    const dist = Math.hypot(pile.x - x, pile.y - y);
    if (dist <= WOOD_PICKUP_RADIUS) _woodScratch.push({ pile, index: i, dist });
  }
  _woodScratch.sort((a, b) => a.dist - b.dist || a.pile.id - b.pile.id);
  const nearby = _woodScratch;

  let gathered = 0;
  const remove = new Set();
  for (const entry of nearby) {
    if (gathered >= desiredAmount) break;
    const take = Math.min(entry.pile.amount, desiredAmount - gathered);
    gathered += take;
    entry.pile.amount -= take;
    if (entry.pile.amount <= 0) remove.add(entry.index);
  }

  if (remove.size > 0) {
    state.woodPiles = state.woodPiles.filter((_, index) => !remove.has(index));
  }
  return gathered;
}

function spillCarriedWood(state: GameState, h: HarvesterState): void {
  const looseWood = (h.carryingResource === ResourceType.Wood ? h.carryAmount : 0) + h.queuedWoodAmount;
  if (looseWood > 0) {
    dropWoodPile(state, h.x, h.y, looseWood, h.id + looseWood);
  }
  if (h.carryingResource === ResourceType.Wood) {
    h.carryingResource = null;
    h.carryAmount = 0;
  }
  h.queuedWoodAmount = 0;
  h.woodCarryTarget = 0;
  h.woodDropsCreated = 0;
}

function killHarvester(state: GameState, h: HarvesterState): void {
  if (h.carryingDiamond) dropDiamond(state, h.x, h.y);
  spillCarriedWood(state, h);
  h.state = 'dead';
  h.hp = 0;
  h.respawnTimer = HARVESTER_RESPAWN_TICKS;
  h.carryingDiamond = false;
  h.carryingResource = null;
  h.carryAmount = 0;
  h.fightTargetId = null;
  h.targetCellIdx = -1;
  h.diamondCellsMinedThisTrip = 0;
}

// === Tick Systems ===

function tickSpawners(state: GameState): void {
  let spawnSounds = 0;
  // Shuffle spawn order to prevent first-player advantage in unit creation
  _spawnOrder.length = 0;
  for (const b of state.buildings) _spawnOrder.push(b);
  const spawnOrder = _spawnOrder;
  for (let i = spawnOrder.length - 1; i > 0; i--) {
    const j = Math.floor(state.rng() * (i + 1));
    const tmp = spawnOrder[i]; spawnOrder[i] = spawnOrder[j]; spawnOrder[j] = tmp;
  }
  for (const building of spawnOrder) {
    if (building.type === BuildingType.Tower || building.type === BuildingType.HarvesterHut || building.type === BuildingType.Research) continue;
    building.actionTimer--;
    if (building.actionTimer <= 0) {
      const player = state.players[building.playerId];
      const stats = UNIT_STATS[player.race]?.[building.type];
      if (!stats) continue;
      const upgrade = getUnitUpgradeMultipliers(building.upgradePath, player.race, building.type);
      building.actionTimer = Math.round(SPAWN_INTERVAL_TICKS * upgrade.spawnSpeed);
      const category: UnitState['category'] =
        building.type === BuildingType.CasterSpawner ? 'caster' :
        building.type === BuildingType.RangedSpawner ? 'ranged' : 'melee';
      const researchMult = getResearchMultipliers(player, category);
      // Race one-shot HP bonuses
      const bu = player.researchUpgrades;
      let raceHpMult = 1;
      let raceMoveSpeedMult = 1;
      if (category === 'melee') {
        if (bu.raceUpgrades['crown_melee_2']) raceHpMult *= 1.15;
        if (bu.raceUpgrades['horde_melee_2']) raceHpMult *= 1.20;
        if (bu.raceUpgrades['deep_melee_1']) raceHpMult *= 1.15;
        if (bu.raceUpgrades['goblins_melee_2']) raceMoveSpeedMult *= 1.35;
      }
      const count = upgrade.special.spawnCount ?? stats.spawnCount ?? 1;
      // Oozlings Mass Division: spawn 3 instead of 2 for casters
      const finalCount = (category === 'caster' && bu.raceUpgrades['oozlings_caster_2'] && count >= 2) ? 3 : count;
      for (let si = 0; si < finalCount; si++) {
        // Oozlings: random lane per unit (supports any number of lanes)
        const unitLane = (player.race === Race.Oozlings && finalCount >= 2)
          ? (state.rng() < 0.5 ? Lane.Left : Lane.Right)
          : building.lane;
        state.units.push({
          id: genId(state), type: stats.name, playerId: building.playerId, team: player.team,
          x: building.worldX + (si * 0.3), y: building.worldY,
          hp: Math.max(1, Math.round(stats.hp * upgrade.hp * raceHpMult)),
          maxHp: Math.max(1, Math.round(stats.hp * upgrade.hp * raceHpMult)),
          damage: Math.max(1, Math.round(stats.damage * upgrade.damage * researchMult.damageMult)),
          attackSpeed: Math.max(0.2, stats.attackSpeed * upgrade.attackSpeed), attackTimer: 0,
          moveSpeed: Math.max(0.5, stats.moveSpeed * upgrade.moveSpeed * raceMoveSpeedMult),
          range: Math.max(1, stats.range * upgrade.range),
          targetId: null, lane: unitLane, pathProgress: -1, carryingDiamond: false,
          statusEffects: [], hitCount: 0, shieldHp: 0, category,
          upgradeTier: building.upgradePath.length - 1,
          upgradeNode: building.upgradePath[building.upgradePath.length - 1] ?? 'A',
          upgradeSpecial: upgrade.special, kills: 0, damageDone: 0, healingDone: 0, buffsApplied: 0, lastDamagedByName: '', spawnTick: state.tick,
        });
        if (state.playerStats[building.playerId]) state.playerStats[building.playerId].unitsSpawned++;
      }
      if (spawnSounds < 2) { addSound(state, 'unit_spawn', building.worldX, building.worldY); spawnSounds++; }
    }
  }
}

function getEffectiveSpeed(unit: UnitState, gameState?: GameState): number {
  let speed = unit.moveSpeed;
  let isSlowed = false;
  for (const eff of unit.statusEffects) {
    if (eff.type === StatusType.Slow) { speed *= Math.max(0.5, 1 - 0.1 * eff.stacks); isSlowed = true; }
    if (eff.type === StatusType.Haste) speed *= 1.3;
  }
  // Deep Freezing Depths: slowed units move 25% slower
  if (isSlowed && gameState) {
    for (const p of gameState.players) {
      if (p.isEmpty || p.race !== Race.Deep || p.team === unit.team) continue;
      if (p.researchUpgrades.raceUpgrades['deep_ability_3']) { speed *= 0.85; break; }
    }
  }
  // Wild Pack Speed: +15% global move speed for units
  if (gameState) {
    const unitPlayer = gameState.players[unit.playerId];
    if (unitPlayer?.researchUpgrades.raceUpgrades['wild_ability_3']) speed *= 1.10;
  }
  // Horde aura speed bonus
  const auraSpd = unit.upgradeSpecial?._auraSpd ?? 0;
  if (auraSpd > 0) speed *= (1 + auraSpd);
  return speed;
}

/** Get damage with status effect multipliers (Frenzy = +30% damage) + aura bonuses */
function getEffectiveDamage(unit: UnitState, state?: GameState): number {
  let dmg = unit.damage;
  for (const eff of unit.statusEffects) {
    if (eff.type === StatusType.Frenzy) dmg = Math.round(dmg * 1.5);
  }
  // Horde aura damage bonus
  const auraDmg = unit.upgradeSpecial?._auraDmg ?? 0;
  if (auraDmg > 0) dmg += auraDmg;
  // Crown: Aegis Wrath — shielded allies deal +40% damage
  if (state && unit.shieldHp > 0) {
    const p = state.players[unit.playerId];
    if (p?.researchUpgrades.raceUpgrades['crown_ability_3']) dmg = Math.round(dmg * 1.25);
  }
  return dmg;
}

function tickUnitMovement(state: GameState): void {
  // Shuffle movement order to prevent first-mover positional advantage
  _moveOrder.length = 0;
  for (const u of state.units) _moveOrder.push(u);
  const moveOrder = _moveOrder;
  for (let i = moveOrder.length - 1; i > 0; i--) {
    const j = Math.floor(state.rng() * (i + 1));
    const tmp = moveOrder[i]; moveOrder[i] = moveOrder[j]; moveOrder[j] = tmp;
  }
  for (const unit of moveOrder) {
    if (unit.targetId !== null) continue;

    // Stop marching when an enemy alley building or HQ is within attack range.
    // Siege units skip this; they have their own building-targeting logic.
    if (!unit.upgradeSpecial?.isSiegeUnit) {
      const tRange = unit.range + 1.5;
      let stopForBuilding = false;
      for (const b of state.buildings) {
        if (b.buildGrid !== 'alley' || b.hp <= 0) continue;
        const bp = state.players[b.playerId];
        if (!bp || bp.team === unit.team) continue;
        const td = Math.sqrt((b.worldX + 0.5 - unit.x) ** 2 + (b.worldY + 0.5 - unit.y) ** 2);
        if (td <= tRange) { stopForBuilding = true; break; }
      }
      if (!stopForBuilding) {
        // Also stop for enemy HQ
        const enemyTeam = unit.team === Team.Bottom ? Team.Top : Team.Bottom;
        const hq = getHQPosition(enemyTeam, state.mapDef);
        const hqCx = hq.x + HQ_WIDTH / 2;
        const hqCy = hq.y + HQ_HEIGHT / 2;
        const hqRadius = Math.max(HQ_WIDTH, HQ_HEIGHT) * 0.5;
        const distToHq = Math.sqrt((unit.x - hqCx) ** 2 + (unit.y - hqCy) ** 2);
        if (distToHq <= unit.range + hqRadius) stopForBuilding = true;
      }
      if (stopForBuilding) continue;
    }

    const speed = getEffectiveSpeed(unit, state);
    let movePerTick = speed / TICK_RATE;

    // Phase 1: Walking from building to lane path start
    if (unit.pathProgress < 0) {
      const path = getLanePath(unit.team, unit.lane, state.mapDef);
      const target = path[0]; // first waypoint
      const dx = target.x - unit.x, dy = target.y - unit.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < movePerTick * 2) {
        // Close enough — join the lane path
        unit.pathProgress = 0;
        unit.x = target.x;
        unit.y = target.y;
      } else {
        moveWithSlide(unit, target.x, target.y, movePerTick, state.diamondCells, state.mapDef);
      }
      continue;
    }

    // Phase 2: Following lane path
    const path = getLanePath(unit.team, unit.lane, state.mapDef);
    const pathLen = getCachedPathLength(unit.team, unit.lane, state.mapDef);
    const preX = unit.x, preY = unit.y;

    // Ranged + caster units prefer to stay behind nearest allied melee — but only near enemies
    if (unit.category === 'ranged' || unit.category === 'caster') {
      // Only engage formation behavior when enemies are within threat range
      const threatRange = unit.range + 6;
      let enemyNearby = false;
      const nearbyUnits = _combatGrid.getNearby(unit.x, unit.y, threatRange);
      for (const other of nearbyUnits) {
        if (other.team === unit.team) continue;
        const dx = other.x - unit.x, dy = other.y - unit.y;
        if (dx * dx + dy * dy <= threatRange * threatRange) { enemyNearby = true; break; }
      }
      if (enemyNearby) {
        let nearestMeleeProgress = -1;
        let nearestMeleeDist = Infinity;
        for (const other of nearbyUnits) {
          if (other.id === unit.id || other.team !== unit.team || other.lane !== unit.lane) continue;
          if (other.category !== 'melee' || other.pathProgress < 0) continue;
          const d = Math.abs(other.pathProgress - unit.pathProgress);
          if (d < nearestMeleeDist) { nearestMeleeDist = d; nearestMeleeProgress = other.pathProgress; }
        }
        if (nearestMeleeProgress >= 0) {
          // Casters hang further back than ranged (they have AoE, don't need to be close)
          const behind = unit.category === 'caster' ? 4.5 : 3;
          const behindOffset = behind / pathLen;
          const idealProgress = nearestMeleeProgress - behindOffset;
          if (unit.pathProgress > idealProgress + 0.005) {
            // Too far forward — slow down significantly
            movePerTick *= 0.2;
          }
        }
      }
    }

    // Slight crowd slow-down so large groups keep a front line instead of "train" behavior.
    // Reduced from original values to prevent armies from stalling into immovable blobs.
    let nearbyFriendlies = 0;
    const crowdNearby = _combatGrid.getNearby(unit.x, unit.y, 1.35);
    for (const other of crowdNearby) {
      if (other.id === unit.id || other.team !== unit.team || other.lane !== unit.lane) continue;
      if (other.pathProgress < 0 || unit.pathProgress < 0) continue;
      if (Math.abs(other.pathProgress - unit.pathProgress) > 0.04) continue;
      const d = Math.sqrt((other.x - unit.x) ** 2 + (other.y - unit.y) ** 2);
      if (d < 1.35) nearbyFriendlies++;
    }
    const crowdFactor = Math.max(0.72, 1 - nearbyFriendlies * 0.04);
    movePerTick *= crowdFactor;

    unit.pathProgress += movePerTick / pathLen;
    if (unit.pathProgress > 1) unit.pathProgress = 1;

    // Formation offset so units naturally spread into lines while following lane flow.
    // Wider spread near enemies to create envelopment opportunities.
    let enemyClose = false;
    const formNearby = _combatGrid.getNearby(unit.x, unit.y, 8);
    for (const other of formNearby) {
      if (other.team === unit.team || other.hp <= 0) continue;
      const ed = (other.x - unit.x) ** 2 + (other.y - unit.y) ** 2;
      if (ed < 64) { enemyClose = true; break; } // 8 tile radius
    }
    const slot = (unit.id % 7) - 3; // [-3..3]
    const spreadMult = enemyClose ? 0.44 : 0.34;
    const baseOffset = slot * spreadMult;
    const jitter = ((((unit.id * 73) % 1000) / 1000) - 0.5) * 0.1;

    const pos = interpolatePath(path, unit.pathProgress);
    const posAhead = interpolatePath(path, Math.min(1, unit.pathProgress + 0.01));
    const chokeSpread = getChokeSpreadMultiplier(pos.x, pos.y, state.mapDef);

    let sep = 0;
    let sepCount = 0;
    for (const other of state.units) {
      if (other.id === unit.id || other.lane !== unit.lane) continue;
      const ox = other.x - pos.x;
      const oy = other.y - pos.y;
      const d = Math.sqrt(ox * ox + oy * oy);
      if (d <= 0.001 || d > 2.2) continue;
      const w = (2.2 - d) / 2.2;
      // Enemies push laterally too, so marching units spread before contact
      const teamMul = other.team === unit.team ? 1.0 : 0.5;
      sep -= (ox / d) * w * teamMul;
      sepCount++;
    }
    const separationOffset = sepCount > 0 ? Math.max(-0.7, Math.min(0.7, sep * 0.18)) : 0;

    // Reduce formation spread near the diamond so units don't get pushed into cells
    const dcx = state.mapDef?.diamondCenter.x ?? DIAMOND_CENTER_X;
    const dcy = state.mapDef?.diamondCenter.y ?? DIAMOND_CENTER_Y;
    const dhw = state.mapDef?.diamondHalfW ?? DIAMOND_HALF_W;
    const dhh = state.mapDef?.diamondHalfH ?? DIAMOND_HALF_H;
    const ddx = Math.abs(pos.x - dcx) / (dhw + 4);
    const ddy = Math.abs(pos.y - dcy) / (dhh + 4);
    const diamondProximity = ddx + ddy;
    // Inside the diamond+buffer zone, shrink formation offset
    const diamondShrink = diamondProximity < 1 ? 0.3 + 0.7 * diamondProximity : 1;

    const laneOffset = (baseOffset + jitter + separationOffset) * chokeSpread * diamondShrink;
    const tx = posAhead.x - pos.x;
    const ty = posAhead.y - pos.y;
    const tLen = Math.sqrt(tx * tx + ty * ty) || 1;
    const nx = -ty / tLen;
    const ny = tx / tLen;

    const desiredX = pos.x + nx * laneOffset;
    const desiredY = pos.y + ny * laneOffset;
    const dx = desiredX - unit.x;
    const dy = desiredY - unit.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > movePerTick && dist > 0.001) {
      moveWithSlide(unit, desiredX, desiredY, movePerTick, state.diamondCells, state.mapDef);
    } else if (!isBlocked(desiredX, desiredY, 0.45, state.diamondCells)) {
      unit.x = desiredX;
      unit.y = desiredY;
    } else {
      // Formation offset is blocked — fall back to on-path position so units don't freeze
      const fpx = pos.x - unit.x;
      const fpy = pos.y - unit.y;
      const fpd = Math.sqrt(fpx * fpx + fpy * fpy);
      if (fpd > movePerTick && fpd > 0.001) {
        moveWithSlide(unit, pos.x, pos.y, movePerTick, state.diamondCells, state.mapDef);
      } else if (!isBlocked(pos.x, pos.y, 0.45, state.diamondCells)) {
        unit.x = pos.x;
        unit.y = pos.y;
      }
    }

    // Stuck detection: if the unit didn't move at all this tick despite having speed,
    // count consecutive stuck ticks and snap to the lane path after 3.
    const moved = (unit.x - preX) ** 2 + (unit.y - preY) ** 2 > 0.0001;
    if (!moved && movePerTick > 0.001 && unit.pathProgress < 1) {
      unit.stuckTicks = (unit.stuckTicks ?? 0) + 1;
      if (unit.stuckTicks >= 3) {
        // Guard: pathProgress can drift far from actual position during combat.
        // Only snap if it would be a small correction; otherwise skip the snap
        // to avoid teleporting 40+ tiles across the map.
        const snapPos = interpolatePath(path, unit.pathProgress);
        const snapDist2 = (snapPos.x - unit.x) ** 2 + (snapPos.y - unit.y) ** 2;
        if (snapDist2 <= 25) { // ≤ 5 tiles
          unit.x = snapPos.x;
          unit.y = snapPos.y;
        }
        unit.stuckTicks = 0;
      }
    } else {
      unit.stuckTicks = 0;
    }
  }
}

const POTION_PICKUP_RADIUS = 1.5;

function applyPotionBuff(state: GameState, unit: GameState['units'][0], type: PotionType): void {
  // Goblins Potent Potions: +50% duration
  const unitPlayer = state.players[unit.playerId];
  const potentMult = (unitPlayer?.race === Race.Goblins && unitPlayer.researchUpgrades.raceUpgrades['goblins_ability_3']) ? 1.5 : 1;
  const dur = Math.round(6 * TICK_RATE * potentMult);
  if (type === 'speed') {
    const haste = unit.statusEffects.find(s => s.type === StatusType.Haste);
    if (haste) { haste.duration = dur; }
    else unit.statusEffects.push({ type: StatusType.Haste, stacks: 1, duration: dur });
    addFloatingText(state, unit.x, unit.y, 'SPEED', '#69f0ae', undefined, undefined,
      { ftType: 'status', miniIcon: 'potion_blue' });
  } else if (type === 'rage') {
    const frenzy = unit.statusEffects.find(s => s.type === StatusType.Frenzy);
    if (frenzy) { frenzy.duration = dur; }
    else unit.statusEffects.push({ type: StatusType.Frenzy, stacks: 1, duration: dur });
    addFloatingText(state, unit.x, unit.y, 'RAGE', '#ff5722', undefined, undefined,
      { ftType: 'status', miniIcon: 'potion_red' });
  } else {
    const shield = unit.statusEffects.find(s => s.type === StatusType.Shield);
    if (shield) { shield.duration = dur; shield.stacks = 20; }
    else unit.statusEffects.push({ type: StatusType.Shield, stacks: 20, duration: dur });
    unit.shieldHp = Math.max(unit.shieldHp, 20);
    addFloatingText(state, unit.x, unit.y, 'SHIELD', '#42a5f5', undefined, undefined,
      { ftType: 'status', miniIcon: 'potion_green' });
  }
  addSound(state, 'ability_potion', unit.x, unit.y);
}

function tickPotionPickups(state: GameState): void {
  if (state.potionDrops.length === 0) return;
  const toRemove = new Set<number>();

  for (let i = 0; i < state.potionDrops.length; i++) {
    const potion = state.potionDrops[i];

    // Advance flight arc
    if (potion.flightProgress < potion.flightTicks) {
      potion.flightProgress++;
      if (potion.flightProgress >= potion.flightTicks) {
        // Just landed — play sound
        addSound(state, 'ability_potion', potion.x, potion.y);
      }
      continue; // can't be picked up while in flight
    }

    potion.remainingTicks--;
    if (potion.remainingTicks <= 0) { toRemove.add(i); continue; }

    // Goblins Quick Brew: potions attract toward nearby allies within 4 tiles
    const potTeamPlayers = state.players.filter(p => p.team === potion.team && p.race === Race.Goblins);
    if (potTeamPlayers.some(p => p.researchUpgrades.raceUpgrades['goblins_ability_1'])) {
      let closestDist = 16; // 4 tiles squared
      let closestUnit: { x: number; y: number } | null = null;
      for (const u of state.units) {
        if (u.hp <= 0 || u.team !== potion.team) continue;
        const d2 = (u.x - potion.x) ** 2 + (u.y - potion.y) ** 2;
        if (d2 < closestDist) { closestDist = d2; closestUnit = u; }
      }
      if (closestUnit) {
        const adx = closestUnit.x - potion.x, ady = closestUnit.y - potion.y;
        const ad = Math.sqrt(adx * adx + ady * ady);
        if (ad > 0.1) {
          const attractSpeed = 0.08; // tiles per tick
          potion.x += (adx / ad) * attractSpeed;
          potion.y += (ady / ad) * attractSpeed;
        }
      }
    }

    // Check if any allied unit walks over this potion
    for (const u of state.units) {
      if (u.hp <= 0 || u.team !== potion.team) continue;
      const d2 = (u.x - potion.x) ** 2 + (u.y - potion.y) ** 2;
      if (d2 <= POTION_PICKUP_RADIUS * POTION_PICKUP_RADIUS) {
        applyPotionBuff(state, u, potion.type);
        toRemove.add(i);
        break;
      }
    }
  }

  if (toRemove.size > 0) {
    state.potionDrops = state.potionDrops.filter((_, i) => !toRemove.has(i));
  }
}

function tickUnitDiamondPickup(state: GameState): void {
  // Check if any unit carrying diamond reached own HQ → spawn champion
  for (const unit of state.units) {
    if (!unit.carryingDiamond || unit.hp <= 0) continue;
    const hq = getHQPosition(unit.team, state.mapDef);
    const hqCx = hq.x + HQ_WIDTH / 2, hqCy = hq.y + HQ_HEIGHT / 2;
    const dx = unit.x - hqCx, dy = unit.y - hqCy;
    if (dx * dx + dy * dy <= 9) { // 3 tile deposit radius
      unit.carryingDiamond = false;
      spawnDiamondChampion(state, unit.team, unit.x, unit.y, unit.playerId);
      resetDiamondForRespawn(state);
      if (state.playerStats[unit.playerId]) state.playerStats[unit.playerId].diamondPickups++;
      return;
    }
  }

  // Diamond respawn timer
  if (state.diamond.state === 'respawning') {
    state.diamond.respawnTimer--;
    if (state.diamond.respawnTimer <= 0) {
      // Diamond reappears as dropped (immediately pickable) since gold cells are already mined
      state.diamond.state = 'dropped';
      addSound(state, 'diamond_exposed', state.diamond.x, state.diamond.y);
      addFloatingText(state, state.diamond.x, state.diamond.y, 'DIAMOND RESPAWNED!', '#00ffff');
    }
    return;
  }

  if (state.diamond.state !== 'dropped') return;
  for (const unit of state.units) {
    if (unit.hp <= 0 || unit.carryingDiamond) continue;
    const dx = unit.x - state.diamond.x;
    const dy = unit.y - state.diamond.y;
    if (dx * dx + dy * dy > 2.25) continue; // 1.5 tile radius
    unit.carryingDiamond = true;
    state.diamond.state = 'carried';
    state.diamond.carrierId = unit.id;
    state.diamond.carrierType = 'unit';
    if (state.playerStats[unit.playerId]) state.playerStats[unit.playerId].diamondPickups++;
    addSound(state, 'diamond_carried', unit.x, unit.y);
    addFloatingText(state, unit.x, unit.y, 'DIAMOND!', '#00ffff');
    break;
  }
}

function applyStatus(target: UnitState, type: StatusType, stacks: number): void {
  const existing = target.statusEffects.find(e => e.type === type);
  const maxStacks = type === StatusType.Slow || type === StatusType.Burn ? 5 : 1;
  const duration = type === StatusType.Burn ? 3 * TICK_RATE :
                   type === StatusType.Slow ? 3 * TICK_RATE :
                   type === StatusType.Haste ? 3 * TICK_RATE :
                   type === StatusType.Frenzy ? 4 * TICK_RATE :
                   4 * TICK_RATE; // Shield
  if (existing) {
    existing.stacks = Math.min(existing.stacks + stacks, maxStacks);
    existing.duration = duration; // refresh
  } else {
    target.statusEffects.push({ type, stacks: Math.min(stacks, maxStacks), duration });
  }
  if (type === StatusType.Shield && target.shieldHp <= 0) target.shieldHp = 12;
}

function applyKnockback(unit: UnitState, amount: number, mapDef?: MapDef): void {
  if (unit.pathProgress < 0) return; // not on path yet
  const path = getLanePath(unit.team, unit.lane, mapDef);
  const pathLen = getCachedPathLength(unit.team, unit.lane, mapDef);
  const prevProgress = unit.pathProgress;
  unit.pathProgress = Math.max(0, unit.pathProgress - amount);
  const knockDist = (prevProgress - unit.pathProgress) * pathLen;
  if (knockDist <= 0) return;
  // Get backward direction from path tangent at current progress — then
  // move from the unit's ACTUAL position, not the path position.
  // (pathProgress can diverge from x/y during combat chase; snapping to
  //  interpolatePath(pathProgress) would teleport units across the map.)
  const p0 = interpolatePath(path, Math.max(0, prevProgress - 0.02));
  const p1 = interpolatePath(path, prevProgress);
  const fwdX = p1.x - p0.x, fwdY = p1.y - p0.y;
  const fwdLen = Math.sqrt(fwdX * fwdX + fwdY * fwdY) || 1;
  unit.x -= (fwdX / fwdLen) * knockDist;
  unit.y -= (fwdY / fwdLen) * knockDist;
}

/** Track healing for a unit's owner. */
function trackHealing(state: GameState, unit: UnitState, amount: number): void {
  const ps = state.playerStats[unit.playerId];
  if (ps) ps.totalHealing += amount;
  unit.healingDone += amount;
}

const WOUND_DURATION_TICKS = 6 * TICK_RATE;
function applyWound(target: UnitState): void {
  const existing = target.statusEffects.find(e => e.type === StatusType.Wound);
  if (existing) { existing.duration = WOUND_DURATION_TICKS; }
  else { target.statusEffects.push({ type: StatusType.Wound, stacks: 1, duration: WOUND_DURATION_TICKS }); }
}

const VULNERABLE_DURATION_TICKS = 3 * TICK_RATE;
function applyVulnerable(target: UnitState): void {
  const existing = target.statusEffects.find(e => e.type === StatusType.Vulnerable);
  if (existing) { existing.duration = VULNERABLE_DURATION_TICKS; }
  else { target.statusEffects.push({ type: StatusType.Vulnerable, stacks: 1, duration: VULNERABLE_DURATION_TICKS }); }
}

/** Heal a unit, respecting Wound status (-50% healing). Returns actual HP healed. */
function healUnit(unit: UnitState, amount: number): number {
  if (amount <= 0 || unit.hp >= unit.maxHp) return 0;
  const wounded = unit.statusEffects.some(e => e.type === StatusType.Wound);
  const effective = wounded ? Math.round(amount * 0.5) : amount;
  if (effective <= 0) return 0;
  const actual = Math.min(unit.maxHp - unit.hp, effective);
  unit.hp = Math.min(unit.maxHp, unit.hp + effective);
  return actual;
}



function dealDamage(state: GameState, target: UnitState, amount: number, showFloat: boolean, sourcePlayerId?: number, sourceUnitId?: number, isTowerShot?: boolean): void {
  // Dodge check
  let dodge = target.upgradeSpecial?.dodgeChance ?? 0;
  // Goblins Cower Reflexes: +25% dodge when below 50% HP
  if (target.hp < target.maxHp * 0.5) {
    const tgtPlayer = state.players[target.playerId];
    if (tgtPlayer?.race === Race.Goblins && tgtPlayer.researchUpgrades.raceUpgrades['goblins_ability_2']) {
      dodge = Math.min(1, dodge + 0.25);
    }
  }
  // Geists Death Defiance: 2% chance to avoid lethal damage
  if (target.hp > 0 && target.hp <= amount) {
    const deathPlayer = state.players[target.playerId];
    if (deathPlayer?.researchUpgrades.raceUpgrades['geists_ability_3']) {
      dodge = Math.min(1, dodge + 0.05);
    }
  }
  if (dodge > 0 && state.rng() < dodge) {
    if (state.rng() < 0.3) addFloatingText(state, target.x, target.y, 'DODGE', '#ffffff', undefined, true,
      { ftType: 'status' });
    addCombatEvent(state, { type: 'dodge', x: target.x, y: target.y, color: '#ffffff' });
    return;
  }
  // Damage reduction (upgrade tree)
  const reduction = target.upgradeSpecial?.damageReductionPct ?? 0;
  if (reduction > 0) amount = Math.max(1, Math.round(amount * (1 - reduction)));
  // Horde aura armor bonus
  const auraArmor = target.upgradeSpecial?._auraArmor ?? 0;
  if (auraArmor > 0) amount = Math.max(1, Math.round(amount * (1 - auraArmor)));
  // Research defense reduction
  const targetPlayer = state.players[target.playerId];
  if (targetPlayer) {
    const bMult = getResearchMultipliers(targetPlayer, target.category);
    if (bMult.damageReduction > 0) amount = Math.max(1, Math.round(amount * (1 - bMult.damageReduction)));
    // Race one-shot defensive effects
    const tbu = targetPlayer.researchUpgrades;
    // Crown Defend Stance: melee units take -25% ranged dmg
    if (target.category === 'melee' && tbu.raceUpgrades['crown_melee_1'] && sourceUnitId !== undefined) {
      const srcUnit = state.units.find(u => u.id === sourceUnitId);
      if (srcUnit && srcUnit.category === 'ranged') amount = Math.max(1, Math.round(amount * 0.75));
    }
    // Deep Tidal Guard: +5% DR for melee (stacks with research def)
    if (target.category === 'melee' && tbu.raceUpgrades['deep_melee_1']) {
      amount = Math.max(1, Math.round(amount * 0.95));
    }
    // Geists Spectral Armor: +5% DR per 25% missing HP for melee
    if (target.category === 'melee' && tbu.raceUpgrades['geists_melee_2']) {
      const missingPct = 1 - target.hp / target.maxHp;
      const drBonus = Math.floor(missingPct / 0.25) * 0.05;
      if (drBonus > 0) amount = Math.max(1, Math.round(amount * (1 - drBonus)));
    }
    // Vulnerable: target takes +20% damage from all sources
    if (target.statusEffects.some(e => e.type === StatusType.Vulnerable))
      amount = Math.max(1, Math.round(amount * 1.20));
    // Goblins Jinx Cloud: slowed targets receive Wound (anti-heal) from Goblin team hits
    if (sourcePlayerId !== undefined) {
      const srcPlayer = state.players[sourcePlayerId];
      if (srcPlayer && srcPlayer.researchUpgrades.raceUpgrades['goblins_caster_2'] && target.statusEffects.some(e => e.type === StatusType.Slow)) {
        applyWound(target);
      }
    }
    // Tenders Thorned Vines: reflect 3 dmg to melee attackers
    if (target.category === 'melee' && tbu.raceUpgrades['tenders_melee_2'] && sourceUnitId !== undefined) {
      const srcUnit = state.units.find(u => u.id === sourceUnitId);
      if (srcUnit && srcUnit.range <= 2 && srcUnit.hp > 0) {
        srcUnit.hp = Math.max(1, srcUnit.hp - 3);
      }
    }
  }
  // Shield absorbs damage first
  if (target.shieldHp > 0) {
    const absorbed = Math.min(target.shieldHp, amount);
    target.shieldHp -= absorbed;
    amount -= absorbed;
    if (target.shieldHp <= 0) {
      target.statusEffects = target.statusEffects.filter(e => e.type !== StatusType.Shield);
    }
    if (absorbed > 0 && showFloat) {
      addFloatingText(state, target.x, target.y, `${absorbed}`, '#64b5f6', undefined, undefined,
        { ftType: 'damage', magnitude: absorbed, miniIcon: 'shield_icon' });
    }
  }
  if (amount > 0) {
    target.hp -= amount;
    if (showFloat && amount >= 5) {
      let miniIcon = 'sword';
      if (isTowerShot) {
        miniIcon = 'arrow';
      } else if (sourceUnitId !== undefined) {
        const src = state.units.find(u => u.id === sourceUnitId);
        if (src && src.range > 2) miniIcon = 'arrow';
      }
      addFloatingText(state, target.x, target.y, `${amount}`, '#ffffff', undefined, undefined,
        { ftType: 'damage', magnitude: amount, miniIcon });
    }
    // Track damage stats
    const targetPs = state.playerStats[target.playerId];
    if (targetPs) targetPs.totalDamageTaken += amount;
    if (sourceUnitId !== undefined) {
      const srcUnit = state.units.find(u => u.id === sourceUnitId);
      if (srcUnit) srcUnit.damageDone += amount;
    }
    if (sourcePlayerId !== undefined && state.playerStats[sourcePlayerId]) {
      state.playerStats[sourcePlayerId].totalDamageDealt += amount;
      if (isTowerShot) state.playerStats[sourcePlayerId].towerDamageDealt += amount;
      // Credit kill when no unit ID is present (tower, explosion, AoE death effects)
      // Unit-kill credit is handled separately in the sourceUnitId block below
      if (target.hp <= 0 && sourceUnitId === undefined) state.playerStats[sourcePlayerId].enemyUnitsKilled++;
      // Check if near own HQ (within 20 tiles)
      const team = state.players[sourcePlayerId].team;
      const hq = getHQPosition(team, state.mapDef);
      const hqCx = hq.x + HQ_WIDTH / 2, hqCy = hq.y + HQ_HEIGHT / 2;
      const dx = target.x - hqCx, dy = target.y - hqCy;
      if (dx * dx + dy * dy <= 400) { // 20 tile radius
        state.playerStats[sourcePlayerId].totalDamageNearHQ += amount;
      }
    }
    // Track killer name and credit kill
    if (sourceUnitId !== undefined) {
      const killer = state.units.find(u => u.id === sourceUnitId);
      if (killer) {
        const killerRace = state.players[killer.playerId]?.race;
        const killerBldg = `${killer.category}_spawner` as BuildingType;
        target.lastDamagedByName = (killerRace != null ? getUpgradeNodeDef(killerRace, killerBldg, killer.upgradeNode)?.name : undefined) ?? killer.type;
        if (target.hp <= 0) {
          killer.kills++;
          if (state.playerStats[killer.playerId]) state.playerStats[killer.playerId].enemyUnitsKilled++;
          // Gold on kill (pirate upgrade path)
          const gok = killer.upgradeSpecial?.goldOnKill ?? 0;
          if (gok > 0) {
            const kp = state.players[killer.playerId];
            if (kp) { kp.gold += gok; addFloatingText(state, killer.x, killer.y - 0.3, `+${gok}g`, '#ffd700'); }
          }
          // Research: Crown Royal Guard — +2g on melee kill
          const killPlayer = state.players[killer.playerId];
          if (killPlayer && killer.category === 'melee' && killPlayer.researchUpgrades.raceUpgrades['crown_melee_2']) {
            killPlayer.gold += 2;
            addFloatingText(state, killer.x, killer.y - 0.3, '+2g', '#ffd700');
          }
          // Research: Demon Soul Siphon — +2 mana on melee kill
          if (killPlayer && killer.category === 'melee' && killPlayer.researchUpgrades.raceUpgrades['demon_melee_2']) {
            killPlayer.mana += 2;
          }
          // Demon kill-scaling: +dmg per kill (Bloodfire Berserker, Inferno Reaper, Soul Pyre)
          if (killer.upgradeSpecial?.killScaling) {
            const maxKillStacks = killer.upgradeSpecial.killMaxStacks ?? 10;
            if (killer.kills <= maxKillStacks) {
              // Store original base damage on first kill (avoids rounding drift)
              if (killer.kills === 1) {
                killer.upgradeSpecial = { ...killer.upgradeSpecial, _baseDmg: killer.damage };
              }
              const pct = killer.upgradeSpecial.killDmgPct ?? 0.05;
              const baseDmg = killer.upgradeSpecial._baseDmg ?? killer.damage;
              killer.damage = Math.round(baseDmg * (1 + pct * killer.kills));
              addFloatingText(state, killer.x, killer.y - 0.5, `+DMG`, '#ff6600', undefined, undefined,
                { ftType: 'status' });
            }
          }
          // Wild Kill Frenzy: on kill, heal 15% maxHP, nearby Wild allies gain Frenzy (+50% dmg) and Haste
          const killerRace = state.players[killer.playerId]?.race;
          if (killerRace === Race.Wild) {
            const wildPlayer = state.players[killer.playerId];
            // Meat Harvest: 30% chance to gain +3 stone on kill
            if (wildPlayer?.researchUpgrades.raceUpgrades['wild_ability_1'] && state.rng() < 0.3) {
              wildPlayer.stone += 3;
              if (state.playerStats[killer.playerId]) state.playerStats[killer.playerId].totalStoneEarned += 3;
              addFloatingText(state, killer.x, killer.y - 0.3, '+3', '#e57373', 'meat');
            }
            // Heal killer on kill (bloodthirst)
            const healAmt = Math.round(killer.maxHp * 0.15);
            const actualHeal = healUnit(killer, healAmt);
            if (actualHeal > 0) trackHealing(state, killer, actualHeal);
            // Blood Frenzy: double frenzy radius
            const frenzyRadius = wildPlayer?.researchUpgrades.raceUpgrades['wild_ability_2'] ? 12 : 6;
            applyStatus(killer, StatusType.Frenzy, 1);
            applyStatus(killer, StatusType.Haste, 1);
            for (const ally of state.units) {
              if (ally.team !== killer.team || ally.id === killer.id || ally.hp <= 0) continue;
              if (state.players[ally.playerId]?.race !== Race.Wild) continue;
              const dx = ally.x - killer.x, dy = ally.y - killer.y;
              if (dx * dx + dy * dy <= frenzyRadius * frenzyRadius) {
                applyStatus(ally, StatusType.Frenzy, 1);
                applyStatus(ally, StatusType.Haste, 1);
              }
            }
            if (state.rng() < 0.25) {
              addFloatingText(state, killer.x, killer.y - 0.3, '', '#ff4400', undefined, true,
                { ftType: 'status', miniIcon: 'lightning' });
            }
          }
        }
      }
    } else if (sourcePlayerId !== undefined) {
      target.lastDamagedByName = 'Tower';
    } else {
      target.lastDamagedByName = 'HQ';
    }
  }
}

// === Caster Support Abilities ===
// Each race's caster has a secondary support effect on nearby allies when they cast

function applyCasterSupport(state: GameState, caster: UnitState, race: Race, sp: Record<string, any> | undefined): void {
  const supportRange = 6;
  const nearby = _combatGrid.getNearby(caster.x, caster.y, supportRange);
  const allies: UnitState[] = [];
  for (const u of nearby) {
    if (u.team === caster.team && u.id !== caster.id &&
        (u.x - caster.x) ** 2 + (u.y - caster.y) ** 2 <= supportRange * supportRange) {
      allies.push(u);
    }
  }
  const healBonus = sp?.healBonus ?? 0;

  switch (race) {
    case Race.Crown: {
      // Shield allies (like old Bastion)
      const shieldCount = 2 + (sp?.shieldTargetBonus ?? 0);
      const sorted = allies.slice().sort((a, b) => {
        const da = (a.x - caster.x) ** 2 + (a.y - caster.y) ** 2;
        const db = (b.x - caster.x) ** 2 + (b.y - caster.y) ** 2;
        return da !== db ? da - db : a.id - b.id;
      });
      let absorbBonus = sp?.shieldAbsorbBonus ?? 0;
      // Research: Fortified Shields +8 absorb
      const casterPlayer = state.players[caster.playerId];
      if (casterPlayer?.researchUpgrades.raceUpgrades['crown_caster_1']) absorbBonus += 8;
      const crownShielded = Math.min(shieldCount, sorted.length);
      for (let i = 0; i < crownShielded; i++) {
        applyStatus(sorted[i], StatusType.Shield, 1);
        if (absorbBonus > 0) sorted[i].shieldHp += absorbBonus;
        caster.buffsApplied++;
      }
      // Research: Healing Aura — 1 HP/s to 2 nearest allies
      if (casterPlayer?.researchUpgrades.raceUpgrades['crown_caster_2']) {
        let healed = 0;
        for (const a of sorted) {
          if (healed >= 2) break;
          if (a.hp < a.maxHp) {
            const ah = healUnit(a, 1);
            if (ah > 0) trackHealing(state, caster, ah);
            healed++;
          }
        }
      }
      if (crownShielded > 0) addCombatEvent(state, { type: 'pulse', x: caster.x, y: caster.y, radius: supportRange, color: '#64b5f6' });
      break;
    }
    case Race.Horde: {
      // Haste pulse: nearby allies get haste (5 base — Horde's War Chanter is a force multiplier)
      let hordeHasteCount = 0;
      const hordeP = state.players[caster.playerId];
      for (const a of allies) {
        if (!a.statusEffects.some(e => e.type === StatusType.Haste)) {
          applyStatus(a, StatusType.Haste, 1);
          // Research: War Drums — +2s haste duration
          if (hordeP?.researchUpgrades.raceUpgrades['horde_caster_1']) {
            const hasteEff = a.statusEffects.find(e => e.type === StatusType.Haste);
            if (hasteEff) hasteEff.duration += 2 * TICK_RATE;
          }
          hordeHasteCount++;
          caster.buffsApplied++;
          if (hordeHasteCount >= 5 + healBonus) break;
        }
      }
      if (hordeHasteCount > 0) addCombatEvent(state, { type: 'pulse', x: caster.x, y: caster.y, radius: supportRange, color: '#ffab40' });
      break;
    }
    case Race.Oozlings: {
      // Haste pulse: nearby allies get brief haste
      let oozHasteCount = 0;
      for (const a of allies) {
        if (!a.statusEffects.some(e => e.type === StatusType.Haste)) {
          applyStatus(a, StatusType.Haste, 1);
          oozHasteCount++;
          caster.buffsApplied++;
          if (oozHasteCount >= 3 + healBonus) break;
        }
      }
      if (oozHasteCount > 0) addCombatEvent(state, { type: 'pulse', x: caster.x, y: caster.y, radius: supportRange, color: '#76ff03' });
      break;
    }
    case Race.Goblins: {
      // Hex debuff: slow enemies near the caster instead of buffing allies
      const enemies = state.units.filter(u =>
        u.team !== caster.team &&
        Math.sqrt((u.x - caster.x) ** 2 + (u.y - caster.y) ** 2) <= supportRange
      );
      const gobP = state.players[caster.playerId];
      for (const e of enemies) {
        applyStatus(e, StatusType.Slow, 1 + (sp?.extraSlowStacks ?? 0));
        // Potent Hex: +1 Burn on caster AoE
        if (gobP?.researchUpgrades.raceUpgrades['goblins_caster_1']) applyStatus(e, StatusType.Burn, 1);
      }
      if (enemies.length > 0) {
        addFloatingText(state, caster.x, caster.y - 0.5, '', '#2e7d32', undefined, true,
          { ftType: 'heal', miniIcon: 'heart' });
        addCombatEvent(state, { type: 'pulse', x: caster.x, y: caster.y, radius: supportRange, color: '#2e7d32' });
      }
      break;
    }
    case Race.Demon: {
      // No support — pure damage caster, does nothing extra for allies
      break;
    }
    case Race.Deep: {
      // Cleanse: remove burn stacks from nearby allies
      const deepP = state.players[caster.playerId];
      const extraCleanse = deepP?.researchUpgrades.raceUpgrades['deep_caster_1'] ? 1 : 0;
      let cleansed = 0;
      for (const a of allies) {
        const burnIdx = a.statusEffects.findIndex(e => e.type === StatusType.Burn);
        if (burnIdx >= 0) {
          const burn = a.statusEffects[burnIdx];
          burn.stacks = Math.max(0, burn.stacks - (2 + healBonus + extraCleanse));
          if (burn.stacks <= 0) a.statusEffects.splice(burnIdx, 1);
          addDeathParticles(state, a.x, a.y, '#1565c0', 1);
          addCombatEvent(state, { type: 'cleanse', x: a.x, y: a.y, color: '#1565c0' });
          cleansed++;
        }
      }
      // Research: Abyssal Ward — shield 3 HP to nearby allies
      if (deepP?.researchUpgrades.raceUpgrades['deep_caster_2']) {
        for (const a of allies.slice(0, 3)) {
          applyStatus(a, StatusType.Shield, 1);
          a.shieldHp += 3;
          caster.buffsApplied++;
        }
      }
      if (cleansed > 0) {
        addFloatingText(state, caster.x, caster.y - 0.5, 'CLEANSE', '#1565c0', undefined, true,
          { ftType: 'heal' });
      }
      break;
    }
    case Race.Wild: {
      // Haste pulse: nearby allies get brief haste
      let hasteCount = 0;
      for (const a of allies) {
        if (!a.statusEffects.some(e => e.type === StatusType.Haste)) {
          applyStatus(a, StatusType.Haste, 1);
          hasteCount++;
          caster.buffsApplied++;
          if (hasteCount >= 3 + healBonus) break;
        }
      }
      // Research: Alpha Howl — casters grant Frenzy to 2 nearby allies
      const wildP = state.players[caster.playerId];
      if (wildP?.researchUpgrades.raceUpgrades['wild_caster_2']) {
        let frenzied = 0;
        for (const a of allies) {
          if (frenzied >= 2) break;
          applyStatus(a, StatusType.Frenzy, 1);
          frenzied++;
          caster.buffsApplied++;
        }
      }
      if (hasteCount > 0) addCombatEvent(state, { type: 'pulse', x: caster.x, y: caster.y, radius: supportRange, color: '#4caf50' });
      break;
    }
    case Race.Geists: {
      // Geist caster: no AoE, no heal — single-target attacker with skeleton summon on nearby death
      // Research: Necrotic Burst — heal 2 HP to 3 lowest allies
      const geistsP = state.players[caster.playerId];
      if (geistsP?.researchUpgrades.raceUpgrades['geists_caster_1']) {
        const sorted = allies.slice().sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp) || a.id - b.id);
        let healedCount = 0;
        for (const a of sorted) {
          if (healedCount >= 3) break;
          if (a.hp < a.maxHp) {
            const ah = healUnit(a, 2);
            if (ah > 0) trackHealing(state, caster, ah);
            healedCount++;
          }
        }
      }
      break;
    }
    case Race.Tenders: {
      // Focused heal: restore the most-injured ally
      let tenderHealAmt = 1 + healBonus;
      // Research: Bloom Burst +2 heal amount
      const tendersP = state.players[caster.playerId];
      if (tendersP?.researchUpgrades.raceUpgrades['tenders_caster_1']) tenderHealAmt += 2;
      const injured = allies
        .filter(a => a.hp < a.maxHp)
        .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp) || a.id - b.id);
      const target = injured[0];
      if (target) {
        // Research: Life Link — double heal if target <30% HP
        let thisHeal = tenderHealAmt;
        if (tendersP?.researchUpgrades.raceUpgrades['tenders_caster_2'] && target.hp < target.maxHp * 0.30) thisHeal *= 2;
        const ah = healUnit(target, thisHeal);
        if (ah > 0) trackHealing(state, caster, ah);
        addDeathParticles(state, target.x, target.y, '#33691e', 1);
        addCombatEvent(state, { type: 'heal', x: target.x, y: target.y, color: '#66bb6a' });
        addFloatingText(state, caster.x, caster.y - 0.5, `+${thisHeal}`, '#33691e', undefined, undefined,
          { ftType: 'heal', miniIcon: 'heart' });
        addCombatEvent(state, { type: 'pulse', x: caster.x, y: caster.y, radius: supportRange, color: '#66bb6a' });
      }
      break;
    }
  }
}

function applyOnHitEffects(state: GameState, attacker: UnitState, target: UnitState): void {
  const race = state.players[attacker.playerId].race;
  const isMelee = attacker.range <= 2;
  const sp = attacker.upgradeSpecial;

  switch (race) {
    case Race.Crown:
      // Swordsman: 10% damage reduction is passive (handled in damage calc), no on-hit
      break;
    case Race.Horde:
      // Brute: knockback every 3rd hit + 10% lifesteal
      if (isMelee) {
        attacker.hitCount++;
        const knockN = sp?.knockbackEveryN ?? 3;
        if (knockN > 0 && attacker.hitCount % knockN === 0) {
          applyKnockback(target, 0.02, state.mapDef);
          addDeathParticles(state, target.x, target.y, '#ffab40', 3);
          addCombatEvent(state, { type: 'knockback', x: target.x, y: target.y, color: '#ffab40' });
          if (state.rng() < 0.3) addFloatingText(state, target.x, target.y - 0.3, 'KNOCK', '#ffab40', undefined, true,
            { ftType: 'status' });
        }
        const hordeSteal = Math.round(attacker.damage * 0.10);
        if (hordeSteal > 0) {
          const ah = healUnit(attacker, hordeSteal);
          if (ah > 0) trackHealing(state, attacker, ah);
          addCombatEvent(state, { type: 'lifesteal', x: target.x, y: target.y, x2: attacker.x, y2: attacker.y, color: '#66bb6a' });
        }
      }
      break;
    case Race.Goblins:
      // Sticker: 15% dodge is passive (handled in damage calc)
      // Knifer burn is applied via projectile hit logic (tickProjectiles)
      applyWound(target); // all Goblin attacks apply Wound
      break;
    case Race.Oozlings:
      // Globule: 15% chance haste on melee hit
      if (isMelee) {
        if (sp?.guaranteedHaste) applyStatus(attacker, StatusType.Haste, 1);
        else if (state.rng() < 0.15) applyStatus(attacker, StatusType.Haste, 1);
      }
      break;
    case Race.Demon:
      // Smasher: burn on every hit (melee)
      if (isMelee) {
        applyStatus(target, StatusType.Burn, 1 + (sp?.extraBurnStacks ?? 0));
        applyWound(target); // Demon melee applies Wound
      }
      break;
    case Race.Deep:
      // Shell Guard: slow on melee hit
      // Harpooner ranged +2 slow is applied via projectile hit logic (tickProjectiles)
      if (isMelee) applyStatus(target, StatusType.Slow, 1 + (sp?.extraSlowStacks ?? 0));
      break;
    case Race.Wild:
      // Lurker: burn (poison) on melee hit
      if (isMelee) applyStatus(target, StatusType.Burn, 1 + (sp?.extraBurnStacks ?? 0));
      break;
    case Race.Geists:
      // Bone Knight: burn (soul drain) on melee hit + lifesteal 20% + Wound
      if (isMelee) {
        applyStatus(target, StatusType.Burn, 1 + (sp?.extraBurnStacks ?? 0));
        applyWound(target); // Geists melee applies Wound
        const geistMeleeSteal = Math.round(attacker.damage * 0.20);
        const geistAh = healUnit(attacker, geistMeleeSteal);
        if (geistAh > 0) trackHealing(state, attacker, geistAh);
        if (geistMeleeSteal > 0) addCombatEvent(state, { type: 'lifesteal', x: target.x, y: target.y, x2: attacker.x, y2: attacker.y, color: '#b39ddb' });
      }
      // Wraith Bow: 20% ranged lifesteal is applied via projectile hit logic (tickProjectiles)
      break;
    case Race.Tenders:
      // Treant: slow on melee hit only when upgraded (entangling roots — Radish King G-tier)
      if (isMelee && (sp?.extraSlowStacks ?? 0) > 0) applyStatus(target, StatusType.Slow, sp!.extraSlowStacks!);
      break;
  }

  // === Research race one-shot on-hit effects ===
  const atkPlayer = state.players[attacker.playerId];
  if (atkPlayer) {
    const bu = atkPlayer.researchUpgrades;
    // Goblins Coated Blades: +1 Burn on melee
    if (isMelee && bu.raceUpgrades['goblins_melee_1']) applyStatus(target, StatusType.Burn, 1);
    // Demon Infernal Rage: +25% vs burning targets (melee)
    // (handled as bonus damage in combat tick — not here, since dealDamage already called)
    // Horde Blood Rage: +20% dmg when <50% HP (handled at damage calc time)
    // Deep Crushing Depths: +20% vs slowed (handled at damage calc time)
    // Crown Royal Guard: +2g on kill (handled in dealDamage kill section)
    // Wild Predator's Mark: marked target takes +15% from all
    if (bu.raceUpgrades['wild_ranged_2'] && attacker.category === 'ranged') {
      applyStatus(target, StatusType.Slow, 1);
    }
    // Horde Heavy Bolts: +1 Slow on ranged hit
    if (!isMelee && bu.raceUpgrades['horde_ranged_1']) applyWound(target); // Heavy Bolts: Wound on ranged hit
    // Deep Frozen Harpoons: +1 Slow on ranged hit
    if (!isMelee && bu.raceUpgrades['deep_ranged_1']) applyStatus(target, StatusType.Slow, 1);
    // Wild Venomous Fangs: +1 Burn + Wound on ranged hit
    if (!isMelee && bu.raceUpgrades['wild_ranged_1']) { applyStatus(target, StatusType.Burn, 1); applyWound(target); }
    // Tenders Root Snare: 20% chance +1 Slow on ranged hit
    if (!isMelee && bu.raceUpgrades['tenders_ranged_2'] && state.rng() < 0.20) applyStatus(target, StatusType.Slow, 1);
    // Geists Death Grip: lifesteal 15->25% (melee)
    if (isMelee && bu.raceUpgrades['geists_melee_1']) {
      // Extra 10% lifesteal (15% base already applied above)
      const extraSteal = Math.round(attacker.damage * 0.10);
      if (extraSteal > 0) {
        const eah = healUnit(attacker, extraSteal);
        if (eah > 0) trackHealing(state, attacker, eah);
      }
    }
    // Geists Soul Arrows: +10% lifesteal on ranged (handled via projectile)
  }
}

const COLLISION_BUILDING_RADIUS = 0.8;
const COLLISION_GOLD_CELL_RADIUS = 0.58;
const UNIT_COLLISION_RADIUS = 0.45; // hard collision circle per unit
const UNIT_COLLISION_PUSH_STRENGTH = 0.5; // how aggressively units push apart (0-1)

function pushOutFromPoint(unit: UnitState, cx: number, cy: number, radius: number): void {
  const dx = unit.x - cx;
  const dy = unit.y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist >= radius) return;
  if (dist < 0.0001) {
    unit.x += radius;
    return;
  }
  const push = radius - dist;
  unit.x += (dx / dist) * push;
  unit.y += (dy / dist) * push;
}

function clampToArenaBounds(pos: { x: number; y: number }, radius: number, mapDef?: MapDef): void {
  const mw = mapDef?.width ?? MAP_WIDTH;
  const mh = mapDef?.height ?? MAP_HEIGHT;
  pos.x = Math.max(radius, Math.min(mw - radius, pos.x));
  pos.y = Math.max(radius, Math.min(mh - radius, pos.y));
  if (mapDef) {
    // Use map's playable range along the shape axis
    if (mapDef.shapeAxis === 'x') {
      const range = mapDef.getPlayableRange(pos.x);
      pos.y = Math.max(range.min + radius, Math.min(range.max - radius, pos.y));
    } else {
      const range = mapDef.getPlayableRange(pos.y);
      pos.x = Math.max(range.min + radius, Math.min(range.max - radius, pos.x));
    }
  } else {
    const margin = getMarginAtRow(pos.y);
    pos.x = Math.max(margin + radius, Math.min(mw - margin - radius, pos.x));
  }
}

/** Check if a point is inside an HQ ellipse (with padding). */
function isInsideHQEllipse(x: number, y: number, rx: number, ry: number, rw: number, rh: number, pad: number): boolean {
  const cx = rx + rw / 2;
  const cy = ry + rh / 2;
  const a = rw / 2 + pad;  // horizontal semi-axis
  const b = rh / 2 + pad;  // vertical semi-axis
  const dx = (x - cx) / a;
  const dy = (y - cy) / b;
  return dx * dx + dy * dy < 1;
}

/** Check if a point is inside either HQ ellipse. (Currently disabled) */
function isInsideAnyHQ(_x: number, _y: number, _pad: number): boolean {
  return false;
}

/** Check if a point is inside an unmined gold cell in the diamond. */
function isInsideUnminedDiamond(x: number, y: number, pad: number, _cells: GoldCell[], mapDef?: MapDef): boolean {
  // Quick bounding diamond check first
  const dcx = mapDef?.diamondCenter.x ?? DIAMOND_CENTER_X;
  const dcy = mapDef?.diamondCenter.y ?? DIAMOND_CENTER_Y;
  const dhw = mapDef?.diamondHalfW ?? DIAMOND_HALF_W;
  const dhh = mapDef?.diamondHalfH ?? DIAMOND_HALF_H;
  const dx = Math.abs(x - dcx) / (dhw + pad);
  const dy = Math.abs(y - dcy) / (dhh + pad);
  if (dx + dy > 1.1) return false; // outside diamond shape entirely

  // O(1) lookup via cell map when available
  const tileX = Math.floor(x);
  const tileY = Math.floor(y);
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = tileX + ox;
      const cy = tileY + oy;
      const cell = _diamondCellMapInt.get(cx * 10000 + cy);
      if (cell && cell.gold > 0) {
        const cellCx = cell.tileX + 0.5;
        const cellCy = cell.tileY + 0.5;
        const d = Math.sqrt((x - cellCx) ** 2 + (y - cellCy) ** 2);
        if (d < COLLISION_GOLD_CELL_RADIUS + pad) return true;
      }
    }
  }
  return false;
}

/** Check if a position is blocked by any solid obstacle (HQ or unmined diamond cells). */
function isBlocked(x: number, y: number, pad: number, cells: GoldCell[], mapDef?: MapDef): boolean {
  return isInsideAnyHQ(x, y, pad) || isInsideUnminedDiamond(x, y, pad, cells, mapDef);
}

// ---- A* Tile Pathfinding ----

const SQRT2 = Math.sqrt(2);
const ASTAR_DIRS = [
  { dx: 1, dy: 0, cost: 1 },  { dx: -1, dy: 0, cost: 1 },
  { dx: 0, dy: 1, cost: 1 },  { dx: 0, dy: -1, cost: 1 },
  { dx: 1, dy: 1, cost: SQRT2 },  { dx: -1, dy: 1, cost: SQRT2 },
  { dx: 1, dy: -1, cost: SQRT2 }, { dx: -1, dy: -1, cost: SQRT2 },
];

/** Is a tile center blocked by unmined diamond cells or outside the playable area? */
function isTileWalkable(tx: number, ty: number, cells: GoldCell[], mapDef?: MapDef): boolean {
  const w = mapDef?.width ?? MAP_WIDTH;
  const h = mapDef?.height ?? MAP_HEIGHT;
  if (tx < 0 || ty < 0 || tx >= w || ty >= h) return false;
  if (mapDef && !mapDef.isPlayable(tx, ty)) return false;
  return !isInsideUnminedDiamond(tx + 0.5, ty + 0.5, 0.45, cells, mapDef);
}

/** Octile distance heuristic (admissible for 8-directional movement). */
function octileH(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
  return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
}

/**
 * Check if a straight line between two world positions is unobstructed
 * by unmined diamond cells and stays within the playable area.
 * Samples every ~0.5 tiles.
 */
function hasLineOfSight(ax: number, ay: number, bx: number, by: number, cells: GoldCell[], mapDef?: MapDef): boolean {
  const dx = bx - ax, dy = by - ay;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.5) return true;
  const steps = Math.max(4, Math.ceil(dist * 2));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = ax + dx * t, py = ay + dy * t;
    if (isInsideUnminedDiamond(px, py, 0.45, cells, mapDef)) return false;
    if (mapDef && !mapDef.isPlayable(Math.floor(px), Math.floor(py))) return false;
  }
  return true;
}

/**
 * A* pathfinding on the tile grid. Returns world-coordinate waypoints
 * (tile centers) from start to goal, or null if no path exists.
 * Max 3000 node expansions to bound cost on large maps.
 */
function findTilePath(
  startX: number, startY: number, goalX: number, goalY: number,
  cells: GoldCell[], mapDef?: MapDef,
): { x: number; y: number }[] | null {
  const w = mapDef?.width ?? MAP_WIDTH;
  const h = mapDef?.height ?? MAP_HEIGHT;

  const sx = Math.max(0, Math.min(w - 1, Math.floor(startX)));
  const sy = Math.max(0, Math.min(h - 1, Math.floor(startY)));
  const gx = Math.max(0, Math.min(w - 1, Math.floor(goalX)));
  const gy = Math.max(0, Math.min(h - 1, Math.floor(goalY)));
  if (sx === gx && sy === gy) return [];

  // If goal tile is blocked, bail — caller will fall back to moveWithSlide
  if (!isTileWalkable(gx, gy, cells, mapDef)) return null;

  const idx = (x: number, y: number) => y * w + x;
  const size = w * h;

  const gScore = new Float32Array(size).fill(Infinity);
  const fArr = new Float32Array(size).fill(Infinity);
  const parentIdx = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);

  // Binary min-heap storing tile indices, ordered by fArr
  const heap: number[] = [];

  function heapPush(ti: number): void {
    heap.push(ti);
    let i = heap.length - 1;
    while (i > 0) {
      const pi = (i - 1) >> 1;
      if (fArr[heap[pi]] <= fArr[heap[i]]) break;
      const tmp = heap[pi]; heap[pi] = heap[i]; heap[i] = tmp;
      i = pi;
    }
  }
  function heapPop(): number {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        let min = i;
        const l = 2 * i + 1, r = 2 * i + 2;
        if (l < heap.length && fArr[heap[l]] < fArr[heap[min]]) min = l;
        if (r < heap.length && fArr[heap[r]] < fArr[heap[min]]) min = r;
        if (min === i) break;
        const tmp = heap[i]; heap[i] = heap[min]; heap[min] = tmp;
        i = min;
      }
    }
    return top;
  }

  const si = idx(sx, sy);
  gScore[si] = 0;
  fArr[si] = octileH(sx, sy, gx, gy);
  heapPush(si);

  let expansions = 0;
  const gi = idx(gx, gy);

  while (heap.length > 0) {
    const cur = heapPop();
    if (cur === gi) {
      // Reconstruct path (tile centers as world coords)
      const path: { x: number; y: number }[] = [];
      let ci = cur;
      while (ci !== si) {
        const cx = ci % w, cy = (ci - cx) / w;
        path.push({ x: cx + 0.5, y: cy + 0.5 });
        ci = parentIdx[ci];
      }
      path.reverse();
      return path;
    }

    if (closed[cur]) continue;
    closed[cur] = 1;
    if (++expansions > 3000) return null; // safety cap

    const cx = cur % w, cy = (cur - cx) / w;

    for (let d = 0; d < 8; d++) {
      const dir = ASTAR_DIRS[d];
      const nx = cx + dir.dx, ny = cy + dir.dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = idx(nx, ny);
      if (closed[ni]) continue;
      if (!isTileWalkable(nx, ny, cells, mapDef)) continue;

      // Prevent diagonal corner-cutting through blocked tiles
      if (dir.dx !== 0 && dir.dy !== 0) {
        if (!isTileWalkable(cx + dir.dx, cy, cells, mapDef) ||
            !isTileWalkable(cx, cy + dir.dy, cells, mapDef)) continue;
      }

      const ng = gScore[cur] + dir.cost;
      if (ng < gScore[ni]) {
        parentIdx[ni] = cur;
        gScore[ni] = ng;
        fArr[ni] = ng + octileH(nx, ny, gx, gy);
        heapPush(ni);
      }
    }
  }
  return null; // no path
}

/**
 * Simplify an A* tile path by removing waypoints that have
 * clear line-of-sight to later waypoints.
 */
function smoothPath(path: { x: number; y: number }[], cells: GoldCell[], mapDef?: MapDef): { x: number; y: number }[] {
  if (path.length <= 2) return path;
  const result: { x: number; y: number }[] = [path[0]];
  let cur = 0;
  while (cur < path.length - 1) {
    // Greedily skip to the furthest visible waypoint
    let furthest = cur + 1;
    for (let i = path.length - 1; i > cur + 1; i--) {
      if (hasLineOfSight(path[cur].x, path[cur].y, path[i].x, path[i].y, cells, mapDef)) {
        furthest = i;
        break;
      }
    }
    result.push(path[furthest]);
    cur = furthest;
  }
  return result;
}

/**
 * Compute a smoothed A* path for a harvester, or return [] if direct
 * movement is fine (no diamond in the way).
 */
function computeHarvesterPath(sx: number, sy: number, tx: number, ty: number, cells: GoldCell[], mapDef?: MapDef): { x: number; y: number }[] {
  if (hasLineOfSight(sx, sy, tx, ty, cells, mapDef)) return [];
  const raw = findTilePath(sx, sy, tx, ty, cells, mapDef);
  if (!raw || raw.length === 0) return [];
  return smoothPath(raw, cells, mapDef);
}

/**
 * Returns the center of the nearest blocking obstacle, or null if none.
 * Used for steering around obstacles.
 */
function getNearestObstacleCenter(x: number, y: number, pad: number, cells: GoldCell[], mapDef?: MapDef): { cx: number; cy: number } | null {
  // Check HQs
  const hqB = getHQPosition(Team.Bottom, mapDef);
  const hqT = getHQPosition(Team.Top, mapDef);
  if (isInsideHQEllipse(x, y, hqB.x, hqB.y, HQ_WIDTH, HQ_HEIGHT, pad)) {
    return { cx: hqB.x + HQ_WIDTH / 2, cy: hqB.y + HQ_HEIGHT / 2 };
  }
  if (isInsideHQEllipse(x, y, hqT.x, hqT.y, HQ_WIDTH, HQ_HEIGHT, pad)) {
    return { cx: hqT.x + HQ_WIDTH / 2, cy: hqT.y + HQ_HEIGHT / 2 };
  }
  // Check diamond — treat entire diamond shape as one obstacle with its center
  const dcx = mapDef?.diamondCenter.x ?? DIAMOND_CENTER_X;
  const dcy = mapDef?.diamondCenter.y ?? DIAMOND_CENTER_Y;
  const dhw = mapDef?.diamondHalfW ?? DIAMOND_HALF_W;
  const dhh = mapDef?.diamondHalfH ?? DIAMOND_HALF_H;
  const ddx = Math.abs(x - dcx) / (dhw + pad);
  const ddy = Math.abs(y - dcy) / (dhh + pad);
  if (ddx + ddy < 1.2) {
    // Near the diamond — check if actually blocked by unmined cells
    if (isInsideUnminedDiamond(x, y, pad, cells, mapDef)) {
      return { cx: dcx, cy: dcy };
    }
  }
  return null;
}

/**
 * Move pos toward (tx, ty) by up to `step` tiles, steering around obstacles.
 * If direct path is blocked, steers tangent to the obstacle surface.
 */
function moveWithSlide(pos: { x: number; y: number }, tx: number, ty: number, step: number, diamondCells: GoldCell[] = [], mapDef?: MapDef): void {
  const dx = tx - pos.x;
  const dy = ty - pos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.001) return;
  const dirX = dx / dist;
  const dirY = dy / dist;
  const mx = dirX * step;
  const my = dirY * step;
  const pad = 0.45;

  // Try full move
  const nx = pos.x + mx;
  const ny = pos.y + my;
  if (!isBlocked(nx, ny, pad, diamondCells, mapDef)) {
    pos.x = nx;
    pos.y = ny;
    return;
  }

  // Blocked — find obstacle center and steer tangent to it
  const obstacle = getNearestObstacleCenter(nx, ny, pad, diamondCells, mapDef);
  if (obstacle) {
    // Vector from obstacle center to unit
    const fromCx = pos.x - obstacle.cx;
    const fromCy = pos.y - obstacle.cy;
    const fromLen = Math.sqrt(fromCx * fromCx + fromCy * fromCy);
    if (fromLen > 0.01) {
      // Two tangent directions (perpendicular to radius)
      const perpX1 = -fromCy / fromLen;
      const perpY1 = fromCx / fromLen;
      // Pick the tangent that's more aligned with our desired direction
      const dot1 = perpX1 * dirX + perpY1 * dirY;
      const steerX = dot1 >= 0 ? perpX1 : -perpX1;
      const steerY = dot1 >= 0 ? perpY1 : -perpY1;
      const sx = pos.x + steerX * step;
      const sy = pos.y + steerY * step;
      if (!isBlocked(sx, sy, pad, diamondCells, mapDef)) {
        pos.x = sx;
        pos.y = sy;
        return;
      }
      // Try half-steer (blend forward + tangent) for tighter corners
      const blendX = (dirX + steerX * 2) / 3;
      const blendY = (dirY + steerY * 2) / 3;
      const bLen = Math.sqrt(blendX * blendX + blendY * blendY) || 1;
      const bx = pos.x + (blendX / bLen) * step;
      const by = pos.y + (blendY / bLen) * step;
      if (!isBlocked(bx, by, pad, diamondCells, mapDef)) {
        pos.x = bx;
        pos.y = by;
        return;
      }
    }
  }

  // Fallback: try X-only slide
  if (!isBlocked(pos.x + mx, pos.y, pad, diamondCells, mapDef)) {
    pos.x += mx;
    return;
  }
  // Fallback: try Y-only slide
  if (!isBlocked(pos.x, pos.y + my, pad, diamondCells, mapDef)) {
    pos.y += my;
    return;
  }
  // Fully blocked — pushOut will fix next tick
}


function tickUnitCollision(state: GameState): void {
  const units = state.units;
  const minSep = UNIT_COLLISION_RADIUS * 2; // two radii = minimum distance between centers

  // Unit-vs-unit hard collision — creates battle lines.
  // Spatial grid to avoid O(n^2) — bucket units into 2-tile cells.
  const cellSize = 2;
  const grid = new Map<number, UnitState[]>();
  for (const u of units) {
    if (u.hp <= 0) continue;
    const key = (Math.floor(u.x / cellSize) * 10000) + Math.floor(u.y / cellSize);
    const bucket = grid.get(key);
    if (bucket) bucket.push(u); else grid.set(key, [u]);
  }

  for (const u of units) {
    if (u.hp <= 0) continue;
    const cx = Math.floor(u.x / cellSize);
    const cy = Math.floor(u.y / cellSize);
    // Check 3x3 neighborhood
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const bucket = grid.get(gx * 10000 + gy);
        if (!bucket) continue;
        for (const o of bucket) {
          if (o.id <= u.id || o.hp <= 0) continue; // process each pair once
          let dx = o.x - u.x;
          let dy = o.y - u.y;
          let dist = Math.sqrt(dx * dx + dy * dy);
          if (dist >= minSep) continue;

          // Exact overlap — push apart in deterministic direction based on IDs
          if (dist < 0.0001) {
            const angle = ((u.id * 7 + o.id * 13) % 628) / 100; // deterministic pseudo-angle
            dx = Math.cos(angle);
            dy = Math.sin(angle);
            dist = 1; // dx,dy are already a unit vector — don't re-normalize
          }

          const overlap = minSep - dist;
          const nx = dx / dist;
          const ny = dy / dist;

          // Enemies push harder (forms solid front line), allies push laterally
          const sameTeam = u.team === o.team;
          const strength = sameTeam ? UNIT_COLLISION_PUSH_STRENGTH * 0.65 : UNIT_COLLISION_PUSH_STRENGTH;
          const push = overlap * strength * 0.5; // half to each unit

          u.x -= nx * push;
          u.y -= ny * push;
          o.x += nx * push;
          o.y += ny * push;
        }
      }
    }
  }

  for (const unit of units) {
    // Unit-vs-building blocking (skip spawners — units spawn on them)
    for (const building of state.buildings) {
      if (building.type === BuildingType.MeleeSpawner || building.type === BuildingType.RangedSpawner || building.type === BuildingType.CasterSpawner || building.type === BuildingType.HarvesterHut) continue;
      pushOutFromPoint(unit, building.worldX + 0.5, building.worldY + 0.5, COLLISION_BUILDING_RADIUS);
    }

    // Unit-vs-resource blocking (unmined gold cells are obstacles).
    for (const cell of state.diamondCells) {
      if (cell.gold <= 0) continue;
      pushOutFromPoint(unit, cell.tileX + 0.5, cell.tileY + 0.5, COLLISION_GOLD_CELL_RADIUS);
    }

    clampToArenaBounds(unit, 0.35, state.mapDef);
  }
}

function tickCombat(state: GameState): void {
  // Reuse module-level structures to avoid per-tick allocations
  _unitById.clear();
  for (const u of state.units) _unitById.set(u.id, u);
  const unitById = _unitById;
  _combatGrid.build(state.units);
  const AGGRO_BONUS = 2.5;
  const AGGRO_LEASH = 3.5;
  let meleeHitSounds = 0; // simulation-side throttle (SoundManager has its own per-category cooldown too)

  // Count how many units are already targeting each enemy (for target spreading)
  _attackerCount.clear();
  for (const u of state.units) {
    if (u.hp <= 0 || u.targetId === null) continue;
    _attackerCount.set(u.targetId, (_attackerCount.get(u.targetId) ?? 0) + 1);
  }
  const attackerCount = _attackerCount;

  // Shuffle combat processing order to prevent first-mover advantage
  // Fisher-Yates shuffle using deterministic rng for lockstep safety
  _combatOrder.length = 0;
  for (const u of state.units) _combatOrder.push(u);
  const combatOrder = _combatOrder;
  for (let i = combatOrder.length - 1; i > 0; i--) {
    const j = Math.floor(state.rng() * (i + 1));
    const tmp = combatOrder[i]; combatOrder[i] = combatOrder[j]; combatOrder[j] = tmp;
  }

  for (const unit of combatOrder) {
    // Goblin flee: when below 25% HP, run away for 2 seconds then re-engage
    const ownerRace = state.players[unit.playerId]?.race;
    if (ownerRace === Race.Goblins) {
      if (unit.fleeTimer != null && unit.fleeTimer > 0) {
        unit.fleeTimer--;
        unit.targetId = null; // drop target while fleeing
        // Move backward along path
        if (unit.pathProgress > 0) {
          const speed = getEffectiveSpeed(unit, state) * 1.5; // run faster when fleeing
          const pathLen = getCachedPathLength(unit.team, unit.lane, state.mapDef);
          const path = getLanePath(unit.team, unit.lane, state.mapDef);
          const movePerTick = speed / TICK_RATE;
          // Get backward direction from path tangent — move from ACTUAL position,
          // not from interpolatePath(pathProgress). pathProgress can diverge far
          // from x/y after combat chase moves, so snapping to it would teleport.
          const p0 = interpolatePath(path, Math.max(0, unit.pathProgress - 0.02));
          const p1 = interpolatePath(path, unit.pathProgress);
          const fwdX = p1.x - p0.x, fwdY = p1.y - p0.y;
          const fwdLen = Math.sqrt(fwdX * fwdX + fwdY * fwdY) || 1;
          unit.x -= (fwdX / fwdLen) * movePerTick;
          unit.y -= (fwdY / fwdLen) * movePerTick;
          clampToArenaBounds(unit, 0.35, state.mapDef);
          unit.pathProgress = Math.max(0, unit.pathProgress - movePerTick / pathLen);
        }
        if (unit.fleeTimer <= 0) {
          // Flee ended — enter cooldown so unit re-engages before fleeing again
          unit.fleeTimer = -3 * TICK_RATE; // 3 second cooldown before can flee again
        }
        continue; // skip combat while fleeing
      }
      // Cooldown ticking (negative fleeTimer = cooldown)
      if (unit.fleeTimer != null && unit.fleeTimer < 0) {
        unit.fleeTimer++;
        // Once cooldown expires, reset to allow another flee
        if (unit.fleeTimer >= 0) unit.fleeTimer = undefined;
      }
      // Trigger flee when dropping below 25% HP
      if (unit.hp > 0 && unit.hp < unit.maxHp * 0.25 && unit.fleeTimer == null) {
        unit.fleeTimer = 2 * TICK_RATE; // 2 seconds of running
        unit.targetId = null;
        continue;
      }
    }

    // Check if current target is still valid
    if (unit.targetId !== null) {
      const target = unitById.get(unit.targetId);
      if (!target || target.hp <= 0) unit.targetId = null;
      else {
        const dist = Math.sqrt((target.x - unit.x) ** 2 + (target.y - unit.y) ** 2);
        if (dist > unit.range + AGGRO_LEASH) unit.targetId = null;
      }
    }
    // Acquire new target — spread across enemies to form a battle line
    // Siege units never lock onto units — they follow their lane path and fire at buildings
    if (unit.targetId === null && !unit.upgradeSpecial?.isSiegeUnit) {
      let best: UnitState | null = null;
      let bestScore = Infinity;
      const aggroRange = unit.range + AGGRO_BONUS;
      for (const o of _combatGrid.getNearby(unit.x, unit.y, aggroRange)) {
        if (o.team === unit.team) continue;
        const d = Math.sqrt((o.x - unit.x) ** 2 + (o.y - unit.y) ** 2);
        if (d > aggroRange) continue;
        // Penalize targets that already have many melee attackers
        // so units spread across the front line instead of dog-piling.
        // Cap at 3 tiles so units don't ignore nearby enemies to walk past them.
        const attackers = attackerCount.get(o.id) ?? 0;
        const crowdPenalty = unit.range <= 2
          ? Math.min(attackers * 1.2, 3.0)
          : attackers * 0.3;
        const score = d + crowdPenalty;
        if (score < bestScore) { best = o; bestScore = score; }
      }
      if (best) {
        unit.targetId = best.id;
        unit.stuckTicks = 0; // clear stuck counter — unit is now actively engaging
        attackerCount.set(best.id, (attackerCount.get(best.id) ?? 0) + 1);
      }
    }

    // Chase current target — all unit types try to reach optimal range.
    // Units steer around allied blockers to find openings and envelop enemies.
    if (unit.targetId !== null) {
      const target = unitById.get(unit.targetId);
      if (target) {
        const dx = target.x - unit.x;
        const dy = target.y - unit.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const isMelee = unit.range <= 2;

        const tooFar = dist > unit.range + 0.15;
        const tooClose = !isMelee && dist < unit.range * 0.4 && dist > 0.5;

        if ((tooFar || tooClose) && dist > 0.001) {
          const movePerTick = getEffectiveSpeed(unit, state) / TICK_RATE;

          // Direction toward (or away from) target
          const dirX = dx / dist, dirY = dy / dist;
          const chaseDir = tooClose ? -1 : 1; // retreat if too close (ranged)

          // Count allies blocking the path to the target
          let blockCount = 0;
          let blockCx = 0, blockCy = 0;
          if (tooFar) {
            for (const ally of _combatGrid.getNearby(unit.x, unit.y, 3.0)) {
              if (ally.id === unit.id || ally.team !== unit.team) continue;
              const ax = ally.x - unit.x, ay = ally.y - unit.y;
              const ad = Math.sqrt(ax * ax + ay * ay);
              if (ad > 3.0 || ad < 0.1) continue;
              // Is ally between us and the target?
              const dot = (ax * dirX + ay * dirY) / ad;
              if (dot > 0.2) {
                const cross = Math.abs(ax * dirY - ay * dirX);
                if (cross < 1.5) {
                  blockCount++;
                  blockCx += ally.x;
                  blockCy += ally.y;
                }
              }
            }
          }

          let goalX: number, goalY: number;
          let step: number;

          if (blockCount >= 1 && tooFar) {
            // Flanking: steer around allied blockers
            blockCx /= blockCount;
            blockCy /= blockCount;
            const perpX = -dirY, perpY = dirX;
            // Choose side: away from blocker centroid
            const toBcx = blockCx - unit.x, toBcy = blockCy - unit.y;
            const side = perpX * toBcx + perpY * toBcy;
            const flankX = side > 0 ? -perpX : perpX;
            const flankY = side > 0 ? -perpY : perpY;
            // Heavier flanking with more blockers, melee flanks harder than ranged
            const blend = isMelee
              ? (blockCount >= 3 ? 0.85 : blockCount >= 2 ? 0.7 : 0.55)
              : (blockCount >= 2 ? 0.5 : 0.35);
            const steerX = dirX * (1 - blend) + flankX * blend;
            const steerY = dirY * (1 - blend) + flankY * blend;
            const sLen = Math.sqrt(steerX * steerX + steerY * steerY) || 1;
            step = movePerTick;
            goalX = unit.x + (steerX / sLen) * step * 4;
            goalY = unit.y + (steerY / sLen) * step * 4;
          } else {
            // Direct chase (or retreat for ranged too close)
            step = tooFar ? Math.min(movePerTick, dist - unit.range) : movePerTick * 0.6;
            goalX = unit.x + dirX * chaseDir * step * 4;
            goalY = unit.y + dirY * chaseDir * step * 4;
          }

          moveWithSlide(unit, goalX, goalY, step, state.diamondCells, state.mapDef);
          clampToArenaBounds(unit, 0.35, state.mapDef);
        } else if (dist > 0.5) {
          // In range — gentle lateral drift so units spread the battle line
          // instead of stacking on the same spot.
          const movePerTick = getEffectiveSpeed(unit, state) / TICK_RATE;
          const perpX = -dy / dist, perpY = dx / dist;
          let lateralForce = 0;
          for (const ally of _combatGrid.getNearby(unit.x, unit.y, 2.0)) {
            if (ally.id === unit.id || ally.team !== unit.team) continue;
            const ax = ally.x - unit.x, ay = ally.y - unit.y;
            const ad = Math.sqrt(ax * ax + ay * ay);
            if (ad > 2.0 || ad < 0.05) continue;
            const proj = ax * perpX + ay * perpY;
            const urgency = (2.0 - ad) / 2.0;
            lateralForce -= proj * urgency * 0.3;
          }
          if (Math.abs(lateralForce) > 0.02) {
            const driftStep = movePerTick * 0.25;
            const sign = lateralForce > 0 ? 1 : -1;
            const nx = unit.x + perpX * sign * driftStep * 3;
            const ny = unit.y + perpY * sign * driftStep * 3;
            moveWithSlide(unit, nx, ny, driftStep, state.diamondCells, state.mapDef);
            clampToArenaBounds(unit, 0.35, state.mapDef);
          }
        }
      }
    }

    // Siege units: always prioritize building targets — fire cannonball at nearest enemy building in range
    if (unit.upgradeSpecial?.isSiegeUnit && unit.attackTimer <= 0 && unit.range > 2) {
      const sp = unit.upgradeSpecial;
      let bestSiegeBuilding: BuildingState | null = null;
      let bestSiegeDist = Infinity;
      for (const b of state.buildings) {
        if (b.buildGrid !== 'alley') continue; // only alley buildings are targetable
        const bPlayer = state.players[b.playerId];
        if (!bPlayer || bPlayer.team === unit.team) continue;
        if (b.hp <= 0) continue;
        const bd = Math.sqrt((b.worldX - unit.x) ** 2 + (b.worldY - unit.y) ** 2);
        if (bd <= unit.range + 0.15 && bd < bestSiegeDist) { bestSiegeBuilding = b; bestSiegeDist = bd; }
      }
      if (bestSiegeBuilding) {
        const effDmg = getEffectiveDamage(unit, state);
        state.projectiles.push({
          id: genId(state), x: unit.x, y: unit.y,
          targetId: 0,
          targetX: bestSiegeBuilding.worldX,
          targetY: bestSiegeBuilding.worldY,
          damage: effDmg,
          speed: 8, aoeRadius: sp?.splashRadius ?? 3, team: unit.team, visual: 'cannonball',
          sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
          splashDamagePct: sp?.splashDamagePct ?? 0.60,
          buildingDamageMult: sp?.buildingDamageMult ?? 3.0,
          extraBurnStacks: sp?.extraBurnStacks,
          extraSlowStacks: sp?.extraSlowStacks,
        });
        unit.attackTimer = Math.round(unit.attackSpeed * TICK_RATE);
        addSound(state, 'ranged_hit', unit.x, unit.y);
        continue; // skip regular attack this tick
      }
    }

    // Attack — tolerance of 0.15 tiles so units that are clamped/blocked
    // just outside nominal range can still attack (prevents whiff bug).
    if (unit.targetId !== null && unit.attackTimer <= 0) {
      const target = unitById.get(unit.targetId);
      if (target) {
        const targetDist = Math.sqrt((target.x - unit.x) ** 2 + (target.y - unit.y) ** 2);
        if (targetDist > unit.range + 0.15) {
          // Not in attack range yet (still chasing).
          if (unit.attackTimer > 0) unit.attackTimer--;
          continue;
        }

        const race = state.players[unit.playerId].race;
        const isCaster = unit.category === 'caster';

        if (isCaster && race !== Race.Demon) {
          // Support casters: perform support ability + fire AoE at enemy
          const sp = unit.upgradeSpecial;
          const isCrownMage = race === Race.Crown && sp?.crownMage;

          // Crown mage branch skips shielding — pure damage dealer
          if (!isCrownMage) {
            applyCasterSupport(state, unit, race, sp);
          }

          // Geists caster: single-target projectile (no AoE — summons skeletons from deaths instead)
          if (race === Race.Geists) {
            const effDmg = getEffectiveDamage(unit, state);
            state.projectiles.push({
              id: genId(state), x: unit.x, y: unit.y,
              targetId: target.id, damage: effDmg,
              speed: 12, aoeRadius: 0, team: unit.team, visual: 'circle',
              sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
              extraBurnStacks: sp?.extraBurnStacks,
              lifestealPct: 0.2,
            });
          } else if (isCrownMage) {
            // Crown mage branch: high-damage AoE with spell effects
            const aoeRadius = 3 + (sp?.aoeRadiusBonus ?? 0);
            const effDmg = getEffectiveDamage(unit, state);
            state.projectiles.push({
              id: genId(state), x: unit.x, y: unit.y,
              targetId: target.id, damage: effDmg,
              speed: 10, aoeRadius, team: unit.team, visual: 'circle',
              sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
              extraBurnStacks: sp?.extraBurnStacks,
            });
            addCombatEvent(state, { type: 'pulse', x: unit.x, y: unit.y, radius: aoeRadius, color: '#ffd700' });
          } else if (race !== Race.Crown) {
          // Crown (shield caster) doesn't fire AoE projectile
            let aoeRadius = (race === Race.Deep || race === Race.Tenders ? 4 : 3) + (sp?.aoeRadiusBonus ?? 0);
            // Research: Wild Nature's Wrath — +1 AoE radius for caster
            const cbuGen = state.players[unit.playerId]?.researchUpgrades;
            if (cbuGen?.raceUpgrades['wild_caster_1']) aoeRadius += 1;
            const effDmg = getEffectiveDamage(unit, state);
            state.projectiles.push({
              id: genId(state), x: unit.x, y: unit.y,
              targetId: target.id, damage: effDmg,
              speed: 10, aoeRadius, team: unit.team, visual: 'circle',
              sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
              extraBurnStacks: sp?.extraBurnStacks,
              extraSlowStacks: sp?.extraSlowStacks,
            });
          }
        } else if (isCaster) {
          // Demon caster: pure damage AoE, no support
          const sp = unit.upgradeSpecial;
          const cbu = state.players[unit.playerId]?.researchUpgrades;
          let aoeRadius = 3 + (sp?.aoeRadiusBonus ?? 0);
          // Research: Demon Eye of Destruction — +1.5 AoE radius for caster
          if (cbu?.raceUpgrades['demon_ranged_2']) aoeRadius += 1.5;
          const effDmg = getEffectiveDamage(unit, state);
          state.projectiles.push({
            id: genId(state), x: unit.x, y: unit.y,
            targetId: target.id, damage: effDmg,
            speed: 10, aoeRadius, team: unit.team, visual: 'circle',
            sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
            extraBurnStacks: sp?.extraBurnStacks,
            extraSlowStacks: sp?.extraSlowStacks,
          });
        } else if (unit.range > 2) {
          // Ranged unit: fire projectile
          const sp = unit.upgradeSpecial;
          const splashR = sp?.splashRadius ?? 0;
          let effDmg = getEffectiveDamage(unit, state);
          let rangedAoe = splashR;
          let rangedSplashPct = sp?.splashDamagePct;
          // Research ranged upgrades applied at projectile creation
          const rbu = state.players[unit.playerId]?.researchUpgrades;
          if (rbu) {
            // Crown Piercing Arrows: +20% damage
            if (rbu.raceUpgrades['crown_ranged_1']) effDmg = Math.round(effDmg * 1.20);
            // Demon Hellfire Arrows: +10% damage
            if (rbu.raceUpgrades['demon_ranged_1']) effDmg = Math.round(effDmg * 1.10);
            // Horde Bombardier: add AoE to ranged projectiles
            if (rbu.raceUpgrades['horde_ranged_2'] && rangedAoe === 0) { rangedAoe = 2.5; rangedSplashPct = 0.30; }
            // Horde Berserker Howl: +15% ranged damage while hasted
            if (rbu.raceUpgrades['horde_caster_2'] && unit.statusEffects.some(e => e.type === StatusType.Haste)) effDmg = Math.round(effDmg * 1.15);
            // Deep Anchor Shot: +50% damage for siege units
            if (rbu.raceUpgrades['deep_ranged_2'] && (sp?.isSiegeUnit ?? false)) effDmg = Math.round(effDmg * 1.50);
          }
          const isSiege = sp?.isSiegeUnit ?? false;
          state.projectiles.push({
            id: genId(state), x: unit.x, y: unit.y,
            targetId: target.id, damage: effDmg,
            speed: isSiege ? 8 : 15,
            aoeRadius: rangedAoe, team: unit.team,
            visual: isSiege ? 'cannonball' : (RANGED_VISUAL[race] ?? 'arrow'),
            sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
            extraBurnStacks: sp?.extraBurnStacks,
            extraSlowStacks: sp?.extraSlowStacks,
            splashDamagePct: rangedSplashPct,
            lifestealPct: isSiege ? (sp?.lifestealPct) : (race === Race.Geists ? 0.2 : undefined),
            buildingDamageMult: isSiege ? (sp?.buildingDamageMult ?? 3.0) : undefined,
          });
          // Research: Crown Volley — fire extra projectile at 40% damage
          if (rbu?.raceUpgrades['crown_ranged_2']) {
            state.projectiles.push({
              id: genId(state), x: unit.x, y: unit.y,
              targetId: target.id, damage: Math.round(effDmg * 0.40),
              speed: 15, aoeRadius: 0, team: unit.team, visual: RANGED_VISUAL[race] ?? 'arrow',
              sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
            });
          }
          // Research: Goblins Scatter Shot — 15% chance extra projectile
          if (rbu?.raceUpgrades['goblins_ranged_2'] && state.rng() < 0.15) {
            state.projectiles.push({
              id: genId(state), x: unit.x, y: unit.y,
              targetId: target.id, damage: effDmg,
              speed: 15, aoeRadius: 0, team: unit.team, visual: RANGED_VISUAL[race] ?? 'arrow',
              sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
              extraBurnStacks: sp?.extraBurnStacks,
              extraSlowStacks: sp?.extraSlowStacks,
            });
          }
          // Research: Geists Phantom Volley — 15% chance extra projectile at nearby different enemy
          if (rbu?.raceUpgrades['geists_ranged_2'] && state.rng() < 0.15) {
            let pvTarget: UnitState | undefined;
            let pvBestDist = Infinity;
            for (const o of _combatGrid.getNearby(unit.x, unit.y, unit.range)) {
              if (o.team === unit.team || o.id === target.id) continue;
              const pvd = Math.sqrt((o.x - unit.x) ** 2 + (o.y - unit.y) ** 2);
              if (pvd <= unit.range && (pvd < pvBestDist || (pvd === pvBestDist && (!pvTarget || o.id < pvTarget.id)))) {
                pvTarget = o; pvBestDist = pvd;
              }
            }
            if (pvTarget) {
              state.projectiles.push({
                id: genId(state), x: unit.x, y: unit.y,
                targetId: pvTarget.id, damage: effDmg,
                speed: 15, aoeRadius: 0, team: unit.team, visual: RANGED_VISUAL[race] ?? 'arrow',
                sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
                lifestealPct: 0.2,
              });
            }
          }
          // Multishot: extra projectiles at nearby enemies
          const msCount = sp?.multishotCount ?? 0;
          if (msCount > 0) {
            const msDmg = Math.round(effDmg * (sp?.multishotDamagePct ?? 0.5));
            const nearby: { u: UnitState; d: number }[] = [];
            for (const o of _combatGrid.getNearby(unit.x, unit.y, unit.range)) {
              if (o.team === unit.team || o.id === target.id) continue;
              const d = Math.sqrt((o.x - unit.x) ** 2 + (o.y - unit.y) ** 2);
              if (d <= unit.range) nearby.push({ u: o, d });
            }
            nearby.sort((a, b) => a.d - b.d || a.u.id - b.u.id);
            for (let mi = 0; mi < Math.min(msCount, nearby.length); mi++) {
              state.projectiles.push({
                id: genId(state), x: unit.x, y: unit.y,
                targetId: nearby[mi].u.id, damage: msDmg,
                speed: 15, aoeRadius: 0, team: unit.team, visual: RANGED_VISUAL[race] ?? 'arrow',
                sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
                extraBurnStacks: sp?.extraBurnStacks,
                extraSlowStacks: sp?.extraSlowStacks,
                lifestealPct: race === Race.Geists ? 0.2 : undefined,
              });
            }
          }
          // Oozlings ranged: chain to nearby enemies
          if (race === Race.Oozlings) {
            const chainCount = 1 + (sp?.extraChainTargets ?? 0);
            const chainPct = sp?.chainDamagePct ?? 0.5;
            const chained: number[] = [target.id];
            let lastX = target.x, lastY = target.y;
            for (let ci = 0; ci < chainCount; ci++) {
              let chainTarget: UnitState | null = null;
              let chainDist = Infinity;
              for (const o of _combatGrid.getNearby(lastX, lastY, 4)) {
                if (o.team === unit.team || chained.includes(o.id)) continue;
                const d = Math.sqrt((o.x - lastX) ** 2 + (o.y - lastY) ** 2);
                if (d <= 4 && d < chainDist) { chainTarget = o; chainDist = d; }
              }
              if (!chainTarget) break;
              chained.push(chainTarget.id);
              addCombatEvent(state, { type: 'chain', x: lastX, y: lastY, x2: chainTarget.x, y2: chainTarget.y, color: '#76ff03' });
              state.projectiles.push({
                id: genId(state), x: lastX, y: lastY,
                targetId: chainTarget.id, damage: Math.round(getEffectiveDamage(unit, state) * chainPct),
                speed: 20, aoeRadius: 0, team: unit.team, visual: 'orb',
                sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
              });
              lastX = chainTarget.x; lastY = chainTarget.y;
            }
          }
        } else {
          // Melee: instant damage
          const sp = unit.upgradeSpecial;

          // Hop attack: leap to target with AoE slow on landing
          if (sp?.hopAttack) {
            // Visually leap — snap position near target
            const leapDx = target.x - unit.x;
            const leapDy = target.y - unit.y;
            const leapDist = Math.sqrt(leapDx * leapDx + leapDy * leapDy);
            if (leapDist > 1.5) {
              // Move to 1 tile from target
              unit.x = target.x - leapDx / leapDist;
              unit.y = target.y - leapDy / leapDist;
            }
            addCombatEvent(state, { type: 'pulse', x: unit.x, y: unit.y, radius: 3, color: '#2196f3' });
            addSound(state, 'ability_leap', unit.x, unit.y);
            // AoE slow on landing
            for (const nearby of _combatGrid.getNearby(unit.x, unit.y, 3)) {
              if (nearby.team === unit.team) continue;
              const nd = Math.sqrt((nearby.x - unit.x) ** 2 + (nearby.y - unit.y) ** 2);
              if (nd <= 3) {
                applyStatus(nearby, StatusType.Slow, 1 + (sp?.extraSlowStacks ?? 0));
              }
            }
          }

          let meleeDmg = getEffectiveDamage(unit, state);
          // Research race one-shot bonus damage
          const mPlayer = state.players[unit.playerId];
          if (mPlayer) {
            const mbu = mPlayer.researchUpgrades;
            // Horde Blood Rage: +20% when <50% HP
            if (mbu.raceUpgrades['horde_melee_1'] && unit.hp < unit.maxHp * 0.5) meleeDmg = Math.round(meleeDmg * 1.20);
            // Demon Infernal Rage: +25% vs burning
            if (mbu.raceUpgrades['demon_melee_1'] && target.statusEffects.some(e => e.type === StatusType.Burn)) meleeDmg = Math.round(meleeDmg * 1.25);
            // Deep Crushing Depths: +20% vs slowed
            if (mbu.raceUpgrades['deep_melee_2'] && target.statusEffects.some(e => e.type === StatusType.Slow)) meleeDmg = Math.round(meleeDmg * 1.20);
            // Wild Pack Hunter: +5% per nearby ally, max +40%
            if (mbu.raceUpgrades['wild_melee_2']) {
              let nearAllies = 0;
              for (const a of _combatGrid.getNearby(unit.x, unit.y, 4)) {
                if (a.id === unit.id || a.team !== unit.team) continue;
                const ad = Math.sqrt((a.x - unit.x) ** 2 + (a.y - unit.y) ** 2);
                if (ad <= 4) nearAllies++;
              }
              meleeDmg = Math.round(meleeDmg * (1 + Math.min(0.40, nearAllies * 0.05)));
            }
            // Wild Savage Frenzy: +10% extra damage during frenzy
            if (mbu.raceUpgrades['wild_melee_1'] && unit.statusEffects.some(e => e.type === StatusType.Frenzy)) meleeDmg = Math.round(meleeDmg * 1.10);
            // Horde Berserker Howl: +15% damage while hasted
            if (mbu.raceUpgrades['horde_caster_2'] && unit.statusEffects.some(e => e.type === StatusType.Haste)) meleeDmg = Math.round(meleeDmg * 1.15);
          }
          dealDamage(state, target, meleeDmg, meleeDmg >= 5, unit.playerId, unit.id);
          if (meleeHitSounds < 4) { addSound(state, 'melee_hit', unit.x, unit.y); meleeHitSounds++; }
          applyOnHitEffects(state, unit, target);

          // Horde: Trample — War Troll deals AoE trample damage on hit
          if (unit.type === 'War Troll' && mPlayer?.researchUpgrades.raceUpgrades['horde_ability_1']) {
            const trampleDmg = Math.round(meleeDmg * 0.4);
            const trampleRadius = 2.5;
            for (const nearby of _combatGrid.getNearby(unit.x, unit.y, trampleRadius)) {
              if (nearby.team === unit.team || nearby.id === target.id || nearby.hp <= 0) continue;
              const nd2 = (nearby.x - unit.x) ** 2 + (nearby.y - unit.y) ** 2;
              if (nd2 <= trampleRadius * trampleRadius) {
                dealDamage(state, nearby, trampleDmg, false, unit.playerId, unit.id);
              }
            }
          }

          // Cleave: hit additional adjacent enemies
          const cleaveN = sp?.cleaveTargets ?? 0;
          if (cleaveN > 0) {
            const cleaved: UnitState[] = [];
            for (const o of _combatGrid.getNearby(unit.x, unit.y, unit.range + 1.5)) {
              if (o.team === unit.team || o.id === target.id) continue;
              const cd = Math.sqrt((o.x - unit.x) ** 2 + (o.y - unit.y) ** 2);
              if (cd <= unit.range + 1.5) cleaved.push(o);
            }
            // Sort by distance for determinism
            cleaved.sort((a, b) => {
              const da = (a.x - unit.x) ** 2 + (a.y - unit.y) ** 2;
              const db = (b.x - unit.x) ** 2 + (b.y - unit.y) ** 2;
              return da - db || a.id - b.id;
            });
            for (let ci = 0; ci < Math.min(cleaveN, cleaved.length); ci++) {
              const cleaveDmg = Math.round(meleeDmg * 0.6);
              dealDamage(state, cleaved[ci], cleaveDmg, cleaveDmg >= 5, unit.playerId, unit.id);
              applyOnHitEffects(state, unit, cleaved[ci]);
              addCombatEvent(state, { type: 'chain', x: unit.x, y: unit.y, x2: cleaved[ci].x, y2: cleaved[ci].y, color: '#ff9800' });
            }
            if (cleaved.length > 0) {
              addSound(state, 'ability_cleave', unit.x, unit.y);
              if (state.rng() < 0.3) addFloatingText(state, unit.x, unit.y - 0.3, 'CLEAVE', '#ff9800', undefined, true,
                { ftType: 'status', miniIcon: 'sword' });
            }
          }
        }

        unit.attackTimer = Math.round(unit.attackSpeed * TICK_RATE);
      }
    }

    // Attack enemy alley buildings when no unit targets available
    if (!unit.upgradeSpecial?.isSiegeUnit && unit.targetId === null && unit.attackTimer <= 0) {
      let nearestTower: BuildingState | null = null;
      let ntd = Infinity;
      for (const b of state.buildings) {
        if (b.buildGrid !== 'alley') continue; // only alley buildings are targetable
        const bPlayer = state.players[b.playerId];
        if (!bPlayer || bPlayer.team === unit.team) continue;
        if (b.hp <= 0) continue;
        const d = Math.sqrt((b.worldX + 0.5 - unit.x) ** 2 + (b.worldY + 0.5 - unit.y) ** 2);
        if (d <= unit.range + 1.5 && d < ntd) { nearestTower = b; ntd = d; }
      }
      if (nearestTower) {
        const tDmg = getEffectiveDamage(unit, state);
        nearestTower.hp -= tDmg;
        if (state.playerStats[unit.playerId]) state.playerStats[unit.playerId].totalDamageDealt += tDmg;
        addFloatingText(state, nearestTower.worldX, nearestTower.worldY, `${tDmg}`, '#ffffff', undefined, undefined,
          { ftType: 'damage', magnitude: tDmg, miniIcon: 'sword' });
        unit.attackTimer = Math.round(unit.attackSpeed * TICK_RATE);
        if (nearestTower.hp <= 0) {
          addFloatingText(state, nearestTower.worldX, nearestTower.worldY, 'DESTROYED', '#ff0000', undefined, undefined,
          { ftType: 'status' });
          addSound(state, 'building_destroyed', nearestTower.worldX, nearestTower.worldY);
        }
      }
    }

    // Attack enemy HQ when in range (instead of auto-damaging at path end).
    if (unit.targetId === null && unit.attackTimer <= 0) {
      const enemyTeam = unit.team === Team.Bottom ? Team.Top : Team.Bottom;
      const hq = getHQPosition(enemyTeam, state.mapDef);
      const hqCx = hq.x + HQ_WIDTH / 2;
      const hqCy = hq.y + HQ_HEIGHT / 2;
      const hqRadius = Math.max(HQ_WIDTH, HQ_HEIGHT) * 0.5;
      const distToHq = Math.sqrt((unit.x - hqCx) ** 2 + (unit.y - hqCy) ** 2);
      if (distToHq <= unit.range + hqRadius) {
        const hDmg = getEffectiveDamage(unit, state);
        state.hqHp[enemyTeam] -= hDmg;
        if (state.playerStats[unit.playerId]) state.playerStats[unit.playerId].totalDamageDealt += hDmg;
        addFloatingText(state, hqCx, hqCy, `${hDmg}`, '#ffffff', undefined, undefined,
          { ftType: 'damage', magnitude: hDmg, miniIcon: 'sword' });
        addSound(state, 'hq_damaged', hqCx, hqCy);
        unit.attackTimer = Math.round(unit.attackSpeed * TICK_RATE);
      }
    }

    // Deluge: Deep allies attack 2x faster, non-Deep enemies attack at half speed
    const delugeEff = state.abilityEffects.find(e => e.type === 'deep_rain');
    if (delugeEff) {
      const unitRace = state.players[unit.playerId]?.race;
      const isDeep = unitRace === Race.Deep;
      const isDeepAlly = unit.team === delugeEff.team && isDeep;
      if (isDeepAlly) {
        // Deep allies: attack timer ticks down by 2 (2x attack speed)
        if (unit.attackTimer > 0) unit.attackTimer = Math.max(0, unit.attackTimer - 2);
      } else if (!isDeep && state.tick % 2 === 0) {
        // Non-Deep units: attack timer ticks every other tick (half attack speed)
        if (unit.attackTimer > 0) unit.attackTimer--;
      } else {
        // Deep enemies / non-Deep allies: normal tick
        if (unit.attackTimer > 0) unit.attackTimer--;
      }
    } else {
      if (unit.attackTimer > 0) unit.attackTimer--;
    }
  }

  // Remove dead units with particles (check revive first)
  let deathSoundCount = 0;
  for (const u of state.units) {
    if (u.hp > 0) continue;
    const revivePct = u.upgradeSpecial?.reviveHpPct ?? 0;
    if (revivePct > 0) {
      // Revive once: restore HP and clear the special so it doesn't trigger again
      u.hp = Math.max(1, Math.round(u.maxHp * revivePct));
      u.upgradeSpecial = { ...u.upgradeSpecial, reviveHpPct: 0 };
      addFloatingText(state, u.x, u.y, '', '#44ff44', undefined, true,
        { ftType: 'heal', miniIcon: 'heart' });
      addDeathParticles(state, u.x, u.y, '#44ff44', 3);
      addCombatEvent(state, { type: 'revive', x: u.x, y: u.y, color: '#44ff44' });
      continue;
    }
    addDeathParticles(state, u.x, u.y, u.team === Team.Bottom ? '#4488ff' : '#ff4444', 5);
    if (u.carryingDiamond) dropDiamond(state, u.x, u.y);
    // Gold on death (pirate upgrade path)
    const god = u.upgradeSpecial?.goldOnDeath ?? 0;
    if (god > 0) {
      const dp = state.players[u.playerId];
      if (dp) { dp.gold += god; addFloatingText(state, u.x, u.y - 0.3, `+${god}g`, '#ffd700'); }
    }
    if (state.playerStats[u.playerId]) state.playerStats[u.playerId].unitsLost++;
    trackDeathResources(state, u);
    if (deathSoundCount < 3) { addSound(state, 'unit_killed', u.x, u.y); deathSoundCount++; }
    // Research: Oozlings death effects
    const deathPlayer = state.players[u.playerId];
    if (deathPlayer) {
      const dbu = deathPlayer.researchUpgrades;
      // Oozlings Volatile Membrane: melee death AoE — 15 dmg within 2 tiles
      if (dbu.raceUpgrades['oozlings_melee_1'] && u.category === 'melee') {
        for (const enemy of state.units) {
          if (enemy.team === u.team || enemy.hp <= 0) continue;
          const dd = Math.sqrt((enemy.x - u.x) ** 2 + (enemy.y - u.y) ** 2);
          if (dd <= 2) dealDamage(state, enemy, 15, true, u.playerId);
        }
        addCombatEvent(state, { type: 'splash', x: u.x, y: u.y, radius: 2, color: '#76ff03' });
      }
      // Oozlings Mitosis: 10% chance to spawn copy at half stats on melee death
      if (dbu.raceUpgrades['oozlings_melee_2'] && u.category === 'melee' && state.rng() < 0.10) {
        const mitLane = u.lane;
        const mitPath = getLanePath(u.team, mitLane, state.mapDef);
        const mitProg = findNearestPathProgress(mitPath, u.x, u.y);
        state.units.push({
          id: genId(state), type: u.type, playerId: u.playerId, team: u.team,
          x: u.x, y: u.y,
          hp: Math.round(u.maxHp * 0.5), maxHp: Math.round(u.maxHp * 0.5),
          damage: Math.round(u.damage * 0.5),
          attackSpeed: u.attackSpeed, attackTimer: 0, moveSpeed: u.moveSpeed, range: u.range,
          targetId: null, lane: mitLane, pathProgress: mitProg, carryingDiamond: false,
          statusEffects: [], hitCount: 0, shieldHp: 0,
          category: u.category, upgradeTier: u.upgradeTier, upgradeNode: u.upgradeNode,
          upgradeSpecial: {}, kills: 0, damageDone: 0, healingDone: 0, buffsApplied: 0, lastDamagedByName: '', spawnTick: state.tick,
        });
        if (state.playerStats[u.playerId]) state.playerStats[u.playerId].unitsSpawned++;
        addFloatingText(state, u.x, u.y, 'MUTATE', '#76ff03', undefined, true,
          { ftType: 'status' });
      }
      // Oozlings Acid Pool: ranged death AoE — 5 dmg to enemies within 1.5 tiles
      if (dbu.raceUpgrades['oozlings_ranged_2'] && u.category === 'ranged') {
        for (const enemy of state.units) {
          if (enemy.team === u.team || enemy.hp <= 0) continue;
          const dd = Math.sqrt((enemy.x - u.x) ** 2 + (enemy.y - u.y) ** 2);
          if (dd <= 1.5) dealDamage(state, enemy, 5, true, u.playerId);
        }
        addCombatEvent(state, { type: 'splash', x: u.x, y: u.y, radius: 1.5, color: '#69f0ae' });
      }
    }
    // Record fallen heroes (units with kills, healing, or buff contributions)
    if (u.kills > 0 || u.healingDone > 0 || u.buffsApplied > 0) {
      const fallRace = state.players[u.playerId].race;
      const fallBldg = `${u.category}_spawner` as BuildingType;
      state.fallenHeroes.push({
        name: getUpgradeNodeDef(fallRace, fallBldg, u.upgradeNode)?.name ?? u.type,
        playerId: u.playerId, race: fallRace,
        category: u.category, upgradeNode: u.upgradeNode,
        kills: u.kills, damageDone: u.damageDone, healingDone: u.healingDone, buffsApplied: u.buffsApplied,
        survived: false, killedByName: u.lastDamagedByName || 'unknown',
        spawnTick: u.spawnTick, deathTick: state.tick,
      });
    }
  }
  state.units = state.units.filter(u => u.hp > 0);

  // Remove destroyed towers (killed by combat units)
  for (let i = state.buildings.length - 1; i >= 0; i--) {
    const db = state.buildings[i];
    if (db.hp <= 0 && db.type === BuildingType.Tower) {
      // Oozlings Death Burst: globule spawns 3 random ooze on death
      if (db.isGlobule) {
        const gOwner = state.players[db.playerId];
        if (gOwner && gOwner.researchUpgrades.raceUpgrades['oozlings_ability_3']) {
          const categories: BuildingType[] = [BuildingType.MeleeSpawner, BuildingType.RangedSpawner, BuildingType.CasterSpawner];
          const catNames: ('melee' | 'ranged' | 'caster')[] = ['melee', 'ranged', 'caster'];
          for (let di = 0; di < 3; di++) {
            const ci = Math.floor(state.rng() * 3);
            const dStats = UNIT_STATS[gOwner.race]?.[categories[ci]];
            if (!dStats) continue;
            const dlane = state.rng() < 0.5 ? Lane.Left : Lane.Right;
            const dPath = getLanePath(gOwner.team, dlane, state.mapDef);
            const dProg = findNearestPathProgress(dPath, db.worldX, db.worldY);
            state.units.push({
              id: genId(state), type: dStats.name, playerId: db.playerId, team: gOwner.team,
              x: db.worldX + (state.rng() - 0.5), y: db.worldY + (state.rng() - 0.5),
              hp: dStats.hp, maxHp: dStats.hp, damage: dStats.damage,
              attackSpeed: dStats.attackSpeed, attackTimer: 0, moveSpeed: dStats.moveSpeed, range: dStats.range,
              targetId: null, lane: dlane, pathProgress: dProg, carryingDiamond: false,
              statusEffects: [], hitCount: 0, shieldHp: 0, category: catNames[ci],
              upgradeTier: 0, upgradeNode: 'A', upgradeSpecial: {},
              kills: 0, damageDone: 0, healingDone: 0, buffsApplied: 0, lastDamagedByName: '', spawnTick: state.tick,
            });
          }
          addFloatingText(state, db.worldX, db.worldY, 'DEATH BURST!', '#69f0ae');
        }
      }
      state.buildings.splice(i, 1);
    }
  }
}

// === Tower Combat ===

function tickHQDefense(state: GameState): void {
  const HQ_RANGE = 11;
  const HQ_DAMAGE = 18;
  const HQ_COOLDOWN_TICKS = Math.round(1.32 * TICK_RATE); // 10% slower

  for (const team of [Team.Bottom, Team.Top]) {
    state.hqAttackTimer[team]--;
    if (state.hqAttackTimer[team] > 0) continue;

    const enemyTeam = team === Team.Bottom ? Team.Top : Team.Bottom;
    const hq = getHQPosition(team, state.mapDef);
    const hx = hq.x + HQ_WIDTH / 2;
    const hy = hq.y + HQ_HEIGHT / 2;

    // Find closest enemy unit in range
    let closest: UnitState | null = null;
    let closestDist = Infinity;
    for (const u of state.units) {
      if (u.team !== enemyTeam) continue;
      const d = Math.sqrt((u.x - hx) ** 2 + (u.y - hy) ** 2);
      if (d <= HQ_RANGE && d < closestDist) {
        closest = u;
        closestDist = d;
      }
    }

    if (closest) {
      // Fire a cannonball from the HQ — splash damage in area
      state.projectiles.push({
        id: genId(state),
        x: hx, y: hy,
        targetId: closest.id,
        damage: HQ_DAMAGE,
        speed: 8,
        aoeRadius: 4,
        team, visual: 'cannonball',
        sourcePlayerId: -1, // HQ has no specific player owner
        splashDamagePct: 0.5,
      });
      state.hqAttackTimer[team] = HQ_COOLDOWN_TICKS;
      continue;
    }

    // If no enemy units are nearby, HQ can still defend against harvesters (direct damage).
    let closestHarv: HarvesterState | null = null;
    let closestHarvDist = Infinity;
    for (const h of state.harvesters) {
      if (h.team !== enemyTeam || h.state === 'dead') continue;
      const d = Math.sqrt((h.x - hx) ** 2 + (h.y - hy) ** 2);
      if (d <= HQ_RANGE && d < closestHarvDist) {
        closestHarv = h;
        closestHarvDist = d;
      }
    }
    if (!closestHarv) continue;

    closestHarv.hp -= HQ_DAMAGE;
    addFloatingText(state, closestHarv.x, closestHarv.y, `${HQ_DAMAGE}`, '#ffffff', undefined, undefined,
      { ftType: 'damage', magnitude: HQ_DAMAGE, miniIcon: 'sword' });
    if (closestHarv.hp <= 0) {
      addDeathParticles(state, closestHarv.x, closestHarv.y, '#ffaa00', 4);
      killHarvester(state, closestHarv);
    }
    state.hqAttackTimer[team] = HQ_COOLDOWN_TICKS;
  }
}

function tickTowers(state: GameState): void {
  let towerFireSounds = 0;
  for (const building of state.buildings) {
    if (building.type !== BuildingType.Tower) continue;
    // Skip special ability buildings that use Tower type but don't shoot
    if (building.isFoundry || building.isPotionShop || building.isGlobule || building.isSeed) continue;

    const player = state.players[building.playerId];
    const baseStats = TOWER_STATS[player.race];
    const upgrade = getUnitUpgradeMultipliers(building.upgradePath, player.race, BuildingType.Tower);
    const towerRangeBonus = upgrade.special.towerRangeBonus ?? 0;
    const stats = {
      damage: Math.max(1, Math.round(baseStats.damage * upgrade.damage)),
      attackSpeed: Math.max(0.2, baseStats.attackSpeed * upgrade.attackSpeed),
      range: Math.max(1, baseStats.range * upgrade.range) + towerRangeBonus,
    };
    const enemyTeam = player.team === Team.Bottom ? Team.Top : Team.Bottom;

    building.actionTimer--; // reuse actionTimer as attack cooldown
    if (building.actionTimer > 0) continue;

    const tx = building.worldX + 0.5;
    const ty = building.worldY + 0.5;

    // Races with special tower behavior (non-standard attack patterns)
    const specialTowerRaces: Race[] = [
      Race.Crown, Race.Oozlings, Race.Deep, Race.Wild, Race.Tenders, // AoE or support
      Race.Geists, Race.Demon, Race.Horde, // single-target special
    ];
    if (specialTowerRaces.includes(player.race)) {
      const hasEnemiesInRange = state.units.some(u => u.team === enemyTeam &&
        Math.sqrt((u.x - tx) ** 2 + (u.y - ty) ** 2) <= stats.range);
      if (hasEnemiesInRange) {
        applyTowerSpecial(state, building, player.race, stats, upgrade.special);
        if (towerFireSounds < 2) { addSound(state, 'tower_fire', tx, ty); towerFireSounds++; }
        continue;
      }
    }

    // Default: find closest enemy unit, fire projectile (Ember + fallback)
    let closest: UnitState | null = null;
    let closestDist = Infinity;

    for (const u of state.units) {
      if (u.team !== enemyTeam) continue;
      const dx = u.x - tx, dy = u.y - ty;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= stats.range && dist < closestDist) {
        closest = u;
        closestDist = dist;
      }
    }

    if (closest) {
      const towerUpgrade = getUnitUpgradeMultipliers(building.upgradePath, player.race, BuildingType.Tower);
      state.projectiles.push({
        id: genId(state),
        x: tx, y: ty,
        targetId: closest.id,
        damage: stats.damage,
        speed: 12,
        aoeRadius: 0,
        team: player.team, visual: 'bolt',
        sourcePlayerId: building.playerId,
        extraBurnStacks: towerUpgrade.special.extraBurnStacks,
        extraSlowStacks: towerUpgrade.special.extraSlowStacks,
        isTowerShot: true,
      });
      // Ember tower applies burn on hit (handled in tickProjectiles)
      if (towerFireSounds < 2) { addSound(state, 'tower_fire', tx, ty); towerFireSounds++; }
      building.actionTimer = Math.round(stats.attackSpeed * TICK_RATE);
      continue;
    }

    // No unit targets — try enemy harvesters (direct damage)
    let closestHarv: HarvesterState | null = null;
    let closestHarvDist = Infinity;
    for (const h of state.harvesters) {
      if (h.team !== enemyTeam || h.state === 'dead') continue;
      const dx = h.x - tx, dy = h.y - ty;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= stats.range && dist < closestHarvDist) {
        closestHarv = h;
        closestHarvDist = dist;
      }
    }
    if (closestHarv) {
      closestHarv.hp -= stats.damage;
      addFloatingText(state, closestHarv.x, closestHarv.y, `${stats.damage}`, '#ffffff', undefined, undefined,
        { ftType: 'damage', magnitude: stats.damage, miniIcon: 'arrow' });
      if (closestHarv.hp <= 0) {
        addDeathParticles(state, closestHarv.x, closestHarv.y, '#ffaa00', 4);
        killHarvester(state, closestHarv);
      }
      building.actionTimer = Math.round(stats.attackSpeed * TICK_RATE);
    }
  }
}

// === Projectiles ===

function tickProjectiles(state: GameState): void {
  const toRemove = new Set<number>();
  const unitById = new Map(state.units.map(u => [u.id, u]));
  let rangedHitSounds = 0;

  for (const p of state.projectiles) {
    // === Position-targeted siege cannonball (no unit target, flies to a world position) ===
    if (p.targetX !== undefined && p.targetY !== undefined) {
      const pdx = p.targetX - p.x, pdy = p.targetY - p.y;
      const pdist = Math.sqrt(pdx * pdx + pdy * pdy);
      const pmove = p.speed / TICK_RATE;
      if (pdist <= pmove) {
        // Impact: AoE damage to units
        const impX = p.targetX, impY = p.targetY;
        if (p.aoeRadius > 0) {
          addCombatEvent(state, { type: 'splash', x: impX, y: impY, radius: p.aoeRadius, color: '#ff6600' });
          for (const u of state.units) {
            if (u.team === p.team || u.hp <= 0) continue;
            const ud = Math.sqrt((u.x - impX) ** 2 + (u.y - impY) ** 2);
            if (ud <= p.aoeRadius) {
              const splashDmg = Math.round(p.damage * (p.splashDamagePct ?? 0.60));
              dealDamage(state, u, splashDmg, true, p.sourcePlayerId, p.sourceUnitId);
              const srcPlayer = state.players[p.sourcePlayerId];
              if (srcPlayer) {
                if (p.extraBurnStacks) applyStatus(u, StatusType.Burn, p.extraBurnStacks);
                if (p.extraSlowStacks) applyStatus(u, StatusType.Slow, p.extraSlowStacks);
              }
            }
          }
        }
        // Impact: building damage (alley buildings only)
        if (p.buildingDamageMult && p.buildingDamageMult > 0) {
          const bldAoe = (p.aoeRadius ?? 0) + 1;
          for (const b of state.buildings) {
            if (b.hp <= 0 || b.buildGrid !== 'alley') continue;
            const bPlayer = state.players[b.playerId];
            if (!bPlayer || bPlayer.team === p.team) continue;
            const bd = Math.sqrt((b.worldX - impX) ** 2 + (b.worldY - impY) ** 2);
            if (bd <= bldAoe) {
              const bldDmg = Math.round(p.damage * p.buildingDamageMult);
              b.hp = Math.max(0, b.hp - bldDmg);
              if (state.playerStats[p.sourcePlayerId]) state.playerStats[p.sourcePlayerId].totalDamageDealt += bldDmg;
              addFloatingText(state, b.worldX, b.worldY - 0.5, `${bldDmg}`, '#ffffff', undefined, undefined,
                { ftType: 'damage', magnitude: bldDmg, miniIcon: 'sword' });
              if (b.hp <= 0) {
                addFloatingText(state, b.worldX, b.worldY, 'DESTROYED', '#ff0000', undefined, undefined,
                  { ftType: 'status' });
                addSound(state, 'building_destroyed', b.worldX, b.worldY);
              }
            }
          }
          // Also damage enemy HQ if in blast radius
          const enemyTeam = p.team === Team.Bottom ? Team.Top : Team.Bottom;
          const hq = getHQPosition(enemyTeam, state.mapDef);
          const hqCx = hq.x + HQ_WIDTH / 2, hqCy = hq.y + HQ_HEIGHT / 2;
          const hqDist = Math.sqrt((hqCx - impX) ** 2 + (hqCy - impY) ** 2);
          if (hqDist <= bldAoe + 2) {
            const hqBldDmg = Math.round(p.damage * p.buildingDamageMult * 0.5);
            state.hqHp[enemyTeam] = Math.max(0, state.hqHp[enemyTeam] - hqBldDmg);
            if (state.playerStats[p.sourcePlayerId]) state.playerStats[p.sourcePlayerId].totalDamageDealt += hqBldDmg;
            addFloatingText(state, hqCx, hqCy, `${hqBldDmg}`, '#ffffff', undefined, undefined,
              { ftType: 'damage', magnitude: hqBldDmg, miniIcon: 'sword' });
          }
        }
        addDeathParticles(state, impX, impY, '#ff6600', 6);
        if (rangedHitSounds < 3) { addSound(state, 'ranged_hit', impX, impY); rangedHitSounds++; }
        toRemove.add(p.id);
      } else {
        p.x += (pdx / pdist) * pmove;
        p.y += (pdy / pdist) * pmove;
      }
      continue;
    }

    const target = unitById.get(p.targetId);
    if (!target || target.hp <= 0) {
      toRemove.add(p.id);
      continue;
    }

    const dx = target.x - p.x, dy = target.y - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const moveAmt = p.speed / TICK_RATE;

    if (dist <= moveAmt) {
      // Visual-only projectile (0 damage) — just remove on arrival, no effects
      if (p.damage <= 0) {
        toRemove.add(p.id);
        continue;
      }

      // Hit! Apply damage through shield
      dealDamage(state, target, p.damage, true, p.sourcePlayerId, p.sourceUnitId, p.isTowerShot);
      if (rangedHitSounds < 3) { addSound(state, 'ranged_hit', target.x, target.y); rangedHitSounds++; }
      addDeathParticles(state, target.x, target.y, '#ffaa00', 2);

      // Apply status effects based on source player's race + upgrade extras
      const sourcePlayer = state.players[p.sourcePlayerId];
      if (sourcePlayer) {
        const race = sourcePlayer.race;
        const extraSlow = p.extraSlowStacks ?? 0;
        const extraBurn = p.extraBurnStacks ?? 0;
        // Slow races: Deep always 2 (Harpooner), Tenders 1 or 2
        if (race === Race.Deep) applyStatus(target, StatusType.Slow, 2 + extraSlow);
        else if (race === Race.Tenders) applyStatus(target, StatusType.Slow, (p.aoeRadius > 0 ? 2 : 1) + extraSlow);
        // Burn races: Demon, Geists, Wild, Goblins (Knifer poison)
        if (race === Race.Demon || race === Race.Geists || race === Race.Wild || race === Race.Goblins)
          applyStatus(target, StatusType.Burn, (p.aoeRadius > 0 ? 2 : 1) + extraBurn);
        // Anti-heal: Wound on ranged/caster hits for Goblins, Demon, Geists, Wild, Horde
        if (race === Race.Goblins || race === Race.Demon || race === Race.Geists || race === Race.Wild || race === Race.Horde)
          applyWound(target);
        // Geists Wraith Bow: ranged lifesteal
        if (p.lifestealPct && p.lifestealPct > 0) {
          const source = state.units.find(u => u.id === p.sourceUnitId);
          if (source && source.hp > 0) {
            const steal = Math.round(p.damage * p.lifestealPct);
            if (steal > 0) {
              const lsAh = healUnit(source, steal);
              if (lsAh > 0) trackHealing(state, source, lsAh);
              addCombatEvent(state, { type: 'lifesteal', x: target.x, y: target.y, x2: source.x, y2: source.y, color: '#b39ddb' });
            }
          }
        }
        // Research race one-shot ranged effects
        const pbu = sourcePlayer.researchUpgrades;
        // Goblins Incendiary Tips: +1 Burn on ranged
        if (pbu.raceUpgrades['goblins_ranged_1']) applyStatus(target, StatusType.Burn, 1);
        // Demon Hellfire Arrows: +1 Burn, +10% dmg (extra burn already via this)
        if (pbu.raceUpgrades['demon_ranged_1']) applyStatus(target, StatusType.Burn, 1);
        // Demon Flame Conduit: +1 AoE burn stack on caster projectiles
        if (pbu.raceUpgrades['demon_caster_1'] && p.aoeRadius > 0) applyStatus(target, StatusType.Burn, 1);
        // Oozlings Corrosive Spit: Vulnerable (+20% dmg taken) on ranged hit
        if (pbu.raceUpgrades['oozlings_ranged_1']) applyVulnerable(target);
        // Crown Piercing Arrows: ignore 20% def (applied as bonus damage)
        // Geists Soul Arrows: +10% lifesteal on ranged
        if (pbu.raceUpgrades['geists_ranged_1']) {
          const lsSource = state.units.find(u => u.id === p.sourceUnitId);
          if (lsSource && lsSource.hp > 0) {
            const extraSteal = Math.round(p.damage * 0.10);
            if (extraSteal > 0) {
              const ah = healUnit(lsSource, extraSteal);
              if (ah > 0) trackHealing(state, lsSource, ah);
            }
          }
        }
        // Tenders Healing Sap: heal ally 15% of dmg done
        if (pbu.raceUpgrades['tenders_ranged_1']) {
          const healAmt = Math.round(p.damage * 0.15);
          if (healAmt > 0) {
            // Find lowest HP ally nearby
            let lowestAlly: UnitState | null = null;
            let lowestHpPct = 1;
            for (const u of state.units) {
              if (u.team !== sourcePlayer.team || u.hp <= 0 || u.hp >= u.maxHp) continue;
              const d2 = (u.x - target.x) ** 2 + (u.y - target.y) ** 2;
              if (d2 > 64) continue; // 8 tile radius
              const hpPct = u.hp / u.maxHp;
              if (hpPct < lowestHpPct) { lowestHpPct = hpPct; lowestAlly = u; }
            }
            if (lowestAlly) {
              const ah = healUnit(lowestAlly, healAmt);
              if (ah > 0) addCombatEvent(state, { type: 'heal', x: lowestAlly.x, y: lowestAlly.y, color: '#66bb6a' });
            }
          }
        }
      }

      // AOE damage
      if (p.aoeRadius > 0) {
        addCombatEvent(state, { type: 'splash', x: target.x, y: target.y, radius: p.aoeRadius, color: '#ffaa00' });
        for (const u of state.units) {
          if (u.id === target.id || u.team === p.team) continue;
          const ad = Math.sqrt((u.x - target.x) ** 2 + (u.y - target.y) ** 2);
          if (ad <= p.aoeRadius) {
            const aoeDmg = Math.round(p.damage * (p.splashDamagePct ?? 0.5) * 0.9);
            dealDamage(state, u, aoeDmg, true, p.sourcePlayerId, p.sourceUnitId);
            if (sourcePlayer) {
              const race = sourcePlayer.race;
              const extraSlow = p.extraSlowStacks ?? 0;
              const extraBurn = p.extraBurnStacks ?? 0;
              // Slow races: Deep always 2, Tenders 2 (AoE)
              if (race === Race.Deep) applyStatus(u, StatusType.Slow, 2 + extraSlow);
              else if (race === Race.Tenders) applyStatus(u, StatusType.Slow, 2 + extraSlow);
              // Burn races
              if (race === Race.Demon || race === Race.Geists || race === Race.Wild || race === Race.Goblins)
                applyStatus(u, StatusType.Burn, 2 + extraBurn);
              // Demon Flame Conduit: +1 AoE burn stack on caster projectiles
              if (sourcePlayer.researchUpgrades.raceUpgrades['demon_caster_1'] && p.aoeRadius > 0) applyStatus(u, StatusType.Burn, 1);
              if (race === Race.Oozlings) applyStatus(u, StatusType.Slow, 1);
              // Anti-heal on AoE: Wound for Goblins, Demon, Geists, Wild, Horde
              if (race === Race.Goblins || race === Race.Demon || race === Race.Geists || race === Race.Wild || race === Race.Horde)
                applyWound(u);
              // Oozlings caster_2 (Mass Division → Corrosive Aura): AoE applies Wound
              if (race === Race.Oozlings && sourcePlayer.researchUpgrades.raceUpgrades['oozlings_caster_2'])
                applyWound(u);
              // AoE lifesteal
              if (p.lifestealPct && p.lifestealPct > 0) {
                const source = state.units.find(s => s.id === p.sourceUnitId);
                if (source && source.hp > 0) {
                  const steal = Math.round(aoeDmg * p.lifestealPct);
                  if (steal > 0) {
                    const aoeAh = healUnit(source, steal);
                    if (aoeAh > 0) trackHealing(state, source, aoeAh);
                  }
                }
              }
            }
          }
        }
      }
      // Siege projectile: splash also damages nearby enemy alley buildings
      if (p.buildingDamageMult && p.buildingDamageMult > 0 && p.aoeRadius > 0) {
        const bldAoe = p.aoeRadius + 1;
        for (const b of state.buildings) {
          if (b.hp <= 0 || b.buildGrid !== 'alley') continue;
          const bPlayer = state.players[b.playerId];
          if (!bPlayer || bPlayer.team === p.team) continue;
          const bd = Math.sqrt((b.worldX - target.x) ** 2 + (b.worldY - target.y) ** 2);
          if (bd <= bldAoe) {
            const bldDmg = Math.round(p.damage * p.buildingDamageMult * (p.splashDamagePct ?? 0.60));
            b.hp = Math.max(0, b.hp - bldDmg);
            addFloatingText(state, b.worldX, b.worldY - 0.5, `${bldDmg}`, '#ffffff', undefined, undefined,
              { ftType: 'damage', magnitude: bldDmg, miniIcon: 'sword' });
            if (b.hp <= 0) {
              addFloatingText(state, b.worldX, b.worldY, 'DESTROYED', '#ff0000', undefined, undefined,
                { ftType: 'status' });
              addSound(state, 'building_destroyed', b.worldX, b.worldY);
            }
          }
        }
      }
      toRemove.add(p.id);
    } else {
      p.x += (dx / dist) * moveAmt;
      p.y += (dy / dist) * moveAmt;
    }
  }

  state.projectiles = state.projectiles.filter(p => !toRemove.has(p.id));
}

// === Visual Effects ===

function tickEffects(state: GameState): void {
  // Floating texts
  for (const ft of state.floatingTexts) ft.age++;
  state.floatingTexts = state.floatingTexts.filter(ft => ft.age < ft.maxAge);

  // Particles
  for (const p of state.particles) {
    p.x += p.vx / TICK_RATE;
    p.y += p.vy / TICK_RATE;
    p.vy += 0.1; // gravity
    p.age++;
  }
  state.particles = state.particles.filter(p => p.age < p.maxAge);

  // Nuke effects
  for (const n of state.nukeEffects) n.age++;
  state.nukeEffects = state.nukeEffects.filter(n => n.age < n.maxAge);

  // Pings
  for (const p of state.pings) p.age++;
  state.pings = state.pings.filter(p => p.age < p.maxAge);

  // Quick chat callouts
  for (const c of state.quickChats) c.age++;
  state.quickChats = state.quickChats.filter(c => c.age < c.maxAge);
}

// === Status Effects ===

function tickStatusEffects(state: GameState): void {
  // Upgrade regen: heal once per second (suppressed by burn, poison/slow, or blight)
  if (state.tick % TICK_RATE === 0) {
    for (const unit of state.units) {
      let regen = unit.upgradeSpecial?.regenPerSec ?? 0;
      // Research: Tenders Bark Skin — regen 1->2 HP/s for melee
      const regenPlayer = state.players[unit.playerId];
      if (regenPlayer && unit.category === 'melee' && regenPlayer.researchUpgrades.raceUpgrades['tenders_melee_1']) {
        regen = Math.max(regen, 2);
      }
      if (regen > 0 && unit.hp < unit.maxHp) {
        // Any burn or slow (poison) effect suppresses regen
        const hasBurn = unit.statusEffects.some(e => e.type === StatusType.Burn);
        const hasSlow = unit.statusEffects.some(e => e.type === StatusType.Slow);
        if (!hasBurn && !hasSlow) {
          const regenAh = healUnit(unit, regen);
          if (regenAh > 0) trackHealing(state, unit, regenAh);
          addDeathParticles(state, unit.x, unit.y, '#4caf50', 1);
          // Throttle heal VFX to every 3 seconds to avoid sparkle spam
          if (state.tick % (TICK_RATE * 3) === 0) {
            addCombatEvent(state, { type: 'heal', x: unit.x, y: unit.y, color: '#4caf50' });
          }
        }
      }
    }
  }
  for (const unit of state.units) {
    for (let i = unit.statusEffects.length - 1; i >= 0; i--) {
      const eff = unit.statusEffects[i];
      eff.duration--;

      // Burn DoT: 2 damage per stack per second (routes through shield)
      // SEARED combo: if also slowed, burn does 50% more damage
      if (eff.type === StatusType.Burn && state.tick % TICK_RATE === 0) {
        const hasSlowCombo = unit.statusEffects.some(e => e.type === StatusType.Slow);
        const baseBurnDmg = 2 * eff.stacks;
        const burnDmg = hasSlowCombo ? Math.round(baseBurnDmg * 1.5) : baseBurnDmg;
        // Attribute burn to first active enemy player (correct in 1v1, approximate in team modes)
        let burnSourceId: number | undefined;
        for (const ep of state.players) {
          if (ep.team !== unit.team && !ep.isEmpty) { burnSourceId = ep.id; break; }
        }
        dealDamage(state, unit, burnDmg, true, burnSourceId);
        if (burnSourceId !== undefined && state.playerStats[burnSourceId]) {
          state.playerStats[burnSourceId].burnDamageDealt += burnDmg;
        }
        if (hasSlowCombo) {
          addDeathParticles(state, unit.x, unit.y, '#ff6600', 1);
          addDeathParticles(state, unit.x, unit.y, '#2979ff', 1);
          if (state.tick % (TICK_RATE * 3) === 0) { // show "SEARED" every 3 seconds
            addFloatingText(state, unit.x, unit.y - 0.3, '', '#ff8c00', undefined, true,
              { ftType: 'status', miniIcon: 'fire' });
          }
        } else {
          addDeathParticles(state, unit.x, unit.y, '#ff4400', 1);
        }
        // BLIGHT: burn 3+ stacks = no regen (shown every 3s)
        if (eff.stacks >= 3 && state.tick % (TICK_RATE * 3) === 0) {
          addFloatingText(state, unit.x, unit.y - 0.5, '', '#9c27b0', undefined, true,
            { ftType: 'status', miniIcon: 'poison' });
        }
      }

      // Shield expired
      if (eff.type === StatusType.Shield && eff.duration <= 0) {
        unit.shieldHp = 0;
      }

      if (eff.duration <= 0) {
        unit.statusEffects.splice(i, 1);
      }
    }
  }

  // Research: Oozlings Symbiotic Link — heal 1 HP/s while hasted (casters only)
  if (state.tick % TICK_RATE === 0) {
    for (const unit of state.units) {
      const sympPlayer = state.players[unit.playerId];
      if (sympPlayer?.researchUpgrades.raceUpgrades['oozlings_caster_1'] && unit.category === 'caster') {
        if (unit.statusEffects.some(e => e.type === StatusType.Haste) && unit.hp < unit.maxHp) {
          healUnit(unit, 1);
        }
      }
    }
  }

  // Research: Demon Immolation — casters burn enemies within 2 tiles every second
  if (state.tick % TICK_RATE === 0) {
    for (const unit of state.units) {
      const immoPlayer = state.players[unit.playerId];
      if (immoPlayer?.researchUpgrades.raceUpgrades['demon_caster_2'] && unit.category === 'caster' && unit.hp > 0) {
        for (const enemy of state.units) {
          if (enemy.team === unit.team || enemy.hp <= 0) continue;
          const d = Math.sqrt((enemy.x - unit.x) ** 2 + (enemy.y - unit.y) ** 2);
          if (d <= 2) applyStatus(enemy, StatusType.Burn, 1);
        }
      }
    }
  }
}

// === Tower Race Specials ===

/** Spawn a visual-only tower projectile (0 damage) so players see something fly from tower to target. */
function towerVisualProjectile(state: GameState, building: BuildingState, target: UnitState): void {
  state.projectiles.push({
    id: genId(state), x: building.worldX + 0.5, y: building.worldY + 0.5,
    targetId: target.id, damage: 0, speed: 12, aoeRadius: 0,
    team: state.players[building.playerId].team, visual: 'bolt',
    sourcePlayerId: building.playerId,
  });
}

/** Spawn a visual-only chain projectile from (sx,sy) to a target. */
function towerChainProjectile(state: GameState, building: BuildingState, sx: number, sy: number, target: UnitState): void {
  state.projectiles.push({
    id: genId(state), x: sx, y: sy,
    targetId: target.id, damage: 0, speed: 18, aoeRadius: 0,
    team: state.players[building.playerId].team, visual: 'orb',
    sourcePlayerId: building.playerId,
  });
}

/** Expanding ring of particles from tower position — used for AoE tower visuals. */
function towerAoePulse(state: GameState, tx: number, ty: number, color: string, range: number): void {
  const count = 12;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const speed = range * 0.8 + state.rng() * range * 0.4;
    state.particles.push({
      x: tx, y: ty,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      age: 0,
      maxAge: TICK_RATE * 0.5,
      size: 2.5 + state.rng() * 1.5,
    });
  }
}

function applyTowerSpecial(state: GameState, building: BuildingState, race: Race, stats: { damage: number; range: number; attackSpeed: number }, sp: import('./data').UpgradeSpecial): void {
  const tx = building.worldX + 0.5;
  const ty = building.worldY + 0.5;
  const player = state.players[building.playerId];
  const enemyTeam = player.team === Team.Bottom ? Team.Top : Team.Bottom;

  switch (race) {
    case Race.Crown: {
      // Balanced single-target: hit nearest, no special effect
      let nearest: UnitState | null = null;
      let nearestDist = stats.range;
      for (const u of state.units) {
        if (u.team !== enemyTeam) continue;
        const d = Math.sqrt((u.x - tx) ** 2 + (u.y - ty) ** 2);
        if (d <= nearestDist) { nearest = u; nearestDist = d; }
      }
      if (nearest) {
        towerVisualProjectile(state, building, nearest);
        dealDamage(state, nearest, stats.damage, false, building.playerId, undefined, true);
        addDeathParticles(state, nearest.x, nearest.y, '#ffd700', 2);
        building.actionTimer = Math.round(stats.attackSpeed * TICK_RATE);
      }
      break;
    }
    case Race.Horde: {
      // Heavy single-target with knockback chance
      let nearest: UnitState | null = null;
      let nearestDist = stats.range;
      for (const u of state.units) {
        if (u.team !== enemyTeam) continue;
        const d = Math.sqrt((u.x - tx) ** 2 + (u.y - ty) ** 2);
        if (d <= nearestDist) { nearest = u; nearestDist = d; }
      }
      if (nearest) {
        towerVisualProjectile(state, building, nearest);
        dealDamage(state, nearest, stats.damage, false, building.playerId, undefined, true);
        if (state.rng() < 0.3) {
          applyKnockback(nearest, 0.02, state.mapDef);
          addDeathParticles(state, nearest.x, nearest.y, '#ffab40', 3);
          if (state.rng() < 0.3) addFloatingText(state, nearest.x, nearest.y - 0.3, 'KNOCK', '#ffab40', undefined, true,
            { ftType: 'status' });
        }
        addDeathParticles(state, nearest.x, nearest.y, '#c62828', 2);
        building.actionTimer = Math.round(stats.attackSpeed * TICK_RATE);
      }
      break;
    }
    case Race.Oozlings: {
      // Chain: hit up to 3 + extra targets
      const chainMax = 3 + (sp.extraChainTargets ?? 0);
      const targets: UnitState[] = [];
      let lastX = tx, lastY = ty;
      for (let chain = 0; chain < chainMax; chain++) {
        let best: UnitState | null = null;
        let bestDist = chain === 0 ? stats.range : 4;
        for (const u of state.units) {
          if (u.team !== enemyTeam || targets.some(t => t.id === u.id)) continue;
          const d = Math.sqrt((u.x - lastX) ** 2 + (u.y - lastY) ** 2);
          if (d <= bestDist) { best = u; bestDist = d; }
        }
        if (best) {
          targets.push(best);
          lastX = best.x; lastY = best.y;
        } else break;
      }
      const chainPct = sp.chainDamagePct ?? 0.6;
      let chainX = tx, chainY = ty;
      for (let i = 0; i < targets.length; i++) {
        const dmg = i === 0 ? stats.damage : Math.round(stats.damage * chainPct);
        dealDamage(state, targets[i], dmg, true, building.playerId, undefined, true);
        addDeathParticles(state, targets[i].x, targets[i].y, '#00e5ff', 2);
        // Chain projectile from previous position to this target
        addCombatEvent(state, { type: 'chain', x: chainX, y: chainY, x2: targets[i].x, y2: targets[i].y, color: '#00e5ff' });
        towerChainProjectile(state, building, chainX, chainY, targets[i]);
        chainX = targets[i].x;
        chainY = targets[i].y;
      }
      if (targets.length > 0) {
        building.actionTimer = Math.round(stats.attackSpeed * TICK_RATE);
      }
      break;
    }
    case Race.Demon: {
      // Single-target + burn
      const burnStacks = 1 + (sp.extraBurnStacks ?? 0);
      let nearest: UnitState | null = null;
      let nearestDist = stats.range;
      for (const u of state.units) {
        if (u.team !== enemyTeam) continue;
        const d = Math.sqrt((u.x - tx) ** 2 + (u.y - ty) ** 2);
        if (d <= nearestDist) { nearest = u; nearestDist = d; }
      }
      if (nearest) {
        towerVisualProjectile(state, building, nearest);
        dealDamage(state, nearest, stats.damage, false, building.playerId, undefined, true);
        applyStatus(nearest, StatusType.Burn, burnStacks);
        addDeathParticles(state, nearest.x, nearest.y, '#ff3d00', 2);
        building.actionTimer = Math.round(stats.attackSpeed * TICK_RATE);
      }
      break;
    }
    case Race.Deep: {
      // AoE slow: hit ALL enemies in range — ice pulse
      const slowStacks = 1 + (sp.extraSlowStacks ?? 0);
      let hit = false;
      for (const u of state.units) {
        if (u.team !== enemyTeam) continue;
        const d = Math.sqrt((u.x - tx) ** 2 + (u.y - ty) ** 2);
        if (d <= stats.range) {
          dealDamage(state, u, stats.damage, false, building.playerId, undefined, true);
          applyStatus(u, StatusType.Slow, slowStacks);
          addDeathParticles(state, u.x, u.y, '#4fc3f7', 1);
          hit = true;
        }
      }
      if (hit) {
        towerAoePulse(state, tx, ty, '#2196f3', stats.range);
        building.actionTimer = Math.round(stats.attackSpeed * TICK_RATE);
      }
      break;
    }
    case Race.Wild: {
      // AoE poison: damage ALL enemies in range + burn — toxic cloud
      const burnStacks = 1 + (sp.extraBurnStacks ?? 0);
      const slowStacks = sp.extraSlowStacks ?? 0;
      let hit = false;
      for (const u of state.units) {
        if (u.team !== enemyTeam) continue;
        const d = Math.sqrt((u.x - tx) ** 2 + (u.y - ty) ** 2);
        if (d <= stats.range) {
          dealDamage(state, u, stats.damage, false, building.playerId, undefined, true);
          applyStatus(u, StatusType.Burn, burnStacks);
          if (slowStacks > 0) applyStatus(u, StatusType.Slow, slowStacks);
          addDeathParticles(state, u.x, u.y, '#66bb6a', 1);
          hit = true;
        }
      }
      if (hit) {
        towerAoePulse(state, tx, ty, '#4caf50', stats.range);
        building.actionTimer = Math.round(stats.attackSpeed * TICK_RATE);
      }
      break;
    }
    case Race.Geists: {
      // Wither: hit nearest enemy + apply burn
      const burnStacks = 1 + (sp.extraBurnStacks ?? 0);
      let nearest: UnitState | null = null;
      let nearestDist = stats.range;
      for (const u of state.units) {
        if (u.team !== enemyTeam) continue;
        const d = Math.sqrt((u.x - tx) ** 2 + (u.y - ty) ** 2);
        if (d <= nearestDist) { nearest = u; nearestDist = d; }
      }
      if (nearest) {
        towerVisualProjectile(state, building, nearest);
        dealDamage(state, nearest, stats.damage, false, building.playerId, undefined, true);
        applyStatus(nearest, StatusType.Burn, burnStacks);
        addDeathParticles(state, nearest.x, nearest.y, '#546e7a', 2);
        building.actionTimer = Math.round(stats.attackSpeed * TICK_RATE);
      }
      break;
    }
    case Race.Tenders: {
      // Thorns aura: damage ALL enemies in range + slow — vine pulse
      const slowStacks = 1 + (sp.extraSlowStacks ?? 0);
      const burnStacks = sp.extraBurnStacks ?? 0;
      let hit = false;
      for (const u of state.units) {
        if (u.team !== enemyTeam) continue;
        const d = Math.sqrt((u.x - tx) ** 2 + (u.y - ty) ** 2);
        if (d <= stats.range) {
          dealDamage(state, u, stats.damage, false, building.playerId, undefined, true);
          applyStatus(u, StatusType.Slow, slowStacks);
          if (burnStacks > 0) applyStatus(u, StatusType.Burn, burnStacks);
          addDeathParticles(state, u.x, u.y, '#a5d6a7', 1);
          hit = true;
        }
      }
      if (hit) {
        towerAoePulse(state, tx, ty, '#81c784', stats.range);
        building.actionTimer = Math.round(stats.attackSpeed * TICK_RATE);
      }
      break;
    }
    // Goblins: default single-target (handled in tickTowers normally via projectile)
  }
}

// === Nuke Telegraph ===

function tickNukeTelegraphs(state: GameState): void {
  // Tick down team nuke cooldowns
  for (let t = 0; t < state.nukeTeamCooldown.length; t++) {
    if (state.nukeTeamCooldown[t] > 0) state.nukeTeamCooldown[t]--;
  }

  for (let i = state.nukeTelegraphs.length - 1; i >= 0; i--) {
    const tel = state.nukeTelegraphs[i];
    tel.timer--;
    if (tel.timer <= 0) {
      // Detonate
      executeNukeDetonation(state, tel.playerId, tel.x, tel.y, tel.radius);
      state.nukeTelegraphs.splice(i, 1);
    }
  }
}

function executeNukeDetonation(state: GameState, playerId: number, x: number, y: number, radius: number): void {
  const player = state.players[playerId];
  const enemyTeam = player.team === Team.Bottom ? Team.Top : Team.Bottom;

  state.nukeEffects.push({
    x, y, radius, age: 0, maxAge: TICK_RATE * 2,
  });
  addSound(state, 'nuke_detonated', x, y);

  let nukeKills = 0;
  state.units = state.units.filter(u => {
    if (u.team !== enemyTeam) return true;
    if (u.nukeImmune) return true; // Diamond champions survive nukes
    if ((u.x - x) ** 2 + (u.y - y) ** 2 <= radius * radius) {
      addDeathParticles(state, u.x, u.y, '#ff4400', 8);
      if (u.carryingDiamond) dropDiamond(state, u.x, u.y);
      trackDeathResources(state, u);
      nukeKills++;
      return false;
    }
    return true;
  });
  if (state.playerStats[playerId]) {
    state.playerStats[playerId].nukeKills += nukeKills;
    state.playerStats[playerId].enemyUnitsKilled += nukeKills;
  }

  for (const h of state.harvesters) {
    if (h.team !== enemyTeam || h.state === 'dead') continue;
    if ((h.x - x) ** 2 + (h.y - y) ** 2 <= radius * radius) {
      addDeathParticles(state, h.x, h.y, '#ff4400', 6);
      killHarvester(state, h);
    }
  }

  // GDD: Nuke does NOT damage buildings or HQ — only units and harvesters
}

// === Harvesters ===

function findOpenMiningSpot(state: GameState, h: HarvesterState, target: { x: number; y: number }): { x: number; y: number } {
  // Check if any other harvester is already mining within 1.2 tiles of target
  const otherMiners = state.harvesters.filter(o =>
    o.id !== h.id && o.state === 'mining' && o.assignment === h.assignment &&
    Math.sqrt((o.x - target.x) ** 2 + (o.y - target.y) ** 2) < 1.2
  );
  if (otherMiners.length === 0) return target;

  // Wood nodes read better with a wider ring so the forest feels broader and less pinched.
  const baseRing = h.assignment === HarvesterAssignment.Wood ? 1.8 : 1.0;
  const ringDist = baseRing + otherMiners.length * 0.75;
  const angleStep = (Math.PI * 2) / 8;
  const baseAngle = (h.id * 137.508) % (Math.PI * 2); // golden angle spread
  let bestSpot = target;
  let bestOccupied = Infinity;

  for (let i = 0; i < 8; i++) {
    const a = baseAngle + i * angleStep;
    const cx = target.x + Math.cos(a) * ringDist;
    const cy = target.y + Math.sin(a) * ringDist;
    // Count how many miners are near this spot
    let occupied = 0;
    for (const o of otherMiners) {
      if (Math.sqrt((o.x - cx) ** 2 + (o.y - cy) ** 2) < 1.0) occupied++;
    }
    if (occupied < bestOccupied) {
      bestOccupied = occupied;
      bestSpot = { x: cx, y: cy };
    }
  }
  return bestSpot;
}

function tickHarvesters(state: GameState): void {
  // Soft collision between harvesters: push apart
  for (let i = 0; i < state.harvesters.length; i++) {
    const a = state.harvesters[i];
    if (a.state === 'dead') continue;
    for (let j = i + 1; j < state.harvesters.length; j++) {
      const b = state.harvesters[j];
      if (b.state === 'dead') continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minDist = HARVESTER_MIN_SEPARATION;
      if (dist < minDist && dist > 0.01) {
        const push = (minDist - dist) * 0.3;
        const nx = dx / dist, ny = dy / dist;
        // Don't push miners who are actively mining
        if (a.state !== 'mining') { a.x -= nx * push; a.y -= ny * push; }
        if (b.state !== 'mining') { b.x += nx * push; b.y += ny * push; }
      }
    }
  }
  for (const h of state.harvesters) {
    if (h.state === 'dead') continue;
    clampToArenaBounds(h, 0.3, state.mapDef);
  }

  // Remove orphaned harvesters whose huts were destroyed
  state.harvesters = state.harvesters.filter(h => {
    const hutExists = state.buildings.some(b => b.id === h.hutId);
    if (!hutExists) {
      if (h.carryingDiamond) dropDiamond(state, h.x, h.y);
      spillCarriedWood(state, h);
      return false;
    }
    return true;
  });

  // Pre-compute shared context for center harvesters (once per tick, not per harvester)
  const centerCtx = buildCenterHarvesterContext(state);

  for (const h of state.harvesters) {
    if (h.state === 'dead') {
      h.respawnTimer--;
      if (h.respawnTimer <= 0) {
        const hut = state.buildings.find(b => b.id === h.hutId);
        if (hut) {
          h.x = hut.worldX; h.y = hut.worldY;
          h.hp = h.maxHp; h.state = 'walking_to_node';
          h.carryingDiamond = false; h.carryingResource = null; h.carryAmount = 0;
          h.queuedWoodAmount = 0; h.woodCarryTarget = 0; h.woodDropsCreated = 0;
          h.targetCellIdx = -1; h.diamondCellsMinedThisTrip = 0; h.fightTargetId = null; h.damage = 0;
          h.path = [];
        }
      }
      continue;
    }

    // Frightened: 50% slower when enemies within 5 tiles
    let frightened = false;
    for (const u of state.units) {
      if (u.team === h.team || u.hp <= 0) continue;
      const dx = u.x - h.x, dy = u.y - h.y;
      if (dx * dx + dy * dy <= 25) { frightened = true; break; }
    }
    let workerSpeedMult = 1.0;
    const hPlayer = state.players[h.playerId];
    // Crown: Swift Workers (+40% move speed)
    if (hPlayer?.researchUpgrades.raceUpgrades['crown_ability_1']) workerSpeedMult *= 1.4;
    // Wild: Pack Speed (+15% global move speed for workers too)
    if (hPlayer?.researchUpgrades.raceUpgrades['wild_ability_3']) workerSpeedMult *= 1.10;
    const movePerTick = (HARVESTER_MOVE_SPEED / TICK_RATE) * (frightened ? 0.5 : 1.0) * workerSpeedMult;

    if (h.assignment === HarvesterAssignment.Center) {
      tickCenterHarvester(state, h, movePerTick, centerCtx);
      clampToArenaBounds(h, 0.3, state.mapDef);
      continue;
    }

    // Demon mana assignment: harvester walks to Research building and channels there permanently
    if (h.assignment === HarvesterAssignment.Mana) {
      const MANA_CHANNEL_TICKS = 4 * TICK_RATE; // 2 mana every 4s per channeling worker
      const research = state.buildings.find(b => b.type === BuildingType.Research && b.playerId === h.playerId);
      if (!research) {
        // No research building yet — idle in place
        h.state = 'mining'; h.miningTimer = MANA_CHANNEL_TICKS;
        clampToArenaBounds(h, 0.3, state.mapDef);
        continue;
      }
      const targetX = research.worldX + 0.5;
      const targetY = research.worldY + 0.5;
      if (h.state === 'walking_to_node' || h.state === 'walking_home') {
        const dx = targetX - h.x, dy = targetY - h.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1.5) {
          h.state = 'mining';
          h.miningTimer = MANA_CHANNEL_TICKS;
          h.carryingResource = null;
          h.carryAmount = 0;
        } else {
          h.x += (dx / dist) * movePerTick;
          h.y += (dy / dist) * movePerTick;
        }
      } else if (h.state === 'mining') {
        h.miningTimer = Math.max(0, h.miningTimer - 1);
        if (h.miningTimer <= 0) {
          const manaOwner = state.players[h.playerId];
          if (manaOwner) {
            manaOwner.mana += 2;
            addFloatingText(state, h.x, h.y - 0.3, '+2', '#7c4dff', 'mana', undefined, { ownerOnly: h.playerId });
          }
          h.miningTimer = MANA_CHANNEL_TICKS;
        }
      }
      clampToArenaBounds(h, 0.3, state.mapDef);
      continue;
    }

    const baseTarget = getResourceNodePosition(h, state.mapDef);
    if (h.state === 'walking_to_node') {
      const target = findOpenMiningSpot(state, h, baseTarget);
      const dx = target.x - h.x, dy = target.y - h.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) {
        if (h.assignment === HarvesterAssignment.Wood) {
          const gathered = collectWoodPiles(state, baseTarget.x, baseTarget.y, WOOD_CARRY_PER_TRIP);
          if (gathered >= WOOD_CARRY_PER_TRIP) {
            h.carryingResource = ResourceType.Wood;
            h.carryAmount = gathered;
            h.state = 'walking_home';
            h.queuedWoodAmount = 0;
            h.woodCarryTarget = 0;
            h.woodDropsCreated = 0;
          } else {
            h.queuedWoodAmount = gathered;
            h.woodCarryTarget = WOOD_CARRY_PER_TRIP;
            h.woodDropsCreated = 0;
            h.state = 'mining';
            h.miningTimer = MINE_TIME_BASE_TICKS;
          }
        } else {
          h.state = 'mining';
          h.miningTimer = MINE_TIME_BASE_TICKS;
        }
      } else {
        // Follow A* path if one exists, otherwise compute or move direct
        if (h.path.length > 0) {
          // Validate: discard stale path if endpoint is far from current target
          const last = h.path[h.path.length - 1];
          if ((last.x - baseTarget.x) ** 2 + (last.y - baseTarget.y) ** 2 > 9) h.path = [];
        }
        if (h.path.length > 0) {
          const wp = h.path[0];
          const wdx = wp.x - h.x, wdy = wp.y - h.y;
          if (wdx * wdx + wdy * wdy < 2.25) h.path.shift(); // reached waypoint (< 1.5 tiles)
          if (h.path.length > 0) {
            moveWithSlide(h, h.path[0].x, h.path[0].y, movePerTick, state.diamondCells, state.mapDef);
          } else {
            moveWithSlide(h, target.x, target.y, movePerTick, state.diamondCells, state.mapDef);
          }
        } else {
          // No path — check if we need one
          const newPath = computeHarvesterPath(h.x, h.y, baseTarget.x, baseTarget.y, state.diamondCells, state.mapDef);
          if (newPath.length > 0) {
            h.path = newPath;
            moveWithSlide(h, h.path[0].x, h.path[0].y, movePerTick, state.diamondCells, state.mapDef);
          } else {
            moveWithSlide(h, target.x, target.y, movePerTick, state.diamondCells, state.mapDef);
          }
        }
      }
    } else if (h.state === 'mining') {
      h.miningTimer--;
      if (h.assignment === HarvesterAssignment.Wood) {
        const missingWood = Math.max(0, h.woodCarryTarget - h.queuedWoodAmount);
        const batchCount = 1;
        const progress = Math.max(0, MINE_TIME_BASE_TICKS - h.miningTimer);
        const desiredDrops = Math.min(batchCount, Math.floor((progress / MINE_TIME_BASE_TICKS) * batchCount));
        while (h.woodDropsCreated < desiredDrops) {
          const batchIndex = h.woodDropsCreated;
          const amount = Math.floor(missingWood / batchCount) + (batchIndex < (missingWood % batchCount) ? 1 : 0);
          if (amount > 0) dropWoodPile(state, baseTarget.x, baseTarget.y, amount, h.id * 17 + batchIndex * 29);
          h.woodDropsCreated++;
        }
      }
      if (h.miningTimer <= 0) {
        switch (h.assignment) {
          case HarvesterAssignment.BaseGold: {
            // Crown foundry bonus: +1 gold per trip per foundry
            const foundryBonus = state.players[h.playerId]?.race === Race.Crown
              ? state.buildings.filter(fb => fb.isFoundry && fb.playerId === h.playerId && fb.hp > 0).length
              : 0;
            h.carryingResource = ResourceType.Gold; h.carryAmount = GOLD_YIELD_PER_TRIP + foundryBonus; break;
          }
          case HarvesterAssignment.Wood: {
            const missingWood = Math.max(0, h.woodCarryTarget - h.queuedWoodAmount);
            h.queuedWoodAmount += collectWoodPiles(state, baseTarget.x, baseTarget.y, missingWood);
            h.carryingResource = ResourceType.Wood;
            h.carryAmount = h.queuedWoodAmount;
            h.queuedWoodAmount = 0;
            h.woodCarryTarget = 0;
            h.woodDropsCreated = 0;
            break;
          }
          case HarvesterAssignment.Stone:
            h.carryingResource = ResourceType.Stone; h.carryAmount = STONE_YIELD_PER_TRIP; break;
        }
        h.state = h.carryAmount > 0 ? 'walking_home' : 'walking_to_node';
      }
    } else if (h.state === 'walking_home') {
      walkHome(state, h, movePerTick);
    }

    clampToArenaBounds(h, 0.3, state.mapDef);
  }
}

const CARDINAL_DIRS: ReadonlyArray<readonly [number, number]> = [[0, -1], [0, 1], [-1, 0], [1, 0]];

/** Pre-compute shared data for center harvesters (once per tick). */
function buildCenterHarvesterContext(state: GameState): { cellSet: Set<string>; taken: Set<number> } {
  const cellSet = new Set<string>();
  for (const c of state.diamondCells) if (c.gold > 0) cellSet.add(`${c.tileX},${c.tileY}`);
  const taken = new Set<number>();
  for (const oh of state.harvesters) {
    if (oh.state === 'dead') continue;
    if (oh.assignment === HarvesterAssignment.Center && oh.targetCellIdx >= 0) {
      taken.add(oh.targetCellIdx);
    }
  }
  return { cellSet, taken };
}

/** Find an unmined diamond cell the harvester can reach (has a passable adjacent tile). */
function findMinableDiamondCell(
  state: GameState,
  h: HarvesterState,
  cellSet: Set<string>,
  taken: Set<number>,
): { cellIdx: number; minePos: { x: number; y: number } } | null {
  const cells = state.diamondCells;
  let bestIdx = -1;
  let bestPos = { x: 0, y: 0 };
  let bestDist = Infinity;

  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c.gold <= 0) continue;
    if (taken.has(i)) continue;

    // Find a passable adjacent position (cardinal directions)
    let adjBest: { x: number; y: number } | null = null;
    let adjBestDist = Infinity;
    for (const [ox, oy] of CARDINAL_DIRS) {
      const ax = c.tileX + ox;
      const ay = c.tileY + oy;
      // Adjacent cell must not be unmined
      if (cellSet.has(`${ax},${ay}`)) continue;
      // Must not be inside an HQ
      if (isInsideAnyHQ(ax + 0.5, ay + 0.5, 0.3)) continue;
      const dx = (ax + 0.5) - h.x, dy = (ay + 0.5) - h.y;
      const d = dx * dx + dy * dy;
      if (d < adjBestDist) {
        adjBestDist = d;
        adjBest = { x: ax + 0.5, y: ay + 0.5 };
      }
    }
    if (!adjBest) continue; // no accessible side

    const dx = adjBest.x - h.x, dy = adjBest.y - h.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
      bestPos = adjBest;
    }
  }

  return bestIdx >= 0 ? { cellIdx: bestIdx, minePos: bestPos } : null;
}

function tickCenterHarvester(state: GameState, h: HarvesterState, movePerTick: number, centerCtx: { cellSet: Set<string>; taken: Set<number> }): void {
  if (h.carryingDiamond) {
    if (h.state !== 'walking_home') h.state = 'walking_home';
    walkHome(state, h, movePerTick);
    return;
  }

  const enemyCarrier = state.harvesters.find(
    eh => eh.team !== h.team && eh.carryingDiamond && eh.state !== 'dead'
  );
  if (enemyCarrier) {
    h.damage = 5;
    const dx = enemyCarrier.x - h.x, dy = enemyCarrier.y - h.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1.5) {
      if (h.state !== 'fighting') h.state = 'fighting';
      h.fightTargetId = enemyCarrier.id;
      if (state.tick % TICK_RATE === 0) {
        enemyCarrier.hp -= h.damage;
        addFloatingText(state, enemyCarrier.x, enemyCarrier.y, `${h.damage}`, '#ffffff', undefined, undefined,
          { ftType: 'damage', magnitude: h.damage, miniIcon: 'sword' });
        if (enemyCarrier.hp <= 0) {
          killHarvester(state, enemyCarrier);
        }
      }
    } else {
      h.state = 'walking_to_node';
      moveWithSlide(h, enemyCarrier.x, enemyCarrier.y, movePerTick, [], state.mapDef);
    }
    return;
  }

  h.damage = 0;

  if (state.diamond.exposed && (state.diamond.state === 'exposed' || state.diamond.state === 'dropped')) {
    const targetX = state.diamond.x;
    const targetY = state.diamond.y;
    const dx = targetX - h.x, dy = targetY - h.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 1.5) {
      if (state.diamond.state === 'dropped') {
        h.carryingDiamond = true;
        state.diamond.state = 'carried';
        state.diamond.carrierId = h.id;
        state.diamond.carrierType = 'harvester';
        h.state = 'walking_home';
        addSound(state, 'diamond_carried', h.x, h.y);
      } else if (h.state !== 'mining') {
        h.state = 'mining';
        h.miningTimer = MINE_TIME_DIAMOND_TICKS;
      } else {
        h.miningTimer--;
        if (h.miningTimer <= 0) {
          h.carryingDiamond = true;
          state.diamond.state = 'carried';
          state.diamond.carrierId = h.id;
          state.diamond.carrierType = 'harvester';
          h.state = 'walking_home';
        }
      }
    } else {
      h.state = 'walking_to_node';
      moveWithSlide(h, targetX, targetY, movePerTick, [], state.mapDef);
    }
    return;
  }

  // Diamond not yet exposed — mine diamond gold cells to clear a path and expose it.
  if (h.state === 'walking_home') {
    walkHome(state, h, movePerTick);
    return;
  }
  if (h.state === 'mining') {
    h.miningTimer--;
    if (h.miningTimer <= 0) {
      const cell = h.targetCellIdx >= 0 ? state.diamondCells[h.targetCellIdx] : null;
      if (cell && cell.gold > 0) {
        // Crown foundry bonus: +1 gold per trip per foundry
        const cFoundryBonus = state.players[h.playerId]?.race === Race.Crown
          ? state.buildings.filter(fb => fb.isFoundry && fb.playerId === h.playerId && fb.hp > 0).length
          : 0;
        const yield_ = Math.min(GOLD_YIELD_PER_TRIP + cFoundryBonus, cell.gold);
        cell.gold -= yield_;
        h.carryingResource = ResourceType.Gold;
        h.carryAmount += yield_;
        if (cell.gold > 0) {
          // Cell not yet cleared — keep mining same cell
          h.miningTimer = MINE_TIME_BASE_TICKS;
        } else {
          // Cell fully cleared
          h.diamondCellsMinedThisTrip++;
          if (h.diamondCellsMinedThisTrip < DIAMOND_CELLS_PER_TRIP) {
            // Mine more cells before heading home
            h.targetCellIdx = -1;
            h.state = 'walking_to_node';
          } else {
            // Hit limit — head home with accumulated gold
            h.diamondCellsMinedThisTrip = 0;
            h.state = 'walking_home';
            h.targetCellIdx = -1;
          }
        }
      } else {
        h.state = 'walking_to_node';
        h.targetCellIdx = -1;
      }
    }
    return;
  }
  // Find nearest unmined cell reachable from outside the diamond
  const cellTarget = findMinableDiamondCell(state, h, centerCtx.cellSet, centerCtx.taken);
  if (!cellTarget) {
    // All cells mined — idle near diamond center waiting for exposure check
    const dc = state.mapDef.diamondCenter;
    const dx = dc.x - h.x, dy = dc.y - h.y;
    if (dx * dx + dy * dy > 4) {
      h.state = 'walking_to_node';
      moveWithSlide(h, dc.x, dc.y, movePerTick, state.diamondCells, state.mapDef);
    }
    return;
  }
  // Walk to position adjacent to the target cell
  const adjPos = cellTarget.minePos;
  const dx = adjPos.x - h.x, dy = adjPos.y - h.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) {
    h.state = 'mining';
    h.miningTimer = MINE_TIME_BASE_TICKS;
    h.targetCellIdx = cellTarget.cellIdx;
  } else {
    h.state = 'walking_to_node';
    moveWithSlide(h, adjPos.x, adjPos.y, movePerTick, state.diamondCells, state.mapDef);
  }
}

function getDropOffTarget(state: GameState, h: HarvesterState): { x: number; y: number } {
  const hq = getHQPosition(h.team, state.mapDef);
  let tx = hq.x + HQ_WIDTH / 2, ty = hq.y + HQ_HEIGHT / 2;
  // Diamond must go to HQ (spawns champion)
  if (h.carryingDiamond) return { x: tx, y: ty };
  // Crown foundries act as drop-off points — pick nearest
  const player = state.players[h.playerId];
  if (player?.race === Race.Crown) {
    let bestDist = (tx - h.x) ** 2 + (ty - h.y) ** 2;
    for (const b of state.buildings) {
      if (!b.isFoundry || b.playerId !== h.playerId || b.hp <= 0) continue;
      const fx = b.worldX + 0.5, fy = b.worldY + 0.5;
      const fd = (fx - h.x) ** 2 + (fy - h.y) ** 2;
      if (fd < bestDist) { bestDist = fd; tx = fx; ty = fy; }
    }
  }
  return { x: tx, y: ty };
}

function walkHome(state: GameState, h: HarvesterState, movePerTick: number): void {
  const target = getDropOffTarget(state, h);
  const tx = target.x, ty = target.y;
  const dx = tx - h.x, dy = ty - h.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 2) {
    const player = state.players[h.playerId];
    if (h.carryingDiamond) {
      h.carryingDiamond = false;
      spawnDiamondChampion(state, h.team, h.x, h.y, h.playerId);
      resetDiamondForRespawn(state);
      h.state = 'walking_to_node';
      h.targetCellIdx = -1;
      return;
    }
    const ps = state.playerStats[h.playerId];
    // Apply map resource yield multiplier for wood/stone (not gold — gold has its own economy)
    const yieldMul = (h.carryingResource !== ResourceType.Gold) ? (state.mapDef?.resourceYield ?? 1) : 1;
    const amt = h.carryAmount * yieldMul;
    if (h.carryingResource === ResourceType.Gold) {
      player.gold += amt;
      if (ps) ps.totalGoldEarned += amt;
      if (state.tick % 2 === 0) addFloatingText(state, h.x, h.y, `+${amt}`, '#ffd700', 'gold');
    } else if (h.carryingResource === ResourceType.Wood) {
      player.wood += amt;
      if (ps) ps.totalWoodEarned += amt;
      if (state.tick % 2 === 0) addFloatingText(state, h.x, h.y, `+${amt}`, '#8d6e63', 'wood');
    } else if (h.carryingResource === ResourceType.Stone) {
      player.stone += amt;
      if (ps) ps.totalStoneEarned += amt;
      if (state.tick % 2 === 0) addFloatingText(state, h.x, h.y, `+${amt}`, '#ff5252', 'meat');
    }
    h.carryingResource = null;
    h.carryAmount = 0;
    h.queuedWoodAmount = 0;
    h.woodCarryTarget = 0;
    h.woodDropsCreated = 0;
    h.state = 'walking_to_node';
    h.path = [];
  } else {
    // Follow A* path or compute one
    if (h.path.length > 0) {
      const last = h.path[h.path.length - 1];
      if ((last.x - tx) ** 2 + (last.y - ty) ** 2 > 9) h.path = [];
    }
    if (h.path.length > 0) {
      const wp = h.path[0];
      const wdx = wp.x - h.x, wdy = wp.y - h.y;
      if (wdx * wdx + wdy * wdy < 2.25) h.path.shift();
      if (h.path.length > 0) {
        moveWithSlide(h, h.path[0].x, h.path[0].y, movePerTick, state.diamondCells, state.mapDef);
      } else {
        moveWithSlide(h, tx, ty, movePerTick, state.diamondCells, state.mapDef);
      }
    } else {
      const newPath = computeHarvesterPath(h.x, h.y, tx, ty, state.diamondCells, state.mapDef);
      if (newPath.length > 0) {
        h.path = newPath;
        moveWithSlide(h, h.path[0].x, h.path[0].y, movePerTick, state.diamondCells, state.mapDef);
      } else {
        moveWithSlide(h, tx, ty, movePerTick, state.diamondCells, state.mapDef);
      }
    }
  }
}

function getBaseGoldPosition(team: Team, mapDef?: MapDef): { x: number; y: number } {
  const hq = getHQPosition(team, mapDef);
  if (mapDef?.shapeAxis === 'x') {
    return { x: team === Team.Bottom ? hq.x + HQ_WIDTH + 6 : hq.x - 6, y: hq.y + HQ_HEIGHT / 2 };
  }
  return { x: hq.x + HQ_WIDTH / 2, y: team === Team.Bottom ? hq.y - 6 : hq.y + HQ_HEIGHT + 6 };
}

function getResourceNodePosition(h: HarvesterState, mapDef?: MapDef): { x: number; y: number } {
  const dc = mapDef?.diamondCenter ?? { x: DIAMOND_CENTER_X, y: DIAMOND_CENTER_Y };
  switch (h.assignment) {
    case HarvesterAssignment.BaseGold:
      return getBaseGoldPosition(h.team, mapDef);
    case HarvesterAssignment.Wood: {
      const node = mapDef?.resourceNodes.find(n => n.type === ResourceType.Wood);
      return node ? { x: node.x, y: node.y } : { x: WOOD_NODE_X, y: DIAMOND_CENTER_Y };
    }
    case HarvesterAssignment.Stone: {
      const node = mapDef?.resourceNodes.find(n => n.type === ResourceType.Stone);
      return node ? { x: node.x, y: node.y } : { x: STONE_NODE_X, y: DIAMOND_CENTER_Y };
    }
    case HarvesterAssignment.Center:
      return { x: dc.x, y: dc.y };
    case HarvesterAssignment.Mana:
      // Handled inline in tickHarvesters before this function is reached
      return getBaseGoldPosition(h.team, mapDef);
  }
}

function computeWarHeroes(state: GameState): void {
  // Combine surviving units and fallen heroes into a single candidate pool
  const candidates: WarHero[] = [...state.fallenHeroes];
  for (const u of state.units) {
    if (u.kills > 0 || u.healingDone > 0 || u.buffsApplied > 0) {
      const heroRace = state.players[u.playerId].race;
      const heroBldg = `${u.category}_spawner` as BuildingType;
      candidates.push({
        name: getUpgradeNodeDef(heroRace, heroBldg, u.upgradeNode)?.name ?? u.type,
        playerId: u.playerId, race: heroRace,
        category: u.category, upgradeNode: u.upgradeNode,
        kills: u.kills, damageDone: u.damageDone, healingDone: u.healingDone, buffsApplied: u.buffsApplied,
        survived: true, killedByName: null,
        spawnTick: u.spawnTick, deathTick: null,
      });
    }
  }

  // --- War Hero: top killer overall + best per player ---
  const killCandidates = candidates.filter(c => c.kills > 0);
  killCandidates.sort((a, b) => b.kills - a.kills || a.playerId - b.playerId || a.spawnTick - b.spawnTick);
  if (killCandidates.length > 0) state.warHeroes.push(killCandidates[0]);
  const warSeen = new Set<number>();
  if (state.warHeroes.length > 0) warSeen.add(state.warHeroes[0].playerId);
  for (const c of killCandidates) {
    if (!warSeen.has(c.playerId)) { state.warHeroes.push(c); warSeen.add(c.playerId); }
  }

  // --- Support Hero: top support unit (healing + buffs) overall + best per player ---
  const supportScore = (h: WarHero) => h.healingDone + h.buffsApplied;
  const supportCandidates = candidates.filter(c => supportScore(c) > 0);
  supportCandidates.sort((a, b) => supportScore(b) - supportScore(a) || a.playerId - b.playerId || a.spawnTick - b.spawnTick);
  if (supportCandidates.length > 0) state.supportHeroes.push(supportCandidates[0]);
  const suppSeen = new Set<number>();
  if (state.supportHeroes.length > 0) suppSeen.add(state.supportHeroes[0].playerId);
  for (const c of supportCandidates) {
    if (!suppSeen.has(c.playerId)) { state.supportHeroes.push(c); suppSeen.add(c.playerId); }
  }
}

function checkWinConditions(state: GameState): void {
  if (state.matchPhase === 'ended') return;
  const humanPlayer = state.players.find(p => !p.isBot);
  const humanTeam = humanPlayer?.team ?? Team.Bottom;
  // Check each team's HQ — first team to reach 0 HP loses
  for (let t = 0; t < state.hqHp.length; t++) {
    if (state.hqHp[t] <= 0) {
      // Winner is the other team (for 2-team games)
      const winnerTeam = t === Team.Bottom ? Team.Top : Team.Bottom;
      state.winner = winnerTeam;
      state.winCondition = 'military';
      state.matchPhase = 'ended';
      addSound(state, humanTeam === winnerTeam ? 'match_end_win' : 'match_end_lose');
      return;
    }
  }
}

// === Desync Detection ===

/** Fast 32-bit hash of critical game state for desync detection. */
export function computeStateHash(state: GameState): number {
  let h = 0x811c9dc5; // FNV offset basis
  const mix = (v: number) => { h ^= v; h = Math.imul(h, 0x01000193); };

  mix(state.tick);
  for (const hp of state.hqHp) mix(hp * 1000 | 0);
  mix(state.units.length);
  mix(state.buildings.length);
  mix(state.projectiles.length);
  mix(state.harvesters.length);
  mix(state.potionDrops.length);

  for (const p of state.players) {
    mix(p.gold * 100 | 0);
    mix(p.wood * 100 | 0);
    mix(p.stone * 100 | 0);
  }

  // Sample unit positions (first 10 units for speed)
  for (let i = 0; i < Math.min(state.units.length, 10); i++) {
    const u = state.units[i];
    mix(u.id);
    mix(u.hp * 100 | 0);
    mix(u.x * 100 | 0);
    mix(u.y * 100 | 0);
  }

  return h >>> 0; // unsigned 32-bit
}
