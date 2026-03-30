/**
 * Cost-Benefit Analysis Tool
 *
 * Computes effective costs, unit power, cost-efficiency ratios, and hut payback
 * for all 9 races. Uses the exchange rate: 2 gold = 1 wood = 1 meat.
 *
 * Run: npm run cost-analysis
 */

import { Race, BuildingType, TICK_RATE } from '../simulation/types';
import {
  UNIT_STATS, TOWER_STATS,
  RACE_BUILDING_COSTS, RACE_UPGRADE_COSTS,
  UPGRADE_TREES,
  HUT_COST_SCALE,
  GOLD_YIELD_PER_TRIP, WOOD_YIELD_PER_TRIP, MEAT_YIELD_PER_TRIP,
  SPAWN_INTERVAL_TICKS,
  HARVESTER_MOVE_SPEED, MINE_TIME_BASE_TICKS,
  getNodeUpgradeCost,
} from '../simulation/data';
// ==================== CONFIG ====================

const RACE_NAMES: Record<Race, string> = {
  [Race.Crown]: 'Crown',
  [Race.Horde]: 'Horde',
  [Race.Goblins]: 'Goblins',
  [Race.Oozlings]: 'Oozlings',
  [Race.Demon]: 'Demon',
  [Race.Deep]: 'Deep',
  [Race.Wild]: 'Wild',
  [Race.Geists]: 'Geists',
  [Race.Tenders]: 'Tenders',
};

const ALL_RACES: Race[] = [
  Race.Crown, Race.Horde, Race.Goblins, Race.Oozlings,
  Race.Demon, Race.Deep, Race.Wild, Race.Geists, Race.Tenders,
];

const COMBAT_BUILDINGS: BuildingType[] = [
  BuildingType.MeleeSpawner, BuildingType.RangedSpawner, BuildingType.CasterSpawner,
];

const CATEGORY_NAMES: Record<BuildingType, string> = {
  [BuildingType.MeleeSpawner]: 'Melee',
  [BuildingType.RangedSpawner]: 'Ranged',
  [BuildingType.CasterSpawner]: 'Caster',
  [BuildingType.Tower]: 'Tower',
  [BuildingType.HarvesterHut]: 'Hut',
  [BuildingType.Research]: 'Research',
};

// ==================== EFFECTIVE COST ====================

/** Convert raw resources to effective cost: gold/2 + wood + meat */
function eff(gold: number, wood: number, meat: number): number {
  return gold / 2 + wood + meat;
}

function effCost(c: { gold: number; wood: number; meat: number; souls?: number }): number {
  // Souls valued at ~2 effective (similar to wood/meat, since they're a limited resource)
  return eff(c.gold, c.wood, c.meat) + ((c as any).souls ?? 0) * 2;
}

// ==================== HARVESTER ECONOMICS ====================

function computeHarvesterEconomics() {
  // Duel map positions
  const hqCenter = { x: 40, y: 106.5 }; // Bottom team HQ center
  const goldMine = { x: 40, y: 99 };     // 6 tiles below HQ
  const woodNode = { x: 12, y: 60 };     // Far left, mid-map
  const meatNode = { x: 68, y: 60 };    // Far right, mid-map

  const speed = HARVESTER_MOVE_SPEED; // tiles/sec
  const mineTime = MINE_TIME_BASE_TICKS / TICK_RATE; // seconds

  function tripCycle(nodePos: { x: number; y: number }): number {
    const dist = Math.sqrt((nodePos.x - hqCenter.x) ** 2 + (nodePos.y - hqCenter.y) ** 2);
    const travelTime = (dist * 2) / speed; // round trip
    return travelTime + mineTime;
  }

  const goldCycle = tripCycle(goldMine);
  const woodCycle = tripCycle(woodNode);
  const meatCycle = tripCycle(meatNode);

  return {
    goldCycle,
    woodCycle,
    meatCycle,
    goldPerSec: GOLD_YIELD_PER_TRIP / goldCycle,
    woodPerSec: WOOD_YIELD_PER_TRIP / woodCycle,
    meatPerSec: MEAT_YIELD_PER_TRIP / meatCycle,
    goldEffPerSec: (GOLD_YIELD_PER_TRIP / 2) / goldCycle,  // gold worth half
    woodEffPerSec: WOOD_YIELD_PER_TRIP / woodCycle,
    meatEffPerSec: MEAT_YIELD_PER_TRIP / meatCycle,
  };
}

