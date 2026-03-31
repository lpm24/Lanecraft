/**
 * Map definitions for all game modes.
 * Each MapDef fully describes a map's layout — player positions, lanes, shape, resources.
 *
 * DUEL_MAP: Portrait 80×120, 2v2, top vs bottom (original map)
 * SKIRMISH_MAP: Landscape 160×90, 3v3, left vs right (3 bases stacked vertically per side)
 * WARZONE_MAP: Landscape 160×90, 4v4, left vs right (4 tighter bases per side)
 */

import {
  MapDef, Vec2, ResourceType, Lane,
  MAP_WIDTH, MAP_HEIGHT, HQ_WIDTH, HQ_HEIGHT,
  BUILD_GRID_COLS, BUILD_GRID_ROWS,
  SHARED_ALLEY_COLS, SHARED_ALLEY_ROWS,
  ZONES, CROSS_BASE_MARGIN, CROSS_BASE_WIDTH,
  DIAMOND_CENTER_X, DIAMOND_CENTER_Y, DIAMOND_HALF_W, DIAMOND_HALF_H,
  WOOD_NODE_X, MEAT_NODE_X,
  LANE_PATHS,
  getMarginAtRow,
} from './types';

// ============================================================
// DUEL MAP — Portrait 80×120, 2v2, top vs bottom
// ============================================================

