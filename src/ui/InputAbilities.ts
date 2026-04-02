/**
 * InputAbilities.ts — Ability/nuke overlays, selection panel, and utility
 * methods extracted from InputHandler.
 *
 * Contains activateAbility, drawAbilityIcon, drawAbilityOverlay,
 * isNukeLocked, drawNukeOverlay, drawQuickChatRadial, quickChatFeedback,
 * drawSelectedUnit, selectMvpUnit, clearSelection, findUnitNear,
 * getUnitTooltip, getBuildingTooltip, getBuildingLabel.
 */

import { Game } from '../game/Game';
import { Camera } from '../rendering/Camera';
import { Renderer } from '../rendering/Renderer';
import {
  BuildingType, TILE_SIZE, Lane,
  Team, Race, UnitState, NUKE_RADIUS,
  AbilityTargetMode, HQ_WIDTH, HQ_HEIGHT, StatusEffect, StatusType,
  ResearchUpgradeState, TICK_RATE,
} from '../simulation/types';
import { getHQPosition } from '../simulation/GameState';
import { RACE_COLORS, RACE_ABILITY_DEFS, getUpgradeNodeDef } from '../simulation/data';
import { UIAssets } from '../rendering/UIAssets';
import { SpriteLoader, drawSpriteFrame } from '../rendering/SpriteLoader';
import { getRaceBuildingName } from './BuildingPopup';
import { getPopupSafeY } from './SafeArea';
import { drawStatVisualIcon, type StatVisualKey } from './StatBarUtils';
import { ASSIGNMENT_LABELS } from './InputBuildTray';

// ── Buff icon metadata ──

const BUFF_ICON_META: Record<StatusType, { key: StatVisualKey; isDebuff: boolean; maxDur: number }> = {
  [StatusType.Burn]:       { key: 'burn', isDebuff: true,  maxDur: 3 },
  [StatusType.Slow]:       { key: 'slow', isDebuff: true,  maxDur: 3 },
  [StatusType.Wound]:      { key: 'wound', isDebuff: true,  maxDur: 6 },
  [StatusType.Vulnerable]: { key: 'vulnerable', isDebuff: true,  maxDur: 3 },
  [StatusType.Haste]:      { key: 'haste', isDebuff: false, maxDur: 3 },
  [StatusType.Shield]:     { key: 'shield', isDebuff: false, maxDur: 4 },
  [StatusType.Frenzy]:     { key: 'frenzy', isDebuff: false, maxDur: 4 },
  [StatusType.Stun]:       { key: 'stun', isDebuff: true,  maxDur: 1 },
};

// ── Helper text functions ──

export function statLineToken(key: StatVisualKey, text: string): string {
  return `__stat__:${key}:${text}`;
}

export function displayLineText(line: string): string {
  if (line.startsWith('__stat__:')) {
    const parts = line.split(':');
    return parts.slice(2).join(':');
  }
  if (line.startsWith('__research__:')) return 'Research';
  return line;
}

// ── Ability activation ──

export interface AbilityActivationDeps {
  game: Game;
  pid: number;
  cameraSnapOnSelect: boolean;
  laneToast: { text: string; until: number } | null;
  abilityTargeting: boolean;
  abilityPlacing: boolean;
  selectedBuilding: BuildingType | null;
  panToBuildArea: (type: BuildingType) => void;
}

export function activateAbility(
  player: { race: Race; abilityCooldown: number; abilityStacks?: number },
  d: AbilityActivationDeps,
): { abilityTargeting: boolean; abilityPlacing: boolean; selectedBuilding: BuildingType | null; laneToast: { text: string; until: number } | null } {
  const def = RACE_ABILITY_DEFS[player.race];
  let { abilityTargeting, abilityPlacing, selectedBuilding, laneToast } = d;

  if (player.race === Race.Tenders) {
    if ((player.abilityStacks ?? 0) <= 0) {
      const secsLeft = Math.ceil(player.abilityCooldown / TICK_RATE);
      laneToast = { text: `${def.name} — ${secsLeft}s`, until: Date.now() + 1500 };
      return { abilityTargeting, abilityPlacing, selectedBuilding, laneToast };
    }
  } else if (player.abilityCooldown > 0) {
    const secsLeft = Math.ceil(player.abilityCooldown / TICK_RATE);
    laneToast = { text: `${def.name} — ${secsLeft}s cooldown`, until: Date.now() + 1500 };
    return { abilityTargeting, abilityPlacing, selectedBuilding, laneToast };
  }

  if (def.targetMode === AbilityTargetMode.Instant) {
    d.game.sendCommand({ type: 'use_ability', playerId: d.pid });
    abilityTargeting = false;
    abilityPlacing = false;
  } else if (def.targetMode === AbilityTargetMode.Targeted) {
    abilityTargeting = !abilityTargeting;
    abilityPlacing = false;
  } else {
    // BuildSlot
    if (abilityPlacing) {
      abilityPlacing = false;
      selectedBuilding = null;
    } else {
      abilityPlacing = true;
      selectedBuilding = BuildingType.Tower;
      if (d.cameraSnapOnSelect) d.panToBuildArea(BuildingType.Tower);
    }
    abilityTargeting = false;
  }

  return { abilityTargeting, abilityPlacing, selectedBuilding, laneToast };
}

// ── Draw ability icon (canvas-rendered per-race icons) ──

