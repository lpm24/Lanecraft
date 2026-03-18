/**
 * Cost-Benefit Analysis Tool
 *
 * Computes effective costs, unit power, cost-efficiency ratios, and hut payback
 * for all 9 races. Uses the exchange rate: 2 gold = 1 wood = 1 stone.
 *
 * Run: npm run cost-analysis
 */

import { Race, BuildingType, TICK_RATE } from '../simulation/types';
import {
  UNIT_STATS, TOWER_STATS,
  RACE_BUILDING_COSTS, RACE_UPGRADE_COSTS,
  UPGRADE_TREES,
  HUT_COST_SCALE,
  GOLD_YIELD_PER_TRIP, WOOD_YIELD_PER_TRIP, STONE_YIELD_PER_TRIP,
  SPAWN_INTERVAL_TICKS,
  HARVESTER_MOVE_SPEED, MINE_TIME_BASE_TICKS,
  getNodeUpgradeCost,
} from '../simulation/data';
// DUEL_MAP available if map-specific analysis is needed
// import { DUEL_MAP } from '../simulation/maps';

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

/** Convert raw resources to effective cost: gold/2 + wood + stone */
function eff(gold: number, wood: number, stone: number): number {
  return gold / 2 + wood + stone;
}

function effCost(c: { gold: number; wood: number; stone: number }): number {
  return eff(c.gold, c.wood, c.stone);
}

// ==================== HARVESTER ECONOMICS ====================

function computeHarvesterEconomics() {
  // Duel map positions
  const hqCenter = { x: 40, y: 106.5 }; // Bottom team HQ center
  const goldMine = { x: 40, y: 99 };     // 6 tiles below HQ
  const woodNode = { x: 12, y: 60 };     // Far left, mid-map
  const stoneNode = { x: 68, y: 60 };    // Far right, mid-map

  const speed = HARVESTER_MOVE_SPEED; // tiles/sec
  const mineTime = MINE_TIME_BASE_TICKS / TICK_RATE; // seconds

  function tripCycle(nodePos: { x: number; y: number }): number {
    const dist = Math.sqrt((nodePos.x - hqCenter.x) ** 2 + (nodePos.y - hqCenter.y) ** 2);
    const travelTime = (dist * 2) / speed; // round trip
    return travelTime + mineTime;
  }

  const goldCycle = tripCycle(goldMine);
  const woodCycle = tripCycle(woodNode);
  const stoneCycle = tripCycle(stoneNode);

  return {
    goldCycle,
    woodCycle,
    stoneCycle,
    goldPerSec: GOLD_YIELD_PER_TRIP / goldCycle,
    woodPerSec: WOOD_YIELD_PER_TRIP / woodCycle,
    stonePerSec: STONE_YIELD_PER_TRIP / stoneCycle,
    goldEffPerSec: (GOLD_YIELD_PER_TRIP / 2) / goldCycle,  // gold worth half
    woodEffPerSec: WOOD_YIELD_PER_TRIP / woodCycle,
    stoneEffPerSec: STONE_YIELD_PER_TRIP / stoneCycle,
  };
}

// ==================== UNIT POWER ====================

interface UnitPower {
  hp: number;
  dps: number;
  spawnCount: number;
  power: number;         // HP * DPS * spawnCount
  spawnInterval: number; // seconds
  powerRate: number;     // power / spawnInterval
}

function getUpgradeNode(race: Race, btype: BuildingType, node: string) {
  const tree = UPGRADE_TREES[race]?.[btype];
  if (!tree) return undefined;
  return tree[node as keyof typeof tree];
}

