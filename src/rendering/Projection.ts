import { TILE_SIZE } from '../simulation/types';

/** Isometric tile dimensions: standard 2:1 ratio */
export const ISO_TILE_W = TILE_SIZE;   // 64
export const ISO_TILE_H = TILE_SIZE / 2; // 32

// Pre-computed half-tile constants
const HW = ISO_TILE_W / 2;  // 32
const HH = ISO_TILE_H / 2;  // 16

/** Reusable output object for tileToPixel (avoids allocation in hot paths) */
const _tpOut = { px: 0, py: 0 };

/**
 * Convert tile coordinates to world-pixel coordinates.
 * In orthographic mode: simple multiplication.
 * In isometric mode: diamond projection.
 * WARNING: Returns a shared object — do not store the reference across calls.
 */
export function tileToPixel(tileX: number, tileY: number, isometric: boolean): { px: number; py: number } {
  if (!isometric) {
    _tpOut.px = tileX * TILE_SIZE;
    _tpOut.py = tileY * TILE_SIZE;
  } else {
    _tpOut.px = (tileX - tileY) * HW;
    _tpOut.py = (tileX + tileY) * HH;
  }
  return _tpOut;
}

/** Reusable output object for pixelToTile */
const _ptOut = { tileX: 0, tileY: 0 };

/**
 * Convert world-pixel coordinates back to tile coordinates.
 * WARNING: Returns a shared object — do not store the reference across calls.
 */
export function pixelToTile(px: number, py: number, isometric: boolean): { tileX: number; tileY: number } {
  if (!isometric) {
    _ptOut.tileX = px / TILE_SIZE;
    _ptOut.tileY = py / TILE_SIZE;
  } else {
    _ptOut.tileX = (px / HW + py / HH) / 2;
    _ptOut.tileY = (py / HH - px / HW) / 2;
  }
  return _ptOut;
}

/** Cached iso world bounds */
let _isoBoundsW = 0, _isoBoundsH = 0;
const _isoBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };

/**
 * Compute the world-pixel bounding box for an isometric map.
 * Results are cached — same inputs return the same (shared) object.
 */
export function isoWorldBounds(mapW: number, mapH: number): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } {
  if (mapW === _isoBoundsW && mapH === _isoBoundsH) return _isoBounds;
  _isoBoundsW = mapW;
  _isoBoundsH = mapH;

  // Four corners of the tile grid projected to pixel space
  const c0x = 0, c0y = 0;
  const c1x = mapW * HW, c1y = mapW * HH;
  const c2x = -mapH * HW, c2y = mapH * HH;
  const c3x = (mapW - mapH) * HW, c3y = (mapW + mapH) * HH;

  const minX = Math.min(c0x, c1x, c2x, c3x);
  const minY = Math.min(c0y, c1y, c2y, c3y);
  const maxX = Math.max(c0x, c1x, c2x, c3x);
  const maxY = Math.max(c0y, c1y, c2y, c3y);

  _isoBounds.minX = minX;
  _isoBounds.minY = minY;
  _isoBounds.maxX = maxX;
  _isoBounds.maxY = maxY;
  _isoBounds.width = maxX - minX;
  _isoBounds.height = maxY - minY;
  return _isoBounds;
}
