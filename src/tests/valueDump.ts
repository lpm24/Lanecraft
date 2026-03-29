/**
 * Dump the value function scores for every race at game start (tick ~200).
 * Shows what the bot thinks is optimal vs what actually works.
 */
import { createInitialState, simulateTick } from '../simulation/GameState';
import { GameCommand, Race, Team, TICK_RATE, BuildingType, isAbilityBuilding } from '../simulation/types';
import {
  runAllBotAI, createBotContext, BotDifficultyLevel,
} from '../simulation/BotAI';
import { DUEL_MAP } from '../simulation/maps';
import { RACE_BUILDING_COSTS, UNIT_STATS, TOWER_STATS } from '../simulation/data';

const ALL_RACES = [Race.Crown, Race.Horde, Race.Goblins, Race.Oozlings, Race.Demon, Race.Deep, Race.Wild, Race.Geists, Race.Tenders];

// Run a game for each race, logging all build decisions for the first 3 minutes
for (const race of ALL_RACES) {
  const ppt = DUEL_MAP.playersPerTeam;
  const players: { race: Race; isBot: boolean; isEmpty?: boolean }[] = [];
  players.push({ race, isBot: true });
  for (let i = 1; i < ppt; i++) players.push({ race: Race.Crown, isBot: true, isEmpty: true });
  players.push({ race, isBot: true });
  for (let i = 1; i < ppt; i++) players.push({ race: Race.Crown, isBot: true, isEmpty: true });

  const state = createInitialState(players, undefined, DUEL_MAP);
  const ctx = createBotContext(BotDifficultyLevel.Nightmare);

  const buildLog: string[] = [];
  const commands: GameCommand[] = [];
  const emit = (cmd: GameCommand) => {
    commands.push(cmd);
    if (!('playerId' in cmd) || (cmd as { playerId: number }).playerId !== 0) return;
    const tick = state.tick;
    const secs = (tick / TICK_RATE).toFixed(1);
    if (cmd.type === 'place_building') {
      buildLog.push(`${secs}s: BUILD ${cmd.buildingType}`);
    } else if (cmd.type === 'build_hut') {
      buildLog.push(`${secs}s: BUILD hut`);
    } else if (cmd.type === 'purchase_upgrade') {
      buildLog.push(`${secs}s: UPGRADE bld#${cmd.buildingId} → ${cmd.choice}`);
    } else if (cmd.type === 'research_upgrade') {
      buildLog.push(`${secs}s: RESEARCH ${cmd.upgradeId}`);
    }
  };

  // Run for 8 minutes
  const maxTick = 8 * 60 * TICK_RATE;
  while (state.matchPhase !== 'ended' && state.tick < maxTick) {
    commands.length = 0;
    runAllBotAI(state, ctx, emit);
    simulateTick(state, commands);
  }

  // Summary
  const p = state.players[0];
  const buildings = state.buildings.filter(b => b.playerId === 0);
  const melee = buildings.filter(b => b.type === BuildingType.MeleeSpawner).length;
  const ranged = buildings.filter(b => b.type === BuildingType.RangedSpawner).length;
  const caster = buildings.filter(b => b.type === BuildingType.CasterSpawner).length;
  const realTowers = buildings.filter(b => b.type === BuildingType.Tower && !isAbilityBuilding(b)).length;
  const racialBuildings = buildings.filter(b => isAbilityBuilding(b)).length;
  const huts = buildings.filter(b => b.type === BuildingType.HarvesterHut).length;
  const units = state.units.filter(u => u.team === Team.Bottom).length;

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ${race.toUpperCase()} — Nightmare bot build order (first 4 min)`);
  console.log(`${'='.repeat(70)}`);

  // Show unit stats and costs
  const costs = RACE_BUILDING_COSTS[race];
  const spawnerTypes = [BuildingType.MeleeSpawner, BuildingType.RangedSpawner, BuildingType.CasterSpawner];
  console.log('  Unit stats:');
  for (const type of spawnerTypes) {
    const s = UNIT_STATS[race]?.[type];
    if (!s) continue;
    const c = costs[type];
    const label = type === BuildingType.MeleeSpawner ? 'Melee' : type === BuildingType.RangedSpawner ? 'Ranged' : 'Caster';
    const count = s.spawnCount ?? 1;
    const dps = (s.damage / s.attackSpeed).toFixed(1);
    const costStr = `${c.gold}g/${c.wood}w/${c.meat}m`;
    console.log(`    ${label.padEnd(8)} ${s.name.padEnd(14)} HP:${String(s.hp).padStart(4)} DMG:${String(s.damage).padStart(3)} DPS:${dps.padStart(5)} SPD:${s.moveSpeed} RNG:${s.range} x${count} Cost:${costStr}`);
  }
  const ts = TOWER_STATS[race];
  const tc = costs[BuildingType.Tower];
  console.log(`    Tower    ${' '.repeat(14)} HP:${String(ts.hp).padStart(4)} DMG:${String(ts.damage).padStart(3)} DPS:${(ts.damage / ts.attackSpeed).toFixed(1).padStart(5)} RNG:${ts.range} Cost:${tc.gold}g/${tc.wood}w/${tc.meat}m`);

  console.log(`\n  Build order (P0):`);
  for (const line of buildLog) {
    console.log(`    ${line}`);
  }

  const raceLabel = racialBuildings > 0 ? ` ${racialBuildings}Racial` : '';
  console.log(`\n  Final state @ 8min: ${melee}M ${ranged}R ${caster}C ${realTowers}T${raceLabel} ${huts}H | ${units} units alive`);
  console.log(`  Resources: ${p.gold}g ${p.wood}w ${p.meat}m`);
}
