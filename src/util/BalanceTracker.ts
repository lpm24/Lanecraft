import { GameState, Race, Team, TICK_RATE } from '../simulation/types';

interface MatchRecord {
  timestamp: number;
  durationSec: number;
  winCondition: string;
  winnerTeam: string;
  players: {
    id: number;
    race: Race;
    team: string;
    isBot: boolean;
    won: boolean;
    damageDealt: number;
    damageNearHQ: number;
    unitsSpawned: number;
    unitsLost: number;
    nukeKills: number;
    goldEarned: number;
    woodEarned: number;
    stoneEarned: number;
    diamondPickups: number;
    diamondTimeHeld: number;
    buildingCount: number;
  }[];
}

interface RaceAggregates {
  wins: number;
  losses: number;
  totalDamage: number;
  totalResources: number;
  totalUnitsSpawned: number;
  totalUnitsLost: number;
  totalNukeKills: number;
  games: number;
  avgDurationSec: number;
}

const STORAGE_KEY = 'asciiwars.balanceLog';
const MAX_RECORDS = 200;

function loadRecords(): MatchRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveRecords(records: MatchRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(-MAX_RECORDS)));
  } catch { /* storage full */ }
}

export function recordMatch(state: GameState): void {
  const durationSec = Math.round(state.tick / TICK_RATE);
  const record: MatchRecord = {
    timestamp: Date.now(),
    durationSec,
    winCondition: state.winCondition ?? 'unknown',
    winnerTeam: state.winner === Team.Bottom ? 'bottom' : state.winner === Team.Top ? 'top' : 'none',
    players: state.players.map((p, i) => {
      const s = state.playerStats[i];
      const won = state.winner === p.team;
      return {
        id: i,
        race: p.race,
        team: p.team === Team.Bottom ? 'bottom' : 'top',
        isBot: p.isBot,
        won,
        damageDealt: s.totalDamageDealt,
        damageNearHQ: s.totalDamageNearHQ,
        unitsSpawned: s.unitsSpawned,
        unitsLost: s.unitsLost,
        nukeKills: s.nukeKills,
        goldEarned: s.totalGoldEarned,
        woodEarned: s.totalWoodEarned,
        stoneEarned: s.totalStoneEarned,
        diamondPickups: s.diamondPickups,
        diamondTimeHeld: s.diamondTimeHeld,
        buildingCount: state.buildings.filter(b => b.playerId === i).length,
      };
    }),
  };

  const records = loadRecords();
  records.push(record);
  saveRecords(records);

  printMatchSummary(record);
  printBalanceReport(records);
}

function printMatchSummary(r: MatchRecord): void {
  const mins = Math.floor(r.durationSec / 60);
  const secs = r.durationSec % 60;
  console.log(
    `%c=== MATCH RESULT (${mins}:${secs.toString().padStart(2, '0')}) — ${r.winCondition} — Winner: ${r.winnerTeam} ===`,
    'color: #ffd740; font-weight: bold; font-size: 14px'
  );
  console.table(r.players.map(p => ({
    Player: `P${p.id}${p.isBot ? ' (bot)' : ''}`,
    Race: p.race,
    Team: p.team,
    Won: p.won ? 'YES' : '',
    Damage: p.damageDealt,
    'Def DMG': p.damageNearHQ,
    Spawned: p.unitsSpawned,
    Lost: p.unitsLost,
    'K/D': p.unitsLost > 0 ? ((p.unitsSpawned - p.unitsLost) / p.unitsLost).toFixed(1) : '∞',
    Gold: p.goldEarned,
    Wood: p.woodEarned,
    Stone: p.stoneEarned,
    Nukes: p.nukeKills,
    Diamond: p.diamondPickups,
    Buildings: p.buildingCount,
  })));
}

