// === Core Constants ===

export const TILE_SIZE = 16; // pixels per tile for rendering
export const MAP_WIDTH = 80;
export const MAP_HEIGHT = 120;
export const TICK_RATE = 20; // ticks per second
export const TICK_MS = 1000 / TICK_RATE;

// Build grid: wide horizontal strip (14 wide x 3 tall per player)
export const BUILD_GRID_COLS = 14;
export const BUILD_GRID_ROWS = 3;

// Hut grid: 10 wide x 1 tall, per player, at the edge of their base zone
export const HUT_GRID_COLS = 10;
export const HUT_GRID_ROWS = 1;

// Shared tower alley: 10 wide x 3 tall, one per team, straddling the neck path
export const SHARED_ALLEY_COLS = 20;
export const SHARED_ALLEY_ROWS = 12;

// Map zone boundaries (row indices)
// Y=0 is TOP of map, Y=MAP_HEIGHT is BOTTOM
export const ZONES = {
  TOP_BASE: { start: 0, end: 16 },
  TOP_TERRITORY: { start: 16, end: 35 },
  MID: { start: 35, end: 85 },
  BOTTOM_TERRITORY: { start: 85, end: 104 },
  BOTTOM_BASE: { start: 104, end: 120 },
} as const;

// Peanut/hourglass-shaped map: wide bases, narrow necks, widest at diamond center.
// The shape bulges outward at diamond level creating left/right tips for wood/meat.
export const SHAPE_BASE_WIDTH = 64;        // playable width at base zones
export const SHAPE_NECK_WIDTH = 34;        // narrowed ~10% to tighten mid/neck walkable area
export const SHAPE_CENTER_WIDTH = 67;      // narrowed ~10%; keeps base/player spaces unchanged
// Y-coordinates of key shape control points
export const SHAPE_NECK_TOP_Y = 25;        // top neck narrowest row
export const SHAPE_NECK_BOTTOM_Y = 95;     // bottom neck narrowest row

// Returns the playable half-margin (void tiles on each side) at a given row y
export function getMarginAtRow(y: number): number {
  // Base zones: SHAPE_BASE_WIDTH wide
  if (y <= ZONES.TOP_BASE.end) {
    return (MAP_WIDTH - SHAPE_BASE_WIDTH) / 2;
  }
  if (y >= ZONES.BOTTOM_BASE.start) {
    return (MAP_WIDTH - SHAPE_BASE_WIDTH) / 2;
  }
  // Top neck transition: from base width at TOP_BASE.end to neck width at SHAPE_NECK_TOP_Y
  if (y <= SHAPE_NECK_TOP_Y) {
    const t = (y - ZONES.TOP_BASE.end) / (SHAPE_NECK_TOP_Y - ZONES.TOP_BASE.end);
    const w = SHAPE_BASE_WIDTH + (SHAPE_NECK_WIDTH - SHAPE_BASE_WIDTH) * t;
    return (MAP_WIDTH - w) / 2;
  }
  // Top neck to center: from neck width at SHAPE_NECK_TOP_Y to center width at DIAMOND_CENTER_Y
  if (y <= DIAMOND_CENTER_Y) {
    const t = (y - SHAPE_NECK_TOP_Y) / (DIAMOND_CENTER_Y - SHAPE_NECK_TOP_Y);
    const w = SHAPE_NECK_WIDTH + (SHAPE_CENTER_WIDTH - SHAPE_NECK_WIDTH) * t;
    return (MAP_WIDTH - w) / 2;
  }
  // Center to bottom neck: from center width at DIAMOND_CENTER_Y to neck width at SHAPE_NECK_BOTTOM_Y
  if (y <= SHAPE_NECK_BOTTOM_Y) {
    const t = (y - DIAMOND_CENTER_Y) / (SHAPE_NECK_BOTTOM_Y - DIAMOND_CENTER_Y);
    const w = SHAPE_CENTER_WIDTH + (SHAPE_NECK_WIDTH - SHAPE_CENTER_WIDTH) * t;
    return (MAP_WIDTH - w) / 2;
  }
  // Bottom neck to base: from neck width at SHAPE_NECK_BOTTOM_Y to base width at BOTTOM_BASE.start
  const t = (y - SHAPE_NECK_BOTTOM_Y) / (ZONES.BOTTOM_BASE.start - SHAPE_NECK_BOTTOM_Y);
  const w = SHAPE_NECK_WIDTH + (SHAPE_BASE_WIDTH - SHAPE_NECK_WIDTH) * t;
  return (MAP_WIDTH - w) / 2;
}

