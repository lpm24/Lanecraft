import { createInitialState, simulateTick } from '../simulation/GameState';
import { GameCommand, Race, Team, TICK_RATE } from '../simulation/types';
import { runAllBotAI, createBotContext, BotDifficultyLevel } from '../simulation/BotAI';
import { DUEL_MAP } from '../simulation/maps';

const MAX_TICKS = 15 * 60 * TICK_RATE;

// Run 10 Crown mirror matches, track what each bot builds and when
for (let trial = 0; trial < 10; trial++) {
  const players = [
    { race: Race.Crown, isBot: true },
    { race: Race.Crown, isBot: true },
  ];
  const state = createInitialState(players, undefined, DUEL_MAP);
  const ctx = createBotContext(BotDifficultyLevel.Medium);

  const buildLog: Record<number, string[]> = { 0: [], 1: [] };
  const commands: GameCommand[] = [];
  const emit = (cmd: GameCommand) => {
    commands.push(cmd);
    if ('playerId' in cmd && 'type' in cmd) {
      const pid = (cmd as { playerId: number }).playerId;
      const tick = state.tick;
      const type = cmd.type === 'place_building' ? `build:${(cmd as { buildingType: string }).buildingType}`
        : cmd.type === 'build_hut' ? 'build:hut'
        : cmd.type === 'purchase_upgrade' ? 'upgrade'
        : cmd.type;
      buildLog[pid].push(`t${tick}:${type}`);
    }
  };

  let winner = 'draw';
  while (state.matchPhase !== 'ended' && state.tick < MAX_TICKS) {
    commands.length = 0;
    runAllBotAI(state, ctx, emit);
    simulateTick(state, commands);
  }

  winner = state.winner === Team.Bottom ? 'BOTTOM' : state.winner === Team.Top ? 'TOP' : 'DRAW';
  const b0units = state.units.filter(u => u.team === Team.Bottom).length;
  const b1units = state.units.filter(u => u.team === Team.Top).length;

  console.log(`\nTrial ${trial + 1}: ${winner} wins | HQ: ${state.hqHp[0]}/${state.hqHp[1]} | Units: ${b0units}/${b1units} | Duration: ${(state.tick / TICK_RATE / 60).toFixed(1)}m`);
  console.log(`  P0 (bottom): ${buildLog[0].slice(0, 15).join(', ')}`);
  console.log(`  P1 (top):    ${buildLog[1].slice(0, 15).join(', ')}`);

  // Check if builds match
  const maxLen = Math.min(buildLog[0].length, buildLog[1].length, 15);
  let firstDiff = -1;
  for (let i = 0; i < maxLen; i++) {
    if (buildLog[0][i] !== buildLog[1][i]) {
      // Normalize tick differences — same action type but different tick
      const t0 = buildLog[0][i].split(':').slice(1).join(':');
      const t1 = buildLog[1][i].split(':').slice(1).join(':');
      if (t0 !== t1) { firstDiff = i; break; }
    }
  }
  if (firstDiff >= 0) {
    console.log(`  FIRST DIVERGENCE at action #${firstDiff}: P0="${buildLog[0][firstDiff]}" vs P1="${buildLog[1][firstDiff]}"`);
  } else {
    console.log(`  Build orders IDENTICAL (first ${maxLen} actions)`);
  }
}
