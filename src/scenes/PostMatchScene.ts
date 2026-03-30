import { Scene, SceneManager } from './Scene';
import { GameState, Team, PlayerStats, MinimapFrame, HQ_WIDTH, HQ_HEIGHT, WarHero } from '../simulation/types';
import { PLAYER_COLORS, RACE_COLORS } from '../simulation/data';
import { UIAssets, IconName } from '../rendering/UIAssets';
import { SpriteLoader, getSpriteFrame } from '../rendering/SpriteLoader';
import { SoundManager } from '../audio/SoundManager';
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

type TabId = 'summary' | 'map' | 'awards';

export class PostMatchScene implements Scene {
  private manager: SceneManager;
  private canvas: HTMLCanvasElement;
  private ui: UIAssets;
  private sprites: SpriteLoader;
  private stats: MatchStats | null = null;
  private sfx = new SoundManager();
  private animTime = 0;
  private clickHandler: ((e: MouseEvent) => void) | null = null;

  // Tab state
  private activeTab: TabId = 'summary';
  private tabRects: { id: TabId; x: number; y: number; w: number; h: number }[] = [];

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

  // Summary sort state
  private sortCol: 'res' | 'kills' | 'lost' | 'dmg' | null = null;
  private sortAsc = false;
  private colHeaderRects: { col: 'res' | 'kills' | 'lost' | 'dmg'; x: number; y: number; w: number; h: number }[] = [];

  // Hover state
  private mouseX = -1;
  private mouseY = -1;
  private mouseMoveHandler: ((e: MouseEvent) => void) | null = null;

  // Tab animation state — tracks time since first visit per tab
  private tabFirstVisit: Record<TabId, boolean> = { summary: false, map: false, awards: false };
  private tabAnimTime: Record<TabId, number> = { summary: 0, map: 0, awards: 0 };

  // Confetti particles for awards fanfare
  private confetti: {
    x: number; y: number; vx: number; vy: number;
    life: number; maxLife: number; size: number;
    color: string; rot: number; rotSpeed: number; wobble: number;
  }[] = [];
  /** Tracks which award/hero indices have already spawned confetti. */
  private confettiFired = new Set<string>();

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
    this.activeTab = 'summary';
    this.sortCol = null;
    this.sortAsc = false;
    this.tabFirstVisit = { summary: false, map: false, awards: false };
    this.tabAnimTime = { summary: 0, map: 0, awards: 0 };
    this.confetti = [];
    this.confettiFired = new Set();

