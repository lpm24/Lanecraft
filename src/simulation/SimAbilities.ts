/**
 * Race abilities, nuke system, diamond/wood mechanics, and death resource tracking.
 *
 * Command handlers (called from processCommand in GameState.ts):
 *   useAbility   — validates cost/cooldown, dispatches to per-race handler
 *   fireNuke     — creates nuke telegraph (delayed detonation)
 *   addPing, addQuickChat, concedeMatch
 *
 * Tick functions (called from simulateTick in GameState.ts):
 *   tickAbilityEffects   — cooldowns, active effect processing, seed growth
 *   tickNukeTelegraphs   — countdown + detonation
 *
 * Game mechanics helpers (used by SimCombat, SimMovement, SimHarvesters):
 *   trackDeathResources, dropDiamond, spawnDiamondChampion
 *   dropWoodPile, collectWoodPiles, spillCarriedWood, killHarvester
 */
import {
  GameState, PlayerState, Team, Race, Lane,
  BuildingType, UnitState, HarvesterState, WoodPileState, PotionType,
  StatusType, GameCommand, AbilityEffect, ResourceType,
  TICK_RATE, NUKE_RADIUS,
} from './types';
import {
  UNIT_STATS, RACE_ABILITY_DEFS, ABILITY_COST_MODIFIERS,
  HARVESTER_RESPAWN_TICKS,
} from './data';
import {
  genId, addSound, addFloatingText, addDeathParticles, addCombatEvent,
  compactInPlace,
  _combatGrid, _unitById,
  DIAMOND_RESPAWN_TICKS, CHAMPION_BASE_HP, CHAMPION_BASE_DAMAGE,
  CHAMPION_MOVE_SPEED, CHAMPION_ATTACK_SPEED, CHAMPION_RANGE, CHAMPION_SCALE_PER_DELIVERY,
  WOOD_PICKUP_RADIUS, WOOD_PILE_SPREAD_RADIUS,
} from './SimShared';
import {
  getHQPosition, getTeamAlleyOrigin, getLanePath, findNearestPathProgress,
  isAlleyCellExcludedByGoldMine,
} from './SimLayout';
import {
  dealDamage, applyStatus, healUnit, trackHealing,
  clampToArenaBounds,
} from './SimMovement';

// === Race Abilities ===

export function useAbility(state: GameState, cmd: Extract<GameCommand, { type: 'use_ability' }>): void {
  if (state.matchPhase !== 'playing') return;
  const player = state.players[cmd.playerId];
  if (!player || player.isEmpty) return;
  const def = RACE_ABILITY_DEFS[player.race];
  if (!def) return;

  // Tenders uses stack-based system (no cost, no cooldown — needs stacks)
  const isTendersSeeds = player.race === Race.Tenders;

  // Calculate growing cost (non-Tenders)
  const growthMult = def.costGrowthFactor ? Math.pow(def.costGrowthFactor, player.abilityUseCount) : 1;
  // Geists: additive soul cost scaling (+10 per cast)
  const soulsCostAdditive = player.race === Race.Geists ? (def.baseCost.souls ?? 0) + 10 * player.abilityUseCount : 0;
  // Apply ability cost modifiers from research upgrades (centralised in data.ts)
  const mod = ABILITY_COST_MODIFIERS[player.race];
  const hasModUpgrade = mod && player.researchUpgrades.raceUpgrades[mod.upgradeId];
  const goldMult  = hasModUpgrade && (mod.field === 'gold' || mod.field === 'all') ? mod.mult : 1;
  const woodMult  = hasModUpgrade && (mod.field === 'wood' || mod.field === 'all') ? mod.mult : 1;
  const meatMult  = hasModUpgrade && (mod.field === 'meat' || mod.field === 'all') ? mod.mult : 1;
  const cost = {
    gold: Math.floor((def.baseCost.gold ?? 0) * growthMult * goldMult),
    wood: Math.floor((def.baseCost.wood ?? 0) * growthMult * woodMult),
    meat: Math.floor((def.baseCost.meat ?? 0) * growthMult * meatMult),
    mana: Math.floor((def.baseCost.mana ?? 0) * growthMult),
    souls: player.race === Race.Geists ? soulsCostAdditive : Math.floor((def.baseCost.souls ?? 0) * growthMult),
    deathEssence: Math.floor((def.baseCost.deathEssence ?? 0) * growthMult),
  };

  if (isTendersSeeds) {
    if (player.abilityStacks <= 0) return;
  } else {
    // Validate cooldown
    if (player.abilityCooldown > 0) return;
    // Validate resources
    if (player.gold < cost.gold) return;
    if (player.wood < cost.wood) return;
    if (player.meat < cost.meat) return;
    if (player.mana < cost.mana) return;
    if (player.souls < cost.souls) return;
    if (player.deathEssence < cost.deathEssence) return;
  }

  // Vision check for targeted abilities that require it
  if (def.requiresVision && state.fogOfWar && cmd.x != null && cmd.y != null) {
    const tx = Math.floor(cmd.x);
    const ty = Math.floor(cmd.y);
    const mapW = state.mapDef.width;
    if (tx >= 0 && ty >= 0 && tx < mapW && ty < state.mapDef.height) {
      if (!state.visibility[player.team][ty * mapW + tx]) return; // can't see target
    }
  }

  // Validate BuildSlot abilities have an open slot
  if (def.targetMode === 'build_slot') {
    if (cmd.gridX != null && cmd.gridY != null) {
      // Specific slot requested — validate it's open and in bounds
      if (cmd.gridX < 0 || cmd.gridX >= state.mapDef.towerAlleyCols || cmd.gridY < 0 || cmd.gridY >= state.mapDef.towerAlleyRows) return;
      if (isAlleyCellExcludedByGoldMine(cmd.gridX, cmd.gridY, player.team, state.mapDef)) return;
      const teamBuildings = state.buildings.filter(b =>
        b.buildGrid === 'alley' && (state.players[b.playerId]?.team ?? -1) === player.team
      );
      const occupant = teamBuildings.find(b => b.gridX === cmd.gridX && b.gridY === cmd.gridY);
      if (occupant) {
        // Tenders can stack seeds on existing seeds (up to T3)
        if (isTendersSeeds && occupant.isSeed && (occupant.seedTier ?? 0) < 2) {
          // Allow — will be upgraded in tendersAbility
        } else {
          return; // slot occupied by non-seed or already T3
        }
      }
    } else {
      // No slot specified (bot or fallback) — find first open
      if (!findOpenAlleySlot(state, player)) return;
    }
  }

  // Deduct resources / stacks
  if (isTendersSeeds) {
    player.abilityStacks--;
  } else {
    player.gold -= cost.gold;
    player.wood -= cost.wood;
    player.meat -= cost.meat;
    player.mana -= cost.mana;
    player.souls -= cost.souls;
    player.deathEssence -= cost.deathEssence;
    let cd = def.baseCooldownTicks;
    // Demon Rapid Fire: -25% fireball cooldown
    if (player.race === Race.Demon && player.researchUpgrades.raceUpgrades['demon_ability_1']) cd = Math.round(cd * 0.75);
    player.abilityCooldown = cd;
  }
  player.abilityUseCount++;

  // Dispatch to race-specific handler
  switch (player.race) {
    case Race.Deep: deepAbility(state, player); break;
    case Race.Horde: hordeAbility(state, player); break;
    case Race.Crown: crownAbility(state, player, cmd); break;
    case Race.Wild: wildAbility(state, player, cmd); break;
    case Race.Demon: demonAbility(state, player, cmd); break;
    case Race.Geists: geistsAbility(state, player, cmd); break;
    case Race.Goblins: goblinsAbility(state, player, cmd); break;
    case Race.Oozlings: oozlingsAbility(state, player, cmd); break;
    case Race.Tenders: tendersAbility(state, player, cmd); break;
  }

}

// --- Per-race ability handlers ---
function deepAbility(state: GameState, player: PlayerState): void {
  // Global slow all enemies for a duration
  state.abilityEffects.push({
    id: genId(state), type: 'deep_rain',
    playerId: player.id, team: player.team,
    duration: Math.round(4.8 * TICK_RATE),
  });
  addSound(state, 'ability_deluge');
}

