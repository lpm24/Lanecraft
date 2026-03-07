import {
  GameState, PlayerState, DiamondState, Team, Race, Lane, createPlayerStats,
  MAP_WIDTH, MAP_HEIGHT, HQ_HP, HQ_WIDTH, HQ_HEIGHT,
  BUILD_GRID_COLS, BUILD_GRID_ROWS, HUT_GRID_COLS, SHARED_ALLEY_COLS, SHARED_ALLEY_ROWS, ZONES, TICK_RATE,
  DIAMOND_CENTER_X, DIAMOND_CENTER_Y, DIAMOND_HALF_W, DIAMOND_HALF_H,
  WOOD_NODE_X, STONE_NODE_X,
  GOLD_PER_CELL, GoldCell, CROSS_BASE_MARGIN, CROSS_BASE_WIDTH,
  getMarginAtRow,
  LANE_PATHS, Vec2,
  GameCommand, BuildingType, BuildingState, ResourceType,
  HarvesterAssignment, HarvesterState, UnitState, WarHero,
  StatusType, SoundEvent,
} from './types';
import {
  SPAWN_INTERVAL_TICKS, UNIT_STATS, TOWER_STATS,
  HARVESTER_MOVE_SPEED, MINE_TIME_BASE_TICKS, MINE_TIME_DIAMOND_TICKS,
  HARVESTER_RESPAWN_TICKS, HARVESTER_MIN_SEPARATION,
  UPGRADE_TREES, UpgradeNodeDef, RACE_UPGRADE_COSTS, getBuildingCost,
} from './data';

function genId(state: GameState): number { return state.nextEntityId++; }
const SELL_COOLDOWN_TICKS = 5 * TICK_RATE;

// Passive income per second per race: +1 of primary resource, +0.1 of secondary
const PASSIVE_INCOME: Record<Race, { gold: number; wood: number; stone: number }> = {
  [Race.Crown]:    { gold: 1,   wood: 0.1, stone: 0 },    // gold primary, tiny wood
  [Race.Horde]:    { gold: 1,   wood: 0,   stone: 0.1 },  // gold primary, tiny stone
  [Race.Goblins]:  { gold: 1,   wood: 0.1, stone: 0 },    // gold primary, tiny wood
  [Race.Oozlings]: { gold: 1,   wood: 0,   stone: 0.1 },  // gold primary, tiny stone
  [Race.Demon]:    { gold: 0,   wood: 0.1, stone: 1 },    // stone primary, tiny wood
  [Race.Deep]:     { gold: 0.1, wood: 1,   stone: 0 },    // wood primary, tiny gold
  [Race.Wild]:     { gold: 0,   wood: 1,   stone: 0.1 },  // wood primary, tiny stone
  [Race.Geists]:   { gold: 0.1, wood: 0,   stone: 1 },    // stone primary, tiny gold
  [Race.Tenders]:  { gold: 0.1, wood: 1,   stone: 0 },    // wood primary, tiny gold
};

const INITIAL_RESOURCES: Record<Race, { gold: number; wood: number; stone: number }> = {
  [Race.Crown]:    { gold: 200, wood: 25,  stone: 0 },
  [Race.Horde]:    { gold: 200, wood: 0,   stone: 25 },
  [Race.Goblins]:  { gold: 200, wood: 25,  stone: 0 },
  [Race.Oozlings]: { gold: 200, wood: 0,   stone: 25 },
  [Race.Demon]:    { gold: 0,   wood: 50,  stone: 150 },
  [Race.Deep]:     { gold: 50,  wood: 150, stone: 0 },
  [Race.Wild]:     { gold: 0,   wood: 150, stone: 50 },
  [Race.Geists]:   { gold: 50,  wood: 0,   stone: 150 },
  [Race.Tenders]:  { gold: 50,  wood: 150, stone: 0 },
};

const PRIMARY_RESOURCE: Record<Race, HarvesterAssignment> = {
  [Race.Crown]:    HarvesterAssignment.BaseGold,
  [Race.Horde]:    HarvesterAssignment.BaseGold,
  [Race.Goblins]:  HarvesterAssignment.BaseGold,
  [Race.Oozlings]: HarvesterAssignment.BaseGold,
  [Race.Demon]:    HarvesterAssignment.Stone,
  [Race.Deep]:     HarvesterAssignment.Wood,
  [Race.Wild]:     HarvesterAssignment.Wood,
  [Race.Geists]:   HarvesterAssignment.Stone,
  [Race.Tenders]:  HarvesterAssignment.Wood,
};

type UpgradeChoice = 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

function isValidUpgradeChoice(path: string[], choice: string): choice is UpgradeChoice {
  if (path.length === 1) return choice === 'B' || choice === 'C';
  if (path.length !== 2) return false;
  if (path[1] === 'B') return choice === 'D' || choice === 'E';
  if (path[1] === 'C') return choice === 'F' || choice === 'G';
  return false;
}

function getUpgradeCost(path: string[], race: Race): { gold: number; wood: number; stone: number } | null {
  const costs = RACE_UPGRADE_COSTS[race];
  if (path.length === 1) return costs.tier1;
  if (path.length === 2) return costs.tier2;
  return null;
}

export interface UpgradeResult {
  hp: number; damage: number; attackSpeed: number; moveSpeed: number; range: number;
  special: import('./data').UpgradeSpecial;
}

export function getUnitUpgradeMultipliers(path: string[], race?: Race, buildingType?: BuildingType): UpgradeResult {
  let hp = 1, damage = 1, attackSpeed = 1, moveSpeed = 1, range = 1;
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
  return { hp, damage, attackSpeed, moveSpeed, range, special };
}

function addSound(state: GameState, type: SoundEvent['type'], x?: number, y?: number): void {
  state.soundEvents.push({ type, x, y });
}

// === Generate diamond-shaped gold cell grid ===

function generateDiamondCells(): GoldCell[] {
  const cells: GoldCell[] = [];
  const cx = DIAMOND_CENTER_X;
  const cy = DIAMOND_CENTER_Y;
  const hw = DIAMOND_HALF_W;
  const hh = DIAMOND_HALF_H;

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

function isDiamondExposed(cellMap: Map<string, GoldCell>): boolean {
  const neighbors = [
    { x: DIAMOND_CENTER_X - 1, y: DIAMOND_CENTER_Y },
    { x: DIAMOND_CENTER_X + 1, y: DIAMOND_CENTER_Y },
    { x: DIAMOND_CENTER_X, y: DIAMOND_CENTER_Y - 1 },
    { x: DIAMOND_CENTER_X, y: DIAMOND_CENTER_Y + 1 },
  ];
  for (const n of neighbors) {
    const cell = cellMap.get(`${n.x},${n.y}`);
    if (!cell || cell.gold <= 0) {
      if (hasPathToEdge(cellMap, n.x, n.y)) return true;
    }
  }
  return false;
}

function hasPathToEdge(cellMap: Map<string, GoldCell>, sx: number, sy: number): boolean {
  const visited = new Set<string>();
  const queue: { x: number; y: number }[] = [{ x: sx, y: sy }];
  visited.add(`${sx},${sy}`);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const dx = Math.abs(cur.x - DIAMOND_CENTER_X);
    const dy = Math.abs(cur.y - DIAMOND_CENTER_Y);
    if (dx > DIAMOND_HALF_W || dy > DIAMOND_HALF_H) return true;

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

function findBestCellToMine(cells: GoldCell[], cellMap: Map<string, GoldCell>, fromX: number, fromY: number): number {
  let bestIdx = -1;
  let bestDist = Infinity;

  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c.gold <= 0) continue;
    if (!isAccessible(cellMap, c.tileX, c.tileY)) continue;
    const dx = c.tileX - fromX;
    const dy = c.tileY - fromY;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function isAccessible(cellMap: Map<string, GoldCell>, tx: number, ty: number): boolean {
  for (const [nx, ny] of [[tx-1,ty],[tx+1,ty],[tx,ty-1],[tx,ty+1]]) {
    const neighbor = cellMap.get(`${nx},${ny}`);
    if (!neighbor) return true;
    if (neighbor.gold <= 0) return true;
  }
  return false;
}

// === Visual effect helpers ===

function addFloatingText(state: GameState, x: number, y: number, text: string, color: string): void {
  state.floatingTexts.push({ x, y, text, color, age: 0, maxAge: TICK_RATE * 1.5 });
}

function addDeathParticles(state: GameState, x: number, y: number, color: string, count: number): void {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.5 + Math.random() * 2;
    state.particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      age: 0,
      maxAge: TICK_RATE * (0.5 + Math.random() * 0.8),
      size: 1 + Math.random() * 2,
    });
  }
}

