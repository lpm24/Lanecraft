import { createInitialState, simulateTick } from '../simulation/GameState';
import { GameCommand, Race, Team, TICK_RATE, MapDef } from '../simulation/types';
import { runAllBotAI, createBotContext, BotDifficultyLevel, BOT_DIFFICULTY_PRESETS } from '../simulation/BotAI';
import { DUEL_MAP, SKIRMISH_MAP, WARZONE_MAP } from '../simulation/maps';

// ==================== CONFIG ====================

const DEFAULT_MATCHES_PER_MATCHUP = 3;
const MAX_MATCH_TICKS = 15 * 60 * TICK_RATE; // 15 min game-time cap
const ALL_RACES = [Race.Crown, Race.Horde, Race.Goblins, Race.Oozlings, Race.Demon, Race.Deep, Race.Wild, Race.Geists, Race.Tenders];

// Map presets: maps + how many active players per team
interface MapPreset {
  mapDef: MapDef;
  playersPerTeam: number;
  label: string;
}

const MAP_PRESETS: Record<string, MapPreset> = {
  '1v1':      { mapDef: DUEL_MAP,     playersPerTeam: 1, label: '1v1 (Duel map)' },
  '2v2':      { mapDef: DUEL_MAP,     playersPerTeam: 2, label: '2v2 (Duel map)' },
  'duel':     { mapDef: DUEL_MAP,     playersPerTeam: 2, label: '2v2 (Duel map)' },
  '3v3':      { mapDef: SKIRMISH_MAP, playersPerTeam: 3, label: '3v3 (Skirmish map)' },
  'skirmish': { mapDef: SKIRMISH_MAP, playersPerTeam: 3, label: '3v3 (Skirmish map)' },
  '4v4':      { mapDef: WARZONE_MAP,  playersPerTeam: 4, label: '4v4 (Warzone map)' },
  'warzone':  { mapDef: WARZONE_MAP,  playersPerTeam: 4, label: '4v4 (Warzone map)' },
};

// ==================== TYPES ====================

interface MatchResult {
  teamRaces: [Race[], Race[]];  // [team0 races, team1 races]
  winner: 'bottom' | 'top' | 'draw';
  winCondition: string;
  durationTicks: number;
  perPlayer: {
    race: Race;
    team: string;
    isEmpty: boolean;
    damageDealt: number;
    damageTaken: number;
    towerDamage: number;
    burnDamage: number;
    abilityDamage: number;
    healing: number;
    unitsSpawned: number;
    unitsLost: number;
    goldEarned: number;
    woodEarned: number;
    meatEarned: number;
    buildingCount: number;
    nukeKills: number;
    diamondPickups: number;
    hqHp: number;
  }[];
}

// ==================== HEADLESS MATCH ====================

function runHeadlessMatch(
  team0Races: Race[], team1Races: Race[],
  mapDef: MapDef,
  difficulty: BotDifficultyLevel = BotDifficultyLevel.Medium,
): MatchResult {
  const ppt = mapDef.playersPerTeam;
  const players: { race: Race; isBot: boolean; isEmpty?: boolean }[] = [];

  // Fill team 0 slots
  for (let i = 0; i < ppt; i++) {
    if (i < team0Races.length) {
      players.push({ race: team0Races[i], isBot: true });
    } else {
      players.push({ race: Race.Crown, isBot: true, isEmpty: true });
    }
  }
  // Fill team 1 slots
  for (let i = 0; i < ppt; i++) {
    if (i < team1Races.length) {
      players.push({ race: team1Races[i], isBot: true });
    } else {
      players.push({ race: Race.Crown, isBot: true, isEmpty: true });
    }
  }

  const state = createInitialState(players, undefined, mapDef);

  const botCtx = createBotContext(difficulty);
  // Apply stat bonuses from difficulty to player state
  const defaultDiff = BOT_DIFFICULTY_PRESETS[difficulty];
  for (const p of state.players) {
    if (!p.isBot || p.isEmpty) continue;
    const diff = botCtx.difficulty[p.id] ?? defaultDiff;
    if (diff.statBonus && diff.statBonus !== 1) p.statBonus = diff.statBonus;
  }
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
    teamRaces: [team0Races, team1Races],
    winner,
    winCondition: state.winCondition ?? 'timeout',
    durationTicks: state.tick,
    perPlayer: state.players.map((p, i) => {
      const s = state.playerStats[i];
      return {
        race: p.race,
        team: p.team === Team.Bottom ? 'bottom' : 'top',
        isEmpty: p.isEmpty,
        damageDealt: s.totalDamageDealt,
        damageTaken: s.totalDamageTaken,
        towerDamage: s.towerDamageDealt,
        burnDamage: s.burnDamageDealt,
        abilityDamage: s.abilityDamageDealt,
        healing: s.totalHealing,
        unitsSpawned: s.unitsSpawned,
        unitsLost: s.unitsLost,
        goldEarned: s.totalGoldEarned,
        woodEarned: s.totalWoodEarned,
        meatEarned: s.totalMeatEarned,
        buildingCount: state.buildings.filter(b => b.playerId === i).length,
        nukeKills: s.nukeKills,
        diamondPickups: s.diamondPickups,
        hqHp: state.hqHp[p.team],
      };
    }),
  };
}

