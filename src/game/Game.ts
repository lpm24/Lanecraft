import {
  GameState, GameCommand, Race, BuildingType, Lane, Team,
  BUILD_GRID_COLS, BUILD_GRID_ROWS, HarvesterAssignment, HQ_HP,
  SHARED_ALLEY_COLS, SHARED_ALLEY_ROWS,
} from '../simulation/types';
import { createInitialState, simulateTick } from '../simulation/GameState';
import { BUILDING_COSTS, HARVESTER_HUT_COST, UPGRADE_COSTS } from '../simulation/data';
import { GameLoop } from './GameLoop';
import { Renderer } from '../rendering/Renderer';
import { InputHandler } from '../ui/InputHandler';
import { SoundManager } from '../audio/SoundManager';

// --- Bot personality profiles per race ---
interface RaceProfile {
  // Build-order targets per phase
  earlyMelee: number;
  earlyRanged: number;
  earlyHuts: number;
  earlyTowers: number;
  midMelee: number;
  midRanged: number;
  midCasters: number;
  midTowers: number;
  midHuts: number;
  lateTowers: number;   // base grid towers
  alleyTowers: number;  // target alley towers in mid/late
  // Upgrade preference: 'B' = tanky/damage path, 'C' = speed/utility path
  meleeUpgradeBias: 'B' | 'C';
  rangedUpgradeBias: 'B' | 'C';
  casterUpgradeBias: 'B' | 'C';
  towerUpgradeBias: 'B' | 'C';
}

const RACE_PROFILES: Record<Race, RaceProfile> = {
  // Surge: aggressive, more ranged/melee early, speed upgrades
  [Race.Surge]: {
    earlyMelee: 1, earlyRanged: 1, earlyHuts: 2, earlyTowers: 0,
    midMelee: 2, midRanged: 2, midCasters: 1, midTowers: 1, midHuts: 3,
    lateTowers: 2, alleyTowers: 2,
    meleeUpgradeBias: 'C', rangedUpgradeBias: 'C', casterUpgradeBias: 'C', towerUpgradeBias: 'C',
  },
  // Tide: defensive, more towers/huts early, control upgrades
  [Race.Tide]: {
    earlyMelee: 1, earlyRanged: 0, earlyHuts: 2, earlyTowers: 1,
    midMelee: 2, midRanged: 1, midCasters: 1, midTowers: 2, midHuts: 4,
    lateTowers: 2, alleyTowers: 3,
    meleeUpgradeBias: 'B', rangedUpgradeBias: 'C', casterUpgradeBias: 'C', towerUpgradeBias: 'C',
  },
  // Ember: burst, rushes casters after melee frontline, damage upgrades
  [Race.Ember]: {
    earlyMelee: 2, earlyRanged: 0, earlyHuts: 1, earlyTowers: 0,
    midMelee: 2, midRanged: 1, midCasters: 2, midTowers: 1, midHuts: 3,
    lateTowers: 1, alleyTowers: 2,
    meleeUpgradeBias: 'C', rangedUpgradeBias: 'B', casterUpgradeBias: 'B', towerUpgradeBias: 'B',
  },
  // Bastion: tanky, melee-heavy with caster shields, durability upgrades
  [Race.Bastion]: {
    earlyMelee: 2, earlyRanged: 0, earlyHuts: 2, earlyTowers: 0,
    midMelee: 3, midRanged: 1, midCasters: 1, midTowers: 1, midHuts: 4,
    lateTowers: 2, alleyTowers: 2,
    meleeUpgradeBias: 'B', rangedUpgradeBias: 'B', casterUpgradeBias: 'B', towerUpgradeBias: 'B',
  },
};

export class Game {
  state: GameState;
  private renderer: Renderer;
  private loop: GameLoop;
  private pendingCommands: GameCommand[] = [];
  private input: InputHandler;
  private sounds: SoundManager;
  onMatchEnd: (() => void) | null = null;
  private matchEndTick = 0;

