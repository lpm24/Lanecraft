import { Race, BuildingType, GameState, TICK_RATE } from '../simulation/types';

// ─── Avatar ID format: "race:category" or "race:category:upgradeNode" ───

export interface AvatarDef {
  id: string;
  race: Race;
  category: 'melee' | 'ranged' | 'caster';
  upgradeNode?: string;       // e.g. 'G' for upgrade-path sprite variants
  achievementId?: string;     // null = unlocked by default
}

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  goal: number;               // target progress value
  avatarUnlock?: string;      // avatar ID unlocked
}

export interface RaceStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  playTimeSec: number;
  damageDealt: number;
  unitsSpawned: number;
  nukeKills: number;
  buildingsPlaced: number;
}

export interface PlayerProfile {
  version: 1;
  avatarId: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  winStreak: number;
  bestWinStreak: number;
  totalPlayTimeSec: number;
  raceStats: Partial<Record<Race, RaceStats>>;
  achievements: Record<string, { unlocked: boolean; unlockedAt: number; progress: number }>;
}

const STORAGE_KEY = 'spawnwars.profile';

const ALL_RACES: Race[] = [
  Race.Crown, Race.Horde, Race.Goblins, Race.Oozlings, Race.Demon,
  Race.Deep, Race.Wild, Race.Geists, Race.Tenders,
];

// ─── Default avatars (unlocked for everyone) ───

export const DEFAULT_AVATARS: AvatarDef[] = ALL_RACES.map(r => ({
  id: `${r}:melee`, race: r, category: 'melee' as const,
}));

// ─── Achievement-locked avatars ───

export const ACHIEVEMENT_AVATARS: AvatarDef[] = [
  { id: 'crown:ranged', race: Race.Crown, category: 'ranged', achievementId: 'first_blood' },
  { id: 'crown:caster', race: Race.Crown, category: 'caster', achievementId: 'centurion' },
  { id: 'horde:ranged', race: Race.Horde, category: 'ranged', achievementId: 'undefeated' },
  { id: 'horde:caster', race: Race.Horde, category: 'caster', achievementId: 'damage_dealer' },
  { id: 'goblins:ranged', race: Race.Goblins, category: 'ranged', achievementId: 'speed_demon' },
  { id: 'goblins:caster', race: Race.Goblins, category: 'caster', achievementId: 'nuke_happy' },
  { id: 'oozlings:ranged', race: Race.Oozlings, category: 'ranged', achievementId: 'swarm_lord' },
  { id: 'oozlings:caster', race: Race.Oozlings, category: 'caster', achievementId: 'veteran' },
  { id: 'demon:ranged', race: Race.Demon, category: 'ranged', achievementId: 'tower_fan' },
  { id: 'demon:caster', race: Race.Demon, category: 'caster', achievementId: 'race_master' },
  { id: 'deep:ranged', race: Race.Deep, category: 'ranged', achievementId: 'diamond_hands' },
  { id: 'deep:caster', race: Race.Deep, category: 'caster', achievementId: 'economist' },
  { id: 'wild:ranged', race: Race.Wild, category: 'ranged', achievementId: 'nature_wrath' },
  { id: 'wild:caster', race: Race.Wild, category: 'caster', achievementId: 'marathon' },
  { id: 'geists:ranged', race: Race.Geists, category: 'ranged', achievementId: 'undying' },
  { id: 'tenders:ranged', race: Race.Tenders, category: 'ranged', achievementId: 'tenders_touch' },
];

export const ALL_AVATARS: AvatarDef[] = [...DEFAULT_AVATARS, ...ACHIEVEMENT_AVATARS];

