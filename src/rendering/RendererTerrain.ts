/**
 * RendererTerrain.ts — Terrain cache building, water animation, and resource node drawing.
 * Extracted from Renderer.ts. All functions are standalone and receive their dependencies as parameters.
 */

import { SpriteLoader, drawSpriteFrame, type SpriteDef } from './SpriteLoader';
import { Camera } from './Camera';
import {
  GameState, TILE_SIZE, Team,
  ResourceType,
  createSeededRng,
  ZONES, HQ_WIDTH, HQ_HEIGHT,
  type MapDef,
} from '../simulation/types';
import { getHQPosition } from '../simulation/GameState';
import { tileToPixel, isoArc } from './Projection';

const T = TILE_SIZE;

// Seeded random for deterministic decoration placement
const seededRand = createSeededRng;

export interface TerrainCacheResult {
  terrainCanvas: HTMLCanvasElement;
  waterCanvas: HTMLCanvasElement;
  waterEdges: { x: number; y: number; dirs: number }[];
}

/** Build the static terrain and water caches for 2D (non-isometric) rendering.
 *  Returns the two offscreen canvases and the water-edge tile list. */
export function buildTerrainCache(
  sprites: SpriteLoader,
  mapDef: MapDef,
  mapW: number,
  mapH: number,
): TerrainCacheResult | null {
  const tilemapData = sprites.getTerrainSprite('tilemap');
  if (!tilemapData) return null; // tilemap not loaded yet

  const [tilemap] = tilemapData;

  // Helper: is tile at (tx,ty) land (within the map shape)?
  const isLand = (tx: number, ty: number): boolean => {
    return mapDef.isPlayable(tx, ty);
  };

  // ---- Build static water cache (water bg + rocks + clouds) ----
  const wc = document.createElement('canvas');
  wc.width = mapW * T;
  wc.height = mapH * T;
  const wctx = wc.getContext('2d')!;

  const waterBgData = sprites.getTerrainSprite('waterBg');
  if (waterBgData) {
    const [waterImg] = waterBgData;
    for (let y = 0; y < wc.height; y += T) {
      for (let x = 0; x < wc.width; x += T) {
        wctx.drawImage(waterImg, x, y, T, T);
      }
    }
  } else {
    wctx.fillStyle = '#5b9a8b';
    wctx.fillRect(0, 0, wc.width, wc.height);
  }

  const rand = seededRand(42);
  const waterRock1Data = sprites.getTerrainSprite('waterRock1');
  const waterRock2Data = sprites.getTerrainSprite('waterRock2');
  if (waterRock1Data || waterRock2Data) {
    for (let i = 0; i < 20; i++) {
      // For landscape maps, scatter rocks in the margin areas
      const axisPos = mapDef.shapeAxis === 'x'
        ? Math.floor(rand() * mapW)  // iterate columns for landscape
        : Math.floor(rand() * mapH); // iterate rows for portrait
      const range = mapDef.getPlayableRange(axisPos);
      const marginSize = range.min; // margin at start
      const endMargin = (mapDef.shapeAxis === 'x' ? mapH : mapW) - range.max;
      const side = rand() < 0.5 ? 'left' : 'right';
      let x: number, y: number;
      if (mapDef.shapeAxis === 'x') {
        // Landscape: margins are top/bottom (y-axis), axisPos is x
        x = axisPos;
        if (side === 'left') {
          if (marginSize < 2) { rand(); continue; }
          y = Math.floor(rand() * marginSize);
        } else {
          if (endMargin < 2) { rand(); continue; }
          y = range.max + Math.floor(rand() * endMargin);
        }
      } else {
        // Portrait: margins are left/right (x-axis), axisPos is y
        y = axisPos;
        if (side === 'left') {
          if (marginSize < 2) { rand(); continue; }
          x = Math.floor(rand() * marginSize);
        } else {
          if (endMargin < 2) { rand(); continue; }
          x = range.max + Math.floor(rand() * endMargin);
        }
      }
      const rockData = (i % 2 === 0 && waterRock1Data) ? waterRock1Data : (waterRock2Data ?? waterRock1Data);
      if (!rockData) continue;
      const [rImg, rDef] = rockData;
      const frame = Math.floor(rand() * rDef.cols);
      const s = T * (1.5 + rand() * 1.0);
      const aspect = rDef.frameW / rDef.frameH;
      drawSpriteFrame(wctx, rImg, rDef, frame, x * T - s / 2, y * T - s * 0.5, s * aspect, s);
    }
  }

  const cloud1Data = sprites.getTerrainSprite('cloud1');
  const cloud2Data = sprites.getTerrainSprite('cloud2');
  const cloud3Data = sprites.getTerrainSprite('cloud3');
  const clouds = [cloud1Data, cloud2Data, cloud3Data].filter(Boolean) as [HTMLImageElement, SpriteDef][];
  if (clouds.length > 0) {
    for (let i = 0; i < 12; i++) {
      const axisPos2 = mapDef.shapeAxis === 'x'
        ? Math.floor(rand() * mapW)
        : Math.floor(rand() * mapH);
      const range2 = mapDef.getPlayableRange(axisPos2);
      const cMargin = range2.min;
      const cEndMargin = (mapDef.shapeAxis === 'x' ? mapH : mapW) - range2.max;
      const side = rand() < 0.5 ? 'left' : 'right';
      let x: number, y: number;
      if (mapDef.shapeAxis === 'x') {
        x = axisPos2;
        if (side === 'left') {
          if (cMargin < 3) { rand(); continue; }
          y = Math.floor(rand() * cMargin);
        } else {
          if (cEndMargin < 2) { rand(); continue; }
          y = range2.max + Math.floor(rand() * cEndMargin);
        }
      } else {
        y = axisPos2;
        if (side === 'left') {
          if (cMargin < 3) { rand(); continue; }
          x = Math.floor(rand() * cMargin);
        } else {
          if (cEndMargin < 2) { rand(); continue; }
          x = range2.max + Math.floor(rand() * cEndMargin);
        }
      }
      const [cImg, cDef] = clouds[Math.floor(rand() * clouds.length)];
      const cw = T * (4 + rand() * 3);
      const ch = cw * (cDef.frameH / cDef.frameW);
      wctx.globalAlpha = 0.5 + rand() * 0.3;
      wctx.drawImage(cImg, x * T - cw / 2, y * T - ch / 2, cw, ch);
    }
    wctx.globalAlpha = 1;
  }

  // Water depth: darken tiles far from land for sense of depth
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      if (isLand(x, y)) continue;
      // Find minimum distance to any land tile (cheap taxicab check)
      let minDist = 99;
      for (let d = 1; d <= 5; d++) {
        if (isLand(x - d, y) || isLand(x + d, y) || isLand(x, y - d) || isLand(x, y + d)) {
          minDist = d; break;
        }
      }
      if (minDist > 1) {
        // Shallow near coast (dist 2), deep far out (dist 5+)
        const depth = Math.min(1, (minDist - 1) / 4);
        wctx.fillStyle = `rgba(0,15,30,${(depth * 0.15).toFixed(3)})`;
        wctx.fillRect(x * T, y * T, T, T);
      }
    }
  }

  // ---- Build land terrain cache (cliff faces + grass + decorations) ----
  const tc = document.createElement('canvas');
  tc.width = mapW * T;
  tc.height = mapH * T;
  const tctx = tc.getContext('2d')!;

  // Tilemap source tile size
  const S = 64;

  // Pre-compute and store water edge tiles for per-frame foam animation
  const waterEdges: { x: number; y: number; dirs: number }[] = [];
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      if (isLand(x, y)) continue;
      const n = isLand(x, y - 1) ? 1 : 0;
      const s = isLand(x, y + 1) ? 2 : 0;
      const w = isLand(x - 1, y) ? 4 : 0;
      const e = isLand(x + 1, y) ? 8 : 0;
      const dirs = n | s | w | e;
      if (dirs) waterEdges.push({ x, y, dirs });
    }
  }

  // 1. Cliff faces (programmatic stone gradient below grass edges)
  for (const edge of waterEdges) {
    if (!(edge.dirs & 1)) continue; // only south-facing cliffs (land to north)
    const px = edge.x * T;
    const py = edge.y * T;
    // Stone cliff face gradient
    const grad = tctx.createLinearGradient(px, py, px, py + T);
    grad.addColorStop(0, '#6b8a7a');
    grad.addColorStop(0.3, '#5a7868');
    grad.addColorStop(1, '#4a6858');
    tctx.fillStyle = grad;
    tctx.fillRect(px, py, T, T);
    // Vertical stone line detail
    tctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let lx = 3; lx < T; lx += 5) {
      tctx.fillRect(px + lx, py, 1, T);
    }
  }
  // Second row of cliff (extends depth)
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      if (isLand(x, y)) continue;
      if (isLand(x, y - 1)) continue; // skip first row (already drawn above)
      if (!isLand(x, y - 2)) continue; // need land 2 rows up
      const px = x * T;
      const py = y * T;
      const grad = tctx.createLinearGradient(px, py, px, py + T);
      grad.addColorStop(0, '#4a6858');
      grad.addColorStop(1, '#3a5848');
      tctx.fillStyle = grad;
      tctx.fillRect(px, py, T, T);
      tctx.fillStyle = 'rgba(0,0,0,0.08)';
      for (let lx = 3; lx < T; lx += 5) {
        tctx.fillRect(px + lx, py, 1, T);
      }
    }
  }

  // 2. Autotiled grass with proper edge tiles + inner corners
  //    Uses all 5 tilemap color variants with noise-driven cluster selection
  const tilemap2Data = sprites.getTerrainSprite('tilemap2');
  const tilemap3Data = sprites.getTerrainSprite('tilemap3');
  const tilemap4Data = sprites.getTerrainSprite('tilemap4');
  const tilemap5Data = sprites.getTerrainSprite('tilemap5');
  const tilemapImgs: (HTMLImageElement | null)[] = [
    tilemap,
    tilemap2Data ? tilemap2Data[0] : null,
    tilemap3Data ? tilemap3Data[0] : null,
    tilemap4Data ? tilemap4Data[0] : null,
    tilemap5Data ? tilemap5Data[0] : null,
  ];

  // Simple 2D value noise for organic patch selection (deterministic)
  const noiseW = Math.ceil(mapW / 4) + 2;
  const noiseH = Math.ceil(mapH / 4) + 2;
  const noiseRand = seededRand(137);
  const noiseGrid: number[] = new Array(noiseW * noiseH);
  for (let i = 0; i < noiseGrid.length; i++) noiseGrid[i] = noiseRand();
  const sampleNoise = (tx: number, ty: number): number => {
    const fx = tx / 4, fy = ty / 4;
    const ix = Math.min(Math.floor(fx), noiseW - 2);
    const iy = Math.min(Math.floor(fy), noiseH - 2);
    const dx = fx - ix, dy = fy - iy;
    const a = noiseGrid[iy * noiseW + ix], b = noiseGrid[iy * noiseW + ix + 1];
    const c = noiseGrid[(iy + 1) * noiseW + ix], d = noiseGrid[(iy + 1) * noiseW + ix + 1];
    return a * (1 - dx) * (1 - dy) + b * dx * (1 - dy) + c * (1 - dx) * dy + d * dx * dy;
  };
  // Second noise layer at different frequency (needs its own grid for scale 6)
  const noise2W = Math.ceil(mapW / 6) + 2;
  const noise2H = Math.ceil(mapH / 6) + 2;
  const noiseRand2 = seededRand(293);
  const noiseGrid2: number[] = new Array(noise2W * noise2H);
  for (let i = 0; i < noiseGrid2.length; i++) noiseGrid2[i] = noiseRand2();
  const sampleNoise2 = (tx: number, ty: number): number => {
    const fx = tx / 6, fy = ty / 6;
    const ix = Math.min(Math.floor(fx), noise2W - 2);
    const iy = Math.min(Math.floor(fy), noise2H - 2);
    const dx = fx - ix, dy = fy - iy;
    const a = noiseGrid2[iy * noise2W + ix], b = noiseGrid2[iy * noise2W + ix + 1];
    const c = noiseGrid2[(iy + 1) * noise2W + ix], d = noiseGrid2[(iy + 1) * noise2W + ix + 1];
    return a * (1 - dx) * (1 - dy) + b * dx * (1 - dy) + c * (1 - dx) * dy + d * dx * dy;
  };

  // Pick tilemap variant based on combined noise (organic clusters)
  const pickTilemap = (tx: number, ty: number): HTMLImageElement => {
    const combined = sampleNoise(tx, ty) * 0.6 + sampleNoise2(tx, ty) * 0.4;
    if (combined < 0.30) return tilemapImgs[0]!;                     // color1 (30%)
    if (combined < 0.50) return tilemapImgs[1] ?? tilemapImgs[0]!;   // color2 (20%)
    if (combined < 0.68) return tilemapImgs[2] ?? tilemapImgs[0]!;   // color3 (18%)
    if (combined < 0.84) return tilemapImgs[3] ?? tilemapImgs[0]!;   // color4 (16%)
    return tilemapImgs[4] ?? tilemapImgs[0]!;                        // color5 (16%)
  };

  const OV = 3; // pixel overhang for edge tiles
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      if (!isLand(x, y)) continue;

      const n = isLand(x, y - 1);
      const s = isLand(x, y + 1);
      const e = isLand(x + 1, y);
      const w = isLand(x - 1, y);

      let gsx: number, gsy: number;
      let edge = true;

      if      (!n && !w) { gsx = 0;     gsy = 0; }      // TL corner
      else if (!n && !e) { gsx = 2 * S; gsy = 0; }      // TR corner
      else if (!s && !w) { gsx = 0;     gsy = 2 * S; }  // BL corner
      else if (!s && !e) { gsx = 2 * S; gsy = 2 * S; }  // BR corner
      else if (!n)       { gsx = S;     gsy = 0; }      // top edge
      else if (!s)       { gsx = S;     gsy = 2 * S; }  // bottom edge
      else if (!w)       { gsx = 0;     gsy = S; }      // left edge
      else if (!e)       { gsx = 2 * S; gsy = S; }      // right edge
      else               { gsx = S;     gsy = S; edge = false; } // center

      // Noise-driven tilemap variant for organic color clusters
      const srcImg = pickTilemap(x, y);

      if (edge) {
        tctx.drawImage(srcImg, gsx, gsy, S, S,
          x * T - OV, y * T - OV, T + OV * 2, T + OV * 2);
      } else {
        tctx.drawImage(srcImg, gsx, gsy, S, S, x * T, y * T, T, T);
      }
    }
  }

  // 2a. Inner corner tiles (concave notches where diagonal is missing but cardinals present)
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      if (!isLand(x, y)) continue;
      if (!isLand(x, y - 1) || !isLand(x, y + 1) || !isLand(x + 1, y) || !isLand(x - 1, y)) continue;

      const nw = isLand(x - 1, y - 1);
      const ne = isLand(x + 1, y - 1);
      const sw = isLand(x - 1, y + 1);
      const se = isLand(x + 1, y + 1);
      if (nw && ne && sw && se) continue; // no inner corners needed

      const px = x * T, py = y * T;
      const half = Math.ceil(T / 2);
      const HS = S / 2; // half source tile (32px)
      if (!nw) tctx.drawImage(tilemap, 320, 0, HS, HS, px - 1, py - 1, half + 2, half + 2);
      if (!ne) tctx.drawImage(tilemap, 384 + HS, 0, HS, HS, px + half - 1, py - 1, half + 2, half + 2);
      if (!sw) tctx.drawImage(tilemap, 320, S + HS, HS, HS, px - 1, py + half - 1, half + 2, half + 2);
      if (!se) tctx.drawImage(tilemap, 384 + HS, S + HS, HS, HS, px + half - 1, py + half - 1, half + 2, half + 2);
    }
  }

  // 2b. Low-frequency warm/cool color zones + per-tile noise
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      if (!isLand(x, y)) continue;
      const zoneVal = Math.sin(x * 0.25 + 1.7) * Math.sin(y * 0.19 + 0.3)
                    + Math.sin(x * 0.13 - y * 0.11 + 2.5) * 0.5;
      if (zoneVal > 0.3) {
        tctx.fillStyle = `rgba(255,230,140,${(0.025 * Math.min(1, (zoneVal - 0.3) / 0.7)).toFixed(4)})`;
        tctx.fillRect(x * T, y * T, T, T);
      } else if (zoneVal < -0.3) {
        tctx.fillStyle = `rgba(100,180,160,${(0.03 * Math.min(1, (-zoneVal - 0.3) / 0.7)).toFixed(4)})`;
        tctx.fillRect(x * T, y * T, T, T);
      }
      const h = ((Math.sin(x * 7.137 + y * 11.921) * 23421.631) % 1 + 1) % 1;
      if (h < 0.15) {
        tctx.fillStyle = 'rgba(0,0,0,0.04)';
        tctx.fillRect(x * T, y * T, T, T);
      } else if (h > 0.85) {
        tctx.fillStyle = 'rgba(255,255,200,0.03)';
        tctx.fillRect(x * T, y * T, T, T);
      }
    }
  }

  // 2c. Noise overlay for organic grain (breaks tile grid repetition)
  {
    const nCanvas = document.createElement('canvas');
    nCanvas.width = mapW * T;
    nCanvas.height = mapH * T;
    const nctx = nCanvas.getContext('2d')!;
    const imgData = nctx.createImageData(nCanvas.width, nCanvas.height);
    const pixels = imgData.data;
    const grainScale = 8;
    const gW = Math.ceil(nCanvas.width / grainScale) + 2;
    const gH = Math.ceil(nCanvas.height / grainScale) + 2;
    const grainRand = seededRand(571);
    const grain: number[] = new Array(gW * gH);
    for (let i = 0; i < grain.length; i++) grain[i] = grainRand();
    // Iterate tile-by-tile, skip water tiles entirely for performance
    for (let ty = 0; ty < mapH; ty++) {
      for (let tx = 0; tx < mapW; tx++) {
        if (!isLand(tx, ty)) continue;
        const tileX0 = tx * T, tileY0 = ty * T;
        for (let dy = 0; dy < T; dy++) {
          const py = tileY0 + dy;
          for (let dx = 0; dx < T; dx++) {
            const px = tileX0 + dx;
            const fx = px / grainScale, fy = py / grainScale;
            const ix = Math.min(Math.floor(fx), gW - 2);
            const iy = Math.min(Math.floor(fy), gH - 2);
            const ddx = fx - ix, ddy = fy - iy;
            const val = grain[iy * gW + ix] * (1 - ddx) * (1 - ddy)
                      + grain[iy * gW + ix + 1] * ddx * (1 - ddy)
                      + grain[(iy + 1) * gW + ix] * (1 - ddx) * ddy
                      + grain[(iy + 1) * gW + ix + 1] * ddx * ddy;
            const idx = (py * nCanvas.width + px) * 4;
            const gray = Math.floor(val * 255);
            pixels[idx] = gray;
            pixels[idx + 1] = gray;
            pixels[idx + 2] = gray;
            pixels[idx + 3] = 255;
          }
        }
      }
    }
    nctx.putImageData(imgData, 0, 0);
    tctx.save();
    tctx.globalCompositeOperation = 'overlay';
    tctx.globalAlpha = 0.06;
    tctx.drawImage(nCanvas, 0, 0);
    tctx.restore();
  }

  // 2d. Shadow sprites at south-facing cliff edges
  const shadowData = sprites.getTerrainSprite('shadow');
  if (shadowData) {
    const [shadowImg] = shadowData;
    tctx.save();
    tctx.globalAlpha = 0.3;
    for (const edge of waterEdges) {
      if (!(edge.dirs & 1)) continue; // only south-facing cliffs
      const landY = edge.y - 1;
      if (landY < 0 || !isLand(edge.x, landY)) continue;
      const px = edge.x * T;
      const py = landY * T;
      tctx.drawImage(shadowImg, px - T * 0.25, py + T * 0.35, T * 1.5, T * 1.1);
    }
    tctx.restore();
  }

  // 2e. Cliff-edge programmatic shadow + highlight (top-left light)
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      if (!isLand(x, y)) continue;
      const px = x * T;
      const py = y * T;
      if (!isLand(x, y + 1)) {
        const grad = tctx.createLinearGradient(px, py + T * 0.5, px, py + T);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,30,20,0.15)');
        tctx.fillStyle = grad;
        tctx.fillRect(px, py + T * 0.5, T, T * 0.5);
      }
      if (!isLand(x, y - 1)) {
        const grad = tctx.createLinearGradient(px, py, px, py + T * 0.4);
        grad.addColorStop(0, 'rgba(255,255,220,0.06)');
        grad.addColorStop(1, 'rgba(255,255,220,0)');
        tctx.fillStyle = grad;
        tctx.fillRect(px, py, T, T * 0.4);
      }
      if (!isLand(x - 1, y)) {
        const grad = tctx.createLinearGradient(px, py, px + T * 0.3, py);
        grad.addColorStop(0, 'rgba(255,255,220,0.04)');
        grad.addColorStop(1, 'rgba(255,255,220,0)');
        tctx.fillStyle = grad;
        tctx.fillRect(px, py, T * 0.3, T);
      }
    }
  }

  // 3. Subtle zone tinting over grass (team base areas)
  if (mapDef.shapeAxis === 'y') {
    const drawZoneTint = (startRow: number, endRow: number, color: string) => {
      tctx.fillStyle = color;
      for (let y = startRow; y < endRow; y++) {
        const range = mapDef.getPlayableRange(y);
        tctx.fillRect(range.min * T, y * T, (range.max - range.min) * T, T);
      }
    };
    drawZoneTint(ZONES.TOP_BASE.start, ZONES.TOP_BASE.end, 'rgba(200, 0, 0, 0.06)');
    drawZoneTint(ZONES.BOTTOM_BASE.start, ZONES.BOTTOM_BASE.end, 'rgba(0, 80, 200, 0.06)');
  } else {
    const baseDepth = 18;
    const teamColors = ['rgba(0, 80, 200, 0.06)', 'rgba(200, 0, 0, 0.06)'];
    const xRanges = [[0, baseDepth], [mapW - baseDepth, mapW]];
    for (let t = 0; t < 2; t++) {
      tctx.fillStyle = teamColors[t];
      for (let x = xRanges[t][0]; x < xRanges[t][1]; x++) {
        const range = mapDef.getPlayableRange(x);
        tctx.fillRect(x * T, range.min * T, T, (range.max - range.min) * T);
      }
    }
  }

  // Helper: distance to nearest water (cardinal, max 6)
  const distToWater = (tx: number, ty: number): number => {
    for (let d = 1; d <= 6; d++) {
      if (!isLand(tx - d, ty) || !isLand(tx + d, ty) || !isLand(tx, ty - d) || !isLand(tx, ty + d)) return d;
    }
    return 7;
  };

  // 4. Scatter bush decorations on grass (4 varieties, biased toward coastlines)
  const bushes = [
    sprites.getTerrainSprite('bush1'),
    sprites.getTerrainSprite('bush2'),
    sprites.getTerrainSprite('bush3'),
    sprites.getTerrainSprite('bush4'),
  ].filter(Boolean) as [HTMLImageElement, SpriteDef][];
  if (bushes.length > 0) {
    for (let i = 0; i < 70; i++) {
      const bx = Math.floor(rand() * mapW);
      const by = Math.floor(rand() * mapH);
      if (!mapDef.isPlayable(bx, by)) continue;
      if (!mapDef.isPlayable(bx - 2, by) || !mapDef.isPlayable(bx + 2, by)) continue;
      const dist = distToWater(bx, by);
      const placePct = dist <= 4 ? 0.8 : 0.3;
      if (rand() > placePct) continue;
      const [bImg, bDef] = bushes[Math.floor(rand() * bushes.length)];
      const frame = Math.floor(rand() * bDef.cols);
      const s = T * (1.0 + rand() * 0.6);
      const aspect = bDef.frameW / bDef.frameH;
      tctx.globalAlpha = 0.7 + rand() * 0.3;
      drawSpriteFrame(tctx, bImg, bDef, frame, bx * T - s / 2, by * T - s * 0.5, s * aspect, s);
    }
    tctx.globalAlpha = 1;
  }

  // 5. Scatter small land rocks on grass (biased toward coastlines)
  const rocks = [
    sprites.getTerrainSprite('rock2'),
    sprites.getTerrainSprite('rock3'),
    sprites.getTerrainSprite('rock4'),
  ].filter(Boolean) as [HTMLImageElement, SpriteDef][];
  if (rocks.length > 0) {
    for (let i = 0; i < 45; i++) {
      const rx = Math.floor(rand() * mapW);
      const ry = Math.floor(rand() * mapH);
      if (!mapDef.isPlayable(rx, ry)) continue;
      if (!mapDef.isPlayable(rx - 1, ry) || !mapDef.isPlayable(rx + 1, ry)) continue;
      const dist = distToWater(rx, ry);
      const placePct = dist <= 3 ? 0.7 : 0.25;
      if (rand() > placePct) continue;
      const [rImg] = rocks[Math.floor(rand() * rocks.length)];
      const s = T * (0.5 + rand() * 0.4);
      tctx.globalAlpha = 0.5 + rand() * 0.3;
      tctx.drawImage(rImg, rx * T - s / 2 + rand() * T * 0.3, ry * T - s / 2 + rand() * T * 0.3, s, s);
    }
    tctx.globalAlpha = 1;
  }

  // 6. Grass tufts and tiny flowers (noise-driven density zones)
  {
    const scatterRand = seededRand(839);
    const scatterCount = Math.floor(mapW * mapH * 0.012);
    for (let i = 0; i < scatterCount; i++) {
      const sx = Math.floor(scatterRand() * mapW);
      const sy = Math.floor(scatterRand() * mapH);
      if (!isLand(sx, sy)) continue;
      const dist = distToWater(sx, sy);
      if (dist <= 1) continue;

      const density = sampleNoise(sx, sy);
      // Keep scatter within the tile to avoid bleeding into water
      const tileMinX = sx * T, tileMaxX = (sx + 1) * T - 1;
      const tileMinY = sy * T, tileMaxY = (sy + 1) * T - 1;
      const px = tileMinX + scatterRand() * (T - 2) + 1;
      const py = tileMinY + scatterRand() * (T - 2) + 1;

      if (density > 0.55) {
        // Lush zone: tiny flower clusters (2-3 dots)
        const flowerColors = ['#e8c34a', '#d4726a', '#c4a0d4', '#e8e0a0', '#a8d4a0'];
        const color = flowerColors[Math.floor(scatterRand() * flowerColors.length)];
        tctx.fillStyle = color;
        tctx.globalAlpha = 0.5 + scatterRand() * 0.3;
        const count = 2 + Math.floor(scatterRand() * 2);
        for (let j = 0; j < count; j++) {
          const fx = Math.max(tileMinX, Math.min(tileMaxX, Math.floor(px + (scatterRand() - 0.5) * T * 0.4)));
          const fy = Math.max(tileMinY, Math.min(tileMaxY, Math.floor(py + (scatterRand() - 0.5) * T * 0.3)));
          tctx.fillRect(fx, fy, 1, 1);
        }
      } else if (density > 0.3) {
        // Medium zone: grass tufts (small dark-green lines)
        tctx.globalAlpha = 0.25 + scatterRand() * 0.2;
        const tufts = 2 + Math.floor(scatterRand() * 3);
        for (let j = 0; j < tufts; j++) {
          const gx = Math.max(tileMinX, Math.min(tileMaxX, Math.floor(px + (scatterRand() - 0.5) * T * 0.5)));
          const gy = Math.max(tileMinY, Math.min(tileMaxY - 1, Math.floor(py + (scatterRand() - 0.5) * T * 0.3)));
          tctx.fillStyle = `rgba(${40 + Math.floor(scatterRand() * 30)},${80 + Math.floor(scatterRand() * 40)},${30 + Math.floor(scatterRand() * 20)},1)`;
          tctx.fillRect(gx, gy, 1, 2);
        }
      } else if (scatterRand() < 0.3) {
        // Sparse zone: occasional dirt speck
        tctx.globalAlpha = 0.15 + scatterRand() * 0.1;
        tctx.fillStyle = '#8b7355';
        tctx.fillRect(Math.floor(px), Math.floor(py), 1, 1);
      }
    }
    tctx.globalAlpha = 1;
  }

  return { terrainCanvas: tc, waterCanvas: wc, waterEdges };
}

