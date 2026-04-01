/**
 * InputSettings.ts — Settings panel logic extracted from InputHandler.
 *
 * Contains storage key constants, load/save helpers, settings panel layout
 * computation, drawing, click handling, and slider application.
 */

import { getAudioSettings, updateAudioSettings } from '../audio/AudioSettings';
import { getVisualSettings, updateVisualSettings } from '../rendering/VisualSettings';
import { UIAssets } from '../rendering/UIAssets';
import { isMatchTutorial } from './TutorialManager';

// ── Storage key constants ──

export const LANE_MODE_STORAGE_KEY = 'lanecraft.laneToggleMode';
export const UI_FEEDBACK_STORAGE_KEY = 'lanecraft.uiFeedbackEnabled';
export const RADIAL_ARM_MS_STORAGE_KEY = 'lanecraft.radialArmMs';
export const RADIAL_SIZE_STORAGE_KEY = 'lanecraft.radialSize';
export const RADIAL_A11Y_STORAGE_KEY = 'lanecraft.radialA11y';
export const CAMERA_SNAP_STORAGE_KEY = 'lanecraft.cameraSnapOnSelect';
export const MINIMAP_PAN_STORAGE_KEY = 'lanecraft.minimapPanEnabled';
export const STICKY_BUILD_STORAGE_KEY = 'lanecraft.stickyBuildMode';
export const MOBILE_HINT_SEEN_KEY = 'lanecraft.mobileHintSeen';

/** Mutable settings state owned by InputHandler, passed by reference. */
export interface SettingsState {
  laneToggleMode: 'double' | 'single';
  uiFeedbackEnabled: boolean;
  radialArmMs: number;
  radialSize: number;
  radialAccessibility: boolean;
  cameraSnapOnSelect: boolean;
  minimapPanEnabled: boolean;
  stickyBuildMode: boolean;
  mobileHintVisible: boolean;
  settingsOpen: boolean;
  settingsSliderDrag: 'music' | 'sfx' | null;
}

export interface SettingsPanelDeps {
  getSettingsButtonRect: () => { x: number; y: number; w: number; h: number };
  ui: UIAssets;
  onConcede: (() => void) | null;
  onQuitGame: (() => void) | null;
  playSfx: {
    playUIToggle: () => void;
    playUISlider: () => void;
    playUIClose: () => void;
    playUIOpen: () => void;
  };
}

// ── Load / Save helpers ──

export function loadSettings(s: SettingsState): void {
  try {
    const raw = window.localStorage.getItem(LANE_MODE_STORAGE_KEY);
    if (raw === 'single' || raw === 'double') s.laneToggleMode = raw;
    const feedback = window.localStorage.getItem(UI_FEEDBACK_STORAGE_KEY);
    if (feedback === '0') s.uiFeedbackEnabled = false;
    const armMs = Number(window.localStorage.getItem(RADIAL_ARM_MS_STORAGE_KEY));
    if (Number.isFinite(armMs) && armMs >= 220 && armMs <= 700) s.radialArmMs = Math.round(armMs);
    const radialSize = Number(window.localStorage.getItem(RADIAL_SIZE_STORAGE_KEY));
    if (Number.isFinite(radialSize) && radialSize >= 56 && radialSize <= 120) s.radialSize = Math.round(radialSize);
    s.radialAccessibility = window.localStorage.getItem(RADIAL_A11Y_STORAGE_KEY) === '1';
    const cameraSnap = window.localStorage.getItem(CAMERA_SNAP_STORAGE_KEY);
    if (cameraSnap === '0') s.cameraSnapOnSelect = false;
    const minimapPan = window.localStorage.getItem(MINIMAP_PAN_STORAGE_KEY);
    if (minimapPan === '0') s.minimapPanEnabled = false;
    s.stickyBuildMode = window.localStorage.getItem(STICKY_BUILD_STORAGE_KEY) === '1';
  } catch { /* ignore storage errors */ }
}