export const DUEL_MAP: MapDef = {
  id: 'duel',
  name: 'Duel',
  width: MAP_WIDTH,    // 80
  height: MAP_HEIGHT,  // 120
  maxPlayers: 4,
  playersPerTeam: 2,
  shapeAxis: 'y',
  biome: 'temperate',

  teams: [
    // Team 0 (Bottom)
    {
      hqPosition: {
        x: Math.floor(MAP_WIDTH / 2) - Math.floor(HQ_WIDTH / 2),  // 36
        y: ZONES.BOTTOM_BASE.start + 1,                            // 105
      },
      towerAlleyOrigin: { x: 30, y: 82 },
    },
    // Team 1 (Top)
    {
      hqPosition: {
        x: Math.floor(MAP_WIDTH / 2) - Math.floor(HQ_WIDTH / 2),  // 36
        y: ZONES.TOP_BASE.end - HQ_HEIGHT - 1,                     // 12
      },
      towerAlleyOrigin: { x: 30, y: 26 },
    },
  ],

  playerSlots: [
    // P0: Bottom-Left
    {
      teamIndex: 0,
      buildGridOrigin: (() => {
        const gap = 2;
        const totalW = BUILD_GRID_COLS * 2 + gap;
        const startX = CROSS_BASE_MARGIN + Math.floor((CROSS_BASE_WIDTH - totalW) / 2);
        const y = ZONES.BOTTOM_BASE.start + Math.floor((ZONES.BOTTOM_BASE.end - ZONES.BOTTOM_BASE.start - BUILD_GRID_ROWS) / 2);
        return { x: startX, y };
      })(),
      hutGridOrigin: { x: 29, y: ZONES.BOTTOM_BASE.end - 2 },
    },
    // P1: Bottom-Right
    {
      teamIndex: 0,
      buildGridOrigin: (() => {
        const gap = 2;
        const totalW = BUILD_GRID_COLS * 2 + gap;
        const startX = CROSS_BASE_MARGIN + Math.floor((CROSS_BASE_WIDTH - totalW) / 2);
        const y = ZONES.BOTTOM_BASE.start + Math.floor((ZONES.BOTTOM_BASE.end - ZONES.BOTTOM_BASE.start - BUILD_GRID_ROWS) / 2);
        return { x: startX + BUILD_GRID_COLS + gap, y };
      })(),
      hutGridOrigin: { x: 41, y: ZONES.BOTTOM_BASE.end - 2 },
    },
    // P2: Top-Left
    {
      teamIndex: 1,
      buildGridOrigin: (() => {
        const gap = 2;
        const totalW = BUILD_GRID_COLS * 2 + gap;
        const startX = CROSS_BASE_MARGIN + Math.floor((CROSS_BASE_WIDTH - totalW) / 2);
        const y = ZONES.TOP_BASE.start + Math.floor((ZONES.TOP_BASE.end - ZONES.TOP_BASE.start - BUILD_GRID_ROWS) / 2);
        return { x: startX, y };
      })(),
      hutGridOrigin: { x: 29, y: ZONES.TOP_BASE.start + 1 },
    },
    // P3: Top-Right
    {
      teamIndex: 1,
      buildGridOrigin: (() => {
        const gap = 2;
        const totalW = BUILD_GRID_COLS * 2 + gap;
        const startX = CROSS_BASE_MARGIN + Math.floor((CROSS_BASE_WIDTH - totalW) / 2);
        const y = ZONES.TOP_BASE.start + Math.floor((ZONES.TOP_BASE.end - ZONES.TOP_BASE.start - BUILD_GRID_ROWS) / 2);
        return { x: startX + BUILD_GRID_COLS + gap, y };
      })(),
      hutGridOrigin: { x: 41, y: ZONES.TOP_BASE.start + 1 },
    },
  ],

  lanePaths: [
    // Team 0 (Bottom) paths
    { left: [...LANE_PATHS.bottom.left], right: [...LANE_PATHS.bottom.right] },
    // Team 1 (Top) paths
    { left: [...LANE_PATHS.top.left], right: [...LANE_PATHS.top.right] },
  ],

  diamondCenter: { x: DIAMOND_CENTER_X, y: DIAMOND_CENTER_Y },
  diamondHalfW: DIAMOND_HALF_W,
  diamondHalfH: DIAMOND_HALF_H,

  buildGridCols: BUILD_GRID_COLS,   // 14
  buildGridRows: BUILD_GRID_ROWS,   // 3
  hutGridCols: 10,
  hutGridRows: 1,
  towerAlleyCols: SHARED_ALLEY_COLS,  // 20
  towerAlleyRows: SHARED_ALLEY_ROWS,  // 12

  // Nuke zone: each team can only nuke the 40% of the map nearest their base
  // Bottom (team 0) base at y≈110, Top (team 1) base at y≈10
  nukeZone: [
    { min: Math.round(MAP_HEIGHT * 0.60), max: MAP_HEIGHT },  // Bottom: y >= 72
    { min: 0, max: Math.round(MAP_HEIGHT * 0.40) },           // Top: y <= 48
  ],

  resourceNodes: [
    { type: ResourceType.Wood, x: WOOD_NODE_X, y: 60 },
    { type: ResourceType.Meat, x: MEAT_NODE_X, y: 60 },
  ],

  isPlayable(x: number, y: number): boolean {
    if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) return false;
    const margin = getMarginAtRow(y);
    return x >= margin && x < MAP_WIDTH - margin;
  },

  getPlayableRange(row: number): { min: number; max: number } {
    const margin = getMarginAtRow(row);
    return { min: margin, max: MAP_WIDTH - margin };
  },
};

// ============================================================
// SKIRMISH MAP — Landscape 160×90, 3v3, left vs right
// ============================================================

// Skirmish constants
const SK_W = 160;
const SK_H = 90;
const SK_PLAYER_STRIP_H = 26;   // each player's vertical strip height
const SK_STRIP_GAP = 3;         // gap between player strips
const SK_STRIP_START = 4;       // top margin before first strip

// Build grid: 3 wide × 14 tall (rotated 90° from duel's 14×3)
const SK_BUILD_COLS = 3;
const SK_BUILD_ROWS = 14;
// Hut grid: 1 wide × 10 tall (rotated 90° from duel's 10×1)
const SK_HUT_COLS = 1;
const SK_HUT_ROWS = 10;

// Player strip Y positions (3 strips stacked vertically)
function skPlayerStripY(slotInTeam: number): number {
  return SK_STRIP_START + slotInTeam * (SK_PLAYER_STRIP_H + SK_STRIP_GAP);
}