// Convenience: legacy constants for code that still references them
export const CROSS_BASE_WIDTH = SHAPE_BASE_WIDTH;
export const CROSS_BASE_MARGIN = (MAP_WIDTH - SHAPE_BASE_WIDTH) / 2;

// Diamond obstacle: gold cells forming a wide diamond at center.
// Much wider than before — fills most of the cross center.
export const DIAMOND_CENTER_X = 40;
export const DIAMOND_CENTER_Y = 60;
export const DIAMOND_HALF_W = 14; // half-width in tiles (was 8)
export const DIAMOND_HALF_H = 16; // half-height in tiles (was 12)
export const GOLD_PER_CELL = 10;

// Side resource node positions (moved inward to stay aligned with narrower walkable area)
export const WOOD_NODE_X = 12;
export const MEAT_NODE_X = 68;

// HQ
export const HQ_WIDTH = 4;
export const HQ_HEIGHT = 2;
export const HQ_HP = 2000;
export const NUKE_RADIUS = 16;

// Lane paths: both lanes CONVERGE into a single corridor before the diamond,
// fork around it (left or right), then reconverge on the other side.
// This creates head-on army collisions at the convergence points.
// Diamond is at x=40, y=60, edges at x=26 and x=54, y=44 and y=76.
export const LANE_PATHS = {
  bottom: {
    left: [
      { x: 40, y: 110 },  // base center
      { x: 40, y: 95 },   // through neck (both lanes share this corridor)
      { x: 40, y: 82 },   // convergence point — both lanes merge here
      { x: 24, y: 72 },   // fork left, approach diamond (wider clearance)
      { x: 18, y: 60 },   // alongside diamond left edge (wider clearance)
      { x: 24, y: 48 },   // past diamond, heading back to center
      { x: 40, y: 38 },   // reconvergence — both lanes merge again
      { x: 40, y: 25 },   // through top neck
      { x: 40, y: 10 },   // enemy base center
    ],
    right: [
      { x: 40, y: 110 },  // base center (same start as left)
      { x: 40, y: 95 },   // through neck
      { x: 40, y: 82 },   // convergence point
      { x: 56, y: 72 },   // fork right, approach diamond (wider clearance)
      { x: 62, y: 60 },   // alongside diamond right edge (wider clearance)
      { x: 56, y: 48 },   // past diamond, heading back to center
      { x: 40, y: 38 },   // reconvergence
      { x: 40, y: 25 },   // through top neck
      { x: 40, y: 10 },   // enemy base center
    ],
  },
  top: {
    left: [
      { x: 40, y: 10 },
      { x: 40, y: 25 },
      { x: 40, y: 38 },
      { x: 24, y: 48 },
      { x: 18, y: 60 },
      { x: 24, y: 72 },
      { x: 40, y: 82 },
      { x: 40, y: 95 },
      { x: 40, y: 110 },
    ],
    right: [
      { x: 40, y: 10 },
      { x: 40, y: 25 },
      { x: 40, y: 38 },
      { x: 56, y: 48 },
      { x: 62, y: 60 },
      { x: 56, y: 72 },
      { x: 40, y: 82 },
      { x: 40, y: 95 },
      { x: 40, y: 110 },
    ],
  },
} as const;

// === Map Definition ===

/** Per-player layout slot within a map */
export interface PlayerSlotDef {
  teamIndex: number;           // which team (0 or 1) this player belongs to
  buildGridOrigin: Vec2;       // top-left of BUILD_GRID (14×3) in world tiles
  hutGridOrigin: Vec2;         // top-left of HUT_GRID (10×1) in world tiles
  defaultLane?: Lane;          // override default lane assignment (top/bot); falls back to posInTeam % 2
}

/** Per-team shared layout */
export interface TeamDef {
  hqPosition: Vec2;            // top-left corner of HQ building
  towerAlleyOrigin: Vec2;      // top-left of shared tower alley grid
}

/** Lane path set for one team */
export interface TeamLanePaths {
  left: Vec2[];
  right: Vec2[];
}

