import { createInitialState, simulateTick } from '../simulation/GameState';
import { GameCommand, Race, Team, TICK_RATE } from '../simulation/types';
import { runAllBotAI, createBotContext, RACE_PROFILES, RaceProfile } from '../simulation/BotAI';

const MAX_MATCH_TICKS = 8 * 60 * TICK_RATE;
const MATCHES_PER_RACE = 6; // 3 as bottom, 3 as top
const ALL_RACES = [Race.Crown, Race.Horde, Race.Goblins, Race.Oozlings, Race.Demon, Race.Deep, Race.Wild, Race.Geists, Race.Tenders];

// Override profiles per-player by patching the profile lookup
// Wide: lots of spawners, more huts, no upgrade priority
// Tall: fewer spawners, aggressive upgrades

function makeWideProfile(base: RaceProfile): RaceProfile {
  return {
    ...base,
    earlyMelee: Math.max(base.earlyMelee, 2),
    earlyRanged: Math.max(base.earlyRanged, 1),
    earlyHuts: Math.min(base.earlyHuts, 1), // minimal econ early, rush spawners
    midMelee: base.midMelee + 2,
    midRanged: base.midRanged + 1,
    midCasters: base.midCasters + 1,
    midTowers: 0,
    midHuts: Math.min(base.midHuts, 2),
    lateTowers: 1,
    alleyTowers: 1,
    maxHuts: Math.min(base.maxHuts, 3),
    pushThreshold: base.pushThreshold,
  };
}

function makeTallProfile(base: RaceProfile): RaceProfile {
  return {
    ...base,
    earlyMelee: Math.min(base.earlyMelee, 1),
    earlyRanged: Math.min(base.earlyRanged, 1),
    earlyHuts: Math.max(base.earlyHuts, 2), // invest in econ
    midMelee: Math.min(base.midMelee, 2),
    midRanged: Math.min(base.midRanged, 1),
    midCasters: Math.min(base.midCasters, 1),
    midTowers: base.midTowers + 1,
    midHuts: Math.max(base.midHuts, 3),
    lateTowers: base.lateTowers + 1,
    alleyTowers: base.alleyTowers,
    maxHuts: Math.max(base.maxHuts, 4),
    pushThreshold: base.pushThreshold,
  };
}

// Monkey-patch approach: swap RACE_PROFILES entries per match
// Bottom team (P0, P1) = strategy A, Top team (P2, P3) = strategy B
function runStrategyMatch(
  race: Race,
  bottomProfile: RaceProfile,
  topProfile: RaceProfile,
): { winner: 'wide' | 'tall' | 'draw'; durationTicks: number; bottomSpawned: number; topSpawned: number; bottomBuildings: number; topBuildings: number } {
  // Save original
  const original = RACE_PROFILES[race];

  const state = createInitialState([
    { race, isBot: true },
    { race, isBot: true },
    { race, isBot: true },
    { race, isBot: true },
  ]);

  const botCtx = createBotContext();
  const commands: GameCommand[] = [];
  const emit = (cmd: GameCommand) => commands.push(cmd);

  // We need to swap profiles per-tick based on which player is acting
  // Since runAllBotAI iterates all players, we'll patch before each call
  // But all 4 players use same race... we need per-player profiles

  // Alternative: run bot AI manually per player with profile swaps
  while (state.matchPhase !== 'ended' && state.tick < MAX_MATCH_TICKS) {
    commands.length = 0;

    // Bottom players use bottomProfile
    (RACE_PROFILES as any)[race] = bottomProfile;
    for (const player of state.players) {
      if (!player.isBot || player.team !== Team.Bottom) continue;
      if (state.matchPhase !== 'playing') continue;
      // runAllBotAI processes all bots, but we need selective
      // So we temporarily mark top players as non-bot
    }

    // Hack: temporarily mark players to control which ones run
    // Run bottom bots
    (RACE_PROFILES as any)[race] = bottomProfile;
    state.players[2].isBot = false;
    state.players[3].isBot = false;
    runAllBotAI(state, botCtx, emit);
    state.players[2].isBot = true;
    state.players[3].isBot = true;

    // Run top bots
    (RACE_PROFILES as any)[race] = topProfile;
    state.players[0].isBot = false;
    state.players[1].isBot = false;
    runAllBotAI(state, botCtx, emit);
    state.players[0].isBot = true;
    state.players[1].isBot = true;

    simulateTick(state, commands);
  }

  // Restore
  (RACE_PROFILES as any)[race] = original;

  const winner = state.winner === Team.Bottom ? 'bottom' : state.winner === Team.Top ? 'top' : 'draw';

  const bottomSpawned = state.playerStats[0].unitsSpawned + state.playerStats[1].unitsSpawned;
  const topSpawned = state.playerStats[2].unitsSpawned + state.playerStats[3].unitsSpawned;
  const bottomBuildings = state.buildings.filter(b => b.playerId < 2).length;
  const topBuildings = state.buildings.filter(b => b.playerId >= 2).length;

  return {
    winner: winner === 'draw' ? 'draw' : winner === 'bottom' ? 'wide' : 'tall',
    durationTicks: state.tick,
    bottomSpawned,
    topSpawned,
    bottomBuildings,
    topBuildings,
  };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.substring(0, n) : s + ' '.repeat(n - s.length);
}

