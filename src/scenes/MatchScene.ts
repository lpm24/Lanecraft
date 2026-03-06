import { Scene } from './Scene';
import { Race } from '../simulation/types';
import { Game } from '../game/Game';

export class MatchScene implements Scene {
  ownsLoop = true; // Game runs its own GameLoop
  private canvas: HTMLCanvasElement;
  private game: Game | null = null;
  private playerRace: Race = Race.Surge;
  private onMatchEnd: (game: Game) => void;

  constructor(canvas: HTMLCanvasElement, onMatchEnd: (game: Game) => void) {
    this.canvas = canvas;
    this.onMatchEnd = onMatchEnd;
  }

  setPlayerRace(race: Race): void {
    this.playerRace = race;
  }

  enter(): void {
    this.game = new Game(this.canvas, this.playerRace);
    this.game.onMatchEnd = () => {
      if (this.game) this.onMatchEnd(this.game);
    };
    this.game.start();
  }

  exit(): void {
    if (this.game) {
      this.game.stop();
      this.game = null;
    }
  }

  update(_dt: number): void {
    // Game runs its own loop — nothing needed here
  }

  render(_ctx: CanvasRenderingContext2D): void {
    // Game renders itself via its own loop
  }
}