function hordeAbility(state: GameState, player: PlayerState): void {
  // Spawn a big troll from the HQ that joins the nearest lane point
  const hq = getHQPosition(player.team, state.mapDef);
  const lane = state.rng() < 0.5 ? Lane.Left : Lane.Right;
  const scaleFactor = 1 + 0.15 * (player.abilityUseCount - 1); // gets slightly stronger each cast
  // Trophy Hunter: apply accumulated kill bonus from previous trolls
  const trophyKills = (player.researchUpgrades.raceUpgrades['horde_ability_4'] && player.trollKills > 0) ? player.trollKills : 0;
  const trophyMult = 1 + 0.02 * trophyKills;
  const trollX = hq.x + 2, trollY = hq.y + 1;
  const trollPath = getLanePath(player.team, lane, state.mapDef);
  const trollProgress = findNearestPathProgress(trollPath, trollX, trollY);
  const trollHp = Math.round(4500 * scaleFactor * trophyMult);
  const trollDmg = Math.round(82 * scaleFactor * trophyMult);
  state.units.push({
    id: genId(state), type: 'War Troll', playerId: player.id, team: player.team,
    x: trollX, y: trollY,
    hp: trollHp, maxHp: trollHp,
    damage: trollDmg,
    attackSpeed: 1.8, attackTimer: 0,
    moveSpeed: 2.7, range: 1.5,
    targetId: null, lane, pathProgress: trollProgress, carryingDiamond: false,
    statusEffects: [], hitCount: 0, shieldHp: 0,
    category: 'melee', upgradeTier: 0, upgradeNode: 'E', // Goblin troll warlord art
    spriteRace: Race.Goblins, visualScale: 2.0,
    upgradeSpecial: { knockbackChance: 0.3, _trollBaseDmg: trollDmg, _trollBaseHp: trollHp },
    kills: 0, damageDone: 0, damageTaken: 0, healingDone: 0, buffsApplied: 0, lastDamagedByName: '', spawnTick: state.tick,
  });
  const trollLabel = trophyKills > 0 ? `WAR TROLL! (+${trophyKills} trophies)` : 'WAR TROLL!';
  addFloatingText(state, trollX, trollY, trollLabel, '#ff6600');
  addSound(state, 'ability_troll', trollX, trollY);
}

/** Find first open alley slot for the player's team. */
export function findOpenAlleySlot(state: GameState, player: PlayerState): { gx: number; gy: number } | null {
  const teamAlleyBuildings = state.buildings.filter(b =>
    b.buildGrid === 'alley' && (state.players[b.playerId]?.team ?? -1) === player.team
  );
  for (let gy = 0; gy < state.mapDef.towerAlleyRows; gy++) {
    for (let gx = 0; gx < state.mapDef.towerAlleyCols; gx++) {
      if (isAlleyCellExcludedByGoldMine(gx, gy, player.team, state.mapDef)) continue;
      if (!teamAlleyBuildings.some(b => b.gridX === gx && b.gridY === gy)) {
        return { gx, gy };
      }
    }
  }
  return null;
}

function crownAbility(state: GameState, player: PlayerState, cmd: Extract<GameCommand, { type: 'use_ability' }>): void {
  // Place a Gold Foundry in the tower alley (+1 gold per second per foundry)
  const slot = (cmd.gridX != null && cmd.gridY != null) ? { gx: cmd.gridX, gy: cmd.gridY } : findOpenAlleySlot(state, player);
  if (!slot) return;
  const origin = getTeamAlleyOrigin(player.team, state.mapDef);
  const world = { x: origin.x + slot.gx, y: origin.y + slot.gy };
  state.buildings.push({
    id: genId(state), type: BuildingType.Tower, playerId: player.id, buildGrid: 'alley',
    gridX: slot.gx, gridY: slot.gy, worldX: world.x, worldY: world.y,
    lane: Lane.Left,
    hp: 120, maxHp: 120, actionTimer: 0, placedTick: state.tick, upgradePath: [],
    isFoundry: true, // marker for gold yield bonus
  });
  addFloatingText(state, world.x, world.y, 'FOUNDRY', '#ffd700');
  addSound(state, 'building_placed', world.x, world.y, { race: Race.Crown });
}

function wildAbility(state: GameState, player: PlayerState, cmd: Extract<GameCommand, { type: 'use_ability' }>): void {
  if (cmd.x == null || cmd.y == null) return;
  const def = RACE_ABILITY_DEFS[player.race];
  state.abilityEffects.push({
    id: genId(state), type: 'wild_frenzy',
    playerId: player.id, team: player.team,
    x: cmd.x, y: cmd.y, radius: def.aoeRadius ?? 8,
    duration: 6 * TICK_RATE,
  });
  addSound(state, 'ability_frenzy', cmd.x, cmd.y);
  addCombatEvent(state, { type: 'pulse', x: cmd.x, y: cmd.y, radius: def.aoeRadius ?? 8, color: '#ff6600' });
}

const FIREBALL_SPEED = 1.2; // tiles per tick (24 tiles/sec)

function demonAbility(state: GameState, player: PlayerState, cmd: Extract<GameCommand, { type: 'use_ability' }>): void {
  if (cmd.x == null || cmd.y == null) return;
  // Fireball — consumes ALL mana, damage scales with mana spent
  // The base cost was already deducted in useAbility; now consume the remaining mana too
  const extraMana = player.mana;
  player.mana = 0;
  const def = RACE_ABILITY_DEFS[player.race];
  const totalMana = (def.baseCost.mana ?? 50) + extraMana;
  const radius = def.aoeRadius ?? 6;
  const baseDamage = 35;
  const bonusMana = Math.max(0, totalMana - (def.baseCost.mana ?? 50));
  const totalDamage = Math.round(baseDamage + bonusMana * 0.7);

  // Find Research building as the launch point
  const research = state.buildings.find(b => b.type === BuildingType.Research && b.playerId === player.id);
  const srcX = research ? research.worldX + 0.5 : cmd.x;
  const srcY = research ? research.worldY + 0.5 : cmd.y;

  // Calculate travel time based on distance
  const dx = cmd.x - srcX, dy = cmd.y - srcY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const travelTicks = Math.max(1, Math.ceil(dist / FIREBALL_SPEED));

  // AoE telegraph ring at target — visible to all, lasts until impact
  state.abilityEffects.push({
    id: genId(state), type: 'demon_fireball_telegraph',
    playerId: player.id, team: player.team,
    x: cmd.x, y: cmd.y, radius,
    duration: travelTicks,
    data: { damage: totalDamage },
  });

  // In-flight fireball projectile
  state.abilityEffects.push({
    id: genId(state), type: 'demon_fireball_inbound',
    playerId: player.id, team: player.team,
    x: cmd.x, y: cmd.y, radius,
    duration: travelTicks + 2, // small buffer so explosion tick runs
    data: { curX: srcX, curY: srcY, damage: totalDamage, arrived: 0 },
  });

  addSound(state, 'ability_fireball', srcX, srcY);
}

export function explodeFireball(state: GameState, eff: { playerId: number; team: Team; x?: number; y?: number; radius?: number; data?: Record<string, number> }): void {
  const targetX = eff.x!, targetY = eff.y!, radius = eff.radius ?? 6;
  const totalDamage = eff.data?.damage ?? 20;
  const fbPlayer = state.players[eff.playerId];
  const fbUpgrades = fbPlayer?.researchUpgrades;
  // Demon Siege Fire: +50% building damage
  const buildingDamageReduction = fbUpgrades?.raceUpgrades['demon_ability_3'] ? 0.45 : 0.3;
  const r2 = radius * radius;

  let hitCount = 0;
  for (const u of state.units) {
    if (u.team === eff.team) continue;
    if ((u.x - targetX) ** 2 + (u.y - targetY) ** 2 > r2) continue;
    dealDamage(state, u, totalDamage, true, eff.playerId);
    hitCount++;
    const existing = u.statusEffects.find(s => s.type === StatusType.Burn);
    if (existing) { existing.stacks = Math.min(5, existing.stacks + 2); existing.duration = 3 * TICK_RATE; }
    else u.statusEffects.push({ type: StatusType.Burn, stacks: 2, duration: 3 * TICK_RATE });
  }

  for (const b of state.buildings) {
    if (b.buildGrid !== 'alley') continue;
    if (state.players[b.playerId]?.team === eff.team) continue;
    if ((b.worldX - targetX) ** 2 + (b.worldY - targetY) ** 2 > r2) continue;
    b.hp -= Math.round(totalDamage * buildingDamageReduction);
  }

  const hitSuffix = hitCount > 0 ? ` x${hitCount}` : '';
  addFloatingText(state, targetX, targetY, `FIREBALL! (${totalDamage} dmg${hitSuffix})`, '#ff4400');
  addSound(state, 'ability_fireball', targetX, targetY);
  addDeathParticles(state, targetX, targetY, '#ff4400', 12);
  addCombatEvent(state, { type: 'splash', x: targetX, y: targetY, radius, color: '#ff6600' });
  state.abilityEffects.push({
    id: genId(state), type: 'demon_fireball',
    playerId: eff.playerId, team: eff.team,
    x: targetX, y: targetY, radius,
    duration: Math.round(0.8 * TICK_RATE),
  });

  // Demon Scorched Earth: leave a burn area on the ground
  if (fbUpgrades?.raceUpgrades['demon_ability_2']) {
    state.abilityEffects.push({
      id: genId(state), type: 'demon_scorched_earth',
      playerId: eff.playerId, team: eff.team,
      x: targetX, y: targetY, radius: Math.round(radius * 0.6),
      duration: 6 * TICK_RATE,
      data: { damage: Math.max(3, Math.round(totalDamage * 0.08)) },
    });
  }
}

