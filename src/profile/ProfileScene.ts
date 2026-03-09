import { Scene, SceneManager } from '../scenes/Scene';
import { UIAssets } from '../rendering/UIAssets';
import { SpriteLoader, drawSpriteFrame } from '../rendering/SpriteLoader';
import { Race } from '../simulation/types';
import { RACE_COLORS } from '../simulation/data';
import {
  PlayerProfile, loadProfile, saveProfile,
  ACHIEVEMENTS, ALL_AVATARS,
  isAvatarUnlocked, getWinRate, formatTime,
} from './ProfileData';

const ALL_RACES: Race[] = [
  Race.Crown, Race.Horde, Race.Goblins, Race.Oozlings, Race.Demon,
  Race.Deep, Race.Wild, Race.Geists, Race.Tenders,
];
const RACE_LABELS: Record<Race, string> = {
  [Race.Crown]: 'Crown', [Race.Horde]: 'Horde', [Race.Goblins]: 'Goblins',
  [Race.Oozlings]: 'Oozlings', [Race.Demon]: 'Demon', [Race.Deep]: 'Deep',
  [Race.Wild]: 'Wild', [Race.Geists]: 'Geists', [Race.Tenders]: 'Tenders',
};

type Tab = 'stats' | 'achievements' | 'avatars';

