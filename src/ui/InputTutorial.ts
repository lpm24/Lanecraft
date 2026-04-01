/**
 * InputTutorial.ts — Tutorial overlay logic extracted from InputHandler.
 *
 * Contains the help overlay (drawTutorial), guided match tutorial
 * (drawMatchTutorial, handleMatchTutorialClick, updateMatchTutorial),
 * and tutorial-gate helpers (checkTutorialTrayAdvance, checkTutorialPlaceAdvance).
 */

import { BuildingType } from '../simulation/types';
import { UIAssets } from '../rendering/UIAssets';
import { getSafeTop } from './SafeArea';
import {
  getTutorialStep, advanceTutorial, skipTutorial,
  isMatchTutorial, getMatchPopupInfo, TUTORIAL_TIMEOUT_MS,
} from './TutorialManager';

/** Mutable tutorial state owned by InputHandler, passed by reference. */
export interface TutorialState {
  showTutorial: boolean;
  hideTutorialOnStart: boolean;
  matchTutorialActive: boolean;
  tutorialStepStartTime: number;
  tutorialSkipRect: { x: number; y: number; w: number; h: number } | null;
  tutorialSkipAllRect: { x: number; y: number; w: number; h: number } | null;
  tutorialCheckboxRect: { x: number; y: number; w: number; h: number } | null;
  tutorialCloseRect: { x: number; y: number; w: number; h: number } | null;
  selectedBuilding: BuildingType | null;
}

export interface TutorialDeps {
  canvas: HTMLCanvasElement;
  ui: UIAssets;
  isTouchDevice: boolean;
  getCanvasRect: () => DOMRect;
  getTrayLayout: () => {
    milY: number; milH: number; milW: number;
    nukeRect: { x: number; y: number; w: number; h: number };
    researchRect: { x: number; y: number; w: number; h: number };
    rallyLeftRect: { x: number; y: number; w: number; h: number };
    rallyRandomRect: { x: number; y: number; w: number; h: number };
    rallyRightRect: { x: number; y: number; w: number; h: number };
  };
  getSettingsButtonRect: () => { x: number; y: number; w: number; h: number };
}

