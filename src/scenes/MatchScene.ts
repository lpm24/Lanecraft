import { Scene } from './Scene';
import { Race, type MapDef } from '../simulation/types';
import { Game } from '../game/Game';
import { UIAssets } from '../rendering/UIAssets';
import { MusicPlayer } from '../audio/MusicPlayer';
import { BotDifficultyLevel } from '../simulation/BotAI';
import { DUEL_MAP } from '../simulation/maps';

export interface PartyConfig {
  /** All human players: slot index → race */
  humanPlayers: { slot: number; race: Race }[];
  /** Per-slot bot difficulty overrides. Only listed slots spawn bots. */
  slotBots?: { [slot: string]: string };
  /** Per-slot bot race. Missing = random. */
  slotBotRaces?: { [slot: string]: string };
  localSlot: number;
  seed: number;
  partyCode: string;
  botDifficulty: BotDifficultyLevel;
  mapDef: MapDef;
  /** Per-slot display names (for results screen). */
  slotNames?: { [slot: string]: string };
  fogOfWar?: boolean;
  isometric?: boolean;
}

export class MatchScene implements Scene {
  ownsLoop = true; // Game runs its own GameLoop
  private canvas: HTMLCanvasElement;
  private game: Game | null = null;
  private playerRace: Race = Race.Crown;
  private botDifficulty: BotDifficultyLevel = BotDifficultyLevel.Medium;
  private selectedMap: MapDef = DUEL_MAP;
  private fogOfWar = false;
  private partyConfig: PartyConfig | null = null;
  private ui: UIAssets;
  private musicPlayer: MusicPlayer;
  private onMatchEnd: (game: Game) => void;
  private onQuitGame: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, ui: UIAssets, musicPlayer: MusicPlayer, onMatchEnd: (game: Game) => void) {
    this.canvas = canvas;
    this.ui = ui;
    this.musicPlayer = musicPlayer;
    this.onMatchEnd = onMatchEnd;
  }

  setOnQuitGame(cb: () => void): void {
    this.onQuitGame = cb;
  }

  setNowPlaying(name: string): void {
    if (this.game) this.game.setNowPlaying(name);
  }

  setPlayerRace(race: Race, botDifficulty: BotDifficultyLevel = BotDifficultyLevel.Medium, mapDef?: MapDef, fogOfWar = false): void {
    this.playerRace = race;
    this.botDifficulty = botDifficulty;
    this.selectedMap = mapDef ?? DUEL_MAP;
    this.fogOfWar = fogOfWar;
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
        slotBotRaces: pc.slotBotRaces,
        localPlayerId: pc.localSlot,
        seed: pc.seed,
        partyCode: pc.partyCode,
        botDifficulty: pc.botDifficulty,
        mapDef: pc.mapDef,
        fogOfWar: pc.fogOfWar,
        isometric: pc.isometric,
      });
      // Pass display info for results screen
      if (pc.slotNames) this.game.slotNames = pc.slotNames;
      if (pc.slotBots) {
        for (const [slot, diff] of Object.entries(pc.slotBots)) {
          this.game.slotBotDifficulties[slot] = diff;
        }
      }
    } else {
      // Solo mode (existing behavior)
      this.game = new Game(this.canvas, this.playerRace, this.ui, undefined, this.botDifficulty, this.selectedMap, this.fogOfWar);
      // Solo: all non-player slots are medium bots
      const mapDef = this.selectedMap;
      for (let i = 0; i < mapDef.maxPlayers; i++) {
        if (i !== 0) this.game.slotBotDifficulties[String(i)] = this.botDifficulty;
      }
    }
    this.game.onMatchEnd = () => {
      if (this.game) this.onMatchEnd(this.game);
    };
    this.game.onQuitGame = () => {
      this.onQuitGame?.();
    };
    this.game.start();

    // Start race-themed combat music
    const combatRace = this.partyConfig
      ? (this.partyConfig.humanPlayers.find(h => h.slot === (this.partyConfig!.localSlot))?.race ?? Race.Crown)
      : this.playerRace;
    this.musicPlayer.playCombat(combatRace);
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
