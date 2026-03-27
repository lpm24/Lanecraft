/**
 * Profile Comparison Simulator
 *
 * Tests different unit-composition profiles for a single race by comparing
 * performance metrics (damage, efficiency, game duration) when playing from
 * the same side position against each enemy race.
 *
 * Since the simulation has a consistent bottom-team advantage in mirror matches,
 * we always place the test profile on bottom and compare metrics across profiles.
 * Higher damage dealt and lower damage taken = better profile for that matchup.
 *
 * Usage:
 *   npm run profile-sim
 *   npm run profile-sim -- --race=crown --matches=3 --difficulty=hard
 */

import { createInitialState, simulateTick } from '../simulation/GameState';
import { GameCommand, Race, Team, TICK_RATE } from '../simulation/types';
import {
  runAllBotAI, createBotContext, BotDifficultyLevel,
  RaceProfile, getCompositionProfiles, ProfileId,
} from '../simulation/BotAI';
import { DUEL_MAP } from '../simulation/maps';

const MAX_MATCH_TICKS = 15 * 60 * TICK_RATE;
const ALL_RACES = [Race.Crown, Race.Horde, Race.Goblins, Race.Oozlings, Race.Demon, Race.Deep, Race.Wild, Race.Geists, Race.Tenders];

// ==================== PROFILE DEFINITIONS ====================

const PROFILE_NAMES: Record<ProfileId, string> = {
  default: 'Default', heavyMelee: 'HeavyMelee', heavyRanged: 'HeavyRanged',
  heavyCaster: 'HeavyCaster', meleeCaster: 'Melee+Cast', rangedCaster: 'Rng+Cast',
  rush: 'Rush', turtle: 'Turtle',
};

const PROFILE_DESCS: Record<ProfileId, string> = {
  default: 'Current standard profile', heavyMelee: 'Max melee, minimal ranged/caster',
  heavyRanged: 'Max ranged, minimal melee/caster', heavyCaster: 'Max casters, melee frontline',
  meleeCaster: 'Melee + caster, skip ranged', rangedCaster: 'Ranged + caster, minimal melee',
  rush: 'Early aggro, skip econ', turtle: 'Heavy econ + towers',
};

interface NamedProfile {
  name: string;
  description: string;
  profile: RaceProfile;
}

function generateProfiles(race: Race): NamedProfile[] {
  return getCompositionProfiles(race).map(cp => ({
    name: PROFILE_NAMES[cp.id],
    description: PROFILE_DESCS[cp.id],
    profile: cp.profile,
  }));
}

// ==================== MATCH RUNNER ====================

interface MatchMetrics {
  durationTicks: number;
  testDamage: number;
  testDamageTaken: number;
  testSpawned: number;
  testLost: number;
  testHqHp: number;
  enemyHqHp: number;
  testBuildings: number;
  testTowerDmg: number;
  testBurnDmg: number;
  testHealing: number;
}

function runMatch(
  testRace: Race, testProfile: RaceProfile,
  enemyRace: Race,
  difficulty: BotDifficultyLevel,
  seed: number,
): MatchMetrics {
  const players = [
    { race: testRace, isBot: true },   // always bottom
    { race: enemyRace, isBot: true },   // always top
  ];

  const state = createInitialState(players, seed, DUEL_MAP);
  const botCtx = createBotContext(difficulty);
  botCtx.profileOverride = { 0: testProfile };

  const commands: GameCommand[] = [];
  const emit = (cmd: GameCommand) => commands.push(cmd);

  while (state.matchPhase !== 'ended' && state.tick < MAX_MATCH_TICKS) {
    commands.length = 0;
    runAllBotAI(state, botCtx, emit);
    simulateTick(state, commands);
  }

  const s = state.playerStats[0];
  return {
    durationTicks: state.tick,
    testDamage: s.totalDamageDealt,
    testDamageTaken: s.totalDamageTaken,
    testSpawned: s.unitsSpawned,
    testLost: s.unitsLost,
    testHqHp: state.hqHp[Team.Bottom],
    enemyHqHp: state.hqHp[Team.Top],
    testBuildings: state.buildings.filter(b => b.playerId === 0).length,
    testTowerDmg: s.towerDamageDealt,
    testBurnDmg: s.burnDamageDealt,
    testHealing: s.totalHealing,
  };
}

