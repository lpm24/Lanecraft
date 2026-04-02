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
  fastWins?: number;          // wins under 5 minutes
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

const STORAGE_KEY = 'lanecraft.profile';

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
  { id: 'geists:caster', race: Race.Geists, category: 'caster', achievementId: 'soul_harvest' },
  { id: 'tenders:ranged', race: Race.Tenders, category: 'ranged', achievementId: 'tenders_touch' },
  { id: 'tenders:caster', race: Race.Tenders, category: 'caster', achievementId: 'green_thumb' },
  // Upgrade-tier avatars (tough achievements)
  { id: 'geists:melee:G', race: Race.Geists, category: 'melee', upgradeNode: 'G', achievementId: 'mimic_master' },
  { id: 'crown:ranged:G', race: Race.Crown, category: 'ranged', upgradeNode: 'G', achievementId: 'dwarfette_elite' },
  { id: 'wild:melee:D', race: Race.Wild, category: 'melee', upgradeNode: 'D', achievementId: 'bull_rush' },
  { id: 'wild:melee:B', race: Race.Wild, category: 'melee', upgradeNode: 'B', achievementId: 'apex_predator' },
  { id: 'deep:melee:G', race: Race.Deep, category: 'melee', upgradeNode: 'G', achievementId: 'frog_royalty' },
  { id: 'tenders:caster:G', race: Race.Tenders, category: 'caster', upgradeNode: 'G', achievementId: 'fungal_lord' },
  { id: 'geists:caster:G', race: Race.Geists, category: 'caster', upgradeNode: 'G', achievementId: 'dark_sorcerer' },
  { id: 'tenders:melee:E', race: Race.Tenders, category: 'melee', upgradeNode: 'E', achievementId: 'ancient_ent' },
  { id: 'wild:ranged:G', race: Race.Wild, category: 'ranged', upgradeNode: 'G', achievementId: 'hydra_lord' },
  { id: 'demon:melee:G', race: Race.Demon, category: 'melee', upgradeNode: 'G', achievementId: 'serpent_king' },
  // ── Single-run / out-of-match achievements ──
  { id: 'horde:ranged:C', race: Race.Horde, category: 'ranged', upgradeNode: 'C', achievementId: 'diamond_exposed' },
  { id: 'oozlings:melee:B', race: Race.Oozlings, category: 'melee', upgradeNode: 'B', achievementId: 'prematch_huts' },
  { id: 'crown:melee:D', race: Race.Crown, category: 'melee', upgradeNode: 'D', achievementId: 'prematch_military' },
  { id: 'deep:melee:C', race: Race.Deep, category: 'melee', upgradeNode: 'C', achievementId: 'kills_10' },
  { id: 'wild:melee:C', race: Race.Wild, category: 'melee', upgradeNode: 'C', achievementId: 'kills_15' },
  { id: 'wild:melee:E', race: Race.Wild, category: 'melee', upgradeNode: 'E', achievementId: 'kills_20' },
  { id: 'horde:caster:C', race: Race.Horde, category: 'caster', upgradeNode: 'C', achievementId: 'kills_25' },
  { id: 'wild:melee:F', race: Race.Wild, category: 'melee', upgradeNode: 'F', achievementId: 'kills_30' },
  { id: 'geists:ranged:C', race: Race.Geists, category: 'ranged', upgradeNode: 'C', achievementId: 'kills_40' },
  { id: 'deep:ranged:C', race: Race.Deep, category: 'ranged', upgradeNode: 'C', achievementId: 'kills_50' },
  { id: 'oozlings:melee:C', race: Race.Oozlings, category: 'melee', upgradeNode: 'C', achievementId: 'duel_watcher' },
  { id: 'deep:caster:C', race: Race.Deep, category: 'caster', upgradeNode: 'C', achievementId: 'duel_fan' },
  { id: 'tenders:melee:B', race: Race.Tenders, category: 'melee', upgradeNode: 'B', achievementId: 'duel_addict' },
  { id: 'crown:melee:B', race: Race.Crown, category: 'melee', upgradeNode: 'B', achievementId: 'multiplayer_first' },
  { id: 'crown:melee:E', race: Race.Crown, category: 'melee', upgradeNode: 'E', achievementId: 'multiplayer_winner' },
  { id: 'tenders:melee:D', race: Race.Tenders, category: 'melee', upgradeNode: 'D', achievementId: 'gallery_visitor' },
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
  { id: 'nature_wrath', name: "Nature's Wrath", desc: 'Deal 50,000 damage as Wild.', goal: 50000, avatarUnlock: 'wild:ranged' },
  { id: 'veteran', name: 'Veteran', desc: 'Play 50 games.', goal: 50, avatarUnlock: 'oozlings:caster' },
  { id: 'tenders_touch', name: "Tender's Touch", desc: 'Win 10 games as Tenders.', goal: 10, avatarUnlock: 'tenders:ranged' },
  { id: 'soul_harvest', name: 'Soul Harvest', desc: 'Spawn 1,000 units as Geists.', goal: 1000, avatarUnlock: 'geists:caster' },
  { id: 'green_thumb', name: 'Green Thumb', desc: 'Build 200 buildings as Tenders.', goal: 200, avatarUnlock: 'tenders:caster' },
  // ── Tough achievements (upgrade-tier avatars) ──
  { id: 'mimic_master', name: 'Mimic Master', desc: 'Win 25 games as Geists.', goal: 25, avatarUnlock: 'geists:melee:G' },
  { id: 'dwarfette_elite', name: 'Dwarfette Elite', desc: 'Deal 250,000 total damage as Crown.', goal: 250000, avatarUnlock: 'crown:ranged:G' },
  { id: 'bull_rush', name: 'Bull Rush', desc: 'Win 50 games as Wild.', goal: 50, avatarUnlock: 'wild:melee:D' },
  { id: 'apex_predator', name: 'Apex Predator', desc: 'Win 10 games as Wild in under 5 min.', goal: 10, avatarUnlock: 'wild:melee:B' },
  { id: 'frog_royalty', name: 'Frog Royalty', desc: 'Win 25 games as Deep.', goal: 25, avatarUnlock: 'deep:melee:G' },
  { id: 'fungal_lord', name: 'Fungal Lord', desc: 'Deal 300,000 total damage as Tenders.', goal: 300000, avatarUnlock: 'tenders:caster:G' },
  { id: 'dark_sorcerer', name: 'Dark Sorcerer', desc: 'Deal 300,000 total damage as Geists.', goal: 300000, avatarUnlock: 'geists:caster:G' },
  { id: 'ancient_ent', name: 'Ancient Ent', desc: 'Spawn 2,000 units as Tenders.', goal: 2000, avatarUnlock: 'tenders:melee:E' },
  { id: 'hydra_lord', name: 'Hydra Lord', desc: 'Deal 500,000 total damage as Wild.', goal: 500000, avatarUnlock: 'wild:ranged:G' },
  { id: 'serpent_king', name: 'Infernal Streak', desc: 'Win a 10-game streak.', goal: 10, avatarUnlock: 'demon:melee:G' },
  // ── Single-run achievements ──
  { id: 'diamond_exposed', name: 'Diamond in the Rough', desc: 'Expose the diamond.', goal: 1, avatarUnlock: 'horde:ranged:C' },
  { id: 'prematch_huts', name: 'Early Harvest', desc: 'Build 3 harvester huts before the match starts.', goal: 1, avatarUnlock: 'oozlings:melee:B' },
  { id: 'prematch_military', name: 'War Ready', desc: 'Build 3 military buildings before the match starts.', goal: 1, avatarUnlock: 'crown:melee:D' },
  { id: 'kills_10', name: 'Seasoned Fighter', desc: 'Get 10 kills on a single unit.', goal: 1, avatarUnlock: 'deep:melee:C' },
  { id: 'kills_15', name: 'Killing Machine', desc: 'Get 15 kills on a single unit.', goal: 1, avatarUnlock: 'wild:melee:C' },
  { id: 'kills_20', name: 'Unstoppable', desc: 'Get 20 kills on a single unit.', goal: 1, avatarUnlock: 'wild:melee:E' },
  { id: 'kills_25', name: 'One-Man Army', desc: 'Get 25 kills on a single unit.', goal: 1, avatarUnlock: 'horde:caster:C' },
  { id: 'kills_30', name: 'Legendary Warrior', desc: 'Get 30 kills on a single unit.', goal: 1, avatarUnlock: 'wild:melee:F' },
  { id: 'kills_40', name: 'Walking Apocalypse', desc: 'Get 40 kills on a single unit.', goal: 1, avatarUnlock: 'geists:ranged:C' },
  { id: 'kills_50', name: 'Demigod', desc: 'Get 50 kills on a single unit.', goal: 1, avatarUnlock: 'deep:ranged:C' },
  // ── Out-of-match achievements ──
  { id: 'duel_watcher', name: 'Spectator', desc: 'Watch 10 title screen duels.', goal: 10, avatarUnlock: 'oozlings:melee:C' },
  { id: 'duel_fan', name: 'Duel Fan', desc: 'Watch 100 title screen duels.', goal: 100, avatarUnlock: 'deep:caster:C' },
  { id: 'duel_addict', name: 'Duel Addict', desc: 'Watch 1,000 title screen duels.', goal: 1000, avatarUnlock: 'tenders:melee:B' },
  { id: 'multiplayer_first', name: 'Party Up', desc: 'Play a multiplayer game.', goal: 1, avatarUnlock: 'crown:melee:B' },
  { id: 'multiplayer_winner', name: 'Party Champion', desc: 'Win a multiplayer game.', goal: 1, avatarUnlock: 'crown:melee:E' },
  { id: 'gallery_visitor', name: 'Field Guide', desc: 'Open the unit gallery.', goal: 1, avatarUnlock: 'tenders:melee:D' },
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

