/**
 * BotValuation.ts — Bot value estimation functions for spawners, upgrades, research, and huts.
 *
 * Contains the throughput-based valuation system, upgrade scoring, research value estimation,
 * hut payback calculations, and power spike detection. These functions are used by both
 * the value-based build system (Nightmare) and the profile-based build order (Hard/Medium).
 *
 * Part of the simulation layer — must remain fully deterministic.
 */

import {
  GameState, Race, BuildingType, HarvesterAssignment,
  TICK_RATE, HQ_HP, ResearchUpgradeState,
} from './types';
import {
  RACE_BUILDING_COSTS, UPGRADE_TREES, UpgradeNodeDef, UNIT_STATS, SPAWN_INTERVAL_TICKS,
  getNodeUpgradeCost, HUT_COST_SCALE,
  GOLD_YIELD_PER_TRIP, WOOD_YIELD_PER_TRIP, MEAT_YIELD_PER_TRIP,
  getAllResearchUpgrades, getResearchUpgradeCost,
} from './data';
import { getUnitUpgradeMultipliers } from './GameState';
import {
  BotContext, BotDifficulty, BotIntelligence, RaceProfile, ThreatProfile,
  ResourceProjection,
} from './BotProfiles';
import {
  assessThreatProfile, botTeam, botCanAffordHut,
  buildingCategory, resourceBundleTotal, getSpawnerPower,
  PASSIVE_RATES, UNIT_ABILITY_VALUE,
} from './BotIntelligence';

// Re-export UNIT_ABILITY_VALUE so external consumers that imported from BotAI can still find it
export { UNIT_ABILITY_VALUE };

// ==================== UPGRADE INTELLIGENCE ====================

/** Score an upgrade node based on how well its mechanics counter the enemy. */
export function scoreUpgradeNode(
  race: Race, buildingType: BuildingType, node: string, threats: ThreatProfile,
): number {
  const tree = UPGRADE_TREES[race]?.[buildingType];
  if (!tree) return 0;
  const nodeDef = tree[node as keyof typeof tree] as UpgradeNodeDef | undefined;
  if (!nodeDef) return 0;

  let score = 5; // base score — all upgrades have some value
  const s = nodeDef.special;

  // Raw stat multipliers always have value
  if (nodeDef.hpMult) score += (nodeDef.hpMult - 1) * 10;
  if (nodeDef.damageMult) score += (nodeDef.damageMult - 1) * 10;
  if (nodeDef.attackSpeedMult && nodeDef.attackSpeedMult < 1) score += (1 - nodeDef.attackSpeedMult) * 15;
  if (nodeDef.moveSpeedMult) score += (nodeDef.moveSpeedMult - 1) * 5;
  if (nodeDef.rangeMult) score += (nodeDef.rangeMult - 1) * 8;

  if (!s) return score;

  // Score specials based on what we WANT vs enemy composition
  // AoE mechanics are gold vs swarm
  if (threats.wantAoE) {
    if (s.splashRadius) score += 8;
    if (s.multishotCount) score += 6 * s.multishotCount;
    if (s.cleaveTargets) score += 7 * s.cleaveTargets;
    if (s.aoeRadiusBonus) score += 5;
    if (s.extraChainTargets) score += 5 * s.extraChainTargets;
  }

  // Burn is excellent vs tanks and sustain (blight disables regen)
  if (threats.wantBurn) {
    if (s.extraBurnStacks) score += 6 * s.extraBurnStacks;
  }

  // Tankiness vs burst and burn
  if (threats.wantTank) {
    if (s.damageReductionPct) score += s.damageReductionPct * 30;
    if (s.regenPerSec) score += s.regenPerSec * 3;
    if (s.reviveHpPct) score += 8;
    if (s.dodgeChance) score += s.dodgeChance * 20;
  }

  // DPS vs tanks
  if (threats.wantDPS) {
    if (s.knockbackEveryN) score += 3; // disruption has value
    if (s.guaranteedHaste) score += 4;
  }

  // Range vs control/tanks
  if (threats.wantRange) {
    if (s.towerRangeBonus) score += s.towerRangeBonus * 3;
  }

  // Shields vs burn/burst
  if (threats.wantShields) {
    if (s.shieldTargetBonus) score += 5 * s.shieldTargetBonus;
    if (s.shieldAbsorbBonus) score += 3;
  }

  // Cleanse vs burn/slow
  if (threats.wantCleanse) {
    if (s.healBonus) score += s.healBonus * 2;
  }

  // Speed vs slow/control
  if (threats.wantSpeed) {
    if (s.guaranteedHaste) score += 6;
    if (s.hopAttack) score += 5; // leap past slow zones
  }

  // Slow is always valuable for control (extra slow stacks)
  if (s.extraSlowStacks) score += 3 * s.extraSlowStacks;

  // Lifesteal / heal is always decent
  if (s.healBonus) score += 2;
  if (s.lifeDrainPct) score += s.lifeDrainPct * 20; // sustain via damage
  if (s.skeletonSummonChance) score += s.skeletonSummonChance * 30; // free units from deaths

  // Debuff application specials — always valuable
  if (s.applyVulnerable) score += 8; // army-wide damage amplifier
  if (s.applyWound) score += 6; // anti-healing

  // Kill-scaling: snowball damage in extended fights (Demon Bloodfire, Inferno Reaper, Soul Pyre)
  if (s.killScaling) {
    const maxDmgPct = (s.killDmgPct ?? 0.05) * (s.killMaxStacks ?? 10);
    score += maxDmgPct * 15; // 50% max → +7.5
    if (threats.wantDPS) score += 4;
  }

  // Suicide attack: AoE burst on first melee hit (Oozlings Boomlings)
  if (s.suicideAttack) {
    const eDmg = s.explodeDamage ?? 30;
    score += eDmg * 0.1; // 35→+3.5, 70→+7
    if (threats.wantAoE) score += 5;
  }

  // Soul harvest: scaling HP + damage from nearby deaths (Geists Soul Gorger)
  if (s.soulHarvest) score += (s.soulMaxStacks ?? 20) * 0.4; // 20 stacks → +8

  // Gold on kill/death: economic value (Crown economy path)
  if (s.goldOnKill) score += s.goldOnKill * 1.5; // 3g→+4.5, 6g→+9
  if (s.goldOnDeath) score += s.goldOnDeath * 0.5; // 5g→+2.5, 8g→+4

  // Siege units vs turtling/towers
  if (threats.wantSiege) {
    if (s.isSiegeUnit) score += 18;  // overcome negative hp/speed penalty, siege is exactly what we want
    if (s.buildingDamageMult) score += (s.buildingDamageMult - 1) * 6;
  }

  return score;
}