/**
 * Data-driven map definition. All layout comes from here —
 * no hardcoded positions outside of MapDef constants.
 * Supports portrait (duel) and landscape (skirmish) orientations.
 */
export interface MapDef {
  id: string;
  name: string;
  width: number;
  height: number;
  maxPlayers: number;          // 4 for duel, 6 for skirmish
  playersPerTeam: number;      // 2 for duel, 3 for skirmish
  teams: [TeamDef, TeamDef];   // exactly 2 teams (indices 0 and 1)
  playerSlots: PlayerSlotDef[];// indexed by playerId (0..maxPlayers-1)
  lanePaths: [TeamLanePaths, TeamLanePaths]; // indexed by team (0, 1)
  diamondCenter: Vec2;
  diamondHalfW: number;
  diamondHalfH: number;
  resourceNodes: { type: ResourceType; x: number; y: number }[];
  /** Per-player military build grid dimensions (cols × rows) */
  buildGridCols: number;       // 14 for duel (horizontal), 3 for skirmish (rotated)
  buildGridRows: number;       // 3 for duel, 14 for skirmish (rotated)
  /** Per-player harvester hut grid dimensions */
  hutGridCols: number;         // 10 for duel (horizontal), 1 for skirmish (rotated)
  hutGridRows: number;         // 1 for duel, 10 for skirmish (rotated)
  /** Shared tower alley dimensions (per team) */
  towerAlleyCols: number;      // 20 for duel, 12 for skirmish (rotated)
  towerAlleyRows: number;      // 12 for duel, 20 for skirmish (rotated)
  /** Per-team nuke allowed range along shapeAxis (team 0, team 1) */
  nukeZone: [{ min: number; max: number }, { min: number; max: number }];
  /** Returns true if tile (x, y) is within the playable map boundary */
  isPlayable(x: number, y: number): boolean;
  /** Returns the playable x-range for a given row (portrait) or y-range for a given col (landscape) */
  getPlayableRange(axisPos: number): { min: number; max: number };
  /** Which axis the shape varies along: 'y' for portrait maps, 'x' for landscape */
  shapeAxis: 'y' | 'x';
  /** Multiplier for wood/meat harvester deposits. Default 1. */
  resourceYield?: number;
}

// === Enums ===

export enum Team {
  Bottom = 0,
  Top = 1,
}

export enum Race {
  Crown = 'crown',
  Horde = 'horde',
  Goblins = 'goblins',
  Oozlings = 'oozlings',
  Demon = 'demon',
  Deep = 'deep',
  Wild = 'wild',
  Geists = 'geists',
  Tenders = 'tenders',
}

export enum Lane {
  Left = 'left',
  Right = 'right',
}

export enum BuildingType {
  MeleeSpawner = 'melee_spawner',
  RangedSpawner = 'ranged_spawner',
  CasterSpawner = 'caster_spawner',
  Tower = 'tower',
  HarvesterHut = 'harvester_hut',
  Research = 'research',
}

export enum ResourceType {
  Gold = 'gold',
  Wood = 'wood',
  Meat = 'meat',
}

export enum HarvesterAssignment {
  BaseGold = 'base_gold',
  Wood = 'wood',
  Meat = 'meat',
  Center = 'center', // mine gold cells, then compete for diamond once exposed
  Mana = 'mana',     // Demon: harvester generates mana instead of resources
}

// === Status Effects ===

export enum StatusType {
  Slow = 'slow',       // -10% move speed per stack, max 5
  Burn = 'burn',       // 2 dmg/sec per stack for 3s, max 5
  Haste = 'haste',     // 1.3x speed, 3s, no stack, refreshes
  Shield = 'shield',   // absorbs 12 damage, 4s, 1 instance
  Frenzy = 'frenzy',       // Wild kill bonus: +30% damage, 3s, refreshes on kills
  Wound = 'wound',         // -50% healing received, 6s, max 1 stack, refreshes
  Vulnerable = 'vulnerable', // +20% damage taken, 3s, max 1 stack, refreshes
}

export interface StatusEffect {
  type: StatusType;
  stacks: number;
  duration: number;  // remaining ticks
}

// === Interfaces ===

export interface Vec2 {
  x: number;
  y: number;
}