// ==================== UNIT POWER ====================

interface UnitPower {
  hp: number;
  dps: number;
  spawnCount: number;
  power: number;         // HP * DPS * spawnCount (with special adjustments)
  spawnInterval: number; // seconds
  powerRate: number;     // power / spawnInterval
  specialNotes: string[]; // what specials contributed
}

function getUpgradeNode(race: Race, btype: BuildingType, node: string) {
  const tree = UPGRADE_TREES[race]?.[btype];
  if (!tree) return undefined;
  return tree[node as keyof typeof tree];
}

function computeUnitPower(race: Race, btype: BuildingType, upgradePath: string[]): UnitPower {
  const stats = UNIT_STATS[race]?.[btype];
  if (!stats) return { hp: 0, dps: 0, spawnCount: 1, power: 0, spawnInterval: 999, powerRate: 0, specialNotes: [] };

  let hpMult = 1, dmgMult = 1, atkSpdMult = 1, spawnSpdMult = 1;
  let spawnCount = stats.spawnCount ?? 1;

  // Merge specials using Object.assign semantics (later nodes override, matching GameState)
  const special: Record<string, any> = {};

  for (const node of upgradePath) {
    if (node === 'A') continue;
    const def = getUpgradeNode(race, btype, node);
    if (!def) continue;
    if (def.hpMult) hpMult *= def.hpMult;
    if (def.damageMult) dmgMult *= def.damageMult;
    if (def.attackSpeedMult) atkSpdMult *= def.attackSpeedMult;
    if (def.spawnSpeedMult) spawnSpdMult *= def.spawnSpeedMult;
    if (def.special) Object.assign(special, def.special);
  }

  // Read merged specials (matches getUnitUpgradeMultipliers behavior)
  if (special.spawnCount) spawnCount = special.spawnCount;
  const dodgeChance = Math.min(special.dodgeChance ?? 0, 0.75);
  const damageReductionPct = Math.min(special.damageReductionPct ?? 0, 0.75);
  const regenPerSec = special.regenPerSec ?? 0;
  const reviveHpPct = special.reviveHpPct ?? 0;
  const multishotCount = special.multishotCount ?? 0;
  const multishotDamagePct = special.multishotDamagePct ?? 0.7;
  const splashRadius = special.splashRadius ?? 0;
  const splashDamagePct = special.splashDamagePct ?? 0.5;
  const cleaveTargets = special.cleaveTargets ?? 0;
  const extraBurnStacks = special.extraBurnStacks ?? 0;
  const extraSlowStacks = special.extraSlowStacks ?? 0;
  const extraChainTargets = special.extraChainTargets ?? 0;
  const chainDamagePct = special.chainDamagePct ?? 0.5;
  const aoeRadiusBonus = special.aoeRadiusBonus ?? 0;
  const shieldTargetBonus = special.shieldTargetBonus ?? 0;
  const shieldAbsorbBonus = special.shieldAbsorbBonus ?? 0;
  const healBonus = special.healBonus ?? 0;
  const chainHeal = special.chainHeal ?? 0;
  const explodeOnDeath = special.explodeOnDeath ?? false;
  const explodeDamage = special.explodeDamage ?? 0;
  const explodeRadius = special.explodeRadius ?? 0;
  const auraDmg = special.auraDamageBonus ?? 0;
  const auraSpd = special.auraSpeedBonus ?? 0;
  const auraArmor = special.auraArmorBonus ?? 0;
  const auraAtkSpd = special.auraAttackSpeedBonus ?? 0;
  const auraHeal = special.auraHealPerSec ?? 0;
  const auraDodge = special.auraDodgeBonus ?? 0;
  const goldOnKill = special.goldOnKill ?? 0;
  const goldOnDeath = special.goldOnDeath ?? 0;
  const isSiegeUnit = special.isSiegeUnit ?? false;
  const buildingDamageMult = special.buildingDamageMult ?? 1;
  const hopAttack = special.hopAttack ?? false;
  const guaranteedHaste = special.guaranteedHaste ?? false;
  const killScaling = special.killScaling ?? false;
  const soulHarvest = special.soulHarvest ?? false;
  const crownMage = special.crownMage ?? false;
  const skeletonSummonChance = special.skeletonSummonChance ?? 0;

  const hp = stats.hp * hpMult;
  const baseDps = (stats.damage * dmgMult) / (stats.attackSpeed * atkSpdMult);
  const spawnInterval = (SPAWN_INTERVAL_TICKS / TICK_RATE) * spawnSpdMult;
  const notes: string[] = [];

  // --- Effective HP ---
  let effHp = hp;
  if (dodgeChance > 0) { effHp /= (1 - dodgeChance); notes.push(`dodge ${(dodgeChance * 100).toFixed(0)}%`); }
  if (damageReductionPct > 0) { effHp /= (1 - damageReductionPct); notes.push(`DR ${(damageReductionPct * 100).toFixed(0)}%`); }
  if (regenPerSec > 0) { effHp += regenPerSec * 8; notes.push(`regen ${regenPerSec}/s`); }
  if (reviveHpPct > 0) { effHp *= (1 + reviveHpPct); notes.push(`revive ${(reviveHpPct * 100).toFixed(0)}%`); }

  // --- Effective DPS ---
  let effDps = baseDps;
  if (multishotCount > 0) {
    effDps *= (1 + multishotCount * multishotDamagePct);
    notes.push(`multi ×${1 + multishotCount}@${(multishotDamagePct * 100).toFixed(0)}%`);
  }
  if (splashRadius > 0 && !isSiegeUnit) {
    effDps *= (1 + Math.min(splashRadius, 3) * 0.8 * splashDamagePct);
    notes.push(`splash r${splashRadius}`);
  }
  if (cleaveTargets > 0) { effDps *= (1 + cleaveTargets * 0.6); notes.push(`cleave +${cleaveTargets}`); }
  if (extraBurnStacks > 0) {
    // +2 dmg/s per stack, 3s duration. SEARED combo: +50% burn if target also slowed.
    const burnPerStack = extraSlowStacks > 0 ? 3 : 2; // 2 base, 3 with SEARED
    effDps += (extraBurnStacks * burnPerStack * 3) / (stats.attackSpeed * atkSpdMult);
    notes.push(`burn +${extraBurnStacks}${extraSlowStacks > 0 ? ' SEARED' : ''}`);
  }
  if (extraSlowStacks > 0) { effDps *= (1 + extraSlowStacks * 0.08); notes.push(`slow +${extraSlowStacks}`); }
  if (extraChainTargets > 0) { effDps *= (1 + extraChainTargets * chainDamagePct); notes.push(`chain +${extraChainTargets}`); }
  if (aoeRadiusBonus > 0) { effDps *= (1 + aoeRadiusBonus * 0.3); notes.push(`aoe +${aoeRadiusBonus}`); }
  if (hopAttack) { effDps *= 1.15; notes.push('hop'); }
  if (guaranteedHaste) { effDps *= 1.15; notes.push('haste'); }
  if (crownMage) { effDps *= 1.5; notes.push('mage'); }

  // --- Team/support bonus (flat power addition) ---
  let teamBonus = 0;
  const AURA_ALLIES = 4;
  if (shieldTargetBonus > 0 || shieldAbsorbBonus > 0) {
    teamBonus += (shieldTargetBonus * 12 + shieldAbsorbBonus * 2) * 0.5;
    notes.push(`shield +${shieldTargetBonus}t/+${shieldAbsorbBonus}a`);
  }
  if (healBonus > 0) { teamBonus += healBonus * 0.8; notes.push(`heal +${healBonus}`); }
  if (chainHeal > 0) { teamBonus += chainHeal * 3; notes.push(`chainHeal ×${chainHeal}`); }
  if (auraDmg > 0) { teamBonus += auraDmg * AURA_ALLIES * 2; notes.push(`auraDmg +${auraDmg}`); }
  if (auraSpd > 0) { teamBonus += auraSpd * AURA_ALLIES * 50; notes.push(`auraSpd +${(auraSpd * 100).toFixed(0)}%`); }
  if (auraArmor > 0) { teamBonus += auraArmor * AURA_ALLIES * 80; notes.push(`auraArmor +${(auraArmor * 100).toFixed(0)}%`); }
  if (auraAtkSpd > 0) { teamBonus += auraAtkSpd * AURA_ALLIES * 60; notes.push(`auraAtkSpd +${(auraAtkSpd * 100).toFixed(0)}%`); }
  if (auraHeal > 0) { teamBonus += auraHeal * AURA_ALLIES * 6; notes.push(`auraHeal ${auraHeal}/s`); }
  if (auraDodge > 0) { teamBonus += auraDodge * AURA_ALLIES * 60; notes.push(`auraDodge +${(auraDodge * 100).toFixed(0)}%`); }

  // --- Snowball mechanics ---
  if (killScaling) { effDps *= 1.25; notes.push('killScale'); }
  if (soulHarvest) { effHp *= 1.3; effDps *= 1.3; notes.push('soulHarvest'); }

  // --- Explode on death ---
  let explodePwr = 0;
  if (explodeOnDeath && explodeDamage > 0) {
    const estTgt = Math.min(1 + explodeRadius * 0.6, 4);
    explodePwr = explodeDamage * estTgt;
    notes.push(`explode ${explodeDamage}×${estTgt.toFixed(1)}`);
  }

  // --- Siege ---
  if (isSiegeUnit) {
    notes.push(`siege ×${buildingDamageMult}vsBldg`);
    if (splashRadius > 0) {
      effDps *= (1 + splashRadius * 0.3 * (splashDamagePct || 0.5));
      notes.push(`siegeSplash r${splashRadius}`);
    }
  }

  // --- Skeleton summon (Geists casters) ---
  // 15 HP, 8 dmg, 1.0 atkSpd, 10s lifetime. Power = HP * DPS * chance * kills_in_range_per_sec
  if (skeletonSummonChance > 0) {
    const skelPower = 15 * 8; // HP * DPS of mini skeleton
    const deathsPerSec = 0.3; // conservative estimate of nearby deaths
    teamBonus += skelPower * skeletonSummonChance * deathsPerSec * 10; // × lifetime
    notes.push(`skelSummon ${(skeletonSummonChance * 100).toFixed(0)}%`);
  }

  // --- Economic ---
  // goldOnKill: ~1 kill per 8s for a melee unit, gold/2 for eff conversion
  if (goldOnKill > 0) { teamBonus += (goldOnKill / 2) * 0.125 * 50; notes.push(`gold/kill ${goldOnKill}`); }
  if (goldOnDeath > 0) { teamBonus += (goldOnDeath / 2) * 10; notes.push(`gold/death ${goldOnDeath}`); }

  const power = effHp * effDps * spawnCount + explodePwr * spawnCount + teamBonus;
  return { hp, dps: baseDps, spawnCount, power, spawnInterval, powerRate: power / spawnInterval, specialNotes: notes };
}