// ─── Achievement definitions ───

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_blood', name: 'First Blood', desc: 'Win your first game.', goal: 1, avatarUnlock: 'crown:ranged' },
  { id: 'centurion', name: 'Centurion', desc: 'Play 100 games.', goal: 100, avatarUnlock: 'crown:caster' },
  { id: 'race_master', name: 'Race Master', desc: 'Win with every race.', goal: 9, avatarUnlock: 'demon:caster' },
  { id: 'nuke_happy', name: 'Nuke Happy', desc: 'Get 50 total nuke kills.', goal: 50, avatarUnlock: 'goblins:caster' },
  { id: 'diamond_hands', name: 'Diamond Hands', desc: 'Pick up the diamond 20 times.', goal: 20, avatarUnlock: 'deep:ranged' },
  { id: 'speed_demon', name: 'Speed Demon', desc: 'Win a game under 3 minutes.', goal: 1, avatarUnlock: 'goblins:ranged' },
  { id: 'marathon', name: 'Marathon', desc: 'Win a game over 10 minutes.', goal: 1, avatarUnlock: 'wild:caster' },
  { id: 'swarm_lord', name: 'Swarm Lord', desc: 'Spawn 500 units as Oozlings.', goal: 500, avatarUnlock: 'oozlings:ranged' },
  { id: 'undying', name: 'Undying', desc: 'Win 10 games as Geists.', goal: 10, avatarUnlock: 'geists:ranged' },
  { id: 'tower_fan', name: 'Tower Fan', desc: 'Build 50 towers total.', goal: 50, avatarUnlock: 'demon:ranged' },
  { id: 'economist', name: 'Economist', desc: 'Build 100 harvester huts.', goal: 100, avatarUnlock: 'deep:caster' },
  { id: 'undefeated', name: 'Undefeated', desc: 'Win 5 games in a row.', goal: 5, avatarUnlock: 'horde:ranged' },
  { id: 'damage_dealer', name: 'Damage Dealer', desc: 'Deal 100,000 total damage.', goal: 100000, avatarUnlock: 'horde:caster' },
  { id: 'nature_wrath', name: "Nature's Wrath", desc: 'Deal 50,000 damage as Tenders.', goal: 50000, avatarUnlock: 'wild:ranged' },
  { id: 'veteran', name: 'Veteran', desc: 'Play 50 games.', goal: 50, avatarUnlock: 'oozlings:caster' },
  { id: 'tenders_touch', name: "Tender's Touch", desc: 'Win 10 games as Tenders.', goal: 10, avatarUnlock: 'tenders:ranged' },
];

// ─── Load / Save ───

export function createDefaultProfile(): PlayerProfile {
  return {
    version: 1,
    avatarId: 'crown:melee',
    gamesPlayed: 0, wins: 0, losses: 0,
    winStreak: 0, bestWinStreak: 0,
    totalPlayTimeSec: 0,
    raceStats: {},
    achievements: {},
  };
}

export function loadProfile(): PlayerProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as PlayerProfile;
      if (p.version === 1) return p;
    }
  } catch { /* corrupt data */ }
  return createDefaultProfile();
}

export function saveProfile(profile: PlayerProfile): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); } catch {}
}

// ─── Helpers ───

function ensureRaceStats(profile: PlayerProfile, race: Race): RaceStats {
  if (!profile.raceStats[race]) {
    profile.raceStats[race] = {
      gamesPlayed: 0, wins: 0, losses: 0, playTimeSec: 0,
      damageDealt: 0, unitsSpawned: 0, nukeKills: 0, buildingsPlaced: 0,
    };
  }
  return profile.raceStats[race]!;
}

function ensureAch(profile: PlayerProfile, id: string) {
  if (!profile.achievements[id]) {
    profile.achievements[id] = { unlocked: false, unlockedAt: 0, progress: 0 };
  }
  return profile.achievements[id];
}

// ─── Update profile after match ───

