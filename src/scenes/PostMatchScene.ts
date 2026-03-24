import { Scene, SceneManager } from './Scene';
import { GameState, Team, PlayerStats, MinimapFrame, HQ_WIDTH, HQ_HEIGHT } from '../simulation/types';
import { PLAYER_COLORS, RACE_COLORS } from '../simulation/data';
import { UIAssets, IconName } from '../rendering/UIAssets';
import { SpriteLoader, getSpriteFrame } from '../rendering/SpriteLoader';
import { getSafeTop } from '../ui/SafeArea';

export interface MatchStats {
  state: GameState;
  localPlayerId: number;
  /** Per-slot display names (human players). */
  slotNames?: { [slot: string]: string };
  /** Per-slot bot difficulty (absent = human). */
  slotBotDifficulties?: { [slot: string]: string };
  /** True if this was a party/custom game — continue returns to lobby instead of race select. */
  wasPartyGame?: boolean;
  /** Per-second minimap snapshots for the post-match replay panel. */
  replayFrames?: MinimapFrame[];
}

export class PostMatchScene implements Scene {
  private manager: SceneManager;
  private canvas: HTMLCanvasElement;
  private ui: UIAssets;
  private sprites: SpriteLoader;
  private stats: MatchStats | null = null;
  private animTime = 0;
  private clickHandler: ((e: MouseEvent) => void) | null = null;

  // Minimap replay state
  private replayFrameIdx = 0;
  private replayFrameTime = 0; // ms accumulated within current frame
  /** ms to display each frame — computed in setStats to target 30s total. */
  private replayFrameDur = 100;
  /** Pre-rendered static minimap background (water + shape + HQ + diamond center). */
  private replayBgCanvas: HTMLCanvasElement | null = null;

  // Scroll state
  private scrollY = 0;
  private maxScrollY = 0;
  private lastTouchY = 0;
  private wheelHandler: ((e: WheelEvent) => void) | null = null;
  private touchMoveHandler: ((e: TouchEvent) => void) | null = null;

  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private touchHandler: ((e: TouchEvent) => void) | null = null;

  constructor(manager: SceneManager, canvas: HTMLCanvasElement, ui: UIAssets, sprites: SpriteLoader) {
    this.manager = manager;
    this.canvas = canvas;
    this.ui = ui;
    this.sprites = sprites;
  }

  setStats(stats: MatchStats): void {
    this.stats = stats;
    this.replayFrameIdx = 0;
    this.replayFrameTime = 0;
    this.replayBgCanvas = null;

    const frames = stats.replayFrames;
    if (frames && frames.length > 0) {
      // Scale 15–30s based on match length (4fps capture → frames/4 = match seconds at 10× speed).
      // Short games stretch to 15s floor for smoothness; long games cap at 30s.
      // replayFrameDur is in ms (dt is ms from performance.now).
      const TARGET_REPLAY_MS = Math.min(30_000, Math.max(15_000, frames.length * 25));
      this.replayFrameDur = TARGET_REPLAY_MS / frames.length;

      // Pre-render static minimap background (water + grass shape + HQ boxes + diamond center)
      // at a fixed internal resolution. Drawn once, composited every frame.
      this.replayBgCanvas = this.buildMinimapBg(stats.state);
    }
  }

  /**
   * Builds an offscreen canvas with the static minimap background matching the in-game minimap:
   * water fill → grass shape outline → HQ blocks → static diamond center marker.
   */
  private buildMinimapBg(state: GameState): HTMLCanvasElement {
    const mapDef = state.mapDef;
    const mapW = mapDef.width;
    const mapH = mapDef.height;
    // Fixed internal resolution — will be scaled when drawn to the main canvas
    const BG_W = 160;
    const BG_H = Math.round(BG_W * (mapH / mapW)); // preserves map aspect ratio

    const bg = document.createElement('canvas');
    bg.width = BG_W;
    bg.height = BG_H;
    const c = bg.getContext('2d')!;

    // Helper: tile coord → bg pixel coord
    const tx = (wx: number) => (wx / mapW) * BG_W;
    const ty2 = (wy: number) => (wy / mapH) * BG_H;

    // Water background (matches Renderer.ts: rgba(60,110,100,0.9) with 2px padding)
    c.fillStyle = 'rgb(60, 110, 100)';
    c.fillRect(0, 0, BG_W, BG_H);

    // Grass shape — exact same approach as Renderer.ts drawMinimap
    c.beginPath();
    if (mapDef.shapeAxis === 'y') {
      // Left edge: top → bottom
      for (let y = 0; y <= mapH; y += 4) {
        const range = mapDef.getPlayableRange(y);
        if (y === 0) c.moveTo(tx(range.min), ty2(y));
        else c.lineTo(tx(range.min), ty2(y));
      }
      // Right edge: bottom → top
      for (let y = mapH; y >= 0; y -= 4) {
        const range = mapDef.getPlayableRange(y);
        c.lineTo(tx(range.max), ty2(y));
      }
    } else {
      // Landscape: top edge left→right, bottom edge right→left
      for (let x = 0; x <= mapW; x += 4) {
        const range = mapDef.getPlayableRange(x);
        if (x === 0) c.moveTo(tx(x), ty2(range.min));
        else c.lineTo(tx(x), ty2(range.min));
      }
      for (let x = mapW; x >= 0; x -= 4) {
        const range = mapDef.getPlayableRange(x);
        c.lineTo(tx(x), ty2(range.max));
      }
    }
    c.closePath();
    c.fillStyle = '#3a6b3a';
    c.fill();
    c.strokeStyle = '#2a5a2a';
    c.lineWidth = 1;
    c.stroke();

    // Static diamond center marker (gold diamond shape, matches Renderer.ts)
    const dc = mapDef.diamondCenter;
    const dHW = mapDef.diamondHalfW;
    const dHH = mapDef.diamondHalfH;
    c.beginPath();
    c.moveTo(tx(dc.x), ty2(dc.y - dHH));
    c.lineTo(tx(dc.x + dHW), ty2(dc.y));
    c.lineTo(tx(dc.x), ty2(dc.y + dHH));
    c.lineTo(tx(dc.x - dHW), ty2(dc.y));
    c.closePath();
    c.fillStyle = 'rgba(200, 170, 20, 0.6)';
    c.fill();
    c.strokeStyle = 'rgba(255, 220, 120, 0.85)';
    c.lineWidth = 1;
    c.stroke();

    // HQ blocks (team 0 = blue/bottom, team 1 = red/top)
    const hqColors = ['#2979ff', '#ff1744'];
    for (let t = 0; t < 2; t++) {
      const hqPos = mapDef.teams[t].hqPosition;
      c.fillStyle = hqColors[t];
      c.fillRect(
        tx(hqPos.x), ty2(hqPos.y),
        Math.max(3, (HQ_WIDTH / mapW) * BG_W),
        Math.max(2, (HQ_HEIGHT / mapH) * BG_H),
      );
    }

    return bg;
  }