// ==================== THROUGHPUT-BASED VALUATION (Nightmare) ====================

/**
 * Compute sustained combat throughput for a spawner type.
 * Returns power produced per minute, factoring in spawn rate, unit count, DPS, and survivability.
 * Optionally accepts an upgrade path to compute post-upgrade throughput.
 */
export function getSpawnerThroughput(race: Race, type: BuildingType, upgradePath?: string[]): number {
  const stats = UNIT_STATS[race]?.[type];
  if (!stats) return 0;

  let hp = stats.hp;
  let damage = stats.damage;
  let attackSpeed = stats.attackSpeed;
  let spawnSpeed = 1;
  let count = stats.spawnCount ?? 1;

  // Apply upgrade multipliers if path provided
  if (upgradePath && upgradePath.length > 1) {
    const mults = getUnitUpgradeMultipliers(upgradePath, race, type);
    hp *= mults.hp;
    damage *= mults.damage;
    attackSpeed *= mults.attackSpeed;
    spawnSpeed = mults.spawnSpeed;
    if (mults.special.spawnCount) count = mults.special.spawnCount;
  }

  // Spawns per minute
  const spawnInterval = SPAWN_INTERVAL_TICKS * spawnSpeed;
  const spawnsPerMinute = (60 * TICK_RATE) / Math.max(1, spawnInterval);
  const unitsPerMinute = spawnsPerMinute * count;

  // Unit combat value: geometric mean of offense and survival, with ability multipliers
  const dps = damage / Math.max(0.2, attackSpeed);
  const cat = type === BuildingType.MeleeSpawner ? 'melee'
    : type === BuildingType.RangedSpawner ? 'ranged' : 'caster';
  const abilityMult = UNIT_ABILITY_VALUE[race]?.[cat] ?? { survMult: 1, dmgMult: 1 };
  const effectiveDps = dps * abilityMult.dmgMult;
  const effectiveHp = hp * abilityMult.survMult;

  // Power = sqrt(effectiveDPS * effectiveHP) — rewards balanced offense/defense
  const unitPower = Math.sqrt(effectiveDps * effectiveHp);

  return unitPower * unitsPerMinute;
}

/**
 * Detect if an upgrade creates a disproportionate power spike.
 * Returns a bonus multiplier (0 = no spike, 0.4 = massive spike).
 */
export function detectPowerSpike(
  race: Race, type: BuildingType, choice: string, threats: ThreatProfile,
): number {
  const tree = UPGRADE_TREES[race]?.[type];
  if (!tree) return 0;
  const node = tree[choice as keyof typeof tree] as UpgradeNodeDef | undefined;
  if (!node?.special) return 0;
  const s = node.special;

  // Multishot / cleave / splash = multiplicative DPS gains
  if (s.multishotCount) return 0.35;
  if (s.cleaveTargets && threats.wantAoE) return 0.30;
  if (s.splashRadius && threats.wantAoE) return 0.25;
  // Crown shields = massive team-wide spike
  if (race === Race.Crown && type === BuildingType.CasterSpawner && (s.shieldTargetBonus || s.shieldAbsorbBonus)) {
    return threats.wantShields ? 0.40 : 0.20;
  }
  // Haste = big mobility spike for swarm
  if (s.guaranteedHaste) return 0.20;
  // Revive = effectively doubles unit life
  if (s.reviveHpPct) return 0.25;
  // Dodge = effective HP multiplier
  if (s.dodgeChance && s.dodgeChance >= 0.25) return 0.20;
  // Heavy slow stacking = force multiplier (enemies can't close or retreat)
  if (s.extraSlowStacks && s.extraSlowStacks >= 2) return 0.15;
  // Vulnerable = 20% army-wide damage amplifier
  if (s.applyVulnerable) return 0.20;
  // Lifedrain = significant sustain spike on fast attackers
  if (s.lifeDrainPct && s.lifeDrainPct >= 0.15) return 0.15;
  // Skeleton summon = free unit generation from nearby deaths
  if (s.skeletonSummonChance && s.skeletonSummonChance >= 0.15) return 0.15;
  // Kill-scaling = snowball damage that compounds over fights
  if (s.killScaling) return 0.20;
  // High-damage suicide attack = massive AoE burst
  if (s.suicideAttack && (s.explodeDamage ?? 30) >= 50) return 0.20;
  // Soul harvest = multiplicative scaling on both damage and HP
  if (s.soulHarvest) return 0.25;
  return 0;
}

/**
 * Compute time-to-afford a cost bundle given current resources and income.
 * Returns seconds. 0 = can afford now. 999 = can never afford.
 */
