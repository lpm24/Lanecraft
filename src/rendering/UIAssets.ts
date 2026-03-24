// UI sprite assets from Tiny Swords UI Elements pack
// Provides 9-slice panels, ribbons, swords, icons, buttons, bars
// IMPORTANT: Spritesheets use 64px transparent gaps between tiles.
// 448px images: tiles at [0,128] gap [192,64] gap [320,128]
// 320px images: tiles at [0,64] gap [128,64] gap [256,64]
// 192px Slots: single tile (no 9-slice), just stretch directly

// 9-slice panels
import bannerPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Banners/Banner.png?url';
import woodTablePng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Wood Table/WoodTable_Slots.png?url';
import specialPaperPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Papers/SpecialPaper.png?url';

// Ribbons & Swords (spritesheets)
import bigRibbonsPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Ribbons/BigRibbons.png?url';
import smallRibbonsPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Ribbons/SmallRibbons.png?url';
import swordsPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Swords/Swords.png?url';

// Buttons
import bigBlueBtnPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Buttons/BigBlueButton_Regular.png?url';
import bigBlueBtnPressedPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Buttons/BigBlueButton_Pressed.png?url';
import bigRedBtnPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Buttons/BigRedButton_Regular.png?url';
import bigRedBtnPressedPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Buttons/BigRedButton_Pressed.png?url';
import smallBlueRoundPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Buttons/SmallBlueRoundButton_Regular.png?url';
import smallRedRoundPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Buttons/SmallRedRoundButton_Regular.png?url';
import smallRedRoundPressedPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Buttons/SmallRedRoundButton_Pressed.png?url';

// Bars (320x64 base, 64x64 fill tile)
import bigBarBasePng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Bars/BigBar_Base.png?url';
import bigBarFillPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Bars/BigBar_Fill.png?url';

// Icons (64x64 each)
import iconWoodPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Icons/Icon_02.png?url';
import iconGoldPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Icons/Icon_03.png?url';
import iconMeatPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Icons/Icon_04.png?url';
import iconSwordPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Icons/Icon_05.png?url';
import iconShieldPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Icons/Icon_06.png?url';
import iconPlayPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Icons/Icon_07.png?url';
import iconClosePng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Icons/Icon_09.png?url';
import iconSettingsPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Icons/Icon_10.png?url';
import iconInfoPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Icons/Icon_11.png?url';
import iconMusicPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Icons/Icon_12.png?url';
import iconDiamondPng from '../assets/images/Treasure Hunters/Treasure Hunters/Pirate Treasure/Sprites/Blue Diamond/01.png?url';
import iconManaPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Icons/Mana.png?url';
import iconSoulsPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Icons/Souls.png?url';
import iconOozePng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Icons/Ooze.png?url';
import iconStarPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Icons/Star.png?url';
import iconResearchPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Icons/Research.png?url';
import iconNukePng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Icons/Nuke.png?url';
import iconDicePng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Icons/Dice.png?url';
import iconLeftArrowPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Icons/Left Arrow.png?url';
import iconRightArrowPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Icons/Right Arrow.png?url';

// Water background for scenes
import waterBgPng from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Tileset/Water Background color.png?url';

export type IconName = 'gold' | 'wood' | 'meat' | 'sword' | 'shield' | 'play' | 'close' | 'settings' | 'info' | 'music' | 'diamond' | 'mana' | 'souls' | 'ooze' | 'star' | 'research' | 'nuke' | 'dice' | 'leftArrow' | 'rightArrow';
export type RibbonColor = 0 | 1 | 2 | 3 | 4; // blue, red, yellow, purple, dark
export type SwordColor = 0 | 1 | 2 | 3 | 4;

const ICON_URLS: Record<IconName, string> = {
  gold: iconGoldPng,
  wood: iconWoodPng,
  meat: iconMeatPng,
  sword: iconSwordPng,
  shield: iconShieldPng,
  play: iconPlayPng,
  close: iconClosePng,
  settings: iconSettingsPng,
  info: iconInfoPng,
  music: iconMusicPng,
  diamond: iconDiamondPng,
  mana: iconManaPng,
  souls: iconSoulsPng,
  ooze: iconOozePng,
  star: iconStarPng,
  research: iconResearchPng,
  nuke: iconNukePng,
  dice: iconDicePng,
  leftArrow: iconLeftArrowPng,
  rightArrow: iconRightArrowPng,
};

