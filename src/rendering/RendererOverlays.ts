/**
 * RendererOverlays.ts — HUD, minimap, ability effects, nuke effects, floating texts, fog of war, and other overlay drawing.
 * Extracted from Renderer.ts. All functions are standalone and receive their dependencies as parameters.
 */

import { SpriteLoader, drawSpriteFrame, drawGridFrame, type SpriteDef, type GridSpriteDef } from './SpriteLoader';
import { UIAssets, IconName } from './UIAssets';
import { Camera } from './Camera';
import {
  GameState, Team, TILE_SIZE, TICK_RATE,
  HQ_WIDTH, HQ_HEIGHT, HQ_HP,
  Race,
} from '../simulation/types';
import { getHQPosition } from '../simulation/GameState';
import { PLAYER_COLORS, getRaceUsedResources } from '../simulation/data';
import { getSafeTop, getSafeBottom } from '../ui/SafeArea';
import { drawStatVisualIcon } from '../ui/StatBarUtils';
import { getVisualSettings } from './VisualSettings';
import { tileToPixel, isoWorldBounds, isoArc, ISO_TILE_W, ISO_TILE_H } from './Projection';
import { FLOATING_TEXT_ICON_MAP, hexToRgba, quickChatStyle } from './RendererShapes';

const T = TILE_SIZE;

// ── drawHUD ──

