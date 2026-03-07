import { Scene, SceneManager } from './Scene';
import { UIAssets } from '../rendering/UIAssets';
import { SpriteLoader, drawSpriteFrame, drawGridFrame } from '../rendering/SpriteLoader';
import { Race, BuildingType, StatusType, StatusEffect, TICK_RATE } from '../simulation/types';
import { UNIT_STATS, RACE_COLORS } from '../simulation/data';
import { PartyManager, PartyState, PartyPlayer } from '../network/PartyManager';
import { isFirebaseConfigured, initFirebase } from '../network/FirebaseService';

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
  name: string;
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

function createDuelUnit(race: Race, unitType: BuildingType, x: number, facingLeft: boolean, playerId: number): DuelUnit {
  const stats = UNIT_STATS[race][unitType]!;
  return {
    race, category: categoryOf(unitType), name: stats.name,
    x, hp: stats.hp, maxHp: stats.hp,
    damage: stats.damage, attackSpeed: stats.attackSpeed, attackTimer: stats.attackSpeed * 0.3,
    moveSpeed: stats.moveSpeed, range: stats.range,
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

function loadAllElo(): Record<string, number> {
  try {
    const raw = localStorage.getItem(ELO_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveAllElo(data: Record<string, number>): void {
  try { localStorage.setItem(ELO_STORAGE_KEY, JSON.stringify(data)); } catch {}
}

function getElo(race: Race, category: 'melee' | 'ranged' | 'caster'): number {
  const data = loadAllElo();
  return data[eloKey(race, category)] ?? ELO_DEFAULT;
}

function updateElo(winner: DuelUnit | null, loser: DuelUnit | null, isDraw: boolean): void {
  if (!winner && !loser) return;
  const data = loadAllElo();

  if (isDraw && winner && loser) {
    // Both units get draw adjustment
    const keyA = eloKey(winner.race, winner.category);
    const keyB = eloKey(loser.race, loser.category);
    const eloA = data[keyA] ?? ELO_DEFAULT;
    const eloB = data[keyB] ?? ELO_DEFAULT;
    const expectedA = 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
    const expectedB = 1 - expectedA;
    data[keyA] = Math.round(eloA + ELO_K * (0.5 - expectedA));
    data[keyB] = Math.round(eloB + ELO_K * (0.5 - expectedB));
  } else if (winner && loser) {
    const keyW = eloKey(winner.race, winner.category);
    const keyL = eloKey(loser.race, loser.category);
    const eloW = data[keyW] ?? ELO_DEFAULT;
    const eloL = data[keyL] ?? ELO_DEFAULT;
    const expectedW = 1 / (1 + Math.pow(10, (eloL - eloW) / 400));
    const expectedL = 1 - expectedW;
    data[keyW] = Math.round(eloW + ELO_K * (1 - expectedW));
    data[keyL] = Math.round(eloL + ELO_K * (0 - expectedL));
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

export class TitleScene implements Scene {
  private manager: SceneManager;
  private canvas: HTMLCanvasElement;
  private ui: UIAssets;
  private sprites: SpriteLoader;
  private pulseTime = 0;
  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private touchHandler: ((e: TouchEvent) => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  // Duel state
  private blue: DuelUnit | null = null;
  private red: DuelUnit | null = null;
  private projectiles: DuelProjectile[] = [];
  private waitTimer = 0;
  private waiting = true;
  private deathFade = 0;
  private deadUnit: DuelUnit | null = null;
  private winnerLeaving = false;
  private animTime = 0;

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
  private joinCodeInput: string = '';
  private joinInputActive = false;
  private firebaseReady = false;
  onPartyStart: ((party: PartyState) => void) | null = null;

  constructor(manager: SceneManager, canvas: HTMLCanvasElement, ui: UIAssets, sprites: SpriteLoader) {
    this.manager = manager;
    this.canvas = canvas;
    this.ui = ui;
    this.sprites = sprites;
  }

  enter(): void {
    this.pulseTime = 0;
    this.waiting = true;
    this.waitTimer = 0.5;
    this.blue = null;
    this.red = null;
    this.projectiles = [];
    this.winText = '';
    this.winTimer = 0;
    this.userInteracted = false;
    this.joinCodeInput = '';
    this.joinInputActive = false;
    this.partyError = '';

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

  private partyListener = (s: PartyState | null) => {
    this.partyState = s;
    if (s && s.status === 'starting' && this.onPartyStart) {
      this.onPartyStart(s);
    }
  };

  // ─── Button layout ───

  private getButtonLayout(): {
    solo: { x: number; y: number; w: number; h: number };
    create: { x: number; y: number; w: number; h: number };
    join: { x: number; y: number; w: number; h: number };
  } {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const btnW = Math.min(w * 0.38, 280);
    const btnH = Math.min(h * 0.07, 52);
    const gap = 10;
    const startY = h * 0.28;
    return {
      solo: { x: (w - btnW) / 2, y: startY, w: btnW, h: btnH },
      create: { x: (w - btnW) / 2, y: startY + btnH + gap, w: btnW, h: btnH },
      join: { x: (w - btnW) / 2, y: startY + (btnH + gap) * 2, w: btnW, h: btnH },
    };
  }

  private getPartyLayout(): {
    panel: { x: number; y: number; w: number; h: number };
    slot1Race: { x: number; y: number; w: number; h: number };
    slot2Race: { x: number; y: number; w: number; h: number };
    start: { x: number; y: number; w: number; h: number };
    leave: { x: number; y: number; w: number; h: number };
    code: { x: number; y: number; w: number; h: number };
  } {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const panelW = Math.min(w * 0.7, 440);
    const panelH = Math.min(h * 0.42, 300);
    const px = (w - panelW) / 2;
    const py = h * 0.26;
    const slotW = 40;
    const slotH = 40;
    const slotY = py + panelH * 0.40;
    const halfW = panelW / 2;
    return {
      panel: { x: px, y: py, w: panelW, h: panelH },
      slot1Race: { x: px + halfW * 0.5 - slotW / 2, y: slotY, w: slotW, h: slotH },
      slot2Race: { x: px + halfW + halfW * 0.5 - slotW / 2, y: slotY, w: slotW, h: slotH },
      start: { x: px + panelW * 0.15, y: py + panelH - 56, w: panelW * 0.42, h: 44 },
      leave: { x: px + panelW * 0.60, y: py + panelH - 56, w: panelW * 0.28, h: 44 },
      code: { x: px + panelW * 0.25, y: py + 8, w: panelW * 0.5, h: 36 },
    };
  }

  private hitRect(cx: number, cy: number, r: { x: number; y: number; w: number; h: number }): boolean {
    return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
  }

  private handleClick(cx: number, cy: number): void {
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

    const btns = this.getButtonLayout();
    if (this.hitRect(cx, cy, btns.solo)) {
      this.manager.switchTo('raceSelect');
      return;
    }
    if (this.hitRect(cx, cy, btns.create)) {
      this.doCreateParty();
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
      this.showPartyError(err.message || 'Firebase error');
      throw err;
    });
    return this.firebaseInitPromise;
  }

  private async doCreateParty(): Promise<void> {
    try {
      await this.ensureFirebase();
      await this.party!.createParty(Race.Crown);
    } catch (e: any) {
      this.showPartyError(e.message || 'Failed to create party');
    }
  }

  private async doJoinParty(): Promise<void> {
    if (this.joinCodeInput.length < 4) return;
    try {
      await this.ensureFirebase();
      await this.party!.joinParty(this.joinCodeInput, Race.Crown);
      this.joinInputActive = false;
      this.joinCodeInput = '';
    } catch (e: any) {
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
    const blueRace = ALL_RACES[Math.floor(Math.random() * ALL_RACES.length)];
    const redRace = ALL_RACES[Math.floor(Math.random() * ALL_RACES.length)];
    const blueType = UNIT_TYPES[Math.floor(Math.random() * UNIT_TYPES.length)];
    const redType = UNIT_TYPES[Math.floor(Math.random() * UNIT_TYPES.length)];

    this.blue = createDuelUnit(blueRace, blueType, -2, false, 0);
    this.red = createDuelUnit(redRace, redType, ARENA_WIDTH + 2, true, 2);
    this.projectiles = [];
    this.waiting = false;
    this.winnerLeaving = false;
    this.deadUnit = null;
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

    const blue = this.blue!;
    const red = this.red!;

    // Decay attack animation timers
    if (blue.attackAnimTimer > 0) {
      blue.attackAnimTimer -= dtSec;
      if (blue.attackAnimTimer <= 0) blue.isAttacking = false;
    }
    if (red.attackAnimTimer > 0) {
      red.attackAnimTimer -= dtSec;
      if (red.attackAnimTimer <= 0) red.isAttacking = false;
    }

    // Play fight start sound when units are close enough
    if (!this.fightStartPlayed && blue.alive && red.alive) {
      const dist = Math.abs(red.x - blue.x);
      if (dist <= Math.max(blue.range, red.range) + 1) {
        this.fightStartPlayed = true;
        if (this.userInteracted) this.sfx.playFightStart();
      }
    }

    if (this.winnerLeaving) {
      const winner = blue.alive ? blue : (red.alive ? red : null);
      if (winner) {
        const speed = getEffectiveSpeed(winner);
        winner.x += winner.facingLeft ? -speed * dtSec : speed * dtSec;
      }

      if (this.deathFade > 0) this.deathFade -= dtSec * 2;

      // Tick remaining projectiles even during exit
      tickDuelProjectiles(this.projectiles, dtSec);

      const done = !winner
        ? this.deathFade <= 0
        : (winner.x < -3 || winner.x > ARENA_WIDTH + 3);

      if (done) {
        this.waiting = true;
        this.waitTimer = 3;
        this.blue = null;
        this.red = null;
        this.projectiles = [];
      }
      return;
    }

    // Both alive — run combat simulation
    if (blue.alive && red.alive) {
      const blueHpBefore = blue.hp;
      const redHpBefore = red.hp;

      tickDuelCombat(blue, red, dtSec, this.projectiles);
      tickDuelCombat(red, blue, dtSec, this.projectiles);
      const projHit = tickDuelProjectiles(this.projectiles, dtSec);
      tickDuelStatusEffects(blue, dtSec);
      tickDuelStatusEffects(red, dtSec);

      // Play hit sounds
      if (this.userInteracted) {
        if (red.hp < redHpBefore && red.alive) this.sfx.playHit();
        else if (blue.hp < blueHpBefore && blue.alive) this.sfx.playHit();
        else if (projHit) this.sfx.playHit();
      }

      // Check deaths
      if (!blue.alive || !red.alive) {
        if (!blue.alive && !red.alive) {
          updateElo(blue, red, true);
          this.winText = 'DRAW!';
          this.winColor = '#aaa';
          this.winTimer = 2.5;
          this.winScale = 0;
          this.deadUnit = blue;
          this.deathFade = 1;
          this.winnerLeaving = true;
          if (this.userInteracted) this.sfx.playDraw();
        } else {
          const winner = blue.alive ? blue : red;
          const loser = blue.alive ? red : blue;
          updateElo(winner, loser, false);
          this.winText = `${winner.name} WINS!`;
          this.winColor = blue.alive ? '#4488ff' : '#ff4444';
          this.winTimer = 2.5;
          this.winScale = 0;
          this.deadUnit = loser;
          this.deathFade = 1;
          this.winnerLeaving = true;
          if (this.userInteracted) {
            this.sfx.playKill();
            this.sfx.playWin();
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

    // Draw dead unit (fading) first, then living
    if (this.deadUnit && this.deathFade > 0) {
      ctx.globalAlpha = Math.max(0, this.deathFade);
      this.drawDuelUnit(ctx, this.deadUnit, unitSize, unitBaseY, frameTick, w);
      ctx.globalAlpha = 1;
    }

    if (this.blue?.alive) this.drawDuelUnit(ctx, this.blue, unitSize, unitBaseY, frameTick, w);
    if (this.red?.alive) this.drawDuelUnit(ctx, this.red, unitSize, unitBaseY, frameTick, w);

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

    // === VS Banner ===
    if (this.blue && this.red) {
      const vsY = groundY + 4;
      const vsH = Math.max(44, Math.min(h * 0.08, 56));
      const vsW = Math.min(w * 0.85, 480);
      const vsX = (w - vsW) / 2;

      this.ui.drawWoodTable(ctx, vsX, vsY, vsW, vsH);

      const fontSize = Math.max(11, Math.min(vsH * 0.32, 16));
      ctx.textBaseline = 'middle';
      const nameY = vsY + vsH * 0.35;
      const eloLineY = vsY + vsH * 0.72;

      // ELO lookup
      const blueElo = getElo(this.blue.race, this.blue.category);
      const redElo = getElo(this.red.race, this.red.category);
      const blueFavored = blueElo > redElo;
      const redFavored = redElo > blueElo;

      // Blue name (left side)
      const blueColor = RACE_COLORS[this.blue.race].primary;
      ctx.font = `bold ${fontSize}px monospace`;
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(this.blue.name, w / 2 - fontSize * 1.2 + 1, nameY + 1);
      ctx.fillStyle = blueColor;
      ctx.fillText(this.blue.name, w / 2 - fontSize * 1.2, nameY);

      // VS in the center
      ctx.textAlign = 'center';
      ctx.font = `bold ${Math.round(fontSize * 1.3)}px monospace`;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText('VS', w / 2 + 1, nameY + 1);
      ctx.fillStyle = '#fff';
      ctx.fillText('VS', w / 2, nameY);

      // Red name (right side)
      const redColor = RACE_COLORS[this.red.race].primary;
      ctx.font = `bold ${fontSize}px monospace`;
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(this.red.name, w / 2 + fontSize * 1.2 + 1, nameY + 1);
      ctx.fillStyle = redColor;
      ctx.fillText(this.red.name, w / 2 + fontSize * 1.2, nameY);

      // ELO line
      const eloFontSize = Math.max(9, fontSize * 0.7);
      ctx.font = `${eloFontSize}px monospace`;

      // Blue ELO (left)
      ctx.textAlign = 'right';
      const blueEloText = `${blueFavored ? '\u2713 ' : ''}${blueElo}`;
      ctx.fillStyle = blueFavored ? '#ffe082' : 'rgba(255,255,255,0.6)';
      ctx.fillText(blueEloText, w / 2 - fontSize * 1.2, eloLineY);

      // Red ELO (right)
      ctx.textAlign = 'left';
      const redEloText = `${redElo}${redFavored ? ' \u2713' : ''}`;
      ctx.fillStyle = redFavored ? '#ffe082' : 'rgba(255,255,255,0.6)';
      ctx.fillText(redEloText, w / 2 + fontSize * 1.2, eloLineY);
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

    // CREATE PARTY — yellow sword
    this.ui.drawSword(ctx, btns.create.x, btns.create.y, btns.create.w, btns.create.h, 2);
    this.drawSwordLabel(ctx, btns.create, 'CREATE PARTY', 1);

    // JOIN PARTY — purple sword
    this.ui.drawSword(ctx, btns.join.x, btns.join.y, btns.join.w, btns.join.h, 3);
    this.drawSwordLabel(ctx, btns.join, 'JOIN PARTY', 1);
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

    // START button (host only, enabled when 2 players)
    const isHost = this.party?.isHost;
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
    const spriteData = this.sprites.getUnitSprite(unit.race, unit.category, unit.playerId, attacking);
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
