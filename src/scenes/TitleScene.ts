import { Scene, SceneManager } from './Scene';
import { UIAssets } from '../rendering/UIAssets';
import { SpriteLoader, drawSpriteFrame, drawGridFrame } from '../rendering/SpriteLoader';
import { Race, BuildingType, StatusType, StatusEffect, TICK_RATE } from '../simulation/types';
import { UNIT_STATS, RACE_COLORS, UPGRADE_TREES } from '../simulation/data';
import { getUnitUpgradeMultipliers } from '../simulation/GameState';
import { PartyManager, PartyState, PartyPlayer } from '../network/PartyManager';
import { isFirebaseConfigured, initFirebase } from '../network/FirebaseService';
import { PlayerProfile, ALL_AVATARS } from '../profile/ProfileData';
import { BotDifficultyLevel } from '../simulation/BotAI';

const PARTY_DIFFICULTY_OPTIONS: { level: BotDifficultyLevel; label: string; color: string }[] = [
  { level: BotDifficultyLevel.Easy, label: 'EASY', color: '#4caf50' },
  { level: BotDifficultyLevel.Medium, label: 'MED', color: '#ffd740' },
  { level: BotDifficultyLevel.Hard, label: 'HARD', color: '#ff9100' },
  { level: BotDifficultyLevel.Nightmare, label: 'NITE', color: '#ff1744' },
];

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