export function timeToAfford(
  player: GameState['players'][0], cost: { gold: number; wood: number; meat: number },
  plan: ResourceProjection | null,
): number {
  const goldNeed = Math.max(0, cost.gold - player.gold);
  const woodNeed = Math.max(0, cost.wood - player.wood);
  const meatNeed = Math.max(0, cost.meat - player.meat);
  if (goldNeed === 0 && woodNeed === 0 && meatNeed === 0) return 0;
  if (!plan) return 999;
  const goldSecs = plan.goldIncome > 0.01 ? goldNeed / plan.goldIncome : (goldNeed > 0 ? 999 : 0);
  const woodSecs = plan.woodIncome > 0.01 ? woodNeed / plan.woodIncome : (woodNeed > 0 ? 999 : 0);
  const meatSecs = plan.meatIncome > 0.01 ? meatNeed / plan.meatIncome : (meatNeed > 0 ? 999 : 0);
  return Math.max(goldSecs, woodSecs, meatSecs);
}

export function estimateSpawnerValue(
  state: GameState, ctx: BotContext, playerId: number, type: BuildingType,
): number {
  const race = state.players[playerId].race;
  const cost = RACE_BUILDING_COSTS[race][type];
  const totalCost = resourceBundleTotal(cost);
  if (totalCost <= 0) return 0;

  const diff = ctx.difficulty[playerId] ?? ctx.defaultDifficulty;
  const intel = ctx.intelligence[playerId];

  // Use throughput-based valuation with resource bottleneck awareness
  let value: number;
  if (diff.useValueFunction) {
    const throughput = getSpawnerThroughput(race, type);
    value = throughput / totalCost;
    // Penalize spawners that bottleneck on scarce resources
    const plan = intel?.resourcePlan;
    if (plan) {
      const waitTime = timeToAfford(state.players[playerId], cost, plan);
      if (waitTime > 8) value *= 0.85; // long wait = resource mismatch
    }
    // Going wide bonus: spawners are more valuable early when you have few
    const totalSpawners = state.buildings.filter(
      b => b.playerId === playerId && b.type !== BuildingType.Tower && b.type !== BuildingType.HarvesterHut
    ).length;
    if (totalSpawners < 4) value *= 1.4; // early game: spawners are king
    else if (totalSpawners < 7) value *= 1.15; // mid game: still good
  } else {
    value = getSpawnerPower(race, type) / totalCost;
  }

  const cat = buildingCategory(type);
  if (cat && intel) {
    // Build shift: stronger influence for nightmare bots
    const shiftWeight = diff.useValueFunction ? 0.12 : 0.08;
    value *= 1 + Math.max(0, intel.buildShift[cat]) * shiftWeight;
    if (intel.effectiveCategory === cat) value *= 1.15;
    if (intel.weakCategory === cat && intel.armyAdvantage < 0.9) value *= 0.88;
  }
  return value;
}

export function estimateUpgradeValue(
  state: GameState, ctx: BotContext, playerId: number, building: GameState['buildings'][0],
  profile: RaceProfile, enemyRaces: Race[], diff: BotDifficulty,
): { value: number; choice: string } {
  const player = state.players[playerId];
  const race = player.race;
  const choice = botPickUpgrade(state, ctx, building, profile, race, enemyRaces, diff);
  const tier = getNodeUpgradeCost(race, building.type, building.upgradePath.length, choice);
  const totalCost = resourceBundleTotal(tier);
  if (totalCost <= 0 && !(tier.deathEssence ?? 0) && !(tier.souls ?? 0)) return { value: 0, choice: 'B' };
  if (player.gold < tier.gold || player.wood < tier.wood || player.meat < tier.meat) {
    return { value: 0, choice };
  }
  if ((tier.deathEssence ?? 0) > 0 && player.deathEssence < (tier.deathEssence ?? 0)) {
    return { value: 0, choice };
  }
  if ((tier.souls ?? 0) > 0 && player.souls < (tier.souls ?? 0)) {
    return { value: 0, choice };
  }

  const tree = UPGRADE_TREES[race]?.[building.type];
  if (!tree) return { value: 0, choice };
  const nodeDef = tree[choice as keyof typeof tree] as UpgradeNodeDef | undefined;
  if (!nodeDef) return { value: 0, choice };

  const intel = ctx.intelligence[playerId];
  const threats = intel?.threats ?? assessThreatProfile(enemyRaces);
  let value: number;

  if (diff.useValueFunction && building.type !== BuildingType.Tower) {
    // Throughput-based: compute actual power delta from this upgrade
    const currentTP = getSpawnerThroughput(race, building.type, building.upgradePath);
    const newPath = [...building.upgradePath, choice];
    const newTP = getSpawnerThroughput(race, building.type, newPath);
    const throughputDelta = newTP - currentTP;

    // Power spike detection: some upgrades have disproportionate impact
    const spikeBonus = detectPowerSpike(race, building.type, choice, threats);
    const matchupBonus = scoreUpgradeNode(race, building.type, choice, threats) / 40;

    // Count how many buildings of this type share the upgrade (upgrades apply to the spawner type)
    const sameTypeCount = state.buildings.filter(
      b => b.playerId === player.id && b.type === building.type
    ).length;
    // More buildings of same type = upgrade benefits more production (big multiplier)
    const volumeBonus = Math.max(0.5, sameTypeCount * 0.7);

    value = (throughputDelta * (1 + spikeBonus + matchupBonus) * volumeBonus) / totalCost;

    // Siege penalty: siege units are bad vs units, only useful when pushing buildings.
    // Heavily penalize siege upgrades unless game is late (8+ min) and we're ahead or even.
    if (nodeDef.special?.isSiegeUnit) {
      const gameMin = state.tick / TICK_RATE / 60;
      if (gameMin < 8) value *= 0.1;  // almost never pick siege early
      else value *= 0.4;               // still deprioritize late
    }
  } else {
    // Stat-based (non-nightmare or towers)
    const hpGain = (nodeDef.hpMult ?? 1) - 1;
    const dmgGain = (nodeDef.damageMult ?? 1) - 1;
    const spdGain = nodeDef.attackSpeedMult ? (1 - nodeDef.attackSpeedMult) : 0;
    const moveGain = (nodeDef.moveSpeedMult ?? 1) - 1;
    const rangeGain = (nodeDef.rangeMult ?? 1) - 1;
    const matchupBonus = scoreUpgradeNode(race, building.type, choice, threats) / 25;
    const specialBonus = nodeDef.special ? 0.12 : 0;
    const totalGain = hpGain * 0.35 + dmgGain * 0.9 + spdGain * 1.1 + moveGain * 0.2 + rangeGain * 0.5 + specialBonus + matchupBonus;

    const basePower = building.type === BuildingType.Tower ? 10 : getSpawnerPower(race, building.type);
    value = (basePower * totalGain) / totalCost;
  }

  const cat = buildingCategory(building.type);
  if (intel && cat) {
    if (intel.effectiveCategory === cat) value *= 1.18;
    if (intel.armyAdvantage < 0.75 && intel.weakCategory === cat) value *= 0.88;
  }
  if (building.type === BuildingType.Tower && (intel?.strategy === 'turtle' || (intel?.armyAdvantage ?? 1) < 0.8)) {
    value *= 1.15;
  }

  return { value, choice };
}