// Shape: peanut rotated 90° — wide at bases, narrow necks, widest at diamond center
const SK_NECK_X_LEFT = 45;
const SK_NECK_X_RIGHT = 115;
const SK_DIAMOND_X = 80;
const SK_DIAMOND_Y = 45;
const SK_SHAPE_BASE_H = 82;
const SK_SHAPE_NECK_H = 50;
const SK_SHAPE_CENTER_H = 86;

function skGetMarginAtCol(x: number): number {
  if (x <= 18) return (SK_H - SK_SHAPE_BASE_H) / 2;
  if (x >= 142) return (SK_H - SK_SHAPE_BASE_H) / 2;
  if (x <= SK_NECK_X_LEFT) {
    const t = (x - 18) / (SK_NECK_X_LEFT - 18);
    return (SK_H - (SK_SHAPE_BASE_H + (SK_SHAPE_NECK_H - SK_SHAPE_BASE_H) * t)) / 2;
  }
  if (x <= SK_DIAMOND_X) {
    const t = (x - SK_NECK_X_LEFT) / (SK_DIAMOND_X - SK_NECK_X_LEFT);
    return (SK_H - (SK_SHAPE_NECK_H + (SK_SHAPE_CENTER_H - SK_SHAPE_NECK_H) * t)) / 2;
  }
  if (x <= SK_NECK_X_RIGHT) {
    const t = (x - SK_DIAMOND_X) / (SK_NECK_X_RIGHT - SK_DIAMOND_X);
    return (SK_H - (SK_SHAPE_CENTER_H + (SK_SHAPE_NECK_H - SK_SHAPE_CENTER_H) * t)) / 2;
  }
  const t = (x - SK_NECK_X_RIGHT) / (142 - SK_NECK_X_RIGHT);
  return (SK_H - (SK_SHAPE_NECK_H + (SK_SHAPE_BASE_H - SK_SHAPE_NECK_H) * t)) / 2;
}

// ---- Skirmish base layout ----
// Left side (Team 0):
//   x=2:   hut columns (1 wide, miners — furthest from HQ), one per player strip
//   x=4:   research building (midpoint between hut and build grid)
//   x=6..8: build grids (3 wide, war units — closest to HQ), one per player strip
//   x=19..30: tower alley (12 wide × 20 tall), centered vertically
//   HQ center at x=14, centered at y=45
// Right side (Team 1): mirrored

// Build grid origins: 3 wide × 14 tall, closer to HQ (war units nearest HQ)
function skBuildGridOrigin(side: 'left' | 'right', slotInTeam: number): Vec2 {
  const stripY = skPlayerStripY(slotInTeam);
  const y = stripY + Math.floor((SK_PLAYER_STRIP_H - SK_BUILD_ROWS) / 2);
  const x = side === 'left' ? 6 : SK_W - 6 - SK_BUILD_COLS; // 6 or 151
  return { x, y };
}

// Hut grid origins: 1 wide × 10 tall, farther from HQ (miners furthest back)
function skHutGridOrigin(side: 'left' | 'right', slotInTeam: number): Vec2 {
  const stripY = skPlayerStripY(slotInTeam);
  const y = stripY + Math.floor((SK_PLAYER_STRIP_H - SK_HUT_ROWS) / 2);
  const x = side === 'left' ? 2 : SK_W - 2 - SK_HUT_COLS; // 2 or 157
  return { x, y };
}

// HQ center positions
const SK_LEFT_HQ_CX = 14;
const SK_RIGHT_HQ_CX = SK_W - 14; // 146
const SK_HQ_Y = Math.floor(SK_H / 2) - Math.floor(HQ_HEIGHT / 2); // 43