function main(): void {
  console.log(`\nWIDE vs TALL Strategy Test`);
  console.log(`Wide = max spawners, minimal upgrades/towers`);
  console.log(`Tall = fewer spawners, heavy upgrades/towers/econ`);
  console.log(`${MATCHES_PER_RACE} matches per race (${MATCHES_PER_RACE / 2} each side)\n`);
  console.log('-'.repeat(90));
  console.log(pad('Race', 12) + pad('WideW', 7) + pad('TallW', 7) + pad('Draw', 6) +
    pad('Wide%', 8) + pad('AvgWideSpwn', 13) + pad('AvgTallSpwn', 13) +
    pad('AvgWideBld', 12) + pad('AvgTallBld', 12));
  console.log('-'.repeat(90));

  let totalWideWins = 0, totalTallWins = 0, totalDraws = 0;

  for (const race of ALL_RACES) {
    const base = RACE_PROFILES[race];
    const wide = makeWideProfile(base);
    const tall = makeTallProfile(base);

    let wideWins = 0, tallWins = 0, draws = 0;
    let wideSpawnTotal = 0, tallSpawnTotal = 0;
    let wideBldTotal = 0, tallBldTotal = 0;
    let matchCount = 0;

    // Half matches: wide on bottom, tall on top
    for (let i = 0; i < MATCHES_PER_RACE / 2; i++) {
      const r = runStrategyMatch(race, wide, tall);
      if (r.winner === 'wide') wideWins++;
      else if (r.winner === 'tall') tallWins++;
      else draws++;
      wideSpawnTotal += r.bottomSpawned;
      tallSpawnTotal += r.topSpawned;
      wideBldTotal += r.bottomBuildings;
      tallBldTotal += r.topBuildings;
      matchCount++;
    }

    // Half matches: tall on bottom, wide on top (swap sides)
    for (let i = 0; i < MATCHES_PER_RACE / 2; i++) {
      const r = runStrategyMatch(race, tall, wide);
      // Flip: bottom=tall, top=wide, so 'bottom' win = tall win
      if (r.winner === 'wide') tallWins++; // bottom won, but bottom is tall
      else if (r.winner === 'tall') wideWins++; // top won, top is wide
      else draws++;
      // Flip spawn/building tracking
      tallSpawnTotal += r.bottomSpawned;
      wideSpawnTotal += r.topSpawned;
      tallBldTotal += r.bottomBuildings;
      wideBldTotal += r.topBuildings;
      matchCount++;
    }

    const widePct = matchCount > 0 ? Math.round(100 * wideWins / matchCount) : 0;
    console.log(
      pad(race, 12) + pad(String(wideWins), 7) + pad(String(tallWins), 7) + pad(String(draws), 6) +
      pad(`${widePct}%`, 8) +
      pad(String(Math.round(wideSpawnTotal / matchCount)), 13) +
      pad(String(Math.round(tallSpawnTotal / matchCount)), 13) +
      pad(String(Math.round(wideBldTotal / matchCount)), 12) +
      pad(String(Math.round(tallBldTotal / matchCount)), 12)
    );

    totalWideWins += wideWins;
    totalTallWins += tallWins;
    totalDraws += draws;
  }

  console.log('-'.repeat(90));
  const total = totalWideWins + totalTallWins + totalDraws;
  console.log(`\nOVERALL: Wide ${totalWideWins}W (${Math.round(100 * totalWideWins / total)}%) | Tall ${totalTallWins}W (${Math.round(100 * totalTallWins / total)}%) | Draw ${totalDraws}`);
  console.log('');
}

main();
