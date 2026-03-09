import { Scene } from './Scene';
import { Race } from '../simulation/types';
import { Game } from '../game/Game';
import { UIAssets } from '../rendering/UIAssets';
import { BotDifficultyLevel } from '../simulation/BotAI';

export interface PartyConfig {
  hostRace: Race;
  guestRace: Race;
  seed: number;
  partyCode: string;
  isHost: boolean;
  botDifficulty: BotDifficultyLevel;
}

export class MatchScene implements Scene {
  ownsLoop = true; // Game runs its own GameLoop
  private canvas: HTMLCanvasElement;
  private game: Game | null = null;
  private playerRace: Race = Race.Crown;
  private botDifficulty: BotDifficultyLevel = BotDifficultyLevel.Medium;
  private partyConfig: PartyConfig | null = null;
  private ui: UIAssets;
  private onMatchEnd: (game: Game) => void;

  constructor(canvas: HTMLCanvasElement, ui: UIAssets, onMatchEnd: (game: Game) => void) {
    this.canvas = canvas;
    this.ui = ui;
    this.onMatchEnd = onMatchEnd;
  }

  setPlayerRace(race: Race, botDifficulty: BotDifficultyLevel = BotDifficultyLevel.Medium): void {
    this.playerRace = race;
    this.botDifficulty = botDifficulty;
    this.partyConfig = null; // solo mode
  }

  setPartyConfig(hostRace: Race, guestRace: Race, seed: number, partyCode: string, isHost: boolean, botDifficulty: BotDifficultyLevel = BotDifficultyLevel.Medium): void {
    this.partyConfig = { hostRace, guestRace, seed, partyCode, isHost, botDifficulty };
  }

  enter(): void {
    if (this.partyConfig) {
      // 2-player party mode: both humans on bottom team
      this.game = new Game(this.canvas, this.partyConfig.hostRace, this.ui, {
        player1Race: this.partyConfig.guestRace,
        player1Human: true,
        seed: this.partyConfig.seed,
        partyCode: this.partyConfig.partyCode,
        localPlayerId: this.partyConfig.isHost ? 0 : 1,
        botDifficulty: this.partyConfig.botDifficulty,
      });
    } else {
      // Solo mode (existing behavior)
      this.game = new Game(this.canvas, this.playerRace, this.ui, undefined, this.botDifficulty);
    }
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
