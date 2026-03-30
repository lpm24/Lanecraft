import { Scene, SceneManager } from './Scene';
import { UIAssets } from '../rendering/UIAssets';
import { BotDifficultyLevel } from '../simulation/BotAI';
import { type MapDef } from '../simulation/types';
import { DUEL_MAP, SKIRMISH_MAP, WARZONE_MAP } from '../simulation/maps';
import { SoundManager } from '../audio/SoundManager';
import { getSafeTop } from '../ui/SafeArea';

interface DifficultyOption {
  level: BotDifficultyLevel;
  label: string;
  color: string;
  desc: string;
}

interface ModeOption {
  label: string;
  color: string;
  map: MapDef;
  teamSize: number;
}

const DIFFICULTIES: DifficultyOption[] = [
  { level: BotDifficultyLevel.Easy, label: 'EASY', color: '#4caf50', desc: 'Bots expand slowly and rarely punish' },
  { level: BotDifficultyLevel.Medium, label: 'MEDIUM', color: '#ffd740', desc: 'Balanced challenge, room to recover' },
  { level: BotDifficultyLevel.Hard, label: 'HARD', color: '#ff9100', desc: 'Fast pressure, punishes weak play' },
  { level: BotDifficultyLevel.Nightmare, label: 'NIGHTMARE', color: '#ff1744', desc: 'Optimized builds, ruthless timing' },
];

const MODE_OPTIONS: ModeOption[] = [
  { label: '1v1', color: '#66d9ef', map: DUEL_MAP, teamSize: 1 },
  { label: '2v2', color: '#ffd740', map: DUEL_MAP, teamSize: 2 },
  { label: '3v3', color: '#a6e22e', map: SKIRMISH_MAP, teamSize: 3 },
  { label: '4v4', color: '#ff6e40', map: WARZONE_MAP, teamSize: 4 },
];

const LAST_DIFFICULTY_KEY = 'lanecraft.lastDifficulty';
const LAST_MODE_KEY = 'lanecraft.lastMode';
const LAST_FOG_KEY = 'lanecraft.lastFogOfWar';
const LAST_ISO_KEY = 'lanecraft.lastIsometric';