export interface ResearchUpgradeState {
  meleeAtkLevel: number;
  rangedAtkLevel: number;
  casterAtkLevel: number;
  meleeDefLevel: number;
  rangedDefLevel: number;
  casterDefLevel: number;
  raceUpgrades: Record<string, boolean>;
}

export function createResearchUpgradeState(): ResearchUpgradeState {
  return {
    meleeAtkLevel: 0, rangedAtkLevel: 0, casterAtkLevel: 0,
    meleeDefLevel: 0, rangedDefLevel: 0, casterDefLevel: 0,
    raceUpgrades: {},
  };
}

export interface PlayerState {
  id: number; // 0-3
  team: Team;
  race: Race;
  gold: number;
  wood: number;
  meat: number;
  goldFrac?: number;  // fractional accumulator for passive income < 1/sec
  woodFrac?: number;
  meatFrac?: number;
  nukeAvailable: boolean;
  connected: boolean;
  isBot: boolean;
  isEmpty: boolean;  // true = slot is unoccupied (no buildings, no income, no AI)
  hasBuiltTower: boolean;
  // Race ability state
  abilityCooldown: number;       // ticks remaining until ability can be used again
  abilityUseCount: number;       // how many times used (for growing costs)
  abilityStacks: number;         // Tenders: accumulated seed charges (max 10)
  // Special resources (0 for races that don't use them)
  mana: number;                  // Demon
  manaFrac?: number;             // fractional accumulator for passive mana gen
  souls: number;                 // Geists (gained from ANY death)
  deathEssence: number;          // Oozlings (gained from oozling deaths)
  researchUpgrades: ResearchUpgradeState;
  /** Accumulated War Troll kills across all summons (Horde Trophy Hunter) */
  trollKills: number;
  /** Multiplier for unit HP and damage at spawn (default 1.0, used by nightmare bots) */
  statBonus: number;
}

// Race ability targeting mode
export enum AbilityTargetMode {
  Instant = 'instant',       // Deep slow, Horde troll summon
  Targeted = 'targeted',     // Demon fireball, Wild frenzy, Geist skeletons
  BuildSlot = 'build_slot',  // Crown gold building, Goblin potion shop, Tenders seeds
}

// Per-race ability definition (static data)
export interface RaceAbilityDef {
  race: Race;
  name: string;
  targetMode: AbilityTargetMode;
  baseCooldownTicks: number;
  baseCost: { gold?: number; wood?: number; meat?: number; mana?: number; souls?: number; deathEssence?: number };
  costGrowthFactor?: number;  // multiplier per use (for growing costs)
  requiresVision?: boolean;   // Demon fireball, Geist skeletons
  aoeRadius?: number;         // for targeted abilities
}

// Active ability effect in the game world
export interface AbilityEffect {
  id: number;
  type: string;               // 'deep_rain', 'wild_frenzy', etc.
  playerId: number;
  team: Team;
  x?: number;                 // world position (for targeted effects)
  y?: number;
  radius?: number;
  duration: number;           // ticks remaining
  data?: Record<string, number>;  // ability-specific payload
}

export interface BuildingState {
  id: number;
  type: BuildingType;
  playerId: number;
  buildGrid: 'military' | 'alley' | 'hut';
  gridX: number;
  gridY: number;
  worldX: number;
  worldY: number;
  lane: Lane;
  hp: number;
  maxHp: number;
  actionTimer: number;
  placedTick: number;
  upgradePath: string[];
  // Race ability building markers
  isFoundry?: boolean;     // Crown: gold yield building
  isPotionShop?: boolean;  // Goblins: potion shop
  isGlobule?: boolean;     // Oozlings: globule building
  isSeed?: boolean;        // Tenders: seed pod
  seedTimer?: number;      // Tenders: ticks until seed pops
  seedTier?: number;       // Tenders: 0=T1, 1=T2, 2=T3
}

