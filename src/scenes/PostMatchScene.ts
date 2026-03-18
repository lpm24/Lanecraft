import { Scene, SceneManager } from './Scene';
import { GameState, Team, PlayerStats } from '../simulation/types';
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
}

export class PostMatchScene implements Scene {
  private manager: SceneManager;
  private canvas: HTMLCanvasElement;
  private ui: UIAssets;
  private sprites: SpriteLoader;
  private stats: MatchStats | null = null;
  private animTime = 0;
  private clickHandler: ((e: MouseEvent) => void) | null = null;
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
  }

  enter(): void {
    this.animTime = 0;

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
      const rect = this.canvas.getBoundingClientRect();
      const cx = touch.clientX - rect.left;
      const cy = touch.clientY - rect.top;
      if (this.isButtonAt(cx, cy)) this.manager.switchTo(continueTarget);
    };

    this.canvas.addEventListener('click', this.clickHandler);
    window.addEventListener('keydown', this.keyHandler);
    this.canvas.addEventListener('touchstart', this.touchHandler, { passive: false });
  }

  exit(): void {
    if (this.clickHandler) this.canvas.removeEventListener('click', this.clickHandler);
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    if (this.touchHandler) this.canvas.removeEventListener('touchstart', this.touchHandler);
    this.clickHandler = null;
    this.keyHandler = null;
    this.touchHandler = null;
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
    const localTeam = state.players[localPlayerId].team;
    const won = state.winner === localTeam;
    const fontSize = Math.max(14, Math.min(w / 28, 24));

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
    const tableFontSize = fontSize * 0.7;
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
    ctx.font = `bold ${tableFontSize * 0.85}px monospace`;
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
    let rowIdx = 0;
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      if (p.isEmpty) continue;
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

      const isBot = !!this.stats?.slotBotDifficulties?.[String(i)];
      const raceColor = RACE_COLORS[p.race]?.primary ?? '#888';
      const iconSz = tableFontSize * 1.0;
      let textX = colX[0];

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
      const pc = PLAYER_COLORS[i];
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
      const totalDmg = (ps?.totalDamageDealt ?? 0) + (ps?.abilityDamageDealt ?? 0) + (ps?.nukeDamageDealt ?? 0);
      ctx.fillText(`${totalDmg}`, colX[6], y);
    }

    // HQ HP — compact centered row: [US hp bar]  [ENEMY hp bar]
    const hqY = tableY + (rowIdx + 1) * rowH + 4;
    const barW = Math.min(100, panelW * 0.14);
    const barH = 14;
    const hqGap = Math.round(fontSize * 0.6);
    const ourHp = Math.max(0, state.hqHp[localTeam]);
    const enemyTeam = localTeam === Team.Bottom ? Team.Top : Team.Bottom;
    const enemyHp = Math.max(0, state.hqHp[enemyTeam]);

    ctx.font = `bold ${fontSize * 0.7}px monospace`;
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

    // Awards + War Hero combined section
    const sectionY = hqY + rowH * 1.2;
    this.drawAwardsAndHero(ctx, state, pStats, w, innerW, sectionY, fontSize);

    // Continue button - Sword
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
  }

  private drawAwardsAndHero(
    ctx: CanvasRenderingContext2D, state: GameState, pStats: PlayerStats[],
    w: number, innerW: number, y: number, fontSize: number,
  ): void {
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
        ctx.font = `bold ${fontSize * 0.55}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#6b4e28';
        const label = this.truncateText(ctx, a.label.toUpperCase(), cardW - inset * 2);
        ctx.fillText(label, cardCenterX, cy + inset + iconSz + fontSize * 0.6);

        // Player name in their color
        ctx.font = `bold ${fontSize * 0.65}px monospace`;
        ctx.fillStyle = this.darkenColor(PLAYER_COLORS[a.playerId], 0.7);
        const name = this.truncateText(ctx, this.slotLabel(a.playerId), cardW - inset * 2);
        ctx.fillText(name, cardCenterX, cy + inset + iconSz + fontSize * 1.35);

        // Value
        ctx.font = `${fontSize * 0.5}px monospace`;
        ctx.fillStyle = '#7a5c38';
        ctx.fillText(a.value, cardCenterX, cy + inset + iconSz + fontSize * 2.0);
      }
      const rows = Math.ceil(awards.length / cols);
      y += rows * (cardH + cardGap) + gap;
    }

    // --- War Hero card ---
    const heroes = state.warHeroes;
    if (heroes.length === 0) return;
    const hero = heroes[0];

    const playerColor = PLAYER_COLORS[hero.playerId];
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
      const tick = Math.floor(this.animTime * 1.5); // slow idle animation
      const frame = getSpriteFrame(tick, def);
      const sx = frame * def.frameW;
      const scale = def.scale ?? 1.0;
      const dw = spriteSize * scale;
      const dh = spriteSize * scale * (def.heightScale ?? 1.0);
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
    ctx.font = `bold ${fontSize * 0.75}px monospace`;
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
    ctx.font = `bold ${fontSize * 0.65}px monospace`;
    ctx.fillStyle = this.lightenColor(playerColor, 0.4);
    const catLabel = hero.category === 'melee' ? 'Melee' : hero.category === 'ranged' ? 'Ranged' : 'Caster';
    ctx.fillText(`${this.slotLabel(hero.playerId)}'s ${catLabel}`, textCenterX, line3Y);

    // Line 4: Kills with sword icon
    const killIconSz = fontSize * 0.65;
    const killText = `${hero.kills} kills`;
    ctx.font = `bold ${fontSize * 0.65}px monospace`;
    const killTextW = ctx.measureText(killText).width;
    const killTotalW = killIconSz + gap * 0.4 + killTextW;
    const killStartX = textCenterX - killTotalW / 2;
    this.ui.drawIcon(ctx, 'sword', killStartX, line4Y - killIconSz * 0.7, killIconSz);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(killText, killStartX + killIconSz + gap * 0.4, line4Y);

    // Line 5: Survival / death status
    ctx.font = `${fontSize * 0.55}px monospace`;
    ctx.textAlign = 'center';
    const aliveTime = this.formatTickTime((hero.deathTick ?? state.tick) - hero.spawnTick);
    if (hero.survived) {
      ctx.fillStyle = '#69f0ae'; // bright green
      ctx.fillText(`Survived (${aliveTime})`, textCenterX, line5Y);
    } else {
      const deathTime = this.formatTickTime(hero.deathTick!);
      ctx.fillStyle = '#ff6e6e'; // bright red
      const deathText = this.truncateText(ctx, `Slain at ${deathTime} (${aliveTime})`, textAvailW);
      ctx.fillText(deathText, textCenterX, line5Y);
    }
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

    best(ps => ps.totalDamageDealt + ps.abilityDamageDealt + ps.nukeDamageDealt, 'MVP Damage', v => `${v} dmg`);
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
