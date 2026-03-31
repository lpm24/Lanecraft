import { GameState, GameCommand, Race, Team, MapDef, HQ_HP, TILE_SIZE, createSeededRng, MinimapFrame } from '../simulation/types';
import { createInitialState, simulateTick, computeStateHash, getHQPosition } from '../simulation/GameState';
import { DUEL_MAP } from '../simulation/maps';
import { GameLoop } from './GameLoop';
import { Renderer } from '../rendering/Renderer';
import { InputHandler } from '../ui/InputHandler';
import { SoundManager } from '../audio/SoundManager';
import { runAllBotAI, createBotContext, BotContext, BotDifficultyLevel, BOT_DIFFICULTY_PRESETS } from '../simulation/BotAI';
import { UIAssets } from '../rendering/UIAssets';
import { CommandSync, TICKS_PER_TURN } from '../network/CommandSync';
import { tileToPixel } from '../rendering/Projection';

export interface GamePartyOptions {
  /** All human players in slot order: { slotIndex, race }.
   *  Slots not listed here become bots (if in slotBots) or empty. */
  humanPlayers: { slot: number; race: Race }[];
  /** Per-slot bot difficulty overrides. Slot → BotDifficultyLevel. Only listed slots spawn bots. */
  slotBots?: { [slot: string]: string };
  /** Per-slot bot race. Slot → Race string. Missing = random. */
  slotBotRaces?: { [slot: string]: string };
  localPlayerId: number;     // this client's slot index
  seed: number;
  partyCode?: string;        // set for networked multiplayer (enables CommandSync)
  botDifficulty?: BotDifficultyLevel;
  mapDef?: MapDef;           // map to play on (default: DUEL_MAP)
  fogOfWar?: boolean;        // enable fog of war
  isometric?: boolean;       // enable isometric rendering
}

export class Game {
  state: GameState;
  private renderer: Renderer;
  private loop: GameLoop;
  private pendingCommands: GameCommand[] = [];
  private input: InputHandler;
  private sounds: SoundManager;
  onMatchEnd: (() => void) | null = null;
  onQuitGame: (() => void) | null = null;
  private matchEndTick = -1;
  private connectingInterval: ReturnType<typeof setInterval> | null = null;

  /** Compact per-second snapshots for the post-match minimap replay. */
  replayFrames: MinimapFrame[] = [];
  private readonly REPLAY_INTERVAL = 5; // 4 snapshots per second at 20 tps
  private pagehideHandler: (() => void) | null = null;

  /** Per-slot display names for the results screen. */
  slotNames: { [slot: string]: string } = {};
  /** Per-slot bot difficulty labels (absent = human). */
  slotBotDifficulties: { [slot: string]: string } = {};

  setNowPlaying(name: string): void {
    this.input.setNowPlaying(name);
  }

  private botCtx!: BotContext;

  // Multiplayer state
  private commandSync: CommandSync | null = null;
  private localPlayerId = 0;
  isMultiplayer = false;
  // Player commands collected during current turn, to be sent at next turn boundary
  private localCommandBuffer: GameCommand[] = [];
  // Pre-fetched turn commands: turnNumber → merged commands from both players
  private turnCommands: Map<number, GameCommand[]> = new Map();
  // Whether we're currently fetching commands for a turn
  private fetchingTurn: number | null = null;
  /** Set to true when state hash mismatch detected — can be read by UI for warnings. */
  desyncDetected = false;
  /** Set to true when the P2P peer disconnects mid-game. */
  peerDisconnected = false;
  /** How long (ms) we've been stalled waiting for the remote player's turn data. 0 = not stalled. */
  waitingForAllyMs = 0;
  private stallStartTime = 0;

  /** Current round-trip latency in ms (0 for solo). */
  get networkLatencyMs(): number { return this.commandSync?.latencyMs ?? 0; }

