/**
 * RendererShapes.ts — Pure shape drawing functions and shared types/helpers
 * extracted from Renderer.ts. These have zero dependency on Renderer instance state.
 */

import { Team, Race, Lane } from '../simulation/types';
import { type StatVisualKey } from '../ui/StatBarUtils';

// ── Constants ──

export const LANE_LEFT_COLOR = '#4fc3f7';
export const LANE_RIGHT_COLOR = '#ff8a65';
export const DEAD_UNIT_LIFETIME_SEC = 0.9;

export const FLOATING_TEXT_ICON_MAP: Record<string, StatVisualKey> = {
  sword: 'damage',
  arrow: 'range',
  fire: 'burn',
  skull: 'wound',
  dodge: 'dodge',
  cleanse: 'cleanse',
  knockback: 'knockback',
  cleave: 'cleave',
  shield_icon: 'shield',
  lightning: 'haste',
  poison: 'wound',
  heart: 'healing',
  potion_blue: 'move-speed',
  potion_red: 'frenzy',
  potion_green: 'shield',
};

// ── Types ──

export type UnitCategory = 'melee' | 'ranged' | 'caster';

export interface DeadUnitSnapshot {
  id: number;
  x: number;
  y: number;
  team: Team;
  playerId: number;
  race?: Race;
  category: UnitCategory;
  upgradeNode?: string;
  upgradeTier: number;
  lane: Lane;
  faceLeft: boolean;
  wasAttacking: boolean;
  frame: number;
  ageSec: number;
}

export interface UnitRenderSnapshot {
  x: number;
  y: number;
  team: Team;
  playerId: number;
  race?: Race;
  category: UnitCategory;
  upgradeNode?: string;
  upgradeTier: number;
  lane: Lane;
  faceLeft: boolean;
  wasAttacking: boolean;
  frame: number;
}

// ── Helpers ──