// ==================== MATCHUP GENERATION ====================

interface Matchup {
  team0: Race[];
  team1: Race[];
}

/** Mirror-team round robin: all slots on a team share the same race */
function generateMirrorMatchups(races: Race[], teamSize: number): Matchup[] {
  const matchups: Matchup[] = [];
  for (let i = 0; i < races.length; i++) {
    for (let j = i + 1; j < races.length; j++) {
      matchups.push({
        team0: Array(teamSize).fill(races[i]),
        team1: Array(teamSize).fill(races[j]),
      });
    }
  }
  return matchups;
}

/** Mixed-team (2-player teams only): each team has two different races */
function generateMixedMatchups(races: Race[], teamSize: number): Matchup[] {
  if (teamSize !== 2) {
    console.log('  Warning: --mixed only supports 2-player teams, falling back to mirror');
    return generateMirrorMatchups(races, teamSize);
  }
  const teamPairs: [Race, Race][] = [];
  for (let i = 0; i < races.length; i++) {
    for (let j = i + 1; j < races.length; j++) {
      teamPairs.push([races[i], races[j]]);
    }
  }
  const matchups: Matchup[] = [];
  for (let i = 0; i < teamPairs.length; i++) {
    for (let j = i; j < teamPairs.length; j++) {
      matchups.push({ team0: [...teamPairs[i]], team1: [...teamPairs[j]] });
    }
  }
  return matchups;
}

