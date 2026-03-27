import { createInitialState, simulateTick } from '../simulation/GameState';
import { GameCommand, Race, Team, TICK_RATE, MapDef } from '../simulation/types';
import { runAllBotAI, createBotContext, BotDifficultyLevel, BOT_DIFFICULTY_PRESETS } from '../simulation/BotAI';
import { DUEL_MAP } from '../simulation/maps';

const MAX_MATCH_TICKS = 15 * 60 * TICK_RATE;
const MATCHES_PER_MATCHUP = 5;

// Test races — pick a spread of archetypes
const TEST_RACES = [Race.Crown, Race.Horde, Race.Deep, Race.Wild, Race.Tenders, Race.Demon, Race.Goblins];

interface Result {
  higher: BotDifficultyLevel;
  lower: BotDifficultyLevel;
  race: Race;
  higherWins: number;
  lowerWins: number;
  draws: number;
}

function runMatch(
  race: Race,
  bottomDiff: BotDifficultyLevel,
  topDiff: BotDifficultyLevel,
  mapDef: MapDef,
): 'bottom' | 'top' | 'draw' {
  // DUEL_MAP has playersPerTeam=2, so we need 4 player slots
  // Active players at slots 0 (bottom) and 2 (top), with empty teammates
  const ppt = mapDef.playersPerTeam;
  const players: { race: Race; isBot: boolean; isEmpty?: boolean }[] = [];
  // Team 0 (bottom)
  players.push({ race, isBot: true });
  for (let i = 1; i < ppt; i++) players.push({ race: Race.Crown, isBot: true, isEmpty: true });
  // Team 1 (top)
  players.push({ race, isBot: true });
  for (let i = 1; i < ppt; i++) players.push({ race: Race.Crown, isBot: true, isEmpty: true });
  const state = createInitialState(players, undefined, mapDef);

  const ctx = createBotContext(BotDifficultyLevel.Easy); // base doesn't matter
  // Override per-player difficulty: player 0 = bottom, player ppt = top
  ctx.difficulty[0] = BOT_DIFFICULTY_PRESETS[bottomDiff];
  ctx.difficulty[ppt] = BOT_DIFFICULTY_PRESETS[topDiff];
  // Apply stat bonuses to player state
  for (const p of state.players) {
    if (!p.isBot || p.isEmpty) continue;
    const diff = ctx.difficulty[p.id] ?? ctx.defaultDifficulty;
    if (diff.statBonus && diff.statBonus !== 1) p.statBonus = diff.statBonus;
  }

  const commands: GameCommand[] = [];
  const emit = (cmd: GameCommand) => commands.push(cmd);

  while (state.matchPhase !== 'ended' && state.tick < MAX_MATCH_TICKS) {
    commands.length = 0;
    runAllBotAI(state, ctx, emit);
    simulateTick(state, commands);
  }

  return state.winner === Team.Bottom ? 'bottom'
    : state.winner === Team.Top ? 'top' : 'draw';
}

// Run hierarchy tests: each adjacent difficulty pair
const results: Result[] = [];
const pairings: [BotDifficultyLevel, BotDifficultyLevel][] = [
  [BotDifficultyLevel.Easy, BotDifficultyLevel.Medium],
  [BotDifficultyLevel.Medium, BotDifficultyLevel.Hard],
  [BotDifficultyLevel.Hard, BotDifficultyLevel.Nightmare],
];

const totalMatches = pairings.length * TEST_RACES.length * MATCHES_PER_MATCHUP * 2; // x2 for side swap
let completed = 0;