function shadowText(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number,
  color = '#fff', shadowColor = 'rgba(0,0,0,0.6)',
) {
  ctx.fillStyle = shadowColor;
  ctx.fillText(text, x + 1, y + 1);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

export class DifficultySelectScene implements Scene {
  private manager: SceneManager;
  private canvas: HTMLCanvasElement;
  private ui: UIAssets;
  private onConfirm: (level: BotDifficultyLevel, mapDef: MapDef, teamSize: number, fogOfWar: boolean, isometric: boolean) => void;
  private selectedIndex = 1;
  private hoverIndex = -1;
  private modeIndex = 0;
  private modeHoverIndex = -1;
  private fogOfWar = true;
  private fogHover = false;
  private isometric = false;
  private isoHover = false;
  private sfx = new SoundManager();
  private tick = 0;
  private sceneAge = 0;

  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private moveHandler: ((e: MouseEvent) => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private touchHandler: ((e: TouchEvent) => void) | null = null;

  constructor(manager: SceneManager, canvas: HTMLCanvasElement, ui: UIAssets, onConfirm: (level: BotDifficultyLevel, mapDef: MapDef, teamSize: number, fogOfWar: boolean, isometric: boolean) => void) {
    this.manager = manager;
    this.canvas = canvas;
    this.ui = ui;
    this.onConfirm = onConfirm;
  }

  enter(): void {
    this.hoverIndex = -1;
    this.modeHoverIndex = -1;
    this.sfx.enableTabSuspend();
    this.loadSelections();

    this.keyHandler = (e) => {
      if (e.key === 'ArrowUp' || e.key === 'w') {
        this.selectedIndex = Math.max(0, this.selectedIndex - 1);
        this.sfx.playUIClick();
        this.saveSelections();
      }
      if (e.key === 'ArrowDown' || e.key === 's') {
        this.selectedIndex = Math.min(DIFFICULTIES.length - 1, this.selectedIndex + 1);
        this.sfx.playUIClick();
        this.saveSelections();
      }
      if (e.key === 'Tab' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const delta = e.key === 'ArrowLeft' ? -1 : 1;
        const maxMode = this.isometric ? 2 : MODE_OPTIONS.length; // iso: only 1v1, 2v2
        this.modeIndex = (this.modeIndex + delta + maxMode) % maxMode;
        this.sfx.playUIClick();
        this.saveSelections();
      }
      if (e.key === 'f') {
        this.fogOfWar = !this.fogOfWar;
        this.sfx.playUIToggle();
        this.saveSelections();
      }
      if (e.key === 'i') {
        this.toggleIsometric();
        this.sfx.playUIToggle();
        this.saveSelections();
      }
      if (e.key === 'Enter' || e.key === ' ') {
        this.sfx.playUIConfirm();
        this.confirmSelection();
      }
      if (e.key === 'Escape') { this.sfx.playUIBack(); this.manager.switchTo('raceSelect'); }
    };

    let lastTouchTime = 0;
    this.clickHandler = (e) => {
      if (Date.now() - lastTouchTime < 300) return;
      const [cx, cy] = this.toCanvas(e.clientX, e.clientY);
      if (this.isBackButtonAt(cx, cy)) { this.sfx.playUIBack(); this.manager.switchTo('raceSelect'); return; }
      if (this.isFogToggleAt(cx, cy)) {
        this.fogOfWar = !this.fogOfWar;
        this.sfx.playUIToggle();
        this.saveSelections();
        return;
      }
      if (this.isIsoToggleAt(cx, cy)) {
        this.toggleIsometric();
        this.sfx.playUIToggle();
        this.saveSelections();
        return;
      }
      const modeIdx = this.getModeButtonIndexAt(cx, cy);
      if (modeIdx >= 0) {
        if (this.isometric && modeIdx > 1) return; // disabled in iso mode
        this.modeIndex = modeIdx;
        this.sfx.playUIClick();
        this.saveSelections();
        return;
      }
      const idx = this.getCardIndexAt(cx, cy);
      if (idx >= 0) {
        this.selectedIndex = idx;
        this.sfx.playUIClick();
        this.saveSelections();
        return;
      }
      if (this.isStartButtonAt(cx, cy)) {
        this.sfx.playUIConfirm();
        this.confirmSelection();
      }
    };

    this.moveHandler = (e) => {
      const [cx, cy] = this.toCanvas(e.clientX, e.clientY);
      this.hoverIndex = this.getCardIndexAt(cx, cy);
      this.modeHoverIndex = this.getModeButtonIndexAt(cx, cy);
      this.fogHover = this.isFogToggleAt(cx, cy);
      this.isoHover = this.isIsoToggleAt(cx, cy);
    };

    this.touchHandler = (e) => {
      e.preventDefault();
      lastTouchTime = Date.now();
      const touch = e.touches[0];
      if (!touch) return;
      const [cx, cy] = this.toCanvas(touch.clientX, touch.clientY);
      if (this.isBackButtonAt(cx, cy)) { this.sfx.playUIBack(); this.manager.switchTo('raceSelect'); return; }
      if (this.isFogToggleAt(cx, cy)) {
        this.fogOfWar = !this.fogOfWar;
        this.sfx.playUIToggle();
        this.saveSelections();
        return;
      }
      if (this.isIsoToggleAt(cx, cy)) {
        this.toggleIsometric();
        this.sfx.playUIToggle();
        this.saveSelections();
        return;
      }
      const modeIdx = this.getModeButtonIndexAt(cx, cy);
      if (modeIdx >= 0) {
        if (this.isometric && modeIdx > 1) return;
        this.modeIndex = modeIdx;
        this.sfx.playUIClick();
        this.saveSelections();
        return;
      }
      const idx = this.getCardIndexAt(cx, cy);
      if (idx >= 0) {
        this.selectedIndex = idx;
        this.sfx.playUIClick();
        this.saveSelections();
        return;
      }
      if (this.isStartButtonAt(cx, cy)) {
        this.sfx.playUIConfirm();
        this.confirmSelection();
      }
    };

    window.addEventListener('keydown', this.keyHandler);
    this.canvas.addEventListener('click', this.clickHandler);
    this.canvas.addEventListener('mousemove', this.moveHandler);
    this.canvas.addEventListener('touchstart', this.touchHandler, { passive: false });
  }

  exit(): void {
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    if (this.clickHandler) this.canvas.removeEventListener('click', this.clickHandler);
    if (this.moveHandler) this.canvas.removeEventListener('mousemove', this.moveHandler);
    if (this.touchHandler) this.canvas.removeEventListener('touchstart', this.touchHandler);
    this.keyHandler = null;
    this.clickHandler = null;
    this.moveHandler = null;
    this.touchHandler = null;
    this.sfx.dispose();
  }

  update(_dt: number): void { this.tick++; this.sceneAge += _dt; }

  private toCanvas(clientX: number, clientY: number): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [clientX - rect.left, clientY - rect.top];
  }

  private loadSelections(): void {
    try {
      const savedDifficulty = localStorage.getItem(LAST_DIFFICULTY_KEY) as BotDifficultyLevel | null;
      const diffIndex = DIFFICULTIES.findIndex((diff) => diff.level === savedDifficulty);
      if (diffIndex >= 0) this.selectedIndex = diffIndex;

      const savedMode = localStorage.getItem(LAST_MODE_KEY);
      const savedModeIndex = MODE_OPTIONS.findIndex((opt) => opt.label === savedMode);
      if (savedModeIndex >= 0) this.modeIndex = savedModeIndex;

      const savedFog = localStorage.getItem(LAST_FOG_KEY);
      this.fogOfWar = savedFog === null ? true : savedFog === 'true';

      const savedIso = localStorage.getItem(LAST_ISO_KEY);
      this.isometric = savedIso === 'true';
      // Clamp mode if iso was saved with 3v3/4v4
      if (this.isometric && this.modeIndex > 1) this.modeIndex = 1;
    } catch {}
  }

  private saveSelections(): void {
    try {
      localStorage.setItem(LAST_DIFFICULTY_KEY, DIFFICULTIES[this.selectedIndex].level);
      localStorage.setItem(LAST_MODE_KEY, MODE_OPTIONS[this.modeIndex].label);
      localStorage.setItem(LAST_FOG_KEY, String(this.fogOfWar));
      localStorage.setItem(LAST_ISO_KEY, String(this.isometric));
    } catch {}
  }

  private toggleIsometric(): void {
    this.isometric = !this.isometric;
    // Isometric only supports 1v1 and 2v2
    if (this.isometric && this.modeIndex > 1) {
      this.modeIndex = 1; // fall back to 2v2
    }
  }

  private confirmSelection(): void {
    this.saveSelections();
    const mode = MODE_OPTIONS[this.modeIndex];
    this.onConfirm(DIFFICULTIES[this.selectedIndex].level, mode.map, mode.teamSize, this.fogOfWar, this.isometric);
  }

  // --- Mode buttons layout ---

  private getModeButtonLayout(): { x: number; y: number; w: number; h: number }[] {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const compact = this.compact;
    const totalW = Math.min(w * 0.9, 420);
    const gap = compact ? 6 : 10;
    const btnW = (totalW - gap * (MODE_OPTIONS.length - 1)) / MODE_OPTIONS.length;
    const btnH = compact ? 40 : 44;
    const startX = (w - totalW) / 2;

    // Position halfway between ribbon bottom and difficulty cards top
    const ribbonBottom = (compact ? 48 : 58) + 8 + getSafeTop();
    const cardH = compact ? 44 : 48;
    const cardGap = compact ? 4 : 8;
    const totalCardsH = DIFFICULTIES.length * cardH + (DIFFICULTIES.length - 1) * cardGap;
    const btnSpace = compact ? 56 : 80;
    const cardsTop = ribbonBottom + btnH + (compact ? 8 : 14) + Math.max(0, (h - ribbonBottom - btnH - (compact ? 8 : 14) - btnSpace - totalCardsH) / 2);
    const startY = ribbonBottom + (cardsTop - ribbonBottom - btnH) / 2;

    return MODE_OPTIONS.map((_, i) => ({
      x: startX + i * (btnW + gap),
      y: startY,
      w: btnW,
      h: btnH,
    }));
  }

  private getModeButtonIndexAt(cx: number, cy: number): number {
    const btns = this.getModeButtonLayout();
    const pad = 8;
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i];
      if (cx >= b.x - pad && cx <= b.x + b.w + pad && cy >= b.y - pad && cy <= b.y + b.h + pad) return i;
    }
    return -1;
  }

  // --- Difficulty card layout ---

  private getCardLayout(): { x: number; y: number; w: number; h: number }[] {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const compact = this.compact;
    const cardW = Math.min(w * 0.9, 420);
    const gap = compact ? 4 : 8;
    const modeBtns = this.getModeButtonLayout();
    const modeBottom = modeBtns[0].y + modeBtns[0].h;
    const topMargin = modeBottom + (compact ? 8 : 14);
    const cardH = compact ? 44 : 48;
    const fogH = compact ? 30 : 36;
    const totalH = DIFFICULTIES.length * cardH + (DIFFICULTIES.length - 1) * gap + gap + fogH;
    const btnSpace = compact ? 56 : 80;
    const startY = topMargin + Math.max(0, (h - topMargin - btnSpace - totalH) / 2);
    const startX = (w - cardW) / 2;

    return DIFFICULTIES.map((_, i) => ({
      x: startX,
      y: startY + i * (cardH + gap),
      w: cardW,
      h: cardH,
    }));
  }

  private get compact(): boolean { return this.canvas.clientHeight < 560; }

  private getCardIndexAt(cx: number, cy: number): number {
    const cards = this.getCardLayout();
    const pad = 6;
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      if (cx >= c.x - pad && cx <= c.x + c.w + pad && cy >= c.y - pad && cy <= c.y + c.h + pad) return i;
    }
    return -1;
  }

  private getButtonRow(): { backX: number; startX: number; btnW: number; btnH: number; btnY: number } {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const compact = this.compact;
    const btnGap = 10;
    const totalBtnW = Math.min(w * 0.9, 440);
    const btnW = (totalBtnW - btnGap) / 2;
    const rowX = (w - totalBtnW) / 2;
    const btnH = compact ? 48 : 56;
    const btnY = h - (compact ? 58 : 72);
    return { backX: rowX, startX: rowX + btnW + btnGap, btnW, btnH, btnY };
  }

  private isStartButtonAt(cx: number, cy: number): boolean {
    const { startX, btnW, btnH, btnY } = this.getButtonRow();
    const pad = 8;
    return cx >= startX - pad && cx <= startX + btnW + pad && cy >= btnY - pad && cy <= btnY + btnH + pad;
  }

  private isBackButtonAt(cx: number, cy: number): boolean {
    const { backX, btnW, btnH, btnY } = this.getButtonRow();
    const pad = 8;
    return cx >= backX - pad && cx <= backX + btnW + pad && cy >= btnY - pad && cy <= btnY + btnH + pad;
  }

  private getFogToggleLayout(): { x: number; y: number; w: number; h: number } {
    const cards = this.getCardLayout();
    const lastCard = cards[cards.length - 1];
    const compact = this.compact;
    const toggleH = compact ? 30 : 36;
    const gap = compact ? 4 : 6;
    const totalTogglesH = toggleH * 2 + gap;
    const toggleW = Math.min(this.canvas.clientWidth * 0.9, 420);
    const cardBottom = lastCard.y + lastCard.h;
    const { btnY } = this.getButtonRow();
    // Center both toggles vertically between last card and button row
    const startY = cardBottom + (btnY - cardBottom - totalTogglesH) / 2;
    return {
      x: (this.canvas.clientWidth - toggleW) / 2,
      y: startY,
      w: toggleW,
      h: toggleH,
    };
  }

  private getIsoToggleLayout(): { x: number; y: number; w: number; h: number } {
    const fog = this.getFogToggleLayout();
    const compact = this.compact;
    const gap = compact ? 4 : 6;
    return {
      x: fog.x,
      y: fog.y + fog.h + gap,
      w: fog.w,
      h: fog.h,
    };
  }

  private isFogToggleAt(cx: number, cy: number): boolean {
    const t = this.getFogToggleLayout();
    const pad = 4;
    return cx >= t.x - pad && cx <= t.x + t.w + pad && cy >= t.y - pad && cy <= t.y + t.h + pad;
  }

  private isIsoToggleAt(cx: number, cy: number): boolean {
    const t = this.getIsoToggleLayout();
    const pad = 4;
    return cx >= t.x - pad && cx <= t.x + t.w + pad && cy >= t.y - pad && cy <= t.y + t.h + pad;
  }

  private drawToggleRow(ctx: CanvasRenderingContext2D, layout: { x: number; y: number; w: number; h: number }, checked: boolean, hovered: boolean, color: string, label: string, desc: string): void {
    const compact = this.compact;
    const bgPadX = Math.round(layout.w * 0.075);
    const bgPadY = Math.round(layout.h * 0.06);
    this.ui.drawWoodTable(ctx, layout.x - bgPadX, layout.y - bgPadY, layout.w + bgPadX * 2, layout.h + bgPadY * 2);

    if (hovered) {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(layout.x + 1, layout.y + 1, layout.w - 2, layout.h - 2);
    }

    const padX = compact ? 10 : 14;
    const labelSize = compact ? 13 : 16;
    ctx.font = `bold ${labelSize}px monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const cbSize = compact ? 14 : 18;
    const cbX = layout.x + padX;
    const cbY = layout.y + (layout.h - cbSize) / 2;
    ctx.strokeStyle = checked ? color : 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 2;
    ctx.strokeRect(cbX, cbY, cbSize, cbSize);
    if (checked) {
      ctx.fillStyle = color;
      ctx.fillRect(cbX + 3, cbY + 3, cbSize - 6, cbSize - 6);
    }

    shadowText(ctx, label, cbX + cbSize + 8, layout.y + layout.h / 2,
      checked ? color : 'rgba(255,255,255,0.7)', 'rgba(0,0,0,0.7)');

    const descSize = Math.max(11, labelSize * 0.7);
    ctx.font = `bold ${labelSize}px monospace`;
    const boldLabelW = ctx.measureText(label).width;
    ctx.font = `${descSize}px monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(desc, cbX + cbSize + 8 + boldLabelW + 12, layout.y + layout.h / 2);
  }

  render(ctx: CanvasRenderingContext2D): void {
    const w = ctx.canvas.clientWidth;
    const h = ctx.canvas.clientHeight;
    ctx.imageSmoothingEnabled = false;

    if (!this.ui.drawWaterBg(ctx, w, h, this.tick * 50)) {
      ctx.fillStyle = '#2a5a6a';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, w, h);

    const ribbonW = Math.min(w * 0.7, 500);
    const ribbonH = Math.min(52, h * 0.07);
    const ribbonX = (w - ribbonW) / 2;
    const ribbonY = 8 + getSafeTop();
    this.ui.drawBigRibbon(ctx, ribbonX, ribbonY, ribbonW, ribbonH, 0);

    const titleSize = Math.max(13, Math.min(ribbonH * 0.4, 20));
    ctx.font = `bold ${titleSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText('GAME SETTINGS', w / 2, ribbonY + ribbonH * 0.58);

    // --- Mode buttons ---
    const modeBtns = this.getModeButtonLayout();
    for (let i = 0; i < MODE_OPTIONS.length; i++) {
      const mode = MODE_OPTIONS[i];
      const btn = modeBtns[i];
      const isSelected = i === this.modeIndex;
      const isHover = i === this.modeHoverIndex;
      const isDisabled = this.isometric && i > 1; // 3v3/4v4 disabled in iso

      const bgPadX = Math.round(btn.w * 0.06);
      const bgPadY = Math.round(btn.h * 0.06);
      if (isDisabled) ctx.globalAlpha = 0.35;
      this.ui.drawWoodTable(ctx, btn.x - bgPadX, btn.y - bgPadY, btn.w + bgPadX * 2, btn.h + bgPadY * 2);

      if (isSelected && !isDisabled) {
        ctx.strokeStyle = mode.color;
        ctx.shadowColor = mode.color;
        ctx.shadowBlur = 12;
        ctx.lineWidth = 3;
        ctx.strokeRect(btn.x + 1, btn.y + 1, btn.w - 2, btn.h - 2);
        ctx.shadowBlur = 0;
      } else if (isHover && !isDisabled) {
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(btn.x + 1, btn.y + 1, btn.w - 2, btn.h - 2);
      }

      const labelSize = this.compact ? 14 : 18;
      ctx.font = `bold ${labelSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      shadowText(ctx, mode.label, btn.x + btn.w / 2, btn.y + btn.h / 2, isSelected && !isDisabled ? mode.color : 'rgba(255,255,255,0.7)', 'rgba(0,0,0,0.7)');
      if (isDisabled) ctx.globalAlpha = 1;
    }

    // --- Difficulty cards (1-line each) ---
    const cards = this.getCardLayout();
    for (let i = 0; i < DIFFICULTIES.length; i++) {
      const diff = DIFFICULTIES[i];
      const card = cards[i];
      const isSelected = i === this.selectedIndex;
      const isHover = i === this.hoverIndex;

      const bgPadX = Math.round(card.w * 0.075);
      const bgPadY = Math.round(card.h * 0.06);
      this.ui.drawWoodTable(ctx, card.x - bgPadX, card.y - bgPadY, card.w + bgPadX * 2, card.h + bgPadY * 2);

      if (isSelected) {
        ctx.strokeStyle = diff.color;
        ctx.shadowColor = diff.color;
        ctx.shadowBlur = 14;
        ctx.lineWidth = 3;
        ctx.strokeRect(card.x + 1, card.y + 1, card.w - 2, card.h - 2);
        ctx.shadowBlur = 0;
      } else if (isHover) {
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(card.x + 1, card.y + 1, card.w - 2, card.h - 2);
      }

      const compact = this.compact;
      const padX = compact ? 10 : 14;
      const leftX = card.x + padX;
      const labelSize = compact ? 13 : 16;
      const descSize = Math.max(11, labelSize * 0.7);

      // Label on the left
      ctx.font = `bold ${labelSize}px monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      shadowText(ctx, diff.label, leftX, card.y + card.h / 2, diff.color, 'rgba(0,0,0,0.7)');

      // Description to the right of label
      const labelW = ctx.measureText(diff.label).width;
      ctx.font = `${descSize}px monospace`;
      ctx.textAlign = 'left';
      ctx.fillStyle = isSelected ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.55)';
      ctx.fillText(diff.desc, leftX + labelW + 12, card.y + card.h / 2);

      if (isSelected) {
        const indW = 5;
        const indH = card.h * 0.5;
        const indY = card.y + (card.h - indH) / 2;
        ctx.fillStyle = diff.color;
        ctx.fillRect(card.x + 2, indY, indW, indH);
      }
    }

    // --- Fog of War toggle ---
    this.drawToggleRow(ctx, this.getFogToggleLayout(), this.fogOfWar, this.fogHover, '#66d9ef', 'FOG OF WAR', 'Hidden map, revealed by your units');

    // --- Isometric toggle ---
    this.drawToggleRow(ctx, this.getIsoToggleLayout(), this.isometric, this.isoHover, '#a6e22e', 'ISOMETRIC', 'Diamond grid, 1v1 & 2v2 only');

    // Bottom button row
    const { backX, startX, btnW, btnH, btnY } = this.getButtonRow();
    const btnFontSize = this.compact ? 13 : 16;
    const rb = UIAssets.swordReveal(this.sceneAge, 0);
    const obx = this.ui.drawSword(ctx, backX, btnY, btnW, btnH, 4, rb);
    if (rb > 0) {
      ctx.font = `bold ${btnFontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.globalAlpha = rb;
      const backTextX = backX + btnW * 0.52 + obx;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText('BACK', backTextX + 1, btnY + btnH * 0.58 + 1);
      ctx.fillStyle = '#fff';
      ctx.fillText('BACK', backTextX, btnY + btnH * 0.58);
      ctx.globalAlpha = 1;
    }

    const rs = UIAssets.swordReveal(this.sceneAge, 1);
    const osx = this.ui.drawSword(ctx, startX, btnY, btnW, btnH, 0, rs);
    if (rs > 0) {
      ctx.font = `bold ${btnFontSize}px monospace`;
      ctx.textBaseline = 'alphabetic';
      ctx.globalAlpha = rs;
      const startTextX = startX + btnW * 0.52 + osx;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText('START', startTextX + 1, btnY + btnH * 0.58 + 1);
      ctx.fillStyle = '#fff';
      ctx.fillText('START', startTextX, btnY + btnH * 0.58);
      ctx.globalAlpha = 1;
    }

    const hintSize = Math.max(11, Math.min(w / 55, 12));
    const hintY = this.compact ? btnY + btnH + 8 : btnY + btnH + 14;
    ctx.font = `bold ${Math.max(11, hintSize)}px monospace`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = DIFFICULTIES[this.selectedIndex].color;
    const fogLabel = this.fogOfWar ? '  FOG' : '';
    const isoLabel = this.isometric ? '  ISO' : '';
    ctx.fillText(`${MODE_OPTIONS[this.modeIndex].label}  ${DIFFICULTIES[this.selectedIndex].label}${fogLabel}${isoLabel}`, w / 2, hintY);
  }
}