// ==================== AGGREGATION ====================

interface ProfileMetrics {
  name: string;
  description: string;
  vsRace: Record<string, {
    games: number;
    avgDuration: number;
    avgDamage: number;
    avgDamageTaken: number;
    avgSpawned: number;
    avgLost: number;
    avgEnemyHqHp: number;
    avgTowerDmg: number;
    avgBurnDmg: number;
    avgHealing: number;
    efficiency: number; // damage dealt per unit lost
  }>;
  overall: {
    games: number;
    avgDamage: number;
    avgDamageTaken: number;
    avgDuration: number;
    avgEnemyHqHp: number;
    efficiency: number;
  };
}

// ==================== PRINTING ====================

function pad(s: string, n: number): string {
  return s.length >= n ? s.substring(0, n) : s + ' '.repeat(n - s.length);
}

function fmtTime(sec: number): string {
  return `${Math.floor(sec / 60)}:${Math.floor(sec % 60).toString().padStart(2, '0')}`;
}

// ==================== MAIN ====================

function main(): void {
  const args = process.argv.slice(2);

  const raceArg = args.find(a => a.startsWith('--race='));
  const testRace = (raceArg?.split('=')[1] as Race) ?? Race.Crown;
  const matchesArg = args.find(a => a.startsWith('--matches='));
  const matchesPerEnemy = parseInt(matchesArg?.split('=')[1] ?? '', 10) || 3;
  const diffArg = args.find(a => a.startsWith('--difficulty='));
  const difficulty = (diffArg?.split('=')[1] as BotDifficultyLevel) ?? BotDifficultyLevel.Hard;

  if (!ALL_RACES.includes(testRace)) {
    console.log(`Unknown race: "${testRace}". Valid: ${ALL_RACES.join(', ')}`);
    process.exit(1);
  }

  const profiles = generateProfiles(testRace);
  const enemies = ALL_RACES.filter(r => r !== testRace);
  const totalMatches = profiles.length * enemies.length * matchesPerEnemy;

  console.log(`Profile Comparison for ${testRace.toUpperCase()}`);
  console.log(`  ${profiles.length} profiles x ${enemies.length} enemies x ${matchesPerEnemy} matches = ${totalMatches} total`);
  console.log(`  Difficulty: ${difficulty} | Map: 1v1 Duel`);
  console.log(`  Note: All profiles play as bottom team. Comparing metrics, not win/loss.`);
  console.log(`  Options: --race=Name, --matches=N, --difficulty=easy|medium|hard|nightmare\n`);

  const allResults: ProfileMetrics[] = [];
  let completed = 0;
  const startTime = Date.now();

  for (let pi = 0; pi < profiles.length; pi++) {
    const prof = profiles[pi];
    const metrics: ProfileMetrics = {
      name: prof.name,
      description: prof.description,
      vsRace: {},
      overall: { games: 0, avgDamage: 0, avgDamageTaken: 0, avgDuration: 0, avgEnemyHqHp: 0, efficiency: 0 },
    };

    let totalDmg = 0, totalTaken = 0, totalDur = 0, totalEnemyHq = 0, totalSpawned = 0, totalLost = 0;

    for (let ei = 0; ei < enemies.length; ei++) {
      const enemy = enemies[ei];
      let dmg = 0, taken = 0, spawned = 0, lost = 0, dur = 0, ehq = 0, towerD = 0, burnD = 0, heal = 0;

      for (let n = 0; n < matchesPerEnemy; n++) {
        const seed = (pi * 100000 + ei * 10000 + n * 137 + 54321) >>> 0;
        const m = runMatch(testRace, prof.profile, enemy, difficulty, seed);
        dmg += m.testDamage;
        taken += m.testDamageTaken;
        spawned += m.testSpawned;
        lost += m.testLost;
        dur += m.durationTicks;
        ehq += m.enemyHqHp;
        towerD += m.testTowerDmg;
        burnD += m.testBurnDmg;
        heal += m.testHealing;

        completed++;
        if (completed % 5 === 0 || completed === totalMatches) {
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = completed / elapsed;
          const eta = rate > 0 ? Math.round((totalMatches - completed) / rate) : 0;
          process.stdout.write(`\r  ${completed}/${totalMatches} matches (${rate.toFixed(1)}/s, ETA ${eta}s)  `);
        }
      }

      const g = matchesPerEnemy;
      metrics.vsRace[enemy] = {
        games: g,
        avgDuration: dur / g,
        avgDamage: dmg / g,
        avgDamageTaken: taken / g,
        avgSpawned: spawned / g,
        avgLost: lost / g,
        avgEnemyHqHp: ehq / g,
        avgTowerDmg: towerD / g,
        avgBurnDmg: burnD / g,
        avgHealing: heal / g,
        efficiency: lost > 0 ? dmg / lost : dmg,
      };

      totalDmg += dmg; totalTaken += taken; totalDur += dur; totalEnemyHq += ehq;
      totalSpawned += spawned; totalLost += lost;
    }

    const totalGames = enemies.length * matchesPerEnemy;
    metrics.overall = {
      games: totalGames,
      avgDamage: totalDmg / totalGames,
      avgDamageTaken: totalTaken / totalGames,
      avgDuration: totalDur / totalGames,
      avgEnemyHqHp: totalEnemyHq / totalGames,
      efficiency: totalLost > 0 ? totalDmg / totalLost : totalDmg,
    };

    allResults.push(metrics);
  }
  console.log('\n');

  // ==================== PRINT ====================

  console.log(`${'='.repeat(110)}`);
  console.log(`  PROFILE COMPARISON — ${testRace.toUpperCase()}`);
  console.log(`${'='.repeat(110)}\n`);

  // Sort by most damage dealt (proxy for effectiveness)
  const sorted = [...allResults].sort((a, b) => b.overall.avgDamage - a.overall.avgDamage);

  // Overall ranking
  console.log('  OVERALL RANKING (by avg damage dealt — higher = more effective)');
  console.log('  ' + '-'.repeat(105));
  console.log('  ' + pad('Rank', 5) + pad('Profile', 14) + pad('AvgDmg', 10) + pad('AvgTaken', 10) +
    pad('Effic', 10) + pad('AvgDur', 9) + pad('EnemyHQ', 10) + pad('Description', 35));
  console.log('  ' + '-'.repeat(105));

  sorted.forEach((p, idx) => {
    const o = p.overall;
    const marker = p.name === 'Default' ? ' <--' : '';
    console.log('  ' + pad(`#${idx + 1}`, 5) + pad(p.name, 14) +
      pad(String(Math.round(o.avgDamage)), 10) +
      pad(String(Math.round(o.avgDamageTaken)), 10) +
      pad(String(Math.round(o.efficiency)), 10) +
      pad(fmtTime(o.avgDuration / TICK_RATE), 9) +
      pad(String(Math.round(o.avgEnemyHqHp)), 10) +
      pad(p.description, 35) + marker);
  });

  // Per-enemy damage comparison
  console.log(`\n  DAMAGE DEALT BY MATCHUP (higher = better)`);
  console.log('  ' + '-'.repeat(14 + enemies.length * 10));
  console.log('  ' + pad('Profile', 14) + enemies.map(r => pad(r.slice(0, 8), 10)).join(''));
  console.log('  ' + '-'.repeat(14 + enemies.length * 10));

  for (const p of sorted) {
    let row = '  ' + pad(p.name, 14);
    for (const enemy of enemies) {
      const vs = p.vsRace[enemy];
      row += pad(vs ? String(Math.round(vs.avgDamage)) : '-', 10);
    }
    console.log(row);
  }

  // Enemy HQ remaining (lower = more damage to HQ = better)
  console.log(`\n  ENEMY HQ REMAINING (lower = more effective at reaching HQ)`);
  console.log('  ' + '-'.repeat(14 + enemies.length * 10));
  console.log('  ' + pad('Profile', 14) + enemies.map(r => pad(r.slice(0, 8), 10)).join(''));
  console.log('  ' + '-'.repeat(14 + enemies.length * 10));

  for (const p of sorted) {
    let row = '  ' + pad(p.name, 14);
    for (const enemy of enemies) {
      const vs = p.vsRace[enemy];
      row += pad(vs ? String(Math.round(vs.avgEnemyHqHp)) : '-', 10);
    }
    console.log(row);
  }

  // Game duration (faster kills = better)
  console.log(`\n  AVG GAME DURATION (shorter = faster kill)`);
  console.log('  ' + '-'.repeat(14 + enemies.length * 10));
  console.log('  ' + pad('Profile', 14) + enemies.map(r => pad(r.slice(0, 8), 10)).join(''));
  console.log('  ' + '-'.repeat(14 + enemies.length * 10));

  for (const p of sorted) {
    let row = '  ' + pad(p.name, 14);
    for (const enemy of enemies) {
      const vs = p.vsRace[enemy];
      row += pad(vs ? fmtTime(vs.avgDuration / TICK_RATE) : '-', 10);
    }
    console.log(row);
  }

  // Best profile per matchup
  console.log(`\n  BEST PROFILE PER MATCHUP (by damage dealt)`);
  console.log('  ' + '-'.repeat(60));
  for (const enemy of enemies) {
    let bestName = '';
    let bestDmg = -1;
    let defaultDmg = 0;
    for (const p of allResults) {
      const vs = p.vsRace[enemy];
      if (!vs) continue;
      if (vs.avgDamage > bestDmg) { bestDmg = vs.avgDamage; bestName = p.name; }
      if (p.name === 'Default') defaultDmg = vs.avgDamage;
    }
    const diff = Math.round(bestDmg - defaultDmg);
    const pctDiff = defaultDmg > 0 ? Math.round(100 * diff / defaultDmg) : 0;
    const diffStr = diff > 0 ? `+${diff} (+${pctDiff}%)` : `${diff} (${pctDiff}%)`;
    console.log(`  vs ${pad(enemy, 10)} => ${pad(bestName, 14)} ${Math.round(bestDmg)} dmg (${diffStr} vs default)`);
  }

  // Summary
  console.log(`\n  SUMMARY`);
  console.log('  ' + '-'.repeat(60));
  const defaultP = allResults.find(p => p.name === 'Default')!;
  const bestP = sorted[0];
  const worstP = sorted[sorted.length - 1];
  const dmgDiff = Math.round(bestP.overall.avgDamage - defaultP.overall.avgDamage);
  const dmgDiffPct = defaultP.overall.avgDamage > 0 ? Math.round(100 * dmgDiff / defaultP.overall.avgDamage) : 0;
  console.log(`  Default profile:  #${sorted.indexOf(defaultP) + 1} of ${profiles.length} (${Math.round(defaultP.overall.avgDamage)} avg dmg)`);
  console.log(`  Most effective:   ${bestP.name} (${Math.round(bestP.overall.avgDamage)} avg dmg, ${dmgDiff > 0 ? '+' : ''}${dmgDiffPct}% vs default)`);
  console.log(`  Least effective:  ${worstP.name} (${Math.round(worstP.overall.avgDamage)} avg dmg)`);
  console.log('');
}

main();
