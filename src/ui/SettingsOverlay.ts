import { type AudioSettings, updateAudioSettings } from '../audio/AudioSettings';
import { getVisualSettings, updateVisualSettings } from '../rendering/VisualSettings';
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
  shakeRow: Rect;
  weatherRow: Rect;
  dayNightRow: Rect;
  damageNumbersRow: Rect;
}

export function hitRect(x: number, y: number, rect: Rect, pad = 0): boolean {
  return x >= rect.x - pad && x <= rect.x + rect.w + pad && y >= rect.y - pad && y <= rect.y + rect.h + pad;
}

export function getSettingsOverlayLayout(width: number, _height: number): SettingsOverlayLayout {
  const size = 46;
  const button = { x: width - size - 14, y: 13 + getSafeTop(), w: size, h: size };
  // Panel height: title(24) + audioHeader(16) + music(30) + sfx(30) + gap(6)
  //   + visualHeader(16) + shake(30) + weather(30) + dayNight(30) + dmgNums(30) + pad(8) = 250
  const panelH = 250;
  const panel = { x: button.x + button.w - 210, y: button.y + button.h + 4, w: 210, h: panelH };
  const rowH = 28;
  const px = panel.x + 8;
  const pw = 194;
  // Audio section
  const audioHeaderY = panel.y + 24;
  const musicY = audioHeaderY + 16;
  const sfxY = musicY + rowH + 2;
  // Visual section
  const visualHeaderY = sfxY + rowH + 6;
  const shakeY = visualHeaderY + 16;
  const weatherY = shakeY + rowH + 2;
  const dayNightY = weatherY + rowH + 2;
  const damageNumbersY = dayNightY + rowH + 2;
  return {
    button,
    panel,
    close: { x: panel.x + 174, y: panel.y + 2, w: 22, h: 22 },
    musicRow: { x: px, y: musicY, w: pw, h: rowH },
    sfxRow: { x: px, y: sfxY, w: pw, h: rowH },
    shakeRow: { x: px, y: shakeY, w: pw, h: rowH },
    weatherRow: { x: px, y: weatherY, w: pw, h: rowH },
    dayNightRow: { x: px, y: dayNightY, w: pw, h: rowH },
    damageNumbersRow: { x: px, y: damageNumbersY, w: pw, h: rowH },
  };
}

function drawSlider(ctx: CanvasRenderingContext2D, rect: Rect, value: number, color: string): void {
  const trackX = rect.x + 94;
  const trackY = rect.y + 11;
  const trackW = 86;
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
  ctx.fillRect(Math.max(trackX - 3, Math.min(trackX + trackW - 5, knobX - 3)), trackY - 3, 6, trackH + 6);
}

function drawToggleRow(
  ctx: CanvasRenderingContext2D, rect: Rect, label: string, on: boolean, color: string,
): void {
  ctx.fillStyle = 'rgba(20,20,20,0.9)';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = on ? color : '#666';
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.fillStyle = on ? color : '#888';
  ctx.font = 'bold 12px monospace';
  ctx.fillText(`${label}: ${on ? 'on' : 'off'}`, rect.x + 8, rect.y + 18);
  // Toggle indicator
  const tX = rect.x + rect.w - 36;
  const tY = rect.y + 7;
  const tW = 28;
  const tH = 14;
  ctx.fillStyle = on ? color : '#444';
  ctx.fillRect(tX, tY, tW, tH);
  ctx.fillStyle = '#fff';
  ctx.fillRect(on ? tX + tW - 12 : tX, tY, 12, tH);
}