function isValidProfile(p: unknown): p is PlayerProfile {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return (
    o.version === 1 &&
    typeof o.avatarId === 'string' &&
    typeof o.gamesPlayed === 'number' &&
    typeof o.wins === 'number' &&
    typeof o.losses === 'number' &&
    typeof o.winStreak === 'number' &&
    typeof o.bestWinStreak === 'number' &&
    typeof o.totalPlayTimeSec === 'number' &&
    (typeof o.raceStats === 'object' && o.raceStats !== null) &&
    (typeof o.achievements === 'object' && o.achievements !== null)
  );
}

export function loadProfile(): PlayerProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (isValidProfile(p)) return p;
      // Future: migrate older versions here (e.g. if p.version === 0)
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
  isMultiplayer = false,
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
  if (won && durationSec < 300) rs.fastWins = (rs.fastWins ?? 0) + 1;

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

  // Soul Harvest — 1000 units as Geists
  if (race === Race.Geists) {
    check('soul_harvest', profile.raceStats[Race.Geists]!.unitsSpawned);
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

  // Nature's Wrath — 50k damage as Wild
  if (race === Race.Wild) {
    check('nature_wrath', profile.raceStats[Race.Wild]!.damageDealt);
  }

  // Tender's Touch — 10 wins as Tenders
  if (race === Race.Tenders && won) {
    check('tenders_touch', profile.raceStats[Race.Tenders]!.wins);
  }

  // Green Thumb — 200 buildings as Tenders
  if (race === Race.Tenders) {
    check('green_thumb', profile.raceStats[Race.Tenders]!.buildingsPlaced);
  }

  // ── Tough achievements (upgrade-tier) ──

  // Mimic Master — 25 wins as Geists
  if (race === Race.Geists && won) {
    check('mimic_master', profile.raceStats[Race.Geists]!.wins);
  }

  // Dwarfette Elite — 250k damage as Crown
  if (race === Race.Crown) {
    check('dwarfette_elite', profile.raceStats[Race.Crown]!.damageDealt);
  }

  // Bull Rush — 50 wins as Wild
  if (race === Race.Wild && won) {
    check('bull_rush', profile.raceStats[Race.Wild]!.wins);
  }

  // Apex Predator — 10 fast wins (<5min) as Wild
  if (race === Race.Wild && won && durationSec < 300) {
    check('apex_predator', profile.raceStats[Race.Wild]!.fastWins ?? 0);
  }

  // Frog Royalty — 25 wins as Deep
  if (race === Race.Deep && won) {
    check('frog_royalty', profile.raceStats[Race.Deep]!.wins);
  }

  // Fungal Lord — 300k damage as Tenders
  if (race === Race.Tenders) {
    check('fungal_lord', profile.raceStats[Race.Tenders]!.damageDealt);
  }

  // Dark Sorcerer — 300k damage as Geists
  if (race === Race.Geists) {
    check('dark_sorcerer', profile.raceStats[Race.Geists]!.damageDealt);
  }

  // Ancient Ent — 2000 units as Tenders
  if (race === Race.Tenders) {
    check('ancient_ent', profile.raceStats[Race.Tenders]!.unitsSpawned);
  }

  // Hydra Lord — 500k damage as Wild
  if (race === Race.Wild) {
    check('hydra_lord', profile.raceStats[Race.Wild]!.damageDealt);
  }

  // Serpent King — 10 win streak
  check('serpent_king', profile.winStreak);

  // ── Single-run achievements ──

  // Diamond in the Rough — expose the diamond
  if (state.diamond && state.diamond.exposed) {
    check('diamond_exposed', 1);
  }

  // Early Harvest — 3 harvester huts placed during prematch (exclude free starter at tick 0)
  const prematchTicks = 10 * TICK_RATE;
  const prematchHuts = myBuildings.filter(
    b => b.type === BuildingType.HarvesterHut && b.placedTick > 0 && b.placedTick < prematchTicks,
  ).length;
  if (prematchHuts >= 3) check('prematch_huts', 1);

  // War Ready — 3 military buildings placed during prematch
  const prematchMilitary = myBuildings.filter(
    b => b.type !== BuildingType.HarvesterHut && b.type !== BuildingType.Tower && b.placedTick > 0 && b.placedTick < prematchTicks,
  ).length;
  if (prematchMilitary >= 3) check('prematch_military', 1);

  // Kill milestones — max kills on any single unit this match
  // Use fallenHeroes (dead units with kills) + surviving units directly to avoid
  // double-counting with warHeroes (which is a subset of the same data)
  let maxKills = 0;
  for (const h of state.fallenHeroes) {
    if (h.playerId === localPlayerId && h.kills > maxKills) maxKills = h.kills;
  }
  for (const u of state.units) {
    if (u.playerId === localPlayerId && u.kills > maxKills) maxKills = u.kills;
  }
  if (maxKills >= 10) check('kills_10', 1);
  if (maxKills >= 15) check('kills_15', 1);
  if (maxKills >= 20) check('kills_20', 1);
  if (maxKills >= 25) check('kills_25', 1);
  if (maxKills >= 30) check('kills_30', 1);
  if (maxKills >= 40) check('kills_40', 1);
  if (maxKills >= 50) check('kills_50', 1);

  // Multiplayer achievements
  if (isMultiplayer) check('multiplayer_first', 1);
  if (isMultiplayer && won) check('multiplayer_winner', 1);

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

// ─── Non-match achievement tracking ───

/** Check/unlock an achievement from outside a match (duels, gallery, etc).
 *  Returns the achievement ID if newly unlocked, null otherwise. */
export function checkNonMatchAchievement(
  profile: PlayerProfile, id: string, increment = 1,
): string | null {
  const a = ensureAch(profile, id);
  if (a.unlocked) return null;
  a.progress += increment;
  const def = ACHIEVEMENTS.find(d => d.id === id);
  if (def && a.progress >= def.goal) {
    a.unlocked = true;
    a.unlockedAt = Date.now();
    saveProfile(profile);
    return id;
  }
  saveProfile(profile);
  return null;
}