// ==================== RESEARCH VALUE ESTIMATION ====================

/**
 * Synergy scores for race one-shot research upgrades.
 * Higher = buy sooner. Scores reflect actual game impact:
 * - Multiplicative effects (burn, shields, AoE, lifesteal) score high
 * - Flat bonuses (+HP, +dmg) are moderate
 * - Niche/situational effects score lower unless threat-matched
 * - Ability upgrades are mid-late game investments
 */
export function getOneShotSynergyScore(id: string, threats: ThreatProfile): number {
  switch (id) {
    // --- CROWN: shields are the power spike, ranged piercing is strong ---
    case 'crown_melee_1': return threats.hasBurst ? 2.0 : 1.0;   // Defend Stance: -25% ranged dmg taken — niche
    case 'crown_melee_2': return 2.5;                             // Royal Guard: +15% HP + gold on kill — econ synergy
    case 'crown_ranged_1': return threats.hasTanks ? 3.0 : 2.0;  // Piercing Arrows: ignore def + %HP dmg — great vs tanks
    case 'crown_ranged_2': return 3.0;                            // Crown Volley: +1 projectile — multiplicative DPS spike
    case 'crown_caster_1': return 3.5;                            // Fortified Shields: +8 absorb — core identity amplifier
    case 'crown_caster_2': return 2.0;                            // Healing Aura: 1 HP/s to 2 allies — decent sustain
    // Crown ability: Aegis Wrath (+25% dmg while shielded) is the big spike
    case 'crown_ability_1': return 3.5;   // Swift Workers: +40% worker speed — huge economy boost
    case 'crown_ability_2': return 1.0;   // Royal Forge: foundry no wood — very narrow, buy cheap
    case 'crown_ability_3': return 4.0;   // Aegis Wrath: +25% dmg while shielded — army-wide spike
    case 'crown_ability_4': return 3.5;   // Timber Surplus: +40% wood income — massive econ boost

    // --- HORDE: brute force, auras are the differentiator ---
    case 'horde_melee_1': return 3.0;                             // Blood Rage: up to +40% dmg based on missing HP — strong
    case 'horde_melee_2': return 2.5;                             // Thick Skin: +25% HP — always good for front line
    case 'horde_ranged_1': return threats.hasSustain ? 3.0 : 1.5; // Heavy Bolts: Wound — amazing vs Tenders/Geists
    case 'horde_ranged_2': return threats.hasSwarm ? 3.5 : 2.0;  // Bombardier: splash — huge vs swarm
    case 'horde_caster_1': return 3.0;                            // War Drums: haste 3->5s + 20% attack speed — strong
    case 'horde_caster_2': return 3.5;                            // Berserker Howl: haste gives +25% dmg — multiplicative
    // Horde ability: Trophy Hunter is the big late-game snowball
    case 'horde_ability_1': return 2.5;   // Trample: War Troll AoE — solid mid-game
    case 'horde_ability_2': return 1.0;   // Troll Discount: saves resources — minor, buy opportunistically
    case 'horde_ability_3': return 3.0;   // Wide Aura: doubled range — huge with multiple casters
    case 'horde_ability_4': return 4.0;   // Trophy Hunter: +2%/kill snowball — game-winning late

    // --- GOBLINS: burn stacking, speed, cheap and nasty ---
    case 'goblins_melee_1': return 3.0;                            // Coated Blades: +1 burn — core identity, scales with volume
    case 'goblins_melee_2': return 2.0;                            // Scurry: +35% move — helps engage/disengage
    case 'goblins_ranged_1': return 3.0;                           // Incendiary Tips: +1 burn ranged — more burn stacking
    case 'goblins_ranged_2': return threats.hasTanks ? 3.0 : 2.0; // Lucky Shot: 15% extra proj — great vs tanks
    case 'goblins_caster_1': return 2.5;                           // Potent Hex: +1 burn AoE — synergy with casters
    case 'goblins_caster_2': return threats.hasSustain ? 3.5 : 2.0; // Jinx Cloud: wound on slowed — anti-heal combo
    // Goblin ability: Elixir Mastery + Potent Potions are the elite late-game combo
    case 'goblins_ability_1': return 2.5;   // Quick Brew: faster potions + attract — good mid
    case 'goblins_ability_2': return 1.0;   // Cower Reflexes: dodge while fleeing — weak, buy cheap
    case 'goblins_ability_3': return 4.0;   // Potent Potions: 2x effect strength — elite
    case 'goblins_ability_4': return 4.5;   // Elixir Mastery: permanent potions — #1 ability in game

    // --- OOZLINGS: death-powered economy, go wide ---
    case 'oozlings_melee_1': return 3.0;   // Volatile Membrane: explode on death — amazing for swarm
    case 'oozlings_melee_2': return 3.5;   // Mitosis: 10% spawn on death — economy engine
    case 'oozlings_ranged_1': return 2.0;  // Corrosive Spit: vulnerable — amplifies all damage
    case 'oozlings_ranged_2': return 1.5;  // Acid Pool: kill leaves pool — minor AoE
    case 'oozlings_caster_1': return 1.5;  // Symbiotic Link: heal during haste — niche
    case 'oozlings_caster_2': return 2.5;  // Mass Division: wound on AoE — anti-heal
    // Oozling ability: Ooze Vitality is the powerhouse on swarm armies
    case 'oozlings_ability_1': return 2.0;  // Spitter Mound: 25% ranged spawn — moderate diversity
    case 'oozlings_ability_2': return 2.0;  // Caster Mound: 25% caster spawn — moderate diversity
    case 'oozlings_ability_3': return 1.5;  // Death Burst: 3 ooze on tower death — reactive, weak
    case 'oozlings_ability_4': return 4.0;  // Ooze Vitality: 2 HP/s all units — massive on swarm army

    // --- DEMON: burn everything, mana economy matters ---
    case 'demon_melee_1': return 3.0;                             // Infernal Rage: +25% vs burning — core synergy
    case 'demon_melee_2': return 2.5;                             // Soul Siphon: +2 mana on kill — fuels fireballs
    case 'demon_ranged_1': return 3.0;                            // Hellfire Arrows: +1 burn +10% dmg — dual spike
    case 'demon_ranged_2': return threats.hasSwarm ? 3.5 : 2.0;  // Eye of Destruction: splash — huge vs swarm
    case 'demon_caster_1': return 2.0;                            // Flame Conduit: +1 AoE burn — caster-dependent
    case 'demon_caster_2': return 2.0;                            // Immolation: burn aura — caster-dependent
    // Demon ability: Scorched Earth is the standout, Mana Siphon fuels the engine
    case 'demon_ability_1': return 2.0;   // Rapid Fire: -25% cooldown — moderate
    case 'demon_ability_2': return 3.5;   // Scorched Earth: burn ground — strong AoE denial
    case 'demon_ability_3': return 1.5;   // Siege Fire: +50% building dmg — niche push tool
    case 'demon_ability_4': return 3.0;   // Mana Siphon: +50% mana income — fuels everything

    // --- DEEP: tank wall + slow control ---
    case 'deep_melee_1': return 3.0;                              // Tidal Guard: +15% HP +5% DR — makes tanks unkillable
    case 'deep_melee_2': return 3.5;                              // Crushing Depths: +50% vs slowed — huge with Harpooner slow
    case 'deep_ranged_1': return 2.5;                             // Frozen Harpoons: +1 slow — more control
    case 'deep_ranged_2': return 2.5;                             // Anchor Shot: +100% siege dmg — devastating push tool
    case 'deep_caster_1': return 3.0;                             // Purifying Tide: cleanse burn + haste 5 allies — mobility fix
    case 'deep_caster_2': return 2.0;                             // Abyssal Ward: shield allies — decent support
    // Deep ability: Healing Rain is the fight-winner, Purifying is matchup-dependent
    case 'deep_ability_1': return 2.5;   // Crushing Rain: 3 dps in Deluge — solid AoE damage
    case 'deep_ability_2': return 3.5;   // Healing Rain: 5 HP/s in Deluge — fight-winning sustain
    case 'deep_ability_3': return 2.0;   // Freezing Depths: 15% extra slow — moderate passive
    case 'deep_ability_4': return threats.hasBurn ? 3.0 : 1.5;   // Purifying Deluge: cleanse — great vs burn/slow, useless otherwise

    // --- WILD: poison aggro, meat-on-kill, frenzy timing ---
    case 'wild_melee_1': return 3.0;                              // Savage Frenzy: +2s frenzy +10% dmg — core identity
    case 'wild_melee_2': return 3.0;                              // Pack Hunter: +5%/ally — scales with army size
    case 'wild_ranged_1': return 2.5;                             // Venomous Fangs: burn + wound — dual debuff
    case 'wild_ranged_2': return 2.0;                             // Slowing Shots: +1 slow on hit — control
    case 'wild_caster_1': return 2.5;                             // Nature's Wrath: +1 AoE radius — more coverage
    case 'wild_caster_2': return 3.0;                             // Alpha Howl: casters grant frenzy — huge multiplicative
    // Wild ability: Blood Frenzy is the army-wide snowball, Savage Instinct combos with it
    case 'wild_ability_1': return 1.5;   // Meat Harvest: 30% chance +3 meat — weak trickle
    case 'wild_ability_2': return 4.0;   // Blood Frenzy: 4x frenzy area — army-wide, game-defining
    case 'wild_ability_3': return 2.0;   // Pack Speed: +10% move — decent mobility
    case 'wild_ability_4': return 3.0;   // Savage Instinct: frenzy lifesteal — great combo with Blood Frenzy

    // --- GEISTS: lifesteal sustain, soul economy, summon spam ---
    case 'geists_melee_1': return 3.0;                            // Death Grip: lifesteal 15->25% — huge sustain spike
    case 'geists_melee_2': return threats.hasBurst ? 3.0 : 2.0;  // Spectral Armor: DR per missing HP — anti-burst
    case 'geists_ranged_1': return 2.0;                           // Soul Arrows: +10% lifesteal — moderate
    case 'geists_ranged_2': return 2.0;                           // Phantom Volley: 15% pass-through — minor
    case 'geists_caster_1': return 2.0;                           // Necrotic Burst: +2 heal — incremental
    case 'geists_caster_2': return 2.5;                           // Undying Will: skeleton summon — more bodies
    // Geists ability: Hungering Dark is the elite multiplicative scaler
    case 'geists_ability_1': return 3.0;   // Bone Archers: +3 skeleton archers — big value per summon
    case 'geists_ability_2': return 2.0;   // Empowered Minions: +5 dmg +25% speed — moderate
    case 'geists_ability_3': return 1.0;   // Death Defiance: 5% avoid death — weakest ability in game
    case 'geists_ability_4': return 4.5;   // Hungering Dark: lifesteal=+dmg — elite multiplicative scaling

    // --- TENDERS: regen sustain, seed timing ---
    case 'tenders_melee_1': return 3.0;                            // Bark Skin: regen 1->2 HP/s — doubles sustain
    case 'tenders_melee_2': return 1.5;                            // Thorned Vines: reflect 3 dmg — minor
    case 'tenders_ranged_1': return 2.5;                           // Healing Sap: heal 15% of dmg — sustain + damage
    case 'tenders_ranged_2': return 1.5;                           // Root Snare: 20% slow — unreliable
    case 'tenders_caster_1': return 3.0;                           // Bloom Burst: +2 heal — core healer buff
    case 'tenders_caster_2': return 2.5;                           // Life Link: double heal <30% — clutch saves
    // Tenders ability: Fast Growth + Quick Seeds are the seed pipeline combo
    case 'tenders_ability_1': return 3.0;   // Fast Growth: seeds grow 40% faster — core seed upgrade
    case 'tenders_ability_2': return 3.0;   // Quick Seeds: -30% cooldown — core seed upgrade
    case 'tenders_ability_3': return 1.5;   // Reseed: 30% replant — niche value over time
    case 'tenders_ability_4': return 1.5;   // Ironwood: tower upgrades -50% — narrow, tower-only

    default: return 1.0;
  }
}