  enter(): void {
    this.animTime = 0;
    this.scrollY = 0;
    this.maxScrollY = 0;

    const continueTarget = this.stats?.wasPartyGame ? 'title' : 'raceSelect';

    let lastTouchTime = 0;
    this.clickHandler = (e) => {
      if (Date.now() - lastTouchTime < 300) return;
      const rect = this.canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      if (this.isButtonAt(cx, cy)) this.manager.switchTo(continueTarget);
    };

    this.keyHandler = (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
        this.manager.switchTo(continueTarget);
      }
    };

    this.touchHandler = (e) => {
      e.preventDefault();
      lastTouchTime = Date.now();
      const touch = e.touches[0];
      if (!touch) return;
      this.lastTouchY = touch.clientY;
      const rect = this.canvas.getBoundingClientRect();
      const cx = touch.clientX - rect.left;
      const cy = touch.clientY - rect.top;
      if (this.isButtonAt(cx, cy)) this.manager.switchTo(continueTarget);
    };

    this.wheelHandler = (e) => {
      e.preventDefault();
      this.scrollY = Math.max(0, Math.min(this.maxScrollY, this.scrollY + e.deltaY * 0.6));
    };

    this.touchMoveHandler = (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;
      const delta = this.lastTouchY - touch.clientY;
      this.scrollY = Math.max(0, Math.min(this.maxScrollY, this.scrollY + delta));
      this.lastTouchY = touch.clientY;
    };