    const frames = stats.replayFrames;
    if (frames && frames.length > 0) {
      const TARGET_REPLAY_MS = Math.min(30_000, Math.max(15_000, frames.length * 25));
      this.replayFrameDur = TARGET_REPLAY_MS / frames.length;
      this.replayBgCanvas = this.buildMinimapBg(stats.state);
    }
  }

  private buildMinimapBg(state: GameState): HTMLCanvasElement {
    const mapDef = state.mapDef;
    const mapW = mapDef.width;
    const mapH = mapDef.height;
    const BG_W = 160;
    const BG_H = Math.round(BG_W * (mapH / mapW));

    const bg = document.createElement('canvas');
    bg.width = BG_W;
    bg.height = BG_H;
    const c = bg.getContext('2d')!;

    const tx = (wx: number) => (wx / mapW) * BG_W;
    const ty2 = (wy: number) => (wy / mapH) * BG_H;

    c.fillStyle = 'rgb(60, 110, 100)';
    c.fillRect(0, 0, BG_W, BG_H);

    c.beginPath();
    if (mapDef.shapeAxis === 'y') {
      for (let y = 0; y <= mapH; y += 4) {
        const range = mapDef.getPlayableRange(y);
        if (y === 0) c.moveTo(tx(range.min), ty2(y));
        else c.lineTo(tx(range.min), ty2(y));
      }
      for (let y = mapH; y >= 0; y -= 4) {
        const range = mapDef.getPlayableRange(y);
        c.lineTo(tx(range.max), ty2(y));
      }
    } else {
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
    this.sfx.enableTabSuspend();

    // Party games return to lobby, solo/tutorial games return to title menu
    const continueTarget = 'title';

    let lastTouchTime = 0;
    this.clickHandler = (e) => {
      if (Date.now() - lastTouchTime < 300) return;
      const rect = this.canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      if (this.handleTabClick(cx, cy)) return;
      if (this.handleColHeaderClick(cx, cy)) return;
      if (this.isButtonAt(cx, cy)) { this.sfx.playUIConfirm(); this.manager.switchTo(continueTarget); }
    };

    this.mouseMoveHandler = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouseX = e.clientX - rect.left;
      this.mouseY = e.clientY - rect.top;
    };

    this.keyHandler = (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
        this.sfx.playUIConfirm();
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
      if (this.handleTabClick(cx, cy)) return;
      if (this.handleColHeaderClick(cx, cy)) return;
      if (this.isButtonAt(cx, cy)) { this.sfx.playUIConfirm(); this.manager.switchTo(continueTarget); }
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
    this.canvas.addEventListener('mousemove', this.mouseMoveHandler);
    window.addEventListener('keydown', this.keyHandler);
    this.canvas.addEventListener('touchstart', this.touchHandler, { passive: false });
    this.canvas.addEventListener('wheel', this.wheelHandler, { passive: false });
    this.canvas.addEventListener('touchmove', this.touchMoveHandler, { passive: false });
  }

  exit(): void {
    if (this.clickHandler) this.canvas.removeEventListener('click', this.clickHandler);
    if (this.mouseMoveHandler) this.canvas.removeEventListener('mousemove', this.mouseMoveHandler);
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    if (this.touchHandler) this.canvas.removeEventListener('touchstart', this.touchHandler);
    if (this.wheelHandler) this.canvas.removeEventListener('wheel', this.wheelHandler);
    if (this.touchMoveHandler) this.canvas.removeEventListener('touchmove', this.touchMoveHandler);
    this.clickHandler = null;
    this.mouseMoveHandler = null;
    this.keyHandler = null;
    this.touchHandler = null;
    this.wheelHandler = null;
    this.touchMoveHandler = null;
    this.sfx.disableTabSuspend();
  }

  private handleTabClick(cx: number, cy: number): boolean {
    for (const tab of this.tabRects) {
      if (cx >= tab.x && cx <= tab.x + tab.w && cy >= tab.y && cy <= tab.y + tab.h) {
        if (this.activeTab !== tab.id) {
          this.activeTab = tab.id;
          this.scrollY = 0;
          this.sfx.playUITab();
        }
        return true;
      }
    }
    return false;
  }

  private handleColHeaderClick(cx: number, cy: number): boolean {
    if (this.activeTab !== 'summary') return false;
    // Adjust for scroll offset
    const adjustedCy = cy + this.scrollY;
    for (const hdr of this.colHeaderRects) {
      if (cx >= hdr.x && cx <= hdr.x + hdr.w && adjustedCy >= hdr.y && adjustedCy <= hdr.y + hdr.h) {
        if (this.sortCol === hdr.col) {
          this.sortAsc = !this.sortAsc;
        } else {
          this.sortCol = hdr.col;
          this.sortAsc = false; // default descending (highest first)
        }
        this.sfx.playUIClick();
        return true;
      }
    }
    return false;
  }

  private getResourceScore(ps: PlayerStats): number {
    return Math.floor(ps.totalGoldEarned / 2) + ps.totalWoodEarned + ps.totalMeatEarned;
  }

  private getSortValue(ps: PlayerStats, col: 'res' | 'kills' | 'lost' | 'dmg'): number {
    switch (col) {
      case 'res': return this.getResourceScore(ps);
      case 'kills': return ps.enemyUnitsKilled;
      case 'lost': return ps.unitsLost;
      case 'dmg': return ps.totalDamageDealt;
    }
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

    // Track first visit + advance per-tab animation clock
    const tab = this.activeTab;
    if (!this.tabFirstVisit[tab]) {
      this.tabFirstVisit[tab] = true;
      this.tabAnimTime[tab] = 0;
    }
    this.tabAnimTime[tab] += dt;

    // Update confetti particles
    if (this.confetti.length > 0) {
      const dtSec = dt / 1000;
      this.confetti = this.confetti.filter(p => {
        p.life -= dt;
        if (p.life <= 0) return false;
        p.x += p.vx * dtSec;
        p.y += p.vy * dtSec;
        p.vy += 90 * dtSec;
        p.vx *= 0.99;
        p.vx += Math.sin(p.wobble + p.life * 0.005) * 25 * dtSec;
        p.rot += p.rotSpeed * dtSec;
        return true;
      });
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

    // Global vertical nudge — shift everything except Continue button up
    const yNudge = -10;

    // VICTORY / DEFEAT banner
    const headerBannerW = Math.min(w * 0.75, 540);
    const headerBannerH = Math.min(90, h * 0.1);
    const headerBannerX = (w - headerBannerW) / 2;
    const headerBannerY = h * 0.02 + getSafeTop() + yNudge;
    this.ui.drawBigRibbon(ctx, headerBannerX, headerBannerY, headerBannerW, headerBannerH, won ? 0 : 1);

    ctx.font = `bold ${fontSize * 2.2}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText(won ? 'VICTORY' : 'DEFEAT', w / 2, headerBannerY + headerBannerH * 0.62);

    // Win condition + match time + HQ bars — below banner, above panel
    const condText = state.winCondition === 'military' ? 'HQ Destroyed'
      : state.winCondition === 'diamond' ? 'Diamond Delivered'
      : state.winCondition === 'timeout' ? 'Time Expired'
      : state.winCondition === 'concede' ? 'Conceded' : '';
    const totalSec = Math.floor(state.tick / 20);
    const condY = headerBannerY + headerBannerH + 18;
    ctx.font = `bold ${fontSize * 0.85}px monospace`;
    ctx.fillStyle = '#ddd';
    ctx.textAlign = 'center';
    ctx.fillText(`${condText}  \u2014  ${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, '0')}`, w / 2, condY);

    // HQ HP bars right below condition text
    const barW = Math.min(80, w * 0.12);
    const barH = 12;
    const hqGap = Math.round(fontSize * 0.5);
    const ourHp = Math.max(0, state.hqHp[localTeam]);
    const enemyTeam = localTeam === Team.Bottom ? Team.Top : Team.Bottom;
    const enemyHp = Math.max(0, state.hqHp[enemyTeam]);
    const hpBarY = condY + 6;

    ctx.font = `bold ${Math.max(10, fontSize * 0.6)}px monospace`;
    const usLabel = `US ${ourHp}`;
    const usLabelW = ctx.measureText(usLabel).width;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#5599dd';
    ctx.fillText(usLabel, w / 2 - hqGap, hpBarY + 12);
    this.ui.drawBar(ctx, w / 2 - hqGap - usLabelW - barW - 4, hpBarY + 2, barW, barH, ourHp / 1000);
    const enLabel = `ENEMY ${enemyHp}`;
    const enLabelW = ctx.measureText(enLabel).width;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#dd5555';
    ctx.fillText(enLabel, w / 2 + hqGap, hpBarY + 12);
    this.ui.drawBar(ctx, w / 2 + hqGap + enLabelW + 4, hpBarY + 2, barW, barH, enemyHp / 1000);

    // Panel + tab dimensions (computed together so tabs span the panel)
    const panelW = Math.min(w * 0.96, 1160);
    const panelX = (w - panelW) / 2;
    const tabY = hpBarY + 28;
    const tabH = fontSize * 2.2;
    this.drawTabs(ctx, w, tabY, fontSize, panelX, panelW, tabH);
    const tabBarBottom = tabY + tabH;

    // Panel background — dark semi-transparent, flush with tabs
    const panelTop = tabBarBottom;
    const panelH = h * 0.96 - panelTop;
    ctx.fillStyle = 'rgba(12, 10, 8, 0.75)';
    ctx.beginPath();
    ctx.roundRect(panelX, panelTop, panelW, panelH, [0, 0, 8, 8]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(180, 140, 80, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(panelX, panelTop, panelW, panelH, [0, 0, 8, 8]);
    ctx.stroke();

    // Inner content area
    const pad = panelW * 0.04;
    const innerL = panelX + pad;
    const innerR = panelX + panelW - pad;
    const innerW = innerR - innerL;

    // Scrollable content
    ctx.save();
    // Clip to panel area
    ctx.beginPath();
    ctx.rect(panelX, panelTop, panelW, panelH);
    ctx.clip();
    ctx.translate(0, -Math.round(this.scrollY));

    const contentStartY = panelTop + 32;
    let contentBottom = contentStartY;

    if (this.activeTab === 'summary') {
      contentBottom = this.drawSummaryTab(ctx, state, w, innerL, innerR, innerW, contentStartY, fontSize);
    } else if (this.activeTab === 'map') {
      contentBottom = this.drawMapTab(ctx, state, w, contentStartY, fontSize);
    } else if (this.activeTab === 'awards') {
      contentBottom = this.drawAwardsTab(ctx, state, w, innerW, contentStartY, fontSize);
    }

    ctx.restore();

    // Confetti draws above the panel (unclipped)
    this.drawConfetti(ctx);

    this.maxScrollY = Math.max(0, contentBottom - h * 0.85);

    // Continue button — fixed at bottom
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
      ctx.fillText('\u25BC scroll', w / 2, h * 0.87);
    }
  }

  private drawTabs(
    ctx: CanvasRenderingContext2D, _w: number, y: number, fontSize: number,
    panelX: number, panelW: number, tabH: number,
  ): void {
    const tabs: { id: TabId; label: string }[] = [
      { id: 'summary', label: 'SUMMARY' },
      { id: 'map', label: 'MAP' },
      { id: 'awards', label: 'AWARDS' },
    ];
    // Tabs span the full panel width, divided equally
    const tabW = panelW / tabs.length;

    this.tabRects = [];
    for (let i = 0; i < tabs.length; i++) {
      const tx = panelX + i * tabW;
      const active = this.activeTab === tabs[i].id;

      // First tab gets top-left radius, last tab gets top-right radius
      const rTL = i === 0 ? 8 : 0;
      const rTR = i === tabs.length - 1 ? 8 : 0;

      ctx.fillStyle = active ? 'rgba(12, 10, 8, 0.75)' : 'rgba(30, 25, 20, 0.4)';
      ctx.beginPath();
      ctx.roundRect(tx, y, tabW, tabH, [rTL, rTR, 0, 0]);
      ctx.fill();

      if (active) {
        // Border on top and sides only (not bottom — that's the panel edge)
        ctx.strokeStyle = 'rgba(180,140,80,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(tx, y + tabH);
        ctx.lineTo(tx, y + rTL);
        if (rTL > 0) ctx.arcTo(tx, y, tx + rTL, y, rTL);
        ctx.lineTo(tx + tabW - rTR, y);
        if (rTR > 0) ctx.arcTo(tx + tabW, y, tx + tabW, y + rTR, rTR);
        ctx.lineTo(tx + tabW, y + tabH);
        ctx.stroke();
      } else {
        // Subtle bottom divider for inactive tabs
        ctx.strokeStyle = 'rgba(180,140,80,0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(tx, y + tabH);
        ctx.lineTo(tx + tabW, y + tabH);
        ctx.stroke();
      }

      // Vertical separator between tabs (except after last)
      if (i < tabs.length - 1) {
        ctx.strokeStyle = 'rgba(180,140,80,0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(tx + tabW, y + 4);
        ctx.lineTo(tx + tabW, y + tabH - 4);
        ctx.stroke();
      }

      ctx.font = `bold ${Math.max(11, fontSize * 0.7)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = active ? '#ffd54f' : 'rgba(255,255,255,0.45)';
      ctx.fillText(tabs[i].label, tx + tabW / 2, y + tabH * 0.62);

      this.tabRects.push({ id: tabs[i].id, x: tx, y, w: tabW, h: tabH });
    }
  }

  // ---- SUMMARY TAB ----
  private drawSummaryTab(
    ctx: CanvasRenderingContext2D, state: GameState,
    _w: number, innerL: number, innerR: number, innerW: number,
    startY: number, fontSize: number,
  ): number {
    const pStats = state.playerStats ?? [];
    const localPlayerId = this.stats!.localPlayerId;
    const localTeam = state.players[localPlayerId]?.team ?? Team.Bottom;

    // Animation: staggered row reveal
    const tabAnim = this.tabAnimTime.summary;
    const animDone = tabAnim > 2000; // all animations complete after 2s

    const tableFontSize = Math.max(11, fontSize * 0.7);
    const tableY = startY;
    const rowH = tableFontSize * 2.4;

    // Columns: PLAYER | RES | KILLS | LOST | DMG
    const colPositions = [
      innerL,                    // 0: PLAYER left edge
      innerL + innerW * 0.45,   // 1: RES (right-aligned)
      innerL + innerW * 0.60,   // 2: KILLS
      innerL + innerW * 0.75,   // 3: LOST
      innerL + innerW * 0.92,   // 4: DMG
    ];

    const hdrFontSize = Math.max(11, tableFontSize * 0.85);
    ctx.font = `bold ${hdrFontSize}px monospace`;
    const hdrH = tableFontSize * 1.8;

    // Column definitions
    type ColDef = { col: 'res' | 'kills' | 'lost' | 'dmg'; label: string; x: number; tooltip: string };
    const cols: ColDef[] = [
      { col: 'res', label: 'RES', x: colPositions[1],
        tooltip: 'Resources: gold/2 + wood + meat' },
      { col: 'kills', label: 'KILLS', x: colPositions[2],
        tooltip: 'Enemy units killed' },
      { col: 'lost', label: 'LOST', x: colPositions[3],
        tooltip: 'Friendly units lost' },
      { col: 'dmg', label: 'DMG', x: colPositions[4],
        tooltip: 'Total damage dealt' },
    ];

    // Build header hit rects (in scrollable coordinates)
    this.colHeaderRects = [];
    const hdrTop = tableY - hdrH * 0.65;
    for (const c of cols) {
      const labelW = ctx.measureText(c.label).width + 16;
      this.colHeaderRects.push({
        col: c.col,
        x: c.x - labelW, y: hdrTop,
        w: labelW, h: hdrH,
      });
    }

    // Draw header labels (fade in first)
    const hdrAlpha = animDone ? 1 : this.easeOut(tabAnim / 300);
    ctx.save();
    if (!animDone) ctx.globalAlpha = hdrAlpha;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#c4a060';
    ctx.fillText('PLAYER', colPositions[0], tableY);

    // Check mouse hover for headers (adjust for scroll)
    const adjustedMouseY = this.mouseY + this.scrollY;
    let hoveredCol: ColDef | null = null;

    for (const c of cols) {
      const isActive = this.sortCol === c.col;
      const arrow = isActive ? (this.sortAsc ? ' \u25B2' : ' \u25BC') : '';
      ctx.textAlign = 'right';

      // Hover detection
      const labelW = ctx.measureText(c.label + arrow).width + 16;
      const isHovered = this.mouseX >= c.x - labelW && this.mouseX <= c.x
        && adjustedMouseY >= hdrTop && adjustedMouseY <= hdrTop + hdrH;

      if (isHovered) {
        hoveredCol = c;
        ctx.fillStyle = '#ffd54f';
      } else if (isActive) {
        ctx.fillStyle = '#e0c070';
      } else {
        ctx.fillStyle = '#c4a060';
      }
      ctx.fillText(c.label + arrow, c.x, tableY);
    }

    // Header divider
    ctx.strokeStyle = 'rgba(180,140,80,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(innerL, tableY + 8);
    ctx.lineTo(innerR, tableY + 8);
    ctx.stroke();
    ctx.restore();

    const TEAM_STRIPE: Record<number, string> = {
      [Team.Bottom]: '#2979ff',
      [Team.Top]: '#ff1744',
    };

    const enemyTeam2 = localTeam === Team.Bottom ? Team.Top : Team.Bottom;
    const teamGroups: Array<{ team: Team; indices: number[] }> = [];
    for (const t of [localTeam, enemyTeam2]) {
      const indices: number[] = [];
      for (let i = 0; i < state.players.length; i++) {
        if (!state.players[i].isEmpty && state.players[i].team === t) indices.push(i);
      }
      // Sort within team if a sort column is active
      if (this.sortCol && indices.length > 1) {
        const col = this.sortCol;
        const asc = this.sortAsc;
        indices.sort((a, b) => {
          const va = this.getSortValue(pStats[a], col);
          const vb = this.getSortValue(pStats[b], col);
          return asc ? va - vb : vb - va;
        });
      }
      if (indices.length > 0) teamGroups.push({ team: t, indices });
    }

    let rowIdx = 0;
    for (const { team, indices } of teamGroups) {
      rowIdx++;
      const hdrY = tableY + rowIdx * rowH;
      const hdrRowTop = hdrY - rowH * 0.65;
      const stripeColor = TEAM_STRIPE[team];
      const isWinnerTeam = state.winner === team;
      const isLocalTeam = team === localTeam;

      // Animate team header row
      const hdrDelay = rowIdx * 80;
      const hdrProgress = animDone ? 1 : this.easeOut((tabAnim - hdrDelay) / 350);
      if (hdrProgress <= 0) { rowIdx += indices.length; continue; }

      ctx.save();
      if (!animDone) {
        ctx.globalAlpha = hdrProgress;
        ctx.translate((1 - hdrProgress) * -40, 0);
      }

      ctx.fillStyle = stripeColor + '18';
      ctx.fillRect(innerL, hdrRowTop, innerW, rowH);
      ctx.fillStyle = stripeColor;
      ctx.fillRect(innerL, hdrRowTop, 5, rowH);

      const teamLabel = isLocalTeam ? 'YOUR TEAM' : 'ENEMY TEAM';
      const outcomeLabel = isWinnerTeam ? 'VICTORY' : 'DEFEAT';
      ctx.font = `bold ${tableFontSize * 0.75}px monospace`;
      ctx.textAlign = 'left';
      ctx.fillStyle = this.lightenColor(stripeColor, 0.3);
      ctx.fillText(`${teamLabel}  \u00b7  ${outcomeLabel}`, innerL + 10, hdrY - 2);
      ctx.restore();

      for (const i of indices) {
        const p = state.players[i];
        const ps = pStats[i];
        rowIdx++;

        // Animate each player row
        const rowDelay = rowIdx * 80;
        const rowProgress = animDone ? 1 : this.easeOut((tabAnim - rowDelay) / 350);
        if (rowProgress <= 0) continue;

        const y = tableY + rowIdx * rowH;
        const rowTop = y - rowH * 0.65;

        ctx.save();
        if (!animDone) {
          ctx.globalAlpha = rowProgress;
          ctx.translate((1 - rowProgress) * -40, 0);
        }

        if (rowIdx % 2 === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.04)';
          ctx.fillRect(innerL, rowTop, innerW, rowH);
        }
        if (i === localPlayerId) {
          ctx.fillStyle = 'rgba(41,121,255,0.12)';
          ctx.fillRect(innerL, rowTop, innerW, rowH);
        }

        ctx.fillStyle = stripeColor + 'bb';
        ctx.fillRect(innerL, rowTop, 5, rowH);

        const raceColor = RACE_COLORS[p.race]?.primary ?? '#888';
        let textX = colPositions[0] + 8;

        ctx.fillStyle = raceColor;
        const dotR = tableFontSize * 0.32;
        ctx.beginPath();
        ctx.arc(textX + dotR, y - dotR + 1, dotR, 0, Math.PI * 2);
        ctx.fill();
        textX += dotR * 2 + 4;

        const label = this.slotLabel(i);
        const raceStr = p.race.charAt(0).toUpperCase() + p.race.slice(1);
        const fullText = `${label} ${raceStr}`;
        ctx.font = `bold ${tableFontSize}px monospace`;
        const maxTextW = colPositions[1] - textX - 8;
        const truncated = this.truncateText(ctx, fullText, maxTextW);
        ctx.textAlign = 'left';
        const pc = PLAYER_COLORS[i % PLAYER_COLORS.length];
        ctx.fillStyle = this.lightenColor(pc, 0.3);
        ctx.fillText(truncated, textX, y);

        // Data columns
        ctx.font = `${tableFontSize}px monospace`;
        ctx.fillStyle = '#c8b090';
        ctx.textAlign = 'right';
        const resScore = this.getResourceScore(ps);
        ctx.fillText(`${resScore}`, colPositions[1], y);
        ctx.fillText(`${ps?.enemyUnitsKilled ?? 0}`, colPositions[2], y);
        ctx.fillText(`${ps?.unitsLost ?? 0}`, colPositions[3], y);
        ctx.font = `bold ${tableFontSize}px monospace`;
        ctx.fillText(`${ps?.totalDamageDealt ?? 0}`, colPositions[4], y);
        ctx.restore();
      }
    }

    const contentBottom = tableY + (rowIdx + 1) * rowH + 12;

    // Tooltip for hovered column header
    if (hoveredCol) {
      const tipFont = Math.max(10, fontSize * 0.55);
      ctx.font = `${tipFont}px monospace`;
      const tipText = hoveredCol.tooltip;
      const tipW = ctx.measureText(tipText).width + 16;
      const tipH = tipFont + 10;
      const tipX = Math.min(Math.max(hoveredCol.x - tipW / 2, innerL), innerR - tipW);
      const tipY = tableY + 12;

      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.beginPath();
      ctx.roundRect(tipX, tipY, tipW, tipH, 4);
      ctx.fill();
      ctx.strokeStyle = 'rgba(180,140,80,0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#e0d0b0';
      ctx.textAlign = 'center';
      ctx.fillText(tipText, tipX + tipW / 2, tipY + tipFont + 2);
    }

    return contentBottom;
  }

  // ---- MAP TAB ----
  private drawMapTab(
    ctx: CanvasRenderingContext2D, state: GameState,
    canvasW: number, startY: number, fontSize: number,
  ): number {
    const frames = this.stats?.replayFrames;
    if (!frames || frames.length === 0) {
      ctx.font = `bold ${fontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#c4a060';
      ctx.fillText('No replay data', canvasW / 2, startY + 40);
      return startY + 80;
    }

    return startY + this.drawMinimapReplay(ctx, state, frames, canvasW, startY, fontSize);
  }

  // ---- AWARDS TAB ----
  private drawAwardsTab(
    ctx: CanvasRenderingContext2D, state: GameState,
    w: number, innerW: number, startY: number, fontSize: number,
  ): number {
    const pStats = state.playerStats ?? [];
    const awards = this.computeAwards(pStats);
    const awardIcons: Record<string, IconName> = {
      'MVP Damage': 'sword', 'Best Economy': 'gold', 'Best Defender': 'shield',
      'Top Killer': 'nuke', 'Nuke Master': 'nuke', 'Diamond Runner': 'diamond',
      'Tower Damage': 'sword', 'Most Healing': 'mana', 'Most Tanked': 'shield',
      'Top Support': 'star',
    };
    const gap = Math.round(fontSize * 0.5);
    let y = startY;

    const tabAnim = this.tabAnimTime.awards;
    // Each award: 300ms apart, each hero: 400ms apart after awards finish
    const AWARD_INTERVAL = 300;
    const HERO_INTERVAL = 400;
    const AWARD_ANIM_DUR = 350;
    const HERO_ANIM_DUR = 450;
    const totalAnimTime = 200 + awards.length * AWARD_INTERVAL + 4 * HERO_INTERVAL + HERO_ANIM_DUR;
    const animDone = tabAnim > totalAnimTime;

    // Player awards — 3 per row, sequential reveal with individual confetti
    if (awards.length > 0) {
      const cols = 3;
      const cardGap = gap;
      const totalGapPerRow = cardGap * (cols - 1);
      const cardW = Math.min(Math.floor((innerW - totalGapPerRow) / cols), 220);
      const cardH = fontSize * 4.8;
      const totalRowW = cardW * cols + totalGapPerRow;
      const rowStartX = (w - totalRowW) / 2;

      for (let i = 0; i < awards.length; i++) {
        const a = awards[i];
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cx = rowStartX + col * (cardW + cardGap);
        const cy = y + row * (cardH + cardGap);

        // Sequential timing: each award appears one after another
        const delay = 200 + i * AWARD_INTERVAL;
        const progress = animDone ? 1 : this.easeOut((tabAnim - delay) / AWARD_ANIM_DUR);
        if (progress <= 0) continue;

        // Fire confetti when this award first becomes visible
        const confKey = `award_${i}`;
        if (!animDone && !this.confettiFired.has(confKey) && progress > 0) {
          this.confettiFired.add(confKey);
          // Confetti spawns at the card center (adjust for scroll)
          const screenY = cy + cardH / 2 - this.scrollY;
          this.spawnConfetti(cx + cardW / 2, screenY, 15);
        }

        ctx.save();
        if (!animDone) {
          const cardMidX = cx + cardW / 2;
          const cardMidY = cy + cardH / 2;
          ctx.globalAlpha = progress;
          // Pop-in: overshoot scale then settle
          const scale = progress < 1 ? 0.3 + 0.85 * progress - 0.15 * Math.sin(progress * Math.PI) * (1 - progress) : 1;
          ctx.translate(cardMidX, cardMidY);
          ctx.scale(scale, scale);
          ctx.translate(-cardMidX, -cardMidY);
        }

        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.strokeStyle = 'rgba(180,140,80,0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(cx, cy, cardW, cardH, 5);
        ctx.fill();
        ctx.stroke();

        const cardCenterX = cx + cardW / 2;
        const iconSz = fontSize * 1.6;
        const icon = awardIcons[a.label] ?? 'sword';
        const inset = gap;

        this.ui.drawIcon(ctx, icon, cardCenterX - iconSz / 2, cy + inset, iconSz);

        ctx.font = `bold ${Math.max(11, fontSize * 0.6)}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#c4a060';
        const label = this.truncateText(ctx, a.label.toUpperCase(), cardW - inset * 2);
        ctx.fillText(label, cardCenterX, cy + inset + iconSz + fontSize * 0.7);

        ctx.font = `bold ${Math.max(11, fontSize * 0.7)}px monospace`;
        ctx.fillStyle = this.lightenColor(PLAYER_COLORS[a.playerId % PLAYER_COLORS.length], 0.3);
        const name = this.truncateText(ctx, this.slotLabel(a.playerId), cardW - inset * 2);
        ctx.fillText(name, cardCenterX, cy + inset + iconSz + fontSize * 1.5);

        ctx.font = `${Math.max(11, fontSize * 0.55)}px monospace`;
        ctx.fillStyle = '#a89070';
        ctx.fillText(a.value, cardCenterX, cy + inset + iconSz + fontSize * 2.2);
        ctx.restore();
      }
      const rows = Math.ceil(awards.length / cols);
      y += rows * (cardH + cardGap) + gap;
    }

    // Unit hero cards — sequential after awards, each with own confetti
    y = this.drawHeroCards(ctx, state, w, innerW, y, fontSize,
      200 + awards.length * AWARD_INTERVAL, HERO_INTERVAL, HERO_ANIM_DUR, animDone);

    return y;
  }

  private drawHeroCards(
    ctx: CanvasRenderingContext2D, state: GameState,
    w: number, innerW: number, y: number, fontSize: number,
    baseDelay: number, interval: number, animDur: number, animDone: boolean,
  ): number {
    const gap = Math.round(fontSize * 0.5);
    const lineH = fontSize * 1.1;
    const tabAnim = this.tabAnimTime.awards;

    // Collect hero entries: [heroes array, title, icon, titleColor]
    const heroEntries: [WarHero[], string, IconName, string][] = [
      [state.warHeroes, 'THE REAPER', 'sword', '#ffd54f'],
      [state.tankHeroes, 'IRON WALL', 'shield', '#90caf9'],
      [state.supportHeroes, 'BATTLE SAGE', 'star', '#ce93d8'],
      [state.healerHeroes, 'LIFE WEAVER', 'mana', '#80cbc4'],
    ];

    // Filter to only heroes that exist
    const activeHeroes = heroEntries.filter(([arr]) => arr.length > 0);
    if (activeHeroes.length === 0) return y;

    // 2-column grid layout
    const cols = Math.min(2, activeHeroes.length);
    const cardGap = gap;
    const cardW = Math.min(Math.floor((innerW - cardGap) / cols), 340);
    const cardH = lineH * 6;
    const totalRowW = cardW * cols + cardGap * (cols - 1);
    const rowStartX = (w - totalRowW) / 2;

    for (let i = 0; i < activeHeroes.length; i++) {
      const [heroes, title, icon, titleColor] = activeHeroes[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = rowStartX + col * (cardW + cardGap);
      const cy = y + row * (cardH + cardGap + gap);

      // Sequential reveal: each hero appears after the previous
      const delay = baseDelay + 200 + i * interval;
      const progress = animDone ? 1 : this.easeOut((tabAnim - delay) / animDur);
      if (progress <= 0) continue;

      // Fire confetti when this hero first becomes visible
      const confKey = `hero_${i}`;
      if (!animDone && !this.confettiFired.has(confKey) && progress > 0) {
        this.confettiFired.add(confKey);
        const screenY = cy + cardH / 2 - this.scrollY;
        this.spawnConfetti(cx + cardW / 2, screenY, 25);
      }

      ctx.save();
      if (!animDone) {
        const slideDir = col === 0 ? -1 : 1;
        ctx.globalAlpha = progress;
        ctx.translate(slideDir * (1 - progress) * 60, 0);
      }

      this.drawUnitHeroCard(ctx, heroes[0], title, icon, titleColor,
        cx, cardW, cy, fontSize, lineH, gap);
      ctx.restore();
    }

    const rows = Math.ceil(activeHeroes.length / cols);
    y += rows * (cardH + cardGap + gap);

    return y;
  }

  private drawUnitHeroCard(
    ctx: CanvasRenderingContext2D,
    hero: WarHero,
    title: string, icon: IconName, titleColor: string,
    cardX: number, cardW: number, y: number, fontSize: number, lineH: number, gap: number,
  ): number {
    const playerColor = PLAYER_COLORS[hero.playerId % PLAYER_COLORS.length];
    const raceColor = RACE_COLORS[hero.race]?.primary ?? '#fff';

    const heroCardW = cardW;
    const heroCardH = lineH * 6;
    const heroCardX = cardX;

    // Dark card background
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.strokeStyle = titleColor + '44';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(heroCardX, y, heroCardW, heroCardH, 6);
    ctx.fill();
    ctx.stroke();

    // Subtle top accent line
    ctx.fillStyle = titleColor + '33';
    ctx.beginPath();
    ctx.roundRect(heroCardX, y, heroCardW, 3, [6, 6, 0, 0]);
    ctx.fill();

    // Fixed-width sprite column so all hero cards have consistent text layout
    const maxSpriteH = heroCardH - gap * 2;
    const spriteSize = Math.min(fontSize * 3.5, maxSpriteH);
    const spriteColW = Math.round(spriteSize * 1.1);
    const spriteResult = this.sprites.getUnitSprite(
      hero.race, hero.category, hero.playerId, false, hero.upgradeNode,
    );
    if (spriteResult) {
      const [img, def] = spriteResult;
      const tick = Math.floor(this.animTime / 1000 * 8);
      const frame = getSpriteFrame(tick, def);
      const sx = frame * def.frameW;
      const scale = def.scale ?? 1.0;
      const aspect = def.frameW / def.frameH;
      const baseH = spriteSize * scale;
      const dw = baseH * aspect;
      const dh = baseH * (def.heightScale ?? 1.0);
      // Center sprite within the fixed column
      const spriteX = heroCardX + Math.max(0, (spriteColW - dw) / 2);
      const spriteY = y + (heroCardH - dh) / 2;
      ctx.drawImage(img, sx, 0, def.frameW, def.frameH, spriteX, spriteY, dw, dh);
    }

    const textL = heroCardX + spriteColW + gap * 0.5;
    const textAvailW = heroCardW - spriteColW - gap;
    const textCenterX = textL + textAvailW / 2;

    const contentH = lineH * 4.2;
    const topPad = (heroCardH - contentH) / 2;
    const line1Y = y + topPad + lineH * 0.9;
    const line2Y = line1Y + lineH;
    const line3Y = line2Y + lineH * 0.85;
    const line4Y = line3Y + lineH;
    const line5Y = line4Y + lineH * 0.85;

    // Title
    const shieldSz = fontSize * 0.75;
    ctx.font = `bold ${Math.max(10, fontSize * 0.65)}px monospace`;
    const headerTextW = ctx.measureText(title).width;
    const headerTotalW = shieldSz + gap * 0.5 + headerTextW;
    const headerStartX = textCenterX - headerTotalW / 2;
    this.ui.drawIcon(ctx, icon, headerStartX, line1Y - shieldSz * 0.7, shieldSz);
    ctx.textAlign = 'left';
    ctx.fillStyle = titleColor;
    ctx.fillText(title, headerStartX + shieldSz + gap * 0.5, line1Y);

    // Unit name
    ctx.font = `bold ${fontSize * 0.8}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = this.lightenColor(raceColor, 0.45);
    ctx.fillText(this.truncateText(ctx, hero.name, textAvailW), textCenterX, line2Y);

    // Owner (player name only, no category)
    ctx.font = `bold ${Math.max(10, fontSize * 0.55)}px monospace`;
    ctx.fillStyle = this.lightenColor(playerColor, 0.4);
    ctx.fillText(this.slotLabel(hero.playerId), textCenterX, line3Y);

    // Stats line — context-aware based on hero type
    ctx.font = `bold ${Math.max(10, fontSize * 0.6)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ddd';
    const healingDone = hero.healingDone ?? 0;
    const buffsApplied = hero.buffsApplied ?? 0;
    const damageTaken = hero.damageTaken ?? 0;
    const parts: string[] = [];
    if (damageTaken > 0 && title === 'IRON WALL') {
      parts.push(damageTaken >= 1000 ? `${(damageTaken / 1000).toFixed(1)}k tanked` : `${damageTaken} tanked`);
    } else if (healingDone > 0 && title === 'LIFE WEAVER') {
      parts.push(`${healingDone} healed`);
    } else if (buffsApplied > 0 && title === 'BATTLE SAGE') {
      parts.push(`${buffsApplied} buffs`);
    } else {
      parts.push(`${hero.kills} kills`);
    }
    const statsLine = parts.join(' \u00b7 ');
    const killIconSz = fontSize * 0.6;
    const maxStatsW = textAvailW - killIconSz - gap * 0.4;
    const truncStats = this.truncateText(ctx, statsLine, maxStatsW);
    const statsTextW = ctx.measureText(truncStats).width;
    const statsTotalW = killIconSz + gap * 0.4 + statsTextW;
    const statsStartX = textCenterX - statsTotalW / 2;
    this.ui.drawIcon(ctx, icon, statsStartX, line4Y - killIconSz * 0.7, killIconSz);
    ctx.textAlign = 'left';
    ctx.fillText(truncStats, statsStartX + killIconSz + gap * 0.4, line4Y);

    // Survival
    const state2 = this.stats!.state;
    ctx.font = `${Math.max(10, fontSize * 0.5)}px monospace`;
    ctx.textAlign = 'center';
    const aliveTime = this.formatTickTime((hero.deathTick ?? state2.tick) - hero.spawnTick);
    if (hero.survived) {
      ctx.fillStyle = '#69f0ae';
      ctx.fillText(this.truncateText(ctx, `Survived (${aliveTime})`, textAvailW), textCenterX, line5Y);
    } else {
      const deathTime = this.formatTickTime(hero.deathTick ?? state2.tick);
      ctx.fillStyle = '#ff6e6e';
      ctx.fillText(this.truncateText(ctx, `\u26B0 ${deathTime} (${aliveTime})`, textAvailW), textCenterX, line5Y);
    }

    return y + heroCardH;
  }

  /** Draws the minimap replay panel. Returns the height consumed. */
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

    // Size to fill tab — use most of the panel width, constrain height
    const maxH = ctx.canvas.clientHeight * 0.6;
    const maxW = canvasW * 0.88;
    const aspect = mapW / mapH;
    let mmW: number, mmH: number;
    if (maxW / aspect > maxH) {
      mmH = Math.round(maxH);
      mmW = Math.round(mmH * aspect);
    } else {
      mmW = Math.round(maxW);
      mmH = Math.round(mmW / aspect);
    }
    const mmX = Math.round((canvasW - mmW) / 2);
    const mmY = topY;
    const totalH = mmH + Math.round(fontSize * 1.4);

    const frame = frames[this.replayFrameIdx];

    if (this.replayBgCanvas) {
      ctx.fillStyle = 'rgb(60, 110, 100)';
      ctx.fillRect(mmX - 2, mmY - 2, mmW + 4, mmH + 4);
      ctx.drawImage(this.replayBgCanvas, mmX, mmY, mmW, mmH);
    }

    // Active nuke zones
    for (const nuke of frame.nukes ?? []) {
      const nx = mmX + (nuke.x / mapW) * mmW;
      const ny = mmY + (nuke.y / mapH) * mmH;
      const nr = (nuke.radius / mapW) * mmW;
      const pc = PLAYER_COLORS[nuke.playerId % PLAYER_COLORS.length];
      ctx.beginPath();
      ctx.arc(nx, ny, Math.max(2, nr), 0, Math.PI * 2);
      ctx.fillStyle = pc + '55';
      ctx.fill();
      ctx.strokeStyle = pc + 'aa';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Carried diamond
    if (frame.diamond?.carried) {
      const dx = mmX + (frame.diamond.x / mapW) * mmW;
      const dy = mmY + (frame.diamond.y / mapH) * mmH;
      ctx.fillStyle = 'rgba(255, 220, 50, 1)';
      ctx.beginPath();
      ctx.arc(dx, dy, Math.max(2, mmW * 0.03), 0, Math.PI * 2);
      ctx.fill();
    }

    // Unit dots
    for (const u of frame.units) {
      const ux = mmX + (u.x / mapW) * mmW;
      const uy = mmY + (u.y / mapH) * mmH;
      ctx.fillStyle = PLAYER_COLORS[u.playerId] || (u.team === 0 ? '#2979ff' : '#ff1744');
      ctx.fillRect(ux - 1, uy - 1, 2, 2);
    }

    // War hero stars
    const starSize = Math.max(6, Math.round(mmW * 0.07));
    ctx.font = `bold ${starSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const hero of frame.warHeroPositions ?? []) {
      const hx = mmX + (hero.x / mapW) * mmW;
      const hy = mmY + (hero.y / mapH) * mmH;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText('\u2605', hx + 1, hy + 1);
      ctx.fillStyle = PLAYER_COLORS[hero.playerId % PLAYER_COLORS.length];
      ctx.fillText('\u2605', hx, hy);
    }
    ctx.textBaseline = 'alphabetic';

    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mmX, mmY, mmW, mmH);

    // Scrub bar
    const barY = mmY + mmH + 3;
    const progress = frames.length > 1 ? this.replayFrameIdx / (frames.length - 1) : 0;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(mmX, barY, mmW, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(mmX, barY, mmW * progress, 3);

    // Timestamp label
    const labelY = barY + Math.round(fontSize * 0.85);
    ctx.font = `bold ${Math.round(fontSize * 0.6)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    const elapsed = Math.floor((frame.tick ?? 0) / 20);
    const mm = Math.floor(elapsed / 60);
    const ss = String(elapsed % 60).padStart(2, '0');
    ctx.fillText(`\u21bb REPLAY  ${mm}:${ss}`, canvasW / 2, labelY);

    return totalH;
  }

  /** Get display name for a slot: player name, bot difficulty, or fallback P{n}. */
  private slotLabel(slotId: number): string {
    const name = this.stats?.slotNames?.[String(slotId)];
    if (name) return name;
    const diff = this.stats?.slotBotDifficulties?.[String(slotId)];
    if (diff) {
      const ABBREV: Record<string, string> = {
        medium: 'Med', nightmare: 'NM',
      };
      return `Bot ${ABBREV[diff] ?? diff.charAt(0).toUpperCase() + diff.slice(1)}`;
    }
    return `P${slotId + 1}`;
  }

  /** Format a tick count as m:ss (20 ticks per second). */
  private formatTickTime(ticks: number): string {
    const totalSec = Math.floor(ticks / 20);
    return `${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, '0')}`;
  }

  /** Truncate text to fit within maxWidth, adding ellipsis if needed. */
  private truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '\u2026').width > maxWidth) t = t.slice(0, -1);
    return t + '\u2026';
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

  /** Spawn a confetti burst at the given screen position. */
  private spawnConfetti(cx: number, cy: number, count = 50): void {
    const COLORS = ['#ff4081', '#448aff', '#ffd740', '#69f0ae', '#ea80fc', '#ff6e40', '#40c4ff', '#ffff00'];
    for (let i = 0; i < count; i++) {
      const angle = (Math.random() - 0.5) * Math.PI * 1.6 - Math.PI / 2;
      const speed = 100 + Math.random() * 250;
      const life = 2500 + Math.random() * 1500;
      this.confetti.push({
        x: cx + (Math.random() - 0.5) * 60,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 80,
        life, maxLife: life,
        size: 4 + Math.random() * 4,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        rot: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 12,
        wobble: Math.random() * Math.PI * 2,
      });
    }
  }

  /** Draw confetti particles (call outside clip region so they can fly freely). */
  private drawConfetti(ctx: CanvasRenderingContext2D): void {
    if (this.confetti.length === 0) return;
    ctx.save();
    for (const p of this.confetti) {
      const alpha = p.life / p.maxLife;
      if (alpha < 0.01) continue;
      ctx.globalAlpha = alpha;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      const scaleX = Math.abs(Math.cos(p.rot * 2));
      ctx.scale(Math.max(0.2, scaleX), 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
      ctx.restore();
    }
    ctx.restore();
  }

  /** Ease-out cubic: fast start, smooth deceleration. */
  private easeOut(t: number): number {
    return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
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
    best(ps => ps.totalGoldEarned + ps.totalWoodEarned + ps.totalMeatEarned, 'Best Economy', v => `${v} resources`);
    best(ps => ps.totalDamageNearHQ, 'Best Defender', v => `${v} dmg near HQ`);
    best(ps => ps.totalDamageTaken, 'Most Tanked', v => `${v} taken`);
    best(ps => ps.towerDamageDealt, 'Tower Damage', v => `${v} dmg`);
    best(ps => ps.totalHealing, 'Most Healing', v => `${v} healed`);
    best(ps => ps.totalBuffsApplied, 'Top Support', v => `${v} buffs`);
    best(ps => ps.enemyUnitsKilled, 'Top Killer', v => `${v} kills`);
    best(ps => ps.nukeKills, 'Nuke Master', v => `${v} kills`);

    return awards;
  }
}