for (const [lower, higher] of pairings) {
  for (const race of TEST_RACES) {
    let higherWins = 0, lowerWins = 0, draws = 0;

    let bottomWins = 0, topWins = 0;
    for (let i = 0; i < MATCHES_PER_MATCHUP; i++) {
      // Higher difficulty on bottom
      const r1 = runMatch(race, higher, lower, DUEL_MAP);
      completed++;
      if (r1 === 'bottom') { higherWins++; bottomWins++; }
      else if (r1 === 'top') { lowerWins++; topWins++; }
      else draws++;

      // Higher difficulty on top (swap sides to cancel bottom-team bias)
      const r2 = runMatch(race, lower, higher, DUEL_MAP);
      completed++;
      if (r2 === 'top') { higherWins++; topWins++; }
      else if (r2 === 'bottom') { lowerWins++; bottomWins++; }
      else draws++;

      if (completed % 10 === 0) {
        process.stdout.write(`\r  ${completed}/${totalMatches} matches completed`);
      }
    }
    console.log(`  [DEBUG] ${race} ${higher}v${lower}: bottom=${bottomWins} top=${topWins} draws=${draws} | higherW=${higherWins} lowerW=${lowerWins}`);

    results.push({ higher, lower, race, higherWins, lowerWins, draws });
  }
}

console.log('\n');
console.log('='.repeat(80));
console.log('  DIFFICULTY HIERARCHY TEST');
console.log('  Same race mirror matches, higher difficulty vs lower difficulty');
console.log('  ' + MATCHES_PER_MATCHUP * 2 + ' games per matchup (side-swapped to cancel bottom bias)');
console.log('='.repeat(80));

// Per-pairing summary
for (const [lower, higher] of pairings) {
  const pairResults = results.filter(r => r.higher === higher && r.lower === lower);
  const totalH = pairResults.reduce((s, r) => s + r.higherWins, 0);
  const totalL = pairResults.reduce((s, r) => s + r.lowerWins, 0);
  const totalD = pairResults.reduce((s, r) => s + r.draws, 0);
  const totalG = totalH + totalL + totalD;
  const pct = totalG > 0 ? Math.round(100 * totalH / totalG) : 0;

  console.log(`\n  ${higher.toUpperCase()} vs ${lower.toUpperCase()}: ${totalH}W ${totalL}L ${totalD}D (${pct}% win for ${higher})`);
  console.log('  ' + '-'.repeat(70));
  console.log('  Race          Higher W   Lower W    Draws    Higher Win%');
  console.log('  ' + '-'.repeat(70));
  for (const r of pairResults) {
    const g = r.higherWins + r.lowerWins + r.draws;
    const wp = g > 0 ? Math.round(100 * r.higherWins / g) : 0;
    const marker = wp < 50 ? ' << INVERTED' : wp === 50 ? ' -- TIED' : '';
    console.log(`  ${r.race.padEnd(14)} ${String(r.higherWins).padStart(3)}        ${String(r.lowerWins).padStart(3)}        ${String(r.draws).padStart(3)}        ${wp}%${marker}`);
  }
}

// Overall summary
console.log('\n' + '='.repeat(80));
console.log('  OVERALL HIERARCHY VALIDITY');
console.log('='.repeat(80));
for (const [lower, higher] of pairings) {
  const pairResults = results.filter(r => r.higher === higher && r.lower === lower);
  const totalH = pairResults.reduce((s, r) => s + r.higherWins, 0);
  const totalL = pairResults.reduce((s, r) => s + r.lowerWins, 0);
  const totalD = pairResults.reduce((s, r) => s + r.draws, 0);
  const totalG = totalH + totalL + totalD;
  const pct = totalG > 0 ? Math.round(100 * totalH / totalG) : 0;
  const inverted = pairResults.filter(r => r.higherWins < r.lowerWins).map(r => r.race);
  const status = pct >= 60 ? 'OK' : pct >= 50 ? 'WEAK' : 'BROKEN';
  console.log(`  ${higher.padEnd(10)} > ${lower.padEnd(10)}: ${pct}% higher wins [${status}]${inverted.length > 0 ? ` — INVERTED for: ${inverted.join(', ')}` : ''}`);
}
console.log('='.repeat(80));
