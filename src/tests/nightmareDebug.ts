import { createInitialState, simulateTick } from '../simulation/GameState';
import { GameCommand, Race, Team, TICK_RATE } from '../simulation/types';
import { runAllBotAI, createBotContext, BotDifficultyLevel, BOT_DIFFICULTY_PRESETS, BotDifficulty } from '../simulation/BotAI';
import { DUEL_MAP } from '../simulation/maps';

const MAX_TICKS = 15 * 60 * TICK_RATE;
const MATCHES = 10;
const TEST_RACES = [Race.Crown, Race.Horde, Race.Deep, Race.Tenders, Race.Demon, Race.Goblins];

function runMatch(race: Race, bottomDiff: BotDifficulty, topDiff: BotDifficulty): 'bottom' | 'top' | 'draw' {
  const ppt = DUEL_MAP.playersPerTeam;
  const players: { race: Race; isBot: boolean; isEmpty?: boolean }[] = [];
  players.push({ race, isBot: true });
  for (let i = 1; i < ppt; i++) players.push({ race: Race.Crown, isBot: true, isEmpty: true });
  players.push({ race, isBot: true });
  for (let i = 1; i < ppt; i++) players.push({ race: Race.Crown, isBot: true, isEmpty: true });
  const state = createInitialState(players, undefined, DUEL_MAP);
  const ctx = createBotContext(BotDifficultyLevel.Easy);
  ctx.difficulty[0] = bottomDiff;
  ctx.difficulty[ppt] = topDiff;
  for (const p of state.players) {
    if (!p.isBot || p.isEmpty) continue;
    const diff = ctx.difficulty[p.id] ?? ctx.defaultDifficulty;
    if (diff.statBonus && diff.statBonus !== 1) p.statBonus = diff.statBonus;
  }
  const commands: GameCommand[] = [];
  const emit = (cmd: GameCommand) => commands.push(cmd);
  while (state.matchPhase !== 'ended' && state.tick < MAX_TICKS) {
    commands.length = 0;
    runAllBotAI(state, ctx, emit);
    simulateTick(state, commands);
  }
  return state.winner === Team.Bottom ? 'bottom' : state.winner === Team.Top ? 'top' : 'draw';
}

function testVariant(name: string, tweakedNightmare: BotDifficulty): void {
  const hard = BOT_DIFFICULTY_PRESETS[BotDifficultyLevel.Hard];
  let wins = 0, losses = 0, draws = 0;
  for (const race of TEST_RACES) {
    for (let i = 0; i < MATCHES; i++) {
      // Side-swap
      const r1 = runMatch(race, tweakedNightmare, hard);
      if (r1 === 'bottom') wins++; else if (r1 === 'top') losses++; else draws++;
      const r2 = runMatch(race, hard, tweakedNightmare);
      if (r2 === 'top') wins++; else if (r2 === 'bottom') losses++; else draws++;
    }
  }
  const total = wins + losses + draws;
  const pct = Math.round(100 * wins / total);
  console.log(`  ${name.padEnd(40)} ${wins}W ${losses}L ${draws}D  (${pct}% tweaked nightmare wins)${pct < 50 ? ' << STILL WORSE' : pct > 55 ? ' BETTER' : ''}`);
}

const nightmare = { ...BOT_DIFFICULTY_PRESETS[BotDifficultyLevel.Nightmare] };

console.log('='.repeat(80));
console.log('  NIGHTMARE vs HARD — Isolating which nightmare setting causes underperformance');
console.log('  ' + MATCHES * 2 + ' games per race x ' + TEST_RACES.length + ' races = ' + (MATCHES * 2 * TEST_RACES.length) + ' games per variant');
console.log('='.repeat(80));

// Baseline: stock nightmare vs hard
console.log('\n--- BASELINE ---');
testVariant('Stock Nightmare vs Hard', nightmare);

// Test each nightmare-unique setting by reverting it to hard's value
console.log('\n--- REVERT ONE SETTING AT A TIME ---');

testVariant('maxSpawners: 7 (hard) instead of 99', { ...nightmare, maxSpawners: 7 });
testVariant('nukeDefensiveOnly: false (hard)', { ...nightmare, nukeDefensiveOnly: false });
testVariant('counterBuild: false (hard)', { ...nightmare, counterBuild: false });
testVariant('buildSpeed: 25 (hard) instead of 10', { ...nightmare, buildSpeed: 25 });
testVariant('upgradeSpeed: 40 (hard) instead of 20', { ...nightmare, upgradeSpeed: 40 });
testVariant('maxHuts: 6 (hard) instead of 8', { ...nightmare, maxHuts: 6 });
testVariant('mistakeRate: 0.05 (hard) instead of 0', { ...nightmare, mistakeRate: 0.05 });

// Combo: revert the most likely culprits
console.log('\n--- COMBOS ---');
testVariant('maxSpawners:7 + nukeDefensive:false', { ...nightmare, maxSpawners: 7, nukeDefensiveOnly: false });
testVariant('maxSpawners:7 + buildSpeed:25', { ...nightmare, maxSpawners: 7, buildSpeed: 25 });
testVariant('All nightmare brain, hard caps/timers', {
  ...nightmare,
  buildSpeed: 25, upgradeSpeed: 40, maxSpawners: 7, maxHuts: 6, nukeDefensiveOnly: false,
});