export function saveLaneMode(s: SettingsState): void {
  try { window.localStorage.setItem(LANE_MODE_STORAGE_KEY, s.laneToggleMode); }
  catch { /* ignore storage errors */ }
}

export function saveUiFeedbackEnabled(s: SettingsState): void {
  try { window.localStorage.setItem(UI_FEEDBACK_STORAGE_KEY, s.uiFeedbackEnabled ? '1' : '0'); }
  catch { /* ignore storage errors */ }
}

export function saveRadialSettings(s: SettingsState): void {
  try {
    window.localStorage.setItem(RADIAL_ARM_MS_STORAGE_KEY, `${s.radialArmMs}`);
    window.localStorage.setItem(RADIAL_SIZE_STORAGE_KEY, `${s.radialSize}`);
    window.localStorage.setItem(RADIAL_A11Y_STORAGE_KEY, s.radialAccessibility ? '1' : '0');
  } catch { /* ignore storage errors */ }
}

export function saveGameplaySettings(s: SettingsState): void {
  try {
    window.localStorage.setItem(CAMERA_SNAP_STORAGE_KEY, s.cameraSnapOnSelect ? '1' : '0');
    window.localStorage.setItem(MINIMAP_PAN_STORAGE_KEY, s.minimapPanEnabled ? '1' : '0');
    window.localStorage.setItem(STICKY_BUILD_STORAGE_KEY, s.stickyBuildMode ? '1' : '0');
  } catch { /* ignore storage errors */ }
}

export function resetUiDefaults(s: SettingsState): void {
  s.laneToggleMode = 'double';
  s.uiFeedbackEnabled = true;
  s.radialArmMs = 320;
  s.radialSize = 74;
  s.radialAccessibility = false;
  s.cameraSnapOnSelect = true;
  s.minimapPanEnabled = true;
  s.stickyBuildMode = false;
  saveLaneMode(s);
  saveUiFeedbackEnabled(s);
  saveRadialSettings(s);
  saveGameplaySettings(s);
  updateVisualSettings({ screenShake: true, weather: true, dayNight: true, touchControls: 'auto' });
}

export function initMobileHint(s: SettingsState): void {
  try {
    const seen = window.localStorage.getItem(MOBILE_HINT_SEEN_KEY) === '1';
    const touchCapable = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    s.mobileHintVisible = touchCapable && !seen && !isMatchTutorial();
  } catch {
    s.mobileHintVisible = false;
  }
}

export function dismissMobileHint(s: SettingsState): void {
  s.mobileHintVisible = false;
  try { window.localStorage.setItem(MOBILE_HINT_SEEN_KEY, '1'); }
  catch { /* ignore */ }
}

export function laneModeLabel(s: SettingsState): string {
  return s.laneToggleMode === 'single' ? 'Fast Toggle' : 'Safe Select';
}

// ── Settings panel layout ──

export interface SettingsPanelLayout {
  sx: number; sy: number; pw: number; panelH: number; pad: number; rowH: number;
  audioHeaderY: number; musicRowY: number; sfxRowY: number;
  visualHeaderY: number; shakeRowY: number; weatherRowY: number; dayNightRowY: number;
  controlsHeaderY: number; touchControlsRowY: number; laneRowY: number; feedbackRowY: number;
  cameraSnapRowY: number; minimapRowY: number;
  stickyRowY: number; holdDelayRowY: number; radialSizeRowY: number; radialA11yRowY: number;
  helpRowY: number; resetRowY: number; concedeRowY: number; quitRowY: number;
}

