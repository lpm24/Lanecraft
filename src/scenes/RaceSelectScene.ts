import { Scene, SceneManager } from './Scene';
import { Race } from '../simulation/types';
import { RACE_COLORS } from '../simulation/data';

interface RaceOption {
  race: Race;
  label: string;
  desc: string;
  econ: string;   // resource economy hint
  ascii: string;
}

const RACES: RaceOption[] = [
  { race: Race.Surge,   label: 'SURGE',   desc: 'Speed + haste aura',   econ: 'Gold only',      ascii: '/>' },
  { race: Race.Shade,   label: 'SHADE',   desc: 'Poison + lifesteal',   econ: 'Gold + Wood',    ascii: '~^' },
  { race: Race.Tide,    label: 'TIDE',    desc: 'Control + cleanse',     econ: 'Wood + Gold',    ascii: '|W|' },
  { race: Race.Bastion, label: 'BASTION', desc: 'Shields + fortress',    econ: 'Stone + Gold',   ascii: '[#]' },
  { race: Race.Thorn,   label: 'THORN',   desc: 'Regen + healing aura',  econ: 'Wood + Stone',   ascii: '%#' },
  { race: Race.Ember,   label: 'EMBER',   desc: 'Pure burst damage',     econ: 'Stone + Wood',   ascii: '/F\\' },
];

const COLS = 3;
const ROWS = 2;

export interface RaceSelectResult {
  playerRace: Race;
}

export class RaceSelectScene implements Scene {
  private manager: SceneManager;
  private canvas: HTMLCanvasElement;
  private selectedIndex = 0;
  private hoverIndex = -1;
  private onConfirm: (result: RaceSelectResult) => void;

  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private moveHandler: ((e: MouseEvent) => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private touchHandler: ((e: TouchEvent) => void) | null = null;

  constructor(manager: SceneManager, canvas: HTMLCanvasElement, onConfirm: (result: RaceSelectResult) => void) {
    this.manager = manager;
    this.canvas = canvas;
    this.onConfirm = onConfirm;
  }

  enter(): void {
    this.hoverIndex = -1;

    this.keyHandler = (e) => {
      const col = this.selectedIndex % COLS;
      const row = Math.floor(this.selectedIndex / COLS);
      if (e.key === 'ArrowLeft' || e.key === 'a') {
        if (col > 0) this.selectedIndex--;
      }
      if (e.key === 'ArrowRight' || e.key === 'd') {
        if (col < COLS - 1) this.selectedIndex++;
      }
      if (e.key === 'ArrowUp' || e.key === 'w') {
        if (row > 0) this.selectedIndex -= COLS;
      }
      if (e.key === 'ArrowDown' || e.key === 's') {
        if (row < ROWS - 1) this.selectedIndex += COLS;
      }
      this.selectedIndex = Math.max(0, Math.min(RACES.length - 1, this.selectedIndex));
      if (e.key === 'Enter' || e.key === ' ') this.confirm();
      if (e.key === 'Escape') this.manager.switchTo('title');
    };

    this.clickHandler = (e) => {
      const [cx, cy] = this.toCanvasCoords(e.clientX, e.clientY);
      const idx = this.getBoxIndexAt(cx, cy);
      if (idx >= 0) {
        this.selectedIndex = idx;
      } else if (this.isStartButtonAt(cx, cy)) {
        this.confirm();
      }
    };

    this.moveHandler = (e) => {
      const [cx, cy] = this.toCanvasCoords(e.clientX, e.clientY);
      this.hoverIndex = this.getBoxIndexAt(cx, cy);
    };

    this.touchHandler = (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;
      const [cx, cy] = this.toCanvasCoords(touch.clientX, touch.clientY);
      const idx = this.getBoxIndexAt(cx, cy);
      if (idx >= 0) {
        this.selectedIndex = idx;
      } else if (this.isStartButtonAt(cx, cy)) {
        this.confirm();
      }
    };

    window.addEventListener('keydown', this.keyHandler);
    this.canvas.addEventListener('click', this.clickHandler);
    this.canvas.addEventListener('mousemove', this.moveHandler);
    this.canvas.addEventListener('touchstart', this.touchHandler);
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
  }

  private confirm(): void {
    this.onConfirm({ playerRace: RACES[this.selectedIndex].race });
  }

  private getBoxLayout(): { x: number; y: number; w: number; h: number }[] {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const gapX = 12;
    const gapY = 12;
    const boxW = Math.min(150, (w - 60) / COLS - gapX);
    const boxH = boxW * 1.3;
    const totalW = COLS * boxW + (COLS - 1) * gapX;
    const totalH = ROWS * boxH + (ROWS - 1) * gapY;
    const startX = (w - totalW) / 2;
    const startY = (h * 0.25) + ((h * 0.55 - totalH) / 2);

    return RACES.map((_, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      return {
        x: startX + col * (boxW + gapX),
        y: startY + row * (boxH + gapY),
        w: boxW,
        h: boxH,
      };
    });
  }

  private toCanvasCoords(clientX: number, clientY: number): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [clientX - rect.left, clientY - rect.top];
  }