// ==================== UPGRADE COSTS ====================

function getUpgradeCumCost(race: Race, btype: BuildingType, path: string[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const cost = getNodeUpgradeCost(race, btype, i, path[i]);
    total += effCost(cost);
  }
  return total;
}

// ==================== RESEARCH ====================

function researchCostPerLevel(race: Race, level: number): number {
  // Matches getResearchUpgradeCost logic for non-oneshot
  if (race === Race.Oozlings) {
    return Math.round(30 * Math.pow(1.4, level)); // deathEssence (treat as 1:1 eff)
  }
  const cost = Math.round(80 * Math.pow(1.5, level));
  // All races pay ~40 eff per base level:
  // Gold races: 80g = 40 eff. Non-gold: half raw in wood/meat = 40 eff.
  return cost / 2;
}

function researchCumCost(race: Race, atkLevels: number, defLevels: number): number {
  let total = 0;
  for (let i = 0; i < atkLevels; i++) total += researchCostPerLevel(race, i);
  for (let i = 0; i < defLevels; i++) total += researchCostPerLevel(race, i);
  return total;
}

function researchPowerMult(atkLevel: number, defLevel: number): number {
  const dmgMult = Math.pow(1.25, atkLevel);
  const dr = 1 - 1 / (1 + 0.06 * defLevel);
  const effHpMult = 1 / (1 - dr);
  return dmgMult * effHpMult;
}

