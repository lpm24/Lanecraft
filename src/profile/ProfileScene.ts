import { Scene, SceneManager } from '../scenes/Scene';
import { UIAssets } from '../rendering/UIAssets';
import { SpriteLoader, drawSpriteFrame, getSpriteFrame } from '../rendering/SpriteLoader';
import { Race, BuildingType } from '../simulation/types';
import { RACE_COLORS, RACE_LABELS as _RACE_LABELS_UPPER, UNIT_STATS, UPGRADE_TREES } from '../simulation/data';
import {
  PlayerProfile, loadProfile, saveProfile,
  ACHIEVEMENTS, ALL_AVATARS,
  isAvatarUnlocked, getWinRate, formatTime,
} from './ProfileData';
import { getSafeTop } from '../ui/SafeArea';
import { randomName, loadPlayerName, savePlayerName } from '../scenes/TitlePlayerName';
import { SoundManager } from '../audio/SoundManager';

const ALL_RACES: Race[] = [
  Race.Crown, Race.Horde, Race.Goblins, Race.Oozlings, Race.Demon,
  Race.Deep, Race.Wild, Race.Geists, Race.Tenders,
];
// Title-case labels derived from shared uppercase constants
const RACE_LABELS: Record<Race, string> = Object.fromEntries(
  Object.entries(_RACE_LABELS_UPPER).map(([k, v]) => [k, v.charAt(0) + v.slice(1).toLowerCase()])
) as Record<Race, string>;

const CAT_TO_BUILDING: Record<string, BuildingType> = {
  melee: BuildingType.MeleeSpawner,
  ranged: BuildingType.RangedSpawner,
  caster: BuildingType.CasterSpawner,
};

function getAvatarUnitName(race: Race, category: string, upgradeNode?: string): string {
  const bt = CAT_TO_BUILDING[category];
  if (upgradeNode) {
    const tree = UPGRADE_TREES[race]?.[bt] as Record<string, any> | undefined;
    if (tree?.[upgradeNode]) return tree[upgradeNode].name;
  }
  return UNIT_STATS[race]?.[bt]?.name ?? `${race} ${category}`;
}

type Tab = 'stats' | 'achievements' | 'avatars';