// Source tile positions for spritesheets with 64px gaps between tiles
// [x, width] for each of the 3 columns/rows
type TileStrip = [number, number, number, number, number, number]; // x0,w0, x1,w1, x2,w2

// 448px: tiles at 0(128), 192(64), 320(128) — with 64px gaps at 128-191 and 256-319
const STRIP_448: TileStrip = [0, 128, 192, 64, 320, 128];
// 320px: tiles at 0(64), 128(64), 256(64) — with 64px gaps at 64-127 and 192-255
const STRIP_320: TileStrip = [0, 64, 128, 64, 256, 64];

export class UIAssets {
  private cache = new Map<string, HTMLImageElement>();
  private loading = new Set<string>();

  private loadImage(url: string): HTMLImageElement | null {
    if (this.cache.has(url)) return this.cache.get(url)!;
    if (this.loading.has(url)) return null;
    this.loading.add(url);
    const img = new Image();
    img.src = url;
    img.onload = () => { this.cache.set(url, img); this.loading.delete(url); };
    img.onerror = () => { this.loading.delete(url); };
    return null;
  }

  /** Kick off loading all UI assets. Returns a promise that resolves when every image is ready. */
  preload(): Promise<void> {
    const urls = [
      bannerPng, woodTablePng, specialPaperPng,
      bigRibbonsPng, smallRibbonsPng, swordsPng,
      bigBlueBtnPng, bigBlueBtnPressedPng, bigRedBtnPng, bigRedBtnPressedPng,
      smallBlueRoundPng, smallRedRoundPng, smallRedRoundPressedPng,
      bigBarBasePng, bigBarFillPng, waterBgPng,
      ...Object.values(ICON_URLS),
    ];
    const promises = urls.map(url => {
      if (this.cache.has(url)) return Promise.resolve();
      return new Promise<void>((resolve) => {
        if (this.loading.has(url)) {
          // Already started — poll until done
          const check = () => {
            if (this.cache.has(url) || !this.loading.has(url)) resolve();
            else setTimeout(check, 16);
          };
          check();
          return;
        }
        this.loading.add(url);
        const img = new Image();
        img.src = url;
        img.onload = () => { this.cache.set(url, img); this.loading.delete(url); resolve(); };
        img.onerror = () => { this.loading.delete(url); resolve(); }; // resolve anyway so we don't block forever
      });
    });
    return Promise.all(promises).then(() => {});
  }

  // =================================================================
  // 9-Slice Panel Drawing (with gap-aware source coordinates)
  // =================================================================

  private drawNineSlice(
    ctx: CanvasRenderingContext2D, img: HTMLImageElement,
    cols: TileStrip, rows: TileStrip,
    x: number, y: number, w: number, h: number,
  ): void {
    // Round all inputs to avoid sub-pixel seams
    x = Math.round(x); y = Math.round(y);
    w = Math.round(w); h = Math.round(h);

    const [sx0, sw0, sx1, sw1, sx2, sw2] = cols;
    const [sy0, sh0, sy1, sh1, sy2, sh2] = rows;

    const dw0 = Math.round(Math.min(sw0, w * 0.4));
    const dw2 = Math.round(Math.min(sw2, w * 0.4));
    const dw1 = w - dw0 - dw2;
    const dh0 = Math.round(Math.min(sh0, h * 0.4));
    const dh2 = Math.round(Math.min(sh2, h * 0.4));
    const dh1 = h - dh0 - dh2;

    const dx1 = x + dw0, dx2 = x + w - dw2;
    const dy1 = y + dh0, dy2 = y + h - dh2;

    // Overlap by 1px to prevent sub-pixel seams from showing background
    const o = 1;
    // Top row
    ctx.drawImage(img, sx0, sy0, sw0, sh0, x, y, dw0 + o, dh0 + o);
    ctx.drawImage(img, sx1, sy0, sw1, sh0, dx1, y, dw1 + o, dh0 + o);
    ctx.drawImage(img, sx2, sy0, sw2, sh0, dx2, y, dw2, dh0 + o);
    // Middle row
    ctx.drawImage(img, sx0, sy1, sw0, sh1, x, dy1, dw0 + o, dh1 + o);
    ctx.drawImage(img, sx1, sy1, sw1, sh1, dx1, dy1, dw1 + o, dh1 + o);
    ctx.drawImage(img, sx2, sy1, sw2, sh1, dx2, dy1, dw2, dh1 + o);
    // Bottom row
    ctx.drawImage(img, sx0, sy2, sw0, sh2, x, dy2, dw0 + o, dh2);
    ctx.drawImage(img, sx1, sy2, sw1, sh2, dx1, dy2, dw1 + o, dh2);
    ctx.drawImage(img, sx2, sy2, sw2, sh2, dx2, dy2, dw2, dh2);
  }