const SKULL_SPEED = 0.8; // tiles per tick (16 tiles/sec) — slower than fireball for dramatic effect

function geistsAbility(state: GameState, player: PlayerState, cmd: Extract<GameCommand, { type: 'use_ability' }>): void {
  if (cmd.x == null || cmd.y == null) return;
  const skeletonCount = 4 + player.abilityUseCount;
  const skeletonDuration = 15 * TICK_RATE;
  const lane = state.rng() < 0.5 ? Lane.Left : Lane.Right;
  const skelPath = getLanePath(player.team, lane, state.mapDef);
  const skelProgress = findNearestPathProgress(skelPath, cmd.x, cmd.y);

  // Launch skull projectile from HQ toward target
  const hq = getHQPosition(player.team, state.mapDef);
  const dx = cmd.x - hq.x, dy = cmd.y - hq.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const travelTicks = Math.max(1, Math.ceil(dist / SKULL_SPEED));

  // Black hole telegraph at target — visible to all
  state.abilityEffects.push({
    id: genId(state), type: 'geist_summon_telegraph',
    playerId: player.id, team: player.team,
    x: cmd.x, y: cmd.y, radius: 2,
    duration: travelTicks,
  });

  // In-flight skull projectile
  state.abilityEffects.push({
    id: genId(state), type: 'geist_summon_inbound',
    playerId: player.id, team: player.team,
    x: cmd.x, y: cmd.y, radius: 2,
    duration: travelTicks + 2,
    data: {
      curX: hq.x, curY: hq.y, arrived: 0,
      skeletonCount, skeletonDuration, laneIsLeft: lane === Lane.Left ? 1 : 0, pathProgress: skelProgress,
    },
  });

  addSound(state, 'ability_summon', hq.x, hq.y);
}

export function spawnGeistSkeletons(state: GameState, eff: AbilityEffect): void {
  if (eff.x == null || eff.y == null || eff.data == null) return;
  const player = state.players[eff.playerId];
  const { skeletonCount, skeletonDuration, laneIsLeft, pathProgress } = eff.data;
  const lane = laneIsLeft ? Lane.Left : Lane.Right;
  const circleRadius = 2;

  for (let i = 0; i < skeletonCount; i++) {
    const angle = (i / skeletonCount) * Math.PI * 2;
    const sx = eff.x + Math.cos(angle) * circleRadius;
    const sy = eff.y + Math.sin(angle) * circleRadius;
    state.units.push({
      id: genId(state), type: 'Skeleton', playerId: player.id, team: player.team,
      x: sx, y: sy,
      hp: 55, maxHp: 55, damage: 18,
      attackSpeed: 1.2, attackTimer: 0, moveSpeed: 2.8, range: 1.5,
      targetId: null, lane, pathProgress, carryingDiamond: false,
      statusEffects: [], hitCount: 0, shieldHp: 0,
      category: 'melee', upgradeTier: 0, upgradeNode: 'A',
      upgradeSpecial: { lifestealPct: 0.08 }, kills: 0, damageDone: 0, damageTaken: 0, healingDone: 0, buffsApplied: 0, lastDamagedByName: '', spawnTick: state.tick,
      summonDuration: skeletonDuration,
    });
  }
  // Geists Bone Archers: also spawn 3 skeleton archers
  if (player.researchUpgrades.raceUpgrades['geists_ability_1']) {
    for (let ai = 0; ai < 3; ai++) {
      const aAngle = (ai / 3) * Math.PI * 2 + Math.PI / 6;
      const ax = eff.x + Math.cos(aAngle) * (circleRadius + 0.5);
      const ay = eff.y + Math.sin(aAngle) * (circleRadius + 0.5);
      state.units.push({
        id: genId(state), type: 'Skeleton Archer', playerId: player.id, team: player.team,
        x: ax, y: ay,
        hp: 35, maxHp: 35, damage: 14,
        attackSpeed: 1.4, attackTimer: 0, moveSpeed: 2.5, range: 6,
        targetId: null, lane, pathProgress, carryingDiamond: false,
        statusEffects: [], hitCount: 0, shieldHp: 0,
        category: 'ranged', upgradeTier: 0, upgradeNode: 'A',
        upgradeSpecial: { lifestealPct: 0.05 }, kills: 0, damageDone: 0, damageTaken: 0, healingDone: 0, buffsApplied: 0, lastDamagedByName: '', spawnTick: state.tick,
        summonDuration: skeletonDuration,
      });
    }
  }
  addFloatingText(state, eff.x, eff.y, 'RISE!', '#ce93d8');
  addSound(state, 'ability_summon', eff.x, eff.y);
  addCombatEvent(state, { type: 'pulse', x: eff.x, y: eff.y, radius: circleRadius, color: '#ce93d8' });
}

function goblinsAbility(state: GameState, player: PlayerState, cmd: Extract<GameCommand, { type: 'use_ability' }>): void {
  // Place a potion shop in the tower alley
  const slot = (cmd.gridX != null && cmd.gridY != null) ? { gx: cmd.gridX, gy: cmd.gridY } : findOpenAlleySlot(state, player);
  if (!slot) return;
  const origin = getTeamAlleyOrigin(player.team, state.mapDef);
  const world = { x: origin.x + slot.gx, y: origin.y + slot.gy };
  state.buildings.push({
    id: genId(state), type: BuildingType.Tower, playerId: player.id, buildGrid: 'alley',
    gridX: slot.gx, gridY: slot.gy, worldX: world.x, worldY: world.y,
    lane: Lane.Left,
    hp: 100, maxHp: 100, actionTimer: 10 * TICK_RATE, placedTick: state.tick, upgradePath: [],
    isPotionShop: true,
  });
  addFloatingText(state, world.x, world.y, 'POTION SHOP', '#69f0ae');
  addSound(state, 'building_placed', world.x, world.y, { race: Race.Goblins });
}

function oozlingsAbility(state: GameState, player: PlayerState, cmd: Extract<GameCommand, { type: 'use_ability' }>): void {
  // Place a globule building in the tower alley (spawns extra oozlings)
  const slot = (cmd.gridX != null && cmd.gridY != null) ? { gx: cmd.gridX, gy: cmd.gridY } : findOpenAlleySlot(state, player);
  if (!slot) return;
  const origin = getTeamAlleyOrigin(player.team, state.mapDef);
  const world = { x: origin.x + slot.gx, y: origin.y + slot.gy };
  state.buildings.push({
    id: genId(state), type: BuildingType.Tower, playerId: player.id, buildGrid: 'alley',
    gridX: slot.gx, gridY: slot.gy, worldX: world.x, worldY: world.y,
    lane: Lane.Left,
    hp: 150, maxHp: 150, actionTimer: 0, placedTick: state.tick, upgradePath: [],
    isGlobule: true,
  });
  addFloatingText(state, world.x, world.y, 'OOZE MOUND', '#69f0ae');
  addSound(state, 'building_placed', world.x, world.y, { race: Race.Oozlings });
}

export const SEED_GROW_TIMES = [18 * TICK_RATE, 36 * TICK_RATE, 72 * TICK_RATE]; // T1=18s, T2=36s, T3=72s

