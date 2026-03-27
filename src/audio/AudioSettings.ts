export interface AudioSettings {
  musicVolume: number;
  sfxVolume: number;
}

const STORAGE_KEY = 'lanecraft.audioSettings';
const DEFAULT_SETTINGS: AudioSettings = {
  musicVolume: 0.2,
  sfxVolume: 0.5,
};

type AudioSettingsListener = (settings: AudioSettings) => void;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function sanitizeSettings(value: Partial<AudioSettings> | null | undefined): AudioSettings {
  return {
    musicVolume: clamp01(value?.musicVolume ?? DEFAULT_SETTINGS.musicVolume),
    sfxVolume: clamp01(value?.sfxVolume ?? DEFAULT_SETTINGS.sfxVolume),
  };
}

function loadStoredSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return sanitizeSettings(JSON.parse(raw) as Partial<AudioSettings>);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let currentSettings = loadStoredSettings();
const listeners = new Set<AudioSettingsListener>();

function notify(): void {
  for (const listener of listeners) listener(currentSettings);
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentSettings));
  } catch {
    // Ignore storage failures so audio still works in restricted environments.
  }
}

export function getAudioSettings(): AudioSettings {
  return currentSettings;
}

export function updateAudioSettings(next: Partial<AudioSettings>): AudioSettings {
  currentSettings = sanitizeSettings({ ...currentSettings, ...next });
  persist();
  notify();
  return currentSettings;
}

export function subscribeToAudioSettings(listener: AudioSettingsListener): () => void {
  listeners.add(listener);
  listener(currentSettings);
  return () => listeners.delete(listener);
}
