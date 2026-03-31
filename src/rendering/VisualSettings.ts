export type TouchControlsMode = 'auto' | 'on' | 'off';

export interface VisualSettings {
  screenShake: boolean;
  weather: boolean;
  dayNight: boolean;
  damageNumbers: boolean;
  touchControls: TouchControlsMode;
}

const STORAGE_KEY = 'lanecraft.visualSettings';
const DEFAULT_SETTINGS: VisualSettings = {
  screenShake: true,
  weather: true,
  dayNight: true,
  damageNumbers: false,
  touchControls: 'auto',
};

type VisualSettingsListener = (settings: VisualSettings) => void;

function sanitizeTouchControls(v: unknown): TouchControlsMode {
  if (v === 'on' || v === 'off' || v === 'auto') return v;
  return DEFAULT_SETTINGS.touchControls;
}

function sanitize(value: Partial<VisualSettings> | null | undefined): VisualSettings {
  return {
    screenShake: value?.screenShake ?? DEFAULT_SETTINGS.screenShake,
    weather: value?.weather ?? DEFAULT_SETTINGS.weather,
    dayNight: value?.dayNight ?? DEFAULT_SETTINGS.dayNight,
    damageNumbers: value?.damageNumbers ?? DEFAULT_SETTINGS.damageNumbers,
    touchControls: sanitizeTouchControls(value?.touchControls),
  };
}

function loadStored(): VisualSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return sanitize(JSON.parse(raw) as Partial<VisualSettings>);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let current = loadStored();
const listeners = new Set<VisualSettingsListener>();

function notify(): void {
  for (const listener of listeners) listener(current);
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch { /* ignore */ }
}

export function getVisualSettings(): VisualSettings {
  return current;
}

export function updateVisualSettings(next: Partial<VisualSettings>): VisualSettings {
  current = sanitize({ ...current, ...next });
  persist();
  notify();
  return current;
}

export function subscribeToVisualSettings(listener: VisualSettingsListener): () => void {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}