export function updateProfileFromMatch(
  profile: PlayerProfile, state: GameState, localPlayerId: number,
): string[] {
  const player = state.players[localPlayerId];
  if (!player || player.isBot) return [];

  const stats = state.playerStats[localPlayerId];
  const won = state.winner === player.team;
  const durationSec = Math.round(state.tick / TICK_RATE);
  const race = player.race;

  // Global stats
  profile.gamesPlayed++;
  if (won) { profile.wins++; profile.winStreak++; }
  else { profile.losses++; profile.winStreak = 0; }
  if (profile.winStreak > profile.bestWinStreak) {
    profile.bestWinStreak = profile.winStreak;
  }
  profile.totalPlayTimeSec += durationSec;

  // Race stats
  const rs = ensureRaceStats(profile, race);
  rs.gamesPlayed++;
  if (won) rs.wins++; else rs.losses++;
  rs.playTimeSec += durationSec;
  rs.damageDealt += stats.totalDamageDealt;
  rs.unitsSpawned += stats.unitsSpawned;
  rs.nukeKills += stats.nukeKills;
  const myBuildings = state.buildings.filter(b => b.playerId === localPlayerId);
  rs.buildingsPlaced += myBuildings.length;

  // Count building types for achievements
  const towerCount = myBuildings.filter(b => b.type === BuildingType.Tower).length;
  const hutCount = myBuildings.filter(b => b.type === BuildingType.HarvesterHut).length;

  // ─── Check achievements ───
  const newlyUnlocked: string[] = [];
  const check = (id: string, progress: number) => {
    const a = ensureAch(profile, id);
    if (a.unlocked) return;
    a.progress = Math.max(a.progress, progress);
    const def = ACHIEVEMENTS.find(d => d.id === id);
    if (def && a.progress >= def.goal) {
      a.unlocked = true;
      a.unlockedAt = Date.now();
      newlyUnlocked.push(id);
    }
  };
  const checkIncr = (id: string, increment: number) => {
    const a = ensureAch(profile, id);
    if (a.unlocked) return;
    a.progress += increment;
    const def = ACHIEVEMENTS.find(d => d.id === id);
    if (def && a.progress >= def.goal) {
      a.unlocked = true;
      a.unlockedAt = Date.now();
      newlyUnlocked.push(id);
    }
  };

  // First Blood — win 1
  if (won) check('first_blood', profile.wins);

  // Centurion — 100 games
  check('centurion', profile.gamesPlayed);

  // Veteran — 50 games
  check('veteran', profile.gamesPlayed);

  // Race Master — win with all 9 races
  const racesWon = ALL_RACES.filter(r => (profile.raceStats[r]?.wins ?? 0) > 0).length;
  check('race_master', racesWon);

  // Nuke Happy — 50 nuke kills total
  const totalNukes = ALL_RACES.reduce((s, r) => s + (profile.raceStats[r]?.nukeKills ?? 0), 0);
  check('nuke_happy', totalNukes);

  // Diamond Hands — 20 pickups
  checkIncr('diamond_hands', stats.diamondPickups);

  // Speed Demon — win under 3 min
  if (won && durationSec < 180) check('speed_demon', 1);

  // Marathon — win over 10 min
  if (won && durationSec > 600) check('marathon', 1);

  // Swarm Lord — 500 units as Oozlings
  if (race === Race.Oozlings) {
    const oozStats = profile.raceStats[Race.Oozlings]!;
    check('swarm_lord', oozStats.unitsSpawned);
  }

  // Undying — 10 wins as Geists
  if (race === Race.Geists && won) {
    check('undying', profile.raceStats[Race.Geists]!.wins);
  }

  // Tower Fan — 50 towers
  checkIncr('tower_fan', towerCount);

  // Economist — 100 huts
  checkIncr('economist', hutCount);

  // Undefeated — 5 win streak
  check('undefeated', profile.winStreak);

  // Damage Dealer — 100k total damage
  const totalDmg = ALL_RACES.reduce((s, r) => s + (profile.raceStats[r]?.damageDealt ?? 0), 0);
  check('damage_dealer', totalDmg);

  // Nature's Wrath — 50k damage as Tenders
  if (race === Race.Tenders) {
    check('nature_wrath', profile.raceStats[Race.Tenders]!.damageDealt);
  }

  // Tender's Touch — 10 wins as Tenders
  if (race === Race.Tenders && won) {
    check('tenders_touch', profile.raceStats[Race.Tenders]!.wins);
  }

  saveProfile(profile);
  return newlyUnlocked;
}

// ─── Query helpers ───

export function isAvatarUnlocked(profile: PlayerProfile, avatarDef: AvatarDef): boolean {
  if (!avatarDef.achievementId) return true; // default avatars
  return profile.achievements[avatarDef.achievementId]?.unlocked ?? false;
}

export function getWinRate(wins: number, games: number): string {
  if (games === 0) return '-';
  return `${Math.round(100 * wins / games)}%`;
}

export function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