export class ProfileScene implements Scene {
  private manager: SceneManager;
  private canvas: HTMLCanvasElement;
  private ui: UIAssets;
  private sprites: SpriteLoader;
  private profile!: PlayerProfile;
  private playerName = '';
  private diceBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  private tab: Tab = 'stats';
  private scrollY = 0;
  private maxScrollY = 0;
  private animTime = 0;

  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private touchHandler: ((e: TouchEvent) => void) | null = null;
  private touchEndHandler: ((e: TouchEvent) => void) | null = null;
  private wheelHandler: ((e: WheelEvent) => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private touchLastY = 0;
  private touchStartY = 0;
  private touchDragged = false;
  private enterTime = 0;
  private scrollVelocity = 0;
  private overscroll = 0; // positive = past bottom, negative = past top
  private sfx = new SoundManager();

  constructor(manager: SceneManager, canvas: HTMLCanvasElement, ui: UIAssets, sprites: SpriteLoader) {
    this.manager = manager;
    this.canvas = canvas;
    this.ui = ui;
    this.sprites = sprites;
  }

  enter(): void {
    this.profile = loadProfile();
    this.playerName = loadPlayerName();
    this.scrollY = 0;
    this.scrollVelocity = 0;
    this.overscroll = 0;
    this.tab = 'stats';
    this.enterTime = Date.now();

    let lastTouchTime = 0;
    this.clickHandler = (e: MouseEvent) => {
      if (Date.now() - lastTouchTime < 300) return;
      const rect = this.canvas.getBoundingClientRect();
      this.handleClick(e.clientX - rect.left, e.clientY - rect.top);
    };
    let touchTime = 0;
    let prevTouchY = 0;
    this.touchHandler = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      if (e.type === 'touchstart') {
        this.touchLastY = touch.clientY;
        this.touchStartY = touch.clientY;
        this.touchDragged = false;
        this.scrollVelocity = 0; // stop momentum on new touch
        prevTouchY = touch.clientY;
        touchTime = Date.now();
      } else if (e.type === 'touchmove') {
        e.preventDefault();
        const dy = this.touchLastY - touch.clientY;
        this.touchLastY = touch.clientY;

        // Track velocity from recent movement
        const now = Date.now();
        const dt = now - touchTime;
        if (dt > 0) {
          this.scrollVelocity = (prevTouchY - touch.clientY) / dt * 16; // px per frame
          prevTouchY = touch.clientY;
          touchTime = now;
        }

        // Allow overscroll with rubber-band resistance
        const newScroll = this.scrollY + dy * 1.3; // 1.3x multiplier for more responsive feel
        if (newScroll < 0) {
          this.overscroll = newScroll * 0.4; // rubber band at top
          this.scrollY = 0;
        } else if (newScroll > this.maxScrollY) {
          this.overscroll = (newScroll - this.maxScrollY) * 0.4; // rubber band at bottom
          this.scrollY = this.maxScrollY;
        } else {
          this.overscroll = 0;
          this.scrollY = newScroll;
        }

        if (Math.abs(touch.clientY - this.touchStartY) > 8) this.touchDragged = true;
      }
    };
    this.touchEndHandler = (e: TouchEvent) => {
      if (!this.touchDragged) {
        // Ignore touchend from the same gesture that opened this scene
        if (Date.now() - this.enterTime < 300) return;
        lastTouchTime = Date.now();
        const t = e.changedTouches[0];
        if (!t) return;
        const rect = this.canvas.getBoundingClientRect();
        this.handleClick(t.clientX - rect.left, t.clientY - rect.top);
      }
      // If overscrolled, velocity should be zero (bounce back handles it)
      if (this.overscroll !== 0) this.scrollVelocity = 0;
    };
    this.wheelHandler = (e: WheelEvent) => {
      this.scrollY = Math.max(0, Math.min(this.maxScrollY, this.scrollY + e.deltaY * 0.5));
    };
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.sfx.playUIBack();
        this.manager.switchTo('title');
      }
    };

    this.canvas.addEventListener('click', this.clickHandler);
    this.canvas.addEventListener('touchstart', this.touchHandler, { passive: false });
    this.canvas.addEventListener('touchmove', this.touchHandler, { passive: false });
    this.canvas.addEventListener('touchend', this.touchEndHandler, { passive: false });
    this.canvas.addEventListener('wheel', this.wheelHandler, { passive: true });
    window.addEventListener('keydown', this.keyHandler);
    this.sfx.enableTabSuspend();
  }

  exit(): void {
    if (this.clickHandler) this.canvas.removeEventListener('click', this.clickHandler);
    if (this.touchHandler) {
      this.canvas.removeEventListener('touchstart', this.touchHandler);
      this.canvas.removeEventListener('touchmove', this.touchHandler);
    }
    if (this.touchEndHandler) this.canvas.removeEventListener('touchend', this.touchEndHandler);
    if (this.wheelHandler) this.canvas.removeEventListener('wheel', this.wheelHandler);
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    this.sfx.disableTabSuspend();
    this.clickHandler = null; this.touchHandler = null; this.touchEndHandler = null;
    this.wheelHandler = null; this.keyHandler = null;
  }

  update(dt: number): void {
    this.animTime += dt;

    // Bounce back from overscroll
    if (this.overscroll !== 0) {
      this.overscroll *= 0.85; // spring back
      if (Math.abs(this.overscroll) < 0.5) this.overscroll = 0;
    }

    // Momentum scrolling (only when not touching)
    if (Math.abs(this.scrollVelocity) > 0.3) {
      const newScroll = this.scrollY + this.scrollVelocity;
      if (newScroll < 0) {
        this.overscroll = newScroll * 0.3;
        this.scrollY = 0;
        this.scrollVelocity = 0;
      } else if (newScroll > this.maxScrollY) {
        this.overscroll = (newScroll - this.maxScrollY) * 0.3;
        this.scrollY = this.maxScrollY;
        this.scrollVelocity = 0;
      } else {
        this.scrollY = newScroll;
      }
      this.scrollVelocity *= 0.95; // friction
    } else {
      this.scrollVelocity = 0;
    }
  }

  // ─── Simple panel background (dark rounded rect) ───

  private drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    ctx.fillStyle = 'rgba(40, 30, 25, 0.75)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.stroke();
  }

  // ─── Layout ───

  private getLayout() {
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    const compact = W < 600;
    const s = compact ? W / 600 : 1; // scale factor for mobile
    const st = getSafeTop();
    const headerH = Math.round(compact ? 120 * s + 40 : 180) + st;
    const tabBarY = Math.round(compact ? 52 * s + 16 : 84) + st;
    const tabH = Math.round(compact ? 36 * s + 8 : 60);
    return { W, H, headerH, tabBarY, tabH, compact, s };
  }

  // ─── Click handling ───

  private handleClick(cx: number, cy: number): void {
    const { W, tabBarY, tabH, headerH, compact } = this.getLayout();

    // Back button (top-left)
    const backSize = compact ? 36 : 64;
    const st = getSafeTop();
    if (cy < backSize + 10 + st && cy > st && cx < backSize + 12) {
      this.sfx.playUIBack();
      this.manager.switchTo('title');
      return;
    }

    // Dice button (reroll name) — only active on stats tab
    const d = this.diceBtnRect;
    if (this.tab === 'stats' && cy > headerH &&
        cx >= d.x && cx <= d.x + d.w && cy >= d.y && cy <= d.y + d.h) {
      this.playerName = randomName();
      savePlayerName(this.playerName);
      this.sfx.playUIClick();
      return;
    }

    // Tab bar
    if (cy >= tabBarY && cy <= tabBarY + tabH) {
      const tabs: Tab[] = ['stats', 'achievements', 'avatars'];
      const gap = compact ? 4 : 12;
      const tabW = Math.min(200, (W - (compact ? 20 : 160) - gap * 2) / 3);
      const totalW = tabW * 3 + gap * 2;
      const startX = (W - totalW) / 2;
      for (let i = 0; i < tabs.length; i++) {
        const tx = startX + i * (tabW + gap);
        if (cx >= tx && cx <= tx + tabW) {
          if (this.tab !== tabs[i]) this.sfx.playUITab();
          this.tab = tabs[i];
          this.scrollY = 0;
          this.scrollVelocity = 0;
          this.overscroll = 0;
          return;
        }
      }
    }

    // Avatar selection
    if (this.tab === 'avatars' && cy > headerH) {
      this.handleAvatarClick(cx, cy);
    }
  }

  private handleAvatarClick(cx: number, cy: number): void {
    const { W, headerH, compact } = this.getLayout();
    const pad = compact ? 8 : 28;
    const panelW = W - pad * 2;
    const maxCellPx = compact ? 90 : 160;
    const cols = Math.max(3, Math.floor((panelW - (compact ? 12 : 40)) / maxCellPx));
    const cellSize = Math.floor((panelW - (compact ? 12 : 40)) / cols);
    const startX = pad + (compact ? 6 : 20);
    const startY = headerH + (compact ? 12 : 28) - this.scrollY;

    for (let i = 0; i < ALL_AVATARS.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const ax = startX + col * cellSize;
      const ay = startY + row * cellSize;

      if (cx >= ax && cx < ax + cellSize && cy >= ay && cy < ay + cellSize) {
        const avatar = ALL_AVATARS[i];
        if (isAvatarUnlocked(this.profile, avatar)) {
          if (this.profile.avatarId !== avatar.id) this.sfx.playUIConfirm();
          this.profile.avatarId = avatar.id;
          saveProfile(this.profile);
        }
        return;
      }
    }
  }

  // ─── Main Render ───

  render(ctx: CanvasRenderingContext2D): void {
    const { W, H, headerH, tabBarY, tabH, compact } = this.getLayout();

    // Water background
    if (!this.ui.drawWaterBg(ctx, W, H, this.animTime * 0.001)) {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, W, H);
    }

    // Content area (clipped, scrollable)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, headerH, W, H - headerH);
    ctx.clip();

    // Apply overscroll offset for bounce effect
    const savedScrollY = this.scrollY;
    this.scrollY -= this.overscroll;

    if (this.tab === 'stats') this.renderStats(ctx, W, H, headerH);
    else if (this.tab === 'achievements') this.renderAchievements(ctx, W, H, headerH);
    else if (this.tab === 'avatars') this.renderAvatars(ctx, W, H, headerH);

    this.scrollY = savedScrollY;

    // Clamp scroll after content height is computed
    this.scrollY = Math.min(this.scrollY, Math.max(0, this.maxScrollY));

    ctx.restore();

    // ─── Fixed header ───
    // Dark overlay for header area
    ctx.fillStyle = 'rgba(10,10,20,0.85)';
    ctx.fillRect(0, 0, W, headerH);

    // Title ribbon
    const ribbonW = Math.min(W * 0.5, 560);
    const ribbonH = Math.round(compact ? 40 : 64);
    const ribbonX = (W - ribbonW) / 2;
    const st = getSafeTop();
    const ribbonY = (compact ? 4 : 8) + st;
    this.ui.drawBigRibbon(ctx, ribbonX, ribbonY, ribbonW, ribbonH, 2); // yellow ribbon
    ctx.font = `bold ${compact ? 18 : 32}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText('PROFILE', W / 2, ribbonY + ribbonH / 2);

    // Back button — small blue round
    const backSize = compact ? 36 : 64;
    const backX = compact ? 4 : 8;
    const backY = (compact ? 4 : 6) + st;
    this.ui.drawSmallBlueRoundButton(ctx, backX, backY, backSize);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${compact ? 20 : 32}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('<', backX + backSize / 2, backY + backSize / 2);

    // Tab bar — blue buttons
    const tabs: { key: Tab; label: string }[] = [
      { key: 'stats', label: 'STATS' },
      { key: 'achievements', label: compact ? 'ACHIEV' : 'ACHIEVE' },
      { key: 'avatars', label: 'AVATARS' },
    ];
    const gap = compact ? 4 : 12;
    const tabW = Math.min(200, (W - (compact ? 20 : 160) - gap * 2) / 3);
    const totalW = tabW * 3 + gap * 2;
    const startX = (W - totalW) / 2;
    for (let i = 0; i < tabs.length; i++) {
      const tx = startX + i * (tabW + gap);
      const active = this.tab === tabs[i].key;
      this.ui.drawBigBlueButton(ctx, tx, tabBarY, tabW, tabH, active);
      ctx.fillStyle = active ? '#fff' : '#a0c4e8';
      const tabFont = compact ? Math.max(11, Math.round(tabW / 7)) : (tabW < 160 ? 20 : 22);
      ctx.font = `bold ${tabFont}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tabs[i].label, tx + tabW / 2, tabBarY + tabH / 2);
    }

    // Summary line under tabs
    ctx.fillStyle = '#aaa';
    ctx.font = `${compact ? 13 : 22}px monospace`;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    const wr = getWinRate(this.profile.wins, this.profile.gamesPlayed);
    ctx.fillText(
      `${this.profile.gamesPlayed} games | ${this.profile.wins}W ${this.profile.losses}L | ${wr}`,
      W / 2, headerH - (compact ? 4 : 12),
    );
  }

  // ─── Stats Tab ───

  private renderStats(ctx: CanvasRenderingContext2D, W: number, _H: number, headerH: number): void {
    const { compact } = this.getLayout();
    let y = headerH + (compact ? 8 : 20) - this.scrollY;
    const pad = compact ? 8 : 28;
    const panelW = W - pad * 2;
    const inset = compact ? 12 : 44;
    const titleFont = compact ? 16 : 26;
    const bodyFont = compact ? 13 : 24;
    const lineH = compact ? 28 : 36;

    // ── Player identity row: [avatar] [name] ... [dice] ──
    const avatarSize = compact ? 36 : 52;
    const nameFont = compact ? 16 : 24;
    const diceSize = compact ? 28 : 36;
    const rowPad = compact ? 8 : 12;
    const idRowH = avatarSize + rowPad * 2;
    this.drawPanel(ctx, pad, y, panelW, idRowH);

    // Avatar square (left-aligned)
    const avX = pad + rowPad;
    const avY = y + (idRowH - avatarSize) / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.roundRect(avX, avY, avatarSize, avatarSize, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,215,0,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(avX, avY, avatarSize, avatarSize, 6);
    ctx.stroke();

    // Draw avatar sprite
    const avatarDef = ALL_AVATARS.find(a => a.id === this.profile.avatarId);
    if (avatarDef) {
      const sprData = this.sprites.getUnitSprite(avatarDef.race, avatarDef.category, 0, false, avatarDef.upgradeNode);
      if (sprData) {
        const [img, def] = sprData;
        const frame = getSpriteFrame(Math.floor(this.animTime / 50), def);
        const aspect = def.frameW / def.frameH;
        const sprInset = 4;
        const sprSize = avatarSize - sprInset * 2;
        const sprScale = def.scale ?? 1.0;
        const maxH = sprSize * sprScale;
        const maxW = sprSize;
        let drawW: number, drawH: number;
        if (maxH * aspect > maxW) { drawW = maxW; drawH = maxW / aspect; }
        else { drawH = maxH; drawW = maxH * aspect; }
        const gY = def.groundY ?? 0.71;
        const feetY = avY + avatarSize - sprInset - 2;
        const drawY = feetY - drawH * gY;
        const drawX = avX + (avatarSize - drawW) / 2;
        if (def.flipX) {
          ctx.save();
          ctx.translate(avX + avatarSize / 2, 0);
          ctx.scale(-1, 1);
          ctx.translate(-(avX + avatarSize / 2), 0);
        }
        drawSpriteFrame(ctx, img, def, frame, drawX, drawY, drawW, drawH);
        if (def.flipX) ctx.restore();
      }
    }

    // Name (next to avatar)
    const nameX = avX + avatarSize + (compact ? 8 : 12);
    ctx.font = `bold ${nameFont}px monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText(this.playerName, nameX + 1, y + idRowH / 2 + 1);
    ctx.fillStyle = '#ffd700';
    ctx.fillText(this.playerName, nameX, y + idRowH / 2);

    // Dice button (right-aligned)
    const diceX = pad + panelW - rowPad - diceSize;
    const diceY = y + (idRowH - diceSize) / 2;
    this.diceBtnRect = { x: diceX - 4, y: diceY - 4, w: diceSize + 8, h: diceSize + 8 };

    ctx.fillStyle = 'rgba(255,215,0,0.15)';
    ctx.beginPath();
    ctx.roundRect(diceX, diceY, diceSize, diceSize, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,215,0,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(diceX, diceY, diceSize, diceSize, 4);
    ctx.stroke();

    // Dice dots (5-dot pattern)
    const dcx = diceX + diceSize / 2;
    const dcy = diceY + diceSize / 2;
    const dotR = compact ? 1.5 : 2.5;
    const off = diceSize * 0.22;
    ctx.fillStyle = '#ffd700';
    for (const [dx, dy] of [[-off, -off], [off, -off], [0, 0], [-off, off], [off, off]] as [number, number][]) {
      ctx.beginPath();
      ctx.arc(dcx + dx, dcy + dy, dotR, 0, Math.PI * 2);
      ctx.fill();
    }

    y += idRowH + (compact ? 4 : 8);

    // ── Overview panel ──
    const overH = compact ? 120 : 200;
    this.drawPanel(ctx, pad, y, panelW, overH);

    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = `bold ${titleFont}px monospace`; ctx.fillStyle = '#ffd740';
    ctx.fillText('Overview', pad + inset, y + (compact ? 24 : 44));

    ctx.font = `${bodyFont}px monospace`; ctx.fillStyle = '#e0e0e0';
    const c1 = pad + inset;
    const c2 = pad + Math.floor(panelW / 2);
    const oy = compact ? 48 : 84;
    ctx.fillText(`Games: ${this.profile.gamesPlayed}`, c1, y + oy);
    ctx.fillText(`Wins: ${this.profile.wins}`, c2, y + oy);
    ctx.fillText(`Losses: ${this.profile.losses}`, c1, y + oy + lineH);
    ctx.fillText(`WR: ${getWinRate(this.profile.wins, this.profile.gamesPlayed)}`, c2, y + oy + lineH);
    ctx.fillText(`Time: ${formatTime(this.profile.totalPlayTimeSec)}`, c1, y + oy + lineH * 2);
    ctx.fillText(`Streak: ${this.profile.bestWinStreak}`, c2, y + oy + lineH * 2);
    y += overH + (compact ? 10 : 24);

    // ── Race stats panel ──
    const rowH = compact ? 26 : 44;
    const raceH = (compact ? 44 : 72) + ALL_RACES.length * rowH + (compact ? 12 : 28);
    this.drawPanel(ctx, pad, y, panelW, raceH);

    ctx.font = `bold ${titleFont}px monospace`; ctx.fillStyle = '#ffd740';
    ctx.textAlign = 'left';
    ctx.fillText('Race Stats', pad + inset, y + (compact ? 24 : 40));
    y += compact ? 36 : 60;

    // Column headers — proportional positioning
    const hdrFont = compact ? 11 : 20;
    const dataFont = compact ? 12 : 22;
    ctx.font = `bold ${hdrFont}px monospace`; ctx.fillStyle = '#999';
    const rCols = [
      pad + inset,
      pad + Math.floor(panelW * 0.35),
      pad + Math.floor(panelW * 0.55),
      pad + Math.floor(panelW * 0.75),
    ];
    ctx.fillText('RACE', rCols[0], y);
    ctx.fillText('GAMES', rCols[1], y);
    ctx.fillText('WIN%', rCols[2], y);
    ctx.fillText('TIME', rCols[3], y);
    y += compact ? 6 : 12;

    // Divider line
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad + inset, y);
    ctx.lineTo(pad + panelW - 12, y);
    ctx.stroke();

    ctx.font = `${dataFont}px monospace`;
    for (const race of ALL_RACES) {
      y += rowH;
      const rs = this.profile.raceStats[race];
      const rc = RACE_COLORS[race];

      // Alternating row bg
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      if (ALL_RACES.indexOf(race) % 2 === 0) {
        ctx.fillRect(pad + inset - 4, y - rowH + (compact ? 6 : 12), panelW - inset, rowH);
      }

      ctx.fillStyle = rc.primary;
      ctx.fillText(RACE_LABELS[race], rCols[0], y);
      ctx.fillStyle = '#ccc';
      ctx.fillText(`${rs?.gamesPlayed ?? 0}`, rCols[1], y);
      ctx.fillText(getWinRate(rs?.wins ?? 0, rs?.gamesPlayed ?? 0), rCols[2], y);
      ctx.fillText(formatTime(rs?.playTimeSec ?? 0), rCols[3], y);
    }

    // Total content height for scroll clamping
    const contentBottom = y + rowH + this.scrollY - headerH;
    this.maxScrollY = Math.max(0, contentBottom - (_H - headerH));
  }

  // ─── Achievements Tab ───

  private renderAchievements(ctx: CanvasRenderingContext2D, W: number, _H: number, headerH: number): void {
    const { compact } = this.getLayout();
    let y = headerH + (compact ? 8 : 20) - this.scrollY;
    const pad = compact ? 8 : 28;
    const panelW = W - pad * 2;
    const cardH = compact ? 72 : 124;
    const cardGap = compact ? 8 : 16;

    const totalCardsH = ACHIEVEMENTS.length * (cardH + cardGap) + 32;
    this.drawPanel(ctx, pad, y, panelW, totalCardsH);

    y += compact ? 8 : 16;

    for (const ach of ACHIEVEMENTS) {
      const state = this.profile.achievements[ach.id];
      const unlocked = state?.unlocked ?? false;
      const progress = state?.progress ?? 0;

      // Card inner background
      const cardPad = compact ? 6 : 12;
      ctx.fillStyle = unlocked ? 'rgba(100,180,100,0.15)' : 'rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.roundRect(pad + cardPad, y, panelW - cardPad * 2, cardH, 8); ctx.fill();

      // Border
      ctx.strokeStyle = unlocked ? 'rgba(129,199,132,0.4)' : 'rgba(255,255,255,0.06)';
      ctx.lineWidth = compact ? 1 : 2;
      ctx.beginPath(); ctx.roundRect(pad + cardPad, y, panelW - cardPad * 2, cardH, 8); ctx.stroke();

      // Icon area
      const iconX = pad + cardPad + (compact ? 6 : 12);
      const iconY = y + (compact ? 6 : 12);
      const iconSz = cardH - (compact ? 12 : 24);

      // Icon bg
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.roundRect(iconX, iconY, iconSz, iconSz, compact ? 4 : 8); ctx.fill();

      if (ach.avatarUnlock) {
        if (!unlocked) ctx.globalAlpha = 0.4;
        this.drawAvatarSprite(ctx, ach.avatarUnlock, iconX + 2, iconY + 2, iconSz - 4);
        if (!unlocked) ctx.globalAlpha = 1;
      }

      // Text content
      const textX = iconX + iconSz + (compact ? 8 : 20);
      const textW = panelW - cardPad * 2 - (textX - pad - cardPad) - (compact ? 8 : 16);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

      // Achievement name
      ctx.font = `bold ${compact ? 13 : 24}px monospace`;
      ctx.fillStyle = unlocked ? '#81c784' : '#e0e0e0';
      ctx.fillText(ach.name, textX, y + (compact ? 22 : 36));

      // Description
      ctx.font = `${compact ? 11 : 20}px monospace`;
      ctx.fillStyle = '#999';
      ctx.fillText(ach.desc, textX, y + (compact ? 38 : 64), compact ? textW - 40 : undefined);

      // Progress bar using UIAssets bar
      const barX = textX;
      const barY = y + (compact ? 46 : 80);
      const barW = textW;
      const barH = compact ? 12 : 20;
      const pct = Math.min(1, progress / ach.goal);
      if (!this.ui.drawBar(ctx, barX, barY, barW, barH, pct)) {
        // Fallback bar
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath(); ctx.roundRect(barX, barY, barW, barH, compact ? 3 : 6); ctx.fill();
        ctx.fillStyle = unlocked ? '#81c784' : '#4fc3f7';
        if (pct > 0) {
          ctx.beginPath(); ctx.roundRect(barX, barY, Math.max(compact ? 6 : 12, barW * pct), barH, compact ? 3 : 6); ctx.fill();
        }
      }

      // Progress text
      ctx.fillStyle = unlocked ? '#81c784' : '#777';
      ctx.font = `bold ${compact ? 11 : 18}px monospace`;
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.min(progress, ach.goal)}/${ach.goal}`, pad + panelW - (compact ? 14 : 28), y + (compact ? 22 : 36));

      if (unlocked) {
        ctx.fillStyle = '#4caf50';
        ctx.fillText('✓', pad + panelW - (compact ? 14 : 28), y + (compact ? 60 : 104));
      }

      y += cardH + cardGap;
    }

    // Total content height for scroll clamping
    const contentBottom = y + this.scrollY - headerH;
    this.maxScrollY = Math.max(0, contentBottom - (_H - headerH));
  }

  // ─── Avatars Tab ───

  private renderAvatars(ctx: CanvasRenderingContext2D, W: number, _H: number, headerH: number): void {
    const { compact } = this.getLayout();
    const pad = compact ? 8 : 28;
    const panelW = W - pad * 2;
    const maxCellPx = compact ? 90 : 160;
    const cols = Math.max(3, Math.floor((panelW - (compact ? 12 : 40)) / maxCellPx));
    const cellSize = Math.floor((panelW - (compact ? 12 : 40)) / cols);
    const rows = Math.ceil(ALL_AVATARS.length / cols);
    const gridH = rows * cellSize + (compact ? 16 : 32);
    const startX = pad + (compact ? 6 : 20);
    const startY = headerH + (compact ? 12 : 28) - this.scrollY;

    this.drawPanel(ctx, pad, startY - 8, panelW, gridH + 8);

    for (let i = 0; i < ALL_AVATARS.length; i++) {
      const avatar = ALL_AVATARS[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const ax = startX + col * cellSize;
      const ay = startY + row * cellSize;

      const unlocked = isAvatarUnlocked(this.profile, avatar);
      const selected = this.profile.avatarId === avatar.id;

      // Cell background
      ctx.fillStyle = selected ? 'rgba(255,215,0,0.2)' : 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.roundRect(ax + 2, ay + 2, cellSize - 4, cellSize - 4, 4); ctx.fill();

      if (selected) {
        ctx.strokeStyle = '#ffd740';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(ax + 2, ay + 2, cellSize - 4, cellSize - 4, 4); ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(ax + 2, ay + 2, cellSize - 4, cellSize - 4, 4); ctx.stroke();
      }

      const sprPad = compact ? 4 : 8;
      if (unlocked) {
        this.drawAvatarSprite(ctx, avatar.id, ax + sprPad, ay + sprPad - 2, cellSize - sprPad * 2);
      } else {
        // Locked — desaturated
        ctx.globalAlpha = 0.15;
        this.drawAvatarSprite(ctx, avatar.id, ax + sprPad, ay + sprPad - 2, cellSize - sprPad * 2);
        ctx.globalAlpha = 1;
        // Lock overlay
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath(); ctx.roundRect(ax + 2, ay + 2, cellSize - 4, cellSize - 4, 4); ctx.fill();
        ctx.fillStyle = '#666';
        ctx.font = `bold ${compact ? 18 : 32}px monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('?', ax + cellSize / 2, ay + cellSize / 2 - 4);
      }

      // Race + category label
      const rc = RACE_COLORS[avatar.race];
      ctx.font = `${compact ? 11 : 14}px monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = unlocked ? (rc?.primary ?? '#aaa') : '#444';
      const unitName = getAvatarUnitName(avatar.race, avatar.category, avatar.upgradeNode);
      ctx.fillText(unitName, ax + cellSize / 2, ay + cellSize - (compact ? 6 : 14));
    }

    // Total content height for scroll clamping
    const contentBottom = gridH + (compact ? 20 : 36);
    this.maxScrollY = Math.max(0, contentBottom - (_H - headerH));
  }

  // ─── Draw avatar sprite from ID ───

  private drawAvatarSprite(ctx: CanvasRenderingContext2D, avatarId: string, x: number, y: number, size: number): void {
    const parts = avatarId.split(':');
    const raceStr = parts[0] as Race;
    const cat = parts[1] as 'melee' | 'ranged' | 'caster';
    const upgradeNode = parts[2] as string | undefined;
    const sprData = this.sprites.getUnitSprite(raceStr, cat, 0, false, upgradeNode);
    if (sprData) {
      const [img, def] = sprData;
      const frame = getSpriteFrame(Math.floor(this.animTime / 50), def);
      const aspect = def.frameW / def.frameH;
      // Apply sprite scale so avatars match in-game relative sizes
      const sprScale = def.scale ?? 1.0;
      const maxH = size * sprScale;
      const maxW = size;
      let drawW: number, drawH: number;
      if (maxH * aspect > maxW) { drawW = maxW; drawH = maxW / aspect; }
      else { drawH = maxH; drawW = maxH * aspect; }
      const drawX = x + (size - drawW) / 2;
      const gY = def.groundY ?? 0.71;
      const feetY = y + size * 0.85;
      const drawY = feetY - drawH * gY;
      if (def.flipX) {
        ctx.save();
        ctx.translate(x + size / 2, 0);
        ctx.scale(-1, 1);
        ctx.translate(-(x + size / 2), 0);
      }
      drawSpriteFrame(ctx, img, def, frame, drawX, drawY, drawW, drawH);
      if (def.flipX) ctx.restore();
    } else {
      const rc = RACE_COLORS[raceStr as Race];
      if (rc) {
        ctx.fillStyle = rc.primary;
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size / 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