  constructor(canvas: HTMLCanvasElement, playerRace: Race = Race.Crown, ui?: UIAssets, partyOpts?: GamePartyOptions, soloDifficulty?: BotDifficultyLevel, soloMapDef?: MapDef, soloFogOfWar = false) {
    const mapDef = partyOpts?.mapDef ?? soloMapDef ?? DUEL_MAP;
    const fogOfWar = partyOpts?.fogOfWar ?? soloFogOfWar;
    // Pick bot races: fill remaining slots from races other than player's
    const allRaces = [Race.Crown, Race.Horde, Race.Goblins, Race.Oozlings, Race.Demon, Race.Deep, Race.Wild, Race.Geists, Race.Tenders];

    if (partyOpts) {
      // Party mode: build player list from human slots + bot fillers
      // Only slots in humanPlayers or slotBots are occupied; others are empty (inactive).
      const shuffleRng = createSeededRng(partyOpts.seed);
      const humanSlotMap = new Map(partyOpts.humanPlayers.map(h => [h.slot, h.race]));
      const botSlots = partyOpts.slotBots ?? {};
      const botRaceChoices = partyOpts.slotBotRaces ?? {};

      // Collect all pre-chosen races (human + bots with specific race) to avoid duplicates
      const usedRaces = new Set<Race>(partyOpts.humanPlayers.map(h => h.race));
      for (const [slot, raceStr] of Object.entries(botRaceChoices)) {
        if (botSlots[slot] && raceStr !== 'random' && allRaces.includes(raceStr as Race)) {
          usedRaces.add(raceStr as Race);
        }
      }

      // Shuffle remaining races for random assignment (fall back to all if every race is taken)
      let otherRaces = allRaces.filter(r => !usedRaces.has(r));
      if (otherRaces.length === 0) otherRaces = [...allRaces];
      for (let i = otherRaces.length - 1; i > 0; i--) {
        const j = Math.floor(shuffleRng() * (i + 1));
        [otherRaces[i], otherRaces[j]] = [otherRaces[j], otherRaces[i]];
      }
      let botIdx = 0;
      const players: { race: Race; isBot: boolean; isEmpty: boolean }[] = [];
      for (let i = 0; i < mapDef.maxPlayers; i++) {
        const humanRace = humanSlotMap.get(i);
        if (humanRace !== undefined) {
          players.push({ race: humanRace, isBot: false, isEmpty: false });
        } else if (botSlots[String(i)]) {
          // Bot with chosen or random race
          const chosenRace = botRaceChoices[String(i)];
          if (chosenRace && chosenRace !== 'random' && allRaces.includes(chosenRace as Race)) {
            players.push({ race: chosenRace as Race, isBot: true, isEmpty: false });
          } else {
            players.push({ race: otherRaces[botIdx++ % otherRaces.length], isBot: true, isEmpty: false });
          }
        } else {
          // Empty slot — no buildings, no income, no AI
          players.push({ race: otherRaces[botIdx++ % otherRaces.length], isBot: false, isEmpty: true });
        }
      }
      this.state = createInitialState(players, partyOpts.seed, mapDef, fogOfWar);
    } else {
      // Solo mode: P0 human, rest are bots
      const otherRaces = allRaces.filter(r => r !== playerRace);
      for (let i = otherRaces.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [otherRaces[i], otherRaces[j]] = [otherRaces[j], otherRaces[i]];
      }
      const players: { race: Race; isBot: boolean; isEmpty: boolean }[] = [
        { race: playerRace, isBot: false, isEmpty: false },  // P0 - human
      ];
      // Fill remaining slots with bots
      for (let i = 1; i < mapDef.maxPlayers; i++) {
        players.push({ race: otherRaces[i - 1], isBot: true, isEmpty: false });
      }
      this.state = createInitialState(players, undefined, mapDef, fogOfWar);
    }

    // Set up bot difficulty (global default + per-slot overrides)
    this.botCtx = createBotContext(partyOpts?.botDifficulty ?? soloDifficulty ?? BotDifficultyLevel.Medium);
    if (partyOpts?.slotBots) {
      for (const [slot, diff] of Object.entries(partyOpts.slotBots)) {
        const preset = BOT_DIFFICULTY_PRESETS[diff as BotDifficultyLevel];
        if (preset) this.botCtx.difficulty[Number(slot)] = preset;
      }
    }

    // Apply stat bonuses from bot difficulty to player state
    for (const p of this.state.players) {
      if (!p.isBot || p.isEmpty) continue;
      const diff = this.botCtx.difficulty[p.id] ?? this.botCtx.defaultDifficulty;
      if (diff.statBonus && diff.statBonus !== 1) p.statBonus = diff.statBonus;
    }

    // Set local player ID for party mode (even local games)
    if (partyOpts) {
      this.localPlayerId = partyOpts.localPlayerId;
    }

    // Set up multiplayer command sync if party code provided (non-empty)
    if (partyOpts?.partyCode) {
      this.isMultiplayer = true;
      const humanSlotIds = partyOpts.humanPlayers.map(h => h.slot);
      this.commandSync = new CommandSync(partyOpts.partyCode, this.localPlayerId, humanSlotIds);
      this.commandSync.onDesync = (turn, local, remote) => {
        console.error(`[DESYNC] turn ${turn}: local=${local.toString(16)} remote=${remote.toString(16)}`);
        this.desyncDetected = true;
      };
      this.commandSync.onDisconnect = () => {
        this.peerDisconnected = true;
        console.warn('[Game] Peer disconnected');
      };
      // Player leave is handled deterministically at turn boundaries via leftSlotQueue
      this.commandSync.onPlayerLeft = null;
      this.commandSync.start();
      this.commandSync.listenForLeaves();
    }

    this.renderer = new Renderer(canvas, ui);
    this.renderer.localPlayerId = this.localPlayerId;
    this.renderer.isometric = partyOpts?.isometric ?? false;
    // Set camera world size for non-default maps
    this.renderer.camera.worldTilesW = mapDef.width;
    this.renderer.camera.worldTilesH = mapDef.height;
    this.renderer.camera.isometric = this.renderer.isometric;
    this.input = new InputHandler(this, canvas, this.renderer.camera, ui, this.renderer.sprites);
    this.input.onQuitGame = () => this.handleQuitGame();
    this.input.onConcede = () => this.handleConcede();
    this.sounds = new SoundManager();

    // Center camera on local player's HQ at game start
    const localTeam = this.state.players[this.localPlayerId]?.team ?? Team.Bottom;
    const hqPos = getHQPosition(localTeam, mapDef);
    const T = TILE_SIZE;
    if (this.renderer.isometric) {
      const { px, py } = tileToPixel(hqPos.x + 4, hqPos.y + 3, true);
      this.renderer.camera.x = px - canvas.clientWidth / (2 * this.renderer.camera.zoom);
      this.renderer.camera.y = py - canvas.clientHeight / (2 * this.renderer.camera.zoom);
    } else {
      this.renderer.camera.x = hqPos.x * T - canvas.clientWidth / (2 * this.renderer.camera.zoom) + 4 * T;
      this.renderer.camera.y = hqPos.y * T - canvas.clientHeight / (2 * this.renderer.camera.zoom) + 3 * T;
    }

    this.loop = new GameLoop(
      () => this.tick(),
      () => this.render(),
    );

    // Pause/resume Firebase connection on app background/foreground
    if (this.commandSync) {
      const cs = this.commandSync;
      this.loop.onPause = () => cs.pause();
      this.loop.onResume = () => cs.resume();
    }

    // Broadcast leave on page close/navigation (more reliable than beforeunload on iOS)
    if (this.commandSync) {
      this.pagehideHandler = () => {
        if (this.commandSync) {
          this.commandSync.broadcastLeave();
          this.commandSync.stop();
        }
      };
      window.addEventListener('pagehide', this.pagehideHandler);
    }

    // Use local player's race for music theme
    const musicRace = partyOpts
      ? (partyOpts.humanPlayers.find(h => h.slot === this.localPlayerId)?.race ?? playerRace)
      : playerRace;
    this.sounds.startMusic(musicRace);
  }

