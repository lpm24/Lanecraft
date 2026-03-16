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
  HarvesterAssignment, HarvesterState, UnitState, WarHero,
  StatusType, SoundEvent, CombatEvent, createSeededRng,
  type ProjectileVisual,
} from './types';
import { DUEL_MAP } from './maps';
import {
  SPAWN_INTERVAL_TICKS, UNIT_STATS, TOWER_STATS,
  HARVESTER_MOVE_SPEED, MINE_TIME_BASE_TICKS, MINE_TIME_DIAMOND_TICKS,
  HARVESTER_RESPAWN_TICKS, HARVESTER_MIN_SEPARATION,
  UPGRADE_TREES, UpgradeNodeDef, RACE_UPGRADE_COSTS, getBuildingCost,
  getRaceUsedResources, getNodeUpgradeCost,
  HUT_COST_SCALE, GOLD_YIELD_PER_TRIP, WOOD_YIELD_PER_TRIP, STONE_YIELD_PER_TRIP,
} from './data';

function genId(state: GameState): number { return state.nextEntityId++; }
const SELL_COOLDOWN_TICKS = 5 * TICK_RATE;
const WOOD_CARRY_PER_TRIP = WOOD_YIELD_PER_TRIP;
const WOOD_DROP_BATCHES = 1;
const WOOD_PICKUP_RADIUS = 2.35;
const WOOD_PILE_SPREAD_RADIUS = 2.0;

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
  [Race.Horde]:    { gold: 2,   wood: 0,   stone: 0.5 },  // gold primary, stone secondary
  [Race.Goblins]:  { gold: 2,   wood: 0.5, stone: 0 },    // gold primary, wood secondary
  [Race.Oozlings]: { gold: 2,   wood: 0,   stone: 0.5 },  // gold primary, stone secondary
  [Race.Demon]:    { gold: 0,   wood: 0.5, stone: 1 },    // stone primary, wood secondary
  [Race.Deep]:     { gold: 1,   wood: 1,   stone: 0 },    // wood primary, gold secondary
  [Race.Wild]:     { gold: 0,   wood: 1,   stone: 0.5 },  // wood primary, stone secondary
  [Race.Geists]:   { gold: 1,   wood: 0,   stone: 1 },    // stone primary, gold secondary
  [Race.Tenders]:  { gold: 1,   wood: 1,   stone: 0 },    // wood primary, gold secondary
};