export interface UnitState {
  id: number;
  type: string;
  playerId: number;
  team: Team;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  damage: number;
  attackSpeed: number;
  attackTimer: number;
  moveSpeed: number;
  range: number;
  targetId: number | null;
  lane: Lane;
  pathProgress: number;
  carryingDiamond: boolean;
  statusEffects: StatusEffect[];
  hitCount: number;       // for Bastion knockback (every 3rd hit)
  shieldHp: number;       // absorb pool from Shield status
  category: 'melee' | 'ranged' | 'caster';
  upgradeTier: number;                 // 0=base, 1=tier1, 2=tier2
  upgradeNode: string;                 // terminal upgrade node key ('A','B','C','D','E','F','G')
  upgradeSpecial: Record<string, any>; // upgrade-granted special effects
  kills: number;          // individual kill count for war hero tracking
  damageDone: number;     // total damage dealt (for war hero display)
  healingDone: number;    // total HP healed to allies (for support hero)
  buffsApplied: number;   // ally buff instances applied (Haste/Frenzy/Shield, for support hero)
  lastDamagedByName: string; // name of last unit/source that dealt damage
  spawnTick: number;      // tick when unit was created
  nukeImmune?: boolean;   // diamond champion — immune to nuke damage
  isChampion?: boolean;   // diamond champion flag (for rendering/targeting)
  summonDuration?: number; // ticks remaining for temporary summons (e.g. Geist skeletons)
  fleeTimer?: number;      // Goblins: ticks remaining in flee state (run away then re-engage)
  spriteRace?: Race;       // override race for sprite lookup (e.g. Horde troll uses Goblin troll art)
  stuckTicks?: number;     // consecutive ticks without moving — triggers path-snap escape
  soulStacks?: number;     // Geist Soul Gorger: stacks gained from nearby deaths (max 20)
  visualScale?: number;    // extra render scale multiplier (e.g. 2.0 for War Troll)
}

// Snapshot of a notable unit for post-match display
export interface WarHero {
  name: string;         // unit type name (e.g. "Volt Runner")
  playerId: number;
  race: Race;
  category: 'melee' | 'ranged' | 'caster';
  upgradeNode: string;  // terminal upgrade node key ('A','B',...)
  kills: number;
  damageDone: number;
  healingDone: number;
  buffsApplied: number;
  survived: boolean;
  killedByName: string | null; // name of the unit/source that killed it, null if survived
  spawnTick: number;    // tick when unit was spawned
  deathTick: number | null; // tick when unit died, null if survived
}

/** Compact per-second snapshot used by the post-match minimap replay. */
export interface MinimapFrame {
  tick: number;
  /** Unit positions by owner — only x/y/playerId/team to keep size small. */
  units: Array<{ x: number; y: number; playerId: number; team: number }>;
  hqHp: [number, number];
  diamond: { x: number; y: number; carried: boolean } | null;
  /** Active nuke telegraphs — player-colored warning circles. */
  nukes: Array<{ x: number; y: number; radius: number; playerId: number }>;
  /** Top-kill unit position per player (war hero candidate while alive). */
  warHeroPositions: Array<{ x: number; y: number; playerId: number }>;
}

// A single gold cell in the diamond obstacle
export interface GoldCell {
  tileX: number; // world tile coordinate
  tileY: number;
  gold: number;  // remaining gold (0 = mined out, passable)
  maxGold: number;
}

export interface HarvesterState {
  id: number;
  hutId: number;
  playerId: number;
  team: Team;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  damage: number; // 0 normally, > 0 when fighting carriers
  assignment: HarvesterAssignment;
  state: 'walking_to_node' | 'mining' | 'walking_home' | 'dead' | 'fighting';
  miningTimer: number;
  respawnTimer: number;
  carryingDiamond: boolean;
  carryingResource: ResourceType | null;
  carryAmount: number;
  queuedWoodAmount: number;
  woodCarryTarget: number;
  woodDropsCreated: number;
  targetCellIdx: number; // index into diamondCells being mined, -1 if none
  diamondCellsMinedThisTrip: number; // how many full diamond cells cleared this trip
  fightTargetId: number | null; // harvester id of enemy carrier to attack
  path: { x: number; y: number }[]; // A* computed waypoints (tile centers)
}

export interface WoodPileState {
  id: number;
  x: number;
  y: number;
  amount: number;
}

export type PotionType = 'speed' | 'rage' | 'shield';

export interface PotionDropState {
  id: number;
  x: number;          // landing position
  y: number;
  srcX: number;       // throw origin (shop position)
  srcY: number;
  type: PotionType;
  team: Team;
  flightTicks: number;    // total flight duration
  flightProgress: number; // 0 = just launched, >= flightTicks = landed
  remainingTicks: number; // despawn timer (counts down after landing)
}