export function drawHUD(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  ui: UIAssets,
  canvas: HTMLCanvasElement,
  localPlayerId: number,
  _networkLatencyMs?: number,
  desyncDetected?: boolean,
  peerDisconnected?: boolean,
  waitingForAllyMs?: number,
): void {
  const player = state.players[localPlayerId];
  if (!player) return;
  const W = canvas.clientWidth;
  const compact = W < 600;
  const fontSize = compact ? 11 : 14;
  const iconSz = compact ? 16 : 22;
  const hudH = compact ? 42 : 56;
  const pad = compact ? 6 : 12;
  const safeTop = getSafeTop();

  if (safeTop > 0) {
    ctx.fillStyle = '#1a1008';
    ctx.fillRect(0, 0, W, safeTop);
  }

  const bgOverW = Math.round(W * 0.25);
  const bgH = Math.round(hudH * 1.10);
  if (!ui.drawWoodTable(ctx, -bgOverW / 2, safeTop, W + bgOverW, bgH)) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(0, safeTop, W, bgH);
  }

  ctx.font = `bold ${fontSize}px monospace`;
  const ps = state.playerStats?.[localPlayerId];
  const elapsed = Math.max(1, state.tick / 20);

  const y1 = safeTop + (compact ? 14 : 20);
  let x = pad;
  const iconY = y1 - iconSz / 2;

  const drawRes = (icon: 'gold' | 'wood' | 'meat', val: number, color: string, rate?: string) => {
    ui.drawIcon(ctx, icon, x, iconY, iconSz);
    x += iconSz + 1;
    ctx.fillStyle = color;
    const text = rate ? `${val} (+${rate})` : `${val}`;
    ctx.fillText(text, x, y1 + fontSize * 0.35);
    x += ctx.measureText(text).width + (compact ? 4 : 8);
  };

  const goldRate = ps ? (ps.totalGoldEarned / elapsed).toFixed(1) : '?';
  const woodRate = ps ? (ps.totalWoodEarned / elapsed).toFixed(1) : '?';
  const meatRate = ps ? (ps.totalMeatEarned / elapsed).toFixed(1) : '?';

  const used = getRaceUsedResources(player.race);
  if (used.gold) drawRes('gold', player.gold, '#ffd700', goldRate);
  if (used.wood) drawRes('wood', player.wood, '#4caf50', woodRate);
  if (used.meat) drawRes('meat', player.meat, '#e57373', meatRate);

  const drawSpecialRes = (val: number, color: string, icon: IconName) => {
    ui.drawIcon(ctx, icon, x, iconY, iconSz);
    x += iconSz + 1;
    ctx.fillStyle = color;
    ctx.fillText(`${val}`, x, y1 + fontSize * 0.35);
    x += ctx.measureText(`${val}`).width + (compact ? 4 : 8);
  };
  if (player.race === Race.Demon) drawSpecialRes(player.mana, '#7c4dff', 'mana');
  if (player.race === Race.Geists) drawSpecialRes(player.souls, '#ce93d8', 'souls');
  if (player.race === Race.Oozlings) drawSpecialRes(player.deathEssence, '#69f0ae', 'ooze');

  const y2 = safeTop + (compact ? 32 : 42);
  const smallFont = 11;
  ctx.font = `bold ${smallFont}px monospace`;

  const secs = Math.floor(state.tick / 20);
  const timerText = `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
  ctx.fillStyle = '#888';
  ctx.fillText(timerText, pad, y2 + smallFont * 0.35);

  const localTeamHud = player.team;
  const enemyTeamHud = localTeamHud === Team.Bottom ? Team.Top : Team.Bottom;
  const ourHp = state.hqHp[localTeamHud];
  const enemyHp = state.hqHp[enemyTeamHud];
  const hqBarW = compact ? 70 : 100;
  const hqBarH = compact ? 14 : 16;
  const hqGap = compact ? 6 : 10;

  let myUnits = 0, enemyUnits = 0;
  for (let i = 0; i < state.units.length; i++) {
    if (state.units[i].team === player.team) myUnits++; else enemyUnits++;
  }
  const unitText = `${myUnits}v${enemyUnits}`;
  ctx.font = `bold ${smallFont}px monospace`;
  const unitTextW = ctx.measureText(unitText).width;

  const totalRow2W = hqBarW + hqGap + unitTextW + hqGap + hqBarW;
  let x2 = (W - totalRow2W) / 2;
  const barY = y2 - hqBarH / 2;
  const barLabelFont = 11;

  const drawHQBar = (label: string, hp: number, _color: string, bx: number) => {
    const pct = Math.max(0, hp / HQ_HP);
    if (!ui.drawBar(ctx, bx, barY, hqBarW, hqBarH, pct)) {
      ctx.fillStyle = '#222';
      ctx.fillRect(bx, barY, hqBarW, hqBarH);
      ctx.fillStyle = pct > 0.5 ? _color : pct > 0.25 ? '#ff9800' : '#f44336';
      ctx.fillRect(bx, barY, hqBarW * pct, hqBarH);
    }
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${barLabelFont}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(label, bx + hqBarW / 2, barY + hqBarH / 2 + barLabelFont * 0.35);
    ctx.textAlign = 'start';
  };
  drawHQBar('Us', ourHp, '#2979ff', x2);
  x2 += hqBarW + hqGap;

  ctx.font = `bold ${smallFont}px monospace`;
  ctx.fillStyle = '#aaa';
  ctx.fillText(unitText, x2, y2);
  x2 += unitTextW + hqGap;

  drawHQBar('Them', enemyHp, '#ff1744', x2);
  x2 += hqBarW;

  if (peerDisconnected) {
    drawNetPanel(ctx, W, canvas.clientHeight, 'PLAYER DISCONNECTED', 'Game continues locally', -1, fontSize);
  } else if (desyncDetected) {
    drawNetPanel(ctx, W, canvas.clientHeight, 'DESYNC DETECTED', 'Game state mismatch', -1, fontSize);
  } else if (waitingForAllyMs && waitingForAllyMs > 1500) {
    const timeoutMs = 5000;
    const remaining = Math.max(0, Math.ceil((timeoutMs - waitingForAllyMs) / 1000));
    drawNetPanel(ctx, W, canvas.clientHeight, 'WAITING FOR ALLY', `Dropping in ${remaining}s...`, waitingForAllyMs / timeoutMs, fontSize);
  }

  if (state.matchPhase === 'prematch') {
    const pmFont = compact ? 22 : 32;
    ctx.fillStyle = '#fff'; ctx.font = `bold ${pmFont}px monospace`; ctx.textAlign = 'center';
    ctx.fillText(`Match starts in ${Math.ceil(state.prematchTimer / 20)}`, W / 2, canvas.clientHeight / 2);
    ctx.textAlign = 'start';
  }

  if (state.matchPhase === 'ended' && state.winner !== null) {
    const winFont = compact ? 20 : 36;
    const localTeamWin = player.team;
    const won = state.winner === localTeamWin;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, canvas.clientHeight / 2 - 40, W, 80);
    ctx.fillStyle = won ? '#4caf50' : '#f44336';
    ctx.font = `bold ${winFont}px monospace`; ctx.textAlign = 'center';
    const winText = won
      ? (compact ? 'VICTORY!' : `VICTORY! (${state.winCondition})`)
      : (compact ? 'DEFEAT!' : `DEFEAT! (${state.winCondition})`);
    ctx.fillText(winText, W / 2, canvas.clientHeight / 2 + 12);
    ctx.textAlign = 'start';
  }
}

// ── drawNetPanel ──

export function drawNetPanel(ctx: CanvasRenderingContext2D, W: number, H: number, title: string, subtitle: string, progress: number, fontSize: number): void {
  const panelW = Math.min(320, W * 0.6);
  const panelH = progress >= 0 ? 72 : 56;
  const px = (W - panelW) / 2;
  const py = H * 0.12;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.beginPath();
  const r = 6;
  ctx.moveTo(px + r, py);
  ctx.lineTo(px + panelW - r, py);
  ctx.quadraticCurveTo(px + panelW, py, px + panelW, py + r);
  ctx.lineTo(px + panelW, py + panelH - r);
  ctx.quadraticCurveTo(px + panelW, py + panelH, px + panelW - r, py + panelH);
  ctx.lineTo(px + r, py + panelH);
  ctx.quadraticCurveTo(px, py + panelH, px, py + panelH - r);
  ctx.lineTo(px, py + r);
  ctx.quadraticCurveTo(px, py, px + r, py);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 160, 0, 0.6)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ff9800';
  ctx.fillText(title, W / 2, py + 22);

  ctx.font = `${Math.max(11, fontSize - 2)}px monospace`;
  ctx.fillStyle = '#ccc';
  ctx.fillText(subtitle, W / 2, py + 40);

  if (progress >= 0) {
    const barX = px + 16;
    const barW = panelW - 32;
    const barH = 10;
    const barY = py + 52;
    const fill = Math.min(1, progress);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.fillRect(barX, barY, barW, barH);

    const g = Math.round(255 * (1 - fill));
    const rr = Math.round(255 * Math.min(1, fill * 2));
    ctx.fillStyle = `rgb(${rr}, ${g}, 0)`;
    ctx.fillRect(barX, barY, barW * fill, barH);
  }

  ctx.textAlign = 'start';
}

// ── drawQuickChats ──

export function drawQuickChats(ctx: CanvasRenderingContext2D, state: GameState, canvas: HTMLCanvasElement, localPlayerId: number): void {
  if (state.quickChats.length === 0) return;
  const localTeam = state.players[localPlayerId]?.team ?? Team.Bottom;
  const visibleChats = state.quickChats.filter(c => c.team === localTeam);
  if (visibleChats.length === 0) return;
  const H = canvas.clientHeight;
  const lineH = 18;
  const trayH = 68;
  const nukeH = 72;
  const safeBottom = getSafeBottom();
  const bottomY = H - trayH - nukeH - safeBottom - 12;
  const startX = 12;

  for (let i = 0; i < visibleChats.length; i++) {
    const c = visibleChats[visibleChats.length - 1 - i];
    const alpha = Math.max(0.2, 1 - c.age / c.maxAge);
    const style = quickChatStyle(c.message);
    const text = `${style.icon} P${c.playerId + 1}: ${c.message}`;
    ctx.font = 'bold 12px monospace';
    const w = ctx.measureText(text).width + 12;
    const y = bottomY - (visibleChats.length - 1 - i) * lineH;
    const rgb = hexToRgba(style.color);
    ctx.fillStyle = `${rgb}${0.18 * alpha})`;
    ctx.fillRect(startX, y - 12, w, 15);
    ctx.fillStyle = `${rgb}${0.95 * alpha})`;
    ctx.fillText(text, startX + 6, y);
  }
}

// ── drawFloatingTexts ──

export function drawFloatingTexts(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  sprites: SpriteLoader,
  ui: UIAssets,
  isometric: boolean,
  localPlayerId: number,
  frameNow: number,
): void {
  const showDmgNums = getVisualSettings().damageNumbers;
  for (const ft of state.floatingTexts) {
    if (ft.ftType === 'damage' && !showDmgNums) continue;
    if (ft.ownerOnly != null && ft.ownerOnly !== localPlayerId) continue;
    const t = ft.age / ft.maxAge;
    const isDmg = ft.ftType === 'damage';
    const isHeal = ft.ftType === 'heal';

    const alpha = t < 0.6 ? 1 : 1 - ((t - 0.6) / 0.4) * ((t - 0.6) / 0.4);

    let xOff: number, yOff: number;
    if (isDmg) {
      xOff = ft.xOff * T;
      yOff = -(1 - (1 - t) * (1 - t)) * 24;
    } else if (isHeal) {
      xOff = ft.xOff * T;
      yOff = -(1 - (1 - t) * (1 - t)) * 30;
    } else {
      xOff = ft.xOff * T;
      yOff = -(1 - (1 - t) * (1 - t)) * 24;
    }

    let scale = 1;
    if (isDmg && ft.magnitude) {
      const magScale = Math.min(1.5, 1 + (ft.magnitude - 5) * 0.011);
      const popT = Math.min(t / 0.1, 1);
      scale = magScale * (1 + 0.4 * (1 - popT));
    } else if (ft.big) {
      scale = t < 0.15 ? 1.6 - (t / 0.15) * 0.6 : 1;
    }

    let fontSize = ft.big ? 14 : 11;
    if (isDmg && ft.magnitude) {
      fontSize = Math.min(16, 11 + Math.floor(ft.magnitude / 10));
    }

    ctx.globalAlpha = Math.max(0, alpha);
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    const { px: ftBasePx, py: ftBasePy } = tileToPixel(ft.x, ft.y, isometric);
    const px = ftBasePx + xOff;
    const py = ftBasePy + yOff;

    ctx.save();
    if (scale !== 1) {
      ctx.translate(px, py);
      ctx.scale(scale, scale);
      ctx.translate(-px, -py);
    }

    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.lineWidth = isDmg ? 3 : 2.5;
    const color = isDmg ? '#ff4444' : ft.color;

    const mi = ft.miniIcon;
    const hasText = ft.text.length > 0;

    if (mi && !ft.icon) {
      const iconSz = fontSize + 2;
      const textW = hasText ? ctx.measureText(ft.text).width : 0;
      const gap = hasText ? 2 : 0;
      const totalW = iconSz + gap + textW;
      const iconX = px - totalW / 2;
      const iconCy = py - iconSz / 2 - 1;

      drawMiniIcon(ctx, sprites, ui, mi, iconX, iconCy, iconSz, color, frameNow);

      if (hasText) {
        const textX = iconX + iconSz + gap + textW / 2;
        ctx.strokeText(ft.text, textX, py);
        ctx.fillStyle = color;
        ctx.fillText(ft.text, textX, py);
      }
    } else if (ft.icon) {
      const textW = ctx.measureText(ft.text).width;
      const iconSz = fontSize;
      const totalW = textW + iconSz + 1;
      const textX = px - totalW / 2 + textW / 2;
      ctx.strokeText(ft.text, textX, py);
      ctx.fillStyle = color;
      ctx.fillText(ft.text, textX, py);
      const iconX = textX + textW / 2 + 1;
      const iconCy = py - iconSz / 2 - 1;
      if (!ui.drawIcon(ctx, ft.icon as any, iconX, iconCy, iconSz)) {
        const icx = iconX + iconSz / 2, icy = iconCy + iconSz / 2;
        const ihr = iconSz * 0.4;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(icx, icy, ihr, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.strokeText(ft.text, px, py);
      ctx.fillStyle = color;
      ctx.fillText(ft.text, px, py);
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'start';
}

// ── drawMiniIcon ──

export function drawMiniIcon(
  ctx: CanvasRenderingContext2D,
  sprites: SpriteLoader,
  ui: UIAssets,
  icon: string,
  x: number, y: number, sz: number, color: string,
  frameNow: number,
): void {
  const mapped = FLOATING_TEXT_ICON_MAP[icon];
  if (mapped && drawStatVisualIcon(ctx, ui, mapped, x, y, sz, true)) return;

  const cx = x + sz / 2, cy = y + sz / 2;
  const r = sz * 0.4;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';

  switch (icon) {
    case 'sword': {
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.7, cy + r * 0.7);
      ctx.lineTo(cx + r * 0.7, cy - r * 0.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.4, cy - r * 0.2);
      ctx.lineTo(cx + r * 0.2, cy + r * 0.4);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx - r * 0.7, cy + r * 0.7, r * 0.15, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'arrow': {
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.7, cy - r * 0.5);
      ctx.lineTo(cx + r * 0.7, cy + r * 0.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + r * 0.7, cy + r * 0.5);
      ctx.lineTo(cx + r * 0.2, cy + r * 0.3);
      ctx.moveTo(cx + r * 0.7, cy + r * 0.5);
      ctx.lineTo(cx + r * 0.5, cy);
      ctx.stroke();
      break;
    }
    case 'fire': {
      ctx.fillStyle = '#ff8c00';
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.quadraticCurveTo(cx + r * 0.8, cy - r * 0.2, cx + r * 0.4, cy + r * 0.6);
      ctx.quadraticCurveTo(cx, cy + r * 0.2, cx - r * 0.4, cy + r * 0.6);
      ctx.quadraticCurveTo(cx - r * 0.8, cy - r * 0.2, cx, cy - r);
      ctx.fill();
      ctx.fillStyle = '#ffeb3b';
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.4);
      ctx.quadraticCurveTo(cx + r * 0.35, cy + r * 0.1, cx + r * 0.15, cy + r * 0.5);
      ctx.quadraticCurveTo(cx, cy + r * 0.3, cx - r * 0.15, cy + r * 0.5);
      ctx.quadraticCurveTo(cx - r * 0.35, cy + r * 0.1, cx, cy - r * 0.4);
      ctx.fill();
      break;
    }
    case 'skull': {
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.15, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.beginPath();
      ctx.arc(cx - r * 0.2, cy - r * 0.2, r * 0.12, 0, Math.PI * 2);
      ctx.arc(cx + r * 0.2, cy - r * 0.2, r * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillRect(cx - r * 0.3, cy + r * 0.3, r * 0.6, r * 0.25);
      break;
    }
    case 'shield_icon': {
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.7);
      ctx.lineTo(cx + r * 0.6, cy - r * 0.3);
      ctx.lineTo(cx + r * 0.5, cy + r * 0.4);
      ctx.lineTo(cx, cy + r * 0.7);
      ctx.lineTo(cx - r * 0.5, cy + r * 0.4);
      ctx.lineTo(cx - r * 0.6, cy - r * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.4);
      ctx.lineTo(cx + r * 0.3, cy - r * 0.1);
      ctx.lineTo(cx + r * 0.25, cy + r * 0.2);
      ctx.lineTo(cx, cy + r * 0.4);
      ctx.lineTo(cx - r * 0.25, cy + r * 0.2);
      ctx.lineTo(cx - r * 0.3, cy - r * 0.1);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'lightning': {
      ctx.fillStyle = '#ffeb3b';
      ctx.beginPath();
      ctx.moveTo(cx + r * 0.1, cy - r * 0.8);
      ctx.lineTo(cx - r * 0.3, cy + r * 0.05);
      ctx.lineTo(cx + r * 0.05, cy + r * 0.05);
      ctx.lineTo(cx - r * 0.15, cy + r * 0.8);
      ctx.lineTo(cx + r * 0.4, cy - r * 0.1);
      ctx.lineTo(cx + r * 0.05, cy - r * 0.1);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'poison': {
      ctx.fillStyle = '#9c27b0';
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.6);
      ctx.quadraticCurveTo(cx + r * 0.7, cy + r * 0.2, cx, cy + r * 0.7);
      ctx.quadraticCurveTo(cx - r * 0.7, cy + r * 0.2, cx, cy - r * 0.6);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.arc(cx - r * 0.15, cy + r * 0.1, r * 0.08, 0, Math.PI * 2);
      ctx.arc(cx + r * 0.15, cy + r * 0.1, r * 0.08, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'heart': {
      ctx.fillStyle = '#44ff44';
      ctx.beginPath();
      ctx.moveTo(cx, cy + r * 0.5);
      ctx.quadraticCurveTo(cx - r * 0.8, cy - r * 0.1, cx - r * 0.4, cy - r * 0.5);
      ctx.quadraticCurveTo(cx, cy - r * 0.8, cx, cy - r * 0.2);
      ctx.quadraticCurveTo(cx, cy - r * 0.8, cx + r * 0.4, cy - r * 0.5);
      ctx.quadraticCurveTo(cx + r * 0.8, cy - r * 0.1, cx, cy + r * 0.5);
      ctx.fill();
      break;
    }
    case 'potion_blue':
    case 'potion_red':
    case 'potion_green': {
      const potionColor = icon === 'potion_blue' ? 'blue' as const : icon === 'potion_red' ? 'red' as const : 'green' as const;
      const potionData = sprites.getPotionSprite(potionColor);
      if (potionData) {
        const [pImg, pDef] = potionData;
        const frame = Math.floor(frameNow / 120) % pDef.cols;
        const fsx = frame * pDef.frameW;
        ctx.drawImage(pImg, fsx, 0, pDef.frameW, pDef.frameH, x, y, sz, sz);
      }
      break;
    }
  }
  ctx.lineCap = 'butt';
}

// ── drawNukeEffects ──

export function drawNukeEffects(ctx: CanvasRenderingContext2D, state: GameState, sprites: SpriteLoader, isometric: boolean): void {
  for (const n of state.nukeEffects) {
    const progress = n.age / n.maxAge;
    const { px, py } = tileToPixel(n.x, n.y, isometric);
    const r = n.radius * T;

    const ringAlpha = Math.max(0, 1 - progress);
    ctx.beginPath();
    isoArc(ctx, px, py, r, isometric);
    ctx.fillStyle = `rgba(50, 20, 0, ${ringAlpha * 0.3})`;
    ctx.fill();

    if (progress < 0.4) {
      const shockData = sprites.getFxSprite('nukeShockwave');
      if (shockData) {
        const [shockImg, shockDef] = shockData;
        const expandPct = progress / 0.4;
        const shockSize = r * 2 * expandPct;
        ctx.globalAlpha = 0.8 * (1 - expandPct);
        drawGridFrame(ctx, shockImg, shockDef as GridSpriteDef,
          Math.floor(expandPct * (shockDef as GridSpriteDef).totalFrames),
          px - shockSize / 2, py - shockSize / 2, shockSize, shockSize);
        ctx.globalAlpha = 1;
      }

      const eclipseImg = sprites.getEclipseSprite();
      if (eclipseImg) {
        const eclipseCols = 20;
        const eclipseFW = eclipseImg.width / eclipseCols;
        const eclipseFH = eclipseImg.height;
        const eclipseFrame = Math.floor((progress / 0.4) * eclipseCols) % eclipseCols;
        const eclipseSize = r * 1.6 * (0.5 + progress * 1.2);
        ctx.globalAlpha = 0.75 * (1 - progress / 0.4);
        ctx.drawImage(eclipseImg, eclipseFrame * eclipseFW, 0, eclipseFW, eclipseFH,
          px - eclipseSize / 2, py - eclipseSize / 2, eclipseSize, eclipseSize);
        ctx.globalAlpha = 1;
      }

      const explData = sprites.getFxSprite('explosion');
      if (explData) {
        const [explImg, explDef] = explData;
        const explSize = r * 1.2;
        const explFrame = Math.floor((progress / 0.4) * explDef.cols);
        ctx.globalAlpha = 0.9 * (1 - progress / 0.4);
        drawSpriteFrame(ctx, explImg, explDef as SpriteDef, explFrame, px - explSize / 2, py - explSize / 2, explSize, explSize);
        ctx.globalAlpha = 1;
      }
    }

    ctx.beginPath();
    isoArc(ctx, px, py, r, isometric);
    ctx.strokeStyle = `rgba(255, 80, 0, ${ringAlpha * 0.5})`;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

// ── drawAbilityEffects ──

export function drawAbilityEffects(ctx: CanvasRenderingContext2D, state: GameState, sprites: SpriteLoader, isometric: boolean, _frameNow: number): void {
  const tick = state.tick;
  for (const eff of state.abilityEffects) {
    const maxDur = eff.type === 'deep_rain' ? 8 * TICK_RATE : 6 * TICK_RATE;
    const fadeIn = Math.min(1, (maxDur - eff.duration) / TICK_RATE);
    const fadeOut = Math.min(1, eff.duration / TICK_RATE);
    const fade = Math.min(fadeIn, fadeOut);

    if (eff.type === 'deep_rain') {
      const md = state.mapDef;
      const { px: mapW, py: mapH } = tileToPixel(md.width, md.height, isometric);
      ctx.fillStyle = `rgba(40, 60, 90, ${fade * 0.12})`;
      ctx.fillRect(0, 0, mapW, mapH);
      const lineCount = 120;
      ctx.strokeStyle = `rgba(160, 190, 230, ${fade * 0.3})`;
      ctx.lineWidth = 0.8;
      for (let i = 0; i < lineCount; i++) {
        const seed = i * 7919 + 13;
        const rx = ((tick * 2.5 + seed) % mapW);
        const ry = ((tick * 9 + seed * 3) % mapH);
        const len = 8 + (seed % 8);
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 2, ry + len);
        ctx.stroke();
      }
      if (eff.duration % (3 * TICK_RATE) < 2) {
        ctx.fillStyle = `rgba(200, 220, 255, ${fade * 0.06})`;
        ctx.fillRect(0, 0, mapW, mapH);
      }
    } else if (eff.type === 'wild_frenzy' && eff.x != null && eff.y != null && eff.radius != null) {
      const { px, py } = tileToPixel(eff.x, eff.y, isometric);
      const r = eff.radius * T;
      const pulse = 0.6 + 0.4 * Math.sin(tick * 0.25);

      const grad = ctx.createRadialGradient(px, py, 0, px, py, r);
      grad.addColorStop(0, `rgba(255, 80, 0, ${fade * 0.15 * pulse})`);
      grad.addColorStop(0.7, `rgba(255, 130, 30, ${fade * 0.08 * pulse})`);
      grad.addColorStop(1, `rgba(255, 60, 0, 0)`);
      ctx.beginPath();
      isoArc(ctx, px, py, r, isometric);
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(tick * 0.05);
      ctx.beginPath();
      isoArc(ctx, 0, 0, r * 0.95, isometric);
      ctx.setLineDash([8, 12]);
      ctx.strokeStyle = `rgba(255, 200, 50, ${fade * 0.4})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      for (let i = 0; i < 6; i++) {
        const a = (tick * 0.08 + i * Math.PI / 3) % (Math.PI * 2);
        const sr = r * (0.3 + 0.5 * ((i * 31 + tick) % 20) / 20);
        const sx = px + Math.cos(a) * sr;
        const sy = py + Math.sin(a) * sr;
        ctx.beginPath();
        ctx.arc(sx, sy, 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 220, 100, ${fade * 0.5})`;
        ctx.fill();
      }
    } else if (eff.type === 'demon_fireball_telegraph' && eff.x != null && eff.y != null && eff.radius != null) {
      const { px, py } = tileToPixel(eff.x, eff.y, isometric);
      const r = eff.radius * T;
      const pulse = 0.5 + 0.5 * Math.sin(tick * 0.4);
      const warn = 1.0;

      ctx.beginPath();
      isoArc(ctx, px, py, r * 0.85, isometric);
      ctx.fillStyle = `rgba(60, 10, 0, ${warn * 0.18})`;
      ctx.fill();

      ctx.beginPath();
      isoArc(ctx, px, py, r, isometric);
      ctx.strokeStyle = `rgba(255, 80, 0, ${warn * (0.5 + 0.5 * pulse)})`;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(tick * 0.07);
      ctx.beginPath();
      isoArc(ctx, 0, 0, r * 0.65, isometric);
      ctx.setLineDash([6, 10]);
      ctx.strokeStyle = `rgba(255, 200, 50, ${warn * 0.55})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      ctx.strokeStyle = `rgba(255, 100, 0, ${warn * 0.35})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px - r, py); ctx.lineTo(px + r, py);
      ctx.moveTo(px, py - r); ctx.lineTo(px, py + r);
      ctx.stroke();

    } else if (eff.type === 'demon_fireball_inbound' && eff.data != null) {
      const { px: cx, py: cy } = tileToPixel(eff.data.curX, eff.data.curY, isometric);

      let angle = Math.PI;
      if (eff.x != null && eff.y != null) {
        const { px: tx, py: ty } = tileToPixel(eff.x, eff.y, isometric);
        angle = Math.atan2(ty - cy, tx - cx);
      }

      const meteorImg = sprites.getMeteoriteSprite('orange');
      if (meteorImg) {
        const cols = 10;
        const frameW = meteorImg.width / cols;
        const frameH = meteorImg.height / 6;
        const col = Math.floor(tick * 0.4) % cols;
        const drawSize = T * 3;
        const aspect = frameW / frameH;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        ctx.drawImage(meteorImg, col * frameW, 0, frameW, frameH,
          -drawSize * aspect / 2, -drawSize / 2, drawSize * aspect, drawSize);
        ctx.restore();
      }

      const orbR = 14;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, orbR * 2);
      glow.addColorStop(0, 'rgba(255, 220, 80, 0.35)');
      glow.addColorStop(0.5, 'rgba(255, 80, 0, 0.15)');
      glow.addColorStop(1, 'rgba(200, 20, 0, 0)');
      ctx.beginPath();
      ctx.arc(cx, cy, orbR * 2, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();

    } else if (eff.type === 'geist_summon_telegraph' && eff.x != null && eff.y != null) {
      const { px, py } = tileToPixel(eff.x, eff.y, isometric);
      const bhImg = sprites.getBlackHoleSprite();
      if (bhImg) {
        const cols = 7, rows = 8;
        const frameW = bhImg.width / cols;
        const frameH = bhImg.height / rows;
        const frame = Math.floor(tick * 0.3) % (cols * rows);
        const sx = (frame % cols) * frameW;
        const sy = Math.floor(frame / cols) * frameH;
        const drawSize = T * 3;
        ctx.globalAlpha = 0.85;
        ctx.drawImage(bhImg, sx, sy, frameW, frameH, px - drawSize / 2, py - drawSize / 2, drawSize, drawSize);
        ctx.globalAlpha = 1;
      } else {
        ctx.beginPath();
        ctx.arc(px, py, T * 1.5, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(206, 147, 216, ${0.4 + 0.3 * Math.sin(tick * 0.15)})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

    } else if (eff.type === 'geist_summon_inbound' && eff.data != null) {
      const { px: cx, py: cy } = tileToPixel(eff.data.curX, eff.data.curY, isometric);
      const skullImg = sprites.getGoldenSkullSprite();
      if (skullImg) {
        const skullSize = T * 1.4;
        const bob = Math.sin(tick * 0.25) * 3;
        ctx.save();
        ctx.translate(cx, cy + bob);
        if (eff.x != null && eff.y != null) {
          const { px: tx, py: ty } = tileToPixel(eff.x, eff.y, isometric);
          const angle = Math.atan2(ty - cy, tx - cx);
          ctx.rotate(angle * 0.15);
        }
        ctx.drawImage(skullImg, -skullSize / 2, -skullSize / 2, skullSize, skullSize);
        ctx.restore();
      }

      if (eff.x != null && eff.y != null) {
        const { px: tx, py: ty } = tileToPixel(eff.x, eff.y, isometric);
        const totalDx = tx - cx, totalDy = ty - cy;
        const totalDist = Math.sqrt(totalDx * totalDx + totalDy * totalDy) || 1;
        const trailSteps = 5;
        for (let ti = 0; ti < trailSteps; ti++) {
          const t = (ti + 1) / trailSteps;
          const trailX = cx - (totalDx / totalDist) * t * T * 0.8;
          const trailY = cy - (totalDy / totalDist) * t * T * 0.8;
          const alpha = (1 - t) * 0.35;
          const tr = T * 0.3 * (1 - t * 0.5);
          ctx.beginPath();
          ctx.arc(trailX, trailY, tr, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(206, 147, 216, ${alpha})`;
          ctx.fill();
        }
      }

      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, T * 1.2);
      glow.addColorStop(0, 'rgba(206, 147, 216, 0.3)');
      glow.addColorStop(0.5, 'rgba(128, 0, 128, 0.15)');
      glow.addColorStop(1, 'rgba(128, 0, 128, 0)');
      ctx.beginPath();
      ctx.arc(cx, cy, T * 1.2, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();

    } else if (eff.type === 'demon_fireball' && eff.x != null && eff.y != null && eff.radius != null) {
      const maxDurFB = Math.round(0.8 * TICK_RATE);
      const progress = 1 - eff.duration / maxDurFB;
      const { px, py } = tileToPixel(eff.x, eff.y, isometric);
      const r = eff.radius * T;

      const ringR = r * (0.3 + progress * 0.7);
      const ringAlpha = Math.max(0, 1 - progress);
      ctx.beginPath();
      isoArc(ctx, px, py, ringR, isometric);
      const fireGrad = ctx.createRadialGradient(px, py, 0, px, py, ringR);
      fireGrad.addColorStop(0, `rgba(255, 220, 50, ${ringAlpha * 0.4})`);
      fireGrad.addColorStop(0.4, `rgba(255, 120, 0, ${ringAlpha * 0.3})`);
      fireGrad.addColorStop(1, `rgba(200, 30, 0, 0)`);
      ctx.fillStyle = fireGrad;
      ctx.fill();

      const explData = sprites.getFxSprite('explosion');
      if (explData && progress < 0.6) {
        const [explImg, explDef] = explData;
        const explSize = r * 1.5;
        const explFrame = Math.min(Math.floor(progress / 0.6 * explDef.cols), explDef.cols - 1);
        ctx.globalAlpha = 0.8 * (1 - progress / 0.6);
        drawSpriteFrame(ctx, explImg, explDef as SpriteDef, explFrame, px - explSize / 2, py - explSize / 2, explSize, explSize);
        ctx.globalAlpha = 1;
      }

      ctx.beginPath();
      isoArc(ctx, px, py, r * 0.8, isometric);
      ctx.fillStyle = `rgba(40, 10, 0, ${ringAlpha * 0.2})`;
      ctx.fill();

      for (let i = 0; i < 8; i++) {
        const a = (tick * 0.15 + i * Math.PI / 4) % (Math.PI * 2);
        const er = ringR * (0.5 + 0.5 * ((i * 17 + tick * 2) % 30) / 30);
        const ex = px + Math.cos(a) * er;
        const ey = py + Math.sin(a) * er - progress * 15;
        ctx.beginPath();
        ctx.arc(ex, ey, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, ${150 + i * 10}, 0, ${ringAlpha * 0.6})`;
        ctx.fill();
      }
    }
  }

  // Draw fleeing goblin indicator
  for (const u of state.units) {
    if (u.fleeTimer != null && u.fleeTimer > 0) {
      const { px, py } = tileToPixel(u.x, u.y, isometric);
      ctx.fillStyle = '#ffeb3b';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('!!', px + T / 2, py - 4);
      ctx.textAlign = 'start';
    }
  }
}

// ── drawFogOfWar ──

export function drawFogOfWar(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  dt: number,
  localPlayerId: number,
  isometric: boolean,
  camera: Camera,
  canvas: HTMLCanvasElement,
  fogLinger: Float32Array | null,
  fogCache: HTMLCanvasElement | null,
  fogImageData: ImageData | null,
  drawIsoDiamond: (ctx: CanvasRenderingContext2D, cx: number, cy: number) => void,
): { fogLinger: Float32Array; fogCache: HTMLCanvasElement | null; fogImageData: ImageData | null } {
  const FOG_LINGER_DURATION = 2.0;
  const team = state.players[localPlayerId]?.team ?? 0;
  const vis = state.visibility[team];
  if (!vis) return { fogLinger: fogLinger ?? new Float32Array(0), fogCache, fogImageData };

  const mw = state.mapDef.width;
  const mh = state.mapDef.height;
  const totalTiles = mw * mh;

  if (!fogLinger || fogLinger.length !== totalTiles) {
    fogLinger = new Float32Array(totalTiles);
  }

  const linger = fogLinger;
  const LINGER = FOG_LINGER_DURATION;
  for (let i = 0; i < totalTiles; i++) {
    if (vis[i]) {
      linger[i] = LINGER;
    } else if (linger[i] > 0) {
      linger[i] = Math.max(0, linger[i] - dt);
    }
  }

  if (isometric) {
    const FOG_ALPHA = 180;
    const vpX0 = camera.x - T;
    const vpY0 = camera.y - T;
    const vpX1 = camera.x + canvas.clientWidth / camera.zoom + T;
    const vpY1 = camera.y + canvas.clientHeight / camera.zoom + T;
    const hw = ISO_TILE_W / 2;
    const hh = ISO_TILE_H / 2;
    // Compute visible tile range from viewport to avoid iterating the full map
    // Iso transform: cx = (tx - ty) * hw, cy = (tx + ty) * hh
    // Invert: tx = cy/hh/2 + cx/hw/2, ty = cy/hh/2 - cx/hw/2
    // Use viewport corners to find tile bounds with generous margin
    const margin = 2;
    const invHW = 1 / (2 * hw), invHH = 1 / (2 * hh);
    // Sample all 4 viewport corners to find tile range
    const corners = [
      { x: vpX0, y: vpY0 }, { x: vpX1, y: vpY0 },
      { x: vpX0, y: vpY1 }, { x: vpX1, y: vpY1 },
    ];
    let tMinX = mw, tMaxX = 0, tMinY = mh, tMaxY = 0;
    for (const c of corners) {
      const ttx = c.y * invHH + c.x * invHW;
      const tty = c.y * invHH - c.x * invHW;
      tMinX = Math.min(tMinX, ttx); tMaxX = Math.max(tMaxX, ttx);
      tMinY = Math.min(tMinY, tty); tMaxY = Math.max(tMaxY, tty);
    }
    const fogTxMin = Math.max(0, Math.floor(tMinX - margin));
    const fogTxMax = Math.min(mw - 1, Math.ceil(tMaxX + margin));
    const fogTyMin = Math.max(0, Math.floor(tMinY - margin));
    const fogTyMax = Math.min(mh - 1, Math.ceil(tMaxY + margin));

    ctx.beginPath();
    let hasLinger = false;
    for (let ty = fogTyMin; ty <= fogTyMax; ty++) {
      for (let tx = fogTxMin; tx <= fogTxMax; tx++) {
        const idx = ty * mw + tx;
        if (vis[idx]) continue;
        const tileXc = tx + 0.5, tileYc = ty + 0.5;
        const cx = (tileXc - tileYc) * hw;
        const cy = (tileXc + tileYc) * hh;
        if (cx + hw < vpX0 || cx - hw > vpX1 || cy + hh < vpY0 || cy - hh > vpY1) continue;
        if (linger[idx] > 0) {
          hasLinger = true;
          continue;
        }
        ctx.moveTo(cx, cy - hh);
        ctx.lineTo(cx + hw, cy);
        ctx.lineTo(cx, cy + hh);
        ctx.lineTo(cx - hw, cy);
        ctx.closePath();
      }
    }
    ctx.fillStyle = `rgba(0,0,0,${FOG_ALPHA / 255})`;
    ctx.fill();
    if (hasLinger) {
      for (let ty = fogTyMin; ty <= fogTyMax; ty++) {
        for (let tx = fogTxMin; tx <= fogTxMax; tx++) {
          const idx = ty * mw + tx;
          if (vis[idx] || linger[idx] <= 0) continue;
          const tileXc = tx + 0.5, tileYc = ty + 0.5;
          const cx = (tileXc - tileYc) * hw;
          const cy = (tileXc + tileYc) * hh;
          if (cx + hw < vpX0 || cx - hw > vpX1 || cy + hh < vpY0 || cy - hh > vpY1) continue;
          const t = 1 - linger[idx] / LINGER;
          ctx.fillStyle = `rgba(0,0,0,${(FOG_ALPHA / 255) * t})`;
          drawIsoDiamond(ctx, cx, cy);
        }
      }
    }
    return { fogLinger, fogCache, fogImageData };
  }

  if (!fogCache) {
    fogCache = document.createElement('canvas');
  }
  {
    fogCache.width = mw;
    fogCache.height = mh;
    const fctx = fogCache.getContext('2d')!;
    if (!fogImageData || fogImageData.width !== mw || fogImageData.height !== mh) {
      fogImageData = fctx.createImageData(mw, mh);
    }
    const imgData = fogImageData;
    const d = imgData.data;
    d.fill(0);
    const FOG_ALPHA = 180;
    for (let i = 0; i < totalTiles; i++) {
      if (vis[i]) continue;
      const p = i * 4;
      if (linger[i] > 0) {
        const t = 1 - linger[i] / LINGER;
        d[p + 3] = Math.round(FOG_ALPHA * t);
      } else {
        d[p + 3] = FOG_ALPHA;
      }
    }
    fctx.putImageData(imgData, 0, 0);
  }

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(fogCache, 0, 0, mw * T, mh * T);
  ctx.imageSmoothingEnabled = false;

  return { fogLinger, fogCache, fogImageData };
}

// ── drawMinimap ──

export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  _sprites: SpriteLoader,
  camera: Camera,
  canvas: HTMLCanvasElement,
  isometric: boolean,
  localPlayerId: number,
  mapW: number,
  mapH: number,
  frameNow: number,
  minimapCacheTick: number,
  minimapCache: HTMLCanvasElement | null,
  minimapCacheW: number,
  minimapCacheH: number,
  isTileVisible: (state: GameState, tileX: number, tileY: number) => boolean,
  tpFn: (tileX: number, tileY: number) => { px: number; py: number },
): { minimapCacheTick: number; minimapCache: HTMLCanvasElement | null; minimapCacheW: number; minimapCacheH: number } {
  const compact = canvas.clientWidth < 600;
  const mW = mapW;
  const mH = mapH;

  let mmW: number, mmH: number, mx: number, my: number;
  const _mm = { mx: 0, my: 0 };
  let tileToMM: (tx: number, ty: number) => { mx: number; my: number };

  let isoBounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;

  if (isometric) {
    isoBounds = isoWorldBounds(mW, mH);
    const isoW = isoBounds.maxX - isoBounds.minX;
    const isoH = isoBounds.maxY - isoBounds.minY;
    const isoAspect = isoW / isoH;
    if (isoAspect >= 1) { mmW = compact ? 120 : 180; mmH = Math.round(mmW / isoAspect); }
    else { mmH = compact ? 120 : 180; mmW = Math.round(mmH * isoAspect); }
    mx = canvas.clientWidth - mmW - 10;
    my = (compact ? 46 : 60) + getSafeTop();
    const sX = mmW / isoW, sY = mmH / isoH;
    const bMinX = isoBounds.minX, bMinY = isoBounds.minY;
    tileToMM = (tx: number, ty: number) => {
      const { px: wpx, py: wpy } = tpFn(tx, ty);
      _mm.mx = mx + (wpx - bMinX) * sX; _mm.my = my + (wpy - bMinY) * sY;
      return _mm;
    };
  } else {
    const aspect = mW / mH;
    if (aspect >= 1) { mmW = compact ? 120 : 180; mmH = Math.round(mmW / aspect); }
    else { mmH = compact ? 120 : 180; mmW = Math.round(mmH * aspect); }
    mx = canvas.clientWidth - mmW - 10;
    my = (compact ? 46 : 60) + getSafeTop();
    const scaleX = mmW / mW, scaleY = mmH / mH;
    tileToMM = (tx: number, ty: number) => { _mm.mx = mx + tx * scaleX; _mm.my = my + ty * scaleY; return _mm; };
  }

  const needsRedraw = state.tick !== minimapCacheTick
    || !minimapCache
    || minimapCacheW !== mmW + 4
    || minimapCacheH !== mmH + 4;

  if (needsRedraw) {
    minimapCacheTick = state.tick;
    minimapCacheW = mmW + 4;
    minimapCacheH = mmH + 4;
    if (!minimapCache) minimapCache = document.createElement('canvas');
    minimapCache.width = mmW + 4;
    minimapCache.height = mmH + 4;
    const mc = minimapCache.getContext('2d')!;
    const offX = -mx + 2, offY = -my + 2;
    mc.translate(offX, offY);

    mc.fillStyle = 'rgba(60, 110, 100, 0.9)';
    mc.fillRect(mx - 2, my - 2, mmW + 4, mmH + 4);

    mc.strokeStyle = '#2a5a2a';
    mc.lineWidth = 1;
    mc.beginPath();
    if (state.mapDef.shapeAxis === 'y') {
      for (let y = 0; y <= mH; y += 4) {
        const range = state.mapDef.getPlayableRange(y);
        const p = tileToMM(range.min, y);
        if (y === 0) mc.moveTo(p.mx, p.my);
        else mc.lineTo(p.mx, p.my);
      }
      for (let y = mH; y >= 0; y -= 4) {
        const range = state.mapDef.getPlayableRange(y);
        const p = tileToMM(range.max, y);
        mc.lineTo(p.mx, p.my);
      }
    } else {
      for (let x = 0; x <= mW; x += 4) {
        const range = state.mapDef.getPlayableRange(x);
        const p = tileToMM(x, range.min);
        if (x === 0) mc.moveTo(p.mx, p.my);
        else mc.lineTo(p.mx, p.my);
      }
      for (let x = mW; x >= 0; x -= 4) {
        const range = state.mapDef.getPlayableRange(x);
        const p = tileToMM(x, range.max);
        mc.lineTo(p.mx, p.my);
      }
    }
    mc.closePath();
    mc.fillStyle = '#3a6b3a';
    mc.fill();
    mc.stroke();

    const dc = state.mapDef.diamondCenter;
    const goldRemaining = state.diamondCells.some(c => c.gold > 0);
    if (goldRemaining) {
      mc.fillStyle = 'rgba(200, 170, 20, 0.6)';
      const dHW = state.mapDef.diamondHalfW;
      const dHH = state.mapDef.diamondHalfH;
      let p = tileToMM(dc.x, dc.y - dHH);
      const dcTx = p.mx, dcTy = p.my;
      p = tileToMM(dc.x + dHW, dc.y);
      const dcRx = p.mx, dcRy = p.my;
      p = tileToMM(dc.x, dc.y + dHH);
      const dcBx = p.mx, dcBy = p.my;
      p = tileToMM(dc.x - dHW, dc.y);
      const dcLx = p.mx, dcLy = p.my;
      mc.beginPath();
      mc.moveTo(dcTx, dcTy);
      mc.lineTo(dcRx, dcRy);
      mc.lineTo(dcBx, dcBy);
      mc.lineTo(dcLx, dcLy);
      mc.closePath();
      mc.fill();
      mc.strokeStyle = 'rgba(255, 220, 120, 0.85)';
      mc.lineWidth = 1;
      mc.stroke();
    }

    const fog = state.fogOfWar;
    const localTeam = state.players[localPlayerId]?.team ?? Team.Bottom;

    // Grid-based combat clustering (O(n) instead of O(n×k))
    const clusterCellSize = 8;
    const clusterGrid = new Map<number, { x: number; y: number; count: number }>();
    for (const u of state.units) {
      if (u.targetId === null) continue;
      if (fog && u.team !== localTeam && !isTileVisible(state, u.x, u.y)) continue;
      const key = (Math.floor(u.x / clusterCellSize)) * 10000 + Math.floor(u.y / clusterCellSize);
      const c = clusterGrid.get(key);
      if (c) {
        c.x = (c.x * c.count + u.x) / (c.count + 1);
        c.y = (c.y * c.count + u.y) / (c.count + 1);
        c.count++;
      } else {
        clusterGrid.set(key, { x: u.x, y: u.y, count: 1 });
      }
    }
    const combatClusters = Array.from(clusterGrid.values());
    const pulse = 0.5 + 0.5 * Math.sin(frameNow / 200);
    for (const c of combatClusters) {
      if (c.count < 2) continue;
      const intensity = Math.min(1, c.count / 8);
      const r = 3 + intensity * 4;
      const cp = tileToMM(c.x, c.y);
      mc.beginPath();
      mc.arc(cp.mx, cp.my, r * (0.8 + pulse * 0.4), 0, Math.PI * 2);
      mc.fillStyle = `rgba(255, 100, 50, ${intensity * 0.3 * (0.6 + pulse * 0.4)})`;
      mc.fill();
    }

    if (fog) {
      const vis = state.visibility[localTeam];
      if (vis) {
        mc.fillStyle = 'rgba(0, 0, 0, 0.55)';
        const step = 4;
        for (let ty = 0; ty < mH; ty += step) {
          for (let tx = 0; tx < mW; tx += step) {
            if (!vis[ty * mW + tx]) {
              const fp = tileToMM(tx, ty);
              const fmx = fp.mx, fmy = fp.my;
              const fp2 = tileToMM(tx + step, ty + step);
              mc.fillRect(fmx, fmy, fp2.mx - fmx + 1, fp2.my - fmy + 1);
            }
          }
        }
      }
    }

    for (const u of state.units) {
      if (fog && u.team !== localTeam && !isTileVisible(state, u.x, u.y)) continue;
      mc.fillStyle = PLAYER_COLORS[u.playerId % PLAYER_COLORS.length];
      const up = tileToMM(u.x, u.y);
      mc.fillRect(up.mx - 1, up.my - 1, 2, 2);
    }

    for (const p of state.pings) {
      if (p.team !== localTeam) continue;
      const pp = p.age / p.maxAge;
      const alpha = Math.max(0.2, 1 - pp);
      const pingP = tileToMM(p.x, p.y);

      const pulsePhase = (p.age % 10) / 10;
      const outerR = 6 + 6 * pulsePhase;
      mc.beginPath();
      mc.arc(pingP.mx, pingP.my, outerR, 0, Math.PI * 2);
      mc.strokeStyle = `rgba(255,235,59,${0.6 * alpha * (1 - pulsePhase)})`;
      mc.lineWidth = 2;
      mc.stroke();

      mc.beginPath();
      mc.arc(pingP.mx, pingP.my, 4, 0, Math.PI * 2);
      mc.strokeStyle = `rgba(255,235,59,${0.9 * alpha})`;
      mc.lineWidth = 2;
      mc.stroke();

      mc.beginPath();
      mc.arc(pingP.mx, pingP.my, 2, 0, Math.PI * 2);
      mc.fillStyle = `rgba(255,235,59,${alpha})`;
      mc.fill();
    }

    for (const h of state.harvesters) {
      if (h.state === 'dead') continue;
      if (fog && state.players[h.playerId]?.team !== localTeam && !isTileVisible(state, h.x, h.y)) continue;
      mc.fillStyle = PLAYER_COLORS[h.playerId % PLAYER_COLORS.length];
      mc.globalAlpha = 0.7;
      const hp = tileToMM(h.x, h.y);
      mc.fillRect(hp.mx, hp.my, 1, 1);
      mc.globalAlpha = 1;
    }

    for (const b of state.buildings) {
      if (fog && state.players[b.playerId]?.team !== localTeam && !isTileVisible(state, b.worldX, b.worldY)) continue;
      mc.fillStyle = PLAYER_COLORS[b.playerId % PLAYER_COLORS.length];
      const bp = tileToMM(b.worldX, b.worldY);
      mc.fillRect(bp.mx - 1, bp.my - 1, 3, 2);
    }

    for (const team of [Team.Bottom, Team.Top]) {
      const hq = getHQPosition(team, state.mapDef);
      mc.fillStyle = team === Team.Bottom ? '#2979ff' : '#ff1744';
      const hqp1 = tileToMM(hq.x, hq.y);
      const h1mx = hqp1.mx, h1my = hqp1.my;
      const hqp2 = tileToMM(hq.x + HQ_WIDTH, hq.y + HQ_HEIGHT);
      mc.fillRect(h1mx, h1my, hqp2.mx - h1mx, hqp2.my - h1my);
    }

    for (const c of state.quickChats) {
      if (c.team !== localTeam || c.age >= 20) continue;
      const hq = getHQPosition(c.team, state.mapDef);
      const chatOffset = (c.playerId % 3 - 1) * 4;
      const cp = tileToMM(hq.x + HQ_WIDTH / 2 + chatOffset, hq.y + HQ_HEIGHT / 2);
      const style = quickChatStyle(c.message);
      mc.fillStyle = style.color;
      mc.beginPath();
      mc.arc(cp.mx, cp.my, 3.2, 0, Math.PI * 2);
      mc.fill();
    }
  }

  if (minimapCache) {
    ctx.drawImage(minimapCache, mx - 2, my - 2);
  }

  const vx = camera.x, vy = camera.y;
  const vw = canvas.clientWidth / camera.zoom;
  const vh = canvas.clientHeight / camera.zoom;
  if (isometric && isoBounds) {
    const isoW = isoBounds.maxX - isoBounds.minX;
    const isoH = isoBounds.maxY - isoBounds.minY;
    const sX = mmW / isoW, sY = mmH / isoH;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      mx + (vx - isoBounds.minX) * sX,
      my + (vy - isoBounds.minY) * sY,
      vw * sX,
      vh * sY
    );
  } else {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      mx + (vx / T) * (mmW / mW),
      my + (vy / T) * (mmH / mH),
      (vw / T) * (mmW / mW),
      (vh / T) * (mmH / mH)
    );
  }

  return { minimapCacheTick, minimapCache, minimapCacheW, minimapCacheH };
}