function tendersAbility(state: GameState, player: PlayerState, cmd: Extract<GameCommand, { type: 'use_ability' }>): void {
  const slot = (cmd.gridX != null && cmd.gridY != null) ? { gx: cmd.gridX, gy: cmd.gridY } : findOpenAlleySlot(state, player);
  if (!slot) return;

  // Check for existing seed to upgrade
  const existing = state.buildings.find(b =>
    b.isSeed && b.buildGrid === 'alley' && b.gridX === slot.gx && b.gridY === slot.gy &&
    (state.players[b.playerId]?.team ?? -1) === player.team
  );

  if (existing) {
    // Upgrade existing seed to next tier, preserving elapsed time
    const oldTier = existing.seedTier ?? 0;
    const newTier = oldTier + 1;
    if (newTier > 2) return; // already T3
    const elapsed = SEED_GROW_TIMES[oldTier] - (existing.seedTimer ?? 0);
    existing.seedTier = newTier;
    existing.seedTimer = Math.max(0, SEED_GROW_TIMES[newTier] - elapsed);
    const tierLabel = ['T2', 'T3'][newTier - 1];
    addFloatingText(state, existing.worldX, existing.worldY, `SEED → ${tierLabel}`, '#ffd740');
    addSound(state, 'building_placed', existing.worldX, existing.worldY, { race: Race.Tenders });
  } else {
    // Plant a new T1 seed
    const origin = getTeamAlleyOrigin(player.team, state.mapDef);
    const world = { x: origin.x + slot.gx, y: origin.y + slot.gy };
    const growTime = SEED_GROW_TIMES[0];
    state.buildings.push({
      id: genId(state), type: BuildingType.Tower, playerId: player.id, buildGrid: 'alley',
      gridX: slot.gx, gridY: slot.gy, worldX: world.x, worldY: world.y,
      lane: Lane.Left,
      hp: 50, maxHp: 50, actionTimer: growTime, placedTick: state.tick, upgradePath: [],
      isSeed: true, seedTimer: growTime, seedTier: 0,
    });
    addFloatingText(state, world.x, world.y, 'SEED PLANTED', '#81c784');
    addSound(state, 'building_placed', world.x, world.y, { race: Race.Tenders });
  }
}

