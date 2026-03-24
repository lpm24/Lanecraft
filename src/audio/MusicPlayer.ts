import { Race } from '../simulation/types';
import { subscribeToAudioSettings, type AudioSettings } from './AudioSettings';

const FADE_MS = 1500;

// Discover all mp3 files at build time, keyed by relative path
const allAudio = import.meta.glob('../assets/audio/**/*.mp3', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

// Organize URLs by folder category
function collectFolder(folder: string): string[] {
  const prefix = `../assets/audio/${folder}/`;
  return Object.entries(allAudio)
    .filter(([k]) => k.startsWith(prefix))
    .map(([, url]) => url);
}

const MENU_TRACKS = collectFolder('Main Menu');
const RACE_SELECT_TRACKS = collectFolder('Character Select');

const COMBAT_TRACKS: Partial<Record<Race, string[]>> = {
  [Race.Crown]: collectFolder('CombatCrown'),
  [Race.Horde]: collectFolder('CombatHorde'),
  [Race.Goblins]: collectFolder('CombatGoblins'),
  [Race.Oozlings]: collectFolder('CombatOozlings'),
  [Race.Demon]: collectFolder('CombatDemon'),
  [Race.Deep]: collectFolder('CombatDeep'),
  [Race.Wild]: collectFolder('CombatWild'),
  [Race.Geists]: collectFolder('CombatGeists'),
  [Race.Tenders]: collectFolder('CombatTenders'),
};

type MusicCategory = 'menu' | 'raceSelect' | 'combat';

/**
 * Music player using pure Web Audio API (AudioBufferSourceNode) to stay in the
 * "ambient" audio session category on iOS. This means game music will NOT
 * interrupt podcasts, Spotify, or other background audio on mobile devices.
 *
 * HTMLAudioElement is avoided because it triggers the "playback" audio session
 * category on iOS, which pauses other apps' audio.
 */
export class MusicPlayer {
  private category: MusicCategory | null = null;
  private combatRace: Race | null = null;
  private volume = 0.45;
  private fadeTarget = 1;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private settingsUnsub: (() => void);
  private lastTrackUrl = '';
  private visibilityHandler: (() => void) | null = null;
  private wasPlaying = false;

  private actx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private bufferCache = new Map<string, AudioBuffer>();
  private playing = false;
  private stopping = false; // guards onended from firing playNext during intentional stops
  // Track the current startTrack call to discard stale loads
  private trackGeneration = 0;

  constructor() {
    this.settingsUnsub = subscribeToAudioSettings((s: AudioSettings) => {
      this.volume = s.musicVolume;
      if (this.gainNode) {
        this.gainNode.gain.value = this.volume * this.fadeTarget;
      }
    });

    // Pause music when app goes to background (saves battery, avoids lock-screen controls)
    this.visibilityHandler = () => {
      if (document.hidden) {
        if (this.playing) {
          this.suspendPlayback();
          this.wasPlaying = true;
        }
      } else {
        if (this.wasPlaying && this.category) {
          this.resumePlayback();
          this.wasPlaying = false;
        }
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  dispose(): void {
    this.stop();
    this.settingsUnsub();
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    if (this.actx) {
      this.actx.close().catch(() => {});
      this.actx = null;
      this.gainNode = null;
    }
    this.bufferCache.clear();
  }

  private getTracksForCategory(): string[] {
    switch (this.category) {
      case 'menu': return MENU_TRACKS;
      case 'raceSelect': return RACE_SELECT_TRACKS;
      case 'combat': return COMBAT_TRACKS[this.combatRace!] ?? [];
      default: return [];
    }
  }

  private pickRandom(tracks: string[]): string {
    if (tracks.length === 0) return '';
    if (tracks.length === 1) return tracks[0];
    let url = tracks[Math.floor(Math.random() * tracks.length)];
    if (url === this.lastTrackUrl) {
      url = tracks[(tracks.indexOf(url) + 1) % tracks.length];
    }
    return url;
  }

  /** Lazily create AudioContext + gain — pure Web Audio stays in ambient
   *  audio session category on iOS, so podcasts/music keep playing. */
  private ensureAudioContext(): void {
    if (this.actx) return;
    this.actx = new AudioContext();
    this.gainNode = this.actx.createGain();
    this.gainNode.connect(this.actx.destination);

    // Explicitly request ambient audio session where the API is available (Safari 16.4+)
    if ('audioSession' in navigator) {
      (navigator as any).audioSession.type = 'ambient';
    }
  }

  private async fetchBuffer(url: string): Promise<AudioBuffer> {
    const cached = this.bufferCache.get(url);
    if (cached) return cached;
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    this.ensureAudioContext();
    const audioBuffer = await this.actx!.decodeAudioData(arrayBuffer);
    this.bufferCache.set(url, audioBuffer);
    return audioBuffer;
  }

  private async startTrack(url: string): Promise<void> {
    if (!url) return;
    this.lastTrackUrl = url;
    this.fadeTarget = 0;

    this.ensureAudioContext();
    if (this.actx!.state === 'suspended') void this.actx!.resume();

    // Stop any currently playing source
    this.stopSource();

    const gen = ++this.trackGeneration;

    let buffer: AudioBuffer;
    try {
      buffer = await this.fetchBuffer(url);
    } catch {
      return; // network error — silently skip
    }

    // Discard if a newer track was requested while we were loading
    if (gen !== this.trackGeneration) return;

    const source = this.actx!.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gainNode!);

    // When track ends naturally, play another random track from same category.
    // onended also fires on stop() — the stopping flag prevents unwanted chaining.
    source.onended = () => {
      if (this.sourceNode !== source || this.stopping) return;
      this.playing = false;
      this.playNextInCategory();
    };

    source.start();
    this.sourceNode = source;
    this.playing = true;
    this.fadeIn();
  }

  private stopSource(): void {
    if (this.sourceNode) {
      this.stopping = true;
      try { this.sourceNode.stop(); } catch { /* already stopped */ }
      try { this.sourceNode.disconnect(); } catch {}
      this.sourceNode = null;
      this.stopping = false;
    }
    this.playing = false;
  }

  private suspendPlayback(): void {
    if (this.actx) void this.actx.suspend();
  }

  private resumePlayback(): void {
    if (this.actx) void this.actx.resume();
  }

  private playNextInCategory(): void {
    const tracks = this.getTracksForCategory();
    if (tracks.length === 0) return;
    const url = this.pickRandom(tracks);
    if (!url) return;
    void this.startTrack(url);
  }

  private fadeIn(): void {
    this.clearFade();
    this.fadeTarget = 1;
    const start = Date.now();
    this.fadeTimer = setInterval(() => {
      const elapsed = Date.now() - start;
      const t = Math.min(1, elapsed / FADE_MS);
      if (this.gainNode) {
        this.gainNode.gain.value = this.volume * t;
      }
      if (t >= 1) this.clearFade();
    }, 30);
  }

  private fadeOut(onDone?: () => void): void {
    this.clearFade();
    if (!this.playing) { onDone?.(); return; }
    this.fadeTarget = 0;
    const source = this.sourceNode;
    const startVol = this.gainNode?.gain.value ?? this.volume;
    const start = Date.now();
    this.fadeTimer = setInterval(() => {
      const elapsed = Date.now() - start;
      const t = Math.min(1, elapsed / FADE_MS);
      if (this.gainNode) {
        this.gainNode.gain.value = startVol * (1 - t);
      }
      if (t >= 1) {
        this.clearFade();
        if (this.sourceNode === source) {
          this.stopSource();
        }
        onDone?.();
      }
    }, 30);
  }

  private clearFade(): void {
    if (this.fadeTimer !== null) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
  }

  private switchTo(cat: MusicCategory, race?: Race): void {
    if (this.category === cat && (cat !== 'combat' || this.combatRace === race)) return;

    this.category = cat;
    this.combatRace = race ?? null;

    // Evict cached buffers not in the new category to limit memory on mobile.
    // Decoded PCM buffers are ~10x larger than compressed MP3.
    const keep = new Set(this.getTracksForCategory());
    for (const key of this.bufferCache.keys()) {
      if (!keep.has(key)) this.bufferCache.delete(key);
    }

    const tracks = this.getTracksForCategory();
    if (tracks.length === 0) {
      this.fadeOut();
      return;
    }

    const url = this.pickRandom(tracks);
    if (!url) return;

    if (this.playing) {
      this.fadeOut(() => void this.startTrack(url));
    } else {
      void this.startTrack(url);
    }
  }

  playMenu(): void {
    this.switchTo('menu');
  }

  playRaceSelect(): void {
    this.switchTo('raceSelect');
  }

  playCombat(race: Race): void {
    this.switchTo('combat', race);
  }

  stop(): void {
    this.category = null;
    this.combatRace = null;
    this.fadeOut();
  }
}