  // Banner: 448x448 9-slice
  drawBanner(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): boolean {
    const img = this.loadImage(bannerPng);
    if (!img) return false;
    this.drawNineSlice(ctx, img, STRIP_448, STRIP_448, x, y, w, h);
    return true;
  }

  // WoodTable_Slots: 192x192 single tile — just stretch it
  drawWoodTable(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): boolean {
    const img = this.loadImage(woodTablePng);
    if (!img) return false;
    ctx.drawImage(img, x, y, w, h);
    return true;
  }

  // SpecialPaper: 320x320 9-slice
  drawSpecialPaper(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): boolean {
    const img = this.loadImage(specialPaperPng);
    if (!img) return false;
    this.drawNineSlice(ctx, img, STRIP_320, STRIP_320, x, y, w, h);
    return true;
  }

  // =================================================================
  // 3-Part Horizontal Stretch (Ribbons, Swords, Bars)
  // =================================================================

  private drawThreePartH(
    ctx: CanvasRenderingContext2D, img: HTMLImageElement,
    cols: TileStrip, srcY: number, srcH: number,
    x: number, y: number, w: number, h: number,
  ): void {
    x = Math.round(x); y = Math.round(y);
    w = Math.round(w); h = Math.round(h);

    const [sx0, sw0, sx1, sw1, sx2, sw2] = cols;

    const scale = h / srcH;
    const drawnLeftW = Math.round(Math.min(sw0 * scale, w * 0.35));
    const drawnRightW = Math.round(Math.min(sw2 * scale, w * 0.35));
    const drawnCenterW = w - drawnLeftW - drawnRightW;

    // Overlap by 1px to prevent sub-pixel seams from showing background
    ctx.drawImage(img, sx0, srcY, sw0, srcH, x, y, drawnLeftW + 1, h);
    ctx.drawImage(img, sx1, srcY, sw1, srcH, x + drawnLeftW, y, drawnCenterW + 1, h);
    ctx.drawImage(img, sx2, srcY, sw2, srcH, x + w - drawnRightW, y, drawnRightW, h);
  }

  // BigRibbons: 448x640, 5 rows of 128px
  drawBigRibbon(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: RibbonColor = 0): boolean {
    const img = this.loadImage(bigRibbonsPng);
    if (!img) return false;
    this.drawThreePartH(ctx, img, STRIP_448, color * 128, 128, x, y, w, h);
    return true;
  }

  // SmallRibbons: 320x640, 10 rows of 64px (2 per color: normal + pressed)
  drawSmallRibbon(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: RibbonColor = 0): boolean {
    const img = this.loadImage(smallRibbonsPng);
    if (!img) return false;
    this.drawThreePartH(ctx, img, STRIP_320, color * 2 * 64, 64, x, y, w, h);
    return true;
  }