/**
 * Estimate value of a research upgrade in comparable power-per-cost units.
 * Used by Nightmare (botValueBasedBuild) and Hard (botUpgradeBuildings) bots.
 */
export function estimateResearchValue(
  _state: GameState, _ctx: BotContext, playerId: number,
  upgradeId: string, race: Race, bu: ResearchUpgradeState,
  intel: BotIntelligence, myBuildings: GameState['buildings'],
): number {
  const def = getAllResearchUpgrades(race).find(d => d.id === upgradeId);
  if (!def) return 0;

  // Skip already-owned one-shots
  if (def.oneShot && bu.raceUpgrades[def.id]) return 0;

  // Get level for scaling upgrades (cap at 3 — diminishing returns beyond that)
  let level = 0;
  if (upgradeId === 'melee_atk') level = bu.meleeAtkLevel;
  else if (upgradeId === 'melee_def') level = bu.meleeDefLevel;
  else if (upgradeId === 'ranged_atk') level = bu.rangedAtkLevel;
  else if (upgradeId === 'ranged_def') level = bu.rangedDefLevel;
  else if (upgradeId === 'caster_atk') level = bu.casterAtkLevel;
  else if (upgradeId === 'caster_def') level = bu.casterDefLevel;

  // Hard cap: don't value research beyond level 3 (massive diminishing returns)
  if (!def.oneShot && level >= 3) return 0;

  const cost = getResearchUpgradeCost(upgradeId, level, race);
  const totalCost = cost.gold + cost.wood + cost.meat + (cost.deathEssence ?? 0) + (cost.souls ?? 0);
  if (totalCost <= 0) return 0;

  // Race ability upgrades: scale with total army size (these are global effects)
  if (def.category === 'ability') {
    if (!def.oneShot) return 0;
    const synergyScore = getOneShotSynergyScore(upgradeId, intel.threats);
    const totalSpawners = myBuildings.filter(b => b.playerId === playerId &&
      (b.type === BuildingType.MeleeSpawner || b.type === BuildingType.RangedSpawner || b.type === BuildingType.CasterSpawner)
    ).length;
    // Scale with army size — ability upgrades are mid-late investments
    const armyScale = Math.max(1, totalSpawners * 0.6);
    return synergyScore * armyScale * 0.5 / totalCost;
  }

  // Get category counts
  const cat = def.category;
  const catType = cat === 'melee' ? BuildingType.MeleeSpawner
    : cat === 'ranged' ? BuildingType.RangedSpawner
    : BuildingType.CasterSpawner;
  const spawnerCount = myBuildings.filter(b => b.playerId === playerId && b.type === catType).length;
  const unitStats = UNIT_STATS[race]?.[catType];
  if (!unitStats) return 0;
  const abilityMult = UNIT_ABILITY_VALUE[race]?.[cat] ?? { survMult: 1, dmgMult: 1 };
  const avgDamage = unitStats.damage * abilityMult.dmgMult;
  const avgHP = unitStats.hp * abilityMult.survMult;

  const threats = intel.threats;
  const armyAdvantage = intel.armyAdvantage;

  // --- Race one-shot upgrades ---
  if (def.oneShot) {
    if (spawnerCount === 0) return 0; // no spawners of this category
    const synergyScore = getOneShotSynergyScore(upgradeId, threats);
    // One-shots multiply ALL future production from this category.
    // Value scales quadratically with spawner count (more spawners = more units benefiting).
    return synergyScore * Math.pow(spawnerCount, 1.3) * 0.6 / totalCost;
  }

  // Research multiplies ALL units of this category — current AND future.
  // The more spawners you have, the more value each research level provides.
  // Use spawnerCount^1.5 to reflect that research is multiplicative across production.
  const productionScale = Math.pow(Math.max(1, spawnerCount), 1.5);

  // --- Attack upgrades (melee_atk, ranged_atk, caster_atk) ---
  if (def.type === 'attack') {
    // Marginal multiplier gain: 1.25^(level+1) - 1.25^level = 1.25^level * 0.25
    const marginalMult = Math.pow(1.25, level) * 0.25;
    let value = marginalMult * productionScale * avgDamage * 3.0 / totalCost;

    // Boost if this is the effective category
    if (intel.effectiveCategory === cat) value *= 1.3;
    // If losing, attack upgrades get +20% (need to punch through)
    if (armyAdvantage < 0.8) value *= 1.2;

    return value;
  }

  // --- Defense upgrades (melee_def, ranged_def, caster_def) ---
  if (def.type === 'defense') {
    // Marginal DR gain: 1/(1+0.06*level) - 1/(1+0.06*(level+1))
    const oldDR = 1 - 1 / (1 + 0.06 * level);
    const newDR = 1 - 1 / (1 + 0.06 * (level + 1));
    // Effective HP multiplier increase
    const ehpGain = (newDR > 0.99 ? 100 : 1 / (1 - newDR)) - (oldDR > 0.99 ? 100 : 1 / (1 - oldDR));
    let value = ehpGain * productionScale * avgHP * 3.0 / totalCost;

    // If losing badly, defense gets +50%
    if (armyAdvantage < 0.6) value *= 1.5;
    // If weak category matches, multiply by 1.5
    if (intel.weakCategory === cat) value *= 1.5;

    return value;
  }

  return 0;
}

