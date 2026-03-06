import { createInitialState, simulateTick } from '../simulation/GameState';
import { GameCommand, Race, Team, TICK_RATE } from '../simulation/types';
import { runAllBotAI, createBotContext } from '../simulation/BotAI';

// ==================== CONFIG ====================

const MATCHES_PER_MATCHUP = 10;
const MAX_MATCH_TICKS = 15 * 60 * TICK_RATE; // 15 min hard cap
const ALL_RACES = [Race.Surge, Race.Tide, Race.Ember, Race.Bastion, Race.Shade, Race.Thorn];

// ==================== TYPES ====================

interface MatchResult {
  bottomRaces: [Race, Race];
  topRaces: [Race, Race];
  winner: 'bottom' | 'top' | 'draw';
  winCondition: string;
  durationTicks: number;
  perPlayer: {
    race: Race;
    team: string;
    damageDealt: number;
    unitsSpawned: number;
    unitsLost: number;
    goldEarned: number;
    woodEarned: number;
    stoneEarned: number;
    buildingCount: number;
  }[];
}

// ==================== HEADLESS MATCH ====================

function runHeadlessMatch(
  p0Race: Race, p1Race: Race, p2Race: Race, p3Race: Race,
): MatchResult {
  const state = createInitialState([
    { race: p0Race, isBot: true },
    { race: p1Race, isBot: true },
    { race: p2Race, isBot: true },
    { race: p3Race, isBot: true },
  ]);

  const botCtx = createBotContext();
  const commands: GameCommand[] = [];
  const emit = (cmd: GameCommand) => commands.push(cmd);

  while (state.matchPhase !== 'ended' && state.tick < MAX_MATCH_TICKS) {
    commands.length = 0;
    runAllBotAI(state, botCtx, emit);
    simulateTick(state, commands);
  }

  const winner = state.winner === Team.Bottom ? 'bottom'
    : state.winner === Team.Top ? 'top' : 'draw';

  return {
    bottomRaces: [p0Race, p1Race],
    topRaces: [p2Race, p3Race],
    winner,
    winCondition: state.winCondition ?? 'timeout',
    durationTicks: state.tick,
    perPlayer: state.players.map((p, i) => {
      const s = state.playerStats[i];
      return {
        race: p.race,
        team: p.team === Team.Bottom ? 'bottom' : 'top',
        damageDealt: s.totalDamageDealt,
        unitsSpawned: s.unitsSpawned,
        unitsLost: s.unitsLost,
        goldEarned: s.totalGoldEarned,
        woodEarned: s.totalWoodEarned,
        stoneEarned: s.totalStoneEarned,
        buildingCount: state.buildings.filter(b => b.playerId === i).length,
      };
    }),
  };
}

// ==================== MATCHUP GENERATION ====================

interface Matchup {
  bottom: [Race, Race];
  top: [Race, Race];
}

function generateMatchups(): Matchup[] {
  // Generate all unique 2v2 team compositions
  // Each team picks 2 races (can be same race twice = mirror)
  // We test every pair-vs-pair combination
  const teamPairs: [Race, Race][] = [];
  for (let i = 0; i < ALL_RACES.length; i++) {
    for (let j = i; j < ALL_RACES.length; j++) {
      teamPairs.push([ALL_RACES[i], ALL_RACES[j]]);
    }
  }

  const matchups: Matchup[] = [];
  for (let i = 0; i < teamPairs.length; i++) {
    for (let j = i; j < teamPairs.length; j++) {
      matchups.push({ bottom: teamPairs[i], top: teamPairs[j] });
    }
  }
  return matchups;
}

// ==================== AGGREGATION ====================

interface RaceStats {
  wins: number;
  losses: number;
  draws: number;
  totalDamage: number;
  totalUnitsSpawned: number;
  totalUnitsLost: number;
  totalGold: number;
  totalWood: number;
  totalStone: number;
  appearances: number;
}

interface MatchupRecord {
  wins: number;
  losses: number;
  draws: number;
  total: number;
}

