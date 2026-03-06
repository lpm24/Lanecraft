import { Scene, SceneManager } from './Scene';
import { Race } from '../simulation/types';
import { RACE_COLORS } from '../simulation/data';

interface RaceOption {
  race: Race;
  label: string;
  desc: string;
  ascii: string;
}

const RACES: RaceOption[] = [
  { race: Race.Surge, label: 'SURGE', desc: 'Electric - Fast & bursty', ascii: '/>' },
  { race: Race.Tide, label: 'TIDE', desc: 'Water - Tanky & slow', ascii: '|W|' },
  { race: Race.Ember, label: 'EMBER', desc: 'Fire - High damage, fragile', ascii: '/F\\' },
  { race: Race.Bastion, label: 'BASTION', desc: 'Stone - Ultra tanky fortress', ascii: '[#]' },
];

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
      if (e.key === 'ArrowLeft' || e.key === 'a') this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      if (e.key === 'ArrowRight' || e.key === 'd') this.selectedIndex = Math.min(RACES.length - 1, this.selectedIndex + 1);
      if (e.key === 'Enter' || e.key === ' ') this.confirm();
      if (e.key === 'Escape') this.manager.switchTo('title');
    };

    this.clickHandler = (e) => {
      const [cx, cy] = this.toCanvasCoords(e.clientX, e.clientY);
      const idx = this.getBoxIndexAt(cx, cy);
      if (idx >= 0) {
        this.selectedIndex = idx;
        this.confirm();
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
        this.confirm();
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
    const boxW = Math.min(160, (w - 60) / 4 - 10);
    const boxH = boxW * 1.4;
    const totalW = RACES.length * boxW + (RACES.length - 1) * 12;
    const startX = (w - totalW) / 2;
    const startY = h * 0.35;

    return RACES.map((_, i) => ({
      x: startX + i * (boxW + 12),
      y: startY,
      w: boxW,
      h: boxH,
    }));
  }

  private toCanvasCoords(clientX: number, clientY: number): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [clientX - rect.left, clientY - rect.top];
  }

  private isStartButtonAt(cx: number, cy: number): boolean {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const btnW = 200;
    const btnH = 48;
    const btnX = (w - btnW) / 2;
    const btnY = h * 0.78;
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

    // Header
    const headerSize = Math.max(16, Math.min(w / 25, 32));
    ctx.font = `bold ${headerSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ccc';
    ctx.fillText('CHOOSE YOUR RACE', w / 2, h * 0.15);

    ctx.font = `${headerSize * 0.5}px monospace`;
    ctx.fillStyle = '#666';
    ctx.fillText('Arrow keys or click to select, Enter to confirm', w / 2, h * 0.22);

    // Race boxes
    const boxes = this.getBoxLayout();
    const fontSize = Math.max(10, Math.min(boxes[0].w / 8, 16));

    for (let i = 0; i < RACES.length; i++) {
      const race = RACES[i];
      const box = boxes[i];
      const colors = RACE_COLORS[race.race];
      const isSelected = i === this.selectedIndex;
      const isHover = i === this.hoverIndex;

      // Box background
      ctx.fillStyle = isSelected ? '#1a1a2e' : '#111';
      ctx.fillRect(box.x, box.y, box.w, box.h);

      // Border
      ctx.strokeStyle = isSelected ? colors.primary : (isHover ? '#555' : '#333');
      ctx.lineWidth = isSelected ? 3 : 1;
      ctx.strokeRect(box.x, box.y, box.w, box.h);

      // ASCII sprite large
      ctx.font = `bold ${fontSize * 2.5}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = colors.primary;
      ctx.fillText(race.ascii, box.x + box.w / 2, box.y + box.h * 0.3);

      // Race name
      ctx.font = `bold ${fontSize * 1.2}px monospace`;
      ctx.fillStyle = isSelected ? colors.primary : '#aaa';
      ctx.fillText(race.label, box.x + box.w / 2, box.y + box.h * 0.55);

      // Description
      ctx.font = `${fontSize * 0.8}px monospace`;
      ctx.fillStyle = '#888';
      ctx.fillText(race.desc, box.x + box.w / 2, box.y + box.h * 0.7);

      // Selected indicator
      if (isSelected) {
        ctx.font = `bold ${fontSize}px monospace`;
        ctx.fillStyle = colors.secondary;
        ctx.fillText('[ SELECTED ]', box.x + box.w / 2, box.y + box.h * 0.88);
      }
    }

    // Start button
    const btnY = h * 0.78;
    const btnW = 200;
    const btnH = 48;
    const btnX = (w - btnW) / 2;
    const selColors = RACE_COLORS[RACES[this.selectedIndex].race];

    ctx.fillStyle = selColors.primary;
    ctx.fillRect(btnX, btnY, btnW, btnH);
    ctx.font = `bold ${fontSize * 1.3}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#000';
    ctx.fillText('START MATCH', w / 2, btnY + btnH / 2 + fontSize * 0.4);

    // Back hint
    ctx.font = `${fontSize * 0.7}px monospace`;
    ctx.fillStyle = '#555';
    ctx.fillText('ESC to go back', w / 2, h - 30);
  }
}