export function estimateHutPaybackSeconds(
  state: GameState, ctx: BotContext, playerId: number, hutCount: number,
): number {
  const race = state.players[playerId].race;
  const hutBase = RACE_BUILDING_COSTS[race][BuildingType.HarvesterHut];
  const mult = Math.pow(HUT_COST_SCALE, Math.max(0, hutCount - 1));
  const totalCost = Math.floor(hutBase.gold * mult) + Math.floor(hutBase.wood * mult) + Math.floor(hutBase.meat * mult);
  if (totalCost <= 0) return 999;

  const plan = ctx.intelligence[playerId]?.resourcePlan;
  const passive = PASSIVE_RATES[race];
  const harvesters = state.harvesters.filter(h => h.playerId === playerId);
  let goldH = 0, woodH = 0, meatH = 0;
  for (const h of harvesters) {
    if (h.assignment === HarvesterAssignment.BaseGold || h.assignment === HarvesterAssignment.Center) goldH++;
    else if (h.assignment === HarvesterAssignment.Wood) woodH++;
    else meatH++;
  }

  const goldIncome = plan?.goldIncome ?? (passive.gold + goldH * (GOLD_YIELD_PER_TRIP / 8.5));
  const woodIncome = plan?.woodIncome ?? (passive.wood + woodH * (WOOD_YIELD_PER_TRIP / 8.5));
  const meatIncome = plan?.meatIncome ?? (passive.meat + meatH * (MEAT_YIELD_PER_TRIP / 8.5));

  const costTime = Math.max(
    hutBase.gold > 0 ? Math.floor(hutBase.gold * mult) / Math.max(0.1, goldIncome) : 0,
    hutBase.wood > 0 ? Math.floor(hutBase.wood * mult) / Math.max(0.1, woodIncome) : 0,
    hutBase.meat > 0 ? Math.floor(hutBase.meat * mult) / Math.max(0.1, meatIncome) : 0
  );

  // Avg harvester income: weighted by resource types the race uses
  const avgHarvestRate = (GOLD_YIELD_PER_TRIP + WOOD_YIELD_PER_TRIP + MEAT_YIELD_PER_TRIP) / 3 / 8.5;
  const directPayback = totalCost / avgHarvestRate;
  return Math.max(directPayback, costTime * 1.2);
}

