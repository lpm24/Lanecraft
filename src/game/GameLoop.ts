import { TICK_MS } from '../simulation/types';

export class GameLoop {
  private accumulator = 0;
  private lastTime = 0;
  private running = false;
  private onTick: () => boolean; // returns true if tick was consumed, false if stalled
  private onRender: () => void;

  constructor(onTick: () => boolean, onRender: () => void) {
    this.onTick = onTick;
    this.onRender = onRender;
  }

  start(): void {
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  stop(): void {
    this.running = false;
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
