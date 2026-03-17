import { TICK_MS } from '../simulation/types';
import { Capacitor } from '@capacitor/core';

export class GameLoop {
  private accumulator = 0;
  private lastTime = 0;
  private running = false;
  private onTick: () => boolean; // returns true if tick was consumed, false if stalled
  private onRender: () => void;

  /** Fired when the app is backgrounded (iOS/Android) or the tab is hidden. */
  onPause: (() => void) | null = null;
  /** Fired when the app is foregrounded or the tab becomes visible. */
  onResume: (() => void) | null = null;

  /** True when the app/tab is in the background. */
  paused = false;

  private appPauseCleanup: (() => void) | null = null;
  private appResumeCleanup: (() => void) | null = null;

  constructor(onTick: () => boolean, onRender: () => void) {
    this.onTick = onTick;
    this.onRender = onRender;
  }

  private visibilityHandler = (): void => {
    if (document.hidden) {
      this.handlePause();
    } else {
      this.handleResume();
    }
  };

  private handlePause(): void {
    if (this.paused) return;
    this.paused = true;
    this.onPause?.();
  }

  private handleResume(): void {
    if (!this.paused) return;
    this.paused = false;
    // Reset timing so we don't try to catch up
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.onResume?.();
  }

  start(): void {
    this.running = true;
    this.lastTime = performance.now();
    document.addEventListener('visibilitychange', this.visibilityHandler);

    // Capacitor native lifecycle (more reliable than visibilitychange on iOS)
    if (Capacitor.isNativePlatform()) {
      import('@capacitor/app').then(({ App }) => {
        App.addListener('pause', () => this.handlePause()).then(handle => {
          this.appPauseCleanup = () => handle.remove();
        });
        App.addListener('resume', () => this.handleResume()).then(handle => {
          this.appResumeCleanup = () => handle.remove();
        });
      }).catch(() => {
        // @capacitor/app not installed — fall back to visibilitychange only
      });
    }

    requestAnimationFrame((t) => this.loop(t));
  }

  stop(): void {
    this.running = false;
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.appPauseCleanup?.();
    this.appResumeCleanup?.();
    this.appPauseCleanup = null;
    this.appResumeCleanup = null;
  }

  private loop(time: number): void {
    if (!this.running) return;

    const dt = time - this.lastTime;
    this.lastTime = time;

    // Cap delta to avoid spiral of death
    this.accumulator += Math.min(dt, 200);

    // Fixed timestep simulation
    while (this.accumulator >= TICK_MS) {
      const consumed = this.onTick();
      if (!consumed) {
        // Tick stalled (waiting for network) — don't drain accumulator,
        // cap it so we don't build up unbounded debt
        this.accumulator = Math.min(this.accumulator, TICK_MS * 8);
        break;
      }
      this.accumulator -= TICK_MS;
    }

    // Render every frame
    this.onRender();

    requestAnimationFrame((t) => this.loop(t));
  }
}