function createDuelUnit(race: Race, unitType: BuildingType, x: number, facingLeft: boolean, playerId: number, tier: 1 | 2 | 3 = 1): DuelUnit {
  const stats = UNIT_STATS[race][unitType]!;
  let upgradePath = ['A'];
  if (tier === 2) {
    upgradePath = TIER2_PATHS[Math.floor(Math.random() * TIER2_PATHS.length)];
  } else if (tier === 3) {
    upgradePath = TIER3_PATHS[Math.floor(Math.random() * TIER3_PATHS.length)];
  }
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
  if (type === StatusType.Shield && target.shieldHp <= 0) target.shieldHp = 20;
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
    g.gain.setValueAtTime(gain, t0);
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
    g.gain.setValueAtTime(gain, t0);
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
  try { return localStorage.getItem('spawnwars_name') || randomName(); }
  catch { return randomName(); }
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
  private touchHandler: ((e: TouchEvent) => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  // Player name & profile
  private playerName = loadPlayerName();
  private diceBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  private profileBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  private resetEloBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  private teamSizeBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  private tierBtnRect = { x: 0, y: 0, w: 0, h: 0 };
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

  // Win announcement
  private winText = '';
  private winColor = '#fff';
  private winTimer = 0;
  private winScale = 0;

  // Sound
  private sfx = new TitleSfx();
  private userInteracted = false;
  private fightStartPlayed = false;

  // Party / multiplayer state
  party: PartyManager | null = null;
  private partyState: PartyState | null = null;
  private partyError: string = '';
  private partyErrorTimer = 0;
  private matchmaking = false; // true while searching for a game
  private matchmakingDots = 0;
  private joinCodeInput: string = '';
  private joinInputActive = false;
  private firebaseReady = false;
  private partyDifficultyIndex = 1; // index into PARTY_DIFFICULTY_OPTIONS (default Medium)
  onPartyStart: ((party: PartyState, isHost: boolean) => void) | null = null;

  constructor(manager: SceneManager, canvas: HTMLCanvasElement, ui: UIAssets, sprites: SpriteLoader) {
    this.manager = manager;
    this.canvas = canvas;
    this.ui = ui;
    this.sprites = sprites;
    // Load persisted duel settings
    try {
      const ts = localStorage.getItem('spawnwars.duelTeamSize');
      this.duelTeamSize = (ts === '1' ? 1 : ts === '3' ? 3 : 2) as 1 | 2 | 3;
      const tr = localStorage.getItem('spawnwars.duelTier');
      this.duelTier = (tr === '2' ? 2 : tr === '3' ? 3 : 1) as 1 | 2 | 3;
    } catch {
      this.duelTeamSize = 1;
      this.duelTier = 1;
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
    this.joinCodeInput = '';
    this.joinInputActive = false;
    this.partyError = '';
    this.partyStartFired = false;
    this.matchmaking = false;

    // Listen for party state changes
    if (this.party) {
      this.partyState = this.party.state;
      this.party.addListener(this.partyListener);
    }

    const interactHandler = () => { this.userInteracted = true; };
    this.clickHandler = (e: MouseEvent) => {
      interactHandler();
      const rect = this.canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      this.handleClick(cx, cy);
    };
    this.touchHandler = (e: TouchEvent) => {
      e.preventDefault();
      interactHandler();
      const touch = e.touches[0];
      if (!touch) return;
      const rect = this.canvas.getBoundingClientRect();
      const cx = touch.clientX - rect.left;
      const cy = touch.clientY - rect.top;
      this.handleClick(cx, cy);
    };
    this.keyHandler = (e: KeyboardEvent) => {
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
    this.canvas.addEventListener('touchstart', this.touchHandler);
    window.addEventListener('keydown', this.keyHandler);
  }

  exit(): void {
    if (this.clickHandler) this.canvas.removeEventListener('click', this.clickHandler);
    if (this.touchHandler) this.canvas.removeEventListener('touchstart', this.touchHandler);
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    this.clickHandler = null;
    this.touchHandler = null;
    this.keyHandler = null;
    if (this.party) {
      this.party.removeListener(this.partyListener);
    }
  }

  private partyStartFired = false;
  private partyListener = (s: PartyState | null) => {
    this.partyState = s;
    if (s && s.status === 'starting' && this.onPartyStart && !this.partyStartFired) {
      this.partyStartFired = true;
      this.matchmaking = false;
      this.onPartyStart(s, this.party?.isHost ?? true);
    }
    // Auto-start: when matchmaking and both players are present, host starts immediately
    if (s && s.guest && this.matchmaking && this.party?.isHost && s.status === 'waiting') {
      this.matchmaking = false;
      this.party.startGame();
    }
    // If we joined via matchmaking as guest, just wait for host to start (clear matchmaking flag)
    if (s && s.guest && this.matchmaking && !this.party?.isHost) {
      this.matchmaking = false;
    }
    // Party destroyed while matchmaking
    if (!s && this.matchmaking) {
      this.matchmaking = false;
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
    const w = this.canvas.width;
    const h = this.canvas.height;
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
    slot1Race: { x: number; y: number; w: number; h: number };
    slot2Race: { x: number; y: number; w: number; h: number };
    start: { x: number; y: number; w: number; h: number };
    leave: { x: number; y: number; w: number; h: number };
    code: { x: number; y: number; w: number; h: number };
    diffBtns: { x: number; y: number; w: number; h: number }[];
  } {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const panelW = Math.min(w * 0.98, 616);
    const panelH = Math.min(h * 0.588, 420);
    const px = (w - panelW) / 2;
    const py = h * 0.26;
    const slotW = 40;
    const slotH = 40;
    const slotY = py + panelH * 0.40;
    const halfW = panelW / 2;

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
      slot1Race: { x: px + halfW * 0.5 - slotW / 2, y: slotY, w: slotW, h: slotH },
      slot2Race: { x: px + halfW + halfW * 0.5 - slotW / 2, y: slotY, w: slotW, h: slotH },
      start: { x: px + panelW * 0.15, y: py + panelH - 56, w: panelW * 0.42, h: 44 },
      leave: { x: px + panelW * 0.60, y: py + panelH - 56, w: panelW * 0.28, h: 44 },
      code: { x: px + panelW * 0.25, y: py + 8, w: panelW * 0.5, h: 36 },
      diffBtns,
    };
  }

  private hitRect(cx: number, cy: number, r: { x: number; y: number; w: number; h: number }): boolean {
    return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
  }

  private handleClick(cx: number, cy: number): void {
    // Duel control buttons (always active)
    if (this.hitRect(cx, cy, this.resetEloBtnRect)) {
      saveAllElo({});
      return;
    }
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

    // If in a party, handle party UI
    if (this.partyState) {
      const pl = this.getPartyLayout();
      // Click race icon to cycle (only own slot)
      const isHost = this.party?.isHost;
      const mySlot = isHost ? pl.slot1Race : pl.slot2Race;
      if (this.hitRect(cx, cy, mySlot)) {
        this.cycleRace();
        return;
      }
      // Difficulty buttons (host only)
      if (isHost) {
        for (let i = 0; i < pl.diffBtns.length; i++) {
          if (this.hitRect(cx, cy, pl.diffBtns[i])) {
            this.partyDifficultyIndex = i;
            this.party?.updateDifficulty(PARTY_DIFFICULTY_OPTIONS[i].level);
            return;
          }
        }
      }
      if (isHost && this.hitRect(cx, cy, pl.start) && this.partyState.guest) {
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
        return;
      }
      return;
    }

    // If join input is active, clicking outside the input box dismisses
    if (this.joinInputActive) {
      const w = this.canvas.width;
      const h = this.canvas.height;
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
      this.doFindGame();
      return;
    }
    if (this.hitRect(cx, cy, btns.create)) {
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
    this.matchmaking = true;
    this.matchmakingDots = 0;
    try {
      await this.ensureFirebase();
      this.party!.localName = this.playerName;
      const joined = await this.party!.findAndJoinGame(Race.Crown);
      if (!joined) {
        // No open games — create one and wait
        await this.party!.createParty(Race.Crown);
      }
      // Either joined or created — matchmaking stays true until party gets a guest or game starts
      // If we joined someone's party, matchmaking ends when partyListener fires
    } catch (e: any) {
      console.error('[Party] Find game failed:', e);
      this.showPartyError(e.message || 'Failed to find game');
      this.matchmaking = false;
    }
  }

  private async doCreateParty(): Promise<void> {
    try {
      await this.ensureFirebase();
      this.party!.localName = this.playerName;
      await this.party!.createParty(Race.Crown);
    } catch (e: any) {
      console.error('[Party] Create failed:', e);
      this.showPartyError(e.message || 'Failed to create party');
    }
  }

  private async doJoinParty(): Promise<void> {
    if (this.joinCodeInput.length < 4) return;
    try {
      await this.ensureFirebase();
      this.party!.localName = this.playerName;
      await this.party!.joinParty(this.joinCodeInput, Race.Crown);
      this.joinInputActive = false;
      this.joinCodeInput = '';
    } catch (e: any) {
      console.error('[Party] Join failed:', e);
      this.showPartyError(e.message || 'Failed to join');
    }
  }

  private cycleRace(): void {
    if (!this.party || !this.partyState) return;
    const currentRace = this.party.isHost
      ? this.partyState.host.race
      : this.partyState.guest?.race ?? Race.Crown;
    const idx = ALL_RACES.indexOf(currentRace);
    const nextRace = ALL_RACES[(idx + 1) % ALL_RACES.length];
    this.party.updateRace(nextRace);
  }

  private showPartyError(msg: string): void {
    this.partyError = msg;
    this.partyErrorTimer = 3;
  }

  private spawnDuel(): void {
    this.blueTeam = [];
    this.redTeam = [];

    for (let i = 0; i < this.duelTeamSize; i++) {
      const blueRace = ALL_RACES[Math.floor(Math.random() * ALL_RACES.length)];
      const redRace = ALL_RACES[Math.floor(Math.random() * ALL_RACES.length)];
      const blueType = UNIT_TYPES[Math.floor(Math.random() * UNIT_TYPES.length)];
      const redType = UNIT_TYPES[Math.floor(Math.random() * UNIT_TYPES.length)];

      this.blueTeam.push(createDuelUnit(blueRace, blueType, -2 - i * 2, false, 0, this.duelTier));
      this.redTeam.push(createDuelUnit(redRace, redType, ARENA_WIDTH + 2 + i * 2, true, 2, this.duelTier));
    }

    this.bannerBlue = this.blueTeam;
    this.bannerRed = this.redTeam;
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
          this.winText = this.duelTeamSize === 1 ? `${this.blueTeam[0].name} WINS!` : 'BLUE WINS!';
          this.winColor = '#4488ff';
          if (this.userInteracted) { this.sfx.playKill(); this.sfx.playWin(); }
        } else {
          updateTeamElo(this.blueTeam, this.redTeam, 'b');
          this.winText = this.duelTeamSize === 1 ? `${this.redTeam[0].name} WINS!` : 'RED WINS!';
          this.winColor = '#ff4444';
          if (this.userInteracted) { this.sfx.playKill(); this.sfx.playWin(); }
        }

        this.winTimer = 2.5;
        this.winScale = 0;
        this.deadUnits = allUnits.filter(u => !u.alive);
        this.deathFade = 1;
        this.winnerLeaving = true;
      }
    }
  }

  private tileToScreen(tileX: number, w: number): number {
    const margin = w * 0.08;
    const arenaW = w - margin * 2;
    return margin + (tileX / ARENA_WIDTH) * arenaW;
  }

  render(ctx: CanvasRenderingContext2D): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
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
    const frameTick = Math.floor(this.animTime * 7);

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

      this.ui.drawWoodTable(ctx, vsX, vsY, vsW, vsH);

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
      const totalCtrlW = ctrlW * 3 + ctrlGap * 2;
      const ctrlStartX = (w - totalCtrlW) / 2;
      const ctrlFont = Math.max(8, Math.min(ctrlH * 0.42, 12));

      this.resetEloBtnRect = { x: ctrlStartX, y: ctrlY, w: ctrlW, h: ctrlH };
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath(); ctx.roundRect(ctrlStartX, ctrlY, ctrlW, ctrlH, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(255,80,80,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(ctrlStartX, ctrlY, ctrlW, ctrlH, 4); ctx.stroke();
      ctx.font = `bold ${ctrlFont}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ff8a80';
      ctx.fillText('RESET', ctrlStartX + ctrlW / 2, ctrlY + ctrlH / 2);

      const tsX = ctrlStartX + ctrlW + ctrlGap;
      this.teamSizeBtnRect = { x: tsX, y: ctrlY, w: ctrlW, h: ctrlH };
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath(); ctx.roundRect(tsX, ctrlY, ctrlW, ctrlH, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(100,180,255,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(tsX, ctrlY, ctrlW, ctrlH, 4); ctx.stroke();
      ctx.fillStyle = '#80d8ff';
      ctx.fillText(`${this.duelTeamSize}v${this.duelTeamSize}`, tsX + ctrlW / 2, ctrlY + ctrlH / 2);

      const trX = tsX + ctrlW + ctrlGap;
      this.tierBtnRect = { x: trX, y: ctrlY, w: ctrlW, h: ctrlH };
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath(); ctx.roundRect(trX, ctrlY, ctrlW, ctrlH, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(255,215,0,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(trX, ctrlY, ctrlW, ctrlH, 4); ctx.stroke();
      ctx.fillStyle = '#ffe082';
      ctx.fillText(`TIER ${this.duelTier}`, trX + ctrlW / 2, ctrlY + ctrlH / 2);
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
    if (this.partyState) {
      this.renderPartyPanel(ctx, w, h);
    } else if (this.joinInputActive) {
      this.renderJoinInput(ctx, w, h);
    } else {
      this.renderMenuButtons(ctx, w, h);
    }

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
    ctx.fillText('v0.1.0 - dev build', w / 2, h - 12);
  }

  // ─── Render: Main menu buttons ───

  private renderMenuButtons(ctx: CanvasRenderingContext2D, _w: number, _h: number): void {
    const btns = this.getButtonLayout();
    const pulse = 0.6 + 0.4 * Math.sin(this.pulseTime / 500);

    // PLAY SOLO — blue sword (pulsing)
    ctx.shadowColor = '#4fc3f7';
    ctx.shadowBlur = 12 * (0.3 + 0.3 * Math.sin(this.pulseTime / 400));
    this.ui.drawSword(ctx, btns.solo.x, btns.solo.y, btns.solo.w, btns.solo.h, 0);
    ctx.shadowBlur = 0;
    this.drawSwordLabel(ctx, btns.solo, 'PLAY SOLO', pulse);

    // FIND GAME — red sword (pulsing when searching)
    if (this.matchmaking) {
      this.matchmakingDots = (this.matchmakingDots + 0.02) % 4;
      const dots = '.'.repeat(Math.floor(this.matchmakingDots));
      ctx.shadowColor = '#ff9800';
      ctx.shadowBlur = 12 * (0.3 + 0.3 * Math.sin(this.pulseTime / 300));
      this.ui.drawSword(ctx, btns.findGame.x, btns.findGame.y, btns.findGame.w, btns.findGame.h, 1);
      ctx.shadowBlur = 0;
      this.drawSwordLabel(ctx, btns.findGame, `SEARCHING${dots}`, 0.6 + 0.4 * Math.sin(this.pulseTime / 300));
    } else {
      this.ui.drawSword(ctx, btns.findGame.x, btns.findGame.y, btns.findGame.w, btns.findGame.h, 1);
      this.drawSwordLabel(ctx, btns.findGame, 'FIND GAME', 1);
    }

    // CREATE PARTY — yellow sword
    this.ui.drawSword(ctx, btns.create.x, btns.create.y, btns.create.w, btns.create.h, 2);
    this.drawSwordLabel(ctx, btns.create, 'CREATE PARTY', 1);

    // JOIN PARTY — purple sword
    this.ui.drawSword(ctx, btns.join.x, btns.join.y, btns.join.w, btns.join.h, 3);
    this.drawSwordLabel(ctx, btns.join, 'JOIN PARTY', 1);

    // UNIT GALLERY — dark sword
    this.ui.drawSword(ctx, btns.gallery.x, btns.gallery.y, btns.gallery.w, btns.gallery.h, 4);
    this.drawSwordLabel(ctx, btns.gallery, 'UNIT GALLERY', 1);
  }

  private drawSwordLabel(
    ctx: CanvasRenderingContext2D,
    rect: { x: number; y: number; w: number; h: number },
    text: string,
    alpha: number,
  ): void {
    const fontSize = Math.max(11, Math.min(rect.h * 0.32, 18));
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = alpha;
    const tx = rect.x + rect.w * 0.52;
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
    const avatarSize = nameH * 2;   // profile button is 2x name height
    const diceSize = nameH;
    const gap = 6;

    ctx.font = `bold ${fontSize}px monospace`;
    const nameW = ctx.measureText(this.playerName).width;

    // Positions — avatar on far left, then name pill to its right
    const avatarX = 8;
    const avatarY = 8;
    const pillX = avatarX + avatarSize + gap;
    const pillY = avatarY + (avatarSize - nameH) / 2;  // vertically center with avatar
    const totalPillW = diceSize + 6 + nameW;
    const pillPad = 8;

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
        const sprData = this.sprites.getUnitSprite(avatarDef.race, avatarDef.category, 0);
        if (sprData) {
          const [img, def] = sprData;
          const tick = Math.floor(this.pulseTime / 50);
          const ticksPerFrame = Math.max(1, Math.round(20 / def.cols));
          const frame = Math.floor(tick / ticksPerFrame) % def.cols;
          const aspect = def.frameW / def.frameH;
          const sprInset = 4;
          const sprSize = avatarSize - sprInset * 2;
          const drawH = sprSize;
          const drawW = drawH * aspect;
          const gY = def.groundY ?? 0.71;
          const feetY = avatarY + avatarSize - sprInset - 2;
          const drawY = feetY - drawH * gY;
          const drawX = avatarX + (avatarSize - drawW) / 2;
          drawSpriteFrame(ctx, img, def, frame, drawX, drawY, drawW, drawH);
        }
      }
    }

    // ── Name pill background ──
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.roundRect(pillX - pillPad, pillY - pillPad, totalPillW + pillPad * 2, nameH + pillPad * 2, nameH / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,215,0,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(pillX - pillPad, pillY - pillPad, totalPillW + pillPad * 2, nameH + pillPad * 2, nameH / 2);
    ctx.stroke();

    // ── Dice button ──
    const diceX = pillX;
    const diceY = pillY;
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

    // ── Player name ──
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.fillStyle = '#ffd700';
    ctx.fillText(this.playerName, pillX + diceSize + 6, pillY + nameH / 2);
    ctx.textBaseline = 'alphabetic';
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
    ctx.fillStyle = '#fff';
    ctx.fillText('ENTER INVITE CODE', w / 2, boxY + boxH * 0.25);

    // Code display
    const codeSize = Math.max(18, Math.min(boxH * 0.28, 32));
    ctx.font = `bold ${codeSize}px monospace`;
    const display = this.joinCodeInput + (Math.floor(this.animTime * 2) % 2 === 0 ? '_' : ' ');
    ctx.fillStyle = '#ffe082';
    ctx.fillText(display, w / 2, boxY + boxH * 0.52);

    // Hint
    ctx.font = `${Math.max(9, labelSize * 0.8)}px monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('Type code + Enter  |  ESC to cancel', w / 2, boxY + boxH * 0.78);
  }

  // ─── Render: Party panel ───

  private renderPartyPanel(ctx: CanvasRenderingContext2D, w: number, _h: number): void {
    const pl = this.getPartyLayout();
    const ps = this.partyState!;

    // Panel background
    this.ui.drawWoodTable(ctx, pl.panel.x, pl.panel.y, pl.panel.w, pl.panel.h);

    const fontSize = Math.max(10, Math.min(pl.panel.w / 28, 15));

    // Header ribbon with invite code
    const codeRibW = pl.panel.w * 0.6;
    const codeRibH = 32;
    const codeRibX = pl.panel.x + (pl.panel.w - codeRibW) / 2;
    const codeRibY = pl.panel.y + 8;
    this.ui.drawSmallRibbon(ctx, codeRibX, codeRibY, codeRibW, codeRibH, 2); // yellow
    ctx.font = `bold ${Math.max(11, codeRibH * 0.42)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText(`PARTY  ${ps.code}`, w / 2 + 1, codeRibY + codeRibH * 0.5 + 1);
    ctx.fillStyle = '#fff';
    ctx.fillText(`PARTY  ${ps.code}`, w / 2, codeRibY + codeRibH * 0.5);

    // Tap to copy hint
    ctx.font = `${Math.max(8, fontSize * 0.7)}px monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('click code to copy', w / 2, codeRibY + codeRibH + 10);

    // Player slots
    const halfW = pl.panel.w / 2;
    this.renderPlayerSlot(ctx, pl.panel.x, pl.panel.y + pl.panel.h * 0.30, halfW, ps.host, true, pl.slot1Race);
    if (ps.guest) {
      this.renderPlayerSlot(ctx, pl.panel.x + halfW, pl.panel.y + pl.panel.h * 0.30, halfW, ps.guest, false, pl.slot2Race);
    } else {
      // Empty slot
      const slotCx = pl.panel.x + halfW + halfW / 2;
      const slotY = pl.panel.y + pl.panel.h * 0.38;
      ctx.font = `bold ${fontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillText('Waiting...', slotCx, slotY);
      ctx.font = `${Math.max(8, fontSize * 0.7)}px monospace`;
      ctx.fillText('Share the code!', slotCx, slotY + fontSize * 1.5);
    }

    // Divider line between slots
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pl.panel.x + halfW, pl.panel.y + pl.panel.h * 0.28);
    ctx.lineTo(pl.panel.x + halfW, pl.panel.y + pl.panel.h * 0.75);
    ctx.stroke();

    // Difficulty selector (host sees buttons, guest sees label)
    const isHost = this.party?.isHost;
    {
      const diffY = pl.diffBtns[0].y;
      const diffLabelSize = Math.max(7, fontSize * 0.65);
      ctx.font = `${diffLabelSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillText('DIFFICULTY', w / 2, diffY - 4);

      // Read from party state if guest, local index if host
      const activeIdx = isHost
        ? this.partyDifficultyIndex
        : PARTY_DIFFICULTY_OPTIONS.findIndex(d => d.level === (ps.difficulty ?? BotDifficultyLevel.Medium));
      const resolvedIdx = activeIdx >= 0 ? activeIdx : 1;

      for (let i = 0; i < PARTY_DIFFICULTY_OPTIONS.length; i++) {
        const d = PARTY_DIFFICULTY_OPTIONS[i];
        const b = pl.diffBtns[i];
        const isSel = i === resolvedIdx;

        ctx.fillStyle = isSel ? d.color : 'rgba(0,0,0,0.3)';
        const r = 3;
        ctx.beginPath();
        ctx.moveTo(b.x + r, b.y);
        ctx.lineTo(b.x + b.w - r, b.y);
        ctx.arcTo(b.x + b.w, b.y, b.x + b.w, b.y + r, r);
        ctx.lineTo(b.x + b.w, b.y + b.h - r);
        ctx.arcTo(b.x + b.w, b.y + b.h, b.x + b.w - r, b.y + b.h, r);
        ctx.lineTo(b.x + r, b.y + b.h);
        ctx.arcTo(b.x, b.y + b.h, b.x, b.y + b.h - r, r);
        ctx.lineTo(b.x, b.y + r);
        ctx.arcTo(b.x, b.y, b.x + r, b.y, r);
        ctx.closePath();
        ctx.fill();

        if (!isSel) {
          ctx.strokeStyle = d.color;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Only host can click, dim for guest
        if (!isHost && !isSel) ctx.globalAlpha = 0.4;
        const lblSize = Math.max(7, Math.min(b.w / 5, 10));
        ctx.font = `bold ${lblSize}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillStyle = isSel ? '#000' : d.color;
        ctx.fillText(d.label, b.x + b.w / 2, b.y + b.h / 2 + lblSize * 0.35);
        ctx.globalAlpha = 1;
      }
    }

    // START button (host only, enabled when 2 players)
    if (isHost) {
      const canStart = !!ps.guest;
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
  ): void {
    const cx = x + slotW / 2;
    const fontSize = Math.max(10, Math.min(slotW / 10, 14));

    // Race icon (unit sprite as avatar)
    const spriteData = this.sprites.getUnitSprite(player.race, 'melee', isHost ? 0 : 1);
    if (spriteData) {
      const [img, def] = spriteData;
      const iconSize = raceRect.w;
      const frame = Math.floor(this.animTime * 5) % def.cols;
      const gY = def.groundY ?? 0.71;
      const drawY = raceRect.y + raceRect.h - iconSize * gY;
      drawSpriteFrame(ctx, img, def, frame, raceRect.x, drawY, iconSize, iconSize);
    }

    // Race label below icon
    const labelY = raceRect.y + raceRect.h + 6;
    const colors = RACE_COLORS[player.race];
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = colors.primary;
    ctx.fillText(RACE_LABELS[player.race], cx, labelY);

    // Player name
    ctx.font = `${Math.max(9, fontSize * 0.85)}px monospace`;
    ctx.fillStyle = '#fff';
    ctx.fillText(player.name, cx, labelY + fontSize * 1.3);

    // Host crown or "Guest" label
    ctx.font = `${Math.max(8, fontSize * 0.7)}px monospace`;
    ctx.fillStyle = isHost ? '#ffe082' : 'rgba(255,255,255,0.5)';
    ctx.fillText(isHost ? 'HOST' : 'GUEST', cx, labelY + fontSize * 2.4);

    // "Click to change" hint if this is the local player's slot
    const isLocalSlot = this.party &&
      ((this.party.isHost && isHost) || (!this.party.isHost && !isHost));
    if (isLocalSlot) {
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
    const frame = frameTick % def.cols;
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
        const shieldPct = Math.min(1, unit.shieldHp / 20);
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