export function tickAbilityEffects(state: GameState): void {
  // Tick cooldowns + Tenders seed stack accumulation
  for (const p of state.players) {
    if (p.isEmpty) continue;
    if (p.race === Race.Tenders) {
      // Stack-based: accumulate seeds on cooldown (max 10)
      if (p.abilityStacks < 10) {
        if (p.abilityCooldown > 0) {
          p.abilityCooldown--;
        } else {
          // Grant a stack and reset cooldown
          p.abilityStacks++;
          let seedCd = RACE_ABILITY_DEFS[Race.Tenders].baseCooldownTicks;
          // Tenders Quick Seeds: -40% cooldown
          if (p.researchUpgrades.raceUpgrades['tenders_ability_2']) seedCd = Math.round(seedCd * 0.7);
          p.abilityCooldown = seedCd;
        }
      }
    } else {
      if (p.abilityCooldown > 0) p.abilityCooldown--;
    }
  }

  // Clear aura bonuses each tick (recalculated below)
  for (const u of state.units) {
    if (u.hp <= 0) continue;
    u.upgradeSpecial._auraDmg = 0;
    u.upgradeSpecial._auraSpd = 0;
    u.upgradeSpecial._auraArmor = 0;
    u.upgradeSpecial._auraAtkSpd = 0;
    u.upgradeSpecial._auraHeal = 0;
    u.upgradeSpecial._auraDodge = 0;
  }

  // Tick summon durations (temporary units like Geist skeletons)
  for (const u of state.units) {
    if (u.summonDuration != null) {
      u.summonDuration--;
      if (u.summonDuration <= 0) {
        u.hp = 0; // kill the summon
        addDeathParticles(state, u.x, u.y, '#ce93d8', 3);
      }
    }
    // Horde auras: apply buffs to nearby allies (within 5 tiles)
    // Same aura type doesn't stack — uses Math.max so only the strongest applies
    // Different aura types DO combine (damage + speed + armor from different units)
    const sp = u.upgradeSpecial;
    if (u.hp > 0 && (sp?.auraDamageBonus || sp?.auraSpeedBonus || sp?.auraArmorBonus ||
        sp?.auraAttackSpeedBonus || sp?.auraHealPerSec || sp?.auraDodgeBonus)) {
      // Horde: Wide Aura — double aura range
      const auraOwner = state.players[u.playerId];
      const auraRange = (auraOwner?.researchUpgrades.raceUpgrades['horde_ability_3']) ? 10 : 5;
      const ar2 = auraRange * auraRange;
      const auraNearby = _combatGrid.getNearby(u.x, u.y, auraRange);
      for (const ally of auraNearby) {
        if (ally.id === u.id || ally.team !== u.team || ally.hp <= 0) continue;
        if ((ally.x - u.x) ** 2 + (ally.y - u.y) ** 2 > ar2) continue;
        ally.upgradeSpecial._auraDmg = Math.max(ally.upgradeSpecial._auraDmg ?? 0, sp.auraDamageBonus ?? 0);
        ally.upgradeSpecial._auraSpd = Math.max(ally.upgradeSpecial._auraSpd ?? 0, sp.auraSpeedBonus ?? 0);
        ally.upgradeSpecial._auraArmor = Math.max(ally.upgradeSpecial._auraArmor ?? 0, sp.auraArmorBonus ?? 0);
        ally.upgradeSpecial._auraAtkSpd = Math.max(ally.upgradeSpecial._auraAtkSpd ?? 0, sp.auraAttackSpeedBonus ?? 0);
        ally.upgradeSpecial._auraHeal = Math.max(ally.upgradeSpecial._auraHeal ?? 0, sp.auraHealPerSec ?? 0);
        ally.upgradeSpecial._auraDodge = Math.max(ally.upgradeSpecial._auraDodge ?? 0, sp.auraDodgeBonus ?? 0);
      }
    }
  }

  // Horde aura healing: heal units with _auraHeal > 0 once per second
  if (state.tick % TICK_RATE === 0) {
    for (const u of state.units) {
      if (u.hp <= 0 || u.hp >= u.maxHp) continue;
      const auraHeal = u.upgradeSpecial?._auraHeal ?? 0;
      if (auraHeal > 0) {
        const ah = healUnit(u, auraHeal);
        if (ah > 0) trackHealing(state, u, ah);
      }
    }
  }

  // Tick special buildings (foundries, potion shops, seeds)
  if (state.tick % TICK_RATE === 0) {
    for (const b of state.buildings) {
      if (b.hp <= 0) continue;

      // Crown foundry: +1 gold per second per foundry
      if (b.isFoundry) {
        const owner = state.players[b.playerId];
        if (owner && !owner.isEmpty) {
          owner.gold += 1;
          if (state.playerStats[b.playerId]) state.playerStats[b.playerId].totalGoldEarned += 1;
        }
      }

      // Tenders passive hut: cycle through gold → wood → meat, +1 each on a timer
      if (b.type === BuildingType.HarvesterHut) {
        const owner = state.players[b.playerId];
        if (owner && !owner.isEmpty && owner.race === Race.Tenders) {
          // Deliver resources every 3 seconds, cycling gold → wood → meat
          // Each delivery gives +3 of one resource type, then rotates
          // Rate: ~1/sec of each type across the cycle (comparable to a harvester)
          const deliveryInterval = 3 * TICK_RATE;
          const elapsed = state.tick - b.placedTick;
          if (elapsed > 0 && elapsed % deliveryInterval === 0) {
            const deliveryNum = Math.floor(elapsed / deliveryInterval);
            const cycle = deliveryNum % 3;
            const amt = 3;
            if (cycle === 0) {
              owner.gold += amt;
              if (state.playerStats[b.playerId]) state.playerStats[b.playerId].totalGoldEarned += amt;
              addFloatingText(state, b.worldX, b.worldY - 0.3, `+${amt}`, '#ffd700', 'gold');
            } else if (cycle === 1) {
              owner.wood += amt;
              if (state.playerStats[b.playerId]) state.playerStats[b.playerId].totalWoodEarned += amt;
              addFloatingText(state, b.worldX, b.worldY - 0.3, `+${amt}`, '#4caf50', 'wood');
            } else {
              owner.meat += amt;
              if (state.playerStats[b.playerId]) state.playerStats[b.playerId].totalMeatEarned += amt;
              addFloatingText(state, b.worldX, b.worldY - 0.3, `+${amt}`, '#e57373', 'meat');
            }
          }
        }
      }

      // Goblin potion shop: periodically toss a random potion onto a nearby empty tile
      if (b.isPotionShop) {
        b.actionTimer = (b.actionTimer ?? 0) - TICK_RATE;
        if (b.actionTimer <= 0) {
          const potionOwner = state.players[b.playerId];
          const quickBrew = potionOwner?.researchUpgrades.raceUpgrades['goblins_ability_1'];
          b.actionTimer = quickBrew ? 6 * TICK_RATE : 8 * TICK_RATE; // Quick Brew: 33% faster
          const owner = state.players[b.playerId];
          if (owner && !owner.isEmpty) {
            // Pick random tile within 3-6 tiles of the shop
            const angle = state.rng() * Math.PI * 2;
            const dist = 3 + state.rng() * 3;
            const dropX = b.worldX + Math.cos(angle) * dist;
            const dropY = b.worldY + Math.sin(angle) * dist;
            // Pick random potion type
            const roll = state.rng();
            const potionType: PotionType = roll < 0.33 ? 'speed' : roll < 0.66 ? 'rage' : 'shield';
            const flightDist = Math.hypot(dropX - b.worldX, dropY - b.worldY);
            const flightTicks = Math.round(Math.max(8, flightDist * 2.5)); // ~0.4-0.75s arc
            state.potionDrops.push({
              id: genId(state),
              x: dropX, y: dropY,
              srcX: b.worldX + 0.5, srcY: b.worldY,
              type: potionType,
              team: owner.team,
              flightTicks,
              flightProgress: 0,
              remainingTicks: 30 * TICK_RATE, // despawn after 30 seconds
            });
          }
        }
      }

      // Oozlings globule: periodically spawn an extra oozling
      if (b.isGlobule) {
        b.actionTimer = (b.actionTimer ?? 0) + TICK_RATE;
        if (b.actionTimer >= 12 * TICK_RATE) { // every 12 seconds
          b.actionTimer = 0;
          const owner = state.players[b.playerId];
          if (owner && !owner.isEmpty) {
            // Determine spawn type based on upgrades
            const gbu = owner.researchUpgrades;
            let spawnType: BuildingType = BuildingType.MeleeSpawner;
            let spawnCat: 'melee' | 'ranged' | 'caster' = 'melee';
            const roll = state.rng();
            if (gbu.raceUpgrades['oozlings_ability_1'] && gbu.raceUpgrades['oozlings_ability_2']) {
              // Both: 25% ranged, 25% caster, 50% melee
              if (roll < 0.25) { spawnType = BuildingType.RangedSpawner; spawnCat = 'ranged'; }
              else if (roll < 0.50) { spawnType = BuildingType.CasterSpawner; spawnCat = 'caster'; }
            } else if (gbu.raceUpgrades['oozlings_ability_1']) {
              if (roll < 0.25) { spawnType = BuildingType.RangedSpawner; spawnCat = 'ranged'; }
            } else if (gbu.raceUpgrades['oozlings_ability_2']) {
              if (roll < 0.25) { spawnType = BuildingType.CasterSpawner; spawnCat = 'caster'; }
            }
            const stats = UNIT_STATS[owner.race]?.[spawnType];
            if (stats) {
              for (let si = 0; si < 2; si++) {
                const lane = si === 0 ? Lane.Left : Lane.Right;
                const gPath = getLanePath(owner.team, lane, state.mapDef);
                const gProg = findNearestPathProgress(gPath, b.worldX, b.worldY);
                state.units.push({
                  id: genId(state), type: stats.name, playerId: b.playerId, team: owner.team,
                  x: b.worldX + (si * 0.3), y: b.worldY,
                  hp: stats.hp, maxHp: stats.hp, damage: stats.damage,
                  attackSpeed: stats.attackSpeed, attackTimer: 0, moveSpeed: stats.moveSpeed, range: stats.range,
                  targetId: null, lane, pathProgress: gProg, carryingDiamond: false,
                  statusEffects: [], hitCount: 0, shieldHp: 0, category: spawnCat,
                  upgradeTier: 0, upgradeNode: 'A', upgradeSpecial: {},
                  kills: 0, damageDone: 0, damageTaken: 0, healingDone: 0, buffsApplied: 0, lastDamagedByName: '', spawnTick: state.tick,
                });
              }
              addSound(state, 'unit_spawn', b.worldX, b.worldY);
            }
          }
        }
      }

      // Tenders seed: count down and spawn a random unit when ready
      if (b.isSeed && b.seedTimer != null) {
        // Tenders Fast Growth: seeds grow 40% faster (bonus tick 2 out of every 5 ticks)
        const seedOwner = state.players[b.playerId];
        b.seedTimer--;
        if (seedOwner?.researchUpgrades.raceUpgrades['tenders_ability_1'] && state.tick % 5 < 2) {
          b.seedTimer--;
        }
        if (b.seedTimer <= 0) {
          const owner = seedOwner;
          if (owner && !owner.isEmpty) {
            // Pop into a random unit from any race
            const allRaces = [Race.Crown, Race.Horde, Race.Goblins, Race.Oozlings, Race.Demon, Race.Deep, Race.Wild, Race.Geists, Race.Tenders];
            const categories: ('melee' | 'ranged' | 'caster')[] = ['melee', 'ranged', 'caster'];
            const cat = categories[Math.floor(state.rng() * categories.length)];
            const seedRace = allRaces[Math.floor(state.rng() * allRaces.length)];
            const btMap: Record<string, BuildingType> = { melee: BuildingType.MeleeSpawner, ranged: BuildingType.RangedSpawner, caster: BuildingType.CasterSpawner };
            const stats = UNIT_STATS[seedRace]?.[btMap[cat]];
            if (stats) {
              const tier = b.seedTier ?? 0;
              // Stat multiplier per tier: T1=1x, T2=1.5x, T3=2.2x
              const tierMult = [1, 1.5, 2.2][tier];
              const lane = state.rng() < 0.5 ? Lane.Left : Lane.Right;
              const seedPath = getLanePath(owner.team, lane, state.mapDef);
              const seedProg = findNearestPathProgress(seedPath, b.worldX, b.worldY);
              state.units.push({
                id: genId(state), type: stats.name, playerId: b.playerId, team: owner.team,
                x: b.worldX, y: b.worldY,
                hp: Math.max(1, Math.round(stats.hp * tierMult)),
                maxHp: Math.max(1, Math.round(stats.hp * tierMult)),
                damage: Math.max(1, Math.round(stats.damage * tierMult)),
                attackSpeed: stats.attackSpeed, attackTimer: 0, moveSpeed: stats.moveSpeed, range: stats.range,
                targetId: null, lane, pathProgress: seedProg, carryingDiamond: false,
                statusEffects: [], hitCount: 0, shieldHp: 0, category: cat,
                upgradeTier: tier, upgradeNode: 'A', upgradeSpecial: {},
                kills: 0, damageDone: 0, damageTaken: 0, healingDone: 0, buffsApplied: 0, lastDamagedByName: '', spawnTick: state.tick,
              });
              const tierLabel = tier > 0 ? ` T${tier + 1}` : '';
              addFloatingText(state, b.worldX, b.worldY, `${stats.name}${tierLabel}!`, '#81c784');
              addSound(state, 'unit_spawn', b.worldX, b.worldY);
            }
            // Tenders Reseed: 30% chance to replant a T1 seed when one pops
            if (owner.researchUpgrades.raceUpgrades['tenders_ability_3'] && state.rng() < 0.3) {
              b.seedTimer = SEED_GROW_TIMES[0];
              b.seedTier = 0;
              b.hp = 50;
              b.maxHp = 50;
              addFloatingText(state, b.worldX, b.worldY, 'RESEED!', '#a5d6a7');
            } else {
              // Remove the seed building
              b.hp = 0;
            }
          } else {
            b.hp = 0;
          }
        }
      }
    }
  }

  // Tick active effects
  for (let i = state.abilityEffects.length - 1; i >= 0; i--) {
    const eff = state.abilityEffects[i];
    eff.duration--;

    // Per-tick effect logic
    if (eff.type === 'deep_rain') {
      const deepPlayer = state.players[eff.playerId];
      const deepBu = deepPlayer?.researchUpgrades;
      const crushingRain = deepBu?.raceUpgrades['deep_ability_1'];
      const healingRain = deepBu?.raceUpgrades['deep_ability_2'];
      const isSecondTick = state.tick % TICK_RATE === 0; // once per second for damage/heal
      for (const u of state.units) {
        if (u.hp <= 0) continue;
        const unitRace = state.players[u.playerId]?.race;
        if (u.team === eff.team && unitRace === Race.Deep) {
          // Deep allies: Haste (move faster)
          const haste = u.statusEffects.find(s => s.type === StatusType.Haste);
          if (haste) { haste.duration = Math.max(haste.duration, TICK_RATE); }
          else u.statusEffects.push({ type: StatusType.Haste, stacks: 1, duration: TICK_RATE });
          // Healing Rain: heal Deep allies 5 HP/sec
          if (healingRain && isSecondTick) {
            const healed = healUnit(u, 5);
            if (healed > 0) trackHealing(state, u, healed);
          }
          // Purifying Deluge: cleanse all debuffs from Deep allies every 2s
          if (deepBu?.raceUpgrades['deep_ability_4'] && state.tick % (2 * TICK_RATE) === 0) {
            const hadDebuff = u.statusEffects.some(s =>
              s.type !== StatusType.Haste && s.type !== StatusType.Shield && s.type !== StatusType.Frenzy);
            compactInPlace(u.statusEffects, s =>
              s.type === StatusType.Haste || s.type === StatusType.Shield || s.type === StatusType.Frenzy);
            if (hadDebuff) {
              addFloatingText(state, u.x, u.y - 0.3, '', '#4fc3f7', undefined, undefined,
                { ftType: 'status', miniIcon: 'cleanse' });
              addDeathParticles(state, u.x, u.y, '#4fc3f7', 2);
            }
          }
        } else if (unitRace !== Race.Deep) {
          // Non-Deep units: Slow (move slower)
          const slow = u.statusEffects.find(s => s.type === StatusType.Slow);
          if (slow) { slow.duration = Math.max(slow.duration, TICK_RATE); }
          else u.statusEffects.push({ type: StatusType.Slow, stacks: 1, duration: TICK_RATE });
          // Crushing Rain: deal 3 dmg/sec to enemies
          if (crushingRain && isSecondTick && u.team !== eff.team) {
            dealDamage(state, u, 3, false, eff.playerId);
          }
        }
      }
    } else if (eff.type === 'demon_fireball_inbound' && eff.x != null && eff.y != null && eff.data != null) {
      if (eff.data.arrived === 0) {
        const curX = eff.data.curX, curY = eff.data.curY;
        const dx = eff.x - curX, dy = eff.y - curY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= FIREBALL_SPEED) {
          // Arrived — trigger explosion
          eff.data.arrived = 1;
          explodeFireball(state, eff);
          eff.duration = 0;
        } else {
          // Advance toward target
          const f = FIREBALL_SPEED / dist;
          eff.data.curX = curX + dx * f;
          eff.data.curY = curY + dy * f;
        }
      }
    } else if (eff.type === 'geist_summon_inbound' && eff.x != null && eff.y != null && eff.data != null) {
      if (eff.data.arrived === 0) {
        const curX = eff.data.curX, curY = eff.data.curY;
        const dx = eff.x - curX, dy = eff.y - curY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= SKULL_SPEED) {
          eff.data.arrived = 1;
          spawnGeistSkeletons(state, eff);
          eff.duration = 0;
        } else {
          const f = SKULL_SPEED / dist;
          eff.data.curX = curX + dx * f;
          eff.data.curY = curY + dy * f;
        }
      }
    } else if (eff.type === 'wild_frenzy') {
      // Apply haste + frenzy (damage buff) to allies in radius
      if (eff.x != null && eff.y != null && eff.radius != null) {
        const r2 = eff.radius * eff.radius;
        const frenzyNearby = _combatGrid.getNearby(eff.x, eff.y, eff.radius);
        for (const u of frenzyNearby) {
          if (u.team !== eff.team) continue;
          if ((u.x - eff.x) ** 2 + (u.y - eff.y) ** 2 > r2) continue;
          // Haste
          const haste = u.statusEffects.find(s => s.type === StatusType.Haste);
          if (haste) { haste.duration = Math.max(haste.duration, TICK_RATE); }
          else u.statusEffects.push({ type: StatusType.Haste, stacks: 1, duration: TICK_RATE });
          // Frenzy (+50% damage)
          const frenzy = u.statusEffects.find(s => s.type === StatusType.Frenzy);
          if (frenzy) { frenzy.duration = Math.max(frenzy.duration, TICK_RATE); }
          else u.statusEffects.push({ type: StatusType.Frenzy, stacks: 1, duration: TICK_RATE });
        }
      }
    } else if (eff.type === 'demon_scorched_earth') {
      // Burn ground: deal damage every second to enemies in area
      if (eff.x != null && eff.y != null && eff.radius != null && state.tick % TICK_RATE === 0) {
        const seR2 = (eff.radius ?? 3) * (eff.radius ?? 3);
        const seDmg = eff.data?.damage ?? 3;
        const scorchNearby = _combatGrid.getNearby(eff.x, eff.y, eff.radius);
        for (const u of scorchNearby) {
          if (u.team === eff.team || u.hp <= 0) continue;
          if ((u.x - eff.x) ** 2 + (u.y - eff.y) ** 2 > seR2) continue;
          dealDamage(state, u, seDmg, false, eff.playerId);
          const burn = u.statusEffects.find(s => s.type === StatusType.Burn);
          if (burn) { burn.duration = Math.max(burn.duration, TICK_RATE); }
          else u.statusEffects.push({ type: StatusType.Burn, stacks: 1, duration: TICK_RATE });
        }
      }
    }

    if (eff.duration <= 0) {
      state.abilityEffects.splice(i, 1);
    }
  }
}

