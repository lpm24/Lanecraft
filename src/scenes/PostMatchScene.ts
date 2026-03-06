import { Scene, SceneManager } from './Scene';
import { GameState, Team, PlayerStats } from '../simulation/types';
import { PLAYER_COLORS } from '../simulation/data';

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
    const goBack = () => this.manager.switchTo('raceSelect');
    this.clickHandler = goBack;
    this.keyHandler = (e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') goBack(); };
    this.touchHandler = (e) => { e.preventDefault(); goBack(); };
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
    const fontSize = Math.max(12, Math.min(w / 30, 24));

    // VICTORY / DEFEAT header
    ctx.font = `bold ${fontSize * 2.5}px monospace`;
    ctx.textAlign = 'center';
    if (won) {
      const hue = (this.animTime / 10) % 360;
      ctx.fillStyle = `hsl(${hue}, 80%, 65%)`;
      ctx.fillText('VICTORY', w / 2, h * 0.12);
    } else {
      ctx.fillStyle = '#ff4444';
      ctx.fillText('DEFEAT', w / 2, h * 0.12);
    }

    // Win condition
    ctx.font = `${fontSize}px monospace`;
    ctx.fillStyle = '#888';
    const condText = state.winCondition === 'military' ? 'HQ Destroyed'
      : state.winCondition === 'diamond' ? 'Diamond Delivered'
      : state.winCondition === 'timeout' ? 'Time Expired'
      : '';
    ctx.fillText(condText, w / 2, h * 0.18);

    // Match duration
    const totalSec = Math.floor(state.tick / 20);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    ctx.fillText(`Match Time: ${mins}:${secs.toString().padStart(2, '0')}`, w / 2, h * 0.23);

    // Player stats table
    const tableY = h * 0.30;
    const rowH = fontSize * 2.2;
    const colX = [w * 0.08, w * 0.3, w * 0.48, w * 0.62, w * 0.76, w * 0.9];

    // Header
    ctx.font = `bold ${fontSize * 0.8}px monospace`;
    ctx.fillStyle = '#666';
    ctx.textAlign = 'left';
    ctx.fillText('PLAYER', colX[0], tableY);
    ctx.textAlign = 'right';
    ctx.fillText('GOLD', colX[2], tableY);
    ctx.fillText('WOOD', colX[3], tableY);
    ctx.fillText('STONE', colX[4], tableY);
    ctx.fillText('DAMAGE', colX[5], tableY);

    // Player rows
    const stats = state.playerStats ?? [];
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      const ps = stats[i];
      const y = tableY + (i + 1) * rowH;

      // Highlight local player
      if (i === localPlayerId) {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(colX[0] - 8, y - rowH * 0.6, w * 0.88, rowH);
      }

      const teamStr = p.team === Team.Bottom ? 'BTM' : 'TOP';
      ctx.font = `bold ${fontSize * 0.9}px monospace`;
      ctx.textAlign = 'left';
      ctx.fillStyle = PLAYER_COLORS[i];
      ctx.fillText(`P${i + 1} (${teamStr})`, colX[0], y);

      ctx.font = `${fontSize * 0.8}px monospace`;
      ctx.fillStyle = '#ccc';
      ctx.textAlign = 'right';
      ctx.fillText(`${ps?.totalGoldEarned ?? 0}`, colX[2], y);
      ctx.fillText(`${ps?.totalWoodEarned ?? 0}`, colX[3], y);
      ctx.fillText(`${ps?.totalStoneEarned ?? 0}`, colX[4], y);
      ctx.fillText(`${ps?.totalDamageDealt ?? 0}`, colX[5], y);
    }

    // HQ HP comparison
    const hqY = tableY + (state.players.length + 2) * rowH;
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#aaa';
    ctx.fillText(`HQ Health:  Bottom ${state.hqHp[0]}  vs  Top ${state.hqHp[1]}`, w / 2, hqY);

    // Awards
    const awards = this.computeAwards(stats);
    const awardY = hqY + rowH * 2;
    ctx.font = `bold ${fontSize * 0.9}px monospace`;
    ctx.fillStyle = '#ffab00';
    ctx.fillText('-- AWARDS --', w / 2, awardY);
    ctx.font = `${fontSize * 0.8}px monospace`;
    for (let i = 0; i < awards.length; i++) {
      const a = awards[i];
      ctx.fillStyle = PLAYER_COLORS[a.playerId];
      ctx.fillText(`${a.label}: P${a.playerId + 1} (${a.value})`, w / 2, awardY + (i + 1) * rowH * 0.8);
    }

    // Units spawned / lost below awards
    const unitsY = awardY + (awards.length + 1) * rowH * 0.8 + rowH;
    ctx.font = `${fontSize * 0.7}px monospace`;
    ctx.fillStyle = '#666';
    const spawnedLine = stats.map((ps, i) => `P${i + 1}: ${ps.unitsSpawned} spawned / ${ps.unitsLost} lost`).join('  |  ');
    ctx.fillText(spawnedLine, w / 2, unitsY);

    // Continue prompt
    const alpha = 0.5 + 0.5 * Math.sin(this.animTime / 500);
    ctx.globalAlpha = alpha;
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.fillStyle = '#00e5ff';
    ctx.fillText('[ TAP TO CONTINUE ]', w / 2, h * 0.92);
    ctx.globalAlpha = 1;
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
    best(ps => ps.diamondTimeHeld + ps.diamondPickups * 100, 'Diamond Hero', v => {
      const idx = stats.findIndex(ps => ps.diamondTimeHeld + ps.diamondPickups * 100 === v);
      const ps = stats[idx >= 0 ? idx : 0];
      return `${ps.diamondPickups} pickups, ${Math.floor(ps.diamondTimeHeld / 20)}s held`;
    });

    return awards;
  }
}