// ==================== TABLE FORMATTING ====================

function pad(s: string, w: number, align: 'left' | 'right' = 'right'): string {
  if (align === 'left') return s.padEnd(w);
  return s.padStart(w);
}

function fmt(n: number, decimals = 1): string {
  return n.toFixed(decimals);
}

function printTable(headers: string[], rows: string[][], colWidths?: number[]) {
  const widths = colWidths ?? headers.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] ?? '').length)) + 1);
  const headerLine = headers.map((h, i) => pad(h, widths[i], i === 0 ? 'left' : 'right')).join(' | ');
  const divider = widths.map(w => '-'.repeat(w)).join('-+-');
  console.log(headerLine);
  console.log(divider);
  for (const row of rows) {
    console.log(row.map((c, i) => pad(c, widths[i], i === 0 ? 'left' : 'right')).join(' | '));
  }
}

// ==================== MAIN ANALYSIS ====================

function runAnalysis() {
  console.log('='.repeat(80));
  console.log('  COST-BENEFIT ANALYSIS — All 9 Races');
  console.log(`  Exchange rate: 2 gold = 1 wood = 1 meat`);
  console.log(`  Gold yield: ${GOLD_YIELD_PER_TRIP}/trip, Wood: ${WOOD_YIELD_PER_TRIP}/trip, Meat: ${MEAT_YIELD_PER_TRIP}/trip`);
  console.log(`  Spawn interval: ${(SPAWN_INTERVAL_TICKS / TICK_RATE).toFixed(1)}s base`);
  console.log('='.repeat(80));

  // ---- 1. Building Costs ----
  console.log('\n## BUILDING EFFECTIVE COSTS\n');
  const bTypes = [BuildingType.MeleeSpawner, BuildingType.RangedSpawner, BuildingType.CasterSpawner, BuildingType.Tower, BuildingType.HarvesterHut];
  printTable(
    ['Race', 'Melee', 'Ranged', 'Caster', 'Tower', 'Hut'],
    ALL_RACES.map(r => [
      RACE_NAMES[r],
      ...bTypes.map(bt => fmt(effCost(RACE_BUILDING_COSTS[r][bt]))),
    ]),
  );

  // ---- 2. Upgrade Costs ----
  console.log('\n## UPGRADE EFFECTIVE COSTS (per node)\n');
  printTable(
    ['Race', 'Tier 1', 'Tier 2'],
    ALL_RACES.map(r => {
      const t1 = RACE_UPGRADE_COSTS[r].tier1;
      const t2 = RACE_UPGRADE_COSTS[r].tier2;
      return [RACE_NAMES[r], fmt(effCost(t1)), fmt(effCost(t2))];
    }),
  );

  // ---- 3. Unit Power — all upgrade paths ----
  // Tree: A → B(T1) → D,E(T2)  |  A → C(T1) → F,G(T2)
  const ALL_PATHS: { path: string[]; label: string }[] = [
    { path: ['A'],            label: 'T0 (base)' },
    { path: ['A', 'B'],      label: 'B' },
    { path: ['A', 'C'],      label: 'C' },
    { path: ['A', 'B', 'D'], label: 'B→D' },
    { path: ['A', 'B', 'E'], label: 'B→E' },
    { path: ['A', 'C', 'F'], label: 'C→F' },
    { path: ['A', 'C', 'G'], label: 'C→G' },
  ];

  function getNodeName(race: Race, btype: BuildingType, node: string): string {
    const def = getUpgradeNode(race, btype, node);
    return def?.name ?? node;
  }

  for (const btype of COMBAT_BUILDINGS) {
    const catName = CATEGORY_NAMES[btype];
    console.log(`\n## ${catName.toUpperCase()} UNIT POWER — ALL UPGRADE PATHS\n`);

    for (const race of ALL_RACES) {
      const stats = UNIT_STATS[race]?.[btype];
      if (!stats) continue;

      const bldgCost = effCost(RACE_BUILDING_COSTS[race][btype]);
      const unitLabel = `${stats.name}${(stats.spawnCount ?? 1) > 1 ? ` ×${stats.spawnCount}` : ''}`;
      console.log(`  ${RACE_NAMES[race]} — ${unitLabel} (building: ${fmt(bldgCost)} eff)`);

      const rows: string[][] = [];
      for (const { path, label } of ALL_PATHS) {
        // Check if this path's terminal node exists in the tree
        const terminalNode = path[path.length - 1];
        if (terminalNode !== 'A' && !getUpgradeNode(race, btype, terminalNode)) continue;

        const up = computeUnitPower(race, btype, path);
        const upgCost = getUpgradeCumCost(race, btype, path);
        const totalCost = bldgCost + upgCost;
        const efficiency = up.powerRate / totalCost;
        const specials = up.specialNotes.length > 0 ? up.specialNotes.join(', ') : '-';

        // Get the node name for the terminal node
        const nodeName = terminalNode === 'A' ? stats.name : getNodeName(race, btype, terminalNode);

        rows.push([
          label,
          nodeName,
          fmt(up.power, 0),
          fmt(totalCost),
          fmt(efficiency, 2),
          fmt(up.spawnInterval, 1),
          specials,
        ]);
      }

      printTable(
        ['Path', 'Name', 'Power', 'Total $', 'Eff', 'Interval', 'Specials'],
        rows,
      );
      console.log('');
    }
  }

  // ---- 4. Research Cost Comparison ----
  console.log('\n## RESEARCH COSTS (cumulative eff for ONE category atk+def)\n');
  printTable(
    ['Race', '1a+1d', '2a+2d', '3a+3d', 'Power ×1+1', 'Power ×3+2'],
    ALL_RACES.map(r => [
      RACE_NAMES[r],
      fmt(researchCumCost(r, 1, 1)),
      fmt(researchCumCost(r, 2, 2)),
      fmt(researchCumCost(r, 3, 3)),
      fmt(researchPowerMult(1, 1), 2) + '×',
      fmt(researchPowerMult(3, 2), 2) + '×',
    ]),
  );

  // ---- 5. Research-Adjusted Late-Game Power (best T2 path per race) ----
  console.log('\n## LATE-GAME POWER (best T2 path + 3atk/2def research)\n');
  const lateMult = researchPowerMult(3, 2);
  const T2_PATHS = [['A','B','D'], ['A','B','E'], ['A','C','F'], ['A','C','G']];

  function bestT2(race: Race, btype: BuildingType) {
    let best = { path: T2_PATHS[0], eff: -1, up: computeUnitPower(race, btype, T2_PATHS[0]) };
    for (const path of T2_PATHS) {
      const termNode = path[path.length - 1];
      if (!getUpgradeNode(race, btype, termNode)) continue;
      const up = computeUnitPower(race, btype, path);
      const bldgCost = effCost(RACE_BUILDING_COSTS[race][btype]);
      const upgCost = getUpgradeCumCost(race, btype, path);
      const resCost = researchCumCost(race, 3, 2);
      const totalInvest = bldgCost + upgCost + resCost;
      const lateEff = (up.powerRate * lateMult) / totalInvest;
      if (lateEff > best.eff) best = { path, eff: lateEff, up };
    }
    return best;
  }

  for (const btype of COMBAT_BUILDINGS) {
    const catName = CATEGORY_NAMES[btype];
    const rows: string[][] = [];

    for (const race of ALL_RACES) {
      const { path, up } = bestT2(race, btype);
      const bldgCost = effCost(RACE_BUILDING_COSTS[race][btype]);
      const upgCost = getUpgradeCumCost(race, btype, path);
      const resCost = researchCumCost(race, 3, 2);
      const totalInvest = bldgCost + upgCost + resCost;
      const latePower = up.power * lateMult;
      const lateRate = up.powerRate * lateMult;
      const lateEff = lateRate / totalInvest;
      const pathLabel = path.slice(1).join('→');

      rows.push([
        RACE_NAMES[race],
        pathLabel,
        fmt(latePower, 0),
        fmt(lateRate, 1),
        fmt(resCost),
        fmt(totalInvest),
        fmt(lateEff, 3),
      ]);
    }

    rows.sort((a, b) => parseFloat(b[6]) - parseFloat(a[6]));
    console.log(`  ${catName}:`);
    printTable(
      ['Race', 'Path', 'Late Pwr', 'Late Rate', 'Res $', 'Total $', 'Late Eff'],
      rows,
    );
    console.log('');
  }

  // ---- 6. Tower Value ----
  console.log('\n## TOWER VALUE\n');
  {
    const rows: string[][] = [];
    for (const race of ALL_RACES) {
      const ts = TOWER_STATS[race];
      const dps = ts.damage / ts.attackSpeed;
      const power = ts.hp * dps;
      const cost = effCost(RACE_BUILDING_COSTS[race][BuildingType.Tower]);
      const valuePerEff = power / cost;
      rows.push([
        RACE_NAMES[race],
        fmt(ts.hp, 0), fmt(dps, 1), fmt(power, 0), fmt(cost), fmt(valuePerEff, 1),
        `${ts.range}`,
      ]);
    }
    rows.sort((a, b) => parseFloat(b[5]) - parseFloat(a[5]));
    printTable(
      ['Race', 'HP', 'DPS', 'Power', 'Cost', 'Pwr/$', 'Range'],
      rows,
    );
  }

  // ---- 7. Hut Payback ----
  console.log('\n## HUT PAYBACK ANALYSIS (Duel Map, 2v2)\n');
  const econ = computeHarvesterEconomics();
  console.log(`  Gold harvester:  ${fmt(econ.goldPerSec, 3)} gold/s  (${fmt(econ.goldEffPerSec, 3)} eff/s, cycle ${fmt(econ.goldCycle)}s)`);
  console.log(`  Wood harvester:  ${fmt(econ.woodPerSec, 3)} wood/s  (${fmt(econ.woodEffPerSec, 3)} eff/s, cycle ${fmt(econ.woodCycle)}s)`);
  console.log(`  Meat harvester:  ${fmt(econ.meatPerSec, 3)} meat/s  (${fmt(econ.meatEffPerSec, 3)} eff/s, cycle ${fmt(econ.meatCycle)}s)`);
  console.log('');

  const goldRate = econ.goldEffPerSec;
  const secRate = Math.min(econ.woodEffPerSec, econ.meatEffPerSec); // conservative

  {
    const rows: string[][] = [];
    for (const race of ALL_RACES) {
      const base = RACE_BUILDING_COSTS[race][BuildingType.HarvesterHut];
      const costs: number[] = [];
      const paybacks: number[] = [];
      for (let i = 0; i < 4; i++) {
        const mult = Math.pow(HUT_COST_SCALE, Math.max(0, i));
        const cost = eff(
          Math.floor(base.gold * mult),
          Math.floor(base.wood * mult),
          Math.floor(base.meat * mult),
        );
        costs.push(cost);
        // First hut goes to gold, rest to secondary resources
        const rate = i === 0 ? goldRate : secRate;
        paybacks.push(cost / rate);
      }
      rows.push([
        RACE_NAMES[race],
        fmt(costs[0]), fmt(paybacks[0], 0) + 's',
        fmt(costs[1]), fmt(paybacks[1], 0) + 's',
        fmt(costs[2]), fmt(paybacks[2], 0) + 's',
        fmt(costs[3]), fmt(paybacks[3], 0) + 's',
      ]);
    }
    rows.sort((a, b) => parseFloat(a[2]) - parseFloat(b[2]));
    printTable(
      ['Race', 'Hut1 $', 'Pay1', 'Hut2 $', 'Pay2', 'Hut3 $', 'Pay3', 'Hut4 $', 'Pay4'],
      rows,
    );
  }

  // ---- 8. Summary Rankings ----
  console.log('\n## SUMMARY RANKINGS\n');

  type RaceScore = { race: Race; score: number };

  // Melee best T2 efficiency
  const meleeEff: RaceScore[] = ALL_RACES.map(r => {
    const { eff } = bestT2(r, BuildingType.MeleeSpawner);
    return { race: r, score: eff };
  }).sort((a, b) => b.score - a.score);

  console.log('  Melee Best T2 Efficiency:');
  meleeEff.forEach((e, i) => console.log(`    ${i + 1}. ${RACE_NAMES[e.race].padEnd(10)} ${fmt(e.score, 3)}`));

  // Best T0 rush value (melee)
  console.log('\n  Cheapest Melee Opening:');
  const rushValue = ALL_RACES.map(r => ({
    race: r,
    cost: effCost(RACE_BUILDING_COSTS[r][BuildingType.MeleeSpawner]),
  })).sort((a, b) => a.cost - b.cost);
  rushValue.forEach((e, i) => console.log(`    ${i + 1}. ${RACE_NAMES[e.race].padEnd(10)} ${fmt(e.cost)} eff`));

  // Research value (cost for 2a+1d per category)
  console.log('\n  Research Cost (2atk+1def per category):');
  const resValue = ALL_RACES.map(r => ({
    race: r,
    cost: researchCumCost(r, 2, 1),
  })).sort((a, b) => a.cost - b.cost);
  resValue.forEach((e, i) => console.log(`    ${i + 1}. ${RACE_NAMES[e.race].padEnd(10)} ${fmt(e.cost)} eff`));

  // Hut payback
  console.log('\n  Hut #1 Payback:');
  const hutPay = ALL_RACES.map(r => {
    const base = RACE_BUILDING_COSTS[r][BuildingType.HarvesterHut];
    const cost = effCost(base);
    return { race: r, payback: cost / goldRate };
  }).sort((a, b) => a.payback - b.payback);
  hutPay.forEach((e, i) => console.log(`    ${i + 1}. ${RACE_NAMES[e.race].padEnd(10)} ${fmt(e.payback, 0)}s`));

  console.log('\n' + '='.repeat(80));
  console.log('  Analysis complete. Re-run after balance changes to compare.');
  console.log('='.repeat(80));
}

// ==================== RUN ====================

// Capture all output and write to file alongside console
const lines: string[] = [];
const origLog = console.log;
console.log = (...args: unknown[]) => {
  const line = args.map(a => String(a)).join(' ');
  lines.push(line);
  origLog.apply(console, args);
};

runAnalysis();

// Write to COST_ANALYSIS.md in project root
const fs = require('fs');
const path = require('path');
const outPath = path.join(__dirname, '..', '..', 'COST_ANALYSIS.md');
fs.writeFileSync(outPath, '```\n' + lines.join('\n') + '\n```\n');
origLog(`\nSaved to ${outPath}`);