/** Convert a #rrggbb hex color to an `rgba(r,g,b,` prefix string for use as `hexToRgba(c) + '0.5)'` */
export function hexToRgba(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},`;
}

export function quickChatStyle(message: string): { icon: string; color: string } {
  if (message === 'Attack Left') return { icon: '<', color: '#4fc3f7' };
  if (message === 'Attack Right') return { icon: '>', color: '#ff8a65' };
  if (message === 'Get Diamond') return { icon: 'D', color: '#ffe082' };
  if (message === 'Nuking Now!') return { icon: 'N', color: '#ff1744' };
  if (message === 'Save Us') return { icon: '!', color: '#ef5350' };
  if (message === 'Sending Now') return { icon: '>', color: '#66bb6a' };
  if (message === 'Random') return { icon: '?', color: '#ab47bc' };
  return { icon: '!', color: '#ffcc80' };
}

// ── drawUnitShape ──

/** Draw a race-themed unit shape (procedural fallback when sprites are not loaded).
 *  This is a pure function — no renderer instance state needed. */
export function drawUnitShape(
  ctx: CanvasRenderingContext2D,
  px: number, py: number, r: number,
  race: Race | undefined, category: string, team: Team, playerColor: string
): void {
  ctx.fillStyle = playerColor;

  switch (race) {
    // ─── CROWN: shield + balanced, regal ───
    case Race.Crown:
      if (category === 'melee') {
        // Shield / rounded rect
        const rr = r * 0.3;
        ctx.beginPath();
        ctx.moveTo(px - r + rr, py - r);
        ctx.lineTo(px + r - rr, py - r);
        ctx.quadraticCurveTo(px + r, py - r, px + r, py - r + rr);
        ctx.lineTo(px + r, py + r * 0.5);
        ctx.lineTo(px, py + r);
        ctx.lineTo(px - r, py + r * 0.5);
        ctx.lineTo(px - r, py - r + rr);
        ctx.quadraticCurveTo(px - r, py - r, px - r + rr, py - r);
        ctx.closePath();
        ctx.fill();
      } else if (category === 'ranged') {
        // Chevron/arrow pointing in move direction
        const dir = team === Team.Bottom ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(px - r, py + r * 0.5 * dir);
        ctx.lineTo(px, py - r * dir);
        ctx.lineTo(px + r, py + r * 0.5 * dir);
        ctx.lineTo(px + r * 0.5, py + r * 0.5 * dir);
        ctx.lineTo(px, py - r * 0.3 * dir);
        ctx.lineTo(px - r * 0.5, py + r * 0.5 * dir);
        ctx.closePath();
        ctx.fill();
      } else {
        // 4-pointed star (holy)
        ctx.beginPath();
        const inner = r * 0.35;
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI / 4) - Math.PI / 2;
          const rad = i % 2 === 0 ? r : inner;
          const sx = px + Math.cos(a) * rad;
          const sy = py + Math.sin(a) * rad;
          if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        }
        ctx.closePath();
        ctx.fill();
      }
      break;

    // ─── HORDE: heavy, brutish ───
    case Race.Horde:
      if (category === 'melee') {
        // Cross/plus (heavy)
        const arm = r * 0.4;
        ctx.beginPath();
        ctx.moveTo(px - arm, py - r);
        ctx.lineTo(px + arm, py - r);
        ctx.lineTo(px + arm, py - arm);
        ctx.lineTo(px + r, py - arm);
        ctx.lineTo(px + r, py + arm);
        ctx.lineTo(px + arm, py + arm);
        ctx.lineTo(px + arm, py + r);
        ctx.lineTo(px - arm, py + r);
        ctx.lineTo(px - arm, py + arm);
        ctx.lineTo(px - r, py + arm);
        ctx.lineTo(px - r, py - arm);
        ctx.lineTo(px - arm, py - arm);
        ctx.closePath();
        ctx.fill();
      } else if (category === 'ranged') {
        // Hexagon
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI / 3) - Math.PI / 6;
          const sx = px + Math.cos(a) * r;
          const sy = py + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        }
        ctx.closePath();
        ctx.fill();
      } else {
        // Crystal: tall narrow diamond
        ctx.beginPath();
        ctx.moveTo(px, py - r * 1.1);
        ctx.lineTo(px + r * 0.5, py);
        ctx.lineTo(px, py + r * 1.1);
        ctx.lineTo(px - r * 0.5, py);
        ctx.closePath();
        ctx.fill();
      }
      break;

    // ─── GOBLINS: fast, pointy ───
    case Race.Goblins:
      if (category === 'melee') {
        // Narrow dagger
        ctx.beginPath();
        ctx.moveTo(px, py - r);
        ctx.lineTo(px + r * 0.4, py + r * 0.3);
        ctx.lineTo(px + r * 0.2, py + r);
        ctx.lineTo(px - r * 0.2, py + r);
        ctx.lineTo(px - r * 0.4, py + r * 0.3);
        ctx.closePath();
        ctx.fill();
      } else if (category === 'ranged') {
        // Narrow kite
        ctx.beginPath();
        ctx.moveTo(px, py - r * 1.2);
        ctx.lineTo(px + r * 0.5, py);
        ctx.lineTo(px, py + r * 0.6);
        ctx.lineTo(px - r * 0.5, py);
        ctx.closePath();
        ctx.fill();
      } else {
        // Hexing eye
        ctx.beginPath();
        ctx.moveTo(px - r, py);
        ctx.quadraticCurveTo(px, py - r * 1.1, px + r, py);
        ctx.quadraticCurveTo(px, py + r * 1.1, px - r, py);
        ctx.closePath();
        ctx.fill();
      }
      break;

    // ─── OOZLINGS: blobby, round ───
    case Race.Oozlings:
      if (category === 'melee') {
        // Small circle blob
        ctx.beginPath();
        ctx.arc(px, py, r * 0.8, 0, Math.PI * 2);
        ctx.fill();
      } else if (category === 'ranged') {
        // Spore: 3-lobed trefoil
        for (let i = 0; i < 3; i++) {
          const a = (i * Math.PI * 2 / 3) - Math.PI / 2;
          ctx.beginPath();
          ctx.arc(px + Math.cos(a) * r * 0.35, py + Math.sin(a) * r * 0.35, r * 0.45, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // Wave/pulse ring
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0a0a0a';
        ctx.beginPath();
        ctx.arc(px, py, r * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;

    // ─── DEMON: sharp, aggressive ───
    case Race.Demon:
      if (category === 'melee') {
        // Flame: triangle with notch
        ctx.beginPath();
        ctx.moveTo(px, py - r);
        ctx.lineTo(px + r, py + r);
        ctx.lineTo(px + r * 0.2, py + r * 0.3);
        ctx.lineTo(px, py + r * 0.7);
        ctx.lineTo(px - r * 0.2, py + r * 0.3);
        ctx.lineTo(px - r, py + r);
        ctx.closePath();
        ctx.fill();
      } else if (category === 'ranged') {
        // Narrow kite (firebolt)
        ctx.beginPath();
        ctx.moveTo(px, py - r * 1.2);
        ctx.lineTo(px + r * 0.5, py);
        ctx.lineTo(px, py + r * 0.6);
        ctx.lineTo(px - r * 0.5, py);
        ctx.closePath();
        ctx.fill();
      } else {
        // Sunburst: small circle + 6 rays
        ctx.beginPath();
        ctx.arc(px, py, r * 0.4, 0, Math.PI * 2);
        ctx.fill();
        for (let i = 0; i < 6; i++) {
          const a = i * Math.PI / 3;
          ctx.beginPath();
          ctx.moveTo(px + Math.cos(a - 0.2) * r * 0.35, py + Math.sin(a - 0.2) * r * 0.35);
          ctx.lineTo(px + Math.cos(a) * r, py + Math.sin(a) * r);
          ctx.lineTo(px + Math.cos(a + 0.2) * r * 0.35, py + Math.sin(a + 0.2) * r * 0.35);
          ctx.fill();
        }
      }
      break;

    // ─── DEEP: rounded, control ───
    case Race.Deep:
      if (category === 'melee') {
        // Shell: rounded shield
        ctx.beginPath();
        ctx.arc(px, py - r * 0.1, r, Math.PI, 0);
        ctx.lineTo(px + r * 0.5, py + r);
        ctx.lineTo(px - r * 0.5, py + r);
        ctx.closePath();
        ctx.fill();
      } else if (category === 'ranged') {
        // Circle (bubble)
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Wave/crescent
        ctx.beginPath();
        ctx.arc(px, py, r, 0.3 * Math.PI, 1.7 * Math.PI);
        ctx.arc(px + r * 0.3, py, r * 0.7, 1.7 * Math.PI, 0.3 * Math.PI, true);
        ctx.closePath();
        ctx.fill();
      }
      break;

    // ─── WILD: organic, spiky ───
    case Race.Wild:
      if (category === 'melee') {
        // Thorny pentagon with spikes
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = (i * Math.PI * 2 / 5) - Math.PI / 2;
          const outerR = r * 1.1;
          const midA = a + Math.PI / 5;
          const innerR = r * 0.55;
          const sx = px + Math.cos(a) * outerR;
          const sy = py + Math.sin(a) * outerR;
          const mx = px + Math.cos(midA) * innerR;
          const my = py + Math.sin(midA) * innerR;
          if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
          ctx.lineTo(mx, my);
        }
        ctx.closePath();
        ctx.fill();
      } else if (category === 'ranged') {
        // Spore: 3-lobed trefoil
        for (let i = 0; i < 3; i++) {
          const a = (i * Math.PI * 2 / 3) - Math.PI / 2;
          ctx.beginPath();
          ctx.arc(px + Math.cos(a) * r * 0.4, py + Math.sin(a) * r * 0.4, r * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // Root: Y-shape / trident
        const armW = r * 0.25;
        ctx.beginPath();
        ctx.moveTo(px - armW, py + r);
        ctx.lineTo(px - armW, py);
        ctx.lineTo(px - r, py - r * 0.8);
        ctx.lineTo(px - r * 0.5, py - r);
        ctx.lineTo(px, py - r * 0.3);
        ctx.lineTo(px + r * 0.5, py - r);
        ctx.lineTo(px + r, py - r * 0.8);
        ctx.lineTo(px + armW, py);
        ctx.lineTo(px + armW, py + r);
        ctx.closePath();
        ctx.fill();
      }
      break;

    // ─── GEISTS: wispy, sinister ───
    case Race.Geists:
      if (category === 'melee') {
        // Curved dagger / fang shape
        ctx.beginPath();
        ctx.moveTo(px, py - r);
        ctx.quadraticCurveTo(px + r * 1.2, py - r * 0.2, px + r * 0.3, py + r);
        ctx.lineTo(px, py + r * 0.4);
        ctx.lineTo(px - r * 0.3, py + r);
        ctx.quadraticCurveTo(px - r * 1.2, py - r * 0.2, px, py - r);
        ctx.closePath();
        ctx.fill();
      } else if (category === 'ranged') {
        // Eye/slit shape
        ctx.beginPath();
        ctx.moveTo(px - r, py);
        ctx.quadraticCurveTo(px, py - r * 1.1, px + r, py);
        ctx.quadraticCurveTo(px, py + r * 1.1, px - r, py);
        ctx.closePath();
        ctx.fill();
      } else {
        // Void portal: ring with gap
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0a0a0a';
        ctx.beginPath();
        ctx.arc(px, py, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = playerColor;
        ctx.beginPath();
        ctx.arc(px, py, r * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;

    // ─── TENDERS: organic, gentle ───
    case Race.Tenders:
      if (category === 'melee') {
        // Treant: wide rounded
        ctx.beginPath();
        ctx.arc(px, py - r * 0.2, r * 0.7, Math.PI, 0);
        ctx.lineTo(px + r, py + r);
        ctx.lineTo(px - r, py + r);
        ctx.closePath();
        ctx.fill();
      } else if (category === 'ranged') {
        // Seed/teardrop
        ctx.beginPath();
        ctx.moveTo(px, py - r);
        ctx.quadraticCurveTo(px + r, py, px, py + r);
        ctx.quadraticCurveTo(px - r, py, px, py - r);
        ctx.closePath();
        ctx.fill();
      } else {
        // Flower: circle + 4 petals
        ctx.beginPath();
        ctx.arc(px, py, r * 0.35, 0, Math.PI * 2);
        ctx.fill();
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI / 2) - Math.PI / 4;
          ctx.beginPath();
          ctx.arc(px + Math.cos(a) * r * 0.5, py + Math.sin(a) * r * 0.5, r * 0.35, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;

    // ─── FALLBACK: original shapes ───
    default:
      if (category === 'melee') {
        ctx.fillRect(px - r, py - r, r * 2, r * 2);
      } else if (category === 'ranged') {
        const dir = team === Team.Bottom ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(px, py - r * dir);
        ctx.lineTo(px + r, py + r * dir);
        ctx.lineTo(px - r, py + r * dir);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(px, py - r);
        ctx.lineTo(px + r * 0.7, py);
        ctx.lineTo(px, py + r);
        ctx.lineTo(px - r * 0.7, py);
        ctx.closePath();
        ctx.fill();
      }
      break;
  }
}