export function drawTutorial(ctx: CanvasRenderingContext2D, ts: TutorialState, deps: TutorialDeps): void {
  const W = deps.canvas.clientWidth;
  const H = deps.canvas.clientHeight;
  const compact = W < 920 || H < 760;

  // Dim background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.82)';
  ctx.fillRect(0, 0, W, H);

  const pw = Math.min(W - 12, 800);
  const ph = Math.min(H - 12, compact ? 700 : 800);
  const px = (W - pw) / 2;
  const py = (H - ph) / 2 - 20;

  // Panel background - SpecialPaper 9-slice
  if (!deps.ui.drawSpecialPaper(ctx, px, py, pw, ph)) {
    ctx.fillStyle = 'rgba(10, 12, 18, 0.97)';
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = '#2979ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(px, py, pw, ph);
  }

  // Inset past the 9-slice decorative corner borders
  const inset = Math.max(28, Math.min(pw, ph) * 0.07);
  const lp = px + inset;
  const rp = px + pw - inset;
  let y = py + inset + (compact ? 4 : 8);
  const lh = compact ? 17 : 20;
  const headingSize = compact ? 14 : 16;
  const bodySize = compact ? 12 : 14;
  const closeSize = compact ? 28 : 32;

  const maxTextW = rp - lp;
  const heading = (label: string, color = '#2979ff') => {
    ctx.fillStyle = color;
    ctx.font = `bold ${headingSize}px monospace`;
    ctx.fillText(label, lp, y);
    y += lh + (compact ? 1 : 3);
  };
  const line = (body: string, color = '#aaa') => {
    ctx.fillStyle = color;
    ctx.font = `${bodySize}px monospace`;
    // Word-wrap if text exceeds available width
    if (ctx.measureText(body).width <= maxTextW) {
      ctx.fillText(body, lp, y);
      y += lh;
    } else {
      const words = body.split(' ');
      let cur = '';
      for (const word of words) {
        const test = cur ? cur + ' ' + word : word;
        if (ctx.measureText(test).width > maxTextW && cur) {
          ctx.fillText(cur, lp, y);
          y += lh;
          cur = word;
        } else {
          cur = test;
        }
      }
      if (cur) { ctx.fillText(cur, lp, y); y += lh; }
    }
  };
  const rule = () => {
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(lp, y - 4);
    ctx.lineTo(rp, y - 4);
    ctx.stroke();
    y += compact ? 2 : 4;
  };

  const touch = deps.isTouchDevice;

  heading('LANECRAFT', '#fff');
  line('Destroy enemy HQ or bring the Diamond home to win.', '#ccc');
  y += compact ? 0 : 2;
  rule();

  heading('THE MAP');
  line('Bottom base is yours, top base is enemy.');
  line('Lanes merge, split around center, then merge again.');
  line('Gold near HQ; wood left tip; meat right tip.');
  y += compact ? 0 : 2;
  rule();

  heading('BUILD');
  if (touch) {
    line('Tap build buttons at bottom to place buildings.', '#eee');
    line('Long-press own building to sell after cooldown.', '#eee');
    line('Tap a building to open upgrades.', '#eee');
  } else {
    line('[1] miner hut, [2-5] buildings, [6] ability.', '#eee');
    line('Right-click own building to sell after cooldown.', '#eee');
    line('[U]/[I] upgrades selected or hovered building.', '#eee');
  }
  y += compact ? 0 : 2;
  rule();

  heading('COMBAT & LANES');
  line('Units auto-aggro nearby enemies and fight.');
  if (touch) {
    line('Tap a spawner to toggle its lane.', '#eee');
  } else {
    line('Click spawner toggles lane (Fast or Safe tap mode).');
    line('[L] flips all spawners; [N] arms nuke; [5] race ability.');
  }
  y += compact ? 0 : 2;
  rule();

  heading('CENTER');
  line('Mine center cells to expose the Diamond.');
  line('Carry Diamond to your HQ for instant win.');
  y += compact ? 0 : 2;
  rule();

  heading(touch ? 'CONTROLS' : 'HOTKEYS', '#ff9800');
  if (touch) {
    line('Drag to pan, pinch to zoom.');
    line('Hold map to open chat wheel.');
    line('Tap nuke/ability buttons in the HUD.');
  } else {
    line('[P/MMB] ping  [Q] chat wheel  [Z/X/C/V] quick chat');
    line('[WASD/drag] pan  [Scroll] zoom  [Esc] cancel');
    line('[L] flip all lanes  [N] arm nuke  [5] race ability');
  }
  line('Press [H] to toggle controls overlay.', '#9bb7ff');

  // "Don't show on game start" checkbox
  y += compact ? 4 : 8;
  const cbSize = compact ? 14 : 16;
  const cbX = lp;
  const cbY = y - cbSize + 2;
  ctx.strokeStyle = '#9bb7ff';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(cbX, cbY, cbSize, cbSize);
  if (ts.hideTutorialOnStart) {
    ctx.fillStyle = '#2979ff';
    ctx.fillRect(cbX + 2, cbY + 2, cbSize - 4, cbSize - 4);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${cbSize - 2}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('\u2713', cbX + cbSize / 2, cbY + cbSize - 2);
    ctx.textAlign = 'start';
  }
  ctx.fillStyle = '#aaa';
  ctx.font = `${bodySize}px monospace`;
  ctx.fillText("Don't show on game start", cbX + cbSize + 8, y);
  ts.tutorialCheckboxRect = { x: cbX, y: cbY, w: ctx.measureText("Don't show on game start").width + cbSize + 8, h: cbSize };

  const btnX = px + pw - closeSize - inset;
  const btnY = py + inset;
  // Close button -- red round button with icon_09
  deps.ui.drawSmallRedRoundButton(ctx, btnX, btnY, closeSize);
  deps.ui.drawIcon(ctx, 'close', btnX + closeSize / 2 - 10, btnY + closeSize / 2 - 10, 20);
  ts.tutorialCloseRect = { x: btnX, y: btnY, w: closeSize, h: closeSize };
}

export function handleTutorialClick(e: MouseEvent, ts: TutorialState, deps: TutorialDeps): void {
  const rect = deps.getCanvasRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;
  const cb = ts.tutorialCheckboxRect;
  if (cb && cx >= cb.x && cx <= cb.x + cb.w && cy >= cb.y && cy <= cb.y + cb.h) {
    ts.hideTutorialOnStart = !ts.hideTutorialOnStart;
    localStorage.setItem('lanecraft.hideTutorial', ts.hideTutorialOnStart ? 'true' : 'false');
    return;
  }
  const cl = ts.tutorialCloseRect;
  if (cl && cx >= cl.x && cx <= cl.x + cl.w && cy >= cl.y && cy <= cl.y + cl.h) {
    ts.showTutorial = false;
  }
}

// -- Guided match tutorial (step-by-step overlay) --

export function getMatchTutorialHighlightRect(
  _ts: TutorialState,
  deps: TutorialDeps,
): { x: number; y: number; w: number; h: number } | null {
  const info = getMatchPopupInfo();
  if (!info) return null;
  const { milY, milH, milW, nukeRect, researchRect } = deps.getTrayLayout();

  // Tray column highlight
  if (info.trayCol >= 0) {
    return { x: info.trayCol * milW, y: milY, w: milW, h: milH };
  }
  // Floating button highlight
  if (info.floatingButton === 'nuke') return nukeRect;
  if (info.floatingButton === 'research') return researchRect;
  // Settings button highlight
  if (info.arrowToSettings) {
    return deps.getSettingsButtonRect();
  }
  return null;
}