    this.canvas.addEventListener('click', this.clickHandler);
    window.addEventListener('keydown', this.keyHandler);
    this.canvas.addEventListener('touchstart', this.touchHandler, { passive: false });
    this.canvas.addEventListener('wheel', this.wheelHandler, { passive: false });
    this.canvas.addEventListener('touchmove', this.touchMoveHandler, { passive: false });
  }

  exit(): void {
    if (this.clickHandler) this.canvas.removeEventListener('click', this.clickHandler);
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    if (this.touchHandler) this.canvas.removeEventListener('touchstart', this.touchHandler);
    if (this.wheelHandler) this.canvas.removeEventListener('wheel', this.wheelHandler);
    if (this.touchMoveHandler) this.canvas.removeEventListener('touchmove', this.touchMoveHandler);
    this.clickHandler = null;
    this.keyHandler = null;
    this.touchHandler = null;
    this.wheelHandler = null;
    this.touchMoveHandler = null;
  }

  private getButtonRect(): { x: number; y: number; w: number; h: number } {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const btnW = 260;
    const btnH = 56;
    return { x: (w - btnW) / 2, y: h * 0.90, w: btnW, h: btnH };
  }

  private isButtonAt(cx: number, cy: number): boolean {
    const b = this.getButtonRect();
    const pad = 8;
    return cx >= b.x - pad && cx <= b.x + b.w + pad && cy >= b.y - pad && cy <= b.y + b.h + pad;
  }

  update(dt: number): void {
    this.animTime += dt;

    const frames = this.stats?.replayFrames;
    if (frames && frames.length > 1) {
      this.replayFrameTime += dt;
      while (this.replayFrameTime >= this.replayFrameDur) {
        this.replayFrameTime -= this.replayFrameDur;
        this.replayFrameIdx = (this.replayFrameIdx + 1) % frames.length;
      }
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const w = ctx.canvas.clientWidth;
    const h = ctx.canvas.clientHeight;
    ctx.imageSmoothingEnabled = false;

    // Water background
    if (!this.ui.drawWaterBg(ctx, w, h, this.animTime)) {
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, w, h);

    if (!this.stats) {
      ctx.font = 'bold 24px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#888';
      ctx.fillText('No match data', w / 2, h / 2);
      return;
    }

    const { state, localPlayerId } = this.stats;
    const localTeam = state.players[localPlayerId]?.team ?? Team.Bottom;
    const won = state.winner === localTeam;
    const fontSize = Math.max(14, Math.min(w / 28, 24));

    // Scrollable content — everything except the fixed Continue button
    ctx.save();
    ctx.translate(0, -Math.round(this.scrollY));

    // VICTORY / DEFEAT banner
    const headerBannerW = Math.min(w * 0.75, 540);
    const headerBannerH = Math.min(90, h * 0.1);
    const headerBannerX = (w - headerBannerW) / 2;
    const headerBannerY = h * 0.02 + getSafeTop();
    this.ui.drawBigRibbon(ctx, headerBannerX, headerBannerY, headerBannerW, headerBannerH, won ? 0 : 1);

    ctx.font = `bold ${fontSize * 2.2}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText(won ? 'VICTORY' : 'DEFEAT', w / 2, headerBannerY + headerBannerH * 0.62);

    // Stats table panel - Banner 9-slice with generous padding
    const panelW = Math.min(w * 0.98, 1060);
    const panelH = h * 0.90;
    const panelX = (w - panelW) / 2;
    const panelY = headerBannerY + headerBannerH + 12;
    const bgPadX = Math.round(panelW * 0.05);
    const bgPadY = Math.round(panelH * 0.05);
    this.ui.drawBanner(ctx, panelX - bgPadX, panelY - bgPadY, panelW + bgPadX * 2, panelH + bgPadY * 2);

    // Win condition + match time (inside panel, unified with content)
    const condText = state.winCondition === 'military' ? 'HQ Destroyed'
      : state.winCondition === 'diamond' ? 'Diamond Delivered'
      : state.winCondition === 'timeout' ? 'Time Expired' : '';
    const totalSec = Math.floor(state.tick / 20);
    ctx.font = `bold ${fontSize * 0.85}px monospace`;
    ctx.fillStyle = '#5c4020';
    ctx.textAlign = 'center';
    ctx.fillText(`${condText}  \u2014  ${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, '0')}`, w / 2, panelY + 18);

    // Inner content area (inset from Banner 9-slice borders)
    const pad = panelW * 0.06;
    const innerL = panelX + pad;
    const innerR = panelX + panelW - pad;
    const innerW = innerR - innerL;

    // Player stats table
    const tableFontSize = Math.max(11, fontSize * 0.7);
    const tableY = panelY + 34;
    const rowH = tableFontSize * 2.4;
    // Columns positioned relative to inner area
    const colX = [
      innerL,                    // PLAYER (left-aligned)
      innerL + innerW * 0.32,   // gold
      innerL + innerW * 0.44,   // wood
      innerL + innerW * 0.55,   // stone
      innerL + innerW * 0.66,   // enemy kills (sword)
      innerL + innerW * 0.78,   // units lost
      innerL + innerW * 0.92,   // damage
    ];

    // Header row with icons
    ctx.font = `bold ${Math.max(11, tableFontSize * 0.85)}px monospace`;
    ctx.fillStyle = '#5c4020';
    ctx.textAlign = 'left';
    ctx.fillText('PLAYER', colX[0], tableY);
    ctx.textAlign = 'right';
    const hdrIconSz = tableFontSize * 1.05;
    this.ui.drawIcon(ctx, 'gold', colX[1] - hdrIconSz, tableY - hdrIconSz + 2, hdrIconSz);
    this.ui.drawIcon(ctx, 'wood', colX[2] - hdrIconSz, tableY - hdrIconSz + 2, hdrIconSz);
    this.ui.drawIcon(ctx, 'meat', colX[3] - hdrIconSz, tableY - hdrIconSz + 2, hdrIconSz);
    this.ui.drawIcon(ctx, 'sword', colX[4] - hdrIconSz, tableY - hdrIconSz + 2, hdrIconSz);
    ctx.fillStyle = '#5c4020';
    ctx.fillText('LOST', colX[5], tableY);
    ctx.fillText('DMG', colX[6], tableY);

    // Header separator line
    ctx.strokeStyle = 'rgba(62,44,26,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(innerL, tableY + 8);
    ctx.lineTo(innerR, tableY + 8);
    ctx.stroke();

    const pStats = state.playerStats ?? [];

    // Team stripe colors: Bottom=blue, Top=red
    const TEAM_STRIPE: Record<number, string> = {
      [Team.Bottom]: '#2979ff',
      [Team.Top]:    '#ff1744',
    };

    // Build team groups sorted local team first
    const enemyTeam2 = localTeam === Team.Bottom ? Team.Top : Team.Bottom;
    const teamGroups: Array<{ team: Team; indices: number[] }> = [];
    for (const t of [localTeam, enemyTeam2]) {
      const indices: number[] = [];
      for (let i = 0; i < state.players.length; i++) {
        if (!state.players[i].isEmpty && state.players[i].team === t) indices.push(i);
      }
      if (indices.length > 0) teamGroups.push({ team: t, indices });
    }

    let rowIdx = 0;
    for (const { team, indices } of teamGroups) {
      // Team sub-header row
      rowIdx++;
      const hdrY = tableY + rowIdx * rowH;
      const hdrTop = hdrY - rowH * 0.65;
      const stripeColor = TEAM_STRIPE[team];
      const isWinnerTeam = state.winner === team;
      const isLocalTeam = team === localTeam;

      ctx.fillStyle = stripeColor + '22';
      ctx.fillRect(innerL, hdrTop, innerW, rowH);
      ctx.fillStyle = stripeColor;
      ctx.fillRect(innerL, hdrTop, 5, rowH);

      const teamLabel = isLocalTeam ? 'YOUR TEAM' : 'ENEMY TEAM';
      const outcomeLabel = isWinnerTeam ? 'VICTORY' : 'DEFEAT';
      ctx.font = `bold ${tableFontSize * 0.75}px monospace`;
      ctx.textAlign = 'left';
      ctx.fillStyle = this.darkenColor(stripeColor, 0.7);
      ctx.fillText(`${teamLabel}  ·  ${outcomeLabel}`, innerL + 10, hdrY - 2);

      for (const i of indices) {
        const p = state.players[i];
        const ps = pStats[i];
        rowIdx++;
        const y = tableY + rowIdx * rowH;
        const rowTop = y - rowH * 0.65;

        // Alternating row backgrounds
        if (rowIdx % 2 === 0) {
          ctx.fillStyle = 'rgba(62,44,26,0.08)';
          ctx.fillRect(innerL, rowTop, innerW, rowH);
        }
        // Highlight local player row
        if (i === localPlayerId) {
          ctx.fillStyle = 'rgba(41,121,255,0.15)';
          ctx.fillRect(innerL, rowTop, innerW, rowH);
        }

        // Team stripe
        ctx.fillStyle = stripeColor + 'bb';
        ctx.fillRect(innerL, rowTop, 5, rowH);

        const isBot = !!this.stats?.slotBotDifficulties?.[String(i)];
        const raceColor = RACE_COLORS[p.race]?.primary ?? '#888';
        const iconSz = tableFontSize * 1.0;
        let textX = colX[0] + 8; // indent past stripe

        // Bot indicator icon (gear)
        if (isBot) {
          this.ui.drawIcon(ctx, 'settings', textX, y - iconSz + 2, iconSz);
          textX += iconSz + 2;
        }

        // Race color dot
        ctx.fillStyle = raceColor;
        const dotR = tableFontSize * 0.32;
        ctx.beginPath();
        ctx.arc(textX + dotR, y - dotR + 1, dotR, 0, Math.PI * 2);
        ctx.fill();
        textX += dotR * 2 + 4;

        // Player name — truncate to fit column
        const label = this.slotLabel(i);
        const raceStr = p.race.charAt(0).toUpperCase() + p.race.slice(1);
        const fullText = `${label} ${raceStr}`;
        ctx.font = `bold ${tableFontSize}px monospace`;
        const maxTextW = colX[1] - textX - hdrIconSz - 4;
        const truncated = this.truncateText(ctx, fullText, maxTextW);
        ctx.textAlign = 'left';
        const pc = PLAYER_COLORS[i % PLAYER_COLORS.length];
        ctx.fillStyle = this.darkenColor(pc, 0.6);
        ctx.fillText(truncated, textX, y);

        ctx.font = `${tableFontSize}px monospace`;
        ctx.fillStyle = '#4a3518';
        ctx.textAlign = 'right';
        ctx.fillText(`${ps?.totalGoldEarned ?? 0}`, colX[1], y);
        ctx.fillText(`${ps?.totalWoodEarned ?? 0}`, colX[2], y);
        ctx.fillText(`${ps?.totalStoneEarned ?? 0}`, colX[3], y);
        ctx.fillText(`${ps?.enemyUnitsKilled ?? 0}`, colX[4], y);
        ctx.fillText(`${ps?.unitsLost ?? 0}`, colX[5], y);
        ctx.font = `bold ${tableFontSize}px monospace`;
        ctx.fillText(`${ps?.totalDamageDealt ?? 0}`, colX[6], y);
      }
    }

    // HQ HP — compact centered row: [US hp bar]  [ENEMY hp bar]
    const hqY = tableY + (rowIdx + 1) * rowH + 4;
    const barW = Math.min(100, panelW * 0.14);
    const barH = 14;
    const hqGap = Math.round(fontSize * 0.6);
    const ourHp = Math.max(0, state.hqHp[localTeam]);
    const enemyTeam = localTeam === Team.Bottom ? Team.Top : Team.Bottom;
    const enemyHp = Math.max(0, state.hqHp[enemyTeam]);

    ctx.font = `bold ${Math.max(11, fontSize * 0.7)}px monospace`;
    // Left side: label then bar
    const usLabel = `US ${ourHp}`;
    const usLabelW = ctx.measureText(usLabel).width;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#1a4a8a';
    ctx.fillText(usLabel, w / 2 - hqGap, hqY + 12);
    this.ui.drawBar(ctx, w / 2 - hqGap - usLabelW - barW - 6, hqY + 2, barW, barH, ourHp / 1000);
    // Right side: label then bar
    const enLabel = `ENEMY ${enemyHp}`;
    const enLabelW = ctx.measureText(enLabel).width;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#a01020';
    ctx.fillText(enLabel, w / 2 + hqGap, hqY + 12);
    this.ui.drawBar(ctx, w / 2 + hqGap + enLabelW + 6, hqY + 2, barW, barH, enemyHp / 1000);

    // Minimap replay panel
    const frames = this.stats?.replayFrames;
    const replayH = frames && frames.length > 0
      ? this.drawMinimapReplay(ctx, state, frames, w, hqY + rowH * 0.9, fontSize)
      : 0;

    // Awards + War Hero combined section
    const sectionY = hqY + rowH * 1.2 + replayH;
    const contentBottom = this.drawAwardsAndHero(ctx, state, pStats, w, innerW, sectionY, fontSize);

    ctx.restore();

    // contentBottom is in content-space Y. Content visible up to h*0.85 (leave room for button).
    this.maxScrollY = Math.max(0, contentBottom - h * 0.85);

    // Continue button — fixed at bottom, not affected by scroll
    const btn = this.getButtonRect();
    const rv = UIAssets.swordReveal(this.animTime, 0);
    const ox = this.ui.drawSword(ctx, btn.x, btn.y, btn.w, btn.h, 0, rv);
    if (rv > 0) {
      ctx.font = `bold ${Math.max(20, fontSize)}px monospace`;
      ctx.textAlign = 'center';
      ctx.globalAlpha = rv;
      const btnTextX = btn.x + btn.w * 0.52 + ox;
      const btnLabel = this.stats?.wasPartyGame ? 'LOBBY' : 'CONTINUE';
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText(btnLabel, btnTextX + 1, btn.y + btn.h * 0.58 + 1);
      ctx.fillStyle = '#fff';
      ctx.fillText(btnLabel, btnTextX, btn.y + btn.h * 0.58);
      ctx.globalAlpha = 1;
    }

    // Scroll hint
    if (this.maxScrollY > 0 && this.scrollY < this.maxScrollY - 10) {
      ctx.font = `${Math.max(11, fontSize * 0.6)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText('▼ scroll', w / 2, h * 0.87);
    }
  }

  private drawAwardsAndHero(
    ctx: CanvasRenderingContext2D, state: GameState, pStats: PlayerStats[],
    w: number, innerW: number, y: number, fontSize: number,
  ): number {
    const awards = this.computeAwards(pStats);
    const awardIcons: Record<string, IconName> = {
      'MVP Damage': 'sword', 'Best Economy': 'gold', 'Best Defender': 'shield',
      'Top Killer': 'sword', 'Nuke Master': 'sword', 'Diamond Runner': 'gold',
      'Tower Damage': 'shield', 'Most Healing': 'meat', 'Most Tanked': 'shield',
    };
    const gap = Math.round(fontSize * 0.4); // consistent spacing unit

    // --- Awards as 4-per-row cards ---
    if (awards.length > 0) {
      const cols = 4;
      const cardGap = gap;
      const totalGapPerRow = cardGap * (cols - 1);
      const cardW = Math.min(Math.floor((innerW - totalGapPerRow) / cols), 200);
      const cardH = fontSize * 4.2;
      const totalRowW = cardW * cols + totalGapPerRow;
      const rowStartX = (w - totalRowW) / 2;

      for (let i = 0; i < awards.length; i++) {
        const a = awards[i];
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cx = rowStartX + col * (cardW + cardGap);
        const cy = y + row * (cardH + cardGap);

        // Card background
        ctx.fillStyle = 'rgba(62,44,26,0.15)';
        ctx.strokeStyle = 'rgba(62,44,26,0.3)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(cx, cy, cardW, cardH, 5);
        ctx.fill();
        ctx.stroke();

        const cardCenterX = cx + cardW / 2;
        const iconSz = fontSize * 1.4;
        const icon = awardIcons[a.label] ?? 'sword';
        const inset = gap;

        // Icon centered at top of card
        this.ui.drawIcon(ctx, icon, cardCenterX - iconSz / 2, cy + inset, iconSz);

        // Award label — truncate to fit card
        ctx.font = `bold ${Math.max(11, fontSize * 0.55)}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#6b4e28';
        const label = this.truncateText(ctx, a.label.toUpperCase(), cardW - inset * 2);
        ctx.fillText(label, cardCenterX, cy + inset + iconSz + fontSize * 0.6);

        // Player name in their color
        ctx.font = `bold ${Math.max(11, fontSize * 0.65)}px monospace`;
        ctx.fillStyle = this.darkenColor(PLAYER_COLORS[a.playerId % PLAYER_COLORS.length], 0.7);
        const name = this.truncateText(ctx, this.slotLabel(a.playerId), cardW - inset * 2);
        ctx.fillText(name, cardCenterX, cy + inset + iconSz + fontSize * 1.35);

        // Value
        ctx.font = `${Math.max(11, fontSize * 0.5)}px monospace`;
        ctx.fillStyle = '#7a5c38';
        ctx.fillText(a.value, cardCenterX, cy + inset + iconSz + fontSize * 2.0);
      }
      const rows = Math.ceil(awards.length / cols);
      y += rows * (cardH + cardGap) + gap;
    }

    // --- War Hero card ---
    const heroes = state.warHeroes;
    if (heroes.length === 0) return y;
    const hero = heroes[0];

    const playerColor = PLAYER_COLORS[hero.playerId % PLAYER_COLORS.length];
    const raceColor = RACE_COLORS[hero.race]?.primary ?? '#fff';

    // Card dimensions — sized to fit content
    const lineH = fontSize * 1.1; // consistent line spacing
    const heroCardW = Math.min(innerW, 400);
    const heroCardH = lineH * 6;
    const heroCardX = (w - heroCardW) / 2;
    const heroCardY = y;

    // SpecialPaper background (works at any size, unlike WoodTable)
    const cardPadX = Math.round(heroCardW * 0.06);
    const cardPadY = Math.round(heroCardH * 0.1);
    this.ui.drawSpecialPaper(ctx, heroCardX - cardPadX, heroCardY - cardPadY,
      heroCardW + cardPadX * 2, heroCardH + cardPadY * 2);

    // Animated sprite on the left side of card — clamped to fit
    const maxSpriteH = heroCardH - gap * 2;
    const spriteSize = Math.min(fontSize * 4, maxSpriteH);
    let spriteDrawW = 0;
    const spriteResult = this.sprites.getUnitSprite(
      hero.race, hero.category, hero.playerId, false, hero.upgradeNode,
    );
    if (spriteResult) {
      const [img, def] = spriteResult;
      const tick = Math.floor(this.animTime / 1000 * 20); // game speed: 20 ticks/sec (animTime is ms)
      const frame = getSpriteFrame(tick, def);
      const sx = frame * def.frameW;
      const scale = def.scale ?? 1.0;
      const aspect = def.frameW / def.frameH;
      const baseH = spriteSize * scale;
      const dw = baseH * aspect;
      const dh = baseH * (def.heightScale ?? 1.0);
      const spriteX = heroCardX + gap;
      const spriteY = heroCardY + (heroCardH - dh) / 2;
      ctx.drawImage(img, sx, 0, def.frameW, def.frameH, spriteX, spriteY, dw, dh);
      spriteDrawW = dw + gap;
    }

    // Text area to the right of sprite
    const textL = heroCardX + spriteDrawW + gap;
    const textAvailW = heroCardW - spriteDrawW - gap * 2;
    const textCenterX = textL + textAvailW / 2;

    // Line positions — vertically centered in taller card
    const contentH = lineH * 4.6; // total text height
    const topPad = (heroCardH - contentH) / 2;
    const line1Y = heroCardY + topPad + lineH * 0.9;
    const line2Y = line1Y + lineH;
    const line3Y = line2Y + lineH * 0.85;
    const line4Y = line3Y + lineH;
    const line5Y = line4Y + lineH * 0.85;

    // Line 1: "WAR HERO" header with shield icon
    const shieldSz = fontSize * 0.85;
    ctx.font = `bold ${Math.max(11, fontSize * 0.75)}px monospace`;
    const headerTextW = ctx.measureText('WAR HERO').width;
    const headerTotalW = shieldSz + gap * 0.5 + headerTextW;
    const headerStartX = textCenterX - headerTotalW / 2;
    this.ui.drawIcon(ctx, 'shield', headerStartX, line1Y - shieldSz * 0.7, shieldSz);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffd54f'; // bright amber — readable on dark SpecialPaper
    ctx.fillText('WAR HERO', headerStartX + shieldSz + gap * 0.5, line1Y);

    // Line 2: Unit name in race color (lightened for dark background)
    ctx.font = `bold ${fontSize * 0.9}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = this.lightenColor(raceColor, 0.45);
    const heroName = this.truncateText(ctx, hero.name, textAvailW);
    ctx.fillText(heroName, textCenterX, line2Y);

    // Line 3: Owner + category (lightened player color)
    ctx.font = `bold ${Math.max(11, fontSize * 0.65)}px monospace`;
    ctx.fillStyle = this.lightenColor(playerColor, 0.4);
    const catLabel = hero.category === 'melee' ? 'Melee' : hero.category === 'ranged' ? 'Ranged' : 'Caster';
    ctx.fillText(`${this.slotLabel(hero.playerId)}'s ${catLabel}`, textCenterX, line3Y);

    // Line 4: Kills + damage done
    const killIconSz = fontSize * 0.65;
    const dmgStr = hero.damageDone >= 1000
      ? `${(hero.damageDone / 1000).toFixed(1)}k dmg`
      : `${hero.damageDone} dmg`;
    const killText = `${hero.kills} kills · ${dmgStr}`;
    ctx.font = `bold ${Math.max(11, fontSize * 0.65)}px monospace`;
    const killTextW = ctx.measureText(killText).width;
    const killTotalW = killIconSz + gap * 0.4 + killTextW;
    const killStartX = textCenterX - killTotalW / 2;
    this.ui.drawIcon(ctx, 'sword', killStartX, line4Y - killIconSz * 0.7, killIconSz);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(killText, killStartX + killIconSz + gap * 0.4, line4Y);

    // Line 5: Survival / death status
    ctx.font = `${Math.max(11, fontSize * 0.55)}px monospace`;
    ctx.textAlign = 'center';
    const aliveTime = this.formatTickTime((hero.deathTick ?? state.tick) - hero.spawnTick);
    if (hero.survived) {
      ctx.fillStyle = '#69f0ae'; // bright green
      ctx.fillText(`Survived (${aliveTime})`, textCenterX, line5Y);
    } else {
      const deathTime = this.formatTickTime(hero.deathTick ?? state.tick);
      ctx.fillStyle = '#ff6e6e'; // bright red
      const deathText = this.truncateText(ctx, `Slain at ${deathTime} (${aliveTime})`, textAvailW);
      ctx.fillText(deathText, textCenterX, line5Y);
    }

    // --- Support Hero card ---
    const warCardBottom = heroCardY + heroCardH + gap * 2;
    const suppHeroes = state.supportHeroes;
    if (suppHeroes.length === 0) return warCardBottom;
    const supp = suppHeroes[0];

    const suppColor = PLAYER_COLORS[supp.playerId];
    const suppRaceColor = RACE_COLORS[supp.race]?.primary ?? '#fff';
    const suppCardW = heroCardW;
    const suppCardH = lineH * 6;
    const suppCardX = heroCardX;
    const suppCardY = warCardBottom;

    this.ui.drawSpecialPaper(ctx, suppCardX - cardPadX, suppCardY - cardPadY,
      suppCardW + cardPadX * 2, suppCardH + cardPadY * 2);

    // Animated sprite
    let suppSpriteW = 0;
    const suppSprite = this.sprites.getUnitSprite(supp.race, supp.category, supp.playerId, false, supp.upgradeNode);
    if (suppSprite) {
      const [img, def] = suppSprite;
      const tick = Math.floor(this.animTime * 1.5);
      const frame = getSpriteFrame(tick, def);
      const sx = frame * def.frameW;
      const scale = def.scale ?? 1.0;
      const dw = Math.min(fontSize * 4, suppCardH - gap * 2) * scale;
      const dh = dw * (def.heightScale ?? 1.0);
      const spriteX = suppCardX + gap;
      const spriteY = suppCardY + (suppCardH - dh) / 2;
      ctx.drawImage(img, sx, 0, def.frameW, def.frameH, spriteX, spriteY, dw, dh);
      suppSpriteW = dw + gap;
    }

    const suppTextL = suppCardX + suppSpriteW + gap;
    const suppAvailW = suppCardW - suppSpriteW - gap * 2;
    const suppCenterX = suppTextL + suppAvailW / 2;

    const suppContentH = lineH * 4.6;
    const suppTopPad = (suppCardH - suppContentH) / 2;
    const sl1Y = suppCardY + suppTopPad + lineH * 0.9;
    const sl2Y = sl1Y + lineH;
    const sl3Y = sl2Y + lineH * 0.85;
    const sl4Y = sl3Y + lineH;
    const sl5Y = sl4Y + lineH * 0.85;

    // Header: "SUPPORT HERO"
    const suppIconSz = fontSize * 0.85;
    ctx.font = `bold ${Math.max(10, fontSize * 0.75)}px monospace`;
    const suppHeaderW = ctx.measureText('SUPPORT HERO').width;
    const suppHeaderTotalW = suppIconSz + gap * 0.5 + suppHeaderW;
    const suppHeaderStartX = suppCenterX - suppHeaderTotalW / 2;
    this.ui.drawIcon(ctx, 'meat', suppHeaderStartX, sl1Y - suppIconSz * 0.7, suppIconSz);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#80cbc4'; // teal — distinct from War Hero amber
    ctx.fillText('SUPPORT HERO', suppHeaderStartX + suppIconSz + gap * 0.5, sl1Y);

    // Unit name
    ctx.font = `bold ${Math.max(11, fontSize * 0.9)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = this.lightenColor(suppRaceColor, 0.45);
    ctx.fillText(this.truncateText(ctx, supp.name, suppAvailW), suppCenterX, sl2Y);

    // Owner + category
    ctx.font = `bold ${Math.max(10, fontSize * 0.65)}px monospace`;
    ctx.fillStyle = this.lightenColor(suppColor, 0.4);
    const suppCat = supp.category === 'melee' ? 'Melee' : supp.category === 'ranged' ? 'Ranged' : 'Caster';
    ctx.fillText(`${this.slotLabel(supp.playerId)}'s ${suppCat}`, suppCenterX, sl3Y);

    // Stats: healing + buffs, with kills/damage as fallbacks when healing is absent
    ctx.font = `bold ${Math.max(10, fontSize * 0.65)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    const healStr = supp.healingDone > 0 ? `${supp.healingDone} healed` : '';
    const buffStr = supp.buffsApplied > 0 ? `${supp.buffsApplied} buffs` : '';
    const suppDmgStr = supp.damageDone >= 1000
      ? `${(supp.damageDone / 1000).toFixed(1)}k dmg`
      : `${supp.damageDone} dmg`;
    const killFallback = supp.healingDone === 0 && supp.kills > 0 ? `${supp.kills} kills` : '';
    const dmgFallback  = supp.healingDone === 0 && supp.damageDone > 0 ? suppDmgStr : '';
    const statsLine = [healStr, buffStr, killFallback, dmgFallback].filter(Boolean).join(' · ');
    ctx.fillText(statsLine, suppCenterX, sl4Y);

    // Survival / death
    ctx.font = `${Math.max(10, fontSize * 0.55)}px monospace`;
    const suppAliveTime = this.formatTickTime((supp.deathTick ?? state.tick) - supp.spawnTick);
    if (supp.survived) {
      ctx.fillStyle = '#69f0ae';
      ctx.fillText(`Survived (${suppAliveTime})`, suppCenterX, sl5Y);
    } else {
      const suppDeathTime = this.formatTickTime(supp.deathTick ?? state.tick);
      ctx.fillStyle = '#ff6e6e';
      ctx.fillText(this.truncateText(ctx, `Slain at ${suppDeathTime} (${suppAliveTime})`, suppAvailW), suppCenterX, sl5Y);
    }

    return suppCardY + suppCardH + gap * 2;
  }

  /** Get display name for a slot: player name, bot difficulty, or fallback P{n}. */
  private slotLabel(slotId: number): string {
    const name = this.stats?.slotNames?.[String(slotId)];
    if (name) return name;
    const diff = this.stats?.slotBotDifficulties?.[String(slotId)];
    if (diff) return `Bot ${diff.charAt(0).toUpperCase() + diff.slice(1)}`;
    return `P${slotId + 1}`;
  }

  /** Format a tick count as m:ss (20 ticks per second). */
  private formatTickTime(ticks: number): string {
    const totalSec = Math.floor(ticks / 20);
    return `${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, '0')}`;
  }

  /** Truncate text to fit within maxWidth, adding ellipsis if needed. */
  /**
   * Draws the minimap replay panel between the HQ HP section and awards.
   * Returns the height consumed so the caller can offset the awards section.
   */
  private drawMinimapReplay(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    frames: MinimapFrame[],
    canvasW: number,
    topY: number,
    fontSize: number,
  ): number {
    const mapDef = state.mapDef;
    const mapW = mapDef.width;
    const mapH = mapDef.height;

    // Panel sizing — preserves map aspect ratio, capped to available width
    const mmW = Math.min(Math.max(canvasW * 0.28, 80), 150);
    const mmH = Math.round(mmW * (mapH / mapW));
    const mmX = Math.round((canvasW - mmW) / 2);
    const mmY = topY;
    const totalH = mmH + Math.round(fontSize * 1.4);

    const frame = frames[this.replayFrameIdx];

    // --- Static background (pre-rendered offscreen: water + shape + HQ + diamond center) ---
    if (this.replayBgCanvas) {
      // 2px water-colour padding around the map shape, matching in-game minimap
      ctx.fillStyle = 'rgb(60, 110, 100)';
      ctx.fillRect(mmX - 2, mmY - 2, mmW + 4, mmH + 4);
      ctx.drawImage(this.replayBgCanvas, mmX, mmY, mmW, mmH);
    }

    // --- Active nuke zones (player-colored filled circles) ---
    for (const nuke of frame.nukes ?? []) {
      const nx = mmX + (nuke.x / mapW) * mmW;
      const ny = mmY + (nuke.y / mapH) * mmH;
      const nr = (nuke.radius / mapW) * mmW;
      const pc = PLAYER_COLORS[nuke.playerId % PLAYER_COLORS.length];
      ctx.beginPath();
      ctx.arc(nx, ny, Math.max(2, nr), 0, Math.PI * 2);
      ctx.fillStyle = pc + '55'; // 33% opacity fill
      ctx.fill();
      ctx.strokeStyle = pc + 'aa'; // 67% opacity ring
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // --- Carried diamond — bright dot over carrier position ---
    if (frame.diamond?.carried) {
      const dx = mmX + (frame.diamond.x / mapW) * mmW;
      const dy = mmY + (frame.diamond.y / mapH) * mmH;
      ctx.fillStyle = 'rgba(255, 220, 50, 1)';
      ctx.beginPath();
      ctx.arc(dx, dy, Math.max(2, mmW * 0.03), 0, Math.PI * 2);
      ctx.fill();
    }

    // --- Unit dots ---
    for (const u of frame.units) {
      const ux = mmX + (u.x / mapW) * mmW;
      const uy = mmY + (u.y / mapH) * mmH;
      ctx.fillStyle = PLAYER_COLORS[u.playerId] || (u.team === 0 ? '#2979ff' : '#ff1744');
      ctx.fillRect(ux - 1, uy - 1, 2, 2);
    }

    // --- War hero star icons (★ tinted by player color, scaled to minimap) ---
    const starSize = Math.max(6, Math.round(mmW * 0.07));
    ctx.font = `bold ${starSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const hero of frame.warHeroPositions ?? []) {
      const hx = mmX + (hero.x / mapW) * mmW;
      const hy = mmY + (hero.y / mapH) * mmH;
      // Dark outline for legibility over any background
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText('★', hx + 1, hy + 1);
      ctx.fillStyle = PLAYER_COLORS[hero.playerId % PLAYER_COLORS.length];
      ctx.fillText('★', hx, hy);
    }
    ctx.textBaseline = 'alphabetic';

    // --- Border ---
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mmX, mmY, mmW, mmH);

    // --- Scrub bar (resets to 0 on loop) ---
    const barY = mmY + mmH + 3;
    const progress = frames.length > 1 ? this.replayFrameIdx / (frames.length - 1) : 0;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(mmX, barY, mmW, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(mmX, barY, mmW * progress, 3);

    // --- Timestamp label ---
    const labelY = barY + Math.round(fontSize * 0.85);
    ctx.font = `bold ${Math.round(fontSize * 0.6)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    const elapsed = Math.floor((frame.tick ?? 0) / 20);
    const mm = Math.floor(elapsed / 60);
    const ss = String(elapsed % 60).padStart(2, '0');
    ctx.fillText(`↻ REPLAY  ${mm}:${ss}`, canvasW / 2, labelY);

    return totalH;
  }

  private truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
    return t + '…';
  }

  /** Darken a hex color by multiplying RGB channels by factor (0–1). */
  private darkenColor(hex: string, factor: number): string {
    const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return hex;
    const r = Math.round(parseInt(m[1], 16) * factor);
    const g = Math.round(parseInt(m[2], 16) * factor);
    const b = Math.round(parseInt(m[3], 16) * factor);
    return `rgb(${r},${g},${b})`;
  }

  /** Blend a hex color toward white by `factor` (0=original, 1=white). */
  private lightenColor(hex: string, factor: number): string {
    const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return hex;
    const r = Math.round(parseInt(m[1], 16) + (255 - parseInt(m[1], 16)) * factor);
    const g = Math.round(parseInt(m[2], 16) + (255 - parseInt(m[2], 16)) * factor);
    const b = Math.round(parseInt(m[3], 16) + (255 - parseInt(m[3], 16)) * factor);
    return `rgb(${r},${g},${b})`;
  }

  private computeAwards(stats: PlayerStats[]): { label: string; playerId: number; value: string }[] {
    if (stats.length === 0) return [];
    const awards: { label: string; playerId: number; value: string }[] = [];

    const best = (fn: (ps: PlayerStats) => number, label: string, fmt: (v: number) => string) => {
      let bestIdx = 0;
      let bestVal = fn(stats[0]);
      for (let i = 1; i < stats.length; i++) {
        const v = fn(stats[i]);
        if (v > bestVal) { bestVal = v; bestIdx = i; }
      }
      if (bestVal > 0) awards.push({ label, playerId: bestIdx, value: fmt(bestVal) });
    };

    best(ps => ps.totalDamageDealt, 'MVP Damage', v => `${v} dmg`);
    best(ps => ps.totalGoldEarned + ps.totalWoodEarned + ps.totalStoneEarned, 'Best Economy', v => `${v} resources`);
    best(ps => ps.totalDamageNearHQ, 'Best Defender', v => `${v} dmg near HQ`);
    best(ps => ps.totalDamageTaken, 'Most Tanked', v => `${v} taken`);
    best(ps => ps.towerDamageDealt, 'Tower Damage', v => `${v} dmg`);
    best(ps => ps.totalHealing, 'Most Healing', v => `${v} healed`);
    best(ps => ps.enemyUnitsKilled, 'Top Killer', v => `${v} kills`);
    best(ps => ps.nukeKills, 'Nuke Master', v => `${v} kills`);

    return awards;
  }
}