  // Swords: 448x640, 5 rows of 128px
  // reveal: 0→1 slides the sword from the left edge to its final x position.
  // Returns the x offset applied (0 when fully revealed), so callers can shift labels to match.
  drawSword(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: SwordColor = 0, reveal = 1): number {
    const img = this.loadImage(swordsPng);
    if (!img) return 0;
    if (reveal <= 0) return -(x + w);
    if (reveal >= 1) {
      this.drawThreePartH(ctx, img, STRIP_448, color * 128, 128, x, y, w, h);
      return 0;
    }
    // Ease-out quart for snappy deceleration with a satisfying stop
    const t = 1 - Math.pow(1 - reveal, 4);
    // Slide from off-screen left (-w) to final position (x)
    const drawX = -w + (x + w) * t;
    const offsetX = drawX - x;
    // Fade in quickly during the first half of the slide
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = prevAlpha * Math.min(1, reveal / 0.6);
    this.drawThreePartH(ctx, img, STRIP_448, color * 128, 128, drawX, y, w, h);
    ctx.globalAlpha = prevAlpha;
    return offsetX;
  }

  /** Compute staggered reveal progress for button at `index`. */
  static swordReveal(elapsedMs: number, index: number, durationMs = 250, staggerMs = 60): number {
    const delay = index * staggerMs;
    return Math.max(0, Math.min(1, (elapsedMs - delay) / durationMs));
  }

  // =================================================================
  // Bars (3-part horizontal: 320x64 base, 64x64 fill tile)
  // =================================================================

  drawBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fillPct: number): boolean {
    const base = this.loadImage(bigBarBasePng);
    const fill = this.loadImage(bigBarFillPng);
    if (!base || !fill) return false;

    // Draw base as 3-part horizontal stretch
    this.drawThreePartH(ctx, base, STRIP_320, 0, 64, x, y, w, h);

    // Draw fill within the center region
    const pct = Math.max(0, Math.min(1, fillPct));
    if (pct > 0) {
      const scale = h / 64;
      const capW = Math.min(Math.floor(64 * scale), Math.floor(w * 0.35));
      const innerW = w - 2 * capW;
      const padY = h * 0.2;
      const fillW = innerW * pct;
      ctx.drawImage(fill, x + capW, y + padY, fillW, h - padY * 2);
    }
    return true;
  }

  // =================================================================
  // Icons (64x64 individual images)
  // =================================================================

  drawIcon(ctx: CanvasRenderingContext2D, name: IconName, x: number, y: number, size: number): boolean {
    const url = ICON_URLS[name];
    if (!url) return false;
    const img = this.loadImage(url);
    if (!img) return false;
    ctx.drawImage(img, x, y, size, size);
    return true;
  }

  getIconImage(name: IconName): HTMLImageElement | null {
    return this.loadImage(ICON_URLS[name]);
  }

  // =================================================================
  // Buttons
  // =================================================================

  drawBigBlueButton(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, pressed = false): boolean {
    const img = this.loadImage(pressed ? bigBlueBtnPressedPng : bigBlueBtnPng);
    if (!img) return false;
    this.drawNineSlice(ctx, img, STRIP_320, STRIP_320, x, y, w, h);
    return true;
  }

  drawBigRedButton(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, pressed = false): boolean {
    const img = this.loadImage(pressed ? bigRedBtnPressedPng : bigRedBtnPng);
    if (!img) return false;
    this.drawNineSlice(ctx, img, STRIP_320, STRIP_320, x, y, w, h);
    return true;
  }

  drawSmallBlueRoundButton(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): boolean {
    const img = this.loadImage(smallBlueRoundPng);
    if (!img) return false;
    ctx.drawImage(img, x, y, size, size);
    return true;
  }

  drawSmallRedRoundButton(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, pressed = false): boolean {
    const img = this.loadImage(pressed ? smallRedRoundPressedPng : smallRedRoundPng);
    if (!img) return false;
    ctx.drawImage(img, x, y, size, size);
    return true;
  }

  // =================================================================
  // Water Background Tiling
  // =================================================================

  drawWaterBg(ctx: CanvasRenderingContext2D, w: number, h: number, _time = 0): boolean {
    const img = this.loadImage(waterBgPng);
    if (!img) return false;
    const tileSize = 64;
    for (let ty = 0; ty < h; ty += tileSize) {
      for (let tx = 0; tx < w; tx += tileSize) {
        ctx.drawImage(img, tx, ty, tileSize, tileSize);
      }
    }
    return true;
  }
}