// Skirmish tower alley: 12 wide × 20 tall (rotated 90° from duel's 20×12)
const SK_ALLEY_COLS = 12;
const SK_ALLEY_ROWS = 20;
const SK_ALLEY_Y = Math.floor(SK_H / 2) - Math.floor(SK_ALLEY_ROWS / 2); // 35
// Alley sits right of HQ (left side) / left of HQ (right side) with 1-tile gap
const SK_ALLEY_LEFT_X = SK_LEFT_HQ_CX + Math.ceil(HQ_WIDTH / 2) + 1; // 19

// Lane Y positions (in gaps between strips)
const SK_TOP_LANE_Y = skPlayerStripY(0) + SK_PLAYER_STRIP_H + Math.floor(SK_STRIP_GAP / 2); // 31
const SK_BOT_LANE_Y = skPlayerStripY(1) + SK_PLAYER_STRIP_H + Math.floor(SK_STRIP_GAP / 2); // 60

function skLanePath(forkDir: 'top' | 'bottom'): Vec2[] {
  const laneY = forkDir === 'top' ? SK_TOP_LANE_Y : SK_BOT_LANE_Y;
  const forkY = forkDir === 'top' ? SK_DIAMOND_Y - 18 : SK_DIAMOND_Y + 18;
  return [
    { x: SK_LEFT_HQ_CX, y: SK_DIAMOND_Y },         // converge at left HQ
    { x: SK_LEFT_HQ_CX + 8, y: forkDir === 'top' ? 38 : 52 }, // fan out
    { x: 35, y: laneY },                             // reach lane Y
    { x: 50, y: laneY },                             // cruise
    { x: SK_DIAMOND_X - 15, y: forkY },              // fork around diamond
    { x: SK_DIAMOND_X, y: forkY },                   // alongside diamond
    { x: SK_DIAMOND_X + 15, y: forkY },              // past diamond
    { x: 110, y: laneY },                            // cruise
    { x: 125, y: laneY },                            // reach lane Y
    { x: SK_RIGHT_HQ_CX - 8, y: forkDir === 'top' ? 38 : 52 }, // converge
    { x: SK_RIGHT_HQ_CX, y: SK_DIAMOND_Y },         // converge at right HQ
  ];
}

const SK_LANE_TOP = skLanePath('top');
const SK_LANE_BOT = skLanePath('bottom');