// === Death resource tracking (called from combat cleanup) ===

export function trackDeathResources(state: GameState, deadUnit: UnitState): void {
  // Geists: souls from ANY death, with probability scaling for higher player counts.
  // In 1v1 (2 players): 100% chance per death. In 4v4 (8 players): ~38% chance per death.
  // Net effect: soul income scales ~1.5x from 1v1 to 4v4 instead of 4x.
  const activePlayers = state.players.reduce((c, pl) => c + (pl.isEmpty ? 0 : 1), 0);
  const soulChance = activePlayers <= 2 ? 1 : 2 * (1 + (activePlayers - 2) / 12) / activePlayers;
  for (const p of state.players) {
    if (p.isEmpty || p.race !== Race.Geists) continue;
    if (soulChance < 1 && state.rng() >= soulChance) continue;
    p.souls++;
    // Show floating text at death location (throttle: only every 3rd soul to reduce spam)
    if (p.souls % 3 === 0) {
      addFloatingText(state, deadUnit.x, deadUnit.y - 0.5, '+3', '#ce93d8', 'souls', undefined, { ownerOnly: p.id });
    }
  }

  // Oozlings: death essence from own oozling deaths
  const owner = state.players[deadUnit.playerId];
  if (owner && owner.race === Race.Oozlings) {
    owner.deathEssence++;
    addFloatingText(state, deadUnit.x, deadUnit.y - 0.5, '+1', '#69f0ae', 'ooze', undefined, { ownerOnly: deadUnit.playerId });
  }

  // Geists caster: chance to summon mini-skeleton from nearby deaths
  const summonRange = 8;
  const deathNearby = _combatGrid.getNearby(deadUnit.x, deadUnit.y, summonRange);
  for (const caster of deathNearby) {
    if (caster.hp <= 0 || caster.category !== 'caster') continue;
    if (state.players[caster.playerId]?.race !== Race.Geists) continue;
    let chance = caster.upgradeSpecial?.skeletonSummonChance ?? 0;
    // Research: Undying Will — +15% skeleton summon chance
    const geistsResearch = state.players[caster.playerId]?.researchUpgrades;
    if (geistsResearch?.raceUpgrades['geists_caster_2']) chance += 0.15;
    if (chance <= 0) continue;
    const dx = deadUnit.x - caster.x, dy = deadUnit.y - caster.y;
    if (dx * dx + dy * dy > summonRange * summonRange) continue;
    { // Always consume 2 RNG values to keep sequence stable
      const summonRoll = state.rng(), laneRoll = state.rng();
    if (summonRoll < chance) {
      const lane = laneRoll < 0.5 ? Lane.Left : Lane.Right;
      const msPath = getLanePath(caster.team, lane, state.mapDef);
      const msProg = findNearestPathProgress(msPath, deadUnit.x, deadUnit.y);
      // Geists Empowered Minions: +5 damage, +25% move speed
      const empowered = geistsResearch?.raceUpgrades['geists_ability_2'];
      const miniDmg = empowered ? 13 : 8;
      const miniSpd = empowered ? 4.0 : 3.2;
      state.units.push({
        id: genId(state), type: 'Mini Skeleton', playerId: caster.playerId, team: caster.team,
        x: deadUnit.x, y: deadUnit.y,
        hp: 15, maxHp: 15, damage: miniDmg,
        attackSpeed: 1.0, attackTimer: 0, moveSpeed: miniSpd, range: 1.5,
        targetId: null, lane, pathProgress: msProg, carryingDiamond: false,
        statusEffects: [], hitCount: 0, shieldHp: 0,
        category: 'melee', upgradeTier: 0, upgradeNode: 'A',
        upgradeSpecial: {}, kills: 0, damageDone: 0, damageTaken: 0, healingDone: 0, buffsApplied: 0, lastDamagedByName: '', spawnTick: state.tick,
        summonDuration: 10 * TICK_RATE,
      });
      addDeathParticles(state, deadUnit.x, deadUnit.y, '#b39ddb', 2);
    }
    } // end RNG pre-consumption block
  }

  // Geist Soul Gorger: gain soul stacks from any nearby death (friend or foe)
  const gorgerNearby = _combatGrid.getNearby(deadUnit.x, deadUnit.y, 8);
  for (const gorger of gorgerNearby) {
    if (gorger.hp <= 0 || gorger.id === deadUnit.id) continue;
    if (!gorger.upgradeSpecial?.soulHarvest) continue;
    const maxStacks = gorger.upgradeSpecial.soulMaxStacks ?? 20;
    const stacks = gorger.soulStacks ?? 0;
    if (stacks >= maxStacks) continue;
    const harvestR = gorger.upgradeSpecial.soulHarvestRadius ?? 8;
    const dx = deadUnit.x - gorger.x, dy = deadUnit.y - gorger.y;
    if (dx * dx + dy * dy > harvestR * harvestR) continue;
    gorger.soulStacks = stacks + 1;
    // Store original base stats on first stack (avoids rounding drift)
    if (stacks === 0) {
      gorger.upgradeSpecial = { ...gorger.upgradeSpecial, _baseDmg: gorger.damage, _baseMaxHp: gorger.maxHp };
    }
    // +4% damage and +4% maxHP per stack, computed from original base
    const baseDmg = gorger.upgradeSpecial._baseDmg ?? gorger.damage;
    gorger.damage = Math.round(baseDmg * (1 + 0.04 * (stacks + 1)));
    const baseMaxHp = gorger.upgradeSpecial._baseMaxHp ?? gorger.maxHp;
    const newMaxHp = Math.round(baseMaxHp * (1 + 0.04 * (stacks + 1)));
    const hpGain = newMaxHp - gorger.maxHp;
    gorger.maxHp = newMaxHp;
    gorger.hp = Math.min(gorger.maxHp, gorger.hp + hpGain); // heal the gained HP
    addFloatingText(state, gorger.x, gorger.y - 0.5, `Soul ${stacks + 1}`, '#ce93d8', undefined, undefined,
      { ftType: 'status' });
    addDeathParticles(state, gorger.x, gorger.y, '#ce93d8', 2);
  }

  // Legacy explode-on-death handler (unused — Boomlings now use suicideAttack in melee path)
  if (deadUnit.upgradeSpecial?.explodeOnDeath) {
    const dmg = deadUnit.upgradeSpecial.explodeDamage ?? 30;
    const radius = deadUnit.upgradeSpecial.explodeRadius ?? 3;
    const r2 = radius * radius;
    const burnStacks = deadUnit.upgradeSpecial.extraBurnStacks ?? 0;
    const explodeNearby = _combatGrid.getNearby(deadUnit.x, deadUnit.y, radius);
    for (const u of explodeNearby) {
      if (u.team === deadUnit.team || u.hp <= 0) continue;
      if ((u.x - deadUnit.x) ** 2 + (u.y - deadUnit.y) ** 2 > r2) continue;
      dealDamage(state, u, dmg, true, deadUnit.playerId);
      if (burnStacks > 0) applyStatus(u, StatusType.Burn, burnStacks);
    }
    addDeathParticles(state, deadUnit.x, deadUnit.y, '#7c4dff', 8);
    addFloatingText(state, deadUnit.x, deadUnit.y, `${dmg}`, '#7c4dff', undefined, undefined,
      { ftType: 'damage', magnitude: dmg, miniIcon: 'fire' });
    addSound(state, 'nuke_detonated', deadUnit.x, deadUnit.y);
  }
}

