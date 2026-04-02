import { Race, BuildingType, StatusType, StatusEffect, TICK_RATE } from '../simulation/types';
import { UNIT_STATS, UPGRADE_TREES } from '../simulation/data';
import { getUnitUpgradeMultipliers } from '../simulation/SimShared';
import { getAudioSettings } from '../audio/AudioSettings';

// ─── Mini 1v1 simulation using real game stats ───

export const ALL_RACES = [Race.Crown, Race.Horde, Race.Goblins, Race.Oozlings, Race.Demon, Race.Deep, Race.Wild, Race.Geists, Race.Tenders];
export const UNIT_TYPES: BuildingType[] = [BuildingType.MeleeSpawner, BuildingType.RangedSpawner, BuildingType.CasterSpawner];

export function categoryOf(bt: BuildingType): 'melee' | 'ranged' | 'caster' {
  if (bt === BuildingType.RangedSpawner) return 'ranged';
  if (bt === BuildingType.CasterSpawner) return 'caster';
  return 'melee';
}

export const ARENA_WIDTH = 20;

export interface DuelUnit {
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

export interface DuelProjectile {
  x: number;
  targetX: number; // snapshot of target position when fired
  speed: number; // tiles per second
  damage: number;
  sourceRace: Race;
  sourceCategory: 'melee' | 'ranged' | 'caster';
  sourceUpgradeNode: string; // 'A', 'B', etc. — for projectile visual lookup
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
export function getSpawnCountForUnit(race: Race, unitType: BuildingType, upgradePath: string[]): number {
  const stats = UNIT_STATS[race]?.[unitType];
  const baseCount = stats?.spawnCount ?? 1;
  const upgrade = getUnitUpgradeMultipliers(upgradePath, race, unitType);
  return upgrade.special.spawnCount ?? baseCount;
}

export function pickUpgradePath(tier: 1 | 2 | 3): string[] {
  if (tier === 2) return TIER2_PATHS[Math.floor(Math.random() * TIER2_PATHS.length)];
  if (tier === 3) return TIER3_PATHS[Math.floor(Math.random() * TIER3_PATHS.length)];
  return ['A'];
}

export function createDuelUnit(race: Race, unitType: BuildingType, x: number, facingLeft: boolean, playerId: number, tier: 1 | 2 | 3 = 1, fixedPath?: string[]): DuelUnit {
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
    attackTimer: 0,
    moveSpeed: Math.max(0.5, stats.moveSpeed * upgrade.moveSpeed),
    range: Math.max(1, stats.range * upgrade.range),
    facingLeft, statusEffects: [], shieldHp: 0, hitCount: 0, alive: true,
    playerId, statusTickAcc: 0, isAttacking: false, attackAnimTimer: 0,
  };
}

export function getEffectiveSpeed(unit: DuelUnit): number {
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

// On-hit effects matching the real game combat subsystem (SimCombat.ts applyOnHitEffects)
function applyDuelOnHit(attacker: DuelUnit, target: DuelUnit): void {
  const isMelee = attacker.range <= 2;
  const isCaster = attacker.category === 'caster';
  switch (attacker.race) {
    case Race.Crown:
      break;
    case Race.Horde:
      if (isMelee) {
        attacker.hitCount++;
        if (attacker.hitCount % 3 === 0) {
          target.x += target.facingLeft ? 0.8 : -0.8;
          target.x = Math.max(0, Math.min(ARENA_WIDTH, target.x));
        }
      }
      break;
    case Race.Goblins:
      if (!isMelee && !isCaster) applyStatus(target, StatusType.Burn, 1);
      break;
    case Race.Oozlings:
      if (isMelee && Math.random() < 0.15) applyStatus(attacker, StatusType.Haste, 1);
      break;
    case Race.Demon:
      if (isMelee) applyStatus(target, StatusType.Burn, 1);
      break;
    case Race.Deep:
      if (isMelee) applyStatus(target, StatusType.Slow, 1);
      if (!isMelee && !isCaster) applyStatus(target, StatusType.Slow, 2);
      break;
    case Race.Wild:
      if (isMelee) applyStatus(target, StatusType.Burn, 1);
      break;
    case Race.Geists:
      if (isMelee) {
        applyStatus(target, StatusType.Burn, 1);
        attacker.hp = Math.min(attacker.maxHp, attacker.hp + Math.round(attacker.damage * 0.15));
      }
      if (!isMelee && !isCaster) {
        attacker.hp = Math.min(attacker.maxHp, attacker.hp + Math.round(attacker.damage * 0.2));
      }
      break;
    case Race.Tenders:
      if (isMelee) applyStatus(target, StatusType.Slow, 1);
      break;
  }
}

// Caster support abilities (self-applied in 1v1 context, matching real game logic)
function applyCasterSupport(caster: DuelUnit): void {
  switch (caster.race) {
    case Race.Crown:
      applyStatus(caster, StatusType.Shield, 1);
      break;
    case Race.Horde:
    case Race.Oozlings:
    case Race.Wild:
      applyStatus(caster, StatusType.Haste, 1);
      break;
    case Race.Goblins:
      break;
    case Race.Demon:
      break;
    case Race.Deep:
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
      caster.hp = Math.min(caster.maxHp, caster.hp + 2);
      break;
    case Race.Tenders:
      caster.hp = Math.min(caster.maxHp, caster.hp + 3);
      break;
  }
}

export function tickDuelStatusEffects(unit: DuelUnit, dtSec: number): void {
  unit.statusTickAcc += dtSec;
  const fullSecondTicks = Math.floor(unit.statusTickAcc);
  if (fullSecondTicks > 0) unit.statusTickAcc -= fullSecondTicks;

  for (let i = unit.statusEffects.length - 1; i >= 0; i--) {
    const eff = unit.statusEffects[i];
    eff.duration -= dtSec * TICK_RATE;

    if (eff.type === StatusType.Burn && fullSecondTicks > 0) {
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

// Combat tick — fires projectiles for ranged/caster instead of instant damage
export function tickDuelCombat(
  attacker: DuelUnit, target: DuelUnit, dtSec: number,
  projectiles: DuelProjectile[],
): void {
  if (!attacker.alive || !target.alive) return;

  let dist = Math.abs(target.x - attacker.x);

  // Move toward target if out of range
  if (dist > attacker.range) {
    const speed = getEffectiveSpeed(attacker);
    const step = Math.min(speed * dtSec, dist - attacker.range);
    attacker.x += attacker.facingLeft ? -step : step;
    dist = Math.abs(target.x - attacker.x);
  }

  // Attack
  attacker.attackTimer = Math.max(0, attacker.attackTimer - dtSec);
  if (attacker.attackTimer <= 0 && dist <= attacker.range + 0.15) {
    attacker.attackTimer = attacker.attackSpeed;
    attacker.isAttacking = true;
    attacker.attackAnimTimer = attacker.attackSpeed;

    const isMelee = attacker.range <= 2;
    const isCaster = attacker.category === 'caster';

    // Caster support abilities fire on attack
    if (isCaster) {
      applyCasterSupport(attacker);
      if (attacker.race === Race.Goblins) {
        applyStatus(target, StatusType.Slow, 1);
      }
    }

    if (isMelee) {
      dealDuelDamage(target, attacker.damage);
      applyDuelOnHit(attacker, target);
    } else {
      const projSpeed = isCaster ? 10 : 15;
      projectiles.push({
        x: attacker.x,
        targetX: target.x,
        speed: projSpeed,
        damage: attacker.damage,
        sourceRace: attacker.race,
        sourceCategory: attacker.category,
        sourceUpgradeNode: attacker.upgradeNode ?? 'A',
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
export function tickDuelProjectiles(projectiles: DuelProjectile[], dtSec: number): boolean {
  let anyHit = false;
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.age += dtSec;

    const tx = p.targetUnit.alive ? p.targetUnit.x : p.targetX;
    const dx = tx - p.x;
    const moveAmt = p.speed * dtSec;

    if (Math.abs(dx) <= moveAmt || p.age > 3) {
      if (p.targetUnit.alive) {
        dealDuelDamage(p.targetUnit, p.damage);
        const isCaster = p.sourceCategory === 'caster';
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

export function findNearestEnemy(unit: DuelUnit, enemies: DuelUnit[]): DuelUnit | null {
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

export class TitleSfx {
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