export const SKIRMISH_MAP: MapDef = {
  id: 'skirmish',
  name: 'Skirmish',
  width: SK_W,
  height: SK_H,
  maxPlayers: 6,
  playersPerTeam: 3,
  shapeAxis: 'x',
  biome: 'swamp',

  teams: [
    // Team 0 (Left) — HQ near left edge, tower alley right of HQ
    {
      hqPosition: { x: SK_LEFT_HQ_CX - Math.floor(HQ_WIDTH / 2), y: SK_HQ_Y },
      towerAlleyOrigin: { x: SK_ALLEY_LEFT_X, y: SK_ALLEY_Y },
    },
    // Team 1 (Right) — mirrored
    {
      hqPosition: { x: SK_RIGHT_HQ_CX - Math.floor(HQ_WIDTH / 2), y: SK_HQ_Y },
      towerAlleyOrigin: { x: SK_W - SK_ALLEY_LEFT_X - SK_ALLEY_COLS, y: SK_ALLEY_Y },
    },
  ],

  playerSlots: [
    // Team 0 (Left): P0=top, P1=mid, P2=bottom
    { teamIndex: 0, buildGridOrigin: skBuildGridOrigin('left', 0), hutGridOrigin: skHutGridOrigin('left', 0), defaultLane: Lane.Left },
    { teamIndex: 0, buildGridOrigin: skBuildGridOrigin('left', 1), hutGridOrigin: skHutGridOrigin('left', 1), defaultLane: Lane.Right },
    { teamIndex: 0, buildGridOrigin: skBuildGridOrigin('left', 2), hutGridOrigin: skHutGridOrigin('left', 2), defaultLane: Lane.Left },
    // Team 1 (Right): P3=top, P4=mid, P5=bottom
    { teamIndex: 1, buildGridOrigin: skBuildGridOrigin('right', 0), hutGridOrigin: skHutGridOrigin('right', 0), defaultLane: Lane.Left },
    { teamIndex: 1, buildGridOrigin: skBuildGridOrigin('right', 1), hutGridOrigin: skHutGridOrigin('right', 1), defaultLane: Lane.Right },
    { teamIndex: 1, buildGridOrigin: skBuildGridOrigin('right', 2), hutGridOrigin: skHutGridOrigin('right', 2), defaultLane: Lane.Left },
  ],

  lanePaths: [
    // Team 0 (Left→Right): first waypoint near own HQ, last near enemy HQ
    { left: [...SK_LANE_TOP], right: [...SK_LANE_BOT] },
    // Team 1 (Right→Left): reversed
    { left: [...SK_LANE_TOP].reverse(), right: [...SK_LANE_BOT].reverse() },
  ],

  diamondCenter: { x: SK_DIAMOND_X, y: SK_DIAMOND_Y },
  diamondHalfW: 12,
  diamondHalfH: 14,

  buildGridCols: SK_BUILD_COLS,   // 3
  buildGridRows: SK_BUILD_ROWS,   // 14
  hutGridCols: SK_HUT_COLS,       // 1
  hutGridRows: SK_HUT_ROWS,       // 10
  towerAlleyCols: SK_ALLEY_COLS,  // 12
  towerAlleyRows: SK_ALLEY_ROWS,  // 20

  // Nuke zone: each team can only nuke the 40% of the map nearest their base
  // Left (team 0) base at x≈14, Right (team 1) base at x≈146
  nukeZone: [
    { min: 0, max: Math.round(SK_W * 0.40) },                 // Left: x <= 64
    { min: Math.round(SK_W * 0.60), max: SK_W },              // Right: x >= 96
  ],

  resourceYield: 2, // double yield to compensate for longer travel distance

  resourceNodes: [
    { type: ResourceType.Wood, x: SK_DIAMOND_X, y: 6 },
    { type: ResourceType.Meat, x: SK_DIAMOND_X, y: SK_H - 6 },
  ],

  isPlayable(x: number, y: number): boolean {
    if (x < 0 || x >= SK_W || y < 0 || y >= SK_H) return false;
    const margin = skGetMarginAtCol(x);
    return y >= margin && y < SK_H - margin;
  },

  getPlayableRange(col: number): { min: number; max: number } {
    const margin = skGetMarginAtCol(col);
    return { min: margin, max: SK_H - margin };
  },
};

// ============================================================
// WARZONE MAP — Landscape 160×90, 4v4, left vs right
// Same dimensions as skirmish but 4 tighter base strips per side.
// Strips 0,1 → top lane (Lane.Left), strips 2,3 → bottom lane (Lane.Right).
// Layout:
//   Strip 0 (y=2)  ← top lane
//   Strip 1 (y=24) ← top lane
//     --- top lane gap (y=43-46) ---
//   Strip 2 (y=46) ← bottom lane
//   Strip 3 (y=68) ← bottom lane
// ============================================================

const WZ_W = 160;
const WZ_H = 90;
const WZ_PLAYER_STRIP_H = 19;   // tighter than skirmish's 26
const WZ_STRIP_GAP = 3;         // gap between all strips
const WZ_STRIP_START = 2;       // top margin

// 4 strips stacked vertically
function wzPlayerStripY(slotInTeam: number): number {
  return WZ_STRIP_START + slotInTeam * (WZ_PLAYER_STRIP_H + WZ_STRIP_GAP);
}

// Build grid: 3 wide × 14 tall (same as skirmish, rotated)
const WZ_BUILD_COLS = 3;
const WZ_BUILD_ROWS = 14;
const WZ_HUT_COLS = 1;
const WZ_HUT_ROWS = 10;