/** Per-frame tutorial state update -- handles timeout auto-advance. */
export function updateMatchTutorial(ts: TutorialState): void {
  if (!ts.matchTutorialActive) return;
  // Auto-advance after timeout so players can't get stuck
  if (performance.now() - ts.tutorialStepStartTime > TUTORIAL_TIMEOUT_MS) {
    advanceTutorial();
    ts.tutorialStepStartTime = performance.now();
    // Re-derive active state after advance
    ts.matchTutorialActive = isMatchTutorial();
  }
}

export function drawMatchTutorial(ctx: CanvasRenderingContext2D, ts: TutorialState, deps: TutorialDeps): void {
  if (!ts.matchTutorialActive) return;

  const info = getMatchPopupInfo();
  if (!info) return;

  const W = deps.canvas.clientWidth;
  const H = deps.canvas.clientHeight;
  const highlightRect = getMatchTutorialHighlightRect(ts, deps);
  const isPlacementStep = info.highlightGrid !== 'none';
  const pad = 6;

  // During placement steps (place_builder/melee/tower), skip the dark overlay
  if (!isPlacementStep) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    if (highlightRect) {
      const hx = highlightRect.x - pad;
      const hy = highlightRect.y - pad;
      const hw = highlightRect.w + pad * 2;
      const hh = highlightRect.h + pad * 2;
      if (hy > 0) ctx.fillRect(0, 0, W, hy);
      if (hy + hh < H) ctx.fillRect(0, hy + hh, W, H - (hy + hh));
      if (hx > 0) ctx.fillRect(0, hy, hx, hh);
      if (hx + hw < W) ctx.fillRect(hx + hw, hy, W - (hx + hw), hh);
      const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 400);
      ctx.strokeStyle = `rgba(100, 200, 255, ${pulse})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      (ctx as any).roundRect(hx, hy, hw, hh, 8);
      ctx.stroke();
    } else {
      ctx.fillRect(0, 0, W, H);
    }
  }

  // Popup bubble
  const bodyLines = info.body.split('\n');
  const popupW = Math.min(300, W - 40);
  const popupH = isPlacementStep
    ? 22 + bodyLines.length * 15 + 18
    : 28 + 10 + bodyLines.length * 18 + 10 + 16 + 10;
  let popupX = (W - popupW) / 2;
  let popupY: number;
  if (isPlacementStep) {
    popupY = getSafeTop() + 8;
  } else if (highlightRect && highlightRect.y > H / 2) {
    popupY = highlightRect.y - popupH - 30;
  } else if (highlightRect) {
    popupY = highlightRect.y + highlightRect.h + 20;
  } else {
    popupY = H * 0.35;
  }
  popupY = Math.max(getSafeTop() + 4, Math.min(popupY, H - popupH - 10));

  // Draw popup background
  ctx.fillStyle = 'rgba(20, 15, 10, 0.92)';
  ctx.beginPath();
  (ctx as any).roundRect(popupX, popupY, popupW, popupH, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(180, 150, 100, 0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  (ctx as any).roundRect(popupX, popupY, popupW, popupH, 10);
  ctx.stroke();

  // Arrow pointing to highlight (not during placement steps)
  if (highlightRect && !isPlacementStep) {
    const arrowX = Math.max(popupX + 20, Math.min(highlightRect.x + highlightRect.w / 2, popupX + popupW - 20));
    const arrowY = highlightRect.y > H / 2 ? popupY + popupH : popupY;
    const arrowDir = highlightRect.y > H / 2 ? 1 : -1;
    ctx.fillStyle = 'rgba(20, 15, 10, 0.92)';
    ctx.beginPath();
    ctx.moveTo(arrowX - 10, arrowY);
    ctx.lineTo(arrowX, arrowY + 12 * arrowDir);
    ctx.lineTo(arrowX + 10, arrowY);
    ctx.closePath();
    ctx.fill();
  }

  // Title + body
  const titleY = isPlacementStep ? popupY + 22 : popupY + 28;
  const bodyStartY = isPlacementStep ? popupY + 40 : popupY + 52;
  const bodyLineH = isPlacementStep ? 15 : 18;

  ctx.fillStyle = '#ffd740';
  ctx.font = isPlacementStep ? 'bold 15px monospace' : 'bold 18px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(info.title, popupX + popupW / 2, titleY);

  ctx.fillStyle = '#e0e0e0';
  ctx.font = isPlacementStep ? '12px monospace' : '14px monospace';
  const lines = info.body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], popupX + popupW / 2, bodyStartY + i * bodyLineH);
  }

  // Skip button (top-right of popup)
  const skipW = 50;
  const skipH = 22;
  const skipX = popupX + popupW - skipW - 8;
  const skipY = popupY + 6;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.beginPath();
  (ctx as any).roundRect(skipX, skipY, skipW, skipH, 4);
  ctx.fill();
  ctx.fillStyle = '#aaa';
  ctx.font = '12px monospace';
  ctx.fillText('Skip', skipX + skipW / 2, skipY + 15);
  ts.tutorialSkipRect = { x: skipX, y: skipY, w: skipW, h: skipH };

  // Skip Tutorial link (bottom of popup)
  ctx.fillStyle = '#777';
  ctx.font = '11px monospace';
  ctx.fillText('Skip Tutorial', popupX + popupW / 2, popupY + popupH - 8);
  const skipAllTextW = ctx.measureText('Skip Tutorial').width;
  ts.tutorialSkipAllRect = {
    x: popupX + popupW / 2 - skipAllTextW / 2,
    y: popupY + popupH - 20,
    w: skipAllTextW,
    h: 16,
  };

  ctx.textAlign = 'start';
}

export function handleMatchTutorialClick(
  cx: number, cy: number,
  ts: TutorialState,
  deps: TutorialDeps,
): boolean {
  if (!ts.matchTutorialActive || !isMatchTutorial()) return false;
  const step = getTutorialStep();

  // Skip button
  if (ts.tutorialSkipRect) {
    const r = ts.tutorialSkipRect;
    if (cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h) {
      advanceTutorial();
      ts.tutorialStepStartTime = performance.now();
      ts.matchTutorialActive = isMatchTutorial();
      return true;
    }
  }
  // Skip Tutorial link
  if (ts.tutorialSkipAllRect) {
    const r = ts.tutorialSkipAllRect;
    if (cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h) {
      skipTutorial();
      ts.matchTutorialActive = false;
      return true;
    }
  }

  // Info steps: any click dismisses
  if (step === 'show_research' || step === 'show_nuke' || step === 'match_done') {
    advanceTutorial();
    ts.tutorialStepStartTime = performance.now();
    ts.matchTutorialActive = isMatchTutorial();
    return true;
  }

  // For click_* steps: only allow clicking the highlighted tray button
  // For place_* steps: allow clicking the grid + tray
  const info = getMatchPopupInfo();
  if (!info) return false;

  if (info.trayCol >= 0) {
    const { milY, milH, milW } = deps.getTrayLayout();
    const colX = info.trayCol * milW;
    if (cx >= colX && cx < colX + milW && cy >= milY && cy < milY + milH) {
      return false; // Let normal tray click handler process it
    }
    return true; // Block all other clicks
  }

  if (info.highlightGrid !== 'none') {
    const { milY, milH } = deps.getTrayLayout();
    if (cy >= milY && cy < milY + milH) {
      return false; // Tray click -- allow
    }
    if (cy < milY) {
      const { nukeRect, researchRect, rallyLeftRect, rallyRandomRect, rallyRightRect } = deps.getTrayLayout();
      const inRect = (r: { x: number; y: number; w: number; h: number }) =>
        cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h;
      if (inRect(nukeRect) || inRect(researchRect) ||
          inRect(rallyLeftRect) || inRect(rallyRandomRect) || inRect(rallyRightRect)) {
        return true; // Block floating button clicks
      }
      return false; // World click -- allow for grid placement
    }
    return true; // Below tray (safe area) -- block
  }

  return true; // Block by default
}

/** Called after a tray button is successfully clicked during tutorial. */
export function checkTutorialTrayAdvance(ts: TutorialState): void {
  if (!ts.matchTutorialActive) return;
  const step = getTutorialStep();
  if (step === 'click_builder' && ts.selectedBuilding === BuildingType.HarvesterHut) {
    advanceTutorial();
    ts.tutorialStepStartTime = performance.now();
  } else if (step === 'click_melee' && ts.selectedBuilding === BuildingType.MeleeSpawner) {
    advanceTutorial();
    ts.tutorialStepStartTime = performance.now();
  } else if (step === 'click_tower' && ts.selectedBuilding === BuildingType.Tower) {
    advanceTutorial();
    ts.tutorialStepStartTime = performance.now();
  }
}

/** Called after a building is successfully placed during tutorial. */
export function checkTutorialPlaceAdvance(ts: TutorialState): void {
  if (!ts.matchTutorialActive) return;
  const step = getTutorialStep();
  if (step === 'place_builder' || step === 'place_melee' || step === 'place_tower') {
    advanceTutorial();
    ts.tutorialStepStartTime = performance.now();
    if (!isMatchTutorial()) ts.matchTutorialActive = false;
  }
}