export class ProfileScene implements Scene {
  private manager: SceneManager;
  private canvas: HTMLCanvasElement;
  private ui: UIAssets;
  private sprites: SpriteLoader;
  private profile!: PlayerProfile;
  private tab: Tab = 'stats';
  private scrollY = 0;
  private animTime = 0;

  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private touchHandler: ((e: TouchEvent) => void) | null = null;
  private wheelHandler: ((e: WheelEvent) => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(manager: SceneManager, canvas: HTMLCanvasElement, ui: UIAssets, sprites: SpriteLoader) {
    this.manager = manager;
    this.canvas = canvas;
    this.ui = ui;
    this.sprites = sprites;
  }

  enter(): void {
    this.profile = loadProfile();
    this.scrollY = 0;
    this.tab = 'stats';

    this.clickHandler = (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      this.handleClick(e.clientX - rect.left, e.clientY - rect.top);
    };
    this.touchHandler = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0] ?? e.changedTouches[0];
      if (!t) return;
      const rect = this.canvas.getBoundingClientRect();
      this.handleClick(t.clientX - rect.left, t.clientY - rect.top);
    };
    this.wheelHandler = (e: WheelEvent) => { this.scrollY = Math.max(0, this.scrollY + e.deltaY * 0.5); };
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.manager.switchTo('title');
    };

    this.canvas.addEventListener('click', this.clickHandler);
    this.canvas.addEventListener('touchstart', this.touchHandler, { passive: false });
    this.canvas.addEventListener('wheel', this.wheelHandler, { passive: true });
    window.addEventListener('keydown', this.keyHandler);
  }

  exit(): void {
    if (this.clickHandler) this.canvas.removeEventListener('click', this.clickHandler);
    if (this.touchHandler) this.canvas.removeEventListener('touchstart', this.touchHandler);
    if (this.wheelHandler) this.canvas.removeEventListener('wheel', this.wheelHandler);
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    this.clickHandler = null; this.touchHandler = null; this.wheelHandler = null; this.keyHandler = null;
  }

  update(dt: number): void { this.animTime += dt; }

  // ─── Layout ───

  private getLayout() {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const headerH = 90;
    const tabBarY = 42;
    const tabH = 30;
    return { W, H, headerH, tabBarY, tabH };
  }

  // ─── Click handling ───

  private handleClick(cx: number, cy: number): void {
    const { W, tabBarY, tabH, headerH } = this.getLayout();

    // Back button (top-left)
    if (cy < 36 && cx < 100) {
      this.manager.switchTo('title');
      return;
    }

    // Tab bar
    if (cy >= tabBarY && cy <= tabBarY + tabH) {
      const tabs: Tab[] = ['stats', 'achievements', 'avatars'];
      const gap = 6;
      const tabW = Math.min(100, (W - 80 - gap * 2) / 3);
      const totalW = tabW * 3 + gap * 2;
      const startX = (W - totalW) / 2;
      for (let i = 0; i < tabs.length; i++) {
        const tx = startX + i * (tabW + gap);
        if (cx >= tx && cx <= tx + tabW) {
          this.tab = tabs[i];
          this.scrollY = 0;
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
    const { W, headerH } = this.getLayout();
    const pad = 14;
    const cols = Math.max(3, Math.floor((W - pad * 2 - 20) / 80));
    const cellSize = Math.floor((W - pad * 2 - 20) / cols);
    const startX = pad + 10;
    const startY = headerH + 14 - this.scrollY;

    for (let i = 0; i < ALL_AVATARS.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const ax = startX + col * cellSize;
      const ay = startY + row * cellSize;

      if (cx >= ax && cx < ax + cellSize && cy >= ay && cy < ay + cellSize) {
        const avatar = ALL_AVATARS[i];
        if (isAvatarUnlocked(this.profile, avatar)) {
          this.profile.avatarId = avatar.id;
          saveProfile(this.profile);
        }
        return;
      }
    }
  }

  // ─── Main Render ───

  render(ctx: CanvasRenderingContext2D): void {
    const { W, H, headerH, tabBarY, tabH } = this.getLayout();

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

    if (this.tab === 'stats') this.renderStats(ctx, W, H, headerH);
    else if (this.tab === 'achievements') this.renderAchievements(ctx, W, H, headerH);
    else if (this.tab === 'avatars') this.renderAvatars(ctx, W, H, headerH);

    ctx.restore();

    // ─── Fixed header ───
    // Dark overlay for header area
    ctx.fillStyle = 'rgba(10,10,20,0.85)';
    ctx.fillRect(0, 0, W, headerH);

    // Title ribbon
    const ribbonW = Math.min(W * 0.5, 280);
    const ribbonH = 32;
    const ribbonX = (W - ribbonW) / 2;
    const ribbonY = 4;
    this.ui.drawBigRibbon(ctx, ribbonX, ribbonY, ribbonW, ribbonH, 2); // yellow ribbon
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText('PROFILE', W / 2, ribbonY + ribbonH / 2);

    // Back button — small blue round
    const backSize = 32;
    this.ui.drawSmallBlueRoundButton(ctx, 8, 6, backSize);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('<', 8 + backSize / 2, 6 + backSize / 2);

    // Tab bar — blue buttons
    const tabs: { key: Tab; label: string }[] = [
      { key: 'stats', label: 'STATS' },
      { key: 'achievements', label: 'ACHIEVE' },
      { key: 'avatars', label: 'AVATARS' },
    ];
    const gap = 6;
    const tabW = Math.min(100, (W - 80 - gap * 2) / 3);
    const totalW = tabW * 3 + gap * 2;
    const startX = (W - totalW) / 2;
    for (let i = 0; i < tabs.length; i++) {
      const tx = startX + i * (tabW + gap);
      const active = this.tab === tabs[i].key;
      this.ui.drawBigBlueButton(ctx, tx, tabBarY, tabW, tabH, active);
      ctx.fillStyle = active ? '#fff' : '#a0c4e8';
      ctx.font = `bold ${tabW < 80 ? 10 : 11}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tabs[i].label, tx + tabW / 2, tabBarY + tabH / 2);
    }

    // Summary line under tabs
    ctx.fillStyle = '#aaa';
    ctx.font = '11px monospace';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    const wr = getWinRate(this.profile.wins, this.profile.gamesPlayed);
    ctx.fillText(
      `${this.profile.gamesPlayed} games  |  ${this.profile.wins}W ${this.profile.losses}L  |  ${wr}`,
      W / 2, headerH - 6,
    );
  }

  // ─── Stats Tab ───

  private renderStats(ctx: CanvasRenderingContext2D, W: number, _H: number, headerH: number): void {
    let y = headerH + 10 - this.scrollY;
    const pad = 14;
    const panelW = W - pad * 2;

    // ── Overview panel (WoodTable) ──
    const overH = 100;
    // Draw 10% oversized so 9-slice borders don't clip content (min 16px)
    const overflowX1 = Math.max(16, Math.round(panelW * 0.05));
    const overflowY1 = Math.max(16, Math.round(overH * 0.05));
    this.ui.drawWoodTable(ctx, pad - overflowX1, y - overflowY1, panelW + overflowX1 * 2, overH + overflowY1 * 2);

    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const inset = 22; // content inset from pad edge
    ctx.font = 'bold 13px monospace'; ctx.fillStyle = '#ffd740';
    ctx.fillText('Overview', pad + inset, y + 22);

    ctx.font = '12px monospace'; ctx.fillStyle = '#e0e0e0';
    const c1 = pad + inset;
    const c2 = pad + panelW / 2;
    ctx.fillText(`Games: ${this.profile.gamesPlayed}`, c1, y + 42);
    ctx.fillText(`Wins: ${this.profile.wins}`, c2, y + 42);
    ctx.fillText(`Losses: ${this.profile.losses}`, c1, y + 60);
    ctx.fillText(`Win Rate: ${getWinRate(this.profile.wins, this.profile.gamesPlayed)}`, c2, y + 60);
    ctx.fillText(`Play Time: ${formatTime(this.profile.totalPlayTimeSec)}`, c1, y + 78);
    ctx.fillText(`Best Streak: ${this.profile.bestWinStreak}`, c2, y + 78);
    y += overH + 12;

    // ── Race stats panel (WoodTable) ──
    const rowH = 22;
    const raceH = 36 + ALL_RACES.length * rowH + 14;
    const overflowX2 = Math.max(16, Math.round(panelW * 0.05));
    const overflowY2 = Math.max(16, Math.round(raceH * 0.05));
    this.ui.drawWoodTable(ctx, pad - overflowX2, y - overflowY2, panelW + overflowX2 * 2, raceH + overflowY2 * 2);

    ctx.font = 'bold 13px monospace'; ctx.fillStyle = '#ffd740';
    ctx.textAlign = 'left';
    ctx.fillText('Race Stats', pad + inset, y + 20);
    y += 30;

    // Column headers
    ctx.font = 'bold 10px monospace'; ctx.fillStyle = '#999';
    const rCols = [pad + inset, pad + 100, pad + 155, pad + 210, pad + 275];
    ctx.fillText('RACE', rCols[0], y);
    ctx.fillText('GAMES', rCols[1], y);
    ctx.fillText('WIN%', rCols[2], y);
    ctx.fillText('TIME', rCols[3], y);
    ctx.fillText('DMG', rCols[4], y);
    y += 6;

    // Divider line
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad + 20, y);
    ctx.lineTo(pad + panelW - 10, y);
    ctx.stroke();

    ctx.font = '11px monospace';
    for (const race of ALL_RACES) {
      y += rowH;
      const rs = this.profile.raceStats[race];
      const rc = RACE_COLORS[race];

      // Alternating row bg
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      if (ALL_RACES.indexOf(race) % 2 === 0) {
        ctx.fillRect(pad + 14, y - rowH + 6, panelW - 18, rowH);
      }

      ctx.fillStyle = rc.primary;
      ctx.fillText(RACE_LABELS[race], rCols[0], y);
      ctx.fillStyle = '#ccc';
      ctx.fillText(`${rs?.gamesPlayed ?? 0}`, rCols[1], y);
      ctx.fillText(getWinRate(rs?.wins ?? 0, rs?.gamesPlayed ?? 0), rCols[2], y);
      ctx.fillText(formatTime(rs?.playTimeSec ?? 0), rCols[3], y);
      ctx.fillStyle = '#e57373';
      ctx.fillText(`${rs?.damageDealt ?? 0}`, rCols[4], y);
    }
  }

  // ─── Achievements Tab ───

  private renderAchievements(ctx: CanvasRenderingContext2D, W: number, _H: number, headerH: number): void {
    let y = headerH + 10 - this.scrollY;
    const pad = 14;
    const panelW = W - pad * 2;
    const cardH = 62;
    const cardGap = 8;

    // One big WoodTable panel for all achievements (same style as avatars)
    const totalCardsH = ACHIEVEMENTS.length * (cardH + cardGap) + 16;
    const achOverX = Math.max(16, Math.round(panelW * 0.10));
    const achOverY = Math.max(16, Math.round(totalCardsH * 0.05));
    this.ui.drawWoodTable(ctx, pad - achOverX, y - achOverY - 4, panelW + achOverX * 2, totalCardsH + achOverY * 2 + 4);

    y += 8;

    for (const ach of ACHIEVEMENTS) {
      const state = this.profile.achievements[ach.id];
      const unlocked = state?.unlocked ?? false;
      const progress = state?.progress ?? 0;

      // Card inner background
      ctx.fillStyle = unlocked ? 'rgba(100,180,100,0.15)' : 'rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.roundRect(pad + 6, y, panelW - 12, cardH, 4); ctx.fill();

      // Border
      ctx.strokeStyle = unlocked ? 'rgba(129,199,132,0.4)' : 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(pad + 6, y, panelW - 12, cardH, 4); ctx.stroke();

      // Icon area
      const iconX = pad + 12;
      const iconY = y + 6;
      const iconSz = cardH - 12;

      // Icon bg
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.roundRect(iconX, iconY, iconSz, iconSz, 4); ctx.fill();

      if (unlocked && ach.avatarUnlock) {
        this.drawAvatarSprite(ctx, ach.avatarUnlock, iconX + 2, iconY + 2, iconSz - 4);
      } else {
        ctx.fillStyle = '#444';
        ctx.font = 'bold 20px monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('?', iconX + iconSz / 2, iconY + iconSz / 2);
      }

      // Text content
      const textX = iconX + iconSz + 10;
      const textW = panelW - 12 - (textX - pad - 6) - 8;
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

      // Achievement name
      ctx.font = 'bold 12px monospace';
      ctx.fillStyle = unlocked ? '#81c784' : '#e0e0e0';
      ctx.fillText(ach.name, textX, y + 18);

      // Description
      ctx.font = '10px monospace';
      ctx.fillStyle = '#999';
      ctx.fillText(ach.desc, textX, y + 32);

      // Progress bar using UIAssets bar
      const barX = textX;
      const barY = y + 40;
      const barW = textW;
      const barH = 10;
      const pct = Math.min(1, progress / ach.goal);
      if (!this.ui.drawBar(ctx, barX, barY, barW, barH, pct)) {
        // Fallback bar
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath(); ctx.roundRect(barX, barY, barW, barH, 3); ctx.fill();
        ctx.fillStyle = unlocked ? '#81c784' : '#4fc3f7';
        if (pct > 0) {
          ctx.beginPath(); ctx.roundRect(barX, barY, Math.max(6, barW * pct), barH, 3); ctx.fill();
        }
      }

      // Progress text
      ctx.fillStyle = unlocked ? '#81c784' : '#777';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.min(progress, ach.goal)}/${ach.goal}`, pad + panelW - 14, y + 18);

      if (unlocked) {
        ctx.fillStyle = '#4caf50';
        ctx.font = 'bold 9px monospace';
        ctx.fillText('✓', pad + panelW - 14, y + 52);
      }

      y += cardH + cardGap;
    }
  }

  // ─── Avatars Tab ───

  private renderAvatars(ctx: CanvasRenderingContext2D, W: number, _H: number, headerH: number): void {
    const pad = 14;
    const panelW = W - pad * 2;
    const cols = Math.max(3, Math.floor((panelW - 20) / 80));
    const cellSize = Math.floor((panelW - 20) / cols);
    const rows = Math.ceil(ALL_AVATARS.length / cols);
    const gridH = rows * cellSize + 16;
    const startX = pad + 10;
    const startY = headerH + 14 - this.scrollY;

    // WoodTable background for the grid — 20% wider, 10% taller
    const avOverX = Math.max(16, Math.round(panelW * 0.10));
    const avOverY = Math.max(16, Math.round(gridH * 0.05));
    this.ui.drawWoodTable(ctx, pad - avOverX, startY - avOverY - 4, panelW + avOverX * 2, gridH + avOverY * 2 + 4);

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
      ctx.beginPath(); ctx.roundRect(ax + 3, ay + 3, cellSize - 6, cellSize - 6, 4); ctx.fill();

      if (selected) {
        ctx.strokeStyle = '#ffd740';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(ax + 3, ay + 3, cellSize - 6, cellSize - 6, 4); ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(ax + 3, ay + 3, cellSize - 6, cellSize - 6, 4); ctx.stroke();
      }

      if (unlocked) {
        this.drawAvatarSprite(ctx, avatar.id, ax + 8, ay + 4, cellSize - 16);
      } else {
        // Locked — desaturated
        ctx.globalAlpha = 0.15;
        this.drawAvatarSprite(ctx, avatar.id, ax + 8, ay + 4, cellSize - 16);
        ctx.globalAlpha = 1;
        // Lock overlay
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath(); ctx.roundRect(ax + 3, ay + 3, cellSize - 6, cellSize - 6, 4); ctx.fill();
        ctx.fillStyle = '#666';
        ctx.font = 'bold 16px monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('?', ax + cellSize / 2, ay + cellSize / 2 - 4);
      }

      // Race + category label
      const rc = RACE_COLORS[avatar.race];
      ctx.font = '7px monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = unlocked ? (rc?.primary ?? '#aaa') : '#444';
      const catLabel = avatar.category === 'melee' ? 'M' : avatar.category === 'ranged' ? 'R' : 'C';
      ctx.fillText(`${RACE_LABELS[avatar.race]} ${catLabel}`, ax + cellSize / 2, ay + cellSize - 7);
    }
  }

  // ─── Draw avatar sprite from ID ───

  private drawAvatarSprite(ctx: CanvasRenderingContext2D, avatarId: string, x: number, y: number, size: number): void {
    const [raceStr, cat] = avatarId.split(':') as [Race, 'melee' | 'ranged' | 'caster'];
    const sprData = this.sprites.getUnitSprite(raceStr, cat, 0);
    if (sprData) {
      const [img, def] = sprData;
      const tick = Math.floor(this.animTime / 50);
      const ticksPerFrame = Math.max(1, Math.round(20 / def.cols));
      const frame = Math.floor(tick / ticksPerFrame) % def.cols;
      const aspect = def.frameW / def.frameH;
      const drawH = size;
      const drawW = drawH * aspect;
      const drawX = x + (size - drawW) / 2;
      const gY = def.groundY ?? 0.71;
      const feetY = y + size * 0.85;
      const drawY = feetY - drawH * gY;
      drawSpriteFrame(ctx, img, def, frame, drawX, drawY, drawW, drawH);
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