function wzBuildGridOrigin(side: 'left' | 'right', slotInTeam: number): Vec2 {
  const stripY = wzPlayerStripY(slotInTeam);
  const y = stripY + Math.floor((WZ_PLAYER_STRIP_H - WZ_BUILD_ROWS) / 2);
  const x = side === 'left' ? 6 : WZ_W - 6 - WZ_BUILD_COLS; // closer to HQ
  return { x, y };
}

function wzHutGridOrigin(side: 'left' | 'right', slotInTeam: number): Vec2 {
  const stripY = wzPlayerStripY(slotInTeam);
  const y = stripY + Math.floor((WZ_PLAYER_STRIP_H - WZ_HUT_ROWS) / 2);
  const x = side === 'left' ? 2 : WZ_W - 2 - WZ_HUT_COLS; // farther from HQ
  return { x, y };
}

// Reuse skirmish HQ/alley positions — same map dimensions
const WZ_LEFT_HQ_CX = 14;
const WZ_RIGHT_HQ_CX = WZ_W - 14; // 146
const WZ_HQ_Y = Math.floor(WZ_H / 2) - Math.floor(HQ_HEIGHT / 2); // 43
const WZ_ALLEY_COLS = 12;
const WZ_ALLEY_ROWS = 20;
const WZ_ALLEY_Y = Math.floor(WZ_H / 2) - Math.floor(WZ_ALLEY_ROWS / 2); // 35
const WZ_ALLEY_LEFT_X = WZ_LEFT_HQ_CX + Math.ceil(HQ_WIDTH / 2) + 1; // 19
const WZ_DIAMOND_X = 80;
const WZ_DIAMOND_Y = 45;

// Lane Y positions: top lane between strips 0-1 and bottom lane between strips 2-3
const WZ_TOP_LANE_Y = wzPlayerStripY(0) + WZ_PLAYER_STRIP_H + Math.floor(WZ_STRIP_GAP / 2); // ~22
const WZ_BOT_LANE_Y = wzPlayerStripY(2) + WZ_PLAYER_STRIP_H + Math.floor(WZ_STRIP_GAP / 2); // ~66

function wzLanePath(forkDir: 'top' | 'bottom'): Vec2[] {
  const laneY = forkDir === 'top' ? WZ_TOP_LANE_Y : WZ_BOT_LANE_Y;
  const forkY = forkDir === 'top' ? WZ_DIAMOND_Y - 18 : WZ_DIAMOND_Y + 18;
  return [
    { x: WZ_LEFT_HQ_CX, y: WZ_DIAMOND_Y },
    { x: WZ_LEFT_HQ_CX + 8, y: forkDir === 'top' ? 34 : 56 },
    { x: 35, y: laneY },
    { x: 50, y: laneY },
    { x: WZ_DIAMOND_X - 15, y: forkY },
    { x: WZ_DIAMOND_X, y: forkY },
    { x: WZ_DIAMOND_X + 15, y: forkY },
    { x: 110, y: laneY },
    { x: 125, y: laneY },
    { x: WZ_RIGHT_HQ_CX - 8, y: forkDir === 'top' ? 34 : 56 },
    { x: WZ_RIGHT_HQ_CX, y: WZ_DIAMOND_Y },
  ];
}

const WZ_LANE_TOP = wzLanePath('top');
const WZ_LANE_BOT = wzLanePath('bottom');