export function shouldBuildHutNow(
  state: GameState, ctx: BotContext, playerId: number, profile: RaceProfile,
  hutCount: number, gameMinutes: number,
): boolean {
  // Nightmare bots use difficulty maxHuts (higher cap); others use profile cap
  const diff = ctx.difficulty[playerId] ?? ctx.defaultDifficulty;
  const hutCap = diff.useValueFunction ? diff.maxHuts : profile.maxHuts;
  if (hutCount >= hutCap) return false;

  const intel = ctx.intelligence[playerId];
  const armyAdvantage = intel?.armyAdvantage ?? 1;
  const myHqHp = state.hqHp[botTeam(playerId, state)];
  const canAfford = botCanAffordHut(state, playerId, hutCount);

  // Dynamic max huts: adjust based on game state
  const dynamicMax = computeDynamicHutTarget(intel, gameMinutes, profile, hutCount, armyAdvantage, diff);
  if (hutCount >= dynamicMax) return false;

  // Can't afford — return false (save-for logic handles this at the build level)
  if (!canAfford) return false;

  const payback = estimateHutPaybackSeconds(state, ctx, playerId, hutCount);
  const bottleneckWait = intel?.resourcePlan
    ? Math.max(intel.resourcePlan.goldSecsToTarget, intel.resourcePlan.woodSecsToTarget, intel.resourcePlan.meatSecsToTarget)
    : 0;

  // When behind hard: never invest in economy, spend on army
  if (myHqHp < HQ_HP * 0.35 && armyAdvantage < 0.85) return false;
  // When behind moderately: only if we have army parity
  if (myHqHp < HQ_HP * 0.45 && armyAdvantage < 0.95) return false;

  // Nightmare bot: more aggressive economy when safe
  if (diff.useValueFunction) {
    // Early game: always invest in economy (huts pay for themselves quickly)
    if (gameMinutes < 1.5) return payback <= 45;
    if (gameMinutes < 2.5) return payback <= 55;
    // When winning: expand economy for snowball
    if (armyAdvantage > 1.3 && payback <= 100) return true;
    // When even: invest if payback is reasonable
    if (gameMinutes < 5) return payback <= 70 && armyAdvantage >= 0.85;
    // Greed strategy or resource-starved — keep investing in economy
    if ((intel?.strategy === 'greed' || bottleneckWait > 15) && payback <= 85 && armyAdvantage >= 0.85) return true;
    // Late game: still invest if payback is reasonable (no hard cutoff for nightmare)
    if (gameMinutes < 10) return payback <= 60 && armyAdvantage >= 0.9;
    // Very late game: only if payback is quick and we're not losing
    return payback <= 45 && armyAdvantage >= 0.95;
  }

  // Non-nightmare logic (unchanged)
  if (gameMinutes < 2.25) return payback <= 55;
  if (gameMinutes < 4.5) return payback <= 75 && armyAdvantage >= 0.9;
  if ((intel?.strategy === 'greed' || bottleneckWait > 20) && payback <= 90 && armyAdvantage >= 0.85) return true;
  if (gameMinutes > 7) return false;
  return payback <= 65 && armyAdvantage >= 1.05;
}

