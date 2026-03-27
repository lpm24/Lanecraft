import { Race } from '../simulation/types';

// ─── ELO Rating System ───

const ELO_STORAGE_KEY = 'lanecraft.duelElo';
export const ELO_DEFAULT = 1200;
const ELO_K = 32;

function eloKey(race: Race, category: 'melee' | 'ranged' | 'caster', upgradeNode?: string): string {
  const node = upgradeNode ?? 'A';
  return `${race}:${category}:${node}`;
}

export function loadAllElo(): Record<string, number> {
  try {
    const raw = localStorage.getItem(ELO_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function saveAllElo(data: Record<string, number>): void {
  try { localStorage.setItem(ELO_STORAGE_KEY, JSON.stringify(data)); } catch {}
}

export function getElo(race: Race, category: 'melee' | 'ranged' | 'caster', upgradeNode?: string): number {
  const data = loadAllElo();
  return data[eloKey(race, category, upgradeNode)] ?? ELO_DEFAULT;
}

export interface EloUnit {
  race: Race;
  category: 'melee' | 'ranged' | 'caster';
  upgradeNode?: string;
}

export function updateTeamElo(teamA: EloUnit[], teamB: EloUnit[], winningSide: 'a' | 'b' | 'draw'): void {
  if (teamA.length === 0 || teamB.length === 0) return;
  const data = loadAllElo();

  const avgElo = (team: EloUnit[]) => {
    const sum = team.reduce((s, u) => s + (data[eloKey(u.race, u.category, u.upgradeNode)] ?? ELO_DEFAULT), 0);
    return sum / team.length;
  };

  const avgA = avgElo(teamA);
  const avgB = avgElo(teamB);

  for (const u of teamA) {
    const key = eloKey(u.race, u.category, u.upgradeNode);
    const elo = data[key] ?? ELO_DEFAULT;
    const expected = 1 / (1 + Math.pow(10, (avgB - elo) / 400));
    const score = winningSide === 'a' ? 1 : winningSide === 'draw' ? 0.5 : 0;
    data[key] = Math.round(elo + ELO_K * (score - expected));
  }

  for (const u of teamB) {
    const key = eloKey(u.race, u.category, u.upgradeNode);
    const elo = data[key] ?? ELO_DEFAULT;
    const expected = 1 / (1 + Math.pow(10, (avgA - elo) / 400));
    const score = winningSide === 'b' ? 1 : winningSide === 'draw' ? 0.5 : 0;
    data[key] = Math.round(elo + ELO_K * (score - expected));
  }

  saveAllElo(data);
}