  // Per-bot quick-chat cooldown (tick of last chat)
  private botLastChatTick: Record<number, number> = {};

  constructor(canvas: HTMLCanvasElement, playerRace: Race = Race.Surge) {
    // Pick bot races: fill remaining 3 slots with races other than player's first
    const allRaces = [Race.Surge, Race.Tide, Race.Ember, Race.Bastion];
    const otherRaces = allRaces.filter(r => r !== playerRace);
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

  // ============================================================
  //  BOT AI
  // ============================================================

  private runBotAI(): void {
    for (const player of this.state.players) {
      if (!player.isBot) continue;
      if (this.state.matchPhase !== 'playing') continue;
      this.runSingleBotAI(player.id);
    }
  }

  // --- Helpers ---

  private botTeam(playerId: number): Team {
    return playerId < 2 ? Team.Bottom : Team.Top;
  }

  private botEnemyTeam(playerId: number): Team {
    return playerId < 2 ? Team.Top : Team.Bottom;
  }

  // --- Main per-bot decision loop ---

  private runSingleBotAI(playerId: number): void {
    const player = this.state.players[playerId];
    const profile = RACE_PROFILES[player.race];
    const myBuildings = this.state.buildings.filter(b => b.playerId === playerId);
    const meleeCount = myBuildings.filter(b => b.type === BuildingType.MeleeSpawner).length;
    const rangedCount = myBuildings.filter(b => b.type === BuildingType.RangedSpawner).length;
    const casterCount = myBuildings.filter(b => b.type === BuildingType.CasterSpawner).length;
    const towerCount = myBuildings.filter(b => b.type === BuildingType.Tower && b.buildGrid === 'military').length;
    const alleyTowerCount = myBuildings.filter(b => b.type === BuildingType.Tower && b.buildGrid === 'alley').length;
    const hutCount = myBuildings.filter(b => b.type === BuildingType.HarvesterHut).length;

    // Decision interval varies per bot to stagger actions
    const interval = 80 + playerId * 15;
    if (this.state.tick % interval !== 0) return;

    const gameMinutes = this.state.tick / (20 * 60);
    const myTeam = this.botTeam(playerId);
    const myHqHp = this.state.hqHp[myTeam];
    const enemyHqHp = this.state.hqHp[this.botEnemyTeam(playerId)];

    // 1. Build order (race-specific profiles)
    this.botDoBuildOrder(
      playerId, player, profile, myBuildings,
      meleeCount, rangedCount, casterCount, towerCount, alleyTowerCount, hutCount,
      gameMinutes,
    );

    // 2. Upgrade existing buildings (smart choices by race)
    this.botUpgradeBuildings(playerId, player.race, profile, myBuildings);

    // 3. Lane pressure evaluation
    this.botEvaluateLanes(playerId, myTeam, myBuildings);

    // 4. Harvester management (reactive to resource needs)
    this.botManageHarvesters(playerId, player, gameMinutes);

    // 5. Nuke usage (offensive + defensive)
    if (player.nukeAvailable && gameMinutes > 2) {
      this.botFireNuke(playerId, myTeam, myHqHp);
    }

    // 6. Quick chat to teammate
    this.botQuickChat(playerId, myTeam, myHqHp, enemyHqHp, gameMinutes);
  }

  // ==================== BUILD ORDER ====================

  /**
   * Race-specific build order driven by profile targets.
   * Returns true if a build command was issued.
   */
  private botDoBuildOrder(
    playerId: number, player: GameState['players'][0], profile: RaceProfile,
    myBuildings: GameState['buildings'],
    meleeCount: number, rangedCount: number, casterCount: number,
    towerCount: number, alleyTowerCount: number, hutCount: number,
    gameMinutes: number,
  ): boolean {

    // --- Phase 1: Early game (< 1.5 min) ---
    if (gameMinutes < 1.5) {
      if (hutCount === 0) {
        this.sendCommand({ type: 'build_hut', playerId });
        return true;
      }
      if (meleeCount < profile.earlyMelee && this.botCanAfford(playerId, BuildingType.MeleeSpawner)) {
        this.botPlaceBuilding(playerId, BuildingType.MeleeSpawner, myBuildings);
        return true;
      }
      if (rangedCount < profile.earlyRanged && this.botCanAfford(playerId, BuildingType.RangedSpawner)) {
        this.botPlaceBuilding(playerId, BuildingType.RangedSpawner, myBuildings);
        return true;
      }
      if (hutCount < profile.earlyHuts && player.gold >= HARVESTER_HUT_COST(hutCount)) {
        this.sendCommand({ type: 'build_hut', playerId });
        return true;
      }
      if (towerCount < profile.earlyTowers && this.botCanAfford(playerId, BuildingType.Tower)) {
        this.botPlaceBuilding(playerId, BuildingType.Tower, myBuildings);
        return true;
      }
      return false;
    }

    // --- Phase 2: Mid game (1.5 - 5 min) ---
    if (gameMinutes < 5) {
      if (meleeCount < profile.midMelee && this.botCanAfford(playerId, BuildingType.MeleeSpawner)) {
        this.botPlaceBuilding(playerId, BuildingType.MeleeSpawner, myBuildings);
        return true;
      }
      if (rangedCount < profile.midRanged && this.botCanAfford(playerId, BuildingType.RangedSpawner)) {
        this.botPlaceBuilding(playerId, BuildingType.RangedSpawner, myBuildings);
        return true;
      }
      if (casterCount < profile.midCasters && this.botCanAfford(playerId, BuildingType.CasterSpawner)) {
        this.botPlaceBuilding(playerId, BuildingType.CasterSpawner, myBuildings);
        return true;
      }
      if (hutCount < profile.midHuts && player.gold >= HARVESTER_HUT_COST(hutCount)) {
        this.sendCommand({ type: 'build_hut', playerId });
        return true;
      }
      if (towerCount < profile.midTowers && this.botCanAfford(playerId, BuildingType.Tower)) {
        this.botPlaceBuilding(playerId, BuildingType.Tower, myBuildings);
        return true;
      }
      // Tide starts alley towers early (defensive race)
      if (profile.alleyTowers >= 3 && alleyTowerCount < 1 && this.botCanAfford(playerId, BuildingType.Tower)) {
        if (this.botPlaceAlleyTower(playerId)) return true;
      }
      return false;
    }

    // --- Phase 3: Late game (5+ min) ---

    // Alley towers
    if (alleyTowerCount < profile.alleyTowers && this.botCanAfford(playerId, BuildingType.Tower)) {
      if (this.botPlaceAlleyTower(playerId)) return true;
    }
    // More base towers
    if (towerCount < profile.lateTowers && this.botCanAfford(playerId, BuildingType.Tower)) {
      this.botPlaceBuilding(playerId, BuildingType.Tower, myBuildings);
      return true;
    }
    // More huts (up to 6)
    if (hutCount < 6 && player.gold >= HARVESTER_HUT_COST(hutCount)) {
      this.sendCommand({ type: 'build_hut', playerId });
      return true;
    }
    // Fill remaining spawner slots
    const totalMilitary = meleeCount + rangedCount + casterCount + towerCount;
    if (totalMilitary < BUILD_GRID_COLS * BUILD_GRID_ROWS) {
      // Add casters if under 2
      if (casterCount < 2 && this.botCanAfford(playerId, BuildingType.CasterSpawner)) {
        this.botPlaceBuilding(playerId, BuildingType.CasterSpawner, myBuildings);
        return true;
      }
      // Alternate melee/ranged with some randomness
      const preferMelee = meleeCount <= rangedCount || Math.random() < 0.4;
      const type = preferMelee ? BuildingType.MeleeSpawner : BuildingType.RangedSpawner;
      if (this.botCanAfford(playerId, type)) {
        this.botPlaceBuilding(playerId, type, myBuildings);
        return true;
      }
    }
    // Very late: fill alley with more towers
    if (gameMinutes > 8 && alleyTowerCount < SHARED_ALLEY_COLS * SHARED_ALLEY_ROWS
        && this.botCanAfford(playerId, BuildingType.Tower)) {
      if (this.botPlaceAlleyTower(playerId)) return true;
    }

    return false;
  }

  private botCanAfford(playerId: number, type: BuildingType): boolean {
    const player = this.state.players[playerId];
    const cost = BUILDING_COSTS[type];
    return player.gold >= cost.gold && player.wood >= cost.wood && player.stone >= cost.stone;
  }

  /**
   * Place building on the military grid.
   * Spread buildings across grid positions instead of left-to-right fill.
   * Towers prefer center columns; spawners pick random free slots.
   */
  private botPlaceBuilding(playerId: number, type: BuildingType, myBuildings: GameState['buildings']): void {
    const occupied = new Set(
      myBuildings.filter(b => b.buildGrid === 'military').map(b => `${b.gridX},${b.gridY}`)
    );
    const freeSlots: { gx: number; gy: number }[] = [];
    for (let gy = 0; gy < BUILD_GRID_ROWS; gy++) {
      for (let gx = 0; gx < BUILD_GRID_COLS; gx++) {
        if (!occupied.has(`${gx},${gy}`)) {
          freeSlots.push({ gx, gy });
        }
      }
    }
    if (freeSlots.length === 0) return;

    let slot: { gx: number; gy: number };
    if (type === BuildingType.Tower) {
      // Towers prefer center columns for lane coverage
      const centerX = Math.floor(BUILD_GRID_COLS / 2);
      freeSlots.sort((a, b) => Math.abs(a.gx - centerX) - Math.abs(b.gx - centerX));
      slot = freeSlots[0];
    } else {
      // Spawners: random free slot for variety
      slot = freeSlots[Math.floor(Math.random() * freeSlots.length)];
    }

    this.sendCommand({
      type: 'place_building', playerId,
      buildingType: type, gridX: slot.gx, gridY: slot.gy,
    });
  }

  /**
   * Place a tower in the shared alley grid. Returns true if command was sent.
   * Prefers center columns for maximum lane coverage, with slight randomness.
   */
  private botPlaceAlleyTower(playerId: number): boolean {
    const myTeam = this.botTeam(playerId);
    const teamAlleyBuildings = this.state.buildings.filter(
      b => b.buildGrid === 'alley' && this.botTeam(b.playerId) === myTeam
    );
    const occupied = new Set(teamAlleyBuildings.map(b => `${b.gridX},${b.gridY}`));

    const freeSlots: { gx: number; gy: number }[] = [];
    for (let gy = 0; gy < SHARED_ALLEY_ROWS; gy++) {
      for (let gx = 0; gx < SHARED_ALLEY_COLS; gx++) {
        if (!occupied.has(`${gx},${gy}`)) {
          freeSlots.push({ gx, gy });
        }
      }
    }
    if (freeSlots.length === 0) return false;

    // Prefer center columns, but add randomness so bots aren't identical
    const centerX = Math.floor(SHARED_ALLEY_COLS / 2);
    freeSlots.sort((a, b) => Math.abs(a.gx - centerX) - Math.abs(b.gx - centerX));
    const idx = Math.min(Math.floor(Math.random() * 3), freeSlots.length - 1);
    const slot = freeSlots[idx];

    this.sendCommand({
      type: 'place_building', playerId,
      buildingType: BuildingType.Tower, gridX: slot.gx, gridY: slot.gy, gridType: 'alley',
    });
    return true;
  }

  // ==================== UPGRADES ====================

  /**
   * Smart upgrade selection based on race profile and army composition.
   * Prioritizes towers (highest impact), then oldest spawners (most units produced).
   */
  private botUpgradeBuildings(
    playerId: number, race: Race, profile: RaceProfile,
    myBuildings: GameState['buildings'],
  ): void {
    const player = this.state.players[playerId];

    const upgradeable = myBuildings
      .filter(b => b.type !== BuildingType.HarvesterHut && b.upgradePath.length < 3)
      .sort((a, b) => {
        // Towers first (highest impact)
        const aPri = a.type === BuildingType.Tower ? 100 : 0;
        const bPri = b.type === BuildingType.Tower ? 100 : 0;
        if (aPri !== bPri) return bPri - aPri;
        // Then oldest buildings first (more units spawned = more impact)
        return a.placedTick - b.placedTick;
      });

    for (const b of upgradeable) {
      const cost = b.upgradePath.length === 1 ? UPGRADE_COSTS.tier1 : UPGRADE_COSTS.tier2;
      if (player.gold < cost.gold || player.wood < cost.wood || player.stone < cost.stone) continue;

      const choice = this.botPickUpgrade(b, profile, race);
      this.sendCommand({ type: 'purchase_upgrade', playerId, buildingId: b.id, choice });
      return; // one upgrade per tick cycle
    }
  }

  /**
   * Pick upgrade choice using race profile bias with a 10% chance to deviate
   * (keeps bots from being perfectly predictable).
   */
  private botPickUpgrade(
    building: GameState['buildings'][0], profile: RaceProfile, race: Race,
  ): string {
    const deviate = Math.random() < 0.1;

    if (building.upgradePath.length === 1) {
      // Tier 1: B or C
      let bias: 'B' | 'C';
      switch (building.type) {
        case BuildingType.MeleeSpawner:  bias = profile.meleeUpgradeBias; break;
        case BuildingType.RangedSpawner: bias = profile.rangedUpgradeBias; break;
        case BuildingType.CasterSpawner: bias = profile.casterUpgradeBias; break;
        case BuildingType.Tower:         bias = profile.towerUpgradeBias; break;
        default: bias = 'B';
      }
      if (deviate) bias = bias === 'B' ? 'C' : 'B';
      return bias;
    }

    // Tier 2: depends on which tier-1 branch was taken
    if (building.upgradePath[1] === 'B') {
      // D = usually tankier/defensive, E = usually more offensive
      const preferOffense = race === Race.Surge || race === Race.Ember;
      let choice = preferOffense ? 'E' : 'D';
      if (deviate) choice = choice === 'D' ? 'E' : 'D';
      return choice;
    } else {
      // F = usually speed/utility, G = usually damage/special
      const preferUtility = race === Race.Surge || race === Race.Tide;
      let choice = preferUtility ? 'F' : 'G';
      if (deviate) choice = choice === 'F' ? 'G' : 'F';
      return choice;
    }
  }

  // ==================== LANE PRESSURE ====================

  /**
   * Evaluate lane pressure by counting friendly vs enemy units per lane.
   * Switch spawners to reinforce the lane under pressure, or push the weaker enemy lane.
   */
  private botEvaluateLanes(
    playerId: number, myTeam: Team,
    myBuildings: GameState['buildings'],
  ): void {
    // Only re-evaluate every ~10-15 seconds to avoid flip-flopping
    const laneInterval = 200 + playerId * 30;
    if (this.state.tick % laneInterval !== 0) return;

    const enemyTeam = this.botEnemyTeam(playerId);

    const myLeftUnits = this.state.units.filter(u => u.team === myTeam && u.lane === Lane.Left).length;
    const myRightUnits = this.state.units.filter(u => u.team === myTeam && u.lane === Lane.Right).length;
    const enemyLeftUnits = this.state.units.filter(u => u.team === enemyTeam && u.lane === Lane.Left).length;
    const enemyRightUnits = this.state.units.filter(u => u.team === enemyTeam && u.lane === Lane.Right).length;

    // Pressure ratio: higher = more danger in that lane
    const leftPressure = (enemyLeftUnits + 1) / (myLeftUnits + 1);
    const rightPressure = (enemyRightUnits + 1) / (myRightUnits + 1);

    let targetLane: Lane | null = null;

    // If one lane is overwhelmed (2x+ enemy advantage), reinforce it
    if (leftPressure > 2.0 && leftPressure > rightPressure * 1.3) {
      targetLane = Lane.Left;
    } else if (rightPressure > 2.0 && rightPressure > leftPressure * 1.3) {
      targetLane = Lane.Right;
    } else if (leftPressure > rightPressure + 0.3) {
      // Slight advantage to enemy on left — consider reinforcing
      targetLane = Lane.Left;
    } else if (rightPressure > leftPressure + 0.3) {
      targetLane = Lane.Right;
    }
    // else: balanced, no change

    if (targetLane !== null) {
      const spawners = myBuildings.filter(b =>
        b.type === BuildingType.MeleeSpawner ||
        b.type === BuildingType.RangedSpawner ||
        b.type === BuildingType.CasterSpawner
      );
      if (spawners.length > 0 && spawners[0].lane !== targetLane) {
        this.sendCommand({ type: 'toggle_all_lanes', playerId, lane: targetLane });
      }
    }
  }

  // ==================== HARVESTER MANAGEMENT ====================

  /**
   * Reactive harvester assignment based on current resource needs,
   * diamond state, and remaining gold cells.
   */
  private botManageHarvesters(
    playerId: number, player: GameState['players'][0], gameMinutes: number,
  ): void {
    const myHarvesters = this.state.harvesters.filter(h => h.playerId === playerId);
    if (myHarvesters.length === 0) return;

    const needWood = player.wood < 30;
    const needStone = player.stone < 30;
    const diamondExposed = this.state.diamond.exposed;
    const goldCellsRemaining = this.state.diamondCells.filter(c => c.gold > 0).length;
    const goldMostlyMined = goldCellsRemaining < this.state.diamondCells.length * 0.3;

    for (let i = 0; i < myHarvesters.length; i++) {
      const h = myHarvesters[i];
      let desired: HarvesterAssignment;

      if (i === 0) {
        // First harvester: always base gold for stable income
        desired = HarvesterAssignment.BaseGold;
      } else if (i === 1) {
        // Second: wood normally, center if diamond exposed late game
        if (diamondExposed && gameMinutes > 6) {
          desired = HarvesterAssignment.Center;
        } else {
          desired = HarvesterAssignment.Wood;
        }
      } else if (i === 2) {
        // Third: stone once we need it (towers, casters), else wood if low
        if (needStone || gameMinutes > 2) {
          desired = HarvesterAssignment.Stone;
        } else {
          desired = needWood ? HarvesterAssignment.Wood : HarvesterAssignment.BaseGold;
        }
      } else if (i === 3) {
        // Fourth: center for diamond contest, else fill resource gaps
        if (gameMinutes > 3) {
          desired = HarvesterAssignment.Center;
        } else if (needWood) {
          desired = HarvesterAssignment.Wood;
        } else {
          desired = HarvesterAssignment.BaseGold;
        }
      } else {
        // Fifth+: late game diamond contest, or fill gaps if gold mined out
        if (diamondExposed || gameMinutes > 5) {
          desired = HarvesterAssignment.Center;
        } else if (goldMostlyMined) {
          desired = i % 2 === 0 ? HarvesterAssignment.Wood : HarvesterAssignment.Stone;
        } else {
          desired = HarvesterAssignment.Center;
        }
      }

      if (h.assignment !== desired) {
        const hut = this.state.buildings.find(b => b.id === h.hutId);
        if (hut) {
          this.sendCommand({
            type: 'set_hut_assignment', playerId,
            hutId: hut.id, assignment: desired,
          });
        }
      }
    }
  }

  // ==================== NUKE ====================

  /**
   * Fires nuke at the best target. Priorities:
   * 1. Defensive: enemy cluster near own HQ (within 25 tiles), especially when HQ < 50%
   * 2. Offensive: densest enemy cluster anywhere on the map
   */
  private botFireNuke(playerId: number, myTeam: Team, myHqHp: number): void {
    const enemyTeam = this.botEnemyTeam(playerId);
    const enemyUnits = this.state.units.filter(u => u.team === enemyTeam);
    if (enemyUnits.length < 3) return;

    // HQ approximate position
    const hqX = 40;
    const hqY = myTeam === Team.Bottom ? 105 : 12;
    const hqInDanger = myHqHp < HQ_HP * 0.5;

    // Check for defensive nuke: enemies clustered near HQ
    const nearHqEnemies = enemyUnits.filter(u => {
      const dx = u.x - hqX;
      const dy = u.y - hqY;
      return dx * dx + dy * dy < 25 * 25;
    });

    // Prioritize defensive nuke when HQ is in trouble
    if (hqInDanger && nearHqEnemies.length >= 3) {
      const target = this.findBestNukeTarget(nearHqEnemies);
      if (target) {
        this.sendCommand({ type: 'fire_nuke', playerId, x: target.x, y: target.y });
        return;
      }
    }

    // Offensive nuke: densest cluster anywhere
    if (enemyUnits.length >= 5) {
      const target = this.findBestNukeTarget(enemyUnits);
      if (target) {
        this.sendCommand({ type: 'fire_nuke', playerId, x: target.x, y: target.y });
      }
    }
  }

  /**
   * Find the densest cluster center among the given units.
   * Returns null if no cluster of 3+ units is found within the search radius.
   */
  private findBestNukeTarget(units: GameState['units']): { x: number; y: number } | null {
    if (units.length < 3) return null;

    const radius = 16;
    const radiusSq = radius * radius;
    let bestScore = -Infinity;
    let bestCount = 0;
    let bestX = units[0].x;
    let bestY = units[0].y;

    for (const anchor of units) {
      let count = 0;
      let weightedDist = 0;
      let sumX = 0;
      let sumY = 0;
      for (const u of units) {
        const dx = u.x - anchor.x;
        const dy = u.y - anchor.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > radiusSq) continue;
        count++;
        weightedDist += Math.sqrt(d2);
        sumX += u.x;
        sumY += u.y;
      }
      if (count === 0) continue;
      const score = count * 100 - weightedDist;
      if (score > bestScore) {
        bestScore = score;
        bestCount = count;
        bestX = sumX / count;
        bestY = sumY / count;
      }
    }

    if (bestCount < 3) return null;
    return { x: bestX, y: bestY };
  }