function computeUnitPower(race: Race, btype: BuildingType, upgradePath: string[]): UnitPower {
  const stats = UNIT_STATS[race]?.[btype];
  if (!stats) return { hp: 0, dps: 0, spawnCount: 1, power: 0, spawnInterval: 999, powerRate: 0 };

  let hpMult = 1, dmgMult = 1, atkSpdMult = 1, spawnSpdMult = 1;
  let spawnCount = stats.spawnCount ?? 1;

  for (const node of upgradePath) {
    if (node === 'A') continue;
    const def = getUpgradeNode(race, btype, node);
    if (def) {
      if (def.hpMult) hpMult *= def.hpMult;
      if (def.damageMult) dmgMult *= def.damageMult;
      if (def.attackSpeedMult) atkSpdMult *= def.attackSpeedMult;
      if (def.spawnSpeedMult) spawnSpdMult *= def.spawnSpeedMult;
      if (def.special?.spawnCount) spawnCount = def.special.spawnCount;
    }
  }

  const hp = stats.hp * hpMult;
  const dps = (stats.damage * dmgMult) / (stats.attackSpeed * atkSpdMult);
  const spawnInterval = (SPAWN_INTERVAL_TICKS / TICK_RATE) * spawnSpdMult;
  const power = hp * dps * spawnCount;

  return { hp, dps, spawnCount, power, spawnInterval, powerRate: power / spawnInterval };
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
  // Gold races: 80g = 40 eff. Non-gold: half raw in wood/stone = 40 eff.
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
  console.log(`  Exchange rate: 2 gold = 1 wood = 1 stone`);
  console.log(`  Gold yield: ${GOLD_YIELD_PER_TRIP}/trip, Wood: ${WOOD_YIELD_PER_TRIP}/trip, Stone: ${STONE_YIELD_PER_TRIP}/trip`);
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

  // ---- 3. Unit Power at T0/T1/T2 ----
  for (const btype of COMBAT_BUILDINGS) {
    const catName = CATEGORY_NAMES[btype];
    console.log(`\n## ${catName.toUpperCase()} UNIT POWER & EFFICIENCY (B→D path)\n`);

    const rows: string[][] = [];
    for (const race of ALL_RACES) {
      const stats = UNIT_STATS[race]?.[btype];
      if (!stats) continue;

      const t0 = computeUnitPower(race, btype, ['A']);
      const t1 = computeUnitPower(race, btype, ['A', 'B']);
      const t2 = computeUnitPower(race, btype, ['A', 'B', 'D']);

      const bldgCost = effCost(RACE_BUILDING_COSTS[race][btype]);
      const t1UpgCost = getUpgradeCumCost(race, btype, ['A', 'B']);
      const t2UpgCost = getUpgradeCumCost(race, btype, ['A', 'B', 'D']);

      const t0Total = bldgCost;
      const t1Total = bldgCost + t1UpgCost;
      const t2Total = bldgCost + t2UpgCost;

      const t0Eff = t0.powerRate / t0Total;
      const t1Eff = t1.powerRate / t1Total;
      const t2Eff = t2.powerRate / t2Total;

      rows.push([
        RACE_NAMES[race],
        `${stats.name}${(stats.spawnCount ?? 1) > 1 ? ` ×${stats.spawnCount}` : ''}`,
        fmt(t0.power, 0), fmt(t1.power, 0), fmt(t2.power, 0),
        fmt(t0Total), fmt(t1Total), fmt(t2Total),
        fmt(t0Eff, 2), fmt(t1Eff, 2), fmt(t2Eff, 2),
        fmt(t0.spawnInterval, 1), fmt(t2.spawnInterval, 1),
      ]);
    }

    // Sort by T2 efficiency descending
    rows.sort((a, b) => parseFloat(b[10]) - parseFloat(a[10]));

    printTable(
      ['Race', 'Unit', 'T0 Pwr', 'T1 Pwr', 'T2 Pwr', 'T0 $', 'T1 $', 'T2 $', 'T0 Eff', 'T1 Eff', 'T2 Eff', 'T0 Int', 'T2 Int'],
      rows,
    );
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

  // ---- 5. Research-Adjusted Late-Game Power ----
  console.log('\n## LATE-GAME POWER (T2 units + 3atk/2def research)\n');
  const lateMult = researchPowerMult(3, 2);

  for (const btype of COMBAT_BUILDINGS) {
    const catName = CATEGORY_NAMES[btype];
    const rows: string[][] = [];

    for (const race of ALL_RACES) {
      const t2 = computeUnitPower(race, btype, ['A', 'B', 'D']);
      const bldgCost = effCost(RACE_BUILDING_COSTS[race][btype]);
      const upgCost = getUpgradeCumCost(race, btype, ['A', 'B', 'D']);
      const resCost = researchCumCost(race, 3, 2);
      const totalInvest = bldgCost + upgCost + resCost;
      const latePower = t2.power * lateMult;
      const lateRate = t2.powerRate * lateMult;
      const lateEff = lateRate / totalInvest;

      rows.push([
        RACE_NAMES[race],
        fmt(latePower, 0),
        fmt(lateRate, 1),
        fmt(resCost),
        fmt(totalInvest),
        fmt(lateEff, 3),
      ]);
    }

    rows.sort((a, b) => parseFloat(b[5]) - parseFloat(a[5]));
    console.log(`  ${catName}:`);
    printTable(
      ['Race', 'Late Pwr', 'Late Rate', 'Res $', 'Total $', 'Late Eff'],
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
  console.log(`  Stone harvester: ${fmt(econ.stonePerSec, 3)} stone/s (${fmt(econ.stoneEffPerSec, 3)} eff/s, cycle ${fmt(econ.stoneCycle)}s)`);
  console.log('');

  const goldRate = econ.goldEffPerSec;
  const secRate = Math.min(econ.woodEffPerSec, econ.stoneEffPerSec); // conservative

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
          Math.floor(base.stone * mult),
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

  // Melee T2 efficiency
  const meleeEff: RaceScore[] = ALL_RACES.map(r => {
    const t2 = computeUnitPower(r, BuildingType.MeleeSpawner, ['A', 'B', 'D']);
    const cost = effCost(RACE_BUILDING_COSTS[r][BuildingType.MeleeSpawner]) + getUpgradeCumCost(r, BuildingType.MeleeSpawner, ['A', 'B', 'D']);
    return { race: r, score: t2.powerRate / cost };
  }).sort((a, b) => b.score - a.score);

  console.log('  Melee T2 Efficiency:');
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
