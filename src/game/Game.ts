import { GameState, GameCommand, Race, HQ_HP } from '../simulation/types';
import { createInitialState, simulateTick } from '../simulation/GameState';
import { GameLoop } from './GameLoop';
import { Renderer } from '../rendering/Renderer';
import { InputHandler } from '../ui/InputHandler';
import { SoundManager } from '../audio/SoundManager';
import { runAllBotAI, createBotContext, BotContext } from '../simulation/BotAI';

export class Game {
  state: GameState;
  private renderer: Renderer;
  private loop: GameLoop;
  private pendingCommands: GameCommand[] = [];
  private input: InputHandler;
  private sounds: SoundManager;
  onMatchEnd: (() => void) | null = null;
  private matchEndTick = 0;

  private botCtx: BotContext = createBotContext();

  constructor(canvas: HTMLCanvasElement, playerRace: Race = Race.Surge) {
    // Pick bot races: fill remaining 3 slots from races other than player's
    const allRaces = [Race.Surge, Race.Tide, Race.Ember, Race.Bastion, Race.Shade, Race.Thorn];
    const otherRaces = allRaces.filter(r => r !== playerRace);
    // Shuffle to get variety
    for (let i = otherRaces.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [otherRaces[i], otherRaces[j]] = [otherRaces[j], otherRaces[i]];
    }
    // Teammate gets first other race, enemies get next two
    this.state = createInitialState([
      { race: playerRace, isBot: false },          // P0 - human
      { race: otherRaces[0], isBot: true },        // P1 - bot teammate
      { race: otherRaces[1], isBot: true },        // P2 - bot enemy
      { race: otherRaces[2], isBot: true },        // P3 - bot enemy
    ]);

    this.renderer = new Renderer(canvas);
    this.input = new InputHandler(this, canvas, this.renderer.camera);
    this.sounds = new SoundManager();

    this.loop = new GameLoop(
      () => this.tick(),
      () => this.render(),
    );

    this.sounds.startMusic();
  }

  start(): void {
    this.loop.start();
  }

  stop(): void {
    this.loop.stop();
    this.sounds.stopMusic();
    this.input.destroy();
    this.renderer.camera.destroy();
  }

  sendCommand(cmd: GameCommand): void {
    this.pendingCommands.push(cmd);
  }

  private tick(): void {
    this.runBotAI();
    simulateTick(this.state, this.pendingCommands);
    this.pendingCommands = [];
    // Play sounds emitted during this tick
    for (const ev of this.state.soundEvents) {
      this.sounds.play(ev, this.renderer.camera, this.renderer.canvas);
    }
    // Evaluate music intensity
    const ownHqHpRatio = this.state.hqHp[0] / HQ_HP; // team Bottom = human
    if (ownHqHpRatio < 0.3) {
      this.sounds.setIntensity(2);
    } else if (this.state.units.some(u => u.targetId !== null)) {
      this.sounds.setIntensity(1);
    } else {
      this.sounds.setIntensity(0);
    }

    // Check for match end — delay 3 seconds so player can see the final moment
    if (this.state.matchPhase === 'ended') {
      if (this.matchEndTick === 0) this.matchEndTick = this.state.tick;
      if (this.onMatchEnd && this.state.tick - this.matchEndTick >= 60) { // 3s at 20tps
        this.onMatchEnd();
        this.onMatchEnd = null;
      }
    }
  }

  private render(): void {
    this.renderer.camera.tick();
    this.renderer.render(this.state);
    this.input.render(this.renderer);
  }

  private runBotAI(): void {
    runAllBotAI(this.state, this.botCtx, (cmd) => this.sendCommand(cmd));
  }
}