/** Compute dynamic max hut target based on game state */
export function computeDynamicHutTarget(
  intel: BotIntelligence | undefined, gameMinutes: number,
  profile: RaceProfile, hutCount: number, armyAdvantage: number,
  diff?: BotDifficulty,
): number {
  const isNightmare = diff?.useValueFunction ?? false;
  let target = isNightmare ? (diff?.maxHuts ?? profile.maxHuts) : profile.maxHuts;
  // When losing badly: freeze hut building
  if (armyAdvantage < 0.65 && gameMinutes > 2) target = Math.min(target, hutCount);
  // When winning big: allow one extra hut for snowball
  if (armyAdvantage > 1.4) target = Math.min(target + 1, 10);
  // Very late game: non-nightmare stops expanding; nightmare only slows down
  if (gameMinutes > 7 && !isNightmare) target = Math.min(target, hutCount);
  // Turtle strategy: allow more econ
  if (intel?.strategy === 'turtle' && armyAdvantage >= 0.8) target = Math.min(target + 1, 10);
  // Greed strategy (nightmare): allow full econ investment
  if (isNightmare && intel?.strategy === 'greed') target = Math.min(target + 1, 10);
  return target;
}

/** Matchup-aware upgrade selection: scores each option by how well it counters the enemy. */
export function botPickUpgrade(
  state: GameState, ctx: BotContext, building: GameState['buildings'][0], profile: RaceProfile, race: Race,
  enemyRaces: Race[], diff: BotDifficulty,
): string {
  const intel = ctx.intelligence[building.playerId];
  const threats = intel?.threats ?? assessThreatProfile(enemyRaces);

  if (building.upgradePath.length === 1) {
    // Tier 1: choose B or C
    let bias: 'B' | 'C';
    switch (building.type) {
      case BuildingType.MeleeSpawner:  bias = profile.meleeUpgradeBias; break;
      case BuildingType.RangedSpawner: bias = profile.rangedUpgradeBias; break;
      case BuildingType.CasterSpawner: bias = profile.casterUpgradeBias; break;
      case BuildingType.Tower:         bias = profile.towerUpgradeBias; break;
      default: bias = 'B';
    }

    if (!diff.useSmartUpgrades) {
      // Non-smart: just follow race bias with occasional random
      if (diff.mistakeRate > 0 && state.rng() < diff.mistakeRate) return bias === 'B' ? 'C' : 'B';
      return bias;
    }

    const scoreB = scoreUpgradeNode(race, building.type, 'B', threats);
    const scoreC = scoreUpgradeNode(race, building.type, 'C', threats);
    const biasBonus = 2;
    const adjustedB = scoreB + (bias === 'B' ? biasBonus : 0);
    const adjustedC = scoreC + (bias === 'C' ? biasBonus : 0);
    { // Always consume 2 RNG values to keep sequence stable
      const roll = state.rng(), flip = state.rng();
      if (diff.mistakeRate > 0 && roll < diff.mistakeRate) return flip < 0.5 ? 'B' : 'C';
    }
    return adjustedB >= adjustedC ? 'B' : 'C';
  }

  // Tier 2: choose D/E (under B) or F/G (under C)
  const isBranch = building.upgradePath[1] === 'B';
  const opt1 = isBranch ? 'D' : 'F';
  const opt2 = isBranch ? 'E' : 'G';

  if (!diff.useSmartUpgrades) {
    // Non-smart: random choice within branch
    return state.rng() < 0.5 ? opt1 : opt2;
  }

  const score1 = scoreUpgradeNode(race, building.type, opt1, threats);
  const score2 = scoreUpgradeNode(race, building.type, opt2, threats);
  const offenseBonus = (intel?.armyAdvantage ?? 1) > 1.3 ? 2 : 0;
  const defenseBonus = (intel?.armyAdvantage ?? 1) < 0.7 ? 2 : 0;
  const adj1 = score1 + defenseBonus;
  const adj2 = score2 + offenseBonus;
  { // Always consume 2 RNG values to keep sequence stable
    const roll = state.rng(), flip = state.rng();
    if (diff.mistakeRate > 0 && roll < diff.mistakeRate) return flip < 0.5 ? opt1 : opt2;
  }
  return adj1 >= adj2 ? opt1 : opt2;
}