  /** Which player slot the local user controls (0 = host/solo, 1 = guest). */
  get playerSlot(): number { return this.localPlayerId; }

  start(): void {
    if (this.isMultiplayer && this.commandSync) {
      // Show "Connecting..." while waiting for handshake, refresh periodically
      this.waitingForAllyMs = 1;
      this.drawConnectingScreen();
      this.connectingInterval = setInterval(() => this.drawConnectingScreen(), 500);
      // Wait for P2P connection + handshake before starting game loop
      this.commandSync.whenReady().then(() => {
        if (this.connectingInterval) { clearInterval(this.connectingInterval); this.connectingInterval = null; }
        this.waitingForAllyMs = 0;
        // Pre-seed turn 0 so the first tick doesn't stall
        this.turnCommands.set(0, []);
        this.loop.start();
      }).catch((err) => {
        if (this.connectingInterval) { clearInterval(this.connectingInterval); this.connectingInterval = null; }
        console.error('[Game] P2P connection failed:', err);
        this.peerDisconnected = true;
        this.waitingForAllyMs = 0;
        // Start loop anyway so the disconnect warning renders
        this.loop.start();
      });
    } else {
      this.loop.start();
    }
  }

  /** Draw a simple connecting screen before the game loop starts. */
  private drawConnectingScreen(): void {
    const canvas = this.renderer.canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, w, h);
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffd740';
    ctx.fillText('Connecting to opponent...', w / 2, h / 2);
    // Show sync status for debugging
    const status = this.commandSync?.status ?? 'no sync';
    ctx.font = '14px monospace';
    ctx.fillStyle = '#888';
    ctx.fillText(status, w / 2, h / 2 + 36);
  }

  stop(): void {
    if (this.connectingInterval) { clearInterval(this.connectingInterval); this.connectingInterval = null; }
    this.loop.stop();
    this.sounds.stopWeatherAudio();
    this.sounds.dispose();
    this.input.destroy();
    this.renderer.destroy();
    this.renderer.camera.destroy();
    if (this.pagehideHandler) {
      window.removeEventListener('pagehide', this.pagehideHandler);
      this.pagehideHandler = null;
    }
    if (this.commandSync) {
      // Only delete game data if match ended naturally (not mid-game quit)
      if (this.state.matchPhase === 'ended') {
        this.commandSync.cleanup();
      }
      this.commandSync.stop();
      this.commandSync = null;
    }
  }

  private handleQuitGame(): void {
    if (this.isMultiplayer && this.commandSync) {
      // Broadcast leave so remaining players can replace us with a bot
      this.commandSync.broadcastLeave();
    }
    this.onQuitGame?.();
  }

  /** Concede the match — enemy team wins immediately. */
  private handleConcede(): void {
    if (this.state.matchPhase === 'ended') return;

    if (this.isMultiplayer && this.commandSync) {
      // Multiplayer: broadcast leave so peers know we conceded, then force-end locally
      this.commandSync.broadcastLeave();
      const localTeam = this.state.players[this.localPlayerId]?.team ?? Team.Bottom;
      const enemyTeam = localTeam === Team.Bottom ? Team.Top : Team.Bottom;
      this.state.winner = enemyTeam;
      this.state.winCondition = 'military';
      this.state.matchPhase = 'ended';
      this.state.soundEvents.push({ type: 'match_end_lose' });
    } else {
      // Solo: send concede command through simulation
      this.sendCommand({ type: 'concede', playerId: this.localPlayerId });
    }
  }

  /** Convert a human player slot to a Nightmare-difficulty bot mid-game. */
  private convertPlayerToBot(slotId: number): void {
    const player = this.state.players[slotId];
    if (!player || player.isBot) return;
    player.isBot = true;
    // Set Nightmare difficulty for the replacement bot
    const preset = BOT_DIFFICULTY_PRESETS[BotDifficultyLevel.Nightmare];
    if (preset) this.botCtx.difficulty[slotId] = preset;
  }

  sendCommand(cmd: GameCommand): void {
    if (this.isMultiplayer) {
      // Buffer player commands — will be sent at the next turn boundary
      this.localCommandBuffer.push(cmd);
    } else {
      this.pendingCommands.push(cmd);
    }
  }

  /** Returns true if a tick was consumed, false if stalled (waiting for network). */
  private tick(): boolean {
    if (this.isMultiplayer) {
      return this.tickMultiplayer();
    } else {
      this.tickLocal();
      return true;
    }
  }

  private tickLocal(): void {
    this.runBotAI();
    simulateTick(this.state, this.pendingCommands);
    this.pendingCommands = [];
    if (this.state.tick % this.REPLAY_INTERVAL === 0) this.captureReplayFrame();
    this.postTick();
  }

  private tickMultiplayer(): boolean {
    if (!this.commandSync) return true;

    // If peer disconnected, keep ticking locally so game doesn't freeze
    if (this.peerDisconnected) {
      // Drain any buffered local commands since fetchTurn won't consume them
      if (this.localCommandBuffer.length > 0) {
        this.pendingCommands.push(...this.localCommandBuffer);
        this.localCommandBuffer = [];
      }
      // Bot AI direct to pendingCommands (same as normal multiplayer tick)
      runAllBotAI(this.state, this.botCtx, (cmd) => this.pendingCommands.push(cmd));
      simulateTick(this.state, this.pendingCommands);
      this.pendingCommands = [];
      if (this.state.tick % this.REPLAY_INTERVAL === 0) this.captureReplayFrame();
      this.postTick();
      return true;
    }

    const currentTick = this.state.tick;
    const currentTurn = Math.floor(currentTick / TICKS_PER_TURN);
    const isFirstTickOfTurn = currentTick % TICKS_PER_TURN === 0;

    // At turn boundary: check if we have commands for this turn
    if (isFirstTickOfTurn && !this.turnCommands.has(currentTurn)) {
      // Stall — start fetching if not already
      if (this.fetchingTurn !== currentTurn) {
        this.fetchTurn(currentTurn);
      }
      // Track how long we've been stalled (stallStartTime=0 means first stall frame)
      if (this.stallStartTime === 0) {
        this.stallStartTime = Date.now();
      }
      this.waitingForAllyMs = Date.now() - this.stallStartTime;
      return false; // Signal GameLoop to stop draining accumulator
    }

    // Clear stall indicator when we resume
    if (this.waitingForAllyMs > 0) {
      this.waitingForAllyMs = 0;
      this.stallStartTime = 0;
    }

    // Execute this tick
    const turnCmds = this.turnCommands.get(currentTurn) ?? [];

    // Apply player commands only on first tick of turn
    if (isFirstTickOfTurn) {
      this.pendingCommands.push(...turnCmds);
      // Drain leave queue deterministically at turn boundary (both clients are synced here)
      if (this.commandSync && this.commandSync.leftSlotQueue.length > 0) {
        for (const slotId of this.commandSync.leftSlotQueue) {
          this.convertPlayerToBot(slotId);
        }
        this.commandSync.leftSlotQueue = [];
      }
      // Eagerly subscribe to next turns' remote data NOW — gives ~200-400ms for it to arrive
      // (we'll push OUR commands later on last tick, but remote data can arrive early)
      if (this.commandSync) {
        this.commandSync.subscribeToTurn(currentTurn + 1);
        this.commandSync.subscribeToTurn(currentTurn + 2);
      }
    }

    // Bot AI runs deterministically on both clients (same seeded RNG state)
    // Pushed directly to pendingCommands, NOT through sendCommand/network
    runAllBotAI(this.state, this.botCtx, (cmd) => this.pendingCommands.push(cmd));

    simulateTick(this.state, this.pendingCommands);
    this.pendingCommands = [];
    if (this.state.tick % this.REPLAY_INTERVAL === 0) this.captureReplayFrame();
    this.postTick();

    // On last tick of turn: push our commands and clean up
    const isLastTickOfTurn = currentTick % TICKS_PER_TURN === TICKS_PER_TURN - 1;
    if (isLastTickOfTurn) {
      this.turnCommands.delete(currentTurn);
      // Push local commands for next turn (remote subscription already active from first tick)
      const nextTurn = currentTurn + 1;
      if (!this.turnCommands.has(nextTurn) && this.fetchingTurn !== nextTurn) {
        this.fetchTurn(nextTurn);
      }
    }
    return true;
  }

  /** Push local commands and wait for both players' commands for a turn. */
  private fetchTurn(turn: number): void {
    if (!this.commandSync) return;
    this.fetchingTurn = turn;

    // Flush local command buffer — these are the player commands for this turn
    const cmds = [...this.localCommandBuffer];
    this.localCommandBuffer = [];

    // Compute state hash at turn boundary for desync detection
    let hash: number | undefined;
    if (this.commandSync.shouldSendHash(turn)) {
      hash = computeStateHash(this.state);
    }

    // Push local data (fire-and-forget write) and wait for remote in parallel
    this.commandSync.pushTurn(turn, cmds, hash);
    this.commandSync.waitForTurn(turn).then(({ commands, remoteHash }) => {
      this.turnCommands.set(turn, commands);
      this.fetchingTurn = null;

      // Desync check: compare hashes if both sides sent one
      if (hash !== undefined && remoteHash !== undefined && hash !== remoteHash) {
        this.commandSync!.onDesync?.(turn, hash, remoteHash);
      }
    }).catch((err) => {
      console.error('[CommandSync] fetch failed:', err);
      this.fetchingTurn = null;
      // On failure, set empty commands so game doesn't freeze forever
      this.turnCommands.set(turn, []);
    });
  }

  private captureReplayFrame(): void {
    const s = this.state;
    const d = s.diamond;

    // Top-kill unit per player — war hero candidate while alive
    const topKillers = new Map<number, { x: number; y: number; playerId: number; kills: number }>();
    for (const u of s.units) {
      if (u.kills > 0) {
        const cur = topKillers.get(u.playerId);
        if (!cur || u.kills > cur.kills) {
          topKillers.set(u.playerId, { x: u.x, y: u.y, playerId: u.playerId, kills: u.kills });
        }
      }
    }

    this.replayFrames.push({
      tick: s.tick,
      units: s.units.map(u => ({ x: u.x, y: u.y, playerId: u.playerId, team: u.team })),
      hqHp: [s.hqHp[0], s.hqHp[1]],
      diamond: d ? { x: d.x, y: d.y, carried: d.carrierId !== null } : null,
      nukes: s.nukeTelegraphs.map(t => ({ x: t.x, y: t.y, radius: t.radius, playerId: t.playerId })),
      warHeroPositions: [...topKillers.values()].map(({ x, y, playerId }) => ({ x, y, playerId })),
      playerStats: s.players.map((_, pid) => {
        const ps = s.playerStats[pid];
        return ps
          ? { goldEarned: ps.totalGoldEarned, woodEarned: ps.totalWoodEarned,
              meatEarned: ps.totalMeatEarned, damageDealt: ps.totalDamageDealt }
          : { goldEarned: 0, woodEarned: 0, meatEarned: 0, damageDealt: 0 };
      }),
    });
  }

  private postTick(): void {
    // Play sounds emitted during this tick
    for (const ev of this.state.soundEvents) {
      this.sounds.play(ev, this.renderer.camera, this.renderer.canvas);
    }
    // Evaluate music intensity
    const myTeam = this.state.players[this.localPlayerId]?.team ?? Team.Bottom;
    const ownHqHpRatio = this.state.hqHp[myTeam] / HQ_HP;
    if (ownHqHpRatio < 0.3) {
      this.sounds.setIntensity(2);
    } else if (this.state.units.some(u => u.targetId !== null)) {
      this.sounds.setIntensity(1);
    } else {
      this.sounds.setIntensity(0);
    }

    // Check for match end — delay 3 seconds so player can see the final moment
    if (this.state.matchPhase === 'ended') {
      if (this.matchEndTick < 0) this.matchEndTick = this.state.tick;
      if (this.onMatchEnd && this.state.tick - this.matchEndTick >= 60) { // 3s at 20tps
        this.onMatchEnd();
        this.onMatchEnd = null;
      }
    }
  }

  private render(): void {
    this.input.updateCameraFollow();
    this.renderer.camera.tick();
    this.renderer.placingBuilding = this.input.placingBuilding;
    const latencyMs = this.isMultiplayer ? this.networkLatencyMs : undefined;
    this.renderer.render(this.state, latencyMs, this.desyncDetected, this.peerDisconnected, this.waitingForAllyMs);
    // Update weather ambient audio
    const w = this.renderer.weather;
    this.sounds.updateWeatherAudio(w.type, w.lightningFlash, w.windStrength);
    this.input.render(this.renderer, latencyMs);
  }

  private runBotAI(): void {
    runAllBotAI(this.state, this.botCtx, (cmd) => this.sendCommand(cmd));
  }
}
