import { Scene, SceneManager } from './Scene';
import { UIAssets } from '../rendering/UIAssets';
import { SpriteLoader, drawSpriteFrame, drawGridFrame, getSpriteFrame } from '../rendering/SpriteLoader';
import { Race, BuildingType, StatusType, StatusEffect, TICK_RATE } from '../simulation/types';
import { UNIT_STATS, RACE_COLORS, UPGRADE_TREES } from '../simulation/data';
import { getUnitUpgradeMultipliers } from '../simulation/GameState';
import { PartyManager, PartyState, PartyPlayer, getPartyPlayerCount, getActiveSlots } from '../network/PartyManager';
import { isFirebaseConfigured, initFirebase } from '../network/FirebaseService';
import { PlayerProfile, ALL_AVATARS, loadProfile, checkNonMatchAchievement, ACHIEVEMENTS } from '../profile/ProfileData';
import { BotDifficultyLevel } from '../simulation/BotAI';
import { getMapById, DUEL_MAP } from '../simulation/maps';
import { SoundManager } from '../audio/SoundManager';
import { MusicPlayer } from '../audio/MusicPlayer';
import { getAudioSettings, subscribeToAudioSettings, updateAudioSettings } from '../audio/AudioSettings';
import { drawSettingsButton, drawSettingsOverlay, getSettingsOverlayLayout, hitRect as hitOverlayRect, sliderValueFromPoint } from '../ui/SettingsOverlay';

const PARTY_DIFFICULTY_OPTIONS: { level: BotDifficultyLevel; label: string; color: string }[] = [
  { level: BotDifficultyLevel.Easy, label: 'EASY', color: '#4caf50' },
  { level: BotDifficultyLevel.Medium, label: 'MED', color: '#ffd740' },
  { level: BotDifficultyLevel.Hard, label: 'HARD', color: '#ff9100' },
  { level: BotDifficultyLevel.Nightmare, label: 'NITE', color: '#ff1744' },
];

function getModeName(teamSize: number): string {
  switch (teamSize) {
    case 1: return 'Duel (1v1)';
    case 2: return 'Battle (2v2)';
    case 3: return 'War (3v3)';
    case 4: return 'Kooktown (4v4)';
    default: return `${teamSize}v${teamSize}`;
  }
}

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
}

const LOCAL_SETUP_KEY = 'spawnwars.localSetup';

function saveLocalSetup(setup: LocalSetup): void {
  try { localStorage.setItem(LOCAL_SETUP_KEY, JSON.stringify(setup)); } catch {}
}

function loadLocalSetup(): LocalSetup | null {
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

function createDefaultLocalSetup(): LocalSetup {
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
  };
}

