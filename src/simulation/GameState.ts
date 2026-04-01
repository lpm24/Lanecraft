/**
 * Simulation orchestrator — state creation, tick loop, and command processing.
 *
 * Coordinates all sub-systems each tick: spawners, movement, combat, abilities,
 * harvesters, towers, projectiles, and win conditions. All player actions flow
 * through processCommand() → GameCommand dispatch.
 *
 * Sub-system tick functions live in their own modules:
 *   SimMovement  — spawning, pathing, collision, damage/status helpers
 *   SimCombat    — melee/ranged combat, towers, projectiles, status effects
 *   SimAbilities — race abilities, nukes, diamond/wood, death tracking
 *   SimHarvesters— harvester AI, mining, resource delivery
 *   SimLayout    — grid origins, HQ positions, lane paths
 *   SimShared    — shared state (spatial grids, caches) and common helpers
 */
import {
  GameState, PlayerState, DiamondState, Team, Race, Lane, MapDef, createPlayerStats,
  MAP_WIDTH, MAP_HEIGHT, HQ_HP, HQ_WIDTH, HQ_HEIGHT,
  TICK_RATE,
  GameCommand, BuildingType, BuildingState, ResourceType, isAbilityBuilding,
  HarvesterAssignment, WarHero, StatusType,
  createSeededRng, createResearchUpgradeState,
} from './types';
import { DUEL_MAP } from './maps';
import {
  SPAWN_INTERVAL_TICKS, getBuildingCost,
  getUpgradeNodeDef,
  HUT_COST_SCALE, TOWER_COST_SCALE,
  getAllResearchUpgrades, getResearchUpgradeCost,
} from './data';
import {
  genId, canAffordCost, deductCost, addSound, addFloatingText,
  compactInPlace,
  getUnitUpgradeMultipliers, getSmartHarvesterAssignment,
  isValidUpgradeChoice, getUpgradeCost,
  generateDiamondCells, isDiamondExposed,
  PASSIVE_INCOME, INITIAL_RESOURCES, MATCH_TIMEOUT_TICKS, SELL_COOLDOWN_TICKS,
  _combatGrid, _unitById,
  _buildingVisCache, _buildingVisCacheCount, _buildingVisCacheTeams,
  set_diamondCellMapInt, set_buildingVisCache, set_buildingVisCacheCount, set_buildingVisCacheTeams,
  resetSoundThrottles,
} from './SimShared';
import {
  getBuildGridOrigin, getHutGridOrigin, getTeamAlleyOrigin, getHQPosition,
  gridSlotToWorld, isAlleyCellExcludedByGoldMine,
  getLanePath, buildDiamondCellMap,
} from './SimLayout';
import {
  tickSpawners, tickUnitMovement, tickUnitDiamondPickup,
  tickPotionPickups, tickUnitCollision,
  clampToArenaBounds,
} from './SimMovement';
import {
  tickCombat, tickHQDefense, tickTowers, tickProjectiles,
  tickEffects, tickStatusEffects,
} from './SimCombat';
import {
  useAbility, tickAbilityEffects, tickNukeTelegraphs,
  fireNuke, addPing, addQuickChat, concedeMatch,
  spillCarriedWood,
} from './SimAbilities';
import { tickHarvesters } from './SimHarvesters';

// === State Creation ===

