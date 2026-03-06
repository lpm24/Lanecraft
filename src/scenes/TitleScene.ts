import { Scene, SceneManager } from './Scene';

const TITLE_ART = [
  '   _   ___  ___ ___ ___  ',
  '  /_\\ / __|/ __|_ _|_ _| ',
  ' / _ \\\\__ \\ (__ | | | |  ',
  '/_/ \\_\\___/\\___|___|___| ',
  '                          ',
  ' __      __  _   ___  ___ ',
  ' \\ \\    / / /_\\ | _ \\/ __|',
  '  \\ \\/\\/ / / _ \\|   /\\__ \\',
  '   \\_/\\_/ /_/ \\_\\_|_\\|___/',
];

export class TitleScene implements Scene {
  private manager: SceneManager;
  private canvas: HTMLCanvasElement;
  private pulseTime = 0;
  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private touchHandler: ((e: TouchEvent) => void) | null = null;

  constructor(manager: SceneManager, canvas: HTMLCanvasElement) {
    this.manager = manager;
    this.canvas = canvas;
  }

  enter(): void {
    this.pulseTime = 0;
    this.clickHandler = () => this.manager.switchTo('raceSelect');
    this.touchHandler = (e) => { e.preventDefault(); this.manager.switchTo('raceSelect'); };
    this.canvas.addEventListener('click', this.clickHandler);
    this.canvas.addEventListener('touchstart', this.touchHandler);
  }

  exit(): void {
    if (this.clickHandler) this.canvas.removeEventListener('click', this.clickHandler);
    if (this.touchHandler) this.canvas.removeEventListener('touchstart', this.touchHandler);
    this.clickHandler = null;
    this.touchHandler = null;
  }

  update(dt: number): void {
    this.pulseTime += dt;
  }

  render(ctx: CanvasRenderingContext2D): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    // Title ASCII art
    const fontSize = Math.max(14, Math.min(w / 30, 28));
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const lineHeight = fontSize * 1.3;
    const titleStartY = h * 0.3 - (TITLE_ART.length * lineHeight) / 2;

    for (let i = 0; i < TITLE_ART.length; i++) {
      const t = this.pulseTime / 1000;
      const hue = (t * 30 + i * 20) % 360;
      ctx.fillStyle = `hsl(${hue}, 80%, 65%)`;
      ctx.fillText(TITLE_ART[i], w / 2, titleStartY + i * lineHeight);
    }

    // Subtitle
    ctx.font = `${fontSize * 0.6}px monospace`;
    ctx.fillStyle = '#888';
    ctx.fillText('A Strategy Game of ASCII Warfare', w / 2, titleStartY + TITLE_ART.length * lineHeight + 20);

    // "Tap to Start" pulsing
    const alpha = 0.5 + 0.5 * Math.sin(this.pulseTime / 500);
    ctx.globalAlpha = alpha;
    ctx.font = `bold ${fontSize * 0.8}px monospace`;
    ctx.fillStyle = '#00e5ff';
    ctx.fillText('[ TAP TO START ]', w / 2, h * 0.7);
    ctx.globalAlpha = 1;

    // Version
    ctx.font = `${fontSize * 0.4}px monospace`;
    ctx.fillStyle = '#444';
    ctx.fillText('v0.1.0 - dev build', w / 2, h - 30);
  }
}