export function getSettingsPanelLayout(deps: SettingsPanelDeps): SettingsPanelLayout {
  const sr = deps.getSettingsButtonRect();
  const sx = sr.x + sr.w - 200;
  const sy = sr.y + sr.h + 4;
  const pw = 200;
  const rowH = 22;
  const gap = 2;
  const pad = 8;

  let y = 24; // after title row

  // Audio section
  const audioHeaderY = y; y += 14;
  const musicRowY = y; y += rowH + gap;
  const sfxRowY = y; y += rowH + gap + 4;

  // Visual section
  const visualHeaderY = y; y += 14;
  const shakeRowY = y; y += rowH + gap;
  const weatherRowY = y; y += rowH + gap;
  const dayNightRowY = y; y += rowH + gap + 4;

  // Controls section
  const controlsHeaderY = y; y += 14;
  const touchControlsRowY = y; y += rowH + gap;
  const laneRowY = y; y += rowH + gap;
  const feedbackRowY = y; y += rowH + gap;
  const cameraSnapRowY = y; y += rowH + gap;
  const minimapRowY = y; y += rowH + gap;
  const stickyRowY = y; y += rowH + gap;
  const holdDelayRowY = y; y += rowH + gap;
  const radialSizeRowY = y; y += rowH + gap;
  const radialA11yRowY = y; y += rowH + gap + 4;

  // Actions
  const helpRowY = -1;
  const resetRowY = y; y += rowH + gap + 8;
  let concedeRowY = -1;
  if (deps.onConcede) { concedeRowY = y; y += rowH + gap + 8; }
  const quitRowY = y; y += rowH + pad;

  const panelH = y;

  return {
    sx, sy, pw, panelH, pad, rowH,
    audioHeaderY, musicRowY, sfxRowY,
    visualHeaderY, shakeRowY, weatherRowY, dayNightRowY,
    controlsHeaderY, touchControlsRowY, laneRowY, feedbackRowY, cameraSnapRowY, minimapRowY,
    stickyRowY, holdDelayRowY, radialSizeRowY, radialA11yRowY,
    helpRowY, resetRowY, concedeRowY, quitRowY,
  };
}