// === State Creation ===

export function createInitialState(
  players: { race: Race; isBot: boolean }[]
): GameState {
  const playerStates: PlayerState[] = players.map((p, i) => ({
    id: i,
    team: i < 2 ? Team.Bottom : Team.Top,
    race: p.race,
    gold: INITIAL_RESOURCES[p.race].gold,
    wood: INITIAL_RESOURCES[p.race].wood,
    stone: INITIAL_RESOURCES[p.race].stone,
    nukeAvailable: true,
    connected: true,
    isBot: p.isBot,
    hasBuiltTower: false,
  }));

  const diamond: DiamondState = {
    x: DIAMOND_CENTER_X,
    y: DIAMOND_CENTER_Y,
    exposed: false,
    state: 'hidden',
    carrierId: null,
    carrierType: null,
    mineProgress: 0,
  };

  const state: GameState = {
    tick: 0,
    players: playerStates,
    buildings: [],
    units: [],
    harvesters: [],
    projectiles: [],
    diamond,
    diamondCells: generateDiamondCells(),
    hqHp: [HQ_HP, HQ_HP],
    winner: null,
    winCondition: null,
    matchPhase: 'prematch',
    prematchTimer: 10 * TICK_RATE,
    floatingTexts: [],
    particles: [],
    nukeEffects: [],
    nukeTelegraphs: [],
    pings: [],
    quickChats: [],
    soundEvents: [],
    nextEntityId: 1,
    playerStats: players.map(() => createPlayerStats()),
    warHeroes: [],
    fallenHeroes: [],
  };

  // Give each player a free starter hut + harvester
  for (let i = 0; i < playerStates.length; i++) {
    const p = playerStates[i];
    const origin = getHutGridOrigin(i);
    const gx = 4; // center slot
    const world = { x: origin.x + gx, y: origin.y };
    const hutHp = getBuildingCost(p.race, BuildingType.HarvesterHut).hp;
    const building: BuildingState = {
      id: genId(state), type: BuildingType.HarvesterHut, playerId: i, buildGrid: 'hut',
      gridX: gx, gridY: 0, worldX: world.x, worldY: world.y,
      lane: Lane.Left, hp: hutHp, maxHp: hutHp, actionTimer: 0, placedTick: 0, upgradePath: [],
    };
    state.buildings.push(building);
    // Assign starter harvester to the race's primary resource
    const startAssignment = PRIMARY_RESOURCE[p.race];
    state.harvesters.push({
      id: genId(state), hutId: building.id, playerId: i, team: p.team,
      x: world.x, y: world.y, hp: 30, maxHp: 30, damage: 0,
      assignment: startAssignment,
      state: 'walking_to_node', miningTimer: 0, respawnTimer: 0,
      carryingDiamond: false, carryingResource: null, carryAmount: 0,
      targetCellIdx: -1, fightTargetId: null,
    });
  }


  return state;
}

// === Layout helpers ===