function aggregate(results: MatchResult[]) {
  const raceStats: Record<string, RaceStats> = {};
  // Matchup: raceA vs raceB (individual race perspective)
  const matchupGrid: Record<string, Record<string, MatchupRecord>> = {};

  for (const r of results) {
    for (const p of r.perPlayer) {
      if (!raceStats[p.race]) {
        raceStats[p.race] = {
          wins: 0, losses: 0, draws: 0, totalDamage: 0,
          totalUnitsSpawned: 0, totalUnitsLost: 0,
          totalGold: 0, totalWood: 0, totalStone: 0, appearances: 0,
        };
      }
      const s = raceStats[p.race];
      s.appearances++;
      if (r.winner === 'draw') s.draws++;
      else if (r.winner === p.team) s.wins++;
      else s.losses++;
      s.totalDamage += p.damageDealt;
      s.totalUnitsSpawned += p.unitsSpawned;
      s.totalUnitsLost += p.unitsLost;
      s.totalGold += p.goldEarned;
      s.totalWood += p.woodEarned;
      s.totalStone += p.stoneEarned;
    }

    // Cross-team matchup tracking
    const bottomPlayers = r.perPlayer.filter(p => p.team === 'bottom');
    const topPlayers = r.perPlayer.filter(p => p.team === 'top');
    for (const bp of bottomPlayers) {
      for (const tp of topPlayers) {
        if (!matchupGrid[bp.race]) matchupGrid[bp.race] = {};
        if (!matchupGrid[bp.race][tp.race]) matchupGrid[bp.race][tp.race] = { wins: 0, losses: 0, draws: 0, total: 0 };
        if (!matchupGrid[tp.race]) matchupGrid[tp.race] = {};
        if (!matchupGrid[tp.race][bp.race]) matchupGrid[tp.race][bp.race] = { wins: 0, losses: 0, draws: 0, total: 0 };

        matchupGrid[bp.race][tp.race].total++;
        matchupGrid[tp.race][bp.race].total++;

        if (r.winner === 'draw') {
          matchupGrid[bp.race][tp.race].draws++;
          matchupGrid[tp.race][bp.race].draws++;
        } else if (r.winner === 'bottom') {
          matchupGrid[bp.race][tp.race].wins++;
          matchupGrid[tp.race][bp.race].losses++;
        } else {
          matchupGrid[bp.race][tp.race].losses++;
          matchupGrid[tp.race][bp.race].wins++;
        }
      }
    }
  }

  return { raceStats, matchupGrid };
}

// ==================== PRINTING ====================

function pad(s: string, n: number): string {
  return s.length >= n ? s.substring(0, n) : s + ' '.repeat(n - s.length);
}