  private isStartButtonAt(cx: number, cy: number): boolean {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const btnW = 180;
    const btnH = 48;
    const btnX = (w - btnW) / 2;
    const btnY = h * 0.88;
    return cx >= btnX && cx <= btnX + btnW && cy >= btnY && cy <= btnY + btnH;
  }

  private getBoxIndexAt(cx: number, cy: number): number {
    const boxes = this.getBoxLayout();
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) {
        return i;
      }
    }
    return -1;
  }

  update(_dt: number): void {}

  render(ctx: CanvasRenderingContext2D): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    // === Title ===
    const titleSize = Math.max(20, Math.min(w / 16, 48));
    ctx.font = `bold ${titleSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText('ASCII WARS', w / 2, h * 0.08);

    // Subtitle
    const subSize = Math.max(12, Math.min(w / 30, 22));
    ctx.font = `${subSize}px monospace`;
    ctx.fillStyle = '#666';
    ctx.fillText('Choose your race', w / 2, h * 0.14);

    // Hint
    ctx.font = `${subSize * 0.7}px monospace`;
    ctx.fillStyle = '#444';
    ctx.fillText('Arrow keys + Enter  or  Click', w / 2, h * 0.19);

    // === Race boxes (3x2 grid) ===
    const boxes = this.getBoxLayout();
    const fontSize = Math.max(10, Math.min(boxes[0].w / 8, 16));

    for (let i = 0; i < RACES.length; i++) {
      const race = RACES[i];
      const box = boxes[i];
      const colors = RACE_COLORS[race.race];
      const isSelected = i === this.selectedIndex;
      const isHover = i === this.hoverIndex;

      ctx.save();
      ctx.beginPath();
      ctx.rect(box.x, box.y, box.w, box.h);
      ctx.clip();

      // Box background
      ctx.fillStyle = isSelected ? '#1a1a2e' : '#111';
      ctx.fillRect(box.x, box.y, box.w, box.h);

      // Glow behind selected
      if (isSelected) {
        ctx.shadowColor = colors.primary;
        ctx.shadowBlur = 15;
      }

      // Border
      ctx.strokeStyle = isSelected ? colors.primary : (isHover ? '#555' : '#333');
      ctx.lineWidth = isSelected ? 3 : 1;
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      ctx.shadowBlur = 0;

      const cx = box.x + box.w / 2;

      // ASCII sprite large
      ctx.font = `bold ${fontSize * 2.2}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = colors.primary;
      ctx.fillText(race.ascii, cx, box.y + box.h * 0.25);

      // Race name
      ctx.font = `bold ${fontSize * 1.2}px monospace`;
      ctx.fillStyle = isSelected ? colors.primary : '#aaa';
      ctx.fillText(race.label, cx, box.y + box.h * 0.46);

      // Description
      ctx.font = `${fontSize * 0.75}px monospace`;
      ctx.fillStyle = '#999';
      ctx.fillText(race.desc, cx, box.y + box.h * 0.60);

      // Economy hint
      ctx.font = `${fontSize * 0.7}px monospace`;
      ctx.fillStyle = '#777';
      ctx.fillText(race.econ, cx, box.y + box.h * 0.72);

      // Selected indicator
      if (isSelected) {
        ctx.font = `bold ${fontSize * 0.85}px monospace`;
        ctx.fillStyle = colors.secondary;
        ctx.fillText('[ SELECTED ]', cx, box.y + box.h * 0.88);
      }

      ctx.restore();
    }

    // === Start button ===
    const btnW = 180;
    const btnH = 48;
    const btnX = (w - btnW) / 2;
    const btnY = h * 0.88;
    const selColors = RACE_COLORS[RACES[this.selectedIndex].race];

    ctx.shadowColor = selColors.primary;
    ctx.shadowBlur = 12;
    ctx.fillStyle = selColors.primary;
    ctx.fillRect(btnX, btnY, btnW, btnH);
    ctx.shadowBlur = 0;

    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#000';
    ctx.fillText('START', w / 2, btnY + btnH / 2 + 7);

    // Back hint
    ctx.font = `${fontSize * 0.7}px monospace`;
    ctx.fillStyle = '#444';
    ctx.fillText('ESC to go back', w / 2, h - 12);
  }
}