export function drawAbilityIcon(ctx: CanvasRenderingContext2D, race: Race, cx: number, cy: number, size: number): void {
  const s = size;
  const hs = s / 2;
  ctx.save();
  ctx.translate(cx, cy + hs);

  switch (race) {
    case Race.Crown: {
      ctx.beginPath();
      ctx.arc(0, 0, hs * 0.85, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd700';
      ctx.fill();
      ctx.strokeStyle = '#b8860b';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#8b6914';
      ctx.font = `bold ${Math.round(s * 0.6)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('$', 0, s * 0.22);
      break;
    }
    case Race.Horde: {
      ctx.fillStyle = '#8d6e63';
      ctx.fillRect(-1.5, -hs * 0.7, 3, s * 0.85);
      ctx.beginPath();
      ctx.moveTo(-hs * 0.7, -hs * 0.65);
      ctx.quadraticCurveTo(-hs * 0.8, -hs * 0.1, -hs * 0.15, hs * 0.1);
      ctx.lineTo(hs * 0.15, hs * 0.1);
      ctx.quadraticCurveTo(hs * 0.8, -hs * 0.1, hs * 0.7, -hs * 0.65);
      ctx.closePath();
      ctx.fillStyle = '#9e9e9e';
      ctx.fill();
      ctx.strokeStyle = '#616161';
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    }
    case Race.Goblins: {
      ctx.fillStyle = '#69f0ae';
      ctx.beginPath();
      ctx.moveTo(-hs * 0.2, -hs * 0.5);
      ctx.lineTo(hs * 0.2, -hs * 0.5);
      ctx.lineTo(hs * 0.2, -hs * 0.3);
      ctx.lineTo(hs * 0.55, hs * 0.05);
      ctx.quadraticCurveTo(hs * 0.65, hs * 0.7, 0, hs * 0.8);
      ctx.quadraticCurveTo(-hs * 0.65, hs * 0.7, -hs * 0.55, hs * 0.05);
      ctx.lineTo(-hs * 0.2, -hs * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#2e7d32';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = '#8d6e63';
      ctx.fillRect(-hs * 0.25, -hs * 0.7, hs * 0.5, hs * 0.25);
      break;
    }
    case Race.Oozlings: {
      ctx.beginPath();
      ctx.moveTo(-hs * 0.6, hs * 0.2);
      ctx.quadraticCurveTo(-hs * 0.7, -hs * 0.5, 0, -hs * 0.6);
      ctx.quadraticCurveTo(hs * 0.7, -hs * 0.5, hs * 0.5, hs * 0.2);
      ctx.quadraticCurveTo(hs * 0.3, hs * 0.7, 0, hs * 0.6);
      ctx.quadraticCurveTo(-hs * 0.4, hs * 0.7, -hs * 0.6, hs * 0.2);
      ctx.fillStyle = '#7c4dff';
      ctx.fill();
      ctx.strokeStyle = '#4a148c';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hs * 0.1, -hs * 0.05, hs * 0.18, 0, Math.PI * 2);
      ctx.fillStyle = '#e8eaf6';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(hs * 0.13, -hs * 0.05, hs * 0.08, 0, Math.PI * 2);
      ctx.fillStyle = '#1a237e';
      ctx.fill();
      break;
    }
    case Race.Demon: {
      ctx.beginPath();
      ctx.arc(0, 0, hs * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = '#ff6600';
      ctx.fill();
      const flames = 6;
      for (let i = 0; i < flames; i++) {
        const a = (i / flames) * Math.PI * 2 - Math.PI / 2;
        const fx = Math.cos(a) * hs * 0.5;
        const fy = Math.sin(a) * hs * 0.5;
        const tx = Math.cos(a) * hs * 0.95;
        const ty = Math.sin(a) * hs * 0.95;
        ctx.beginPath();
        ctx.moveTo(fx - Math.sin(a) * 3, fy + Math.cos(a) * 3);
        ctx.lineTo(tx, ty);
        ctx.lineTo(fx + Math.sin(a) * 3, fy - Math.cos(a) * 3);
        ctx.fillStyle = i % 2 === 0 ? '#ff9800' : '#ffeb3b';
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(0, 0, hs * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = '#ffeb3b';
      ctx.fill();
      break;
    }
    case Race.Deep: {
      for (let i = -1; i <= 1; i++) {
        const dx = i * hs * 0.45;
        const dy = i === 0 ? -hs * 0.15 : hs * 0.15;
        ctx.beginPath();
        ctx.moveTo(dx, dy - hs * 0.4);
        ctx.quadraticCurveTo(dx + hs * 0.25, dy + hs * 0.1, dx, dy + hs * 0.35);
        ctx.quadraticCurveTo(dx - hs * 0.25, dy + hs * 0.1, dx, dy - hs * 0.4);
        ctx.fillStyle = i === 0 ? '#4fc3f7' : '#81d4fa';
        ctx.fill();
      }
      break;
    }
    case Race.Wild: {
      ctx.strokeStyle = '#ff5722';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      for (let i = -1; i <= 1; i++) {
        const dx = i * hs * 0.35;
        ctx.beginPath();
        ctx.moveTo(dx - hs * 0.2, -hs * 0.6);
        ctx.lineTo(dx + hs * 0.2, hs * 0.6);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
      break;
    }
    case Race.Geists: {
      ctx.beginPath();
      ctx.arc(0, -hs * 0.1, hs * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = '#e0e0e0';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-hs * 0.35, hs * 0.2);
      ctx.quadraticCurveTo(0, hs * 0.75, hs * 0.35, hs * 0.2);
      ctx.fillStyle = '#bdbdbd';
      ctx.fill();
      ctx.fillStyle = '#4a148c';
      ctx.beginPath();
      ctx.ellipse(-hs * 0.2, -hs * 0.15, hs * 0.14, hs * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(hs * 0.2, -hs * 0.15, hs * 0.14, hs * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-hs * 0.06, hs * 0.05);
      ctx.lineTo(hs * 0.06, hs * 0.05);
      ctx.lineTo(0, hs * 0.18);
      ctx.closePath();
      ctx.fillStyle = '#616161';
      ctx.fill();
      break;
    }
    case Race.Tenders: {
      ctx.beginPath();
      ctx.ellipse(0, hs * 0.15, hs * 0.4, hs * 0.35, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#8d6e63';
      ctx.fill();
      ctx.strokeStyle = '#5d4037';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -hs * 0.15);
      ctx.quadraticCurveTo(-hs * 0.3, -hs * 0.6, -hs * 0.15, -hs * 0.8);
      ctx.strokeStyle = '#4caf50';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-hs * 0.15, -hs * 0.7);
      ctx.quadraticCurveTo(-hs * 0.5, -hs * 0.9, -hs * 0.1, -hs * 0.55);
      ctx.fillStyle = '#66bb6a';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-hs * 0.05, -hs * 0.45);
      ctx.quadraticCurveTo(hs * 0.35, -hs * 0.7, hs * 0.05, -hs * 0.35);
      ctx.fillStyle = '#81c784';
      ctx.fill();
      break;
    }
  }

  ctx.restore();
}

// ── Ability overlay ──

export interface AbilityOverlayDeps {
  game: Game;
  camera: Camera;
  canvas: HTMLCanvasElement;
  pid: number;
  isTouchDevice: boolean;
  pointerX: number;
  pointerY: number;
  isometric?: boolean;
}

export function drawAbilityOverlay(ctx: CanvasRenderingContext2D, d: AbilityOverlayDeps): void {
  const cam = d.camera;
  const player = d.game.state.players[d.pid];
  if (!player) return;
  const def = RACE_ABILITY_DEFS[player.race];
  const cw = d.canvas.clientWidth;

  const colors: Record<Race, { fill: string; stroke: string; text: string }> = {
    [Race.Demon]:  { fill: 'rgba(255, 80, 0, 0.15)',  stroke: 'rgba(255, 120, 0, 0.7)',  text: '#ff8a65' },
    [Race.Wild]:   { fill: 'rgba(255, 100, 30, 0.12)', stroke: 'rgba(255, 150, 50, 0.6)', text: '#ffab91' },
    [Race.Geists]: { fill: 'rgba(160, 80, 220, 0.15)', stroke: 'rgba(180, 130, 255, 0.6)', text: '#ce93d8' },
    [Race.Crown]:  { fill: 'rgba(180, 120, 255, 0.15)', stroke: 'rgba(180, 120, 255, 0.6)', text: '#e1bee7' },
    [Race.Horde]:  { fill: 'rgba(180, 120, 255, 0.15)', stroke: 'rgba(180, 120, 255, 0.6)', text: '#e1bee7' },
    [Race.Goblins]: { fill: 'rgba(180, 120, 255, 0.15)', stroke: 'rgba(180, 120, 255, 0.6)', text: '#e1bee7' },
    [Race.Oozlings]: { fill: 'rgba(180, 120, 255, 0.15)', stroke: 'rgba(180, 120, 255, 0.6)', text: '#e1bee7' },
    [Race.Deep]:   { fill: 'rgba(80, 150, 220, 0.15)', stroke: 'rgba(100, 180, 255, 0.6)', text: '#81d4fa' },
    [Race.Tenders]: { fill: 'rgba(100, 180, 100, 0.15)', stroke: 'rgba(130, 200, 130, 0.6)', text: '#a5d6a7' },
  };
  const c = colors[player.race];

  if (def.aoeRadius) {
    const radiusScreen = def.aoeRadius * TILE_SIZE * cam.zoom;
    const pulse = 0.7 + 0.3 * Math.sin(Date.now() * 0.005);
    ctx.beginPath();
    if (d.isometric) {
      ctx.ellipse(d.pointerX, d.pointerY, radiusScreen, radiusScreen * 0.5, 0, 0, Math.PI * 2);
    } else {
      ctx.arc(d.pointerX, d.pointerY, radiusScreen, 0, Math.PI * 2);
    }
    ctx.fillStyle = c.fill;
    ctx.fill();
    ctx.strokeStyle = c.stroke;
    ctx.lineWidth = 2 * pulse;
    ctx.stroke();
    ctx.strokeStyle = c.stroke;
    ctx.lineWidth = 1;
    const cross = 6;
    ctx.beginPath();
    ctx.moveTo(d.pointerX - cross, d.pointerY);
    ctx.lineTo(d.pointerX + cross, d.pointerY);
    ctx.moveTo(d.pointerX, d.pointerY - cross);
    ctx.lineTo(d.pointerX, d.pointerY + cross);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.fillRect(0, 38, cw, 52);
  drawAbilityIcon(ctx, player.race, cw / 2 - 100, 50, 16);
  ctx.fillStyle = c.text;
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`CAST ${def.name.toUpperCase()}`, cw / 2, 60);
  ctx.fillStyle = '#999';
  ctx.font = '11px monospace';
  ctx.fillText(d.isTouchDevice ? 'Tap to cast' : 'Click to cast  \u2022  ESC / Right-click to cancel', cw / 2, 78);
  if (def.requiresVision) {
    ctx.fillStyle = '#ff8a65';
    ctx.font = 'italic 11px monospace';
    ctx.fillText('(requires vision)', cw / 2 + 120, 78);
  }
  ctx.textAlign = 'start';
}

// ── Nuke ──

export function isNukeLocked(state: { tick: number }): boolean {
  const NUKE_LOCKOUT_SECONDS = 60;
  return state.tick < NUKE_LOCKOUT_SECONDS * TICK_RATE;
}

export interface NukeOverlayDeps {
  game: Game;
  camera: Camera;
  canvas: HTMLCanvasElement;
  pid: number;
  isTouchDevice: boolean;
  pointerX: number;
  pointerY: number;
  tp: (tx: number, ty: number) => { px: number; py: number };
  isometric?: boolean;
}

export function drawNukeOverlay(ctx: CanvasRenderingContext2D, d: NukeOverlayDeps): void {
  const cam = d.camera;
  const team = d.game.state.players[d.pid]?.team ?? Team.Bottom;
  const mapDef = d.game.state.mapDef;

  let forbidScreenX1: number, forbidScreenY1: number, forbidScreenX2: number, forbidScreenY2: number;
  const nukeZone = mapDef.nukeZone[team];
  if (mapDef.shapeAxis === 'y') {
    const forbidMinY = nukeZone.min > 0 ? 0 : nukeZone.max;
    const forbidMaxY = nukeZone.min > 0 ? nukeZone.min : mapDef.height;
    const { px: fx1, py: fy1 } = d.tp(0, forbidMinY);
    const { px: fx2, py: fy2 } = d.tp(mapDef.width, forbidMaxY);
    forbidScreenX1 = (fx1 - cam.x) * cam.zoom;
    forbidScreenY1 = (fy1 - cam.y) * cam.zoom;
    forbidScreenX2 = (fx2 - cam.x) * cam.zoom;
    forbidScreenY2 = (fy2 - cam.y) * cam.zoom;
  } else {
    const forbidMinX = nukeZone.min > 0 ? 0 : nukeZone.max;
    const forbidMaxX = nukeZone.min > 0 ? nukeZone.min : mapDef.width;
    const { px: fx1, py: fy1 } = d.tp(forbidMinX, 0);
    const { px: fx2, py: fy2 } = d.tp(forbidMaxX, mapDef.height);
    forbidScreenX1 = (fx1 - cam.x) * cam.zoom;
    forbidScreenY1 = (fy1 - cam.y) * cam.zoom;
    forbidScreenX2 = (fx2 - cam.x) * cam.zoom;
    forbidScreenY2 = (fy2 - cam.y) * cam.zoom;
  }
  ctx.fillStyle = 'rgba(255, 0, 0, 0.15)';
  ctx.fillRect(forbidScreenX1, forbidScreenY1, forbidScreenX2 - forbidScreenX1, forbidScreenY2 - forbidScreenY1);

  ctx.strokeStyle = 'rgba(255, 50, 0, 0.6)';
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 6]);
  if (mapDef.shapeAxis === 'y') {
    const borderY = nukeZone.min > 0 ? forbidScreenY2 : forbidScreenY1;
    ctx.beginPath();
    ctx.moveTo(forbidScreenX1, borderY);
    ctx.lineTo(forbidScreenX2, borderY);
    ctx.stroke();
  } else {
    const borderX = nukeZone.min > 0 ? forbidScreenX2 : forbidScreenX1;
    ctx.beginPath();
    ctx.moveTo(borderX, forbidScreenY1);
    ctx.lineTo(borderX, forbidScreenY2);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(255, 100, 0, 0.04)';
  ctx.fillRect(0, 0, d.canvas.clientWidth, d.canvas.clientHeight);

  if (d.pointerX > 0 && d.pointerY > 0) {
    const radiusScreen = NUKE_RADIUS * TILE_SIZE * cam.zoom;
    const pulse = 0.6 + 0.4 * Math.sin(Date.now() / 300);
    ctx.beginPath();
    if (d.isometric) {
      ctx.ellipse(d.pointerX, d.pointerY, radiusScreen, radiusScreen * 0.5, 0, 0, Math.PI * 2);
    } else {
      ctx.arc(d.pointerX, d.pointerY, radiusScreen, 0, Math.PI * 2);
    }
    ctx.fillStyle = `rgba(255, 60, 0, ${0.08 * pulse})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(255, 80, 0, ${0.5 * pulse})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const cw = d.canvas.clientWidth;
  ctx.fillStyle = '#ff5722';
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(d.isTouchDevice ? 'TAP TO FIRE NUKE (own half only)' : 'CLICK TO FIRE NUKE (own half only)  [ESC to cancel]', cw / 2, 60);
  ctx.fillStyle = '#ffab40';
  ctx.font = 'bold 13px monospace';
  ctx.fillText('YOU ONLY GET 1 NUKE PER MATCH', cw / 2, 80);
  ctx.textAlign = 'start';
}

// ── Quick chat radial ──

export interface QuickChatRadialDeps {
  quickChatRadialCenter: { x: number; y: number } | null;
  pointerX: number;
  pointerY: number;
  radialSize: number;
  radialAccessibility: boolean;
  isTouchDevice: boolean;
  canvas: HTMLCanvasElement;
  getQuickChatChoiceFromPointer: () => string | null;
}

export function drawQuickChatRadial(ctx: CanvasRenderingContext2D, d: QuickChatRadialDeps): void {
  if (!d.quickChatRadialCenter) return;
  const cx = d.quickChatRadialCenter.x;
  const cy = d.quickChatRadialCenter.y;
  const selected = d.getQuickChatChoiceFromPointer();

  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, d.canvas.clientWidth, d.canvas.clientHeight);
  ctx.fillStyle = d.radialAccessibility ? 'rgba(0,0,0,0.95)' : 'rgba(10,10,10,0.9)';
  const radius = d.radialSize + (d.radialAccessibility ? 16 : 0);
  const optionOffset = radius + (d.radialAccessibility ? 34 : 22);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = d.radialAccessibility ? '#ffffff' : '#666';
  ctx.lineWidth = d.radialAccessibility ? 2 : 1;
  ctx.stroke();

  const drawOption = (x: number, y: number, label: string, active: boolean) => {
    const w = d.radialAccessibility ? 112 : 88;
    const h = d.radialAccessibility ? 30 : 24;
    ctx.fillStyle = active
      ? (d.radialAccessibility ? '#0d47a1' : 'rgba(41,121,255,0.28)')
      : (d.radialAccessibility ? '#212121' : 'rgba(40,40,40,0.8)');
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.strokeStyle = active ? '#ffffff' : (d.radialAccessibility ? '#cfd8dc' : '#555');
    ctx.strokeRect(x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = active ? '#ffffff' : (d.radialAccessibility ? '#eceff1' : '#ddd');
    ctx.font = d.radialAccessibility ? 'bold 14px monospace' : 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y + (d.radialAccessibility ? 5 : 4));
  };

  const diag = optionOffset * 0.707;
  drawOption(cx - optionOffset, cy, 'Atk Left', selected === 'Attack Left');
  drawOption(cx + optionOffset, cy, 'Atk Right', selected === 'Attack Right');
  drawOption(cx, cy - optionOffset, 'Diamond', selected === 'Get Diamond');
  drawOption(cx, cy + optionOffset, 'Defend', selected === 'Defend');
  drawOption(cx + diag, cy + diag, 'Sending', selected === 'Sending Now');
  drawOption(cx - diag, cy + diag, 'Save Us', selected === 'Save Us');
  drawOption(cx - diag, cy - diag, 'Random', selected === 'Random');
  drawOption(cx + diag, cy - diag, 'Ping', selected === 'Ping');

  ctx.beginPath();
  ctx.arc(d.pointerX, d.pointerY, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();

  ctx.fillStyle = d.radialAccessibility ? '#ffffff' : '#aaa';
  ctx.font = d.radialAccessibility ? 'bold 12px monospace' : '10px monospace';
  ctx.textAlign = 'center';
  if (d.isTouchDevice) {
    ctx.fillText('Drag & release', cx, cy + 4);
  } else {
    ctx.fillText('Hold Q, aim, release', cx, cy + 4);
  }
  ctx.textAlign = 'start';
}

// ── Quick chat feedback ──

export function quickChatFeedback(success: boolean, uiFeedbackEnabled: boolean, audioCtx: AudioContext | null): AudioContext | null {
  if (!uiFeedbackEnabled) return audioCtx;
  try {
    if (navigator.vibrate) navigator.vibrate(success ? 20 : [20, 20, 20]);
  } catch { /* ignore */ }
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = success ? 880 : 220;
    gain.gain.value = success ? 0.03 : 0.04;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    osc.start(now);
    osc.stop(now + (success ? 0.06 : 0.09));
  } catch { /* ignore */ }
  return audioCtx;
}

// ── Selected unit display ──

export interface SelectedUnitDeps {
  game: Game;
  canvas: HTMLCanvasElement;
  camera: Camera;
  ui: UIAssets;
  sprites: SpriteLoader | null;
  currentRenderer: Renderer | null;
  pid: number;
  myTeam: Team;
  selectedUnitId: number | null;
  selectedHarvesterId: number | null;
  cameraFollowing: boolean;
  followBtnRect: { x: number; y: number; w: number; h: number } | null;
  tp: (tx: number, ty: number) => { px: number; py: number };
}

export interface SelectedUnitResult {
  selectedUnitId: number | null;
  selectedHarvesterId: number | null;
  cameraFollowing: boolean;
  followBtnRect: { x: number; y: number; w: number; h: number } | null;
}

export function clearSelection(_d: SelectedUnitDeps, camera: Camera): SelectedUnitResult {
  camera.followTargetX = null;
  camera.followTargetY = null;
  return {
    selectedUnitId: null,
    selectedHarvesterId: null,
    cameraFollowing: false,
    followBtnRect: null,
  };
}

export function selectMvpUnit(d: SelectedUnitDeps): SelectedUnitResult | null {
  const state = d.game.state;
  const myTeam = d.myTeam;
  const teamUnits = state.units.filter(u => u.team === myTeam && u.kills > 0);
  if (teamUnits.length === 0) return null;

  const hq = getHQPosition(myTeam, state.mapDef);
  const hqCx = hq.x + HQ_WIDTH / 2;
  const hqCy = hq.y + HQ_HEIGHT / 2;

  teamUnits.sort((a, b) => {
    if (b.kills !== a.kills) return b.kills - a.kills;
    const distA = (a.x - hqCx) ** 2 + (a.y - hqCy) ** 2;
    const distB = (b.x - hqCx) ** 2 + (b.y - hqCy) ** 2;
    return distB - distA;
  });

  const mvp = teamUnits[0];
  const { px: mpx, py: mpy } = d.tp(mvp.x, mvp.y);
  d.camera.followTargetX = mpx;
  d.camera.followTargetY = mpy;
  d.camera.panTo(mpx, mpy);
  return {
    selectedUnitId: mvp.id,
    selectedHarvesterId: null,
    cameraFollowing: true,
    followBtnRect: d.followBtnRect,
  };
}

export function drawSelectedUnit(ctx: CanvasRenderingContext2D, renderer: Renderer, d: SelectedUnitDeps): SelectedUnitResult {
  let worldX: number | null = null;
  let worldY: number | null = null;
  let lines: string[] = [];
  let raceColor = '#fff';
  let unitShape: { race: Race; category: 'melee' | 'ranged' | 'caster'; team: Team; playerId: number; upgradeNode?: string } | null = null;
  let statusEffects: StatusEffect[] = [];
  let result: SelectedUnitResult = {
    selectedUnitId: d.selectedUnitId,
    selectedHarvesterId: d.selectedHarvesterId,
    cameraFollowing: d.cameraFollowing,
    followBtnRect: d.followBtnRect,
  };

  if (d.selectedUnitId !== null) {
    const u = d.game.state.units.find(u => u.id === d.selectedUnitId);
    if (!u) { return clearSelection(d, d.camera); }
    worldX = u.x;
    worldY = u.y;
    const player = d.game.state.players[u.playerId];
    const race = player?.race;
    raceColor = race ? (RACE_COLORS[race]?.primary ?? '#fff') : '#fff';
    const teamLabel = u.team === d.myTeam ? 'Ally' : 'Enemy';
    const bldType = `${u.category}_spawner` as BuildingType;
    const upgradeName = race ? getUpgradeNodeDef(race, bldType, u.upgradeNode)?.name : undefined;
    lines.push(upgradeName ?? u.type);
    lines.push(`${teamLabel} ${u.category}`);
    lines.push(statLineToken('health', `HP ${u.hp}/${u.maxHp}${u.shieldHp > 0 ? `  +${u.shieldHp} shield` : ''}`));
    lines.push(statLineToken('damage', `DMG ${u.damage}  SPD ${u.attackSpeed.toFixed(1)}s  RNG ${u.range}  Move ${u.moveSpeed.toFixed(1)}`));
    const research = player?.researchUpgrades;
    if (research) {
      const atkKey = `${u.category}AtkLevel` as keyof ResearchUpgradeState;
      const defKey = `${u.category}DefLevel` as keyof ResearchUpgradeState;
      const atkLvl = research[atkKey] as number;
      const defLvl = research[defKey] as number;
      if (atkLvl > 0 || defLvl > 0) {
        lines.push(`__research__:${atkLvl}:${defLvl}`);
      }
    }
    if (u.kills > 0) lines.push(`Kills: ${u.kills}`);
    statusEffects = u.statusEffects;
    if (race) unitShape = { race, category: u.category, team: u.team, playerId: u.playerId, upgradeNode: u.upgradeNode };
  } else if (d.selectedHarvesterId !== null) {
    const h = d.game.state.harvesters.find(h => h.id === d.selectedHarvesterId);
    if (!h || h.state === 'dead') { return clearSelection(d, d.camera); }
    worldX = h.x;
    worldY = h.y;
    const player = d.game.state.players[h.playerId];
    const race = player?.race;
    raceColor = race ? (RACE_COLORS[race]?.primary ?? '#fff') : '#fff';
    const assignLabel = ASSIGNMENT_LABELS[h.assignment] ?? h.assignment;
    lines.push('Miner');
    lines.push(statLineToken('health', `HP ${h.hp}/${h.maxHp}  Task ${assignLabel}`));
    lines.push(`State: ${h.state}${h.carryingDiamond ? '  Carrying diamond' : ''}${h.carryingResource ? `  Carrying ${h.carryingResource}` : ''}`);
  }

  if (worldX === null || worldY === null) { result.followBtnRect = null; return result; }

  const cam = renderer.camera;

  // Draw selection ring in world space
  ctx.save();
  cam.applyTransform(ctx);
  const { px: upx0, py: upy0 } = d.tp(worldX, worldY);
  const px = upx0 + TILE_SIZE / 2;
  const py = upy0 + TILE_SIZE / 2;
  const ringR = TILE_SIZE * 0.6;
  const iso = d.currentRenderer?.isometric ?? false;
  ctx.beginPath();
  if (iso) {
    ctx.ellipse(px, py, ringR, ringR * 0.5, 0, 0, Math.PI * 2);
  } else {
    ctx.arc(px, py, ringR, 0, Math.PI * 2);
  }
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);

  // Draw info panel at top of screen
  const lineH = 16;
  const padX = 14;
  const padY = 8;

  ctx.font = '11px monospace';
  const followLabel = d.cameraFollowing ? '[Following]' : '[Follow]';
  const followW = ctx.measureText(followLabel).width + 12;
  const followH = 18;

  const buffIconSize = 20;
  const buffIconGap = 3;
  const buffPadY = 4;

  const textH = lines.length * lineH + padY * 2;

  ctx.font = '12px monospace';
  let maxW = 0;
  for (const line of lines) {
    const lineText = displayLineText(line);
    const iconPad = line.startsWith('__stat__:') || line.startsWith('__research__:') ? 18 : 0;
    const m = ctx.measureText(lineText).width + iconPad;
    if (m > maxW) maxW = m;
  }
  const boxW = Math.max(maxW + padX * 2, followW + padX * 2 + 38);

  const buffAreaW = boxW - padX * 2;
  const iconsPerRow = Math.max(1, Math.floor((buffAreaW + buffIconGap) / (buffIconSize + buffIconGap)));
  const buffRows = statusEffects.length > 0 ? Math.ceil(statusEffects.length / iconsPerRow) : 0;
  const buffBarH = buffRows > 0 ? buffRows * (buffIconSize + buffIconGap) + buffPadY : 0;

  const boxH = textH + buffBarH + followH + 2;

  const boxX = (d.canvas.clientWidth - boxW) / 2;
  const safeY = getPopupSafeY(d.canvas.clientWidth, d.canvas.clientHeight);
  const boxY = safeY.top;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.92)';
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.strokeStyle = raceColor;
  ctx.lineWidth = 1;
  ctx.strokeRect(boxX, boxY, boxW, boxH);

  // Draw unit art in the panel
  if (unitShape && d.sprites) {
    const sprData = d.sprites.getUnitSprite(unitShape.race, unitShape.category, unitShape.playerId, false, unitShape.upgradeNode);
    if (sprData) {
      const [img, def] = sprData;
      const maxH = textH - 6;
      const maxSprW = maxH;
      const aspect = def.frameW / def.frameH;
      let drawW: number, drawH: number;
      if (aspect > 1) {
        drawW = maxSprW;
        drawH = maxSprW / aspect;
      } else {
        drawH = maxH;
        drawW = maxH * aspect;
      }
      const drawX = boxX + 20 - drawW / 2;
      const drawY = boxY + (textH - drawH) / 2;
      if (def.flipX) {
        ctx.save();
        ctx.translate(boxX + 20, 0);
        ctx.scale(-1, 1);
        ctx.translate(-(boxX + 20), 0);
      }
      drawSpriteFrame(ctx, img, def, 0, drawX, drawY, drawW, drawH);
      if (def.flipX) ctx.restore();
    } else if (d.currentRenderer) {
      d.currentRenderer.drawUnitShape(ctx, boxX + 20, boxY + textH / 2, 10, unitShape.race, unitShape.category, unitShape.team, raceColor);
    }
  }

  ctx.textAlign = 'left';
  const textStartX = boxX + 38;
  for (let i = 0; i < lines.length; i++) {
    const lineY = boxY + padY + (i + 1) * lineH - 3;
    if (lines[i].startsWith('__stat__:')) {
      const parts = lines[i].split(':');
      const key = parts[1] as StatVisualKey;
      const text = parts.slice(2).join(':');
      drawStatVisualIcon(ctx, d.ui, key, textStartX, lineY - 10, 14);
      ctx.fillStyle = '#ccc';
      ctx.font = '12px monospace';
      ctx.fillText(text, textStartX + 18, lineY);
      continue;
    }
    if (lines[i].startsWith('__research__:')) {
      const parts = lines[i].split(':');
      const atkLvl = parseInt(parts[1]);
      const defLvl = parseInt(parts[2]);
      const iconSz = 14;
      let rcx = textStartX;
      if (atkLvl > 0) {
        d.ui.drawIcon(ctx, 'sword', rcx, lineY - iconSz + 3, iconSz);
        rcx += iconSz + 2;
        ctx.fillStyle = '#ff9944';
        ctx.font = 'bold 12px monospace';
        ctx.fillText(`${atkLvl}`, rcx, lineY);
        rcx += ctx.measureText(`${atkLvl}`).width + 8;
      }
      if (defLvl > 0) {
        d.ui.drawIcon(ctx, 'shield', rcx, lineY - iconSz + 3, iconSz);
        rcx += iconSz + 2;
        ctx.fillStyle = '#44aaff';
        ctx.font = 'bold 12px monospace';
        ctx.fillText(`${defLvl}`, rcx, lineY);
      }
      continue;
    }
    if (i === 0) {
      ctx.fillStyle = raceColor;
      ctx.font = 'bold 13px monospace';
    } else {
      ctx.fillStyle = '#ccc';
      ctx.font = '12px monospace';
    }
    ctx.fillText(lines[i], textStartX, lineY);
  }

  // === Buff/debuff icon bar ===
  if (statusEffects.length > 0) {
    const buffStartY = boxY + textH + buffPadY;
    const buffStartX = boxX + padX;
    const tick = d.game.state.tick;

    for (let i = 0; i < statusEffects.length; i++) {
      const eff = statusEffects[i];
      const col = i % iconsPerRow;
      const row = Math.floor(i / iconsPerRow);
      const ix = buffStartX + col * (buffIconSize + buffIconGap);
      const iy = buffStartY + row * (buffIconSize + buffIconGap);

      const meta = BUFF_ICON_META[eff.type];
      const maxDuration = meta.maxDur * TICK_RATE;
      const durFrac = Math.min(1, eff.duration / maxDuration);

      ctx.fillStyle = meta.isDebuff ? 'rgba(80, 0, 0, 0.7)' : 'rgba(0, 50, 80, 0.7)';
      ctx.fillRect(ix, iy, buffIconSize, buffIconSize);

      ctx.globalAlpha = 1;
      drawStatVisualIcon(ctx, d.ui, meta.key, ix + 2, iy + 2, buffIconSize - 4);

      const elapsed = 1 - durFrac;
      if (elapsed > 0.01) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(ix, iy, buffIconSize, buffIconSize);
        ctx.clip();
        ctx.beginPath();
        const ccx = ix + buffIconSize / 2;
        const ccy = iy + buffIconSize / 2;
        const r = buffIconSize;
        ctx.moveTo(ccx, ccy);
        const startAngle = -Math.PI / 2;
        const endAngle = startAngle + elapsed * Math.PI * 2;
        ctx.arc(ccx, ccy, r, startAngle, endAngle);
        ctx.closePath();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fill();
        ctx.restore();
      }

      const nearExpiry = durFrac < 0.25;
      const pulse = nearExpiry ? 0.5 + 0.5 * Math.sin(tick * 0.3) : 1;
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = meta.isDebuff ? '#ff4444' : '#44aaff';
      ctx.lineWidth = 1;
      ctx.strokeRect(ix, iy, buffIconSize, buffIconSize);
      ctx.globalAlpha = 1;

      if (eff.stacks > 1) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${eff.stacks}`, ix + buffIconSize - 1, iy + buffIconSize - 2);
      }
    }
  }

  // Follow toggle button
  const fbx = boxX + boxW - followW - 6;
  const fby = boxY + boxH - followH - 4;
  result.followBtnRect = { x: fbx, y: fby, w: followW, h: followH };

  ctx.fillStyle = d.cameraFollowing ? 'rgba(80, 200, 120, 0.3)' : 'rgba(255, 255, 255, 0.1)';
  ctx.fillRect(fbx, fby, followW, followH);
  ctx.strokeStyle = d.cameraFollowing ? '#50c878' : '#888';
  ctx.lineWidth = 1;
  ctx.strokeRect(fbx, fby, followW, followH);
  ctx.fillStyle = d.cameraFollowing ? '#50c878' : '#aaa';
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(followLabel, fbx + followW / 2, fby + 13);

  ctx.textAlign = 'start';
  return result;
}

// ── Utility functions ──

export function findUnitNear(units: UnitState[], wx: number, wy: number, radius: number): UnitState | null {
  let best: UnitState | null = null;
  let bestDist = radius * radius;
  for (const u of units) {
    const dx = u.x - wx;
    const dy = u.y - wy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist) {
      bestDist = d2;
      best = u;
    }
  }
  return best;
}

export function getBuildingLabel(type: BuildingType, race?: Race, upgradePath?: string[]): string {
  return getRaceBuildingName(race, type, upgradePath);
}

export function getBuildingTooltip(
  building: { type: BuildingType; hp: number; maxHp: number; lane: Lane; upgradePath: string[]; id: number; playerId: number },
  game: Game,
  _pid: number,
  _myTeam: Team,
): string {
  const race = game.state.players[building.playerId]?.race;
  let tip = getBuildingLabel(building.type, race, building.upgradePath);
  if (building.type === BuildingType.Tower) {
    tip += `  HP: ${building.hp}/${building.maxHp}`;
  }
  if (building.type === BuildingType.HarvesterHut) {
    const h = game.state.harvesters.find(h => h.hutId === building.id);
    if (h) tip += `  [${ASSIGNMENT_LABELS[h.assignment]}]`;
  } else if (building.type !== BuildingType.Tower && building.type !== BuildingType.Research) {
    const isOozlings = race === Race.Oozlings;
    if (isOozlings) {
      tip += `  Lane: RANDOM`;
    } else {
      const isPortrait = game.state.mapDef.shapeAxis === 'y';
      const laneLabel = building.lane === Lane.Left
        ? (isPortrait ? 'LEFT' : 'TOP')
        : (isPortrait ? 'RIGHT' : 'BOT');
      tip += `  Lane: ${laneLabel}`;
    }
  }
  return tip;
}

export function getUnitTooltip(u: UnitState, game: Game, myTeam: Team): string {
  const teamLabel = u.team === myTeam ? 'Ally' : 'Enemy';
  let name = u.type;
  if (u.upgradeNode && u.upgradeNode !== 'A') {
    const race = game.state.players[u.playerId]?.race;
    if (race != null) {
      const catToBld: Record<string, BuildingType> = {
        melee: BuildingType.MeleeSpawner,
        ranged: BuildingType.RangedSpawner,
        caster: BuildingType.CasterSpawner,
      };
      const bld = catToBld[u.category];
      const tree = bld && getUpgradeNodeDef(race, bld, u.upgradeNode ?? '');
      const nodeName = tree?.name;
      if (nodeName) name = nodeName;
    }
  }
  let tip = `${name} (${teamLabel} ${u.category})  HP: ${u.hp}/${u.maxHp}`;
  if (u.shieldHp > 0) tip += ` +${u.shieldHp} shield`;
  return tip;
}