/** Draw animated water effects (shimmer + foam) on visible water tiles. */
export function drawWaterAnimation(
  ctx: CanvasRenderingContext2D,
  tick: number,
  camera: Camera,
  sprites: SpriteLoader,
  mapDef: MapDef,
  mapW: number,
  mapH: number,
  waterEdges: { x: number; y: number; dirs: number }[],
): void {
  // Visible tile range (camera-based culling)
  const invZoom = 1 / camera.zoom;
  const sx = Math.max(0, Math.floor(camera.x / T) - 1);
  const sy = Math.max(0, Math.floor(camera.y / T) - 1);
  const ex = Math.min(mapW, Math.ceil((camera.x + ctx.canvas.clientWidth * invZoom) / T) + 1);
  const ey = Math.min(mapH, Math.ceil((camera.y + ctx.canvas.clientHeight * invZoom) / T) + 1);

  // 1. Broad water wave bands (covers all visible water, cheap)
  const waveCount = 6;
  for (let i = 0; i < waveCount; i++) {
    const phase = tick * 0.03 + i * (Math.PI * 2 / waveCount);
    const bandY = ((Math.sin(phase) * 0.5 + 0.5) * mapH * T);
    const bandH = T * 3;
    const alpha = 0.025 + Math.sin(tick * 0.05 + i) * 0.015;
    if (alpha <= 0) continue;
    ctx.fillStyle = `rgba(180,240,255,${alpha.toFixed(3)})`;
    ctx.fillRect(0, bandY - bandH / 2, mapW * T, bandH);
  }

  // 1b. Specular highlights: drifting bright spots on open water
  for (let y = sy; y < ey; y++) {
    for (let x = sx; x < ex; x++) {
      if (mapDef.isPlayable(x, y)) continue;
      const nearShore = mapDef.isPlayable(x - 1, y) || mapDef.isPlayable(x + 1, y)
        || mapDef.isPlayable(x, y - 1) || mapDef.isPlayable(x, y + 1);
      if (nearShore) continue;
      const s1 = Math.sin(tick * 0.025 + x * 0.7 + y * 0.4);
      const s2 = Math.sin(tick * 0.018 - x * 0.3 + y * 0.65 + 1.5);
      const bright = s1 * s2;
      if (bright > 0.6) {
        const a = (bright - 0.6) * 0.2;
        ctx.fillStyle = `rgba(220,245,255,${a.toFixed(3)})`;
        ctx.fillRect(x * T + T * 0.2, y * T + T * 0.2, T * 0.6, T * 0.6);
      }
    }
  }

  // 2. Per-tile shimmer on water edge tiles
  for (const edge of waterEdges) {
    if (edge.x < sx || edge.x >= ex || edge.y < sy || edge.y >= ey) continue;
    const wave1 = Math.sin(tick * 0.07 + edge.x * 0.8 + edge.y * 0.5);
    const wave2 = Math.sin(tick * 0.04 - edge.x * 0.3 + edge.y * 0.9);
    const shimmer = wave1 * 0.04 + wave2 * 0.03;
    if (shimmer > 0) {
      ctx.fillStyle = `rgba(180,235,245,${shimmer.toFixed(3)})`;
    } else {
      ctx.fillStyle = `rgba(0,30,50,${(-shimmer).toFixed(3)})`;
    }
    ctx.fillRect(edge.x * T, edge.y * T, T, T);
  }

  // 2. Foam at land-water edges
  const foamData = sprites.getTerrainSprite('waterFoam');
  if (foamData) {
    const [foamImg, foamDef] = foamData;
    const totalFrames = foamDef.cols;
    const fw = foamDef.frameW;
    const fh = foamDef.frameH;

    ctx.globalAlpha = 0.45;
    for (const edge of waterEdges) {
      if (edge.x < sx || edge.x >= ex || edge.y < sy || edge.y >= ey) continue;
      const frame = Math.floor((tick * 0.12 + edge.x * 3.7 + edge.y * 2.3) % totalFrames);
      const srcX = frame * fw;

      const px = edge.x * T;
      const py = edge.y * T;
      const stripDepth = Math.ceil(T * 0.4);

      if (edge.dirs & 1) {
        ctx.drawImage(foamImg, srcX, 0, fw, fh * 0.3, px - 2, py - 1, T + 4, stripDepth);
      }
      if (edge.dirs & 2) {
        ctx.drawImage(foamImg, srcX, fh * 0.7, fw, fh * 0.3,
          px - 2, py + T - stripDepth + 1, T + 4, stripDepth);
      }
      if (edge.dirs & 4) {
        ctx.drawImage(foamImg, srcX, 0, fw * 0.3, fh, px - 1, py - 2, stripDepth, T + 4);
      }
      if (edge.dirs & 8) {
        ctx.drawImage(foamImg, srcX + fw * 0.7, 0, fw * 0.3, fh,
          px + T - stripDepth + 1, py - 2, stripDepth, T + 4);
      }
    }
    ctx.globalAlpha = 1;
  } else {
    // Programmatic foam fallback (white lines at edges)
    for (const edge of waterEdges) {
      if (edge.x < sx || edge.x >= ex || edge.y < sy || edge.y >= ey) continue;
      const px = edge.x * T;
      const py = edge.y * T;
      const foamAlpha = 0.12 + Math.sin(tick * 0.1 + edge.x * 1.5 + edge.y * 0.8) * 0.08;
      ctx.fillStyle = `rgba(200,240,250,${foamAlpha.toFixed(3)})`;
      if (edge.dirs & 1) ctx.fillRect(px, py, T, 3);
      if (edge.dirs & 2) ctx.fillRect(px, py + T - 3, T, 3);
      if (edge.dirs & 4) ctx.fillRect(px, py, 3, T);
      if (edge.dirs & 8) ctx.fillRect(px + T - 3, py, 3, T);
    }
  }
}