function printResults(results: MatchResult[]): void {
  const { raceStats, matchupGrid } = aggregate(results);
  const races = ALL_RACES.filter(r => raceStats[r]);

  // Win conditions breakdown
  const winConditions: Record<string, number> = {};
  let totalDuration = 0;
  for (const r of results) {
    winConditions[r.winCondition] = (winConditions[r.winCondition] ?? 0) + 1;
    totalDuration += r.durationTicks;
  }
  const avgDuration = totalDuration / results.length / TICK_RATE;

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  BALANCE SIMULATION — ${results.length} matches`);
  console.log(`  Avg duration: ${Math.floor(avgDuration / 60)}:${Math.floor(avgDuration % 60).toString().padStart(2, '0')}`);
  console.log(`  Win conditions: ${Object.entries(winConditions).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  console.log(`${'='.repeat(70)}\n`);

  // Race overview table
  console.log('  RACE OVERVIEW');
  console.log('  ' + '-'.repeat(90));
  console.log('  ' + pad('Race', 10) + pad('Games', 8) + pad('W', 6) + pad('L', 6) + pad('D', 6) +
    pad('Win%', 8) + pad('AvgDMG', 10) + pad('AvgSpwn', 10) + pad('AvgLost', 10) + pad('K/D', 8));
  console.log('  ' + '-'.repeat(90));

  for (const race of races) {
    const s = raceStats[race];
    const winPct = s.appearances > 0 ? Math.round(100 * s.wins / s.appearances) : 0;
    const avgDmg = s.appearances > 0 ? Math.round(s.totalDamage / s.appearances) : 0;
    const avgSpawn = s.appearances > 0 ? Math.round(s.totalUnitsSpawned / s.appearances) : 0;
    const avgLost = s.appearances > 0 ? Math.round(s.totalUnitsLost / s.appearances) : 0;
    const kd = s.totalUnitsLost > 0
      ? ((s.totalUnitsSpawned - s.totalUnitsLost) / s.totalUnitsLost).toFixed(1) : 'INF';

    console.log('  ' + pad(race, 10) + pad(String(s.appearances), 8) + pad(String(s.wins), 6) +
      pad(String(s.losses), 6) + pad(String(s.draws), 6) + pad(`${winPct}%`, 8) +
      pad(String(avgDmg), 10) + pad(String(avgSpawn), 10) + pad(String(avgLost), 10) + pad(kd, 8));
  }

  // Matchup grid
  console.log(`\n  MATCHUP GRID (win% from row's perspective)`);
  console.log('  ' + '-'.repeat(12 + races.length * 14));
  console.log('  ' + pad('vs', 12) + races.map(r => pad(r, 14)).join(''));
  console.log('  ' + '-'.repeat(12 + races.length * 14));

  for (const r1 of races) {
    let row = '  ' + pad(r1, 12);
    for (const r2 of races) {
      if (r1 === r2) {
        row += pad('  —', 14);
      } else {
        const m = matchupGrid[r1]?.[r2];
        if (m && m.total > 0) {
          const wp = Math.round(100 * m.wins / m.total);
          row += pad(`  ${wp}% (${m.total})`, 14);
        } else {
          row += pad('  —', 14);
        }
      }
    }
    console.log(row);
  }

  // Economy comparison
  console.log(`\n  ECONOMY (avg per game)`);
  console.log('  ' + '-'.repeat(50));
  console.log('  ' + pad('Race', 10) + pad('Gold', 10) + pad('Wood', 10) + pad('Stone', 10) + pad('Total', 10));
  console.log('  ' + '-'.repeat(50));
  for (const race of races) {
    const s = raceStats[race];
    const n = s.appearances || 1;
    const g = Math.round(s.totalGold / n);
    const w = Math.round(s.totalWood / n);
    const st = Math.round(s.totalStone / n);
    console.log('  ' + pad(race, 10) + pad(String(g), 10) + pad(String(w), 10) + pad(String(st), 10) + pad(String(g + w + st), 10));
  }

  console.log('');
}

// ==================== MAIN ====================

function main(): void {
  const args = process.argv.slice(2);
  const matchesPerMatchup = parseInt(args[0] ?? '', 10) || MATCHES_PER_MATCHUP;
  const quickMode = args.includes('--quick');

  let matchups: Matchup[];
  if (quickMode) {
    // Quick mode: only mirror matchups (each race pair vs itself) + round-robin 1v1 style
    matchups = [];
    for (let i = 0; i < ALL_RACES.length; i++) {
      for (let j = i + 1; j < ALL_RACES.length; j++) {
        // Race i+i vs Race j+j (pure mirror teams)
        matchups.push({ bottom: [ALL_RACES[i], ALL_RACES[i]], top: [ALL_RACES[j], ALL_RACES[j]] });
      }
    }
  } else {
    matchups = generateMatchups();
  }

  const totalMatches = matchups.length * matchesPerMatchup;
  console.log(`Running ${totalMatches} matches (${matchups.length} matchups x ${matchesPerMatchup} each)...`);
  if (quickMode) console.log('  (quick mode: mirror-team round robin only)');

  const results: MatchResult[] = [];
  let completed = 0;

  for (const mu of matchups) {
    for (let n = 0; n < matchesPerMatchup; n++) {
      const result = runHeadlessMatch(mu.bottom[0], mu.bottom[1], mu.top[0], mu.top[1]);
      results.push(result);
      completed++;
      if (completed % 10 === 0 || completed === totalMatches) {
        process.stdout.write(`\r  ${completed}/${totalMatches} matches completed`);
      }
    }
  }
  console.log('');

  printResults(results);
}

main();