export function getBuildGridOrigin(playerId: number): { x: number; y: number } {
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

// Hut zone: 10-wide × 1-tall row at the far edge of the player's base
export function getHutGridOrigin(playerId: number): { x: number; y: number } {
  const team = playerId < 2 ? Team.Bottom : Team.Top;
  // Player-specific hut origins are intentionally tuned to match visual spacing goals.
  // P1/P3 rows start at x=29 and P2/P4 rows start at x=41, producing a 2-tile gap
  // between the two 10-wide hut rows (mirrors the build-grid center gap).
  const x = (playerId === 0 || playerId === 2) ? 29 : 41;
  const y = team === Team.Bottom ? ZONES.BOTTOM_BASE.end - 2 : ZONES.TOP_BASE.start + 1;
  return { x, y };
}

// Shared tower alley: 10-wide × 3-tall grid per team, centred on the neck path (x=35, overlaps x=40)
export function getTeamAlleyOrigin(team: Team): { x: number; y: number } {
  // 20-wide grid centered on x=40 → starts at x=30
  // 12-tall grid: bottom team above neck, top team below neck
  return { x: 30, y: team === Team.Bottom ? 82 : 26 };
}

export function getHQPosition(team: Team): { x: number; y: number } {
  const centerX = Math.floor(MAP_WIDTH / 2) - Math.floor(HQ_WIDTH / 2);
  return team === Team.Bottom
    ? { x: centerX, y: ZONES.BOTTOM_BASE.start + 1 }
    : { x: centerX, y: ZONES.TOP_BASE.end - HQ_HEIGHT - 1 };
}

export function gridSlotToWorld(playerId: number, gridX: number, gridY: number): { x: number; y: number } {
  const origin = getBuildGridOrigin(playerId);
  return { x: origin.x + gridX, y: origin.y + gridY };
}

// === Lane path helpers ===

function getLanePath(team: Team, lane: Lane): readonly Vec2[] {
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

// Precomputed path lengths — paths are constants so this is safe to cache at module level
const PATH_LENGTH: Record<string, number> = {
  'bottom_left':  getPathLength(LANE_PATHS.bottom.left),
  'bottom_right': getPathLength(LANE_PATHS.bottom.right),
  'top_left':     getPathLength(LANE_PATHS.top.left),
  'top_right':    getPathLength(LANE_PATHS.top.right),
};
function getCachedPathLength(team: Team, lane: Lane): number {
  return PATH_LENGTH[`${team === Team.Bottom ? 'bottom' : 'top'}_${lane}`];
}

const CHOKE_POINTS: readonly Vec2[] = [
  { x: 40, y: 95 },
  { x: 40, y: 82 },
  { x: 40, y: 38 },
  { x: 40, y: 25 },
];

function getChokeSpreadMultiplier(x: number, y: number): number {
  let best = Infinity;
  for (const p of CHOKE_POINTS) {
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
    tickEffects(state);
    state.tick++;
    return;
  }

  // Passive income: +1/sec of primary resource, +0.1/sec of secondary resource
  // Primary = most-used resource in building costs; secondary = other needed resource
  if (state.tick % TICK_RATE === 0) {
    for (const p of state.players) {
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
    if (isDiamondExposed(diamondCellMap)) {
      state.diamond.exposed = true;
      state.diamond.state = 'exposed';
      addSound(state, 'diamond_exposed', DIAMOND_CENTER_X, DIAMOND_CENTER_Y);
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
  tickHarvesters(state, diamondCellMap);
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
    if (state.hqHp[0] > state.hqHp[1]) state.winner = Team.Bottom;
    else if (state.hqHp[1] > state.hqHp[0]) state.winner = Team.Top;
    state.winCondition = 'timeout';
  }

  state.tick++;
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
  const cost = getUpgradeCost(building.upgradePath, player.race);
  if (!cost) return;
  if (player.gold < cost.gold || player.wood < cost.wood || player.stone < cost.stone) return;

  player.gold -= cost.gold;
  player.wood -= cost.wood;
  player.stone -= cost.stone;
  building.upgradePath.push(cmd.choice);

  // Apply HP upgrade to tower (scales maxHp and heals proportionally)
  if (building.type === BuildingType.Tower) {
    const upgrade = getUnitUpgradeMultipliers(building.upgradePath, player.race, BuildingType.Tower);
    const baseCost = getBuildingCost(player.race, BuildingType.Tower);
    if (baseCost) {
      const newMax = Math.max(1, Math.round(baseCost.hp * upgrade.hp));
      const hpRatio = building.hp / building.maxHp;
      building.maxHp = newMax;
      building.hp = Math.round(newMax * hpRatio);
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
  const isLeft = cmd.playerId === 0 || cmd.playerId === 2;

  if (isAlley) {
    // Shared tower alley: only towers allowed; occupancy is team-wide
    if (cmd.buildingType !== BuildingType.Tower) return;
    if (cmd.gridX < 0 || cmd.gridX >= SHARED_ALLEY_COLS || cmd.gridY < 0 || cmd.gridY >= SHARED_ALLEY_ROWS) return;
    const playerTeam = cmd.playerId < 2 ? Team.Bottom : Team.Top;
    if (state.buildings.some(b => b.buildGrid === 'alley' &&
        (b.playerId < 2 ? Team.Bottom : Team.Top) === playerTeam &&
        b.gridX === cmd.gridX && b.gridY === cmd.gridY)) return;
    const origin = getTeamAlleyOrigin(playerTeam);
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
    // Military grid
    if (cmd.gridX < 0 || cmd.gridX >= BUILD_GRID_COLS || cmd.gridY < 0 || cmd.gridY >= BUILD_GRID_ROWS) return;
    if (state.buildings.some(b => b.buildGrid === 'military' && b.playerId === cmd.playerId && b.gridX === cmd.gridX && b.gridY === cmd.gridY)) return;
    if (!isFirstTower) { player.gold -= cost.gold; player.wood -= cost.wood; player.stone -= cost.stone; }
    const world = gridSlotToWorld(cmd.playerId, cmd.gridX, cmd.gridY);
    const initialTimer = cmd.buildingType === BuildingType.Tower ? 0 : SPAWN_INTERVAL_TICKS;
    state.buildings.push({
      id: genId(state), type: cmd.buildingType, playerId: cmd.playerId, buildGrid: 'military',
      gridX: cmd.gridX, gridY: cmd.gridY, worldX: world.x, worldY: world.y,
      lane: isLeft ? Lane.Left : Lane.Right,
      hp: cost.hp, maxHp: cost.hp, actionTimer: initialTimer, placedTick: state.tick, upgradePath: ['A'],
    });
    addSound(state, 'building_placed', world.x, world.y);
    if (isFirstTower) player.hasBuiltTower = true;
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
  if (cost) player.gold += Math.floor(cost.gold * 0.5);

  // If it's a hut, remove the associated harvester
  if (building.type === BuildingType.HarvesterHut) {
    const hIdx = state.harvesters.findIndex(h => h.hutId === building.id);
    if (hIdx !== -1) state.harvesters.splice(hIdx, 1);
  }

  addFloatingText(state, building.worldX, building.worldY, `+${Math.floor(cost.gold * 0.5)}g`, '#ffd700');
  addSound(state, 'building_destroyed', building.worldX, building.worldY);
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
  if (myHuts.length >= HUT_GRID_COLS) return;
  const hutRes = getBuildingCost(player.race, BuildingType.HarvesterHut);
  const mult = Math.pow(1.35, Math.max(0, myHuts.length - 1));
  const goldCost = Math.floor(hutRes.gold * mult);
  const woodCost = Math.floor(hutRes.wood * mult);
  const stoneCost = Math.floor(hutRes.stone * mult);
  if (player.gold < goldCost || player.wood < woodCost || player.stone < stoneCost) return;
  player.gold -= goldCost;
  player.wood -= woodCost;
  player.stone -= stoneCost;

  const origin = getHutGridOrigin(cmd.playerId);
  const occupiedHuts = new Set(myHuts.map(b => b.gridX));
  // Fill from center outward
  const CENTER_OUT = [4, 5, 3, 6, 2, 7, 1, 8, 0, 9];
  for (const gx of CENTER_OUT) {
    if (!occupiedHuts.has(gx)) {
      const world = { x: origin.x + gx, y: origin.y };
      const building: BuildingState = {
        id: genId(state), type: BuildingType.HarvesterHut, playerId: cmd.playerId, buildGrid: 'hut',
        gridX: gx, gridY: 0, worldX: world.x, worldY: world.y,
        lane: Lane.Left, hp: getBuildingCost(player.race, BuildingType.HarvesterHut).hp, maxHp: getBuildingCost(player.race, BuildingType.HarvesterHut).hp, actionTimer: 0, placedTick: state.tick, upgradePath: [],
      };
      state.buildings.push(building);
      state.harvesters.push({
        id: genId(state), hutId: building.id, playerId: cmd.playerId, team: player.team,
        x: world.x, y: world.y, hp: 30, maxHp: 30, damage: 0,
        assignment: HarvesterAssignment.BaseGold,
        state: 'walking_to_node', miningTimer: 0, respawnTimer: 0,
        carryingDiamond: false, carryingResource: null, carryAmount: 0,
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
  if (h.state === 'walking_to_node' || h.state === 'mining') {
    h.state = 'walking_to_node';
    h.miningTimer = 0;
    h.targetCellIdx = -1;
  }
}

function fireNuke(state: GameState, cmd: Extract<GameCommand, { type: 'fire_nuke' }>): void {
  const player = state.players[cmd.playerId];
  if (!player.nukeAvailable) return;

  // Nukes can only land on your own half + mid zone (not enemy base/territory)
  const team = player.team;
  if (team === Team.Bottom && cmd.y < ZONES.MID.start) return;
  if (team === Team.Top && cmd.y > ZONES.MID.end) return;

  player.nukeAvailable = false;

  // 1.25 second telegraph before detonation.
  // Radius intentionally set to 16 for large-teamfight impact.
  state.nukeTelegraphs.push({
    x: cmd.x, y: cmd.y,
    radius: 16,
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

function killHarvester(h: HarvesterState): void {
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
      building.actionTimer = SPAWN_INTERVAL_TICKS;
      const player = state.players[building.playerId];
      const stats = UNIT_STATS[player.race]?.[building.type];
      if (!stats) continue;
      const upgrade = getUnitUpgradeMultipliers(building.upgradePath, player.race, building.type);
      const category: UnitState['category'] =
        building.type === BuildingType.CasterSpawner ? 'caster' :
        building.type === BuildingType.RangedSpawner ? 'ranged' : 'melee';
      const count = stats.spawnCount ?? 1;
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
          upgradeSpecial: upgrade.special, kills: 0, lastDamagedByName: '',
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

function tickUnitMovement(state: GameState): void {
  for (const unit of state.units) {
    if (unit.targetId !== null) continue;
    const speed = getEffectiveSpeed(unit);
    let movePerTick = speed / TICK_RATE;

    // Phase 1: Walking from building to lane path start
    if (unit.pathProgress < 0) {
      const path = getLanePath(unit.team, unit.lane);
      const target = path[0]; // first waypoint
      const dx = target.x - unit.x, dy = target.y - unit.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < movePerTick * 2) {
        // Close enough — join the lane path
        unit.pathProgress = 0;
        unit.x = target.x;
        unit.y = target.y;
      } else {
        moveWithSlide(unit, target.x, target.y, movePerTick, state.diamondCells);
      }
      continue;
    }

    // Phase 2: Following lane path
    const path = getLanePath(unit.team, unit.lane);
    const pathLen = getCachedPathLength(unit.team, unit.lane);

    // Ranged units prefer to stay ~3 tiles behind nearest allied melee
    if (unit.category === 'ranged') {
      let nearestMeleeProgress = -1;
      let nearestMeleeDist = Infinity;
      for (const other of state.units) {
        if (other.id === unit.id || other.team !== unit.team || other.lane !== unit.lane) continue;
        if (other.category !== 'melee' || other.pathProgress < 0) continue;
        const d = Math.abs(other.pathProgress - unit.pathProgress);
        if (d < nearestMeleeDist) { nearestMeleeDist = d; nearestMeleeProgress = other.pathProgress; }
      }
      if (nearestMeleeProgress >= 0) {
        const behindOffset = 3 / pathLen; // ~3 tiles behind
        const idealProgress = nearestMeleeProgress - behindOffset;
        if (unit.pathProgress > idealProgress + 0.005) {
          // Too far forward — slow down significantly
          movePerTick *= 0.2;
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
    const chokeSpread = getChokeSpreadMultiplier(pos.x, pos.y);

    let sep = 0;
    let sepCount = 0;
    for (const other of state.units) {
      if (other.id === unit.id || other.team !== unit.team || other.lane !== unit.lane) continue;
      const ox = other.x - pos.x;
      const oy = other.y - pos.y;
      const d = Math.sqrt(ox * ox + oy * oy);
      if (d <= 0.001 || d > 1.8) continue;
      const w = (1.8 - d) / 1.8;
      sep -= (ox / d) * w;
      sepCount++;
    }
    const separationOffset = sepCount > 0 ? Math.max(-0.45, Math.min(0.45, sep * 0.12)) : 0;
    const laneOffset = (baseOffset + jitter + separationOffset) * chokeSpread;
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
      moveWithSlide(unit, desiredX, desiredY, movePerTick, state.diamondCells);
    } else if (!isBlocked(desiredX, desiredY, 0.45, state.diamondCells)) {
      unit.x = desiredX;
      unit.y = desiredY;
    }
  }
}

function tickUnitDiamondPickup(state: GameState): void {
  // Check if any unit carrying diamond reached own HQ (diamond delivery)
  for (const unit of state.units) {
    if (!unit.carryingDiamond || unit.hp <= 0) continue;
    const hq = getHQPosition(unit.team);
    const hqCx = hq.x + HQ_WIDTH / 2, hqCy = hq.y + HQ_HEIGHT / 2;
    const dx = unit.x - hqCx, dy = unit.y - hqCy;
    if (dx * dx + dy * dy <= 9) { // 3 tile deposit radius
      state.winner = unit.team;
      state.winCondition = 'diamond';
      state.matchPhase = 'ended';
      return;
    }
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
                   5 * TICK_RATE; // Shield
  if (existing) {
    existing.stacks = Math.min(existing.stacks + stacks, maxStacks);
    existing.duration = duration; // refresh
  } else {
    target.statusEffects.push({ type, stacks: Math.min(stacks, maxStacks), duration });
  }
  if (type === StatusType.Shield && target.shieldHp <= 0) target.shieldHp = 20;
}

function applyKnockback(unit: UnitState, amount: number): void {
  if (unit.pathProgress < 0) return; // not on path yet
  // Push unit backward along its path
  unit.pathProgress = Math.max(0, unit.pathProgress - amount);
  const path = getLanePath(unit.team, unit.lane);
  const pos = interpolatePath(path, unit.pathProgress);
  unit.x = pos.x;
  unit.y = pos.y;
}

function dealDamage(state: GameState, target: UnitState, amount: number, showFloat: boolean, sourcePlayerId?: number, sourceUnitId?: number): void {
  // Dodge check
  const dodge = target.upgradeSpecial?.dodgeChance ?? 0;
  if (dodge > 0 && Math.random() < dodge) {
    if (Math.random() < 0.3) addFloatingText(state, target.x, target.y, 'DODGE', '#ffffff');
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
    if (showFloat && amount >= 10) addFloatingText(state, target.x, target.y, `-${amount}`, '#ff6666');
    // Track damage stats
    if (sourcePlayerId !== undefined && state.playerStats[sourcePlayerId]) {
      state.playerStats[sourcePlayerId].totalDamageDealt += amount;
      // Check if near own HQ (within 20 tiles)
      const team = state.players[sourcePlayerId].team;
      const hq = getHQPosition(team);
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
        if (target.hp <= 0) killer.kills++;
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
      const shieldCount = 3 + (sp?.shieldTargetBonus ?? 0);
      const sorted = allies.slice().sort((a, b) =>
        ((a.x - caster.x) ** 2 + (a.y - caster.y) ** 2) - ((b.x - caster.x) ** 2 + (b.y - caster.y) ** 2)
      );
      const absorbBonus = sp?.shieldAbsorbBonus ?? 0;
      for (let i = 0; i < Math.min(shieldCount, sorted.length); i++) {
        applyStatus(sorted[i], StatusType.Shield, 1);
        if (absorbBonus > 0) sorted[i].shieldHp += absorbBonus;
      }
      break;
    }
    case Race.Horde:
    case Race.Oozlings: {
      // Haste pulse: nearby allies get brief haste
      let hasteCount = 0;
      for (const a of allies) {
        if (!a.statusEffects.some(e => e.type === StatusType.Haste)) {
          applyStatus(a, StatusType.Haste, 1);
          hasteCount++;
          if (hasteCount >= 3 + healBonus) break;
        }
      }
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
        addFloatingText(state, caster.x, caster.y - 0.5, 'HEX', '#2e7d32');
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
          cleansed++;
        }
      }
      if (cleansed > 0) {
        addFloatingText(state, caster.x, caster.y - 0.5, 'CLEANSE', '#1565c0');
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
      break;
    }
    case Race.Geists: {
      // Lifesteal heal: heal lowest-HP allies directly
      const healAmt = 2 + healBonus;
      const wounded = allies.filter(a => a.hp < a.maxHp).sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
      const count = Math.min(3, wounded.length);
      for (let i = 0; i < count; i++) {
        wounded[i].hp = Math.min(wounded[i].maxHp, wounded[i].hp + healAmt);
        addDeathParticles(state, wounded[i].x, wounded[i].y, '#546e7a', 1);
      }
      if (count > 0) {
        addFloatingText(state, caster.x, caster.y - 0.5, `+${healAmt}`, '#546e7a');
      }
      break;
    }
    case Race.Tenders: {
      // Regen aura: heal nearby allies
      const healAmt = 3 + healBonus;
      for (const a of allies) {
        if (a.hp < a.maxHp) {
          a.hp = Math.min(a.maxHp, a.hp + healAmt);
          addDeathParticles(state, a.x, a.y, '#33691e', 1);
        }
      }
      if (allies.some(a => a.hp < a.maxHp)) {
        addFloatingText(state, caster.x, caster.y - 0.5, `+${healAmt}`, '#33691e');
      }
      break;
    }
  }
}

function applyOnHitEffects(state: GameState, attacker: UnitState, target: UnitState): void {
  const race = state.players[attacker.playerId].race;
  const isMelee = attacker.range <= 2;
  const isCaster = attacker.category === 'caster';
  const sp = attacker.upgradeSpecial;

  switch (race) {
    case Race.Crown:
      // Swordsman: 10% damage reduction is passive (handled in damage calc), no on-hit
      break;
    case Race.Horde:
      // Brute: knockback every 3rd hit
      if (isMelee) {
        attacker.hitCount++;
        const knockN = sp?.knockbackEveryN ?? 3;
        if (knockN > 0 && attacker.hitCount % knockN === 0) applyKnockback(target, 0.02);
      }
      break;
    case Race.Goblins:
      // Sticker: 15% dodge is passive (handled in damage calc), on-hit burn from Knifer
      if (!isMelee && !isCaster) {
        applyStatus(target, StatusType.Burn, 1 + (sp?.extraBurnStacks ?? 0));
      }
      break;
    case Race.Oozlings:
      // Globule: 15% chance haste on melee hit
      if (isMelee) {
        if (sp?.guaranteedHaste) applyStatus(attacker, StatusType.Haste, 1);
        else if (Math.random() < 0.15) applyStatus(attacker, StatusType.Haste, 1);
      }
      break;
    case Race.Demon:
      // Smasher: burn on every hit (melee)
      if (isMelee) applyStatus(target, StatusType.Burn, 1 + (sp?.extraBurnStacks ?? 0));
      break;
    case Race.Deep:
      // Shell Guard: slow on melee hit
      if (isMelee) applyStatus(target, StatusType.Slow, 1 + (sp?.extraSlowStacks ?? 0));
      // Harpooner: +2 slow on ranged hit
      if (!isMelee && !isCaster) applyStatus(target, StatusType.Slow, 2 + (sp?.extraSlowStacks ?? 0));
      break;
    case Race.Wild:
      // Lurker: burn (poison) on melee hit
      if (isMelee) applyStatus(target, StatusType.Burn, 1 + (sp?.extraBurnStacks ?? 0));
      break;
    case Race.Geists:
      // Bone Knight: burn (soul drain) on melee hit + lifesteal 15%
      if (isMelee) {
        applyStatus(target, StatusType.Burn, 1 + (sp?.extraBurnStacks ?? 0));
        attacker.hp = Math.min(attacker.maxHp, attacker.hp + Math.round(attacker.damage * 0.15));
      }
      // Wraith Bow: lifesteal 20% on ranged hit
      if (!isMelee && !isCaster) {
        attacker.hp = Math.min(attacker.maxHp, attacker.hp + Math.round(attacker.damage * 0.2));
      }
      break;
    case Race.Tenders:
      // Treant: slow on melee hit (entangling roots)
      if (isMelee) applyStatus(target, StatusType.Slow, 1 + (sp?.extraSlowStacks ?? 0));
      break;
  }
}

const COLLISION_BUILDING_RADIUS = 0.8;
const COLLISION_GOLD_CELL_RADIUS = 0.58;

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

function clampToArenaBounds(pos: { x: number; y: number }, radius: number): void {
  pos.y = Math.max(radius, Math.min(MAP_HEIGHT - radius, pos.y));
  const margin = getMarginAtRow(pos.y);
  const minX = margin + radius;
  const maxX = MAP_WIDTH - margin - radius;
  pos.x = Math.max(minX, Math.min(maxX, pos.x));
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
function isInsideUnminedDiamond(x: number, y: number, pad: number, cells: GoldCell[]): boolean {
  // Quick bounding diamond check first
  const dx = Math.abs(x - DIAMOND_CENTER_X) / (DIAMOND_HALF_W + pad);
  const dy = Math.abs(y - DIAMOND_CENTER_Y) / (DIAMOND_HALF_H + pad);
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
function isBlocked(x: number, y: number, pad: number, cells: GoldCell[]): boolean {
  return isInsideAnyHQ(x, y, pad) || isInsideUnminedDiamond(x, y, pad, cells);
}

/**
 * Returns the center of the nearest blocking obstacle, or null if none.
 * Used for steering around obstacles.
 */
function getNearestObstacleCenter(x: number, y: number, pad: number, cells: GoldCell[]): { cx: number; cy: number } | null {
  // Check HQs
  const hqB = getHQPosition(Team.Bottom);
  const hqT = getHQPosition(Team.Top);
  if (isInsideHQEllipse(x, y, hqB.x, hqB.y, HQ_WIDTH, HQ_HEIGHT, pad)) {
    return { cx: hqB.x + HQ_WIDTH / 2, cy: hqB.y + HQ_HEIGHT / 2 };
  }
  if (isInsideHQEllipse(x, y, hqT.x, hqT.y, HQ_WIDTH, HQ_HEIGHT, pad)) {
    return { cx: hqT.x + HQ_WIDTH / 2, cy: hqT.y + HQ_HEIGHT / 2 };
  }
  // Check diamond — treat entire diamond shape as one obstacle with its center
  const ddx = Math.abs(x - DIAMOND_CENTER_X) / (DIAMOND_HALF_W + pad);
  const ddy = Math.abs(y - DIAMOND_CENTER_Y) / (DIAMOND_HALF_H + pad);
  if (ddx + ddy < 1.2) {
    // Near the diamond — check if actually blocked by unmined cells
    if (isInsideUnminedDiamond(x, y, pad, cells)) {
      return { cx: DIAMOND_CENTER_X, cy: DIAMOND_CENTER_Y };
    }
  }
  return null;
}

/**
 * Move pos toward (tx, ty) by up to `step` tiles, steering around obstacles.
 * If direct path is blocked, steers tangent to the obstacle surface.
 */
function moveWithSlide(pos: { x: number; y: number }, tx: number, ty: number, step: number, diamondCells: GoldCell[] = []): void {
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
  if (!isBlocked(nx, ny, pad, diamondCells)) {
    pos.x = nx;
    pos.y = ny;
    return;
  }

  // Blocked — find obstacle center and steer tangent to it
  const obstacle = getNearestObstacleCenter(nx, ny, pad, diamondCells);
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
      if (!isBlocked(sx, sy, pad, diamondCells)) {
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
      if (!isBlocked(bx, by, pad, diamondCells)) {
        pos.x = bx;
        pos.y = by;
        return;
      }
    }
  }

  // Fallback: try X-only slide
  if (!isBlocked(pos.x + mx, pos.y, pad, diamondCells)) {
    pos.x += mx;
    return;
  }
  // Fallback: try Y-only slide
  if (!isBlocked(pos.x, pos.y + my, pad, diamondCells)) {
    pos.y += my;
    return;
  }
  // Fully blocked — pushOut will fix next tick
}


function tickUnitCollision(state: GameState): void {
  for (const unit of state.units) {
    // Unit-vs-building blocking
    for (const building of state.buildings) {
      pushOutFromPoint(unit, building.worldX + 0.5, building.worldY + 0.5, COLLISION_BUILDING_RADIUS);
    }

    // Unit-vs-resource blocking (unmined gold cells are obstacles).
    for (const cell of state.diamondCells) {
      if (cell.gold <= 0) continue;
      pushOutFromPoint(unit, cell.tileX + 0.5, cell.tileY + 0.5, COLLISION_GOLD_CELL_RADIUS);
    }

    clampToArenaBounds(unit, 0.35);
  }
}

function tickCombat(state: GameState): void {
  const unitById = new Map(state.units.map(u => [u.id, u]));
  const AGGRO_BONUS = 2.5;
  const AGGRO_LEASH = 3.5;

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
    // Acquire new target
    if (unit.targetId === null) {
      let nearest: UnitState | null = null;
      let nd = Infinity;
      for (const o of state.units) {
        if (o.team === unit.team || o.hp <= 0) continue;
        const d = Math.sqrt((o.x - unit.x) ** 2 + (o.y - unit.y) ** 2);
        if (d <= unit.range + AGGRO_BONUS && d < nd) { nearest = o; nd = d; }
      }
      if (nearest) unit.targetId = nearest.id;
    }

    // Chase current target until in attack range.
    if (unit.targetId !== null) {
      const target = unitById.get(unit.targetId);
      if (target) {
        const dx = target.x - unit.x;
        const dy = target.y - unit.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > unit.range && dist > 0.001) {
          const movePerTick = getEffectiveSpeed(unit) / TICK_RATE;
          const step = Math.min(movePerTick, dist - unit.range);
          moveWithSlide(unit, target.x, target.y, step, state.diamondCells);
          clampToArenaBounds(unit, 0.35);
        }
      }
    }

    // Attack
    if (unit.targetId !== null && unit.attackTimer <= 0) {
      const target = unitById.get(unit.targetId);
      if (target) {
        const targetDist = Math.sqrt((target.x - unit.x) ** 2 + (target.y - unit.y) ** 2);
        if (targetDist > unit.range) {
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
            state.projectiles.push({
              id: genId(state), x: unit.x, y: unit.y,
              targetId: target.id, damage: unit.damage,
              speed: 10, aoeRadius, team: unit.team,
              sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
              extraBurnStacks: sp?.extraBurnStacks,
              extraSlowStacks: sp?.extraSlowStacks,
            });
          }
        } else if (isCaster) {
          // Demon caster: pure damage AoE, no support
          const sp = unit.upgradeSpecial;
          const aoeRadius = 3 + (sp?.aoeRadiusBonus ?? 0);
          state.projectiles.push({
            id: genId(state), x: unit.x, y: unit.y,
            targetId: target.id, damage: unit.damage,
            speed: 10, aoeRadius, team: unit.team,
            sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
            extraBurnStacks: sp?.extraBurnStacks,
            extraSlowStacks: sp?.extraSlowStacks,
          });
        } else if (unit.range > 2) {
          // Ranged unit: fire projectile
          const sp = unit.upgradeSpecial;
          const splashR = sp?.splashRadius ?? 0;
          state.projectiles.push({
            id: genId(state), x: unit.x, y: unit.y,
            targetId: target.id, damage: unit.damage,
            speed: 15, aoeRadius: splashR, team: unit.team,
            sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
            extraBurnStacks: sp?.extraBurnStacks,
            extraSlowStacks: sp?.extraSlowStacks,
            splashDamagePct: sp?.splashDamagePct,
          });
          // Multishot: extra projectiles at nearby enemies
          const msCount = sp?.multishotCount ?? 0;
          if (msCount > 0) {
            const msDmg = Math.round(unit.damage * (sp?.multishotDamagePct ?? 0.5));
            const nearby = state.units
              .filter(o => o.team !== unit.team && o.id !== target.id && o.hp > 0)
              .map(o => ({ u: o, d: Math.sqrt((o.x - unit.x) ** 2 + (o.y - unit.y) ** 2) }))
              .filter(e => e.d <= unit.range)
              .sort((a, b) => a.d - b.d);
            for (let mi = 0; mi < Math.min(msCount, nearby.length); mi++) {
              state.projectiles.push({
                id: genId(state), x: unit.x, y: unit.y,
                targetId: nearby[mi].u.id, damage: msDmg,
                speed: 15, aoeRadius: 0, team: unit.team,
                sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
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
              state.projectiles.push({
                id: genId(state), x: lastX, y: lastY,
                targetId: chainTarget.id, damage: Math.round(unit.damage * chainPct),
                speed: 20, aoeRadius: 0, team: unit.team,
                sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
              });
              lastX = chainTarget.x; lastY = chainTarget.y;
            }
          }
        } else {
          // Melee: instant damage
          dealDamage(state, target, unit.damage, unit.damage >= 10, unit.playerId, unit.id);
          applyOnHitEffects(state, unit, target);
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
        nearestTower.hp -= unit.damage;
        addFloatingText(state, nearestTower.worldX, nearestTower.worldY, `-${unit.damage}`, '#ff6600');
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
      const hq = getHQPosition(enemyTeam);
      const hqCx = hq.x + HQ_WIDTH / 2;
      const hqCy = hq.y + HQ_HEIGHT / 2;
      const hqRadius = Math.max(HQ_WIDTH, HQ_HEIGHT) * 0.5;
      const distToHq = Math.sqrt((unit.x - hqCx) ** 2 + (unit.y - hqCy) ** 2);
      if (distToHq <= unit.range + hqRadius) {
        state.hqHp[enemyTeam] -= unit.damage;
        addFloatingText(state, hqCx, hqCy, `-${unit.damage} HQ`, '#ff0000');
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
      addFloatingText(state, u.x, u.y, 'REVIVE', '#44ff44');
      addDeathParticles(state, u.x, u.y, '#44ff44', 3);
      continue;
    }
    addDeathParticles(state, u.x, u.y, u.team === Team.Bottom ? '#4488ff' : '#ff4444', 5);
    if (u.carryingDiamond) dropDiamond(state, u.x, u.y);
    if (state.playerStats[u.playerId]) state.playerStats[u.playerId].unitsLost++;
    if (deathSoundCount < 3) { addSound(state, 'unit_killed', u.x, u.y); deathSoundCount++; }
    // Record fallen heroes (units with kills)
    if (u.kills > 0) {
      state.fallenHeroes.push({
        name: u.type, playerId: u.playerId, category: u.category,
        kills: u.kills, survived: false, killedByName: u.lastDamagedByName || 'unknown',
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
  const HQ_COOLDOWN_TICKS = Math.round(1.2 * TICK_RATE);

  for (const team of [Team.Bottom, Team.Top]) {
    if ((state.tick + team * Math.floor(HQ_COOLDOWN_TICKS / 2)) % HQ_COOLDOWN_TICKS !== 0) continue;
    const enemyTeam = team === Team.Bottom ? Team.Top : Team.Bottom;
    const hq = getHQPosition(team);
    const hx = hq.x + HQ_WIDTH / 2;
    const hy = hq.y + HQ_HEIGHT / 2;

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
      dealDamage(state, closest, HQ_DAMAGE, true);
      addDeathParticles(state, closest.x, closest.y, '#ffdd88', 2);
      continue;
    }

    // If no enemy units are nearby, HQ can still defend against harvesters.
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
      if (closestHarv.carryingDiamond) dropDiamond(state, closestHarv.x, closestHarv.y);
      killHarvester(closestHarv);
    }
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
        team: player.team,
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
        if (closestHarv.carryingDiamond) dropDiamond(state, closestHarv.x, closestHarv.y);
        killHarvester(closestHarv);
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
      // Hit! Apply damage through shield
      dealDamage(state, target, p.damage, true, p.sourcePlayerId, p.sourceUnitId);
      addDeathParticles(state, target.x, target.y, '#ffaa00', 2);

      // Apply status effects based on source player's race + upgrade extras
      const sourcePlayer = state.players[p.sourcePlayerId];
      if (sourcePlayer) {
        const race = sourcePlayer.race;
        const extraSlow = p.extraSlowStacks ?? 0;
        const extraBurn = p.extraBurnStacks ?? 0;
        if (race === Race.Deep || race === Race.Tenders || race === Race.Goblins) applyStatus(target, StatusType.Slow, (p.aoeRadius > 0 ? 2 : 1) + extraSlow);
        if (race === Race.Demon || race === Race.Geists || race === Race.Wild) applyStatus(target, StatusType.Burn, (p.aoeRadius > 0 ? 2 : 1) + extraBurn);
      }

      // AOE damage
      if (p.aoeRadius > 0) {
        for (const u of state.units) {
          if (u.id === target.id || u.team === p.team) continue;
          const ad = Math.sqrt((u.x - target.x) ** 2 + (u.y - target.y) ** 2);
          if (ad <= p.aoeRadius) {
            const aoeDmg = Math.round(p.damage * (p.splashDamagePct ?? 0.5));
            dealDamage(state, u, aoeDmg, true, p.sourcePlayerId, p.sourceUnitId);
            if (sourcePlayer) {
              const race = sourcePlayer.race;
              const extraSlow = p.extraSlowStacks ?? 0;
              const extraBurn = p.extraBurnStacks ?? 0;
              if (race === Race.Deep || race === Race.Tenders || race === Race.Goblins) applyStatus(u, StatusType.Slow, (p.aoeRadius > 0 ? 2 : 1) + extraSlow);
              if (race === Race.Demon || race === Race.Geists || race === Race.Wild) applyStatus(u, StatusType.Burn, (p.aoeRadius > 0 ? 2 : 1) + extraBurn);
              if (race === Race.Oozlings) applyStatus(u, StatusType.Slow, 1);
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
            addFloatingText(state, unit.x, unit.y - 0.3, 'SEARED', '#ff8c00');
          }
        } else {
          addDeathParticles(state, unit.x, unit.y, '#ff4400', 1);
        }
        // BLIGHT: burn 3+ stacks = no regen (shown every 3s)
        if (eff.stacks >= 3 && state.tick % (TICK_RATE * 3) === 0) {
          addFloatingText(state, unit.x, unit.y - 0.5, 'BLIGHT', '#9c27b0');
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
        dealDamage(state, nearest, stats.damage, false, building.playerId);
        if (Math.random() < 0.3) applyKnockback(nearest, 0.02);
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
      for (let i = 0; i < targets.length; i++) {
        const dmg = i === 0 ? stats.damage : Math.round(stats.damage * chainPct);
        dealDamage(state, targets[i], dmg, true, building.playerId);
        addDeathParticles(state, targets[i].x, targets[i].y, '#00e5ff', 2);
      }
      if (targets.length > 0) building.actionTimer = Math.round(stats.attackSpeed * TICK_RATE);
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
        dealDamage(state, nearest, stats.damage, false, building.playerId);
        applyStatus(nearest, StatusType.Burn, burnStacks);
        addDeathParticles(state, nearest.x, nearest.y, '#ff3d00', 2);
        building.actionTimer = Math.round(stats.attackSpeed * TICK_RATE);
      }
      break;
    }
    case Race.Deep: {
      // AoE slow: hit ALL enemies in range
      const slowStacks = 1 + (sp.extraSlowStacks ?? 0);
      let hit = false;
      for (const u of state.units) {
        if (u.team !== enemyTeam) continue;
        const d = Math.sqrt((u.x - tx) ** 2 + (u.y - ty) ** 2);
        if (d <= stats.range) {
          dealDamage(state, u, stats.damage, false, building.playerId);
          applyStatus(u, StatusType.Slow, slowStacks);
          hit = true;
        }
      }
      if (hit) building.actionTimer = Math.round(stats.attackSpeed * TICK_RATE);
      break;
    }
    case Race.Wild: {
      // AoE poison: damage ALL enemies in range + burn
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
          hit = true;
        }
      }
      if (hit) building.actionTimer = Math.round(stats.attackSpeed * TICK_RATE);
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
        dealDamage(state, nearest, stats.damage, false, building.playerId);
        applyStatus(nearest, StatusType.Burn, burnStacks);
        addDeathParticles(state, nearest.x, nearest.y, '#546e7a', 2);
        building.actionTimer = Math.round(stats.attackSpeed * TICK_RATE);
      }
      break;
    }
    case Race.Tenders: {
      // Thorns aura: damage ALL enemies in range + slow
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
          hit = true;
        }
      }
      if (hit) building.actionTimer = Math.round(stats.attackSpeed * TICK_RATE);
      break;
    }
    // Goblins: default single-target (handled in tickTowers normally via projectile)
  }
}

// === Nuke Telegraph ===

function tickNukeTelegraphs(state: GameState): void {
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
      if (h.carryingDiamond) dropDiamond(state, h.x, h.y);
      killHarvester(h);
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

  // Find an offset spot in a ring around the node
  const ringDist = 1.0 + otherMiners.length * 0.6;
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

function tickHarvesters(state: GameState, cellMap: Map<string, GoldCell>): void {
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
    clampToArenaBounds(h, 0.3);
  }

  // Remove orphaned harvesters whose huts were destroyed
  state.harvesters = state.harvesters.filter(h => {
    const hutExists = state.buildings.some(b => b.id === h.hutId);
    if (!hutExists) {
      if (h.carryingDiamond) dropDiamond(state, h.x, h.y);
      return false;
    }
    return true;
  });

  for (const h of state.harvesters) {
    if (h.state === 'dead') {
      h.respawnTimer--;
      if (h.respawnTimer <= 0) {
        const hut = state.buildings.find(b => b.id === h.hutId);
        if (hut) {
          h.x = hut.worldX; h.y = hut.worldY;
          h.hp = h.maxHp; h.state = 'walking_to_node';
          h.carryingDiamond = false; h.carryingResource = null; h.carryAmount = 0;
          h.targetCellIdx = -1; h.fightTargetId = null; h.damage = 0;
        }
      }
      continue;
    }

    const movePerTick = HARVESTER_MOVE_SPEED / TICK_RATE;

    // Flee behavior: if enemies within 5 tiles, run toward base
    let shouldFlee = false;
    for (const u of state.units) {
      if (u.team === h.team || u.hp <= 0) continue;
      const dx = u.x - h.x, dy = u.y - h.y;
      if (dx * dx + dy * dy <= 25) { shouldFlee = true; break; }
    }
    if (shouldFlee) {
      const hq = getHQPosition(h.team);
      const tx = hq.x + HQ_WIDTH / 2, ty = hq.y + HQ_HEIGHT / 2;
      const dx = tx - h.x, dy = ty - h.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 1) {
        // Flee at 1.5x speed
        const fleeSpeed = movePerTick * 1.5;
        moveWithSlide(h, tx, ty, fleeSpeed, state.diamondCells);
      }
      // Interrupt mining
      if (h.state === 'mining') {
        h.state = 'walking_to_node';
        h.targetCellIdx = -1;
      }
      clampToArenaBounds(h, 0.3);
      continue;
    }

    if (h.assignment === HarvesterAssignment.Center) {
      tickCenterHarvester(state, h, movePerTick, cellMap);
      clampToArenaBounds(h, 0.3);
      continue;
    }

    if (h.state === 'walking_to_node') {
      const baseTarget = getResourceNodePosition(h);
      const target = findOpenMiningSpot(state, h, baseTarget);
      const dx = target.x - h.x, dy = target.y - h.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) {
        h.state = 'mining';
        h.miningTimer = MINE_TIME_BASE_TICKS;
      } else {
        moveWithSlide(h, target.x, target.y, movePerTick, state.diamondCells);
      }
    } else if (h.state === 'mining') {
      h.miningTimer--;
      if (h.miningTimer <= 0) {
        switch (h.assignment) {
          case HarvesterAssignment.BaseGold:
            h.carryingResource = ResourceType.Gold; h.carryAmount = 5; break;
          case HarvesterAssignment.Wood:
            h.carryingResource = ResourceType.Wood; h.carryAmount = 10; break;
          case HarvesterAssignment.Stone:
            h.carryingResource = ResourceType.Stone; h.carryAmount = 10; break;
        }
        h.state = 'walking_home';
      }
    } else if (h.state === 'walking_home') {
      walkHome(state, h, movePerTick);
    }

    clampToArenaBounds(h, 0.3);
  }
}

function tickCenterHarvester(state: GameState, h: HarvesterState, movePerTick: number, cellMap: Map<string, GoldCell>): void {
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
          dropDiamond(state, enemyCarrier.x, enemyCarrier.y);
          killHarvester(enemyCarrier);
        }
      }
    } else {
      h.state = 'walking_to_node';
      moveWithSlide(h, enemyCarrier.x, enemyCarrier.y, movePerTick);
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
      moveWithSlide(h, targetX, targetY, movePerTick);
    }
    return;
  }

  if (h.state === 'mining' && h.targetCellIdx >= 0) {
    const cell = state.diamondCells[h.targetCellIdx];
    if (cell && cell.gold > 0) {
      h.miningTimer--;
      if (h.miningTimer <= 0) {
        const mined = Math.min(GOLD_PER_CELL, cell.gold);
        cell.gold -= mined;
        h.carryingResource = ResourceType.Gold;
        h.carryAmount = mined;
        h.targetCellIdx = -1;
        h.state = 'walking_home';
      }
      return;
    } else {
      h.targetCellIdx = -1;
      h.state = 'walking_to_node';
    }
  }

  const cellIdx = findBestCellToMine(state.diamondCells, cellMap, h.x, h.y);
  if (cellIdx < 0) {
    h.state = 'walking_to_node';
    return;
  }

  const cell = state.diamondCells[cellIdx];
  const dx = cell.tileX - h.x, dy = cell.tileY - h.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 1.5) {
    h.state = 'mining';
    h.targetCellIdx = cellIdx;
    h.miningTimer = MINE_TIME_BASE_TICKS;
  } else {
    h.state = 'walking_to_node';
    moveWithSlide(h, cell.tileX, cell.tileY, movePerTick);
  }
}

function walkHome(state: GameState, h: HarvesterState, movePerTick: number): void {
  const hq = getHQPosition(h.team);
  const tx = hq.x + HQ_WIDTH / 2, ty = hq.y + HQ_HEIGHT / 2;
  const dx = tx - h.x, dy = ty - h.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 2) {
    const player = state.players[h.playerId];
    if (h.carryingDiamond) {
      state.winner = h.team;
      state.winCondition = 'diamond';
      state.matchPhase = 'ended';
      return;
    }
    const ps = state.playerStats[h.playerId];
    if (h.carryingResource === ResourceType.Gold) {
      player.gold += h.carryAmount;
      if (ps) ps.totalGoldEarned += h.carryAmount;
      addFloatingText(state, h.x, h.y, `+${h.carryAmount}g`, '#ffd700');
    } else if (h.carryingResource === ResourceType.Wood) {
      player.wood += h.carryAmount;
      if (ps) ps.totalWoodEarned += h.carryAmount;
      addFloatingText(state, h.x, h.y, `+${h.carryAmount}w`, '#4caf50');
    } else if (h.carryingResource === ResourceType.Stone) {
      player.stone += h.carryAmount;
      if (ps) ps.totalStoneEarned += h.carryAmount;
      addFloatingText(state, h.x, h.y, `+${h.carryAmount}s`, '#9e9e9e');
    }
    h.carryingResource = null;
    h.carryAmount = 0;
    h.state = 'walking_to_node';
  } else {
    moveWithSlide(h, tx, ty, movePerTick, state.diamondCells);
  }
}

function getResourceNodePosition(h: HarvesterState): { x: number; y: number } {
  switch (h.assignment) {
    case HarvesterAssignment.BaseGold: {
      const hq = getHQPosition(h.team);
      return { x: hq.x + HQ_WIDTH / 2, y: h.team === Team.Bottom ? hq.y - 6 : hq.y + HQ_HEIGHT + 6 };
    }
    case HarvesterAssignment.Wood:
      return { x: WOOD_NODE_X, y: DIAMOND_CENTER_Y };
    case HarvesterAssignment.Stone:
      return { x: STONE_NODE_X, y: DIAMOND_CENTER_Y };
    case HarvesterAssignment.Center:
      return { x: DIAMOND_CENTER_X, y: DIAMOND_CENTER_Y };
  }
}

function computeWarHeroes(state: GameState): void {
  // Combine surviving units and fallen heroes, pick the top killer per player
  const candidates: WarHero[] = [...state.fallenHeroes];
  // Add surviving units
  for (const u of state.units) {
    if (u.kills > 0) {
      candidates.push({
        name: u.type, playerId: u.playerId, category: u.category,
        kills: u.kills, survived: true, killedByName: null,
      });
    }
  }
  // Pick overall best (most kills)
  candidates.sort((a, b) => b.kills - a.kills);
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
  if (state.hqHp[Team.Bottom] <= 0) {
    state.winner = Team.Top; state.winCondition = 'military'; state.matchPhase = 'ended';
    addSound(state, humanTeam === Team.Top ? 'match_end_win' : 'match_end_lose');
  } else if (state.hqHp[Team.Top] <= 0) {
    state.winner = Team.Bottom; state.winCondition = 'military'; state.matchPhase = 'ended';
    addSound(state, humanTeam === Team.Bottom ? 'match_end_win' : 'match_end_lose');
  }
}
