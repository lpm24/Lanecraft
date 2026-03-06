import { Scene, SceneManager } from './Scene';
import { GameState, Team, PlayerStats } from '../simulation/types';
import { PLAYER_COLORS, RACE_COLORS } from '../simulation/data';

export interface MatchStats {
  state: GameState;
  localPlayerId: number;
}

export class PostMatchScene implements Scene {
  private manager: SceneManager;
  private canvas: HTMLCanvasElement;
  private stats: MatchStats | null = null;
  private animTime = 0;
  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private touchHandler: ((e: TouchEvent) => void) | null = null;

  constructor(manager: SceneManager, canvas: HTMLCanvasElement) {
    this.manager = manager;
    this.canvas = canvas;
  }

  setStats(stats: MatchStats): void {
    this.stats = stats;
  }

  enter(): void {
    this.animTime = 0;

    this.clickHandler = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      if (this.isButtonAt(cx, cy)) this.manager.switchTo('raceSelect');
    };

    this.keyHandler = (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
        this.manager.switchTo('raceSelect');
      }
    };

    this.touchHandler = (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;
      const rect = this.canvas.getBoundingClientRect();
      const cx = touch.clientX - rect.left;
      const cy = touch.clientY - rect.top;
      if (this.isButtonAt(cx, cy)) this.manager.switchTo('raceSelect');
    };

    this.canvas.addEventListener('click', this.clickHandler);
    window.addEventListener('keydown', this.keyHandler);
    this.canvas.addEventListener('touchstart', this.touchHandler);
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
    const w = this.canvas.width;
    const h = this.canvas.height;
    const btnW = 200;
    const btnH = 48;
    return { x: (w - btnW) / 2, y: h * 0.90, w: btnW, h: btnH };
  }

  private isButtonAt(cx: number, cy: number): boolean {
    const b = this.getButtonRect();
    return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h;
  }

  update(dt: number): void {
    this.animTime += dt;
  }

  render(ctx: CanvasRenderingContext2D): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    ctx.fillStyle = '#0a0a0a';
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
    const fontSize = Math.max(11, Math.min(w / 35, 20));

    // VICTORY / DEFEAT header
    ctx.font = `bold ${fontSize * 2.5}px monospace`;
    ctx.textAlign = 'center';
    if (won) {
      const hue = (this.animTime / 10) % 360;
      ctx.fillStyle = `hsl(${hue}, 80%, 65%)`;
      ctx.fillText('VICTORY', w / 2, h * 0.08);
    } else {
      ctx.fillStyle = '#ff4444';
      ctx.fillText('DEFEAT', w / 2, h * 0.08);
    }

    // Win condition + match time
    ctx.font = `${fontSize}px monospace`;
    ctx.fillStyle = '#888';
    const condText = state.winCondition === 'military' ? 'HQ Destroyed'
      : state.winCondition === 'diamond' ? 'Diamond Delivered'
      : state.winCondition === 'timeout' ? 'Time Expired' : '';
    const totalSec = Math.floor(state.tick / 20);
    ctx.fillText(`${condText}  -  ${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, '0')}`, w / 2, h * 0.13);

    // === Player stats table ===
    const tableY = h * 0.18;
    const rowH = fontSize * 1.9;
    const colX = [w * 0.04, w * 0.22, w * 0.36, w * 0.48, w * 0.58, w * 0.70, w * 0.82, w * 0.94];

    // Header
    ctx.font = `bold ${fontSize * 0.7}px monospace`;
    ctx.fillStyle = '#555';
    ctx.textAlign = 'left';
    ctx.fillText('PLAYER', colX[0], tableY);
    ctx.textAlign = 'right';
    ctx.fillText('GOLD', colX[2], tableY);
    ctx.fillText('WOOD', colX[3], tableY);
    ctx.fillText('STONE', colX[4], tableY);
    ctx.fillText('SPAWNED', colX[5], tableY);
    ctx.fillText('KILLED', colX[6], tableY);
    ctx.fillText('DAMAGE', colX[7], tableY);

    const pStats = state.playerStats ?? [];
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      const ps = pStats[i];
      const y = tableY + (i + 1) * rowH;

      if (i === localPlayerId) {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(colX[0] - 6, y - rowH * 0.65, w * 0.94, rowH);
      }

      const teamStr = p.team === Team.Bottom ? 'BTM' : 'TOP';
      const raceStr = p.race.charAt(0).toUpperCase() + p.race.slice(1);
      ctx.font = `bold ${fontSize * 0.8}px monospace`;
      ctx.textAlign = 'left';
      ctx.fillStyle = PLAYER_COLORS[i];
      ctx.fillText(`P${i + 1} ${teamStr} ${raceStr}`, colX[0], y);

      ctx.font = `${fontSize * 0.75}px monospace`;
      ctx.fillStyle = '#ccc';
      ctx.textAlign = 'right';
      ctx.fillText(`${ps?.totalGoldEarned ?? 0}`, colX[2], y);
      ctx.fillText(`${ps?.totalWoodEarned ?? 0}`, colX[3], y);
      ctx.fillText(`${ps?.totalStoneEarned ?? 0}`, colX[4], y);
      ctx.fillText(`${ps?.unitsSpawned ?? 0}`, colX[5], y);
      ctx.fillText(`${ps?.unitsLost ?? 0}`, colX[6], y);
      ctx.fillText(`${ps?.totalDamageDealt ?? 0}`, colX[7], y);
    }

    // HQ HP
    const hqY = tableY + (state.players.length + 1.5) * rowH;
    ctx.font = `bold ${fontSize * 0.85}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#aaa';
    ctx.fillText(`HQ Health:  Bottom ${state.hqHp[0]}  vs  Top ${state.hqHp[1]}`, w / 2, hqY);

    // === Awards ===
    const awards = this.computeAwards(pStats);
    const awardY = hqY + rowH * 1.5;
    ctx.font = `bold ${fontSize * 0.85}px monospace`;
    ctx.fillStyle = '#ffab00';
    ctx.fillText('-- AWARDS --', w / 2, awardY);
    ctx.font = `${fontSize * 0.75}px monospace`;
    for (let i = 0; i < awards.length; i++) {
      const a = awards[i];
      ctx.fillStyle = PLAYER_COLORS[a.playerId];
      ctx.fillText(`${a.label}: P${a.playerId + 1} (${a.value})`, w / 2, awardY + (i + 1) * rowH * 0.75);
    }

    // === War Hero ===
    const heroY = awardY + (awards.length + 1.5) * rowH * 0.75;
    this.drawWarHero(ctx, state, w, heroY, fontSize);

    // === Continue button ===
    const btn = this.getButtonRect();
    ctx.fillStyle = '#00e5ff';
    ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#000';
    ctx.fillText('CONTINUE', w / 2, btn.y + btn.h / 2 + 6);
  }

  private drawWarHero(ctx: CanvasRenderingContext2D, state: GameState, w: number, y: number, fontSize: number): void {
    const heroes = state.warHeroes;
    if (heroes.length === 0) return;

    const hero = heroes[0]; // The #1 war hero
    const playerColor = PLAYER_COLORS[hero.playerId];
    const raceColor = RACE_COLORS[state.players[hero.playerId]?.race]?.primary ?? '#fff';

    ctx.font = `bold ${fontSize * 0.85}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffab00';
    ctx.fillText('-- WAR HERO --', w / 2, y);

    // Hero name and stats
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.fillStyle = raceColor;
    ctx.fillText(`${hero.name}`, w / 2, y + fontSize * 1.6);

    ctx.font = `${fontSize * 0.8}px monospace`;
    ctx.fillStyle = playerColor;
    const categoryIcon = hero.category === 'melee' ? 'Melee' : hero.category === 'ranged' ? 'Ranged' : 'Caster';
    ctx.fillText(`P${hero.playerId + 1}'s ${categoryIcon}  -  ${hero.kills} kills`, w / 2, y + fontSize * 2.8);

    // Fate
    ctx.font = `${fontSize * 0.75}px monospace`;
    if (hero.survived) {
      ctx.fillStyle = '#4caf50';
      ctx.fillText('Survived the battle', w / 2, y + fontSize * 3.8);
    } else {
      ctx.fillStyle = '#ff6666';
      ctx.fillText(`Slain by ${hero.killedByName}`, w / 2, y + fontSize * 3.8);
    }
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

    return awards;
  }
}