const NUKE_TEAM_COOLDOWN_TICKS = 11 * TICK_RATE; // 11s team-wide cooldown between nukes (10% slower)

export function fireNuke(state: GameState, cmd: Extract<GameCommand, { type: 'fire_nuke' }>): void {
  const player = state.players[cmd.playerId];
  if (!player.nukeAvailable) return;

  // 60-second match lockout — nukes disabled for the first minute
  if (state.tick < 60 * TICK_RATE) return;

  // Team-wide nuke cooldown — prevent stacking
  const team = player.team;
  if (state.nukeTeamCooldown[team] > 0) return;

  // Nukes can only land within your team's allowed nuke zone (own 40% of map)
  const nukeZone = state.mapDef.nukeZone[team];
  const nukeAxis = state.mapDef.shapeAxis === 'x' ? cmd.x : cmd.y;
  if (nukeAxis < nukeZone.min || nukeAxis > nukeZone.max) return;

  player.nukeAvailable = false;
  state.nukeTeamCooldown[team] = NUKE_TEAM_COOLDOWN_TICKS;

  // 1.25 second telegraph before detonation.
  // Radius intentionally set to 16 for large-teamfight impact.
  state.nukeTelegraphs.push({
    x: cmd.x, y: cmd.y,
    radius: NUKE_RADIUS,
    playerId: cmd.playerId,
    timer: Math.round(1.25 * TICK_RATE),
  });
  addSound(state, 'nuke_incoming', cmd.x, cmd.y);
}

export function addPing(state: GameState, cmd: Extract<GameCommand, { type: 'ping' }>): void {
  const player = state.players[cmd.playerId];
  if (!player) return;
  state.pings.push({
    id: genId(state),
    playerId: cmd.playerId,
    team: player.team,
    x: cmd.x,
    y: cmd.y,
    age: 0,
    maxAge: 3 * TICK_RATE,
  });
}

export function addQuickChat(state: GameState, cmd: Extract<GameCommand, { type: 'quick_chat' }>): void {
  const player = state.players[cmd.playerId];
  if (!player) return;
  const text = cmd.message.trim();
  if (!text) return;
  state.quickChats.push({
    id: genId(state),
    playerId: cmd.playerId,
    team: player.team,
    message: text.slice(0, 36),
    age: 0,
    maxAge: 4 * TICK_RATE,
  });
  if (state.quickChats.length > 6) state.quickChats.shift();
}

export function concedeMatch(state: GameState, cmd: Extract<GameCommand, { type: 'concede' }>): void {
  if (state.matchPhase === 'ended') return;
  const player = state.players[cmd.playerId];
  if (!player) return;
  const enemyTeam = player.team === Team.Bottom ? Team.Top : Team.Bottom;
  state.winner = enemyTeam;
  state.winCondition = 'concede';
  state.matchPhase = 'ended';
  const humanPlayer = state.players.find(p => !p.isBot);
  const humanTeam = humanPlayer?.team ?? Team.Bottom;
  addSound(state, humanTeam === enemyTeam ? 'match_end_win' : 'match_end_lose');
}

export function dropDiamond(state: GameState, x: number, y: number): void {
  state.diamond.state = 'dropped';
  state.diamond.x = x;
  state.diamond.y = y;
  state.diamond.carrierId = null;
  state.diamond.carrierType = null;
}

export function resetDiamondForRespawn(state: GameState): void {
  state.diamond.state = 'respawning';
  state.diamond.x = state.mapDef.diamondCenter.x;
  state.diamond.y = state.mapDef.diamondCenter.y;
  state.diamond.carrierId = null;
  state.diamond.carrierType = null;
  state.diamond.mineProgress = 0;
  state.diamond.respawnTimer = DIAMOND_RESPAWN_TICKS;
  state.diamond.deliveries++;
}