function printBalanceReport(records: MatchRecord[]): void {
  const byRace: Record<string, RaceAggregates> = {};

  for (const r of records) {
    for (const p of r.players) {
      if (!byRace[p.race]) {
        byRace[p.race] = {
          wins: 0, losses: 0, totalDamage: 0, totalResources: 0,
          totalUnitsSpawned: 0, totalUnitsLost: 0, totalNukeKills: 0,
          games: 0, avgDurationSec: 0,
        };
      }
      const a = byRace[p.race];
      a.games++;
      if (p.won) a.wins++; else a.losses++;
      a.totalDamage += p.damageDealt;
      a.totalResources += p.goldEarned + p.woodEarned + p.stoneEarned;
      a.totalUnitsSpawned += p.unitsSpawned;
      a.totalUnitsLost += p.unitsLost;
      a.totalNukeKills += p.nukeKills;
      a.avgDurationSec += r.durationSec;
    }
  }

  // Compute averages
  for (const race of Object.keys(byRace)) {
    const a = byRace[race];
    if (a.games > 0) a.avgDurationSec = Math.round(a.avgDurationSec / a.games);
  }

  console.log(
    `%c=== BALANCE REPORT (${records.length} matches) ===`,
    'color: #81c784; font-weight: bold; font-size: 14px'
  );
  console.table(Object.entries(byRace).map(([race, a]) => ({
    Race: race,
    Games: a.games,
    Wins: a.wins,
    Losses: a.losses,
    'Win%': a.games > 0 ? `${Math.round(100 * a.wins / a.games)}%` : '-',
    'Avg DMG': a.games > 0 ? Math.round(a.totalDamage / a.games) : 0,
    'Avg Res': a.games > 0 ? Math.round(a.totalResources / a.games) : 0,
    'Avg Spawned': a.games > 0 ? Math.round(a.totalUnitsSpawned / a.games) : 0,
    'Avg Lost': a.games > 0 ? Math.round(a.totalUnitsLost / a.games) : 0,
    'Avg Nukes': a.games > 0 ? (a.totalNukeKills / a.games).toFixed(1) : '0',
    'Avg Duration': `${Math.floor(a.avgDurationSec / 60)}:${(a.avgDurationSec % 60).toString().padStart(2, '0')}`,
  })));

  // Race matchup matrix
  const races = Object.keys(byRace);
  if (races.length > 1) {
    const matchups: Record<string, Record<string, { wins: number; total: number }>> = {};
    for (const r of records) {
      // Group players by team
      const teams: Record<string, string[]> = {};
      for (const p of r.players) {
        if (!teams[p.team]) teams[p.team] = [];
        teams[p.team].push(p.race);
      }
      const teamKeys = Object.keys(teams);
      if (teamKeys.length !== 2) continue;
      const [t1, t2] = teamKeys;
      for (const r1 of teams[t1]) {
        for (const r2 of teams[t2]) {
          const won1 = r.players.find(p => p.race === r1 && p.team === t1)?.won ?? false;
          if (!matchups[r1]) matchups[r1] = {};
          if (!matchups[r1][r2]) matchups[r1][r2] = { wins: 0, total: 0 };
          matchups[r1][r2].total++;
          if (won1) matchups[r1][r2].wins++;
          if (!matchups[r2]) matchups[r2] = {};
          if (!matchups[r2][r1]) matchups[r2][r1] = { wins: 0, total: 0 };
          matchups[r2][r1].total++;
          if (!won1) matchups[r2][r1].wins++;
        }
      }
    }

    console.log(
      '%c=== RACE MATCHUPS (win%) ===',
      'color: #90caf9; font-weight: bold; font-size: 12px'
    );
    const header = ['vs', ...races];
    const rows = races.map(r1 => {
      const row: Record<string, string> = { vs: r1 };
      for (const r2 of races) {
        if (r1 === r2) { row[r2] = '-'; continue; }
        const m = matchups[r1]?.[r2];
        row[r2] = m && m.total > 0 ? `${Math.round(100 * m.wins / m.total)}% (${m.total})` : '-';
      }
      return row;
    });
    console.table(rows, header);
  }
}

/** Clear all stored balance data */
export function clearBalanceData(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  console.log('%cBalance data cleared.', 'color: #ff5722');
}

/** Print report from stored data without playing a match */
export function printStoredReport(): void {
  const records = loadRecords();
  if (records.length === 0) {
    console.log('No match data stored yet.');
    return;
  }
  printBalanceReport(records);
}

// Expose to window for console access
if (typeof window !== 'undefined') {
  (window as any).balanceClear = clearBalanceData;
  (window as any).balanceReport = printStoredReport;
}
