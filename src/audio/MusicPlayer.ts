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

export class MusicPlayer {
  private current: HTMLAudioElement | null = null;
  private category: MusicCategory | null = null;
  private combatRace: Race | null = null;
  private volume = 0.45;
  private fadeTarget = 1;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private settingsUnsub: (() => void);
  private lastTrackUrl = '';
  private visibilityHandler: (() => void) | null = null;
  private wasPaused = false;

  constructor() {
    this.settingsUnsub = subscribeToAudioSettings((s: AudioSettings) => {
      this.volume = s.musicVolume;
      if (this.gainNode) {
        this.gainNode.gain.value = this.volume * this.fadeTarget;
      }
    });

    // Pause music when app goes to background so browser doesn't show media controls
    this.visibilityHandler = () => {
      if (document.hidden) {
        if (this.current && !this.current.paused) {
          this.current.pause();
          this.wasPaused = true;
        }
      } else {
        if (this.wasPaused && this.current && this.category) {
          this.current.play().catch(() => {});
          this.wasPaused = false;
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
    // Avoid repeating the same track back to back
    let url = tracks[Math.floor(Math.random() * tracks.length)];
    if (url === this.lastTrackUrl) {
      url = tracks[(tracks.indexOf(url) + 1) % tracks.length];
    }
    return url;
  }

  /** Lazily create AudioContext + gain for routing music through Web Audio
   *  (prevents browser from showing media session / interrupting podcasts) */
  private ensureAudioContext(): void {
    if (this.actx) return;
    this.actx = new AudioContext();
    this.gainNode = this.actx.createGain();
    this.gainNode.connect(this.actx.destination);
  }
  private actx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;

  private startTrack(url: string): void {
    if (!url) return;
    this.lastTrackUrl = url;
    const audio = new Audio(url);
    audio.crossOrigin = 'anonymous';
    audio.volume = 1; // volume controlled via gainNode, not element
    this.current = audio;
    this.fadeTarget = 0;

    // Route through Web Audio API so browser doesn't treat it as a media session
    this.ensureAudioContext();
    if (this.actx!.state === 'suspended') void this.actx!.resume();
    // Disconnect previous source
    if (this.sourceNode) { try { this.sourceNode.disconnect(); } catch {} }
    this.sourceNode = this.actx!.createMediaElementSource(audio);
    this.sourceNode.connect(this.gainNode!);

    // When track ends, play another random track from same category
    audio.addEventListener('ended', () => {
      if (this.current !== audio) return; // stale
      this.playNextInCategory();
    });

    audio.play().catch(() => {/* user hasn't interacted yet */});
    this.fadeIn();
  }

  private playNextInCategory(): void {
    const tracks = this.getTracksForCategory();
    if (tracks.length === 0) return;
    const url = this.pickRandom(tracks);
    if (!url) return;
    // No fade-out needed — previous track already ended
    this.startTrack(url);
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
    if (!this.current) { onDone?.(); return; }
    this.fadeTarget = 0;
    const audio = this.current;
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
        audio.pause();
        audio.src = '';
        if (this.current === audio) this.current = null;
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
    // Already playing same category (and same race for combat)
    if (this.category === cat && (cat !== 'combat' || this.combatRace === race)) return;

    this.category = cat;
    this.combatRace = race ?? null;

    const tracks = this.getTracksForCategory();
    if (tracks.length === 0) {
      // No tracks available for this category — just stop
      this.fadeOut();
      return;
    }

    const url = this.pickRandom(tracks);
    if (!url) return;

    if (this.current) {
      // Crossfade: fade out old, start new
      this.fadeOut(() => this.startTrack(url));
    } else {
      this.startTrack(url);
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