/** Draw resource nodes (wood forest, sheep herds, gold mines, potion drops, wood piles). */
export function drawResourceNodes(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  sprites: SpriteLoader,
  isometric: boolean,
  frameNow: number,
): void {
  const tp = (x: number, y: number) => tileToPixel(x, y, isometric);

  const drawNodeFallback = (x: number, y: number, label: string, color: string) => {
    const { px, py } = tp(x, y);
    ctx.beginPath();
    isoArc(ctx, px, py, T * 1.2, isometric);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = '#bbb';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, px, py + 4);
    ctx.textAlign = 'start';
  };

  const woodResData = sprites.getResourceSprite('woodResource');
  const drawWoodPile = (x: number, y: number, amount: number) => {
    const { px, py } = tp(x, y);
    const size = Math.min(1.0, 0.5 + amount * 0.05) * T;
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    ctx.beginPath();
    ctx.ellipse(px, py + size * 0.15, size * 0.5, size * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    if (woodResData) {
      const [img, def] = woodResData;
      drawSpriteFrame(ctx, img, def, 0, px - size * 0.5, py - size * 0.5, size, size);
    } else {
      ctx.fillStyle = '#8d5a35';
      ctx.beginPath();
      ctx.arc(px, py - size * 0.1, size * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  // Wood node
  const woodNode = state.mapDef.resourceNodes.find(n => n.type === ResourceType.Wood);
  const meatNode = state.mapDef.resourceNodes.find(n => n.type === ResourceType.Meat);
  const tree1Data = sprites.getResourceSprite('tree');
  const tree2Data = sprites.getResourceSprite('tree2');
  const tree3Data = sprites.getResourceSprite('tree3');
  if (tree1Data && woodNode) {
    const { px: cx, py: cy } = tp(woodNode.x, woodNode.y);
    const now = frameNow / 1000;
    const forestSeed = Math.floor(woodNode.x * 97 + woodNode.y * 131 + state.mapDef.width * 17);
    const rand = seededRand(forestSeed);
    const spritesList = [tree1Data, tree2Data ?? tree1Data, tree3Data ?? tree1Data];
    const anchors = [
      { ox: -5.8, oy: -2.0, size: 2.15, sprite: 1 },
      { ox: -3.9, oy: -2.5, size: 2.25, sprite: 2 },
      { ox: -1.7, oy: -2.7, size: 2.45, sprite: 0 },
      { ox: 0.5, oy: -2.5, size: 2.5, sprite: 1 },
      { ox: 2.8, oy: -2.3, size: 2.3, sprite: 2 },
      { ox: 5.1, oy: -1.8, size: 2.15, sprite: 0 },
      { ox: -6.2, oy: 0.4, size: 2.45, sprite: 2 },
      { ox: -3.7, oy: 0.1, size: 2.75, sprite: 0 },
      { ox: -1.0, oy: -0.1, size: 2.95, sprite: 1 },
      { ox: 1.8, oy: 0.0, size: 3.05, sprite: 0 },
      { ox: 4.5, oy: 0.3, size: 2.8, sprite: 2 },
      { ox: 6.8, oy: 0.7, size: 2.35, sprite: 1 },
      { ox: -4.7, oy: 2.3, size: 2.25, sprite: 1 },
      { ox: -1.9, oy: 2.5, size: 2.4, sprite: 2 },
      { ox: 1.0, oy: 2.6, size: 2.35, sprite: 1 },
      { ox: 4.0, oy: 2.3, size: 2.15, sprite: 0 },
    ].map(anchor => ({
      ...anchor,
      ox: anchor.ox + (rand() - 0.5) * 0.55,
      oy: anchor.oy + (rand() - 0.5) * 0.4,
    }));
    const drawTree = (data: [HTMLImageElement, { frameW: number; frameH: number; cols: number; url: string }], x: number, y: number, size: number, phase: number) => {
      const [img, def] = data;
      const aspect = def.frameW / def.frameH;
      const drawW = size * aspect;
      const drawH = size;
      const angle = Math.sin(now * 1.15 + phase) * 0.032;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      drawSpriteFrame(ctx, img, def, 0, -drawW / 2, -drawH * 0.84, drawW, drawH);
      ctx.restore();
    };

    // Per-tree shadows
    for (const anchor of anchors) {
      ctx.fillStyle = 'rgba(0,0,0,0.13)';
      ctx.beginPath();
      ctx.ellipse(
        cx + anchor.ox * T * 0.72,
        cy + anchor.oy * T * 0.48 + T * 0.42,
        anchor.size * T * 0.23,
        anchor.size * T * 0.1,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    // Interleave trees and wood piles by Y for proper depth
    const nearbyPiles = state.woodPiles
      .filter(pile => Math.hypot(pile.x - woodNode.x, pile.y - woodNode.y) < 8);
    type DrawItem = { sortY: number; draw: () => void };
    const items: DrawItem[] = [];
    for (const anchor of anchors) {
      const data = spritesList[anchor.sprite % spritesList.length];
      const ay = cy + anchor.oy * T * 0.48;
      items.push({ sortY: ay, draw: () => drawTree(
        data,
        cx + anchor.ox * T * 0.72,
        ay,
        anchor.size * T,
        anchor.sprite * 0.9 + anchor.ox * 0.2,
      )});
    }
    for (const pile of nearbyPiles) {
      items.push({ sortY: tp(pile.x, pile.y).py, draw: () => drawWoodPile(pile.x, pile.y, pile.amount) });
    }
    items.sort((a, b) => a.sortY - b.sortY);
    for (const item of items) item.draw();
  } else if (woodNode) {
    drawNodeFallback(woodNode.x, woodNode.y, 'WOOD', 'rgba(76, 175, 80, 0.2)');
    state.woodPiles
      .filter(pile => Math.hypot(pile.x - woodNode.x, pile.y - woodNode.y) < 8)
      .sort((a, b) => a.y - b.y)
      .forEach(pile => drawWoodPile(pile.x, pile.y, pile.amount));
  }

  // Meat node — herd of sheep
  const sheepData = sprites.getResourceSprite('sheep');
  const sheepGrassData = sprites.getResourceSprite('sheepGrass');
  if (sheepData && meatNode) {
    const { px: cx, py: cy } = tp(meatNode.x, meatNode.y);
    const drawSize = T * 1.8;
    const tick = Math.floor(frameNow / 200);
    const [img, def] = sheepData;
    const positions = [
      { x: cx - T * 2, y: cy - T * 1.2 },
      { x: cx + T * 1.5, y: cy - T * 1 },
      { x: cx - T * 0.5, y: cy + T * 0.3 },
      { x: cx + T * 2.5, y: cy + T * 0.5 },
      { x: cx - T * 2.5, y: cy + T * 0.8 },
    ];
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      const useGrass = sheepGrassData && (i % 2 === 1);
      const [sImg, sDef] = useGrass ? sheepGrassData! : [img, def];
      const frame = (tick + i * 2) % sDef.cols;
      drawSpriteFrame(ctx, sImg, sDef, frame, p.x - drawSize / 2, p.y - drawSize / 2, drawSize, drawSize);
    }
  } else if (meatNode) {
    drawNodeFallback(meatNode.x, meatNode.y, 'MEAT', 'rgba(158, 158, 158, 0.2)');
  }

  // Stray wood piles (dropped by killed/interrupted harvesters far from the forest)
  const strayPiles = woodNode
    ? state.woodPiles.filter(pile => Math.hypot(pile.x - woodNode.x, pile.y - woodNode.y) >= 8)
    : state.woodPiles;
  for (const pile of strayPiles) drawWoodPile(pile.x, pile.y, pile.amount);

  // Potion drops (Goblin Potion Shop)
  for (const potion of state.potionDrops) {
    const potionColor = potion.type === 'speed' ? 'blue' as const : potion.type === 'rage' ? 'red' as const : 'green' as const;
    const potionData = sprites.getPotionSprite(potionColor);
    if (!potionData) continue;
    const [pImg, pDef] = potionData;
    const potionSz = T * 0.9;
    const frame = Math.floor(frameNow / 150 + potion.id) % pDef.cols;
    const fsx = frame * pDef.frameW;

    if (potion.flightProgress < potion.flightTicks) {
      const t = potion.flightProgress / potion.flightTicks;
      const curX = potion.srcX + (potion.x - potion.srcX) * t;
      const curY = potion.srcY + (potion.y - potion.srcY) * t;
      const dist = Math.hypot(potion.x - potion.srcX, potion.y - potion.srcY);
      const arcHeight = dist * 0.6;
      const heightOffset = -arcHeight * 4 * t * (1 - t);
      const { px: fpx, py: fpy } = tp(curX, curY);
      const spin = t * Math.PI * 2;
      ctx.save();
      ctx.translate(fpx, fpy + heightOffset * T / 2);
      ctx.rotate(spin);
      ctx.drawImage(pImg, fsx, 0, pDef.frameW, pDef.frameH,
        -potionSz / 2, -potionSz / 2, potionSz, potionSz);
      ctx.restore();
    } else {
      const { px: ppx, py: ppy } = tp(potion.x, potion.y);
      const bob = Math.sin(frameNow / 400 + potion.id) * T * 0.06;
      const fadeAlpha = potion.remainingTicks < 60 ? potion.remainingTicks / 60 : 1;
      ctx.globalAlpha = fadeAlpha;
      ctx.drawImage(pImg, fsx, 0, pDef.frameW, pDef.frameH,
        ppx - potionSz / 2, ppy - potionSz + bob, potionSz, potionSz);
      ctx.globalAlpha = 1;
    }
  }

  // Gold nodes near HQs
  const goldData = sprites.getResourceSprite('goldResource');
  const bHQ = getHQPosition(Team.Bottom, state.mapDef);
  const tHQ = getHQPosition(Team.Top, state.mapDef);
  if (goldData) {
    const [img, def] = goldData;
    const drawSize = T * 5;
    let bx: number, by: number, tx: number, ty: number;
    if (state.mapDef.shapeAxis === 'x') {
      ({ px: bx, py: by } = tp(bHQ.x + HQ_WIDTH + 6, bHQ.y + HQ_HEIGHT / 2));
      ({ px: tx, py: ty } = tp(tHQ.x - 6, tHQ.y + HQ_HEIGHT / 2));
    } else {
      ({ px: bx, py: by } = tp(bHQ.x + HQ_WIDTH / 2, bHQ.y - 6));
      ({ px: tx, py: ty } = tp(tHQ.x + HQ_WIDTH / 2, tHQ.y + HQ_HEIGHT + 6));
    }
    drawSpriteFrame(ctx, img, def, 0, bx - drawSize / 2, by - drawSize / 2, drawSize, drawSize);
    drawSpriteFrame(ctx, img, def, 0, tx - drawSize / 2, ty - drawSize / 2, drawSize, drawSize);
  } else {
    const goldOffset = 6;
    if (state.mapDef.shapeAxis === 'x') {
      drawNodeFallback(bHQ.x + HQ_WIDTH + goldOffset, bHQ.y + HQ_HEIGHT / 2, 'GOLD', 'rgba(255, 215, 0, 0.2)');
      drawNodeFallback(tHQ.x - goldOffset, tHQ.y + HQ_HEIGHT / 2, 'GOLD', 'rgba(255, 215, 0, 0.2)');
    } else {
      drawNodeFallback(bHQ.x + HQ_WIDTH / 2, bHQ.y - goldOffset, 'GOLD', 'rgba(255, 215, 0, 0.2)');
      drawNodeFallback(tHQ.x + HQ_WIDTH / 2, tHQ.y + HQ_HEIGHT + goldOffset, 'GOLD', 'rgba(255, 215, 0, 0.2)');
    }
  }
}
