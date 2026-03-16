import { Race } from '../simulation/types';
import { getMapById, DUEL_MAP } from '../simulation/maps';
import { PartyState } from '../network/PartyManager';

// ─── Local party setup (no Firebase required) ───

export interface LocalSetup {
  mapId: string;
  maxSlots: number;
  /** Per-slot bot difficulty. Missing key = empty slot. */
  bots: { [slot: string]: string };
  /** Per-slot bot race. Missing key or 'random' = random at game start. */
  botRaces?: { [slot: string]: string };
  playerSlot: number;
  playerRace: Race | 'random';
  /** Players per team (1 = 1v1, 2 = 2v2). Default = map's playersPerTeam. */
  teamSize?: number;
  /** Whether fog of war is enabled. Default = true. */
  fogOfWar?: boolean;
}

const LOCAL_SETUP_KEY = 'spawnwars.localSetup';

export function saveLocalSetup(setup: LocalSetup): void {
  try { localStorage.setItem(LOCAL_SETUP_KEY, JSON.stringify(setup)); } catch {}
}

export function loadLocalSetup(): LocalSetup | null {
  try {
    const raw = localStorage.getItem(LOCAL_SETUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Validate it has required fields
    if (parsed && typeof parsed.mapId === 'string' && typeof parsed.playerSlot === 'number') {
      return parsed as LocalSetup;
    }
  } catch {}
  return null;
}

export function createDefaultLocalSetup(): LocalSetup {
  const mapDef = DUEL_MAP;
  // Default to 1v1: one bot on the enemy team's first slot
  const bots: { [slot: string]: string } = {};
  const enemyFirstSlot = mapDef.playersPerTeam; // slot 2 on duel map
  bots[String(enemyFirstSlot)] = 'medium';
  return {
    mapId: mapDef.id,
    maxSlots: mapDef.maxPlayers,
    bots,
    playerSlot: 0,
    playerRace: 'random',
    teamSize: 1,
    fogOfWar: true,
  };
}

/** Get locally-active slot indices for a local setup based on teamSize. */
export function getLocalActiveSlots(setup: LocalSetup): number[] {
  const mapDef = getMapById(setup.mapId);
  const teamSize = setup.teamSize ?? mapDef.playersPerTeam;
  const slots: number[] = [];
  for (let t = 0; t < mapDef.teams.length; t++) {
    for (let s = 0; s < teamSize; s++) {
      slots.push(t * mapDef.playersPerTeam + s);
    }
  }
  return slots;
}

/** Check if each team has at least 1 occupied slot (player or bot) among active slots. */
export function canStartLocalSetup(setup: LocalSetup): boolean {
  const mapDef = getMapById(setup.mapId);
  const ppt = mapDef.playersPerTeam;
  const teamSize = setup.teamSize ?? ppt;
  const teams = mapDef.teams.length;
  for (let t = 0; t < teams; t++) {
    const start = t * ppt;
    const end = start + teamSize;
    let hasOccupant = false;
    for (let i = start; i < end; i++) {
      if (i === setup.playerSlot || setup.bots[String(i)]) {
        hasOccupant = true;
        break;
      }
    }
    if (!hasOccupant) return false;
  }
  return true;
}

/** Check if each team has at least 1 occupant (human or bot) among active party slots. */
export function canStartParty(ps: PartyState): boolean {
  const mapDef = getMapById(ps.mapId ?? 'duel');
  const ppt = mapDef.playersPerTeam;
  const teamSize = ps.teamSize ?? ppt;
  for (let t = 0; t < mapDef.teams.length; t++) {
    const start = t * ppt;
    const end = start + teamSize;
    let hasOccupant = false;
    for (let i = start; i < end; i++) {
      if (ps.players[String(i)] || ps.bots?.[String(i)]) {
        hasOccupant = true;
        break;
      }
    }
    if (!hasOccupant) return false;
  }
  return true;
}