export interface DiamondState {
  x: number;
  y: number;
  exposed: boolean; // true once a path to center is cleared
  state: 'hidden' | 'exposed' | 'being_mined' | 'carried' | 'dropped' | 'respawning';
  carrierId: number | null;
  carrierType: 'unit' | 'harvester' | null;
  mineProgress: number; // 0-1
  respawnTimer: number; // ticks until diamond reappears after delivery
  deliveries: number;   // how many times diamond has been delivered (champion gets stronger)
}

export type ProjectileVisual = 'arrow' | 'orb' | 'circle' | 'bolt' | 'bone' | 'cannonball';

export interface ProjectileState {
  id: number;
  x: number;
  y: number;
  targetId: number;
  damage: number;
  speed: number;
  aoeRadius: number;
  team: Team;
  visual: ProjectileVisual;         // determines sprite: arrow, orb, circle (AoE), bolt (HQ/tower)
  sourcePlayerId: number; // tracks which player fired it for race-specific effects
  sourceUnitId?: number;  // tracks which unit fired it for kill credit
  extraBurnStacks?: number;
  extraSlowStacks?: number;
  splashDamagePct?: number;
  lifestealPct?: number;
  isTowerShot?: boolean;
  // Siege cannonball: fly to a world position instead of chasing a unit
  targetX?: number;
  targetY?: number;
  buildingDamageMult?: number;  // on impact, deal damage * mult to buildings in aoeRadius
}

export interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  icon?: string;   // optional resource icon name ('gold', 'wood', 'meat')
  age: number;     // ticks alive
  maxAge: number;  // ticks until removed
  xOff: number;    // random x offset in tiles for visual spread
  big?: boolean;   // true = keyword/icon text (larger font, pop-in scale)
  vx?: number;     // horizontal velocity (tiles/tick) for arc motion
  vy?: number;     // initial vertical velocity for arc/gravity
  ftType?: 'damage' | 'heal' | 'resource' | 'status' | 'ability'; // animation variant
  magnitude?: number; // for scaling text size (e.g. damage amount)
  miniIcon?: string;  // canvas-drawn mini icon: 'sword', 'arrow', 'fire', 'skull', 'shield_icon', 'lightning', 'poison', 'heart'
  ownerOnly?: number; // if set, only render for this player index (e.g. mana/souls/ooze)
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  age: number;
  maxAge: number;
  size: number;
}

export interface NukeEffect {
  x: number;
  y: number;
  radius: number;
  age: number;
  maxAge: number;
}

export interface NukeTelegraph {
  x: number;
  y: number;
  radius: number;
  playerId: number;
  timer: number;     // ticks remaining before detonation
}

export interface PingState {
  id: number;
  playerId: number;
  team: Team;
  x: number;
  y: number;
  age: number;
  maxAge: number;
}

export interface QuickChatState {
  id: number;
  playerId: number;
  team: Team;
  message: string;
  age: number;
  maxAge: number;
}

// === Combat Visual Events (consumed by renderer) ===

export type CombatEventType =
  | 'splash' | 'pulse' | 'chain' | 'lifesteal'
  | 'heal' | 'dodge' | 'revive' | 'cleanse' | 'knockback';

export interface CombatEvent {
  type: CombatEventType;
  x: number;
  y: number;
  x2?: number;  // endpoint for chain arcs
  y2?: number;
  radius?: number; // for splash/pulse rings
  color: string;
}

// === Sound Events ===

export type SoundEventType =
  | 'building_placed' | 'building_destroyed'
  | 'unit_killed' | 'melee_hit' | 'ranged_hit'
  | 'unit_spawn' | 'tower_fire' | 'upgrade_complete'
  | 'ability_leap' | 'ability_cleave'
  | 'ability_fireball' | 'ability_deluge' | 'ability_frenzy'
  | 'ability_summon' | 'ability_troll' | 'ability_potion'
  | 'nuke_incoming' | 'nuke_detonated'
  | 'diamond_exposed' | 'diamond_carried' | 'hq_damaged'
  | 'match_start' | 'match_end_win' | 'match_end_lose';

export interface SoundEvent {
  type: SoundEventType;
  x?: number; // world tile coords
  y?: number;
}