const INITIAL_RESOURCES: Record<Race, { gold: number; wood: number; stone: number }> = {
  [Race.Crown]:    { gold: 200, wood: 25,  stone: 0 },
  [Race.Horde]:    { gold: 200, wood: 0,   stone: 25 },
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

/** Return the default harvester assignment for a race based on its actual resource usage. */
function getDefaultHarvesterAssignment(race: Race): HarvesterAssignment {
  const used = getRaceUsedResources(race);
  // Prefer gold > wood > stone (first resource the race actually uses)
  if (used.gold) return HarvesterAssignment.BaseGold;
  if (used.wood) return HarvesterAssignment.Wood;
  if (used.stone) return HarvesterAssignment.Stone;
  return HarvesterAssignment.BaseGold; // fallback (shouldn't happen)
}

type UpgradeChoice = 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

function isValidUpgradeChoice(path: string[], choice: string): choice is UpgradeChoice {
  if (path.length === 1) return choice === 'B' || choice === 'C';
  if (path.length !== 2) return false;
  if (path[1] === 'B') return choice === 'D' || choice === 'E';
  if (path[1] === 'C') return choice === 'F' || choice === 'G';
  return false;
}

function getUpgradeCost(path: string[], race: Race, buildingType?: BuildingType, choice?: string): { gold: number; wood: number; stone: number } | null {
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
        for (const [k, v] of Object.entries(def.special)) {
          (special as any)[k] = v;
        }
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

function isDiamondExposed(cellMap: Map<string, GoldCell>, state: GameState): boolean {
  const cx = state.diamond.x, cy = state.diamond.y;
  const neighbors = [
    { x: cx - 1, y: cy },
    { x: cx + 1, y: cy },
    { x: cx, y: cy - 1 },
    { x: cx, y: cy + 1 },
  ];
  for (const n of neighbors) {
    const cell = cellMap.get(`${n.x},${n.y}`);
    if (!cell || cell.gold <= 0) {
      if (hasPathToEdge(cellMap, n.x, n.y, state)) return true;
    }
  }
  return false;
}

function hasPathToEdge(cellMap: Map<string, GoldCell>, sx: number, sy: number, state: GameState): boolean {
  const cx = state.diamond.x, cy = state.diamond.y;
  const hw = state.mapDef.diamondHalfW, hh = state.mapDef.diamondHalfH;
  const visited = new Set<string>();
  const queue: { x: number; y: number }[] = [{ x: sx, y: sy }];
  visited.add(`${sx},${sy}`);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const dx = Math.abs(cur.x - cx);
    const dy = Math.abs(cur.y - cy);
    if (dx > hw || dy > hh) return true;

    for (const [nx, ny] of [[cur.x-1,cur.y],[cur.x+1,cur.y],[cur.x,cur.y-1],[cur.x,cur.y+1]]) {
      const key = `${nx},${ny}`;
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

// === Visual effect helpers ===

function addFloatingText(state: GameState, x: number, y: number, text: string, color: string, icon?: string, big?: boolean): void {
  const xOff = (state.rng() - 0.5) * 1.2; // random spread ±0.6 tiles
  state.floatingTexts.push({ x, y, text, color, icon, age: 0, maxAge: TICK_RATE * 1.5, xOff, big });
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
    pings: [],
    quickChats: [],
    soundEvents: [],
    combatEvents: [],
    nextEntityId: 1,
    playerStats: players.map(() => createPlayerStats()),
    warHeroes: [],
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
    // Assign starter harvester to the race's primary resource
    const startAssignment = getDefaultHarvesterAssignment(p.race);
    state.harvesters.push({
      id: genId(state), hutId: building.id, playerId: i, team: p.team,
      x: world.x, y: world.y, hp: 30, maxHp: 30, damage: 0,
      assignment: startAssignment,
      state: 'walking_to_node', miningTimer: 0, respawnTimer: 0,
      carryingDiamond: false, carryingResource: null, carryAmount: 0,
      queuedWoodAmount: 0, woodCarryTarget: 0, woodDropsCreated: 0,
      targetCellIdx: -1, fightTargetId: null,
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

function buildDiamondCellMap(cells: GoldCell[]): Map<string, GoldCell> {
  const m = new Map<string, GoldCell>();
  for (const c of cells) m.set(`${c.tileX},${c.tileY}`, c);
  return m;
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
    }
  }

  // Build diamond cell map once per tick (reused by harvesters and exposure check)
  const diamondCellMap = buildDiamondCellMap(state.diamondCells);

  // Update diamond exposed state (check every second, not every tick — BFS is expensive)
  if (state.diamond.state === 'hidden' && state.tick % TICK_RATE === 0) {
    if (isDiamondExposed(diamondCellMap, state)) {
      state.diamond.exposed = true;
      state.diamond.state = 'exposed';
      addSound(state, 'diamond_exposed', state.diamond.x, state.diamond.y);
    }
  }

  tickSpawners(state);
  tickUnitMovement(state);
  tickUnitDiamondPickup(state);
  tickUnitCollision(state);
  tickCombat(state);
  tickTowers(state);
  tickHQDefense(state);
  tickProjectiles(state);
  tickStatusEffects(state);
  tickNukeTelegraphs(state);
  tickHarvesters(state);
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

  if (state.tick >= 30 * 60 * TICK_RATE) {
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

  for (let t = 0; t < teamCount; t++) {
    const vis = state.visibility[t];
    vis.fill(false);

    // HQ vision
    const hqPos = getHQPosition(t as Team, state.mapDef);
    revealCircle(vis, hqPos.x + HQ_WIDTH / 2, hqPos.y + HQ_HEIGHT / 2, HQ_VISION, mapW, mapH);

    // Buildings
    for (const b of state.buildings) {
      if (state.players[b.playerId]?.team !== t) continue;
      const r = b.type === BuildingType.Tower ? TOWER_VISION : BUILDING_VISION;
      revealCircle(vis, b.worldX, b.worldY, r, mapW, mapH);
    }

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
  if (player.gold < cost.gold || player.wood < cost.wood || player.stone < cost.stone) return;

  player.gold -= cost.gold;
  player.wood -= cost.wood;
  player.stone -= cost.stone;
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
  const treeDef: UpgradeNodeDef | undefined = (UPGRADE_TREES[player.race]?.[building.type] as any)?.[cmd.choice];
  const label = treeDef ? treeDef.name : `UP ${cmd.choice}`;
  addFloatingText(state, building.worldX + 0.5, building.worldY, label, '#90caf9');
}

function placeBuilding(state: GameState, cmd: Extract<GameCommand, { type: 'place_building' }>): void {
  const player = state.players[cmd.playerId];
  if (!player) return;
  if (cmd.buildingType === BuildingType.HarvesterHut) return; // huts use build_hut command
  const cost = getBuildingCost(player.race, cmd.buildingType);
  if (!cost) return;

  // First tower is free for each player (one-time only)
  const isFirstTower = cmd.buildingType === BuildingType.Tower && !player.hasBuiltTower;
  if (!isFirstTower) {
    if (player.gold < cost.gold || player.wood < cost.wood || player.stone < cost.stone) return;
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
    if (!isFirstTower) { player.gold -= cost.gold; player.wood -= cost.wood; player.stone -= cost.stone; }
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
  if (state.tick - building.placedTick < SELL_COOLDOWN_TICKS) {
    const remainingTicks = SELL_COOLDOWN_TICKS - (state.tick - building.placedTick);
    const remainingSeconds = (remainingTicks / TICK_RATE).toFixed(1);
    addFloatingText(state, building.worldX + 0.5, building.worldY, `Sell in ${remainingSeconds}s`, '#ff6b6b');
    return;
  }
  const player = state.players[cmd.playerId];
  const cost = getBuildingCost(player.race, building.type);

  // Calculate total invested: base cost + upgrade costs (respecting per-node overrides)
  let totalGold = cost.gold, totalWood = cost.wood, totalStone = cost.stone;
  if (building.upgradePath.length >= 2) {
    const t1Cost = getUpgradeCost(['A'], player.race, building.type, building.upgradePath[1]);
    if (t1Cost) { totalGold += t1Cost.gold; totalWood += t1Cost.wood; totalStone += t1Cost.stone; }
  }
  if (building.upgradePath.length >= 3) {
    const t2Cost = getUpgradeCost(['A', building.upgradePath[1]], player.race, building.type, building.upgradePath[2]);
    if (t2Cost) { totalGold += t2Cost.gold; totalWood += t2Cost.wood; totalStone += t2Cost.stone; }
  }

  // Refund 50% of total invested resources
  const refundGold = Math.floor(totalGold * 0.5);
  const refundWood = Math.floor(totalWood * 0.5);
  const refundStone = Math.floor(totalStone * 0.5);
  player.gold += refundGold;
  player.wood += refundWood;
  player.stone += refundStone;

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
  const b = state.buildings.find(b => b.id === cmd.buildingId && b.playerId === cmd.playerId);
  if (b) b.lane = cmd.lane;
}

function toggleAllLanes(state: GameState, cmd: Extract<GameCommand, { type: 'toggle_all_lanes' }>): void {
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
      state.harvesters.push({
        id: genId(state), hutId: building.id, playerId: cmd.playerId, team: player.team,
        x: world.x, y: world.y, hp: 30, maxHp: 30, damage: 0,
        assignment: getDefaultHarvesterAssignment(player.race),
        state: 'walking_to_node', miningTimer: 0, respawnTimer: 0,
        carryingDiamond: false, carryingResource: null, carryAmount: 0,
        queuedWoodAmount: 0, woodCarryTarget: 0, woodDropsCreated: 0,
        targetCellIdx: -1, fightTargetId: null,
      });
      addSound(state, 'building_placed', world.x, world.y);
      return;
    }
  }
}

function setHutAssignment(state: GameState, cmd: Extract<GameCommand, { type: 'set_hut_assignment' }>): void {
  const h = state.harvesters.find(h => h.hutId === cmd.hutId && h.playerId === cmd.playerId);
  if (!h) return;
  h.assignment = cmd.assignment;
  if (h.assignment !== HarvesterAssignment.Wood) {
    spillCarriedWood(state, h);
  }
  if (h.state === 'walking_to_node' || h.state === 'mining') {
    h.state = 'walking_to_node';
    h.miningTimer = 0;
    h.targetCellIdx = -1;
    h.woodDropsCreated = 0;
    h.woodCarryTarget = 0;
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
    kills: 0,
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

function collectWoodPiles(state: GameState, x: number, y: number, desiredAmount: number): number {
  if (desiredAmount <= 0) return 0;
  const nearby = state.woodPiles
    .map((pile, index) => ({ pile, index, dist: Math.hypot(pile.x - x, pile.y - y) }))
    .filter(entry => entry.dist <= WOOD_PICKUP_RADIUS)
    .sort((a, b) => a.dist - b.dist || a.pile.id - b.pile.id);

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
}

// === Tick Systems ===

function tickSpawners(state: GameState): void {
  for (const building of state.buildings) {
    if (building.type === BuildingType.Tower || building.type === BuildingType.HarvesterHut) continue;
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
      const count = upgrade.special.spawnCount ?? stats.spawnCount ?? 1;
      for (let si = 0; si < count; si++) {
        state.units.push({
          id: genId(state), type: stats.name, playerId: building.playerId, team: player.team,
          x: building.worldX + (si * 0.3), y: building.worldY,
          hp: Math.max(1, Math.round(stats.hp * upgrade.hp)),
          maxHp: Math.max(1, Math.round(stats.hp * upgrade.hp)),
          damage: Math.max(1, Math.round(stats.damage * upgrade.damage)),
          attackSpeed: Math.max(0.2, stats.attackSpeed * upgrade.attackSpeed), attackTimer: 0,
          moveSpeed: Math.max(0.5, stats.moveSpeed * upgrade.moveSpeed),
          range: Math.max(1, stats.range * upgrade.range),
          targetId: null, lane: building.lane, pathProgress: -1, carryingDiamond: false,
          statusEffects: [], hitCount: 0, shieldHp: 0, category,
          upgradeTier: building.upgradePath.length - 1,
          upgradeNode: building.upgradePath[building.upgradePath.length - 1] ?? 'A',
          upgradeSpecial: upgrade.special, kills: 0, lastDamagedByName: '', spawnTick: state.tick,
        });
        if (state.playerStats[building.playerId]) state.playerStats[building.playerId].unitsSpawned++;
      }
    }
  }
}

function getEffectiveSpeed(unit: UnitState): number {
  let speed = unit.moveSpeed;
  for (const eff of unit.statusEffects) {
    if (eff.type === StatusType.Slow) speed *= Math.max(0.5, 1 - 0.1 * eff.stacks);
    if (eff.type === StatusType.Haste) speed *= 1.3;
  }
  return speed;
}

/** Get damage with status effect multipliers (Frenzy = +30% damage) */
function getEffectiveDamage(unit: UnitState): number {
  let dmg = unit.damage;
  for (const eff of unit.statusEffects) {
    if (eff.type === StatusType.Frenzy) dmg = Math.round(dmg * 1.5);
  }
  return dmg;
}

function tickUnitMovement(state: GameState): void {
  for (const unit of state.units) {
    if (unit.targetId !== null) continue;
    const speed = getEffectiveSpeed(unit);
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

    // Ranged + caster units prefer to stay behind nearest allied melee — but only near enemies
    if (unit.category === 'ranged' || unit.category === 'caster') {
      // Only engage formation behavior when enemies are within threat range
      const threatRange = unit.range + 6;
      let enemyNearby = false;
      for (const other of state.units) {
        if (other.team === unit.team) continue;
        const dx = other.x - unit.x, dy = other.y - unit.y;
        if (dx * dx + dy * dy <= threatRange * threatRange) { enemyNearby = true; break; }
      }
      if (enemyNearby) {
        let nearestMeleeProgress = -1;
        let nearestMeleeDist = Infinity;
        for (const other of state.units) {
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
    let nearbyFriendlies = 0;
    for (const other of state.units) {
      if (other.id === unit.id || other.team !== unit.team || other.lane !== unit.lane) continue;
      if (other.pathProgress < 0 || unit.pathProgress < 0) continue;
      if (Math.abs(other.pathProgress - unit.pathProgress) > 0.04) continue;
      const d = Math.sqrt((other.x - unit.x) ** 2 + (other.y - unit.y) ** 2);
      if (d < 1.35) nearbyFriendlies++;
    }
    const crowdFactor = Math.max(0.58, 1 - nearbyFriendlies * 0.06);
    movePerTick *= crowdFactor;

    unit.pathProgress += movePerTick / pathLen;
    if (unit.pathProgress > 1) unit.pathProgress = 1;

    // Formation offset so units naturally spread into lines while following lane flow.
    const slot = (unit.id % 7) - 3; // [-3..3]
    const baseOffset = slot * 0.34;
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
  // Push unit backward along its path
  unit.pathProgress = Math.max(0, unit.pathProgress - amount);
  const path = getLanePath(unit.team, unit.lane, mapDef);
  const pos = interpolatePath(path, unit.pathProgress);
  unit.x = pos.x;
  unit.y = pos.y;
}

function dealDamage(state: GameState, target: UnitState, amount: number, showFloat: boolean, sourcePlayerId?: number, sourceUnitId?: number): void {
  // Dodge check
  const dodge = target.upgradeSpecial?.dodgeChance ?? 0;
  if (dodge > 0 && state.rng() < dodge) {
    if (state.rng() < 0.3) addFloatingText(state, target.x, target.y, '💨', '#ffffff', undefined, true);
    addCombatEvent(state, { type: 'dodge', x: target.x, y: target.y, color: '#ffffff' });
    return;
  }
  // Damage reduction
  const reduction = target.upgradeSpecial?.damageReductionPct ?? 0;
  if (reduction > 0) amount = Math.max(1, Math.round(amount * (1 - reduction)));
  // Shield absorbs damage first
  if (target.shieldHp > 0) {
    const absorbed = Math.min(target.shieldHp, amount);
    target.shieldHp -= absorbed;
    amount -= absorbed;
    if (target.shieldHp <= 0) {
      target.statusEffects = target.statusEffects.filter(e => e.type !== StatusType.Shield);
    }
    if (absorbed > 0 && showFloat) {
      addFloatingText(state, target.x, target.y, `[${absorbed}]`, '#64b5f6');
    }
  }
  if (amount > 0) {
    target.hp -= amount;
    if (showFloat && amount >= 5) addFloatingText(state, target.x, target.y, `-${amount}`, '#ff6666');
    // Track damage stats
    if (sourcePlayerId !== undefined && state.playerStats[sourcePlayerId]) {
      state.playerStats[sourcePlayerId].totalDamageDealt += amount;
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
        target.lastDamagedByName = killer.type;
        if (target.hp <= 0) {
          killer.kills++;
          // Gold on kill (pirate upgrade path)
          const gok = killer.upgradeSpecial?.goldOnKill ?? 0;
          if (gok > 0) {
            const kp = state.players[killer.playerId];
            if (kp) { kp.gold += gok; addFloatingText(state, killer.x, killer.y - 0.3, `+${gok}g`, '#ffd700'); }
          }
          // Wild Kill Frenzy: on kill, heal 25% maxHP, nearby Wild allies gain Frenzy (+50% dmg) and Haste
          const killerRace = state.players[killer.playerId]?.race;
          if (killerRace === Race.Wild) {
            // Heal killer on kill (bloodthirst)
            const healAmt = Math.round(killer.maxHp * 0.25);
            killer.hp = Math.min(killer.maxHp, killer.hp + healAmt);
            const frenzyRadius = 6;
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
              addFloatingText(state, killer.x, killer.y - 0.3, '⚡', '#ff4400', undefined, true);
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
  const allies = state.units.filter(u =>
    u.team === caster.team && u.id !== caster.id &&
    Math.sqrt((u.x - caster.x) ** 2 + (u.y - caster.y) ** 2) <= supportRange
  );
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
      const absorbBonus = sp?.shieldAbsorbBonus ?? 0;
      const crownShielded = Math.min(shieldCount, sorted.length);
      for (let i = 0; i < crownShielded; i++) {
        applyStatus(sorted[i], StatusType.Shield, 1);
        if (absorbBonus > 0) sorted[i].shieldHp += absorbBonus;
      }
      if (crownShielded > 0) addCombatEvent(state, { type: 'pulse', x: caster.x, y: caster.y, radius: supportRange, color: '#64b5f6' });
      break;
    }
    case Race.Horde: {
      // Haste pulse: nearby allies get haste (5 base — Horde's War Chanter is a force multiplier)
      let hordeHasteCount = 0;
      for (const a of allies) {
        if (!a.statusEffects.some(e => e.type === StatusType.Haste)) {
          applyStatus(a, StatusType.Haste, 1);
          hordeHasteCount++;
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
      for (const e of enemies) {
        applyStatus(e, StatusType.Slow, 1 + (sp?.extraSlowStacks ?? 0));
      }
      if (enemies.length > 0) {
        addFloatingText(state, caster.x, caster.y - 0.5, '🔮', '#2e7d32', undefined, true);
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
      let cleansed = 0;
      for (const a of allies) {
        const burnIdx = a.statusEffects.findIndex(e => e.type === StatusType.Burn);
        if (burnIdx >= 0) {
          const burn = a.statusEffects[burnIdx];
          burn.stacks = Math.max(0, burn.stacks - (2 + healBonus));
          if (burn.stacks <= 0) a.statusEffects.splice(burnIdx, 1);
          addDeathParticles(state, a.x, a.y, '#1565c0', 1);
          addCombatEvent(state, { type: 'cleanse', x: a.x, y: a.y, color: '#1565c0' });
          cleansed++;
        }
      }
      if (cleansed > 0) {
        addFloatingText(state, caster.x, caster.y - 0.5, '✨', '#1565c0', undefined, true);
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
          if (hasteCount >= 3 + healBonus) break;
        }
      }
      if (hasteCount > 0) addCombatEvent(state, { type: 'pulse', x: caster.x, y: caster.y, radius: supportRange, color: '#4caf50' });
      break;
    }
    case Race.Geists: {
      // Lifesteal heal: heal lowest-HP allies directly
      const healAmt = 2 + healBonus;
      const wounded = allies.filter(a => a.hp < a.maxHp).sort((a, b) => (a.hp * b.maxHp) - (b.hp * a.maxHp) || a.id - b.id);
      const count = Math.min(3, wounded.length);
      for (let i = 0; i < count; i++) {
        wounded[i].hp = Math.min(wounded[i].maxHp, wounded[i].hp + healAmt);
        addDeathParticles(state, wounded[i].x, wounded[i].y, '#546e7a', 1);
        addCombatEvent(state, { type: 'heal', x: wounded[i].x, y: wounded[i].y, color: '#b39ddb' });
      }
      if (count > 0) {
        addFloatingText(state, caster.x, caster.y - 0.5, `+${healAmt}`, '#546e7a');
        addCombatEvent(state, { type: 'pulse', x: caster.x, y: caster.y, radius: supportRange, color: '#b39ddb' });
      }
      break;
    }
    case Race.Tenders: {
      // Regen aura: heal nearby allies
      const healAmt = 3 + healBonus;
      let healedAny = false;
      let tendersHealVfx = 0;
      for (const a of allies) {
        if (a.hp < a.maxHp) {
          a.hp = Math.min(a.maxHp, a.hp + healAmt);
          addDeathParticles(state, a.x, a.y, '#33691e', 1);
          if (tendersHealVfx < 4) { addCombatEvent(state, { type: 'heal', x: a.x, y: a.y, color: '#66bb6a' }); tendersHealVfx++; }
          healedAny = true;
        }
      }
      if (healedAny) {
        addFloatingText(state, caster.x, caster.y - 0.5, `+${healAmt}`, '#33691e');
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
          if (state.rng() < 0.3) addFloatingText(state, target.x, target.y - 0.3, '💥', '#ffab40', undefined, true);
        }
        const hordeSteal = Math.round(attacker.damage * 0.10);
        if (hordeSteal > 0) {
          attacker.hp = Math.min(attacker.maxHp, attacker.hp + hordeSteal);
          addCombatEvent(state, { type: 'lifesteal', x: target.x, y: target.y, x2: attacker.x, y2: attacker.y, color: '#66bb6a' });
        }
      }
      break;
    case Race.Goblins:
      // Sticker: 15% dodge is passive (handled in damage calc)
      // Knifer burn is applied via projectile hit logic (tickProjectiles)
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
      if (isMelee) applyStatus(target, StatusType.Burn, 1 + (sp?.extraBurnStacks ?? 0));
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
      // Bone Knight: burn (soul drain) on melee hit + lifesteal 15%
      if (isMelee) {
        applyStatus(target, StatusType.Burn, 1 + (sp?.extraBurnStacks ?? 0));
        const geistMeleeSteal = Math.round(attacker.damage * 0.15);
        attacker.hp = Math.min(attacker.maxHp, attacker.hp + geistMeleeSteal);
        if (geistMeleeSteal > 0) addCombatEvent(state, { type: 'lifesteal', x: target.x, y: target.y, x2: attacker.x, y2: attacker.y, color: '#b39ddb' });
      }
      // Wraith Bow: 20% ranged lifesteal is applied via projectile hit logic (tickProjectiles)
      break;
    case Race.Tenders:
      // Treant: slow on melee hit (entangling roots)
      if (isMelee) applyStatus(target, StatusType.Slow, 1 + (sp?.extraSlowStacks ?? 0));
      break;
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
function isInsideUnminedDiamond(x: number, y: number, pad: number, cells: GoldCell[], mapDef?: MapDef): boolean {
  // Quick bounding diamond check first
  const dcx = mapDef?.diamondCenter.x ?? DIAMOND_CENTER_X;
  const dcy = mapDef?.diamondCenter.y ?? DIAMOND_CENTER_Y;
  const dhw = mapDef?.diamondHalfW ?? DIAMOND_HALF_W;
  const dhh = mapDef?.diamondHalfH ?? DIAMOND_HALF_H;
  const dx = Math.abs(x - dcx) / (dhw + pad);
  const dy = Math.abs(y - dcy) / (dhh + pad);
  if (dx + dy > 1.1) return false; // outside diamond shape entirely

  // Check actual cells near this position
  const tileX = Math.floor(x);
  const tileY = Math.floor(y);
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = tileX + ox;
      const cy = tileY + oy;
      for (const cell of cells) {
        if (cell.gold <= 0) continue;
        if (cell.tileX === cx && cell.tileY === cy) {
          const cellCx = cell.tileX + 0.5;
          const cellCy = cell.tileY + 0.5;
          const d = Math.sqrt((x - cellCx) ** 2 + (y - cellCy) ** 2);
          if (d < COLLISION_GOLD_CELL_RADIUS + pad) return true;
        }
      }
    }
  }
  return false;
}

/** Check if a position is blocked by any solid obstacle (HQ or unmined diamond cells). */
function isBlocked(x: number, y: number, pad: number, cells: GoldCell[], mapDef?: MapDef): boolean {
  return isInsideAnyHQ(x, y, pad) || isInsideUnminedDiamond(x, y, pad, cells, mapDef);
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
            dist = 0.0001;
          }

          const overlap = minSep - dist;
          const nx = dx / dist;
          const ny = dy / dist;

          // Enemies push harder (forms solid front line), allies push softer
          const sameTeam = u.team === o.team;
          const strength = sameTeam ? UNIT_COLLISION_PUSH_STRENGTH * 0.5 : UNIT_COLLISION_PUSH_STRENGTH;
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
  const unitById = new Map(state.units.map(u => [u.id, u]));
  const AGGRO_BONUS = 2.5;
  const AGGRO_LEASH = 3.5;

  // Count how many units are already targeting each enemy (for target spreading)
  const attackerCount = new Map<number, number>();
  for (const u of state.units) {
    if (u.hp <= 0 || u.targetId === null) continue;
    attackerCount.set(u.targetId, (attackerCount.get(u.targetId) ?? 0) + 1);
  }

  for (const unit of state.units) {
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
    if (unit.targetId === null) {
      let best: UnitState | null = null;
      let bestScore = Infinity;
      for (const o of state.units) {
        if (o.team === unit.team || o.hp <= 0) continue;
        const d = Math.sqrt((o.x - unit.x) ** 2 + (o.y - unit.y) ** 2);
        if (d > unit.range + AGGRO_BONUS) continue;
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
        attackerCount.set(best.id, (attackerCount.get(best.id) ?? 0) + 1);
      }
    }

    // Chase current target until in attack range.
    // Melee units that are already fighting hold position rather than chase
    // deeper into enemy lines — they only re-chase if target breaks away.
    if (unit.targetId !== null) {
      const target = unitById.get(unit.targetId);
      if (target) {
        const dx = target.x - unit.x;
        const dy = target.y - unit.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > unit.range + 0.15 && dist > 0.001) {
          // Melee engage hold: if we were in range last tick (attackTimer is
          // counting down) and target moved only slightly, hold position and
          // let collision/target-switch handle it instead of chasing through.
          const wasAttacking = unit.range <= 2 && unit.attackTimer > 0;
          const targetDrifted = dist < unit.range + 1.5;
          if (wasAttacking && targetDrifted) {
            // Hold — don't chase, will re-acquire a closer target next tick.
            // Reset attackTimer so re-acquire doesn't trigger hold again.
            unit.targetId = null;
            unit.attackTimer = 0;
          } else {
            const movePerTick = getEffectiveSpeed(unit) / TICK_RATE;
            const step = Math.min(movePerTick, dist - unit.range);
            moveWithSlide(unit, target.x, target.y, step, state.diamondCells, state.mapDef);
            clampToArenaBounds(unit, 0.35, state.mapDef);
          }
        }
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
          // Crown caster shields instead of firing AoE
          const sp = unit.upgradeSpecial;
          applyCasterSupport(state, unit, race, sp);

          // Crown (shield caster) doesn't fire AoE projectile
          if (race !== Race.Crown) {
            const aoeRadius = (race === Race.Deep || race === Race.Tenders ? 4 : 3) + (sp?.aoeRadiusBonus ?? 0);
            const effDmg = getEffectiveDamage(unit);
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
          const aoeRadius = 3 + (sp?.aoeRadiusBonus ?? 0);
          const effDmg = getEffectiveDamage(unit);
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
          const effDmg = getEffectiveDamage(unit);
          state.projectiles.push({
            id: genId(state), x: unit.x, y: unit.y,
            targetId: target.id, damage: effDmg,
            speed: 15, aoeRadius: splashR, team: unit.team, visual: RANGED_VISUAL[race] ?? 'arrow',
            sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
            extraBurnStacks: sp?.extraBurnStacks,
            extraSlowStacks: sp?.extraSlowStacks,
            splashDamagePct: sp?.splashDamagePct,
            lifestealPct: race === Race.Geists ? 0.2 : undefined,
          });
          // Multishot: extra projectiles at nearby enemies
          const msCount = sp?.multishotCount ?? 0;
          if (msCount > 0) {
            const msDmg = Math.round(effDmg * (sp?.multishotDamagePct ?? 0.5));
            const nearby = state.units
              .filter(o => o.team !== unit.team && o.id !== target.id && o.hp > 0)
              .map(o => ({ u: o, d: Math.sqrt((o.x - unit.x) ** 2 + (o.y - unit.y) ** 2) }))
              .filter(e => e.d <= unit.range)
              .sort((a, b) => a.d - b.d || a.u.id - b.u.id);
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
              for (const o of state.units) {
                if (o.team === unit.team || chained.includes(o.id) || o.hp <= 0) continue;
                const d = Math.sqrt((o.x - lastX) ** 2 + (o.y - lastY) ** 2);
                if (d <= 4 && d < chainDist) { chainTarget = o; chainDist = d; }
              }
              if (!chainTarget) break;
              chained.push(chainTarget.id);
              addCombatEvent(state, { type: 'chain', x: lastX, y: lastY, x2: chainTarget.x, y2: chainTarget.y, color: '#76ff03' });
              state.projectiles.push({
                id: genId(state), x: lastX, y: lastY,
                targetId: chainTarget.id, damage: Math.round(getEffectiveDamage(unit) * chainPct),
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
            // AoE slow on landing
            for (const nearby of state.units) {
              if (nearby.team === unit.team || nearby.hp <= 0) continue;
              const nd = Math.sqrt((nearby.x - unit.x) ** 2 + (nearby.y - unit.y) ** 2);
              if (nd <= 3) {
                applyStatus(nearby, StatusType.Slow, 1 + (sp?.extraSlowStacks ?? 0));
              }
            }
          }

          const meleeDmg = getEffectiveDamage(unit);
          dealDamage(state, target, meleeDmg, meleeDmg >= 5, unit.playerId, unit.id);
          applyOnHitEffects(state, unit, target);

          // Cleave: hit additional adjacent enemies
          const cleaveN = sp?.cleaveTargets ?? 0;
          if (cleaveN > 0) {
            const cleaved: UnitState[] = [];
            for (const o of state.units) {
              if (o.team === unit.team || o.id === target.id || o.hp <= 0) continue;
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
            if (cleaved.length > 0 && state.rng() < 0.3) {
              addFloatingText(state, unit.x, unit.y - 0.3, '⚔️', '#ff9800', undefined, true);
            }
          }
        }

        unit.attackTimer = Math.round(unit.attackSpeed * TICK_RATE);
      }
    }

    // Attack enemy towers when no unit targets available
    if (unit.targetId === null && unit.attackTimer <= 0) {
      let nearestTower: BuildingState | null = null;
      let ntd = Infinity;
      for (const b of state.buildings) {
        if (b.type !== BuildingType.Tower) continue;
        const bPlayer = state.players[b.playerId];
        if (!bPlayer || bPlayer.team === unit.team) continue;
        if (b.hp <= 0) continue;
        const d = Math.sqrt((b.worldX + 0.5 - unit.x) ** 2 + (b.worldY + 0.5 - unit.y) ** 2);
        if (d <= unit.range + 1.5 && d < ntd) { nearestTower = b; ntd = d; }
      }
      if (nearestTower) {
        const tDmg = getEffectiveDamage(unit);
        nearestTower.hp -= tDmg;
        addFloatingText(state, nearestTower.worldX, nearestTower.worldY, `-${tDmg}`, '#ff6600');
        unit.attackTimer = Math.round(unit.attackSpeed * TICK_RATE);
        if (nearestTower.hp <= 0) {
          addFloatingText(state, nearestTower.worldX, nearestTower.worldY, 'DESTROYED', '#ff0000');
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
        const hDmg = getEffectiveDamage(unit);
        state.hqHp[enemyTeam] -= hDmg;
        addFloatingText(state, hqCx, hqCy, `-${hDmg} HQ`, '#ff0000');
        addSound(state, 'hq_damaged', hqCx, hqCy);
        unit.attackTimer = Math.round(unit.attackSpeed * TICK_RATE);
      }
    }

    if (unit.attackTimer > 0) unit.attackTimer--;
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
      addFloatingText(state, u.x, u.y, '💚', '#44ff44', undefined, true);
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
    if (deathSoundCount < 3) { addSound(state, 'unit_killed', u.x, u.y); deathSoundCount++; }
    // Record fallen heroes (units with kills)
    if (u.kills > 0) {
      state.fallenHeroes.push({
        name: u.type, playerId: u.playerId, race: state.players[u.playerId].race,
        category: u.category, upgradeNode: u.upgradeNode,
        kills: u.kills, survived: false, killedByName: u.lastDamagedByName || 'unknown',
        spawnTick: u.spawnTick, deathTick: state.tick,
      });
    }
  }
  state.units = state.units.filter(u => u.hp > 0);

  // Remove destroyed towers (killed by combat units)
  for (let i = state.buildings.length - 1; i >= 0; i--) {
    if (state.buildings[i].hp <= 0 && state.buildings[i].type === BuildingType.Tower) {
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
    addFloatingText(state, closestHarv.x, closestHarv.y, `-${HQ_DAMAGE}`, '#ffaa00');
    if (closestHarv.hp <= 0) {
      addDeathParticles(state, closestHarv.x, closestHarv.y, '#ffaa00', 4);
      killHarvester(state, closestHarv);
    }
    state.hqAttackTimer[team] = HQ_COOLDOWN_TICKS;
  }
}

function tickTowers(state: GameState): void {
  for (const building of state.buildings) {
    if (building.type !== BuildingType.Tower) continue;

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
      });
      // Ember tower applies burn on hit (handled in tickProjectiles)
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
      addFloatingText(state, closestHarv.x, closestHarv.y, `-${stats.damage}`, '#ffaa00');
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

  for (const p of state.projectiles) {
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
      dealDamage(state, target, p.damage, true, p.sourcePlayerId, p.sourceUnitId);
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
        // Geists Wraith Bow: ranged lifesteal
        if (p.lifestealPct && p.lifestealPct > 0) {
          const source = state.units.find(u => u.id === p.sourceUnitId);
          if (source && source.hp > 0) {
            const steal = Math.round(p.damage * p.lifestealPct);
            if (steal > 0) {
              source.hp = Math.min(source.maxHp, source.hp + steal);
              addCombatEvent(state, { type: 'lifesteal', x: target.x, y: target.y, x2: source.x, y2: source.y, color: '#b39ddb' });
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
              if (race === Race.Oozlings) applyStatus(u, StatusType.Slow, 1);
              // AoE lifesteal
              if (p.lifestealPct && p.lifestealPct > 0) {
                const source = state.units.find(s => s.id === p.sourceUnitId);
                if (source && source.hp > 0) {
                  const steal = Math.round(aoeDmg * p.lifestealPct);
                  if (steal > 0) {
                    source.hp = Math.min(source.maxHp, source.hp + steal);
                  }
                }
              }
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
  // Upgrade regen: heal once per second (suppressed by Blight: burn stacks >= 3)
  if (state.tick % TICK_RATE === 0) {
    for (const unit of state.units) {
      const regen = unit.upgradeSpecial?.regenPerSec ?? 0;
      if (regen > 0 && unit.hp < unit.maxHp) {
        const burnEff = unit.statusEffects.find(e => e.type === StatusType.Burn);
        const blighted = burnEff && burnEff.stacks >= 3;
        if (!blighted) {
          unit.hp = Math.min(unit.maxHp, unit.hp + regen);
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
        dealDamage(state, unit, burnDmg, true);
        if (hasSlowCombo) {
          addDeathParticles(state, unit.x, unit.y, '#ff6600', 1);
          addDeathParticles(state, unit.x, unit.y, '#2979ff', 1);
          if (state.tick % (TICK_RATE * 3) === 0) { // show "SEARED" every 3 seconds
            addFloatingText(state, unit.x, unit.y - 0.3, '🔥', '#ff8c00', undefined, true);
          }
        } else {
          addDeathParticles(state, unit.x, unit.y, '#ff4400', 1);
        }
        // BLIGHT: burn 3+ stacks = no regen (shown every 3s)
        if (eff.stacks >= 3 && state.tick % (TICK_RATE * 3) === 0) {
          addFloatingText(state, unit.x, unit.y - 0.5, '☠️', '#9c27b0', undefined, true);
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
        dealDamage(state, nearest, stats.damage, false, building.playerId);
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
        dealDamage(state, nearest, stats.damage, false, building.playerId);
        if (state.rng() < 0.3) {
          applyKnockback(nearest, 0.02, state.mapDef);
          addDeathParticles(state, nearest.x, nearest.y, '#ffab40', 3);
          if (state.rng() < 0.3) addFloatingText(state, nearest.x, nearest.y - 0.3, '💥', '#ffab40', undefined, true);
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
        dealDamage(state, targets[i], dmg, true, building.playerId);
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
        dealDamage(state, nearest, stats.damage, false, building.playerId);
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
          dealDamage(state, u, stats.damage, false, building.playerId);
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
          dealDamage(state, u, stats.damage, false, building.playerId);
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
        dealDamage(state, nearest, stats.damage, false, building.playerId);
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
          dealDamage(state, u, stats.damage, false, building.playerId);
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
      nukeKills++;
      return false;
    }
    return true;
  });
  if (state.playerStats[playerId]) state.playerStats[playerId].nukeKills += nukeKills;

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
          h.targetCellIdx = -1; h.fightTargetId = null; h.damage = 0;
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
    const movePerTick = (HARVESTER_MOVE_SPEED / TICK_RATE) * (frightened ? 0.5 : 1.0);

    if (h.assignment === HarvesterAssignment.Center) {
      tickCenterHarvester(state, h, movePerTick, centerCtx);
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
        moveWithSlide(h, target.x, target.y, movePerTick, state.diamondCells, state.mapDef);
      }
    } else if (h.state === 'mining') {
      h.miningTimer--;
      if (h.assignment === HarvesterAssignment.Wood) {
        const missingWood = Math.max(0, h.woodCarryTarget - h.queuedWoodAmount);
        const batchCount = Math.max(1, Math.min(WOOD_DROP_BATCHES, missingWood));
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
          case HarvesterAssignment.BaseGold:
            h.carryingResource = ResourceType.Gold; h.carryAmount = GOLD_YIELD_PER_TRIP; break;
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
        addFloatingText(state, enemyCarrier.x, enemyCarrier.y, `-${h.damage}`, '#ff8800');
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
        const yield_ = Math.min(GOLD_YIELD_PER_TRIP, cell.gold);
        cell.gold -= yield_;
        h.carryingResource = ResourceType.Gold;
        h.carryAmount = yield_;
        h.state = 'walking_home';
        h.targetCellIdx = -1;
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

function walkHome(state: GameState, h: HarvesterState, movePerTick: number): void {
  const hq = getHQPosition(h.team, state.mapDef);
  const tx = hq.x + HQ_WIDTH / 2, ty = hq.y + HQ_HEIGHT / 2;
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
  } else {
    moveWithSlide(h, tx, ty, movePerTick, state.diamondCells);
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
  }
}

function computeWarHeroes(state: GameState): void {
  // Combine surviving units and fallen heroes, pick the top killer per player
  const candidates: WarHero[] = [...state.fallenHeroes];
  // Add surviving units
  for (const u of state.units) {
    if (u.kills > 0) {
      candidates.push({
        name: u.type, playerId: u.playerId, race: state.players[u.playerId].race,
        category: u.category, upgradeNode: u.upgradeNode,
        kills: u.kills, survived: true, killedByName: null,
        spawnTick: u.spawnTick, deathTick: null,
      });
    }
  }
  // Pick overall best (most kills)
  candidates.sort((a, b) => b.kills - a.kills || a.playerId - b.playerId || a.spawnTick - b.spawnTick);
  // Take the top hero (the single most impactful unit in the match)
  if (candidates.length > 0) {
    state.warHeroes.push(candidates[0]);
  }
  // Also add best per player if different
  const seen = new Set<number>();
  if (state.warHeroes.length > 0) seen.add(state.warHeroes[0].playerId);
  for (const c of candidates) {
    if (!seen.has(c.playerId)) {
      state.warHeroes.push(c);
      seen.add(c.playerId);
    }
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