/** Get locally-active slot indices for a local setup based on teamSize. */
function getLocalActiveSlots(setup: LocalSetup): number[] {
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
function canStartLocalSetup(setup: LocalSetup): boolean {
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
function canStartParty(ps: PartyState): boolean {
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

// ─── Mini 1v1 simulation using real game stats ───

const ALL_RACES = [Race.Crown, Race.Horde, Race.Goblins, Race.Oozlings, Race.Demon, Race.Deep, Race.Wild, Race.Geists, Race.Tenders];
const UNIT_TYPES: BuildingType[] = [BuildingType.MeleeSpawner, BuildingType.RangedSpawner, BuildingType.CasterSpawner];
function categoryOf(bt: BuildingType): 'melee' | 'ranged' | 'caster' {
  if (bt === BuildingType.RangedSpawner) return 'ranged';
  if (bt === BuildingType.CasterSpawner) return 'caster';
  return 'melee';
}

const ARENA_WIDTH = 20;

interface DuelUnit {
  race: Race;
  category: 'melee' | 'ranged' | 'caster';
  buildingType: BuildingType;
  name: string;
  upgradeNode?: string; // e.g. 'B', 'D', 'G' — for sprite lookup
  x: number;
  hp: number;
  maxHp: number;
  damage: number;
  attackSpeed: number;
  attackTimer: number;
  moveSpeed: number;
  range: number;
  facingLeft: boolean;
  statusEffects: StatusEffect[];
  shieldHp: number;
  hitCount: number;
  alive: boolean;
  playerId: number;
  statusTickAcc: number;
  isAttacking: boolean;
  attackAnimTimer: number;
}

interface DuelProjectile {
  x: number;
  targetX: number; // snapshot of target position when fired
  speed: number; // tiles per second
  damage: number;
  sourceRace: Race;
  sourceCategory: 'melee' | 'ranged' | 'caster';
  sourcePlayerId: number;
  targetUnit: DuelUnit;
  facingLeft: boolean;
  aoe: boolean; // caster projectiles are AoE-styled visually
  age: number; // seconds alive (for animation)
}

// Tier 2 paths: A→B or A→C.  Tier 3 paths: A→B→D, A→B→E, A→C→F, A→C→G
const TIER2_PATHS = [['A', 'B'], ['A', 'C']];
const TIER3_PATHS = [['A', 'B', 'D'], ['A', 'B', 'E'], ['A', 'C', 'F'], ['A', 'C', 'G']];

/** Get effective spawn count for a duel unit from its upgrade path + base stats. */
function getSpawnCountForUnit(race: Race, unitType: BuildingType, upgradePath: string[]): number {
  const stats = UNIT_STATS[race]?.[unitType];
  const baseCount = stats?.spawnCount ?? 1;
  const upgrade = getUnitUpgradeMultipliers(upgradePath, race, unitType);
  return upgrade.special.spawnCount ?? baseCount;
}

function pickUpgradePath(tier: 1 | 2 | 3): string[] {
  if (tier === 2) return TIER2_PATHS[Math.floor(Math.random() * TIER2_PATHS.length)];
  if (tier === 3) return TIER3_PATHS[Math.floor(Math.random() * TIER3_PATHS.length)];
  return ['A'];
}

function createDuelUnit(race: Race, unitType: BuildingType, x: number, facingLeft: boolean, playerId: number, tier: 1 | 2 | 3 = 1, fixedPath?: string[]): DuelUnit {
  const stats = UNIT_STATS[race][unitType]!;
  const upgradePath = fixedPath ?? pickUpgradePath(tier);
  const upgrade = getUnitUpgradeMultipliers(upgradePath, race, unitType);
  const upgradeNode = upgradePath[upgradePath.length - 1];

  // Use upgrade name if available
  const tree = UPGRADE_TREES[race]?.[unitType];
  const nodeDef = upgradeNode !== 'A' && tree ? (tree as any)[upgradeNode] : undefined;
  const name = nodeDef?.name ?? stats.name;

  return {
    race, category: categoryOf(unitType), buildingType: unitType, name, upgradeNode: upgradeNode !== 'A' ? upgradeNode : undefined,
    x,
    hp: Math.max(1, Math.round(stats.hp * upgrade.hp)),
    maxHp: Math.max(1, Math.round(stats.hp * upgrade.hp)),
    damage: Math.max(1, Math.round(stats.damage * upgrade.damage)),
    attackSpeed: Math.max(0.2, stats.attackSpeed * upgrade.attackSpeed),
    attackTimer: stats.attackSpeed * upgrade.attackSpeed * 0.3,
    moveSpeed: Math.max(0.5, stats.moveSpeed * upgrade.moveSpeed),
    range: Math.max(1, stats.range * upgrade.range),
    facingLeft, statusEffects: [], shieldHp: 0, hitCount: 0, alive: true,
    playerId, statusTickAcc: 0, isAttacking: false, attackAnimTimer: 0,
  };
}

function getEffectiveSpeed(unit: DuelUnit): number {
  let speed = unit.moveSpeed;
  for (const eff of unit.statusEffects) {
    if (eff.type === StatusType.Slow) speed *= Math.max(0.5, 1 - 0.1 * eff.stacks);
    if (eff.type === StatusType.Haste) speed *= 1.3;
  }
  return speed;
}

function applyStatus(target: DuelUnit, type: StatusType, stacks: number): void {
  const existing = target.statusEffects.find(e => e.type === type);
  const maxStacks = type === StatusType.Slow || type === StatusType.Burn ? 5 : 1;
  const duration = type === StatusType.Burn ? 3 * TICK_RATE :
                   type === StatusType.Slow ? 3 * TICK_RATE :
                   type === StatusType.Haste ? 3 * TICK_RATE :
                   5 * TICK_RATE;
  if (existing) {
    existing.stacks = Math.min(existing.stacks + stacks, maxStacks);
    existing.duration = duration;
  } else {
    target.statusEffects.push({ type, stacks: Math.min(stacks, maxStacks), duration });
  }
  if (type === StatusType.Shield && target.shieldHp <= 0) target.shieldHp = 12;
}

function dealDuelDamage(target: DuelUnit, amount: number): void {
  if (target.shieldHp > 0) {
    const absorbed = Math.min(target.shieldHp, amount);
    target.shieldHp -= absorbed;
    amount -= absorbed;
    if (target.shieldHp <= 0) {
      target.statusEffects = target.statusEffects.filter(e => e.type !== StatusType.Shield);
    }
  }
  if (amount > 0) {
    target.hp -= amount;
    if (target.hp <= 0) { target.hp = 0; target.alive = false; }
  }
}

// On-hit effects matching the real game (GameState.ts applyOnHitEffects)
function applyDuelOnHit(attacker: DuelUnit, target: DuelUnit): void {
  const isMelee = attacker.range <= 2;
  const isCaster = attacker.category === 'caster';
  switch (attacker.race) {
    case Race.Crown:
      // No on-hit (damage reduction is passive)
      break;
    case Race.Horde:
      // Brute: knockback every 3rd melee hit
      if (isMelee) {
        attacker.hitCount++;
        if (attacker.hitCount % 3 === 0) {
          target.x += target.facingLeft ? 0.8 : -0.8;
          target.x = Math.max(0, Math.min(ARENA_WIDTH, target.x));
        }
      }
      break;
    case Race.Goblins:
      // Knifer: burn on ranged hit
      if (!isMelee && !isCaster) applyStatus(target, StatusType.Burn, 1);
      break;
    case Race.Oozlings:
      // Globule: 15% chance haste on melee hit
      if (isMelee && Math.random() < 0.15) applyStatus(attacker, StatusType.Haste, 1);
      break;
    case Race.Demon:
      // Smasher: burn on every melee hit
      if (isMelee) applyStatus(target, StatusType.Burn, 1);
      break;
    case Race.Deep:
      // Shell Guard: slow on melee; Harpooner: +2 slow on ranged
      if (isMelee) applyStatus(target, StatusType.Slow, 1);
      if (!isMelee && !isCaster) applyStatus(target, StatusType.Slow, 2);
      break;
    case Race.Wild:
      // Lurker: burn on melee hit
      if (isMelee) applyStatus(target, StatusType.Burn, 1);
      break;
    case Race.Geists:
      // Bone Knight: burn + 15% lifesteal on melee
      if (isMelee) {
        applyStatus(target, StatusType.Burn, 1);
        attacker.hp = Math.min(attacker.maxHp, attacker.hp + Math.round(attacker.damage * 0.15));
      }
      // Wraith Bow: 20% lifesteal on ranged
      if (!isMelee && !isCaster) {
        attacker.hp = Math.min(attacker.maxHp, attacker.hp + Math.round(attacker.damage * 0.2));
      }
      break;
    case Race.Tenders:
      // Treant: slow on melee hit
      if (isMelee) applyStatus(target, StatusType.Slow, 1);
      break;
  }
}

// Caster support abilities (self-applied in 1v1 context, matching real game logic)
function applyCasterSupport(caster: DuelUnit): void {
  switch (caster.race) {
    case Race.Crown:
      // Shield (self in 1v1, normally shields 3 allies)
      applyStatus(caster, StatusType.Shield, 1);
      break;
    case Race.Horde:
    case Race.Oozlings:
    case Race.Wild:
      // Haste pulse (self in 1v1, normally hastes 3 allies)
      applyStatus(caster, StatusType.Haste, 1);
      break;
    case Race.Goblins:
      // Hex: slow the enemy (normally slows all enemies in range)
      // Handled in tickDuelCombat since we need the target reference
      break;
    case Race.Demon:
      // Pure damage caster — no support ability
      break;
    case Race.Deep:
      // Cleanse: remove burn from self
      {
        const burnIdx = caster.statusEffects.findIndex(e => e.type === StatusType.Burn);
        if (burnIdx >= 0) {
          const burn = caster.statusEffects[burnIdx];
          burn.stacks = Math.max(0, burn.stacks - 2);
          if (burn.stacks <= 0) caster.statusEffects.splice(burnIdx, 1);
        }
      }
      break;
    case Race.Geists:
      // Lifesteal heal: heal self +2 HP
      caster.hp = Math.min(caster.maxHp, caster.hp + 2);
      break;
    case Race.Tenders:
      // Regen aura: heal self +3 HP
      caster.hp = Math.min(caster.maxHp, caster.hp + 3);
      break;
  }
}

function tickDuelStatusEffects(unit: DuelUnit, dtSec: number): void {
  unit.statusTickAcc += dtSec;
  const fullSecondTicks = Math.floor(unit.statusTickAcc);
  if (fullSecondTicks > 0) unit.statusTickAcc -= fullSecondTicks;

  for (let i = unit.statusEffects.length - 1; i >= 0; i--) {
    const eff = unit.statusEffects[i];
    eff.duration -= dtSec * TICK_RATE;

    if (eff.type === StatusType.Burn && fullSecondTicks > 0) {
      // SEARED combo: burn + slow = 1.5x damage
      const hasSlowCombo = unit.statusEffects.some(e => e.type === StatusType.Slow);
      const baseBurnDmg = 2 * eff.stacks * fullSecondTicks;
      const burnDmg = hasSlowCombo ? Math.round(baseBurnDmg * 1.5) : baseBurnDmg;
      dealDuelDamage(unit, burnDmg);
    }

    if (eff.type === StatusType.Shield && eff.duration <= 0) {
      unit.shieldHp = 0;
    }

    if (eff.duration <= 0) {
      unit.statusEffects.splice(i, 1);
    }
  }
}

// Combat tick — now fires projectiles for ranged/caster instead of instant damage
function tickDuelCombat(
  attacker: DuelUnit, target: DuelUnit, dtSec: number,
  projectiles: DuelProjectile[],
): void {
  if (!attacker.alive || !target.alive) return;

  const dist = Math.abs(target.x - attacker.x);

  // Move toward target if out of range
  if (dist > attacker.range) {
    const speed = getEffectiveSpeed(attacker);
    const step = Math.min(speed * dtSec, dist - attacker.range);
    attacker.x += attacker.facingLeft ? -step : step;
  }

  // Attack
  attacker.attackTimer -= dtSec;
  if (attacker.attackTimer <= 0 && dist <= attacker.range + 0.5) {
    attacker.attackTimer += attacker.attackSpeed;
    attacker.isAttacking = true;
    attacker.attackAnimTimer = 0.3;

    const isMelee = attacker.range <= 2;
    const isCaster = attacker.category === 'caster';

    // Caster support abilities fire on attack
    if (isCaster) {
      applyCasterSupport(attacker);
      // Goblin caster hex: slow the enemy
      if (attacker.race === Race.Goblins) {
        applyStatus(target, StatusType.Slow, 1);
      }
    }

    if (isMelee) {
      // Melee: instant damage + on-hit effects
      dealDuelDamage(target, attacker.damage);
      applyDuelOnHit(attacker, target);
    } else {
      // Ranged/Caster: fire projectile
      const projSpeed = isCaster ? 10 : 15; // tiles per second (matching real game)
      projectiles.push({
        x: attacker.x,
        targetX: target.x,
        speed: projSpeed,
        damage: attacker.damage,
        sourceRace: attacker.race,
        sourceCategory: attacker.category,
        sourcePlayerId: attacker.playerId,
        targetUnit: target,
        facingLeft: attacker.facingLeft,
        aoe: isCaster,
        age: 0,
      });
    }
  }
}

// Tick projectiles — move toward target, deal damage on arrival
function tickDuelProjectiles(projectiles: DuelProjectile[], dtSec: number): boolean {
  let anyHit = false;
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.age += dtSec;

    // Move toward target's current position (homing)
    const tx = p.targetUnit.alive ? p.targetUnit.x : p.targetX;
    const dx = tx - p.x;
    const moveAmt = p.speed * dtSec;

    if (Math.abs(dx) <= moveAmt || p.age > 3) {
      // Hit or expired
      if (p.targetUnit.alive) {
        dealDuelDamage(p.targetUnit, p.damage);
        // Apply on-hit effects from projectile source
        const isCaster = p.sourceCategory === 'caster';
        // Ranged on-hit effects (burn, slow, lifesteal via projectile)
        if (!isCaster) {
          switch (p.sourceRace) {
            case Race.Goblins:
              applyStatus(p.targetUnit, StatusType.Burn, 1);
              break;
            case Race.Deep:
              applyStatus(p.targetUnit, StatusType.Slow, 2);
              break;
          }
        }
        anyHit = true;
      }
      projectiles.splice(i, 1);
    } else {
      p.x += dx > 0 ? moveAmt : -moveAmt;
    }
  }
  return anyHit;
}

function findNearestEnemy(unit: DuelUnit, enemies: DuelUnit[]): DuelUnit | null {
  let nearest: DuelUnit | null = null;
  let minDist = Infinity;
  for (const e of enemies) {
    if (!e.alive) continue;
    const d = Math.abs(e.x - unit.x);
    if (d < minDist) { minDist = d; nearest = e; }
  }
  return nearest;
}

// ─── Minimal procedural sound effects for title screen ───

class TitleSfx {
  private actx: AudioContext | null = null;

  private ctx(): AudioContext {
    if (!this.actx) this.actx = new AudioContext();
    if (this.actx.state === 'suspended') this.actx.resume();
    return this.actx;
  }

  private note(freq: number, dur: number, gain: number, type: OscillatorType = 'square', delay = 0): void {
    const ac = this.ctx();
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t0 = ac.currentTime + delay;
    const scaledGain = gain * getAudioSettings().sfxVolume;
    g.gain.setValueAtTime(scaledGain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.01);
  }

  private sweep(from: number, to: number, dur: number, gain: number, type: OscillatorType = 'square', delay = 0): void {
    const ac = this.ctx();
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    const t0 = ac.currentTime + delay;
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const scaledGain = gain * getAudioSettings().sfxVolume;
    g.gain.setValueAtTime(scaledGain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.01);
  }

  playHit(): void {
    this.note(200, 0.05, 0.08, 'square');
    this.note(150, 0.03, 0.06, 'sawtooth', 0.02);
  }

  playKill(): void {
    this.sweep(280, 80, 0.12, 0.12, 'square');
  }

  playWin(): void {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => {
      const dur = i === notes.length - 1 ? 0.35 : 0.12;
      this.note(f, dur, 0.12, 'square', i * 0.12);
    });
  }

  playDraw(): void {
    this.note(392, 0.15, 0.1, 'square', 0);
    this.note(330, 0.15, 0.1, 'square', 0.15);
    this.note(262, 0.25, 0.1, 'square', 0.3);
  }

  playFightStart(): void {
    this.note(440, 0.06, 0.08, 'square', 0);
    this.note(554, 0.08, 0.1, 'square', 0.06);
  }
}

// ─── ELO Rating System ───

const ELO_STORAGE_KEY = 'spawnwars.duelElo';
const ELO_DEFAULT = 1200;
const ELO_K = 32;

function eloKey(race: Race, category: 'melee' | 'ranged' | 'caster'): string {
  return `${race}:${category}`;
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

export function getElo(race: Race, category: 'melee' | 'ranged' | 'caster'): number {
  const data = loadAllElo();
  return data[eloKey(race, category)] ?? ELO_DEFAULT;
}

export { ELO_DEFAULT };

function updateTeamElo(teamA: DuelUnit[], teamB: DuelUnit[], winningSide: 'a' | 'b' | 'draw'): void {
  if (teamA.length === 0 || teamB.length === 0) return;
  const data = loadAllElo();

  const avgElo = (team: DuelUnit[]) => {
    const sum = team.reduce((s, u) => s + (data[eloKey(u.race, u.category)] ?? ELO_DEFAULT), 0);
    return sum / team.length;
  };

  const avgA = avgElo(teamA);
  const avgB = avgElo(teamB);

  for (const u of teamA) {
    const key = eloKey(u.race, u.category);
    const elo = data[key] ?? ELO_DEFAULT;
    const expected = 1 / (1 + Math.pow(10, (avgB - elo) / 400));
    const score = winningSide === 'a' ? 1 : winningSide === 'draw' ? 0.5 : 0;
    data[key] = Math.round(elo + ELO_K * (score - expected));
  }

  for (const u of teamB) {
    const key = eloKey(u.race, u.category);
    const elo = data[key] ?? ELO_DEFAULT;
    const expected = 1 / (1 + Math.pow(10, (avgA - elo) / 400));
    const score = winningSide === 'b' ? 1 : winningSide === 'draw' ? 0.5 : 0;
    data[key] = Math.round(elo + ELO_K * (score - expected));
  }

  saveAllElo(data);
}

// ─── Title Scene ───

// Race label lookup for party UI
const RACE_LABELS: Record<Race, string> = {
  [Race.Crown]: 'CROWN', [Race.Horde]: 'HORDE', [Race.Goblins]: 'GOBLINS',
  [Race.Oozlings]: 'OOZLINGS', [Race.Demon]: 'DEMON', [Race.Deep]: 'DEEP',
  [Race.Wild]: 'WILD', [Race.Geists]: 'GEISTS', [Race.Tenders]: 'TENDERS',
};

// ─── Random name generator ───
const NAME_PRE = [
  'Swift','Bold','Iron','Dark','Grim','Red','Brave','Fell','Storm','Ash',
  'Dire','Wild','Pale','Dread','Cold','Keen','Lone','Mad','Old','Sly',
  'Tall','Wry','Stark','Void','Grey','Dusk','Dawn','Frost','Flame','Stone',
  'Thorn','Shade','Ghost','Blood','War','Sky','Sea','Rust','Bone','Grit',
  'Hex','Doom','Foul','Bleak','Gilt','Numb','Rot','Fey','Brisk','Woe',
  'Gloom','Soot','Moss','Brine','Slag','Char','Murk','Haze','Mire','Smog',
  'Dust','Vex','Jinx','Gale','Pyre','Bile','Scorn','Wilt','Ruin','Blight',
  'Sleet','Barb','Crag','Gorge','Marsh','Ember','Chill','Blaze','Wisp','Lurk',
  'Gaunt','Brute','Crook','Rogue','Fiend','Wraith','Snarl','Dour','Blunt','Coil',
  'Crude','Scrap','Crux','Sleek','Bliss','Vigor','Noble','Sage','Grand','Prime',
];
const NAME_SUF = [
  'Wolf','Blade','Fang','Hawk','Thorn','Raven','Viper','Bear','Fox','Crow',
  'Skull','Horn','Shard','Bane','Drake','Helm','Root','Wyrm','Claw','Axe',
  'Pike','Mace','Bow','Warg','Orc','Fist','Maw','Spine','Tooth','Hide',
  'Bone','Eye','Tail','Wing','Scale','Hoof','Pelt','Tusk','Fin','Snout',
  'Beak','Talon','Barb','Sting','Coil','Gut','Mane','Brood','Husk','Shell',
  'Reef','Knot','Burr','Gnarl','Stump','Slab','Flint','Ore','Silt','Peat',
  'Grub','Mite','Newt','Shrew','Toad','Wasp','Moth','Slug','Wren','Lark',
  'Asp','Lynx','Ram','Boar','Stag','Hart','Bull','Hound','Crane','Eel',
  'Carp','Squid','Shark','Crow','Rook','Jay','Finch','Dove','Owl','Bat',
  'Rat','Stoat','Otter','Mink','Yak','Ibex','Goat','Lamb','Colt','Foal',
];
function randomName(): string {
  const pre = NAME_PRE[Math.floor(Math.random() * NAME_PRE.length)];
  const suf = NAME_SUF[Math.floor(Math.random() * NAME_SUF.length)];
  return `${pre}${suf}`;
}
function loadPlayerName(): string {
  try {
    const saved = localStorage.getItem('spawnwars_name');
    if (saved) return saved;
    const name = randomName();
    savePlayerName(name);
    return name;
  } catch { return randomName(); }
}
function savePlayerName(name: string): void {
  try { localStorage.setItem('spawnwars_name', name); } catch {}
}

export class TitleScene implements Scene {
  private manager: SceneManager;
  private canvas: HTMLCanvasElement;
  private ui: UIAssets;
  private sprites: SpriteLoader;
  private pulseTime = 0;
  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private contextMenuHandler: ((e: MouseEvent) => void) | null = null;
  private touchHandler: ((e: TouchEvent) => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  // Player name & profile
  private playerName = loadPlayerName();
  get name(): string { return this.playerName; }
  private diceBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  private profileBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  private resetEloBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  private teamSizeBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  private tierBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  private raceLockBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  private typeFilterBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  profile: PlayerProfile | null = null;

  // Duel state
  private blueTeam: DuelUnit[] = [];
  private bannerBlue: DuelUnit[] = []; // persists for VS banner between fights
  private redTeam: DuelUnit[] = [];
  private bannerRed: DuelUnit[] = []; // persists for VS banner between fights
  private projectiles: DuelProjectile[] = [];
  private waitTimer = 0;
  private waiting = true;
  private deathFade = 0;
  private deadUnits: DuelUnit[] = [];
  private winnerLeaving = false;
  private animTime = 0;

  // Duel mode settings (persisted to localStorage)
  private duelTeamSize: 1 | 2 | 3;
  private duelTier: 1 | 2 | 3;
  private duelRaceLocked = true;
  private duelTypeFilter: 'Any' | 'Melee' | 'Ranged' | 'Caster' = 'Any';
  private resetEloConfirm = false; // true = waiting for second click to confirm

  // Win announcement
  private winText = '';
  private winColor = '#fff';
  private winTimer = 0;
  private winScale = 0;

  // Sound
  private sfx = new TitleSfx();
  private menuMusic = new SoundManager();
  private musicPlayer: MusicPlayer;
  private audioSettings = getAudioSettings();
  private audioSettingsUnsub: (() => void) | null = null;
  private settingsOpen = false;
  private userInteracted = false;
  private fightStartPlayed = false;

  // Party / multiplayer state
  party: PartyManager | null = null;
  private partyState: PartyState | null = null;
  private partyError: string = '';
  private partyErrorTimer = 0;
  private copyFeedbackTimer = 0;
  private matchmaking = false; // true while searching for a game
  private matchmakingDots = 0;
  private matchmakingTimeout: ReturnType<typeof setTimeout> | null = null;
  private connecting = false; // true while Firebase is initializing (custom game / find game)
  private joinCodeInput: string = '';
  private joinInputActive = false;
  private firebaseReady = false;
  // partyDifficultyIndex removed — difficulty is per-slot via bots
  // Drag-and-drop state for party slot rearrangement
  private dragSlot = -1;  // which slot is being dragged (-1 = none)
  private dragX = 0;
  private dragY = 0;
  private dragStartX = 0;
  private dragStartY = 0;
  private isDragging = false;
  private dragJustEnded = false; // suppress click after drag
  private mouseDownHandler: ((e: MouseEvent) => void) | null = null;
  private mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  private mouseUpHandler: ((e: MouseEvent) => void) | null = null;
  onPartyStart: ((party: PartyState, localSlot: number) => void) | null = null;
  onLocalStart: ((setup: LocalSetup) => void) | null = null;
  private localSetup: LocalSetup | null = null;

  constructor(manager: SceneManager, canvas: HTMLCanvasElement, ui: UIAssets, sprites: SpriteLoader, musicPlayer: MusicPlayer) {
    this.manager = manager;
    this.canvas = canvas;
    this.ui = ui;
    this.sprites = sprites;
    this.musicPlayer = musicPlayer;
    // Load persisted duel settings
    try {
      const ts = localStorage.getItem('spawnwars.duelTeamSize');
      this.duelTeamSize = (ts === '1' ? 1 : ts === '3' ? 3 : 2) as 1 | 2 | 3;
      const tr = localStorage.getItem('spawnwars.duelTier');
      this.duelTier = (tr === '2' ? 2 : tr === '3' ? 3 : 1) as 1 | 2 | 3;
      const rl = localStorage.getItem('spawnwars.duelRaceLocked');
      this.duelRaceLocked = rl === 'false' ? false : true; // default true
      const tf = localStorage.getItem('spawnwars.duelTypeFilter');
      this.duelTypeFilter = (tf === 'Melee' || tf === 'Ranged' || tf === 'Caster') ? tf : 'Any';
    } catch {
      this.duelTeamSize = 1;
      this.duelTier = 1;
      this.duelRaceLocked = true;
      this.duelTypeFilter = 'Any';
    }
  }

  enter(): void {
    this.pulseTime = 0;
    this.waiting = true;
    this.waitTimer = 0.5;
    this.blueTeam = [];
    this.redTeam = [];
    this.deadUnits = [];
    this.projectiles = [];
    this.winText = '';
    this.winTimer = 0;
    this.userInteracted = false;
    this.settingsOpen = false;
    this.audioSettingsUnsub = subscribeToAudioSettings((settings) => {
      this.audioSettings = settings;
    });
    this.joinCodeInput = '';
    this.joinInputActive = false;
    this.localSetup = null;
    this.partyError = '';
    this.partyStartFired = false;
    this.matchmaking = false;

    // Reload profile (picks up avatar changes from ProfileScene)
    this.profile = loadProfile();

    // Listen for party state changes
    if (this.party) {
      this.partyState = this.party.state;
      this.party.addListener(this.partyListener);
    }

    const interactHandler = () => {
      this.userInteracted = true;
      this.menuMusic.startMenuMusic();
      this.musicPlayer.playMenu();
    };
    let lastClickTime = 0;
    this.clickHandler = (e: MouseEvent) => {
      interactHandler();
      if (this.dragJustEnded) { this.dragJustEnded = false; return; }
      // Suppress click if a touch just fired (Windows touch devices fire both)
      if (Date.now() - lastClickTime < 300) return;
      const rect = this.canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      this.handleClick(cx, cy);
    };
    this.contextMenuHandler = (e: MouseEvent) => {
      // Right-click on own race slot → cycle backwards
      if (!this.partyState && !this.localSetup) return;
      const rect = this.canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      if (this.partyState && this.party) {
        const pl = this.getPartyLayout();
        const localSlot = this.party.localSlotIndex;
        if (pl.slotRects[localSlot] && this.hitRect(cx, cy, pl.slotRects[localSlot])) {
          e.preventDefault();
          this.cycleRace(-1);
        }
      } else if (this.localSetup) {
        const pl = this.getLocalSetupLayout();
        const ps = this.localSetup.playerSlot;
        if (pl.slotRects[ps] && this.hitRect(cx, cy, pl.slotRects[ps])) {
          e.preventDefault();
          this.cycleRace(-1);
        }
      }
    };
    this.touchHandler = (e: TouchEvent) => {
      e.preventDefault();
      interactHandler();
      lastClickTime = Date.now();
      const touch = e.touches[0];
      if (!touch) return;
      const rect = this.canvas.getBoundingClientRect();
      const cx = touch.clientX - rect.left;
      const cy = touch.clientY - rect.top;
      this.handleClick(cx, cy);
    };
    this.keyHandler = (e: KeyboardEvent) => {
      interactHandler();
      if (this.settingsOpen && e.key === 'Escape') {
        this.settingsOpen = false;
        return;
      }
      // Ctrl+V paste — works even before join input is active
      if (e.key === 'v' && (e.ctrlKey || e.metaKey)) {
        navigator.clipboard?.readText().then(text => {
          const cleaned = text.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 5);
          if (cleaned.length >= 4) {
            this.joinInputActive = true;
            this.joinCodeInput = cleaned;
            this.doJoinParty();
          } else if (cleaned.length > 0) {
            this.joinInputActive = true;
            this.joinCodeInput = cleaned;
          }
        }).catch(() => {});
        return;
      }
      if (this.joinInputActive) {
        if (e.key === 'Escape') { this.joinInputActive = false; this.joinCodeInput = ''; return; }
        if (e.key === 'Backspace') { this.joinCodeInput = this.joinCodeInput.slice(0, -1); return; }
        if (e.key === 'Enter' && this.joinCodeInput.length >= 4) { this.doJoinParty(); return; }
        if (this.joinCodeInput.length < 5 && /^[a-zA-Z0-9]$/.test(e.key)) {
          this.joinCodeInput += e.key.toUpperCase();
          return;
        }
      }
    };
    this.canvas.addEventListener('mousedown', interactHandler, { once: true });
    this.canvas.addEventListener('click', this.clickHandler);
    this.canvas.addEventListener('contextmenu', this.contextMenuHandler);
    this.canvas.addEventListener('touchstart', this.touchHandler, { passive: false });
    window.addEventListener('keydown', this.keyHandler);

    // Drag-and-drop handlers for party slot rearrangement
    this.mouseDownHandler = (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      // Local setup drag
      if (this.localSetup) {
        const pl = this.getLocalSetupLayout();
        for (let i = 0; i < this.localSetup.maxSlots; i++) {
          const sr = pl.slotRects[i];
          const pad = 15;
          if (cx >= sr.x - pad && cx <= sr.x + sr.w + pad && cy >= sr.y - pad && cy <= sr.y + sr.h + pad) {
            // Can drag any occupied slot (player or bot)
            if (i === this.localSetup.playerSlot || this.localSetup.bots[String(i)]) {
              this.dragSlot = i;
              this.dragStartX = cx;
              this.dragStartY = cy;
              this.dragX = cx;
              this.dragY = cy;
              this.isDragging = false;
            }
            break;
          }
        }
        return;
      }

      // Firebase party drag (not during matchmaking)
      if (!this.partyState || !this.party?.isHost || this.matchmaking) return;
      const pl = this.getPartyLayout();
      for (let i = 0; i < (this.partyState.maxSlots ?? 4); i++) {
        const sr = pl.slotRects[i];
        const pad = 15;
        if (cx >= sr.x - pad && cx <= sr.x + sr.w + pad && cy >= sr.y - pad && cy <= sr.y + sr.h + pad) {
          const hasPlayer = !!this.partyState.players[String(i)];
          if (hasPlayer) {
            this.dragSlot = i;
            this.dragStartX = cx;
            this.dragStartY = cy;
            this.dragX = cx;
            this.dragY = cy;
            this.isDragging = false;
          }
          break;
        }
      }
    };
    this.mouseMoveHandler = (e: MouseEvent) => {
      if (this.dragSlot < 0) return;
      const rect = this.canvas.getBoundingClientRect();
      this.dragX = e.clientX - rect.left;
      this.dragY = e.clientY - rect.top;
      // Start drag after moving 8px to distinguish from click
      if (!this.isDragging) {
        const dx = this.dragX - this.dragStartX;
        const dy = this.dragY - this.dragStartY;
        if (dx * dx + dy * dy > 64) this.isDragging = true;
      }
    };
    this.mouseUpHandler = (e: MouseEvent) => {
      if (this.dragSlot < 0 || !this.isDragging) {
        this.dragSlot = -1;
        this.isDragging = false;
        return;
      }
      this.dragJustEnded = true;
      const rect = this.canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      // Local setup drop
      if (this.localSetup) {
        const pl = this.getLocalSetupLayout();
        for (let i = 0; i < this.localSetup.maxSlots; i++) {
          if (i === this.dragSlot) continue;
          const sr = pl.slotRects[i];
          const pad = 15;
          if (cx >= sr.x - pad && cx <= sr.x + sr.w + pad && cy >= sr.y - pad && cy <= sr.y + sr.h + pad) {
            this.localSetupSwapSlots(this.dragSlot, i);
            break;
          }
        }
        this.dragSlot = -1;
        this.isDragging = false;
        return;
      }

      // Firebase party drop
      if (!this.partyState || !this.party) {
        this.dragSlot = -1;
        this.isDragging = false;
        return;
      }
      const pl = this.getPartyLayout();
      for (let i = 0; i < (this.partyState.maxSlots ?? 4); i++) {
        if (i === this.dragSlot) continue;
        const sr = pl.slotRects[i];
        const pad = 15;
        if (cx >= sr.x - pad && cx <= sr.x + sr.w + pad && cy >= sr.y - pad && cy <= sr.y + sr.h + pad) {
          this.party.swapSlots(this.dragSlot, i);
          break;
        }
      }
      this.dragSlot = -1;
      this.isDragging = false;
    };
    this.canvas.addEventListener('mousedown', this.mouseDownHandler);
    this.canvas.addEventListener('mousemove', this.mouseMoveHandler);
    this.canvas.addEventListener('mouseup', this.mouseUpHandler);
  }

  exit(): void {
    if (this.clickHandler) this.canvas.removeEventListener('click', this.clickHandler);
    if (this.contextMenuHandler) this.canvas.removeEventListener('contextmenu', this.contextMenuHandler);
    if (this.touchHandler) this.canvas.removeEventListener('touchstart', this.touchHandler);
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    if (this.mouseDownHandler) this.canvas.removeEventListener('mousedown', this.mouseDownHandler);
    if (this.mouseMoveHandler) this.canvas.removeEventListener('mousemove', this.mouseMoveHandler);
    if (this.mouseUpHandler) this.canvas.removeEventListener('mouseup', this.mouseUpHandler);
    this.clickHandler = null;
    this.contextMenuHandler = null;
    this.touchHandler = null;
    this.keyHandler = null;
    this.mouseDownHandler = null;
    this.mouseMoveHandler = null;
    this.mouseUpHandler = null;
    this.audioSettingsUnsub?.();
    this.audioSettingsUnsub = null;
    this.menuMusic.dispose();
    this.clearMatchmakingTimeout();
    if (this.party) {
      this.party.removeListener(this.partyListener);
    }
  }

  private partyStartFired = false;
  private partyListener = (s: PartyState | null) => {
    this.partyState = s;
    // Persist party config so custom game remembers mode/bots
    if (s && s.status === 'waiting' && this.party?.isHost) {
      const localSlot = this.party.localSlotIndex ?? 0;
      const mapDef = getMapById(s.mapId ?? 'duel');
      saveLocalSetup({
        mapId: s.mapId ?? 'duel',
        maxSlots: s.maxSlots ?? mapDef.maxPlayers,
        bots: s.bots ? { ...s.bots } : {},
        playerSlot: localSlot,
        playerRace: s.players[String(localSlot)]?.race ?? 'random',
        teamSize: s.teamSize ?? mapDef.playersPerTeam,
      });
    }
    if (s && s.status === 'starting' && this.onPartyStart && !this.partyStartFired) {
      this.partyStartFired = true;
      this.matchmaking = false;
      this.clearMatchmakingTimeout();
      this.onPartyStart(s, this.party?.localSlotIndex ?? 0);
    }
    // Auto-start: when matchmaking and 2+ players present, host starts immediately
    if (s && getPartyPlayerCount(s) >= 2 && this.matchmaking && this.party?.isHost && s.status === 'waiting') {
      this.matchmaking = false;
      this.clearMatchmakingTimeout();
      this.party.startGame();
    }
    // If we joined via matchmaking as guest, just wait for host to start (clear matchmaking flag)
    if (s && getPartyPlayerCount(s) >= 2 && this.matchmaking && !this.party?.isHost) {
      this.matchmaking = false;
      this.clearMatchmakingTimeout();
    }
    // Party destroyed while matchmaking
    if (!s && this.matchmaking) {
      this.matchmaking = false;
      this.clearMatchmakingTimeout();
    }
  };

  // ─── Button layout ───

  private getButtonLayout(): {
    solo: { x: number; y: number; w: number; h: number };
    findGame: { x: number; y: number; w: number; h: number };
    create: { x: number; y: number; w: number; h: number };
    join: { x: number; y: number; w: number; h: number };
    gallery: { x: number; y: number; w: number; h: number };
  } {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const btnW = Math.min(w * 0.38, 280);
    const btnH = Math.min(h * 0.07, 52);
    const gap = 10;
    const startY = h * 0.28;
    return {
      solo: { x: (w - btnW) / 2, y: startY, w: btnW, h: btnH },
      findGame: { x: (w - btnW) / 2, y: startY + btnH + gap, w: btnW, h: btnH },
      create: { x: (w - btnW) / 2, y: startY + (btnH + gap) * 2, w: btnW, h: btnH },
      join: { x: (w - btnW) / 2, y: startY + (btnH + gap) * 3, w: btnW, h: btnH },
      gallery: { x: (w - btnW) / 2, y: startY + (btnH + gap) * 4, w: btnW, h: btnH },
    };
  }

  private getPartyLayout(): {
    panel: { x: number; y: number; w: number; h: number };
    slotRects: { x: number; y: number; w: number; h: number }[]; // one per maxSlots
    start: { x: number; y: number; w: number; h: number };
    leave: { x: number; y: number; w: number; h: number };
    code: { x: number; y: number; w: number; h: number };
    modeToggle: { x: number; y: number; w: number; h: number };
    diffBtns: { x: number; y: number; w: number; h: number }[];
  } {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const maxSlots = this.partyState?.maxSlots ?? 4;
    const panelW = Math.min(w * 0.98, 616);
    const panelH = Math.min(h * 0.588, 420);
    const px = (w - panelW) / 2;
    const py = h * 0.26;
    const slotW = 40;
    const slotH = 40;
    const slotY = py + panelH * 0.40;

    // Dynamic slot positioning: divide panel width evenly
    const slotRects: { x: number; y: number; w: number; h: number }[] = [];
    const colW = panelW / maxSlots;
    for (let i = 0; i < maxSlots; i++) {
      slotRects.push({
        x: px + colW * i + colW / 2 - slotW / 2,
        y: slotY,
        w: slotW,
        h: slotH,
      });
    }

    // Single mode toggle (1v1 / 2v2 / 3v3)
    const toggleW = panelW * 0.45;
    const toggleH = 24;
    const mapTogY = py + panelH * 0.26;
    const modeTogX = px + (panelW - toggleW) / 2;

    // Difficulty buttons (host only, between slots and start button)
    const dbtnW = panelW * 0.18;
    const dbtnH = 22;
    const dbtnGap = 4;
    const dbtnTotalW = PARTY_DIFFICULTY_OPTIONS.length * dbtnW + (PARTY_DIFFICULTY_OPTIONS.length - 1) * dbtnGap;
    const dbtnStartX = px + (panelW - dbtnTotalW) / 2;
    const dbtnY = py + panelH * 0.76;
    const diffBtns = PARTY_DIFFICULTY_OPTIONS.map((_, i) => ({
      x: dbtnStartX + i * (dbtnW + dbtnGap),
      y: dbtnY,
      w: dbtnW,
      h: dbtnH,
    }));

    return {
      panel: { x: px, y: py, w: panelW, h: panelH },
      slotRects,
      start: { x: px + panelW * 0.15, y: py + panelH - 56, w: panelW * 0.42, h: 44 },
      leave: { x: px + panelW * 0.60, y: py + panelH - 56, w: panelW * 0.28, h: 44 },
      code: { x: px + panelW * 0.125, y: py + 2, w: panelW * 0.75, h: 52 },
      modeToggle: { x: modeTogX, y: mapTogY, w: toggleW, h: toggleH },
      diffBtns,
    };
  }

  private getLocalSetupLayout(): {
    panel: { x: number; y: number; w: number; h: number };
    slotRects: { x: number; y: number; w: number; h: number }[];
    start: { x: number; y: number; w: number; h: number };
    leave: { x: number; y: number; w: number; h: number };
    modeToggle: { x: number; y: number; w: number; h: number };
  } {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const maxSlots = this.localSetup?.maxSlots ?? 4;
    const panelW = Math.min(w * 0.98, 616);
    const panelH = Math.min(h * 0.52, 370);
    const px = (w - panelW) / 2;
    const py = h * 0.26;
    const slotH = 70;
    const slotY = py + panelH * 0.34;

    const slotRects: { x: number; y: number; w: number; h: number }[] = [];
    const colW = panelW / maxSlots;
    for (let i = 0; i < maxSlots; i++) {
      slotRects.push({
        x: px + colW * i + 4,
        y: slotY,
        w: colW - 8,
        h: slotH,
      });
    }

    // Single mode toggle (1v1 / 2v2 / 3v3)
    const toggleW = panelW * 0.45;
    const toggleH = 24;
    const mapTogY = py + panelH * 0.12;
    const modeTogX = px + (panelW - toggleW) / 2;

    return {
      panel: { x: px, y: py, w: panelW, h: panelH },
      slotRects,
      start: { x: px + panelW * 0.15, y: py + panelH - 56, w: panelW * 0.42, h: 44 },
      leave: { x: px + panelW * 0.60, y: py + panelH - 56, w: panelW * 0.28, h: 44 },
      modeToggle: { x: modeTogX, y: mapTogY, w: toggleW, h: toggleH },
    };
  }

  private hitRect(cx: number, cy: number, r: { x: number; y: number; w: number; h: number }): boolean {
    // Inflate hit area by pad on each side for mobile tappability (min 44px targets)
    const pad = 6;
    return cx >= r.x - pad && cx <= r.x + r.w + pad && cy >= r.y - pad && cy <= r.y + r.h + pad;
  }

  private handleClick(cx: number, cy: number): void {
    // Cancel reset ELO confirm if clicking anything other than the reset button
    if (this.resetEloConfirm && !this.hitRect(cx, cy, this.resetEloBtnRect)) {
      this.resetEloConfirm = false;
    }
    const settingsLayout = getSettingsOverlayLayout(this.canvas.clientWidth, this.canvas.clientHeight);
    if (hitOverlayRect(cx, cy, settingsLayout.button)) {
      this.settingsOpen = !this.settingsOpen;
      return;
    }
    if (this.settingsOpen) {
      if (hitOverlayRect(cx, cy, settingsLayout.close)) {
        this.settingsOpen = false;
        return;
      }
      if (hitOverlayRect(cx, cy, settingsLayout.musicRow)) {
        updateAudioSettings({ musicVolume: sliderValueFromPoint(cx, settingsLayout.musicRow) });
        return;
      }
      if (hitOverlayRect(cx, cy, settingsLayout.sfxRow)) {
        updateAudioSettings({ sfxVolume: sliderValueFromPoint(cx, settingsLayout.sfxRow) });
        return;
      }
      if (hitOverlayRect(cx, cy, settingsLayout.panel)) return;
      this.settingsOpen = false;
    }

    // Duel control buttons (always active)
    if (this.hitRect(cx, cy, this.resetEloBtnRect)) {
      if (this.resetEloConfirm) {
        saveAllElo({});
        this.resetEloConfirm = false;
      } else {
        this.resetEloConfirm = true;
      }
      return;
    }
    // Any other duel button click cancels the reset confirm
    const hitAnyDuelBtn = this.hitRect(cx, cy, this.teamSizeBtnRect) || this.hitRect(cx, cy, this.tierBtnRect) || this.hitRect(cx, cy, this.raceLockBtnRect) || this.hitRect(cx, cy, this.typeFilterBtnRect);
    if (hitAnyDuelBtn) this.resetEloConfirm = false;
    if (this.hitRect(cx, cy, this.teamSizeBtnRect)) {
      this.duelTeamSize = this.duelTeamSize === 1 ? 2 : this.duelTeamSize === 2 ? 3 : 1;
      try { localStorage.setItem('spawnwars.duelTeamSize', String(this.duelTeamSize)); } catch {}
      this.waiting = true;
      this.waitTimer = 0.5;
      this.blueTeam = [];
      this.redTeam = [];
      return;
    }
    if (this.hitRect(cx, cy, this.tierBtnRect)) {
      this.duelTier = this.duelTier === 1 ? 2 : this.duelTier === 2 ? 3 : 1;
      try { localStorage.setItem('spawnwars.duelTier', String(this.duelTier)); } catch {}
      this.waiting = true;
      this.waitTimer = 0.5;
      this.blueTeam = [];
      this.redTeam = [];
      return;
    }
    if (this.hitRect(cx, cy, this.raceLockBtnRect)) {
      this.duelRaceLocked = !this.duelRaceLocked;
      try { localStorage.setItem('spawnwars.duelRaceLocked', String(this.duelRaceLocked)); } catch {}
      this.waiting = true;
      this.waitTimer = 0.5;
      this.blueTeam = [];
      this.redTeam = [];
      return;
    }
    if (this.hitRect(cx, cy, this.typeFilterBtnRect)) {
      const cycle: Array<'Any' | 'Melee' | 'Ranged' | 'Caster'> = ['Any', 'Melee', 'Ranged', 'Caster'];
      const idx = cycle.indexOf(this.duelTypeFilter);
      this.duelTypeFilter = cycle[(idx + 1) % cycle.length];
      try { localStorage.setItem('spawnwars.duelTypeFilter', this.duelTypeFilter); } catch {}
      this.waiting = true;
      this.waitTimer = 0.5;
      this.blueTeam = [];
      this.redTeam = [];
      return;
    }

    // If in local setup mode, handle local setup UI
    if (this.localSetup) {
      const pl = this.getLocalSetupLayout();
      const ls = this.localSetup;
      // Click own slot's race icon to cycle
      if (pl.slotRects[ls.playerSlot] && this.hitRect(cx, cy, pl.slotRects[ls.playerSlot])) {
        this.cycleRace();
        return;
      }
      // Click non-player slots: sprite area (slotRect) = cycle race, below = cycle difficulty
      const localActiveSet = new Set(getLocalActiveSlots(ls));
      for (let i = 0; i < ls.maxSlots; i++) {
        if (i === ls.playerSlot) continue;
        if (!localActiveSet.has(i)) continue; // skip inactive slots
        const sr = pl.slotRects[i];
        if (!sr) continue;
        // Extended hit area: slot rect + 40px below for the difficulty/hint text
        const extendedRect = { x: sr.x, y: sr.y, w: sr.w, h: sr.h + 40 };
        if (this.hitRect(cx, cy, extendedRect)) {
          if (!ls.bots[String(i)]) {
            // Empty slot — any click adds a bot
            this.localSetupCycleBot(i);
          } else if (cy <= sr.y + sr.h) {
            // Click on sprite area — cycle race
            this.cycleBotRace(i);
          } else {
            // Click below sprite (difficulty label area) — cycle difficulty
            this.localSetupCycleBot(i);
          }
          return;
        }
      }
      // Mode toggle (1v1 / 2v2 / 3v3)
      if (this.hitRect(cx, cy, pl.modeToggle)) {
        this.localSetupCycleMode();
        return;
      }
      // Start button
      if (this.hitRect(cx, cy, pl.start) && canStartLocalSetup(ls)) {
        if (this.onLocalStart) this.onLocalStart(ls);
        this.localSetup = null;
        return;
      }
      // Leave / back button
      if (this.hitRect(cx, cy, pl.leave)) {
        this.localSetup = null;
        return;
      }
      return;
    }

    // If in a party (but not matchmaking), handle party UI
    if (this.partyState && !this.matchmaking) {
      const pl = this.getPartyLayout();
      const ps = this.partyState;
      const isHost = this.party?.isHost;
      const localSlot = this.party?.localSlotIndex ?? 0;
      // Click own slot's race icon to cycle
      if (pl.slotRects[localSlot] && this.hitRect(cx, cy, pl.slotRects[localSlot])) {
        this.cycleRace();
        return;
      }
      // Host clicking non-local slots: cycle bot difficulty (Empty→Easy→Med→Hard→Nightmare→Empty)
      const partyActiveSet = new Set(getActiveSlots(ps));
      if (isHost) {
        for (let i = 0; i < (ps.maxSlots ?? 4); i++) {
          if (i === localSlot) continue;
          if (!partyActiveSet.has(i)) continue; // skip inactive slots
          if (pl.slotRects[i] && this.hitRect(cx, cy, pl.slotRects[i])) {
            const hasPlayer = !!ps.players[String(i)];
            if (!hasPlayer) {
              // Cycle bot difficulty for this slot
              const currentBot = ps.bots?.[String(i)] ?? null;
              const cycle: (string | null)[] = [null, BotDifficultyLevel.Easy, BotDifficultyLevel.Medium, BotDifficultyLevel.Hard, BotDifficultyLevel.Nightmare];
              const curIdx = currentBot ? cycle.indexOf(currentBot) : 0;
              const nextIdx = (curIdx + 1) % cycle.length;
              this.party?.setSlotBot(i, cycle[nextIdx]);
            }
            // Don't kick human players — just ignore click on their slot
            return;
          }
        }
      }
      // Mode toggle (host only — cycle Duel → Battle → War)
      if (isHost && this.hitRect(cx, cy, pl.modeToggle)) {
        const mapDef = getMapById(this.partyState.mapId ?? 'duel');
        const currentTS = this.partyState.teamSize ?? mapDef.playersPerTeam;
        // Cycle: 1→2 (stay duel), 2→3 (skirmish), 3→4 (warzone), 4→1 (duel)
        if (currentTS === 1) {
          this.party?.updateTeamSize(2);
        } else if (currentTS === 2) {
          this.party?.updateMap('skirmish', 3);
        } else if (currentTS === 3) {
          this.party?.updateMap('warzone', 4);
        } else {
          this.party?.updateMap('duel', 1);
        }
        return;
      }
      if (isHost && this.hitRect(cx, cy, pl.start) && canStartParty(this.partyState)) {
        this.party?.startGame();
        return;
      }
      if (this.hitRect(cx, cy, pl.leave)) {
        this.party?.leaveParty();
        return;
      }
      // Click invite code to copy
      if (this.hitRect(cx, cy, pl.code)) {
        navigator.clipboard?.writeText(this.partyState.code).catch(() => {});
        this.copyFeedbackTimer = 120; // ~2s at 60fps
        return;
      }
      return;
    }

    // If join input is active, clicking outside the input box dismisses
    if (this.joinInputActive) {
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      const boxW = Math.min(w * 0.55, 340);
      const boxH = Math.min(h * 0.16, 120);
      const boxX = (w - boxW) / 2;
      const boxY = h * 0.30;
      if (!this.hitRect(cx, cy, { x: boxX, y: boxY, w: boxW, h: boxH })) {
        this.joinInputActive = false;
        this.joinCodeInput = '';
      }
      return;
    }

    // Profile button
    if (this.hitRect(cx, cy, this.profileBtnRect)) {
      this.manager.switchTo('profile');
      return;
    }

    // Dice button — randomize name
    if (this.hitRect(cx, cy, this.diceBtnRect)) {
      this.playerName = randomName();
      savePlayerName(this.playerName);
      if (this.party) this.party.localName = this.playerName;
      return;
    }

    const btns = this.getButtonLayout();
    if (this.hitRect(cx, cy, btns.solo)) {
      this.manager.switchTo('raceSelect');
      return;
    }
    if (this.hitRect(cx, cy, btns.findGame)) {
      if (this.matchmaking) {
        this.cancelMatchmaking();
      } else {
        this.doFindGame();
      }
      return;
    }
    if (this.hitRect(cx, cy, btns.create) && !this.connecting) {
      this.doCreateParty();
      return;
    }
    if (this.hitRect(cx, cy, btns.gallery)) {
      this.manager.switchTo('gallery');
      return;
    }
    if (this.hitRect(cx, cy, btns.join)) {
      this.joinInputActive = true;
      this.joinCodeInput = '';
      return;
    }
  }

  // ─── Party actions ───

  private firebaseInitPromise: Promise<void> | null = null;

  private ensureFirebase(): Promise<void> {
    if (this.firebaseReady) return Promise.resolve();
    if (!isFirebaseConfigured()) {
      this.showPartyError('Firebase not configured');
      return Promise.reject(new Error('Firebase not configured'));
    }
    // Deduplicate concurrent calls
    if (this.firebaseInitPromise) return this.firebaseInitPromise;
    this.firebaseInitPromise = initFirebase().then(() => {
      this.firebaseReady = true;
      if (!this.party) this.party = new PartyManager();
      this.party.addListener(this.partyListener);
      this.firebaseInitPromise = null;
    }).catch((err) => {
      this.firebaseInitPromise = null;
      console.error('[Firebase] Init failed:', err.code || '', err.message || err);
      this.showPartyError(err.code === 'auth/admin-restricted-operation'
        ? 'Enable Anonymous Auth in Firebase Console'
        : (err.message || 'Firebase error'));
      throw err;
    });
    return this.firebaseInitPromise;
  }

  private async doFindGame(): Promise<void> {
    if (this.matchmaking) return;
    this.connecting = true;
    this.matchmaking = true;
    this.matchmakingDots = 0;
    // Timeout: if no game starts within 60s, cancel and let the user know
    this.clearMatchmakingTimeout();
    this.matchmakingTimeout = setTimeout(() => {
      if (!this.matchmaking) return;
      this.cancelMatchmaking();
      this.showPartyError('No players found — try again');
    }, 60_000);
    try {
      await this.ensureFirebase();
      this.party!.localName = this.playerName;
      const lastRace = this.getLastPartyRace();
      const joined = await this.party!.findAndJoinGame(lastRace);
      if (!joined) {
        // No open games — create one and wait
        await this.party!.createParty(lastRace);
      }
      // Either joined or created — matchmaking stays true until party gets a guest or game starts
      // If we joined someone's party, matchmaking ends when partyListener fires
    } catch (e: any) {
      console.error('[Party] Find game failed:', e);
      this.showPartyError(e.message || 'Failed to find game');
      this.matchmaking = false;
      this.clearMatchmakingTimeout();
    } finally {
      this.connecting = false;
    }
  }

  private cancelMatchmaking(): void {
    this.matchmaking = false;
    this.clearMatchmakingTimeout();
    // Leave the background party we created while searching
    if (this.party && this.partyState) {
      this.party.leaveParty();
    }
  }

  private clearMatchmakingTimeout(): void {
    if (this.matchmakingTimeout) {
      clearTimeout(this.matchmakingTimeout);
      this.matchmakingTimeout = null;
    }
  }

  private getLastPartyRace(): Race {
    const saved = localStorage.getItem('spawnwars.lastPartyRace');
    if (saved && ALL_RACES.includes(saved as Race)) return saved as Race;
    return Race.Crown;
  }

  private async doCreateParty(): Promise<void> {
    this.connecting = true;
    try {
      await this.ensureFirebase();
      this.party!.localName = this.playerName;
      // Restore saved custom game settings (mode/map)
      const saved = loadLocalSetup();
      const mapId = saved?.mapId ?? 'duel';
      const teamSize = saved?.teamSize ?? 1;
      await this.party!.createParty(this.getLastPartyRace(), mapId);
      // Restore team size if different from map default
      if (teamSize !== getMapById(mapId).playersPerTeam) {
        await this.party!.updateTeamSize(teamSize);
      }
      // Restore saved bots
      if (saved?.bots) {
        for (const [slot, difficulty] of Object.entries(saved.bots)) {
          const slotNum = Number(slot);
          if (slotNum !== (saved.playerSlot ?? 0)) {
            await this.party!.setSlotBot(slotNum, difficulty);
          }
        }
      }
    } catch (e: any) {
      console.error('[Party] Create failed:', e);
      // Fall back to local setup if Firebase isn't available
      this.localSetup = loadLocalSetup() ?? createDefaultLocalSetup();
    } finally {
      this.connecting = false;
    }
  }

  private localSetupCycleBot(slot: number): void {
    if (!this.localSetup) return;
    if (slot === this.localSetup.playerSlot) return; // can't replace yourself
    const current = this.localSetup.bots[String(slot)] ?? null;
    const cycle: (string | null)[] = [null, BotDifficultyLevel.Easy, BotDifficultyLevel.Medium, BotDifficultyLevel.Hard, BotDifficultyLevel.Nightmare];
    const curIdx = current ? cycle.indexOf(current) : 0;
    const nextIdx = (curIdx + 1) % cycle.length;
    const next = cycle[nextIdx];
    if (next) {
      this.localSetup.bots[String(slot)] = next;
    } else {
      delete this.localSetup.bots[String(slot)];
      // Clean up race when removing bot
      if (this.localSetup.botRaces) delete this.localSetup.botRaces[String(slot)];
    }
    saveLocalSetup(this.localSetup);
  }

  private localSetupSwapSlots(slotA: number, slotB: number): void {
    if (!this.localSetup || slotA === slotB) return;
    const botA = this.localSetup.bots[String(slotA)] ?? null;
    const botB = this.localSetup.bots[String(slotB)] ?? null;
    const isPlayerA = this.localSetup.playerSlot === slotA;
    const isPlayerB = this.localSetup.playerSlot === slotB;

    // Swap bots
    if (botA) this.localSetup.bots[String(slotB)] = botA; else delete this.localSetup.bots[String(slotB)];
    if (botB) this.localSetup.bots[String(slotA)] = botB; else delete this.localSetup.bots[String(slotA)];

    // Swap bot races
    if (this.localSetup.botRaces) {
      const raceA = this.localSetup.botRaces[String(slotA)] ?? null;
      const raceB = this.localSetup.botRaces[String(slotB)] ?? null;
      if (raceA) this.localSetup.botRaces[String(slotB)] = raceA; else delete this.localSetup.botRaces[String(slotB)];
      if (raceB) this.localSetup.botRaces[String(slotA)] = raceB; else delete this.localSetup.botRaces[String(slotA)];
    }

    // Swap player slot if involved
    if (isPlayerA) this.localSetup.playerSlot = slotB;
    else if (isPlayerB) this.localSetup.playerSlot = slotA;

    saveLocalSetup(this.localSetup);
  }

  private localSetupCycleMode(): void {
    if (!this.localSetup) return;
    const currentTS = this.localSetup.teamSize ?? 1;

    // Cycle: 1v1 (duel) → 2v2 (duel) → 3v3 (skirmish) → 4v4 (warzone) → 1v1 (duel)
    let newTS: number;
    let newMapId: string;
    if (currentTS === 1) {
      newTS = 2; newMapId = 'duel';
    } else if (currentTS === 2) {
      newTS = 3; newMapId = 'skirmish';
    } else if (currentTS === 3) {
      newTS = 4; newMapId = 'warzone';
    } else {
      newTS = 1; newMapId = 'duel';
    }

    const nextMap = getMapById(newMapId);
    const ppt = nextMap.playersPerTeam;

    // Resolve player slot (may need to move if map changed)
    let playerSlot = this.localSetup.playerSlot;
    if (playerSlot >= nextMap.maxPlayers) playerSlot = 0;
    const playerTeam = Math.floor(playerSlot / ppt);

    // Build active slot set
    const newActiveSet = new Set<number>();
    for (let t = 0; t < nextMap.teams.length; t++) {
      for (let s = 0; s < newTS; s++) {
        newActiveSet.add(t * ppt + s);
      }
    }

    // Rebuild bots for new mode
    const oldBots = { ...this.localSetup.bots };
    const bots: { [slot: string]: string } = {};
    for (let i = 0; i < nextMap.maxPlayers; i++) {
      if (i === playerSlot) continue;
      if (!newActiveSet.has(i)) continue;
      const slotTeam = Math.floor(i / ppt);
      if (oldBots[String(i)]) {
        bots[String(i)] = oldBots[String(i)];
      } else if (slotTeam !== playerTeam) {
        bots[String(i)] = BotDifficultyLevel.Medium;
      }
    }

    // Preserve bot races for slots that still exist
    const oldBotRaces = this.localSetup.botRaces ?? {};
    const botRaces: { [slot: string]: string } = {};
    for (const [slot, race] of Object.entries(oldBotRaces)) {
      if (bots[slot]) botRaces[slot] = race;
    }

    // If player is in an inactive slot, move to first active slot on their team
    if (!newActiveSet.has(playerSlot)) {
      const myTeamSlots = [...newActiveSet].filter(s => Math.floor(s / ppt) === playerTeam);
      playerSlot = myTeamSlots[0] ?? 0;
    }

    this.localSetup = {
      mapId: newMapId,
      maxSlots: nextMap.maxPlayers,
      bots,
      botRaces: Object.keys(botRaces).length > 0 ? botRaces : undefined,
      playerSlot,
      playerRace: this.localSetup.playerRace,
      teamSize: newTS,
    };
    saveLocalSetup(this.localSetup);
  }

  private async doJoinParty(): Promise<void> {
    if (this.joinCodeInput.length < 4) return;
    try {
      await this.ensureFirebase();
      this.party!.localName = this.playerName;
      await this.party!.joinParty(this.joinCodeInput, this.getLastPartyRace());
      this.joinInputActive = false;
      this.joinCodeInput = '';
    } catch (e: any) {
      console.error('[Party] Join failed:', e);
      this.showPartyError(e.message || 'Failed to join');
    }
  }

  private cycleRace(dir: number = 1): void {
    // Cycle order: Crown → Horde → ... → Tenders → Random → Crown → ...
    const raceOrder: (Race | 'random')[] = [...ALL_RACES, 'random'];
    if (this.localSetup) {
      const currentRace = this.localSetup.playerRace;
      const idx = raceOrder.indexOf(currentRace);
      this.localSetup.playerRace = raceOrder[(idx + dir + raceOrder.length) % raceOrder.length];
      saveLocalSetup(this.localSetup);
      return;
    }
    if (!this.party || !this.partyState) return;
    const localSlot = this.party.localSlotIndex;
    const myPlayer = this.partyState.players[String(localSlot)];
    const currentRace = myPlayer?.race ?? Race.Crown;
    const idx = raceOrder.indexOf(currentRace);
    const nextRace = raceOrder[(idx + dir + raceOrder.length) % raceOrder.length];
    this.party.updateRace(nextRace as Race);
    localStorage.setItem('spawnwars.lastPartyRace', String(nextRace));
  }

  private cycleBotRace(slot: number): void {
    if (!this.localSetup) return;
    if (!this.localSetup.botRaces) this.localSetup.botRaces = {};
    const raceOrder: (string)[] = ['random', ...ALL_RACES];
    const current = this.localSetup.botRaces[String(slot)] ?? 'random';
    const idx = raceOrder.indexOf(current);
    const next = raceOrder[(idx + 1) % raceOrder.length];
    this.localSetup.botRaces[String(slot)] = next;
    saveLocalSetup(this.localSetup);
  }

  private showPartyError(msg: string): void {
    this.partyError = msg;
    this.partyErrorTimer = 3;
  }

  private spawnDuel(): void {
    this.blueTeam = [];
    this.redTeam = [];
    this.bannerBlue = [];
    this.bannerRed = [];

    // Determine allowed unit types based on type filter
    const allowedTypes = this.duelTypeFilter === 'Melee' ? [BuildingType.MeleeSpawner]
      : this.duelTypeFilter === 'Ranged' ? [BuildingType.RangedSpawner]
      : this.duelTypeFilter === 'Caster' ? [BuildingType.CasterSpawner]
      : UNIT_TYPES;

    // Pick team-wide race if race-locked
    const blueTeamRace = this.duelRaceLocked ? ALL_RACES[Math.floor(Math.random() * ALL_RACES.length)] : null;
    const redTeamRace = this.duelRaceLocked ? ALL_RACES[Math.floor(Math.random() * ALL_RACES.length)] : null;

    for (let i = 0; i < this.duelTeamSize; i++) {
      const blueRace = blueTeamRace ?? ALL_RACES[Math.floor(Math.random() * ALL_RACES.length)];
      const blueType = allowedTypes[Math.floor(Math.random() * allowedTypes.length)];
      // Ensure red side differs from blue (re-roll if same race+type)
      let redRace = redTeamRace ?? ALL_RACES[Math.floor(Math.random() * ALL_RACES.length)];
      let redType = allowedTypes[Math.floor(Math.random() * allowedTypes.length)];
      let rerolls = 0;
      while (redRace === blueRace && redType === blueType && rerolls < 10) {
        if (!redTeamRace) redRace = ALL_RACES[Math.floor(Math.random() * ALL_RACES.length)];
        redType = allowedTypes[Math.floor(Math.random() * allowedTypes.length)];
        rerolls++;
      }

      const bluePath = pickUpgradePath(this.duelTier);
      const redPath = pickUpgradePath(this.duelTier);
      const blueCount = getSpawnCountForUnit(blueRace, blueType, bluePath);
      const redCount = getSpawnCountForUnit(redRace, redType, redPath);
      for (let si = 0; si < blueCount; si++) {
        const u = createDuelUnit(blueRace, blueType, -2 - i * 2 - si * 0.6, false, 0, this.duelTier, bluePath);
        this.blueTeam.push(u);
        if (si === 0) this.bannerBlue.push(u); // one banner entry per spawn group
      }
      for (let si = 0; si < redCount; si++) {
        const u = createDuelUnit(redRace, redType, ARENA_WIDTH + 2 + i * 2 + si * 0.6, true, 2, this.duelTier, redPath);
        this.redTeam.push(u);
        if (si === 0) this.bannerRed.push(u); // one banner entry per spawn group
      }
    }
    this.projectiles = [];
    this.waiting = false;
    this.winnerLeaving = false;
    this.deadUnits = [];
    this.deathFade = 0;
    this.winText = '';
    this.winTimer = 0;
    this.winScale = 0;
    this.fightStartPlayed = false;
  }

  update(dt: number): void {
    this.pulseTime += dt;
    const dtSec = dt / 1000;
    this.animTime += dtSec;

    if (this.partyErrorTimer > 0) this.partyErrorTimer -= dtSec;
    if (this.copyFeedbackTimer > 0) this.copyFeedbackTimer--;

    // Animate win announcement
    if (this.winTimer > 0) {
      this.winTimer -= dtSec;
      this.winScale = Math.min(1, this.winScale + dtSec * 5);
    }

    if (this.waiting) {
      this.waitTimer -= dtSec;
      if (this.waitTimer <= 0) this.spawnDuel();
      return;
    }

    const allUnits = [...this.blueTeam, ...this.redTeam];

    // Decay attack animation timers
    for (const u of allUnits) {
      if (u.attackAnimTimer > 0) {
        u.attackAnimTimer -= dtSec;
        if (u.attackAnimTimer <= 0) u.isAttacking = false;
      }
    }

    // Play fight start sound when any pair is close enough
    if (!this.fightStartPlayed) {
      outer:
      for (const b of this.blueTeam) {
        if (!b.alive) continue;
        for (const r of this.redTeam) {
          if (!r.alive) continue;
          const dist = Math.abs(r.x - b.x);
          if (dist <= Math.max(b.range, r.range) + 1) {
            this.fightStartPlayed = true;
            if (this.userInteracted) this.sfx.playFightStart();
            break outer;
          }
        }
      }
    }

    if (this.winnerLeaving) {
      // Move all alive units off screen
      for (const u of allUnits) {
        if (u.alive) {
          const speed = getEffectiveSpeed(u);
          u.x += u.facingLeft ? -speed * dtSec : speed * dtSec;
        }
      }

      if (this.deathFade > 0) this.deathFade -= dtSec * 2;
      tickDuelProjectiles(this.projectiles, dtSec);

      const anyAlive = allUnits.some(u => u.alive);
      const allOffScreen = !allUnits.some(u => u.alive && u.x > -3 && u.x < ARENA_WIDTH + 3);
      const done = !anyAlive ? this.deathFade <= 0 : allOffScreen;

      if (done) {
        this.waiting = true;
        this.waitTimer = 3;
        this.blueTeam = [];
        this.redTeam = [];
        this.projectiles = [];
      }
      return;
    }

    // Run combat — each unit targets nearest enemy
    const blueAlive = this.blueTeam.filter(u => u.alive);
    const redAlive = this.redTeam.filter(u => u.alive);

    if (blueAlive.length > 0 && redAlive.length > 0) {
      // Record total HP for hit sounds
      const blueHpBefore = blueAlive.reduce((s, u) => s + u.hp, 0);
      const redHpBefore = redAlive.reduce((s, u) => s + u.hp, 0);

      for (const u of blueAlive) {
        const target = findNearestEnemy(u, redAlive);
        if (target) tickDuelCombat(u, target, dtSec, this.projectiles);
      }
      for (const u of redAlive) {
        const target = findNearestEnemy(u, blueAlive);
        if (target) tickDuelCombat(u, target, dtSec, this.projectiles);
      }
      const projHit = tickDuelProjectiles(this.projectiles, dtSec);
      for (const u of allUnits) {
        if (u.alive) tickDuelStatusEffects(u, dtSec);
      }

      // Play hit sounds
      if (this.userInteracted) {
        const blueHpAfter = blueAlive.reduce((s, u) => s + u.hp, 0);
        const redHpAfter = redAlive.reduce((s, u) => s + u.hp, 0);
        if (redHpAfter < redHpBefore) this.sfx.playHit();
        else if (blueHpAfter < blueHpBefore) this.sfx.playHit();
        else if (projHit) this.sfx.playHit();
      }

      // Check team deaths
      const blueStillAlive = this.blueTeam.filter(u => u.alive);
      const redStillAlive = this.redTeam.filter(u => u.alive);

      if (blueStillAlive.length === 0 || redStillAlive.length === 0) {
        const blueDead = blueStillAlive.length === 0;
        const redDead = redStillAlive.length === 0;

        if (blueDead && redDead) {
          updateTeamElo(this.blueTeam, this.redTeam, 'draw');
          this.winText = 'DRAW!';
          this.winColor = '#aaa';
          if (this.userInteracted) this.sfx.playDraw();
        } else if (redDead) {
          updateTeamElo(this.blueTeam, this.redTeam, 'a');
          const blueRaceName = this.bannerBlue[0].race.charAt(0).toUpperCase() + this.bannerBlue[0].race.slice(1);
          this.winText = this.duelTeamSize === 1 ? `${this.blueTeam[0].name} WINS!`
            : this.duelRaceLocked ? `${blueRaceName} WINS!` : 'BLUE WINS!';
          this.winColor = '#4488ff';
          if (this.userInteracted) { this.sfx.playKill(); this.sfx.playWin(); }
        } else {
          updateTeamElo(this.blueTeam, this.redTeam, 'b');
          const redRaceName = this.bannerRed[0].race.charAt(0).toUpperCase() + this.bannerRed[0].race.slice(1);
          this.winText = this.duelTeamSize === 1 ? `${this.redTeam[0].name} WINS!`
            : this.duelRaceLocked ? `${redRaceName} WINS!` : 'RED WINS!';
          this.winColor = '#ff4444';
          if (this.userInteracted) { this.sfx.playKill(); this.sfx.playWin(); }
        }

        this.winTimer = 2.5;
        this.winScale = 0;
        this.deadUnits = allUnits.filter(u => !u.alive);
        this.deathFade = 1;
        this.winnerLeaving = true;

        // Track duel completion for achievements
        if (this.profile) {
          for (const duelAchId of ['duel_watcher', 'duel_fan', 'duel_addict']) {
            const unlocked = checkNonMatchAchievement(this.profile, duelAchId);
            if (unlocked) {
              const def = ACHIEVEMENTS.find(a => a.id === unlocked);
              if (def) this.manager.showToast(`Achievement: ${def.name}`, def.desc);
            }
          }
        }
      }
    }
  }

  private tileToScreen(tileX: number, w: number): number {
    const margin = w * 0.08;
    const arenaW = w - margin * 2;
    return margin + (tileX / ARENA_WIDTH) * arenaW;
  }

  render(ctx: CanvasRenderingContext2D): void {
    const w = ctx.canvas.clientWidth;
    const h = ctx.canvas.clientHeight;
    ctx.imageSmoothingEnabled = false;

    // Clean background: sky gradient + solid grass ground
    const groundY = h * 0.82;

    // Sky
    const skyGrad = ctx.createLinearGradient(0, 0, 0, groundY);
    skyGrad.addColorStop(0, '#87CEEB');
    skyGrad.addColorStop(1, '#c4e4f0');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, groundY);

    // Ground
    const grassGrad = ctx.createLinearGradient(0, groundY, 0, h);
    grassGrad.addColorStop(0, '#5a9a3e');
    grassGrad.addColorStop(0.15, '#4a8c34');
    grassGrad.addColorStop(1, '#3d7a2c');
    ctx.fillStyle = grassGrad;
    ctx.fillRect(0, groundY, w, h - groundY);

    ctx.fillStyle = '#6aad4a';
    ctx.fillRect(0, groundY, w, 2);

    // Draw units — feet anchored ON the ground line
    const unitSize = Math.max(48, Math.min(w / 6, 80));
    const unitBaseY = groundY;
    const frameTick = Math.floor(this.animTime * 20);

    // Draw dead units (fading) first, then living
    if (this.deadUnits.length > 0 && this.deathFade > 0) {
      ctx.globalAlpha = Math.max(0, this.deathFade);
      for (const du of this.deadUnits) this.drawDuelUnit(ctx, du, unitSize, unitBaseY, frameTick, w);
      ctx.globalAlpha = 1;
    }

    for (const u of this.blueTeam) {
      if (u.alive) this.drawDuelUnit(ctx, u, unitSize, unitBaseY, frameTick, w);
    }
    for (const u of this.redTeam) {
      if (u.alive) this.drawDuelUnit(ctx, u, unitSize, unitBaseY, frameTick, w);
    }

    // Draw projectiles
    for (const p of this.projectiles) {
      this.drawDuelProjectile(ctx, p, unitBaseY, unitSize, w);
    }

    // Vignette
    const grad = ctx.createRadialGradient(w / 2, h / 2, w * 0.25, w / 2, h / 2, w * 0.7);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // === VS Banner (uses bannerBlue/bannerRed to persist between fights) ===
    if (this.bannerBlue.length > 0 && this.bannerRed.length > 0) {
      const teamSize = this.bannerBlue.length;
      const vsY = groundY + 4;
      const lineH = teamSize === 1 ? 0 : Math.max(12, Math.min(h * 0.025, 16));
      const vsH = Math.max(44, Math.min(h * 0.08, 56)) + lineH * (teamSize - 1);
      const vsW = Math.min(w * 0.85, 480);
      const vsX = (w - vsW) / 2;

      const vsPadX = Math.round(vsW * 0.075);
      const vsPadY = Math.round(vsH * 0.075);
      this.ui.drawWoodTable(ctx, vsX - vsPadX, vsY - vsPadY, vsW + vsPadX * 2, vsH + vsPadY * 2);

      const fontSize = Math.max(10, Math.min(vsH / (teamSize + 1) * 0.45, 14));
      ctx.textBaseline = 'middle';

      for (let i = 0; i < teamSize; i++) {
        const blue = this.bannerBlue[i];
        const red = this.bannerRed[i];
        const rowY = vsY + vsH * (0.22 + 0.56 * i / Math.max(1, teamSize));

        const blueColor = RACE_COLORS[blue.race].primary;
        ctx.font = `bold ${fontSize}px monospace`;
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillText(blue.name, w / 2 - fontSize * 1.2 + 1, rowY + 1);
        ctx.fillStyle = blueColor;
        ctx.fillText(blue.name, w / 2 - fontSize * 1.2, rowY);

        if (i === 0) {
          ctx.textAlign = 'center';
          ctx.font = `bold ${Math.round(fontSize * 1.3)}px monospace`;
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillText('VS', w / 2 + 1, rowY + 1);
          ctx.fillStyle = '#fff';
          ctx.fillText('VS', w / 2, rowY);
        }

        const redColor = RACE_COLORS[red.race].primary;
        ctx.font = `bold ${fontSize}px monospace`;
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillText(red.name, w / 2 + fontSize * 1.2 + 1, rowY + 1);
        ctx.fillStyle = redColor;
        ctx.fillText(red.name, w / 2 + fontSize * 1.2, rowY);
      }

      // Team avg ELO
      const eloY = vsY + vsH * 0.85;
      const eloFontSize = Math.max(9, fontSize * 0.7);
      ctx.font = `${eloFontSize}px monospace`;
      const blueAvgElo = Math.round(this.bannerBlue.reduce((s, u) => s + getElo(u.race, u.category), 0) / teamSize);
      const redAvgElo = Math.round(this.bannerRed.reduce((s, u) => s + getElo(u.race, u.category), 0) / teamSize);
      const blueFavored = blueAvgElo > redAvgElo;
      const redFavored = redAvgElo > blueAvgElo;
      const eloLabel = teamSize > 1 ? 'avg ' : '';

      ctx.textAlign = 'right';
      ctx.fillStyle = blueFavored ? '#ffe082' : 'rgba(255,255,255,0.6)';
      ctx.fillText(`${blueFavored ? '\u2713 ' : ''}${eloLabel}${blueAvgElo}`, w / 2 - fontSize * 1.2, eloY);
      ctx.textAlign = 'left';
      ctx.fillStyle = redFavored ? '#ffe082' : 'rgba(255,255,255,0.6)';
      ctx.fillText(`${eloLabel}${redAvgElo}${redFavored ? ' \u2713' : ''}`, w / 2 + fontSize * 1.2, eloY);

      // === Duel control buttons ===
      const ctrlY = vsY + vsH + 6;
      const ctrlH = Math.max(20, Math.min(h * 0.035, 28));
      const ctrlW = Math.max(56, Math.min(w * 0.14, 80));
      const ctrlGap = 8;
      const totalCtrlW = ctrlW * 5 + ctrlGap * 4;
      const ctrlStartX = (w - totalCtrlW) / 2;
      const ctrlFont = Math.max(8, Math.min(ctrlH * 0.42, 12));

      const drawCtrlBtn = (x: number, label: string, strokeColor: string, textColor: string) => {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath(); ctx.roundRect(x, ctrlY, ctrlW, ctrlH, 4); ctx.fill();
        ctx.strokeStyle = strokeColor; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(x, ctrlY, ctrlW, ctrlH, 4); ctx.stroke();
        ctx.font = `bold ${ctrlFont}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = textColor;
        ctx.fillText(label, x + ctrlW / 2, ctrlY + ctrlH / 2);
      };

      this.resetEloBtnRect = { x: ctrlStartX, y: ctrlY, w: ctrlW, h: ctrlH };
      const resetLabel = this.resetEloConfirm ? 'SURE?' : 'RESET';
      const resetStroke = this.resetEloConfirm ? 'rgba(255,40,40,0.8)' : 'rgba(255,80,80,0.5)';
      const resetText = this.resetEloConfirm ? '#ff4444' : '#ff8a80';
      drawCtrlBtn(ctrlStartX, resetLabel, resetStroke, resetText);

      const tsX = ctrlStartX + ctrlW + ctrlGap;
      this.teamSizeBtnRect = { x: tsX, y: ctrlY, w: ctrlW, h: ctrlH };
      drawCtrlBtn(tsX, `${this.duelTeamSize}v${this.duelTeamSize}`, 'rgba(100,180,255,0.5)', '#80d8ff');

      const trX = tsX + ctrlW + ctrlGap;
      this.tierBtnRect = { x: trX, y: ctrlY, w: ctrlW, h: ctrlH };
      drawCtrlBtn(trX, `TIER ${this.duelTier}`, 'rgba(255,215,0,0.5)', '#ffe082');

      const rlX = trX + ctrlW + ctrlGap;
      this.raceLockBtnRect = { x: rlX, y: ctrlY, w: ctrlW, h: ctrlH };
      const rlOn = this.duelRaceLocked;
      drawCtrlBtn(rlX, rlOn ? 'LOCKED' : 'MIXED', rlOn ? 'rgba(180,130,255,0.5)' : 'rgba(120,120,120,0.5)', rlOn ? '#ce93d8' : '#999');

      const tfX = rlX + ctrlW + ctrlGap;
      this.typeFilterBtnRect = { x: tfX, y: ctrlY, w: ctrlW, h: ctrlH };
      const tfColors: Record<string, [string, string]> = {
        'Any': ['rgba(120,120,120,0.5)', '#999'],
        'Melee': ['rgba(255,120,80,0.5)', '#ff8a65'],
        'Ranged': ['rgba(80,200,120,0.5)', '#81c784'],
        'Caster': ['rgba(100,140,255,0.5)', '#90caf9'],
      };
      const [tfStroke, tfText] = tfColors[this.duelTypeFilter];
      drawCtrlBtn(tfX, this.duelTypeFilter.toUpperCase(), tfStroke, tfText);
    }

    // === Win announcement ===
    if (this.winTimer > 0 && this.winText) {
      const scale = 0.5 + 0.5 * Math.min(1, this.winScale);
      const announceSize = Math.max(18, Math.min(w / 12, 36));

      ctx.save();
      ctx.translate(w / 2, groundY - unitSize * 1.3);
      ctx.scale(scale, scale);

      ctx.font = `bold ${announceSize}px monospace`;
      const textW = ctx.measureText(this.winText).width;
      const pillW = textW + announceSize * 2;
      const pillH = announceSize * 1.8;

      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.beginPath();
      const r = pillH / 2;
      ctx.moveTo(-pillW / 2 + r, -pillH / 2);
      ctx.lineTo(pillW / 2 - r, -pillH / 2);
      ctx.arc(pillW / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(-pillW / 2 + r, pillH / 2);
      ctx.arc(-pillW / 2 + r, 0, r, Math.PI / 2, -Math.PI / 2);
      ctx.fill();

      ctx.strokeStyle = this.winColor;
      ctx.shadowColor = this.winColor;
      ctx.shadowBlur = 12;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText(this.winText, 1, 1);
      ctx.fillStyle = this.winColor;
      ctx.fillText(this.winText, 0, 0);

      ctx.restore();
    }

    // === UI Elements ===

    // Title banner
    const bannerW = Math.min(w * 0.75, 550);
    const bannerH = Math.min(h * 0.18, 140);
    const bannerX = (w - bannerW) / 2;
    const bannerY = h * 0.04;
    this.ui.drawBanner(ctx, bannerX, bannerY, bannerW, bannerH);

    const titleSize = Math.max(20, Math.min(bannerW / 10, 44));
    ctx.font = `bold ${titleSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText('SPAWN WARS', w / 2 + 2, bannerY + bannerH * 0.45 + 2);
    ctx.fillStyle = '#fff';
    ctx.fillText('SPAWN WARS', w / 2, bannerY + bannerH * 0.45);

    // Subtitle
    const subW = Math.min(w * 0.45, 300);
    const subH = Math.min(h * 0.055, 40);
    const subX = (w - subW) / 2;
    const subY = bannerY + bannerH - subH * 0.2;
    this.ui.drawSmallRibbon(ctx, subX, subY, subW, subH, 0);
    ctx.font = `bold ${Math.max(10, subH * 0.38)}px monospace`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText('Build. Spawn. Conquer.', w / 2, subY + subH * 0.5);

    // === Buttons or Party Panel ===
    if (this.localSetup) {
      this.renderLocalSetupPanel(ctx, w, h);
    } else if (this.partyState && !this.matchmaking) {
      this.renderPartyPanel(ctx, w, h);
    } else if (this.joinInputActive) {
      this.renderJoinInput(ctx, w, h);
    } else {
      this.renderMenuButtons(ctx, w, h);
    }

    const settingsLayout = getSettingsOverlayLayout(w, h);
    drawSettingsButton(ctx, this.ui, settingsLayout.button, this.settingsOpen);
    if (this.settingsOpen) drawSettingsOverlay(ctx, this.ui, settingsLayout, this.audioSettings);

    // Party error toast
    if (this.partyError && this.partyErrorTimer > 0) {
      const errAlpha = Math.min(1, this.partyErrorTimer);
      ctx.globalAlpha = errAlpha;
      const errW = Math.min(w * 0.6, 360);
      const errH = 36;
      const errX = (w - errW) / 2;
      const errY = h * 0.70;
      this.ui.drawBigRibbon(ctx, errX, errY, errW, errH, 1); // red ribbon
      ctx.font = `bold ${Math.max(10, errH * 0.36)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(this.partyError, w / 2, errY + errH * 0.5);
      ctx.globalAlpha = 1;
    }

    // Player name + dice button
    this.renderNameTag(ctx, w, h);

    // Version
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `${Math.max(10, Math.min(w / 60, 14))}px monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText(`build ${__BUILD_NUMBER__} (${__BUILD_HASH__})`, w / 2, h - 12);
  }

  // ─── Render: Main menu buttons ───

  private renderMenuButtons(ctx: CanvasRenderingContext2D, _w: number, _h: number): void {
    const btns = this.getButtonLayout();
    const pulse = 0.6 + 0.4 * Math.sin(this.pulseTime / 500);
    const r = (i: number) => UIAssets.swordReveal(this.pulseTime, i);

    // PLAY SOLO — blue sword (pulsing)
    const r0 = r(0);
    ctx.shadowColor = '#4fc3f7';
    ctx.shadowBlur = 12 * (0.3 + 0.3 * Math.sin(this.pulseTime / 400));
    const ox0 = this.ui.drawSword(ctx, btns.solo.x, btns.solo.y, btns.solo.w, btns.solo.h, 0, r0);
    ctx.shadowBlur = 0;
    if (r0 > 0) this.drawSwordLabel(ctx, btns.solo, 'PLAY SOLO', pulse * r0, ox0);

    // FIND GAME — red sword (pulsing when searching)
    const r1 = r(1);
    if (this.matchmaking) {
      this.matchmakingDots = (this.matchmakingDots + 0.02) % 4;
      const dots = '.'.repeat(Math.floor(this.matchmakingDots));
      ctx.shadowColor = '#ff9800';
      ctx.shadowBlur = 12 * (0.3 + 0.3 * Math.sin(this.pulseTime / 300));
      const ox1 = this.ui.drawSword(ctx, btns.findGame.x, btns.findGame.y, btns.findGame.w, btns.findGame.h, 1, r1);
      ctx.shadowBlur = 0;
      if (r1 > 0) this.drawSwordLabel(ctx, btns.findGame, `SEARCHING${dots}`, (0.6 + 0.4 * Math.sin(this.pulseTime / 300)) * r1, ox1);
    } else {
      const ox1 = this.ui.drawSword(ctx, btns.findGame.x, btns.findGame.y, btns.findGame.w, btns.findGame.h, 1, r1);
      if (r1 > 0) this.drawSwordLabel(ctx, btns.findGame, 'FIND GAME', r1, ox1);
    }

    // CUSTOM GAME — yellow sword (show connecting feedback)
    const r2 = r(2);
    if (this.connecting && !this.matchmaking) {
      ctx.shadowColor = '#ffd740';
      ctx.shadowBlur = 10 * (0.3 + 0.3 * Math.sin(this.pulseTime / 300));
      const ox2 = this.ui.drawSword(ctx, btns.create.x, btns.create.y, btns.create.w, btns.create.h, 2, r2);
      ctx.shadowBlur = 0;
      const dots = '.'.repeat(Math.floor((this.pulseTime / 200) % 4));
      if (r2 > 0) this.drawSwordLabel(ctx, btns.create, `CONNECTING${dots}`, (0.6 + 0.4 * Math.sin(this.pulseTime / 300)) * r2, ox2);
    } else {
      const ox2 = this.ui.drawSword(ctx, btns.create.x, btns.create.y, btns.create.w, btns.create.h, 2, r2);
      if (r2 > 0) this.drawSwordLabel(ctx, btns.create, 'CUSTOM GAME', r2, ox2);
    }

    // JOIN PARTY — purple sword
    const r3 = r(3);
    const ox3 = this.ui.drawSword(ctx, btns.join.x, btns.join.y, btns.join.w, btns.join.h, 3, r3);
    if (r3 > 0) this.drawSwordLabel(ctx, btns.join, 'JOIN PARTY', r3, ox3);

    // UNIT GALLERY — dark sword
    const r4 = r(4);
    const ox4 = this.ui.drawSword(ctx, btns.gallery.x, btns.gallery.y, btns.gallery.w, btns.gallery.h, 4, r4);
    if (r4 > 0) this.drawSwordLabel(ctx, btns.gallery, 'UNIT GALLERY', r4, ox4);
  }

  private drawSwordLabel(
    ctx: CanvasRenderingContext2D,
    rect: { x: number; y: number; w: number; h: number },
    text: string,
    alpha: number,
    offsetX = 0,
  ): void {
    const fontSize = Math.max(11, Math.min(rect.h * 0.32, 18));
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = alpha;
    const tx = rect.x + rect.w * 0.52 + offsetX;
    const ty = rect.y + rect.h * 0.5;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(text, tx + 1, ty + 1);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, tx, ty);
    ctx.globalAlpha = 1;
  }

  // ─── Render: Player name tag ───

  private renderNameTag(ctx: CanvasRenderingContext2D, _w: number, _h: number): void {
    const fontSize = Math.max(12, Math.min(_w / 40, 16));
    const nameH = fontSize + 8;
    const baseAvatarSize = nameH * 2;
    const avatarSize = Math.round(baseAvatarSize * 1.3);  // 30% bigger
    const diceSize = nameH;

    // Positions — avatar top-left, name underneath
    const avatarX = 8;
    const avatarY = 8;

    // ── Profile avatar button (square) ──
    this.profileBtnRect = { x: avatarX, y: avatarY, w: avatarSize, h: avatarSize };

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.roundRect(avatarX, avatarY, avatarSize, avatarSize, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,215,0,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(avatarX, avatarY, avatarSize, avatarSize, 6);
    ctx.stroke();

    // Draw avatar sprite
    if (this.profile) {
      const avatarDef = ALL_AVATARS.find(a => a.id === this.profile!.avatarId);
      if (avatarDef) {
        const sprData = this.sprites.getUnitSprite(avatarDef.race, avatarDef.category, 0, false, avatarDef.upgradeNode);
        if (sprData) {
          const [img, def] = sprData;
          const frame = getSpriteFrame(Math.floor(this.pulseTime / 50), def);
          const aspect = def.frameW / def.frameH;
          const sprInset = 4;
          const sprSize = avatarSize - sprInset * 2;
          // Apply sprite scale so avatars match in-game relative sizes
          const sprScale = def.scale ?? 1.0;
          const drawH = sprSize * sprScale;
          const drawW = drawH * aspect;
          const gY = def.groundY ?? 0.71;
          const feetY = avatarY + avatarSize - sprInset - 2;
          const drawY = feetY - drawH * gY;
          const drawX = avatarX + (avatarSize - drawW) / 2;
          drawSpriteFrame(ctx, img, def, frame, drawX, drawY, drawW, drawH);
        }
      }
    }

    // ── Player name underneath avatar ──
    const nameCx = avatarX + avatarSize / 2;
    const nameY = avatarY + avatarSize + 4;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `bold ${fontSize * 0.8}px monospace`;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(this.playerName, nameCx + 1, nameY + 1);
    ctx.fillStyle = '#ffd700';
    ctx.fillText(this.playerName, nameCx, nameY);
    ctx.textBaseline = 'alphabetic';

    // ── Dice button (to the right of the avatar) ──
    const diceX = avatarX + avatarSize + 6;
    const diceY = avatarY;
    this.diceBtnRect = { x: diceX - 4, y: diceY - 4, w: diceSize + 8, h: diceSize + 8 };

    ctx.fillStyle = 'rgba(255,215,0,0.15)';
    ctx.beginPath();
    ctx.roundRect(diceX, diceY, diceSize, diceSize, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,215,0,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(diceX, diceY, diceSize, diceSize, 4);
    ctx.stroke();

    // Dice dots (⚄ pattern — 5 dots)
    const dcx = diceX + diceSize / 2;
    const dcy = diceY + diceSize / 2;
    const dotR = 2;
    const off = diceSize * 0.22;
    ctx.fillStyle = '#ffd700';
    for (const [dx, dy] of [[-off, -off], [off, -off], [0, 0], [-off, off], [off, off]] as [number,number][]) {
      ctx.beginPath();
      ctx.arc(dcx + dx, dcy + dy, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ─── Render: Join code input ───

  private renderJoinInput(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const boxW = Math.min(w * 0.55, 340);
    const boxH = Math.min(h * 0.16, 120);
    const boxX = (w - boxW) / 2;
    const boxY = h * 0.30;

    this.ui.drawBanner(ctx, boxX, boxY, boxW, boxH);

    const labelSize = Math.max(11, Math.min(boxH * 0.18, 16));
    ctx.font = `bold ${labelSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#3a2a1a';
    ctx.fillText('ENTER INVITE CODE', w / 2, boxY + boxH * 0.25);

    // Code display
    const codeSize = Math.max(18, Math.min(boxH * 0.28, 32));
    ctx.font = `bold ${codeSize}px monospace`;
    const display = this.joinCodeInput + (Math.floor(this.animTime * 2) % 2 === 0 ? '_' : ' ');
    ctx.fillStyle = '#8b4513';
    ctx.fillText(display, w / 2, boxY + boxH * 0.52);

    // Hint
    ctx.font = `${Math.max(9, labelSize * 0.8)}px monospace`;
    ctx.fillStyle = 'rgba(60,40,20,0.55)';
    ctx.fillText('Type code + Enter  |  ESC to cancel', w / 2, boxY + boxH * 0.78);
  }

  // ─── Render: Party panel ───

  // ─── Render: Local setup panel (no Firebase) ───

  private renderLocalSetupPanel(ctx: CanvasRenderingContext2D, w: number, _h: number): void {
    const pl = this.getLocalSetupLayout();
    const ls = this.localSetup!;
    const maxSlots = ls.maxSlots;
    const mapDef = getMapById(ls.mapId);
    const playersPerTeam = mapDef.playersPerTeam;

    // Panel background
    const ppPadX = Math.round(pl.panel.w * 0.075);
    const ppPadY = Math.round(pl.panel.h * 0.05);
    this.ui.drawWoodTable(ctx, pl.panel.x - ppPadX, pl.panel.y - ppPadY, pl.panel.w + ppPadX * 2, pl.panel.h + ppPadY * 2);

    const fontSize = Math.max(10, Math.min(pl.panel.w / 28, 15));

    // Header
    const headerH = 28;
    const headerY = pl.panel.y + 6;
    this.ui.drawSmallRibbon(ctx, pl.panel.x + pl.panel.w * 0.2, headerY, pl.panel.w * 0.6, headerH, 0); // blue
    ctx.font = `bold ${Math.max(11, headerH * 0.45)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText('GAME SETUP', w / 2, headerY + headerH * 0.5);

    // Mode toggle (1v1 / 2v2 / 3v3)
    {
      const mt = pl.modeToggle;
      const ts = ls.teamSize ?? mapDef.playersPerTeam;
      const modeLabel = getModeName(ts);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(mt.x, mt.y, mt.w, mt.h);
      ctx.strokeStyle = 'rgba(255,215,64,0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(mt.x, mt.y, mt.w, mt.h);
      const mtFontSize = Math.max(8, mt.h * 0.5);
      ctx.font = `bold ${mtFontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffd740';
      ctx.fillText(`MODE: ${modeLabel}`, mt.x + mt.w / 2, mt.y + mt.h / 2);
      ctx.fillStyle = 'rgba(255,215,64,0.6)';
      ctx.fillText('<', mt.x + 10, mt.y + mt.h / 2);
      ctx.fillText('>', mt.x + mt.w - 10, mt.y + mt.h / 2);
    }

    // Team color backgrounds
    const activeSlots = new Set(getLocalActiveSlots(ls));
    const colW = pl.panel.w / maxSlots;
    const teamColors = ['rgba(50,100,220,0.12)', 'rgba(220,50,50,0.12)'];
    const teamBorderColors = ['rgba(80,140,255,0.35)', 'rgba(255,80,80,0.35)'];
    const teamLabels = ['TEAM 1', 'TEAM 2'];
    const slotAreaTop = pl.panel.y + pl.panel.h * 0.26;
    const slotAreaBot = pl.panel.y + pl.panel.h * 0.80;

    for (let t = 0; t < mapDef.teams.length; t++) {
      const startSlot = t * playersPerTeam;
      const endSlot = startSlot + playersPerTeam;
      const x0 = pl.panel.x + colW * startSlot + 2;
      const x1 = pl.panel.x + colW * endSlot - 2;
      const r = 6;
      ctx.fillStyle = teamColors[t % teamColors.length];
      ctx.beginPath();
      ctx.moveTo(x0 + r, slotAreaTop); ctx.lineTo(x1 - r, slotAreaTop);
      ctx.arcTo(x1, slotAreaTop, x1, slotAreaTop + r, r);
      ctx.lineTo(x1, slotAreaBot - r);
      ctx.arcTo(x1, slotAreaBot, x1 - r, slotAreaBot, r);
      ctx.lineTo(x0 + r, slotAreaBot);
      ctx.arcTo(x0, slotAreaBot, x0, slotAreaBot - r, r);
      ctx.lineTo(x0, slotAreaTop + r);
      ctx.arcTo(x0, slotAreaTop, x0 + r, slotAreaTop, r);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = teamBorderColors[t % teamBorderColors.length];
      ctx.lineWidth = 1;
      ctx.stroke();

      const teamLabelSize = Math.max(7, fontSize * 0.6);
      ctx.font = `bold ${teamLabelSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = teamBorderColors[t % teamBorderColors.length];
      ctx.fillText(teamLabels[t] ?? `TEAM ${t + 1}`, (x0 + x1) / 2, slotAreaTop + 3);
    }

    // Team divider
    const divX = pl.panel.x + colW * playersPerTeam;
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(divX, slotAreaTop);
    ctx.lineTo(divX, slotAreaBot);
    ctx.stroke();

    // Render slots
    for (let i = 0; i < maxSlots; i++) {
      const slotRect = pl.slotRects[i];
      const isPlayer = i === ls.playerSlot;
      const botDiff = ls.bots[String(i)] ?? null;
      const isActive = activeSlots.has(i);

      if (this.isDragging && this.dragSlot === i) ctx.globalAlpha = 0.3;
      // Dim inactive slots
      if (!isActive) ctx.globalAlpha = 0.15;

      if (isPlayer) {
        const slotCx = pl.panel.x + colW * i + colW / 2;
        if (ls.playerRace === 'random') {
          // Random player — show ? icon and RANDOM label
          ctx.font = `bold ${Math.max(18, fontSize * 2)}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(255,220,100,0.8)';
          ctx.fillText('?', slotCx, slotRect.y + 20);

          ctx.font = `bold ${Math.max(8, fontSize * 0.75)}px monospace`;
          ctx.fillStyle = 'rgba(255,220,100,0.9)';
          ctx.fillText('RANDOM', slotCx, slotRect.y + 40);

          ctx.font = `${Math.max(9, fontSize * 0.85)}px monospace`;
          ctx.fillStyle = '#fff';
          ctx.fillText(this.playerName, slotCx, slotRect.y + 52);

          ctx.font = `${Math.max(7, fontSize * 0.6)}px monospace`;
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          ctx.fillText('click to change', slotCx, slotRect.y - 6);
        } else {
          const fakePlayer: PartyPlayer = { uid: 'local', name: this.playerName, race: ls.playerRace };
          this.renderPlayerSlot(ctx, pl.panel.x + colW * i, pl.panel.y + pl.panel.h * 0.30, colW, fakePlayer, true, slotRect, true, i);
        }
      } else if (botDiff) {
        // Bot slot — render like a player slot but with difficulty label on top
        const slotCx = pl.panel.x + colW * i + colW / 2;
        const diffOpt = PARTY_DIFFICULTY_OPTIONS.find(d => d.level === botDiff);
        const diffLabel = diffOpt?.label ?? botDiff.toUpperCase();
        const diffColor = diffOpt?.color ?? '#aaa';
        const botRace = ls.botRaces?.[String(i)] ?? 'random';

        // Race sprite (capped to slot height so it doesn't overflow)
        const iconSize = Math.min(slotRect.w, slotRect.h);
        if (botRace !== 'random') {
          const spriteData = this.sprites.getUnitSprite(botRace as Race, 'melee', i);
          if (spriteData) {
            const [img, def] = spriteData;
            const frame = getSpriteFrame(Math.floor(this.animTime * 20), def);
            const gY = def.groundY ?? 0.71;
            const drawY = slotRect.y + slotRect.h - iconSize * gY;
            drawSpriteFrame(ctx, img, def, frame, slotCx - iconSize / 2, drawY, iconSize, iconSize);
          }
          const colors = RACE_COLORS[botRace as Race];
          ctx.font = `bold ${fontSize}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = colors?.primary ?? '#aaa';
          ctx.fillText(RACE_LABELS[botRace as Race] ?? botRace, slotCx, slotRect.y + slotRect.h + 6);
        } else {
          ctx.font = `bold ${Math.max(18, fontSize * 2)}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(255,220,100,0.6)';
          ctx.fillText('?', slotCx, slotRect.y + slotRect.h * 0.5);
          ctx.font = `bold ${Math.max(8, fontSize * 0.75)}px monospace`;
          ctx.textBaseline = 'top';
          ctx.fillStyle = 'rgba(255,220,100,0.7)';
          ctx.fillText('RANDOM', slotCx, slotRect.y + slotRect.h + 6);
        }

        // Difficulty label below race label
        ctx.font = `bold ${Math.max(9, fontSize * 0.8)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = diffColor;
        ctx.fillText(`BOT ${diffLabel}`, slotCx, slotRect.y + slotRect.h + 6 + fontSize * 1.3);

        ctx.font = `${Math.max(6, fontSize * 0.5)}px monospace`;
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillText('click: diff / race', slotCx, slotRect.y + slotRect.h + 6 + fontSize * 2.5);
      } else {
        // Empty slot
        const slotCx = pl.panel.x + colW * i + colW / 2;
        const slotY = pl.panel.y + pl.panel.h * 0.38;
        ctx.font = `bold ${Math.max(8, fontSize * 0.8)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fillText(isActive ? 'EMPTY' : '—', slotCx, slotY);
        if (isActive) {
          ctx.font = `${Math.max(7, fontSize * 0.55)}px monospace`;
          ctx.fillStyle = 'rgba(255,255,255,0.3)';
          ctx.fillText('click to add bot', slotCx, slotY + fontSize * 1.3);
        }
      }

      if ((this.isDragging && this.dragSlot === i) || !isActive) ctx.globalAlpha = 1;

      // Divider lines within same team
      if (i > 0 && i % playersPerTeam !== 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pl.panel.x + colW * i, slotAreaTop + 14);
        ctx.lineTo(pl.panel.x + colW * i, slotAreaBot - 4);
        ctx.stroke();
      }
    }

    // Drag ghost
    if (this.isDragging && this.dragSlot >= 0) {
      ctx.globalAlpha = 0.7;
      const ghostSize = 40;
      if (this.dragSlot === ls.playerSlot) {
        const dragRace = ls.playerRace === 'random' ? Race.Crown : ls.playerRace;
        const spriteData = this.sprites.getUnitSprite(dragRace, 'melee', this.dragSlot < playersPerTeam ? 0 : 1);
        if (spriteData) {
          const [img, def] = spriteData;
          const frame = getSpriteFrame(Math.floor(this.animTime * 20), def);
          const gY = def.groundY ?? 0.71;
          drawSpriteFrame(ctx, img, def, frame, this.dragX - ghostSize / 2, this.dragY - ghostSize * gY, ghostSize, ghostSize);
        }
        ctx.font = `bold ${Math.max(8, fontSize * 0.7)}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.fillText(this.playerName, this.dragX, this.dragY + ghostSize * 0.4);
      } else {
        const diff = ls.bots[String(this.dragSlot)];
        if (diff) {
          const diffOpt = PARTY_DIFFICULTY_OPTIONS.find(d => d.level === diff);
          ctx.font = `bold ${Math.max(12, fontSize * 1.2)}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = diffOpt?.color ?? '#aaa';
          ctx.fillText('BOT', this.dragX, this.dragY);
        }
      }
      ctx.globalAlpha = 1;
    }

    // START button
    const canStart = canStartLocalSetup(ls);
    ctx.globalAlpha = canStart ? 1 : 0.4;
    this.ui.drawSword(ctx, pl.start.x, pl.start.y, pl.start.w, pl.start.h, canStart ? 0 : 4);
    const startFontSize = Math.max(10, Math.min(pl.start.h * 0.35, 16));
    ctx.font = `bold ${startFontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText('START', pl.start.x + pl.start.w * 0.52, pl.start.y + pl.start.h * 0.5);
    ctx.globalAlpha = 1;

    // BACK button
    this.ui.drawSword(ctx, pl.leave.x, pl.leave.y, pl.leave.w, pl.leave.h, 1);
    const leaveFontSize = Math.max(9, Math.min(pl.leave.h * 0.32, 14));
    ctx.font = `bold ${leaveFontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText('BACK', pl.leave.x + pl.leave.w * 0.52, pl.leave.y + pl.leave.h * 0.5);

    // Start validation hint
    if (!canStart) {
      ctx.font = `${Math.max(8, fontSize * 0.6)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,100,100,0.7)';
      ctx.fillText('Each team needs at least 1 player or bot', w / 2, pl.start.y - 8);
    }
  }

  // ─── Render: Party panel (Firebase) ───

  private renderPartyPanel(ctx: CanvasRenderingContext2D, w: number, _h: number): void {
    const pl = this.getPartyLayout();
    const ps = this.partyState!;
    const maxSlots = ps.maxSlots ?? 4;

    // Panel background — oversized for 9-slice dead space
    const ppPadX = Math.round(pl.panel.w * 0.075);
    const ppPadY = Math.round(pl.panel.h * 0.05);
    this.ui.drawWoodTable(ctx, pl.panel.x - ppPadX, pl.panel.y - ppPadY, pl.panel.w + ppPadX * 2, pl.panel.h + ppPadY * 2);

    const fontSize = Math.max(10, Math.min(pl.panel.w / 28, 15));
    const isHost = this.party?.isHost;

    // Big ribbon header with party code front-and-center
    const codeRibW = pl.panel.w * 0.75;
    const codeRibH = 52;
    const codeRibX = pl.panel.x + (pl.panel.w - codeRibW) / 2;
    const codeRibY = pl.panel.y + 2;
    this.ui.drawBigRibbon(ctx, codeRibX, codeRibY, codeRibW, codeRibH, 2); // yellow

    // "PARTY CODE" small label at top of ribbon
    const labelSize = Math.max(8, codeRibH * 0.2);
    ctx.font = `bold ${labelSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillText('PARTY CODE', w / 2, codeRibY + codeRibH * 0.25);

    // Large code text — letter-spaced, bright white on the ribbon
    const codeFontSize = Math.max(20, Math.min(pl.panel.w / 10, 36));
    const codeStr = ps.code.split('').join('  ');
    ctx.font = `bold ${codeFontSize}px monospace`;
    const codeTxtY = codeRibY + codeRibH * 0.6;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText(codeStr, w / 2 + 1, codeTxtY + 1);
    ctx.fillStyle = '#fff';
    ctx.fillText(codeStr, w / 2, codeTxtY);

    // Tap to copy hint / copied feedback
    ctx.font = `${Math.max(8, fontSize * 0.7)}px monospace`;
    if (this.copyFeedbackTimer > 0) {
      const fadeIn = Math.min(1, (120 - this.copyFeedbackTimer) / 10);
      const floatY = (1 - this.copyFeedbackTimer / 120) * -6;
      ctx.fillStyle = `rgba(100,255,100,${fadeIn * 0.9})`;
      ctx.fillText('copied to clipboard!', w / 2, codeRibY + codeRibH + 8 + floatY);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillText('tap code to copy', w / 2, codeRibY + codeRibH + 8);
    }

    // Mode toggle (1v1 / 2v2 / 3v3 — host only)
    {
      const mt = pl.modeToggle;
      const mapDef2 = getMapById(ps.mapId ?? 'duel');
      const ts = ps.teamSize ?? mapDef2.playersPerTeam;
      const modeLabel = getModeName(ts);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(mt.x, mt.y, mt.w, mt.h);
      ctx.strokeStyle = 'rgba(255,215,64,0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(mt.x, mt.y, mt.w, mt.h);
      const mtFontSize = Math.max(8, mt.h * 0.5);
      ctx.font = `bold ${mtFontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffd740';
      ctx.fillText(`MODE: ${modeLabel}`, mt.x + mt.w / 2, mt.y + mt.h / 2);
      if (isHost) {
        ctx.fillStyle = 'rgba(255,215,64,0.6)';
        ctx.fillText('<', mt.x + 10, mt.y + mt.h / 2);
        ctx.fillText('>', mt.x + mt.w - 10, mt.y + mt.h / 2);
      }
    }

    // Team color backgrounds behind slot groups
    const partyActiveSlots = new Set(getActiveSlots(ps));
    const colW = pl.panel.w / maxSlots;
    const localSlot = this.party?.localSlotIndex ?? 0;
    const mapDef = getMapById(ps.mapId ?? 'duel');
    const playersPerTeam = mapDef.playersPerTeam;
    const teamColors = ['rgba(50,100,220,0.12)', 'rgba(220,50,50,0.12)'];
    const teamBorderColors = ['rgba(80,140,255,0.35)', 'rgba(255,80,80,0.35)'];
    const teamLabels = ['TEAM 1', 'TEAM 2'];
    const slotAreaTop = pl.panel.y + pl.panel.h * 0.26;
    const slotAreaBot = pl.panel.y + pl.panel.h * 0.73;

    // Draw team background regions
    for (let t = 0; t < 2; t++) {
      const startSlot = t * playersPerTeam;
      const endSlot = startSlot + playersPerTeam;
      const x0 = pl.panel.x + colW * startSlot + 2;
      const x1 = pl.panel.x + colW * endSlot - 2;
      const r = 6;
      ctx.fillStyle = teamColors[t];
      ctx.beginPath();
      ctx.moveTo(x0 + r, slotAreaTop); ctx.lineTo(x1 - r, slotAreaTop);
      ctx.arcTo(x1, slotAreaTop, x1, slotAreaTop + r, r);
      ctx.lineTo(x1, slotAreaBot - r);
      ctx.arcTo(x1, slotAreaBot, x1 - r, slotAreaBot, r);
      ctx.lineTo(x0 + r, slotAreaBot);
      ctx.arcTo(x0, slotAreaBot, x0, slotAreaBot - r, r);
      ctx.lineTo(x0, slotAreaTop + r);
      ctx.arcTo(x0, slotAreaTop, x0 + r, slotAreaTop, r);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = teamBorderColors[t];
      ctx.lineWidth = 1;
      ctx.stroke();

      // Team label at top of region
      const teamLabelSize = Math.max(7, fontSize * 0.6);
      ctx.font = `bold ${teamLabelSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = teamBorderColors[t];
      ctx.fillText(teamLabels[t], (x0 + x1) / 2, slotAreaTop + 3);
    }

    // Team divider (thicker line between teams)
    const divX = pl.panel.x + colW * playersPerTeam;
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(divX, slotAreaTop);
    ctx.lineTo(divX, slotAreaBot);
    ctx.stroke();

    for (let i = 0; i < maxSlots; i++) {
      const player = ps.players[String(i)];
      const slotRect = pl.slotRects[i];
      const botDiff = ps.bots?.[String(i)] ?? null;

      const isSlotActive = partyActiveSlots.has(i);
      // Dim slot if being dragged or inactive
      if (this.isDragging && this.dragSlot === i) ctx.globalAlpha = 0.3;
      else if (!isSlotActive) ctx.globalAlpha = 0.15;

      if (player) {
        const isSlotHost = i === 0;
        this.renderPlayerSlot(ctx, pl.panel.x + colW * i, pl.panel.y + pl.panel.h * 0.30, colW, player, isSlotHost, slotRect, i === localSlot, i);
      } else if (botDiff) {
        // Bot slot — show difficulty with color
        const slotCx = pl.panel.x + colW * i + colW / 2;
        const slotY = pl.panel.y + pl.panel.h * 0.38;
        const diffOpt = PARTY_DIFFICULTY_OPTIONS.find(d => d.level === botDiff);
        const diffLabel = diffOpt?.label ?? botDiff.toUpperCase();
        const diffColor = diffOpt?.color ?? '#aaa';

        // Bot icon (gear-like indicator)
        ctx.font = `bold ${Math.max(12, fontSize * 1.2)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = diffColor;
        ctx.fillText('BOT', slotCx, slotY);

        ctx.font = `bold ${Math.max(8, fontSize * 0.8)}px monospace`;
        ctx.fillStyle = diffColor;
        ctx.fillText(diffLabel, slotCx, slotY + fontSize * 1.3);

        if (isHost && isSlotActive) {
          ctx.font = `${Math.max(7, fontSize * 0.55)}px monospace`;
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          ctx.fillText('click to change', slotCx, slotY + fontSize * 2.3);
        }
      } else {
        // Empty slot (no bot, no player)
        const slotCx = pl.panel.x + colW * i + colW / 2;
        const slotY = pl.panel.y + pl.panel.h * 0.38;
        ctx.font = `bold ${Math.max(8, fontSize * 0.8)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fillText(isSlotActive ? 'EMPTY' : '—', slotCx, slotY);
        if (isHost && isSlotActive) {
          ctx.font = `${Math.max(7, fontSize * 0.55)}px monospace`;
          ctx.fillStyle = 'rgba(255,255,255,0.3)';
          ctx.fillText('click to add bot', slotCx, slotY + fontSize * 1.3);
        }
      }

      if ((this.isDragging && this.dragSlot === i) || !isSlotActive) ctx.globalAlpha = 1;

      // Divider lines between slots within same team
      if (i > 0 && i !== playersPerTeam) {
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pl.panel.x + colW * i, slotAreaTop + 14);
        ctx.lineTo(pl.panel.x + colW * i, slotAreaBot - 4);
        ctx.stroke();
      }
    }

    // Drag ghost: render dragged player at cursor position
    if (this.isDragging && this.dragSlot >= 0) {
      const dragPlayer = ps.players[String(this.dragSlot)];
      if (dragPlayer) {
        ctx.globalAlpha = 0.7;
        const ghostSize = 40;
        const spriteData = this.sprites.getUnitSprite(dragPlayer.race, 'melee', this.dragSlot < playersPerTeam ? 0 : 1);
        if (spriteData) {
          const [img, def] = spriteData;
          const frame = getSpriteFrame(Math.floor(this.animTime * 20), def);
          const gY = def.groundY ?? 0.71;
          drawSpriteFrame(ctx, img, def, frame, this.dragX - ghostSize / 2, this.dragY - ghostSize * gY, ghostSize, ghostSize);
        }
        ctx.font = `bold ${Math.max(8, fontSize * 0.7)}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.fillText(dragPlayer.name, this.dragX, this.dragY + ghostSize * 0.4);
        ctx.globalAlpha = 1;
      }
    }

    // START button (host only, enabled when 2+ players)
    if (isHost) {
      const canStart = canStartParty(ps);
      ctx.globalAlpha = canStart ? 1 : 0.4;
      this.ui.drawSword(ctx, pl.start.x, pl.start.y, pl.start.w, pl.start.h, canStart ? 0 : 4); // blue or dark
      const startFontSize = Math.max(10, Math.min(pl.start.h * 0.35, 16));
      ctx.font = `bold ${startFontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText('START', pl.start.x + pl.start.w * 0.52, pl.start.y + pl.start.h * 0.5);
      ctx.globalAlpha = 1;
    } else {
      // Guest sees "waiting for host"
      ctx.font = `${Math.max(9, fontSize * 0.8)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText('Waiting for host to start...', pl.start.x + pl.start.w * 0.5, pl.start.y + pl.start.h * 0.5);
    }

    // LEAVE button — red sword
    this.ui.drawSword(ctx, pl.leave.x, pl.leave.y, pl.leave.w, pl.leave.h, 1);
    const leaveFontSize = Math.max(9, Math.min(pl.leave.h * 0.32, 14));
    ctx.font = `bold ${leaveFontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText('LEAVE', pl.leave.x + pl.leave.w * 0.52, pl.leave.y + pl.leave.h * 0.5);
  }

  private renderPlayerSlot(
    ctx: CanvasRenderingContext2D,
    x: number, _y: number, slotW: number,
    player: PartyPlayer, isHost: boolean,
    raceRect: { x: number; y: number; w: number; h: number },
    isLocal = false,
    slotIndex = 0,
  ): void {
    const cx = x + slotW / 2;
    const fontSize = Math.max(10, Math.min(slotW / 10, 14));
    const isRandom = (player.race as string) === 'random';

    if (isRandom) {
      // Random race — show ? icon
      ctx.font = `bold ${Math.max(18, fontSize * 2.2)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,220,100,0.8)';
      ctx.fillText('?', cx, raceRect.y + raceRect.h * 0.5);
    } else {
      // Race icon — use slot index for sprite color variant (team 0 = pid 0, team 1 = pid 1+)
      const spriteData = this.sprites.getUnitSprite(player.race, 'melee', slotIndex);
      if (spriteData) {
        const [img, def] = spriteData;
        const iconSize = Math.min(raceRect.w, raceRect.h);
        const frame = getSpriteFrame(Math.floor(this.animTime * 20), def);
        const gY = def.groundY ?? 0.71;
        const drawY = raceRect.y + raceRect.h - iconSize * gY;
        drawSpriteFrame(ctx, img, def, frame, cx - iconSize / 2, drawY, iconSize, iconSize);
      }
    }

    // Race label below icon
    const labelY = raceRect.y + raceRect.h + 6;
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    if (isRandom) {
      ctx.fillStyle = 'rgba(255,220,100,0.9)';
      ctx.fillText('RANDOM', cx, labelY);
    } else {
      const colors = RACE_COLORS[player.race];
      ctx.fillStyle = colors.primary;
      ctx.fillText(RACE_LABELS[player.race], cx, labelY);
    }

    // Player name
    ctx.font = `${Math.max(9, fontSize * 0.85)}px monospace`;
    ctx.fillStyle = '#fff';
    ctx.fillText(player.name, cx, labelY + fontSize * 1.3);

    // Host crown or "Guest" label
    ctx.font = `${Math.max(8, fontSize * 0.7)}px monospace`;
    ctx.fillStyle = isHost ? '#ffe082' : 'rgba(255,255,255,0.5)';
    ctx.fillText(isHost ? 'HOST' : 'GUEST', cx, labelY + fontSize * 2.4);

    // "Click to change" hint if this is the local player's slot
    if (isLocal) {
      ctx.font = `${Math.max(7, fontSize * 0.6)}px monospace`;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText('click to change', cx, raceRect.y - 10);
    }
  }

  private drawDuelProjectile(ctx: CanvasRenderingContext2D, proj: DuelProjectile, baseY: number, unitSize: number, screenW: number): void {
    const sx = this.tileToScreen(proj.x, screenW);
    // Projectiles fly at ~60% unit height
    const py = baseY - unitSize * 0.5;
    const animFrame = 5 + Math.floor(this.animTime * 10) % 10;

    const usesArrow = proj.sourceRace === Race.Crown && !proj.aoe;

    if (usesArrow) {
      // Arrow sprite — rotate toward target
      const arrowData = this.sprites.getArrowSprite(proj.sourcePlayerId < 2 ? 0 : 1);
      if (arrowData) {
        const [img] = arrowData;
        const angle = proj.facingLeft ? Math.PI : 0;
        const size = unitSize * 0.35;
        ctx.save();
        ctx.translate(sx, py);
        ctx.rotate(angle);
        ctx.drawImage(img, -size / 2, -size / 2, size, size);
        ctx.restore();
        return;
      }
    }

    if (proj.aoe) {
      // Caster AoE — circle sprite
      const circData = this.sprites.getCircleSprite(proj.sourceRace);
      if (circData) {
        const [img, def] = circData;
        const size = unitSize * 0.45;
        drawGridFrame(ctx, img, def, animFrame, sx - size / 2, py - size / 2, size, size);
        return;
      }
    }

    // Ranged — orb sprite
    const orbData = this.sprites.getOrbSprite(proj.sourceRace);
    if (orbData) {
      const [img, def] = orbData;
      const size = unitSize * 0.3;
      drawGridFrame(ctx, img, def, animFrame, sx - size / 2, py - size / 2, size, size);
      return;
    }

    // Fallback: colored dot
    const color = proj.sourcePlayerId < 2 ? '#4fc3f7' : '#ff8a65';
    ctx.beginPath();
    ctx.arc(sx, py, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx, py, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }

  private drawDuelUnit(ctx: CanvasRenderingContext2D, unit: DuelUnit, size: number, baseY: number, frameTick: number, screenW: number): void {
    const attacking = unit.isAttacking;
    const spriteData = this.sprites.getUnitSprite(unit.race, unit.category, unit.playerId, attacking, unit.upgradeNode);
    if (!spriteData) return;

    const [img, def] = spriteData;
    const spriteScale = def.scale ?? 1.0;
    const scaledSize = size * spriteScale;
    const drawW = scaledSize;
    const drawH = scaledSize * (def.heightScale ?? 1.0);
    const frame = getSpriteFrame(frameTick, def);
    const sx = this.tileToScreen(unit.x, screenW);
    const gY = def.groundY ?? 0.71;
    const drawY = baseY - drawH * gY;

    if (unit.facingLeft) {
      ctx.save();
      ctx.translate(sx, 0);
      ctx.scale(-1, 1);
      drawSpriteFrame(ctx, img, def, frame, -drawW / 2, drawY, drawW, drawH);
      ctx.restore();
    } else {
      drawSpriteFrame(ctx, img, def, frame, sx - drawW / 2, drawY, drawW, drawH);
    }

    // Status effect VFX overlays
    const fxTick = Math.floor(this.animTime * 10);
    const fxSize = size * 0.6;
    const unitCenterY = baseY - size * 0.4;

    for (const eff of unit.statusEffects) {
      if (eff.type === StatusType.Burn) {
        const fxData = this.sprites.getFxSprite('burn');
        if (fxData) {
          const [fxImg, fxDef] = fxData;
          ctx.globalAlpha = Math.min(0.5 + 0.15 * eff.stacks, 1);
          if ('cols' in fxDef && 'rows' in fxDef) {
            drawGridFrame(ctx, fxImg, fxDef as any, fxTick, sx - fxSize / 2, unitCenterY - fxSize * 0.6, fxSize, fxSize);
          } else {
            drawSpriteFrame(ctx, fxImg, fxDef as any, fxTick, sx - fxSize / 2, unitCenterY - fxSize * 0.6, fxSize, fxSize);
          }
          ctx.globalAlpha = 1;
        }
      }
      if (eff.type === StatusType.Slow) {
        const fxData = this.sprites.getFxSprite('slow');
        if (fxData) {
          const [fxImg, fxDef] = fxData;
          ctx.globalAlpha = Math.min(0.4 + 0.15 * eff.stacks, 0.9);
          if ('cols' in fxDef && 'rows' in fxDef) {
            drawGridFrame(ctx, fxImg, fxDef as any, fxTick, sx - fxSize / 2, unitCenterY - fxSize * 0.4, fxSize, fxSize);
          } else {
            drawSpriteFrame(ctx, fxImg, fxDef as any, fxTick, sx - fxSize / 2, unitCenterY - fxSize * 0.4, fxSize, fxSize);
          }
          ctx.globalAlpha = 1;
        }
      }
      if (eff.type === StatusType.Haste) {
        const fxData = this.sprites.getFxSprite('haste');
        if (fxData) {
          const [fxImg, fxDef] = fxData;
          ctx.globalAlpha = 0.6;
          if ('cols' in fxDef && 'rows' in fxDef) {
            drawGridFrame(ctx, fxImg, fxDef as any, fxTick, sx - fxSize / 2, unitCenterY - fxSize * 0.5, fxSize, fxSize);
          } else {
            drawSpriteFrame(ctx, fxImg, fxDef as any, fxTick, sx - fxSize / 2, unitCenterY - fxSize * 0.5, fxSize, fxSize);
          }
          ctx.globalAlpha = 1;
        }
      }
      if (eff.type === StatusType.Shield) {
        const fxData = this.sprites.getFxSprite('shield');
        if (fxData) {
          const [fxImg, fxDef] = fxData;
          const shieldSize = fxSize * 1.3;
          ctx.globalAlpha = 0.5;
          if ('cols' in fxDef && 'rows' in fxDef) {
            drawGridFrame(ctx, fxImg, fxDef as any, fxTick, sx - shieldSize / 2, unitCenterY - shieldSize / 2, shieldSize, shieldSize);
          } else {
            drawSpriteFrame(ctx, fxImg, fxDef as any, fxTick, sx - shieldSize / 2, unitCenterY - shieldSize / 2, shieldSize, shieldSize);
          }
          ctx.globalAlpha = 1;
        }
      }
    }

    // HP bar
    if (unit.hp < unit.maxHp || unit.statusEffects.length > 0) {
      const barW = size * 0.7;
      const barH = 5;
      const barX = sx - barW / 2;
      const barY = drawY - 10;
      const hpPct = Math.max(0, unit.hp / unit.maxHp);

      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
      ctx.fillStyle = hpPct > 0.5 ? '#4caf50' : hpPct > 0.25 ? '#ff9800' : '#f44336';
      ctx.fillRect(barX, barY, barW * hpPct, barH);

      if (unit.shieldHp > 0) {
        const shieldPct = Math.min(1, unit.shieldHp / 12);
        ctx.fillStyle = 'rgba(100,181,246,0.7)';
        ctx.fillRect(barX, barY, barW * shieldPct, barH);
      }
    }

    // Status effect indicator dots
    if (unit.statusEffects.length > 0) {
      const dotY = drawY - 2;
      let dotX = sx - (unit.statusEffects.length - 1) * 4;
      for (const eff of unit.statusEffects) {
        let color = '#fff';
        if (eff.type === StatusType.Burn) color = '#ff4400';
        else if (eff.type === StatusType.Slow) color = '#2979ff';
        else if (eff.type === StatusType.Haste) color = '#00e676';
        else if (eff.type === StatusType.Shield) color = '#64b5f6';
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
        ctx.fill();
        dotX += 8;
      }
    }
  }
}