export function drawSettingsPanel(
  ctx: CanvasRenderingContext2D,
  s: SettingsState,
  deps: SettingsPanelDeps,
): void {
  const L = getSettingsPanelLayout(deps);
  const { sx, sy, pw, panelH, pad, rowH } = L;
  const rw = pw - pad * 2;
  const rx = sx + pad;
  const audio = getAudioSettings();
  const vis = getVisualSettings();

  // Panel background -- draw oversized to account for 9-slice dead space
  const bgPadX = pw * 0.15;
  const bgPadY = panelH * 0.15;
  if (!deps.ui.drawWoodTable(ctx, sx - bgPadX, sy - bgPadY, pw + bgPadX * 2, panelH + bgPadY * 2)) {
    ctx.fillStyle = 'rgba(0,0,0,0.92)';
    ctx.fillRect(sx, sy, pw, panelH);
  }

  // Title + close
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Settings', sx + pad, sy + 16);
  deps.ui.drawIcon(ctx, 'close', sx + pw - 22, sy + 4, 16);

  // -- Helper: section header --
  const drawHeader = (yOff: number, label: string) => {
    ctx.fillStyle = '#8fa7bf';
    ctx.font = 'bold 11px monospace';
    const tw = ctx.measureText(label).width;
    ctx.fillText(label, rx, sy + yOff + 10);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(rx + tw + 4, sy + yOff + 6, rw - tw - 4, 1);
  };

  // -- Helper: toggle row --
  const drawToggle = (yOff: number, label: string, on: boolean, color: string) => {
    ctx.fillStyle = 'rgba(20,20,20,0.9)';
    ctx.fillRect(rx, sy + yOff, rw, rowH);
    ctx.strokeStyle = on ? color : '#555';
    ctx.strokeRect(rx, sy + yOff, rw, rowH);
    ctx.fillStyle = on ? color : '#888';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(`${label}: ${on ? 'on' : 'off'}`, rx + 8, sy + yOff + 15);
    // Mini toggle switch
    const tX = rx + rw - 32;
    const tY = sy + yOff + 5;
    ctx.fillStyle = on ? color : '#444';
    ctx.fillRect(tX, tY, 24, 12);
    ctx.fillStyle = '#fff';
    ctx.fillRect(on ? tX + 12 : tX, tY, 12, 12);
  };

  // -- Helper: slider row --
  const drawSlider = (yOff: number, label: string, value: number, color: string) => {
    ctx.fillStyle = 'rgba(20,20,20,0.9)';
    ctx.fillRect(rx, sy + yOff, rw, rowH);
    ctx.strokeStyle = color;
    ctx.strokeRect(rx, sy + yOff, rw, rowH);
    ctx.fillStyle = color;
    ctx.font = 'bold 11px monospace';
    ctx.fillText(`${label}: ${Math.round(value * 100)}%`, rx + 8, sy + yOff + 15);
    // Slider track
    const trackX = rx + 92;
    const trackY = sy + yOff + 8;
    const trackW = rw - 100;
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
  };

  // -- Helper: action row --
  const drawAction = (yOff: number, label: string, color: string, bgColor: string) => {
    ctx.fillStyle = bgColor;
    ctx.fillRect(rx, sy + yOff, rw, rowH);
    ctx.strokeStyle = color;
    ctx.strokeRect(rx, sy + yOff, rw, rowH);
    ctx.fillStyle = color;
    ctx.font = 'bold 11px monospace';
    ctx.fillText(label, rx + 8, sy + yOff + 15);
  };

  // -- AUDIO --
  drawHeader(L.audioHeaderY, 'AUDIO');
  drawSlider(L.musicRowY, 'Music', audio.musicVolume, '#90caf9');
  drawSlider(L.sfxRowY, 'SFX', audio.sfxVolume, '#ffcc80');

  // -- VISUAL --
  drawHeader(L.visualHeaderY, 'VISUAL');
  drawToggle(L.shakeRowY, 'Screen Shake', vis.screenShake, '#a5d6a7');
  drawToggle(L.weatherRowY, 'Weather', vis.weather, '#a5d6a7');
  drawToggle(L.dayNightRowY, 'Day/Night', vis.dayNight, '#a5d6a7');

  // -- CONTROLS --
  drawHeader(L.controlsHeaderY, 'CONTROLS');
  // Touch controls: 3-state cycle (auto / on / off)
  {
    const tc = vis.touchControls;
    ctx.fillStyle = 'rgba(20,20,20,0.9)';
    ctx.fillRect(rx, sy + L.touchControlsRowY, rw, rowH);
    ctx.strokeStyle = '#b39ddb';
    ctx.strokeRect(rx, sy + L.touchControlsRowY, rw, rowH);
    ctx.fillStyle = '#b39ddb';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(`Touch: ${tc}`, rx + 8, sy + L.touchControlsRowY + 15);
    const states: Array<'auto' | 'on' | 'off'> = ['auto', 'on', 'off'];
    const btnW = 22; const bGap = 2;
    const totalW = btnW * 3 + bGap * 2;
    const bx = rx + rw - totalW - 4;
    const by = sy + L.touchControlsRowY + 4;
    const bh = 14;
    for (let i = 0; i < states.length; i++) {
      const bsx = bx + i * (btnW + bGap);
      const active = tc === states[i];
      ctx.fillStyle = active ? '#b39ddb' : '#333';
      ctx.fillRect(bsx, by, btnW, bh);
      ctx.fillStyle = active ? '#000' : '#888';
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      const lbl = states[i] === 'auto' ? 'A' : states[i] === 'on' ? '1' : '0';
      ctx.fillText(lbl, bsx + btnW / 2, by + 10);
      ctx.textAlign = 'start';
    }
  }
  // Lane tap: special value-cycle row (not a simple on/off toggle)
  ctx.fillStyle = 'rgba(20,20,20,0.9)';
  ctx.fillRect(rx, sy + L.laneRowY, rw, rowH);
  ctx.strokeStyle = '#9bb7ff';
  ctx.strokeRect(rx, sy + L.laneRowY, rw, rowH);
  ctx.fillStyle = '#9bb7ff';
  ctx.font = 'bold 11px monospace';
  ctx.fillText(`Lane Tap: ${laneModeLabel(s)}`, rx + 8, sy + L.laneRowY + 15);
  drawToggle(L.feedbackRowY, 'UI Feedback', s.uiFeedbackEnabled, '#90caf9');
  drawToggle(L.cameraSnapRowY, 'Camera Snap', s.cameraSnapOnSelect, '#90caf9');
  drawToggle(L.minimapRowY, 'Minimap Pan', s.minimapPanEnabled, '#90caf9');
  drawToggle(L.stickyRowY, 'Sticky Build', s.stickyBuildMode, '#90caf9');

  // Hold delay and radial size as value-cycle rows
  ctx.fillStyle = 'rgba(20,20,20,0.9)';
  ctx.fillRect(rx, sy + L.holdDelayRowY, rw, rowH);
  ctx.strokeStyle = '#90caf9';
  ctx.strokeRect(rx, sy + L.holdDelayRowY, rw, rowH);
  ctx.fillStyle = '#90caf9';
  ctx.font = 'bold 11px monospace';
  ctx.fillText(`Hold Delay: ${s.radialArmMs}ms`, rx + 8, sy + L.holdDelayRowY + 15);

  ctx.fillStyle = 'rgba(20,20,20,0.9)';
  ctx.fillRect(rx, sy + L.radialSizeRowY, rw, rowH);
  ctx.strokeStyle = '#90caf9';
  ctx.strokeRect(rx, sy + L.radialSizeRowY, rw, rowH);
  ctx.fillStyle = '#90caf9';
  ctx.font = 'bold 11px monospace';
  ctx.fillText(`Radial Size: ${s.radialSize}`, rx + 8, sy + L.radialSizeRowY + 15);

  drawToggle(L.radialA11yRowY, 'Radial A11y', s.radialAccessibility, '#90caf9');

  // -- ACTIONS --
  drawAction(L.resetRowY, 'Reset Defaults', '#ffcc80', 'rgba(20,20,20,0.9)');
  if (deps.onConcede && L.concedeRowY >= 0) {
    drawAction(L.concedeRowY, 'Concede Match', '#ffa726', 'rgba(80,60,10,0.9)');
  }
  drawAction(L.quitRowY, 'Quit Game', '#ff5252', 'rgba(80,20,20,0.9)');
}