/** Full exhaustive (2-player teams only): all pair-vs-pair including mirrors */
function generateFullMatchups(races: Race[], teamSize: number): Matchup[] {
  if (teamSize !== 2) {
    console.log('  Warning: --full only supports 2-player teams, falling back to mirror');
    return generateMirrorMatchups(races, teamSize);
  }
  const teamPairs: [Race, Race][] = [];
  for (let i = 0; i < races.length; i++) {
    for (let j = i; j < races.length; j++) {
      teamPairs.push([races[i], races[j]]);
    }
  }
  const matchups: Matchup[] = [];
  for (let i = 0; i < teamPairs.length; i++) {
    for (let j = i; j < teamPairs.length; j++) {
      matchups.push({ team0: [...teamPairs[i]], team1: [...teamPairs[j]] });
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
  totalDamageTaken: number;
  totalTowerDamage: number;
  totalBurnDamage: number;
  totalAbilityDamage: number;
  totalHealing: number;
  totalUnitsSpawned: number;
  totalUnitsLost: number;
  totalGold: number;
  totalWood: number;
  totalMeat: number;
  totalNukeKills: number;
  totalDiamondPickups: number;
  totalHqHp: number;
  appearances: number;
  totalDurationTicks: number;
}

interface MatchupRecord {
  wins: number;
  losses: number;
  draws: number;
  total: number;
}

interface SynergyRecord {
  wins: number;
  total: number;
}

function aggregate(results: MatchResult[]) {
  const raceStats: Record<string, RaceStats> = {};
  const matchupGrid: Record<string, Record<string, MatchupRecord>> = {};
  const synergyGrid: Record<string, Record<string, SynergyRecord>> = {};

  for (const r of results) {
    // Skip empty players in aggregation
    const activePlayers = r.perPlayer.filter(p => !p.isEmpty);

    for (const p of activePlayers) {
      if (!raceStats[p.race]) {
        raceStats[p.race] = {
          wins: 0, losses: 0, draws: 0, totalDamage: 0,
          totalDamageTaken: 0, totalTowerDamage: 0, totalBurnDamage: 0,
          totalAbilityDamage: 0, totalHealing: 0,
          totalUnitsSpawned: 0, totalUnitsLost: 0,
          totalGold: 0, totalWood: 0, totalMeat: 0,
          totalNukeKills: 0, totalDiamondPickups: 0,
          totalHqHp: 0,
          appearances: 0, totalDurationTicks: 0,
        };
      }
      const s = raceStats[p.race];
      s.appearances++;
      s.totalDurationTicks += r.durationTicks;
      if (r.winner === 'draw') s.draws++;
      else if (r.winner === p.team) s.wins++;
      else s.losses++;
      s.totalDamage += p.damageDealt;
      s.totalDamageTaken += p.damageTaken;
      s.totalTowerDamage += p.towerDamage;
      s.totalBurnDamage += p.burnDamage;
      s.totalAbilityDamage += p.abilityDamage;
      s.totalHealing += p.healing;
      s.totalUnitsSpawned += p.unitsSpawned;
      s.totalUnitsLost += p.unitsLost;
      s.totalGold += p.goldEarned;
      s.totalWood += p.woodEarned;
      s.totalMeat += p.meatEarned;
      s.totalNukeKills += p.nukeKills;
      s.totalDiamondPickups += p.diamondPickups;
      s.totalHqHp += p.hqHp;
    }

    // Cross-team matchup tracking
    const bottomPlayers = activePlayers.filter(p => p.team === 'bottom');
    const topPlayers = activePlayers.filter(p => p.team === 'top');
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

    // Synergy tracking: how well do teammates work together?
    for (const players of [bottomPlayers, topPlayers]) {
      if (players.length === 2 && players[0].race !== players[1].race) {
        const won = r.winner === players[0].team;
        const r1 = players[0].race;
        const r2 = players[1].race;
        const key1 = r1 < r2 ? r1 : r2;
        const key2 = r1 < r2 ? r2 : r1;
        if (!synergyGrid[key1]) synergyGrid[key1] = {};
        if (!synergyGrid[key1][key2]) synergyGrid[key1][key2] = { wins: 0, total: 0 };
        synergyGrid[key1][key2].total++;
        if (won) synergyGrid[key1][key2].wins++;
      }
    }
  }

  return { raceStats, matchupGrid, synergyGrid };
}

// ==================== PRINTING ====================

function pad(s: string, n: number): string {
  return s.length >= n ? s.substring(0, n) : s + ' '.repeat(n - s.length);
}

function winPctColor(pct: number): string {
  if (pct >= 60) return '!!';  // overpowered
  if (pct >= 55) return '! ';  // slightly strong
  if (pct <= 40) return 'vv';  // underpowered
  if (pct <= 45) return 'v ';  // slightly weak
  return '  ';                  // balanced
}

function printResults(results: MatchResult[], mapLabel: string, raceFilter?: Race): void {
  const { raceStats, matchupGrid, synergyGrid } = aggregate(results);
  const races = ALL_RACES.filter(r => raceStats[r]);

  // Win conditions breakdown
  const winConditions: Record<string, number> = {};
  let totalDuration = 0;
  let shortestMatch = Infinity;
  let longestMatch = 0;
  for (const r of results) {
    winConditions[r.winCondition] = (winConditions[r.winCondition] ?? 0) + 1;
    totalDuration += r.durationTicks;
    if (r.durationTicks < shortestMatch) shortestMatch = r.durationTicks;
    if (r.durationTicks > longestMatch) longestMatch = r.durationTicks;
  }
  const avgDuration = totalDuration / results.length / TICK_RATE;
  const shortSec = shortestMatch / TICK_RATE;
  const longSec = longestMatch / TICK_RATE;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`  BALANCE SIMULATION — ${results.length} matches [${mapLabel}]`);
  console.log(`  Avg duration: ${fmtTime(avgDuration)} | Shortest: ${fmtTime(shortSec)} | Longest: ${fmtTime(longSec)}`);
  console.log(`  Win conditions: ${Object.entries(winConditions).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  console.log(`${'='.repeat(80)}\n`);

  // ---- TIER LIST ----
  console.log('  TIER LIST (sorted by win%)');
  console.log('  ' + '-'.repeat(94));
  console.log('  ' + pad('Tier', 6) + pad('Race', 10) + pad('Games', 8) + pad('W', 6) + pad('L', 6) + pad('D', 6) +
    pad('Win%', 8) + pad('AvgDMG', 10) + pad('AvgSpwn', 10) + pad('AvgLost', 10) + pad('Nukes', 8) + pad('Dmnd', 6));
  console.log('  ' + '-'.repeat(94));

  const sorted = races
    .map(race => ({ race, stats: raceStats[race] }))
    .sort((a, b) => {
      const aPct = a.stats.appearances > 0 ? a.stats.wins / a.stats.appearances : 0;
      const bPct = b.stats.appearances > 0 ? b.stats.wins / b.stats.appearances : 0;
      return bPct - aPct;
    });

  for (const { race, stats: s } of sorted) {
    const winPct = s.appearances > 0 ? Math.round(100 * s.wins / s.appearances) : 0;
    const avgDmg = s.appearances > 0 ? Math.round(s.totalDamage / s.appearances) : 0;
    const avgSpawn = s.appearances > 0 ? Math.round(s.totalUnitsSpawned / s.appearances) : 0;
    const avgLost = s.appearances > 0 ? Math.round(s.totalUnitsLost / s.appearances) : 0;
    const avgNukes = s.appearances > 0 ? (s.totalNukeKills / s.appearances).toFixed(1) : '0';
    const avgDiamond = s.appearances > 0 ? (s.totalDiamondPickups / s.appearances).toFixed(1) : '0';

    const tier = winPct >= 60 ? 'S' : winPct >= 55 ? 'A' : winPct >= 45 ? 'B' : winPct >= 40 ? 'C' : 'D';
    const flag = winPctColor(winPct);

    console.log('  ' + pad(tier + flag, 6) + pad(race, 10) + pad(String(s.appearances), 8) + pad(String(s.wins), 6) +
      pad(String(s.losses), 6) + pad(String(s.draws), 6) + pad(`${winPct}%`, 8) +
      pad(String(avgDmg), 10) + pad(String(avgSpawn), 10) + pad(String(avgLost), 10) +
      pad(avgNukes, 8) + pad(avgDiamond, 6));
  }

  // Balance score: how close is everyone to 50%?
  const winRates = sorted.map(s => s.stats.appearances > 0 ? s.stats.wins / s.stats.appearances : 0.5);
  const balanceDeviation = Math.sqrt(winRates.reduce((sum, wr) => sum + (wr - 0.5) ** 2, 0) / winRates.length);
  const balanceScore = Math.round(Math.max(0, 100 * (1 - balanceDeviation * 4)));
  console.log(`\n  Balance Score: ${balanceScore}/100 (100 = all races at 50% win rate, lower = more imbalanced)`);

  // ---- MATCHUP GRID ----
  console.log(`\n  MATCHUP GRID (win% from row's perspective)`);
  const colW = 12;
  console.log('  ' + '-'.repeat(12 + races.length * colW));
  console.log('  ' + pad('vs', 12) + races.map(r => pad(r.slice(0, colW - 2), colW)).join(''));
  console.log('  ' + '-'.repeat(12 + races.length * colW));

  for (const r1 of races) {
    let row = '  ' + pad(r1, 12);
    for (const r2 of races) {
      if (r1 === r2) {
        row += pad('  -', colW);
      } else {
        const m = matchupGrid[r1]?.[r2];
        if (m && m.total > 0) {
          const wp = Math.round(100 * m.wins / m.total);
          row += pad(`${wp}%(${m.total})`, colW);
        } else {
          row += pad('  -', colW);
        }
      }
    }
    console.log(row);
  }

  // ---- WORST MATCHUPS ----
  console.log(`\n  WORST MATCHUPS (most lopsided)`);
  console.log('  ' + '-'.repeat(50));
  const worstMatchups: { r1: string; r2: string; wp: number; total: number }[] = [];
  for (const r1 of races) {
    for (const r2 of races) {
      if (r1 >= r2) continue; // avoid duplicates
      const m = matchupGrid[r1]?.[r2];
      if (!m || m.total < 2) continue;
      const wp = Math.round(100 * m.wins / m.total);
      if (wp <= 30 || wp >= 70) {
        worstMatchups.push({ r1, r2, wp, total: m.total });
      }
    }
  }
  worstMatchups.sort((a, b) => Math.abs(b.wp - 50) - Math.abs(a.wp - 50));
  if (worstMatchups.length === 0) {
    console.log('  No severely lopsided matchups found (all within 30-70%)');
  } else {
    for (const wm of worstMatchups.slice(0, 10)) {
      const favored = wm.wp >= 50 ? wm.r1 : wm.r2;
      const underdog = wm.wp >= 50 ? wm.r2 : wm.r1;
      const margin = Math.abs(wm.wp - 50);
      console.log(`  ${pad(favored, 10)} >> ${pad(underdog, 10)} (${Math.max(wm.wp, 100 - wm.wp)}% over ${wm.total} games, +${margin}pt advantage)`);
    }
  }

  // ---- SYNERGY (only if mixed-team data exists) ----
  const synergyEntries: { pair: string; wp: number; total: number }[] = [];
  for (const r1 of Object.keys(synergyGrid)) {
    for (const r2 of Object.keys(synergyGrid[r1])) {
      const s = synergyGrid[r1][r2];
      if (s.total >= 3) {
        synergyEntries.push({ pair: `${r1} + ${r2}`, wp: Math.round(100 * s.wins / s.total), total: s.total });
      }
    }
  }
  if (synergyEntries.length > 0) {
    synergyEntries.sort((a, b) => b.wp - a.wp);
    console.log(`\n  BEST SYNERGIES (team pairs)`);
    console.log('  ' + '-'.repeat(50));
    for (const s of synergyEntries.slice(0, 8)) {
      console.log(`  ${pad(s.pair, 25)} ${s.wp}% win (${s.total} games)`);
    }
    console.log(`\n  WORST SYNERGIES (team pairs)`);
    console.log('  ' + '-'.repeat(50));
    for (const s of synergyEntries.slice(-8).reverse()) {
      console.log(`  ${pad(s.pair, 25)} ${s.wp}% win (${s.total} games)`);
    }
  }

  // ---- ECONOMY ----
  console.log(`\n  ECONOMY (avg per game)`);
  console.log('  ' + '-'.repeat(60));
  console.log('  ' + pad('Race', 10) + pad('Gold', 10) + pad('Wood', 10) + pad('Meat', 10) + pad('Total', 10) + pad('Res/Min', 10));
  console.log('  ' + '-'.repeat(60));
  for (const race of races) {
    const s = raceStats[race];
    const n = s.appearances || 1;
    const g = Math.round(s.totalGold / n);
    const w = Math.round(s.totalWood / n);
    const st = Math.round(s.totalMeat / n);
    const avgDurMin = (s.totalDurationTicks / n / TICK_RATE) / 60;
    const resPerMin = avgDurMin > 0 ? Math.round((g + w + st) / avgDurMin) : 0;
    console.log('  ' + pad(race, 10) + pad(String(g), 10) + pad(String(w), 10) + pad(String(st), 10) +
      pad(String(g + w + st), 10) + pad(String(resPerMin), 10));
  }

  // ---- COMBAT BREAKDOWN ----
  console.log(`\n  COMBAT BREAKDOWN (avg per game)`);
  console.log('  ' + '-'.repeat(100));
  console.log('  ' + pad('Race', 10) + pad('DmgDealt', 10) + pad('DmgTaken', 10) + pad('TowerDmg', 10) +
    pad('BurnDmg', 10) + pad('AbilDmg', 10) + pad('Healing', 10) + pad('NukeKills', 10) + pad('AvgHQ%', 10));
  console.log('  ' + '-'.repeat(100));
  for (const race of races) {
    const s = raceStats[race];
    const n = s.appearances || 1;
    const hqPct = Math.round((s.totalHqHp / n / 2000) * 100);
    console.log('  ' + pad(race, 10) +
      pad(String(Math.round(s.totalDamage / n)), 10) +
      pad(String(Math.round(s.totalDamageTaken / n)), 10) +
      pad(String(Math.round(s.totalTowerDamage / n)), 10) +
      pad(String(Math.round(s.totalBurnDamage / n)), 10) +
      pad(String(Math.round(s.totalAbilityDamage / n)), 10) +
      pad(String(Math.round(s.totalHealing / n)), 10) +
      pad(String((s.totalNukeKills / n).toFixed(1)), 10) +
      pad(hqPct + '%', 10));
  }

  // ---- SINGLE RACE DEEP DIVE ----
  if (raceFilter && raceStats[raceFilter]) {
    printRaceDeepDive(raceFilter, raceStats[raceFilter], matchupGrid, results);
  }

  console.log('');
}

function printRaceDeepDive(
  race: Race, stats: RaceStats,
  matchupGrid: Record<string, Record<string, MatchupRecord>>,
  results: MatchResult[],
): void {
  const winPct = stats.appearances > 0 ? Math.round(100 * stats.wins / stats.appearances) : 0;
  console.log(`\n  DEEP DIVE: ${race}`);
  console.log('  ' + '='.repeat(50));
  console.log(`  Win rate: ${winPct}% (${stats.wins}W / ${stats.losses}L / ${stats.draws}D over ${stats.appearances} games)`);
  console.log(`  Avg damage: ${Math.round(stats.totalDamage / (stats.appearances || 1))}`);
  console.log(`  Avg units spawned: ${Math.round(stats.totalUnitsSpawned / (stats.appearances || 1))}`);
  console.log(`  Avg units lost: ${Math.round(stats.totalUnitsLost / (stats.appearances || 1))}`);
  console.log(`  Avg nuke kills: ${(stats.totalNukeKills / (stats.appearances || 1)).toFixed(1)}`);
  console.log(`  Avg diamond pickups: ${(stats.totalDiamondPickups / (stats.appearances || 1)).toFixed(1)}`);

  // Win% by game duration
  const shortGames = results.filter(r => r.durationTicks < 4 * 60 * TICK_RATE);
  const midGames = results.filter(r => r.durationTicks >= 4 * 60 * TICK_RATE && r.durationTicks < 8 * 60 * TICK_RATE);
  const longGames = results.filter(r => r.durationTicks >= 8 * 60 * TICK_RATE);

  const winPctIn = (subset: MatchResult[]): string => {
    let w = 0, t = 0;
    for (const r of subset) {
      for (const p of r.perPlayer) {
        if (p.isEmpty || p.race !== race) continue;
        t++;
        if (r.winner === p.team) w++;
      }
    }
    return t > 0 ? `${Math.round(100 * w / t)}% (${t})` : 'N/A';
  };

  console.log(`  Win% by game length: Short(<4m)=${winPctIn(shortGames)}  Mid(4-8m)=${winPctIn(midGames)}  Long(8m+)=${winPctIn(longGames)}`);

  // Best/worst matchups for this race
  const matchups = matchupGrid[race];
  if (matchups) {
    const entries = Object.entries(matchups)
      .filter(([, m]) => m.total >= 2)
      .map(([opp, m]) => ({ opp, wp: Math.round(100 * m.wins / m.total), total: m.total }))
      .sort((a, b) => b.wp - a.wp);
    if (entries.length > 0) {
      console.log(`  Best matchups:  ${entries.slice(0, 3).map(e => `vs ${e.opp} ${e.wp}%(${e.total})`).join(', ')}`);
      console.log(`  Worst matchups: ${entries.slice(-3).reverse().map(e => `vs ${e.opp} ${e.wp}%(${e.total})`).join(', ')}`);
    }
  }
}

function fmtTime(sec: number): string {
  return `${Math.floor(sec / 60)}:${Math.floor(sec % 60).toString().padStart(2, '0')}`;
}

// ==================== MAIN ====================

function main(): void {
  const args = process.argv.slice(2);

  // Parse args
  const matchesPerMatchup = parseInt(args.find(a => /^\d+$/.test(a)) ?? '', 10) || DEFAULT_MATCHES_PER_MATCHUP;
  const fullMode = args.includes('--full');
  const mixedMode = args.includes('--mixed');
  const raceFilterArg = args.find(a => a.startsWith('--race='));
  const raceFilter = raceFilterArg ? raceFilterArg.split('=')[1] as Race : undefined;
  const diffArg = args.find(a => a.startsWith('--difficulty='));
  const difficulty = (diffArg?.split('=')[1] as BotDifficultyLevel) ?? BotDifficultyLevel.Medium;
  const mapArg = args.find(a => a.startsWith('--map='));
  const mapKey = mapArg?.split('=')[1] ?? '1v1';

  const preset = MAP_PRESETS[mapKey];
  if (!preset) {
    console.log(`Unknown map: "${mapKey}". Valid maps: ${Object.keys(MAP_PRESETS).join(', ')}`);
    process.exit(1);
  }

  // Validate race filter
  if (raceFilter && !ALL_RACES.includes(raceFilter)) {
    console.log(`Unknown race: "${raceFilter}". Valid races: ${ALL_RACES.join(', ')}`);
    process.exit(1);
  }

  const racesToTest = ALL_RACES;
  const teamSize = preset.playersPerTeam;

  let matchups: Matchup[];
  let modeName: string;
  if (fullMode) {
    matchups = generateFullMatchups(racesToTest, teamSize);
    modeName = 'full exhaustive';
  } else if (mixedMode) {
    matchups = generateMixedMatchups(racesToTest, teamSize);
    modeName = 'mixed-team';
  } else {
    matchups = generateMirrorMatchups(racesToTest, teamSize);
    modeName = 'mirror round robin';
  }

  const totalMatches = matchups.length * matchesPerMatchup;
  console.log(`Running ${totalMatches} matches (${matchups.length} matchups x ${matchesPerMatchup} each)...`);
  console.log(`  Mode: ${modeName} | Map: ${preset.label} | Difficulty: ${difficulty}`);
  if (raceFilter) console.log(`  Deep dive: ${raceFilter}`);
  console.log(`  Options: --map=1v1|2v2|3v3|4v4, --full, --mixed, --race=Name, --difficulty=easy|medium|hard|nightmare, N (matches/matchup)`);

  const results: MatchResult[] = [];
  let completed = 0;
  const startTime = Date.now();

  for (const mu of matchups) {
    for (let n = 0; n < matchesPerMatchup; n++) {
      const result = runHeadlessMatch(mu.team0, mu.team1, preset.mapDef, difficulty);
      results.push(result);
      completed++;
      if (completed % 10 === 0 || completed === totalMatches) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = completed / elapsed;
        const eta = rate > 0 ? Math.round((totalMatches - completed) / rate) : 0;
        process.stdout.write(`\r  ${completed}/${totalMatches} matches completed (${rate.toFixed(1)}/s, ETA ${eta}s)  `);
      }
    }
  }
  console.log('');

  printResults(results, preset.label, raceFilter);
}

main();