// Race-specific champion sprite: category + upgradeNode to look up the right sprite
const CHAMPION_SPRITE: Record<Race, { category: UnitState['category']; node: string }> = {
  [Race.Crown]:    { category: 'melee',  node: 'G' },  // Champion (King Human)
  [Race.Horde]:    { category: 'melee',  node: 'A' },  // Brute (base melee)
  [Race.Goblins]:  { category: 'melee',  node: 'E' },  // Troll Warlord
  [Race.Oozlings]: { category: 'caster', node: 'A' },  // Bloater (base caster)
  [Race.Demon]:    { category: 'caster', node: 'A' },  // Overlord (base caster)
  [Race.Deep]:     { category: 'melee',  node: 'A' },  // Shell Guard (base melee)
  [Race.Wild]:     { category: 'melee',  node: 'D' },  // Minotaur
  [Race.Geists]:   { category: 'melee',  node: 'D' },  // Death Knight (base melee at D)
  [Race.Tenders]:  { category: 'melee',  node: 'D' },  // Elder Ent
};

export function spawnDiamondChampion(state: GameState, team: Team, x: number, y: number, playerId: number): void {
  const scale = 1 + CHAMPION_SCALE_PER_DELIVERY * state.diamond.deliveries;
  const hp = Math.round(CHAMPION_BASE_HP * scale);
  const dmg = Math.round(CHAMPION_BASE_DAMAGE * scale);
  const lane = state.rng() < 0.5 ? Lane.Left : Lane.Right;
  const race = state.players[playerId].race;
  const champ = CHAMPION_SPRITE[race];
  state.units.push({
    id: genId(state),
    type: 'Diamond Champion',
    playerId,
    team,
    x, y,
    hp, maxHp: hp,
    damage: dmg,
    attackSpeed: CHAMPION_ATTACK_SPEED,
    attackTimer: 0,
    moveSpeed: CHAMPION_MOVE_SPEED,
    range: CHAMPION_RANGE,
    targetId: null,
    lane,
    pathProgress: -1,
    carryingDiamond: false,
    statusEffects: [],
    hitCount: 0,
    shieldHp: 0,
    category: champ.category,
    upgradeTier: 0,
    upgradeNode: champ.node,
    upgradeSpecial: {},
    kills: 0, damageDone: 0, damageTaken: 0, healingDone: 0, buffsApplied: 0,
    lastDamagedByName: '',
    spawnTick: state.tick,
    nukeImmune: true,
    isChampion: true,
  });
  addSound(state, 'diamond_carried', x, y);
  addFloatingText(state, x, y, 'CHAMPION!', '#00ffff');
}

export function dropWoodPile(state: GameState, x: number, y: number, amount: number, angleSeed = 0): void {
  if (amount <= 0) return;
  const angle = (angleSeed * 1.61803398875 + state.tick * 0.11) % (Math.PI * 2);
  const ring = 1.2 + ((angleSeed * 0.73) % 1) * WOOD_PILE_SPREAD_RADIUS;
  const pile = {
    id: genId(state),
    x: x + Math.cos(angle) * ring,
    y: y + Math.sin(angle) * ring * 0.65,
    amount,
  };
  clampToArenaBounds(pile, 0.35, state.mapDef);
  state.woodPiles.push(pile);
}

// Scratch buffer for collectWoodPiles — avoids per-call allocations
const _woodScratch: { pile: WoodPileState; index: number; dist: number }[] = [];
export function collectWoodPiles(state: GameState, x: number, y: number, desiredAmount: number): number {
  if (desiredAmount <= 0) return 0;
  _woodScratch.length = 0;
  for (let i = 0; i < state.woodPiles.length; i++) {
    const pile = state.woodPiles[i];
    const dist = Math.hypot(pile.x - x, pile.y - y);
    if (dist <= WOOD_PICKUP_RADIUS) _woodScratch.push({ pile, index: i, dist });
  }
  _woodScratch.sort((a, b) => a.dist - b.dist || a.pile.id - b.pile.id);
  const nearby = _woodScratch;

  let gathered = 0;
  const remove = new Set();
  for (const entry of nearby) {
    if (gathered >= desiredAmount) break;
    const take = Math.min(entry.pile.amount, desiredAmount - gathered);
    gathered += take;
    entry.pile.amount -= take;
    if (entry.pile.amount <= 0) remove.add(entry.index);
  }

  if (remove.size > 0) {
    state.woodPiles = state.woodPiles.filter((_, index) => !remove.has(index));
  }
  return gathered;
}

export function spillCarriedWood(state: GameState, h: HarvesterState): void {
  const looseWood = (h.carryingResource === ResourceType.Wood ? h.carryAmount : 0) + h.queuedWoodAmount;
  if (looseWood > 0) {
    dropWoodPile(state, h.x, h.y, looseWood, h.id + looseWood);
  }
  if (h.carryingResource === ResourceType.Wood) {
    h.carryingResource = null;
    h.carryAmount = 0;
  }
  h.queuedWoodAmount = 0;
  h.woodCarryTarget = 0;
  h.woodDropsCreated = 0;
}

export function killHarvester(state: GameState, h: HarvesterState): void {
  if (h.carryingDiamond) dropDiamond(state, h.x, h.y);
  spillCarriedWood(state, h);
  h.state = 'dead';
  h.hp = 0;
  h.respawnTimer = HARVESTER_RESPAWN_TICKS;
  h.carryingDiamond = false;
  h.carryingResource = null;
  h.carryAmount = 0;
  h.fightTargetId = null;
  h.targetCellIdx = -1;
  h.diamondCellsMinedThisTrip = 0;
}

// === Nuke Telegraph ===

export function tickNukeTelegraphs(state: GameState): void {
  // Tick down team nuke cooldowns
  for (let t = 0; t < state.nukeTeamCooldown.length; t++) {
    if (state.nukeTeamCooldown[t] > 0) state.nukeTeamCooldown[t]--;
  }

  for (let i = state.nukeTelegraphs.length - 1; i >= 0; i--) {
    const tel = state.nukeTelegraphs[i];
    tel.timer--;
    if (tel.timer <= 0) {
      // Detonate
      executeNukeDetonation(state, tel.playerId, tel.x, tel.y, tel.radius);
      state.nukeTelegraphs.splice(i, 1);
    }
  }
}

export function executeNukeDetonation(state: GameState, playerId: number, x: number, y: number, radius: number): void {
  const player = state.players[playerId];
  const enemyTeam = player.team === Team.Bottom ? Team.Top : Team.Bottom;

  state.nukeEffects.push({
    x, y, radius, age: 0, maxAge: TICK_RATE * 2,
  });
  addSound(state, 'nuke_detonated', x, y);

  let nukeKills = 0;
  let nukeTotalHp = 0;
  compactInPlace(state.units, u => {
    if (u.team !== enemyTeam) return true;
    if (u.nukeImmune) return true; // Diamond champions survive nukes
    if ((u.x - x) ** 2 + (u.y - y) ** 2 <= radius * radius) {
      addDeathParticles(state, u.x, u.y, '#ff4400', 8);
      if (u.carryingDiamond) dropDiamond(state, u.x, u.y);
      nukeTotalHp += u.hp;
      trackDeathResources(state, u);
      nukeKills++;
      return false;
    }
    return true;
  });
  if (state.playerStats[playerId]) {
    state.playerStats[playerId].nukeKills += nukeKills;
    state.playerStats[playerId].enemyUnitsKilled += nukeKills;
  }

  let harvesterKills = 0;
  for (const h of state.harvesters) {
    if (h.team !== enemyTeam || h.state === 'dead') continue;
    if ((h.x - x) ** 2 + (h.y - y) ** 2 <= radius * radius) {
      addDeathParticles(state, h.x, h.y, '#ff4400', 6);
      nukeTotalHp += h.hp;
      killHarvester(state, h);
      harvesterKills++;
    }
  }

  const totalHits = nukeKills + harvesterKills;
  if (totalHits > 0) {
    addFloatingText(state, x, y, `NUKE! (${nukeTotalHp} dmg ${totalHits} kills)`, '#ff4400');
  }

  // GDD: Nuke does NOT damage buildings or HQ — only units and harvesters
}

