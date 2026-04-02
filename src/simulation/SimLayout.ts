/**
 * Map layout helpers: grid origins, HQ positions, lane paths, and choke points.
 *
 * Pure functions with no simulation state — safe to call from any module.
 * All functions accept an optional MapDef; when omitted they use legacy defaults.
 */
import {
  Team, Lane, MapDef, Vec2, ZONES, MAP_WIDTH,
  BUILD_GRID_COLS, BUILD_GRID_ROWS, HQ_WIDTH, HQ_HEIGHT,
  CROSS_BASE_MARGIN, CROSS_BASE_WIDTH, LANE_PATHS,
  DIAMOND_CENTER_X, DIAMOND_CENTER_Y,
  WOOD_NODE_X, MEAT_NODE_X, GoldCell, ResourceType,
  HarvesterAssignment, HarvesterState
} from './types';

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

/** Gold mine exclusion zone size (6×6 box centered on the mine tile). */
export const GOLD_MINE_EXCLUSION_HALF = 3;

/** Check if a tower alley grid cell is blocked by the gold mine exclusion zone.
 *  Only applies to landscape maps (shapeAxis 'x') where the gold mine sits inside the alley. */
export function isAlleyCellExcludedByGoldMine(gx: number, gy: number, team: Team, mapDef: MapDef): boolean {
  if (mapDef.shapeAxis !== 'x') return false;
  const origin = getTeamAlleyOrigin(team, mapDef);
  const goldPos = getBaseGoldPosition(team, mapDef);
  const mineGX = Math.round(goldPos.x - origin.x);
  const mineGY = Math.round(goldPos.y - origin.y);
  return gx >= mineGX - GOLD_MINE_EXCLUSION_HALF && gx < mineGX + GOLD_MINE_EXCLUSION_HALF &&
         gy >= mineGY - GOLD_MINE_EXCLUSION_HALF && gy < mineGY + GOLD_MINE_EXCLUSION_HALF;
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

export function getLanePath(team: Team, lane: Lane, mapDef?: MapDef): readonly Vec2[] {
  if (mapDef) {
    const paths = mapDef.lanePaths[team];
    return lane === Lane.Left ? paths.left : paths.right;
  }
  return team === Team.Bottom
    ? (lane === Lane.Left ? LANE_PATHS.bottom.left : LANE_PATHS.bottom.right)
    : (lane === Lane.Left ? LANE_PATHS.top.left : LANE_PATHS.top.right);
}

export function interpolatePath(path: readonly Vec2[], t: number): Vec2 {
  const ct = Math.max(0, Math.min(1, t));
  const segs = path.length - 1;
  const seg = ct * segs;
  const idx = Math.min(Math.floor(seg), segs - 1);
  const lt = seg - idx;
  const a = path[idx], b = path[idx + 1];
  return { x: a.x + (b.x - a.x) * lt, y: a.y + (b.y - a.y) * lt };
}

/** Find the normalized path progress (0-1) of the point on the path closest to (px, py). */
export function findNearestPathProgress(path: readonly Vec2[], px: number, py: number): number {
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

export function getPathLength(path: readonly Vec2[]): number {
  let len = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const dx = path[i + 1].x - path[i].x, dy = path[i + 1].y - path[i].y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

// Precomputed path lengths — cached per map on first access
const PATH_LENGTH_CACHE = new Map<string, Record<string, number>>();
export function getCachedPathLength(team: Team, lane: Lane, mapDef?: MapDef): number {
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
export function getChokePoints(mapDef?: MapDef): readonly Vec2[] {
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

export function getChokeSpreadMultiplier(x: number, y: number, mapDef?: MapDef): number {
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

export function buildDiamondCellMap(cells: GoldCell[]): Map<number, GoldCell> {
  const m = new Map<number, GoldCell>();
  for (const c of cells) m.set(c.tileX * 10000 + c.tileY, c);
  return m;
}

export function getBaseGoldPosition(team: Team, mapDef?: MapDef): { x: number; y: number } {
  const hq = getHQPosition(team, mapDef);
  if (mapDef?.shapeAxis === 'x') {
    return { x: team === Team.Bottom ? hq.x + HQ_WIDTH + 6 : hq.x - 6, y: hq.y + HQ_HEIGHT / 2 };
  }
  return { x: hq.x + HQ_WIDTH / 2, y: team === Team.Bottom ? hq.y - 6 : hq.y + HQ_HEIGHT + 6 };
}

export function getResourceNodePosition(h: HarvesterState, mapDef?: MapDef): { x: number; y: number } {
  const dc = mapDef?.diamondCenter ?? { x: DIAMOND_CENTER_X, y: DIAMOND_CENTER_Y };
  switch (h.assignment) {
    case HarvesterAssignment.BaseGold:
      return getBaseGoldPosition(h.team, mapDef);
    case HarvesterAssignment.Wood: {
      const node = mapDef?.resourceNodes.find(n => n.type === ResourceType.Wood);
      return node ? { x: node.x, y: node.y } : { x: WOOD_NODE_X, y: DIAMOND_CENTER_Y };
    }
    case HarvesterAssignment.Meat: {
      const node = mapDef?.resourceNodes.find(n => n.type === ResourceType.Meat);
      return node ? { x: node.x, y: node.y } : { x: MEAT_NODE_X, y: DIAMOND_CENTER_Y };
    }
    case HarvesterAssignment.Center:
      return { x: dc.x, y: dc.y };
    case HarvesterAssignment.Mana:
      // Handled inline in tickHarvesters before this function is reached
      return getBaseGoldPosition(h.team, mapDef);
  }
}