export const WARZONE_MAP: MapDef = {
  id: 'warzone',
  name: 'Kooktown',
  width: WZ_W,
  height: WZ_H,
  maxPlayers: 8,
  playersPerTeam: 4,
  shapeAxis: 'x',
  biome: 'volcanic',

  teams: [
    // Team 0 (Left)
    {
      hqPosition: { x: WZ_LEFT_HQ_CX - Math.floor(HQ_WIDTH / 2), y: WZ_HQ_Y },
      towerAlleyOrigin: { x: WZ_ALLEY_LEFT_X, y: WZ_ALLEY_Y },
    },
    // Team 1 (Right) — mirrored
    {
      hqPosition: { x: WZ_RIGHT_HQ_CX - Math.floor(HQ_WIDTH / 2), y: WZ_HQ_Y },
      towerAlleyOrigin: { x: WZ_W - WZ_ALLEY_LEFT_X - WZ_ALLEY_COLS, y: WZ_ALLEY_Y },
    },
  ],

  playerSlots: [
    // Team 0 (Left): P0-P3 (top pair → top lane, bottom pair → bottom lane)
    { teamIndex: 0, buildGridOrigin: wzBuildGridOrigin('left', 0), hutGridOrigin: wzHutGridOrigin('left', 0), defaultLane: Lane.Left },
    { teamIndex: 0, buildGridOrigin: wzBuildGridOrigin('left', 1), hutGridOrigin: wzHutGridOrigin('left', 1), defaultLane: Lane.Left },
    { teamIndex: 0, buildGridOrigin: wzBuildGridOrigin('left', 2), hutGridOrigin: wzHutGridOrigin('left', 2), defaultLane: Lane.Right },
    { teamIndex: 0, buildGridOrigin: wzBuildGridOrigin('left', 3), hutGridOrigin: wzHutGridOrigin('left', 3), defaultLane: Lane.Right },
    // Team 1 (Right): P4-P7 (mirrored)
    { teamIndex: 1, buildGridOrigin: wzBuildGridOrigin('right', 0), hutGridOrigin: wzHutGridOrigin('right', 0), defaultLane: Lane.Left },
    { teamIndex: 1, buildGridOrigin: wzBuildGridOrigin('right', 1), hutGridOrigin: wzHutGridOrigin('right', 1), defaultLane: Lane.Left },
    { teamIndex: 1, buildGridOrigin: wzBuildGridOrigin('right', 2), hutGridOrigin: wzHutGridOrigin('right', 2), defaultLane: Lane.Right },
    { teamIndex: 1, buildGridOrigin: wzBuildGridOrigin('right', 3), hutGridOrigin: wzHutGridOrigin('right', 3), defaultLane: Lane.Right },
  ],

  lanePaths: [
    // Team 0 (Left→Right)
    { left: [...WZ_LANE_TOP], right: [...WZ_LANE_BOT] },
    // Team 1 (Right→Left): reversed
    { left: [...WZ_LANE_TOP].reverse(), right: [...WZ_LANE_BOT].reverse() },
  ],

  diamondCenter: { x: WZ_DIAMOND_X, y: WZ_DIAMOND_Y },
  diamondHalfW: 12,
  diamondHalfH: 14,

  buildGridCols: WZ_BUILD_COLS,
  buildGridRows: WZ_BUILD_ROWS,
  hutGridCols: WZ_HUT_COLS,
  hutGridRows: WZ_HUT_ROWS,
  towerAlleyCols: WZ_ALLEY_COLS,
  towerAlleyRows: WZ_ALLEY_ROWS,

  nukeZone: [
    { min: 0, max: Math.round(WZ_W * 0.40) },
    { min: Math.round(WZ_W * 0.60), max: WZ_W },
  ],

  resourceYield: 2,

  resourceNodes: [
    { type: ResourceType.Wood, x: WZ_DIAMOND_X, y: 6 },
    { type: ResourceType.Meat, x: WZ_DIAMOND_X, y: WZ_H - 6 },
  ],

  isPlayable(x: number, y: number): boolean {
    if (x < 0 || x >= WZ_W || y < 0 || y >= WZ_H) return false;
    const margin = skGetMarginAtCol(x);
    return y >= margin && y < WZ_H - margin;
  },

  getPlayableRange(col: number): { min: number; max: number } {
    const margin = skGetMarginAtCol(col);
    return { min: margin, max: WZ_H - margin };
  },
};

// All available maps
export const ALL_MAPS: MapDef[] = [DUEL_MAP, SKIRMISH_MAP, WARZONE_MAP];

export function getMapById(id: string): MapDef {
  const map = ALL_MAPS.find(m => m.id === id);
  if (!map) throw new Error(`Unknown map: ${id}`);
  return map;
}