export function createInitialState(
  players: { race: Race; isBot: boolean; isEmpty?: boolean }[],
  seed?: number,
  mapDef?: MapDef,
  fogOfWar = false,
): GameState {
  _debugPrevPositions.clear(); // prevent stale ID collisions from previous games
  set_buildingVisCache(null); // reset building visibility cache for new game
  const map = mapDef ?? DUEL_MAP;
  const rngSeed = seed ?? (Date.now() ^ (Math.random() * 0xffffffff));
  const rng = createSeededRng(rngSeed);
  const playerStates: PlayerState[] = players.map((p, i) => ({
    id: i,
    team: (map.playerSlots[i]?.teamIndex ?? (i < 2 ? 0 : 1)) as Team,
    race: p.race,
    gold: p.isEmpty ? 0 : INITIAL_RESOURCES[p.race].gold,
    wood: p.isEmpty ? 0 : INITIAL_RESOURCES[p.race].wood,
    meat: p.isEmpty ? 0 : INITIAL_RESOURCES[p.race].meat,
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
    trollKills: 0,
    statBonus: 1.0,
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
    tankHeroes: [],
    healerHeroes: [],
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
  // Reset per-tick status/resource/combat sound throttle counters
  resetSoundThrottles();
  for (const cmd of commands) processCommand(state, cmd);

  if (state.matchPhase === 'prematch') {
    state.prematchTimer--;
    if (state.prematchTimer <= 0) {
      state.matchPhase = 'playing';
      addSound(state, 'match_start');
    }
    tickEffects(state);
    // Update fog of war during prematch so buildings placed in the build phase reveal the map
    if (state.fogOfWar && state.tick % 3 === 0) {
      updateVisibility(state);
    }
    state.tick++;
    return;
  }
  if (state.matchPhase === 'ended') {
    // Compute war heroes once on first ended tick
    if (state.warHeroes.length === 0) computeWarHeroes(state);
    // Clean up any units that died on the tick the match ended
    // (projectiles/burn DoT can kill after tickCombat's filter ran)
    compactInPlace(state.units, u => u.hp > 0);
    tickEffects(state);
    state.tick++;
    return;
  }

  if (state.tick % TICK_RATE === 0) {
    for (const p of state.players) {
      if (p.isEmpty) continue;
      const inc = PASSIVE_INCOME[p.race];
      const ps = state.playerStats[p.id];
      if (inc.gold > 0) {
        const whole = Math.floor(inc.gold);
        if (whole > 0) { p.gold += whole; if (ps) ps.totalGoldEarned += whole; }
        const frac = inc.gold - whole;
        if (frac > 0) { p.goldFrac = (p.goldFrac ?? 0) + frac; if (p.goldFrac >= 1) { p.goldFrac -= 1; p.gold += 1; if (ps) ps.totalGoldEarned += 1; } }
      }
      if (inc.wood > 0) {
        const whole = Math.floor(inc.wood);
        if (whole > 0) { p.wood += whole; if (ps) ps.totalWoodEarned += whole; }
        const frac = inc.wood - whole;
        if (frac > 0) { p.woodFrac = (p.woodFrac ?? 0) + frac; if (p.woodFrac >= 1) { p.woodFrac -= 1; p.wood += 1; if (ps) ps.totalWoodEarned += 1; } }
      }
      if (inc.meat > 0) {
        const whole = Math.floor(inc.meat);
        if (whole > 0) { p.meat += whole; if (ps) ps.totalMeatEarned += whole; }
        const frac = inc.meat - whole;
        if (frac > 0) { p.meatFrac = (p.meatFrac ?? 0) + frac; if (p.meatFrac >= 1) { p.meatFrac -= 1; p.meat += 1; if (ps) ps.totalMeatEarned += 1; } }
      }
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

  // Build spatial grid and unit-by-ID map early — reused by tickAbilityEffects, tickCombat, dealDamage, etc.
  _combatGrid.build(state.units);
  _unitById.clear();
  for (const u of state.units) _unitById.set(u.id, u);

  // Tick race ability cooldowns and active effects
  tickAbilityEffects(state);

  // Build diamond cell map once per tick (reused by harvesters, exposure check, and isBlocked)
  const diamondCellMap = buildDiamondCellMap(state.diamondCells);
  set_diamondCellMapInt(diamondCellMap);

  // Update diamond exposed state (check every second, not every tick — BFS is expensive)
  if (state.diamond.state === 'hidden' && state.tick % TICK_RATE === 0) {
    if (isDiamondExposed(diamondCellMap, state)) {
      state.diamond.exposed = true;
      state.diamond.state = 'exposed';
      addSound(state, 'diamond_exposed', state.diamond.x, state.diamond.y);
    }
  }

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
  // Rebuild spatial grid and unit map after tickCombat's dead-unit filter so tickTowers/tickHQDefense/tickProjectiles
  // don't find stale dead-unit references
  _combatGrid.build(state.units);
  _unitById.clear();
  for (const u of state.units) _unitById.set(u.id, u);
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
      const u = _unitById.get(state.diamond.carrierId);
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

  // Update fog of war visibility every 3 ticks (150ms) — unit vision doesn't need per-tick precision
  // and revealCircle per unit is expensive with 200+ units on large maps
  if (state.fogOfWar && state.tick % 3 === 0) {
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
    const newCache: boolean[][] = [];
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
      newCache.push(bvis);
    }
    set_buildingVisCache(newCache);
    set_buildingVisCacheCount(bCount);
    set_buildingVisCacheTeams(teamCount);
  }

  for (let t = 0; t < teamCount; t++) {
    const vis = state.visibility[t];
    // Start from cached building visibility
    const bvis = _buildingVisCache![t];
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
  let cost = getUpgradeCost(building.upgradePath, player.race, building.type, cmd.choice);
  if (!cost) return;
  // Tenders Ironwood: tower upgrade costs reduced by 50%
  if (building.type === BuildingType.Tower && player.race === Race.Tenders
    && player.researchUpgrades.raceUpgrades['tenders_ability_4']) {
    cost = { gold: Math.floor(cost.gold * 0.5), wood: Math.floor(cost.wood * 0.5), meat: Math.floor(cost.meat * 0.5) };
  }
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
  addSound(state, 'upgrade_complete', building.worldX, building.worldY, { race: player.race, buildingType: building.type });
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

    // Retroactively apply one-shot upgrades that buff existing units
    const id = cmd.upgradeId;
    // HP bonuses for existing melee units
    const hpMults: Record<string, number> = {
      'crown_melee_2': 1.15, 'horde_melee_2': 1.25, 'deep_melee_1': 1.15,
    };
    if (hpMults[id]) {
      const mult = hpMults[id];
      for (const u of state.units) {
        if (u.playerId === cmd.playerId && u.category === 'melee') {
          const newMax = Math.max(1, Math.round(u.maxHp * mult));
          u.hp = Math.max(1, Math.round(u.hp * mult));
          u.maxHp = newMax;
          if (u.hp > u.maxHp) u.hp = u.maxHp;
        }
      }
    }
    // Move speed bonus for existing melee units
    if (id === 'goblins_melee_2') {
      for (const u of state.units) {
        if (u.playerId === cmd.playerId && u.category === 'melee') {
          u.moveSpeed *= 1.35;
        }
      }
    }
  } else {
    // Determine affected category for retroactive atk buff
    let atkCategory: 'melee' | 'ranged' | 'caster' | null = null;
    if (cmd.upgradeId === 'melee_atk') { bu.meleeAtkLevel++; atkCategory = 'melee'; }
    else if (cmd.upgradeId === 'melee_def') bu.meleeDefLevel++;
    else if (cmd.upgradeId === 'ranged_atk') { bu.rangedAtkLevel++; atkCategory = 'ranged'; }
    else if (cmd.upgradeId === 'ranged_def') bu.rangedDefLevel++;
    else if (cmd.upgradeId === 'caster_atk') { bu.casterAtkLevel++; atkCategory = 'caster'; }
    else if (cmd.upgradeId === 'caster_def') bu.casterDefLevel++;

    // Retroactively boost existing units' damage (each atk level = 1.25x)
    if (atkCategory) {
      for (const u of state.units) {
        if (u.playerId === cmd.playerId && u.category === atkCategory) {
          u.damage = Math.max(1, Math.round(u.damage * 1.25));
        }
      }
    }
  }

  addFloatingText(state, research.worldX + 0.5, research.worldY, def.name, '#90caf9');
  addSound(state, 'upgrade_complete', research.worldX, research.worldY, { race: player.race });
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
    const myTowers = state.buildings.filter(b => b.playerId === cmd.playerId && b.type === BuildingType.Tower && !isAbilityBuilding(b)).length;
    const mult = Math.pow(TOWER_COST_SCALE, Math.max(0, myTowers - 1));
    effectiveCost = {
      gold: Math.floor(cost.gold * mult),
      wood: Math.floor(cost.wood * mult),
      meat: Math.floor(cost.meat * mult),
      hp: cost.hp,
    };
  }

  if (!isFirstTower) {
    if (player.gold < effectiveCost.gold || player.wood < effectiveCost.wood || player.meat < effectiveCost.meat) return;
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
    // Block building in gold mine exclusion zone
    if (isAlleyCellExcludedByGoldMine(cmd.gridX, cmd.gridY, playerTeam, state.mapDef)) return;
    if (state.buildings.some(b => b.buildGrid === 'alley' &&
        (state.players[b.playerId]?.team ?? (b.playerId < 2 ? Team.Bottom : Team.Top)) === playerTeam &&
        b.gridX === cmd.gridX && b.gridY === cmd.gridY)) return;
    const origin = getTeamAlleyOrigin(playerTeam, state.mapDef);
    const world = { x: origin.x + cmd.gridX, y: origin.y + cmd.gridY };
    if (!isFirstTower) { player.gold -= effectiveCost.gold; player.wood -= effectiveCost.wood; player.meat -= effectiveCost.meat; }
    state.buildings.push({
      id: genId(state), type: cmd.buildingType, playerId: cmd.playerId, buildGrid: 'alley',
      gridX: cmd.gridX, gridY: cmd.gridY, worldX: world.x, worldY: world.y,
      lane: isLeft ? Lane.Left : Lane.Right,
      hp: cost.hp, maxHp: cost.hp, actionTimer: 0, placedTick: state.tick, upgradePath: ['A'],
    });
    addSound(state, 'building_placed', world.x, world.y, { race: player.race, buildingType: cmd.buildingType });
    if (isFirstTower) player.hasBuiltTower = true;
  } else {
    // Military grid — towers not allowed here (must use tower alley)
    if (cmd.buildingType === BuildingType.Tower) return;
    if (cmd.gridX < 0 || cmd.gridX >= state.mapDef.buildGridCols || cmd.gridY < 0 || cmd.gridY >= state.mapDef.buildGridRows) return;
    if (state.buildings.some(b => b.buildGrid === 'military' && b.playerId === cmd.playerId && b.gridX === cmd.gridX && b.gridY === cmd.gridY)) return;
    player.gold -= cost.gold; player.wood -= cost.wood; player.meat -= cost.meat;
    const world = gridSlotToWorld(cmd.playerId, cmd.gridX, cmd.gridY, state.mapDef, state.players);
    state.buildings.push({
      id: genId(state), type: cmd.buildingType, playerId: cmd.playerId, buildGrid: 'military',
      gridX: cmd.gridX, gridY: cmd.gridY, worldX: world.x, worldY: world.y,
      lane: isLeft ? Lane.Left : Lane.Right,
      hp: cost.hp, maxHp: cost.hp, actionTimer: SPAWN_INTERVAL_TICKS, placedTick: state.tick, upgradePath: ['A'],
    });
    addSound(state, 'building_placed', world.x, world.y, { race: player.race, buildingType: cmd.buildingType });
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
  let totalGold = cost.gold, totalWood = cost.wood, totalMeat = cost.meat, totalEssence = 0, totalSouls = 0;
  if (building.upgradePath.length >= 2) {
    const t1Cost = getUpgradeCost(['A'], player.race, building.type, building.upgradePath[1]);
    if (t1Cost) { totalGold += t1Cost.gold; totalWood += t1Cost.wood; totalMeat += t1Cost.meat; totalEssence += t1Cost.deathEssence ?? 0; totalSouls += t1Cost.souls ?? 0; }
  }
  if (building.upgradePath.length >= 3) {
    const t2Cost = getUpgradeCost(['A', building.upgradePath[1]], player.race, building.type, building.upgradePath[2]);
    if (t2Cost) { totalGold += t2Cost.gold; totalWood += t2Cost.wood; totalMeat += t2Cost.meat; totalEssence += t2Cost.deathEssence ?? 0; totalSouls += t2Cost.souls ?? 0; }
  }

  // Refund 50% of total invested resources (towers prorated by current health)
  const sellRate = building.type === BuildingType.Tower
    ? 0.5 * (building.hp / building.maxHp)
    : 0.5;
  const refundGold = Math.floor(totalGold * sellRate);
  const refundWood = Math.floor(totalWood * sellRate);
  const refundMeat = Math.floor(totalMeat * sellRate);
  player.gold += refundGold;
  player.wood += refundWood;
  player.meat += refundMeat;
  if (totalEssence > 0) player.deathEssence += Math.floor(totalEssence * sellRate);
  if (totalSouls > 0) player.souls += Math.floor(totalSouls * sellRate);

  // If it's a hut, remove the associated harvester
  if (building.type === BuildingType.HarvesterHut) {
    const hIdx = state.harvesters.findIndex(h => h.hutId === building.id);
    if (hIdx !== -1) state.harvesters.splice(hIdx, 1);
  }

  // Show refund floating texts for each resource returned
  const bx = building.worldX, by = building.worldY;
  if (refundGold > 0) addFloatingText(state, bx, by, `+${refundGold}`, '#ffd700', 'gold');
  if (refundWood > 0) addFloatingText(state, bx, by - 0.5, `+${refundWood}`, '#8B4513', 'wood');
  if (refundMeat > 0) addFloatingText(state, bx, by - 1.0, `+${refundMeat}`, '#aaaaaa', 'meat');
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
  const meatCost = Math.floor(hutRes.meat * mult);
  if (player.gold < goldCost || player.wood < woodCost || player.meat < meatCost) return;

  const origin = getHutGridOrigin(cmd.playerId, state.mapDef, state.players);
  const hCols = state.mapDef.hutGridCols;
  const totalSlots = hCols * state.mapDef.hutGridRows;
  const occupiedHuts = new Set(myHuts.map(b => b.gridX));

  // If a specific slot was requested, try that; otherwise fill center-out (bots)
  let targetSlot: number | undefined;
  if (cmd.hutSlot != null && cmd.hutSlot >= 0 && cmd.hutSlot < totalSlots && !occupiedHuts.has(cmd.hutSlot)) {
    targetSlot = cmd.hutSlot;
  } else if (cmd.hutSlot == null) {
    // Fill from center outward (slot is linear index across cols then rows)
    const CENTER_OUT: number[] = [];
    for (let d = 0; d <= Math.floor(totalSlots / 2); d++) {
      const mid = Math.floor(totalSlots / 2);
      if (mid + d < totalSlots) CENTER_OUT.push(mid + d);
      if (d > 0 && mid - d >= 0) CENTER_OUT.push(mid - d);
    }
    targetSlot = CENTER_OUT.find(s => !occupiedHuts.has(s));
  }
  if (targetSlot == null) return;
  player.gold -= goldCost;
  player.wood -= woodCost;
  player.meat -= meatCost;
  const slot = targetSlot;
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
  addSound(state, 'building_placed', world.x, world.y, { race: player.race, buildingType: BuildingType.HarvesterHut });
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

// === War Heroes ===

function computeWarHeroes(state: GameState): void {
  // Combine surviving units and fallen heroes into a single candidate pool
  const candidates: WarHero[] = [...state.fallenHeroes];
  for (const u of state.units) {
    if (u.kills > 0 || u.healingDone > 0 || u.buffsApplied > 0 || u.damageTaken > 50) {
      const heroRace = state.players[u.playerId].race;
      const heroBldg = `${u.category}_spawner` as BuildingType;
      candidates.push({
        name: getUpgradeNodeDef(heroRace, heroBldg, u.upgradeNode)?.name ?? u.type,
        playerId: u.playerId, race: heroRace,
        category: u.category, upgradeNode: u.upgradeNode,
        kills: u.kills, damageDone: u.damageDone, damageTaken: u.damageTaken,
        healingDone: u.healingDone, buffsApplied: u.buffsApplied,
        survived: true, killedByName: null,
        spawnTick: u.spawnTick, deathTick: null,
      });
    }
  }

  // Helper: pick top candidate overall + best per player
  const pickHeroes = (
    pool: WarHero[],
    target: WarHero[],
  ) => {
    if (pool.length > 0) target.push(pool[0]);
    const seen = new Set<number>();
    if (target.length > 0) seen.add(target[0].playerId);
    for (const c of pool) {
      if (!seen.has(c.playerId)) { target.push(c); seen.add(c.playerId); }
    }
  };

  // --- War Hero: top killer overall + best per player ---
  const killCandidates = candidates.filter(c => c.kills > 0);
  killCandidates.sort((a, b) => b.kills - a.kills || a.playerId - b.playerId || a.spawnTick - b.spawnTick);
  pickHeroes(killCandidates, state.warHeroes);

  // --- Support Hero: top buff/debuff unit (buffsApplied only) overall + best per player ---
  const supportCandidates = candidates.filter(c => c.buffsApplied > 0);
  supportCandidates.sort((a, b) => b.buffsApplied - a.buffsApplied || a.playerId - b.playerId || a.spawnTick - b.spawnTick);
  pickHeroes(supportCandidates, state.supportHeroes);

  // --- Tank Hero: most damage taken overall + best per player ---
  const tankCandidates = candidates.filter(c => c.damageTaken > 0);
  tankCandidates.sort((a, b) => b.damageTaken - a.damageTaken || a.playerId - b.playerId || a.spawnTick - b.spawnTick);
  pickHeroes(tankCandidates, state.tankHeroes);

  // --- Healer Hero: most healing done overall + best per player ---
  const healCandidates = candidates.filter(c => c.healingDone > 0);
  healCandidates.sort((a, b) => b.healingDone - a.healingDone || a.playerId - b.playerId || a.spawnTick - b.spawnTick);
  pickHeroes(healCandidates, state.healerHeroes);
}

// === Win Conditions ===

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
  const mixBool = (v: boolean | undefined) => mix(v ? 1 : 0);
  const mixStatusType = (type: StatusType) => {
    switch (type) {
      case StatusType.Slow: mix(1); break;
      case StatusType.Burn: mix(2); break;
      case StatusType.Haste: mix(3); break;
      case StatusType.Shield: mix(4); break;
      case StatusType.Frenzy: mix(5); break;
      case StatusType.Wound: mix(6); break;
      case StatusType.Vulnerable: mix(7); break;
      default: mix(0); break;
    }
  };
  const mixResourceType = (type: ResourceType | null) => {
    switch (type) {
      case ResourceType.Gold: mix(1); break;
      case ResourceType.Wood: mix(2); break;
      case ResourceType.Meat: mix(3); break;
      default: mix(0); break;
    }
  };

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
    mix(p.meat * 100 | 0);
  }

  // Hash all units — FNV-1a is fast enough even with hundreds of units
  for (let i = 0; i < state.units.length; i++) {
    const u = state.units[i];
    mix(u.id);
    mix(u.hp * 100 | 0);
    mix(u.x * 100 | 0);
    mix(u.y * 100 | 0);
    mix(u.damage);
    mix(u.lane === Lane.Left ? 0 : 1);
    mix(u.statusEffects.length);
    mix(u.targetId ?? -1);
    mixBool(u.carryingDiamond);
    for (let j = 0; j < u.statusEffects.length; j++) {
      const eff = u.statusEffects[j];
      mixStatusType(eff.type);
      mix(eff.stacks);
      mix(eff.duration);
    }
  }

  // Hash building state
  for (let i = 0; i < state.buildings.length; i++) {
    const b = state.buildings[i];
    mix(b.id);
    mix(b.hp * 100 | 0);
    mix(b.upgradePath.length);
  }

  // Hash projectiles — detect divergence in ranged combat
  for (let i = 0; i < state.projectiles.length; i++) {
    const p = state.projectiles[i];
    mix(p.id);
    mix(p.x * 100 | 0);
    mix(p.y * 100 | 0);
    mix(p.targetId);
    mix(p.damage);
    mix(p.aoeRadius * 100 | 0);
    mix(p.sourcePlayerId);
    mix(p.sourceUnitId ?? -1);
    mix((p.targetX ?? -1) * 100 | 0);
    mix((p.targetY ?? -1) * 100 | 0);
  }

  // Hash harvester positions
  for (let i = 0; i < state.harvesters.length; i++) {
    const hv = state.harvesters[i];
    mix(hv.id);
    mix(hv.x * 100 | 0);
    mix(hv.y * 100 | 0);
    mixBool(hv.carryingDiamond);
    mixResourceType(hv.carryingResource);
    mix(hv.carryAmount);
    mix(hv.targetCellIdx);
  }

  return h >>> 0; // unsigned 32-bit
}

// Re-exports for backward compatibility — external files import these from GameState
export { getBuildGridOrigin, getHutGridOrigin, getTeamAlleyOrigin, getHQPosition, gridSlotToWorld, getBaseGoldPosition } from './SimLayout';
export { PASSIVE_INCOME, getUnitUpgradeMultipliers, getResearchMultipliers, type UpgradeResult } from './SimShared';
export { SEED_GROW_TIMES } from './SimAbilities';