export function handleSettingsPanelClick(
  cx: number, cy: number,
  s: SettingsState,
  deps: SettingsPanelDeps,
): boolean {
  const L = getSettingsPanelLayout(deps);
  const { sx, sy, pw, panelH, pad, rowH } = L;
  const rx = sx + pad;
  const rw = pw - pad * 2;

  // Click outside panel -> close
  if (cx < sx || cx >= sx + pw || cy < sy || cy >= sy + panelH) {
    s.settingsOpen = false;
    s.settingsSliderDrag = null;
    deps.playSfx.playUIClose();
    return true;
  }
  // Close button
  if (cx >= sx + pw - 22 && cx < sx + pw - 6 && cy >= sy + 4 && cy < sy + 20) {
    s.settingsOpen = false;
    deps.playSfx.playUIClose();
    return true;
  }

  const inRow = (rowY: number) => cx >= rx && cx < rx + rw && cy >= sy + rowY && cy < sy + rowY + rowH;

  // Audio sliders (click sets value)
  if (inRow(L.musicRowY)) {
    const trackX = rx + 92;
    const trackW = rw - 100;
    const v = Math.max(0, Math.min(1, (cx - trackX) / trackW));
    updateAudioSettings({ musicVolume: v });
    deps.playSfx.playUISlider();
    return true;
  }
  if (inRow(L.sfxRowY)) {
    const trackX = rx + 92;
    const trackW = rw - 100;
    const v = Math.max(0, Math.min(1, (cx - trackX) / trackW));
    updateAudioSettings({ sfxVolume: v });
    deps.playSfx.playUISlider();
    return true;
  }

  // Visual toggles
  if (inRow(L.shakeRowY)) {
    const vis = getVisualSettings();
    updateVisualSettings({ screenShake: !vis.screenShake });
    deps.playSfx.playUIToggle();
    return true;
  }
  if (inRow(L.weatherRowY)) {
    const vis = getVisualSettings();
    updateVisualSettings({ weather: !vis.weather });
    deps.playSfx.playUIToggle();
    return true;
  }
  if (inRow(L.dayNightRowY)) {
    const vis = getVisualSettings();
    updateVisualSettings({ dayNight: !vis.dayNight });
    deps.playSfx.playUIToggle();
    return true;
  }

  // Controls toggles
  if (inRow(L.touchControlsRowY)) {
    const vis = getVisualSettings();
    const cycle: Record<string, 'auto' | 'on' | 'off'> = { auto: 'on', on: 'off', off: 'auto' };
    updateVisualSettings({ touchControls: cycle[vis.touchControls] });
    deps.playSfx.playUIToggle();
    return true;
  }
  if (inRow(L.laneRowY)) {
    s.laneToggleMode = s.laneToggleMode === 'double' ? 'single' : 'double';
    saveLaneMode(s);
    deps.playSfx.playUIToggle();
    return true;
  }
  if (inRow(L.feedbackRowY)) {
    s.uiFeedbackEnabled = !s.uiFeedbackEnabled;
    saveUiFeedbackEnabled(s);
    deps.playSfx.playUIToggle();
    return true;
  }
  if (inRow(L.cameraSnapRowY)) {
    s.cameraSnapOnSelect = !s.cameraSnapOnSelect;
    saveGameplaySettings(s);
    deps.playSfx.playUIToggle();
    return true;
  }
  if (inRow(L.minimapRowY)) {
    s.minimapPanEnabled = !s.minimapPanEnabled;
    saveGameplaySettings(s);
    deps.playSfx.playUIToggle();
    return true;
  }
  if (inRow(L.stickyRowY)) {
    s.stickyBuildMode = !s.stickyBuildMode;
    saveGameplaySettings(s);
    deps.playSfx.playUIToggle();
    return true;
  }
  if (inRow(L.holdDelayRowY)) {
    s.radialArmMs = s.radialArmMs >= 500 ? 240 : s.radialArmMs + 40;
    saveRadialSettings(s);
    deps.playSfx.playUIToggle();
    return true;
  }
  if (inRow(L.radialSizeRowY)) {
    s.radialSize = s.radialSize >= 110 ? 60 : s.radialSize + 8;
    saveRadialSettings(s);
    deps.playSfx.playUIToggle();
    return true;
  }
  if (inRow(L.radialA11yRowY)) {
    s.radialAccessibility = !s.radialAccessibility;
    saveRadialSettings(s);
    deps.playSfx.playUIToggle();
    return true;
  }

  // Actions
  if (inRow(L.resetRowY)) {
    resetUiDefaults(s);
    return true;
  }
  if (deps.onConcede && L.concedeRowY >= 0 && inRow(L.concedeRowY)) {
    s.settingsOpen = false;
    deps.onConcede();
    return true;
  }
  if (inRow(L.quitRowY)) {
    s.settingsOpen = false;
    deps.onQuitGame?.();
    return true;
  }

  return true; // consume click inside panel
}

export function applySettingsSlider(
  cx: number,
  L: SettingsPanelLayout,
  s: SettingsState,
  playSfx: { playUISlider: () => void },
): void {
  const rx = L.sx + L.pad;
  const rw = L.pw - L.pad * 2;
  const trackX = rx + 92;
  const trackW = rw - 100;
  const v = Math.max(0, Math.min(1, (cx - trackX) / trackW));
  if (s.settingsSliderDrag === 'music') {
    updateAudioSettings({ musicVolume: v });
    playSfx.playUISlider();
  } else if (s.settingsSliderDrag === 'sfx') {
    updateAudioSettings({ sfxVolume: v });
    playSfx.playUISlider();
  }
}
