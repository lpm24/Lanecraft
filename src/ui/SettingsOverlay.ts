import type { AudioSettings } from '../audio/AudioSettings';
import type { UIAssets } from '../rendering/UIAssets';
import { getSafeTop } from './SafeArea';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SettingsOverlayLayout {
  button: Rect;
  panel: Rect;
  close: Rect;
  musicRow: Rect;
  sfxRow: Rect;
}

export function hitRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

export function getSettingsOverlayLayout(width: number, _height: number): SettingsOverlayLayout {
  const size = 30;
  const button = { x: width - size * 2 - 18, y: 10 + getSafeTop(), w: size, h: size };
  const panel = { x: button.x + button.w - 200, y: button.y + button.h + 4, w: 200, h: 98 };
  return {
    button,
    panel,
    close: { x: panel.x + 178, y: panel.y + 4, w: 16, h: 16 },
    musicRow: { x: panel.x + 8, y: panel.y + 34, w: 184, h: 24 },
    sfxRow: { x: panel.x + 8, y: panel.y + 66, w: 184, h: 24 },
  };
}

function drawSlider(ctx: CanvasRenderingContext2D, rect: Rect, value: number, color: string): void {
  const trackX = rect.x + 94;
  const trackY = rect.y + 9;
  const trackW = 76;
  const trackH = 6;
  const fillW = Math.max(0, Math.min(trackW, trackW * value));

  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(trackX, trackY, trackW, trackH);
  ctx.fillStyle = color;
  ctx.fillRect(trackX, trackY, fillW, trackH);
  ctx.strokeStyle = color;
  ctx.strokeRect(trackX, trackY, trackW, trackH);

  const knobX = trackX + fillW;
  ctx.fillStyle = '#fff';
  ctx.fillRect(Math.max(trackX - 2, Math.min(trackX + trackW - 4, knobX - 2)), trackY - 2, 4, trackH + 4);
}

export function drawSettingsButton(
  ctx: CanvasRenderingContext2D,
  ui: UIAssets,
  rect: Rect,
  active: boolean,
): void {
  if (active) {
    ctx.fillStyle = 'rgba(41,121,255,0.35)';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  if (!ui.drawIcon(ctx, 'settings', rect.x, rect.y, rect.w)) {
    ctx.fillStyle = 'rgba(18,18,18,0.92)';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = '#9bb7ff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.fillStyle = '#e3f2fd';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('*', rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
  }
}

export function drawSettingsOverlay(
  ctx: CanvasRenderingContext2D,
  ui: UIAssets,
  layout: SettingsOverlayLayout,
  settings: AudioSettings,
): void {
  const { panel, close, musicRow, sfxRow } = layout;

  const bgPadX = panel.w * 0.10;
  const bgPadY = panel.h * 0.10;
  if (!ui.drawWoodTable(ctx, panel.x - bgPadX, panel.y - bgPadY, panel.w + bgPadX * 2, panel.h + bgPadY * 2)) {
    ctx.fillStyle = 'rgba(0,0,0,0.88)';
    ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
  }

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Settings', panel.x + 8, panel.y + 16);
  ui.drawIcon(ctx, 'close', close.x, close.y, close.w);

  ctx.fillStyle = 'rgba(20,20,20,0.9)';
  ctx.fillRect(musicRow.x, musicRow.y, musicRow.w, musicRow.h);
  ctx.strokeStyle = '#90caf9';
  ctx.strokeRect(musicRow.x, musicRow.y, musicRow.w, musicRow.h);
  ctx.fillStyle = '#90caf9';
  ctx.font = 'bold 12px monospace';
  ctx.fillText(`Music: ${Math.round(settings.musicVolume * 100)}%`, musicRow.x + 8, musicRow.y + 16);
  drawSlider(ctx, musicRow, settings.musicVolume, '#90caf9');

  ctx.fillStyle = 'rgba(20,20,20,0.9)';
  ctx.fillRect(sfxRow.x, sfxRow.y, sfxRow.w, sfxRow.h);
  ctx.strokeStyle = '#ffcc80';
  ctx.strokeRect(sfxRow.x, sfxRow.y, sfxRow.w, sfxRow.h);
  ctx.fillStyle = '#ffcc80';
  ctx.font = 'bold 12px monospace';
  ctx.fillText(`SFX: ${Math.round(settings.sfxVolume * 100)}%`, sfxRow.x + 8, sfxRow.y + 16);
  drawSlider(ctx, sfxRow, settings.sfxVolume, '#ffcc80');
}

export function sliderValueFromPoint(x: number, rect: Rect): number {
  const trackX = rect.x + 94;
  const trackW = 76;
  return Math.max(0, Math.min(1, (x - trackX) / trackW));
}