export interface PlayerStats {
  totalGoldEarned: number;
  totalWoodEarned: number;
  totalMeatEarned: number;
  totalDamageDealt: number;
  totalDamageNearHQ: number; // within 20 tiles of own HQ
  totalDamageTaken: number;
  towerDamageDealt: number;
  burnDamageDealt: number;   // damage from Burn DoT ticks
  abilityDamageDealt: number; // damage from race abilities (fireball, deluge, etc.)
  nukeDamageDealt: number;   // damage from nuke detonations
  totalHealing: number;
  unitsSpawned: number;
  unitsLost: number;
  enemyUnitsKilled: number;
  nukeKills: number;
  diamondPickups: number;
  diamondTimeHeld: number; // ticks carrying diamond
}

export function createPlayerStats(): PlayerStats {
  return {
    totalGoldEarned: 0, totalWoodEarned: 0, totalMeatEarned: 0,
    totalDamageDealt: 0, totalDamageNearHQ: 0,
    totalDamageTaken: 0, towerDamageDealt: 0,
    burnDamageDealt: 0, abilityDamageDealt: 0, nukeDamageDealt: 0,
    totalHealing: 0,
    unitsSpawned: 0, unitsLost: 0, enemyUnitsKilled: 0, nukeKills: 0,
    diamondPickups: 0, diamondTimeHeld: 0,
  };
}

// Mulberry32 seeded PRNG — deterministic, fast, 32-bit state
export function createSeededRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GameState {
  tick: number;
  rng: () => number;             // seeded PRNG — use instead of Math.random() in simulation
  rngSeed: number;               // initial seed (for resync / debug)
  mapDef: MapDef;                // map layout definition (duel, skirmish, etc.)
  players: PlayerState[];
  buildings: BuildingState[];
  units: UnitState[];
  harvesters: HarvesterState[];
  woodPiles: WoodPileState[];
  potionDrops: PotionDropState[];
  projectiles: ProjectileState[];
  diamond: DiamondState;
  diamondCells: GoldCell[]; // the mineable gold cells forming the obstacle
  hqHp: number[];               // indexed by team (0, 1); length matches mapDef.teams.length
  hqAttackTimer: number[];      // per-team HQ attack cooldown (ticks remaining)
  winner: Team | null;
  winCondition: 'military' | 'diamond' | 'timeout' | 'concede' | null;
  matchPhase: 'prematch' | 'playing' | 'ended';
  prematchTimer: number;
  floatingTexts: FloatingText[];
  particles: Particle[];
  nukeEffects: NukeEffect[];
  nukeTelegraphs: NukeTelegraph[];
  nukeTeamCooldown: number[];   // per-team cooldown ticks remaining (0 = ready)
  abilityEffects: AbilityEffect[];  // active race ability effects
  pings: PingState[];
  quickChats: QuickChatState[];
  soundEvents: SoundEvent[];
  combatEvents: CombatEvent[];
  nextEntityId: number;
  playerStats: PlayerStats[];
  warHeroes: WarHero[];          // populated at match end — top killer per player
  supportHeroes: WarHero[];      // populated at match end — top support unit per player
  fallenHeroes: WarHero[];       // notable units that died during the match
  fogOfWar: boolean;             // whether fog of war is enabled
  /** Per-team tile visibility: teamIndex → flat boolean array [y * mapWidth + x] */
  visibility: boolean[][];
}

// === Commands (client -> server) ===

export type GameCommand =
  | { type: 'place_building'; playerId: number; buildingType: BuildingType; gridX: number; gridY: number; gridType?: 'alley' }
  | { type: 'sell_building'; playerId: number; buildingId: number }
  | { type: 'toggle_lane'; playerId: number; buildingId: number; lane: Lane }
  | { type: 'toggle_all_lanes'; playerId: number; lane: Lane }
  | { type: 'purchase_upgrade'; playerId: number; buildingId: number; choice: string }
  | { type: 'build_hut'; playerId: number; hutSlot?: number }
  | { type: 'set_hut_assignment'; playerId: number; hutId: number; assignment: HarvesterAssignment }
  | { type: 'fire_nuke'; playerId: number; x: number; y: number }
  | { type: 'ping'; playerId: number; x: number; y: number }
  | { type: 'quick_chat'; playerId: number; message: string }
  | { type: 'concede'; playerId: number }
  | { type: 'use_ability'; playerId: number; x?: number; y?: number; gridX?: number; gridY?: number }
  | { type: 'research_upgrade'; playerId: number; upgradeId: string };