function drawSectionHeader(ctx: CanvasRenderingContext2D, x: number, y: number, label: string): void {
  ctx.fillStyle = '#8fa7bf';
  ctx.font = 'bold 11px monospace';
  ctx.fillText(label, x, y + 10);
  // Thin separator line
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(x + ctx.measureText(label).width + 6, y + 6, 194 - ctx.measureText(label).width - 6, 1);
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
  audioSettings: AudioSettings,
): void {
  const { panel, close, musicRow, sfxRow, shakeRow, weatherRow, dayNightRow, damageNumbersRow } = layout;
  const vis = getVisualSettings();

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

  // ── Audio Section ──
  drawSectionHeader(ctx, panel.x + 8, panel.y + 20, 'AUDIO');

  ctx.fillStyle = 'rgba(20,20,20,0.9)';
  ctx.fillRect(musicRow.x, musicRow.y, musicRow.w, musicRow.h);
  ctx.strokeStyle = '#90caf9';
  ctx.strokeRect(musicRow.x, musicRow.y, musicRow.w, musicRow.h);
  ctx.fillStyle = '#90caf9';
  ctx.font = 'bold 12px monospace';
  ctx.fillText(`Music: ${Math.round(audioSettings.musicVolume * 100)}%`, musicRow.x + 8, musicRow.y + 18);
  drawSlider(ctx, musicRow, audioSettings.musicVolume, '#90caf9');

  ctx.fillStyle = 'rgba(20,20,20,0.9)';
  ctx.fillRect(sfxRow.x, sfxRow.y, sfxRow.w, sfxRow.h);
  ctx.strokeStyle = '#ffcc80';
  ctx.strokeRect(sfxRow.x, sfxRow.y, sfxRow.w, sfxRow.h);
  ctx.fillStyle = '#ffcc80';
  ctx.font = 'bold 12px monospace';
  ctx.fillText(`SFX: ${Math.round(audioSettings.sfxVolume * 100)}%`, sfxRow.x + 8, sfxRow.y + 18);
  drawSlider(ctx, sfxRow, audioSettings.sfxVolume, '#ffcc80');

  // ── Visual Section ──
  drawSectionHeader(ctx, panel.x + 8, sfxRow.y + sfxRow.h + 2, 'VISUAL');

  drawToggleRow(ctx, shakeRow, 'Screen Shake', vis.screenShake, '#a5d6a7');
  drawToggleRow(ctx, weatherRow, 'Weather', vis.weather, '#a5d6a7');
  drawToggleRow(ctx, dayNightRow, 'Day/Night', vis.dayNight, '#a5d6a7');
  drawToggleRow(ctx, damageNumbersRow, 'Dmg Numbers', vis.damageNumbers, '#a5d6a7');
}

/** Handle clicks on visual toggle rows. Returns true if a toggle was hit. */
export function handleVisualToggleClick(cx: number, cy: number, layout: SettingsOverlayLayout): boolean {
  const vis = getVisualSettings();
  if (hitRect(cx, cy, layout.shakeRow)) {
    updateVisualSettings({ screenShake: !vis.screenShake });
    return true;
  }
  if (hitRect(cx, cy, layout.weatherRow)) {
    updateVisualSettings({ weather: !vis.weather });
    return true;
  }
  if (hitRect(cx, cy, layout.dayNightRow)) {
    updateVisualSettings({ dayNight: !vis.dayNight });
    return true;
  }
  if (hitRect(cx, cy, layout.damageNumbersRow)) {
    updateVisualSettings({ damageNumbers: !vis.damageNumbers });
    return true;
  }
  return false;
}

export function sliderValueFromPoint(x: number, rect: Rect): number {
  const trackX = rect.x + 94;
  const trackW = 86;
  return Math.max(0, Math.min(1, (x - trackX) / trackW));
}

/** Tracks slider drag state for the settings overlay. */
export class SettingsSliderDrag {
  active: 'music' | 'sfx' | null = null;

  /** Call on pointer/touch down. Returns true if a slider drag started. */
  start(cx: number, cy: number, layout: SettingsOverlayLayout, settingsOpen: boolean): boolean {
    if (!settingsOpen) return false;
    if (hitRect(cx, cy, layout.musicRow)) {
      this.active = 'music';
      this.apply(cx, layout);
      return true;
    }
    if (hitRect(cx, cy, layout.sfxRow)) {
      this.active = 'sfx';
      this.apply(cx, layout);
      return true;
    }
    return false;
  }

  /** Call on pointer/touch move. Returns true if dragging a slider. */
  move(cx: number, layout: SettingsOverlayLayout): boolean {
    if (!this.active) return false;
    this.apply(cx, layout);
    return true;
  }

  /** Call on pointer/touch up. */
  end(): void {
    this.active = null;
  }

  private apply(cx: number, layout: SettingsOverlayLayout): void {
    const row = this.active === 'music' ? layout.musicRow : layout.sfxRow;
    const key = this.active === 'music' ? 'musicVolume' : 'sfxVolume';
    updateAudioSettings({ [key]: sliderValueFromPoint(cx, row) });
  }
}
