import { Scene } from './Scene';
import { Race, type MapDef } from '../simulation/types';
import { Game } from '../game/Game';
import { UIAssets } from '../rendering/UIAssets';
import { BotDifficultyLevel } from '../simulation/BotAI';
import { DUEL_MAP } from '../simulation/maps';

export interface PartyConfig {
  /** All human players: slot index → race */
  humanPlayers: { slot: number; race: Race }[];
  /** Per-slot bot difficulty overrides */
  slotBots?: { [slot: string]: string };
  localSlot: number;
  seed: number;
  partyCode: string;
  botDifficulty: BotDifficultyLevel;
  mapDef: MapDef;
}

export class MatchScene implements Scene {
  ownsLoop = true; // Game runs its own GameLoop
  private canvas: HTMLCanvasElement;
  private game: Game | null = null;
  private playerRace: Race = Race.Crown;
  private botDifficulty: BotDifficultyLevel = BotDifficultyLevel.Medium;
  private selectedMap: MapDef = DUEL_MAP;
  private partyConfig: PartyConfig | null = null;
  private ui: UIAssets;
  private onMatchEnd: (game: Game) => void;

  constructor(canvas: HTMLCanvasElement, ui: UIAssets, onMatchEnd: (game: Game) => void) {
    this.canvas = canvas;
    this.ui = ui;
    this.onMatchEnd = onMatchEnd;
  }

  setPlayerRace(race: Race, botDifficulty: BotDifficultyLevel = BotDifficultyLevel.Medium, mapDef?: MapDef): void {
    this.playerRace = race;
    this.botDifficulty = botDifficulty;
    this.selectedMap = mapDef ?? DUEL_MAP;
    this.partyConfig = null; // solo mode
  }

  setPartyConfig(config: PartyConfig): void {
    this.partyConfig = config;
  }

  enter(): void {
    if (this.partyConfig) {
      const pc = this.partyConfig;
      this.game = new Game(this.canvas, pc.humanPlayers[0]?.race ?? Race.Crown, this.ui, {
        humanPlayers: pc.humanPlayers,
        slotBots: pc.slotBots,
        localPlayerId: pc.localSlot,
        seed: pc.seed,
        partyCode: pc.partyCode,
        botDifficulty: pc.botDifficulty,
        mapDef: pc.mapDef,
      });
    } else {
      // Solo mode (existing behavior)
      this.game = new Game(this.canvas, this.playerRace, this.ui, undefined, this.botDifficulty, this.selectedMap);
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