  // ==================== QUICK CHAT ====================

  /**
   * Bots occasionally send quick chats to their teammate.
   * Rate-limited to one message per 30 seconds, with 20% trigger chance.
   */
  private botQuickChat(
    playerId: number, _myTeam: Team, myHqHp: number, _enemyHqHp: number,
    gameMinutes: number,
  ): void {
    const lastChat = this.botLastChatTick[playerId] ?? 0;
    if (this.state.tick - lastChat < 600) return; // 30s cooldown at 20 tps
    if (Math.random() > 0.2) return; // 20% chance each evaluation

    let message: string | null = null;

    // Defend call when HQ is below 50%
    if (myHqHp < HQ_HP * 0.5) {
      message = 'Defend';
    }
    // Diamond exposed call
    else if (this.state.diamond.exposed && this.state.diamond.state === 'exposed' && gameMinutes > 3) {
      message = 'Get Diamond';
    }
    // Lane switch announcement
    else if (Math.random() < 0.3) {
      const mySpawners = this.state.buildings.filter(b =>
        b.playerId === playerId &&
        b.type !== BuildingType.Tower &&
        b.type !== BuildingType.HarvesterHut
      );
      if (mySpawners.length > 0) {
        const lane = mySpawners[0].lane;
        message = lane === Lane.Left ? 'Attack Left' : 'Attack Right';
      }
    }

    if (message) {
      this.sendCommand({ type: 'quick_chat', playerId, message });
      this.botLastChatTick[playerId] = this.state.tick;
    }
  }
}
